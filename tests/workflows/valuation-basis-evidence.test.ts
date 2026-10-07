import assert from 'node:assert/strict'
import test from 'node:test'
import { CninfoOfficialDisclosureClient, selectCninfoAnnualReportRecord, type AnnualReportPublicationProof, type OfficialDisclosureRecord } from '../../plugins/research-acquisition/official.ts'
import { type ValuationFinancialRow } from '../../skills/valuation/financials.ts'
import { normalizeValuationFinancialData, normalizeValuationMarketData } from '../../plugins/research-acquisition/valuation-normalization.ts'
import { compareValuationNumericObservations, resolveValuationBasisEvidence } from '../../workflows/valuation/basis-evidence.ts'

const NOW = '2026-09-23T00:00:00.000Z'
const market = { priceDate: '2026-09-22', close: 150 }
const rows: readonly ValuationFinancialRow[] = [{ basisFiscalYear: 2024, reportDate: '2024-12-31', eps: 10, bvps: 20, ebitda: 1, netDebt: 2, shares: 3 }]
const proof: AnnualReportPublicationProof = { issuer: 'Fixture', fiscalYear: 2024, reportTitle: '2024年年度报告', officialPublishedAt: '2025-04-03T08:00:00.000Z', rawPublishedAt: '2025-04-03T08:00:00.000Z', sourceUrl: 'https://static.cninfo.com.cn/finalpage/2025-04-03/fixture.PDF', originPublisher: 'CNINFO', originAuthority: 'S0_STATUTORY', retrievalProvider: 'CNINFO', retrievedAt: NOW }

function resolve(overrides: Partial<Parameters<typeof resolveValuationBasisEvidence>[0]> = {}) {
  return resolveValuationBasisEvidence({ market, financialRows: rows, publication: proof, valuationDate: '2026-09-22', now: NOW, retrievedAt: NOW, marketRetrievedAt: NOW, ...overrides })
}

test('D3 current mode retains EastMoney/CNINFO provenance and closes PE/PB only', () => {
  const result = resolve()
  assert.equal(result.pitStatus, 'CURRENT_VALUE_ONLY')
  assert.equal(result.evidence.market.numericSource.originPublisher, 'EastMoney')
  assert.equal(result.evidence.market.numericSource.retrievalProvider, 'AKShare')
  assert.equal(result.evidence.eps?.numericSource.sourceField, 'EPSJB')
  assert.equal(result.evidence.bvps?.numericSource.sourceField, 'BPS')
  assert.equal(result.evidence.eps?.officialPublication?.originAuthority, 'S0_STATUTORY')
  assert.deepEqual(result.basis?.units, { marketPrice: 'CNY/share', eps: 'CNY/share', bvps: 'CNY/share', ebitda: 'CNY', netDebt: 'CNY', shares: 'shares' })
  assert.equal(result.basis?.ebitda, undefined)
  assert.equal(result.basis?.netDebt, undefined)
  assert.equal(result.basis?.shares, undefined)
})

test('D3 missing publication proof fails closed', () => {
  const result = resolve({ publication: undefined })
  assert.equal(result.basis, undefined)
  assert.equal(result.pitStatus, 'UNAVAILABLE')
  assert.ok(result.diagnostics.includes('VALUATION_BASIS_PUBLICATION_UNAVAILABLE'))
})

test('D3 fixed market cutoff uses Shanghai daily-close availability', () => {
  const rows = [{ date: '2025-04-09', close: 149 }, { date: '2025-04-10', close: 150 }]
  assert.equal(normalizeValuationMarketData(rows, '2025-04-10T09:00:00+08:00', '2025-04-10T09:00:00+08:00').observation?.priceDate, '2025-04-09')
  assert.equal(normalizeValuationMarketData(rows, '2025-04-10T15:00:00+08:00', '2025-04-10T15:00:00+08:00').observation?.priceDate, '2025-04-10')
  assert.equal(normalizeValuationMarketData(rows, '2025-04-10T01:00:00Z', '2025-04-10T01:00:00Z').observation?.priceDate, '2025-04-09')
  assert.equal(normalizeValuationMarketData(rows, '2025-04-10T07:00:00Z', '2025-04-10T07:00:00Z').observation?.priceDate, '2025-04-10')
})

test('D3 fixed cutoff before publication fails closed', () => {
  const result = resolve({ asOf: '2025-03-01T00:00:00.000Z' })
  assert.equal(result.basis, undefined)
  assert.equal(result.pitStatus, 'UNAVAILABLE')
  assert.ok(result.diagnostics.includes('DATA_NOT_PUBLISHED'))
})

test('D3 fixed cutoff after publication remains version-unverified and ineligible', () => {
  const result = resolve({ asOf: '2025-04-10T00:00:00.000Z' })
  assert.equal(result.basis, undefined)
  assert.equal(result.pitStatus, 'PUBLICATION_VERIFIED_VALUE_VERSION_UNVERIFIED')
  assert.ok(result.diagnostics.includes('VALUATION_BASIS_VALUE_VERSION_UNVERIFIED'))
  assert.equal(result.evidence.eps?.pitStatus, 'PUBLICATION_VERIFIED_VALUE_VERSION_UNVERIFIED')
})

test('D3 explicit current calendar date is fixed-asOf mode', () => {
  const result = resolve({ asOf: NOW })
  assert.equal(result.pitStatus, 'PUBLICATION_VERIFIED_VALUE_VERSION_UNVERIFIED')
  assert.equal(result.basis, undefined)
})

test('D3 preserves partial method closure and annual-only selection', () => {
  const normalized = normalizeValuationFinancialData([{ REPORT_DATE: '2025-06-30', EPSJB: 9, BPS: 18 }, { REPORT_DATE: '2024-12-31', EPSJB: 0, BPS: 20 }])
  assert.equal(normalized.rows.length, 1)
  const result = resolve({ financialRows: [{ ...rows[0]!, eps: -1, bvps: 20 }] })
  assert.equal(result.basis?.eps, -1)
  assert.equal(result.basis?.bvps, 20)
})

test('D3 numeric equality is narrow and never averages conflicts', () => {
  assert.equal(compareValuationNumericObservations(1, 1 + 1e-10), 'CONSISTENT')
  assert.equal(compareValuationNumericObservations(1, 1.01), 'SOURCE_CONFLICT')
})

test('D3 CNINFO annual crosswalk uses bounded composite query and excludes non-body reports', async () => {
  const requests: URLSearchParams[] = []
  const client = new CninfoOfficialDisclosureClient({ now: () => NOW, pageSize: 5, fetchImpl: async (input, init) => {
    if (String(input).includes('/topSearch/')) return new Response(JSON.stringify([{ code: '600519', orgId: 'gssh0600519', zwjc: 'Fixture' }]))
    const form = new URLSearchParams(String(init?.body ?? '')); requests.push(form)
    return new Response(JSON.stringify({ hasMore: false, announcements: [
      { announcementTitle: '2024年年度报告摘要', adjunctUrl: '/finalpage/2025-04-03/summary.PDF', announcementTime: '2025-04-03T08:00:00.000Z', secName: 'Fixture' },
      { announcementTitle: '2024年年度报告（英文版）', adjunctUrl: '/finalpage/2025-04-03/en.PDF', announcementTime: '2025-04-03T08:00:00.000Z', secName: 'Fixture' },
      { announcementTitle: '2024年年度报告', adjunctUrl: '/finalpage/2025-04-03/body.PDF', announcementTime: '2025-04-03T08:00:00.000Z', secName: 'Fixture' },
    ] }))
  } })
  const result = await client.resolveAnnualReportPublication({ company: { symbol: '600519', exchange: 'SSE' }, fiscalYear: 2024, asOf: '2025-04-10T00:00:00.000Z' })
  assert.equal(result?.reportTitle, '2024年年度报告')
  assert.equal(result?.originPublisher, 'CNINFO')
  assert.equal(result?.originAuthority, 'S0_STATUTORY')
  assert.equal(requests[0]?.get('stock'), '600519,gssh0600519')
  assert.equal(requests[0]?.get('category'), 'category_ndbg_szsh')
  assert.equal(requests[0]?.get('plate'), 'sh')
  assert.equal(requests[0]?.get('searchkey'), '')
  assert.equal(requests[0]?.get('secid'), '')
  assert.equal(requests[0]?.get('isHLtitle'), 'true')
  assert.equal(requests[0]?.get('pageSize'), '30')
  assert.match(requests[0]?.get('seDate') ?? '', /^2025-01-01~2025-04-10$/)
})

test('D3 CNINFO ambiguous same-time original reports fail closed', () => {
  const records: readonly OfficialDisclosureRecord[] = [
    { title: '2024年年度报告', url: 'https://static.cninfo.com.cn/a.PDF', publishedAt: '2025-04-03T08:00:00.000Z' },
    { title: '2024年年度报告', url: 'https://static.cninfo.com.cn/b.PDF', publishedAt: '2025-04-03T08:00:00.000Z' },
  ]
  assert.throws(() => selectCninfoAnnualReportRecord(records, 2024), /ANNUAL_REPORT_PUBLICATION_AMBIGUOUS/)
})

test('D3 CNINFO accepts Shenzhen plate mapping and annual title variants', async () => {
  const requests: URLSearchParams[] = []
  const client = new CninfoOfficialDisclosureClient({ now: () => NOW, fetchImpl: async (input, init) => {
    if (String(input).includes('/topSearch/')) return new Response(JSON.stringify([{ code: '300750', orgId: 'GD165627', zwjc: 'Fixture' }]))
    requests.push(new URLSearchParams(String(init?.body ?? '')))
    return new Response(JSON.stringify({ hasMore: false, announcements: [{ announcementTitle: '2024年度报告', adjunctUrl: '/finalpage/2025-03-15/body.PDF', announcementTime: '2025-03-15T08:00:00.000Z', secName: 'Fixture' }] }))
  } })
  const result = await client.resolveAnnualReportPublication({ company: { symbol: '300750', exchange: 'SZSE' }, fiscalYear: 2024, asOf: '2025-04-10T00:00:00.000Z' })
  assert.equal(result?.reportTitle, '2024年度报告')
  assert.equal(requests[0]?.get('column'), 'szse')
  assert.equal(requests[0]?.get('plate'), 'szcy')
  assert.equal(requests[0]?.get('stock'), '300750,GD165627')
})
