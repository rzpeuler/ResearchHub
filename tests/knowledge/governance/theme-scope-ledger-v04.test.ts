import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { KnowledgeBaseRegistry } from '../../../knowledge/registry/registry.ts'
import {
  createThemeScopeDecisionV04,
  fingerprintThemeScopeCandidateV04,
  type ThemeScopeCandidateV04,
  type ThemeScopeDecisionBatchV04,
  type ThemeScopeDecisionDraftV04,
  type ThemeScopeDecisionValueV04,
  type ThemeScopeEvidenceV04,
} from '../../../knowledge/governance/theme-scope-v04.ts'
import {
  readThemeScopeLedgerV04,
  THEME_SCOPE_LEDGER_V04_LIMITS,
} from '../../../knowledge/governance/theme-scope-ledger-v04.ts'
import { createFreshKnowledgeBaseV04 } from '../../../knowledge/storage/create-v04.ts'

const THEME = 'entity:investment-theme-ai-compute' as const
const EVIDENCE: ThemeScopeEvidenceV04 = {
  sourceRef: 'source:industry-report-1',
  rawRef: ('raw-sha256-' + 'a'.repeat(64)) as ThemeScopeEvidenceV04['rawRef'],
  locator: 'page 4, section 2',
}
const NEW_EVIDENCE: ThemeScopeEvidenceV04 = {
  sourceRef: 'source:industry-report-2',
  rawRef: ('raw-sha256-' + 'b'.repeat(64)) as ThemeScopeEvidenceV04['rawRef'],
  locator: 'page 8, paragraph 3',
}

interface WriterLogOptions {
  readonly status?: string
  readonly writeStatus?: string
  readonly committedRevision?: number
  readonly knowledgeBaseId?: string
  readonly workflowRunId?: string
  readonly schemaVersionAtExecution?: string
  readonly themeScope?: unknown
  readonly context?: unknown
}

async function withFreshKb(name: string, run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'rhl-theme-scope-ledger-' + name + '-'))
  try {
    await createFreshKnowledgeBaseV04(root, {
      knowledgeBaseId: 'kb-theme-scope-ledger-' + name,
      now: '2026-10-02T00:00:00.000Z',
    })
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function industry(name: string): ThemeScopeCandidateV04 {
  return { kind: 'industry', name }
}

function makeDecision(options: {
  readonly candidate: ThemeScopeCandidateV04
  readonly decision?: ThemeScopeDecisionValueV04
  readonly themeRef?: string
  readonly revision: number
  readonly previousDecisionId?: ThemeScopeDecisionDraftV04['previousDecisionId']
  readonly evidence?: readonly ThemeScopeEvidenceV04[]
  readonly reopenBasis?: ThemeScopeDecisionDraftV04['reopenBasis']
}) {
  return createThemeScopeDecisionV04({
    version: '0.4',
    themeRef: (options.themeRef ?? THEME) as ThemeScopeDecisionDraftV04['themeRef'],
    candidate: options.candidate,
    candidateFingerprint: fingerprintThemeScopeCandidateV04(options.candidate),
    decision: options.decision ?? 'pending',
    rationale: 'A bounded reason for this scope decision.',
    evidence: options.evidence ?? [],
    coverageGaps: [],
    review: { status: 'suggested' },
    basedOnRevision: options.revision,
    affectedBranchKeys: ['ai-compute'],
    ...(options.previousDecisionId === undefined ? {} : { previousDecisionId: options.previousDecisionId }),
    ...(options.reopenBasis === undefined ? {} : { reopenBasis: options.reopenBasis }),
  })
}

function batch(decision: ReturnType<typeof makeDecision>, revision: number): ThemeScopeDecisionBatchV04 {
  return {
    version: '0.4',
    themeRef: decision.themeRef,
    basedOnRevision: revision,
    decisions: [decision],
  }
}

async function writeScopeLog(
  root: string,
  workflowRunId: string,
  scope: unknown,
  options: WriterLogOptions = {},
): Promise<void> {
  const manifestPath = join(root, 'manifest.yaml')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
  const scopeRecord = scope as { basedOnRevision?: unknown } | null
  const committedRevision = options.committedRevision
    ?? (typeof scopeRecord?.basedOnRevision === 'number' ? scopeRecord.basedOnRevision + 1 : 1)
  const knowledgeBaseId = typeof manifest.knowledgeBaseId === 'string' ? manifest.knowledgeBaseId : ''
  await writeFile(manifestPath, JSON.stringify({ ...manifest, revision: Math.max(Number(manifest.revision ?? 0), committedRevision) }) + '\n', 'utf8')
  const context = options.context ?? { themeScope: scope }
  const log = {
    workflowRunId: options.workflowRunId ?? workflowRunId,
    knowledgeBaseId: options.knowledgeBaseId ?? knowledgeBaseId,
    schemaVersionAtExecution: options.schemaVersionAtExecution ?? '0.4',
    status: options.status ?? 'completed',
    writeStatus: options.writeStatus ?? 'committed',
    committedRevision,
    ingestionContext: context,
  }
  await writeFile(join(root, 'logs', 'research', workflowRunId + '.yaml'), JSON.stringify(log) + '\n', 'utf8')
}

async function mounted(root: string) {
  return new KnowledgeBaseRegistry().mount(root)
}

function assertFailed(result: Awaited<ReturnType<typeof readThemeScopeLedgerV04>>, code: string): void {
  assert.equal(result.status, 'failed')
  if (result.status === 'failed') assert.equal(result.error.code, code)
}

test('Theme scope ledger replays include, exclude, and evidence-backed reopening by candidate fingerprint', async () => {
  await withFreshKb('versions', async (root) => {
    const candidate = industry('Advanced Packaging')
    const fingerprint = fingerprintThemeScopeCandidateV04(candidate)
    const included = makeDecision({ candidate, decision: 'include', revision: 0, evidence: [EVIDENCE] })
    const excluded = makeDecision({
      candidate,
      decision: 'exclude',
      revision: 1,
      previousDecisionId: included.id,
      evidence: [EVIDENCE],
    })
    await writeScopeLog(root, 'scope-include', batch(included, 0))
    await writeScopeLog(root, 'scope-exclude', batch(excluded, 1))

    const afterExclude = await readThemeScopeLedgerV04(await mounted(root))
    assert.equal(afterExclude.status, 'available')
    if (afterExclude.status !== 'available') return
    const priorTheme = afterExclude.themes.find((theme) => theme.themeRef === THEME)
    assert.ok(priorTheme)
    const priorCurrent = priorTheme.currentByCandidateFingerprint[fingerprint]
    assert.equal(priorCurrent?.decision.decision, 'exclude')

    // Build the next evidence set from the ledger's current state. Existing evidence is suppressed.
    const knownEvidence = new Set(priorCurrent!.decision.evidence.map((item) => item.sourceRef + '|' + item.rawRef + '|' + item.locator))
    const unseenEvidence = [EVIDENCE, NEW_EVIDENCE].filter((item) => !knownEvidence.has(item.sourceRef + '|' + item.rawRef + '|' + item.locator))
    const reopenedEvidence = [...priorCurrent!.decision.evidence, ...unseenEvidence]
    const reopened = makeDecision({
      candidate,
      decision: 'include',
      revision: 2,
      previousDecisionId: priorCurrent!.decision.id,
      evidence: reopenedEvidence,
      reopenBasis: {
        rationale: 'A new independent report supports reconsideration.',
        evidence: [NEW_EVIDENCE],
      },
    })
    await writeScopeLog(root, 'scope-reopen', batch(reopened, 2))

    const result = await readThemeScopeLedgerV04(await mounted(root))
    assert.equal(result.status, 'available')
    if (result.status !== 'available') return
    assert.equal(result.knowledgeBaseRevision, 3)
    assert.equal(result.scopeBatchCount, 3)
    assert.equal(result.decisionCount, 3)
    const theme = result.themes.find((item) => item.themeRef === THEME)
    assert.ok(theme)
    assert.deepEqual(theme.history.map((item) => item.decision.decision), ['include', 'exclude', 'include'])
    assert.equal(theme.currentByCandidateFingerprint[fingerprint]?.decision.id, reopened.id)
    assert.equal(theme.currentByCandidateFingerprint[fingerprint]?.committedRevision, 3)
    assert.equal(theme.currentByCandidateFingerprint[fingerprint]?.decision.evidence.length, 2)
    assert.deepEqual(theme.currentByCandidateFingerprint[fingerprint]?.decision.evidence, [EVIDENCE, NEW_EVIDENCE])
  })
})

test('Theme scope ledger ignores ordinary Writer logs without ingestionContext.themeScope', async () => {
  await withFreshKb('ordinary', async (root) => {
    const ordinary = {
      workflowRunId: 'ordinary-research-run',
      knowledgeBaseId: 'kb-theme-scope-ledger-ordinary',
      schemaVersionAtExecution: '0.4',
      status: 'completed',
      writeStatus: 'committed',
      committedRevision: 0,
      ingestionContext: { producerType: 'company_research' },
    }
    await writeFile(join(root, 'logs', 'research', 'ordinary-research-run.yaml'), JSON.stringify(ordinary) + '\n', 'utf8')
    const result = await readThemeScopeLedgerV04(await mounted(root))
    assert.equal(result.status, 'available')
    if (result.status === 'available') {
      assert.deepEqual(result.themes, [])
      assert.equal(result.scopeBatchCount, 0)
      assert.equal(result.knowledgeBaseRevision, 0)
    }
  })
})

test('Theme scope ledger fails closed on a missing predecessor in committed history', async () => {
  await withFreshKb('missing-parent', async (root) => {
    const decision = makeDecision({
      candidate: industry('Missing Parent Industry'),
      decision: 'include',
      revision: 0,
      evidence: [EVIDENCE],
      previousDecisionId: ('theme-scope-decision:' + 'f'.repeat(64)) as ThemeScopeDecisionDraftV04['previousDecisionId'],
    })
    await writeScopeLog(root, 'missing-parent-run', batch(decision, 0))
    const result = await readThemeScopeLedgerV04(await mounted(root))
    assert.equal(result.status, 'failed')
    if (result.status === 'failed') {
      assert.equal(result.error.code, 'SCOPE_BATCH_INVALID')
      assert.ok(result.error.issues?.some((issue) => issue.code === 'THEME_SCOPE_PREVIOUS_MISSING'))
    }
  })
})

test('Theme scope ledger rejects duplicate decision IDs and ambiguous same-revision batches', async () => {
  await withFreshKb('duplicate-id', async (root) => {
    const decision = makeDecision({ candidate: industry('Duplicate ID Industry'), revision: 0 })
    await writeScopeLog(root, 'duplicate-original', batch(decision, 0))
    await writeScopeLog(root, 'duplicate-replay', { ...batch(decision, 1), basedOnRevision: 1 }, { committedRevision: 2 })
    assertFailed(await readThemeScopeLedgerV04(await mounted(root)), 'SCOPE_DECISION_DUPLICATE')
  })

  await withFreshKb('same-revision', async (root) => {
    const left = makeDecision({ candidate: industry('Independent Industry A'), themeRef: THEME, revision: 0 })
    const right = makeDecision({ candidate: industry('Independent Industry B'), themeRef: 'entity:investment-theme-cloud', revision: 0 })
    await writeScopeLog(root, 'same-revision-left', batch(left, 0))
    await writeScopeLog(root, 'same-revision-right', batch(right, 0))
    assertFailed(await readThemeScopeLedgerV04(await mounted(root)), 'SCOPE_REVISION_AMBIGUOUS')
  })
})

test('Theme scope ledger rejects malformed, uncommitted, future, and misidentified scope logs', async () => {
  await withFreshKb('malformed', async (root) => {
    const malformed = { version: '0.4', themeRef: THEME, basedOnRevision: 0, decisions: [{ id: 'broken' }] }
    await writeScopeLog(root, 'malformed-scope', malformed)
    assertFailed(await readThemeScopeLedgerV04(await mounted(root)), 'SCOPE_BATCH_INVALID')
  })

  await withFreshKb('uncommitted', async (root) => {
    const decision = makeDecision({ candidate: industry('Uncommitted Industry'), revision: 0 })
    await writeScopeLog(root, 'uncommitted-scope', batch(decision, 0), { writeStatus: 'no_changes' })
    assertFailed(await readThemeScopeLedgerV04(await mounted(root)), 'LOG_UNCOMMITTED')
  })

  await withFreshKb('future', async (root) => {
    const decision = makeDecision({ candidate: industry('Future Revision Industry'), revision: 0 })
    await writeScopeLog(root, 'future-scope', batch(decision, 0), { committedRevision: 1 })
    const manifestPath = join(root, 'manifest.yaml')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
    await writeFile(manifestPath, JSON.stringify({ ...manifest, revision: 0 }) + '\n', 'utf8')
    assertFailed(await readThemeScopeLedgerV04(await mounted(root)), 'LOG_REVISION_FUTURE')
  })

  await withFreshKb('identity', async (root) => {
    const decision = makeDecision({ candidate: industry('Misidentified Industry'), revision: 0 })
    await writeScopeLog(root, 'identity-scope', batch(decision, 0), { workflowRunId: 'different-run' })
    assertFailed(await readThemeScopeLedgerV04(await mounted(root)), 'LOG_IDENTITY_MISMATCH')
  })
})

test('Theme scope ledger rejects a symlinked research log directory and pending recovery marker', async () => {
  await withFreshKb('symlink', async (root) => {
    const researchDirectory = join(root, 'logs', 'research')
    const target = await mkdtemp(join(tmpdir(), 'rhl-theme-scope-ledger-target-'))
    try {
      await rm(researchDirectory, { recursive: true, force: true })
      await symlink(target, researchDirectory, 'junction')
      assertFailed(await readThemeScopeLedgerV04(await mounted(root)), 'LOG_PATH_UNSAFE')
    } finally {
      await rm(target, { recursive: true, force: true })
    }
  })

  await withFreshKb('recovery-marker', async (root) => {
    await writeFile(root + '.recovery.json', '{}\n', 'utf8')
    assertFailed(await readThemeScopeLedgerV04(await mounted(root)), 'KNOWLEDGE_BASE_RECOVERY_PENDING')
  })
})

test('Theme scope ledger enforces the per-log byte bound before parsing', async () => {
  await withFreshKb('byte-bound', async (root) => {
    const oversized = ' '.repeat(THEME_SCOPE_LEDGER_V04_LIMITS.maxLogBytes + 1)
    await writeFile(join(root, 'logs', 'research', 'oversized-log.yaml'), oversized, 'utf8')
    assertFailed(await readThemeScopeLedgerV04(await mounted(root)), 'LOG_SIZE_LIMIT')
  })
})
