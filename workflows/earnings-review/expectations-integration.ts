import type { NormalizedResearchSource, ResearchProviderOutcome } from '../../plugins/research-acquisition/contracts.ts'
import { actualMetricPointFromVerifiedMetric, buildEstimateRevisionBridge, compareActualVsConsensus, compareActualVsPriorEstimate } from '../../skills/earnings-review/expectations/actual-vs-expectation.ts'
import { buildConsensusSnapshot } from '../../skills/earnings-review/expectations/consensus.ts'
import { validateEstimatePoint, selectPriorEstimate } from '../../skills/earnings-review/expectations/matching.ts'
import { buildGuidanceRevisionBridge, compareGuidanceVsConsensus, normalizeGuidanceRange, selectPriorGuidance, validateGuidanceRange } from '../../skills/earnings-review/expectations/guidance.ts'
import { compareSegmentKpi, normalizeSegmentKpiPoint, validateSegmentKpiPoint } from '../../skills/earnings-review/expectations/segment-kpi.ts'
import type { EarningsReviewSection } from '../../skills/earnings-review/contracts.ts'
import type { ConsensusSnapshot, EstimatePoint, GuidanceRange, NumericDelta, NumericRevision, SegmentKpiDeltaInput } from '../../skills/earnings-review/expectations/contracts.ts'
import type { EarningsReviewExpectationsBundle } from './contracts.ts'
import type { EarningsExpectationAnalysis, EarningsExpectationIntegrationInput, SourcedActualExpectationComparison, SourcedEstimateRevision, SourcedGuidanceConsensusComparison, SourcedGuidanceRevision, SourcedSegmentKpiDelta } from './expectations-contracts.ts'

const text = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const uniqueSorted = (values: readonly string[]): readonly string[] => [...new Set(values.filter(text).map((value) => value.trim()))].sort()
const timestamp = (value: unknown): number | undefined => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : undefined
const sourceIds = (...sets: readonly (readonly string[])[]): readonly string[] => uniqueSorted(sets.flat())
const key = (...values: readonly unknown[]): string => values.map((value) => String(value)).join('|')

export interface EarningsExpectationReportContext {
  readonly requestedFiscalPeriod: string
  readonly analysisAsOf: string
  readonly resultPublishedAt?: string
  readonly mode: 'none' | 'caller' | 'automatic'
  readonly acquisitionStatus: 'not_attempted' | 'available' | 'partial' | 'unavailable' | 'failed'
  readonly estimateCount: number
  readonly institutionCount: number
  readonly consensusSnapshotCount: number
  readonly revisionLinkCount: number
  readonly providerOutcomes: readonly ResearchProviderOutcome[]
  readonly diagnostics: readonly string[]
  readonly bundle?: EarningsReviewExpectationsBundle
}

interface SourceRegistry { readonly usable: ReadonlyMap<string, NormalizedResearchSource>; readonly rejected: ReadonlySet<string>; readonly diagnostics: readonly string[] }

function sourceIdentity(source: NormalizedResearchSource): string {
  return JSON.stringify({ content: source.content, contentHash: source.contentHash, provider: source.candidate.provider, url: source.candidate.url ?? source.canonicalUrl ?? '', publishedAt: source.candidate.publishedAt ?? '' })
}

function buildSourceRegistry(sources: readonly NormalizedResearchSource[], analysisAsOf: string): SourceRegistry {
  const grouped = new Map<string, NormalizedResearchSource[]>()
  for (const source of sources) {
    const id = text(source.candidate.candidateId) ? source.candidate.candidateId.trim() : ''
    if (!id) continue
    grouped.set(id, [...(grouped.get(id) ?? []), source])
  }
  const usable = new Map<string, NormalizedResearchSource>(); const rejected = new Set<string>(); const diagnostics: string[] = []; const cutoff = timestamp(analysisAsOf)
  for (const [id, values] of [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const identities = [...new Set(values.map(sourceIdentity))]
    if (identities.length > 1) { rejected.add(id); diagnostics.push(`ambiguous_expectation_source:${id}`); continue }
    const source = values[0]!
    const published = timestamp(source.candidate.publishedAt)
    if (published !== undefined && cutoff !== undefined && published > cutoff) { rejected.add(id); diagnostics.push(`expectation_source_future:${id}`); continue }
    usable.set(id, source)
  }
  return { usable, rejected, diagnostics: [...new Set(diagnostics)].sort() }
}

function resolveSources(ids: readonly string[] | undefined, registry: SourceRegistry, diagnostics: string[], label = 'expectation'): readonly string[] | undefined {
  const normalized = uniqueSorted(ids ?? [])
  if (normalized.length === 0) { diagnostics.push(`${label}_source_evidence_required`); return undefined }
  for (const id of normalized) {
    if (!registry.usable.has(id)) diagnostics.push(registry.rejected.has(id) ? `ambiguous_expectation_source:${id}` : `expectation_source_missing:${id}`)
  }
  return normalized.every((id) => registry.usable.has(id)) ? normalized : undefined
}

function normalizeEstimate(estimate: EstimatePoint, registry: SourceRegistry, analysisAsOf: string, diagnostics: string[]): EstimatePoint | undefined {
  const id = text(estimate.estimateId) ? estimate.estimateId.trim() : 'unknown'
  const validation = validateEstimatePoint({ ...estimate, estimateId: id, sourceCandidateIds: uniqueSorted(estimate.sourceCandidateIds ?? []) })
  if (validation.length > 0) { diagnostics.push(...validation.map((item) => `estimate_invalid:${id}:${item}`)); return undefined }
  const published = timestamp(estimate.publishedAt); const cutoff = timestamp(analysisAsOf)
  if (published === undefined || (cutoff !== undefined && published > cutoff)) { diagnostics.push(`estimate_after_analysis_asOf:${id}`); return undefined }
  const ids = resolveSources(estimate.sourceCandidateIds, registry, diagnostics, `estimate:${id}`); if (ids === undefined) return undefined
  return { ...estimate, estimateId: id, metric: estimate.metric.trim(), fiscalPeriod: estimate.fiscalPeriod.trim(), unit: estimate.unit.trim(), institutionKey: estimate.institutionKey.trim(), sourceCandidateIds: ids }
}

function snapshotSemantic(snapshot: ConsensusSnapshot): string { return JSON.stringify({ ...snapshot, contributingEstimateIds: uniqueSorted(snapshot.contributingEstimateIds) }) }
function sameNumber(left: number | undefined, right: number | undefined): boolean { return left === right || (left !== undefined && right !== undefined && Object.is(left, right)) }

function validateSnapshot(snapshot: ConsensusSnapshot, estimates: ReadonlyMap<string, EstimatePoint>, analysisAsOf: string, diagnostics: string[]): ConsensusSnapshot | undefined {
  const metric = text(snapshot.metric) ? snapshot.metric.trim() : ''; const period = text(snapshot.fiscalPeriod) ? snapshot.fiscalPeriod.trim() : ''; const unit = text(snapshot.unit) ? snapshot.unit.trim() : ''; const asOf = timestamp(snapshot.asOf); const cutoff = timestamp(analysisAsOf); const ids = uniqueSorted(snapshot.contributingEstimateIds ?? [])
  if (!metric || !period || !unit || asOf === undefined || cutoff === undefined || asOf > cutoff || !finite(snapshot.mean) || !finite(snapshot.median) || !finite(snapshot.high) || !finite(snapshot.low) || (snapshot.dispersion !== undefined && !finite(snapshot.dispersion)) || !Number.isInteger(snapshot.count) || snapshot.count < 2 || ids.length !== snapshot.count || ids.length !== (snapshot.contributingEstimateIds ?? []).length) { diagnostics.push(`consensus_inconsistent:${metric || 'unknown'}:${period || 'unknown'}:${snapshot.asOf}`); return undefined }
  const contributors = ids.map((id) => estimates.get(id));
  if (contributors.some((item) => item === undefined) || contributors.some((item) => item!.metric !== metric || item!.fiscalPeriod !== period || item!.unit !== unit || timestamp(item!.publishedAt)! > asOf)) { diagnostics.push(`consensus_inconsistent:${metric}:${period}:${snapshot.asOf}`); return undefined }
  const rebuilt = buildConsensusSnapshot({ estimates: contributors as EstimatePoint[], metric, fiscalPeriod: period, asOf: snapshot.asOf, minimumCount: snapshot.count })
  const expected = rebuilt.snapshot
  if (expected === undefined || !sameNumber(expected.mean, snapshot.mean) || !sameNumber(expected.median, snapshot.median) || !sameNumber(expected.high, snapshot.high) || !sameNumber(expected.low, snapshot.low) || !sameNumber(expected.dispersion, snapshot.dispersion) || expected.count !== snapshot.count || uniqueSorted(expected.contributingEstimateIds).join('|') !== ids.join('|')) { diagnostics.push(`consensus_inconsistent:${metric}:${period}:${snapshot.asOf}`); return undefined }
  return { ...snapshot, metric, fiscalPeriod: period, unit, contributingEstimateIds: ids }
}

function selectConsensus(snapshots: readonly ConsensusSnapshot[], metric: string, period: string, unit: string, before: number | undefined, analysisAsOf: string, diagnostics: string[], strictBefore = true): ConsensusSnapshot | undefined {
  const cutoff = timestamp(analysisAsOf); const candidates = snapshots.filter((snapshot) => snapshot.metric === metric && snapshot.fiscalPeriod === period && snapshot.unit === unit && timestamp(snapshot.asOf) !== undefined && cutoff !== undefined && timestamp(snapshot.asOf)! <= cutoff && (before === undefined || (strictBefore ? timestamp(snapshot.asOf)! < before : timestamp(snapshot.asOf)! <= before)))
  if (candidates.length === 0) return undefined
  const latest = Math.max(...candidates.map((snapshot) => timestamp(snapshot.asOf)!)); const sameTime = candidates.filter((snapshot) => timestamp(snapshot.asOf) === latest).sort((left, right) => snapshotSemantic(left).localeCompare(snapshotSemantic(right)))
  const unique = [...new Map(sameTime.map((snapshot) => [snapshotSemantic(snapshot), snapshot])).values()]
  if (unique.length > 1) { diagnostics.push(`ambiguous_consensus_snapshot:${metric}:${period}:${new Date(latest).toISOString()}`); return undefined }
  return unique[0]
}

function addActualResult(target: SourcedActualExpectationComparison[], result: ReturnType<typeof compareActualVsConsensus>, ids: readonly string[]): void { if (result !== undefined) target.push({ result, sourceCandidateIds: uniqueSorted(ids) }) }

function normalizeGuidance(guidance: GuidanceRange, registry: SourceRegistry, analysisAsOf: string, diagnostics: string[]): GuidanceRange | undefined {
  const id = text(guidance.guidanceId) ? guidance.guidanceId.trim() : 'unknown'; const sourceCandidateIds = uniqueSorted(guidance.sourceCandidateIds ?? []); const normalized = normalizeGuidanceRange({ ...guidance, guidanceId: id, sourceCandidateIds }, analysisAsOf); const validation = validateGuidanceRange({ ...guidance, guidanceId: id, sourceCandidateIds }, analysisAsOf)
  if (normalized === undefined || validation.length > 0) { diagnostics.push(...(validation.length ? validation : ['invalid']).map((item) => `guidance_invalid:${id}:${item}`)); return undefined }
  const ids = resolveSources(normalized.sourceCandidateIds, registry, diagnostics, `guidance:${id}`); return ids === undefined ? undefined : { ...normalized, sourceCandidateIds: ids }
}

function normalizeSegmentInput(input: SegmentKpiDeltaInput, registry: SourceRegistry, diagnostics: string[]): SegmentKpiDeltaInput | undefined {
  const normalize = (point: SegmentKpiDeltaInput['current'] | undefined): SegmentKpiDeltaInput['current'] | undefined => {
    if (point === undefined) return undefined
    const normalized = normalizeSegmentKpiPoint({ ...point, sourceCandidateIds: uniqueSorted(point.sourceCandidateIds ?? []) }); if (normalized === undefined || validateSegmentKpiPoint(normalized).length > 0) return undefined
    const ids = resolveSources(normalized.sourceCandidateIds, registry, diagnostics, `segment:${normalized.segmentKey}:${normalized.metric}`); return ids === undefined ? undefined : { ...normalized, sourceCandidateIds: ids }
  }
  const current = normalize(input.current); const priorComparable = normalize(input.priorComparable); const expectation = normalize(input.expectation)
  if (current === undefined || (input.priorComparable !== undefined && priorComparable === undefined) || (input.expectation !== undefined && expectation === undefined)) { const point = input.current; diagnostics.push(`segment_kpi_invalid:${point.segmentKey || 'unknown'}:${point.metric || 'unknown'}`); return undefined }
  return { current, ...(priorComparable === undefined ? {} : { priorComparable }), ...(expectation === undefined ? {} : { expectation }) }
}

function emptyAnalysis(diagnostics: readonly string[] = []): EarningsExpectationAnalysis { return { consensusStatus: 'unavailable', actualVsConsensus: [], actualVsPriorEstimate: [], estimateRevisions: [], guidanceRevisions: [], guidanceVsConsensus: [], segmentKpiDeltas: [], currentGuidance: [], diagnostics: uniqueSorted(diagnostics) } }

export function buildEarningsExpectationAnalysis(input: EarningsExpectationIntegrationInput): EarningsExpectationAnalysis {
  const bundle = input.expectations; if (bundle === undefined) return emptyAnalysis()
  const diagnostics: string[] = []; const registry = buildSourceRegistry(bundle.sources ?? [], input.analysisAsOf); diagnostics.push(...registry.diagnostics)
  const rawResultCutoff = input.resultPublishedAt ?? bundle.resultPublishedAt; const parsedResultTime = rawResultCutoff === undefined ? undefined : timestamp(rawResultCutoff); const analysisTime = timestamp(input.analysisAsOf); const resultCutoffValid = parsedResultTime !== undefined && analysisTime !== undefined && parsedResultTime <= analysisTime; const resultCutoff = resultCutoffValid ? rawResultCutoff : undefined; const resultTime = resultCutoffValid ? parsedResultTime : undefined
  if (rawResultCutoff !== undefined && !resultCutoffValid) diagnostics.push(parsedResultTime === undefined ? 'resultPublishedAt_invalid' : 'resultPublishedAt_after_analysisAsOf')
  if (resultTime === undefined) diagnostics.push('result_publication_cutoff_unavailable')
  const estimateMap = new Map<string, EstimatePoint>(); const estimateIdCounts = new Map<string, number>()
  for (const estimate of bundle.estimates ?? []) { const id = text(estimate.estimateId) ? estimate.estimateId.trim() : ''; if (id) estimateIdCounts.set(id, (estimateIdCounts.get(id) ?? 0) + 1) }
  for (const estimate of bundle.estimates ?? []) { const id = text(estimate.estimateId) ? estimate.estimateId.trim() : 'unknown'; if ((estimateIdCounts.get(id) ?? 0) > 1) { diagnostics.push(`estimate_invalid:${id}:duplicate_estimateId`); continue }; const normalized = normalizeEstimate(estimate, registry, input.analysisAsOf, diagnostics); if (normalized !== undefined) estimateMap.set(normalized.estimateId, normalized) }
  const validSnapshots: ConsensusSnapshot[] = []; const snapshotKeys = new Set<string>()
  for (const snapshot of bundle.consensusSnapshots ?? []) { if (resultTime !== undefined && timestamp(snapshot.asOf) !== undefined && timestamp(snapshot.asOf)! >= resultTime) diagnostics.push(`consensus_not_pre_result:${snapshot.metric}:${snapshot.fiscalPeriod}:${snapshot.asOf}`); const normalized = validateSnapshot(snapshot, estimateMap, input.analysisAsOf, diagnostics); if (normalized === undefined) continue; const semantic = snapshotSemantic(normalized); if (!snapshotKeys.has(semantic)) { snapshotKeys.add(semantic); validSnapshots.push(normalized) } }
  const actualVsConsensus: SourcedActualExpectationComparison[] = []; const actualVsPriorEstimate: SourcedActualExpectationComparison[] = []
  const actuals = input.actualMetrics.map(actualMetricPointFromVerifiedMetric).filter((item): item is NonNullable<ReturnType<typeof actualMetricPointFromVerifiedMetric>> => item !== undefined).sort((left, right) => key(left.metric, left.fiscalPeriod, left.unit).localeCompare(key(right.metric, right.fiscalPeriod, right.unit)))
  for (const actual of actuals) {
    if (resultTime !== undefined) for (const snapshot of validSnapshots.filter((item) => item.metric === actual.metric && item.fiscalPeriod === actual.fiscalPeriod && item.unit === actual.unit && timestamp(item.asOf)! >= resultTime)) diagnostics.push(`consensus_not_pre_result:${actual.metric}:${actual.fiscalPeriod}:${snapshot.asOf}`)
    const selected = resultTime === undefined ? undefined : selectConsensus(validSnapshots, actual.metric, actual.fiscalPeriod, actual.unit, resultTime, input.analysisAsOf, diagnostics)
     if (selected !== undefined) { const contributors = selected.contributingEstimateIds.flatMap((id) => estimateMap.get(id)?.sourceCandidateIds ?? []); addActualResult(actualVsConsensus, compareActualVsConsensus(actual, selected), sourceIds(actual.sourceCandidateIds, contributors)) }
     for (const institutionKey of uniqueSorted(bundle.priorEstimateInstitutionKeys ?? [])) {
       if (resultTime === undefined) continue
       const matchingEstimateExists = [...estimateMap.values()].some((estimate) => estimate.institutionKey === institutionKey && estimate.metric === actual.metric && estimate.fiscalPeriod === actual.fiscalPeriod)
       if (!matchingEstimateExists) continue
       const prior = selectPriorEstimate({ estimates: [...estimateMap.values()], metric: actual.metric, fiscalPeriod: actual.fiscalPeriod, institutionKey, beforePublishedAt: resultCutoff!, analysisAsOf: input.analysisAsOf }); const result = compareActualVsPriorEstimate({ actual, estimates: [...estimateMap.values()], institutionKey, comparisonCutoff: resultCutoff! }); if (result !== undefined && prior !== undefined) actualVsPriorEstimate.push({ result, sourceCandidateIds: sourceIds(actual.sourceCandidateIds, prior.sourceCandidateIds), institutionKey }); else diagnostics.push(`prior_estimate_unavailable:${institutionKey}:${actual.metric}`)
     }
  }
  const estimateRevisions: SourcedEstimateRevision[] = []; const revisionTargets = new Map<string, string[]>(); const seenRevisionLinks = new Set<string>()
  for (const link of bundle.estimateRevisionLinks ?? []) {
    const oldId = text(link.oldEstimateId) ? link.oldEstimateId.trim() : ''; const newId = text(link.newEstimateId) ? link.newEstimateId.trim() : ''; const linkKey = `${oldId}->${newId}`
    if (seenRevisionLinks.has(linkKey)) continue
    seenRevisionLinks.add(linkKey)
    const oldEstimate = estimateMap.get(oldId); const newEstimate = estimateMap.get(newId); const result = oldEstimate === undefined || newEstimate === undefined ? undefined : buildEstimateRevisionBridge({ oldEstimate, newEstimate })
    if (result === undefined) { diagnostics.push(`estimate_revision_invalid:${oldId || 'unknown'}->${newId || 'unknown'}`); continue }
    revisionTargets.set(newId, [...(revisionTargets.get(newId) ?? []), oldId])
  }
  for (const [newId, oldIds] of revisionTargets) {
    if (oldIds.length > 1) { diagnostics.push(`ambiguous_revision_target:${newId}`); continue }
    const oldEstimate = estimateMap.get(oldIds[0]!); const newEstimate = estimateMap.get(newId); const result = oldEstimate === undefined || newEstimate === undefined ? undefined : buildEstimateRevisionBridge({ oldEstimate, newEstimate })
    if (result === undefined) diagnostics.push(`estimate_revision_invalid:${oldIds[0] ?? 'unknown'}->${newId}`); else estimateRevisions.push({ result, sourceCandidateIds: sourceIds(oldEstimate!.sourceCandidateIds, newEstimate!.sourceCandidateIds) })
  }
  const normalizedGuidances = new Map<string, GuidanceRange>();
  const currentGuidance: GuidanceRange[] = []; const guidanceRevisions: SourcedGuidanceRevision[] = []; const guidanceVsConsensus: SourcedGuidanceConsensusComparison[] = []
  const ambiguousGuidanceIds = new Set<string>();
  for (const guidance of bundle.guidances ?? []) { const normalized = normalizeGuidance(guidance, registry, input.analysisAsOf, diagnostics); if (normalized !== undefined) { const prior = normalizedGuidances.get(normalized.guidanceId); if (prior !== undefined && JSON.stringify(prior) !== JSON.stringify(normalized)) { ambiguousGuidanceIds.add(normalized.guidanceId); diagnostics.push(`guidance_invalid:${normalized.guidanceId}:duplicate_guidance_id`) } else normalizedGuidances.set(normalized.guidanceId, normalized) } }
  const suppliedCurrentGuidanceIds = (bundle.currentGuidanceIds ?? []).filter(text).map((id) => id.trim()); const duplicateCurrentGuidanceIds = new Set(suppliedCurrentGuidanceIds.filter((id, index) => suppliedCurrentGuidanceIds.indexOf(id) !== index)); for (const id of uniqueSorted(suppliedCurrentGuidanceIds)) { if (duplicateCurrentGuidanceIds.has(id)) { diagnostics.push(`current_guidance_missing:${id}`); continue }; const current = normalizedGuidances.get(id); if (current === undefined || ambiguousGuidanceIds.has(id)) { diagnostics.push(`current_guidance_missing:${id}`); continue }; currentGuidance.push(current); const priorSelection = selectPriorGuidance({ guidances: [...normalizedGuidances.values()], metric: current.metric, fiscalPeriod: current.fiscalPeriod, beforePublishedAt: current.publishedAt, analysisAsOf: input.analysisAsOf }); diagnostics.push(...priorSelection.diagnostics.map((item) => `${id}:${item}`)); if (priorSelection.selected !== undefined) { const result = buildGuidanceRevisionBridge({ oldGuidance: priorSelection.selected, newGuidance: current }); if (result !== undefined) guidanceRevisions.push({ result, sourceCandidateIds: sourceIds(priorSelection.selected.sourceCandidateIds, current.sourceCandidateIds) }) }
    const selected = selectConsensus(validSnapshots, current.metric, current.fiscalPeriod, current.unit ?? '', timestamp(current.publishedAt), input.analysisAsOf, diagnostics, false); if (selected !== undefined) { const result = compareGuidanceVsConsensus({ guidance: current, consensus: selected, analysisAsOf: input.analysisAsOf }); if (result !== undefined) guidanceVsConsensus.push({ result, sourceCandidateIds: sourceIds(current.sourceCandidateIds, selected.contributingEstimateIds.flatMap((estimateId) => estimateMap.get(estimateId)?.sourceCandidateIds ?? [])) }) }
  }
  const segmentKpiDeltas: SourcedSegmentKpiDelta[] = []; for (const inputSegment of bundle.segmentKpiComparisons ?? []) { const normalized = normalizeSegmentInput(inputSegment, registry, diagnostics); if (normalized === undefined) { const point = inputSegment.current; diagnostics.push(`segment_kpi_invalid:${point.segmentKey || 'unknown'}:${point.metric || 'unknown'}`); continue }; const result = compareSegmentKpi(normalized); if (result === undefined) { const point = inputSegment.current; diagnostics.push(`segment_kpi_invalid:${point.segmentKey || 'unknown'}:${point.metric || 'unknown'}`) } else segmentKpiDeltas.push({ result, sourceCandidateIds: sourceIds(normalized.current.sourceCandidateIds, normalized.priorComparable?.sourceCandidateIds ?? [], normalized.expectation?.sourceCandidateIds ?? []) }) }
  const sort = <T>(values: readonly T[], selector: (value: T) => string): readonly T[] => [...values].sort((left, right) => selector(left).localeCompare(selector(right)))
  const uniqueResults = <T>(values: readonly T[], selector: (value: T) => string): readonly T[] => [...new Map(values.map((value) => [selector(value), value])).values()]
  const comparisons = uniqueResults(sort(actualVsConsensus, (item) => key(item.result.metric, item.result.fiscalPeriod, item.result.benchmark)), (item) => key(item.result.metric, item.result.fiscalPeriod, item.result.actual, item.result.benchmark, item.result.absoluteDelta, item.result.relativeDelta, item.result.direction)); const priorComparisons = uniqueResults(sort(actualVsPriorEstimate, (item) => key(item.institutionKey, item.result.metric, item.result.fiscalPeriod, item.result.benchmark, item.result.direction)), (item) => key(item.institutionKey, item.result.metric, item.result.fiscalPeriod, item.result.actual, item.result.benchmark, item.result.absoluteDelta, item.result.relativeDelta, item.result.direction)); const revisions = uniqueResults(sort(estimateRevisions, (item) => key(item.result.institutionKey, item.result.metric, item.result.fiscalPeriod, item.result.oldPublishedAt, item.result.newPublishedAt)), (item) => key(item.result.institutionKey, item.result.metric, item.result.fiscalPeriod, item.result.oldValue, item.result.newValue, item.result.oldPublishedAt, item.result.newPublishedAt)); const guidanceRevisionResults = uniqueResults(sort(guidanceRevisions, (item) => key(item.result.metric, item.result.fiscalPeriod, item.result.oldGuidanceId, item.result.newGuidanceId)), (item) => key(item.result.metric, item.result.fiscalPeriod, item.result.oldGuidanceId, item.result.newGuidanceId)); const guidanceConsensusResults = uniqueResults(sort(guidanceVsConsensus, (item) => key(item.result.metric, item.result.fiscalPeriod, item.result.guidanceId, item.result.consensusAsOf)), (item) => key(item.result.metric, item.result.fiscalPeriod, item.result.guidanceId, item.result.consensusAsOf, item.result.consensusMean, item.result.absoluteDelta, item.result.relativeDelta, item.result.direction)); const segmentResults = uniqueResults(sort(segmentKpiDeltas, (item) => key(item.result.segmentKey, item.result.metric, item.result.currentPeriod)), (item) => key(item.result.segmentKey, item.result.metric, item.result.currentPeriod, item.result.currentValue, item.result.priorPeriod, item.result.expectationPeriod));
  return { consensusStatus: comparisons.length > 0 ? 'available' : 'unavailable', actualVsConsensus: comparisons, actualVsPriorEstimate: priorComparisons, estimateRevisions: revisions, guidanceRevisions: guidanceRevisionResults, guidanceVsConsensus: guidanceConsensusResults, segmentKpiDeltas: segmentResults, currentGuidance: uniqueResults(sort(currentGuidance, (item) => item.guidanceId), (item) => item.guidanceId), diagnostics: uniqueSorted(diagnostics) }
}

function append(section: EarningsReviewSection, textToAppend: string, sourceIdsToAppend: readonly string[]): EarningsReviewSection { return { ...section, markdown: `${section.markdown}${section.markdown.endsWith('\n') ? '' : '\n\n'}${textToAppend}`, sourceCandidateIds: uniqueSorted([...section.sourceCandidateIds, ...sourceIdsToAppend]) } }
function lines(title: string, values: readonly string[]): string { return values.length === 0 ? '' : `### ${title}\n${values.map((value) => `- ${value}`).join('\n')}` }
function finiteText(value: unknown): string | undefined { return finite(value) ? String(value) : undefined }
function relativePercentText(value: number | undefined): string | undefined { if (value === undefined || !Number.isFinite(value)) return undefined; const percentage = value * 100; return Number.isFinite(percentage) ? `${percentage}%` : undefined }
function field(label: string, value: string | undefined): string | undefined { return value === undefined ? undefined : `${label}=${value}` }
function renderParts(parts: readonly (string | undefined)[]): string { return parts.filter((part): part is string => part !== undefined && part !== '').join('; ') }
function renderActualComparison(item: SourcedActualExpectationComparison, benchmarkLabel: string): string {
  const result = item.result
  return renderParts([`${result.metric} ${result.fiscalPeriod}`, field('institution', item.institutionKey), field('actual', finiteText(result.actual)), field(benchmarkLabel, finiteText(result.benchmark)), field('absolute delta', finiteText(result.absoluteDelta)), field('relative delta', relativePercentText(result.relativeDelta)), field('direction', result.direction)])
}
function renderEstimateRevision(item: SourcedEstimateRevision): string {
  const result = item.result
  return renderParts([`${result.institutionKey} ${result.metric} ${result.fiscalPeriod}`, field('oldValue', finiteText(result.oldValue)), field('newValue', finiteText(result.newValue)), field('absoluteRevision', finiteText(result.absoluteRevision)), field('relativeRevision', relativePercentText(result.relativeRevision)), field('oldPublishedAt', result.oldPublishedAt), field('newPublishedAt', result.newPublishedAt)])
}
function renderNumericRevision(label: string, revision: NumericRevision | undefined): string | undefined {
  if (revision === undefined) return undefined
  return renderParts([label, field('oldValue', finiteText(revision.oldValue)), field('newValue', finiteText(revision.newValue)), field('absoluteRevision', finiteText(revision.absoluteRevision)), field('relativeRevision', relativePercentText(revision.relativeRevision))])
}
function renderGuidanceRevision(item: SourcedGuidanceRevision): string {
  const result = item.result
  return renderParts([`${result.metric} ${result.fiscalPeriod}`, renderNumericRevision('low-end revision', result.lowEndRevision), renderNumericRevision('high-end revision', result.highEndRevision), renderNumericRevision('midpoint revision', result.midpointRevision), renderNumericRevision('range-width change', result.rangeWidthChange)])
}
function renderCurrentGuidance(guidance: GuidanceRange): string {
  if (guidance.guidanceType === 'qualitative') return renderParts([`${guidance.guidanceId} ${guidance.metric} ${guidance.fiscalPeriod}: qualitative`, field('qualifiers', guidance.qualifiers.join(', ')), field('published', guidance.publishedAt)])
  return renderParts([`${guidance.guidanceId} ${guidance.metric} ${guidance.fiscalPeriod}`, field('low', finiteText(guidance.low)), field('high', finiteText(guidance.high)), field('midpoint', finiteText(guidance.midpoint)), field('unit', guidance.unit), field('published', guidance.publishedAt)])
}
function renderGuidanceConsensus(item: SourcedGuidanceConsensusComparison): string {
  const result = item.result
  return renderParts([`${result.guidanceId} ${result.metric} ${result.fiscalPeriod}`, field('consensusMean', finiteText(result.consensusMean)), field('relationship', result.relationship), field('guidanceMidpoint', finiteText(result.guidanceMidpoint)), field('absoluteDelta', finiteText(result.absoluteDelta)), field('relativeDelta', relativePercentText(result.relativeDelta)), field('direction', result.direction), field('consensusAsOf', result.consensusAsOf), field('guidancePublishedAt', result.guidancePublishedAt)])
}
function renderNumericDelta(label: string, delta: NumericDelta | undefined): string | undefined {
  if (delta === undefined) return undefined
  return renderParts([label, field('benchmark', finiteText(delta.benchmark)), field('actual', finiteText(delta.actual)), field('absolute delta', finiteText(delta.absoluteDelta)), field('relative delta', relativePercentText(delta.relativeDelta)), field('direction', delta.direction)])
}
function renderSegment(item: SourcedSegmentKpiDelta): string {
  const result = item.result
  return renderParts([`${result.segmentKey} ${result.metric}`, field('currentPeriod', result.currentPeriod), field('currentValue', finiteText(result.currentValue)), field('priorPeriod', result.priorPeriod), renderNumericDelta('prior comparison', result.priorComparison), field('expectationPeriod', result.expectationPeriod), renderNumericDelta('expectation comparison', result.expectationComparison)])
}

export function enrichEarningsReviewSectionsWithExpectations(sections: readonly EarningsReviewSection[], analysis: EarningsExpectationAnalysis, context?: EarningsExpectationReportContext): readonly EarningsReviewSection[] {
  const sourceIdsFor = (values: readonly { readonly sourceCandidateIds: readonly string[] }[]): readonly string[] => uniqueSorted(values.flatMap((value) => value.sourceCandidateIds))
  const actual = analysis.actualVsConsensus.map((item) => renderActualComparison(item, 'PIT consensus')); const prior = analysis.actualVsPriorEstimate.map((item) => renderActualComparison(item, 'selected prior estimate'))
  const revisions = analysis.estimateRevisions.map(renderEstimateRevision); const guidanceRevisionText = analysis.guidanceRevisions.map(renderGuidanceRevision); const guidanceText = analysis.currentGuidance.map(renderCurrentGuidance); const guidanceConsensusText = analysis.guidanceVsConsensus.map(renderGuidanceConsensus); const segments = analysis.segmentKpiDeltas.map(renderSegment)
  const expectationReportLines = context === undefined ? [] : renderExpectationReport(context, analysis)
  const expectationSourceIds = context?.bundle?.sources.map((source) => source.candidate.candidateId) ?? []
  const result = sections.map((section) => {
    if (section.title === 'Earnings Snapshot') {
      const additions = [
        lines('Actual vs PIT consensus', actual),
        prior.length ? lines('Actual vs selected prior estimate', prior) : '',
        expectationReportLines.join('\n'),
      ].filter((value) => value !== '')
      if (additions.length > 0) return append(section, additions.join('\n\n'), [...sourceIdsFor([...analysis.actualVsConsensus, ...analysis.actualVsPriorEstimate]), ...expectationSourceIds])
    }
    if (section.title === 'Changes vs Prior Research' && (revisions.length || guidanceRevisionText.length)) return append(section, lines('Estimate revisions', revisions) + (guidanceRevisionText.length ? `\n\n${lines('Guidance revisions', guidanceRevisionText)}` : ''), sourceIdsFor([...analysis.estimateRevisions, ...analysis.guidanceRevisions]))
    if (section.title === 'Management Guidance' && (guidanceText.length || guidanceRevisionText.length || guidanceConsensusText.length)) return append(section, lines('Current normalized Guidance', guidanceText) + (guidanceRevisionText.length ? `\n\n${lines('Guidance vs prior', guidanceRevisionText)}` : '') + (guidanceConsensusText.length ? `\n\n${lines('Guidance vs PIT consensus', guidanceConsensusText)}` : ''), sourceIdsFor([...analysis.guidanceRevisions, ...analysis.guidanceVsConsensus, ...analysis.currentGuidance.map((guidance) => ({ sourceCandidateIds: guidance.sourceCandidateIds }))]))
    if (section.title === 'Segment Performance' && segments.length) return append(section, lines('Deterministic Segment KPI comparisons', segments), sourceIdsFor(analysis.segmentKpiDeltas))
    if (section.title === 'Valuation Implications' && analysis.actualVsConsensus.length > 0) { const withoutSentinel = { ...section, markdown: section.markdown.replace('Consensus unavailable', '').trim() }; return append(withoutSentinel, `### Expectation availability\nPoint-in-time consensus comparison is available for ${analysis.actualVsConsensus.length} current-period metric(s).\nValuation impact is not calculated in W2-004.`, sourceIdsFor(analysis.actualVsConsensus)) }
    return section
  })
  return result.length === EARNINGS_REVIEW_SECTION_COUNT ? result : sections
}

function renderExpectationReport(context: EarningsExpectationReportContext, analysis: EarningsExpectationAnalysis): readonly string[] {
  const sourceById = new Map((context.bundle?.sources ?? []).map((source) => [source.candidate.candidateId, source]))
  const providerLines = context.providerOutcomes.map((outcome) => `${outcome.provider}: ${outcome.providerAttempted ? 'attempted' : 'not attempted'}; ${outcome.providerFailed ? 'failed' : outcome.providerEmpty ? 'empty' : outcome.providerSucceeded ? 'usable data' : 'no usable data'}; usable sources ${outcome.usableSourceCount}`)
  const estimates = [...(context.bundle?.estimates ?? [])].sort((left, right) => `${left.fiscalPeriod}|${left.metric}|${left.institutionKey}|${left.publishedAt}|${left.estimateId}`.localeCompare(`${right.fiscalPeriod}|${right.metric}|${right.institutionKey}|${right.publishedAt}|${right.estimateId}`))
  const estimateLines = estimates.map((estimate) => {
    const refs = estimate.sourceCandidateIds.map((id) => {
      const source = sourceById.get(id)
      const url = source?.candidate.url
      if (source === undefined) return id
      const metadata = source.candidate.metadata ?? {}
      const publisher = metadata.originPublisher ?? source.publisher
      const retrievalProvider = metadata.retrievalProvider ?? source.candidate.provider
      const verifiedUrl = url !== undefined && /^https:\/\//iu.test(url) ? url : 'unavailable'
      return `${id}; publisher ${String(publisher)}; retrieved by ${String(retrievalProvider)} at ${source.retrievedAt}; URL ${verifiedUrl}`
    }).join(', ')
    return `${estimate.institutionKey}${estimate.analystKey ? ` / ${estimate.analystKey}` : ''}: ${estimate.metric} ${estimate.fiscalPeriod} ${estimate.value} ${estimate.unit}; published ${estimate.publishedAt}; source ${refs || 'unavailable'}`
  })
  const consensusLines = (context.bundle?.consensusSnapshots ?? []).map((snapshot) => `${snapshot.metric} ${snapshot.fiscalPeriod}: n=${snapshot.count}; mean ${snapshot.mean} ${snapshot.unit}; median ${snapshot.median}; low ${snapshot.low}; high ${snapshot.high}; asOf ${snapshot.asOf}`)
  const eligibleCount = analysis.actualVsConsensus.length
  const cutoff = context.resultPublishedAt ?? context.bundle?.resultPublishedAt
  const header = [
    `Requested actual period: ${context.requestedFiscalPeriod}; analysis asOf ${context.analysisAsOf}; official result cutoff ${cutoff ?? 'unavailable'}.`,
    `Expectation acquisition: mode ${context.mode}; status ${context.acquisitionStatus}; estimates ${context.estimateCount}; institutions ${context.institutionCount}; consensus snapshots ${context.consensusSnapshotCount}; revision links ${context.revisionLinkCount}.`,
    ...providerLines.map((line) => `Source attempt: ${line}`),
    `Qualified actual-vs-consensus comparisons: ${eligibleCount}. ${eligibleCount === 0 ? 'No same-metric, same-unit, same-period, pre-result consensus qualified; no surprise conclusion is made.' : 'Only period- and cutoff-qualified comparisons are shown above.'}`,
  ]
  const diagnostics = context.diagnostics.slice(0, 24).map((item) => item.length > 600 ? `${item.slice(0, 600)}…` : item)
  return [
    `### Expectations source ladder and period qualification\n${header.join('\n')}`,
    estimateLines.length > 0 ? `### Available institution forecasts (${estimateLines.length}${estimates.length > estimateLines.length ? ` of ${estimates.length}` : ''})\n${estimateLines.join('\n')}` : '### Available institution forecasts\nNo usable institution estimates were returned for this request.',
    `### Consensus and revisions\n${consensusLines.length > 0 ? consensusLines.join('\n') : 'No qualified consensus snapshot was available.'}\nEstimate revision results: ${analysis.estimateRevisions.length}; prior-estimate comparisons: ${analysis.actualVsPriorEstimate.length}.`,
    diagnostics.length > 0 ? `### Expectation diagnostics\n${diagnostics.map((item) => `- ${item}`).join('\n')}` : '',
  ].filter(Boolean)
}

const EARNINGS_REVIEW_SECTION_COUNT = 14
