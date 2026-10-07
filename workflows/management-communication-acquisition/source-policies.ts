import type { DataRequirement, SourcePolicy } from '../../data/contracts.ts'
import { PHASE2_COMMON_SOURCE_POLICIES } from '../../data/valuation-earnings-policies.ts'

export const MANAGEMENT_COMMUNICATION_DOCUMENT_CAPABILITY = 'management_communication_documents' as const
export const EXCHANGE_QA_SZSE_CAPABILITY = 'exchange_qa_szse' as const
export const EXCHANGE_QA_SSE_CAPABILITY = 'exchange_qa_sse' as const
export const MANAGEMENT_COMMUNICATION_DOCUMENT_METRIC_ID = 'management_communication_documents' as const
export const EXCHANGE_QA_SZSE_METRIC_ID = 'exchange_qa_szse' as const
export const EXCHANGE_QA_SSE_METRIC_ID = 'exchange_qa_sse' as const

function commonPolicy(metricId: string): SourcePolicy {
  const policy = PHASE2_COMMON_SOURCE_POLICIES.find((item) => item.requirementMatch.workflow === 'management-communication-acquisition' && item.requirementMatch.metricId === metricId)
  if (!policy) throw new Error(`MANAGEMENT_COMMON_POLICY_MISSING:${metricId}`)
  return policy
}

/** Compatibility exports refer to the single Data-owned policy definitions. */
export function managementCommunicationDocumentPolicy(): SourcePolicy { return commonPolicy(MANAGEMENT_COMMUNICATION_DOCUMENT_METRIC_ID) }
export function exchangeQAPolicy(exchange: 'SSE' | 'SZSE'): SourcePolicy { return commonPolicy(exchange === 'SSE' ? EXCHANGE_QA_SSE_METRIC_ID : EXCHANGE_QA_SZSE_METRIC_ID) }
export function isManagementCommunicationRequirement(requirement: DataRequirement): boolean { return requirement.consumer.workflow === 'management-communication-acquisition' }
