import assert from 'node:assert/strict'
import test from 'node:test'
import { createKnowledgeServer } from '../../../tests/knowledge/serve.ts'
import { ensureRealKnowledgeBase, realKnowledgeBaseRoot } from '../../../tools/knowledge-product-validation/runtime.ts'
import { loadLocalRuntimeConfig } from '../../../dsh/llm-runtime/local-runtime-config.ts'

test('real frontend selection accepts an explicit external Knowledge Base root', async () => {
  const config = loadLocalRuntimeConfig({ RESEARCHHUB_REAL_LLM_ENABLED: 'false' }, process.cwd())
  const root = await ensureRealKnowledgeBase(config)
  assert.equal(root, realKnowledgeBaseRoot(config))
  const server = createKnowledgeServer(process.cwd(), root)
  await new Promise<void>((resolve) => server.listen(0, resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/knowledge-bases/${config.knowledgeBaseId}/directory`)
    assert.equal(response.status, 200)
    const envelope = await response.json() as { knowledgeBaseId: string }
    assert.equal(envelope.knowledgeBaseId, config.knowledgeBaseId)
    const page = await fetch(`http://127.0.0.1:${address.port}/tests/knowledge/index.html`)
    assert.equal(page.status, 200)
    assert.match(await page.text(), new RegExp(`const KNOWLEDGE_BASE_ID = '${config.knowledgeBaseId}'`))
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) }
})
