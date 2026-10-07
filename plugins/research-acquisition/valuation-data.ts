import { DataResolver } from '../../data/resolver.ts'
import type { DataRequirement, SourceExecutionResult } from '../../data/contracts.ts'
import { PHASE2_COMMON_SOURCE_POLICIES } from '../../data/valuation-earnings-policies.ts'
import type { ValuationFinancialRow, ValuationMarketObservation } from '../../skills/valuation/financials.ts'
import { dailyCloseAvailableAt } from '../../data/point-in-time.ts'
import { normalizeValuationFinancialData, normalizeValuationMarketData } from './valuation-normalization.ts'
import type { ResearchCompanyIdentity } from './contracts.ts'
import type { AkshareDataClient, AksharePeerComparisonFamily } from './akshare.ts'
import type { AnnualReportPublicationProof, OfficialDisclosureClient } from './official.ts'
import type { AutomaticPeerGrowthProfile, AutomaticPeerProfitabilityProfile } from '../../skills/comps_valuation/index.ts'

export type ValuationDataPayload =
  | { readonly kind: 'market'; readonly raw: unknown; readonly observation: ValuationMarketObservation; readonly retrievedAt: string }
  | { readonly kind: 'financial'; readonly raw: unknown; readonly rows: readonly ValuationFinancialRow[]; readonly row: ValuationFinancialRow; readonly retrievedAt: string }
  | { readonly kind: 'publication'; readonly proof: AnnualReportPublicationProof; readonly retrievedAt: string }
  | { readonly kind: 'peer'; readonly raw: unknown; readonly rows: readonly Record<string, unknown>[]; readonly retrievedAt: string }

/** Domain comparison family and exact lookup are operation arguments, not source policy choices. */
export interface ValuationPeerRequirement extends DataRequirement {
  readonly comparisonFamily?: AksharePeerComparisonFamily
  readonly correlatedTicker?: string
}

export interface ValuationDataCompositionOptions {
  readonly akshare?: AkshareDataClient
  readonly officialDisclosure?: OfficialDisclosureClient
  readonly now: () => string
  readonly signal?: AbortSignal
  readonly valuationDate: string
  readonly historicalAsOf?: string
  readonly company: ResearchCompanyIdentity
}

export function valuationPeerRows(value: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((row): row is Record<string, unknown> => row !== null && typeof row === 'object' && !Array.isArray(row))
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    if (Array.isArray(object.data)) return valuationPeerRows(object.data)
    if (object.result && typeof object.result === 'object') return valuationPeerRows(object.result)
  }
  return []
}

export function valuationPeerText(row: Record<string, unknown>, names: readonly string[]): string | undefined {
  for (const name of names) if (typeof row[name] === 'string' && row[name].trim()) return row[name].trim()
  return undefined
}

export function valuationPeerNumber(row: Record<string, unknown>, names: readonly string[]): number | undefined {
  for (const name of names) {
    const value = row[name]
    const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value.replace(/,/g, '').replace(/%$/, '')) : Number.NaN
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function exchangeOf(value: string | undefined): string | undefined { return value?.toUpperCase().match(/(?:^|\.)(SH|SZ|BSE)$/)?.[1] }
function tickerOf(value: string | undefined): string | undefined { return value?.toUpperCase().match(/\d{6}/)?.[0] }
export function valuationPeerIdentity(row: Record<string, unknown>, target: string): { readonly ticker?: string; readonly exchange?: string; readonly companyId?: string; readonly name?: string } {
  const direct = valuationPeerText(row, ['SECUCODE', 'secuCode', 'SECURITY_CODE', 'securityCode'])
  const correlated = valuationPeerText(row, ['CORRE_SECUCODE', 'CORRE_SECURITY_CODE', 'correSecucode'])
  const selected = correlated && tickerOf(correlated) !== target ? correlated : direct ?? correlated
  const ticker = tickerOf(selected) ?? tickerOf(valuationPeerText(row, ['SECURITY_CODE', 'CORRE_SECURITY_CODE']))
  const exchange = exchangeOf(selected) ?? (ticker?.startsWith('6') ? 'SH' : ticker === undefined ? undefined : 'SZ')
  return { ticker, exchange, companyId: ticker && exchange ? `${ticker}.${exchange}` : undefined, name: valuationPeerText(row, ['SECURITY_NAME_ABBR', 'CORRE_SECURITY_NAME', 'SECURITY_NAME']) }
}

export function valuationPeerReportDate(row: Record<string, unknown>): string | undefined { return valuationPeerText(row, ['REPORT_DATE', 'report_date']) }
export function valuationPeerReportType(row: Record<string, unknown>): string | undefined { return valuationPeerText(row, ['REPORT_TYPE', 'report_type']) }
export function valuationPeerScale(row: Record<string, unknown>): { readonly marketCap?: number; readonly freeFloatMarketCap?: number } { return { marketCap: valuationPeerNumber(row, ['TOTAL_CAP']), freeFloatMarketCap: valuationPeerNumber(row, ['FREECAP']) } }
export function valuationPeerProfile(growthRow?: Record<string, unknown>, dupontRow?: Record<string, unknown>): { readonly growth?: AutomaticPeerGrowthProfile; readonly profitability?: AutomaticPeerProfitabilityProfile } {
  const growth = growthRow === undefined ? undefined : { ...(valuationPeerNumber(growthRow, ['YYSR_3Y']) === undefined ? {} : { revenueGrowth3Y: valuationPeerNumber(growthRow, ['YYSR_3Y']) }), ...(valuationPeerNumber(growthRow, ['JLR_3Y']) === undefined ? {} : { netProfitGrowth3Y: valuationPeerNumber(growthRow, ['JLR_3Y']) }), ...(valuationPeerNumber(growthRow, ['MGSY_3Y']) === undefined ? {} : { epsGrowth3Y: valuationPeerNumber(growthRow, ['MGSY_3Y']) }) }
  const profitability = dupontRow === undefined ? undefined : { ...(valuationPeerNumber(dupontRow, ['ROE_AVG']) === undefined ? {} : { roe: valuationPeerNumber(dupontRow, ['ROE_AVG']) }), ...(valuationPeerNumber(dupontRow, ['XSJLL_AVG']) === undefined ? {} : { netMargin: valuationPeerNumber(dupontRow, ['XSJLL_AVG']) }), ...(valuationPeerNumber(dupontRow, ['TOAZZL_AVG']) === undefined ? {} : { assetTurnover: valuationPeerNumber(dupontRow, ['TOAZZL_AVG']) }) }
  return { ...(growth && Object.keys(growth).length ? { growth } : {}), ...(profitability && Object.keys(profitability).length ? { profitability } : {}) }
}

/** Legacy companyBasic call is compatibility telemetry and never evidence. */
export async function valuationCompanyBasicTelemetry(client: AkshareDataClient | undefined, symbol: string): Promise<{ readonly rowCount: number; readonly error?: string }> {
  if (!client) return { rowCount: 0, error: 'AKShare client is unavailable' }
  try { return { rowCount: valuationPeerRows(await client.companyBasic({ symbol })).length } }
  catch (error) { return { rowCount: 0, error: error instanceof Error ? error.message : String(error) } }
}

/** Explicit operation bindings for the Valuation DataResolver. */
export function createValuationDataResolver(options: ValuationDataCompositionOptions): DataResolver<ValuationDataPayload> {
  const financial = new Map<string, Promise<{ readonly raw: unknown; readonly rows: readonly ValuationFinancialRow[]; readonly retrievedAt: string }>>()
  const loadFinancial = (symbol: string, operation: 'akshare.valuationFinancialIndicators' | 'akshare.financialData') => {
    const key = `${operation}:${symbol}`
    let pending = financial.get(key)
    if (!pending) {
      pending = (async () => {
        const akshare = options.akshare
        if (!akshare) throw new Error('AKShare client is unavailable')
        const raw = operation === 'akshare.valuationFinancialIndicators'
          ? await akshare.valuationFinancialIndicators!({ symbol })
          : await akshare.financialData({ symbol })
        return { raw, rows: normalizeValuationFinancialData(raw).rows, retrievedAt: options.now() }
      })()
      financial.set(key, pending)
    }
    return pending
  }
  return new DataResolver<ValuationDataPayload>({
    policies: PHASE2_COMMON_SOURCE_POLICIES,
    now: options.now,
    signal: options.signal,
    executor: async (requirement, candidate): Promise<SourceExecutionResult<ValuationDataPayload>> => {
      const symbol = requirement.subject.ticker
      if (!symbol) return { status: 'UNSUPPORTED', diagnostic: 'VALUATION_TICKER_REQUIRED' }
      const akshare = options.akshare
      if (candidate.operationId === 'akshare.historicalMarketData') {
        if (!akshare) return { status: 'UNSUPPORTED', diagnostic: 'AKShare client is unavailable' }
        const raw = await akshare.historicalMarketData({ symbol })
        const retrievedAt = options.now()
        const normalized = normalizeValuationMarketData(raw, requirement.period?.end ?? options.valuationDate, requirement.analysisAsOf)
        if (!normalized.observation) return { status: 'NO_DATA', diagnostic: normalized.diagnostics.join('|') || 'valuation_market_data_unavailable' }
        const observation = normalized.observation
        return { status: 'SUCCESS', data: { kind: 'market', raw, observation, retrievedAt }, source: { originPublisher: 'EastMoney', retrievalProvider: 'AKShare', sourceUrl: 'https://push2his.eastmoney.com/api/qt/kline/get', retrievedAt, observedAt: observation.priceDate, observationAvailableAt: dailyCloseAvailableAt(observation.priceDate) } }
      }
      if (candidate.operationId === 'akshare.valuationFinancialIndicators' || candidate.operationId === 'akshare.financialData') {
        if (!akshare || (candidate.operationId === 'akshare.valuationFinancialIndicators' && !akshare.valuationFinancialIndicators)) return { status: 'UNSUPPORTED', diagnostic: 'valuation_financial_operation_unavailable' }
        const snapshot = await loadFinancial(symbol, candidate.operationId)
        const row = requirement.period?.fiscalYear === undefined
          ? snapshot.rows.find((item) => item.reportDate <= (requirement.period?.end ?? options.valuationDate))
          : snapshot.rows.find((item) => item.basisFiscalYear === requirement.period!.fiscalYear && item.reportDate <= (requirement.period?.end ?? options.valuationDate))
        if (!row) return { status: 'NO_DATA', diagnostic: 'valuation_annual_financial_basis_unavailable' }
        const value = requirement.metricId === 'valuation_eps' ? row.eps : row.bvps
        if (value === undefined) return { status: 'NO_DATA', diagnostic: `valuation_${requirement.metricId === 'valuation_eps' ? 'epsjb' : 'bps'}_unavailable` }
        return { status: 'SUCCESS', data: { kind: 'financial', raw: snapshot.raw, rows: snapshot.rows, row, retrievedAt: snapshot.retrievedAt }, source: { originPublisher: 'EastMoney', retrievalProvider: 'AKShare', sourceUrl: 'https://datacenter.eastmoney.com/securities/api/data/get', retrievedAt: snapshot.retrievedAt, ...(row.publicationDate ? { publishedAt: `${row.publicationDate}T00:00:00.000Z` } : {}), valueVersion: { status: 'UNVERIFIED', reason: 'Aggregator historical numeric revision is not identified' } } }
      }
      if (candidate.operationId === 'cninfo.resolveAnnualReportPublication') {
        const resolver = options.officialDisclosure?.resolveAnnualReportPublication
        if (!resolver || requirement.period?.fiscalYear === undefined) return { status: 'NO_DATA', diagnostic: 'cninfo_annual_report_publication_unavailable' }
        const company = symbol === options.company.symbol ? options.company : { symbol, name: requirement.subject.companyId ?? symbol, exchange: symbol.startsWith('6') ? 'SSE' : 'SZSE' }
        const proof = await resolver.call(options.officialDisclosure, { company, fiscalYear: requirement.period.fiscalYear, ...(options.historicalAsOf ? { asOf: options.historicalAsOf } : {}) })
        if (!proof) return { status: 'NO_DATA', diagnostic: 'cninfo_annual_report_publication_not_found' }
        return { status: 'SUCCESS', data: { kind: 'publication', proof, retrievedAt: proof.retrievedAt }, source: { originPublisher: 'CNINFO', retrievalProvider: 'CNINFO', sourceUrl: proof.sourceUrl, publishedAt: proof.officialPublishedAt, retrievedAt: proof.retrievedAt } }
      }
      if (candidate.operationId === 'akshare.peerComparison') {
        const peer = requirement as ValuationPeerRequirement
        if (!akshare?.peerComparison || !peer.comparisonFamily) return { status: 'UNSUPPORTED', diagnostic: 'PEER_COMPARISON_UNAVAILABLE' }
        const raw = await akshare.peerComparison({ symbol, family: peer.comparisonFamily, ...(peer.correlatedTicker ? { correlatedSymbol: peer.correlatedTicker } : {}) })
        const retrievedAt = options.now()
        return { status: 'SUCCESS', data: { kind: 'peer', raw, rows: valuationPeerRows(raw), retrievedAt }, source: { originPublisher: 'EastMoney', retrievalProvider: 'ResearchHub direct HTTP', sourceUrl: 'https://datacenter.eastmoney.com/securities/api/data/v1/get', retrievedAt } }
      }
      return { status: 'UNSUPPORTED', diagnostic: `VALUATION_UNKNOWN_SOURCE_OPERATION:${candidate.operationId}` }
    },
  })
}
