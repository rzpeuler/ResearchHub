import type { SourceAuthority } from '../../data/contracts.ts'
import type { ResolvedDataItem } from '../../data/resolver.ts'
import type { ValuationDataPayload } from '../../plugins/research-acquisition/valuation-data.ts'
import type { AnnualReportPublicationProof } from '../../plugins/research-acquisition/official.ts'
import { dailyCloseAvailableAt } from '../../data/point-in-time.ts'
import type { ValuationBasis } from '../../skills/valuation/contracts.ts'
import { buildValuationBasis, type ValuationFinancialRow, type ValuationMarketObservation } from '../../skills/valuation/financials.ts'

export type ValuationEvidencePitStatus = 'PIT_VERIFIED' | 'PUBLICATION_VERIFIED_VALUE_VERSION_UNVERIFIED' | 'CURRENT_VALUE_ONLY' | 'UNAVAILABLE'
export type ValuationEvidenceMetric = 'marketPrice' | 'eps' | 'bvps'

export interface ValuationNumericSource {
  readonly sourceId?: string
  readonly originPublisher: string
  readonly originAuthority: SourceAuthority
  readonly retrievalProvider: string
  readonly retrievedAt: string
  readonly sourceField: string
  readonly sourceUrl?: string
}

export interface ValuationOfficialPublication {
  readonly originPublisher: 'CNINFO'
  readonly originAuthority: 'S0_STATUTORY'
  readonly publishedAt: string
  readonly sourceUrl: string
  readonly reportTitle: string
  readonly announcementId?: string
}

export interface ValuationMetricEvidence {
  readonly metric: ValuationEvidenceMetric
  readonly value: number
  readonly unit: 'CNY/share'
  readonly reportDate?: string
  readonly priceDate?: string
  readonly dailyCloseAvailableAt?: string
  readonly numericSource: ValuationNumericSource
  readonly officialPublication?: ValuationOfficialPublication
  readonly pitStatus: ValuationEvidencePitStatus
}

export interface ValuationBasisEvidence {
  readonly market: ValuationMetricEvidence
  readonly eps?: ValuationMetricEvidence
  readonly bvps?: ValuationMetricEvidence
  readonly basisFiscalYear?: number
  readonly reportDate?: string
  readonly diagnostics: readonly string[]
}

export interface ValuationBasisResolution {
  readonly basis?: ValuationBasis
  readonly evidence: ValuationBasisEvidence
  readonly pitStatus: ValuationEvidencePitStatus
  readonly diagnostics: readonly string[]
  readonly publication?: ValuationOfficialPublication
}

export interface ResolveValuationBasisEvidenceInput {
  readonly market: ValuationMarketObservation
  readonly financialRows: readonly ValuationFinancialRow[]
  readonly publication?: AnnualReportPublicationProof
  readonly valuationDate: string
  readonly asOf?: string
  readonly now: string
  readonly retrievedAt: string
  readonly marketRetrievedAt: string
  readonly marketSource?: { readonly sourceId?: string; readonly originPublisher?: string; readonly originAuthority?: SourceAuthority; readonly retrievalProvider?: string; readonly sourceUrl?: string }
  readonly marketSourceUrl?: string
  readonly financialSourceUrl?: string
  readonly epsSource?: { readonly sourceId?: string; readonly retrievedAt: string; readonly sourceUrl?: string }
  readonly bvpsSource?: { readonly sourceId?: string; readonly retrievedAt: string; readonly sourceUrl?: string }
}

export type ResolvedValuationMetricItem = ResolvedDataItem<ValuationDataPayload>

/** Only metric-specific, resolver-accepted annual values may enter one FY basis. */
export function mapResolvedValuationFinancialBasis(
  fiscalYear: number,
  epsItem: ResolvedValuationMetricItem | undefined,
  bvpsItem: ResolvedValuationMetricItem | undefined,
): { readonly row?: ValuationFinancialRow; readonly epsItem?: ResolvedValuationMetricItem; readonly bvpsItem?: ResolvedValuationMetricItem; readonly diagnostic?: string } {
  const accepted = (item: ResolvedValuationMetricItem | undefined, metric: 'eps' | 'bvps') => item?.status === 'AVAILABLE' && item.value?.kind === 'financial' && item.value.row.basisFiscalYear === fiscalYear && (item.period?.fiscalYear === undefined || item.period.fiscalYear === fiscalYear) && item.value.row[metric] !== undefined ? item : undefined
  const eps = accepted(epsItem, 'eps')
  const bvps = accepted(bvpsItem, 'bvps')
  const epsRow = eps?.value?.kind === 'financial' ? eps.value.row : undefined
  const bvpsRow = bvps?.value?.kind === 'financial' ? bvps.value.row : undefined
  if (epsRow && bvpsRow && epsRow.reportDate !== bvpsRow.reportDate) return { diagnostic: 'VALUATION_FINANCIAL_PERIOD_CONFLICT' }
  const basis = epsRow ?? bvpsRow
  if (!basis) return {}
  return {
    row: { basisFiscalYear: fiscalYear, reportDate: basis.reportDate, ...(epsRow?.eps === undefined ? {} : { eps: epsRow.eps }), ...(bvpsRow?.bvps === undefined ? {} : { bvps: bvpsRow.bvps }) },
    ...(eps ? { epsItem: eps } : {}),
    ...(bvps ? { bvpsItem: bvps } : {}),
  }
}

export const VALUATION_NUMERIC_TOLERANCE = 1e-9


export function compareValuationNumericObservations(left: number, right: number, tolerance = VALUATION_NUMERIC_TOLERANCE): 'CONSISTENT' | 'SOURCE_CONFLICT' {
  return Math.abs(left - right) <= tolerance ? 'CONSISTENT' : 'SOURCE_CONFLICT'
}

function publicationValue(proof: AnnualReportPublicationProof | undefined): ValuationOfficialPublication | undefined {
  if (proof === undefined) return undefined
  return { originPublisher: proof.originPublisher, originAuthority: proof.originAuthority, publishedAt: proof.officialPublishedAt, sourceUrl: proof.sourceUrl, reportTitle: proof.reportTitle, ...(proof.announcementId === undefined ? {} : { announcementId: proof.announcementId }) }
}

function source(field: string, retrievedAt: string, sourceUrl: string | undefined, sourceId?: string, provenance?: ResolveValuationBasisEvidenceInput['marketSource']): ValuationNumericSource {
  return { originPublisher: provenance?.originPublisher ?? 'EastMoney', originAuthority: provenance?.originAuthority ?? 'S3_AGGREGATOR', retrievalProvider: provenance?.retrievalProvider ?? 'AKShare', retrievedAt, sourceField: field, ...(sourceUrl === undefined ? {} : { sourceUrl }), ...(sourceId === undefined ? {} : { sourceId }) }
}

function metricEvidence(metric: ValuationEvidenceMetric, value: number, input: ResolveValuationBasisEvidenceInput, status: ValuationEvidencePitStatus, publication: ValuationOfficialPublication | undefined): ValuationMetricEvidence {
  const field = metric === 'marketPrice' ? 'close' : metric === 'eps' ? 'EPSJB' : 'BPS'
  const financialSource = metric === 'eps' ? input.epsSource : metric === 'bvps' ? input.bvpsSource : undefined
  const isMarket = metric === 'marketPrice'
  const provenance = isMarket ? input.marketSource : undefined
  return { metric, value, unit: 'CNY/share', ...(isMarket ? { priceDate: input.market.priceDate, dailyCloseAvailableAt: dailyCloseAvailableAt(input.market.priceDate) } : { reportDate: input.financialRows[0]?.reportDate }), numericSource: source(field, isMarket ? input.marketRetrievedAt : financialSource?.retrievedAt ?? input.retrievedAt, isMarket ? input.marketSourceUrl ?? provenance?.sourceUrl : financialSource?.sourceUrl ?? input.financialSourceUrl, isMarket ? provenance?.sourceId : financialSource?.sourceId, provenance), ...(publication === undefined || isMarket ? {} : { officialPublication: publication }), pitStatus: status }
}

export function resolveValuationBasisEvidence(input: ResolveValuationBasisEvidenceInput): ValuationBasisResolution {
  const diagnostics: string[] = []
  const currentMode = input.asOf === undefined
  const cutoff = input.asOf ?? input.now
  const marketStatus: ValuationEvidencePitStatus = currentMode ? 'CURRENT_VALUE_ONLY' : Date.parse(dailyCloseAvailableAt(input.market.priceDate)) <= Date.parse(cutoff) ? 'PIT_VERIFIED' : 'UNAVAILABLE'
  const publication = publicationValue(input.publication)
  const annualRows = input.financialRows.filter((row) => row.reportDate <= input.valuationDate).sort((left, right) => right.basisFiscalYear - left.basisFiscalYear)
  const row = annualRows[0]
  const marketEvidence = metricEvidence('marketPrice', input.market.close, { ...input, financialRows: row === undefined ? input.financialRows : [row] }, marketStatus, undefined)
  if (row === undefined) {
    diagnostics.push('VALUATION_FINANCIAL_BASIS_UNAVAILABLE')
    return { evidence: { market: marketEvidence, diagnostics }, pitStatus: 'UNAVAILABLE', diagnostics }
  }
  if (publication === undefined) diagnostics.push('VALUATION_BASIS_PUBLICATION_UNAVAILABLE')
  else if (Date.parse(publication.publishedAt) > Date.parse(cutoff)) diagnostics.push('DATA_NOT_PUBLISHED')
  if (input.publication && input.publication.fiscalYear !== row.basisFiscalYear) diagnostics.push('VALUATION_BASIS_PUBLICATION_PERIOD_MISMATCH')
  const publicationAvailable = publication !== undefined && input.publication?.fiscalYear === row.basisFiscalYear && Date.parse(publication.publishedAt) <= Date.parse(cutoff)
  const numericStatus: ValuationEvidencePitStatus = !publicationAvailable ? 'UNAVAILABLE' : currentMode ? 'CURRENT_VALUE_ONLY' : 'PUBLICATION_VERIFIED_VALUE_VERSION_UNVERIFIED'
  const eps = row.eps === undefined ? undefined : metricEvidence('eps', row.eps, { ...input, financialRows: [row] }, numericStatus, publication)
  const bvps = row.bvps === undefined ? undefined : metricEvidence('bvps', row.bvps, { ...input, financialRows: [row] }, numericStatus, publication)
  if (eps === undefined) diagnostics.push('VALUATION_BASIS_EPS_UNAVAILABLE')
  if (bvps === undefined) diagnostics.push('VALUATION_BASIS_BVPS_UNAVAILABLE')
  const evidence: ValuationBasisEvidence = { market: marketEvidence, ...(eps === undefined ? {} : { eps }), ...(bvps === undefined ? {} : { bvps }), basisFiscalYear: row.basisFiscalYear, reportDate: row.reportDate, diagnostics }
  if (!publicationAvailable) return { evidence, pitStatus: 'UNAVAILABLE', diagnostics, ...(publication === undefined ? {} : { publication }) }
  if (!currentMode) return { evidence, pitStatus: 'PUBLICATION_VERIFIED_VALUE_VERSION_UNVERIFIED', diagnostics: [...diagnostics, 'VALUATION_BASIS_VALUE_VERSION_UNVERIFIED'], publication }
  if (eps === undefined && bvps === undefined) return { evidence, pitStatus: 'UNAVAILABLE', diagnostics, publication }
  const basisRow: ValuationFinancialRow = { basisFiscalYear: row.basisFiscalYear, reportDate: row.reportDate, ...(row.eps === undefined ? {} : { eps: row.eps }), ...(row.bvps === undefined ? {} : { bvps: row.bvps }) }
  const basis = buildValuationBasis(input.market, basisRow, input.valuationDate, 'verified')
  return { basis, evidence, pitStatus: 'CURRENT_VALUE_ONLY', diagnostics, publication }
}

export function valuationPublicationFromProof(proof: AnnualReportPublicationProof): ValuationOfficialPublication { return publicationValue(proof)! }
