import type { ReasoningExecutor, ReasoningRequest } from '../../plugins/reasoning/contracts.ts'
import { ReasoningExecutorError } from '../../plugins/reasoning/errors.ts'
import type { EarningsComputation } from './financials.ts'
import { EARNINGS_REVIEW_SECTIONS, type EarningsImpactAssessment, type EarningsReviewProposal, type EarningsReviewSection, type EarningsReviewSkillInput, type EarningsReviewSkillResult } from './contracts.ts'

const LOCAL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const DISPOSITIONS = ['new_fact', 'supports_existing', 'contradicts_existing', 'changes_assumption', 'affects_thesis', 'new_catalyst', 'new_risk', 'no_change', 'research_gap'] as const
const CLAIM_TYPES = ['fact', 'viewpoint', 'risk', 'assumption', 'thesis', 'catalyst'] as const
const WRAPPERS = ['result', 'output', 'data', 'structuredOutput', 'response'] as const
const MAX_FILING_EXCERPT = 1_500
const MAX_REPAIR_OUTPUT_CHARS = 12_000

type AllowedSets = {
  readonly sourceCandidateIds: readonly string[]
  readonly existingKnowledgeClaimRefs: readonly string[]
  readonly assumptionClaimRefs: readonly string[]
  readonly thesisClaimRefs: readonly string[]
  readonly deterministicMetrics: readonly string[]
}

type RepairContext = {
  readonly priorInvalidStructuredOutput: unknown
  readonly validatorDiagnostics: readonly string[]
}

export class EarningsReviewSemanticError extends Error {
  readonly retryable: boolean
  readonly diagnostics: readonly string[]

  constructor(message: string, diagnostics: readonly string[] = [], retryable = true) {
    super(message)
    this.name = 'EarningsReviewSemanticError'
    this.retryable = retryable
    this.diagnostics = diagnostics
  }
}

export class EarningsReviewSkill {
  constructor(private readonly now: () => string = () => new Date().toISOString(), private readonly executor?: ReasoningExecutor) {}

  fallback(input: EarningsReviewSkillInput, computation: EarningsComputation, reason?: string, options: { readonly repairAttempts?: number; readonly diagnostics?: readonly string[] } = {}): EarningsReviewSkillResult {
    const unavailable = computation.unavailable.length ? `Unavailable metrics for ${input.company.symbol}: ${computation.unavailable.join(', ')}.` : `Available normalized current-period metrics for ${input.company.symbol} are listed above; numeric value-version status is reported separately.`
    const diagnostics = options.diagnostics ?? (reason === undefined ? [] : ['semantic_reasoning_failed'])
    const safeReason = diagnostics.join('; ')
    const current = computation.metrics.filter((metric) => metric.period === input.period.key)
    const officialRefs = [...new Set(input.officialSources.map((source) => source.candidateId))]
    const metricRefs = (names: readonly string[]) => [...new Set(names.flatMap((name) => computation.byMetric[name]?.sourceCandidateIds ?? []))]
    const metricLine = (name: keyof typeof METRIC_LABELS) => {
      const metric = computation.byMetric[name]
      if (!metric) return undefined
      const unit = metric.metric === 'gross_margin_delta_bps' ? 'bps' : metric.unit === 'CNY_per_share' ? 'CNY/share' : metric.unit
      return `- ${METRIC_LABELS[name]}: ${formatMetricValue(metric.value)} ${unit} (${metric.period}; ${metric.calculation}).`
    }
    const lines = (names: readonly (keyof typeof METRIC_LABELS)[]) => names.map(metricLine).filter((line): line is string => line !== undefined)
    const sectionContent: Partial<Record<(typeof EARNINGS_REVIEW_SECTIONS)[number], { readonly markdown: string; readonly refs: readonly string[] }>> = {
      'Earnings Snapshot': {
        markdown: current.length ? `Structured actuals returned for ${input.company.symbol} (${input.period.key}):\n${lines(['revenue', 'net_profit', 'gross_margin', 'operating_cash_flow', 'eps']).join('\n') || '- No supported core metrics.'}` : gap('Earnings Snapshot'),
        refs: [...officialRefs, ...metricRefs(['revenue', 'net_profit', 'gross_margin', 'operating_cash_flow', 'eps'])],
      },
      'Revenue / Profit Growth': {
        markdown: lines(['revenue_yoy', 'net_profit_yoy']).join('\n') || gap('Revenue / Profit Growth'),
        refs: metricRefs(['revenue_yoy', 'net_profit_yoy']),
      },
      'Margin Analysis': {
        markdown: lines(['gross_margin', 'gross_margin_delta_bps']).join('\n') || gap('Margin Analysis'),
        refs: metricRefs(['gross_margin', 'gross_margin_delta_bps']),
      },
      'Cash Flow / Working Capital': {
        markdown: lines(['operating_cash_flow', 'operating_cash_flow_to_net_profit']).join('\n') || `${gap('Cash Flow / Working Capital')} Operating cash flow and cash-conversion inputs are unavailable.`,
        refs: metricRefs(['operating_cash_flow', 'operating_cash_flow_to_net_profit']),
      },
      'Earnings Quality': {
        markdown: computation.byMetric.operating_cash_flow_to_net_profit
          ? lines(['operating_cash_flow_to_net_profit']).join('\n')
          : `${gap('Earnings Quality')} Cash conversion and accrual-quality inputs are incomplete; no earnings-quality conclusion is made.`,
        refs: metricRefs(['operating_cash_flow_to_net_profit']),
      },
      'Valuation Implications': { markdown: `${gap('Valuation Implications')} Consensus unavailable; no actual-versus-consensus or valuation conclusion is made.`, refs: [] },
      'Research Gaps / Monitoring': {
        markdown: `${unavailable}${safeReason ? ` Deterministic diagnostics: ${safeReason}.` : ''}`,
        refs: [...officialRefs, ...metricRefs(Object.keys(computation.byMetric))],
      },
    }
    const sections = EARNINGS_REVIEW_SECTIONS.map((title) => {
      const content = sectionContent[title]
      return { id: sectionId(title), title, markdown: content?.markdown ?? gap(title), sourceCandidateIds: content?.refs ?? [], assessmentRefs: [] }
    })
    const runtime = this.executor as unknown as { runtimeMetadata?: () => { requestedModel?: string } } | undefined
    const model = typeof runtime?.runtimeMetadata === 'function' ? runtime.runtimeMetadata().requestedModel : undefined
    return { sections, assessments: [], proposals: [], reasoning: { called: this.executor !== undefined, validated: false, applied: false, fallbackUsed: true, repairAttempts: options.repairAttempts ?? 0, operation: 'earnings_review_synthesis', ...(model === undefined ? {} : { model }), ...(diagnostics.length === 0 ? {} : { diagnostic: diagnostics.join('; ').slice(0, 300), diagnostics }) } }
  }

  async synthesize(input: EarningsReviewSkillInput, computation: EarningsComputation): Promise<EarningsReviewSkillResult> {
    if (!this.executor) return this.fallback(input, computation)
    const allowed = allowedSets(input, computation)
    const contract = outputContract(allowed, computation)
    let repairAttempts = 0
    let priorOutput: unknown = null
    let diagnostics: readonly string[] = []

    const execute = async (repairContext?: RepairContext) => {
      const request: ReasoningRequest = {
        operation: 'earnings_review_synthesis',
        instruction: repairContext === undefined ? instruction(false) : instruction(true, repairContext.validatorDiagnostics),
        input: modelInput(input, computation, allowed, this.now(), repairContext),
        outputContract: contract,
        metadata: { operationFamily: 'personal-research-v1', companySymbol: input.company.symbol, fiscalPeriod: input.period.key },
      }
      return this.executor!.execute(request)
    }

    try {
      try {
        const first = await execute()
        priorOutput = normalizedForRepair(first.output)
        try {
          return withReasoning(validateOutput(priorOutput, computation, allowed), this.executor, repairAttempts)
        } catch (error) {
          diagnostics = safeDiagnostics(error)
        }
      } catch (error) {
        diagnostics = safeDiagnostics(error)
      }

      repairAttempts = 1
      const repaired = await execute({ priorInvalidStructuredOutput: boundForRepair(priorOutput), validatorDiagnostics: diagnostics })
      const repairedOutput = normalizedForRepair(repaired.output)
      return withReasoning(validateOutput(repairedOutput, computation, allowed), this.executor, repairAttempts)
    } catch (error) {
      const repairDiagnostics = safeDiagnostics(error)
      return this.fallback(input, computation, undefined, { repairAttempts, diagnostics: [...diagnostics, ...repairDiagnostics].slice(0, 24) })
    }
  }
}

function sectionId(title: string): string { return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') }
function gap(title: string): string { return `Research Gap / Unavailable: no bounded evidence supports a conclusion for ${title}.` }
function formatMetricValue(value: number): string { return new Intl.NumberFormat('en-US', { maximumFractionDigits: 4, useGrouping: true }).format(value) }
const METRIC_LABELS = {
  revenue: 'Revenue', net_profit: 'Net profit', gross_margin: 'Gross margin', operating_cash_flow: 'Operating cash flow', eps: 'EPS',
  revenue_yoy: 'Revenue YoY', net_profit_yoy: 'Net profit YoY', gross_margin_delta_bps: 'Gross margin change vs prior-year period', operating_cash_flow_to_net_profit: 'Operating cash flow / net profit',
} as const

function allowedSets(input: EarningsReviewSkillInput, computation: EarningsComputation): AllowedSets {
  const sourceCandidateIds = [...new Set([...input.officialSources.map((source) => source.candidateId), ...computation.metrics.flatMap((metric) => metric.sourceCandidateIds)])].sort()
  const existingKnowledgeClaimRefs = [...new Set(input.existingKnowledgeClaims.map((claim) => typeof claim.canonicalRef === 'string' ? claim.canonicalRef : '').filter(Boolean))].sort()
  const assumptionClaimRefs = input.existingKnowledgeClaims.filter((claim) => claim.claimType === 'assumption' && typeof claim.canonicalRef === 'string').map((claim) => claim.canonicalRef as string).sort()
  const thesisClaimRefs = input.existingKnowledgeClaims.filter((claim) => claim.claimType === 'thesis' && typeof claim.canonicalRef === 'string').map((claim) => claim.canonicalRef as string).sort()
  return { sourceCandidateIds, existingKnowledgeClaimRefs, assumptionClaimRefs, thesisClaimRefs, deterministicMetrics: Object.keys(computation.byMetric).sort() }
}

function instruction(repair: boolean, diagnostics: readonly string[] = []): string {
  const prefix = repair ? `This is bounded repair attempt 1. The prior candidate failed deterministic validation. Correct every listed diagnostic exactly: ${diagnostics.join(', ') || 'output_contract_invalid'}. Return a complete replacement object, never a patch.` : 'Return the first complete candidate.'
  return `${prefix} Review only the supplied bounded earnings evidence. Return exactly one JSON object with exactly these top-level arrays: sections, impactAssessments, proposals. sections must contain all 14 required titles from outputContract. For impactAssessments, disposition must be copied character-for-character from exactly one of: new_fact, supports_existing, contradicts_existing, changes_assumption, affects_thesis, new_catalyst, new_risk, no_change, research_gap; never use spaces, capitalization, or synonyms. For proposals, kind must be exactly claim, subjectKey exactly company, and claimType must be copied character-for-character from exactly one of: fact, viewpoint, risk, assumption, thesis, catalyst. impactAssessments are local assessments; proposals are local claim-only proposals. Copy references exactly from the supplied allowed arrays. Never allocate canonical IDs, decide durability, invent evidence or metrics, or use consensus. If no durable change is supported, return an empty proposals array. Use rationale as a non-empty concise string. Do not return Markdown fences or explanatory text.`
}

function modelInput(input: EarningsReviewSkillInput, computation: EarningsComputation, allowed: AllowedSets, generatedAt: string, repair?: RepairContext): Record<string, unknown> {
  const result: Record<string, unknown> = {
    generatedAt,
    company: input.company,
    fiscalPeriod: input.period,
    allowedSourceCandidateIds: allowed.sourceCandidateIds,
    allowedExistingClaimRefs: allowed.existingKnowledgeClaimRefs,
    allowedAssumptionClaimRefs: allowed.assumptionClaimRefs,
    allowedThesisClaimRefs: allowed.thesisClaimRefs,
    allowedDeterministicMetrics: allowed.deterministicMetrics,
    selectedOfficialFilingExcerpts: input.officialSources.slice(0, 20).map((source) => ({ candidateId: source.candidateId, title: source.title, publishedAt: source.publishedAt, content: source.content.slice(0, MAX_FILING_EXCERPT), ...(source.url === undefined ? {} : { url: source.url }) })),
    deterministicFinancialMetrics: computation.metrics,
    existingKnowledgeClaims: input.existingKnowledgeClaims.slice(0, 40).map((claim) => ({ canonicalRef: claim.canonicalRef, claimType: claim.claimType, statement: typeof claim.statement === 'string' ? claim.statement.slice(0, 600) : undefined })),
    methodology: 'Exact-period official disclosure plus period-scoped AKShare metrics; code owns arithmetic and durable eligibility.',
  }
  if (repair !== undefined) result.repair = { attempt: 1, priorInvalidStructuredOutput: repair.priorInvalidStructuredOutput, validatorDiagnostics: repair.validatorDiagnostics, allowedDispositionValues: DISPOSITIONS, allowedClaimTypeValues: CLAIM_TYPES }
  return result
}

function outputContract(allowed: AllowedSets, computation: EarningsComputation): Record<string, unknown> {
  return {
    type: 'object',
    required: ['sections', 'impactAssessments', 'proposals'],
    sections: { type: 'array', exactlyRequiredTitles: EARNINGS_REVIEW_SECTIONS, item: { title: EARNINGS_REVIEW_SECTIONS, markdown: 'non-empty string', sourceCandidateIds: allowed.sourceCandidateIds, assessmentRefs: 'assessmentId values from impactAssessments' } },
    impactAssessments: { type: 'array', item: { assessmentId: 'local-safe-id', disposition: DISPOSITIONS, existingKnowledgeRefs: allowed.existingKnowledgeClaimRefs, sourceCandidateIds: allowed.sourceCandidateIds, rationale: 'non-empty string' } },
    proposals: { type: 'array', item: { proposalId: 'local-safe-id', kind: 'claim', subjectKey: 'company', claimType: CLAIM_TYPES, statement: 'non-empty string', sourceCandidateIds: allowed.sourceCandidateIds, assessmentRefs: 'assessmentId values from impactAssessments', structuredValue: { optional: true, metric: allowed.deterministicMetrics, value: 'exact supplied deterministic value', unit: 'exact supplied unit', period: 'exact supplied period', comparator: 'eq' } } },
    allowedSourceCandidateIds: allowed.sourceCandidateIds,
    allowedExistingClaimRefs: allowed.existingKnowledgeClaimRefs,
    allowedAssumptionClaimRefs: allowed.assumptionClaimRefs,
    allowedThesisClaimRefs: allowed.thesisClaimRefs,
    allowedDeterministicMetrics: allowed.deterministicMetrics,
    deterministicValues: Object.fromEntries(Object.entries(computation.byMetric).map(([key, metric]) => [key, { value: metric.value, unit: metric.unit, period: metric.period, comparator: 'eq' }])),
  }
}

function withReasoning(value: Omit<EarningsReviewSkillResult, 'reasoning'>, executor: ReasoningExecutor, repairAttempts: number): EarningsReviewSkillResult {
  const runtime = executor as unknown as { runtimeMetadata?: () => { requestedModel?: string } }
  const model = typeof runtime.runtimeMetadata === 'function' ? runtime.runtimeMetadata().requestedModel : undefined
  return { ...value, reasoning: { called: true, validated: true, applied: true, fallbackUsed: false, repairAttempts, operation: 'earnings_review_synthesis', ...(model === undefined ? {} : { model }) } }
}

function normalizedForRepair(value: unknown): Record<string, unknown> { return parseObject(value) }

function parseObject(value: unknown, depth = 0): Record<string, unknown> {
  if (typeof value === 'string') {
    try { return parseObject(JSON.parse(value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')), depth) } catch { throw new EarningsReviewSemanticError('earnings_review_synthesis returned invalid JSON', ['output_json_invalid']) }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new EarningsReviewSemanticError('earnings_review_synthesis must return an object', ['output_object_missing'])
  const object = value as Record<string, unknown>
  const wrapper = WRAPPERS.find((key) => object[key] !== undefined)
  if (wrapper === undefined) return object
  if (depth >= 2) throw new EarningsReviewSemanticError('earnings_review_synthesis wrapper depth exceeded', ['output_wrapper_depth_exceeded'])
  return parseObject(object[wrapper], depth + 1)
}

function arrayOfRecords(value: unknown): readonly Record<string, unknown>[] { return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item)) : [] }
function strings(value: unknown): readonly string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [] }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
function validLocalId(value: unknown): value is string { return typeof value === 'string' && LOCAL_ID.test(value) }

function validateOutput(value: unknown, computation: EarningsComputation, allowed: AllowedSets): Omit<EarningsReviewSkillResult, 'reasoning'> {
  const object = parseObject(value)
  const sources = new Set(allowed.sourceCandidateIds)
  const claims = new Set(allowed.existingKnowledgeClaimRefs)
  const rawAssessments = object.impactAssessments
  if (!Array.isArray(rawAssessments)) throw new EarningsReviewSemanticError('impactAssessments must be an array', ['impactAssessments_array_valid_false'])
  const assessments: EarningsImpactAssessment[] = []
  for (const [index, raw] of rawAssessments.entries()) {
    const item = isRecord(raw) ? raw : {}
    const existingKnowledgeRefs = strings(item.existingKnowledgeRefs)
    const sourceCandidateIds = strings(item.sourceCandidateIds)
    const assessmentIdValid = validLocalId(item.assessmentId)
    const dispositionValid = typeof item.disposition === 'string' && (DISPOSITIONS as readonly string[]).includes(item.disposition)
    const existingRefsArray = Array.isArray(item.existingKnowledgeRefs)
    const sourceRefsArray = Array.isArray(item.sourceCandidateIds)
    const existingRefsAllowed = existingRefsArray && existingKnowledgeRefs.length === (item.existingKnowledgeRefs as unknown[]).length && existingKnowledgeRefs.every((ref) => /^claim:[^\s]+$/.test(ref) && claims.has(ref))
    const sourceRefsAllowed = sourceRefsArray && sourceCandidateIds.length === (item.sourceCandidateIds as unknown[]).length && sourceCandidateIds.every((id) => sources.has(id))
    const rationaleValid = typeof item.rationale === 'string' && item.rationale.trim() !== ''
    const diagnostics = [`assessment_${index}_keys_${Object.keys(item).sort().join(',')}`, `assessment_${index}_id_valid_${assessmentIdValid}`, `assessment_${index}_disposition_valid_${dispositionValid}`, `assessment_${index}_existing_refs_array_${existingRefsArray}`, `assessment_${index}_existing_refs_allowed_${existingRefsAllowed}`, `assessment_${index}_source_refs_array_${sourceRefsArray}`, `assessment_${index}_source_refs_allowed_${sourceRefsAllowed}`, `assessment_${index}_rationale_valid_${rationaleValid}`]
    if (!assessmentIdValid || !dispositionValid || !existingRefsAllowed || !sourceRefsAllowed || !rationaleValid) throw new EarningsReviewSemanticError(`Invalid earnings assessment at index ${index}`, diagnostics)
    assessments.push({ assessmentId: item.assessmentId as string, disposition: item.disposition as EarningsImpactAssessment['disposition'], existingKnowledgeRefs, sourceCandidateIds, rationale: (item.rationale as string).trim().slice(0, 1_000) })
  }

  const assessmentIds = new Set(assessments.map((item) => item.assessmentId))
  const rawProposals = object.proposals
  if (!Array.isArray(rawProposals)) throw new EarningsReviewSemanticError('proposals must be an array', ['proposals_array_valid_false'])
  const proposals: EarningsReviewProposal[] = []
  for (const [index, raw] of rawProposals.entries()) {
    const item = isRecord(raw) ? raw : {}
    const proposalIdValid = validLocalId(item.proposalId) && !/^(?:entity|relation|claim|source|raw|module|theme-group):/.test(item.proposalId as string)
    const kindValid = item.kind === 'claim'
    const subjectValid = item.subjectKey === 'company'
    const claimTypeValid = typeof item.claimType === 'string' && (CLAIM_TYPES as readonly string[]).includes(item.claimType)
    const statementValid = typeof item.statement === 'string' && item.statement.trim() !== ''
    const assessmentRefs = strings(item.assessmentRefs)
    const sourceCandidateIds = strings(item.sourceCandidateIds)
    const assessmentRefsArray = Array.isArray(item.assessmentRefs)
    const sourceRefsArray = Array.isArray(item.sourceCandidateIds)
    const assessmentRefsValid = assessmentRefsArray && assessmentRefs.length > 0 && assessmentRefs.length === (item.assessmentRefs as unknown[]).length && assessmentRefs.every((ref) => assessmentIds.has(ref))
    const sourceRefsValid = sourceRefsArray && sourceCandidateIds.length > 0 && sourceCandidateIds.length === (item.sourceCandidateIds as unknown[]).length && sourceCandidateIds.every((id) => sources.has(id))
    const structuredDiagnostics = item.structuredValue === undefined ? [] : structuredValueDiagnostics(item.structuredValue, allowed, computation, index)
    const claimCompatibility = claimTypeValid && assessmentRefsValid && claimTypeCompatible(item.claimType as string, assessmentRefs.map((ref) => assessments.find((assessment) => assessment.assessmentId === ref)!))
    const diagnostics = [`proposal_${index}_keys_${Object.keys(item).sort().join(',')}`, `proposal_${index}_id_valid_${proposalIdValid}`, `proposal_${index}_kind_valid_${kindValid}`, `proposal_${index}_subject_valid_${subjectValid}`, `proposal_${index}_claim_type_valid_${claimTypeValid}`, `proposal_${index}_statement_valid_${statementValid}`, `proposal_${index}_assessment_refs_allowed_${assessmentRefsValid}`, `proposal_${index}_source_refs_allowed_${sourceRefsValid}`, `proposal_${index}_claim_type_compatible_${claimCompatibility}`, ...structuredDiagnostics]
    if (!proposalIdValid || !kindValid || !subjectValid || !claimTypeValid || !statementValid || !assessmentRefsValid || !sourceRefsValid || !claimCompatibility || structuredDiagnostics.some((item) => item.endsWith('_false'))) throw new EarningsReviewSemanticError(`Invalid earnings proposal at index ${index}`, diagnostics)
    proposals.push({ ...item, proposalId: item.proposalId as string, kind: 'claim', subjectKey: 'company', claimType: item.claimType as EarningsReviewProposal['claimType'], statement: (item.statement as string).trim(), sourceCandidateIds, assessmentRefs, temporal: undefined } as EarningsReviewProposal)
  }

  const rawSections = arrayOfRecords(object.sections)
  const byTitle = new Map(rawSections.map((item) => [typeof item.title === 'string' ? item.title : '', item]))
  const requiredTitlesValid = rawSections.length === EARNINGS_REVIEW_SECTIONS.length && new Set(rawSections.map((item) => item.title)).size === EARNINGS_REVIEW_SECTIONS.length && EARNINGS_REVIEW_SECTIONS.every((title) => byTitle.has(title))
  if (!requiredTitlesValid) throw new EarningsReviewSemanticError('sections must contain exactly the 14 required titles', [`sections_required_titles_valid_${requiredTitlesValid}`, ...EARNINGS_REVIEW_SECTIONS.filter((title) => !byTitle.has(title)).map((title) => `section_missing_${sectionId(title)}`)])
  const sections: EarningsReviewSection[] = EARNINGS_REVIEW_SECTIONS.map((title) => {
    const item = byTitle.get(title)!
    const sourceCandidateIds = strings(item.sourceCandidateIds)
    const assessmentRefs = strings(item.assessmentRefs)
    const sourceRefsValid = Array.isArray(item.sourceCandidateIds) && sourceCandidateIds.length === (item.sourceCandidateIds as unknown[]).length && sourceCandidateIds.every((id) => sources.has(id))
    const assessmentRefsValid = Array.isArray(item.assessmentRefs) && assessmentRefs.length === (item.assessmentRefs as unknown[]).length && assessmentRefs.every((id) => assessmentIds.has(id))
    const markdownValid = typeof item.markdown === 'string' && item.markdown.trim() !== ''
    if (!sourceRefsValid || !assessmentRefsValid || !markdownValid) throw new EarningsReviewSemanticError(`Invalid earnings section ${title}`, [`section_${sectionId(title)}_source_refs_allowed_${sourceRefsValid}`, `section_${sectionId(title)}_assessment_refs_allowed_${assessmentRefsValid}`, `section_${sectionId(title)}_markdown_valid_${markdownValid}`])
    return { id: sectionId(title), title, markdown: (item.markdown as string).trim(), sourceCandidateIds, assessmentRefs }
  })
  const consensus = sections.find((section) => section.title === 'Valuation Implications')!
  const finalSections = consensus.markdown.includes('Consensus unavailable') ? sections : sections.map((section) => section.title === consensus.title ? { ...section, markdown: `${section.markdown}\n\nConsensus unavailable` } : section)
  return { sections: finalSections, assessments, proposals }
}

function structuredValueDiagnostics(value: unknown, allowed: AllowedSets, computation: EarningsComputation, index: number): string[] {
  if (!isRecord(value)) return [`proposal_${index}_structured_value_object_valid_false`]
  const metricValid = typeof value.metric === 'string' && allowed.deterministicMetrics.includes(value.metric)
  const expected = metricValid ? computation.byMetric[value.metric as string] : undefined
  const valueValid = typeof value.value === 'number' && Number.isFinite(value.value) && expected?.value === value.value
  const unitValid = typeof value.unit === 'string' && expected?.unit === value.unit
  const periodValid = typeof value.period === 'string' && expected?.period === value.period
  const comparatorValid = value.comparator === 'eq'
  return [`proposal_${index}_structured_metric_allowed_${metricValid}`, `proposal_${index}_structured_value_exact_${valueValid}`, `proposal_${index}_structured_unit_exact_${unitValid}`, `proposal_${index}_structured_period_exact_${periodValid}`, `proposal_${index}_structured_comparator_eq_${comparatorValid}`]
}

function claimTypeCompatible(claimType: string, assessments: readonly EarningsImpactAssessment[]): boolean {
  const durable = assessments.filter((assessment) => assessment.disposition !== 'no_change' && assessment.disposition !== 'research_gap')
  if (durable.length === 0) return false
  return durable.every((assessment) => assessment.disposition === 'new_fact' ? claimType === 'fact' : assessment.disposition === 'changes_assumption' ? claimType === 'assumption' : assessment.disposition === 'affects_thesis' ? claimType === 'thesis' : assessment.disposition === 'new_catalyst' ? claimType === 'catalyst' : assessment.disposition === 'new_risk' ? claimType === 'risk' : ['fact', 'viewpoint', 'risk', 'catalyst'].includes(claimType))
}

function safeDiagnostics(error: unknown): string[] {
  if (error instanceof EarningsReviewSemanticError && error.diagnostics.length > 0) return [...error.diagnostics].filter((item) => /^[A-Za-z0-9_.:,?=-]+$/.test(item)).slice(0, 24)
  if (error instanceof ReasoningExecutorError) return [`executor_${error.code}`]
  return ['semantic_reasoning_failed']
}

function boundForRepair(value: unknown): unknown {
  const bounded = boundValue(value, 0)
  const serialized = JSON.stringify(bounded)
  return serialized.length <= MAX_REPAIR_OUTPUT_CHARS ? bounded : { bounded: true, preview: serialized.slice(0, MAX_REPAIR_OUTPUT_CHARS - 80) }
}

function boundValue(value: unknown, depth: number): unknown {
  if (depth >= 4) return typeof value === 'string' ? value.slice(0, 400) : '[bounded]'
  if (typeof value === 'string') return value.slice(0, 1_200)
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value
  if (Array.isArray(value)) return value.slice(0, 24).map((item) => boundValue(item, depth + 1))
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).slice(0, 32).map(([key, item]) => [key, boundValue(item, depth + 1)]))
  return null
}
