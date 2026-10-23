import { mergeExcessTrailingMarkdownTableCells, validateCompanyResearchMarkdownTables } from './markdown-tables.ts'
import type { ReasoningExecutor, ReasoningRequest } from '../../plugins/reasoning/contracts.ts'
import { ReasoningExecutorError, summarizeReasoningFailure } from '../../plugins/reasoning/errors.ts'
import type { CompanyResearchInput } from './contracts.ts'
import { selectCompanyEvidence, companyCitedSplitDateText, withCompanyEvidenceDateContext, type CompanyEvidencePacket } from './evidence.ts'
import { validateCompanyNumericGrounding, companyPreparedFinancialDateText } from './numeric-grounding.ts'
import { repairCompanyMethodCitations, repairCompanyParagraphCollisionCitations, repairCompanyTrailingSourceIdTypo, repairPreparedAnalysisSourceReferences, repairUnavailableCompanyMethodCitations, type CompanyCitationRepair } from './citation-repair.ts'

type NormalizedResearchSource = Parameters<typeof selectCompanyEvidence>[0][number]

/** Join one extra trailing table cell into the final declared capital-allocation column without dropping text or citations. */
function repairExcessTrailingCellsInMethodOutput<T>(output: T): T {
  let raw: unknown = output
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) } catch { return output }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return output
  const copy = structuredClone(raw) as Record<string, unknown>
  const repairText = (value: unknown) => typeof value === 'string' ? mergeExcessTrailingMarkdownTableCells(value) : value
  if ('markdown' in copy) copy.markdown = repairText(copy.markdown)
  if (Array.isArray(copy.sections)) copy.sections = copy.sections.map(section => section && typeof section === 'object' && !Array.isArray(section)
    ? { ...section, markdown: repairText((section as Record<string, unknown>).markdown) }
    : section)
  if (Array.isArray(copy.findings)) copy.findings = copy.findings.map(finding => finding && typeof finding === 'object' && !Array.isArray(finding)
    ? { ...finding, text: repairText((finding as Record<string, unknown>).text) }
    : finding)
  return copy as T
}

/** Drop only a whole, uncited-by-any-valid-source paragraph whose sole inline
 * references are absent from this method's evidence packet. This is a
 * fail-closed last resort after the bounded semantic repair call: it prevents
 * one hallucinated locator from discarding otherwise validated research, but
 * never substitutes a nearby paragraph or rewrites a table row. */
function removeUnsupportedMethodCitationParagraphs<T>(output: T, packets: readonly CompanyEvidencePacket[]): { output: T; removed: number } {
  let raw: unknown = output
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) } catch { return { output, removed: 0 } }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { output, removed: 0 }
  const copy = structuredClone(raw) as Record<string, unknown>
  const allowed = new Set(packets.flatMap(packet => packet.excerpts.map(excerpt => `${packet.sourceCandidateId}@${excerpt.location}`)))
  let removed = 0
  const clean = (value: unknown): unknown => {
    if (typeof value !== 'string') return value
    const lines = value.split(/\r?\n/)
    const candidates = lines.filter(line => {
      const refs = [...line.matchAll(/\[([^\]\s]+)@(paragraph:\d+)\]/g)].map(match => `${match[1]}@${match[2]}`)
      return refs.length > 0 && !line.includes('|') && refs.every(ref => !allowed.has(ref))
    })
    // Do not turn a required section into an empty string. In that case the
    // normal validator must keep the method blocked for semantic repair.
    if (candidates.length === lines.filter(line => line.trim()).length) return value
    const kept = lines.filter(line => {
      const refs = [...line.matchAll(/\[([^\]\s]+)@(paragraph:\d+)\]/g)].map(match => `${match[1]}@${match[2]}`)
      if (!refs.length || line.includes('|') || refs.some(ref => allowed.has(ref))) return true
      removed++
      return false
    })
    return kept.join('\n')
  }
  for (const key of ['answer', 'markdown'] as const) copy[key] = clean(copy[key])
  if (Array.isArray(copy.sections)) copy.sections = copy.sections.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item
    const row = item as Record<string, unknown>
    return { ...row, markdown: clean(row.markdown) }
  })
  if (removed) {
    const limitations = Array.isArray(copy.limitations) ? copy.limitations.filter((item): item is string => typeof item === 'string') : []
    copy.limitations = [...limitations, '已剔除本轮证据包未提供且无法修复的独立引用段落；其主张不纳入结论。']
  }
  return { output: copy as T, removed }
}

export const COMPANY_RESEARCH_METHOD_IDS = ['company_history_strategy', 'business_model_map', 'product_technology_analysis', 'business_driver_analysis', 'financial_quality_analysis', 'market_structure_analysis', 'competitive_market_map', 'management_governance_analysis', 'capital_allocation_review', 'company_risk_analysis'] as const
export type CompanyResearchMethodId = typeof COMPANY_RESEARCH_METHOD_IDS[number]
export const COMPANY_METHOD_SECTION_IDS: Readonly<Record<CompanyResearchMethodId, readonly string[]>> = {
  company_history_strategy: ['company-overview'], business_model_map: ['business-model', 'business-segments', 'supply-chain'], product_technology_analysis: ['products', 'technologies'], business_driver_analysis: ['revenue-profit-drivers', 'growth-drivers', 'catalysts'], financial_quality_analysis: ['financial-quality'], market_structure_analysis: ['industry-exposure'], competitive_market_map: ['competition'], management_governance_analysis: ['management-capital-allocation'], capital_allocation_review: ['management-capital-allocation'], company_risk_analysis: ['risks'],
}
export interface CompanyMethodEvidenceRef { readonly sourceCandidateId: string; readonly location: string }
export interface CompanyMethodFinding { readonly text: string; readonly kind: 'fact' | 'inference' | 'assumption'; readonly evidence: readonly CompanyMethodEvidenceRef[] }
export interface CompanyMethodAttemptTrace {
  readonly attempt: number
  /** Present only when an executor actually returned an output. */
  readonly output?: unknown
  /** Actual host-rejected draft, separately retained and never treated as a validated method output. */
  readonly rejectedRawOutput?: string
  readonly reasoningInput?: unknown
  readonly reasoningInstruction?: string
  readonly executionEvidence?: readonly CompanyEvidencePacket[]
  readonly preparedAnalysis?: unknown
}
export interface CompanyResearchMethodResult {
  readonly skillId: CompanyResearchMethodId
  readonly status: 'complete' | 'insufficient_evidence' | 'failed' | 'cancelled'
  readonly answer: string
  readonly markdown: string
  readonly sections: readonly { readonly id: string; readonly markdown: string }[]
  readonly findings: readonly CompanyMethodFinding[]
  readonly limitations: readonly string[]
  readonly risks: readonly string[]
  readonly sourceCandidateIds: readonly string[]
  readonly diagnostics: readonly { readonly code: string; readonly message: string; readonly attempt: number; readonly causeSummary?: string }[]
  readonly attempts: number
  readonly executionEvidence?: readonly CompanyEvidencePacket[]
  /** Workflow-generated calculations may add evidence without rewriting the semantic operation's input. */
  readonly deterministicEvidence?: readonly CompanyEvidencePacket[]
  readonly attemptOutputs?: readonly CompanyMethodAttemptTrace[]
  readonly citationRepairs?: readonly (CompanyCitationRepair & { readonly attempt: number })[]
}
export interface ExecuteCompanyResearchMethodInput extends CompanyResearchInput {
  readonly skillId: CompanyResearchMethodId
  readonly reasoningExecutor?: ReasoningExecutor
  readonly signal?: AbortSignal
  /** Deterministic arithmetic/validation results prepared by Workflow; model may explain, never overwrite. */
  readonly preparedAnalysis?: unknown
  /** Workflow supplies its retry budget; the semantic adapter never exceeds two calls. */
  readonly maxAttempts?: 1 | 2
  /** Loaded by Workflow from the canonical method SKILL.md; never file I/O within the Skill. */
  readonly methodology?: string
}

export interface CompanyTamInput {
  readonly marketBoundary: string
  readonly asOf: string
  readonly formula: 'multiply' | 'sum'
  readonly outputUnit: string
  readonly overlapPolicy: 'single_market' | 'non_overlapping_segments'
  readonly operands: readonly { readonly name: string; readonly value: number; readonly unit: string; readonly kind: 'fact' | 'assumption'; readonly evidence: readonly CompanyMethodEvidenceRef[] }[]
}
/** Arithmetic belongs to code; extraction/market definitions and explicit assumptions are supplied by Workflow. */
export function calculateCompanyTam(input: CompanyTamInput, packets: readonly CompanyEvidencePacket[]): { readonly status: 'calculated'; readonly value: number; readonly unit: string; readonly formula: string; readonly marketBoundary: string; readonly asOf: string; readonly assumptions: readonly string[]; readonly evidence: readonly CompanyMethodEvidenceRef[] } {
  if (!['multiply', 'sum'].includes(input.formula) || !['single_market', 'non_overlapping_segments'].includes(input.overlapPolicy)) throw new Error('TAM: Invalid formula or overlap policy')
  if (!input.marketBoundary.trim() || !input.outputUnit.trim() || !/^\d{4}-\d{2}-\d{2}/.test(input.asOf) || !input.operands.length || input.operands.length > 10) throw new Error('TAM: Explicit market boundary, date, output unit and bounded operands required')
  if (input.formula === 'sum' && input.overlapPolicy !== 'non_overlapping_segments') throw new Error('TAM: Addition requires explicitly non-overlapping segments')
  if (input.formula === 'sum' && input.operands.some((operand) => operand.unit !== input.outputUnit)) throw new Error('TAM: Additive operands require identical units')
  const excerpts = new Map(packets.flatMap((packet) => packet.excerpts.map((excerpt) => [`${excerpt.sourceCandidateId}@${excerpt.location}`, excerpt.text] as const)))
  for (const operand of input.operands) {
    if (!['fact', 'assumption'].includes(operand.kind) || !operand.name.trim() || !operand.unit.trim() || !Number.isFinite(operand.value) || operand.value < 0 || !operand.evidence.length) throw new Error('TAM: Invalid operand or missing attributable evidence')
    const texts = operand.evidence.map((ref) => { const text = excerpts.get(`${ref.sourceCandidateId}@${ref.location}`); if (!text) throw new Error('TAM: Unresolved evidence location'); return text.replace(/[,，]/g, '') })
    if (operand.kind === 'fact' && !texts.some((text) => [...text.matchAll(/(?<![\d.])-?\d+(?:\.\d+)?(?![\d.])/g)].some((match) => Number(match[0]) === operand.value))) throw new Error(`TAM: Disclosed operand number not found in excerpt: ${operand.name}`)
  }
  const value = input.formula === 'sum' ? input.operands.reduce((total, operand) => total + operand.value, 0) : input.operands.reduce((total, operand) => total * operand.value, 1)
  if (!Number.isFinite(value)) throw new Error('TAM: Non-finite result')
  return { status: 'calculated', value, unit: input.outputUnit, formula: input.operands.map((operand) => `${operand.name}(${operand.value} ${operand.unit})`).join(input.formula === 'sum' ? ' + ' : ' × '), marketBoundary: input.marketBoundary, asOf: input.asOf, assumptions: input.operands.filter((operand) => operand.kind === 'assumption').map((operand) => `${operand.name}: ${operand.value} ${operand.unit}`), evidence: input.operands.flatMap((operand) => operand.evidence) }
}

export const COMPANY_METHOD_OUTPUT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['status', 'answer', 'markdown', 'sections', 'findings', 'limitations', 'risks'],
  properties: {
    status: { type: 'string', enum: ['complete', 'insufficient_evidence'] },
    answer: { type: 'string', minLength: 1, maxLength: 3000 },
    markdown: { type: 'string', minLength: 1, maxLength: 16000 },
    sections: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'object', additionalProperties: false, required: ['id', 'markdown'], properties: { id: { type: 'string' }, markdown: { type: 'string', minLength: 1, maxLength: 16000 } } } },
    findings: { type: 'array', maxItems: 24, items: { type: 'object', additionalProperties: false, required: ['text', 'kind', 'evidence'], properties: { text: { type: 'string', minLength: 1, maxLength: 1800 }, kind: { type: 'string', enum: ['fact', 'inference', 'assumption'] }, evidence: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'object', additionalProperties: false, required: ['sourceCandidateId', 'location'], properties: { sourceCandidateId: { type: 'string' }, location: { type: 'string' } } } } } } },
    limitations: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 1200 } },
    risks: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 1200 } },
  },
} as const

/** The host checks bounded JSON shape; exact evidence pairs and section ownership are checked below. */
export function companyMethodOutputSchema(skillId: CompanyResearchMethodId, _packets: readonly CompanyEvidencePacket[]) {
  const findings = COMPANY_METHOD_OUTPUT_SCHEMA.properties.findings
  const evidence = findings.items.properties.evidence
  const sectionIds = COMPANY_METHOD_SECTION_IDS[skillId]
  return {...COMPANY_METHOD_OUTPUT_SCHEMA,properties:{...COMPANY_METHOD_OUTPUT_SCHEMA.properties,
    sections:{...COMPANY_METHOD_OUTPUT_SCHEMA.properties.sections,minItems:1,maxItems:sectionIds.length,items:{...COMPANY_METHOD_OUTPUT_SCHEMA.properties.sections.items}},
    findings:{...findings,items:{...findings.items,properties:{...findings.items.properties,evidence:{...evidence,items:{...evidence.items,properties:{sourceCandidateId:{type:'string',minLength:1,maxLength:300},location:{type:'string',pattern:'^paragraph:[1-9]\\d*$',maxLength:100}}}}}}},
  }}
}

function collectMethodNumericIssues(output: unknown, input: ExecuteCompanyResearchMethodInput, packets: readonly CompanyEvidencePacket[]): { id: string; token: string; context: string }[] {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return []
  const value = output as Record<string, unknown>
  const items: { id: string; markdown: string }[] = []
  if (typeof value.markdown === 'string') items.push({ id: 'method-summary', markdown: value.markdown })
  if (typeof value.answer === 'string') items.push({ id: 'method-answer', markdown: value.answer })
  if (Array.isArray(value.sections)) value.sections.forEach((section, index) => {
    if (section && typeof section === 'object' && typeof (section as Record<string, unknown>).markdown === 'string') items.push({ id: typeof (section as Record<string, unknown>).id === 'string' ? String((section as Record<string, unknown>).id) : `sections[${index}]`, markdown: String((section as Record<string, unknown>).markdown) })
  })
  if (Array.isArray(value.findings)) value.findings.forEach((finding, index) => {
    if (!finding || typeof finding !== 'object' || typeof (finding as Record<string, unknown>).text !== 'string') return
    const row = finding as Record<string, unknown>
    const evidence = Array.isArray(row.evidence) ? row.evidence.flatMap(ref => {
      if (!ref || typeof ref !== 'object') return []
      const candidate = ref as Record<string, unknown>
      return typeof candidate.sourceCandidateId === 'string' && typeof candidate.location === 'string' ? [`[${candidate.sourceCandidateId}@${candidate.location}]`] : []
    }).join(' ') : ''
    items.push({ id: `finding-${index + 1}`, markdown: `${row.text} ${evidence}` })
  })
  const issues: { id: string; token: string; context: string }[] = []
  for (const item of items) {
    const grounded = validateCompanyNumericGrounding({ markdown: item.markdown, sources: input.sources, evidenceContexts: packets, preparedAnalysis: input.preparedAnalysis, trustedText: [input.company.symbol, input.asOf, ...companyCitedSplitDateText(item.markdown, packets), ...companyPreparedFinancialDateText(input.preparedAnalysis)] })
    for (const issue of grounded.diagnostics) if (issues.length < 12) issues.push({ id: item.id, token: issue.token.slice(0, 24), context: issue.context.replace(/\s+/g, ' ').slice(0, 32) })
  }
  return issues
}

/** Keep a bounded semantic retry from changing fields whose validation passed. */
function applyOnlyNumericRepairTargets(previous: unknown, next: unknown, targets: unknown, allowedCitations: ReadonlySet<string>): unknown {
  if (!previous || typeof previous !== 'object' || Array.isArray(previous) || !next || typeof next !== 'object' || Array.isArray(next) || !Array.isArray(targets)) return next
  const base = structuredClone(previous) as Record<string, unknown>
  const revised = next as Record<string, unknown>
  const preserveExactCitationCorrections = (originalText: unknown, revisedText: unknown): unknown => {
    if (typeof originalText !== 'string' || typeof revisedText !== 'string') return originalText
    const validRetryRefs = new Set([...revisedText.matchAll(/\[([^\]\s]+)@(paragraph:\d+)\]/g)]
      .map(match => `${match[1]}@${match[2]}`)
      .filter(ref => allowedCitations.has(ref)))
    return originalText.replace(/\[([^\]\s]+)@(paragraph:\d+)\]/g, (literal, invalidId: string, location: string) => {
      if (allowedCitations.has(`${invalidId}@${location}`)) return literal
      const replacements = [...validRetryRefs].filter(ref => {
        const separator = ref.lastIndexOf('@')
        const candidateId = ref.slice(0, separator)
        if (ref.slice(separator + 1) !== location) return false
        // Carry forward only a one-character source-id correction from the
        // retry. The claim text stays from the original validated field; the
        // exact source+locator is still checked against this method's packet.
        const longer = invalidId.length >= candidateId.length ? invalidId : candidateId
        const shorter = invalidId.length >= candidateId.length ? candidateId : invalidId
        if (longer.length - shorter.length > 1) return false
        let i = 0, j = 0, edits = 0
        while (i < longer.length && j < shorter.length) {
          if (longer[i] === shorter[j]) { i++; j++; continue }
          edits++; i++
          if (edits > 1) return false
        }
        return edits + (i < longer.length ? 1 : 0) <= 1
      })
      return replacements.length === 1 ? `[${replacements[0]}]` : literal
    })
  }
  // A bounded numeric retry must not import unrelated prose edits. It may,
  // however, contribute an exact supplied citation spelling for the same
  // paragraph when the original field contains a one-character source-id
  // typo. Otherwise merging the old field would resurrect a rejected ref.
  if (typeof base.markdown === 'string') base.markdown = preserveExactCitationCorrections(base.markdown, revised.markdown)
  if (typeof base.answer === 'string') base.answer = preserveExactCitationCorrections(base.answer, revised.answer)
  const sections = Array.isArray(base.sections) ? [...base.sections] : []
  const revisedSections = Array.isArray(revised.sections) ? revised.sections : []
  for (let index = 0; index < sections.length; index++) {
    const original = sections[index]
    if (!original || typeof original !== 'object') continue
    const row = original as Record<string, unknown>
    const retry = revisedSections.find(section => section && typeof section === 'object' && (section as Record<string, unknown>).id === row.id) as Record<string, unknown> | undefined
    if (retry) sections[index] = { ...row, markdown: preserveExactCitationCorrections(row.markdown, retry.markdown) }
  }
  const findings = Array.isArray(base.findings) ? [...base.findings] : []
  const revisedFindings = Array.isArray(revised.findings) ? revised.findings : []
  for (const item of targets) {
    if (!item || typeof item !== 'object') continue
    const id = (item as Record<string, unknown>).id
    if (typeof id !== 'string') continue
    const sectionIndex = sections.findIndex(section => section && typeof section === 'object' && (section as Record<string, unknown>).id === id)
    if (sectionIndex >= 0) {
      const replacement = revisedSections.find(section => section && typeof section === 'object' && (section as Record<string, unknown>).id === id)
      if (replacement && typeof (replacement as Record<string, unknown>).markdown === 'string') sections[sectionIndex] = { ...(sections[sectionIndex] as Record<string, unknown>), markdown: (replacement as Record<string, unknown>).markdown }
      continue
    }
    const findingMatch = /^finding-(\d+)$/.exec(id)
    if (findingMatch) {
      const index = Number(findingMatch[1]) - 1
      const replacement = revisedFindings[index]
      if (index >= 0 && replacement && typeof replacement === 'object') {
        const original = findings[index]
        if (original && typeof original === 'object') findings[index] = { ...(original as Record<string, unknown>), ...(typeof (replacement as Record<string, unknown>).text === 'string' ? { text: (replacement as Record<string, unknown>).text } : {}), ...(Array.isArray((replacement as Record<string, unknown>).evidence) ? { evidence: (replacement as Record<string, unknown>).evidence } : {}) }
      }
      continue
    }
    if (id === 'method-summary' && typeof revised.markdown === 'string') base.markdown = revised.markdown
    if (id === 'method-answer' && typeof revised.answer === 'string') base.answer = revised.answer
  }
  if (sections.length) base.sections = sections
  if (findings.length) base.findings = findings
  return base
}

function numericTokenForCandidateSearch(token: string): string {
  return token.trim().replace(/(?:人民币)?(?:亿元|万元|元|个百分点|%|倍|万股|股)$/u, '')
}

/**
 * A reference-first failure can hide independently detected numeric failures.
 * Give the bounded retry exact supplied rows containing those tokens, without
 * attaching any row to the claim or treating a match as proof of grounding.
 */
function buildReferenceRetryNumericTargets(
  output: unknown,
  issues: readonly { id: string; token: string; context: string }[],
  packets: readonly CompanyEvidencePacket[],
): { id: string; fieldPath: string; textFieldPath?: string; evidenceFieldPath?: string; originalText?: string; candidateExcerpts?: readonly { token: string; sourceCandidateId: string; location: string; text: string; truncated: boolean; context?: readonly { location: string; text: string; truncated: boolean }[] }[]; issues: readonly { token: string; context: string }[] }[] {
  if (!output || typeof output !== 'object' || Array.isArray(output) || !issues.length) return []
  const value = output as Record<string, unknown>
  const targets: ReturnType<typeof buildReferenceRetryNumericTargets> = []
  let candidateBudget = 6000
  let candidateCount = 0
  for (const id of [...new Set(issues.map(issue => issue.id))]) {
    let fieldPath: string
    let originalText: string | undefined
    const findingIndex = /^finding-(\d+)$/.exec(id)
    const sections = Array.isArray(value.sections) ? value.sections : []
    const sectionIndex = sections.findIndex(section => section && typeof section === 'object' && (section as Record<string, unknown>).id === id)
    if (sectionIndex >= 0) {
      fieldPath = `sections[${sectionIndex}].markdown`
      const markdown = (sections[sectionIndex] as Record<string, unknown>).markdown
      if (typeof markdown === 'string') originalText = markdown
    } else if (findingIndex) {
      fieldPath = `findings[${Number(findingIndex[1]) - 1}]`
      const finding = Array.isArray(value.findings) ? value.findings[Number(findingIndex[1]) - 1] : undefined
      if (finding && typeof finding === 'object' && typeof (finding as Record<string, unknown>).text === 'string') originalText = String((finding as Record<string, unknown>).text)
    } else if (id === 'method-summary' && typeof value.markdown === 'string') {
      fieldPath = 'markdown'
      originalText = value.markdown
    } else if (id === 'method-answer' && typeof value.answer === 'string') {
      fieldPath = 'answer'
      originalText = value.answer
    } else continue

    const targetIssues = issues.filter(issue => issue.id === id)
    const candidateExcerpts = [...new Set(targetIssues.map(issue => issue.token))].flatMap(token => {
      const searchToken = numericTokenForCandidateSearch(token)
      const escaped = searchToken.replaceAll('.', '\\.')
      const pattern = new RegExp(`(?<![\\d.,-])${escaped}(?![\\d.,])`)
      return packets.flatMap(packet => packet.excerpts.filter(excerpt => pattern.test(excerpt.text)).map(excerpt => ({ packet, excerpt, pattern })))
        .slice(0, 12)
        .flatMap(({ packet, excerpt, pattern }) => {
          if (candidateCount >= 24 || candidateBudget < 40) return []
          const match = pattern.exec(excerpt.text)
          if (!match) return []
          const start = Math.max(0, match.index - 90)
          const excerptText = excerpt.text.slice(start, start + Math.min(240, candidateBudget))
          candidateBudget -= excerptText.length
          candidateCount++
          const paragraph = Number(/^paragraph:(\d+)$/.exec(excerpt.location)?.[1])
          const adjacent = packet.excerpts.filter(row => {
            const rowNumber = Number(/^paragraph:(\d+)$/.exec(row.location)?.[1])
            return Number.isFinite(paragraph) && Math.abs(rowNumber - paragraph) <= 1 && row.location !== excerpt.location && row.text.length <= 180
          }).map(row => row.location)
          const context = [...new Set([...(excerpt.contextLocations ?? []), ...adjacent])].slice(0, 3).flatMap(location => {
            const row = packet.excerpts.find(item => item.location === location)
            if (!row || candidateBudget < 20) return []
            const text = row.text.slice(0, Math.min(180, candidateBudget))
            candidateBudget -= text.length
            return [{ location, text, truncated: text.length < row.text.length }]
          })
          return [{ token, sourceCandidateId: excerpt.sourceCandidateId, location: excerpt.location, text: excerptText, truncated: start > 0 || excerptText.length < excerpt.text.length, ...(context.length ? { context } : {}) }]
        })
    })
    targets.push({ id, fieldPath, ...(findingIndex ? { textFieldPath: `${fieldPath}.text`, evidenceFieldPath: `${fieldPath}.evidence` } : {}), ...(originalText !== undefined ? { originalText } : {}), ...(candidateExcerpts.length ? { candidateExcerpts } : {}), issues: targetIssues.map(({ token, context }) => ({ token, context })) })
  }
  return targets
}

/** Preserve already grounded risk-row number/reference pairs during a numeric repair. */
function buildRiskNumericRetryPreservation(output: unknown, packets: readonly CompanyEvidencePacket[]): string {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return ''
  const value = output as Record<string, unknown>
  const sections = Array.isArray(value.sections) ? value.sections : []
  const risks = sections.find(section => section && typeof section === 'object' && (section as Record<string, unknown>).id === 'risks') as Record<string, unknown> | undefined
  if (typeof risks?.markdown !== 'string') return ''
  const rows = risks.markdown.split(/\r?\n/)
  const preserved = new Set<string>()
  for (const row of rows) {
    const references = [...row.matchAll(/\[([^\]@]+)@(paragraph:[1-9]\d*)\]/g)].map(match => ({ sourceCandidateId: match[1]!, location: match[2]! }))
    if (!references.length) continue
    const numbers = [...new Set(row.match(/(?<![\d.,-])[-−]?\d[\d,]*(?:\.\d+)?%?(?![\d.,])/g) ?? [])]
    for (const token of numbers) for (const ref of references) {
      const excerpt = packets.find(packet => packet.sourceCandidateId === ref.sourceCandidateId)?.excerpts.find(item => item.location === ref.location)
      if (!excerpt) continue
      const normalizedToken = token.replaceAll(',', '')
      const unsignedToken = normalizedToken.replace(/^[-−]/, '')
      const escaped = unsignedToken.replaceAll('.', '\\.')
      const sourceMatch = new RegExp(`(?<![\\d.,-])(-?)${escaped}%?(?![\\d.,])`).exec(excerpt.text.replaceAll(',', ''))
      if (!sourceMatch) continue
      const sourceIsNegative = sourceMatch[1] === '-'
      const tokenIsNegative = /^[-−]/.test(normalizedToken)
      const index = row.indexOf(token)
      const rowStatesDecrease = /(?:下降|减少|下滑|降低|回落|收窄)\s*(?:(?:人民币|CNY|RMB)\s*)?$/.test(row.slice(0, index))
      if (sourceIsNegative !== tokenIsNegative && !(sourceIsNegative && !tokenIsNegative && rowStatesDecrease)) continue
      preserved.add(`${token}${sourceIsNegative && !tokenIsNegative ? '（来源为负值，正文明确写作减少幅度）' : ''} → ${ref.sourceCandidateId}@${ref.location}`)
    }
  }
  if (!preserved.size) return ''
  return `风险方法数值重试的引用保全清单（只含上一稿中可在本次同一原文定位核实的数字）：${[...preserved].slice(0, 32).join('；')}。逐项保留每个非错误风险表数值及其对应的原文行引用；修复缺引数字时，引用必须来自repairTargets中实际包含该数值且科目、期间、单位相符的同一数据行。candidateExcerpts.context仅供辨认表头/标签，不能引用其邻段代替数值行；禁止用p919、p928或任何相邻段落支持客户占比或其他数值，只有该段原文逐字包含该数值和对应行标签时才可引用。修复后逐数字复核整张风险表和findings，不能为补一个数字而丢掉其他已有效的数字引用。`
}

/**
 * A narrowly bound PDF continuation repair for the disclosed transport
 * industry row. It may add the immediately adjacent numeric paragraph only
 * when the claim names the full row, already cites the complete table headers
 * and split label, and every cited value exactly matches that continuation.
 * The ordinary reference and numeric validators still run afterwards.
 */
function bindExactCompanyTableRows<T extends { readonly findings: readonly CompanyMethodFinding[] }>(
  output: T,
  packets: readonly CompanyEvidencePacket[],
  sources: readonly NormalizedResearchSource[],
  allowExactSplitClassificationRepair = false,
): T {
  const sourceMap = new Map(sources.map(source => [source.candidate.candidateId, source]))
  let changed = false
  const findings = output.findings.map(finding => {
    const text = finding.text
    if (!/毛利率|营业收入|营业成本/.test(text)) return finding
    const classification = /分行业|行业分类/.test(text) ? '分行业' : /分产品|产品分类/.test(text) ? '分产品' : undefined
    if (!classification) return finding
    for (const packet of packets) {
      const refs = new Set(finding.evidence.filter(ref => ref.sourceCandidateId === packet.sourceCandidateId).map(ref => ref.location))
      const source = sourceMap.get(packet.sourceCandidateId)
      if (!source) continue
      const citedExcerpts = packet.excerpts.filter(row => refs.has(row.location)).map(row => row.text).join(' ')
      // Complete a table citation only when the finding already cites that
      // same source's segment and metric headers; never borrow a matching
      // numeric cell from another table or document.
      const hasClassificationCitation = citedExcerpts.includes(classification)
      if ((!hasClassificationCitation && !allowExactSplitClassificationRepair) || !/毛利率/.test(citedExcerpts) || !/增减/.test(citedExcerpts)) continue
      const paragraphs = source.content.split(/\r?\n/)
      const supplied = new Map(packet.excerpts.map(row => [row.location, row.text]))
      // Match magnitude here; the ordinary numeric validator below still
      // verifies that an asserted increase/decrease agrees with the source sign.
      const numberTokens = (value: string): string[] => [...value.matchAll(/(?<![\d.,])[-−]?\d[\d,]*(?:\.\d+)?\s*[%％]/g)].map(match => match[0]!.replace(/[\s％−-]/g, '').replace('%', ''))
      const claimNumbers = new Set(numberTokens(text))
      const candidates: Array<{ refs: string[]; label: string }> = []
      for (let index = 0; index < paragraphs.length; index++) {
        const row = paragraphs[index]!.trim()
        if (!row || !/\d/.test(row) || !/%/.test(row)) continue
        const prior = paragraphs[index - 1]?.trim() ?? ''
        const rowLabel = row.split(/\s+[-−]?\d/)[0] ?? ''
        const splitLabel = /^\D{2,40}$/.test(prior) && !/^(?:单位|分行业|分产品|分地区|分销售模式)/.test(prior)
        const fullLabel = (splitLabel ? prior + rowLabel : rowLabel).replace(/\s+/g, '')
        if (fullLabel.length < 4 || !text.replace(/\s+/g, '').includes(fullLabel)) continue
        const rowValues = new Set(numberTokens(row))
        if ([...claimNumbers].filter(token => rowValues.has(token)).length < 2) continue
        let markerIndex = -1
        for (let cursor = index - 1; cursor >= Math.max(0, index - 30); cursor--) {
          if (paragraphs[cursor]!.trim() === classification) { markerIndex = cursor; break }
        }
        if (markerIndex < 0) continue
        const markerLocation = `paragraph:${markerIndex + 1}`
        if (supplied.get(markerLocation)?.trim() !== classification) continue
        const rowLocation = `paragraph:${index + 1}`
        const priorLocation = `paragraph:${index}`
        if (supplied.get(rowLocation)?.trim() !== row) continue
        candidates.push({ label: fullLabel, refs: [...(!refs.has(markerLocation) ? [markerLocation] : []), ...(splitLabel && supplied.get(priorLocation)?.trim() === prior ? [priorLocation] : []), rowLocation] })
      }
      const labelCounts = new Map<string, number>()
      for (const candidate of candidates) labelCounts.set(candidate.label, (labelCounts.get(candidate.label) ?? 0) + 1)
      const unique = new Map(candidates.filter(candidate => labelCounts.get(candidate.label) === 1).map(candidate => [candidate.refs.join('|'), candidate]))
      if (!unique.size) continue
      const added = [...unique.values()].flatMap(candidate => candidate.refs
        .filter(location => !refs.has(location))
        .map(location => ({ sourceCandidateId: packet.sourceCandidateId, location })))
      if (!added.length) continue
      changed = true
      return { ...finding, evidence: [...finding.evidence, ...added] }
    }
    return finding
  })
  return changed ? { ...output, findings } : output
}

/** Repair a misclassified segment claim only when its percentages identify one exact supplied table row. */
function repairCompanySegmentFindingLabels<T extends {
  readonly findings: readonly CompanyMethodFinding[]
  readonly sections: readonly { readonly id: string; readonly markdown: string }[]
  readonly markdown: string
  readonly answer: string
}>(output: T, packets: readonly CompanyEvidencePacket[], sources: readonly NormalizedResearchSource[]): T {
  const sourceMap = new Map(sources.map(source => [source.candidate.candidateId, source]))
  type Repair = { oldType: string; newType: string; oldLabel: string; newLabel: string; signatures: readonly string[]; refs: readonly string[] }
  const repairs: Repair[] = []
  const findings = output.findings.map(finding => {
    const percentTokens = [...finding.text.matchAll(/(?<![\d.,])[-−]?\d[\d,]*(?:\.\d+)?\s*[%％]/g)].map(match => match[0]!.replace(/\s/g, '').replace('％', '%').replace('−', '-'))
    if (!percentTokens.length) return finding
    const candidates: { sourceId: string; type: '分行业' | '分产品' | '分地区' | '分销售模式'; label: string; rowLocation: string; labelLocation?: string; rowText: string }[] = []
    for (const sourceId of new Set(finding.evidence.map(ref => ref.sourceCandidateId))) {
      const source = sourceMap.get(sourceId)
      const packet = packets.find(item => item.sourceCandidateId === sourceId)
      if (!source || !packet) continue
      const paragraphs = source.content.split(/\r?\n/)
      const supplied = new Map(packet.excerpts.map(excerpt => [excerpt.location, excerpt.text.trim()]))
      for (let index = 0; index < paragraphs.length; index++) {
        const rowText = paragraphs[index]!.trim()
        if (!rowText || !/\d/.test(rowText) || !/%/.test(rowText)) continue
        const rowPercents = [...rowText.matchAll(/(?<![\d.,])[-−]?\d[\d,]*(?:\.\d+)?\s*[%％]/g)].map(match => match[0]!.replace(/\s/g, '').replace('％', '%').replace('−', '-'))
        if (!percentTokens.every(token => rowPercents.includes(token))) continue
        const rowLocation = `paragraph:${index + 1}`
        if (supplied.get(rowLocation) !== rowText) continue
        const rowLabel = rowText.split(/\s+(?=[\d,])/u)[0]?.trim() ?? ''
        if (!rowLabel) continue
        let start = index - 1
        while (start >= 0 && index - start <= 4 && paragraphs[start]!.trim() && !/\d/.test(paragraphs[start]!.trim())
          && !/^(?:单位|分行业|分产品|分地区|分销售模式|分销售渠道)$/.test(paragraphs[start]!.trim())
          && !/营业收入|营业成本|毛利率|同期增减/.test(paragraphs[start]!.trim())) start--
        const labelStart = start + 1
        const labelParts = paragraphs.slice(labelStart, index).map(value => value.trim()).filter(Boolean)
        const label = [...labelParts, rowLabel].join('').replace(/\s+/g, '')
        let segmentIndex = -1
        for (let cursor = index - 1; cursor >= Math.max(0, index - 30); cursor--) {
          if (/^分(?:行业|产品|地区|销售模式|销售渠道)\s*$/.test(paragraphs[cursor]!.trim())) { segmentIndex = cursor; break }
        }
        if (segmentIndex < 0) continue
        const marker = paragraphs[segmentIndex]!.trim() as '分行业' | '分产品' | '分地区' | '分销售模式'
        const type = marker as '分行业' | '分产品' | '分地区' | '分销售模式'
        const sourceLabelStart = labelStart
        const labelLocation = sourceLabelStart < index ? `paragraph:${sourceLabelStart + 1}` : undefined
        // A repair is limited to claims that misname this row's table family or
        // company segment. Ordinary same-family findings remain untouched.
        const tableType = finding.text.match(/分(行业|产品|地区|销售模式)表/)
        const claimedLabel = finding.text.match(/(?:显示[，,]?|表中[，,]?|表[，,]?|中[，,]?)([^，,。；]{2,36}?)(?:的完整标签|的毛利率|毛利率|营业收入|收入同比|成本同比)/)?.[1]?.trim()
        const actualType = type
        const wrongFamily = Boolean(tableType && `分${tableType[1]}` !== actualType)
        const wrongLabel = Boolean(claimedLabel && !label.includes(claimedLabel.replace(/\s+/g, '')) && !claimedLabel.includes(label))
        if (!wrongFamily && !wrongLabel) continue
        candidates.push({ sourceId, type: actualType, label, rowLocation, ...(labelLocation ? { labelLocation } : {}), rowText })
      }
    }
    const uniqueKeys = new Map(candidates.map(candidate => [`${candidate.sourceId}|${candidate.type}|${candidate.label}|${candidate.rowLocation}`, candidate]))
    if (uniqueKeys.size !== 1) return finding
    const candidate = [...uniqueKeys.values()][0]!
    const source = sourceMap.get(candidate.sourceId)!
    const packet = packets.find(item => item.sourceCandidateId === candidate.sourceId)!
    const rowParagraph = Number(candidate.rowLocation.slice('paragraph:'.length))
    const preceding = paragraphsFromSource(source.content, rowParagraph - 1, Math.max(1, rowParagraph - 30))
    const markerParagraph = [...preceding].reverse().find(item => item.text.trim() === candidate.type)?.paragraph
    if (!markerParagraph) return finding
    const unit = preceding.find(item => /^单位\s*[：:]\s*元$/.test(item.text.trim()))
    const headerRows = preceding.filter(item => item.paragraph > (unit?.paragraph ?? 0) && item.paragraph < markerParagraph && /营业收入|营业成本|毛利率|同期增减/.test(item.text))
    const markerExcerpt = packet.excerpts.find(item => item.location === `paragraph:${markerParagraph}`)
    const rowExcerpt = packet.excerpts.find(item => item.location === candidate.rowLocation)
    const labelExcerpt = candidate.labelLocation ? packet.excerpts.find(item => item.location === candidate.labelLocation) : undefined
    if (!unit || !markerExcerpt || !rowExcerpt || candidate.labelLocation && !labelExcerpt || headerRows.some(item => !packet.excerpts.some(excerpt => excerpt.location === `paragraph:${item.paragraph}`))) return finding
    const refs = [...new Set([`paragraph:${unit.paragraph}`, ...headerRows.map(item => `paragraph:${item.paragraph}`), `paragraph:${markerParagraph}`, ...(candidate.labelLocation ? [candidate.labelLocation] : []), candidate.rowLocation])]
    const actualTypeName = candidate.type.replace(/^分/, '')
    let text = finding.text
    const tableMatch = text.match(/分(?:行业|产品|地区|销售模式)表/)
    if (tableMatch) text = text.replace(tableMatch[0], `分${actualTypeName}表`)
    const claimed = text.match(/(?:显示[，,]?|表中[，,]?|表[，,]?|中[，,]?)([^，,。；]{2,36}?)(?:的完整标签|的毛利率|毛利率|营业收入|收入同比|成本同比)/)?.[1]?.trim()
    if (claimed && !candidate.label.includes(claimed.replace(/\s+/g, '')) && !claimed.includes(candidate.label)) text = text.replace(claimed, candidate.label)
    repairs.push({ oldType: tableMatch?.[0] ?? '', newType: `分${actualTypeName}表`, oldLabel: claimed ?? '', newLabel: candidate.label, signatures: percentTokens, refs: refs.map(location => `[${candidate.sourceId}@${location}]`) })
    return { ...finding, text, evidence: refs.map(location => ({ sourceCandidateId: candidate.sourceId, location })) }
  })
  if (!repairs.length) return output
  const rewrite = (markdown: string) => markdown.split(/(?<=[。；\n])/u).map(sentence => {
    let result = sentence
    for (const repair of repairs) {
      if (!repair.oldLabel || !result.includes(repair.oldLabel) || !repair.signatures.some(token => result.includes(token))) continue
      result = result.replace(repair.oldLabel, repair.newLabel)
      if (repair.oldType) result = result.replace(repair.oldType, repair.newType)
      result = result.replace(/\s*\[[A-Za-z0-9._:-]+@paragraph:\d+\]/g, '').trimEnd()
      result = `${result} ${repair.refs.join(' ')}`
    }
    return result
  }).join('')
  return { ...output, findings, sections: output.sections.map(section => ({ ...section, markdown: rewrite(section.markdown) })), markdown: rewrite(output.markdown), answer: rewrite(output.answer) }
}

function paragraphsFromSource(content: string, beforeParagraph: number, minimumParagraph: number): Array<{ paragraph: number; text: string }> {
  return content.split(/\r?\n/).map((text, index) => ({ paragraph: index + 1, text: text.trim() })).filter(item => item.paragraph >= minimumParagraph && item.paragraph <= beforeParagraph)
}

export const COMPANY_METHOD_METHODOLOGY: Readonly<Record<CompanyResearchMethodId, { readonly questions: string; readonly terms: readonly string[] }>> = {
  company_history_strategy: { questions: '解释公司成立/前身沿革、主要发展阶段、关键产品/并购/市场转折及战略如何改变业务方向和风险。仅在本次输入来源实际披露时，才并列说明前身设立或共同注册、改制/整体变更、现主体工商登记、开始经营与上市等不同事件及其主体和口径；不得把缺失事件补成事实，也不得要求所有公司都具备每一种日期。若材料记载创始人/股东在较早年份“共同注册成立”前身企业，该事件属于早于股份制改制的独立沿革节点，必须在正文及本方法finding中以原文年份和主体明确说明，并与股份公司整体变更日期区分；此时不得再称前身首次设立年份未披露。对东山精密等前身整体变更案例，清楚区分有限责任公司前身、股份制整体变更及股份公司登记日期；若来源提供股票挂牌日期也要单独说明。财务序列的最早可用期间只代表数据窗口，不能据此推断公司开始经营或成立日期；必须交代该财务数据的报告期间和主体口径，不能用结构化财务数据代替沿革证据。历史事件绑定其紧邻且适用的年份，不得借用上一事件或其他产品的年份。若同一finding比较不同成立口径，evidence必须同时包含支持每个年份及事件的来源行；分别在正文陈述时也要分别引用，不能将来源甲的日期写进来源乙对应的finding。每个引用必须把来源 candidateId 与 paragraph 定位作为一个整体，从本次输入的同一条证据中原样复制；不同报告的 paragraph 编号不能互换，即使编号相同也必须核对来源标题和正文。聚焦时间线、战略转型和路径依赖，不重复商业模式或财务分析方法负责的分部收入加总、金额换算和增长率计算；营业收入趋势仅作为来源明确披露的经营背景，不在本方法中重新计算；只在来源明确支持时用简短经营结果说明战略兑现，不自行引入财务公式。逐项给出时间和证据；总结路径依赖、战略兑现及后续监控信号。', terms: ['历史', '前身', '发展', '战略', '收购', '上市', '转型', 'revenue', 'history', 'strategy'] },
  business_model_map: { questions: '回答谁付费、买什么、如何定价交付和确认收入。分别展开主要分部、客户类型、渠道、供应链、成本与利润来源。business-model owned section 必须自身概述主要产品的收入金额及占比，并附精确收入构成行和单位/期间表头引用；即使 business-segments 另有完整表格，也不能用交叉章节替代本节这一最小收入结构摘要。已供给营业收入构成或分产品/分行业占比表时，引用该表实际主体行并报告披露占比；产品、分行业、地区和销售模式虽可能位于同一张表，但每个数字必须引用其自身的精确数据行和对应标签，不能以表头或另一分类的行替代，例如地区内销/外销占比不能只引销售模式或分产品行；不同分类数值不得共用模糊引用。不能只列集团总收入，不能只查毛利表后宣称收入占比未列示，也不自行估算缺失占比。分产品毛利率需引用自己的产品行及单位/年份表头，只能称该产品毛利率；禁止把产品/行业毛利行升级为公司合并毛利率。若提供前五大客户合计销售占比或客户表，business-model 和 supply-chain owned sections 均应报告已披露的前五大客户比例及最大单一客户比例，并在每个章节分别绑定对应数值行及表头/期间；不得因客户名称匿名而称集中度比例未披露或不可验证。客户匿名、客户所属产品/分部未披露、不能确认其为经销商/终端客户等，应明确保留为身份或业务映射缺口，不得猜测身份或把集团集中度映射到特定产品。若材料提供前五名供应商合计金额/采购占比或第一名供应商数据，supply-chain owned section 应逐项列示已披露值；金额、占比各自引用原始数据行，并为明细供应商行引用对应表头（如“序号/供应商名称/采购额/占比”）、单位行及年度期间行。不能只用客户表头或跨段泛引代替供应商表头；不能只在其他章节引用。解释规模优势及约束。不得把典型行业惯例当作公司事实。', terms: ['主营', '业务', '收入', '客户', '分部', '销售', '供应商', '成本', 'business', 'segment'] },
  product_technology_analysis: { questions: '按 owned section 分工分别成文，不得把两个ID合并：products专门分析产品组合、应用/公司定位、产品级商业化阶段及产品收入/利润差异；technologies专门分析技术架构和路线、研发/量产阶段、技术到性能或竞争力的可证因果路径、验证缺口与替代风险。两节须分别有独立、可发布的实质正文，可以引用同一证据，但不得以一节或findings代替另一节。用产品矩阵比较产品覆盖、应用场景、技术路线、差异、竞争替代及商业化阶段。任何带数字的技术标签（如5G）必须引用同一条实际包含该标签的证据段落，不能用相邻段落或转行延续段落代替；若相关证据段落未在本次输入或无法精确定位，则删除该标签。严格区分已披露产品规格、公司产品定位与实际客户需求：只有明确的客户/消费者调研、问卷、访谈、反馈或可观察购买行为证据，才能把安全、动力、能耗、成本、车型选择等写成实际客户关注或偏好的事实；产品规格、产品用途、市场布局和公司宣传不能证明客户实际关注。若公司披露了客户需求判断，应写成“公司称/公司定位”，不可升级为独立客户事实。若没有调研/反馈/购买行为证据，也没有公司对客户需求的明确表述，应写“未有客户需求调研/反馈验证”，把潜在购买因素标成待验证分析假设，不要写成事实。区分公司宣称和独立验证；严格区分利润表“研发费用”与研发活动表“研发投入金额”，分别照录原表科目、期间、单位与数值，不能将研发费用数值改称研发投入或将二者合并成趋势；说明研发投入如何形成竞争力、专利数量不能单独证明护城河。竞争对照有范围边界：只依据本方法所供产品/技术资料说“本节未提供具名竞品同口径比较”；不得把它扩大成报告全部材料均无具名竞品，也不得否认其他方法可能发现的候选公司。直接竞争、客户重叠、性能/成本领先仍需各自证据。', terms: ['产品', '技术', '研发', '专利', '工艺', '量产', '电池', 'PCB', 'product', 'technology'] },
  business_driver_analysis: { questions: '解释收入和利润变化的量、价、组合、分部、产能与成本链路。总成本率或毛利率变化不能直接推断单位成本变化；没有同口径数量及成本数据时，明确单位成本不可分解。已披露的贡献与定性推断分开；结构化财务金额严格照录preparedAnalysis.financial.financialReadableTable中相应期间的人民币亿元两位小数展示值；变动额或其他确定性计算只照录preparedAnalysis中相应字段给出的结果、单位和公式，不得自行换算或选择亿元/十亿元量级。字段未提供时引用来源原始数值和单位，或删除数字并说明缺口。缺少数量/价格时不能伪造分解。只有原始来源或明确字段证实归属于上市公司股东时才称归母净利润；结构化netProfit/净利润字段若未标明归母属性，必须沿用“净利润（归母属性未注明）”，不能升级为归母净利润，也不能称合并净利润。使用分行业/分产品数据时沿用原表范围标签；行业表和产品表必须分成独立行或段落，不能用“分行业/分产品”合并口径，不能把一张表的行标签套到另一张表。表格百分比、同比变化须引用同一组对应期间表头及数据行，清楚标出产量/销量、累计/单季及同比基期。数据期间必须跟随其原始报告和表头：年报中的年度产量/销量只能称该年度数据，不得改称半年报、半年度或本期累计；只有所引半年报表头明确包含半年度数据时，才能描述半年增长。不得把并购并表、全年产能投放或期间口径不同的数量变化归为有机增长。毛利率水平用百分比；毛利率变动严格沿用来源列头和数据单元显示的单位，若列头/单元显示百分比就写百分比，不能改称百分点；只有用同一指标、可比期间两个毛利率水平进行代码计算并列出公式时，结果才写百分点。对PDF表格必须同时引用实际的完整表头行、单位/期间行及对应数据行，不能把收入、成本增速或毛利率水平当成毛利率变动。任何包含数字的finding都要在该finding自身引用数据行；尤其毛利率变动finding必须同时引用完整拆分表头、单位/期间行、分行业/分产品区段标题、完整标签行及含该变化单元格的数值行。仅引用表头和区段、让报告段落引用数据行、或把数值行放在另一finding的证据中都不合格。逐字保留确定性差额公式的顺序和正负号；若A−B为负，表述为A低于B，不能把绝对值方向说反。催化判断必须检查本研究其他已完成方法或本节已引原文中的公司特定商业化进度，如产品发布、客户导入、项目送样/认证、批量出货、产能爬坡或研发节点；引用已存在的精确sourceCandidateId@paragraph定位，说明已证实阶段、下一步条件、可观察指标及对收入/利润的可能传导。预测与已兑现结果严格区分，不把行业机会写成公司催化。若全套研究证据均无公司特定节点，说明具体缺失输入和影响，不得虚构。提出增长条件及可监控指标。', terms: ['收入', '利润', '销量', '产量', '价格', '增长', '产能', '毛利', 'revenue', 'growth'] },
  financial_quality_analysis: { questions: '比较可比期间收入、利润、利润率、经营现金流、营运资本、债务、资本开支和分部。Workflow会在方法完成后附加代码生成的三表数值、口径和计算表；请将它作为金额及公式的最终展示，不要重复抄写余额、换算亿元、重算增长率或生成高精度比率。解释方向、三表关系、现金转化、一次性项目、资本化和应收/存货风险；叙述必须与结构化数值表方向一致。确需写数字时只逐字照录financialReadableTable对应指标、期间和金额单位，或原文明确披露且该finding引用直接支持的值；引用不能支持时删去该数值并说明具体缺口。结构化netProfit/净利润字段如未明确标示“归属于上市公司股东”或归母口径，必须称结构化净利润（归母属性未注明），不得写成归母净利润；由此计算的现金转化或应计代理也必须保留该限制，不能赋予未供给的利润归属范围。半年报资产负债表的比较列若为“上年末”，期末余额变化只能称“较上年末”，不得称“上年同期”或余额同比；只有比较同一科目同一日期的preparedAnalysis同比结果才可报告同比。期末余额金额、较上年末差异和结构化同比增速是不同论点，须分别标明期间/基期并引用各自直接来源；使用结构化历史序列同比时，明确说明这是基于2025-06-30与2026-06-30（或实际期间）的结构化期末数据计算，不是半年报原表“本报告期末／上年末”的直接同比披露，并在附近引用结构化来源及原表比较列。只引用输入中口径与期间明确的数字；preparedAnalysis 为计算权威。结构化金额必须采用financialReadableTable展示值（人民币亿元，两位小数），或原结构化来源的原值与单位，不自行输出高精度单位换算小数；毛利率/净利率水平及派生差额保留两位小数，差额附上显示值的公式、期间、百分号/百分点单位，不回显原始浮点精度。仅当preparedAnalysis中同一合并指标具备两个可比期间、同为YTD或同为期末口径且单位一致时，才可把结构化序列称为“合并”并比较；标出两个具体期间和计算来源，不把单期结构化指标误作可比趋势。凡提到代码已计算的增长差，直接照录确定性公式中的显示增速、差值、期间和余额/累计口径。分部增长率、同比变化及比率差异只能采用输入中原文明示值或preparedAnalysis确定性计算值；若缺少同科目、同期间的代码计算，不得拿分部金额自行心算增速，也不得将全年与半年度比较后称同比，只保留已披露金额和比较限制。毛利率和净利率水平使用百分比；两个期间比率水平的差额经代码计算并列出操作数、公式时可写百分点；表格中毛利率变动严格沿用来源列头与单元显示单位，原文显示%不得改写为百分点。分行业毛利率、分产品毛利率与合并毛利率必须分别标注，不能把相邻收入/成本增速改写为毛利率变动。区分合并与分行业/分产品数据：只有结构化合并计算或明确标注的总计行可称合并毛利率；分行业行即使接近总体也必须保留其分行业口径。引用结构化财务摘要的派生增长差或百分点变化时，给出准确公式、两个操作数、单位、期间和口径，不只报结果。findings逐条自足：每个finding中的每个数字都必须由该finding.evidence内的精确数据行支持，必要时包括匹配的期间、单位和表头行。section正文或其他finding中的引用不能借给该finding；若本finding找不到可引用的精确行，删除数值主张或说明具体证据缺口。', terms: ['现金', '负债', '资产', '利润', '应收', '存货', '资本', '财务', 'cash', 'financial'] },
  market_structure_analysis: { questions: '分别界定主要市场的产品、地区、客户和时间边界、产业链角色、需求变化和监管。若所选证据已经提供有出处的行业规模或预测数值，必须在“行业规模背景”中保留市场边界、年份、币种/单位、预测机构及其作为公司年报转述的归属，不能因公司级TAM输入不足而省略；即使预测属于相邻而非直接可比市场，也要列出其数值并说明相邻关系及不适用边界，例如AI服务器、数据中心液冷预测只能作AI基础设施背景，不能当作汽车或手机部件市场规模。行业预测只作所定义行业的背景，不等于公司可服务市场、公司TAM或收入预测；不同产品/地域/期间分别列示，不相加，不推断公司份额。TAM 仅引用有口径的披露或 preparedAnalysis 中带来源的公式计算结果；避免多个重叠市场相加。缺公司级规模时仍须区分已披露行业规模与真正缺失的公司产品/地域/客户边界或份额输入，并解释对TAM结论的影响。财务表格的毛利率水平与变动必须区分。先按原表列名和单位逐字保留：列名为“同比增减（%）”且单位为%的，写同比变动百分比，不能直接改称百分点；列名明确为百分点的，才称百分点。若要报告毛利率水平之差，只能用同一指标、可比期间的两个毛利率代码计算，并列出两个操作数及减法公式，结果标为百分点。不得把相对百分比变化和百分点差额混称。若来源行有年度比较列，保留其数值和符号，不自行重算或省略单位。来源报道如把排名、竞争信息与收购比例写在同一段，而其收购比例与官方年报不一致，必须以官方法定披露为主口径，明确标注次级来源冲突及来源；不能将媒体比例静默写成公司事实。表格数值须连同适用表头/期间行引用，不能拿LED等其他产品的毛利变化代替电子电路产品。', terms: ['行业', '市场', '需求', '规模', '政策', '产业', '销量', 'market', 'industry'] },
  competitive_market_map: { questions: '按产品和客户采购场景界定市场，比较有正文证据支持的实际竞争者、替代路线或候选对手，列产品、客户、成本/技术、渠道、定位与可比限制。若公司跨多个细分市场而资料只支持一个具名竞争者或替代路线，可以完成该细分市场的有边界比较，但必须给出公司与对手的具体产品/路线差异及至少一个有证据维度，并把其他细分市场逐项标为缺少的具名对手或同口径输入及其影响；不得把单一细分比较外推为全公司竞争结论。若没有任何有证据的公司/产品/路线比较，必须标记insufficient_evidence。不同市场分别比较；不得把无口径销量当市场份额。解释优势持续条件及最强反证。', terms: ['竞争', '市场', '份额', '优势', '客户', '成本', '同行', '对手', '厂商', '格局', 'PCB', 'FPC', '光模块', '汽车', '电池', '毛利', '销量', '营收', '产能', '产品', 'competitor', 'competition'] },
  management_governance_analysis: { questions: '介绍关键管理人员职责、背景和任职变动、股权控制、治理安排及激励；若本次 evidence excerpts 含有董事或高级管理人员变动表，逐名报告需要分析的当期新增任职，并为姓名、职务、任免类型和日期逐项引用该人员对应的数据行；不能用“报告期持股情况没有发生变动”等相邻治理段落支持任职事实。若已供给前十大股东表或控制人持股数字，必须引用表头、具名持有人和持股比例行并分析集中度，不能只写控制人身份后称比例缺失。股东集中度可用具名股东与各自披露比例说明，不要自行合计多个股东比例，除非输入计算中明确提供该合计。员工持股计划年份必须引用含完整计划名称和年份的标题行；人数、股数和比例引用其数据行；同一finding同时提及年份和数字时，两类行都要引用。若年报有董事/高级管理人员背景履历行，应总结可支持的人员信息；仅有概括性标题时才可指出详细程度受限。若已披露主要管理人员姓名、头衔、职责或履历，不得笼统称“管理层完整分工/职责缺失”；缺口必须限定到证据确实未披露的具体人员或事项，例如新任高管的个人履历、具体职责分工或任职后的绩效，不得由此扩大为全部管理层职责不可知。评估战略一致性、利益冲突和承诺兑现。不能仅以头衔或宣传推断管理能力。', terms: ['董事', '管理', '治理', '股东', '实际控制', '薪酬', '激励', 'management', 'governance'] },
  capital_allocation_review: { questions: '分析研发、资本开支、并购、融资、分红和回购的目的、规模、资金来源与后续结果。同一数字位置必须使用其证据包中对应的sourceCandidateId；同一段落号在不同年度报告或不同来源之间不可互换，缺少定位时删除该论点而非猜测。简化自由现金流为负时，按“−人民币73.68亿元”或“负73.68亿元”格式表达；不得写“人民币-73.68亿元”，也不要在已给显示值外重复输出原始元值，除非该原始数值和计算均能由同一引用链复核。区分投资宣布和实现回报；只有可归因收益与资本基数才谈价值创造。解释现金需求与资本配置风险。报告年度研发投入率时，分别引用对应年度数值及表头。若年报另列“变动比例”及其数值，必须按原表列名和显示单位照录为披露事实（例如变动比例0.12%）；不得改称百分点，也不得把原始变动单元格和自算百分点差混为同一数值。若“变动原因”栏标记为“不适用”，准确说明原表将原因说明标为不适用、未给出具体解释；不要表述为报告遗漏了本应披露的原因。两个年度研发投入率水平之差只有在preparedAnalysis.financial.ratioChanges或annualRatioChanges明确提供对应指标、期间、两个操作数和百分点结果时才可报告；列出本期值、上期值和代码给出的公式。若没有对应代码结果，只列年度比例和原表变动值，禁止手工相减、心算或把原表单元改称百分点。研发金额、研发占收入比和研发资本化率在不同数据行时，每项金额或比率都须引用其各自数据行，不能以表头或相邻指标行代替金额行。在资本配置台账和任何摘要表中，每个金额、比率、期间都必须在该行或对应单元格紧邻引用其自身数据行；金额行引用金额数据行，比率行引用比率数据行，并分别引用适用表头/单位。不能只在表格后段引用、借用相邻段落、其他章节或方法结论替代逐行引用。多标的并购成本表中，必须按表头、每个数据行和各标的合计逐项绑定，不得把单一债务/现金金额复制到另一标的名下；若PDF文本抽取压掉空白单元格、金额行的列位置不清，必须同时核对对应标的合计与来源披露的合并成本确定方法，只有交叉核对支持唯一归属时才可归属该金额，否则明确列为列位未能核实并从标的台账中省略。数字行、表头、合计行和合并成本确定方法均须各自引用实际段落。年度报告“研发投入金额”与利润表/结构化财务摘要“研发费用”是不同披露指标、会计范围和期间口径；若同时讨论，须分别标明来源指标名称、期间和单位，并明确它们不可直接比较或推导研发费用增减趋势。只有同一指标且同为年度或同为可比累计期间的数据才可计算变化；不得把年度研发投入与半年度研发费用并列成趋势或混作同一科目。简化自由现金流差额只可引用preparedAnalysis.financial.simpleFreeCashFlow中对应期间的代码计算与公式；缺少该期结果时只披露现金流和资本开支事实，不自行相减。其他资本开支强度、现金覆盖等派生比率若preparedAnalysis未提供，禁止自行生成；如结果有可用的代码计算，必须列出分子、分母、单位、期间和公式并转换为可读百分数，不得输出裸小数。', terms: ['研发', '投资', '收购', '融资', '分红', '回购', '资本', 'capital', 'acquisition'] },
  company_risk_analysis: { questions: '形成公司特定的风险矩阵，覆盖经营、客户、技术、竞争、财务、治理和政策。每项说明触发条件→影响路径→可监控指标→缓解因素及残余风险；优先公司证据，避免泛泛宏观清单。简化自由现金流为负时，结果使用中文“负XX.XX亿元”格式表述，公式用相同负数格式写为“373.35亿元−447.03亿元＝负XX.XX亿元”；结果前不得紧接“累计-”等连字符，避免负号与期间标记混淆。若本次提供前五大客户合计比例和客户明细，风险项必须列出前五大合计、最大客户及第二大单一客户各自的来源披露比例，并比较最大客户与第二大客户；若报告列出最大客户比例高于第二大客户，解释最大客户采购缩减可能对收入/产能的影响，但静态销售占比不等于实际损失；匿名或业务映射未知要单列为身份/归因限制，不能称已披露比例无法核验。不得对其他客户比例求和、做心算差值或只称“集中度有限”“无单一客户主导”等未定义判断；只有preparedAnalysis明确给出代码计算结果时才可报告派生值并列公式。商誉原值、减值准备等多个金额逐项报告时，每个金额都须紧邻重复币种及单位并引用对应数据行，不能把单位只放在一组数字末尾。库存/应收余额增速与收入累计增速背离若同时报告，每个代码计算的差值后都紧邻重复写“个百分点”，不可只在最后一个数字后共享单位；写明余额与期间流量口径的差异及其筛查属性。年报若已披露实际控制人兼任董事长/总裁、内控体系或关联交易决策制度，风险矩阵必须报告该治理安排；明确这是公司披露，不代表独立验证其执行。残余风险应限定为制衡、具体审议/回避执行、继任等尚无直接证据的事项，禁止称“未提供治理结构或内控意见”。半年报资产负债表比较列若为“上年末”，相关余额只能称“较上年末”，不得称“上年同期”或同比。必须检查本次提供的商誉原值、减值准备、资产组/资产组组合表及关键假设，报告有具名对象或账面金额时纳入风险分析，不得把其他方法或同一报告已供给的年报附注称为缺失。并购会计必须逐一匹配被购买方列标题、单位行、购买日和符号：正向“商誉”金额是商誉资产，负数“合并成本小于可辨认净资产公允价值份额”表示廉价购买收益，不能把两个标的或符号混称。解释减值通过资产价值、利润和现金流假设的传导，区分账面金额与减值损失。综合支持研究结论及其失效条件。会计处理仅在本次已提供的证据片段包含对应会计政策或标的表格时说明；每个 sourceCandidateId 与 paragraph 定位必须来自同一条已提供证据，不得根据整份报告或记忆猜编号。缺少对应片段时，限制必须限定为未提供的表/列或无法计算的影响金额。', terms: ['风险', '客户', '竞争', '政策', '负债', '汇率', '诉讼', '商誉', '减值', '资产组', '并购', '收购', 'risk', '实际控制人', '董事长', '总裁', '治理', '内部控制', '关联交易'] },
}

function productCustomerNeedEvidenceIssue(result: Pick<ReturnType<typeof validateCompanyMethodOutput>, 'answer' | 'markdown' | 'sections' | 'findings'>, packets: readonly CompanyEvidencePacket[]): string | undefined {
  // Company-reported customer demand growth is an operating fact, not a claim
  // about consumer preference. Gate preference/attention/choice claims and
  // explicit consumer needs; do not mistake every B2B demand reference for one.
  const customerNeed = /(?:客户|用户|消费者|购车者)[^。；;，,|\n]{0,24}?(?:关注|需要|偏好|重视|看重|倾向|选择)(?!(?:调研|调查|研究|问卷|访谈|反馈|购买行为|偏好数据|证据|数据|理由|依据|原因|验证|缺失|不足|缺口|和|及|与|、|(?:(?:也|亦)?(?:未获|未被|未能|尚未|不能|无法|未有))|有限|仍))[^。；;，,|\n]{1,16}|消费者[^。；;，,|\n]{0,16}需求(?!(?:调研|调查|研究|问卷|访谈|反馈|购买行为|证据|数据|理由|依据|原因|验证|缺失|不足|缺口|和|及|与|、|(?:(?:也|亦)?(?:未获|未被|未能|尚未|不能|无法|未有))|有限|仍))[^。；;，,|\n]{1,16}|(?:竞争优势|护城河)(?:已|已经|已被)(?:验证|证实)|(?:已|已经|被)(?:验证|证实)的(?:竞争优势|护城河)|(?:竞品|相对竞品)(?:表现|性能)(?:已|已经|已被)(?:验证|证实)|(?:已|已经|被)(?:验证|证实)的(?:竞品|相对竞品)(?:表现|性能)|(?:相对)?(?:竞品|竞争对手)(?:相对)?(?:性能)?优势(?:已|已经|已被)(?:验证|证实)|(?:已|已经|被)(?:验证|证实)的(?:相对)?(?:竞品|竞争对手)(?:相对)?(?:性能)?优势/g
  // Only remove an explicitly scoped denial/evidence-gap clause before
  // re-running the positive-claim detector. This keeps the gate fail-closed:
  // a positive preference assertion elsewhere in the sentence remains.
  const researchTopic = /(?:(?:真实|实际)?(?:客户|用户|消费者|购车者))[^。；;，,|\n]{0,40}?(?:真实|实际)?(?:偏好|需求|关注|重视|看重|倾向|选择|需要)|(?:具名)?(?:竞品|竞争对手|对手|同业)(?:(?:具名|同口径|相对)?(?:技术|产品)?(?:性能|表现|优势|比较|对比|排名|胜负|领先|优劣))|具名对手(?:的)?同口径性能成本比较|(?:各)?技术对利润的可归因贡献|(?:产品)?相对(?:竞品)?(?:技术)?(?:性能|表现|优势)|相对竞争(?:表现|优势|胜负)|(?:独立)?市场(?:地位|定位)|(?:研发)?(?:投入|研发投入)(?:的)?(?:可归因)?回报|(?:竞争优势|护城河|(?:技术)?壁垒)(?:强度)?/g
  const denialMarker = /(?:也)?(?:没有|未有|缺少|缺乏|无)[^。；;，,|\n]{0,48}(?:客户|用户|消费者|购车者)[^。；;，,|\n]{0,12}(?:偏好|需求|关注|重视|看重|倾向|选择)[^。；;，,|\n]{0,16}(?:明确|充分|独立|相关|客户需求)?[^。；;，,|\n]{0,10}(?:调研|调查|研究|问卷|访谈|反馈|购买行为|证据|数据|验证)|(?:不是|并非)[^。；;，,|\n]{0,8}(?:客户|用户|消费者|购车者)[^。；;，,|\n]{0,8}(?:偏好|需求|关注)[^。；;，,|\n]{0,8}(?:事实|结论|证据)|(?:只能作为|仅能作为)[^。；;，,|\n]{0,16}(?:待验证|有待验证|未经验证)?[^。；;，,|\n]{0,12}(?:分析)?假设[^。；;，,|\n]{0,10}(?:而非|不是|并非)(?:客户|用户|消费者)?[^。；;，,|\n]{0,8}(?:事实|结论|证据)|(?:材料|资料|证据)[^。；;，,|\n]{0,12}不足以证明[^。；;，,|\n]{0,18}(?:实际|真实)?(?:客户|用户|消费者|购车者)[^。；;，,|\n]{0,8}(?:关注|偏好|需求)|(?:不能|不得|不可|不应|不宜)(?:直接)?升级为[^。；;，,|\n]{0,18}(?:独立)?(?:客户|用户|消费者|购车者)?偏好事实|(?:不能从[^。；;，,|\n]{0,32}?(?:推导|推出|得出|推断|证明|确认)|(?:不能|不足以)(?:直接)?(?:推导|推出|得出|推断|证明|确认)(?:为|成)?|不能据[^。；;，,|\n]{0,16}?(?:推断|推定|得出|推出|归因|认定|判断)|(?:不得|不能|不可|不应|不宜)(?:直接)?据[^。；;，,|\n]{0,32}?(?:推断|推定|得出|推出|归因|认定|判断)|(?:不得|不能|不可|不应|不宜)(?:直接)?(?:把|将)[^。；;，,|\n]{0,40}(?:写作|写成|表述为|列为|认定为|升级为|视为|推定为|当作|作为)|(?:不得|不能|不可|不应|不宜)(?:直接)?(?:把|将)?[^。；;，,|\n]{0,12}(?:写作|写成|表述为|列为|认定为|升级为|视为|推定为)[^。；;，,|\n]{0,12}(?:事实|偏好)|(?:不能|不得|不可|不应|不宜)(?:直接)?等同于|不足以(?:单独)?(?:证明|证实|确认|认定)|(?:因此|故|从而)?无法(?:独立)?(?:判断|确认|比较|对比|验证)|(?:(?:并|亦)?(?:不能|不得)(?:据此)?(?:直接)?(?:单独)?(?:归因|认定|确认|判断|证明|断言|替代|等同|代表|混为一谈|把|将|作为|当作|由|写成|改写成|表述为|升级为|称为|称作))|不(?:能)?(?:单独)?(?:证明|代表|说明|表明|作为|当作|称为|称作)|(?:不应|不可)(?:将)?(?:直接)?升级为|不宜(?:将)?(?:直接)?升级为|(?:不等于|不等同于|不是|并非|而非|(?:但|而)?非)|(?:尚|仍)?(?:未获|未被|未经|未能|尚未|未有|未见|未提供|未披露|未给出|缺少|缺乏|没有|未)|(?:证据|材料|资料)(?:均|仍)?不足以(?:独立)?(?:验证|证明|确认|判断|比较|对比)|(?:证据|材料|资料)(?:不足|有限|缺失|不充分|未披露|未提供)|(?:尚|仍)?(?:缺少|缺乏|缺|无|没有|不足|有限)|(?:仍|尚|有待)?(?:需要|需|待|要).{0,12}(?:证据|验证|调研|调查|反馈|比较|对比|判断|确认|证明|支持)|(?:仍|尚)?(?:须|需|应|宜)(?:谨慎|严格)?(?:判断|评估|看待|区分)|不能视为(?:已验证的)?(?:客户|用户|消费者)?偏好事实)/g
  const explicitPassivePreferenceDenial = /(?:不能|不得|不可|不应|不宜)(?:直接)?被(?:当作|视为|认定为)[^。；;，,|\n]{0,12}(?:独立)?(?:客户|用户|消费者|购车者)?(?:偏好|需求|关注)(?:事实|结论|证据)/g
  const forbiddenFactWording = /(?:不应|不宜|不可)将[^。；;，,|\n]{0,28}(?:写成|表述为|列为|作为)/g
  const evidenceTail = /(?:调研|调查|问卷|访谈|反馈|购买行为|购车意向|偏好数据|证据|实证|材料|资料|验证|确认|证明|支持|比较|对比|排名|判断|评估|看待|区分|混为一谈|评测|同口径|独立测试|客户与同业|推导|推出|推定|列为|写成|表述为|作为|事实|市场地位|有限|不足|缺失|不充分|待验证|假设|而非)/
  const unverifiedPreferenceHypothesis = /(?:均|都)?(?:属|是|为|应视为|视为|仅为|属于)(?:待验证|有待验证|未经验证)(?:的)?(?:分析)?假设/g
  const explicitPreferenceEvidenceGap = /(?:客户|用户|消费者|购车者)[^。；;，,|\n]{0,24}(?:偏好|需求|关注)[^。；;，,|\n]{0,12}(?:尚|仍)?缺(?:少|乏)?(?:充分|独立|相关|必要)?[^。；;，,|\n]{0,12}(?:独立)?(?:调研|调查|验证|证据|材料|反馈|支持)|(?:客户|用户|消费者|购车者)(?:真实|实际)?偏好[^。；;，,|\n]{0,24}(?:仍|尚)?(?:有|存在)证据边界/g
  const explicitNonInference = /(?:不据此|不能据此|不足以据此)(?:作出?|推断|判断|认定)[^。；;，,|\n]{0,20}(?:客户|用户|消费者|购车者)(?:实际)?(?:偏好|需求|关注)/g
  // Some concise limitations put the topic first and the evidence denial
  // afterward ("客户偏好亦未见调研或购买行为验证"). Remove only that
  // bounded denial clause; affirmative claims after it remain subject to the
  // normal customer-preference check.
  const postposedCustomerPreferenceGap = /(?:客户|用户|消费者|购车者)(?:实际)?(?:偏好|需求|关注)(?:(?:也|亦)?(?:尚|仍)?(?:未见|未有|未获|未能|没有|缺少|缺乏|无|不足|有限))[^。；;，,|\n]{0,8}(?:调研|调查|研究|问卷|访谈|反馈|购买行为|证据|验证)(?:(?:或|及|和)[^。；;，,|\n]{0,4}(?:调研|调查|研究|问卷|访谈|反馈|购买行为|证据|验证))*/g
  const explicitRejectedPreferenceInference = /(?:不能|不得|不可|不应|不宜)(?:据此|由此|据上述)?(?:直接)?(?:推断|推导|认定|判断|证明|确认)[^。；;，,|\n]{0,32}(?:已证实|实际|真实)?(?:客户|用户|消费者|购车者)[^。；;，,|\n]{0,12}(?:偏好|需求|关注)(?:因素|事实|结论)?/g
  const stripScopedResearchDenials = (claim: string): string => {
    const topics = [...claim.matchAll(researchTopic)].map(match => ({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length }))
    const markers = [...claim.matchAll(denialMarker), ...claim.matchAll(explicitPassivePreferenceDenial), ...claim.matchAll(unverifiedPreferenceHypothesis), ...claim.matchAll(explicitPreferenceEvidenceGap), ...claim.matchAll(postposedCustomerPreferenceGap), ...claim.matchAll(explicitRejectedPreferenceInference), ...claim.matchAll(explicitNonInference), ...claim.matchAll(forbiddenFactWording)].map(match => ({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length, text: match[0] }))
    const spans: Array<{ start: number; end: number }> = []
  const explicitPreferenceDenial = /(?:不能|不得|不可|不应|不宜)(?:直接)?(?:将)?[^。；;，,|\n]{0,48}(?:升级为|表述为|写成|视为|认定为|证明为)[^。；;，,|\n]{0,12}(?:独立)?(?:客户|用户|消费者|购车者)?(?:偏好|需求|关注)(?:事实|结论|证据)|(?:而非|并非|不是)(?:独立)?(?:客户|用户|消费者|购车者)?(?:偏好|需求|关注)(?:事实|结论|证据)|(?:不等于|不等同于)[^。；;，,|\n]{0,12}(?:实际|真实)?(?:客户|用户|消费者|购车者)?(?:偏好|需求|关注)(?:或[^。；;，,|\n]{0,24}(?:已实现)?市场份额)?|(?:不|不能|无法|不足以)(?:单独)?(?:证明|验证|确认|代表|说明|表明|推导|推出|意味着)[^。；;，,|\n]{0,40}(?:采购)?(?:客户|用户|消费者|购车者)?[^。；;，,|\n]{0,12}(?:真实|实际)?(?:偏好|需求|关注)(?:或[^。；;，,|\n]{0,12}(?:订单|购买|采购)[^。；;，,|\n]{0,8}(?:承诺|行为|选择))?|不构成[^。；;，,|\n]{0,32}(?:实际|真实)?(?:客户|用户|消费者|购车者)?(?:偏好|需求|关注)[^。；;，,|\n]{0,24}(?:独立)?(?:证明|验证|证据)|(?:资料|材料)[^。；;，,|\n]{0,16}(?:不足以|无法|不能)[^。；;，,|\n]{0,20}(?:验证|识别|判断|评估)[^。；;，,|\n]{0,40}(?:客户|用户|消费者|购车者)[^。；;，,|\n]{0,12}(?:偏好|需求|关注)|是否(?:为|属于)[^。；;，,|\n]{0,15}(?:实际)?(?:客户|用户|消费者|购车者)(?:实际)?(?:关注|偏好|需求)(?:点)?[^。；;，,|\n]{0,12}(?:(?:均|都)(?:属|是|为)|属|是|为|应视为|视为|仅为|属于)?(?:待验证|有待验证|未经验证)(?:的)?(?:分析)?假设|(?:资料|材料|证据)[^。；;，,|\n]{0,16}(?:不足以|无法|不能)(?:独立)?(?:验证|证明|确认|比较|对比|判断|评估)[^。；;，,|\n]{0,40}(?:具名)?(?:竞品|竞争对手|对手)[^。；;，,|\n]{0,16}(?:同口径|性能|成本|优劣|领先|比较|对比)|(?:不等于|不等同于|并非|不是|而非)[^。；;，,|\n]{0,8}(?:(?:已|已经|独立)?(?:验证|证实|成立|确认)(?:的)?)?(?:竞争优势|护城河|技术壁垒)|(?:竞争优势|护城河|技术壁垒)[^。；;，,|\n]{0,16}(?:不等于|不等同于|并非|不是|尚未|未被|没有被|不构成|不能称为|不能认定为)[^。；;，,|\n]{0,16}(?:已)?(?:验证|证实|成立|确认)?(?:的)?(?:竞争优势|护城河|技术壁垒)?/g
    for (const denial of claim.matchAll(explicitPreferenceDenial)) spans.push({ start: denial.index ?? 0, end: (denial.index ?? 0) + denial[0].length })
    // Explicit research limitations and attribution cautions are not positive
    // assertions about what customers prefer. Keep these narrowly scoped so
    // affirmative preference claims elsewhere still fail closed.
    const scopedCustomerPreferenceLimits = /(?:未提供|缺少|缺乏|没有|未见)[^。；;，,|\n]{0,20}(?:足以|可用于)?(?:确认|验证|证明|识别|评估)[^。；;，,|\n]{0,16}(?:实际|真实)?(?:客户|用户|消费者|购车者)[^。；;，,|\n]{0,10}(?:偏好|需求|关注)[^。；;，,|\n]{0,8}(?:的)?(?:调研|调查|研究|问卷|访谈|反馈|材料|证据)|(?:没有|未见|未披露|未提供)(?:公司)?明确披露的具体客户偏好(?:结论|事实|信息)|(?:公司宣称|公司宣传|产品规格|产品定位)[^。；;，,|\n]{0,16}(?:与|和)[^。；;，,|\n]{0,10}(?:实际|真实)?(?:客户|用户|消费者|购车者)?[^。；;，,|\n]{0,10}(?:偏好|需求|关注)[^。；;，,|\n]{0,8}(?:应|须|需要|必须)?(?:分别看待|严格区分|不能混为一谈)|(?:该)?(?:公司|产品)?定位[^。；;，,|\n]{0,18}(?:与|和)[^。；;，,|\n]{0,12}(?:客户|用户|消费者)[^。；;，,|\n]{0,20}(?:实测)?(?:需求|购买)?[^。；;，,|\n]{0,12}(?:偏好)?[^。；;，,|\n]{0,12}(?:是)?(?:不同|处于不同)(?:的)?证据层级|(?:公司陈述|公司宣称|产品用途|产品定位)[^。；;，,|\n]{0,24}(?:与|和)[^。；;，,|\n]{0,12}(?:实际|真实)?(?:客户|用户|消费者)?(?:偏好|需求|关注)[^。；;，,|\n]{0,12}(?:应|须|需要|必须)?(?:分别看待|严格区分|不能混为一谈)/g
    for (const denial of claim.matchAll(scopedCustomerPreferenceLimits)) spans.push({ start: denial.index ?? 0, end: (denial.index ?? 0) + denial[0].length })
    // Company-reported product scope, R&D progress, or claimed technical
    // effects may be explicitly distinguished from customer preferences and
    // independent validation. Remove only that bounded disclaimer clause;
    // any affirmative preference assertion elsewhere in the sentence remains.
    const companySelfDescriptionLimit = /(?:公司自述|公司宣传|产品规格|产品布局)[^。；;，,|\n]{0,80}(?:不等于|不能等同于|不能替代|并非|不是)[^。；;，,|\n]{0,20}(?:实际|真实)?(?:客户|用户|消费者|购车者)?[^。；;，,|\n]{0,10}(?:偏好|需求|关注)(?:或独立验证|及独立验证)?/g
    for (const denial of claim.matchAll(companySelfDescriptionLimit)) spans.push({ start: denial.index ?? 0, end: (denial.index ?? 0) + denial[0].length })
    const gapIsOnlyTopicList = (gap: string): boolean => {
      let residue = gap.replace(researchTopic, '').replace(/(?:只能|仅能)作为(?:待验证|有待验证|未经验证)?(?:分析)?假设|(?:待验证|有待验证|未经验证)?(?:分析)?假设|而非|不是|并非|(?:的)?(?:真实|实际)?(?:偏好|需求|关注|重视|看重|倾向|选择|需要|程度|点)|(?:长期|持久|真实|实际|独立|相对|同口径|量化|关键|现有|目前|大多|大部分|各产品|各项|各类|各|相关|具名|可比|竞品|技术|产品|产品优势|性能优势|优势|竞争地位|性能|研发|投入|验证|评测|成本|回报|强度|优劣|壁垒|均|客户|对手|同业|材料|证据|资料|利润|贡献|以及|并且|仍然|仍|尚|也|或|及|与|和|的|、|，|,|\s)/g, '')
      researchTopic.lastIndex = 0
      return residue.length === 0
    }
    for (const topic of topics) {
      const coveringDenial = markers.find(marker => marker.start <= topic.start && marker.end >= topic.end)
      if (coveringDenial) {
        spans.push({ start: coveringDenial.start, end: coveringDenial.end })
        continue
      }
      const before = markers.filter(marker => marker.end <= topic.start && topic.start - marker.end <= 64
        && /(?:推导|推出|得出|推断|推定|证明|确认|归因|认定|判断|断言|等同于|升级为|称为|称作|写成|写作|表述为|列为|视为|当作|作为|未提供|未披露|未给出|缺少|缺乏|未获|未被|尚未|未见|没有|并非|不是|而非|非)$/.test(marker.text)
        && gapIsOnlyTopicList(claim.slice(marker.end, topic.start))
        && !topics.some(previous => previous.start < topic.start && previous.end <= marker.start && marker.start - previous.end <= 80 && gapIsOnlyTopicList(claim.slice(previous.end, marker.start)))).at(-1)
      if (before) {
        spans.push({ start: before.start, end: topic.end })
      }
      const after = markers.find(marker => marker.start >= topic.end && marker.start - topic.end <= 80 && gapIsOnlyTopicList(claim.slice(topic.end, marker.start)))
      if (after && evidenceTail.test(after.text + claim.slice(after.end, Math.min(claim.length, after.end + 36)))) {
        const tail = claim.slice(after.start, Math.min(claim.length, after.end + 36))
        const tailEnd = tail.search(/[。；;|]|(?:但是|然而|不过|可是|但)/)
        const denialEnd = tailEnd >= 0 ? after.start + tailEnd : after.end + Math.min(36, Math.max(0, claim.length - after.end))
        const nextTopic = topics.find(candidate => candidate.start > topic.start)
        spans.push({ start: topic.start, end: Math.min(denialEnd, nextTopic?.start ?? Number.POSITIVE_INFINITY) })
      }
    }
    spans.sort((a, b) => a.start - b.start || b.end - a.end)
    let output = ''
    let cursor = 0
    for (const span of spans) {
      if (span.start < cursor) { cursor = Math.max(cursor, span.end); continue }
      output += claim.slice(cursor, span.start)
      cursor = span.end
    }
    return output + claim.slice(cursor)
  }
  const artifacts = [result.answer, result.markdown, ...result.sections.filter(section => section.id === 'products').map(section => section.markdown), ...result.findings.map(finding => `${finding.text} ${finding.evidence.map(ref => `[${ref.sourceCandidateId}@${ref.location}]`).join(' ')}`)]
  for (const artifact of artifacts) for (const line of artifact.split(/\r?\n/)) {
    for (const match of line.matchAll(customerNeed)) {
      const start = Math.max(line.lastIndexOf('。', match.index), line.lastIndexOf('；', match.index), line.lastIndexOf(';', match.index), line.lastIndexOf('|', match.index), line.lastIndexOf(',', match.index), line.lastIndexOf('，', match.index)) + 1
      const endCandidates = ['。', '；', ';', '|'].map(mark => line.indexOf(mark, (match.index ?? 0) + match[0].length)).filter(index => index >= 0)
      const claim = line.slice(start, endCandidates.length ? Math.min(...endCandidates) : undefined)
      customerNeed.lastIndex = 0
      if (!customerNeed.test(stripScopedResearchDenials(claim))) continue
      const refs = [...new Set([...claim.matchAll(/\[([^\]\s]+)@(paragraph:\d+)\]/g)].map(ref => `${ref[1]}@${ref[2]}`))]
      const citedText = refs.flatMap(ref => {
        const [sourceCandidateId, location] = ref.split('@')
        return packets.find(packet => packet.sourceCandidateId === sourceCandidateId)?.excerpts.filter(excerpt => excerpt.location === location).map(excerpt => excerpt.text) ?? []
      }).join('\n')
      const hasCustomerResearch = /调研|调查|问卷|访谈|客户反馈|用户反馈|消费者反馈|购买行为|购车意向|偏好数据/.test(citedText)
      const hasAttributedCompanyPosition = /(?:客户|用户|消费者|购车者)[^。；;，,|\n]{0,50}(?:关注|需求|需要|偏好|重视|看重|倾向|选择)/.test(citedText)
        && /(?:公司称|公司表示|公司披露|公司定位|公司将|年报称|年报披露|本公司称|本公司定位)/.test(claim)
      if (!hasCustomerResearch && !hasAttributedCompanyPosition) return `FORMAT: PRODUCT_CUSTOMER_NEEDS_UNVERIFIED: ${claim.slice(0, 240)}`
    }
  }
  return undefined
}

/**
 * Extract the text that actually carries a rejected citation. Prefer the
 * physical Markdown line (and preserve all table cells) over splitting only
 * on prose punctuation: citations commonly appear at the end of a dense table
 * row, where sentence splitting can otherwise leave a blank repair claim.
 */
function extractCitationBearingClaim(outputTexts: readonly string[], marker: string): string {
  const candidates: string[] = []
  for (const text of outputTexts) {
    for (const line of text.split(/\r?\n/)) {
      if (!line.includes(marker)) continue
      const withoutReferences = line.replace(/\[[^\]]*\]|【[^】]*】/g, ' ')
      const cleaned = withoutReferences
        .split(/(?<!\\)\|/)
        .map(cell => cell.replace(/^\s*[-*]\s*/, '').trim())
        .filter(Boolean)
        .join(' | ')
        .replace(/\s+/g, ' ')
        .trim()
      if (cleaned) candidates.push(cleaned)
    }
  }
  return candidates
    .sort((a, b) => referenceClaimInformationScore(b) - referenceClaimInformationScore(a) || b.length - a.length)
    .find(Boolean)
    ?.slice(-1200) ?? ''
}

function referenceClaimInformationScore(text: string): number {
  const chineseChars = text.match(/[\u3400-\u9fff]/g)?.length ?? 0
  const words = text.match(/[a-zA-Z]{3,}/g)?.length ?? 0
  return chineseChars + words * 2
}

function referenceClaimTerms(text: string): Set<string> {
  const terms = new Set<string>()
  const generic = new Set(['公司', '业务', '材料', '现有', '报告', '没有', '不能', '无法', '方面', '情况', '披露', '资料', '产品', '市场'])
  const chineseRun = text.match(/[\u3400-\u9fff]+/g) ?? []
  for (const run of chineseRun) for (let index = 0; index < run.length - 1; index++) {
    const term = run.slice(index, index + 2)
    if (!generic.has(term)) terms.add(term)
  }
  for (const term of text.toLowerCase().match(/[a-z]{3,}/g) ?? []) terms.add(term)
  return terms
}

/** Pure semantic adapter: no acquisition, persistence, or invocation of peer Skills. */
export async function executeCompanyResearchMethod(input: ExecuteCompanyResearchMethodInput): Promise<CompanyResearchMethodResult> {
  const baseMethodology = COMPANY_METHOD_METHODOLOGY[input.skillId]
  const methodology = input.skillId === 'management_governance_analysis'
    ? { ...baseMethodology, questions: `${baseMethodology.questions} 若证据包含实际控制人兼任、内部控制体系/审计或关联交易制度的原文，必须在治理分析中准确报告并引用；只可将制衡效果、审议与回避执行、整改及继任安排等未披露细节列为缺口，不能称治理基本资料未提供。所有股东持股比例、员工持股数字和管理人员增持数字必须在含数字的同一句句末紧邻引用；每位股东的数字须引用相应持有人名称行及对应比例数据行，PDF拆行时两行都要引用，段末汇总引文或其他Finding的引文不能替代本句引用。` }
    : input.skillId === 'financial_quality_analysis'
      ? { ...baseMethodology, questions: `${baseMethodology.questions} 不得使用不带期间的“盈利改善”“利润改善”或“毛利改善”总括不同指标；开篇需分别列明收入、营业利润、净利润、毛利率和经营现金流方向及各自期间。若利润指标变化方向不一，须并列差异，不得以净利润增长替代营业利润或现金转化趋势。` }
      : baseMethodology
  const eligibleIds = input.reportSourceCandidateIds ?? input.durableSourceCandidateIds ?? []
  const needsStructuredFinancialEvidence = ['business_model_map','business_driver_analysis','financial_quality_analysis','market_structure_analysis','capital_allocation_review','company_risk_analysis'].includes(input.skillId)
  const requiredFinancialId = `akshare-financial-${input.company.symbol}`
  const requiredSourceCandidateIds = [
    ...(needsStructuredFinancialEvidence && eligibleIds.includes(requiredFinancialId) ? [requiredFinancialId] : []),
    ...(input.skillId === 'competitive_market_map'
      ? input.sources.filter(source => eligibleIds.includes(source.candidate.candidateId) && source.candidate.metadata?.researchSubject === 'peer_company').map(source => source.candidate.candidateId)
      : []),
  ]
  const packets = selectCompanyEvidence(input.sources, eligibleIds, methodology.terms, { purpose: input.skillId, requiredSourceCandidateIds })
  const diagnostics: { code: string; message: string; attempt: number }[] = []
  const attemptOutputs: CompanyMethodAttemptTrace[] = []
  const citationRepairs: (CompanyCitationRepair & { attempt: number })[] = []
  let numericRepairIssues: { id: string; token: string; context: string }[] = []
  let referenceRepairEvidence: { invalidReference: { sourceCandidateId: string; location: string; reason: string }; claim: string; candidates: { sourceCandidateId: string; location: string; text: string }[] }[] = []
  let repairTargets: { id: string; fieldPath: string; textFieldPath?: string; evidenceFieldPath?: string; originalText?: string; candidateExcerpts?: readonly { token: string; sourceCandidateId: string; location: string; text: string; truncated: boolean; context?: readonly {location:string; text:string; truncated:boolean}[] }[]; tableRows?: readonly { rowIndex: number; header: string; originalRow: string; unsupportedTokens: readonly string[]; inlineReferences: readonly string[] }[]; citedEvidence?: readonly { sourceCandidateId: string; location: string; text?: string; truncated?: boolean }[]; issues: readonly { token: string; context: string }[] }[] = []
  // Raw period rows already travel as structuredFinancialData. Avoid sending that
  // same table twice, while keeping all observations and derived calculations.
  let semanticPreparedAnalysis = input.preparedAnalysis
  if (input.financialData?.length && input.preparedAnalysis && typeof input.preparedAnalysis === 'object' && !Array.isArray(input.preparedAnalysis)) {
    const prepared = input.preparedAnalysis as Record<string, unknown>
    if (prepared.financial && typeof prepared.financial === 'object' && !Array.isArray(prepared.financial)) {
      const financial = { ...prepared.financial as Record<string, unknown> }
      delete financial.table
      // The readable table contains these exact display values and source locator.
      if (typeof financial.financialReadableTable === 'string') delete financial.financialDisplayAmounts
      semanticPreparedAnalysis = { ...prepared, financial }
    }
  }
  const empty = (status: CompanyResearchMethodResult['status'], attempts: number): CompanyResearchMethodResult => ({ skillId: input.skillId, status, answer: '', markdown: '', sections: [], findings: [], limitations: [status === 'cancelled' ? '研究已取消。' : '该方法未获得经过验证的分析结果，不能宣称完成。'], risks: [], sourceCandidateIds: [], diagnostics, attempts, executionEvidence: packets, attemptOutputs, citationRepairs })
  if (input.signal?.aborted) return empty('cancelled', 0)
  if (!input.reasoningExecutor || !packets.length) { diagnostics.push({ code: !input.reasoningExecutor ? 'EXECUTOR_UNAVAILABLE' : 'INSUFFICIENT_EVIDENCE', message: !input.reasoningExecutor ? 'No reasoning executor configured' : 'No citation-eligible full-text evidence', attempt: 0 }); return empty('insufficient_evidence', 0) }
  const exampleRef = packets[0]!.excerpts[0]!
  const explicitCitationInventory = ['competitive_market_map', 'product_technology_analysis'].includes(input.skillId)
    ? [...new Set(packets.flatMap(packet => packet.excerpts.map(excerpt => `${packet.sourceCandidateId}@${excerpt.location}`)))].sort()
    : undefined
  const citationInventoryInstruction = explicitCitationInventory
    ? '本次输入的allowedCitationPairs是唯一可使用的来源-定位清单；每个引用必须逐字复制其中一项，不能凭记忆补充未列出的段落号，即使来源ID存在也不能推测该报告的其他段落。修复时只能使用repairReferenceEvidence.candidates或allowedCitationPairs中实际列出的完整配对；若没有直接支持主张的供给行，就删除该主张并说明证据缺口。'
    : ''
  const outputShapeInstruction = `仅返回一个完整JSON对象，顶层必须同时含status、answer、markdown、sections、findings、limitations、risks七个字段。sections仅含${JSON.stringify(COMPANY_METHOD_SECTION_IDS[input.skillId])}指定的各一项，每项只能是{id,markdown}，数组长度必须与指定ID数量完全一致，不得重复、漏项或新增章节。findings是与sections并列的顶层数组，其项为{text,kind,evidence}，绝不能混入sections。limitations和risks无内容也须返回[]。Markdown格式：每个标题（# 至 ######）必须独占一行，标题行后立即换行；正文、表格标题和表头必须从后续行开始，禁止把正文或表格单元格拼在标题同一行。表格表头与分隔行也各自独占一行。answer和markdown摘要只作定性概述，不出现年份、金额、数量、比例等数字；所有具体数字仅写在有逐项引用的sections或findings中。`
  const outputExample = { status: 'complete', answer: '<中文方法结论>', markdown: `<实质分析> [${exampleRef.sourceCandidateId}@${exampleRef.location}]`, sections: COMPANY_METHOD_SECTION_IDS[input.skillId].map((id) => ({ id, markdown: `<此节独立分析> [${exampleRef.sourceCandidateId}@${exampleRef.location}]` })), findings: [{ text: '<已由证据支持的具体论点>', kind: 'fact', evidence: [{ sourceCandidateId: exampleRef.sourceCandidateId, location: exampleRef.location }] }], limitations: ['<仅实际缺失的补充信息与影响；没有则空数组>'], risks: ['<仅证据支持的风险；没有则空数组>'] }
  for (let attempt = 1; attempt <= (input.maxAttempts ?? 2); attempt++) {
    if (input.signal?.aborted) return empty('cancelled', attempt - 1)
    try {
      const reasoningRequest: ReasoningRequest = {
        operation: 'company_research_method',
          instruction: `${outputShapeInstruction} ${citationInventoryInstruction} 执行单个原子研究方法 ${input.skillId}，不调用其他方法。只依据本次输入的正文和结构化数据，使用中文，区分事实、推断、假设和预测；逐项回答本方法问题：${methodology.questions}。每个 owned section 必须是可直接发布的实质分析，展开问题、证据、解释、比较、反证及限制；findings 精选6–12项关键论点，避免冗余。answer 与 markdown 仅作定性总结，不新增数字。任何金额、比例、数量和年份必须由其精确引用的原文行或 preparedAnalysis 确定性结果支持；sourceCandidateId 与 paragraph 必须作为同一证据配对原样复制，严禁猜测、拼接或借用另一份材料的段落号。每个引用要同时核对证据对象的文档标题、sourceCandidateId和paragraph；相似报告、重复段落号或相同数字均不能作为跨文档替换依据。正文不得以“paragraph:123”或“段落123”形式描述证据位置，位置只允许用合同规定的方括号引用。表格每一数据行都引用自身数据行，并为独立期间、单位或表头补上实际供给的对应定位；金额单位必须写在该表列标题或数值单元格中，不能依赖表外段落解释单位。跨行数字须分别引用。PDF表头可能拆为多个相邻段落，例如指标名、上年同期、增减列分别成行；提取百分点变化时须同时引用数据行和从指标名到变化列标签的完整表头片段，不能只引含“毛利率”的第一行或只含“增减”的最后一行。分行业或分产品标签若与数字拆行，同一finding必须引用标签行与匹配的数字续行，不能引用相邻业务行。历史报道的发表时间与其统计期间分开。代码派生的增速、百分点、现金流差或单位换算须使用 preparedAnalysis 给出的结果，并在所属章节列出原计算数、单位和公式，不得自行心算大数或混用累计/单季口径。若说明某数字不能转换或解释为另一单位，不要重复该数字并搭配被否定的错误单位，直接说明不可转换的口径和原因。无证据的市场份额、人员履历、预测、TAM及竞争比较不得编造；缺少关键证据时明确写出缺口和影响。竞争分析有具名竞品证据时须比较实际公司/产品/路线及可比维度；材料不足时具体说明缺少何种比较输入。风险分析必须输出公司特定的触发条件、影响路径、监控指标、缓解因素和残余风险。不得把相邻行、章节摘要或模型记忆当作证据。`,
        input: {
          company: input.company, asOf: input.asOf, outputExample, canonicalMethodology: input.methodology ?? null,
          ownedSectionIds: COMPANY_METHOD_SECTION_IDS[input.skillId], evidence: packets,
          ...(explicitCitationInventory ? { allowedCitationPairs: explicitCitationInventory } : {}),
          structuredProfileData: input.profileData ?? null,
          structuredFinancialData: input.financialData ? [...input.financialData].sort((a,b) => (b.periodEnd ?? '').localeCompare(a.periodEnd ?? '')).slice(0,12) : null,
          preparedAnalysis: semanticPreparedAnalysis ?? null,
          ...(diagnostics.length ? {
            repairErrors: diagnostics.slice(-1), repairNumericIssues: numericRepairIssues, repairTargets,
            repairEvidenceGuide: packets.map((packet,index) => ({ sourceCandidateId: packet.sourceCandidateId, title: packet.title, suppliedExcerptsPath: `evidence[${index}].excerpts` })),
            ...(attemptOutputs.at(-1)?.output !== undefined ? { repairPreviousOutput: attemptOutputs.at(-1)!.output } : {}),
            ...(attemptOutputs.at(-1)?.rejectedRawOutput !== undefined ? { repairRejectedRawOutput: attemptOutputs.at(-1)!.rejectedRawOutput } : {}),
            repairInstruction: 'repairRejectedRawOutput若存在，是未通过Pi JSON解析或Schema校验的原始草稿，仅作为格式修复材料，自身不证明任何事实或引用；必须重新构造完整合同，逐项补齐ownedSectionIds中缺失章节，每个ID恰好一次且各有完整正文与精确引用。若提供repairPreviousOutput，以该输出为底稿，逐字保留未报错的sections、findings及其他字段，只修复已报错字段；不得新增主张，不要整篇重生成。repairTargets的candidateExcerpts仅为实际已供给正文中的候选行，不是自动引用或口径正确的证明；候选可能是另一年份或另一科目，不能因数字相同就采用。tableRows定位实际失败表行，逐个核对每个数值单元格的科目、期间和单位，在该行写入真正支持的精确引用。REFERENCE错误涉及未供给定位时，严禁复用该定位；若本次evidence没有同一事实的完整文本定位，删除该主张并在limitations说明缺口。金额单位必须置于表列标题或数值单元格，不能依赖表外文字。所有引用回到本次evidence逐行核验，不能复制附近文字的引用或猜测段落；找不到证据就删除该主张或明确限制。repairEvidenceGuide列出合法来源和摘录路径；不得借用其他科目或年份。'
          } : {})
        },
        outputContract: companyMethodOutputSchema(input.skillId, packets),
        metadata: { operationFamily: 'personal-research-v1', skillId: input.skillId, companySymbol: input.company.symbol }
      }
      const periodSpecificCashFlowInstruction = input.skillId === 'financial_quality_analysis' || input.skillId === 'company_risk_analysis'
        ? ' 使用 preparedAnalysis 中的自由现金流及其组成项时，必须在同一行或同一句写出精确期间（如2026年上半年累计）、金额单位和计算公式；财务表格的简化自由现金流行也必须在行标签或该行单元中重复“2026年上半年累计”，不得依赖同时写“累计/期末”的混合表头推定期间；缺少期间标签的本期/半年累计数字不满足证据口径。'
        : ''
      const workingCapitalCalculationInstruction = input.skillId === 'financial_quality_analysis'
        ? ' DSO、DIO、DPO与现金转换周期只能逐项照录preparedAnalysis.financial.workingCapitalCalculations中存在的结果，并在对应句或表中给出该对象提供的完整计算公式、操作数、单位、期间和天数；缺少某个计算对象时只保留其他有效指标，不得凭原始余额或记忆估算周转天数。'
        : ''
      const ratioDisplayPrecisionInstruction = input.skillId === 'financial_quality_analysis' || input.skillId === 'company_risk_analysis'
        ? ' 展示ratioChanges的比率水平和变化时保持精度一致：若两期比率四舍五入到两位小数，变化也写“约X.XX个百分点”；若照录精确变化值，则两期比率必须同时使用足够精度的确定性值，不能把两位小数操作数与四位小数变化混用。'
        : ''
      const financialMarginInstruction = input.skillId === 'financial_quality_analysis'
        ? ' 分行业毛利率变化finding统一使用“事实：半年报分行业表列示：<官方完整行业行名>毛利率X%，同比下降/上升Y%”的句式，严格沿用原表表头和数据单元的显示单位；不得将原文百分比改称百分点。只有两个可比毛利率水平经代码计算差额并列出公式和两个操作数时才使用百分点。“分行业表列示”等仅作报告引导语，完整官方行名必须紧接引导语且逐字保留，不能把“分行业”“披露”等词拼进业务行名。每一个数值finding各自显式引用其数据行；若一个finding同时写两个行业，必须同时引用两个完整行业标签及其数值行（例如分别补齐“日用电子器件制造业”数据行，以及拆开的“交通运输设备及电气制造业”标签行和数字续行），不得只引表头或在章节正文引过数据行后省略finding自己的引用。所有数字留在有精确引用的章节或finding中，顶层answer与markdown摘要只写定性结论，不重复数字。引用须显式包含单位行、从“营业收入/营业成本/毛利率”到毛利率同比增减列的全部拆分表头段、分行业标题，以及准确行业标签和数值行；不能只依赖excerpt的contextLocations代替finding自身的引用。'
        : ''
      const businessModelMarginInstruction = input.skillId === 'business_model_map'
        ? ' 年报分产品毛利率变化列若以百分号显示，必须原样写“同比变化为-1.82%”一类百分比，严禁改称“百分点”；年度变化与两个毛利率水平的百分点差不是同一指标。商业模式章节优先比较已披露的毛利率水平；若无法准确保留变化列单位，就省略变化值，不要转换单位。自由现金流、现金流与资本开支的数值分析属于财务质量/资本配置方法；本节不得复制 preparedAnalysis 的简化自由现金流金额或重新计算现金流差额。若要说明供应链或营运资金对现金的影响，只作有证据支持的机制解释，并引用实际周转/付款条款资料；缺少该资料时写具体缺口，不放置自由现金流数字。'
        : ''
      const businessModelEvidenceBindingInstruction = input.skillId === 'business_model_map'
        ? ' 商业模式数字的引用绑定：凡同一句出现收入金额、占比、毛利率、客户/供应商集中度或其他数字，必须在该句末紧邻引用直接包含该数字的对应数据行，并补齐适用的表头、单位和期间行。摘要行只支持摘要行实际披露的字段；单一客户/供应商金额必须引用其明细数据行，不能由前五名合计摘要行支持。客户与供应商字段必须各自引用对应客户表或供应商表的摘要行、明细表头、单位/期间和数值行；不得借用相邻营业成本构成、分产品收入/毛利表或其他业务表的表头、单位和期间作为客户/供应商数据的支持。某个数字后来在另一句、表格、摘要或finding中再次出现时，必须在每个出现处重新附上相应数据行引用；任何别处的引用都不能代替本句绑定。若来源没有提供可精确绑定的行，删去该数字并说明具体缺口，不得猜测或放宽数字核验。'
        : ''
      const productMarginInstruction = input.skillId === 'product_technology_analysis'
        ? ' 年报分产品毛利率的“同比变化”若原表以百分号显示，须按原列名报告为同比变化X%，不得改称X个百分点；百分点差只可在代码明确提供两个可比毛利率水平及确定性差额时报告并列出公式。若产品/分部表在行尾出现3.86%等原表同比变动值，不要把它转换成百分点；引用或转换口径无法确认时省略该变化数值。'
        : ''
      const productTechnologyNumericInstruction = input.skillId === 'product_technology_analysis'
        ? ' 产品矩阵中的每个收入、成本及毛利率数字必须在该行附近直接引用包含相同完整产品标签和数值的原表行，并引用单位及期间表头。跨年比较时，同一产品的本期和前期数字分别引用各自报告中的精确数据行；若年报已直接披露同比率，优先照录披露值，不得用同比率反推并呈现未直接披露的前期金额。产品分类或名称不完全一致时标明不可比，不得把分类不同的产品拼作同一趋势。'
        : ''
      const businessDriverMarginInstruction = input.skillId === 'business_driver_analysis'
        ? ' 多个分行业/分产品毛利率变动不得合写成“分别为X和Y”或让第二个标签省略指标名；每个官方完整行名必须单独写清“毛利率比上年同期增减为X%”并在该finding自身引用对应完整标签行和数值行。沿用原表变化列的百分号，不改为百分点；两个行业值应拆成独立finding，避免把一行引用用于另一行数字。'
        : ''
      const marketStructureMarginInstruction = input.skillId === 'market_structure_analysis'
        ? ' 市场结构分析引用定期报告中的分行业或分产品毛利率时，必须把行业与产品作为不同分类分别表述；每个finding逐项绑定其完整分类标签、匹配的数值行、单位和从营业收入/营业成本/毛利率指标至同比增减列的完整表头。PDF拆开的标签与数值续行必须分别引用，不能仅引表头或“分行业/分产品”标题，也不能拿同值的另一分类行替代。引用的报告期间必须与句中期间和来源标题一致；相同段落号不代表跨报告证据相同，禁止把不同报告的表头、分类标题和数据行拼成一条论据。若缺少本finding自身对应的精确行，删除该数值或写明证据缺口。'
        : ''
      const foreignCurrencyCitationInstruction = input.skillId === 'capital_allocation_review'
        ? ' 涉及外币融资金额时优先照录官方原始披露币种、数字和单位，不自行换算为另一显示单位，除非preparedAnalysis提供该项确定性转换。每个金额必须直接引用实际包含该金额的精确段落定位；严禁用“paragraph:8686—paragraph:8689”或任何起止段落范围代替逐条引用。若金额、交易标签、币种/单位分拆在相邻PDF段落，finding须分别列出每个实际段落的独立引用；不能只引交易段、段落范围或在finding与章节中互相借引。拆行并购金额（如ESOP对价）必须引用实际包含该金额与单位的续行。多标的并购成本表中，必须按表头、每个数据行和各标的合计逐项绑定，不得把单一债务/现金金额复制到另一标的名下；若PDF文本抽取压掉空白单元格、金额行的列位置不清，必须同时核对对应标的合计与来源披露的合并成本确定方法，只有交叉核对支持唯一归属时才可归属该金额，否则明确列为列位未能核实并从标的台账中省略。数字行、表头、合计行和合并成本确定方法均须各自引用实际段落。年度报告将“减少基本每股收益和稀释每股收益X元/股”拆在相邻PDF段落时，必须分别引用指标与方向行及金额续行；可将该人民币披露写为“人民币X元/股”，但不能省略或改变数字。不同报告若以不同币种报告同一或相似配售，不要拼成一个合并finding，也不要默认它们是同一净额口径；优先保留可核对的官方定期报告原币披露及其准确定位。'
        : ''
      const capitalAllocationNumericRetry = input.skillId === 'capital_allocation_review' && diagnostics.at(-1)?.code === 'NUMERIC_GROUNDING_ERROR'
        ? '资本配置数值定向修复：逐条读取repairNumericIssues、tableRows和evidence候选中的金额/指标行；不得使用paragraph起止范围或长破折号表示定位。每个金额或每股影响值都必须直接引用含该数值的精确段落，指标/方向与数值拆在连续PDF段落时须逐段引用；持股/增发股数段不能代替每股净资产影响的实际金额行，净资产影响行也不能代替每股收益金额续行。简化自由现金流等确定性计算只能按preparedAnalysis中同期间、同单位的financial.simpleFreeCashFlow字段原样报告；若写出计算，必须完整列出字段的两个操作数、运算符、结果和单位，等式结果须与displayValue一致，并引用该行sourceCandidateIds对应的实际供给来源。不得把模型心算或结构化原始金额换算冒充preparedAnalysis字段；字段未提供或口径不匹配时删除计算结果并写明缺口。多标的并购成本表中，按表头、金额行和各标的合计逐项绑定，禁止把同一单项金额复制到多个标的；如PDF文本抽取未保留空白单元格而列位置不清，必须引用并核对来源披露的标的合计及合并成本确定方法，交叉核对不能唯一确认归属时删除该金额并写明列位缺口。findings须为每项自身带齐同一组逐段引用，不能依赖章节正文引用。只保留可由本次evidence和表头/续行共同核实的数字；核实失败则从章节与findings同时删去该数字，并将缺口及影响放入limitations，不得改币种、单位或期间。'
        : ''
      const businessModelNumericRetry = input.skillId === 'business_model_map' && diagnostics.at(-1)?.code === 'NUMERIC_GROUNDING_ERROR'
        ? '商业模式数值定向修复：逐项读取repairNumericIssues及candidateExcerpts，核对来源标题、表头、单位、期间和数值行。每个错误数字所在句必须直接引用包含该数字的对应行；毛利率须引用本产品毛利率行，单一客户/供应商金额或占比须引用其明细行，不能用摘要合计行、其他产品行或别处的引用代替。若数字在另一句、表格、摘要或finding中重复出现，该处也必须重新引用对应行。保留已核实分析；找不到精确行的数字应删除并说明缺口，不得推算或新增未经核验数字。'
        : ''
      const productTechnologyNumericRetry = input.skillId === 'product_technology_analysis' && diagnostics.at(-1)?.code === 'NUMERIC_GROUNDING_ERROR'
        ? '产品与技术数值定向修复：逐条读取repairNumericIssues及tableRows，定位同一产品、同一期间和同一单位的原表数值行。每个跨年金额和毛利率分别引用其对应年度报告的精确行及单位/期间表头；不能以年报标题、分产品表头或相邻产品行代替数值行。不得以当前收入和同比增速反推并保留未直接披露的前期金额；若前期原表行确实存在，则引用该原行，若本次evidence未提供则删除前期金额并仅保留来源直接披露的同比百分比。分产品毛利率同比变化照录百分号，不转为百分点。修复数值时逐字保留其他有效段落与两个ownedSectionIds章节。'
        : ''
      const financialPeriodColumnNumericRetry = input.skillId === 'financial_quality_analysis'
        && diagnostics.at(-1)?.code === 'NUMERIC_GROUNDING_ERROR'
        && numericRepairIssues.some(issue => /(?:本报告期末|上年末|较.{0,8}上年末|期末余额)/.test(issue.context))
        && packets.some(packet => {
          const hasBalancePeriodHeader = packet.excerpts.some(excerpt => /(?:本报告期末|本期末)[^\n]{0,30}上年末|上年末[^\n]{0,30}(?:本报告期末|本期末)/.test(excerpt.text))
          const hasDeclaredCurrencyUnit = packet.excerpts.some(excerpt => /^\s*单位\s*[:：]\s*(?:人民币\s*)?(?:元|万元|亿元)\s*$/.test(excerpt.text))
          return hasBalancePeriodHeader && hasDeclaredCurrencyUnit
        })
        ? '财务原表期末/上年末列定向修复：对repairNumericIssues中涉及“本报告期末”“本期末”或“上年末”的金额，逐项回到同一份原始报表，核对数据行、单位行及期间列头。必须把本期末余额与上年末余额作为两个不同期间的余额分别表述；上年末列的余额不能改写成“较上年末增加/减少”的差额。人民币换算必须按1亿元=100,000,000元、1万元=10,000元逐项重算；例如37,004,685,000元=370.05亿元，不能写37.00亿元，禁止按英语billion和中文“亿”字面直译。只有preparedAnalysis明确提供同一科目、同口径的确定性余额差时，才可报告差额；否则删除未提供的差额数字，并可按原文行和单位正确列示两个期末余额。只修改repairTargets所指向的错误句及其重复finding，保留其他已通过校验的分析、表格和引用，不要重写整节或新增数值。'
        : ''
      let requestForDispatch: ReasoningRequest = { ...reasoningRequest, instruction: reasoningRequest.instruction + periodSpecificCashFlowInstruction + workingCapitalCalculationInstruction + ratioDisplayPrecisionInstruction + financialMarginInstruction + businessModelMarginInstruction + businessModelEvidenceBindingInstruction + productMarginInstruction + productTechnologyNumericInstruction + businessDriverMarginInstruction + marketStructureMarginInstruction + foreignCurrencyCitationInstruction }
      if (diagnostics.length || referenceRepairEvidence.length) {
        const requestInput = reasoningRequest.input && typeof reasoningRequest.input === 'object' && !Array.isArray(reasoningRequest.input) ? reasoningRequest.input as Record<string, unknown> : {}
        const repairInstruction = typeof requestInput.repairInstruction === 'string' ? requestInput.repairInstruction : ''
        const lastDiagnostic = diagnostics.at(-1)
        const schemaRepairChecklist = lastDiagnostic?.code === 'FORMAT_ERROR' && /JSON Schema|schema|must have required property|must NOT have|is required|missing/i.test(lastDiagnostic.message)
          ? `上次输出被结构化输出验证器拒绝。只按以下精确错误修复，不要重写研究内容：${lastDiagnostic.message.slice(0, 1800)}。JSON Schema必填字段缺失时补齐字段；limitations和risks没有内容时填[]。若错误路径指向findings[n]，仅修复该条finding的结构，原文有可核验引用才保留并按本Schema补齐kind及evidence；不得从草稿或记忆推造定位。无法在本轮evidence中核验时删除该finding。repairRejectedRawOutput（若提供）是待格式修复的原始草稿，不是事实或引用证据；优先保留未报错的有效研究内容。`
          : ''
        const riskTableFormatRepair = input.skillId === 'company_risk_analysis' && lastDiagnostic?.code === 'FORMAT_ERROR' && /malformed Markdown tables|TABLE_ERROR/.test(lastDiagnostic.message)
          ? `风险矩阵表格格式定向修复：上次风险章节仅因Markdown表格列数错误被拒绝，精确诊断为：${lastDiagnostic.message.slice(0, 500)}。风险矩阵必须使用五列“风险类别｜触发条件与影响路径｜可监控指标｜缓解因素｜残余风险”，每个数据行恰有五格。逐行按这五个语义列重新检查上一稿；若多出的格子是同一列的延续内容，将相邻文字及其引用用中文分号并入该语义列，不得丢弃事实、数字或引用，也不得创造新事实。只有无法无损归位时，才把该行改写为五个有明确列义的格子；不得把整张风险表删成空缺。只修复格式，保留其它已经核验的风险分析。`
          : ''
        const productDemandRepair = input.skillId === 'product_technology_analysis' && diagnostics.at(-1)?.message.includes('PRODUCT_CUSTOMER_NEEDS_UNVERIFIED')
          ? '产品客户需求修复：产品规格、配置、用途、公司定位或市场布局不能证明客户实际关注/偏好。除非被引用原文明确提供客户调研、问卷、访谈、反馈或购买行为证据，否则将“客户关注/需求/偏好”改写为“未有客户需求调研/反馈验证；这些仅是待验证的潜在购买因素；现有资料不足以证明实际客户关注”，保留有证据的产品规格和公司定位，不把该句列为事实finding。使用校验可识别的明确否定，例如“不足以证明”或“不能据此推断”，不要写成未被校验认可的推导句。明确将公司披露的B2B客户需求增长限定为公司经营口径，不得称为消费者偏好调查。本错误只要求修复客户需求句及对应finding；逐字保留两个ownedSectionIds章节及其中无关内容，输出必须仍完整包含products和technologies各一次，严禁因修一句话删掉technologies整节。status按repairPreviousOutput保留：如果原稿已为complete且products有证据支持的产品组合/应用/商业化阶段、technologies有证据支持的技术路线或阶段及其验证边界，且本轮校验只发现客户偏好等非核心缺口，则修复后仍为complete，将未验证事项列入limitations；只有本次材料确实无法支持产品组合与商业化分析，或无法支持任何技术路线/研发量产阶段分析时，才标为insufficient_evidence。不得把“客户偏好、独立竞品性能、产品级盈利归因未验证”单独作为核心缺失。'
          : ''
        const missingSectionMatch = diagnostics.at(-1)?.message.match(/missing=(\[[^\]]*\])/)
        const missingSectionIds = missingSectionMatch ? (() => { try { return JSON.parse(missingSectionMatch[1]!) as string[] } catch { return [] } })() : []
        const missingSectionRepair = diagnostics.at(-1)?.code === 'FORMAT_ERROR' && missingSectionIds.length
          ? `缺失章节定向修复：上一稿的章节合同错误仅为缺少 ${JSON.stringify(missingSectionIds)}。必须逐字保留上一稿中已存在且有效的章节及其论点、表格和引用，不得删节、改写或重新生成；只新增每个缺失owned section，各一次，且写成独立、可发布的实质分析，使用本次evidence中直接支持的精确引用。product_technology_analysis中，products专门分析产品组合、应用与商业化阶段；technologies专门分析已披露技术/产品架构、研发或量产阶段、技术路线、证据强度、验证缺口及替代风险，不要复制products整节，也不要把公司宣传升级为验证事实。材料不足时在该缺失章节具体说明缺失输入及影响，并引用可支持的已披露背景；不得编造。`
          : ''
        const riskNumericRetryPreservation = input.skillId === 'company_risk_analysis' && diagnostics.at(-1)?.message.startsWith('NUMERIC:')
          ? buildRiskNumericRetryPreservation(attemptOutputs.at(-1)?.output, packets)
          : ''
        const riskNumericSignRepair = input.skillId === 'company_risk_analysis' && diagnostics.at(-1)?.code === 'NUMERIC_GROUNDING_ERROR'
          ? '风险方法符号与变动方向修复：逐列查看商誉原值、商誉减值准备等表头。原文金额前的负号必须保留；仅当句子明确写“减少/下降/回落”时，才可把原文负值写成正数减少幅度。不得把负数减少额写成增加、正向变动或无方向金额；若无法确认列名、期间或实体，删除该金额并说明口径缺口，保留其他通过核验的风险判断。'
          : ''
        const riskGovernanceReferenceRepair = input.skillId === 'company_risk_analysis' && diagnostics.at(-1)?.code === 'REFERENCE_ERROR' && diagnostics.at(-1)?.message.includes('official-39e591fa149e4543@paragraph:1')
          ? '治理风险引用修复：paragraph:1不在本方法实际供给的证据片段中，必须从整份输出、sections及findings删除该引用。当前evidence没有提供实际控制人兼任董事长/总裁、董事会制衡、关联交易回避或内控安排的原文定位；不得继续声称年报披露了这些具体安排。将该行改为明确研究缺口：本次风险证据未包含治理安排原文，无法验证制衡、回避执行、内控整改或继任风险；补采治理/内控原文。不要猜测或复用管理层方法的段落号，也不要把其他报告或相邻段落作为替代引用。'
          : ''
        const riskSourceBindingRepair = input.skillId === 'company_risk_analysis' && diagnostics.at(-1)?.code === 'REFERENCE_ERROR'
          ? '风险方法跨期引用修复：对REPAIR_TARGETS及candidateExcerpts逐项核对sourceCandidateId、evidence标题、报告期间、科目/资产组标签和原文定位。相同数字可能在多份年报/半年报中重复，绝不能把一份报告的sourceCandidateId与另一报告的paragraph拼接。若上一稿明确写“2025年年报”，折现率、预测期等参数必须引用标题属于该2025年年报且正文直接含该参数的同一行；半年报或更早年度即使数值相同也不能代替。只采用候选中标题、期间、对象与指标均匹配的完整来源-定位配对；没有完全匹配的候选就删除该数值主张并说明缺口，保留已核验的其他风险分析。'
          : ''
        const exactReferenceRepairInstruction = referenceRepairEvidence.length
          ? `引用修复定位：无效引用为${referenceRepairEvidence.map(item => `${item.invalidReference.sourceCandidateId}@${item.invalidReference.location}（${item.invalidReference.reason}）`).join('；')}。repairReferenceEvidence.candidates中的每一项都是一个不可拆分的sourceCandidateId+location+text证据配对；只能复制同一候选项的sourceCandidateId与location，严禁把一份报告的来源ID与另一份报告的相同段号拼接，也不得因段号相同而跨文档借引。先核验候选原文是否直接支持该句的主体、指标和期间；若没有完全匹配的候选，删除该句或数字并在limitations具体说明缺口，不要换用相邻段落或猜测新定位。`
          : ''
        const nextRepairInstruction = `${outputShapeInstruction} ${schemaRepairChecklist} ${riskTableFormatRepair} ${repairInstruction} ${productDemandRepair} ${missingSectionRepair} ${businessModelNumericRetry} ${productTechnologyNumericRetry} ${financialPeriodColumnNumericRetry} ${capitalAllocationNumericRetry} ${riskNumericRetryPreservation} ${riskNumericSignRepair} ${riskGovernanceReferenceRepair} ${riskSourceBindingRepair} ${exactReferenceRepairInstruction} repairNumericIssues列出本次已独立检测到的数值错误，可能与repairErrors中的引用/格式错误同时出现；同一次修复必须同时处理两类错误，并重新检查所有章节和findings。逐字保留未报错的sections、findings及其他字段，不得新增其他数字或主张；每个数值各写明完整单位；不能靠删掉整张表或专业分析回避错误。candidateExcerpts仅为候选，候选可能是另一年份或另一科目；核对每个数值单元格的科目、期间和计量单位。仅保留经实际evidence核对且能通过全部校验的内容；补齐ownedSectionIds中列出的每个缺失章节。findings中的引用、其他表行或表后散列引用不能代替本行。每个finding中的每一个年份、金额和比率，分别补齐支持各数字及同一科目、期间和口径的实际供给行；若PDF把业务标签拆行，必须同时引用标签行和该业务对应的数值行。修复交叉引用后重新扫描整份输出的所有sourceCandidateId+paragraph组合，不能只检查首个错误；文档标题与sourceCandidateId必须来自同一条evidence记录，段落号不能跨报告沿用。确定性计算数字只能照录preparedAnalysis的具体字段、数值和单位，若字段不直接提供则删去数字并说明缺口，不能换用相似量级或自行转换单位。`
        const nextInput = { ...requestInput, ...(referenceRepairEvidence.length ? { repairReferenceEvidence: referenceRepairEvidence } : {}), repairInstruction: nextRepairInstruction }
        requestForDispatch = { ...requestForDispatch, input: nextInput, ...((referenceRepairEvidence.length || schemaRepairChecklist || riskTableFormatRepair) ? { instruction: `${requestForDispatch.instruction} ${schemaRepairChecklist} ${riskTableFormatRepair} ${referenceRepairEvidence.length ? `${exactReferenceRepairInstruction} repairReferenceEvidence给出上次输出中无效引用所在原句及实际供给材料中的候选行；逐行核验后仅替换为候选中原样sourceCandidateId/location，均不匹配时删除该句，不得自行改段落号或在正文提及段落号。` : ''}` } : {}) }
      }
      // Capture the actual semantic request before dispatch, including failed calls.
      // The executor receives this same detached snapshot; later caller mutations cannot rewrite history.
      const requestSnapshot = structuredClone(requestForDispatch)
      const traceIndex = attemptOutputs.length
      attemptOutputs.push({ attempt, reasoningInput: requestSnapshot.input, reasoningInstruction: requestSnapshot.instruction, executionEvidence: packets, preparedAnalysis: semanticPreparedAnalysis })
      const response = await input.reasoningExecutor.execute(requestSnapshot, input.signal)
      attemptOutputs[traceIndex] = { ...attemptOutputs[traceIndex]!, output: response.output }
      if (input.signal?.aborted) return empty('cancelled', attempt)
      const currentInput = requestSnapshot.input && typeof requestSnapshot.input === 'object' && !Array.isArray(requestSnapshot.input) ? requestSnapshot.input as Record<string, unknown> : {}
      const previousOutput = attemptOutputs[traceIndex - 1]?.output
      const boundedNumericOutput = input.skillId === 'business_driver_analysis' && attempt > 1 && diagnostics.at(-1)?.code === 'NUMERIC_GROUNDING_ERROR' && Array.isArray(currentInput.repairNumericIssues) && currentInput.repairNumericIssues.length
        ? applyOnlyNumericRepairTargets(previousOutput, response.output, currentInput.repairTargets, new Set(packets.flatMap(packet => packet.excerpts.map(excerpt => `${packet.sourceCandidateId}@${excerpt.location}`))))
        : response.output
      const trailingSourceIdRepair = repairCompanyTrailingSourceIdTypo(boundedNumericOutput, packets, input)
      citationRepairs.push(...trailingSourceIdRepair.repairs.map((repair) => ({ ...repair, attempt })))
      const collisionCitationRepair = repairCompanyParagraphCollisionCitations(trailingSourceIdRepair.output, packets, input)
      citationRepairs.push(...collisionCitationRepair.repairs.map((repair) => ({ ...repair, attempt })))
      const preparedCitationRepair = repairPreparedAnalysisSourceReferences(collisionCitationRepair.output, packets, input)
      citationRepairs.push(...preparedCitationRepair.repairs.map((repair) => ({ ...repair, attempt })))
      const unavailableCitationRepair = repairUnavailableCompanyMethodCitations(preparedCitationRepair.output, packets, input)
      citationRepairs.push(...unavailableCitationRepair.repairs.map((repair) => ({ ...repair, attempt })))
      // Source-ID canonicalization can make an earlier citation in a table
      // cell usable only after the first collision pass. Recheck the cell so
      // later unsupported same-number locators can be removed against that
      // now-valid evidence, while retaining the same strict overlap rules.
      const postCanonicalCollisionRepair = repairCompanyParagraphCollisionCitations(unavailableCitationRepair.output, packets, input)
      citationRepairs.push(...postCanonicalCollisionRepair.repairs.map((repair) => ({ ...repair, attempt })))
      const unsupportedClaimCleanup = input.skillId === 'business_model_map'
        ? removeUnsupportedMethodCitationParagraphs(postCanonicalCollisionRepair.output, packets)
        : { output: postCanonicalCollisionRepair.output, removed: 0 }
      const allocationTableRepair = input.skillId === 'capital_allocation_review'
        ? repairExcessTrailingCellsInMethodOutput(unsupportedClaimCleanup.output)
        : unsupportedClaimCleanup.output
      const bounded = bindCompanyMethodEvidenceContext(validateCompanyMethodOutput(allocationTableRepair, packets, COMPANY_METHOD_SECTION_IDS[input.skillId]), packets)
      const repaired = repairCompanyMethodCitations(bounded, packets, input)
      citationRepairs.push(...repaired.repairs.map((repair) => ({ ...repair, attempt })))
      const yearBound = bindCompanyAnswerYearEvidence(repaired.output, input.sources, packets, input.preparedAnalysis, input.company.symbol, input.asOf)
      const parsed = input.skillId === 'business_driver_analysis'
        ? repairCompanySegmentFindingLabels(bindExactCompanyTableRows(yearBound, packets, input.sources), packets, input.sources)
        : input.skillId === 'market_structure_analysis'
          ? bindExactCompanyTableRows(yearBound, packets, input.sources, true)
        : yearBound
      if (input.skillId === 'capital_allocation_review') {
        const preserved = preserveExactDividendFindingReferences(parsed, packets)
        citationRepairs.push(...preserved.repairs.map((repair) => ({ ...repair, attempt })))
        Object.assign(parsed, preserved.output)
      }
      if (input.skillId === 'company_risk_analysis' && parsed.status === 'complete' && !parsed.risks.length) throw new Error('FORMAT: Complete company risk method requires risk transmission findings')
      if (input.skillId === 'product_technology_analysis') {
        const customerNeedIssue = productCustomerNeedEvidenceIssue(parsed, packets)
        if (customerNeedIssue) throw new Error(customerNeedIssue)
        const exactPageReferences = backfillExactOfficialProductPageNumericReferences(parsed, input, packets)
        citationRepairs.push(...exactPageReferences.repairs.map(repair => ({ ...repair, attempt })))
        Object.assign(parsed, exactPageReferences.output)
      }
      const attributableFindings = parsed.findings.map((finding, index) => ({ id: `finding-${index + 1}`, markdown: `${finding.text} ${finding.evidence.map((ref) => `[${ref.sourceCandidateId}@${ref.location}]`).join(' ')}` }))
      numericRepairIssues = []
      for (const item of [...parsed.sections, { id: 'method-summary', markdown: parsed.markdown }, { id: 'method-answer', markdown: parsed.answer }, ...attributableFindings]) {
        const numeric = validateCompanyNumericGrounding({ markdown: item.markdown, sources: input.sources, evidenceContexts: packets, preparedAnalysis: input.preparedAnalysis, trustedText: [input.company.symbol, input.asOf, ...companyCitedSplitDateText(item.markdown, packets), ...companyPreparedFinancialDateText(input.preparedAnalysis)] })
        for (const issue of numeric.diagnostics) if (numericRepairIssues.length < 12) numericRepairIssues.push({ id: item.id, token: issue.token.slice(0, 24), context: issue.context.replace(/\s+/g, ' ').slice(0, 32) })
      }
      let targetTextBudget = 8000
      let targetEvidenceBudget = 4000
      let candidateExcerptBudget = 6000
      let candidateExcerptCount = 0
      repairTargets = [...new Set(numericRepairIssues.map((issue) => issue.id))].map((id) => {
        const sectionIndex = parsed.sections.findIndex((section) => section.id === id)
        const findingIndex = /^finding-(\d+)$/.exec(id)
        const fieldPath = sectionIndex >= 0 ? `sections[${sectionIndex}].markdown` : findingIndex ? `findings[${Number(findingIndex[1]) - 1}]` : id === 'method-summary' ? 'markdown' : 'answer'
        const text = sectionIndex >= 0 ? parsed.sections[sectionIndex]!.markdown : findingIndex ? parsed.findings[Number(findingIndex[1]) - 1]!.text : id === 'method-summary' ? parsed.markdown : parsed.answer
        const originalText = text.length <= targetTextBudget ? text : undefined
        if (originalText !== undefined) targetTextBudget -= originalText.length
        const refs = findingIndex ? parsed.findings[Number(findingIndex[1]) - 1]!.evidence : [...text.matchAll(/\[([^\]\s]+)@(paragraph:\d+)\]/g)].map((match) => ({ sourceCandidateId: match[1]!, location: match[2]! }))
        const citedEvidence = [...new Map(refs.map((ref) => [`${ref.sourceCandidateId}@${ref.location}`, ref])).values()].slice(0, 12).map((ref) => {
          const excerpt = packets.find((packet) => packet.sourceCandidateId === ref.sourceCandidateId)?.excerpts.find((row) => row.location === ref.location)
          const length = Math.min(240, targetEvidenceBudget, excerpt?.text.length ?? 0)
          targetEvidenceBudget -= length
          return { ...ref, ...(length ? { text: excerpt!.text.slice(0, length), truncated: length < excerpt!.text.length } : {}) }
        })
        const lines = text.split(/\r?\n/)
        const issues = numericRepairIssues.filter(issue => issue.id === id)
        const referencedSources = new Set(refs.map(ref => ref.sourceCandidateId))
        const candidateExcerpts = [...new Set(issues.map(issue => issue.token))].flatMap(token => {
          // Discovery hints only: strip a display-unit suffix for lookup, but
          // keep the original token and require the model to cite the exact row.
          const searchToken = numericTokenForCandidateSearch(token)
          const escaped = searchToken.replaceAll('.', '\\.')
          const technicalIdentifier = text.includes(`${token}G`)
          const pattern = new RegExp(`(?<![\d.,-])${escaped}${technicalIdentifier ? 'G' : ''}(?![\d.,])`)
          const candidates = [...packets].sort((a,b)=>Number(referencedSources.has(b.sourceCandidateId))-Number(referencedSources.has(a.sourceCandidateId))).flatMap(packet => packet.excerpts.filter(excerpt => pattern.test(excerpt.text))).slice(0,3)
          return candidates.flatMap(excerpt => {
            if (candidateExcerptCount >= 24 || candidateExcerptBudget < 40) return []
            const match = pattern.exec(excerpt.text)!
            const start = Math.max(0, match.index - 90)
            const text = excerpt.text.slice(start, start + Math.min(240,candidateExcerptBudget))
            candidateExcerptBudget -= text.length
            candidateExcerptCount++
            const packet = packets.find(packet => packet.sourceCandidateId === excerpt.sourceCandidateId)!
            const paragraph = Number(/^paragraph:(\d+)$/.exec(excerpt.location)?.[1])
            const nearbyLabels = packet.excerpts.filter(row => {
              const rowNumber = Number(/^paragraph:(\d+)$/.exec(row.location)?.[1])
              return Math.abs(rowNumber - paragraph) <= 1 && row.location !== excerpt.location && row.text.length <= 180
            }).map(row => row.location)
            const contextLocations = [...new Set([...(excerpt.contextLocations ?? []), ...nearbyLabels])]
            const context = contextLocations.slice(0,3).flatMap(location => {
              const row = packet.excerpts.find(row => row.location === location)
              if (!row || candidateExcerptBudget < 20) return []
              const text = row.text.slice(0,Math.min(180,candidateExcerptBudget))
              candidateExcerptBudget -= text.length
              return [{location,text,truncated:text.length<row.text.length}]
            })
            return [{token,sourceCandidateId:excerpt.sourceCandidateId,location:excerpt.location,text,truncated:start>0 || text.length<excerpt.text.length,...(context.length?{context}:{})}]
          })
        })
        const tableRows = lines.flatMap((row, rowIndex) => {
          if (!/^\s*\|/.test(row)) return []
          const unsupportedTokens = [...new Set(issues.filter(issue => row.includes(issue.token)).map(issue => issue.token))]
          if (!unsupportedTokens.length) return []
          // Citation repair may append a supported narrative locator after a
          // Markdown row's closing pipe. Keep that prose out of the row-level
          // repair target so the next model attempt sees the actual table cell.
          const closingPipe = row.lastIndexOf('|')
          const originalRow = closingPipe > 0 ? row.slice(0, closingPipe + 1).trimEnd() : row
          let header = ''
          for (let index = rowIndex - 1; index > 0; index--) {
            if (/^\s*\|(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(lines[index]!)) { header = lines[index - 1]!.slice(0, 400); break }
            if (!lines[index]!.trim()) break
          }
          return [{rowIndex,header,originalRow:originalRow.slice(0,800),unsupportedTokens,inlineReferences:[...originalRow.matchAll(/\[([^\]\s]+)@([^\]\s]+)\]/g)].map(match=>match[0])}]
        }).slice(0,6)
        return { id, fieldPath, ...(findingIndex ? { textFieldPath: `${fieldPath}.text`, evidenceFieldPath: `${fieldPath}.evidence` } : {}), ...(originalText !== undefined ? { originalText } : {}), ...(tableRows.length ? { tableRows } : {}), ...(candidateExcerpts.length ? {candidateExcerpts} : {}), citedEvidence, issues: numericRepairIssues.filter((issue) => issue.id === id).map(({ token, context }) => ({ token, context })) }
      })
      if (numericRepairIssues.length) throw new Error(`NUMERIC: ${numericRepairIssues.map((issue) => `${issue.id}:${issue.token} (${issue.context.slice(0, 16)})`).join('; ')}`)
      const inlineSourceIds = [parsed.markdown, ...parsed.sections.map((section) => section.markdown)].flatMap((text) => [...text.matchAll(/\[([^\]\s]+)@[^\]\s]+\]/g)].map((match) => match[1]!))
      return { skillId: input.skillId, ...parsed, sourceCandidateIds: [...new Set([...parsed.findings.flatMap((finding) => finding.evidence.map((ref) => ref.sourceCandidateId)), ...inlineSourceIds])], diagnostics, attempts: attempt, executionEvidence: packets, attemptOutputs, citationRepairs }
    } catch (error) {
      if (input.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) { diagnostics.push({ code: 'CANCELLED', message: 'Semantic execution cancelled', attempt }); return empty('cancelled', attempt) }
      if (error instanceof ReasoningExecutorError && error.code === 'reasoning_output_invalid' && error.rawOutput !== undefined) {
        const previousTrace = attemptOutputs.at(-1)
        if (previousTrace?.attempt === attempt) attemptOutputs[attemptOutputs.length-1] = {...previousTrace,rejectedRawOutput:error.rawOutput}
      }
      const message = error instanceof Error ? error.message : String(error)
      if (message.startsWith('REFERENCE: Evidence location not supplied:') || message.startsWith('REFERENCE: Unknown markdown citation ')) {
        const previous = attemptOutputs.at(-1)?.output
        // Validate independent number claims even when reference validation
        // fails first. Otherwise a retry can spend its only repair call fixing
        // citations and discover a separate numeric issue only after budget
        // exhaustion. Invalid references remain unsupported; this merely
        // aggregates all actionable feedback for the bounded retry.
        numericRepairIssues = collectMethodNumericIssues(previous, input, packets)
        repairTargets = buildReferenceRetryNumericTargets(previous, numericRepairIssues, packets)
        const invalid = message.match(/(?:not supplied: |Unknown markdown citation )([^@\s]+)@(paragraph:\d+)/)
        if (previous && invalid) {
          const marker = `${invalid[1]}@${invalid[2]}`
          const previousObject = previous && typeof previous === 'object' && !Array.isArray(previous) ? previous as { markdown?: unknown; sections?: unknown; findings?: unknown } : undefined
          const outputTexts = typeof previous === 'string'
            ? [previous]
            : [previousObject?.markdown, ...(Array.isArray(previousObject?.sections) ? previousObject.sections.map((section: { markdown?: unknown }) => section.markdown) : []), ...(Array.isArray(previousObject?.findings) ? previousObject.findings.map((finding: { text?: unknown }) => finding.text) : [])].filter((text): text is string => typeof text === 'string')
          const clean = extractCitationBearingClaim(outputTexts, marker)
          const pairs = referenceClaimTerms(clean)
          const ranked = packets.flatMap(packet => packet.excerpts.map(excerpt => {
            const matchedTerms = [...pairs].filter(pair => excerpt.text.toLowerCase().includes(pair.toLowerCase()))
            // A shared paragraph number is not evidence of semantic support.
            // Require at least two non-generic claim terms before a supplied
            // source-location pair can be offered to the repair model.
            const score = matchedTerms.length * 10 + (excerpt.location === invalid[2] ? 1 : 0)
            return { sourceCandidateId: excerpt.sourceCandidateId, location: excerpt.location, text: excerpt.text.slice(0, 1000), score }
          })).filter(item => item.score >= 20).sort((a,b) => b.score-a.score || a.sourceCandidateId.localeCompare(b.sourceCandidateId)).slice(0,8)
          referenceRepairEvidence = [{ invalidReference: { sourceCandidateId: invalid[1]!, location: invalid[2]!, reason: `该定位未包含在本方法本轮实际供给的evidence摘录中；同段号的其他报告不能替代该来源定位。` }, claim: clean.slice(0, 1200), candidates: ranked.map(({sourceCandidateId,location,text}) => ({sourceCandidateId,location,text})) }]
        }
      }
      const failureClass = error instanceof ReasoningExecutorError ? error.failureClass : undefined
      const quota = failureClass === 'rate_limit_or_quota' || /usage limit|quota|rate limit|余额不足|额度/.test(message.toLowerCase())
      const auth = failureClass === 'authentication_or_account' || /unauthorized|authentication|invalid api key|sign.?in required/i.test(message)
      const safeFailure = summarizeReasoningFailure(error)
      diagnostics.push({ code: quota ? 'RATE_LIMIT_OR_QUOTA' : auth ? 'AUTHENTICATION_OR_ACCOUNT' : message.startsWith('NUMERIC:') ? 'NUMERIC_GROUNDING_ERROR' : message.startsWith('REFERENCE:') ? 'REFERENCE_ERROR' : message.startsWith('FORMAT:') || (error instanceof ReasoningExecutorError && error.code === 'reasoning_output_invalid') ? 'FORMAT_ERROR' : /timeout|timed out/i.test(message) ? 'TIMEOUT' : 'CALL_FAILED', ...safeFailure, attempt })
      if (quota || auth) return empty('failed', attempt)
    }
  }
  return empty('failed', diagnostics.length)
}

/**
 * A method answer is a short summary field and may omit inline references even
 * when one exact, independently grounded finding supports every year it
 * repeats. Reuse that finding's supplied locators only in this narrow case;
 * the normal numeric validator still checks the answer against those rows.
 */
function bindCompanyAnswerYearEvidence(
  result: ReturnType<typeof validateCompanyMethodOutput>,
  sources: readonly NormalizedResearchSource[],
  packets: readonly CompanyEvidencePacket[],
  preparedAnalysis: unknown,
  companySymbol: string,
  asOf: string,
): ReturnType<typeof validateCompanyMethodOutput> {
  const years = [...new Set(result.answer.match(/(?<!\d)(?:19|20)\d{2}(?!\d)/g) ?? [])]
  if (!years.length || /\d/.test(result.answer.replace(/(?<!\d)(?:19|20)\d{2}(?!\d)/g, ''))) return result
  const candidates = result.findings.filter((finding) => years.every((year) => finding.text.includes(year)))
  if (candidates.length !== 1) return result
  const finding = candidates[0]!
  const references = finding.evidence.map((ref) => `[${ref.sourceCandidateId}@${ref.location}]`).join(' ')
  const citedFinding = `${finding.text} ${references}`
  const numeric = validateCompanyNumericGrounding({
    markdown: citedFinding,
    sources,
    evidenceContexts: packets,
    preparedAnalysis,
    trustedText: [companySymbol, asOf, ...companyCitedSplitDateText(citedFinding, packets), ...companyPreparedFinancialDateText(preparedAnalysis)],
  })
  if (numeric.status !== 'grounded') return result
  return { ...result, answer: `${result.answer} ${references}` }
}

/**
 * Backfill one omitted citation on an already-cited company model row only
 * when a unique, exact metric excerpt from that same official model page is
 * supplied and the ordinary numeric grounding validator accepts the claim
 * after the locator is added. This is not general citation borrowing: the
 * table row must name the model, cite an excerpt that names that same model,
 * and already cite the source whose other exact excerpt carries the metric.
 */
function backfillExactOfficialProductPageNumericReferences(
  result: ReturnType<typeof validateCompanyMethodOutput>,
  input: ExecuteCompanyResearchMethodInput,
  packets: readonly CompanyEvidencePacket[],
): { output: ReturnType<typeof validateCompanyMethodOutput>; repairs: CompanyCitationRepair[] } {
  const repairs: CompanyCitationRepair[] = []
  const metricCues = [/综合续航/, /纯电续航|续航里程/, /亏电油耗|油耗/, /充电功率|直流快充/]
  const sourceById = new Map(input.sources.map(source => [source.candidate.candidateId, source]))
  const validateLine = (markdown: string) => validateCompanyNumericGrounding({
    markdown,
    sources: input.sources,
    evidenceContexts: packets,
    preparedAnalysis: input.preparedAnalysis,
    trustedText: [input.company.symbol, input.asOf, ...companyCitedSplitDateText(markdown, packets), ...companyPreparedFinancialDateText(input.preparedAnalysis)],
  })
  const exactNumber = (text: string, value: string) => {
    const escaped = value.replaceAll(',', '').replace('.', '\\.').replace('-', '[-−]?')
    return new RegExp(`(?<![\\d.,])${escaped}(?![\\d.,])`).test(text.replace(/[,，]/g, ''))
  }
  const backfillLine = (originalLine: string, sectionId: string): string => {
    if (!originalLine.includes('|') || !/^\s*\|/.test(originalLine)) return originalLine
    let line = originalLine
    const firstCell = line.split('|')[1]?.trim() ?? ''
    const modelToken = firstCell.match(/(?:[\u3400-\u9fff]{1,8}\s*)?\d{1,4}[A-Za-z0-9-]*/)?.[0]?.replace(/\s+/g, '')
    if (!modelToken) return line
    const initialIssues = validateLine(line).diagnostics
    for (const issue of initialIssues) {
      const citedIds = [...new Set([...line.matchAll(/\[([^\]\s]+)@paragraph:\d+\]/g)].map(match => match[1]!))]
      const metricCue = metricCues.find(cue => cue.test(line) && cue.test(issue.context))
        ?? metricCues.find(cue => cue.test(line))
      if (!metricCue) continue
      const matches = citedIds.flatMap(sourceCandidateId => {
        const source = sourceById.get(sourceCandidateId)
        const packet = packets.find(row => row.sourceCandidateId === sourceCandidateId)
        let pathname = ''
        try { pathname = new URL(source?.canonicalUrl ?? source?.candidate.url ?? '').pathname } catch { return [] }
        if (!source || source.candidate.kind !== 'web_article' || source.candidate.metadata?.officialCompanyHost !== true || !/(?:^|\/)(?:models?|products?|vehicles?|cars?)(?:\/|$)/i.test(pathname) || !packet) return []
        const citedModelAnchor = [...line.matchAll(/\[([^\]\s]+)@(paragraph:\d+)\]/g)]
          .filter(match => match[1] === sourceCandidateId)
          .map(match => packet.excerpts.find(excerpt => excerpt.location === match[2]))
          .filter((excerpt): excerpt is CompanyEvidencePacket['excerpts'][number] => Boolean(excerpt && excerpt.text.replace(/\s+/g, '').toLocaleLowerCase().includes(modelToken.toLocaleLowerCase())))
        if (!citedModelAnchor.length) return []
        const number = numericTokenForCandidateSearch(issue.token)
        const exact = packet.excerpts.filter(excerpt => exactNumber(excerpt.text, number) && metricCue.test(excerpt.text))
        return exact.map(excerpt => ({ sourceCandidateId, location: excerpt.location, text: excerpt.text }))
      })
      const unique = [...new Map(matches.map(match => [`${match.sourceCandidateId}@${match.location}`, match])).values()]
      if (unique.length !== 1) continue
      const candidate = unique[0]!
      const reference = `[${candidate.sourceCandidateId}@${candidate.location}]`
      const revised = `${line} ${reference}`
      const remainingTarget = validateLine(revised).diagnostics.some(after => numericTokenForCandidateSearch(after.token).replace(/[,，]/g, '') === numericTokenForCandidateSearch(issue.token).replace(/[,，]/g, ''))
      if (remainingTarget) continue
      repairs.push({
        sectionId,
        inputText: line,
        originalReferences: [...line.matchAll(/\[([^\]\s]+)@(paragraph:\d+)\]/g)].map(match => ({ sourceCandidateId: match[1]!, location: `paragraph:${match[2]}` })),
        addedReferences: [{ sourceCandidateId: candidate.sourceCandidateId, location: candidate.location }],
        reason: 'Added the unique exact metric locator from an already-cited official model page; same-model anchor, metric wording, and post-repair numeric grounding all matched.',
      })
      line = revised
    }
    return line
  }
  const sections = result.sections.map(section => ({ ...section, markdown: section.markdown.split(/\r?\n/).map(line => backfillLine(line, section.id)).join('\n') }))
  return repairs.length ? { output: { ...result, sections }, repairs } : { output: result, repairs }
}

/**
 * Preserve the exact supplied row citation when a capital-allocation finding
 * repeats the disclosed annual dividend but omits that row from its evidence.
 * This narrowly handles the report pattern where the section table already
 * cites the dividend row. Both the section row and the cited packet excerpts
 * must independently contain the exact amount and dividend wording.
 */
function preserveExactDividendFindingReferences(
  result: ReturnType<typeof validateCompanyMethodOutput>,
  packets: readonly CompanyEvidencePacket[],
): { output: ReturnType<typeof validateCompanyMethodOutput>; repairs: CompanyCitationRepair[] } {
  const referencesByAmount = new Map<string, CompanyMethodEvidenceRef[]>()
  for (const section of result.sections) {
    for (const line of section.markdown.split(/\r?\n/)) {
      const refs = [...line.matchAll(/\[([^\]\s]+)@(paragraph:\d+)\]/g)].map((match) => ({ sourceCandidateId: match[1]!, location: match[2]! }))
      if (!refs.length || !/2024\s*年度/.test(line) || !/现金红利|分红/.test(line)) continue
      for (const amount of line.matchAll(/(?<![\d.])(\d+(?:\.\d+)?)\s*元/g)) {
        const exactAmount = amount[1]!
        const supportedRefs = refs.filter((ref) => {
          const excerpt = packets.find((packet) => packet.sourceCandidateId === ref.sourceCandidateId)?.excerpts.find((row) => row.location === ref.location)
          return Boolean(excerpt
            && new RegExp(`(?<![\\d.])${exactAmount.replace('.', '\\.')}\\s*元`).test(excerpt.text)
            && /现金红利|分红/.test(excerpt.text))
        })
        if (supportedRefs.length) {
          // Keep all exact locators from the same source that the section
          // attached to this matching table row (for split label/value rows).
          const matchingSourceIds = new Set(supportedRefs.map((ref) => ref.sourceCandidateId))
          referencesByAmount.set(`${exactAmount}元`, refs.filter((ref) => matchingSourceIds.has(ref.sourceCandidateId)))
        }
      }
    }
  }
  const repairs: CompanyCitationRepair[] = []
  const findings = result.findings.map((finding, findingIndex) => {
    if (!/2024\s*年度/.test(finding.text) || !/现金红利|分红/.test(finding.text)) return finding
    const additions = [...finding.text.matchAll(/(?<![\d.])(\d+(?:\.\d+)?)\s*元/g)]
      .flatMap((match) => referencesByAmount.get(`${match[1]}元`) ?? [])
      .filter((ref) => !finding.evidence.some((existing) => existing.sourceCandidateId === ref.sourceCandidateId && existing.location === ref.location))
    if (!additions.length || finding.evidence.length + additions.length > 12) return finding
    repairs.push({
      findingIndex,
      inputText: finding.text,
      originalReferences: finding.evidence,
      addedReferences: additions,
      reason: 'Finding omitted its exact annual-dividend row citation; preserved only references from the same cited section row whose supplied excerpts contain the matching amount and dividend wording.',
    })
    return { ...finding, evidence: [...finding.evidence, ...additions] }
  })
  return repairs.length ? { output: { ...result, findings }, repairs } : { output: result, repairs }
}

/** Add only explicit context rows selected and supplied in this exact operation's packet. */
export function bindCompanyMethodEvidenceContext(result: ReturnType<typeof validateCompanyMethodOutput>, packets: readonly CompanyEvidencePacket[]): ReturnType<typeof validateCompanyMethodOutput> {
  const excerpts = new Map(packets.map(withCompanyEvidenceDateContext).flatMap((packet) => packet.excerpts.map((excerpt) => [`${packet.sourceCandidateId}@${excerpt.location}`, excerpt] as const)))
  const expand = (ref: CompanyMethodEvidenceRef): CompanyMethodEvidenceRef[] => [ref, ...(excerpts.get(`${ref.sourceCandidateId}@${ref.location}`)?.contextLocations ?? []).filter((location) => excerpts.has(`${ref.sourceCandidateId}@${location}`)).map((location) => ({ sourceCandidateId: ref.sourceCandidateId, location }))]
  const markdown = (text: string) => text.replace(/\[([^\]\s]+)@(paragraph:\d+)\]/g, (_match, sourceCandidateId: string, location: string) => expand({ sourceCandidateId, location }).map((ref) => `[${ref.sourceCandidateId}@${ref.location}]`).join(' '))
  return { ...result, markdown: markdown(result.markdown), sections: result.sections.map((section) => ({ ...section, markdown: markdown(section.markdown) })), findings: result.findings.map((finding) => ({ ...finding, evidence: [...new Map(finding.evidence.flatMap(expand).map((ref) => [`${ref.sourceCandidateId}@${ref.location}`, ref])).values()] })) }
}

export function validateCompanyMethodOutput(output: unknown, packets: readonly CompanyEvidencePacket[], ownedSectionIds?: readonly string[]): Pick<CompanyResearchMethodResult, 'status' | 'answer' | 'markdown' | 'sections' | 'findings' | 'limitations' | 'risks'> {
  let raw: unknown = output
  if (typeof raw === 'string') { try { raw = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) } catch { throw new Error('FORMAT: Invalid JSON') } }
  const object = (value: unknown): Record<string, unknown> => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('FORMAT: Expected object'); return value as Record<string, unknown> }
  const value = object(raw)
  const exact = (row: Record<string, unknown>, keys: readonly string[]) => { if (Object.keys(row).some((key) => !keys.includes(key)) || keys.some((key) => !(key in row))) throw new Error('FORMAT: Unexpected or missing fields') }
  exact(value, ['status', 'answer', 'markdown', 'sections', 'findings', 'limitations', 'risks'])
  const string = (value: unknown, max: number): string => { if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('FORMAT: Invalid bounded string'); return value.trim() }
  const array = (value: unknown, max: number): unknown[] => { if (!Array.isArray(value) || value.length > max) throw new Error('FORMAT: Invalid bounded array'); return value }
  if (value.status !== 'complete' && value.status !== 'insufficient_evidence') throw new Error('FORMAT: Invalid status')
  const allowed = new Set(packets.flatMap((packet) => packet.excerpts.map((excerpt) => `${excerpt.sourceCandidateId}@${excerpt.location}`)))
  const findings = array(value.findings, 24).map((item): CompanyMethodFinding => {
    const row = object(item); exact(row, ['text', 'kind', 'evidence'])
    if (!['fact', 'inference', 'assumption'].includes(String(row.kind))) throw new Error('FORMAT: Invalid finding kind')
    const evidence = array(row.evidence, 12).map((item): CompanyMethodEvidenceRef => { const ref = object(item); exact(ref, ['sourceCandidateId', 'location']); const sourceCandidateId = string(ref.sourceCandidateId, 300); const location = string(ref.location, 100); if (!allowed.has(`${sourceCandidateId}@${location}`)) throw new Error(`REFERENCE: Evidence location not supplied: ${sourceCandidateId}@${location}`); return { sourceCandidateId, location } })
    if (!evidence.length) throw new Error('REFERENCE: Findings require attributable evidence')
    return { text: string(row.text, 1800), kind: row.kind as CompanyMethodFinding['kind'], evidence }
  })
  const normalizeInlineCitations = (text: string) => text
    .replace(/\[\[([^\]\s]+@paragraph:\d+)\]\]/g, '[$1]')
    // Split grouped paragraph locators only when every exact reference was
    // supplied to this method. Unknown or malformed groups remain invalid.
    .replace(/\[([^\[\]]+@paragraph:\d+(?:\s*[;,，]\s*[^\[\]]+@paragraph:\d+)+)\]/g, (_literal, refs: string) => {
      const locators = refs.split(/\s*[;,，]\s*/)
      if (!locators.every((ref) => allowed.has(ref))) throw new Error('REFERENCE: Grouped inline citation contains a locator not supplied to this method')
      return locators.map((ref) => `[${ref}]`).join(' ')
    })
    // Some reasoning responses use Chinese lenticular brackets around an
    // otherwise exact locator. Normalize only references already present in
    // the supplied evidence packet; unknown locators remain invalid below.
    .replace(/〔([^\s〕]+@paragraph:\d+)〕/g, (literal, ref: string) => allowed.has(ref) ? `[${ref}]` : literal)
  let markdown = normalizeInlineCitations(string(value.markdown, 16000))
  let sections = array(value.sections, 3).map((item) => { const row = object(item); exact(row, ['id', 'markdown']); return { id: string(row.id, 100), markdown: normalizeInlineCitations(string(row.markdown, 16000)) } })
  if (ownedSectionIds?.length === 3 && ownedSectionIds.join(',') === 'business-model,business-segments,supply-chain' && ownedSectionIds.some((id) => !sections.some((section) => section.id === id))) {
    // Some model responses correctly write the three distinct analyses in
    // markdown but put only the first one in `sections`. Recover only when the
    // exact, unique headings identify every missing owned section.
    const lines = markdown.split(/\r?\n/)
    const markers = new Map<string, number[]>()
    const aliases: Readonly<Record<string, RegExp>> = {
      'business-segments': /^#{1,6}\s*业务分部\s*#*\s*$/,
      'supply-chain': /^#{1,6}\s*供应链\s*#*\s*$/,
    }
    for (let index = 0; index < lines.length; index++) for (const [id, pattern] of Object.entries(aliases)) if (pattern.test(lines[index]!)) markers.set(id, [...(markers.get(id) ?? []), index])
    const segmentMarker = markers.get('business-segments') ?? []
    const supplyMarker = markers.get('supply-chain') ?? []
    if (segmentMarker.length === 1 && supplyMarker.length === 1 && segmentMarker[0]! < supplyMarker[0]!) {
      const recovered = [
        { id: 'business-model', markdown: lines.slice(0, segmentMarker[0]).join('\n').trim() },
        { id: 'business-segments', markdown: lines.slice(segmentMarker[0], supplyMarker[0]).join('\n').trim() },
        { id: 'supply-chain', markdown: lines.slice(supplyMarker[0]).join('\n').trim() },
      ]
      if (recovered.every((section) => section.markdown)) sections = recovered
    }
  }
  if (!sections.length || new Set(sections.map((section) => section.id)).size !== sections.length || (ownedSectionIds && (sections.some((section) => !ownedSectionIds.includes(section.id)) || ownedSectionIds.some((id) => !sections.some((section) => section.id === id))))) throw new Error(`FORMAT: Sections must match exact owned section IDs; expected=${JSON.stringify(ownedSectionIds ?? [])}; received=${JSON.stringify(sections.map(section=>section.id))}; missing=${JSON.stringify(ownedSectionIds?.filter(id=>!sections.some(section=>section.id===id)) ?? [])}`)
  for (const section of sections) {
    const tableErrors = validateCompanyResearchMarkdownTables(section.markdown)
    if (tableErrors.length) throw new Error(`FORMAT: Owned section ${section.id} has malformed Markdown tables: ${tableErrors.join('; ')}`)
  }
  for (const text of [markdown, ...sections.map((section) => section.markdown)]) for (const match of text.matchAll(/\[([^\]\s]+@[^\]\s]+)\]/g)) if (!allowed.has(match[1]!)) throw new Error(`REFERENCE: Unknown markdown citation ${match[1]}`)
  const hasLocatedCitation = (text: string) => [...text.matchAll(/\[([^\]\s]+@[^\]\s]+)\]/g)].some((match) => allowed.has(match[1]!))
  if (value.status === 'complete' && findings.length && !hasLocatedCitation(markdown)) {
    const evidence = findings.flatMap((finding) => finding.evidence).find((ref) => allowed.has(`${ref.sourceCandidateId}@${ref.location}`))
    if (evidence) markdown = `${markdown} [${evidence.sourceCandidateId}@${evidence.location}]`
  }
  if (value.status === 'complete' && (!findings.length || !hasLocatedCitation(markdown))) throw new Error('FORMAT: Complete method requires findings and explicit markdown citations')
  if (value.status === 'complete' && sections.some((section) => !hasLocatedCitation(section.markdown))) throw new Error('FORMAT: Each complete owned section requires an inline citation from supplied evidence')
  const limitations = array(value.limitations, 20).map((item) => string(item, 1200))
  if (value.status === 'insufficient_evidence' && !limitations.length) throw new Error('FORMAT: Insufficient evidence requires specific limitations')
  let risks = array(value.risks, 20).map((item) => string(item, 1200))
  if (value.status === 'complete' && ownedSectionIds?.includes('risks') && !risks.length) {
    const tableLines = (sections.find((section) => section.id === 'risks')?.markdown ?? '').split(/\r?\n/).filter((line) => /^\s*\|/.test(line))
    const cells = (line: string) => line.trim().replace(/^\|\s*/, '').replace(/\s*\|\s*$/, '').split(/(?<!\\)\|/).map((cell) => cell.trim())
    const header = tableLines.find((line) => !/^\s*\|(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(line))
    const headerCount = header ? cells(header).length : 0
    const tableRows = tableLines.filter((line) => !/^\s*\|(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(line) && line !== header && cells(line).length === headerCount && headerCount >= 3)
    risks = tableRows.filter((line) => /\[[^\]\s]+@paragraph:\d+\]/.test(line)).map((line) => line.trim()).slice(0, 20)
  }
  return { status: value.status, answer: string(value.answer, 3000), markdown, sections, findings, limitations, risks }
}
