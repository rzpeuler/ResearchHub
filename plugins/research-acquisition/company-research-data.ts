import type { AcquisitionResult, DataRequirement, SourceExecutionResult } from '../../data/contracts.ts'
import type { CompanyFinancialObservation, CompanyFinancialHistory } from '../../data/company-research-contracts.ts'
export type { CompanyFinancialObservation, CompanyFinancialHistory } from '../../data/company-research-contracts.ts'
import { PHASE3_COMMON_SOURCE_POLICIES, COMPANY_PUBLIC_WEB_CANDIDATE, COMPANY_OFFICIAL_FINANCIAL_CANDIDATE } from '../../data/company-research-policies.ts'
import { extractOfficialAnnualFinancials } from './company-official-financial.ts'
import { DataResolver } from '../../data/resolver.ts'
import { dailyCloseAvailableAt } from '../../data/point-in-time.ts'
import { finalizeResearchEvidence, qualifyResearchEvidenceDate, type ResearchEvidenceBatch, type ResearchEvidenceInput, type UnqualifiedResearchEvidenceBatch } from '../../data/research-evidence.ts'
import { runResearchDataAcquisition } from '../../data/workflow.ts'
import type { AkshareDataClient } from './akshare.ts'
import type { NormalizedResearchSource, ResearchAcquisitionPlugin, ResearchCompanyIdentity } from './contracts.ts'
import { validateUsableAcquisitionPayload } from './payload-validation.ts'
import { acquisitionStep, type ResearchFetchOptions } from './deadlines.ts'
import { OfficialDisclosureResearchPlugin } from './official.ts'
import { GdeltResearchPlugin } from './gdelt.ts'
const COMPANY_DEBT_FIELDS = [
  ['shortTermBorrowings', 'short_term_borrowings', 'SHORT_LOAN'],
  ['longTermBorrowings', 'long_term_borrowings', 'LONG_LOAN'],
  ['bondsPayable', 'bonds_payable', 'BOND_PAYABLE'],
  ['currentPortionLongTermDebt', 'current_portion_long_term_debt', 'NONCURRENT_LIAB_1YEAR'],
] as const

export interface CompanyProfileSnapshot {
  readonly kind: 'profile'
  readonly fields: readonly { readonly name: string; readonly value: string | number | boolean }[]
  readonly retrievedAt: string
  readonly pointInTimeStatus: 'CURRENT_VALUE_ONLY' | 'UNVERIFIED'
}

export interface CompanyMarketObservation {
  readonly observedAt: string
  readonly open?: number
  readonly high?: number
  readonly low?: number
  readonly close?: number
  readonly volume?: number
  readonly pointInTimeSafe: boolean
  readonly pointInTimeStatus: 'CURRENT_VALUE_ONLY' | 'PIT_VERIFIED'
}
export interface CompanyMarketHistory {
  readonly kind: 'market'
  readonly rows: readonly CompanyMarketObservation[]
  readonly retrievedAt: string
  readonly pointInTimeStatus: 'CURRENT_VALUE_ONLY' | 'PIT_VERIFIED'
}

export type CompanyResearchEvidenceBatch = ResearchEvidenceBatch<NormalizedResearchSource>
export type CompanyResearchDataPayload = CompanyProfileSnapshot | CompanyFinancialHistory | CompanyMarketHistory | CompanyResearchEvidenceBatch
type RawCompanyResearchDataPayload = CompanyProfileSnapshot | CompanyFinancialHistory | CompanyMarketHistory | UnqualifiedResearchEvidenceBatch<NormalizedResearchSource>

export interface CompanyResearchDataResolverOptions {
  readonly company: ResearchCompanyIdentity
  readonly akshare?: AkshareDataClient
  readonly officialDisclosure?: ResearchAcquisitionPlugin
  readonly gdelt?: ResearchAcquisitionPlugin
  readonly publicWeb?: ResearchAcquisitionPlugin
  readonly evidenceSearchTerms?: readonly string[]
  readonly now: () => string
  readonly signal?: AbortSignal
  readonly limitPerSource?: number
  readonly acquisitionDeadlineAt?: number
  readonly onProgress?: ResearchFetchOptions['onProgress']
  /** Compatibility seam for Company signal projection, after discovery and before fetch. */
  readonly onCandidatesDiscovered?: (event: { readonly provider: 'CNINFO' | 'GDELT'; readonly candidates: readonly NormalizedResearchSource['candidate'][]; readonly requirement: DataRequirement }) => Promise<void | readonly NormalizedResearchSource['candidate'][]> | void | readonly NormalizedResearchSource['candidate'][]
}

/** Explicit AKShare, CNINFO, and GDELT operation composition. */
export function createCompanyResearchDataResolver(options: CompanyResearchDataResolverOptions): DataResolver<CompanyResearchDataPayload> {
  const policies = PHASE3_COMMON_SOURCE_POLICIES.map((policy) => options.publicWeb && policy.requirementMatch.workflow === 'company-deep-research' && policy.requirementMatch.metricId === 'company_research_evidence' ? { ...policy, candidates: [...policy.candidates, COMPANY_PUBLIC_WEB_CANDIDATE] } : options.officialDisclosure && policy.requirementMatch.workflow === 'company-deep-research' && policy.requirementMatch.metricId === 'company_financial_history' ? { ...policy, candidates: [...policy.candidates, COMPANY_OFFICIAL_FINANCIAL_CANDIDATE] } : policy)
  const executeOperation = async (requirement: DataRequirement, operationId: string): Promise<SourceExecutionResult<RawCompanyResearchDataPayload>> => {
    if (options.signal?.aborted) throw new Error('WORKFLOW_CANCELLED')
    if (options.acquisitionDeadlineAt !== undefined && Date.now() >= options.acquisitionDeadlineAt) return { status: 'SOURCE_ERROR', diagnostic: 'ACQUISITION_BUDGET_EXCEEDED' }
    const symbol = requirement.subject.ticker
    if (!symbol) return { status: 'UNSUPPORTED', diagnostic: 'COMPANY_TICKER_REQUIRED' }
    const akshare = options.akshare
    if (operationId === 'akshare.companyBasic' || operationId === 'akshare.financialData' || operationId === 'akshare.financialStatements' || operationId === 'akshare.historicalMarketData' || operationId === 'akshare.historicalMarketDataTencent') {
      if (!akshare) return { status: 'UNSUPPORTED', diagnostic: 'AKShare client is unavailable' }
      if (operationId.endsWith('Tencent') && !akshare.historicalMarketDataTencent) return { status: 'UNSUPPORTED', diagnostic: 'Tencent market adapter is unavailable' }
      if (operationId === 'akshare.financialStatements' && !akshare.financialStatements) return { status: 'UNSUPPORTED', diagnostic: 'Financial statements adapter unavailable' }
      let raw: unknown
      try {
        raw = await acquisitionStep({ activityId: operationId.toLowerCase(), providerId: 'akshare', step: 'structured_data', signal: options.signal,
          timeoutMs: 60_000, deadlineAt: options.acquisitionDeadlineAt, onProgress: options.onProgress }, async (signal) => operationId === 'akshare.companyBasic' ? akshare.companyBasic({ symbol, signal })
          : operationId === 'akshare.financialData' ? akshare.financialData({ symbol, signal }) : operationId === 'akshare.financialStatements' ? akshare.financialStatements!({ symbol, signal })
            : (operationId.endsWith('Tencent') ? akshare.historicalMarketDataTencent!({ symbol, signal, ...(requirement.period?.start ? { startDate: requirement.period.start.slice(0, 10).replace(/-/g, '') } : {}), ...(requirement.period?.end ? { endDate: requirement.period.end.slice(0, 10).replace(/-/g, '') } : {}) }) : akshare.historicalMarketData({ symbol, signal, ...(requirement.period?.start ? { startDate: requirement.period.start.slice(0, 10).replace(/-/g, '') } : {}), ...(requirement.period?.end ? { endDate: requirement.period.end.slice(0, 10).replace(/-/g, '') } : {}) })))
      } catch (error) {
        if (options.signal?.aborted) throw new Error('WORKFLOW_CANCELLED')
        return { status: 'SOURCE_ERROR', diagnostic: boundedError(error) }
      }
      if (options.signal?.aborted) throw new Error('WORKFLOW_CANCELLED')
      const validation = validateUsableAcquisitionPayload(raw)
      if (validation.status !== 'usable') return { status: validation.status === 'empty' ? 'NO_DATA' : 'SOURCE_ERROR', diagnostic: validation.reason }
      const retrievedAt = options.now()
      let rows = dataRows(raw)
      if (operationId === 'akshare.financialData' && akshare.financialStatements && requirement.consumer.workflow === 'company-deep-research') {
        try {
          const statementRows = dataRows(await acquisitionStep({ activityId: 'akshare.financialstatements', providerId: 'akshare', step: 'structured_data', signal: options.signal, timeoutMs: 60_000, deadlineAt: options.acquisitionDeadlineAt, onProgress: options.onProgress }, (signal) => akshare.financialStatements!({ symbol, signal })))
          const byDate = new Map(statementRows.map((row) => [normalizeProviderDate(row.REPORT_DATE ?? row.report_date, true), row]))
          rows = rows.map((row) => {
            const statement = byDate.get(normalizeProviderDate(row.REPORT_DATE ?? row.report_date, true))
            const indicatorRevenue = numeric(row.operating_revenue ?? row.TOTALOPERATEREVE)
            const statementRevenue = numeric(statement?.TOTAL_OPERATE_INCOME)
            const sourceConflicts = indicatorRevenue !== undefined && statementRevenue !== undefined && indicatorRevenue !== statementRevenue ? [{ metric: 'revenue', indicatorValue: indicatorRevenue, statementValue: statementRevenue }] : []
            const indicatorProfit = numeric(row.net_profit ?? row.PARENTNETPROFIT)
            const statementProfit = numeric(statement?.PARENT_NETPROFIT)
            if (indicatorProfit !== undefined && statementProfit !== undefined && indicatorProfit !== statementProfit) sourceConflicts.push({ metric: 'netProfit', indicatorValue: indicatorProfit, statementValue: statementProfit })
            for (const [metric, alias, field] of COMPANY_DEBT_FIELDS) {
              const indicatorValue = numeric(row[metric] ?? row[alias] ?? row[field])
              const statementValue = numeric(statement?.[field])
              if (indicatorValue !== undefined && statementValue !== undefined && indicatorValue !== statementValue) sourceConflicts.push({ metric, indicatorValue, statementValue })
            }
            return { ...statement, ...row, sourceConflicts }
          })
        } catch (error) {
          if (options.signal?.aborted) throw new Error('WORKFLOW_CANCELLED')
          await options.onProgress?.({ activityId: 'akshare.financialstatements:outcome', providerId: 'akshare', step: 'structured_data', status: 'failed', startedAt: options.now(), completedAt: options.now(), diagnosticCode: boundedError(error) })
        }
      }
      if (rows.length === 0) return { status: 'NO_DATA', diagnostic: 'AKShare returned no structured rows' }
      const data = operationId === 'akshare.companyBasic' ? normalizeProfile(rows, retrievedAt, requirement.asOfMode)
        : operationId === 'akshare.financialData' || operationId === 'akshare.financialStatements' ? normalizeFinancial(rows, requirement, retrievedAt)
          : normalizeMarket(rows, requirement, retrievedAt)
      if (data.kind !== 'profile' && data.rows.length === 0) return { status: 'NO_DATA', diagnostic: 'No eligible structured observations' }
      if (data.kind === 'profile' && data.fields.length === 0) return { status: 'NO_DATA', diagnostic: 'No usable company profile fields' }
      const source = { retrievalProvider: 'AKShare', originPublisher: operationId.endsWith('Tencent') ? 'Tencent' : 'EastMoney', sourceUrl: operationId.endsWith('Tencent') ? `https://gu.qq.com/${symbol.startsWith('6') ? 'sh' : 'sz'}${symbol}/zs` : eastmoneyCompanyUrl(options.company), retrievedAt,
        ...(data.kind === 'market' && requirement.asOfMode === 'HISTORICAL' && data.rows.at(-1) ? { observedAt: data.rows.at(-1)!.observedAt, observationAvailableAt: dailyCloseAvailableAt(data.rows.at(-1)!.observedAt) } : {}),
        ...(data.kind === 'market' && requirement.asOfMode !== 'HISTORICAL' ? { valueVersion: { status: 'UNVERIFIED', reason: 'Current market snapshot has no historical value-version proof' } as const } : {}),
        ...(data.kind === 'financial' ? { valueVersion: { status: 'UNVERIFIED', reason: 'Historical financial value version is not identified' } as const } : {}) }
      return { status: 'SUCCESS', data, source }
    }
    if (operationId === 'cninfo.discoverFetchNormalizeCompanyEvidence' || operationId === 'gdelt.discoverFetchNormalizeCompanyEvidence') {
      const plugin = operationId.startsWith('cninfo.') ? options.officialDisclosure : options.gdelt
      if (!plugin) return { status: 'UNSUPPORTED', diagnostic: `${operationId} plugin is unavailable` }
      return acquireDocuments(plugin, operationId.startsWith('cninfo.') ? 'CNINFO' : 'GDELT', requirement, options)
    }
    if (operationId === 'publicWeb.discoverFetchNormalizeCompanyEvidence') return options.publicWeb ? acquireDocuments(options.publicWeb, 'PUBLIC_WEB', requirement, options) : { status: 'UNSUPPORTED', diagnostic: 'Public web adapter unavailable' }
    if (operationId === 'cninfo.companyFinancialHistory') {
      if (!options.officialDisclosure) return { status: 'UNSUPPORTED', diagnostic: 'Official statements plugin unavailable' }
      const result = await acquireDocuments(options.officialDisclosure, 'CNINFO', requirement, options)
      if (result.status !== 'SUCCESS' || result.data?.kind !== 'evidence') return { status: 'SOURCE_ERROR', diagnostic: 'OFFICIAL_FINANCIAL_DOCUMENT_ACQUISITION_FAILED' }
      const rows = result.data.documents.flatMap((document) => extractOfficialAnnualFinancials(document.record)).map((row) => ({ ...row, pointInTimeStatus: requirement.asOfMode === 'CURRENT_VALUE_ONLY' ? 'CURRENT_VALUE_ONLY' as const : 'UNVERIFIED' as const }))
      if (!rows.length) return { status: 'NO_DATA', diagnostic: 'OFFICIAL_ANNUAL_FINANCIAL_TABLE_NOT_VERIFIABLE' }
      return { status: 'SUCCESS', data: { kind: 'financial', rows, retrievedAt: options.now(), pointInTimeStatus: requirement.asOfMode === 'CURRENT_VALUE_ONLY' ? 'CURRENT_VALUE_ONLY' : 'UNVERIFIED' }, source: { retrievalProvider: 'CNINFO', originPublisher: 'CNINFO', sourceUrl: result.data.documents.find((document) => extractOfficialAnnualFinancials(document.record).length)?.record.canonicalUrl, retrievedAt: options.now(), valueVersion: { status: 'UNVERIFIED', reason: 'Annual report numeric fallback is not a historical value-version proof' } } }
    }
    return { status: 'UNSUPPORTED', diagnostic: `UNKNOWN_COMPANY_RESEARCH_OPERATION:${operationId}` }
  }
  const execute = async (requirement: DataRequirement, operationId: string) => {
    const result = await executeOperation(requirement, operationId)
    if (operationId.startsWith('akshare.') && result.status !== 'SUCCESS') {
      const timestamp = options.now()
      await options.onProgress?.({ activityId: `${operationId.toLowerCase()}:outcome`, providerId: 'akshare', step: 'structured_data',
        status: result.diagnostic?.includes('TIMEOUT') || result.diagnostic?.includes('BUDGET_EXCEEDED') ? 'timeout' : 'failed', startedAt: timestamp, completedAt: timestamp,
        diagnosticCode: result.diagnostic?.includes('BUDGET_EXCEEDED') ? 'ACQUISITION_BUDGET_EXCEEDED' : 'PROVIDER_NO_USABLE_DATA' })
    }
    return result
  }
  return new DataResolver<CompanyResearchDataPayload>({
    policies,
    now: options.now,
    signal: options.signal,
    // resolveAcquisition below is the sole execution path for these explicit operations.
    executor: async () => ({ status: 'UNSUPPORTED', diagnostic: 'Use the explicit Company research acquisition path' }),
    resolveAcquisition: async (requirement): Promise<AcquisitionResult<CompanyResearchDataPayload>> => {
      const acquired = await runResearchDataAcquisition<RawCompanyResearchDataPayload>({
        requirement, policies, now: options.now, signal: options.signal,
        executor: (item, candidate) => execute(item, candidate.operationId),
      })
      if (requirement.metricId !== 'company_research_evidence') return acquired as AcquisitionResult<CompanyResearchDataPayload>
      return finalizeResearchEvidence(requirement, acquired as AcquisitionResult<UnqualifiedResearchEvidenceBatch<NormalizedResearchSource>>)
    },
  })
}

async function acquireDocuments(
  plugin: ResearchAcquisitionPlugin,
  provider: 'CNINFO' | 'GDELT' | 'PUBLIC_WEB',
  requirement: DataRequirement,
  options: CompanyResearchDataResolverOptions,
): Promise<SourceExecutionResult<RawCompanyResearchDataPayload>> {
  const company = requirement.subject.ticker === options.company.symbol ? options.company : { symbol: requirement.subject.ticker!, name: requirement.subject.companyId }
  let discovered: readonly NormalizedResearchSource['candidate'][]
  try {
    discovered = await acquisitionStep({ activityId: `${provider.toLowerCase()}:discovery`, providerId: provider.toLowerCase(), step: 'discovery',
      signal: options.signal, timeoutMs: 60_000, deadlineAt: options.acquisitionDeadlineAt, onProgress: options.onProgress }, (signal) => plugin.discover({ company, asOf: requirement.analysisAsOf ?? requirement.asOf, limitPerKind: Math.max(0, Math.min(20, options.limitPerSource ?? 6)), ...(requirement.consumer.workflow === 'company-deep-research' ? { researchPurpose: 'company_research' as const, searchTerms: options.evidenceSearchTerms } : {}) }, signal))
  } catch (error) {
    if (options.signal?.aborted || (error instanceof Error && error.message === 'WORKFLOW_CANCELLED')) throw new Error('WORKFLOW_CANCELLED')
    return { status: 'SOURCE_ERROR', diagnostic: boundedError(error) }
  }
  if (options.signal?.aborted) throw new Error('WORKFLOW_CANCELLED')
  const selected = provider === 'PUBLIC_WEB' ? undefined : await options.onCandidatesDiscovered?.({ provider, candidates: discovered, requirement })
  if (options.signal?.aborted) throw new Error('WORKFLOW_CANCELLED')
  const originalCandidates = new Set(discovered)
  const eligible = selected === undefined ? discovered : selected.filter((candidate) => originalCandidates.has(candidate))
  const documents: ResearchEvidenceInput<NormalizedResearchSource>[] = []
  const diagnostics: string[] = []
  let fetched = 0
  let fetchSucceeded = false
  let failed = 0
  let empty = 0
  let rejected = discovered.length - eligible.length
  if (rejected > 0) diagnostics.push(`consumer_pre_fetch_guard_rejected:${rejected}`)
  for (const candidate of eligible.slice(0, Math.max(0, Math.min(20, options.limitPerSource ?? 6)))) {
    if (options.signal?.aborted) throw new Error('WORKFLOW_CANCELLED')
    if (options.acquisitionDeadlineAt !== undefined && Date.now() >= options.acquisitionDeadlineAt) { diagnostics.push('ACQUISITION_BUDGET_EXCEEDED'); failed += 1; break }
    const candidateDate = candidate.publishedAt ?? (provider === 'GDELT' && candidate.snippet ? candidate.snippet : undefined)
    const dateStatus = qualifyResearchEvidenceDate(candidateDate, requirement)
    if (dateStatus === 'INVALID' || dateStatus === 'FUTURE' || dateStatus === 'OUTSIDE_PERIOD') { rejected += 1; diagnostics.push(`${candidate.candidateId}:${dateStatus}`); continue }
    try {
      const fetchOptions: ResearchFetchOptions | undefined = options.acquisitionDeadlineAt === undefined ? undefined : { downloadTimeoutMs: 30_000, parseTimeoutMs: 120_000, deadlineAt: options.acquisitionDeadlineAt, onProgress: options.onProgress }
      const internalProgress = plugin instanceof OfficialDisclosureResearchPlugin || plugin instanceof GdeltResearchPlugin
      // The outer limit also bounds custom adapters; production adapters separately report download/body/parse.
      const fetchedSource = options.acquisitionDeadlineAt === undefined ? await plugin.fetch(candidate, options.signal) : await acquisitionStep({ activityId: `${candidate.candidateId}:fetch`, providerId: provider.toLowerCase(), step: 'download', sourceTitle: candidate.title,
        signal: options.signal, timeoutMs: 150_000, deadlineAt: options.acquisitionDeadlineAt, onProgress: internalProgress ? undefined : options.onProgress }, (signal) => plugin.fetch(candidate, signal, fetchOptions))
      if (options.signal?.aborted) throw new Error('WORKFLOW_CANCELLED')
      fetchSucceeded = true
      const fetchedValidation = validateUsableAcquisitionPayload(fetchedSource.content)
      if (fetchedValidation.status !== 'usable') { fetchedValidation.status === 'empty' ? empty += 1 : failed += 1; diagnostics.push(`${candidate.candidateId}:${fetchedValidation.reason}`); continue }
      const normalized = options.acquisitionDeadlineAt === undefined ? await plugin.normalize(fetchedSource, options.signal) : await acquisitionStep({ activityId: `${candidate.candidateId}:normalize`, providerId: provider.toLowerCase(), step: 'parsing', sourceTitle: candidate.title,
        signal: options.signal, timeoutMs: 120_000, deadlineAt: options.acquisitionDeadlineAt, onProgress: internalProgress ? undefined : options.onProgress }, (signal) => plugin.normalize(fetchedSource, signal, fetchOptions))
      if (options.signal?.aborted) throw new Error('WORKFLOW_CANCELLED')
      const normalizedValidation = validateUsableAcquisitionPayload(normalized.content)
      if (normalizedValidation.status !== 'usable') { normalizedValidation.status === 'empty' ? empty += 1 : failed += 1; diagnostics.push(`${candidate.candidateId}:${normalizedValidation.reason}`); continue }
      fetched += 1
      const originPublisher = provider === 'CNINFO' ? 'CNINFO' : provider === 'PUBLIC_WEB' ? normalized.publisher : reliableOriginalPublisher(candidate)
      documents.push({ record: normalized, publishedAt: candidate.publishedAt, retrievedAt: normalized.retrievedAt, sourceUrl: normalized.canonicalUrl ?? candidate.url, contentHash: normalized.contentHash, retrievalProvider: provider, ...(originPublisher ? { originPublisher } : {}) })
    } catch (error) {
      if (options.signal?.aborted || (error instanceof Error && error.message === 'WORKFLOW_CANCELLED')) throw new Error('WORKFLOW_CANCELLED')
      failed += 1
      diagnostics.push(`${candidate.candidateId}:${boundedError(error)}`)
    }
  }
  const outcome = { transportSucceeded: true, fetchSucceeded, discovered: discovered.length, fetched, failed, empty, rejected, deduplicated: 0, diagnostics }
  return { status: 'SUCCESS', data: { kind: 'evidence', documents, outcome }, source: { retrievalProvider: provider, retrievedAt: options.now() } }
}

function reliableOriginalPublisher(candidate: NormalizedResearchSource['candidate']): string | undefined {
  const explicit = candidate.metadata?.originalPublisher
  if (typeof explicit === 'string' && explicit.trim() && !/^gdelt$/i.test(explicit.trim())) return explicit.trim()
  return undefined
}

function dataRows(raw: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw.filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null && !Array.isArray(row))
  if (typeof raw === 'object' && raw !== null) {
    const object = raw as Record<string, unknown>
    for (const key of ['data', 'rows', 'records', 'results', 'items']) if (Array.isArray(object[key])) return dataRows(object[key])
    return [object]
  }
  return []
}

function normalizeProfile(rows: readonly Record<string, unknown>[], retrievedAt: string, asOfMode: DataRequirement['asOfMode']): CompanyProfileSnapshot {
  const fields: { name: string; value: string | number | boolean }[] = []
  for (const row of rows) {
    const namedRow = ['item', '字段', 'value', '值'].some((key) => Object.prototype.hasOwnProperty.call(row, key))
    const fieldName = text(row.item) ?? text(row.name) ?? text(row.字段)
    const fieldValue = scalar(row.value ?? row.值)
    if (namedRow) {
      if (fieldName && fieldValue !== undefined) fields.push({ name: fieldName, value: fieldValue })
      continue
    }
    for (const [name, raw] of Object.entries(row)) {
      const value = scalar(raw)
      if (value !== undefined) fields.push({ name, value })
    }
  }
  return { kind: 'profile', fields, retrievedAt, pointInTimeStatus: asOfMode === 'CURRENT_VALUE_ONLY' ? 'CURRENT_VALUE_ONLY' : 'UNVERIFIED' }
}

function normalizeFinancial(rows: readonly Record<string, unknown>[], requirement: DataRequirement, retrievedAt: string): CompanyFinancialHistory {
  const observations: CompanyFinancialObservation[] = []
  for (const row of rows) {
    const periodEnd = normalizeProviderDate(row.report_date ?? row.REPORT_DATE ?? row.reportDate, true)
    const publishedAt = normalizeProviderDate(row.publication_date ?? row.NOTICE_DATE ?? row.publicationDate)
    if (publishedAt && !['QUALIFIED', 'UNKNOWN'].includes(qualifyResearchEvidenceDate(publishedAt, requirement))) continue
    if (periodEnd && !['QUALIFIED', 'UNKNOWN'].includes(qualifyResearchEvidenceDate(periodEnd, requirement))) continue
    const metrics = { revenue: numeric(row.operating_revenue ?? row.TOTALOPERATEREVE ?? row.TOTAL_OPERATE_INCOME), netProfit: numeric(row.net_profit ?? row.PARENTNETPROFIT ?? row.PARENT_NETPROFIT), grossMargin: numeric(row.gross_margin_percent ?? row.gross_margin ?? row.XSMLL), basicEps: numeric(row.basic_eps ?? row.EPSJB), metric: numeric(row.metric ?? row.value),
      operatingCashFlow: numeric(row.operating_cash_flow ?? row.NETCASH_OPERATE), capex: numeric(row.capex ?? row.CONSTRUCT_LONG_ASSET), assets: numeric(row.total_assets ?? row.TOTAL_ASSETS), liabilities: numeric(row.total_liabilities ?? row.TOTAL_LIABILITIES), equity: numeric(row.equity ?? row.TOTAL_PARENT_EQUITY), cash: numeric(row.cash ?? row.MONETARYFUNDS), receivables: numeric(row.receivables ?? row.ACCOUNTS_RECE), inventory: numeric(row.inventory ?? row.INVENTORY), payables: numeric(row.payables ?? row.ACCOUNTS_PAYABLE), cogs: numeric(row.cogs ?? row.OPERATE_COST), researchDevelopment: numeric(row.research_development ?? row.RESEARCH_EXPENSE), operatingProfit: numeric(row.operating_profit ?? row.OPERATE_PROFIT),
      shortTermBorrowings: numeric(row.shortTermBorrowings ?? row.short_term_borrowings ?? row.SHORT_LOAN), longTermBorrowings: numeric(row.longTermBorrowings ?? row.long_term_borrowings ?? row.LONG_LOAN), bondsPayable: numeric(row.bondsPayable ?? row.bonds_payable ?? row.BOND_PAYABLE), currentPortionLongTermDebt: numeric(row.currentPortionLongTermDebt ?? row.current_portion_long_term_debt ?? row.NONCURRENT_LIAB_1YEAR) }
    if (Object.values(metrics).every((value) => value === undefined)) continue
    const basis = row.period_basis === 'QUARTER' ? 'QUARTER' as const : row.period_basis === 'YTD' || row.REPORT_DATE !== undefined || row.operating_revenue !== undefined ? 'YTD' as const : 'UNKNOWN' as const
    const knownYuan = row.TOTALOPERATEREVE !== undefined || row.operating_revenue !== undefined
    const metricMetadata = Object.fromEntries(Object.entries(metrics).filter(([, value]) => value !== undefined).map(([key]) => [key, { unit: key === 'grossMargin' ? 'percent' : key === 'basicEps' ? 'CNY/share' : text(row.unit) ?? (knownYuan ? 'CNY' : 'UNKNOWN'), currency: text(row.currency) ?? (knownYuan || key === 'basicEps' ? 'CNY' : 'UNKNOWN'), basis: ['assets', 'liabilities', 'equity', 'cash', 'receivables', 'inventory', 'payables', ...COMPANY_DEBT_FIELDS.map(([metric]) => metric)].includes(key) ? 'POINT_IN_TIME' as const : basis }]))
    observations.push({ ...(periodEnd ? { periodEnd } : {}), ...(publishedAt ? { publishedAt } : {}), metrics, metricMetadata, ...(Array.isArray(row.sourceConflicts) ? { sourceConflicts: row.sourceConflicts as NonNullable<CompanyFinancialObservation['sourceConflicts']> } : {}), pointInTimeSafe: false, pointInTimeStatus: requirement.asOfMode === 'CURRENT_VALUE_ONLY' ? 'CURRENT_VALUE_ONLY' : 'UNVERIFIED' })
  }
  return { kind: 'financial', rows: observations, retrievedAt, pointInTimeStatus: requirement.asOfMode === 'CURRENT_VALUE_ONLY' ? 'CURRENT_VALUE_ONLY' : 'UNVERIFIED' }
}

function normalizeMarket(rows: readonly Record<string, unknown>[], requirement: DataRequirement, retrievedAt: string): CompanyMarketHistory {
  const observations: CompanyMarketObservation[] = []
  const cutoff = requirement.analysisAsOf ?? requirement.asOf
  const historical = requirement.asOfMode === 'HISTORICAL'
  for (const row of rows) {
    const observedAt = normalizeProviderDate(row.date ?? row.日期 ?? row.trade_date ?? row.交易日期, true)
    if (!observedAt || qualifyResearchEvidenceDate(observedAt, requirement) !== 'QUALIFIED') continue
    if (historical && Date.parse(dailyCloseAvailableAt(observedAt)) > Date.parse(cutoff)) continue
    const values = { open: numeric(row.open ?? row.开盘), high: numeric(row.high ?? row.最高), low: numeric(row.low ?? row.最低), close: numeric(row.close ?? row.收盘), volume: numeric(row.volume ?? row.成交量) }
    if (Object.values(values).every((value) => value === undefined)) continue
    observations.push({ observedAt, ...values, pointInTimeSafe: historical, pointInTimeStatus: historical ? 'PIT_VERIFIED' : 'CURRENT_VALUE_ONLY' })
  }
  const ordered = observations.sort((a, b) => a.observedAt.localeCompare(b.observedAt))
  return { kind: 'market', rows: ordered, retrievedAt, pointInTimeStatus: historical ? 'PIT_VERIFIED' : 'CURRENT_VALUE_ONLY' }
}

function text(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined }
function eastmoneyCompanyUrl(company: ResearchCompanyIdentity): string {
  const exchange = company.exchange?.toUpperCase()
  const market = exchange === 'SH' || exchange === 'SSE' ? 'sh' : 'sz'
  return `https://quote.eastmoney.com/${market}${encodeURIComponent(company.symbol)}.html`
}
function normalizeProviderDate(value: unknown, calendarOnly = false): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value < 10_000_000_000 ? value * 1000 : value)
    return Number.isNaN(date.getTime()) ? String(value) : calendarOnly ? date.toISOString().slice(0, 10) : date.toISOString()
  }
  if (typeof value !== 'string' || !value.trim()) return undefined
  const raw = value.trim()
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(raw)
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`
  const calendar = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}:\d{2}))?$/.exec(raw)
  if (calendar) return calendarOnly || !calendar[2] ? calendar[1] : `${calendar[1]}T${calendar[2]}+08:00`
  return raw
}
function scalar(value: unknown): string | number | boolean | undefined {
  if (typeof value === 'string') return value.trim() || undefined
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  return typeof value === 'boolean' ? value : undefined
}
function numeric(value: unknown): number | undefined { const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value.replace(/,/g, '').replace(/%$/, '')) : Number.NaN; return Number.isFinite(parsed) ? parsed : undefined }
function boundedError(error: unknown): string { return (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, ' ').slice(0, 240) }
