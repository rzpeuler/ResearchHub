import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { fauxProvider } from '@earendil-works/pi-ai'
import { createFreshKnowledgeBaseV04 } from '../../../knowledge/storage/index.ts'
import { createResearchHubApplicationRuntime } from '../../../app/runtime/application-runtime.ts'
import { createThemeFrameworkProductionReasoningExecutor, THEME_FRAMEWORK_PRODUCTION_REASONING_TIMEOUT_MS } from '../../../app/pi/model-selection.ts'
import { CodexCliReasoningExecutor } from '../../../plugins/reasoning/codex-cli/executor.ts'
import type { ReasoningExecutor } from '../../../plugins/reasoning/contracts.ts'

const CAPABILITIES = { maxContextTokens: 32_000, maxOutputTokens: 2_000, structuredOutputSupport: true, maxConcurrency: 1 }

function themeFrameworkExecutor(runtime: Awaited<ReturnType<typeof createResearchHubApplicationRuntime>>): ReasoningExecutor {
  const service = runtime.services.themeFrameworkService
  assert.ok(service, 'active Schema 0.4 runtime should construct Theme Framework service')
  return (service as unknown as { options: { reasoningExecutor: ReasoningExecutor } }).options.reasoningExecutor
}

test('Theme Framework production reasoning uses one bounded timeout at both executor layers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theme-framework-reasoning-factory-'))
  const executable = join(root, 'codex.cmd')
  await writeFile(executable, '')
  const originalComplete = CodexCliReasoningExecutor.prototype.complete
  const codexLayerTimeouts: number[] = []
  CodexCliReasoningExecutor.prototype.complete = async function () {
    codexLayerTimeouts.push((this as unknown as { timeoutMs: number }).timeoutMs)
    return JSON.stringify({ ok: true })
  }
  try {
    const executor = await createThemeFrameworkProductionReasoningExecutor({ capabilities: CAPABILITIES, executable })
    assert.deepEqual(executor.runtimeMetadata(), {
      provider: 'pi-coding-agent',
      backend: 'codex-cli',
      requestedModel: 'gpt-6-luna',
      requestedReasoningEffort: 'high',
      invocationMode: 'exec-stdin-json-output-read-only',
      structuredOutputEnabled: true,
    })
    assert.equal((executor as unknown as { timeoutMs: number }).timeoutMs, THEME_FRAMEWORK_PRODUCTION_REASONING_TIMEOUT_MS)
    const request = { operation: 'theme_framework_semantic' as const, instruction: 'fixture', input: {}, outputContract: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false } }
    assert.deepEqual((await executor.execute(request)).output, { ok: true })

    const overriddenTimeoutMs = 45_000
    const overriddenExecutor = await createThemeFrameworkProductionReasoningExecutor({ capabilities: CAPABILITIES, executable, timeoutMs: overriddenTimeoutMs })
    assert.equal((overriddenExecutor as unknown as { timeoutMs: number }).timeoutMs, overriddenTimeoutMs)
    assert.deepEqual((await overriddenExecutor.execute(request)).output, { ok: true })
    assert.deepEqual(codexLayerTimeouts, [THEME_FRAMEWORK_PRODUCTION_REASONING_TIMEOUT_MS, overriddenTimeoutMs])
  } finally {
    CodexCliReasoningExecutor.prototype.complete = originalComplete
    await rm(root, { recursive: true, force: true })
  }
})

test('Application Runtime wires the Theme Framework executor explicitly and preserves reasoningExecutor injection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theme-framework-reasoning-runtime-'))
  const cwd = join(root, 'cwd'); const workspaceRoot = join(root, 'workspace'); const agentDir = join(root, 'agent'); const knowledgeBaseRoot = join(root, 'kb')
  await Promise.all([mkdir(cwd), mkdir(workspaceRoot), mkdir(agentDir)])
  await createFreshKnowledgeBaseV04(knowledgeBaseRoot, { knowledgeBaseId: `kb-theme-framework-reasoning-${Date.now()}` })
  const executable = join(root, 'codex.cmd')
  await writeFile(executable, '')
  const previousCodexExecutable = process.env.CODEX_EXECUTABLE
  process.env.CODEX_EXECUTABLE = executable
  const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false })
  const faux = fauxProvider({ provider: `theme-framework-reasoning-${Date.now()}-${Math.random()}`, models: [{ id: 'fixture-model' }] })
  modelRuntime.registerNativeProvider(faux.provider)
  let productionRuntime: Awaited<ReturnType<typeof createResearchHubApplicationRuntime>> | undefined
  let injectedRuntime: Awaited<ReturnType<typeof createResearchHubApplicationRuntime>> | undefined
  const injectedExecutor: ReasoningExecutor = { capabilities: () => CAPABILITIES, async execute(request) { return { operation: request.operation, output: {} } } }
  try {
    productionRuntime = await createResearchHubApplicationRuntime({ cwd, agentDir, workspaceRoot, mountedKnowledgeBaseRoot: knowledgeBaseRoot, modelRuntime, model: faux.getModel() })
    const productionMetadata = (themeFrameworkExecutor(productionRuntime) as unknown as { runtimeMetadata(): Record<string, unknown> }).runtimeMetadata()
    assert.equal(productionMetadata.backend, 'codex-cli')
    assert.equal(productionMetadata.requestedModel, 'gpt-6-luna')
    assert.equal(productionMetadata.requestedReasoningEffort, 'high')
    assert.equal(productionMetadata.structuredOutputEnabled, true)

    await productionRuntime.close()
    productionRuntime = undefined
    injectedRuntime = await createResearchHubApplicationRuntime({ cwd, agentDir, workspaceRoot, mountedKnowledgeBaseRoot: knowledgeBaseRoot, modelRuntime, model: faux.getModel(), reasoningExecutor: injectedExecutor })
    assert.equal(themeFrameworkExecutor(injectedRuntime), injectedExecutor)
  } finally {
    await injectedRuntime?.close()
    await productionRuntime?.close()
    await Promise.resolve((modelRuntime as unknown as { dispose?: () => void | Promise<void> }).dispose?.())
    if (previousCodexExecutable === undefined) delete process.env.CODEX_EXECUTABLE
    else process.env.CODEX_EXECUTABLE = previousCodexExecutable
    await rm(root, { recursive: true, force: true })
  }
})
