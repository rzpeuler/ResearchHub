import { resolve } from 'node:path'
import { KnowledgeBaseRegistry } from '../../knowledge/registry/registry.ts'
import { readCanonicalV04Assets } from '../../knowledge/storage/canonical-v04-loader.ts'
import { KnowledgeProductionGateway } from '../../knowledge/production/gateway.ts'
import type { KnowledgeProductionOutcome } from '../../knowledge/production/contracts.ts'
import { CompanyResearchSkill } from '../../skills/company-research/skill.ts'
import type { NormalizedResearchSource, ResearchAcquisitionDiagnostic, ResearchProviderOutcome } from '../../plugins/research-acquisition/contracts.ts'
import type { CompanyResearchDataPayload, CompanyResearchEvidenceBatch, CompanyProfileSnapshot, CompanyFinancialHistory, CompanyMarketHistory } from '../../plugins/research-acquisition/company-research-data.ts'
import { sha256 } from '../../plugins/research-acquisition/hash.ts'
import { materializePhase3CommonRequirement } from '../../data/requirements.ts'
import { sourceWithDataEvidenceProvenance } from '../../data/research-evidence.ts'
import type { DataResolver, ResolvedDataItem } from '../../data/resolver.ts'
import { normalizeCompanyCandidateIdentity, normalizeExchange } from '../../skills/knowledge-curation/identity/company-identity.ts'
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
async function canonicalCompanyRef(handle: CompanyDeepResearchInput['handle'], company: CompanyDeepResearchInput['company']): Promise<string | undefined> {
  const expectedExchange = normalizeExchange(company.exchange!)
  const matches = (await readCanonicalV04Assets(handle.rootRef)).objects.filter((item) => {
    if (item.kind !== 'entity') return false
    const value = item.value as Readonly<Record<string, unknown>>
    if (value.type !== 'company' || value.ticker !== company.symbol || typeof value.exchange !== 'string') return false
    try { return normalizeExchange(value.exchange) === expectedExchange } catch { return false }
  })
  return matches.length === 1 ? matches[0]!.value.id : undefined
}
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
  const pointInTimeStatus = value.kind === 'evidence' ? 'UNVERIFIED' : value.pointInTimeStatus
  const metadata = {
    dataKind, metricId, sourceId: source.sourceId, fallbackLevel: source.fallbackLevel,
    originAuthority: source.originAuthority, originPublisher: source.originPublisher,
    retrievalProvider: source.retrievalProvider, sourceUrl: source.sourceUrl,
    publishedAt: source.publishedAt, retrievedAt: source.retrievedAt,
    observedAt: source.observedAt, observationAvailableAt: source.observationAvailableAt,
    valueVersion: source.valueVersion ?? { status: 'UNVERIFIED', reason: metricId === 'company_basic_profile' ? 'Profile snapshot has no identified historical value version' : 'Historical numeric value version is not identified' },
    valueVersionStatus: source.valueVersion?.status ?? 'UNVERIFIED', quality: item.quality, attempts: item.attempts,
    pointInTimeStatus, qualityStatus: pointInTimeStatus,
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
    company, asOf, asOfMode: input.asOf === undefined ? 'CURRENT_VALUE_ONLY' : 'HISTORICAL', now, signal: input.signal, limitPerSource: Math.min(10, limit),
    acquisitionDeadlineAt: Date.now() + 10 * 60_000,
    onProgress: input.observations?.acquisitionActivity,
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
  const context = { workflowId: 'company-deep-research' as const, ticker: company.symbol, companyId: company.name, asOf, asOfMode: input.asOf === undefined ? 'CURRENT_VALUE_ONLY' as const : 'HISTORICAL' as const }
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
  const selectedExternalDocuments = [...new Map(externalDocuments.map((document) => [document.record.candidate.candidateId, document])).values()].slice(0, limit)
  const externalSources = selectedExternalDocuments.map(sourceWithDataEvidenceProvenance)
  const dataValues = [
    ...(profileItem && profileData ? [structuredSource('company_basic_profile', profileItem, profileData, company)] : []),
    ...(financialItem && financialData ? [structuredSource('company_financial_history', financialItem, financialData, company)] : []),
    ...(marketItem && marketData ? [structuredSource('company_market_history', marketItem, marketData, company)] : []),
  ].filter((source): source is NormalizedResearchSource => source !== undefined)
  const sources = [...externalSources, ...dataValues]
  const durableDataSourceIds = dataValues.filter((source) => {
    const status = source.candidate.metadata?.dataProvenance && typeof source.candidate.metadata.dataProvenance === 'object'
      ? (source.candidate.metadata.dataProvenance as Record<string, unknown>).pointInTimeStatus
      : undefined
    return status === 'CURRENT_VALUE_ONLY' || status === 'PIT_VERIFIED'
  }).map((source) => source.candidate.candidateId)
  const durableSourceCandidateIds = [...durableDataSourceIds, ...selectedExternalDocuments.filter((document) => document.dateStatus === 'QUALIFIED' && document.pointInTimeSafe).map((document) => document.record.candidate.candidateId)]
  const durableSources = sources.filter((source) => durableSourceCandidateIds.includes(source.candidate.candidateId))
  const diagnostics: ResearchAcquisitionDiagnostic[] = []
  const outcomes = new Map<string, ResearchProviderOutcome>()
  for (const item of bundle.items) for (const attempt of item.acquisition.attempts) {
    const provider = providerForSource(attempt.sourceId)
    const unsupported = attempt.status === 'UNSUPPORTED'
    const status = attempt.status === 'SUCCESS' ? 'usable' : attempt.status === 'NO_DATA' || attempt.status === 'POINT_IN_TIME_INVALID' ? 'empty' : unsupported ? 'unsupported' : 'failed'
    const prior = outcomes.get(provider) ?? { provider, providerAttempted: false, providerSucceeded: false, providerEmpty: false, providerFailed: false, usableSourceCount: 0 }
    const observation = item.acquisition.observations?.find((entry) => entry.source.sourceId === attempt.sourceId)
    const evidenceCount = observation?.data.kind === 'evidence' ? observation.data.documents.length : 0
    const evidenceOutcome = observation?.data.kind === 'evidence' ? observation.data.outcome : undefined
    const hasFailure = (status === 'failed' && !unsupported) || (evidenceOutcome?.failed ?? 0) > 0
    const hasEmpty = status === 'empty' || status === 'unsupported' || (evidenceOutcome?.empty ?? 0) > 0
    if (status !== 'usable') diagnostics.push({ provider, status, reason: attempt.diagnostic ?? attempt.status })
    if (evidenceOutcome?.diagnostics.length) diagnostics.push({ provider, status: evidenceOutcome.failed > 0 ? 'failed' : 'empty', reason: evidenceOutcome.diagnostics.join('; ').slice(0, 500) })
    const succeeded = status === 'usable' && (provider === 'akshare' ? item.value !== undefined : evidenceCount > 0)
    outcomes.set(provider, { ...prior, providerAttempted: prior.providerAttempted || !unsupported, providerSucceeded: prior.providerSucceeded || succeeded, providerEmpty: prior.providerEmpty || (!succeeded && hasEmpty), providerFailed: prior.providerFailed || hasFailure, usableSourceCount: prior.usableSourceCount + (succeeded ? provider === 'akshare' ? 1 : evidenceCount : 0) })
  }
  for (const [provider, outcome] of outcomes) outcomes.set(provider, {
    ...outcome,
    providerSucceeded: outcome.usableSourceCount > 0,
    providerEmpty: outcome.usableSourceCount === 0 && !outcome.providerFailed,
  })
  const providerOutcomes = [...outcomes.values()].sort((a, b) => a.provider.localeCompare(b.provider))
  const providerObservations = [...outcomes.entries()].flatMap(([provider, outcome]) => {
    const metadata = provider === 'akshare' ? { providerId: 'akshare', label: '结构化数据' }
      : provider === 'cninfo' ? { providerId: 'cninfo', label: '上市公司公告' }
        : provider === 'gdelt' ? { providerId: 'gdelt', label: '新闻资料' } : undefined
    if (!metadata) return []
    const attempts = bundle.items.flatMap((item) => item.acquisition.attempts.filter((attempt) => providerForSource(attempt.sourceId) === provider))
    const timedAttempts = attempts.map((attempt) => ({ startedAt: attempt.startedAt, completedAt: attempt.completedAt, start: Date.parse(attempt.startedAt), end: Date.parse(attempt.completedAt) }))
    const validTiming = timedAttempts.length > 0 && timedAttempts.every((attempt) => Number.isFinite(attempt.start) && Number.isFinite(attempt.end) && attempt.end >= attempt.start)
    const startedAt = validTiming ? timedAttempts.reduce((earliest, attempt) => attempt.start < earliest.start ? attempt : earliest).startedAt : undefined
    const completedAt = validTiming ? timedAttempts.reduce((latest, attempt) => attempt.end > latest.end ? attempt : latest).completedAt : undefined
    const status = outcome.usableSourceCount > 0
      ? outcome.providerFailed || diagnostics.some((item) => item.provider === provider && item.status !== 'usable') ? 'partial' as const : 'success' as const
      : outcome.providerFailed ? 'failed' as const : outcome.providerAttempted ? 'unavailable' as const : 'skipped' as const
    return [{ ...metadata, status, ...(provider === 'akshare' ? {} : { recordCount: outcome.usableSourceCount }), ...(startedAt === undefined ? {} : { startedAt }), ...(completedAt === undefined ? {} : { completedAt }), diagnostics: diagnostics.filter((item) => item.provider === provider).map((item) => item.status === 'failed' ? 'PROVIDER_ATTEMPT_FAILED' : item.status === 'empty' ? 'PROVIDER_NO_USABLE_DATA' : item.status === 'unsupported' ? 'PROVIDER_UNSUPPORTED' : 'PROVIDER_DATA_AVAILABLE') }]
  })
  await input.observations?.providerObservations(providerObservations)
  return { sources, durableSources, durableSourceCandidateIds, profileData, financialData: financialData?.rows, marketData: marketData?.rows, diagnostics, providerOutcomes }
}

export async function runCompanyDeepResearch(input: CompanyDeepResearchInput): Promise<CompanyDeepResearchResult> {
  try {
    check(input)
    const company = normalizeResearchCompany(input.company)
    abortIfNeeded(input.signal)
    const existingCompanyRef = await canonicalCompanyRef(input.handle, company)
    if (existingCompanyRef === undefined && input.securityIdentity === undefined) {
      return { workflowRunId: input.workflowRunId, status: 'blocked', knowledgeBaseId: input.handle.knowledgeBaseId, knowledgeBaseRevision: input.handle.revision, proposalIds: [], createdIds: [], updatedIds: [], committedIds: [], sourceIds: [], claimIds: [], errors: ['COMPANY_IDENTITY_UNVERIFIED'] }
    }
    const now = input.now ?? (() => new Date().toISOString())
    const asOf = input.asOf ?? now()
    await input.observations?.startStage('data_acquisition', '数据获取')
    const acquired = await acquire(input, company, asOf)
    abortIfNeeded(input.signal)
    await input.observations?.finishStage('data_acquisition', 'completed', { summary: `已处理 ${acquired.providerOutcomes.length} 个可观察数据源` })
    const gateway = new KnowledgeProductionGateway(new KnowledgeBaseRegistry())
    const existingKnowledgeProjection = input.useStructuredKnowledge === false ? [] : await gateway.projectExistingKnowledge(input.handle, company)
    await input.observations?.startStage('research_synthesis', '研究综合分析')
    let synthesisMode: 'reasoning_executor' | 'deterministic_fallback' | undefined
    await input.observations?.startSkill('company_research_synthesis', '公司研究综合分析')
    let research: Awaited<ReturnType<CompanyResearchSkill['synthesize']>>
    try {
      research = await new CompanyResearchSkill(now, input.reasoningExecutor).synthesize({ company, asOf, sources: acquired.sources, durableSourceCandidateIds: acquired.durableSourceCandidateIds, profileData: acquired.profileData, financialData: acquired.financialData, marketData: acquired.marketData, existingKnowledgeProjection }, (mode) => { synthesisMode = mode })
      await input.observations?.finishSkill('company_research_synthesis', 'completed', synthesisMode === 'reasoning_executor' ? '推理执行器综合分析已返回' : '采用确定性证据基线完成综合分析')
    } catch (error) {
      await input.observations?.finishSkill('company_research_synthesis', 'failed', '研究综合分析失败')
      throw error
    }
    await input.observations?.finishStage('research_synthesis', 'completed', { summary: '研究综合分析已返回' })
    const industryExposure = input.industryExposure === undefined ? undefined : calculateCompanyIndustryExposureBridge(input.industryExposure)
    const reportResearch = industryExposure === undefined ? research : { ...research, sections: research.sections.map((section) => section.title === 'Industry Exposure' ? { ...section, markdown: `${section.markdown}\n\n${renderCompanyIndustryExposureBridge(industryExposure)}`, sourceCandidateIds: [...new Set([...section.sourceCandidateIds, ...industryExposure.items.flatMap((item) => [...item.driver.sourceRefs, ...item.exposure.sourceRefs, ...(item.sensitivity?.sourceRefs ?? [])])])] } : section) }
    await input.observations?.startStage('quality_gate', '证据质量门')
    const qualityGate = runResearchQualityGate({ profile: 'company', asOf, sources: acquired.sources, referencedSourceCandidateIds: reportResearch.sections.flatMap((section) => section.sourceCandidateIds), proposalSourceCandidateIds: research.proposals.flatMap((proposal) => proposal.sourceCandidateIds ?? []), reportSourceCandidateIds: reportResearch.sections.flatMap((section) => section.sourceCandidateIds) })
    const noAcquiredEvidence = acquired.sources.length === 0
    await input.observations?.finishStage('quality_gate', qualityGate.eligibleForGateway && !noAcquiredEvidence ? 'completed' : 'blocked', { summary: qualityGate.eligibleForGateway && !noAcquiredEvidence ? '证据质量门通过' : '证据不足，未进入 Knowledge Gateway', diagnostics: noAcquiredEvidence ? ['NO_COMPANY_RESEARCH_EVIDENCE'] : qualityGate.diagnostics.filter((item) => item.severity === 'ERROR').map((item) => item.code) })
    if (!qualityGate.eligibleForGateway || noAcquiredEvidence) {
      const gapDiagnostics = [...qualityGate.diagnostics.filter((item) => item.severity === 'ERROR').map((item) => item.code), ...(noAcquiredEvidence ? ['NO_COMPANY_RESEARCH_EVIDENCE'] : [])]
      const blockedQualityGate = noAcquiredEvidence ? { ...qualityGate, status: 'FAIL' as const, eligibleForGateway: false, diagnostics: [...qualityGate.diagnostics, { code: 'NO_COMPANY_RESEARCH_EVIDENCE', severity: 'ERROR' as const, message: 'No usable Company profile, financial, market, or external research evidence was acquired.', affectedRefs: [] }] } : qualityGate
      const reportId = `company-research-${company.symbol.toLowerCase()}-${input.workflowRunId}`
      await input.observations?.startStage('report_generation', '研究报告生成')
      const report = validateResearchReport({ reportId, reportType: 'company_research', subjectRefs: existingCompanyRef ? [existingCompanyRef] : [], ...(input.securityIdentity === undefined ? {} : { verifiedSecurityIdentity: input.securityIdentity }), generatedAt: research.generatedAt, asOf, workflowRunId: input.workflowRunId, knowledgeBaseRevision: input.handle.revision, sourceRefs: [], claimRefs: [], methodology: 'Evidence-gated Company Research. This run is blocked because usable research evidence was unavailable; no company conclusions or canonical writes are asserted.', sections: reportResearch.sections.map((section) => ({ id: section.id, title: section.title, markdown: section.markdown, sourceRefs: [], claimRefs: [], evidenceLinks: section.id === 'company-overview' && input.securityIdentity?.sourceUrl?.startsWith('https://') ? [input.securityIdentity.sourceUrl] : [] })), outputPath: `${reportId}.md` })
      await input.observations?.finishStage('report_generation', 'completed', { summary: '阻塞结果报告已生成' })
      await input.observations?.startStage('report_persistence', '报告保存')
      const outputPath = await writeResearchReport(report, resolve(input.reportRoot))
      await input.observations?.finishStage('report_persistence', 'completed', { summary: '阻塞结果报告已保存' })
      return { workflowRunId: input.workflowRunId, status: 'blocked', knowledgeBaseId: input.handle.knowledgeBaseId, knowledgeBaseRevision: input.handle.revision, report: { reportId, outputPath }, proposalIds: research.proposals.map((proposal) => proposal.proposalId), createdIds: [], updatedIds: [], committedIds: [], sourceIds: [], claimIds: [], errors: gapDiagnostics.length ? gapDiagnostics : ['COMPANY_RESEARCH_QUALITY_GATE_FAILED'], research: reportResearch, industryExposure, acquisitionDiagnostics: acquired.diagnostics, providerOutcomes: acquired.providerOutcomes, qualityGate: blockedQualityGate }
    }
    const effectiveWriteKnowledge = input.writeKnowledge !== false && existingCompanyRef !== undefined
    let outcome: KnowledgeProductionOutcome = { status: 'no_changes', knowledgeBaseId: input.handle.knowledgeBaseId, knowledgeBaseRevision: input.handle.revision, baseRevision: input.handle.revision, createdIds: [], updatedIds: [], sourceRefsByLocalId: {}, claimRefsByProposalId: {}, entityRefsByLocalKey: {}, relationRefsByProposalId: {}, resolutionIntents: [], errors: [] }
    await input.observations?.startStage('knowledge_gateway', 'Knowledge Gateway')
    if (effectiveWriteKnowledge) {
      outcome = await gateway.submit({ handle: input.handle, producerType: 'company_deep_research', producerRunId: input.workflowRunId, schemaProfile: { schemaVersion: '0.4', storageFormatVersion: '1', requiresRawProvenance: true }, entity: { localKey: 'company', entityType: 'company', name: company.name ?? company.symbol, aliases: [company.symbol], semanticFields: { ticker: company.symbol, exchange: company.exchange } }, proposals: research.proposals, evidenceBindings: acquired.durableSources.map((source) => ({ localSourceId: source.candidate.candidateId, source })), asOf, now, writeKnowledge: true })
      const persisted = new Set((await readCanonicalV04Assets(input.handle.rootRef)).registry.map((entry) => entry.id))
      const submittedRefs = [...Object.values(outcome.sourceRefsByLocalId), ...Object.values(outcome.claimRefsByProposalId), ...Object.values(outcome.entityRefsByLocalKey), ...Object.values(outcome.relationRefsByProposalId)]
      const unpersistedRefs = submittedRefs.filter((ref) => !persisted.has(ref))
      if (unpersistedRefs.length > 0) { await input.observations?.finishStage('knowledge_gateway', 'blocked', { summary: 'Knowledge Gateway 引用校验未通过', diagnostics: ['CANONICAL_REFERENCE_NOT_PERSISTED'] }); return { workflowRunId: input.workflowRunId, status: 'blocked', knowledgeBaseId: input.handle.knowledgeBaseId, knowledgeBaseRevision: input.handle.revision, proposalIds: research.proposals.map((proposal) => proposal.proposalId), createdIds: [], updatedIds: [], committedIds: [], sourceIds: [], claimIds: [], errors: [`COMPANY_CANONICAL_REFERENCE_NOT_PERSISTED: ${[...new Set(unpersistedRefs)].sort().join(', ')}`], research: reportResearch, industryExposure, acquisitionDiagnostics: acquired.diagnostics, providerOutcomes: acquired.providerOutcomes, qualityGate } }
    }
    await input.observations?.finishStage('knowledge_gateway', outcome.status === 'blocked' || outcome.status === 'failed' ? 'blocked' : effectiveWriteKnowledge ? 'completed' : 'skipped', { summary: outcome.status === 'blocked' || outcome.status === 'failed' ? 'Knowledge Gateway 未完成写入' : effectiveWriteKnowledge ? 'Knowledge Gateway 已返回' : '本次未授权 Knowledge 写入', ...((outcome.status === 'blocked' || outcome.status === 'failed') ? { diagnostics: ['KNOWLEDGE_GATEWAY_BLOCKED'] } : {}) })
    if (outcome.status === 'blocked' || outcome.status === 'failed') return { workflowRunId: input.workflowRunId, status: 'blocked', knowledgeBaseId: input.handle.knowledgeBaseId, knowledgeBaseRevision: outcome.knowledgeBaseRevision, proposalIds: research.proposals.map((proposal) => proposal.proposalId), createdIds: [], updatedIds: [], committedIds: [], sourceIds: Object.values(outcome.sourceRefsByLocalId), claimIds: Object.values(outcome.claimRefsByProposalId), errors: outcome.errors, research, resolutionIntents: outcome.resolutionIntents, acquisitionDiagnostics: acquired.diagnostics, providerOutcomes: acquired.providerOutcomes, qualityGate }
    // Gateway dry-runs may return a planned entity ref even when writeKnowledge
    // is false. Only attach a ref backed by an entity actually present in the KB.
    const companyRef = existingCompanyRef
    const reportId = `company-research-${company.symbol.toLowerCase()}-${input.workflowRunId}`
    await input.observations?.startStage('report_generation', '研究报告生成')
    const report: ResearchReport = validateResearchReport({ reportId, reportType: 'company_research', subjectRefs: companyRef ? [companyRef] : [], ...(input.securityIdentity === undefined ? {} : { verifiedSecurityIdentity: input.securityIdentity }), generatedAt: research.generatedAt, asOf, workflowRunId: input.workflowRunId, knowledgeBaseRevision: outcome.knowledgeBaseRevision, sourceRefs: Object.values(outcome.sourceRefsByLocalId), claimRefs: Object.values(outcome.claimRefsByProposalId), methodology: 'Bounded acquisition -> semantic proposal -> deterministic canonical binding -> validated ChangeSet -> shared Writer.', sections: reportResearch.sections.map((section) => ({ id: section.id, title: section.title, markdown: section.markdown, sourceRefs: section.sourceCandidateIds.map((id) => outcome.sourceRefsByLocalId[id]).filter((id): id is string => id !== undefined), claimRefs: section.proposalIds.map((id) => outcome.claimRefsByProposalId[id]).filter((id): id is string => id !== undefined), evidenceLinks: [...new Set(section.sourceCandidateIds.flatMap((id) => { const source = acquired.sources.find((item) => item.candidate.candidateId === id); const url = source?.canonicalUrl ?? source?.candidate.url; return url && /^https:\/\//i.test(url) ? [url] : [] }))] })), outputPath: `${reportId}.md` })
    await input.observations?.finishStage('report_generation', 'completed', { summary: '研究报告已生成' })
    await input.observations?.startStage('report_persistence', '报告保存')
    const outputPath = await writeResearchReport(report, resolve(input.reportRoot))
    await input.observations?.finishStage('report_persistence', 'completed', { summary: '研究报告已保存' })
    return { workflowRunId: input.workflowRunId, status: 'completed', knowledgeBaseId: input.handle.knowledgeBaseId, knowledgeBaseRevision: outcome.knowledgeBaseRevision, report: { reportId, outputPath }, proposalIds: research.proposals.map((proposal) => proposal.proposalId), createdIds: outcome.createdIds, updatedIds: outcome.updatedIds, committedIds: [...outcome.createdIds, ...outcome.updatedIds], sourceIds: Object.values(outcome.sourceRefsByLocalId), claimIds: Object.values(outcome.claimRefsByProposalId), errors: [], research: reportResearch, industryExposure, resolutionIntents: outcome.resolutionIntents, acquisitionDiagnostics: acquired.diagnostics, providerOutcomes: acquired.providerOutcomes, qualityGate }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { workflowRunId: input.workflowRunId, status: message === 'WORKFLOW_CANCELLED' ? 'cancelled' : 'failed', knowledgeBaseId: input.handle.knowledgeBaseId, proposalIds: [], createdIds: [], updatedIds: [], committedIds: [], sourceIds: [], claimIds: [], errors: [message] }
  }
}
