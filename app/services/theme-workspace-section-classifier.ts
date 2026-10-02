import { hashKnowledgeObject } from '../../knowledge/storage/canonical-hash.ts'
import { INDUSTRY_MODULES } from '../../skills/industry-research/contracts.ts'
import { COMPANY_RESEARCH_SECTIONS } from '../../skills/company-research/skill.ts'
import type { ReasoningExecutor } from '../../plugins/reasoning/contracts.ts'
import type { ThemeWorkspaceFact } from './theme-workspace-projection-contracts.ts'

export type ThemeWorkspaceSectionTaxonomy = 'industry' | 'company'
export interface ThemeWorkspaceSectionDefinition { readonly id: string; readonly title: string }
export interface ThemeWorkspaceSectionClassification {
  readonly status: 'classified' | 'partial' | 'llm_unavailable' | 'llm_failed' | 'invalid_output' | 'bounded_fallback'
  readonly method: 'reasoning_executor' | 'deterministic_fallback' | 'not_needed'
  readonly revision: number
  readonly classifiedCount: number
  readonly unclassifiedCount: number
  readonly reason?: string
}
export interface ThemeWorkspaceClassifiedFacts {
  readonly taxonomy: ThemeWorkspaceSectionTaxonomy
  readonly sectionCatalog: readonly ThemeWorkspaceSectionDefinition[]
  readonly factsBySection: Readonly<Record<string, readonly ThemeWorkspaceFact[]>>
  readonly unclassifiedFacts: readonly ThemeWorkspaceFact[]
  readonly classification: ThemeWorkspaceSectionClassification
}

export interface ThemeWorkspaceClassifierInput {
  readonly knowledgeBaseId: string
  readonly revision: number
  readonly scopeRef: string
  readonly taxonomy: ThemeWorkspaceSectionTaxonomy
  /** Already source-rights-filtered facts. */
  readonly facts: readonly ThemeWorkspaceFact[]
}

interface CacheEntry {
  readonly assignments: Readonly<Record<string, string>>
  readonly status: ThemeWorkspaceSectionClassification['status']
  readonly method: ThemeWorkspaceSectionClassification['method']
  readonly reason?: string
}

const INDUSTRY_CATALOG: readonly ThemeWorkspaceSectionDefinition[] = INDUSTRY_MODULES.map((id) => ({ id, title: titleCase(id) }))
const COMPANY_CATALOG: readonly ThemeWorkspaceSectionDefinition[] = COMPANY_RESEARCH_SECTIONS.map((title) => ({ id: sectionId(title), title }))
const MAX_FACTS = 120
const MAX_FACT_TEXT = 1000
const MAX_CLASSIFICATION_INPUT_BYTES = 64_000
const MAX_ASSIGNMENT_BYTES = 128_000
const MAX_CACHE_ENTRIES = 128
const CLASSIFICATION_TIMEOUT_MS = 8_000

function titleCase(value: string): string { return value.split('_').map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' ') }
function sectionId(title: string): string { return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') }
function parseOutput(output: unknown): unknown {
  if (typeof output !== 'string') return output
  return JSON.parse(output.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) as unknown
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }

function deterministicSection(taxonomy: ThemeWorkspaceSectionTaxonomy, fact: ThemeWorkspaceFact): string | undefined {
  if (taxonomy === 'industry') {
    if (fact.semanticType === 'risk') return 'risk_analysis'
    if (fact.semanticType === 'forecast') return 'market_size_growth'
    return undefined
  }
  if (fact.semanticType === 'risk') return 'risks'
  if (fact.semanticType === 'thesis') return 'investment-thesis'
  if (fact.semanticType === 'catalyst') return 'catalysts'
  return undefined
}

function fallbackAssignments(input: ThemeWorkspaceClassifierInput, allowed: ReadonlySet<string>): Record<string, string> {
  const assignments: Record<string, string> = Object.create(null) as Record<string, string>
  for (const fact of input.facts) {
    const section = deterministicSection(input.taxonomy, fact)
    if (section && allowed.has(section)) assignments[fact.ref] = section
  }
  return assignments
}

function validateAssignments(output: unknown, facts: readonly ThemeWorkspaceFact[], allowed: ReadonlySet<string>): Record<string, string> | undefined {
  let parsed: unknown
  try { parsed = parseOutput(output) } catch { return undefined }
  if (!isRecord(parsed) || Object.keys(parsed).some((key) => key !== 'assignments') || !Array.isArray(parsed.assignments) || Buffer.byteLength(JSON.stringify(parsed), 'utf8') > MAX_ASSIGNMENT_BYTES) return undefined
  const knownFacts = new Set(facts.map((fact) => fact.ref))
  if (knownFacts.size !== facts.length) return undefined
  const assigned = new Map<string, string>()
  for (const item of parsed.assignments) {
    if (!isRecord(item) || Object.keys(item).length !== 2 || typeof item.factRef !== 'string' || typeof item.sectionId !== 'string') return undefined
    if (!knownFacts.has(item.factRef) || !allowed.has(item.sectionId) || assigned.has(item.factRef)) return undefined
    assigned.set(item.factRef, item.sectionId)
  }
  return Object.fromEntries(assigned)
}

/** Read-only, revision-bound classifier with conservative deterministic fallback. */
export class ThemeWorkspaceSectionClassifier {
  private readonly cache = new Map<string, CacheEntry>()
  private readonly inFlight = new Map<string, Promise<CacheEntry>>()

  constructor(private readonly executor?: ReasoningExecutor) {}

  async classify(input: ThemeWorkspaceClassifierInput): Promise<ThemeWorkspaceClassifiedFacts> {
    const catalog = input.taxonomy === 'industry' ? INDUSTRY_CATALOG : COMPANY_CATALOG
    const allowed = new Set(catalog.map((section) => section.id))
    const key = hashKnowledgeObject({
      knowledgeBaseId: input.knowledgeBaseId,
      revision: input.revision,
      scopeRef: input.scopeRef,
      taxonomy: input.taxonomy,
      facts: input.facts,
    })
    let resolved = this.cache.get(key)
    if (resolved) {
      this.cache.delete(key)
      this.cache.set(key, resolved)
    } else {
      let pending = this.inFlight.get(key)
      if (!pending) {
        pending = this.classifyAndCache(input, allowed).then((entry) => {
          this.cache.set(key, entry)
          this.pruneCompletedCache()
          return entry
        }).finally(() => this.inFlight.delete(key))
        this.inFlight.set(key, pending)
      }
      resolved = await pending
    }
    const byRef = new Map(input.facts.map((fact) => [fact.ref, fact]))
    const factsBySection: Record<string, ThemeWorkspaceFact[]> = Object.create(null) as Record<string, ThemeWorkspaceFact[]>
    for (const section of catalog) factsBySection[section.id] = []
    const classifiedRefs = new Set<string>()
    for (const [factRef, sectionIdValue] of Object.entries(resolved.assignments)) {
      const fact = byRef.get(factRef)
      if (!fact || !allowed.has(sectionIdValue) || classifiedRefs.has(factRef)) continue
      factsBySection[sectionIdValue]!.push(fact)
      classifiedRefs.add(factRef)
    }
    const unclassifiedFacts = input.facts.filter((fact) => !classifiedRefs.has(fact.ref))
    const status = input.facts.length === 0 ? 'classified' : resolved.status === 'classified' && unclassifiedFacts.length > 0 ? 'partial' : resolved.status
    const method = input.facts.length === 0 ? 'not_needed' : resolved.method
    return {
      taxonomy: input.taxonomy,
      sectionCatalog: catalog,
      factsBySection,
      unclassifiedFacts,
      classification: {
        status,
        method,
        revision: input.revision,
        classifiedCount: classifiedRefs.size,
        unclassifiedCount: unclassifiedFacts.length,
        ...(resolved.reason === undefined ? {} : { reason: resolved.reason }),
      },
    }
  }

  private pruneCompletedCache(): void {
    while (this.cache.size > MAX_CACHE_ENTRIES) this.cache.delete(this.cache.keys().next().value as string)
  }

  private async classifyAndCache(input: ThemeWorkspaceClassifierInput, allowed: ReadonlySet<string>): Promise<CacheEntry> {
    const fallback = () => fallbackAssignments(input, allowed)
    if (input.facts.length === 0) return { assignments: {}, status: 'classified', method: 'not_needed' }
    const deterministic = fallback()
    const pendingFacts = input.facts.filter((fact) => deterministic[fact.ref] === undefined)
    if (pendingFacts.length === 0) return { assignments: deterministic, status: 'classified', method: 'deterministic_fallback' }
    if (!this.executor) return { assignments: deterministic, status: 'llm_unavailable', method: 'deterministic_fallback', reason: 'No ReasoningExecutor is configured; conservative deterministic section mapping was used.' }
    if (pendingFacts.length > MAX_FACTS) return { assignments: deterministic, status: 'bounded_fallback', method: 'deterministic_fallback', reason: `Classification is bounded to ${MAX_FACTS} unresolved facts per projection.` }
    const boundedFacts = pendingFacts.map((fact) => ({ factRef: fact.ref, kind: fact.kind, semanticType: fact.semanticType, title: fact.title.slice(0, MAX_FACT_TEXT), ...(fact.statement === undefined ? {} : { statement: fact.statement.slice(0, MAX_FACT_TEXT) }), ...(fact.unit === undefined ? {} : { unit: fact.unit }), ...(fact.period === undefined ? {} : { period: fact.period }) }))
    const requestInput = {
      projectionScope: input.scopeRef,
      taxonomy: input.taxonomy,
      sections: input.taxonomy === 'industry' ? INDUSTRY_CATALOG : COMPANY_CATALOG,
      facts: boundedFacts,
    }
    if (Buffer.byteLength(JSON.stringify(requestInput), 'utf8') > MAX_CLASSIFICATION_INPUT_BYTES) return { assignments: deterministic, status: 'bounded_fallback', method: 'deterministic_fallback', reason: `Classification input is bounded to ${MAX_CLASSIFICATION_INPUT_BYTES} bytes.` }
    try {
      const controller = new AbortController()
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          controller.abort()
          reject(new Error('classification timeout'))
        }, CLASSIFICATION_TIMEOUT_MS)
      })
      const result = await Promise.race([this.executor.execute({
        operation: 'theme_workspace_section_classification',
        instruction: 'Classify each supplied canonical fact into at most one supplied reading section. Use only explicit semantic content and the supplied section names. Omit unclear facts; they remain visible as unclassified. Return exactly {"assignments":[{"factRef":"...","sectionId":"..."}]}. Do not summarize, invent facts, alter references, or emit additional keys.',
        input: requestInput,
        outputContract: { assignments: 'array of unique { factRef, sectionId }; every ref and section must be supplied; omit unclear facts' },
        metadata: { operationFamily: 'theme-workspace-read-projection', knowledgeBaseId: input.knowledgeBaseId, knowledgeBaseRevision: String(input.revision), projectionScope: input.scopeRef, taxonomy: input.taxonomy },
      }, controller.signal), timeout]).finally(() => { if (timeoutHandle !== undefined) clearTimeout(timeoutHandle) })
      const assignments = validateAssignments(result.output, pendingFacts, allowed)
      if (!assignments) return { assignments: deterministic, status: 'invalid_output', method: 'deterministic_fallback', reason: 'ReasoningExecutor returned an invalid factRef/sectionId mapping; conservative deterministic mapping was used.' }
      return { assignments: { ...deterministic, ...assignments }, status: 'classified', method: 'reasoning_executor' }
    } catch (error) {
      // Keep provider/runtime details out of the projection response.
      void error
      return { assignments: deterministic, status: 'llm_failed', method: 'deterministic_fallback', reason: 'ReasoningExecutor classification failed or timed out; conservative deterministic mapping was used.' }
    }
  }
}
