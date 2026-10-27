import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCompanyValuationSections } from '../../workflows/company-deep-research/valuation-sections.ts'
import type { CompanyReadOnlyAcquisition } from '../../workflows/company-deep-research/contracts.ts'

const asOf = '2026-10-26T00:00:00.000Z'
const filing = {
  candidate: { candidateId: 'annual-2025', kind: 'official_disclosure', title: '2025年年度报告', publishedAt: '2026-03-27T00:00:00.000Z' },
  title: '2025年年度报告', content: '基本每股收益 3.58', contentHash: 'filing-hash', retrievedAt: asOf,
} as any
const quote = {
  candidateId: 'quote-payload', kind: 'market', observation: { priceDate: '2026-10-26', close: 100 },
  sourceId: 'market-source', originPublisher: 'Tencent', retrievalProvider: 'AKShare', sourceUrl: 'https://example.test/quote', retrievedAt: asOf,
}
const expectationSource = (candidateId: string, provider: string, publisher: string, day: number) => ({
  candidate: { candidateId, kind: 'structured_data', title: `FY2026 estimate ${candidateId}`, provider, publishedAt: `2026-10-${day}T00:00:00.000Z` },
  title: candidateId, content: JSON.stringify({ candidateId }), contentHash: `${candidateId}-hash`, retrievedAt: asOf,
  publisher, rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false },
} as any)
const thsSources = [expectationSource('ths-1', 'Tonghuashun', '同花顺', 20), expectationSource('ths-2', 'Tonghuashun', '同花顺', 21), expectationSource('ths-3', 'Tonghuashun', '同花顺', 21)]
const emSources = [expectationSource('eastmoney-1', 'EastMoney', 'EastMoney', 22), expectationSource('eastmoney-2', 'EastMoney', 'EastMoney', 21), expectationSource('eastmoney-3', 'EastMoney', 'EastMoney', 21)]
const thsEstimates = [
  { estimateId: 'ths-e1', metric: 'eps', fiscalPeriod: '2026-FY', value: 4, unit: 'CNY_per_share', institutionKey: '东吴证券', publishedAt: '2026-10-20T00:00:00.000Z', sourceCandidateIds: ['ths-1'] },
  { estimateId: 'ths-e2', metric: 'eps', fiscalPeriod: '2026-FY', value: 5, unit: 'CNY_per_share', institutionKey: '华金证券', publishedAt: '2026-10-21T00:00:00.000Z', sourceCandidateIds: ['ths-2'] },
  { estimateId: 'ths-e3', metric: 'eps', fiscalPeriod: '2026-FY', value: 3.8, unit: 'CNY_per_share', institutionKey: '国信证券', publishedAt: '2026-10-21T00:00:00.000Z', sourceCandidateIds: ['ths-3'] },
]
const emEstimates = [
  { estimateId: 'em-e1', metric: 'eps', fiscalPeriod: '2026-FY', value: 4.2, unit: 'CNY_per_share', institutionKey: '东吴证券', publishedAt: '2026-10-22T00:00:00.000Z', sourceCandidateIds: ['eastmoney-1'] },
  { estimateId: 'em-e2', metric: 'eps', fiscalPeriod: '2026-FY', value: 5.2, unit: 'CNY_per_share', institutionKey: '华金证券', publishedAt: '2026-10-21T00:00:00.000Z', sourceCandidateIds: ['eastmoney-2'] },
  { estimateId: 'em-e3', metric: 'eps', fiscalPeriod: '2026-FY', value: 5.5, unit: 'CNY_per_share', institutionKey: '中信证券', publishedAt: '2026-10-21T00:00:00.000Z', sourceCandidateIds: ['eastmoney-3'] },
]
const acquisition = {
  expectationTargetFiscalYear: 2026,
  valuationBasisFiscalYear: 2025,
  valuationItems: [{ metricId: 'valuation_market_price', status: 'AVAILABLE', value: quote, quality: { pointInTimeSafe: true } }],
  earningsExpectationItems: [{ metricId: 'earnings_expectation_eps', status: 'PARTIAL', value: { kind: 'expectation', projection: { sources: thsSources, estimates: thsEstimates, institutions: [] } }, acquisition: { observations: [{ data: { kind: 'expectation', projection: { sources: emSources, estimates: emEstimates, institutions: [] } }, source: { valueVersion: { status: 'UNVERIFIED', reason: 'fixture does not prove historical revisions' } } }] } }],
} as unknown as CompanyReadOnlyAcquisition

test('valuation builder populates all three workflow-owned sections from exact PIT inputs', () => {
  const result = buildCompanyValuationSections({ company: { symbol: '002594', name: '比亚迪' }, asOf, acquisition, sources: [filing] })
  assert.deepEqual(result.sections.map(section => section.id), ['valuation', 'bull-base-bear', 'variant-perception'])
  assert.match(result.sections[0]!.markdown, /3\.58 CNY\/share/)
  assert.match(result.sections[0]!.markdown, /PE/)
  assert.match(result.sections[1]!.markdown, /Bear\/Base\/Bull/)
  assert.ok(result.sections[0]!.sourceCandidateIds.includes('annual-2025'))
  assert.ok(result.sections[0]!.sourceCandidateIds.some(id => id.startsWith('company-valuation-market-')))
  assert.deepEqual([...result.reportSourceCandidateIds].sort(), ['annual-2025', 'eastmoney-1', 'eastmoney-3', 'ths-2', 'ths-3', result.sections[0]!.sourceCandidateIds.find(id => id.startsWith('company-valuation-market-'))!].sort())
  assert.equal(result.evidenceSources.length, 5)
  assert.match(result.sections[2]!.markdown, /同花顺去重归属样本 2 家/)
  assert.match(result.sections[2]!.markdown, /EastMoney 去重归属样本 2 家/)
  assert.match(result.sections[2]!.markdown, /历史数值版本状态为 UNVERIFIED/)
  assert.match(result.sections[2]!.markdown, /2 家重叠机构/)
})

test('valuation builder fails closed when acquisition is absent or filing EPS is ambiguous', () => {
  const missing = buildCompanyValuationSections({ company: { symbol: '002594', name: '比亚迪' }, asOf, sources: [filing] })
  assert.deepEqual(missing.sections.map(section => section.id), ['valuation', 'bull-base-bear', 'variant-perception'])
  assert.ok(missing.sections.every(section => section.markdown.startsWith('研究缺口：')))
  assert.ok(missing.diagnostics.some(item => item.includes('NOT_CONFIGURED')))

  const ambiguous = buildCompanyValuationSections({ company: { symbol: '002594', name: '比亚迪' }, asOf, acquisition, sources: [filing, { ...filing, candidate: { ...filing.candidate, candidateId: 'annual-2025-copy' } }] })
  assert.match(ambiguous.sections[0]!.markdown, /研究缺口：/)
  assert.match(ambiguous.sections[1]!.markdown, /研究缺口：/)
  assert.ok(ambiguous.diagnostics.includes('VALUATION_FILING_BASIC_EPS_UNAVAILABLE_OR_AMBIGUOUS'))
})
