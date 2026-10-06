import type { DataRequirement, SourceCandidate, SourcePolicy, SourcePolicyMatchResult } from './contracts.ts'
import { meetsMinimumAuthority } from './validation.ts'

export function resolveSourcePolicy(requirement: DataRequirement, policies: readonly SourcePolicy[]): SourcePolicyMatchResult {
  const matches = policies
    .filter((policy) => policyMatches(requirement, policy))
    .map((policy) => ({ policy, specificity: policySpecificity(policy) }))
  if (matches.length === 0) return { status: 'NO_REGISTERED_POLICY' }
  const highest = Math.max(...matches.map((match) => match.specificity))
  const winners = matches.filter((match) => match.specificity === highest).sort((left, right) => left.policy.policyId.localeCompare(right.policy.policyId))
  if (winners.length !== 1) return { status: 'AMBIGUOUS_POLICY', specificity: highest, candidatePolicyIds: winners.map((match) => match.policy.policyId) }
  return { status: 'MATCHED', policy: winners[0]!.policy, specificity: highest }
}

export function policyMatches(requirement: DataRequirement, policy: SourcePolicy): boolean {
  const match = policy.requirementMatch
  return (match.workflow === undefined || match.workflow === requirement.consumer.workflow)
    && (match.dataKind === undefined || match.dataKind === requirement.dataKind)
    && (match.metricId === undefined || match.metricId === requirement.metricId)
    && (match.metricFamily === undefined || match.metricFamily === requirement.metricFamily)
    && (match.capability === undefined || match.capability === requirement.consumer.capability)
}

export function policySpecificity(policy: SourcePolicy): number {
  const match = policy.requirementMatch
  return (match.workflow === undefined ? 0 : 200)
    + (match.metricId === undefined ? 0 : 100)
    + (match.metricFamily === undefined ? 0 : 50)
    + (match.dataKind === undefined ? 0 : 10)
    + (match.capability === undefined ? 0 : 5)
}

export type CandidateEligibilityReason = 'UNSUPPORTED_DATA_KIND' | 'UNSUPPORTED_METRIC' | 'INSUFFICIENT_AUTHORITY' | 'LLM_FALLBACK_FORBIDDEN' | 'LLM_DISCOVERY_ONLY' | 'LLM_NUMERIC_SYNTHESIS_FORBIDDEN'

export interface CandidateEligibility {
  readonly eligible: boolean
  readonly reason?: CandidateEligibilityReason
}

export function candidateEligibility(requirement: DataRequirement, candidate: SourceCandidate): CandidateEligibility {
  if (!candidate.supports.dataKinds.includes(requirement.dataKind)) return { eligible: false, reason: 'UNSUPPORTED_DATA_KIND' }
  if (requirement.metricId && candidate.supports.metricIds && !candidate.supports.metricIds.includes(requirement.metricId)) return { eligible: false, reason: 'UNSUPPORTED_METRIC' }
  if (requirement.metricFamily && candidate.supports.metricFamilies && !candidate.supports.metricFamilies.includes(requirement.metricFamily)) return { eligible: false, reason: 'UNSUPPORTED_METRIC' }
  if (!meetsMinimumAuthority(candidate.originAuthority, requirement.minimumAuthority)) return { eligible: false, reason: 'INSUFFICIENT_AUTHORITY' }
  if (candidate.fallbackLevel !== 'LLM_WEB') return { eligible: true }
  if (requirement.llmWebFallback === 'FORBIDDEN') return { eligible: false, reason: 'LLM_FALLBACK_FORBIDDEN' }
  if (requirement.llmWebFallback === 'DISCOVERY_ONLY') return { eligible: false, reason: 'LLM_DISCOVERY_ONLY' }
  if (requirement.determinismClass === 'AUTHORITATIVE_NUMERIC' && requirement.llmWebFallback === 'FULL_EVIDENCE_RESEARCH') return { eligible: false, reason: 'LLM_NUMERIC_SYNTHESIS_FORBIDDEN' }
  return { eligible: true }
}

export function orderCandidates(candidates: readonly SourceCandidate[]): readonly SourceCandidate[] {
  const fallbackRank: Readonly<Record<SourceCandidate['fallbackLevel'], number>> = { PRIMARY: 0, FALLBACK_1: 1, FALLBACK_2: 2, LLM_WEB: 3 }
  return candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((left, right) => fallbackRank[left.candidate.fallbackLevel] - fallbackRank[right.candidate.fallbackLevel] || left.index - right.index)
    .map((item) => item.candidate)
}
