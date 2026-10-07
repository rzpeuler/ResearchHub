import type { AcquisitionResult } from '../../data/contracts.ts'
import type { DataResolver, ResolvedDataItem } from '../../data/resolver.ts'
import { materializePhase2CommonRequirement } from '../../data/requirements.ts'
import { createManagementCommunicationDataResolver, type ManagementCommunicationDataPayload } from '../../plugins/research-acquisition/management-communication-data.ts'
import { createManagementCommunicationSourceOperations } from '../../plugins/research-acquisition/management-communication.ts'
import type { CninfoOfficialDisclosureClient } from '../../plugins/research-acquisition/official.ts'
import type { AkshareDataClient } from '../../plugins/research-acquisition/akshare.ts'
import type { ExchangeQAPair, ManagementCommunicationAcquisitionRequest, ManagementCommunicationAcquisitionSources, ManagementCommunicationDocument, ManagementCommunicationExchange, ManagementCommunicationWorkflowResult } from './contracts.ts'

export interface ManagementCommunicationWorkflowOptions {
  readonly request: ManagementCommunicationAcquisitionRequest
  readonly sources: ManagementCommunicationAcquisitionSources
  readonly now?: () => string
  readonly signal?: AbortSignal
  readonly dataResolver?: DataResolver<ManagementCommunicationDataPayload>
}

function validateRequest(request: ManagementCommunicationAcquisitionRequest): ManagementCommunicationAcquisitionRequest {
  if (!/^\d{6}$/.test(request.ticker)) throw new Error('D2_INVALID_TICKER')
  if (Number.isNaN(Date.parse(request.asOf))) throw new Error('D2_INVALID_AS_OF')
  return request
}

function toWorkflowResult<T extends ManagementCommunicationDocument | ExchangeQAPair>(item: ResolvedDataItem<ManagementCommunicationDataPayload>, diagnostics: readonly string[]): ManagementCommunicationWorkflowResult<T> {
  const data = item.status === 'AVAILABLE' && item.value !== undefined ? item.value as readonly T[] : []
  const acquisition: AcquisitionResult<readonly T[]> = { requirementId: item.acquisition.requirementId, status: item.acquisition.status, data, source: item.acquisition.source, ...(item.acquisition.sources ? { sources: item.acquisition.sources } : {}), quality: item.acquisition.quality, attempts: item.acquisition.attempts, ...(item.acquisition.unavailableReason ? { unavailableReason: item.acquisition.unavailableReason } : {}), ...(item.acquisition.fallbackReason ? { fallbackReason: item.acquisition.fallbackReason } : {}), ...(item.acquisition.policyId ? { policyId: item.acquisition.policyId } : {}) }
  return { status: data.length > 0 ? 'AVAILABLE' : 'UNAVAILABLE', data, diagnostics: [...new Set([...diagnostics, ...item.attempts.flatMap((attempt) => attempt.diagnostic ? [attempt.diagnostic] : [])])].sort(), acquisition }
}

function resolverFor(options: ManagementCommunicationWorkflowOptions, request: ManagementCommunicationAcquisitionRequest, diagnostics: string[]): DataResolver<ManagementCommunicationDataPayload> {
  return options.dataResolver ?? createManagementCommunicationDataResolver({ request, sources: options.sources, now: options.now ?? (() => new Date().toISOString()), signal: options.signal, diagnostics })
}

export async function runManagementCommunicationDocuments(options: ManagementCommunicationWorkflowOptions): Promise<ManagementCommunicationWorkflowResult<ManagementCommunicationDocument>> {
  const request = validateRequest(options.request)
  const exchange = resolveExchange(request)
  const resolvedRequest = exchange === undefined ? request : { ...request, exchange }
  const diagnostics: string[] = []
  const resolver = resolverFor(options, resolvedRequest, diagnostics)
  const requirement = materializePhase2CommonRequirement('management_communication_documents', { workflowId: 'management-communication-acquisition', ticker: request.ticker, companyId: request.companyName, asOf: request.asOf, required: false, id: `d2-001-management-communication-documents:${request.ticker}:${request.asOf}` })
  return toWorkflowResult<ManagementCommunicationDocument>(await resolver.resolveOne(requirement), diagnostics)
}

export async function runExchangeQa(options: ManagementCommunicationWorkflowOptions): Promise<ManagementCommunicationWorkflowResult<ExchangeQAPair>> {
  const request = validateRequest(options.request)
  const exchange = resolveExchange(request)
  if (exchange !== 'SSE' && exchange !== 'SZSE') return unavailableExchangeResult(request, [exchange === undefined ? 'unsupported_or_unresolved_exchange' : `unsupported_exchange:${exchange}`])
  const resolvedRequest = { ...request, exchange }
  const diagnostics: string[] = []
  const resolver = resolverFor(options, resolvedRequest, diagnostics)
  const requirement = materializePhase2CommonRequirement(exchange === 'SSE' ? 'exchange_qa_sse' : 'exchange_qa_szse', { workflowId: 'management-communication-acquisition', ticker: request.ticker, companyId: request.companyName, asOf: request.asOf, required: false, id: `d2-001-exchange-qa:${exchange}:${request.ticker}:${request.asOf}` })
  return toWorkflowResult<ExchangeQAPair>(await resolver.resolveOne(requirement), diagnostics)
}

export function resolveExchange(request: Pick<ManagementCommunicationAcquisitionRequest, 'ticker' | 'exchange'>): ManagementCommunicationExchange | undefined {
  if (request.exchange !== undefined) return request.exchange
  if (/^6\d{5}$/.test(request.ticker)) return 'SSE'
  if (/^(0|3)\d{5}$/.test(request.ticker)) return 'SZSE'
  return undefined
}

export function createManagementCommunicationSources(cninfo: CninfoOfficialDisclosureClient, akshare: AkshareDataClient, now?: () => string): ManagementCommunicationAcquisitionSources {
  return createManagementCommunicationSourceOperations(cninfo, akshare, now)
}

function unavailableExchangeResult(request: ManagementCommunicationAcquisitionRequest, diagnostics: readonly string[]): ManagementCommunicationWorkflowResult<ExchangeQAPair> {
  const acquisition: AcquisitionResult<readonly ExchangeQAPair[]> = { requirementId: `d2-001-exchange-qa:${request.ticker}:${request.asOf}`, status: 'UNAVAILABLE', source: null, quality: { pointInTimeSafe: false, complete: false, crossChecked: false }, attempts: [], unavailableReason: 'SOURCE_UNAVAILABLE' }
  return { status: 'UNAVAILABLE', data: [], diagnostics, acquisition }
}
