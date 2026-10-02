import type { ReasoningExecutor } from '../../plugins/reasoning/contracts.ts'
import type {
  ThemeFrameworkInput,
  ThemeFrameworkResult,
  ThemeFrameworkRecommendation,
} from '../../skills/theme-framework/contracts.ts'

export const THEME_FRAMEWORK_CONSTRUCTION_LIMITS = {
  maxSources: 24,
  maxEvidence: 80,
} as const

export interface ThemeFrameworkKnowledgeSnapshot {
  readonly knowledgeBaseId: string
  readonly revision: number
  readonly summary: string
  readonly industries: ThemeFrameworkInput['existingKnowledge']['industries']
  readonly evidence: readonly ThemeFrameworkInput['evidence'][number][]
  readonly durableEvidenceBindings?: readonly ThemeFrameworkDurableEvidenceBinding[]
  readonly priorDecisions: ThemeFrameworkInput['priorDecisions']
  /** Set when this is a build request for an already existing Theme. */
  readonly existingThemeRef?: string
}

export type ThemeFrameworkAcquisitionResult =
  | { readonly status: 'available' | 'partial'; readonly evidence: readonly ThemeFrameworkInput['evidence'][number][]; readonly durableEvidenceBindings?: readonly ThemeFrameworkDurableEvidenceBinding[]; readonly diagnostics?: readonly string[] }
  | { readonly status: 'unavailable'; readonly reason: string; readonly diagnostics?: readonly string[] }

/** A4-compatible provenance for a source already retained in the mounted KB. */
export interface ThemeFrameworkDurableEvidenceBinding {
  readonly evidenceId: string
  readonly sourceRef: `source:${string}`
  readonly rawRef: `raw-sha256-${string}`
  readonly locator?: string
}

/**
 * Adapter over the already configured Research Acquisition Plugin composition.
 * The Workflow supplies a hard source budget; this is not a provider registry.
 */
export interface ThemeFrameworkAcquisitionPort {
  acquire(input: {
    readonly themeName: string
    readonly definition?: string
    readonly maxSources: number
    readonly knowledgeBaseId: string
    readonly knowledgeBaseRevision: number
    readonly signal?: AbortSignal
  }): Promise<ThemeFrameworkAcquisitionResult>
}

export interface ThemeFrameworkDecision {
  readonly candidateId: string
  readonly kind: 'industry' | 'relation'
  readonly decision: ThemeFrameworkRecommendation
  readonly rationale: string
  readonly evidenceRefs: readonly string[]
  /** A4 Source/Raw bindings corresponding to the cited evidenceRefs. */
  readonly evidenceBindings: readonly ThemeFrameworkDurableEvidenceBinding[]
  readonly coverageGaps: readonly string[]
}

export interface ThemeFrameworkReviewCandidate {
  readonly workflowRunId: string
  readonly knowledgeBaseId: string
  readonly basedOnRevision: number
  readonly theme: { readonly name: string; readonly definition?: string }
  readonly framework: ThemeFrameworkResult
  readonly durableEvidenceBindings: readonly ThemeFrameworkDurableEvidenceBinding[]
  readonly acquisitionStatus: ThemeFrameworkAcquisitionResult['status']
  readonly diagnostics: readonly string[]
}

export type ThemeFrameworkAtomicCommitStatus =
  | 'committed'
  | 'already_committed'
  | 'conflict'
  | 'blocked'
  | 'failed'

export interface ThemeFrameworkAtomicCommitResult {
  readonly status: ThemeFrameworkAtomicCommitStatus
  readonly themeRef?: string
  readonly committedRevision?: number
  readonly errors?: readonly string[]
}

/**
 * This port must map Theme, canonical Industry/Relation proposals and the
 * complete scope decision batch into one revision-bound validated ChangeSet
 * and one Writer transaction. Implementations must be idempotent by
 * workflowRunId + accepted-decision digest. A3/A4 currently lack this adapter.
 * Each external item used for a human-confirmed include must first pass the
 * governed Source/Raw retention path; only its verified sourceRef/rawRef and
 * locator may appear in evidenceBindings. If acquisition is unavailable, the
 * Theme may still be created with pending/exclude decisions and no graph edges.
 */
export interface ThemeFrameworkAtomicCommitPort {
  commitThemeFrameworkAtomically(input: {
    readonly workflowRunId: string
    readonly knowledgeBaseId: string
    readonly expectedBaseRevision: number
    readonly theme: ThemeFrameworkReviewCandidate['theme']
    readonly framework: ThemeFrameworkResult
    readonly decisions: readonly ThemeFrameworkDecision[]
  }): Promise<ThemeFrameworkAtomicCommitResult>
}

export interface ThemeFrameworkConstructionPorts {
  readonly readKnowledgeSnapshot: (themeName: string) => Promise<ThemeFrameworkKnowledgeSnapshot>
  readonly acquisition?: ThemeFrameworkAcquisitionPort
  readonly reasoningExecutor?: ReasoningExecutor
  readonly commit?: ThemeFrameworkAtomicCommitPort
  readonly now?: () => string
}

export interface ThemeFrameworkConstructionRequest {
  readonly workflowRunId: string
  readonly themeName: string
  readonly definition?: string
  readonly signal?: AbortSignal
}

export type ThemeFrameworkConstructionResult =
  | { readonly status: 'awaiting_review'; readonly candidate: ThemeFrameworkReviewCandidate }
  | { readonly status: 'blocked' | 'failed' | 'cancelled'; readonly diagnostics: readonly string[] }

export interface ThemeFrameworkReviewRequest {
  readonly candidate: ThemeFrameworkReviewCandidate
  readonly disposition: 'accept' | 'reject'
  /**
   * Overrides by candidate id. Unspecified items keep the Skill recommendation;
   * rejection records no canonical state. User decisions are still passed as
   * a complete batch to the atomic commit port.
   */
  readonly decisions?: Readonly<Record<string, ThemeFrameworkRecommendation>>
}

export type ThemeFrameworkReviewResult =
  | { readonly status: 'rejected'; readonly workflowRunId: string }
  | { readonly status: 'committed' | 'already_committed'; readonly workflowRunId: string; readonly themeRef: string; readonly committedRevision: number; readonly decisions: readonly ThemeFrameworkDecision[] }
  | { readonly status: 'blocked' | 'conflict' | 'failed'; readonly workflowRunId: string; readonly diagnostics: readonly string[] }
