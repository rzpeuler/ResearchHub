import { createHash } from 'node:crypto'
import { runExchangeQa, runManagementCommunicationDocuments, type ExchangeQAPair, type ManagementCommunicationAcquisitionSources, type ManagementCommunicationDocument } from '../management-communication-acquisition/index.ts'
import { runManagementCommunicationExtraction, type ManagementCommunicationExtractionResult } from '../management-communication-extraction/index.ts'
import type { KpiCandidate, ManagementOutlookCandidate, StructuredQAEvidence } from '../../skills/management-communication-extraction/contracts.ts'
import type { GuidanceRange, SegmentKpiDeltaInput, SegmentKpiPoint } from '../../skills/earnings-review/expectations/contracts.ts'
import type { EarningsReviewSection } from '../../skills/earnings-review/contracts.ts'
import type { NormalizedResearchSource, ResearchCompanyIdentity } from '../../plugins/research-acquisition/contracts.ts'
import type { ReasoningExecutor } from '../../plugins/reasoning/contracts.ts'
import { assessManagementExecution, type ManagementCommitment, type ManagementExecutionResult, type ManagementOutcome } from '../../skills/management_execution/index.ts'
import { comparableFiscalPeriod } from '../../skills/earnings-review/expectations/segment-kpi.ts'
import type { EarningsPeriod } from '../../skills/earnings-review/index.ts'
import type { ManagementCommunicationDataCompositionOptions, ManagementCommunicationDataPayload } from '../../plugins/research-acquisition/management-communication-data.ts'
import type { DataResolver } from '../../data/resolver.ts'
import { parseNumericRange, parseNumericToken } from '../management-communication-extraction/numeric-parsing.ts'
import { resolveUnit } from '../management-communication-extraction/unit-normalization.ts'
import { resolveFiscalPeriod } from '../management-communication-extraction/period-normalization.ts'

export interface ManagementCommunicationResearchInput {
  readonly extraction?: ManagementCommunicationExtractionResult
  readonly executionOutcomes?: readonly ManagementOutcome[]
}

export interface ManagementCommunicationResearchResult {
  readonly status: 'available' | 'partial' | 'unavailable' | 'failed'
  readonly extraction?: ManagementCommunicationExtractionResult
  readonly sourceObjects: readonly NormalizedResearchSource[]
  readonly guidance?: readonly GuidanceRange[]
  readonly currentGuidanceIds?: readonly string[]
  readonly segmentKpiComparisons?: readonly SegmentKpiDeltaInput[]
  readonly commentaryDeltas: readonly ManagementCommentaryDelta[]
  readonly qaClusters: readonly QAQuestionCluster[]
  readonly execution: ManagementExecutionResult
  readonly diagnostics: readonly string[]
  readonly telemetry: ManagementCommunicationTelemetry
}

export interface ManagementCommunicationTelemetry {
  readonly acquisitionAttempted: boolean
  readonly acquisitionDocumentCount: number
  readonly acquisitionQaCount: number
  readonly extractionCalls: number
  readonly extractedOutlookCount: number
  readonly extractedQaCount: number
  readonly commentaryDeltaCount: number
  readonly qaClusterCount: number
  readonly executionAssessmentCount: number
}

export type ManagementCommentaryDeltaStatus = 'new' | 'unchanged' | 'strengthened' | 'weakened' | 'reversed' | 'inconclusive'

export interface ManagementCommentaryDelta {
  readonly key: string
  readonly topic: string
  readonly metric?: string
  readonly timeHorizon?: string
  readonly status: ManagementCommentaryDeltaStatus
  readonly currentCandidateId?: string
  readonly priorCandidateId?: string
  readonly currentDirection?: string
  readonly priorDirection?: string
  readonly numericChange?: { readonly current?: number; readonly prior?: number; readonly absoluteDelta?: number; readonly unit?: string }
  readonly sourceCandidateIds: readonly string[]
  readonly diagnostics: readonly string[]
}

export interface QAResponseAssessment {
  readonly status: 'direct' | 'partial' | 'non_answer' | 'inconclusive'
  readonly diagnostics: readonly string[]
  readonly sourceCandidateIds: readonly string[]
}

export interface QAQuestionClusterMember {
  readonly pairId: string
  readonly question: string
  readonly answer: string
  readonly sourceObjectId: string
  readonly topicTags: readonly string[]
  readonly response: QAResponseAssessment
}

export interface QAQuestionCluster {
  readonly clusterId: string
  readonly key: string
  readonly topicTags: readonly string[]
  readonly referencedProductOrSegment?: string
  readonly members: readonly QAQuestionClusterMember[]
  readonly sourceCandidateIds: readonly string[]
}

export interface ResolveManagementCommunicationInput {
  readonly company: ResearchCompanyIdentity
  readonly analysisAsOf: string
  readonly fiscalYear: number
  readonly period: EarningsPeriod
  readonly signal?: AbortSignal
  readonly now?: () => string
  readonly reasoningExecutor?: ReasoningExecutor
  readonly officialSources: readonly NormalizedResearchSource[]
  readonly caller?: ManagementCommunicationResearchInput
  readonly sources?: ManagementCommunicationAcquisitionSources
  readonly dataResolverFactory?: (options: ManagementCommunicationDataCompositionOptions) => DataResolver<ManagementCommunicationDataPayload>
  readonly lookbackDays?: number
}

const text = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const unique = (values: readonly string[]): readonly string[] => [...new Set(values.filter(text).map((value) => value.trim()))].sort((left, right) => left.localeCompare(right))
const normalized = (value: string): string => value.normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase()

function sourceFromDocument(document: ManagementCommunicationDocument): NormalizedResearchSource {
  const candidate = { candidateId: document.id, kind: 'official_disclosure' as const, tier: 1 as const, title: document.title ?? document.id, provider: document.source.retrievalProvider ?? 'management-communication', publishedAt: document.publishedAt, url: document.source.sourceUrl, metadata: { companySymbol: document.ticker, d2Lane: 'management_document' } }
  return { candidate, retrievedAt: document.retrievedAt, title: candidate.title, content: document.content, contentHash: createHash('sha256').update(document.content).digest('hex'), publisher: document.source.originPublisher, canonicalUrl: document.source.sourceUrl, rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false } }
}

function sourceFromQa(pair: ExchangeQAPair): NormalizedResearchSource {
  const content = `Question: ${pair.question}\nAnswer: ${pair.answer}`
  const candidate = { candidateId: pair.id, kind: 'structured_data' as const, tier: 2 as const, title: `Management Q&A ${pair.id}`, provider: pair.source.retrievalProvider ?? 'management-communication', publishedAt: pair.publishedAt, url: pair.source.sourceUrl, metadata: { companySymbol: pair.ticker, d2Lane: 'exchange_qa', platform: pair.platform } }
  return { candidate, retrievedAt: pair.retrievedAt, title: candidate.title, content, contentHash: createHash('sha256').update(content).digest('hex'), publisher: pair.source.originPublisher, canonicalUrl: pair.source.sourceUrl, rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false } }
}

type PublishedCandidate = { readonly candidateId: string; readonly sourceObjectId: string; readonly publishedAt: string }

function publicationKey(value: string | undefined): string { const parsed = dateValue(value); return parsed === undefined ? `invalid:${value ?? ''}` : String(parsed) }
function sourcePublicationKeys(extraction: ManagementCommunicationExtractionResult): ReadonlyMap<string, ReadonlySet<string>> {
  const values = new Map<string, Set<string>>(); const add = (item: { readonly sourceObjectId: string; readonly publishedAt?: string }): void => { const set = values.get(item.sourceObjectId) ?? new Set<string>(); set.add(publicationKey(item.publishedAt)); values.set(item.sourceObjectId, set) }
  for (const item of [...extraction.formalGuidanceCandidates, ...extraction.managementOutlookCandidates, ...extraction.kpiCandidates, ...extraction.structuredQaCandidates]) add(item)
  for (const item of extraction.guidance) for (const sourceObjectId of item.sourceCandidateIds) { const set = values.get(sourceObjectId) ?? new Set<string>(); set.add(publicationKey(item.publishedAt)); values.set(sourceObjectId, set) }
  return values
}

function sourcePublicationValue(extraction: ManagementCommunicationExtractionResult, sourceObjectId: string): string | undefined {
  const values = new Map<string, string>(); const add = (item: { readonly sourceObjectId: string; readonly publishedAt?: string }): void => { const key = publicationKey(item.publishedAt); if (!key.startsWith('invalid:')) values.set(key, item.publishedAt!) }
  for (const item of [...extraction.formalGuidanceCandidates, ...extraction.managementOutlookCandidates, ...extraction.kpiCandidates, ...extraction.structuredQaCandidates]) if (item.sourceObjectId === sourceObjectId) add(item)
  for (const item of extraction.guidance) if (item.sourceCandidateIds.includes(sourceObjectId)) add({ sourceObjectId, publishedAt: item.publishedAt })
  return values.size === 1 ? [...values.values()][0] : undefined
}

function filterCandidateFamily<T extends PublishedCandidate>(values: readonly T[], analysisAsOf: string, conflictingSourceIds: ReadonlySet<string>, diagnostics: string[]): readonly T[] {
  const cutoff = dateValue(analysisAsOf); return values.filter((item) => { const published = dateValue(item.publishedAt); if (conflictingSourceIds.has(item.sourceObjectId)) return false; if (published === undefined) { diagnostics.push(`D2_CANDIDATE_PUBLISHED_AT_INVALID:${item.candidateId}`); return false } if (cutoff === undefined || published > cutoff) { diagnostics.push(`D2_CANDIDATE_AFTER_ANALYSIS_ASOF:${item.candidateId}`); return false } return true })
}

function filterExtractionForAnalysisAsOf(extraction: ManagementCommunicationExtractionResult, analysisAsOf: string): { readonly extraction: ManagementCommunicationExtractionResult; readonly diagnostics: readonly string[] } {
  const diagnostics: string[] = []; const publicationKeys = sourcePublicationKeys(extraction); const conflictingSourceIds = new Set<string>(); for (const [sourceObjectId, keys] of publicationKeys) if (keys.size > 1) { conflictingSourceIds.add(sourceObjectId); diagnostics.push(`D2_SOURCE_PUBLISHED_AT_CONFLICT:${sourceObjectId}`) }
  const formalGuidanceCandidates = filterCandidateFamily(extraction.formalGuidanceCandidates, analysisAsOf, conflictingSourceIds, diagnostics); const managementOutlookCandidates = filterCandidateFamily(extraction.managementOutlookCandidates, analysisAsOf, conflictingSourceIds, diagnostics); const kpiCandidates = filterCandidateFamily(extraction.kpiCandidates, analysisAsOf, conflictingSourceIds, diagnostics); const structuredQaCandidates = filterCandidateFamily(extraction.structuredQaCandidates, analysisAsOf, conflictingSourceIds, diagnostics)
  const cutoff = dateValue(analysisAsOf); const guidance = extraction.guidance.filter((item) => { const published = dateValue(item.publishedAt); if (published === undefined) { diagnostics.push(`D2_CANDIDATE_PUBLISHED_AT_INVALID:${item.guidanceId}`); return false } if (cutoff === undefined || published > cutoff) { diagnostics.push(`D2_CANDIDATE_AFTER_ANALYSIS_ASOF:${item.guidanceId}`); return false } if (item.sourceCandidateIds.some((sourceObjectId) => conflictingSourceIds.has(sourceObjectId))) return false; return true })
  const eligibleKpiSources = new Set(kpiCandidates.map((item) => item.sourceObjectId)); const segmentKpis = extraction.segmentKpis.filter((item) => { if (item.sourceCandidateIds.length === 0 || !item.sourceCandidateIds.every((sourceObjectId) => eligibleKpiSources.has(sourceObjectId))) { diagnostics.push(`KPI_PIT_SOURCE_UNAVAILABLE:${item.segmentKey}:${item.metric}:${item.fiscalPeriod}`); return false } return true })
  const hasEligibleEvidence = formalGuidanceCandidates.length > 0 || managementOutlookCandidates.length > 0 || kpiCandidates.length > 0 || structuredQaCandidates.length > 0 || guidance.length > 0 || segmentKpis.length > 0
  const status: ManagementCommunicationExtractionResult['status'] = !hasEligibleEvidence ? 'UNAVAILABLE' : diagnostics.length > 0 ? 'PARTIAL' : extraction.status
  return { extraction: { ...extraction, status, formalGuidanceCandidates, managementOutlookCandidates, kpiCandidates, structuredQaCandidates, guidance, segmentKpis, diagnostics: unique([...extraction.diagnostics, ...diagnostics]) }, diagnostics: unique(diagnostics) }
}

function sourceObjectsFromExtraction(extraction: ManagementCommunicationExtractionResult): { readonly sources: readonly NormalizedResearchSource[]; readonly diagnostics: readonly string[] } {
  const ids = unique([
    ...extraction.formalGuidanceCandidates.map((item) => item.sourceObjectId),
    ...extraction.managementOutlookCandidates.map((item) => item.sourceObjectId),
    ...extraction.kpiCandidates.map((item) => item.sourceObjectId),
    ...extraction.structuredQaCandidates.map((item) => item.sourceObjectId),
    ...extraction.guidance.flatMap((item) => item.sourceCandidateIds),
    ...extraction.segmentKpis.flatMap((item) => item.sourceCandidateIds),
  ])
  const publicationKeys = sourcePublicationKeys(extraction); const diagnostics: string[] = []; const sources = ids.flatMap((id) => {
    const content = extraction.managementOutlookCandidates.find((item) => item.sourceObjectId === id)?.evidenceSpan.exactText
      ?? extraction.structuredQaCandidates.find((item) => item.sourceObjectId === id)?.evidenceSpan.exactText
      ?? 'caller-supplied validated management evidence'
    const keys = publicationKeys.get(id) ?? new Set<string>(); if (keys.size > 1) { diagnostics.push(`D2_SOURCE_PUBLISHED_AT_CONFLICT:${id}`); return [] } const publishedAt = sourcePublicationValue(extraction, id)
    return [{ candidate: { candidateId: id, kind: 'structured_data' as const, tier: 2 as const, title: `Caller management evidence ${id}`, provider: 'caller', ...(publishedAt === undefined ? {} : { publishedAt }), metadata: { d2Validated: true } }, retrievedAt: new Date(0).toISOString(), title: `Caller management evidence ${id}`, content, contentHash: createHash('sha256').update(content).digest('hex'), publisher: 'caller', rights: { accessScope: 'unknown' as const, retentionAllowed: false, aiProcessingAllowed: true, derivativeKnowledgeAllowed: false, redistributionAllowed: false } }]
  })
  return { sources, diagnostics: unique(diagnostics) }
}

function mergeExtractions(values: readonly ManagementCommunicationExtractionResult[], diagnostics: string[]): ManagementCommunicationExtractionResult | undefined {
  if (values.length === 0) return undefined
  const first = values[0]!
  return {
    status: values.every((item) => item.status === 'COMPLETE') ? 'COMPLETE' : values.some((item) => item.status !== 'UNAVAILABLE') ? 'PARTIAL' : 'UNAVAILABLE',
    formalGuidanceCandidates: values.flatMap((item) => item.formalGuidanceCandidates),
    managementOutlookCandidates: values.flatMap((item) => item.managementOutlookCandidates),
    kpiCandidates: values.flatMap((item) => item.kpiCandidates),
    structuredQaCandidates: values.flatMap((item) => item.structuredQaCandidates),
    guidance: values.flatMap((item) => item.guidance),
    segmentKpis: values.flatMap((item) => item.segmentKpis),
    diagnostics: unique([...diagnostics, ...values.flatMap((item) => item.diagnostics)]),
    telemetry: {
      ...first.telemetry,
      calls: values.reduce((sum, item) => sum + item.telemetry.calls, 0),
      repairCalls: values.reduce((sum, item) => sum + item.telemetry.repairCalls, 0),
      inputUnits: values.reduce((sum, item) => sum + item.telemetry.inputUnits, 0),
      rawCandidateCount: values.reduce((sum, item) => sum + item.telemetry.rawCandidateCount, 0),
      validatedCandidateCount: values.reduce((sum, item) => sum + item.telemetry.validatedCandidateCount, 0),
      rejectedCandidateCount: values.reduce((sum, item) => sum + item.telemetry.rejectedCandidateCount, 0),
      projectedGuidanceCount: values.reduce((sum, item) => sum + item.telemetry.projectedGuidanceCount, 0),
      projectedSegmentKpiCount: values.reduce((sum, item) => sum + item.telemetry.projectedSegmentKpiCount, 0),
    },
  }
}

async function automaticallyExtract(input: ResolveManagementCommunicationInput, diagnostics: string[]): Promise<{ readonly extraction?: ManagementCommunicationExtractionResult; readonly sources: readonly NormalizedResearchSource[]; readonly documentCount: number; readonly qaCount: number; readonly attempted: boolean }> {
  if (input.sources === undefined) return { sources: [], documentCount: 0, qaCount: 0, attempted: false }
  const request = { ticker: input.company.symbol, companyName: input.company.name, exchange: input.company.exchange as 'SSE' | 'SZSE' | 'BSE' | undefined, asOf: input.analysisAsOf, lookbackDays: input.lookbackDays }
  const dataResolver = input.dataResolverFactory?.({ request, sources: input.sources, now: input.now ?? (() => new Date().toISOString()), signal: input.signal, diagnostics })
  const [documents, qa] = await Promise.all([
    runManagementCommunicationDocuments({ request, sources: input.sources, now: input.now, signal: input.signal, dataResolver }),
    runExchangeQa({ request, sources: input.sources, now: input.now, signal: input.signal, dataResolver }),
  ])
  diagnostics.push(...documents.diagnostics, ...qa.diagnostics)
  const sourceObjects = [...documents.data.map(sourceFromDocument), ...qa.data.map(sourceFromQa), ...input.officialSources]
  const extractions: ManagementCommunicationExtractionResult[] = []
  if (input.reasoningExecutor !== undefined) {
    for (const document of documents.data) extractions.push(await runManagementCommunicationExtraction({ analysisAsOf: input.analysisAsOf, source: { lane: 'management_document', source: document }, reasoningExecutor: input.reasoningExecutor, signal: input.signal }))
    if (qa.data.length > 0) extractions.push(await runManagementCommunicationExtraction({ analysisAsOf: input.analysisAsOf, source: { lane: 'exchange_qa', sources: qa.data }, reasoningExecutor: input.reasoningExecutor, signal: input.signal }))
    for (const source of input.officialSources) extractions.push(await runManagementCommunicationExtraction({ analysisAsOf: input.analysisAsOf, source: { lane: 'statutory_disclosure', source }, reasoningExecutor: input.reasoningExecutor, signal: input.signal }))
  } else diagnostics.push('MANAGEMENT_COMMUNICATION_REASONING_EXECUTOR_UNAVAILABLE')
  return { extraction: mergeExtractions(extractions, diagnostics), sources: sourceObjects, documentCount: documents.data.length, qaCount: qa.data.length, attempted: true }
}

function outlookKey(candidate: ManagementOutlookCandidate): string { return [normalized(candidate.topic), normalized(candidate.metric ?? ''), normalized(candidate.timeHorizon ?? '')].join('|') }
function directionSign(value: string | undefined): -1 | 0 | 1 | undefined { if (value === 'increase' || value === 'improve') return 1; if (value === 'decrease' || value === 'deteriorate') return -1; if (value === 'stable') return 0; return undefined }
function outlookNumber(candidate: ManagementOutlookCandidate): { readonly value?: number; readonly unit?: string } { const unit = resolveUnit(candidate.rawUnit, candidate.evidenceSpan.exactText ?? ''); const range = parseNumericRange(candidate.rawNumericRange); const token = range === undefined ? parseNumericToken(candidate.rawNumericValue) : undefined; return token === undefined || unit === undefined ? {} : { value: token.value * unit.factor, unit: unit.canonical } }

function absoluteTargetLevel(candidate: ManagementOutlookCandidate): boolean {
  if (candidate.rawNumericRange !== undefined) return true
  const evidence = candidate.evidenceSpan.exactText ?? ''
  if (/%|增长率|增速|同比|环比|margin|margin rate|growth|decline|下降幅度/iu.test(evidence)) return false
  return /达到|目标|不低于|不少于|至少|不超过|至多|target|reach|at least|at most/iu.test(evidence)
}

function commentarySemanticKey(candidate: ManagementOutlookCandidate): string { return [candidate.direction ?? '', candidate.rawNumericValue ?? '', candidate.rawNumericRange ?? '', candidate.rawUnit ?? '', candidate.rawFiscalPeriodText ?? ''].map(normalized).join('|') }

function buildCommentary(outlooks: readonly ManagementOutlookCandidate[], analysisAsOf: string): readonly ManagementCommentaryDelta[] {
  const cutoff = Date.parse(analysisAsOf)
  const eligible = outlooks.filter((candidate) => Number.isFinite(Date.parse(candidate.publishedAt)) && Date.parse(candidate.publishedAt) <= cutoff)
  const groups = new Map<string, ManagementOutlookCandidate[]>()
  for (const candidate of eligible) groups.set(outlookKey(candidate), [...(groups.get(outlookKey(candidate)) ?? []), candidate])
  const output: ManagementCommentaryDelta[] = []
  for (const [key, values] of [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const latestTimestamp = Math.max(...values.map((candidate) => Date.parse(candidate.publishedAt))); const latest = values.filter((candidate) => Date.parse(candidate.publishedAt) === latestTimestamp); const priorCandidates = values.filter((candidate) => Date.parse(candidate.publishedAt) < latestTimestamp).sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt) || right.candidateId.localeCompare(left.candidateId)); const prior = priorCandidates[0]
    const latestBySemantics = new Map<string, ManagementOutlookCandidate>(); for (const candidate of latest.slice().sort((left, right) => left.candidateId.localeCompare(right.candidateId))) { const semanticKey = commentarySemanticKey(candidate); if (!latestBySemantics.has(semanticKey)) latestBySemantics.set(semanticKey, candidate) }
    const latestUnique = [...latestBySemantics.values()].sort((left, right) => left.candidateId.localeCompare(right.candidateId)); const current = latestUnique[0]!; const currentConflict = latestUnique.length > 1
    const currentNumber = outlookNumber(current); const priorNumber = prior === undefined ? {} : outlookNumber(prior); const currentSign = directionSign(current.direction); const priorSign = directionSign(prior?.direction); const diagnostics: string[] = []; let status: ManagementCommentaryDeltaStatus = 'new'
    const comparableNumeric = finite(currentNumber.value) && finite(priorNumber.value) && currentNumber.unit === priorNumber.unit
    const numericChange = comparableNumeric ? { current: currentNumber.value, prior: priorNumber.value, absoluteDelta: currentNumber.value - priorNumber.value, unit: currentNumber.unit } : undefined
    if (currentConflict) { status = 'inconclusive'; diagnostics.push('COMMENTARY_CURRENT_CONFLICT')
    } else if (prior !== undefined) {
      if (currentSign !== undefined && priorSign !== undefined && currentSign !== 0 && priorSign !== 0 && currentSign !== priorSign) status = 'reversed'
      else if (current.direction === prior.direction && comparableNumeric && currentNumber.value === priorNumber.value) status = 'unchanged'
      else if (current.direction === prior.direction && comparableNumeric && absoluteTargetLevel(current) && absoluteTargetLevel(prior)) {
        const currentValue = currentNumber.value!; const priorValue = priorNumber.value!; const increasingTarget = currentSign === 1
        status = increasingTarget ? currentValue > priorValue ? 'strengthened' : 'weakened' : currentValue < priorValue ? 'strengthened' : 'weakened'
      } else status = 'inconclusive'
      if (!comparableNumeric && (finite(currentNumber.value) || finite(priorNumber.value))) diagnostics.push('COMMENTARY_NUMERIC_COMPARISON_INCOMPATIBLE')
      if (comparableNumeric && status === 'inconclusive') diagnostics.push('COMMENTARY_NUMERIC_SEMANTICS_AMBIGUOUS')
    }
    output.push({ key, topic: current.topic, ...(current.metric === undefined ? {} : { metric: current.metric }), ...(current.timeHorizon === undefined ? {} : { timeHorizon: current.timeHorizon }), status, currentCandidateId: current.candidateId, ...(prior === undefined ? {} : { priorCandidateId: prior.candidateId }), ...(current.direction === undefined ? {} : { currentDirection: current.direction }), ...(prior?.direction === undefined ? {} : { priorDirection: prior.direction }), ...(numericChange === undefined || currentConflict ? {} : { numericChange }), sourceCandidateIds: unique([...latest.map((item) => item.sourceObjectId), ...(prior === undefined ? [] : [prior.sourceObjectId])]), diagnostics })
  }
  return output
}

function assessResponse(item: StructuredQAEvidence): QAResponseAssessment {
  const answer = item.answer.trim(); const sourceCandidateIds = unique([item.sourceObjectId, ...item.claimSpans.map((span) => span.sourceObjectId), ...item.managementStatementSpans.map((span) => span.sourceObjectId)])
  if (!answer || /^(不便透露|无法回答|暂无|无可奉告|n\/a|na)$/iu.test(answer)) return { status: 'non_answer', diagnostics: ['QA_RESPONSE_NON_ANSWER'], sourceCandidateIds }
  const questionTokens = item.question.normalize('NFKC').toLocaleLowerCase().split(/[，。！？、；：,!?;:\s]+/u).map((token) => token.trim()).filter((token) => token.length >= 2 && !/^(what|which|when|where|why|how|is|are|the|请问|公司|是否|关于)$/iu.test(token))
  const normalizedQuestion = normalized(item.question); const normalizedAnswer = normalized(answer)
  const sharedMetric = item.explicitlyStatedMetrics.some((metric) => { const value = normalized(metric); return value.length >= 2 && normalizedQuestion.includes(value) && normalizedAnswer.includes(value) })
  const direct = sharedMetric || questionTokens.some((token) => normalizedAnswer.includes(normalized(token)))
  if (direct) return { status: 'direct', diagnostics: [], sourceCandidateIds }
  if (/[\p{L}\p{N}\p{Script=Han}]{2,}/u.test(answer)) return { status: 'partial', diagnostics: ['QA_RESPONSE_PARTIAL_COVERAGE'], sourceCandidateIds }
  return { status: 'inconclusive', diagnostics: ['QA_RESPONSE_EVIDENCE_INSUFFICIENT'], sourceCandidateIds }
}

function normalizedTopicTags(values: readonly string[]): readonly string[] { return [...new Set(values.map((value) => normalized(value)).filter((value) => value !== ''))].sort((left, right) => left.localeCompare(right)) }
function buildQaClusters(values: readonly StructuredQAEvidence[]): readonly QAQuestionCluster[] {
  const groups = new Map<string, StructuredQAEvidence[]>(); for (const item of values) { const tags = normalizedTopicTags(item.topicTags); const product = normalized(item.referencedProductOrSegment ?? ''); const keys = tags.length === 0 ? [`question|${normalized(item.question).slice(0, 120)}`] : tags.map((tag) => `${tag}|${product}`); for (const key of keys) groups.set(key, [...(groups.get(key) ?? []), item]) }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, members]) => { const byPair = new Map<string, StructuredQAEvidence>(); for (const member of members.slice().sort((left, right) => left.candidateId.localeCompare(right.candidateId))) if (!byPair.has(member.pairId)) byPair.set(member.pairId, member); const ordered = [...byPair.values()].sort((left, right) => left.candidateId.localeCompare(right.candidateId)); const first = ordered[0]!; const [topic] = key.split('|'); const clusterId = `qa-cluster-${createHash('sha256').update(key).digest('hex').slice(0, 16)}`; return { clusterId, key, topicTags: topic === 'question' ? [] : [topic], ...(first.referencedProductOrSegment === undefined ? {} : { referencedProductOrSegment: first.referencedProductOrSegment }), members: ordered.map((item): QAQuestionClusterMember => ({ pairId: item.pairId, question: item.question, answer: item.answer, sourceObjectId: item.sourceObjectId, topicTags: normalizedTopicTags(item.topicTags), response: assessResponse(item) })), sourceCandidateIds: unique(ordered.flatMap((item) => [item.sourceObjectId, ...item.claimSpans.map((span) => span.sourceObjectId), ...item.managementStatementSpans.map((span) => span.sourceObjectId)])) } })
}

function periodEnd(period: string | undefined): string | undefined { const match = /^(\d{4})-(FY|Q1|H1|Q3)$/u.exec(period ?? ''); if (!match) return undefined; const month = match[2] === 'Q1' ? '03-31' : match[2] === 'H1' ? '06-30' : match[2] === 'Q3' ? '09-30' : '12-31'; return `${match[1]}-${month}T23:59:59.999+08:00` }
function dateValue(value: string | undefined): number | undefined { if (!text(value)) return undefined; const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : undefined }
function kpiCandidatePoint(candidate: KpiCandidate): { readonly point?: SegmentKpiPoint; readonly scopeLabel?: string; readonly diagnostic?: string } {
  const scopeLabel = text(candidate.rawSegmentLabel) ? candidate.rawSegmentLabel.trim() : text(candidate.rawProductLabel) ? candidate.rawProductLabel.trim() : undefined
  if (scopeLabel === undefined) return { diagnostic: 'EXECUTION_OUTCOME_SCOPE_UNRESOLVED' }
  const period = candidate.fiscalPeriod ?? resolveFiscalPeriod(candidate.rawFiscalPeriodText).fiscalPeriod; const unit = resolveUnit(candidate.rawUnit, candidate.evidenceSpan.exactText ?? ''); const numeric = parseNumericToken(candidate.rawValue)
  if (period === undefined || unit === undefined || numeric === undefined) return { scopeLabel }
  return { scopeLabel, point: { segmentKey: scopeLabel, metric: candidate.metric, fiscalPeriod: period, value: numeric.value * unit.factor, unit: unit.canonical, sourceCandidateIds: [candidate.sourceObjectId] } }
}

function buildExecution(company: ResearchCompanyIdentity, asOf: string, outlooks: readonly ManagementOutlookCandidate[], kpiCandidates: readonly KpiCandidate[], suppliedOutcomes: readonly ManagementOutcome[]): ManagementExecutionResult {
  const commitments: ManagementCommitment[] = outlooks.flatMap((candidate): readonly ManagementCommitment[] => { const unit = resolveUnit(candidate.rawUnit, candidate.evidenceSpan.exactText ?? ''); const range = parseNumericRange(candidate.rawNumericRange); const token = range === undefined ? parseNumericToken(candidate.rawNumericValue) : undefined; const period = resolveFiscalPeriod(candidate.rawFiscalPeriodText).fiscalPeriod; if (unit === undefined || period === undefined || !text(candidate.evidenceSpan.exactText)) return []; if (range !== undefined) return [{ id: candidate.candidateId, statement: candidate.evidenceSpan.exactText, speaker: 'management', publishedAt: candidate.publishedAt, targetMetric: candidate.metric ?? candidate.topic, targetPeriod: period, targetEndDate: periodEnd(period), targetType: 'numeric_range', targetUnit: unit.canonical, targetLow: range[0].value * unit.factor, targetHigh: range[1].value * unit.factor, sourceRefs: [candidate.sourceObjectId] }]; if (token === undefined || !['increase', 'improve', 'decrease', 'deteriorate'].includes(candidate.direction ?? '')) return []; const value = token.value * unit.factor; return [{ id: candidate.candidateId, statement: candidate.evidenceSpan.exactText, speaker: 'management', publishedAt: candidate.publishedAt, targetMetric: candidate.metric ?? candidate.topic, targetPeriod: period, targetEndDate: periodEnd(period), targetType: candidate.direction === 'increase' || candidate.direction === 'improve' ? 'numeric_at_least' : 'numeric_at_most', targetUnit: unit.canonical, ...(candidate.direction === 'increase' || candidate.direction === 'improve' ? { targetLow: value } : { targetHigh: value }), sourceRefs: [candidate.sourceObjectId] }] })
  const diagnostics: string[] = []
  const automaticOutcomes: ManagementOutcome[] = []
  for (const candidate of kpiCandidates) {
    const resolved = kpiCandidatePoint(candidate); if (resolved.diagnostic !== undefined) { diagnostics.push(resolved.diagnostic); continue }; const point = resolved.point; if (point === undefined || resolved.scopeLabel === undefined) continue
    for (const commitment of commitments) {
      const targetEnd = dateValue(commitment.targetEndDate); const published = dateValue(candidate.publishedAt); const commitmentPublished = dateValue(commitment.publishedAt)
      const compatible = commitment.targetMetric === point.metric && commitment.targetPeriod === point.fiscalPeriod && commitment.targetUnit === point.unit
      const scopeCompatible = normalized(commitment.statement).includes(normalized(resolved.scopeLabel))
      const later = published !== undefined && commitmentPublished !== undefined && published > commitmentPublished
      const asOfValue = dateValue(asOf); const due = targetEnd !== undefined && published !== undefined && asOfValue !== undefined && published <= asOfValue && asOfValue >= targetEnd && published >= targetEnd
      const independent = !commitment.sourceRefs.includes(candidate.sourceObjectId)
      if (compatible && !scopeCompatible) diagnostics.push('EXECUTION_OUTCOME_SCOPE_MISMATCH')
      else if (compatible && scopeCompatible && later && due && independent) automaticOutcomes.push({ commitmentId: commitment.id, period: point.fiscalPeriod, observedAt: candidate.publishedAt, value: point.value, unit: point.unit, statement: `Observed ${point.metric} for ${point.segmentKey}`, sourceRefs: [...point.sourceCandidateIds] })
      else if (compatible && !independent) diagnostics.push('EXECUTION_OUTCOME_NOT_INDEPENDENT')
    }
  }
  const validatedCallerOutcomes = suppliedOutcomes.flatMap((outcome): readonly ManagementOutcome[] => {
    const commitment = commitments.find((item) => item.id === outcome.commitmentId); if (commitment === undefined) return []
    const observed = dateValue(outcome.observedAt); const published = dateValue(commitment.publishedAt); const targetEnd = dateValue(commitment.targetEndDate); const asOfValue = dateValue(asOf)
    const valid = observed !== undefined && published !== undefined && asOfValue !== undefined && observed <= asOfValue && observed >= published && outcome.sourceRefs.length > 0 && outcome.period === commitment.targetPeriod && (commitment.targetUnit === undefined || outcome.unit === commitment.targetUnit) && (targetEnd === undefined || (observed >= targetEnd && asOfValue >= targetEnd)) && outcome.sourceRefs.some((sourceRef) => !commitment.sourceRefs.includes(sourceRef))
    if (valid) return [outcome]
    if (outcome.sourceRefs.length > 0 && outcome.sourceRefs.every((sourceRef) => commitment.sourceRefs.includes(sourceRef))) diagnostics.push('EXECUTION_OUTCOME_NOT_INDEPENDENT')
    if (targetEnd !== undefined && (asOfValue === undefined || asOfValue < targetEnd || observed === undefined || observed < targetEnd)) diagnostics.push('EXECUTION_OUTCOME_NOT_DUE')
    return []
  })
  const assessed = assessManagementExecution({ companyRef: company.symbol, commitments, outcomes: [...validatedCallerOutcomes, ...automaticOutcomes], asOf })
  return { ...assessed, status: assessed.assessments.some((item) => item.assessment !== 'inconclusive') ? assessed.status : 'unavailable', diagnostics: unique([...diagnostics, ...assessed.diagnostics]) }
}

function expectationInputs(extraction: ManagementCommunicationExtractionResult | undefined, fiscalYear: number, period: EarningsPeriod, analysisAsOf: string): Pick<ManagementCommunicationResearchResult, 'guidance' | 'currentGuidanceIds' | 'segmentKpiComparisons'> & { readonly diagnostics: readonly string[] } {
  if (extraction === undefined) return { diagnostics: [] }; const targetPeriod = `${fiscalYear}-${period}`; const cutoff = dateValue(analysisAsOf); const guidances = extraction.guidance.filter((item) => { const published = dateValue(item.publishedAt); return published !== undefined && cutoff !== undefined && published <= cutoff && item.fiscalPeriod === targetPeriod }); const latestByKey = new Map<string, GuidanceRange>(); for (const item of guidances) { const key = `${item.metric}|${item.fiscalPeriod}`; const prior = latestByKey.get(key); if (prior === undefined || item.publishedAt > prior.publishedAt) latestByKey.set(key, item) }; const current = [...latestByKey.values()].sort((left, right) => left.guidanceId.localeCompare(right.guidanceId)); const kpis = extraction.segmentKpis.filter((item) => item.fiscalPeriod === targetPeriod); const diagnostics: string[] = []; const segmentKpiComparisons: SegmentKpiDeltaInput[] = kpis.map((currentPoint) => { const expectedPriorPeriod = comparableFiscalPeriod(currentPoint.fiscalPeriod); const prior = expectedPriorPeriod === undefined ? undefined : extraction.segmentKpis.filter((item) => item.segmentKey === currentPoint.segmentKey && item.metric === currentPoint.metric && item.unit === currentPoint.unit && item.fiscalPeriod === expectedPriorPeriod).sort((left, right) => right.sourceCandidateIds.join('|').localeCompare(left.sourceCandidateIds.join('|')))[0]; if (prior === undefined) diagnostics.push(`KPI_NO_COMPARABLE_PRIOR:${currentPoint.segmentKey}:${currentPoint.metric}:${currentPoint.fiscalPeriod}`); return prior === undefined ? { current: currentPoint } : { current: currentPoint, priorComparable: prior } }); return { guidance: extraction.guidance, currentGuidanceIds: current.map((item) => item.guidanceId), segmentKpiComparisons, diagnostics: unique(diagnostics) }
}

export async function resolveManagementCommunication(input: ResolveManagementCommunicationInput): Promise<ManagementCommunicationResearchResult> {
  const diagnostics: string[] = []; const callerExtraction = input.caller?.extraction; const automatic = callerExtraction === undefined ? await automaticallyExtract(input, diagnostics) : { extraction: undefined, sources: [], documentCount: 0, qaCount: 0, attempted: false }; const rawExtraction = callerExtraction ?? automatic.extraction; if (rawExtraction === undefined) diagnostics.push(input.sources === undefined ? 'MANAGEMENT_COMMUNICATION_INPUT_UNAVAILABLE' : 'MANAGEMENT_COMMUNICATION_EXTRACTION_UNAVAILABLE'); const pit = rawExtraction === undefined ? undefined : filterExtractionForAnalysisAsOf(rawExtraction, input.analysisAsOf); const extraction = pit?.extraction; diagnostics.push(...(pit?.diagnostics ?? [])); const comments = buildCommentary(extraction?.managementOutlookCandidates ?? [], input.analysisAsOf); const qaClusters = buildQaClusters(extraction?.structuredQaCandidates ?? []); const execution = buildExecution(input.company, input.analysisAsOf, extraction?.managementOutlookCandidates ?? [], extraction?.kpiCandidates ?? [], input.caller?.executionOutcomes ?? []); const expectations = expectationInputs(extraction, input.fiscalYear, input.period, input.analysisAsOf); const synthetic = callerExtraction === undefined || extraction === undefined ? { sources: [], diagnostics: [] } : sourceObjectsFromExtraction(extraction); diagnostics.push(...synthetic.diagnostics, ...expectations.diagnostics, ...execution.diagnostics); if (extraction?.diagnostics) diagnostics.push(...extraction.diagnostics); const status: ManagementCommunicationResearchResult['status'] = extraction === undefined ? automatic.attempted ? 'partial' : 'unavailable' : extraction.status === 'COMPLETE' && diagnostics.length === 0 ? 'available' : 'partial'; return { status, ...(extraction === undefined ? {} : { extraction }), sourceObjects: callerExtraction === undefined ? automatic.sources : synthetic.sources, guidance: expectations.guidance, currentGuidanceIds: expectations.currentGuidanceIds, segmentKpiComparisons: expectations.segmentKpiComparisons, commentaryDeltas: comments, qaClusters, execution, diagnostics: unique(diagnostics), telemetry: { acquisitionAttempted: automatic.attempted, acquisitionDocumentCount: automatic.documentCount, acquisitionQaCount: automatic.qaCount, extractionCalls: extraction?.telemetry.calls ?? 0, extractedOutlookCount: extraction?.managementOutlookCandidates.length ?? 0, extractedQaCount: extraction?.structuredQaCandidates.length ?? 0, commentaryDeltaCount: comments.length, qaClusterCount: qaClusters.length, executionAssessmentCount: execution.assessments.length } }
}

function append(section: EarningsReviewSection, markdown: string, sourceCandidateIds: readonly string[]): EarningsReviewSection { return { ...section, markdown: `${section.markdown}${section.markdown.endsWith('\n') ? '' : '\n\n'}${markdown}`, sourceCandidateIds: unique([...section.sourceCandidateIds, ...sourceCandidateIds]) } }
function line(item: ManagementCommentaryDelta): string { return `${item.topic}${item.metric === undefined ? '' : ` (${item.metric})`}: ${item.status}${item.currentDirection === undefined ? '' : `; current=${item.currentDirection}`}${item.priorDirection === undefined ? '' : `; prior=${item.priorDirection}`}` }
export function enrichEarningsReviewSectionsWithManagementCommunication(sections: readonly EarningsReviewSection[], result: ManagementCommunicationResearchResult): readonly EarningsReviewSection[] {
  const commentary = result.commentaryDeltas.map(line); const qa = result.qaClusters.map((cluster) => `${cluster.topicTags.join(', ') || cluster.key}: ${cluster.members.map((member) => `${member.pairId}=${member.response.status}`).join(', ')}`); const execution = result.execution.assessments.map((item) => `${item.targetMetric} ${item.targetPeriod}: ${item.assessment}`).concat(result.execution.diagnostics.map((item) => `execution diagnostic: ${item}`)); const sourceIds = unique([...result.sourceObjects.map((source) => source.candidate.candidateId), ...result.commentaryDeltas.flatMap((item) => item.sourceCandidateIds), ...result.qaClusters.flatMap((item) => item.sourceCandidateIds), ...result.execution.assessments.flatMap((item) => item.sourceRefs)])
  return sections.map((section) => { if (section.title === 'Management Guidance' && commentary.length > 0) return append(section, `### Management commentary delta\n${commentary.map((item) => `- ${item}`).join('\n')}`, sourceIds); if (section.title === 'Changes vs Prior Research' && commentary.length > 0) return append(section, `### Management commentary changes\n${commentary.map((item) => `- ${item}`).join('\n')}`, sourceIds); if (section.title === 'Research Gaps / Monitoring' && (qa.length > 0 || execution.length > 0 || result.status !== 'available')) return append(section, `### Management communication monitoring\n${qa.length > 0 ? `${qa.map((item) => `- Q&A cluster: ${item}`).join('\n')}\n` : ''}${execution.length > 0 ? `${execution.map((item) => `- ${item}`).join('\n')}\n` : ''}${result.diagnostics.map((item) => `- diagnostic: ${item}`).join('\n')}`, sourceIds); return section })
}
