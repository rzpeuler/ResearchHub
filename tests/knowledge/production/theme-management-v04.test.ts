import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { KnowledgeBaseRegistry } from '../../../knowledge/registry/registry.ts'
import { ThemeManagementGatewayV04, DEFAULT_THEME_GROUP_REF_V04 } from '../../../knowledge/production/theme-management-v04.ts'
import type { KnowledgeIndustryV04, KnowledgeInvestmentThemeV04, KnowledgeRelationV04 } from '../../../knowledge/schema/domain-v04.ts'
import type { KnowledgeChangeSetV04 } from '../../../knowledge/schema/mutation-v04.ts'
import { createFreshKnowledgeBaseV04, loadKnowledgeBaseManifest, readCanonicalV04Assets } from '../../../knowledge/storage/index.ts'
import { hashKnowledgeObject } from '../../../knowledge/storage/canonical-hash.ts'
import { validateKnowledgeChangeSetV04 } from '../../../knowledge/validation/v04-change-set-validator.ts'
import { writeKnowledgeBase } from '../../../knowledge/writer/writer.ts'

const NOW = '2026-10-02T00:00:00.000Z'
const clock = () => NOW

async function withFreshKb(name: string, run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), `rhl-theme-management-${name}-`))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: `kb-theme-management-${name}`, now: NOW })
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function mount(root: string) {
  return new KnowledgeBaseRegistry().mount(root)
}

async function addThemeExposureRelation(root: string, themeRef: string): Promise<string> {
  const handle = await mount(root)
  const industry: KnowledgeIndustryV04 = {
    id: 'entity:theme-management-fixture-industry',
    type: 'industry',
    name: 'Theme Management Fixture Industry',
    lifecycle: { status: 'active' },
  }
  const relation: KnowledgeRelationV04 = {
    id: 'relation:theme-management-fixture-exposure',
    type: 'theme_exposure',
    sourceRef: themeRef as `entity:${string}`,
    targetRef: industry.id,
    lifecycle: { status: 'active' },
  }
  const changeSet: KnowledgeChangeSetV04 = {
    changeSetId: 'theme-management-fixture-changeset',
    workflowRunId: 'theme-management-fixture-run',
    knowledgeBaseId: handle.knowledgeBaseId,
    schemaVersion: '0.4',
    storageFormatVersion: '1',
    expectedBaseRevision: handle.revision,
    operations: [
      { operationId: 'create-fixture-industry', type: 'create', object: industry },
      { operationId: 'create-fixture-theme-exposure', type: 'create', object: relation },
    ],
  }
  const validation = await validateKnowledgeChangeSetV04(handle, changeSet, { mode: 'commit', now: clock })
  assert.ok(validation.validatedChangeSet, JSON.stringify(validation.report.errors))
  const result = await writeKnowledgeBase(handle, validation.validatedChangeSet, { registry: new KnowledgeBaseRegistry(), clock })
  assert.equal(result.status, 'committed', result.error?.message)
  return relation.id
}

async function archiveThemeReference(root: string, themeRef: string): Promise<void> {
  const handle = await mount(root)
  const before = await themeByRef(root, themeRef)
  const archived: KnowledgeInvestmentThemeV04 = { ...before, lifecycle: { ...before.lifecycle, status: 'archived' } }
  const changeSet: KnowledgeChangeSetV04 = {
    changeSetId: 'theme-management-archive-fixture-changeset',
    workflowRunId: 'theme-management-archive-fixture-run',
    knowledgeBaseId: handle.knowledgeBaseId,
    schemaVersion: '0.4',
    storageFormatVersion: '1',
    expectedBaseRevision: handle.revision,
    operations: [{ operationId: 'archive-fixture-theme', type: 'update', knowledgeId: themeRef, expectedBeforeHash: hashKnowledgeObject(before), object: archived }],
  }
  const validation = await validateKnowledgeChangeSetV04(handle, changeSet, { mode: 'commit', now: clock })
  assert.ok(validation.validatedChangeSet, JSON.stringify(validation.report.errors))
  const result = await writeKnowledgeBase(handle, validation.validatedChangeSet, { registry: new KnowledgeBaseRegistry(), clock })
  assert.equal(result.status, 'committed', result.error?.message)
}

async function themeByRef(root: string, ref: string): Promise<KnowledgeInvestmentThemeV04> {
  const assets = await readCanonicalV04Assets(root)
  const found = assets.objects.find((item) => item.value.id === ref)
  assert.ok(found, `Missing Theme ${ref}`)
  return found.value as KnowledgeInvestmentThemeV04
}

test('fresh Schema 0.4 KB can ensure the default ThemeGroup idempotently', async () => {
  await withFreshKb('ensure-default', async (root) => {
    const gateway = new ThemeManagementGatewayV04({ clock })
    const first = await gateway.ensureDefaultThemeGroup(await mount(root))
    assert.equal(first.status, 'committed', first.errors.map((item) => item.message).join('; '))
    assert.equal(first.themeGroupRef, DEFAULT_THEME_GROUP_REF_V04)
    assert.deepEqual(first.createdIds, [DEFAULT_THEME_GROUP_REF_V04])
    const retry = await gateway.ensureDefaultThemeGroup(await mount(root))
    assert.equal(retry.status, 'no_changes')
    assert.equal(retry.themeGroupRef, DEFAULT_THEME_GROUP_REF_V04)
    assert.equal((await loadKnowledgeBaseManifest(root)).revision, 1)
  })
})

test('name-only Theme creation creates the default group and Theme in one ChangeSet', async () => {
  await withFreshKb('name-only-theme', async (root) => {
    const gateway = new ThemeManagementGatewayV04({ clock })
    const result = await gateway.createTheme(await mount(root), { name: 'AI Compute' })
    assert.equal(result.status, 'committed', result.errors.map((item) => item.message).join('; '))
    assert.ok(result.themeRef?.startsWith('entity:investment_theme-'))
    assert.equal(result.themeGroupRef, DEFAULT_THEME_GROUP_REF_V04)
    assert.equal(result.createdIds.length, 2)
    assert.equal(result.knowledgeBaseRevision, 1)
    const theme = await themeByRef(root, result.themeRef!)
    assert.equal(theme.name, 'AI Compute')
    assert.equal(theme.themeGroupRef, DEFAULT_THEME_GROUP_REF_V04)
    assert.equal(theme.definition, undefined)
    assert.equal(theme.inclusionCriteria, undefined)
    assert.equal(theme.exclusionCriteria, undefined)
  })
})

test('Theme creation is replayable and blocks a normalized-name duplicate with different fields', async () => {
  await withFreshKb('theme-idempotency', async (root) => {
    const gateway = new ThemeManagementGatewayV04({ clock })
    const first = await gateway.createTheme(await mount(root), { name: 'AI Compute', definition: 'Compute infrastructure' })
    assert.equal(first.status, 'committed', first.errors.map((item) => item.message).join('; '))
    const retry = await gateway.createTheme(await mount(root), { name: '  ai   compute ', definition: 'Compute infrastructure' })
    assert.equal(retry.status, 'no_changes')
    assert.equal(retry.themeRef, first.themeRef)
    const duplicate = await gateway.createTheme(await mount(root), { name: 'AI Compute', definition: 'A different boundary' })
    assert.equal(duplicate.status, 'blocked')
    assert.equal(duplicate.errors[0]?.code, 'THEME_NAME_DUPLICATE')
    assert.equal((await loadKnowledgeBaseManifest(root)).revision, 1)
  })
})

test('an existing Theme definition and criteria can be supplemented and updated without changing its name', async () => {
  await withFreshKb('theme-update', async (root) => {
    const gateway = new ThemeManagementGatewayV04({ clock })
    const created = await gateway.createTheme(await mount(root), { name: 'AI Compute' })
    assert.equal(created.status, 'committed', created.errors.map((item) => item.message).join('; '))
    const relationRef = await addThemeExposureRelation(root, created.themeRef!)
    const relationBefore = (await readCanonicalV04Assets(root)).objects.find((item) => item.value.id === relationRef)?.value
    assert.ok(relationBefore)
    const staleHandle = await mount(root)
    const patch = {
      themeRef: created.themeRef!,
      definition: 'Compute infrastructure and demand',
      inclusionCriteria: ['accelerators', 'data-center systems'],
      exclusionCriteria: ['consumer devices'],
    }
    const updated = await gateway.updateTheme(staleHandle, patch)
    assert.equal(updated.status, 'committed', updated.errors.map((item) => item.message).join('; '))
    assert.deepEqual(updated.updatedIds, [created.themeRef])
    const current = await themeByRef(root, created.themeRef!)
    assert.equal(current.name, 'AI Compute')
    assert.equal(current.definition, patch.definition)
    assert.deepEqual(current.inclusionCriteria, patch.inclusionCriteria)
    assert.deepEqual(current.exclusionCriteria, patch.exclusionCriteria)

    const retry = await gateway.updateTheme(await mount(root), patch)
    assert.equal(retry.status, 'no_changes')
    assert.equal(retry.themeRef, created.themeRef)
    const changed = await gateway.updateTheme(await mount(root), { themeRef: created.themeRef!, definition: 'Updated compute scope', inclusionCriteria: [] })
    assert.equal(changed.status, 'committed', changed.errors.map((item) => item.message).join('; '))
    const changedTheme = await themeByRef(root, created.themeRef!)
    assert.equal(changedTheme.name, 'AI Compute')
    assert.equal(changedTheme.definition, 'Updated compute scope')
    assert.deepEqual(changedTheme.inclusionCriteria, [])
    assert.deepEqual(changedTheme.exclusionCriteria, patch.exclusionCriteria)
    const unsupportedRename = await gateway.updateTheme(await mount(root), { themeRef: created.themeRef!, name: '' } as never)
    assert.equal(unsupportedRename.status, 'blocked')
    assert.equal(unsupportedRename.errors[0]?.code, 'THEME_UPDATE_FIELD_UNSUPPORTED')
    const staleUpdate = await gateway.updateTheme(staleHandle, { themeRef: created.themeRef!, definition: 'stale update' })
    assert.equal(staleUpdate.status, 'blocked')
    assert.equal(staleUpdate.errors[0]?.code, 'THEME_MANAGEMENT_STALE_HANDLE')
    const relationAfter = (await readCanonicalV04Assets(root)).objects.find((item) => item.value.id === relationRef)?.value
    assert.deepEqual(relationAfter, relationBefore)
  })
})

test('Default stays reserved when renaming a custom ThemeGroup before fallback initialization', async () => {
  await withFreshKb('group-reserved-name', async (root) => {
    const gateway = new ThemeManagementGatewayV04({ clock })
    const group = await gateway.createThemeGroup(await mount(root), { name: 'Custom Group' })
    assert.equal(group.status, 'committed', group.errors.map((item) => item.message).join('; '))
    const beforeRevision = (await loadKnowledgeBaseManifest(root)).revision
    const rename = await gateway.renameThemeGroup(await mount(root), { themeGroupRef: group.themeGroupRef!, name: ' Default ' })
    assert.equal(rename.status, 'blocked')
    assert.equal(rename.errors[0]?.code, 'THEME_GROUP_RESERVED_NAME')
    assert.equal((await loadKnowledgeBaseManifest(root)).revision, beforeRevision)
    const assets = await readCanonicalV04Assets(root)
    assert.equal(assets.objects.some((item) => item.value.id === DEFAULT_THEME_GROUP_REF_V04), false)
    const currentGroup = assets.objects.find((item) => item.value.id === group.themeGroupRef)?.value as { name: string } | undefined
    assert.equal(currentGroup?.name, 'Custom Group')
  })
})

test('custom ThemeGroups can be created and renamed; moving a Theme preserves its graph relations', async () => {
  await withFreshKb('group-move', async (root) => {
    const gateway = new ThemeManagementGatewayV04({ clock })
    const themeResult = await gateway.createTheme(await mount(root), { name: 'Copper Supply Chain' })
    assert.equal(themeResult.status, 'committed', themeResult.errors.map((item) => item.message).join('; '))
    const relationRef = await addThemeExposureRelation(root, themeResult.themeRef!)
    const relationBefore = (await readCanonicalV04Assets(root)).objects.find((item) => item.value.id === relationRef)?.value
    assert.ok(relationBefore)
    const groupResult = await gateway.createThemeGroup(await mount(root), { name: 'Research Folders', description: 'Custom organization' })
    assert.equal(groupResult.status, 'committed', groupResult.errors.map((item) => item.message).join('; '))
    const groupRetry = await gateway.createThemeGroup(await mount(root), { name: ' research   folders ', description: 'Custom organization' })
    assert.equal(groupRetry.status, 'no_changes')
    assert.equal(groupRetry.themeGroupRef, groupResult.themeGroupRef)
    const duplicateGroup = await gateway.createThemeGroup(await mount(root), { name: 'Research Folders', description: 'Different details' })
    assert.equal(duplicateGroup.status, 'blocked')
    assert.equal(duplicateGroup.errors[0]?.code, 'THEME_GROUP_NAME_DUPLICATE')
    const renamed = await gateway.renameThemeGroup(await mount(root), { themeGroupRef: groupResult.themeGroupRef!, name: 'Long-Term Research' })
    assert.equal(renamed.status, 'committed', renamed.errors.map((item) => item.message).join('; '))
    const moved = await gateway.moveTheme(await mount(root), { themeRef: themeResult.themeRef!, targetThemeGroupRef: renamed.themeGroupRef! })
    assert.equal(moved.status, 'committed', moved.errors.map((item) => item.message).join('; '))
    assert.equal((await themeByRef(root, themeResult.themeRef!)).themeGroupRef, renamed.themeGroupRef)
    const relationAfter = (await readCanonicalV04Assets(root)).objects.find((item) => item.value.id === relationRef)?.value
    assert.deepEqual(relationAfter, relationBefore)
    const defaultArchive = await gateway.deleteThemeGroup(await mount(root), { themeGroupRef: DEFAULT_THEME_GROUP_REF_V04 })
    assert.equal(defaultArchive.status, 'blocked')
    assert.match(defaultArchive.errors[0]?.message ?? '', /protected V1 system fallback/)
    assert.ok(defaultArchive.notices.some((notice) => notice.includes('protected V1 system fallback')))
  })
})

test('non-empty ThemeGroup archive requires a target and migrates every active Theme atomically', async () => {
  await withFreshKb('group-archive', async (root) => {
    const gateway = new ThemeManagementGatewayV04({ clock })
    const source = await gateway.createThemeGroup(await mount(root), { name: 'Temporary Group' })
    assert.equal(source.status, 'committed', source.errors.map((item) => item.message).join('; '))
    const target = await gateway.createThemeGroup(await mount(root), { name: 'Permanent Group' })
    assert.equal(target.status, 'committed', target.errors.map((item) => item.message).join('; '))
    const firstTheme = await gateway.createTheme(await mount(root), { name: 'Theme One', themeGroupRef: source.themeGroupRef })
    assert.equal(firstTheme.status, 'committed', firstTheme.errors.map((item) => item.message).join('; '))
    const secondTheme = await gateway.createTheme(await mount(root), { name: 'Theme Two', themeGroupRef: source.themeGroupRef })
    assert.equal(secondTheme.status, 'committed', secondTheme.errors.map((item) => item.message).join('; '))
    const relationRef = await addThemeExposureRelation(root, firstTheme.themeRef!)
    const relationBefore = (await readCanonicalV04Assets(root)).objects.find((item) => item.value.id === relationRef)?.value
    const beforeRevision = (await loadKnowledgeBaseManifest(root)).revision

    const missingTarget = await gateway.deleteThemeGroup(await mount(root), { themeGroupRef: source.themeGroupRef! })
    assert.equal(missingTarget.status, 'blocked')
    assert.equal(missingTarget.errors[0]?.code, 'THEME_GROUP_TARGET_REQUIRED')
    assert.equal((await loadKnowledgeBaseManifest(root)).revision, beforeRevision)

    const archived = await gateway.deleteThemeGroup(await mount(root), { themeGroupRef: source.themeGroupRef!, targetThemeGroupRef: target.themeGroupRef })
    assert.equal(archived.status, 'committed', archived.errors.map((item) => item.message).join('; '))
    assert.equal(archived.targetThemeGroupRef, target.themeGroupRef)
    assert.equal(archived.updatedIds.length, 3)
    assert.equal(archived.knowledgeBaseRevision, beforeRevision + 1)
    assert.equal((await themeByRef(root, firstTheme.themeRef!)).themeGroupRef, target.themeGroupRef)
    assert.equal((await themeByRef(root, secondTheme.themeRef!)).themeGroupRef, target.themeGroupRef)
    const assets = await readCanonicalV04Assets(root)
    const archivedGroup = assets.objects.find((item) => item.value.id === source.themeGroupRef)?.value as { lifecycle?: { status?: string } } | undefined
    assert.equal(archivedGroup?.lifecycle?.status, 'archived')
    const relationAfter = assets.objects.find((item) => item.value.id === relationRef)?.value
    assert.deepEqual(relationAfter, relationBefore)
  })
})

test('archived Themes remain ThemeGroup members and migrate before group archival', async () => {
  await withFreshKb('group-archive-inactive-member', async (root) => {
    const gateway = new ThemeManagementGatewayV04({ clock })
    const source = await gateway.createThemeGroup(await mount(root), { name: 'Source Group' })
    assert.equal(source.status, 'committed', source.errors.map((item) => item.message).join('; '))
    const target = await gateway.createThemeGroup(await mount(root), { name: 'Target Group' })
    assert.equal(target.status, 'committed', target.errors.map((item) => item.message).join('; '))
    const theme = await gateway.createTheme(await mount(root), { name: 'Archived Member', themeGroupRef: source.themeGroupRef })
    assert.equal(theme.status, 'committed', theme.errors.map((item) => item.message).join('; '))
    await archiveThemeReference(root, theme.themeRef!)
    const beforeRevision = (await loadKnowledgeBaseManifest(root)).revision

    const missingTarget = await gateway.deleteThemeGroup(await mount(root), { themeGroupRef: source.themeGroupRef! })
    assert.equal(missingTarget.status, 'blocked')
    assert.equal(missingTarget.errors[0]?.code, 'THEME_GROUP_TARGET_REQUIRED')
    assert.equal((await loadKnowledgeBaseManifest(root)).revision, beforeRevision)

    const result = await gateway.deleteThemeGroup(await mount(root), { themeGroupRef: source.themeGroupRef!, targetThemeGroupRef: target.themeGroupRef })
    assert.equal(result.status, 'committed', result.errors.map((item) => item.message).join('; '))
    assert.equal(result.updatedIds.length, 2)
    assert.equal(result.knowledgeBaseRevision, beforeRevision + 1)
    const archivedTheme = await themeByRef(root, theme.themeRef!)
    assert.equal(archivedTheme.lifecycle.status, 'archived')
    assert.equal(archivedTheme.themeGroupRef, target.themeGroupRef)
    const assets = await readCanonicalV04Assets(root)
    const archivedGroup = assets.objects.find((item) => item.value.id === source.themeGroupRef)?.value as { lifecycle?: { status?: string } } | undefined
    assert.equal(archivedGroup?.lifecycle?.status, 'archived')
  })
})

test('stale Theme management handles fail closed before planning a ChangeSet', async () => {
  await withFreshKb('stale-handle', async (root) => {
    const gateway = new ThemeManagementGatewayV04({ clock })
    const stale = await mount(root)
    const first = await gateway.createTheme(stale, { name: 'First Theme' })
    assert.equal(first.status, 'committed', first.errors.map((item) => item.message).join('; '))
    const second = await gateway.createTheme(stale, { name: 'Second Theme' })
    assert.equal(second.status, 'blocked')
    assert.equal(second.errors[0]?.code, 'THEME_MANAGEMENT_STALE_HANDLE')
    assert.equal(second.knowledgeBaseRevision, 1)
    assert.equal((await loadKnowledgeBaseManifest(root)).revision, 1)
  })
})

test('Writer rejection is returned as failure and does not report a Theme write', async () => {
  await withFreshKb('writer-rejection', async (root) => {
    const writer = (async (handle, _receipt, _options) => ({
      status: 'rejected' as const,
      knowledgeBaseId: handle.knowledgeBaseId,
      changeSetId: 'rejected-theme-change',
      baseRevision: handle.revision,
      committedRevision: handle.revision,
      createdIds: [],
      updatedIds: [],
      error: { code: 'fixture_rejection', message: 'Fixture Writer rejection' },
    })) as typeof writeKnowledgeBase
    const gateway = new ThemeManagementGatewayV04({ clock, writer })
    const result = await gateway.createTheme(await mount(root), { name: 'Rejected Theme' })
    assert.equal(result.status, 'failed')
    assert.equal(result.errors[0]?.code, 'fixture_rejection')
    assert.equal((await readCanonicalV04Assets(root)).objects.length, 0)
    assert.equal((await loadKnowledgeBaseManifest(root)).revision, 0)
  })
})

test('invalid Theme and ThemeGroup fields fail closed without changing canonical state', async () => {
  await withFreshKb('invalid-fields', async (root) => {
    const gateway = new ThemeManagementGatewayV04({ clock })
    const handle = await mount(root)
    const invalidThemeResults = await Promise.all([
      gateway.createTheme(handle, { name: '   ' }),
      gateway.createTheme(handle, { name: 'Valid Name', definition: '   ' }),
      gateway.createTheme(handle, { name: 'Valid Name', inclusionCriteria: ['valid', ''] }),
      gateway.createTheme(handle, { name: 'Valid Name', exclusionCriteria: ['x'.repeat(2049)] }),
    ])
    assert.ok(invalidThemeResults.every((result) => result.status === 'blocked'))
    const invalidGroup = await gateway.createThemeGroup(handle, { name: 'Valid Group', sortOrder: Number.NaN })
    assert.equal(invalidGroup.status, 'blocked')
    assert.equal((await readCanonicalV04Assets(root)).objects.length, 0)
    assert.equal((await loadKnowledgeBaseManifest(root)).revision, 0)
  })
})
