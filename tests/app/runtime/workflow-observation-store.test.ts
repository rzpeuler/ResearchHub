import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WorkflowRunView } from '../../../app/services/contracts.ts'
import { WorkflowObservationStore, WorkflowObservationStoreError } from '../../../app/runtime/workflow-observation-store.ts'

const timestamp = '2026-10-13T00:00:00.000Z'

function workflow(runId = 'observation-run-1', observationRevision = 1, objective = 'Company research 600519'): WorkflowRunView {
  return {
    runId,
    workflowType: 'company_research',
    objective,
    status: 'running',
    startedAt: timestamp,
    updatedAt: timestamp,
    observationRevision,
    stages: [{ stageId: 'data_acquisition', label: 'Data acquisition', status: 'running', startedAt: timestamp }],
    providerObservations: [{ providerId: 'cninfo', label: 'CNINFO', status: 'partial', diagnostics: ['PROVIDER_TIMEOUT'] }],
    skillObservations: [{ skillId: 'company_synthesis', label: 'Synthesis', status: 'running', startedAt: timestamp }],
  }
}

async function fixture(): Promise<{ root: string; store: WorkflowObservationStore; close(): Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'workflow-observation-store-'))
  return { root, store: new WorkflowObservationStore({ rootDir: join(root, 'snapshots') }), close: () => rm(root, { recursive: true, force: true }) }
}

async function expectStoreError(operation: () => Promise<unknown>, code: WorkflowObservationStoreError['code']): Promise<void> {
  await assert.rejects(operation, (error: unknown) => error instanceof WorkflowObservationStoreError && error.code === code)
}

test('writes an atomic versioned snapshot and reads it by runId', async () => {
  const f = await fixture()
  try {
    const result = await f.store.write(workflow())
    assert.equal(result.state, 'written')
    assert.equal(result.observationRevision, 1)
    assert.equal(result.persistedAt, new Date(result.persistedAt!).toISOString())
    const file = join(f.root, 'snapshots', 'observation-run-1.json')
    const snapshot = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
    assert.deepEqual(Object.keys(snapshot).sort(), ['observationRevision', 'persistedAt', 'runId', 'schemaVersion', 'workflow'].sort())
    assert.equal(snapshot.schemaVersion, 1)
    assert.equal(snapshot.runId, 'observation-run-1')
    assert.deepEqual((await f.store.read('observation-run-1'))?.workflow, workflow())
    assert.deepEqual((await readdir(join(f.root, 'snapshots'))).sort(), ['observation-run-1.json'])
  } finally { await f.close() }
})

test('rejects unsafe run IDs and traversal before constructing a snapshot path', async () => {
  const f = await fixture()
  try {
    for (const runId of ['', '../outside', 'a/b', '..', '.hidden', 'run id', 'x'.repeat(121)]) {
      await expectStoreError(() => f.store.read(runId), 'invalid_input')
      await expectStoreError(() => f.store.write(workflow(runId)), 'invalid_input')
    }
    assert.deepEqual(await f.store.listRunIds(), { runIds: [], diagnostics: [] })
  } finally { await f.close() }
})

test('rejects malformed, oversized, unsupported, and identity-mismatched snapshots', async () => {
  const f = await fixture()
  const root = join(f.root, 'snapshots')
  try {
    await mkdir(root, { recursive: true })
    const path = (id: string) => join(root, `${id}.json`)

    await writeFile(path('bad-json'), '{not json')
    await expectStoreError(() => f.store.read('bad-json'), 'corrupt')

    await writeFile(path('too-large'), ' '.repeat(512 * 1024 + 1))
    await expectStoreError(() => f.store.read('too-large'), 'capacity')

    await writeFile(path('future-version'), JSON.stringify({ schemaVersion: 2, runId: 'future-version', observationRevision: 1, persistedAt: timestamp, workflow: workflow('future-version') }))
    await expectStoreError(() => f.store.read('future-version'), 'unsupported_version')

    await writeFile(path('mismatched-id'), JSON.stringify({ schemaVersion: 1, runId: 'another-run', observationRevision: 1, persistedAt: timestamp, workflow: workflow('another-run') }))
    await expectStoreError(() => f.store.read('mismatched-id'), 'corrupt')

    await writeFile(path('mismatched-revision'), JSON.stringify({ schemaVersion: 1, runId: 'mismatched-revision', observationRevision: 2, persistedAt: timestamp, workflow: workflow('mismatched-revision', 1) }))
    await expectStoreError(() => f.store.read('mismatched-revision'), 'corrupt')

    await expectStoreError(() => f.store.write({ ...workflow('fake-interrupted'), status: 'interrupted' }), 'invalid_input')
    await expectStoreError(() => f.store.write({ ...workflow('fake-interrupted-stage'), stages: [{ stageId: 'data_acquisition', label: 'Data acquisition', status: 'interrupted' }] }), 'invalid_input')

    const listed = await f.store.listRunIds()
    assert.deepEqual(listed.runIds, [])
    assert.deepEqual(listed.diagnostics.map((item) => [item.runId, item.code]), [
      ['bad-json', 'corrupt'], ['future-version', 'unsupported_version'], ['mismatched-id', 'corrupt'], ['mismatched-revision', 'corrupt'], ['too-large', 'capacity'],
    ])
  } finally { await f.close() }
})

test('rejects non-files and symlinks and diagnoses invalid snapshot filenames', async (t) => {
  const f = await fixture()
  const root = join(f.root, 'snapshots')
  try {
    await mkdir(join(root, 'directory-entry.json'), { recursive: true })
    await expectStoreError(() => f.store.read('directory-entry'), 'corrupt')
    await writeFile(join(root, 'not a safe id.json'), '{}')
    try {
      await symlink(join(root, 'not a safe id.json'), join(root, 'linked-entry.json'))
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EPERM' || code === 'EACCES' || code === 'ENOTSUP') t.skip(`symlink creation unavailable: ${code}`)
      throw error
    }
    await expectStoreError(() => f.store.read('linked-entry'), 'corrupt')
    const listed = await f.store.listRunIds()
    assert.deepEqual(listed.runIds, [])
    assert.ok(listed.diagnostics.some((item) => item.runId === 'not a safe id' && item.code === 'invalid_input'))
    assert.ok(listed.diagnostics.some((item) => item.runId === 'directory-entry' && item.code === 'corrupt'))
    assert.ok(listed.diagnostics.some((item) => item.runId === 'linked-entry' && item.code === 'corrupt'))
  } finally { await f.close() }
})

test('serializes same-run writes, keeps the highest revision, and treats identical equal revisions as idempotent', async () => {
  const f = await fixture()
  try {
    const results = await Promise.all([
      f.store.write(workflow('concurrent-run', 5)),
      f.store.write(workflow('concurrent-run', 2)),
      f.store.write(workflow('concurrent-run', 4)),
    ])
    assert.equal((await f.store.read('concurrent-run'))?.workflow.observationRevision, 5)
    assert.ok(results.some((result) => result.state === 'stale'))

    const equal = await f.store.write(workflow('concurrent-run', 5))
    assert.equal(equal.state, 'unchanged')
    assert.equal(equal.persistedAt, (await f.store.read('concurrent-run'))?.persistedAt)
    await expectStoreError(() => f.store.write(workflow('concurrent-run', 5, 'different projection')), 'conflict')

    const newer = await f.store.write(workflow('concurrent-run', 6))
    assert.equal(newer.state, 'written')
    assert.equal((await f.store.read('concurrent-run'))?.workflow.observationRevision, 6)
    const stale = await f.store.write(workflow('concurrent-run', 3))
    assert.equal(stale.state, 'stale')
    assert.equal(stale.observationRevision, 6)
  } finally { await f.close() }
})

test('diagnoses directory I/O and write capacity failures with typed stable codes', async () => {
  const f = await fixture()
  try {
    const fileRoot = join(f.root, 'not-a-directory')
    await writeFile(fileRoot, 'file')
    const unavailable = new WorkflowObservationStore({ rootDir: join(fileRoot, 'child') })
    await expectStoreError(() => unavailable.listRunIds(), 'io')

    const largeProjection: WorkflowRunView = { ...workflow('large-run'), stages: Array.from({ length: 10_000 }, (_, index) => ({ stageId: `stage-${index}`, label: `Stage ${index}`, status: 'completed' as const })) }
    await expectStoreError(() => f.store.write(largeProjection), 'capacity')
  } finally { await f.close() }
})
