import type { ModelRuntime, SessionManager, SettingsManager, DefaultResourceLoader } from '@earendil-works/pi-coding-agent'
import type { Api, Model } from '@earendil-works/pi-ai'
import type { KnowledgeService } from '../services/knowledge-service.ts'
import type { KnowledgeGraphService } from '../services/knowledge-graph-service.ts'
import type { KnowledgeTopicProjectionService } from '../services/knowledge-topic-projection.ts'
import type { ThemeWorkspaceProjectionService } from '../services/theme-workspace-projection.ts'
import type { ProductionService } from '../services/production-service.ts'
import type { ReviewService } from '../services/review-service.ts'
import type { WorkflowService } from '../services/workflow-service.ts'
import type { ResearchService } from '../services/research-service.ts'
import type { ReasoningExecutor } from '../../plugins/reasoning/contracts.ts'
import type { DailyIntelligenceService } from '../services/daily-intelligence-service.ts'
import type { ResearchAcquisitionPlugin } from '../../plugins/research-acquisition/contracts.ts'
import type { ResearchDispatchService } from '../services/research-dispatch-service.ts'
import type { SourceLibraryService } from '../services/source-library.ts'
import type { SkillOnboardingService } from '../services/skill-onboarding.ts'
import type { IndustryOperatingObservationAcquisitionPort } from '../../plugins/research-acquisition/industry-operating-observations.ts'
import type { IndustryDataResolverFactory } from '../../workflows/industry-deep-research/contracts.ts'
import type { IndustryDataCatalog } from '../../data/industry-catalog.ts'
import type { ThesisQueryService } from '../services/thesis-query-service.ts'
import type { ThesisDecisionService } from '../services/thesis-decision-service.ts'
import type { ThesisCriterionService } from '../services/thesis-criterion-service.ts'
import type { ThemeFrameworkService } from '../services/theme-framework-service.ts'
import type { ThemeScopeImpactService } from '../services/theme-scope-impact-service.ts'
import type { DataSourceAdministrationService } from '../services/data-source-administration-contracts.ts'
import type { DataSourceOnboardingService } from '../services/data-source-onboarding-store.ts'

export interface SafeConversationSummary {
  readonly conversationId: string
  readonly name?: string
  readonly updatedAt: string
  readonly messageCount: number
  readonly isActive: boolean
}

export interface SafeConversationMessage {
  readonly role: 'user' | 'assistant' | 'tool'
  readonly content: string
  readonly timestamp?: string
  readonly toolName?: string
  readonly isError?: boolean
}

export interface CurrentSessionState {
  readonly conversationId: string
  readonly name?: string
  readonly isStreaming: boolean
  readonly isIdle: boolean
  readonly pendingMessageCount: number
  readonly thinkingLevel: string
  readonly model?: { readonly provider: string; readonly modelId: string }
}

export interface ResearchHubApplicationServices {
  readonly knowledgeService: KnowledgeService
  readonly knowledgeGraphService: KnowledgeGraphService
  /** Read-only Schema 0.4 topic projection; absent only in legacy test/session adapters. */
  readonly knowledgeTopicProjectionService?: KnowledgeTopicProjectionService
  /** Read-only Theme Graph workspace projection; absent only in legacy adapters. */
  readonly themeWorkspaceProjectionService?: ThemeWorkspaceProjectionService
  readonly reviewService: ReviewService
  readonly workflowService: WorkflowService
  readonly researchDispatchService?: ResearchDispatchService
  readonly sourceLibraryService?: SourceLibraryService
  readonly skillOnboardingService?: SkillOnboardingService
  readonly productionService: ProductionService
  readonly researchService?: ResearchService
  readonly thesisQueryService?: ThesisQueryService
  readonly thesisDecisionService?: ThesisDecisionService
  /** Human-only HTTP criterion authoring; deliberately excluded from the Pi session context. */
  readonly thesisCriterionService?: ThesisCriterionService
  /** Explicitly reviewed Theme Framework construction; canonical writes occur only on accept. */
  readonly themeFrameworkService?: ThemeFrameworkService
  /** Read and review the durable post-write Theme scope impact proposal inbox. */
  readonly themeScopeImpactService?: ThemeScopeImpactService
  readonly dailyIntelligenceService?: DailyIntelligenceService
  /** Human-facing inventory of explicitly assembled data source integrations. */
  readonly dataSourceAdministrationService?: DataSourceAdministrationService
  /** Local, non-Knowledge onboarding drafts for sources without a Runtime adapter. */
  readonly dataSourceOnboardingService?: DataSourceOnboardingService
}

export interface ResearchHubSessionRuntimeOptions {
  readonly cwd: string
  readonly agentDir: string
  readonly modelRuntime: ModelRuntime
  readonly sessionManager: SessionManager
  readonly applicationServices: ResearchHubApplicationServices
  readonly mountedKnowledgeBaseRoot?: string
  readonly workspaceRoot?: string
  readonly model?: Model<Api>
  readonly reasoningExecutor?: ReasoningExecutor
  readonly settingsManager?: SettingsManager
  readonly resourceLoader?: DefaultResourceLoader
  readonly researchService?: ResearchService
  readonly dailyIntelligenceService?: DailyIntelligenceService
}

export interface ResearchHubApplicationRuntimeOptions {
  readonly cwd: string
  readonly agentDir?: string
  readonly sessionDir?: string
  readonly mountedKnowledgeBaseRoot?: string
  readonly workspaceRoot?: string
  readonly modelRuntime?: ModelRuntime
  readonly sessionManager?: SessionManager
  readonly model?: Model<Api>
  /** Persisted app-wide selection, resolved and auth-checked by the Application Runtime. */
  readonly modelSelection?: { readonly provider: string; readonly modelId: string }
  /** Disable the initial/immediate scheduler tick while staging a replacement runtime. */
  readonly startDailyScheduler?: boolean
  readonly reasoningExecutor?: ReasoningExecutor
  /** Explicit executor seam for tests/isolated callers; normal Runtime uses the selected shared executor. */
  readonly industryReasoningExecutorFactory?: () => Promise<ReasoningExecutor>
  readonly settingsManager?: SettingsManager
  readonly resourceLoader?: DefaultResourceLoader
  readonly researchService?: ResearchService
  readonly industryAcquisitionPlugins?: readonly ResearchAcquisitionPlugin[]
  readonly themeFrameworkService?: ThemeFrameworkService
  readonly industryOperatingObservationAcquisition?: IndustryOperatingObservationAcquisitionPort
  readonly industryDataResolverFactory?: IndustryDataResolverFactory
  readonly industryDataCatalog?: IndustryDataCatalog
  readonly dailyIntelligenceService?: DailyIntelligenceService
  /** Injectable wall clock for deterministic Workflow input context tests. */
  readonly clock?: () => Date
}
