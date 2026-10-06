import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createDailyIntelligenceComposition } from '../../../app/services/daily-intelligence-composition.ts'
import { createDataSourceAdministrationService } from '../../../app/services/data-source-administration.ts'
import { industryOperatingIntegration, mergeSourceIntegrations, sourceIntegration } from '../../../app/services/data-source-integrations.ts'
import { MemoryDataSourceTestStore } from '../../../app/services/data-source-test-store.ts'
import { WorkflowService } from '../../../app/services/workflow-service.ts'
import { createResearchHubApplicationRuntime } from '../../../app/runtime/application-runtime.ts'
import { fauxProvider } from '@earendil-works/pi-ai'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { createFreshKnowledgeBaseV04 } from '../../../knowledge/storage/create-v04.ts'
import type { IndustryOperatingObservationAcquisitionPort } from '../../../plugins/research-acquisition/industry-operating-observations.ts'

async function daily(platforms: readonly { platform: string; status: 'active' | 'metadata_only'; category?: string; accountId?: string }[], industry?: IndustryOperatingObservationAcquisitionPort) {
  const root = await mkdtemp(join(tmpdir(), 'data-source-integrations-'))
  const catalogPath = join(root, 'catalog.yaml')
  await writeFile(catalogPath, JSON.stringify(platforms.map(({ platform, status, category, accountId }) => ({ platform, accountId: accountId ?? platform, category: category ?? 'official', acquisitionMode: 'api', catalogRole: 'active_feed', operationalStatus: status, enabled: status === 'active', discoveryUrl: 'https://example.com/feed' }))), 'utf8')
  try {
    return await createDailyIntelligenceComposition({ cwd: process.cwd(), catalogPath, runtimeRoot: root, workflowService: new WorkflowService(), ...(industry === undefined ? {} : { industryOperatingObservationAcquisition: industry }) })
  } finally { await rm(root, { recursive: true, force: true }) }
}

test('describes only explicitly assembled source integrations', async () => {
  const composition = await daily([{ platform: 'cninfo', status: 'active' }, { platform: 'gdelt', status: 'active' }, { platform: 'akshare', status: 'active' }])
  assert.deepEqual(composition.integrationDefinitions.map((definition) => definition.descriptor.integrationId), ['cninfo', 'gdelt', 'akshare', 'industry-operating'])
  assert.deepEqual(composition.providers.map((provider) => provider.name), ['official-disclosure-research-acquisition', 'gdelt-research-acquisition', 'akshare-daily-market-acquisition', 'd1-daily-expectation-revisions', 'akshare-institutional-activity', 'd4-daily-industry-observations'])
})

test('groups operations for the same upstream integration and unions capabilities', async () => {
  const composition = await daily([{ platform: 'akshare', status: 'active' }])
  const akshare = composition.integrationDefinitions.find((definition) => definition.descriptor.integrationId === 'akshare')
  assert.deepEqual(akshare?.descriptor.capabilities.map((capability) => capability.id), ['daily-market', 'expectation-revisions', 'institutional-activity'])
  assert.equal(composition.integrationDefinitions.filter((definition) => definition.descriptor.integrationId === 'akshare').length, 1)
})

test('merging one upstream retains source IDs from both operations', () => {
  const merged = mergeSourceIntegrations([
    sourceIntegration({ id: 'gov-cn', name: 'Gov.cn', sourceIds: ['source-rss'], capabilities: [{ id: 'policy-feed', label: 'Policy feed', metricIds: [] }] }),
    sourceIntegration({ id: 'gov-cn', name: 'Gov.cn', sourceIds: ['source-industry'], capabilities: [{ id: 'industry-policy-research', label: 'Industry policy research', metricIds: [] }] }),
  ])
  assert.equal(merged.length, 1)
  assert.deepEqual(merged[0]?.descriptor.sourceIds, ['source-rss', 'source-industry'])
  assert.deepEqual(merged[0]?.descriptor.capabilities.map((capability) => capability.id), ['policy-feed', 'industry-policy-research'])
})

test('does not list metadata-only Daily catalog entries as executable integrations', async () => {
  const composition = await daily([{ platform: 'xueqiu', status: 'metadata_only' }, { platform: 'akshare', status: 'metadata_only' }, { platform: 'cninfo', status: 'metadata_only' }])
  assert.deepEqual(composition.integrationDefinitions.map((definition) => definition.descriptor.integrationId), ['industry-operating'])
  assert.deepEqual(composition.providers.map((provider) => provider.name), ['d4-daily-industry-observations'])
})

test('describes active institutional and community providers grouped by platform', async () => {
  const composition = await daily([
    { platform: 'institution-site', status: 'active', category: 'institution', accountId: 'one' },
    { platform: 'institution-site', status: 'active', category: 'institution', accountId: 'two' },
    { platform: 'community-site', status: 'active', category: 'community' },
    { platform: 'metadata-site', status: 'metadata_only', category: 'community' },
  ])
  assert.deepEqual(composition.providers.map((provider) => provider.name), ['d4-daily-industry-observations', 'web-research-institution-site', 'web-research-institution-site', 'web-research-community-site'])
  assert.deepEqual(composition.integrationDefinitions.map((definition) => definition.descriptor.displayName), ['Industry operating observations', 'institution-site', 'community-site'])
  assert.deepEqual(composition.integrationDefinitions.find((definition) => definition.descriptor.displayName === 'institution-site')?.descriptor.capabilities.map((capability) => capability.id), ['public-institutional-views'])
})

test('declares test support only when a bounded adapter callback exists', async () => {
  const composition = await daily([{ platform: 'gdelt', status: 'active' }, { platform: 'cninfo', status: 'active' }])
  for (const definition of composition.integrationDefinitions) {
    assert.equal(definition.descriptor.supportedTests.connection, typeof definition.testConnection === 'function')
    assert.deepEqual(definition.descriptor.supportedTests.capabilitySamples, Object.keys(definition.capabilitySamples ?? {}))
  }
  assert.deepEqual(composition.integrationDefinitions.find((definition) => definition.descriptor.integrationId === 'gdelt')?.descriptor.supportedTests.capabilitySamples, [])
  assert.deepEqual(composition.integrationDefinitions.find((definition) => definition.descriptor.integrationId === 'industry-operating')?.descriptor.supportedTests.capabilitySamples, ['industry-operating-observations'])
})

test('custom industry acquisition remains listed without a test callback', async () => {
  let calls = 0
  const custom: IndustryOperatingObservationAcquisitionPort = { acquire: async () => { calls++; return { status: 'SCOPE_UNSUPPORTED', observations: [], sources: [], diagnostics: [] } } }
  const composition = await daily([], custom)
  const definition = composition.integrationDefinitions.find((item) => item.descriptor.integrationId === 'industry-operating')!
  assert.deepEqual(definition.descriptor.supportedTests.capabilitySamples, [])
  assert.equal(definition.capabilitySamples, undefined)
  const service = createDataSourceAdministrationService({ definitions: composition.integrationDefinitions, credentials: { read: async () => undefined, write: async () => {}, has: async () => false, delete: async () => {} }, tests: new MemoryDataSourceTestStore() })
  await assert.rejects(service.runTest({ integrationId: 'industry-operating', kind: 'capability_sample', capabilityId: 'industry-operating-observations' }), { code: 'unsupported_test' })
  assert.equal(calls, 0)
})

test('enforces each integration test timeout and forwards cancellation to provider operations', async () => {
  let received: AbortSignal | undefined
  const industry: IndustryOperatingObservationAcquisitionPort = {
    acquire: async (request) => {
      received = request.signal
      await new Promise<void>(() => {})
      return { status: 'SCOPE_UNSUPPORTED', observations: [], sources: [], diagnostics: [] }
    },
  }
  const definition = industryOperatingIntegration(industry, true)
  const service = createDataSourceAdministrationService({
    definitions: [{ ...definition, testTimeoutMs: 5 }],
    credentials: { read: async () => undefined, write: async () => {}, has: async () => false, delete: async () => {} },
    tests: new MemoryDataSourceTestStore(),
  })
  const result = await service.runTest({ integrationId: 'industry-operating', kind: 'capability_sample', capabilityId: 'industry-operating-observations' })
  assert.equal(result.errorCode, 'timeout')
  assert.equal(received?.aborted, true)
})

test('sample rejects an observation that does not belong to the fetched source', async () => {
  const industry: IndustryOperatingObservationAcquisitionPort = {
    acquire: async () => ({
      status: 'COMPLETED', diagnostics: [],
      observations: [{ sourceCandidateId: 'other-source', publicationPit: 'VERIFIED', valueVersionPit: 'UNVERIFIED', publishedAt: '2025-02-27T00:00:00.000Z', periodStart: '2024-01-01', periodEnd: '2024-12-31' }] as unknown as Awaited<ReturnType<IndustryOperatingObservationAcquisitionPort['acquire']>>['observations'],
      sources: [{ candidate: { candidateId: 'real-source' } }] as unknown as Awaited<ReturnType<IndustryOperatingObservationAcquisitionPort['acquire']>>['sources'],
    }),
  }
  const service = createDataSourceAdministrationService({ definitions: [industryOperatingIntegration(industry, true)], credentials: { read: async () => undefined, write: async () => {}, has: async () => false, delete: async () => {} }, tests: new MemoryDataSourceTestStore() })
  const result = await service.runTest({ integrationId: 'industry-operating', kind: 'capability_sample', capabilityId: 'industry-operating-observations' })
  assert.equal(result.errorCode, 'contract_mismatch')
})

test('Application Runtime exposes assembled integrations without a Knowledge Base', async () => {
  const root = await mkdtemp(join(tmpdir(), 'data-source-runtime-'))
  const cwd = join(root, 'cwd')
  const agentDir = join(root, 'agent')
  await mkdir(cwd, { recursive: true })
  await mkdir(agentDir, { recursive: true })
  const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false })
  const faux = fauxProvider({ provider: `data-source-${Date.now()}`, models: [{ id: 'fixture-model' }] })
  modelRuntime.registerNativeProvider(faux.provider)
  let runtime: Awaited<ReturnType<typeof createResearchHubApplicationRuntime>> | undefined
  try {
    runtime = await createResearchHubApplicationRuntime({ cwd, agentDir, modelRuntime, model: faux.getModel(), startDailyScheduler: false })
    const views = await runtime.services.dataSourceAdministrationService!.listIntegrations()
    assert.deepEqual(views.map((view) => view.integration.integrationId), ['industry-operating'])
  } finally {
    await runtime?.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('Application Runtime groups Company and Theme operations by upstream integration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'data-source-research-runtime-'))
  const cwd = join(root, 'cwd')
  const agentDir = join(root, 'agent')
  const kb = join(root, 'knowledge-base')
  await mkdir(cwd, { recursive: true })
  await mkdir(agentDir, { recursive: true })
  await mkdir(join(cwd, 'config', 'research-sources'), { recursive: true })
  await writeFile(join(cwd, 'config', 'research-sources', 'catalog.yaml'), JSON.stringify([{ platform: 'gov.cn', accountId: 'policy-feed', category: 'official', acquisitionMode: 'rss', catalogRole: 'active_feed', operationalStatus: 'active', enabled: true }]), 'utf8')
  await createFreshKnowledgeBaseV04(kb, { knowledgeBaseId: 'kb-data-source-runtime', now: '2026-10-06T00:00:00.000Z' })
  const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false })
  const faux = fauxProvider({ provider: `data-source-research-${Date.now()}`, models: [{ id: 'fixture-model' }] })
  modelRuntime.registerNativeProvider(faux.provider)
  let runtime: Awaited<ReturnType<typeof createResearchHubApplicationRuntime>> | undefined
  try {
    runtime = await createResearchHubApplicationRuntime({ cwd, agentDir, mountedKnowledgeBaseRoot: kb, workspaceRoot: join(root, 'workspace'), modelRuntime, model: faux.getModel(), startDailyScheduler: false })
    const views = await runtime.services.dataSourceAdministrationService!.listIntegrations()
    assert.deepEqual(views.map((view) => view.integration.integrationId), ['gov-cn', 'industry-operating', 'cninfo', 'gdelt', 'akshare', 'miit', 'eastmoney-industry', 'cpca'])
    const gov = views.find((view) => view.integration.integrationId === 'gov-cn')!
    assert.deepEqual(gov.integration.capabilities.map((capability) => capability.id), ['policy-feed', 'industry-policy-research'])
    assert.deepEqual(gov.integration.sourceIds, [])
    const akshare = views.find((view) => view.integration.integrationId === 'akshare')!
    assert.deepEqual(akshare.integration.capabilities.map((capability) => capability.id), ['company-market-and-financials', 'company-expectations', 'exchange-qa', 'industry-structured-data'])
    assert.equal(akshare.policyLinked, true)
  } finally {
    await runtime?.close()
    await rm(root, { recursive: true, force: true })
  }
})
