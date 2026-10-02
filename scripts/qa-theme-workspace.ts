import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fauxProvider } from '@earendil-works/pi-ai'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { archiveRaw } from '../knowledge/raw/raw-archive.ts'
import { createThemeScopeDecisionV04, fingerprintThemeScopeCandidateV04 } from '../knowledge/governance/theme-scope-v04.ts'
import type { ThemeScopeCandidateV04, ThemeScopeDecisionBatchV04, ThemeScopeDecisionV04, ThemeScopeEvidenceV04 } from '../knowledge/governance/theme-scope-v04.ts'
import { ThemeManagementGatewayV04 } from '../knowledge/production/theme-management-v04.ts'
import type { KnowledgeAssetV04, KnowledgeClaimV04, KnowledgeCompanyV04, KnowledgeEventV04, KnowledgeIndustryV04, KnowledgeRelationV04, KnowledgeSourceV04 } from '../knowledge/schema/domain-v04.ts'
import { COMPETITION_MODULE_SCHEMA_ID_V1, type CompetitionModuleV1 } from '../knowledge/schema/competition-module-v04.ts'
import type { KnowledgeChangeSetV04, KnowledgeOperationV04 } from '../knowledge/schema/mutation-v04.ts'
import { createFreshKnowledgeBaseV04 } from '../knowledge/storage/create-v04.ts'
import { KnowledgeBaseRegistry } from '../knowledge/registry/registry.ts'
import { validateKnowledgeChangeSetV04 } from '../knowledge/validation/v04-change-set-validator.ts'
import { writeKnowledgeBase } from '../knowledge/writer/writer.ts'
import { createResearchHubApplicationRuntime } from '../app/runtime/application-runtime.ts'
import { ResearchHubRuntimeServer } from '../app/runtime/server.ts'
import type { ReasoningCapabilities, ReasoningExecutor, ReasoningRequest, ReasoningResult } from '../plugins/reasoning/contracts.ts'

const NOW = '2026-10-02T03:00:00.000Z'
const SOURCE_REF = 'source:qa-theme-workspace-report' as const
const THEME_NAME = 'AI 算力产业链（本机 QA）'
const INDUSTRY_A = { id: 'entity:qa-ai-accelerators', name: 'AI 加速器' } as const
const INDUSTRY_B = { id: 'entity:qa-advanced-packaging', name: '先进封装' } as const
const COMPANY_A = { id: 'entity:qa-silicon-labs', name: '示例算力芯片公司', ticker: '688001', exchange: 'SSE' } as const
const COMPANY_B = { id: 'entity:qa-packaging-works', name: '示例先进封装公司', ticker: '688002', exchange: 'SSE' } as const
const capabilities: ReasoningCapabilities = { maxContextTokens: 100_000, maxOutputTokens: 10_000, structuredOutputSupport: true, maxConcurrency: 2 }

class OfflineFixtureExecutor implements ReasoningExecutor {
  capabilities(): ReasoningCapabilities { return capabilities }
  async execute(request: ReasoningRequest): Promise<ReasoningResult> { return { operation: request.operation, output: {} } as ReasoningResult }
}

function operation(operationId: string, object: KnowledgeAssetV04): KnowledgeOperationV04 { return { operationId, type: 'create', object } }

function decision(themeRef: string, revision: number, candidate: ThemeScopeCandidateV04, evidence: ThemeScopeEvidenceV04): ThemeScopeDecisionV04 {
  return createThemeScopeDecisionV04({
    version: '0.4', themeRef: themeRef as ThemeScopeDecisionV04['themeRef'], candidate,
    candidateFingerprint: fingerprintThemeScopeCandidateV04(candidate), decision: 'include',
    rationale: '本机 D1 浏览器验收使用的临时主题范围。', evidence: [evidence], coverageGaps: [],
    review: { status: 'human_confirmed', confirmedAt: NOW }, basedOnRevision: revision, affectedBranchKeys: ['qa-scope'],
  })
}

function claim(id: string, claimType: KnowledgeClaimV04['claimType'], subjectRef: string, statement: string, rawRef: `raw-sha256-${string}`, structuredValue?: KnowledgeClaimV04['structuredValue'], temporal?: KnowledgeClaimV04['temporal']): KnowledgeClaimV04 {
  return {
    id: `claim:${id}`, claimType, statement, subjectRefs: [subjectRef as KnowledgeClaimV04['subjectRefs'][number]],
    sourceRefs: [SOURCE_REF], provenance: [{ sourceRef: SOURCE_REF, rawRef, locator: 'QA fixture, section 1', chunkRef: null }],
    confidence: 0.9, ...(claimType === 'forecast' ? { probability: 0.72 } : {}), ...(structuredValue ? { structuredValue } : {}), ...(temporal ? { temporal } : {}), lifecycle: { status: 'active' },
  }
}

async function seedFixture(kbRoot: string): Promise<string> {
  const registry = new KnowledgeBaseRegistry()
  await createFreshKnowledgeBaseV04(kbRoot, { knowledgeBaseId: `kb-theme-workspace-qa-${Date.now()}`, now: NOW })
  const themeResult = await new ThemeManagementGatewayV04({ clock: () => NOW }).createTheme(await registry.mount(kbRoot), { name: THEME_NAME })
  if (themeResult.status !== 'committed' || !themeResult.themeRef) throw new Error(`Could not create QA Theme: ${themeResult.errors.map((item) => item.message).join('; ')}`)
  const themeRef = themeResult.themeRef

  const raw = await archiveRaw(await registry.mount(kbRoot), { bytes: Buffer.from('Local disposable evidence for the D1 Theme workspace browser acceptance.'), originalFilename: 'qa-theme-framework.txt', mediaType: 'text/plain' }, { clock: () => NOW })
  const rawRef = raw.manifest.rawRef as `raw-sha256-${string}`
  const source: KnowledgeSourceV04 = {
    id: SOURCE_REF, title: '本机 QA 临时研究资料', sourceType: 'sell_side_research', provider: 'local-qa-fixture',
    canonicalUrl: 'https://example.invalid/local-qa-theme-workspace', publishedAt: '2026-10-01T00:00:00.000Z', retrievedAt: NOW,
    contentHash: raw.manifest.contentHash.slice('sha256:'.length), rawRefs: [rawRef],
    rights: { accessScope: 'public', providerTermsKnown: true, retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false },
    usagePolicy: { mode: 'personal_noncommercial_research', retainRaw: true, allowAiProcessing: true, allowDerivedKnowledge: true, redistributionAllowed: false },
    lifecycle: { status: 'active' },
  }
  await commit(kbRoot, registry, 'seed-qa-source', [operation('create-qa-source', source)])

  const handle = await registry.refresh(kbRoot)
  const exposureA: KnowledgeRelationV04 = { id: 'relation:qa-theme-exposure-accelerators', type: 'theme_exposure', sourceRef: themeRef as `entity:${string}`, targetRef: INDUSTRY_A.id, sourceRefs: [SOURCE_REF], attributes: { importance: 'core' }, lifecycle: { status: 'active' } }
  const exposureB: KnowledgeRelationV04 = { id: 'relation:qa-theme-exposure-packaging', type: 'theme_exposure', sourceRef: themeRef as `entity:${string}`, targetRef: INDUSTRY_B.id, sourceRefs: [SOURCE_REF], attributes: { importance: 'material' }, lifecycle: { status: 'active' } }
  const upstream: KnowledgeRelationV04 = { id: 'relation:qa-accelerators-upstream-of-packaging', type: 'upstream_of', sourceRef: INDUSTRY_A.id, targetRef: INDUSTRY_B.id, sourceRefs: [SOURCE_REF], lifecycle: { status: 'active' } }
  const companyAExposure: KnowledgeRelationV04 = { id: 'relation:qa-silicon-exposure', type: 'business_exposure', sourceRef: COMPANY_A.id, targetRef: INDUSTRY_A.id, sourceRefs: [SOURCE_REF], attributes: { exposureBasis: 'direct_operation', realizationStage: 'commercialized', materiality: 'core' }, lifecycle: { status: 'active' } }
  const companyBExposure: KnowledgeRelationV04 = { id: 'relation:qa-packaging-exposure', type: 'business_exposure', sourceRef: COMPANY_B.id, targetRef: INDUSTRY_A.id, sourceRefs: [SOURCE_REF], attributes: { exposureBasis: 'direct_operation', realizationStage: 'commercialized', materiality: 'material' }, lifecycle: { status: 'active' } }
  const industryA: KnowledgeIndustryV04 = { ...INDUSTRY_A, type: 'industry', description: '加速器芯片、板卡与系统级算力产品。', lifecycle: { status: 'active' } }
  const industryB: KnowledgeIndustryV04 = { ...INDUSTRY_B, type: 'industry', description: '先进封装支撑高带宽存储与算力芯片集成。', lifecycle: { status: 'active' } }
  const companyA: KnowledgeCompanyV04 = { ...COMPANY_A, type: 'company', description: '本机验收示例公司，主营 AI 加速器。', lifecycle: { status: 'active' } }
  const companyB: KnowledgeCompanyV04 = { ...COMPANY_B, type: 'company', description: '本机验收示例公司，主营先进封装。', lifecycle: { status: 'active' } }
  const facts = [
    claim('qa-accelerator-view-1', 'viewpoint', INDUSTRY_A.id, '训练集群扩容推动高端加速器需求，供给约束仍是短期主要矛盾。', rawRef),
    claim('qa-accelerator-view-2', 'risk', INDUSTRY_A.id, '先进制程与高带宽存储供应节奏可能限制交付。', rawRef),
    claim('qa-accelerator-view-3', 'forecast', INDUSTRY_A.id, '国产化率提升有望扩大本土厂商可服务市场。', rawRef),
    claim('qa-accelerator-view-4', 'viewpoint', INDUSTRY_A.id, '软件生态成熟度将影响新进入者的份额爬坡。', rawRef),
    claim('qa-packaging-view', 'viewpoint', INDUSTRY_B.id, 'Chiplet 与堆叠封装增加先进封装的单位价值量。', rawRef),
    claim('qa-company-a-products', 'fact', COMPANY_A.id, '主要产品：AI 加速卡与训练服务器。', rawRef),
    claim('qa-company-a-cap', 'fact', COMPANY_A.id, '市值：1,280 亿元。', rawRef, { metric: 'metric:market_cap', value: 128_000_000_000, unit: 'CNY', comparator: 'eq', period: '2026-10-01' }, { asOf: '2026-10-01', scope: { type: 'point', start: '2026-10-01', end: '2026-10-01', label: '2026-10-01' } }),
    claim('qa-company-a-revenue', 'fact', COMPANY_A.id, '2025 年营收：86 亿元。', rawRef, { metric: 'metric:revenue', value: 8_600_000_000, unit: 'CNY', comparator: 'eq', period: 'FY2025', fiscalPeriod: 'FY2025' }),
    claim('qa-company-b-products', 'fact', COMPANY_B.id, '主要产品：2.5D/3D 先进封装服务。', rawRef),
    claim('qa-company-b-cap', 'fact', COMPANY_B.id, '市值：760 亿元。', rawRef, { metric: 'metric:market_cap', value: 76_000_000_000, unit: 'CNY', comparator: 'eq', period: '2026-10-01' }, { asOf: '2026-10-01', scope: { type: 'point', start: '2026-10-01', end: '2026-10-01', label: '2026-10-01' } }),
    claim('qa-company-b-revenue', 'fact', COMPANY_B.id, '2025 年营收：52 亿元。', rawRef, { metric: 'metric:revenue', value: 5_200_000_000, unit: 'CNY', comparator: 'eq', period: 'FY2025', fiscalPeriod: 'FY2025' }),
    claim('qa-company-a-view', 'viewpoint', COMPANY_A.id, '公司扩产进度与客户验证节奏决定短期收入弹性。', rawRef),
    claim('qa-company-catalyst', 'catalyst', COMPANY_A.id, '新一代加速卡客户验证结果预计于 2026 年 11 月披露。', rawRef),
  ]
  const historical: KnowledgeEventV04 = { id: 'event:qa-capacity-announcement', eventType: 'capacity_expansion', title: '示例公司公布新产线投产进度', subjectRefs: [COMPANY_A.id], temporal: { occurredAt: '2026-10-01T00:00:00.000Z', announcedAt: '2026-10-01T00:00:00.000Z' }, sourceRefs: [SOURCE_REF], lifecycle: { status: 'active' } }
  const future: KnowledgeEventV04 = { id: 'event:qa-customer-validation', eventType: 'product_launch', title: '新一代加速卡客户验证窗口', subjectRefs: [COMPANY_A.id], temporal: { start: '2026-11-15T00:00:00.000Z', announcedAt: '2026-10-01T00:00:00.000Z' }, sourceRefs: [SOURCE_REF], lifecycle: { status: 'active' } }
  const competition: CompetitionModuleV1 = {
    id: 'module:qa-competition-landscape', type: 'competition', targetEntity: INDUSTRY_A.id,
    sourceRefs: [SOURCE_REF], schemaId: COMPETITION_MODULE_SCHEMA_ID_V1,
    columns: [
      { id: 'company', role: 'company', label: '公司' },
      { id: 'products', role: 'main_products', label: '主要产品' },
      { id: 'market-cap', role: 'market_cap', label: '市值' },
      { id: 'annual-revenue', role: 'annual_revenue', label: '2025 年营收' },
    ],
    rows: [{ companyRef: COMPANY_A.id, cells: {
      products: { status: 'available', displayValue: 'AI 加速卡、训练服务器', knowledgeRefs: ['claim:qa-company-a-products'] },
      'market-cap': { status: 'available', displayValue: '128000000000', asOf: '2026-10-01', currency: 'CNY', unit: 'CNY', knowledgeRefs: ['claim:qa-company-a-cap'] },
      'annual-revenue': { status: 'available', displayValue: '8600000000', fiscalYear: 2025, currency: 'CNY', unit: 'CNY', knowledgeRefs: ['claim:qa-company-a-revenue'] },
    } }, { companyRef: COMPANY_B.id, cells: {
      products: { status: 'available', displayValue: '先进封装服务', knowledgeRefs: ['claim:qa-company-b-products'] },
      'market-cap': { status: 'available', displayValue: '76000000000', asOf: '2026-10-01', currency: 'CNY', unit: 'CNY', knowledgeRefs: ['claim:qa-company-b-cap'] },
      'annual-revenue': { status: 'available', displayValue: '5200000000', fiscalYear: 2025, currency: 'CNY', unit: 'CNY', knowledgeRefs: ['claim:qa-company-b-revenue'] },
    } }],
  }

  const industryCandidateA: ThemeScopeCandidateV04 = { kind: 'industry', name: INDUSTRY_A.name, canonicalRef: INDUSTRY_A.id }
  const industryCandidateB: ThemeScopeCandidateV04 = { kind: 'industry', name: INDUSTRY_B.name, canonicalRef: INDUSTRY_B.id }
  const relationCandidate: ThemeScopeCandidateV04 = { kind: 'relation', relationType: 'upstream_of', sourceFingerprint: fingerprintThemeScopeCandidateV04(industryCandidateA), targetFingerprint: fingerprintThemeScopeCandidateV04(industryCandidateB), canonicalRef: upstream.id }
  const evidence: ThemeScopeEvidenceV04 = { sourceRef: SOURCE_REF, rawRef, locator: 'QA fixture, sections 1–4' }
  const scope: ThemeScopeDecisionBatchV04 = { version: '0.4', themeRef: themeRef as ThemeScopeDecisionBatchV04['themeRef'], basedOnRevision: handle.revision, decisions: [decision(themeRef, handle.revision, industryCandidateA, evidence), decision(themeRef, handle.revision, industryCandidateB, evidence), decision(themeRef, handle.revision, relationCandidate, evidence)] }
  await commit(kbRoot, registry, 'seed-qa-theme-workspace-content', [
    operation('create-qa-industry-a', industryA), operation('create-qa-industry-b', industryB),
    operation('create-qa-company-a', companyA), operation('create-qa-company-b', companyB),
    operation('create-qa-theme-exposure-a', exposureA), operation('create-qa-theme-exposure-b', exposureB), operation('create-qa-upstream-edge', upstream),
    operation('create-qa-business-exposure-a', companyAExposure), operation('create-qa-business-exposure-b', companyBExposure),
    ...facts.map((item, index) => operation(`create-qa-fact-${index + 1}`, item)), operation('create-qa-historical-event', historical), operation('create-qa-future-event', future),
    operation('create-qa-competition-module', competition),
  ], scope)
  return themeRef
}

async function commit(kbRoot: string, registry: KnowledgeBaseRegistry, runId: string, operations: readonly KnowledgeOperationV04[], scope?: ThemeScopeDecisionBatchV04): Promise<void> {
  const handle = await registry.refresh(kbRoot)
  const changeSet: KnowledgeChangeSetV04 = {
    changeSetId: `changeset-${runId}`, workflowRunId: runId, knowledgeBaseId: handle.knowledgeBaseId,
    schemaVersion: '0.4', storageFormatVersion: '1', expectedBaseRevision: handle.revision, operations,
    ...(scope ? { ingestionContext: { producerType: 'theme_framework', themeScope: scope } } : {}),
  }
  const validation = await validateKnowledgeChangeSetV04(handle, changeSet, { mode: 'commit', now: () => NOW })
  if (!validation.validatedChangeSet) throw new Error(`QA ChangeSet rejected: ${JSON.stringify(validation.report.errors)}`)
  const written = await writeKnowledgeBase(handle, validation.validatedChangeSet, { registry, clock: () => NOW })
  if (written.status !== 'committed') throw new Error(`QA ChangeSet commit failed: ${written.error?.message ?? written.status}`)
}

const temporaryRoot = await mkdtemp(join(tmpdir(), 'rhl-theme-workspace-qa-'))
const kbRoot = join(temporaryRoot, 'knowledge-base')
const cwd = join(temporaryRoot, 'cwd')
const agentDir = join(temporaryRoot, 'agent')
const workspaceRoot = join(temporaryRoot, 'workspace')
await Promise.all([mkdir(cwd), mkdir(agentDir), mkdir(workspaceRoot)])
let runtime: Awaited<ReturnType<typeof createResearchHubApplicationRuntime>> | undefined
let server: ResearchHubRuntimeServer | undefined
let modelRuntime: ModelRuntime | undefined
let stop!: () => void
const stopped = new Promise<void>((resolve) => { stop = resolve })

try {
  const themeRef = await seedFixture(kbRoot)
  modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false })
  const offline = fauxProvider({ provider: `rhl-theme-workspace-qa-${Date.now()}`, models: [{ id: 'offline-fixture' }] })
  modelRuntime.registerNativeProvider(offline.provider)
  runtime = await createResearchHubApplicationRuntime({ cwd, agentDir, mountedKnowledgeBaseRoot: kbRoot, workspaceRoot, modelRuntime, model: offline.getModel(), reasoningExecutor: new OfflineFixtureExecutor() })
  server = new ResearchHubRuntimeServer({ runtime, port: 0 })
  const info = await server.start()
  process.stdout.write(`Temporary QA Knowledge Base: ${kbRoot}\nTheme: ${THEME_NAME} (${themeRef})\nOpen: ${info.origin}/graph?themeRef=${encodeURIComponent(themeRef)}\nPress Ctrl+C to close the server and delete the temporary QA data.\n`)
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  await stopped
} finally {
  await server?.close()
  await runtime?.close()
  await (modelRuntime as unknown as { dispose?: () => void | Promise<void> } | undefined)?.dispose?.()
  await rm(temporaryRoot, { recursive: true, force: true })
}
