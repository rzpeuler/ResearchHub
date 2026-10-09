import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFreshKnowledgeBaseV04, readCanonicalV04Assets } from '../../knowledge/storage/index.ts'
import { KnowledgeBaseRegistry } from '../../knowledge/registry/registry.ts'
import { KnowledgeProductionGateway } from '../../knowledge/production/gateway.ts'
import { sha256 } from '../../plugins/research-acquisition/hash.ts'
import type { NormalizedResearchSource, ResearchAcquisitionPlugin, ResearchFetchedSource, ResearchProviderOutcome } from '../../plugins/research-acquisition/contracts.ts'
import type { ReasoningExecutor, ReasoningRequest, ReasoningResult } from '../../plugins/reasoning/contracts.ts'
import type { EastmoneyReportAcquisitionResult, EastmoneyResearchReportRecord } from '../../plugins/research-acquisition/expectations/contracts.ts'
import type { EstimatePoint } from '../../skills/earnings-review/expectations/contracts.ts'
import { EARNINGS_REVIEW_SECTIONS } from '../../skills/earnings-review/contracts.ts'
import type { EarningsReviewWorkflowInput } from '../../workflows/earnings-review/contracts.ts'
import { assembleAutomaticEarningsExpectations, resolveEarningsExpectations } from '../../workflows/earnings-review/automatic-expectations.ts'
import type { EastmoneyEstimateProjectionResult } from '../../workflows/earnings-review/expectation-source-eastmoney.ts'
import { buildEarningsExpectationAnalysis } from '../../workflows/earnings-review/expectations-integration.ts'
import { runEarningsReview } from '../../workflows/earnings-review/workflow.ts'

const AS_OF = '2026-09-08T23:59:59.000Z'
const RESULT = '2026-08-30T00:00:00.000Z'
const OUTCOME: ResearchProviderOutcome = { provider: 'eastmoney-reportapi', providerAttempted: true, providerSucceeded: true, providerEmpty: false, providerFailed: false, usableSourceCount: 8 }

function source(candidateId: string): NormalizedResearchSource {
  const content = `source:${candidateId}`
  return { candidate: { candidateId, kind: 'structured_data', tier: 3, title: candidateId, provider: 'eastmoney-reportapi', url: `https://data.eastmoney.com/report/stock.jshtml?infocode=${candidateId}`, publishedAt: '2026-07-01T00:00:00.000Z' }, retrievedAt: AS_OF, title: candidateId, content, contentHash: sha256(content), publisher: 'Eastmoney Research Reports', rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false } }
}

function report(infoCode: string, orgCode: string, publishedAt: string, value: number): EastmoneyResearchReportRecord {
  return { infoCode, stockCode: '600519', stockName: '贵州茅台', title: infoCode, orgCode, orgShortName: orgCode, publishDateRaw: publishedAt, publishedAt, timestampPrecision: 'datetime', forecastBaseYear: 2026, epsForecasts: [{ fiscalYear: 2026, value, providerField: 'predictThisYearEps' }] }
}

function estimate(overrides: Partial<EstimatePoint> = {}): EstimatePoint {
  return { estimateId: 'estimate-a', metric: 'eps', fiscalPeriod: '2026-FY', value: 10, unit: 'CNY_per_share', institutionKey: 'eastmoney-org:house-a', publishedAt: '2026-07-01T00:00:00.000Z', sourceCandidateIds: ['source-a'], ...overrides }
}

function projection(estimates: readonly EstimatePoint[], sources: readonly NormalizedResearchSource[] = [source('source-a'), source('source-b'), source('source-c')], overrides: Partial<EastmoneyEstimateProjectionResult> = {}): EastmoneyEstimateProjectionResult {
  return { sources, estimates, institutions: [], diagnostics: [], providerOutcome: OUTCOME, forecastBaseYear: 2026, truncated: false, ...overrides }
}

function acquisition(sources: readonly NormalizedResearchSource[] = [source('source-a')], overrides: Partial<EastmoneyReportAcquisitionResult> = {}): EastmoneyReportAcquisitionResult {
  return { records: [], sources, diagnostics: [], providerOutcome: OUTCOME, truncated: false, ...overrides }
}

function workflow(overrides: Partial<EarningsReviewWorkflowInput> = {}): EarningsReviewWorkflowInput {
  return { workflowRunId: 'automatic-expectations-test', handle: {} as EarningsReviewWorkflowInput['handle'], company: { symbol: '600519', name: '贵州茅台', exchange: 'SSE' }, fiscalYear: 2026, period: 'FY', reportRoot: 'reports', acquisitionPlugins: [], ...overrides }
}

class CaptureExecutor implements ReasoningExecutor {
  readonly requests: ReasoningRequest[] = []
  capabilities() { return { maxContextTokens: 100_000, maxOutputTokens: 10_000, structuredOutputSupport: true, maxConcurrency: 1 } }
  async execute(request: ReasoningRequest): Promise<ReasoningResult> { this.requests.push(request); return { operation: request.operation, operationId: `automatic-${this.requests.length}`, output: {} } }
}

class FixedExecutor extends CaptureExecutor {
  constructor(private readonly fixedOutput: unknown) { super() }
  override async execute(request: ReasoningRequest): Promise<ReasoningResult> { this.requests.push(request); return { operation: request.operation, operationId: `fixed-${this.requests.length}`, output: this.fixedOutput } }
}

function officialCandidate(): { readonly candidateId: string; readonly kind: 'official_disclosure'; readonly tier: 1; readonly title: string; readonly provider: string; readonly publishedAt: string; readonly metadata: Readonly<Record<string, unknown>> } {
  return { candidateId: 'official-2026-h1', kind: 'official_disclosure', tier: 1, title: '2026年半年度报告', provider: 'fixture', publishedAt: RESULT, metadata: { companySymbol: '600519' } }
}

async function workflowFixture() {
  const root = await mkdtemp(join(tmpdir(), 'rhl-automatic-expectations-')); const reports = join(root, 'reports'); const now = AS_OF
  await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: `kb-automatic-${Date.now()}`, now }); const registry = new KnowledgeBaseRegistry(); let handle = await registry.mount(root)
  const seedContent = 'seed coverage'; const seed: NormalizedResearchSource = { candidate: { candidateId: 'seed-source', kind: 'official_disclosure', tier: 1, title: 'Seed coverage', provider: 'fixture', publishedAt: '2026-01-01T00:00:00.000Z' }, retrievedAt: now, title: 'Seed coverage', content: seedContent, contentHash: sha256(seedContent), publisher: 'fixture', rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false } }
  const seeded = await new KnowledgeProductionGateway(registry).submit({ handle, producerType: 'fixture_seed', producerRunId: `seed-${Date.now()}`, schemaProfile: { schemaVersion: '0.4', storageFormatVersion: '1', requiresRawProvenance: true }, entity: { localKey: 'company', entityType: 'company', name: '贵州茅台', aliases: ['600519'], semanticFields: { ticker: '600519', exchange: 'SH' } }, proposals: [{ proposalId: 'seed-claim', kind: 'claim', claimType: 'fact', subjectKey: 'company', statement: 'Seed coverage exists.', sourceCandidateIds: ['seed-source'] }], evidenceBindings: [{ localSourceId: 'seed-source', source: seed }], asOf: now, now: () => now })
  assert.equal(seeded.status, 'committed'); handle = await registry.mount(root)
  const official = officialCandidate(); const plugin: ResearchAcquisitionPlugin = { name: 'fixture-official-disclosure', discover: async () => [official], fetch: async (candidate): Promise<ResearchFetchedSource> => ({ candidate, retrievedAt: now, content: 'official filing', contentHash: sha256('official filing') }), normalize: async (fetched) => ({ candidate: fetched.candidate, retrievedAt: now, title: fetched.candidate.title, content: fetched.content, contentHash: sha256(fetched.content), publisher: 'fixture', rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false } }) }
  const akshare = { companyBasic: async () => { throw new Error('companyBasic must not be called') }, financialData: async () => [{ 报告期: '2026-06-30', 营业收入: 120, 净利润: 15, 基本每股收益: 1.2 }, { 报告期: '2025-06-30', 营业收入: 100, 净利润: 10, 基本每股收益: 1.0 }], historicalMarketData: async () => { throw new Error('historicalMarketData must not be called') } }
  return { root, reports, handle, plugin, akshare, async close() { await rm(root, { recursive: true, force: true }) } }
}

function automaticSourceClient(calls: unknown[] = []) {
  const first = report('report-a', 'house-a', '2026-07-01T00:00:00.000Z', 1.1); const second = report('report-b', 'house-b', '2026-07-02T00:00:00.000Z', 1.3); const third = report('report-a-post', 'house-a', '2026-09-01T00:00:00.000Z', 1.2)
  const sources = [source(`eastmoney-report-${sha256(first.infoCode)}`), source(`eastmoney-report-${sha256(second.infoCode)}`), source(`eastmoney-report-${sha256(third.infoCode)}`)]
  return { acquire: async (request: unknown) => { calls.push(request); return acquisition(sources, { records: [first, second, third] }) } }
}

function thsExpectationRow(institution: string, date: string, eps: number, netProfit: string) {
  return { 机构名称: institution, 研究员: '研究员', 预测年报每股收益2026预测: eps, 预测年报每股收益2027预测: eps + 1, 预测年报每股收益2028预测: eps + 2, 预测年报净利润2026预测: netProfit, 预测年报净利润2027预测: '850亿', 预测年报净利润2028预测: '900亿', 报告日期: date }
}

function emExpectationRow(institution: string, date: string, eps: number) {
  return { 股票代码: '600519', 股票简称: '贵州茅台', 报告名称: `${institution}报告`, 机构: institution, '2026-盈利预测-收益': eps, '2027-盈利预测-收益': eps + 1, '2028-盈利预测-收益': eps + 2, 日期: date, 报告PDF链接: `https://pdf.dfcfw.com/pdf/${institution}.pdf` }
}

async function runWorkflowFixture(fixture: Awaited<ReturnType<typeof workflowFixture>>, overrides: Partial<EarningsReviewWorkflowInput> = {}) {
  return runEarningsReview({ workflowRunId: `automatic-${Date.now()}-${Math.random().toString(16).slice(2)}`, handle: fixture.handle, company: { symbol: '600519', name: '贵州茅台', exchange: 'SSE' }, fiscalYear: 2026, period: 'H1', reportRoot: fixture.reports, acquisitionPlugins: [fixture.plugin], akshare: fixture.akshare, now: () => AS_OF, reasoningExecutor: new CaptureExecutor(), ...overrides })
}

test('strict result cutoff builds a two-institution pre-result consensus and resolves contributors', () => {
  const result = assembleAutomaticEarningsExpectations({ projection: projection([
    estimate({ estimateId: 'a-pre', value: 10, sourceCandidateIds: ['source-a'] }),
    estimate({ estimateId: 'b-pre', institutionKey: 'eastmoney-org:house-b', value: 12, sourceCandidateIds: ['source-b'] }),
    estimate({ estimateId: 'a-post', value: 11, publishedAt: '2026-09-01T00:00:00.000Z', sourceCandidateIds: ['source-a'] }),
  ]), targetFiscalYear: 2026, analysisAsOf: AS_OF, resultPublishedAt: RESULT })
  assert.equal(result.bundle?.consensusSnapshots?.[0]?.asOf, '2026-08-29T23:59:59.999Z')
  assert.deepEqual(result.bundle?.consensusSnapshots?.[0]?.contributingEstimateIds, ['a-pre', 'b-pre'])
  assert.deepEqual(result.bundle?.priorEstimateInstitutionKeys, ['eastmoney-org:house-a', 'eastmoney-org:house-b'])
  assert.deepEqual(result.bundle?.sources.map((item) => item.candidate.candidateId), ['source-a', 'source-b'])
})

test('annual automatic EPS consensus does not compare against an H1 actual', () => {
  const assembled = assembleAutomaticEarningsExpectations({ projection: projection([
    estimate({ estimateId: 'a-pre', value: 10, sourceCandidateIds: ['source-a'] }),
    estimate({ estimateId: 'b-pre', institutionKey: 'eastmoney-org:house-b', value: 12, sourceCandidateIds: ['source-b'] }),
  ]), targetFiscalYear: 2026, analysisAsOf: AS_OF, resultPublishedAt: RESULT })
  const analysis = buildEarningsExpectationAnalysis({ analysisAsOf: AS_OF, resultPublishedAt: RESULT, actualMetrics: [{ metric: 'eps', value: 1.2, unit: 'CNY_per_share', period: '2026-H1', comparator: 'eq', calculation: 'observed', sourceCandidateIds: ['actual-source'] }], expectations: assembled.bundle })
  assert.equal(analysis.actualVsConsensus.length, 0)
  assert.equal(analysis.consensusStatus, 'unavailable')
})

test('post-result estimates remain in the bundle and may form a revision link', () => {
  const result = assembleAutomaticEarningsExpectations({ projection: projection([
    estimate({ estimateId: 'old', value: 10, publishedAt: '2026-07-01T00:00:00.000Z' }),
    estimate({ estimateId: 'new', value: 11, publishedAt: '2026-09-01T00:00:00.000Z' }),
  ]), targetFiscalYear: 2026, analysisAsOf: AS_OF, resultPublishedAt: RESULT })
  assert.deepEqual(result.bundle?.estimates?.map((item) => item.estimateId), ['new', 'old'])
  assert.deepEqual(result.bundle?.estimateRevisionLinks, [{ oldEstimateId: 'old', newEstimateId: 'new' }])
  assert.equal(result.bundle?.consensusSnapshots?.length, 0)
})

test('same-institution same-time estimates are all excluded even when values match', () => {
  const result = assembleAutomaticEarningsExpectations({ projection: projection([
    estimate({ estimateId: 'same-a', value: 10 }),
    estimate({ estimateId: 'same-b', value: 10 }),
  ]), targetFiscalYear: 2026, analysisAsOf: AS_OF, resultPublishedAt: RESULT })
  assert.equal(result.estimateCount, 0)
  assert.ok(result.diagnostics.includes('automatic_estimate_timestamp_ambiguous:eastmoney-org:house-a|eps|2026-FY|2026-07-01T00:00:00.000Z'))
})

test('duplicate Estimate IDs exclude every occurrence', () => {
  const result = assembleAutomaticEarningsExpectations({ projection: projection([
    estimate({ estimateId: 'duplicate' }),
    estimate({ estimateId: 'duplicate', value: 11 }),
    estimate({ estimateId: 'safe', institutionKey: 'eastmoney-org:house-b', sourceCandidateIds: ['source-b'] }),
  ]), targetFiscalYear: 2026, analysisAsOf: AS_OF, resultPublishedAt: RESULT })
  assert.deepEqual(result.bundle?.estimates?.map((item) => item.estimateId), ['safe'])
  assert.equal(result.diagnostics.filter((item) => item === 'automatic_estimate_duplicate_id:duplicate').length, 1)
})

test('unresolved source bindings exclude the estimate and its orphan source', () => {
  const result = assembleAutomaticEarningsExpectations({ projection: projection([estimate({ sourceCandidateIds: ['missing'] })], [source('source-a')]), targetFiscalYear: 2026, analysisAsOf: AS_OF, resultPublishedAt: RESULT })
  assert.equal(result.bundle, undefined)
  assert.ok(result.diagnostics.includes('automatic_estimate_source_missing:estimate-a:missing'))
})

test('safe automatic output is independent of estimate and source input order', () => {
  const estimates = [estimate({ estimateId: 'a', sourceCandidateIds: ['source-a'] }), estimate({ estimateId: 'b', institutionKey: 'eastmoney-org:house-b', value: 12, sourceCandidateIds: ['source-b'] }), estimate({ estimateId: 'a-new', publishedAt: '2026-09-01T00:00:00.000Z', value: 11, sourceCandidateIds: ['source-a'] })]
  const first = assembleAutomaticEarningsExpectations({ projection: projection(estimates, [source('source-a'), source('source-b')]), targetFiscalYear: 2026, analysisAsOf: AS_OF, resultPublishedAt: RESULT })
  const second = assembleAutomaticEarningsExpectations({ projection: projection(estimates.slice().reverse(), [source('source-b'), source('source-a')]), targetFiscalYear: 2026, analysisAsOf: AS_OF, resultPublishedAt: RESULT })
  assert.deepEqual(first, second)
})

test('one institution does not produce a consensus snapshot', () => {
  const result = assembleAutomaticEarningsExpectations({ projection: projection([estimate()]), targetFiscalYear: 2026, analysisAsOf: AS_OF, resultPublishedAt: RESULT })
  assert.equal(result.bundle?.consensusSnapshots?.length, 0)
  assert.ok(result.diagnostics.includes('consensus_minimum_count_not_met'))
})

test('missing result cutoff blocks consensus and prior institution keys without discarding revisions', () => {
  const result = assembleAutomaticEarningsExpectations({ projection: projection([estimate(), estimate({ estimateId: 'new', value: 11, publishedAt: '2026-09-01T00:00:00.000Z' })]), targetFiscalYear: 2026, analysisAsOf: AS_OF })
  assert.equal(result.bundle?.consensusSnapshots?.length, 0)
  assert.deepEqual(result.bundle?.priorEstimateInstitutionKeys, [])
  assert.deepEqual(result.bundle?.estimateRevisionLinks, [{ oldEstimateId: 'estimate-a', newEstimateId: 'new' }])
  assert.ok(result.diagnostics.includes('automatic_result_cutoff_unavailable'))
})

test('latest genuine revision ignores reaffirmation and keeps the latest changing adjacent pair', () => {
  const result = assembleAutomaticEarningsExpectations({ projection: projection([
    estimate({ estimateId: 'jan', value: 10, publishedAt: '2026-01-01T00:00:00.000Z' }),
    estimate({ estimateId: 'mar', value: 11, publishedAt: '2026-03-01T00:00:00.000Z' }),
    estimate({ estimateId: 'may', value: 11, publishedAt: '2026-05-01T00:00:00.000Z' }),
    estimate({ estimateId: 'aug', value: 10.5, publishedAt: '2026-08-31T00:00:00.000Z' }),
  ]), targetFiscalYear: 2026, analysisAsOf: AS_OF, resultPublishedAt: RESULT })
  assert.deepEqual(result.bundle?.estimateRevisionLinks, [{ oldEstimateId: 'may', newEstimateId: 'aug' }])
})

test('caller bundle has absolute precedence and does not call Eastmoney', async () => {
  let calls = 0
  const caller = { sources: [], estimates: [] }
  const result = await resolveEarningsExpectations({ workflow: workflow({ expectations: caller, eastmoneyExpectationSource: { acquire: async () => { calls += 1; return acquisition() } } }), company: workflow().company, analysisAsOf: AS_OF, resultPublishedAt: RESULT })
  assert.equal(calls, 0)
  assert.equal(result.mode, 'caller')
  assert.equal(result.bundle, caller)
})

test('explicit empty caller bundle remains caller-owned', async () => {
  const caller = { sources: [], estimates: [], consensusSnapshots: [] }
  const result = await resolveEarningsExpectations({ workflow: workflow({ expectations: caller }), company: workflow().company, analysisAsOf: AS_OF })
  assert.equal(result.mode, 'caller')
  assert.equal(result.acquisitionStatus, 'not_attempted')
})

test('no caller and no source preserves no-attempt behavior', async () => {
  const result = await resolveEarningsExpectations({ workflow: workflow(), company: workflow().company, analysisAsOf: AS_OF })
  assert.deepEqual(result, { mode: 'none', diagnostics: [], acquisitionDiagnostics: [], acquisitionStatus: 'not_attempted', estimateCount: 0, institutionCount: 0, consensusSnapshotCount: 0, revisionLinkCount: 0 })
})

test('automatic request uses normalized company, analysis asOf, and requested fiscal year', async () => {
  let received: unknown
  const sourceClient = { acquire: async (request: unknown) => { received = request; return acquisition() } }
  const result = await resolveEarningsExpectations({ workflow: workflow({ fiscalYear: 2024, eastmoneyExpectationSource: sourceClient }), company: { symbol: '600519', name: '贵州茅台', exchange: 'SSE' }, analysisAsOf: AS_OF, resultPublishedAt: RESULT })
  assert.deepEqual(received, { company: { symbol: '600519', name: '贵州茅台', exchange: 'SSE' }, asOf: AS_OF, targetFiscalYear: 2024 })
  assert.equal(result.mode, 'automatic')
  assert.equal(result.bundle, undefined)
  assert.equal(result.acquisitionStatus, 'unavailable')
})

test('unexpected provider failure is non-blocking and observable', async () => {
  const result = await resolveEarningsExpectations({ workflow: workflow({ eastmoneyExpectationSource: { acquire: async () => { throw new Error('fixture transport failure') } } }), company: workflow().company, analysisAsOf: AS_OF })
  assert.equal(result.mode, 'automatic')
  assert.equal(result.acquisitionStatus, 'failed')
  assert.equal(result.providerOutcome?.providerFailed, true)
  assert.ok(result.diagnostics.includes('automatic_expectation_source_exception:fixture transport failure'))
})

test('truncated provider result remains usable but partial', async () => {
  const first = report('report-a', 'house-a', '2026-07-01T00:00:00.000Z', 10)
  const second = report('report-b', 'house-b', '2026-07-02T00:00:00.000Z', 12)
  const result = await resolveEarningsExpectations({ workflow: workflow({ eastmoneyExpectationSource: { acquire: async () => acquisition([source(`eastmoney-report-${sha256(first.infoCode)}`), source(`eastmoney-report-${sha256(second.infoCode)}`)], { records: [first, second], truncated: true }) } }), company: workflow().company, analysisAsOf: AS_OF, resultPublishedAt: RESULT })
  assert.equal(result.bundle?.estimates?.length, 2)
  assert.equal(result.acquisitionStatus, 'partial')
  assert.ok(result.diagnostics.includes('automatic_expectations_unavailable') === false)
})

test('workflow with no caller bundle and no source preserves not_provided behavior', async () => {
  const fixture = await workflowFixture()
  try {
    const result = await runWorkflowFixture(fixture)
    assert.equal(result.status, 'completed')
    assert.equal(result.telemetry.expectationInputMode, 'none')
    assert.equal(result.telemetry.expectationStatus, 'not_provided')
    assert.equal(result.providerOutcomes.some((item) => item.provider === 'eastmoney-reportapi'), false)
  } finally { await fixture.close() }
})

test('workflow caller bundle wins over configured automatic source', async () => {
  const fixture = await workflowFixture(); const calls: unknown[] = []; const caller = { sources: [], estimates: [] }
  try {
    const result = await runWorkflowFixture(fixture, { expectations: caller, eastmoneyExpectationSource: automaticSourceClient(calls) })
    assert.equal(result.status, 'completed')
    assert.equal(calls.length, 0)
    assert.equal(result.telemetry.expectationInputMode, 'caller')
    assert.equal(result.telemetry.expectationAcquisitionStatus, 'not_attempted')
    assert.equal(result.telemetry.expectationStatus, 'unavailable')
    assert.equal(result.providerOutcomes.some((item) => item.provider === 'eastmoney-reportapi'), false)
  } finally { await fixture.close() }
})

test('non-empty caller expectations remain caller-owned and never report provider acquisition', async () => {
  const fixture = await workflowFixture(); const calls: unknown[] = []; const caller = { sources: [source('caller-source')], estimates: [estimate()] }
  try {
    const result = await runWorkflowFixture(fixture, { expectations: caller, eastmoneyExpectationSource: automaticSourceClient(calls) })
    assert.equal(result.status, 'completed')
    assert.equal(calls.length, 0)
    assert.equal(result.telemetry.expectationInputMode, 'caller')
    assert.equal(result.telemetry.expectationAcquisitionStatus, 'not_attempted')
    assert.equal(result.providerOutcomes.some((item) => item.provider === 'eastmoney-reportapi'), false)
  } finally { await fixture.close() }
})

test('normal Earnings Review implicitly activates the AKShare expectations source ladder', async () => {
  const fixture = await workflowFixture(); const calls: string[] = []
  const akshare = { ...fixture.akshare, profitForecastThs: async () => { calls.push('ths'); return [thsExpectationRow('诚通证券', '2026-07-01', 65.1, '814亿'), thsExpectationRow('浙商证券', '2026-07-02', 65.7, '823亿')] }, researchReportEm: async () => { calls.push('eastmoney'); return [emExpectationRow('EastMoney', '2026-07-01', 1)] }, profitForecastEm: async () => { calls.push('aggregate'); return [{ 代码: '600519', '2026预测每股收益': 999 }] } }
  try {
    const result = await runWorkflowFixture(fixture, { akshare })
    assert.equal(result.status, 'completed')
    assert.deepEqual(calls, ['ths', 'ths'])
    assert.equal(result.telemetry.expectationInputMode, 'automatic')
    assert.equal(result.telemetry.expectationAcquisitionStatus, 'available')
    assert.equal(result.telemetry.expectationEstimateCount, 4)
    assert.equal(result.telemetry.expectationInstitutionCount, 2)
    assert.equal(result.telemetry.expectationConsensusSnapshotCount, 1)
    assert.equal(result.providerOutcomes.some((item) => item.provider === 'ths-institution-forecast' && item.providerSucceeded), true)
  } finally { await fixture.close() }
})

test('normal Earnings Review falls back from THS to individual EastMoney without using aggregate forecasts', async () => {
  const fixture = await workflowFixture(); const calls: string[] = []
  const akshare = { ...fixture.akshare, profitForecastThs: async () => { calls.push('ths'); return [] }, researchReportEm: async () => { calls.push('eastmoney'); return [emExpectationRow('西南证券', '2026-07-01', 65.1), emExpectationRow('中银证券', '2026-07-02', 65.7)] }, profitForecastEm: async () => { calls.push('aggregate'); return [{ 代码: '600519', '2026预测每股收益': 999 }] } }
  try {
    const result = await runWorkflowFixture(fixture, { akshare })
    assert.equal(result.status, 'completed')
    assert.deepEqual(calls, ['ths', 'eastmoney', 'ths'])
    assert.equal(result.telemetry.expectationInputMode, 'automatic')
    assert.equal(result.telemetry.expectationAcquisitionStatus, 'partial')
    assert.equal(result.telemetry.expectationEstimateCount, 2)
    assert.equal(result.telemetry.expectationConsensusSnapshotCount, 1)
    assert.equal(result.providerOutcomes.some((item) => item.provider === 'eastmoney-individual-research-report' && item.providerSucceeded), true)
    assert.equal(calls.includes('aggregate'), false)
  } finally { await fixture.close() }
})

test('caller expectations override implicit AKShare activation', async () => {
  const fixture = await workflowFixture(); let thsCalls = 0; let eastmoneyCalls = 0
  const caller = { sources: [], estimates: [] }
  const akshare = { ...fixture.akshare, profitForecastThs: async () => { thsCalls += 1; return [] }, researchReportEm: async () => { eastmoneyCalls += 1; return [] } }
  try {
    const result = await runWorkflowFixture(fixture, { expectations: caller, akshare })
    assert.equal(result.status, 'completed')
    assert.equal(result.telemetry.expectationInputMode, 'caller')
    assert.equal(thsCalls, 0)
    assert.equal(eastmoneyCalls, 0)
  } finally { await fixture.close() }
})

test('workflow automatically acquires once, keeps estimates report-only, and exposes deterministic telemetry', async () => {
  const fixture = await workflowFixture(); const calls: unknown[] = []; const executor = new CaptureExecutor()
  try {
    const sourceClient = automaticSourceClient(calls)
    const result = await runEarningsReview({ workflowRunId: 'automatic-success', handle: fixture.handle, company: { symbol: '600519', name: '贵州茅台', exchange: 'SSE' }, fiscalYear: 2026, period: 'H1', reportRoot: fixture.reports, acquisitionPlugins: [fixture.plugin], akshare: fixture.akshare, now: () => AS_OF, reasoningExecutor: executor, eastmoneyExpectationSource: sourceClient })
    assert.equal(result.status, 'completed')
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0], { company: { symbol: '600519', name: '贵州茅台', exchange: 'SH' }, asOf: AS_OF, targetFiscalYear: 2026 })
    assert.equal(result.telemetry.expectationInputMode, 'automatic')
    assert.equal(result.telemetry.expectationAcquisitionStatus, 'available')
    assert.equal(result.telemetry.expectationEstimateCount, 3)
    assert.equal(result.telemetry.expectationInstitutionCount, 2)
    assert.equal(result.telemetry.expectationConsensusSnapshotCount, 1)
    assert.equal(result.telemetry.expectationRevisionLinkCount, 1)
    assert.equal(result.providerOutcomes.filter((item) => item.provider === 'eastmoney-reportapi').length, 1)
    assert.equal(result.sourceIds.some((id) => id.includes('eastmoney-report')), false)
    const assets = await readCanonicalV04Assets(fixture.root)
    assert.equal(assets.objects.some((item) => JSON.stringify(item.value).includes('eastmoney-reportapi')), false)
    const report = await readFile(result.report!.outputPath, 'utf8')
    assert.match(report, /automatically acquired point-in-time institution forecasts from the registered source ladder/)
    assert.match(report, /ResearchHub deterministic institution-level consensus\/revision assembly/)
    const reportMetadata = await readFile(`${result.report!.outputPath}.json`, 'utf8')
    assert.match(reportMetadata, /https:\/\/data\.eastmoney\.com\/report\/stock\.jshtml/)
  } finally { await fixture.close() }
})

test('automatic partial acquisition is explicit in methodology and provider outcome', async () => {
  const fixture = await workflowFixture(); const calls: unknown[] = []; const base = automaticSourceClient(calls)
  try {
    const result = await runWorkflowFixture(fixture, { eastmoneyExpectationSource: { acquire: async (request: unknown) => ({ ...(await base.acquire(request)), truncated: true }) } })
    assert.equal(result.status, 'completed')
    assert.equal(result.telemetry.expectationAcquisitionStatus, 'partial')
    assert.equal(result.providerOutcomes.filter((item) => item.provider === 'eastmoney-reportapi').length, 1)
    const report = await readFile(result.report!.outputPath, 'utf8')
    assert.match(report, /partially acquired point-in-time institution forecasts from the registered source ladder/)
    assert.doesNotMatch(report, /automatically acquired point-in-time institution forecasts from the registered source ladder/)
  } finally { await fixture.close() }
})

test('automatic unavailable acquisition does not claim successful acquisition', async () => {
  const fixture = await workflowFixture()
  try {
    const result = await runWorkflowFixture(fixture, { eastmoneyExpectationSource: { acquire: async () => acquisition([], { records: [] }) } })
    assert.equal(result.status, 'completed')
    assert.equal(result.telemetry.expectationAcquisitionStatus, 'unavailable')
    assert.equal(result.telemetry.expectationStatus, 'unavailable')
    assert.equal(result.providerOutcomes.filter((item) => item.provider === 'eastmoney-reportapi').length, 1)
    const report = await readFile(result.report!.outputPath, 'utf8')
    assert.match(report, /automatic institution-forecast acquisition was attempted but produced no usable expectations/)
    assert.doesNotMatch(report, /automatically acquired point-in-time institution forecasts from the registered source ladder/)
  } finally { await fixture.close() }
})

test('automatic expectation acquisition occurs after expectation-blind Earnings reasoning', async () => {
  const fixture = await workflowFixture(); const calls: unknown[] = []; const executor = new CaptureExecutor()
  try {
    const result = await runWorkflowFixture(fixture, { eastmoneyExpectationSource: automaticSourceClient(calls), reasoningExecutor: executor })
    assert.equal(result.status, 'completed')
    const request = executor.requests[0]
    assert.ok(request)
    const serialized = JSON.stringify(request?.input)
    assert.doesNotMatch(serialized, /eastmoney|EstimatePoint|ConsensusSnapshot|revision/i)
  } finally { await fixture.close() }
})

test('automatic expectations do not change durable Earnings proposals or Knowledge writes', async () => {
  const fixedOutput = { sections: EARNINGS_REVIEW_SECTIONS.map((title) => ({ title, markdown: 'Verified.', sourceCandidateIds: title === 'Earnings Snapshot' ? ['official-2026-h1'] : [], assessmentRefs: title === 'Earnings Snapshot' ? ['impact-1'] : [] })), impactAssessments: [{ assessmentId: 'impact-1', disposition: 'new_fact' as const, existingKnowledgeRefs: [], sourceCandidateIds: ['official-2026-h1'], rationale: 'Official evidence.' }], proposals: [{ proposalId: 'proposal-automatic-isolation', kind: 'claim' as const, claimType: 'fact' as const, subjectKey: 'company', statement: 'The official filing confirms the reported result.', sourceCandidateIds: ['official-2026-h1'], assessmentRefs: ['impact-1'] }] }
  const withoutAutomatic = await workflowFixture(); const withAutomatic = await workflowFixture(); const calls: unknown[] = []
  try {
    const base = await runWorkflowFixture(withoutAutomatic, { reasoningExecutor: new FixedExecutor(fixedOutput), writeKnowledge: true })
    const automatic = await runWorkflowFixture(withAutomatic, { reasoningExecutor: new FixedExecutor(fixedOutput), writeKnowledge: true, eastmoneyExpectationSource: automaticSourceClient(calls) })
    assert.equal(base.status, 'completed')
    assert.equal(automatic.status, 'completed')
    assert.deepEqual(automatic.proposalIds, base.proposalIds)
    assert.deepEqual(automatic.claimIds, base.claimIds)
    assert.deepEqual(automatic.sourceIds, base.sourceIds)
    assert.equal(calls.length, 1)
    const assets = await readCanonicalV04Assets(withAutomatic.root)
    assert.equal(assets.objects.some((item) => JSON.stringify(item.value).includes('eastmoney-reportapi')), false)
  } finally { await withoutAutomatic.close(); await withAutomatic.close() }
})

test('automatic provider failure completes the base Earnings Review', async () => {
  const fixture = await workflowFixture()
  try {
    const result = await runWorkflowFixture(fixture, { eastmoneyExpectationSource: { acquire: async () => { throw new Error('automatic fixture failure') } } })
    assert.equal(result.status, 'completed')
    assert.equal(result.telemetry.expectationInputMode, 'automatic')
    assert.equal(result.telemetry.expectationAcquisitionStatus, 'failed')
    assert.equal(result.telemetry.expectationStatus, 'unavailable')
    assert.ok(result.acquisitionDiagnostics.some((item) => item.provider === 'eastmoney-reportapi' && item.status === 'failed'))
    const report = await readFile(result.report!.outputPath, 'utf8')
    assert.match(report, /automatic institution-forecast acquisition failed/)
    assert.doesNotMatch(report, /automatically acquired point-in-time institution forecasts from the registered source ladder/)
  } finally { await fixture.close() }
})
