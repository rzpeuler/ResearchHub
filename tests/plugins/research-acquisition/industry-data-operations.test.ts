import assert from 'node:assert/strict'
import test from 'node:test'
import { INDUSTRY_RESEARCH_EVIDENCE_POLICY } from '../../../data/industry-policies.ts'
import type { ResearchAcquisitionPlugin } from '../../../plugins/research-acquisition/contracts.ts'
import { parseMiitLithiumOperatingObservations } from '../../../plugins/research-acquisition/industry-operating-observations.ts'

test('Industry operation contract binds only named policy operations to their exact metric requirements', async () => {
  const operations = await import('../../../plugins/research-acquisition/industry-data-operations.ts').catch(() => undefined)
  assert.ok(operations, 'bounded Industry operation contract must be available')
  assert.deepEqual(operations!.INDUSTRY_DATA_OPERATION_IDS, [
    'industry.evidence.miit', 'industry.evidence.govcn', 'industry.evidence.cpca', 'industry.evidence.eastmoney-board',
    'industry.metric.nbs.room-air-conditioner-production', 'industry.metric.cheaa.air-conditioner-export-volume',
    'industry.metric.miit.lithium-total-output', 'industry.metric.miit.lithium-carbonate-average-price',
    'industry.metric.miit.lithium-hydroxide-average-price',
  ])
  assert.equal(operations!.industryOperationSupports('industry.metric.miit.lithium-total-output', {
    metricId: 'industry:lithium_battery:lithium-battery-total-output', dataKind: 'timeseries',
  }), true)
  assert.equal(operations!.industryOperationSupports('industry.metric.miit.lithium-total-output', {
    metricId: 'industry:lithium_battery:lithium-carbonate-period-average-price', dataKind: 'timeseries',
  }), false)
  assert.equal(operations!.industryOperationSupports('industry.evidence.miit', {
    metricId: 'industry_research_evidence', dataKind: 'evidence',
  }), true)
  assert.equal(operations!.industryOperationSupports('industry.evidence.miit', {
    metricId: 'industry_research_evidence', dataKind: 'timeseries',
  }), false)
})

test('Industry evidence operation keeps origin publisher, host platform, retriever, and rights distinct', async () => {
  const { createIndustryEvidenceOperation } = await import('../../../plugins/research-acquisition/industry-data-operations.ts')
  let receivedTerms: readonly string[] = []
  const plugin: ResearchAcquisitionPlugin = {
    name: 'miit-plugin-adapter',
    discover: async (request) => {
      if ('industry' in request && request.industry) receivedTerms = request.industry.searchTerms
      return [{ candidateId: 'article-1', kind: 'official_disclosure', tier: 1, title: 'Official article', provider: 'miit-route', url: 'https://www.miit.gov.cn/article', publishedAt: '2026-09-15' }]
    },
    fetch: async (candidate) => ({ candidate, retrievedAt: '2026-10-01T00:00:00.000Z', content: 'Official article text', contentHash: 'a'.repeat(64) }),
    normalize: async (fetched) => ({
      candidate: fetched.candidate, retrievedAt: fetched.retrievedAt, title: fetched.candidate.title, content: fetched.content,
      canonicalUrl: fetched.candidate.url, contentHash: fetched.contentHash!, publisher: 'Ministry of Industry and Information Technology',
      rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false },
    }),
  }
  const operation = createIndustryEvidenceOperation('industry.evidence.miit', plugin)
  const wrongBinding = await operation({
    requirement: {
      id: 'wrong-operation', consumer: { workflow: 'industry-deep-research' }, subject: {}, dataKind: 'evidence', metricId: 'industry_research_evidence',
      asOf: '2026-10-01T00:00:00.000Z', determinismClass: 'SEMANTIC_QUALITATIVE', llmWebFallback: 'FORBIDDEN',
      industryEvidenceQueryContext: { displayTarget: 'Unknown domain', searchTerms: ['capacity'], purpose: 'Find sources' },
    },
    candidate: { ...INDUSTRY_RESEARCH_EVIDENCE_POLICY.candidates[0]!, operationId: 'industry.evidence.govcn' }, now: () => '2026-10-01T00:00:00.000Z',
  })
  assert.equal(wrongBinding.status, 'UNSUPPORTED')
  const result = await operation({
    requirement: {
      id: 'industry-evidence', consumer: { workflow: 'industry-deep-research' }, subject: { industryId: 'unknown-domain' },
      dataKind: 'evidence', metricId: 'industry_research_evidence', asOf: '2026-10-01T00:00:00.000Z', analysisAsOf: '2026-10-01T00:00:00.000Z',
      determinismClass: 'SEMANTIC_QUALITATIVE', llmWebFallback: 'FORBIDDEN',
      industryEvidenceQueryContext: { displayTarget: 'Unknown domain', searchTerms: ['capacity', 'orders'], purpose: 'Find public source documents' },
    },
    candidate: INDUSTRY_RESEARCH_EVIDENCE_POLICY.candidates[0]!, now: () => '2026-10-01T00:00:00.000Z',
  })
  assert.equal(result.status, 'SUCCESS')
  assert.deepEqual(receivedTerms, ['capacity', 'orders'])
  assert.equal(result.source?.retrievalProvider, 'miit-plugin-adapter')
  if (result.status === 'SUCCESS') {
    const document = result.data.documents[0]!
    assert.equal(document.originPublisher, 'Ministry of Industry and Information Technology')
    assert.equal(document.hostPlatform, 'www.miit.gov.cn')
    assert.equal(document.retrievalProvider, 'miit-route')
    assert.equal(document.rights.retentionAllowed, true)
    assert.equal(document.sourceIdentity, 'url:https://www.miit.gov.cn/article')
  }
})

test('Industry metric operation preserves MIIT raw unit, YTD period, source identity, and hydroxide grade', async () => {
  const { createIndustryMetricOperation, normalizeIndustryObservationCandidate } = await import('../../../plugins/research-acquisition/industry-data-operations.ts')
  const parsed = parseMiitLithiumOperatingObservations(
    '2026年上半年锂离子电池行业运行情况。电池级碳酸锂和氢氧化锂（微粉级）均价分别为16.3万元/吨和15.3万元/吨。',
    { sourceCandidateId: 'miit-h1', publishedAt: '2026-09-15T14:43:00.000Z', retrievedAt: '2026-10-01T00:00:00.000Z', originPublisher: 'MIIT', hostPlatform: 'www.miit.gov.cn', retrievalProvider: 'ResearchHub direct HTTPS', sourceAuthority: 'S1_OFFICIAL', determinismClass: 'EVIDENCE_BACKED_NUMERIC', metadata: { canonicalUrl: 'https://www.miit.gov.cn/article' } },
  )
  const requirement = { metricId: 'industry:lithium_battery:lithium-hydroxide-period-average-price', dataKind: 'timeseries' as const }
  const candidate = normalizeIndustryObservationCandidate(parsed.find((item) => item.metricKey.endsWith('hydroxide_average_price'))!, requirement, 'industry.metric.miit.lithium-hydroxide-average-price')
  assert.ok(candidate)
  assert.equal(candidate.value, 15.3)
  assert.equal(candidate.unit, '万元/吨')
  assert.equal(candidate.periodBasis, 'YTD')
  assert.equal(candidate.aggregation, 'AVERAGE')
  assert.equal(candidate.grade, '微粉级')
  assert.equal(candidate.sourceIdentity, 'url:https://www.miit.gov.cn/article')
  assert.equal(candidate.valueVersion.status, 'UNVERIFIED')
  assert.equal(normalizeIndustryObservationCandidate(parsed[0]!, requirement, 'industry.metric.miit.lithium-total-output'), undefined)

  let requestedMetric: string | undefined
  const metricSource = (retentionAllowed: boolean) => ({
    candidate: { candidateId: 'miit-h1', kind: 'official_disclosure' as const, tier: 1 as const, title: 'MIIT H1', provider: 'miit-route', url: 'https://www.miit.gov.cn/article', publishedAt: '2026-09-15T14:43:00.000Z' },
    retrievedAt: '2026-10-01T00:00:00.000Z', title: 'MIIT H1', content: 'source text', canonicalUrl: 'https://www.miit.gov.cn/article', contentHash: 'b'.repeat(64), publisher: 'MIIT',
    rights: { accessScope: 'public' as const, retentionAllowed, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false },
  })
  const operation = createIndustryMetricOperation({
    acquire: async () => { throw new Error('named metric operation should be used') },
    acquireNamed: async (request, metricId) => {
      requestedMetric = metricId
      assert.equal(request.metricId, requirement.metricId)
      assert.deepEqual(request.period, { start: '2026-01-01', end: '2026-06-30' })
      return { status: 'COMPLETED', observations: [parsed.find((item) => item.metricKey.endsWith('hydroxide_average_price'))!], sources: [metricSource(true)], diagnostics: [] }
    },
  })
  const result = await operation({
    requirement: { ...requirement, id: 'price', consumer: { workflow: 'industry-deep-research' }, subject: { industryId: 'lithium_battery' }, period: { start: '2026-01-01', end: '2026-06-30' }, asOf: '2026-10-01T00:00:00.000Z', determinismClass: 'EVIDENCE_BACKED_NUMERIC', llmWebFallback: 'FORBIDDEN' },
    candidate: { sourceId: 'miit-hydroxide', fallbackLevel: 'PRIMARY', originAuthority: 'S1_OFFICIAL', operationId: 'industry.metric.miit.lithium-hydroxide-average-price', supports: { dataKinds: ['timeseries'], metricIds: [requirement.metricId] } },
    target: { name: '锂离子电池' }, now: () => '2026-10-01T00:00:00.000Z',
  })
  assert.equal(requestedMetric, requirement.metricId)
  assert.equal(result.status, 'SUCCESS')
  if (result.status === 'SUCCESS') assert.equal(result.data.observationCandidates[0]?.grade, '微粉级')
  const deniedOperation = createIndustryMetricOperation({
    acquire: async () => { throw new Error('named metric operation should be used') },
    acquireNamed: async () => ({ status: 'COMPLETED', observations: [parsed.find((item) => item.metricKey.endsWith('hydroxide_average_price'))!], sources: [metricSource(false)], diagnostics: [] }),
  })
  const denied = await deniedOperation({
    requirement: { ...requirement, id: 'price-denied', consumer: { workflow: 'industry-deep-research' }, subject: { industryId: 'lithium_battery' }, period: { start: '2026-01-01', end: '2026-06-30' }, asOf: '2026-10-01T00:00:00.000Z', determinismClass: 'EVIDENCE_BACKED_NUMERIC', llmWebFallback: 'FORBIDDEN' },
    candidate: { sourceId: 'miit-hydroxide', fallbackLevel: 'PRIMARY', originAuthority: 'S1_OFFICIAL', operationId: 'industry.metric.miit.lithium-hydroxide-average-price', supports: { dataKinds: ['timeseries'], metricIds: [requirement.metricId] } },
    target: { name: '锂离子电池' }, now: () => '2026-10-01T00:00:00.000Z',
  })
  assert.equal(denied.status, 'ACCESS_DENIED')
})
