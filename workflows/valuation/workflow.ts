import { resolve } from 'node:path'
import { KnowledgeBaseRegistry } from '../../knowledge/registry/registry.ts'
import { KnowledgeProductionGateway } from '../../knowledge/production/gateway.ts'
import type { SemanticProductionProposal } from '../../knowledge/production/contracts.ts'
import type { KnowledgeProductionOutcome } from '../../knowledge/production/contracts.ts'
import { readCanonicalV04Assets } from '../../knowledge/storage/canonical-v04-loader.ts'
import type { NormalizedResearchSource, ResearchCompanyIdentity } from '../../plugins/research-acquisition/contracts.ts'
import type { AnnualReportPublicationProof } from '../../plugins/research-acquisition/official.ts'
import type { AcquisitionSourceMetadata, DataRequirement } from '../../data/contracts.ts'
import { materializePhase2CommonRequirement } from '../../data/requirements.ts'
import type { DataResolver } from '../../data/resolver.ts'
import type { VerifiedSecurityIdentity } from '../../data/security-identity-contracts.ts'
import { createValuationDataResolver, valuationCompanyBasicTelemetry, type ValuationDataPayload } from '../../plugins/research-acquisition/valuation-data.ts'
import { sha256 } from '../../plugins/research-acquisition/hash.ts'
import { normalizeExchange } from '../../skills/knowledge-curation/identity/company-identity.ts'
import { canonicalizeValuationViewpointStatement, deterministicValuationAssumptionStatement, deterministicValuationEvidence, expectedValuationAssumptionStructuredValue, expectedValuationViewpointStructuredValue, validateValuationStructuredValue, ValuationAssumptionDesignSkill, ValuationSynthesisSkill } from '../../skills/valuation/skill.ts'
import { VALUATION_REPORT_SECTIONS, type ValuationAssumptionPlan, type ValuationBasis, type ValuationComputation, type ValuationMethod, type ValuationSynthesisOutput, type ValuationSynthesisProposal } from '../../skills/valuation/contracts.ts'
import { calculateValuation, methodEligibility, referenceMultiples } from '../../skills/valuation/financials.ts'
import type { ValuationFinancialRow, ValuationMarketObservation } from '../../skills/valuation/financials.ts'
import { validateResearchReport, writeResearchReport, type ResearchReport, type ResearchReportSection } from '../../app/services/research-report.ts'
import { executeCompsValuation, type AutomaticEquityCompsResult, type CompsValuationResult } from '../../skills/comps_valuation/index.ts'
import { runResearchQualityGate, type ResearchQualityGateResult } from '../research-quality-gate.ts'
import type { ValuationProviderOutcome, ValuationTelemetrySnapshot, ValuationWorkflowInput, ValuationWorkflowResult } from './contracts.ts'
import { mapResolvedValuationFinancialBasis, resolveValuationBasisEvidence, type ValuationBasisEvidence, type ValuationEvidencePitStatus } from './basis-evidence.ts'
import { buildValuationCrosscheck } from './crosscheck.ts'
import { resolveAutomaticComps, unavailableAutomaticComps } from './automatic-comps.ts'

const safeId = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const DEFAULT_EXCHANGE = (symbol: string): string | undefined => symbol.startsWith('6') ? 'SH' : symbol.startsWith('0') || symbol.startsWith('3') ? 'SZ' : symbol.startsWith('4') || symbol.startsWith('8') ? 'BJ' : undefined
type Dict = Record<string, unknown>

function nowOf(input: ValuationWorkflowInput): () => string { return input.now ?? (() => new Date().toISOString()) }
function abortIfNeeded(signal: AbortSignal | undefined): void { if (signal?.aborted) throw new Error('WORKFLOW_CANCELLED') }
function rowsOf(value: unknown): readonly Dict[] { if (Array.isArray(value)) return value.filter((item): item is Dict => Boolean(item) && typeof item === 'object' && !Array.isArray(item)); if (value && typeof value === 'object' && !Array.isArray(value) && Array.isArray((value as Dict).data)) return rowsOf((value as Dict).data); return [] }
function normalizedCompany(company: ResearchCompanyIdentity): ResearchCompanyIdentity { const exchange = normalizeExchange(company.exchange ?? DEFAULT_EXCHANGE(company.symbol) ?? ''); return { symbol: company.symbol, name: company.name ?? company.symbol, exchange } }
function baseTelemetry(overrides: Partial<ValuationTelemetrySnapshot> = {}): ValuationTelemetrySnapshot { return { companyCoverageResolved: false, marketDataUsable: false, financialBasisUsable: false, pointInTimeVerified: false, eligibleMethods: [], assumptionDesign: { called: false, validated: false, applied: false, fallbackUsed: false, repairAttempts: 0, operation: 'valuation_assumption_design' }, computation: { scenarioCount: 0, calculatedScenarioCount: 0, sensitivityCellCount: 0, deterministicRecomputeStatus: 'unavailable' }, synthesis: { called: false, validated: false, applied: false, fallbackUsed: false, repairAttempts: 0, operation: 'valuation_synthesis' }, modelDerivedInterpretiveSectionCount: 0, proposalCandidateCount: 0, acceptedProposalCount: 0, canonicalSourceCount: 0, canonicalClaimCount: 0, ...overrides } }
function emptyProvider(): ValuationProviderOutcome { return { providerAttempted: false, transportSucceeded: false, marketTransportSucceeded: false, financialTransportSucceeded: false, officialPublicationVerified: false, companyBasicRowCount: 0, financialRowCount: 0, marketRowCount: 0, marketPriceFound: false, fiscalYearBasisFound: false, peEligible: false, pbEligible: false, evEbitdaEligible: false, usableForValuation: false } }
function sameFinancialAcquisition(eps?: { readonly sourceId?: string; readonly retrievedAt: string; readonly sourceUrl?: string } | null, bvps?: { readonly sourceId?: string; readonly retrievedAt: string; readonly sourceUrl?: string } | null): boolean {
  if (!eps || !bvps) return true
  if (eps.retrievedAt !== bvps.retrievedAt || eps.sourceUrl !== bvps.sourceUrl) return false
  const route = (sourceId: string | undefined) => sourceId?.replace(/-(?:eps|bvps)$/, '')
  return eps.sourceId === undefined || bvps.sourceId === undefined || route(eps.sourceId) === route(bvps.sourceId)
}
function companyMatch(value: Dict, company: ResearchCompanyIdentity): boolean { return value.type === 'company' && typeof value.ticker === 'string' && value.ticker === company.symbol && typeof value.exchange === 'string' && normalizeExchange(value.exchange) === company.exchange }
async function existingCompany(input: ValuationWorkflowInput, company: ResearchCompanyIdentity): Promise<{ readonly ref?: string; readonly companyName?: string; readonly claims: readonly Dict[]; readonly reason?: ValuationWorkflowResult['blockedReason'] }> { if (input.useStructuredKnowledge === false) return input.securityIdentity ? { claims: [] } : { reason: 'COMPANY_COVERAGE_NOT_FOUND', claims: [] }; const assets = await readCanonicalV04Assets(input.handle.rootRef); const matches = assets.objects.filter((item) => companyMatch(item.value as unknown as Dict, company)); if (matches.length === 0) return input.securityIdentity ? { claims: [] } : { reason: 'COMPANY_COVERAGE_NOT_FOUND', claims: [] }; if (matches.length > 1) return { reason: 'COMPANY_COVERAGE_AMBIGUOUS', claims: [] }; const gateway = new KnowledgeProductionGateway(new KnowledgeBaseRegistry()); const projection = await gateway.projectExistingKnowledge(input.handle, company); const canonicalCompany = matches[0]!.value as unknown as Dict; return { ref: matches[0]!.value.id, ...(typeof canonicalCompany.name === 'string' ? { companyName: canonicalCompany.name } : {}), claims: projection.filter((item) => item.kind === 'claim' && Array.isArray(item.subjectRefs) && item.subjectRefs.includes(matches[0]!.value.id)).slice(0, 40) }
}
function makeSource(candidateId: string, title: string, data: unknown, company: ResearchCompanyIdentity, retrievedAt: string, metadata: Readonly<Record<string, unknown>>, options: { readonly kind?: 'structured_data' | 'official_disclosure'; readonly provider?: string; readonly publisher?: string; readonly publishedAt?: string; readonly sourceUrl?: string; readonly originAuthority?: string } = {}): NormalizedResearchSource { const content = JSON.stringify(data); return { candidate: { candidateId, kind: options.kind ?? 'structured_data', tier: options.kind === 'official_disclosure' ? 1 : 2, title, provider: options.provider ?? 'akshare', ...(options.publishedAt === undefined ? {} : { publishedAt: options.publishedAt }), metadata: { companySymbol: company.symbol, originPublisher: options.publisher ?? 'EastMoney', originAuthority: options.originAuthority ?? 'S3_AGGREGATOR', retrievalProvider: options.provider ?? 'AKShare', ...(options.sourceUrl === undefined ? {} : { sourceUrl: options.sourceUrl }), ...metadata } }, retrievedAt, title, content, ...(options.sourceUrl === undefined ? {} : { canonicalUrl: options.sourceUrl }), contentHash: sha256(content), publisher: options.publisher ?? 'EastMoney', rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false } } }

async function acquire(input: ValuationWorkflowInput, company: ResearchCompanyIdentity, valuationDate: string, asOf: string | undefined, clock: () => string): Promise<{ readonly dataResolver?: DataResolver<ValuationDataPayload>; readonly marketValue: unknown; readonly financialValue: unknown; readonly financialRows: readonly ValuationFinancialRow[]; readonly market?: ValuationMarketObservation; readonly marketCurrency?: string; readonly marketAdjustmentMethod?: string; readonly marketValueVersionStatus?: string; readonly epsValueVersionStatus?: string; readonly bvpsValueVersionStatus?: string; readonly financialRetrievedAt?: string; readonly marketRetrievedAt?: string; readonly marketSource?: AcquisitionSourceMetadata; readonly epsSource?: { readonly sourceId?: string; readonly retrievedAt: string; readonly sourceUrl?: string }; readonly bvpsSource?: { readonly sourceId?: string; readonly retrievedAt: string; readonly sourceUrl?: string }; readonly publication?: AnnualReportPublicationProof; readonly sources: readonly NormalizedResearchSource[]; readonly providerOutcome: ValuationProviderOutcome; readonly diagnostics: readonly string[] }> {
  if (!input.akshare && !input.dataResolver && !input.dataResolverFactory) return { marketValue: [], financialValue: [], financialRows: [], sources: [], providerOutcome: emptyProvider(), diagnostics: ['AKShare client is unavailable'] }
  const resolver = input.dataResolver ?? input.dataResolverFactory?.({ company, valuationDate, ...(asOf ? { asOf } : {}), now: clock, signal: input.signal }) ?? createValuationDataResolver({ akshare: input.akshare, officialDisclosure: input.officialDisclosure, company, valuationDate, ...(asOf ? { historicalAsOf: asOf } : {}), now: clock, signal: input.signal })
  const analysisAsOf = asOf ?? clock()
  const diagnostics: string[] = []
  const basic = await valuationCompanyBasicTelemetry(input.akshare, company.symbol)
  if (basic.error) diagnostics.push(`companyBasic: ${basic.error}`)
  abortIfNeeded(input.signal)
  const requirement = (metricId: string, fiscalYear?: number): DataRequirement => {
    const discovery = fiscalYear === undefined && metricId !== 'valuation_market_price'
    const materialized = materializePhase2CommonRequirement(metricId, { workflowId: 'valuation', ticker: company.symbol, companyId: company.name, asOf: analysisAsOf, period: { end: valuationDate, ...(metricId === 'valuation_market_price' ? {} : { fiscalYear: fiscalYear ?? Number(valuationDate.slice(0, 4)) - 1 }) }, required: metricId === 'valuation_market_price', historicalNumeric: asOf !== undefined && fiscalYear !== undefined && (metricId === 'valuation_eps' || metricId === 'valuation_bvps') })
    return discovery ? { ...materialized, id: `${materialized.id}:basis-discovery`, period: { end: valuationDate } } : materialized
  }
  // Discover the latest annual row through Data before binding the exact fiscal-year requirements.
  // The executor caches one financial response for both metric identities.
  const first = await resolver.resolve([requirement('valuation_eps'), requirement('valuation_bvps'), requirement('valuation_market_price')])
  abortIfNeeded(input.signal)
  const [epsDiscovery, bvpsDiscovery, marketResult] = first.items
  const discoveredRows = [epsDiscovery, bvpsDiscovery].flatMap((item) => item?.status === 'AVAILABLE' && item.value?.kind === 'financial' ? item.value.rows : [])
  const candidateFiscalYears = [...new Set(discoveredRows.filter((row) => row.reportDate <= valuationDate.slice(0, 10)).map((row) => row.basisFiscalYear))].sort((left, right) => right - left).slice(0, 2)
  const versionRejected = (item: typeof epsDiscovery) => asOf !== undefined && item?.status === 'UNAVAILABLE' && item.attempts.some((attempt) => attempt.status === 'POINT_IN_TIME_INVALID' && attempt.diagnostic?.includes('numeric value version'))
  const discoveryForYear = (item: typeof epsDiscovery, fiscalYear: number) => {
    const row = item?.status === 'AVAILABLE' && item.value?.kind === 'financial' ? item.value.rows.find((candidate) => candidate.basisFiscalYear === fiscalYear) : undefined
    return row && item.value?.kind === 'financial' ? { ...item, period: { ...item.period, fiscalYear }, value: { ...item.value, row } } : item
  }
  const basisAttempts: Array<{ readonly fiscalYear: number; readonly epsResult: typeof epsDiscovery; readonly bvpsResult: typeof bvpsDiscovery; readonly epsAcquisition: typeof epsDiscovery; readonly bvpsAcquisition: typeof bvpsDiscovery; readonly publicationResult: (typeof first.items)[number] }> = []
  let selectedAttempt: (typeof basisAttempts)[number] | undefined
  for (const candidateFiscalYear of candidateFiscalYears) {
    const exact = await resolver.resolve([
      requirement('valuation_eps', candidateFiscalYear),
      requirement('valuation_bvps', candidateFiscalYear),
      requirement('valuation_annual_report_publication', candidateFiscalYear),
    ])
    const [exactEps, exactBvps, exactPublication] = exact.items
    const attempt = {
      fiscalYear: candidateFiscalYear,
      epsResult: (versionRejected(exactEps) ? discoveryForYear(epsDiscovery, candidateFiscalYear) : exactEps) as typeof epsDiscovery,
      bvpsResult: (versionRejected(exactBvps) ? discoveryForYear(bvpsDiscovery, candidateFiscalYear) : exactBvps) as typeof bvpsDiscovery,
      epsAcquisition: exactEps,
      bvpsAcquisition: exactBvps,
      publicationResult: exactPublication,
    }
    basisAttempts.push(attempt)
    const mappedCandidate = mapResolvedValuationFinancialBasis(candidateFiscalYear, attempt.epsResult, attempt.bvpsResult)
    const proof = exactPublication?.status === 'AVAILABLE' && exactPublication.value?.kind === 'publication' && exactPublication.value.proof.fiscalYear === candidateFiscalYear ? exactPublication.value.proof : undefined
    if (mappedCandidate.row && selectedAttempt === undefined) selectedAttempt = attempt
    if (mappedCandidate.row && proof && Date.parse(proof.officialPublishedAt) <= Date.parse(asOf ?? valuationDate)) { selectedAttempt = attempt; break }
  }
  const selectedFiscalYear = selectedAttempt?.fiscalYear
  const epsResult = selectedAttempt?.epsResult ?? epsDiscovery
  const bvpsResult = selectedAttempt?.bvpsResult ?? bvpsDiscovery
  const publicationResult = selectedAttempt?.publicationResult
  const mapped: ReturnType<typeof mapResolvedValuationFinancialBasis> = selectedFiscalYear === undefined ? {} : mapResolvedValuationFinancialBasis(selectedFiscalYear, epsResult, bvpsResult)
  if (mapped.diagnostic) diagnostics.push(mapped.diagnostic)
  const selectedRow = mapped.row
  const financialRows = selectedRow ? [selectedRow] : []
  const financialPayload = mapped.epsItem?.value?.kind === 'financial' ? mapped.epsItem.value : mapped.bvpsItem?.value?.kind === 'financial' ? mapped.bvpsItem.value : undefined
  const financialValue = financialPayload?.kind === 'financial' ? financialPayload.raw : []
  const marketPayload = marketResult?.value
  const market = marketPayload?.kind === 'market' ? marketPayload.observation : undefined
  const marketValue = marketPayload?.kind === 'market' ? marketPayload.raw : []
  const financialRetrievedAt = mapped.epsItem?.source?.retrievedAt ?? mapped.bvpsItem?.source?.retrievedAt
  const marketRetrievedAt = marketResult?.source?.retrievedAt
  const marketSource = marketResult?.source
  const publicationPayload = publicationResult?.value
  const publication = publicationPayload?.kind === 'publication' && publicationPayload.proof.fiscalYear === selectedRow?.basisFiscalYear ? publicationPayload.proof : undefined
  if (publicationPayload?.kind === 'publication' && !publication) diagnostics.push('VALUATION_BASIS_PUBLICATION_PERIOD_MISMATCH')
  const acquisitions = [['market', marketResult], ...basisAttempts.flatMap((attempt) => [['eps', attempt.epsAcquisition], ['bvps', attempt.bvpsAcquisition], ['CNINFO annual publication', attempt.publicationResult]] as const)] as const
  for (const [name, result] of acquisitions) for (const attempt of result?.attempts ?? []) if (attempt.diagnostic) diagnostics.push(`${name}: ${attempt.diagnostic}`)
  const sources: NormalizedResearchSource[] = []
  if (market && marketRetrievedAt) {
    const publisher = marketSource?.originPublisher ?? 'EastMoney'
    sources.push(makeSource(`akshare-valuation-market-${company.symbol}-${market.priceDate}`, `${publisher} valuation market snapshot`, { symbol: company.symbol, priceDate: market.priceDate, close: market.close, currency: 'CNY/share' }, company, marketRetrievedAt, { dataKind: 'valuation-market', valuationEvidenceRole: 'market', priceDate: market.priceDate, sourceField: 'close', ...(marketSource?.sourceId ? { dataPolicySourceId: marketSource.sourceId } : {}) }, { publisher, originAuthority: marketSource?.originAuthority ?? 'S3_AGGREGATOR', provider: marketSource?.retrievalProvider ?? 'AKShare', sourceUrl: marketSource?.sourceUrl }))
  }
  if (selectedRow && financialRetrievedAt) {
    const epsSource = mapped.epsItem?.source
    const bvpsSource = mapped.bvpsItem?.source
    const sharedSource = sameFinancialAcquisition(epsSource, bvpsSource)
    if (sharedSource) sources.push(makeSource(`akshare-valuation-financial-${company.symbol}-${selectedRow.basisFiscalYear}`, 'EastMoney valuation financial basis snapshot', selectedRow, company, financialRetrievedAt, { dataKind: 'valuation-financial', valuationEvidenceRole: 'financial', basisFiscalYear: selectedRow.basisFiscalYear, sourceFields: ['REPORT_DATE', 'NOTICE_DATE', ...(selectedRow.eps === undefined ? [] : ['EPSJB']), ...(selectedRow.bvps === undefined ? [] : ['BPS'])], ...(epsSource ?? bvpsSource ? { dataPolicySourceId: (epsSource ?? bvpsSource)?.sourceId } : {}) }, { publisher: 'EastMoney', originAuthority: 'S3_AGGREGATOR', provider: 'AKShare', sourceUrl: epsSource?.sourceUrl ?? bvpsSource?.sourceUrl }))
    else for (const [metric, item, value] of [['eps', mapped.epsItem, selectedRow.eps], ['bvps', mapped.bvpsItem, selectedRow.bvps]] as const) {
      if (!item?.source || value === undefined) continue
      sources.push(makeSource(`akshare-valuation-financial-${metric}-${company.symbol}-${selectedRow.basisFiscalYear}`, `EastMoney valuation ${metric.toUpperCase()} basis snapshot`, { basisFiscalYear: selectedRow.basisFiscalYear, reportDate: selectedRow.reportDate, [metric]: value }, company, item.source.retrievedAt, { dataKind: 'valuation-financial', valuationEvidenceRole: 'financial', basisFiscalYear: selectedRow.basisFiscalYear, sourceFields: ['REPORT_DATE', metric === 'eps' ? 'EPSJB' : 'BPS'], dataPolicySourceId: item.source.sourceId }, { publisher: 'EastMoney', originAuthority: 'S3_AGGREGATOR', provider: 'AKShare', sourceUrl: item.source.sourceUrl }))
    }
  }
  if (publication) sources.push(makeSource(`cninfo-valuation-annual-report-${company.symbol}-${publication.fiscalYear}`, publication.reportTitle, publication, company, publication.retrievedAt, { dataKind: 'valuation-annual-report-publication', valuationEvidenceRole: 'financial', basisFiscalYear: publication.fiscalYear, sourceField: 'officialPublishedAt' }, { kind: 'official_disclosure', publisher: 'CNINFO', originAuthority: 'S0_STATUTORY', provider: 'CNINFO', publishedAt: publication.officialPublishedAt, sourceUrl: publication.sourceUrl }))
  const marketTransportSucceeded = marketResult?.status === 'AVAILABLE'
  const financialTransportSucceeded = selectedRow !== undefined
  const officialPublicationVerified = publication !== undefined
  const outcome: ValuationProviderOutcome = { providerAttempted: true, transportSucceeded: marketTransportSucceeded || financialTransportSucceeded || officialPublicationVerified, marketTransportSucceeded, financialTransportSucceeded, officialPublicationVerified, companyBasicRowCount: basic.rowCount, financialRowCount: rowsOf(financialValue).length, marketRowCount: rowsOf(marketValue).length, marketPriceFound: market !== undefined, fiscalYearBasisFound: selectedRow !== undefined, peEligible: selectedRow?.eps !== undefined && selectedRow.eps > 0, pbEligible: selectedRow?.bvps !== undefined && selectedRow.bvps > 0, evEbitdaEligible: false, usableForValuation: market !== undefined && selectedRow !== undefined }
  return { dataResolver: resolver, marketValue, financialValue, financialRows, ...(market ? { market } : {}), ...(marketPayload?.kind === 'market' ? { marketCurrency: marketPayload.currency, marketAdjustmentMethod: marketPayload.adjustmentMethod } : {}), ...(marketSource ? { marketValueVersionStatus: marketSource.valueVersion?.status ?? 'UNVERIFIED' } : {}), ...(mapped.epsItem?.source ? { epsValueVersionStatus: mapped.epsItem.source.valueVersion?.status ?? 'UNVERIFIED' } : {}), ...(mapped.bvpsItem?.source ? { bvpsValueVersionStatus: mapped.bvpsItem.source.valueVersion?.status ?? 'UNVERIFIED' } : {}), ...(financialRetrievedAt ? { financialRetrievedAt } : {}), ...(marketRetrievedAt ? { marketRetrievedAt } : {}), ...(marketSource ? { marketSource } : {}), ...(mapped.epsItem?.source ? { epsSource: mapped.epsItem.source } : {}), ...(mapped.bvpsItem?.source ? { bvpsSource: mapped.bvpsItem.source } : {}), ...(publication ? { publication } : {}), sources, providerOutcome: outcome, diagnostics: [...diagnostics, ...(market ? [] : ['VALUATION_MARKET_PRICE_UNAVAILABLE']), ...(financialRows.length ? [] : ['VALUATION_FINANCIAL_BASIS_UNAVAILABLE'])] }
}
function requestedMethods(input: ValuationWorkflowInput, eligible: readonly ValuationMethod[]): readonly ValuationMethod[] { if (input.methods === undefined) return eligible; return [...new Set(input.methods)].filter((method) => eligible.includes(method)) }
export function validProposal(proposal: ValuationSynthesisProposal, plan: ValuationAssumptionPlan, computation: ValuationComputation, sourceIds: ReadonlySet<string>, claimRefs: ReadonlySet<string>): boolean {
  const proposalSources = proposal.sourceCandidateIds ?? []
  if (proposal.kind !== 'claim' || proposal.subjectKey !== 'company' || (proposal.claimType !== 'assumption' && proposal.claimType !== 'viewpoint') || proposalSources.length === 0 || !proposalSources.every((id) => sourceIds.has(id)) || !proposal.existingKnowledgeRefs.every((ref) => claimRefs.has(ref))) return false
  if (proposal.claimType === 'assumption') {
    if (proposal.valuationAssumptionRefs.length !== 1 || !['base-growth', 'base-multiple'].includes(proposal.valuationAssumptionRefs[0] ?? '') || proposal.valuationResultRefs.length !== 0) return false
    const baseScenario = plan.scenarios.find((item) => item.scenarioId === 'base')
    if (baseScenario === undefined || !proposalSources.every((id) => baseScenario.sourceCandidateIds.includes(id))) return false
    return proposal.structuredValue === undefined || validateValuationStructuredValue(proposal.structuredValue, expectedValuationAssumptionStructuredValue(plan, proposal.valuationAssumptionRefs[0] as 'base-growth' | 'base-multiple'))
  }
  if (proposal.valuationAssumptionRefs.length !== 0 || proposal.valuationResultRefs.length !== 1 || proposal.valuationResultRefs[0] !== 'result-base') return false
  if (proposal.structuredValue === undefined) return true
  const metric = proposal.structuredValue && typeof proposal.structuredValue.metric === 'string' ? proposal.structuredValue.metric : undefined
  if (metric !== 'target_price' && metric !== 'implied_return_pct' && metric !== 'reference_multiple') return false
  return validateValuationStructuredValue(proposal.structuredValue, expectedValuationViewpointStructuredValue(plan, computation, metric))
}
export function toGatewayProposals(proposals: readonly ValuationSynthesisProposal[], plan: ValuationAssumptionPlan, computation: ValuationComputation): readonly SemanticProductionProposal[] {
  if (proposals.length > 3) throw new Error('proposal_count_exceeds_three')
  const converted: SemanticProductionProposal[] = proposals.map((proposal) => {
    if (typeof proposal.statement !== 'string' || proposal.statement.trim() === '') throw new Error('proposal_statement_missing')
    if (proposal.claimType === 'assumption' && (proposal.valuationAssumptionRefs.length !== 1 || (proposal.structuredValue !== undefined && !validateValuationStructuredValue(proposal.structuredValue, expectedValuationAssumptionStructuredValue(plan, proposal.valuationAssumptionRefs[0] as 'base-growth' | 'base-multiple'))))) throw new Error('proposal_structured_value_mismatch')
    const viewpointMetric = proposal.structuredValue && typeof proposal.structuredValue.metric === 'string' && ['target_price', 'implied_return_pct', 'reference_multiple'].includes(proposal.structuredValue.metric) ? proposal.structuredValue.metric as 'target_price' | 'implied_return_pct' | 'reference_multiple' : 'target_price'
    const structuredValue = proposal.claimType === 'assumption' ? expectedValuationAssumptionStructuredValue(plan, proposal.valuationAssumptionRefs[0] as 'base-growth' | 'base-multiple') : expectedValuationViewpointStructuredValue(plan, computation, viewpointMetric)
    if (proposal.claimType === 'viewpoint' && proposal.structuredValue !== undefined && !validateValuationStructuredValue(proposal.structuredValue, expectedValuationViewpointStructuredValue(plan, computation, viewpointMetric))) throw new Error('proposal_structured_value_mismatch')
    const statement = proposal.claimType === 'assumption' ? deterministicValuationAssumptionStatement(plan, 'base') : canonicalizeValuationViewpointStatement(proposal.statement, plan, computation)
    return { proposalId: proposal.proposalId, kind: 'claim' as const, claimType: proposal.claimType, subjectKey: proposal.subjectKey, statement, sourceCandidateIds: proposal.sourceCandidateIds, structuredValue: structuredValue as unknown as Readonly<Record<string, unknown>>, ...(proposal.temporal === undefined ? {} : { temporal: proposal.temporal }), ...(proposal.confidence === undefined ? {} : { confidence: proposal.confidence }), ...(proposal.probability === undefined ? {} : { probability: proposal.probability }), resolution: 'supersede' as const }
  })
  const ordered = [...converted].sort((left, right) => Number(right.claimType === 'assumption') - Number(left.claimType === 'assumption'))
  const submittedAssumptionIds = new Set(ordered.filter((proposal) => proposal.claimType === 'assumption').map((proposal) => proposal.proposalId))
  return ordered.map((proposal) => proposal.claimType === 'viewpoint' && submittedAssumptionIds.size > 0 ? { ...proposal, dependsOnProposalIds: [...submittedAssumptionIds] } : proposal)
}
function automaticCompsReportText(result: AutomaticEquityCompsResult | undefined): string { if (!result) return ''; const selected = result.multipleSummaries.find((item) => item.method === result.selectedMethod); const peers = result.validPeers.filter((peer) => result.selectedPeerRefs.includes(`${peer.identity.exchange}:${peer.identity.ticker}`)).map((peer) => `${peer.identity.ticker}${peer.identity.name === undefined ? '' : ` (${peer.identity.name})`}`).join(', ') || 'Unavailable'; return `Automatic comparable cross-check: availability=${result.availability}; selected method=${result.selectedMethod}; selected peers=${selected?.validCount ?? 0} [${peers}]; peer median=${selected?.median ?? 'Unavailable'}; multiple basis=FY${result.multipleBasisFiscalYear}; target period=FY${result.targetFiscalYear}; target forecast metric=${result.targetForecastMetric ?? 'Unavailable'}; implied target price=${result.impliedTargetPrice ?? 'Unavailable'}; runtime evidence candidate IDs=${result.sourceRefs.join(', ') || 'Unavailable'}; canonical peer sources are not persisted; diagnostics=${result.diagnostics.join(', ') || 'none'}.` }
function withAutomaticCompsReportSection(sections: readonly ResearchReportSection[], result: AutomaticEquityCompsResult | undefined): readonly ResearchReportSection[] { const text = automaticCompsReportText(result); if (!text) return sections; return sections.map((section) => section.id === 'secondary-method-cross-checks' ? { ...section, markdown: `${section.markdown}\n\n${text}` } : section) }
function automaticSelectedPeerCount(result: AutomaticEquityCompsResult | undefined): number | undefined { return result?.multipleSummaries.find((summary) => summary.method === result.selectedMethod)?.validCount }
function reportSections(company: ResearchCompanyIdentity, basis: ValuationBasis | undefined, evidence: ValuationBasisEvidence | undefined, pitStatus: ValuationEvidencePitStatus, eligible: readonly ValuationMethod[], plan: ValuationAssumptionPlan | undefined, computation: ValuationComputation | undefined, synthesis: ValuationSynthesisSkillResultLike | undefined, diagnostics: readonly string[], valuationTimestamp: string, marketCurrency?: string, marketAdjustmentMethod?: string, valueVersionStatuses: { readonly market?: string; readonly eps?: string; readonly bvps?: string } = {}, marketFreshness?: AcquisitionSourceMetadata['marketFreshness']): ResearchReportSection[] {
  const comments = new Map<string, string>((synthesis?.sections ?? []).map((item) => [item.sectionId, item.markdown] as const))
  const scenario = (id: string): ValuationComputation['scenarios'][number] | undefined => computation?.scenarios.find((item) => item.scenarioId === id)
  const num = (value: number | undefined) => value === undefined || !Number.isFinite(value) ? 'Unavailable' : String(value)
  const safeModelText = (value: string | undefined, fallback: string) => value && plan && computation ? canonicalizeValuationViewpointStatement(value, plan, computation) : value ?? fallback
  const safeModelView = safeModelText(comments.get('valuation-view'), 'Deterministic outputs are authoritative; qualitative interpretation is bounded to supplied evidence.')
  const market = evidence?.market
  const eps = evidence?.eps
  const bvps = evidence?.bvps
  const publication = eps?.officialPublication ?? bvps?.officialPublication
  const marketSource = market?.numericSource
  const evidenceText = evidence
    ? `PIT classification: ${pitStatus}. Market PIT: ${market?.pitStatus ?? 'UNAVAILABLE'}; market numeric value-version status: ${valueVersionStatuses.market ?? 'UNVERIFIED'}. EPS PIT: ${eps?.pitStatus ?? 'UNAVAILABLE'}; EPS numeric value-version status: ${valueVersionStatuses.eps ?? 'UNVERIFIED'}. BVPS PIT: ${bvps?.pitStatus ?? 'UNAVAILABLE'}; BVPS numeric value-version status: ${valueVersionStatuses.bvps ?? 'UNVERIFIED'}. CNINFO publication proves the official report publication date only; it does not prove the aggregator's historical numeric value version.`
    : `PIT classification: ${pitStatus}. Numeric value-version status: UNAVAILABLE.`
  const snapshot = [
    `Verified company name: ${company.name ?? 'Unavailable'}.`,
    `Verified ticker / exchange: ${company.symbol}.${company.exchange}.`,
    `Valuation timestamp: ${valuationTimestamp}; valuation date: ${basis?.valuationDate ?? 'Unavailable'}.`,
    `Selected market close: ${num(basis?.marketPrice)} ${basis?.marketPriceUnit ?? 'Unavailable'} for ${basis?.priceDate ?? market?.priceDate ?? 'Unavailable'}. Currency: ${marketCurrency ?? 'Unavailable'}. Adjustment: ${marketAdjustmentMethod ?? 'Unavailable from selected market payload'}.`,
    `Market publisher: ${marketSource?.originPublisher ?? 'Unavailable'}; retrieval provider: ${marketSource?.retrievalProvider ?? 'Unavailable'}; source ID: ${marketSource?.sourceId ?? 'Unavailable'}; URL: ${marketSource?.sourceUrl ?? 'Unavailable'}.`,
    `Market freshness: ${marketFreshness?.status ?? 'UNAVAILABLE'}; completed exchange sessions since quote: ${marketFreshness?.completedSessionsSincePrice ?? 'Unavailable'}; maximum missed sessions: ${marketFreshness?.maximumMissedSessions ?? '1'}; calendar: ${marketFreshness?.calendarSource ?? 'Unavailable'}.`,
  ].join('\n\n')
  const basisText = [
    `Annual financial basis: FY${basis?.basisFiscalYear ?? evidence?.basisFiscalYear ?? 'Unavailable'}, period ${basis?.reportDate ?? evidence?.reportDate ?? 'Unavailable'}.`,
    `EPS: ${num(basis?.eps ?? eps?.value)} ${basis?.units.eps ?? eps?.unit ?? 'CNY/share'}; publisher: ${eps?.numericSource.originPublisher ?? 'Unavailable'}; retrieval provider: ${eps?.numericSource.retrievalProvider ?? 'Unavailable'}; source ID: ${eps?.numericSource.sourceId ?? 'Unavailable'}; URL: ${eps?.numericSource.sourceUrl ?? 'Unavailable'}.`,
    `BVPS: ${num(basis?.bvps ?? bvps?.value)} ${basis?.units.bvps ?? bvps?.unit ?? 'CNY/share'}; publisher: ${bvps?.numericSource.originPublisher ?? 'Unavailable'}; retrieval provider: ${bvps?.numericSource.retrievalProvider ?? 'Unavailable'}; source ID: ${bvps?.numericSource.sourceId ?? 'Unavailable'}; URL: ${bvps?.numericSource.sourceUrl ?? 'Unavailable'}.`,
    `Official annual report: ${publication?.reportTitle ?? 'Unavailable'}; publisher: ${publication?.originPublisher ?? 'Unavailable'}; published at: ${publication?.publishedAt ?? 'Unavailable'}; announcement ID: ${publication?.announcementId ?? 'Unavailable'}; URL: ${publication?.sourceUrl ?? 'Unavailable'}.`,
    evidenceText,
  ].join('\n\n')
  const reference = basis ? referenceMultiples(basis) : undefined
  const currentMultiples = reference ? `Current PE: ${num(reference.PE)} (selected close / FY${basis!.basisFiscalYear} EPS); current PB: ${num(reference.PB)} (selected close / FY${basis!.basisFiscalYear} BVPS). These are deterministic current reference multiples, not forecast target multiples. EV/EBITDA: ${num(reference.EV_EBITDA)}.` : 'Current PE/PB: unavailable because a verified valuation basis is unavailable.'
  const sections: Array<[string, string]> = [
    ['Valuation Snapshot', snapshot],
    ['Data Basis & Point-in-Time Status', basisText],
    ['Existing Research Context', safeModelText(comments.get('existing-research-context'), `Existing canonical Company research context for ${company.symbol} is bounded and company-only.`)],
    ['Method Eligibility', eligible.map((method) => `${method}: eligible`).join('; ') || 'No valuation method is currently eligible.'],
    ['FY-Based Reference Multiples', currentMultiples],
    ['Primary Method Selection', plan ? `${plan.primaryMethod}; secondary cross-checks: ${plan.secondaryMethods.join(', ') || 'none'}.` : 'No forecast method selected; scenario assumptions unavailable.'],
    ['Assumption Framework', plan ? plan.scenarios.map((item) => `${item.scenarioId}: growth ${item.growthRate}, multiple ${item.targetMultiple}`).join('; ') : 'No validated assumption plan is available; no scenario or target price is asserted.'],
    ['Bear Scenario', scenario('bear') ? `Target price: ${num(scenario('bear')!.targetPrice)} CNY/share; implied return: ${num(scenario('bear')!.impliedReturnPct)}%. ${scenario('bear')!.primaryMethod} calculation is code-owned.` : 'Unavailable; no validated assumption plan.'],
    ['Base Scenario', scenario('base') ? `Target price: ${num(scenario('base')!.targetPrice)} CNY/share; implied return: ${num(scenario('base')!.impliedReturnPct)}%. ${scenario('base')!.primaryMethod} calculation is code-owned.` : 'Unavailable; no validated assumption plan.'],
    ['Bull Scenario', scenario('bull') ? `Target price: ${num(scenario('bull')!.targetPrice)} CNY/share; implied return: ${num(scenario('bull')!.impliedReturnPct)}%. ${scenario('bull')!.primaryMethod} calculation is code-owned.` : 'Unavailable; no validated assumption plan.'],
    ['Target Price Range', computation ? `${num(scenario('bear')?.targetPrice)} – ${num(scenario('bull')?.targetPrice)} CNY/share.` : 'Unavailable; forecast scenarios were not produced.'],
    ['Sensitivity Analysis', computation ? computation.sensitivity.map((cell) => `${cell.growthScenario}/${cell.multipleScenario}: ${num(cell.targetPrice)}`).join('; ') : 'Unavailable; forecast scenarios were not produced.'],
    ['Secondary Method Cross-checks', plan && computation ? plan.secondaryMethods.map((method) => `${method} FY reference multiple: ${num(computation.referenceMultiples[method])}`).join('; ') || 'None available.' : 'Unavailable without a validated assumption plan.'],
    ['Changes vs Existing Research', safeModelText(comments.get('changes-vs-existing-research'), 'Valuation is a reproducible view over existing Company research; no unsupported canonical change is assumed.')],
    ['Valuation View', `${safeModelView}\n\nConsensus unavailable`],
    ['Risks / Limitations / Research Gaps', `${diagnostics.join('; ') || 'No deterministic data gap recorded.'}\n\nNumeric financial value-version is not independently proven by CNINFO publication metadata. EV/EBITDA: unavailable; DCF: unavailable / deferred in v1.`],
  ]
  return VALUATION_REPORT_SECTIONS.map((title, index) => ({ id: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), title, markdown: sections[index]![1] }))
}
type ValuationSynthesisSkillResultLike = Pick<ValuationSynthesisOutput, 'sections' | 'proposals'>
function preciseReportSections(sections: readonly ResearchReportSection[], sources: readonly NormalizedResearchSource[], existingClaims: readonly Dict[], synthesis: ValuationSynthesisSkillResultLike | undefined, sourceRefs: Readonly<Record<string, string>>, claimRefs: Readonly<Record<string, string>>, plan: ValuationAssumptionPlan | undefined): readonly ResearchReportSection[] {
  const byRole = (role: string) => sources.find((source) => source.candidate.metadata?.valuationEvidenceRole === role || source.candidate.metadata?.dataKind === `valuation-${role}`)?.candidate.candidateId
  const market = byRole('market'); const financial = byRole('financial'); const official = sources.find((source) => source.candidate.kind === 'official_disclosure' && source.candidate.metadata?.dataKind === 'valuation-annual-report-publication')?.candidate.candidateId; const allDeterministic = [market, financial, official].filter((id): id is string => id !== undefined)
  const sourceRefsFor = (ids: readonly (string | undefined)[]) => ids.map((id) => id === undefined ? undefined : sourceRefs[id]).filter((id): id is string => id !== undefined)
  const knownClaims = new Set(existingClaims.map((claim) => typeof claim.canonicalRef === 'string' ? claim.canonicalRef : '').filter((id) => id.startsWith('claim:')))
  const claimRefsFor = (ids: readonly string[]) => ids.map((id) => knownClaims.has(id) ? id : claimRefs[id]).filter((id): id is string => id !== undefined)
  const modelSections = new Map((synthesis?.sections ?? []).map((section) => [section.sectionId, section] as const))
  const assumptionClaimIds = (synthesis?.proposals ?? []).filter((proposal) => proposal.claimType === 'assumption').map((proposal) => proposal.proposalId)
  const viewpointClaimIds = (synthesis?.proposals ?? []).filter((proposal) => proposal.claimType === 'viewpoint').map((proposal) => proposal.proposalId)
  return sections.map((section) => {
    let candidateIds: readonly (string | undefined)[] = []; let existingClaimIds: readonly string[] = []
    if (section.id === 'valuation-snapshot') candidateIds = [market]
    else if (section.id === 'data-basis-point-in-time-status') candidateIds = [market, financial, official]
    else if (['method-eligibility', 'fy-based-reference-multiples', 'secondary-method-cross-checks'].includes(section.id)) candidateIds = [market, financial, official]
    else if (section.id === 'primary-method-selection') candidateIds = [market, financial, official]
    else if (section.id === 'assumption-framework') { candidateIds = plan?.scenarios.find((item) => item.scenarioId === 'base')?.sourceCandidateIds ?? []; existingClaimIds = assumptionClaimIds }
    else if (['bear-scenario', 'base-scenario', 'bull-scenario'].includes(section.id)) candidateIds = [plan?.scenarios.find((item) => item.scenarioId === section.id.replace('-scenario', ''))?.sourceCandidateIds ?? []].flat()
    else if (['target-price-range', 'sensitivity-analysis'].includes(section.id)) candidateIds = allDeterministic
    else { const model = modelSections.get(section.id); candidateIds = model?.sourceCandidateIds ?? []; existingClaimIds = [...(model?.existingKnowledgeRefs ?? []), ...(section.id === 'valuation-view' ? viewpointClaimIds : [])] }
    return { ...section, sourceRefs: sourceRefsFor(candidateIds), claimRefs: claimRefsFor(existingClaimIds) }
  })
}
function attachValuationEvidenceLinks(sections: readonly ResearchReportSection[], evidence: ValuationBasisEvidence | undefined, identity: VerifiedSecurityIdentity | undefined): readonly ResearchReportSection[] {
  const marketUrl = evidence?.market.numericSource.sourceUrl
  const financialUrls = [evidence?.eps?.numericSource.sourceUrl, evidence?.bvps?.numericSource.sourceUrl].filter((value): value is string => Boolean(value))
  const officialUrl = evidence?.eps?.officialPublication?.sourceUrl ?? evidence?.bvps?.officialPublication?.sourceUrl
  const identityUrl = identity?.sourceUrl
  return sections.map((section) => {
    const urls = section.id === 'valuation-snapshot' ? [marketUrl, identityUrl]
      : section.id === 'data-basis-point-in-time-status' ? [marketUrl, ...financialUrls, officialUrl, identityUrl]
        : ['method-eligibility', 'fy-based-reference-multiples', 'primary-method-selection'].includes(section.id) ? [marketUrl, ...financialUrls, officialUrl]
          : []
    const evidenceLinks = [...new Set(urls.filter((value): value is string => Boolean(value) && /^https:\/\//i.test(value!)))]
    return evidenceLinks.length === 0 ? section : { ...section, evidenceLinks }
  })
}
function check(input: ValuationWorkflowInput, now: string): void { if (!safeId.test(input.workflowRunId)) throw new Error('workflowRunId must be safe'); if (input.handle.schemaVersion !== '0.4' || input.handle.storageFormatVersion !== '1') throw new Error('Valuation requires Schema 0.4 / Storage 1'); if (!/^\d{6}$/.test(input.company.symbol)) throw new Error('company symbol must be a six-digit A-share symbol'); if (input.targetFiscalYear !== undefined && !Number.isInteger(input.targetFiscalYear)) throw new Error('VALUATION_TARGET_FISCAL_YEAR_INVALID'); if (input.asOf !== undefined && Number.isNaN(Date.parse(input.asOf))) throw new Error('asOf must be a valid date'); if (input.asOf !== undefined && Date.parse(input.asOf) > Date.parse(now)) throw new Error('VALUATION_ASOF_IN_FUTURE') }

export async function runValuation(input: ValuationWorkflowInput): Promise<ValuationWorkflowResult> {
  const provider = emptyProvider()
  try {
    const clock = nowOf(input); const now = clock()
    check(input, now)
    const company = normalizedCompany(input.company)
    abortIfNeeded(input.signal)
    const coverage = await existingCompany(input, company)
    const companyCoverageResolved = coverage.ref !== undefined
    abortIfNeeded(input.signal)
    if (coverage.reason) return { workflowRunId: input.workflowRunId, status: 'blocked', knowledgeBaseId: input.handle.knowledgeBaseId, knowledgeBaseRevision: input.handle.revision, proposalIds: [], committedIds: [], sourceIds: [], claimIds: [], errors: [], blockedReason: coverage.reason, diagnostics: [coverage.reason], providerOutcome: provider, telemetry: baseTelemetry() }

    const valuationDate = input.asOf ?? now
    const acquired = await acquire(input, company, valuationDate, input.asOf, clock)
    abortIfNeeded(input.signal)
    const market = { observation: acquired.market }
    if (!market.observation) return { workflowRunId: input.workflowRunId, status: 'blocked', knowledgeBaseId: input.handle.knowledgeBaseId, knowledgeBaseRevision: input.handle.revision, proposalIds: [], committedIds: [], sourceIds: [], claimIds: [], errors: [], blockedReason: 'VALUATION_MARKET_PRICE_UNAVAILABLE', diagnostics: acquired.diagnostics, providerOutcome: acquired.providerOutcome, telemetry: baseTelemetry({ companyCoverageResolved }) }

    const financial = { rows: acquired.financialRows, diagnostics: [] as readonly string[] }
    const evidenceResolution = acquired.market && acquired.financialRetrievedAt && acquired.marketRetrievedAt
      ? resolveValuationBasisEvidence({ market: acquired.market, financialRows: financial.rows, ...(acquired.publication === undefined ? {} : { publication: acquired.publication }), valuationDate, ...(input.asOf === undefined ? {} : { asOf: input.asOf }), now, retrievedAt: acquired.financialRetrievedAt, marketRetrievedAt: acquired.marketRetrievedAt, ...(acquired.marketSource === undefined ? {} : { marketSource: acquired.marketSource }), ...(acquired.epsSource === undefined ? {} : { epsSource: acquired.epsSource }), ...(acquired.bvpsSource === undefined ? {} : { bvpsSource: acquired.bvpsSource }), marketSourceUrl: acquired.marketSource?.sourceUrl, financialSourceUrl: 'https://datacenter.eastmoney.com/securities/api/data/get' })
      : undefined
    const basisEvidence: ValuationBasisEvidence | undefined = evidenceResolution?.evidence
    const pitStatus: ValuationEvidencePitStatus = evidenceResolution?.pitStatus ?? 'UNAVAILABLE'
    const basis: ValuationBasis | undefined = evidenceResolution?.basis
    const basisDiagnostics = evidenceResolution?.diagnostics ?? ['VALUATION_BASIS_PUBLICATION_UNAVAILABLE']
    const eligibility = basis ? methodEligibility(basis) : []
    const eligible = requestedMethods(input, eligibility.filter((item) => item.eligible).map((item) => item.method))
    if (basis && input.targetFiscalYear !== undefined && (input.targetFiscalYear <= basis.basisFiscalYear || input.targetFiscalYear > basis.basisFiscalYear + 3)) return { workflowRunId: input.workflowRunId, status: 'blocked', knowledgeBaseId: input.handle.knowledgeBaseId, knowledgeBaseRevision: input.handle.revision, proposalIds: [], committedIds: [], sourceIds: [], claimIds: [], errors: [], blockedReason: 'VALUATION_TARGET_FISCAL_YEAR_INVALID', diagnostics: ['VALUATION_TARGET_FISCAL_YEAR_INVALID'], providerOutcome: acquired.providerOutcome, basis, ...(basisEvidence === undefined ? {} : { basisEvidence }), telemetry: baseTelemetry({ companyCoverageResolved, marketDataUsable: true, financialBasisUsable: true, pointInTimeVerified: pitStatus === 'PIT_VERIFIED' }) }
    const targetFiscalYear = input.targetFiscalYear ?? (basis ? basis.basisFiscalYear + 1 : 0)
    const providerOutcome: ValuationProviderOutcome = { ...acquired.providerOutcome, basisPitStatus: pitStatus, marketPriceFound: true, fiscalYearBasisFound: acquired.financialRows.some((row) => row.reportDate <= valuationDate), peEligible: eligible.includes('PE'), pbEligible: eligible.includes('PB'), evEbitdaEligible: false, usableForValuation: basis !== undefined && eligible.length > 0 }
    let compsResult: CompsValuationResult | undefined
    if (input.comps !== undefined) compsResult = executeCompsValuation(input.comps)
    let telemetry = baseTelemetry({ companyCoverageResolved, marketDataUsable: true, financialBasisUsable: basis !== undefined, pointInTimeVerified: pitStatus === 'PIT_VERIFIED', eligibleMethods: eligible })
    let plan: ValuationAssumptionPlan | undefined
    let computation: ValuationComputation | undefined
    let synthesisOutput: ValuationSynthesisOutput = { sections: [], proposals: [] }
    let proposals: readonly ValuationSynthesisProposal[] = []

    if (basis && eligible.length > 0) {
      abortIfNeeded(input.signal)
      const design = await new ValuationAssumptionDesignSkill(input.reasoningExecutor).design({ company, valuationDate, basis, targetFiscalYear, eligibleMethods: eligible, referenceMultiples: referenceMultiples(basis), existingKnowledge: coverage.claims, sources: deterministicValuationEvidence(acquired.sources) })
      abortIfNeeded(input.signal)
      telemetry = { ...telemetry, primaryMethod: design.plan?.primaryMethod, assumptionDesign: design.reasoning }
      if (design.plan) {
        plan = design.plan
        try {
          computation = calculateValuation(basis, plan, eligible)
          telemetry = { ...telemetry, computation: { scenarioCount: computation.scenarios.length, calculatedScenarioCount: computation.scenarios.length, sensitivityCellCount: computation.sensitivity.length, deterministicRecomputeStatus: computation.deterministicRecomputeMatched ? 'matched' : 'mismatch' } }
          abortIfNeeded(input.signal)
          const synthesis = await new ValuationSynthesisSkill(input.reasoningExecutor).synthesize({ company, valuationDate, basis, targetFiscalYear, eligibleMethods: eligible, referenceMultiples: computation.referenceMultiples, existingKnowledge: coverage.claims, sources: deterministicValuationEvidence(acquired.sources), plan, computation })
          abortIfNeeded(input.signal)
          synthesisOutput = synthesis.output
           telemetry = { ...telemetry, synthesis: synthesis.reasoning, modelDerivedInterpretiveSectionCount: synthesis.output.sections.length, proposalCandidateCount: synthesis.output.proposals.length }
           const sourceIds = new Set(deterministicValuationEvidence(acquired.sources).map((source) => source.candidate.candidateId))
          const claimRefs = new Set(coverage.claims.map((claim) => String(claim.canonicalRef)))
          const accepted = synthesis.output.proposals.filter((proposal) => validProposal(proposal, plan!, computation!, sourceIds, claimRefs))
          const requiredEvidenceIds = deterministicValuationEvidence(acquired.sources).map((source) => source.candidate.candidateId)
          proposals = accepted.map((proposal) => proposal.claimType === 'viewpoint' ? { ...proposal, sourceCandidateIds: [...new Set([...(proposal.sourceCandidateIds ?? []), ...requiredEvidenceIds])] } : proposal)
        } catch (error) {
          telemetry = { ...telemetry, computation: { scenarioCount: plan.scenarios.length, calculatedScenarioCount: 0, sensitivityCellCount: 0, deterministicRecomputeStatus: 'unavailable' }, synthesis: { called: false, validated: false, applied: false, fallbackUsed: true, repairAttempts: 0, operation: 'valuation_synthesis' }, proposalCandidateCount: 0 }
          void error
        }
      }
    }

    const baseScenario = computation?.scenarios.find((item) => item.scenarioId === 'base')
    let automaticCompsResult: AutomaticEquityCompsResult | undefined
    let automaticCompsSources: readonly NormalizedResearchSource[] = []
    if (input.comps === undefined) {
      const targetMetricUsable = baseScenario !== undefined && Number.isFinite(baseScenario.forecastMetric) && baseScenario.forecastMetric > 0 && plan?.primaryMethod === baseScenario.primaryMethod && plan.targetFiscalYear === baseScenario.targetFiscalYear
      if (input.asOf !== undefined) automaticCompsResult = unavailableAutomaticComps({ company, valuationDate, basisFiscalYear: basis?.basisFiscalYear ?? 0, targetFiscalYear, selectedMethod: plan?.primaryMethod === 'PB' ? 'PB' : 'PE', targetForecastMetric: baseScenario?.forecastMetric ?? Number.NaN, targetSourceRefs: plan?.scenarios.find((item) => item.scenarioId === 'base')?.sourceCandidateIds ?? [] }, ['AUTO_COMPS_HISTORICAL_UNAVAILABLE'])
      else if (!targetMetricUsable || basis === undefined || plan === undefined || baseScenario === undefined) automaticCompsResult = unavailableAutomaticComps({ company, valuationDate, basisFiscalYear: basis?.basisFiscalYear ?? 0, targetFiscalYear, selectedMethod: plan?.primaryMethod === 'PB' ? 'PB' : 'PE', targetForecastMetric: baseScenario?.forecastMetric ?? Number.NaN, targetSourceRefs: plan?.scenarios.find((item) => item.scenarioId === 'base')?.sourceCandidateIds ?? [] }, ['AUTO_COMPS_TARGET_METRIC_UNAVAILABLE'])
      else if (plan.primaryMethod !== 'PE' && plan.primaryMethod !== 'PB') automaticCompsResult = unavailableAutomaticComps({ company, valuationDate, basisFiscalYear: basis.basisFiscalYear, targetFiscalYear, selectedMethod: 'PE', targetForecastMetric: baseScenario.forecastMetric, targetSourceRefs: plan.scenarios.find((item) => item.scenarioId === 'base')?.sourceCandidateIds ?? [] }, ['AUTO_COMPS_PRIMARY_METHOD_UNSUPPORTED'])
      else if (acquired.dataResolver === undefined) automaticCompsResult = unavailableAutomaticComps({ company, valuationDate, basisFiscalYear: basis.basisFiscalYear, targetFiscalYear: plan.targetFiscalYear, selectedMethod: plan.primaryMethod, targetForecastMetric: baseScenario.forecastMetric, targetSourceRefs: plan.scenarios.find((item) => item.scenarioId === 'base')?.sourceCandidateIds ?? [] }, ['AUTO_COMPS_PEER_COMPARISON_UNAVAILABLE'])
      else {
        const automatic = await resolveAutomaticComps({ company, valuationDate, basisFiscalYear: basis.basisFiscalYear, targetFiscalYear: plan.targetFiscalYear, selectedMethod: plan.primaryMethod, targetForecastMetric: baseScenario.forecastMetric, targetSourceRefs: [...new Set([...acquired.sources.map((source) => source.candidate.candidateId), ...(plan.scenarios.find((item) => item.scenarioId === 'base')?.sourceCandidateIds ?? [])])], akshare: input.akshare, ...(input.officialDisclosure === undefined ? {} : { officialDisclosure: input.officialDisclosure }), ...(acquired.dataResolver === undefined ? {} : { dataResolver: acquired.dataResolver }), retrievedAt: now, clock, signal: input.signal, now })
        automaticCompsResult = automatic.result
        automaticCompsSources = automatic.sources
      }
    }
    const crosscheck = buildValuationCrosscheck({ eligibleMethods: eligible, ...(basis === undefined ? {} : { basis }), ...(plan === undefined ? {} : { plan }), ...(computation === undefined ? {} : { computation }), ...(compsResult === undefined ? {} : { compsResult }), ...(automaticCompsResult === undefined ? {} : { automaticCompsResult }) })
    const allSources = [...acquired.sources, ...automaticCompsSources]
    const valuationComparisons = crosscheck.basisCompatibility.map((item) => ({ comparisonRef: item.comparisonRef, kind: 'general' as const, left: item.left, right: item.right }))
    const acceptedPeerIds = new Set((compsResult?.acceptedPeers ?? []).map((peer) => peer.identity.companyId))
    const weakComparabilityCount = input.comps?.candidatePeers.filter((peer) => acceptedPeerIds.has(peer.companyId) && peer.comparabilityEvidence.length < 2).length ?? 0
    const forecastValuationRefs = baseScenario && plan ? [{ forecastRef: 'valuation:base', forecastMetric: plan.primaryMethod, forecastPeriod: `FY${baseScenario.targetFiscalYear}`, valuationMetric: plan.primaryMethod, valuationPeriod: `FY${baseScenario.targetFiscalYear}` }] : []
    const qualityGate: ResearchQualityGateResult = runResearchQualityGate({ profile: 'valuation', asOf: valuationDate, sources: allSources, referencedSourceCandidateIds: allSources.map((source) => source.candidate.candidateId), proposalSourceCandidateIds: proposals.flatMap((proposal) => proposal.sourceCandidateIds ?? []), reportSourceCandidateIds: proposals.flatMap((proposal) => proposal.sourceCandidateIds ?? []), comparisons: valuationComparisons, forecastValuationRefs, optionalUnavailableSections: input.comps === undefined && automaticCompsResult?.availability === 'available' ? [] : input.comps === undefined ? ['comps_valuation'] : [], peerQuality: compsResult !== undefined ? { acceptedPeerCount: compsResult.acceptedPeers.length, weakComparabilityCount } : automaticCompsResult === undefined ? undefined : { acceptedPeerCount: automaticSelectedPeerCount(automaticCompsResult) ?? 0 } })
    if (!qualityGate.eligibleForGateway) return { workflowRunId: input.workflowRunId, status: 'blocked', knowledgeBaseId: input.handle.knowledgeBaseId, knowledgeBaseRevision: input.handle.revision, proposalIds: proposals.map((proposal) => proposal.proposalId), committedIds: [], sourceIds: [], claimIds: [], errors: qualityGate.diagnostics.filter((item) => item.severity === 'ERROR').map((item) => item.code), diagnostics: [...acquired.diagnostics, ...basisDiagnostics, ...qualityGate.diagnostics.map((item) => item.code)], providerOutcome, basis, ...(basisEvidence === undefined ? {} : { basisEvidence }), plan, computation, synthesis: synthesisOutput, telemetry, ...(compsResult === undefined ? {} : { compsResult }), ...(automaticCompsResult === undefined ? {} : { automaticCompsResult }), qualityGate, crosscheck }

    const gateway = new KnowledgeProductionGateway(new KnowledgeBaseRegistry())
    let outcome: KnowledgeProductionOutcome = { status: 'no_changes', knowledgeBaseId: input.handle.knowledgeBaseId, knowledgeBaseRevision: input.handle.revision, baseRevision: input.handle.revision, createdIds: [], updatedIds: [], sourceRefsByLocalId: {}, claimRefsByProposalId: {}, entityRefsByLocalKey: {}, relationRefsByProposalId: {}, resolutionIntents: [], errors: [] }
    if (basis && plan && computation && proposals.length > 0) {
      const gatewayProposals = toGatewayProposals(proposals, plan, computation)
      abortIfNeeded(input.signal)
        outcome = await gateway.submit({ handle: input.handle, producerType: 'valuation', producerRunId: input.workflowRunId, schemaProfile: { schemaVersion: '0.4', storageFormatVersion: '1', requiresRawProvenance: true }, entity: { localKey: 'company', entityType: 'company', name: company.name ?? company.symbol, aliases: [company.symbol], semanticFields: { ticker: company.symbol, exchange: company.exchange } }, proposals: gatewayProposals, evidenceBindings: deterministicValuationEvidence(acquired.sources).filter((source) => gatewayProposals.some((proposal) => (proposal.sourceCandidateIds ?? []).includes(source.candidate.candidateId))).map((source) => ({ localSourceId: source.candidate.candidateId, source })), asOf: input.asOf, now: clock, writeKnowledge: input.writeKnowledge !== false && coverage.ref !== undefined })
      telemetry = { ...telemetry, acceptedProposalCount: gatewayProposals.length, canonicalSourceCount: Object.keys(outcome.sourceRefsByLocalId).length, canonicalClaimCount: Object.keys(outcome.claimRefsByProposalId).length }
      if (outcome.status === 'blocked' || outcome.status === 'failed') return { workflowRunId: input.workflowRunId, status: 'blocked', knowledgeBaseId: input.handle.knowledgeBaseId, knowledgeBaseRevision: outcome.knowledgeBaseRevision, proposalIds: gatewayProposals.map((proposal) => proposal.proposalId), committedIds: [], sourceIds: Object.values(outcome.sourceRefsByLocalId), claimIds: Object.values(outcome.claimRefsByProposalId), errors: outcome.errors, diagnostics: [...acquired.diagnostics, ...basisDiagnostics], providerOutcome, basis, ...(basisEvidence === undefined ? {} : { basisEvidence }), plan, computation, synthesis: synthesisOutput, telemetry, ...(compsResult === undefined ? {} : { compsResult }), ...(automaticCompsResult === undefined ? {} : { automaticCompsResult }), qualityGate, crosscheck }
    }

    const reportId = `valuation-${company.symbol}-${targetFiscalYear}-${input.workflowRunId}`
    const reportCompany = { ...company, name: input.securityIdentity?.verifiedName ?? coverage.companyName ?? 'Unavailable' }
    const reportSourceRefs = input.writeKnowledge === false ? {} : outcome.sourceRefsByLocalId
    const reportClaimRefs = input.writeKnowledge === false ? {} : outcome.claimRefsByProposalId
    const preciseSections = preciseReportSections(withAutomaticCompsReportSection(reportSections(reportCompany, basis, basisEvidence, pitStatus, eligible, plan, computation, synthesisOutput, [...acquired.diagnostics, ...basisDiagnostics], input.asOf ?? now, acquired.marketCurrency, acquired.marketAdjustmentMethod, { market: acquired.marketValueVersionStatus, eps: acquired.epsValueVersionStatus, bvps: acquired.bvpsValueVersionStatus }, acquired.marketSource?.marketFreshness), automaticCompsResult), deterministicValuationEvidence(acquired.sources), coverage.claims, synthesisOutput, reportSourceRefs, reportClaimRefs, plan)
    const report: ResearchReport = validateResearchReport({ reportId, reportType: 'valuation', subjectRefs: coverage.ref ? [coverage.ref] : [], ...(input.securityIdentity === undefined ? {} : { verifiedSecurityIdentity: input.securityIdentity }), generatedAt: now, asOf: valuationDate, workflowRunId: input.workflowRunId, knowledgeBaseRevision: outcome.knowledgeBaseRevision, sourceRefs: Object.values(reportSourceRefs), claimRefs: Object.values(reportClaimRefs), methodology: 'DataResolver-selected daily market close and structured annual financial basis with CNINFO publication crosswalk, deterministic method eligibility and calculations, bounded two-stage Pi interpretation, and Gateway-mediated canonical mutation.', sections: attachValuationEvidenceLinks(preciseSections, basisEvidence, input.securityIdentity), outputPath: `${reportId}.md` })
    const outputPath = await writeResearchReport({ ...report, sections: report.sections.map((section) => ({ ...section, markdown: section.markdown.replace('DCF: unavailable / deferred in v1', 'DCF: Unavailable / deferred in v1') })) }, resolve(input.reportRoot))
    telemetry = { ...telemetry, acceptedProposalCount: Object.keys(outcome.claimRefsByProposalId).length, canonicalSourceCount: Object.keys(outcome.sourceRefsByLocalId).length, canonicalClaimCount: Object.keys(outcome.claimRefsByProposalId).length }
    return { workflowRunId: input.workflowRunId, status: 'completed', knowledgeBaseId: input.handle.knowledgeBaseId, knowledgeBaseRevision: outcome.knowledgeBaseRevision, report: { reportId, outputPath }, proposalIds: proposals.map((proposal) => proposal.proposalId), committedIds: [...outcome.createdIds, ...outcome.updatedIds], sourceIds: Object.values(outcome.sourceRefsByLocalId), claimIds: Object.values(outcome.claimRefsByProposalId), errors: [], diagnostics: [...acquired.diagnostics, ...basisDiagnostics], providerOutcome, basis, ...(basisEvidence === undefined ? {} : { basisEvidence }), plan, computation, synthesis: synthesisOutput, telemetry, ...(compsResult === undefined ? {} : { compsResult }), ...(automaticCompsResult === undefined ? {} : { automaticCompsResult }), qualityGate, crosscheck }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { workflowRunId: input.workflowRunId, status: message === 'WORKFLOW_CANCELLED' ? 'cancelled' : message === 'VALUATION_ASOF_IN_FUTURE' || message === 'VALUATION_TARGET_FISCAL_YEAR_INVALID' ? 'blocked' : 'failed', knowledgeBaseId: input.handle.knowledgeBaseId, knowledgeBaseRevision: input.handle.revision, proposalIds: [], committedIds: [], sourceIds: [], claimIds: [], errors: [message], ...(message === 'VALUATION_ASOF_IN_FUTURE' ? { blockedReason: 'VALUATION_ASOF_IN_FUTURE' as const } : message === 'VALUATION_TARGET_FISCAL_YEAR_INVALID' ? { blockedReason: 'VALUATION_TARGET_FISCAL_YEAR_INVALID' as const } : {}), diagnostics: [message], providerOutcome: provider, telemetry: baseTelemetry() }
  }
}
