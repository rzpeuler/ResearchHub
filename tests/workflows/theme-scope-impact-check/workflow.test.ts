import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createFreshKnowledgeBaseV04 } from '../../../knowledge/storage/create-v04.ts'
import { KnowledgeBaseRegistry } from '../../../knowledge/registry/registry.ts'
import { readThemeScopeLedgerV04, type ThemeScopeLedgerThemeV04 } from '../../../knowledge/governance/theme-scope-ledger-v04.ts'
import { createThemeScopeDecisionV04, fingerprintThemeScopeCandidateV04, type ThemeScopeCandidateV04, type ThemeScopeDecisionDraftV04, type ThemeScopeEvidenceV04 } from '../../../knowledge/governance/theme-scope-v04.ts'
import { runThemeScopeImpactCheck } from '../../../workflows/theme-scope-impact-check/workflow.ts'

const THEME = 'entity:investment-theme-ai-compute' as const
const OLD_EVIDENCE: ThemeScopeEvidenceV04 = { sourceRef: 'source:old-report', rawRef: ('raw-sha256-' + 'a'.repeat(64)) as ThemeScopeEvidenceV04['rawRef'], locator: 'page 1' }
const NEW_EVIDENCE: ThemeScopeEvidenceV04 = { sourceRef: 'source:new-report', rawRef: ('raw-sha256-' + 'b'.repeat(64)) as ThemeScopeEvidenceV04['rawRef'], locator: 'page 2' }

async function withKb(name: string, run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), `rhl-theme-scope-impact-${name}-`))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: `kb-theme-scope-impact-${name}`, now: '2026-10-02T00:00:00.000Z' })
    await run(root)
  } finally { await rm(root, { recursive: true, force: true }) }
}

function draft(candidate: ThemeScopeCandidateV04, options: { decision?: 'include' | 'exclude' | 'pending'; revision: number; evidence?: readonly ThemeScopeEvidenceV04[]; previousDecisionId?: ThemeScopeDecisionDraftV04['previousDecisionId'] }) {
  return createThemeScopeDecisionV04({ version: '0.4', themeRef: THEME, candidate, candidateFingerprint: fingerprintThemeScopeCandidateV04(candidate), decision: options.decision ?? 'include', rationale: 'Evidence-backed Theme boundary decision.', evidence: options.evidence ?? [OLD_EVIDENCE], coverageGaps: [], review: { status: 'suggested' }, basedOnRevision: options.revision, affectedBranchKeys: ['ai-compute'], ...(options.previousDecisionId ? { previousDecisionId: options.previousDecisionId } : {}) })
}

async function appendScope(root: string, workflowRunId: string, decision: ReturnType<typeof draft>, basedOnRevision: number): Promise<void> {
  const manifestPath = join(root, 'manifest.yaml')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
  const committedRevision = basedOnRevision + 1
  await writeFile(manifestPath, JSON.stringify({ ...manifest, revision: committedRevision }) + '\n', 'utf8')
  const batch = { version: '0.4', themeRef: THEME, basedOnRevision, decisions: [decision] }
  const log = { workflowRunId, knowledgeBaseId: manifest.knowledgeBaseId, schemaVersionAtExecution: '0.4', status: 'completed', writeStatus: 'committed', committedRevision, ingestionContext: { themeScope: batch } }
  await writeFile(join(root, 'logs', 'research', `${workflowRunId}.yaml`), JSON.stringify(log) + '\n', 'utf8')
}

async function addObjects(root: string, objects: readonly { readonly type: string; readonly value: Record<string, unknown> }[]): Promise<void> {
  const path = join(root, 'registry', 'assets.yaml')
  const registry = JSON.parse(await readFile(path, 'utf8')) as Record<string, { type: string; storageRef: string }>
  for (const { type, value } of objects) {
    const id = String(value.id)
    const storageRef = `objects/${id.replace(':', '/')}.yaml`
    await mkdir(join(root, 'objects', id.split(':')[0]), { recursive: true })
    await writeFile(join(root, storageRef), JSON.stringify(value) + '\n', 'utf8')
    registry[id] = { type, storageRef }
  }
  await writeFile(path, JSON.stringify(registry) + '\n', 'utf8')
}

async function mount(root: string) { return new KnowledgeBaseRegistry().mount(root) }
function affectedLookup(root: string, themeRefs: readonly string[], observedCalls: { refs: string[]; fingerprints: string[] }[] = []) {
  return async (changedRefs: readonly string[], changedFingerprints: readonly string[], _revision: number) => {
    observedCalls.push({ refs: [...changedRefs], fingerprints: [...changedFingerprints] })
    const ledger = await readThemeScopeLedgerV04(await mount(root))
    if (ledger.status === 'failed') return { status: 'failed' as const, error: `${ledger.error.code}: ${ledger.error.message}` }
    const wantedThemes = new Set(themeRefs)
    const themes: ThemeScopeLedgerThemeV04[] = ledger.themes.filter((theme) => wantedThemes.has(theme.themeRef))
    return { status: 'available' as const, knowledgeBaseRevision: ledger.knowledgeBaseRevision, themes }
  }
}
async function bumpRevision(root: string, revision: number): Promise<void> {
  const path = join(root, 'manifest.yaml')
  const manifest = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  await writeFile(path, JSON.stringify({ ...manifest, revision }) + '\n', 'utf8')
}

const industry = (id: string, name: string) => ({ type: 'entity', value: { id: `entity:${id}`, type: 'industry', name, aliases: [], lifecycle: { status: 'active' } } })
const claim = (id: string, subjectRef: string, sourceRef: string) => ({ type: 'claim', value: { id: `claim:${id}`, subjectRefs: [subjectRef], sourceRefs: [sourceRef], claimType: 'fact', statement: `${id} evidence`, lifecycle: { status: 'active' } } })

test('unrelated canonical write yields no impact candidate and does not scan unrelated Themes', async () => {
  await withKb('unrelated', async (root) => {
    const candidate: ThemeScopeCandidateV04 = { kind: 'industry', name: 'Memory', canonicalRef: 'entity:memory' }
    await addObjects(root, [industry('memory', 'Memory'), industry('other', 'Other'), claim('unrelated', 'entity:other', 'source:unrelated')])
    await appendScope(root, 'scope-memory', draft(candidate, { revision: 0 }), 0)
    await bumpRevision(root, 2)
    const lookupCalls: { refs: string[]; fingerprints: string[] }[] = []
    const handle = await mount(root)
    const result = await runThemeScopeImpactCheck({ handle, baseRevision: 1, committedRevision: 2, changedRefs: ['claim:unrelated'], lookupAffectedThemes: affectedLookup(root, [], lookupCalls) })
    assert.equal(result.status, 'completed')
    if (result.status === 'completed') assert.deepEqual(result.candidates, [])
    assert.deepEqual(lookupCalls, [{ refs: ['claim:unrelated', 'entity:other', 'source:unrelated'], fingerprints: [fingerprintThemeScopeCandidateV04({ kind: 'industry', name: 'Other' })] }])
  })
})

test('materially new evidence attached to an excluded Industry reopens only that candidate', async () => {
  await withKb('new-evidence', async (root) => {
    const candidate: ThemeScopeCandidateV04 = { kind: 'industry', name: 'Memory' }
    await addObjects(root, [industry('memory', 'Memory'), claim('new-evidence', 'entity:memory', NEW_EVIDENCE.sourceRef)])
    await appendScope(root, 'scope-memory-excluded', draft(candidate, { decision: 'exclude', revision: 0, evidence: [OLD_EVIDENCE] }), 0)
    await bumpRevision(root, 2)
    const lookupCalls: { refs: string[]; fingerprints: string[] }[] = []
    const result = await runThemeScopeImpactCheck({ handle: await mount(root), baseRevision: 1, committedRevision: 2, changedRefs: ['claim:new-evidence'], lookupAffectedThemes: affectedLookup(root, [THEME], lookupCalls) })
    assert.equal(result.status, 'completed')
    if (result.status !== 'completed') return
    assert.equal(result.candidates.length, 1)
    assert.equal(result.candidates[0]?.changeKind, 'excluded_candidate_new_evidence')
    assert.deepEqual(result.candidates[0]?.evidenceRefs, ['claim:new-evidence', NEW_EVIDENCE.sourceRef])
    assert.equal(result.candidates[0]?.priorDecision?.decision, 'exclude')
    assert.deepEqual(lookupCalls[0]?.fingerprints, [fingerprintThemeScopeCandidateV04({ kind: 'industry', name: 'Memory' })])
    assert.ok(lookupCalls[0]?.refs.includes('entity:memory'))
  })
})

test('new Industry relation intersects a confirmed Theme and reverse lookup receives endpoint fingerprints', async () => {
  await withKb('new-edge-intersection', async (root) => {
    const confirmed: ThemeScopeCandidateV04 = { kind: 'industry', name: 'Known', canonicalRef: 'entity:known' }
    await addObjects(root, [
      industry('known', 'Known'), industry('new', 'New Industry'),
      { type: 'relation', value: { id: 'relation:new-edge', type: 'upstream_of', sourceRef: 'entity:new', targetRef: 'entity:known', sourceRefs: [NEW_EVIDENCE.sourceRef], lifecycle: { status: 'active' } } },
    ])
    await appendScope(root, 'scope-known', draft(confirmed, { revision: 0 }), 0)
    await bumpRevision(root, 2)
    const calls: { refs: string[]; fingerprints: string[] }[] = []
    const result = await runThemeScopeImpactCheck({
      handle: await mount(root), baseRevision: 1, committedRevision: 2, changedRefs: ['relation:new-edge'],
      lookupAffectedThemes: async (refs, fingerprints, revision) => {
        calls.push({ refs: [...refs], fingerprints: [...fingerprints] })
        const ledger = await readThemeScopeLedgerV04(await mount(root))
        if (ledger.status === 'failed') return { status: 'failed', error: ledger.error.message }
        return { status: 'available', knowledgeBaseRevision: revision, themes: ledger.themes }
      },
    })
    assert.equal(result.status, 'completed')
    if (result.status !== 'completed') return
    assert.ok(result.candidates.some((candidate) => candidate.changeKind === 'new_theme_node' && candidate.candidate.kind === 'industry' && candidate.candidate.name === 'New Industry'))
    assert.ok(calls[0]?.refs.includes('entity:known'))
    assert.ok(calls[0]?.refs.includes('entity:new'))
    assert.ok(calls[0]?.fingerprints.includes(fingerprintThemeScopeCandidateV04({ kind: 'industry', name: 'New Industry' })))
    assert.ok(calls[0]?.fingerprints.includes(fingerprintThemeScopeCandidateV04({ kind: 'industry', name: 'Known' })))
    assert.ok(calls[0]?.fingerprints.includes(fingerprintThemeScopeCandidateV04({ kind: 'relation', relationType: 'upstream_of', sourceFingerprint: fingerprintThemeScopeCandidateV04({ kind: 'industry', name: 'New Industry' }), targetFingerprint: fingerprintThemeScopeCandidateV04({ kind: 'industry', name: 'Known' }) })))
  })
})

test('proposal fingerprints are stable on replay and a recorded pending decision suppresses repeats', async () => {
  await withKb('replay', async (root) => {
    await addObjects(root, [industry('included', 'Included'), industry('candidate', 'Candidate'), { type: 'relation', value: { id: 'relation:exposure', type: 'theme_exposure', sourceRef: THEME, targetRef: 'entity:candidate', sourceRefs: [NEW_EVIDENCE.sourceRef], lifecycle: { status: 'active' } } }])
    const included: ThemeScopeCandidateV04 = { kind: 'industry', name: 'Included', canonicalRef: 'entity:included' }
    await appendScope(root, 'scope-included', draft(included, { revision: 0 }), 0)
    await bumpRevision(root, 2)
    const handle = await mount(root)
    const first = await runThemeScopeImpactCheck({ handle, baseRevision: 1, committedRevision: 2, changedRefs: ['relation:exposure'], lookupAffectedThemes: affectedLookup(root, [THEME]) })
    const replay = await runThemeScopeImpactCheck({ handle, baseRevision: 1, committedRevision: 2, changedRefs: ['relation:exposure'], lookupAffectedThemes: affectedLookup(root, [THEME]) })
    assert.equal(first.status, 'completed'); assert.equal(replay.status, 'completed')
    if (first.status !== 'completed' || replay.status !== 'completed') return
    assert.equal(first.candidates[0]?.changeKind, 'new_theme_node')
    assert.equal(first.candidates[0]?.proposalId, replay.candidates[0]?.proposalId)
    const pendingCandidate: ThemeScopeCandidateV04 = { kind: 'industry', name: 'Candidate', canonicalRef: 'entity:candidate' }
    await appendScope(root, 'scope-candidate-pending', draft(pendingCandidate, { decision: 'pending', revision: 2, evidence: [OLD_EVIDENCE] }), 2)
    const noChangeLookups: { refs: string[]; fingerprints: string[] }[] = []
    const afterDecision = await runThemeScopeImpactCheck({ handle: await mount(root), baseRevision: 3, committedRevision: 3, changedRefs: [], lookupAffectedThemes: affectedLookup(root, [THEME], noChangeLookups) })
    assert.equal(afterDecision.status, 'no_changes')
    assert.deepEqual(noChangeLookups, [])
    const replayAfterDecision = await runThemeScopeImpactCheck({ handle: await mount(root), baseRevision: 2, committedRevision: 3, changedRefs: ['relation:exposure'], lookupAffectedThemes: affectedLookup(root, [THEME]) })
    assert.equal(replayAfterDecision.status, 'completed')
    if (replayAfterDecision.status === 'completed') assert.deepEqual(replayAfterDecision.candidates, [])
  })
})

test('a changed canonical Relation is surfaced when its confirmed endpoint binding drifts', async () => {
  await withKb('changed-link', async (root) => {
    const sourceCandidate: ThemeScopeCandidateV04 = { kind: 'industry', name: 'Source', canonicalRef: 'entity:source' }
    const targetCandidate: ThemeScopeCandidateV04 = { kind: 'industry', name: 'Target', canonicalRef: 'entity:target' }
    const linkCandidate: ThemeScopeCandidateV04 = {
      kind: 'relation', relationType: 'upstream_of', sourceFingerprint: fingerprintThemeScopeCandidateV04(sourceCandidate), targetFingerprint: fingerprintThemeScopeCandidateV04(targetCandidate), canonicalRef: 'relation:link',
    }
    const decisions = [draft(sourceCandidate, { revision: 0 }), draft(targetCandidate, { revision: 0 }), draft(linkCandidate, { revision: 0 })]
    const history = decisions.map((decision) => ({ workflowRunId: 'scope-seed', committedRevision: 1, decision }))
    const theme: ThemeScopeLedgerThemeV04 = {
      themeRef: THEME,
      history,
      currentByCandidateFingerprint: Object.fromEntries(decisions.map((decision) => [decision.candidateFingerprint, history.find((entry) => entry.decision.id === decision.id)!])),
    }
    await addObjects(root, [industry('source', 'Source'), industry('target', 'Target'), industry('actual-source', 'Actual Source'), { type: 'relation', value: { id: 'relation:link', type: 'upstream_of', sourceRef: 'entity:actual-source', targetRef: 'entity:target', sourceRefs: ['source:new-link-evidence'], lifecycle: { status: 'active' } } }])
    await bumpRevision(root, 2)
    const result = await runThemeScopeImpactCheck({
      handle: await mount(root), baseRevision: 1, committedRevision: 2, changedRefs: ['relation:link'],
      lookupAffectedThemes: async (refs, _fingerprints, revision) => {
        assert.ok(refs.includes('relation:link')); assert.ok(refs.includes('entity:target')); assert.equal(revision, 2)
        return { status: 'available', knowledgeBaseRevision: 2, themes: [theme] }
      },
    })
    assert.equal(result.status, 'completed')
    if (result.status !== 'completed') return
    assert.equal(result.candidates.length, 2)
    const changedLink = result.candidates.find((item) => item.changeKind === 'confirmed_link_changed')
    const newNode = result.candidates.find((item) => item.changeKind === 'new_theme_node')
    assert.ok(changedLink)
    assert.equal(changedLink?.observed[0]?.sourceRef, 'entity:actual-source')
    assert.ok(newNode)
  })
})

test('stale write revision and unavailable scope ledger fail closed', async () => {
  await withKb('stale', async (root) => {
    await addObjects(root, [industry('changed', 'Changed')])
    const stale = await runThemeScopeImpactCheck({ handle: await mount(root), baseRevision: 0, committedRevision: 1, changedRefs: ['entity:changed'], lookupAffectedThemes: affectedLookup(root, []) })
    assert.equal(stale.status, 'blocked')
    if (stale.status === 'blocked') assert.equal(stale.code, 'stale_revision')
  })
  await withKb('ledger-failed', async (root) => {
    await writeFile(join(root, 'logs', 'research', 'broken.yaml'), '{broken\n', 'utf8')
    await addObjects(root, [industry('any', 'Any')])
    await bumpRevision(root, 1)
    const failed = await runThemeScopeImpactCheck({ handle: await mount(root), baseRevision: 0, committedRevision: 1, changedRefs: ['entity:any'], lookupAffectedThemes: affectedLookup(root, []) })
    assert.equal(failed.status, 'blocked')
    if (failed.status === 'blocked') assert.equal(failed.code, 'scope_ledger_unavailable')
  })
})
