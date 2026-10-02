import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { KnowledgeBaseRegistry } from '../../../knowledge/registry/registry.ts'
import { RawDocumentKnowledgeGatewayV04, type RawDocumentGatewayV04Input } from '../../../knowledge/production/raw-document-gateway-v04.ts'
import { getRaw, readRaw } from '../../../knowledge/raw/raw-archive.ts'
import { createFreshKnowledgeBaseV04, loadKnowledgeBaseManifest, readCanonicalV04Assets } from '../../../knowledge/storage/index.ts'
import { writeKnowledgeBase } from '../../../knowledge/writer/writer.ts'

const NOW = '2026-10-02T00:00:00.000Z'
const clock = () => NOW

async function withFreshKb(name: string, run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), `rhl-raw-document-${name}-`))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: `kb-raw-document-${name}`, now: NOW })
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function mount(root: string) { return new KnowledgeBaseRegistry().mount(root) }

function request(handle: RawDocumentGatewayV04Input['handle'], overrides: Partial<RawDocumentGatewayV04Input> = {}): RawDocumentGatewayV04Input {
  return {
    handle,
    workflowRunId: 'manual-pdf-upload-001',
    bytes: Buffer.from('%PDF-1.7\nexample research report\n%%EOF\n'),
    filename: 'C:\\users\\analyst\\AI-capacity.pdf',
    mediaType: 'application/pdf',
    source: {
      title: 'AI Capacity Research',
      sourceType: 'sell_side_research',
      sourceReliability: 'medium',
      publisher: 'Example Securities',
      institution: 'Example Securities',
      author: 'Research Team',
      publishedAt: '2026-09-30T08:00:00.000Z',
      canonicalUrl: 'https://research.example/report/ai-capacity',
    },
    rights: {
      accessScope: 'authenticated',
      providerTermsKnown: true,
      retentionAllowed: true,
      aiProcessingAllowed: true,
      derivativeKnowledgeAllowed: true,
      redistributionAllowed: false,
      policyBasis: 'User confirmed this copy may be retained and processed for personal research.',
    },
    ...overrides,
  }
}

test('manual document gateway archives Raw and commits a canonical Source with explicit rights and no Theme requirement', async () => {
  await withFreshKb('commit', async (root) => {
    const handle = await mount(root)
    const input = request(handle)
    const result = await new RawDocumentKnowledgeGatewayV04({ clock }).submit(input)
    assert.equal(result.status, 'committed', result.errors.map((error) => error.message).join('; '))
    assert.equal(result.baseRevision, 0)
    assert.equal(result.knowledgeBaseRevision, 1)
    assert.ok(result.sourceRef?.startsWith('source:manual-'))
    assert.ok(result.rawRef?.startsWith('raw-sha256-'))
    assert.equal(result.rawReused, false)

    const raw = await getRaw(handle, result.rawRef!)
    assert.deepEqual(await readRaw(handle, result.rawRef!), Buffer.from(input.bytes))
    assert.equal(raw.manifest.originalFilename, 'AI-capacity.pdf')
    assert.equal(raw.manifest.mediaType, 'application/pdf')
    assert.equal(raw.manifest.suppliedMetadata.title, 'AI Capacity Research')
    const assets = await readCanonicalV04Assets(root)
    assert.equal(assets.objects.length, 1)
    const source = assets.objects[0]!.value as unknown as { id: string; title: string; sourceType: string; rawRefs: string[]; rights: Record<string, unknown>; usagePolicy: Record<string, unknown>; acquisition: Record<string, unknown>; metadata: Record<string, unknown> }
    assert.equal(source.id, result.sourceRef)
    assert.equal(source.title, 'AI Capacity Research')
    assert.equal(source.sourceType, 'sell_side_research')
    assert.deepEqual(source.rawRefs, [result.rawRef])
    assert.equal(source.rights.accessScope, 'authenticated')
    assert.equal(source.rights.aiProcessingAllowed, true)
    assert.equal(source.rights.derivativeKnowledgeAllowed, true)
    assert.equal(source.rights.policyBasis, input.rights.policyBasis)
    assert.equal(source.usagePolicy.mode, 'personal_noncommercial_research')
    assert.equal(source.acquisition.method, 'manual')
    assert.equal(source.metadata.originalFilename, 'AI-capacity.pdf')
    assert.equal((await loadKnowledgeBaseManifest(root)).revision, 1)
  })
})

test('same workflow retry is idempotent after the original handle becomes stale', async () => {
  await withFreshKb('retry', async (root) => {
    const staleHandle = await mount(root)
    const gateway = new RawDocumentKnowledgeGatewayV04({ clock })
    const original = request(staleHandle)
    const first = await gateway.submit(original)
    assert.equal(first.status, 'committed', first.errors.map((error) => error.message).join('; '))
    const retry = await gateway.submit(original)
    assert.equal(retry.status, 'already_committed', retry.errors.map((error) => error.message).join('; '))
    assert.equal(retry.baseRevision, 0)
    assert.equal(retry.sourceRef, first.sourceRef)
    assert.equal(retry.rawRef, first.rawRef)
    assert.equal(retry.rawReused, true)
    assert.equal(retry.knowledgeBaseRevision, 1)
    assert.equal((await readCanonicalV04Assets(root)).objects.length, 1)
    assert.equal((await loadKnowledgeBaseManifest(root)).revision, 1)
  })
})

test('ineligible or unspecified rights block before Raw archival', async () => {
  await withFreshKb('rights', async (root) => {
    const handle = await mount(root)
    const denied = request(handle, { rights: { ...request(handle).rights, aiProcessingAllowed: false } })
    const result = await new RawDocumentKnowledgeGatewayV04({ clock }).submit(denied)
    assert.equal(result.status, 'blocked')
    assert.equal(result.errors[0]?.code, 'RAW_DOCUMENT_RIGHTS_INELIGIBLE')
    assert.equal((await readCanonicalV04Assets(root)).objects.length, 0)
    assert.equal((await loadKnowledgeBaseManifest(root)).revision, 0)
    assert.deepEqual(await getRawRegistry(root), {})

    const missingRights = { ...request(handle), rights: undefined } as unknown as RawDocumentGatewayV04Input
    const missing = await new RawDocumentKnowledgeGatewayV04({ clock }).submit(missingRights)
    assert.equal(missing.status, 'blocked')
    assert.equal(missing.errors[0]?.code, 'RAW_DOCUMENT_INPUT_INVALID')
    assert.deepEqual(await getRawRegistry(root), {})
  })
})

test('stale unrelated request blocks without archiving Raw', async () => {
  await withFreshKb('stale', async (root) => {
    const staleHandle = await mount(root)
    const gateway = new RawDocumentKnowledgeGatewayV04({ clock })
    const first = await gateway.submit(request(staleHandle))
    assert.equal(first.status, 'committed')
    const second = await gateway.submit(request(staleHandle, { workflowRunId: 'manual-pdf-upload-002', bytes: Buffer.from('different PDF bytes') }))
    assert.equal(second.status, 'blocked')
    assert.equal(second.errors[0]?.code, 'RAW_DOCUMENT_STALE_REVISION')
    assert.equal((await readCanonicalV04Assets(root)).objects.length, 1)
    assert.equal(Object.keys(await getRawRegistry(root)).length, 1)
    assert.equal((await loadKnowledgeBaseManifest(root)).revision, 1)
  })
})

test('reusing one workflowRunId with different document bytes reports an idempotency conflict', async () => {
  await withFreshKb('conflict', async (root) => {
    const handle = await mount(root)
    const gateway = new RawDocumentKnowledgeGatewayV04({ clock })
    const first = await gateway.submit(request(handle))
    assert.equal(first.status, 'committed')
    const changed = await gateway.submit(request(handle, { bytes: Buffer.from('different PDF bytes') }))
    assert.equal(changed.status, 'blocked')
    assert.equal(changed.errors[0]?.code, 'RAW_DOCUMENT_IDEMPOTENCY_CONFLICT')
    assert.equal((await readCanonicalV04Assets(root)).objects.length, 1)
    assert.equal(Object.keys(await getRawRegistry(root)).length, 2)
    assert.equal((await loadKnowledgeBaseManifest(root)).revision, 1)
  })
})

test('Writer failure reports no canonical success while preserving the archived Raw for retry', async () => {
  await withFreshKb('writer-failure', async (root) => {
    const handle = await mount(root)
    const writer = (async (writerHandle) => ({
      status: 'failed' as const,
      knowledgeBaseId: writerHandle.knowledgeBaseId,
      changeSetId: 'fixture-writer-failure',
      baseRevision: writerHandle.revision,
      committedRevision: writerHandle.revision,
      createdIds: [],
      updatedIds: [],
      error: { code: 'fixture_writer_failure', message: 'Fixture Writer failed' },
    })) as typeof writeKnowledgeBase
    const result = await new RawDocumentKnowledgeGatewayV04({ clock, writer }).submit(request(handle))
    assert.equal(result.status, 'failed')
    assert.equal(result.errors[0]?.code, 'fixture_writer_failure')
    assert.equal(result.sourceRef, undefined)
    assert.ok(result.rawRef)
    assert.equal((await readCanonicalV04Assets(root)).objects.length, 0)
    assert.equal((await loadKnowledgeBaseManifest(root)).revision, 0)
    assert.deepEqual(await readRaw(handle, result.rawRef!), Buffer.from(request(handle).bytes))
    const retry = await new RawDocumentKnowledgeGatewayV04({ clock }).submit(request(handle))
    assert.equal(retry.status, 'committed', retry.errors.map((error) => error.message).join('; '))
    assert.equal(retry.rawRef, result.rawRef)
    assert.equal(retry.rawReused, true)
    assert.equal((await readCanonicalV04Assets(root)).objects.length, 1)
    assert.equal((await loadKnowledgeBaseManifest(root)).revision, 1)
  })
})

async function getRawRegistry(root: string): Promise<Record<string, unknown>> {
  const { readFile } = await import('node:fs/promises')
  const { parseYaml } = await import('../../../knowledge/storage/yaml.ts')
  const text = await readFile(join(root, 'registry', 'raw.yaml'), 'utf8')
  const value: unknown = parseYaml(text, join(root, 'registry', 'raw.yaml'))
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
