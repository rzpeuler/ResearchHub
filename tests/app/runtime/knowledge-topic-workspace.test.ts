import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fauxProvider } from '@earendil-works/pi-ai'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { createFreshKnowledgeBaseV04 } from '../../../knowledge/storage/create-v04.ts'
import { createKnowledgeBase, removeKnowledgeBase } from '../../knowledge/helpers.ts'
import { createResearchHubApplicationRuntime } from '../../../app/runtime/application-runtime.ts'
import { ResearchHubRuntimeServer } from '../../../app/runtime/server.ts'
import { readCanonicalV04Assets } from '../../../knowledge/storage/canonical-v04-loader.ts'
import type { ReasoningCapabilities, ReasoningExecutor, ReasoningRequest, ReasoningResult } from '../../../plugins/reasoning/contracts.ts'

const capabilities: ReasoningCapabilities = { maxContextTokens: 100_000, maxOutputTokens: 10_000, structuredOutputSupport: true, maxConcurrency: 4 }
class FixtureExecutor implements ReasoningExecutor {
  capabilities(): ReasoningCapabilities { return capabilities }
  async execute(request: ReasoningRequest): Promise<ReasoningResult> { return { operation: request.operation, output: {} } as ReasoningResult }
}

async function seedTopicKnowledgeBase(root: string): Promise<void> {
  await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-topic-runtime-fixture', now: '2026-09-28T00:00:00.000Z' })
  const assets = [
    ['entities', 'theme', { id: 'entity:theme-runtime', type: 'investment_theme', name: 'Runtime Theme', aliases: [], lifecycle: { status: 'active', validFrom: null, validUntil: null } }, 'entity'],
    ['entities', 'company', { id: 'entity:company-runtime', type: 'company', name: 'Runtime Company', lifecycle: { status: 'active', validFrom: null, validUntil: null } }, 'entity'],
    ['claims', 'theme-claim', { id: 'claim:theme-runtime', claimType: 'fact', statement: 'Theme claim', subjectRefs: ['entity:theme-runtime'], sourceRefs: [], lifecycle: { status: 'active', validFrom: null, validUntil: null } }, 'claim'],
  ] as const
  const registry: Record<string, { type: string; storageRef: string }> = {}
  for (const [directory, filename, value, type] of assets) {
    const storageRef = `${directory}/${filename}.yaml`
    await writeFile(join(root, storageRef), JSON.stringify(value))
    registry[value.id] = { type, storageRef }
  }
  await writeFile(join(root, 'registry', 'assets.yaml'), JSON.stringify(registry))
}

test('Runtime exposes read-only Knowledge Topic summary and item APIs with strict inputs', async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'researchhub-runtime-topic-'))
  const kb = join(fixtureRoot, 'knowledge-base')
  await seedTopicKnowledgeBase(kb)
  const cwd = join(fixtureRoot, 'cwd'); const agentDir = join(fixtureRoot, 'agent'); const workspaceRoot = join(fixtureRoot, 'workspace')
  await mkdir(cwd, { recursive: true })
  await mkdir(agentDir, { recursive: true })
  const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false })
  const faux = fauxProvider({ provider: `researchhub-runtime-topic-${Date.now()}-${Math.random()}`, models: [{ id: 'fixture-model' }] })
  modelRuntime.registerNativeProvider(faux.provider)
  const runtime = await createResearchHubApplicationRuntime({ cwd, agentDir, mountedKnowledgeBaseRoot: kb, workspaceRoot, modelRuntime, model: faux.getModel(), reasoningExecutor: new FixtureExecutor() })
  const server = new ResearchHubRuntimeServer({ runtime, port: 0 })
  try {
    const info = await server.start()
    const themePath = `/api/knowledge/topics/${encodeURIComponent('entity:theme-runtime')}`
    const manifestBefore = await readFile(join(kb, 'manifest.yaml'), 'utf8')
    const canonicalBefore = JSON.stringify(await readCanonicalV04Assets(kb))

    const summaryResponse = await fetch(`${info.origin}${themePath}/summary?depth=2`)
    assert.equal(summaryResponse.status, 200)
    const summary = await summaryResponse.json() as { schemaVersion: string; revision: number; theme: { ref: string; name: string }; counts: { direct: { claim: { total: number } } }; connected: { depth: number } }
    assert.equal(summary.schemaVersion, '0.4')
    assert.equal(summary.theme.ref, 'entity:theme-runtime')
    assert.equal(summary.theme.name, 'Runtime Theme')
    assert.equal(summary.counts.direct.claim.total, 1)
    assert.equal(summary.connected.depth, 2)

    const itemsResponse = await fetch(`${info.origin}${themePath}/items?kind=claim&scope=direct&limit=1&lifecycle=active&expectedRevision=${summary.revision}`)
    assert.equal(itemsResponse.status, 200)
    const page = await itemsResponse.json() as { revision: number; themeRef: string; kind: string; total: number; items: { ref: string; label: string }[] }
    assert.equal(page.themeRef, 'entity:theme-runtime')
    assert.equal(page.kind, 'claim')
    assert.equal(page.total, 1)
    assert.deepEqual(page.items.map((item) => item.ref), ['claim:theme-runtime'])
    assert.equal(page.revision, summary.revision)

    const staleRevision = await fetch(`${info.origin}${themePath}/items?kind=claim&expectedRevision=${summary.revision + 1}`)
    assert.equal(staleRevision.status, 409)
    assert.equal((await staleRevision.json()).code, 'conflict')

    const malformedRequests = [
      [`${info.origin}/api/knowledge/topics/${encodeURIComponent('entity:missing')}/summary`, 404, 'not_found'],
      [`${info.origin}/api/knowledge/topics/${encodeURIComponent('entity:company-runtime')}/summary`, 400, 'invalid_input'],
      [`${info.origin}${themePath}/summary?depth=3`, 400, 'invalid_input'],
      [`${info.origin}${themePath}/summary?depth=1&unexpected=true`, 400, 'invalid_input'],
      [`${info.origin}${themePath}/items?kind=claim&kind=event`, 400, 'invalid_input'],
      [`${info.origin}${themePath}/items?kind=unknown`, 400, 'invalid_input'],
      [`${info.origin}${themePath}/items?kind=claim&limit=0`, 400, 'invalid_input'],
      [`${info.origin}${themePath}/items?kind=claim&expectedRevision=-1`, 400, 'invalid_input'],
      [`${info.origin}${themePath}/items?kind=claim&expectedRevision=9007199254740992`, 400, 'invalid_input'],
      [`${info.origin}${themePath}/items?kind=claim&cursor=malformed`, 400, 'invalid_input'],
      [`${info.origin}${themePath}/items?kind=claim&cursor=${'x'.repeat(4_097)}`, 400, 'invalid_input'],
    ] as const
    for (const [url, status, code] of malformedRequests) {
      const response = await fetch(url)
      assert.equal(response.status, status, url)
      const body = await response.json() as { code: string; error: string }
      assert.equal(body.code, code, url)
      assert.equal(body.error.includes(kb), false, 'error response must not expose the mounted Knowledge path')
    }

    assert.equal(await readFile(join(kb, 'manifest.yaml'), 'utf8'), manifestBefore)
    assert.equal(JSON.stringify(await readCanonicalV04Assets(kb)), canonicalBefore)
  } finally {
    await server.close()
    await runtime.close()
    await (modelRuntime as unknown as { readonly dispose?: () => void | Promise<void> }).dispose?.()
    await rm(fixtureRoot, { recursive: true, force: true })
  }
})

test('Knowledge Topic routes reject mounted Schema 0.3 without changing existing graph behavior', async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'researchhub-runtime-topic-v03-'))
  const kb = await createKnowledgeBase({ schemaVersion: '0.3', knowledgeBaseId: 'kb-topic-v03' })
  const cwd = join(fixtureRoot, 'cwd'); const agentDir = join(fixtureRoot, 'agent'); const workspaceRoot = join(fixtureRoot, 'workspace')
  await mkdir(cwd, { recursive: true })
  await mkdir(agentDir, { recursive: true })
  const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false })
  const faux = fauxProvider({ provider: `researchhub-runtime-topic-v03-${Date.now()}-${Math.random()}`, models: [{ id: 'fixture-model' }] })
  modelRuntime.registerNativeProvider(faux.provider)
  const runtime = await createResearchHubApplicationRuntime({ cwd, agentDir, mountedKnowledgeBaseRoot: kb, workspaceRoot, modelRuntime, model: faux.getModel(), reasoningExecutor: new FixtureExecutor() })
  const server = new ResearchHubRuntimeServer({ runtime, port: 0 })
  try {
    const info = await server.start()
    const topic = await fetch(`${info.origin}/api/knowledge/topics/${encodeURIComponent('entity:theme-runtime')}/summary`)
    assert.equal(topic.status, 400)
    assert.equal((await topic.json()).code, 'invalid_input')
    const graph = await fetch(`${info.origin}/api/knowledge/graph?rootRef=${encodeURIComponent('entity:theme-runtime')}`)
    assert.equal(graph.status, 404)
  } finally {
    await server.close()
    await runtime.close()
    await (modelRuntime as unknown as { readonly dispose?: () => void | Promise<void> }).dispose?.()
    await removeKnowledgeBase(kb)
    await rm(fixtureRoot, { recursive: true, force: true })
  }
})
