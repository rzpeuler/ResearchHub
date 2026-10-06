import type { DataRequirement, SourceCandidate, SourcePolicy } from '../../data/contracts.ts'
import { getCommonDataDefinition } from '../../data/common-catalog.ts'
import { EARNINGS_EXPECTATION_METRICS, earningsExpectationSourcePolicy } from '../../workflows/earnings-review/expectations-acquisition.ts'
import { VALUATION_DATA_REQUIREMENTS, VALUATION_SOURCE_POLICIES } from '../../workflows/valuation/basis-evidence.ts'
import { EXCHANGE_QA_SSE_CAPABILITY, EXCHANGE_QA_SSE_METRIC_ID, EXCHANGE_QA_SZSE_CAPABILITY, EXCHANGE_QA_SZSE_METRIC_ID, MANAGEMENT_COMMUNICATION_DOCUMENT_CAPABILITY, MANAGEMENT_COMMUNICATION_DOCUMENT_METRIC_ID, exchangeQAPolicy, managementCommunicationDocumentPolicy } from '../../workflows/management-communication-acquisition/source-policies.ts'

const CATALOG_AS_OF = '1970-01-01T00:00:00.000Z'
const PUBLIC_WEB_SEARCH_OPERATION_AVAILABLE = false

export interface DataSourceCatalogRow {
  readonly metricId: string
  readonly chineseMeaning: string
  readonly capability: string
  readonly workflowId: string
  readonly defaultSource: string | null
  readonly fallback1: string | null
  readonly fallback2: string | null
  readonly finalFallback: string | null
  readonly coverageComplete: boolean
}

export interface DataSourceCatalogResponse {
  readonly rows: readonly DataSourceCatalogRow[]
  readonly coverageComplete: boolean
}

interface CatalogDefinition {
  readonly requirement: DataRequirement
  readonly chineseMeaning: string
  readonly policy: SourcePolicy
}

const sourceLabels: Readonly<Record<string, string>> = {
  'akshare-historical-market-data': 'AKShare（东方财富）行情',
  'akshare-valuation-financial-indicators-eps': 'AKShare（东方财富）年度 EPS',
  'akshare-valuation-financial-indicators-bvps': 'AKShare（东方财富）年度 BVPS',
  'cninfo-annual-report-publication': '巨潮资讯（年报披露日期）',
  'ths-institution-forecast': '同花顺机构预测',
  'eastmoney-individual-research-report': '东方财富机构研报预测',
  'cninfo-official-ir': '巨潮资讯上市公司互动平台',
  'sse-einteraction': '上交所 e 互动',
  'szse-hudongyi': '深交所互动易',
}

function requirement(input: Pick<DataRequirement, 'id' | 'consumer' | 'dataKind' | 'metricId' | 'determinismClass' | 'minimumAuthority'>): DataRequirement {
  return {
    ...input,
    subject: {},
    asOf: CATALOG_AS_OF,
    llmWebFallback: 'FORBIDDEN',
  }
}

function definitions(): readonly CatalogDefinition[] {
  const earningsPolicy = earningsExpectationSourcePolicy()
  const management = [
    {
      metricId: MANAGEMENT_COMMUNICATION_DOCUMENT_METRIC_ID,
      chineseMeaning: '上市公司管理层交流披露',
      capability: MANAGEMENT_COMMUNICATION_DOCUMENT_CAPABILITY,
      dataKind: 'document' as const,
      policy: managementCommunicationDocumentPolicy(),
    },
    {
      metricId: EXCHANGE_QA_SSE_METRIC_ID,
      chineseMeaning: '上交所投资者问答',
      capability: EXCHANGE_QA_SSE_CAPABILITY,
      dataKind: 'evidence' as const,
      policy: exchangeQAPolicy('SSE'),
    },
    {
      metricId: EXCHANGE_QA_SZSE_METRIC_ID,
      chineseMeaning: '深交所投资者互动问答',
      capability: EXCHANGE_QA_SZSE_CAPABILITY,
      dataKind: 'evidence' as const,
      policy: exchangeQAPolicy('SZSE'),
    },
  ] as const

  return [
    ...VALUATION_DATA_REQUIREMENTS.map((item) => ({
      requirement: item,
      chineseMeaning: getCommonDataDefinition(item.metricId!)?.meaning ?? '',
      policy: VALUATION_SOURCE_POLICIES.find((policy) => policy.requirementMatch.metricId === item.metricId)!,
    })),
    ...EARNINGS_EXPECTATION_METRICS.map((item) => ({
      requirement: requirement({
        id: `earnings-expectations-catalog-${item.metricId}`,
        consumer: { workflow: 'earnings-review', capability: 'earnings_expectations' },
        dataKind: 'estimate',
        metricId: item.metricId,
        determinismClass: 'AUTHORITATIVE_NUMERIC',
        minimumAuthority: 'S3_AGGREGATOR',
      }),
      chineseMeaning: getCommonDataDefinition(item.metricId)?.meaning ?? '',
      policy: {
        ...earningsPolicy,
        requirementMatch: { ...earningsPolicy.requirementMatch, metricId: item.metricId },
        candidates: earningsPolicy.candidates.filter((candidate) => candidate.supports.metricIds?.includes(item.metricId)),
      },
    })),
    ...management.map((item) => ({
      requirement: requirement({
        id: `management-acquisition-catalog-${item.metricId}`,
        consumer: { workflow: 'management-communication-acquisition', capability: item.capability },
        dataKind: item.dataKind,
        metricId: item.metricId,
        determinismClass: 'SEMANTIC_QUALITATIVE',
      }),
      chineseMeaning: getCommonDataDefinition(item.metricId)?.meaning ?? '',
      policy: item.policy,
    })),
  ]
}

function sourceLabel(candidate: SourceCandidate | undefined): string | null {
  if (candidate === undefined) return null
  return sourceLabels[candidate.sourceId] ?? candidate.originPublisher ?? candidate.sourceId
}

export function getDataSourceCatalog(): DataSourceCatalogResponse {
  const entries = definitions()
  const seen = new Set<string>()
  for (const entry of entries) {
    const id = entry.requirement.metricId
    if (!id) throw new Error(`DATA_SOURCE_CATALOG_REQUIREMENT_MISSING_METRIC_ID:${entry.requirement.id}`)
    if (!getCommonDataDefinition(id)) throw new Error(`DATA_SOURCE_CATALOG_COMMON_DEFINITION_MISSING:${id}`)
    if (seen.has(id)) throw new Error(`DATA_SOURCE_CATALOG_DUPLICATE_METRIC_ID:${id}`)
    seen.add(id)
  }

  const rows = entries.map(({ requirement: item, chineseMeaning, policy }): DataSourceCatalogRow => {
    const candidates = policy.candidates
    const primary = candidates.find((candidate) => candidate.fallbackLevel === 'PRIMARY')
    const fallback1 = candidates.find((candidate) => candidate.fallbackLevel === 'FALLBACK_1')
    const fallback2 = candidates.find((candidate) => candidate.fallbackLevel === 'FALLBACK_2')
    const defaultSource = sourceLabel(primary)
    const firstFallback = sourceLabel(fallback1)
    const secondFallback = sourceLabel(fallback2)
    // Public web search is not yet wired into this acquisition executor. Keep the
    // required final position visible without claiming a working adapter.
    const finalFallback = PUBLIC_WEB_SEARCH_OPERATION_AVAILABLE ? '公网搜索' : '公网搜索（待接入）'
    const coverageComplete = primary !== undefined && firstFallback !== null && PUBLIC_WEB_SEARCH_OPERATION_AVAILABLE
    return {
      metricId: item.metricId!,
      chineseMeaning,
      capability: item.consumer.capability,
      workflowId: item.consumer.workflow,
      defaultSource,
      fallback1: firstFallback,
      fallback2: secondFallback ?? '—',
      finalFallback,
      coverageComplete,
    }
  }).sort((left, right) => left.metricId.localeCompare(right.metricId))

  return { rows, coverageComplete: rows.length > 0 && rows.every((row) => row.coverageComplete) }
}
