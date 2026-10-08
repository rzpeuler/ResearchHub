import assert from 'node:assert/strict'
import test from 'node:test'
import { COMMON_DATA_CATALOG } from '../../data/common-catalog.ts'
import { PHASE3_COMMON_SOURCE_POLICIES } from '../../data/company-research-policies.ts'
import { materializePhase3CommonRequirement } from '../../data/requirements.ts'
import { resolveSourcePolicy } from '../../data/source-policy.ts'
import { createCompanyResearchDataResolver, type CompanyResearchEvidenceBatch } from '../../plugins/research-acquisition/company-research-data.ts'
import { GdeltResearchPlugin } from '../../plugins/research-acquisition/gdelt.ts'
import type { AkshareDataClient } from '../../plugins/research-acquisition/akshare.ts'
import type { NormalizedResearchSource, ResearchAcquisitionPlugin, ResearchSourceCandidate } from '../../plugins/research-acquisition/contracts.ts'

const AS_OF = '2026-10-08T12:00:00.000Z'
const company = { symbol: '600000', name: 'Example Company', exchange: 'SSE' }
const context = { workflowId: 'event-research' as const, ticker: company.symbol, asOf: AS_OF, period: { start: '2026-10-01', end: '2026-10-08' } }
const now = () => AS_OF
const rights = { accessScope: 'public' as const, retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false }

function req(metricId = 'company_research_evidence') { return materializePhase3CommonRequirement(metricId, context) }
function candidate(provider: string, id: string, publishedAt?: string, url = `https://example.com/${id}`): ResearchSourceCandidate {
  return { candidateId: id, kind: provider === 'cninfo' ? 'official_disclosure' : 'news', tier: provider === 'cninfo' ? 1 : 3, title: id, provider, url, ...(publishedAt === undefined ? {} : { publishedAt }) }
}
function plugin(provider: string, rows: readonly ResearchSourceCandidate[], options: { failDiscover?: boolean; failFetch?: string; publisher?: string; hash?: string } = {}): ResearchAcquisitionPlugin & { readonly calls: string[] } {
  const calls: string[] = []
  return {
    name: provider, calls,
    async discover(_request, signal) { calls.push('discover'); if (signal?.aborted) throw new Error('WORKFLOW_CANCELLED'); if (options.failDiscover) throw new Error(`${provider} discovery failure`); return rows },
    async fetch(item, signal) { calls.push(`fetch:${item.candidateId}`); if (signal?.aborted) throw new Error('WORKFLOW_CANCELLED'); if (options.failFetch === item.candidateId) throw new Error('fetch failure'); return { candidate: item, retrievedAt: AS_OF, content: `content of ${item.candidateId}`, contentHash: options.hash ?? `hash-${item.candidateId}` } },
    async normalize(fetched): Promise<NormalizedResearchSource> { calls.push(`normalize:${fetched.candidate.candidateId}`); return { candidate: fetched.candidate, retrievedAt: fetched.retrievedAt, title: fetched.candidate.title, content: fetched.content, canonicalUrl: fetched.candidate.url, contentHash: fetched.contentHash!, publisher: options.publisher ?? provider, rights } },
  }
}
function evidence(result: Awaited<ReturnType<ReturnType<typeof createCompanyResearchDataResolver>['resolveOne']>>) {
  return result.acquisition.observations?.flatMap((observation) => observation.data.kind === 'evidence' ? (observation.data as CompanyResearchEvidenceBatch).documents : []) ?? []
}

test('four audited Common identities and exact FIRST_VALID/COLLECT_DIVERSE policy matching', () => {
  const ids = ['company_basic_profile', 'company_financial_history', 'company_market_history', 'company_research_evidence']
  assert.deepEqual(COMMON_DATA_CATALOG.filter((entry) => ids.includes(entry.metricId)).map((entry) => entry.metricId), ids)
  for (const workflowId of ['company-deep-research', 'event-research', 'thesis-red-team'] as const) {
    const requirement = materializePhase3CommonRequirement('company_research_evidence', { ...context, workflowId })
    const matched = resolveSourcePolicy(requirement, PHASE3_COMMON_SOURCE_POLICIES)
    assert.equal(matched.status, 'MATCHED')
    assert.equal(matched.policy?.selectionMode, 'COLLECT_DIVERSE')
    assert.deepEqual(matched.policy?.candidates.map((entry) => entry.originAuthority), ['S0_STATUTORY', 'S3_AGGREGATOR'])
  }
  for (const metricId of ids.slice(0, 3)) {
    const requirement = materializePhase3CommonRequirement(metricId, { ...context, workflowId: 'company-deep-research' })
    const matched = resolveSourcePolicy(requirement, PHASE3_COMMON_SOURCE_POLICIES)
    assert.equal(matched.policy?.selectionMode, 'FIRST_VALID')
    assert.equal(matched.policy?.candidates.length, 1)
  }
  assert.throws(() => materializePhase3CommonRequirement('company_basic_profile', context), /COMMON_DATA_CONSUMER_MISMATCH/)
  assert.throws(() => materializePhase3CommonRequirement('company_market_history', { ...context, workflowId: 'company-deep-research', period: undefined }), /COMMON_DATA_MARKET_PERIOD_REQUIRED/)
})

test('COLLECT_DIVERSE attempts CNINFO and GDELT and retains document-level authority and publisher', async () => {
  const official = plugin('cninfo', [candidate('cninfo', 'official', '2026-10-07T12:00:00.000Z')])
  const news = plugin('gdelt', [candidate('gdelt', 'article', '2026-10-08T10:00:00.000Z')], { publisher: 'gdelt' })
  const item = await createCompanyResearchDataResolver({ company, officialDisclosure: official, gdelt: news, now }).resolveOne(req())
  assert.equal(item.status, 'AVAILABLE')
  assert.deepEqual(item.attempts.map((attempt) => [attempt.sourceId, attempt.status]), [['cninfo-company-research-evidence', 'SUCCESS'], ['gdelt-company-research-evidence', 'SUCCESS']])
  assert.deepEqual(official.calls, ['discover', 'fetch:official', 'normalize:official'])
  assert.deepEqual(news.calls, ['discover', 'fetch:article', 'normalize:article'])
  const docs = evidence(item)
  assert.equal(docs.length, 2)
  assert.equal(docs[0]?.provenance.originAuthority, 'S0_STATUTORY')
  assert.equal(docs[0]?.provenance.originPublisher, 'CNINFO')
  assert.equal(docs[0]?.provenance.retrievalProvider, 'CNINFO')
  assert.equal(docs[1]?.provenance.originAuthority, 'S3_AGGREGATOR')
  assert.equal(docs[1]?.provenance.originPublisher, undefined)
  assert.equal(docs[1]?.provenance.retrievalProvider, 'GDELT')
  assert.equal(docs[1]?.provenance.contentHash, 'hash-article')
  assert.equal(docs.every((document) => document.pointInTimeSafe), true)
})

test('one provider failure and partial fetch do not hide another source outcome', async () => {
  const official = plugin('cninfo', [], { failDiscover: true })
  const news = plugin('gdelt', [candidate('gdelt', 'good', '2026-10-07T12:00:00.000Z'), candidate('gdelt', 'bad', '2026-10-07T12:00:00.000Z')], { failFetch: 'bad' })
  const item = await createCompanyResearchDataResolver({ company, officialDisclosure: official, gdelt: news, now }).resolveOne(req())
  assert.equal(item.status, 'PARTIAL')
  assert.equal(item.attempts.length, 2)
  assert.equal(item.attempts[0]?.status, 'SOURCE_ERROR')
  assert.equal(item.attempts[1]?.status, 'SUCCESS')
  assert.equal(evidence(item).length, 1)
  const batch = item.acquisition.observations?.[0]?.data
  assert.equal(batch?.kind, 'evidence')
  if (batch?.kind === 'evidence') assert.equal(batch.outcome.failed, 1)
})

test('strict date window rejects future, malformed, and outside evidence; unknown date stays context only', async () => {
  const official = plugin('cninfo', [
    candidate('cninfo', 'future', '2026-10-09T00:00:00.000Z'),
    candidate('cninfo', 'invalid', '2026-02-30'),
    candidate('cninfo', 'outside', '2026-09-30T23:59:59.000Z'),
    candidate('cninfo', 'inside', '2026-10-08T11:59:59.000Z'),
    candidate('cninfo', 'end-day', '2026-10-08T12:00:00.000Z'),
    candidate('cninfo', 'unknown'),
  ])
  const item = await createCompanyResearchDataResolver({ company, officialDisclosure: official, gdelt: plugin('gdelt', []), now }).resolveOne(req())
  assert.equal(item.status, 'PARTIAL')
  assert.deepEqual(evidence(item).map((document) => [document.record.candidate.candidateId, document.dateStatus, document.pointInTimeSafe]), [['inside', 'QUALIFIED', true], ['end-day', 'QUALIFIED', true], ['unknown', 'UNKNOWN', false]])
  assert.equal(item.quality.pointInTimeSafe, false)
  assert.deepEqual(official.calls.filter((call) => call.startsWith('fetch:')), ['fetch:inside', 'fetch:end-day', 'fetch:unknown'])
  const batch = item.acquisition.observations?.[0]?.data
  if (batch?.kind === 'evidence') assert.equal(batch.outcome.rejected, 3)
})

test('GDELT first-seen timestamp preserves same-day cutoff precision', async () => {
  const gdelt = new GdeltResearchPlugin({ fetchImpl: async () => new Response(JSON.stringify({ articles: [
    { url: 'https://example.com/before', title: 'Before cutoff', seendate: '20261008T110000Z' },
    { url: 'https://example.com/after', title: 'After cutoff', seendate: '20261008T130000Z' },
    { url: 'https://example.com/invalid', title: 'Invalid time', seendate: '20261008T250000Z' },
  ] }), { status: 200 }) })
  const discovered = await gdelt.discover({ company, asOf: AS_OF })
  assert.deepEqual(discovered.map((entry) => entry.publishedAt), ['2026-10-08T11:00:00.000Z', '2026-10-08T13:00:00.000Z', undefined])
  const news = plugin('gdelt', discovered)
  const item = await createCompanyResearchDataResolver({ company, officialDisclosure: plugin('cninfo', []), gdelt: news, now }).resolveOne(req())
  assert.deepEqual(news.calls, ['discover', `fetch:${discovered[0]?.candidateId}`, `normalize:${discovered[0]?.candidateId}`])
  assert.equal(evidence(item).length, 1)
  assert.equal(evidence(item)[0]?.pointInTimeSafe, true)
  assert.equal(evidence(item)[0]?.provenance.publishedAt, '2026-10-08T11:00:00.000Z')
  const outcome = item.acquisition.observations?.find((observation) => observation.source.retrievalProvider === 'GDELT')?.data
  if (outcome?.kind === 'evidence') assert.equal(outcome.outcome.rejected, 2)
})

test('generic canonical URL and content hash dedup retain first statutory document', async () => {
  const official = plugin('cninfo', [candidate('cninfo', 'official', '2026-10-07T00:00:00.000Z', 'https://EXAMPLE.com/a/?utm_source=x')])
  const news = plugin('gdelt', [candidate('gdelt', 'same-url', '2026-10-07T00:00:00.000Z', 'https://example.com/a'), candidate('gdelt', 'other', '2026-10-07T00:00:00.000Z', 'https://example.com/other')])
  const item = await createCompanyResearchDataResolver({ company, officialDisclosure: official, gdelt: news, now }).resolveOne(req())
  assert.equal(item.status, 'PARTIAL')
  assert.deepEqual(evidence(item).map((document) => document.record.candidate.candidateId), ['official', 'other'])
  const gdelt = item.acquisition.observations?.find((observation) => observation.source.retrievalProvider === 'GDELT')?.data
  if (gdelt?.kind === 'evidence') assert.equal(gdelt.outcome.deduplicated, 1)
})

test('hash dedup works across distinct URLs and explicit original publisher stays separate from GDELT', async () => {
  const official = plugin('cninfo', [candidate('cninfo', 'official', '2026-10-07T00:00:00.000Z')], { hash: 'same-content' })
  const article = { ...candidate('gdelt', 'article', '2026-10-07T00:00:00.000Z'), metadata: { originalPublisher: 'Example News' } }
  const news = plugin('gdelt', [article, candidate('gdelt', 'duplicate-hash', '2026-10-07T00:00:00.000Z', 'https://different.example/b')], { hash: 'same-content' })
  const item = await createCompanyResearchDataResolver({ company, officialDisclosure: official, gdelt: news, now }).resolveOne(req())
  assert.equal(evidence(item).length, 1)
  assert.equal(item.attempts.length, 2)
  const gdeltBatch = item.acquisition.observations?.find((observation) => observation.source.retrievalProvider === 'GDELT')?.data
  if (gdeltBatch?.kind === 'evidence') assert.equal(gdeltBatch.outcome.deduplicated, 2)
  const standalone = await createCompanyResearchDataResolver({ company, officialDisclosure: plugin('cninfo', []), gdelt: plugin('gdelt', [article]), now }).resolveOne(req())
  assert.equal(evidence(standalone)[0]?.provenance.originPublisher, 'Example News')
  assert.equal(evidence(standalone)[0]?.provenance.retrievalProvider, 'GDELT')
  assert.equal(evidence(standalone)[0]?.provenance.originAuthority, 'S3_AGGREGATOR')
})

test('zero-document provider observation remains available for outcome translation', async () => {
  const official = plugin('cninfo', [candidate('cninfo', 'future', '2026-10-09T00:00:00.000Z')])
  const item = await createCompanyResearchDataResolver({ company, officialDisclosure: official, gdelt: plugin('gdelt', []), now }).resolveOne(req())
  assert.equal(item.status, 'UNAVAILABLE')
  assert.equal(item.unavailableReason, 'NO_ELIGIBLE_POINT_IN_TIME_DATA')
  assert.equal(item.acquisition.observations?.length, 2)
  const outcome = item.acquisition.observations?.[0]?.data
  if (outcome?.kind === 'evidence') assert.deepEqual([outcome.outcome.transportSucceeded, outcome.outcome.fetchSucceeded, outcome.outcome.discovered, outcome.outcome.rejected, outcome.documents.length], [true, false, 1, 1, 0])
  const emptyRoute = item.acquisition.observations?.[1]?.data
  if (emptyRoute?.kind === 'evidence') assert.deepEqual([emptyRoute.outcome.transportSucceeded, emptyRoute.outcome.fetchSucceeded, emptyRoute.outcome.discovered], [true, false, 0])
})

test('fetch telemetry distinguishes transport, empty content, and thrown fetch', async () => {
  const empty: ResearchAcquisitionPlugin = { ...plugin('cninfo', []), async discover() { return [candidate('cninfo', 'empty', '2026-10-07T00:00:00.000Z')] }, async fetch(item) { return { candidate: item, retrievedAt: AS_OF, content: '' } } }
  const failed = plugin('gdelt', [candidate('gdelt', 'failed', '2026-10-07T00:00:00.000Z')], { failFetch: 'failed' })
  const item = await createCompanyResearchDataResolver({ company, officialDisclosure: empty, gdelt: failed, now }).resolveOne(req())
  assert.equal(item.status, 'UNAVAILABLE')
  const outcomes = item.acquisition.observations?.map((observation) => observation.data.kind === 'evidence' ? observation.data.outcome : undefined)
  assert.deepEqual(outcomes?.map((outcome) => [outcome?.transportSucceeded, outcome?.fetchSucceeded, outcome?.empty, outcome?.failed]), [[true, true, 1, 0], [true, false, 0, 1]])
})

test('discovery hook runs once per provider before fetch', async () => {
  const official = plugin('cninfo', [candidate('cninfo', 'official', '2026-10-07T00:00:00.000Z')])
  const news = plugin('gdelt', [candidate('gdelt', 'article', '2026-10-07T00:00:00.000Z')])
  const events: string[] = []
  await createCompanyResearchDataResolver({ company, officialDisclosure: official, gdelt: news, now, onCandidatesDiscovered: ({ provider, candidates, requirement }) => {
    events.push(`${provider}:${candidates.length}:${requirement.metricId}`)
    const calls = provider === 'CNINFO' ? official.calls : news.calls
    assert.deepEqual(calls, ['discover'])
  } }).resolveOne(req())
  assert.deepEqual(events, ['CNINFO:1:company_research_evidence', 'GDELT:1:company_research_evidence'])
})

test('discovery hook can reject unsafe candidates before fetch without losing provider outcome', async () => {
  const official = plugin('cninfo', [candidate('cninfo', 'safe', '2026-10-07T00:00:00.000Z'), candidate('cninfo', 'unsafe', '2026-10-07T00:00:00.000Z', 'http://127.0.0.1/private')])
  const item = await createCompanyResearchDataResolver({ company, officialDisclosure: official, gdelt: plugin('gdelt', []), now, onCandidatesDiscovered: ({ candidates }) => candidates.filter((entry) => entry.candidateId !== 'unsafe') }).resolveOne(req())
  assert.deepEqual(official.calls, ['discover', 'fetch:safe', 'normalize:safe'])
  const batch = item.acquisition.observations?.[0]?.data
  if (batch?.kind === 'evidence') assert.deepEqual([batch.outcome.discovered, batch.outcome.rejected, batch.documents.length], [2, 1, 1])
})

test('AKShare structured operations retain numeric zero, reject empty payloads, and do not assert historical version proof', async () => {
  const calls: string[] = []
  const akshare: AkshareDataClient = {
    async companyBasic() { calls.push('basic'); return [{ item: 'employees', value: 0 }] },
    async financialData() { calls.push('financial'); return [{ report_date: '2025-12-31', publication_date: '2026-03-01T00:00:00.000Z', basic_eps: 0, operating_revenue: 10 }] },
    async historicalMarketData() { calls.push('market'); return [{ date: '2026-10-07', close: 0 }, { date: '2026-10-09', close: 5 }] },
  }
  const resolver = createCompanyResearchDataResolver({ company, akshare, now })
  const forCompany = (metricId: string) => materializePhase3CommonRequirement(metricId, { ...context, workflowId: 'company-deep-research' })
  const [profile, financial, market] = await Promise.all([resolver.resolveOne(forCompany('company_basic_profile')), resolver.resolveOne(forCompany('company_financial_history')), resolver.resolveOne(forCompany('company_market_history'))])
  assert.deepEqual(calls.sort(), ['basic', 'financial', 'market'])
  assert.equal(profile.value?.kind, 'profile')
  if (profile.value?.kind === 'profile') assert.deepEqual(profile.value.fields, [{ name: 'employees', value: 0 }])
  if (financial.value?.kind === 'financial') { assert.equal(financial.value.rows[0]?.metrics.basicEps, 0); assert.equal(financial.value.rows[0]?.pointInTimeSafe, false) }
  if (market.value?.kind === 'market') { assert.deepEqual(market.value.rows.map((row) => row.observedAt), ['2026-10-07']); assert.equal(market.value.rows[0]?.close, 0) }
  assert.equal(financial.quality.pointInTimeSafe, false)
  assert.equal(market.quality.pointInTimeSafe, false)
  const empty = createCompanyResearchDataResolver({ company, akshare: { ...akshare, companyBasic: async () => [] }, now })
  assert.equal((await empty.resolveOne(forCompany('company_basic_profile'))).attempts[0]?.status, 'NO_DATA')
})

test('AKShare named profile rows with missing values cannot fabricate fields from item keys', async () => {
  const akshare: AkshareDataClient = {
    async companyBasic() { return [{ item: 'missing', value: undefined }, { item: 'also-missing' }, { item: 'employees', value: 0 }] },
    async financialData() { return [] },
    async historicalMarketData() { return [] },
  }
  const profileRequirement = materializePhase3CommonRequirement('company_basic_profile', { ...context, workflowId: 'company-deep-research' })
  const item = await createCompanyResearchDataResolver({ company, akshare, now }).resolveOne(profileRequirement)
  assert.equal(item.status, 'AVAILABLE')
  if (item.value?.kind === 'profile') assert.deepEqual(item.value.fields, [{ name: 'employees', value: 0 }])
  const allMissing = createCompanyResearchDataResolver({ company, akshare: { ...akshare, companyBasic: async () => [{ item: 'missing', value: undefined }] }, now })
  const unavailable = await allMissing.resolveOne(profileRequirement)
  assert.equal(unavailable.status, 'UNAVAILABLE')
  assert.equal(unavailable.attempts[0]?.status, 'NO_DATA')
})

test('cancellation stops source attempts before they continue', async () => {
  const controller = new AbortController()
  const official = plugin('cninfo', [candidate('cninfo', 'one', '2026-10-07T00:00:00.000Z')])
  const news = plugin('gdelt', [candidate('gdelt', 'two', '2026-10-07T00:00:00.000Z')])
  controller.abort()
  await assert.rejects(() => createCompanyResearchDataResolver({ company, officialDisclosure: official, gdelt: news, now, signal: controller.signal }).resolveOne(req()), /WORKFLOW_CANCELLED/)
  assert.deepEqual(official.calls, [])
  assert.deepEqual(news.calls, [])
})
