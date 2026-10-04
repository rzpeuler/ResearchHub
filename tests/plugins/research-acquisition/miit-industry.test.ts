import assert from 'node:assert/strict'
import test from 'node:test'
import { MiitIndustryResearchPlugin, MIIT_AI_COMPUTE_DATA_CENTER_ANCHOR, MIIT_AI_COMPUTE_GLOSSARY_ATTACHMENT_ANCHOR, MIIT_AI_COMPUTE_INFRASTRUCTURE_ANCHOR, MIIT_INDUSTRY_ROUTES, MIIT_PCB_DEFINITION_ANCHORS, validMiitUrl } from '../../../plugins/research-acquisition/miit-industry.ts'
import { sha256 } from '../../../plugins/research-acquisition/hash.ts'

const req = { industry: { name: 'PCB Manufacturing', aliases: ['Printed Circuit Board', '印制电路板'], searchTerms: ['PCB', '电子信息制造业'] }, asOf: '2026-09-14T00:00:00.000Z', limitPerKind: 8 }
const html = (title: string, url: string, date = '2026-01-02') => `<a href="${url}">${title}</a><span>${date}</span>`
const resolver = { async parse(source: { bytes: Uint8Array }) { return { documentId: 'fixture', parser: 'fixture', metadata: {}, sections: [], blocks: [], normalizedText: new TextDecoder().decode(source.bytes).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), warnings: [] } } } as any
const response = (body: string, type = 'text/html', url = '') => { const r = new Response(body, { headers: { 'content-type': type } }); if (url) Object.defineProperty(r, 'url', { value: url }); return r }

test('discovers bounded authorized MIIT list pages, ranks, dates and suppresses duplicates', async () => {
  const calls: string[] = []; const plugin = new MiitIndustryResearchPlugin({ documentResolver: resolver, fetchImpl: async (input) => { const url = String(input); calls.push(url); return response(html('PCB policy', 'https://www.miit.gov.cn/a.htm') + html('generic', 'https://www.miit.gov.cn/g.htm') + html('PCB recent', 'https://www.miit.gov.cn/b.htm', '2025-04-01') + '<a href="https://www.miit.gov.cn/jgsj/dzs/wjfb/?page=2">下一页</a>') } })
  const items = await plugin.discover(req); assert.equal(calls.length, 6); assert.ok(calls.every((x) => new URL(x).hostname.endsWith('miit.gov.cn'))); assert.deepEqual(items.map((x) => x.url), [...MIIT_PCB_DEFINITION_ANCHORS.map((x) => x.url), 'https://www.miit.gov.cn/a.htm', 'https://www.miit.gov.cn/b.htm']); assert.equal(items[4]!.publishedAt, '2026-01-02T00:00:00.000Z')
})
test('Company is isolated and empty discovery is safe', async () => { let calls = 0; const p = new MiitIndustryResearchPlugin({ fetchImpl: async () => { calls++; throw new Error('network') } }); assert.deepEqual(await p.discover({ company: { symbol: '600519' } }), []); assert.equal(calls, 0); assert.deepEqual(await p.discover({ ...req, industry: { name: 'industry', searchTerms: [] } }), []) })
test('fetch and normalize HTML and directly linked PDF with provenance and rights', async () => {
  const p = new MiitIndustryResearchPlugin({ documentResolver: resolver, fetchImpl: async (input) => { const url = String(input); return response(url.endsWith('.pdf') ? '%PDF official PCB' : '<html><body>official PCB policy</body></html>', url.endsWith('.pdf') ? 'application/pdf' : 'text/html') }, now: () => '2026-09-14T01:00:00.000Z' })
  for (const [url, expectedMediaType] of [['https://www.miit.gov.cn/a.htm', 'text/html'], ['https://www.miit.gov.cn/file.pdf', 'application/pdf']] as const) { const c = { candidateId: `miit-${sha256(url)}`, kind: 'web_article' as const, tier: 1 as const, title: 'PCB', provider: 'miit', url }; const n = await p.normalize(await p.fetch(c)); assert.equal(n.publisher, 'Ministry of Industry and Information Technology'); assert.equal(n.contentHash, sha256(n.rawBytes!)); assert.equal(n.rights.redistributionAllowed, false); assert.equal(n.mediaType, expectedMediaType) }
})
test('rejects off-domain candidates, redirects and unsupported or oversized payloads', async () => {
  const evil = new MiitIndustryResearchPlugin({ fetchImpl: async () => response('x', 'text/html', 'https://evil.example/a') }); const url = 'https://www.miit.gov.cn/a.htm'; const c = { candidateId: `miit-${sha256(url)}`, kind: 'web_article' as const, tier: 1 as const, title: 'PCB', provider: 'miit', url }; await assert.rejects(() => evil.fetch(c), /redirect/) ; const bad = new MiitIndustryResearchPlugin({ fetchImpl: async () => response('x', 'application/zip') }); await assert.rejects(() => bad.fetch(c), /unsupported/); const large = new MiitIndustryResearchPlugin({ maxDocumentPayloadBytes: 10, fetchImpl: async () => response('x'.repeat(100)) }); await assert.rejects(() => large.fetch(c), /exceeds bound/); await assert.rejects(() => evil.fetch({ ...c, url: 'https://example.com/a', candidateId: `miit-${sha256('https://example.com/a')}` }), /candidate|MIIT/)
})
test('route families are fixed and candidate contract is compatible', () => { assert.equal(MIIT_INDUSTRY_ROUTES.length, 3); const p = new MiitIndustryResearchPlugin({ routes: ['https://evil.example/'] }); assert.equal(p.name, 'miit-industry-research-acquisition') })

test('resolves relative articles and pagination from each current list URL', async () => {
  const calls: string[] = []
  const p = new MiitIndustryResearchPlugin({ documentResolver: resolver, routes: [MIIT_INDUSTRY_ROUTES[1], MIIT_INDUSTRY_ROUTES[2]], fetchImpl: async (input) => {
    const url = String(input); calls.push(url)
    if (url === MIIT_INDUSTRY_ROUTES[1]) return response('<a href="article-2.htm">PCB route 2</a><a href="page/2/">next</a>', 'text/html', `${MIIT_INDUSTRY_ROUTES[1]}index.html`)
    if (url.endsWith('/page/2/')) return response('<a href="article-2b.htm">PCB route 2 second</a>', 'text/html', url)
    if (url === MIIT_INDUSTRY_ROUTES[2]) return response('<a href="article-3.htm">PCB route 3</a>', 'text/html', url)
    throw new Error(`unexpected ${url}`)
  } })
  const items = await p.discover(req)
  assert.deepEqual(items.map((x) => x.url), [...MIIT_PCB_DEFINITION_ANCHORS.map((x) => x.url),
    'https://www.miit.gov.cn/jgsj/yxj/xxfb/article-3.htm',
    'https://www.miit.gov.cn/zwgk/zcwj/wjfb/gg/article-2.htm',
    'https://www.miit.gov.cn/zwgk/zcwj/wjfb/gg/page/2/article-2b.htm'
  ])
  assert.deepEqual(calls, [MIIT_INDUSTRY_ROUTES[1], `${MIIT_INDUSTRY_ROUTES[1]}page/2/`, MIIT_INDUSTRY_ROUTES[2]])
})

test('rejects an off-domain discovery redirect before parsing and uses an on-domain redirect as base', async () => {
  const bad = new MiitIndustryResearchPlugin({ fetchImpl: async () => response('<a href="article.htm">PCB</a>', 'text/html', 'https://evil.example/list') })
  await assert.rejects(() => bad.discover(req), /redirect/)
  const good = new MiitIndustryResearchPlugin({ routes: [MIIT_INDUSTRY_ROUTES[1]], fetchImpl: async () => response('<a href="article.htm">PCB</a>', 'text/html', 'https://sub.miit.gov.cn/current/list/') })
  const items = await good.discover(req)
  assert.equal(items[3]!.url, 'https://sub.miit.gov.cn/current/list/article.htm')
})

test('aborts a stalled MIIT request at the configured timeout', async () => {
  const p = new MiitIndustryResearchPlugin({ timeoutMs: 5, fetchImpl: async (_input, init) => await new Promise<Response>((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))) }) })
  await assert.rejects(() => p.discover(req), /aborted|AbortError/)
})

test('discovers bounded authoritative PCB anchors for all supported target forms', async () => {
  const p = new MiitIndustryResearchPlugin({ fetchImpl: async () => response('<a href="https://www.miit.gov.cn/pcb-list.htm">PCB list</a>') })
  for (const name of ['PCB Manufacturing', 'Printed Circuit Board', '\u5370\u5236\u7535\u8def\u677f']) {
    const items = await p.discover({ industry: { name, aliases: [], searchTerms: [] }, asOf: '2026-09-14T00:00:00.000Z', limitPerKind: 8 })
    const anchors = items.filter((x) => (x.metadata as any)?.anchor)
    assert.deepEqual(anchors.map((x) => x.url), MIIT_PCB_DEFINITION_ANCHORS.map((x) => x.url))
    assert.equal(new Set(items.map((x) => x.url)).size, items.length)
    assert.ok(anchors.every((x) => x.tier === 1 && x.provider === 'miit' && new URL(x.url!).hostname.endsWith('miit.gov.cn')))
    assert.deepEqual(anchors.map((x) => x.candidateId), MIIT_PCB_DEFINITION_ANCHORS.map((x) => `miit-${sha256(x.url)}`))
    assert.ok(anchors.every((x) => (x.metadata as any)?.moduleHints?.length === 1 && (x.metadata as any).moduleHints[0] === 'industry_definition'))
  }
})

test('does not activate PCB anchors for an unrelated Industry and excludes future anchors by asOf', async () => {
  const p = new MiitIndustryResearchPlugin({ fetchImpl: async () => response('') })
  const unrelated = await p.discover({ industry: { name: 'Semiconductor Equipment', searchTerms: [] }, asOf: '2026-09-14T00:00:00.000Z', limitPerKind: 8 })
  assert.equal(unrelated.some((x) => (x.metadata as any)?.anchor), false)
  const beforeAnnouncement = await p.discover({ industry: { name: 'PCB Manufacturing', searchTerms: [] }, asOf: '2024-12-29T00:00:00.000Z', limitPerKind: 8 })
  assert.equal(beforeAnnouncement.some((x) => x.url === MIIT_PCB_DEFINITION_ANCHORS[2]!.url), false)
  assert.equal(beforeAnnouncement.length, 2)
})

test('deduplicates normal discovery against an authoritative anchor without losing the anchor', async () => {
  const anchor = MIIT_PCB_DEFINITION_ANCHORS[0]!.url
  const p = new MiitIndustryResearchPlugin({ fetchImpl: async () => response(`<a href="${anchor}?utm_source=test">duplicate anchor</a><a href="https://www.miit.gov.cn/normal.htm">PCB normal</a>`) })
  const items = await p.discover({ industry: { name: 'PCB Manufacturing', searchTerms: [] }, asOf: '2026-09-14T00:00:00.000Z', limitPerKind: 4 })
  assert.equal(items.filter((x) => x.url === anchor).length, 1)
  assert.equal(items[0]!.url, anchor)
})

test('discovers dated AI compute MIIT anchors only for explicit AI compute targets and respects asOf and limit', async () => {
  const p = new MiitIndustryResearchPlugin({ routes: [], fetchImpl: async () => response('') })
  const aiCompute = await p.discover({ industry: { name: 'AI\u7b97\u529b', aliases: [], searchTerms: [] }, asOf: '2026-10-03T00:00:00.000Z', limitPerKind: 1 })
  assert.equal(aiCompute.length, 1)
  assert.equal(aiCompute[0]!.url, MIIT_AI_COMPUTE_INFRASTRUCTURE_ANCHOR.url)
  assert.equal(aiCompute[0]!.candidateId, `miit-${sha256(MIIT_AI_COMPUTE_INFRASTRUCTURE_ANCHOR.url)}`)
  assert.equal(aiCompute[0]!.kind, 'official_disclosure')
  assert.equal(aiCompute[0]!.publishedAt, MIIT_AI_COMPUTE_INFRASTRUCTURE_ANCHOR.publishedAt)
  assert.equal((aiCompute[0]!.metadata as any).discoveryRoute, 'ai-compute-infrastructure-anchor')
  assert.equal((aiCompute[0]!.metadata as any).anchor, true)
  assert.ok(validMiitUrl(aiCompute[0]!.url))

  const allAnchors = await p.discover({ industry: { name: 'AI\u7b97\u529b', aliases: [], searchTerms: [] }, asOf: '2026-10-03T00:00:00.000Z', limitPerKind: 8 })
  const dataCenter = allAnchors.find((x) => x.url === MIIT_AI_COMPUTE_DATA_CENTER_ANCHOR.url)!
  assert.ok(dataCenter)
  assert.equal(dataCenter.title, MIIT_AI_COMPUTE_DATA_CENTER_ANCHOR.title)
  assert.equal(dataCenter.publishedAt, '2021-07-14T00:00:00.000Z')
  assert.equal((dataCenter.metadata as any).discoveryRoute, 'ai-compute-data-center-anchor')
  assert.equal((dataCenter.metadata as any).anchor, true)
  assert.ok(validMiitUrl(dataCenter.url))

  const glossary = allAnchors.find((x) => x.url === MIIT_AI_COMPUTE_GLOSSARY_ATTACHMENT_ANCHOR.url)!
  assert.ok(glossary)
  assert.equal(glossary.title, '\u65b0\u578b\u6570\u636e\u4e2d\u5fc3\u53d1\u5c55\u4e09\u5e74\u884c\u52a8\u8ba1\u5212\uff082021-2023\u5e74\uff09\u9644\u4ef6\uff1a\u540d\u8bcd\u89e3\u91ca')
  assert.equal(glossary.publishedAt, MIIT_AI_COMPUTE_DATA_CENTER_ANCHOR.publishedAt)
  assert.equal((glossary.metadata as any).discoveryRoute, 'ai-compute-glossary-attachment-anchor')
  assert.equal((glossary.metadata as any).parentUrl, MIIT_AI_COMPUTE_DATA_CENTER_ANCHOR.url)
  assert.match((glossary.metadata as any).evidenceBasis, /GPU, FPGA/u)
  assert.equal((glossary.metadata as any).anchor, true)
  assert.ok(validMiitUrl(glossary.url))
  assert.deepEqual(allAnchors.slice(0, 3).map((x) => x.url), [
    MIIT_AI_COMPUTE_INFRASTRUCTURE_ANCHOR.url,
    MIIT_AI_COMPUTE_DATA_CENTER_ANCHOR.url,
    MIIT_AI_COMPUTE_GLOSSARY_ATTACHMENT_ANCHOR.url,
  ])
  const limitedAnchors = await p.discover({ industry: { name: 'AI\u7b97\u529b', searchTerms: [] }, asOf: '2026-10-03T00:00:00.000Z', limitPerKind: 2 })
  assert.deepEqual(limitedAnchors.map((x) => x.url), [MIIT_AI_COMPUTE_INFRASTRUCTURE_ANCHOR.url, MIIT_AI_COMPUTE_DATA_CENTER_ANCHOR.url])

  const beforePublication = await p.discover({ industry: { name: 'AI\u7b97\u529b', searchTerms: [] }, asOf: '2023-10-07T23:59:59.999Z' })
  assert.equal(beforePublication.some((x) => x.url === MIIT_AI_COMPUTE_INFRASTRUCTURE_ANCHOR.url), false)
  const beforeDataCenterPublication = await p.discover({ industry: { name: 'AI\u7b97\u529b', searchTerms: [] }, asOf: '2021-07-13T23:59:59.999Z' })
  assert.equal(beforeDataCenterPublication.some((x) => x.url === MIIT_AI_COMPUTE_DATA_CENTER_ANCHOR.url), false)
  assert.equal(beforeDataCenterPublication.some((x) => x.url === MIIT_AI_COMPUTE_GLOSSARY_ATTACHMENT_ANCHOR.url), false)
  const unrelated = await p.discover({ industry: { name: 'Semiconductor Equipment', aliases: ['AI semiconductor'], searchTerms: ['semiconductor equipment'] }, asOf: '2026-10-03T00:00:00.000Z' })
  assert.equal(unrelated.some((x) => (x.metadata as any)?.discoveryRoute === 'ai-compute-infrastructure-anchor'), false)
  assert.equal(unrelated.some((x) => (x.metadata as any)?.discoveryRoute === 'ai-compute-data-center-anchor'), false)
  assert.equal(unrelated.some((x) => (x.metadata as any)?.discoveryRoute === 'ai-compute-glossary-attachment-anchor'), false)
})

test('AI compute anchor uses the existing bounded PDF fetch and normalization path', async () => {
  const p = new MiitIndustryResearchPlugin({
    routes: [],
    fetchImpl: async (input) => response('%PDF 算力\u57fa\u7840\u8bbe\u65bd', 'application/pdf', String(input)),
    documentResolver: { async parse(source: { bytes: Uint8Array }) { return { documentId: 'fixture', parser: 'fixture', metadata: {}, sections: [], blocks: [], normalizedText: new TextDecoder().decode(source.bytes), warnings: [] } } } as any
  })
  const anchor = MIIT_AI_COMPUTE_INFRASTRUCTURE_ANCHOR
  const candidate = { candidateId: `miit-${sha256(anchor.url)}`, kind: 'official_disclosure' as const, tier: 1 as const, title: anchor.title, provider: 'miit', url: anchor.url, publishedAt: anchor.publishedAt }
  const normalized = await p.normalize(await p.fetch(candidate))
  assert.equal(normalized.canonicalUrl, anchor.url)
  assert.equal(normalized.candidate.publishedAt, anchor.publishedAt)
  assert.match(normalized.content, /\u7b97\u529b/)
  assert.equal(normalized.publisher, 'Ministry of Industry and Information Technology')
  assert.equal(normalized.rights.policyBasis, 'personal_noncommercial_research')
})

test('fetches and normalizes representative PDF and HTML anchors through the existing seam', async () => {
  const pdfFixture = new TextEncoder().encode('PCB production enterprises are in scope; dedicated equipment and dedicated material manufacturing are outside the management scope.')
  const htmlFixture = '<html><body>公告2024年第46号 continues to apply the PCB industry specification framework.</body></html>'
  const p = new MiitIndustryResearchPlugin({
    fetchImpl: async (input) => response(String(input).endsWith('.pdf') ? new TextDecoder().decode(pdfFixture) : htmlFixture, String(input).endsWith('.pdf') ? 'application/pdf' : 'text/html'),
    documentResolver: { async parse(source: { bytes: Uint8Array }) { return { documentId: 'fixture', parser: 'fixture', metadata: {}, sections: [], blocks: [], normalizedText: new TextDecoder().decode(source.bytes).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), warnings: [] } } } as any
  })
  for (const anchor of [MIIT_PCB_DEFINITION_ANCHORS[0]!, MIIT_PCB_DEFINITION_ANCHORS[2]!]) {
    const candidate = { candidateId: `miit-${sha256(anchor.url)}`, kind: 'official_disclosure' as const, tier: 1 as const, title: anchor.title, provider: 'miit', url: anchor.url, publishedAt: anchor.publishedAt }
    const normalized = await p.normalize(await p.fetch(candidate))
    assert.equal(normalized.canonicalUrl, anchor.url)
    assert.match(normalized.content, /PCB|\u5370制电路板|公告/)
    assert.equal(normalized.rights.policyBasis, 'personal_noncommercial_research')
  }
})
