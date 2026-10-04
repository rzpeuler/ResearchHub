import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { addModelConnection, listSafeModelConnectionStatus, loadModelConnections, loginModelProvider, registerModelConnections, saveModelConnection, saveModelProviderApiKey, type ModelConnectionInput } from '../../../app/runtime/model-connections.ts'

const definition: ModelConnectionInput = {
  name: 'Local OpenAI Endpoint', providerId: 'local-openai', api: 'openai-completions',
  baseUrl: 'http://127.0.0.1:8080/v1/', modelId: 'local-model', modelName: 'Local Model',
  contextWindow: 32_000, maxTokens: 4_000,
}

test('custom model definitions validate, persist atomically without secrets, and register in Pi', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-model-connections-'))
  const cwd = join(root, 'app')
  const agentDir = join(root, 'agent')
  await mkdir(cwd); await mkdir(agentDir)
  const runtime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false })
  try {
    assert.deepEqual(await loadModelConnections(cwd), [])
    const saved = await saveModelConnection(cwd, definition)
    assert.deepEqual(saved, [{ ...definition, baseUrl: 'http://127.0.0.1:8080/v1' }])
    assert.deepEqual(await loadModelConnections(cwd), saved)
    await assert.rejects(saveModelConnection(cwd, definition), /already exists/u)
    await assert.rejects(saveModelConnection(cwd, { ...definition, providerId: 'openai' }, runtime.getProviders().map(({ id }) => id)), /Pi provider with this ID already exists/u)
    await assert.rejects(saveModelConnection(cwd, { ...definition, providerId: 'other-id', baseUrl: 'http://example.com' }), /HTTPS or loopback HTTP/u)
    await assert.rejects(saveModelConnection(cwd, { ...definition, providerId: 'other-id', baseUrl: 'https://user:secret@example.com/v1' }), /credentials or a fragment/u)
    await assert.rejects(saveModelConnection(cwd, { ...definition, providerId: 'other-id', api: 'unsupported-api' }), /protocol is not supported/u)
    await assert.rejects(saveModelConnection(cwd, { ...definition, providerId: 'other-id', maxTokens: 40_000 }), /no larger than the context window/u)

    const configText = await readFile(join(cwd, 'runtime-data', 'model-connections.json'), 'utf8')
    assert.equal(/apiKey|secret|password/iu.test(configText), false)
    await registerModelConnections(runtime, cwd)
    assert.equal(runtime.getModel('local-openai', 'local-model')?.baseUrl, 'http://127.0.0.1:8080/v1')
    const status = listSafeModelConnectionStatus(runtime).find(({ providerId }) => providerId === 'local-openai')
    assert.equal(status?.supportsApiKey, true)
    assert.equal(status?.configured, false)
    assert.equal(JSON.stringify(status).includes('apiKey'), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('API-key login persists in Pi auth storage and safe status omits credential values', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-model-auth-'))
  const authPath = join(root, 'agent', 'auth.json')
  await mkdir(join(root, 'agent'), { recursive: true })
  const first = await ModelRuntime.create({ authPath, modelsPath: null, refreshOnCreate: false, allowModelNetwork: false })
  const secret = 'test-key-do-not-log'
  try {
    first.registerProvider('custom-provider', { name: 'Custom Provider', api: 'openai-completions', baseUrl: 'https://api.example.test/v1', models: [{ id: 'custom-model', name: 'Custom Model', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8_000, maxTokens: 1_000 }] })
    await saveModelProviderApiKey(first, 'custom-provider', secret)
    assert.equal((await readFile(authPath, 'utf8')).length > 0, true)

    const second = await ModelRuntime.create({ authPath, modelsPath: null, refreshOnCreate: false, allowModelNetwork: false })
    second.registerProvider('custom-provider', { name: 'Custom Provider', api: 'openai-completions', baseUrl: 'https://api.example.test/v1', models: [{ id: 'custom-model', name: 'Custom Model', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8_000, maxTokens: 1_000 }] })
    assert.equal((await second.getAuth('custom-provider'))?.auth.apiKey, secret)
    await second.refresh({ allowNetwork: false })
    const status = listSafeModelConnectionStatus(second).find(({ providerId }) => providerId === 'custom-provider')
    assert.equal(status?.configured, true)
    assert.equal(JSON.stringify(status).includes(secret), false)
    await assert.rejects(saveModelProviderApiKey(second, 'custom-provider', '   '), /valid provider ID and API key/u)
    await assert.rejects(loginModelProvider(second, 'custom-provider', 'oauth', { prompt: async () => '', notify: () => undefined }), /does not support Pi OAuth/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('adding a model updates Pi immediately and unregisters it when persistence fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-model-add-'))
  const cwd = join(root, 'app')
  const agentDir = join(root, 'agent')
  const brokenCwd = join(root, 'broken-app')
  await mkdir(cwd, { recursive: true }); await mkdir(agentDir, { recursive: true }); await mkdir(join(brokenCwd, 'runtime-data'), { recursive: true })
  await writeFile(join(brokenCwd, 'runtime-data', 'model-connections.json'), '{not json', 'utf8')
  const runtime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false })
  const brokenRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'broken-auth.json'), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false })
  try {
    await addModelConnection(runtime, cwd, definition)
    assert.equal(runtime.getModel(definition.providerId, definition.modelId)?.provider, definition.providerId)
    assert.deepEqual((await loadModelConnections(cwd)).map(({ providerId }) => providerId), [definition.providerId])

    await assert.rejects(addModelConnection(brokenRuntime, brokenCwd, { ...definition, providerId: 'rollback-provider' }), /invalid JSON/u)
    assert.equal(brokenRuntime.getProvider('rollback-provider'), undefined)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
