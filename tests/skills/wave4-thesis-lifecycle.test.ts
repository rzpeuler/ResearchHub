import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzeExpectationGap } from '../../skills/expectation_gap/calculations.ts'
import { mapCatalysts } from '../../skills/catalyst_map/calculations.ts'
import { formalizeThesis } from '../../skills/thesis_formalize/calculations.ts'
import { refreshThesis } from '../../skills/thesis_refresh/calculations.ts'
import { assessThesisFragility, evaluateThesisKillCriterion } from '../../skills/thesis-red-team/calculations.ts'
import { createResearchSkillRegistry } from '../../app/services/skill-registry.ts'
import { CANONICAL_RESEARCH_SKILL_CATALOG } from '../../app/services/research-skill-catalog.ts'
import { runThesisLifecycle } from '../../workflows/thesis-lifecycle/workflow.ts'

const basePropositions = [
  { propositionId: 'p-demand', statement: 'Demand grows through explicit volume expansion.', propositionType: 'business_driver' as const, basis: 'verified_evidence' as const, timeHorizon: 'near_term', sourceRefs: ['source:demand'] },
  { propositionId: 'p-earnings', statement: 'Earnings exceed the comparable expectation.', propositionType: 'earnings_expectation' as const, basis: 'inference' as const, timeHorizon: 'medium_term', dependsOnPropositionRefs: ['p-demand'] },
]

test('thesis formalization builds an acyclic proposition graph and derives load-bearing status', () => {
  const result = formalizeThesis({ thesisId: 'thesis:demo', summary: 'Demand supports earnings.', propositions: basePropositions })
  assert.equal(result.status, 'partial')
  assert.deepEqual(result.dependencies.map((item) => item.dependencyId), ['p-earnings->p-demand:depends_on'])
  assert.deepEqual(result.loadBearingPropositionRefs, ['p-demand'])
  assert.equal(result.propositions.find((item) => item.propositionId === 'p-earnings')?.availability, 'insufficient_evidence')
})

test('thesis formalization rejects duplicate, dangling, cyclic, and unsupported verified propositions', () => {
  assert.throws(() => formalizeThesis({ summary: 'x', propositions: [{ ...basePropositions[0]!, propositionId: 'p' }, { ...basePropositions[0]!, propositionId: 'p' }] }), /THESIS_PROPOSITION_DUPLICATE/)
  assert.throws(() => formalizeThesis({ summary: 'x', propositions: [{ ...basePropositions[0]!, dependsOnPropositionRefs: ['missing'] }] }), /THESIS_PROPOSITION_REF_DANGLING/)
  assert.throws(() => formalizeThesis({ summary: 'x', propositions: [{ ...basePropositions[0]!, dependsOnPropositionRefs: ['p2'] }, { ...basePropositions[1]!, propositionId: 'p2', dependsOnPropositionRefs: ['p-demand'] }] }), /THESIS_DEPENDENCY_CYCLE/)
  assert.throws(() => formalizeThesis({ summary: 'x', propositions: [{ ...basePropositions[0]!, sourceRefs: [] }] }), /VERIFIED_PROPOSITION_SOURCE_MISSING/)
})

const surface = (surfaceName: 'price_implied' | 'consensus' | 'management' | 'own_research', value: number, period = 'FY2027') => ({ surface: surfaceName, metric: 'revenue', period, unit: 'CNY', basis: 'reported', value, sourceRefs: [`source:${surfaceName}`] })

test('expectation gap calculates comparable deltas and preserves a no-material-gap result', () => {
  const result = analyzeExpectationGap({ asOf: '2026-09-21T00:00:00.000Z', surfaces: [surface('consensus', 100), surface('own_research', 100)] })
  const pair = result.pairs.find((item) => item.pairId === 'consensus_vs_own')!
  assert.equal(pair.relationship, 'equal')
  assert.equal(pair.absoluteDelta, 0)
  assert.equal(result.noMaterialExpectationGap, true)
  assert.equal(result.status, 'complete')
})

test('expectation gap rejects incompatible periods and keeps ranges structural', () => {
  const mismatched = analyzeExpectationGap({ asOf: '2026-09-21T00:00:00.000Z', surfaces: [surface('consensus', 100, 'FY2027'), surface('own_research', 120, 'FY2028')] })
  assert.equal(mismatched.pairs.find((item) => item.pairId === 'consensus_vs_own')?.relationship, 'not_directly_comparable')
  const range = analyzeExpectationGap({ asOf: '2026-09-21T00:00:00.000Z', surfaces: [surface('consensus', 100), { surface: 'management', metric: 'revenue', period: 'FY2027', unit: 'CNY', basis: 'reported', range: { low: 90, high: 110 }, sourceRefs: ['source:management'] }] })
  assert.equal(range.pairs.find((item) => item.pairId === 'consensus_vs_management')?.relationship, 'inside_range')
})

test('expectation gap excludes post-as-of surfaces and rejects untraceable own research', () => {
  const future = analyzeExpectationGap({ asOf: '2026-09-21T00:00:00.000Z', surfaces: [{ ...surface('consensus', 100), publishedAt: '2026-09-22T00:00:00.000Z' }, surface('own_research', 90)] })
  assert.match(future.diagnostics.join(','), /POST_ASOF/)
  const untraceable = analyzeExpectationGap({ asOf: '2026-09-21T00:00:00.000Z', surfaces: [{ surface: 'own_research', metric: 'revenue', period: 'FY2027', unit: 'CNY', basis: 'reported', value: 90, sourceRefs: [] }] })
  assert.match(untraceable.diagnostics.join(','), /TRACEABILITY_MISSING/)
})

test('catalyst map requires proposition linkage and attributable timing', () => {
  const result = mapCatalysts({ thesisRef: 'thesis:demo', propositionRefs: ['p-demand'], expectationGapRefs: ['gap:1'], asOf: '2026-09-21T00:00:00.000Z', catalysts: [{ catalystId: 'earnings-1', eventType: 'earnings', description: 'FY2027 earnings release', targetPropositionRefs: ['p-demand'], targetExpectationGapRefs: ['gap:1'], eventDate: '2026-10-30', status: 'scheduled', observable: 'reported revenue', resolutionMechanism: 'reported revenue updates the earnings expectation gap', sourceRefs: ['source:calendar'] }] })
  assert.equal(result.status, 'complete')
  assert.equal(result.catalysts[0]?.status, 'scheduled')
  assert.deepEqual(result.catalysts[0]?.targetExpectationGapRefs, ['gap:1'])
  assert.match(result.catalysts[0]?.resolutionMechanism ?? '', /expectation gap/)
  const invalid = mapCatalysts({ thesisRef: 'thesis:demo', propositionRefs: ['p-demand'], asOf: '2026-09-21T00:00:00.000Z', catalysts: [{ catalystId: 'bad', eventType: 'product_launch', description: 'unsupported date', targetPropositionRefs: ['missing'], eventDate: '2027-01-01', status: 'scheduled', observable: 'launch', sourceRefs: [] }] })
  assert.equal(invalid.status, 'unavailable')
})

test('thesis refresh changes only affected propositions and rejects future evidence', () => {
  const prior = { thesisId: 'thesis:demo', priorAsOf: '2026-09-01T00:00:00.000Z', propositions: [{ propositionId: 'p-demand', statement: 'Demand grows.', status: 'active' }, { propositionId: 'p-margin', statement: 'Margins expand.', status: 'active' }] }
  const result = refreshThesis({ priorSnapshot: prior, currentAsOf: '2026-09-21T00:00:00.000Z', evidence: [{ evidenceId: 'e1', publishedAt: '2026-09-10T00:00:00.000Z', relation: 'supports', targetPropositionRefs: ['p-demand'], sourceRefs: ['source:e1'], basis: 'verified_evidence' }, { evidenceId: 'future', publishedAt: '2026-09-22T00:00:00.000Z', relation: 'contradicts', targetPropositionRefs: ['p-margin'], sourceRefs: ['source:future'], basis: 'verified_evidence' }] })
  assert.equal(result.propositionDeltas[0]?.candidateStatus, 'strengthened')
  assert.deepEqual(result.unchangedPropositionRefs, ['p-margin'])
  assert.match(result.diagnostics.join(','), /future_evidence_rejected/)
})

test('thesis refresh requires a prior snapshot and evaluates sourced kill criteria deterministically', () => {
  const blocked = refreshThesis({ currentAsOf: '2026-09-21T00:00:00.000Z', evidence: [] })
  assert.equal(blocked.status, 'blocked')
  const result = refreshThesis({ priorSnapshot: { thesisId: 'thesis:demo', priorAsOf: '2026-09-01T00:00:00.000Z', propositions: [{ propositionId: 'p-demand', statement: 'Demand grows.' }] }, currentAsOf: '2026-09-21T00:00:00.000Z', evidence: [{ evidenceId: 'e1', publishedAt: '2026-09-10T00:00:00.000Z', relation: 'contradicts', targetPropositionRefs: ['p-demand'], sourceRefs: ['source:e1'], basis: 'verified_evidence', metric: 'revenue_growth', period: 'FY2027', value: -0.2 }], killCriteria: [{ conditionId: 'kill-demand', targetPropositionRefs: ['p-demand'], observableMetric: 'revenue_growth', operator: 'lt', threshold: 0, period: 'FY2027', thresholdSourceRefs: ['source:threshold'] }] })
  assert.equal(result.killCriterionAssessments[0]?.status, 'met')
  assert.equal(result.candidateTransition, 'invalidation_condition_met')
})

test('thesis refresh keeps a sourced kill criterion not_met when the observation stays above threshold', () => {
  const result = refreshThesis({ priorSnapshot: { thesisId: 'thesis:demo', priorAsOf: '2026-09-01T00:00:00.000Z', propositions: [{ propositionId: 'p-demand', statement: 'Demand grows.' }] }, currentAsOf: '2026-09-21T00:00:00.000Z', evidence: [{ evidenceId: 'e1', publishedAt: '2026-09-10T00:00:00.000Z', relation: 'context', targetPropositionRefs: ['p-demand'], sourceRefs: ['source:e1'], basis: 'verified_evidence', metric: 'revenue_growth', period: 'FY2027', value: 0.2 }], killCriteria: [{ conditionId: 'kill-demand', targetPropositionRefs: ['p-demand'], observableMetric: 'revenue_growth', operator: 'lt', threshold: 0, period: 'FY2027', thresholdSourceRefs: ['source:threshold'] }] })
  assert.equal(result.killCriterionAssessments[0]?.status, 'not_met')
  assert.equal(result.candidateTransition, 'unchanged')
})

test('red-team fragility is categorical and kill criteria require threshold provenance', () => {
  const projection = { targetThesisRef: 'claim:thesis', companyRef: 'entity:company', claims: [{ canonicalRef: 'claim:assumption', claimType: 'assumption', statement: 'Demand grows.', dependsOnClaimRefs: [], supportsClaimRefs: [], sourceRefs: ['source:1'], confidence: 0.4 }], directDependencyRefs: [], incomingDependencyRefs: [], criticalAssumptions: [{ canonicalRef: 'claim:assumption', claimType: 'assumption', statement: 'Demand grows.', dependsOnClaimRefs: [], supportsClaimRefs: [], sourceRefs: ['source:1'], confidence: 0.4 }], risks: [], catalysts: [], supportingClaims: [], contradictingClaims: [], truncated: false }
  assert.equal(assessThesisFragility(projection)[0]?.level, 'low')
  assert.equal(evaluateThesisKillCriterion({ conditionId: 'k', statement: 'growth fails', severity: 'high', targetExistingClaimRefs: ['claim:assumption'] }, []).status, 'threshold_pending_evidence')
})

test('Wave 4 Skills expose honest semantic or deterministic runtime classifications', () => {
  const registry = createResearchSkillRegistry()
  for (const id of ['thesis_formalize', 'catalyst_map', 'thesis_refresh']) {
    assert.equal(registry.get(id)?.executionClass, 'SEMANTIC_EXECUTABLE', id)
    assert.equal(registry.get(id)?.runtimeExecutor, undefined, id)
    assert.equal(registry.get(id)?.catalogStatus, 'IMPLEMENTED')
  }
  assert.equal(typeof registry.get('expectation_gap')?.runtimeExecutor, 'function')
  const counts = CANONICAL_RESEARCH_SKILL_CATALOG.reduce<Record<string, number>>((out, item) => { out[item.status] = (out[item.status] ?? 0) + 1; return out }, {})
  assert.deepEqual({ IMPLEMENTED: counts.IMPLEMENTED ?? 0, PARTIAL: counts.PARTIAL ?? 0, PLANNED: counts.PLANNED ?? 0 }, { IMPLEMENTED: 26, PARTIAL: 0, PLANNED: 4 })
  assert.equal(registry.get('thesis_refresh')?.runtimeBinding?.includes('executeThesisRefresh'), true)
})

test('thesis lifecycle CREATE composes peer Skills without Skill-to-Skill invocation', () => {
  const result = runThesisLifecycle({
    mode: 'CREATE',
    formalization: { thesisId: 'thesis:lifecycle', summary: 'Demand supports earnings.', propositions: basePropositions },
    expectationGap: { asOf: '2026-09-21T00:00:00.000Z', surfaces: [surface('consensus', 100), surface('own_research', 120)] },
    catalystMap: { thesisRef: 'thesis:lifecycle', propositionRefs: ['p-demand'], asOf: '2026-09-21T00:00:00.000Z', catalysts: [{ catalystId: 'earnings-1', eventType: 'earnings', description: 'FY2027 earnings release', targetPropositionRefs: ['p-demand'], eventDate: '2026-10-30', status: 'scheduled', observable: 'reported revenue', sourceRefs: ['source:calendar'] }] },
    redTeamResult: { status: 'completed', fragilityAssessments: [{ assumptionRef: 'p-demand', level: 'critical', downstreamClaimCount: 2, evidenceStrength: 'low', rationale: 'load-bearing and weakly evidenced' }], invalidationConditions: [{ conditionId: 'kill-demand' }] },
  })
  assert.equal(result.status, 'completed')
  assert.deepEqual(result.steps.map((step) => step.skillId), ['thesis_formalize', 'expectation_gap', 'thesis_red_team', 'catalyst_map'])
  assert.equal(result.catalystMap?.catalysts[0]?.status, 'scheduled')
  assert.equal((result.steps.find((step) => step.skillId === 'thesis_red_team')?.result as { invalidationConditions?: readonly { conditionId: string }[] }).invalidationConditions?.[0]?.conditionId, 'kill-demand')
})

test('thesis lifecycle REFRESH preserves irrelevant propositions and surfaces a sourced kill event', () => {
  const result = runThesisLifecycle({
    mode: 'REFRESH',
    refresh: {
      priorSnapshot: { thesisId: 'thesis:lifecycle', priorAsOf: '2026-09-01T00:00:00.000Z', propositions: [{ propositionId: 'p-demand', statement: 'Demand grows.', status: 'active' }, { propositionId: 'p-margin', statement: 'Margins expand.', status: 'active' }] },
      currentAsOf: '2026-09-21T00:00:00.000Z',
      evidence: [
        { evidenceId: 'e-irrelevant', publishedAt: '2026-09-10T00:00:00.000Z', relation: 'irrelevant', targetPropositionRefs: ['p-margin'], sourceRefs: ['source:context'], basis: 'verified_evidence' },
        { evidenceId: 'e-kill', publishedAt: '2026-09-12T00:00:00.000Z', relation: 'contradicts', targetPropositionRefs: ['p-demand'], sourceRefs: ['source:actuals'], basis: 'verified_evidence', metric: 'revenue_growth', period: 'FY2027', value: -0.2 },
      ],
      killCriteria: [{ conditionId: 'kill-demand', targetPropositionRefs: ['p-demand'], observableMetric: 'revenue_growth', operator: 'lt', threshold: 0, period: 'FY2027', thresholdSourceRefs: ['source:threshold'] }],
    },
    redTeamResult: { status: 'completed', fragilityAssessments: [] },
  })
  assert.equal(result.status, 'completed')
  assert.equal(result.refresh?.candidateTransition, 'invalidation_condition_met')
  assert.deepEqual(result.refresh?.unchangedPropositionRefs, ['p-margin'])
  assert.equal(result.refresh?.propositionDeltas.length, 1)
})

test('thesis lifecycle REFRESH applies expectation-gap evidence before targeted refresh and does not create a false catalyst', () => {
  const result = runThesisLifecycle({
    mode: 'REFRESH',
    expectationGap: { asOf: '2026-09-21T00:00:00.000Z', surfaces: [surface('consensus', 100), surface('own_research', 125)] },
    refresh: { priorSnapshot: { thesisId: 'thesis:lifecycle', priorAsOf: '2026-09-01T00:00:00.000Z', propositions: [{ propositionId: 'p-demand', statement: 'Demand grows.', status: 'active' }] }, currentAsOf: '2026-09-21T00:00:00.000Z', evidence: [{ evidenceId: 'e-actual', publishedAt: '2026-09-10T00:00:00.000Z', relation: 'supports', targetPropositionRefs: ['p-demand'], sourceRefs: ['source:actual'], basis: 'verified_evidence', metric: 'revenue', period: 'FY2027', value: 110 }, { evidenceId: 'e-guidance', publishedAt: '2026-09-11T00:00:00.000Z', relation: 'supports', targetPropositionRefs: ['p-demand'], sourceRefs: ['source:guidance'], basis: 'verified_evidence', metric: 'revenue', period: 'FY2027', value: 120 }, { evidenceId: 'e-consensus-revision', publishedAt: '2026-09-12T00:00:00.000Z', relation: 'context', targetPropositionRefs: ['p-demand'], sourceRefs: ['source:consensus-revision'], basis: 'verified_evidence', metric: 'revenue', period: 'FY2027', value: 100 }] },
  })
  assert.equal(result.status, 'completed')
  assert.deepEqual(result.steps.map((step) => step.skillId), ['expectation_gap', 'thesis_red_team', 'thesis_refresh', 'catalyst_map'])
  assert.equal(result.expectationGap?.gapPropositions.length, 1)
  assert.equal(result.refresh?.propositionDeltas[0]?.candidateStatus, 'strengthened')
  assert.equal(result.catalystMap, undefined)
})
