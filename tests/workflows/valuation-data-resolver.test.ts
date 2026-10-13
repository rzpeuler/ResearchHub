import assert from 'node:assert/strict'
import test from 'node:test'
import type { AkshareDataClient } from '../../plugins/research-acquisition/akshare.ts'
import type { OfficialDisclosureClient } from '../../plugins/research-acquisition/official.ts'
import { createValuationDataResolver, type ValuationPeerRequirement } from '../../plugins/research-acquisition/valuation-data.ts'
import { materializePhase2CommonRequirement } from '../../data/requirements.ts'

const NOW = '2026-09-09T00:00:00.000Z'
const company = { symbol: '600519', name: 'Fixture', exchange: 'SSE' }

function clients(options: { readonly publication?: string; readonly financialIndicator?: boolean } = {}) {
  const calls: string[] = []
  const financial = async () => { calls.push('financialData'); return [{ REPORT_DATE: '2025-12-31', 公告日期: '2026-03-30', EPSJB: 10, BPS: 20 }] }
  const akshare: AkshareDataClient = {
    companyBasic: async () => [],
    financialData: financial,
    ...(options.financialIndicator ? { valuationFinancialIndicators: async () => { calls.push('valuationFinancialIndicators'); return financial() } } : {}),
    historicalMarketData: async () => { calls.push('historicalMarketData'); return [{ date: '2026-09-08', close: 150 }, { date: '2026-09-09', close: 160 }] },
    peerComparison: async ({ family, correlatedSymbol }) => { calls.push(`peerComparison:${family}:${correlatedSymbol ?? 'cohort'}`); return { result: { data: [{ SECUCODE: '000001.SZ', TOTAL_CAP: 900 }] } } },
  }
  const officialDisclosure: OfficialDisclosureClient = {
    list: async () => [], fetch: async () => '',
    resolveAnnualReportPublication: async ({ fiscalYear }) => { calls.push(`resolveAnnualReportPublication:${fiscalYear}`); return { issuer: company.symbol, fiscalYear, reportTitle: `${fiscalYear} annual report`, officialPublishedAt: options.publication ?? '2026-04-01T08:00:00.000Z', rawPublishedAt: options.publication ?? '2026-04-01', sourceUrl: 'https://static.cninfo.com.cn/fixture.pdf', originPublisher: 'CNINFO', originAuthority: 'S0_STATUTORY', retrievalProvider: 'CNINFO', retrievedAt: NOW } },
  }
  return { akshare, officialDisclosure, calls }
}

function requirement(metricId: string, asOf = NOW, historicalNumeric = false) {
  return materializePhase2CommonRequirement(metricId, { workflowId: 'valuation', ticker: company.symbol, companyId: company.name, asOf, period: { end: asOf, ...(metricId === 'valuation_market_price' ? {} : { fiscalYear: 2025 }) }, required: true, historicalNumeric })
}

test('Valuation Common requirements execute through explicit Data policies and operation bindings', async () => {
  const fixture = clients()
  const resolver = createValuationDataResolver({ ...fixture, company, valuationDate: NOW, now: () => NOW })
  const result = await resolver.resolve([requirement('valuation_market_price'), requirement('valuation_eps'), requirement('valuation_bvps'), requirement('valuation_annual_report_publication')])
  assert.equal(result.completeness, 'COMPLETE')
  assert.deepEqual(result.items.map((item) => item.acquisition.policyId), ['valuation-market-price-eastmoney-tencent', 'valuation-eps-eastmoney', 'valuation-bvps-eastmoney', 'valuation-annual-publication-cninfo'])
  assert.equal(result.items[0]?.value?.kind, 'market')
  assert.equal(result.items[1]?.value?.kind, 'financial')
  assert.equal(result.items[2]?.value?.kind, 'financial')
  assert.equal(result.items[3]?.value?.kind, 'publication')
  assert.equal(result.items[0]?.source?.observedAt, '2026-09-08')
  assert.equal(result.items[0]?.source?.retrievedAt, NOW)
  assert.equal(result.items[1]?.quality.valueVersionStatus, 'UNVERIFIED')
  assert.equal(result.items[1]?.quality.pointInTimeSafe, false)
  assert.ok(fixture.calls.includes('historicalMarketData'))
  assert.equal(fixture.calls.filter((item) => item === 'financialData').length, 1)
  assert.ok(fixture.calls.includes('resolveAnnualReportPublication:2025'))
})

test('Valuation market acquisition falls back to Tencent with bounded dates and truthful provenance', async () => {
  const fixture = clients()
  const calls: Array<{ readonly symbol: string; readonly startDate?: string; readonly endDate?: string }> = []
  const akshare: AkshareDataClient = {
    ...fixture.akshare,
    historicalMarketData: async () => { throw new Error('ProxyError: EastMoney request failed') },
    historicalMarketDataTencent: async (request) => { calls.push(request); return [{ date: '2026-09-08', close: 150 }, { date: '2026-09-09', close: 160 }] },
  }
  const resolver = createValuationDataResolver({ akshare, officialDisclosure: fixture.officialDisclosure, company, valuationDate: NOW, now: () => NOW })
  const result = await resolver.resolveOne(requirement('valuation_market_price'))
  assert.equal(result.status, 'AVAILABLE')
  assert.deepEqual(result.attempts.map((attempt) => [attempt.sourceId, attempt.status]), [['akshare-historical-market-data', 'SOURCE_ERROR'], ['akshare-tencent-historical-market-data', 'SUCCESS']])
  assert.equal(calls[0]?.symbol, company.symbol)
  assert.equal(calls[0]?.startDate, '20260810')
  assert.equal(calls[0]?.endDate, '20260909')
  assert.equal(result.source?.originPublisher, 'Tencent')
  assert.equal(result.source?.retrievalProvider, 'AKShare')
  assert.equal(result.source?.sourceUrl, 'https://gu.qq.com/sh600519/zs')
  assert.equal(result.value?.kind, 'market')
  if (result.value?.kind === 'market') {
    assert.equal(result.value.sourceId, 'akshare-tencent-historical-market-data')
    assert.equal(result.value.currency, 'CNY')
    assert.equal(result.value.adjustmentMethod, 'UNADJUSTED')
    assert.equal(result.value.originPublisher, 'Tencent')
  }
  assert.equal(result.source?.observedAt, '2026-09-08')
  assert.equal(result.source?.observationAvailableAt, '2026-09-08T07:00:00.000Z')
})

test('Historical numeric source stays unavailable without value-version proof after publication', async () => {
  const fixture = clients()
  const resolver = createValuationDataResolver({ ...fixture, company, valuationDate: NOW, historicalAsOf: NOW, now: () => NOW })
  const result = await resolver.resolveOne(requirement('valuation_eps', NOW, true))
  assert.equal(result.status, 'UNAVAILABLE')
  assert.equal(result.quality.pointInTimeSafe, false)
  assert.equal(result.unavailableReason, 'NO_ELIGIBLE_POINT_IN_TIME_DATA')
  assert.ok(result.attempts.some((attempt) => attempt.status === 'POINT_IN_TIME_INVALID'))
  assert.ok(result.attempts.some((attempt) => attempt.diagnostic?.includes('numeric value version')))
})

test('Data-owned EPS policy records primary no-data and successful legacy fallback', async () => {
  const fixture = clients()
  const akshare: AkshareDataClient = { ...fixture.akshare, valuationFinancialIndicators: async () => { fixture.calls.push('valuationFinancialIndicators'); return [] } }
  const resolver = createValuationDataResolver({ akshare, officialDisclosure: fixture.officialDisclosure, company, valuationDate: NOW, now: () => NOW })
  const result = await resolver.resolveOne(requirement('valuation_eps'))
  assert.equal(result.status, 'AVAILABLE')
  assert.deepEqual(result.attempts.map((attempt) => [attempt.sourceId, attempt.status]), [['akshare-valuation-financial-indicators-eps', 'NO_DATA'], ['akshare-legacy-financial-data-eps', 'SUCCESS']])
  assert.equal(result.source?.sourceId, 'akshare-legacy-financial-data-eps')
  assert.equal(result.fallbackReason, 'PRIMARY_NO_DATA')
})

test('Market close cutoff and future annual publication fail closed through DataResolver', async () => {
  const fixture = clients({ publication: '2026-10-01T08:00:00.000Z' })
  const cutoff = '2026-09-09T01:00:00.000Z'
  const resolver = createValuationDataResolver({ ...fixture, company, valuationDate: cutoff, historicalAsOf: cutoff, now: () => NOW })
  const market = await resolver.resolveOne(requirement('valuation_market_price', cutoff))
  assert.equal(market.status, 'AVAILABLE')
  assert.equal(market.source?.observedAt, '2026-09-08')
  const publication = await resolver.resolveOne(requirement('valuation_annual_report_publication', cutoff))
  assert.equal(publication.status, 'UNAVAILABLE')
  assert.ok(publication.attempts.some((attempt) => attempt.status === 'POINT_IN_TIME_INVALID'))
})

test('Comparable discovery and targeted scale resolve as attributable Common evidence', async () => {
  const fixture = clients()
  const resolver = createValuationDataResolver({ ...fixture, company, valuationDate: NOW, now: () => NOW })
  const base = materializePhase2CommonRequirement('valuation_peer_candidate_evidence', { workflowId: 'valuation', ticker: company.symbol, asOf: NOW, required: false })
  const family: ValuationPeerRequirement = { ...base, comparisonFamily: 'growth' }
  const scale: ValuationPeerRequirement = { ...base, id: `${base.id}:scale:000001`, comparisonFamily: 'scale', correlatedTicker: '000001' }
  const resolved = await resolver.resolve([family, scale])
  assert.deepEqual(resolved.items.map((item) => item.acquisition.policyId), ['valuation-peer-candidate-eastmoney', 'valuation-peer-candidate-eastmoney'])
  assert.ok(resolved.items.every((item) => item.status === 'AVAILABLE' && item.source?.originPublisher === 'EastMoney'))
  assert.deepEqual(fixture.calls.filter((item) => item.startsWith('peerComparison:')), ['peerComparison:growth:cohort', 'peerComparison:scale:000001'])
})
