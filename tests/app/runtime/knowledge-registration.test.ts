import assert from 'node:assert/strict'
import test from 'node:test'
import { access, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createFreshKnowledgeBaseV04 } from '../../../knowledge/storage/create-v04.ts'
import { addRegisteredKnowledgeBase, listRegisteredKnowledgeBases, removeRegisteredKnowledgeBase, validateKnowledgeBaseDirectory } from '../../../app/runtime/knowledge-registration.ts'
import { ApplicationServiceError } from '../../../app/services/contracts.ts'

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'rhl-kb-registration-'))
  const cwd = join(root, 'app')
  const workspace = join(cwd, 'workspace')
  await mkdir(workspace, { recursive: true })
  return { root, cwd, workspace }
}

test('registration persists safe metadata and removal leaves Knowledge Base files intact', async () => {
  const fixture = await createFixture()
  const kb = join(fixture.root, 'external-kb')
  try {
    await createFreshKnowledgeBaseV04(kb, { knowledgeBaseId: 'registered-kb', name: 'External Research' })
    const added = await addRegisteredKnowledgeBase(fixture.cwd, fixture.workspace, kb)
    assert.equal(added.knowledgeBaseId, 'registered-kb')
    assert.equal(added.label, 'External Research')
    assert.equal(added.schemaVersion, '0.4')
    assert.equal(added.available, true)
    assert.equal((await listRegisteredKnowledgeBases(fixture.cwd, fixture.workspace))[0]?.root, await realpath(kb))
    await removeRegisteredKnowledgeBase(fixture.cwd, 'registered-kb')
    assert.deepEqual(await listRegisteredKnowledgeBases(fixture.cwd, fixture.workspace), [])
    await access(join(kb, 'manifest.yaml'))
  } finally { await rm(fixture.root, { recursive: true, force: true }) }
})

test('registration rejects duplicate identifiers, duplicate roots, and Workspace overlap', async () => {
  const fixture = await createFixture()
  const first = join(fixture.root, 'first')
  const sameId = join(fixture.root, 'same-id')
  const nested = join(fixture.workspace, 'nested-kb')
  try {
    await createFreshKnowledgeBaseV04(first, { knowledgeBaseId: 'duplicate-kb' })
    await createFreshKnowledgeBaseV04(sameId, { knowledgeBaseId: 'duplicate-kb' })
    await createFreshKnowledgeBaseV04(nested, { knowledgeBaseId: 'nested-kb' })
    const preview = await validateKnowledgeBaseDirectory(fixture.workspace, first)
    assert.equal(preview.knowledgeBaseId, 'duplicate-kb')
    assert.deepEqual(await listRegisteredKnowledgeBases(fixture.cwd, fixture.workspace), [])
    await addRegisteredKnowledgeBase(fixture.cwd, fixture.workspace, first)
    await assert.rejects(addRegisteredKnowledgeBase(fixture.cwd, fixture.workspace, first), (error) => error instanceof ApplicationServiceError && error.code === 'invalid_input')
    await assert.rejects(addRegisteredKnowledgeBase(fixture.cwd, fixture.workspace, sameId), (error) => error instanceof ApplicationServiceError && error.code === 'invalid_input')
    await assert.rejects(addRegisteredKnowledgeBase(fixture.cwd, fixture.workspace, nested), (error) => error instanceof ApplicationServiceError && error.code === 'invalid_input')
  } finally { await rm(fixture.root, { recursive: true, force: true }) }
})

test('registration rejects linked roots and unsupported manifests', async () => {
  const fixture = await createFixture()
  const valid = join(fixture.root, 'valid')
  const unsupported = join(fixture.root, 'unsupported')
  const linked = join(fixture.root, 'linked')
  try {
    await createFreshKnowledgeBaseV04(valid, { knowledgeBaseId: 'valid-kb' })
    await createFreshKnowledgeBaseV04(unsupported, { knowledgeBaseId: 'unsupported-kb' })
    const manifestPath = join(unsupported, 'manifest.yaml')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
    manifest.storageFormatVersion = '2'
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`)
    await assert.rejects(addRegisteredKnowledgeBase(fixture.cwd, fixture.workspace, unsupported), (error) => error instanceof ApplicationServiceError && error.code === 'invalid_input')
    try {
      await symlink(valid, linked, 'junction')
      await assert.rejects(addRegisteredKnowledgeBase(fixture.cwd, fixture.workspace, linked), (error) => error instanceof ApplicationServiceError && error.code === 'invalid_input')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM' && (error as NodeJS.ErrnoException).code !== 'EACCES') throw error
    }
  } finally { await rm(fixture.root, { recursive: true, force: true }) }
})

test('registration refuses candidates already present in the legacy catalog', async () => {
  const fixture = await createFixture()
  const kb = join(fixture.root, 'legacy-kb')
  try {
    await createFreshKnowledgeBaseV04(kb, { knowledgeBaseId: 'legacy-kb' })
    const canonical = await realpath(kb)
    await assert.rejects(addRegisteredKnowledgeBase(fixture.cwd, fixture.workspace, kb, [{ knowledgeBaseId: 'legacy-kb', root: canonical }]), (error) => error instanceof ApplicationServiceError && error.code === 'invalid_input')
    await assert.rejects(addRegisteredKnowledgeBase(fixture.cwd, fixture.workspace, kb, [{ knowledgeBaseId: 'other-id', root: canonical }]), (error) => error instanceof ApplicationServiceError && error.code === 'invalid_input')
    assert.deepEqual(await listRegisteredKnowledgeBases(fixture.cwd, fixture.workspace), [])
  } finally { await rm(fixture.root, { recursive: true, force: true }) }
})

test('unavailable registrations can still be removed without returning the saved path', async () => {
  const fixture = await createFixture()
  const kb = join(fixture.root, 'registered')
  try {
    await createFreshKnowledgeBaseV04(kb, { knowledgeBaseId: 'offline-kb' })
    await addRegisteredKnowledgeBase(fixture.cwd, fixture.workspace, kb)
    await rm(kb, { recursive: true })
    const [entry] = await listRegisteredKnowledgeBases(fixture.cwd, fixture.workspace)
    assert.equal(entry?.available, false)
    assert.equal(entry?.root, await realpath(fixture.root).then((canonical) => join(canonical, 'registered')))
    await removeRegisteredKnowledgeBase(fixture.cwd, 'offline-kb')
    assert.deepEqual(await listRegisteredKnowledgeBases(fixture.cwd, fixture.workspace), [])
  } finally { await rm(fixture.root, { recursive: true, force: true }) }
})
