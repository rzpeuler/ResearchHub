import assert from 'node:assert/strict'
import test from 'node:test'
import { CANONICAL_RESEARCH_SKILL_CATALOG } from '../../app/services/research-skill-catalog.ts'
import { buildValuationCrosscheck } from '../../workflows/valuation/crosscheck.ts'
import type { ValuationBasis, ValuationAssumptionPlan, ValuationComputation } from '../../skills/valuation/contracts.ts'
import type { CompsValuationResult } from '../../skills/comps_valuation/contracts.ts'
import { runThesisLifecycle } from '../../workflows/thesis-lifecycle/workflow.ts'

const basis: ValuationBasis = {
  valuationDate: '2026-09-21T00:00:00.000Z', priceDate: '2026-09-20', marketPrice: 100, marketPriceUnit: 'CNY/share', basisFiscalYear: 2026, reportDate: '2026-08-30', publicationStatus: 'verified', eps: 5, units: { eps: 'CNY/share' },
}
const plan: ValuationAssumptionPlan = {
  primaryMethod: 'PE', secondaryMethods: ['PB'], targetFiscalYear: 2027,
  scenarios: ['bear', 'base', 'bull'].map((scenarioId) => ({ scenarioId: scenarioId as 'bear' | 'base' | 'bull', primaryMethod: 'PE' as const, targetFiscalYear: 2027, growthRate: 0.1, targetMultiple: 20, rationale: 'bounded', sourceCandidateIds: ['source:valuation'], existingKnowledgeRefs: [] })),
}
const computation: ValuationComputation = {
  basis, eligibility: [{ method: 'PE', eligible: true, reason: 'eps' }], referenceMultiples: { PE: 20 }, scenarios: ['bear', 'base', 'bull'].map((scenarioId) => ({ scenarioId: scenarioId as 'bear' | 'base' | 'bull', primaryMethod: 'PE' as const, targetFiscalYear: 2027, growthRate: 0.1, targetMultiple: 20, forecastMetric: 5.5, targetPrice: 100, impliedReturnPct: 0 })), sensitivity: [], deterministicRecomputeMatched: true, unavailable: [],
}

function comps(period = 'FY2027', value = 120): CompsValuationResult {
  return { asOf: '2026-09-21T00:00:00.000Z', valuationBasis: { kind: 'FY', label: period, fiscalYear: Number(period.slice(2)) }, candidatePeers: [], acceptedPeers: [], rejectedPeers: [], multipleSummaries: [], impliedValuation: { impliedEquityValue: value, valuePerShare: value }, diagnostics: [], sourceRefs: [], availability: 'available', subject: { identity: { companyId: 'subject', ticker: '000001', exchange: 'SZ' }, period: { kind: 'FY', label: period, fiscalYear: Number(period.slice(2)) }, asOf: '2026-09-21T00:00:00.000Z', currency: 'CNY', metricUnits: {}, shareBasis: 'diluted', financials: {} as never } }
}

test('FIX-001 valuation crosscheck consumes scenario and comps outputs without averaging', () => {
  const result = buildValuationCrosscheck({ eligibleMethods: ['PE'], basis, plan, computation, compsResult: comps() })
  assert.deepEqual(result.availableMethods, ['scenario_base', 'comps_valuation'])
  assert.equal(result.methodResults.find((item) => item.method === 'scenario_base')?.value, 100)
  assert.equal(result.methodResults.find((item) => item.method === 'comps_valuation')?.value, 120)
  assert.equal(result.basisCompatibility[0]?.compatible, true)
  assert.equal(result.conflicts[0]?.code, 'VALUATION_METHOD_DISAGREEMENT')
  assert.equal(result.conflicts[0]?.absoluteSpread, 20)
  assert.equal(result.automaticAveraging, false)
})

test('FIX-001 valuation crosscheck reports incompatible comparable basis and unavailable comps explicitly', () => {
  const mismatch = buildValuationCrosscheck({ eligibleMethods: ['PE'], basis, plan, computation, compsResult: comps('FY2028', 120) })
  assert.equal(mismatch.basisCompatibility[0]?.compatible, false)
  assert.equal(mismatch.conflicts[0]?.code, 'BASIS_INCOMPATIBLE')
  const unavailable = buildValuationCrosscheck({ eligibleMethods: ['PE'], basis, plan, computation })
  assert.deepEqual(unavailable.unavailableMethods, ['comps_valuation'])
  assert.match(unavailable.methodResults.find((item) => item.method === 'comps_valuation')?.diagnostics.join(',') ?? '', /COMPS_INPUT_UNAVAILABLE/)
})

test('FIX-001 keeps comps_valuation deterministic and preserves the catalog count', () => {
  assert.equal(CANONICAL_RESEARCH_SKILL_CATALOG.find((item) => item.canonicalSkillId === 'comps_valuation')?.executionClass, 'DETERMINISTIC_EXECUTABLE')
  const counts = CANONICAL_RESEARCH_SKILL_CATALOG.reduce<Record<string, number>>((out, item) => { out[item.status] = (out[item.status] ?? 0) + 1; return out }, {})
  assert.deepEqual(counts, { IMPLEMENTED: 26, PLANNED: 4 })
})

function thesisInput(expectationStatus: 'MATERIAL_GAP' | 'NO_MATERIAL_GAP') {
  return {
    mode: 'CREATE' as const,
    formalization: { thesisId: 'thesis:fix-001', summary: 'Earnings expectation is testable.', propositions: [{ propositionId: 'p-earnings', statement: 'Earnings exceed consensus.', propositionType: 'earnings_expectation' as const, basis: 'inference' as const, timeHorizon: 'near_term', expectationStatus }] },
    expectationGap: { asOf: '2026-09-21T00:00:00.000Z', surfaces: [{ surface: 'consensus' as const, metric: 'eps', period: 'FY2027', unit: 'CNY/share', basis: 'reported', value: 100, sourceRefs: ['source:consensus'] }, { surface: 'own_research' as const, metric: 'eps', period: 'FY2027', unit: 'CNY/share', basis: 'reported', value: 120, sourceRefs: ['source:own'] }] },
  }
}

test('FIX-001 Thesis Lifecycle quality gate consumes expectation and formalization outputs', () => {
  const contradictory = runThesisLifecycle(thesisInput('NO_MATERIAL_GAP'))
  assert.equal(contradictory.status, 'blocked')
  assert.equal(contradictory.qualityGate?.status, 'FAIL')
  assert.ok(contradictory.qualityGate?.diagnostics.some((item) => item.code === 'EXPECTATION_THESIS_CONTRADICTION'))
  const clean = runThesisLifecycle(thesisInput('MATERIAL_GAP'))
  assert.equal(clean.qualityGate?.eligibleForGateway, true)
  assert.equal(clean.status, 'completed')
})
