import type { ModelRuntime, SessionManager, SettingsManager, DefaultResourceLoader } from '@earendil-works/pi-coding-agent'
import type { Api, Model } from '@earendil-works/pi-ai'
import type { KnowledgeService } from '../services/knowledge-service.ts'
import type { KnowledgeGraphService } from '../services/knowledge-graph-service.ts'
import type { KnowledgeTopicProjectionService } from '../services/knowledge-topic-projection.ts'
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
import type { ThesisQueryService } from '../services/thesis-query-service.ts'
import type { ThesisDecisionService } from '../services/thesis-decision-service.ts'
import type { ThesisCriterionService } from '../services/thesis-criterion-service.ts'

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
  readonly dailyIntelligenceService?: DailyIntelligenceService
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
  readonly reasoningExecutor?: ReasoningExecutor
  /** Lazy, Industry-only production executor selection. It is never a fallback. */
  readonly industryReasoningExecutorFactory?: () => Promise<ReasoningExecutor>
  readonly settingsManager?: SettingsManager
  readonly resourceLoader?: DefaultResourceLoader
  readonly researchService?: ResearchService
  readonly industryAcquisitionPlugins?: readonly ResearchAcquisitionPlugin[]
  readonly industryOperatingObservationAcquisition?: IndustryOperatingObservationAcquisitionPort
  readonly dailyIntelligenceService?: DailyIntelligenceService
}
