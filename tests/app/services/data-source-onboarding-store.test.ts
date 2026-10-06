import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createDataSourceOnboardingService, type DataSourceOnboardingDraftInput } from '../../../app/services/data-source-onboarding-store.ts'
import type { DataSourceIntegrationView, DataSourceTestSummary } from '../../../app/services/data-source-administration-contracts.ts'

const valid: DataSourceOnboardingDraftInput = {
  integrationId: 'new-provider', displayName: 'New Provider', documentationUrl: 'https://provider.example/docs',
  accessMode: 'api', publisher: 'Example Publisher', proposedAuthority: 'S2_PROFESSIONAL',
  capabilityIds: ['quote', 'news'], metricIds: ['price'], authenticationMode: 'api_key',
  termsUrl: 'https://provider.example/terms', rightsNotes: 'Licensed research use',
  rateLimitNotes: '100 requests per minute', timeBoundaryNotes: 'Daily close, UTC', providerTermsReviewed: true,
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'source-onboarding-'))
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) }
}

function view(id: string, tests: readonly DataSourceTestSummary[] = [], supported = { connection: true, capabilitySamples: ['quote', 'news'] }): DataSourceIntegrationView {
  return {
    integration: { integrationId: id, displayName: 'Adapter', sourceIds: [], credentialFields: [],
      capabilities: [], supportedTests: supported },
    credentialState: 'not_required', policyLinked: false, latestTests: tests,
  }
}

function passed(kind: 'connection' | 'capability_sample', capabilityId?: string, status: DataSourceTestSummary['status'] = 'passed'): DataSourceTestSummary {
  return { integrationId: 'new-provider', kind, ...(capabilityId ? { capabilityId } : {}), status,
    startedAt: '2026-10-06T00:00:00.000Z', completedAt: '2026-10-06T00:00:01.000Z' }
}

test('creates and reloads a draft using local runtime-data storage', async () => {
  const { root, cleanup } = await fixture()
  try {
    const service = createDataSourceOnboardingService({ root })
    const created = await service.create({ ...valid, displayName: '' })
    assert.match(created.requestId, /^[0-9a-f-]{36}$/)
    assert.equal(created.status, 'draft')
    assert.equal((await createDataSourceOnboardingService({ root }).list())[0]?.requestId, created.requestId)
    const edited = await service.update(created.requestId, { ...valid, integrationId: 'new-provider-v2' })
    assert.equal(edited.requestId, created.requestId)
    assert.equal(edited.input.integrationId, 'new-provider-v2')
    const ready = await service.markReady(created.requestId)
    assert.equal(ready.status, 'ready_for_adapter')
    await assert.rejects(service.update(created.requestId, valid))
    assert.equal((await createDataSourceOnboardingService({ root }).list())[0]?.status, 'ready_for_adapter')
    assert.equal(JSON.parse(await readFile(join(root, 'source-onboarding', 'drafts.json'), 'utf8'))[0]?.status, 'ready_for_adapter')
  } finally { await cleanup() }
})

test('rejects credentials, arbitrary executable fields, and invalid documentation URLs', async () => {
  const { root, cleanup } = await fixture()
  try {
    const service = createDataSourceOnboardingService({ root })
    for (const extra of [{ apiKey: 'secret' }, { script: 'process.exit()' }, { testEndpoint: 'https://x.test' }]) {
      await assert.rejects(service.create({ ...valid, ...extra }))
    }
    for (const url of ['http://provider.example/docs', 'https://user:pass@provider.example/docs', 'https://provider.example/docs#fragment',
      'https://provider.example/docs?api_key=abc', 'https://provider.example/docs?token=abc']) {
      await assert.rejects(service.create({ ...valid, documentationUrl: url }))
      await assert.rejects(service.create({ ...valid, termsUrl: url }))
    }
    for (const id of ['Bad_ID', '-bad', 'bad--id', 'a'.repeat(65)]) await assert.rejects(service.create({ ...valid, integrationId: id }))
    await service.create(valid)
    await assert.rejects(service.create(valid))
    await assert.rejects(service.create({ ...valid, integrationId: 'other', capabilityIds: ['quote', 'quote'] }))
    await assert.rejects(service.create({ ...valid, integrationId: 'other', metricIds: Array.from({ length: 33 }, (_, i) => `m${i}`) }))
    await assert.rejects(service.create({ ...valid, integrationId: 'other', displayName: 'x'.repeat(121) }))
    await assert.rejects(service.create({ ...valid, integrationId: 'other', rightsNotes: 'x'.repeat(2001) }))
  } finally { await cleanup() }
})

test('rejects secret-like values in notes and credential-bearing URL parameters', async () => {
  const { root, cleanup } = await fixture()
  try {
    const service = createDataSourceOnboardingService({ root })
    for (const note of ['Bearer abcdefghijklmnop', 'api_key=abc', 'token = abc', 'secret: abc', 'password=abc',
      'access_token=abc', 'client_secret: abc', 'api-key = abc', 'APIKEY=abc', 'Access.Token=abc',
      'auth=abc', 'AUTHORIZATION: abc', 'credential=abc', 'credentials: abc', 'auth-orization=abc', 'creden_tials=abc']) {
      await assert.rejects(service.create({ ...valid, rightsNotes: note }))
    }
    for (const key of ['key', 'api_key', 'token', 'secret', 'password', 'access_token', 'client_secret', 'apikey',
      'access-token', 'Client.Secret', 'API-Key', 'auth', 'AUTHORIZATION', 'credential', 'credentials',
      'auth-orization', 'creden_tials']) {
      await assert.rejects(service.create({ ...valid, documentationUrl: `https://provider.example/docs?${key}=abc` }))
      await assert.rejects(service.create({ ...valid, termsUrl: `https://provider.example/terms?${key}=abc` }))
    }
    assert.deepEqual(await service.list(), [])
    const ordinary = await service.create({ ...valid, integrationId: 'ordinary-words', rightsNotes: 'The monkey habitat is public; monkey=abc',
      documentationUrl: 'https://provider.example/docs?monkey=abc' })
    assert.equal(ordinary.status, 'draft')
  } finally { await cleanup() }
})

test('bounds the complete persisted draft to sixteen KiB', async () => {
  const { root, cleanup } = await fixture()
  try {
    const large = {
      ...valid,
      documentationUrl: `https://provider.example/docs?note=${'x'.repeat(2000)}`,
      termsUrl: `https://provider.example/terms?note=${'x'.repeat(2000)}`,
      capabilityIds: Array.from({ length: 32 }, (_, i) => `c${i}${'x'.repeat(61)}`),
      metricIds: Array.from({ length: 32 }, (_, i) => `m${i}${'x'.repeat(61)}`),
      rateLimitNotes: '"'.repeat(1500), timeBoundaryNotes: '"'.repeat(1500),
    }
    const baseSize = Buffer.byteLength(JSON.stringify({ ...large, rightsNotes: '' }), 'utf8')
    const input = { ...large, rightsNotes: '"'.repeat(Math.floor((16320 - baseSize) / 2)) }
    assert.ok(input.rightsNotes.length <= 2000)
    assert.ok(Buffer.byteLength(JSON.stringify(input), 'utf8') < 16 * 1024)
    await assert.rejects(createDataSourceOnboardingService({ root }).create(input))
  } finally { await cleanup() }
})

test('keeps an unsupported draft out of Runtime integration listings and tests', async () => {
  const { root, cleanup } = await fixture()
  try {
    const service = createDataSourceOnboardingService({ root, integrations: { listIntegrations: async () => [view('existing')] } })
    const draft = await service.create(valid)
    assert.equal((await service.list())[0]?.status, 'draft')
    assert.equal((await service.markReady(draft.requestId)).status, 'ready_for_adapter')
    assert.equal((await service.list())[0]?.status, 'ready_for_adapter')
  } finally { await cleanup() }
})

test('derives adapter availability only from a matching explicit integration ID', async () => {
  const { root, cleanup } = await fixture()
  try {
    let inventory = [view('new-provider-other')]
    const service = createDataSourceOnboardingService({ root, integrations: { listIntegrations: async () => inventory } })
    const draft = await service.create(valid)
    await service.markReady(draft.requestId)
    assert.equal((await service.list())[0]?.status, 'ready_for_adapter')
    inventory = [view('new-provider')]
    assert.equal((await service.list())[0]?.status, 'adapter_available')
    inventory = []
    assert.equal((await service.list())[0]?.status, 'ready_for_adapter')
  } finally { await cleanup() }
})

test('does not mark a draft verified before metadata and supported tests pass', async () => {
  const { root, cleanup } = await fixture()
  try {
    let inventory = [view('new-provider', [], { connection: false, capabilitySamples: [] })]
    const service = createDataSourceOnboardingService({ root, integrations: { listIntegrations: async () => inventory } })
    const incomplete = await service.create({ ...valid, publisher: '', providerTermsReviewed: false })
    await assert.rejects(service.markReady(incomplete.requestId))
    await service.update(incomplete.requestId, valid)
    await service.markReady(incomplete.requestId)
    assert.equal((await service.list())[0]?.status, 'adapter_available')
    inventory = [view('new-provider', [passed('connection'), passed('capability_sample', 'quote')])]
    assert.equal((await service.list())[0]?.status, 'adapter_available')
    inventory = [view('new-provider', [passed('connection'), passed('capability_sample', 'quote'), passed('capability_sample', 'news', 'failed')])]
    assert.equal((await service.list())[0]?.status, 'adapter_available')
    inventory = [view('new-provider', [passed('connection'), passed('capability_sample', 'quote'), passed('capability_sample', 'news')])]
    assert.equal((await service.list())[0]?.status, 'verified')
    inventory = [view('new-provider', [passed('connection'), passed('capability_sample', 'quote'), passed('capability_sample', 'news'),
      { ...passed('capability_sample', 'news', 'failed'), completedAt: '2026-10-06T00:00:02.000Z' }])]
    assert.equal((await service.list())[0]?.status, 'adapter_available')
    assert.equal((await createDataSourceOnboardingService({ root }).list())[0]?.status, 'ready_for_adapter')
  } finally { await cleanup() }
})
