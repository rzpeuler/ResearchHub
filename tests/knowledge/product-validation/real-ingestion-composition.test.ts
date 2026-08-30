import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { createRealKnowledgeCurationModel } from '../../../tools/knowledge-product-validation/deepseek-composition.ts'
import { loadLocalRuntimeConfig } from '../../../dsh/llm-runtime/local-runtime-config.ts'
import { STRUCTURED_OUTPUT_CONTRACTS } from '../../../packages/skills/knowledge-curation/contracts.ts'
import { buildCurationSchemaContext } from '../../../packages/skills/knowledge-curation/schema-context.ts'

test('real curation composition stays provider-neutral at the Skill boundary with an injected fixture runtime', async () => {
  let request: GenerateOptions | undefined
  const llm = { async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> { request = options; yield { type: 'text-delta', index: 0, text: '{"decision":"admit"}' }; yield { type: 'finish', reason: { kind: 'stop' } } } }
  const config = loadLocalRuntimeConfig({ RESEARCHHUB_REAL_LLM_ENABLED: 'false', RESEARCHHUB_LLM_PROVIDER: 'deepseek-official', RESEARCHHUB_LLM_MODEL: 'fixture-model' }, process.cwd())
  const runtime = await createRealKnowledgeCurationModel(config, llm)
  try {
    const value = await runtime.model.invoke({ operation: 'understandReport', instruction: 'Return JSON.', input: { fixture: true }, schemaContext: buildCurationSchemaContext('report_understanding'), outputContract: STRUCTURED_OUTPUT_CONTRACTS.understandReport })
    assert.deepEqual(value, { decision: 'admit' })
    assert.equal(request?.provider, 'deepseek-official')
    assert.equal(request?.model, 'fixture-model')
  } finally { await runtime.close() }
})

test('official DeepSeek provider composition reaches a local streaming server without internet', async () => {
  const requests: Array<{ authorization: string | null; model: string; prompt: string }> = []
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    const payload = JSON.parse(body) as { model: string; messages: Array<{ content: string | Array<{ type: string; text?: string }> }> }
    const content = payload.messages[0]?.content
    const prompt = typeof content === 'string' ? content : content?.[0]?.text ?? ''
    requests.push({ authorization: request.headers.authorization ?? null, model: payload.model, prompt })
    response.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'Cache-Control': 'no-cache' })
    response.end('data: {"choices":[{"delta":{"content":"{\\"decision\\":\\"admit\\"}"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const previousKey = process.env.DEEPSEEK_API_KEY
  const previousFlag = process.env.RESEARCHHUB_REAL_LLM_ENABLED
  process.env.DEEPSEEK_API_KEY = 'test-only-fake-key'
  process.env.RESEARCHHUB_REAL_LLM_ENABLED = 'true'
  const config = loadLocalRuntimeConfig({ RESEARCHHUB_REAL_LLM_ENABLED: 'true', DEEPSEEK_API_KEY: 'test-only-fake-key', DEEPSEEK_BASE_URL: `http://127.0.0.1:${address.port}`, RESEARCHHUB_LLM_PROVIDER: 'deepseek-official', RESEARCHHUB_LLM_MODEL: 'fixture-model' }, process.cwd(), { requireRealLlm: true })
  const runtime = await createRealKnowledgeCurationModel(config)
  try {
    const value = await runtime.model.invoke({ operation: 'understandReport', instruction: 'Return report understanding JSON.', input: { fixture: true }, schemaContext: buildCurationSchemaContext('report_understanding'), outputContract: STRUCTURED_OUTPUT_CONTRACTS.understandReport })
    assert.deepEqual(value, { decision: 'admit' })
    assert.deepEqual(requests.map(({ authorization, model }) => ({ authorization, model })), [{ authorization: 'Bearer test-only-fake-key', model: 'fixture-model' }])
    assert.match(requests[0]?.prompt ?? '', /understandReport/)
  } finally {
    await runtime.close()
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = previousKey
    if (previousFlag === undefined) delete process.env.RESEARCHHUB_REAL_LLM_ENABLED
    else process.env.RESEARCHHUB_REAL_LLM_ENABLED = previousFlag
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})

test('real product-validation composition has no AgentLoop or TestKit imports', async () => {
  const source = await readFile(new URL('../../../tools/knowledge-product-validation/deepseek-composition.ts', import.meta.url), 'utf8')
  for (const forbidden of ['dsh-agent-loop-testkit', 'dsh-agent-loop', 'dsh-agent', 'dsh-session', 'dsh-tools', 'dsh-system-prompt']) assert.doesNotMatch(source, new RegExp(forbidden))
})
