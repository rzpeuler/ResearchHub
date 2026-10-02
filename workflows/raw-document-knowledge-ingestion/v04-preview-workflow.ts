import { DocumentInputResolver } from '../../plugins/document/input-resolver.ts'
import type { AcquiredDocumentInput, DocumentInputRef, StructuredDocument } from '../../plugins/document/contracts.ts'
import type { KnowledgeBaseHandle } from '../../knowledge/storage/handle.ts'
import { RawDocumentKnowledgeGatewayV04 } from '../../knowledge/production/raw-document-gateway-v04.ts'
import type { RawDocumentGatewayV04Result, RawDocumentMetadataV04, RawDocumentRightsV04 } from '../../knowledge/production/raw-document-gateway-v04.ts'
import type { ConsolidatedExtraction } from './extraction/consolidation.ts'
import { consolidateExtractions } from './extraction/consolidation.ts'
import type { AcceptedExtractionPlan, AcceptedExtractionUnit, ConsolidationReviewConstraint, PlanAttemptSummary } from './contracts.ts'
import { ExtractionPlanValidationError, validateExtractionPlan } from './planning/plan-validation.ts'
import type { KnowledgeCurationSkill } from '../../skills/knowledge-curation/skill.ts'
import type { EntityCandidate, ValidatedExtractKnowledgeResult } from '../../skills/knowledge-curation/contracts.ts'

const WORKFLOW_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/
const DEFAULT_CONFIG = { maxExtractionUnits: 64, maxPlanAttempts: 2, maxConcurrency: 4 }
const MAX_CONFIG = { maxExtractionUnits: 64, maxPlanAttempts: 4, maxConcurrency: 8 }

export interface RawDocumentPreviewConfigV04 {
  readonly maxExtractionUnits?: number
  readonly maxPlanAttempts?: number
  readonly maxConcurrency?: number
  readonly maxContextTokens?: number
}

export type RawDocumentPreviewSkillV04 = Pick<KnowledgeCurationSkill, 'capabilities' | 'understandAndPlan' | 'extractKnowledge'>

export interface DocumentInputResolverV04 {
  acquire(input: DocumentInputRef): Promise<AcquiredDocumentInput>
  parse(input: AcquiredDocumentInput): Promise<StructuredDocument>
}

export interface RawDocumentCandidateGroupV04 {
  readonly candidateId: string
  readonly kind: 'entity' | 'relation' | 'claim'
  readonly candidate: ConsolidatedExtraction['groups'][number]['candidate']
  readonly provenanceRefs: {
    readonly sourceRef: string
    readonly rawRef: string
    readonly evidenceBlockRefs: readonly string[]
  }
}

export interface RawDocumentPreviewUnitSummaryV04 {
  readonly unitId: string
  readonly proposedUnitId: string
  readonly attempts: number
  readonly status: 'completed' | 'failed' | 'cancelled'
  readonly candidateCounts: Readonly<Record<string, number>>
  readonly rejectedCount: number
  readonly error?: string
}

export type RawDocumentPreviewWorkflowStatusV04 = 'preview_ready' | 'preview_partial' | 'source_only' | 'blocked' | 'cancelled' | 'incompatible_schema'
export type RawDocumentPreviewStageStatusV04 = 'not_started' | 'completed' | 'partial' | 'blocked' | 'cancelled'
export type RawDocumentSourceStageStatusV04 = RawDocumentGatewayV04Result['status'] | 'not_started'

export interface RawDocumentPreviewWorkflowResultV04 {
  readonly workflowRunId: string
  readonly knowledgeBaseId: string
  readonly status: RawDocumentPreviewWorkflowStatusV04
  readonly sourceRaw: {
    readonly status: RawDocumentSourceStageStatusV04
    readonly persisted: boolean
    readonly revision: number
    readonly sourceRef?: string
    readonly rawRef?: string
    readonly errors: readonly { readonly code: string; readonly message: string }[]
  }
  readonly extractionPreview: {
    readonly status: RawDocumentPreviewStageStatusV04
    readonly documentId?: string
    readonly acceptedPlan?: AcceptedExtractionPlan
    readonly planAttempts: readonly PlanAttemptSummary[]
    readonly unitSummaries: readonly RawDocumentPreviewUnitSummaryV04[]
    readonly candidateGroups: readonly RawDocumentCandidateGroupV04[]
    readonly candidateCounts: Readonly<Record<string, number>>
    readonly rejectedCandidates: readonly unknown[]
    readonly reviewConstraints: readonly ConsolidationReviewConstraint[]
    readonly errors: readonly string[]
  }
  readonly provenance?: {
    readonly sourceRef: string
    readonly rawRef: string
    readonly documentId?: string
    readonly sourceRevision: number
  }
  readonly compatibility?: { readonly requiredSchemaVersion: '0.4'; readonly actualSchemaVersion: string }
}

export interface RawDocumentPreviewWorkflowInputV04 {
  readonly handle: KnowledgeBaseHandle
  readonly documentInput: DocumentInputRef
  readonly skill: RawDocumentPreviewSkillV04
  readonly workflowRunId: string
  readonly rights: RawDocumentRightsV04
  readonly sourceMetadata: RawDocumentMetadataV04
  readonly instructions?: string
  readonly config?: RawDocumentPreviewConfigV04
  readonly clock?: () => string
  readonly documentResolver?: DocumentInputResolverV04
  readonly gateway?: Pick<RawDocumentKnowledgeGatewayV04, 'submit'>
  readonly signal?: AbortSignal
}

interface EffectiveConfig {
  readonly maxExtractionUnits: number
  readonly maxPlanAttempts: number
  readonly maxConcurrency: number
  readonly maxContextTokens?: number
}

interface ExtractionOutcome {
  readonly extractions: readonly { readonly unit: AcceptedExtractionUnit; readonly result: ValidatedExtractKnowledgeResult }[]
  readonly summaries: readonly RawDocumentPreviewUnitSummaryV04[]
  readonly errors: readonly string[]
  readonly peakConcurrency: number
}

function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error) }
function aborted(input: RawDocumentPreviewWorkflowInputV04): boolean { return input.signal?.aborted === true }

function validateConfig(config: RawDocumentPreviewConfigV04 | undefined): { readonly effective?: EffectiveConfig; readonly errors: readonly string[] } {
  const allowed = new Set(['maxExtractionUnits', 'maxPlanAttempts', 'maxConcurrency', 'maxContextTokens'])
  const errors: string[] = []
  for (const [key, value] of Object.entries(config ?? {})) {
    const maximum = MAX_CONFIG[key as keyof typeof MAX_CONFIG]
    if (!allowed.has(key) || !Number.isSafeInteger(value) || (value as number) <= 0 || (maximum !== undefined && (value as number) > maximum)) errors.push(`${key} is outside the supported positive integer bounds`)
  }
  if (errors.length > 0) return { errors }
  return {
    effective: {
      maxExtractionUnits: config?.maxExtractionUnits ?? DEFAULT_CONFIG.maxExtractionUnits,
      maxPlanAttempts: config?.maxPlanAttempts ?? DEFAULT_CONFIG.maxPlanAttempts,
      maxConcurrency: config?.maxConcurrency ?? DEFAULT_CONFIG.maxConcurrency,
      ...(config?.maxContextTokens === undefined ? {} : { maxContextTokens: config.maxContextTokens }),
    },
    errors,
  }
}

function initialSourceStage(handle: KnowledgeBaseHandle): RawDocumentPreviewWorkflowResultV04['sourceRaw'] {
  return { status: 'not_started', persisted: false, revision: handle.revision, errors: [] }
}

function initialPreviewStage(status: RawDocumentPreviewStageStatusV04 = 'not_started', errors: readonly string[] = []): RawDocumentPreviewWorkflowResultV04['extractionPreview'] {
  return { status, planAttempts: [], unitSummaries: [], candidateGroups: [], candidateCounts: {}, rejectedCandidates: [], reviewConstraints: [], errors }
}

function result(input: RawDocumentPreviewWorkflowInputV04, status: RawDocumentPreviewWorkflowStatusV04, sourceRaw: RawDocumentPreviewWorkflowResultV04['sourceRaw'], extractionPreview: RawDocumentPreviewWorkflowResultV04['extractionPreview'], extra: Partial<Pick<RawDocumentPreviewWorkflowResultV04, 'provenance' | 'compatibility'>> = {}): RawDocumentPreviewWorkflowResultV04 {
  return { workflowRunId: input.workflowRunId, knowledgeBaseId: input.handle.knowledgeBaseId, status, sourceRaw, extractionPreview, ...extra }
}

function sourceStageFromGateway(value: RawDocumentGatewayV04Result): RawDocumentPreviewWorkflowResultV04['sourceRaw'] {
  const persisted = (value.status === 'committed' || value.status === 'already_committed' || value.status === 'no_changes') && typeof value.sourceRef === 'string' && typeof value.rawRef === 'string'
  const errors = value.errors.length > 0 ? value.errors : persisted ? [] : [{ code: 'RAW_DOCUMENT_PERSISTENCE_UNVERIFIED', message: 'Gateway did not return committed Source and Raw provenance references.' }]
  return {
    status: persisted ? value.status : value.status === 'committed' || value.status === 'already_committed' || value.status === 'no_changes' ? 'failed' : value.status,
    persisted,
    revision: value.knowledgeBaseRevision,
    ...(value.sourceRef === undefined ? {} : { sourceRef: value.sourceRef }),
    ...(value.rawRef === undefined ? {} : { rawRef: value.rawRef }),
    errors,
  }
}

function themePreviewConstraints(groups: ConsolidatedExtraction['groups']): ConsolidationReviewConstraint[] {
  return groups.flatMap((group) => {
    if (group.kind !== 'entity' || (group.candidate as EntityCandidate).entityType !== 'investment_theme') return []
    return [{
      candidateId: group.candidateId,
      reason: 'InvestmentTheme candidates require the Theme Framework workflow and are not created by raw document preview.',
      conflictingFields: [],
      blocking: true,
      category: 'theme_creation' as const,
      reviewKey: `theme-framework-required:${group.candidateId}`,
    }]
  })
}

async function extractBounded(input: RawDocumentPreviewWorkflowInputV04, document: StructuredDocument, reportMap: Parameters<RawDocumentPreviewSkillV04['extractKnowledge']>[0]['reportMap'], units: readonly AcceptedExtractionUnit[], maxConcurrency: number): Promise<ExtractionOutcome> {
  const results: Array<{ unit: AcceptedExtractionUnit; result: ValidatedExtractKnowledgeResult } | undefined> = new Array(units.length)
  const summaries: Array<RawDocumentPreviewUnitSummaryV04 | undefined> = new Array(units.length)
  const errors: string[] = []
  let next = 0
  let active = 0
  let peakConcurrency = 0
  async function worker(): Promise<void> {
    while (true) {
      if (aborted(input)) return
      const index = next++
      if (index >= units.length) return
      const unit = units[index]!
      active += 1
      peakConcurrency = Math.max(peakConcurrency, active)
      try {
        const extracted = await input.skill.extractKnowledge({ document, reportMap, unit, instructions: input.instructions })
        results[index] = { unit, result: extracted }
        summaries[index] = { unitId: unit.unitId, proposedUnitId: unit.proposedUnitId, attempts: 1, status: 'completed', candidateCounts: { entity: extracted.entities.length, relation: extracted.relations.length, claim: extracted.claims.length }, rejectedCount: extracted.rejected.length }
      } catch (error) {
        const message = errorText(error)
        errors.push(`Extraction unit ${unit.unitId} failed: ${message}`)
        summaries[index] = { unitId: unit.unitId, proposedUnitId: unit.proposedUnitId, attempts: 1, status: aborted(input) ? 'cancelled' : 'failed', candidateCounts: {}, rejectedCount: 0, error: message }
      } finally {
        active -= 1
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(maxConcurrency, units.length) }, () => worker()))
  for (let index = 0; index < units.length; index += 1) {
    if (summaries[index] !== undefined) continue
    const unit = units[index]!
    const cancelled = aborted(input)
    summaries[index] = { unitId: unit.unitId, proposedUnitId: unit.proposedUnitId, attempts: 0, status: cancelled ? 'cancelled' : 'failed', candidateCounts: {}, rejectedCount: 0, error: cancelled ? 'Workflow cancelled before extraction began.' : 'Extraction did not complete.' }
    if (!cancelled) errors.push(`Extraction unit ${unit.unitId} did not complete`)
  }
  return { extractions: results.filter((item): item is { unit: AcceptedExtractionUnit; result: ValidatedExtractKnowledgeResult } => item !== undefined), summaries: summaries.filter((item): item is RawDocumentPreviewUnitSummaryV04 => item !== undefined), errors, peakConcurrency }
}

function candidateGroups(groups: ConsolidatedExtraction['groups'], sourceRef: string, rawRef: string): RawDocumentCandidateGroupV04[] {
  return groups.map((group) => ({
    ...group,
    provenanceRefs: { sourceRef, rawRef, evidenceBlockRefs: [...group.candidate.evidenceBlockRefs] },
  }))
}

function emptyConsolidated(): ConsolidatedExtraction {
  return { groups: [], reviewConstraints: [], rejected: [], candidateCounts: { entity: 0, relation: 0, claim: 0, consolidated: 0, rejected: 0 }, candidateAliases: new Map(), entityCandidates: new Map(), candidateSupport: new Map() }
}

export async function runRawDocumentKnowledgePreviewV04(input: RawDocumentPreviewWorkflowInputV04): Promise<RawDocumentPreviewWorkflowResultV04> {
  let sourceRaw = initialSourceStage(input.handle)
  let extractionPreview = initialPreviewStage()
  let provenance: RawDocumentPreviewWorkflowResultV04['provenance']
  if (!WORKFLOW_RUN_ID.test(input.workflowRunId)) return result(input, 'blocked', sourceRaw, initialPreviewStage('blocked', ['workflowRunId must be a safe deterministic identifier']))
  if (input.handle.schemaVersion !== '0.4') return result(input, 'incompatible_schema', sourceRaw, initialPreviewStage('blocked', ['Raw document preview requires Schema 0.4; Schema 0.3 must be explicitly re-ingested into a new Schema 0.4 Knowledge Base.']), { compatibility: { requiredSchemaVersion: '0.4', actualSchemaVersion: input.handle.schemaVersion } })
  if (input.handle.storageFormatVersion !== '1' || input.handle.status !== 'active' || !input.handle.writable) return result(input, 'blocked', sourceRaw, initialPreviewStage('blocked', ['Raw document preview requires an active writable Schema 0.4 / Storage Format 1 Knowledge Base.']))
  const configured = validateConfig(input.config)
  if (!configured.effective) return result(input, 'blocked', sourceRaw, initialPreviewStage('blocked', configured.errors))
  const config = configured.effective
  if (aborted(input)) return result(input, 'cancelled', sourceRaw, initialPreviewStage('cancelled', ['Workflow cancelled before document intake.']))

  try {
    const resolver = input.documentResolver ?? new DocumentInputResolver()
    const acquired = await resolver.acquire(input.documentInput)
    if (aborted(input)) return result(input, 'cancelled', sourceRaw, initialPreviewStage('cancelled', ['Workflow cancelled before Source and Raw persistence.']))

    const rawGateway = input.gateway ?? new RawDocumentKnowledgeGatewayV04({ ...(input.clock === undefined ? {} : { clock: input.clock }) })
    let rawResult: RawDocumentGatewayV04Result
    try {
      rawResult = await rawGateway.submit({ handle: input.handle, workflowRunId: input.workflowRunId, bytes: acquired.bytes, filename: acquired.filename, mediaType: acquired.mediaType, source: input.sourceMetadata, rights: input.rights })
    } catch (error) {
      sourceRaw = { status: 'failed', persisted: false, revision: input.handle.revision, errors: [{ code: 'RAW_DOCUMENT_SUBMISSION_FAILED', message: errorText(error) }] }
      return result(input, 'blocked', sourceRaw, initialPreviewStage('blocked', sourceRaw.errors.map((item) => `${item.code}: ${item.message}`)))
    }
    sourceRaw = sourceStageFromGateway(rawResult)
    if (!sourceRaw.persisted || !sourceRaw.sourceRef || !sourceRaw.rawRef) return result(input, 'blocked', sourceRaw, initialPreviewStage('blocked', sourceRaw.errors.map((item) => `${item.code}: ${item.message}`)))
    provenance = { sourceRef: sourceRaw.sourceRef, rawRef: sourceRaw.rawRef, sourceRevision: sourceRaw.revision }
    if (aborted(input)) return result(input, 'cancelled', sourceRaw, initialPreviewStage('cancelled', ['Source and Raw are persisted; workflow cancelled before parsing.']), { provenance })

    const document = await resolver.parse(acquired)
    provenance = { ...provenance, documentId: document.documentId }
    if (aborted(input)) return result(input, 'cancelled', sourceRaw, { ...initialPreviewStage('cancelled', ['Source and Raw are persisted; workflow cancelled before semantic planning.']), documentId: document.documentId }, { provenance })

    const capabilities = input.skill.capabilities()
    let planned: Awaited<ReturnType<RawDocumentPreviewSkillV04['understandAndPlan']>> | undefined
    let acceptedPlan: AcceptedExtractionPlan | undefined
    let planRepair: Parameters<RawDocumentPreviewSkillV04['understandAndPlan']>[0]['planRepair'] | undefined
    const planAttempts: PlanAttemptSummary[] = []
    for (let attempt = 1; attempt <= config.maxPlanAttempts; attempt += 1) {
      if (aborted(input)) {
        extractionPreview = { ...initialPreviewStage('cancelled', ['Source and Raw are persisted; workflow cancelled during semantic planning.']), documentId: document.documentId, planAttempts }
        return result(input, 'cancelled', sourceRaw, extractionPreview, { provenance })
      }
      planAttempts.push({ attempt, status: 'proposed' })
      const proposal = await input.skill.understandAndPlan({ document, instructions: input.instructions, ...(planRepair === undefined ? {} : { planRepair }) })
      planned = proposal
      if (aborted(input)) {
        extractionPreview = { ...initialPreviewStage('cancelled', ['Source and Raw are persisted; workflow cancelled while semantic planning was in progress.']), documentId: document.documentId, planAttempts }
        return result(input, 'cancelled', sourceRaw, extractionPreview, { provenance })
      }
      try {
        acceptedPlan = validateExtractionPlan(proposal, document, capabilities, { maxExtractionUnits: config.maxExtractionUnits, ...(config.maxContextTokens === undefined ? {} : { maxContextTokens: config.maxContextTokens }) }, input.instructions)
        planAttempts[planAttempts.length - 1] = { attempt, status: 'accepted' }
        break
      } catch (error) {
        if (!(error instanceof ExtractionPlanValidationError)) throw error
        const terminal = !error.repairable || attempt >= config.maxPlanAttempts
        planAttempts[planAttempts.length - 1] = { attempt, status: terminal ? 'terminal_invalid' : 'repairable_invalid', validationCode: error.code, uncoveredCount: error.feedback.uncoveredRefs?.length, overlapCount: error.feedback.overlapRefs?.length, affectedUnitId: error.feedback.affectedUnitId, estimatedTokens: error.feedback.estimatedTokens, allowedTokens: error.feedback.allowedTokens, unitCount: error.feedback.unitCount, maxUnits: error.feedback.maxUnits }
        if (terminal) {
          const errors = [error.message]
          extractionPreview = { ...initialPreviewStage('blocked', errors), documentId: document.documentId, planAttempts }
          return result(input, 'source_only', sourceRaw, extractionPreview, { provenance })
        }
        planRepair = { previousOutput: proposal, feedback: error.feedback, attempt: attempt + 1 }
      }
    }
    if (!planned || !acceptedPlan) {
      extractionPreview = { ...initialPreviewStage('blocked', ['No accepted extraction plan was produced.']), documentId: document.documentId, planAttempts }
      return result(input, 'source_only', sourceRaw, extractionPreview, { provenance })
    }
    if (aborted(input)) {
      extractionPreview = { ...initialPreviewStage('cancelled', ['Source and Raw are persisted; workflow cancelled before candidate extraction.']), documentId: document.documentId, acceptedPlan, planAttempts }
      return result(input, 'cancelled', sourceRaw, extractionPreview, { provenance })
    }

    const concurrency = Math.min(config.maxConcurrency, capabilities.maxConcurrency, acceptedPlan.units.length)
    if (!Number.isSafeInteger(concurrency) || concurrency <= 0) {
      extractionPreview = { ...initialPreviewStage('blocked', ['Reasoning executor has no available extraction concurrency.']), documentId: document.documentId, acceptedPlan, planAttempts }
      return result(input, 'source_only', sourceRaw, extractionPreview, { provenance })
    }
    const extracted = await extractBounded(input, document, planned.reportMap, acceptedPlan.units, concurrency)
    const consolidated = extracted.extractions.length > 0 ? consolidateExtractions(extracted.extractions) : emptyConsolidated()
    const constraints = [...consolidated.reviewConstraints, ...themePreviewConstraints(consolidated.groups)].sort((left, right) => left.reviewKey.localeCompare(right.reviewKey))
    const groups = candidateGroups(consolidated.groups, sourceRaw.sourceRef, sourceRaw.rawRef)
    const cancelled = aborted(input)
    const incomplete = cancelled || extracted.errors.length > 0 || extracted.extractions.length !== acceptedPlan.units.length
    const stageStatus: RawDocumentPreviewStageStatusV04 = cancelled ? 'cancelled' : extracted.extractions.length === 0 && extracted.errors.length > 0 ? 'blocked' : incomplete ? 'partial' : 'completed'
    extractionPreview = {
      status: stageStatus,
      documentId: document.documentId,
      acceptedPlan,
      planAttempts,
      unitSummaries: extracted.summaries,
      candidateGroups: groups,
      candidateCounts: consolidated.candidateCounts,
      rejectedCandidates: consolidated.rejected,
      reviewConstraints: constraints,
      errors: [...extracted.errors, ...(cancelled ? ['Workflow cancelled during candidate extraction.'] : [])],
    }
    const workflowStatus: RawDocumentPreviewWorkflowStatusV04 = cancelled ? 'cancelled' : stageStatus === 'completed' ? 'preview_ready' : groups.length > 0 ? 'preview_partial' : 'source_only'
    return result(input, workflowStatus, sourceRaw, extractionPreview, { provenance })
  } catch (error) {
    const message = errorText(error)
    const cancelled = aborted(input)
    extractionPreview = initialPreviewStage(cancelled ? 'cancelled' : 'blocked', [message])
    return result(input, cancelled ? 'cancelled' : sourceRaw.persisted ? 'source_only' : 'blocked', sourceRaw, extractionPreview, { ...(provenance === undefined ? {} : { provenance }) })
  }
}
