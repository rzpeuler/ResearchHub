import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { KnowledgeBaseRegistry } from '../../knowledge/registry/registry.ts'
import { KnowledgeProductionGateway } from '../../knowledge/production/gateway.ts'
import { createFreshKnowledgeBaseV04, readCanonicalV04Assets } from '../../knowledge/storage/index.ts'
import { runCompanyDeepResearch as executeCompanyDeepResearch } from '../../workflows/company-deep-research/index.ts'
import { acquireCompanyReadOnlyData, addCompanyMethodEvidenceInstructions, appendCompanyOfficialContextEvidence, applyCompanyResearchTableDiagnostics, initialCompanyResearchSearchTerms, mergeCompanyMethodRevisionResult } from '../../workflows/company-deep-research/workflow.ts'
import { COMPANY_RESEARCH_METHOD_IDS, type CompanyResearchMethodResult } from '../../skills/company-research/methods.ts'
import { COMPANY_CORE_SECTION_IDS } from '../../workflows/company-deep-research/content-quality.ts'
import { mergeCompanySemanticQuality } from '../../workflows/company-deep-research/content-quality.ts'
import { validateCompanyResearchSectionTables } from '../../workflows/company-deep-research/assembly.ts'
import { completeResearchExecutor, fixtureCompanyDataResolverFactory } from '../fixtures/company-quality.ts'
import { createCompanyResearchDataResolver } from '../../plugins/research-acquisition/company-research-data.ts'
import { materializePhase3CommonRequirement } from '../../data/requirements.ts'
import { DataResolver } from '../../data/resolver.ts'
import type { AcquisitionResult } from '../../data/contracts.ts'
import type { CompanyResearchDataPayload } from '../../plugins/research-acquisition/company-research-data.ts'
import type { CompanyDeepResearchResolverOptions } from '../../workflows/company-deep-research/contracts.ts'
import type { ResearchAcquisitionPlugin, ResearchSignal, ResearchSignalStore, ResearchSourceCandidate } from '../../plugins/research-acquisition/contracts.ts'
import type { AkshareDataClient } from '../../plugins/research-acquisition/akshare.ts'
import type { ReasoningExecutor } from '../../plugins/reasoning/contracts.ts'
import type { VerifiedSecurityIdentity } from '../../data/security-identity-contracts.ts'
import { SecurityIdentityResolver } from '../../app/services/security-identity-resolver.ts'
import { createSecurityIdentityDataResolver, type AkshareSecurityDirectoryClient } from '../../plugins/research-acquisition/security-identity-data.ts'
import { ResearchService } from '../../app/services/research-service.ts'
import { WorkflowService } from '../../app/services/workflow-service.ts'
import { writeKnowledgeBase } from '../../knowledge/writer/writer.ts'
import { KnowledgeBaseRegistry as Registry } from '../../knowledge/registry/registry.ts'

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }

test('late employee-plan transfer note is routed into governance method evidence with exact paragraph locators',()=>{
  const lines=Array.from({length:6009},()=> '')
  lines[1390]='报告期内全部有效的员工持股计划情况'
  lines[1391]='员工人数'
  lines[1401]='公司及子公司核心技术（业务）骨干'
  lines[1402]='（不包括公司董事、高级管理人员）'
  lines[1403]='150 3,048,701 无 0.17%'
  lines[6007]='其他说明，包括本期增减变动情况、变动原因说明：公司于 2026 年 3 月 9 日以非交易过户方式将回购证券账户中的'
  lines[6008]='3,048,701 股过户至 2026 年员工持股计划证券账户。'
  const source={candidate:{candidateId:'interim',kind:'official_disclosure',publishedAt:'2026-08-22'},title:'2026年半年度报告',content:lines.join('\n')}
  const method={skillId:'management_governance_analysis',status:'complete',attempts:1,answer:'',markdown:'',sections:[],findings:[],sourceCandidateIds:[],limitations:[],risks:[],diagnostics:[]} as unknown as CompanyResearchMethodResult
  const [routed]=appendCompanyOfficialContextEvidence([method],{sources:[source]} as never)
  const packet=routed!.deterministicEvidence?.find(item=>item.sourceCandidateId==='interim')
  assert.ok(packet)
  assert.ok(packet.excerpts.some(item=>item.location==='paragraph:6008'&&/回购证券账户中的/.test(item.text)))
  assert.ok(packet.excerpts.some(item=>item.location==='paragraph:6009'&&/2026\s*年员工持股计划证券账户/.test(item.text)))
})

const runCompanyDeepResearch: typeof executeCompanyDeepResearch = (input) => executeCompanyDeepResearch({ ...input, reasoningExecutor: Object.prototype.hasOwnProperty.call(input, 'reasoningExecutor') ? input.reasoningExecutor : completeResearchExecutor() })

test('initial company research acquisition prioritizes target filings and business evidence before peer searches', () => {
  const terms = initialCompanyResearchSearchTerms({ symbol: '002594', name: '比亚迪' })
  assert.deepEqual(terms.slice(0, 4), ['比亚迪 年报 半年报 业绩报告', '比亚迪 主营业务 产品 技术', '比亚迪 行业 市场规模 竞争', '比亚迪 管理层 战略 投资者关系'])
  assert.ok(terms.includes('peer:吉利汽车'))
  assert.ok(terms.includes('peer:宁德时代'))
})

test('Company Deep Research read-only resolver requirements retain exact IDs and fiscal/PIT context', async () => {
  const asOf = '2026-09-08T00:00:00.000Z'
  let valuationContext: any
  let earningsContext: any
  let valuationRequirements: readonly any[] = []
  let earningsRequirements: readonly any[] = []
  const resolver = { async resolve(requirements: readonly any[]) {
    const items = requirements.map((requirement) => ({ requirementId: requirement.id, value: { kind: `fixture:${requirement.metricId}` }, attempts: [{ sourceId: 'fixture-route', status: 'SUCCESS' }], acquisition: { attempts: [{ sourceId: 'fixture-route', status: 'SUCCESS' }] } }))
    return { items, requiredUnresolved: [], optionalUnresolved: [], completeness: 'COMPLETE' as const, seen: requirements }
  } }
  const result = await acquireCompanyReadOnlyData({
    asOf,
    valuationDataResolverFactory: (context) => { valuationContext = context; return { ...resolver, async resolve(requirements: readonly any[]) { valuationRequirements = requirements; return resolver.resolve(requirements) } } as unknown as DataResolver<any> },
    earningsDataResolverFactory: (context) => { earningsContext = context; return { ...resolver, async resolve(requirements: readonly any[]) { earningsRequirements = requirements; return resolver.resolve(requirements) } } as unknown as DataResolver<any> },
  }, { symbol: '600519', name: 'Fixture Company', exchange: 'SH' }, asOf, () => asOf)
  assert.equal(result?.expectationTargetFiscalYear, 2026)
  assert.equal(result?.valuationBasisFiscalYear, 2025)
  assert.equal(valuationContext.valuationDate, asOf)
  assert.equal(valuationContext.historicalAsOf, asOf)
  assert.equal(earningsContext.fiscalYear, 2026)
  assert.equal(earningsContext.period, 'FY')
  assert.deepEqual(valuationRequirements.map((requirement) => requirement.metricId), ['valuation_market_price', 'valuation_eps', 'valuation_bvps', 'valuation_annual_report_publication', 'valuation_peer_candidate_evidence'])
  assert.deepEqual(earningsRequirements.map((requirement) => requirement.metricId), ['earnings_expectation_eps', 'earnings_expectation_net_profit'])
  assert.ok(valuationRequirements.every((requirement) => requirement.consumer.workflow === 'company-deep-research' && requirement.asOfMode === 'HISTORICAL'))
  assert.ok(valuationRequirements.filter((requirement) => ['valuation_eps', 'valuation_bvps'].includes(requirement.metricId)).every((requirement) => requirement.requireValueVersionProof === true && requirement.period.fiscalYear === 2025))
  assert.ok(earningsRequirements.every((requirement) => requirement.period.fiscalYear === 2026 && requirement.period.fiscalPeriod === '2026-FY' && requirement.asOfMode === 'HISTORICAL'))
  assert.equal(result?.valuationItems[0]?.value?.kind, 'fixture:valuation_market_price')
  assert.equal(result?.valuationItems[0]?.attempts[0]?.sourceId, 'fixture-route')
  assert.equal(result?.earningsExpectationItems[0]?.value?.kind, 'fixture:earnings_expectation_eps')
  let currentRequirements: readonly any[] = []
  await acquireCompanyReadOnlyData({
    valuationDataResolverFactory: () => ({ ...resolver, async resolve(requirements: readonly any[]) { currentRequirements = requirements; return resolver.resolve(requirements) } } as unknown as DataResolver<any>),
  }, { symbol: '600519', name: 'Fixture Company', exchange: 'SH' }, asOf, () => asOf)
  assert.ok(currentRequirements.every((requirement) => requirement.asOfMode === 'CURRENT_VALUE_ONLY'))
  assert.ok(currentRequirements.filter((requirement) => ['valuation_eps', 'valuation_bvps'].includes(requirement.metricId)).every((requirement) => requirement.requireValueVersionProof !== true))
})

test('risk method instructions require exact table total rows and local unit/header citations', () => {
  const methodology = 'Analyze the disclosed company risks.'
  const risk = addCompanyMethodEvidenceInstructions('company_risk_analysis', methodology)
  assert.ok(risk.startsWith(methodology))
  assert.match(risk, /汇总行有该数字时，必须引用汇总行/)
  assert.match(risk, /同时引用本次输入实际提供的对应表头和单位行/)
  assert.match(risk, /不得把相邻表格的表头、期间或单位借给本行/)
  assert.match(risk, /风险矩阵固定使用五列/)
  assert.match(risk, /每个风险数据行必须恰有五格/)
  assert.match(risk, /各操作数均逐项引用/)
  assert.equal(addCompanyMethodEvidenceInstructions('financial_quality_analysis', methodology), methodology)
})

test('market structure keeps industry and product classifications in their owner sections', () => {
  const methodology = 'Analyze disclosed market structure.'
  const market = addCompanyMethodEvidenceInstructions('market_structure_analysis', methodology)
  assert.ok(market.startsWith(methodology))
  assert.match(market, /只展示分行业原表行/)
  assert.match(market, /分产品数据由 business-segments 负责/)
  assert.match(market, /完整列头、分隔行和数据行紧邻排列/)
  assert.equal(addCompanyMethodEvidenceInstructions('financial_quality_analysis', methodology), methodology)
})

test('failed review-only method revision retains the prior validated result and its failure trace', () => {
  const previous: CompanyResearchMethodResult = {
    skillId: 'company_history_strategy', status: 'complete', attempts: 1,
    answer: 'validated answer', markdown: 'validated section [annual@paragraph:1]',
    sections: [{ id: 'company-overview', markdown: 'validated section [annual@paragraph:1]' }],
    findings: [{ text: 'validated fact', kind: 'fact', evidence: [{ sourceCandidateId: 'annual', location: 'paragraph:1' }] }],
    sourceCandidateIds: ['annual'], limitations: [], risks: [],
    diagnostics: [], attemptOutputs: [{ attempt: 1, output: { accepted: true } }],
  }
  const failedRevision: CompanyResearchMethodResult = {
    ...previous, status: 'failed', attempts: 1, answer: '', markdown: '', sections: [], findings: [],
    diagnostics: [{ code: 'REFERENCE_ERROR', message: 'unknown locator', attempt: 1 }],
    attemptOutputs: [{ attempt: 1, output: { accepted: false } }],
  }
  const retained = mergeCompanyMethodRevisionResult(previous, failedRevision, { preserveCompletedOnReviewFailure: true })
  assert.equal(retained.status, 'complete')
  assert.equal(retained.markdown, previous.markdown)
  assert.equal(retained.attempts, 2)
  assert.deepEqual(retained.attemptOutputs?.map(item => item.output), [{ accepted: true }, { accepted: false }])
  assert.ok(retained.diagnostics.some(item => item.code === 'REFERENCE_ERROR'))
  assert.ok(retained.diagnostics.some(item => item.code === 'REVIEW_REVISION_FAILED_PRIOR_COMPLETED_RESULT_RETAINED'))

  const refreshRequired = { ...previous, diagnostics: [{ code: 'EVIDENCE_REFRESH_REQUIRED', message: 'new annual report', attempt: 1 }] }
  const notRetained = mergeCompanyMethodRevisionResult(refreshRequired, failedRevision, { preserveCompletedOnReviewFailure: true })
  assert.equal(notRetained.status, 'failed')
  assert.equal(notRetained.markdown, '')
  assert.equal(mergeCompanyMethodRevisionResult(previous, failedRevision, { preserveCompletedOnReviewFailure: false }).status, 'failed')
})

test('ResearchService forwards Workflow peer search terms into the default public-web resolver', async () => {
  const terms = ['BYD 年报', 'peer:吉利汽车', 'peer:特斯拉']
  let seenTerms: readonly string[] | undefined
  const publicWeb: ResearchAcquisitionPlugin = {
    name: 'company-public-web-fixture',
    async discover(request) { if (request.company) seenTerms = request.searchTerms; return [] },
    async fetch() { throw new Error('no candidates expected') },
    async normalize() { throw new Error('no candidates expected') },
  }
  const service = new ResearchService({ mountedKnowledgeBaseRoot: '.', acquisitionPlugins: [], companyPublicWeb: publicWeb, workflowService: new WorkflowService() })
  const resolverFactory = (service as unknown as { createCompanyDataResolverFactory(): (context: CompanyDeepResearchResolverOptions) => DataResolver<CompanyResearchDataPayload> }).createCompanyDataResolverFactory()
  const resolver = resolverFactory({
    company: { symbol: '002594', name: '比亚迪' }, asOf: '2026-10-08T12:00:00.000Z', asOfMode: 'CURRENT_VALUE_ONLY', now: () => '2026-10-08T12:00:00.000Z',
    limitPerSource: 10, evidenceSearchTerms: terms, onCandidatesDiscovered: () => undefined,
  })
  const requirement = materializePhase3CommonRequirement('company_research_evidence', {
    workflowId: 'company-deep-research', ticker: '002594', companyId: '比亚迪', asOf: '2026-10-08T12:00:00.000Z',
  })
  await resolver.resolveOne(requirement)
  assert.deepEqual(seenTerms, terms)
})

test('a transient CNINFO failure is retried before semantic methods consume their call budget', async () => {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-company-primary-retry-'))
  const reports = await mkdtemp(join(tmpdir(), 'researchhub-company-primary-retry-reports-'))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-company-primary-retry', now: '2026-09-08T00:00:00.000Z' })
    await seedCanonicalCompany(root, '600519', 'Fixture Company')
    const candidate: ResearchSourceCandidate = { candidateId: 'official-primary-retry', kind: 'official_disclosure', tier: 1, title: '2025年度报告', url: 'https://example.com/2025-report', provider: 'cninfo', publishedAt: '2026-09-01T00:00:00.000Z', metadata: { companySymbol: '600519' } }
    let discoveries = 0
    const official: ResearchAcquisitionPlugin = {
      name: 'fixture-cninfo',
      discover: async () => { discoveries++; return [candidate] },
      fetch: async (found) => {
        if (discoveries === 1) throw new Error('HTTP 504')
        return { candidate: found, retrievedAt: '2026-09-08T00:00:00.000Z', content: 'Fixture Company 2025年度报告：主营业务稳定，产品覆盖多个细分市场。', contentHash: 'd'.repeat(64) }
      },
      normalize: async (fetched) => ({ candidate: fetched.candidate, retrievedAt: fetched.retrievedAt, title: fetched.candidate.title, content: fetched.content, contentHash: fetched.contentHash!, canonicalUrl: fetched.candidate.url!, publisher: 'Fixture Exchange', rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false } }),
    }
    const observed: string[] = []
    const delegate = completeResearchExecutor()
    const reasoningExecutor: ReasoningExecutor = { ...delegate, execute: async (request, signal) => {
      if (request.operation === 'company_research_method' && request.input && typeof request.input === 'object') {
        const evidence = (request.input as { evidence?: readonly { sourceCandidateId: string }[] }).evidence ?? []
        observed.push(...evidence.map(item => item.sourceCandidateId))
      }
      return delegate.execute(request, signal)
    } }
    const result = await runCompanyDeepResearch({ workflowRunId: 'company-primary-report-retry', handle: await new KnowledgeBaseRegistry().mount(root), company: { symbol: '600519', name: 'Fixture Company' }, dataResolverFactory: options => createCompanyResearchDataResolver({ ...options, officialDisclosure: official }), reportRoot: reports, asOf: '2026-09-08T00:00:00.000Z', now: () => '2026-09-08T00:00:00.000Z', writeKnowledge: false, useStructuredKnowledge: false, reasoningExecutor })
    assert.ok(discoveries >= 2, 'expected one bounded pre-method CNINFO retry')
    assert.ok(observed.includes('official-primary-retry'), 'official report must be available to methods before semantic calls')
    assert.equal(result.status, 'completed')
  } finally { await rm(root, { recursive: true, force: true }); await rm(reports, { recursive: true, force: true }) }
})

function resolverFactory(plugins: readonly ResearchAcquisitionPlugin[], akshare?: AkshareDataClient) {
  return (options: CompanyDeepResearchResolverOptions) => createCompanyResearchDataResolver({
    ...options,
    ...(akshare ? { akshare } : {}),
    officialDisclosure: plugins.find((plugin) => /official|cninfo/i.test(plugin.name)),
    gdelt: plugins.find((plugin) => /gdelt/i.test(plugin.name)),
  })
}

async function snapshotKnowledgeTree(root: string): Promise<readonly string[]> {
  const entries: string[] = []
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name)
      if (entry.isDirectory()) { entries.push(`dir:${absolute.slice(root.length)}`); await visit(absolute) }
      else if (entry.isFile()) entries.push(`file:${absolute.slice(root.length)}:${createHash('sha256').update(await readFile(absolute)).digest('hex')}`)
    }
  }
  await visit(root)
  return entries.sort()
}

async function seedCanonicalCompany(root: string, symbol: string, name: string, asOf = '2026-09-08T00:00:00.000Z'): Promise<void> {
  const handle = await new KnowledgeBaseRegistry().mount(root)
  const result = await new KnowledgeProductionGateway().submit({ handle, producerType: 'fixture_identity', producerRunId: `identity-${symbol}`, schemaProfile: { schemaVersion: '0.4', storageFormatVersion: '1', requiresRawProvenance: true }, entity: { localKey: 'company', entityType: 'company', name, aliases: [symbol], semanticFields: { ticker: symbol, exchange: symbol.endsWith('519') ? 'SH' : 'SZ' } }, proposals: [], evidenceBindings: [], asOf, now: () => asOf })
  assert.equal(result.status, 'committed')
}

test('Company Deep Research produces atomic canonical Knowledge and a linked report', async () => {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-company-'))
  const reports = await mkdtemp(join(tmpdir(), 'researchhub-company-reports-'))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-company-test', now: '2026-09-08T00:00:00.000Z' })
    await seedCanonicalCompany(root, '600519', 'Fixture Company')
    const handle = await new KnowledgeBaseRegistry().mount(root)
    const signals: ResearchSignal[] = []
    const signalStore: ResearchSignalStore = { append: async (signal) => { signals.push(signal) }, listForCompany: async () => signals }
    let content = 'The company reported stable revenue and profit.'
    const plugin: ResearchAcquisitionPlugin = {
      name: 'fixture-official',
      discover: async () => [{ candidateId: 'official-1', kind: 'official_disclosure', tier: 1, title: 'Fixture filing', url: 'https://example.com/filing', provider: 'cninfo', publishedAt: '2026-09-07T00:00:00.000Z', metadata: { companySymbol: '600519' } }],
      fetch: async (candidate) => ({ candidate, retrievedAt: '2026-09-08T00:00:00.000Z', content, contentHash: content.includes('improved') ? 'c'.repeat(64) : 'b'.repeat(64) }),
      normalize: async (fetched) => ({ candidate: fetched.candidate, retrievedAt: fetched.retrievedAt, title: fetched.candidate.title, content: fetched.content, contentHash: fetched.contentHash!, canonicalUrl: fetched.candidate.url, publisher: fetched.candidate.provider, rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false } }),
    }
    const semanticCalls: string[] = []
    const input = { workflowRunId: 'company-run-1', handle, company: { symbol: '600519', name: 'Fixture Company' }, dataResolverFactory: resolverFactory([plugin]), signalStore, reportRoot: reports, now: () => '2026-09-08T00:00:00.000Z', reasoningExecutor: completeResearchExecutor(semanticCalls) }
    const workflowService = new WorkflowService()
    workflowService.register({ runId: input.workflowRunId, workflowType: 'company_research', objective: 'Company research 600519' })
    const result = await workflowService.start(input.workflowRunId, (signal) => runCompanyDeepResearch({ ...input, signal, observations: workflowService.observationReporter(input.workflowRunId) }))
    const observations = workflowService.getWorkflowStatus(input.workflowRunId)!
    assert.equal(observations.status, 'completed')
    assert.deepEqual(observations.stages.map((stage) => [stage.stageId, stage.status]), [
      ['data_acquisition', 'completed'], ['research_synthesis', 'completed'], ['quality_gate', 'completed'],
      ['knowledge_gateway', 'completed'], ['report_generation', 'completed'], ['report_persistence', 'completed'],
    ])
    assert.ok(observations.stages.every((stage) => (stage.durationMs ?? 0) >= 0))
    assert.ok(observations.providerObservations.some((item) => item.providerId === 'cninfo' && ['success', 'partial'].includes(item.status) && (item.recordCount ?? 0) >= 1))
    assert.ok(observations.providerObservations.some((item) => item.providerId === 'gdelt' && item.status === 'skipped'))
    assert.equal(result.status, 'completed', result.errors.join('; '))
    assert.deepEqual(semanticCalls.slice(0, -1).sort(), [...COMPANY_RESEARCH_METHOD_IDS].sort())
    assert.equal(semanticCalls.at(-1), 'company_research_synthesis')
    const unsupportedGdelt = result.providerOutcomes?.find((outcome) => outcome.provider === 'gdelt')
    assert.deepEqual(unsupportedGdelt && [unsupportedGdelt.providerAttempted, unsupportedGdelt.providerSucceeded, unsupportedGdelt.providerEmpty, unsupportedGdelt.providerFailed], [false, false, true, false])
    assert.ok(result.report?.outputPath)
    assert.ok(result.committedIds.length >= 1)
    assert.equal(signals.length, 1)
    const loaded = await readCanonicalV04Assets(root)
    assert.ok(loaded.objects.some((item) => item.value.id === 'entity:company-600519'))
    assert.ok(loaded.objects.some((item) => item.value.id.startsWith('source:research-')))
    const canonicalSource = loaded.objects.find((item) => item.value.id === result.sourceIds[0])?.value as { provider?: string; publisher?: string; metadata?: { dataProvenance?: Record<string, unknown> } } | undefined
    assert.ok(canonicalSource)
    assert.equal(canonicalSource.provider, 'cninfo')
    assert.equal(canonicalSource.publisher, 'CNINFO')
    assert.deepEqual(canonicalSource.metadata?.dataProvenance, {
      originAuthority: 'S0_STATUTORY', retrievalProvider: 'CNINFO', sourceUrl: 'https://example.com/filing',
      sourceIdentity: 'url:https://example.com/filing',
      publishedAt: '2026-09-07T00:00:00.000Z',
      dateStatus: 'QUALIFIED', pointInTimeSafe: true,
    })
    assert.equal(loaded.objects.filter((item) => item.value.id.startsWith('claim:research-')).length, 10)
    assert.equal(result.knowledgeBaseRevision, 2)
    assert.equal((loaded.objects.find((item) => item.value.id === 'entity:company-600519')?.value as { name?: string } | undefined)?.name, 'Fixture Company')
    assert.deepEqual(result.committedIds, [...result.createdIds, ...result.updatedIds])

    content = 'The company reported improved revenue and profit.'
    const replay = await runCompanyDeepResearch({ ...input, workflowRunId: 'company-run-2', handle: await new KnowledgeBaseRegistry().mount(root) })
    assert.equal(replay.status, 'completed')
    assert.equal(replay.knowledgeBaseRevision, 3)
    assert.deepEqual(replay.createdIds, [])
    assert.ok(replay.updatedIds.includes(result.sourceIds[0]))
    assert.deepEqual(replay.committedIds, [...replay.createdIds, ...replay.updatedIds])
    const replayLoaded = await readCanonicalV04Assets(root)
    assert.equal(replayLoaded.objects.filter((item) => item.value.id.startsWith('source:research-')).length, 1)
    assert.equal(replay.sourceIds[0], result.sourceIds[0])
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(reports, { recursive: true, force: true })
  }
})

test('Workflow table gate is applied after an otherwise passing semantic quality merge', () => {
  const structural = { passed: true, status: 'complete' as const, coreCoverage: { completed: 16, required: 16 }, issues: [], sectionChecks: [] }
  const semantic = { passed: true, status: 'passed' as const, issues: [], sectionChecks: [], diagnostics: [], attempts: 1 }
  const merged = mergeCompanySemanticQuality(structural, semantic)
  assert.equal(merged.passed, true, 'fixture represents a report that passed both content reviews')
  const gated = applyCompanyResearchTableDiagnostics(merged, ['industry-exposure: TABLE_ERROR: heading markup embedded in table header at line 2'])
  assert.equal(gated.passed, false)
  assert.equal(gated.status, 'incomplete')
  assert.ok(gated.issues.some(issue => issue.includes('REPORT_industry-exposure: TABLE_ERROR')))
})

test('repaired method table stays visible in diagnostics but does not fail the final report gate', () => {
  const malformedMethod = [{ id: 'industry-exposure', markdown: '| ## 行业标题 | 公司关系 |\n| --- | --- |\n| PCB | 背景 |' }]
  const finalReconciled = [{ id: 'industry-exposure', markdown: '行业范围说明。\n\n| 行业 | 公司关系 |\n| --- | --- |\n| PCB | 背景 |' }]
  const methodTableDiagnostics = validateCompanyResearchSectionTables(malformedMethod)
  const finalReportDiagnostics = validateCompanyResearchSectionTables(finalReconciled)
  assert.ok(methodTableDiagnostics.some(issue => issue.includes('heading markup embedded in table header')))
  assert.deepEqual(finalReportDiagnostics, [])
  const semanticPass = { passed: true, status: 'complete' as const, issues: [], coreCoverage: { completed: 16, required: 16 }, sectionChecks: [] }
  assert.equal(applyCompanyResearchTableDiagnostics(semanticPass, finalReportDiagnostics).passed, true)
  assert.ok(methodTableDiagnostics.length, 'the pre-reconciliation failure remains available for audit')
})

test('Verified identity permits first Company Research through DataResolver without canonical writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-company-first-research-'))
  const reports = await mkdtemp(join(tmpdir(), 'researchhub-company-first-research-reports-'))
  try {
    const asOf = '2026-09-08T00:00:00.000Z'
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-company-first-research', now: asOf })
    const seen: Array<{ symbol?: string; name?: string; exchange?: string }> = []
    const plugin: ResearchAcquisitionPlugin = {
      name: 'fixture-official',
      discover: async ({ company }) => {
        if (company) seen.push(company)
        return [{ candidateId: 'first-research-filing', kind: 'official_disclosure', tier: 1, title: 'Fixture filing', url: 'https://example.com/first-research-filing', provider: 'cninfo', publishedAt: '2026-09-07T00:00:00.000Z', metadata: { companySymbol: '600519' } }]
      },
      fetch: async (candidate) => ({ candidate, retrievedAt: asOf, content: 'The issuer disclosed its operating results for the period.', contentHash: 'e'.repeat(64) }),
      normalize: async (fetched) => ({ candidate: fetched.candidate, retrievedAt: fetched.retrievedAt, title: fetched.candidate.title, content: fetched.content, contentHash: fetched.contentHash!, canonicalUrl: fetched.candidate.url, publisher: 'CNINFO', rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false } }),
    }
    const securityIdentity: VerifiedSecurityIdentity = { symbol: '600519', exchange: 'SH', verifiedName: 'Fixture Company', verificationSource: 'akshare_security_directory', originAuthority: 'S3_AGGREGATOR', verifiedAt: asOf, sourceId: 'akshare-security-identity-directory', sourceUrl: 'https://github.com/akfamily/akshare' }
    const handle = await new KnowledgeBaseRegistry().mount(root)
    const before = await snapshotKnowledgeTree(root)
    const result = await runCompanyDeepResearch({ workflowRunId: 'company-first-research-readonly', handle, company: { symbol: '600519', name: 'Fixture Company', exchange: 'SH' }, securityIdentity, dataResolverFactory: resolverFactory([plugin]), reportRoot: reports, now: () => asOf, writeKnowledge: false, useStructuredKnowledge: false })
    assert.equal(result.status, 'completed', result.errors.join('; '))
    assert.deepEqual(seen, Array.from({ length: 2 }, () => ({ symbol: '600519', name: 'Fixture Company', exchange: 'SH' })), 'Profile fallback and evidence collection receive the same verified company')
    assert.ok(result.research?.sourceCandidateIds.includes('first-research-filing'))
    assert.ok(result.providerOutcomes?.some((outcome) => outcome.provider === 'cninfo' && outcome.providerAttempted && outcome.providerSucceeded))
    assert.equal(result.committedIds.length, 0)
    assert.ok(result.report)
    const report = JSON.parse(await readFile(join(reports, `${result.report!.reportId}.md.json`), 'utf8')) as { subjectRefs: string[]; sourceRefs: string[]; claimRefs: string[]; verifiedSecurityIdentity?: VerifiedSecurityIdentity; sections: readonly { sourceRefs?: readonly string[]; claimRefs?: readonly string[]; evidenceLinks?: readonly string[] }[] }
    assert.deepEqual(report.subjectRefs, [])
    assert.deepEqual(report.sourceRefs, [])
    assert.deepEqual(report.claimRefs, [])
    assert.equal(report.verifiedSecurityIdentity?.symbol, '600519')
    assert.ok(report.sections.some((section) => section.evidenceLinks?.includes('https://example.com/first-research-filing')))
    const detailedReport = JSON.parse(await readFile(join(reports, `${result.report!.reportId}.md.json`), 'utf8'))
    assert.equal(detailedReport.researchQuality.passed, true)
    assert.equal(detailedReport.methodExecutions.length, 10)
    assert.ok(detailedReport.sections.filter((section: any) => !['valuation', 'bull-base-bear', 'variant-perception'].includes(section.id)).every((section: any) => section.evidenceLocations.length > 0))
    const assets = await readCanonicalV04Assets(root)
    assert.equal(assets.objects.filter((item) => item.kind === 'entity' || item.kind === 'source' || item.kind === 'claim').length, 0)
    assert.deepEqual(await snapshotKnowledgeTree(root), before)
    const noWriteBefore = await snapshotKnowledgeTree(root)
    const writeRequested = await runCompanyDeepResearch({ workflowRunId: 'company-first-research-write-request', handle: await new KnowledgeBaseRegistry().mount(root), company: { symbol: '600519', name: 'Fixture Company', exchange: 'SH' }, securityIdentity, dataResolverFactory: resolverFactory([plugin]), reportRoot: reports, now: () => asOf, writeKnowledge: true, useStructuredKnowledge: false })
    assert.equal(writeRequested.status, 'completed', writeRequested.errors.join('; '))
    assert.ok(writeRequested.sourceIds.length > 0)
    assert.ok(writeRequested.claimIds.length > 0)
    assert.ok(writeRequested.committedIds.length > 0)
    assert.notDeepEqual(await snapshotKnowledgeTree(root), noWriteBefore)
    const writtenReport = JSON.parse(await readFile(join(reports, `${writeRequested.report!.reportId}.md.json`), 'utf8'))
    const reloaded = await readCanonicalV04Assets(root)
    assert.equal(writtenReport.subjectRefs.length, 1)
    assert.ok(reloaded.objects.some(object => object.value.id === writtenReport.subjectRefs[0] && object.kind === 'entity'))
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(reports, { recursive: true, force: true })
  }
})

test('read-only structured Company observations retain external source links without canonical refs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-company-readonly-links-'))
  const reports = await mkdtemp(join(tmpdir(), 'researchhub-company-readonly-links-reports-'))
  try {
    const asOf = '2026-09-08T00:00:00.000Z'
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-company-readonly-links', now: asOf })
    const akshare: AkshareDataClient = {
      companyBasic: async () => [{ item: 'name', value: 'Fixture Company' }],
      financialData: async () => [{ report_date: '2025-12-31', publication_date: '2026-03-01', operating_revenue: 100, net_profit: 10 }],
      historicalMarketData: async () => [{ date: '2026-09-07', close: 20 }],
    }
    const identity: VerifiedSecurityIdentity = { symbol: '600519', exchange: 'SH', verifiedName: 'Fixture Company', verificationSource: 'akshare_security_directory', originAuthority: 'S3_AGGREGATOR', verifiedAt: asOf, sourceId: 'akshare-security-identity-directory', sourceUrl: 'https://github.com/akfamily/akshare' }
    const before = await snapshotKnowledgeTree(root)
    const result = await runCompanyDeepResearch({ workflowRunId: 'company-readonly-links', handle: await new Registry().mount(root), company: { symbol: '600519', name: 'Fixture Company', exchange: 'SH' }, securityIdentity: identity, dataResolverFactory: resolverFactory([], akshare), reportRoot: reports, now: () => asOf, writeKnowledge: false, useStructuredKnowledge: false })
    assert.ok(result.report)
    const report = JSON.parse(await readFile(join(reports, `${result.report!.reportId}.md.json`), 'utf8')) as { sourceRefs: string[]; claimRefs: string[]; sections: readonly { id: string; evidenceLinks?: readonly string[] }[] }
    assert.deepEqual(report.sourceRefs, [])
    assert.deepEqual(report.claimRefs, [])
    assert.ok(report.sections.find((section) => section.id === 'company-overview')?.evidenceLinks?.includes('https://quote.eastmoney.com/sh600519.html'))
    assert.ok(report.sections.find((section) => section.id === 'revenue-profit-drivers')?.evidenceLinks?.includes('https://quote.eastmoney.com/sh600519.html'))
    assert.ok(report.sections.find((section) => section.id === 'financial-quality')?.evidenceLinks?.includes('https://quote.eastmoney.com/sh600519.html'))
    assert.deepEqual(report.sections.find((section) => section.id === 'valuation')?.evidenceLinks, [])
    assert.deepEqual(await snapshotKnowledgeTree(root), before)
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(reports, { recursive: true, force: true })
  }
})

test('Company Research without acquired evidence persists an explicit blocked gap report instead of generic completion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-company-no-evidence-'))
  const reports = await mkdtemp(join(tmpdir(), 'researchhub-company-no-evidence-reports-'))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-company-no-evidence', now: '2026-09-08T00:00:00.000Z' })
    const before = await snapshotKnowledgeTree(root)
    const identity: VerifiedSecurityIdentity = { symbol: '600519', exchange: 'SH', verifiedName: 'Fixture Company', verificationSource: 'akshare_security_directory', originAuthority: 'S3_AGGREGATOR', verifiedAt: '2026-09-08T00:00:00.000Z', sourceId: 'akshare-security-identity-directory', sourceUrl: 'https://github.com/akfamily/akshare' }
    const result = await runCompanyDeepResearch({ workflowRunId: 'company-no-evidence', handle: await new KnowledgeBaseRegistry().mount(root), company: { symbol: '600519', name: 'Fixture Company', exchange: 'SH' }, securityIdentity: identity, dataResolverFactory: resolverFactory([]), reportRoot: reports, now: () => '2026-09-08T00:00:00.000Z', writeKnowledge: false })
    assert.equal(result.status, 'blocked')
    assert.ok(result.report)
    assert.ok(result.errors.includes('NO_COMPANY_RESEARCH_EVIDENCE'))
    const report = JSON.parse(await readFile(join(reports, `${result.report!.reportId}.md.json`), 'utf8')) as { sourceRefs: string[]; claimRefs: string[]; sections: readonly { title: string; markdown: string; evidenceLinks?: readonly string[] }[] }
    assert.deepEqual(report.sourceRefs, [])
    assert.deepEqual(report.claimRefs, [])
    assert.deepEqual(report.sections.find((section) => section.title === 'Company Overview')?.evidenceLinks, [], 'Identity directory is not business-research evidence')
    assert.ok(report.sections.find((section) => section.title === 'Business Model')?.markdown.startsWith('研究缺口：'))
    assert.deepEqual(await snapshotKnowledgeTree(root), before)
  } finally { await rm(root, { recursive: true, force: true }); await rm(reports, { recursive: true, force: true }) }
})

test('unverified first Company Research cannot bypass identity governance with Knowledge writes enabled', async () => {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-company-unverified-write-'))
  const reports = await mkdtemp(join(tmpdir(), 'researchhub-company-unverified-write-reports-'))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-company-unverified-write', now: '2026-09-08T00:00:00.000Z' })
    const before = await snapshotKnowledgeTree(root)
    const result = await runCompanyDeepResearch({ workflowRunId: 'company-unverified-write', handle: await new KnowledgeBaseRegistry().mount(root), company: { symbol: '600519', name: 'Unverified Company', exchange: 'SH' }, dataResolverFactory: resolverFactory([]), reportRoot: reports, now: () => '2026-09-08T00:00:00.000Z', writeKnowledge: true })
    assert.equal(result.status, 'blocked')
    assert.deepEqual(result.errors, ['COMPANY_IDENTITY_UNVERIFIED'])
    assert.equal(result.report, undefined)
    assert.deepEqual(await snapshotKnowledgeTree(root), before)
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(reports, { recursive: true, force: true })
  }
})

test('ResearchService verifies an external identity and starts first Company Research without creating a Company', async () => {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-company-service-first-research-'))
  const reports = await mkdtemp(join(tmpdir(), 'researchhub-company-service-first-research-reports-'))
  try {
    const asOf = '2026-09-08T00:00:00.000Z'
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-company-service-first-research', now: asOf })
    const directoryCalls: unknown[] = []
    const directory = { async securityDirectory(request: unknown) { directoryCalls.push(request); return [{ symbol: '600519', name: 'Fixture Company', exchange: 'SH' }] } } as unknown as AkshareSecurityDirectoryClient
    const securityIdentityResolver = new SecurityIdentityResolver({ mountedKnowledgeBaseRoot: root, now: () => new Date(asOf), dataResolverFactory: ({ now, signal }) => createSecurityIdentityDataResolver({ akshare: directory, now, ...(signal ? { signal } : {}) }) })
    const seen: Array<{ symbol?: string; name?: string; exchange?: string }> = []
    const providerCalls: string[] = []
    const plugin: ResearchAcquisitionPlugin = {
      name: 'fixture-official',
      discover: async ({ company }) => {
        providerCalls.push('discover')
        if (company) seen.push(company)
        return [{ candidateId: 'service-first-research-filing', kind: 'official_disclosure', tier: 1, title: 'Fixture filing', url: 'https://example.com/service-first-research-filing', provider: 'cninfo', publishedAt: '2026-09-07T00:00:00.000Z', metadata: { companySymbol: '600519' } }]
      },
      fetch: async (candidate) => { providerCalls.push('fetch'); return { candidate, retrievedAt: asOf, content: 'The issuer disclosed its operating results for the period.', contentHash: 'f'.repeat(64) } },
      normalize: async (fetched) => ({ candidate: fetched.candidate, retrievedAt: fetched.retrievedAt, title: fetched.candidate.title, content: fetched.content, contentHash: fetched.contentHash!, canonicalUrl: fetched.candidate.url, publisher: 'CNINFO', rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false } }),
    }
    const service = new ResearchService({ mountedKnowledgeBaseRoot: root, reportRoot: reports, acquisitionPlugins: [plugin], researchEvidenceProviders: { cninfo: plugin }, workflowService: new WorkflowService(), securityIdentityResolver, reasoningExecutor: completeResearchExecutor(), companyDataResolverFactory: fixtureCompanyDataResolverFactory(plugin), akshare: { companyBasic: async () => [], financialData: async () => [], historicalMarketData: async () => [] } })
    const result = await service.startResearchCompany({ workflowRunId: 'company-service-first-research-readonly', symbol: '600519', name: 'Fixture Company', exchange: 'SH', writeKnowledge: false, useStructuredKnowledge: false }).completion
    assert.equal(result.status, 'completed', result.errorSummary)
    assert.equal(directoryCalls.length, 1)
    assert.deepEqual(seen, Array.from({ length: 2 }, () => ({ symbol: '600519', name: 'Fixture Company', exchange: 'SH' })), 'Profile fallback and evidence collection receive the same verified company')
    assert.deepEqual(providerCalls.sort(), ['discover', 'discover', 'fetch', 'fetch'])
    assert.equal(result.committedIds.length, 0)
    assert.ok(result.providerOutcomes?.some((outcome) => isRecord(outcome) && outcome.provider === 'cninfo' && outcome.providerSucceeded === true && outcome.usableSourceCount === 1))
    assert.ok(result.reportId)
    const report = await service.getResearchReport(result.reportId!)
    assert.deepEqual(report.subjectRefs, [])
    assert.equal(report.verifiedSecurityIdentity?.sourceId, 'akshare-security-identity-directory')
    const assets = await readCanonicalV04Assets(root)
    assert.equal(assets.objects.filter((item) => item.kind === 'entity' || item.kind === 'source' || item.kind === 'claim').length, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(reports, { recursive: true, force: true })
  }
})

test('Company Deep Research binds two companies deterministically and is stable on a third run', async () => {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-company-multi-'))
  const reports = await mkdtemp(join(tmpdir(), 'researchhub-company-multi-reports-'))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-company-multi-test', now: '2026-09-08T00:00:00.000Z' })
    await seedCanonicalCompany(root, '600519', 'Company A')
    await seedCanonicalCompany(root, '000858', 'Company B')
    const plugin: ResearchAcquisitionPlugin = {
      name: 'fixture-official',
      discover: async (request) => { if (!request.company) return []; return [{ candidateId: `official-${request.company.symbol}`, kind: 'official_disclosure', tier: 1, title: `${request.company.symbol} filing`, url: `https://example.com/${request.company.symbol}`, provider: 'cninfo', publishedAt: '2026-09-07T00:00:00.000Z', metadata: { companySymbol: request.company.symbol } }] },
      fetch: async (candidate) => ({ candidate, retrievedAt: '2026-09-08T00:00:00.000Z', content: `${candidate.candidateId} reported stable revenue.`, contentHash: candidate.candidateId.includes('600519') ? 'c'.repeat(64) : 'd'.repeat(64) }),
      normalize: async (fetched) => ({ candidate: fetched.candidate, retrievedAt: fetched.retrievedAt, title: fetched.candidate.title, content: fetched.content, contentHash: fetched.contentHash!, canonicalUrl: fetched.candidate.url, publisher: fetched.candidate.provider, rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false } }),
    }
    const first = await runCompanyDeepResearch({ workflowRunId: 'multi-600519-1', handle: await new Registry().mount(root), company: { symbol: '600519', name: 'Company A' }, dataResolverFactory: resolverFactory([plugin]), reportRoot: reports, now: () => '2026-09-08T00:00:00.000Z' })
    const second = await runCompanyDeepResearch({ workflowRunId: 'multi-000858-1', handle: await new Registry().mount(root), company: { symbol: '000858', name: 'Company B' }, dataResolverFactory: resolverFactory([plugin]), reportRoot: reports, now: () => '2026-09-08T00:00:00.000Z' })
    const third = await runCompanyDeepResearch({ workflowRunId: 'multi-600519-2', handle: await new Registry().mount(root), company: { symbol: '600519', name: 'Company A' }, dataResolverFactory: resolverFactory([plugin]), reportRoot: reports, now: () => '2026-09-08T00:00:00.000Z' })
    assert.equal(first.status, 'completed', first.errors.join('; '))
    assert.equal(second.status, 'completed', second.errors.join('; '))
    assert.equal(third.status, 'completed', third.errors.join('; '))
    assert.equal(first.knowledgeBaseRevision, 3)
    assert.equal(second.knowledgeBaseRevision, 4)
    assert.equal(third.knowledgeBaseRevision, 4)
    const loaded = await readCanonicalV04Assets(root)
    assert.equal(loaded.objects.filter((item) => item.value.id.startsWith('entity:')).length, 2)
    assert.equal(loaded.objects.filter((item) => item.value.id.startsWith('source:')).length, 2)
    assert.equal(loaded.objects.filter((item) => item.value.id.startsWith('claim:')).length, 20)
    assert.ok(loaded.objects.every((item) => !item.value.id.includes('proposal-')))
    assert.ok(third.resolutionIntents?.some((item) => item.disposition === 'bound_existing'))
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(reports, { recursive: true, force: true })
  }
})

test('Schema 0.4 shared Writer rejects a forged receipt without Validator runtime identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-writer-token-'))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-writer-token-test', now: '2026-09-08T00:00:00.000Z' })
    const handle = await new Registry().mount(root)
    const forged = { changeSet: { changeSetId: 'forged', workflowRunId: 'forged-run', knowledgeBaseId: handle.knowledgeBaseId, schemaVersion: '0.4', storageFormatVersion: '1', expectedBaseRevision: 0, operations: [] }, knowledgeBaseId: handle.knowledgeBaseId, schemaVersion: '0.4', baseRevision: 0, changeSetId: 'forged', changeSetHash: '0'.repeat(64) }
    const result = await writeKnowledgeBase(handle, forged as never, { registry: new Registry(), clock: () => '2026-09-08T00:00:00.000Z' })
    assert.equal(result.status, 'rejected')
    assert.equal(result.error?.code, 'validation_required')
    const imitation = Object.create(Object.getPrototypeOf(forged)) as unknown
    Object.assign(imitation as object, forged)
    const imitationResult = await writeKnowledgeBase(handle, imitation as never, { registry: new Registry(), clock: () => '2026-09-08T00:00:00.000Z' })
    assert.equal(imitationResult.error?.code, 'validation_required')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Company resolves neutral structured data and keeps signal append between discovery and fetch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-company-data-'))
  const reports = await mkdtemp(join(tmpdir(), 'researchhub-company-data-reports-'))
  try {
    const asOf = '2026-09-08T00:00:00.000Z'
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-company-data-test', now: asOf })
    await seedCanonicalCompany(root, '600519', 'Fixture Company', asOf)
    const signals: ResearchSignal[] = []
    const signalStore: ResearchSignalStore = { append: async (signal) => { signals.push(signal) }, listForCompany: async () => signals }
    const akshare: AkshareDataClient = {
      companyBasic: async () => [{ item: 'name', value: 'Fixture Company' }],
      financialData: async () => [{ report_date: '2026-06-30', publication_date: '2026-08-01', metric: 0 }],
      historicalMarketData: async () => [{ date: '2026-09-08', close: 0 }],
    }
    const fetched: string[] = []
    const makePlugin = (name: string, provider: string, candidate: ResearchSourceCandidate): ResearchAcquisitionPlugin => ({
      name,
      discover: async () => [candidate],
      fetch: async (source) => {
        assert.equal(signals.some((signal) => signal.signalId === `signal-${source.candidateId}`), true, 'signal append must finish before fetch starts')
        fetched.push(source.candidateId)
        if (provider === 'gdelt' && source.candidateId === 'news-unknown-date') throw new Error('fixture GDELT fetch failure')
        return { candidate: source, retrievedAt: asOf, content: 'Official company filing.', contentHash: provider === 'gdelt' ? 'c'.repeat(64) : 'a'.repeat(64) }
      },
      normalize: async (source) => ({ candidate: source.candidate, retrievedAt: source.retrievedAt, title: source.candidate.title, content: source.content, contentHash: source.contentHash!, canonicalUrl: source.candidate.url, publisher: provider, rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false } }),
    })
    const officialCandidate: ResearchSourceCandidate = { candidateId: 'official-unknown-date', kind: 'official_disclosure', tier: 1, title: 'Official filing', url: 'https://example.com/filing', provider: 'cninfo' }
    const futureCandidate: ResearchSourceCandidate = { candidateId: 'news-future', kind: 'news', tier: 3, title: 'Future news', url: 'https://example.com/future', provider: 'gdelt', publishedAt: '2026-09-09T00:00:00.000Z' }
    const qualifiedCandidate: ResearchSourceCandidate = { candidateId: 'news-qualified', kind: 'news', tier: 3, title: 'Dated news', url: 'https://example.com/dated', provider: 'gdelt', publishedAt: '2026-09-07T00:00:00.000Z' }
    const official = makePlugin('fixture-official', 'cninfo', officialCandidate)
    const news: ResearchAcquisitionPlugin = {
      ...makePlugin('fixture-gdelt', 'gdelt', futureCandidate),
      discover: async () => [futureCandidate, { ...futureCandidate, candidateId: 'news-unknown-date', url: 'https://example.com/unknown', publishedAt: undefined }, qualifiedCandidate],
    }
    const result = await runCompanyDeepResearch({ workflowRunId: 'company-data-run', handle: await new Registry().mount(root), company: { symbol: '600519', name: 'Fixture Company' }, dataResolverFactory: resolverFactory([official, news], akshare), signalStore, reportRoot: reports, now: () => asOf })
    assert.match(result.research?.sections.find((section) => section.id === 'valuation')?.markdown ?? '', /研究缺口/)
    assert.deepEqual(fetched.sort(), ['news-qualified', 'news-unknown-date', 'official-unknown-date'])
    assert.ok(result.research?.contextOnlySourceCandidateIds?.includes('official-unknown-date'), 'unknown-date evidence remains visible as non-PIT-safe context')
    assert.equal(result.research?.sourceCandidateIds.includes('news-future'), false, 'future evidence must not reach the Skill')
    assert.ok(result.research?.sourceCandidateIds.includes('news-qualified'))
    assert.ok(result.research?.contextOnlySourceCandidateIds?.includes('official-unknown-date'))
    assert.equal(result.research?.sourceCandidateIds.includes('official-unknown-date'), false, 'unknown-date evidence is available as context but cannot be cited durably')
    assert.ok(result.research?.sections.every((section) => !section.sourceCandidateIds.includes('official-unknown-date')))
    assert.ok(result.research?.sections.every((section) => !section.markdown.includes('[official-unknown-date@')))
    assert.equal(signals.length, 3, 'signal compatibility projection retains the existing as-of, dedup, and cap rules before fetch')
    assert.equal(signals.some((signal) => signal.signalId === 'signal-news-future'), false)
    assert.ok(result.providerOutcomes?.some((outcome) => outcome.provider === 'gdelt' && outcome.providerSucceeded && outcome.providerFailed))
    assert.equal(result.providerOutcomes?.find((outcome) => outcome.provider === 'gdelt')?.providerEmpty, false)
    const akshareOutcome = result.providerOutcomes?.find((outcome) => outcome.provider === 'akshare')
    assert.deepEqual(akshareOutcome && [akshareOutcome.providerSucceeded, akshareOutcome.providerEmpty, akshareOutcome.providerFailed], [true, false, false])
    assert.ok(result.providerOutcomes?.some((outcome) => outcome.provider === 'akshare' && outcome.providerSucceeded))
    assert.ok(result.acquisitionDiagnostics?.some((diagnostic) => diagnostic.provider === 'gdelt' && diagnostic.status === 'failed'))
    assert.equal(result.qualityGate?.eligibleForGateway, true)
    const canonical = await readCanonicalV04Assets(root)
    const structuredProvenance = canonical.objects.filter((item) => item.kind === 'source').map((item) => (item.value as any).metadata?.dataProvenance).filter((record) => record?.metricId)
    assert.deepEqual(structuredProvenance.map((record) => record.metricId).sort(), ['company_basic_profile', 'company_financial_history', 'company_market_history'])
    assert.ok(structuredProvenance.every((record) => record.sourceId && record.originAuthority && record.retrievalProvider === 'AKShare' && record.attempts.length > 0 && record.quality))
    assert.ok(structuredProvenance.every((record) => record.pointInTimeStatus === 'CURRENT_VALUE_ONLY' && record.qualityStatus === 'CURRENT_VALUE_ONLY' && record.valueVersionStatus === 'UNVERIFIED' && record.valueVersion?.status === 'UNVERIFIED'))
    assert.equal(canonical.objects.some((item) => item.kind === 'source' && 'title' in item.value && item.value.title === 'Official filing'), false, 'unknown-date source must not be written to Knowledge Gateway')
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(reports, { recursive: true, force: true })
  }
})

test('Company maxSources is a global cap when both or only one evidence provider returns candidates', async () => {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-company-cap-'))
  const reports = await mkdtemp(join(tmpdir(), 'researchhub-company-cap-reports-'))
  try {
    const asOf = '2026-09-08T00:00:00.000Z'
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-company-cap-test', now: asOf })
    await seedCanonicalCompany(root, '600519', 'Fixture Company', asOf)
    await seedCanonicalCompany(root, '000858', 'Fixture Company B', asOf)
    const plugin = (name: string, provider: string, ids: readonly string[]): ResearchAcquisitionPlugin => ({
      name,
      discover: async () => ids.map((candidateId) => ({ candidateId, kind: provider === 'cninfo' ? 'official_disclosure' as const : 'news' as const, tier: provider === 'cninfo' ? 1 as const : 3 as const, title: candidateId, url: `https://example.com/${candidateId}`, provider, publishedAt: '2026-09-07T00:00:00.000Z' })),
      fetch: async (candidate) => ({ candidate, retrievedAt: asOf, content: `Evidence ${candidate.candidateId}`, contentHash: candidate.candidateId.padEnd(64, '0') }),
      normalize: async (source) => ({ candidate: source.candidate, retrievedAt: source.retrievedAt, title: source.candidate.title, content: source.content, contentHash: source.contentHash!, canonicalUrl: source.candidate.url, publisher: provider, rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false } }),
    })
    const official = plugin('fixture-official', 'cninfo', ['official-a', 'official-b'])
    const news = plugin('fixture-gdelt', 'gdelt', ['news-a', 'news-b'])
    const partialAkshare: AkshareDataClient = { companyBasic: async () => [{ item: 'name', value: 'Fixture Company' }], financialData: async () => [], historicalMarketData: async () => [{ date: '2026-09-08', close: 1 }] }
    const both = await runCompanyDeepResearch({ workflowRunId: 'company-cap-both', handle: await new Registry().mount(root), company: { symbol: '600519', name: 'Fixture Company' }, dataResolverFactory: resolverFactory([official, news], partialAkshare), reportRoot: reports, maxSources: 1, asOf, now: () => asOf })
    assert.equal(both.research?.sourceCandidateIds.filter((id) => !id.startsWith('akshare-')).length, 1)
    assert.ok(both.providerOutcomes?.some((outcome) => outcome.provider === 'akshare' && outcome.providerSucceeded && !outcome.providerEmpty))

    const single = await runCompanyDeepResearch({ workflowRunId: 'company-cap-single', handle: await new Registry().mount(root), company: { symbol: '000858', name: 'Fixture Company B' }, dataResolverFactory: resolverFactory([official, { ...news, discover: async () => [] }]), reportRoot: reports, maxSources: 1, asOf, now: () => asOf })
    assert.equal(single.research?.sourceCandidateIds.filter((id) => !id.startsWith('akshare-')).length, 1)
    assert.ok(single.providerOutcomes?.some((outcome) => outcome.provider === 'cninfo' && outcome.providerSucceeded && !outcome.providerEmpty))
    assert.ok(single.providerOutcomes?.some((outcome) => outcome.provider === 'gdelt' && !outcome.providerSucceeded && outcome.providerEmpty))
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(reports, { recursive: true, force: true })
  }
})

test('historical unversioned profile and financial snapshots stay context-only and never bind through Gateway', async () => {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-company-historical-data-'))
  const reports = await mkdtemp(join(tmpdir(), 'researchhub-company-historical-data-reports-'))
  try {
    const asOf = '2026-10-08T07:01:00.000Z'
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-company-historical-data-test', now: asOf })
    await seedCanonicalCompany(root, '600519', 'Fixture Company', asOf)
    const akshare: AkshareDataClient = {
      companyBasic: async () => [{ item: 'employees', value: 0 }],
      financialData: async () => [{ report_date: '2025-12-31', publication_date: '2026-03-01', basic_eps: 0 }],
      historicalMarketData: async () => [{ date: '2026-10-07', close: 7 }, { date: '2026-10-08', close: 8 }],
    }
    const filing: ResearchAcquisitionPlugin = {
      name: 'fixture-official',
      discover: async () => [{ candidateId: 'dated-filing', kind: 'official_disclosure', tier: 1, title: 'Dated filing', url: 'https://example.com/dated-filing', provider: 'cninfo', publishedAt: '2026-10-07T12:00:00.000Z' }],
      fetch: async (candidate) => ({ candidate, retrievedAt: asOf, content: 'A verified filing.', contentHash: 'a'.repeat(64) }),
      normalize: async (fetched) => ({ candidate: fetched.candidate, retrievedAt: fetched.retrievedAt, title: fetched.candidate.title, content: fetched.content, contentHash: fetched.contentHash!, canonicalUrl: fetched.candidate.url, publisher: 'CNINFO', rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false } }),
    }
    const reasoningExecutor = completeResearchExecutor()
    const result = await runCompanyDeepResearch({ workflowRunId: 'company-historical-data', handle: await new Registry().mount(root), company: { symbol: '600519', name: 'Fixture Company' }, dataResolverFactory: resolverFactory([filing], akshare), reportRoot: reports, asOf, now: () => asOf, reasoningExecutor })
    assert.equal(result.status, 'completed', result.errors.join('; '))
    assert.ok(result.research?.contextOnlySourceCandidateIds?.includes('akshare-basic-600519'))
    assert.ok(result.research?.contextOnlySourceCandidateIds?.includes('akshare-financial-600519'))
    assert.ok(result.research?.sourceCandidateIds.includes('akshare-market-600519'))
    assert.ok(result.research?.sourceCandidateIds.includes('dated-filing'))
    const canonical = await readCanonicalV04Assets(root)
    const sourceTitles = canonical.objects.filter((item) => item.kind === 'source').map((item) => (item.value as { title?: string }).title)
    assert.equal(sourceTitles.includes('Company basic profile'), false)
    assert.equal(sourceTitles.includes('Company financial history'), false)
    assert.equal(sourceTitles.includes('Company market history'), true)
    assert.equal(canonical.objects.some((item) => item.kind === 'claim' && 'statement' in item.value && item.value.statement === 'An unversioned historical EPS claim.'), false, 'a mixed-source proposal citing unversioned financial data must be rejected before Gateway')
    const market = canonical.objects.find((item) => item.kind === 'source' && (item.value as { title?: string }).title === 'Company market history')?.value as { metadata?: { dataProvenance?: Record<string, unknown> } } | undefined
    assert.equal(market?.metadata?.dataProvenance?.pointInTimeStatus, 'PIT_VERIFIED')
    assert.equal(market?.metadata?.dataProvenance?.valueVersionStatus, 'UNVERIFIED')
    assert.equal(market?.metadata?.dataProvenance?.retrievalProvider, 'AKShare')
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(reports, { recursive: true, force: true })
  }
})

test('Company provider outcome flags never combine empty with failure and unsupported remains empty', async () => {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-company-outcome-flags-'))
  const reports = await mkdtemp(join(tmpdir(), 'researchhub-company-outcome-flags-reports-'))
  try {
    const asOf = '2026-10-08T12:00:00.000Z'
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-company-outcome-flags-test', now: asOf })
    await seedCanonicalCompany(root, '600519', 'Fixture Company', asOf)
    const official: ResearchAcquisitionPlugin = { name: 'fixture-official', discover: async () => [], fetch: async (candidate) => ({ candidate, retrievedAt: asOf, content: '' }), normalize: async () => { throw new Error('must not normalize') } }
    const gdelt: ResearchAcquisitionPlugin = { name: 'fixture-gdelt', discover: async () => { throw new Error('fixture discovery failure') }, fetch: async (candidate) => ({ candidate, retrievedAt: asOf, content: '' }), normalize: async () => { throw new Error('must not normalize') } }
    const result = await runCompanyDeepResearch({ workflowRunId: 'company-outcome-flags', handle: await new Registry().mount(root), company: { symbol: '600519', name: 'Fixture Company' }, dataResolverFactory: resolverFactory([official, gdelt]), reportRoot: reports, asOf, now: () => asOf })
    const outcomes = result.providerOutcomes ?? []
    const cninfo = outcomes.find((outcome) => outcome.provider === 'cninfo')
    const news = outcomes.find((outcome) => outcome.provider === 'gdelt')
    assert.deepEqual(cninfo && [cninfo.providerSucceeded, cninfo.providerEmpty, cninfo.providerFailed], [false, true, false])
    assert.deepEqual(news && [news.providerSucceeded, news.providerEmpty, news.providerFailed], [false, false, true])
    assert.ok(outcomes.every((outcome) => !(outcome.providerEmpty && outcome.providerFailed)))
    assert.ok(outcomes.every((outcome) => outcome.providerSucceeded === (outcome.usableSourceCount > 0)))
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(reports, { recursive: true, force: true })
  }
})

test('POINT_IN_TIME_INVALID Company market attempt is empty rather than a provider failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-company-market-cutoff-'))
  const reports = await mkdtemp(join(tmpdir(), 'researchhub-company-market-cutoff-reports-'))
  try {
    const asOf = '2026-10-08T06:00:00.000Z'
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-company-market-cutoff-test', now: asOf })
    await seedCanonicalCompany(root, '600519', 'Fixture Company', asOf)
    const dataResolverFactory = () => new DataResolver<CompanyResearchDataPayload>({
      policies: [], executor: async () => ({ status: 'UNSUPPORTED' }),
      resolveAcquisition: async (requirement): Promise<AcquisitionResult<CompanyResearchDataPayload>> => ({
        requirementId: requirement.id, status: 'UNAVAILABLE', source: null,
        quality: { pointInTimeSafe: false, complete: false, crossChecked: false, pitDiagnostic: 'NO_ELIGIBLE_POINT_IN_TIME_DATA' },
        attempts: requirement.metricId === 'company_market_history' ? [{ sourceId: 'akshare-marketHistory', fallbackLevel: 'PRIMARY', status: 'POINT_IN_TIME_INVALID', startedAt: asOf, completedAt: asOf, diagnostic: 'daily close was after analysisAsOf' }] : [],
        unavailableReason: requirement.metricId === 'company_market_history' ? 'NO_ELIGIBLE_POINT_IN_TIME_DATA' : 'SOURCE_UNAVAILABLE',
      }),
    })
    const result = await runCompanyDeepResearch({ workflowRunId: 'company-market-cutoff', handle: await new Registry().mount(root), company: { symbol: '600519', name: 'Fixture Company' }, dataResolverFactory, reportRoot: reports, asOf, now: () => asOf })
    const market = result.providerOutcomes?.find((outcome) => outcome.provider === 'akshare')
    assert.deepEqual(market && [market.providerAttempted, market.providerSucceeded, market.providerEmpty, market.providerFailed, market.usableSourceCount], [true, false, true, false, 0])
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(reports, { recursive: true, force: true })
  }
})

test('UNSUPPORTED Company market operation is skipped and does not report provider failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-company-unsupported-market-'))
  const reports = await mkdtemp(join(tmpdir(), 'researchhub-company-unsupported-market-reports-'))
  try {
    const asOf = '2026-10-08T06:00:00.000Z'
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-company-unsupported-market-test', now: asOf })
    await seedCanonicalCompany(root, '600519', 'Fixture Company', asOf)
    const dataResolverFactory = () => new DataResolver<CompanyResearchDataPayload>({
      policies: [], executor: async () => ({ status: 'UNSUPPORTED' }),
      resolveAcquisition: async (requirement): Promise<AcquisitionResult<CompanyResearchDataPayload>> => ({
        requirementId: requirement.id, status: 'UNAVAILABLE', source: null,
        quality: { pointInTimeSafe: false, complete: false, crossChecked: false, pitDiagnostic: 'SOURCE_UNAVAILABLE' },
        attempts: requirement.metricId === 'company_market_history' ? [{ sourceId: 'akshare-marketHistory', fallbackLevel: 'PRIMARY', status: 'UNSUPPORTED', startedAt: asOf, completedAt: asOf, diagnostic: 'AKShare client is unavailable' }] : [],
        unavailableReason: 'SOURCE_UNAVAILABLE',
      }),
    })
    const workflowService = new WorkflowService()
    workflowService.register({ runId: 'company-unsupported-market', workflowType: 'company_research', objective: 'Company research 600519' })
    const result = await workflowService.start('company-unsupported-market', async (signal) => runCompanyDeepResearch({ workflowRunId: 'company-unsupported-market', handle: await new Registry().mount(root), company: { symbol: '600519', name: 'Fixture Company' }, dataResolverFactory, reportRoot: reports, asOf, now: () => asOf, signal, observations: workflowService.observationReporter('company-unsupported-market') }))
    const akshare = workflowService.getWorkflowStatus('company-unsupported-market')?.providerObservations.find((item) => item.providerId === 'akshare')
    assert.deepEqual(akshare && [akshare.status, akshare.diagnostics.includes('PROVIDER_UNSUPPORTED'), akshare.diagnostics.includes('PROVIDER_ATTEMPT_FAILED')], ['skipped', true, false])
    const outcome = result.providerOutcomes?.find((item) => item.provider === 'akshare')
    assert.deepEqual(outcome && [outcome.providerAttempted, outcome.providerSucceeded, outcome.providerEmpty, outcome.providerFailed], [false, false, true, false])
    assert.ok(result.acquisitionDiagnostics?.some((item) => item.provider === 'akshare' && item.status === 'unsupported'))
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(reports, { recursive: true, force: true })
  }
})

test('Company dedup never promotes an unknown-date duplicate candidate to a durable source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-company-duplicate-pit-'))
  const reports = await mkdtemp(join(tmpdir(), 'researchhub-company-duplicate-pit-reports-'))
  try {
    const asOf = '2026-09-08T00:00:00.000Z'
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-company-duplicate-pit-test', now: asOf })
    await seedCanonicalCompany(root, '600519', 'Fixture Company', asOf)
    const plugin = (name: string, provider: string, publishedAt: string | undefined, url: string): ResearchAcquisitionPlugin => ({
      name,
      discover: async () => [{ candidateId: 'shared-candidate', kind: provider === 'cninfo' ? 'official_disclosure' : 'news', tier: provider === 'cninfo' ? 1 : 3, title: provider === 'cninfo' ? 'Dated filing' : 'Unknown-date duplicate', url, provider, ...(publishedAt ? { publishedAt } : {}) }],
      fetch: async (candidate) => ({ candidate, retrievedAt: asOf, content: `${provider} unique content`, contentHash: provider === 'cninfo' ? '1'.repeat(64) : '2'.repeat(64) }),
      normalize: async (source) => ({ candidate: source.candidate, retrievedAt: source.retrievedAt, title: source.candidate.title, content: source.content, contentHash: source.contentHash!, canonicalUrl: source.candidate.url, publisher: provider, rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false } }),
    })
    const dated = plugin('fixture-official', 'cninfo', '2026-09-07T00:00:00.000Z', 'https://example.com/dated-shared')
    const unknown = plugin('fixture-gdelt', 'gdelt', undefined, 'https://example.com/unknown-shared')
    const result = await runCompanyDeepResearch({ workflowRunId: 'company-duplicate-pit', handle: await new Registry().mount(root), company: { symbol: '600519', name: 'Fixture Company' }, dataResolverFactory: resolverFactory([dated, unknown]), reportRoot: reports, asOf, now: () => asOf })
    assert.equal(result.status, 'blocked', result.errors.join('; '))
    assert.ok(result.research?.contextOnlySourceCandidateIds?.includes('shared-candidate'))
    assert.equal(result.research?.sourceCandidateIds.includes('shared-candidate'), false)
    const canonical = await readCanonicalV04Assets(root)
    assert.equal(canonical.objects.some((item) => item.kind === 'source' && 'url' in item.value && item.value.url === 'https://example.com/unknown-shared'), false)
    assert.equal(canonical.objects.some((item) => item.kind === 'source' && 'url' in item.value && item.value.url === 'https://example.com/dated-shared'), false, 'last-record candidate-id dedup selects unknown context, so neither conflicting record is durable')
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(reports, { recursive: true, force: true })
  }
})

test('Company Deep Research observes cancellation before acquisition', async () => {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-company-cancel-'))
  const reports = await mkdtemp(join(tmpdir(), 'researchhub-company-cancel-reports-'))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-company-cancel-test', now: '2026-09-08T00:00:00.000Z' })
    const controller = new AbortController()
    controller.abort()
    let called = false
    const plugin: ResearchAcquisitionPlugin = { name: 'fixture-gdelt', discover: async () => { called = true; return [] }, fetch: async (candidate) => ({ candidate, retrievedAt: '2026-09-08T00:00:00.000Z', content: '' }), normalize: async () => { throw new Error('must not normalize') } }
    const result = await runCompanyDeepResearch({ workflowRunId: 'company-cancel-run', handle: await new Registry().mount(root), company: { symbol: '600519', name: 'Fixture Company' }, dataResolverFactory: resolverFactory([plugin]), reportRoot: reports, signal: controller.signal })
    assert.equal(result.status, 'cancelled')
    assert.equal(called, false)
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(reports, { recursive: true, force: true })
  }
})

test('missing model and exhausted peer method block completion without Knowledge mutation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-company-method-fail-'))
  const reports = await mkdtemp(join(tmpdir(), 'researchhub-company-method-fail-reports-'))
  try {
    const now = '2026-09-08T00:00:00.000Z'
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-method-fail', now })
    await seedCanonicalCompany(root, '600519', 'Fixture Company', now)
    const plugin: ResearchAcquisitionPlugin = { name: 'fixture-official', discover: async () => [{ candidateId: '中文年报', kind: 'official_disclosure', tier: 1, title: '年报', url: 'https://example.test/annual.pdf', provider: 'cninfo', publishedAt: now }], fetch: async (candidate) => ({ candidate, retrievedAt: now, content: '公司业务、财务和治理风险披露。', contentHash: '9'.repeat(64) }), normalize: async (source) => ({ candidate: source.candidate, retrievedAt: source.retrievedAt, title: source.candidate.title, content: source.content, contentHash: source.contentHash!, canonicalUrl: source.candidate.url, publisher: 'CNINFO', rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false } }) }
    const baseline = await snapshotKnowledgeTree(root)
    const base = { handle: await new Registry().mount(root), company: { symbol: '600519', name: 'Fixture Company' }, dataResolverFactory: resolverFactory([plugin]), reportRoot: reports, now: () => now, writeKnowledge: true }
    const noModel = await runCompanyDeepResearch({ ...base, workflowRunId: 'missing-model', reasoningExecutor: undefined })
    assert.equal(noModel.status, 'blocked')
    assert.ok(noModel.errors.includes('SYNTHESIS_DEGRADED'))
    assert.deepEqual(await snapshotKnowledgeTree(root), baseline)
    let failedAttempts = 0
    let factoryCalls = 0
    const normal = completeResearchExecutor()
    const executor: ReasoningExecutor = { capabilities: normal.capabilities, execute: async (request, signal) => { if (request.metadata?.skillId === 'company_risk_analysis') { failedAttempts++; throw new Error('fixture timeout') } return normal.execute(request, signal) } }
    const failed = await runCompanyDeepResearch({ ...base, workflowRunId: 'failed-peer', dataResolverFactory: (options) => { factoryCalls++; return base.dataResolverFactory(options) }, reasoningExecutor: executor })
    assert.equal(failed.status, 'blocked')
    assert.equal(failedAttempts, 2, 'Workflow must not reset per-method attempts after supplemental acquisition')
    assert.ok(factoryCalls <= 3, 'Initial collection plus at most two supplemental rounds')
    assert.ok(failed.errors.some((error) => error.includes('METHOD_NOT_COMPLETED:company_risk_analysis')))
    assert.ok(failed.research?.sections.some((section) => section.markdown.includes('[中文年报@paragraph:1]')), 'Localized candidate IDs remain attributable')
    assert.deepEqual(await snapshotKnowledgeTree(root), baseline)
    let semanticCalls = 0
    const quotaExecutor: ReasoningExecutor = { capabilities: normal.capabilities, execute: async (request, signal) => {
      semanticCalls++
      if (request.metadata?.skillId === 'company_history_strategy') throw new Error('The usage limit has been reached')
      return normal.execute(request, signal)
    } }
    const quota = await runCompanyDeepResearch({...base,workflowRunId:'quota-stop',reasoningExecutor:quotaExecutor})
    assert.equal(quota.status,'blocked')
    assert.equal(semanticCalls,3,'TAM preparation and one concurrent pair run; shared quota stops all remaining calls')
    const checkpoint = JSON.parse(await readFile(join(reports,'company-research-600519-quota-stop.analysis.json'),'utf8'))
    assert.equal(checkpoint.methodResults.filter((method:any)=>method.attempts===0).length,8)
    assert.ok(checkpoint.methodResults.some((method:any)=>method.skillId==='business_model_map'&&method.status==='complete'))
    let synthesisCalls = 0
    const reviewThenQuotaExecutor: ReasoningExecutor = { capabilities: normal.capabilities, execute: async (request, signal) => {
      if (request.metadata?.stage === 'content_quality_review') return { operation: request.operation, output: { sectionChecks: COMPANY_CORE_SECTION_IDS.map(sectionId => ({ sectionId, questionAnswered: true, evidenceSupportsConclusion: sectionId !== 'investment-thesis', numericReproducible: true, riskTransmission: true, reasons: sectionId === 'investment-thesis' ? ['fixture requires a bounded synthesis revision'] : [] })) } }
      if (request.operation === 'company_research_synthesis' && ++synthesisCalls > 1) throw new Error('RATE_LIMIT_OR_QUOTA: The usage limit has been reached')
      return normal.execute(request, signal)
    } }
    const retained = await runCompanyDeepResearch({...base,workflowRunId:'review-quota-retain',reasoningExecutor:reviewThenQuotaExecutor})
    assert.equal(retained.status,'blocked')
    assert.ok(synthesisCalls >= 2,'the bounded synthesis retry must be attempted')
    const retainedThesis = retained.research?.sections.find((section:any)=>section.id==='investment-thesis')?.markdown ?? ''
    const retainedMonitoring = retained.research?.sections.find((section:any)=>section.id==='monitoring-checklist')?.markdown ?? ''
    assert.match(retainedThesis,/核心判断|证据支持|研究结论/)
    assert.match(retainedMonitoring,/跟踪|指标/)
    assert.match(retainedThesis,/研究未完成/,'Unresolved prior citations must be replaced by an explicit incomplete diagnostic rather than retained as conclusions')
    const retainedAnalysis = JSON.parse(await readFile(join(reports,'company-research-600519-review-quota-retain.analysis.json'),'utf8'))
    assert.equal(retainedAnalysis.synthesisSnapshotStatus,'not_retained_evidence_changed')
    assert.equal(retainedAnalysis.contentQuality.passed,false,'retaining structurally validated prose must not override failed semantic review or quota exhaustion')
    assert.deepEqual(await snapshotKnowledgeTree(root), baseline)
    let reviewCalls = 0
    const sharedReviewBudgetExecutor: ReasoningExecutor = { capabilities: normal.capabilities, execute: async (request, signal) => {
      if (request.metadata?.stage === 'content_quality_review') {
        reviewCalls++
        if (reviewCalls === 1) return { operation: request.operation, output: 'malformed reviewer output' }
        return { operation: request.operation, output: { sectionChecks: COMPANY_CORE_SECTION_IDS.map(sectionId => ({ sectionId, questionAnswered: sectionId !== 'company-overview', evidenceSupportsConclusion: true, numericReproducible: true, riskTransmission: true, reasons: sectionId === 'company-overview' ? ['fixture requests bounded method correction'] : [] })) } }
      }
      return normal.execute(request, signal)
    } }
    const budgetBlocked = await runCompanyDeepResearch({...base,workflowRunId:'review-shared-budget',reasoningExecutor:sharedReviewBudgetExecutor})
    assert.equal(budgetBlocked.status,'blocked')
    assert.equal(reviewCalls,2,'content review has one shared two-call budget across both review rounds')
    const budgetAnalysis = JSON.parse(await readFile(join(reports,'company-research-600519-review-shared-budget.analysis.json'),'utf8'))
    assert.equal(budgetAnalysis.reviewAttempts,2)
    assert.ok(budgetAnalysis.qualityReviewHistory.some((entry:any)=>entry.review.diagnostics.some((diagnostic:any)=>diagnostic.code==='SEMANTIC_REVIEW_BUDGET_EXHAUSTED')))
    assert.deepEqual(await snapshotKnowledgeTree(root), baseline)
  } finally { await rm(root, { recursive: true, force: true }); await rm(reports, { recursive: true, force: true }) }
})
