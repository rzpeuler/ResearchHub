import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { fauxProvider } from '@earendil-works/pi-ai'
import { COMMON_DATA_CATALOG } from '../../../data/common-catalog.ts'
import { INDUSTRY_IDENTITIES, createIndustryDataCatalog, industryMetricId, type IndustryMetricDefinition } from '../../../data/industry-catalog.ts'
import { createResearchHubApplicationRuntime } from '../../../app/runtime/application-runtime.ts'
import { ResearchHubRuntimeServer } from '../../../app/runtime/server.ts'

function discoveredMetric(): IndustryMetricDefinition {
  const metricId = industryMetricId('lithium_battery', 'http-test-output')
  return {
    metricId,
    industryId: 'lithium_battery',
    metricFamily: 'battery-output',
    semanticRole: 'production_volume',
    name: 'Test battery output',
    description: 'A test-only discovery record; never added to production Catalog definitions.',
    dataKind: 'timeseries',
    lifecycleStatus: 'DISCOVERED',
    sourcePolicies: [],
    discoveredFrom: 'HTTP projection test',
  }
}

async function fixture(industryDataCatalog = createIndustryDataCatalog()) {
  const root = await mkdtemp(join(tmpdir(), 'data-catalog-routes-'))
  const cwd = join(root, 'cwd'), workspace = join(root, 'workspace'), agentDir = join(root, 'agent')
  await Promise.all([mkdir(cwd), mkdir(workspace), mkdir(agentDir)])
  const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false })
  const provider = fauxProvider({ provider: `catalog-http-${Date.now()}-${Math.random()}`, models: [{ id: 'fixture-model' }] })
  modelRuntime.registerNativeProvider(provider.provider)
  let acquisitionCalls = 0
  const runtime = await createResearchHubApplicationRuntime({
    cwd,
    agentDir,
    workspaceRoot: workspace,
    modelRuntime,
    model: provider.getModel(),
    startDailyScheduler: false,
    industryDataCatalog,
    industryOperatingObservationAcquisition: {
      async acquire() {
        acquisitionCalls += 1
        return { status: 'SOURCE_UNAVAILABLE', observations: [], sources: [], diagnostics: [] }
      },
    },
    reasoningExecutor: {
      capabilities: () => ({ maxContextTokens: 32_000, maxOutputTokens: 2_000, structuredOutputSupport: true, maxConcurrency: 1 }),
      async execute(request) { return { operation: request.operation, output: {} } },
    },
  })
  const server = new ResearchHubRuntimeServer({ runtime, clientRoot: join(root, 'missing-client'), port: 0 })
  await server.start()
  const info = server.address!
  const headers = { origin: info.origin, 'x-researchhub-runtime-token': info.runtimeToken, 'content-type': 'application/json' }
  return {
    root, runtime, server, modelRuntime, info, headers, industryDataCatalog,
    get acquisitionCalls() { return acquisitionCalls },
  }
}

async function close(f: Awaited<ReturnType<typeof fixture>>) {
  await f.server.close()
  await f.runtime.close()
  await Promise.resolve((f.modelRuntime as unknown as { dispose?: () => void | Promise<void> }).dispose?.()).catch(() => undefined)
  await rm(f.root, { recursive: true, force: true })
}

test('GET common catalog projects complete definitions without provider calls', async () => {
  const f = await fixture()
  try {
    const response = await fetch(`${f.info.origin}/api/data-sources/catalog/common`, { headers: { origin: f.info.origin } })
    assert.equal(response.status, 200)
    const body = await response.json() as { definitions: readonly Record<string, unknown>[]; definitionCount: number }
    assert.equal(body.definitionCount, COMMON_DATA_CATALOG.length)
    assert.equal(body.definitions.length, COMMON_DATA_CATALOG.length)
    assert.equal(new Set(body.definitions.map((item) => item.metricId)).size, COMMON_DATA_CATALOG.length)
    assert.deepEqual(body.definitions.map((item) => [item.metricId, item.meaning, item.dataKind, item.consumers]), [...COMMON_DATA_CATALOG].sort((a, b) => a.metricId.localeCompare(b.metricId)).map((item) => [item.metricId, item.meaning, item.dataKind, item.consumers]))
    assert.equal(f.acquisitionCalls, 0)
  } finally { await close(f) }
})

test('GET industry catalog reads the runtime injected instance', async () => {
  const catalog = createIndustryDataCatalog([discoveredMetric()])
  const before = catalog.list()
  const f = await fixture(catalog)
  try {
    assert.equal(f.runtime.industryDataCatalog, catalog)
    const response = await fetch(`${f.info.origin}/api/data-sources/catalog/industry`, { headers: { origin: f.info.origin } })
    assert.equal(response.status, 200)
    const body = await response.json() as { identities: readonly unknown[]; definitions: readonly Record<string, unknown>[]; registeredIndustryCount: number; definitionCount: number; canonicalCount: number }
    assert.deepEqual(body.identities, INDUSTRY_IDENTITIES)
    assert.equal(body.registeredIndustryCount, INDUSTRY_IDENTITIES.length)
    assert.equal(body.definitionCount, 1)
    assert.equal(body.canonicalCount, 0)
    assert.equal(body.definitions[0]?.metricId, before[0]?.metricId)
    assert.equal(body.definitions[0]?.lifecycleStatus, 'DISCOVERED')
    assert.deepEqual(catalog.list(), before)
    assert.equal(f.acquisitionCalls, 0)
  } finally { await close(f) }
})

test('catalog projection routes are read-only and redact local/provider details', async () => {
  const catalog = createIndustryDataCatalog([discoveredMetric()])
  const before = catalog.list()
  const f = await fixture(catalog)
  try {
    const common = await fetch(`${f.info.origin}/api/data-sources/catalog/common`, { headers: { origin: f.info.origin } })
    const industry = await fetch(`${f.info.origin}/api/data-sources/catalog/industry`, { headers: { origin: f.info.origin } })
    const serialized = `${await common.text()} ${await industry.text()}`
    assert.doesNotMatch(serialized, /provider-secret|apiKey|credentialValue|runtimeToken|C:\\\\Users\\\\|C:\/Users\//iu)
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const response = await fetch(`${f.info.origin}/api/data-sources/catalog/industry`, { method, headers: f.headers, body: method === 'DELETE' ? undefined : '{}' })
      assert.ok(response.status < 200 || response.status >= 300, `${method} must not be accepted`)
    }
    assert.deepEqual(catalog.list(), before)
    assert.equal(f.acquisitionCalls, 0)
  } finally { await close(f) }
})
