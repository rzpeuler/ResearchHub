import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createFreshKnowledgeBaseV04 } from '../../../knowledge/storage/create-v04.ts'
import { discoverKnowledgeBases, requireKnowledgeBaseChoice, resolveInitialKnowledgeBase } from '../../../app/runtime/knowledge-selection.ts'
import { readRuntimeSettings, writeRuntimeSettings } from '../../../app/runtime/runtime-settings.ts'
import { ApplicationServiceError } from '../../../app/services/contracts.ts'

test('Knowledge Base catalog lists only direct supported real children and prevents id-to-path input', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-kb-selection-'))
  const cwd = join(root, 'ResearchHub_Lite')
  const workspaceRoot = join(cwd, 'workspace')
  const catalogRoot = join(root, 'ResearchHubData', 'knowledge-bases')
  const first = join(catalogRoot, 'first')
  const nested = join(catalogRoot, 'group', 'nested')
  try {
    await mkdir(workspaceRoot, { recursive: true })
    await mkdir(first, { recursive: true })
    await mkdir(nested, { recursive: true })
    await createFreshKnowledgeBaseV04(first, { knowledgeBaseId: 'kb-first' })
    await createFreshKnowledgeBaseV04(nested, { knowledgeBaseId: 'kb-nested' })
    const catalog = await discoverKnowledgeBases({ cwd, workspaceRoot, configuredRoot: catalogRoot })
    assert.deepEqual(catalog.map(({ knowledgeBaseId }) => knowledgeBaseId), ['kb-first'])
    assert.equal(requireKnowledgeBaseChoice(catalog, 'kb-first')?.root, await realpath(first))
    assert.throws(() => requireKnowledgeBaseChoice(catalog, first), (error) => error instanceof ApplicationServiceError && error.code === 'invalid_input')

    const outside = join(root, 'outside')
    await mkdir(outside, { recursive: true })
    await createFreshKnowledgeBaseV04(outside, { knowledgeBaseId: 'kb-outside' })
    const link = join(catalogRoot, 'linked-outside')
    try {
      await symlink(outside, link, 'junction')
      const linkedCatalog = await discoverKnowledgeBases({ cwd, workspaceRoot, configuredRoot: catalogRoot })
      assert.equal(linkedCatalog.some(({ knowledgeBaseId }) => knowledgeBaseId === 'kb-outside'), false)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM' && (error as NodeJS.ErrnoException).code !== 'EACCES') throw error
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('explicitly configured Knowledge Base is admitted and persisted unmount wins over startup environment', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-kb-selection-restart-'))
  const cwd = join(root, 'app')
  const workspaceRoot = join(cwd, 'workspace')
  const catalogRoot = join(root, 'catalog')
  const first = join(catalogRoot, 'first')
  const explicit = join(root, 'custom-mounted')
  try {
    await mkdir(workspaceRoot, { recursive: true })
    await mkdir(first, { recursive: true })
    await mkdir(explicit, { recursive: true })
    await createFreshKnowledgeBaseV04(first, { knowledgeBaseId: 'kb-first' })
    await createFreshKnowledgeBaseV04(explicit, { knowledgeBaseId: 'kb-explicit' })
    const settings = await writeRuntimeSettings(cwd, { revision: 1, knowledgeBaseId: null })
    const restored = await readRuntimeSettings(cwd)
    assert.deepEqual(restored, settings)
    const startup = await resolveInitialKnowledgeBase({ cwd, workspaceRoot, configuredRoot: catalogRoot, initialKnowledgeBaseRoot: explicit, persistedKnowledgeBaseId: restored.knowledgeBaseId })
    assert.equal(startup.mounted, undefined)
    assert.deepEqual(startup.catalog.map(({ knowledgeBaseId }) => knowledgeBaseId), ['kb-explicit', 'kb-first'])

    const selected = await writeRuntimeSettings(cwd, { ...restored, revision: 2, knowledgeBaseId: 'kb-first' })
    const restarted = await resolveInitialKnowledgeBase({ cwd, workspaceRoot, configuredRoot: catalogRoot, initialKnowledgeBaseRoot: explicit, persistedKnowledgeBaseId: selected.knowledgeBaseId })
    assert.equal(restarted.mounted?.knowledgeBaseId, 'kb-first')
  } finally { await rm(root, { recursive: true, force: true }) }
})
