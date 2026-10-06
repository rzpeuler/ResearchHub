import type { DataRequirementKind } from './contracts.ts'

/** Stable, cross-industry identities exposed by the Common Data Catalog. */
export interface CommonDataDefinition {
  readonly metricId: string
  readonly meaning: string
  readonly dataKind: DataRequirementKind
  readonly consumers: readonly string[]
  readonly sourcePolicyStatus: 'CONFIGURED' | 'NOT_CONFIGURED'
}

export const COMMON_DATA_CATALOG: readonly CommonDataDefinition[] = [
  { metricId: 'valuation_market_price', meaning: '估值用交易日收盘价', dataKind: 'timeseries', consumers: ['valuation'], sourcePolicyStatus: 'CONFIGURED' },
  { metricId: 'valuation_eps', meaning: '估值用年度每股收益（EPS）', dataKind: 'metric', consumers: ['valuation'], sourcePolicyStatus: 'CONFIGURED' },
  { metricId: 'valuation_bvps', meaning: '估值用年度每股净资产（BVPS）', dataKind: 'metric', consumers: ['valuation'], sourcePolicyStatus: 'CONFIGURED' },
  { metricId: 'valuation_annual_report_publication', meaning: '年度报告正式披露日期', dataKind: 'document', consumers: ['valuation'], sourcePolicyStatus: 'CONFIGURED' },
  { metricId: 'earnings_expectation_eps', meaning: '分析师预测每股收益（EPS）', dataKind: 'estimate', consumers: ['earnings-review'], sourcePolicyStatus: 'CONFIGURED' },
  { metricId: 'earnings_expectation_net_profit', meaning: '分析师预测净利润', dataKind: 'estimate', consumers: ['earnings-review'], sourcePolicyStatus: 'CONFIGURED' },
  { metricId: 'management_communication_documents', meaning: '上市公司管理层交流披露', dataKind: 'document', consumers: ['management-communication-acquisition'], sourcePolicyStatus: 'CONFIGURED' },
  { metricId: 'exchange_qa_sse', meaning: '上交所投资者问答', dataKind: 'evidence', consumers: ['management-communication-acquisition'], sourcePolicyStatus: 'CONFIGURED' },
  { metricId: 'exchange_qa_szse', meaning: '深交所互动易投资者问答', dataKind: 'evidence', consumers: ['management-communication-acquisition'], sourcePolicyStatus: 'CONFIGURED' },
]

export function createCommonDataCatalog(definitions: readonly CommonDataDefinition[] = COMMON_DATA_CATALOG): ReadonlyMap<string, CommonDataDefinition> {
  const catalog = new Map<string, CommonDataDefinition>()
  for (const definition of definitions) {
    if (!definition.metricId.trim() || !definition.meaning.trim() || definition.consumers.length === 0) {
      throw new Error(`INVALID_COMMON_DATA_DEFINITION:${definition.metricId}`)
    }
    if (catalog.has(definition.metricId)) throw new Error(`DUPLICATE_COMMON_DATA_ID:${definition.metricId}`)
    catalog.set(definition.metricId, Object.freeze({ ...definition, consumers: Object.freeze([...definition.consumers]) }))
  }
  return catalog
}

const commonDataById = createCommonDataCatalog()

export function getCommonDataDefinition(metricId: string): CommonDataDefinition | undefined {
  return commonDataById.get(metricId)
}
