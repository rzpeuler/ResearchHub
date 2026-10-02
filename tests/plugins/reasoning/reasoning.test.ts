import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { MockReasoningExecutor } from '../../../plugins/reasoning/mock/executor.ts'
import { PiReasoningExecutor } from '../../../plugins/reasoning/pi/executor.ts'
import { ReasoningExecutorError } from '../../../plugins/reasoning/errors.ts'
import { buildCodexInvocationArgs, CodexReasoningExecutor } from '../../../plugins/reasoning/codex/executor.ts'
import { REASONING_OPERATIONS } from '../../../plugins/reasoning/contracts.ts'
import type { Context } from '@earendil-works/pi-ai'

const capabilities = { maxContextTokens: 1000, maxOutputTokens: 500, structuredOutputSupport: false, maxConcurrency: 1 }

test('shared reasoning contract includes Industry operations and the narrow workspace classification operation', () => {
  assert.equal(REASONING_OPERATIONS.includes('theme_workspace_section_classification'), true)
  for (const operation of ['industry_research_design', 'industry_module_analysis', 'industry_cross_module_synthesis']) assert.equal(REASONING_OPERATIONS.includes(operation as never), true)
  for (const operation of ['understandAndPlan', 'extractKnowledge', 'resolveSemanticCase', 'company_research_synthesis', 'thesis_red_team_synthesis', 'management_communication_extract']) assert.equal(REASONING_OPERATIONS.includes(operation as never), true)
})

test('MockReasoningExecutor records calls and returns deterministic operation responses', async () => {
  const executor = new MockReasoningExecutor({ capabilities, responses: { understandAndPlan: { ok: true } } })
  const result = await executor.execute({ operation: 'understandAndPlan', instruction: 'test', input: { value: 1 }, outputContract: { type: 'object' } })
  assert.deepEqual(result.output, { ok: true })
  assert.equal(executor.calls.length, 1)
  assert.equal(executor.calls[0]?.operation, 'understandAndPlan')
})

test('reasoning capabilities reject guessed or invalid limits', () => {
  assert.throws(() => new MockReasoningExecutor({ capabilities: { ...capabilities, maxContextTokens: 0 } }), (error: unknown) => error instanceof ReasoningExecutorError && error.code === 'reasoning_configuration_invalid')
})

test('Pi completion seam receives the unchanged output contract without changing semantic Context', async () => {
  const contract = { type: 'object', required: ['status'], properties: { status: { const: 'ok' } } }
  let received: unknown
  let receivedContext: Context | undefined
  const executor = new PiReasoningExecutor({ capabilities: { ...capabilities, structuredOutputSupport: true }, completion: async (_model, context, options) => {
    received = options.outputContract
    receivedContext = context
    return '{"status":"ok"}'
  } })
  await executor.execute({ operation: 'understandAndPlan', instruction: 'return status', input: { value: 1 }, outputContract: contract })
  assert.strictEqual(received, contract)
  assert.match(receivedContext?.systemPrompt ?? '', /Output contract:/)
  assert.match(receivedContext?.messages[0]?.content as string, /"value":1/)
})

test('Codex executor pins the default model and reasoning effort explicitly', () => {
  const executor = new CodexReasoningExecutor({ capabilities })
  assert.deepEqual(executor.runtimeMetadata(), { provider: 'codex-cli', requestedModel: 'gpt-5.6-luna', requestedReasoningEffort: 'high' })
  const args = buildCodexInvocationArgs({ commandPrefix: ['exec'], model: executor.runtimeMetadata().requestedModel, reasoningEffort: executor.runtimeMetadata().requestedReasoningEffort, invocationDirectory: 'temp', outputPath: 'temp/final-output.txt' })
  assert.deepEqual(args.slice(0, 7), ['exec', '--model', 'gpt-5.6-luna', '-c', 'model_reasoning_effort="high"', '--ephemeral', '--sandbox'])
  assert.equal(args.includes('--model'), true)
  assert.equal(args.includes('gpt-5.6-luna'), true)
  assert.equal(args.includes('model_reasoning_effort="high"'), true)
})

test('Codex executor supports explicit model and reasoning-effort overrides', () => {
  const executor = new CodexReasoningExecutor({ capabilities, model: 'another-model', reasoningEffort: 'medium' })
  assert.deepEqual(executor.runtimeMetadata(), { provider: 'codex-cli', requestedModel: 'another-model', requestedReasoningEffort: 'medium' })
  const args = buildCodexInvocationArgs({ commandPrefix: ['exec'], model: executor.runtimeMetadata().requestedModel, reasoningEffort: executor.runtimeMetadata().requestedReasoningEffort, invocationDirectory: 'temp', outputPath: 'temp/final-output.txt' })
  assert.equal(args.includes('another-model'), true)
  assert.equal(args.includes('model_reasoning_effort="medium"'), true)
  assert.equal(args.includes('gpt-5.6-luna'), false)
})

test('Codex executor rejects an empty model and unsupported runtime effort', () => {
  assert.throws(() => new CodexReasoningExecutor({ capabilities, model: '   ' }), (error: unknown) => error instanceof ReasoningExecutorError && error.code === 'reasoning_configuration_invalid')
  assert.throws(() => new CodexReasoningExecutor({ capabilities, reasoningEffort: 'unsupported' as never }), (error: unknown) => error instanceof ReasoningExecutorError && error.code === 'reasoning_configuration_invalid')
})

test('Codex executor rejects invalid termination budgets', () => {
  assert.throws(() => new CodexReasoningExecutor({ capabilities, terminationGraceMs: 0 }), (error: unknown) => error instanceof ReasoningExecutorError && error.code === 'reasoning_configuration_invalid')
  assert.throws(() => new CodexReasoningExecutor({ capabilities, forcedTerminationWaitMs: 0 }), (error: unknown) => error instanceof ReasoningExecutorError && error.code === 'reasoning_configuration_invalid')
})

test('Codex executor isolates and cleans its invocation directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-reasoning-test-'))
  try {
    const executor = new CodexReasoningExecutor({ capabilities, executable: process.execPath, tempRoot: root, commandPrefix: [join(process.cwd(), 'tests/plugins/reasoning/fixtures/fake-reasoning-host.mjs')] })
    const result = await executor.execute({ operation: 'extractKnowledge', instruction: 'test', input: { private: 'only here' }, outputContract: { type: 'object' } })
    const parsed = JSON.parse(result.output as string) as { cwd: string; ok: boolean }
    assert.equal(parsed.ok, true)
    assert.notEqual(parsed.cwd, process.cwd())
    assert.match(parsed.cwd, /researchhub-reasoning-/)
    assert.deepEqual(await readdir(root), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Codex executor preserves bounded failure details and timeout errors', async () => {
  const failure = new CodexReasoningExecutor({ capabilities, executable: process.execPath, commandPrefix: [join(process.cwd(), 'tests/plugins/reasoning/fixtures/fake-reasoning-host.mjs'), '--fail'] })
  await assert.rejects(() => failure.execute({ operation: 'resolveSemanticCase', instruction: 'test', input: {}, outputContract: {} }), (error: unknown) => error instanceof ReasoningExecutorError && error.code === 'reasoning_execution_failed' && error.exitCode === 7 && error.stderr === 'fixture failure\n')
  const timeout = new CodexReasoningExecutor({ capabilities, executable: process.execPath, timeoutMs: 50, commandPrefix: [join(process.cwd(), 'tests/plugins/reasoning/fixtures/fake-reasoning-host.mjs'), '--sleep'] })
  const started = Date.now()
  await assert.rejects(() => timeout.execute({ operation: 'resolveSemanticCase', instruction: 'test', input: {}, outputContract: {} }), (error: unknown) => error instanceof ReasoningExecutorError && error.code === 'reasoning_timeout')
  assert.ok(Date.now() - started < 2_000)
})

test('Codex executor terminates a timed-out process tree', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-reasoning-tree-test-'))
  const pidFile = join(root, 'grandchild.pid')
  try {
      const timeout = new CodexReasoningExecutor({ capabilities, executable: process.execPath, tempRoot: root, timeoutMs: 50, commandPrefix: [join(process.cwd(), 'tests/plugins/reasoning/fixtures/fake-reasoning-host.mjs'), '--spawn-grandchild', '--pid-file', pidFile] })
    const started = Date.now()
    await assert.rejects(() => timeout.execute({ operation: 'resolveSemanticCase', instruction: 'test', input: {}, outputContract: {} }), (error: unknown) => error instanceof ReasoningExecutorError && error.code === 'reasoning_timeout')
    assert.ok(Date.now() - started < 2_000)
    assert.deepEqual((await readdir(root)).filter((entry) => entry.startsWith('researchhub-reasoning-')), [])
    const pid = Number((await readFile(pidFile, 'utf8')).trim())
    assert.equal(await waitForProcessExit(pid, 1_500), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

if (process.platform !== 'win32') {
  test('Codex executor falls back to SIGKILL when a process tree ignores SIGTERM', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rhl-reasoning-kill-test-'))
    const pidFile = join(root, 'grandchild.pid')
    try {
      const timeout = new CodexReasoningExecutor({ capabilities, executable: process.execPath, tempRoot: root, timeoutMs: 50, terminationGraceMs: 100, forcedTerminationWaitMs: 500, commandPrefix: [join(process.cwd(), 'tests/plugins/reasoning/fixtures/fake-reasoning-host.mjs'), '--spawn-grandchild', '--ignore-term', '--pid-file', pidFile] })
      const started = Date.now()
      await assert.rejects(() => timeout.execute({ operation: 'resolveSemanticCase', instruction: 'test', input: {}, outputContract: {} }), (error: unknown) => error instanceof ReasoningExecutorError && error.code === 'reasoning_timeout')
      assert.ok(Date.now() - started < 2_000)
      const pid = Number((await readFile(pidFile, 'utf8')).trim())
      assert.equal(await waitForProcessExit(pid, 1_500), true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
}

test('Codex executor classifies unavailable hosts and oversized output', async () => {
  const unavailable = new CodexReasoningExecutor({ capabilities, executable: join(process.cwd(), 'tests/plugins/reasoning/fixtures/does-not-exist.exe') })
  await assert.rejects(() => unavailable.execute({ operation: 'understandAndPlan', instruction: 'test', input: {}, outputContract: {} }), (error: unknown) => error instanceof ReasoningExecutorError && error.code === 'reasoning_host_unavailable')
  const oversized = new CodexReasoningExecutor({ capabilities, executable: process.execPath, maxOutputChars: 10, commandPrefix: [join(process.cwd(), 'tests/plugins/reasoning/fixtures/fake-reasoning-host.mjs'), '--big'] })
  await assert.rejects(() => oversized.execute({ operation: 'understandAndPlan', instruction: 'test', input: {}, outputContract: {} }), (error: unknown) => error instanceof ReasoningExecutorError && error.code === 'reasoning_output_too_large')
})

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (true) {
    try {
      process.kill(pid, 0)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true
      throw error
    }
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}
