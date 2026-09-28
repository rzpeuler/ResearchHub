import { dirname, join, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { KnowledgeBaseRegistry } from '../../knowledge/registry/registry.ts'
import { KnowledgeProductionGateway } from '../../knowledge/production/gateway.ts'
import type { KnowledgeProductionInput, SemanticProductionInputProposal } from '../../knowledge/production/contracts.ts'
import { verifyRaw } from '../../knowledge/raw/raw-archive.ts'
import type { KillCriterionV04, KnowledgeAssetV04, KnowledgeClaimV04, KnowledgeObservationV04, KnowledgeSourceV04, KnowledgeThesisV04 } from '../../knowledge/schema/domain-v04.ts'
import { readCanonicalV04Assets } from '../../knowledge/storage/canonical-v04-loader.ts'
import { hashKnowledgeObject } from '../../knowledge/storage/canonical-hash.ts'
import type { KnowledgeAssetCollectionV04 } from '../../knowledge/storage/v04-types.ts'
import type { KnowledgeBaseHandle } from '../../knowledge/storage/handle.ts'
import { allocateKnowledgeId, normalizeSemanticText } from '../../knowledge/registry/id-allocation.ts'
import { executeThesisRefresh } from '../../skills/thesis_refresh/semantic.ts'
import type { RefreshEvidenceCandidate, RefreshEvidenceRelation, ThesisRefreshResult } from '../../skills/thesis_refresh/contracts.ts'
import { runThesisRefreshAdapter, type ThesisRefreshEvidenceBinding } from '../../workflows/thesis-lifecycle/refresh-adapter.ts'
import { buildThesisRefreshReviewCases } from '../../workflows/thesis-lifecycle/review-case-builder.ts'
import type { KillCriterionReviewBindingV1, ReviewCase } from '../../knowledge/review/contracts.ts'
import { listReviewCases, persistReviewCases } from '../../knowledge/review/store.ts'
import { ApplicationServiceError, type TerminalWorkflowStatus } from './contracts.ts'
import { WorkflowService, type WorkflowOutcome } from './workflow-service.ts'
import { readResearchReport, renderResearchReport, validateResearchReport, type ResearchReport } from './research-report.ts'
import type { ReasoningExecutor } from '../../plugins/reasoning/contracts.ts'

export interface ThesisLifecycleRefreshInput {
  readonly thesisRef: string
  readonly asOf: string
  readonly evidenceRefs?: readonly string[]
  readonly runId?: string
}

export interface ThesisRefreshEvidenceDecision {
  readonly evidenceRef: string
  readonly decision: 'included' | 'excluded'
  readonly reason?: string
  readonly publishedAt?: string
  readonly relation?: RefreshEvidenceRelation
  readonly targetClaimRefs?: readonly string[]
  readonly sourceBindings: readonly { readonly sourceRef: string; readonly rawRef: string }[]
}

export interface ApplicationThesisLifecycleResult extends WorkflowOutcome {
  readonly runId: string
  readonly status: TerminalWorkflowStatus
  readonly thesisRef: string
  readonly knowledgeBaseId?: string
  readonly knowledgeBaseRevision?: number
  readonly reportId?: string
  readonly reportPath?: string
  readonly reviewCaseIds: readonly string[]
  readonly refresh?: ThesisRefreshResult
  readonly evidenceDecisions: readonly ThesisRefreshEvidenceDecision[]
  readonly diagnostics: readonly string[]
  readonly autoSafeWriterRunId?: string
  readonly autoSafeClaimRefs?: readonly string[]
  readonly decisionState?: 'ACCEPTED' | 'REJECTED' | 'DEFERRED' | 'STALE'
  readonly writerRunId?: string
  readonly committedRevision?: number
}

export interface ThesisLifecycleServiceOptions {
  readonly mountedKnowledgeBaseRoot: string
  readonly reportRoot?: string
  readonly cwd?: string
  readonly workflowService: WorkflowService
  readonly reasoningExecutor?: ReasoningExecutor
}

export interface ThesisLifecycleDecisionReportInput {
  readonly producerRunId: string
  readonly reviewCaseId: string
  readonly decisionState: 'ACCEPTED' | 'REJECTED' | 'DEFERRED' | 'STALE'
  readonly knowledgeBaseRevision: number
  readonly committedRevision?: number
  readonly writerRunId?: string
  readonly diagnostics?: readonly string[]
}

export interface ThesisLifecycleDecisionReportResult {
  readonly status: 'updated' | 'not_found' | 'failed'
  readonly reportId: string
  readonly reportPath?: string
  readonly errors: readonly string[]
}

interface NormalizedInput { readonly thesisRef: string; readonly asOf: string; readonly evidenceRefs?: readonly string[] }
interface Candidate extends RefreshEvidenceCandidate { readonly sourceBindings: readonly { readonly sourceRef: string; readonly rawRef: string }[] }
interface CollectionResult { readonly candidates: readonly Candidate[]; readonly decisions: readonly ThesisRefreshEvidenceDecision[]; readonly diagnostics: readonly string[]; readonly explicitSelectionInvalid: boolean; readonly limitExceeded: boolean }

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/
const CANONICAL_EVIDENCE_REF = /^(observation|claim):[A-Za-z0-9][A-Za-z0-9._-]*$/
const validDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value))
const active = (asset: KnowledgeAssetV04): boolean => 'lifecycle' in asset && asset.lifecycle?.status === 'active'
const sortedUnique = (values: readonly string[]): string[] => [...new Set(values)].sort((a, b) => a.localeCompare(b))
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24)

function normalizeInput(value: ThesisLifecycleRefreshInput): NormalizedInput {
  if (!value || !/^thesis:[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value.thesisRef) || !validDate(value.asOf)) throw new ApplicationServiceError('invalid_input', 'thesisRef and ISO asOf are required')
  if (value.evidenceRefs !== undefined && (!Array.isArray(value.evidenceRefs) || value.evidenceRefs.length > 80 || value.evidenceRefs.some((ref) => typeof ref !== 'string' || !CANONICAL_EVIDENCE_REF.test(ref)) || new Set(value.evidenceRefs).size !== value.evidenceRefs.length)) throw new ApplicationServiceError('invalid_input', 'evidenceRefs must contain at most 80 unique canonical Observation/Claim refs')
  if (value.runId !== undefined && (typeof value.runId !== 'string' || !SAFE_ID.test(value.runId))) throw new ApplicationServiceError('invalid_input', 'runId is invalid')
  return { thesisRef: value.thesisRef, asOf: value.asOf, ...(value.evidenceRefs === undefined ? {} : { evidenceRefs: sortedUnique(value.evidenceRefs) }) }
}

function publicationFor(asset: KnowledgeClaimV04 | KnowledgeObservationV04, sources: readonly KnowledgeSourceV04[]): { readonly publishedAt?: string; readonly reason?: string } {
  const dates = sources.map((source) => source.publishedAt)
  if (dates.length === 0 || dates.some((date) => !validDate(date))) return { reason: 'EVIDENCE_PUBLICATION_UNKNOWN' }
  const timestamps = new Set(dates.map((date) => Date.parse(date!)))
  if (timestamps.size !== 1) return { reason: 'EVIDENCE_PUBLICATION_BINDING_MISMATCH' }
  const publishedAt = dates[0]!
  if (asset.id.startsWith('observation:') && (asset as KnowledgeObservationV04).observationType === 'estimate') {
    const explicit = (asset as Extract<KnowledgeObservationV04, { observationType: 'estimate' }>).publishedAt
    if (!validDate(explicit)) return { reason: 'EVIDENCE_PUBLICATION_UNKNOWN' }
    if (Date.parse(explicit) !== Date.parse(publishedAt)) return { reason: 'EVIDENCE_PUBLICATION_BINDING_MISMATCH' }
  }
  return { publishedAt }
}

function rawBindings(asset: KnowledgeClaimV04 | KnowledgeObservationV04): readonly { readonly sourceRef: string; readonly rawRef: string }[] {
  const allowedSourceRefs = asset.id.startsWith('observation:')
    ? new Set<string>([(asset as KnowledgeObservationV04).sourceRef].filter((ref) => typeof ref === 'string'))
    : new Set<string>((asset as KnowledgeClaimV04).sourceRefs ?? [])
  const provenance = asset.provenance ?? []
  return sortedUnique(provenance.map((item) => `${item.sourceRef}\u0000${item.rawRef}`))
    .map((key) => { const [sourceRef, rawRef] = key.split('\u0000'); return { sourceRef: sourceRef!, rawRef: rawRef! } })
    .filter((binding) => allowedSourceRefs.has(binding.sourceRef))
}

function eligibleSource(source: KnowledgeSourceV04, asOf: string): boolean {
  const timestamp = Date.parse(asOf)
  const lifecycle = source.lifecycle as unknown as { validFrom?: unknown; validUntil?: unknown } | undefined
  const inInterval = (value: unknown, lowerBound: boolean): boolean => {
    if (value === undefined || value === null) return true
    if (!validDate(value)) return false
    return lowerBound ? Date.parse(value) <= timestamp : Date.parse(value) >= timestamp
  }
  return active(source) && inInterval(lifecycle?.validFrom, true) && inInterval(lifecycle?.validUntil, false) && inInterval(source.rights.expiresAt, false) && source.rights.accessScope !== 'restricted' && source.rights.accessScope !== 'unknown' && source.rights.retentionAllowed === true && source.rights.aiProcessingAllowed === true && source.rights.derivativeKnowledgeAllowed === true && source.usagePolicy?.retainRaw === true && source.usagePolicy.allowAiProcessing === true && source.usagePolicy.allowDerivedKnowledge === true
}

function evidenceStatement(asset: KnowledgeClaimV04 | KnowledgeObservationV04): string {
  if (asset.id.startsWith('claim:')) return (asset as KnowledgeClaimV04).statement
  const observation = asset as KnowledgeObservationV04
  if (observation.observationType === 'metric') return `${observation.metricRef}=${String(observation.value)}${observation.unit ? ` ${observation.unit}` : ''}`
  if (observation.observationType === 'estimate') return `${observation.metricRef} estimate=${String(observation.estimateValue)}${observation.unit ? ` ${observation.unit}` : ''}`
  return `${observation.metricRef} consensus=${observation.mean}`
}

function evidenceFields(asset: KnowledgeClaimV04 | KnowledgeObservationV04): Pick<RefreshEvidenceCandidate, 'metric' | 'period' | 'unit' | 'value'> {
  if (asset.id.startsWith('claim:')) {
    const structured = (asset as KnowledgeClaimV04).structuredValue
    return structured ? { metric: structured.metric, period: structured.fiscalPeriod ?? structured.period ?? undefined, unit: structured.unit ?? undefined, ...(typeof structured.value === 'number' ? { value: structured.value } : {}) } : {}
  }
  const observation = asset as KnowledgeObservationV04
  if (observation.observationType === 'metric') return { metric: observation.metricRef, period: observation.period ?? undefined, unit: observation.unit ?? undefined, ...(typeof observation.value === 'number' ? { value: observation.value } : {}) }
  if (observation.observationType === 'estimate') return { metric: observation.metricRef, period: observation.fiscalPeriod, unit: observation.unit ?? undefined, ...(typeof observation.estimateValue === 'number' ? { value: observation.estimateValue } : {}) }
  return { metric: observation.metricRef, period: observation.fiscalPeriod, value: observation.mean }
}

function isEvidenceAsset(asset: KnowledgeAssetV04 | undefined): asset is KnowledgeClaimV04 | KnowledgeObservationV04 {
  return asset !== undefined && (asset.id.startsWith('claim:') || asset.id.startsWith('observation:'))
}

export async function collectThesisRefreshCandidates(input: { readonly assets: KnowledgeAssetCollectionV04; readonly handle: KnowledgeBaseHandle; readonly companyRef: string; readonly priorAsOf: string; readonly asOf: string; readonly activeClaimRefs: ReadonlySet<string>; readonly selectedRefs?: readonly string[] }): Promise<CollectionResult> {
  const byId = new Map<string, KnowledgeAssetV04>(input.assets.objects.map((item) => [item.value.id, item.value]))
  const automatic = input.selectedRefs === undefined
  const refs = input.selectedRefs ?? input.assets.objects.filter((item) => item.kind === 'observation' || item.kind === 'claim').map((item) => item.value.id).filter((ref) => !input.activeClaimRefs.has(ref)).sort()
  const candidates: Candidate[] = []
  const decisions: ThesisRefreshEvidenceDecision[] = []
  const diagnostics: string[] = []
  let explicitSelectionInvalid = false
  const exclude = (ref: string, reason: string, pairs: readonly { readonly sourceRef: string; readonly rawRef: string }[] = [], publishedAt?: string): void => {
    decisions.push({ evidenceRef: ref, decision: 'excluded', reason, sourceBindings: pairs, ...(publishedAt === undefined ? {} : { publishedAt }) })
    diagnostics.push(`${ref}:${reason}`)
    if (!automatic) explicitSelectionInvalid = true
  }
  for (const ref of refs) {
    const asset = byId.get(ref)
    if (!isEvidenceAsset(asset)) { exclude(ref, 'EVIDENCE_REF_MISSING_OR_WRONG_KIND'); continue }
    if (!active(asset) || (asset.id.startsWith('claim:') && (asset.lifecycle.status === 'superseded' || Boolean((asset as KnowledgeClaimV04).supersededBy?.length)))) { exclude(ref, 'EVIDENCE_REF_INACTIVE'); continue }
    if (input.activeClaimRefs.has(ref)) { exclude(ref, 'EVIDENCE_IS_THESIS_PROPOSITION'); continue }
    const subjectMatches = asset.id.startsWith('observation:') ? (asset as KnowledgeObservationV04).subjectRef === input.companyRef : (asset as KnowledgeClaimV04).subjectRefs.includes(input.companyRef as never)
    if (!subjectMatches) { exclude(ref, 'EVIDENCE_SUBJECT_MISMATCH'); continue }
    const pairs = rawBindings(asset)
    if (pairs.length === 0) { exclude(ref, 'EVIDENCE_SOURCE_BINDING_MISSING'); continue }
    const sources: KnowledgeSourceV04[] = []
    let sourceError: string | undefined
    for (const pair of pairs) {
      const source = byId.get(pair.sourceRef)
      if (!source || !source.id.startsWith('source:')) { sourceError = 'EVIDENCE_SOURCE_MISSING'; break }
      if (!eligibleSource(source as KnowledgeSourceV04, input.asOf)) { sourceError = 'EVIDENCE_SOURCE_INELIGIBLE'; break }
      const typedSource = source as KnowledgeSourceV04
      if (!typedSource.rawRefs?.includes(pair.rawRef as `raw-sha256-${string}`)) { sourceError = 'EVIDENCE_SOURCE_RAW_BINDING_INVALID'; break }
      try { await verifyRaw(input.handle, pair.rawRef) } catch { sourceError = 'EVIDENCE_RAW_UNVERIFIED'; break }
      sources.push(typedSource)
    }
    if (sourceError) { exclude(ref, sourceError, pairs); continue }
    const publication = publicationFor(asset, sources)
    if (publication.reason) { exclude(ref, publication.reason, pairs); continue }
    const publishedAt = publication.publishedAt!
    if (Date.parse(publishedAt) > Date.parse(input.asOf)) { exclude(ref, 'EVIDENCE_PUBLICATION_FUTURE', pairs, publishedAt); continue }
    if (Date.parse(publishedAt) <= Date.parse(input.priorAsOf)) { exclude(ref, 'EVIDENCE_PUBLICATION_NOT_NEW', pairs, publishedAt); continue }
    candidates.push({ evidenceId: ref, publishedAt, sourceRefs: sortedUnique(pairs.map((pair) => pair.sourceRef)), statement: evidenceStatement(asset), ...evidenceFields(asset), sourceBindings: pairs })
  }
  let limitExceeded = false
  if (automatic && candidates.length > 80) {
    limitExceeded = true
    diagnostics.push('EVIDENCE_LIMIT_EXCEEDED')
    for (const candidate of candidates) decisions.push({ evidenceRef: candidate.evidenceId, decision: 'excluded', reason: 'EVIDENCE_LIMIT_EXCEEDED', publishedAt: candidate.publishedAt, sourceBindings: candidate.sourceBindings })
    candidates.splice(0, candidates.length)
  } else if (automatic) {
    candidates.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || a.evidenceId.localeCompare(b.evidenceId))
  }
  return { candidates, decisions, diagnostics: sortedUnique(diagnostics).slice(0, 128), explicitSelectionInvalid, limitExceeded }
}

function lineagesFromCandidates(candidates: readonly Candidate[], classifiedRefs: ReadonlySet<string>): ThesisRefreshEvidenceDecision[] {
  return candidates.filter((candidate) => !classifiedRefs.has(candidate.evidenceId)).map((candidate) => ({ evidenceRef: candidate.evidenceId, decision: 'excluded', reason: 'SEMANTIC_CLASSIFICATION_OMITTED', publishedAt: candidate.publishedAt, sourceBindings: candidate.sourceBindings }))
}

interface AutoSafeWriteResult { readonly writerRunId: string; readonly claimRefs: readonly string[]; readonly revision: number }

interface AutoSafeIntentPayload {
  readonly runId: string
  readonly inputFingerprint: string
  readonly knowledgeBaseId: string
  readonly thesisRef: string
  readonly asOf: string
  readonly baseRevision: number
  readonly writerRunId: string
  readonly expected: readonly { readonly claimRef: string; readonly claimType: 'fact' | 'forecast'; readonly statement: string; readonly subjectRef: string; readonly structuredValue: Readonly<Record<string, unknown>>; readonly sourceBindings: readonly { readonly sourceRef: string; readonly rawRef: string }[] }[]
  readonly adapterResult: Awaited<ReturnType<typeof runThesisRefreshAdapter>>
  readonly decisions: readonly ThesisRefreshEvidenceDecision[]
  readonly diagnostics: readonly string[]
}
interface AutoSafeIntent { readonly version: 1; readonly payload: AutoSafeIntentPayload; readonly checksum: string }

function expectedAutoSafeClaimRef(proposal: SemanticProductionInputProposal, subjectRef: string): string {
  const identity = { claimType: proposal.claimType, statement: normalizeSemanticText(proposal.statement ?? ''), subjectRefs: [subjectRef], temporal: null, structuredValue: proposal.structuredValue ?? null }
  return allocateKnowledgeId('claim', identity).replace('claim:', 'claim:research-')
}

async function persistAutoSafeIntent(path: string, payload: AutoSafeIntentPayload): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const value: AutoSafeIntent = { version: 1, payload, checksum: hash(payload) }
  const temporary = `${path}.${randomUUID()}.tmp`
  try { await writeFile(temporary, `${JSON.stringify(value)}\n`, 'utf8'); await rename(temporary, path) }
  finally { try { await unlink(temporary) } catch { /* best-effort temp cleanup */ } }
}

async function readAutoSafeIntent(path: string): Promise<AutoSafeIntent | undefined> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as AutoSafeIntent
    if (value?.version !== 1 || !value.payload || hash(value.payload) !== value.checksum) throw new Error('AUTO_SAFE intent checksum or version is invalid')
    return value
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function autoSafeClaimProposal(candidate: Candidate, observation: KnowledgeObservationV04): SemanticProductionInputProposal | undefined {
  let claimType: 'fact' | 'forecast'
  let value: number
  let unit: string | null | undefined
  let period: string | undefined
  let fiscalPeriod: string | undefined
  if (observation.observationType === 'metric') {
    if (typeof observation.value !== 'number' || !Number.isFinite(observation.value)) return undefined
    claimType = 'fact'; value = observation.value; unit = observation.unit; period = observation.period ?? undefined
  } else if (observation.observationType === 'estimate') {
    if (typeof observation.estimateValue !== 'number' || !Number.isFinite(observation.estimateValue) || typeof observation.unit !== 'string' || observation.unit.trim() === '') return undefined
    claimType = 'forecast'; value = observation.estimateValue; unit = observation.unit; fiscalPeriod = observation.fiscalPeriod
  } else return undefined
  return {
    proposalId: `evidence-${hash(candidate.evidenceId)}`,
    kind: 'claim',
    claimType,
    subjectKey: 'company',
    statement: candidate.statement,
    existingEvidenceBindings: candidate.sourceBindings.map((pair) => ({ sourceRef: pair.sourceRef as `source:${string}`, rawRef: pair.rawRef as `raw-sha256-${string}` })),
    structuredValue: { metric: observation.metricRef, value, unit: unit ?? null, comparator: 'eq', ...(period === undefined ? {} : { period }), ...(fiscalPeriod === undefined ? {} : { fiscalPeriod }) },
  }
}

function stableReport(report: ResearchReport): string {
  const { generatedAt: _generatedAt, ...stable } = report
  return JSON.stringify(stable)
}

interface PersistedRunResult { readonly inputFingerprint: string; readonly result: ApplicationThesisLifecycleResult }
function encodeRunResult(value: PersistedRunResult): string { return `<!-- THESIS_LIFECYCLE_RESULT_V1:${Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')} -->` }
function decodeRunResult(report: ResearchReport): PersistedRunResult | undefined {
  const content = report.sections.find((section) => section.id === 'run-result')?.markdown
  const match = content?.match(/<!-- THESIS_LIFECYCLE_RESULT_V1:([A-Za-z0-9_-]+) -->/)
  if (!match) return undefined
  try {
    const parsed = JSON.parse(Buffer.from(match[1]!, 'base64url').toString('utf8')) as PersistedRunResult
    return parsed && typeof parsed.inputFingerprint === 'string' && parsed.result && typeof parsed.result === 'object' ? parsed : undefined
  } catch { return undefined }
}
function runResultSection(inputFingerprint: string, result: ApplicationThesisLifecycleResult): ResearchReport['sections'][number] {
  return { id: 'run-result', title: 'Run Result Metadata', markdown: encodeRunResult({ inputFingerprint, result }) }
}

async function persistReport(report: ResearchReport, reportRoot: string): Promise<string> {
  const fullRoot = resolve(reportRoot)
  try {
    const existing = await readResearchReport(join(fullRoot, `${report.reportId}.md.json`))
    if (stableReport(existing) !== stableReport(report)) throw new ApplicationServiceError('conflict', 'Existing thesis lifecycle report does not match deterministic replay')
    // The JSON sidecar is the report commit marker. Rewriting both artifacts
    // repairs a Markdown sidecar left stale by an interrupted prior attempt.
    return await writeReportPair(report, fullRoot)
  } catch (error) {
    if (error instanceof ApplicationServiceError) throw error
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return writeReportPair(report, fullRoot)
}

/** Stage both report artifacts beside their targets, then commit JSON first.
 * Readers use JSON as the durable record; a later replay repairs Markdown if
 * the process stops between the two renames. */
async function writeReportPair(report: ResearchReport, reportRoot: string): Promise<string> {
  const validated = validateResearchReport(report)
  const fullRoot = resolve(reportRoot)
  const markdownPath = resolve(fullRoot, validated.outputPath)
  const jsonPath = `${markdownPath}.json`
  const token = randomUUID()
  const markdownTemp = `${markdownPath}.${token}.tmp`
  const jsonTemp = `${jsonPath}.${token}.tmp`
  await mkdir(dirname(markdownPath), { recursive: true })
  try {
    await Promise.all([
      writeFile(markdownTemp, renderResearchReport(validated), 'utf8'),
      writeFile(jsonTemp, `${JSON.stringify(validated, null, 2)}\n`, 'utf8'),
    ])
    await rename(jsonTemp, jsonPath)
    await rename(markdownTemp, markdownPath)
    return markdownPath
  } finally {
    await Promise.all([jsonTemp, markdownTemp].map(async (path) => {
      try { await unlink(path) } catch { /* best-effort temp cleanup */ }
    }))
  }
}

function sameReviewSet(existing: readonly ReviewCase[], proposed: readonly ReviewCase[]): boolean {
  const stable = (value: ReviewCase): string => { const { createdAt: _createdAt, ...rest } = value; return JSON.stringify(rest) }
  return JSON.stringify([...existing].map(stable).sort()) === JSON.stringify([...proposed].map(stable).sort())
}

function reportText(value: string): string { return value.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim() }

function renderKillCriterionBindings(bindings: readonly KillCriterionReviewBindingV1[], criteria: readonly KillCriterionV04[]): string {
  if (bindings.length === 0) return 'None.'
  return bindings.map((binding) => {
    const criterion = criteria.find((item) => item.conditionId === binding.conditionId && item.state === 'active')
    const definition = criterion?.type === 'numeric_threshold' ? criterion.definition : undefined
    const metricRef = typeof definition?.metricRef === 'string' ? definition.metricRef : undefined
    const operator = typeof definition?.operator === 'string' ? definition.operator : undefined
    const threshold = typeof definition?.threshold === 'number' && Number.isFinite(definition.threshold) ? definition.threshold : undefined
    const unit = typeof definition?.unit === 'string' ? definition.unit : undefined
    const period = typeof definition?.period === 'string' ? definition.period : undefined
    const definitionComplete = metricRef !== undefined && operator !== undefined && threshold !== undefined && unit !== undefined && period !== undefined
    const bindingMatches = criterion?.revision === binding.revision && criterion.definitionHash === binding.definitionHash
    const canonicalRule = definitionComplete
      ? `  Current canonical rule: ${reportText(metricRef)} ${reportText(operator)} ${threshold} ${reportText(unit)} for ${reportText(period)}.`
      : '  Current canonical rule: no complete active numeric threshold is available for this condition.'
    const bindingCheck = criterion
      ? `  Current canonical revision/hash: ${criterion.revision} / ${reportText(criterion.definitionHash)}; ${bindingMatches ? 'matches' : 'DOES NOT MATCH'} the ReviewCase binding.`
      : '  Current canonical revision/hash: no active criterion; DOES NOT MATCH the ReviewCase binding.'
    return [
      `- ${reportText(binding.conditionId)} revision ${binding.revision}; assessment met; bound definition hash ${reportText(binding.definitionHash)}`,
      canonicalRule,
      bindingCheck,
      `  Evaluated value: ${binding.value} ${reportText(binding.unit)} (${reportText(binding.metricRef)}, ${reportText(binding.period)})`,
      `  Evidence: ${reportText(binding.evidenceRef)}; Source: ${reportText(binding.sourceRef)}; Raw: ${reportText(binding.rawRef)}`,
      `  Published: ${reportText(binding.publishedAt)}; as of: ${reportText(binding.asOf)}; targets: ${binding.targetClaimRefs.map(reportText).join(', ')}`,
      `  Numeric value version verified: yes; evaluated value identity: ${reportText(binding.evaluatedValueIdentity)}`,
    ].join('\n')
  }).join('\n')
}

function buildReport(input: { readonly runId: string; readonly asOf: string; readonly generatedAt: string; readonly revision: number; readonly thesisRef: string; readonly adapterResult: Awaited<ReturnType<typeof runThesisRefreshAdapter>>; readonly decisions: readonly ThesisRefreshEvidenceDecision[]; readonly diagnostics: readonly string[]; readonly reviewCaseIds: readonly string[]; readonly killCriterionBindings?: readonly KillCriterionReviewBindingV1[]; readonly canonicalKillCriteria?: readonly KillCriterionV04[]; readonly disposition: 'completed' | 'completed_with_review'; readonly autoSafe?: AutoSafeWriteResult; readonly inputFingerprint: string; readonly runResult: ApplicationThesisLifecycleResult }): ResearchReport {
  const sourceRefs = sortedUnique(input.decisions.flatMap((item) => item.sourceBindings.map((pair) => pair.sourceRef)))
  const claimRefs = sortedUnique([...(input.adapterResult.priorSnapshot?.propositions.map((item) => item.propositionId) ?? []), ...(input.adapterResult.refresh?.propositionDeltas.map((item) => item.propositionRef) ?? []), ...(input.autoSafe?.claimRefs ?? [])])
  const before = input.adapterResult.priorSnapshot?.propositions.map((item) => `- ${item.propositionId}: ${item.statement}`).join('\n') || 'No active proposition snapshot.'
  const after = input.adapterResult.refresh?.propositionDeltas.map((item) => `- ${item.propositionRef}: ${item.candidateStatus}; ${item.rationale}`).join('\n') || 'No proposition changes were classified.'
  const pit = input.decisions.map((item) => `- ${item.evidenceRef}: ${item.decision}${item.publishedAt ? `; published ${item.publishedAt}` : ''}${item.relation ? `; relation ${item.relation}` : ''}${item.targetClaimRefs?.length ? `; targets ${item.targetClaimRefs.join(', ')}` : ''}${item.reason ? `; ${item.reason}` : ''}${item.sourceBindings.length ? `; source/raw ${item.sourceBindings.map((pair) => `${pair.sourceRef} -> ${pair.rawRef}`).join(', ')}` : ''}`).join('\n') || 'No canonical evidence candidates were available.'
  const unchanged = input.adapterResult.refresh?.unchangedPropositionRefs.map((ref) => `- ${ref}`).join('\n') || 'None.'
  const diagnostics = [...new Set([...input.diagnostics, ...input.adapterResult.diagnostics])].slice(0, 128)
  const reportId = `thesis-lifecycle-${input.runId}`
  return validateResearchReport({
    reportId,
    reportType: 'thesis_lifecycle',
    subjectRefs: [input.thesisRef],
    generatedAt: input.generatedAt,
    asOf: input.asOf,
    workflowRunId: input.runId,
    knowledgeBaseRevision: input.revision,
    sourceRefs,
    claimRefs,
    methodology: 'Canonical v0.4 REFRESH over accepted, source-bound Observation/Claim evidence; semantic classification through the configured ReasoningExecutor; deterministic snapshot and publication PIT validation. Verified context-only metric/estimate Observations may produce additive evidence Claims through Gateway and Writer; Thesis membership/status and impact edges remain review-gated.',
    sections: [
      { id: 'before-after', title: 'Before and After', markdown: `## Before\n${before}\n\n## Candidate changes\n${after}\n\n## Candidate transition\n${input.adapterResult.refresh?.candidateTransition ?? 'unavailable'}` , claimRefs },
      { id: 'evidence-pit', title: 'Evidence and Point-in-Time Decisions', markdown: pit || 'No candidates.', sourceRefs },
      { id: 'unchanged', title: 'Unchanged Propositions', markdown: unchanged, claimRefs: input.adapterResult.refresh?.unchangedPropositionRefs ?? [] },
      { id: 'review-state', title: 'Review and Write State', markdown: `Refresh disposition: ${input.disposition}\n\nDecision state: ${input.autoSafe ? 'AUTO_APPLIED' : input.reviewCaseIds.length ? 'REVIEW_REQUIRED' : 'NO_CHANGE'}\n\nReviewCase IDs: ${input.reviewCaseIds.length ? input.reviewCaseIds.join(', ') : 'None.'}\n\nAUTO_SAFE Claim refs: ${input.autoSafe?.claimRefs.length ? input.autoSafe.claimRefs.join(', ') : 'None.'}\n\nGateway Writer run: ${input.autoSafe?.writerRunId ?? 'None.'}\n\nFinal Knowledge revision: ${input.revision}\n\nCanonical Kill Criterion bindings:\n${renderKillCriterionBindings(input.killCriterionBindings ?? [], input.canonicalKillCriteria ?? [])}\n\nThesis membership/status and reviewed impact edges require explicit human decision.` },
      runResultSection(input.inputFingerprint, input.runResult),
      { id: 'diagnostics', title: 'Diagnostics', markdown: diagnostics.length ? diagnostics.map((item) => `- ${item}`).join('\n') : 'None.' },
    ],
    outputPath: `${reportId}.md`,
  })
}

export class ThesisLifecycleService {
  private readonly registry = new KnowledgeBaseRegistry()
  private readonly gateway = new KnowledgeProductionGateway(this.registry)
  private readonly starts = new Map<string, { readonly fingerprint: string; readonly completion: Promise<ApplicationThesisLifecycleResult> }>()
  private readonly decisionReportLocks = new Map<string, Promise<void>>()

  constructor(private readonly options: ThesisLifecycleServiceOptions) {}

  async updateDecisionReport(input: ThesisLifecycleDecisionReportInput): Promise<ThesisLifecycleDecisionReportResult> {
    if (!SAFE_ID.test(input.producerRunId) || !SAFE_ID.test(input.reviewCaseId) || !Number.isSafeInteger(input.knowledgeBaseRevision) || input.knowledgeBaseRevision < 0 || (input.committedRevision !== undefined && (!Number.isSafeInteger(input.committedRevision) || input.committedRevision < 0)) || (input.diagnostics?.length ?? 0) > 16) return { status: 'failed', reportId: `thesis-lifecycle-${input.producerRunId}`, errors: ['THESIS_DECISION_REPORT_INPUT_INVALID'] }
    const reportId = `thesis-lifecycle-${input.producerRunId}`
    const reportRoot = resolve(this.options.reportRoot ?? join(this.options.cwd ?? process.cwd(), 'runtime-data', 'reports'))
    let release!: () => void
    const previousLock = this.decisionReportLocks.get(reportId) ?? Promise.resolve()
    const lock = new Promise<void>((resolveLock) => { release = resolveLock })
    const queuedLock = previousLock.then(() => lock)
    this.decisionReportLocks.set(reportId, queuedLock)
    await previousLock
    try {
    let report: ResearchReport
    try { report = await readResearchReport(join(reportRoot, `${reportId}.md.json`)) }
    catch (error) { return { status: 'not_found', reportId, errors: [error instanceof Error ? error.message : String(error)] } }
    if (report.reportType !== 'thesis_lifecycle' || report.workflowRunId !== input.producerRunId) return { status: 'not_found', reportId, errors: ['THESIS_DECISION_REPORT_IDENTITY_MISMATCH'] }
    const reviewSection = report.sections.find((section) => section.id === 'review-state')
    if (!reviewSection || !reviewSection.markdown.includes(input.reviewCaseId)) return { status: 'not_found', reportId, errors: ['THESIS_DECISION_REVIEW_CASE_NOT_IN_REPORT'] }
    const resultRevision = input.committedRevision ?? input.knowledgeBaseRevision
    const diagnostics = [...new Set(input.diagnostics ?? [])].slice(0, 16).map((item) => item.slice(0, 500))
    const persisted = decodeRunResult(report)
    if (!persisted || persisted.result.runId !== input.producerRunId || !persisted.result.reviewCaseIds.includes(input.reviewCaseId)) return { status: 'not_found', reportId, errors: ['THESIS_DECISION_RUN_RESULT_METADATA_MISSING'] }
    const priorOutcome = report.sections.find((section) => section.id === 'decision-outcome')
    const priorState = persisted.result.decisionState
    if (priorState !== undefined && priorState !== input.decisionState && priorState !== 'DEFERRED') return { status: 'failed', reportId, errors: ['THESIS_DECISION_REPORT_STATE_CONFLICT'] }
    if (priorState === 'ACCEPTED' && input.decisionState !== 'ACCEPTED') return { status: 'failed', reportId, errors: ['THESIS_DECISION_REPORT_ACCEPTED_IS_TERMINAL'] }
    if (persisted.result.writerRunId && input.writerRunId && persisted.result.writerRunId !== input.writerRunId) return { status: 'failed', reportId, errors: ['THESIS_DECISION_REPORT_WRITER_CONFLICT'] }
    const effectiveWriterRunId = input.writerRunId ?? persisted.result.writerRunId
    const effectiveRevision = Math.max(persisted.result.knowledgeBaseRevision ?? 0, resultRevision)
    const effectiveCommittedRevision = Math.max(persisted.result.committedRevision ?? 0, input.committedRevision ?? 0) || undefined
    const updatedResult: ApplicationThesisLifecycleResult = { ...persisted.result, knowledgeBaseRevision: effectiveRevision, decisionState: input.decisionState, ...(effectiveWriterRunId ? { writerRunId: effectiveWriterRunId } : {}), ...(effectiveCommittedRevision === undefined ? {} : { committedRevision: effectiveCommittedRevision }) }
    const decisionSection = {
      id: 'decision-outcome',
      title: 'Review Decision Outcome',
      markdown: `ReviewCase: ${input.reviewCaseId}\n\nDecision state: ${input.decisionState}\n\nWriter run: ${effectiveWriterRunId ?? 'None.'}\n\nObserved Knowledge revision: ${Math.max(input.knowledgeBaseRevision, report.knowledgeBaseRevision)}\n\nCommitted revision: ${effectiveCommittedRevision ?? 'None.'}\n\nDiagnostics: ${diagnostics.length ? diagnostics.map((item) => `- ${item}`).join('\n') : priorOutcome?.markdown.match(/Diagnostics:([\s\S]*)$/)?.[1]?.trim() || 'None.'}`,
      claimRefs: report.claimRefs,
    }
    const updatedReviewState = {
      ...reviewSection,
      markdown: reviewSection.markdown
        .replace(/Decision state: [^\n]*/, `Decision state: ${input.decisionState}`)
        .replace(/Final Knowledge revision: [^\n]*/, `Final Knowledge revision: ${Math.max(report.knowledgeBaseRevision, resultRevision)}`)
        .replace(/No Thesis membership\/status or reviewed impact-edge writes were performed\./, `Decision outcome: ${input.decisionState}; see the durable decision outcome section for Writer and revision details.`),
    }
    const next = validateResearchReport({ ...report, knowledgeBaseRevision: Math.max(report.knowledgeBaseRevision, resultRevision), sections: [...report.sections.filter((section) => section.id !== 'decision-outcome' && section.id !== 'run-result' && section.id !== 'review-state'), updatedReviewState, decisionSection, runResultSection(persisted.inputFingerprint, updatedResult)] })
    try {
      const reportPath = await writeReportPair(next, reportRoot)
      return { status: 'updated', reportId, reportPath, errors: [] }
    } catch (error) {
      return { status: 'failed', reportId, errors: ['THESIS_DECISION_REPORT_WRITE_FAILED', error instanceof Error ? error.message : String(error)] }
    }
    } finally {
      release()
      if (this.decisionReportLocks.get(reportId) === queuedLock) this.decisionReportLocks.delete(reportId)
    }
  }

  startRefresh(value: ThesisLifecycleRefreshInput, callerSignal?: AbortSignal): { readonly runId: string; readonly completion: Promise<ApplicationThesisLifecycleResult> } {
    const input = normalizeInput(value)
    const fingerprint = hash(input)
    const runId = value.runId ?? `thesis-refresh-${fingerprint}`
    const previous = this.starts.get(runId)
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new ApplicationServiceError('conflict', 'runId is already bound to a different thesis refresh input')
      return { runId, completion: previous.completion }
    }
    this.options.workflowService.register({ runId, workflowType: 'thesis_lifecycle', objective: `Refresh ${input.thesisRef}` })
    const startedAt = new Date().toISOString()
    const completion = this.options.workflowService.start(runId, async (signal) => {
      const combined = new AbortController()
      const abort = () => combined.abort()
      signal.addEventListener('abort', abort, { once: true })
      callerSignal?.addEventListener('abort', abort, { once: true })
      try { return await this.execute({ input, runId, startedAt, fingerprint, signal: combined.signal }) }
      catch (error) {
        const cancelled = combined.signal.aborted
        return { runId, thesisRef: input.thesisRef, status: cancelled ? 'cancelled' : 'failed', reviewCaseIds: [], evidenceDecisions: [], diagnostics: [error instanceof Error ? error.message : String(error)], summary: cancelled ? 'Thesis refresh cancelled' : 'Thesis refresh failed', ...(cancelled ? {} : { errorSummary: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500) }) }
      } finally {
        signal.removeEventListener('abort', abort)
        callerSignal?.removeEventListener('abort', abort)
      }
    })
    this.starts.set(runId, { fingerprint, completion })
    completion.catch(() => undefined)
    return { runId, completion }
  }

  private async execute(context: { readonly input: NormalizedInput; readonly runId: string; readonly startedAt: string; readonly fingerprint: string; readonly signal: AbortSignal }): Promise<ApplicationThesisLifecycleResult> {
    const { input, runId, startedAt, fingerprint, signal } = context
    const base = (status: TerminalWorkflowStatus, diagnostics: readonly string[], knowledgeBaseId?: string, revision?: number, refresh?: ThesisRefreshResult, evidenceDecisions: readonly ThesisRefreshEvidenceDecision[] = [], extra: { readonly reportId?: string; readonly reportPath?: string; readonly reviewCaseIds?: readonly string[]; readonly autoSafeWriterRunId?: string; readonly autoSafeClaimRefs?: readonly string[] } = {}): ApplicationThesisLifecycleResult => ({ runId, thesisRef: input.thesisRef, status, reviewCaseIds: extra.reviewCaseIds ?? [], evidenceDecisions, diagnostics, ...(knowledgeBaseId === undefined ? {} : { knowledgeBaseId }), ...(revision === undefined ? {} : { knowledgeBaseRevision: revision }), ...(refresh === undefined ? {} : { refresh }), ...(extra.reportId === undefined ? {} : { reportId: extra.reportId }), ...(extra.reportPath === undefined ? {} : { reportPath: extra.reportPath }), ...(extra.autoSafeWriterRunId === undefined ? {} : { autoSafeWriterRunId: extra.autoSafeWriterRunId }), ...(extra.autoSafeClaimRefs === undefined ? {} : { autoSafeClaimRefs: extra.autoSafeClaimRefs }), summary: status === 'completed_with_review' ? 'Thesis refresh completed with ReviewCases' : status === 'completed' ? 'Thesis refresh completed' : `Thesis refresh ${status}`, ...(status === 'failed' ? { errorSummary: diagnostics.join('; ').slice(0, 500) } : {}) })
    if (signal.aborted) return base('cancelled', ['THESIS_REFRESH_CANCELLED'])
    const reportRoot = resolve(this.options.reportRoot ?? join(this.options.cwd ?? process.cwd(), 'runtime-data', 'reports'))
    try {
      const existingReport = await readResearchReport(join(reportRoot, `thesis-lifecycle-${runId}.md.json`))
      const persisted = decodeRunResult(existingReport)
      if (!persisted || existingReport.reportType !== 'thesis_lifecycle' || existingReport.workflowRunId !== runId || existingReport.subjectRefs[0] !== input.thesisRef || existingReport.asOf !== input.asOf) return base('failed', ['THESIS_REFRESH_REPLAY_REPORT_METADATA_INVALID'])
      if (persisted.inputFingerprint !== fingerprint) return base('failed', ['THESIS_REFRESH_REPLAY_INPUT_CONFLICT'])
      try { await writeReportPair(existingReport, reportRoot) }
      catch (repairError) { return base('failed', ['THESIS_REFRESH_REPLAY_REPORT_REPAIR_FAILED', repairError instanceof Error ? repairError.message : String(repairError)]) }
      try { await unlink(join(reportRoot, `thesis-lifecycle-${runId}.autosafe-intent.json`)) } catch { /* report is durable; stale recovery intent can be ignored */ }
      return { ...persisted.result, knowledgeBaseRevision: Math.max(persisted.result.knowledgeBaseRevision ?? 0, existingReport.knowledgeBaseRevision), reportId: existingReport.reportId, reportPath: existingReport.outputPath }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return base('failed', ['THESIS_REFRESH_REPLAY_REPORT_READ_FAILED', error instanceof Error ? error.message : String(error)])
    }
    const handle = await this.registry.mount(resolve(this.options.mountedKnowledgeBaseRoot))
    if (handle.schemaVersion !== '0.4' || handle.storageFormatVersion !== '1' || handle.status !== 'active') return base('blocked', ['THESIS_REFRESH_REQUIRES_ACTIVE_V04_KNOWLEDGE_BASE'], handle.knowledgeBaseId, handle.revision)
    const deterministicAutoWriterRunId = `thesis-auto-${hash({ runId, phase: 'safe-evidence-claims' })}`
    const intentPath = join(reportRoot, `thesis-lifecycle-${runId}.autosafe-intent.json`)
    let intent: AutoSafeIntent | undefined
    try { intent = await readAutoSafeIntent(intentPath) }
    catch (error) { return base('blocked', ['THESIS_REFRESH_AUTO_SAFE_INTENT_INVALID', error instanceof Error ? error.message : String(error)], handle.knowledgeBaseId, handle.revision) }
    if (intent) {
      const payload = intent.payload
      if (payload.runId !== runId || payload.inputFingerprint !== fingerprint || payload.thesisRef !== input.thesisRef || payload.asOf !== input.asOf || payload.knowledgeBaseId !== handle.knowledgeBaseId || payload.writerRunId !== deterministicAutoWriterRunId || payload.expected.length === 0 || payload.expected.length > 80) return base('failed', ['THESIS_REFRESH_AUTO_SAFE_INTENT_IDENTITY_MISMATCH'], handle.knowledgeBaseId, handle.revision)
      let writerLog: { workflowRunId?: unknown; status?: unknown; writeStatus?: unknown; committedRevision?: unknown; changes?: { createdIds?: unknown; updatedIds?: unknown } }
      try { writerLog = JSON.parse(await readFile(join(handle.rootRef, 'logs', 'research', `${deterministicAutoWriterRunId}.yaml`), 'utf8')) as typeof writerLog }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return base('blocked', ['THESIS_REFRESH_AUTO_SAFE_WRITER_NOT_COMMITTED_RECOVERY_REQUIRED'], handle.knowledgeBaseId, handle.revision)
        return base('blocked', ['THESIS_REFRESH_AUTO_SAFE_WRITER_LOG_UNREADABLE'], handle.knowledgeBaseId, handle.revision)
      }
      if (writerLog.workflowRunId !== deterministicAutoWriterRunId || writerLog.status !== 'completed' || !['committed', 'no_changes'].includes(String(writerLog.writeStatus)) || !Number.isSafeInteger(writerLog.committedRevision)) return base('blocked', ['THESIS_REFRESH_AUTO_SAFE_WRITER_LOG_UNRECOGNIZED'], handle.knowledgeBaseId, handle.revision)
      const latestAssets = await readCanonicalV04Assets(handle.rootRef)
      const byId = new Map<string, KnowledgeAssetV04>(latestAssets.objects.map((item) => [item.value.id, item.value]))
      const changedRefs = new Set([...(Array.isArray(writerLog.changes?.createdIds) ? writerLog.changes!.createdIds as string[] : []), ...(Array.isArray(writerLog.changes?.updatedIds) ? writerLog.changes!.updatedIds as string[] : [])])
      const verifiedRefs: string[] = []
      for (const expected of payload.expected) {
        const claim = byId.get(expected.claimRef)
        if (!claim || !claim.id.startsWith('claim:') || !active(claim) || !claim.id.startsWith('claim:research-')) return base('blocked', ['THESIS_REFRESH_AUTO_SAFE_RECOVERY_CLAIM_MISSING'], handle.knowledgeBaseId, handle.revision)
        const typed = claim as KnowledgeClaimV04
        if (typed.claimType !== expected.claimType || normalizeSemanticText(typed.statement) !== normalizeSemanticText(expected.statement) || typed.subjectRefs.length !== 1 || typed.subjectRefs[0] !== expected.subjectRef || hashKnowledgeObject(typed.structuredValue ?? null) !== hashKnowledgeObject(expected.structuredValue)) return base('blocked', ['THESIS_REFRESH_AUTO_SAFE_RECOVERY_CLAIM_MISMATCH'], handle.knowledgeBaseId, handle.revision)
        for (const pair of expected.sourceBindings) {
          const source = byId.get(pair.sourceRef)
          if (!source || !source.id.startsWith('source:') || !(source as KnowledgeSourceV04).rawRefs?.includes(pair.rawRef as `raw-sha256-${string}`) || !typed.provenance?.some((binding) => binding.sourceRef === pair.sourceRef && binding.rawRef === pair.rawRef)) return base('blocked', ['THESIS_REFRESH_AUTO_SAFE_RECOVERY_PROVENANCE_MISMATCH'], handle.knowledgeBaseId, handle.revision)
          try { await verifyRaw(handle, pair.rawRef as `raw-sha256-${string}`) } catch { return base('blocked', ['THESIS_REFRESH_AUTO_SAFE_RECOVERY_RAW_UNVERIFIED'], handle.knowledgeBaseId, handle.revision) }
        }
        if (!changedRefs.has(expected.claimRef) && writerLog.writeStatus !== 'no_changes') return base('blocked', ['THESIS_REFRESH_AUTO_SAFE_RECOVERY_WRITER_LOG_MISMATCH'], handle.knowledgeBaseId, handle.revision)
        verifiedRefs.push(expected.claimRef)
      }
      const revision = writerLog.committedRevision as number
      const recoveredDiagnostics = sortedUnique([...payload.diagnostics, 'THESIS_REFRESH_AUTO_SAFE_REPORT_RECOVERED_FROM_WRITER_LOG'])
      const recoveredResult = base('completed', recoveredDiagnostics, handle.knowledgeBaseId, revision, payload.adapterResult.refresh, payload.decisions, { reportId: `thesis-lifecycle-${runId}`, reportPath: `thesis-lifecycle-${runId}.md`, autoSafeWriterRunId: deterministicAutoWriterRunId, autoSafeClaimRefs: verifiedRefs })
      const recoveredReport = buildReport({ runId, asOf: input.asOf, generatedAt: new Date().toISOString(), revision, thesisRef: input.thesisRef, adapterResult: payload.adapterResult, decisions: payload.decisions, diagnostics: recoveredDiagnostics, reviewCaseIds: [], disposition: 'completed', autoSafe: { writerRunId: deterministicAutoWriterRunId, claimRefs: verifiedRefs, revision }, inputFingerprint: fingerprint, runResult: recoveredResult })
      try {
        await persistReport(recoveredReport, reportRoot)
        await unlink(intentPath)
      } catch (error) { return base('failed', [...recoveredDiagnostics, 'THESIS_REFRESH_REPORT_RECOVERY_FAILED', error instanceof Error ? error.message : String(error)], handle.knowledgeBaseId, revision, payload.adapterResult.refresh, payload.decisions, { autoSafeWriterRunId: deterministicAutoWriterRunId, autoSafeClaimRefs: verifiedRefs }) }
      return recoveredResult
    }
    try {
      const writerLog = JSON.parse(await readFile(join(handle.rootRef, 'logs', 'research', `${deterministicAutoWriterRunId}.yaml`), 'utf8')) as { workflowRunId?: unknown; status?: unknown; writeStatus?: unknown }
      if (writerLog.workflowRunId === deterministicAutoWriterRunId && writerLog.status === 'completed' && ['committed', 'no_changes'].includes(String(writerLog.writeStatus))) return base('blocked', ['THESIS_REFRESH_AUTO_SAFE_INTENT_MISSING_MANUAL_RECOVERY'], handle.knowledgeBaseId, handle.revision)
      return base('blocked', ['THESIS_REFRESH_AUTO_SAFE_WRITER_LOG_UNRECOGNIZED'], handle.knowledgeBaseId, handle.revision)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return base('blocked', ['THESIS_REFRESH_AUTO_SAFE_WRITER_LOG_UNREADABLE'], handle.knowledgeBaseId, handle.revision)
    }
    const assets = await readCanonicalV04Assets(handle.rootRef)
    const thesisMatches = assets.objects.filter((item) => item.value.id === input.thesisRef)
    if (thesisMatches.length !== 1 || thesisMatches[0]?.kind !== 'thesis') return base('blocked', [thesisMatches.length ? 'THESIS_REFRESH_THESIS_AMBIGUOUS' : 'THESIS_REFRESH_THESIS_NOT_FOUND'], handle.knowledgeBaseId, handle.revision)
    const thesis = thesisMatches[0].value as KnowledgeThesisV04
    if (!active(thesis) || thesis.status === 'archived' || thesis.status === 'invalidated') return base('blocked', ['THESIS_REFRESH_THESIS_INACTIVE'], handle.knowledgeBaseId, handle.revision)
    const companies = thesis.subjectRefs.map((ref) => assets.objects.find((item) => item.kind === 'entity' && item.value.id === ref)?.value).filter((asset): asset is Extract<KnowledgeAssetV04, { type: 'company' }> => Boolean(asset && 'type' in asset && asset.type === 'company' && active(asset)))
    if (companies.length !== 1) return base('blocked', [companies.length === 0 ? 'THESIS_REFRESH_COMPANY_UNAVAILABLE' : 'THESIS_REFRESH_COMPANY_AMBIGUOUS'], handle.knowledgeBaseId, handle.revision)
    const emptySnapshotResult = await runThesisRefreshAdapter({ assets, handle, thesisRef: thesis.id, currentAsOf: input.asOf, evidenceBindings: [] })
    if (emptySnapshotResult.status !== 'completed' || !emptySnapshotResult.priorSnapshot) return base('blocked', emptySnapshotResult.diagnostics, handle.knowledgeBaseId, handle.revision)
    const activeClaimRefs = new Set(emptySnapshotResult.priorSnapshot.propositions.map((item) => item.propositionId))
    const collected = await collectThesisRefreshCandidates({ assets, handle, companyRef: companies[0]!.id, priorAsOf: emptySnapshotResult.priorSnapshot.priorAsOf, asOf: input.asOf, activeClaimRefs, ...(input.evidenceRefs === undefined ? {} : { selectedRefs: input.evidenceRefs }) })
    if (collected.explicitSelectionInvalid) return base('blocked', collected.diagnostics, handle.knowledgeBaseId, handle.revision, undefined, collected.decisions)
    if (collected.limitExceeded) return base('blocked', collected.diagnostics, handle.knowledgeBaseId, handle.revision, undefined, collected.decisions)
    if (signal.aborted) return base('cancelled', [...collected.diagnostics, 'THESIS_REFRESH_CANCELLED'], handle.knowledgeBaseId, handle.revision, undefined, collected.decisions)

    let classifications: readonly import('../../skills/thesis_refresh/contracts.ts').RefreshEvidence[] = []
    let semanticDiagnostics: readonly string[] = []
    if (collected.candidates.length > 0) {
      if (!this.options.reasoningExecutor) return base('blocked', [...collected.diagnostics, 'THESIS_REFRESH_REASONING_EXECUTOR_MISSING'], handle.knowledgeBaseId, handle.revision, undefined, collected.decisions)
      const semantic = await executeThesisRefresh({ priorSnapshot: emptySnapshotResult.priorSnapshot, currentAsOf: input.asOf, evidence: collected.candidates.map(({ sourceBindings: _bindings, ...candidate }) => candidate) }, this.options.reasoningExecutor)
      semanticDiagnostics = semantic.diagnostics
      if (semantic.status !== 'complete' || !semantic.result || !semantic.classifications) return base('blocked', [...collected.diagnostics, ...semanticDiagnostics, 'THESIS_REFRESH_SEMANTIC_CLASSIFICATION_BLOCKED'], handle.knowledgeBaseId, handle.revision, semantic.result, collected.decisions)
      classifications = semantic.classifications
    }
    const candidateByRef = new Map(collected.candidates.map((candidate) => [candidate.evidenceId, candidate]))
    const bindings: ThesisRefreshEvidenceBinding[] = classifications.map((classification) => {
      const candidate = candidateByRef.get(classification.evidenceId)
      if (!candidate) throw new ApplicationServiceError('failed', 'Validated semantic output references an unknown canonical evidence ref')
      const sourceBindings = candidate.sourceBindings.filter((pair) => classification.sourceRefs.includes(pair.sourceRef))
      if (sourceBindings.length === 0 || classification.sourceRefs.some((sourceRef) => !sourceBindings.some((pair) => pair.sourceRef === sourceRef))) throw new ApplicationServiceError('failed', 'Validated semantic output has no exact canonical Source/Raw binding')
      return { evidenceRef: classification.evidenceId, relation: classification.relation, targetClaimRefs: classification.targetPropositionRefs, sourceBindings }
    })
    const adapterResult = await runThesisRefreshAdapter({ assets, handle, thesisRef: thesis.id, currentAsOf: input.asOf, evidenceBindings: bindings })
    if (adapterResult.status !== 'completed' || !adapterResult.refresh) return base('blocked', [...collected.diagnostics, ...semanticDiagnostics, ...adapterResult.diagnostics], handle.knowledgeBaseId, handle.revision, adapterResult.refresh, collected.decisions)
    const classifiedRefs = new Set(classifications.map((item) => item.evidenceId))
    const adapterDecisions: ThesisRefreshEvidenceDecision[] = adapterResult.evidenceLineage.map((item) => ({ evidenceRef: item.evidenceRef, decision: item.decision, ...(item.reason === undefined ? {} : { reason: item.reason }), ...(item.publishedAt === undefined ? {} : { publishedAt: item.publishedAt }), relation: item.relation, targetClaimRefs: item.targetClaimRefs, sourceBindings: item.sourceBindings }))
    const decisions = [...collected.decisions, ...adapterDecisions, ...lineagesFromCandidates(collected.candidates, classifiedRefs)].sort((a, b) => a.evidenceRef.localeCompare(b.evidenceRef) || a.decision.localeCompare(b.decision))
    const diagnostics = sortedUnique([...collected.diagnostics, ...semanticDiagnostics, ...adapterResult.diagnostics])
    if (decisions.some((item) => item.reason === 'SEMANTIC_CLASSIFICATION_OMITTED')) return base('blocked', [...diagnostics, 'THESIS_REFRESH_CLASSIFICATION_INCOMPLETE'], handle.knowledgeBaseId, handle.revision, adapterResult.refresh, decisions)
    if (signal.aborted) return base('cancelled', [...diagnostics, 'THESIS_REFRESH_CANCELLED'], handle.knowledgeBaseId, handle.revision, adapterResult.refresh, decisions)

    let autoSafe: AutoSafeWriteResult | undefined
    const noPropositionChange = adapterResult.refresh.candidateTransition === 'unchanged' && adapterResult.refresh.propositionDeltas.every((delta) => delta.candidateStatus === 'unchanged')
    const evidenceById = new Map<string, KnowledgeAssetV04>(assets.objects.map((item) => [item.value.id, item.value]))
    const autoSafeCandidates = noPropositionChange ? classifications.filter((item) => item.relation === 'context').map((item) => ({ classification: item, candidate: candidateByRef.get(item.evidenceId), asset: evidenceById.get(item.evidenceId) })).filter((item): item is { classification: (typeof classifications)[number]; candidate: Candidate; asset: KnowledgeAssetV04 } => item.candidate !== undefined && item.asset !== undefined && item.asset.id.startsWith('observation:')) : []
    if (autoSafeCandidates.length > 0) {
      const proposals: SemanticProductionInputProposal[] = []
      for (const item of autoSafeCandidates) {
        const sourceBindings = item.candidate.sourceBindings.filter((pair) => item.classification.sourceRefs.includes(pair.sourceRef))
        if (sourceBindings.length === 0 || item.classification.sourceRefs.some((sourceRef) => !sourceBindings.some((pair) => pair.sourceRef === sourceRef))) return base('blocked', [...diagnostics, 'AUTO_SAFE_EVIDENCE_BINDING_INVALID'], handle.knowledgeBaseId, handle.revision, adapterResult.refresh, decisions)
        const proposal = autoSafeClaimProposal(item.candidate, item.asset as KnowledgeObservationV04)
        if (!proposal) return base('blocked', [...diagnostics, 'AUTO_SAFE_EVIDENCE_CLAIM_MAPPING_UNSUPPORTED'], handle.knowledgeBaseId, handle.revision, adapterResult.refresh, decisions)
        proposals.push({ ...proposal, existingEvidenceBindings: sourceBindings.map((pair) => ({ sourceRef: pair.sourceRef as `source:${string}`, rawRef: pair.rawRef as `raw-sha256-${string}` })) })
      }
      const exactClaimHasMembership = proposals.some((proposal) => assets.objects.some((item) => item.kind === 'claim' && item.value.id.startsWith('claim:') && (item.value as KnowledgeClaimV04).claimType === proposal.claimType && (item.value as KnowledgeClaimV04).statement === proposal.statement && (item.value as KnowledgeClaimV04).subjectRefs.includes(companies[0]!.id as never) && JSON.stringify((item.value as KnowledgeClaimV04).structuredValue ?? null) === JSON.stringify(proposal.structuredValue ?? null) && assets.objects.some((edge) => edge.kind === 'reasoning_edge' && (edge.value as { type?: string; sourceRef?: string; lifecycle?: { status?: string } }).type === 'qualifies' && (edge.value as { sourceRef?: string; lifecycle?: { status?: string } }).sourceRef === item.value.id && (edge.value as { lifecycle?: { status?: string } }).lifecycle?.status === 'active')))
      if (exactClaimHasMembership) return base('blocked', [...diagnostics, 'AUTO_SAFE_EVIDENCE_CLAIM_HAS_THESIS_MEMBERSHIP'], handle.knowledgeBaseId, handle.revision, adapterResult.refresh, decisions)
      const writerRunId = `thesis-auto-${hash({ runId, phase: 'safe-evidence-claims' })}`
      const company = companies[0]!
      if (!company.ticker) return base('blocked', [...diagnostics, 'AUTO_SAFE_COMPANY_HARD_IDENTITY_UNAVAILABLE'], handle.knowledgeBaseId, handle.revision, adapterResult.refresh, decisions)
      const gatewayInput: KnowledgeProductionInput = {
        handle,
        producerType: 'thesis_lifecycle',
        producerRunId: writerRunId,
        schemaProfile: { schemaVersion: '0.4', storageFormatVersion: '1', requiresRawProvenance: true },
        entity: { localKey: 'company', entityType: 'company', name: company.name, semanticFields: { ticker: company.ticker, ...(company.exchange ? { exchange: company.exchange } : {}) }, existingEntityRef: company.id },
        proposals,
        evidenceBindings: [],
        asOf: input.asOf,
      }
      const intentPayload: AutoSafeIntentPayload = {
        runId,
        inputFingerprint: fingerprint,
        knowledgeBaseId: handle.knowledgeBaseId,
        thesisRef: thesis.id,
        asOf: input.asOf,
        baseRevision: handle.revision,
        writerRunId,
        expected: proposals.map((proposal) => ({
          claimRef: expectedAutoSafeClaimRef(proposal, company.id),
          claimType: proposal.claimType as 'fact' | 'forecast',
          statement: proposal.statement ?? '',
          subjectRef: company.id,
          structuredValue: proposal.structuredValue ?? {},
          sourceBindings: proposal.existingEvidenceBindings ?? [],
        })),
        adapterResult,
        decisions,
        diagnostics,
      }
      try { await persistAutoSafeIntent(intentPath, intentPayload) }
      catch (error) { return base('failed', [...diagnostics, 'THESIS_REFRESH_AUTO_SAFE_INTENT_WRITE_FAILED', error instanceof Error ? error.message : String(error)], handle.knowledgeBaseId, handle.revision, adapterResult.refresh, decisions) }
      const written = await this.gateway.submit(gatewayInput)
      if (!['committed', 'already_committed', 'no_changes'].includes(written.status)) return base('blocked', [...diagnostics, 'AUTO_SAFE_GATEWAY_WRITE_FAILED', ...written.errors], handle.knowledgeBaseId, handle.revision, adapterResult.refresh, decisions)
      const claimRefs = sortedUnique(proposals.map((proposal) => written.claimRefsByProposalId[proposal.proposalId] ?? '').filter(Boolean))
      if (claimRefs.length !== proposals.length) return base('failed', [...diagnostics, 'AUTO_SAFE_GATEWAY_RESULT_INCOMPLETE'], handle.knowledgeBaseId, handle.revision, adapterResult.refresh, decisions, { autoSafeWriterRunId: writerRunId, autoSafeClaimRefs: claimRefs })
      const latestHandle = await this.registry.mount(resolve(this.options.mountedKnowledgeBaseRoot))
      const latestAssets = await readCanonicalV04Assets(latestHandle.rootRef)
      const claimRefsSet = new Set<string>(claimRefs)
      const verifiedIds = new Set<string>()
      for (const item of latestAssets.objects) {
        if (item.kind !== 'claim' || !claimRefsSet.has(item.value.id) || !item.value.id.startsWith('claim:')) continue
        const claim = item.value as KnowledgeClaimV04
        const expectedProposal = proposals.find((proposal) => written.claimRefsByProposalId[proposal.proposalId] === claim.id)
        if (claim.lifecycle.status === 'active' && expectedProposal && expectedProposal.existingEvidenceBindings?.every((pair) => claim.provenance?.some((binding) => binding.sourceRef === pair.sourceRef && binding.rawRef === pair.rawRef))) verifiedIds.add(claim.id)
      }
      if (claimRefs.some((ref) => !verifiedIds.has(ref)) || latestAssets.objects.some((edge) => edge.kind === 'reasoning_edge' && (edge.value as { type?: string; sourceRef?: string; lifecycle?: { status?: string } }).type === 'qualifies' && claimRefsSet.has((edge.value as { sourceRef?: string }).sourceRef ?? '') && (edge.value as { lifecycle?: { status?: string } }).lifecycle?.status === 'active')) return base('failed', [...diagnostics, 'AUTO_SAFE_GATEWAY_RELOAD_VERIFICATION_FAILED'], handle.knowledgeBaseId, latestHandle.revision, adapterResult.refresh, decisions, { autoSafeWriterRunId: writerRunId, autoSafeClaimRefs: claimRefs })
      autoSafe = { writerRunId, claimRefs, revision: latestHandle.revision }
    }

    const caseResult = buildThesisRefreshReviewCases({ adapterResult, assets, knowledgeBaseId: handle.knowledgeBaseId, producerRunId: runId, knowledgeBaseRevisionAtCreation: handle.revision, createdAt: startedAt })
    if (caseResult.status !== 'completed') return base('blocked', [...diagnostics, ...caseResult.diagnostics], handle.knowledgeBaseId, handle.revision, adapterResult.refresh, decisions)
    if (caseResult.cases.length > 0) {
      const existing = await listReviewCases(handle.rootRef, { producerRunId: runId, openOnly: false })
      if (existing.length > 0 && !sameReviewSet(existing, caseResult.cases)) return base('failed', [...diagnostics, 'THESIS_REFRESH_REVIEW_REPLAY_CONFLICT'], handle.knowledgeBaseId, handle.revision, adapterResult.refresh, decisions)
      if (existing.length === 0) {
        const persisted = await persistReviewCases({ rootRef: handle.rootRef, knowledgeBaseId: handle.knowledgeBaseId, producerRunId: runId, producerType: 'thesis_lifecycle', cases: caseResult.cases, createdAt: startedAt, schemaVersionAtCreation: '0.4', knowledgeBaseRevisionAtCreation: handle.revision })
        if (persisted.kind === 'conflict') return base('failed', [...diagnostics, persisted.message ?? 'THESIS_REFRESH_REVIEW_PERSISTENCE_CONFLICT'], handle.knowledgeBaseId, handle.revision, adapterResult.refresh, decisions)
      }
    }
    const finalCases = caseResult.cases
    const status = finalCases.length > 0 ? 'completed_with_review' : 'completed'
    const finalRevision = autoSafe?.revision ?? handle.revision
    const reportId = `thesis-lifecycle-${runId}`
    const result = base(status, diagnostics, handle.knowledgeBaseId, finalRevision, adapterResult.refresh, decisions, { reportId, reportPath: `${reportId}.md`, reviewCaseIds: finalCases.map((item) => item.reviewCaseId), ...(autoSafe ? { autoSafeWriterRunId: autoSafe.writerRunId, autoSafeClaimRefs: autoSafe.claimRefs } : {}) })
    const killCriterionBindings = finalCases.flatMap((item) => item.thesisScope?.killCriterionBindings ?? [])
    const report = buildReport({ runId, asOf: input.asOf, generatedAt: new Date().toISOString(), revision: finalRevision, thesisRef: thesis.id, adapterResult, decisions, diagnostics, reviewCaseIds: finalCases.map((item) => item.reviewCaseId), killCriterionBindings, canonicalKillCriteria: thesis.killCriteria ?? [], disposition: status, autoSafe, inputFingerprint: fingerprint, runResult: result })
    try { await persistReport(report, reportRoot) }
    catch (error) { return base('failed', [...diagnostics, 'THESIS_REFRESH_REPORT_WRITE_FAILED', error instanceof Error ? error.message : String(error)], handle.knowledgeBaseId, finalRevision, adapterResult.refresh, decisions, { reviewCaseIds: finalCases.map((item) => item.reviewCaseId), ...(autoSafe ? { autoSafeWriterRunId: autoSafe.writerRunId, autoSafeClaimRefs: autoSafe.claimRefs } : {}) }) }
    if (autoSafe) try { await unlink(intentPath) } catch { /* durable report replays and clears the intent */ }
    return result
  }
}
