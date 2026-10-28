import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCompanyValuationSections, extractFilingBasicEps } from '../../workflows/company-deep-research/valuation-sections.ts'
import type { CompanyReadOnlyAcquisition } from '../../workflows/company-deep-research/contracts.ts'
import type { EstimatePoint } from '../../skills/earnings-review/expectations/contracts.ts'

const asOf = '2026-10-26T00:00:00.000Z'
const filing = {
  candidate: { candidateId: 'annual-2025', kind: 'official_disclosure', title: '2025年年度报告', publishedAt: '2026-03-27T00:00:00.000Z' },
  title: '2025年年度报告', content: '重要提示\n基本每股收益 99.00\n六、主要会计数据和财务指标\n2025 年 2024 年 本年比上年增减 2023 年\n基本每股收益（元/股） 3.58 4.61 -22.34% 3.44\n七、股本变动及股东情况\n基本每股收益（旧股） 11.12 基本每股收益（新股） 3.58', contentHash: 'filing-hash', retrievedAt: asOf,
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
const thsSources = [expectationSource('ths-1', 'Tonghuashun', '同花顺', 20), expectationSource('ths-2', 'Tonghuashun', '同花顺', 21), expectationSource('ths-3', 'Tonghuashun', '同花顺', 21), expectationSource('ths-future', 'Tonghuashun', '同花顺', 27)]
const emSources = [expectationSource('eastmoney-1', 'EastMoney', 'EastMoney', 22), expectationSource('eastmoney-2', 'EastMoney', 'EastMoney', 21), expectationSource('eastmoney-3', 'EastMoney', 'EastMoney', 21)]
const thsEstimates = [
  { estimateId: 'ths-e1', metric: 'eps', fiscalPeriod: '2026-FY', value: 4, unit: 'CNY_per_share', institutionKey: '东吴证券', publishedAt: '2026-10-20T00:00:00.000Z', sourceCandidateIds: ['ths-1'] },
  { estimateId: 'ths-e2', metric: 'eps', fiscalPeriod: '2026-FY', value: 5, unit: 'CNY_per_share', institutionKey: '华金证券', publishedAt: '2026-10-21T00:00:00.000Z', sourceCandidateIds: ['ths-2'] },
  { estimateId: 'ths-e3', metric: 'eps', fiscalPeriod: '2026-FY', value: 3.8, unit: 'CNY_per_share', institutionKey: '国信证券', publishedAt: '2026-10-21T00:00:00.000Z', sourceCandidateIds: ['ths-3'] },
  { estimateId: 'ths-future-eps', metric: 'eps', fiscalPeriod: '2026-FY', value: 99, unit: 'CNY_per_share', institutionKey: '未来证券', publishedAt: '2026-10-27T00:00:00.000Z', sourceCandidateIds: ['ths-future'] },
]
const emEstimates = [
  { estimateId: 'em-e1', metric: 'eps', fiscalPeriod: '2026-FY', value: 4.2, unit: 'CNY_per_share', institutionKey: '东吴证券', publishedAt: '2026-10-22T00:00:00.000Z', sourceCandidateIds: ['eastmoney-1'] },
  { estimateId: 'em-e2', metric: 'eps', fiscalPeriod: '2026-FY', value: 5.2, unit: 'CNY_per_share', institutionKey: '华金证券', publishedAt: '2026-10-21T00:00:00.000Z', sourceCandidateIds: ['eastmoney-2'] },
  { estimateId: 'em-e3', metric: 'eps', fiscalPeriod: '2026-FY', value: 5.5, unit: 'CNY_per_share', institutionKey: '中信证券', publishedAt: '2026-10-21T00:00:00.000Z', sourceCandidateIds: ['eastmoney-3'] },
]
const proofFor = (estimate: EstimatePoint, provider: 'akshare-ths-institution-forecast' | 'akshare-eastmoney-research-report', sourceCandidateId = estimate.sourceCandidateIds[0]!, statuses = { basisStatus: 'VERIFIED', valueVersionStatus: 'VERIFIED', correctionStatus: 'VERIFIED' }) => ({
  estimateId: estimate.estimateId, sourceCandidateId, provider, matchedField: 'fixture-row', matchedMetric: estimate.metric,
  matchedValue: estimate.value, matchedUnit: estimate.unit, matchedPeriod: estimate.fiscalPeriod, matchedInstitutionKey: estimate.institutionKey,
  matchedPublishedAt: estimate.publishedAt, observedRowHash: `row-${estimate.estimateId}`, pointFingerprint: `point-${estimate.estimateId}`, ...statuses,
})
const acquisition = {
  expectationTargetFiscalYear: 2026,
  valuationBasisFiscalYear: 2025,
  valuationItems: [{ metricId: 'valuation_market_price', status: 'AVAILABLE', value: quote, quality: { pointInTimeSafe: true } }],
  earningsExpectationItems: [{ metricId: 'earnings_expectation_eps', status: 'PARTIAL', quality: { pointInTimeSafe: true, valueVersionStatus: 'UNVERIFIED' }, attempts: [{ sourceId: 'ths-institution-forecast', fallbackLevel: 'PRIMARY', status: 'SUCCESS' }, { sourceId: 'eastmoney-individual-research-report', fallbackLevel: 'FALLBACK_1', status: 'SUCCESS' }], value: { kind: 'expectation', projection: { sources: thsSources, estimates: thsEstimates, pointProofs: thsEstimates.filter(estimate => estimate.estimateId !== 'ths-future-eps').map(estimate => proofFor(estimate, 'akshare-ths-institution-forecast')), institutions: [] } }, acquisition: { observations: [{ data: { kind: 'expectation', projection: { sources: emSources, estimates: emEstimates, pointProofs: emEstimates.map(estimate => proofFor(estimate, 'akshare-eastmoney-research-report')), institutions: [] } }, source: { valueVersion: { status: 'UNVERIFIED', reason: 'fixture does not prove historical revisions' } } }] } }],
} as unknown as CompanyReadOnlyAcquisition

test('valuation builder uses exact verified point proofs and blocks unsupported scenario math', () => {
  const result = buildCompanyValuationSections({ company: { symbol: '002594', name: '比亚迪' }, asOf, acquisition, sources: [filing] })
  assert.deepEqual(result.sections.map(section => section.id), ['valuation', 'bull-base-bear', 'variant-perception'])
  assert.match(result.sections[0]!.markdown, /3\.58 CNY\/share/)
  assert.match(result.sections[0]!.markdown, /PE/)
  assert.match(result.sections[0]!.markdown, /1\/3\.58 = 0\.28 倍/)
  assert.match(result.sections[0]!.markdown, /−100\/3\.58² × 0\.01 = −0\.08 倍/)
  assert.match(result.sections[1]!.markdown, /研究缺口：本轮没有来源支持的目标年经营驱动假设/)
  assert.match(result.sections[1]!.markdown, /earnings_expectation_eps=PARTIAL.*ths-institution-forecast\/PRIMARY:SUCCESS.*eastmoney-individual-research-report\/FALLBACK_1:SUCCESS/)
  assert.doesNotMatch(result.sections[1]!.markdown, /共识EPS极值|固定PE替代/)
  assert.doesNotMatch(result.sections[1]!.markdown, /目标价|相对当前收盘价变化/)
  assert.ok(result.sections[0]!.sourceCandidateIds.includes('annual-2025'))
  assert.ok(result.sections[0]!.sourceCandidateIds.some(id => id.startsWith('company-valuation-market-')))
  assert.deepEqual([...result.reportSourceCandidateIds].sort(), ['annual-2025', 'eastmoney-1', 'eastmoney-3', 'ths-2', 'ths-3', result.sections[0]!.sourceCandidateIds.find(id => id.startsWith('company-valuation-market-'))!].sort())
  assert.equal(result.evidenceSources.length, 5)
  assert.match(result.sections[2]!.markdown, /同花顺去重归属样本 2 家/)
  assert.match(result.sections[2]!.markdown, /EastMoney 去重归属样本 2 家/)
  assert.match(result.sections[2]!.markdown, /同花顺去重归属样本 2 家，中位数为 4\.40/)
  assert.match(result.sections[2]!.markdown, /EastMoney 去重归属样本 2 家，中位数为 4\.85/)
  assert.doesNotMatch(result.sections[2]!.markdown, /4\.8499999999999996|4\.3999999999999995/)
  assert.match(result.sections[2]!.markdown, /历史数值版本状态为 VERIFIED/)
  assert.doesNotMatch(result.sections[2]!.markdown, /^研究缺口：机构预测的历史数值版本未核验/)
  assert.ok(!result.diagnostics.includes('VARIANT_EXPECTATION_VALUE_VERSION_UNVERIFIED'))
  assert.match(result.sections[2]!.markdown, /该渠道差仅作来源渠道对照，不构成已通过的独立预期面/)
  assert.match(result.sections[2]!.markdown, /2 家重叠机构/)
  assert.match(result.sections[2]!.markdown, /同花顺 \| 华金证券 \| 2026-FY \| 5 CNY_per_share \| 2026-10-21T00:00:00\.000Z \| \[ths-2@paragraph:1\]/)
  assert.match(result.sections[2]!.markdown, /EastMoney \| 中信证券 \| 2026-FY \| 5\.5 CNY_per_share \| 2026-10-21T00:00:00\.000Z \| \[eastmoney-3@paragraph:1\]/)
  assert.equal((result.sections[2]!.markdown.match(/^\| (?:同花顺|EastMoney) \|/gmu) ?? []).length, 4, 'the published rows reproduce the 2 + 2 retained contributor samples')
  assert.doesNotMatch(result.sections[2]!.markdown, /未来证券|99 CNY_per_share/, 'a forecast published after asOf is not added to the comparison table')
  assert.ok(result.diagnostics.includes('EXPECTATION_POINT_PROOF_COVERAGE:Tonghuashun / 同花顺:eligible=3/3'))
  assert.ok(result.diagnostics.includes('EXPECTATION_POINT_PROOF_COVERAGE:EastMoney:eligible=3/3'))
})

test('expectation surfaces reject missing proof, tampered joined values, and any UNVERIFIED proof status', () => {
  const baseItem = acquisition.earningsExpectationItems[0]!
  const originalValue = baseItem.value!
  const thsProjection = originalValue.kind === 'expectation' ? originalValue.projection : undefined
  assert.ok(thsProjection)
  const cases = [
    {
      name: 'missing proof',
      projection: { ...thsProjection, pointProofs: thsProjection.pointProofs?.filter(proof => proof.estimateId !== 'ths-e1') },
      expected: 'PROOF_MISSING',
    },
    {
      name: 'tampered joined value',
      projection: { ...thsProjection, estimates: thsProjection.estimates.map(estimate => estimate.estimateId === 'ths-e1' ? { ...estimate, value: estimate.value + 0.1 } : estimate) },
      expected: 'PROOF_BINDING_MISMATCH',
    },
    {
      name: 'unverified correction status',
      projection: { ...thsProjection, pointProofs: thsProjection.pointProofs?.map(proof => proof.estimateId === 'ths-e1' ? { ...proof, correctionStatus: 'UNVERIFIED' } : proof) },
      expected: 'PROOF_NOT_VERIFIED:basis=VERIFIED,valueVersion=VERIFIED,correction=UNVERIFIED',
    },
  ]
  for (const scenario of cases) {
    const altered = {
      ...acquisition,
      earningsExpectationItems: [{
        ...baseItem,
        value: { kind: 'expectation', projection: scenario.projection },
        acquisition: { observations: [] },
      }],
    } as unknown as CompanyReadOnlyAcquisition
    const result = buildCompanyValuationSections({ company: { symbol: '002594', name: '比亚迪' }, asOf, acquisition: altered, sources: [filing] })
    assert.ok(result.diagnostics.some(item => item.includes(`EXPECTATION_POINT_PROOF_REJECTED:Tonghuashun / 同花顺:ths-e1:${scenario.expected}`)), scenario.name)
    assert.ok(result.diagnostics.includes('EXPECTATION_POINT_PROOF_COVERAGE:Tonghuashun / 同花顺:eligible=2/3'), scenario.name)
    assert.doesNotMatch(result.sections[2]!.markdown, /同花顺去重归属样本 3 家|中位数为 4\.00/, scenario.name)
  }
})

test('all currently UNVERIFIED provider proofs are excluded and no channel median is calculated', () => {
  const unverified = {
    ...acquisition,
    earningsExpectationItems: acquisition.earningsExpectationItems.map(item => ({
      ...item,
      value: item.value?.kind === 'expectation' ? { kind: 'expectation', projection: { ...item.value.projection, pointProofs: (item.value.projection.pointProofs ?? []).map(proof => ({ ...proof, basisStatus: 'UNVERIFIED', valueVersionStatus: 'UNVERIFIED', correctionStatus: 'UNVERIFIED' })) } } : item.value,
      acquisition: { observations: (item.acquisition.observations ?? []).map(observation => ({ ...observation, data: observation.data?.kind === 'expectation' ? { kind: 'expectation', projection: { ...observation.data.projection, pointProofs: (observation.data.projection.pointProofs ?? []).map(proof => ({ ...proof, basisStatus: 'UNVERIFIED', valueVersionStatus: 'UNVERIFIED', correctionStatus: 'UNVERIFIED' })) } } : observation.data })) },
    })),
  } as unknown as CompanyReadOnlyAcquisition
  const result = buildCompanyValuationSections({ company: { symbol: '002594', name: '比亚迪' }, asOf, acquisition: unverified, sources: [filing] })
  assert.ok(result.diagnostics.includes('EXPECTATION_POINT_PROOF_COVERAGE:Tonghuashun / 同花顺:eligible=0/3'))
  assert.ok(result.diagnostics.includes('EXPECTATION_POINT_PROOF_COVERAGE:EastMoney:eligible=0/3'))
  assert.ok(result.diagnostics.some(item => item.startsWith('EXPECTATION_POINT_PROOF_REJECTED:Tonghuashun / 同花顺:ths-e1:PROOF_NOT_VERIFIED:')))
  assert.ok(result.diagnostics.includes('VARIANT_PERCEPTION_REQUIRES_TWO_COMPARABLE_UNIQUE_PROVIDER_SURFACES'))
  assert.doesNotMatch(result.sections[2]!.markdown, /中位数|贡献机构|同花顺去重归属样本|EastMoney 去重归属样本/)
  assert.match(result.sections[2]!.markdown, /^研究缺口：/)
})

test('filing EPS selects the unique FY row under the main summary heading and matching year header', () => {
  const selected = extractFilingBasicEps([filing], 2025, asOf)
  assert.equal(selected?.value, 3.58)
  assert.equal(selected?.location, 'paragraph:5')
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

  const noYearHeader = { ...filing, content: '六、主要会计数据和财务指标\n基本每股收益 3.58' }
  assert.equal(extractFilingBasicEps([noYearHeader], 2025, asOf), undefined)
  const wrongYear = { ...filing, content: '六、主要会计数据和财务指标\n2024 年 2023 年\n基本每股收益 3.58' }
  assert.equal(extractFilingBasicEps([wrongYear], 2025, asOf), undefined)
  assert.equal(extractFilingBasicEps([filing, { ...filing, candidate: { ...filing.candidate, candidateId: 'annual-2025-copy' } }], 2025, asOf), undefined)
})
