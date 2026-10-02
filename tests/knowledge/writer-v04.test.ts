import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { KnowledgeBaseRegistry } from '../../knowledge/registry/registry.ts'
import type { KnowledgeIndustryV04 } from '../../knowledge/schema/domain-v04.ts'
import type { KnowledgeChangeSetV04 } from '../../knowledge/schema/mutation-v04.ts'
import { createFreshKnowledgeBaseV04, loadKnowledgeBaseManifest, readCanonicalV04Assets } from '../../knowledge/storage/index.ts'
import { hashKnowledgeObject } from '../../knowledge/storage/canonical-hash.ts'
import { validateKnowledgeChangeSetV04 } from '../../knowledge/validation/v04-change-set-validator.ts'
import { writeKnowledgeBaseV04 } from '../../knowledge/writer/writer-v04.ts'

const NOW = '2026-10-02T00:00:00.000Z'
const clock = () => NOW

async function withFreshKb(name: string, run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), `rhl-writer-v04-${name}-`))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: `kb-writer-v04-${name}`, now: NOW })
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function validatedChangeSet(
  root: string,
  runId: string,
  operations: KnowledgeChangeSetV04['operations'],
) {
  const registry = new KnowledgeBaseRegistry()
  const handle = await registry.mount(root)
  const changeSet: KnowledgeChangeSetV04 = {
    changeSetId: `changeset-${runId}`,
    workflowRunId: runId,
    knowledgeBaseId: handle.knowledgeBaseId,
    schemaVersion: '0.4',
    storageFormatVersion: '1',
    expectedBaseRevision: handle.revision,
    operations,
  }
  const validation = await validateKnowledgeChangeSetV04(handle, changeSet, { mode: 'commit', now: clock })
  assert.ok(validation.validatedChangeSet, JSON.stringify(validation.report.errors))
  return { registry, handle, receipt: validation.validatedChangeSet }
}

function industry(name: string): KnowledgeIndustryV04 {
  return { id: 'entity:writer-v04-industry', type: 'industry', name, lifecycle: { status: 'active' } }
}

test('idempotent replay verifies the final state after repeated operations on one target', async () => {
  await withFreshKb('repeated-operations', async (root) => {
    const initial = industry('Initial name')
    const final = industry('Final name')
    const { handle, registry, receipt } = await validatedChangeSet(root, 'writer-v04-repeated-operations', [
      { operationId: 'create-industry', type: 'create', object: initial },
      { operationId: 'update-industry', type: 'update', knowledgeId: initial.id, expectedBeforeHash: hashKnowledgeObject(initial), object: final },
    ])
    const first = await writeKnowledgeBaseV04(handle, receipt, registry, clock)
    assert.equal(first.status, 'committed')
    assert.deepEqual(first.createdIds, [initial.id])
    assert.deepEqual(first.updatedIds, [initial.id])

    const replay = await writeKnowledgeBaseV04(handle, receipt, registry, clock)
    assert.equal(replay.status, 'already_committed')

    const loaded = await readCanonicalV04Assets(root)
    const stored = loaded.objects.find((item) => item.value.id === final.id)
    assert.ok(stored)
    await writeFile(stored.filePath, `${JSON.stringify(initial)}\n`, 'utf8')
    const changedTargetReplay = await writeKnowledgeBaseV04(handle, receipt, registry, clock)
    assert.equal(changedTargetReplay.status, 'rejected')
    assert.equal(changedTargetReplay.error?.code, 'stale_target')
  })
})

test('idempotent replay rejects a missing canonical target and registry entry', async () => {
  await withFreshKb('missing-target', async (root) => {
    const object = industry('Committed industry')
    const { handle, registry, receipt } = await validatedChangeSet(root, 'writer-v04-missing-target', [
      { operationId: 'create-industry', type: 'create', object },
    ])
    assert.equal((await writeKnowledgeBaseV04(handle, receipt, registry, clock)).status, 'committed')

    const loaded = await readCanonicalV04Assets(root)
    const target = loaded.objects.find((item) => item.value.id === object.id)
    assert.ok(target)
    const registryPath = join(root, 'registry', 'assets.yaml')
    const entries = JSON.parse(await readFile(registryPath, 'utf8')) as Record<string, unknown>
    delete entries[object.id]
    await writeFile(registryPath, `${JSON.stringify(entries)}\n`, 'utf8')
    await unlink(target.filePath)

    const beforeRevision = (await loadKnowledgeBaseManifest(root)).revision
    const replay = await writeKnowledgeBaseV04(handle, receipt, registry, clock)
    assert.equal(replay.status, 'rejected')
    assert.equal(replay.error?.code, 'stale_target')
    assert.equal((await loadKnowledgeBaseManifest(root)).revision, beforeRevision)
  })
})

test('idempotent replay rejects Writer log change IDs inconsistent with its ChangeSet', async () => {
  await withFreshKb('log-ids', async (root) => {
    const object = industry('Logged industry')
    const { handle, registry, receipt } = await validatedChangeSet(root, 'writer-v04-log-ids', [
      { operationId: 'create-industry', type: 'create', object },
    ])
    assert.equal((await writeKnowledgeBaseV04(handle, receipt, registry, clock)).status, 'committed')

    const logPath = join(root, 'logs', 'research', 'writer-v04-log-ids.yaml')
    const log = JSON.parse(await readFile(logPath, 'utf8')) as { changes: { createdIds: string[]; updatedIds: string[] } }
    log.changes.createdIds = []
    await writeFile(logPath, `${JSON.stringify(log)}\n`, 'utf8')

    const replay = await writeKnowledgeBaseV04(handle, receipt, registry, clock)
    assert.equal(replay.status, 'rejected')
    assert.equal(replay.error?.code, 'idempotency_conflict')
  })
})
