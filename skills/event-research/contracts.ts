import type { SemanticProductionProposal } from '../../knowledge/production/contracts.ts'

export const EVENT_EVIDENCE_VERDICTS = ['supports', 'contradicts', 'context', 'irrelevant'] as const
export type EventEvidenceVerdict = (typeof EVENT_EVIDENCE_VERDICTS)[number]

export const EVENT_EVIDENCE_REQUIREMENTS = ['primary', 'corroborated', 'single_source'] as const
export type EventEvidenceRequirement = (typeof EVENT_EVIDENCE_REQUIREMENTS)[number]

export const EVENT_VERIFICATION_LEVELS = ['official_verified', 'corroborated', 'single_source', 'conflicted', 'unverified'] as const
export type EventVerificationLevel = (typeof EVENT_VERIFICATION_LEVELS)[number]

export const EVENT_IMPACT_DISPOSITIONS = [
  'new_fact',
  'supports_existing',
  'contradicts_existing',
  'changes_assumption',
  'affects_thesis',
  'new_catalyst',
  'new_risk',
  'no_change',
  'research_gap',
] as const
export type EventImpactDisposition = (typeof EVENT_IMPACT_DISPOSITIONS)[number]

export const EVENT_DURABLE_CLAIM_TYPES = ['viewpoint', 'risk', 'catalyst', 'assumption'] as const
export type EventDurableClaimType = (typeof EVENT_DURABLE_CLAIM_TYPES)[number]

export const EVENT_RESEARCH_SECTIONS = [
  'Event Definition',
  'Verification Status',
  'Source & Evidence Map',
  'Verified Facts',
  'Conflicting / Unverified Claims',
  'Existing Research Context',
  'First-Order Impact',
  'Second-Order Impact',
  'Business / Industry Transmission',
  'Financial / Operating Implications',
  'Assumption Impact',
  'Thesis Impact',
  'Catalyst Changes',
  'Risk Changes',
  'Valuation / Monitoring Implications',
  'Open Questions / Research Gaps',
] as const
export type EventResearchSectionTitle = (typeof EVENT_RESEARCH_SECTIONS)[number]

export interface EventResearchCompany {
  readonly symbol: string
  readonly name?: string
  readonly exchange?: string
}

export interface EventResearchAnchorContext {
  readonly kind: 'daily_signal' | 'article' | 'url' | 'user_event'
  readonly title: string
  readonly description?: string
  readonly signalId?: string
  readonly clusterKey?: string
  readonly url?: string
  readonly publishedAt?: string
  readonly eventDate?: string
}

export interface EventEvidenceSource {
  readonly candidateId: string
  readonly title: string
  readonly provider: string
  readonly kind?: string
  readonly url?: string
  readonly publishedAt?: string
  readonly excerpt: string
  readonly official?: boolean
  readonly dataProvenance?: Readonly<Record<string, unknown>>
}

export interface EventExistingKnowledgeClaim {
  readonly canonicalRef: string
  readonly claimType: string
  readonly statement?: string
  readonly subjectRefs?: readonly string[]
  readonly structuredValue?: Readonly<Record<string, unknown>> | null
}

export interface EventEvidenceAssessmentInput {
  readonly company: EventResearchCompany
  readonly anchor: EventResearchAnchorContext
  readonly asOf?: string
  readonly eventDate?: string
  readonly sources: readonly EventEvidenceSource[]
}

export interface EventSourceAssessment {
  readonly sourceCandidateId: string
  readonly verdict: EventEvidenceVerdict
  readonly confidence: number
  readonly rationale: string
  readonly evidenceRequirement: EventEvidenceRequirement
}

export type EventSourceVerdict = EventSourceAssessment

export interface EventVerifiedFact {
  readonly factId: string
  readonly statement: string
  readonly sourceCandidateIds: readonly string[]
  readonly confidence: number
  readonly evidenceRequirement: EventEvidenceRequirement
  readonly structuredValue?: EventStructuredValue
}

export interface EventContradiction {
  readonly statement: string
  readonly sourceCandidateIds: readonly string[]
  readonly contradictionId?: string
  readonly rationale?: string
}

export interface EventEvidenceAssessmentOutput {
  readonly sourceAssessments: readonly EventSourceAssessment[]
  readonly verifiedFacts: readonly EventVerifiedFact[]
  readonly contradictions: readonly EventContradiction[]
}

export interface EventVerificationResult {
  readonly verificationLevel: EventVerificationLevel
  readonly strongVerification: boolean
  readonly supportingSourceCandidateIds: readonly string[]
  readonly contradictingSourceCandidateIds: readonly string[]
}

export interface EventImpactAssessment {
  readonly assessmentId: string
  readonly impactType: 'direct' | 'second_order' | 'assumption' | 'thesis' | 'catalyst' | 'risk' | 'no_change' | 'research_gap'
  readonly basis: 'verified_fact' | 'inference' | 'hypothesis'
  readonly direction: 'positive' | 'negative' | 'mixed' | 'unclear'
  readonly materiality: 'low' | 'medium' | 'high'
  readonly timeHorizon: 'immediate' | 'near_term' | 'medium_term' | 'long_term'
  readonly existingKnowledgeRefs: readonly string[]
  readonly sourceCandidateIds: readonly string[]
  readonly rationale: string
  readonly causalChain: string
}

export interface EventInterpretation {
  readonly interpretationId: string
  readonly sectionId: string
  readonly markdown: string
  readonly sourceCandidateIds: readonly string[]
  readonly existingKnowledgeRefs: readonly string[]
  readonly assessmentRefs: readonly string[]
}

export interface EventResearchSection {
  readonly sectionId: string
  readonly title: EventResearchSectionTitle
  readonly markdown: string
  readonly sourceCandidateIds: readonly string[]
  readonly existingKnowledgeRefs: readonly string[]
  readonly assessmentRefs: readonly string[]
}

export interface EventResearchProposal extends SemanticProductionProposal {
  readonly kind: 'claim'
  readonly claimType: EventDurableClaimType
  readonly subjectKey: 'company'
  readonly statement: string
  readonly sourceCandidateIds: readonly string[]
  readonly existingKnowledgeRefs: readonly string[]
  readonly assessmentRefs: readonly string[]
}

export interface EventResearchGatewayProposal {
  readonly proposalId: string
  readonly kind: 'claim'
  readonly claimType: EventDurableClaimType
  readonly subjectKey: 'company'
  readonly statement: string
  readonly sourceCandidateIds: readonly string[]
  readonly structuredValue?: Readonly<Record<string, unknown>> | null
}

export interface EventResearchSynthesisInput {
  readonly company: EventResearchCompany
  readonly anchor: EventResearchAnchorContext
  readonly eventFingerprint: string
  readonly eventDate?: string
  readonly verification: EventVerificationResult
  readonly evidence: EventEvidenceAssessmentOutput
  readonly existingKnowledge: readonly EventExistingKnowledgeClaim[]
  readonly sources?: readonly EventEvidenceSource[]
  readonly supportingSourceExcerpts?: readonly EventEvidenceSource[]
  readonly contradictingSourceExcerpts?: readonly EventEvidenceSource[]
}

export interface EventResearchSynthesisOutput {
  readonly interpretations: readonly EventInterpretation[]
  readonly assessments: readonly EventImpactAssessment[]
  readonly proposalCandidates: readonly unknown[]
}

export interface EventResearchReasoningTelemetry {
  readonly called: boolean
  readonly validated: boolean
  readonly applied: boolean
  readonly fallbackUsed: boolean
  readonly repairAttempts: number
  readonly operation: 'event_evidence_assessment' | 'event_research_synthesis'
  readonly diagnostic?: string
  readonly diagnostics?: readonly string[]
  readonly model?: string
  readonly firstAttemptShape?: EventReasoningShape
  readonly repairAttemptShape?: EventReasoningShape
}

export interface EventReasoningShape {
  readonly topLevelKeys: readonly string[]
  readonly interpretationCount: number
  readonly assessmentCount: number
  readonly proposalCount: number
}

export interface EventEvidenceAssessmentSkillResult {
  readonly output: EventEvidenceAssessmentOutput
  readonly verification: EventVerificationResult
  readonly reasoning: EventResearchReasoningTelemetry
}

export interface EventResearchSynthesisSkillResult {
  readonly output: EventResearchSynthesisOutput
  readonly reasoning: EventResearchReasoningTelemetry
}

export interface EventStructuredValue {
  readonly [key: string]: unknown
  readonly metric: string
  readonly value: string | number | boolean | null
  readonly unit: string | null
  readonly comparator: 'eq' | 'gt' | 'gte' | 'lt' | 'lte' | 'approx' | null
  readonly period?: string | null
  readonly fiscalPeriod?: string | null
  readonly semanticKey?: string | null
}

export interface EventAssumptionUpdate {
  readonly existingClaimRef: string
  readonly structuredValue: EventStructuredValue
}
