import test from 'node:test'
import assert from 'node:assert/strict'
import { sha256 } from '../../plugins/research-acquisition/hash.ts'
import type { NormalizedResearchSource } from '../../plugins/research-acquisition/contracts.ts'
import type { EastmoneyReportAcquisitionResult, EastmoneyResearchReportRecord } from '../../plugins/research-acquisition/expectations/contracts.ts'
import { projectEastmoneyEstimatePoints } from '../../workflows/earnings-review/expectation-source-eastmoney.ts'

function source(infoCode: string): NormalizedResearchSource {
  const candidateId = `eastmoney-report-${sha256(infoCode)}`
  return { candidate: { candidateId, kind: 'structured_data', tier: 3, title: infoCode, provider: 'eastmoney-reportapi', publishedAt: '2026-08-20T02:30:00.000Z', metadata: { providerObjectId: infoCode } }, retrievedAt: '2026-09-20T00:00:00.000Z', title: infoCode, content: infoCode, contentHash: sha256(infoCode), publisher: 'Eastmoney Research Reports', rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false } }
}

function report(infoCode: string, orgCode: string, forecasts = [{ fiscalYear: 2026, value: 10, providerField: 'predictThisYearEps' as const }, { fiscalYear: 2027, value: 11, providerField: 'predictNextYearEps' as const }, { fiscalYear: 2028, value: 12, providerField: 'predictNextTwoYearEps' as const }]): EastmoneyResearchReportRecord {
  return { infoCode, stockCode: '600519', stockName: '贵州茅台', title: infoCode, orgCode, orgShortName: orgCode, publishDateRaw: '2026-08-20 10:30:00', publishedAt: '2026-08-20T02:30:00.000Z', timestampPrecision: 'datetime', forecastBaseYear: 2026, epsForecasts: forecasts }
}

function acquisition(records: readonly EastmoneyResearchReportRecord[], sources = records.map((item) => source(item.infoCode))): EastmoneyReportAcquisitionResult {
  return { records, sources, diagnostics: [], providerOutcome: { provider: 'eastmoney-reportapi', providerAttempted: true, providerSucceeded: true, providerEmpty: false, providerFailed: false, usableSourceCount: sources.length }, forecastBaseYear: 2026, truncated: false }
}

test('projection maps the requested annual EPS horizon into validated EstimatePoints', () => {
  const result = projectEastmoneyEstimatePoints({ acquisition: acquisition([report('r1', '1001')]), targetFiscalYear: 2027 })
  assert.equal(result.estimates.length, 1)
  assert.deepEqual(result.estimates[0], { estimateId: `eastmoney-estimate-${sha256('r1|eps|2027')}`, metric: 'eps', fiscalPeriod: '2027-FY', value: 11, unit: 'CNY_per_share', institutionKey: 'eastmoney-org:1001', publishedAt: '2026-08-20T02:30:00.000Z', sourceCandidateIds: [`eastmoney-report-${sha256('r1')}`] })
  assert.deepEqual(result.institutions, [{ institutionKey: 'eastmoney-org:1001', name: '1001', providerCode: '1001' }])
  assert.deepEqual(result.diagnostics, [])
})

test('native EastMoney proof fingerprints changed values under the same infoCode and stays UNVERIFIED', () => {
  const first = projectEastmoneyEstimatePoints({ acquisition: acquisition([report('same-code', '1001', [{ fiscalYear: 2026, value: 10, providerField: 'predictThisYearEps' }])]), targetFiscalYear: 2026 })
  const changed = projectEastmoneyEstimatePoints({ acquisition: acquisition([report('same-code', '1001', [{ fiscalYear: 2026, value: 12, providerField: 'predictThisYearEps' }])]), targetFiscalYear: 2026 })
  const firstProof = first.pointProofs?.[0]
  const changedProof = changed.pointProofs?.[0]
  assert.ok(firstProof)
  assert.ok(changedProof)
  assert.equal(firstProof.estimateId, changedProof.estimateId)
  assert.equal(firstProof.sourceCandidateId, first.estimates[0]?.sourceCandidateIds[0])
  assert.equal(firstProof.providerObjectId, 'same-code')
  assert.equal(firstProof.matchedValue, 10)
  assert.notEqual(firstProof.observedRowHash, changedProof.observedRowHash)
  assert.notEqual(firstProof.pointFingerprint, changedProof.pointFingerprint)
  assert.equal(firstProof.basisStatus, 'UNVERIFIED')
  assert.equal(firstProof.valueVersionStatus, 'UNVERIFIED')
  assert.equal(firstProof.correctionStatus, 'UNVERIFIED')
})

test('projection is input-order independent and preserves distinct institutions', () => {
  const first = projectEastmoneyEstimatePoints({ acquisition: acquisition([report('b', 'org-b'), report('a', 'org-a')]), targetFiscalYear: 2026 })
  const second = projectEastmoneyEstimatePoints({ acquisition: acquisition([report('a', 'org-a'), report('b', 'org-b')]), targetFiscalYear: 2026 })
  assert.deepEqual(second, first)
  assert.deepEqual(first.estimates.map((item) => item.institutionKey).sort(), ['eastmoney-org:org-a', 'eastmoney-org:org-b'])
})

test('unsupported target fiscal years fail closed without extrapolation', () => {
  const result = projectEastmoneyEstimatePoints({ acquisition: acquisition([report('r1', '1001')]), targetFiscalYear: 2029 })
  assert.deepEqual(result.estimates, [])
  assert.ok(result.diagnostics.includes('eastmoney_unsupported_target_fiscal_year:2029'))
})

test('projection requires the normalized source for every EstimatePoint', () => {
  const result = projectEastmoneyEstimatePoints({ acquisition: acquisition([report('missing', '1001')], []), targetFiscalYear: 2026 })
  assert.deepEqual(result.estimates, [])
  assert.ok(result.diagnostics.includes('eastmoney_source_missing:missing'))
})

test('projection carries acquisition diagnostics, provider outcome, and truncation without persistence or consensus', () => {
  const acquired = acquisition([report('r1', '1001')])
  const input: EastmoneyReportAcquisitionResult = { ...acquired, diagnostics: ['eastmoney_report_pagination_truncated'], truncated: true }
  const result = projectEastmoneyEstimatePoints({ acquisition: input, targetFiscalYear: 2026 })
  assert.equal(result.truncated, true)
  assert.equal(result.providerOutcome.provider, 'eastmoney-reportapi')
  assert.ok(result.diagnostics.includes('eastmoney_report_pagination_truncated'))
})
