import assert from 'node:assert/strict'
import test from 'node:test'
import { KNOWLEDGE_SCHEMA_V04, type KnowledgeAssetV04, type KnowledgeClaimV04, type KnowledgeReasoningEdgeV04, type KnowledgeSourceV04 } from '../../knowledge/schema/index.ts'
import { hashKillCriterionDefinitionV04 } from '../../knowledge/schema/kill-criterion-v04.ts'
import { assertKnowledgeV04Objects, validateKnowledgeV04Objects } from '../../knowledge/validation/index.ts'

const source = (id: `source:${string}` = 'source:test'): KnowledgeSourceV04 => ({ id, title: 'Official source', sourceType: 'official_disclosure', provider: 'cninfo', canonicalUrl: 'https://example.com/report', retrievedAt: '2026-09-08T00:00:00.000Z', contentHash: 'a'.repeat(64), rights: { accessScope: 'public', providerTermsKnown: false, retentionAllowed: null, aiProcessingAllowed: null, derivativeKnowledgeAllowed: null, redistributionAllowed: null }, usagePolicy: { mode: 'personal_noncommercial_research', retainRaw: true, allowAiProcessing: true, allowDerivedKnowledge: true, redistributionAllowed: false }, lifecycle: { status: 'active' } })
const claim = (id: `claim:${string}`, claimType: KnowledgeClaimV04['claimType'], extra: Partial<KnowledgeClaimV04> = {}): KnowledgeClaimV04 => ({ id, claimType, statement: 'A bounded research statement', subjectRefs: ['entity:company-test'], sourceRefs: ['source:test'] as `source:${string}`[], confidence: 0.8, lifecycle: { status: 'active' }, ...extra })

test('Schema 0.4 declares additions without changing v0.3 identity', () => { assert.equal(KNOWLEDGE_SCHEMA_V04.identity.schemaVersion, '0.4'); assert.ok(KNOWLEDGE_SCHEMA_V04.claim.types.includes('thesis')); assert.ok(KNOWLEDGE_SCHEMA_V04.source.fields.includes('rights')) })
test('Schema 0.4 separates forecast probability from confidence', () => { assertKnowledgeV04Objects([source(), claim('claim:forecast', 'forecast', { probability: 0.65 })]); assert.equal(validateKnowledgeV04Objects([source(), claim('claim:forecast', 'forecast')]).status, 'failed'); assert.equal(validateKnowledgeV04Objects([source(), claim('claim:fact', 'fact', { probability: 0.5 })]).status, 'failed') })
test('Schema 0.4 rejects missing, self, and cyclic claim dependencies deterministically', () => { const missing = validateKnowledgeV04Objects([source(), claim('claim:missing', 'fact', { dependsOnClaimRefs: ['claim:nope'] })]); assert.ok(missing.errors.some((error) => error.code === 'V04_MISSING_CLAIM_REF')); const self = validateKnowledgeV04Objects([source(), claim('claim:self', 'fact', { supportsClaimRefs: ['claim:self'] })]); assert.ok(self.errors.some((error) => error.code === 'V04_SELF_REFERENCE')); const a = claim('claim:a', 'fact', { supportsClaimRefs: ['claim:b'] }); const b = claim('claim:b', 'fact', { supportsClaimRefs: ['claim:a'] }); const cycle = validateKnowledgeV04Objects([source(), a, b]); assert.ok(cycle.errors.some((error) => error.code === 'V04_DEPENDENCY_CYCLE')) })
test('Schema 0.4 requires explicit source rights and provenance-shaped metadata', () => { assert.equal(validateKnowledgeV04Objects([{ ...source(), rights: undefined } as unknown as KnowledgeSourceV04]).status, 'failed'); assertKnowledgeV04Objects([source()]) })
test('Schema 0.4 ReasoningEdge TypeScript and runtime endpoints exclude Thesis as a source', () => { const typed: KnowledgeReasoningEdgeV04 = { id: 'reasoning-edge:typed', type: 'supports', sourceRef: 'claim:source', targetRef: 'thesis:target', lifecycle: { status: 'active' } }; assert.equal(typed.sourceRef, 'claim:source'); const invalid = { id: 'reasoning-edge:invalid', type: 'supports', sourceRef: 'thesis:target', targetRef: 'thesis:target', lifecycle: { status: 'active' } }; const report = validateKnowledgeV04Objects([source(), { id: 'entity:company-test', type: 'company', name: 'Test', lifecycle: { status: 'active' } } as never, claim('claim:source', 'fact'), { id: 'thesis:target', subjectRefs: ['entity:company-test'], title: 'T', statement: 'S', status: 'active', createdAt: '2026-09-08T00:00:00.000Z', lifecycle: { status: 'active' } } as never, invalid as never]); assert.ok(report.errors.some((error) => error.code === 'V04_REASONING_ENDPOINT')) })

const criterionAssets = (criterion?: Record<string, unknown>): KnowledgeAssetV04[] => {
  const rawRef = `raw-sha256-${'a'.repeat(64)}` as `raw-sha256-${string}`
  const evidenceSource = { ...source(), id: 'source:criterion', publishedAt: '2026-09-08T00:00:00.000Z', rawRefs: [rawRef] }
  const company = { id: 'entity:company-test', type: 'company', name: 'Test', lifecycle: { status: 'active' } }
  const proposition = claim('claim:proposition', 'fact', { sourceRefs: ['source:criterion'] })
  const thesisId = 'thesis:criterion'
  const thesis = { id: thesisId, subjectRefs: ['entity:company-test'], title: 'Thesis', statement: 'Statement', status: 'active', createdAt: '2026-09-08T00:00:00.000Z', lifecycle: { status: 'active' }, ...(criterion === undefined ? {} : { killCriteria: [criterion] }) }
  const membership = { id: 'reasoning-edge:qualifies', type: 'qualifies', sourceRef: proposition.id, targetRef: thesisId, lifecycle: { status: 'active' } }
  return [evidenceSource, company, proposition, thesis, membership] as unknown as KnowledgeAssetV04[]
}

const makeCriterion = (overrides: Record<string, unknown> = {}): Record<string, unknown> => {
  const definition = { metricRef: 'revenue', operator: 'lt', threshold: 100, unit: 'CNY', period: 'FY2026' }
  const origin = { kind: 'human_rule' }
  return {
    conditionId: 'revenue-floor', revision: 1, state: 'active', type: 'numeric_threshold', definitionVersion: 1,
    definition, targetClaimRefs: ['claim:proposition'], effectiveAt: '2026-09-08T00:00:00.000Z',
    definitionHash: hashKillCriterionDefinitionV04({ type: 'numeric_threshold', definitionVersion: 1, definition, targetClaimRefs: ['claim:proposition'], origin }),
    authority: { workflowRunId: 'workflow-run-1', confirmedAt: '2026-09-08T00:00:00.000Z', origin },
    ...overrides,
  }
}

test('Schema 0.4 keeps historical Thesis records without killCriteria valid and declares the additive field', () => {
  assert.ok(KNOWLEDGE_SCHEMA_V04.thesis.fields.includes('killCriteria'))
  assert.equal(validateKnowledgeV04Objects(criterionAssets()).status, 'passed')
})

test('Schema 0.4 validates confirmed numeric threshold criteria and canonical immutable hash', () => {
  assert.equal(validateKnowledgeV04Objects(criterionAssets(makeCriterion())).status, 'passed')
  const tampered = makeCriterion({ definitionHash: `sha256:${'0'.repeat(64)}` })
  assert.ok(validateKnowledgeV04Objects(criterionAssets(tampered)).errors.some((error) => error.code === 'V04_KILL_CRITERION_HASH'))
})

test('Schema 0.4 retains bounded unknown criterion types without counting them as known definitions', () => {
  const unknown = makeCriterion({ type: 'future_event', definitionVersion: 3, definition: { event: { names: ['launch', 'recall'] } } })
  const origin = (unknown.authority as { origin: Record<string, unknown> }).origin
  unknown.definitionHash = hashKillCriterionDefinitionV04({ type: 'future_event', definitionVersion: 3, definition: unknown.definition as Record<string, unknown>, targetClaimRefs: ['claim:proposition'], origin })
  assert.equal(validateKnowledgeV04Objects(criterionAssets(unknown)).status, 'passed')
  const unsafe = makeCriterion({ type: 'future_event', definition: JSON.parse('{"__proto__":{"polluted":true}}') })
  assert.ok(validateKnowledgeV04Objects(criterionAssets(unsafe)).errors.some((error) => error.code === 'V04_KILL_CRITERION_DEFINITION'))
})

test('Schema 0.4 requires active qualifies Claim membership and consistent criterion revisions', () => {
  const missingMembership = criterionAssets(makeCriterion()).filter((asset) => asset.id !== 'reasoning-edge:qualifies')
  assert.ok(validateKnowledgeV04Objects(missingMembership).errors.some((error) => error.code === 'V04_KILL_CRITERION_TARGET_MEMBERSHIP'))
  const second = makeCriterion({ revision: 2, state: 'active' })
  const criteria = [makeCriterion(), second]
  const thesisAssets = criterionAssets()
  const thesis = thesisAssets.find((asset) => asset.id === 'thesis:criterion') as unknown as { killCriteria: Record<string, unknown>[] }
  thesis.killCriteria = criteria
  assert.ok(validateKnowledgeV04Objects(thesisAssets).errors.some((error) => error.code === 'V04_KILL_CRITERION_REVISION_ORDER'))
})

test('Schema 0.4 retains superseded history after its target Claim becomes inactive or loses qualifies membership', () => {
  const assets = criterionAssets(makeCriterion({ state: 'superseded' }))
  const target = assets.find((asset) => asset.id === 'claim:proposition') as unknown as { lifecycle: { status: string } }
  target.lifecycle.status = 'superseded'
  const withoutMembership = assets.filter((asset) => asset.id !== 'reasoning-edge:qualifies')
  assert.equal(validateKnowledgeV04Objects(withoutMembership).status, 'passed')
  const missingTarget = withoutMembership.filter((asset) => asset.id !== 'claim:proposition')
  assert.ok(validateKnowledgeV04Objects(missingTarget).errors.some((error) => error.code === 'V04_KILL_CRITERION_TARGET_REF'))
})

test('Schema 0.4 binds source-derived origin to a resolving Source, RawRef, locator, and publishedAt', () => {
  const criterion = makeCriterion()
  const definition = criterion.definition as Record<string, unknown>
  const origin = { kind: 'source_derived', sourceRef: 'source:criterion', rawRef: `raw-sha256-${'a'.repeat(64)}`, locator: 'table 3, row 2', publishedAt: '2026-09-08T00:00:00.000Z' }
  criterion.authority = { workflowRunId: 'workflow-run-1', confirmedAt: '2026-09-08T00:00:00.000Z', origin }
  criterion.definitionHash = hashKillCriterionDefinitionV04({ type: 'numeric_threshold', definitionVersion: 1, definition, targetClaimRefs: ['claim:proposition'], origin })
  assert.equal(validateKnowledgeV04Objects(criterionAssets(criterion)).status, 'passed')
  origin.publishedAt = '2026-09-09T00:00:00.000Z'
  criterion.authority = { workflowRunId: 'workflow-run-1', confirmedAt: '2026-09-08T00:00:00.000Z', origin }
  criterion.definitionHash = hashKillCriterionDefinitionV04({ type: 'numeric_threshold', definitionVersion: 1, definition, targetClaimRefs: ['claim:proposition'], origin })
  assert.ok(validateKnowledgeV04Objects(criterionAssets(criterion)).errors.some((error) => error.code === 'V04_KILL_CRITERION_ORIGIN_SOURCE'))
})

test('Schema 0.4 bounds authority and origin keys and checks criterion chronology', () => {
  const extraAuthority = makeCriterion()
  extraAuthority.authority = { ...(extraAuthority.authority as Record<string, unknown>), unreviewed: true }
  assert.ok(validateKnowledgeV04Objects(criterionAssets(extraAuthority)).errors.some((error) => error.code === 'V04_KILL_CRITERION_AUTHORITY'))

  const extraOrigin = makeCriterion()
  const humanOrigin = { kind: 'human_rule', rationale: 'unbounded extra' }
  extraOrigin.authority = { workflowRunId: 'workflow-run-1', confirmedAt: '2026-09-08T00:00:00.000Z', origin: humanOrigin }
  extraOrigin.definitionHash = hashKillCriterionDefinitionV04({ type: 'numeric_threshold', definitionVersion: 1, definition: extraOrigin.definition as Record<string, unknown>, targetClaimRefs: ['claim:proposition'], origin: humanOrigin })
  assert.ok(validateKnowledgeV04Objects(criterionAssets(extraOrigin)).errors.some((error) => error.code === 'V04_KILL_CRITERION_AUTHORITY'))

  const earlyEffective = makeCriterion({ effectiveAt: '2026-09-07T00:00:00.000Z' })
  assert.ok(validateKnowledgeV04Objects(criterionAssets(earlyEffective)).errors.some((error) => error.code === 'V04_KILL_CRITERION_TIME'))

  const latePublished = makeCriterion()
  const sourceAssets = criterionAssets(latePublished)
  const source = sourceAssets.find((asset) => asset.id === 'source:criterion') as unknown as { publishedAt: string }
  source.publishedAt = '2026-09-09T00:00:00.000Z'
  const sourceOrigin = { kind: 'source_derived', sourceRef: 'source:criterion', rawRef: `raw-sha256-${'a'.repeat(64)}`, locator: 'table 3, row 2', publishedAt: source.publishedAt }
  latePublished.authority = { workflowRunId: 'workflow-run-1', confirmedAt: '2026-09-08T00:00:00.000Z', origin: sourceOrigin }
  latePublished.definitionHash = hashKillCriterionDefinitionV04({ type: 'numeric_threshold', definitionVersion: 1, definition: latePublished.definition as Record<string, unknown>, targetClaimRefs: ['claim:proposition'], origin: sourceOrigin })
  assert.ok(validateKnowledgeV04Objects(sourceAssets).errors.some((error) => error.code === 'V04_KILL_CRITERION_ORIGIN_SOURCE'))
})
