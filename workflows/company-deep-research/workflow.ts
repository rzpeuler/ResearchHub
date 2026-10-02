import { resolve } from 'node:path'
import { KnowledgeBaseRegistry } from '../../knowledge/registry/registry.ts'
import { KnowledgeProductionGateway } from '../../knowledge/production/gateway.ts'
import { CompanyResearchSkill } from '../../skills/company-research/skill.ts'
import type { NormalizedResearchSource, ResearchSourceCandidate, ResearchAcquisitionDiagnostic, ResearchProviderOutcome } from '../../plugins/research-acquisition/contracts.ts'
import { sha256 } from '../../plugins/research-acquisition/hash.ts'
import { validateUsableAcquisitionPayload } from '../../plugins/research-acquisition/payload-validation.ts'
import { normalizeCompanyCandidateIdentity } from '../../skills/knowledge-curation/identity/company-identity.ts'
import { validateResearchReport, writeResearchReport, type ResearchReport } from '../../app/services/research-report.ts'
import type { CompanyDeepResearchInput, CompanyDeepResearchResult } from './contracts.ts'
import { runResearchQualityGate } from '../research-quality-gate.ts'
import { calculateCompanyIndustryExposureBridge, renderCompanyIndustryExposureBridge } from './industry-exposure-bridge.ts'

const safeId = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
type AcquiredResearch = { readonly sources: readonly NormalizedResearchSource[]; readonly financialData?: unknown; readonly marketData?: unknown; readonly diagnostics: readonly ResearchAcquisitionDiagnostic[]; readonly providerOutcomes: readonly ResearchProviderOutcome[] }

function check(input: CompanyDeepResearchInput): void {
  if (!safeId.test(input.workflowRunId)) throw new Error('workflowRunId must be safe')
  if (input.handle.schemaVersion !== '0.4' || input.handle.storageFormatVersion !== '1') throw new Error('Company Deep Research requires Schema 0.4 / Storage 1')
  if (!input.company.symbol.trim()) throw new Error('company symbol is required')
}

function abortIfNeeded(signal: AbortSignal | undefined): void { if (signal?.aborted) throw new Error('WORKFLOW_CANCELLED') }
function withinAsOf(publishedAt: string | undefined, asOf: string): boolean { return publishedAt === undefined || Number.isNaN(Date.parse(publishedAt)) || Date.parse(publishedAt) <= Date.parse(asOf) }
function normalizeResearchCompany(company: CompanyDeepResearchInput['company']): CompanyDeepResearchInput['company'] {
  const normalized = normalizeCompanyCandidateIdentity({ candidateId: 'research-company', entityType: 'company', name: company.name ?? company.symbol, semanticFields: { ticker: company.symbol, ...(company.exchange === undefined ? {} : { exchange: company.exchange }) }, evidenceBlockRefs: [], reason: 'Research input identity normalization' })
  if (normalized.diagnostics.length > 0) throw new Error(`Company identity is unresolved: ${normalized.diagnostics.map((item) => item.message).join('; ')}`)
  const fields = normalized.candidate.semanticFields ?? {}; const exchange = typeof fields.exchange === 'string' ? fields.exchange : undefined
  if (exchange === undefined) throw new Error(`Company exchange is unresolved for symbol ${company.symbol}`)
  return { symbol: String(fields.ticker ?? company.symbol), name: normalized.candidate.name, exchange }
}

async function acquireStructuredData(input: CompanyDeepResearchInput): Promise<AcquiredResearch> {
  if (!input.akshare) return { sources: [], diagnostics: [], providerOutcomes: [] }
  const now = input.now ?? (() => new Date().toISOString())
  const entries: Array<{ readonly key: string; readonly title: string; readonly value: unknown }> = []
  const diagnostics: ResearchAcquisitionDiagnostic[] = []
  let usableSourceCount = 0
  let emptyCount = 0
  let failedCount = 0
  const readers = [['basic', 'AKShare company basic information', input.akshare.companyBasic.bind(input.akshare)], ['financial', 'AKShare financial data', input.akshare.financialData.bind(input.akshare)], ['market', 'AKShare historical market data', input.akshare.historicalMarketData.bind(input.akshare)]] as const
  for (const [key, title, read] of readers) {
    try {
      const value = await read({ symbol: input.company.symbol })
      const status = validateUsableAcquisitionPayload(value)
      if (status.status === 'usable') { entries.push({ key, title, value }); usableSourceCount += 1 }
      else { diagnostics.push({ provider: 'akshare', candidateId: `akshare-${key}-${input.company.symbol}`, kind: 'structured_data', status: status.status, reason: status.reason }); if (status.status === 'empty') emptyCount += 1; else failedCount += 1 }
    } catch (error) { failedCount += 1; diagnostics.push({ provider: 'akshare', candidateId: `akshare-${key}-${input.company.symbol}`, kind: 'structured_data', status: 'failed', reason: error instanceof Error ? error.message : String(error) }) }
  }
  const sources = entries.map((entry): NormalizedResearchSource => {
    const content = JSON.stringify(entry.value)
    const candidate: ResearchSourceCandidate = { candidateId: `akshare-${entry.key}-${input.company.symbol}`, kind: 'structured_data', tier: 2, title: entry.title, provider: 'akshare', metadata: { companySymbol: input.company.symbol, dataKind: entry.key } }
    return { candidate, retrievedAt: now(), title: entry.title, content, contentHash: sha256(content), publisher: 'AKShare', rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false } }
  })
  return { sources, financialData: entries.find((entry) => entry.key === 'financial')?.value, marketData: entries.find((entry) => entry.key === 'market')?.value, diagnostics, providerOutcomes: [{ provider: 'akshare', providerAttempted: true, providerSucceeded: usableSourceCount > 0, providerEmpty: emptyCount > 0 && usableSourceCount === 0, providerFailed: failedCount > 0, usableSourceCount }] }
}

async function acquire(input: CompanyDeepResearchInput, asOf: string): Promise<AcquiredResearch> {
  const limit = Math.max(1, Math.min(input.maxSources ?? 20, 50))
  const discovered: ResearchSourceCandidate[] = []
  const diagnostics: ResearchAcquisitionDiagnostic[] = []
  const providerMap = new Map<string, ResearchProviderOutcome>()
  for (const plugin of input.acquisitionPlugins) {
    abortIfNeeded(input.signal)
    const provider = plugin.name.includes('official') ? 'cninfo' : plugin.name.includes('gdelt') ? 'gdelt' : plugin.name
    try {
      const candidates = await plugin.discover({ company: input.company, asOf, limitPerKind: Math.min(10, limit) })
      discovered.push(...candidates)
      providerMap.set(provider, { provider, providerAttempted: true, providerSucceeded: candidates.length > 0, providerEmpty: candidates.length === 0, providerFailed: false, usableSourceCount: 0 })
      if (candidates.length === 0) diagnostics.push({ provider, status: 'empty', reason: 'provider returned no source candidates' })
    } catch (error) { diagnostics.push({ provider, status: 'failed', reason: error instanceof Error ? error.message : String(error) }); providerMap.set(provider, { provider, providerAttempted: true, providerSucceeded: false, providerEmpty: false, providerFailed: true, usableSourceCount: 0 }) }
  }
  const unique = [...new Map(discovered.filter((candidate) => withinAsOf(candidate.publishedAt, asOf)).map((item) => [item.candidateId, item])).values()].slice(0, limit)
  const now = input.now ?? (() => new Date().toISOString())
  for (const candidate of unique) if (input.signalStore && ['news', 'official_disclosure', 'rss'].includes(candidate.kind)) await input.signalStore.append({ signalId: `signal-${candidate.candidateId}`, kind: candidate.kind === 'official_disclosure' ? 'announcement' : 'news', source: candidate, publishedAt: candidate.publishedAt, discoveredAt: now(), contentReference: candidate.url })
  const normalized: NormalizedResearchSource[] = []
  for (const candidate of unique) {
    abortIfNeeded(input.signal)
    const plugin = input.acquisitionPlugins.find((item) => item.name.includes(candidate.kind === 'official_disclosure' ? 'official' : candidate.kind === 'rss' ? 'rss' : candidate.kind === 'news' ? 'gdelt' : '')) ?? input.acquisitionPlugins[0]
    if (!plugin) continue
    try {
      const fetched = await plugin.fetch(candidate)
      const payload = validateUsableAcquisitionPayload(fetched.content)
      if (payload.status !== 'usable') { diagnostics.push({ provider: candidate.provider, candidateId: candidate.candidateId, kind: candidate.kind, status: payload.status, reason: payload.reason }); continue }
      normalized.push(await plugin.normalize(fetched))
      const prior = providerMap.get(candidate.provider) ?? { provider: candidate.provider, providerAttempted: true, providerSucceeded: false, providerEmpty: false, providerFailed: false, usableSourceCount: 0 }
      providerMap.set(candidate.provider, { ...prior, providerSucceeded: true, providerEmpty: false, usableSourceCount: prior.usableSourceCount + 1 })
    } catch (error) { diagnostics.push({ provider: candidate.provider, candidateId: candidate.candidateId, kind: candidate.kind, status: 'failed', reason: error instanceof Error ? error.message : String(error) }); const prior = providerMap.get(candidate.provider); if (prior) providerMap.set(candidate.provider, { ...prior, providerFailed: true }) }
  }
  const structured = await acquireStructuredData(input)
  diagnostics.push(...structured.diagnostics); for (const outcome of structured.providerOutcomes) { const prior = providerMap.get(outcome.provider); providerMap.set(outcome.provider, prior ? { ...prior, providerSucceeded: prior.providerSucceeded || outcome.providerSucceeded, providerEmpty: prior.providerEmpty && outcome.providerEmpty, providerFailed: prior.providerFailed || outcome.providerFailed, usableSourceCount: prior.usableSourceCount + outcome.usableSourceCount } : outcome) }
  const outcomes = [...providerMap.values()].map((outcome) => ({ ...outcome, providerSucceeded: outcome.usableSourceCount > 0, providerEmpty: outcome.usableSourceCount === 0 && diagnostics.some((item) => item.provider === outcome.provider && item.status === 'empty') })).sort((left, right) => left.provider.localeCompare(right.provider))
  return { sources: [...normalized.filter((source) => withinAsOf(source.candidate.publishedAt, asOf)), ...structured.sources].slice(0, limit), financialData: structured.financialData, marketData: structured.marketData, diagnostics, providerOutcomes: outcomes }
}

export async function runCompanyDeepResearch(input: CompanyDeepResearchInput): Promise<CompanyDeepResearchResult> {
  try {
    check(input)
    const company = normalizeResearchCompany(input.company)
    abortIfNeeded(input.signal)
    const now = input.now ?? (() => new Date().toISOString())
    const asOf = input.asOf ?? now()
    const acquired = await acquire({ ...input, company }, asOf)
    abortIfNeeded(input.signal)
    const gateway = new KnowledgeProductionGateway(new KnowledgeBaseRegistry())
    const existingKnowledgeProjection = input.useStructuredKnowledge === false ? [] : await gateway.projectExistingKnowledge(input.handle, company)
    const research = await new CompanyResearchSkill(now, input.reasoningExecutor).synthesize({ company, asOf, sources: acquired.sources, financialData: acquired.financialData, marketData: acquired.marketData, existingKnowledgeProjection })
    const industryExposure = input.industryExposure === undefined ? undefined : calculateCompanyIndustryExposureBridge(input.industryExposure)
    const reportResearch = industryExposure === undefined ? research : { ...research, sections: research.sections.map((section) => section.title === 'Industry Exposure' ? { ...section, markdown: `${section.markdown}\n\n${renderCompanyIndustryExposureBridge(industryExposure)}`, sourceCandidateIds: [...new Set([...section.sourceCandidateIds, ...industryExposure.items.flatMap((item) => [...item.driver.sourceRefs, ...item.exposure.sourceRefs, ...(item.sensitivity?.sourceRefs ?? [])])])] } : section) }
    const qualityGate = runResearchQualityGate({ profile: 'company', asOf, sources: acquired.sources, referencedSourceCandidateIds: reportResearch.sections.flatMap((section) => section.sourceCandidateIds), proposalSourceCandidateIds: research.proposals.flatMap((proposal) => proposal.sourceCandidateIds ?? []), reportSourceCandidateIds: reportResearch.sections.flatMap((section) => section.sourceCandidateIds) })
    if (!qualityGate.eligibleForGateway) return { workflowRunId: input.workflowRunId, status: 'blocked', knowledgeBaseId: input.handle.knowledgeBaseId, knowledgeBaseRevision: input.handle.revision, proposalIds: research.proposals.map((proposal) => proposal.proposalId), createdIds: [], updatedIds: [], committedIds: [], sourceIds: [], claimIds: [], errors: qualityGate.diagnostics.filter((item) => item.severity === 'ERROR').map((item) => item.code), research: reportResearch, industryExposure, acquisitionDiagnostics: acquired.diagnostics, providerOutcomes: acquired.providerOutcomes, qualityGate }
    const outcome = await gateway.submit({ handle: input.handle, producerType: 'company_deep_research', producerRunId: input.workflowRunId, schemaProfile: { schemaVersion: '0.4', storageFormatVersion: '1', requiresRawProvenance: true }, entity: { localKey: 'company', entityType: 'company', name: company.name ?? company.symbol, aliases: [company.symbol], semanticFields: { ticker: company.symbol, exchange: company.exchange } }, proposals: research.proposals, evidenceBindings: acquired.sources.map((source) => ({ localSourceId: source.candidate.candidateId, source })), asOf, now, writeKnowledge: input.writeKnowledge })
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
