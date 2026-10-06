import assert from 'node:assert/strict'
import test from 'node:test'
import { request as httpRequest } from 'node:http'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { fauxProvider } from '@earendil-works/pi-ai'
import { createResearchHubApplicationRuntime } from '../../../app/runtime/application-runtime.ts'
import { ResearchHubRuntimeServer } from '../../../app/runtime/server.ts'
import { DataSourceAdministrationError } from '../../../app/services/data-source-administration.ts'

const integrationView = {
  integration: {
    integrationId: 'fixture-source', displayName: 'Fixture Source', sourceIds: ['fixture:source'],
    credentialFields: [{ id: 'apiKey', label: 'API key', required: true }],
    capabilities: [{ id: 'lookup', label: 'Lookup', metricIds: ['metric.fixture'] }],
    supportedTests: { connection: true, capabilitySamples: ['lookup'] },
  },
  credentialState: 'missing', policyLinked: false, latestTests: [],
}
const draftInput = {
  integrationId: 'future-source', displayName: 'Future Source', documentationUrl: 'https://example.com/docs',
  accessMode: 'api', publisher: 'Example', proposedAuthority: 'S2_PROFESSIONAL', capabilityIds: ['lookup'],
  metricIds: ['metric.fixture'], authenticationMode: 'api_key', rightsNotes: 'Public terms',
  rateLimitNotes: 'Unknown', timeBoundaryNotes: 'Daily', providerTermsReviewed: true,
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'data-source-admin-routes-'))
  const cwd = join(root, 'cwd'), workspace = join(root, 'workspace'), agentDir = join(root, 'agent')
  await Promise.all([mkdir(cwd), mkdir(workspace), mkdir(agentDir)])
  const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false })
  const faux = fauxProvider({ provider: `data-source-http-${Date.now()}-${Math.random()}`, models: [{ id: 'fixture-model' }] })
  modelRuntime.registerNativeProvider(faux.provider)
  const runtime = await createResearchHubApplicationRuntime({ cwd, agentDir, workspaceRoot: workspace, modelRuntime, model: faux.getModel(), reasoningExecutor: { capabilities: () => ({ maxContextTokens: 32_000, maxOutputTokens: 2_000, structuredOutputSupport: true, maxConcurrency: 1 }), async execute(request) { return { operation: request.operation, output: {} } } } })
  const calls: unknown[] = []
  const drafts: Record<string, unknown>[] = []
  let blockTest = false
  let receivedSignal: AbortSignal | undefined
  let knowledgeCalls = 0
  const administration = {
    async listIntegrations() { calls.push(['list']); return [integrationView] },
    async saveCredentials(id: string, values: Record<string, string>) { calls.push(['save', id, values]) },
    async removeCredentials(id: string) { calls.push(['remove', id]) },
    async runTest(input: unknown, signal?: AbortSignal) {
      calls.push(['test', input]); receivedSignal = signal
      if ((input as { integrationId: string }).integrationId !== 'fixture-source') throw new DataSourceAdministrationError('unknown_integration')
      if ((input as { capabilityId?: string }).capabilityId === 'unsupported') throw new DataSourceAdministrationError('unsupported_test')
      if (blockTest && (input as { kind: string }).kind === 'connection') await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve(), { once: true }))
      return { integrationId: 'fixture-source', kind: (input as { kind: string }).kind, status: 'passed', startedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T00:00:01.000Z', secretValue: 'provider-secret-must-not-escape' } as never
    },
  }
  const onboarding = {
    async list() { calls.push(['draft-list']); return drafts },
    async create(input: unknown) { calls.push(['draft-create', input]); const draft = { requestId: '00000000-0000-4000-8000-000000000001', input, status: 'draft', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }; drafts.push(draft); return draft },
    async update(requestId: string, input: unknown) { calls.push(['draft-update', requestId, input]); const draft = { requestId, input, status: 'draft', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }; drafts[0] = draft; return draft },
    async markReady(requestId: string) { calls.push(['draft-ready', requestId]); const draft = { requestId, input: drafts[0]?.input ?? draftInput, status: 'ready_for_adapter', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }; drafts[0] = draft; return draft },
  }
  const mutableServices = runtime.services as unknown as Record<string, unknown>
  mutableServices.dataSourceAdministrationService = administration
  mutableServices.dataSourceOnboardingService = onboarding
  mutableServices.knowledgeService = new Proxy({}, { get() { return (..._args: unknown[]) => { knowledgeCalls += 1 } } })
  const server = new ResearchHubRuntimeServer({ runtime, clientRoot: join(root, 'missing-client'), port: 0 })
  await server.start()
  const info = server.address!
  const headers = { origin: info.origin, 'x-researchhub-runtime-token': info.runtimeToken, 'content-type': 'application/json' }
  return { root, runtime, server, modelRuntime, info, headers, calls, get knowledgeCalls() { return knowledgeCalls }, setBlockTest(value: boolean) { blockTest = value }, get receivedSignal() { return receivedSignal } }
}

async function close(f: Awaited<ReturnType<typeof fixture>>) {
  await f.server.close(); await f.runtime.close()
  await Promise.resolve((f.modelRuntime as unknown as { dispose?: () => void | Promise<void> }).dispose?.()).catch(() => undefined)
  await rm(f.root, { recursive: true, force: true })
}

test('lists real integration descriptors without requiring a mounted Knowledge Base', async () => {
  const f = await fixture()
  try {
    const response = await fetch(`${f.info.origin}/api/data-sources/integrations`, { headers: { origin: f.info.origin } })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { integrations: [integrationView] })
  } finally { await close(f) }
})

test('requires the Runtime mutation token for credential, test, and draft writes', async () => {
  const f = await fixture()
  try {
    const url = f.info.origin
    const unauthorized = [
      await fetch(`${url}/api/data-sources/integrations/fixture-source/credentials`, { method: 'POST', headers: { origin: url, 'content-type': 'application/json' }, body: JSON.stringify({ values: { apiKey: 'secret' } }) }),
      await fetch(`${url}/api/data-sources/integrations/fixture-source/credentials`, { method: 'DELETE', headers: { origin: url } }),
      await fetch(`${url}/api/data-sources/integrations/fixture-source/tests`, { method: 'POST', headers: { origin: url, 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'connection' }) }),
      await fetch(`${url}/api/data-sources/onboarding`, { method: 'POST', headers: { origin: url, 'content-type': 'application/json' }, body: JSON.stringify(draftInput) }),
      await fetch(`${url}/api/data-sources/onboarding/00000000-0000-4000-8000-000000000001`, { method: 'PATCH', headers: { origin: url, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'mark_ready' }) }),
    ]
    assert.deepEqual(unauthorized.map((response) => response.status), [401, 401, 401, 401, 401])
    assert.deepEqual(f.calls, [])
  } finally { await close(f) }
})

test('saves and removes credentials without echoing secret values', async () => {
  const f = await fixture()
  try {
    const saved = await fetch(`${f.info.origin}/api/data-sources/integrations/fixture-source/credentials`, { method: 'POST', headers: f.headers, body: JSON.stringify({ values: { apiKey: 'never-return-this' } }) })
    assert.equal(saved.status, 200); const savedText = await saved.text(); assert.deepEqual(JSON.parse(savedText), { saved: true })
    const removed = await fetch(`${f.info.origin}/api/data-sources/integrations/fixture-source/credentials`, { method: 'DELETE', headers: f.headers })
    assert.equal(removed.status, 200); const removedText = await removed.text(); assert.deepEqual(JSON.parse(removedText), { removed: true })
    assert.equal(JSON.stringify([savedText, removedText]).includes('never-return-this'), false)
    assert.deepEqual(f.calls, [['save', 'fixture-source', { apiKey: 'never-return-this' }], ['remove', 'fixture-source']])
  } finally { await close(f) }
})

test('rejects malformed credential requests as client errors', async () => {
  const f = await fixture()
  try {
    const malformed = await fetch(`${f.info.origin}/api/data-sources/integrations/fixture-source/credentials`, { method: 'POST', headers: f.headers, body: '{' })
    const extraFields = await fetch(`${f.info.origin}/api/data-sources/integrations/fixture-source/credentials`, { method: 'POST', headers: f.headers, body: JSON.stringify({ values: { apiKey: 'value' }, unexpected: true }) })
    const invalidShape = await fetch(`${f.info.origin}/api/data-sources/integrations/fixture-source/credentials`, { method: 'POST', headers: f.headers, body: JSON.stringify({ values: [] }) })
    for (const response of [malformed, extraFields, invalidShape]) {
      assert.equal(response.status, 400)
      assert.equal((await response.json() as { code: string }).code, 'invalid_input')
    }
    const services = f.runtime.services as unknown as Record<string, { saveCredentials: () => Promise<void> }>
    services.dataSourceAdministrationService!.saveCredentials = async () => { throw new Error('vault detail must not escape') }
    const vaultFailure = await fetch(`${f.info.origin}/api/data-sources/integrations/fixture-source/credentials`, { method: 'POST', headers: f.headers, body: JSON.stringify({ values: { apiKey: 'value' } }) })
    assert.equal(vaultFailure.status, 503)
    const vaultFailureText = await vaultFailure.text()
    assert.deepEqual(JSON.parse(vaultFailureText), { code: 'credential_store_unavailable', error: 'Credential storage is unavailable' })
    assert.equal(vaultFailureText.includes('vault detail must not escape'), false)
    assert.deepEqual(f.calls, [])
  } finally { await close(f) }
})

test('returns bounded sanitized test results and rejects unknown integrations', async () => {
  const f = await fixture()
  try {
    const passed = await fetch(`${f.info.origin}/api/data-sources/integrations/fixture-source/tests`, { method: 'POST', headers: f.headers, body: JSON.stringify({ kind: 'connection' }) })
    assert.equal(passed.status, 200)
    const passedText = await passed.text()
    assert.deepEqual(JSON.parse(passedText), { integrationId: 'fixture-source', kind: 'connection', status: 'passed', startedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T00:00:01.000Z' })
    assert.equal(passedText.includes('provider-secret-must-not-escape'), false)
    assert.equal(f.receivedSignal?.aborted, false)
    const unknown = await fetch(`${f.info.origin}/api/data-sources/integrations/not-known/tests`, { method: 'POST', headers: f.headers, body: JSON.stringify({ kind: 'connection' }) })
    assert.equal(unknown.status, 404); assert.deepEqual(await unknown.json(), { code: 'not_found', error: 'Data source integration was not found' })
    const unsupported = await fetch(`${f.info.origin}/api/data-sources/integrations/fixture-source/tests`, { method: 'POST', headers: f.headers, body: JSON.stringify({ kind: 'capability_sample', capabilityId: 'unsupported' }) })
    assert.equal(unsupported.status, 422); assert.deepEqual(await unsupported.json(), { code: 'unsupported_test', error: 'This integration does not support the requested test' })
    const extraFields = await fetch(`${f.info.origin}/api/data-sources/integrations/fixture-source/tests`, { method: 'POST', headers: f.headers, body: JSON.stringify({ kind: 'connection', url: 'https://example.com' }) })
    assert.equal(extraFields.status, 400)
  } finally { await close(f) }
})

test('aborts a running connector test when the HTTP client disconnects', async () => {
  const f = await fixture()
  try {
    f.setBlockTest(true)
    const req = httpRequest(`${f.info.origin}/api/data-sources/integrations/fixture-source/tests`, { method: 'POST', headers: { ...f.headers, 'content-length': String(Buffer.byteLength('{"kind":"connection"}')) } })
    req.on('error', () => undefined)
    req.write('{"kind":"connection"}'); req.end()
    for (let i = 0; i < 50 && !f.receivedSignal; i++) await new Promise((resolve) => setTimeout(resolve, 10))
    assert.ok(f.receivedSignal)
    req.destroy()
    for (let i = 0; i < 50 && !f.receivedSignal?.aborted; i++) await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(f.receivedSignal?.aborted, true)
  } finally { await close(f) }
})

test('persists drafts without changing the source-policy catalog or Knowledge revision', async () => {
  const f = await fixture()
  try {
    const beforePolicies = await fetch(`${f.info.origin}/api/data-sources/policies`, { headers: { origin: f.info.origin } }).then((response) => response.json())
    const created = await fetch(`${f.info.origin}/api/data-sources/onboarding`, { method: 'POST', headers: f.headers, body: JSON.stringify(draftInput) })
    assert.equal(created.status, 201)
    const createdResponse = await created.json() as { draft: { requestId: string; input: unknown; status: string } }
    const createdBody = createdResponse.draft
    assert.equal(createdBody.status, 'draft'); assert.deepEqual(createdBody.input, draftInput)
    const updatedInput = { ...draftInput, displayName: 'Updated Future Source' }
    const updated = await fetch(`${f.info.origin}/api/data-sources/onboarding/${createdBody.requestId}`, { method: 'PATCH', headers: f.headers, body: JSON.stringify({ action: 'update', input: updatedInput }) })
    assert.equal(updated.status, 200); assert.deepEqual((await updated.json() as { draft: { input: unknown } }).draft.input, updatedInput)
    const patchExtra = await fetch(`${f.info.origin}/api/data-sources/onboarding/${createdBody.requestId}`, { method: 'PATCH', headers: f.headers, body: JSON.stringify({ action: 'mark_ready', status: 'verified' }) })
    assert.equal(patchExtra.status, 400)
    const marked = await fetch(`${f.info.origin}/api/data-sources/onboarding/${createdBody.requestId}`, { method: 'PATCH', headers: f.headers, body: JSON.stringify({ action: 'mark_ready' }) })
    assert.equal(marked.status, 200); assert.equal((await marked.json() as { draft: { status: string } }).draft.status, 'ready_for_adapter')
    const listed = await fetch(`${f.info.origin}/api/data-sources/onboarding`, { headers: { origin: f.info.origin } })
    assert.equal(listed.status, 200); assert.deepEqual(await listed.json(), { drafts: [{ requestId: createdBody.requestId, input: updatedInput, status: 'ready_for_adapter', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }] })
    const afterPolicies = await fetch(`${f.info.origin}/api/data-sources/policies`, { headers: { origin: f.info.origin } }).then((response) => response.json())
    assert.deepEqual(afterPolicies, beforePolicies); assert.equal(f.knowledgeCalls, 0)
  } finally { await close(f) }
})
