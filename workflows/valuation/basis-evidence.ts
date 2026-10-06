import type { SourceAuthority, DataRequirement, SourcePolicy } from '../research-data-acquisition/contracts.ts'
import type { AnnualReportPublicationProof } from '../../plugins/research-acquisition/official.ts'
import type { ValuationBasis } from '../../skills/valuation/contracts.ts'
import { buildValuationBasis, dailyCloseAvailableAt, type ValuationFinancialRow, type ValuationMarketObservation } from '../../skills/valuation/financials.ts'

export type ValuationEvidencePitStatus = 'PIT_VERIFIED' | 'PUBLICATION_VERIFIED_VALUE_VERSION_UNVERIFIED' | 'CURRENT_VALUE_ONLY' | 'UNAVAILABLE'
export type ValuationEvidenceMetric = 'marketPrice' | 'eps' | 'bvps'

export interface ValuationNumericSource {
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
  readonly marketSourceUrl?: string
  readonly financialSourceUrl?: string
}

export const VALUATION_NUMERIC_TOLERANCE = 1e-9

export const VALUATION_DATA_REQUIREMENTS: readonly DataRequirement[] = [
  { id: 'valuation_market_price', consumer: { workflow: 'valuation', capability: 'market_price' }, subject: {}, dataKind: 'timeseries', metricId: 'valuation_market_price', asOf: '1970-01-01T00:00:00.000Z', determinismClass: 'AUTHORITATIVE_NUMERIC', requiredFields: ['date', 'close'], minimumAuthority: 'S3_AGGREGATOR', llmWebFallback: 'FORBIDDEN' },
  { id: 'valuation_eps', consumer: { workflow: 'valuation', capability: 'annual_financial_basis' }, subject: {}, dataKind: 'metric', metricId: 'valuation_eps', asOf: '1970-01-01T00:00:00.000Z', determinismClass: 'AUTHORITATIVE_NUMERIC', requiredFields: ['REPORT_DATE', 'EPSJB'], minimumAuthority: 'S3_AGGREGATOR', llmWebFallback: 'FORBIDDEN' },
  { id: 'valuation_bvps', consumer: { workflow: 'valuation', capability: 'annual_financial_basis' }, subject: {}, dataKind: 'metric', metricId: 'valuation_bvps', asOf: '1970-01-01T00:00:00.000Z', determinismClass: 'AUTHORITATIVE_NUMERIC', requiredFields: ['REPORT_DATE', 'BPS'], minimumAuthority: 'S3_AGGREGATOR', llmWebFallback: 'FORBIDDEN' },
  { id: 'valuation_annual_report_publication', consumer: { workflow: 'valuation', capability: 'annual_report_publication' }, subject: {}, dataKind: 'document', metricId: 'valuation_annual_report_publication', asOf: '1970-01-01T00:00:00.000Z', determinismClass: 'EVIDENCE_BACKED_NUMERIC', requiredFields: ['fiscalYear', 'officialPublishedAt', 'sourceUrl'], minimumAuthority: 'S0_STATUTORY', llmWebFallback: 'FORBIDDEN' },
]

export const VALUATION_SOURCE_POLICIES: readonly SourcePolicy[] = [
  { policyId: 'valuation-market-price-eastmoney', requirementMatch: { workflow: 'valuation', metricId: 'valuation_market_price' }, selectionMode: 'FIRST_VALID', candidates: [{ sourceId: 'akshare-historical-market-data', fallbackLevel: 'PRIMARY', originPublisher: 'EastMoney', originAuthority: 'S3_AGGREGATOR', operationId: 'akshare.historicalMarketData', supports: { dataKinds: ['timeseries'], metricIds: ['valuation_market_price'] } }] },
  { policyId: 'valuation-eps-eastmoney', requirementMatch: { workflow: 'valuation', metricId: 'valuation_eps' }, selectionMode: 'FIRST_VALID', candidates: [{ sourceId: 'akshare-valuation-financial-indicators-eps', fallbackLevel: 'PRIMARY', originPublisher: 'EastMoney', originAuthority: 'S3_AGGREGATOR', operationId: 'akshare.valuationFinancialIndicators', supports: { dataKinds: ['metric'], metricIds: ['valuation_eps'] } }] },
  { policyId: 'valuation-bvps-eastmoney', requirementMatch: { workflow: 'valuation', metricId: 'valuation_bvps' }, selectionMode: 'FIRST_VALID', candidates: [{ sourceId: 'akshare-valuation-financial-indicators-bvps', fallbackLevel: 'PRIMARY', originPublisher: 'EastMoney', originAuthority: 'S3_AGGREGATOR', operationId: 'akshare.valuationFinancialIndicators', supports: { dataKinds: ['metric'], metricIds: ['valuation_bvps'] } }] },
  { policyId: 'valuation-annual-publication-cninfo', requirementMatch: { workflow: 'valuation', metricId: 'valuation_annual_report_publication' }, selectionMode: 'FIRST_VALID', candidates: [{ sourceId: 'cninfo-annual-report-publication', fallbackLevel: 'PRIMARY', originPublisher: 'CNINFO', originAuthority: 'S0_STATUTORY', operationId: 'cninfo.resolveAnnualReportPublication', supports: { dataKinds: ['document'], metricIds: ['valuation_annual_report_publication'] } }] },
]

export function compareValuationNumericObservations(left: number, right: number, tolerance = VALUATION_NUMERIC_TOLERANCE): 'CONSISTENT' | 'SOURCE_CONFLICT' {
  return Math.abs(left - right) <= tolerance ? 'CONSISTENT' : 'SOURCE_CONFLICT'
}

function publicationValue(proof: AnnualReportPublicationProof | undefined): ValuationOfficialPublication | undefined {
  if (proof === undefined) return undefined
  return { originPublisher: proof.originPublisher, originAuthority: proof.originAuthority, publishedAt: proof.officialPublishedAt, sourceUrl: proof.sourceUrl, reportTitle: proof.reportTitle, ...(proof.announcementId === undefined ? {} : { announcementId: proof.announcementId }) }
}

function source(field: string, retrievedAt: string, sourceUrl: string | undefined): ValuationNumericSource {
  return { originPublisher: 'EastMoney', originAuthority: 'S3_AGGREGATOR', retrievalProvider: 'AKShare', retrievedAt, sourceField: field, ...(sourceUrl === undefined ? {} : { sourceUrl }) }
}

function metricEvidence(metric: ValuationEvidenceMetric, value: number, input: ResolveValuationBasisEvidenceInput, status: ValuationEvidencePitStatus, publication: ValuationOfficialPublication | undefined): ValuationMetricEvidence {
  const field = metric === 'marketPrice' ? 'close' : metric === 'eps' ? 'EPSJB' : 'BPS'
  return { metric, value, unit: 'CNY/share', ...(metric === 'marketPrice' ? { priceDate: input.market.priceDate, dailyCloseAvailableAt: dailyCloseAvailableAt(input.market.priceDate) } : { reportDate: input.financialRows[0]?.reportDate }), numericSource: source(field, metric === 'marketPrice' ? input.marketRetrievedAt : input.retrievedAt, metric === 'marketPrice' ? input.marketSourceUrl : input.financialSourceUrl), ...(publication === undefined || metric === 'marketPrice' ? {} : { officialPublication: publication }), pitStatus: status }
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
  const publicationAvailable = publication !== undefined && Date.parse(publication.publishedAt) <= Date.parse(cutoff)
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
