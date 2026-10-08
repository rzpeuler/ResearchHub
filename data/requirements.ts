import type { DataDeterminismClass, DataRequirement, DataRequirementKind, IndustryEvidenceQueryContext, SourceAuthority } from './contracts.ts'
import { COMMON_DATA_CATALOG, createCommonDataCatalog, type CommonDataDefinition } from './common-catalog.ts'
import type { IndustryDataCatalog } from './industry-catalog.ts'
import { PHASE2_COMMON_SOURCE_POLICIES } from './valuation-earnings-policies.ts'
import { PHASE3_COMMON_SOURCE_POLICIES } from './company-research-policies.ts'
import { assertValidDataRequirement } from './validation.ts'

interface SkillDataRequirementBase {
  readonly id: string
  readonly required: boolean
  readonly dataKind: DataRequirementKind
  readonly determinismClass: DataDeterminismClass
  readonly minimumAuthority?: SourceAuthority
  readonly requiredFields?: readonly string[]
  readonly requireValueVersionProof?: boolean
}

export interface StaticSkillDataRequirement extends SkillDataRequirementBase {
  readonly kind: 'STATIC'
  readonly metricId: string
}

export interface IndustryDomainDataRequirement extends SkillDataRequirementBase {
  readonly kind: 'DOMAIN'
  readonly domain: 'industry'
  readonly semanticRole: string
  readonly metricFamily: string
}

export type SkillDataRequirement = StaticSkillDataRequirement | IndustryDomainDataRequirement

/** Runtime-specific fields are supplied by Workflow, never stored in Skill metadata. */
export interface DataRequirementRuntimeContext {
  readonly workflowId: string
  readonly asOf: string
  readonly subject?: DataRequirement['subject']
  readonly period?: DataRequirement['period']
}

export interface MaterializedDataRequirements {
  readonly requirements: readonly DataRequirement[]
  readonly unresolved: readonly {
    readonly templateId: string
    readonly required: boolean
    readonly reason: 'COMMON_DATA_DEFINITION_REQUIRED' | 'COMMON_DATA_KIND_MISMATCH' | 'INDUSTRY_ID_REQUIRED' | 'NO_CANONICAL_INDUSTRY_METRIC' | 'INDUSTRY_DATA_KIND_MISMATCH' | 'AMBIGUOUS_CANONICAL_INDUSTRY_METRIC'
  }[]
}

export interface IndustryEvidenceRequirementContext {
  readonly id: string
  readonly displayTarget: string
  readonly searchTerms: readonly string[]
  readonly purpose: string
  readonly asOf: string
  readonly subject?: DataRequirement['subject']
  readonly period?: DataRequirement['period']
  readonly required?: boolean
}

export function materializeIndustryEvidenceRequirement(context: IndustryEvidenceRequirementContext): DataRequirement {
  const queryContext: IndustryEvidenceQueryContext = Object.freeze({
    displayTarget: context.displayTarget,
    searchTerms: Object.freeze([...context.searchTerms]),
    purpose: context.purpose,
    ...(context.period?.start ? { start: context.period.start } : {}),
    ...(context.period?.end ? { end: context.period.end } : {}),
  })
  const requirement: DataRequirement = {
    id: context.id,
    consumer: { workflow: 'industry-deep-research' },
    subject: context.subject ?? {},
    dataKind: 'evidence',
    metricId: 'industry_research_evidence',
    ...(context.period ? { period: context.period } : {}),
    industryEvidenceQueryContext: queryContext,
    asOf: context.asOf,
    analysisAsOf: context.asOf,
    determinismClass: 'SEMANTIC_QUALITATIVE',
    required: context.required ?? false,
    llmWebFallback: 'FORBIDDEN',
  }
  assertValidDataRequirement(requirement)
  return requirement
}

export interface Phase2CommonRequirementContext {
  readonly workflowId: string
  readonly ticker: string
  readonly companyId?: string
  readonly asOf: string
  readonly period?: DataRequirement['period']
  readonly required: boolean
  readonly historicalNumeric?: boolean
  readonly id?: string
}

export interface Phase3CommonRequirementContext {
  readonly workflowId: 'company-deep-research' | 'event-research' | 'thesis-red-team'
  readonly ticker: string
  readonly companyId?: string
  readonly asOf: string
  readonly period?: DataRequirement['period']
  readonly required?: boolean
  readonly id?: string
  readonly asOfMode?: 'CURRENT_VALUE_ONLY' | 'HISTORICAL'
}

/** Materialize only audited Company inputs; the requested period belongs to the consumer. */
export function materializePhase3CommonRequirement(metricId: string, context: Phase3CommonRequirementContext): DataRequirement {
  const definition = COMMON_DATA_CATALOG.find((item) => item.metricId === metricId)
  if (!definition || !['company_basic_profile', 'company_financial_history', 'company_market_history', 'company_research_evidence'].includes(metricId)) throw new Error(`COMMON_DATA_DEFINITION_REQUIRED:${metricId}`)
  if (!definition.consumers.includes(context.workflowId)) throw new Error(`COMMON_DATA_CONSUMER_MISMATCH:${metricId}:${context.workflowId}`)
  if (!context.ticker.trim()) throw new Error(`COMMON_DATA_TICKER_REQUIRED:${metricId}`)
  if (metricId === 'company_market_history' && !context.period?.end) throw new Error(`COMMON_DATA_MARKET_PERIOD_REQUIRED:${metricId}`)
  const policy = PHASE3_COMMON_SOURCE_POLICIES.find((item) => item.requirementMatch.metricId === metricId && item.requirementMatch.workflow === context.workflowId)
  if (!policy) throw new Error(`COMMON_DATA_POLICY_REQUIRED:${metricId}`)
  const requirement: DataRequirement = {
    id: context.id ?? `${context.workflowId}:${metricId}:${context.ticker}:${context.period?.start ?? 'none'}:${context.period?.end ?? 'none'}`,
    consumer: { workflow: context.workflowId }, subject: { ticker: context.ticker, ...(context.companyId ? { companyId: context.companyId } : {}) },
    dataKind: definition.dataKind, metricId, ...(context.period ? { period: context.period } : {}),
    asOf: context.asOf, analysisAsOf: context.asOf,
    ...(context.asOfMode ? { asOfMode: context.asOfMode } : {}),
    determinismClass: metricId === 'company_market_history' ? 'EVIDENCE_BACKED_NUMERIC' : 'SEMANTIC_QUALITATIVE',
    required: context.required ?? true, llmWebFallback: 'FORBIDDEN',
  }
  assertValidDataRequirement(requirement)
  return requirement
}

const phase2PeriodRequired = new Set([
  'valuation_eps', 'valuation_bvps', 'valuation_annual_report_publication', 'earnings_official_filing',
  'earnings_actual_revenue', 'earnings_actual_net_profit', 'earnings_actual_gross_margin',
  'earnings_actual_operating_cash_flow', 'earnings_actual_eps',
  'earnings_expectation_eps', 'earnings_expectation_net_profit',
])
const phase2FiscalPeriodRequired = new Set([
  'earnings_official_filing', 'earnings_actual_revenue', 'earnings_actual_net_profit',
  'earnings_actual_gross_margin', 'earnings_actual_operating_cash_flow', 'earnings_actual_eps',
  'earnings_expectation_eps', 'earnings_expectation_net_profit',
])

/** Bind one live Common input to a specific issuer, cutoff, fiscal/market period, and policy. */
export function materializePhase2CommonRequirement(metricId: string, context: Phase2CommonRequirementContext): DataRequirement {
  const definition = getPhase2CommonDefinition(metricId)
  if (!definition.consumers.includes(context.workflowId)) throw new Error(`COMMON_DATA_CONSUMER_MISMATCH:${metricId}:${context.workflowId}`)
  if (!context.ticker.trim()) throw new Error(`COMMON_DATA_TICKER_REQUIRED:${metricId}`)
  if (phase2PeriodRequired.has(metricId) && context.period?.fiscalYear === undefined) throw new Error(`COMMON_DATA_PERIOD_REQUIRED:${metricId}`)
  if (phase2FiscalPeriodRequired.has(metricId) && !context.period?.fiscalPeriod) throw new Error(`COMMON_DATA_FISCAL_PERIOD_REQUIRED:${metricId}`)
  if (metricId === 'valuation_market_price' && !context.period?.end) throw new Error(`COMMON_DATA_MARKET_PERIOD_REQUIRED:${metricId}`)
  const policy = PHASE2_COMMON_SOURCE_POLICIES.find((item) => item.requirementMatch.metricId === metricId && item.requirementMatch.workflow === context.workflowId)
  if (!policy?.candidates[0]) throw new Error(`COMMON_DATA_POLICY_REQUIRED:${metricId}`)
  const periodKey = context.period ? `${context.period.fiscalYear ?? context.period.end ?? 'period'}:${context.period.fiscalPeriod ?? ''}` : 'none'
  const requirement: DataRequirement = {
    id: context.id ?? `${context.workflowId}:${metricId}:${context.ticker}:${periodKey}`,
    consumer: { workflow: context.workflowId, ...(policy.requirementMatch.capability ? { capability: policy.requirementMatch.capability } : {}) },
    subject: { ticker: context.ticker, ...(context.companyId ? { companyId: context.companyId } : {}) },
    dataKind: definition.dataKind,
    metricId,
    ...(context.period ? { period: context.period } : {}),
    asOf: context.asOf,
    analysisAsOf: context.asOf,
    determinismClass: definition.dataKind === 'metric' || definition.dataKind === 'estimate' || definition.dataKind === 'timeseries' ? 'AUTHORITATIVE_NUMERIC' : definition.dataKind === 'document' && metricId === 'valuation_annual_report_publication' ? 'EVIDENCE_BACKED_NUMERIC' : 'SEMANTIC_QUALITATIVE',
    minimumAuthority: policy.candidates[0].originAuthority,
    required: context.required,
    ...(context.historicalNumeric && definition.dataKind === 'metric' ? { requireValueVersionProof: true } : {}),
    llmWebFallback: 'FORBIDDEN',
  }
  assertValidDataRequirement(requirement)
  return requirement
}

function getPhase2CommonDefinition(metricId: string): CommonDataDefinition {
  const definition = COMMON_DATA_CATALOG.find((item) => item.metricId === metricId)
  if (!definition) throw new Error(`COMMON_DATA_DEFINITION_REQUIRED:${metricId}`)
  return definition
}

export function materializeSkillDataRequirements(
  skillId: string,
  templates: readonly SkillDataRequirement[],
  context: DataRequirementRuntimeContext,
  industryCatalog?: IndustryDataCatalog,
  commonCatalog: ReadonlyMap<string, CommonDataDefinition> = createCommonDataCatalog(COMMON_DATA_CATALOG),
): MaterializedDataRequirements {
  const requirements: DataRequirement[] = []
  const unresolved: MaterializedDataRequirements['unresolved'][number][] = []

  for (const template of templates) {
    const base = {
      consumer: { workflow: context.workflowId, skill: skillId },
      subject: context.subject ?? {},
      dataKind: template.dataKind,
      required: template.required,
      ...(template.requiredFields ? { requiredFields: template.requiredFields } : {}),
      ...(template.requireValueVersionProof ? { requireValueVersionProof: true } : {}),
      asOf: context.asOf,
      analysisAsOf: context.asOf,
      determinismClass: template.determinismClass,
      ...(template.minimumAuthority ? { minimumAuthority: template.minimumAuthority } : {}),
      llmWebFallback: 'FORBIDDEN' as const,
      ...(context.period ? { period: context.period } : {}),
    }
    if (template.kind === 'STATIC') {
      const definition = commonCatalog.get(template.metricId)
      if (!definition) {
        unresolved.push({ templateId: template.id, required: template.required, reason: 'COMMON_DATA_DEFINITION_REQUIRED' })
        continue
      }
      if (definition.dataKind !== template.dataKind) {
        unresolved.push({ templateId: template.id, required: template.required, reason: 'COMMON_DATA_KIND_MISMATCH' })
        continue
      }
      const compatibilityCapability = definition.compatibilityCapabilityByWorkflow?.[context.workflowId]
      requirements.push({
        ...base,
        consumer: { ...base.consumer, ...(compatibilityCapability ? { capability: compatibilityCapability } : {}) },
        id: `${skillId}:${template.id}`,
        metricId: template.metricId,
      })
      continue
    }

    const industryId = context.subject?.industryId
    if (!industryId) {
      unresolved.push({ templateId: template.id, required: template.required, reason: 'INDUSTRY_ID_REQUIRED' })
      continue
    }
    const resolution = industryCatalog?.resolveExact(industryId, template.semanticRole, template.metricFamily, template.dataKind)
      ?? { status: 'NO_CANONICAL_INDUSTRY_METRIC' as const }
    if (resolution.status === 'NO_CANONICAL_INDUSTRY_METRIC') {
      unresolved.push({ templateId: template.id, required: template.required, reason: 'NO_CANONICAL_INDUSTRY_METRIC' })
      continue
    }
    if (resolution.status === 'INDUSTRY_DATA_KIND_MISMATCH') {
      unresolved.push({ templateId: template.id, required: template.required, reason: 'INDUSTRY_DATA_KIND_MISMATCH' })
      continue
    }
    if (resolution.status === 'AMBIGUOUS_CANONICAL_INDUSTRY_METRIC') {
      unresolved.push({ templateId: template.id, required: template.required, reason: 'AMBIGUOUS_CANONICAL_INDUSTRY_METRIC' })
      continue
    }
    requirements.push({
      ...base,
      id: `${skillId}:${template.id}:${resolution.definition.metricId}`,
      dataKind: template.dataKind,
      metricId: resolution.definition.metricId,
      metricFamily: resolution.definition.metricFamily,
    })
    if (resolution.incompatibleMetricIds?.length) unresolved.push({
      templateId: template.id,
      required: template.required,
      reason: 'INDUSTRY_DATA_KIND_MISMATCH',
    })
  }
  return { requirements, unresolved }
}
