import assert from 'node:assert/strict'
import test from 'node:test'
import { materializePhase2CommonRequirement } from '../../data/requirements.ts'
import { createEarningsDataResolver } from '../../plugins/research-acquisition/earnings-data.ts'
import type { AkshareDataClient } from '../../plugins/research-acquisition/akshare.ts'
import type { ResearchAcquisitionPlugin } from '../../plugins/research-acquisition/contracts.ts'
import { selectOfficialEarningsFilings } from '../../workflows/earnings-review/workflow.ts'
import { sha256 } from '../../plugins/research-acquisition/hash.ts'

const company = { symbol: '600519', name: 'Fixture Company', exchange: 'SSE' } as const
const asOf = '2026-09-22T00:00:00.000Z'
const now = () => '2026-09-22T01:00:00.000Z'
const period = { fiscalYear: 2026, fiscalPeriod: '2026-H1', end: '2026-06-30' }
const akshare = (overrides: Partial<AkshareDataClient>): AkshareDataClient => ({ companyBasic: async () => ({}), historicalMarketData: async () => ({}), financialData: async () => ({}), ...overrides })
const requirement = (metricId: string, cutoff = asOf, historicalNumeric = false) => materializePhase2CommonRequirement(metricId, { workflowId: 'earnings-review', ticker: company.symbol, companyId: company.name, asOf: cutoff, period, required: false, historicalNumeric })

test('Earnings actual metrics resolve independently through Data-owned policies and one AKShare call', async () => {
  let calls = 0
  const resolver = createEarningsDataResolver({ company, fiscalYear: 2026, period: 'H1', asOf, now, acquisitionPlugins: [], akshare: akshare({ financialData: async () => { calls += 1; return [{ 报告期: '2026-06-30', 基本每股收益: 4, 净利润: 0, 营业收入: 20 }] } }) })
  const bundle = await resolver.resolve([requirement('earnings_actual_eps'), requirement('earnings_actual_net_profit')])
  assert.equal(calls, 1)
  assert.deepEqual(bundle.items.map((item) => item.status), ['AVAILABLE', 'AVAILABLE'])
  assert.deepEqual(bundle.items.map((item) => item.acquisition.policyId), ['earnings-actual-earnings_actual_eps', 'earnings-actual-earnings_actual_net_profit'])
  assert.deepEqual(bundle.items.map((item) => item.source?.valueVersion?.status), ['UNVERIFIED', 'UNVERIFIED'])
})

test('historical Earnings actual without value-version proof remains unavailable', async () => {
  const cutoff = '2026-07-01T00:00:00.000Z'
  const resolver = createEarningsDataResolver({ company, fiscalYear: 2026, period: 'H1', asOf: cutoff, now, acquisitionPlugins: [], akshare: akshare({ financialData: async () => [{ 报告期: '2026-06-30', 公告日期: '2026-06-30', 基本每股收益: 4 }] }) })
  const result = await resolver.resolveOne(requirement('earnings_actual_eps', cutoff, true))
  assert.equal(result.status, 'UNAVAILABLE')
  assert.equal(result.unavailableReason, 'NO_ELIGIBLE_POINT_IN_TIME_DATA')
  assert.equal(result.attempts[0]?.status, 'POINT_IN_TIME_INVALID')
})

test('future financial notice cannot satisfy an actual metric even in current snapshot mode', async () => {
  const resolver = createEarningsDataResolver({ company, fiscalYear: 2026, period: 'H1', asOf, now, acquisitionPlugins: [], akshare: akshare({ financialData: async () => [{ 报告期: '2026-06-30', 公告日期: '2026-09-23', 基本每股收益: 4 }] }) })
  const result = await resolver.resolveOne(requirement('earnings_actual_eps'))
  assert.equal(result.status, 'UNAVAILABLE')
  assert.equal(result.attempts[0]?.status, 'POINT_IN_TIME_INVALID')
})

test('selected correction publication, including fiscal_period rows, controls actual PIT', async () => {
  const rows = [
    { fiscal_period: '2026-06-30', 公告日期: '2026-08-01', 基本每股收益: 2 },
    { fiscal_period: '2026-06-30', 公告日期: '2026-10-01', 基本每股收益: 99 },
  ]
  for (const ordered of [rows, rows.slice().reverse()]) {
    const resolver = createEarningsDataResolver({ company, fiscalYear: 2026, period: 'H1', asOf, now, acquisitionPlugins: [], akshare: akshare({ financialData: async () => ordered }) })
    const result = await resolver.resolveOne(requirement('earnings_actual_eps'))
    assert.equal(result.status, 'UNAVAILABLE')
    assert.equal(result.attempts[0]?.status, 'POINT_IN_TIME_INVALID')
  }
})

test('future correction to prior or opening quality row cannot enter an accepted actual payload', async () => {
  for (const correctedPeriod of ['2025-06-30', '2025-12-31']) {
    const resolver = createEarningsDataResolver({ company, fiscalYear: 2026, period: 'H1', asOf, now, acquisitionPlugins: [], akshare: akshare({ financialData: async () => [
      { fiscal_period: '2026-06-30', 公告日期: '2026-08-01', 营业收入: 20 },
      { fiscal_period: correctedPeriod, 公告日期: '2026-10-01', 营业收入: 10 },
    ] }) })
    const result = await resolver.resolveOne(requirement('earnings_actual_revenue'))
    assert.equal(result.status, 'UNAVAILABLE')
    assert.equal(result.attempts[0]?.status, 'POINT_IN_TIME_INVALID')
  }
})

test('wrong-year THS estimates do not suppress exact-FY EastMoney fallback', async () => {
  let eastmoneyCalls = 0
  const resolver = createEarningsDataResolver({ company, fiscalYear: 2026, period: 'FY', asOf, now, acquisitionPlugins: [], akshare: akshare({
    profitForecastThs: async () => [{ 机构名称: 'Wrong Year', 报告日期: '2026-09-01', 预测年报每股收益2027预测: 7 }],
    researchReportEm: async () => { eastmoneyCalls += 1; return [{ 股票代码: '600519', 股票简称: 'Fixture Company', 报告名称: 'Exact FY Report', 机构: 'Exact House', 日期: '2026-09-01', '2026-盈利预测-收益': 6, 报告PDF链接: 'https://pdf.dfcfw.com/pdf/exact.pdf' }] },
  }) })
  const estimateRequirement = materializePhase2CommonRequirement('earnings_expectation_eps', { workflowId: 'earnings-review', ticker: company.symbol, companyId: company.name, asOf, period: { fiscalYear: 2026, fiscalPeriod: '2026-FY' }, required: false })
  const result = await resolver.resolveOne(estimateRequirement)
  assert.equal(eastmoneyCalls, 1)
  assert.equal(result.status, 'AVAILABLE')
  assert.equal(result.source?.sourceId, 'eastmoney-individual-research-report')
  assert.ok(result.value?.kind === 'expectation' && result.value.projection.estimates.every((item) => item.fiscalPeriod === '2026-FY'))
})

test('official filing uses Data policy while Earnings owns exact-period correction selection', async () => {
  const candidates = [
    { candidateId: 'summary', kind: 'official_disclosure' as const, tier: 1 as const, title: '2026年半年度报告摘要', provider: 'cninfo', publishedAt: '2026-08-30T00:00:00.000Z' },
    { candidateId: 'full', kind: 'official_disclosure' as const, tier: 1 as const, title: '2026年半年度报告', provider: 'cninfo', publishedAt: '2026-08-30T00:00:00.000Z', metadata: { announcementId: 'a-full' } },
    { candidateId: 'correction', kind: 'official_disclosure' as const, tier: 1 as const, title: '2026年半年度报告更正公告', provider: 'cninfo', publishedAt: '2026-09-01T00:00:00.000Z', metadata: { correctionOf: 'a-full' } },
    { candidateId: 'future', kind: 'official_disclosure' as const, tier: 1 as const, title: '2026年半年度报告更正公告', provider: 'cninfo', publishedAt: '2026-10-01T00:00:00.000Z' },
  ]
  const fetched: string[] = []
  const plugin = { name: 'fixture-official-disclosure', discover: async () => candidates, fetch: async (candidate: (typeof candidates)[number]) => { fetched.push(candidate.candidateId); return { candidate, retrievedAt: now(), content: candidate.title } }, normalize: async (source: { candidate: (typeof candidates)[number]; retrievedAt: string; content: string }) => ({ candidate: source.candidate, retrievedAt: source.retrievedAt, title: source.candidate.title, content: source.content, contentHash: sha256(source.content), publisher: 'CNINFO', rights: { accessScope: 'public' as const, retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false } }) }
  const resolver = createEarningsDataResolver({ company, fiscalYear: 2026, period: 'H1', asOf, now, acquisitionPlugins: [plugin], selectFilings: (discovered, fiscalYear, filingPeriod, cutoff) => selectOfficialEarningsFilings(discovered, { fiscalYear, period: filingPeriod }, cutoff) })
  const result = await resolver.resolveOne(requirement('earnings_official_filing'))
  assert.equal(result.acquisition.policyId, 'earnings-official-filing-cninfo')
  assert.equal(result.value?.kind, 'filing')
  if (result.value?.kind !== 'filing') throw new Error('filing payload missing')
  assert.deepEqual(result.value.sources.map((item) => item.candidate.candidateId), ['full', 'correction'])
  assert.deepEqual(fetched, ['full', 'correction'])
  assert.equal(result.value.selection.futureFilteredCount, 1)
})

test('official filing fetch outage is a provider failure with candidate diagnostics, not unpublished data', async () => {
  const candidate = { candidateId: 'full-503', kind: 'official_disclosure' as const, tier: 1 as const, title: '2026年半年度报告', provider: 'cninfo', publishedAt: '2026-08-30T00:00:00.000Z' }
  const plugin = { name: 'fixture-official-disclosure', discover: async () => [candidate], fetch: async () => { throw new Error('HTTP 503 service unavailable') }, normalize: async () => { throw new Error('normalize must not run') } } as unknown as ResearchAcquisitionPlugin
  const resolver = createEarningsDataResolver({ company, fiscalYear: 2026, period: 'H1', asOf, now, acquisitionPlugins: [plugin], selectFilings: (discovered, fiscalYear, filingPeriod, cutoff) => selectOfficialEarningsFilings(discovered, { fiscalYear, period: filingPeriod }, cutoff) })
  const result = await resolver.resolveOne(requirement('earnings_official_filing'))
  assert.equal(result.status, 'UNAVAILABLE')
  assert.equal(result.unavailableReason, 'ALL_FALLBACKS_EXHAUSTED')
  assert.equal(result.attempts[0]?.status, 'SOURCE_ERROR')
  assert.match(result.attempts[0]?.diagnostic ?? '', /full-503.*HTTP 503/)
})
