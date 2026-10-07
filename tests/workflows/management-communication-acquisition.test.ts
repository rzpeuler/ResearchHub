import assert from 'node:assert/strict'
import test from 'node:test'
import { AkshareDataAdapter } from '../../plugins/research-acquisition/akshare.ts'
import { createManagementCommunicationDataResolver, type ManagementCommunicationDataPayload } from '../../plugins/research-acquisition/management-communication-data.ts'
import type { DataResolver } from '../../data/resolver.ts'
import type { DataRequirement } from '../../data/contracts.ts'
import { dedupeDocuments, managementCommunicationDocumentPolicy, mapDocumentType, normalizeExchangeQaRows, normalizeSourceTimestamp, runExchangeQa, runManagementCommunicationDocuments, resolveExchange, type CommunicationProvenance, type ManagementCommunicationAcquisitionSources, type ManagementCommunicationDocument } from '../../workflows/management-communication-acquisition/index.ts'

const AS_OF = '2026-09-22T00:00:00.000Z'
const RETRIEVED = '2026-09-22T01:00:00.000Z'

function sources(overrides: Partial<ManagementCommunicationAcquisitionSources> = {}): ManagementCommunicationAcquisitionSources {
  return {
    cninfoIr: async () => [],
    exchangeQaSzse: async () => [],
    exchangeQaSse: async () => [],
    ...overrides,
  }
}

function cninfoRecord(overrides: Partial<{ title: string; publishedAt: string; retrievedAt: string; content: string; sourceNativeId: string }> = {}) {
  return {
    ticker: '600519',
    title: '贵州茅台投资者关系活动记录表',
    publishedAt: '2026-08-01T00:00:00.000Z',
    retrievedAt: RETRIEVED,
    content: 'fixture management communication evidence',
    sourceUrl: 'https://static.cninfo.com.cn/finalpage/2026-08-01/123456.PDF',
    sourceNativeId: '123456',
    originPublisher: '贵州茅台',
    ...overrides,
  }
}

function qaRow(overrides: Record<string, unknown> = {}) {
  return {
    股票代码: '600519',
    提问: 'What is the fixture question?',
    回答: 'This is the fixture answer.',
    提问时间: '2026-08-01 09:00:00',
    回答时间: '2026-08-02 09:00:00',
    attachedId: 'qa-1',
    ...overrides,
  }
}

test('management documents and exchange Q&A use DataResolver Common policies', async () => {
  const request = { ticker: '600519', companyName: '贵州茅台', exchange: 'SSE' as const, asOf: AS_OF }
  const boundSources = sources({ cninfoIr: async () => [cninfoRecord()], exchangeQaSse: async () => [qaRow()] })
  const actual = createManagementCommunicationDataResolver({ request, sources: boundSources, now: () => RETRIEVED })
  const seen: DataRequirement[] = []
  const dataResolver = { resolveOne: (requirement: DataRequirement) => { seen.push(requirement); return actual.resolveOne(requirement) }, resolve: (requirements: readonly DataRequirement[]) => actual.resolve(requirements) } as DataResolver<ManagementCommunicationDataPayload>
  const documents = await runManagementCommunicationDocuments({ request, sources: boundSources, now: () => RETRIEVED, dataResolver })
  const qa = await runExchangeQa({ request, sources: boundSources, now: () => RETRIEVED, dataResolver })
  assert.equal(documents.status, 'AVAILABLE')
  assert.equal(qa.status, 'AVAILABLE')
  assert.deepEqual(seen.map((item) => item.metricId), ['management_communication_documents', 'exchange_qa_sse'])
  assert.deepEqual([documents.acquisition.policyId, qa.acquisition.policyId], ['d2-001-management-communication-documents', 'd2-001-sse-exchange-qa'])
})

test('document contract requires independent publication and retrieval times', async () => {
  const result = await runManagementCommunicationDocuments({ request: { ticker: '600519', companyName: '贵州茅台', asOf: AS_OF }, sources: sources({ cninfoIr: async () => [cninfoRecord()] }), now: () => RETRIEVED })
  assert.equal(result.status, 'AVAILABLE')
  assert.equal(result.data[0]?.publishedAt, '2026-08-01T00:00:00.000Z')
  assert.equal(result.data[0]?.retrievedAt, RETRIEVED)
  assert.equal(result.data[0]?.source.originPublisher, '贵州茅台')
  assert.equal(result.data[0]?.source.hostPlatform, 'CNINFO')
  assert.equal(result.data[0]?.source.retrievalProvider, 'cninfo-official-client')
})

test('deterministic document mapping excludes unknown categories', async () => {
  const result = await runManagementCommunicationDocuments({ request: { ticker: '600519', asOf: AS_OF }, sources: sources({ cninfoIr: async () => [cninfoRecord({ title: '贵州茅台关于会计政策变更的公告' })] }), now: () => RETRIEVED })
  assert.equal(result.status, 'UNAVAILABLE')
  assert.equal(result.data.length, 0)
  assert.match(result.diagnostics.join('|'), /unmapped_documentType/)
  assert.doesNotMatch(JSON.stringify(result), /COMPANY_IR_DOCUMENT/)
})

test('missing or future publication time cannot become successful acquisition', async () => {
  for (const record of [cninfoRecord({ publishedAt: '' }), cninfoRecord({ publishedAt: '2026-09-23T00:00:00.000Z' })]) {
    const result = await runManagementCommunicationDocuments({ request: { ticker: '600519', asOf: AS_OF }, sources: sources({ cninfoIr: async () => [record] }), now: () => RETRIEVED })
    assert.equal(result.status, 'UNAVAILABLE')
    assert.equal(result.acquisition.attempts[0]?.status, 'NO_DATA')
    assert.equal(result.acquisition.attempts.length, 1)
  }
})

test('IR document policy contains only executable CNINFO primary', async () => {
  const result = await runManagementCommunicationDocuments({ request: { ticker: '600519', asOf: AS_OF }, sources: sources({ cninfoIr: async () => [cninfoRecord()] }), now: () => RETRIEVED })
  assert.equal(result.status, 'AVAILABLE')
  assert.deepEqual(result.acquisition.attempts.map((attempt) => attempt.fallbackLevel), ['PRIMARY'])
  assert.deepEqual(managementCommunicationDocumentPolicy().candidates.map((candidate) => candidate.sourceId), ['cninfo-official-ir'])
})

test('EastMoney metadata cannot become a ManagementCommunicationDocument', async () => {
  const result = await runManagementCommunicationDocuments({ request: { ticker: '600519', companyName: '贵州茅台', asOf: AS_OF }, sources: sources({ cninfoIr: async () => [] }), now: () => RETRIEVED })
  assert.equal(result.status, 'UNAVAILABLE')
  assert.equal(result.data.length, 0)
  assert.deepEqual(result.acquisition.attempts.map((attempt) => attempt.sourceId), ['cninfo-official-ir'])
})

test('SZSE exchange routing invokes only SZSE and preserves Q&A pairing', async () => {
  const calls: string[] = []
  const result = await runExchangeQa({ request: { ticker: '000001', exchange: 'SZSE', asOf: AS_OF }, sources: sources({ exchangeQaSzse: async () => { calls.push('szse'); return [{ ...qaRow(), 股票代码: '000001' }] }, exchangeQaSse: async () => { calls.push('sse'); return [qaRow()] } }), now: () => RETRIEVED })
  assert.equal(result.status, 'AVAILABLE')
  assert.deepEqual(calls, ['szse'])
  assert.equal(result.data[0]?.platform, 'SZSE_HUDONGYI')
  assert.equal(result.data[0]?.question, 'What is the fixture question?')
  assert.equal(result.data[0]?.answer, 'This is the fixture answer.')
  assert.equal(result.data[0]?.publishedAt, result.data[0]?.answeredAt)
  assert.equal(result.acquisition.attempts.length, 1)
})

test('SSE exchange routing invokes only SSE and never adds a document fallback', async () => {
  const calls: string[] = []
  const result = await runExchangeQa({ request: { ticker: '600519', exchange: 'SSE', asOf: AS_OF }, sources: sources({ exchangeQaSse: async () => { calls.push('sse'); return [qaRow()] } }), now: () => RETRIEVED })
  assert.equal(result.status, 'AVAILABLE')
  assert.deepEqual(calls, ['sse'])
  assert.equal(result.data[0]?.platform, 'SSE_EINTERACTION')
})

test('meeting notices are rejected while actual communication titles map deterministically', () => {
  assert.equal(mapDocumentType('关于召开2026年半年度业绩说明会的公告'), undefined)
  assert.equal(mapDocumentType('投资者关系活动记录表'), 'INVESTOR_RELATIONS_RECORD')
  assert.equal(mapDocumentType('2025年度暨2026年第一季度业绩说明会召开情况的公告'), 'EARNINGS_BRIEFING')
  assert.equal(mapDocumentType('业绩说明会活动记录'), 'EARNINGS_BRIEFING')
  assert.equal(mapDocumentType('业绩说明会投资者问答'), 'EARNINGS_BRIEFING')
  assert.equal(mapDocumentType('召开2026年业绩说明会的通知'), undefined)
  assert.equal(mapDocumentType('2026年业绩说明会邀请函'), undefined)
  assert.equal(mapDocumentType('2026年业绩说明会预告'), undefined)
  assert.equal(mapDocumentType('2026年业绩说明会问题征集'), undefined)
})

test('unsupported or unresolved exchange returns UNAVAILABLE without attempting either exchange', async () => {
  const calls: string[] = []
  const result = await runExchangeQa({ request: { ticker: '830000', exchange: 'BSE', asOf: AS_OF }, sources: sources({ exchangeQaSzse: async () => { calls.push('szse'); return [] }, exchangeQaSse: async () => { calls.push('sse'); return [] } }), now: () => RETRIEVED })
  assert.equal(result.status, 'UNAVAILABLE')
  assert.deepEqual(calls, [])
  assert.deepEqual(result.acquisition.attempts, [])
})

test('Q&A rejects answer-only, empty, malformed, and future rows', () => {
  for (const row of [
    { ...qaRow(), 提问: '' },
    { ...qaRow(), 回答: '' },
    { ...qaRow(), 回答时间: 'not-a-date' },
    { ...qaRow(), publishedAt: '2026-09-23T00:00:00.000Z' },
  ]) {
    const batch = normalizeExchangeQaRows([row], { ticker: '600519', asOf: AS_OF }, 'SSE_EINTERACTION', RETRIEVED)
    assert.equal(batch.values.length, 0)
    assert.ok(batch.diagnostics.length > 0)
  }
})

test('normalizer accepts the observed AKShare CNINFO Q&A vocabulary', () => {
  const batch = normalizeExchangeQaRows([{ 股票代码: '000001', 问题: 'Observed question', 回答内容: 'Observed answer', 提问时间: '2026-08-01 09:00:00', 更新时间: '2026-08-02 09:00:00', 问题编号: 'question-1', 回答ID: 'answer-1' }], { ticker: '000001', asOf: AS_OF }, 'SZSE_HUDONGYI', RETRIEVED)
  assert.equal(batch.values.length, 1)
  assert.equal(batch.values[0]?.question, 'Observed question')
  assert.equal(batch.values[0]?.answer, 'Observed answer')
  assert.equal(batch.values[0]?.answeredAt, '2026-08-02T01:00:00.000Z')
  assert.equal(batch.values[0]?.source.sourceNativeId, 'question-1')
})

test('source-aware China timestamps use Asia/Shanghai and preserve explicit zones', () => {
  assert.equal(normalizeSourceTimestamp('2026-08-02 09:00:00', 'CNINFO', 'event'), '2026-08-02T01:00:00.000Z')
  assert.equal(normalizeSourceTimestamp('2026-08-02T09:00:00+08:00', 'SSE_EINTERACTION', 'event'), '2026-08-02T01:00:00.000Z')
  assert.equal(normalizeSourceTimestamp(1785632400000, 'SZSE_HUDONGYI', 'event'), '2026-08-02T01:00:00.000Z')
})

test('management communication lookback follows the Shanghai calendar', async () => {
  let observedLookback: string | undefined
  const result = await runManagementCommunicationDocuments({
    request: { ticker: '600519', asOf: '2026-09-22T00:30:00+08:00', lookbackDays: 1 },
    sources: sources({ cninfoIr: async (request) => { observedLookback = request.lookbackStartDate; return [] } }),
    now: () => RETRIEVED,
  })
  assert.equal(result.status, 'UNAVAILABLE')
  assert.equal(observedLookback, '2026-09-21')
})

test('date-only publication uses Shanghai end-of-day and enforces the PIT boundary', () => {
  assert.equal(normalizeSourceTimestamp('2026-08-02', 'EastMoney', 'publication'), '2026-08-02T15:59:59.999Z')
  const row = { ...qaRow(), publishedAt: '2026-08-02' }
  const before = normalizeExchangeQaRows([row], { ticker: '600519', asOf: '2026-08-02T15:59:59.998Z' }, 'SSE_EINTERACTION', RETRIEVED)
  const after = normalizeExchangeQaRows([row], { ticker: '600519', asOf: '2026-08-02T16:00:00.000Z' }, 'SSE_EINTERACTION', RETRIEVED)
  assert.equal(before.values.length, 0)
  assert.equal(after.values.length, 1)
})

test('stable dedupe is row-order independent and keeps distinct provenance contexts', () => {
  const source = (retrievalProvider: string): CommunicationProvenance => ({ originPublisher: 'Company', hostPlatform: 'CNINFO', retrievalProvider, authority: 'S1_OFFICIAL', disclosureClass: 'OFFICIAL_IR' })
  const value = (retrievalProvider: string): ManagementCommunicationDocument => ({ id: 'same-id', ticker: '600519', documentType: 'INVESTOR_RELATIONS_RECORD', publishedAt: '2026-08-01T00:00:00.000Z', retrievedAt: RETRIEVED, content: 'fixture', source: source(retrievalProvider) })
  assert.equal(dedupeDocuments([value('client'), value('client')]).length, 1)
  assert.equal(dedupeDocuments([value('client'), value('AKShare')]).length, 2)
})

test('exchange resolver follows existing ticker conventions without extending D0', () => {
  assert.equal(resolveExchange({ ticker: '600519' }), 'SSE')
  assert.equal(resolveExchange({ ticker: '000001' }), 'SZSE')
  assert.equal(resolveExchange({ ticker: '830000' }), undefined)
})

test('AKShare bridge exposes only explicit D2 operations', async () => {
  const calls: Array<{ script: string; args: string[] }> = []
  const adapter = new AkshareDataAdapter({ runner: async (script, args) => { calls.push({ script, args: [...args] }); return '[]' } })
  await adapter.exchangeQaSzse({ symbol: '000001' })
  await adapter.exchangeQaSzseAnswer({ symbol: 'qa-1' })
  await adapter.exchangeQaSse({ symbol: '600519' })
  await adapter.institutionalResearchDetail({ date: '20260901' })
  assert.deepEqual(calls.map((call) => call.args), [
    ['szse-qa', '000001', '', ''],
    ['szse-qa-answer', 'qa-1', '', ''],
    ['sse-qa', '600519', '', ''],
    ['em-institutional-research', '', '20260901', ''],
  ])
  assert.match(calls[0]!.script, /stock_irm_cninfo/)
  assert.match(calls[1]!.script, /stock_irm_ans_cninfo/)
  assert.match(calls[2]!.script, /stock_sns_sseinfo/)
  assert.match(calls[3]!.script, /stock_jgdy_detail_em/)
})
