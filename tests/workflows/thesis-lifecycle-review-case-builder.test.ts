import assert from 'node:assert/strict'
import { test } from 'node:test'
import { archiveRaw } from '../../knowledge/raw/raw-archive.ts'
import type { KnowledgeAssetV04 } from '../../knowledge/schema/domain-v04.ts'
import type { KnowledgeAssetCollectionV04, LoadedAssetV04 } from '../../knowledge/storage/v04-types.ts'
import { KnowledgeBaseRegistry } from '../../knowledge/registry/registry.ts'
import { hashKillCriterionDefinitionV04 } from '../../knowledge/schema/kill-criterion-v04.ts'
import { validateReviewCase } from '../../knowledge/review/validation.ts'
import { createKnowledgeBase, removeKnowledgeBase } from '../knowledge/helpers.ts'
import { runThesisRefreshAdapter } from '../../workflows/thesis-lifecycle/refresh-adapter.ts'
import { buildThesisRefreshReviewCases } from '../../workflows/thesis-lifecycle/review-case-builder.ts'
import type { ReviewClaimCandidate } from '../../knowledge/review/contracts.ts'

const loaded = (value: KnowledgeAssetV04, kind: LoadedAssetV04['kind']): LoadedAssetV04 => ({ value, kind, filePath: `${value.id}.json`, storageRef: `${kind}/${value.id}.json` })

async function fixture() {
  const root = await createKnowledgeBase({ schemaVersion: '0.4', knowledgeBaseId: 'kb-thesis-review' })
  const handle = await new KnowledgeBaseRegistry().mount(root)
  const raw = await archiveRaw(handle, { bytes: Buffer.from('accepted published filing'), originalFilename: 'filing.txt', mediaType: 'text/plain' }, { clock: () => '2026-04-01T00:00:00.000Z' })
  const thesis = { id: 'thesis:case', subjectRefs: ['entity:issuer'], title: 'Growth thesis', statement: 'Issuer grows', status: 'active', createdAt: '2026-01-01T00:00:00.000Z', lastReviewedAt: '2026-03-01T00:00:00.000Z', lifecycle: { status: 'active' } } as unknown as KnowledgeAssetV04
  const issuer = { id: 'entity:issuer', type: 'company', name: 'Example Issuer', aliases: [], lifecycle: { status: 'active' } } as unknown as KnowledgeAssetV04
  const division = { id: 'entity:division', type: 'company', name: 'Example Division', aliases: [], lifecycle: { status: 'active' } } as unknown as KnowledgeAssetV04
  const claimSubject = { id: 'relation:division-of', type: 'upstream_of', sourceRef: 'entity:issuer', targetRef: 'entity:division', lifecycle: { status: 'active' } } as unknown as KnowledgeAssetV04
  const claim = { id: 'claim:margin', claimType: 'viewpoint', statement: 'Margins expand as utilization improves.', subjectRefs: ['relation:division-of'], sourceRefs: [], lifecycle: { status: 'active' } } as unknown as KnowledgeAssetV04
  const source = { id: 'source:filing', title: 'Accepted filing', sourceType: 'document', publishedAt: '2026-04-01T00:00:00.000Z', rawRefs: [raw.manifest.rawRef], rights: { accessScope: 'public', providerTermsKnown: false, retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true }, usagePolicy: { mode: 'personal_noncommercial_research', retainRaw: true, allowAiProcessing: true, allowDerivedKnowledge: true, redistributionAllowed: false }, lifecycle: { status: 'active' } } as unknown as KnowledgeAssetV04
  const observation = { id: 'observation:margin', observationType: 'metric', subjectRef: 'entity:issuer', metricRef: 'gross_margin', value: 0.3, unit: 'ratio', period: '2026-Q1', sourceRef: 'source:filing', provenance: [{ sourceRef: 'source:filing', rawRef: raw.manifest.rawRef, locator: 'page 2' }], lifecycle: { status: 'active' } } as unknown as KnowledgeAssetV04
  const membership = { id: 'reasoning-edge:membership', type: 'qualifies', sourceRef: 'claim:margin', targetRef: 'thesis:case', lifecycle: { status: 'active' } } as unknown as KnowledgeAssetV04
  const values = [thesis, issuer, division, claimSubject, claim, source, observation, membership]
  const kinds: LoadedAssetV04['kind'][] = ['thesis', 'entity', 'entity', 'relation', 'claim', 'source', 'observation', 'reasoning_edge']
  const assets: KnowledgeAssetCollectionV04 = { rootDir: root, objects: values.map((value, index) => loaded(value, kinds[index]!)), registry: [] }
  const adapterResult = await runThesisRefreshAdapter({ assets, handle, thesisRef: 'thesis:case', currentAsOf: '2026-09-01T00:00:00.000Z', evidenceBindings: [{ evidenceRef: 'observation:margin', relation: 'weakens', targetClaimRefs: ['claim:margin'], sourceBindings: [{ sourceRef: 'source:filing', rawRef: raw.manifest.rawRef }], basis: 'verified_evidence' }] })
  return { root, assets, adapterResult }
}

function withCanonicalMetEvaluations(f: Awaited<ReturnType<typeof fixture>>, conditionIds = ['margin-floor'], targetsByCondition: readonly (readonly string[])[] = []) {
  const quote = 'Gross margin 0.3 ratio 2026-Q1'
  const locator = `quote:${Buffer.from(quote, 'utf8').toString('base64url')}`
  const definition = { metricRef: 'gross_margin', operator: 'gte' as const, threshold: 0.25, unit: 'ratio', period: '2026-Q1' }
  const origin = { kind: 'human_rule' as const }
  const criteria = conditionIds.map((conditionId, index) => {
    const targetClaimRefs = [...(targetsByCondition[index] ?? ['claim:margin'])]
    return ({
    conditionId, revision: index + 1, state: 'active' as const, type: 'numeric_threshold', definitionVersion: 1,
    definition, targetClaimRefs, effectiveAt: '2026-04-01T00:00:00.000Z',
    definitionHash: hashKillCriterionDefinitionV04({ type: 'numeric_threshold', definitionVersion: 1, definition, targetClaimRefs, origin }),
    authority: { workflowRunId: `confirm-${conditionId}`, confirmedAt: '2026-03-01T00:00:00.000Z', origin },
  })
  })
  const rawRef = (f.assets.objects.find((item) => item.value.id === 'source:filing')!.value as unknown as { rawRefs: string[] }).rawRefs[0]!
  const assets: KnowledgeAssetCollectionV04 = {
    ...f.assets,
    objects: [
      ...f.assets.objects.map((item) => {
        if (item.value.id === 'thesis:case') return loaded({ ...(item.value as unknown as Record<string, unknown>), killCriteria: criteria } as unknown as KnowledgeAssetV04, 'thesis')
        if (item.value.id === 'observation:margin') {
          const observation = item.value as unknown as Record<string, unknown>
          const provenance = observation.provenance as Record<string, unknown>[]
          return loaded({ ...observation, period: '2026-Q1', provenance: provenance.map((entry) => ({ ...entry, locator })) } as unknown as KnowledgeAssetV04, 'observation')
        }
        return item
      }),
      ...[...new Set(criteria.flatMap((criterion) => criterion.targetClaimRefs))].filter((ref) => ref !== 'claim:margin').flatMap((ref) => [
        loaded({ id: ref, claimType: 'viewpoint', statement: `Canonical target ${ref}.`, subjectRefs: ['entity:issuer'], sourceRefs: [], lifecycle: { status: 'active' } } as unknown as KnowledgeAssetV04, 'claim'),
        loaded({ id: `reasoning-edge:${ref.replace(':', '-')}`, type: 'qualifies', sourceRef: ref, targetRef: 'thesis:case', lifecycle: { status: 'active' } } as unknown as KnowledgeAssetV04, 'reasoning_edge'),
      ]),
    ],
  }
  const baseEvaluation = {
    status: 'met' as const,
    asOf: f.adapterResult.refresh!.currentAsOf,
    evaluatedValue: { evidenceRef: 'observation:margin', value: 0.3, metricRef: 'gross_margin', unit: 'ratio', period: '2026-Q1', sourceRef: 'source:filing', rawRef, locator, publishedAt: '2026-04-01T00:00:00.000Z', targetClaimRefs: ['claim:margin'], numericValueVersionVerified: true as const },
    diagnostics: [],
  }
  const adapterResult = {
    ...f.adapterResult,
    refresh: { ...f.adapterResult.refresh!, candidateTransition: 'invalidation_condition_met' as const, propositionDeltas: [], unchangedPropositionRefs: ['claim:margin'] },
    criterionEvaluations: criteria.map((criterion, index) => ({ ...baseEvaluation, conditionId: criterion.conditionId, revision: criterion.revision, definitionHash: criterion.definitionHash, evaluatedValue: { ...baseEvaluation.evaluatedValue, targetClaimRefs: [...(targetsByCondition[index] ?? ['claim:margin'])] } })),
    evidenceLineage: f.adapterResult.evidenceLineage.map((item) => item.decision === 'included' ? { ...item, relation: 'context' as const, targetClaimRefs: [...new Set(criteria.flatMap((criterion) => criterion.targetClaimRefs))] } : item),
  }
  return { assets, adapterResult, rawRef }
}

test('thesis refresh ReviewCase builder preserves canonical Claim subjects when they differ from the Thesis subjects', async () => {
  const f = await fixture()
  try {
    const input = { adapterResult: f.adapterResult, assets: f.assets, knowledgeBaseId: 'kb-thesis-review', producerRunId: 'thesis-run-1', knowledgeBaseRevisionAtCreation: 0, createdAt: '2026-09-24T12:00:00.000Z' }
    const result = buildThesisRefreshReviewCases(input)
    assert.equal(result.status, 'completed', result.diagnostics.join(','))
    assert.equal(result.cases.length, 1)
    const reviewCase = result.cases[0]!
    assert.equal(reviewCase.producerType, 'thesis_lifecycle')
    assert.equal(reviewCase.rootProposal.proposalKind, 'claim')
    const semanticPayload = reviewCase.rootProposal.semanticPayload as ReviewClaimCandidate
    assert.deepEqual(semanticPayload.subjectRefs, [{ candidateRef: 'relation:division-of', mention: 'Example Issuer upstream_of Example Division' }])
    assert.deepEqual(semanticPayload.evidenceBlockRefs, [])
    assert.deepEqual(reviewCase.rootProposal.evidenceBindings, [{ kind: 'canonical_research_evidence', sourceRef: 'source:filing', rawRef: f.adapterResult.evidenceLineage[0]!.sourceBindings[0]!.rawRef, evidenceRef: 'observation:margin' }])
    assert.deepEqual(reviewCase.thesisScope?.reviewedEvidence, [{ evidenceRef: 'observation:margin', relation: 'weakens', targetClaimRefs: ['claim:margin'] }])
    assert.deepEqual(reviewCase.thesisScope?.affectedClaimRefs, ['claim:margin'])
    assert.equal(reviewCase.thesisScope?.rootClaimRef, 'claim:margin')
    assert.equal(reviewCase.thesisScope?.proposedThesisStatus, 'weakening')
    assert.deepEqual(reviewCase.impact, { dependentProposalCount: 0, affectedProposalRefs: [] })
    assert.deepEqual(buildThesisRefreshReviewCases(input).cases.map((item) => item.reviewCaseId), [reviewCase.reviewCaseId])
  } finally { await removeKnowledgeBase(f.root) }
})

test('thesis refresh builder emits one aggregate case for multiple changed Claims', async () => {
  const f = await fixture()
  try {
    const secondClaim = { id: 'claim:utilization', claimType: 'viewpoint', statement: 'Utilization improves.', subjectRefs: ['entity:issuer'], sourceRefs: [], lifecycle: { status: 'active' } } as unknown as KnowledgeAssetV04
    const assets: KnowledgeAssetCollectionV04 = { ...f.assets, objects: [...f.assets.objects, loaded(secondClaim, 'claim')] }
    const adapterResult = structuredClone(f.adapterResult) as typeof f.adapterResult
    const changed = adapterResult.refresh!.propositionDeltas.find((delta) => delta.propositionRef === 'claim:margin')!
    const secondDelta = { ...changed, propositionRef: 'claim:utilization', rationale: 'New evidence weakens utilization.' }
    const altered = {
      ...adapterResult,
      priorSnapshot: { ...adapterResult.priorSnapshot!, propositions: [...adapterResult.priorSnapshot!.propositions, { propositionId: 'claim:utilization', statement: 'Utilization improves.' }] },
      refresh: { ...adapterResult.refresh!, propositionDeltas: [...adapterResult.refresh!.propositionDeltas, secondDelta] },
      evidenceLineage: adapterResult.evidenceLineage.map((item) => item.decision === 'included' ? { ...item, targetClaimRefs: ['claim:margin', 'claim:utilization'] } : item),
    }
    const result = buildThesisRefreshReviewCases({ adapterResult: altered, assets, knowledgeBaseId: 'kb-thesis-review', producerRunId: 'thesis-run-aggregate', knowledgeBaseRevisionAtCreation: 0, createdAt: '2026-09-24T12:00:00.000Z' })
    assert.equal(result.status, 'completed', result.diagnostics.join(','))
    assert.equal(result.cases.length, 1)
    assert.equal(result.cases[0]?.thesisScope?.rootClaimRef, 'claim:margin')
    assert.deepEqual(result.cases[0]?.thesisScope?.affectedClaimRefs, ['claim:margin', 'claim:utilization'])
    assert.equal(result.cases[0]?.thesisScope?.proposedThesisStatus, 'weakening')
  } finally { await removeKnowledgeBase(f.root) }
})

test('thesis refresh builder blocks invalidation when there is no canonical met criterion evaluation', async () => {
  const f = await fixture()
  try {
    const adapterResult = structuredClone(f.adapterResult) as typeof f.adapterResult
    const altered = {
      ...adapterResult,
      refresh: {
        ...adapterResult.refresh!,
        candidateTransition: 'invalidation_condition_met' as const,
        killCriterionAssessments: [{ conditionId: 'margin-below-floor', status: 'met' as const, targetPropositionRefs: ['claim:margin'], evidenceRefs: ['observation:margin'], rationale: 'Observed gross margin below the explicit 0.35 threshold.' }],
      },
    }
    const result = buildThesisRefreshReviewCases({ adapterResult: altered, assets: f.assets, knowledgeBaseId: 'kb-thesis-review', producerRunId: 'thesis-run-kill', knowledgeBaseRevisionAtCreation: 0, createdAt: '2026-09-24T12:00:00.000Z' })
    assert.equal(result.status, 'blocked')
    assert.deepEqual(result.diagnostics, ['THESIS_REVIEW_CANONICAL_KILL_CRITERION_MET_REQUIRED'])
    assert.deepEqual(result.cases, [])
  } finally { await removeKnowledgeBase(f.root) }
})

test('thesis refresh builder creates one canonical invalidation case when a criterion is met and propositions are unchanged', async () => {
  const f = await fixture()
  try {
    const canonical = withCanonicalMetEvaluations(f)
    const result = buildThesisRefreshReviewCases({ adapterResult: canonical.adapterResult, assets: canonical.assets, knowledgeBaseId: 'kb-thesis-review', producerRunId: 'thesis-run-kill-met', knowledgeBaseRevisionAtCreation: 0, createdAt: '2026-09-24T12:00:00.000Z' })
    assert.equal(result.status, 'completed')
    assert.equal(result.cases.length, 1)
    const reviewCase = result.cases[0]!
    assert.deepEqual(reviewCase.thesisScope?.affectedClaimRefs, ['claim:margin'])
    assert.deepEqual(reviewCase.thesisScope?.evidenceRefs, ['observation:margin'])
    assert.equal(reviewCase.thesisScope?.reviewedEvidence[0]?.relation, 'context')
    assert.equal(reviewCase.thesisScope?.proposedThesisStatus, 'invalidated')
    assert.equal(reviewCase.thesisScope?.killCriterionBindings?.length, 1)
    assert.equal(reviewCase.thesisScope?.killCriterionAssessments?.length, 1)
    assert.deepEqual(reviewCase.rootProposal.evidenceBindings, [{ kind: 'canonical_research_evidence', sourceRef: 'source:filing', rawRef: canonical.rawRef, evidenceRef: 'observation:margin', locator: reviewCase.thesisScope?.killCriterionBindings?.[0]?.locator }])
    validateReviewCase(reviewCase)
  } finally { await removeKnowledgeBase(f.root) }
})

test('thesis refresh builder aggregates multiple met criteria into one invalidation case', async () => {
  const f = await fixture()
  try {
    const canonical = withCanonicalMetEvaluations(f, ['margin-floor', 'margin-floor-secondary'])
    const secondObservation = { ...(canonical.assets.objects.find((item) => item.value.id === 'observation:margin')!.value as unknown as Record<string, unknown>), id: 'observation:margin-alt' } as unknown as KnowledgeAssetV04
    const assets: KnowledgeAssetCollectionV04 = { ...canonical.assets, objects: [...canonical.assets.objects, loaded(secondObservation, 'observation')] }
    const adapterResult = {
      ...canonical.adapterResult,
      criterionEvaluations: canonical.adapterResult.criterionEvaluations.map((evaluation, index) => index === 1 ? { ...evaluation, evaluatedValue: { ...evaluation.evaluatedValue!, evidenceRef: 'observation:margin-alt' } } : evaluation),
      evidenceLineage: [...canonical.adapterResult.evidenceLineage, { ...canonical.adapterResult.evidenceLineage[0]!, evidenceRef: 'observation:margin-alt' }],
    }
    const result = buildThesisRefreshReviewCases({ adapterResult, assets, knowledgeBaseId: 'kb-thesis-review', producerRunId: 'thesis-run-kill-multi', knowledgeBaseRevisionAtCreation: 0, createdAt: '2026-09-24T12:00:00.000Z' })
    assert.equal(result.status, 'completed')
    assert.equal(result.cases.length, 1)
    assert.deepEqual(result.cases[0]?.thesisScope?.killCriterionBindings?.map((binding) => binding.conditionId), ['margin-floor', 'margin-floor-secondary'])
    assert.deepEqual(result.cases[0]?.thesisScope?.evidenceRefs, ['observation:margin', 'observation:margin-alt'])
  } finally { await removeKnowledgeBase(f.root) }
})

test('thesis refresh builder blocks a shared evidenceRef with conflicting target claims or Source/Raw scope', async () => {
  const f = await fixture()
  try {
    const targetConflict = withCanonicalMetEvaluations(f, ['margin-floor', 'margin-floor-secondary'], [['claim:margin'], ['claim:utilization']])
    const blockedTargets = buildThesisRefreshReviewCases({ adapterResult: targetConflict.adapterResult, assets: targetConflict.assets, knowledgeBaseId: 'kb-thesis-review', producerRunId: 'thesis-run-kill-target-conflict', knowledgeBaseRevisionAtCreation: 0, createdAt: '2026-09-24T12:00:00.000Z' })
    assert.deepEqual(blockedTargets.diagnostics, ['THESIS_REVIEW_KILL_CRITERION_EVIDENCE_SCOPE_CONFLICT'])

    const sourceConflict = withCanonicalMetEvaluations(f, ['margin-floor', 'margin-floor-secondary'])
    const rawRef = sourceConflict.rawRef
    const quoteLocator = sourceConflict.adapterResult.criterionEvaluations[0]!.evaluatedValue!.locator
    const alternateSource = { ...(sourceConflict.assets.objects.find((item) => item.value.id === 'source:filing')!.value as unknown as Record<string, unknown>), id: 'source:filing-alt' } as unknown as KnowledgeAssetV04
    const observation = sourceConflict.assets.objects.find((item) => item.value.id === 'observation:margin')!.value as unknown as Record<string, unknown>
    const provenance = observation.provenance as Record<string, unknown>[]
    const assets: KnowledgeAssetCollectionV04 = { ...sourceConflict.assets, objects: sourceConflict.assets.objects.map((item) => item.value.id === 'observation:margin' ? loaded({ ...observation, provenance: [...provenance, { sourceRef: 'source:filing-alt', rawRef, locator: quoteLocator }] } as unknown as KnowledgeAssetV04, 'observation') : item).concat(loaded(alternateSource, 'source')) }
    const adapterResult = {
      ...sourceConflict.adapterResult,
      criterionEvaluations: sourceConflict.adapterResult.criterionEvaluations.map((evaluation, index) => index === 1 ? { ...evaluation, evaluatedValue: { ...evaluation.evaluatedValue!, sourceRef: 'source:filing-alt' } } : evaluation),
      evidenceLineage: sourceConflict.adapterResult.evidenceLineage.map((item) => item.decision === 'included' ? { ...item, sourceBindings: [...item.sourceBindings, { sourceRef: 'source:filing-alt', rawRef }] } : item),
    }
    assert.deepEqual(buildThesisRefreshReviewCases({ adapterResult, assets, knowledgeBaseId: 'kb-thesis-review', producerRunId: 'thesis-run-kill-source-conflict', knowledgeBaseRevisionAtCreation: 0, createdAt: '2026-09-24T12:00:00.000Z' }).diagnostics, ['THESIS_REVIEW_KILL_CRITERION_EVIDENCE_SCOPE_CONFLICT'])
  } finally { await removeKnowledgeBase(f.root) }
})

test('thesis refresh builder blocks canonical evaluation, Source/Raw, and value mismatches', async () => {
  const f = await fixture()
  try {
    const canonical = withCanonicalMetEvaluations(f)
    const mismatch = structuredClone(canonical.adapterResult) as typeof canonical.adapterResult
    mismatch.criterionEvaluations = mismatch.criterionEvaluations.map((evaluation) => ({ ...evaluation, definitionHash: `sha256:${'f'.repeat(64)}` }))
    assert.deepEqual(buildThesisRefreshReviewCases({ adapterResult: mismatch, assets: canonical.assets, knowledgeBaseId: 'kb-thesis-review', producerRunId: 'thesis-run-kill-mismatch', knowledgeBaseRevisionAtCreation: 0, createdAt: '2026-09-24T12:00:00.000Z' }).diagnostics, ['THESIS_REVIEW_CANONICAL_KILL_CRITERION_MISMATCH'])

    const noRaw: KnowledgeAssetCollectionV04 = { ...canonical.assets, objects: canonical.assets.objects.map((item) => item.value.id === 'source:filing' ? loaded({ ...(item.value as unknown as Record<string, unknown>), rawRefs: [] } as unknown as KnowledgeAssetV04, 'source') : item) }
    assert.deepEqual(buildThesisRefreshReviewCases({ adapterResult: canonical.adapterResult, assets: noRaw, knowledgeBaseId: 'kb-thesis-review', producerRunId: 'thesis-run-kill-raw-missing', knowledgeBaseRevisionAtCreation: 0, createdAt: '2026-09-24T12:00:00.000Z' }).diagnostics, ['THESIS_REVIEW_KILL_CRITERION_CANONICAL_VALUE_MISMATCH'])

    const noSource: KnowledgeAssetCollectionV04 = { ...canonical.assets, objects: canonical.assets.objects.filter((item) => item.value.id !== 'source:filing') }
    assert.deepEqual(buildThesisRefreshReviewCases({ adapterResult: canonical.adapterResult, assets: noSource, knowledgeBaseId: 'kb-thesis-review', producerRunId: 'thesis-run-kill-source-missing', knowledgeBaseRevisionAtCreation: 0, createdAt: '2026-09-24T12:00:00.000Z' }).diagnostics, ['THESIS_REVIEW_KILL_CRITERION_CANONICAL_VALUE_MISMATCH'])

    const tampered = structuredClone(canonical.adapterResult) as typeof canonical.adapterResult
    tampered.criterionEvaluations = tampered.criterionEvaluations.map((evaluation) => ({ ...evaluation, evaluatedValue: { ...evaluation.evaluatedValue!, value: 0.31 } }))
    assert.deepEqual(buildThesisRefreshReviewCases({ adapterResult: tampered, assets: canonical.assets, knowledgeBaseId: 'kb-thesis-review', producerRunId: 'thesis-run-kill-value-mismatch', knowledgeBaseRevisionAtCreation: 0, createdAt: '2026-09-24T12:00:00.000Z' }).diagnostics, ['THESIS_REVIEW_KILL_CRITERION_CANONICAL_VALUE_MISMATCH'])
  } finally { await removeKnowledgeBase(f.root) }
})

test('ReviewCase validation rejects a tampered canonical kill value binding', async () => {
  const f = await fixture()
  try {
    const canonical = withCanonicalMetEvaluations(f)
    const result = buildThesisRefreshReviewCases({ adapterResult: canonical.adapterResult, assets: canonical.assets, knowledgeBaseId: 'kb-thesis-review', producerRunId: 'thesis-run-kill-tamper', knowledgeBaseRevisionAtCreation: 0, createdAt: '2026-09-24T12:00:00.000Z' })
    assert.equal(result.status, 'completed', result.diagnostics.join(','))
    const malformed = structuredClone(result.cases[0]!) as any
    malformed.thesisScope.killCriterionBindings[0].value = 0.31
    assert.throws(() => validateReviewCase(malformed), /evaluated value identity does not match/)

    const misplaced = structuredClone(result.cases[0]!) as any
    misplaced.thesisScope.candidateTransition = 'weakened'
    misplaced.thesisScope.proposedThesisStatus = 'weakening'
    delete misplaced.thesisScope.killCriterionAssessments
    assert.throws(() => validateReviewCase(misplaced), /kill criterion data is only valid/)
  } finally { await removeKnowledgeBase(f.root) }
})

test('thesis refresh ReviewCase builder fails closed when a review delta has no verified canonical Source/Raw binding', async () => {
  const f = await fixture()
  try {
    const unbound = structuredClone(f.adapterResult) as typeof f.adapterResult
    const altered = { ...unbound, evidenceLineage: unbound.evidenceLineage.map((item) => ({ ...item, sourceBindings: [] })) }
    const result = buildThesisRefreshReviewCases({ adapterResult: altered, assets: f.assets, knowledgeBaseId: 'kb-thesis-review', producerRunId: 'thesis-run-1', knowledgeBaseRevisionAtCreation: 0, createdAt: '2026-09-24T12:00:00.000Z' })
    assert.equal(result.status, 'blocked')
    assert.deepEqual(result.diagnostics, ['REVIEW_EVIDENCE_BINDING_UNAVAILABLE'])
    assert.deepEqual(result.cases, [])
  } finally { await removeKnowledgeBase(f.root) }
})

test('thesis refresh ReviewCase builder rejects the legacy thesis Claim type before casting', async () => {
  const f = await fixture()
  try {
    const assets: KnowledgeAssetCollectionV04 = { ...f.assets, objects: f.assets.objects.map((item) => item.value.id === 'claim:margin' ? loaded({ ...(item.value as unknown as Record<string, unknown>), claimType: 'thesis' } as unknown as KnowledgeAssetV04, 'claim') : item) }
    const result = buildThesisRefreshReviewCases({ adapterResult: f.adapterResult, assets, knowledgeBaseId: 'kb-thesis-review', producerRunId: 'thesis-run-1', knowledgeBaseRevisionAtCreation: 0, createdAt: '2026-09-24T12:00:00.000Z' })
    assert.equal(result.status, 'blocked')
    assert.deepEqual(result.diagnostics, ['THESIS_REVIEW_CLAIM_TYPE_UNSUPPORTED'])
  } finally { await removeKnowledgeBase(f.root) }
})
