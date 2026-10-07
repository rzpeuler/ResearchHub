import assert from 'node:assert/strict'
import test from 'node:test'
import { AkshareEarningsExpectationsSource } from '../../workflows/earnings-review/expectations-acquisition.ts'
import { assembleAutomaticEarningsExpectations } from '../../workflows/earnings-review/automatic-expectations.ts'
import { parseChineseMoney, projectThsInstitutionForecasts } from '../../workflows/earnings-review/expectations-ths.ts'
import { projectAkshareEastmoneyResearchReports } from '../../workflows/earnings-review/expectations-eastmoney-akshare.ts'
import { resolveEarningsExpectations } from '../../workflows/earnings-review/automatic-expectations.ts'
import type { EarningsReviewWorkflowInput } from '../../workflows/earnings-review/contracts.ts'
import type { AkshareDataClient } from '../../plugins/research-acquisition/akshare.ts'

const AS_OF = '2026-09-22T00:00:00.000Z'
const RETRIEVED = '2026-09-22T01:00:00.000Z'
const COMPANY = { symbol: '600519', name: '贵州茅台', exchange: 'SSE' } as const

const thsRow = (institution: string, date: string, eps = 65.14, netProfit = '814.24亿') => ({
  机构名称: institution,
  研究员: '研究员甲',
  预测年报每股收益2026预测: eps,
  预测年报每股收益2027预测: 67.87,
  预测年报每股收益2028预测: 71.32,
  预测年报净利润2026预测: netProfit,
  预测年报净利润2027预测: '848.44亿',
  预测年报净利润2028预测: '891.60亿',
  报告日期: date,
})

const emRow = (institution: string, date: string, eps = 66.2) => ({
  股票代码: '600519',
  股票简称: '贵州茅台',
  报告名称: `${institution}研究报告`,
  机构: institution,
  '2026-盈利预测-收益': eps,
  '2027-盈利预测-收益': 69.1,
  '2028-盈利预测-收益': 72.4,
  日期: date,
  报告PDF链接: `https://pdf.dfcfw.com/pdf/${institution}.pdf`,
})

function client(overrides: Partial<AkshareDataClient> = {}): AkshareDataClient {
  return {
    companyBasic: async () => ({}),
    financialData: async () => ({}),
    historicalMarketData: async () => ({}),
    ...overrides,
  }
}

test('THS projection normalizes explicit Chinese money, date-only EOD, and rejects bare profit values', () => {
  assert.equal(parseChineseMoney('814.24亿'), 81_424_000_000)
  assert.equal(parseChineseMoney('1,200万元'), 12_000_000)
  assert.equal(parseChineseMoney('814.24'), undefined)
  const projection = projectThsInstitutionForecasts({ payload: [thsRow('诚通证券', '2026-09-18', 65.14, '814.24')], company: COMPANY, asOf: AS_OF, retrievedAt: RETRIEVED })
  assert.equal(projection.estimates.filter((item) => item.metric === 'eps').length, 3)
  assert.equal(projection.estimates.filter((item) => item.metric === 'net_profit').length, 2)
  assert.ok(projection.diagnostics.some((item) => item.startsWith('ths_value_invalid:0:预测年报净利润2026预测')))
  assert.equal(projection.estimates[0]?.publishedAt, '2026-09-18T15:59:59.999Z')
  assert.equal(projection.estimates.find((item) => item.metric === 'eps' && item.fiscalPeriod === '2026-FY')?.unit, 'CNY_per_share')
})

test('future-only provider rows are excluded and marked point-in-time unavailable', () => {
  const projection = projectThsInstitutionForecasts({ payload: [thsRow('诚通证券', '2026-09-23')], company: COMPANY, asOf: AS_OF, retrievedAt: RETRIEVED })
  assert.equal(projection.estimates.length, 0)
  assert.ok(projection.diagnostics.includes('NO_ELIGIBLE_POINT_IN_TIME_DATA'))
})

test('THS row order does not change deterministic estimate or source IDs', () => {
  const rows = [thsRow('诚通证券', '2026-09-18'), thsRow('浙商证券', '2026-08-24', 65.77, '823.58亿')]
  const left = projectThsInstitutionForecasts({ payload: rows, company: COMPANY, asOf: AS_OF, retrievedAt: RETRIEVED })
  const right = projectThsInstitutionForecasts({ payload: rows.slice().reverse(), company: COMPANY, asOf: AS_OF, retrievedAt: RETRIEVED })
  assert.deepEqual(left.estimates.map((item) => item.estimateId), right.estimates.map((item) => item.estimateId))
  assert.deepEqual(left.sources.map((item) => item.candidate.candidateId), right.sources.map((item) => item.candidate.candidateId))
})

test('THS success prevents EastMoney fallback calls', async () => {
  let thsCalls = 0
  let emCalls = 0
  const source = new AkshareEarningsExpectationsSource({ akshare: client({
    profitForecastThs: async () => { thsCalls += 1; return [thsRow('诚通证券', '2026-09-18'), thsRow('浙商证券', '2026-08-24', 65.77, '823.58亿')] },
    researchReportEm: async () => { emCalls += 1; return [emRow('EastMoney', '2026-09-18')] },
  }), now: () => RETRIEVED })
  const result = await source.acquire({ company: COMPANY, asOf: AS_OF, targetFiscalYear: 2026 })
  assert.equal(thsCalls, 2)
  assert.equal(emCalls, 0)
  assert.equal(result.status, 'available')
  assert.equal(result.projection.estimates.filter((item) => item.metric === 'net_profit').length, 6)
  assert.equal(result.providerOutcomes.find((item) => item.provider === 'eastmoney-individual-research-report')?.providerAttempted, false)
})

test('THS empty and transport failure fall through to individual EastMoney reports, never aggregate forecasts', async () => {
  let emCalls = 0
  let aggregateCalls = 0
  const source = new AkshareEarningsExpectationsSource({ akshare: client({
    profitForecastThs: async () => { throw new Error('THS transport failure') },
    researchReportEm: async () => { emCalls += 1; return [emRow('西南证券', '2026-09-18', 66.2), emRow('中银证券', '2026-08-21', 67.1)] },
    profitForecastEm: async () => { aggregateCalls += 1; return [{ 代码: '600519', 名称: '贵州茅台', '2026预测每股收益': 999 }] },
  }), now: () => RETRIEVED })
  const result = await source.acquire({ company: COMPANY, asOf: AS_OF, targetFiscalYear: 2026 })
  assert.equal(emCalls, 1)
  assert.equal(aggregateCalls, 0)
  assert.equal(result.projection.estimates.filter((item) => item.metric === 'eps').length, 6)
  assert.equal(result.projection.estimates.some((item) => item.value === 999), false)
  assert.ok(result.diagnostics.some((item) => item.includes('eps:PRIMARY_UNSUPPORTED')))
})

test('EastMoney individual projection preserves PDF URL and date-only EOD', () => {
  const projection = projectAkshareEastmoneyResearchReports({ payload: [emRow('西南证券', '2026-08-21')], company: COMPANY, asOf: AS_OF, retrievedAt: RETRIEVED })
  assert.equal(projection.estimates[0]?.unit, 'CNY_per_share')
  assert.equal(projection.estimates[0]?.publishedAt, '2026-08-21T15:59:59.999Z')
  assert.equal(projection.sources[0]?.candidate.url, 'https://pdf.dfcfw.com/pdf/西南证券.pdf')
})

test('W2 assembly selects latest estimate per institution and builds two-institution consensus without averaging raw points', () => {
  const projection = projectThsInstitutionForecasts({ payload: [thsRow('诚通证券', '2026-09-10', 60), thsRow('诚通证券', '2026-09-18', 65.14), thsRow('浙商证券', '2026-08-24', 65.77, '823.58亿')], company: COMPANY, asOf: AS_OF, retrievedAt: RETRIEVED })
  const assembly = assembleAutomaticEarningsExpectations({ projection, targetFiscalYear: 2026, analysisAsOf: AS_OF, resultPublishedAt: '2026-09-21T00:00:00.000Z' })
  assert.equal(assembly.consensusSnapshotCount, 1)
  assert.equal(assembly.institutionCount, 2)
  assert.equal(assembly.bundle?.consensusSnapshots?.[0]?.count, 2)
  assert.equal(assembly.bundle?.consensusSnapshots?.[0]?.mean, (65.14 + 65.77) / 2)
  assert.equal(assembly.revisionLinkCount, 1)
  assert.equal(assembly.bundle?.estimates?.filter((item) => item.metric === 'eps').length, 3)
  assert.equal(assembly.bundle?.estimates?.filter((item) => item.metric === 'net_profit').length, 3)
})

test('insufficient institution count leaves consensus unavailable', () => {
  const projection = projectThsInstitutionForecasts({ payload: [thsRow('诚通证券', '2026-09-18')], company: COMPANY, asOf: AS_OF, retrievedAt: RETRIEVED })
  const assembly = assembleAutomaticEarningsExpectations({ projection, targetFiscalYear: 2026, analysisAsOf: AS_OF, resultPublishedAt: '2026-09-21T00:00:00.000Z' })
  assert.equal(assembly.consensusSnapshotCount, 0)
  assert.ok(assembly.diagnostics.includes('consensus_minimum_count_not_met'))
})

test('caller-supplied expectations override the D1 acquisition source', async () => {
  let calls = 0
  const workflow = { fiscalYear: 2026, expectations: { sources: [], estimates: [] }, earningsExpectationsSource: { acquire: async () => { calls += 1; throw new Error('must not be called') } } } as unknown as EarningsReviewWorkflowInput
  const result = await resolveEarningsExpectations({ workflow, company: COMPANY, analysisAsOf: AS_OF })
  assert.equal(result.mode, 'caller')
  assert.equal(calls, 0)
})

test('explicit expectations source takes precedence over implicit AKShare activation', async () => {
  let explicitCalls = 0
  let thsCalls = 0
  const explicit = { acquire: async () => { explicitCalls += 1; return { projection: projectThsInstitutionForecasts({ payload: [thsRow('诚通证券', '2026-09-18')], company: COMPANY, asOf: AS_OF, retrievedAt: RETRIEVED }), results: [], attempts: [], diagnostics: [], providerOutcomes: [], status: 'available' as const } } }
  const workflow = { fiscalYear: 2026, earningsExpectationsSource: explicit, akshare: client({ profitForecastThs: async () => { thsCalls += 1; return [] } }) } as unknown as EarningsReviewWorkflowInput
  const result = await resolveEarningsExpectations({ workflow, company: COMPANY, analysisAsOf: AS_OF })
  assert.equal(result.mode, 'automatic')
  assert.equal(explicitCalls, 1)
  assert.equal(thsCalls, 0)
})

test('automatic D0 requirements are authoritative numeric and prohibit LLM Web fallback', async () => {
  const requirements: Array<{ readonly determinismClass: string; readonly llmWebFallback: string }> = []
  const source = new AkshareEarningsExpectationsSource({ akshare: client({ profitForecastThs: async () => [] }), now: () => RETRIEVED, onRequirement: (requirement) => requirements.push(requirement) })
  await source.acquire({ company: COMPANY, asOf: AS_OF, targetFiscalYear: 2026 })
  assert.deepEqual(requirements.map((requirement) => [requirement.determinismClass, requirement.llmWebFallback]), [['AUTHORITATIVE_NUMERIC', 'FORBIDDEN'], ['AUTHORITATIVE_NUMERIC', 'FORBIDDEN']])
})

test('single EPS question materializes only EPS and preserves the THS institution estimate', async () => {
  const requirements: Array<{ readonly metricId?: string }> = []
  let calls = 0
  const source = new AkshareEarningsExpectationsSource({ akshare: client({ profitForecastThs: async () => { calls += 1; return [thsRow('诚通证券', '2026-09-18')] } }), now: () => RETRIEVED, onRequirement: (item) => requirements.push(item) })
  const result = await source.acquire({ company: COMPANY, asOf: AS_OF, targetFiscalYear: 2026, metric: 'eps' })
  assert.deepEqual(requirements.map((item) => item.metricId), ['earnings_expectation_eps'])
  assert.equal(result.results.length, 1)
  assert.equal(calls, 1)
  assert.equal(result.projection.estimates.every((item) => item.metric === 'eps'), true)
})

test('automatic diagnostics attribute THS and EastMoney to their actual providers', async () => {
  const workflow = { fiscalYear: 2026, akshare: client({ profitForecastThs: async () => [], researchReportEm: async () => [] }) } as unknown as EarningsReviewWorkflowInput
  const result = await resolveEarningsExpectations({ workflow, company: COMPANY, analysisAsOf: AS_OF })
  assert.equal(result.acquisitionStatus, 'unavailable')
  assert.equal(result.acquisitionDiagnostics.some((item) => item.provider === 'ths-institution-forecast'), true)
  assert.equal(result.acquisitionDiagnostics.some((item) => item.provider === 'eastmoney-individual-research-report'), true)
  assert.equal(result.acquisitionDiagnostics.some((item) => item.provider === 'eastmoney-reportapi'), false)
})
