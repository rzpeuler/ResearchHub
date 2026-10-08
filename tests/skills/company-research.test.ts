import assert from 'node:assert/strict'
import test from 'node:test'
import { CompanyResearchSkill, relativeValuation, scenarioValuation } from '../../skills/company-research/index.ts'
import type { NormalizedResearchSource } from '../../plugins/research-acquisition/contracts.ts'

const source: NormalizedResearchSource = { candidate: { candidateId: 'fixture-1', kind: 'official_disclosure', tier: 1, title: 'Annual report', provider: 'cninfo', metadata: { companySymbol: '600519' } }, retrievedAt: '2026-09-08T00:00:00.000Z', title: 'Annual report', content: 'Revenue and profit drivers for the company.', contentHash: 'a'.repeat(64), canonicalUrl: 'https://example.com/report', publisher: 'cninfo', rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false } }
test('Company Research Skill emits all required sections without arbitrary fallback facts', () => { const result = new CompanyResearchSkill(() => '2026-09-08T00:00:00.000Z').run({ company: { symbol: '600519', name: 'Fixture Co' }, asOf: '2026-09-08T00:00:00.000Z', sources: [source] }); assert.equal(result.sections.length, 19); assert.equal(result.proposals[0]?.kind, 'entity'); assert.equal(result.proposals.filter((proposal) => proposal.kind === 'claim').length, 0) })
test('Company Research without a verified metric fails closed and keeps the 19-section contract', () => {
  const result = new CompanyResearchSkill(() => '2026-09-08T00:00:00.000Z').run({ company: { symbol: '600519', name: 'Fixture Co' }, asOf: '2026-09-08T00:00:00.000Z', sources: [source] })
  const valuation = result.valuation as { readonly status: string; readonly missingFields: readonly string[]; readonly note: string; readonly result?: unknown }
  assert.equal(result.sections.length, 19)
  assert.equal(valuation.status, 'insufficient_data')
  assert.ok(valuation.missingFields.includes('verified earnings metric'))
  assert.ok(valuation.missingFields.includes('attributable peer valuation inputs'))
  assert.equal('result' in valuation, false)
  assert.match(valuation.note, /no implied relative valuation is produced without attributable peer data/i)
})
test('Company Research with a verified metric still requires attributable peer inputs', () => {
  const result = new CompanyResearchSkill(() => '2026-09-08T00:00:00.000Z').run({ company: { symbol: '600519', name: 'Fixture Co' }, asOf: '2026-09-08T00:00:00.000Z', sources: [source], financialData: [{ metrics: { metric: 10 }, pointInTimeSafe: false }] })
  const valuation = result.valuation as { readonly status: string; readonly missingFields: readonly string[]; readonly note: string; readonly result?: unknown }
  assert.equal(valuation.status, 'insufficient_data')
  assert.deepEqual(valuation.missingFields, ['attributable peer valuation inputs'])
  assert.equal('result' in valuation, false)
  assert.doesNotMatch(JSON.stringify(result), /10,12,15/)
  assert.match(valuation.note, /no implied relative valuation is produced without attributable peer data/i)
})
test('valuation utilities are deterministic and probability-weighted', () => { assert.deepEqual(relativeValuation({ metric: 10, peerMultiples: [20, 10, 15] }), { multiple: 15, impliedValue: 150, peerCount: 3 }); assert.equal(scenarioValuation([{ name: 'bull', earnings: 2, multiple: 10, probability: 0.5 }, { name: 'bear', earnings: 1, multiple: 10, probability: 0.5 }]).expectedValue, 15) })
