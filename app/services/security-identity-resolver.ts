import { KnowledgeBaseRegistry } from '../../knowledge/registry/registry.ts'
import { readCanonicalV04Assets } from '../../knowledge/storage/canonical-v04-loader.ts'
import { normalizeExchange } from '../../skills/knowledge-curation/identity/company-identity.ts'
import { materializeSecurityIdentityRequirement } from '../../data/requirements.ts'
import type { DataResolver } from '../../data/resolver.ts'
import type { SecurityIdentityWorkflow, VerifiedSecurityIdentity } from '../../data/security-identity-contracts.ts'
export type { SecurityIdentitySource, SecurityIdentityWorkflow, VerifiedSecurityIdentity } from '../../data/security-identity-contracts.ts'

export interface SecurityIdentityCandidate {
  readonly workflowId: SecurityIdentityWorkflow
  readonly name?: string
  readonly symbol?: string
  readonly exchange?: string
  readonly asOf: string
  readonly historical?: boolean
  readonly query?: string
  readonly allowKnowledgeLookup: boolean
}

export type SecurityIdentityResolution =
  | { readonly status: 'VERIFIED'; readonly identity: VerifiedSecurityIdentity; readonly diagnostics: readonly string[] }
  | { readonly status: 'UNRESOLVED' | 'AMBIGUOUS' | 'CONFLICT' | 'HISTORICAL_IDENTITY_UNAVAILABLE'; readonly reason: string; readonly candidateSymbols: readonly string[]; readonly diagnostics: readonly string[] }

interface DirectoryRow { readonly symbol: string; readonly name: string; readonly exchange: 'SH' | 'SZ' | 'BJ' }
interface CanonicalCompany { readonly id: string; readonly ticker: string; readonly exchange: string; readonly name: string; readonly aliases: readonly string[]; readonly active: boolean; readonly value: Readonly<Record<string, unknown>> }

export interface SecurityIdentityResolverOptions {
  readonly mountedKnowledgeBaseRoot?: string
  readonly dataResolverFactory: (context: { readonly now: () => string; readonly signal?: AbortSignal }) => DataResolver<unknown>
  readonly now?: () => Date
  readonly cacheTtlMs?: number
  readonly cacheMaxEntries?: number
}

/** Shared exact identity gate for Company Research, Valuation, and Earnings Review. */
export class SecurityIdentityResolver {
  private readonly cache = new Map<string, { readonly expiresAt: number; readonly resolution: SecurityIdentityResolution }>()
  private readonly now: () => Date
  private readonly cacheTtlMs: number
  private readonly cacheMaxEntries: number

  constructor(private readonly options: SecurityIdentityResolverOptions) {
    this.now = options.now ?? (() => new Date())
    this.cacheTtlMs = Math.max(0, Math.min(300_000, options.cacheTtlMs ?? 300_000))
    this.cacheMaxEntries = Math.max(1, Math.min(128, options.cacheMaxEntries ?? 128))
  }

  async resolve(candidate: SecurityIdentityCandidate, signal?: AbortSignal): Promise<SecurityIdentityResolution> {
    const query = normalizeCandidate(candidate)
    if (query.error) return failure('UNRESOLVED', query.error)
    const asOf = new Date(candidate.asOf)
    if (!Number.isFinite(asOf.getTime())) return failure('UNRESOLVED', 'The identity cutoff is not a valid timestamp.')
    const nowDate = this.now()
    const historical = candidate.historical === true
    const cacheKey = JSON.stringify([candidate.workflowId, query.name, query.symbol, query.exchange])
    // With Knowledge lookup disabled, only a prior external-directory result
    // can be reused. Canonical identities are never cached across policy modes.
    if (!historical && !candidate.allowKnowledgeLookup) {
      const cached = this.cachedDirectoryResolution(cacheKey, nowDate.getTime())
      if (cached) return cached
    }

    const diagnostics: string[] = []
    let companies: readonly CanonicalCompany[] = []
    if (candidate.allowKnowledgeLookup && this.options.mountedKnowledgeBaseRoot) {
      try {
        const handle = await new KnowledgeBaseRegistry().mount(this.options.mountedKnowledgeBaseRoot)
        if (handle.schemaVersion === '0.4') {
          const assets = await readCanonicalV04Assets(handle.rootRef)
          companies = assets.objects.filter((item) => item.kind === 'entity').map((item) => asCanonicalCompany(item.value as unknown as Record<string, unknown>, asOf.toISOString())).filter((item): item is CanonicalCompany => item !== undefined)
        } else diagnostics.push('CANONICAL_IDENTITY_SCHEMA_UNSUPPORTED')
      } catch (error) { diagnostics.push(`CANONICAL_IDENTITY_LOOKUP_FAILED:${error instanceof Error ? error.name : 'unknown error'}`) }
    }

    const exactCanonicalAll = companies.filter((company) => matchesCanonical(company, query, true))
    const exactCanonical = exactCanonicalAll.filter((company) => company.active)
    const canonicalBySymbol = query.symbol === undefined ? [] : companies.filter((company) => company.ticker === query.symbol)
    const canonicalByName = query.name === undefined ? [] : companies.filter((company) => matchesCanonicalName(company, query.name!))
    if (exactCanonicalAll.length === 0 && query.symbol !== undefined && canonicalByName.length > 0) {
      return failure('CONFLICT', 'The supplied security code conflicts with an existing Canonical Company name or alias.', canonicalByName.map((item) => item.ticker), diagnostics)
    }
    if (canonicalBySymbol.length > 0 && exactCanonical.length === 0) {
      return failure('CONFLICT', 'The supplied security identity conflicts with an existing Canonical Company.', canonicalBySymbol.map((item) => item.ticker), diagnostics)
    }
    if (exactCanonicalAll.length > 0 && exactCanonical.length === 0) return failure('CONFLICT', 'The exact Canonical Company identity is inactive or outside its lifecycle window.', exactCanonicalAll.map((item) => item.ticker), diagnostics)
    if (exactCanonical.length > 1) return failure('AMBIGUOUS', 'Multiple Canonical Companies match the supplied identity.', exactCanonical.map((item) => item.ticker), diagnostics)
    if (exactCanonical.length === 1) {
      const company = exactCanonical[0]!
      if (historical && !canonicalIdentityValidAt(company.value, asOf)) return failure('HISTORICAL_IDENTITY_UNAVAILABLE', 'Canonical Knowledge does not establish this security identity at the requested historical cutoff.', [company.ticker], diagnostics)
      const identity: VerifiedSecurityIdentity = {
        symbol: company.ticker,
        exchange: normalizeExchange(company.exchange) as VerifiedSecurityIdentity['exchange'],
        verifiedName: company.name,
        verificationSource: 'canonical_knowledge',
        originAuthority: 'CANONICAL_KNOWLEDGE',
        verifiedAt: nowDate.toISOString(),
        canonicalCompanyRef: company.id,
      }
      const result: SecurityIdentityResolution = { status: 'VERIFIED', identity, diagnostics }
      return result
    }
    if (historical) return failure('HISTORICAL_IDENTITY_UNAVAILABLE', 'The current security directory cannot establish historical security identity.', [], diagnostics)
    // Recheck Canonical identity before returning a cached directory result.
    // A prior external lookup must not bypass a newly-created or changed
    // Canonical identity, nor leak a Canonical identity into Knowledge-off mode.
    if (candidate.allowKnowledgeLookup) {
      const cached = this.cachedDirectoryResolution(cacheKey, nowDate.getTime())
      if (cached) return cached
    }

    try {
      const requirement = materializeSecurityIdentityRequirement({
        workflowId: candidate.workflowId,
        ...(query.name ? { requestedName: query.name } : {}),
        ...(query.symbol ? { requestedSymbol: query.symbol } : {}),
        ...(query.exchange ? { requestedExchange: query.exchange } : {}),
        asOf: nowDate.toISOString(),
      })
      const resolved = await this.options.dataResolverFactory({ now: () => this.now().toISOString(), ...(signal ? { signal } : {}) }).resolveOne(requirement)
      if (resolved.status !== 'AVAILABLE' || !Array.isArray(resolved.value)) {
        const attempts = resolved.attempts.map((attempt) => `${attempt.sourceId}:${attempt.status}`).join(',') || resolved.unavailableReason || 'NO_PROVIDER_ATTEMPT'
        return failure('UNRESOLVED', `Trusted security directory did not verify an exact identity (${attempts}).`, [], [...diagnostics, ...resolved.attempts.map((attempt) => attempt.diagnostic).filter((item): item is string => Boolean(item))])
      }
      const rows = resolved.value.map(parseDirectoryRow).filter((row): row is DirectoryRow => row !== undefined)
      const matches = rows.filter((row) => matchesDirectory(row, query))
      if (matches.length === 0) return failure('UNRESOLVED', 'No exact name, symbol, and exchange match was returned by the trusted security directory.', [], diagnostics)
      const unique = [...new Map(matches.map((row) => [`${row.symbol}.${row.exchange}`, row])).values()]
      if (unique.length > 1) return failure('AMBIGUOUS', 'Multiple securities match the supplied name or symbol.', unique.map((item) => item.symbol), diagnostics)
      const row = unique[0]!
      const identity: VerifiedSecurityIdentity = {
        symbol: row.symbol, exchange: row.exchange, verifiedName: row.name,
        verificationSource: 'akshare_security_directory', originAuthority: 'S3_AGGREGATOR',
        verifiedAt: resolved.source?.retrievedAt ?? nowDate.toISOString(),
        sourceId: resolved.source?.sourceId ?? 'akshare-security-identity-directory',
        ...(resolved.source?.sourceUrl ? { sourceUrl: resolved.source.sourceUrl } : {}),
      }
      const result: SecurityIdentityResolution = { status: 'VERIFIED', identity, diagnostics }
      this.cacheResolution(cacheKey, result, false, nowDate.getTime())
      return result
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.message === 'WORKFLOW_CANCELLED')) throw new Error('WORKFLOW_CANCELLED')
      return failure('UNRESOLVED', 'Trusted security identity resolution failed.', [], [...diagnostics, `SECURITY_IDENTITY_RESOLUTION_FAILED:${error instanceof Error ? error.name : 'unknown error'}`])
    }
  }

  private cacheResolution(key: string, resolution: SecurityIdentityResolution, historical: boolean, now: number): void {
    if (historical || this.cacheTtlMs === 0 || resolution.status !== 'VERIFIED') return
    while (this.cache.size >= this.cacheMaxEntries) this.cache.delete(this.cache.keys().next().value!)
    this.cache.set(key, { expiresAt: now + this.cacheTtlMs, resolution })
  }

  private cachedDirectoryResolution(key: string, now: number): SecurityIdentityResolution | undefined {
    const cached = this.cache.get(key)
    if (cached && cached.expiresAt > now && cached.resolution.status === 'VERIFIED' && cached.resolution.identity.verificationSource === 'akshare_security_directory') return cached.resolution
    if (cached) this.cache.delete(key)
    return undefined
  }
}

interface NormalizedCandidate { readonly name?: string; readonly symbol?: string; readonly exchange?: string; readonly error?: string }
function normalizeCandidate(candidate: SecurityIdentityCandidate): NormalizedCandidate {
  let name = clean(candidate.name)
  let symbol = clean(candidate.symbol)?.toUpperCase()
  let exchange = clean(candidate.exchange)?.toUpperCase()
  const combined = name?.match(/^(.*?)\s*[（(]?\s*(\d{6})\.(SSE|SH|SZSE|SZ|BSE|BJ)\s*[）)]?$/iu)
  if (combined) { name = clean(combined[1]); symbol = combined[2]; exchange = combined[3] }
  const bareSuffix = symbol?.match(/^(\d{6})\.(SSE|SH|SZSE|SZ|BSE|BJ)$/iu)
  if (bareSuffix) { symbol = bareSuffix[1]; exchange = bareSuffix[2] }
  const inferred = symbol === undefined ? undefined : inferExchange(symbol)
  if (exchange !== undefined) {
    try { exchange = normalizeExchange(exchange) } catch { return { error: 'The supplied exchange is not recognized.' } }
  } else if (inferred !== undefined) exchange = inferred
  if (exchange !== undefined && !['SH', 'SZ', 'BJ'].includes(exchange)) return { error: 'The supplied exchange is not a supported A-share exchange.' }
  if (symbol !== undefined && !/^\d{6}$/u.test(symbol)) return { error: 'The supplied security code must contain exactly six digits.' }
  if (!name && !symbol) name = extractNameCandidate(candidate.query)
  if (!name && !symbol) return { error: 'Provide an exact company name or six-digit security code to verify.' }
  return { ...(name ? { name } : {}), ...(symbol ? { symbol } : {}), ...(exchange ? { exchange } : {}) }
}

function clean(value: string | undefined): string | undefined { const result = value?.normalize('NFKC').trim().replace(/\s+/gu, ' '); return result || undefined }
function norm(value: string): string { return value.normalize('NFKC').replace(/[\s·•]/gu, '').toLocaleLowerCase('zh-CN') }
function inferExchange(symbol: string): 'SH' | 'SZ' | 'BJ' | undefined { if (symbol.startsWith('6')) return 'SH'; if (symbol.startsWith('0') || symbol.startsWith('3')) return 'SZ'; if (symbol.startsWith('4') || symbol.startsWith('8')) return 'BJ'; return undefined }

function extractNameCandidate(query: string | undefined): string | undefined {
  if (!query) return undefined
  let value = query.normalize('NFKC').trim()
  value = value.replace(/(?:请问|请帮我|帮我|请|分析一下|分析|研究一下|研究|看看|评估一下|评估)/gu, ' ')
  value = value.replace(/(?:当前|目前|现在|最近|的)?(?:估值水平|估值|市盈率|市净率|业绩表现|业绩|经营情况|发展情况|投资价值|怎么样|如何|是多少|吗|呢|？|\?)+/gu, ' ')
  value = value.replace(/[，。！？；：,!?;:\s]+/gu, ' ').trim()
  if (value.length < 2 || value.length > 80 || /\d{6}/u.test(value)) return undefined
  return value
}

function asCanonicalCompany(value: Readonly<Record<string, unknown>>, asOf: string): CanonicalCompany | undefined {
  if (value.type !== 'company' || typeof value.id !== 'string' || typeof value.ticker !== 'string' || typeof value.exchange !== 'string' || typeof value.name !== 'string') return undefined
  const aliases = Array.isArray(value.aliases) ? value.aliases.filter((item): item is string => typeof item === 'string') : []
  const lifecycle = typeof value.lifecycle === 'object' && value.lifecycle !== null ? value.lifecycle as Record<string, unknown> : undefined
  const active = lifecycle?.status === 'active'
    && !(typeof lifecycle.validFrom === 'string' && Date.parse(lifecycle.validFrom) > Date.parse(asOf))
    && !(typeof lifecycle.validUntil === 'string' && Date.parse(lifecycle.validUntil) <= Date.parse(asOf))
    && value.status !== 'superseded' && value.state !== 'superseded'
  return { id: value.id, ticker: value.ticker, exchange: value.exchange, name: value.name, aliases, active, value }
}

function canonicalIdentityValidAt(value: Readonly<Record<string, unknown>>, asOf: Date): boolean {
  const from = value.securityIdentityValidFrom, until = value.securityIdentityValidUntil
  if (typeof from !== 'string' || !Number.isFinite(Date.parse(from))) return false
  if (Date.parse(from) > asOf.getTime()) return false
  return until === undefined || (typeof until === 'string' && Number.isFinite(Date.parse(until)) && Date.parse(until) > asOf.getTime())
}

function matchesCanonical(company: CanonicalCompany, query: NormalizedCandidate, includeInactive = false): boolean {
  if (!includeInactive && !company.active) return false
  if (query.symbol !== undefined && company.ticker !== query.symbol) return false
  if (query.exchange !== undefined && normalizeExchange(company.exchange) !== query.exchange) return false
  if (query.name !== undefined && ![company.name, ...company.aliases].some((item) => norm(item) === norm(query.name!))) return false
  return query.symbol !== undefined || query.name !== undefined
}

function matchesCanonicalName(company: CanonicalCompany, name: string): boolean {
  return [company.name, ...company.aliases].some((item) => norm(item) === norm(name))
}

function parseDirectoryRow(value: unknown): DirectoryRow | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const row = value as Record<string, unknown>
  const symbol = clean(typeof row.symbol === 'string' ? row.symbol : typeof row.code === 'string' ? row.code : typeof row.ticker === 'string' ? row.ticker : undefined)
  const name = clean(typeof row.name === 'string' ? row.name : typeof row.securityName === 'string' ? row.securityName : undefined)
  const rawExchange = clean(typeof row.exchange === 'string' ? row.exchange : undefined)
  if (!symbol || !/^\d{6}$/u.test(symbol) || !name) return undefined
  let exchange: string | undefined
  try { exchange = rawExchange === undefined ? inferExchange(symbol) : normalizeExchange(rawExchange) } catch { return undefined }
  if (exchange !== 'SH' && exchange !== 'SZ' && exchange !== 'BJ') return undefined
  return { symbol, name, exchange }
}

function matchesDirectory(row: DirectoryRow, query: NormalizedCandidate): boolean {
  if (query.symbol !== undefined && row.symbol !== query.symbol) return false
  if (query.exchange !== undefined && row.exchange !== query.exchange) return false
  if (query.name !== undefined && norm(row.name) !== norm(query.name)) return false
  return query.symbol !== undefined || query.name !== undefined
}

function failure(status: Extract<SecurityIdentityResolution['status'], 'UNRESOLVED' | 'AMBIGUOUS' | 'CONFLICT' | 'HISTORICAL_IDENTITY_UNAVAILABLE'>, reason: string, candidateSymbols: readonly string[] = [], diagnostics: readonly string[] = []): SecurityIdentityResolution {
  return { status, reason, candidateSymbols, diagnostics }
}
