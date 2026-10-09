import { randomUUID } from 'node:crypto'
import type { DailyIntelligenceService } from './daily-intelligence-service.ts'
import type { ResearchService } from './research-service.ts'
import type { WorkflowService } from './workflow-service.ts'
import { ApplicationServiceError } from './contracts.ts'
import { createResearchSkillRegistry, loadResearchSkillMethodology, type LoadedResearchSkill, type ResearchSkillDefinition, type ResearchSkillRegistry } from './skill-registry.ts'
import { createWorkflowDefinitionRegistry, type WorkflowDefinition, type WorkflowDefinitionRegistry } from './workflow-registry.ts'
import { normalizeResearchRequest, validateResearchDispatchDecision, type ResearchDispatchDecision, type ResearchExecutionSummary, type ResearchRequest } from './research-dispatch-contracts.ts'
import type { EventAnchor, EarningsReviewPeriod, ValuationMethod } from './contracts.ts'
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

export interface ResearchSessionContext {
  readonly selectedSkills: readonly LoadedResearchSkill[]
  readonly sourceLibraryHits: readonly SourceLibraryHit[]
  readonly entities: readonly ResearchDispatchDecision['entities'][number][]
  readonly evidenceRefs: readonly string[]
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
  readonly status: 'started' | 'needs_input' | 'invalid_input' | 'unresolved_reference' | 'free_research' | 'skill_plan'
  readonly runId?: string
  readonly workflow?: unknown
  readonly completion?: Promise<unknown>
  readonly sourceLibraryHits?: readonly SourceLibraryHit[]
  readonly resolution?: ResearchDispatchResolution
  readonly feedback?: ResearchDispatchFeedback
}

export interface ResearchDispatchFeedback {
  readonly status: 'NEEDS_INPUT' | 'INVALID_INPUT' | 'UNRESOLVED_REFERENCE'
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
}

export interface ResearchDispatchServiceOptions {
  readonly researchService?: ResearchService
  readonly dailyIntelligenceService?: DailyIntelligenceService
  readonly workflowRegistry?: WorkflowDefinitionRegistry
  readonly skillRegistry?: ResearchSkillRegistry
  readonly workflowService?: WorkflowService
  readonly bundleStore?: ResearchBundleStore
  readonly sourceLibraryService?: SourceLibraryService
  readonly themeFrameworkService?: ThemeFrameworkService
  readonly mountedKnowledgeBaseRoot?: string
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

function extractSymbol(query: string): { readonly symbol?: string; readonly name?: string } {
  const symbol = query.match(/\b\d{6}\b/)?.[0]
  return symbol === undefined ? {} : { symbol }
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
    skills: { type: 'array', description: 'Selected ResearchHub Research Skill IDs and purposes.' },
    entities: { type: 'array', description: 'Resolved entities, without canonical IDs.' },
    missingRequiredInputs: { type: 'array', items: { type: 'string' } },
    contextPolicy: { type: 'object', required: ['structuredKnowledge', 'sourceLibrary'] },
    persistencePolicy: { type: 'object', required: ['writeKnowledge'] },
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
    if (!inputValidation.valid) throw new ApplicationServiceError('invalid_input', `Workflow ${definition.id} arguments violate its registered inputSchema: ${inputValidation.errors.filter((message) => !message.includes('is required')).join('; ')}`)
  }
  if (decision.mode === 'skill_plan' && (decision.skills.length === 0 || decision.skills.some((skill) => !isExecutableResearchSkill(skillRegistry, skill.id)))) throw new ApplicationServiceError('invalid_input', 'Semantic dispatch selected an unavailable Research Skill')
  if (decision.mode === 'free_research' && decision.skills.length > 0) throw new ApplicationServiceError('invalid_input', 'Free Research cannot include selected Research Skills')
}

export class ResearchDispatchService {
  readonly workflowRegistry: WorkflowDefinitionRegistry
  readonly skillRegistry: ResearchSkillRegistry
  private readonly pendingBundleWrites = new Map<string, Promise<void>>()
  constructor(private readonly options: ResearchDispatchServiceOptions = {}) {
    this.workflowRegistry = options.workflowRegistry ?? createWorkflowDefinitionRegistry()
    this.skillRegistry = options.skillRegistry ?? createResearchSkillRegistry()
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
    const args: Record<string, unknown> = { ...decision.workflow.arguments }
    const properties = inputProperties(definition)
    const cutoff = requestedHistoricalCutoff(request.query)
    if (Object.hasOwn(properties, 'asOf')) {
      if (cutoff !== undefined) args.asOf = cutoff
      else if (Object.hasOwn(args, 'asOf')) throw new ApplicationServiceError('invalid_input', 'A historical asOf value must come from an explicit user-requested cutoff; Runtime time does not imply historical analysis')
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
    if (!validation.valid) throw new ApplicationServiceError('invalid_input', `Workflow ${definition.id} arguments violate its registered inputSchema: ${validation.errors.filter((message) => !message.includes('is required')).join('; ')}`)
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

  async startAsync(input: unknown, callerSignal?: AbortSignal): Promise<ResearchDispatchStart> {
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
    const resolved = await this.resolveAsync(input, callerSignal)
    const verified = await this.verifyWorkflowReferences(resolved.request, resolved.decision)
    if (verified.feedback !== undefined) return { ...resolved, status: verified.failureStatus ?? 'unresolved_reference', feedback: verified.feedback }
    const decision = verified.decision ?? resolved.decision
    const summary = this.summary(resolved.request, decision, decision.workflow === undefined ? undefined : this.workflowRegistry.get(decision.workflow.id))
    return this.startResolved({ ...resolved, decision, summary }, callerSignal, resolved.sourceLibraryHits, resolved.resolution)
  }

  private async verifyWorkflowReferences(request: ResearchRequest, decision: ResearchDispatchDecision): Promise<{ readonly decision?: ResearchDispatchDecision; readonly feedback?: ResearchDispatchFeedback; readonly failureStatus?: 'invalid_input' }> {
    if (decision.mode !== 'workflow' || decision.workflow === undefined) return {}
    const definition = this.workflowRegistry.get(decision.workflow.id)
    if (definition === undefined) return {}
    const args = decision.workflow.arguments
    const validation = validateWorkflowInputSchema(definition.inputSchema, args)
    if (!validation.valid || normalizedMissingFields(definition, args).length > 0) return {}
    const referenceCandidates = collectCanonicalReferences(args)
    const hasCompany = Object.hasOwn(inputProperties(definition), 'symbol')
    if (!hasCompany && referenceCandidates.length === 0) return {}
    const companyResearch = definition.id === 'company_research'
    const normalizedArgs: Record<string, unknown> = { ...args }
    if (typeof args.exchange === 'string') normalizedArgs.exchange = normalizeExchange(args.exchange)
    const userProvidedExchange = companyResearch && referenceCandidates.length === 0 ? explicitUserCompanyExchange(request.query, normalizedArgs) : undefined
    if (companyResearch && userProvidedExchange !== undefined) normalizedArgs.exchange = userProvidedExchange
    const finalizeArguments = (candidateArgs: Readonly<Record<string, unknown>>) => {
      const finalValidation = validateWorkflowInputSchema(definition.inputSchema, candidateArgs)
      if (!finalValidation.valid) return { feedback: feedbackFor('INVALID_INPUT', definition, candidateArgs, finalValidation.errors.join('; ')), failureStatus: 'invalid_input' as const }
      return { decision: validateResearchDispatchDecision({ ...decision, workflow: { ...decision.workflow!, arguments: candidateArgs }, missingRequiredInputs: normalizedMissingFields(definition, candidateArgs) }) }
    }
    if (companyResearch && referenceCandidates.length === 0 && userProvidedExchange !== undefined && !request.contextPolicy.structuredKnowledge) return finalizeArguments(normalizedArgs)
    if (!request.contextPolicy.structuredKnowledge) return { feedback: feedbackFor('UNRESOLVED_REFERENCE', definition, normalizedArgs, 'This Workflow requires trusted Knowledge context to verify the company or canonical references, but structured Knowledge access is disabled.') }
    if (this.options.mountedKnowledgeBaseRoot === undefined) {
      if (companyResearch && referenceCandidates.length === 0 && userProvidedExchange !== undefined) return finalizeArguments(normalizedArgs)
      return { feedback: feedbackFor('UNRESOLVED_REFERENCE', definition, normalizedArgs, 'No mounted Knowledge Base is available to verify the requested company or canonical references.') }
    }
    let assets: Awaited<ReturnType<typeof readCanonicalV04Assets>>
    try {
      const handle = await new KnowledgeBaseRegistry().mount(this.options.mountedKnowledgeBaseRoot)
      if (handle.schemaVersion !== '0.4') {
        if (companyResearch && referenceCandidates.length === 0 && userProvidedExchange !== undefined) return finalizeArguments(normalizedArgs)
        return { feedback: feedbackFor('UNRESOLVED_REFERENCE', definition, normalizedArgs, 'Trusted dispatch identity checks currently require a mounted Schema 0.4 Knowledge Base.') }
      }
      assets = await readCanonicalV04Assets(handle.rootRef)
    } catch (error) {
      if (companyResearch && referenceCandidates.length === 0 && userProvidedExchange !== undefined) return finalizeArguments(normalizedArgs)
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
        if (companyResearch && userProvidedExchange !== undefined && companyMatches.length === 0 && mentionedCompanies.length === 0 && !companies.some((item) => item.ticker === symbol)) return finalizeArguments(normalizedArgs)
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
      return finalizeArguments(verifiedArgs)
    }
    const badRefs = referenceCandidates.filter((ref) => byId.get(ref) === undefined)
    if (badRefs.length > 0) return { feedback: feedbackFor('UNRESOLVED_REFERENCE', definition, args, `Canonical reference not found: ${badRefs.join(', ')}`, badRefs) }
    const inactiveRefs = referenceCandidates.filter((ref) => !canonicalObjectIsActive(byId.get(ref)!, identityAsOf))
    if (inactiveRefs.length > 0) return { feedback: feedbackFor('UNRESOLVED_REFERENCE', definition, args, `Canonical reference is inactive or outside its lifecycle window: ${inactiveRefs.join(', ')}`, inactiveRefs) }
    return finalizeArguments(normalizedArgs)
  }

  private startResolved(resolved: { readonly request: ResearchRequest; readonly decision: ResearchDispatchDecision; readonly summary: ResearchExecutionSummary }, callerSignal: AbortSignal | undefined, sourceLibraryHits: readonly SourceLibraryHit[], resolution: ResearchDispatchResolution): ResearchDispatchStart {
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
    let started: Promise<unknown>
    const runId = randomUUID()
    try {
      started = this.startWorkflow(definition.id, workflow.arguments, runId, callerSignal, resolved.request.persistencePolicy.writeKnowledge, resolved.request.contextPolicy.structuredKnowledge, sourceLibraryHits)
    } catch (error) {
      if (error instanceof ApplicationServiceError && error.code === 'not_found' && error.message.includes('no adapter')) {
        const feedback = feedbackFor('INVALID_INPUT', definition, workflow.arguments, `Workflow ${definition.id} is registered but has no execution adapter.`)
        return { ...resolved, status: 'invalid_input', feedback, sourceLibraryHits, resolution }
      }
      throw error
    }
    const completion = started.then(async (result) => { await this.persistBundle(resolved.request, decision, resolved.summary, runId, result, sourceLibraryHits); return result })
    completion.catch(() => undefined)
    return { ...resolved, status: 'started', runId, sourceLibraryHits, resolution, ...(this.options.workflowService?.getWorkflowStatus(runId) === undefined ? {} : { workflow: this.options.workflowService.getWorkflowStatus(runId) }), completion }
  }

  async getBundle(bundleId: string): Promise<ResearchBundle | undefined> { return this.options.bundleStore?.get(bundleId) }
  async listBundles(limit?: number): Promise<readonly ResearchBundle[]> { return this.options.bundleStore?.list(limit) ?? [] }

  async getSessionResearchContext(runId: string): Promise<ResearchSessionContext | undefined> {
    await this.pendingBundleWrites.get(runId)
    const bundle = await this.getBundle(`research-bundle-${runId}`)
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
    let previousOutput: unknown
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      if (callerSignal?.aborted) throw new ApplicationServiceError('cancelled', 'Research dispatch was cancelled during semantic resolution')
      const reasoningRequest: ReasoningRequest = {
        operation: 'research_dispatch_resolution',
        instruction: explicit
          ? 'Extract arguments and entities for the user-selected Workflow. Never select or replace the Workflow; return mode workflow with the exact supplied workflow ID.'
          : 'Resolve the user research intent. Prefer one registered Workflow when its intent is clear, otherwise select eligible Research Skills, otherwise use Free Research. Do not invent canonical IDs or change request policies.',
        input: { query: request.query, requestedMode: request.mode, explicitWorkflow: explicitDefinition, workflows: explicit ? explicitDefinition === undefined ? [] : [explicitDefinition] : this.workflowRegistry.list(), researchSkills: this.skillRegistry.researchCandidates(), knowledgeSkillMetadata: this.skillRegistry.get('theme-framework') === undefined ? [] : [this.skillRegistry.get('theme-framework')], sourceLibraryHits, runtimeContext: { requestTimestamp: runtimeTimestamp, effectiveRuntimeClock: runtimeTimestamp, contextPolicy: request.contextPolicy, persistencePolicy: request.persistencePolicy, userControlsKnowledgeWrite: true }, ...(previousOutput === undefined ? {} : { previousOutput, repairDiagnostics: diagnostics.slice(-16) }) },
        outputContract: dispatchOutputContract,
        metadata: { operationFamily: 'research-dispatch', attempt: String(attempt) },
      }
      try {
        const result = await executor.execute(reasoningRequest)
        previousOutput = result.output
        const decision = validateResearchDispatchDecision(result.output)
        assertSemanticDecision(request, decision, this.workflowRegistry, this.skillRegistry, explicit ? request.mode.workflowId : undefined)
        const definition = decision.workflow === undefined ? undefined : this.workflowRegistry.get(decision.workflow.id)
        const prepared = this.prepareDecisionArguments(request, decision, runtimeTimestamp)
        const missing = prepared.mode === 'workflow' && prepared.workflow !== undefined ? normalizedMissingFields(definition!, prepared.workflow.arguments) : []
        const mappedSkills = decision.mode === 'workflow' && decision.workflow !== undefined && decision.skills.length === 0
          ? selectedSkillIds(this.skillRegistry, this.workflowRegistry.get(decision.workflow.id)!).map((id) => ({ id, purpose: this.skillRegistry.get(id)?.purpose ?? 'selected by the authoritative Workflow definition' }))
          : decision.skills
        const normalized = validateResearchDispatchDecision({ ...prepared, skills: mappedSkills, missingRequiredInputs: missing })
        return { decision: normalized, resolution: { source: attempt === 1 ? 'reasoning_executor' : 'bounded_repair', attempts: attempt, diagnostics } }
      } catch (error) {
        diagnostics.push(error instanceof Error ? error.message.slice(0, 240) : 'semantic_resolution_invalid')
        if (attempt === 2) break
      }
    }
    const fallback = this.resolve(request)
    let prepared = fallback.decision
    try { prepared = this.prepareDecisionArguments(request, fallback.decision, runtimeTimestamp) } catch (error) { diagnostics.push(error instanceof Error ? error.message.slice(0, 240) : 'fallback_contract_invalid') }
    return { decision: prepared, resolution: { source: 'deterministic_fallback', attempts: 2, diagnostics: [...diagnostics, 'semantic_resolution_fallback'] } }
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

  private startWorkflow(workflowId: string, args: Readonly<Record<string, unknown>>, runId: string, callerSignal?: AbortSignal, writeKnowledge = false, useStructuredKnowledge = true, sourceLibraryHits: readonly SourceLibraryHit[] = []): Promise<unknown> {
    const research = this.options.researchService
    if (workflowId === 'theme_framework') {
      const service = this.options.themeFrameworkService
      if (service === undefined) throw new ApplicationServiceError('failed', 'Theme Framework service is not configured')
      const started = service.start({ workflowRunId: runId, name: args.name as string, ...(typeof args.definition === 'string' ? { definition: args.definition } : {}) }, callerSignal)
      // Never expose or persist the internal construction result: it contains
      // provenance bindings. Chat receives the same safe projection as the API.
      return started.completion.then(() => service.getReviewCandidate(runId))
    }
    if (workflowId === 'daily_intelligence') {
      const daily = this.options.dailyIntelligenceService
      if (daily === undefined) throw new ApplicationServiceError('failed', 'Daily Intelligence service is not configured')
      return daily.startBrief({ workflowRunId: runId, briefType: args.briefType as 'morning' | 'evening', tradeDate: args.tradeDate as string, writeKnowledge, useStructuredKnowledge, sourceLibraryContext: sourceLibraryHits }, callerSignal).completion
    }
    if (workflowId === 'thesis_lifecycle') return Promise.resolve(runThesisLifecycle(args as unknown as ThesisLifecycleInput))
    if (workflowId === 'company_research') { if (!research) throw new ApplicationServiceError('failed', 'Research service is not configured'); return research.startResearchCompany({ workflowRunId: runId, symbol: args.symbol as string, name: args.name as string | undefined, exchange: args.exchange as string | undefined, asOf: args.asOf as string | undefined, writeKnowledge, useStructuredKnowledge, sourceLibraryContext: sourceLibraryHits }, callerSignal).completion }
    if (workflowId === 'industry_research') { if (!research) throw new ApplicationServiceError('failed', 'Research service is not configured'); return research.startIndustryResearch({ workflowRunId: runId, name: args.name as string, aliases: args.aliases as readonly string[] | undefined, asOf: args.asOf as string | undefined, writeKnowledge, useStructuredKnowledge, sourceLibraryContext: sourceLibraryHits }, callerSignal).completion }
    if (workflowId === 'earnings_review') { if (!research) throw new ApplicationServiceError('failed', 'Research service is not configured'); return research.startEarningsReview({ workflowRunId: runId, symbol: args.symbol as string, name: args.name as string | undefined, exchange: args.exchange as string | undefined, asOf: args.asOf as string | undefined, fiscalYear: args.fiscalYear as number, period: args.period as EarningsReviewPeriod, writeKnowledge, useStructuredKnowledge, sourceLibraryContext: sourceLibraryHits }, callerSignal).completion }
    if (workflowId === 'valuation') { if (!research) throw new ApplicationServiceError('failed', 'Research service is not configured'); return research.startValuation({ workflowRunId: runId, symbol: args.symbol as string, name: args.name as string | undefined, exchange: args.exchange as string | undefined, asOf: args.asOf as string | undefined, methods: args.methods as readonly ValuationMethod[] | undefined, targetFiscalYear: args.targetFiscalYear as number | undefined, writeKnowledge, useStructuredKnowledge, sourceLibraryContext: sourceLibraryHits }, callerSignal).completion }
    if (workflowId === 'event_research') { if (!research) throw new ApplicationServiceError('failed', 'Research service is not configured'); return research.startEventResearch({ workflowRunId: runId, symbol: args.symbol as string, name: args.name as string | undefined, exchange: args.exchange as string | undefined, asOf: args.asOf as string | undefined, anchor: args.anchor as EventAnchor, writeKnowledge, useStructuredKnowledge, sourceLibraryContext: sourceLibraryHits }, callerSignal).completion }
    if (workflowId === 'thesis_red_team') { if (!research) throw new ApplicationServiceError('failed', 'Research service is not configured'); return research.startThesisRedTeam({ workflowRunId: runId, symbol: args.symbol as string, name: args.name as string | undefined, exchange: args.exchange as string | undefined, thesisRef: args.thesisRef as string, lookbackDays: args.lookbackDays as number | undefined, writeKnowledge, useStructuredKnowledge, sourceLibraryContext: sourceLibraryHits }, callerSignal).completion }
    throw new ApplicationServiceError('not_found', `Workflow definition has no adapter: ${workflowId}`)
  }
}
