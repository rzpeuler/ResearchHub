import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createKnowledgeServer } from '../serve.ts'

test('Knowledge HTTP endpoints return production projections', async () => {
  const server = createKnowledgeServer()
  await new Promise<void>((resolve) => server.listen(0, resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const baseUrl = `http://127.0.0.1:${address.port}`
  try {
    const directoryResponse = await fetch(`${baseUrl}/api/knowledge/directory`)
    assert.equal(directoryResponse.status, 200)
    const directory = await directoryResponse.json() as { industries: Array<{ id: string; graphs: Array<{ id: string }> }> }
    assert.equal(directory.industries.length, 31)
    assert.ok(directory.industries.find((industry) => industry.id === 'sw:electronics')?.graphs.some((graph) => graph.id === 'industry:ai-hardware'))

    const graphResponse = await fetch(`${baseUrl}/api/knowledge/graph/${encodeURIComponent('industry:ai-hardware')}`)
    assert.equal(graphResponse.status, 200)
    const graph = await graphResponse.json() as { root: { id: string; name: string }; children: Array<{ id: string; name: string }>; relations: Array<{ source: string; target: string }> }
    assert.equal(graph.root.id, 'industry:ai-hardware')
    assert.equal(graph.root.name, 'AI 硬件')
    assert.ok(graph.children.some((child) => child.id === 'segment:gpu'))
    assert.ok(graph.relations.every((relation) => relation.source && relation.target))

    const entityResponse = await fetch(`${baseUrl}/api/knowledge/entity/${encodeURIComponent('segment:gpu')}`)
    assert.equal(entityResponse.status, 200)
    const entity = await entityResponse.json() as { entity: { id: string }; modules: Array<{ columns: string[] }>; relatedCompanies: Array<{ company: { id: string } }>; companyScale?: { entries: Array<{ company: { id: string }; revenue: number; period: string; unit: string; sourceRefs: string[] }> }; viewSections: string[] }
    assert.equal(entity.entity.id, 'segment:gpu')
    assert.deepEqual(entity.modules[0]?.columns, ['产品', '厂商', '工作负载', '架构代际'])
    assert.deepEqual(entity.relatedCompanies.map(({ company }) => company.id), ['company:amd', 'company:nvidia'])
    assert.deepEqual(entity.companyScale?.entries.map(({ company, revenue }) => ({ company: company.id, revenue })), [
      { company: 'company:nvidia', revenue: 130.5 },
      { company: 'company:amd', revenue: 34.6 },
    ])
    assert.ok(entity.viewSections.includes('company-scale'))
    assert.ok(!entity.viewSections.includes('market-share'))

    const missingResponse = await fetch(`${baseUrl}/api/knowledge/entity/${encodeURIComponent('segment:missing')}`)
    assert.equal(missingResponse.status, 404)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})

test('production page does not reference legacy JSON or mock presentation language', async () => {
  const html = await readFile(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8')
  assert.doesNotMatch(html, /industry-graph\.json|industry-directory\.json/i)
  assert.doesNotMatch(html, /prototype only|prototype|mock-index|mock data|mock forecast|暂无 mock/i)
  assert.doesNotMatch(html, /marketShare|market-share|market share|市场份额|totalRevenue|segmentRevenue/i)
  assert.match(html, /公司规模|公司总营收|卡片面积按同口径公司总营收/)
  assert.match(html, /entry\.period === first\.period && entry\.unit === first\.unit/)
  assert.match(html, /Math\.sqrt\(/)
  assert.match(html, /当前总营收期间或单位不可直接比较，卡片按等权展示/)
  assert.match(html, /AI 硬件/)
})
