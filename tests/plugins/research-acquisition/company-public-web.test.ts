import test from 'node:test'
import assert from 'node:assert/strict'
import { CompanyPublicWebPlugin } from '../../../plugins/research-acquisition/company-public-web.ts'
import type { ResearchSourceCandidate } from '../../../plugins/research-acquisition/contracts.ts'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
const candidate: ResearchSourceCandidate = { candidateId: 'page', title: 'Product', provider: 'public-web', kind: 'web_article', tier: 3, url: 'https://company.example/product' }
const resolveHost = async () => [{ address: '8.8.8.8' }]
test('synthetic proxy DNS requires independent public A proof and keeps the original HTTPS hostname', async () => {
  const fetched: string[] = []
  const plugin = new CompanyPublicWebPlugin({ resolveHost: async () => [{ address: '198.18.0.98' }], resolvePublicDnsProof: async (host) => { assert.equal(host, 'company.example'); return { Status: 0, Answer: [{ type: 1, data: '8.8.8.8' }] } }, fetchImpl: async (input) => { fetched.push(String(input)); return new Response('public body') } })
  await plugin.fetch(candidate)
  assert.deepEqual(fetched, ['https://company.example/product'])
})
test('synthetic proxy private, missing and erroneous DNS proof all fail closed', async () => {
  for (const proof of [{ Status: 0, Answer: [{ type: 1, data: '127.0.0.1' }] }, { Status: 0, Answer: [] }, { Status: 3 }, { Status: 0, Answer: [{ type: 1, data: '8.8.8.8' }, { type: 1, data: '10.0.0.1' }] }]) {
    let fetched = false
    const plugin = new CompanyPublicWebPlugin({ resolveHost: async () => [{ address: '198.19.3.4' }], resolvePublicDnsProof: async () => proof, fetchImpl: async () => { fetched = true; return new Response('must not fetch') } })
    await assert.rejects(() => plugin.fetch(candidate), /DNS_PROOF_REJECTED/)
    assert.equal(fetched, false)
  }
})
test('ordinary private DNS cannot be overridden by a public proof and every redirect is revalidated', async () => {
  let proofCalls = 0
  const unsafe = new CompanyPublicWebPlugin({ resolveHost: async () => [{ address: '10.0.0.1' }], resolvePublicDnsProof: async () => { proofCalls += 1; return { Status: 0, Answer: [{ type: 1, data: '8.8.8.8' }] } } })
  await assert.rejects(() => unsafe.fetch(candidate), /PRIVATE_ADDRESS/)
  assert.equal(proofCalls, 0)
  const redirects = new CompanyPublicWebPlugin({ resolveHost: async () => [{ address: '198.18.0.1' }], resolvePublicDnsProof: async (host) => { proofCalls += 1; return { Status: 0, Answer: [{ type: 1, data: host === 'company.example' ? '8.8.8.8' : '10.0.0.1' }] } }, fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'https://private.example/secret' } }) })
  await assert.rejects(() => redirects.fetch(candidate), /DNS_PROOF_REJECTED/)
  assert.equal(proofCalls, 2)
})
test('default proxy DNS proof uses a fixed Cloudflare HTTPS JSON endpoint without redirects', async () => {
  let proofUrl = ''
  const plugin = new CompanyPublicWebPlugin({ resolveHost: async () => [{ address: '198.18.0.1' }], fetchImpl: async (input, init) => {
    const url = new URL(String(input))
    if (url.hostname === 'cloudflare-dns.com') { proofUrl = url.href; assert.equal(init?.redirect, 'error'); assert.equal((init?.headers as Record<string,string>).accept, 'application/dns-json'); return new Response(JSON.stringify({ Status: 0, Answer: [{ type: 1, data: '8.8.8.8' }] })) }
    return new Response('public body')
  } })
  await plugin.fetch(candidate)
  assert.equal(proofUrl, 'https://cloudflare-dns.com/dns-query?name=company.example&type=A')
})
test('search discovery never uses snippets as body or publication proof', async () => {
  const plugin = new CompanyPublicWebPlugin({ resolveHost, fetchImpl: async () => new Response('<rss><channel><item><title>比亚迪 Product</title><link>https://company.example/product</link><description>search summary</description><pubDate>2026-01-01</pubDate></item></channel></rss>') })
  const discovered = await plugin.discover({ company: { symbol: '002594', name: '比亚迪' }, researchPurpose: 'company_research', searchTerms: ['产品'] })
  assert.equal(discovered.length, 1)
  assert.equal(discovered[0]?.snippet, undefined)
  assert.equal(discovered[0]?.publishedAt, undefined)
  assert.equal(discovered[0]?.metadata?.originalPublisher, 'company.example')
})
test('private DNS and redirects are blocked before accessing their body', async () => {
  let calls = 0
  const plugin = new CompanyPublicWebPlugin({ resolveHost: async (host) => [{ address: host === 'company.example' ? '8.8.8.8' : '127.0.0.1' }], fetchImpl: async () => { calls += 1; return new Response(null, { status: 302, headers: { location: 'https://private.example/secrets' } }) } })
  await assert.rejects(() => plugin.fetch(candidate), /PRIVATE_ADDRESS/)
  assert.equal(calls, 1)
  await assert.rejects(() => plugin.fetch({ ...candidate, url: 'https://127.0.0.1/a' }), /UNSAFE_URL/)
})
test('bounded public discovery preserves different research topics before first-query overflow',async()=>{
  const plugin=new CompanyPublicWebPlugin({resolveHost,fetchImpl:async input=>{
    const url=new URL(String(input));if(url.hostname!=='www.bing.com')return new Response('<html><body>No directories</body></html>')
    const term=url.searchParams.get('q')!.includes('竞争')?'competition':'products'
    return new Response(`<rss><channel>${Array.from({length:8},(_,index)=>`<item><title>${term}-${index} 比亚迪</title><link>https://company.example/${term}/${index}</link></item>`).join('')}</channel></rss>`)
  }})
  const sources=await plugin.discover({company:{symbol:'002594',name:'比亚迪'},researchPurpose:'company_research',searchTerms:['产品','竞争'],limitPerKind:4})
  assert.equal(sources.length,4);assert.ok(sources.some(source=>source.title.startsWith('competition')));assert.ok(sources.some(source=>source.title.startsWith('products')))
})
test('public discovery rejects geographic and similarly named pages without exact company identity', async () => {
  const plugin = new CompanyPublicWebPlugin({ resolveHost, fetchImpl: async () => new Response('<rss><channel><item><title>东山县旅游</title><link>https://example.com/tourism</link><description>东山</description></item><item><title>东山精密业务</title><link>https://example.com/business</link></item></channel></rss>') })
  const sources = await plugin.discover({ company: { symbol: '002384', name: '东山精密' }, researchPurpose: 'company_research', searchTerms: ['产品'] })
  assert.deepEqual(sources.map((source) => source.title), ['东山精密业务'])
})
test('public discovery separates exact-name and ticker queries without promoting peer search terms to facts', async () => {
  const queries: string[] = []
  const plugin = new CompanyPublicWebPlugin({ resolveHost, fetchImpl: async (input) => {
    const url = new URL(String(input))
    if (url.hostname !== 'www.bing.com') return new Response('<html>No directory</html>')
    const query = url.searchParams.get('q')!
    queries.push(query)
    return new Response(`<rss><channel><item><title>东山精密 PCB对照</title><link>https://company.example/${query.includes('002384') ? 'ticker' : 'industry'}</link></item></channel></rss>`)
  } })
  const sources = await plugin.discover({ company: { symbol: '002384', name: '东山精密' }, researchPurpose: 'company_research', searchTerms: ['PCB 行业 竞争 鹏鼎 沪电'], limitPerKind: 4 })
  assert.deepEqual(queries, ['"东山精密" PCB 行业 竞争 鹏鼎 沪电', '"东山精密" 002384 PCB 行业 竞争 鹏鼎 沪电'])
  assert.equal(sources.length, 2)
  assert.equal(sources[0]?.snippet, undefined)
  assert.equal((sources[0]?.metadata?.discoveryTerms as readonly string[] | undefined)?.[0], 'PCB 行业 竞争 鹏鼎 沪电')
})
test('normalization retains original fetched bytes and rejects thin pages', async () => {
  const html = `<html><body><p>${'产品与技术证据。'.repeat(50)}</p></body></html>`
  const plugin = new CompanyPublicWebPlugin({ resolveHost, fetchImpl: async () => new Response(html, { headers: { 'content-type': 'text/html' } }) })
  const fetched = await plugin.fetch(candidate)
  const normalized = await plugin.normalize(fetched)
  assert.ok(normalized.content.includes('产品与技术证据'))
  assert.equal(new TextDecoder().decode(normalized.rawBytes), html)
  assert.equal(normalized.publisher, 'company.example')
  await assert.rejects(() => plugin.normalize({ ...fetched, content: '<p>404</p>', rawBytes: new TextEncoder().encode('<p>404</p>') }), /INSUFFICIENT/)
})
test('Sogou industry fallback discovers sourced candidates and fetches literal HTTPS destination body', async () => {
  const body = `<html><p>${'东山精密与鹏鼎控股业务比较，需要核对市场和期间。'.repeat(20)}</p></html>`
  const plugin = new CompanyPublicWebPlugin({ resolveHost, fetchImpl: async (input) => {
    const url = new URL(String(input))
    if (url.hostname === 'www.bing.com') return new Response('<rss><channel><item><title>东山旅游</title><link>https://example.com/tour</link></item></channel></rss>')
    if (url.pathname === '/web') return new Response('<h3><a href="/link?url=token">东山精密行业对照</a></h3><div>东山精密与鹏鼎控股的业务</div>')
    if (url.hostname === 'www.sogou.com') return new Response('<script>window.location.replace("https://publisher.example/article")</script>')
    return new Response(body, { headers: { 'content-type': 'text/html' } })
  } })
  const candidates = await plugin.discover({ company: { symbol: '002384', name: '东山精密' }, researchPurpose: 'company_research', searchTerms: ['行业竞争'], limitPerKind: 4 })
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0]?.metadata?.discoveryEngine, 'Sogou')
  const normalized = await plugin.normalize(await plugin.fetch(candidates[0]!))
  assert.equal(normalized.canonicalUrl, 'https://publisher.example/article')
  assert.equal(normalized.publisher, 'publisher.example')
  assert.ok(normalized.content.includes('东山精密与鹏鼎控股'))
  assert.equal(new TextDecoder().decode(normalized.rawBytes), body)
})
test('Sogou literal redirects cannot bypass private DNS or HTTPS restrictions', async () => {
  const item = { ...candidate, url: 'https://www.sogou.com/link?url=token' }
  for (const target of ['https://private.example/data', 'http://publisher.example/data']) {
    const plugin = new CompanyPublicWebPlugin({ resolveHost: async (host) => [{ address: host === 'private.example' ? '127.0.0.1' : '8.8.8.8' }], fetchImpl: async () => new Response(`<script>window.location.replace("${target}")</script>`) })
    await assert.rejects(() => plugin.fetch(item), /PRIVATE_ADDRESS|UNSAFE_URL/)
  }
})
test('discovery identity cannot substitute for company evidence in the actual fetched body', async () => {
  const plugin = new CompanyPublicWebPlugin({ resolveHost })
  const mismatched = { ...candidate, metadata: { companyName: '东山精密', companySymbol: '002384' } }
  await assert.rejects(() => plugin.normalize({ candidate: mismatched, retrievedAt: '2026-10-15', content: `<p>${' unrelated generic industry discussion '.repeat(30)}</p>`, mediaType: 'text/html' }), /BODY_COMPANY_MISMATCH/)
})
test('paid report contents without substantive research body are rejected with a concrete diagnostic', async () => {
  const plugin = new CompanyPublicWebPlugin({ resolveHost })
  const catalog = `东山精密行业研究报告\n报告价格：8800元，订购完整报告请咨询客服。\n${Array.from({ length: 30 }, (_, index) => `${index + 1}.1 企业基本信息、产品参数、收入和毛利率分析`).join('\n')}`
  await assert.rejects(() => plugin.normalize({ candidate, content: catalog, retrievedAt: '2026-10-15', mediaType: 'text/plain' }), /PAID_RESEARCH_CATALOG_NO_SUBSTANTIVE_BODY/)
})
test('substantive long research survives incidental paid-report terms and a contents section', async () => {
  const plugin = new CompanyPublicWebPlugin({ resolveHost })
  const catalog = Array.from({ length: 20 }, (_, index) => `${index + 1}.1 研究内容目录`).join('\n')
  const prose = Array.from({ length: 4 }, (_, index) => `${index ? '另一个产品场景' : '东山精密的业务场景'}，${'客户认证要求和产品应用不同，因此不能直接比较所有参与者。'.repeat(8)}`).join('\n\n')
  const normalized = await plugin.normalize({ candidate, content: `报告价格与订购方式另见说明。\n${catalog}\n${prose}`, retrievedAt: '2026-10-15', mediaType: 'text/plain' })
  assert.ok(normalized.content.includes('客户认证要求'))
  const ordinary = await plugin.normalize({ candidate, content: `文章讨论付费行业报告的局限与可靠性。\n${prose}`, retrievedAt: '2026-10-15', mediaType: 'text/plain' })
  assert.ok(ordinary.content.includes('可靠性'))
})
test('comparison and product article candidates outrank pure report sales catalogs within the same budget', async () => {
  const plugin = new CompanyPublicWebPlugin({ resolveHost, fetchImpl: async (input) => {
    const url = new URL(String(input))
    if (url.hostname !== 'www.bing.com') return new Response('<html>No fallback results</html>')
    return new Response('<rss><channel><item><title>东山精密全球与中国PCB市场研究报告2024-2030</title><link>https://publisher.example/catalog</link></item><item><title>东山精密产品技术比较</title><link>https://publisher.example/article</link></item><item><title>东山精密 (002384) 最新价格股票行情</title><link>https://publisher.example/quote</link></item></channel></rss>')
  } })
  const sources = await plugin.discover({ company: { symbol: '002384', name: '东山精密' }, researchPurpose: 'company_research', searchTerms: ['产品技术'], limitPerKind: 2 })
  assert.equal(sources[0]?.url, 'https://publisher.example/article')
  assert.equal(sources.length, 2)
  assert.ok(sources.every(source => source.url !== 'https://publisher.example/catalog'))
})
test('Sogou access challenge is explicit and never followed or treated as article evidence', async () => {
  let calls = 0
  const plugin = new CompanyPublicWebPlugin({ resolveHost, fetchImpl: async () => { calls += 1; return new Response(null, { status: 302, headers: { location: 'http://www.sogou.com/antispider/' } }) } })
  await assert.rejects(() => plugin.fetch({ ...candidate, url: 'https://www.sogou.com/link?url=token' }), /SEARCH_ACCESS_CHALLENGE/)
  assert.equal(calls, 1)
})
test('validated URL cache survives search failure but supplies only candidates requiring fresh body fetch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'company-url-cache-'))
  const article = { ...candidate, title: '东山精密业务对比', url: 'https://publisher.example/article', metadata: { companyName: '东山精密', companySymbol: '002384', discoveryTerms: ['行业竞争'] } }
  let body = `<p>${'东山精密以前的业务比较。'.repeat(30)}</p>`
  let articleFetches = 0
  const plugin = new CompanyPublicWebPlugin({ candidateCacheRoot: root, resolveHost, fetchImpl: async (input) => {
    if (new URL(String(input)).hostname !== 'publisher.example') throw new Error('SEARCH_OFFLINE')
    articleFetches += 1
    return new Response(body, { headers: { 'content-type': 'text/html' } })
  } })
  try {
    await plugin.normalize(await plugin.fetch(article))
    const files = await readdir(root)
    assert.equal(files.length, 1)
    assert.match(files[0]!, /^[a-f0-9]{64}\.json$/)
    const persisted = await readFile(join(root, files[0]!), 'utf8')
    assert.ok(!persisted.includes('以前的业务'))
    const cached = await plugin.discover({ company: { symbol: '002384', name: '东山精密' }, researchPurpose: 'company_research', searchTerms: ['行业竞争'], limitPerKind: 4 })
    assert.equal(cached[0]?.metadata?.cachedDiscovery, true)
    assert.ok((cached[0]?.metadata?.discoveryDiagnostics as string[]).some(reason => reason.includes('SEARCH_OFFLINE')))
    assert.equal(cached[0]?.publishedAt, undefined)
    assert.equal(articleFetches, 2) // Discovery directory check fetches only navigation, not report evidence.
    body = `<p>${'东山精密本次重新获取的产品竞争证据。'.repeat(30)}</p>`
    const fresh = await plugin.normalize(await plugin.fetch(cached[0]!))
    assert.ok(fresh.content.includes('本次重新获取'))
    assert.equal(articleFetches, 3)
    await assert.rejects(() => plugin.discover({ company: { symbol: '002594', name: '比亚迪' }, researchPurpose: 'company_research', searchTerms: ['行业竞争'] }), /DISCOVERY_FAILED/)
    const envelope = JSON.parse(persisted)
    envelope.records[0].url = 'https://127.0.0.1/private'
    await writeFile(join(root, files[0]!), JSON.stringify(envelope))
    await assert.rejects(() => plugin.discover({ company: { symbol: '002384', name: '东山精密' }, researchPurpose: 'company_research', searchTerms: ['行业竞争'] }), /DISCOVERY_FAILED/)
  } finally { assert.ok(root.startsWith(join(tmpdir(), 'company-url-cache-'))); await rm(root, { recursive: true, force: true }) }
})
test('paid catalog failure is never written to the URL candidate cache', async () => {
  const root = await mkdtemp(join(tmpdir(), 'company-catalog-cache-'))
  const plugin = new CompanyPublicWebPlugin({ candidateCacheRoot: root, resolveHost })
  const content = `东山精密报告目录，报告价格8800元，订购咨询客服。\n${Array.from({ length: 30 }, (_, index) => `${index + 1}.1 产品收入分析`).join('\n')}`
  try {
    await assert.rejects(() => plugin.normalize({ candidate: { ...candidate, metadata: { companyName: '东山精密', companySymbol: '002384' } }, content, retrievedAt: '2026-10-15', mediaType: 'text/plain' }), /PAID_RESEARCH_CATALOG/)
    assert.deepEqual(await readdir(root), [])
  } finally { assert.ok(root.startsWith(join(tmpdir(), 'company-catalog-cache-'))); await rm(root, { recursive: true, force: true }) }
})

test('concurrent successful normalizations keep at most twenty URL records and no temporary files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'company-bounded-cache-'))
  const plugin = new CompanyPublicWebPlugin({ candidateCacheRoot: root, resolveHost })
  try {
    await Promise.all(Array.from({ length: 24 }, (_, index) => plugin.normalize({ candidate: { ...candidate, url: `https://publisher.example/article-${index}`, metadata: { companyName: '东山精密', companySymbol: '002384' } }, content: '东山精密产品应用研究。'.repeat(30), retrievedAt: '2026-10-15T00:00:00Z', mediaType: 'text/plain' })))
    const files = await readdir(root)
    assert.equal(files.length, 1)
    const envelope = JSON.parse(await readFile(join(root, files[0]!), 'utf8'))
    assert.equal(envelope.records.length, 20)
    assert.equal(new Set(envelope.records.map((record: { url: string }) => record.url)).size, 20)
    assert.ok(envelope.records.every((record: Record<string, unknown>) => !('content' in record) && !('rawBytes' in record)))
  } finally { assert.ok(root.startsWith(join(tmpdir(), 'company-bounded-cache-'))); await rm(root, { recursive: true, force: true }) }
})

test('historical title and actual publication metadata warn about period without inventing publishedAt', async () => {
  const plugin = new CompanyPublicWebPlugin({ resolveHost })
  const content = '<meta property="article:published_time" content="2019-08-21T09:00:00+08:00"><p>' + '东山精密的产品比较。'.repeat(30) + '</p>'
  const source = await plugin.normalize({ candidate, content, retrievedAt: '2026-10-15T00:00:00Z', mediaType: 'text/html' })
  assert.equal(source.candidate.publishedAt, undefined)
  assert.equal(source.candidate.metadata?.observedPublicationDate, '2019-08-21T09:00:00+08:00')
  assert.equal((source.candidate.metadata?.historicalSourceContext as { observedYear: number }).observedYear, 2019)
  const publisherJson = await plugin.normalize({ candidate, content: '<script type="application/ld+json">{"pubDate":"2019-08-19T10:52:02"}</script><p>' + '公司产品比较。'.repeat(30) + '</p>', retrievedAt: '2026-10-15T00:00:00Z', mediaType: 'text/html' })
  assert.equal((publisherJson.candidate.metadata?.historicalSourceContext as { observedYear: number }).observedYear, 2019)
  assert.equal(publisherJson.candidate.publishedAt, undefined)
  const titleOnly = await plugin.normalize({ candidate: { ...candidate, title: '2021年企业比较' }, content: '东山精密在2025年推出某产品。'.repeat(30), retrievedAt: '2026-10-15T00:00:00Z', mediaType: 'text/plain' })
  assert.equal(titleOnly.candidate.publishedAt, undefined)
  assert.equal((titleOnly.candidate.metadata?.historicalSourceContext as { basis: string }).basis, 'explicit_title_year')
  const noDate = await plugin.normalize({ candidate, content: '正文介绍2019年创立的公司及2024年产品。'.repeat(30), retrievedAt: '2026-10-15T00:00:00Z', mediaType: 'text/plain' })
  assert.equal(noDate.candidate.metadata?.historicalSourceContext, undefined)
})
