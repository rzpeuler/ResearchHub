import type { DataRequirement, SourceCandidate, SourcePolicy } from '../research-data-acquisition/contracts.ts'

export const MANAGEMENT_COMMUNICATION_DOCUMENT_CAPABILITY = 'management_communication_documents' as const
export const EXCHANGE_QA_SZSE_CAPABILITY = 'exchange_qa_szse' as const
export const EXCHANGE_QA_SSE_CAPABILITY = 'exchange_qa_sse' as const
export const MANAGEMENT_COMMUNICATION_DOCUMENT_METRIC_ID = 'management_communication_documents' as const
export const EXCHANGE_QA_SZSE_METRIC_ID = 'exchange_qa_szse' as const
export const EXCHANGE_QA_SSE_METRIC_ID = 'exchange_qa_sse' as const

const documentCandidates: readonly SourceCandidate[] = [
  {
    sourceId: 'cninfo-official-ir',
    fallbackLevel: 'PRIMARY',
    originAuthority: 'S1_OFFICIAL',
    originPublisher: 'listed-company',
    operationId: 'cninfo_official_ir',
    supports: { dataKinds: ['document'], metricIds: [MANAGEMENT_COMMUNICATION_DOCUMENT_METRIC_ID] },
  },
]

export function managementCommunicationDocumentPolicy(): SourcePolicy {
  return {
    policyId: 'd2-001-management-communication-documents',
    requirementMatch: { workflow: 'management-communication-acquisition', dataKind: 'document', metricId: MANAGEMENT_COMMUNICATION_DOCUMENT_METRIC_ID, capability: MANAGEMENT_COMMUNICATION_DOCUMENT_CAPABILITY },
    selectionMode: 'FIRST_VALID',
    candidates: documentCandidates,
  }
}

export function exchangeQAPolicy(exchange: 'SSE' | 'SZSE'): SourcePolicy {
  const szse = exchange === 'SZSE'
  const candidate: SourceCandidate = szse
    ? {
        sourceId: 'szse-hudongyi',
        fallbackLevel: 'PRIMARY',
        originAuthority: 'S1_OFFICIAL',
        originPublisher: 'listed-company',
        operationId: 'exchange_qa_szse',
        supports: { dataKinds: ['evidence'], metricIds: [EXCHANGE_QA_SZSE_METRIC_ID] },
      }
    : {
        sourceId: 'sse-einteraction',
        fallbackLevel: 'PRIMARY',
        originAuthority: 'S1_OFFICIAL',
        originPublisher: 'listed-company',
        operationId: 'exchange_qa_sse',
        supports: { dataKinds: ['evidence'], metricIds: [EXCHANGE_QA_SSE_METRIC_ID] },
      }
  return {
    policyId: `d2-001-${szse ? 'szse' : 'sse'}-exchange-qa`,
    requirementMatch: { workflow: 'management-communication-acquisition', dataKind: 'evidence', metricId: szse ? EXCHANGE_QA_SZSE_METRIC_ID : EXCHANGE_QA_SSE_METRIC_ID, capability: szse ? EXCHANGE_QA_SZSE_CAPABILITY : EXCHANGE_QA_SSE_CAPABILITY },
    selectionMode: 'FIRST_VALID',
    candidates: [candidate],
  }
}

export function isManagementCommunicationRequirement(requirement: DataRequirement): boolean {
  return requirement.consumer.workflow === 'management-communication-acquisition'
}
