import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createFreshKnowledgeBaseV04 } from '../../../knowledge/storage/create-v04.ts'
import { KnowledgeBaseRegistry } from '../../../knowledge/registry/registry.ts'
import { buildThemeScopeReverseIndexV04, advanceThemeScopeReverseIndexV04, lookupAffectedThemesV04, lookupAffectedThemeSlicesV04, lookupAffectedThemeScopeSlicesV04, loadOrRebuildThemeScopeReverseIndexV04 } from '../../../knowledge/governance/theme-scope-reverse-index-v04.ts'
import type { ThemeScopeDecisionV04 } from '../../../knowledge/governance/theme-scope-v04.ts'
import type { ThemeScopeLedgerReadResultV04 } from '../../../knowledge/governance/theme-scope-ledger-v04.ts'
import { ThemeManagementGatewayV04 } from '../../../knowledge/production/theme-management-v04.ts'
import { recoverKnowledgeBaseRoot, runKnowledgeRootTransaction } from '../../../knowledge/storage/root-transaction.ts'
import { loadKnowledgeBaseManifest } from '../../../knowledge/storage/manifest-loader.ts'

const NOW = '2026-10-02T00:00:00.000Z'

function decision(input: { theme: string; fingerprint: string; id: string; canonicalRef: string; sourceRef?: string; rawRef?: string; value?: 'include' | 'exclude' | 'pending' }): ThemeScopeDecisionV04 {
  return {
    version: '0.4', themeRef: input.theme as ThemeScopeDecisionV04['themeRef'],
    candidate: { kind: 'industry', name: 'Candidate', canonicalRef: input.canonicalRef as `entity:${string}` },
    candidateFingerprint: input.fingerprint as ThemeScopeDecisionV04['candidateFingerprint'],
    decision: input.value ?? 'exclude', rationale: 'Bounded test decision.',
    evidence: [{ sourceRef: (input.sourceRef ?? 'source:src-a') as ThemeScopeDecisionV04['evidence'][number]['sourceRef'], rawRef: (input.rawRef ?? `raw-sha256-${'a'.repeat(64)}`) as ThemeScopeDecisionV04['evidence'][number]['rawRef'], locator: 'page 1' }],
    coverageGaps: [], review: { status: 'human_confirmed', confirmedAt: NOW }, basedOnRevision: 0,
    affectedBranchKeys: ['test'], id: input.id as ThemeScopeDecisionV04['id'],
  }
}

function ledger(decisions: readonly ThemeScopeDecisionV04[], revision = 4): Extract<ThemeScopeLedgerReadResultV04, { status: 'available' }> {
  const byTheme = new Map<string, ThemeScopeDecisionV04[]>()
  for (const item of decisions) { const items = byTheme.get(item.themeRef) ?? []; items.push(item); byTheme.set(item.themeRef, items) }
  const themes = [...byTheme].map(([themeRef, items]) => {
    const history = items.map((item, index) => ({ workflowRunId: `run-${index}`, committedRevision: index + 1, decision: item }))
    return { themeRef, history, currentByCandidateFingerprint: Object.fromEntries(items.map((item, index) => [item.candidateFingerprint, history[index]!])) }
  })
  return { status: 'available', knowledgeBaseId: 'kb-index-test', knowledgeBaseRevision: revision, themes, scopeBatchCount: decisions.length, decisionCount: decisions.length }
}

test('reverse index resolves only affected Themes across multiple Theme slices', () => {
  const first = decision({ theme: 'entity:theme-a', fingerprint: `sha256:${'1'.repeat(64)}`, id: `theme-scope-decision:${'a'.repeat(64)}`, canonicalRef: 'entity:industry-a', sourceRef: 'source:shared' })
  const second = decision({ theme: 'entity:theme-b', fingerprint: `sha256:${'2'.repeat(64)}`, id: `theme-scope-decision:${'b'.repeat(64)}`, canonicalRef: 'entity:industry-b', sourceRef: 'source:shared' })
  const unboundExcluded = { ...decision({ theme: 'entity:theme-c', fingerprint: `sha256:${'3'.repeat(64)}`, id: `theme-scope-decision:${'c'.repeat(64)}`, canonicalRef: 'entity:placeholder' }), candidate: { kind: 'industry' as const, name: 'Unbound Candidate' }, candidateFingerprint: `sha256:${'4'.repeat(64)}` as ThemeScopeDecisionV04['candidateFingerprint'], decision: 'exclude' as const }
  const index = buildThemeScopeReverseIndexV04(ledger([first, second, unboundExcluded]))
  assert.deepEqual(lookupAffectedThemesV04(index, { knowledgeBaseId: 'kb-index-test', revision: 4, changedRefs: ['entity:industry-a'] }), ['entity:theme-a'])
  assert.deepEqual(lookupAffectedThemesV04(index, { knowledgeBaseId: 'kb-index-test', revision: 4, changedRefs: ['source:shared'] }), ['entity:theme-a', 'entity:theme-b'])
  assert.deepEqual(lookupAffectedThemesV04(index, { knowledgeBaseId: 'kb-index-test', revision: 4, changedRefs: ['entity:unrelated'] }), [])
  assert.deepEqual(lookupAffectedThemesV04(index, { knowledgeBaseId: 'kb-index-test', revision: 4, changedRefs: [], changedFingerprints: [first.candidateFingerprint] }), ['entity:theme-a'])
  assert.deepEqual(lookupAffectedThemesV04(index, { knowledgeBaseId: 'kb-index-test', revision: 4, changedRefs: [], changedFingerprints: [unboundExcluded.candidateFingerprint] }), ['entity:theme-c'])
  assert.deepEqual(lookupAffectedThemesV04(index, { knowledgeBaseId: 'kb-index-test', revision: 4, changedRefs: ['entity:theme-b'] }), ['entity:theme-b'])
  const slices = lookupAffectedThemeSlicesV04(index, { knowledgeBaseId: 'kb-index-test', revision: 4, changedRefs: ['entity:industry-a'] })
  assert.equal(slices.knowledgeBaseRevision, 4)
  assert.deepEqual(slices.themes.map((theme) => theme.themeRef), ['entity:theme-a'])
  assert.equal(slices.themes[0]?.currentByCandidateFingerprint[first.candidateFingerprint]?.decision.id, first.id)
})

test('scope updates replace only the candidate slice, drop obsolete evidence keys, and replay idempotently', () => {
  const previous = decision({ theme: 'entity:theme-a', fingerprint: `sha256:${'3'.repeat(64)}`, id: `theme-scope-decision:${'c'.repeat(64)}`, canonicalRef: 'entity:industry-a', sourceRef: 'source:old', value: 'exclude' })
  const index = buildThemeScopeReverseIndexV04(ledger([previous], 8))
  const update = decision({ theme: 'entity:theme-a', fingerprint: previous.candidateFingerprint, id: `theme-scope-decision:${'d'.repeat(64)}`, canonicalRef: 'entity:industry-a', sourceRef: 'source:new', value: 'pending' })
  const advanced = advanceThemeScopeReverseIndexV04(index, { knowledgeBaseId: 'kb-index-test', previousRevision: 8, nextRevision: 9, workflowRunId: 'scope-update', decisions: [update] })
  assert.deepEqual(lookupAffectedThemesV04(advanced, { knowledgeBaseId: 'kb-index-test', revision: 9, changedRefs: ['source:old'] }), [])
  assert.deepEqual(lookupAffectedThemesV04(advanced, { knowledgeBaseId: 'kb-index-test', revision: 9, changedRefs: ['source:new'] }), ['entity:theme-a'])
  const replay = advanceThemeScopeReverseIndexV04(advanced, { knowledgeBaseId: 'kb-index-test', previousRevision: 9, nextRevision: 9, workflowRunId: 'replay', decisions: [previous] })
  assert.deepEqual(replay.currentDecisionsByTheme, advanced.currentDecisionsByTheme)
  assert.deepEqual(replay.decisionIds, advanced.decisionIds)
  assert.throws(() => lookupAffectedThemesV04(advanced, { knowledgeBaseId: 'kb-index-test', revision: 8, changedRefs: ['entity:industry-a'] }), /stale/u)
})

test('Writer commits a revision-bound sidecar that survives remount and rebuilds when stale', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-theme-scope-reverse-index-'))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-index-writer-test', now: NOW })
    const registry = new KnowledgeBaseRegistry()
    const preWriteHandle = await registry.mount(root)
    const created = await new ThemeManagementGatewayV04({ clock: () => NOW }).createTheme(preWriteHandle, { name: 'Index Test Theme' })
    assert.equal(created.status, 'committed')

    const remounted = await new KnowledgeBaseRegistry().mount(root)
    const loaded = await loadOrRebuildThemeScopeReverseIndexV04(remounted)
    assert.equal(loaded.status, 'available', loaded.status === 'failed' ? `${loaded.reason}: ${loaded.message}` : undefined)
    if (loaded.status !== 'available') return
    assert.equal(loaded.rebuilt, false, 'a committed matching sidecar should survive process/remount')
    assert.equal(loaded.index.revision, remounted.revision)
    assert.ok(loaded.index.sourceWorkflowRunId)
    const postWriteLookup = await lookupAffectedThemeScopeSlicesV04(preWriteHandle, [created.themeRef!], [], remounted.revision)
    assert.equal(postWriteLookup.status, 'available', 'production port remounts the handle after a successful canonical write')
    if (postWriteLookup.status === 'available') assert.equal(postWriteLookup.knowledgeBaseRevision, remounted.revision)

    const manifest = await loadKnowledgeBaseManifest(root)
    assert.equal(manifest.revision, remounted.revision)
    const sidecar = await readFile(join(root, 'governance', 'theme-scope-reverse-index-v04.yaml'), 'utf8')
    assert.ok(sidecar.includes(loaded.index.checksum))
    const staleIndex = JSON.parse(sidecar) as { revision: number }
    staleIndex.revision += 1
    await writeFile(join(root, 'governance', 'theme-scope-reverse-index-v04.yaml'), JSON.stringify(staleIndex))
    const rebuilt = await loadOrRebuildThemeScopeReverseIndexV04(await new KnowledgeBaseRegistry().mount(root))
    assert.equal(rebuilt.status, 'available')
    if (rebuilt.status === 'available') assert.equal(rebuilt.rebuilt, true, 'stale/corrupt sidecar must be rebuilt from A4 logs')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('index sidecar and canonical revision recover as one root transaction after a switch interruption', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-theme-scope-index-recovery-'))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-index-recovery-test', now: NOW })
    const manifest = await loadKnowledgeBaseManifest(root)
    await assert.rejects(runKnowledgeRootTransaction({
      rootRef: root, transactionId: 'index-recovery-test', transactionKind: 'write', knowledgeBaseId: manifest.knowledgeBaseId,
      previousRevision: manifest.revision, nextRevision: manifest.revision, targetSchemaVersion: '0.4', targetStorageFormatVersion: '1', targetStatus: 'active',
      prepare: async (staging) => {
        const index = buildThemeScopeReverseIndexV04(ledger([], manifest.revision))
        const { persistThemeScopeReverseIndexV04 } = await import('../../../knowledge/governance/theme-scope-reverse-index-v04.ts')
        await persistThemeScopeReverseIndexV04(staging, { ...index, sourceWorkflowRunId: 'recovery-anchor' })
      },
      validate: async () => undefined,
      failpoint: (point) => { if (point === 'after_switch') throw new Error('simulated interruption') },
    }), /simulated interruption/u)
    assert.equal(await recoverKnowledgeBaseRoot(root), 'recovered')
    const recoveredIndex = await readFile(join(root, 'governance', 'theme-scope-reverse-index-v04.yaml'), 'utf8')
    assert.ok(recoveredIndex.includes('kb-index-test'), recoveredIndex)
  } finally { await rm(root, { recursive: true, force: true }) }
})
