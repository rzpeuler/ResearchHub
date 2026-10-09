import type { DataRequirement, SourceCandidate, SourcePolicy } from './contracts.ts'

function candidate(metricId: string, sourceId: string, operationId: string, kind: SourceCandidate['supports']['dataKinds'][number], publisher: string, authority: SourceCandidate['originAuthority'] = 'S3_AGGREGATOR', fallbackLevel: SourceCandidate['fallbackLevel'] = 'PRIMARY'): SourceCandidate {
  return { sourceId, fallbackLevel, originPublisher: publisher, originAuthority: authority, operationId, supports: { dataKinds: [kind], metricIds: [metricId] } }
}

function policy(metricId: string, workflow: string, kind: DataRequirement['dataKind'], candidates: readonly SourceCandidate[], policyId: string, capability?: string): SourcePolicy {
  return { policyId, requirementMatch: { workflow, dataKind: kind, metricId, ...(capability ? { capability } : {}) }, selectionMode: 'FIRST_VALID', candidates }
}

const valuation: readonly SourcePolicy[] = [
  policy('valuation_market_price', 'valuation', 'timeseries', [candidate('valuation_market_price', 'akshare-historical-market-data', 'akshare.historicalMarketData', 'timeseries', 'EastMoney'), candidate('valuation_market_price', 'akshare-tencent-historical-market-data', 'akshare.historicalMarketDataTencent', 'timeseries', 'Tencent', 'S3_AGGREGATOR', 'FALLBACK_1')], 'valuation-market-price-eastmoney-tencent'),
  policy('valuation_eps', 'valuation', 'metric', [candidate('valuation_eps', 'akshare-valuation-financial-indicators-eps', 'akshare.valuationFinancialIndicators', 'metric', 'EastMoney'), candidate('valuation_eps', 'akshare-legacy-financial-data-eps', 'akshare.financialData', 'metric', 'EastMoney', 'S3_AGGREGATOR', 'FALLBACK_1')], 'valuation-eps-eastmoney'),
  policy('valuation_bvps', 'valuation', 'metric', [candidate('valuation_bvps', 'akshare-valuation-financial-indicators-bvps', 'akshare.valuationFinancialIndicators', 'metric', 'EastMoney'), candidate('valuation_bvps', 'akshare-legacy-financial-data-bvps', 'akshare.financialData', 'metric', 'EastMoney', 'S3_AGGREGATOR', 'FALLBACK_1')], 'valuation-bvps-eastmoney'),
  policy('valuation_annual_report_publication', 'valuation', 'document', [candidate('valuation_annual_report_publication', 'cninfo-annual-report-publication', 'cninfo.resolveAnnualReportPublication', 'document', 'CNINFO', 'S0_STATUTORY')], 'valuation-annual-publication-cninfo'),
  policy('valuation_peer_candidate_evidence', 'valuation', 'evidence', [candidate('valuation_peer_candidate_evidence', 'eastmoney-peer-comparison', 'akshare.peerComparison', 'evidence', 'EastMoney')], 'valuation-peer-candidate-eastmoney'),
]

const actualMetricIds = ['earnings_actual_revenue', 'earnings_actual_net_profit', 'earnings_actual_gross_margin', 'earnings_actual_operating_cash_flow', 'earnings_actual_eps'] as const
const earnings: readonly SourcePolicy[] = [
  policy('earnings_official_filing', 'earnings-review', 'document', [candidate('earnings_official_filing', 'cninfo-earnings-filing', 'official.discoverFetchNormalize', 'document', 'CNINFO', 'S0_STATUTORY')], 'earnings-official-filing-cninfo'),
  ...actualMetricIds.map((metricId) => policy(metricId, 'earnings-review', 'metric', [candidate(metricId, `akshare-${metricId}`, 'akshare.financialData', 'metric', 'EastMoney')], `earnings-actual-${metricId}`)),
  policy('earnings_expectation_eps', 'earnings-review', 'estimate', [
    candidate('earnings_expectation_eps', 'ths-institution-forecast', 'akshare.stock_profit_forecast_ths', 'estimate', 'Tonghuashun / 同花顺'),
    candidate('earnings_expectation_eps', 'eastmoney-individual-research-report', 'akshare.stock_research_report_em', 'estimate', 'EastMoney', 'S3_AGGREGATOR', 'FALLBACK_1'),
    candidate('earnings_expectation_eps', 'eastmoney-legacy-report', 'legacy.eastmoneyResearchReport', 'estimate', 'EastMoney', 'S3_AGGREGATOR', 'FALLBACK_2'),
  ], 'earnings-expectations-eps-source-ladder-v0.1', 'earnings_expectations'),
  policy('earnings_expectation_net_profit', 'earnings-review', 'estimate', [
    candidate('earnings_expectation_net_profit', 'ths-institution-forecast', 'akshare.stock_profit_forecast_ths', 'estimate', 'Tonghuashun / 同花顺'),
  ], 'earnings-expectations-net-profit-source-ladder-v0.1', 'earnings_expectations'),
]

const management: readonly SourcePolicy[] = [
  policy('management_communication_documents', 'management-communication-acquisition', 'document', [candidate('management_communication_documents', 'cninfo-official-ir', 'cninfo_official_ir', 'document', 'listed-company', 'S1_OFFICIAL')], 'd2-001-management-communication-documents', 'management_communication_documents'),
  policy('exchange_qa_sse', 'management-communication-acquisition', 'evidence', [candidate('exchange_qa_sse', 'sse-einteraction', 'exchange_qa_sse', 'evidence', 'listed-company', 'S1_OFFICIAL')], 'd2-001-sse-exchange-qa', 'exchange_qa_sse'),
  policy('exchange_qa_szse', 'management-communication-acquisition', 'evidence', [candidate('exchange_qa_szse', 'szse-hudongyi', 'exchange_qa_szse', 'evidence', 'listed-company', 'S1_OFFICIAL')], 'd2-001-szse-exchange-qa', 'exchange_qa_szse'),
]

/** Existing source routes expressed once as exact Common identities. Executors bind these operation IDs in Runtime composition. */
export const PHASE2_COMMON_SOURCE_POLICIES: readonly SourcePolicy[] = [...valuation, ...earnings, ...management]
