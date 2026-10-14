import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fauxProvider } from '@earendil-works/pi-ai'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { createResearchHubApplicationRuntime } from '../../../app/runtime/application-runtime.ts'
import { ResearchHubRuntimeServer } from '../../../app/runtime/server.ts'
import type { ResearchDispatchResolution } from '../../../app/services/research-dispatch-service.ts'
import type { ReasoningExecutor } from '../../../plugins/reasoning/contracts.ts'

test('public dispatch diagnostics retain safe dotted offending keys without model values or raw errors', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-dispatch-diagnostics-'))
  const cwd = join(root, 'cwd'); const agentDir = join(root, 'agent')
  await mkdir(cwd, { recursive: true }); await mkdir(agentDir, { recursive: true })
  const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false })
  const faux = fauxProvider({ provider: `dispatch-diagnostics-${Date.now()}`, models: [{ id: 'fixture' }] })
  modelRuntime.registerNativeProvider(faux.provider)
  let argumentsValue: Record<string, unknown> = { name: '东山精密', asOf: '2026-06-24T00:00:00.000Z' }
  const reasoningExecutor: ReasoningExecutor = {
    capabilities: () => ({ maxContextTokens: 10000, maxOutputTokens: 1000, structuredOutputSupport: true, maxConcurrency: 1 }),
    async execute(request) { return { operation: request.operation, output: { mode: 'workflow', workflow: { id: 'company_research', confidence: 1, arguments: argumentsValue }, skills: [], entities: [], missingRequiredInputs: [], contextPolicy: { structuredKnowledge: false, sourceLibrary: false }, persistencePolicy: { writeKnowledge: false }, rationale: 'fixture-private-rationale' } } },
  }
  const runtime = await createResearchHubApplicationRuntime({ cwd, agentDir, sessionDir: join(root, 'sessions'), modelRuntime, model: faux.getModel(), reasoningExecutor })
  const server = new ResearchHubRuntimeServer({ runtime, port: 0 })
  const info = await server.start()
  try {
    const conversationId = runtime.sessionRuntime.getCurrentState().conversationId
    for (const [operationId, expectedPath] of [['historical-field', 'workflow.arguments.asOf'], ['extra-field', 'workflow.arguments.extraArgument']] as const) {
      if (operationId === 'extra-field') argumentsValue = { name: '东山精密', extraArgument: 'private-tool-secret-value' }
      const response = await fetch(`${info.origin}/api/research/dispatch`, { method: 'POST', headers: { origin: info.origin, 'x-researchhub-runtime-token': info.runtimeToken, 'content-type': 'application/json' }, body: JSON.stringify({ conversationId, operationId, query: '写一篇东山精密的报告', mode: { type: 'free_research' }, contextPolicy: { structuredKnowledge: false, sourceLibrary: false }, persistencePolicy: { writeKnowledge: false } }) })
      assert.equal(response.status, 200)
      const body = await response.json() as { status: string; resolution: ResearchDispatchResolution }
      assert.equal(body.status, 'invalid_input')
      assert.equal(body.resolution.attemptErrors?.length, 2)
      assert.equal(body.resolution.attemptErrors?.[0]?.category, 'workflow_parameters')
      assert.deepEqual(body.resolution.attemptErrors?.[0]?.fieldPaths, [expectedPath])
      assert.doesNotMatch(JSON.stringify(body.resolution), /private-tool-secret-value|fixture-private-rationale|historical asOf|inputSchema/u)
    }
  } finally { await server.close(); await runtime.close(); await rm(root, { recursive: true, force: true }) }
})
