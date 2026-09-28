import assert from 'node:assert/strict'
import { test } from 'node:test'
import { archiveRaw } from '../../knowledge/raw/raw-archive.ts'
import { hashKillCriterionDefinitionV04 } from '../../knowledge/schema/kill-criterion-v04.ts'
import { getMetricDefinitionV04 } from '../../knowledge/schema/metric-registry.ts'
import type { KillCriterionV04, KnowledgeAssetV04 } from '../../knowledge/schema/domain-v04.ts'
import type { KnowledgeAssetCollectionV04, LoadedAssetV04 } from '../../knowledge/storage/v04-types.ts'
import { KnowledgeBaseRegistry } from '../../knowledge/registry/registry.ts'
import { createKnowledgeBase, removeKnowledgeBase } from '../knowledge/helpers.ts'
import { runThesisRefreshAdapter } from '../../workflows/thesis-lifecycle/refresh-adapter.ts'
import { collectThesisRefreshCandidates } from '../../app/services/thesis-lifecycle-service.ts'

const asLoaded = (value: KnowledgeAssetV04, kind: LoadedAssetV04['kind']): LoadedAssetV04 => ({ value, kind, filePath: `${value.id}.json`, storageRef: `${kind}/${value.id}.json` })

export async function createThesisRefreshAdapterFixture() {
  const root = await createKnowledgeBase({ schemaVersion: '0.4', knowledgeBaseId: 'kb-thesis-refresh' })
  const handle = await new KnowledgeBaseRegistry().mount(root)
  const raw = await archiveRaw(handle, { bytes: Buffer.from('published research evidence'), originalFilename: 'evidence.txt', mediaType: 'text/plain' }, { clock: () => '2026-04-01T00:00:00.000Z' })
  const thesis = { id: 'thesis:case', subjectRefs: ['entity:issuer'], title: 'Growth thesis', statement: 'Issuer grows', status: 'active', createdAt: '2026-01-01T00:00:00.000Z', lastReviewedAt: '2026-03-01T00:00:00.000Z', lifecycle: { status: 'active' } } as KnowledgeAssetV04
  const entity = { id: 'entity:issuer', type: 'company', name: 'Example Issuer', aliases: [], lifecycle: { status: 'active' } } as unknown as KnowledgeAssetV04
  const claim = { id: 'claim:proposition', claimType: 'viewpoint', statement: 'Margins expand', subjectRefs: ['entity:issuer'], sourceRefs: ['source:report'], provenance: [{ sourceRef: 'source:report', rawRef: raw.manifest.rawRef, locator: null, chunkRef: null }], lifecycle: { status: 'active' }, createdAt: '2026-01-01T00:00:00.000Z' } as unknown as KnowledgeAssetV04
  const source = { id: 'source:report', title: 'Research report', sourceType: 'document', publishedAt: '2026-04-01T00:00:00.000Z', providerTermsKnown: false, rawRefs: [raw.manifest.rawRef], rights: { accessScope: 'public', providerTermsKnown: false, retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true }, usagePolicy: { mode: 'personal_noncommercial_research', retainRaw: true, allowAiProcessing: true, allowDerivedKnowledge: true, redistributionAllowed: false }, lifecycle: { status: 'active' } } as unknown as KnowledgeAssetV04
  const observation = { id: 'observation:margin', observationType: 'metric', subjectRef: 'entity:issuer', metricRef: 'gross_margin', value: 0.42, unit: 'ratio', period: '2026-Q1', sourceRef: 'source:report', provenance: [{ sourceRef: 'source:report', rawRef: raw.manifest.rawRef, locator: 'page 2' }], reportedAt: '2026-04-01T00:00:00.000Z', lifecycle: { status: 'active' } } as unknown as KnowledgeAssetV04
  const membership = { id: 'reasoning-edge:qualifies', type: 'qualifies', sourceRef: 'claim:proposition', targetRef: 'thesis:case', lifecycle: { status: 'active' } } as unknown as KnowledgeAssetV04
  const values = [thesis, entity, claim, source, observation, membership]
  const kinds: LoadedAssetV04['kind'][] = ['thesis', 'entity', 'claim', 'source', 'observation', 'reasoning_edge']
  const assets: KnowledgeAssetCollectionV04 = { rootDir: root, objects: values.map((value, index) => asLoaded(value, kinds[index]!)), registry: [] }
  return { root, handle, assets, rawRef: raw.manifest.rawRef }
}

async function createCriterionRefreshAdapterFixture(options: { value?: number; threshold?: number; locator?: boolean; revision?: number } = {}) {
  const root = await createKnowledgeBase({ schemaVersion: '0.4', knowledgeBaseId: 'kb-thesis-refresh-criterion' })
  const handle = await new KnowledgeBaseRegistry().mount(root)
  const value = options.value ?? 0.42
  const threshold = options.threshold ?? 0.4
  const metricRef = 'gross_margin'
  const unit = 'ratio'
  const period = '2026-Q1'
  const metricLabel = getMetricDefinitionV04(metricRef)?.label ?? metricRef
  const quote = `${metricLabel} ${value} ${unit} ${period}`
  const locator = `quote:${Buffer.from(quote, 'utf8').toString('base64url')}`
  const raw = await archiveRaw(handle, { bytes: Buffer.from(quote, 'utf8'), originalFilename: 'filing.txt', mediaType: 'text/plain' }, { clock: () => '2026-04-01T00:00:00.000Z' })
  const definition = { metricRef, operator: 'gte' as const, threshold, unit, period }
  const origin = { kind: 'human_rule' as const }
  const revision = options.revision ?? 1
  const criterion: KillCriterionV04 = {
    conditionId: 'margin-floor', revision, state: 'active', type: 'numeric_threshold', definitionVersion: 1,
    definition, targetClaimRefs: ['claim:proposition'], effectiveAt: '2026-04-01T00:00:00.000Z',
    definitionHash: hashKillCriterionDefinitionV04({ type: 'numeric_threshold', definitionVersion: 1, definition, targetClaimRefs: ['claim:proposition'], origin }),
    authority: { workflowRunId: `criterion-confirm-${revision}`, confirmedAt: '2026-03-01T00:00:00.000Z', origin },
  }
  const thesis = { id: 'thesis:case', subjectRefs: ['entity:issuer'], title: 'Growth thesis', statement: 'Issuer grows', status: 'active', createdAt: '2026-01-01T00:00:00.000Z', lastReviewedAt: '2026-03-01T00:00:00.000Z', lifecycle: { status: 'active' }, killCriteria: [criterion] } as unknown as KnowledgeAssetV04
  const entity = { id: 'entity:issuer', type: 'company', name: 'Example Issuer', aliases: [], lifecycle: { status: 'active' } } as unknown as KnowledgeAssetV04
  const claim = { id: 'claim:proposition', claimType: 'viewpoint', statement: 'Margins expand', subjectRefs: ['entity:issuer'], sourceRefs: ['source:report'], provenance: [{ sourceRef: 'source:report', rawRef: raw.manifest.rawRef, locator: options.locator === false ? null : locator, chunkRef: null }], lifecycle: { status: 'active' }, createdAt: '2026-01-01T00:00:00.000Z' } as unknown as KnowledgeAssetV04
  const source = { id: 'source:report', title: 'Official disclosure', sourceType: 'official_disclosure', publishedAt: '2026-04-01T00:00:00.000Z', rawRefs: [raw.manifest.rawRef], acquisition: { method: 'official' }, rights: { accessScope: 'public', providerTermsKnown: true, retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true }, usagePolicy: { mode: 'personal_noncommercial_research', retainRaw: true, allowAiProcessing: true, allowDerivedKnowledge: true, redistributionAllowed: false }, lifecycle: { status: 'active' } } as unknown as KnowledgeAssetV04
  const observation = { id: 'observation:margin', observationType: 'metric', subjectRef: 'entity:issuer', metricRef, value, unit, period, sourceRef: 'source:report', provenance: [{ sourceRef: 'source:report', rawRef: raw.manifest.rawRef, locator: options.locator === false ? null : locator }], reportedAt: '2026-04-01T00:00:00.000Z', lifecycle: { status: 'active' } } as unknown as KnowledgeAssetV04
  const membership = { id: 'reasoning-edge:qualifies', type: 'qualifies', sourceRef: 'claim:proposition', targetRef: 'thesis:case', lifecycle: { status: 'active' } } as unknown as KnowledgeAssetV04
  const values: Array<[KnowledgeAssetV04, LoadedAssetV04['kind']]> = [[thesis, 'thesis'], [entity, 'entity'], [claim, 'claim'], [source, 'source'], [observation, 'observation'], [membership, 'reasoning_edge']]
  const assets: KnowledgeAssetCollectionV04 = { rootDir: root, objects: values.map(([item, kind]) => asLoaded(item, kind)), registry: [] }
  const evidenceBindings = [{ evidenceRef: observation.id, relation: 'supports' as const, targetClaimRefs: ['claim:proposition'], sourceBindings: [{ sourceRef: source.id, rawRef: raw.manifest.rawRef }], basis: 'verified_evidence' as const }]
  return { root, handle, assets, rawRef: raw.manifest.rawRef, criterion, source, observation, evidenceBindings }
}

test('REFRESH adapter reconstructs active qualifies membership and verifies explicit evidence lineage', async () => {
  const f = await createThesisRefreshAdapterFixture()
  try {
    const result = await runThesisRefreshAdapter({
      assets: f.assets,
      handle: f.handle,
      thesisRef: 'thesis:case',
      currentAsOf: '2026-09-01T00:00:00.000Z',
      evidenceBindings: [{ evidenceRef: 'observation:margin', relation: 'supports', targetClaimRefs: ['claim:proposition'], sourceBindings: [{ sourceRef: 'source:report', rawRef: f.rawRef }], basis: 'verified_evidence' }],
    })
    assert.equal(result.status, 'completed')
    assert.deepEqual(result.priorSnapshot?.propositions.map((item) => item.propositionId), ['claim:proposition'])
    assert.equal(result.refresh?.propositionDeltas[0]?.propositionRef, 'claim:proposition')
    assert.equal(result.refresh?.propositionDeltas[0]?.previousStatus, 'unknown')
    assert.deepEqual(result.criterionEvaluations, [])
    assert.ok(result.diagnostics.includes('KILL_CRITERION_MISSING'))
    assert.equal(result.evidenceLineage[0]?.decision, 'included')
    assert.deepEqual(result.evidenceLineage[0]?.sourceBindings, [{ sourceRef: 'source:report', rawRef: f.rawRef }])
  } finally { await removeKnowledgeBase(f.root) }
})

test('REFRESH adapter excludes future, unknown-publication, and unbound evidence with explicit lineage', async () => {
  const f = await createThesisRefreshAdapterFixture()
  try {
    const source = f.assets.objects.find((item) => item.value.id === 'source:report')!.value as Record<string, unknown>
    const observation = f.assets.objects.find((item) => item.value.id === 'observation:margin')!.value as Record<string, unknown>
    const unknownSource = { ...source, id: 'source:unknown', publishedAt: null } as unknown as KnowledgeAssetV04
    const futureSource = { ...source, id: 'source:future', publishedAt: '2027-01-01T00:00:00.000Z' } as unknown as KnowledgeAssetV04
    const unknown = { ...observation, id: 'observation:unknown', sourceRef: 'source:unknown', provenance: [{ sourceRef: 'source:unknown', rawRef: f.rawRef, locator: 'page 2' }] } as unknown as KnowledgeAssetV04
    const future = { ...observation, id: 'observation:future', sourceRef: 'source:future', provenance: [{ sourceRef: 'source:future', rawRef: f.rawRef, locator: 'page 2' }] } as unknown as KnowledgeAssetV04
    const inactive = { ...(f.assets.objects.find((item) => item.value.id === 'observation:margin')!.value as Record<string, unknown>), id: 'observation:inactive', lifecycle: { status: 'superseded' } } as unknown as KnowledgeAssetV04
    const estimate = { ...observation, id: 'observation:estimate', observationType: 'estimate', publishedAt: '2026-05-01T00:00:00.000Z', fiscalPeriod: '2026-Q2', estimateValue: 12, institutionRef: 'entity:broker' } as unknown as KnowledgeAssetV04
    const assets: KnowledgeAssetCollectionV04 = { ...f.assets, objects: [...f.assets.objects, asLoaded(unknownSource, 'source'), asLoaded(futureSource, 'source'), asLoaded(unknown, 'observation'), asLoaded(future, 'observation'), asLoaded(inactive, 'observation'), asLoaded(estimate, 'observation')] }
    const result = await runThesisRefreshAdapter({
      assets,
      handle: f.handle,
      thesisRef: 'thesis:case',
      currentAsOf: '2026-09-01T00:00:00.000Z',
      evidenceBindings: [
        { evidenceRef: 'observation:unknown', relation: 'supports', targetClaimRefs: ['claim:proposition'], sourceBindings: [{ sourceRef: 'source:unknown', rawRef: f.rawRef }] },
        { evidenceRef: 'observation:future', relation: 'supports', targetClaimRefs: ['claim:proposition'], sourceBindings: [{ sourceRef: 'source:future', rawRef: f.rawRef }] },
        { evidenceRef: 'observation:margin', relation: 'supports', targetClaimRefs: ['claim:proposition'], sourceBindings: [] },
        { evidenceRef: 'observation:inactive', relation: 'supports', targetClaimRefs: ['claim:proposition'], sourceBindings: [{ sourceRef: 'source:report', rawRef: f.rawRef }] },
        { evidenceRef: 'observation:margin', relation: 'supports', targetClaimRefs: ['claim:proposition'], sourceBindings: [{ sourceRef: 'source:report', rawRef: 'raw-sha256-0000000000000000000000000000000000000000000000000000000000000000' }] },
        { evidenceRef: 'observation:estimate', relation: 'supports', targetClaimRefs: ['claim:proposition'], sourceBindings: [{ sourceRef: 'source:report', rawRef: f.rawRef }] },
      ],
    })
    assert.equal(result.status, 'completed')
    assert.deepEqual(result.evidenceLineage.map((item) => item.reason), ['EVIDENCE_PUBLICATION_UNKNOWN', 'EVIDENCE_PUBLICATION_FUTURE', 'EVIDENCE_SOURCE_BINDING_MISSING', 'EVIDENCE_REF_INACTIVE', 'EVIDENCE_BINDING_AMBIGUOUS', 'EVIDENCE_PUBLICATION_BINDING_MISMATCH'])
    assert.deepEqual(result.refresh?.propositionDeltas, [])
  } finally { await removeKnowledgeBase(f.root) }
})

test('REFRESH adapter rejects sources outside lifecycle and rights validity intervals', async () => {
  const f = await createThesisRefreshAdapterFixture()
  try {
    const source = f.assets.objects.find((item) => item.value.id === 'source:report')!.value as Record<string, unknown>
    const observation = f.assets.objects.find((item) => item.value.id === 'observation:margin')!.value as Record<string, unknown>
    const expired = { ...source, id: 'source:expired', lifecycle: { status: 'active', validUntil: '2026-08-31T23:59:59.000Z' } } as unknown as KnowledgeAssetV04
    const malformed = { ...source, id: 'source:malformed', rights: { ...(source.rights as object), expiresAt: 'tomorrow' } } as unknown as KnowledgeAssetV04
    const future = { ...source, id: 'source:future-valid', lifecycle: { status: 'active', validFrom: '2026-10-01T00:00:00.000Z' } } as unknown as KnowledgeAssetV04
    const cloneObservation = (id: string, sourceRef: string) => ({ ...observation, id, sourceRef, provenance: [{ sourceRef, rawRef: (observation.provenance as { rawRef: string }[])[0]!.rawRef }] }) as unknown as KnowledgeAssetV04
    const expiredObservation = cloneObservation('observation:expired-source', 'source:expired')
    const malformedObservation = cloneObservation('observation:malformed-source', 'source:malformed')
    const futureObservation = cloneObservation('observation:future-source', 'source:future-valid')
    const assets: KnowledgeAssetCollectionV04 = { ...f.assets, objects: [...f.assets.objects, asLoaded(expired, 'source'), asLoaded(malformed, 'source'), asLoaded(future, 'source'), asLoaded(expiredObservation, 'observation'), asLoaded(malformedObservation, 'observation'), asLoaded(futureObservation, 'observation')] }
    const result = await runThesisRefreshAdapter({ assets, handle: f.handle, thesisRef: 'thesis:case', currentAsOf: '2026-09-01T00:00:00.000Z', evidenceBindings: [
      { evidenceRef: 'observation:expired-source', relation: 'supports', targetClaimRefs: ['claim:proposition'], sourceBindings: [{ sourceRef: 'source:expired', rawRef: f.rawRef }] },
      { evidenceRef: 'observation:malformed-source', relation: 'supports', targetClaimRefs: ['claim:proposition'], sourceBindings: [{ sourceRef: 'source:malformed', rawRef: f.rawRef }] },
      { evidenceRef: 'observation:future-source', relation: 'supports', targetClaimRefs: ['claim:proposition'], sourceBindings: [{ sourceRef: 'source:future-valid', rawRef: f.rawRef }] },
    ] })
    assert.deepEqual(result.evidenceLineage.map((item) => item.reason), ['EVIDENCE_SOURCE_INELIGIBLE', 'EVIDENCE_SOURCE_INELIGIBLE', 'EVIDENCE_SOURCE_INELIGIBLE'])
    assert.deepEqual(result.refresh?.propositionDeltas, [])
    for (const evidenceRef of ['observation:expired-source', 'observation:malformed-source', 'observation:future-source']) {
      const collected = await collectThesisRefreshCandidates({ assets, handle: f.handle, companyRef: 'entity:issuer', priorAsOf: '2026-03-01T00:00:00.000Z', asOf: '2026-09-01T00:00:00.000Z', activeClaimRefs: new Set(['claim:proposition']), selectedRefs: [evidenceRef] })
      assert.equal(collected.explicitSelectionInvalid, true)
      assert.equal(collected.decisions[0]?.reason, 'EVIDENCE_SOURCE_INELIGIBLE')
    }
  } finally { await removeKnowledgeBase(f.root) }
})

test('REFRESH candidate collection blocks automatic selection when more than 80 verified candidates qualify', async () => {
  const f = await createThesisRefreshAdapterFixture()
  try {
    const source = f.assets.objects.find((item) => item.value.id === 'source:report')!.value as Record<string, unknown>
    const observation = f.assets.objects.find((item) => item.value.id === 'observation:margin')!.value as Record<string, unknown>
    const extras: LoadedAssetV04[] = []
    for (let index = 0; index < 81; index++) {
      const sourceRef = `source:bulk-${index}`
      const evidenceRef = `observation:bulk-${index}`
      extras.push(asLoaded({ ...source, id: sourceRef } as unknown as KnowledgeAssetV04, 'source'))
      extras.push(asLoaded({ ...observation, id: evidenceRef, sourceRef, provenance: [{ sourceRef, rawRef: f.rawRef, locator: 'section 1' }] } as unknown as KnowledgeAssetV04, 'observation'))
    }
    const assets: KnowledgeAssetCollectionV04 = { ...f.assets, objects: [...f.assets.objects, ...extras] }
    const result = await collectThesisRefreshCandidates({ assets, handle: f.handle, companyRef: 'entity:issuer', priorAsOf: '2026-03-01T00:00:00.000Z', asOf: '2026-09-01T00:00:00.000Z', activeClaimRefs: new Set(['claim:proposition']) })
    assert.equal(result.limitExceeded, true)
    assert.equal(result.candidates.length, 0)
    assert.equal(result.decisions.filter((item) => item.reason === 'EVIDENCE_LIMIT_EXCEEDED').length, 82)
    assert.ok(result.diagnostics.includes('EVIDENCE_LIMIT_EXCEEDED'))
  } finally { await removeKnowledgeBase(f.root) }
})

test('REFRESH adapter fails closed on ambiguous active proposition membership', async () => {
  const f = await createThesisRefreshAdapterFixture()
  try {
    const edge = { id: 'reasoning-edge:duplicate', type: 'qualifies', sourceRef: 'claim:proposition', targetRef: 'thesis:case', lifecycle: { status: 'active' } } as unknown as KnowledgeAssetV04
    const assets: KnowledgeAssetCollectionV04 = { ...f.assets, objects: [...f.assets.objects, asLoaded(edge, 'reasoning_edge')] }
    const result = await runThesisRefreshAdapter({ assets, handle: f.handle, thesisRef: 'thesis:case', currentAsOf: '2026-09-01T00:00:00.000Z', evidenceBindings: [] })
    assert.equal(result.status, 'blocked')
    assert.ok(result.diagnostics.includes('THESIS_REFRESH_MEMBERSHIP_AMBIGUOUS'))
  } finally { await removeKnowledgeBase(f.root) }
})

test('REFRESH adapter blocks inconsistent active qualifies edges to inactive Claims', async () => {
  const f = await createThesisRefreshAdapterFixture()
  try {
    const claim = { ...(f.assets.objects.find((item) => item.value.id === 'claim:proposition')!.value as Record<string, unknown>), lifecycle: { status: 'superseded' } } as unknown as KnowledgeAssetV04
    const assets: KnowledgeAssetCollectionV04 = { ...f.assets, objects: f.assets.objects.map((item) => item.value.id === claim.id ? asLoaded(claim, 'claim') : item) }
    const result = await runThesisRefreshAdapter({ assets, handle: f.handle, thesisRef: 'thesis:case', currentAsOf: '2026-09-01T00:00:00.000Z', evidenceBindings: [] })
    assert.equal(result.status, 'blocked')
    assert.ok(result.diagnostics.includes('THESIS_REFRESH_MEMBERSHIP_INACTIVE_CLAIM'))
  } finally { await removeKnowledgeBase(f.root) }
})

test('REFRESH adapter uses a canonical criterion evaluation as the only invalidation authority', async () => {
  const f = await createCriterionRefreshAdapterFixture()
  try {
    const result = await runThesisRefreshAdapter({ assets: f.assets, handle: f.handle, thesisRef: 'thesis:case', currentAsOf: '2026-09-01T00:00:00.000Z', evidenceBindings: f.evidenceBindings })
    assert.equal(result.status, 'completed')
    assert.equal(result.criterionEvaluations.length, 1)
    assert.equal(result.criterionEvaluations[0]?.status, 'met')
    assert.deepEqual([result.criterionEvaluations[0]?.conditionId, result.criterionEvaluations[0]?.revision, result.criterionEvaluations[0]?.definitionHash], [f.criterion.conditionId, f.criterion.revision, f.criterion.definitionHash])
    assert.deepEqual(result.criterionEvaluations[0]?.evaluatedValue && [result.criterionEvaluations[0]!.evaluatedValue!.evidenceRef, result.criterionEvaluations[0]!.evaluatedValue!.sourceRef, result.criterionEvaluations[0]!.evaluatedValue!.rawRef, result.criterionEvaluations[0]!.evaluatedValue!.locator], ['observation:margin', 'source:report', f.rawRef, `quote:${Buffer.from(`${getMetricDefinitionV04('gross_margin')?.label ?? 'gross_margin'} 0.42 ratio 2026-Q1`, 'utf8').toString('base64url')}`])
    assert.equal(result.refresh?.candidateTransition, 'invalidation_condition_met')
    assert.deepEqual(result.refresh?.killCriterionAssessments, [])
  } finally { await removeKnowledgeBase(f.root) }
})

test('REFRESH adapter retains an ordinary transition when a canonical criterion is not met', async () => {
  const f = await createCriterionRefreshAdapterFixture({ value: 0.32 })
  try {
    const result = await runThesisRefreshAdapter({ assets: f.assets, handle: f.handle, thesisRef: 'thesis:case', currentAsOf: '2026-09-01T00:00:00.000Z', evidenceBindings: f.evidenceBindings })
    assert.equal(result.criterionEvaluations[0]?.status, 'not_met')
    assert.equal(result.refresh?.candidateTransition, 'strengthened')
  } finally { await removeKnowledgeBase(f.root) }
})

test('REFRESH adapter preserves ordinary refresh and returns insufficient when canonical provenance has no exact quote locator', async () => {
  const f = await createCriterionRefreshAdapterFixture({ locator: false })
  try {
    const result = await runThesisRefreshAdapter({ assets: f.assets, handle: f.handle, thesisRef: 'thesis:case', currentAsOf: '2026-09-01T00:00:00.000Z', evidenceBindings: f.evidenceBindings })
    assert.equal(result.status, 'completed')
    assert.equal(result.criterionEvaluations[0]?.status, 'insufficient_evidence')
    assert.ok(result.criterionEvaluations[0]?.diagnostics.includes('KILL_CRITERION_EVIDENCE_PROVENANCE_LOCATOR_INVALID'))
    assert.equal(result.refresh?.candidateTransition, 'strengthened')
  } finally { await removeKnowledgeBase(f.root) }
})

test('REFRESH adapter fails closed when a valid value is accompanied by included same-metric evidence without a locator', async () => {
  const f = await createCriterionRefreshAdapterFixture()
  try {
    const secondQuote = `${getMetricDefinitionV04('gross_margin')?.label ?? 'gross_margin'} 0.31 ratio 2026-Q1`
    const secondRaw = await archiveRaw(f.handle, { bytes: Buffer.from(secondQuote, 'utf8'), originalFilename: 'filing-2.txt', mediaType: 'text/plain' }, { clock: () => '2026-06-01T00:00:00.000Z' })
    const source = { ...(f.source as unknown as Record<string, unknown>), id: 'source:report-second', publishedAt: '2026-06-01T00:00:00.000Z', rawRefs: [secondRaw.manifest.rawRef] } as unknown as KnowledgeAssetV04
    const observation = { ...(f.observation as unknown as Record<string, unknown>), id: 'observation:margin-unlocated', value: 0.31, sourceRef: source.id, provenance: [{ sourceRef: source.id, rawRef: secondRaw.manifest.rawRef, locator: null }] } as unknown as KnowledgeAssetV04
    const assets: KnowledgeAssetCollectionV04 = { ...f.assets, objects: [...f.assets.objects, asLoaded(source, 'source'), asLoaded(observation, 'observation')] }
    const evidenceBindings = [...f.evidenceBindings, { ...f.evidenceBindings[0]!, evidenceRef: observation.id, sourceBindings: [{ sourceRef: source.id, rawRef: secondRaw.manifest.rawRef }] }]
    const result = await runThesisRefreshAdapter({ assets, handle: f.handle, thesisRef: 'thesis:case', currentAsOf: '2026-09-01T00:00:00.000Z', evidenceBindings })
    assert.ok(result.evidenceLineage.every((item) => item.decision === 'included'))
    assert.equal(result.criterionEvaluations[0]?.status, 'insufficient_evidence')
    assert.ok(result.criterionEvaluations[0]?.diagnostics.includes('KILL_CRITERION_EVIDENCE_PROVENANCE_LOCATOR_INVALID'))
    assert.notEqual(result.refresh?.candidateTransition, 'invalidation_condition_met')
  } finally { await removeKnowledgeBase(f.root) }
})

test('REFRESH adapter preserves explicit target refs that extend beyond a criterion target', async () => {
  const f = await createCriterionRefreshAdapterFixture()
  try {
    const secondClaim = { id: 'claim:other', claimType: 'viewpoint', statement: 'A second proposition', subjectRefs: ['entity:issuer'], lifecycle: { status: 'active' } } as unknown as KnowledgeAssetV04
    const secondMembership = { id: 'reasoning-edge:qualifies-second', type: 'qualifies', sourceRef: 'claim:other', targetRef: 'thesis:case', lifecycle: { status: 'active' } } as unknown as KnowledgeAssetV04
    const assets: KnowledgeAssetCollectionV04 = { ...f.assets, objects: [...f.assets.objects, asLoaded(secondClaim, 'claim'), asLoaded(secondMembership, 'reasoning_edge')] }
    const evidenceBindings = [{ ...f.evidenceBindings[0]!, targetClaimRefs: ['claim:proposition', 'claim:other'] }]
    const result = await runThesisRefreshAdapter({ assets, handle: f.handle, thesisRef: 'thesis:case', currentAsOf: '2026-09-01T00:00:00.000Z', evidenceBindings })
    assert.deepEqual(result.evidenceLineage[0]?.targetClaimRefs, ['claim:proposition', 'claim:other'])
    assert.equal(result.criterionEvaluations[0]?.status, 'insufficient_evidence')
    assert.ok(result.criterionEvaluations[0]?.diagnostics.includes('KILL_CRITERION_EVIDENCE_TARGET_BINDING_INVALID'))
    assert.notEqual(result.refresh?.candidateTransition, 'invalidation_condition_met')
  } finally { await removeKnowledgeBase(f.root) }
})

test('REFRESH adapter refuses conflicting canonical values instead of choosing one', async () => {
  const f = await createCriterionRefreshAdapterFixture()
  try {
    const secondQuote = `${getMetricDefinitionV04('gross_margin')?.label ?? 'gross_margin'} 0.31 ratio 2026-Q1`
    const secondRaw = await archiveRaw(f.handle, { bytes: Buffer.from(secondQuote, 'utf8'), originalFilename: 'filing-2.txt', mediaType: 'text/plain' }, { clock: () => '2026-06-01T00:00:00.000Z' })
    const source = { ...(f.source as unknown as Record<string, unknown>), id: 'source:report-second', publishedAt: '2026-06-01T00:00:00.000Z', rawRefs: [secondRaw.manifest.rawRef] } as unknown as KnowledgeAssetV04
    const observation = { ...(f.observation as unknown as Record<string, unknown>), id: 'observation:margin-second', value: 0.31, sourceRef: source.id, provenance: [{ sourceRef: source.id, rawRef: secondRaw.manifest.rawRef, locator: `quote:${Buffer.from(secondQuote, 'utf8').toString('base64url')}` }] } as unknown as KnowledgeAssetV04
    const assets: KnowledgeAssetCollectionV04 = { ...f.assets, objects: [...f.assets.objects, asLoaded(source, 'source'), asLoaded(observation, 'observation')] }
    const evidenceBindings = [...f.evidenceBindings, { ...f.evidenceBindings[0]!, evidenceRef: observation.id, sourceBindings: [{ sourceRef: source.id, rawRef: secondRaw.manifest.rawRef }] }]
    const result = await runThesisRefreshAdapter({ assets, handle: f.handle, thesisRef: 'thesis:case', currentAsOf: '2026-09-01T00:00:00.000Z', evidenceBindings })
    assert.equal(result.criterionEvaluations[0]?.status, 'insufficient_evidence')
    assert.ok(result.criterionEvaluations[0]?.diagnostics.includes('KILL_CRITERION_EVIDENCE_VALUES_CONFLICT'))
    assert.notEqual(result.refresh?.candidateTransition, 'invalidation_condition_met')
  } finally { await removeKnowledgeBase(f.root) }
})

test('REFRESH adapter reports the active revised criterion identity and evaluates only that revision', async () => {
  const f = await createCriterionRefreshAdapterFixture({ value: 0.42, threshold: 0.5, revision: 2 })
  try {
    const thesis = f.assets.objects.find((item) => item.value.id === 'thesis:case')!.value as unknown as { killCriteria: KillCriterionV04[] }
    const superseded = { ...thesis.killCriteria[0]!, revision: 1, state: 'superseded' as const }
    const revised = { ...thesis.killCriteria[0]!, revision: 2 }
    const assets: KnowledgeAssetCollectionV04 = { ...f.assets, objects: f.assets.objects.map((item) => item.value.id === 'thesis:case' ? asLoaded({ ...(item.value as unknown as Record<string, unknown>), killCriteria: [superseded, revised] } as unknown as KnowledgeAssetV04, 'thesis') : item) }
    const result = await runThesisRefreshAdapter({ assets, handle: f.handle, thesisRef: 'thesis:case', currentAsOf: '2026-09-01T00:00:00.000Z', evidenceBindings: f.evidenceBindings })
    assert.equal(result.criterionEvaluations.length, 1)
    assert.equal(result.criterionEvaluations[0]?.revision, 2)
    assert.equal(result.criterionEvaluations[0]?.definitionHash, revised.definitionHash)
    assert.equal(result.criterionEvaluations[0]?.status, 'not_met')
    assert.equal(result.refresh?.candidateTransition, 'strengthened')
  } finally { await removeKnowledgeBase(f.root) }
})
