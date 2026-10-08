import { join, resolve } from 'node:path'
import { getAgentDir, ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent'
import { registerModelConnections } from './model-connections.ts'
import { PiReasoningExecutor } from '../../plugins/reasoning/pi/executor.ts'
import { RAW_DOCUMENT_PREVIEW_PRODUCTION_REASONING_TIMEOUT_MS, THEME_FRAMEWORK_PRODUCTION_REASONING_TIMEOUT_MS, selectProductionReasoningModel, validateReasoningModelSelection } from '../pi/model-selection.ts'
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
import { createRuntimeIndustryDataResolverFactory } from '../services/industry-data-resolver-factory.ts'
import { DailyBriefScheduler } from '../../plugins/daily-intelligence/scheduler.ts'
import { TradingCalendarService } from '../../plugins/daily-intelligence/calendar.ts'
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
import { createDataSourceAdministrationService } from '../services/data-source-administration.ts'
import { FileDataSourceTestStore } from '../services/data-source-test-store.ts'
import { createSourceCredentialStore } from './source-credential-store.ts'
import { mergeSourceIntegrations, sourceIntegration } from '../services/data-source-integrations.ts'
import type { DataSourceIntegrationDefinition } from '../services/data-source-administration-contracts.ts'
import { createDataSourceOnboardingService } from '../services/data-source-onboarding-store.ts'
import { PHASE2_COMMON_SOURCE_POLICIES } from '../../data/valuation-earnings-policies.ts'
import { createValuationDataResolver } from '../../plugins/research-acquisition/valuation-data.ts'
import { createEarningsDataResolver } from '../../plugins/research-acquisition/earnings-data.ts'
import { createManagementCommunicationDataResolver } from '../../plugins/research-acquisition/management-communication-data.ts'
import { selectOfficialEarningsFilings } from '../../workflows/earnings-review/workflow.ts'

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
  private dailySchedulerTimer?: NodeJS.Timeout
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
  }

  static async create(options: ResearchHubApplicationRuntimeOptions): Promise<ResearchHubApplicationRuntime> {
    const cwd = resolve(options.cwd)
    const agentDir = resolve(options.agentDir ?? getAgentDir())
    const workspaceRoot = resolve(options.workspaceRoot ?? join(cwd, 'workspace'))
    const mountedKnowledgeBaseRoot = options.mountedKnowledgeBaseRoot === undefined ? undefined : resolve(options.mountedKnowledgeBaseRoot)
    if (mountedKnowledgeBaseRoot !== undefined) await validateStorageRoots(workspaceRoot, mountedKnowledgeBaseRoot)
    const ownsModelRuntime = options.modelRuntime === undefined
    const modelRuntime = options.modelRuntime ?? await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: join(agentDir, 'models.json'), allowModelNetwork: false, refreshOnCreate: false })
    let selectedModel: import('@earendil-works/pi-ai').Model<import('@earendil-works/pi-ai').Api> | undefined
    try {
      if (ownsModelRuntime) await registerModelConnections(modelRuntime, cwd)
      if (options.modelSelection !== undefined && options.model !== undefined && (options.modelSelection.provider !== options.model.provider || options.modelSelection.modelId !== options.model.id)) throw new Error('model and modelSelection specify different models')
      selectedModel = options.modelSelection === undefined ? options.model : await validateReasoningModelSelection(modelRuntime, options.modelSelection)
      if (selectedModel === undefined && options.modelRuntime === undefined) selectedModel = selectProductionReasoningModel(modelRuntime)
    } catch (error) {
      if (ownsModelRuntime) await disposeModelRuntime(modelRuntime)
      throw error
    }
    const reasoningExecutor = options.reasoningExecutor ?? new PiReasoningExecutor({ modelRuntime, model: selectedModel })
    const knowledgeService = new KnowledgeService(mountedKnowledgeBaseRoot)
    const knowledgeGraphService = new KnowledgeGraphService(mountedKnowledgeBaseRoot)
    const knowledgeTopicProjectionService = new KnowledgeTopicProjectionService(mountedKnowledgeBaseRoot)
    const themeWorkspaceProjectionService = new ThemeWorkspaceProjectionService(mountedKnowledgeBaseRoot, undefined, reasoningExecutor)
    const reviewService = new ReviewService(mountedKnowledgeBaseRoot)
    let isSchema04KnowledgeBase = false
    let thesisQueryService: ThesisQueryService | undefined
    let thesisDecisionService: ThesisDecisionService | undefined
    let thesisCriterionService: ThesisCriterionService | undefined
    let themeScopeImpactService: ThemeScopeImpactService | undefined
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
      ? async () => new PiReasoningExecutor({ modelRuntime, model: selectedModel, capabilities: reasoningExecutor.capabilities(), timeoutMs: RAW_DOCUMENT_PREVIEW_PRODUCTION_REASONING_TIMEOUT_MS })
      : undefined
    const productionService = new ProductionService({ mountedKnowledgeBaseRoot, workspaceRoot, cwd, reasoningExecutor, workflowService, ...(rawDocumentPreviewReasoningExecutorFactory === undefined ? {} : { rawDocumentPreviewReasoningExecutorFactory }), ...(themeScopeImpactService === undefined ? {} : { themeScopeImpactChecker: themeScopeImpactService }) })
    let researchService = options.researchService
    let themeFrameworkService = options.themeFrameworkService
    const akshare = new AkshareDataAdapter()
    const industryAcquisitionPlugins = options.industryAcquisitionPlugins ?? [new MiitIndustryResearchPlugin(), new GovCnIndustryResearchPlugin(), new EastmoneyIndustryResearchPlugin(), new CpcaIndustryResearchPlugin()]
    const researchIntegrationDefinitions: DataSourceIntegrationDefinition[] = []
    let industryProvidersAssembled = false
    const industryReasoningExecutorFactory = options.industryReasoningExecutorFactory
    const dailyComposition = options.dailyIntelligenceService === undefined ? await createDailyIntelligenceComposition({ cwd, workflowService, reasoningExecutor, modelRuntime, mountedKnowledgeBaseRoot, industryOperatingObservationAcquisition: options.industryOperatingObservationAcquisition, akshare }) : undefined
    const industryOperatingObservationAcquisition = options.industryOperatingObservationAcquisition ?? dailyComposition?.industryOperatingObservationAcquisition ?? new IndustryOperatingObservationAcquisition()
    const industryDataResolverFactory = options.industryDataResolverFactory ?? createRuntimeIndustryDataResolverFactory({ plugins: industryAcquisitionPlugins, metricAcquisition: industryOperatingObservationAcquisition as never, ...(options.industryDataCatalog ? { catalog: options.industryDataCatalog } : {}) })
    const dailyIntelligenceService = options.dailyIntelligenceService ?? dailyComposition!.service
    if (researchService === undefined && mountedKnowledgeBaseRoot !== undefined) {
      try { const manifest = await loadKnowledgeBaseManifest(mountedKnowledgeBaseRoot); if (manifest.schemaVersion === '0.4' && manifest.storageFormatVersion === '1') { const dailySignalStore = new FileDailySignalStore(join(cwd, 'runtime-data', 'daily-signals.jsonl')); const cninfo = new CninfoOfficialDisclosureClient(); const official = new OfficialDisclosureResearchPlugin(cninfo); const gdelt = new GdeltResearchPlugin(); researchService = new ResearchService({ mountedKnowledgeBaseRoot, cwd, workflowService, reasoningExecutor, industryReasoningExecutorFactory, industryDataResolverFactory, signalStore: new FileResearchSignalStore(join(cwd, 'runtime-data', 'research-signals.jsonl')), dailySignalStore, acquisitionPlugins: [official, gdelt], researchEvidenceProviders: { cninfo: official, gdelt }, industryAcquisitionPlugins, akshare, officialDisclosure: cninfo, valuationDataResolverFactory: ({ company, valuationDate, asOf, now, signal }) => createValuationDataResolver({ akshare, officialDisclosure: cninfo, company, valuationDate, ...(asOf ? { historicalAsOf: asOf } : {}), now, signal }), earningsDataResolverFactory: ({ company, fiscalYear, period, asOf, now, signal }) => createEarningsDataResolver({ company, fiscalYear, period, asOf, now, signal, acquisitionPlugins: [official], officialDisclosurePlugin: official, akshare, selectFilings: (candidates, year, filingPeriod, cutoff) => selectOfficialEarningsFilings(candidates, { fiscalYear: year, period: filingPeriod }, cutoff) }), managementCommunicationSources: createManagementCommunicationSources(cninfo, akshare), managementCommunicationDataResolverFactory: (options) => createManagementCommunicationDataResolver(options), ...(themeScopeImpactService === undefined ? {} : { themeScopeImpactChecker: themeScopeImpactService }) }); industryProvidersAssembled = true; researchIntegrationDefinitions.push(
        sourceIntegration({ id: 'cninfo', name: 'CNINFO', sourceIds: ['cninfo-annual-report-publication', 'cninfo-official-ir'], capabilities: [{ id: 'company-disclosures', label: 'Company disclosures', metricIds: ['valuation_annual_report_publication', 'management_communication_documents'] }] }),
        sourceIntegration({ id: 'gdelt', name: 'GDELT', capabilities: [{ id: 'company-news', label: 'Company news', metricIds: [] }] }),
        sourceIntegration({ id: 'akshare', name: 'AKShare', sourceIds: ['akshare-historical-market-data', 'akshare-valuation-financial-indicators-eps', 'akshare-valuation-financial-indicators-bvps', 'ths-institution-forecast', 'eastmoney-individual-research-report', 'sse-einteraction', 'szse-hudongyi'], capabilities: [{ id: 'company-market-and-financials', label: 'Company market and financial data', metricIds: ['valuation_market_price', 'valuation_eps', 'valuation_bvps'] }, { id: 'company-expectations', label: 'Company expectations', metricIds: ['earnings_expectation_eps', 'earnings_expectation_net_profit'] }, { id: 'exchange-qa', label: 'Exchange investor Q&A', metricIds: ['exchange_qa_sse', 'exchange_qa_szse'] }] }),
      ) } } catch { /* the normal v0.3 runtime remains available without Company Research */ }
    }
    if (themeFrameworkService === undefined && mountedKnowledgeBaseRoot !== undefined) {
      try {
        const manifest = await loadKnowledgeBaseManifest(mountedKnowledgeBaseRoot)
        if (manifest.schemaVersion === '0.4' && manifest.storageFormatVersion === '1' && manifest.status === 'active') {
          themeFrameworkService = new ThemeFrameworkService({
            mountedKnowledgeBaseRoot,
            workflowService,
            reasoningExecutor: options.reasoningExecutor ?? new PiReasoningExecutor({ modelRuntime, model: selectedModel, capabilities: reasoningExecutor.capabilities(), timeoutMs: THEME_FRAMEWORK_PRODUCTION_REASONING_TIMEOUT_MS }),
            acquisition: new ThemeFrameworkAcquisitionAdapter({ knowledgeBaseRoot: mountedKnowledgeBaseRoot, plugins: [...industryAcquisitionPlugins, new AkshareIndustryResearchPlugin(akshare)] }),
          })
          industryProvidersAssembled = true
          researchIntegrationDefinitions.push(sourceIntegration({ id: 'akshare', name: 'AKShare', capabilities: [{ id: 'industry-structured-data', label: 'Industry structured data', metricIds: [] }] }))
        }
      } catch { /* Theme Framework requires a readable active Schema 0.4 Knowledge Base. */ }
    }
    if (thesisDecisionService !== undefined && mountedKnowledgeBaseRoot !== undefined) thesisDecisionService = withThesisDecisionReportSync(thesisDecisionService, researchService, mountedKnowledgeBaseRoot)
    if (industryProvidersAssembled && options.industryAcquisitionPlugins === undefined) researchIntegrationDefinitions.push(
      sourceIntegration({ id: 'miit', name: 'MIIT', capabilities: [{ id: 'industry-official-research', label: 'Industry official research', metricIds: [] }] }),
      sourceIntegration({ id: 'gov-cn', name: 'Gov.cn', capabilities: [{ id: 'industry-policy-research', label: 'Industry policy research', metricIds: [] }] }),
      sourceIntegration({ id: 'eastmoney-industry', name: 'EastMoney industry', capabilities: [{ id: 'industry-board-data', label: 'Industry board data', metricIds: [] }] }),
      sourceIntegration({ id: 'cpca', name: 'CPCA', capabilities: [{ id: 'industry-association-research', label: 'Industry association research', metricIds: [] }] }),
    )
    const skillRegistry = createResearchSkillRegistry(); for (const definition of await loadOnboardedResearchSkillDefinitions(join(cwd, 'runtime-data', 'skill-onboarding'))) { try { skillRegistry.register(definition) } catch { /* duplicate or invalid external records remain excluded */ } }
    const sourceLibraryService = new SourceLibraryService(join(cwd, 'runtime-data', 'source-library'))
    const skillOnboardingService = new SkillOnboardingService(join(cwd, 'runtime-data', 'skill-onboarding', 'installed'), join(cwd, 'runtime-data', 'skill-onboarding'))
    const researchDispatchService = new ResearchDispatchService({ researchService, dailyIntelligenceService, workflowService, skillRegistry, bundleStore: new FileResearchBundleStore(join(cwd, 'runtime-data', 'research-bundles')), sourceLibraryService, mountedKnowledgeBaseRoot, reasoningExecutor, ...(themeFrameworkService === undefined ? {} : { themeFrameworkService }) })
    const policySourceIds = PHASE2_COMMON_SOURCE_POLICIES.flatMap((policy) => policy.candidates.map((candidate) => candidate.sourceId))
    const dataSourceAdministrationService = createDataSourceAdministrationService({ definitions: mergeSourceIntegrations([...(dailyComposition?.integrationDefinitions ?? []), ...researchIntegrationDefinitions]), credentials: createSourceCredentialStore(), tests: new FileDataSourceTestStore(join(cwd, 'runtime-data', 'data-source-tests')), policySourceIds })
    const dataSourceOnboardingService = createDataSourceOnboardingService({ root: join(cwd, 'runtime-data'), integrations: dataSourceAdministrationService })
    const services = { knowledgeService, knowledgeGraphService, knowledgeTopicProjectionService, themeWorkspaceProjectionService, reviewService, workflowService, productionService, researchDispatchService, sourceLibraryService, skillOnboardingService, dataSourceAdministrationService, dataSourceOnboardingService, ...(researchService === undefined ? {} : { researchService }), ...(themeFrameworkService === undefined ? {} : { themeFrameworkService }), ...(themeScopeImpactService === undefined ? {} : { themeScopeImpactService }), ...(thesisQueryService === undefined ? {} : { thesisQueryService }), ...(thesisDecisionService === undefined ? {} : { thesisDecisionService }), ...(thesisCriterionService === undefined ? {} : { thesisCriterionService }), dailyIntelligenceService }
    const { thesisCriterionService: _humanOnlyCriterionService, dataSourceAdministrationService: _humanOnlyDataSourceService, dataSourceOnboardingService: _humanOnlyOnboardingService, ...piApplicationServices } = services
    void _humanOnlyCriterionService
    void _humanOnlyDataSourceService
    const sessionManager = options.sessionManager ?? SessionManager.create(cwd, options.sessionDir)
    try {
      const sessionRuntime = await createResearchHubSessionRuntime({ cwd, agentDir, modelRuntime, sessionManager, applicationServices: piApplicationServices, mountedKnowledgeBaseRoot, workspaceRoot, model: selectedModel, reasoningExecutor, settingsManager: options.settingsManager, resourceLoader: options.resourceLoader, researchService, dailyIntelligenceService })
      const dailyScheduler = new DailyBriefScheduler({ statePath: join(cwd, 'runtime-data', 'daily-scheduler.json'), calendar: dailyComposition?.calendar ?? dailyIntelligenceService.calendar ?? new TradingCalendarService({ cachePath: join(cwd, 'runtime-data', 'trading-calendar.json') }), run: async (briefType, tradeDate) => { const run = dailyIntelligenceService.startBrief({ workflowRunId: `scheduled-${briefType}-${tradeDate}`, briefType, tradeDate }); const result = await run.completion; return { status: result.status } } })
      const runtime = new ResearchHubApplicationRuntime({ cwd, agentDir, workspaceRoot, mountedKnowledgeBaseRoot, modelRuntime, sessionManager, services, sessionRuntime, ownsModelRuntime, dailyScheduler })
      if (options.startDailyScheduler !== false) runtime.startDailyScheduler()
      return runtime
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

  startDailyScheduler(): void {
    if (this.closed) throw new Error('Application runtime is closed')
    if (this.dailyScheduler === undefined || this.dailySchedulerTimer !== undefined) return
    this.dailySchedulerTimer = setInterval(() => { void this.dailyScheduler!.tick(new Date()).catch(() => undefined) }, 60_000)
    this.dailySchedulerTimer.unref?.()
    void this.dailyScheduler.tick(new Date()).catch(() => undefined)
  }

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
