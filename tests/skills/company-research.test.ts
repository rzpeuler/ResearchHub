import assert from 'node:assert/strict'
import test from 'node:test'
import { CompanyResearchSkill, relativeValuation, scenarioValuation } from '../../skills/company-research/index.ts'
import type { NormalizedResearchSource } from '../../plugins/research-acquisition/contracts.ts'
import type { ReasoningExecutor } from '../../plugins/reasoning/contracts.ts'

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
test('Company Skill receives all structured inputs with their acquisition provenance', async () => {
  let seen: Record<string, unknown> | undefined
  const executor = {
    capabilities: () => ({}),
    execute: async (request: { readonly input: unknown }) => { seen = request.input as Record<string, unknown>; return { operation: 'company_research_synthesis', output: { sections: [{ title: 'Company Overview', markdown: 'Unknown-date context', sourceCandidateIds: ['unknown-context'], proposalIds: ['proposal-1'] }], proposals: [{ proposalId: 'proposal-1', kind: 'claim', subjectKey: 'company', claimType: 'fact', statement: 'Context claim', sourceCandidateIds: ['unknown-context'] }] } } },
  } as unknown as ReasoningExecutor
  const structuredSources = ['company_basic_profile', 'company_financial_history', 'company_market_history'].map((metricId, index) => ({
    ...source,
    candidate: { ...source.candidate, candidateId: `akshare-${index}`, kind: 'structured_data' as const, metadata: { dataProvenance: { metricId, sourceId: `source-${index}`, originAuthority: 'S3_AGGREGATOR', retrievalProvider: 'AKShare', valueVersion: { status: 'UNVERIFIED' } } } },
  }))
  const unknownContext = { ...source, publisher: 'Unknown original publisher', candidate: { ...source.candidate, candidateId: 'unknown-context', provider: 'gdelt', metadata: { dataProvenance: { originAuthority: 'S3_AGGREGATOR', retrievalProvider: 'GDELT', sourceUrl: 'https://example.com/report', publishedAt: '2026-09-07T00:00:00.000Z', dateStatus: 'QUALIFIED', pointInTimeSafe: true } } } }
  const result = await new CompanyResearchSkill(() => '2026-09-08T00:00:00.000Z', executor).synthesize({
    company: { symbol: '600519', name: 'Fixture Co' }, asOf: '2026-09-08T00:00:00.000Z', sources: [...structuredSources, unknownContext],
    durableSourceCandidateIds: structuredSources.map((item) => item.candidate.candidateId),
    profileData: { fields: [{ name: 'name', value: 'Fixture Co' }] },
    financialData: [{ metrics: { metric: 0 }, pointInTimeSafe: false }],
    marketData: [{ observedAt: '2026-09-08', close: 0, pointInTimeSafe: false }],
  })
  assert.deepEqual((seen?.structuredProfileData as { fields: unknown[] }).fields, [{ name: 'name', value: 'Fixture Co' }])
  assert.deepEqual((seen?.structuredFinancialData as Array<{ metrics: { metric: number } }>)[0]?.metrics, { metric: 0 })
  assert.deepEqual((seen?.structuredMarketData as Array<{ close: number }>)[0]?.close, 0)
  const bounded = seen?.boundedSources as Array<{ provider: string; publisher: string; provenance: { metricId?: string; originAuthority?: string; retrievalProvider?: string; dateStatus?: string; pointInTimeSafe?: boolean; retrievedAt?: string; contentHash?: string } | null }>
  assert.deepEqual(bounded.flatMap((item) => item.provenance?.metricId ? [item.provenance.metricId] : []), ['company_basic_profile', 'company_financial_history', 'company_market_history'])
  const external = bounded.find((item) => item.provider === 'gdelt')
  assert.equal(external?.publisher, 'Unknown original publisher')
  assert.deepEqual(external?.provenance, { originAuthority: 'S3_AGGREGATOR', retrievalProvider: 'GDELT', sourceUrl: 'https://example.com/report', publishedAt: '2026-09-07T00:00:00.000Z', retrievedAt: source.retrievedAt, contentHash: source.contentHash, dateStatus: 'QUALIFIED', pointInTimeSafe: true })
  assert.ok(result.contextOnlySourceCandidateIds?.includes('unknown-context'))
  assert.equal(result.sourceCandidateIds.includes('unknown-context'), false)
  assert.equal(result.sections[0]?.sourceCandidateIds.includes('unknown-context'), false)
  assert.deepEqual(result.proposals[0]?.sourceCandidateIds, [])
})
test('valuation utilities are deterministic and probability-weighted', () => { assert.deepEqual(relativeValuation({ metric: 10, peerMultiples: [20, 10, 15] }), { multiple: 15, impliedValue: 150, peerCount: 3 }); assert.equal(scenarioValuation([{ name: 'bull', earnings: 2, multiple: 10, probability: 0.5 }, { name: 'bear', earnings: 1, multiple: 10, probability: 0.5 }]).expectedValue, 15) })
