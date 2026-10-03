import { join, resolve } from 'node:path'
import { getAgentDir, ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent'
import { PiReasoningExecutor } from '../../plugins/reasoning/pi/executor.ts'
import { createCodexCliLunaReasoningExecutor, createIndustryProductionReasoningExecutor, createThemeFrameworkProductionReasoningExecutor, selectProductionReasoningModel } from '../pi/model-selection.ts'
import { KnowledgeService } from '../services/knowledge-service.ts'
import { KnowledgeGraphService } from '../services/knowledge-graph-service.ts'
import { KnowledgeTopicProjectionService } from '../services/knowledge-topic-projection.ts'
import { ThemeWorkspaceProjectionService } from '../services/theme-workspace-projection.ts'
import { ProductionService } from '../services/production-service.ts'
import { ReviewService } from '../services/review-service.ts'
import { WorkflowService } from '../services/workflow-service.ts'
import { ResearchService } from '../services/research-service.ts'
import { FileResearchSignalStore } from '../../plugins/research-acquisition/signal-store.ts'
import { FileDailySignalStore } from '../../plugins/daily-intelligence/signal-store.ts'
import { CninfoOfficialDisclosureClient, OfficialDisclosureResearchPlugin } from '../../plugins/research-acquisition/official.ts'
import { createManagementCommunicationSources } from '../../workflows/management-communication-acquisition/workflow.ts'
import { GdeltResearchPlugin } from '../../plugins/research-acquisition/gdelt.ts'
import { AkshareDataAdapter } from '../../plugins/research-acquisition/akshare.ts'
import { EastmoneyIndustryResearchPlugin } from '../../plugins/research-acquisition/eastmoney-industry.ts'
import { GovCnIndustryResearchPlugin } from '../../plugins/research-acquisition/govcn-industry.ts'
import { MiitIndustryResearchPlugin } from '../../plugins/research-acquisition/miit-industry.ts'
import { CpcaIndustryResearchPlugin } from '../../plugins/research-acquisition/cpca-industry.ts'
import { IndustryOperatingObservationAcquisition } from '../../plugins/research-acquisition/industry-operating-observations.ts'
import { loadKnowledgeBaseManifest } from '../../knowledge/storage/manifest-loader.ts'
import { createResearchHubSessionRuntime, ResearchHubSessionRuntime } from './session-runtime.ts'
import { validateStorageRoots } from './storage-boundary.ts'
import type { ResearchHubApplicationRuntimeOptions, ResearchHubApplicationServices } from './contracts.ts'
import { createDailyIntelligenceComposition } from '../services/daily-intelligence-composition.ts'
import { DailyBriefScheduler } from '../../plugins/daily-intelligence/scheduler.ts'
import { TradingCalendarService } from '../../plugins/daily-intelligence/calendar.ts'
import type { ReasoningExecutor } from '../../plugins/reasoning/contracts.ts'
import { ResearchDispatchService } from '../services/research-dispatch-service.ts'
import { FileResearchBundleStore } from '../services/research-bundle.ts'
import { SourceLibraryService } from '../services/source-library.ts'
import { createResearchSkillRegistry } from '../services/skill-registry.ts'
import { loadOnboardedResearchSkillDefinitions, SkillOnboardingService } from '../services/skill-onboarding.ts'
import { ThesisQueryService } from '../services/thesis-query-service.ts'
import { ThesisDecisionService } from '../services/thesis-decision-service.ts'
import { ThesisCriterionService } from '../services/thesis-criterion-service.ts'
import { ThemeFrameworkService } from '../services/theme-framework-service.ts'
import { ThemeScopeImpactService } from '../services/theme-scope-impact-service.ts'
import { ThemeFrameworkAcquisitionAdapter } from '../../plugins/research-acquisition/theme-framework-acquisition.ts'
import { AkshareIndustryResearchPlugin } from '../../plugins/research-acquisition/industry.ts'
import { loadReviewCase } from '../../knowledge/review/store.ts'
import { loadReviewDecision } from '../../knowledge/review/decision-store.ts'

const DURABLE_THESIS_DECISION_STATES = new Set(['ACCEPTED', 'REJECTED', 'DEFERRED', 'STALE'])
type DurableThesisDecisionState = 'ACCEPTED' | 'REJECTED' | 'DEFERRED' | 'STALE'
interface ThesisDecisionReportUpdate { readonly status: 'updated' | 'not_found' | 'failed'; readonly reportId: string; readonly errors: readonly string[] }
const RESULT_STATE: Readonly<Record<string, DurableThesisDecisionState | undefined>> = { accepted: 'ACCEPTED', rejected: 'REJECTED', deferred: 'DEFERRED', stale: 'STALE' }

function withThesisDecisionReportSync(service: ThesisDecisionService, researchService: ResearchService | undefined, mountedKnowledgeBaseRoot: string): ThesisDecisionService {
  return new Proxy(service, { get(target, property, receiver) {
    const method = Reflect.get(target, property, receiver)
    if (property !== 'decide' || typeof method !== 'function') return method
    return async (...args: Parameters<ThesisDecisionService['decide']>) => {
      const result = await Reflect.apply(method, target, args) as Awaited<ReturnType<ThesisDecisionService['decide']>>
      if (!result.decisionState) return result
      const recorder = researchService as (ResearchService & { recordThesisLifecycleDecision?: (value: { readonly producerRunId: string; readonly reviewCaseId: string; readonly decisionState: DurableThesisDecisionState; readonly writerRunId?: string; readonly knowledgeBaseRevision: number; readonly committedRevision?: number; readonly diagnostics?: readonly string[] }) => Promise<ThesisDecisionReportUpdate> }) | undefined
      try {
        const input = args[0]
        const reviewCase = await loadReviewCase(mountedKnowledgeBaseRoot, input.reviewCaseId)
        if (!reviewCase) return result
        const persistedDecision = await loadReviewDecision(mountedKnowledgeBaseRoot, reviewCase.producerRunId, reviewCase.reviewCaseId)
        const decisionState = persistedDecision?.state
        if (!decisionState || !DURABLE_THESIS_DECISION_STATES.has(decisionState)) return result
        // A conflict can report the already-persisted terminal state while
        // carrying no Writer metadata. Never let that response replace the
        // report for the successful decision that established the state.
        if (RESULT_STATE[result.status] !== decisionState) return result
        if (!recorder?.recordThesisLifecycleDecision) return { ...result, reportUpdate: { status: 'failed', reason: 'REPORT_UPDATE_UNAVAILABLE' } }
        const knowledgeBaseRevision = result.committedRevision ?? result.knowledgeBaseRevision ?? reviewCase.resolutionContext.knowledgeBaseRevisionAtCreation
        const update = await recorder.recordThesisLifecycleDecision({ producerRunId: reviewCase.producerRunId, reviewCaseId: reviewCase.reviewCaseId, decisionState: decisionState as DurableThesisDecisionState, ...(result.writerRunId === undefined ? {} : { writerRunId: result.writerRunId }), knowledgeBaseRevision, ...(result.committedRevision === undefined ? {} : { committedRevision: result.committedRevision }), diagnostics: result.errors })
        return { ...result, reportUpdate: { status: update.status, reportId: update.reportId, errors: update.errors } }
      } catch {
        return DURABLE_THESIS_DECISION_STATES.has(result.decisionState) ? { ...result, reportUpdate: { status: 'failed', errors: ['REPORT_UPDATE_FAILED'] } } : result
      }
    }
  } })
}

export class ResearchHubApplicationRuntime {
  readonly cwd: string
  readonly agentDir: string
  readonly workspaceRoot: string
  readonly mountedKnowledgeBaseRoot?: string
  readonly modelRuntime: ModelRuntime
  readonly sessionManager: SessionManager
  readonly services: ResearchHubApplicationServices
  readonly sessionRuntime: ResearchHubSessionRuntime
  private readonly ownsModelRuntime: boolean
  private readonly dailyScheduler?: DailyBriefScheduler
  private readonly dailySchedulerTimer?: NodeJS.Timeout
  private closed = false

  private constructor(input: {
    readonly cwd: string
    readonly agentDir: string
    readonly workspaceRoot: string
    readonly mountedKnowledgeBaseRoot?: string
    readonly modelRuntime: ModelRuntime
    readonly sessionManager: SessionManager
    readonly services: ResearchHubApplicationServices
    readonly sessionRuntime: ResearchHubSessionRuntime
    readonly ownsModelRuntime: boolean
    readonly dailyScheduler?: DailyBriefScheduler
    readonly dailySchedulerTimer?: NodeJS.Timeout
  }) {
    this.cwd = input.cwd
    this.agentDir = input.agentDir
    this.workspaceRoot = input.workspaceRoot
    this.mountedKnowledgeBaseRoot = input.mountedKnowledgeBaseRoot
    this.modelRuntime = input.modelRuntime
    this.sessionManager = input.sessionManager
    this.services = input.services
    this.sessionRuntime = input.sessionRuntime
    this.ownsModelRuntime = input.ownsModelRuntime
    this.dailyScheduler = input.dailyScheduler
    this.dailySchedulerTimer = input.dailySchedulerTimer
  }

  static async create(options: ResearchHubApplicationRuntimeOptions): Promise<ResearchHubApplicationRuntime> {
    const cwd = resolve(options.cwd)
    const agentDir = resolve(options.agentDir ?? getAgentDir())
    const workspaceRoot = resolve(options.workspaceRoot ?? join(cwd, 'workspace'))
    const mountedKnowledgeBaseRoot = options.mountedKnowledgeBaseRoot === undefined ? undefined : resolve(options.mountedKnowledgeBaseRoot)
    if (mountedKnowledgeBaseRoot !== undefined) await validateStorageRoots(workspaceRoot, mountedKnowledgeBaseRoot)
    const ownsModelRuntime = options.modelRuntime === undefined
    const modelRuntime = options.modelRuntime ?? await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: join(agentDir, 'models.json'), allowModelNetwork: false, refreshOnCreate: false })
    const selectedModel = options.model ?? (options.modelRuntime === undefined ? selectProductionReasoningModel(modelRuntime) : undefined)
    const reasoningExecutor = options.reasoningExecutor ?? new PiReasoningExecutor({ modelRuntime, model: selectedModel })
    const knowledgeService = new KnowledgeService(mountedKnowledgeBaseRoot)
    const knowledgeGraphService = new KnowledgeGraphService(mountedKnowledgeBaseRoot)
    const knowledgeTopicProjectionService = new KnowledgeTopicProjectionService(mountedKnowledgeBaseRoot)
    const themeWorkspaceProjectionService = new ThemeWorkspaceProjectionService(mountedKnowledgeBaseRoot, undefined, reasoningExecutor)
    const reviewService = new ReviewService(mountedKnowledgeBaseRoot)
    let thesisQueryService: ThesisQueryService | undefined
    let thesisDecisionService: ThesisDecisionService | undefined
    let thesisCriterionService: ThesisCriterionService | undefined
    let themeScopeImpactService: ThemeScopeImpactService | undefined
    let isSchema04KnowledgeBase = false
    if (mountedKnowledgeBaseRoot !== undefined) {
      try {
        const manifest = await loadKnowledgeBaseManifest(mountedKnowledgeBaseRoot)
        if (manifest.schemaVersion === '0.4' && manifest.storageFormatVersion === '1') {
          isSchema04KnowledgeBase = true
          thesisQueryService = new ThesisQueryService(mountedKnowledgeBaseRoot)
          thesisDecisionService = new ThesisDecisionService({ mountedKnowledgeBaseRoot })
          if (manifest.status === 'active') {
            thesisCriterionService = new ThesisCriterionService({ mountedKnowledgeBaseRoot })
            themeScopeImpactService = new ThemeScopeImpactService({ mountedKnowledgeBaseRoot })
          }
        }
      } catch { /* Thesis projections and decisions require a readable Schema 0.4 Knowledge Base. */ }
    }
    const workflowService = new WorkflowService()
    const rawDocumentPreviewReasoningExecutorFactory = isSchema04KnowledgeBase && options.reasoningExecutor === undefined
      ? () => createCodexCliLunaReasoningExecutor({ capabilities: reasoningExecutor.capabilities() })
      : undefined
    const productionService = new ProductionService({ mountedKnowledgeBaseRoot, workspaceRoot, cwd, reasoningExecutor, workflowService, ...(rawDocumentPreviewReasoningExecutorFactory === undefined ? {} : { rawDocumentPreviewReasoningExecutorFactory }), ...(themeScopeImpactService === undefined ? {} : { themeScopeImpactChecker: themeScopeImpactService }) })
    let researchService = options.researchService
    let themeFrameworkService = options.themeFrameworkService
    const akshare = new AkshareDataAdapter()
    const industryAcquisitionPlugins = options.industryAcquisitionPlugins ?? [new MiitIndustryResearchPlugin(), new GovCnIndustryResearchPlugin(), new EastmoneyIndustryResearchPlugin(), new CpcaIndustryResearchPlugin()]
    let industryReasoningExecutorFactory = options.industryReasoningExecutorFactory
    if (industryReasoningExecutorFactory === undefined && options.reasoningExecutor === undefined) {
      let industryExecutorPromise: Promise<ReasoningExecutor> | undefined
      industryReasoningExecutorFactory = () => industryExecutorPromise ??= createIndustryProductionReasoningExecutor({ capabilities: reasoningExecutor.capabilities() })
    }
    const dailyComposition = options.dailyIntelligenceService === undefined ? await createDailyIntelligenceComposition({ cwd, workflowService, reasoningExecutor, modelRuntime, mountedKnowledgeBaseRoot, industryOperatingObservationAcquisition: options.industryOperatingObservationAcquisition }) : undefined
    const dailyIntelligenceService = options.dailyIntelligenceService ?? dailyComposition!.service
    if (researchService === undefined && mountedKnowledgeBaseRoot !== undefined) {
      try { const manifest = await loadKnowledgeBaseManifest(mountedKnowledgeBaseRoot); if (manifest.schemaVersion === '0.4' && manifest.storageFormatVersion === '1') { const dailySignalStore = new FileDailySignalStore(join(cwd, 'runtime-data', 'daily-signals.jsonl')); const cninfo = new CninfoOfficialDisclosureClient(); researchService = new ResearchService({ mountedKnowledgeBaseRoot, cwd, workflowService, reasoningExecutor, industryReasoningExecutorFactory, industryOperatingObservationAcquisition: options.industryOperatingObservationAcquisition ?? new IndustryOperatingObservationAcquisition(), signalStore: new FileResearchSignalStore(join(cwd, 'runtime-data', 'research-signals.jsonl')), dailySignalStore, acquisitionPlugins: [new OfficialDisclosureResearchPlugin(cninfo), new GdeltResearchPlugin()], industryAcquisitionPlugins, akshare, officialDisclosure: cninfo, managementCommunicationSources: createManagementCommunicationSources(cninfo, akshare), ...(themeScopeImpactService === undefined ? {} : { themeScopeImpactChecker: themeScopeImpactService }) }) } } catch { /* the normal v0.3 runtime remains available without Company Research */ }
    }
    if (themeFrameworkService === undefined && mountedKnowledgeBaseRoot !== undefined) {
      try {
        const manifest = await loadKnowledgeBaseManifest(mountedKnowledgeBaseRoot)
        if (manifest.schemaVersion === '0.4' && manifest.storageFormatVersion === '1' && manifest.status === 'active') {
          const themeFrameworkReasoningExecutor = options.reasoningExecutor ?? await createThemeFrameworkProductionReasoningExecutor({ capabilities: reasoningExecutor.capabilities() })
          themeFrameworkService = new ThemeFrameworkService({
            mountedKnowledgeBaseRoot,
            workflowService,
            reasoningExecutor: themeFrameworkReasoningExecutor,
            acquisition: new ThemeFrameworkAcquisitionAdapter({ knowledgeBaseRoot: mountedKnowledgeBaseRoot, plugins: [...industryAcquisitionPlugins, new AkshareIndustryResearchPlugin(akshare)] }),
          })
        }
      } catch { /* Theme Framework requires a readable active Schema 0.4 Knowledge Base. */ }
    }
    if (thesisDecisionService !== undefined && mountedKnowledgeBaseRoot !== undefined) thesisDecisionService = withThesisDecisionReportSync(thesisDecisionService, researchService, mountedKnowledgeBaseRoot)
    const skillRegistry = createResearchSkillRegistry(); for (const definition of await loadOnboardedResearchSkillDefinitions(join(cwd, 'runtime-data', 'skill-onboarding'))) { try { skillRegistry.register(definition) } catch { /* duplicate or invalid external records remain excluded */ } }
    const sourceLibraryService = new SourceLibraryService(join(cwd, 'runtime-data', 'source-library'))
    const skillOnboardingService = new SkillOnboardingService(join(cwd, 'runtime-data', 'skill-onboarding', 'installed'), join(cwd, 'runtime-data', 'skill-onboarding'))
    const researchDispatchService = new ResearchDispatchService({ researchService, dailyIntelligenceService, workflowService, skillRegistry, bundleStore: new FileResearchBundleStore(join(cwd, 'runtime-data', 'research-bundles')), sourceLibraryService, mountedKnowledgeBaseRoot, reasoningExecutor, ...(themeFrameworkService === undefined ? {} : { themeFrameworkService }) })
    const services = { knowledgeService, knowledgeGraphService, knowledgeTopicProjectionService, themeWorkspaceProjectionService, reviewService, workflowService, productionService, researchDispatchService, sourceLibraryService, skillOnboardingService, ...(researchService === undefined ? {} : { researchService }), ...(themeFrameworkService === undefined ? {} : { themeFrameworkService }), ...(themeScopeImpactService === undefined ? {} : { themeScopeImpactService }), ...(thesisQueryService === undefined ? {} : { thesisQueryService }), ...(thesisDecisionService === undefined ? {} : { thesisDecisionService }), ...(thesisCriterionService === undefined ? {} : { thesisCriterionService }), dailyIntelligenceService }
    const { thesisCriterionService: _humanOnlyCriterionService, ...piApplicationServices } = services
    void _humanOnlyCriterionService
    const sessionManager = options.sessionManager ?? SessionManager.create(cwd, options.sessionDir)
    try {
      const sessionRuntime = await createResearchHubSessionRuntime({ cwd, agentDir, modelRuntime, sessionManager, applicationServices: piApplicationServices, mountedKnowledgeBaseRoot, workspaceRoot, model: selectedModel, reasoningExecutor, settingsManager: options.settingsManager, resourceLoader: options.resourceLoader, researchService, dailyIntelligenceService })
      const dailyScheduler = new DailyBriefScheduler({ statePath: join(cwd, 'runtime-data', 'daily-scheduler.json'), calendar: dailyComposition?.calendar ?? dailyIntelligenceService.calendar ?? new TradingCalendarService({ cachePath: join(cwd, 'runtime-data', 'trading-calendar.json') }), run: async (briefType, tradeDate) => { const run = dailyIntelligenceService.startBrief({ workflowRunId: `scheduled-${briefType}-${tradeDate}`, briefType, tradeDate }); const result = await run.completion; return { status: result.status } } })
      const dailySchedulerTimer = setInterval(() => { void dailyScheduler.tick(new Date()).catch(() => undefined) }, 60_000); dailySchedulerTimer.unref?.(); void dailyScheduler.tick(new Date()).catch(() => undefined)
      return new ResearchHubApplicationRuntime({ cwd, agentDir, workspaceRoot, mountedKnowledgeBaseRoot, modelRuntime, sessionManager, services, sessionRuntime, ownsModelRuntime, dailyScheduler, dailySchedulerTimer })
    } catch (error) {
      if (ownsModelRuntime) await disposeModelRuntime(modelRuntime)
      throw error
    }
  }

  get knowledgeService(): KnowledgeService { return this.services.knowledgeService }
  get knowledgeGraphService(): KnowledgeGraphService { return this.services.knowledgeGraphService }
  get knowledgeTopicProjectionService(): KnowledgeTopicProjectionService { return this.services.knowledgeTopicProjectionService! }
  get reviewService(): ReviewService { return this.services.reviewService }
  get workflowService(): WorkflowService { return this.services.workflowService }
  get productionService(): ProductionService { return this.services.productionService }
  get researchService() { return this.services.researchService }
  get dailyIntelligenceService() { return this.services.dailyIntelligenceService }
  get scheduler(): DailyBriefScheduler | undefined { return this.dailyScheduler }

  async close(): Promise<void> {
    if (this.closed) return
    let sessionError: unknown
    try {
      if (this.dailySchedulerTimer !== undefined) clearInterval(this.dailySchedulerTimer)
      await this.sessionRuntime.dispose()
    } catch (error) {
      sessionError = error
    } finally {
      if (this.ownsModelRuntime) {
        try {
          await disposeModelRuntime(this.modelRuntime)
        } catch (error) {
          if (sessionError === undefined) sessionError = error
          else sessionError = new AggregateError([sessionError, error], 'Application runtime disposal failed')
        }
      }
    }
    if (sessionError !== undefined) throw sessionError
    this.closed = true
  }

  async dispose(): Promise<void> { return this.close() }
}

async function disposeModelRuntime(modelRuntime: ModelRuntime): Promise<void> {
  const candidate = modelRuntime as unknown as { readonly dispose?: () => void | Promise<void> }
  if (typeof candidate.dispose === 'function') await candidate.dispose()
}

export async function createResearchHubApplicationRuntime(options: ResearchHubApplicationRuntimeOptions): Promise<ResearchHubApplicationRuntime> { return ResearchHubApplicationRuntime.create(options) }
