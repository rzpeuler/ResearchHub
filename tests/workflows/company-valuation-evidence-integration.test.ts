import assert from 'node:assert/strict'
import test from 'node:test'
import type { CompanyReadOnlyAcquisition } from '../../workflows/company-deep-research/contracts.ts'
import { buildCompanyValuationSections, extractFilingBasicEps } from '../../workflows/company-deep-research/valuation-sections.ts'
import { assembleCompanyResearch, buildSynthesisEvidenceLedger } from '../../workflows/company-deep-research/assembly.ts'
import type { CompanyResearchMethodResult } from '../../skills/company-research/methods.ts'
import type { ReasoningExecutor, ReasoningRequest } from '../../plugins/reasoning/contracts.ts'
import type { NormalizedResearchSource } from '../../plugins/research-acquisition/contracts.ts'
import type { ResolvedDataItem } from '../../data/resolver.ts'
import type { ValuationDataPayload } from '../../plugins/research-acquisition/valuation-data.ts'
import { sha256 } from '../../plugins/research-acquisition/hash.ts'
import { dailyCloseAvailableAt } from '../../data/point-in-time.ts'

const asOf = '2026-10-27T20:19:59.628Z'
const quoteDate = '2026-10-27'
const closeAt = dailyCloseAvailableAt(quoteDate)

function upstreamQuoteItem(options: { retrievedAt?: string; withFixtureVersion?: boolean; availableAt?: string }): ResolvedDataItem<ValuationDataPayload> {
  const retrievedAt = options.retrievedAt ?? asOf
  const version = options.withFixtureVersion
    ? { status: 'VERIFIED' as const, versionId: 'FIXTURE_ONLY:market-version-002594-20261027', availableAt: options.availableAt ?? closeAt }
    : undefined
  const sourceUrl = 'https://gu.qq.com/sz002594/zs'
  const freshness = { status: 'FRESH' as const, priceDate: quoteDate, analysisAsOf: asOf, completedSessionDates: [], maximumMissedSessions: 1 as const, calendarSource: 'AKSHARE_SINA' as const }
  const payload: ValuationDataPayload = {
    kind: 'market', raw: { fixture: 'upstream acquisition payload' },
    observation: { priceDate: quoteDate, close: 82.01 }, symbol: '002594', exchange: 'SZ', currency: 'CNY',
    adjustmentMethod: 'UNADJUSTED', sourceId: 'akshare-tencent-historical-market-data',
    originPublisher: 'Tencent', retrievalProvider: 'AKShare', sourceUrl,
    retrievedAt, observationAvailableAt: closeAt, marketFreshness: freshness,
  }
  const source = {
    sourceId: 'akshare-tencent-historical-market-data', fallbackLevel: 'PRIMARY', originPublisher: 'Tencent',
    originAuthority: 'S3_AGGREGATOR', retrievalProvider: 'AKShare', sourceUrl,
    retrievedAt, observedAt: quoteDate, observationAvailableAt: closeAt,
    ...(version ? { valueVersion: version } : {}), marketFreshness: freshness,
  } as const
  return {
    requirementId: 'fixture:valuation_market_price', dataKind: 'metric', metricId: 'valuation_market_price',
    analysisAsOf: asOf, status: 'AVAILABLE', value: payload, source, required: false,
    quality: { pointInTimeSafe: true, complete: true, crossChecked: false, ...(version ? { valueVersionStatus: 'VERIFIED' as const } : {}) },
    attempts: [], acquisition: {
      requirementId: 'fixture:valuation_market_price', status: 'AVAILABLE', data: payload, source,
      quality: { pointInTimeSafe: true, complete: true, crossChecked: false, ...(version ? { valueVersionStatus: 'VERIFIED' as const } : {}) },
      attempts: [],
    },
  } as ResolvedDataItem<ValuationDataPayload>
}

const filingText = [
  '1、主要会计数据和财务指标',
  '2025年 2024年 本年比上年增减',
  '基本每股收益（元/股） 3.58 4.61 -22.34%',
].join('\n')
const filing: NormalizedResearchSource = {
  candidate: { candidateId: 'fixture-annual-2025', kind: 'official_disclosure', tier: 1, title: '2025年年度报告', provider: 'fixture', publishedAt: '2026-03-27T16:00:00.000Z' },
  title: '2025年年度报告', content: filingText, contentHash: sha256(filingText), retrievedAt: asOf,
  publisher: 'Issuer', rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false },
}

function productionValuation(options: { retrievedAt?: string; withFixtureVersion?: boolean; asOfMode?: 'HISTORICAL' | 'CURRENT_VALUE_ONLY' }) {
  const upstreamItem = upstreamQuoteItem(options)
  const acquisition = {
    expectationTargetFiscalYear: 2026, valuationBasisFiscalYear: 2025,
    valuationRequirements: [], valuationItems: [upstreamItem], earningsExpectationRequirements: [], earningsExpectationItems: [],
  } as unknown as CompanyReadOnlyAcquisition
  const result = buildCompanyValuationSections({
    company: { symbol: '002594', name: '比亚迪' }, asOf, asOfMode: options.asOfMode ?? 'HISTORICAL',
    acquisition, sources: [filing],
  })
  const market = result.evidenceSources.find(source => source.candidate.metadata?.dataProvenance
    && (source.candidate.metadata.dataProvenance as Record<string, unknown>).metricId === 'valuation_market_price')
  return { result, market }
}

const method: CompanyResearchMethodResult = {
  skillId: 'company_history_strategy', status: 'complete', answer: '年报事实。', markdown: '年报事实 [fixture-annual-2025@paragraph:1]',
  sections: [{ id: 'company-overview', markdown: '年报事实 [fixture-annual-2025@paragraph:1]' }],
  findings: [{ text: '年报事实。', kind: 'fact', evidence: [{ sourceCandidateId: 'fixture-annual-2025', location: 'paragraph:1' }] }],
  limitations: [], risks: [], sourceCandidateIds: ['fixture-annual-2025'], diagnostics: [], attempts: 1,
  executionEvidence: [{ sourceCandidateId: 'fixture-annual-2025', title: 'annual fixture', publisher: 'Issuer', excerpts: [{ sourceCandidateId: 'fixture-annual-2025', location: 'paragraph:1', text: filingText.split('\n')[0]! }] }],
}

test('INT-01: production builder carries fixture-only PIT but the quote remains rights-unqualified and blocked', () => {
  const { result, market } = productionValuation({ withFixtureVersion: true })
  assert.ok(market, 'production valuation builder must produce its source from the upstream resolved item')
  assert.equal(market.rights.accessScope, 'unknown')
  assert.equal(market.rights.providerTermsKnown, false)
  assert.equal(market.rights.retentionAllowed, false)
  assert.match(market.content, /FIXTURE_ONLY:market-version/)
  const ref = `${market.candidate.candidateId}@paragraph:1`
  const ledger = buildSynthesisEvidenceLedger({
    methods: [], sources: [filing, market], asOf, allowedSourceCandidateIds: [filing.candidate.candidateId, market.candidate.candidateId],
    workflowOwnedSections: result.sections,
  })
  assert.ok(ledger.some(entry => entry.ownerWorkflow === 'valuation' && entry.eligibility === 'blocked'
    && entry.blockers?.includes('WORKFLOW_MARKET_PRICE_PIT_OR_VALUE_VERSION_UNVERIFIED')))
  assert.ok(ledger.every(entry => !entry.evidence.some(evidence => evidence.sourceCandidateId === market.candidate.candidateId)))
  assert.equal(ref, `${market.candidate.candidateId}@paragraph:1`)
})

test('INT-02: current-only late quote is produced as a reference but excluded from synthesis citations and evidence', async () => {
  const lateRetrieval = '2026-10-28T01:00:00.000Z'
  const { result, market } = productionValuation({ retrievedAt: lateRetrieval, asOfMode: 'CURRENT_VALUE_ONLY' })
  assert.ok(market)
  assert.match(result.sections[0]!.markdown, /CURRENT_VALUE_ONLY/)
  assert.equal(market.retrievedAt, lateRetrieval)
  const marketRef = `${market.candidate.candidateId}@paragraph:1`
  let request: ReasoningRequest | undefined
  const executor: ReasoningExecutor = {
    capabilities: () => ({ maxContextTokens: 10000, maxOutputTokens: 1000, structuredOutputSupport: true, maxConcurrency: 1 }),
    execute: async value => { request = value; return { operation: value.operation, output: {} } },
  }
  await assembleCompanyResearch({
    company: { symbol: '002594', name: '比亚迪', exchange: 'SZ' }, asOf, sources: [filing, market],
    reportSourceCandidateIds: [filing.candidate.candidateId, market.candidate.candidateId],
  }, [method], executor, () => asOf, 1, {}, result.sections)
  assert.ok(request)
  const payload = request!.input as { allowedCitations: string[]; allowedEvidence: { sourceCandidateId: string; location: string }[] }
  assert.ok(!payload.allowedCitations.includes(marketRef))
  assert.ok(!payload.allowedEvidence.some(item => `${item.sourceCandidateId}@${item.location}` === marketRef))
})

test('INT-03: historical builder rejects missing version and retrieval before exchange close availability', () => {
  const missingVersion = productionValuation({ withFixtureVersion: false })
  assert.equal(missingVersion.market, undefined)
  assert.ok(missingVersion.result.diagnostics.includes('VALUATION_MARKET_PRICE_VALUE_VERSION_UNVERIFIED_AT_ASOF'))

  const earlyRetrieval = productionValuation({ withFixtureVersion: true, retrievedAt: '2026-10-27T06:59:59.000Z' })
  assert.equal(earlyRetrieval.market, undefined)
  assert.ok(earlyRetrieval.result.diagnostics.includes('VALUATION_MARKET_CLOSE_NOT_PIT_SAFE'))
})

test('INT-04: an ordinary method cannot smuggle the production quote locator into the synthesis handoff', async () => {
  const { market } = productionValuation({ withFixtureVersion: true })
  assert.ok(market)
  const quoteRef = `${market.candidate.candidateId}@paragraph:1`
  const methodWithQuote: CompanyResearchMethodResult = {
    ...method, markdown: `历史 PE 82.01 [${quoteRef}]`, sourceCandidateIds: [market.candidate.candidateId],
    findings: [{ text: '历史 PE 82.01。', kind: 'inference', evidence: [{ sourceCandidateId: market.candidate.candidateId, location: 'paragraph:1' }] }],
    executionEvidence: [{ sourceCandidateId: market.candidate.candidateId, title: 'quote', publisher: 'AKShare', excerpts: [{ sourceCandidateId: market.candidate.candidateId, location: 'paragraph:1', text: market.content }] }],
  }
  let request: ReasoningRequest | undefined
  const executor: ReasoningExecutor = {
    capabilities: () => ({ maxContextTokens: 10000, maxOutputTokens: 1000, structuredOutputSupport: true, maxConcurrency: 1 }),
    execute: async value => { request = value; return { operation: value.operation, output: {} } },
  }
  await assembleCompanyResearch({
    company: { symbol: '002594', name: '比亚迪', exchange: 'SZ' }, asOf, sources: [filing, market],
    reportSourceCandidateIds: [filing.candidate.candidateId, market.candidate.candidateId],
  }, [methodWithQuote], executor, () => asOf, 1)
  const payload = request!.input as { allowedCitations: string[]; allowedEvidence: { sourceCandidateId: string; location: string }[] }
  assert.ok(!payload.allowedCitations.includes(quoteRef))
  assert.ok(!payload.allowedEvidence.some(item => `${item.sourceCandidateId}@${item.location}` === quoteRef))
})

test('INT-05: an exact annual-report basic EPS row qualifies while a matching dividend amount does not', () => {
  const content = `${filingText}\n每股股利 3.58 元`
  const source = { ...filing, content, contentHash: sha256(content) }
  const extracted = extractFilingBasicEps([source], 2025, asOf)
  assert.equal(extracted?.value, 3.58)
  assert.equal(extracted?.location, 'paragraph:3')
  assert.match(extracted?.rowText ?? '', /^基本每股收益/)
  assert.doesNotMatch(extracted?.rowText ?? '', /每股股利/)
})

test('INT-06: unrelated direct filing evidence remains available while the market source is blocked', async () => {
  const { market } = productionValuation({ withFixtureVersion: true })
  assert.ok(market)
  let request: ReasoningRequest | undefined
  const executor: ReasoningExecutor = {
    capabilities: () => ({ maxContextTokens: 10000, maxOutputTokens: 1000, structuredOutputSupport: true, maxConcurrency: 1 }),
    execute: async value => { request = value; return { operation: value.operation, output: {} } },
  }
  await assembleCompanyResearch({
    company: { symbol: '002594', name: '比亚迪', exchange: 'SZ' }, asOf, sources: [filing, market],
    reportSourceCandidateIds: [filing.candidate.candidateId, market.candidate.candidateId],
  }, [method], executor, () => asOf, 1)
  const payload = request!.input as { allowedCitations: string[]; allowedEvidence: { sourceCandidateId: string; location: string }[] }
  assert.ok(payload.allowedCitations.includes('fixture-annual-2025@paragraph:1'))
  assert.ok(payload.allowedEvidence.some(item => item.sourceCandidateId === 'fixture-annual-2025' && item.location === 'paragraph:1'))
  assert.ok(!payload.allowedCitations.some(item => item.startsWith(`${market.candidate.candidateId}@`)))
  assert.deepEqual(resultSectionIds(productionValuation({ withFixtureVersion: true }).result), ['valuation', 'bull-base-bear', 'variant-perception'])
})

function resultSectionIds(result: ReturnType<typeof buildCompanyValuationSections>): string[] {
  return result.sections.map(section => section.id)
}
