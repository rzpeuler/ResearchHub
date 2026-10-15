/** Content completion is separate from source admissibility and canonical persistence. */
import type { CompanyResearchMethodResult } from '../../skills/company-research/methods.ts'
import type { CompanySemanticQualityResult } from './semantic-quality.ts'
export interface CompanyMethodExecution {
  readonly skillId: string
  readonly status: 'completed' | 'complete' | 'insufficient_evidence' | 'failed' | 'incomplete' | 'cancelled'
  readonly attempts: number
  readonly errorCode?: string
  readonly summary?: string
}
export interface CompanyContentSection {
  readonly id: string
  readonly markdown: string
  readonly sourceCandidateIds?: readonly string[]
  readonly sourceRefs?: readonly string[]
  readonly evidenceLinks?: readonly string[]
}
export interface CompanyResearchQuality {
  readonly semanticReview?: CompanySemanticQualityResult
  readonly passed: boolean
  readonly status: 'complete' | 'incomplete'
  readonly coreCoverage: { readonly completed: number; readonly required: number }
  readonly issues: readonly string[]
  readonly sectionChecks: readonly { readonly sectionId: string; readonly core: boolean; readonly passed: boolean; readonly reasons: readonly string[] }[]
}
export const COMPANY_CORE_SECTION_IDS = ['company-overview', 'business-model', 'business-segments', 'revenue-profit-drivers', 'products', 'technologies', 'industry-exposure', 'supply-chain', 'competition', 'financial-quality', 'growth-drivers', 'management-capital-allocation', 'catalysts', 'risks', 'investment-thesis', 'monitoring-checklist'] as const
const gap = /^(?:Research gap:|Market data gap:|研究缺口[：:]|数据缺口[：:]|证据不足[：:])|no bounded evidence was supplied|无可用证据|未获取到.*(?:证据|资料)/i

export function evaluateCompanyResearchContent(input: { readonly sections: readonly CompanyContentSection[]; readonly synthesisMode?: string; readonly methodExecutions?: readonly CompanyMethodExecution[]; readonly methodResults?: readonly CompanyResearchMethodResult[] }): CompanyResearchQuality {
  const issues: string[] = []
  if (input.synthesisMode === 'deterministic_fallback') issues.push('SYNTHESIS_DEGRADED')
  for (const method of input.methodExecutions ?? []) if (!['completed', 'complete'].includes(method.status)) issues.push(`METHOD_NOT_COMPLETED:${method.skillId}:${method.errorCode ?? method.status}`)
  for (const method of input.methodResults ?? []) {
    if (method.status !== 'complete') issues.push(`METHOD_NOT_COMPLETED:${method.skillId}:${method.status}`)
    if (!method.answer.trim() || method.findings.length === 0) issues.push(`METHOD_NO_RESEARCH_ANSWER:${method.skillId}`)
    const allowedLocations = new Set(method.executionEvidence
      ? [...method.executionEvidence, ...method.deterministicEvidence ?? []].flatMap((packet) => packet.excerpts.map((excerpt) => `${packet.sourceCandidateId}@${excerpt.location}`))
      : method.findings.flatMap((finding) => finding.evidence.map((ref) => `${ref.sourceCandidateId}@${ref.location}`)))
    if (method.findings.some((finding) => !finding.text.trim() || finding.evidence.length === 0 || finding.evidence.some((ref) => !ref.location.trim() || !method.sourceCandidateIds.includes(ref.sourceCandidateId) || !allowedLocations.has(`${ref.sourceCandidateId}@${ref.location}`)))) issues.push(`METHOD_UNATTRIBUTED_FINDING:${method.skillId}`)
    const located = (text: string) => {
      const refs = [...text.matchAll(/\[([^\]\s]+@[^\]\s]+)\]/g)]
      return refs.length > 0 && refs.every((match) => allowedLocations.has(match[1]!))
    }
    if (!located(method.markdown)) issues.push(`METHOD_SUMMARY_WITHOUT_LOCATED_EVIDENCE:${method.skillId}`)
    if (method.sections.some((section) => !located(section.markdown))) issues.push(`METHOD_SECTION_WITHOUT_LOCATED_EVIDENCE:${method.skillId}`)
    if (method.skillId === 'company_risk_analysis' && method.risks.length === 0) issues.push('METHOD_RISKS_NOT_EXPLAINED')
  }
  const seen = new Map<string, string>()
  const byId = new Map(input.sections.map((section) => [section.id, section]))
  if (byId.size !== input.sections.length) issues.push('DUPLICATE_SECTION_ID')
  const sectionChecks = COMPANY_CORE_SECTION_IDS.map((id) => {
    const section = byId.get(id)
    const reasons: string[] = []
    if (!section) reasons.push('MISSING_SECTION')
    else {
      const text = section.markdown.trim()
      if (!text || gap.test(text)) reasons.push('RESEARCH_GAP')
      const evidenceCount = (section.sourceCandidateIds?.length ?? 0) + (section.sourceRefs?.length ?? 0) + (section.evidenceLinks?.length ?? 0)
      if (evidenceCount === 0) reasons.push('NO_ATTRIBUTABLE_EVIDENCE')
      const normalized = text.replace(/\s+/g, ' ')
      if (normalized && seen.has(normalized)) reasons.push(`DUPLICATE_CONTENT:${seen.get(normalized)}`)
      if (normalized) seen.set(normalized, id)
      // A provider dump or bare numeric list is not an explanation of a research question.
      if (/^Retrieved (?:structured financial|market) observations/i.test(text)) reasons.push('OBSERVATIONS_WITHOUT_ANALYSIS')
    }
    return { sectionId: id, core: true, passed: reasons.length === 0, reasons }
  })
  for (const check of sectionChecks) for (const reason of check.reasons) issues.push(`${check.sectionId}:${reason}`)
  const passed = issues.length === 0
  return { passed, status: passed ? 'complete' : 'incomplete', coreCoverage: { completed: sectionChecks.filter((item) => item.passed).length, required: sectionChecks.length }, issues, sectionChecks }
}

export function mergeCompanySemanticQuality(structural: CompanyResearchQuality, semanticReview: CompanySemanticQualityResult): CompanyResearchQuality {
  const sectionChecks = structural.sectionChecks.map(check => {
    const reviewed = semanticReview.sectionChecks.find(item => item.sectionId === check.sectionId)
    const reasons = [...check.reasons, ...(!reviewed ? ['SEMANTIC_REVIEW_UNAVAILABLE'] : reviewed.questionAnswered && reviewed.evidenceSupportsConclusion && reviewed.numericReproducible && reviewed.riskTransmission ? [] : ['SEMANTIC_REVIEW_FAILED', ...reviewed.reasons])]
    return { ...check, passed: reasons.length === 0, reasons }
  })
  const passed = structural.passed && semanticReview.passed
  return { ...structural, passed, status: passed ? 'complete' : 'incomplete', issues: [...structural.issues, ...semanticReview.issues], sectionChecks, coreCoverage: {completed:sectionChecks.filter(item => item.passed).length,required:sectionChecks.length},semanticReview }
}
