import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFreshKnowledgeBaseV04 } from '../../knowledge/storage/index.ts'
import { KnowledgeBaseRegistry } from '../../knowledge/registry/registry.ts'
import { KnowledgeProductionGateway } from '../../knowledge/production/gateway.ts'
import { runEarningsReview } from '../../workflows/earnings-review/workflow.ts'
import { sha256 } from '../../plugins/research-acquisition/hash.ts'
import type { ReasoningExecutor, ReasoningRequest, ReasoningResult } from '../../plugins/reasoning/contracts.ts'
import type { ResearchAcquisitionPlugin, ResearchFetchedSource, ResearchSourceCandidate } from '../../plugins/research-acquisition/contracts.ts'
import type { AkshareDataClient } from '../../plugins/research-acquisition/akshare.ts'
import { buildEarningsExpectationAnalysis, enrichEarningsReviewSectionsWithExpectations } from '../../workflows/earnings-review/expectations-integration.ts'
import { EARNINGS_REVIEW_SECTIONS } from '../../skills/earnings-review/contracts.ts'
import type { NormalizedResearchSource } from '../../plugins/research-acquisition/contracts.ts'
import type { ConsensusSnapshot, EstimatePoint, GuidanceRange, SegmentKpiDeltaInput } from '../../skills/earnings-review/expectations/contracts.ts'

const AS_OF = '2026-09-08T23:59:59.000Z'
const RESULT = '2026-08-30T00:00:00.000Z'

function source(candidateId: string, publishedAt = '2026-07-01T00:00:00.000Z', content = candidateId): NormalizedResearchSource {
  return { candidate: { candidateId, kind: 'web_article', tier: 3, title: candidateId, provider: 'fixture', publishedAt }, retrievedAt: publishedAt, title: candidateId, content, contentHash: sha256(content), publisher: 'fixture', rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false } }
}
function estimate(overrides: Partial<EstimatePoint> = {}): EstimatePoint {
  return { estimateId: 'estimate-a', metric: 'revenue', fiscalPeriod: '2026-H1', value: 100, unit: 'CNY', institutionKey: 'house-a', publishedAt: '2026-07-01T00:00:00.000Z', sourceCandidateIds: ['estimate-a-source'], ...overrides }
}
function actual() { return [{ metric: 'revenue' as const, value: 120, unit: 'CNY' as const, period: '2026-H1', comparator: 'eq' as const, calculation: 'observed' as const, sourceCandidateIds: ['actual-source'] }] }
function validBundle(overrides: Partial<NonNullable<Parameters<typeof buildEarningsExpectationAnalysis>[0]['expectations']>> = {}) {
  const estimates = [estimate(), estimate({ estimateId: 'estimate-b', institutionKey: 'house-b', value: 110, sourceCandidateIds: ['estimate-b-source'], publishedAt: '2026-07-02T00:00:00.000Z' })]
  const consensus: ConsensusSnapshot = { metric: 'revenue', fiscalPeriod: '2026-H1', unit: 'CNY', asOf: '2026-08-01T00:00:00.000Z', mean: 105, median: 105, high: 110, low: 100, count: 2, dispersion: 5, contributingEstimateIds: ['estimate-a', 'estimate-b'] }
  return { sources: [source('estimate-a-source'), source('estimate-b-source')], estimates, consensusSnapshots: [consensus], ...overrides }
}

test('expectation report preserves available institution forecasts and explains period or result-cutoff gaps', () => {
  const forecastSource = { ...source('estimate-a-source', '2026-09-01T00:00:00.000Z'), candidate: { ...source('estimate-a-source').candidate, url: 'https://example.test/forecast.pdf' } }
  const forecast = estimate({ metric: 'eps', fiscalPeriod: '2026-FY', unit: 'CNY_per_share', value: 5.25, publishedAt: '2026-09-01T00:00:00.000Z' })
  const bundle = { sources: [forecastSource], estimates: [forecast], consensusSnapshots: [] }
  const analysis = buildEarningsExpectationAnalysis({ analysisAsOf: AS_OF, resultPublishedAt: RESULT, actualMetrics: actual(), expectations: bundle })
  const sections = EARNINGS_REVIEW_SECTIONS.map((title) => ({ id: title.toLowerCase().replace(/\W+/gu, '-'), title, markdown: 'Research Gap / Unavailable: no bounded evidence supports this section.', sourceCandidateIds: [], assessmentRefs: [] }))
  const enriched = enrichEarningsReviewSectionsWithExpectations(sections, analysis, { requestedFiscalPeriod: '2026-H1', analysisAsOf: AS_OF, resultPublishedAt: RESULT, mode: 'automatic', acquisitionStatus: 'partial', estimateCount: 1, institutionCount: 1, consensusSnapshotCount: 0, revisionLinkCount: 0, providerOutcomes: [{ provider: 'ths-institution-forecast', providerAttempted: true, providerSucceeded: true, providerEmpty: false, providerFailed: false, usableSourceCount: 1 }], diagnostics: [], bundle })
  const snapshot = enriched.find((section) => section.title === 'Earnings Snapshot')!
  assert.match(snapshot.markdown, /Requested actual period: 2026-H1/)
  assert.match(snapshot.markdown, /official result cutoff 2026-08-30/)
  assert.match(snapshot.markdown, /institution forecasts \(1\)/)
  assert.match(snapshot.markdown, /eps 2026-FY 5\.25 CNY_per_share/)
  assert.match(snapshot.markdown, /publisher fixture; retrieved by fixture at 2026-09-01T00:00:00\.000Z; URL https:\/\/example\.test\/forecast\.pdf/)
  assert.match(snapshot.markdown, /No same-metric, same-unit, same-period, pre-result consensus qualified/)
  assert.deepEqual(snapshot.sourceCandidateIds, ['estimate-a-source'])
})

class NoopExecutor implements ReasoningExecutor {
  capabilities() { return { maxContextTokens: 100_000, maxOutputTokens: 10_000, structuredOutputSupport: true, maxConcurrency: 1 } }
  async execute(request: ReasoningRequest): Promise<ReasoningResult> { return { operation: request.operation, operationId: 'w2-004-noop', output: {} } }
}

async function liveFixture(withOfficial = true) {
  const now = AS_OF; const root = await mkdtemp(join(tmpdir(), 'rhl-w2-004-')); const reports = join(root, 'reports'); await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-w2-004', now }); const registry = new KnowledgeBaseRegistry(); let handle = await registry.mount(root)
  const seedCandidate: ResearchSourceCandidate = { candidateId: 'seed-source', kind: 'official_disclosure', tier: 1, title: 'Seed coverage', provider: 'fixture', publishedAt: '2026-01-01T00:00:00.000Z', metadata: { companySymbol: '600519' } }
  const seed = { ...source('seed-source', '2026-01-01T00:00:00.000Z', 'seed'), candidate: seedCandidate }
  const seeded = await new KnowledgeProductionGateway(registry).submit({ handle, producerType: 'fixture', producerRunId: 'seed-w2-004', schemaProfile: { schemaVersion: '0.4', storageFormatVersion: '1', requiresRawProvenance: true }, entity: { localKey: 'company', entityType: 'company', name: '贵州茅台', aliases: ['600519'], semanticFields: { ticker: '600519', exchange: 'SH' } }, proposals: [{ proposalId: 'seed-claim', kind: 'claim', claimType: 'fact', subjectKey: 'company', statement: 'Seed coverage exists.', sourceCandidateIds: ['seed-source'] }], evidenceBindings: [{ localSourceId: 'seed-source', source: seed }], asOf: now, now: () => now })
  if (seeded.status !== 'committed') throw new Error(JSON.stringify(seeded)); handle = await registry.mount(root)
  const candidate: ResearchSourceCandidate = { candidateId: 'official-2026-h1', kind: 'official_disclosure', tier: 1, title: '2026年半年度报告', provider: 'fixture', publishedAt: RESULT, metadata: { companySymbol: '600519' } }
  const plugin: ResearchAcquisitionPlugin = { name: 'fixture-official-disclosure', discover: async () => withOfficial ? [candidate] : [], fetch: async (item): Promise<ResearchFetchedSource> => ({ candidate: item, retrievedAt: now, content: 'official filing', contentHash: sha256('official filing') }), normalize: async (item) => ({ ...source(item.candidate.candidateId, item.candidate.publishedAt ?? now, item.content), candidate: item.candidate }) }
  const akshare: AkshareDataClient = { companyBasic: async () => { throw new Error('not used') }, financialData: async () => [{ 报告期: '2026-06-30', 营业收入: 120, 净利润: 15 }, { 报告期: '2025-06-30', 营业收入: 100, 净利润: 10 }], historicalMarketData: async () => { throw new Error('not used') } }
  return { root, reports, handle, plugin, akshare, async close() { await rm(root, { recursive: true, force: true }) } }
}

test('W2-004 live Workflow enriches report after expectation-blind reasoning without canonicalizing expectation sources', async () => {
  const fixture = await liveFixture()
  try {
    const expectationSources = [source('estimate-a-source'), source('estimate-b-source')]
    const result = await runEarningsReview({ workflowRunId: 'w2-004-live', handle: fixture.handle, company: { symbol: '600519', name: '贵州茅台', exchange: 'SSE' }, fiscalYear: 2026, period: 'H1', reportRoot: fixture.reports, acquisitionPlugins: [fixture.plugin], akshare: fixture.akshare, reasoningExecutor: new NoopExecutor(), now: () => AS_OF, expectations: validBundle({ sources: expectationSources }) })
    assert.equal(result.status, 'completed')
    assert.equal(result.telemetry.consensusStatus, 'available')
    assert.equal(result.telemetry.expectationStatus, 'available')
    assert.equal(result.telemetry.expectationDiagnosticCount, 0)
    assert.equal(result.expectationAnalysis?.actualVsConsensus.length, 1)
    const report = await readFile(result.report!.outputPath, 'utf8')
    assert.match(report, /actual=120; PIT consensus=105; absolute delta=15; relative delta=14\.285714285714285%; direction=above/)
    assert.doesNotMatch(report, /Valuation Implications[\s\S]*Consensus unavailable/)
    assert.equal(result.sourceIds.some((id) => id.includes('estimate-a-source') || id.includes('estimate-b-source')), false)
    assert.equal(result.claimIds.length, 0)
  } finally { await fixture.close() }
})

test('W2-004-FIX-001 future and invalid fallback resultPublishedAt fail closed', () => {
  for (const resultPublishedAt of ['2026-10-01T00:00:00.000Z', 'not-a-timestamp']) {
    const result = buildEarningsExpectationAnalysis({ analysisAsOf: AS_OF, actualMetrics: actual(), expectations: validBundle({ resultPublishedAt }) })
    assert.equal(result.actualVsConsensus.length, 0)
    assert.equal(result.actualVsPriorEstimate.length, 0)
    assert.equal(result.consensusStatus, 'unavailable')
    assert.ok(result.diagnostics.includes(resultPublishedAt === 'not-a-timestamp' ? 'resultPublishedAt_invalid' : 'resultPublishedAt_after_analysisAsOf'))
    assert.ok(result.diagnostics.includes('result_publication_cutoff_unavailable'))
  }
})

test('W2-004-FIX-001 valid fallback cutoff enables consensus and prior comparisons', () => {
  const result = buildEarningsExpectationAnalysis({ analysisAsOf: AS_OF, actualMetrics: actual(), expectations: validBundle({ resultPublishedAt: RESULT, priorEstimateInstitutionKeys: ['house-a'] }) })
  assert.equal(result.consensusStatus, 'available')
  assert.equal(result.actualVsConsensus.length, 1)
  assert.equal(result.actualVsPriorEstimate.length, 1)
  assert.equal(result.diagnostics.includes('result_publication_cutoff_unavailable'), false)
})

test('W2-004-FIX-001 an authoritative official cutoff overrides a later bundle fallback', () => {
  const result = buildEarningsExpectationAnalysis({ analysisAsOf: AS_OF, resultPublishedAt: RESULT, actualMetrics: actual(), expectations: validBundle({ resultPublishedAt: '2026-09-01T00:00:00.000Z', consensusSnapshots: [{ ...validBundle().consensusSnapshots![0]!, asOf: '2026-08-29T00:00:00.000Z', mean: 105, median: 105, high: 110, low: 100, dispersion: 5 }] }) })
  assert.equal(result.actualVsConsensus.length, 1)
  assert.equal(result.diagnostics.includes('resultPublishedAt_after_analysisAsOf'), false)
})

test('W2-004-FIX-001 live Workflow uses the exact official cutoff instead of a future fallback timestamp', async () => {
  const fixture = await liveFixture()
  try {
    const result = await runEarningsReview({ workflowRunId: 'w2-004-fix-001-live-future', handle: fixture.handle, company: { symbol: '600519', name: '贵州茅台', exchange: 'SSE' }, fiscalYear: 2026, period: 'H1', reportRoot: fixture.reports, acquisitionPlugins: [fixture.plugin], akshare: fixture.akshare, reasoningExecutor: new NoopExecutor(), now: () => AS_OF, expectations: validBundle({ resultPublishedAt: '2026-10-01T00:00:00.000Z' }) })
    assert.equal(result.status, 'completed')
    assert.equal(result.telemetry.officialEvidenceStatus, 'available')
    assert.equal(result.telemetry.structuredFinancialEvidenceStatus, 'available')
    assert.equal(result.telemetry.consensusStatus, 'available')
    assert.equal(result.telemetry.expectationStatus, 'available')
    assert.equal(result.expectationAnalysis?.actualVsConsensus.length, 1)
    assert.equal(result.expectationAnalysis?.actualVsPriorEstimate.length, 0)
    const report = await readFile(result.report!.outputPath, 'utf8')
    assert.match(report, /actual=120; PIT consensus=105/)
    assert.equal(result.sourceIds.some((id) => id.includes('estimate-a-source') || id.includes('estimate-b-source')), false)
  } finally { await fixture.close() }
})

test('W2-004 no bundle is empty and valid PIT consensus uses exact existing arithmetic', () => {
  const empty = buildEarningsExpectationAnalysis({ analysisAsOf: AS_OF, resultPublishedAt: RESULT, actualMetrics: actual() })
  assert.equal(empty.consensusStatus, 'unavailable')
  const result = buildEarningsExpectationAnalysis({ analysisAsOf: AS_OF, resultPublishedAt: RESULT, actualMetrics: actual(), expectations: validBundle() })
  assert.equal(result.consensusStatus, 'available')
  assert.deepEqual(result.actualVsConsensus[0]?.result, { metric: 'revenue', fiscalPeriod: '2026-H1', actual: 120, benchmark: 105, absoluteDelta: 15, relativeDelta: 15 / 105, direction: 'above', benchmarkType: 'consensus' })
  assert.deepEqual(result.actualVsConsensus[0]?.sourceCandidateIds, ['actual-source', 'estimate-a-source', 'estimate-b-source'])
})

test('W2-004 selects latest strict pre-result consensus and rejects look-ahead', () => {
  const older: ConsensusSnapshot = { metric: 'revenue', fiscalPeriod: '2026-H1', unit: 'CNY', asOf: '2026-07-15T00:00:00.000Z', mean: 100, median: 100, high: 100, low: 100, count: 2, dispersion: 0, contributingEstimateIds: ['estimate-a', 'estimate-b'] }
  const newer: ConsensusSnapshot = { ...older, asOf: '2026-08-15T00:00:00.000Z', mean: 105, median: 105, high: 110, low: 100, dispersion: 5 }
  const post: ConsensusSnapshot = { ...newer, asOf: RESULT, mean: 120, median: 120, high: 120, low: 120, dispersion: 0 }
  const result = buildEarningsExpectationAnalysis({ analysisAsOf: AS_OF, resultPublishedAt: RESULT, actualMetrics: actual(), expectations: validBundle({ consensusSnapshots: [post, newer, older] }) })
  assert.equal(result.actualVsConsensus[0]?.result.benchmark, 105)
  assert.ok(result.diagnostics.includes(`consensus_not_pre_result:revenue:2026-H1:${RESULT}`))
  const postOnly = buildEarningsExpectationAnalysis({ analysisAsOf: AS_OF, resultPublishedAt: RESULT, actualMetrics: actual(), expectations: validBundle({ consensusSnapshots: [post] }) })
  assert.equal(postOnly.consensusStatus, 'unavailable')
  assert.equal(postOnly.actualVsConsensus.length, 0)
})

test('W2-004 fails closed on ambiguous or inconsistent consensus and duplicate source identity', () => {
  const base = validBundle()
  const ambiguous: ConsensusSnapshot = { ...base.consensusSnapshots![0]!, asOf: '2026-08-15T00:00:00.000Z', mean: 104, median: 104, high: 110, low: 100, dispersion: 6 }
  const conflictingSource = source('estimate-a-source', '2026-07-01T00:00:00.000Z', 'different')
  const result = buildEarningsExpectationAnalysis({ analysisAsOf: AS_OF, resultPublishedAt: RESULT, actualMetrics: actual(), expectations: { ...base, sources: [...base.sources, conflictingSource], consensusSnapshots: [base.consensusSnapshots![0]!, ambiguous] } })
  assert.equal(result.consensusStatus, 'unavailable')
  assert.ok(result.diagnostics.includes('ambiguous_expectation_source:estimate-a-source'))
  assert.ok(result.diagnostics.some((item) => item.startsWith('consensus_inconsistent:')))
  assert.ok(result.diagnostics.some((item) => item.startsWith('expectation_source_missing:') || item.startsWith('ambiguous_expectation_source:')))
})

test('W2-004 prior estimate and revision require explicit institution and links', () => {
  const old = estimate({ estimateId: 'old', value: 90, publishedAt: '2026-06-01T00:00:00.000Z', sourceCandidateIds: ['old-source'] })
  const newer = estimate({ estimateId: 'new', value: 95, publishedAt: '2026-07-15T00:00:00.000Z', sourceCandidateIds: ['new-source'] })
  const houseCPostResult = estimate({ estimateId: 'house-c-post-result', institutionKey: 'house-c', value: 101, publishedAt: '2026-09-01T00:00:00.000Z', sourceCandidateIds: ['house-c-source'] })
  const result = buildEarningsExpectationAnalysis({ analysisAsOf: AS_OF, resultPublishedAt: RESULT, actualMetrics: actual(), expectations: { ...validBundle({ estimates: [old, newer, estimate({ estimateId: 'other', institutionKey: 'house-b', value: 110, sourceCandidateIds: ['other-source'] }), houseCPostResult], consensusSnapshots: [] }), sources: [source('old-source'), source('new-source'), source('other-source'), source('house-c-source')], priorEstimateInstitutionKeys: ['house-a', 'house-c'], estimateRevisionLinks: [{ oldEstimateId: 'old', newEstimateId: 'new' }] } })
  assert.equal(result.actualVsPriorEstimate.length, 1)
  assert.equal(result.actualVsPriorEstimate[0]?.result.benchmark, 95)
  assert.equal(result.estimateRevisions[0]?.result.absoluteRevision, 5)
  assert.ok(result.diagnostics.includes('prior_estimate_unavailable:house-c:revenue'))
})

test('W2-005-FIX-002 prior comparisons preserve explicit institution identity through integration sort and dedup', () => {
  const base = validBundle({ consensusSnapshots: [], priorEstimateInstitutionKeys: ['house-a', 'house-b'] })
  const result = buildEarningsExpectationAnalysis({ analysisAsOf: AS_OF, resultPublishedAt: RESULT, actualMetrics: actual(), expectations: base })
  const reversed = buildEarningsExpectationAnalysis({ analysisAsOf: AS_OF, resultPublishedAt: RESULT, actualMetrics: actual(), expectations: { ...base, priorEstimateInstitutionKeys: ['house-b', 'house-a'] } })
  assert.deepEqual(result.actualVsPriorEstimate.map((item) => item.institutionKey), ['house-a', 'house-b'])
  assert.deepEqual(result.actualVsPriorEstimate.map((item) => item.institutionKey), reversed.actualVsPriorEstimate.map((item) => item.institutionKey))
  assert.deepEqual(result.actualVsPriorEstimate.map((item) => item.result.benchmark), [100, 110])
  const sameValue = buildEarningsExpectationAnalysis({ analysisAsOf: AS_OF, resultPublishedAt: RESULT, actualMetrics: actual(), expectations: { ...base, estimates: base.estimates?.map((item) => item.institutionKey === 'house-b' ? { ...item, value: 100 } : item) } })
  assert.deepEqual(sameValue.actualVsPriorEstimate.map((item) => item.institutionKey), ['house-a', 'house-b'])
})

test('W2-004-FIX-001 invalid revision links do not suppress one valid predecessor', () => {
  const old = estimate({ estimateId: 'old', value: 90, publishedAt: '2026-06-01T00:00:00.000Z', sourceCandidateIds: ['old-source'] })
  const newer = estimate({ estimateId: 'new', value: 95, publishedAt: '2026-07-15T00:00:00.000Z', sourceCandidateIds: ['new-source'] })
  const result = buildEarningsExpectationAnalysis({ analysisAsOf: AS_OF, resultPublishedAt: RESULT, actualMetrics: actual(), expectations: { ...validBundle({ estimates: [old, newer], consensusSnapshots: [] }), sources: [source('old-source'), source('new-source')], estimateRevisionLinks: [{ oldEstimateId: 'missing-old', newEstimateId: 'new' }, { oldEstimateId: 'old', newEstimateId: 'new' }] } })
  assert.equal(result.estimateRevisions.length, 1)
  assert.ok(result.diagnostics.includes('estimate_revision_invalid:missing-old->new'))
  assert.equal(result.diagnostics.includes('ambiguous_revision_target:new'), false)
})

test('W2-004-FIX-001 zero old estimate omits relative revision without non-finite output', () => {
  const old = estimate({ estimateId: 'old-zero', value: 0, publishedAt: '2026-06-01T00:00:00.000Z', sourceCandidateIds: ['old-zero-source'] })
  const newer = estimate({ estimateId: 'new-zero', value: 5, publishedAt: '2026-07-15T00:00:00.000Z', sourceCandidateIds: ['new-zero-source'] })
  const base = validBundle({ consensusSnapshots: [] })
  const analysis = buildEarningsExpectationAnalysis({ analysisAsOf: AS_OF, resultPublishedAt: RESULT, actualMetrics: actual(), expectations: { ...base, estimates: [old, newer], sources: [source('old-zero-source'), source('new-zero-source')], estimateRevisionLinks: [{ oldEstimateId: 'old-zero', newEstimateId: 'new-zero' }] } })
  const sections = EARNINGS_REVIEW_SECTIONS.map((title) => ({ id: title, title, markdown: title, sourceCandidateIds: [], assessmentRefs: [] }))
  const report = enrichEarningsReviewSectionsWithExpectations(sections, analysis).map((section) => section.markdown).join('\n')
  assert.match(report, /oldValue=0; newValue=5; absoluteRevision=5/)
  assert.equal(report.includes('relativeRevision='), false)
  assert.equal(/NaN|Infinity|-Infinity/.test(report), false)
})

test('W2-004-FIX-001 two valid revision predecessors remain ambiguous', () => {
  const oldA = estimate({ estimateId: 'old-a', value: 90, publishedAt: '2026-06-01T00:00:00.000Z', sourceCandidateIds: ['old-a-source'] })
  const oldB = estimate({ estimateId: 'old-b', value: 92, publishedAt: '2026-06-10T00:00:00.000Z', sourceCandidateIds: ['old-b-source'] })
  const newer = estimate({ estimateId: 'new', value: 95, publishedAt: '2026-07-15T00:00:00.000Z', sourceCandidateIds: ['new-source'] })
  const result = buildEarningsExpectationAnalysis({ analysisAsOf: AS_OF, resultPublishedAt: RESULT, actualMetrics: actual(), expectations: { ...validBundle({ estimates: [oldA, oldB, newer], consensusSnapshots: [] }), sources: [source('old-a-source'), source('old-b-source'), source('new-source')], estimateRevisionLinks: [{ oldEstimateId: 'old-a', newEstimateId: 'new' }, { oldEstimateId: 'old-b', newEstimateId: 'new' }] } })
  assert.equal(result.estimateRevisions.length, 0)
  assert.ok(result.diagnostics.includes('ambiguous_revision_target:new'))
})

test('W2-004 reuses Guidance and Segment KPI primitives without numeric inference', () => {
  const current: GuidanceRange = { guidanceId: 'guidance-current', metric: 'revenue', fiscalPeriod: '2026-H1', low: 100, high: 130, midpoint: 115, unit: 'CNY', guidanceType: 'range', publishedAt: '2026-08-01T00:00:00.000Z', sourceCandidateIds: ['guidance-current-source'], qualifiers: [] }
  const prior: GuidanceRange = { ...current, guidanceId: 'guidance-prior', low: 90, high: 120, midpoint: 105, publishedAt: '2026-06-01T00:00:00.000Z', sourceCandidateIds: ['guidance-prior-source'] }
  const segment: SegmentKpiDeltaInput = { current: { segmentKey: 'core', metric: 'revenue', fiscalPeriod: '2026-H1', value: 60, unit: 'CNY', sourceCandidateIds: ['segment-current'] }, priorComparable: { segmentKey: 'core', metric: 'revenue', fiscalPeriod: '2025-H1', value: 50, unit: 'CNY', sourceCandidateIds: ['segment-prior'] }, expectation: { segmentKey: 'core', metric: 'revenue', fiscalPeriod: '2026-H1', value: 55, unit: 'CNY', sourceCandidateIds: ['segment-expectation'] } }
  const sources = ['guidance-current-source', 'guidance-prior-source', 'segment-current', 'segment-prior', 'segment-expectation', 'estimate-a-source', 'estimate-b-source'].map((id) => source(id))
  const result = buildEarningsExpectationAnalysis({ analysisAsOf: AS_OF, resultPublishedAt: RESULT, actualMetrics: actual(), expectations: { ...validBundle({ consensusSnapshots: [] }), sources, guidances: [current, prior], currentGuidanceIds: ['guidance-current'], segmentKpiComparisons: [segment] } })
  assert.equal(result.guidanceRevisions.length, 1)
  assert.equal(result.segmentKpiDeltas.length, 1)
  const qualitative: GuidanceRange = { guidanceId: 'qualitative', metric: 'revenue', fiscalPeriod: '2026-H1', guidanceType: 'qualitative', publishedAt: '2026-08-01T00:00:00.000Z', sourceCandidateIds: ['qualitative-source'], qualifiers: ['stable demand'] }
  const qualitativeResult = buildEarningsExpectationAnalysis({ analysisAsOf: AS_OF, resultPublishedAt: RESULT, actualMetrics: actual(), expectations: { ...validBundle({ consensusSnapshots: [] }), sources: [...sources, source('qualitative-source')], guidances: [qualitative], currentGuidanceIds: ['qualitative'] } })
  assert.equal(qualitativeResult.guidanceRevisions.length, 0)
  assert.equal(qualitativeResult.guidanceVsConsensus.length, 0)
})

test('W2-004 enrichment preserves all 14 sections and removes the legacy sentinel only for valid consensus', () => {
  const sections = EARNINGS_REVIEW_SECTIONS.map((title) => ({ id: title.toLowerCase().replaceAll(' ', '-'), title, markdown: title === 'Valuation Implications' ? 'Consensus unavailable' : title, sourceCandidateIds: [], assessmentRefs: [] }))
  const analysis = buildEarningsExpectationAnalysis({ analysisAsOf: AS_OF, resultPublishedAt: RESULT, actualMetrics: actual(), expectations: validBundle() })
  const enriched = enrichEarningsReviewSectionsWithExpectations(sections, analysis)
  assert.equal(enriched.length, 14)
  assert.ok(!enriched.find((section) => section.title === 'Valuation Implications')?.markdown.includes('Consensus unavailable'))
  assert.match(enriched.find((section) => section.title === 'Valuation Implications')?.markdown ?? '', /Valuation impact is not calculated in W2-004/)
  assert.match(enriched.find((section) => section.title === 'Earnings Snapshot')?.markdown ?? '', /actual=120; PIT consensus=105; absolute delta=15; relative delta=14\.285714285714285%; direction=above/)
})

test('W2-004-FIX-001 renders complete deterministic actual, prior, revision, Guidance, and Segment deltas', () => {
  const old = estimate({ estimateId: 'old', value: 90, publishedAt: '2026-06-01T00:00:00.000Z', sourceCandidateIds: ['old-source'] })
  const newer = estimate({ estimateId: 'new', value: 95, publishedAt: '2026-07-15T00:00:00.000Z', sourceCandidateIds: ['new-source'] })
  const current: GuidanceRange = { guidanceId: 'guidance-current', metric: 'revenue', fiscalPeriod: '2026-H1', low: 100, high: 130, midpoint: 115, unit: 'CNY', guidanceType: 'range', publishedAt: '2026-08-01T00:00:00.000Z', sourceCandidateIds: ['guidance-current-source'], qualifiers: [] }
  const prior: GuidanceRange = { ...current, guidanceId: 'guidance-prior', low: 90, high: 120, midpoint: 105, publishedAt: '2026-06-01T00:00:00.000Z', sourceCandidateIds: ['guidance-prior-source'] }
  const segment: SegmentKpiDeltaInput = { current: { segmentKey: 'core', metric: 'revenue', fiscalPeriod: '2026-H1', value: 60, unit: 'CNY', sourceCandidateIds: ['segment-current'] }, priorComparable: { segmentKey: 'core', metric: 'revenue', fiscalPeriod: '2025-H1', value: 50, unit: 'CNY', sourceCandidateIds: ['segment-prior'] }, expectation: { segmentKey: 'core', metric: 'revenue', fiscalPeriod: '2026-H1', value: 55, unit: 'CNY', sourceCandidateIds: ['segment-expectation'] } }
  const extraSources = ['old-source', 'new-source', 'guidance-current-source', 'guidance-prior-source', 'segment-current', 'segment-prior', 'segment-expectation'].map((id) => source(id))
  const base = validBundle()
  const analysis = buildEarningsExpectationAnalysis({ analysisAsOf: AS_OF, resultPublishedAt: RESULT, actualMetrics: actual(), expectations: { ...base, estimates: [old, newer, ...base.estimates!], guidances: [current, prior], currentGuidanceIds: ['guidance-current'], segmentKpiComparisons: [segment], estimateRevisionLinks: [{ oldEstimateId: 'old', newEstimateId: 'new' }], sources: [...base.sources, ...extraSources], priorEstimateInstitutionKeys: ['house-a'] } })
  const sections = EARNINGS_REVIEW_SECTIONS.map((title) => ({ id: title.toLowerCase().replaceAll(' ', '-'), title, markdown: title === 'Valuation Implications' ? 'Consensus unavailable' : title, sourceCandidateIds: [], assessmentRefs: [] }))
  const report = enrichEarningsReviewSectionsWithExpectations(sections, analysis).map((section) => section.markdown).join('\n')
  assert.match(report, /actual=120; PIT consensus=105; absolute delta=15; relative delta=14\.285714285714285%; direction=above/)
  assert.match(report, /actual=120; selected prior estimate=95; absolute delta=25; relative delta=26\.31578947368421%; direction=above/)
  assert.match(report, /oldValue=90; newValue=95; absoluteRevision=5; relativeRevision=5\.555555555555555%/)
  assert.match(report, /low-end revision; oldValue=90; newValue=100; absoluteRevision=10/)
  assert.match(report, /high-end revision; oldValue=120; newValue=130; absoluteRevision=10/)
  assert.match(report, /midpoint revision; oldValue=105; newValue=115; absoluteRevision=10/)
  assert.match(report, /range-width change; oldValue=30; newValue=30; absoluteRevision=0; relativeRevision=0%/)
  assert.match(report, /consensusMean=105; relationship=inside_range; guidanceMidpoint=115; absoluteDelta=10; relativeDelta=9\.523809523809524%; direction=above/)
  assert.match(report, /prior comparison; benchmark=50; actual=60; absolute delta=10; relative delta=20%; direction=above/)
  assert.match(report, /expectation comparison; benchmark=55; actual=60; absolute delta=5; relative delta=9\.090909090909092%; direction=above/)
  assert.equal(/NaN|Infinity|-Infinity/.test(report), false)
})

test('W2-004-FIX-001 extreme normalized Guidance renders finite values without a second width calculation', () => {
  const extreme: GuidanceRange = { guidanceId: 'guidance-extreme', metric: 'revenue', fiscalPeriod: '2026-H1', low: -Number.MAX_VALUE, high: Number.MAX_VALUE, midpoint: 0, unit: 'CNY', guidanceType: 'range', publishedAt: '2026-08-01T00:00:00.000Z', sourceCandidateIds: ['guidance-extreme-source'], qualifiers: [] }
  const base = validBundle()
  const analysis = buildEarningsExpectationAnalysis({ analysisAsOf: AS_OF, resultPublishedAt: RESULT, actualMetrics: actual(), expectations: { ...base, guidances: [extreme], currentGuidanceIds: ['guidance-extreme'], sources: [source('guidance-extreme-source'), ...base.sources] } })
  const sections = EARNINGS_REVIEW_SECTIONS.map((title) => ({ id: title, title, markdown: title, sourceCandidateIds: [], assessmentRefs: [] }))
  const report = enrichEarningsReviewSectionsWithExpectations(sections, analysis).map((section) => section.markdown).join('\n')
  assert.equal(/NaN|Infinity|-Infinity/.test(report), false)
  assert.match(report, /low=-1\.7976931348623157e\+308; high=1\.7976931348623157e\+308; midpoint=0/)
  assert.equal(report.includes('range width='), false)
})

test('W2-004-FIX-001 minimum and qualitative Guidance do not fabricate midpoint deltas', () => {
  const minimum: GuidanceRange = { guidanceId: 'guidance-minimum', metric: 'revenue', fiscalPeriod: '2026-H1', low: 100, unit: 'CNY', guidanceType: 'minimum', publishedAt: '2026-08-01T00:00:00.000Z', sourceCandidateIds: ['guidance-minimum-source'], qualifiers: [] }
  const qualitative: GuidanceRange = { guidanceId: 'guidance-qualitative', metric: 'revenue', fiscalPeriod: '2026-H1', guidanceType: 'qualitative', publishedAt: '2026-08-01T00:00:00.000Z', sourceCandidateIds: ['guidance-qualitative-source'], qualifiers: ['stable demand'] }
  const base = validBundle()
  const analysis = buildEarningsExpectationAnalysis({ analysisAsOf: AS_OF, resultPublishedAt: RESULT, actualMetrics: actual(), expectations: { ...base, guidances: [minimum, qualitative], currentGuidanceIds: ['guidance-minimum', 'guidance-qualitative'], sources: [...base.sources, source('guidance-minimum-source'), source('guidance-qualitative-source')] } })
  const sections = EARNINGS_REVIEW_SECTIONS.map((title) => ({ id: title, title, markdown: title, sourceCandidateIds: [], assessmentRefs: [] }))
  const guidance = enrichEarningsReviewSectionsWithExpectations(sections, analysis).find((section) => section.title === 'Management Guidance')?.markdown ?? ''
  assert.equal(guidance.includes('guidanceMidpoint='), false)
  assert.match(guidance, /guidance-minimum revenue 2026-H1; low=100; unit=CNY/)
  assert.match(guidance, /guidance-qualitative revenue 2026-H1: qualitative/)
})
