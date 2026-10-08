import assert from 'node:assert/strict'
import test from 'node:test'
import { PlainTextDocumentParser } from '../../../plugins/document/parsers/text/parser.ts'
import { IndustryOperatingObservationAcquisition, createIndustryOperatingObservation, deterministicIndustryObservationId, parseCheaaHouseholdAirConditionerExport, parseMiitLithiumOperatingObservations, parseNbsAnnualAirConditionerProduction, validateIndustryOperatingObservation } from '../../../plugins/research-acquisition/industry-operating-observations.ts'

const context = (sourceCandidateId: string, extra: Record<string, unknown> = {}) => ({ sourceCandidateId, publishedAt: '2026-09-15T14:43:00.000Z', retrievedAt: '2026-09-23T00:00:00.000Z', originPublisher: 'MIIT', hostPlatform: 'MIIT official web', retrievalProvider: 'ResearchHub direct HTTPS', sourceAuthority: 'S1_OFFICIAL' as const, determinismClass: 'EVIDENCE_BACKED_NUMERIC' as const, metadata: extra })

test('industry observation IDs are deterministic and numeric zero remains valid', () => {
  const input = { metricKey: 'test.metric', observationClass: 'PRODUCTION' as const, value: 0, qualifier: 'EXACT' as const, unit: 'units', originalValue: 0, originalUnit: 'units', periodStart: '2025-01-01T00:00:00.000Z', periodEnd: '2025-12-31T23:59:59.999Z', frequency: 'ANNUAL', aggregation: 'PERIOD' as const, geography: 'China national', productOrSegment: 'fixture', publishedAt: '2026-01-01T00:00:00.000Z', retrievedAt: '2026-01-02T00:00:00.000Z', originPublisher: 'Fixture', hostPlatform: 'Fixture', retrievalProvider: 'Fixture', sourceAuthority: 'S1_OFFICIAL' as const, determinismClass: 'EVIDENCE_BACKED_NUMERIC' as const, sourceCandidateId: 'fixture-0', publicationPit: 'VERIFIED' as const, valueVersionPit: 'UNVERIFIED' as const, metadata: {} }
  const first = createIndustryOperatingObservation(input); const second = createIndustryOperatingObservation(input)
  assert.equal(first.value, 0); assert.equal(first.observationId, second.observationId); assert.equal(first.observationId, deterministicIndustryObservationId(first)); assert.throws(() => validateIndustryOperatingObservation({ ...first, value: Number.NaN }), /finite/); assert.throws(() => validateIndustryOperatingObservation({ ...first, frequency: 'WEEKLY' }), /frequency/)
})

test('NBS parser requires the target row, header, unit, and year', () => {
  const text = '产品名称 | 单位 | 2025年产量\n房间空气调节器 | 万台 | 26,697.5\n'
  const observation = parseNbsAnnualAirConditionerProduction(text, { ...context('nbs-fixture'), originPublisher: 'National Bureau of Statistics', hostPlatform: 'NBS official web/PDF host', sourceAuthority: 'S0_STATUTORY' })
  assert.equal(observation?.metricKey, 'room_air_conditioner.production'); assert.equal(observation?.value, 26697.5); assert.equal(observation?.unit, '万台'); assert.equal(observation?.frequency, 'ANNUAL')
  assert.equal(parseNbsAnnualAirConditionerProduction('other | 万台 | 26697.5\n', { ...context('nbs-drift'), originPublisher: 'National Bureau of Statistics', hostPlatform: 'NBS official web/PDF host', sourceAuthority: 'S0_STATUTORY' }), undefined)
})

test('NBS parser aligns the vertical PDF columns by product ordinal', () => {
  const text = '表 3 2025 年规模以上工业主要产品产量及其增长速度\n产品名称\n家用电冰箱\n房间空气调节器\n单位\n万台\n万台\n产量\n10924 . 4\n26697 . 5\n'
  const observation = parseNbsAnnualAirConditionerProduction(text, { ...context('nbs-vertical'), originPublisher: 'National Bureau of Statistics', hostPlatform: 'NBS official web/PDF host', sourceAuthority: 'S0_STATUTORY' })
  assert.equal(observation?.value, 26697.5); assert.equal(observation?.originalValue, '26697 . 5'); assert.equal(observation?.unit, '万台')
})

test('MIIT parser preserves lower bound and article-period average prices', () => {
  const text = '2026年上半年，锂离子电池产量超过1240 GWh。电池级碳酸锂平均价格为16.3万元/吨，氢氧化锂平均价格为15.3万元/吨。锂电池出口额3370亿元。'
  const observations = parseMiitLithiumOperatingObservations(text, context('miit-fixture'))
  assert.equal(observations.length, 3); const production = observations.find((item) => item.observationClass === 'PRODUCTION')!; assert.equal(production.value, 1240); assert.equal(production.qualifier, 'LOWER_BOUND'); assert.equal(production.unit, 'GWh')
  const price = observations.find((item) => item.metricKey.endsWith('carbonate_average_price'))!; assert.equal(price.value, 16.3); assert.equal(price.unit, '万元/吨'); assert.equal(price.frequency, 'H1'); assert.equal(price.aggregation, 'PERIOD'); assert.equal(observations.some((item) => /export/i.test(item.metricKey)), false)
})

test('MIIT annual parser accepts the official alias and paired price sentence', () => {
  const text = '2024年全国锂离子电池行业运行情况。全国锂电池总产量1170GWh。1－12月电池级碳酸锂和氢氧化锂均价分别为9.0万元/吨和8.7万元/吨。'
  const observations = parseMiitLithiumOperatingObservations(text, { ...context('miit-annual-fixture'), metadata: { period: '2024' } })
  assert.equal(observations.find((item) => item.metricKey === 'lithium_battery.total_output')?.value, 1170)
  assert.equal(observations.find((item) => item.metricKey.endsWith('carbonate_average_price'))?.value, 9)
  assert.equal(observations.find((item) => item.metricKey.endsWith('hydroxide_average_price'))?.value, 8.7)
  const production = observations.find((item) => item.metricKey === 'lithium_battery.total_output')!; assert.equal(production.frequency, 'ANNUAL'); assert.equal(production.qualifier, 'EXACT')
})

test('MIIT H1 paired prices bind each value to its labeled grade', () => {
  const text = '2026年上半年锂离子电池行业运行情况。电池级碳酸锂和氢氧化锂（微粉级）均价分别为16.3万元/吨和15.3万元/吨。'
  const observations = parseMiitLithiumOperatingObservations(text, context('miit-h1-paired-fixture'))
  const carbonate = observations.find((item) => item.metricKey.endsWith('carbonate_average_price'))
  const hydroxide = observations.find((item) => item.metricKey.endsWith('hydroxide_average_price'))
  assert.equal(carbonate?.value, 16.3)
  assert.match(carbonate?.productOrSegment ?? '', /碳酸锂/)
  assert.equal(hydroxide?.value, 15.3)
  assert.match(hydroxide?.productOrSegment ?? '', /微粉级/)
})

test('MIIT price parser preserves a source-reported yuan-per-tonne unit', () => {
  const observations = parseMiitLithiumOperatingObservations('2026年上半年，锂离子电池产量超过1240 GWh。电池级碳酸锂平均价格为163000元/吨。', context('miit-unit-fixture'))
  const price = observations.find((item) => item.metricKey.endsWith('carbonate_average_price'))!
  assert.equal(price.value, 163000); assert.equal(price.unit, '元/吨'); assert.equal(price.originalValue, '163000'); assert.equal(price.originalUnit, '元/吨')
})

test('CHEAA parser reads monthly quantity, not cumulative or money columns', () => {
  const text = '产品名称 | 当月数量（台） | 累计数量（台） | 数量累计同比增长（%） | 当月金额（美元） | 累计金额（美元）\n家用空调器 | 4,039,692 | 66,841,194 | 26.66 | 100 | 200\n'
  const observation = parseCheaaHouseholdAirConditionerExport(text, { ...context('cheaa-fixture'), originPublisher: 'CHEAA', hostPlatform: 'CHEAA official web/PDF host', sourceAuthority: 'S2_PROFESSIONAL', metadata: { period: '2024-09' } }, '2024-09')
  assert.equal(observation?.metricKey, 'air_conditioner.export_volume'); assert.equal(observation?.value, 4039692); assert.equal(observation?.unit, '台'); assert.equal(observation?.metadata.upstreamDataSource, 'GACC')
  assert.equal(parseCheaaHouseholdAirConditionerExport('产品名称 | 累计数量（台）\n家用空调器 | 66,841,194\n', context('cheaa-no-month'), '2024-09'), undefined)
})

test('CHEAA parser aligns the vertical PDF export table and keeps GACC attribution', () => {
  const text = '产品名称 当月数量（台） 累计数量（台） 数量累计同比增长（%） 当月金额（美元） 累计金额（美元） 金额累计同比增长（%）\n家用空调器\n5133858\n61001511\n6.05\n1045560003\n11614988626\n5.39\n'
  const observation = parseCheaaHouseholdAirConditionerExport(text, { ...context('cheaa-vertical'), originPublisher: 'CHEAA', hostPlatform: 'CHEAA official web/PDF host', sourceAuthority: 'S2_PROFESSIONAL', metadata: { period: '2025-07' } }, '2025-07')
  assert.equal(observation?.value, 5133858); assert.equal(observation?.originalValue, '5133858'); assert.equal(observation?.metadata.upstreamDataSource, 'GACC')
})

test('unsupported targets perform no D4 network calls', async () => {
  let calls = 0
  const acquisition = new IndustryOperatingObservationAcquisition({ fetchImpl: async () => { calls++; return new Response('') } })
  for (const name of ['Household appliance industry', 'HVAC', '家电', '锂电材料', 'PCB']) {
    const result = await acquisition.acquire({ target: { name }, asOf: '2026-09-23', now: () => '2026-09-23T00:00:00.000Z' })
    assert.equal(result.status, 'SCOPE_UNSUPPORTED', name); assert.deepEqual(result.observations, []); assert.equal(calls, 0, name)
  }
  for (const name of ['Lithium battery industry', 'lithium-ion battery', '家用空调器', 'room air conditioner']) assert.notEqual((await acquisition.acquire({ target: { name }, asOf: '2026-09-23', now: () => '2026-09-23T00:00:00.000Z' })).status, 'SCOPE_UNSUPPORTED')
})

test('D4 normalized source content is parser text while raw bytes remain retained', async () => {
  const normalized = '2026年上半年，锂离子电池产量超过1240 GWh。电池级碳酸锂平均价格为16.3万元/吨。'
  const raw = '<html>raw source markup</html>'
  const acquisition = new IndustryOperatingObservationAcquisition({ fetchImpl: async () => new Response(raw, { headers: { 'content-type': 'text/html' } }), documentResolver: { parse: async () => ({ normalizedText: normalized } as never) } })
  const result = await acquisition.acquire({ target: { name: 'Lithium battery industry' }, asOf: '2026-09-23', now: () => '2026-09-23T00:00:00.000Z' })
  assert.equal(result.sources.length, 2); assert.ok(result.sources.every((source) => source.content === normalized)); assert.ok(result.sources.every((source) => source.rawBytes?.length === new TextEncoder().encode(raw).length)); assert.ok(result.observations.length >= 2)
})

test('D4 transport observes publication PIT before fetching', async () => {
  let calls = 0
  const acquisition = new IndustryOperatingObservationAcquisition({ fetchImpl: async () => { calls++; return new Response('') }, documentResolver: { parse: async (input) => new PlainTextDocumentParser().parse({ ...input, filename: 'fixture.txt', mediaType: 'text/plain' }) } })
  const result = await acquisition.acquire({ target: { name: 'Lithium battery' }, asOf: '2025-01-01', now: () => '2026-09-23T00:00:00.000Z' })
  assert.equal(calls, 0); assert.equal(result.observations.length, 0); assert.ok(result.diagnostics.some((item) => item.startsWith('PIT_SOURCE_NOT_FETCHED:')))
})
