import { resolve } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { KnowledgeBaseRegistry } from '../../knowledge/registry/registry.ts'
import { readCanonicalV04Assets } from '../../knowledge/storage/canonical-v04-loader.ts'
import { KnowledgeProductionGateway } from '../../knowledge/production/gateway.ts'
import type { KnowledgeProductionOutcome } from '../../knowledge/production/contracts.ts'
import type { CompanyResearchResult } from '../../skills/company-research/contracts.ts'
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
import { COMPANY_RESEARCH_METHOD_IDS, COMPANY_METHOD_SECTION_IDS, COMPANY_METHOD_METHODOLOGY, executeCompanyResearchMethod, type CompanyResearchMethodResult } from '../../skills/company-research/methods.ts'
import type { CompanyResearchInput } from '../../skills/company-research/contracts.ts'
import { prepareCompanyFinancialAnalysis, renderCompanyFinancialTable } from './financial-analysis.ts'
import { assembleCompanyResearch } from './assembly.ts'
import { evaluateCompanyResearchContent, mergeCompanySemanticQuality } from './content-quality.ts'
import { prepareCompanyMarketSizing } from './market-sizing.ts'
import { assessCompanySourceHealth, type CompanySourceAttemptTrace } from '../../data/company-source-health.ts'
import { reviewCompanyResearchSemantics } from './semantic-quality.ts'

const safeId = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
type AcquiredResearch = { readonly sources: readonly NormalizedResearchSource[]; readonly durableSources: readonly NormalizedResearchSource[]; readonly durableSourceCandidateIds: readonly string[]; readonly profileData?: CompanyProfileSnapshot; readonly financialData?: CompanyFinancialHistory['rows']; readonly marketData?: CompanyMarketHistory['rows']; readonly diagnostics: readonly ResearchAcquisitionDiagnostic[]; readonly providerOutcomes: readonly ResearchProviderOutcome[]; readonly sourceAttempts: readonly CompanySourceAttemptTrace[] }

function makeReportSections(research: CompanyResearchResult, acquired: AcquiredResearch, sourceRefs: Readonly<Record<string,string>>, claimRefs: Readonly<Record<string,string>>): ResearchReport['sections'] {
  return research.sections.map(section => {
    const locations = [...new Map([...section.markdown.matchAll(/\[([^\]\s]+)@(paragraph:(\d+))\]/g)].flatMap(match=>{
      const source = acquired.sources.find(source=>source.candidate.candidateId===match[1])
      const line = source?.content.split(/\r?\n/)[Number(match[3])-1]
      return source && line?.trim() ? [[`${match[1]}@${match[2]}`,{sourceCandidateId:match[1]!,location:match[2]!}] as const] : []
    })).values()]
    return {id:section.id,title:section.title,markdown:section.markdown,sourceRefs:section.sourceCandidateIds.flatMap(id=>sourceRefs[id]?[sourceRefs[id]!]:[]),claimRefs:section.proposalIds.flatMap(id=>claimRefs[id]?[claimRefs[id]!]:[]),evidenceLinks:[...new Set(section.sourceCandidateIds.flatMap(id=>{const source=acquired.sources.find(s=>s.candidate.candidateId===id);const url=source?.canonicalUrl ?? source?.candidate.url;return url?.startsWith('https://')?[url]:[]}))],evidenceLocations:locations.map(ref=>{const source=acquired.sources.find(s=>s.candidate.candidateId===ref.sourceCandidateId);return {sourceCandidateId:ref.sourceCandidateId,url:source?.canonicalUrl ?? source?.candidate.url,locator:ref.location,excerpt:source?.content.split(/\r?\n/)[Number(ref.location.split(':')[1])-1]?.slice(0,800)}})}
  })
}

function appendFinancialSummary(methods: CompanyResearchMethodResult[], researchInput: CompanyResearchInput): CompanyResearchMethodResult[] {
  const table = renderCompanyFinancialTable(researchInput)
  if (!table) return methods
  const source = researchInput.sources.find(source => source.candidate.candidateId === table.sourceCandidateId)
  const firstParagraph = source?.content.split(/\r?\n/)[0]
  if (!source || !firstParagraph?.trim()) return methods
  const deterministicPacket = {sourceCandidateId:table.sourceCandidateId,title:source.title,url:source.canonicalUrl ?? source.candidate.url,publisher:source.publisher,publishedAt:source.candidate.publishedAt,excerpts:[{sourceCandidateId:table.sourceCandidateId,location:'paragraph:1',text:firstParagraph}]}
  return methods.map(method => method.skillId !== 'financial_quality_analysis' || method.status !== 'complete' ? method : { ...method,
    deterministicEvidence: [...(method.deterministicEvidence ?? []).filter(packet => packet.sourceCandidateId !== table.sourceCandidateId),deterministicPacket],
    sections: method.sections.map(section => section.id !== 'financial-quality' ? section : {...section,markdown:`${section.markdown.split('\n\n确定性财务摘要（')[0]}\n\n${table.markdown}`}),
    findings: [...method.findings.filter(finding => finding.text !== '财务摘要直接列示取得的期间、单位和口径；缺失及冲突保留。'),{text:'财务摘要直接列示取得的期间、单位和口径；缺失及冲突保留。',kind:'fact' as const,evidence:[{sourceCandidateId:table.sourceCandidateId,location:'paragraph:1'}]}],
    sourceCandidateIds:[...new Set([...method.sourceCandidateIds,table.sourceCandidateId])],
  })
}

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

async function acquire(input: CompanyDeepResearchInput, company: CompanyDeepResearchInput['company'], asOf: string, deadlineAt: number, evidenceSearchTerms?: readonly string[], previous?: AcquiredResearch): Promise<AcquiredResearch> {
  const limit = Math.max(1, Math.min(input.maxSources ?? 20, 50))
  const now = input.now ?? (() => new Date().toISOString())
  const discoveredCandidateIds = new Set<string>()
  let consideredCandidateCount = 0
  const dataResolver: DataResolver<CompanyResearchDataPayload> = input.dataResolverFactory({
    company, asOf, asOfMode: input.asOf === undefined ? 'CURRENT_VALUE_ONLY' : 'HISTORICAL', now, signal: input.signal, limitPerSource: Math.min(10, limit),
    acquisitionDeadlineAt: deadlineAt,
    evidenceSearchTerms,
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
    ...(!previous?.profileData?.fields.length ? [materializePhase3CommonRequirement('company_basic_profile', context)] : []),
    ...(!previous?.financialData?.length ? [materializePhase3CommonRequirement('company_financial_history', context)] : []),
    ...(!previous?.marketData?.length ? [materializePhase3CommonRequirement('company_market_history', { ...context, period: { end: asOf } })] : []),
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
  const sourceAttempts: CompanySourceAttemptTrace[] = bundle.items.flatMap(item => item.acquisition.attempts.map(attempt => {
    const observation = item.acquisition.observations?.find(observation => observation.source.sourceId === attempt.sourceId)
    const validated = attempt.status === 'SUCCESS' && (observation?.data.kind === 'evidence' ? observation.data.documents.length > 0 : observation?.data !== undefined || item.value !== undefined && item.source?.sourceId === attempt.sourceId)
    return {metricId:item.metricId ?? item.requirementId,sourceId:attempt.sourceId,status:attempt.status,diagnostic:attempt.diagnostic,validated}
  }))
  return { sources, durableSources, durableSourceCandidateIds, profileData, financialData: financialData?.rows, marketData: marketData?.rows, diagnostics, providerOutcomes, sourceAttempts }
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
    const acquisitionDeadlineAt = Date.now() + 10 * 60_000
    let acquired = await acquire(input, company, asOf, acquisitionDeadlineAt)
    const sourceConflicts: {round:number;candidateId:string;retainedSource:NormalizedResearchSource;incomingSource:NormalizedResearchSource}[] = []
    abortIfNeeded(input.signal)
    await input.observations?.finishStage('data_acquisition', 'completed', { summary: `已处理 ${acquired.providerOutcomes.length} 个可观察数据源` })
    const gateway = new KnowledgeProductionGateway(new KnowledgeBaseRegistry())
    const existingKnowledgeProjection = input.useStructuredKnowledge === false ? [] : await gateway.projectExistingKnowledge(input.handle, company)
    await input.observations?.startStage('research_synthesis', '研究综合分析')
    let synthesisMode: string | undefined
    let synthesisDiagnostics: readonly string[] = []
    let methodResults: CompanyResearchMethodResult[] = []
    let semanticExecutionBlock: 'RATE_LIMIT_OR_QUOTA' | 'AUTHENTICATION_OR_ACCOUNT' | undefined
    let reviewedResearch: CompanyResearchResult | undefined
    let semanticReview: Awaited<ReturnType<typeof reviewCompanyResearchSemantics>> | undefined
    let marketSizing: Awaited<ReturnType<typeof prepareCompanyMarketSizing>> | undefined
    let synthesisAttempts = 0
    let reviewAttempts = 0
    const qualityReviewHistory: {review:Awaited<ReturnType<typeof reviewCompanyResearchSemantics>>;sections:CompanyResearchResult['sections']}[] = []
    let revisionTargets: typeof COMPANY_RESEARCH_METHOD_IDS[number][] = []
    let researchInput: CompanyResearchInput = { company, asOf, sources: acquired.sources, durableSourceCandidateIds: acquired.durableSourceCandidateIds, profileData: acquired.profileData, financialData: acquired.financialData, marketData: acquired.marketData, existingKnowledgeProjection, signal: input.signal }
    const assemble = async () => {
      methodResults = appendFinancialSummary(methodResults, researchInput)
      await input.observations?.startSkill('company_research_synthesis', '公司研究综合分析')
      const assembled = await assembleCompanyResearch({...researchInput,qualityFeedback:semanticReview?.issues ?? []}, methodResults, semanticExecutionBlock ? undefined : input.reasoningExecutor, now, 2-synthesisAttempts)
      synthesisAttempts += assembled.synthesisAttempts
      synthesisMode = assembled.synthesisMode
      synthesisDiagnostics = [...synthesisDiagnostics,...assembled.synthesisDiagnostics]
      await input.observations?.finishSkill('company_research_synthesis', synthesisMode === 'reasoning_executor' ? 'completed' : 'failed', synthesisMode === 'reasoning_executor' ? '推理执行器综合分析已返回' : '综合未通过校验，保留已有方法结果及未完成诊断')
      return assembled
    }
    const review = async (research: CompanyResearchResult) => {
      await input.observations?.startSkill('content_quality_review', '研究内容独立审查')
      const previousAttempts = reviewAttempts
      const result = await reviewCompanyResearchSemantics({...researchInput,sections:research.sections,methodResults,reasoningExecutor:input.reasoningExecutor,maxAttempts:(2-reviewAttempts) as 1|2})
      reviewAttempts += result.attempts
      semanticExecutionBlock = result.diagnostics.find(diagnostic => diagnostic.code === 'RATE_LIMIT_OR_QUOTA' || diagnostic.code === 'AUTHENTICATION_OR_ACCOUNT')?.code as typeof semanticExecutionBlock
      if (result.status === 'cancelled') throw new Error('WORKFLOW_CANCELLED')
      await input.observations?.finishSkill('content_quality_review', result.passed ? 'completed' : 'failed', result.passed ? '核心研究问题、依据及风险路径通过独立审查' : result.issues.join(';'))
      const merged = {...result,attempts:reviewAttempts,diagnostics:[...semanticReview?.diagnostics ?? [],...result.diagnostics.map(diagnostic=>({...diagnostic,attempt:previousAttempts+diagnostic.attempt}))]}
      qualityReviewHistory.push({review:merged,sections:research.sections})
      return merged
    }
    for (let round = 0; round <= 2; round++) {
      abortIfNeeded(input.signal)
      const reportSourceCandidateIds = [...new Set([...acquired.durableSourceCandidateIds, ...(input.asOf === undefined ? acquired.sources.filter(source => source.candidate.provider === 'public-web' && source.content.trim().length >= 120).map(source => source.candidate.candidateId) : [])])]
      researchInput = { ...researchInput, sources: acquired.sources, durableSourceCandidateIds: acquired.durableSourceCandidateIds, reportSourceCandidateIds }
      researchInput = { ...researchInput, preparedAnalysis: {financial:prepareCompanyFinancialAnalysis(researchInput),...(marketSizing ? {marketSizing} : {})} }
      if (round === 0 && input.reasoningExecutor) {
        await input.observations?.startSkill('market_sizing_inputs', '市场规模输入提取与确定性计算')
        marketSizing = await prepareCompanyMarketSizing({ ...researchInput, reasoningExecutor: input.reasoningExecutor, maxAttempts: 2 })
        researchInput = { ...researchInput, preparedAnalysis: { financial: prepareCompanyFinancialAnalysis(researchInput), marketSizing } }
        semanticExecutionBlock = marketSizing.diagnostics.find(diagnostic => diagnostic.code === 'RATE_LIMIT_OR_QUOTA' || diagnostic.code === 'AUTHENTICATION_OR_ACCOUNT')?.code as typeof semanticExecutionBlock
        await input.observations?.finishSkill('market_sizing_inputs', 'completed', marketSizing.calculations.length ? '来源绑定的市场规模已复算' : '市场规模数字缺口保留，继续行业结构研究')
      }
      const pending = COMPANY_RESEARCH_METHOD_IDS.filter(id => { const previous = methodResults.find(method => method.skillId === id); return !previous || ((previous.status !== 'complete' || revisionTargets.includes(id)) && previous.attempts < 2) })
      if (pending.length) reviewedResearch = undefined
      // Two independent methods at a time, bounded by the existing executor surface.
      for (let offset = 0; offset < pending.length && !semanticExecutionBlock; offset += 2) {
        const results = await Promise.all(pending.slice(offset, offset + 2).map(async skillId => {
          const previous = methodResults.find(method => method.skillId === skillId)
          await input.observations?.startSkill(skillId, skillId)
          const canonicalMethodology = await readFile(new URL(`../../skills/${skillId}/SKILL.md`, import.meta.url), 'utf8')
          const feedback = semanticReview?.sectionChecks.filter(check => COMPANY_METHOD_SECTION_IDS[skillId].includes(check.sectionId) && check.reasons.length).map(check => `${check.sectionId}: ${check.reasons.join(';')}`) ?? []
          const methodologyText = feedback.length ? `${canonicalMethodology}\n\nWorkflow 上轮内容审查反馈（需要重新核对提供的原文，不能把反馈当作事实）：\n${feedback.join('\n')}` : canonicalMethodology
          const result = await executeCompanyResearchMethod({ ...researchInput, skillId, methodology: methodologyText, reasoningExecutor: input.reasoningExecutor, maxAttempts: (2 - (previous?.attempts ?? 0)) as 1 | 2 })
          if (result.status === 'cancelled') throw new Error('WORKFLOW_CANCELLED')
          const merged = previous ? { ...result, attempts: previous.attempts + result.attempts, diagnostics: [...previous.diagnostics, ...result.diagnostics.map(diagnostic => ({...diagnostic,attempt:previous.attempts + diagnostic.attempt}))], attemptOutputs: [...previous.attemptOutputs ?? [], ...(result.attemptOutputs ?? []).map(output => ({...output,attempt:previous.attempts + output.attempt}))], citationRepairs: [...previous.citationRepairs ?? [], ...(result.citationRepairs ?? []).map(repair => ({...repair,attempt:previous.attempts + repair.attempt}))] } : result
          await input.observations?.finishSkill(skillId, result.status === 'complete' ? 'completed' : 'failed', result.status === 'complete' ? '原子研究方法完成，证据位置已校验' : result.diagnostics.map(d => d.code).join(';') || '研究证据不足')
          return merged
        }))
        methodResults = [...methodResults.filter(method => !results.some(result => result.skillId === method.skillId)), ...results]
        await mkdir(resolve(input.reportRoot), { recursive: true })
        await writeFile(resolve(input.reportRoot, `company-research-${company.symbol.toLowerCase()}-${input.workflowRunId}.progress.json`), JSON.stringify({ company, asOf, round, methodResults, updatedAt: now() }, null, 2), 'utf8')
        semanticExecutionBlock = results.flatMap(result => result.diagnostics).find(diagnostic => diagnostic.code === 'RATE_LIMIT_OR_QUOTA' || diagnostic.code === 'AUTHENTICATION_OR_ACCOUNT')?.code as typeof semanticExecutionBlock
        if (semanticExecutionBlock) break
      }
      if (semanticExecutionBlock) {
        for (const skillId of COMPANY_RESEARCH_METHOD_IDS.filter(id => !methodResults.some(method => method.skillId === id))) methodResults.push({skillId,status:'failed',attempts:0,answer:'',markdown:'',sections:[],findings:[],risks:[],sourceCandidateIds:[],limitations:['语义执行受账户或额度限制，本方法未调用。'],diagnostics:[{code:semanticExecutionBlock,message:'Execution stopped after a shared account or quota failure; this method was not invoked.',attempt:0}]})
        break
      }
      const incomplete = methodResults.filter(method => method.status !== 'complete')
      revisionTargets = []
      if (!incomplete.length && input.reasoningExecutor && synthesisAttempts < 2 && reviewAttempts < 2) {
        reviewedResearch = await assemble()
        const structural = evaluateCompanyResearchContent({sections:reviewedResearch.sections,synthesisMode,methodResults,methodExecutions:methodResults})
        if (!structural.passed) break
        semanticReview = await review(reviewedResearch)
        if (semanticReview.passed) break
        const failedIds = semanticReview.sectionChecks.filter(check => !check.questionAnswered || !check.evidenceSupportsConclusion || !check.numericReproducible || !check.riskTransmission).map(check => check.sectionId)
        revisionTargets = COMPANY_RESEARCH_METHOD_IDS.filter(id => COMPANY_METHOD_SECTION_IDS[id].some(sectionId => failedIds.includes(sectionId)))
        if (semanticReview.diagnostics.some(diagnostic => diagnostic.code === 'RATE_LIMIT_OR_QUOTA' || diagnostic.code === 'AUTHENTICATION_OR_ACCOUNT')) break
        if (reviewAttempts >= 2 || synthesisAttempts >= 2 || revisionTargets.some(id => (methodResults.find(method => method.skillId === id)?.attempts ?? 2) >= 2)) break
      }
      const needsSupplement = incomplete.some(method => method.attempts < 2) || !!semanticReview && !semanticReview.passed && reviewAttempts < 2 && synthesisAttempts < 2
      if (!needsSupplement || round === 2 || !input.reasoningExecutor || Date.now() >= acquisitionDeadlineAt) break
      const gapMethods = [...new Set([...incomplete.map(method => method.skillId),...revisionTargets])]
      const terms = [...new Set([...gapMethods.map(id => COMPANY_METHOD_METHODOLOGY[id].terms[0]!),...gapMethods.flatMap(id => COMPANY_METHOD_METHODOLOGY[id].terms)])].slice(0, 12)
      const supplemental = await acquire(input, company, asOf, acquisitionDeadlineAt, terms, acquired)
      const retained = new Map(acquired.sources.map(source => [source.candidate.candidateId, source]))
      const addedIds: string[] = []
      const conflictDiagnostics: ResearchAcquisitionDiagnostic[] = []
      for (const source of supplemental.sources) {
        const original = retained.get(source.candidate.candidateId)
        if (original) {
          if (original.contentHash !== source.contentHash) {
            sourceConflicts.push({round:round+1,candidateId:source.candidate.candidateId,retainedSource:original,incomingSource:source})
            conflictDiagnostics.push({provider:source.candidate.provider,candidateId:source.candidate.candidateId,status:'failed',reason:`SOURCE_CONTENT_CONFLICT: retained original ${original.contentHash}; supplemental ${source.contentHash} was not substituted or promoted`})
          }
          continue
        }
        if (retained.size >= (input.maxSources ?? 50)) continue
        retained.set(source.candidate.candidateId,source); addedIds.push(source.candidate.candidateId)
      }
      const sources = [...retained.values()]
      const durableSourceCandidateIds = [...new Set([...acquired.durableSourceCandidateIds, ...supplemental.durableSourceCandidateIds.filter(id=>addedIds.includes(id))])]
      const acceptedStructured = (kind: 'basic'|'financial'|'market') => durableSourceCandidateIds.includes(`akshare-${kind}-${company.symbol}`) && supplemental.sources.some(source=>source.candidate.candidateId===`akshare-${kind}-${company.symbol}` && retained.get(source.candidate.candidateId)?.contentHash===source.contentHash)
      acquired = { ...acquired, sources, durableSourceCandidateIds, durableSources: sources.filter(source => durableSourceCandidateIds.includes(source.candidate.candidateId)),
        profileData: acquired.profileData?.fields.length ? acquired.profileData : acceptedStructured('basic') ? supplemental.profileData : acquired.profileData,
        financialData: acquired.financialData?.length ? acquired.financialData : acceptedStructured('financial') ? supplemental.financialData : acquired.financialData,
        marketData: acquired.marketData?.length ? acquired.marketData : acceptedStructured('market') ? supplemental.marketData : acquired.marketData,
        diagnostics: [...acquired.diagnostics, ...supplemental.diagnostics,...conflictDiagnostics], providerOutcomes: [...acquired.providerOutcomes, ...supplemental.providerOutcomes], sourceAttempts:[...acquired.sourceAttempts,...supplemental.sourceAttempts] }
      researchInput = {...researchInput,profileData:acquired.profileData,financialData:acquired.financialData,marketData:acquired.marketData}
    }
    const research: CompanyResearchResult = reviewedResearch ?? await assemble()
    await input.observations?.finishStage('research_synthesis', synthesisMode === 'reasoning_executor' ? 'completed' : 'blocked', { summary: synthesisMode === 'reasoning_executor' ? '研究综合分析已返回' : '研究综合未通过，不能宣称完成', diagnostics: [...synthesisDiagnostics] })
    const industryExposure = input.industryExposure === undefined ? undefined : calculateCompanyIndustryExposureBridge(input.industryExposure)
    const reportResearch = industryExposure === undefined ? research : { ...research, sections: research.sections.map((section) => section.title === 'Industry Exposure' ? { ...section, markdown: `${section.markdown}\n\n${renderCompanyIndustryExposureBridge(industryExposure)}`, sourceCandidateIds: [...new Set([...section.sourceCandidateIds, ...industryExposure.items.flatMap((item) => [...item.driver.sourceRefs, ...item.exposure.sourceRefs, ...(item.sensitivity?.sourceRefs ?? [])])])] } : section) }
    await input.observations?.startStage('quality_gate', '证据质量门')
    const qualityGate = runResearchQualityGate({ profile: 'company', asOf, sources: acquired.sources, referencedSourceCandidateIds: reportResearch.sections.flatMap((section) => section.sourceCandidateIds), proposalSourceCandidateIds: research.proposals.flatMap((proposal) => proposal.sourceCandidateIds ?? []), reportSourceCandidateIds: reportResearch.sections.flatMap((section) => section.sourceCandidateIds) })
    const structuralContentQuality = evaluateCompanyResearchContent({ sections: reportResearch.sections, synthesisMode, methodResults, methodExecutions: methodResults })
    let contentQuality = structuralContentQuality
    if (structuralContentQuality.passed) {
      if ((industryExposure !== undefined && !semanticExecutionBlock) || !semanticReview) {
        semanticReview = reviewAttempts < 2 ? await review(reportResearch) : {passed:false,status:'failed',attempts:2,sectionChecks:[],issues:['SEMANTIC_REVIEW_BUDGET_EXHAUSTED'],diagnostics:[]}
      }
      contentQuality = mergeCompanySemanticQuality(structuralContentQuality,semanticReview)
    }
    const methodExecutions = methodResults.map(method => ({skillId:method.skillId,status:method.status,attempts:method.attempts,summary:method.answer.slice(0,300),...(method.diagnostics.at(-1)?{errorCode:method.diagnostics.at(-1)!.code}:{})}))
    await mkdir(resolve(input.reportRoot), {recursive:true})
    await writeFile(resolve(input.reportRoot, `company-research-${company.symbol.toLowerCase()}-${input.workflowRunId}.analysis.json`), JSON.stringify({asOf,company,methodResults,contentQuality,synthesisMode,synthesisDiagnostics,synthesisAttempts,reviewAttempts,qualityReviewHistory,sourceConflicts,preparedAnalysis:researchInput.preparedAnalysis,sourceDiagnostics:acquired.diagnostics,sourceAttempts:acquired.sourceAttempts,sourceAdvice:assessCompanySourceHealth(acquired.sourceAttempts),sourceSummaries:acquired.sources.map(source=>({candidateId:source.candidate.candidateId,title:source.title,url:source.canonicalUrl,publishedAt:source.candidate.publishedAt,contentHash:source.contentHash,content:source.content}))},null,2),'utf8')
    const noAcquiredEvidence = acquired.sources.length === 0
    await input.observations?.finishStage('quality_gate', qualityGate.eligibleForGateway && !noAcquiredEvidence && contentQuality.passed ? 'completed' : 'blocked', { summary: contentQuality.passed ? '证据与研究内容质量门已验收' : '公司研究核心内容未完成，未进入 Knowledge Gateway', diagnostics: [...(noAcquiredEvidence ? ['NO_COMPANY_RESEARCH_EVIDENCE'] : qualityGate.diagnostics.filter((item) => item.severity === 'ERROR').map((item) => item.code)),...contentQuality.issues] })
    if (!qualityGate.eligibleForGateway || noAcquiredEvidence || !contentQuality.passed) {
      const gapDiagnostics = [...qualityGate.diagnostics.filter((item) => item.severity === 'ERROR').map((item) => item.code), ...(noAcquiredEvidence ? ['NO_COMPANY_RESEARCH_EVIDENCE'] : []), ...contentQuality.issues]
      const blockedQualityGate = noAcquiredEvidence ? { ...qualityGate, status: 'FAIL' as const, eligibleForGateway: false, diagnostics: [...qualityGate.diagnostics, { code: 'NO_COMPANY_RESEARCH_EVIDENCE', severity: 'ERROR' as const, message: 'No usable Company profile, financial, market, or external research evidence was acquired.', affectedRefs: [] }] } : qualityGate
      const reportId = `company-research-${company.symbol.toLowerCase()}-${input.workflowRunId}`
      await input.observations?.startStage('report_generation', '研究报告生成')
      const report = validateResearchReport({ reportId, reportType: 'company_research', subjectRefs: existingCompanyRef ? [existingCompanyRef] : [], ...(input.securityIdentity === undefined ? {} : { verifiedSecurityIdentity: input.securityIdentity }), generatedAt: research.generatedAt, asOf, workflowRunId: input.workflowRunId, knowledgeBaseRevision: input.handle.revision, sourceRefs: [], claimRefs: [], researchQuality: contentQuality, methodExecutions, methodology: noAcquiredEvidence ? '本轮未取得可用公司研究证据，报告保留具体来源故障与待回答问题；未执行 Knowledge 写入。' : '本轮已有证据及部分研究结果，但证据质量、核心研究内容或独立语义审查未全部通过；保留通过核验的分析、具体缺口和失败诊断，未执行 Knowledge 写入。', sections: makeReportSections(reportResearch, acquired, {}, {}), outputPath: `${reportId}.md` })
      await input.observations?.finishStage('report_generation', 'completed', { summary: '阻塞结果报告已生成' })
      await input.observations?.startStage('report_persistence', '报告保存')
      const outputPath = await writeResearchReport(report, resolve(input.reportRoot))
      await input.observations?.finishStage('report_persistence', 'completed', { summary: '阻塞结果报告已保存' })
      return { workflowRunId: input.workflowRunId, status: 'blocked', knowledgeBaseId: input.handle.knowledgeBaseId, knowledgeBaseRevision: input.handle.revision, report: { reportId, outputPath }, proposalIds: research.proposals.map((proposal) => proposal.proposalId), createdIds: [], updatedIds: [], committedIds: [], sourceIds: [], claimIds: [], errors: gapDiagnostics.length ? gapDiagnostics : ['COMPANY_RESEARCH_QUALITY_GATE_FAILED'], research: reportResearch, industryExposure, acquisitionDiagnostics: acquired.diagnostics, providerOutcomes: acquired.providerOutcomes, qualityGate: blockedQualityGate }
    }
    const effectiveWriteKnowledge = input.writeKnowledge !== false && (existingCompanyRef !== undefined || input.writeKnowledge === true)
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
    const companyRef = existingCompanyRef ?? (effectiveWriteKnowledge ? outcome.entityRefsByLocalKey.company : undefined)
    const reportId = `company-research-${company.symbol.toLowerCase()}-${input.workflowRunId}`
    await input.observations?.startStage('report_generation', '研究报告生成')
    const report: ResearchReport = validateResearchReport({ reportId, reportType: 'company_research', subjectRefs: companyRef ? [companyRef] : [], ...(input.securityIdentity === undefined ? {} : { verifiedSecurityIdentity: input.securityIdentity }), generatedAt: research.generatedAt, asOf, workflowRunId: input.workflowRunId, knowledgeBaseRevision: outcome.knowledgeBaseRevision, sourceRefs: Object.values(outcome.sourceRefsByLocalId), claimRefs: Object.values(outcome.claimRefsByProposalId), researchQuality: contentQuality, methodExecutions, methodology: '原子方法研究与跨方法综合；来源及内容双重验收；Knowledge 写入由 Gateway、Validation 和 Writer 执行。', sections: makeReportSections(reportResearch, acquired, outcome.sourceRefsByLocalId, outcome.claimRefsByProposalId), outputPath: `${reportId}.md` })
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
