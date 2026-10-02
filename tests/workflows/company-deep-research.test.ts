import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { KnowledgeBaseRegistry } from '../../knowledge/registry/registry.ts'
import { createFreshKnowledgeBaseV04, readCanonicalV04Assets } from '../../knowledge/storage/index.ts'
import { runCompanyDeepResearch } from '../../workflows/company-deep-research/index.ts'
import type { ResearchAcquisitionPlugin, ResearchSignal, ResearchSignalStore } from '../../plugins/research-acquisition/contracts.ts'
import { writeKnowledgeBase } from '../../knowledge/writer/writer.ts'
import { KnowledgeBaseRegistry as Registry } from '../../knowledge/registry/registry.ts'

test('Company Deep Research produces atomic canonical Knowledge and a linked report', async () => {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-company-'))
  const reports = await mkdtemp(join(tmpdir(), 'researchhub-company-reports-'))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-company-test', now: '2026-09-08T00:00:00.000Z' })
    const handle = await new KnowledgeBaseRegistry().mount(root)
    const signals: ResearchSignal[] = []
    const signalStore: ResearchSignalStore = { append: async (signal) => { signals.push(signal) }, listForCompany: async () => signals }
    let content = 'The company reported stable revenue and profit.'
    const plugin: ResearchAcquisitionPlugin = {
      name: 'fixture-official',
      discover: async () => [{ candidateId: 'official-1', kind: 'official_disclosure', tier: 1, title: 'Fixture filing', url: 'https://example.com/filing', provider: 'cninfo', publishedAt: '2026-09-07T00:00:00.000Z', metadata: { companySymbol: '600519' } }],
      fetch: async (candidate) => ({ candidate, retrievedAt: '2026-09-08T00:00:00.000Z', content, contentHash: content.includes('improved') ? 'c'.repeat(64) : 'b'.repeat(64) }),
      normalize: async (fetched) => ({ candidate: fetched.candidate, retrievedAt: fetched.retrievedAt, title: fetched.candidate.title, content: fetched.content, contentHash: fetched.contentHash!, canonicalUrl: fetched.candidate.url, publisher: fetched.candidate.provider, rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false } }),
    }
    const input = { workflowRunId: 'company-run-1', handle, company: { symbol: '600519', name: 'Fixture Company' }, acquisitionPlugins: [plugin], signalStore, reportRoot: reports, now: () => '2026-09-08T00:00:00.000Z' }
    const result = await runCompanyDeepResearch(input)
    assert.equal(result.status, 'completed', result.errors.join('; '))
    assert.ok(result.report?.outputPath)
    assert.ok(result.committedIds.length >= 2)
    assert.equal(signals.length, 1)
    const loaded = await readCanonicalV04Assets(root)
    assert.ok(loaded.objects.some((item) => item.value.id === 'entity:company-600519'))
    assert.ok(loaded.objects.some((item) => item.value.id.startsWith('source:research-')))
    assert.equal(loaded.objects.filter((item) => item.value.id.startsWith('claim:research-')).length, 0)
    assert.equal(result.knowledgeBaseRevision, 1)
    assert.ok(result.createdIds.includes('entity:company-600519'))
    assert.deepEqual(result.committedIds, [...result.createdIds, ...result.updatedIds])

    content = 'The company reported improved revenue and profit.'
    const replay = await runCompanyDeepResearch({ ...input, workflowRunId: 'company-run-2', handle: await new KnowledgeBaseRegistry().mount(root) })
    assert.equal(replay.status, 'completed')
    assert.equal(replay.knowledgeBaseRevision, 2)
    assert.deepEqual(replay.createdIds, [])
    assert.ok(replay.updatedIds.includes(result.sourceIds[0]))
    assert.deepEqual(replay.committedIds, [...replay.createdIds, ...replay.updatedIds])
    const replayLoaded = await readCanonicalV04Assets(root)
    assert.equal(replayLoaded.objects.filter((item) => item.value.id.startsWith('source:research-')).length, 1)
    assert.equal(replay.sourceIds[0], result.sourceIds[0])
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(reports, { recursive: true, force: true })
  }
})

test('Company Deep Research binds two companies deterministically and is stable on a third run', async () => {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-company-multi-'))
  const reports = await mkdtemp(join(tmpdir(), 'researchhub-company-multi-reports-'))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-company-multi-test', now: '2026-09-08T00:00:00.000Z' })
    const plugin: ResearchAcquisitionPlugin = {
      name: 'fixture-official',
      discover: async (request) => { if (!request.company) return []; return [{ candidateId: `official-${request.company.symbol}`, kind: 'official_disclosure', tier: 1, title: `${request.company.symbol} filing`, url: `https://example.com/${request.company.symbol}`, provider: 'cninfo', publishedAt: '2026-09-07T00:00:00.000Z', metadata: { companySymbol: request.company.symbol } }] },
      fetch: async (candidate) => ({ candidate, retrievedAt: '2026-09-08T00:00:00.000Z', content: `${candidate.candidateId} reported stable revenue.`, contentHash: candidate.candidateId.includes('600519') ? 'c'.repeat(64) : 'd'.repeat(64) }),
      normalize: async (fetched) => ({ candidate: fetched.candidate, retrievedAt: fetched.retrievedAt, title: fetched.candidate.title, content: fetched.content, contentHash: fetched.contentHash!, canonicalUrl: fetched.candidate.url, publisher: fetched.candidate.provider, rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false } }),
    }
    const first = await runCompanyDeepResearch({ workflowRunId: 'multi-600519-1', handle: await new Registry().mount(root), company: { symbol: '600519', name: 'Company A' }, acquisitionPlugins: [plugin], reportRoot: reports, now: () => '2026-09-08T00:00:00.000Z' })
    const second = await runCompanyDeepResearch({ workflowRunId: 'multi-000858-1', handle: await new Registry().mount(root), company: { symbol: '000858', name: 'Company B' }, acquisitionPlugins: [plugin], reportRoot: reports, now: () => '2026-09-08T00:00:00.000Z' })
    const third = await runCompanyDeepResearch({ workflowRunId: 'multi-600519-2', handle: await new Registry().mount(root), company: { symbol: '600519', name: 'Company A' }, acquisitionPlugins: [plugin], reportRoot: reports, now: () => '2026-09-08T00:00:00.000Z' })
    assert.equal(first.status, 'completed', first.errors.join('; '))
    assert.equal(second.status, 'completed', second.errors.join('; '))
    assert.equal(third.status, 'completed', third.errors.join('; '))
    assert.equal(first.knowledgeBaseRevision, 1)
    assert.equal(second.knowledgeBaseRevision, 2)
    assert.equal(third.knowledgeBaseRevision, 2)
    const loaded = await readCanonicalV04Assets(root)
    assert.equal(loaded.objects.filter((item) => item.value.id.startsWith('entity:')).length, 2)
    assert.equal(loaded.objects.filter((item) => item.value.id.startsWith('source:')).length, 2)
    assert.equal(loaded.objects.filter((item) => item.value.id.startsWith('claim:')).length, 0)
    assert.ok(loaded.objects.every((item) => !item.value.id.includes('proposal-')))
    assert.ok(third.resolutionIntents?.some((item) => item.disposition === 'bound_existing'))
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(reports, { recursive: true, force: true })
  }
})

test('Schema 0.4 shared Writer rejects a forged receipt without Validator runtime identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-writer-token-'))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-writer-token-test', now: '2026-09-08T00:00:00.000Z' })
    const handle = await new Registry().mount(root)
    const forged = { changeSet: { changeSetId: 'forged', workflowRunId: 'forged-run', knowledgeBaseId: handle.knowledgeBaseId, schemaVersion: '0.4', storageFormatVersion: '1', expectedBaseRevision: 0, operations: [] }, knowledgeBaseId: handle.knowledgeBaseId, schemaVersion: '0.4', baseRevision: 0, changeSetId: 'forged', changeSetHash: '0'.repeat(64) }
    const result = await writeKnowledgeBase(handle, forged as never, { registry: new Registry(), clock: () => '2026-09-08T00:00:00.000Z' })
    assert.equal(result.status, 'rejected')
    assert.equal(result.error?.code, 'validation_required')
    const imitation = Object.create(Object.getPrototypeOf(forged)) as unknown
    Object.assign(imitation as object, forged)
    const imitationResult = await writeKnowledgeBase(handle, imitation as never, { registry: new Registry(), clock: () => '2026-09-08T00:00:00.000Z' })
    assert.equal(imitationResult.error?.code, 'validation_required')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
