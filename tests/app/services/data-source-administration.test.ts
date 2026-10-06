import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createDataSourceAdministrationService } from '../../../app/services/data-source-administration.ts'
import { FileDataSourceTestStore, MemoryDataSourceTestStore } from '../../../app/services/data-source-test-store.ts'
import type { DataSourceIntegrationDefinition, SourceCredentialStore } from '../../../app/services/data-source-administration-contracts.ts'

function credentialStore(): SourceCredentialStore & { values: Map<string, Readonly<Record<string, string>>>; writes: number } {
  const values = new Map<string, Readonly<Record<string, string>>>()
  return { values, writes: 0, async read(id) { return values.get(id) }, async has(id) { return values.has(id) }, async write(id, credentials) { this.writes++; values.set(id, credentials) }, async delete(id) { values.delete(id) } }
}

function definition(overrides: Partial<DataSourceIntegrationDefinition> = {}): DataSourceIntegrationDefinition {
  return { descriptor: { integrationId: 'alpha', displayName: 'Alpha', sourceIds: ['source-alpha'], credentialFields: [{ id: 'token', label: 'Token', required: true }], capabilities: [{ id: 'quote', label: 'Quote', metricIds: ['price'] }], supportedTests: { connection: true, capabilitySamples: ['quote'] } }, testTimeoutMs: 100, testConnection: async () => {}, capabilitySamples: { quote: async () => {} }, ...overrides }
}

test('rejects malformed integration and credential field IDs before list or test operations', () => {
  const base = definition()
  const credentials = credentialStore()
  let adapterCalls = 0
  const make = (descriptor: DataSourceIntegrationDefinition['descriptor']) => () =>
    createDataSourceAdministrationService({
      definitions: [definition({ descriptor, testConnection: async () => { adapterCalls++ } })],
      credentials, tests: new MemoryDataSourceTestStore(),
    })
  for (const integrationId of ['alpha-', 'alpha--beta', 'Alpha', 'a'.repeat(65)]) {
    assert.throws(make({ ...base.descriptor, integrationId }), /Invalid data source integration definition/)
  }
  for (const fieldIds of [['api.key'], ['api:key'], ['_token'], ['token', 'token']]) {
    assert.throws(make({
      ...base.descriptor,
      credentialFields: fieldIds.map((id) => ({ id, label: id, required: true })),
    }), /Invalid data source integration definition/)
  }
  assert.equal(credentials.writes, 0)
  assert.equal(adapterCalls, 0)
})

test('lists only supplied Runtime integrations and reports credential presence', async () => {
  const credentials = credentialStore()
  const service = createDataSourceAdministrationService({ definitions: [definition()], credentials, tests: new MemoryDataSourceTestStore(), policySourceIds: ['source-alpha'] })
  assert.deepEqual((await service.listIntegrations()).map((view) => [view.integration.integrationId, view.credentialState, view.policyLinked]), [['alpha', 'missing', true]])
  await service.saveCredentials('alpha', { token: 'secret' })
  assert.equal((await service.listIntegrations())[0]?.credentialState, 'configured')
  assert.equal(JSON.stringify(await service.listIntegrations()).includes('secret'), false)
  await assert.rejects(service.saveCredentials('alpha', { other: 'x' }))
  await assert.rejects(service.saveCredentials('alpha', { token: '' }))
  assert.equal(credentials.writes, 1)
})

test('rejects unknown integrations and unsupported test kinds before calling adapters', async () => {
  let calls = 0
  const service = createDataSourceAdministrationService({ definitions: [definition({ testConnection: async () => { calls++ } })], credentials: credentialStore(), tests: new MemoryDataSourceTestStore() })
  await assert.rejects(service.runTest({ integrationId: 'unknown', kind: 'connection' }))
  await assert.rejects(service.runTest({ integrationId: 'alpha', kind: 'capability_sample', capabilityId: 'missing' }))
  await assert.rejects(service.saveCredentials('unknown', { token: 'x' }))
  assert.equal(calls, 0)
})

test('rejects an inherited capability callback that the adapter did not declare', async () => {
  const base = definition()
  const service = createDataSourceAdministrationService({
    definitions: [definition({
      descriptor: { ...base.descriptor, supportedTests: { connection: false, capabilitySamples: ['constructor'] } },
      capabilitySamples: {},
    })],
    credentials: credentialStore(), tests: new MemoryDataSourceTestStore(),
  })
  await assert.rejects(service.runTest({ integrationId: 'alpha', kind: 'capability_sample', capabilityId: 'constructor' }), { code: 'unsupported_test' })
})

test('returns and persists a declared capability sample with an underscore ID', async () => {
  const root = await mkdtemp(join(tmpdir(), 'data-source-capability-'))
  let calls = 0
  const base = definition()
  const service = createDataSourceAdministrationService({
    definitions: [definition({
      descriptor: { ...base.descriptor, supportedTests: { connection: false, capabilitySamples: ['quote_v1'] } },
      capabilitySamples: { quote_v1: async () => { calls++ } },
    })],
    credentials: credentialStore(), tests: new FileDataSourceTestStore(root),
  })
  const summary = await service.runTest({ integrationId: 'alpha', kind: 'capability_sample', capabilityId: 'quote_v1' })
  assert.equal(summary.status, 'passed')
  assert.equal(summary.capabilityId, 'quote_v1')
  assert.equal(calls, 1)
  assert.equal((await new FileDataSourceTestStore(root).list('alpha'))[0]?.capabilityId, 'quote_v1')
})

test('runs exactly one bounded adapter test without source fallback', async () => {
  let connectionCalls = 0; let sampleCalls = 0
  const service = createDataSourceAdministrationService({ definitions: [definition({ testConnection: async () => { connectionCalls++ }, capabilitySamples: { quote: async () => { sampleCalls++ } } })], credentials: credentialStore(), tests: new MemoryDataSourceTestStore() })
  const result = await service.runTest({ integrationId: 'alpha', kind: 'connection' })
  assert.equal(result.status, 'passed')
  assert.equal(connectionCalls, 1)
  assert.equal(sampleCalls, 0)
  assert.deepEqual(Object.keys(result).sort(), ['completedAt', 'integrationId', 'kind', 'startedAt', 'status'])
})

test('aborts a supported adapter operation when the caller cancels', async () => {
  const controller = new AbortController()
  let received: AbortSignal | undefined
  const service = createDataSourceAdministrationService({ definitions: [definition({ testConnection: async (signal) => { received = signal; await new Promise<void>(() => {}) } })], credentials: credentialStore(), tests: new MemoryDataSourceTestStore() })
  const pending = service.runTest({ integrationId: 'alpha', kind: 'connection' }, controller.signal)
  await new Promise((resolve) => setTimeout(resolve, 0))
  controller.abort()
  const result = await pending
  assert.equal(received?.aborted, true)
  assert.equal(result.status, 'cancelled')
})

test('maps timeout, rate limit, access denial, no data, and contract mismatch to stable codes', async () => {
  for (const [message, code] of [['missing configuration', 'missing_configuration'], ['rate limit 429', 'rate_limited'], ['403 forbidden', 'access_denied'], ['empty response', 'no_data'], ['invalid schema', 'contract_mismatch'], ['401 unauthorized', 'authentication_failed'], ['opaque failure', 'provider_failed']] as const) {
    const service = createDataSourceAdministrationService({ definitions: [definition({ testConnection: async () => { throw new Error(message) } })], credentials: credentialStore(), tests: new MemoryDataSourceTestStore() })
    assert.equal((await service.runTest({ integrationId: 'alpha', kind: 'connection' })).errorCode, code)
  }
  const timeoutService = createDataSourceAdministrationService({ definitions: [definition({ testTimeoutMs: 5, testConnection: async () => new Promise<void>(() => {}) })], credentials: credentialStore(), tests: new MemoryDataSourceTestStore() })
  assert.equal((await timeoutService.runTest({ integrationId: 'alpha', kind: 'connection' })).errorCode, 'timeout')
})

test('redacts secrets and provider bodies from failed test summaries', async () => {
  const secret = 'sk-secret-value'
  const credentials = credentialStore()
  credentials.values.set('alpha', { token: secret })
  const tests = new MemoryDataSourceTestStore()
  const service = createDataSourceAdministrationService({ definitions: [definition({ testConnection: async () => { throw new Error(`provider body: ${secret}`) } })], credentials, tests })
  const result = await service.runTest({ integrationId: 'alpha', kind: 'connection' })
  assert.equal(result.errorCode, 'provider_failed')
  assert.equal(JSON.stringify(result).includes(secret), false)
  assert.equal(JSON.stringify(await tests.list('alpha')).includes('provider body'), false)
})

test('persists only sanitized latest test summaries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'data-source-tests-'))
  const tests = new FileDataSourceTestStore(root)
  let calls = 0
  const service = createDataSourceAdministrationService({ definitions: [definition({ testConnection: async () => { calls++; if (calls === 1) throw new Error('raw provider body') } })], credentials: credentialStore(), tests })
  await service.runTest({ integrationId: 'alpha', kind: 'connection' })
  await service.runTest({ integrationId: 'alpha', kind: 'connection' })
  assert.equal((await new FileDataSourceTestStore(root).list('alpha')).length, 1)
  assert.equal((await tests.list('alpha'))[0]?.status, 'passed')
  const disk = await readFile(join(root, 'data-source-test-summaries.json'), 'utf8')
  assert.equal(disk.includes('raw provider body'), false)
})
