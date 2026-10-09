import assert from 'node:assert/strict'
import test from 'node:test'
import { CninfoOfficialDisclosureClient, OfficialDisclosureResearchPlugin, cninfoShanghaiCalendarDate } from '../../../plugins/research-acquisition/official.ts'

test('CNINFO PDF fetch preserves bytes and obtains normalized text only through the Document seam', async () => {
  const bytes = Uint8Array.from([37, 80, 68, 70, 45, 49, 46, 55])
  let parsedBytes: Uint8Array | undefined
  const response = new Response(bytes, { status: 200, headers: { 'content-type': 'application/pdf' } })
  Object.defineProperty(response, 'text', { value: () => { throw new Error('PDF response.text() must not be used') } })
  const client = new CninfoOfficialDisclosureClient({ fetchImpl: async () => response, documentResolver: { parse: async (input) => { parsedBytes = input.bytes; return { documentId: 'doc-fixture', normalizedText: 'Document seam text', sections: [], blocks: [], parser: 'fixture', stats: {}, warnings: [] } as never } } })
  const result = await client.fetchDocument({ title: 'fixture', url: 'https://static.cninfo.com.cn/fixture.pdf', publishedAt: '2026-09-08' })
  assert.deepEqual([...result.bytes], [...bytes])
  assert.deepEqual([...parsedBytes!], [...bytes])
  assert.equal(result.content, 'Document seam text')
  assert.equal(result.mediaType, 'application/pdf')
})

test('CNINFO Industry discovery uses bounded public full-text disclosure search', async () => {
  const requests: string[] = []
  const response = new Response(JSON.stringify({ announcements: [
    { announcementTitle: '印制电路板扩产项目公告', adjunctUrl: '/finalpage/2026-06-01/123.PDF', announcementTime: 1780272000000, secName: '示例电子' },
    { announcementTitle: '未来日期公告', adjunctUrl: '/finalpage/2026-12-01/456.PDF', announcementTime: 1796083200000 },
  ] }), { status: 200, headers: { 'content-type': 'application/json' } })
  const client = new CninfoOfficialDisclosureClient({ fetchImpl: async (input) => { requests.push(String(input)); return response.clone() } })
  const result = await client.listIndustry({ industry: { name: 'PCB Manufacturing', aliases: ['印制电路板'], searchTerms: ['PCB capacity'] }, asOf: '2026-09-14T00:00:00.000Z' })
  assert.equal(result.length, 1)
  assert.equal(result[0]?.title, '印制电路板扩产项目公告')
  assert.match(result[0]?.url ?? '', /^https:\/\/static\.cninfo\.com\.cn\//)
  assert.equal(requests.length, 6)
})

test('CNINFO Company discovery uses the exact topSearch orgId for both stock and name queries', async () => {
  const bodies: string[] = []
  const responses = [
    new Response(JSON.stringify([{ code: '600519', orgId: 'gssh0600519', zwjc: '贵州茅台' }]), { status: 200 }),
    new Response(JSON.stringify({ announcements: [] }), { status: 200 }),
    new Response(JSON.stringify({ announcements: [{ announcementTitle: '贵州茅台年度报告', adjunctUrl: '/finalpage/2026-04-01/789.PDF', announcementTime: 1775001600000 }] }), { status: 200 }),
  ]
  const client = new CninfoOfficialDisclosureClient({ fetchImpl: async (_input, init) => { bodies.push(String(init?.body)); return responses.shift()! } })
  const result = await client.list({ company: { symbol: '600519', name: '贵州茅台', exchange: 'SSE' }, asOf: '2026-09-14T00:00:00.000Z', limitPerKind: 3 })
  assert.equal(result.length, 1)
  assert.match(bodies[0]!, /keyWord=600519/)
  assert.match(bodies[0]!, /maxNum=10/)
  assert.match(bodies[1]!, /stock=600519%2Cgssh0600519/)
  assert.match(bodies[2]!, /stock=600519%2Cgssh0600519/)
  assert.match(bodies[2]!, /searchkey=%E8%B4%B5%E5%B7%9E%E8%8C%85%E5%8F%B0/)
})

test('CNINFO topSearch rejects wrong-code rows and missing orgId', async () => {
  for (const payload of [
    [{ code: '000001', orgId: 'gssz000001' }],
    [{ code: '600519', zwjc: '贵州茅台' }],
  ]) {
    const client = new CninfoOfficialDisclosureClient({ fetchImpl: async () => new Response(JSON.stringify(payload), { status: 200 }) })
    await assert.rejects(() => client.resolveOrganizationId('600519'), /CNINFO_ORG_ID_NOT_FOUND:600519/)
  }
})

test('CNINFO research candidates preserve an explicit correction-to-announcement relation', async () => {
  const client = new CninfoOfficialDisclosureClient({ fetchImpl: async (input) => String(input).includes('/topSearch/')
    ? new Response(JSON.stringify([{ code: '600519', orgId: 'gssh0600519', zwjc: '贵州茅台' }]), { status: 200 })
    : new Response(JSON.stringify({ announcements: [{ announcementTitle: '贵州茅台2026年半年度报告更正公告', adjunctUrl: '/finalpage/2026-09-01/correction.pdf', announcementTime: '2026-09-01T00:00:00.000Z', announcementId: 'correction-2', correctionOf: 'filing-1', secName: '贵州茅台' }] }), { status: 200 }) })
  const plugin = new OfficialDisclosureResearchPlugin(client)
  const candidates = await plugin.discover({ company: { symbol: '600519', name: '贵州茅台', exchange: 'SSE' }, asOf: '2026-09-08T00:00:00.000Z', limitPerKind: 1, filingPeriod: { fiscalYear: 2026, fiscalPeriod: 'H1' } })
  assert.equal(candidates[0]?.metadata?.announcementId, 'correction-2')
  assert.equal(candidates[0]?.metadata?.correctionOf, 'filing-1')
})

test('CNINFO management communication query paginates, deduplicates, and returns page-2 history', async () => {
  const requests: URLSearchParams[] = []
  const client = new CninfoOfficialDisclosureClient({ pageSize: 100, fetchImpl: async (input, init) => {
    if (String(input).includes('/topSearch/')) return new Response(JSON.stringify([{ code: '600519', orgId: 'gssh0600519', zwjc: '贵州茅台' }]), { status: 200 })
    const body = new URLSearchParams(String(init?.body ?? ''))
    requests.push(body)
    const page = Number(body.get('pageNum'))
    const searchkey = body.get('searchkey')
    if (searchkey === '投资者关系活动记录' && page === 1) return new Response(JSON.stringify({ hasMore: true, totalpages: 2, announcements: [{ announcementTitle: '贵州茅台投资者关系活动记录表', adjunctUrl: '/finalpage/2026-08-30/new.PDF', announcementTime: '2026-08-30T00:00:00.000Z' }] }), { status: 200 })
    if (searchkey === '投资者关系活动记录' && page === 2) return new Response(JSON.stringify({ hasMore: false, totalpages: 2, announcements: [
      { announcementTitle: '贵州茅台投资者关系活动记录表', adjunctUrl: '/finalpage/2026-08-30/new.PDF', announcementTime: '2026-08-30T00:00:00.000Z' },
      { announcementTitle: '贵州茅台投资者关系活动记录表', adjunctUrl: '/finalpage/2026-08-01/old.PDF', announcementTime: '2026-08-01T00:00:00.000Z' },
    ] }), { status: 200 })
    return new Response(JSON.stringify({ hasMore: false, announcements: [] }), { status: 200 })
  } })
  const records = await client.listManagementCommunication({ company: { symbol: '600519', exchange: 'SSE' }, lookbackStartDate: '2026-07-01', asOf: '2026-08-31T23:59:59.999Z' })
  assert.equal(records.length, 2)
  assert.equal(records.some((record) => record.url.endsWith('/old.PDF')), true)
  assert.equal(Math.max(...requests.map((request) => Number(request.get('pageNum')))), 2)
  assert.equal(requests.filter((request) => request.get('searchkey') === '投资者关系活动记录').length, 2)
  assert.equal(requests.every((request) => Number(request.get('pageSize')) <= 30), true)
  assert.equal(requests.every((request) => request.get('stock') === '600519,gssh0600519'), true)
})

test('CNINFO management communication pagination stops on empty pages and at the explicit maximum', async () => {
  const emptyPages: number[] = []
  const emptyClient = new CninfoOfficialDisclosureClient({ fetchImpl: async (input, init) => {
    if (String(input).includes('/topSearch/')) return new Response(JSON.stringify([{ code: '600519', orgId: 'gssh0600519' }]), { status: 200 })
    emptyPages.push(Number(new URLSearchParams(String(init?.body ?? '')).get('pageNum')))
    return new Response(JSON.stringify({ hasMore: true, announcements: [] }), { status: 200 })
  } })
  await emptyClient.listManagementCommunication({ company: { symbol: '600519' }, lookbackStartDate: '2026-07-01', asOf: '2026-08-31T23:59:59.999Z' })
  assert.equal(emptyPages.length, 4)
  assert.equal(Math.max(...emptyPages), 1)

  const boundedPages: number[] = []
  const boundedClient = new CninfoOfficialDisclosureClient({ fetchImpl: async (input, init) => {
    if (String(input).includes('/topSearch/')) return new Response(JSON.stringify([{ code: '600519', orgId: 'gssh0600519' }]), { status: 200 })
    const body = new URLSearchParams(String(init?.body ?? ''))
    boundedPages.push(Number(body.get('pageNum')))
    return new Response(JSON.stringify({ hasMore: true, announcements: [{ announcementTitle: '投资者关系活动记录表', adjunctUrl: '/finalpage/2026-08-01/one.PDF', announcementTime: '2026-08-01T00:00:00.000Z' }] }), { status: 200 })
  } })
  await boundedClient.listManagementCommunication({ company: { symbol: '600519' }, lookbackStartDate: '2026-07-01', asOf: '2026-08-31T23:59:59.999Z' })
  assert.equal(Math.max(...boundedPages), 10)
  assert.equal(boundedPages.includes(11), false)
})

test('CNINFO seDate uses the Asia/Shanghai calendar date for equivalent instants', async () => {
  const seen: string[] = []
  const query = async (asOf: string) => {
    const client = new CninfoOfficialDisclosureClient({ fetchImpl: async (input, init) => {
      if (String(input).includes('/topSearch/')) return new Response(JSON.stringify([{ code: '600519', orgId: 'gssh0600519' }]), { status: 200 })
      const body = new URLSearchParams(String(init?.body ?? ''))
      seen.push(body.get('seDate') ?? '')
      return new Response(JSON.stringify({ hasMore: false, announcements: [] }), { status: 200 })
    } })
    await client.listManagementCommunication({ company: { symbol: '600519' }, lookbackStartDate: '2026-09-15', asOf })
  }
  await query('2026-09-21T16:30:00Z')
  await query('2026-09-22T00:30:00+08:00')
  assert.equal(cninfoShanghaiCalendarDate('2026-09-21T16:30:00Z'), '2026-09-22')
  assert.equal(cninfoShanghaiCalendarDate('2026-09-22T00:30:00+08:00'), '2026-09-22')
  assert.equal(seen.every((value) => value === '2026-09-15~2026-09-22'), true)
})
