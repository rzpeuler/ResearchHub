import type { ReasoningExecutor } from '../../plugins/reasoning/contracts.ts'
import type { CompanyResearchFinancialObservation, CompanyResearchInput, CompanyResearchResult, SemanticKnowledgeProposal } from './contracts.ts'

export const COMPANY_RESEARCH_SECTIONS = ['Company Overview', 'Business Model', 'Business Segments', 'Revenue / Profit Drivers', 'Products', 'Technologies', 'Industry Exposure', 'Supply Chain', 'Competition', 'Financial Quality', 'Growth Drivers', 'Management / Capital Allocation', 'Catalysts', 'Risks', 'Valuation', 'Bull / Base / Bear', 'Variant Perception', 'Investment Thesis', 'Monitoring Checklist'] as const
const LOCAL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
export type CompanyResearchSynthesisMode = 'reasoning_executor' | 'deterministic_fallback'

export class CompanyResearchSkill {
  constructor(private readonly now: () => string = () => new Date().toISOString(), private readonly executor?: ReasoningExecutor) {}

  /** Offline-safe deterministic baseline retained for tests and provider-degraded runs. */
  run(input: CompanyResearchInput): CompanyResearchResult {
    const proposals: SemanticKnowledgeProposal[] = [{ proposalId: 'proposal-company', kind: 'entity', subjectKey: 'company', entityType: 'company', entityName: input.company.name ?? input.company.symbol }]
    const durableIds = new Set(input.durableSourceCandidateIds ?? [])
    const profileSource = structuredSourceId(input, 'company_basic_profile', durableIds)
    const financialSource = structuredSourceId(input, 'company_financial_history', durableIds)
    const marketSource = structuredSourceId(input, 'company_market_history', durableIds)
    const profileFields = input.profileData?.fields.filter((field) => !/^(name|company|companyname|symbol|ticker|code|stockcode|证券简称|证券代码|股票代码)$/i.test(field.name.trim())) ?? []
    const sections = COMPANY_RESEARCH_SECTIONS.map((title) => {
      if (title === 'Company Overview') {
        const profile = profileFields.length ? `\n\n### Retrieved company profile\n${profileFields.slice(0, 20).map((field) => `- ${safeText(field.name)}: ${safeText(field.value)}`).join('\n')}\n\nProfile point-in-time status: ${input.profileData?.pointInTimeStatus ?? 'UNVERIFIED'}.` : '\n\nCompany profile data gap: no usable business profile fields were returned; no business facts are asserted.'
        const context = input.sources.slice(0, 3)
        const contextText = context.length ? `\n\n### Bounded evidence supplied to research\n${context.map((source) => `- ${durableIds.has(source.candidate.candidateId) ? '' : '[Context only; this source is not eligible for durable citation] '}${safeText(source.title)}: ${source.content.slice(0, 500)}`).join('\n')}` : ''
        const sourceCandidateIds = [...new Set([...(profileSource ? [profileSource] : []), ...context.map((source) => source.candidate.candidateId).filter((id) => durableIds.has(id))])]
        return { id: sectionId(title), title, markdown: `Verified security identity: ${safeText(input.company.name ?? input.company.symbol)} (${safeText(input.company.symbol)}, ${safeText(input.company.exchange ?? 'exchange unavailable')}).\n\nResearch cutoff: ${input.asOf}.${profile}${profile && profileSource ? `\n\nSource candidate: ${profileSource}.` : ''}${contextText}`, sourceCandidateIds, proposalIds: [] }
      }
      if ((title === 'Revenue / Profit Drivers' || title === 'Financial Quality') && input.financialData?.length) {
        const rows = input.financialData.slice(0, 8).map((row) => `- Period end: ${row.periodEnd ?? 'unreported'}${row.publishedAt ? `; published: ${row.publishedAt}` : ''}; revenue: ${row.metrics.revenue ?? 'unreported'}; net profit: ${row.metrics.netProfit ?? 'unreported'}; gross margin: ${row.metrics.grossMargin ?? 'unreported'}; basic EPS: ${row.metrics.basicEps ?? 'unreported'}; point-in-time: ${row.pointInTimeStatus}.`).join('\n')
        return { id: sectionId(title), title, markdown: `Retrieved structured financial observations (provider-reported values; units and historical value versions are not inferred):\n${rows}${financialSource ? `\n\nSource candidate: ${financialSource}.` : ''}`, sourceCandidateIds: financialSource ? [financialSource] : [], proposalIds: [] }
      }
      if (title === 'Industry Exposure') {
        const industryFields = input.profileData?.fields.filter((field) => /industry|sector|所属行业|行业类别|行业名称|申万行业/i.test(field.name)) ?? []
        if (industryFields.length) return { id: sectionId(title), title, markdown: `Provider-reported industry classification; no adjacent-industry inference is made:\n${industryFields.slice(0, 8).map((field) => `- ${safeText(field.name)}: ${safeText(field.value)}`).join('\n')}\nPoint-in-time status: ${input.profileData?.pointInTimeStatus ?? 'UNVERIFIED'}.${profileSource ? `\n\nSource candidate: ${profileSource}.` : ''}`, sourceCandidateIds: profileSource ? [profileSource] : [], proposalIds: [] }
        return { id: sectionId(title), title, markdown: gap(title), sourceCandidateIds: [], proposalIds: [] }
      }
      if (title === 'Valuation' && input.marketData?.length) {
        const rows = input.marketData.slice(-8).map((row) => `- ${row.observedAt}: close ${row.close ?? 'unreported'}; open ${row.open ?? 'unreported'}; high ${row.high ?? 'unreported'}; low ${row.low ?? 'unreported'}; volume ${row.volume ?? 'unreported'}; point-in-time: ${row.pointInTimeStatus}.`).join('\n')
        return { id: sectionId(title), title, markdown: `Retrieved market observations only; no PE/PB is calculated here without an attributable earnings or book-value basis:\n${rows}${marketSource ? `\n\nSource candidate: ${marketSource}.` : ''}`, sourceCandidateIds: marketSource ? [marketSource] : [], proposalIds: [] }
      }
      if (title === 'Valuation') return { id: sectionId(title), title, markdown: 'Market data gap: no eligible market observations were returned; no current price, PE, or PB is asserted.', sourceCandidateIds: [], proposalIds: [] }
      return { id: sectionId(title), title, markdown: gap(title), sourceCandidateIds: [], proposalIds: [] }
    })
    return finalizeResearch(input, { sections, proposals }, this.now())
  }

  async synthesize(input: CompanyResearchInput, onMode?: (mode: CompanyResearchSynthesisMode) => void): Promise<CompanyResearchResult> {
    if (!this.executor) { onMode?.('deterministic_fallback'); return this.run(input) }
    try {
      const response = await this.executor.execute({
        operation: 'company_research_synthesis',
        instruction: 'Synthesize the bounded company research into the exact local proposal contract. Use only supplied evidence and structured data. Treat sources with citationEligible false as context only; do not cite them or use them to support factual claims. Emit explicit gaps. Never emit canonical IDs, ChangeSets, storage refs, or mutation actions.',
        input: {
          company: input.company,
          objective: `A-share company deep research for ${input.company.symbol}`,
          asOf: input.asOf,
          boundedSources: input.sources.slice(0, 20).map((source) => ({ candidateId: source.candidate.candidateId, kind: source.candidate.kind, tier: source.candidate.tier, title: source.title, provider: source.candidate.provider, publisher: source.publisher, publishedAt: source.candidate.publishedAt ?? null, provenance: source.candidate.metadata?.dataProvenance ? { ...source.candidate.metadata.dataProvenance, retrievedAt: source.retrievedAt, contentHash: source.contentHash } : null, citationEligible: input.durableSourceCandidateIds?.includes(source.candidate.candidateId) ?? false, content: source.content.slice(0, 1_200) })),
          structuredProfileData: input.profileData ?? null,
          structuredFinancialData: input.financialData ?? null,
          structuredMarketData: input.marketData ?? null,
          existingKnowledgeProjection: input.existingKnowledgeProjection ?? [],
          methodology: 'Evidence-bounded fundamental company research with explicit uncertainty and deterministic valuation recomputation.',
        },
        outputContract: { sections: 'exactly 19 local sections with id,title,markdown,sourceCandidateIds,proposalIds', proposals: 'local entity/claim/relation proposals only', allowedClaimTypes: ['fact', 'forecast', 'viewpoint', 'trend', 'risk', 'assumption', 'thesis', 'catalyst'], links: 'proposal-local supports/dependsOn/contradicts links' },
        metadata: { operationFamily: 'personal-research-v1', companySymbol: input.company.symbol },
      })
      const parsed = parseOutput(response.output)
      const candidate = validateSynthesis(parsed, input)
      const hasSubstantiveOutput = candidate.sections.some((section) => !section.markdown.startsWith('Research gap: no bounded evidence was supplied'))
      onMode?.(hasSubstantiveOutput ? 'reasoning_executor' : 'deterministic_fallback')
      return finalizeResearch(input, hasSubstantiveOutput ? candidate : this.run(input), this.now())
    } catch {
      // Model timeouts and invalid semantic output fall back only to the deterministic, evidence-bounded baseline.
      onMode?.('deterministic_fallback')
      return this.run(input)
    }
  }
}

function parseOutput(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try { return JSON.parse(value.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) as Record<string, unknown> } catch { throw new Error('company_research_synthesis returned invalid JSON') }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('company_research_synthesis must return an object')
  return value as Record<string, unknown>
}

function validateSynthesis(value: Record<string, unknown>, input: CompanyResearchInput): { sections: CompanyResearchResult['sections']; proposals: readonly SemanticKnowledgeProposal[] } {
  const allSourceIds = new Set(input.sources.map((source) => source.candidate.candidateId))
  const sourceIds = new Set(input.durableSourceCandidateIds ?? [])
  const rawProposals = Array.isArray(value.proposals) ? value.proposals : []
  const candidates = rawProposals.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`Invalid company research proposal at index ${index}`)
    const raw = item as Record<string, unknown>
    const suppliedId = typeof raw.proposalId === 'string' ? raw.proposalId : typeof raw.id === 'string' ? raw.id : `model-proposal-${index + 1}`
    const suppliedSubjectKey = typeof raw.subjectKey === 'string' ? raw.subjectKey : typeof raw.localKey === 'string' ? raw.localKey : typeof raw.subject === 'string' ? raw.subject : 'company'
    const proposal = { ...raw, proposalId: suppliedId, subjectKey: suppliedSubjectKey } as SemanticKnowledgeProposal
    if (typeof proposal.proposalId !== 'string' || !LOCAL_ID.test(proposal.proposalId) || /^(?:entity|relation|claim|source|raw):/.test(proposal.proposalId)) throw new Error('Company research proposal IDs must remain local and non-canonical')
    if (typeof proposal.subjectKey !== 'string' || !LOCAL_ID.test(proposal.subjectKey)) throw new Error('Company research proposal subjectKey must remain local')
    if (!['entity', 'claim', 'relation'].includes(proposal.kind)) throw new Error(`Unsupported company research proposal kind: ${proposal.kind}`)
    for (const sourceId of proposal.sourceCandidateIds ?? []) if (!allSourceIds.has(sourceId)) throw new Error(`Proposal references unknown source candidate: ${sourceId}`)
    return proposal
  })
  const candidateIds = new Set(candidates.map((proposal) => proposal.proposalId))
  if (candidateIds.size !== candidates.length) throw new Error('Company research proposal IDs must be unique')
  for (const proposal of candidates) for (const ref of [...proposal.supportsProposalIds ?? [], ...proposal.dependsOnProposalIds ?? [], ...proposal.contradictsProposalIds ?? []]) if (!candidateIds.has(ref)) throw new Error(`Proposal link does not resolve locally: ${ref}`)
  const eligibleIds = new Set(candidates.filter((proposal) => (proposal.sourceCandidateIds ?? []).every((sourceId) => sourceIds.has(sourceId))).map((proposal) => proposal.proposalId))
  let changed = true
  while (changed) {
    changed = false
    for (const proposal of candidates) {
      if (!eligibleIds.has(proposal.proposalId)) continue
      const linkedIds = [...proposal.supportsProposalIds ?? [], ...proposal.dependsOnProposalIds ?? [], ...proposal.contradictsProposalIds ?? []]
      if (linkedIds.some((id) => !eligibleIds.has(id))) { eligibleIds.delete(proposal.proposalId); changed = true }
    }
  }
  const proposals = candidates.filter((proposal) => eligibleIds.has(proposal.proposalId))
  const proposalIds = new Set(proposals.map((proposal) => proposal.proposalId))
  const rawSections = Array.isArray(value.sections) ? value.sections : []
  const byTitle = new Map(rawSections.map((section) => [typeof section === 'object' && section !== null && !Array.isArray(section) && typeof (section as Record<string, unknown>).title === 'string' ? (section as Record<string, unknown>).title : '', section]))
  const sections = COMPANY_RESEARCH_SECTIONS.map((title) => {
    const section = byTitle.get(title)
    if (!section || typeof section !== 'object' || Array.isArray(section)) return { id: sectionId(title), title, markdown: gap(title), sourceCandidateIds: [], proposalIds: [] }
    const value = section as Record<string, unknown>
    const sourceCandidateIds = Array.isArray(value.sourceCandidateIds) ? value.sourceCandidateIds.filter((id): id is string => typeof id === 'string') : []
    const requestedProposalIds = Array.isArray(value.proposalIds) ? value.proposalIds.filter((id): id is string => typeof id === 'string') : []
    if (sourceCandidateIds.some((id) => !allSourceIds.has(id)) || requestedProposalIds.some((id) => !candidateIds.has(id))) throw new Error(`Section ${title} has unresolved local references`)
    return { id: sectionId(title), title, markdown: typeof value.markdown === 'string' && value.markdown.trim() ? value.markdown.trim() : gap(title), sourceCandidateIds: sourceCandidateIds.filter((id) => sourceIds.has(id)), proposalIds: requestedProposalIds.filter((id) => proposalIds.has(id)) }
  })
  return { sections, proposals }
}

function finalizeResearch(input: CompanyResearchInput, partial: { sections: CompanyResearchResult['sections']; proposals: readonly SemanticKnowledgeProposal[] }, generatedAt: string): CompanyResearchResult {
  const metric = extractMetric(input.financialData)
  const missingFields = metric === undefined ? ['verified earnings metric', 'attributable peer valuation inputs'] : ['attributable peer valuation inputs']
  const valuation = {
    status: 'insufficient_data' as const,
    missingFields,
    note: metric === undefined
      ? 'No verified structured earnings metric was supplied, and no implied relative valuation is produced without attributable peer data.'
      : 'No implied relative valuation is produced without attributable peer data.',
  }
  const durableIds = new Set(input.durableSourceCandidateIds ?? [])
  return { company: input.company, generatedAt, asOf: input.asOf, sections: partial.sections, proposals: partial.proposals, sourceCandidateIds: input.sources.map((source) => source.candidate.candidateId).filter((id) => durableIds.has(id)), contextOnlySourceCandidateIds: input.sources.map((source) => source.candidate.candidateId).filter((id) => !durableIds.has(id)), valuation }
}
function sectionId(title: string): string { return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') }
function gap(title: string): string { return `Research gap: no bounded evidence was supplied for ${title}; no conclusion is asserted.` }
function structuredSourceId(input: CompanyResearchInput, metricId: string, durableIds: ReadonlySet<string>): string | undefined {
  return input.sources.find((source) => durableIds.has(source.candidate.candidateId) && source.candidate.metadata?.dataProvenance && typeof source.candidate.metadata.dataProvenance === 'object' && (source.candidate.metadata.dataProvenance as Record<string, unknown>).metricId === metricId)?.candidate.candidateId
}
function safeText(value: string | number | boolean): string { return String(value).replace(/[\r\n]+/g, ' ').slice(0, 240) }
function extractMetric(value: readonly CompanyResearchFinancialObservation[] | undefined): number | undefined { const candidate = value?.[0]?.metrics.metric; return typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0 ? candidate : undefined }
