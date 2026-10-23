import test from 'node:test'
import assert from 'node:assert/strict'
import { CompanyPublicWebPlugin, decodeCompanyPublicHtml } from '../../../plugins/research-acquisition/company-public-web.ts'
import type { ResearchSourceCandidate } from '../../../plugins/research-acquisition/contracts.ts'
import { selectCompanyEvidence } from '../../../skills/company-research/evidence.ts'
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
  const plugin = new CompanyPublicWebPlugin({ resolveHost, fetchImpl: async () => new Response('<rss><channel><item><title>测试公司 Product</title><link>https://company.example/product</link><description>search summary</description><pubDate>2026-01-01</pubDate></item></channel></rss>') })
  const discovered = await plugin.discover({ company: { symbol: '002596', name: '测试公司' }, researchPurpose: 'company_research', searchTerms: ['产品'] })
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
    return new Response(`<rss><channel>${Array.from({length:8},(_,index)=>`<item><title>${term}-${index} 测试公司</title><link>https://company.example/${term}/${index}</link></item>`).join('')}</channel></rss>`)
  }})
  const sources=await plugin.discover({company:{symbol:'002596',name:'测试公司'},researchPurpose:'company_research',searchTerms:['产品','竞争'],limitPerKind:4})
  assert.equal(sources.length,4);assert.ok(sources.some(source=>source.title.startsWith('competition')));assert.ok(sources.some(source=>source.title.startsWith('products')))
})
test('public discovery rejects geographic and similarly named pages without exact company identity', async () => {
  const plugin = new CompanyPublicWebPlugin({ resolveHost, fetchImpl: async () => new Response('<rss><channel><item><title>东山县旅游</title><link>https://example.com/tourism</link><description>东山</description></item><item><title>东山精密业务</title><link>https://example.com/business</link></item></channel></rss>') })
  const sources = await plugin.discover({ company: { symbol: '002384', name: '东山精密' }, researchPurpose: 'company_research', searchTerms: ['产品'] })
  assert.deepEqual(sources.map((source) => source.title), ['东山精密业务'])
})
test('peer discovery may fetch a named competitor report, but verifies the peer body identity', async () => {
  const body = `<html><body><h1>鹏鼎控股2025年度报告</h1><p>${'鹏鼎控股披露FPC产品、客户、收入及产能数据。'.repeat(15)}</p></body></html>`
  const plugin = new CompanyPublicWebPlugin({ resolveHost, fetchImpl: async (input) => {
    const url = new URL(String(input))
    if (url.hostname === 'www.bing.com') return new Response('<rss><channel><item><title>鹏鼎控股2025年年度报告</title><link>https://peer.example/annual-report</link></item></channel></rss>')
    return new Response(body, { headers: { 'content-type': 'text/html' } })
  } })
  const candidates = await plugin.discover({ company: { symbol: '002384', name: '东山精密' }, researchPurpose: 'company_research', searchTerms: ['peer:鹏鼎控股'], limitPerKind: 4 })
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0]?.metadata?.researchSubject, 'peer_company')
  assert.equal(candidates[0]?.metadata?.peerCompanyName, '鹏鼎控股')
  const normalized = await plugin.normalize(await plugin.fetch(candidates[0]!))
  assert.ok(normalized.content.includes('鹏鼎控股'))
  assert.equal(normalized.content.includes('东山精密'), false)
  await assert.rejects(() => plugin.normalize({ candidate: candidates[0]!, retrievedAt: '2026-10-15', content: `${'深南电路年报。'.repeat(35)}`, mediaType: 'text/html' }), /PEER_MISMATCH/)
})
test('peer discovery uses Sogou when Bing has no matching competitor result', async () => {
  const body = `<html><body><h1>鹏鼎控股2025年度报告</h1><p>${'鹏鼎控股披露FPC产品、客户、收入及产能数据。'.repeat(15)}</p></body></html>`
  const plugin = new CompanyPublicWebPlugin({ resolveHost, fetchImpl: async (input) => {
    const url = new URL(String(input))
    if (url.hostname === 'www.bing.com') return new Response('<rss><channel></channel></rss>')
    if (url.hostname === 'www.sogou.com') return new Response('<h3><a href="https://peer.example/annual-report">鹏鼎控股2025年年度报告</a></h3><div>鹏鼎控股年度收入、产品和客户</div>')
    return new Response(body, { headers: { 'content-type': 'text/html' } })
  } })
  const candidates = await plugin.discover({ company: { symbol: '002384', name: '东山精密' }, researchPurpose: 'company_research', searchTerms: ['peer:鹏鼎控股'], limitPerKind: 4 })
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0]?.metadata?.researchSubject, 'peer_company')
  assert.equal(candidates[0]?.metadata?.discoveryEngine, 'Sogou')
  const normalized = await plugin.normalize(await plugin.fetch(candidates[0]!))
  assert.ok(normalized.content.includes('鹏鼎控股'))
})
test('peer discovery queries canonical name, ticker and alias, then audits body identity stages', async () => {
  const bingQueries: string[] = []
  const sogouQueries: string[] = []
  const body = `<html><body><h1>002938年度报告</h1><p>${'002938披露FPC产品、客户、收入及产能数据。'.repeat(12)}</p></body></html>`
  const plugin = new CompanyPublicWebPlugin({ resolveHost, fetchImpl: async (input) => {
    const url = new URL(String(input))
    if (url.hostname === 'www.bing.com') {
      const query = url.searchParams.get('q')!
      bingQueries.push(query)
      if (query.includes('002938')) return new Response('<rss><channel><item><title>002938 2025年度报告</title><link>https://peer.example/002938-report</link><description>年度产品和经营信息</description></item></channel></rss>')
      if (query.includes('鹏鼎控股')) return new Response('<rss><channel><item><title>无关公司公告</title><link>https://peer.example/unrelated</link><description>没有企业身份信息</description></item></channel></rss>')
      return new Response('<rss><channel></channel></rss>')
    }
    if (url.hostname === 'www.sogou.com') {
      const query = url.searchParams.get('query') ?? ''
      sogouQueries.push(query)
      return new Response('<div class="results"><div class="vrwrap"><h3 class="vrTitle"><a href="https://peer.example/sogou-report">鹏鼎控股年度报告</a></h3><div class="str_info">鹏鼎控股产品与客户信息</div></div></div>')
    }
    return new Response(body, { headers: { 'content-type': 'text/html' } })
  } })
  const candidates = await plugin.discover({ company: { symbol: '002384', name: '东山精密' }, researchPurpose: 'company_research', searchTerms: ['peer:鹏鼎控股'], limitPerKind: 6 })
  assert.ok(bingQueries.some(query => query.includes('002938')))
  assert.ok(bingQueries.some(query => query.includes('Avary Holding')))
  assert.ok(sogouQueries.some(query => query.includes('002938')))
  assert.ok(sogouQueries.some(query => query.includes('Avary Holding')))
  const tickerCandidate = candidates.find(item => item.url === 'https://peer.example/002938-report')!
  assert.equal(tickerCandidate.metadata?.peerCompanyName, '鹏鼎控股')
  assert.equal(tickerCandidate.snippet, undefined)
  const discoveredDiagnostics = tickerCandidate.metadata?.peerAcquisitionDiagnostics as Array<{ stage: string; reason?: string }>
  assert.ok(discoveredDiagnostics.some(item => item.stage === 'identity-rejected' && item.reason === 'SERP_TITLE_URL_DESCRIPTION_MISSING_PEER_IDENTITY'))
  assert.ok(discoveredDiagnostics.some(item => item.stage === 'discovered'))
  const fetched = await plugin.fetch(tickerCandidate)
  const normalized = await plugin.normalize(fetched)
  assert.ok(normalized.content.includes('002938'))
  const normalizedDiagnostics = normalized.candidate.metadata?.peerAcquisitionDiagnostics as Array<{ stage: string }>
  assert.ok(normalizedDiagnostics.some(item => item.stage === 'fetched'))
  assert.ok(normalizedDiagnostics.some(item => item.stage === 'normalized'))
  await assert.rejects(() => plugin.normalize({ ...fetched, content: `<p>${'深南电路无关产品。'.repeat(20)}</p>`, rawBytes: new TextEncoder().encode(`<p>${'深南电路无关产品。'.repeat(20)}</p>`) }), error => {
    assert.match(String(error), /PUBLIC_WEB_PEER_ACQUISITION_DIAGNOSTIC/)
    assert.match(String(error), /"stage":"rejected"/)
    assert.match(String(error), /"history":\[[^\]]*"stage":"fetched"/)
    assert.match(String(error), /PUBLIC_WEB_BODY_PEER_MISMATCH/)
    return true
  })
})

test('BYD focused public discovery fetches official model/technology pages and trusted industry context into distinct method packets', async () => {
  const seenQueries: string[] = []
  const bodies = new Map([
    ['https://www.byd.com/cn/brand-center/leading-in-technology-markets', `<html><body><h1>比亚迪科技领先</h1><p>${'比亚迪刀片电池、超级e平台与整车技术路线说明。'.repeat(8)}</p></body></html>`],
    ['https://www.miit.gov.cn/gxsj/2024-nev', `<html><body><h1>2024年汽车工业经济运行情况</h1><p>2024年中国新能源汽车产量和销量持续增长，其中新能源汽车销量为1286.6万辆，产销数据来源于中国汽车工业协会。</p><p>${'该行业统计口径仅说明中国新能源汽车市场，不代表比亚迪公司销量或市场份额。'.repeat(5)}</p></body></html>`],
  ])
  const plugin = new CompanyPublicWebPlugin({ resolveHost, fetchImpl: async (input) => {
    const url = new URL(String(input))
    if (url.hostname === 'www.bing.com') {
      const query = url.searchParams.get('q') ?? ''
      seenQueries.push(query)
      const result = query.includes('miit.gov.cn')
        ? '<item><title>工信部 2024 新能源汽车产销数据</title><link>https://www.miit.gov.cn/gxsj/2024-nev</link><description>中国新能源汽车产量销量统计</description></item>'
        : query.includes('刀片电池')
          ? '<item><title>比亚迪科技领先</title><link>https://www.byd.com/cn/brand-center/leading-in-technology-markets</link><description>刀片电池和超级e平台技术</description></item>'
          : ''
      return new Response(`<rss><channel>${result}</channel></rss>`, { headers: { 'content-type': 'application/rss+xml' } })
    }
    if (url.hostname === 'www.sogou.com') return new Response('<html></html>')
    return new Response(bodies.get(url.href) ?? '<html><body><p>No relevant company links.</p></body></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } })
  } })
  const candidates = await plugin.discover({ company: { symbol: '002594', name: '比亚迪' }, researchPurpose: 'company_research', searchTerms: ['业务', '竞争'], limitPerKind: 8 })
  assert.ok(seenQueries.some(query => query.includes('byd.com/cn/') && query.includes('刀片电池')))
  assert.ok(seenQueries.some(query => query.includes('miit.gov.cn')))
  const focused = candidates.find(candidate => candidate.url === 'https://www.byd.com/cn/brand-center/leading-in-technology-markets')
  const industry = candidates.find(candidate => candidate.url === 'https://www.miit.gov.cn/gxsj/2024-nev')
  assert.ok(focused)
  assert.ok(industry)
  assert.equal(industry.metadata?.researchScope, 'industry_context')
  const normalized = await Promise.all([focused, industry].map(async candidate => plugin.normalize(await plugin.fetch(candidate))))
  const ids = normalized.map(source => source.candidate.candidateId)
  const productPacket = selectCompanyEvidence(normalized, ids, ['刀片电池', '超级e平台', '技术'], { purpose: 'product_technology_analysis' })
  const marketPacket = selectCompanyEvidence(normalized, ids, ['新能源汽车', '销量', '产销'], { purpose: 'market_structure_analysis' })
  const financialPacket = selectCompanyEvidence(normalized, ids, ['新能源汽车', '销量'], { purpose: 'financial_quality_analysis' })
  assert.ok(productPacket.some(packet => packet.sourceCandidateId === focused.candidateId && packet.excerpts.some(row => row.text.includes('刀片电池'))))
  assert.ok(marketPacket.some(packet => packet.sourceCandidateId === industry.candidateId && packet.evidenceScope === 'industry_context' && packet.excerpts.some(row => row.text.includes('1286.6万辆'))))
  assert.equal(financialPacket.some(packet => packet.sourceCandidateId === industry.candidateId), false)
})

test('BYD public source cap preserves portfolio, model price, delivery and China market evidence alongside named primary-source peers', async () => {
  const ieaUrl = 'https://iea.blob.core.windows.net/assets/beae65ce-6b6d-4a8b-b67a-c591093756be/GEVO2026_LaunchWebinarSlides.pdf'
  const pages = new Map([
    ['https://www.byd.com/en/about-byd', `<html><body><h1>About BYD</h1><p>${'BYD was founded in 1995 and expanded from rechargeable batteries into automobiles and new energy vehicles. '.repeat(3)}</p></body></html>`],
    ['https://www.byd.com/cn/brand-center/leading-in-technology-markets', `<html><body><h1>比亚迪科技领先</h1><p>${'比亚迪刀片电池、e平台及整车技术说明。公司介绍其技术路线与产品应用。'.repeat(4)}</p></body></html>`],
    ['https://www.byd.com/cn/dynasty-home/models', `<html><body><h1>比亚迪王朝车型</h1><p>${'比亚迪王朝网官方车型目录，展示秦、汉、唐、宋、元等车型系列及在售产品信息。'.repeat(4)}</p></body></html>`],
    ['https://www.byd.com/cn/ocean-home/models/haibao/haibao-07-dm-i', `<html><body><h1>海豹07 DM-i</h1><p>${'比亚迪海豹07 DM-i 官方车型信息，官方指导价139800元至195800元，含车型配置和产品信息。'.repeat(4)}</p></body></html>`],
    ['https://www.byd.com/cn/detail630', `<html><body><h1>比亚迪2026年上半年销量及新车发布</h1><p>${'比亚迪公司披露2026年上半年新能源汽车销量、海外乘用车及皮卡销售，并公布新车型发布和售价信息；此处为公司披露口径。'.repeat(4)}</p></body></html>`],
    ['https://www.miit.gov.cn/jgsj/zbys/qcgy/art/2026/art_4c5ed7009d21485da32b2a01abcf2819.html', `<html><body><h1>2025年12月汽车工业经济运行情况</h1><p>${'2025年中国新能源汽车产销情况由工信部发布，行业数据来自中国汽车工业协会，不代表比亚迪公司销量。'.repeat(3)}</p></body></html>`],
    [ieaUrl, '%PDF-1.6 public IEA launch slides bytes'],
    ['https://www.geelyauto.com.hk/en/press-releases/geely-auto-sales-2025', `<html><body><h1>Geely Auto Sales 2025</h1><p>${'Geely Automobile Holdings reports 2025 vehicle sales, new energy vehicle deliveries, product brands and operating performance. '.repeat(8)}</p></body></html>`],
    ['https://galaxy.geely.com/E8', `<html><body><h1>吉利银河E8 官方车型与配置</h1><p>${'吉利银河E8（Geely Galaxy E8）官方车型页面披露产品定位、纯电续航、车型版本及上市指导价，具体配置以官方配置表为准。'.repeat(8)}</p></body></html>`],
    ['https://www.catl.com/en/news/6688.html', `<html><body><h1>CATL annual results</h1><p>${'宁德时代新能源科技股份有限公司（CATL）披露动力电池产品、出货量、客户及经营情况。 '.repeat(8)}</p></body></html>`],
  ])
  const ieaText = `Global EV Outlook 2026. Electric car sales are spreading globally. Over 100 countries recorded electric car sales growth in 2025. China. Electric car sales shares. ${'Many markets are set to see a jump in sales to 2035 based on existing policies. '.repeat(2)}`
  const plugin = new CompanyPublicWebPlugin({ resolveHost, documentResolver: { parse: async input => {
    if (input.mediaType.includes('pdf')) { assert.ok(input.bytes.byteLength > 0); return { normalizedText: ieaText } as never }
    return { normalizedText: new TextDecoder().decode(input.bytes).replace(/<[^>]*>/g, ' ') } as never
  } }, fetchImpl: async input => {
    const url = new URL(String(input))
    if (url.hostname === 'www.bing.com') {
      const query = url.searchParams.get('q') ?? ''
      if (query.includes('吉利汽车') || query.includes('银河E8') || query.includes('吉利银河 新能源车型')) {
        const productQuery = query.includes('galaxy.geely.com')
        const item = productQuery
          ? '<item><title>吉利银河E8 官方车型与配置</title><link>https://galaxy.geely.com/E8</link><description>吉利银河E8 车型参数和官方指导价</description></item>'
          : '<item><title>Geely Auto Sales 2025</title><link>https://www.geelyauto.com.hk/en/press-releases/geely-auto-sales-2025</link><description>吉利汽车新能源车型和销量</description></item>'
        return new Response(`<rss><channel>${item}</channel></rss>`)
      }
      if (query.includes('宁德时代')) return new Response('<rss><channel><item><title>CATL annual results</title><link>https://www.catl.com/en/news/6688.html</link><description>宁德时代产品与经营情况</description></item></channel></rss>')
      return new Response('<rss><channel></channel></rss>')
    }
    if (url.hostname === 'www.sogou.com') return new Response('<html><body>No results</body></html>')
    if (url.href === ieaUrl) return new Response(pages.get(url.href), { headers: { 'content-type': 'application/pdf', 'content-length': '555538' } })
    return new Response(pages.get(url.href) ?? '<html><body><p>No relevant content.</p></body></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } })
  } })
  const candidates = await plugin.discover({ company: { symbol: '002594', name: '比亚迪' }, researchPurpose: 'company_research', searchTerms: ['peer:吉利汽车', 'peer:宁德时代'], limitPerKind: 6 })
  const seededUrls = [...pages.keys()]
  assert.equal(candidates.length, 6)
  for (const url of [
    'https://www.byd.com/cn/dynasty-home/models',
    'https://www.byd.com/cn/ocean-home/models/haibao/haibao-07-dm-i',
    'https://www.byd.com/cn/detail630',
    'https://www.miit.gov.cn/jgsj/zbys/qcgy/art/2026/art_4c5ed7009d21485da32b2a01abcf2819.html',
    'https://galaxy.geely.com/E8',
    'https://www.catl.com/en/news/6688.html',
  ]) assert.ok(candidates.some(candidate => candidate.url === url), `missing capped source ${url}`)
  assert.equal(candidates.some(candidate => candidate.url === 'https://www.geelyauto.com.hk/en/press-releases/geely-auto-sales-2025'), false, 'model-specific official peer evidence must outrank broad sales/mission pages')
  assert.equal(candidates.some(candidate => candidate.url === 'https://www.byd.com/en/about-byd'), false, 'supplemental company history must not displace CN market or peer evidence at the six-source cap')
  const fetched = await Promise.all(candidates.map(async candidate => plugin.normalize(await plugin.fetch(candidate))))
  assert.equal(fetched.length, 6)
  for (const source of fetched) assert.ok(source.content.length > 120)
  const ids = fetched.map(source => source.candidate.candidateId)
  const product = selectCompanyEvidence(fetched, ids, ['王朝', '海豹07', '官方指导价', '车型'], { purpose: 'product_technology_analysis' })
  const market = selectCompanyEvidence(fetched, ids, ['新能源汽车', '产销', '上半年销量', 'sales', 'deliveries'], { purpose: 'market_structure_analysis' })
  const competition = selectCompanyEvidence(fetched, ids, ['Geely', 'CATL', '银河E8', '动力电池'], { purpose: 'competitive_market_map' })
  assert.ok(product.some(packet => packet.url === 'https://www.byd.com/cn/dynasty-home/models' && packet.excerpts.some(row => row.text.includes('王朝'))))
  assert.ok(product.some(packet => packet.url === 'https://www.byd.com/cn/ocean-home/models/haibao/haibao-07-dm-i' && packet.excerpts.some(row => row.text.includes('139800'))))
  assert.ok(market.some(packet => packet.url === 'https://www.byd.com/cn/detail630' && packet.excerpts.some(row => row.text.includes('上半年'))))
  assert.ok(market.some(packet => packet.url?.includes('miit.gov.cn') && packet.evidenceScope === 'industry_context'))
  const geelyEvidence = fetched.find(source => source.candidate.url === 'https://galaxy.geely.com/E8')
  assert.equal(geelyEvidence?.candidate.metadata?.focusedPeerProduct, true)
  assert.ok(geelyEvidence?.content.includes('吉利银河E8'))
  assert.ok(geelyEvidence?.content.includes('上市指导价'))
  assert.ok(competition.some(packet => packet.url === 'https://galaxy.geely.com/E8'), 'competitive method packet should contain the selected product-specific peer source')
  assert.ok(competition.some(packet => packet.url?.includes('catl.com') && packet.excerpts.some(row => row.text.includes('宁德时代'))))
  assert.equal(candidates.some(candidate => candidate.url === ieaUrl), false, 'global IEA context must yield to first-party BYD and named-peer evidence at the six-source cap')

  const otherCompany = await plugin.discover({ company: { symbol: '002384', name: '东山精密' }, researchPurpose: 'company_research', searchTerms: ['产品'], limitPerKind: 6 })
  assert.equal(otherCompany.some(candidate => seededUrls.includes(candidate.url ?? '')), false)
})

test('industry context source requires an approved publisher host and fetched body topic match', async () => {
  const plugin = new CompanyPublicWebPlugin({ resolveHost, fetchImpl: async input => {
    const url = new URL(String(input))
    return new Response(url.hostname === 'www.caam.org.cn'
      ? `<html><body><p>${'2024年中国新能源汽车销量为1286.6万辆。统计说明。'.repeat(5)}</p></body></html>`
      : `<html><body><p>${'2024年中国新能源汽车销量为1286.6万辆。'.repeat(8)}</p></body></html>`, { headers: { 'content-type': 'text/html' } })
  } })
  const base = { candidateId: 'industry', kind: 'web_article' as const, tier: 3 as const, title: '新能源汽车销量', provider: 'public-web', metadata: { companySymbol: '002594', companyName: '比亚迪', researchScope: 'industry_context', contextTopics: ['新能源汽车', '产销'] } }
  await assert.rejects(() => plugin.normalize({ candidate: { ...base, url: 'https://untrusted.example/market' }, retrievedAt: '2026-10-19T00:00:00Z', content: `<html><body><p>${'2024年中国新能源汽车销量为1286.6万辆。'.repeat(8)}</p></body></html>`, mediaType: 'text/html' }), /INDUSTRY_CONTEXT_BODY_MISMATCH/)
  await assert.rejects(() => plugin.normalize({ candidate: { ...base, url: 'https://www.caam.org.cn/market' }, retrievedAt: '2026-10-19T00:00:00Z', content: '<html><body><p>完全无关内容'.padEnd(180, '无关') + '</p></body></html>', mediaType: 'text/html' }), /INDUSTRY_CONTEXT_BODY_MISMATCH/)
})
test('curated Geely E8 seed survives the peer cap when discovery returns the homepage and preserves model body after an official redirect', async () => {
  const productUrl = 'https://galaxy.geely.com/E8'
  const homeUrl = 'https://galaxy.geely.com/'
  const homeBody = `<html><body><h1>吉利银河车型</h1><p>全新吉利银河E8（Geely Galaxy E8）纯电轿车，上市指导价14.98万元起，CLTC续航575km及610km，具体配置见官方配置表。</p><p>${'吉利银河E8官方车型版本和车辆参数说明。'.repeat(5)}</p></body></html>`
  const plugin = new CompanyPublicWebPlugin({ resolveHost, fetchImpl: async input => {
    const url = new URL(String(input))
    if (url.hostname === 'www.bing.com') return new Response('<rss><channel><item><title>吉利银河-新能源架构造车引领者-吉利银河汽车官方网站</title><link>https://galaxy.geely.com/</link><description>吉利银河E8车型</description></item></channel></rss>')
    if (url.hostname === 'www.sogou.com') return new Response('<html><body>No results</body></html>')
    if (url.href === productUrl) return new Response(null, { status: 302, headers: { location: homeUrl } })
    return new Response(homeBody, { headers: { 'content-type': 'text/html; charset=utf-8' } })
  } })
  const candidates = await plugin.discover({ company: { symbol: '002594', name: '比亚迪' }, researchPurpose: 'company_research', searchTerms: ['peer:吉利汽车'], limitPerKind: 5 })
  assert.equal(candidates.length, 5)
  const productCandidate = candidates.find(candidate => candidate.url === productUrl)
  assert.ok(productCandidate, 'the exact official product URL must survive the four BYD core sources and the peer slot')
  assert.equal(candidates.some(candidate => candidate.url === homeUrl), false, 'the SERP homepage must not take the peer slot from the exact E8 seed')
  assert.equal(productCandidate.metadata?.focusedPeerProduct, true)
  const fetched = await plugin.fetch(productCandidate)
  const normalized = await plugin.normalize(fetched)
  assert.equal(normalized.candidate.candidateId, productCandidate.candidateId)
  assert.equal(normalized.canonicalUrl, homeUrl, 'retain the validated final URL for provenance after redirect')
  assert.equal(normalized.candidate.metadata?.focusedPeerProduct, true)
  assert.ok(normalized.content.includes('吉利银河E8'))
  assert.ok(normalized.content.includes('上市指导价'))
  assert.ok(normalized.content.includes('CLTC续航'))
  const packet = selectCompanyEvidence([normalized], [normalized.candidate.candidateId], ['吉利银河E8', '上市指导价', '续航'], { purpose: 'competitive_market_map' })
  assert.ok(packet.some(item => item.sourceCandidateId === productCandidate.candidateId && item.excerpts.some(excerpt => excerpt.text.includes('吉利银河E8') && excerpt.text.includes('上市指导价'))))
})
test('peer discovery prioritizes annual and interim filings on configured issuer and regulator domains', async () => {
  const bingQueries: string[] = []
  const body = `<html><body><h1>Tesla 2025 Annual Report</h1><p>${'Tesla reports vehicle products, deliveries, customers and operating results. '.repeat(8)}</p></body></html>`
  const plugin = new CompanyPublicWebPlugin({ resolveHost, fetchImpl: async (input) => {
    const url = new URL(String(input))
    if (url.hostname === 'www.bing.com') {
      const query = url.searchParams.get('q')!
      bingQueries.push(query)
      const primary = /site:(?:ir\.tesla\.com|sec\.gov)/.test(query)
      const host = primary ? 'ir.tesla.com' : 'secondary.example'
      const title = primary ? 'Tesla 2025 Annual Report' : 'Tesla market comparison article'
      return new Response(`<rss><channel><item><title>${title}</title><link>https://${host}/research</link><description>Tesla product and company information</description></item></channel></rss>`)
    }
    if (url.hostname === 'www.sogou.com') return new Response('<html><body>No results</body></html>')
    return new Response(body, { headers: { 'content-type': 'text/html' } })
  } })
  const candidates = await plugin.discover({ company: { symbol: '002384', name: '东山精密' }, researchPurpose: 'company_research', searchTerms: ['peer:特斯拉'], limitPerKind: 1 })
  assert.ok(bingQueries.some(query => query.includes('annual report') && query.includes('site:ir.tesla.com')))
  assert.ok(bingQueries.some(query => query.includes('quarterly report') && query.includes('site:ir.tesla.com')))
  assert.ok(bingQueries.some(query => query.includes('site:sec.gov')))
  assert.ok(bingQueries.some(query => query.includes('"TSLA"') || query.includes('TSLA')))
  assert.equal(candidates.length, 1)
  assert.equal(new URL(candidates[0]!.url!).hostname, 'ir.tesla.com')
  assert.equal(candidates[0]?.metadata?.researchSubject, 'peer_company')
  assert.equal(candidates[0]?.snippet, undefined)
})
test('CATL peer discovery is identity-bound to official issuer and regulator domains', async () => {
  const queries: string[] = []
  const body = `<html><body><h1>宁德时代 2025年度报告</h1><p>${'宁德时代新能源科技股份有限公司 300750.SZ CATL 动力电池装机 产品经营情况。 '.repeat(8)}</p></body></html>`
  const plugin = new CompanyPublicWebPlugin({ resolveHost, fetchImpl: async input => {
    const url = new URL(String(input))
    if (url.hostname === 'www.bing.com') {
      const query = url.searchParams.get('q')!
      queries.push(query)
      const official = /site:(?:catl\.com|cninfo\.com\.cn)/.test(query)
      return new Response(`<rss><channel><item><title>宁德时代 2025 年度报告</title><link>https://${official ? 'www.cninfo.com.cn' : 'secondary.example'}/report</link><description>动力电池年度报告</description></item></channel></rss>`)
    }
    if (url.hostname === 'www.sogou.com') return new Response('<html><body>No results</body></html>')
    return new Response(body, { headers: { 'content-type': 'text/html' } })
  } })
  const candidates = await plugin.discover({ company: { symbol: '002384', name: '东山精密' }, researchPurpose: 'company_research', searchTerms: ['peer:宁德时代'], limitPerKind: 1 })
  assert.ok(queries.some(query => query.includes('site:catl.com')))
  assert.ok(queries.some(query => query.includes('site:cninfo.com.cn')))
  assert.ok(queries.some(query => query.includes('300750')))
  assert.equal(candidates.length, 1)
  assert.equal(new URL(candidates[0]!.url!).hostname, 'www.cninfo.com.cn')
  assert.equal(candidates[0]?.metadata?.researchSubject, 'peer_company')
})
test('empty peer searches expose per-query diagnostics without treating snippets as evidence', async () => {
  const plugin = new CompanyPublicWebPlugin({ resolveHost, fetchImpl: async (input) => new URL(String(input)).hostname === 'www.bing.com' ? new Response('<rss><channel></channel></rss>') : new Response('<html><body>No matching results</body></html>') })
  await assert.rejects(() => plugin.discover({ company: { symbol: '002384', name: '东山精密' }, researchPurpose: 'company_research', searchTerms: ['peer:鹏鼎控股'], limitPerKind: 6 }), error => {
    assert.match(String(error), /PUBLIC_WEB_PEER_DISCOVERY_EMPTY/)
    assert.match(String(error), /"stage":"discovered"/)
    assert.match(String(error), /"resultCount":0/)
    assert.match(String(error), /002938/)
    return true
  })
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
test('competition gap retries reserve a distinct public search query for named product and customer comparisons', async () => {
  const sogouQueries: string[] = []
  const plugin = new CompanyPublicWebPlugin({ resolveHost, fetchImpl: async (input) => {
    const url = new URL(String(input))
    if (url.hostname === 'www.bing.com') return new Response('<rss><channel></channel></rss>')
    if (url.pathname === '/web') {
      sogouQueries.push(url.searchParams.get('query') ?? '')
      return new Response('<h3><a href="/link?url=token">东山精密行业竞争对比</a></h3><div>具名产品与客户比较</div>')
    }
    return new Response('<html><body>No directories</body></html>')
  } })
  const candidates = await plugin.discover({ company: { symbol: '002384', name: '东山精密' }, researchPurpose: 'company_research', searchTerms: ['竞争', '竞争', '份额'], limitPerKind: 4 })
  assert.ok(sogouQueries.some(query => query.includes('竞争对手 产品 应用 客户 技术 成本 对比')))
  assert.equal(new Set(sogouQueries).size, sogouQueries.length)
  assert.ok(candidates.some(candidate => candidate.title.includes('竞争对比')))
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
    await assert.rejects(() => plugin.discover({ company: { symbol: '002596', name: '测试公司' }, researchPurpose: 'company_research', searchTerms: ['行业竞争'] }), /DISCOVERY_FAILED/)
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


test('HTML charset decoding supports explicit GBK bytes, header precedence and original Raw provenance', async () => {
  const ascii=new TextEncoder()
  const opening=ascii.encode('<html><meta charset="gbk"><body>')
  const closing=ascii.encode('</body></html>')
  const body=Uint8Array.from(Array.from({length:100},()=>[0xd6,0xd0,0xce,0xc4]).flat())
  const bytes=new Uint8Array([...opening,...body,...closing])
  assert.match(decodeCompanyPublicHtml(bytes,'text/html'),/中文/)
  assert.match(decodeCompanyPublicHtml(bytes,'text/html; charset=GB2312'),/中文/)
  assert.throws(()=>decodeCompanyPublicHtml(bytes,'text/html; charset=utf-8'),/INVALID_TEXT_ENCODING/,'HTTP charset takes precedence over HTML meta')
  assert.throws(()=>decodeCompanyPublicHtml(bytes,'text/html; charset=utf-7'),/UNSUPPORTED_CHARSET/)
  assert.equal(decodeCompanyPublicHtml(ascii.encode('中文网页'),'text/html'),'中文网页')
  assert.equal(decodeCompanyPublicHtml(ascii.encode('<meta name="description" content="Old documentation mentions charset=gbk">中文网页'),'text/html'),'<meta name="description" content="Old documentation mentions charset=gbk">中文网页')
  const legacyHttpEquiv = new Uint8Array([...ascii.encode('<meta content="text/html; charset=GB2312" http-equiv="Content-Type"><p>'),...body,...ascii.encode('</p>')])
  assert.match(decodeCompanyPublicHtml(legacyHttpEquiv,'text/html'),/中文/)
  const plugin=new CompanyPublicWebPlugin({resolveHost,fetchImpl:async()=>new Response(bytes,{headers:{'content-type':'text/html; charset=gbk'}})})
  const fetched=await plugin.fetch(candidate)
  assert.match(fetched.content,/中文/)
  const normalized=await plugin.normalize(fetched)
  assert.ok(normalized.content.includes('中文'.repeat(80)))
  assert.deepEqual(normalized.rawBytes,bytes,'Raw archive retains original GBK bytes, not transcoded parser input')
})
