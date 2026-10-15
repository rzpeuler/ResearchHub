import type { SourceCandidate, SourcePolicy } from './contracts.ts'

function candidate(metricId: string, sourceId: string, operationId: string, kind: 'evidence' | 'timeseries', authority: SourceCandidate['originAuthority'], originPublisher?: string): SourceCandidate {
  return { sourceId, fallbackLevel: 'PRIMARY', originAuthority: authority, ...(originPublisher ? { originPublisher } : {}), operationId, supports: { dataKinds: [kind], metricIds: [metricId] } }
}

const companyWorkflow = 'company-deep-research'
const companySource = (metricId: string, kind: 'evidence' | 'timeseries', operationId: string): SourcePolicy => ({
  policyId: `company-${metricId}-akshare`, requirementMatch: { workflow: companyWorkflow, dataKind: kind, metricId }, selectionMode: 'FIRST_VALID',
  candidates: [candidate(metricId, `akshare-${metricId}`, operationId, kind, 'S3_AGGREGATOR'), ...(metricId === 'company_market_history' ? [{ ...candidate(metricId, 'tencent-company-market-history', 'akshare.historicalMarketDataTencent', kind, 'S3_AGGREGATOR', 'Tencent'), fallbackLevel: 'FALLBACK_1' as const }] : metricId === 'company_financial_history' ? [{ ...candidate(metricId, 'akshare-company-statements', 'akshare.financialStatements', kind, 'S3_AGGREGATOR', 'EastMoney'), fallbackLevel: 'FALLBACK_1' as const }] : [])],
})

const evidenceId = 'company_research_evidence'
const evidenceCandidates: readonly SourceCandidate[] = [
  candidate(evidenceId, 'cninfo-company-research-evidence', 'cninfo.discoverFetchNormalizeCompanyEvidence', 'evidence', 'S0_STATUTORY', 'CNINFO'),
  candidate(evidenceId, 'gdelt-company-research-evidence', 'gdelt.discoverFetchNormalizeCompanyEvidence', 'evidence', 'S3_AGGREGATOR'),
]

/** Optional public-body route; enabled explicitly by the company acquisition composition. */
export const COMPANY_PUBLIC_WEB_CANDIDATE: SourceCandidate = candidate(evidenceId, 'public-web-company-research-evidence', 'publicWeb.discoverFetchNormalizeCompanyEvidence', 'evidence', 'S3_AGGREGATOR')
export const COMPANY_OFFICIAL_FINANCIAL_CANDIDATE: SourceCandidate = { ...candidate('company_financial_history', 'cninfo-company-financial-history', 'cninfo.companyFinancialHistory', 'evidence', 'S0_STATUTORY', 'CNINFO'), fallbackLevel: 'FALLBACK_2' }

/** Exact source routes shared by Company, Event, and Thesis. Every evidence route is attempted. */
export const PHASE3_COMMON_SOURCE_POLICIES: readonly SourcePolicy[] = [
  companySource('company_basic_profile', 'evidence', 'akshare.companyBasic'),
  companySource('company_financial_history', 'evidence', 'akshare.financialData'),
  companySource('company_market_history', 'timeseries', 'akshare.historicalMarketData'),
  ...['company-deep-research', 'event-research', 'thesis-red-team'].map((workflow) => ({
    policyId: `company-research-evidence-${workflow}`, requirementMatch: { workflow, dataKind: 'evidence' as const, metricId: evidenceId },
    selectionMode: 'COLLECT_DIVERSE' as const, candidates: evidenceCandidates,
  })),
]
