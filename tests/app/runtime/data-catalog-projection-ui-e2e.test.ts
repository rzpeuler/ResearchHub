import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { register } from 'node:module'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { fauxProvider } from '@earendil-works/pi-ai'
import { createIndustryDataCatalog, industryMetricId } from '../../../data/industry-catalog.ts'
import type { IndustryMetricDefinition } from '../../../data/industry-catalog.ts'
import { createResearchHubApplicationRuntime } from '../../../app/runtime/application-runtime.ts'
import { ResearchHubRuntimeServer } from '../../../app/runtime/server.ts'
import type { IndustryOperatingObservationAcquisitionPort } from '../../../plugins/research-acquisition/industry-operating-observations.ts'
import { COMMON_DATA_CATALOG } from '../../../data/common-catalog.ts'

register('./css-loader.mjs', import.meta.url)

test('Application Runtime → HTTP → RuntimeClient → DataSourcesPage renders Common and injected Industry data', async () => {
  const jsdomPackage = 'jsdom'
  const { JSDOM } = await import(jsdomPackage)
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' })
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent,
    getComputedStyle: dom.window.getComputedStyle,
  })
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

  const languageModulePath = '../../../client/src/i18n.tsx'
  const pageModulePath = '../../../client/src/app/data-sources/DataSourcesPage.tsx'
  const [{ act, render, screen, fireEvent, waitFor, cleanup }, React, languageModule, pageModule, { RuntimeClient }] = await Promise.all([
    import('@testing-library/react'), import('react'), import(languageModulePath), import(pageModulePath), import('../../../client/src/api/runtime-client.ts'),
  ])
  ;(globalThis as Record<string, unknown>).React = React
  const root = await mkdtemp(join(tmpdir(), 'data-catalog-page-e2e-'))
  const cwd = join(root, 'cwd'), workspace = join(root, 'workspace'), agentDir = join(root, 'agent')
  await Promise.all([mkdir(cwd), mkdir(workspace), mkdir(agentDir)])
  const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false })
  const faux = fauxProvider({ provider: `data-catalog-page-${Date.now()}-${Math.random()}`, models: [{ id: 'fixture-model' }] })
  modelRuntime.registerNativeProvider(faux.provider)
  const productionCatalog = createIndustryDataCatalog()
  const metricId = industryMetricId('lithium_battery', 'ui-integration-discovered-output')
  const injectedDefinition: IndustryMetricDefinition = {
    metricId, industryId: 'lithium_battery', metricFamily: 'production', semanticRole: 'production_volume',
    name: 'UI integration test output', description: 'Injected catalog definition for runtime projection verification.',
    dataKind: 'timeseries', lifecycleStatus: 'DISCOVERED', sourcePolicies: [], discoveredFrom: 'UI integration test only',
  }
  const injectedCatalog = createIndustryDataCatalog([injectedDefinition])
  let providerCalls = 0
  const acquisition: IndustryOperatingObservationAcquisitionPort = { async acquire() { providerCalls += 1; return { status: 'SOURCE_UNAVAILABLE', observations: [], sources: [], diagnostics: [] } } }
  const runtime = await createResearchHubApplicationRuntime({
    cwd, agentDir, workspaceRoot: workspace, modelRuntime, model: faux.getModel(), startDailyScheduler: false,
    industryDataCatalog: injectedCatalog, industryOperatingObservationAcquisition: acquisition,
    reasoningExecutor: { capabilities: () => ({ maxContextTokens: 32_000, maxOutputTokens: 2_000, structuredOutputSupport: true, maxConcurrency: 1 }), async execute(request) { return { operation: request.operation, output: {} } } },
  })
  const server = new ResearchHubRuntimeServer({ runtime, clientRoot: join(root, 'missing-client'), port: 0 })
  await server.start()
  const info = server.address!
  const calls: string[] = []
  const pendingRequests: Promise<Response>[] = []
  const client = new RuntimeClient(async (input, init) => {
    calls.push(String(input))
    const headers = new Headers(init?.headers)
    headers.set('origin', info.origin)
    const request = fetch(new URL(String(input), info.origin), { ...init, headers })
    pendingRequests.push(request)
    return request
  })

  try {
    assert.equal(runtime.industryDataCatalog, injectedCatalog)
      assert.deepEqual(productionCatalog.list(), [])
      assert.deepEqual(injectedCatalog.list(), [injectedDefinition])
      window.localStorage.setItem('researchhub.language', 'zh-CN')
      act(() => render(React.createElement(languageModule.LanguageProvider, null, React.createElement(pageModule.DataSourcesPage, { client }))))
      await waitFor(() => assert.equal(pendingRequests.length, 5))
      await act(async () => { await Promise.all(pendingRequests) })
      fireEvent.click(await screen.findByRole('tab', { name: '数据字段' }))
      const commonProjection = await client.getCommonDataCatalog()
      assert.equal(commonProjection.definitionCount, COMMON_DATA_CATALOG.length)
      for (const definition of COMMON_DATA_CATALOG) assert.ok(await screen.findByRole('button', { name: definition.metricId }))
      assert.ok(calls.includes('/api/data-sources/catalog/common'))

    fireEvent.click(screen.getByRole('tab', { name: '行业字段' }))
    fireEvent.change(screen.getByRole('textbox', { name: '搜索字段' }), { target: { value: metricId } })
    assert.ok(await screen.findByRole('button', { name: metricId }))
      fireEvent.click(screen.getByRole('button', { name: metricId }))
      assert.ok(await screen.findByRole('heading', { name: 'UI integration test output' }))
      assert.ok(calls.includes('/api/data-sources/catalog/industry'))
      const industryProjection = await client.getIndustryDataCatalog()
      assert.deepEqual(industryProjection.definitions, injectedCatalog.list())
    await waitFor(() => assert.equal(providerCalls, 0))
    assert.deepEqual(runtime.industryDataCatalog.list(), [injectedDefinition])
    assert.deepEqual(productionCatalog.list(), [])
  } finally {
    cleanup()
    await server.close()
    await runtime.close()
    await Promise.resolve((modelRuntime as unknown as { dispose?: () => void | Promise<void> }).dispose?.()).catch(() => undefined)
    await rm(root, { recursive: true, force: true })
    dom.window.close()
    Object.assign(globalThis, { window: undefined, document: undefined, HTMLElement: undefined, Node: undefined, Event: undefined, MouseEvent: undefined, getComputedStyle: undefined })
    delete (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT
    delete (globalThis as Record<string, unknown>).React
  }
})
