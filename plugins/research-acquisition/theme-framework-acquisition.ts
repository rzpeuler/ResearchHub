import { KnowledgeBaseRegistry } from '../../knowledge/registry/registry.ts'
import type { KnowledgeBaseHandle } from '../../knowledge/storage/handle.ts'
import { readCanonicalV04Assets } from '../../knowledge/storage/canonical-v04-loader.ts'
import { verifyRaw } from '../../knowledge/raw/raw-archive.ts'
import { RawDocumentKnowledgeGatewayV04, type RawDocumentGatewayV04Result } from '../../knowledge/production/raw-document-gateway-v04.ts'
import type { KnowledgeSourceV04 } from '../../knowledge/schema/domain-v04.ts'
import type {
  ThemeFrameworkAcquisitionPort,
  ThemeFrameworkAcquisitionResult,
  ThemeFrameworkDurableEvidenceBinding,
} from '../../workflows/theme-framework-construction/contracts.ts'
import type { ThemeFrameworkInput } from '../../skills/theme-framework/contracts.ts'
import { IndustryAcquisitionComposition } from './industry-composition.ts'
import { sha256 } from './hash.ts'
import type { NormalizedResearchSource, ResearchAcquisitionPlugin } from './contracts.ts'

export const THEME_FRAMEWORK_ACQUISITION_MAX_SOURCES = 8
const MAX_CANDIDATES_PER_PROVIDER = 4
const MAX_RAW_DOCUMENT_BYTES = 8 * 1024 * 1024
const MAX_EVIDENCE_EXCERPT = 240
const MAX_THEME_SEARCH_TERMS = 8
const THEME_CHAIN_FACETS_ZH = ['产业链', '上游', '下游', '基础设施', '设备', '材料', '核心环节'] as const
const THEME_CHAIN_FACETS_EN = ['value chain', 'upstream', 'downstream', 'infrastructure', 'equipment', 'materials', 'key segments'] as const
const AI_COMPUTE_THEME_NAMES = new Set(['ai算力', '人工智能算力', 'aicompute', 'artificialintelligencecompute'])
const AI_COMPUTE_QUERY_ALIASES = ['人工智能算力', 'AI服务器', 'AI芯片', '智算中心', 'AI数据中心', '算力网络', '算力基础设施', '先进封装'] as const
const AI_COMPUTE_TITLE_ALIASES = ['人工智能算力', 'AI服务器', 'AI芯片', '智算中心', 'AI数据中心', '算力网络', '算力基础设施'] as const
const SUPPORTED_MEDIA_TYPES = new Set(['application/pdf', 'text/html', 'application/xhtml+xml'])
const TRACKING_PARAMS = new Set(['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'from', 'spm', 'share'])

export interface ThemeFrameworkRawGatewayPort {
  submit(input: Parameters<RawDocumentKnowledgeGatewayV04['submit']>[0]): Promise<RawDocumentGatewayV04Result>
}

export interface ThemeFrameworkAcquisitionOptions {
  readonly knowledgeBaseRoot: string
  readonly plugins: readonly ResearchAcquisitionPlugin[]
  readonly registry?: KnowledgeBaseRegistry
  readonly rawGateway?: ThemeFrameworkRawGatewayPort
  readonly clock?: () => string
}

function isAborted(signal?: AbortSignal): boolean { return signal?.aborted === true }
function normalizedMediaType(value: string | undefined): string | undefined {
  if (!value) return undefined
  const mediaType = value.split(';')[0]!.trim().toLowerCase()
  return SUPPORTED_MEDIA_TYPES.has(mediaType) ? mediaType : undefined
}
function hasPdfSignature(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 5 && new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-'
}
function hasHtmlSignature(bytes: Uint8Array): boolean {
  try {
    const prefix = new TextDecoder('utf-8', { fatal: true }).decode(bytes.slice(0, Math.min(bytes.byteLength, 4096))).replace(/^\uFEFF/u, '').trimStart()
    return /^(?:<\?xml\b[\s\S]{0,512}?\?>\s*)?(?:<!doctype\s+html\b|<html\b)/iu.test(prefix)
  } catch { return false }
}
function rawRepresentation(source: NormalizedResearchSource): { readonly bytes: Uint8Array; readonly mediaType: string; readonly filename: string } | undefined {
  const bytes = source.rawBytes
  const mediaType = normalizedMediaType(source.mediaType)
  if (!bytes?.byteLength || bytes.byteLength > MAX_RAW_DOCUMENT_BYTES || !mediaType) return undefined
  const pdf = hasPdfSignature(bytes)
  const html = !pdf && hasHtmlSignature(bytes)
  if (mediaType === 'application/pdf' && pdf) return { bytes, mediaType, filename: 'theme-evidence.pdf' }
  if ((mediaType === 'text/html' || mediaType === 'application/xhtml+xml') && html) return { bytes, mediaType, filename: 'theme-evidence.html' }
  return undefined
}
function canonicalUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) return undefined
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) if (TRACKING_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key)
    return url.toString()
  } catch { return undefined }
}
function sourceTitle(source: NormalizedResearchSource): string {
  return source.title.trim().slice(0, 500) || source.candidate.title.slice(0, 500)
}
function titleTerms(value: string): { readonly latin: ReadonlySet<string>; readonly cjk: readonly string[] } {
  const normalized = value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const latin = new Set((normalized.match(/[\p{Script=Latin}\p{N}]+/gu) ?? []).filter((term) => Array.from(term).length >= 2))
  const cjkRuns = normalized.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu) ?? []
  const cjk = cjkRuns.flatMap((run) => {
    const chars = Array.from(run)
    if (chars.length === 2) return [run]
    if (chars.length < 3) return []
    return Array.from({ length: chars.length - 2 }, (_, index) => chars.slice(index, index + 3).join(''))
  })
  return { latin, cjk }
}
function titleMatchesTerms(title: string, terms: readonly string[]): boolean {
  const candidate = titleTerms(title)
  return terms.some((term) => {
    const match = titleTerms(term)
    return [...match.latin].some((value) => candidate.latin.has(value))
      || match.cjk.some((value) => candidate.cjk.some((candidateTerm) => candidateTerm.includes(value) || value.includes(candidateTerm)))
  })
}
function titleMatchesTheme(title: string, themeName: string, aliases: readonly string[] = []): boolean {
  const theme = titleTerms(themeName)
  if (theme.latin.size === 0 && theme.cjk.length === 0) return false
  const anchors = [themeName, ...aliases]
  const candidate = titleTerms(title)
  // Latin terms are matched as complete title tokens; CJK terms use meaningful
  // two-character names or overlapping trigrams from longer theme compounds.
  return [...theme.latin].some((term) => candidate.latin.has(term))
    || theme.cjk.some((term) => candidate.cjk.some((candidateTerm) => candidateTerm.includes(term) || term.includes(candidateTerm)))
    || titleMatchesTerms(title, anchors.slice(1))
}
function themeAcquisitionPlan(themeName: string, definition?: string): {
  readonly searchTerms: readonly string[]
  readonly queryAliases: readonly string[]
  readonly titleAliases: readonly string[]
} {
  const normalizedName = themeName.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
  const aiCompute = AI_COMPUTE_THEME_NAMES.has(normalizedName)
  const cjkTheme = titleTerms(themeName).cjk.length > 0
  const facets = (cjkTheme ? THEME_CHAIN_FACETS_ZH : THEME_CHAIN_FACETS_EN).map((facet) => `${themeName} ${facet}`)
  const definitionTerms = (definition?.match(/[^\s，,；;。！？!?]{2,}/gu) ?? []).map((term) => term.slice(0, 120))
  // Preserve user-supplied definition terms while retaining a bounded set of
  // broad chain facets. Name-only Theme creation still gets every facet.
  const searchTerms = definitionTerms.length > 0
    ? [themeName, ...definitionTerms.slice(0, 2), ...facets.slice(0, 5)]
    : [themeName, ...facets]
  return {
    searchTerms: [...new Set(searchTerms.map((term) => term.slice(0, 120)))].slice(0, MAX_THEME_SEARCH_TERMS),
    queryAliases: aiCompute ? AI_COMPUTE_QUERY_ALIASES : [],
    titleAliases: aiCompute ? AI_COMPUTE_TITLE_ALIASES : [],
  }
}
function eligibleRights(source: NormalizedResearchSource): boolean {
  const rights = source.rights
  return (rights.accessScope === 'public' || rights.accessScope === 'authenticated')
    && rights.retentionAllowed === true
    && rights.aiProcessingAllowed === true
    && rights.derivativeKnowledgeAllowed === true
    && typeof rights.policyBasis === 'string'
    && rights.policyBasis.trim().length > 0
}
function sourceKind(source: NormalizedResearchSource): 'official_disclosure' | 'industry_database' | 'professional_media' | 'general_media' | 'unknown' {
  switch (source.candidate.kind) {
    case 'official_disclosure': return 'official_disclosure'
    case 'structured_data': return 'industry_database'
    case 'news': return 'professional_media'
    case 'web_article': return 'general_media'
    default: return 'unknown'
  }
}
function runId(knowledgeBaseId: string, source: NormalizedResearchSource, contentHash: string): string {
  const identity = canonicalUrl(source.canonicalUrl ?? source.candidate.url) ?? contentHash
  return `theme-acq-${sha256(`${knowledgeBaseId}\n${identity}\n${contentHash}`).slice(0, 40)}`
}
function evidenceId(source: NormalizedResearchSource): string {
  const identity = canonicalUrl(source.canonicalUrl ?? source.candidate.url) ?? source.contentHash
  const version = source.rawBytes ? sha256(source.rawBytes) : source.contentHash
  return `external-${sha256(`${identity}\n${version}`).slice(0, 32)}`
}
function messageCode(result: RawDocumentGatewayV04Result): string {
  const errors = result.errors.map((error) => error.code).filter(Boolean).slice(0, 3)
  return `raw_gateway_${result.status.toLowerCase()}${errors.length ? `:${errors.join(',')}` : ''}`
}
function sourceReceipt(
  handle: KnowledgeBaseHandle,
  sourceRef: string,
  rawRef: string,
): Promise<{ readonly source: KnowledgeSourceV04; readonly rawRef: string } | undefined> {
  return (async () => {
    const collection = await readCanonicalV04Assets(handle.rootRef)
    const entry = collection.objects.find((item) => item.kind === 'source' && item.value.id === sourceRef)
    if (!entry || entry.kind !== 'source') return undefined
    const source = entry.value as KnowledgeSourceV04
    if (!source.rawRefs?.includes(rawRef as `raw-sha256-${string}`)) return undefined
    await verifyRaw(handle, rawRef)
    return { source, rawRef }
  })()
}

/** Acquires a small evidence set through existing research plugins and persists eligible documents through the Raw Gateway. */
export class ThemeFrameworkAcquisitionAdapter implements ThemeFrameworkAcquisitionPort {
  private readonly registry: KnowledgeBaseRegistry
  private readonly gateway: ThemeFrameworkRawGatewayPort
  private readonly clock: () => string

  constructor(private readonly options: ThemeFrameworkAcquisitionOptions) {
    this.registry = options.registry ?? new KnowledgeBaseRegistry()
    this.gateway = options.rawGateway ?? new RawDocumentKnowledgeGatewayV04({ registry: this.registry, ...(options.clock ? { clock: options.clock } : {}) })
    this.clock = options.clock ?? (() => new Date().toISOString())
  }

  async acquire(input: Parameters<ThemeFrameworkAcquisitionPort['acquire']>[0]): Promise<ThemeFrameworkAcquisitionResult> {
    const requestedBudget = Number.isSafeInteger(input.maxSources) ? Math.max(0, input.maxSources) : 0
    const budget = Math.min(THEME_FRAMEWORK_ACQUISITION_MAX_SOURCES, requestedBudget)
    if (!budget) return { status: 'unavailable', reason: 'source_budget_exhausted', diagnostics: ['source_budget_zero'] }
    if (isAborted(input.signal)) return { status: 'unavailable', reason: 'acquisition_cancelled', diagnostics: ['acquisition_cancelled_before_discovery'] }

    let handle: KnowledgeBaseHandle
    try {
      handle = await this.registry.mount(this.options.knowledgeBaseRoot)
      if (handle.knowledgeBaseId !== input.knowledgeBaseId || handle.schemaVersion !== '0.4' || handle.storageFormatVersion !== '1' || !handle.writable || handle.status !== 'active') {
        return { status: 'unavailable', reason: 'knowledge_base_identity_or_version_mismatch', diagnostics: ['acquisition_kb_incompatible'] }
      }
      if (handle.revision !== input.knowledgeBaseRevision) return { status: 'unavailable', reason: 'knowledge_base_revision_stale', diagnostics: ['acquisition_snapshot_revision_stale'] }
    } catch {
      return { status: 'unavailable', reason: 'knowledge_base_unavailable', diagnostics: ['acquisition_kb_unavailable'] }
    }

    const themeName = input.themeName.normalize('NFKC').trim().replace(/\s+/gu, ' ')
    const searchPlan = themeAcquisitionPlan(themeName, input.definition)
    const target = { name: themeName, aliases: searchPlan.queryAliases, searchTerms: searchPlan.searchTerms, asOf: this.clock() }
    const composition = new IndustryAcquisitionComposition(this.options.plugins, MAX_CANDIDATES_PER_PROVIDER, budget)
    let acquired: Awaited<ReturnType<IndustryAcquisitionComposition['acquire']>>
    try {
      acquired = await composition.acquire({ target, wave: 1, design: {} as never, gaps: [], searchTerms: searchPlan.searchTerms }, { signal: input.signal })
    } catch {
      return { status: 'unavailable', reason: 'industry_acquisition_failed', diagnostics: ['industry_composition_failed'] }
    }
    const diagnostics = [...acquired.diagnostics]
    if (isAborted(input.signal)) return { status: 'unavailable', reason: 'acquisition_cancelled', diagnostics: [...diagnostics, 'acquisition_cancelled_after_discovery'] }

    const evidence: ThemeFrameworkInput['evidence'][number][] = []
    const bindings: ThemeFrameworkDurableEvidenceBinding[] = []
    const durableSourcesByProvider = new Map<string, number>()
    const seen = new Set<string>()
    let expectedRevision = input.knowledgeBaseRevision
    const sources = acquired.sources.slice(0, budget)
    if (acquired.sources.length > sources.length) diagnostics.push(`source_budget_truncated:${acquired.sources.length}:${sources.length}`)
    for (const source of sources) {
      if (isAborted(input.signal)) {
        diagnostics.push('acquisition_cancelled_before_next_persistence')
        break
      }
      const title = sourceTitle(source)
      if (!titleMatchesTheme(title, themeName, searchPlan.titleAliases)) { diagnostics.push(`source_rejected_title_relevance:${source.candidate.provider}`); continue }
      const representation = rawRepresentation(source)
      if (!representation) { diagnostics.push(`source_rejected_raw_representation:${source.candidate.provider}`); continue }
      if (!eligibleRights(source)) { diagnostics.push(`source_rejected_rights:${source.candidate.provider}`); continue }
      const url = canonicalUrl(source.canonicalUrl ?? source.candidate.url)
      const contentHash = sha256(representation.bytes)
      const dedupeKey = url ? `url:${url}` : `hash:${contentHash}`
      if (seen.has(dedupeKey)) { diagnostics.push('source_duplicate_skipped'); continue }
      seen.add(dedupeKey)

      try {
        handle = await this.registry.refresh(this.options.knowledgeBaseRoot)
        if (handle.knowledgeBaseId !== input.knowledgeBaseId || handle.schemaVersion !== '0.4' || handle.storageFormatVersion !== '1' || !handle.writable || handle.status !== 'active') {
          diagnostics.push('source_persistence_kb_changed')
          break
        }
        if (handle.revision !== expectedRevision) {
          diagnostics.push('source_persistence_revision_stale')
          break
        }
      } catch {
        diagnostics.push('source_persistence_kb_refresh_failed')
        break
      }
      let rawResult: RawDocumentGatewayV04Result
      try { rawResult = await this.gateway.submit({
        handle,
        workflowRunId: runId(input.knowledgeBaseId, source, contentHash),
        bytes: representation.bytes,
        filename: representation.filename,
        mediaType: representation.mediaType,
        source: {
          title,
          sourceType: sourceKind(source),
          sourceReliability: source.candidate.tier <= 2 ? 'high' : source.candidate.tier === 3 ? 'medium' : 'low',
          publisher: source.publisher,
          publishedAt: source.candidate.publishedAt ?? null,
          canonicalUrl: url ?? null,
        },
        rights: {
          accessScope: source.rights.accessScope,
          // Unknown is represented honestly; no plugin field means false.
          providerTermsKnown: source.rights.providerTermsKnown === true,
          retentionAllowed: source.rights.retentionAllowed === true,
          aiProcessingAllowed: source.rights.aiProcessingAllowed === true,
          derivativeKnowledgeAllowed: source.rights.derivativeKnowledgeAllowed === true,
          redistributionAllowed: source.rights.redistributionAllowed === true,
          policyBasis: source.rights.policyBasis!.trim(),
        },
      }) } catch {
        diagnostics.push('source_persistence_failed:gateway_exception')
        continue
      }
      const replayedCommit = rawResult.status === 'already_committed'
      if (!['committed', 'already_committed', 'no_changes'].includes(rawResult.status) || !rawResult.sourceRef || !rawResult.rawRef || (!replayedCommit && rawResult.baseRevision !== handle.revision)) {
        diagnostics.push(`source_persistence_failed:${messageCode(rawResult)}`)
        continue
      }
      try {
        handle = await this.registry.refresh(this.options.knowledgeBaseRoot)
        if (handle.knowledgeBaseId !== input.knowledgeBaseId || (replayedCommit ? handle.revision < rawResult.knowledgeBaseRevision : handle.revision !== rawResult.knowledgeBaseRevision)) {
          diagnostics.push('source_persistence_revision_mismatch')
          continue
        }
        const receipt = await sourceReceipt(handle, rawResult.sourceRef, rawResult.rawRef)
        if (!receipt || receipt.source.rights.retentionAllowed !== true || receipt.source.rights.aiProcessingAllowed !== true || receipt.source.rights.derivativeKnowledgeAllowed !== true) {
          diagnostics.push('source_persistence_receipt_invalid')
          continue
        }
      } catch {
        diagnostics.push('source_persistence_receipt_unavailable')
        continue
      }
      expectedRevision = handle.revision

      const id = evidenceId(source)
      const excerpt = source.content.normalize('NFKC').replace(/\s+/gu, ' ').trim().slice(0, MAX_EVIDENCE_EXCERPT)
      evidence.push({
        evidenceId: id,
        origin: 'external',
        description: excerpt ? `${title}: ${excerpt}`.slice(0, 1200) : title,
        sourceRef: rawResult.sourceRef,
        ...(source.candidate.publishedAt ? { publishedAt: source.candidate.publishedAt } : {}),
        ...(excerpt ? { excerpt } : {}),
      })
      const locator = source.candidate.metadata?.locator
      bindings.push({ evidenceId: id, sourceRef: rawResult.sourceRef, rawRef: rawResult.rawRef, ...(typeof locator === 'string' && locator.trim() ? { locator: locator.slice(0, 2048) } : {}) })
      const provider = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(source.candidate.provider) ? source.candidate.provider : 'unknown-provider'
      durableSourcesByProvider.set(provider, (durableSourcesByProvider.get(provider) ?? 0) + 1)
    }

    const hasAcquisitionWarnings = diagnostics.length > 0
    for (const [provider, count] of [...durableSourcesByProvider].sort(([left], [right]) => left.localeCompare(right))) {
      diagnostics.push(`theme_acquisition_durable_sources:${provider}:${count}`)
    }

    if (evidence.length === 0) {
      return { status: 'unavailable', reason: isAborted(input.signal) ? 'acquisition_cancelled' : 'no_eligible_durable_sources', diagnostics: diagnostics.slice(0, 32) }
    }
    return {
      status: evidence.length === sources.length && !hasAcquisitionWarnings ? 'available' : 'partial',
      evidence,
      durableEvidenceBindings: bindings,
      diagnostics: diagnostics.slice(0, 32),
    }
  }
}
