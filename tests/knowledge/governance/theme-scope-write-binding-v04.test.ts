import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  createThemeScopeDecisionV04,
  fingerprintThemeScopeCandidateV04,
  type ThemeScopeCandidateV04,
  type ThemeScopeDecisionBatchV04,
  type ThemeScopeDecisionDraftV04,
  type ThemeScopeDecisionValueV04,
  type ThemeScopeReviewV04,
} from '../../../knowledge/governance/theme-scope-v04.ts'
import { readThemeScopeLedgerV04 } from '../../../knowledge/governance/theme-scope-ledger-v04.ts'
import { ThemeManagementGatewayV04 } from '../../../knowledge/production/theme-management-v04.ts'
import { KnowledgeBaseRegistry } from '../../../knowledge/registry/registry.ts'
import type { KnowledgeIndustryV04, KnowledgeInvestmentThemeV04 } from '../../../knowledge/schema/domain-v04.ts'
import type { KnowledgeChangeSetV04, KnowledgeOperationV04, KnowledgeWriteResultV04 } from '../../../knowledge/schema/mutation-v04.ts'
import { createFreshKnowledgeBaseV04, loadKnowledgeBaseManifest, readCanonicalV04Assets } from '../../../knowledge/storage/index.ts'
import { hashKnowledgeObject } from '../../../knowledge/storage/canonical-hash.ts'
import { validateKnowledgeChangeSetV04 } from '../../../knowledge/validation/v04-change-set-validator.ts'
import { writeKnowledgeBase } from '../../../knowledge/writer/writer.ts'

const NOW = '2026-10-02T00:00:00.000Z'
const clock = () => NOW

async function withFreshKb(name: string, run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), `rhl-theme-scope-write-${name}-`))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: `kb-theme-scope-write-${name}`, now: NOW })
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function mount(root: string) {
  return new KnowledgeBaseRegistry().mount(root)
}

async function createTheme(root: string, name = 'AI Compute') {
  const result = await new ThemeManagementGatewayV04({ clock }).createTheme(await mount(root), { name })
  assert.equal(result.status, 'committed', result.errors.map((error) => error.message).join('; '))
  assert.ok(result.themeRef)
  return result.themeRef
}

function decision(options: {
  readonly themeRef: string
  readonly revision: number
  readonly name: string
  readonly value?: ThemeScopeDecisionValueV04
  readonly review?: ThemeScopeReviewV04
  readonly canonicalRef?: string
  readonly previousDecisionId?: ThemeScopeDecisionDraftV04['previousDecisionId']
}) {
  const candidate: ThemeScopeCandidateV04 = {
    kind: 'industry',
    name: options.name,
    ...(options.canonicalRef === undefined ? {} : { canonicalRef: options.canonicalRef as `entity:${string}` }),
  }
  return createThemeScopeDecisionV04({
    version: '0.4',
    themeRef: options.themeRef as ThemeScopeDecisionDraftV04['themeRef'],
    candidate,
    candidateFingerprint: fingerprintThemeScopeCandidateV04(candidate),
    decision: options.value ?? 'pending',
    rationale: `Reviewed scope for ${options.name}.`,
    evidence: [],
    coverageGaps: [],
    review: options.review ?? { status: 'human_confirmed', confirmedAt: NOW },
    basedOnRevision: options.revision,
    affectedBranchKeys: ['ai-compute'],
    ...(options.previousDecisionId === undefined ? {} : { previousDecisionId: options.previousDecisionId }),
  })
}

function batch(themeRef: string, revision: number, decisions: ReturnType<typeof decision>[]): ThemeScopeDecisionBatchV04 {
  return { version: '0.4', themeRef: themeRef as ThemeScopeDecisionBatchV04['themeRef'], basedOnRevision: revision, decisions }
}

function changeSet(
  handle: Awaited<ReturnType<typeof mount>>,
  runId: string,
  themeScope: unknown,
  operations: readonly KnowledgeOperationV04[] = [],
): KnowledgeChangeSetV04 {
  return {
    changeSetId: `changeset-${runId}`,
    workflowRunId: runId,
    knowledgeBaseId: handle.knowledgeBaseId,
    schemaVersion: '0.4',
    storageFormatVersion: '1',
    expectedBaseRevision: handle.revision,
    operations,
    ingestionContext: { producerType: 'theme_framework', themeScope },
  }
}

async function commit(handle: Awaited<ReturnType<typeof mount>>, set: KnowledgeChangeSetV04): Promise<KnowledgeWriteResultV04> {
  const validation = await validateKnowledgeChangeSetV04(handle, set, { mode: 'commit', now: clock })
  assert.ok(validation.validatedChangeSet, JSON.stringify(validation.report.errors))
  return await writeKnowledgeBase(handle, validation.validatedChangeSet, { registry: new KnowledgeBaseRegistry(), clock }) as KnowledgeWriteResultV04
}

test('governance-only scope writes advance one revision, preserve history, and replay idempotently', async () => {
  await withFreshKb('governance-only', async (root) => {
    const themeRef = await createTheme(root)
    const initialHandle = await mount(root)
    const pending = decision({ themeRef, revision: initialHandle.revision, name: 'Compute accelerators' })
    const excluded = decision({ themeRef, revision: initialHandle.revision, name: 'Consumer electronics', value: 'exclude' })
    const firstBatch = batch(themeRef, initialHandle.revision, [pending, excluded])
    const firstSet = changeSet(initialHandle, 'scope-initial-run', firstBatch)
    const firstValidation = await validateKnowledgeChangeSetV04(initialHandle, firstSet, { mode: 'commit', now: clock })
    assert.ok(firstValidation.validatedChangeSet, JSON.stringify(firstValidation.report.errors))

    const firstWrite = await writeKnowledgeBase(initialHandle, firstValidation.validatedChangeSet, { registry: new KnowledgeBaseRegistry(), clock }) as KnowledgeWriteResultV04
    assert.equal(firstWrite.status, 'committed', firstWrite.error?.message)
    assert.equal(firstWrite.createdIds.length + firstWrite.updatedIds.length, 0)
    assert.equal(firstWrite.committedRevision, initialHandle.revision + 1)
    assert.equal((await loadKnowledgeBaseManifest(root)).revision, initialHandle.revision + 1)

    const nextHandle = await mount(root)
    const changedPending = decision({
      themeRef,
      revision: nextHandle.revision,
      name: 'Compute accelerators',
      value: 'exclude',
      previousDecisionId: pending.id,
    })
    const secondBatch = batch(themeRef, nextHandle.revision, [changedPending])
    const secondWrite = await commit(nextHandle, changeSet(nextHandle, 'scope-history-run', secondBatch))
    assert.equal(secondWrite.status, 'committed', secondWrite.error?.message)
    assert.equal(secondWrite.committedRevision, initialHandle.revision + 2)

    const ledger = await readThemeScopeLedgerV04(await mount(root))
    assert.equal(ledger.status, 'available')
    if (ledger.status === 'available') {
      assert.equal(ledger.decisionCount, 3)
      const history = ledger.themes.find((item) => item.themeRef === themeRef)
      assert.ok(history)
      assert.equal(history.history.length, 3)
      assert.equal(history.currentByCandidateFingerprint[pending.candidateFingerprint]?.decision.id, changedPending.id)
      assert.equal(history.currentByCandidateFingerprint[pending.candidateFingerprint]?.decision.decision, 'exclude')
      assert.equal(history.currentByCandidateFingerprint[excluded.candidateFingerprint]?.decision.id, excluded.id)
      assert.equal(history.history.find((item) => item.decision.id === changedPending.id)?.committedRevision, secondWrite.committedRevision)
    }

    const logPath = join(root, 'logs', 'research', 'scope-initial-run.yaml')
    const firstLog = JSON.parse(await readFile(logPath, 'utf8')) as { writeStatus: string; committedRevision: number; ingestionContext: { themeScope: unknown } }
    assert.equal(firstLog.writeStatus, 'committed')
    assert.equal(firstLog.committedRevision, firstWrite.committedRevision)
    assert.deepEqual(firstLog.ingestionContext.themeScope, firstBatch)

    const replay = await writeKnowledgeBase(await mount(root), firstValidation.validatedChangeSet, { registry: new KnowledgeBaseRegistry(), clock }) as KnowledgeWriteResultV04
    assert.equal(replay.status, 'already_committed')
    assert.equal(replay.committedRevision, firstWrite.committedRevision)
    const ledgerAfterReplay = await readThemeScopeLedgerV04(await mount(root))
    assert.equal(ledgerAfterReplay.status, 'available')
    if (ledgerAfterReplay.status === 'available') assert.equal(ledgerAfterReplay.decisionCount, 3)
  })
})

test('canonical operations and Theme scope share one committed revision', async () => {
  await withFreshKb('combined-transaction', async (root) => {
    const themeRef = await createTheme(root)
    const handle = await mount(root)
    const industry: KnowledgeIndustryV04 = {
      id: 'entity:scope-bound-industry',
      type: 'industry',
      name: 'Scope Bound Industry',
      lifecycle: { status: 'active' },
    }
    const scopeDecision = decision({
      themeRef,
      revision: handle.revision,
      name: industry.name,
      canonicalRef: industry.id,
    })
    const scopeBatch = batch(themeRef, handle.revision, [scopeDecision])
    const set = changeSet(handle, 'scope-with-canonical-run', scopeBatch, [
      { operationId: 'create-scope-bound-industry', type: 'create', object: industry },
    ])

    const write = await commit(handle, set)
    assert.equal(write.status, 'committed', write.error?.message)
    assert.deepEqual(write.createdIds, [industry.id])
    assert.equal(write.committedRevision, handle.revision + 1)
    assert.equal((await loadKnowledgeBaseManifest(root)).revision, handle.revision + 1)
    assert.ok((await readCanonicalV04Assets(root)).objects.some((item) => item.value.id === industry.id))

    const ledger = await readThemeScopeLedgerV04(await mount(root))
    assert.equal(ledger.status, 'available')
    if (ledger.status === 'available') {
      const entry = ledger.themes.find((item) => item.themeRef === themeRef)?.history[0]
      assert.equal(entry?.committedRevision, write.committedRevision)
      assert.equal(entry?.decision.candidate.canonicalRef, industry.id)
    }
  })
})

test('scope Theme must be active in the projected post-operation canonical state', async () => {
  await withFreshKb('projected-theme-state', async (root) => {
    const themeRef = await createTheme(root)
    const handle = await mount(root)
    const assets = await readCanonicalV04Assets(root)
    const theme = assets.objects.find((item) => item.value.id === themeRef)?.value as KnowledgeInvestmentThemeV04 | undefined
    assert.ok(theme)
    const archivedTheme: KnowledgeInvestmentThemeV04 = {
      ...theme,
      lifecycle: { ...theme.lifecycle, status: 'archived' },
    }
    const scopeBatch = batch(themeRef, handle.revision, [decision({ themeRef, revision: handle.revision, name: 'Projected inactive Theme' })])
    const set = changeSet(handle, 'scope-archived-theme-run', scopeBatch, [{
      operationId: 'archive-scope-theme',
      type: 'update',
      knowledgeId: themeRef,
      expectedBeforeHash: hashKnowledgeObject(theme),
      object: archivedTheme,
    }])

    const validation = await validateKnowledgeChangeSetV04(handle, set, { mode: 'commit', now: clock })
    assert.equal(validation.report.status, 'failed')
    assert.ok(validation.report.errors.some((error) => error.code === 'THEME_SCOPE_THEME_NOT_ACTIVE'))
    assert.equal(validation.validatedChangeSet, undefined)
    assert.equal((await loadKnowledgeBaseManifest(root)).revision, handle.revision)
  })
})

test('ordinary empty ChangeSets keep no_changes revision behavior and existing replay/stale semantics', async () => {
  await withFreshKb('ordinary-no-changes', async (root) => {
    const handle = await mount(root)
    const emptyChangeSet = (runId: string): KnowledgeChangeSetV04 => ({
      changeSetId: `changeset-${runId}`,
      workflowRunId: runId,
      knowledgeBaseId: handle.knowledgeBaseId,
      schemaVersion: '0.4',
      storageFormatVersion: '1',
      expectedBaseRevision: handle.revision,
      operations: [],
    })
    const firstSet = emptyChangeSet('ordinary-empty-first-run')
    const staleSet = emptyChangeSet('ordinary-empty-stale-run')
    const firstValidation = await validateKnowledgeChangeSetV04(handle, firstSet, { mode: 'commit', now: clock })
    const staleValidation = await validateKnowledgeChangeSetV04(handle, staleSet, { mode: 'commit', now: clock })
    assert.ok(firstValidation.validatedChangeSet, JSON.stringify(firstValidation.report.errors))
    assert.ok(staleValidation.validatedChangeSet, JSON.stringify(staleValidation.report.errors))

    const firstWrite = await writeKnowledgeBase(handle, firstValidation.validatedChangeSet, { registry: new KnowledgeBaseRegistry(), clock }) as KnowledgeWriteResultV04
    assert.equal(firstWrite.status, 'no_changes')
    assert.equal(firstWrite.committedRevision, handle.revision)
    assert.equal((await loadKnowledgeBaseManifest(root)).revision, handle.revision)
    const ordinaryLog = JSON.parse(await readFile(join(root, 'logs', 'research', 'ordinary-empty-first-run.yaml'), 'utf8')) as { writeStatus: string; committedRevision: number }
    assert.equal(ordinaryLog.writeStatus, 'no_changes')
    assert.equal(ordinaryLog.committedRevision, handle.revision)

    const industry: KnowledgeIndustryV04 = {
      id: 'entity:ordinary-write-after-noop',
      type: 'industry',
      name: 'Ordinary Write After Noop',
      lifecycle: { status: 'active' },
    }
    const canonicalSet: KnowledgeChangeSetV04 = {
      changeSetId: 'changeset-ordinary-canonical-after-noop',
      workflowRunId: 'ordinary-canonical-after-noop-run',
      knowledgeBaseId: handle.knowledgeBaseId,
      schemaVersion: '0.4',
      storageFormatVersion: '1',
      expectedBaseRevision: handle.revision,
      operations: [{ operationId: 'create-ordinary-industry', type: 'create', object: industry }],
    }
    const canonicalValidation = await validateKnowledgeChangeSetV04(handle, canonicalSet, { mode: 'commit', now: clock })
    assert.ok(canonicalValidation.validatedChangeSet, JSON.stringify(canonicalValidation.report.errors))
    const canonicalWrite = await writeKnowledgeBase(handle, canonicalValidation.validatedChangeSet, { registry: new KnowledgeBaseRegistry(), clock }) as KnowledgeWriteResultV04
    assert.equal(canonicalWrite.status, 'committed', canonicalWrite.error?.message)
    assert.equal(canonicalWrite.committedRevision, handle.revision + 1)

    const replay = await writeKnowledgeBase(await mount(root), firstValidation.validatedChangeSet, { registry: new KnowledgeBaseRegistry(), clock }) as KnowledgeWriteResultV04
    assert.equal(replay.status, 'already_committed')
    assert.equal(replay.committedRevision, handle.revision)
    const staleWrite = await writeKnowledgeBase(handle, staleValidation.validatedChangeSet, { registry: new KnowledgeBaseRegistry(), clock }) as KnowledgeWriteResultV04
    assert.equal(staleWrite.status, 'rejected')
    assert.equal(staleWrite.error?.code, 'stale_revision')
  })
})

test('scope-bearing ingestionContext rejects hidden, accessor, array, and non-JSON-safe scope data', async () => {
  await withFreshKb('invalid-context-shapes', async (root) => {
    const themeRef = await createTheme(root)
    const handle = await mount(root)
    const scopeBatch = batch(themeRef, handle.revision, [decision({ themeRef, revision: handle.revision, name: 'Descriptor candidate' })])

    const hiddenContext: Record<string, unknown> = { producerType: 'theme_framework' }
    Object.defineProperty(hiddenContext, 'themeScope', { value: scopeBatch, enumerable: false })

    let getterReads = 0
    const accessorContext: Record<string, unknown> = { producerType: 'theme_framework' }
    Object.defineProperty(accessorContext, 'themeScope', {
      get() {
        getterReads += 1
        return scopeBatch
      },
      enumerable: true,
    })

    const arrayContext = [] as unknown as Record<string, unknown>
    Object.defineProperty(arrayContext, 'themeScope', { value: scopeBatch, enumerable: true })

    const undefinedContext: Record<string, unknown> = {
      producerType: 'theme_framework',
      themeScope: scopeBatch,
      optionalMetadata: undefined,
    }

    const contexts = [
      ['hidden', hiddenContext],
      ['accessor', accessorContext],
      ['array', arrayContext],
      ['undefined', undefinedContext],
    ] as const
    for (const [suffix, ingestionContext] of contexts) {
      const set: KnowledgeChangeSetV04 = {
        ...changeSet(handle, `scope-context-${suffix}-run`, scopeBatch),
        ingestionContext,
      }
      const validation = await validateKnowledgeChangeSetV04(handle, set, { mode: 'commit', now: clock })
      assert.equal(validation.report.status, 'failed', suffix)
      assert.ok(validation.report.errors.some((error) => error.code === 'THEME_SCOPE_CONTEXT_INVALID'), suffix)
      assert.equal(validation.validatedChangeSet, undefined, suffix)
    }
    assert.equal(getterReads, 0)

    const writerSet = changeSet(handle, 'scope-writer-hidden-run', scopeBatch)
    const writerValidation = await validateKnowledgeChangeSetV04(handle, writerSet, { mode: 'commit', now: clock })
    assert.ok(writerValidation.validatedChangeSet, JSON.stringify(writerValidation.report.errors))
    const receiptContext = writerValidation.validatedChangeSet.changeSet.ingestionContext!
    Object.defineProperty(receiptContext, 'themeScope', {
      value: scopeBatch,
      enumerable: false,
      configurable: true,
      writable: true,
    })
    const writerResult = await writeKnowledgeBase(handle, writerValidation.validatedChangeSet, { registry: new KnowledgeBaseRegistry(), clock })
    assert.equal(writerResult.status, 'rejected')
    assert.equal(writerResult.error?.code, 'receipt_mismatch')
    assert.match(writerResult.error?.message ?? '', /enumerable data property/u)
    assert.equal((await loadKnowledgeBaseManifest(root)).revision, handle.revision)
  })
})

test('suggested, malformed, and history-disconnected scope batches fail closed', async () => {
  await withFreshKb('invalid-batches', async (root) => {
    const themeRef = await createTheme(root)
    const handle = await mount(root)

    const suggested = decision({
      themeRef,
      revision: handle.revision,
      name: 'Suggested only',
      review: { status: 'suggested' },
    })
    const suggestedResult = await validateKnowledgeChangeSetV04(
      handle,
      changeSet(handle, 'scope-suggested-run', batch(themeRef, handle.revision, [suggested])),
      { mode: 'commit', now: clock },
    )
    assert.equal(suggestedResult.report.status, 'failed')
    assert.ok(suggestedResult.report.errors.some((error) => error.code === 'THEME_SCOPE_REVIEW_NOT_CONFIRMED'))

    const malformedResult = await validateKnowledgeChangeSetV04(
      handle,
      changeSet(handle, 'scope-malformed-run', null),
      { mode: 'commit', now: clock },
    )
    assert.equal(malformedResult.report.status, 'failed')
    assert.ok(malformedResult.report.errors.some((error) => error.code === 'THEME_SCOPE_BATCH_INVALID'))

    const excluded = decision({ themeRef, revision: handle.revision, name: 'History candidate', value: 'exclude' })
    const firstWrite = await commit(handle, changeSet(handle, 'scope-history-seed-run', batch(themeRef, handle.revision, [excluded])))
    assert.equal(firstWrite.status, 'committed', firstWrite.error?.message)
    const current = await mount(root)
    const disconnected = decision({ themeRef, revision: current.revision, name: 'History candidate', value: 'pending' })
    const historyResult = await validateKnowledgeChangeSetV04(
      current,
      changeSet(current, 'scope-history-disconnected-run', batch(themeRef, current.revision, [disconnected])),
      { mode: 'commit', now: clock },
    )
    assert.equal(historyResult.report.status, 'failed')
    assert.ok(historyResult.report.errors.some((error) => error.code === 'THEME_SCOPE_BATCH_INVALID' && error.message.includes('THEME_SCOPE_PREVIOUS_REQUIRED')))
  })
})

test('stale scope receipts conflict and an unreadable scope ledger blocks validation', async () => {
  await withFreshKb('stale-and-ledger', async (root) => {
    const themeRef = await createTheme(root)
    const staleHandle = await mount(root)
    const staleBatch = batch(themeRef, staleHandle.revision, [decision({ themeRef, revision: staleHandle.revision, name: 'Stale candidate' })])
    const staleSet = changeSet(staleHandle, 'scope-stale-run', staleBatch)
    const staleValidation = await validateKnowledgeChangeSetV04(staleHandle, staleSet, { mode: 'commit', now: clock })
    assert.ok(staleValidation.validatedChangeSet, JSON.stringify(staleValidation.report.errors))

    const concurrent = await new ThemeManagementGatewayV04({ clock }).createTheme(await mount(root), { name: 'Concurrent Theme' })
    assert.equal(concurrent.status, 'committed', concurrent.errors.map((error) => error.message).join('; '))
    const staleWrite = await writeKnowledgeBase(staleHandle, staleValidation.validatedChangeSet, { registry: new KnowledgeBaseRegistry(), clock })
    assert.equal(staleWrite.status, 'rejected')
    assert.equal(staleWrite.error?.code, 'stale_revision')

    const revalidation = await validateKnowledgeChangeSetV04(staleHandle, staleSet, { mode: 'commit', now: clock })
    assert.equal(revalidation.report.status, 'failed')
    assert.ok(revalidation.report.errors.some((error) => error.code === 'V04_BASE_REVISION_INVALID'))

    const malformedLogPath = join(root, 'logs', 'research', 'malformed-prior-log.yaml')
    await mkdir(join(root, 'logs', 'research'), { recursive: true })
    const current = await mount(root)
    await writeFile(malformedLogPath, `${JSON.stringify({
      workflowRunId: 'malformed-prior-log',
      knowledgeBaseId: current.knowledgeBaseId,
      schemaVersionAtExecution: '0.4',
      status: 'completed',
      writeStatus: 'committed',
      committedRevision: 1,
      ingestionContext: { themeScope: null },
    })}\n`, 'utf8')
    const currentBatch = batch(themeRef, current.revision, [decision({ themeRef, revision: current.revision, name: 'Ledger unavailable candidate' })])
    const ledgerFailure = await validateKnowledgeChangeSetV04(
      current,
      changeSet(current, 'scope-unavailable-ledger-run', currentBatch),
      { mode: 'commit', now: clock },
    )
    assert.equal(ledgerFailure.report.status, 'failed')
    assert.ok(ledgerFailure.report.errors.some((error) => error.code === 'THEME_SCOPE_LEDGER_UNAVAILABLE'))
    assert.equal(ledgerFailure.validatedChangeSet, undefined)
  })
})
