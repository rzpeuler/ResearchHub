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
    const graph = await graphResponse.json() as { root: { id: string }; children: Array<{ id: string }>; relations: Array<{ source: string; target: string }> }
    assert.equal(graph.root.id, 'industry:ai-hardware')
    assert.ok(graph.children.some((child) => child.id === 'segment:gpu'))
    assert.ok(graph.relations.every((relation) => relation.source && relation.target))

    const entityResponse = await fetch(`${baseUrl}/api/knowledge/entity/${encodeURIComponent('segment:gpu')}`)
    assert.equal(entityResponse.status, 200)
    const entity = await entityResponse.json() as { entity: { id: string }; modules: Array<{ columns: string[] }>; relatedCompanies: Array<{ company: { id: string } }> }
    assert.equal(entity.entity.id, 'segment:gpu')
    assert.deepEqual(entity.modules[0]?.columns, ['product', 'vendor', 'workload', 'architectureGeneration'])
    assert.deepEqual(entity.relatedCompanies.map(({ company }) => company.id), ['company:amd', 'company:nvidia'])

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
})
