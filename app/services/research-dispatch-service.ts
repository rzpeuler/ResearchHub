import { randomUUID } from 'node:crypto'
import type { DailyIntelligenceService } from './daily-intelligence-service.ts'
import type { ResearchService } from './research-service.ts'
import type { WorkflowService } from './workflow-service.ts'
import { ApplicationServiceError } from './contracts.ts'
import { createResearchSkillRegistry, loadResearchSkillMethodology, type LoadedResearchSkill, type ResearchSkillDefinition, type ResearchSkillRegistry } from './skill-registry.ts'
import { createWorkflowDefinitionRegistry, type WorkflowDefinition, type WorkflowDefinitionRegistry } from './workflow-registry.ts'
import { normalizeResearchRequest, validateResearchDispatchDecision, type ResearchDispatchDecision, type ResearchExecutionSummary, type ResearchRequest } from './research-dispatch-contracts.ts'
import type { EventAnchor, EarningsReviewPeriod, ValuationMethod, WorkflowRunView } from './contracts.ts'
import type { ResearchBundle, ResearchBundleStore, ResearchSessionResult } from './research-bundle.ts'
import { createResearchBundle } from './research-bundle.ts'
import type { SourceLibraryService, SourceLibraryHit } from './source-library.ts'
import type { ThemeFrameworkService } from './theme-framework-service.ts'
import { KnowledgeBaseRegistry } from '../../knowledge/registry/registry.ts'
import { readCanonicalV04Assets } from '../../knowledge/storage/canonical-v04-loader.ts'
import type { ReasoningExecutor, ReasoningRequest } from '../../plugins/reasoning/contracts.ts'
import { runThesisLifecycle } from '../../workflows/thesis-lifecycle/workflow.ts'
import type { ThesisLifecycleInput } from '../../workflows/thesis-lifecycle/contracts.ts'
import { validateWorkflowInputSchema } from './workflow-input-contract.ts'
import { normalizeCompanyCandidateIdentity, normalizeExchange } from '../../skills/knowledge-curation/identity/company-identity.ts'
import { projectResearchExecutionResult } from './research-execution-result.ts'
import type { ReviewService } from './review-service.ts'
import type { SecurityIdentityResolver, VerifiedSecurityIdentity } from './security-identity-resolver.ts'
import { createVerifiedSecurityIdentityHandoff, type VerifiedSecurityIdentityHandoff } from './verified-security-identity-handoff.ts'
import type { ResearchDispatchClarification, ResearchDispatchAttemptCategory, ResearchDispatchAttemptError } from './research-dispatch-contracts.ts'
export type { ResearchDispatchClarification, ResearchDispatchAttemptCategory, ResearchDispatchAttemptError } from './research-dispatch-contracts.ts'

export interface ResearchSessionContext {
  readonly selectedSkills: readonly LoadedResearchSkill[]
  readonly sourceLibraryHits: readonly SourceLibraryHit[]
  readonly entities: readonly ResearchDispatchDecision['entities'][number][]
  readonly evidenceRefs: readonly string[]
}

const UUID_RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

function validateServerOwnedRunId(runId: string | undefined): void {
  if (runId !== undefined && (typeof runId !== 'string' || runId.length > 36 || !UUID_RUN_ID_PATTERN.test(runId))) {
    throw new ApplicationServiceError('invalid_input', 'serverOwnedRunId must be a valid UUID')
  }
}

export interface ExtractedResearchArguments {
  readonly arguments: Readonly<Record<string, unknown>>
  readonly missingRequiredInputs: readonly string[]
  readonly diagnostics: readonly string[]
  readonly extractedKeys: readonly string[]
}

export interface ResearchDispatchStart {
  readonly request: ResearchRequest
  readonly decision: ResearchDispatchDecision
  readonly summary: ResearchExecutionSummary
  readonly status: 'started' | 'needs_input' | 'needs_clarification' | 'invalid_input' | 'unresolved_reference' | 'executor_unavailable' | 'free_research' | 'skill_plan'
  readonly clarification?: ResearchDispatchClarification
  readonly runId?: string
  readonly workflow?: WorkflowRunView
  readonly completion?: Promise<unknown>
  readonly sourceLibraryHits?: readonly SourceLibraryHit[]
  readonly resolution?: ResearchDispatchResolution
  readonly feedback?: ResearchDispatchFeedback
  /** Public verification result for the explicit product start response; never accepted as caller input. */
  readonly verifiedSecurityIdentity?: VerifiedSecurityIdentity
}

export interface ResearchDispatchFeedback {
  readonly status: 'NEEDS_INPUT' | 'INVALID_INPUT' | 'UNRESOLVED_REFERENCE' | 'EXECUTOR_UNAVAILABLE'
  readonly workflowId: string
  readonly missingFields: readonly string[]
  readonly validatedArguments: Readonly<Record<string, unknown>>
  readonly reason: string
  readonly suggestedQuestion: string
}

export interface ResearchDispatchResolution {
  readonly source: 'reasoning_executor' | 'bounded_repair' | 'deterministic_fallback'
  readonly attempts: number
  readonly diagnostics: readonly string[]
  readonly attemptErrors?: readonly ResearchDispatchAttemptError[]
}

class DispatchValidationError extends ApplicationServiceError {
  constructor(readonly category: ResearchDispatchAttemptCategory, readonly fieldPaths: readonly string[]) { super('invalid_input', `DISPATCH_${category.toUpperCase()}_FAILED`) }
}

function dispatchAttemptError(error: unknown, stage: ResearchDispatchAttemptCategory, attempt: number): ResearchDispatchAttemptError {
  if (error instanceof DispatchValidationError) return { attempt, category: error.category, code: error.message, fieldPaths: error.fieldPaths }
  const stableCode = error !== null && typeof error === 'object' && 'code' in error ? (error as { code?: unknown }).code : undefined
  const category: ResearchDispatchAttemptCategory = stableCode === 'reasoning_timeout' ? 'timeout'
    : ['reasoning_schema_invalid', 'reasoning_output_invalid', 'reasoning_output_too_large', 'reasoning_structured_output_configuration_failed', 'reasoning_configuration_invalid', 'invalid_output'].includes(String(stableCode)) ? 'semantic_decision'
    : stage
  return { attempt, category, code: `DISPATCH_${category.toUpperCase()}_FAILED`, fieldPaths: [] }
}

class DispatchSemanticError extends Error {
  constructor(readonly resolution: ResearchDispatchResolution, readonly category: string) { super('Research intent recognition failed after one repair attempt.') }
}

export interface WorkflowExecutionBindingContext {
  readonly workflowId: string
  readonly args: Readonly<Record<string, unknown>>
  readonly runId: string
  readonly callerSignal?: AbortSignal
  readonly writeKnowledge: boolean
  readonly useStructuredKnowledge: boolean
  readonly sourceLibraryHits: readonly SourceLibraryHit[]
  /** Internal in-process result from the Dispatch identity gate; never read from Workflow arguments. */
  readonly verifiedIdentityHandoff?: VerifiedSecurityIdentityHandoff
}
export type WorkflowExecutionBinding = (context: WorkflowExecutionBindingContext) => Promise<unknown>

export interface ResearchDispatchServiceOptions {
  readonly researchService?: ResearchService
  readonly dailyIntelligenceService?: DailyIntelligenceService
  readonly workflowRegistry?: WorkflowDefinitionRegistry
  readonly skillRegistry?: ResearchSkillRegistry
  readonly workflowService?: WorkflowService
  readonly reviewService?: Pick<ReviewService, 'getReviewCase'>
  readonly bundleStore?: ResearchBundleStore
  readonly sourceLibraryService?: SourceLibraryService
  readonly themeFrameworkService?: ThemeFrameworkService
  /** Explicit execution seams for test-only registry entries; production IDs use the built-in bindings. */
  readonly executionBindings?: ReadonlyMap<string, WorkflowExecutionBinding>
  readonly mountedKnowledgeBaseRoot?: string
  readonly securityIdentityResolver?: SecurityIdentityResolver
  readonly reasoningExecutor?: ReasoningExecutor
  readonly clock?: () => Date
}

const WORKFLOW_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  earnings_review: ['半年报', '上半年', '年报', '季报', '季度', '业绩', 'earnings', 'financial results', 'q1', 'h1', 'q3', 'fy'],
  valuation: ['估值', 'valuation', '市盈率', '市净率', 'ev/ebitda', 'pe', 'pb'],
  thesis_red_team: ['反驳', '反向验证', '红队', 'red team', 'red-team', 'thesis', '投资论点'],
  thesis_lifecycle: ['thesis lifecycle', 'thesis 生命周期', '投资论点生命周期', '创建并维护 thesis', 'create and refresh thesis'],
  event_research: ['事件', '公告', '新闻', '消息', 'event', 'announcement', 'headline'],
  industry_research: ['行业', '产业', '产业链', 'industry', 'pcb', '半导体', '服务器'],
  company_research: ['公司', '个股', 'company', '股票'],
  daily_intelligence: ['日报', '盘前', '盘后', 'morning brief', 'evening brief', 'daily intelligence'],
  theme_framework: ['主题框架', '投资主题初始化', '构建投资主题', '创建投资主题', 'theme framework', 'investment theme framework'],
}

function safeQuery(query: string): string { return query.toLocaleLowerCase() }
function containsTerm(text: string, term: string): boolean {
  const normalized = term.toLocaleLowerCase()
  if (/^[a-z0-9]+$/i.test(normalized) && normalized.length <= 3) return new RegExp(`\\b${normalized}\\b`, 'i').test(text)
  return text.includes(normalized)
}

function extractSymbol(query: string): { readonly symbol?: string; readonly name?: string; readonly exchange?: string } {
  const match = query.match(/(?<!\d)(\d{6})(?:\.(SSE|SH|SZSE|SZ|BSE|BJ))?(?!\d)/iu)
  if (match === null) return {}
  return { symbol: match[1], ...(match[2] === undefined ? {} : { exchange: match[2].toUpperCase() }) }
}

function userNameBesideCode(query: string): string | undefined {
  const match = query.match(/([\p{Script=Han}]{2,30})\s*[（(]?\s*\d{6}/u)?.[1]
  const name = match?.replace(/^(?:请|帮我|写一篇|写一份|研究|分析|当前|关于|股票|公司)+/u, '')
  return name && name.length >= 2 && !['股票', '公司', '证券'].includes(name) ? name : undefined
}

function extractFiscalYear(query: string): number | undefined {
  const match = query.match(/\b(?:fy\s*)?(20\d{2})\s*(?:年|fy|financial\s+year)?\b/i)
  return match === null ? undefined : Number(match[1])
}

function extractPeriod(query: string): EarningsReviewPeriod | undefined {
  if (/半年|上半年|\bh1\b/i.test(query)) return 'H1'
  if (/一季度|第一季度|\bq1\b/i.test(query)) return 'Q1'
  if (/三季度|第三季度|\bq3\b/i.test(query)) return 'Q3'
  if (/年报|全年|\bfy\b|\bfy\s*20\d{2}\b/i.test(query)) return 'FY'
  return undefined
}

function extractIndustryName(query: string): string | undefined {
  const known = ['PCB', 'AI Server Hardware', '人工智能', '半导体', '服务器', '新能源汽车']
  const lower = safeQuery(query)
  const found = known.find((item) => lower.includes(item.toLocaleLowerCase()))
  if (found !== undefined) return found
  const match = query.match(/(?:研究|分析|关注|关于)\s*([\p{Script=Han}A-Za-z0-9][\p{Script=Han}A-Za-z0-9 &/_-]{0,60}?)(?:行业|产业)/u)
  return match?.[1]?.trim()
}

function extractMethods(query: string): readonly ValuationMethod[] | undefined {
  const methods: ValuationMethod[] = []
  if (/市盈率|\bpe\b/i.test(query)) methods.push('PE')
  if (/市净率|\bpb\b/i.test(query)) methods.push('PB')
  if (/ev\s*[/：:]?\s*ebitda|企业价值/i.test(query)) methods.push('EV_EBITDA')
  return methods.length === 0 ? undefined : methods
}

function extractEventAnchor(query: string): EventAnchor | undefined {
  const url = query.match(/https?:\/\/[^\s)]+/i)?.[0]
  if (url !== undefined) return { kind: 'url', url }
  if (!/事件|公告|新闻|消息|event|announcement|headline/i.test(query)) return undefined
  return { kind: 'user_event', title: query.slice(0, 200), description: query.slice(0, 2_000) }
}

function extractThesisRef(query: string): string | undefined {
  return query.match(/\bclaim:[A-Za-z0-9._-]+\b/)?.[0]
}

function extractThemeName(query: string, allowBareName = false): string | undefined {
  const patterns = [
    /(?:为|给)\s*([\p{Script=Han}A-Za-z0-9][\p{Script=Han}A-Za-z0-9 &/_-]{0,79}?)\s*(?:创建|新建|构建|初始化|搭建)\s*(?:一个)?\s*(?:投资)?主题/iu,
    /(?:创建|新建|构建|初始化|搭建|梳理)\s*(?:一个)?\s*([\p{Script=Han}A-Za-z0-9][\p{Script=Han}A-Za-z0-9 &/_-]{0,79}?)\s*(?:的)?(?:投资)?主题(?:框架)?/iu,
    /([\p{Script=Han}A-Za-z0-9][\p{Script=Han}A-Za-z0-9 &/_-]{0,79}?)\s*(?:投资)?主题(?:框架)?/iu,
    /(?:theme framework|investment theme)\s*(?:for|:)?\s*([A-Za-z0-9][A-Za-z0-9 &/_-]{0,79})/iu,
  ]
  for (const pattern of patterns) {
    const value = query.match(pattern)?.[1]?.trim().replace(/\s+/gu, ' ')
    if (value && value.length <= 80) return value
  }
  if (allowBareName) {
    const value = query.trim().replace(/\s+/gu, ' ')
    const isSafeName = value.length <= 80 && /^[\p{Script=Han}A-Za-z0-9][\p{Script=Han}A-Za-z0-9 &/_-]{0,79}$/u.test(value)
    const looksLikeInstructionOrQuestion = /请|帮我|分析|研究|创建|新建|构建|初始化|搭建|梳理|定义|如何|哪些|什么|为什么|是否|趋势|目前|现在|有哪些|是什么|怎么|能否|吗|要不要/u.test(value)
      || /\b(?:please|analy[sz]e|research|create|build|construct|initialize|define|what|how|which|why|whether|currently|trend|trends|companies|stocks|should|can)\b/i.test(value)
    if (isSafeName && !looksLikeInstructionOrQuestion) return value
  }
  return undefined
}

export function extractWorkflowArguments(definition: WorkflowDefinition, query: string, allowBareThemeName = false): ExtractedResearchArguments {
  const args: Record<string, unknown> = {}
  const diagnostics: string[] = []
  const identity = extractSymbol(query)
  if (identity.symbol !== undefined) args.symbol = identity.symbol
  if (identity.exchange !== undefined) args.exchange = identity.exchange
  if (identity.name !== undefined) args.name = identity.name
  if (definition.id === 'industry_research') {
    const name = extractIndustryName(query)
    if (name !== undefined) args.name = name
  }
  if (definition.id === 'earnings_review') {
    const fiscalYear = extractFiscalYear(query)
    const period = extractPeriod(query)
    if (fiscalYear !== undefined) args.fiscalYear = fiscalYear
    if (period !== undefined) args.period = period
  }
  if (definition.id === 'valuation') {
    const methods = extractMethods(query)
    if (methods !== undefined) args.methods = methods
    const targetFiscalYear = extractFiscalYear(query)
    if (targetFiscalYear !== undefined) args.targetFiscalYear = targetFiscalYear
  }
  if (definition.id === 'event_research') {
    const anchor = extractEventAnchor(query)
    if (anchor !== undefined) args.anchor = anchor
  }
  if (definition.id === 'thesis_red_team') {
    const thesisRef = extractThesisRef(query)
    if (thesisRef !== undefined) args.thesisRef = thesisRef
  }
  if (definition.id === 'thesis_lifecycle') {
    if (/refresh|更新|刷新|财报出来|生命周期/i.test(query)) args.mode = 'REFRESH'
    else if (/create|创建|整理|形式化|formalize/i.test(query)) args.mode = 'CREATE'
  }
  if (definition.id === 'daily_intelligence') {
    const briefType = /晚间|盘后|evening/i.test(query) ? 'evening' : /早盘|盘前|morning/i.test(query) ? 'morning' : undefined
    const tradeDate = query.match(/\b20\d{2}-\d{2}-\d{2}\b/)?.[0]
    if (briefType !== undefined) args.briefType = briefType
    if (tradeDate !== undefined) args.tradeDate = tradeDate
  }
  if (definition.id === 'theme_framework') {
    const name = extractThemeName(query, allowBareThemeName)
    if (name !== undefined) args.name = name
    const definitionMatch = query.match(/(?:定义|范围定义|definition)\s*[:：为是]?\s*([^。\n]{1,300})/iu)?.[1]?.trim()
    if (definitionMatch) args.definition = definitionMatch.slice(0, 300)
  }
  const missingRequiredInputs = definition.requiredInputs.filter((key) => args[key] === undefined)
  if (missingRequiredInputs.length > 0) diagnostics.push(`missing_required_inputs:${missingRequiredInputs.join(',')}`)
  return { arguments: args, missingRequiredInputs, diagnostics, extractedKeys: Object.keys(args).sort() }
}

function scoreWorkflow(definition: WorkflowDefinition, query: string): number {
  const terms = WORKFLOW_KEYWORDS[definition.id]
  if (terms === undefined) return 0
  const text = safeQuery(query)
  const keywordScore = terms.reduce((score, term) => score + (containsTerm(text, term) ? (term.length > 2 ? 1 : 0.5) : 0), 0)
  return keywordScore
}

function selectedSkillIds(registry: ResearchSkillRegistry, definition: WorkflowDefinition): readonly string[] {
  return definition.skillIds.filter((id) => isExecutableResearchSkill(registry, id))
}

function isExecutableResearchSkill(registry: ResearchSkillRegistry, id: string): boolean {
  const skill = registry.get(id)
  if (skill?.kind !== 'research' || skill.enabled !== true) return false
  return skill.origin !== 'canonical' || skill.catalogStatus === 'IMPLEMENTED'
}

const dispatchOutputContract = {
  type: 'object',
  required: ['mode', 'skills', 'entities', 'missingRequiredInputs', 'contextPolicy', 'persistencePolicy', 'rationale'],
  properties: {
    mode: { type: 'string', enum: ['workflow', 'skill_plan', 'free_research'] },
    workflow: { type: 'object', required: ['id', 'confidence', 'arguments'], additionalProperties: false, properties: { id: { type: 'string' }, confidence: { type: 'number', minimum: 0, maximum: 1 }, arguments: { type: 'object', description: 'Must conform exactly to the selected Workflow inputSchema.' } }, description: 'Required only when mode is workflow.' },
    skills: { type: 'array', items: { type: 'object', required: ['id', 'purpose'], additionalProperties: false, properties: { id: { type: 'string' }, purpose: { type: 'string' } } }, description: 'Selected ResearchHub Research Skill IDs and purposes.' },
    entities: { type: 'array', items: { type: 'object', required: ['type', 'value', 'confidence'], additionalProperties: false, properties: { type: { type: 'string' }, value: { type: 'string' }, confidence: { type: 'number', minimum: 0, maximum: 1 } } }, description: 'User-supplied company/security names or unresolved abbreviations; no invented identities.' },
    missingRequiredInputs: { type: 'array', items: { type: 'string' } },
    contextPolicy: { type: 'object', required: ['structuredKnowledge', 'sourceLibrary'], additionalProperties: false, properties: { structuredKnowledge: { type: 'boolean' }, sourceLibrary: { type: 'boolean' } } },
    persistencePolicy: { type: 'object', required: ['writeKnowledge'], additionalProperties: false, properties: { writeKnowledge: { type: 'boolean' } } },
    rationale: { type: 'string' },
  },
} as const

function samePolicy(left: ResearchRequest, right: ResearchDispatchDecision): boolean {
  return left.contextPolicy.structuredKnowledge === right.contextPolicy.structuredKnowledge && left.contextPolicy.sourceLibrary === right.contextPolicy.sourceLibrary && left.persistencePolicy.writeKnowledge === right.persistencePolicy.writeKnowledge
}

function requestedHistoricalCutoff(query: string): string | undefined {
  if (!/(截至|截止|as\s+of|at\s+the\s+end\s+of|历史|当时|截至当日)/iu.test(query)) return undefined
  const dateTime = query.match(/\b(20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2}))\b/iu)
  if (dateTime !== null) {
    const date = dateTime[1]!.slice(0, 10)
    const [year, month, day] = date.split('-').map(Number)
    const calendarDate = new Date(Date.UTC(year!, month! - 1, day!))
    const timestamp = Date.parse(dateTime[1]!)
    if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month! - 1 || calendarDate.getUTCDate() !== day || !Number.isFinite(timestamp)) return undefined
    return new Date(timestamp).toISOString()
  }
  const iso = query.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/u)
  const chinese = query.match(/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/u)
  const yearEnd = query.match(/(20\d{2})\s*年\s*(?:底|末)/u)
  const match = iso ?? chinese
  if (match !== null) {
    const [, y, m, d] = match
    const date = new Date(`${y}-${m!.padStart(2, '0')}-${d!.padStart(2, '0')}T23:59:59.999+08:00`)
    if (date.getUTCFullYear() !== Number(y) || date.getUTCMonth() !== Number(m) - 1 || date.getUTCDate() !== Number(d)) return undefined
    return date.toISOString()
  }
  if (yearEnd !== null) return new Date(`${yearEnd[1]}-12-31T23:59:59.999+08:00`).toISOString()
  return undefined
}

function containsExplicitHistoricalDate(query: string): boolean {
  if (!/(截至|截止|as\s+of|at\s+the\s+end\s+of|历史|当时|截至当日)/iu.test(query)) return false
  return /\b20\d{2}-\d{1,2}-\d{1,2}\b/u.test(query)
    || /20\d{2}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日/u.test(query)
    || /20\d{2}\s*年\s*(?:底|末)/u.test(query)
}

function inputProperties(definition: WorkflowDefinition): Readonly<Record<string, unknown>> {
  return (definition.inputSchema.properties ?? {}) as Readonly<Record<string, unknown>>
}

function normalizedMissingFields(definition: WorkflowDefinition, args: Readonly<Record<string, unknown>>): readonly string[] {
  const validation = validateWorkflowInputSchema(definition.inputSchema, args)
  const rootRequired = definition.requiredInputs.filter((field) => args[field] === undefined)
  const fromSchema = validation.missingFields.map((field) => field.split(/[/.]/u).filter(Boolean)[0] ?? field)
  return [...new Set([...rootRequired, ...fromSchema])].sort()
}

function feedbackFor(status: ResearchDispatchFeedback['status'], definition: WorkflowDefinition, args: Readonly<Record<string, unknown>>, reason: string, missingFields: readonly string[] = []): ResearchDispatchFeedback {
  const labels: Readonly<Record<string, string>> = { symbol: '证券代码', name: '公司或行业名称', fiscalYear: '财年', period: '报告期间', methods: '估值方法', targetFiscalYear: '目标财年', anchor: '事件锚点', thesisRef: '有效的论点引用', mode: 'CREATE 或 REFRESH', formalization: '完整的论点形式化内容', refresh: '论点刷新证据', briefType: '早盘或晚间类型', tradeDate: '交易日' }
  const fieldText = missingFields.map((field) => labels[field] ?? field).join('、')
  const suggestedQuestion = status === 'UNRESOLVED_REFERENCE'
    ? '请提供已有知识库中可核验的规范引用，或先启用对应知识库上下文。'
    : status === 'EXECUTOR_UNAVAILABLE'
      ? '该 Workflow 当前没有可用的执行服务，请稍后重试或联系维护者。'
    : fieldText === ''
      ? '请检查输入并补充可验证的信息。'
      : `请补充${fieldText}。`
  return { status, workflowId: definition.id, missingFields, validatedArguments: { ...args }, reason, suggestedQuestion }
}

function asRecord(value: unknown): Record<string, unknown> | undefined { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined }
function canonicalObjectIsActive(value: Readonly<Record<string, unknown>>, asOf: string): boolean {
  if (value.state === 'superseded' || value.status === 'superseded') return false
  const supersededAt = value.supersededAt
  if (supersededAt !== undefined && supersededAt !== null && (typeof supersededAt !== 'string' || !Number.isFinite(Date.parse(supersededAt)) || Date.parse(supersededAt) <= Date.parse(asOf))) return false
  const lifecycle = asRecord(value.lifecycle)
  if (lifecycle?.status !== 'active') return false
  const validFrom = lifecycle.validFrom
  const validUntil = lifecycle.validUntil
  if (validFrom !== undefined && validFrom !== null && (typeof validFrom !== 'string' || !Number.isFinite(Date.parse(validFrom)) || Date.parse(validFrom) > Date.parse(asOf))) return false
  if (validUntil !== undefined && validUntil !== null && (typeof validUntil !== 'string' || !Number.isFinite(Date.parse(validUntil)) || Date.parse(validUntil) <= Date.parse(asOf))) return false
  return true
}

function explicitUserCompanyExchange(query: string, args: Readonly<Record<string, unknown>>): string | undefined {
  const matches = [...query.matchAll(/(?<!\d)(\d{6})(?:\.(SSE|SH|SZSE|SZ|BSE|BJ))?(?!\d)/giu)]
  if (matches.length === 0 || matches.some((match) => match[1] !== args.symbol)) return undefined
  const inferredExchanges = new Set<string>()
  for (const match of matches) {
    const ticker = match[1]!
    const normalized = normalizeCompanyCandidateIdentity({
      candidateId: 'dispatch-user-provided-company',
      entityType: 'company',
      name: typeof args.name === 'string' ? args.name : ticker,
      evidenceBlockRefs: [],
      reason: 'Explicit security code supplied by the user.',
      semanticFields: { ticker },
    })
    const inferred = normalized.candidate.semanticFields?.exchange
    if (normalized.diagnostics.length > 0 || typeof inferred !== 'string') return undefined
    const suffix = match[2]
    if (suffix !== undefined && normalizeExchange(suffix) !== inferred) return undefined
    if (typeof args.exchange === 'string' && normalizeExchange(args.exchange) !== inferred) return undefined
    inferredExchanges.add(inferred)
  }
  return inferredExchanges.size === 1 ? [...inferredExchanges][0] : undefined
}
function collectCanonicalReferences(value: unknown, refs = new Set<string>()): readonly string[] {
  if (typeof value === 'string' && /^(?:entity|claim|thesis|source|observation):[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value)) refs.add(value)
  else if (Array.isArray(value)) for (const item of value) collectCanonicalReferences(item, refs)
  else if (typeof value === 'object' && value !== null) for (const item of Object.values(value)) collectCanonicalReferences(item, refs)
  return [...refs].sort()
}
function hasCanonicalReference(value: unknown): boolean { return collectCanonicalReferences(value).length > 0 }

function assertSemanticDecision(request: ResearchRequest, decision: ResearchDispatchDecision, workflowRegistry: WorkflowDefinitionRegistry, skillRegistry: ResearchSkillRegistry, explicitWorkflowId?: string): void {
  if (!samePolicy(request, decision)) throw new ApplicationServiceError('invalid_input', 'Semantic dispatch output cannot change ResearchRequest policy')
  if (explicitWorkflowId !== undefined && (decision.mode !== 'workflow' || decision.workflow?.id !== explicitWorkflowId)) throw new ApplicationServiceError('conflict', 'Semantic dispatch output cannot replace the explicit Workflow')
  if (decision.mode === 'workflow') {
    if (!decision.workflow || workflowRegistry.get(decision.workflow.id) === undefined) throw new ApplicationServiceError('not_found', `Semantic dispatch selected an unknown Workflow: ${decision.workflow?.id ?? 'missing'}`)
    const allowed = new Set(workflowRegistry.get(decision.workflow.id)!.skillIds)
    if (decision.skills.some((skill) => !allowed.has(skill.id))) throw new ApplicationServiceError('invalid_input', `Semantic dispatch selected a Skill that is not mapped to Workflow ${decision.workflow.id}`)
    if (decision.skills.some((skill) => !isExecutableResearchSkill(skillRegistry, skill.id))) throw new ApplicationServiceError('invalid_input', `Semantic dispatch selected an unavailable Research Skill for Workflow ${decision.workflow.id}`)
    const definition = workflowRegistry.get(decision.workflow.id)!
    const inputValidation = validateWorkflowInputSchema(definition.inputSchema, decision.workflow.arguments)
    if (!inputValidation.valid) throw new DispatchValidationError('workflow_parameters', inputValidation.fieldPaths.map((path) => `workflow.arguments.${path}`))
  }
  if (decision.mode === 'skill_plan' && (decision.skills.length === 0 || decision.skills.some((skill) => !isExecutableResearchSkill(skillRegistry, skill.id)))) throw new ApplicationServiceError('invalid_input', 'Semantic dispatch selected an unavailable Research Skill')
  if (decision.mode === 'free_research' && decision.skills.length > 0) throw new ApplicationServiceError('invalid_input', 'Free Research cannot include selected Research Skills')
}

export class ResearchDispatchService {
  readonly workflowRegistry: WorkflowDefinitionRegistry
  readonly skillRegistry: ResearchSkillRegistry
  private readonly pendingBundleWrites = new Map<string, Promise<void>>()
  private readonly executionBindings: ReadonlyMap<string, WorkflowExecutionBinding>
  constructor(private readonly options: ResearchDispatchServiceOptions = {}) {
    this.workflowRegistry = options.workflowRegistry ?? createWorkflowDefinitionRegistry()
    this.skillRegistry = options.skillRegistry ?? createResearchSkillRegistry()
    const bindings = new Map<string, WorkflowExecutionBinding>([
      ['company_research', ({ args, runId, callerSignal, writeKnowledge, useStructuredKnowledge, sourceLibraryHits, verifiedIdentityHandoff }) => {
        const service = this.options.researchService
        if (!service) throw new ApplicationServiceError('executor_unavailable', 'Company Research execution service is not configured')
        return service.startResearchCompany({ workflowRunId: runId, symbol: args.symbol as string, name: args.name as string | undefined, exchange: args.exchange as string | undefined, asOf: args.asOf as string | undefined, ...(args.maxSources === undefined ? {} : { maxSources: args.maxSources as number }), writeKnowledge, useStructuredKnowledge, sourceLibraryContext: sourceLibraryHits }, callerSignal, verifiedIdentityHandoff).completion
      }],
      ['industry_research', ({ args, runId, callerSignal, writeKnowledge, useStructuredKnowledge, sourceLibraryHits }) => {
        const service = this.options.researchService
        if (!service) throw new ApplicationServiceError('executor_unavailable', 'Industry Research execution service is not configured')
        return service.startIndustryResearch({ workflowRunId: runId, name: args.name as string, aliases: args.aliases as readonly string[] | undefined, asOf: args.asOf as string | undefined, writeKnowledge, useStructuredKnowledge, sourceLibraryContext: sourceLibraryHits }, callerSignal).completion
      }],
      ['earnings_review', ({ args, runId, callerSignal, writeKnowledge, useStructuredKnowledge, sourceLibraryHits, verifiedIdentityHandoff }) => {
        const service = this.options.researchService
        if (!service) throw new ApplicationServiceError('executor_unavailable', 'Earnings Review execution service is not configured')
        return service.startEarningsReview({ workflowRunId: runId, symbol: args.symbol as string, name: args.name as string | undefined, exchange: args.exchange as string | undefined, asOf: args.asOf as string | undefined, fiscalYear: args.fiscalYear as number, period: args.period as EarningsReviewPeriod, writeKnowledge, useStructuredKnowledge, sourceLibraryContext: sourceLibraryHits }, callerSignal, verifiedIdentityHandoff).completion
      }],
      ['valuation', ({ args, runId, callerSignal, writeKnowledge, useStructuredKnowledge, sourceLibraryHits, verifiedIdentityHandoff }) => {
        const service = this.options.researchService
        if (!service) throw new ApplicationServiceError('executor_unavailable', 'Valuation execution service is not configured')
        return service.startValuation({ workflowRunId: runId, symbol: args.symbol as string, name: args.name as string | undefined, exchange: args.exchange as string | undefined, asOf: args.asOf as string | undefined, methods: args.methods as readonly ValuationMethod[] | undefined, targetFiscalYear: args.targetFiscalYear as number | undefined, writeKnowledge, useStructuredKnowledge, sourceLibraryContext: sourceLibraryHits }, callerSignal, verifiedIdentityHandoff).completion
      }],
      ['event_research', ({ args, runId, callerSignal, writeKnowledge, useStructuredKnowledge, sourceLibraryHits }) => {
        const service = this.options.researchService
        if (!service) throw new ApplicationServiceError('executor_unavailable', 'Event Research execution service is not configured')
        return service.startEventResearch({ workflowRunId: runId, symbol: args.symbol as string, name: args.name as string | undefined, exchange: args.exchange as string | undefined, asOf: args.asOf as string | undefined, anchor: args.anchor as EventAnchor, writeKnowledge, useStructuredKnowledge, sourceLibraryContext: sourceLibraryHits }, callerSignal).completion
      }],
      ['thesis_red_team', ({ args, runId, callerSignal, writeKnowledge, useStructuredKnowledge, sourceLibraryHits }) => {
        const service = this.options.researchService
        if (!service) throw new ApplicationServiceError('executor_unavailable', 'Thesis Red Team execution service is not configured')
        return service.startThesisRedTeam({ workflowRunId: runId, symbol: args.symbol as string, name: args.name as string | undefined, exchange: args.exchange as string | undefined, thesisRef: args.thesisRef as string, lookbackDays: args.lookbackDays as number | undefined, writeKnowledge, useStructuredKnowledge, sourceLibraryContext: sourceLibraryHits }, callerSignal).completion
      }],
      ['daily_intelligence', ({ args, runId, callerSignal, writeKnowledge, useStructuredKnowledge, sourceLibraryHits }) => {
        const service = this.options.dailyIntelligenceService
        if (!service) throw new ApplicationServiceError('executor_unavailable', 'Daily Intelligence execution service is not configured')
        return service.startBrief({ workflowRunId: runId, briefType: args.briefType as 'morning' | 'evening', tradeDate: args.tradeDate as string, writeKnowledge, useStructuredKnowledge, sourceLibraryContext: sourceLibraryHits }, callerSignal).completion
      }],
      ['theme_framework', ({ args, runId, callerSignal }) => {
        const service = this.options.themeFrameworkService
        if (!service) throw new ApplicationServiceError('executor_unavailable', 'Theme Framework execution service is not configured')
        const started = service.start({ workflowRunId: runId, name: args.name as string, ...(typeof args.definition === 'string' ? { definition: args.definition } : {}) }, callerSignal)
        // Keep construction internals private; dispatch results use the same safe candidate projection as the API.
        return started.completion.then(() => service.getReviewCandidate(runId))
      }],
      ['thesis_lifecycle', ({ args, runId, callerSignal }) => {
        const service = this.options.workflowService
        if (!service) throw new ApplicationServiceError('executor_unavailable', 'Workflow status service is not configured for Thesis Lifecycle')
        service.register({ runId, workflowType: 'thesis_lifecycle', objective: `Thesis Lifecycle ${String(args.mode ?? 'research')}` })
        const onAbort = () => { try { service.cancelWorkflow(runId) } catch { /* the run may already be terminal */ } }
        callerSignal?.addEventListener('abort', onAbort, { once: true })
        const completion = service.start(runId, async (signal) => {
          if (signal.aborted || callerSignal?.aborted) throw new ApplicationServiceError('cancelled', `Thesis Lifecycle cancelled: ${runId}`)
          return runThesisLifecycle(args as unknown as ThesisLifecycleInput)
        })
        return completion.finally(() => callerSignal?.removeEventListener('abort', onAbort))
      }],
    ])
    for (const [workflowId, binding] of options.executionBindings ?? []) bindings.set(workflowId, binding)
    this.executionBindings = bindings
  }

  listWorkflowDefinitions(): readonly WorkflowDefinition[] { return this.workflowRegistry.list() }

  async resolveAsync(input: unknown, callerSignal?: AbortSignal): Promise<{ readonly request: ResearchRequest; readonly decision: ResearchDispatchDecision; readonly summary: ResearchExecutionSummary; readonly sourceLibraryHits: readonly SourceLibraryHit[]; readonly resolution: ResearchDispatchResolution }> {
    const request = normalizeResearchRequest(input)
    const sourceLibraryHits = await this.retrieveSourceLibrary(request, callerSignal)
    const runtimeTimestamp = this.runtimeTimestamp()
    const explicit = request.mode.type === 'workflow'
    const definition = explicit ? this.workflowRegistry.get(request.mode.workflowId) : undefined
    if (explicit && definition === undefined) throw new ApplicationServiceError('not_found', `Workflow definition not found: ${request.mode.workflowId}`)
    if (this.options.reasoningExecutor !== undefined) {
      const semantic = await this.resolveWithReasoning(request, definition, sourceLibraryHits, runtimeTimestamp, callerSignal)
      await this.validateSkillMethodologies(semantic.decision)
      return { request, decision: semantic.decision, summary: this.summary(request, semantic.decision, definition), sourceLibraryHits, resolution: semantic.resolution }
    }
    const resolved = this.resolve(request)
    await this.validateSkillMethodologies(resolved.decision)
    let decision = resolved.decision
    const diagnostics = ['reasoning_executor_unconfigured']
    try { decision = this.prepareDecisionArguments(request, decision, runtimeTimestamp) } catch (error) { diagnostics.push(error instanceof Error ? error.message.slice(0, 240) : 'fallback_contract_invalid') }
    return { request, decision, summary: this.summary(request, decision, definition), sourceLibraryHits, resolution: { source: 'deterministic_fallback', attempts: 0, diagnostics } }
  }

  private runtimeTimestamp(): string {
    const now = this.options.clock?.() ?? new Date()
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new ApplicationServiceError('failed', 'Research dispatch Runtime clock returned an invalid timestamp')
    return now.toISOString()
  }

  private prepareDecisionArguments(request: ResearchRequest, decision: ResearchDispatchDecision, runtimeTimestamp: string): ResearchDispatchDecision {
    if (decision.mode !== 'workflow' || decision.workflow === undefined) return decision
    const definition = this.workflowRegistry.get(decision.workflow.id)
    if (definition === undefined) return decision
    const prior = request.workflowArgumentContext?.workflowId === decision.workflow.id ? request.workflowArgumentContext.arguments : undefined
    const args: Record<string, unknown> = { ...(prior ?? {}), ...decision.workflow.arguments }
    const properties = inputProperties(definition)
    const cutoff = requestedHistoricalCutoff(request.query)
    if (Object.hasOwn(properties, 'asOf')) {
      if (containsExplicitHistoricalDate(request.query) && (cutoff === undefined || !Number.isFinite(Date.parse(cutoff)) || Date.parse(cutoff) >= Date.parse(runtimeTimestamp))) throw new DispatchValidationError('workflow_parameters', ['workflow.arguments.asOf'])
      if (cutoff !== undefined) args.asOf = cutoff
      else if (Object.hasOwn(args, 'asOf')) throw new DispatchValidationError('workflow_parameters', ['workflow.arguments.asOf'])
    }
    if (definition.id === 'thesis_lifecycle') {
      const formalization = asRecord(args.formalization)
      if (formalization !== undefined && formalization.asOf === undefined) args.formalization = { ...formalization, asOf: runtimeTimestamp }
      const expectationGap = asRecord(args.expectationGap)
      if (expectationGap !== undefined && expectationGap.asOf === undefined) args.expectationGap = { ...expectationGap, asOf: runtimeTimestamp }
      const catalystMap = asRecord(args.catalystMap)
      if (catalystMap !== undefined && catalystMap.asOf === undefined) args.catalystMap = { ...catalystMap, asOf: runtimeTimestamp }
      const refresh = asRecord(args.refresh)
      if (refresh !== undefined && refresh.currentAsOf === undefined) args.refresh = { ...refresh, currentAsOf: runtimeTimestamp }
    }
    const validation = validateWorkflowInputSchema(definition.inputSchema, args)
    if (!validation.valid) throw new DispatchValidationError('workflow_parameters', validation.fieldPaths.map((path) => `workflow.arguments.${path}`))
    const missingRequiredInputs = normalizedMissingFields(definition, args)
    return validateResearchDispatchDecision({ ...decision, workflow: { ...decision.workflow, arguments: args }, missingRequiredInputs, rationale: decision.rationale })
  }

  resolve(input: unknown): { readonly request: ResearchRequest; readonly decision: ResearchDispatchDecision; readonly summary: ResearchExecutionSummary } {
    const request = normalizeResearchRequest(input)
    const explicit = request.mode.type === 'workflow'
    const definition = explicit ? this.workflowRegistry.get(request.mode.workflowId) : undefined
    if (explicit && definition === undefined) throw new ApplicationServiceError('not_found', `Workflow definition not found: ${request.mode.workflowId}`)
    if (!explicit) {
      const directSkill = this.bestSkill(request.query)
      if (directSkill !== undefined) {
        const decision = validateResearchDispatchDecision({ mode: 'skill_plan', skills: [{ id: directSkill.id, purpose: directSkill.purpose ?? directSkill.whenToUse }], entities: this.entities(request.query), missingRequiredInputs: [], contextPolicy: request.contextPolicy, persistencePolicy: request.persistencePolicy, rationale: `Matched one narrow Research Skill by semantic intent: ${directSkill.id}.` })
        return { request, decision, summary: this.summary(request, decision) }
      }
    }
    const routedDefinition = definition ?? this.bestWorkflow(request.query)
    if (routedDefinition !== undefined) {
      const extracted = extractWorkflowArguments(routedDefinition, request.query, explicit && routedDefinition.id === 'theme_framework')
      const decision = validateResearchDispatchDecision({ mode: 'workflow', workflow: { id: routedDefinition.id, confidence: explicit ? 1 : Math.min(1, 0.5 + scoreWorkflow(routedDefinition, request.query) / 10), arguments: extracted.arguments }, skills: selectedSkillIds(this.skillRegistry, routedDefinition).map((id) => ({ id, purpose: this.skillRegistry.get(id)?.purpose ?? 'selected by the authoritative Workflow definition' })), entities: this.entities(request.query), missingRequiredInputs: extracted.missingRequiredInputs, contextPolicy: request.contextPolicy, persistencePolicy: request.persistencePolicy, rationale: explicit ? 'User-selected Workflow has precedence over automatic routing.' : `Matched existing Workflow definition ${routedDefinition.id}.` })
      return { request, decision, summary: this.summary(request, decision, routedDefinition) }
    }
    if (explicit) throw new ApplicationServiceError('not_found', `Workflow definition not found: ${request.mode.workflowId}`)
    const decision = validateResearchDispatchDecision({ mode: 'free_research', skills: [], entities: this.entities(request.query), missingRequiredInputs: [], contextPolicy: request.contextPolicy, persistencePolicy: request.persistencePolicy, rationale: 'No suitable Workflow or enabled Research Skill matched; continue as Free Research.' })
    return { request, decision, summary: this.summary(request, decision) }
  }

  start(input: unknown, callerSignal?: AbortSignal): ResearchDispatchStart {
    const resolved = this.resolve(input)
    const prepared = this.prepareDecisionArguments(resolved.request, resolved.decision, this.runtimeTimestamp())
    const summary = this.summary(resolved.request, prepared, prepared.workflow === undefined ? undefined : this.workflowRegistry.get(prepared.workflow.id))
    const resolution = { source: 'deterministic_fallback' as const, attempts: 0, diagnostics: ['synchronous_compatibility_path'] }
    if (prepared.mode === 'workflow' && prepared.workflow !== undefined) {
      const definition = this.workflowRegistry.get(prepared.workflow.id)!
      if (Object.hasOwn(inputProperties(definition), 'symbol') || hasCanonicalReference(prepared.workflow.arguments)) {
        return { ...resolved, decision: prepared, summary, status: 'unresolved_reference', feedback: feedbackFor('UNRESOLVED_REFERENCE', definition, prepared.workflow.arguments, 'Synchronous dispatch cannot verify company or canonical Knowledge references; use the asynchronous ResearchDispatch path.'), sourceLibraryHits: [], resolution }
      }
    }
    return this.startResolved({ ...resolved, decision: prepared, summary }, callerSignal, [], resolution)
  }

  async startAsync(input: unknown, callerSignal?: AbortSignal, serverOwnedRunId?: string, correctedObjectQuery?: string): Promise<ResearchDispatchStart> {
    validateServerOwnedRunId(serverOwnedRunId)
    const request = normalizeResearchRequest(input)
    const selectedDefinition = request.mode.type === 'workflow' ? this.workflowRegistry.get(request.mode.workflowId) : this.bestWorkflow(request.query)
    if (selectedDefinition !== undefined && Object.hasOwn(inputProperties(selectedDefinition), 'asOf') && containsExplicitHistoricalDate(request.query)) {
      const cutoff = requestedHistoricalCutoff(request.query)
      const runtimeTimestamp = this.runtimeTimestamp()
      const invalidDate = cutoff === undefined || !Number.isFinite(Date.parse(cutoff))
      const futureDate = cutoff !== undefined && Date.parse(cutoff) >= Date.parse(runtimeTimestamp)
      if (invalidDate || futureDate) {
        const resolved = this.resolve(request)
        const reason = invalidDate
          ? 'The explicit historical cutoff is not a valid calendar date.'
          : 'The explicit historical cutoff must be earlier than the injected Runtime clock.'
        const feedback = feedbackFor('INVALID_INPUT', selectedDefinition, resolved.decision.workflow?.arguments ?? {}, reason)
        return { ...resolved, status: 'invalid_input', feedback, resolution: { source: 'deterministic_fallback', attempts: 0, diagnostics: [reason] } }
      }
    }
    let resolved: Awaited<ReturnType<ResearchDispatchService['resolveAsync']>>
    try { resolved = await this.resolveAsync(input, callerSignal) } catch (error) {
      if (!(error instanceof DispatchSemanticError)) throw error
      const fallback = this.resolve(request)
      const definition = selectedDefinition ?? this.workflowRegistry.get('company_research')!
      const unavailable = error.category === 'model_call' || error.category === 'timeout'
      return { ...fallback, status: unavailable ? 'executor_unavailable' : 'invalid_input', sourceLibraryHits: [], resolution: error.resolution,
        feedback: feedbackFor(unavailable ? 'EXECUTOR_UNAVAILABLE' : 'INVALID_INPUT', definition, {}, error.resolution.diagnostics.join('; ')) }
    }
    const objectResolution = await this.resolveObjectClarification(resolved, callerSignal, correctedObjectQuery)
    if (objectResolution?.clarification || objectResolution?.status === 'unresolved_reference') return objectResolution
    if (objectResolution) resolved = { ...resolved, decision: objectResolution.decision, summary: objectResolution.summary }
    const verified = await this.verifyWorkflowReferences(resolved.request, resolved.decision, callerSignal)
    if (verified.feedback !== undefined) return { ...resolved, status: verified.failureStatus ?? 'unresolved_reference', feedback: verified.feedback }
    const decision = verified.decision ?? resolved.decision
    const summary = this.summary(resolved.request, decision, decision.workflow === undefined ? undefined : this.workflowRegistry.get(decision.workflow.id))
    const started = this.startResolved({ ...resolved, decision, summary }, callerSignal, resolved.sourceLibraryHits, resolved.resolution, verified.verifiedIdentity, serverOwnedRunId)
    if (started.status === 'needs_input') return this.clarificationResult(started, 'missing_input', started.feedback?.missingFields ?? [], started.feedback?.suggestedQuestion ?? '请补充研究信息。')
    return started
  }

  private clarificationResult(original: ResearchDispatchStart, kind: ResearchDispatchClarification['kind'], missingFields: readonly string[], question: string, extra: Partial<ResearchDispatchClarification> = {}): ResearchDispatchStart {
    return { ...original, status: 'needs_clarification', clarification: { confirmationId: randomUUID(), expiresAt: new Date(Date.parse(this.runtimeTimestamp()) + 15 * 60_000).toISOString(), kind, query: original.request.query, ...(original.decision.workflow ? { workflowId: original.decision.workflow.id } : {}), candidates: [], missingFields, question, ...extra } }
  }

  private async resolveObjectClarification(resolved: Awaited<ReturnType<ResearchDispatchService['resolveAsync']>>, signal?: AbortSignal, correctedObjectQuery?: string): Promise<ResearchDispatchStart | undefined> {
    const resolver = this.options.securityIdentityResolver
    const workflowId = resolved.decision.workflow?.id
    if (!resolver || (workflowId !== undefined && !Object.hasOwn(inputProperties(this.workflowRegistry.get(workflowId)!), 'symbol'))) return undefined
    const args = resolved.decision.workflow?.arguments ?? {}
    const suppliedSymbol = extractSymbol(resolved.request.query).symbol
    if (suppliedSymbol || typeof resolved.request.workflowArgumentContext?.arguments.symbol === 'string') return undefined
    const entity = resolved.decision.entities.find((item) => /company|security|stock|公司|证券/iu.test(item.type))?.value
    if (!workflowId && !entity && !/报告|研报|report/iu.test(resolved.request.query) && !/^[a-z]{2,30}$/iu.test(resolved.request.query.trim())) return undefined
    const words = [...resolved.request.query.matchAll(/(?<![A-Za-z])([a-z]{2,30})(?![A-Za-z])/giu)].map((match) => match[1]!)
    const abbreviation = entity && /^[a-z]{2,30}$/iu.test(entity) && resolved.request.query.toLowerCase().includes(entity.toLowerCase()) ? entity
      : words.filter((word) => !['write', 'report', 'research', 'company', 'stock', 'please', 'for', 'the', 'on', 'about', 'of', 'as', 'valuation', 'earnings', 'review', 'sse', 'szse', 'bse', 'sh', 'sz', 'bj'].includes(word.toLowerCase())).at(-1)
    const reportObject = resolved.request.query.match(/(?:写(?:一篇|一份)?|研究|分析)\s*(.+?)(?:的)?(?:报告|研报)\s*$/u)?.[1]?.replace(/的$/u, '').trim()
    const userEntity = entity && resolved.request.query.includes(entity) ? entity : undefined
    const objectQuery = correctedObjectQuery ?? abbreviation ?? reportObject ?? userEntity ?? entity ?? (typeof args.name === 'string' ? args.name : undefined) ?? (/^[\p{Script=Han}a-z]{2,30}$/iu.test(resolved.request.query) ? resolved.request.query : undefined)
    if (!objectQuery) return undefined
    const base: ResearchDispatchStart = { ...resolved, status: 'needs_clarification' }
    let directory: Awaited<ReturnType<SecurityIdentityResolver['searchCandidates']>>
    try { directory = await resolver.searchCandidates(objectQuery, signal) } catch (error) {
      if (signal?.aborted) throw new ApplicationServiceError('cancelled', 'Object lookup cancelled')
      // Legacy test/custom resolvers lacking a snapshot loader still use the exact gate.
      if (error instanceof Error && error.message === 'SECURITY_DIRECTORY_LOADER_UNCONFIGURED' && !abbreviation && workflowId !== undefined) return undefined
      const definition = this.workflowRegistry.get(workflowId ?? 'company_research')!
      return { ...base, status: 'unresolved_reference', feedback: feedbackFor('UNRESOLVED_REFERENCE', definition, args, 'SECURITY_DIRECTORY_UNAVAILABLE: 当前可信证券目录不可用，无法确认研究对象。') }
    }
    if (directory.candidates.length === 0) return this.clarificationResult(base, 'security_selection', ['security'], '可信证券目录中没有匹配对象，请提供其他名称或证券代码。', { ...directory, query: objectQuery })
    const exact = directory.candidates.length === 1 && ['exact_name', 'exact_code'].includes(directory.candidates[0]!.matchKind)
    if (!exact) return this.clarificationResult(base, 'security_selection', ['security'], '请选择要研究的证券。', { ...directory, query: objectQuery })
    const candidate = directory.candidates[0]!
    if (!workflowId && !/报告|研报|report/iu.test(resolved.request.query) && resolved.request.query.trim().toLowerCase() !== objectQuery.trim().toLowerCase()) return undefined
    const definition = this.workflowRegistry.get(workflowId ?? 'company_research')!
    const decision: ResearchDispatchDecision = { ...resolved.decision, mode: 'workflow', workflow: { id: definition.id, confidence: resolved.decision.workflow?.confidence ?? 1, arguments: { ...args, name: candidate.name, symbol: candidate.symbol, exchange: candidate.exchange } } }
    const updated = { ...base, decision, summary: this.summary(resolved.request, decision, definition) }
    if (resolved.request.query.trim().toLowerCase() === objectQuery.trim().toLowerCase()) return this.clarificationResult(updated, 'research_goal', ['research_goal'], '希望研究该公司的哪些方面，或是否需要完整公司报告？')
    return updated
  }

  async confirmAsync(original: ResearchDispatchStart, input: { readonly confirmationId: string; readonly candidateId?: string; readonly directoryVersion?: string; readonly clarificationText?: string }, signal?: AbortSignal, serverOwnedRunId?: string): Promise<ResearchDispatchStart> {
    validateServerOwnedRunId(serverOwnedRunId)
    const clarification = original.clarification
    if (!clarification || clarification.confirmationId !== input.confirmationId) throw new ApplicationServiceError('invalid_input', 'Clarification confirmation is no longer current')
    if (signal?.aborted) throw new ApplicationServiceError('cancelled', 'Clarification cancelled')
    if (clarification.expiresAt && Date.parse(clarification.expiresAt) <= Date.parse(this.runtimeTimestamp())) {
      const directory = clarification.kind === 'security_selection' && this.options.securityIdentityResolver
        ? await this.options.securityIdentityResolver.searchCandidates(clarification.query, signal, true) : undefined
      return this.clarificationResult(original, clarification.kind, clarification.missingFields, '此前的确认已过期，请重新确认。', { query: clarification.query, ...(directory ?? { candidates: clarification.candidates }), ...(clarification.workflowId ? { workflowId: clarification.workflowId } : {}) })
    }
    if (clarification.kind === 'security_selection') {
      if (!input.candidateId && input.clarificationText?.trim()) {
        const correctedObject = input.clarificationText.trim()
        const correctedQuery = original.request.query.split(clarification.query).join(correctedObject)
        const wasBareObject = original.request.query.trim().toLowerCase() === clarification.query.trim().toLowerCase()
        return this.startAsync({ ...original.request, query: wasBareObject ? correctedObject : `${correctedQuery}\n用户更正研究对象：${correctedObject}` }, signal, serverOwnedRunId, correctedObject)
      }
      if (!this.options.securityIdentityResolver) throw new ApplicationServiceError('failed', 'Security directory unavailable')
      const directory = await this.options.securityIdentityResolver.searchCandidates(clarification.query, signal, true)
      if (directory.directoryVersion !== clarification.directoryVersion || input.directoryVersion !== clarification.directoryVersion) return this.clarificationResult(original, 'security_selection', ['security'], '证券目录已更新，请重新选择研究对象。', { ...directory, query: clarification.query })
      const selected = directory.candidates.find((item) => item.candidateId === input.candidateId)
      if (!selected) throw new ApplicationServiceError('invalid_input', 'Selected security is not in the verified candidate set')
      const definition = this.workflowRegistry.get(clarification.workflowId ?? 'company_research')!
      const args = { ...original.decision.workflow?.arguments, name: selected.name, symbol: selected.symbol, exchange: selected.exchange }
      const decision: ResearchDispatchDecision = { ...original.decision, mode: 'workflow', workflow: { id: definition.id, confidence: 1, arguments: args } }
      const selectedOriginal = { ...original, decision, summary: this.summary(original.request, decision, definition) }
      if (original.request.query.trim().toLowerCase() === clarification.query.trim().toLowerCase() && !input.clarificationText?.trim()) return this.clarificationResult(selectedOriginal, 'research_goal', ['research_goal'], '希望研究该公司的哪些方面，或是否需要完整公司报告？')
      return this.startConfirmed(selectedOriginal, input.clarificationText, signal, serverOwnedRunId)
    }
    if (!input.clarificationText?.trim()) throw new ApplicationServiceError('invalid_input', 'Clarification text is required')
    return this.startConfirmed(original, input.clarificationText, signal, serverOwnedRunId)
  }

  private async startConfirmed(original: ResearchDispatchStart, text: string | undefined, signal?: AbortSignal, serverOwnedRunId?: string): Promise<ResearchDispatchStart> {
    const workflow = original.decision.workflow
    if (!workflow) return this.startAsync({ ...original.request, query: `${original.request.query}\n${text ?? ''}` }, signal, serverOwnedRunId)
    if (original.clarification?.kind === 'research_goal' && text) {
      const identity = workflow.arguments
      const request: ResearchRequest = { ...original.request, query: `${original.request.query}\n已确认对象：${String(identity.name)} (${String(identity.symbol)}.${String(identity.exchange)})\n用户研究目标：${text}`, mode: { type: 'free_research' }, workflowArgumentContext: undefined }
      let resolved: Awaited<ReturnType<ResearchDispatchService['resolveAsync']>>
      try { resolved = await this.resolveAsync(request, signal) } catch (error) {
        if (!(error instanceof DispatchSemanticError)) throw error
        const unavailable = error.category === 'model_call' || error.category === 'timeout'
        return { ...original, request, status: unavailable ? 'executor_unavailable' : 'invalid_input', clarification: undefined, resolution: error.resolution, feedback: feedbackFor(unavailable ? 'EXECUTOR_UNAVAILABLE' : 'INVALID_INPUT', this.workflowRegistry.get(workflow.id)!, {}, error.resolution.diagnostics.join('; ')) }
      }
      let decision = resolved.decision
      const target = decision.workflow && this.workflowRegistry.get(decision.workflow.id)
      if (target && Object.hasOwn(inputProperties(target), 'symbol')) decision = { ...decision, workflow: { ...decision.workflow!, arguments: { ...decision.workflow!.arguments, symbol: identity.symbol, name: identity.name, exchange: identity.exchange } } }
      const verified = await this.verifyWorkflowReferences(request, decision, signal)
      if (verified.feedback) return { ...resolved, status: verified.failureStatus ?? 'unresolved_reference', feedback: verified.feedback }
      decision = verified.decision ?? decision
      const result = this.startResolved({ request, decision, summary: this.summary(request, decision, target) }, signal, resolved.sourceLibraryHits, resolved.resolution, verified.verifiedIdentity, serverOwnedRunId)
      return result.status === 'needs_input' ? this.clarificationResult(result, 'missing_input', result.feedback?.missingFields ?? [], result.feedback?.suggestedQuestion ?? '请补充研究信息。') : result
    }
    const request: ResearchRequest = { ...original.request, query: `${original.request.query}${text ? `\n用户补充：${text}` : ''}`, mode: { type: 'workflow', workflowId: workflow.id }, workflowArgumentContext: { workflowId: workflow.id, arguments: workflow.arguments } }
    // Re-extract semantic fields only for a follow-up answer; a selected object alone reuses the original decision.
    if (text) return this.startAsync(request, signal, serverOwnedRunId)
    const decision = this.prepareDecisionArguments(request, original.decision, this.runtimeTimestamp())
    const verified = await this.verifyWorkflowReferences(request, decision, signal)
    if (verified.feedback) return { ...original, request, decision, status: verified.failureStatus ?? 'unresolved_reference', feedback: verified.feedback }
    const finalDecision = verified.decision ?? decision
    const result = this.startResolved({ request, decision: finalDecision, summary: this.summary(request, finalDecision, this.workflowRegistry.get(workflow.id)) }, signal, original.sourceLibraryHits ?? [], original.resolution ?? { source: 'reasoning_executor', attempts: 0, diagnostics: [] }, verified.verifiedIdentity, serverOwnedRunId)
    return result.status === 'needs_input' ? this.clarificationResult(result, 'missing_input', result.feedback?.missingFields ?? [], result.feedback?.suggestedQuestion ?? '请补充研究信息。') : result
  }

  /** Starts a product-form-selected Workflow with its explicit validated fields, without a semantic routing round-trip. */
  async startExplicitWorkflow(input: unknown, callerSignal?: AbortSignal): Promise<ResearchDispatchStart> {
    const request = normalizeResearchRequest(input)
    if (request.mode.type !== 'workflow' || request.workflowArgumentContext?.workflowId !== request.mode.workflowId) throw new ApplicationServiceError('invalid_input', 'Explicit Workflow mode and argument context must identify the same Workflow')
    const definition = this.workflowRegistry.get(request.mode.workflowId)
    if (definition === undefined) throw new ApplicationServiceError('not_found', `Workflow definition not found: ${request.mode.workflowId}`)
    const args = { ...request.workflowArgumentContext.arguments }
    const validation = validateWorkflowInputSchema(definition.inputSchema, args)
    if (!validation.valid) throw new ApplicationServiceError('invalid_input', `Workflow ${definition.id} arguments are invalid: ${validation.errors.filter((message) => !message.includes('is required')).join('; ') || 'required input is missing'}`)
    const missingRequiredInputs = normalizedMissingFields(definition, args)
    if (missingRequiredInputs.length > 0) throw new ApplicationServiceError('invalid_input', `Workflow ${definition.id} required inputs are missing: ${missingRequiredInputs.join(', ')}`)
    await this.validateSkillMethodologies(validateResearchDispatchDecision({ mode: 'workflow', workflow: { id: definition.id, confidence: 1, arguments: args }, skills: selectedSkillIds(this.skillRegistry, definition).map((id) => ({ id, purpose: this.skillRegistry.get(id)?.purpose ?? 'selected by the authoritative Workflow definition' })), entities: this.entities(request.query), missingRequiredInputs: [], contextPolicy: request.contextPolicy, persistencePolicy: request.persistencePolicy, rationale: 'The user selected this registered Workflow and supplied its bounded product form inputs.' }))
    const decision = validateResearchDispatchDecision({ mode: 'workflow', workflow: { id: definition.id, confidence: 1, arguments: args }, skills: selectedSkillIds(this.skillRegistry, definition).map((id) => ({ id, purpose: this.skillRegistry.get(id)?.purpose ?? 'selected by the authoritative Workflow definition' })), entities: this.entities(request.query), missingRequiredInputs: [], contextPolicy: request.contextPolicy, persistencePolicy: request.persistencePolicy, rationale: 'The user selected this registered Workflow and supplied its bounded product form inputs.' })
    const verified = await this.verifyWorkflowReferences(request, decision, callerSignal)
    if (verified.feedback !== undefined) return { request, decision, summary: this.summary(request, decision, definition), status: verified.failureStatus ?? 'unresolved_reference', feedback: verified.feedback, sourceLibraryHits: [], resolution: { source: 'deterministic_fallback', attempts: 0, diagnostics: [] } }
    const verifiedDecision = verified.decision ?? decision
    const summary = this.summary(request, verifiedDecision, definition)
    return this.startResolved({ request, decision: verifiedDecision, summary }, callerSignal, [], { source: 'deterministic_fallback', attempts: 0, diagnostics: ['explicit_product_workflow_selection'] }, verified.verifiedIdentity)
  }

  private async verifyWorkflowReferences(request: ResearchRequest, decision: ResearchDispatchDecision, callerSignal?: AbortSignal): Promise<{ readonly decision?: ResearchDispatchDecision; readonly feedback?: ResearchDispatchFeedback; readonly failureStatus?: 'invalid_input'; readonly verifiedIdentity?: VerifiedSecurityIdentity }> {
    if (decision.mode !== 'workflow' || decision.workflow === undefined) return {}
    const definition = this.workflowRegistry.get(decision.workflow.id)
    if (definition === undefined) return {}
    const args = decision.workflow.arguments
    const targetIdentityWorkflow = ['company_research', 'valuation', 'earnings_review'].includes(definition.id)
    let trustedIdentity: Awaited<ReturnType<SecurityIdentityResolver['resolve']>> | undefined
    if (targetIdentityWorkflow && this.options.securityIdentityResolver !== undefined) {
      const extractedIdentity = extractSymbol(request.query)
      const userEntity = decision.entities.find((entity) => /company|security|公司|证券/iu.test(entity.type) && /\p{Script=Han}/u.test(entity.value) && request.query.includes(entity.value))?.value
      const candidateName = userNameBesideCode(request.query) ?? userEntity ?? (typeof args.name === 'string' ? args.name : undefined)
      const candidateSymbol = extractedIdentity.symbol ?? (typeof args.symbol === 'string' ? args.symbol : undefined)
      const candidateExchange = extractedIdentity.exchange ?? (typeof args.exchange === 'string' ? args.exchange : undefined)
      const identityAsOf = typeof args.asOf === 'string' ? args.asOf : this.runtimeTimestamp()
      trustedIdentity = await this.options.securityIdentityResolver.resolve({
        workflowId: definition.id as 'company_research' | 'valuation' | 'earnings_review',
        ...(candidateName === undefined ? {} : { name: candidateName }),
        ...(candidateSymbol === undefined ? {} : { symbol: candidateSymbol }),
        ...(candidateExchange === undefined ? {} : { exchange: candidateExchange }),
        asOf: identityAsOf,
        historical: args.asOf !== undefined || containsExplicitHistoricalDate(request.query),
        query: request.query,
        allowKnowledgeLookup: request.contextPolicy.structuredKnowledge,
      }, callerSignal)
      if (trustedIdentity.status !== 'VERIFIED') {
        const reason = `${trustedIdentity.status}: ${trustedIdentity.reason} ${trustedIdentity.diagnostics.join(' ')}`.trim()
        const validationArgs = { ...args, ...(candidateSymbol === undefined ? {} : { symbol: candidateSymbol }) }
        return { feedback: feedbackFor('UNRESOLVED_REFERENCE', definition, validationArgs, reason, candidateSymbol === undefined ? ['symbol'] : []) }
      }
    }
    const validation = validateWorkflowInputSchema(definition.inputSchema, args)
    if (!validation.valid || normalizedMissingFields(definition, args).length > 0) {
      if (!trustedIdentity) return {}
    }
    const referenceCandidates = collectCanonicalReferences(args)
    const hasCompany = Object.hasOwn(inputProperties(definition), 'symbol')
    if (!hasCompany && referenceCandidates.length === 0) return {}
    const companyResearch = definition.id === 'company_research'
    const normalizedArgs: Record<string, unknown> = { ...args }
    if (trustedIdentity?.status === 'VERIFIED') {
      normalizedArgs.symbol = trustedIdentity.identity.symbol
      normalizedArgs.name = trustedIdentity.identity.verifiedName
      normalizedArgs.exchange = trustedIdentity.identity.exchange
    }
    if (trustedIdentity?.status !== 'VERIFIED' && typeof args.exchange === 'string') normalizedArgs.exchange = normalizeExchange(args.exchange)
    const userProvidedExchange = trustedIdentity?.status !== 'VERIFIED' && companyResearch && referenceCandidates.length === 0 ? explicitUserCompanyExchange(request.query, normalizedArgs) : undefined
    if (trustedIdentity?.status !== 'VERIFIED' && companyResearch && userProvidedExchange !== undefined) normalizedArgs.exchange = userProvidedExchange
    const finalizeArguments = (candidateArgs: Readonly<Record<string, unknown>>) => {
      const finalValidation = validateWorkflowInputSchema(definition.inputSchema, candidateArgs)
      if (!finalValidation.valid) return { feedback: feedbackFor('INVALID_INPUT', definition, candidateArgs, finalValidation.errors.join('; ')), failureStatus: 'invalid_input' as const }
      return { decision: validateResearchDispatchDecision({ ...decision, workflow: { ...decision.workflow!, arguments: candidateArgs }, missingRequiredInputs: normalizedMissingFields(definition, candidateArgs) }) }
    }
    const finalizeVerifiedArguments = (candidateArgs: Readonly<Record<string, unknown>>) => {
      const finalized = finalizeArguments(candidateArgs)
      return trustedIdentity?.status === 'VERIFIED' && finalized.decision !== undefined
        ? { ...finalized, verifiedIdentity: trustedIdentity.identity }
        : finalized
    }
    if (trustedIdentity?.status === 'VERIFIED' && referenceCandidates.length === 0) return finalizeVerifiedArguments(normalizedArgs)
    if (companyResearch && referenceCandidates.length === 0 && userProvidedExchange !== undefined && !request.contextPolicy.structuredKnowledge) return finalizeVerifiedArguments(normalizedArgs)
    if (!request.contextPolicy.structuredKnowledge) return { feedback: feedbackFor('UNRESOLVED_REFERENCE', definition, normalizedArgs, 'This Workflow requires trusted Knowledge context to verify the company or canonical references, but structured Knowledge access is disabled.') }
    if (this.options.mountedKnowledgeBaseRoot === undefined) {
      if (companyResearch && referenceCandidates.length === 0 && userProvidedExchange !== undefined) return finalizeVerifiedArguments(normalizedArgs)
      return { feedback: feedbackFor('UNRESOLVED_REFERENCE', definition, normalizedArgs, 'No mounted Knowledge Base is available to verify the requested company or canonical references.') }
    }
    let assets: Awaited<ReturnType<typeof readCanonicalV04Assets>>
    try {
      const handle = await new KnowledgeBaseRegistry().mount(this.options.mountedKnowledgeBaseRoot)
      if (handle.schemaVersion !== '0.4') {
        if (companyResearch && referenceCandidates.length === 0 && userProvidedExchange !== undefined) return finalizeVerifiedArguments(normalizedArgs)
        return { feedback: feedbackFor('UNRESOLVED_REFERENCE', definition, normalizedArgs, 'Trusted dispatch identity checks currently require a mounted Schema 0.4 Knowledge Base.') }
      }
      assets = await readCanonicalV04Assets(handle.rootRef)
    } catch (error) {
      if (companyResearch && referenceCandidates.length === 0 && userProvidedExchange !== undefined) return finalizeVerifiedArguments(normalizedArgs)
      return { feedback: feedbackFor('UNRESOLVED_REFERENCE', definition, normalizedArgs, `Mounted Knowledge could not be read for verification (${error instanceof Error ? error.name : 'read failed'}).`) }
    }
    const objects = assets.objects.map((item) => item.value as unknown as Record<string, unknown>)
    const byId = new Map(objects.filter((item) => typeof item.id === 'string').map((item) => [item.id as string, item]))
    const identityAsOf = this.runtimeTimestamp()
    if (hasCompany) {
      const symbol = typeof normalizedArgs.symbol === 'string' ? normalizedArgs.symbol : undefined
      const name = typeof normalizedArgs.name === 'string' ? normalizedArgs.name.trim().toLocaleLowerCase() : undefined
      const query = request.query.toLocaleLowerCase()
      const companies = objects.filter((item) => item.type === 'company' && canonicalObjectIsActive(item, identityAsOf))
      const mentionedCompanies = companies.filter((item) => [item.name, ...(Array.isArray(item.aliases) ? item.aliases : [])].some((candidate) => typeof candidate === 'string' && candidate.trim().length > 1 && query.includes(candidate.trim().toLocaleLowerCase())))
      const companyMatches = companies
        .filter((item) => (symbol === undefined || item.ticker === symbol) && (normalizedArgs.exchange === undefined || (typeof item.exchange === 'string' && normalizeExchange(item.exchange) === normalizedArgs.exchange)))
        .filter((item) => {
          const names = [item.name, ...(Array.isArray(item.aliases) ? item.aliases : [])].filter((value): value is string => typeof value === 'string').map((value) => value.trim().toLocaleLowerCase())
          return (name === undefined ? symbol !== undefined : names.includes(name)) && (mentionedCompanies.length === 0 || mentionedCompanies.some((mentioned) => mentioned.id === item.id))
        })
      if (companyMatches.length !== 1) {
        if (companyResearch && userProvidedExchange !== undefined && companyMatches.length === 0 && mentionedCompanies.length === 0 && !companies.some((item) => item.ticker === symbol)) return finalizeVerifiedArguments(normalizedArgs)
        const reason = companyMatches.length > 1 ? 'Company identity is ambiguous in canonical Knowledge.' : 'Company name or symbol has no exact canonical Company identity match.'
        return { feedback: feedbackFor('UNRESOLVED_REFERENCE', definition, normalizedArgs, reason, ['symbol']) }
      }
      const company = companyMatches[0]!
      const canonicalName = typeof company.name === 'string' ? company.name : undefined
      const verifiedArgs = { ...normalizedArgs, symbol: company.ticker, ...(canonicalName === undefined ? {} : { name: canonicalName }), ...(typeof company.exchange === 'string' ? { exchange: normalizeExchange(company.exchange) } : {}) }
      const badRefs = referenceCandidates.filter((ref) => byId.get(ref) === undefined)
      if (badRefs.length > 0) return { feedback: feedbackFor('UNRESOLVED_REFERENCE', definition, verifiedArgs, `Canonical reference not found: ${badRefs.join(', ')}`) }
      const inactiveRefs = referenceCandidates.filter((ref) => !canonicalObjectIsActive(byId.get(ref)!, identityAsOf))
      if (inactiveRefs.length > 0) return { feedback: feedbackFor('UNRESOLVED_REFERENCE', definition, verifiedArgs, `Canonical reference is inactive or outside its lifecycle window: ${inactiveRefs.join(', ')}`, inactiveRefs) }
      return finalizeVerifiedArguments(verifiedArgs)
    }
    const badRefs = referenceCandidates.filter((ref) => byId.get(ref) === undefined)
    if (badRefs.length > 0) return { feedback: feedbackFor('UNRESOLVED_REFERENCE', definition, args, `Canonical reference not found: ${badRefs.join(', ')}`, badRefs) }
    const inactiveRefs = referenceCandidates.filter((ref) => !canonicalObjectIsActive(byId.get(ref)!, identityAsOf))
    if (inactiveRefs.length > 0) return { feedback: feedbackFor('UNRESOLVED_REFERENCE', definition, args, `Canonical reference is inactive or outside its lifecycle window: ${inactiveRefs.join(', ')}`, inactiveRefs) }
    return finalizeVerifiedArguments(normalizedArgs)
  }

  private startResolved(resolved: { readonly request: ResearchRequest; readonly decision: ResearchDispatchDecision; readonly summary: ResearchExecutionSummary }, callerSignal: AbortSignal | undefined, sourceLibraryHits: readonly SourceLibraryHit[], resolution: ResearchDispatchResolution, verifiedIdentity?: VerifiedSecurityIdentity, serverOwnedRunId?: string): ResearchDispatchStart {
    const { decision } = resolved
    if (decision.mode === 'workflow' && decision.workflow !== undefined) {
      const definition = this.workflowRegistry.get(decision.workflow.id)
      if (definition === undefined) throw new ApplicationServiceError('not_found', `Workflow definition not found: ${decision.workflow.id}`)
      const validation = validateWorkflowInputSchema(definition.inputSchema, decision.workflow.arguments)
      const missingFields = normalizedMissingFields(definition, decision.workflow.arguments)
      if (!validation.valid) {
        const feedback = feedbackFor('INVALID_INPUT', definition, decision.workflow.arguments, validation.errors.filter((message) => !message.includes('is required')).join('; ') || 'Workflow arguments are invalid')
        return { ...resolved, status: 'invalid_input', feedback, sourceLibraryHits, resolution }
      }
      if (missingFields.length > 0) {
        const feedback = feedbackFor('NEEDS_INPUT', definition, decision.workflow.arguments, `Required fields are missing: ${missingFields.join(', ')}`, missingFields)
        const updatedDecision = validateResearchDispatchDecision({ ...decision, missingRequiredInputs: missingFields })
        const updatedSummary = this.summary(resolved.request, updatedDecision, definition)
        return { ...resolved, decision: updatedDecision, summary: updatedSummary, status: 'needs_input', feedback, sourceLibraryHits, resolution }
      }
    }
    if (decision.mode === 'free_research') { const runId = `free-${randomUUID()}`; this.schedulePendingBundle(resolved.request, decision, resolved.summary, runId, { status: 'free_research_pending', executionBoundary: 'session', selectedSkills: [] }, sourceLibraryHits); return { ...resolved, status: 'free_research', runId, sourceLibraryHits, resolution } }
    if (decision.mode === 'skill_plan') { const runId = `skill-${randomUUID()}`; this.schedulePendingBundle(resolved.request, decision, resolved.summary, runId, { status: 'skill_plan_pending', executionBoundary: 'session', selectedSkills: decision.skills }, sourceLibraryHits); return { ...resolved, status: 'skill_plan', runId, sourceLibraryHits, resolution } }
    const workflow = decision.workflow
    if (workflow === undefined) throw new ApplicationServiceError('failed', 'Validated workflow decision did not include a workflow')
    const definition = this.workflowRegistry.get(workflow.id)
    if (definition === undefined) throw new ApplicationServiceError('not_found', `Workflow definition not found: ${workflow.id}`)
    if (!this.executionBindings.has(definition.id) || this.options.workflowService === undefined) {
      const reason = !this.executionBindings.has(definition.id)
        ? `Workflow ${definition.id} is registered but has no execution binding.`
        : 'Workflow status tracking is not configured for this runtime.'
      const feedback = feedbackFor('EXECUTOR_UNAVAILABLE', definition, workflow.arguments, reason)
      return { ...resolved, status: 'executor_unavailable', feedback, sourceLibraryHits, resolution }
    }
    let started: Promise<unknown>
    const runId = serverOwnedRunId ?? randomUUID()
    try {
      const identityHandoff = verifiedIdentity === undefined ? undefined : createVerifiedSecurityIdentityHandoff({
        workflowId: definition.id as 'company_research' | 'valuation' | 'earnings_review',
        runId,
        ...(typeof workflow.arguments.asOf === 'string' ? { asOf: workflow.arguments.asOf } : {}),
        structuredKnowledge: resolved.request.contextPolicy.structuredKnowledge,
        identity: verifiedIdentity,
      })
      started = this.startWorkflow({ workflowId: definition.id, args: workflow.arguments, runId, ...(callerSignal === undefined ? {} : { callerSignal }), writeKnowledge: resolved.request.persistencePolicy.writeKnowledge, useStructuredKnowledge: resolved.request.contextPolicy.structuredKnowledge, sourceLibraryHits, ...(identityHandoff === undefined ? {} : { verifiedIdentityHandoff: identityHandoff }) })
    } catch (error) {
      if (error instanceof ApplicationServiceError && error.code === 'executor_unavailable') {
        const feedback = feedbackFor('EXECUTOR_UNAVAILABLE', definition, workflow.arguments, error.message)
        return { ...resolved, status: 'executor_unavailable', feedback, sourceLibraryHits, resolution }
      }
      const existing = this.options.workflowService.getWorkflowStatus(runId)
      if (existing === undefined) {
        this.options.workflowService.register({ runId, workflowType: definition.id, objective: definition.label })
        this.options.workflowService.markFailure(runId, 'Workflow failed during execution startup.')
      }
      started = Promise.reject(error)
    }
    const workflowView = this.options.workflowService.getWorkflowStatus(runId)
    if (workflowView !== undefined) {
      this.options.workflowService.setExecutionResult(runId, projectResearchExecutionResult({ workflowId: definition.id, workflow: workflowView, bundleStatus: this.options.bundleStore === undefined ? 'unavailable' : 'pending' }))
    }
    const completion = started.then(async (result) => {
      await this.persistDispatchResult(resolved.request, decision, resolved.summary, definition.id, runId, result, sourceLibraryHits)
      return result
    }, async (error) => {
      await this.persistDispatchFailure(resolved.request, decision, resolved.summary, definition.id, runId, error, sourceLibraryHits)
      throw error
    })
    completion.catch(() => undefined)
    return { ...resolved, status: 'started', runId, sourceLibraryHits, resolution, ...(verifiedIdentity === undefined ? {} : { verifiedSecurityIdentity: verifiedIdentity }), ...(this.options.workflowService.getWorkflowStatus(runId) === undefined ? {} : { workflow: this.options.workflowService.getWorkflowStatus(runId) }), completion }
  }

  async getBundle(bundleId: string): Promise<ResearchBundle | undefined> { return this.options.bundleStore?.get(bundleId) }
  async listBundles(limit?: number): Promise<readonly ResearchBundle[]> { return this.options.bundleStore?.list(limit) ?? [] }
  async getBundleForRun(runId: string): Promise<ResearchBundle | undefined> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(runId)) throw new ApplicationServiceError('invalid_input', 'runId is invalid')
    await this.pendingBundleWrites.get(runId)
    const bundle = await this.getBundle(`research-bundle-${runId}`)
    if (bundle !== undefined && (bundle.workflowRunId !== runId || bundle.bundleId !== `research-bundle-${runId}`)) throw new ApplicationServiceError('failed', 'ResearchBundle identity does not match the requested run')
    return bundle
  }

  async getSessionResearchContext(runId: string): Promise<ResearchSessionContext | undefined> {
    const bundle = await this.getBundleForRun(runId)
    if (bundle === undefined) return undefined
    const selectedSkills: LoadedResearchSkill[] = []
    for (const skill of bundle.decision.skills) {
      const definition = this.skillRegistry.get(skill.id)
      if (definition === undefined) throw new ApplicationServiceError('not_found', `Research Skill is no longer registered: ${skill.id}`)
      selectedSkills.push(await loadResearchSkillMethodology(definition))
    }
    return {
      selectedSkills,
      sourceLibraryHits: bundle.sourceLibraryHits,
      entities: bundle.decision.entities,
      evidenceRefs: bundle.sourceLibraryHits.map((hit) => hit.sourceLibraryRef),
    }
  }

  private async validateSkillMethodologies(decision: ResearchDispatchDecision): Promise<void> {
    if (decision.mode !== 'skill_plan') return
    for (const skill of decision.skills) {
      const definition = this.skillRegistry.get(skill.id)
      if (definition === undefined) throw new ApplicationServiceError('not_found', `Research Skill is unavailable: ${skill.id}`)
      try { await loadResearchSkillMethodology(definition) } catch (error) { throw new ApplicationServiceError('conflict', `Research Skill methodology is unavailable: ${skill.id}`, { cause: error }) }
    }
  }

  async completeSessionResearch(runId: string, assistantText: string): Promise<void> {
    if (!this.options.bundleStore) return
    await this.pendingBundleWrites.get(runId)
    const bundle = await this.options.bundleStore.get(`research-bundle-${runId}`)
    if (!bundle) return
    const answer = assistantText.trim().slice(0, 50_000)
    const result: ResearchSessionResult = answer === '' ? { status: 'failed', executionBoundary: 'session', error: 'No assistant output was captured for the Free Research session.', selectedSkills: bundle.decision.skills, sourceLibraryHits: bundle.sourceLibraryHits, entities: bundle.decision.entities, evidenceRefs: bundle.sourceLibraryHits.map((hit) => hit.sourceLibraryRef), proposalCandidates: bundle.proposals } : { status: 'completed', executionBoundary: 'session', answer, selectedSkills: bundle.decision.skills, sourceLibraryHits: bundle.sourceLibraryHits, entities: bundle.decision.entities, evidenceRefs: bundle.sourceLibraryHits.map((hit) => hit.sourceLibraryRef), proposalCandidates: bundle.proposals }
    await this.options.bundleStore.put({ ...bundle, status: result.status, structuredResult: result })
  }

  private async retrieveSourceLibrary(request: ResearchRequest, callerSignal?: AbortSignal): Promise<readonly SourceLibraryHit[]> {
    if (!request.contextPolicy.sourceLibrary || this.options.sourceLibraryService === undefined || this.options.mountedKnowledgeBaseRoot === undefined) return []
    if (callerSignal?.aborted) throw new ApplicationServiceError('cancelled', 'Research dispatch was cancelled before Source Library retrieval')
    try {
      const handle = await new KnowledgeBaseRegistry().mount(this.options.mountedKnowledgeBaseRoot)
      return await this.options.sourceLibraryService.search(handle, { query: request.query, limit: 20 })
    } catch {
      return []
    }
  }

  private async resolveWithReasoning(request: ResearchRequest, explicitDefinition: WorkflowDefinition | undefined, sourceLibraryHits: readonly SourceLibraryHit[], runtimeTimestamp: string, callerSignal?: AbortSignal): Promise<{ readonly decision: ResearchDispatchDecision; readonly resolution: ResearchDispatchResolution }> {
    const executor = this.options.reasoningExecutor
    if (executor === undefined) throw new ApplicationServiceError('failed', 'Research dispatch semantic resolver is not configured')
    const explicit = request.mode.type === 'workflow'
    const diagnostics: string[] = []
    const attemptErrors: ResearchDispatchAttemptError[] = []
    let previousOutput: unknown
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      if (callerSignal?.aborted) throw new ApplicationServiceError('cancelled', 'Research dispatch was cancelled during semantic resolution')
      const reasoningRequest: ReasoningRequest = {
        operation: 'research_dispatch_resolution',
        instruction: explicit
          ? 'Extract arguments and entities for the user-selected Workflow. Never select or replace the Workflow; return mode workflow with the exact supplied workflow ID.'
          : 'Resolve the user research intent. Prefer one registered Workflow when its intent is clear, otherwise select eligible Research Skills, otherwise use Free Research. Do not invent canonical IDs or change request policies. A company report request selects company_research even with only a name or abbreviation. Preserve the exact user object in entities with type company. Missing symbol/exchange are resolved by the trusted directory later; never guess them. A bare security name/code/pinyin abbreviation selects company_research but includes research_goal in missingRequiredInputs. Only generate asOf when the user explicitly requests a historical cutoff.',
        input: { query: request.query, requestedMode: request.mode, explicitWorkflow: explicitDefinition, workflows: explicit ? explicitDefinition === undefined ? [] : [explicitDefinition] : this.workflowRegistry.list(), researchSkills: this.skillRegistry.researchCandidates(), knowledgeSkillMetadata: this.skillRegistry.get('theme-framework') === undefined ? [] : [this.skillRegistry.get('theme-framework')], sourceLibraryHits, runtimeContext: { requestTimestamp: runtimeTimestamp, effectiveRuntimeClock: runtimeTimestamp, contextPolicy: request.contextPolicy, persistencePolicy: request.persistencePolicy, userControlsKnowledgeWrite: true }, ...(previousOutput === undefined ? {} : { previousOutput, repairDiagnostics: diagnostics.slice(-16), repairFieldPaths: attemptErrors.at(-1)?.fieldPaths ?? [] }) },
        outputContract: dispatchOutputContract,
        metadata: { operationFamily: 'research-dispatch', attempt: String(attempt) },
      }
      let category: ResearchDispatchAttemptCategory = 'model_call'
      try {
        const result = await executor.execute(reasoningRequest)
        category = 'semantic_decision'
        previousOutput = result.output
        let output = result.output
        if (typeof output === 'string') {
          category = 'json_parse'
          output = JSON.parse(output) as unknown
          category = 'semantic_decision'
        }
        const decision = validateResearchDispatchDecision(output)
        assertSemanticDecision(request, decision, this.workflowRegistry, this.skillRegistry, explicit ? request.mode.workflowId : undefined)
        const definition = decision.workflow === undefined ? undefined : this.workflowRegistry.get(decision.workflow.id)
        category = 'workflow_parameters'
        const prepared = this.prepareDecisionArguments(request, decision, runtimeTimestamp)
        const missing = prepared.mode === 'workflow' && prepared.workflow !== undefined ? normalizedMissingFields(definition!, prepared.workflow.arguments) : []
        const mappedSkills = decision.mode === 'workflow' && decision.workflow !== undefined && decision.skills.length === 0
          ? selectedSkillIds(this.skillRegistry, this.workflowRegistry.get(decision.workflow.id)!).map((id) => ({ id, purpose: this.skillRegistry.get(id)?.purpose ?? 'selected by the authoritative Workflow definition' }))
          : decision.skills
        const normalized = validateResearchDispatchDecision({ ...prepared, skills: mappedSkills, missingRequiredInputs: missing })
        return { decision: normalized, resolution: { source: attempt === 1 ? 'reasoning_executor' : 'bounded_repair', attempts: attempt, diagnostics, attemptErrors } }
      } catch (error) {
        if (callerSignal?.aborted) throw new ApplicationServiceError('cancelled', 'Research dispatch was cancelled')
        const failure = dispatchAttemptError(error, category, attempt)
        diagnostics.push(failure.code)
        attemptErrors.push(failure)
        if (attempt === 2) break
      }
    }
    throw new DispatchSemanticError({ source: 'bounded_repair', attempts: 2, diagnostics, attemptErrors }, attemptErrors.at(-1)?.category ?? 'model_call')
  }

  private reportIdFromResult(result: unknown): string | undefined {
    if (typeof result !== 'object' || result === null || Array.isArray(result)) return undefined
    const value = result as Record<string, unknown>
    const nested = typeof value.report === 'object' && value.report !== null && !Array.isArray(value.report) ? value.report as Record<string, unknown> : undefined
    const brief = typeof value.brief === 'object' && value.brief !== null && !Array.isArray(value.brief) ? value.brief as Record<string, unknown> : undefined
    const candidate = [nested?.reportId, value.reportId, brief?.reportId].find((item): item is string => typeof item === 'string')
    return candidate !== undefined && /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(candidate) ? candidate : undefined
  }

  private async verifiedReportId(result: unknown, workflowRunId: string): Promise<string | undefined> {
    const reportId = this.reportIdFromResult(result)
    if (reportId === undefined) return undefined
    try {
      const report = await this.options.researchService?.getResearchReport(reportId)
      if (report !== undefined && report.workflowRunId === workflowRunId) return reportId
    } catch { /* an unresolvable report is not exposed as an artifact link */ }
    try {
      const brief = await this.options.dailyIntelligenceService?.getBrief(reportId)
      if (brief !== undefined && brief.workflowRunId === workflowRunId) return reportId
    } catch { /* keep missing and unreadable report references out of the public projection */ }
    return undefined
  }

  private async verifiedReviewCaseId(result: unknown, workflowRunId: string): Promise<string | undefined> {
    if (typeof result !== 'object' || result === null || Array.isArray(result)) return undefined
    const candidate = (result as Record<string, unknown>).reviewCaseId
    if (typeof candidate !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(candidate) || !this.options.reviewService) return undefined
    try {
      const reviewCase = await this.options.reviewService.getReviewCase(candidate)
      return reviewCase.producerRunId === workflowRunId && reviewCase.reviewCaseId === candidate ? candidate : undefined
    } catch { return undefined }
  }

  private async persistDispatchResult(request: ResearchRequest, decision: ResearchDispatchDecision, summary: ResearchExecutionSummary, workflowId: string, workflowRunId: string, result: unknown, sourceLibraryHits: readonly SourceLibraryHit[]): Promise<void> {
    const workflowService = this.options.workflowService
    if (workflowService === undefined) return
    const workflow = workflowService.getWorkflowStatus(workflowRunId)
    if (workflow === undefined) return
    const cancelled = workflow.status === 'cancelled'
    const effectiveResult = cancelled ? { status: 'cancelled', workflowRunId, summary: 'Workflow was cancelled.' } : result
    const reportRef = cancelled ? undefined : await this.verifiedReportId(effectiveResult, workflowRunId)
    const reviewRef = cancelled ? undefined : await this.verifiedReviewCaseId(effectiveResult, workflowRunId)
    const bundleId = `research-bundle-${workflowRunId}`
    let executionResult = projectResearchExecutionResult({ workflowId, workflow, domainResult: effectiveResult, bundleStatus: this.options.bundleStore === undefined ? 'unavailable' : 'available', ...(this.options.bundleStore === undefined ? {} : { bundleRef: bundleId }), ...(reportRef === undefined ? {} : { verifiedReportId: reportRef }), ...(reviewRef === undefined ? {} : { verifiedReviewCaseId: reviewRef }) })
    if (this.options.bundleStore !== undefined) {
      try {
        await this.options.bundleStore.put(createResearchBundle({ request, decision, summary, workflowRunId, result: effectiveResult, executionResult, ...(reportRef === undefined ? {} : { verifiedReportId: reportRef }), sourceLibraryHits }))
      } catch {
        executionResult = projectResearchExecutionResult({ workflowId, workflow, domainResult: effectiveResult, bundleStatus: 'failed', ...(reportRef === undefined ? {} : { verifiedReportId: reportRef }), ...(reviewRef === undefined ? {} : { verifiedReviewCaseId: reviewRef }), extraDiagnostics: ['BUNDLE_PERSIST_FAILED'] })
      }
    }
    workflowService.setExecutionResult(workflowRunId, executionResult)
  }

  private async persistDispatchFailure(request: ResearchRequest, decision: ResearchDispatchDecision, summary: ResearchExecutionSummary, workflowId: string, workflowRunId: string, error: unknown, sourceLibraryHits: readonly SourceLibraryHit[]): Promise<void> {
    const workflowService = this.options.workflowService
    if (workflowService === undefined) return
    let workflow = workflowService.getWorkflowStatus(workflowRunId)
    if (workflow === undefined) {
      workflowService.register({ runId: workflowRunId, workflowType: workflowId, objective: `${workflowId} execution` })
      workflowService.markFailure(workflowRunId, 'Workflow execution failed before lifecycle registration completed.')
      workflow = workflowService.getWorkflowStatus(workflowRunId)
    } else if (workflow.status === 'pending' || workflow.status === 'running') {
      workflowService.markFailure(workflowRunId, 'Workflow execution failed.')
      workflow = workflowService.getWorkflowStatus(workflowRunId)
    }
    if (workflow === undefined) return
    const errorCode = error instanceof ApplicationServiceError && error.code === 'cancelled' ? 'WORKFLOW_CANCELLED' : 'WORKFLOW_EXECUTION_FAILED'
    const result = { workflowRunId, status: workflow.status === 'cancelled' ? 'cancelled' : 'failed', diagnostics: [errorCode], summary: workflow.status === 'cancelled' ? 'Workflow was cancelled.' : 'Workflow execution failed.' }
    const bundleId = `research-bundle-${workflowRunId}`
    let executionResult = projectResearchExecutionResult({ workflowId, workflow, domainResult: result, bundleStatus: this.options.bundleStore === undefined ? 'unavailable' : 'available', ...(this.options.bundleStore === undefined ? {} : { bundleRef: bundleId }) })
    if (this.options.bundleStore !== undefined) {
      try { await this.options.bundleStore.put(createResearchBundle({ request, decision, summary, workflowRunId, result, executionResult, sourceLibraryHits })) }
      catch { executionResult = projectResearchExecutionResult({ workflowId, workflow, domainResult: result, bundleStatus: 'failed', extraDiagnostics: ['BUNDLE_PERSIST_FAILED'] }) }
    }
    workflowService.setExecutionResult(workflowRunId, executionResult)
  }

  private async persistBundle(request: ResearchRequest, decision: ResearchDispatchDecision, summary: ResearchExecutionSummary, workflowRunId: string, result: unknown, sourceLibraryHits: readonly SourceLibraryHit[] = []): Promise<void> {
    if (!this.options.bundleStore) return
    await this.options.bundleStore.put(createResearchBundle({ request, decision, summary, workflowRunId, result, sourceLibraryHits }))
  }

  private schedulePendingBundle(request: ResearchRequest, decision: ResearchDispatchDecision, summary: ResearchExecutionSummary, workflowRunId: string, result: unknown, sourceLibraryHits: readonly SourceLibraryHit[]): void {
    const write = this.persistBundle(request, decision, summary, workflowRunId, result, sourceLibraryHits)
    this.pendingBundleWrites.set(workflowRunId, write)
    void write.finally(() => { if (this.pendingBundleWrites.get(workflowRunId) === write) this.pendingBundleWrites.delete(workflowRunId) }).catch(() => undefined)
  }

  private bestWorkflow(query: string): WorkflowDefinition | undefined {
    const candidates = this.workflowRegistry.list().map((definition) => ({ definition, score: scoreWorkflow(definition, query) }))
    const specializedMatch = candidates.some((item) => item.definition.id !== 'company_research' && item.definition.id !== 'daily_intelligence' && item.score > 0)
    return candidates.map((item) => item.definition.id === 'company_research' && !specializedMatch && extractSymbol(query).symbol !== undefined ? { ...item, score: item.score + 2 } : item).sort((left, right) => right.score - left.score || left.definition.id.localeCompare(right.definition.id)).find((item) => item.score > 0)?.definition
  }

  private bestSkill(query: string): ResearchSkillDefinition | undefined {
    const text = safeQuery(query)
    const canonical = this.skillRegistry.canonicalResearchCandidates()
    const intentMatches: readonly { readonly id: string; readonly include: readonly RegExp[]; readonly exclude?: readonly RegExp[] }[] = [
      { id: 'comps_valuation', include: [/(?:comps|comparable|peer|可比|同行|相对估值)/i, /(?:valuation|multiple|PE|PB|EV\s*[/：:]?\s*EBITDA|估值|倍数|合理价值)/i], exclude: [/(?:implied|price.?in|隐含|增长|growth)/i] },
      { id: 'reverse_dcf_expectation_decode', include: [/(?:price|priced|price.?in|隐含|股价|当前价格)/i, /(?:growth|revenue|margin|增长|收入|利润|假设)/i], exclude: [/(?:my|按我的|forecast|预测|build|做).*(?:dcf|discounted|DCF)/i] },
      { id: 'dcf_valuation', include: [/(?:DCF|discounted cash flow|内在价值|intrinsic value)/i, /(?:forecast|预测|revenue|收入|profit|利润|FCFF|现金流|assumption|假设)/i] },
      { id: 'earnings_variance_analysis', include: [/(?:beat|miss|surprise|超预期|低于预期|为什么|原因)/i, /(?:revenue|sales|profit|income|营收|收入|利润)/i], exclude: [/(?:guidance|指引|展望)/i] },
      { id: 'guidance_analysis', include: [/(?:guidance|指引|展望)/i, /(?:change|changed|prior|last|变化|上次|相比)/i] },
      { id: 'estimate_revision_analysis', include: [/(?:estimate|estimates|revision|revised|预测|估计|预期).*(?:revision|change|上调|下调|调整)|(?:上调|下调|调整).*(?:预测|预期|estimate)/i] },
      { id: 'consensus_expectations_analysis', include: [/(?:consensus|一致预期|市场预期)/i], exclude: [/(?:beat|miss|guidance|revision|修订|指引)/i] },
      { id: 'business_model_map', include: [/(?:business model|makes money|how.*make|商业模式|靠什么赚钱|怎么赚钱|客户.*产品)/i] },
      { id: 'market_structure_analysis', include: [/(?:market structure|market definition|market size|市场结构|市场边界|市场规模|细分市场)/i] },
      { id: 'industry_supply_demand_cycle', include: [/(?:supply.?demand|industry cycle|inventory|utilization|capacity|pricing|供需|周期|库存|利用率|产能|行业价格)/i] },
      { id: 'competitive_market_map', include: [/(?:competitor|competition|competitive|peer|market share|竞争|竞品|竞争格局|市场份额)/i] },
      { id: 'business_driver_analysis', include: [/(?:volume|price|mix|segment|driver|销量|价格|mix|分部|驱动)/i, /(?:revenue|sales|profit|营收|收入|利润|增长)/i] },
      { id: 'unit_economics', include: [/(?:unit economics|economic unit|per customer|per shipment|每客|每单|每个客户|经济单位)/i] },
      { id: 'expectation_gap', include: [/(?:market|price|consensus|management|own research|市场|股价|一致预期|管理层|我们(?:的)?研究)/i, /(?:gap|disagreement|difference|分歧|差异|预期差|核心分歧)/i] },
      { id: 'thesis_formalize', include: [/(?:thesis|investment logic|投资逻辑|投资论点)/i, /(?:proposition|falsifiable|formalize|整理|命题|可证伪)/i] },
      { id: 'catalyst_map', include: [/(?:catalyst|event|事件|催化剂)/i, /(?:validate|验证|confirm|确认|未来|upcoming)/i] },
      { id: 'thesis_refresh', include: [/(?:thesis|投资逻辑|投资论点)/i, /(?:refresh|changed|change|财报|更新|变化|变了|哪些地方)/i] },
      { id: 'thesis_red_team', include: [/(?:red.?team|falsif|反驳|反向验证|最容易错|哪里.*错|投资逻辑)/i] },
    ]
    for (const match of intentMatches) {
      const skill = canonical.find((item) => item.id === match.id)
      if (skill !== undefined && match.include.every((pattern) => pattern.test(text)) && (match.exclude === undefined || match.exclude.every((pattern) => !pattern.test(text)))) return skill
    }
    return this.skillRegistry.researchCandidates().filter((skill) => skill.origin !== 'canonical').map((skill) => {
      const workflowScore = WORKFLOW_KEYWORDS[skill.researchCapability ?? '']?.reduce((score, term) => score + (containsTerm(text, term) ? 1 : 0), 0) ?? 0
      const explicitSkillScore = containsTerm(text, skill.id) ? 2 : 0
      const usageScore = containsTerm(text, skill.whenToUse) ? 1 : 0
      return { skill, score: workflowScore + explicitSkillScore + usageScore }
    }).sort((left, right) => right.score - left.score || left.skill.id.localeCompare(right.skill.id)).find((item) => item.score > 0)?.skill
  }

  private entities(query: string) {
    const identity = extractSymbol(query)
    return identity.symbol === undefined ? [] : [{ type: 'company', value: identity.name ?? identity.symbol, confidence: 0.95 }]
  }

  private summary(request: ResearchRequest, decision: ResearchDispatchDecision, definition?: WorkflowDefinition): ResearchExecutionSummary {
    const workflow = decision.workflow
    return { mode: request.mode.type === 'workflow' ? 'Explicit Workflow' : 'Free Research', ...(workflow === undefined ? {} : { workflowId: workflow.id, workflowLabel: definition?.label }), selectedSkillIds: decision.skills.map((skill) => skill.id), argumentsStatus: decision.missingRequiredInputs.length > 0 ? 'missing' : workflow === undefined ? 'not_required' : 'extracted', argumentKeys: workflow === undefined ? [] : Object.keys(workflow.arguments).sort(), contextPolicy: request.contextPolicy, persistencePolicy: request.persistencePolicy }
  }

  private startWorkflow(context: WorkflowExecutionBindingContext): Promise<unknown> {
    const binding = this.executionBindings.get(context.workflowId)
    if (binding === undefined) throw new ApplicationServiceError('executor_unavailable', `Workflow ${context.workflowId} has no execution binding`)
    return binding(context)
  }
}
