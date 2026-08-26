import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createKnowledgeServer } from '../serve.ts'

const knowledgeBaseId = 'example-ai-hardware'

test('Knowledge HTTP endpoints return production projections', async () => {
  const server = createKnowledgeServer()
  await new Promise<void>((resolve) => server.listen(0, resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const baseUrl = `http://127.0.0.1:${address.port}`
  try {
    const directoryPage = await fetch(`${baseUrl}/tests/knowledge/`)
    assert.equal(directoryPage.status, 200)
    assert.match(await directoryPage.text(), /<!doctype html>/i)

    const directoryResponse = await fetch(`${baseUrl}/api/knowledge-bases/${knowledgeBaseId}/directory`)
    assert.equal(directoryResponse.status, 200)
    const directoryEnvelope = await directoryResponse.json() as { knowledgeBaseId: string; revision: number; data: { industries: Array<{ id: string; graphs: Array<{ id: string }> }> } }
    assert.equal(directoryEnvelope.knowledgeBaseId, knowledgeBaseId)
    const directory = directoryEnvelope.data
    assert.equal(directory.industries.length, 31)
    assert.ok(directory.industries.find((industry) => industry.id === 'sw:electronics')?.graphs.some((graph) => graph.id === 'industry:ai-hardware'))

    const graphResponse = await fetch(`${baseUrl}/api/knowledge-bases/${knowledgeBaseId}/graph/${encodeURIComponent('industry:ai-hardware')}`)
    assert.equal(graphResponse.status, 200)
    const graphEnvelope = await graphResponse.json() as { knowledgeBaseId: string; revision: number; data: { root: { id: string; name: string }; children: Array<{ id: string; name: string; scaleInput?: unknown }>; relations: Array<{ source: string; target: string }> } }
    assert.equal(graphEnvelope.knowledgeBaseId, knowledgeBaseId)
    const graph = graphEnvelope.data
    assert.equal(graph.root.id, 'industry:ai-hardware')
    assert.equal(graph.root.name, 'AI 硬件')
    assert.ok(graph.children.some((child) => child.id === 'segment:gpu'))
    assert.ok(graph.children.every((child) => child.scaleInput === undefined))
    assert.ok(graph.relations.every((relation) => relation.source && relation.target))

    const entityResponse = await fetch(`${baseUrl}/api/knowledge-bases/${knowledgeBaseId}/entity/${encodeURIComponent('segment:gpu')}`)
    assert.equal(entityResponse.status, 200)
    const entityEnvelope = await entityResponse.json() as { knowledgeBaseId: string; revision: number; data: { entity: { id: string }; modules: Array<{ columns: string[] }>; relatedCompanies: Array<{ company: { id: string } }>; companyScale?: { entries: Array<{ company: { id: string }; revenue: number; period: string; unit: string; sourceRefs: string[] }> }; viewSections: string[] } }
    assert.equal(entityEnvelope.knowledgeBaseId, knowledgeBaseId)
    const entity = entityEnvelope.data
    assert.equal(entity.entity.id, 'segment:gpu')
    assert.deepEqual(entity.modules[0]?.columns, ['产品', '厂商', '工作负载', '架构代际'])
    assert.deepEqual(entity.relatedCompanies.map(({ company }) => company.id), ['company:amd', 'company:nvidia'])
    assert.deepEqual(entity.companyScale?.entries.map(({ company, revenue }) => ({ company: company.id, revenue })), [
      { company: 'company:nvidia', revenue: 130.5 },
      { company: 'company:amd', revenue: 34.6 },
    ])
    assert.ok(entity.viewSections.includes('company-scale'))
    assert.ok(!entity.viewSections.includes('market-share'))

    const missingResponse = await fetch(`${baseUrl}/api/knowledge-bases/${knowledgeBaseId}/entity/${encodeURIComponent('segment:missing')}`)
    assert.equal(missingResponse.status, 404)
    const legacyResponse = await fetch(`${baseUrl}/api/knowledge/entity/${encodeURIComponent('segment:gpu')}`)
    assert.equal(legacyResponse.status, 404)
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
  assert.match(html, /scaleInput/)
  assert.match(html, /node-scale/)
  assert.match(html, /当前同层暂无可用市场规模数据，节点按等权展示/)
  assert.match(html, /节点面积按同口径已披露市场规模相对缩放/)
  assert.match(html, /当前同层市场规模期间或单位不可直接比较，节点按等权展示/)
  assert.match(html, /input\.period === firstScaleInput\.period && input\.unit === firstScaleInput\.unit/)
  assert.doesNotMatch(html, /marketShare|market-share|market share|市场份额|percentage|marketSharePercent/i)
  assert.match(html, /AI 硬件/)
})
