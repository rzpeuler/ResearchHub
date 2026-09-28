import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { fauxProvider } from '@earendil-works/pi-ai'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { createFreshKnowledgeBaseV04 } from '../knowledge/storage/create-v04.ts'
import { validateKnowledgeBaseV04State } from '../knowledge/validation/v04-change-set-validator.ts'
import { readCanonicalV04Assets } from '../knowledge/storage/canonical-v04-loader.ts'
import { KnowledgeBaseRegistry } from '../knowledge/registry/registry.ts'
import { archiveRaw } from '../knowledge/raw/raw-archive.ts'
import { createResearchHubApplicationRuntime } from '../app/runtime/application-runtime.ts'
import { ResearchHubRuntimeServer } from '../app/runtime/server.ts'
import type { ReasoningCapabilities, ReasoningExecutor, ReasoningRequest, ReasoningResult } from '../plugins/reasoning/contracts.ts'

const at = '2026-09-20T10:00:00.000Z'
const active = { status: 'active', validFrom: null, validUntil: null }
const historical = { status: 'superseded', validFrom: null, validUntil: null }
const capabilities: ReasoningCapabilities = { maxContextTokens: 100_000, maxOutputTokens: 10_000, structuredOutputSupport: true, maxConcurrency: 4 }

class FixtureExecutor implements ReasoningExecutor {
  capabilities(): ReasoningCapabilities { return capabilities }
  async execute(request: ReasoningRequest): Promise<ReasoningResult> { return { operation: request.operation, output: {} } as ReasoningResult }
}

type FixtureAsset = { readonly type: string; readonly value: Record<string, unknown> }
const assets: readonly FixtureAsset[] = [
  { type: 'theme_group', value: { id: 'theme-group:technology', name: 'Technology', lifecycle: active } },
  { type: 'entity', value: { id: 'entity:ai-hardware', type: 'investment_theme', name: 'AI Hardware', aliases: ['AI accelerators'], description: 'Accelerator compute, memory, and packaging.', definition: 'Companies and technologies supplying AI accelerator infrastructure.', inclusionCriteria: ['AI accelerators', 'HBM', 'advanced packaging'], exclusionCriteria: ['consumer devices'], themeGroupRef: 'theme-group:technology', lifecycle: active } },
  { type: 'entity', value: { id: 'entity:robotics', type: 'investment_theme', name: 'Robotics', aliases: [], description: 'Robotics components and systems.', definition: 'Industrial and service robotics.', inclusionCriteria: ['robotics systems'], exclusionCriteria: [], themeGroupRef: 'theme-group:technology', lifecycle: active } },
  { type: 'entity', value: { id: 'entity:semiconductors', type: 'industry', name: 'Semiconductors', aliases: [], lifecycle: active } },
  { type: 'entity', value: { id: 'entity:accelerator-maker', type: 'company', name: 'Accelerator Maker', aliases: [], lifecycle: active } },
  { type: 'entity', value: { id: 'entity:fixture-bank', type: 'institution', institutionType: 'broker', name: 'Fixture Research Bank', aliases: [], lifecycle: active } },
  { type: 'entity', value: { id: 'entity:fixture-analyst', type: 'person', name: 'Fixture Analyst', aliases: [], lifecycle: active } },
  { type: 'relation', value: { id: 'relation:ai-hardware-industry', type: 'theme_exposure', sourceRef: 'entity:ai-hardware', targetRef: 'entity:semiconductors', contextRefs: ['entity:ai-hardware'], asOf: at, sourceRefs: ['source:public'], lifecycle: active } },
  { type: 'relation', value: { id: 'relation:robotics-industry', type: 'theme_exposure', sourceRef: 'entity:robotics', targetRef: 'entity:semiconductors', asOf: at, lifecycle: active } },
  { type: 'relation', value: { id: 'relation:industry-maker', type: 'business_exposure', sourceRef: 'entity:accelerator-maker', targetRef: 'entity:semiconductors', asOf: at, attributes: { exposureBasis: 'direct_operation', realizationStage: 'commercialized', materiality: 'material' }, lifecycle: active } },
  { type: 'claim', value: { id: 'claim:accelerator-demand', claimType: 'fact', statement: 'Accelerator demand remains elevated.', subjectRefs: ['entity:ai-hardware'], sourceRefs: ['source:public'], structuredValue: { metric: 'metric:revenue', value: 1, unit: 'index', comparator: 'eq', period: 'FY2026' }, createdAt: at, lifecycle: active } },
  { type: 'claim', value: { id: 'claim:historical-capacity', claimType: 'viewpoint', statement: 'Historical capacity outlook retained for review.', subjectRefs: ['entity:ai-hardware'], sourceRefs: ['source:public'], createdAt: '2025-01-01T00:00:00.000Z', lifecycle: historical } },
  { type: 'observation', value: { id: 'observation:industry-market-size', observationType: 'metric', subjectRef: 'entity:semiconductors', metricRef: 'metric:market_share', value: 32, unit: '%', period: 'FY2026', dimensions: { product: 'AI accelerators', region: 'global' }, sourceRef: 'source:public', observedAt: at, lifecycle: active } },
  { type: 'observation', value: { id: 'observation:maker-estimate', observationType: 'estimate', subjectRef: 'entity:accelerator-maker', metricRef: 'metric:revenue', fiscalPeriod: 'FY2027', estimateValue: 48, unit: 'USD bn', currency: 'USD', institutionRef: 'entity:fixture-bank', analystRef: 'entity:fixture-analyst', publishedAt: at, estimateHorizon: '12m', sourceRef: 'source:restricted', lifecycle: active } },
  { type: 'observation', value: { id: 'observation:maker-estimate-b', observationType: 'estimate', subjectRef: 'entity:accelerator-maker', metricRef: 'metric:revenue', fiscalPeriod: 'FY2027', estimateValue: 46, unit: 'USD bn', currency: 'USD', institutionRef: 'entity:fixture-bank', analystRef: 'entity:fixture-analyst', publishedAt: '2026-09-19T10:00:00.000Z', estimateHorizon: '12m', sourceRef: 'source:restricted', lifecycle: active } },
  { type: 'observation', value: { id: 'observation:maker-consensus', observationType: 'consensus', subjectRef: 'entity:accelerator-maker', metricRef: 'metric:revenue', fiscalPeriod: 'FY2027', asOf: at, mean: 47, median: 46, high: 52, low: 40, count: 2, dispersion: 4, contributingObservationRefs: ['observation:maker-estimate', 'observation:maker-estimate-b'], sourceRef: 'source:restricted', lifecycle: active } },
  { type: 'event', value: { id: 'event:accelerator-launch', eventType: 'product_launch', title: 'Accelerator platform launch', subjectRefs: ['entity:ai-hardware'], participantRefs: ['entity:accelerator-maker'], temporal: { occurredAt: at, announcedAt: at }, sourceRefs: ['source:public', 'source:restricted'], lifecycle: active } },
  { type: 'thesis', value: { id: 'thesis:ai-hardware', subjectRefs: ['entity:ai-hardware'], title: 'AI hardware adoption thesis', statement: 'Demand broadens as infrastructure investment expands.', status: 'active', createdAt: at, lastReviewedAt: at, lifecycle: active } },
  { type: 'reasoning_edge', value: { id: 'reasoning-edge:demand-thesis', type: 'supports', sourceRef: 'claim:accelerator-demand', targetRef: 'thesis:ai-hardware', sourceRefs: ['source:public'], confidence: 0.8, asOf: at, lifecycle: active } },
  { type: 'module', value: { id: 'module:ai-supply-chain', type: 'comparison', targetEntity: 'entity:ai-hardware', schemaId: 'supply-chain-v1', columns: [{ name: 'stage', type: 'string' }, { name: 'evidence', type: 'string' }], rows: [{ stage: 'Compute', evidence: 'Accelerators' }, { stage: 'Memory', evidence: 'HBM' }] } },
  { type: 'source', value: { id: 'source:public', title: 'Public exchange filing', publisher: 'Exchange', provider: 'fixture-feed', sourceType: 'official_disclosure', canonicalUrl: 'https://example.test/filing', publishedAt: at, retrievedAt: at, rights: { accessScope: 'public', providerTermsKnown: true, redistributionAllowed: false, retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true }, usagePolicy: { mode: 'personal_noncommercial_research', retainRaw: true, allowAiProcessing: true, allowDerivedKnowledge: true, redistributionAllowed: false }, lifecycle: active } },
  { type: 'source', value: { id: 'source:restricted', title: 'Restricted broker note', publisher: 'Broker', provider: 'fixture-private-feed', sourceType: 'sell_side_research', canonicalUrl: 'https://private.example.test/research', publishedAt: at, rights: { accessScope: 'restricted', providerTermsKnown: false, redistributionAllowed: 'conditional', retentionAllowed: false, aiProcessingAllowed: false, derivativeKnowledgeAllowed: true }, usagePolicy: { mode: 'personal_noncommercial_research', retainRaw: false, allowAiProcessing: true, allowDerivedKnowledge: true, redistributionAllowed: false }, lifecycle: active } },
]

const directories: Readonly<Record<string, string>> = { theme_group: 'theme-groups', entity: 'entities', relation: 'relations', claim: 'claims', source: 'sources', module: 'modules', event: 'events', observation: 'observations', thesis: 'theses', reasoning_edge: 'reasoning-edges' }

async function seedKnowledgeBase(root: string): Promise<void> {
  await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-topic-workspace-acceptance', name: 'Temporary Topic Workspace Acceptance KB', now: at })
  const registryHandle = await new KnowledgeBaseRegistry().mount(root)
  const publicRaw = await archiveRaw(registryHandle, { bytes: new TextEncoder().encode('Fixture public filing evidence.'), originalFilename: 'public-filing.txt', mediaType: 'text/plain' }, { clock: () => at })
  const privateRaw = await archiveRaw(registryHandle, { bytes: new TextEncoder().encode('Fixture restricted broker evidence.'), originalFilename: 'restricted-note.txt', mediaType: 'text/plain' }, { clock: () => at })
  const registry: Record<string, { type: string; storageRef: string }> = {}
  for (const asset of assets) {
    const id = String(asset.value.id)
    const storageRef = `${directories[asset.type]}/${id.replaceAll(':', '-')}.json`
    const value = { ...asset.value }
    if (id === 'source:public') Object.assign(value, { rawRefs: [publicRaw.manifest.rawRef], contentHash: publicRaw.manifest.contentHash.slice('sha256:'.length) })
    if (id === 'source:restricted') Object.assign(value, { rawRefs: [privateRaw.manifest.rawRef], contentHash: privateRaw.manifest.contentHash.slice('sha256:'.length) })
    if (id === 'claim:accelerator-demand' || id === 'claim:historical-capacity') Object.assign(value, { provenance: [{ sourceRef: 'source:public', rawRef: publicRaw.manifest.rawRef, locator: 'section 1', chunkRef: null }] })
    await writeFile(join(root, storageRef), `${JSON.stringify(value)}\n`, 'utf8')
    registry[id] = { type: asset.type, storageRef }
  }
  await writeFile(join(root, 'registry', 'assets.yaml'), `${JSON.stringify(registry)}\n`, 'utf8')
}

async function snapshot(root: string): Promise<string> {
  const entries: Array<[string, string]> = []
  const visit = async (directory: string, prefix = ''): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path, relative)
      else if (entry.isFile()) entries.push([relative, createHash('sha256').update(await readFile(path)).digest('hex')])
      else throw new Error(`Unexpected non-file in temporary Knowledge Base: ${relative}`)
    }
  }
  await visit(root)
  return JSON.stringify(entries.sort(([left], [right]) => left.localeCompare(right)))
}

async function json<T>(origin: string, path: string): Promise<{ readonly response: Response; readonly body: T }> {
  const response = await fetch(`${origin}${path}`)
  return { response, body: await response.json() as T }
}

async function verifyRuntime(origin: string, kbRoot: string): Promise<Record<string, unknown>> {
  const before = await snapshot(kbRoot)
  const directory = await json<Record<string, unknown>>(origin, '/api/knowledge/directory')
  assert.equal(directory.response.status, 200, 'Knowledge directory responds')
  assert.match(JSON.stringify(directory.body), /AI Hardware/, 'directory includes the dense theme')
  assert.match(JSON.stringify(directory.body), /Robotics/, 'directory includes the sparse theme')

  const graph = await json<Record<string, unknown>>(origin, `/api/knowledge/graph?rootRef=${encodeURIComponent('entity:ai-hardware')}&depth=2`)
  assert.equal(graph.response.status, 200, 'graph responds for the dense theme')
  const graphText = JSON.stringify(graph.body)
  assert.match(graphText, /entity:semiconductors/, 'shared industry is reachable')
  assert.match(graphText, /relation:ai-hardware-industry/, 'theme relation is present')
  assert.match(graphText, /relation:industry-maker/, 'second-hop company relation is present')
  assert.ok(graphText.indexOf('entity:ai-hardware') < graphText.indexOf('entity:semiconductors'), 'graph response retains the canonical theme endpoint')

  const topicPath = `/api/knowledge/topics/${encodeURIComponent('entity:ai-hardware')}`
  const summaryResult = await json<{ schemaVersion: string; revision: number; theme: { ref: string; name: string; themeGroupRef?: string }; counts: { direct: Record<string, { total: number }>; connected: Record<string, { total: number }> } }>(origin, `${topicPath}/summary?depth=2`)
  assert.equal(summaryResult.response.status, 200, 'topic summary responds')
  const summary = summaryResult.body
  assert.equal(summary.schemaVersion, '0.4')
  assert.equal(summary.theme.ref, 'entity:ai-hardware')
  assert.equal(summary.theme.name, 'AI Hardware')
  assert.equal(summary.theme.themeGroupRef, 'theme-group:technology')
  assert.equal(summary.counts.direct.claim.total, 1, 'default summary counts active direct claims only')
  assert.equal(summary.counts.direct.event.total, 1)
  assert.equal(summary.counts.direct.thesis.total, 1)
  assert.equal(summary.counts.direct.module.total, 1)
  assert.ok(summary.counts.connected.observation.total >= 3, 'connected context includes industry and company observations')

  const enumerated: Record<string, string[]> = {}
  for (const kind of ['relation', 'claim', 'observation', 'event', 'thesis', 'module', 'source', 'reasoning_edge']) {
    const refs: string[] = []
    let cursor: string | undefined
    do {
      const query = new URLSearchParams({ kind, scope: 'direct', limit: '1', expectedRevision: String(summary.revision) })
      if (kind === 'claim') query.set('lifecycle', 'all')
      if (cursor) query.set('cursor', cursor)
      const page = await json<{ revision: number; total: number; items: { ref: string }[]; nextCursor?: string }>(origin, `${topicPath}/items?${query}`)
      assert.equal(page.response.status, 200, `${kind} page responds`)
      assert.equal(page.body.revision, summary.revision, `${kind} page matches the summary revision`)
      refs.push(...page.body.items.map((item) => item.ref))
      cursor = page.body.nextCursor
      if (!cursor) assert.equal(page.body.total, refs.length, `${kind} pagination enumerates the exact direct total`)
    } while (cursor)
    enumerated[kind] = refs
  }
  assert.deepEqual(enumerated.claim, ['claim:accelerator-demand', 'claim:historical-capacity'])
  assert.ok(enumerated.relation.includes('relation:ai-hardware-industry'))
  assert.ok(enumerated.reasoning_edge.includes('reasoning-edge:demand-thesis'))
  assert.ok(enumerated.source.includes('source:public') && enumerated.source.includes('source:restricted'))

  const sourcePage = await json<{ items: { ref: string; fields: Record<string, unknown> }[] }>(origin, `${topicPath}/items?kind=source&scope=direct`)
  assert.equal(sourcePage.response.status, 200)
  assert.equal(sourcePage.body.items.find((item) => item.ref === 'source:public')?.fields.canonicalUrl, 'https://example.test/filing')
  assert.equal(sourcePage.body.items.find((item) => item.ref === 'source:restricted')?.fields.canonicalUrl, undefined)
  assert.doesNotMatch(JSON.stringify(sourcePage.body), /private\.example\.test|rawRefs|raw-sha256/)

  const connected = await json<{ items: { ref: string; associationPaths?: unknown[] }[]; total: number }>(origin, `${topicPath}/items?kind=observation&scope=connected&depth=2&limit=20`)
  assert.equal(connected.response.status, 200)
  const connectedRefs = connected.body.items.map((item) => item.ref)
  assert.ok(connectedRefs.includes('observation:industry-market-size'))
  assert.ok(connectedRefs.includes('observation:maker-estimate'))
  assert.ok(connectedRefs.includes('observation:maker-consensus'))
  assert.ok(connected.body.items.every((item) => (item.associationPaths?.length ?? 0) > 0), 'connected entries carry a proved association path')
  assert.ok(!connectedRefs.includes('observation:missing'), 'unregistered objects never appear as fabricated records')

  const sparsePath = `/api/knowledge/topics/${encodeURIComponent('entity:robotics')}`
  const sparseSummary = await json<{ theme: { name: string }; counts: { direct: Record<string, { total: number }> } }>(origin, `${sparsePath}/summary?depth=2`)
  assert.equal(sparseSummary.response.status, 200)
  assert.equal(sparseSummary.body.theme.name, 'Robotics')
  assert.equal(Object.values(sparseSummary.body.counts.direct).reduce((sum, value) => sum + value.total, 0), 1, 'sparse theme exposes only its direct relation')
  const sparseClaims = await json<{ total: number; items: unknown[] }>(origin, `${sparsePath}/items?kind=claim&scope=direct`)
  assert.equal(sparseClaims.response.status, 200)
  assert.equal(sparseClaims.body.total, 0)
  assert.deepEqual(sparseClaims.body.items, [])

  const canonical = await json<Record<string, unknown>>(origin, `/api/knowledge/object?ref=${encodeURIComponent('claim:accelerator-demand')}`)
  assert.equal(canonical.response.status, 200)
  assert.match(JSON.stringify(canonical.body), /Accelerator demand remains elevated/)

  const staticPage = await fetch(`${origin}/graph`)
  assert.equal(staticPage.status, 200, 'built /graph page is served by the real Runtime static handler')
  assert.match(staticPage.headers.get('content-type') ?? '', /text\/html/)
  assert.match(await staticPage.text(), /<html/i)

  const serialized = JSON.stringify({ directory: directory.body, graph: graph.body, summary, enumerated, connected: connected.body, sourcePage: sourcePage.body })
  for (const forbidden of ['private.example.test', 'rawRefs', 'raw-sha256']) assert.equal(serialized.includes(forbidden), false, `topic/list payload does not expose ${forbidden}`)
  assert.equal(await snapshot(kbRoot), before, 'runtime reads do not mutate the isolated Knowledge Base')

  return {
    schemaVersion: summary.schemaVersion,
    revision: summary.revision,
    themes: { dense: summary.theme.name, sparse: sparseSummary.body.theme.name },
    directEnumerated: Object.fromEntries(Object.entries(enumerated).map(([kind, refs]) => [kind, refs.length])),
    connectedObservationRefs: connectedRefs,
    graphEntityAndRelationCount: { entities: (graph.body as { nodes?: unknown[] }).nodes?.length ?? null, relations: (graph.body as { edges?: unknown[] }).edges?.length ?? null },
    staticGraphPage: staticPage.status,
    knowledgeBaseUnchanged: true,
    restrictedSourceContentExcluded: true,
  }
}

function parseMode(args: readonly string[]): 'check' | 'serve' {
  const modes = args.filter((arg) => arg === '--check' || arg === '--serve')
  if (args.some((arg) => !['--check', '--serve'].includes(arg)) || modes.length > 1) throw new Error('Usage: npm run acceptance:knowledge-topic-workspace [-- --check|--serve]')
  return modes[0] === '--serve' ? 'serve' : 'check'
}

export async function runKnowledgeTopicWorkspaceAcceptance(mode: 'check' | 'serve' = 'check'): Promise<void> {
  const tempRoot = await mkdtemp(join(tmpdir(), 'rhl-topic-workspace-acceptance-'))
  const kbRoot = join(tempRoot, 'schema-04-kb')
  const cwd = join(tempRoot, 'runtime-cwd')
  const agentDir = join(tempRoot, 'agent')
  const workspaceRoot = join(tempRoot, 'workspace')
  const clientRoot = resolve('dist/client')
  assert.ok(await readFile(join(clientRoot, 'index.html'), 'utf8').then(() => true).catch(() => false), 'Build the client first with npm run client:build')
  let modelRuntime: ModelRuntime | undefined
  let runtime: Awaited<ReturnType<typeof createResearchHubApplicationRuntime>> | undefined
  let server: ResearchHubRuntimeServer | undefined
  let stopResolve: (() => void) | undefined
  const stopSignal = new Promise<void>((resolveStop) => { stopResolve = resolveStop })
  const onSignal = (): void => stopResolve?.()
  try {
    await Promise.all([mkdir(cwd, { recursive: true }), mkdir(agentDir, { recursive: true }), mkdir(workspaceRoot, { recursive: true })])
    await seedKnowledgeBase(kbRoot)
    const validation = await validateKnowledgeBaseV04State(kbRoot)
    assert.equal(validation.status, 'passed', `fixture canonical validation passed: ${JSON.stringify(validation.errors)}`)
    const canonical = await readCanonicalV04Assets(kbRoot)
    assert.equal(canonical.objects.length, assets.length, 'every fixture object is reachable from the canonical registry')

    modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false })
    const faux = fauxProvider({ provider: `rhl-topic-workspace-${process.pid}`, models: [{ id: 'fixture-model' }] })
    modelRuntime.registerNativeProvider(faux.provider)
    runtime = await createResearchHubApplicationRuntime({ cwd, agentDir, mountedKnowledgeBaseRoot: kbRoot, workspaceRoot, modelRuntime, model: faux.getModel(), reasoningExecutor: new FixtureExecutor() })
    server = new ResearchHubRuntimeServer({ runtime, port: 0, clientRoot })
    const info = await server.start()
    const urls = {
      denseTheme: `${info.origin}/graph?themeRef=${encodeURIComponent('entity:ai-hardware')}`,
      sparseTheme: `${info.origin}/graph?themeRef=${encodeURIComponent('entity:robotics')}`,
    }
    if (mode === 'serve') {
      console.log(JSON.stringify({ mode, origin: info.origin, ...urls, knowledgeBase: 'temporary isolated Schema 0.4 fixture', stop: 'Ctrl+C' }, null, 2))
      process.on('SIGINT', onSignal)
      process.on('SIGTERM', onSignal)
      await stopSignal
      return
    }
    const result = await verifyRuntime(info.origin, kbRoot)
    console.log(JSON.stringify({ mode, origin: info.origin, urls, ...result }, null, 2))
  } finally {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
    if (server) await server.close().catch(() => undefined)
    if (runtime) await runtime.close().catch(() => undefined)
    await (modelRuntime as unknown as { readonly dispose?: () => void | Promise<void> } | undefined)?.dispose?.()
    await rm(tempRoot, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await runKnowledgeTopicWorkspaceAcceptance(parseMode(process.argv.slice(2))) } catch (error) { console.error(error); process.exitCode = 1 }
}
