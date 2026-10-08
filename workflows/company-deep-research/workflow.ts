import { resolve } from 'node:path'
import { KnowledgeBaseRegistry } from '../../knowledge/registry/registry.ts'
import { KnowledgeProductionGateway } from '../../knowledge/production/gateway.ts'
import { CompanyResearchSkill } from '../../skills/company-research/skill.ts'
import type { NormalizedResearchSource, ResearchAcquisitionDiagnostic, ResearchProviderOutcome } from '../../plugins/research-acquisition/contracts.ts'
import type { CompanyResearchDataPayload, CompanyResearchEvidenceBatch, CompanyProfileSnapshot, CompanyFinancialHistory, CompanyMarketHistory } from '../../plugins/research-acquisition/company-research-data.ts'
import { sha256 } from '../../plugins/research-acquisition/hash.ts'
import { materializePhase3CommonRequirement } from '../../data/requirements.ts'
import type { DataResolver, ResolvedDataItem } from '../../data/resolver.ts'
import { normalizeCompanyCandidateIdentity } from '../../skills/knowledge-curation/identity/company-identity.ts'
import { validateResearchReport, writeResearchReport, type ResearchReport } from '../../app/services/research-report.ts'
import type { CompanyDeepResearchInput, CompanyDeepResearchResult } from './contracts.ts'
import { runResearchQualityGate } from '../research-quality-gate.ts'
import { calculateCompanyIndustryExposureBridge, renderCompanyIndustryExposureBridge } from './industry-exposure-bridge.ts'

const safeId = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
type AcquiredResearch = { readonly sources: readonly NormalizedResearchSource[]; readonly durableSources: readonly NormalizedResearchSource[]; readonly durableSourceCandidateIds: readonly string[]; readonly profileData?: CompanyProfileSnapshot; readonly financialData?: CompanyFinancialHistory['rows']; readonly marketData?: CompanyMarketHistory['rows']; readonly diagnostics: readonly ResearchAcquisitionDiagnostic[]; readonly providerOutcomes: readonly ResearchProviderOutcome[] }

function check(input: CompanyDeepResearchInput): void {
  if (!safeId.test(input.workflowRunId)) throw new Error('workflowRunId must be safe')
  if (input.handle.schemaVersion !== '0.4' || input.handle.storageFormatVersion !== '1') throw new Error('Company Deep Research requires Schema 0.4 / Storage 1')
  if (!input.company.symbol.trim()) throw new Error('company symbol is required')
}

function abortIfNeeded(signal: AbortSignal | undefined): void { if (signal?.aborted) throw new Error('WORKFLOW_CANCELLED') }
function normalizeResearchCompany(company: CompanyDeepResearchInput['company']): CompanyDeepResearchInput['company'] {
  const normalized = normalizeCompanyCandidateIdentity({ candidateId: 'research-company', entityType: 'company', name: company.name ?? company.symbol, semanticFields: { ticker: company.symbol, ...(company.exchange === undefined ? {} : { exchange: company.exchange }) }, evidenceBlockRefs: [], reason: 'Research input identity normalization' })
  if (normalized.diagnostics.length > 0) throw new Error(`Company identity is unresolved: ${normalized.diagnostics.map((item) => item.message).join('; ')}`)
  const fields = normalized.candidate.semanticFields ?? {}; const exchange = typeof fields.exchange === 'string' ? fields.exchange : undefined
  if (exchange === undefined) throw new Error(`Company exchange is unresolved for symbol ${company.symbol}`)
  return { symbol: String(fields.ticker ?? company.symbol), name: normalized.candidate.name, exchange }
}

function resolvedValue<T extends CompanyResearchDataPayload>(item: ResolvedDataItem<CompanyResearchDataPayload>, kind: T['kind']): T | undefined {
  if (item.value?.kind === kind) return item.value as T
  for (const observation of item.acquisition.observations ?? []) if (observation.data.kind === kind) return observation.data as T
  return undefined
}

function resolvedValues<T extends CompanyResearchDataPayload>(item: ResolvedDataItem<CompanyResearchDataPayload>, kind: T['kind']): readonly T[] {
  const values = [item.value, ...(item.acquisition.observations ?? []).map((observation) => observation.data)]
  return [...new Set(values.filter((value): value is CompanyResearchDataPayload => value?.kind === kind))] as T[]
}

function providerForSource(sourceId: string): string { return sourceId.startsWith('cninfo-') ? 'cninfo' : sourceId.startsWith('gdelt-') ? 'gdelt' : sourceId.startsWith('akshare-') ? 'akshare' : sourceId }

function structuredSource(metricId: string, item: ResolvedDataItem<CompanyResearchDataPayload>, value: CompanyResearchDataPayload, company: CompanyDeepResearchInput['company']): NormalizedResearchSource | undefined {
  const source = item.source ?? item.acquisition.observations?.[0]?.source
  if (!source) return undefined
  const dataKind = metricId === 'company_basic_profile' ? 'basic' : metricId === 'company_financial_history' ? 'financial' : 'market'
  const title = metricId === 'company_basic_profile' ? 'Company basic profile' : metricId === 'company_financial_history' ? 'Company financial history' : 'Company market history'
  const metadata = {
    dataKind, metricId, sourceId: source.sourceId, fallbackLevel: source.fallbackLevel,
    originAuthority: source.originAuthority, originPublisher: source.originPublisher,
    retrievalProvider: source.retrievalProvider, sourceUrl: source.sourceUrl,
    publishedAt: source.publishedAt, retrievedAt: source.retrievedAt,
    observedAt: source.observedAt, observationAvailableAt: source.observationAvailableAt,
    valueVersion: source.valueVersion, quality: item.quality, attempts: item.attempts,
  }
  const content = JSON.stringify(value)
  const publishedAt = source.publishedAt ?? (metricId === 'company_market_history' ? source.observedAt : undefined)
  return {
    candidate: { candidateId: `akshare-${dataKind}-${company.symbol}`, kind: 'structured_data', tier: 2, title, provider: source.retrievalProvider ?? 'AKShare', ...(publishedAt ? { publishedAt } : {}), metadata: { companySymbol: company.symbol, dataProvenance: metadata } },
    retrievedAt: source.retrievedAt, title, content, contentHash: sha256(content),
    ...(source.sourceUrl ? { canonicalUrl: source.sourceUrl } : {}),
    publisher: source.originPublisher ?? 'Unknown original publisher (retrieval via AKShare)',
    rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false },
  }
}

async function acquire(input: CompanyDeepResearchInput, company: CompanyDeepResearchInput['company'], asOf: string): Promise<AcquiredResearch> {
  const limit = Math.max(1, Math.min(input.maxSources ?? 20, 50))
  const now = input.now ?? (() => new Date().toISOString())
  const discoveredCandidateIds = new Set<string>()
  let consideredCandidateCount = 0
  const dataResolver: DataResolver<CompanyResearchDataPayload> = input.dataResolverFactory({
    company, asOf, now, signal: input.signal, limitPerSource: Math.min(10, limit),
    onCandidatesDiscovered: async ({ candidates }) => {
      if (!input.signalStore) return
      for (const candidate of candidates) {
        abortIfNeeded(input.signal)
        if (discoveredCandidateIds.has(candidate.candidateId)) continue
        discoveredCandidateIds.add(candidate.candidateId)
        const publishedAt = candidate.publishedAt === undefined ? Number.NaN : Date.parse(candidate.publishedAt)
        if (!Number.isNaN(publishedAt) && publishedAt > Date.parse(asOf)) continue
        if (consideredCandidateCount >= limit) continue
        consideredCandidateCount += 1
        if (!['news', 'official_disclosure', 'rss'].includes(candidate.kind)) continue
        await input.signalStore.append({ signalId: `signal-${candidate.candidateId}`, kind: candidate.kind === 'official_disclosure' ? 'announcement' : 'news', source: candidate, publishedAt: candidate.publishedAt, discoveredAt: now(), contentReference: candidate.url })
      }
    },
  })
  const context = { workflowId: 'company-deep-research' as const, ticker: company.symbol, companyId: company.name, asOf }
  const requirements = [
    materializePhase3CommonRequirement('company_basic_profile', context),
    materializePhase3CommonRequirement('company_financial_history', context),
    materializePhase3CommonRequirement('company_market_history', { ...context, period: { end: asOf } }),
    materializePhase3CommonRequirement('company_research_evidence', context),
  ]
  abortIfNeeded(input.signal)
  const bundle = await dataResolver.resolve(requirements)
  abortIfNeeded(input.signal)
  const profileItem = bundle.items.find((item) => item.metricId === 'company_basic_profile')
  const financialItem = bundle.items.find((item) => item.metricId === 'company_financial_history')
  const marketItem = bundle.items.find((item) => item.metricId === 'company_market_history')
  const evidenceItem = bundle.items.find((item) => item.metricId === 'company_research_evidence')
  const profileData = profileItem && resolvedValue<CompanyProfileSnapshot>(profileItem, 'profile')
  const financialData = financialItem && resolvedValue<CompanyFinancialHistory>(financialItem, 'financial')
  const marketData = marketItem && resolvedValue<CompanyMarketHistory>(marketItem, 'market')
  const evidenceBatches = evidenceItem ? resolvedValues<CompanyResearchEvidenceBatch>(evidenceItem, 'evidence') : []
  const externalDocuments = evidenceBatches.flatMap((batch) => batch.documents)
  const externalSources = [...new Map(externalDocuments.map((document) => [document.record.candidate.candidateId, document.record])).values()].slice(0, limit)
  const dataValues = [
    ...(profileItem && profileData ? [structuredSource('company_basic_profile', profileItem, profileData, company)] : []),
    ...(financialItem && financialData ? [structuredSource('company_financial_history', financialItem, financialData, company)] : []),
    ...(marketItem && marketData ? [structuredSource('company_market_history', marketItem, marketData, company)] : []),
  ].filter((source): source is NormalizedResearchSource => source !== undefined)
  const sources = [...externalSources, ...dataValues]
  const durableSourceCandidateIds = [...dataValues.map((source) => source.candidate.candidateId), ...externalDocuments.filter((document) => document.pointInTimeSafe).map((document) => document.record.candidate.candidateId)]
  const durableSources = sources.filter((source) => durableSourceCandidateIds.includes(source.candidate.candidateId))
  const diagnostics: ResearchAcquisitionDiagnostic[] = []
  const outcomes = new Map<string, ResearchProviderOutcome>()
  for (const item of bundle.items) for (const attempt of item.acquisition.attempts) {
    const provider = providerForSource(attempt.sourceId)
    const status = attempt.status === 'SUCCESS' ? 'usable' : attempt.status === 'NO_DATA' ? 'empty' : 'failed'
    const prior = outcomes.get(provider) ?? { provider, providerAttempted: true, providerSucceeded: false, providerEmpty: false, providerFailed: false, usableSourceCount: 0 }
    const observation = item.acquisition.observations?.find((entry) => entry.source.sourceId === attempt.sourceId)
    const evidenceCount = observation?.data.kind === 'evidence' ? observation.data.documents.length : 0
    const evidenceOutcome = observation?.data.kind === 'evidence' ? observation.data.outcome : undefined
    const hasFailure = status === 'failed' || (evidenceOutcome?.failed ?? 0) > 0
    const hasEmpty = status === 'empty' || (evidenceOutcome?.empty ?? 0) > 0
    if (status !== 'usable') diagnostics.push({ provider, status, reason: attempt.diagnostic ?? attempt.status })
    if (evidenceOutcome?.diagnostics.length) diagnostics.push({ provider, status: evidenceOutcome.failed > 0 ? 'failed' : 'empty', reason: evidenceOutcome.diagnostics.join('; ').slice(0, 500) })
    const succeeded = status === 'usable' && (provider === 'akshare' ? item.value !== undefined : evidenceCount > 0)
    outcomes.set(provider, { ...prior, providerSucceeded: prior.providerSucceeded || succeeded, providerEmpty: prior.providerEmpty || (!succeeded && hasEmpty), providerFailed: prior.providerFailed || hasFailure, usableSourceCount: prior.usableSourceCount + (succeeded ? provider === 'akshare' ? 1 : evidenceCount : 0) })
  }
  for (const [provider, outcome] of outcomes) outcomes.set(provider, { ...outcome, providerSucceeded: outcome.usableSourceCount > 0 })
  const providerOutcomes = [...outcomes.values()].map((outcome) => ({ ...outcome, providerEmpty: outcome.providerSucceeded ? false : outcome.providerEmpty })).sort((a, b) => a.provider.localeCompare(b.provider))
  return { sources, durableSources, durableSourceCandidateIds, profileData, financialData: financialData?.rows, marketData: marketData?.rows, diagnostics, providerOutcomes }
}

export async function runCompanyDeepResearch(input: CompanyDeepResearchInput): Promise<CompanyDeepResearchResult> {
  try {
    check(input)
    const company = normalizeResearchCompany(input.company)
    abortIfNeeded(input.signal)
    const now = input.now ?? (() => new Date().toISOString())
    const asOf = input.asOf ?? now()
    const acquired = await acquire(input, company, asOf)
    abortIfNeeded(input.signal)
    const gateway = new KnowledgeProductionGateway(new KnowledgeBaseRegistry())
    const existingKnowledgeProjection = input.useStructuredKnowledge === false ? [] : await gateway.projectExistingKnowledge(input.handle, company)
    const research = await new CompanyResearchSkill(now, input.reasoningExecutor).synthesize({ company, asOf, sources: acquired.sources, durableSourceCandidateIds: acquired.durableSourceCandidateIds, profileData: acquired.profileData, financialData: acquired.financialData, marketData: acquired.marketData, existingKnowledgeProjection })
    const industryExposure = input.industryExposure === undefined ? undefined : calculateCompanyIndustryExposureBridge(input.industryExposure)
    const reportResearch = industryExposure === undefined ? research : { ...research, sections: research.sections.map((section) => section.title === 'Industry Exposure' ? { ...section, markdown: `${section.markdown}\n\n${renderCompanyIndustryExposureBridge(industryExposure)}`, sourceCandidateIds: [...new Set([...section.sourceCandidateIds, ...industryExposure.items.flatMap((item) => [...item.driver.sourceRefs, ...item.exposure.sourceRefs, ...(item.sensitivity?.sourceRefs ?? [])])])] } : section) }
    const qualityGate = runResearchQualityGate({ profile: 'company', asOf, sources: acquired.sources, referencedSourceCandidateIds: reportResearch.sections.flatMap((section) => section.sourceCandidateIds), proposalSourceCandidateIds: research.proposals.flatMap((proposal) => proposal.sourceCandidateIds ?? []), reportSourceCandidateIds: reportResearch.sections.flatMap((section) => section.sourceCandidateIds) })
    if (!qualityGate.eligibleForGateway) return { workflowRunId: input.workflowRunId, status: 'blocked', knowledgeBaseId: input.handle.knowledgeBaseId, knowledgeBaseRevision: input.handle.revision, proposalIds: research.proposals.map((proposal) => proposal.proposalId), createdIds: [], updatedIds: [], committedIds: [], sourceIds: [], claimIds: [], errors: qualityGate.diagnostics.filter((item) => item.severity === 'ERROR').map((item) => item.code), research: reportResearch, industryExposure, acquisitionDiagnostics: acquired.diagnostics, providerOutcomes: acquired.providerOutcomes, qualityGate }
    const outcome = await gateway.submit({ handle: input.handle, producerType: 'company_deep_research', producerRunId: input.workflowRunId, schemaProfile: { schemaVersion: '0.4', storageFormatVersion: '1', requiresRawProvenance: true }, entity: { localKey: 'company', entityType: 'company', name: company.name ?? company.symbol, aliases: [company.symbol], semanticFields: { ticker: company.symbol, exchange: company.exchange } }, proposals: research.proposals, evidenceBindings: acquired.durableSources.map((source) => ({ localSourceId: source.candidate.candidateId, source })), asOf, now, writeKnowledge: input.writeKnowledge })
    if (outcome.status === 'blocked' || outcome.status === 'failed') return { workflowRunId: input.workflowRunId, status: 'blocked', knowledgeBaseId: input.handle.knowledgeBaseId, knowledgeBaseRevision: outcome.knowledgeBaseRevision, proposalIds: research.proposals.map((proposal) => proposal.proposalId), createdIds: [], updatedIds: [], committedIds: [], sourceIds: Object.values(outcome.sourceRefsByLocalId), claimIds: Object.values(outcome.claimRefsByProposalId), errors: outcome.errors, research, resolutionIntents: outcome.resolutionIntents, acquisitionDiagnostics: acquired.diagnostics, providerOutcomes: acquired.providerOutcomes, qualityGate }
    const companyRef = outcome.entityRefsByLocalKey.company
    const reportId = `company-research-${company.symbol.toLowerCase()}-${input.workflowRunId}`
    const report: ResearchReport = validateResearchReport({ reportId, reportType: 'company_research', subjectRefs: companyRef ? [companyRef] : [], generatedAt: research.generatedAt, asOf, workflowRunId: input.workflowRunId, knowledgeBaseRevision: outcome.knowledgeBaseRevision, sourceRefs: Object.values(outcome.sourceRefsByLocalId), claimRefs: Object.values(outcome.claimRefsByProposalId), methodology: 'Bounded acquisition -> semantic proposal -> deterministic canonical binding -> validated ChangeSet -> shared Writer.', sections: reportResearch.sections.map((section) => ({ id: section.id, title: section.title, markdown: section.markdown, sourceRefs: section.sourceCandidateIds.map((id) => outcome.sourceRefsByLocalId[id]).filter((id): id is string => id !== undefined), claimRefs: section.proposalIds.map((id) => outcome.claimRefsByProposalId[id]).filter((id): id is string => id !== undefined) })), outputPath: `${reportId}.md` })
    const outputPath = await writeResearchReport(report, resolve(input.reportRoot))
    return { workflowRunId: input.workflowRunId, status: 'completed', knowledgeBaseId: input.handle.knowledgeBaseId, knowledgeBaseRevision: outcome.knowledgeBaseRevision, report: { reportId, outputPath }, proposalIds: research.proposals.map((proposal) => proposal.proposalId), createdIds: outcome.createdIds, updatedIds: outcome.updatedIds, committedIds: [...outcome.createdIds, ...outcome.updatedIds], sourceIds: Object.values(outcome.sourceRefsByLocalId), claimIds: Object.values(outcome.claimRefsByProposalId), errors: [], research: reportResearch, industryExposure, resolutionIntents: outcome.resolutionIntents, acquisitionDiagnostics: acquired.diagnostics, providerOutcomes: acquired.providerOutcomes, qualityGate }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { workflowRunId: input.workflowRunId, status: message === 'WORKFLOW_CANCELLED' ? 'cancelled' : 'failed', knowledgeBaseId: input.handle.knowledgeBaseId, proposalIds: [], createdIds: [], updatedIds: [], committedIds: [], sourceIds: [], claimIds: [], errors: [message] }
  }
}
