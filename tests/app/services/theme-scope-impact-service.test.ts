import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createFreshKnowledgeBaseV04 } from '../../../knowledge/storage/create-v04.ts'
import type { ThemeScopeImpactCandidate, ThemeScopeImpactCheckResult } from '../../../workflows/theme-scope-impact-check/workflow.ts'
import { ThemeScopeImpactService, type ThemeScopeImpactWriteReceipt } from '../../../app/services/theme-scope-impact-service.ts'
import { ApplicationServiceError } from '../../../app/services/contracts.ts'

const THEME = 'entity:investment-theme-ai-compute' as const
const REF = 'relation:evidence-attachment' as const

async function withKb(name: string, run: (root: string) => Promise<void>): Promise<void> {
  const root = await import('node:fs/promises').then(({ mkdtemp }) => mkdtemp(join(tmpdir(), `rhl-scope-inbox-${name}-`)))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: `kb-scope-inbox-${name}`, now: '2026-10-02T00:00:00.000Z' })
    await run(root)
  } finally { await rm(root, { recursive: true, force: true }) }
}

async function setRevision(root: string, revision: number): Promise<void> {
  const path = join(root, 'manifest.yaml')
  const manifest = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  await writeFile(path, `${JSON.stringify({ ...manifest, revision })}\n`, 'utf8')
}

function receipt(root: string, kbId: string, options: { refs?: readonly string[]; base?: number; committed?: number; writerRunId?: string; changeSetId?: string; status?: ThemeScopeImpactWriteReceipt['status'] } = {}): ThemeScopeImpactWriteReceipt {
  const refs = options.refs ?? [REF]
  return { knowledgeBaseRoot: root, knowledgeBaseId: kbId, writerRunId: options.writerRunId ?? `writer-${kbId}`, changeSetId: options.changeSetId ?? `changeset-${kbId}`, status: options.status ?? 'committed', baseRevision: options.base ?? 0, committedRevision: options.committed ?? 1, createdRefs: refs, updatedRefs: [] }
}

async function persistWriterLog(value: ThemeScopeImpactWriteReceipt): Promise<void> {
  const writeStatus = value.status === 'no_changes' ? 'no_changes' : 'committed'
  const log = { workflowRunId: value.writerRunId, changeSetId: value.changeSetId, knowledgeBaseId: value.knowledgeBaseId, status: 'completed', writeStatus, committedRevision: value.committedRevision, changes: { createdIds: value.createdRefs, updatedIds: value.updatedRefs } }
  await writeFile(join(value.knowledgeBaseRoot, 'logs', 'research', `${value.writerRunId}.yaml`), `${JSON.stringify(log)}\n`, 'utf8')
}

function candidate(evidenceRef = 'source:source-evidence'): ThemeScopeImpactCandidate {
  return {
    proposalId: `theme-scope-impact:${createHash('sha256').update(evidenceRef).digest('hex').slice(0, 40)}`,
    themeRef: THEME,
    candidate: { kind: 'industry', name: 'AI 加速器', canonicalRef: 'entity:ai-accelerator' },
    candidateFingerprint: `sha256:${createHash('sha256').update('industry:ai-accelerator').digest('hex')}`,
    changeKind: 'new_theme_node',
    rationale: 'Evidence suggests this Industry may belong in the Theme framework.',
    observed: [{ ref: REF, type: 'theme_exposure', name: 'AI 算力', sourceRefs: [evidenceRef] }],
    evidenceRefs: [evidenceRef, REF],
    changedRefs: [REF],
    basedOnRevision: 1,
  }
}

function fakeRunner(run: (refs: readonly string[]) => readonly ThemeScopeImpactCandidate[] | 'no_changes' = () => [candidate()]) {
  return async (input: Parameters<typeof import('../../../workflows/theme-scope-impact-check/workflow.ts').runThemeScopeImpactCheck>[0]): Promise<ThemeScopeImpactCheckResult> => {
    const proposals = run(input.changedRefs)
    if (proposals === 'no_changes') return { status: 'no_changes', basedOnRevision: input.committedRevision, candidates: [], diagnostics: [] }
    return { status: 'completed', basedOnRevision: input.committedRevision, candidates: proposals, diagnostics: [] }
  }
}

test('unrelated write can persist an empty inbox and public views omit local paths', async () => {
  await withKb('unrelated', async (root) => {
    await setRevision(root, 1)
    const service = new ThemeScopeImpactService({ mountedKnowledgeBaseRoot: root, impactRunner: fakeRunner(() => 'no_changes') })
    const writerReceipt = receipt(root, 'kb-scope-inbox-unrelated')
    await persistWriterLog(writerReceipt)
    const view = await service.check(writerReceipt)
    assert.equal(view.status, 'no_changes')
    assert.deepEqual(view.proposals, [])
    assert.equal(JSON.stringify(view).includes(root), false)
    assert.equal((await service.list()).total, 1)
    assert.deepEqual(await service.get(view.receiptKey), view)
  })
})

test('changed evidence forms a distinct durable proposal; duplicate receipt delivery is idempotent', async () => {
  await withKb('evidence', async (root) => {
    await setRevision(root, 1)
    let calls = 0
    const service = new ThemeScopeImpactService({
      mountedKnowledgeBaseRoot: root,
      impactRunner: fakeRunner((refs) => { calls++; return [candidate(refs[0] === 'relation:evidence-2' ? 'source:new-evidence' : 'source:source-evidence')] }),
    })
    const firstReceipt = receipt(root, 'kb-scope-inbox-evidence')
    await persistWriterLog(firstReceipt)
    const first = await service.check(firstReceipt)
    const replay = await service.check({ ...firstReceipt, status: 'already_committed' })
    assert.equal(calls, 1)
    assert.equal(replay.receiptKey, first.receiptKey)
    assert.deepEqual(replay.proposals, first.proposals)
    await setRevision(root, 2)
    const changedReceipt = receipt(root, 'kb-scope-inbox-evidence', { refs: ['relation:evidence-2'], base: 1, committed: 2, writerRunId: 'writer-second-evidence', changeSetId: 'changeset-second-evidence' })
    await persistWriterLog(changedReceipt)
    const changedEvidence = await service.check(changedReceipt)
    assert.notEqual(changedEvidence.receiptKey, first.receiptKey)
    assert.notEqual(changedEvidence.proposals[0]?.proposalId, first.proposals[0]?.proposalId)
    assert.equal((await service.list()).total, 2)
  })
})

test('a durable replay remains available after later writes while new stale proposals and stale rejections are blocked', async () => {
  await withKb('stale-replay', async (root) => {
    await setRevision(root, 1)
    const service = new ThemeScopeImpactService({ mountedKnowledgeBaseRoot: root, impactRunner: fakeRunner() })
    const writerReceipt = receipt(root, 'kb-scope-inbox-stale-replay')
    await persistWriterLog(writerReceipt)
    const created = await service.check(writerReceipt)
    await setRevision(root, 2)
    const replay = await service.check({ ...writerReceipt, status: 'already_committed' })
    assert.equal(replay.receiptKey, created.receiptKey)
    assert.equal(replay.status, 'stale')
    assert.equal((await service.get(created.receiptKey)).status, 'stale')
    await assert.rejects(service.reject(created.receiptKey, created.proposals[0]!.proposalId), (error: unknown) => error instanceof ApplicationServiceError && error.code === 'conflict')
  })
})

test('rejections are append-only under concurrent calls and duplicate notices are suppressed across Writer runs', async () => {
  await withKb('concurrent-reject', async (root) => {
    await setRevision(root, 1)
    const service = new ThemeScopeImpactService({ mountedKnowledgeBaseRoot: root, impactRunner: fakeRunner(() => [candidate('source:first'), candidate('source:second')]) })
    const firstReceipt = receipt(root, 'kb-scope-inbox-concurrent-reject')
    await persistWriterLog(firstReceipt)
    const view = await service.check(firstReceipt)
    assert.equal(view.proposals.length, 2)
    const results = await Promise.all(view.proposals.map((proposal) => service.reject(view.receiptKey, proposal.proposalId)))
    assert.deepEqual(results.map((proposal) => proposal.status), ['rejected', 'rejected'])
    assert.deepEqual((await service.get(view.receiptKey)).proposals.map((proposal) => proposal.status), ['rejected', 'rejected'])

    await setRevision(root, 2)
    const replayReceipt = receipt(root, 'kb-scope-inbox-concurrent-reject', { refs: ['relation:second-delivery'], base: 1, committed: 2, writerRunId: 'writer-second-delivery', changeSetId: 'changeset-second-delivery' })
    await persistWriterLog(replayReceipt)
    const replay = await service.check(replayReceipt)
    assert.deepEqual(replay.proposals, [])
    assert.match(replay.diagnostics.join(' '), /suppressed/u)
  })
})

test('stale receipt revision is rejected before impact lookup or persistence', async () => {
  await withKb('stale', async (root) => {
    await setRevision(root, 2)
    let calls = 0
    const service = new ThemeScopeImpactService({ mountedKnowledgeBaseRoot: root, impactRunner: async () => { calls++; return { status: 'no_changes', basedOnRevision: 1, candidates: [], diagnostics: [] } } })
    const staleReceipt = receipt(root, 'kb-scope-inbox-stale')
    await persistWriterLog(staleReceipt)
    await assert.rejects(service.check(staleReceipt), (error: unknown) => error instanceof ApplicationServiceError && error.code === 'conflict')
    assert.equal(calls, 0)
    assert.equal((await service.list()).total, 0)
  })
})

test('corrupt existing sidecar fails closed and cannot be silently replaced', async () => {
  await withKb('corrupt', async (root) => {
    await setRevision(root, 1)
    const service = new ThemeScopeImpactService({ mountedKnowledgeBaseRoot: root, impactRunner: fakeRunner() })
    const original = receipt(root, 'kb-scope-inbox-corrupt')
    await persistWriterLog(original)
    const view = await service.check(original)
    await writeFile(join(root, 'logs', 'theme-scope-impact', 'proposals', `${view.receiptKey}.json`), '{bad checksum}\n', 'utf8')
    await assert.rejects(service.check(original), (error: unknown) => error instanceof ApplicationServiceError && error.code === 'conflict')
  })
})

test('sidecar write failure returns an error without reporting an inbox record', async () => {
  await withKb('write-failure', async (root) => {
    await setRevision(root, 1)
    const directory = join(root, 'logs', 'theme-scope-impact')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'proposals'), 'occupied path', 'utf8')
    const service = new ThemeScopeImpactService({ mountedKnowledgeBaseRoot: root, impactRunner: fakeRunner() })
    const writerReceipt = receipt(root, 'kb-scope-inbox-write-failure')
    await persistWriterLog(writerReceipt)
    await assert.rejects(service.check(writerReceipt))
    const stat = await lstat(join(directory, 'proposals'))
    assert.equal(stat.isFile(), true)
  })
})

test('rejection is durable and repeated rejection is idempotent; no acceptance mutation API exists', async () => {
  await withKb('reject', async (root) => {
    await setRevision(root, 1)
    const service = new ThemeScopeImpactService({ mountedKnowledgeBaseRoot: root, impactRunner: fakeRunner() })
    const writerReceipt = receipt(root, 'kb-scope-inbox-reject')
    await persistWriterLog(writerReceipt)
    const view = await service.check(writerReceipt)
    const proposal = view.proposals[0]!
    assert.equal((await service.reject(view.receiptKey, proposal.proposalId)).status, 'rejected')
    assert.equal((await service.reject(view.receiptKey, proposal.proposalId)).status, 'rejected')
    assert.equal((await service.get(view.receiptKey)).proposals[0]?.status, 'rejected')
    assert.equal('accept' in service, false)
  })
})
