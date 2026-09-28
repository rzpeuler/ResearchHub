import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { KnowledgeProductionGateway } from '../../../knowledge/production/gateway.ts'
import { ThesisCriterionService } from '../../../app/services/thesis-criterion-service.ts'
import { loadReviewDecision } from '../../../knowledge/review/decision-store.ts'
import { persistReviewCases } from '../../../knowledge/review/store.ts'
import { KnowledgeBaseRegistry } from '../../../knowledge/registry/registry.ts'
import { createFreshKnowledgeBaseV04, readCanonicalV04Assets } from '../../../knowledge/storage/index.ts'
import type { NormalizedResearchSource } from '../../../plugins/research-acquisition/contracts.ts'
import { sha256 } from '../../../plugins/research-acquisition/hash.ts'
import { ThesisDecisionService } from '../../../app/services/thesis-decision-service.ts'
import { buildThesisRefreshReviewCases } from '../../../workflows/thesis-lifecycle/review-case-builder.ts'
import { runThesisRefreshAdapter } from '../../../workflows/thesis-lifecycle/refresh-adapter.ts'

const at = '2026-09-24T12:00:00.000Z'
const source: NormalizedResearchSource = {
  candidate: { candidateId: 'decision-evidence', kind: 'official_disclosure', tier: 1, title: 'Quarterly filing', provider: 'fixture', url: 'https://example.test/filing', publishedAt: '2026-09-11T00:00:00.000Z', metadata: { companySymbol: '600519' } },
  retrievedAt: '2026-09-11T00:00:00.000Z', title: 'Quarterly filing', content: 'Verified quarterly evidence.', canonicalUrl: 'https://example.test/filing', contentHash: sha256('Verified quarterly evidence.'), rawBytes: new TextEncoder().encode('Verified quarterly evidence.'), publisher: 'Fixture publisher', rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false },
}

async function fixture(relation: 'weakens' | 'contradicts' = 'weakens', invalidationCase = false) {
  const root = await mkdtemp(join(tmpdir(), 'rhl-thesis-decision-'))
  await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: `kb-thesis-decision-${Date.now()}`, now: '2026-09-01T00:00:00.000Z' })
  const registry = new KnowledgeBaseRegistry()
  const gateway = new KnowledgeProductionGateway(registry)
  const numericQuote = 'Revenue 1000 CNY FY2026'
  const numericLocator = `quote:${Buffer.from(numericQuote, 'utf8').toString('base64url')}`
  const evidenceSource: NormalizedResearchSource = invalidationCase ? {
    ...source,
    candidate: { ...source.candidate, title: 'Annual filing', publishedAt: '2026-09-11T00:00:00.000Z' },
    title: 'Annual filing', content: numericQuote, contentHash: sha256(numericQuote), rawBytes: new TextEncoder().encode(numericQuote),
  } : source
  const seeded = await gateway.submit({
    handle: await registry.mount(root), producerType: 'fixture_seed', producerRunId: 'thesis-seed',
    schemaProfile: { schemaVersion: '0.4', storageFormatVersion: '1', requiresRawProvenance: true },
    entity: { localKey: 'company', entityType: 'company', name: 'Fixture Company', aliases: ['600519'], semanticFields: { ticker: '600519', exchange: 'SSE' } },
    proposals: [
      { proposalId: 'root-claim', kind: 'claim', claimType: 'viewpoint', subjectKey: 'company', statement: 'Margins expand as utilization improves.', sourceCandidateIds: ['decision-evidence'] },
      { proposalId: 'evidence-claim', kind: 'claim', claimType: 'fact', subjectKey: 'company', statement: 'Gross margin declined in the latest quarter.', sourceCandidateIds: ['decision-evidence'] },
      ...(invalidationCase ? [{ proposalId: 'kill-evidence', kind: 'observation' as const, observationType: 'metric' as const, subjectKey: 'company', metricRef: 'metric:revenue', value: 1000, unit: 'CNY', period: 'FY2026', sourceCandidateIds: ['decision-evidence'] }] : []),
      { proposalId: 'thesis', kind: 'thesis', subjectKey: 'company', thesisTitle: 'Margin recovery', statement: 'Issuer margins recover.', thesisStatus: 'active' },
      { proposalId: 'membership', kind: 'reasoning_edge', sourceProposalId: 'root-claim', targetKey: 'thesis', edgeType: 'qualifies' },
    ],
    evidenceBindings: [{ localSourceId: 'decision-evidence', source: evidenceSource, ...(invalidationCase ? { locator: numericLocator } : {}) }], asOf: '2026-09-11T00:00:00.000Z', now: () => '2026-09-01T00:00:00.000Z',
  })
  assert.equal(seeded.status, 'committed', seeded.errors.join('; '))
  const rootClaimRef = seeded.claimRefsByProposalId['root-claim']!
  const evidenceRef = invalidationCase ? seeded.observationRefsByProposalId?.['kill-evidence']! : seeded.claimRefsByProposalId['evidence-claim']!
  const thesisRef = seeded.thesisRefsByProposalId?.thesis as `thesis:${string}`
  if (invalidationCase) {
    const criterionService = new ThesisCriterionService({ mountedKnowledgeBaseRoot: root, now: () => '2026-09-01T00:00:00.000Z' })
    const preview = await criterionService.prepare({ thesisRef, conditionId: 'kill-margin', type: 'numeric_threshold', definitionVersion: 1, definition: { metricRef: 'metric:revenue', operator: 'lt', threshold: 1500, unit: 'CNY', period: 'FY2026' }, targetClaimRefs: [rootClaimRef], origin: { kind: 'human_rule' } })
    await criterionService.confirm({ preview, previewHash: preview.previewHash, expectedKnowledgeBaseRevision: preview.expectedKnowledgeBaseRevision, workflowRunId: 'decision-test-criterion' })
  }
  const currentHandle = await new KnowledgeBaseRegistry().mount(root)
  const currentAssets = await readCanonicalV04Assets(root)
  const sourceNow = currentAssets.objects.find((item) => item.kind === 'source')!.value as { id: `source:${string}`; rawRefs: readonly `raw-sha256-${string}`[] }
  const currentRawRef = sourceNow.rawRefs[0]!
  const adapterResult = await runThesisRefreshAdapter({ assets: currentAssets, handle: currentHandle, thesisRef, currentAsOf: at, evidenceBindings: [{ evidenceRef, relation: invalidationCase ? 'context' : relation, targetClaimRefs: [rootClaimRef], sourceBindings: [{ sourceRef: sourceNow.id, rawRef: currentRawRef }] }] })
  assert.equal(adapterResult.status, 'completed', adapterResult.diagnostics.join('; '))
  const built = buildThesisRefreshReviewCases({ adapterResult, assets: currentAssets, knowledgeBaseId: currentHandle.knowledgeBaseId, producerRunId: 'thesis-review-run', knowledgeBaseRevisionAtCreation: currentHandle.revision, createdAt: at })
  assert.equal(built.status, 'completed', built.diagnostics.join('; '))
  assert.equal(built.cases.length, 1, `${built.status}: ${built.diagnostics.join('; ')}; adapter=${adapterResult.diagnostics.join('; ')}`)
  const base = built.cases[0]!
  const cases = ['accept', 'defer', 'stale'].map((suffix) => ({ ...structuredClone(base), reviewCaseId: `${base.reviewCaseId}-${suffix}` }))
  if (!invalidationCase) cases[0] = { ...cases[0]!, thesisScope: { ...cases[0]!.thesisScope!, proposedThesisStatus: relation === 'contradicts' ? 'challenged' : 'weakening' } }
  const persisted = await persistReviewCases({ rootRef: root, knowledgeBaseId: currentHandle.knowledgeBaseId, producerRunId: 'thesis-review-run', producerType: 'thesis_lifecycle', cases, createdAt: at, schemaVersionAtCreation: '0.4', knowledgeBaseRevisionAtCreation: currentHandle.revision })
  assert.equal(persisted.kind, 'written')
  return { root, gateway, registry, handle: currentHandle, assets: currentAssets, cases, rootClaimRef, thesisRef, evidenceRef, rawRef: currentRawRef, invalidationCase }
}

test('Thesis decisions use durable intents, Gateway writes, terminal replay, and no-write DEFER/REJECT', async () => {
  const f = await fixture()
  try {
    const before = await readCanonicalV04Assets(f.root)
    const acceptedCase = f.cases[0]!
    const service = new ThesisDecisionService({ mountedKnowledgeBaseRoot: f.root, now: () => at })
    const deferCase = f.cases[1]!
    assert.equal((await service.decide({ reviewCaseId: deferCase.reviewCaseId, decision: 'DEFER', note: 'review later' })).status, 'deferred')
    const deferredReplay = await service.decide({ reviewCaseId: deferCase.reviewCaseId, decision: 'DEFER', note: 'review later' })
    assert.equal(deferredReplay.status, 'deferred')
    assert.equal(deferredReplay.replay, true)
    const updatedDeferral = await service.decide({ reviewCaseId: deferCase.reviewCaseId, decision: 'DEFER', note: 'different note' })
    assert.equal(updatedDeferral.status, 'deferred')
    assert.equal(updatedDeferral.replay, false)
    assert.equal((await service.decide({ reviewCaseId: deferCase.reviewCaseId, decision: 'REJECT', note: 'decline' })).status, 'rejected')
    const rejectedReplay = await service.decide({ reviewCaseId: deferCase.reviewCaseId, decision: 'REJECT', note: 'decline' })
    assert.equal(rejectedReplay.status, 'rejected')
    assert.equal(rejectedReplay.replay, true)
    assert.equal((await service.decide({ reviewCaseId: deferCase.reviewCaseId, decision: 'REJECT', note: 'different rejection' })).status, 'conflict')
    assert.deepEqual((await readCanonicalV04Assets(f.root)).objects.map((item) => item.value.id).sort(), before.objects.map((item) => item.value.id).sort())
    let crashed = false
    const crashing = new ThesisDecisionService({ mountedKnowledgeBaseRoot: f.root, now: () => at, failpoint: (phase) => { if (phase === 'after_writer' && !crashed) { crashed = true; throw new Error('simulated process interruption') } } })
    await assert.rejects(() => crashing.decide({ reviewCaseId: acceptedCase.reviewCaseId, decision: 'ACCEPT', note: 'approve refresh' }), /simulated process interruption/)
    assert.equal((await loadReviewDecision(f.root, acceptedCase.producerRunId, acceptedCase.reviewCaseId))?.state, 'APPLYING')
    const afterWriter = await readCanonicalV04Assets(f.root)
    assert.equal(afterWriter.objects.length, before.objects.length + 1)
    assert.equal((await new ThesisDecisionService({ mountedKnowledgeBaseRoot: f.root, now: () => at }).decide({ reviewCaseId: acceptedCase.reviewCaseId, decision: 'ACCEPT', note: 'different payload' })).status, 'conflict')
    const accepted = await service.decide({ reviewCaseId: acceptedCase.reviewCaseId, decision: 'ACCEPT', note: 'approve refresh' })
    assert.equal(accepted.status, 'accepted')
    assert.equal(accepted.decisionState, 'ACCEPTED')
    assert.equal((await loadReviewDecision(f.root, acceptedCase.producerRunId, acceptedCase.reviewCaseId))?.state, 'ACCEPTED')
    const replay = await service.decide({ reviewCaseId: acceptedCase.reviewCaseId, decision: 'ACCEPT', note: 'approve refresh' })
    assert.equal(replay.status, 'accepted')
    assert.equal(replay.replay, true)
    assert.equal((await service.decide({ reviewCaseId: acceptedCase.reviewCaseId, decision: 'ACCEPT', note: 'different payload' })).status, 'conflict')
    assert.equal((await service.decide({ reviewCaseId: acceptedCase.reviewCaseId, decision: 'REJECT' })).status, 'conflict')

    const staleCase = f.cases[2]!
    const currentHandle = await new KnowledgeBaseRegistry().mount(f.root)
    const statusChange = await new KnowledgeProductionGateway().submit({ handle: currentHandle, producerType: 'fixture_update', producerRunId: 'thesis-archive', schemaProfile: { schemaVersion: '0.4', storageFormatVersion: '1', requiresRawProvenance: true }, entity: { localKey: 'company', entityType: 'company', name: 'Fixture Company', aliases: ['600519'], semanticFields: { ticker: '600519', exchange: 'SSE' }, existingEntityRef: (before.objects.find((item) => item.kind === 'entity')!.value as { id: string }).id }, proposals: [{ proposalId: 'archive-thesis', kind: 'thesis', subjectKey: 'company', thesisTitle: 'Margin recovery', statement: 'Issuer margins recover.', thesisStatus: 'archived' }], evidenceBindings: [], asOf: at, now: () => at })
    assert.equal(statusChange.status, 'committed', statusChange.errors.join('; '))
    assert.equal((await service.decide({ reviewCaseId: staleCase.reviewCaseId, decision: 'ACCEPT' })).status, 'stale')
    assert.equal((await loadReviewDecision(f.root, staleCase.producerRunId, staleCase.reviewCaseId))?.state, 'STALE')
    const final = await readCanonicalV04Assets(f.root)
    assert.equal(final.objects.filter((item) => item.kind === 'reasoning_edge' && item.value.id !== before.objects.find((x) => x.kind === 'reasoning_edge')?.value.id && (item.value as { type: string }).type !== 'qualifies').length, 1)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('possible invalidation applies only a reviewed challenged status and does not invalidate automatically', async () => {
  const f = await fixture('contradicts')
  try {
    assert.equal(f.cases[0]!.thesisScope?.candidateTransition, 'possible_invalidation')
    assert.equal(f.cases[0]!.thesisScope?.proposedThesisStatus, 'challenged')
    const result = await new ThesisDecisionService({ mountedKnowledgeBaseRoot: f.root, now: () => at }).decide({ reviewCaseId: f.cases[0]!.reviewCaseId, decision: 'ACCEPT', note: 'challenge reviewed' })
    assert.equal(result.status, 'accepted', result.errors.join('; '))
    const assets = await readCanonicalV04Assets(f.root)
    const thesis = assets.objects.find((item) => item.kind === 'thesis' && item.value.id === f.thesisRef)?.value as { status: string }
    assert.equal(thesis.status, 'challenged')
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('invalidation ACCEPT re-evaluates the canonical criterion, writes invalidated, reloads, and replays', async () => {
  const f = await fixture('weakens', true)
  try {
    const before = await readCanonicalV04Assets(f.root)
    const invalidationCase = f.cases[0]!
    assert.equal(invalidationCase.resolutionContext.knowledgeBaseRevisionAtCreation, f.handle.revision)
    assert.equal((await new KnowledgeBaseRegistry().mount(f.root)).revision, f.handle.revision)
    let interrupted = false
    const recovering = new ThesisDecisionService({ mountedKnowledgeBaseRoot: f.root, now: () => at, failpoint: (phase) => { if (phase === 'after_writer' && !interrupted) { interrupted = true; throw new Error('simulated process interruption') } } })
    await assert.rejects(() => recovering.decide({ reviewCaseId: invalidationCase.reviewCaseId, decision: 'ACCEPT', note: 'approve invalidation' }), /simulated process interruption/)
    assert.equal((await loadReviewDecision(f.root, invalidationCase.producerRunId, invalidationCase.reviewCaseId))?.state, 'APPLYING')
    const afterWriter = await readCanonicalV04Assets(f.root)
    assert.equal((afterWriter.objects.find((item) => item.value.id === f.thesisRef)?.value as { status: string }).status, 'invalidated')
    const result = await new ThesisDecisionService({ mountedKnowledgeBaseRoot: f.root, now: () => at }).decide({ reviewCaseId: invalidationCase.reviewCaseId, decision: 'ACCEPT', note: 'approve invalidation' })
    assert.equal(result.status, 'accepted', result.errors.join('; '))
    assert.ok((result.committedRevision ?? -1) > f.handle.revision)
    assert.equal((await loadReviewDecision(f.root, invalidationCase.producerRunId, invalidationCase.reviewCaseId))?.state, 'ACCEPTED')
    const after = await readCanonicalV04Assets(f.root)
    assert.equal(after.objects.length, before.objects.length)
    const thesis = after.objects.find((item) => item.kind === 'thesis' && item.value.id === f.thesisRef)?.value as { status: string; killCriteria?: unknown[] }
    assert.equal(thesis.status, 'invalidated')
    assert.equal(thesis.killCriteria?.length, 1)
    const replay = await new ThesisDecisionService({ mountedKnowledgeBaseRoot: f.root, now: () => at }).decide({ reviewCaseId: invalidationCase.reviewCaseId, decision: 'ACCEPT', note: 'approve invalidation' })
    assert.equal(replay.status, 'accepted')
    assert.equal(replay.replay, true)
    assert.equal(((await readCanonicalV04Assets(f.root)).objects.find((item) => item.value.id === f.thesisRef)?.value as { status: string } | undefined)?.status, 'invalidated')
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('invalidation DEFER and REJECT persist decisions without canonical writes', async () => {
  const f = await fixture('weakens', true)
  try {
    const before = await readCanonicalV04Assets(f.root)
    const [deferCase, rejectCase] = f.cases.slice(1)
    assert.equal((await new ThesisDecisionService({ mountedKnowledgeBaseRoot: f.root, now: () => at }).decide({ reviewCaseId: deferCase!.reviewCaseId, decision: 'DEFER' })).status, 'deferred')
    assert.equal((await new ThesisDecisionService({ mountedKnowledgeBaseRoot: f.root, now: () => at }).decide({ reviewCaseId: rejectCase!.reviewCaseId, decision: 'REJECT' })).status, 'rejected')
    assert.deepEqual((await readCanonicalV04Assets(f.root)).objects, before.objects)
    assert.equal((await loadReviewDecision(f.root, deferCase!.producerRunId, deferCase!.reviewCaseId))?.state, 'DEFERRED')
    assert.equal((await loadReviewDecision(f.root, rejectCase!.producerRunId, rejectCase!.reviewCaseId))?.state, 'REJECTED')
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('invalidation ACCEPT rejects a well-formed but canonically mismatched value binding', async () => {
  const f = await fixture('weakens', true)
  try {
    const sourceCase = structuredClone(f.cases[0]!)
    const original = sourceCase.thesisScope!.killCriterionBindings![0]!
    const changed = { ...original, value: original.value + 1 }
    const identityInput = [changed.conditionId, changed.revision, changed.definitionHash, changed.evidenceRef, changed.value, changed.metricRef, changed.unit, changed.period, changed.sourceRef, changed.rawRef, changed.locator, changed.publishedAt, [...changed.targetClaimRefs], changed.numericValueVersionVerified, changed.asOf]
    const binding = { ...changed, evaluatedValueIdentity: `sha256:${createHash('sha256').update(JSON.stringify(identityInput)).digest('hex')}` }
    const reviewCase = { ...sourceCase, reviewCaseId: `${sourceCase.reviewCaseId}-mismatched-value`, producerRunId: 'thesis-review-invalid-binding', thesisScope: { ...sourceCase.thesisScope!, killCriterionBindings: [binding] } }
    const stored = await persistReviewCases({ rootRef: f.root, knowledgeBaseId: reviewCase.knowledgeBaseId, producerRunId: reviewCase.producerRunId, producerType: 'thesis_lifecycle', cases: [reviewCase], createdAt: at, schemaVersionAtCreation: '0.4', knowledgeBaseRevisionAtCreation: reviewCase.resolutionContext.knowledgeBaseRevisionAtCreation })
    assert.equal(stored.kind, 'written')
    const stale = await new ThesisDecisionService({ mountedKnowledgeBaseRoot: f.root, now: () => at }).decide({ reviewCaseId: reviewCase.reviewCaseId, decision: 'ACCEPT' })
    assert.equal(stale.status, 'stale')
    assert.ok(stale.errors.includes('THESIS_DECISION_KILL_CRITERION_BINDING_CHANGED'))
    assert.equal(((await readCanonicalV04Assets(f.root)).objects.find((item) => item.value.id === f.thesisRef)?.value as { status: string } | undefined)?.status, 'active')
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('invalidation goes stale after a changed criterion or any competing Knowledge revision', async () => {
  const changed = await fixture('weakens', true)
  try {
    const criterionService = new ThesisCriterionService({ mountedKnowledgeBaseRoot: changed.root, now: () => '2026-09-25T00:00:00.000Z' })
    const preview = await criterionService.prepare({ thesisRef: changed.thesisRef, conditionId: 'kill-margin', type: 'numeric_threshold', definitionVersion: 1, definition: { metricRef: 'metric:revenue', operator: 'lt', threshold: 1100, unit: 'CNY', period: 'FY2026' }, targetClaimRefs: [changed.rootClaimRef], origin: { kind: 'human_rule' } })
    await criterionService.confirm({ preview, previewHash: preview.previewHash, expectedKnowledgeBaseRevision: preview.expectedKnowledgeBaseRevision, workflowRunId: 'decision-test-criterion-revision-2' })
    const stale = await new ThesisDecisionService({ mountedKnowledgeBaseRoot: changed.root, now: () => at }).decide({ reviewCaseId: changed.cases[0]!.reviewCaseId, decision: 'ACCEPT' })
    assert.equal(stale.status, 'stale')
    assert.ok(stale.errors.includes('THESIS_DECISION_BASE_KNOWLEDGE_REVISION_STALE'))
    assert.equal(((await readCanonicalV04Assets(changed.root)).objects.find((item) => item.value.id === changed.thesisRef)?.value as { status: string } | undefined)?.status, 'active')
  } finally { await rm(changed.root, { recursive: true, force: true }) }

  const competing = await fixture('weakens', true)
  try {
    await new KnowledgeProductionGateway().submit({ handle: await new KnowledgeBaseRegistry().mount(competing.root), producerType: 'fixture_competing_write', producerRunId: 'decision-competing-revision', schemaProfile: { schemaVersion: '0.4', storageFormatVersion: '1', requiresRawProvenance: true }, entity: { localKey: 'company', entityType: 'company', name: 'Fixture Company', aliases: ['600519'], semanticFields: { ticker: '600519', exchange: 'SSE' }, existingEntityRef: (competing.assets.objects.find((item) => item.kind === 'entity')!.value as { id: string }).id }, proposals: [{ proposalId: 'new-claim', kind: 'claim', claimType: 'fact', subjectKey: 'company', statement: 'A competing canonical fact.', sourceCandidateIds: ['decision-evidence'] }], evidenceBindings: [{ localSourceId: 'decision-evidence', source }], asOf: at, now: () => at })
    const stale = await new ThesisDecisionService({ mountedKnowledgeBaseRoot: competing.root, now: () => at }).decide({ reviewCaseId: competing.cases[0]!.reviewCaseId, decision: 'ACCEPT' })
    assert.equal(stale.status, 'stale')
    assert.ok(stale.errors.includes('THESIS_DECISION_BASE_KNOWLEDGE_REVISION_STALE'))
  } finally { await rm(competing.root, { recursive: true, force: true }) }
})

test('invalidation rechecks decision-time rights and archived Raw integrity', async () => {
  const rights = await fixture('weakens', true)
  try {
    // The Gateway input fixture does not expose rights expiry. Add the valid
    // canonical Source field directly to model an already-stored expiring right.
    const rightsSource = rights.assets.objects.find((item) => item.kind === 'source')!
    const sourceValue = rightsSource.value as unknown as Record<string, unknown>
    await writeFile(rightsSource.filePath, JSON.stringify({ ...sourceValue, rights: { ...(sourceValue.rights as Record<string, unknown>), expiresAt: '2026-09-24T23:00:00.000Z' } }, null, 2), 'utf8')
    const stale = await new ThesisDecisionService({ mountedKnowledgeBaseRoot: rights.root, now: () => '2026-09-25T00:00:00.000Z' }).decide({ reviewCaseId: rights.cases[0]!.reviewCaseId, decision: 'ACCEPT' })
    assert.equal(stale.status, 'stale')
    assert.ok(stale.errors.includes('THESIS_DECISION_SOURCE_RAW_BINDING_STALE'))
  } finally { await rm(rights.root, { recursive: true, force: true }) }

  const missingRaw = await fixture('weakens', true)
  try {
    await unlink(join(missingRaw.root, 'raw', missingRaw.rawRef, 'original.txt'))
    const stale = await new ThesisDecisionService({ mountedKnowledgeBaseRoot: missingRaw.root, now: () => at }).decide({ reviewCaseId: missingRaw.cases[0]!.reviewCaseId, decision: 'ACCEPT' })
    assert.equal(stale.status, 'stale')
    assert.ok(stale.errors.includes('THESIS_DECISION_RAW_UNAVAILABLE'))
  } finally { await rm(missingRaw.root, { recursive: true, force: true }) }
})
