import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { KnowledgeBaseRegistry } from '../../../knowledge/registry/registry.ts'
import { createFreshKnowledgeBaseV04 } from '../../../knowledge/storage/index.ts'
import { readCanonicalV04Assets } from '../../../knowledge/storage/canonical-v04-loader.ts'
import type { KnowledgeSourceV04 } from '../../../knowledge/schema/domain-v04.ts'
import type { NormalizedResearchSource, ResearchAcquisitionPlugin, ResearchFetchedSource, ResearchSourceCandidate } from '../../../plugins/research-acquisition/contracts.ts'
import { ThemeFrameworkAcquisitionAdapter } from '../../../plugins/research-acquisition/theme-framework-acquisition.ts'
import { sha256 } from '../../../plugins/research-acquisition/hash.ts'

const NOW = '2026-10-03T00:00:00.000Z'
const html = new TextEncoder().encode('<!doctype html><html><body><h1>Industry scope</h1><p>Evidence text.</p></body></html>')

type FixtureDocument = {
  readonly id: string
  readonly title?: string
  readonly url?: string
  readonly bytes?: Uint8Array
  readonly mediaType?: string | null
  readonly rights?: Partial<NormalizedResearchSource['rights']>
}

class FixturePlugin implements ResearchAcquisitionPlugin {
  readonly name = 'fixture-industry-acquisition'
  discoverCalls = 0
  readonly candidates: readonly ResearchSourceCandidate[]
  private readonly documents = new Map<string, FixtureDocument>()
  constructor(documents: readonly FixtureDocument[]) {
    this.candidates = documents.map((document) => {
      this.documents.set(document.id, document)
      return { candidateId: document.id, kind: 'web_article', tier: 2, title: document.title ?? `Evidence ${document.id}`, url: document.url ?? `https://fixture.example/${document.id}`, provider: this.name }
    })
  }
  async discover(): Promise<readonly ResearchSourceCandidate[]> { this.discoverCalls += 1; return this.candidates }
  async fetch(candidate: ResearchSourceCandidate): Promise<ResearchFetchedSource> {
    const document = this.documents.get(candidate.candidateId)!
    const bytes = document.bytes ?? html
    const mediaType = document.mediaType === null ? undefined : document.mediaType ?? 'text/html'
    return { candidate, retrievedAt: NOW, content: new TextDecoder().decode(bytes), rawBytes: bytes, ...(mediaType ? { mediaType, contentType: mediaType } : {}), contentHash: sha256(bytes) }
  }
  async normalize(fetched: ResearchFetchedSource): Promise<NormalizedResearchSource> {
    const document = this.documents.get(fetched.candidate.candidateId)!
    return {
      candidate: fetched.candidate,
      retrievedAt: fetched.retrievedAt,
      title: fetched.candidate.title,
      content: fetched.content,
      canonicalUrl: fetched.candidate.url,
      contentHash: fetched.contentHash ?? sha256(fetched.rawBytes ?? fetched.content),
      ...(fetched.rawBytes ? { rawBytes: fetched.rawBytes } : {}),
      ...(document.mediaType === null ? {} : { mediaType: document.mediaType ?? 'text/html' }),
      publisher: 'Fixture Publisher',
      rights: {
        accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true,
        derivativeKnowledgeAllowed: true, redistributionAllowed: false,
        policyBasis: 'personal_noncommercial_research', ...document.rights,
      },
    }
  }
}

async function withKb(run: (root: string, knowledgeBaseId: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'rhl-theme-framework-acquisition-'))
  const knowledgeBaseId = `kb-theme-acq-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId, now: NOW })
    await run(root, knowledgeBaseId)
  } finally { await rm(root, { recursive: true, force: true }) }
}

function adapter(root: string, plugin: ResearchAcquisitionPlugin, registry = new KnowledgeBaseRegistry()): ThemeFrameworkAcquisitionAdapter {
  return new ThemeFrameworkAcquisitionAdapter({ knowledgeBaseRoot: root, plugins: [plugin], registry, clock: () => NOW })
}

function request(knowledgeBaseId: string, knowledgeBaseRevision: number, maxSources = 8, signal?: AbortSignal, themeName = 'Evidence') {
  return { themeName, definition: 'AI compute infrastructure and its supply chain', maxSources, knowledgeBaseId, knowledgeBaseRevision, ...(signal ? { signal } : {}) }
}

test('Theme Framework adapter persists source and raw before returning verified evidence bindings and is rerun-idempotent', async () => {
  await withKb(async (root, knowledgeBaseId) => {
    const registry = new KnowledgeBaseRegistry()
    const plugin = new FixturePlugin([{ id: 'doc-1' }])
    const acquisition = adapter(root, plugin, registry)
    const initial = await registry.mount(root)
    const first = await acquisition.acquire(request(knowledgeBaseId, initial.revision))

    assert.equal(first.status, 'available', JSON.stringify(first))
    assert.equal(first.evidence.length, 1)
    assert.equal(first.durableEvidenceBindings?.length, 1)
    const firstBinding = first.durableEvidenceBindings![0]!
    assert.match(firstBinding.sourceRef, /^source:/u)
    assert.match(firstBinding.rawRef, /^raw-sha256-[a-f0-9]{64}$/u)
    const afterFirst = await registry.refresh(root)
    assert.equal(afterFirst.revision, initial.revision + 1)
    const canonical = await readCanonicalV04Assets(root)
    const persistedSource = canonical.objects.find((entry) => entry.kind === 'source' && entry.value.id === firstBinding.sourceRef)
    assert.ok(persistedSource)
    if (persistedSource?.kind === 'source') assert.equal((persistedSource.value as KnowledgeSourceV04).rights.providerTermsKnown, false)

    const second = await acquisition.acquire(request(knowledgeBaseId, afterFirst.revision))
    const afterSecond = await registry.refresh(root)
    assert.equal(second.status, 'available', JSON.stringify(second))
    assert.deepEqual(second.durableEvidenceBindings, first.durableEvidenceBindings)
    assert.equal(afterSecond.revision, afterFirst.revision)
  })
})

test('Theme Framework adapter denies sources without explicit retention policy basis and never guesses provider terms', async () => {
  await withKb(async (root, knowledgeBaseId) => {
    const registry = new KnowledgeBaseRegistry()
    const plugin = new FixturePlugin([{ id: 'no-policy', rights: { policyBasis: undefined } }])
    const before = await registry.mount(root)
    const result = await adapter(root, plugin, registry).acquire(request(knowledgeBaseId, before.revision))
    const after = await registry.refresh(root)

    assert.equal(result.status, 'unavailable')
    assert.ok(result.diagnostics?.includes('source_rejected_rights:fixture-industry-acquisition'))
    assert.equal(after.revision, before.revision)
    assert.equal((await readCanonicalV04Assets(root)).objects.some((entry) => entry.kind === 'source'), false)
  })
})

test('Theme Framework title gate rejects generic navigation pages before Raw Gateway persistence', async () => {
  await withKb(async (root, knowledgeBaseId) => {
    const registry = new KnowledgeBaseRegistry()
    const plugin = new FixturePlugin([
      { id: 'english', title: 'English' },
      { id: 'exhibition', title: '行业展览' },
      { id: 'exchange', title: '国际交流' },
    ])
    const before = await registry.mount(root)
    const result = await adapter(root, plugin, registry).acquire(request(knowledgeBaseId, before.revision))
    const after = await registry.refresh(root)

    assert.equal(result.status, 'unavailable')
    assert.equal(result.reason, 'no_eligible_durable_sources')
    assert.equal(result.diagnostics?.filter((item) => item === 'source_rejected_title_relevance:fixture-industry-acquisition').length, 3)
    assert.equal(after.revision, before.revision)
    assert.equal((await readCanonicalV04Assets(root)).objects.some((entry) => entry.kind === 'source'), false)
  })
})

test('Theme Framework title gate accepts a relevant mixed-language article and Chinese theme trigrams', async () => {
  await withKb(async (root, knowledgeBaseId) => {
    const registry = new KnowledgeBaseRegistry()
    const plugin = new FixturePlugin([
      { id: 'relevant-ai', title: 'AI 驱动下 PCB 制程演进与算力需求' },
      { id: 'generic', title: '国际交流' },
    ])
    const before = await registry.mount(root)
    const result = await adapter(root, plugin, registry).acquire(request(knowledgeBaseId, before.revision, 8, undefined, 'AI 算力'))

    assert.equal(result.status, 'partial', JSON.stringify(result))
    assert.equal(result.evidence.length, 1)
    assert.match(result.evidence[0]!.description, /^AI 驱动下 PCB 制程演进/u)
    assert.equal((await registry.refresh(root)).revision, before.revision + 1)

    const chinesePlugin = new FixturePlugin([
      { id: 'relevant-cn', title: '先进封装产业链的技术演进' },
      { id: 'category-cn', title: '行业展览' },
    ])
    const afterFirst = await registry.refresh(root)
    const chinese = await adapter(root, chinesePlugin, registry).acquire(request(knowledgeBaseId, afterFirst.revision, 8, undefined, '先进封装'))

    assert.equal(chinese.status, 'partial', JSON.stringify(chinese))
    assert.equal(chinese.evidence.length, 1)
    assert.match(chinese.evidence[0]!.description, /^先进封装产业链/u)
  })
})

test('Theme Framework adapter keeps partial status when some sources fail rights checks and deduplicates canonical URLs', async () => {
  await withKb(async (root, knowledgeBaseId) => {
    const registry = new KnowledgeBaseRegistry()
    const plugin = new FixturePlugin([
      { id: 'duplicate-one', url: 'https://fixture.example/same' },
      { id: 'duplicate-two', url: 'https://fixture.example/same' },
      { id: 'no-policy', rights: { policyBasis: undefined } },
    ])
    const before = await registry.mount(root)
    const result = await adapter(root, plugin, registry).acquire(request(knowledgeBaseId, before.revision, 8))
    const after = await registry.refresh(root)

    assert.equal(result.status, 'partial')
    assert.equal(result.evidence.length, 1)
    assert.equal(result.durableEvidenceBindings?.length, 1)
    assert.equal(after.revision, before.revision + 1)
  })
})

test('Theme Framework adapter rejects mismatched PDF/HTML representations and honors pre-aborted requests', async () => {
  await withKb(async (root, knowledgeBaseId) => {
    const registry = new KnowledgeBaseRegistry()
    const mismatchPlugin = new FixturePlugin([{ id: 'mismatch', mediaType: 'application/pdf', bytes: html }])
    const before = await registry.mount(root)
    const mismatch = await adapter(root, mismatchPlugin, registry).acquire(request(knowledgeBaseId, before.revision))
    assert.equal(mismatch.status, 'unavailable')
    assert.ok(mismatch.diagnostics?.includes('source_rejected_raw_representation:fixture-industry-acquisition'))
    assert.equal((await registry.refresh(root)).revision, before.revision)

    const missingMimePlugin = new FixturePlugin([{ id: 'missing-mime', mediaType: null }])
    const missingMime = await adapter(root, missingMimePlugin, registry).acquire(request(knowledgeBaseId, before.revision))
    assert.equal(missingMime.status, 'unavailable')
    assert.ok(missingMime.diagnostics?.includes('source_rejected_raw_representation:fixture-industry-acquisition'))

    const stalePlugin = new FixturePlugin([{ id: 'stale-snapshot' }])
    const stale = await adapter(root, stalePlugin, registry).acquire(request(knowledgeBaseId, before.revision + 1))
    assert.equal(stale.status, 'unavailable')
    assert.equal(stalePlugin.discoverCalls, 0)

    const controller = new AbortController()
    controller.abort()
    const cancelledPlugin = new FixturePlugin([{ id: 'cancelled' }])
    const cancelled = await adapter(root, cancelledPlugin, registry).acquire(request(knowledgeBaseId, before.revision, 8, controller.signal))
    assert.equal(cancelled.status, 'unavailable')
    assert.equal(cancelledPlugin.discoverCalls, 0)
  })
})
