import type { AcquisitionResult } from '../research-data-acquisition/contracts.ts'

export type {
  CommunicationProvenance,
  ExchangeQAPair,
  ManagementCommunicationAcquisitionRequest,
  ManagementCommunicationAcquisitionSources,
  ManagementCommunicationDocument,
  ManagementCommunicationDocumentType,
  ManagementCommunicationExchange,
  NormalizationBatch,
} from '../../plugins/research-acquisition/management-communication-contracts.ts'

export interface ManagementCommunicationWorkflowResult<T> {
  readonly status: 'AVAILABLE' | 'UNAVAILABLE'
  readonly data: readonly T[]
  readonly diagnostics: readonly string[]
  readonly acquisition: AcquisitionResult<readonly T[]>
}
