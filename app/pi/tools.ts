import { Type } from '@earendil-works/pi-ai'
import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent'
import { ApplicationServiceError, type EarningsReviewInput, type EventResearchInput, type IndustryResearchInput, type IngestDocumentInput, type ReviewCaseListInput, type ResearchCompanyInput, type ThesisRedTeamInput, type ValuationInput } from '../services/contracts.ts'
import type { KnowledgeService } from '../services/knowledge-service.ts'
import type { ProductionService } from '../services/production-service.ts'
import type { ReviewService } from '../services/review-service.ts'
import type { WorkflowService } from '../services/workflow-service.ts'
import type { ResearchService } from '../services/research-service.ts'
import type { DailyIntelligenceService } from '../services/daily-intelligence-service.ts'
import type { DailyBriefInput } from '../services/daily-intelligence-service.ts'
import { KnowledgeBaseRegistry } from '../../knowledge/registry/registry.ts'
import type { SourceLibraryService } from '../services/source-library.ts'
import { SkillOnboardingService, registerOnboardedResearchSkill, type SkillArchiveFetcher, type SkillOnboardingInspection, type SkillOnboardingRecord } from '../services/skill-onboarding.ts'
import type { ResearchDispatchService } from '../services/research-dispatch-service.ts'
import type { ResourceLoader } from '@earendil-works/pi-coding-agent'
import type { ThesisQueryService } from '../services/thesis-query-service.ts'
import type { ThesisDecisionService } from '../services/thesis-decision-service.ts'
import { defaultResearchContextPolicy, defaultResearchPersistencePolicy } from '../services/research-dispatch-contracts.ts'

export interface ResearchHubRequestPolicy { readonly structuredKnowledge: boolean; readonly sourceLibrary: boolean; readonly writeKnowledge: boolean }
export interface ResearchHubPolicyContext { current?: ResearchHubRequestPolicy }

export interface ResearchHubPiToolContext {
  readonly knowledgeService: KnowledgeService
  readonly productionService: ProductionService
  readonly reviewService: ReviewService
  readonly workflowService: WorkflowService
  readonly researchService?: ResearchService
  readonly thesisQueryService?: ThesisQueryService
  readonly thesisDecisionService?: ThesisDecisionService
  readonly dailyIntelligenceService?: DailyIntelligenceService
  readonly sourceLibraryService?: SourceLibraryService
  readonly mountedKnowledgeBaseRoot?: string
  readonly skillOnboardingService?: SkillOnboardingService
  readonly researchDispatchService?: ResearchDispatchService
  readonly skillArchiveFetcher?: SkillArchiveFetcher
  readonly resourceLoader?: ResourceLoader
  readonly piNativeSkillsRoot?: string
  readonly policyContext?: ResearchHubPolicyContext
}

function textResult(value: unknown, isError = false) { return { content: [{ type: 'text' as const, text: JSON.stringify(value) }], details: undefined, isError } }
function formatError(error: unknown): { readonly error: string; readonly code: string } {
  if (error instanceof ApplicationServiceError) return { error: error.message, code: error.code }
  return { error: 'ResearchHub application operation failed', code: 'failed' }
}
async function invoke<T>(operation: () => Promise<T>, signal?: AbortSignal) {
  try { if (signal?.aborted) return textResult({ error: 'ResearchHub operation cancelled', code: 'cancelled' }, true); return textResult(await operation()) }
  catch (error) { return textResult(formatError(error), true) }
}
function integerParam(value: number | undefined, name: string): void { if (value !== undefined && (!Number.isInteger(value) || value < 1)) throw new ApplicationServiceError('invalid_input', `${name} must be a positive integer`) }

function scopedReadService<T extends object>(service: T, policyContext: ResearchHubPolicyContext | undefined, blockedMethods: readonly string[], label: string): T {
  if (policyContext === undefined) return service
  return new Proxy(service, { get(target, property, receiver) { if (policyContext.current?.structuredKnowledge === false && typeof property === 'string' && blockedMethods.includes(property)) return (() => { throw new ApplicationServiceError('conflict', `${label} is disabled for this ResearchRequest`) }) as T[Extract<keyof T, string>]; return Reflect.get(target, property, receiver) } })
}

function scopedResearchService<T extends object>(service: T | undefined, policyContext: ResearchHubPolicyContext | undefined): T | undefined {
  if (service === undefined) return service
  const methods = new Set(['startResearchCompany', 'startIndustryResearch', 'startEarningsReview', 'startValuation', 'startEventResearch', 'startThesisRedTeam', 'startThesisLifecycleRefresh', 'startThesisLifecycleCreate'])
  return new Proxy(service, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver)
      if (typeof property !== 'string' || !methods.has(property) || typeof value !== 'function') return value
      return (...args: unknown[]) => {
        const supplied = policyContext?.current
        if (property === 'startThesisLifecycleRefresh' || property === 'startThesisLifecycleCreate') {
          if (supplied?.writeKnowledge !== true || supplied.structuredKnowledge !== true) throw new ApplicationServiceError('conflict', `Thesis lifecycle ${property === 'startThesisLifecycleCreate' ? 'CREATE' : 'refresh'} requires explicit Knowledge-write authorization and structured Knowledge access`)
          return Reflect.apply(value, target, args)
        }
        const defaultContext = defaultResearchContextPolicy()
        const defaultPersistence = defaultResearchPersistencePolicy()
        const current: ResearchHubRequestPolicy = {
          structuredKnowledge: supplied?.structuredKnowledge ?? defaultContext.structuredKnowledge,
          sourceLibrary: supplied?.sourceLibrary ?? defaultContext.sourceLibrary,
          writeKnowledge: (supplied?.writeKnowledge ?? defaultPersistence.writeKnowledge) === true,
        }
        const input = args[0]
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ApplicationServiceError('invalid_input', 'Research tool input must be an object')
        return Reflect.apply(value, target, [{ ...(input as Record<string, unknown>), writeKnowledge: current.writeKnowledge, useStructuredKnowledge: current.structuredKnowledge }, ...args.slice(1)])
      }
    },
  })
}

function scopedDailyService<T extends object>(service: T | undefined, policyContext: ResearchHubPolicyContext | undefined): T | undefined {
  if (service === undefined || policyContext === undefined) return service
  return new Proxy(service, { get(target, property, receiver) { const value = Reflect.get(target, property, receiver); if (property !== 'startBrief' || typeof value !== 'function') return value; return (...args: unknown[]) => { const current = policyContext.current; if (current === undefined) return Reflect.apply(value, target, args); const input = args[0]; if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ApplicationServiceError('invalid_input', 'Daily Brief input must be an object'); return Reflect.apply(value, target, [{ ...(input as Record<string, unknown>), writeKnowledge: current.writeKnowledge, useStructuredKnowledge: current.structuredKnowledge }, ...args.slice(1)]) } } })
}

function scopedProductionService<T extends object>(service: T, policyContext: ResearchHubPolicyContext | undefined): T {
  if (policyContext === undefined) return service
  return new Proxy(service, { get(target, property, receiver) { if (policyContext.current?.writeKnowledge === false && property === 'ingestDocument') return (() => { throw new ApplicationServiceError('conflict', 'Knowledge production is disabled for this ResearchRequest') }) as T[Extract<keyof T, string>]; return Reflect.get(target, property, receiver) } })
}

function scopedThesisDecisionService<T extends object>(service: T | undefined, policyContext: ResearchHubPolicyContext | undefined): T | undefined {
  if (service === undefined || policyContext === undefined) return service
  return new Proxy(service, { get(target, property, receiver) {
    const value = Reflect.get(target, property, receiver)
    if (property !== 'decide' || typeof value !== 'function') return value
    return (...args: unknown[]) => {
      const current = policyContext.current
      const input = args[0] as { readonly decision?: unknown } | undefined
      if (current?.structuredKnowledge === false) throw new ApplicationServiceError('conflict', 'Thesis decisions are disabled for this ResearchRequest')
      if (input?.decision === 'ACCEPT' && current?.writeKnowledge === false) throw new ApplicationServiceError('conflict', 'Knowledge writes are disabled for this ResearchRequest')
      return Reflect.apply(value, target, args)
    }
  } })
}

function publicSkillInspection(value: SkillOnboardingInspection | SkillOnboardingRecord): Record<string, unknown> {
  return {
    id: value.id,
    kind: value.kind,
    ...(value.license === undefined ? {} : { license: value.license }),
    dependencies: value.dependencies,
    warnings: value.warnings,
    errors: value.errors,
    provenance: value.provenance,
    manifest: value.manifest,
    ...(!('installedAt' in value) || value.installedAt === undefined ? {} : { installedAt: value.installedAt }),
  }
}

export function createResearchHubTools(inputContext: ResearchHubPiToolContext): ToolDefinition[] {
  const context: ResearchHubPiToolContext = { ...inputContext, knowledgeService: scopedReadService(inputContext.knowledgeService, inputContext.policyContext, ['status', 'searchKnowledge', 'getKnowledgeObject'], 'Structured Knowledge'), reviewService: scopedReadService(inputContext.reviewService, inputContext.policyContext, ['listOpenReviewCases', 'getReviewCase', 'countOpenReviewCases'], 'Review Knowledge'), thesisQueryService: inputContext.thesisQueryService === undefined ? undefined : scopedReadService(inputContext.thesisQueryService, inputContext.policyContext, ['listTheses', 'getThesis'], 'Thesis Knowledge'), thesisDecisionService: scopedThesisDecisionService(inputContext.thesisDecisionService, inputContext.policyContext), productionService: scopedProductionService(inputContext.productionService, inputContext.policyContext), researchService: scopedResearchService(inputContext.researchService, inputContext.policyContext), dailyIntelligenceService: scopedDailyService(inputContext.dailyIntelligenceService, inputContext.policyContext) }
  const status = defineTool({
    name: 'researchhub_status', label: 'ResearchHub status', description: 'Read bounded canonical ResearchHub status. This tool never mutates data.', promptSnippet: 'Inspect ResearchHub status', parameters: Type.Object({}),
    execute: async () => invoke(async () => ({ knowledgeBase: await context.knowledgeService.status(), openReviewCases: await context.reviewService.countOpenReviewCases() })),
  })
  const search = defineTool({
    name: 'search_knowledge', label: 'Search Knowledge', description: 'Deterministically search bounded canonical Knowledge by exact reference or Entity name, alias, and ID.', promptSnippet: 'Search canonical Knowledge', parameters: Type.Object({ query: Type.String(), entityType: Type.Optional(Type.String()), limit: Type.Optional(Type.Number()) }),
    execute: async (_toolCallId, params) => invoke(async () => { integerParam(params.limit, 'limit'); return context.knowledgeService.searchKnowledge({ query: params.query, ...(params.entityType === undefined ? {} : { entityType: params.entityType as never }), limit: params.limit }) }),
  })
  const object = defineTool({
    name: 'get_knowledge_object', label: 'Get Knowledge object', description: 'Read one bounded canonical Knowledge object and related projections.', promptSnippet: 'Read a canonical Knowledge object', parameters: Type.Object({ ref: Type.String(), relatedLimit: Type.Optional(Type.Number()) }),
    execute: async (_toolCallId, params) => invoke(async () => { integerParam(params.relatedLimit, 'relatedLimit'); return context.knowledgeService.getKnowledgeObject(params.ref, params.relatedLimit) }),
  })
  const ingest = defineTool({
    name: 'ingest_document', label: 'Ingest document', description: 'Explicitly ingest text or an existing workspace file through the governed Knowledge Production Workflow.', promptSnippet: 'Ingest a document through Knowledge Production', parameters: Type.Object({ workflowRunId: Type.String(), text: Type.Optional(Type.String()), workspaceFile: Type.Optional(Type.String()), originalFilename: Type.Optional(Type.String()), mediaType: Type.Optional(Type.String()), instructions: Type.Optional(Type.String()), sourceMetadata: Type.Optional(Type.Object({ title: Type.Optional(Type.String()), institution: Type.Optional(Type.String()), author: Type.Optional(Type.String()), publishedAt: Type.Optional(Type.String()), sourceUrl: Type.Optional(Type.String()) })) }),
    execute: async (_toolCallId, params, signal) => invoke(() => context.productionService.ingestDocument(params as IngestDocumentInput, signal), signal),
  })
  const workflowStatus = defineTool({ name: 'get_workflow_status', label: 'Get Workflow status', description: 'Read authoritative application Workflow state.', promptSnippet: 'Inspect Workflow status', parameters: Type.Object({ runId: Type.String() }), execute: async (_toolCallId, params) => invoke(async () => { const result = context.workflowService.getWorkflowStatus(params.runId); if (!result) throw new ApplicationServiceError('not_found', `Workflow run not found: ${params.runId}`); return result }) })
  const cancel = defineTool({ name: 'cancel_workflow', label: 'Cancel Workflow', description: 'Request cancellation of an active Knowledge Production Workflow.', promptSnippet: 'Cancel an active Workflow', parameters: Type.Object({ runId: Type.String() }), execute: async (_toolCallId, params) => invoke(async () => context.workflowService.cancelWorkflow(params.runId)) })
  const reviewList = defineTool({ name: 'list_review_cases', label: 'List ReviewCases', description: 'Read bounded open durable ReviewCase summaries.', promptSnippet: 'List open ReviewCases', parameters: Type.Object({ limit: Type.Optional(Type.Number()), actionability: Type.Optional(Type.String()), category: Type.Optional(Type.String()), producerRunId: Type.Optional(Type.String()) }), execute: async (_toolCallId, params) => invoke(async () => { integerParam(params.limit, 'limit'); return context.reviewService.listOpenReviewCases(params as ReviewCaseListInput) }) })
  const reviewGet = defineTool({ name: 'get_review_case', label: 'Get ReviewCase', description: 'Read one safe bounded durable ReviewCase detail without mutation.', promptSnippet: 'Inspect a ReviewCase', parameters: Type.Object({ reviewCaseId: Type.String(), dependentLimit: Type.Optional(Type.Number()) }), execute: async (_toolCallId, params) => invoke(async () => { integerParam(params.dependentLimit, 'dependentLimit'); return context.reviewService.getReviewCase(params.reviewCaseId, params.dependentLimit) }) })
  const tools = [status, search, object, ingest, workflowStatus, cancel, reviewList, reviewGet]
  if (context.thesisQueryService) {
    tools.push(defineTool({ name: 'list_theses', label: 'List Theses', description: 'List up to 50 active canonical Thesis summaries.', promptSnippet: 'List active canonical Theses', parameters: Type.Object({ limit: Type.Optional(Type.Number()) }), execute: async (_toolCallId, params) => invoke(async () => { integerParam(params.limit, 'limit'); if (params.limit !== undefined && params.limit > 50) throw new ApplicationServiceError('invalid_input', 'limit must be at most 50'); return context.thesisQueryService!.listTheses(params.limit) }) }))
    tools.push(defineTool({ name: 'get_thesis', label: 'Get Thesis', description: 'Read one exact bounded canonical Thesis detail and its propositions.', promptSnippet: 'Read one canonical Thesis', parameters: Type.Object({ thesisRef: Type.String() }), execute: async (_toolCallId, params) => invoke(() => context.thesisQueryService!.getThesis(params.thesisRef)) }))
  }
  if (context.researchService) {
    tools.push(defineTool({ name: 'create_thesis', label: 'Create Thesis', description: 'Create one canonical Thesis from explicitly selected existing company-scoped evidence through Thesis Formalize and Knowledge Production Gateway. This command writes canonical Knowledge.', promptSnippet: 'Create a canonical Thesis from existing admitted evidence', parameters: Type.Object({ workflowRunId: Type.String(), companyRef: Type.String(), thesisTitle: Type.String({ maxLength: 240 }), narrative: Type.String({ maxLength: 8000 }), evidenceRefs: Type.Array(Type.String(), { minItems: 1, maxItems: 40 }), asOf: Type.String() }), execute: async (_toolCallId, params, signal) => invoke(() => context.researchService!.startThesisLifecycleCreate({ workflowRunId: params.workflowRunId, companyRef: params.companyRef as `entity:${string}`, thesisTitle: params.thesisTitle, narrative: params.narrative, evidenceRefs: params.evidenceRefs as (`claim:${string}` | `observation:${string}`)[], asOf: params.asOf }, signal).completion, signal) }))
    tools.push(defineTool({ name: 'refresh_thesis', label: 'Refresh Thesis', description: 'Start the governed Thesis lifecycle REFRESH Workflow for an exact active Thesis.', promptSnippet: 'Refresh one active canonical Thesis', parameters: Type.Object({ thesisRef: Type.String(), asOf: Type.String(), evidenceRefs: Type.Optional(Type.Array(Type.String(), { maxItems: 80 })) }), execute: async (_toolCallId, params, signal) => invoke(() => context.researchService!.startThesisLifecycleRefresh({ thesisRef: params.thesisRef, asOf: params.asOf, ...(params.evidenceRefs === undefined ? {} : { evidenceRefs: params.evidenceRefs }) }, signal).completion, signal) }))
    tools.push(defineTool({ name: 'research_company', label: 'Research company', description: 'Start bounded A-share Company Deep Research and return its linked Report and Knowledge outcome.', promptSnippet: 'Research an A-share company through the governed production Workflow', parameters: Type.Object({ workflowRunId: Type.String(), symbol: Type.String(), name: Type.Optional(Type.String()), exchange: Type.Optional(Type.String()), asOf: Type.Optional(Type.String()), maxSources: Type.Optional(Type.Number()) }), execute: async (_toolCallId, params, signal) => invoke(() => context.researchService!.startResearchCompany(params as ResearchCompanyInput, signal).completion, signal) }))
    tools.push(defineTool({ name: 'research_industry', label: 'Research industry', description: 'Start bounded Industry Deep Research using configured public acquisition sources.', promptSnippet: 'Research an Industry through the governed production Workflow', parameters: Type.Object({ workflowRunId: Type.String(), name: Type.String(), aliases: Type.Optional(Type.Array(Type.String())), canonicalRef: Type.Optional(Type.String()), searchTerms: Type.Optional(Type.Array(Type.String())), asOf: Type.Optional(Type.String()), maxSources: Type.Optional(Type.Number()), maxEvidencePerModule: Type.Optional(Type.Number()) }), execute: async (_toolCallId, params, signal) => invoke(() => context.researchService!.startIndustryResearch(params as IndustryResearchInput, signal).completion, signal) }))
    tools.push(defineTool({ name: 'get_research_report', label: 'Get research report', description: 'Read one bounded persisted Research Report by report ID.', promptSnippet: 'Read a persisted Research Report', parameters: Type.Object({ reportId: Type.String() }), execute: async (_toolCallId, params) => invoke(() => context.researchService!.getResearchReport(params.reportId)) }))
    tools.push(defineTool({ name: 'review_earnings', label: 'Review earnings', description: 'Start an exact-period Earnings Review for an already-covered A-share company.', promptSnippet: 'Review a covered company earnings period', parameters: Type.Object({ workflowRunId: Type.String(), symbol: Type.String(), name: Type.Optional(Type.String()), exchange: Type.Optional(Type.String()), fiscalYear: Type.Number(), period: Type.String(), asOf: Type.Optional(Type.String()) }), execute: async (_toolCallId, params, signal) => invoke(() => context.researchService!.startEarningsReview(params as EarningsReviewInput, signal).completion, signal) }))
    tools.push(defineTool({ name: 'analyze_valuation', label: 'Analyze valuation', description: 'Start a reproducible valuation for an already-covered A-share company using bounded AKShare data and deterministic calculations.', promptSnippet: 'Analyze valuation for a covered company', parameters: Type.Object({ workflowRunId: Type.String(), symbol: Type.String(), name: Type.Optional(Type.String()), exchange: Type.Optional(Type.String()), asOf: Type.Optional(Type.String()), methods: Type.Optional(Type.Array(Type.String())), targetFiscalYear: Type.Optional(Type.Number()) }), execute: async (_toolCallId, params, signal) => invoke(() => context.researchService!.startValuation(params as ValuationInput, signal).completion, signal) }))
      tools.push(defineTool({ name: 'research_event', label: 'Research event', description: 'Start bounded Event Research for one existing A-share Company and an explicit event anchor.', promptSnippet: 'Research a bounded event for a covered company', parameters: Type.Object({ workflowRunId: Type.String(), symbol: Type.String(), name: Type.Optional(Type.String()), exchange: Type.Optional(Type.String()), asOf: Type.Optional(Type.String()), anchor: Type.Union([Type.Object({ kind: Type.Literal('daily_signal'), signalId: Type.String() }), Type.Object({ kind: Type.Literal('article'), url: Type.String(), title: Type.Optional(Type.String()), publishedAt: Type.Optional(Type.String()), content: Type.Optional(Type.String()) }), Type.Object({ kind: Type.Literal('url'), url: Type.String(), title: Type.Optional(Type.String()), publishedAt: Type.Optional(Type.String()) }), Type.Object({ kind: Type.Literal('user_event'), title: Type.String(), description: Type.String(), eventDate: Type.Optional(Type.String()) })]) }), execute: async (_toolCallId, params, signal) => invoke(() => context.researchService!.startEventResearch(params as EventResearchInput, signal).completion, signal) }))
      tools.push(defineTool({ name: 'red_team_thesis', label: 'Red-team thesis', description: 'Adversarially test one exact active canonical Thesis for disconfirming evidence, alternatives, failure cases, and resilience.', promptSnippet: 'Red-team an active canonical thesis', parameters: Type.Object({ workflowRunId: Type.String(), symbol: Type.String(), name: Type.Optional(Type.String()), exchange: Type.Optional(Type.String()), thesisRef: Type.String(), lookbackDays: Type.Optional(Type.Number()) }), execute: async (_toolCallId, params, signal) => invoke(() => context.researchService!.startThesisRedTeam(params as ThesisRedTeamInput, signal).completion, signal) }))
  }
  if (context.thesisDecisionService) {
    tools.push(defineTool({ name: 'decide_thesis_review_case', label: 'Decide Thesis ReviewCase', description: 'Record ACCEPT, REJECT, or DEFER for one exact Thesis lifecycle ReviewCase.', promptSnippet: 'Decide one Thesis lifecycle ReviewCase', parameters: Type.Object({ reviewCaseId: Type.String(), decision: Type.Union([Type.Literal('ACCEPT'), Type.Literal('REJECT'), Type.Literal('DEFER')]), note: Type.Optional(Type.String({ maxLength: 1000 })) }), execute: async (_toolCallId, params) => invoke(() => context.thesisDecisionService!.decide(params)) }))
  }
  if (context.dailyIntelligenceService) {
    const start = (briefType: 'morning' | 'evening') => defineTool({ name: `generate_${briefType}_brief`, label: `Generate ${briefType} brief`, description: `Generate a bounded ${briefType} Daily Intelligence Brief from configured public sources.`, promptSnippet: `Generate ${briefType} Daily Intelligence Brief`, parameters: Type.Object({ workflowRunId: Type.String(), tradeDate: Type.String(), asOf: Type.Optional(Type.String()), forceRefresh: Type.Optional(Type.Boolean()) }), execute: async (_toolCallId, params, signal) => invoke(() => context.dailyIntelligenceService!.startBrief({ ...(params as Omit<DailyBriefInput, 'briefType'>), briefType }, signal).completion, signal) })
    tools.push(start('morning')); tools.push(start('evening'))
    tools.push(defineTool({ name: 'get_daily_brief', label: 'Get daily brief', description: 'Read one bounded persisted Daily Intelligence Brief.', promptSnippet: 'Read a Daily Intelligence Brief', parameters: Type.Object({ reportId: Type.String() }), execute: async (_toolCallId, params) => invoke(() => context.dailyIntelligenceService!.getBrief(params.reportId)) }))
    tools.push(defineTool({ name: 'list_daily_briefs', label: 'List daily briefs', description: 'List recent persisted Daily Intelligence Briefs.', promptSnippet: 'List Daily Intelligence Briefs', parameters: Type.Object({ limit: Type.Optional(Type.Number()) }), execute: async (_toolCallId, params) => invoke(async () => { integerParam(params.limit, 'limit'); return context.dailyIntelligenceService!.listBriefs(params.limit) }) }))
  }
  if (context.sourceLibraryService && context.mountedKnowledgeBaseRoot) {
    tools.push(defineTool({
      name: 'search_source_library', label: 'Search Source Library',
      description: 'Search the lexical Source Library before reasoning and return bounded hits with raw-source provenance.',
      promptSnippet: 'Search the lexical Source Library when the ResearchRequest policy permits it',
      parameters: Type.Object({ query: Type.String(), limit: Type.Optional(Type.Number()) }),
      execute: async (_toolCallId, params, signal) => invoke(async () => {
        if (context.policyContext?.current?.sourceLibrary === false) throw new ApplicationServiceError('conflict', 'Source Library is disabled for this ResearchRequest')
        integerParam(params.limit, 'limit')
        if (signal?.aborted) throw new ApplicationServiceError('cancelled', 'Source Library search was cancelled')
        const handle = await new KnowledgeBaseRegistry().mount(context.mountedKnowledgeBaseRoot!)
        return context.sourceLibraryService!.search(handle, { query: params.query, limit: params.limit })
      }, signal),
    }))
  }
  if (context.skillOnboardingService) {
    const sourceParameters = Type.Object({ url: Type.String(), commit: Type.String() })
    tools.push(defineTool({
      name: 'inspect_external_skill', label: 'Inspect external Skill',
      description: 'Inspect an HTTPS GitHub Skill at an exact 40-character commit. Inspection never installs or registers it.',
      promptSnippet: 'Inspect a pinned external GitHub Skill before any installation decision',
      parameters: sourceParameters,
      execute: async (_toolCallId, params, signal) => invoke(async () => {
        if (signal?.aborted) throw new ApplicationServiceError('cancelled', 'External Skill inspection was cancelled')
        const inspection = await context.skillOnboardingService!.inspectGithubRemote({ url: params.url, commit: params.commit }, context.skillArchiveFetcher)
        return publicSkillInspection(inspection)
      }, signal),
    }))
    tools.push(defineTool({
      name: 'install_external_skill', label: 'Install external Skill',
      description: 'Install a safe inspected GitHub Research Skill or activate a safe Pi-native Skill only at a pinned commit; unsafe Skills are inspect-only in V1.',
      promptSnippet: 'Install a safe pinned external Research Skill or activate a safe Pi-native Skill after inspection',
      parameters: Type.Object({ url: Type.String(), commit: Type.String() }),
      execute: async (_toolCallId, params, signal) => invoke(async () => {
        if (signal?.aborted) throw new ApplicationServiceError('cancelled', 'External Skill installation was cancelled')
        const source = { url: params.url, commit: params.commit }
        const inspection = await context.skillOnboardingService!.inspectGithubRemote(source, context.skillArchiveFetcher)
        if (inspection.kind === 'unsafe') throw new ApplicationServiceError('conflict', `UNSAFE_SKILL_REQUIRES_MANUAL_TRUST_REVIEW: ${inspection.errors.join('; ') || inspection.warnings.join('; ') || 'unsafe Skill content'}`)
        if (inspection.kind === 'unsupported' || inspection.kind === 'knowledge' || inspection.kind === 'utility') throw new ApplicationServiceError('conflict', `EXTERNAL_SKILL_UNSUPPORTED_ACTIVATION: ${inspection.id}`)
        if (inspection.kind === 'pi_native' && (context.piNativeSkillsRoot === undefined || context.resourceLoader === undefined)) throw new ApplicationServiceError('conflict', 'PI_NATIVE_SKILL_ACTIVATION_UNAVAILABLE: Pi resource loader is not available')
        const record = await context.skillOnboardingService!.onboardGithub(source, inspection.kind === 'pi_native' ? { destinationRoot: context.piNativeSkillsRoot } : {}, context.skillArchiveFetcher)
        if (record.kind === 'pi_native') {
          await context.resourceLoader!.reload()
          const available = context.resourceLoader!.getSkills().skills.some((skill) => skill.name === record.id)
          if (!available) throw new ApplicationServiceError('conflict', `PI_NATIVE_SKILL_NOT_DISCOVERABLE: ${record.id}`)
          return { ...publicSkillInspection(record), activation: 'pi_native', reloaded: true, discoverable: true }
        }
        const registeredResearchSkill = context.researchDispatchService === undefined ? undefined : registerOnboardedResearchSkill(context.researchDispatchService.skillRegistry, record)
        return { ...publicSkillInspection(record), ...(registeredResearchSkill === undefined ? {} : { registeredResearchSkill }) }
      }, signal),
    }))
  }
  return tools
}
