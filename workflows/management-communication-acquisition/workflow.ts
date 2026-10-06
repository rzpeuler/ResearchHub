import type { AcquisitionResult, DataRequirement, SourceCandidate, SourceExecutionResult } from '../research-data-acquisition/contracts.ts'
import { runResearchDataAcquisition } from '../research-data-acquisition/workflow.ts'
import { createManagementCommunicationSourceOperations } from '../../plugins/research-acquisition/management-communication.ts'
import type { ManagementCommunicationSourceRequest } from '../../plugins/research-acquisition/management-communication.ts'
import { cninfoShanghaiLookbackDate, type CninfoOfficialDisclosureClient } from '../../plugins/research-acquisition/official.ts'
import type { AkshareDataClient } from '../../plugins/research-acquisition/akshare.ts'
import type { ExchangeQAPair, ManagementCommunicationAcquisitionRequest, ManagementCommunicationAcquisitionSources, ManagementCommunicationDocument, ManagementCommunicationExchange, ManagementCommunicationWorkflowResult } from './contracts.ts'
import { dedupeDocuments, dedupeExchangeQa } from './dedupe.ts'
import { normalizeCninfoDocuments, normalizeExchangeQaRows } from './normalization.ts'
import { EXCHANGE_QA_SSE_CAPABILITY, EXCHANGE_QA_SSE_METRIC_ID, EXCHANGE_QA_SZSE_CAPABILITY, EXCHANGE_QA_SZSE_METRIC_ID, MANAGEMENT_COMMUNICATION_DOCUMENT_CAPABILITY, MANAGEMENT_COMMUNICATION_DOCUMENT_METRIC_ID, exchangeQAPolicy, managementCommunicationDocumentPolicy } from './source-policies.ts'

export interface ManagementCommunicationWorkflowOptions {
  readonly request: ManagementCommunicationAcquisitionRequest
  readonly sources: ManagementCommunicationAcquisitionSources
  readonly now?: () => string
  readonly signal?: AbortSignal
}

export async function runManagementCommunicationDocuments(options: ManagementCommunicationWorkflowOptions): Promise<ManagementCommunicationWorkflowResult<ManagementCommunicationDocument>> {
  const request = validateRequest(options.request)
  const now = options.now ?? (() => new Date().toISOString())
  const sourceRequest = makeSourceRequest(request)
  const diagnostics: string[] = []
  const requirement: DataRequirement = {
    id: `d2-001-management-communication-documents:${request.ticker}:${request.asOf}`,
    consumer: { workflow: 'management-communication-acquisition', capability: MANAGEMENT_COMMUNICATION_DOCUMENT_CAPABILITY },
    subject: { ticker: request.ticker },
    dataKind: 'document',
    metricId: MANAGEMENT_COMMUNICATION_DOCUMENT_METRIC_ID,
    asOf: request.asOf,
    determinismClass: 'SEMANTIC_QUALITATIVE',
    llmWebFallback: 'FORBIDDEN',
  }
  const acquisition = await runResearchDataAcquisition({
    requirement,
    policies: [managementCommunicationDocumentPolicy()],
    now,
    signal: options.signal,
    executor: async (_requirement, candidate) => executeDocumentCandidate(candidate, sourceRequest, options.sources, request, now, diagnostics),
  })
  return workflowResult(acquisition, diagnostics)
}

export async function runExchangeQa(options: ManagementCommunicationWorkflowOptions): Promise<ManagementCommunicationWorkflowResult<ExchangeQAPair>> {
  const request = validateRequest(options.request)
  const exchange = resolveExchange(request)
  if (exchange !== 'SSE' && exchange !== 'SZSE') return unavailableExchangeResult(request, diagnosticsForExchange(exchange))
  const now = options.now ?? (() => new Date().toISOString())
  const sourceRequest = makeSourceRequest(request, exchange)
  const diagnostics: string[] = []
  const capability = exchange === 'SZSE' ? EXCHANGE_QA_SZSE_CAPABILITY : EXCHANGE_QA_SSE_CAPABILITY
  const requirement: DataRequirement = {
    id: `d2-001-exchange-qa:${exchange}:${request.ticker}:${request.asOf}`,
    consumer: { workflow: 'management-communication-acquisition', capability },
    subject: { ticker: request.ticker },
    dataKind: 'evidence',
    metricId: exchange === 'SZSE' ? EXCHANGE_QA_SZSE_METRIC_ID : EXCHANGE_QA_SSE_METRIC_ID,
    asOf: request.asOf,
    determinismClass: 'SEMANTIC_QUALITATIVE',
    llmWebFallback: 'FORBIDDEN',
  }
  const acquisition = await runResearchDataAcquisition({
    requirement,
    policies: [exchangeQAPolicy(exchange)],
    now,
    signal: options.signal,
    executor: async (_requirement, candidate) => executeQaCandidate(candidate, sourceRequest, options.sources, request, exchange, now, diagnostics),
  })
  return workflowResult(acquisition, diagnostics)
}

export function resolveExchange(request: Pick<ManagementCommunicationAcquisitionRequest, 'ticker' | 'exchange'>): ManagementCommunicationExchange | undefined {
  if (request.exchange !== undefined) return request.exchange
  if (/^6\d{5}$/.test(request.ticker)) return 'SSE'
  if (/^(0|3)\d{5}$/.test(request.ticker)) return 'SZSE'
  return undefined
}

export function createManagementCommunicationSources(
  cninfo: CninfoOfficialDisclosureClient,
  akshare: AkshareDataClient,
  now?: () => string,
): ManagementCommunicationAcquisitionSources {
  return createManagementCommunicationSourceOperations(cninfo, akshare, now)
}

async function executeDocumentCandidate(
  candidate: SourceCandidate,
  sourceRequest: ManagementCommunicationSourceRequest,
  sources: ManagementCommunicationAcquisitionSources,
  request: ManagementCommunicationAcquisitionRequest,
  now: () => string,
  diagnostics: string[],
): Promise<SourceExecutionResult<readonly ManagementCommunicationDocument[]>> {
  const retrievedAt = now()
  if (candidate.operationId === 'cninfo_official_ir') {
    const batch = normalizeCninfoDocuments(await sources.cninfoIr(sourceRequest), request)
    diagnostics.push(...batch.diagnostics)
    const values = dedupeDocuments(batch.values)
    return values.length === 0
      ? { status: 'NO_DATA', diagnostic: diagnosticsForAttempt(batch.diagnostics, 'cninfo_ir_no_accepted_records'), source: { retrievedAt, retrievalProvider: 'cninfo-official-client' } }
      : { status: 'SUCCESS', data: values, source: { originPublisher: request.companyName ?? request.ticker, retrievalProvider: 'cninfo-official-client', retrievedAt } }
  }
  return { status: 'UNSUPPORTED', diagnostic: `D2_UNKNOWN_DOCUMENT_OPERATION:${candidate.operationId}`, source: { retrievedAt } }
}

async function executeQaCandidate(
  candidate: SourceCandidate,
  sourceRequest: ManagementCommunicationSourceRequest,
  sources: ManagementCommunicationAcquisitionSources,
  request: ManagementCommunicationAcquisitionRequest,
  exchange: 'SSE' | 'SZSE',
  now: () => string,
  diagnostics: string[],
): Promise<SourceExecutionResult<readonly ExchangeQAPair[]>> {
  const retrievedAt = now()
  if (exchange === 'SZSE' && candidate.operationId === 'exchange_qa_szse') {
    const raw = await sources.exchangeQaSzse(sourceRequest)
    const enriched = await enrichSzseRows(raw, sources.exchangeQaSzseAnswer)
    const batch = normalizeExchangeQaRows(enriched, request, 'SZSE_HUDONGYI', retrievedAt)
    diagnostics.push(...batch.diagnostics)
    const values = dedupeExchangeQa(batch.values)
    return values.length === 0
      ? { status: 'NO_DATA', diagnostic: diagnosticsForAttempt(batch.diagnostics, 'szse_qa_no_accepted_records'), source: { retrievedAt, retrievalProvider: 'AKShare' } }
      : { status: 'SUCCESS', data: values, source: { originPublisher: request.companyName ?? request.ticker, retrievalProvider: 'AKShare', retrievedAt } }
  }
  if (exchange === 'SSE' && candidate.operationId === 'exchange_qa_sse') {
    const batch = normalizeExchangeQaRows(await sources.exchangeQaSse(sourceRequest), request, 'SSE_EINTERACTION', retrievedAt)
    diagnostics.push(...batch.diagnostics)
    const values = dedupeExchangeQa(batch.values)
    return values.length === 0
      ? { status: 'NO_DATA', diagnostic: diagnosticsForAttempt(batch.diagnostics, 'sse_qa_no_accepted_records'), source: { retrievedAt, retrievalProvider: 'AKShare' } }
      : { status: 'SUCCESS', data: values, source: { originPublisher: request.companyName ?? request.ticker, retrievalProvider: 'AKShare', retrievedAt } }
  }
  return { status: 'UNSUPPORTED', diagnostic: `D2_CROSS_EXCHANGE_OPERATION:${candidate.operationId}`, source: { retrievedAt } }
}

async function enrichSzseRows(raw: unknown, answer: ManagementCommunicationAcquisitionSources['exchangeQaSzseAnswer']): Promise<unknown> {
  if (answer === undefined) return raw
  const values = rawRows(raw)
  const enriched: Record<string, unknown>[] = []
  for (const row of values) {
    if (hasAnswer(row)) {
      enriched.push(row)
      continue
    }
    const questionId = rawText(row, ['attachedId', 'questionId', 'indexId', '回答ID', '提问ID'])
    if (questionId === undefined) {
      enriched.push(row)
      continue
    }
    try {
      const answerValue = await answer(questionId)
      const answerRow = rawRows(answerValue)[0]
      enriched.push(answerRow === undefined ? row : { ...row, ...answerRow })
    } catch {
      enriched.push(row)
    }
  }
  return enriched
}

function workflowResult<T>(acquisition: AcquisitionResult<readonly T[]>, diagnostics: readonly string[]): ManagementCommunicationWorkflowResult<T> {
  const data = acquisition.status === 'AVAILABLE' && acquisition.data !== undefined ? acquisition.data : []
  return { status: data.length > 0 ? 'AVAILABLE' : 'UNAVAILABLE', data, diagnostics: [...new Set([...diagnostics, ...acquisition.attempts.flatMap((attempt) => attempt.diagnostic === undefined ? [] : [attempt.diagnostic])].sort())], acquisition }
}

function unavailableExchangeResult(request: ManagementCommunicationAcquisitionRequest, diagnostics: readonly string[]): ManagementCommunicationWorkflowResult<ExchangeQAPair> {
  const acquisition: AcquisitionResult<readonly ExchangeQAPair[]> = {
    requirementId: `d2-001-exchange-qa:${request.ticker}:${request.asOf}`,
    status: 'UNAVAILABLE',
    source: null,
    quality: { pointInTimeSafe: false, complete: false, crossChecked: false },
    attempts: [],
    unavailableReason: 'SOURCE_UNAVAILABLE',
  }
  return { status: 'UNAVAILABLE', data: [], diagnostics, acquisition }
}

function validateRequest(request: ManagementCommunicationAcquisitionRequest): ManagementCommunicationAcquisitionRequest {
  if (!/^\d{6}$/.test(request.ticker)) throw new Error('D2_INVALID_TICKER')
  if (Number.isNaN(Date.parse(request.asOf))) throw new Error('D2_INVALID_AS_OF')
  return request
}

function makeSourceRequest(request: ManagementCommunicationAcquisitionRequest, exchange = resolveExchange(request)): ManagementCommunicationSourceRequest {
  const lookbackDays = Math.min(730, Math.max(1, request.lookbackDays ?? 365))
  return { company: { symbol: request.ticker, ...(request.companyName === undefined ? {} : { name: request.companyName }), ...(exchange === undefined ? {} : { exchange }) }, asOf: request.asOf, lookbackStartDate: cninfoShanghaiLookbackDate(request.asOf, lookbackDays) }
}

function diagnosticsForExchange(exchange: ManagementCommunicationExchange | undefined): readonly string[] {
  return [exchange === undefined ? 'unsupported_or_unresolved_exchange' : `unsupported_exchange:${exchange}`]
}

function diagnosticsForAttempt(diagnostics: readonly string[], emptyCode: string): string {
  if (diagnostics.length === 0) return emptyCode
  const visible = diagnostics.slice(0, 8).join('|')
  return diagnostics.length > 8 ? `${visible}|diagnostics_truncated:${diagnostics.length - 8}` : visible
}

function rawRows(value: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRawRow)
  if (isRawRow(value) && Array.isArray(value.data)) return value.data.filter(isRawRow)
  return []
}

function isRawRow(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function rawText(row: Record<string, unknown>, aliases: readonly string[]): string | undefined {
  for (const alias of aliases) {
    const value = row[alias]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return undefined
}

function hasAnswer(row: Record<string, unknown>): boolean {
  return rawText(row, ['回答', '回答内容', '答复', 'answer', 'replyContent', 'attachedContent']) !== undefined
}
