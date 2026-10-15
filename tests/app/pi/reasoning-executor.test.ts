import test from 'node:test'
import assert from 'node:assert/strict'
import type { Api, AssistantMessage, Context, Model, JsonObject } from '@earendil-works/pi-ai'
import { PiReasoningExecutor } from '../../../plugins/reasoning/pi/executor.ts'
import { ReasoningExecutorError } from '../../../plugins/reasoning/errors.ts'

const capabilities = { maxContextTokens: 4_000, maxOutputTokens: 1_000, structuredOutputSupport: true, maxConcurrency: 1 }

test('PiReasoningExecutor defaults and model-derived capabilities allow four-way extraction', async () => {
  const defaultExecutor = new PiReasoningExecutor({ completion: async () => '{"ok":true}' })
  assert.equal(defaultExecutor.capabilities().maxConcurrency, 4)

  const model = fixtureModel()
  const derivedExecutor = new PiReasoningExecutor({ model, completion: async () => '{"ok":true}' })
  assert.equal(derivedExecutor.capabilities().maxConcurrency, 4)
})

test('PiReasoningExecutor completes an isolated semantic call and preserves metadata', async () => {
  const observed: Array<{ systemPrompt?: string; message: string; metadata: Record<string, unknown> }> = []
  const executor = new PiReasoningExecutor({
    capabilities,
    completion: async (_model, context, options) => {
      const message = context.messages[0]
      assert.ok(message && typeof message.content === 'string')
      observed.push({ systemPrompt: context.systemPrompt, message: message.content, metadata: options.metadata })
      return JSON.stringify({ ok: true })
    },
  })

  const result = await executor.execute({
    operation: 'understandAndPlan',
    instruction: 'understand this fixture',
    input: { fixture: 'alpha' },
    outputContract: { type: 'object', required: ['ok'] },
    metadata: { executionId: 'pi-test-001', traceId: 'trace-001' },
  })

  assert.deepEqual(result.output, { ok: true })
  assert.equal(result.rawOutput, '{"ok":true}')
  assert.equal(result.operationId, 'pi-test-001')
  assert.equal(observed[0]?.metadata.executionId, 'pi-test-001')
  assert.equal(observed[0]?.metadata.traceId, 'trace-001')
  assert.equal(observed[0]?.metadata.operation, 'understandAndPlan')
})

test('PiReasoningExecutor parses fenced structured JSON for all three operations', async () => {
  const operations = ['understandAndPlan', 'extractKnowledge', 'resolveSemanticCase'] as const
  const executor = new PiReasoningExecutor({
    capabilities,
    completion: async (_model, context) => {
      const content = context.messages[0]?.content
      assert.equal(typeof content, 'string')
      const parsed = JSON.parse(content as string) as { operationId: string }
      return `\`\`\`json\n{"operationId":"${parsed.operationId}"}\n\`\`\``
    },
  })

  for (const operation of operations) {
    const result = await executor.execute({ operation, instruction: operation, input: {}, outputContract: {} })
    assert.equal((result.output as { operationId: string }).operationId, result.operationId)
  }
})

test('PiReasoningExecutor fails closed when parsed JSON violates a JSON Schema output contract', async () => {
  const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false }
  const valid = new PiReasoningExecutor({ capabilities, completion: async () => '{"ok":true}' })
  assert.deepEqual((await valid.execute({ operation: 'extractKnowledge', instruction: 'valid', input: {}, outputContract: schema })).output, { ok: true })

  const invalid = new PiReasoningExecutor({ capabilities, completion: async () => '{"other":true}' })
  await assert.rejects(
    () => invalid.execute({ operation: 'extractKnowledge', instruction: 'invalid schema result', input: {}, outputContract: schema }),
    (error: unknown) => error instanceof ReasoningExecutorError && error.code === 'reasoning_output_invalid',
  )
})

test('PiReasoningExecutor maps completion failures, invalid JSON, and timeout to typed errors', async () => {
  const failure = new PiReasoningExecutor({ capabilities, completion: async () => { throw new Error('fixture failure') } })
  await assert.rejects(
    () => failure.execute({ operation: 'extractKnowledge', instruction: 'fail', input: {}, outputContract: {} }),
    (error: unknown) => error instanceof ReasoningExecutorError && error.code === 'reasoning_execution_failed' && error.operation === 'extractKnowledge',
  )

  const invalidJson = new PiReasoningExecutor({ capabilities, completion: async () => 'not-json' })
  await assert.rejects(
    () => invalidJson.execute({ operation: 'resolveSemanticCase', instruction: 'invalid', input: {}, outputContract: {} }),
    (error: unknown) => error instanceof ReasoningExecutorError && error.code === 'reasoning_output_invalid',
  )

  const timeout = new PiReasoningExecutor({
    capabilities,
    timeoutMs: 15,
    completion: async (_model, _context, options) => new Promise<string>((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }),
  })
  await assert.rejects(
    () => timeout.execute({ operation: 'resolveSemanticCase', instruction: 'sleep', input: {}, outputContract: {} }),
    (error: unknown) => error instanceof ReasoningExecutorError && error.code === 'reasoning_timeout',
  )
})

test('PiReasoningExecutor propagates an external cancellation signal to Pi completion', async () => {
  const controller = new AbortController()
  const executor = new PiReasoningExecutor({
    capabilities,
    completion: async (_model, _context, options) => new Promise<string>((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }),
  })
  const pending = executor.execute({ operation: 'extractKnowledge', instruction: 'cancel', input: {}, outputContract: {} }, controller.signal)
  controller.abort()
  await assert.rejects(() => pending, (error: unknown) => error instanceof ReasoningExecutorError && error.message.includes('cancelled'))
})

test('PiReasoningExecutor keeps concurrent calls isolated and supports injected runtime/model', async () => {
  const model = { id: 'fixture-model', name: 'Fixture Model', provider: 'fixture', api: 'fixture-api', baseUrl: 'fixture://model', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8_000, maxTokens: 500 } as unknown as Model<Api>
  const calls: Array<{ operation: string; input: string; model: Model<Api> }> = []
  const runtime = {
    getModels: () => [model],
    complete: async (selectedModel: Model<Api>, context: Context) => {
      const content = context.messages[0]?.content
      assert.equal(typeof content, 'string')
      calls.push({ operation: JSON.parse(content as string).operationId, input: content as string, model: selectedModel })
      return assistantMessage('{"ok":true}')
    },
  }
  const executor = new PiReasoningExecutor({ modelRuntime: runtime, capabilities })
  const [first, second] = await Promise.all([
    executor.execute({ operation: 'extractKnowledge', instruction: 'first', input: { value: 1 }, outputContract: {} }),
    executor.execute({ operation: 'resolveSemanticCase', instruction: 'second', input: { value: 2 }, outputContract: {} }),
  ])

  assert.deepEqual(first.output, { ok: true })
  assert.deepEqual(second.output, { ok: true })
  assert.equal(calls.length, 2)
  assert.equal(calls[0]?.model, model)
  assert.notEqual(calls[0]?.operation, calls[1]?.operation)
  assert.match(calls[0]?.input ?? '', /"value":1/)
  assert.match(calls[1]?.input ?? '', /"value":2/)
  assert.equal(executor.capabilities().maxContextTokens, 4_000)
})

test('Pi Skill and project context do not leak into Workflow semantic calls', async () => {
  let received = ''
  const executor = new PiReasoningExecutor({
    capabilities,
    completion: async (_model, context) => {
      received = `${context.systemPrompt}\n${String(context.messages[0]?.content ?? '')}`
      return '{"isolated":true}'
    },
  })
  await executor.execute({ operation: 'extractKnowledge', instruction: 'extract fixture', input: { value: 'only-request-input' }, outputContract: { type: 'object' } })
  assert.doesNotMatch(received, /AGENTS\.md|Pi Skill|SKILL\.md|project context/i)
  assert.match(received, /only-request-input/)
})

const resultSchema = { type: 'object', additionalProperties: false, required: ['answer', 'findings'], properties: { answer: { type: 'string' }, findings: { type: 'array', items: { type: 'string' } } } }
function resultToolMessage(name: string, argumentsValue: JsonObject, count = 1): AssistantMessage {
  return { ...assistantMessage(''), content: Array.from({ length: count }, (_, index) => ({ type: 'toolCall' as const, id: `result-${index}`, name, arguments: argumentsValue })), stopReason: 'toolUse' }
}

test('scoped schema tool output sends exact contract with strict-prefer sampling and serializes result arguments', async () => {
  const value = { answer: 'Evidence-backed answer', findings: ['Finding one'] }
  const executor = new PiReasoningExecutor({ capabilities, schemaToolOutput: true, completion: async (_model, context, options) => {
    assert.equal(context.tools?.length, 1)
    assert.equal(context.tools?.[0]?.name, 'submit_research_result')
    assert.deepEqual(context.tools?.[0]?.parameters, resultSchema)
    assert.deepEqual(context.tools?.[0]?.constrainedSampling, { type: 'json_schema', strict: 'prefer' })
    assert.match(context.systemPrompt ?? '', /submit_research_result exactly once/)
    assert.equal(options.outputContract, resultSchema)
    return resultToolMessage('submit_research_result', value)
  } })
  const result = await executor.execute({ operation: 'company_research_method', instruction: 'Return evidence analysis', input: {}, outputContract: resultSchema })
  assert.deepEqual(result.output, value)
  assert.equal(result.rawOutput, JSON.stringify(value))
})

test('schema result transport rejects unknown and multiple tools instead of executing them', async () => {
  for (const response of [resultToolMessage('write_file', { answer: 'No mutation', findings: [] }), resultToolMessage('submit_research_result', { answer: 'Repeated result', findings: [] }, 2)]) {
    const executor = new PiReasoningExecutor({ capabilities, schemaToolOutput: true, completion: async () => response })
    await assert.rejects(() => executor.execute({ operation: 'company_research_method', instruction: 'Return evidence analysis', input: {}, outputContract: resultSchema }), (error: unknown) => error instanceof ReasoningExecutorError && error.code === 'reasoning_output_invalid' && /unexpected structured result tool/.test(error.message))
  }
})

test('schema tool arguments are locally validated with actionable missing-field diagnostics for repair', async () => {
  const invalidEvents: { rawOutput: string; reason: string }[] = []
  const executor = new PiReasoningExecutor({ capabilities, schemaToolOutput: true, completion: async () => resultToolMessage('submit_research_result', { findings: [] }), onInvalidOutput: (event) => { invalidEvents.push(event) } })
  await assert.rejects(() => executor.execute({ operation: 'company_research_method', instruction: 'Return evidence analysis', input: {}, outputContract: resultSchema }), (error: unknown) => error instanceof ReasoningExecutorError && error.code === 'reasoning_output_invalid' && /required property.*answer/.test(error.message))
  assert.equal(invalidEvents.length, 1)
  assert.equal(invalidEvents[0]?.rawOutput, '{"findings":[]}')
  assert.match(invalidEvents[0]?.reason ?? '', /answer/)
  const wrongType = new PiReasoningExecutor({ capabilities, schemaToolOutput: true, completion: async () => resultToolMessage('submit_research_result', { answer: 'Answer', findings: 'Not an array' }) })
  await assert.rejects(() => wrongType.execute({ operation: 'company_research_method', instruction: 'Return evidence analysis', input: {}, outputContract: resultSchema }), (error: unknown) => error instanceof ReasoningExecutorError && error.code === 'reasoning_output_invalid' && /\/findings.*array/.test(error.message))
})

test('disabled scoped tool output keeps legacy text JSON and does not attach transport tools', async () => {
  const executor = new PiReasoningExecutor({ capabilities, schemaToolOutput: false, completion: async (_model, context) => { assert.equal(context.tools, undefined); return '{"answer":"Legacy JSON","findings":[]}' } })
  const result = await executor.execute({ operation: 'extractKnowledge', instruction: 'Legacy execution', input: {}, outputContract: resultSchema })
  assert.deepEqual(result.output, { answer: 'Legacy JSON', findings: [] })
})

test('scoped transport unwraps a valid schema wrapper and retains prose-contract compatibility', async () => {
  const wrapper = { format: 'json', root: 'object', additionalProperties: false, schema: resultSchema }
  const wrapped = new PiReasoningExecutor({ capabilities, schemaToolOutput: true, completion: async (_model, context) => { assert.deepEqual(context.tools?.[0]?.parameters, resultSchema); return resultToolMessage('submit_research_result', { answer: 'Wrapped', findings: [] }) } })
  assert.deepEqual((await wrapped.execute({ operation: 'company_research_method', instruction: 'Wrapped result', input: {}, outputContract: wrapper })).output, { answer: 'Wrapped', findings: [] })
  const prose = new PiReasoningExecutor({ capabilities, schemaToolOutput: true, completion: async (_model, context) => { assert.equal(context.tools, undefined); return '{"legacy":true}' } })
  assert.deepEqual((await prose.execute({ operation: 'extractKnowledge', instruction: 'Legacy prose contract', input: {}, outputContract: { sections: 'Nineteen sections' } })).output, { legacy: true })
})

function assistantMessage(text: string): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'fixture-api',
    provider: 'fixture',
    model: 'fixture-model',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    stopReason: 'stop',
    timestamp: Date.now(),
  } as AssistantMessage
}

function fixtureModel(): Model<Api> {
  return { id: 'fixture-model', name: 'Fixture Model', provider: 'fixture', api: 'fixture-api', baseUrl: 'fixture://model', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8_000, maxTokens: 500 } as unknown as Model<Api>
}
