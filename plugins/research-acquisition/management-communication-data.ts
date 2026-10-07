import { DataResolver } from '../../data/resolver.ts'
import type { SourceExecutionResult } from '../../data/contracts.ts'
import { PHASE2_COMMON_SOURCE_POLICIES } from '../../data/valuation-earnings-policies.ts'
import { cninfoShanghaiLookbackDate } from './official.ts'
import type { ManagementCommunicationSourceRequest } from './management-communication.ts'
import { normalizeCninfoDocuments, normalizeExchangeQaRows } from './management-normalization.ts'
import { dedupeDocuments, dedupeExchangeQa } from './management-dedupe.ts'
import type { ExchangeQAPair, ManagementCommunicationAcquisitionRequest, ManagementCommunicationAcquisitionSources, ManagementCommunicationDocument } from './management-communication-contracts.ts'

export type ManagementCommunicationDataPayload = readonly ManagementCommunicationDocument[] | readonly ExchangeQAPair[]

export interface ManagementCommunicationDataCompositionOptions {
  readonly request: ManagementCommunicationAcquisitionRequest
  readonly sources: ManagementCommunicationAcquisitionSources
  readonly now: () => string
  readonly signal?: AbortSignal
  readonly diagnostics?: string[]
}

function sourceRequest(request: ManagementCommunicationAcquisitionRequest): ManagementCommunicationSourceRequest {
  const lookbackDays = Math.min(730, Math.max(1, request.lookbackDays ?? 365))
  return { company: { symbol: request.ticker, ...(request.companyName ? { name: request.companyName } : {}), ...(request.exchange ? { exchange: request.exchange } : {}) }, asOf: request.asOf, lookbackStartDate: cninfoShanghaiLookbackDate(request.asOf, lookbackDays) }
}

function diagnosticForAttempt(diagnostics: readonly string[], emptyCode: string): string {
  if (diagnostics.length === 0) return emptyCode
  const visible = diagnostics.slice(0, 8).join('|')
  return diagnostics.length > 8 ? `${visible}|diagnostics_truncated:${diagnostics.length - 8}` : visible
}

function rawRows(value: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((row): row is Record<string, unknown> => row !== null && typeof row === 'object' && !Array.isArray(row))
  if (value && typeof value === 'object' && Array.isArray((value as { data?: unknown }).data)) return rawRows((value as { data: unknown }).data)
  return []
}

function rawText(row: Record<string, unknown>, aliases: readonly string[]): string | undefined {
  for (const alias of aliases) {
    const value = row[alias]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return undefined
}

async function enrichSzseRows(raw: unknown, answer: ManagementCommunicationAcquisitionSources['exchangeQaSzseAnswer']): Promise<unknown> {
  if (answer === undefined) return raw
  const enriched: Record<string, unknown>[] = []
  for (const row of rawRows(raw)) {
    if (rawText(row, ['回答', '回答内容', '答复', 'answer', 'replyContent', 'attachedContent'])) { enriched.push(row); continue }
    const questionId = rawText(row, ['attachedId', 'questionId', 'indexId', '回答ID', '提问ID'])
    if (!questionId) { enriched.push(row); continue }
    try {
      const answerRow = rawRows(await answer(questionId))[0]
      enriched.push(answerRow === undefined ? row : { ...row, ...answerRow })
    } catch { enriched.push(row) }
  }
  return enriched
}

/** CNINFO/SSE/SZSE operation bindings; Common policies remain the sole source route. */
export function createManagementCommunicationDataResolver(options: ManagementCommunicationDataCompositionOptions): DataResolver<ManagementCommunicationDataPayload> {
  const request = options.request
  const sourceInput = sourceRequest(request)
  const diagnostics = options.diagnostics
  return new DataResolver<ManagementCommunicationDataPayload>({
    policies: PHASE2_COMMON_SOURCE_POLICIES,
    now: options.now,
    signal: options.signal,
    executor: async (requirement, candidate): Promise<SourceExecutionResult<ManagementCommunicationDataPayload>> => {
      if (requirement.subject.ticker !== request.ticker || requirement.asOf !== request.asOf) return { status: 'UNSUPPORTED', diagnostic: 'D2_SUBJECT_OR_ASOF_MISMATCH' }
      if (candidate.operationId === 'cninfo_official_ir') {
        const raw = await options.sources.cninfoIr(sourceInput)
        const retrievedAt = options.now()
        const batch = normalizeCninfoDocuments(raw, request)
        diagnostics?.push(...batch.diagnostics)
        const values = dedupeDocuments(batch.values)
        return values.length === 0
          ? { status: 'NO_DATA', diagnostic: diagnosticForAttempt(batch.diagnostics, 'cninfo_ir_no_accepted_records'), source: { retrievedAt, retrievalProvider: 'cninfo-official-client' } }
          : { status: 'SUCCESS', data: values, source: { originPublisher: request.companyName ?? request.ticker, retrievalProvider: 'cninfo-official-client', retrievedAt, publishedAt: values.map((item) => item.publishedAt).sort().at(-1) } }
      }
      if (candidate.operationId === 'exchange_qa_szse') {
        const raw = await options.sources.exchangeQaSzse(sourceInput)
        const enriched = await enrichSzseRows(raw, options.sources.exchangeQaSzseAnswer)
        const retrievedAt = options.now()
        const batch = normalizeExchangeQaRows(enriched, request, 'SZSE_HUDONGYI', retrievedAt)
        diagnostics?.push(...batch.diagnostics)
        const values = dedupeExchangeQa(batch.values)
        return values.length === 0
          ? { status: 'NO_DATA', diagnostic: diagnosticForAttempt(batch.diagnostics, 'szse_qa_no_accepted_records'), source: { retrievedAt, retrievalProvider: 'AKShare' } }
          : { status: 'SUCCESS', data: values, source: { originPublisher: request.companyName ?? request.ticker, retrievalProvider: 'AKShare', retrievedAt, publishedAt: values.map((item) => item.publishedAt).sort().at(-1) } }
      }
      if (candidate.operationId === 'exchange_qa_sse') {
        const raw = await options.sources.exchangeQaSse(sourceInput)
        const retrievedAt = options.now()
        const batch = normalizeExchangeQaRows(raw, request, 'SSE_EINTERACTION', retrievedAt)
        diagnostics?.push(...batch.diagnostics)
        const values = dedupeExchangeQa(batch.values)
        return values.length === 0
          ? { status: 'NO_DATA', diagnostic: diagnosticForAttempt(batch.diagnostics, 'sse_qa_no_accepted_records'), source: { retrievedAt, retrievalProvider: 'AKShare' } }
          : { status: 'SUCCESS', data: values, source: { originPublisher: request.companyName ?? request.ticker, retrievalProvider: 'AKShare', retrievedAt, publishedAt: values.map((item) => item.publishedAt).sort().at(-1) } }
      }
      return { status: 'UNSUPPORTED', diagnostic: `D2_UNKNOWN_OPERATION:${candidate.operationId}` }
    },
  })
}
