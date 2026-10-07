import type { DataRequirementKind } from './contracts.ts'

/** Stable, cross-industry identities exposed by the Common Data Catalog. */
export interface CommonDataDefinition {
  readonly metricId: string
  readonly meaning: string
  readonly dataKind: DataRequirementKind
  readonly consumers: readonly string[]
  /** Legacy workflow routing identity needed to match existing SourcePolicy contracts. */
  readonly compatibilityCapabilityByWorkflow?: Readonly<Record<string, string>>
  readonly sourcePolicyStatus: 'CONFIGURED' | 'NOT_CONFIGURED'
}

export const COMMON_DATA_CATALOG: readonly CommonDataDefinition[] = [
  { metricId: 'valuation_market_price', meaning: '估值用交易日收盘价', dataKind: 'timeseries', consumers: ['valuation'], compatibilityCapabilityByWorkflow: { valuation: 'market_price' }, sourcePolicyStatus: 'CONFIGURED' },
  { metricId: 'valuation_eps', meaning: '估值用年度每股收益（EPS）', dataKind: 'metric', consumers: ['valuation'], compatibilityCapabilityByWorkflow: { valuation: 'annual_financial_basis' }, sourcePolicyStatus: 'CONFIGURED' },
  { metricId: 'valuation_bvps', meaning: '估值用年度每股净资产（BVPS）', dataKind: 'metric', consumers: ['valuation'], compatibilityCapabilityByWorkflow: { valuation: 'annual_financial_basis' }, sourcePolicyStatus: 'CONFIGURED' },
  { metricId: 'valuation_annual_report_publication', meaning: '年度报告正式披露日期', dataKind: 'document', consumers: ['valuation'], compatibilityCapabilityByWorkflow: { valuation: 'annual_report_publication' }, sourcePolicyStatus: 'CONFIGURED' },
  { metricId: 'valuation_peer_candidate_evidence', meaning: '可比公司候选与行业分组、规模证据', dataKind: 'evidence', consumers: ['valuation'], sourcePolicyStatus: 'CONFIGURED' },
  { metricId: 'earnings_official_filing', meaning: '业绩期法定披露文件及更正、摘要', dataKind: 'document', consumers: ['earnings-review'], sourcePolicyStatus: 'CONFIGURED' },
  { metricId: 'earnings_actual_revenue', meaning: '业绩期营业收入实际值', dataKind: 'metric', consumers: ['earnings-review'], sourcePolicyStatus: 'CONFIGURED' },
  { metricId: 'earnings_actual_net_profit', meaning: '业绩期归母净利润实际值', dataKind: 'metric', consumers: ['earnings-review'], sourcePolicyStatus: 'CONFIGURED' },
  { metricId: 'earnings_actual_gross_margin', meaning: '业绩期销售毛利率实际值', dataKind: 'metric', consumers: ['earnings-review'], sourcePolicyStatus: 'CONFIGURED' },
  { metricId: 'earnings_actual_operating_cash_flow', meaning: '业绩期经营现金流实际值', dataKind: 'metric', consumers: ['earnings-review'], sourcePolicyStatus: 'CONFIGURED' },
  { metricId: 'earnings_actual_eps', meaning: '业绩期每股收益实际值', dataKind: 'metric', consumers: ['earnings-review'], sourcePolicyStatus: 'CONFIGURED' },
  { metricId: 'earnings_expectation_eps', meaning: '分析师预测每股收益（EPS）', dataKind: 'estimate', consumers: ['earnings-review'], compatibilityCapabilityByWorkflow: { 'earnings-review': 'earnings_expectations' }, sourcePolicyStatus: 'CONFIGURED' },
  { metricId: 'earnings_expectation_net_profit', meaning: '分析师预测净利润', dataKind: 'estimate', consumers: ['earnings-review'], compatibilityCapabilityByWorkflow: { 'earnings-review': 'earnings_expectations' }, sourcePolicyStatus: 'CONFIGURED' },
  { metricId: 'management_communication_documents', meaning: '上市公司管理层交流披露', dataKind: 'document', consumers: ['management-communication-acquisition'], compatibilityCapabilityByWorkflow: { 'management-communication-acquisition': 'management_communication_documents' }, sourcePolicyStatus: 'CONFIGURED' },
  { metricId: 'exchange_qa_sse', meaning: '上交所投资者问答', dataKind: 'evidence', consumers: ['management-communication-acquisition'], compatibilityCapabilityByWorkflow: { 'management-communication-acquisition': 'exchange_qa_sse' }, sourcePolicyStatus: 'CONFIGURED' },
  { metricId: 'exchange_qa_szse', meaning: '深交所互动易投资者问答', dataKind: 'evidence', consumers: ['management-communication-acquisition'], compatibilityCapabilityByWorkflow: { 'management-communication-acquisition': 'exchange_qa_szse' }, sourcePolicyStatus: 'CONFIGURED' },
]

export function createCommonDataCatalog(definitions: readonly CommonDataDefinition[] = COMMON_DATA_CATALOG): ReadonlyMap<string, CommonDataDefinition> {
  const catalog = new Map<string, CommonDataDefinition>()
  for (const definition of definitions) {
    if (!definition.metricId.trim() || !definition.meaning.trim() || definition.consumers.length === 0) {
      throw new Error(`INVALID_COMMON_DATA_DEFINITION:${definition.metricId}`)
    }
    if (catalog.has(definition.metricId)) throw new Error(`DUPLICATE_COMMON_DATA_ID:${definition.metricId}`)
    catalog.set(definition.metricId, Object.freeze({ ...definition, consumers: Object.freeze([...definition.consumers]), ...(definition.compatibilityCapabilityByWorkflow ? { compatibilityCapabilityByWorkflow: Object.freeze({ ...definition.compatibilityCapabilityByWorkflow }) } : {}) }))
  }
  return catalog
}

const commonDataById = createCommonDataCatalog()

export function getCommonDataDefinition(metricId: string): CommonDataDefinition | undefined {
  return commonDataById.get(metricId)
}
