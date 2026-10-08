import type { KnowledgeBaseHandle } from '../../knowledge/storage/handle.ts'
import type { SemanticResolver, ResolutionIntentSummary } from '../../knowledge/production/contracts.ts'
import type { NormalizedResearchSource } from '../../plugins/research-acquisition/contracts.ts'
import type { IndustryObservationPoint } from '../../data/industry-observations.ts'
import type { DataResolver } from '../../data/resolver.ts'
import type { DataRequirementRuntimeContext, SkillDataRequirement } from '../../data/requirements.ts'
import type { IndustryDataOperationPayload } from '../../plugins/research-acquisition/industry-data-operations.ts'
import type { ReasoningExecutor } from '../../plugins/reasoning/contracts.ts'
import type { IndustryTargetInput, ResearchDesign, IndustryModuleResult, CrossModuleSynthesis, ModuleEvidence } from '../../skills/industry-research/contracts.ts'
import type { ResearchQualityGateResult } from '../research-quality-gate.ts'

export interface IndustryDataResolverContext extends DataRequirementRuntimeContext {
  readonly workflowId: 'industry-deep-research'
  readonly target: IndustryTargetInput
  readonly now: () => string
  readonly signal?: AbortSignal
}
/** Compatibility request for non-Workflow consumers such as Theme Framework. */
export interface IndustryAcquisitionWaveRequest { readonly target: IndustryTargetInput; readonly wave: 1 | 2; readonly design: ResearchDesign; readonly gaps: readonly string[]; readonly searchTerms: readonly string[] }
export type IndustryAcquisitionWave = (request: IndustryAcquisitionWaveRequest) => Promise<readonly NormalizedResearchSource[]>
export type IndustryDataResolverFactory = (context: IndustryDataResolverContext) => DataResolver<IndustryDataOperationPayload>
export interface IndustryDeepResearchInput { readonly workflowRunId: string; readonly handle: KnowledgeBaseHandle; readonly target: IndustryTargetInput; readonly reportRoot: string; readonly reasoningExecutor: ReasoningExecutor; readonly dataResolverFactory: IndustryDataResolverFactory; readonly skillDataRequirements: readonly SkillDataRequirement[]; readonly searchTerms?: readonly string[]; readonly semanticResolver?: SemanticResolver; readonly asOf?: string; readonly now?: () => string; readonly signal?: AbortSignal; readonly existingKnowledge?: readonly unknown[]; readonly maxSources?: number; readonly maxEvidencePerModule?: number; readonly writeKnowledge?: boolean; readonly useStructuredKnowledge?: boolean }
export interface IndustryDeepResearchResult { readonly workflowRunId: string; readonly status: 'completed' | 'blocked' | 'cancelled' | 'failed'; readonly knowledgeBaseId: string; readonly knowledgeBaseRevision: number; readonly report?: { readonly reportId: string; readonly outputPath: string }; readonly design?: ResearchDesign; readonly modules: readonly IndustryModuleResult[]; readonly synthesis?: CrossModuleSynthesis; readonly evidence: readonly ModuleEvidence[]; readonly operatingObservations: readonly IndustryObservationPoint[]; readonly operatingObservationStatus: 'COMPLETED' | 'PARTIAL' | 'SCOPE_UNSUPPORTED' | 'SOURCE_UNAVAILABLE' | 'TRANSPORT_UNAVAILABLE' | 'PARSER_UNAVAILABLE'; readonly operatingObservationDiagnostics: readonly string[]; readonly dataRequirementGaps: readonly string[]; readonly requirementCoverage: 'COMPLETE' | 'PARTIAL'; readonly proposalIds: readonly string[]; readonly createdIds: readonly string[]; readonly updatedIds: readonly string[]; readonly committedIds: readonly string[]; readonly sourceIds: readonly string[]; readonly relationIds: readonly string[]; readonly claimIds: readonly string[]; readonly entityRefs: Readonly<Record<string, string>>; readonly relationRefs: Readonly<Record<string, string>>; readonly claimRefs: Readonly<Record<string, string>>; readonly sourceRefs: Readonly<Record<string, string>>; readonly resolutionIntents: readonly ResolutionIntentSummary[]; readonly diagnostics: readonly string[]; readonly errors: readonly string[]; readonly gatewaySubmitCount: number; readonly acquisitionWaves: number; readonly moduleCallCounts: Readonly<Record<string, number>>; readonly qualityGate?: ResearchQualityGateResult }
