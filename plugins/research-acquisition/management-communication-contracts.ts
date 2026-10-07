import type { CninfoManagementCommunicationRecord, ManagementCommunicationSourceRequest } from './management-communication.ts'

export type ManagementCommunicationDocumentType =
  | 'INVESTOR_RELATIONS_RECORD'
  | 'EARNINGS_BRIEFING'
  | 'ROADSHOW'
  | 'ANALYST_MEETING'
  | 'COMPANY_IR_DOCUMENT'

export interface CommunicationProvenance {
  readonly originPublisher: string
  readonly hostPlatform?: string
  readonly retrievalProvider?: string
  readonly authority: 'S0_STATUTORY' | 'S1_OFFICIAL' | 'S2_PROFESSIONAL' | 'S3_AGGREGATOR' | 'S4_COMMUNITY'
  readonly disclosureClass: 'STATUTORY_DISCLOSURE' | 'OFFICIAL_IR' | 'EXCHANGE_INTERACTION' | 'AGGREGATED_IR' | 'MEDIA'
  readonly sourceUrl?: string
  readonly sourceNativeId?: string
}

export interface ManagementCommunicationDocument {
  readonly id: string
  readonly ticker: string
  readonly documentType: ManagementCommunicationDocumentType
  readonly eventDate?: string
  readonly publishedAt: string
  readonly retrievedAt: string
  readonly title?: string
  readonly content: string
  readonly participants?: readonly string[]
  readonly managementParticipants?: readonly string[]
  readonly source: CommunicationProvenance
}

export interface ExchangeQAPair {
  readonly id: string
  readonly ticker: string
  readonly question: string
  readonly questionAt?: string
  readonly answer: string
  readonly answeredAt: string
  readonly publishedAt: string
  readonly retrievedAt: string
  readonly platform: 'SZSE_HUDONGYI' | 'SSE_EINTERACTION'
  readonly source: CommunicationProvenance
}

export type ManagementCommunicationExchange = 'SSE' | 'SZSE' | 'BSE'

export interface ManagementCommunicationAcquisitionRequest {
  readonly ticker: string
  readonly companyName?: string
  readonly exchange?: ManagementCommunicationExchange
  readonly asOf: string
  readonly lookbackDays?: number
}

export interface ManagementCommunicationAcquisitionSources {
  cninfoIr(request: ManagementCommunicationSourceRequest): Promise<readonly CninfoManagementCommunicationRecord[]>
  exchangeQaSzse(request: ManagementCommunicationSourceRequest): Promise<unknown>
  exchangeQaSse(request: ManagementCommunicationSourceRequest): Promise<unknown>
  readonly exchangeQaSzseAnswer?: (questionId: string) => Promise<unknown>
}

export interface NormalizationBatch<T> {
  readonly values: readonly T[]
  readonly diagnostics: readonly string[]
}
