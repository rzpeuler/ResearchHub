import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCompanyValuationSections, extractFilingBasicEps } from '../../workflows/company-deep-research/valuation-sections.ts'
import type { CompanyReadOnlyAcquisition } from '../../workflows/company-deep-research/contracts.ts'
import type { EstimatePoint } from '../../skills/earnings-review/expectations/contracts.ts'
import { sha256 } from '../../plugins/research-acquisition/hash.ts'
import { createEarningsEstimatePointProof } from '../../plugins/research-acquisition/earnings-expectation-point-proof.ts'
import { dailyCloseAvailableAt } from '../../data/point-in-time.ts'

const asOf = '2026-10-26T08:00:00.000Z'
const filing = {
  candidate: { candidateId: 'annual-2025', kind: 'official_disclosure', title: '2025年年度报告', publishedAt: '2026-03-27T00:00:00.000Z' },
  title: '2025年年度报告', content: '重要提示\n基本每股收益 99.00\n六、主要会计数据和财务指标\n2025 年 2024 年 本年比上年增减 2023 年\n基本每股收益（元/股） 3.58 4.61 -22.34% 3.44\n七、股本变动及股东情况\n基本每股收益（旧股） 11.12 基本每股收益（新股） 3.58', contentHash: 'filing-hash', retrievedAt: asOf,
  rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true },
} as any
const quote = {
  candidateId: 'quote-payload', kind: 'market', observation: { priceDate: '2026-10-26', close: 100 },
  sourceId: 'market-source', originPublisher: 'Tencent', retrievalProvider: 'AKShare', sourceUrl: 'https://example.test/quote', retrievedAt: asOf, observationAvailableAt: dailyCloseAvailableAt('2026-10-26'),
}
const expectationSource = (candidateId: string, provider: string, publisher: string, day: number) => ({
  candidate: { candidateId, kind: 'structured_data', title: `FY2026 estimate ${candidateId}`, provider, publishedAt: `2026-10-${day}T00:00:00.000Z` },
  title: candidateId, content: JSON.stringify({ candidateId }), contentHash: `${candidateId}-hash`, retrievedAt: asOf,
  publisher, rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false },
} as any)
const thsSourceCandidates = [expectationSource('ths-1', 'akshare-ths-institution-forecast', '同花顺', 20), expectationSource('ths-2', 'akshare-ths-institution-forecast', '同花顺', 21), expectationSource('ths-3', 'akshare-ths-institution-forecast', '同花顺', 21), expectationSource('ths-future', 'akshare-ths-institution-forecast', '同花顺', 27)]
const emSourceCandidates = [expectationSource('eastmoney-1', 'akshare-eastmoney-research-report', 'EastMoney', 22), expectationSource('eastmoney-2', 'akshare-eastmoney-research-report', 'EastMoney', 21), expectationSource('eastmoney-3', 'akshare-eastmoney-research-report', 'EastMoney', 21)]
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
const sourceRowFor = (estimate: EstimatePoint, provider: string): Record<string, unknown> => provider === 'akshare-ths-institution-forecast'
  ? { '机构名称': estimate.institutionKey.replace(/^ths-org:/u, ''), '报告日期': estimate.publishedAt, [`预测年报每股收益${estimate.fiscalPeriod.slice(0, 4)}预测`]: estimate.value }
  : { '机构': estimate.institutionKey.replace(/^eastmoney-org:/u, ''), '日期': estimate.publishedAt, [`${estimate.fiscalPeriod.slice(0, 4)}-盈利预测-收益`]: estimate.value }
const bindEstimateSources = (candidates: readonly any[], estimates: readonly EstimatePoint[], provider: string) => candidates.map((source) => {
  const estimate = estimates.find((point) => point.sourceCandidateIds.includes(source.candidate.candidateId))!
  const row = sourceRowFor(estimate, provider)
  const content = JSON.stringify({ provider, symbol: '002594', institution: estimate.institutionKey, publishedAt: estimate.publishedAt, row })
  return { ...source, candidate: { ...source.candidate, publishedAt: estimate.publishedAt }, content, contentHash: sha256(content) }
})
const thsSources = bindEstimateSources(thsSourceCandidates, thsEstimates, 'akshare-ths-institution-forecast')
const emSources = bindEstimateSources(emSourceCandidates, emEstimates, 'akshare-eastmoney-research-report')
const proofFor = (estimate: EstimatePoint, provider: 'akshare-ths-institution-forecast' | 'akshare-eastmoney-research-report', sourceCandidateId = estimate.sourceCandidateIds[0]!) => {
  const source = [...thsSources, ...emSources].find((item) => item.candidate.candidateId === sourceCandidateId)!
  const row = sourceRowFor(estimate, provider)
  const providerField = provider === 'akshare-ths-institution-forecast' ? `预测年报每股收益${estimate.fiscalPeriod.slice(0, 4)}预测` : `${estimate.fiscalPeriod.slice(0, 4)}-盈利预测-收益`
  return createEarningsEstimatePointProof({
    estimateId: estimate.estimateId, sourceCandidateId, provider, matchedField: providerField, matchedMetric: estimate.metric,
    matchedValue: estimate.value, matchedUnit: estimate.unit, matchedPeriod: estimate.fiscalPeriod, matchedInstitutionKey: estimate.institutionKey,
    matchedPublishedAt: estimate.publishedAt, observedRow: row, snapshotCapturedAt: source.retrievedAt, snapshotSealedAt: source.retrievedAt,
  })
}
const acquisition = {
  expectationTargetFiscalYear: 2026,
  valuationBasisFiscalYear: 2025,
  valuationItems: [{ metricId: 'valuation_market_price', status: 'AVAILABLE', value: quote, quality: { pointInTimeSafe: true } }],
  earningsExpectationItems: [{ metricId: 'earnings_expectation_eps', status: 'PARTIAL', quality: { pointInTimeSafe: true, valueVersionStatus: 'UNVERIFIED' }, attempts: [{ sourceId: 'ths-institution-forecast', fallbackLevel: 'PRIMARY', status: 'SUCCESS' }, { sourceId: 'eastmoney-individual-research-report', fallbackLevel: 'FALLBACK_1', status: 'SUCCESS' }], value: { kind: 'expectation', projection: { sources: thsSources, estimates: thsEstimates, pointProofs: thsEstimates.filter(estimate => estimate.estimateId !== 'ths-future-eps').map(estimate => proofFor(estimate, 'akshare-ths-institution-forecast')), institutions: [] } }, acquisition: { observations: [{ data: { kind: 'expectation', projection: { sources: emSources, estimates: emEstimates, pointProofs: emEstimates.map(estimate => proofFor(estimate, 'akshare-eastmoney-research-report')), institutions: [] } }, source: { valueVersion: { status: 'UNVERIFIED', reason: 'fixture does not prove historical revisions' } } }] } }],
} as unknown as CompanyReadOnlyAcquisition

test('cutoff sealed content-bound snapshots render a current comparison without claiming historical verification', () => {
  const result = buildCompanyValuationSections({ company: { symbol: '002594', name: '比亚迪' }, asOf, asOfMode: 'CURRENT_VALUE_ONLY', acquisition, sources: [filing] })
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
  assert.match(result.sections[2]!.markdown, /历史数值版本状态为 UNVERIFIED/)
  assert.match(result.sections[2]!.markdown, /^研究缺口：机构预测的历史数值版本未核验/)
  assert.ok(result.diagnostics.includes('VARIANT_EXPECTATION_VALUE_VERSION_UNVERIFIED'))
  assert.match(result.sections[2]!.markdown, /该渠道差仅作来源渠道对照，不构成已通过的独立预期面/)
  assert.match(result.sections[2]!.markdown, /2 家重叠机构/)
  assert.match(result.sections[2]!.markdown, /同花顺 \| 华金证券 \| 2026-FY \| 5 CNY_per_share \| 2026-10-21T00:00:00\.000Z \| \[ths-2@paragraph:1\]/)
  assert.match(result.sections[2]!.markdown, /EastMoney \| 中信证券 \| 2026-FY \| 5\.5 CNY_per_share \| 2026-10-21T00:00:00\.000Z \| \[eastmoney-3@paragraph:1\]/)
  assert.equal((result.sections[2]!.markdown.match(/^\| (?:同花顺|EastMoney) \|/gmu) ?? []).length, 4, 'the published rows reproduce the 2 + 2 retained contributor samples')
  assert.doesNotMatch(result.sections[2]!.markdown, /未来证券|99 CNY_per_share/, 'a forecast published after asOf is not added to the comparison table')
  assert.ok(result.diagnostics.includes('EXPECTATION_POINT_PROOF_COVERAGE:Tonghuashun / 同花顺:eligible=3/3'))
  assert.ok(result.diagnostics.includes('EXPECTATION_POINT_PROOF_COVERAGE:EastMoney:eligible=3/3'))
})

test('expectation surfaces reject missing proof and tampered joined values', () => {
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
    const result = buildCompanyValuationSections({ company: { symbol: '002594', name: '比亚迪' }, asOf, asOfMode: 'CURRENT_VALUE_ONLY', acquisition: altered, sources: [filing] })
    assert.ok(result.diagnostics.some(item => item.includes(`EXPECTATION_POINT_PROOF_REJECTED:Tonghuashun / 同花顺:ths-e1:${scenario.expected}`)), scenario.name)
    assert.ok(result.diagnostics.includes('EXPECTATION_POINT_PROOF_COVERAGE:Tonghuashun / 同花顺:eligible=2/3'), scenario.name)
    assert.doesNotMatch(result.sections[2]!.markdown, /同花顺去重归属样本 3 家|中位数为 4\.00/, scenario.name)
  }
})

test('UNVERIFIED historical status is not promoted by snapshot integrity; current samples remain labeled current-only', () => {
  const unverified = {
    ...acquisition,
    earningsExpectationItems: acquisition.earningsExpectationItems.map(item => ({
      ...item,
      value: item.value?.kind === 'expectation' ? { kind: 'expectation', projection: { ...item.value.projection, pointProofs: (item.value.projection.pointProofs ?? []).map(proof => ({ ...proof, basisStatus: 'UNVERIFIED', valueVersionStatus: 'UNVERIFIED', correctionStatus: 'UNVERIFIED' })) } } : item.value,
      acquisition: { observations: (item.acquisition.observations ?? []).map(observation => ({ ...observation, data: observation.data?.kind === 'expectation' ? { kind: 'expectation', projection: { ...observation.data.projection, pointProofs: (observation.data.projection.pointProofs ?? []).map(proof => ({ ...proof, basisStatus: 'UNVERIFIED', valueVersionStatus: 'UNVERIFIED', correctionStatus: 'UNVERIFIED' })) } } : observation.data })) },
    })),
  } as unknown as CompanyReadOnlyAcquisition
  const result = buildCompanyValuationSections({ company: { symbol: '002594', name: '比亚迪' }, asOf, asOfMode: 'CURRENT_VALUE_ONLY', acquisition: unverified, sources: [filing] })
  assert.ok(result.diagnostics.includes('EXPECTATION_POINT_PROOF_COVERAGE:Tonghuashun / 同花顺:eligible=3/3'))
  assert.ok(result.diagnostics.includes('EXPECTATION_POINT_PROOF_COVERAGE:EastMoney:eligible=3/3'))
  assert.ok(result.diagnostics.includes('VARIANT_EXPECTATION_VALUE_VERSION_UNVERIFIED'))
  assert.match(result.sections[2]!.markdown, /历史数值版本状态为 UNVERIFIED/)
  assert.match(result.sections[2]!.markdown, /^研究缺口：/)
})

test('late retrieval with a forged early seal is rejected by capture-seal-retrieval ordering', () => {
  const baseItem = acquisition.earningsExpectationItems[0]!
  const original = baseItem.value!
  assert.equal(original.kind, 'expectation')
  if (original.kind !== 'expectation') return
  const delayedProjection = {
    ...original.projection,
    sources: original.projection.sources.map(source => source.candidate.candidateId === 'ths-1' ? { ...source, retrievedAt: '2026-10-26T08:00:01.000Z' } : source),
    pointProofs: original.projection.pointProofs?.map(proof => proof.estimateId === 'ths-e1' ? { ...proof, snapshotCapturedAt: '2026-10-26T08:00:01.000Z', snapshotSealedAt: asOf } : proof),
  }
  const delayed = {
    ...acquisition,
    earningsExpectationItems: [{ ...baseItem, value: { kind: 'expectation', projection: delayedProjection }, acquisition: { observations: [] } }],
  } as unknown as CompanyReadOnlyAcquisition
  const result = buildCompanyValuationSections({ company: { symbol: '002594', name: '比亚迪' }, asOf, asOfMode: 'CURRENT_VALUE_ONLY', acquisition: delayed, sources: [filing] })
  assert.ok(result.diagnostics.includes('EXPECTATION_POINT_PROOF_REJECTED:Tonghuashun / 同花顺:ths-e1:SNAPSHOT_TIME_ORDER_INVALID'))
  assert.ok(result.diagnostics.includes('EXPECTATION_POINT_PROOF_COVERAGE:Tonghuashun / 同花顺:eligible=2/3'))
})

test('self-asserted immutable IDs and VERIFIED statuses do not establish a trusted version path', () => {
  const baseItem = acquisition.earningsExpectationItems[0]!
  const original = baseItem.value!
  assert.equal(original.kind, 'expectation')
  if (original.kind !== 'expectation') return
  const delayedProjection = { ...original.projection, pointProofs: original.projection.pointProofs?.map(proof => proof.estimateId === 'ths-e1' ? {
    ...proof, valueVersionId: 'claimed:immutable-version', valueVersionKind: 'IMMUTABLE_DOCUMENT', versionAvailableAt: asOf,
    basisStatus: 'VERIFIED', valueVersionStatus: 'VERIFIED', correctionStatus: 'VERIFIED',
  } : proof) }
  const delayed = {
    ...acquisition,
    earningsExpectationItems: [{ ...baseItem, value: { kind: 'expectation', projection: delayedProjection }, acquisition: { observations: [] } }],
  } as unknown as CompanyReadOnlyAcquisition
  const historical = buildCompanyValuationSections({ company: { symbol: '002594', name: '比亚迪' }, asOf, asOfMode: 'HISTORICAL', acquisition: delayed, sources: [filing] })
  assert.ok(historical.diagnostics.includes('EXPECTATION_POINT_PROOF_REJECTED:Tonghuashun / 同花顺:ths-e1:IMMUTABLE_VERSION_TRUST_UNAVAILABLE'))
  assert.ok(historical.diagnostics.includes('EXPECTATION_POINT_PROOF_COVERAGE:Tonghuashun / 同花顺:eligible=0/3'))
})

test('nonempty hashes alone do not bind a point to its source content', () => {
  const baseItem = acquisition.earningsExpectationItems[0]!
  const original = baseItem.value!
  assert.equal(original.kind, 'expectation')
  if (original.kind !== 'expectation') return
  const projection = { ...original.projection, pointProofs: original.projection.pointProofs?.map(proof => proof.estimateId === 'ths-e1' ? {
    ...proof, valueVersionId: 'arbitrary-id', valueVersionKind: 'IMMUTABLE_DOCUMENT', versionAvailableAt: asOf,
    basisStatus: 'VERIFIED', valueVersionStatus: 'VERIFIED', correctionStatus: 'VERIFIED', observedRowHash: 'not-a-real-row-hash', pointFingerprint: 'nonempty-is-not-proof',
  } : proof) }
  const altered = { ...acquisition, earningsExpectationItems: [{ ...baseItem, value: { kind: 'expectation', projection }, acquisition: { observations: [] } }] } as unknown as CompanyReadOnlyAcquisition
  const result = buildCompanyValuationSections({ company: { symbol: '002594', name: '比亚迪' }, asOf, asOfMode: 'CURRENT_VALUE_ONLY', acquisition: altered, sources: [filing] })
  assert.ok(result.diagnostics.includes('EXPECTATION_POINT_PROOF_REJECTED:Tonghuashun / 同花顺:ths-e1:POINT_NOT_BOUND_TO_SOURCE_CONTENT'))
})

test('source content hash must match the captured raw provider envelope', () => {
  const baseItem = acquisition.earningsExpectationItems[0]!
  const original = baseItem.value!
  assert.equal(original.kind, 'expectation')
  if (original.kind !== 'expectation') return
  const projection = { ...original.projection, sources: original.projection.sources.map(source => source.candidate.candidateId === 'ths-1' ? { ...source, content: `${source.content} ` } : source) }
  const altered = { ...acquisition, earningsExpectationItems: [{ ...baseItem, value: { kind: 'expectation', projection }, acquisition: { observations: [] } }] } as unknown as CompanyReadOnlyAcquisition
  const result = buildCompanyValuationSections({ company: { symbol: '002594', name: '比亚迪' }, asOf, asOfMode: 'CURRENT_VALUE_ONLY', acquisition: altered, sources: [filing] })
  assert.ok(result.diagnostics.includes('EXPECTATION_POINT_PROOF_REJECTED:Tonghuashun / 同花顺:ths-e1:SOURCE_CONTENT_HASH_MISMATCH'))
})

test('retrieval time and publication time cannot substitute for a sealed dynamic snapshot or version availability', () => {
  const baseItem = acquisition.earningsExpectationItems[0]!
  const original = baseItem.value!
  assert.equal(original.kind, 'expectation')
  if (original.kind !== 'expectation') return
  const projection = {
    ...original.projection,
    sources: original.projection.sources.map(source => source.candidate.candidateId === 'ths-1' ? { ...source, retrievedAt: '2026-10-27T00:00:00.000Z' } : source),
    pointProofs: original.projection.pointProofs?.map(proof => proof.estimateId === 'ths-e1' ? {
      ...proof, versionAvailableAt: undefined, valueVersionId: undefined, snapshotSealedAt: undefined,
    } : proof),
  }
  const altered = { ...acquisition, earningsExpectationItems: [{ ...baseItem, value: { kind: 'expectation', projection }, acquisition: { observations: [] } }] } as unknown as CompanyReadOnlyAcquisition
  const result = buildCompanyValuationSections({ company: { symbol: '002594', name: '比亚迪' }, asOf, asOfMode: 'HISTORICAL', acquisition: altered, sources: [filing] })
  assert.ok(result.diagnostics.includes('EXPECTATION_POINT_PROOF_REJECTED:Tonghuashun / 同花顺:ths-e1:IMMUTABLE_VERSION_TRUST_UNAVAILABLE'))
})

test('a cutoff-sealed current snapshot may qualify current-only but cannot be backcast as historical', () => {
  const baseItem = acquisition.earningsExpectationItems[0]!
  const original = baseItem.value!
  assert.equal(original.kind, 'expectation')
  if (original.kind !== 'expectation') return
  const projection = {
    ...original.projection,
    pointProofs: original.projection.pointProofs?.map(proof => proof.estimateId === 'ths-e1' ? {
      ...proof, valueVersionId: undefined, valueVersionKind: undefined, versionAvailableAt: undefined,
      snapshotSealedAt: asOf, valueVersionStatus: 'UNVERIFIED',
    } : proof),
  }
  const snapshot = { ...acquisition, earningsExpectationItems: [{ ...baseItem, value: { kind: 'expectation', projection }, acquisition: { observations: [] } }] } as unknown as CompanyReadOnlyAcquisition
  const current = buildCompanyValuationSections({ company: { symbol: '002594', name: '比亚迪' }, asOf, asOfMode: 'CURRENT_VALUE_ONLY', acquisition: snapshot, sources: [filing] })
  assert.ok(current.diagnostics.includes('EXPECTATION_POINT_PROOF_COVERAGE:Tonghuashun / 同花顺:eligible=3/3'))
  const historical = buildCompanyValuationSections({ company: { symbol: '002594', name: '比亚迪' }, asOf, asOfMode: 'HISTORICAL', acquisition: snapshot, sources: [filing] })
  assert.ok(historical.diagnostics.includes('EXPECTATION_POINT_PROOF_REJECTED:Tonghuashun / 同花顺:ths-e1:IMMUTABLE_VERSION_TRUST_UNAVAILABLE'))
  assert.ok(historical.diagnostics.includes('EXPECTATION_POINT_PROOF_COVERAGE:Tonghuashun / 同花顺:eligible=0/3'))
})

test('historical market quote acquired after the cutoff is rejected at both archived offsets', () => {
  const cases = [
    { asOf: '2026-10-27T20:19:59.628Z', retrievedAt: '2026-10-27T20:20:02.952Z', delayMs: 3324 },
    { asOf: '2026-10-27T20:26:46.347Z', retrievedAt: '2026-10-27T20:26:49.604Z', delayMs: 3257 },
  ]
  for (const scenario of cases) {
    assert.equal(Date.parse(scenario.retrievedAt) - Date.parse(scenario.asOf), scenario.delayMs)
    const lateQuote = { ...quote, observation: { ...quote.observation, priceDate: '2026-10-27' }, observationAvailableAt: dailyCloseAvailableAt('2026-10-27'), retrievedAt: scenario.retrievedAt }
    const lateAcquisition = { ...acquisition, valuationItems: [{ ...acquisition.valuationItems[0]!, value: lateQuote }] } as unknown as CompanyReadOnlyAcquisition
    const result = buildCompanyValuationSections({ company: { symbol: '002594', name: '比亚迪' }, asOf: scenario.asOf, asOfMode: 'HISTORICAL', acquisition: lateAcquisition, sources: [filing] })
    assert.ok(result.diagnostics.includes('VALUATION_MARKET_PRICE_VINTAGE_UNVERIFIED_AT_ASOF'))
    assert.ok(result.diagnostics.includes('VALUATION_MARKET_CLOSE_NOT_PIT_SAFE'))
    assert.match(result.sections[0]!.markdown, /^研究缺口：/)
    assert.ok(!result.reportSourceCandidateIds.some(id => id.startsWith('company-valuation-market-')))
    assert.ok(!result.evidenceSources.some(source => source.candidate.candidateId.startsWith('company-valuation-market-')))
    assert.match(result.sections[1]!.markdown, /valuation_market_price=REJECTED\(VALUATION_MARKET_PRICE_VINTAGE_UNVERIFIED_AT_ASOF/)
    assert.doesNotMatch(result.sections[1]!.markdown, /valuation_market_price=AVAILABLE\(PIT=safe/)
  }
})

test('late current-value quote remains a reference PE with explicit retrieval-time and version caveat', () => {
  const asOf = '2026-10-27T20:19:59.628Z'
  const lateQuote = { ...quote, observation: { ...quote.observation, priceDate: '2026-10-27' }, observationAvailableAt: dailyCloseAvailableAt('2026-10-27'), retrievedAt: '2026-10-27T20:20:02.952Z' }
  const lateAcquisition = { ...acquisition, valuationItems: [{ ...acquisition.valuationItems[0]!, value: lateQuote }] } as unknown as CompanyReadOnlyAcquisition
  const result = buildCompanyValuationSections({ company: { symbol: '002594', name: '比亚迪' }, asOf, asOfMode: 'CURRENT_VALUE_ONLY', acquisition: lateAcquisition, sources: [filing] })
  assert.ok(result.diagnostics.includes('VALUATION_MARKET_PRICE_CURRENT_REFERENCE_ONLY_AFTER_ASOF'))
  assert.match(result.sections[0]!.markdown, /CURRENT_VALUE_ONLY 保留为当前参考 PE/)
  assert.match(result.sections[0]!.markdown, /实际取得时间为 2026-10-27T20:20:02\.952Z（研究起点 asOf=2026-10-27T20:19:59\.628Z）/)
  assert.match(result.sections[0]!.markdown, /不证明同一数值版本在历史 asOf 前已取得或不可变封存/)
  assert.ok(result.sections[0]!.sourceCandidateIds.some(id => id.startsWith('company-valuation-market-')))
  const marketSource = result.evidenceSources.find(source => source.candidate.candidateId.startsWith('company-valuation-market-'))
  assert.deepEqual(marketSource?.rights, { accessScope: 'unknown', providerTermsKnown: false, retentionAllowed: false, aiProcessingAllowed: false, derivativeKnowledgeAllowed: false, redistributionAllowed: false }, 'the synthetic quote source must not invent original publisher terms')
  assert.match(result.sections[1]!.markdown, /valuation_market_price=CURRENT_REFERENCE_ONLY\(retrievedAt=.*historicalVersion=UNVERIFIED\)/)
  assert.match(result.sections[1]!.markdown, /upstreamPIT=safe/)
})

test('current-value mode accepts a close that becomes available after research start but before retrieval', () => {
  const asOf = '2026-10-27T06:59:59.000Z'
  const retrievedAt = '2026-10-27T07:01:00.000Z'
  const lateClose = { ...quote, observation: { ...quote.observation, priceDate: '2026-10-27' }, observationAvailableAt: dailyCloseAvailableAt('2026-10-27'), retrievedAt }
  const lateAcquisition = { ...acquisition, valuationItems: [{ ...acquisition.valuationItems[0]!, value: lateClose }] } as unknown as CompanyReadOnlyAcquisition
  const result = buildCompanyValuationSections({ company: { symbol: '002594', name: '比亚迪' }, asOf, asOfMode: 'CURRENT_VALUE_ONLY', acquisition: lateAcquisition, sources: [filing] })
  assert.match(result.sections[0]!.markdown, /交易日收盘的理论可用时间为 2026-10-27T07:00:00\.000Z/)
  assert.match(result.sections[0]!.markdown, /本次响应实际取得时间为 2026-10-27T07:01:00\.000Z/)
  assert.ok(result.sections[0]!.sourceCandidateIds.some(id => id.startsWith('company-valuation-market-')))
  assert.ok(result.diagnostics.includes('VALUATION_MARKET_PRICE_CURRENT_REFERENCE_ONLY_AFTER_ASOF'))
  assert.ok(!result.diagnostics.includes('VALUATION_MARKET_CLOSE_NOT_PIT_SAFE'))
})

test('historical quote stays blocked when the exact numeric value version is missing', () => {
  const asOf = '2026-10-27T20:19:59.628Z'
  const timelyQuote = { ...quote, observation: { ...quote.observation, priceDate: '2026-10-27' }, observationAvailableAt: dailyCloseAvailableAt('2026-10-27'), retrievedAt: '2026-10-27T20:19:59.627Z' }
  const timelyAcquisition = { ...acquisition, valuationItems: [{ ...acquisition.valuationItems[0]!, value: timelyQuote }] } as unknown as CompanyReadOnlyAcquisition
  const result = buildCompanyValuationSections({ company: { symbol: '002594', name: '比亚迪' }, asOf, asOfMode: 'HISTORICAL', acquisition: timelyAcquisition, sources: [filing] })
  assert.ok(result.diagnostics.includes('VALUATION_MARKET_PRICE_VALUE_VERSION_UNVERIFIED_AT_ASOF'))
  assert.match(result.sections[0]!.markdown, /^研究缺口：/)
  assert.ok(!result.sections[0]!.sourceCandidateIds.some(id => id.startsWith('company-valuation-market-')))
  assert.doesNotMatch(result.sections[1]!.markdown, /valuation_market_price=HISTORICAL_ASOF_QUALIFIED/)
})

test('historical quote can qualify only with a cutoff-available verified source value version', () => {
  const asOf = '2026-10-27T20:19:59.628Z'
  const retrievedAt = '2026-10-27T20:19:59.627Z'
  const timelyQuote = { ...quote, observation: { ...quote.observation, priceDate: '2026-10-27' }, observationAvailableAt: dailyCloseAvailableAt('2026-10-27'), retrievedAt }
  const baseItem = acquisition.valuationItems[0]!
  const timelyItem = {
    ...baseItem,
    value: timelyQuote,
    quality: { ...baseItem.quality, pointInTimeSafe: true, valueVersionStatus: 'VERIFIED' },
    source: { sourceId: 'market-source', fallbackLevel: 'PRIMARY', originPublisher: 'Tencent', retrievalProvider: 'AKShare', retrievedAt, observedAt: '2026-10-27', observationAvailableAt: dailyCloseAvailableAt('2026-10-27'), valueVersion: { status: 'VERIFIED', versionId: 'provider-vintage-2026-10-27', availableAt: '2026-10-27T07:00:00.000Z' }, marketFreshness: { status: 'FRESH' } },
  }
  const timelyAcquisition = { ...acquisition, valuationItems: [timelyItem] } as unknown as CompanyReadOnlyAcquisition
  const result = buildCompanyValuationSections({ company: { symbol: '002594', name: '比亚迪' }, asOf, asOfMode: 'HISTORICAL', acquisition: timelyAcquisition, sources: [filing] })
  assert.match(result.sections[0]!.markdown, /参考 PE/)
  assert.ok(result.sections[0]!.sourceCandidateIds.some(id => id.startsWith('company-valuation-market-')))
  assert.match(result.sections[1]!.markdown, /valuation_market_price=HISTORICAL_ASOF_QUALIFIED\(retrievedAt=.*<=asOf=/)
  assert.ok(!result.diagnostics.includes('VALUATION_MARKET_PRICE_VINTAGE_UNVERIFIED_AT_ASOF'))
  const market = result.evidenceSources.find(source => source.candidate.candidateId.startsWith('company-valuation-market-'))!
  assert.equal((market.candidate.metadata?.dataProvenance as any).pointInTimeStatus, 'within_cutoff')
  assert.equal((JSON.parse(market.content) as any).valueVersion.versionId, 'provider-vintage-2026-10-27')
})

test('a historical quote response retrieved before exchange close availability fails closed', () => {
  const asOf = '2026-10-27T08:00:00.000Z' // 16:00 Beijing
  const preCloseQuote = {
    ...quote,
    observation: { ...quote.observation, priceDate: '2026-10-27' },
    observationAvailableAt: dailyCloseAvailableAt('2026-10-27'), // 15:00 Beijing
    retrievedAt: '2026-10-27T06:30:00.000Z', // 14:30 Beijing
  }
  const preCloseAcquisition = { ...acquisition, valuationItems: [{ ...acquisition.valuationItems[0]!, value: preCloseQuote }] } as unknown as CompanyReadOnlyAcquisition
  const result = buildCompanyValuationSections({ company: { symbol: '002594', name: '比亚迪' }, asOf, asOfMode: 'HISTORICAL', acquisition: preCloseAcquisition, sources: [filing] })
  assert.ok(result.diagnostics.includes('VALUATION_MARKET_CLOSE_NOT_PIT_SAFE'))
  assert.match(result.sections[0]!.markdown, /^研究缺口：/)
  assert.ok(!result.sections[0]!.sourceCandidateIds.some(id => id.startsWith('company-valuation-market-')))
  assert.ok(!result.evidenceSources.some(source => source.candidate.candidateId.startsWith('company-valuation-market-')))
  assert.match(result.sections[1]!.markdown, /valuation_market_price=REJECTED\(MARKET_CLOSE_OR_UPSTREAM_PIT_GATE\)/)
  assert.doesNotMatch(result.sections[1]!.markdown, /HISTORICAL_ASOF_QUALIFIED/)
})

test('historically rejected quote cannot feed conditional PE sensitivity', () => {
  const asOf = '2026-10-27T20:19:59.628Z'
  const lateQuote = { ...quote, observation: { ...quote.observation, priceDate: '2026-10-27' }, observationAvailableAt: dailyCloseAvailableAt('2026-10-27'), retrievedAt: '2026-10-27T20:20:02.952Z' }
  const lateAcquisition = { ...acquisition, valuationItems: [{ ...acquisition.valuationItems[0]!, value: lateQuote }] } as unknown as CompanyReadOnlyAcquisition
  const candidate = scenarioPlan()
  const result = buildCompanyValuationSections({ company: { symbol: '002594', name: '比亚迪' }, asOf, asOfMode: 'HISTORICAL', acquisition: lateAcquisition, sources: [filing, candidate.profitSource], scenarioCandidate: candidate.plan })
  assert.ok(result.diagnostics.includes('CONDITIONAL_REFERENCE_PE_SENSITIVITY_INPUTS_UNQUALIFIED'))
  assert.ok(!result.sections[1]!.sourceCandidateIds.some(id => id.startsWith('company-valuation-market-')))
  assert.doesNotMatch(result.sections[1]!.markdown, /### FY2025 参考 PE 的 FY2026 条件敏感性/)
  assert.match(result.sections[1]!.markdown, /不输出参考 PE 条件敏感性/)
})

test('a price date after the historical cutoff fails closed even when its retrieval time is valid', () => {
  const asOf = '2026-10-27T20:19:59.628Z'
  const futureDateQuote = { ...quote, observation: { ...quote.observation, priceDate: '2026-10-28' }, observationAvailableAt: dailyCloseAvailableAt('2026-10-28'), retrievedAt: asOf }
  const futureDateAcquisition = { ...acquisition, valuationItems: [{ ...acquisition.valuationItems[0]!, value: futureDateQuote }] } as unknown as CompanyReadOnlyAcquisition
  const wrongDate = buildCompanyValuationSections({ company: { symbol: '002594', name: '比亚迪' }, asOf, asOfMode: 'HISTORICAL', acquisition: futureDateAcquisition, sources: [filing] })
  assert.ok(wrongDate.diagnostics.includes('VALUATION_MARKET_CLOSE_NOT_PIT_SAFE'))
  assert.match(wrongDate.sections[0]!.markdown, /^研究缺口：/)
})

test('missing or invalid retrievedAt and invalid asOf fail closed with explicit diagnostics', () => {
  const asOf = '2026-10-27T20:19:59.628Z'
  for (const retrievedAt of ['', undefined, 'not-a-timestamp']) {
    const invalidQuote = { ...quote, retrievedAt }
    const invalidAcquisition = { ...acquisition, valuationItems: [{ ...acquisition.valuationItems[0]!, value: invalidQuote }] } as unknown as CompanyReadOnlyAcquisition
    const result = buildCompanyValuationSections({ company: { symbol: '002594', name: '比亚迪' }, asOf, asOfMode: 'CURRENT_VALUE_ONLY', acquisition: invalidAcquisition, sources: [filing] })
    assert.ok(result.diagnostics.includes('VALUATION_MARKET_PRICE_RETRIEVAL_TIME_INVALID'))
    assert.match(result.sections[0]!.markdown, /^研究缺口：/)
  }

  const invalidAsOf = buildCompanyValuationSections({ company: { symbol: '002594', name: '比亚迪' }, asOf: 'not-a-timestamp', asOfMode: 'CURRENT_VALUE_ONLY', acquisition, sources: [filing] })
  assert.ok(invalidAsOf.diagnostics.includes('VALUATION_MARKET_PRICE_ASOF_INVALID'))
  assert.match(invalidAsOf.sections[0]!.markdown, /^研究缺口：/)
})

test('same-day market close is rejected before the Shanghai session close and remains blocked historically without a verified value version', () => {
  const beforeClose = '2026-10-26T06:59:59.999Z'
  const earlyQuote = { ...quote, observationAvailableAt: dailyCloseAvailableAt('2026-10-26') }
  const earlyAcquisition = {
    ...acquisition,
    valuationItems: [{ ...acquisition.valuationItems[0]!, value: earlyQuote }],
  } as unknown as CompanyReadOnlyAcquisition
  const rejected = buildCompanyValuationSections({ company: { symbol: '002594', name: '比亚迪' }, asOf: beforeClose, acquisition: earlyAcquisition, sources: [filing] })
  assert.ok(rejected.diagnostics.includes('VALUATION_MARKET_CLOSE_NOT_PIT_SAFE'))
  assert.match(rejected.sections[0]!.markdown, /^研究缺口：/)

  const accepted = buildCompanyValuationSections({ company: { symbol: '002594', name: '比亚迪' }, asOf, acquisition, sources: [filing] })
  assert.ok(accepted.diagnostics.includes('VALUATION_MARKET_PRICE_VALUE_VERSION_UNVERIFIED_AT_ASOF'))
  assert.match(accepted.sections[0]!.markdown, /^研究缺口：/)
})

test('point proofs reject source-provider mismatches and missing internal-use rights', () => {
  const baseItem = acquisition.earningsExpectationItems[0]!
  const original = baseItem.value!
  assert.equal(original.kind, 'expectation')
  if (original.kind !== 'expectation') return
  const cases = [
    {
      source: { ...original.projection.sources[0]!, candidate: { ...original.projection.sources[0]!.candidate, provider: 'unexpected-provider' } },
      expected: 'PROOF_BINDING_MISMATCH',
    },
    {
      source: { ...original.projection.sources[0]!, rights: { ...original.projection.sources[0]!.rights, aiProcessingAllowed: false } },
      expected: 'SOURCE_RIGHTS_NOT_QUALIFIED',
    },
  ]
  for (const scenario of cases) {
    const projection = { ...original.projection, sources: [scenario.source, ...original.projection.sources.slice(1)] }
    const changed = {
      ...acquisition,
      earningsExpectationItems: [{ ...baseItem, value: { kind: 'expectation', projection }, acquisition: { observations: [] } }],
    } as unknown as CompanyReadOnlyAcquisition
    const result = buildCompanyValuationSections({ company: { symbol: '002594', name: '比亚迪' }, asOf, acquisition: changed, sources: [filing] })
    assert.ok(result.diagnostics.includes(`EXPECTATION_POINT_PROOF_REJECTED:Tonghuashun / 同花顺:ths-e1:${scenario.expected}`))
  }
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

function scenarioPlan() {
  const profitSourceContent = '2025 年年度报告\n主要会计数据和财务指标\n2025 年 2024 年 本年比上年增减 2023 年\n归属于上市公司股东的净利润（元） 100 90 11.11% 80'
  const profitSource = { ...filing, candidate: { ...filing.candidate, candidateId: 'profit-filing' }, content: profitSourceContent, contentHash: sha256(profitSourceContent), rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true } }
  const refs = { sourceCandidateId: 'profit-filing', location: 'paragraph:4' }
  const rowRates = [-0.1, 0.05, 0.2]
  const columnRates = [-0.2, 0, 0.3]
  const scenarios = (['bear', 'base', 'bull'] as const).map((name, index) => {
    const revenueRate = rowRates[index]!
    const profitRate = columnRates[index]!
    const driver = (id: 'revenue' | 'parent-net-profit', rate: number) => {
      const base = id === 'revenue' ? 1000 : 100
      const metricLabel = id === 'revenue' ? '营业收入' : '归属于上市公司股东的净利润'
      return {
        id, scenarioId: name, targetFiscalYear: 2026, basisDate: asOf,
        valuationMethod: 'OPERATING_BRIDGE_ONLY_NO_FORWARD_VALUATION', financialMetric: id === 'revenue' ? 'revenue' : 'netProfit',
        scope: 'consolidated', historicalBaseValue: base, basePeriod: '2025-12-31', baseSourceRefs: [refs],
        proposedAssumption: { value: rate, unit: 'fraction', originKind: 'RESEARCH_ASSUMPTION' },
        targetMetric: id === 'revenue' ? 'FY2026 revenue' : 'FY2026 parent-attributable net profit',
        peerOrMultipleBasis: 'NOT_APPLIED_NO_QUALIFIED_FORWARD_VALUATION_BASIS', inputDependencies: [refs],
        metricKey: id === 'revenue' ? 'revenue' : 'netProfit', metricLabel, unit: 'CNY', currency: 'CNY', basis: 'YTD',
        historical: [2023, 2024, 2025].map((year, i) => ({ value: base * (i === 0 ? 0.8 : i === 1 ? 0.9 : 1), periodEnd: `${year}-12-31`, publishedAt: '2026-03-27T00:00:00Z', evidence: refs, sourceContentHash: profitSource.contentHash, verificationStatus: 'EXACT_OFFICIAL_ROW_AND_DATA_OBSERVATION_MATCHED' })),
        proposal: { rateOriginKind: 'RESEARCH_ASSUMPTION', rate, targetValue: base * (1 + rate), targetValueOriginKind: 'DERIVED', targetPeriod: '2026-12-31' },
        rationale: 'bounded fixture', assumptionDerivation: 'FY2026 = FY2025 × (1 + rate)', derivation: 'fixture',
        counterEvidenceRefs: [refs], counterevidence: [refs], falsificationTrigger: 'FY2026 actual differs', confidenceLimitations: 'conditional fixture', limitations: 'fixture',
        forecastBridge: { formula: 'last_observation * (1 + rate)' }, sensitivityRange: { lowRate: rate, highRate: rate }, dependencies: [refs],
      }
    }
    return { name, drivers: [driver('revenue', revenueRate), driver('parent-net-profit', profitRate)], impliedParentNetMargin: { value: 1, originKind: 'DERIVED' } }
  })
  const cells = rowRates.map(revenueRate => columnRates.map(parentNetProfitRate => ({ revenueRate, parentNetProfitRate, revenue: 1000 * (1 + revenueRate), parentNetProfit: 100 * (1 + parentNetProfitRate), impliedParentNetMargin: 1, originKind: 'DERIVED' })))
  return {
    plan: { asOf, targetFiscalYear: 2026, scenarios, sensitivityGrid: { targetFiscalYear: 2026, rowRates, columnRates, cells },
      h1CrossCheck: { revenue: { current: 1, prior: 1, yoy: 0, evidence: refs }, parentNetProfit: { current: 1, prior: 1, yoy: 0, evidence: refs } } } as any,
    profitSource,
  }
}

test('renders FY2026 per-share conditional reference-PE sensitivity and recalculates monotonically', () => {
  const candidate = scenarioPlan()
  const quoteItem = acquisition.valuationItems[0]!
  const qualifiedAcquisition = {
    ...acquisition,
    valuationItems: [{
      ...quoteItem,
      source: { sourceId: 'market-source', fallbackLevel: 'PRIMARY', originPublisher: 'Tencent', retrievalProvider: 'AKShare', retrievedAt: quote.retrievedAt, observedAt: quote.observation.priceDate, observationAvailableAt: quote.observationAvailableAt, valueVersion: { status: 'VERIFIED', versionId: 'provider-vintage-2026-10-26', availableAt: '2026-10-26T07:00:00.000Z' }, marketFreshness: { status: 'FRESH' } },
    }],
  } as unknown as CompanyReadOnlyAcquisition
  const result = buildCompanyValuationSections({ company: { symbol: '002594', name: '比亚迪' }, asOf, acquisition: qualifiedAcquisition, sources: [filing, candidate.profitSource], scenarioCandidate: candidate.plan })
  const section = result.sections[1]!
  assert.match(section.markdown, /FY2025 参考 PE 的 FY2026 条件敏感性（非价格预测）/)
  assert.match(section.markdown, /DERIVED 的条件研究敏感性/)
  assert.match(section.markdown, /未复权收盘价 ÷ FY2025 年报基本 EPS/)
  assert.match(section.markdown, /加权平均股数不变/)
  assert.match(section.markdown, /股数变化、融资\/回购/)
  assert.match(section.markdown, /不评价参考 PE 的经济合理性/)
  assert.match(section.markdown, /\| BEAR \| FY2026 归母净利润 80 CNY \| 80 ÷ 100 \| 3\.58 × \(80 ÷ 100\) = 2\.8640 CNY\/share \| 80 CNY\/share \| DERIVED \/ 条件敏感性 \|/)
  assert.match(section.markdown, /\| BASE \| FY2026 归母净利润 100 CNY \| 100 ÷ 100 \| 3\.58 × \(100 ÷ 100\) = 3\.5800 CNY\/share \| 100 CNY\/share \| DERIVED \/ 条件敏感性 \|/)
  assert.match(section.markdown, /\| BULL \| FY2026 归母净利润 130 CNY \| 130 ÷ 100 \| 3\.58 × \(130 ÷ 100\) = 4\.6540 CNY\/share \| 130 CNY\/share \| DERIVED \/ 条件敏感性 \|/)
  assert.equal((section.markdown.split('FY2026 3×3 条件敏感性')[1]?.match(/CNY\/share \| DERIVED \/ 条件敏感性 \|/g) ?? []).length, 9)
  assert.ok(section.sourceCandidateIds.includes('profit-filing'))
  assert.ok(section.sourceCandidateIds.includes('annual-2025'))
  assert.ok(section.sourceCandidateIds.some(id => id.startsWith('company-valuation-market-')))
  assert.ok(!result.diagnostics.includes('CONDITIONAL_REFERENCE_PE_SENSITIVITY_INPUTS_UNQUALIFIED'))
})

test('conditional reference-PE sensitivity fails closed for tampering, missing evidence, and invalid monotonicity', () => {
  const base = scenarioPlan()
  const cases = [
    { label: 'tampered FY2025 profit', plan: { ...base.plan, scenarios: base.plan.scenarios.map((scenario: any, index: number) => index === 0 ? { ...scenario, drivers: scenario.drivers.map((driver: any) => driver.id === 'parent-net-profit' ? { ...driver, historicalBaseValue: 101 } : driver) } : scenario) } },
    { label: 'tampered source hash', plan: { ...base.plan, scenarios: base.plan.scenarios.map((scenario: any, index: number) => index === 0 ? { ...scenario, drivers: scenario.drivers.map((driver: any) => driver.id === 'parent-net-profit' ? { ...driver, historical: driver.historical.map((point: any) => point.periodEnd === '2025-12-31' ? { ...point, sourceContentHash: 'tampered' } : point) } : driver) } : scenario) } },
    { label: 'invalid monotonicity', plan: { ...base.plan, sensitivityGrid: { ...base.plan.sensitivityGrid, columnRates: [0.3, 0, -0.2] } } },
  ]
  for (const item of cases) {
    const result = buildCompanyValuationSections({ company: { symbol: '002594', name: '比亚迪' }, asOf, acquisition, sources: [filing, base.profitSource], scenarioCandidate: item.plan })
    assert.match(result.sections[1]!.markdown, /研究缺口：无法绑定经核验的 asOf 收盘价、FY2025 基本 EPS 与 FY2025 归母净利润情景基数/, item.label)
    assert.ok(result.diagnostics.includes('CONDITIONAL_REFERENCE_PE_SENSITIVITY_INPUTS_UNQUALIFIED'), item.label)
    assert.doesNotMatch(result.sections[1]!.markdown, /\| BEAR \| FY2026 归母净利润/, item.label)
  }
  const missing = buildCompanyValuationSections({ company: { symbol: '002594', name: '比亚迪' }, asOf, acquisition, sources: [filing], scenarioCandidate: base.plan })
  assert.ok(missing.diagnostics.includes('CONDITIONAL_REFERENCE_PE_SENSITIVITY_INPUTS_UNQUALIFIED'))
  assert.doesNotMatch(missing.sections[1]!.markdown, /\| BASE \| FY2026 归母净利润/)
  const restrictedEps = buildCompanyValuationSections({ company: { symbol: '002594', name: '比亚迪' }, asOf, acquisition, sources: [{ ...filing, rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: false } }, base.profitSource], scenarioCandidate: base.plan })
  assert.ok(restrictedEps.diagnostics.includes('CONDITIONAL_REFERENCE_PE_SENSITIVITY_INPUTS_UNQUALIFIED'))
  assert.doesNotMatch(restrictedEps.sections[1]!.markdown, /\| BASE \| FY2026 归母净利润/)
})
