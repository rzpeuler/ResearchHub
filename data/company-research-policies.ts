import type { SourceCandidate, SourcePolicy } from './contracts.ts'

function candidate(metricId: string, sourceId: string, operationId: string, kind: 'evidence' | 'timeseries', authority: SourceCandidate['originAuthority'], originPublisher?: string): SourceCandidate {
  return { sourceId, fallbackLevel: 'PRIMARY', originAuthority: authority, ...(originPublisher ? { originPublisher } : {}), operationId, supports: { dataKinds: [kind], metricIds: [metricId] } }
}

const companyWorkflow = 'company-deep-research'
const companySource = (metricId: string, kind: 'evidence' | 'timeseries', operationId: string): SourcePolicy => ({
  policyId: `company-${metricId}-akshare`, requirementMatch: { workflow: companyWorkflow, dataKind: kind, metricId }, selectionMode: 'FIRST_VALID',
  candidates: [candidate(metricId, `akshare-${metricId}`, operationId, kind, 'S3_AGGREGATOR')],
})

const evidenceId = 'company_research_evidence'
const evidenceCandidates: readonly SourceCandidate[] = [
  candidate(evidenceId, 'cninfo-company-research-evidence', 'cninfo.discoverFetchNormalizeCompanyEvidence', 'evidence', 'S0_STATUTORY', 'CNINFO'),
  candidate(evidenceId, 'gdelt-company-research-evidence', 'gdelt.discoverFetchNormalizeCompanyEvidence', 'evidence', 'S3_AGGREGATOR'),
]

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
