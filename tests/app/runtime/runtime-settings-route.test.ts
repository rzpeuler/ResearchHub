import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fauxProvider } from '@earendil-works/pi-ai'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { createResearchHubApplicationRuntime } from '../../../app/runtime/application-runtime.ts'
import { ResearchHubRuntimeServer } from '../../../app/runtime/server.ts'
import type { ReasoningCapabilities, ReasoningExecutor } from '../../../plugins/reasoning/contracts.ts'
import { createFreshKnowledgeBaseV04 } from '../../../knowledge/storage/create-v04.ts'
import { readRuntimeSettings } from '../../../app/runtime/runtime-settings.ts'

const capabilities: ReasoningCapabilities = { maxContextTokens: 100_000, maxOutputTokens: 10_000, structuredOutputSupport: true, maxConcurrency: 4 }
class FixtureExecutor implements ReasoningExecutor { capabilities(): ReasoningCapabilities { return capabilities }; async execute() { return { operation: 'fixture', output: {} } as never } }

test('GET settings returns the current KB status and safe catalog under runtime read security', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-settings-route-'))
  const knowledgeBaseId = `settings-route-${Date.now()}`
  const kb = join(root, 'knowledge-bases', 'selected')
  const cwd = join(root, 'cwd')
  const agentDir = join(root, 'agent')
  await mkdir(cwd); await mkdir(agentDir); await mkdir(kb, { recursive: true }); await createFreshKnowledgeBaseV04(kb, { knowledgeBaseId })
  const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false })
  const faux = fauxProvider({ provider: `settings-route-${Date.now()}`, models: [{ id: 'fixture-model', name: 'Fixture Model' }] })
  modelRuntime.registerNativeProvider(faux.provider)
  const runtime = await createResearchHubApplicationRuntime({ cwd, agentDir, mountedKnowledgeBaseRoot: kb, modelRuntime, model: faux.getModel(), reasoningExecutor: new FixtureExecutor() })
  const server = new ResearchHubRuntimeServer({ runtime, clientRoot: join(root, 'missing-client'), port: 0 })
  try {
    const info = await server.start()
    const unauthorized = await fetch(`${info.origin}/api/settings`, { headers: { origin: 'http://127.0.0.1:1' } })
    assert.equal(unauthorized.status, 401)
    const headers = { origin: info.origin, 'x-researchhub-runtime-token': info.runtimeToken, 'content-type': 'application/json' }
    const response = await fetch(`${info.origin}/api/settings`, { headers })
    assert.equal(response.status, 200)
    const settings = await response.json() as { revision: number; model: { provider: string; modelId: string }; models: Array<{ provider: string; modelId: string; available: boolean }>; knowledgeBase: { knowledgeBaseId: string; rootRef: string; revision: number; counts: object }; knowledgeBases: Array<{ knowledgeBaseId: string; schemaVersion: string; revision: number }> }
    assert.equal(settings.revision, 0)
    assert.deepEqual(settings.model, { provider: faux.getModel().provider, modelId: faux.getModel().id })
    assert.equal(settings.models.some(({ provider, modelId }) => provider === faux.getModel().provider && modelId === faux.getModel().id), true)
    assert.equal(settings.knowledgeBase.knowledgeBaseId, knowledgeBaseId)
    assert.equal(settings.knowledgeBase.rootRef.toLowerCase(), kb.toLowerCase())
    assert.equal(settings.knowledgeBases.some(({ knowledgeBaseId: id }) => id === knowledgeBaseId), true)
    assert.equal(settings.knowledgeBases.find(({ knowledgeBaseId: id }) => id === knowledgeBaseId)?.schemaVersion, '0.4')
    const mutation = await fetch(`${info.origin}/api/settings/knowledge-base`, { method: 'POST', headers, body: JSON.stringify({ knowledgeBaseId: null }) })
    assert.equal(mutation.status, 409)
  } finally {
    await server.close(); await runtime.close(); await rm(root, { recursive: true, force: true })
  }
})

test('KB settings switch, persist, restore on restart, and preserve explicit unmount', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-settings-switch-'))
  const cwd = join(root, 'ResearchHub_Lite')
  const agentDir = join(root, 'agent')
  const catalogRoot = join(root, 'ResearchHubData', 'knowledge-bases')
  const kbA = join(catalogRoot, 'a')
  const kbB = join(catalogRoot, 'b')
  const kbAId = `settings-a-${Date.now()}`
  const kbBId = `settings-b-${Date.now()}`
  await mkdir(cwd, { recursive: true }); await mkdir(agentDir, { recursive: true }); await mkdir(kbA, { recursive: true }); await mkdir(kbB, { recursive: true })
  await createFreshKnowledgeBaseV04(kbA, { knowledgeBaseId: kbAId })
  await createFreshKnowledgeBaseV04(kbB, { knowledgeBaseId: kbBId })
  const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false })
  const faux = fauxProvider({ provider: `settings-switch-${Date.now()}`, models: [{ id: 'fixture-model', name: 'Fixture Model' }] })
  modelRuntime.registerNativeProvider(faux.provider)
  const serverOptions = { cwd, agentDir, mountedKnowledgeBaseRoot: kbA, knowledgeBaseCatalogRoot: catalogRoot, modelRuntime, model: faux.getModel(), reasoningExecutor: new FixtureExecutor(), startDailyScheduler: false, clientRoot: join(root, 'missing-client'), port: 0 }
  let server = new ResearchHubRuntimeServer(serverOptions)
  try {
    let info = await server.start()
    const headers = { origin: info.origin, 'x-researchhub-runtime-token': info.runtimeToken, 'content-type': 'application/json' }
    const catalogResponse = await fetch(`${info.origin}/api/settings`, { headers })
    const initial = await catalogResponse.json() as { knowledgeBases: Array<{ knowledgeBaseId: string }> }
    assert.equal(initial.knowledgeBases.some(({ knowledgeBaseId }) => knowledgeBaseId === kbAId), true)
    assert.equal(initial.knowledgeBases.some(({ knowledgeBaseId }) => knowledgeBaseId === kbBId), true)

    const switchedResponse = await fetch(`${info.origin}/api/settings/knowledge-base`, { method: 'POST', headers, body: JSON.stringify({ knowledgeBaseId: kbBId }) })
    assert.equal(switchedResponse.status, 200)
    const switched = await switchedResponse.json() as { knowledgeBase: { knowledgeBaseId: string }; revision: number }
    assert.equal(switched.knowledgeBase.knowledgeBaseId, kbBId)
    assert.equal(switched.revision, 1)
    assert.equal((await readRuntimeSettings(cwd)).knowledgeBaseId, kbBId)
    await server.close()

    server = new ResearchHubRuntimeServer(serverOptions)
    info = await server.start()
    const restoredResponse = await fetch(`${info.origin}/api/settings`, { headers: { origin: info.origin } })
    assert.equal(restoredResponse.status, 200)
    const restored = await restoredResponse.json() as { knowledgeBase: { knowledgeBaseId: string } }
    assert.equal(restored.knowledgeBase.knowledgeBaseId, kbBId)
    const unmountedResponse = await fetch(`${info.origin}/api/settings/knowledge-base`, { method: 'POST', headers: { origin: info.origin, 'x-researchhub-runtime-token': info.runtimeToken, 'content-type': 'application/json' }, body: JSON.stringify({ knowledgeBaseId: null }) })
    assert.equal(unmountedResponse.status, 200)
    const unmounted = await unmountedResponse.json() as { knowledgeBase?: unknown; revision: number }
    assert.equal(unmounted.knowledgeBase, undefined)
    assert.equal(unmounted.revision, 2)
    assert.equal((await readRuntimeSettings(cwd)).knowledgeBaseId, null)
    await server.close()

    server = new ResearchHubRuntimeServer(serverOptions)
    info = await server.start()
    const afterRestartResponse = await fetch(`${info.origin}/api/settings`, { headers: { origin: info.origin } })
    const afterRestart = await afterRestartResponse.json() as { knowledgeBase?: unknown; knowledgeBases: Array<{ knowledgeBaseId: string }> }
    assert.equal(afterRestart.knowledgeBase, undefined)
    assert.equal(afterRestart.knowledgeBases.some(({ knowledgeBaseId }) => knowledgeBaseId === kbAId), true)
  } finally {
    await server.close()
    await rm(root, { recursive: true, force: true })
  }
})
