import type { ResearchQualityGateProfile } from '../../workflows/research-quality-gate.ts'
import { assertWorkflowInputSchema, ISO_DATE_TIME_SCHEMA, strictObjectSchema } from './workflow-input-contract.ts'

export interface WorkflowDefinition {
  readonly id: string
  readonly label: string
  readonly intentDescription: string
  /** Complete JSON Schema object; it is the source of truth for semantic input and deterministic validation. */
  readonly inputSchema: Readonly<Record<string, unknown>>
  /** Compatibility projection of the top-level JSON Schema required list. */
  readonly requiredInputs: readonly string[]
  readonly skillIds: readonly string[]
  /** Knowledge-kind methodology metadata, not an independently dispatched Skill. */
  readonly knowledgeSkillIds?: readonly string[]
  readonly qualityGateProfile?: ResearchQualityGateProfile
  readonly outputContract: string
  readonly knowledgeEffects: readonly string[]
}

const stringSchema = (description: string, extra: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> => ({ type: 'string', description, ...extra })
const integerSchema = (description: string, minimum = 1900, maximum = 2200): Readonly<Record<string, unknown>> => ({ type: 'integer', minimum, maximum, description })
const refArray = (description: string, prefix: string): Readonly<Record<string, unknown>> => ({ type: 'array', maxItems: 80, items: stringSchema(description, { pattern: `^${prefix}:[A-Za-z0-9][A-Za-z0-9._-]*$` }) })
const time = (description: string) => ({ ...ISO_DATE_TIME_SCHEMA, description })
const workflowSchema = (properties: Readonly<Record<string, unknown>>, required: readonly string[] = [], conditionals: Readonly<Record<string, unknown>>[] = []): Readonly<Record<string, unknown>> => ({ ...strictObjectSchema(properties, required), ...(conditionals.length === 0 ? {} : { allOf: conditionals }) })

const propositionSchema = strictObjectSchema({
  propositionId: stringSchema('Stable local proposition ID', { minLength: 1, maxLength: 120 }),
  statement: stringSchema('Falsifiable thesis proposition', { minLength: 1, maxLength: 2_000 }),
  propositionType: { type: 'string', enum: ['business_driver', 'industry_condition', 'competitive_position', 'financial_outcome', 'earnings_expectation', 'valuation_expectation', 'catalyst', 'risk', 'other'] },
  basis: { type: 'string', enum: ['verified_evidence', 'inference', 'hypothesis'] },
  timeHorizon: stringSchema('Proposition time horizon', { minLength: 1, maxLength: 80 }),
  sourceRefs: refArray('Canonical Source ref', 'source'),
  existingKnowledgeRefs: { type: 'array', maxItems: 80, items: stringSchema('Canonical Claim or Observation ref', { pattern: '^(claim|observation):[A-Za-z0-9][A-Za-z0-9._-]*$' }) },
  dependsOnPropositionRefs: { type: 'array', maxItems: 80, items: stringSchema('Proposition ID', { minLength: 1, maxLength: 120 }) },
  supportingPropositionRefs: { type: 'array', maxItems: 80, items: stringSchema('Proposition ID', { minLength: 1, maxLength: 120 }) },
  verificationCondition: stringSchema('Observable verification condition', { maxLength: 2_000 }),
  verificationTime: stringSchema('Verification time or period', { maxLength: 100 }),
  availability: { type: 'string', enum: ['available', 'insufficient_evidence', 'unavailable'] },
  loadBearing: { type: 'boolean' },
  expectationStatus: { type: 'string', enum: ['MATERIAL_GAP', 'NO_MATERIAL_GAP', 'UNAVAILABLE'] },
}, ['propositionId', 'statement', 'propositionType', 'basis', 'timeHorizon'])

const formalizationSchema = strictObjectSchema({
  thesisId: stringSchema('Existing canonical Thesis ID, if this is a refresh', { maxLength: 160 }),
  localRef: stringSchema('Input-local reference only; not a canonical ID', { maxLength: 160 }),
  summary: stringSchema('Thesis summary', { minLength: 1, maxLength: 4_000 }),
  propositions: { type: 'array', minItems: 1, maxItems: 80, items: propositionSchema },
  researchGaps: { type: 'array', maxItems: 80, items: strictObjectSchema({ gapId: stringSchema('Gap ID', { minLength: 1, maxLength: 120 }), statement: stringSchema('Research gap', { minLength: 1, maxLength: 2_000 }), affectedPropositionRefs: { type: 'array', maxItems: 80, items: stringSchema('Proposition ID') }, requiredEvidence: stringSchema('Evidence needed to close gap', { maxLength: 2_000 }) }, ['gapId', 'statement']) },
  asOf: time('User-requested analysis time; omitted defaults to the injected Runtime clock.'),
}, ['summary', 'propositions'])

const expectationGapSchema = strictObjectSchema({
  asOf: time('Runtime-injected analysis time.'),
  surfaces: { type: 'array', maxItems: 20, items: strictObjectSchema({
    surface: { type: 'string', enum: ['price_implied', 'consensus', 'management', 'own_research'] }, metric: stringSchema('Metric', { minLength: 1, maxLength: 200 }), period: stringSchema('Metric period', { minLength: 1, maxLength: 100 }), unit: stringSchema('Unit', { minLength: 1, maxLength: 80 }), basis: stringSchema('Comparison basis', { minLength: 1, maxLength: 300 }), value: { type: 'number' }, range: strictObjectSchema({ low: { type: 'number' }, high: { type: 'number' } }, ['low', 'high']), sourceRefs: refArray('Canonical Source ref', 'source'), upstreamResultRefs: { type: 'array', maxItems: 40, items: stringSchema('Bounded upstream result ref', { minLength: 1, maxLength: 160 }) }, publishedAt: time('Source publication timestamp'),
  }, ['surface', 'metric', 'period', 'unit', 'basis', 'sourceRefs']) },
  pairs: { type: 'array', maxItems: 6, uniqueItems: true, items: { type: 'string', enum: ['market_vs_consensus', 'market_vs_management', 'market_vs_own', 'consensus_vs_management', 'consensus_vs_own', 'management_vs_own'] } },
  materialityThreshold: { type: 'number', minimum: 0, maximum: 1 },
}, ['surfaces'])

const catalystMapSchema = strictObjectSchema({
  thesisRef: stringSchema('Verified canonical Claim or Thesis ref', { pattern: '^(claim|thesis):[A-Za-z0-9][A-Za-z0-9._-]*$' }),
  propositionRefs: { type: 'array', minItems: 1, maxItems: 80, items: stringSchema('Verified canonical Claim ref', { pattern: '^claim:[A-Za-z0-9][A-Za-z0-9._-]*$' }) },
  expectationGapRefs: { type: 'array', maxItems: 80, items: stringSchema('Bounded expectation-gap ref', { minLength: 1, maxLength: 160 }) },
  asOf: time('Runtime-injected analysis time.'),
  catalysts: { type: 'array', maxItems: 80, items: strictObjectSchema({
    catalystId: stringSchema('Catalyst ID', { minLength: 1, maxLength: 120 }), eventType: { type: 'string', enum: ['earnings', 'guidance', 'product_launch', 'capacity_ramp', 'customer_qualification', 'price_change', 'industry_KPI', 'regulatory_event', 'contract_award', 'capital_allocation', 'other'] }, description: stringSchema('Catalyst description', { minLength: 1, maxLength: 2_000 }), targetPropositionRefs: { type: 'array', minItems: 1, maxItems: 80, items: stringSchema('Proposition ref') }, targetExpectationGapRefs: { type: 'array', maxItems: 80, items: stringSchema('Expectation gap ref') }, eventDate: stringSchema('Event date', { maxLength: 100 }), eventWindow: strictObjectSchema({ start: stringSchema('Start date', { maxLength: 100 }), end: stringSchema('End date', { maxLength: 100 }) }), status: { type: 'string', enum: ['scheduled', 'conditional', 'occurred', 'cancelled', 'unknown'] }, observable: stringSchema('Observable outcome', { minLength: 1, maxLength: 1_000 }), sourceRefs: refArray('Canonical Source ref', 'source'), resolutionMechanism: stringSchema('Resolution mechanism', { maxLength: 1_000 }),
  }, ['catalystId', 'eventType', 'description', 'targetPropositionRefs', 'status', 'observable', 'sourceRefs']) },
}, ['thesisRef', 'propositionRefs', 'catalysts'])

const refreshSchema = strictObjectSchema({
  priorSnapshot: strictObjectSchema({
    thesisId: stringSchema('Canonical Thesis ID', { pattern: '^thesis:[A-Za-z0-9][A-Za-z0-9._-]*$' }), priorAsOf: time('Prior thesis snapshot time.'), propositions: { type: 'array', minItems: 1, maxItems: 80, items: strictObjectSchema({ propositionId: stringSchema('Canonical proposition Claim ref', { pattern: '^claim:[A-Za-z0-9][A-Za-z0-9._-]*$' }), statement: stringSchema('Prior proposition statement', { minLength: 1, maxLength: 2_000 }), status: stringSchema('Prior status', { maxLength: 80 }), loadBearing: { type: 'boolean' } }, ['propositionId', 'statement']) },
  }),
  currentAsOf: time('Runtime-injected current analysis time.'),
  evidence: { type: 'array', maxItems: 80, items: strictObjectSchema({ evidenceId: stringSchema('Evidence ID', { minLength: 1, maxLength: 160 }), publishedAt: time('Evidence publication time.'), relation: { type: 'string', enum: ['supports', 'weakens', 'contradicts', 'context', 'irrelevant'] }, targetPropositionRefs: { type: 'array', minItems: 1, maxItems: 80, items: stringSchema('Canonical Claim ref', { pattern: '^claim:[A-Za-z0-9][A-Za-z0-9._-]*$' }) }, sourceRefs: refArray('Canonical Source ref', 'source'), basis: { type: 'string', enum: ['verified_evidence', 'inference', 'hypothesis'] }, metric: stringSchema('Metric', { maxLength: 200 }), period: stringSchema('Period', { maxLength: 100 }), unit: stringSchema('Unit', { maxLength: 80 }), value: { type: 'number' }, statement: stringSchema('Evidence statement', { maxLength: 2_000 }) }, ['evidenceId', 'publishedAt', 'relation', 'targetPropositionRefs', 'sourceRefs']) },
  killCriteria: { type: 'array', maxItems: 80, items: strictObjectSchema({ conditionId: stringSchema('Kill criterion ID', { minLength: 1, maxLength: 120 }), targetPropositionRefs: { type: 'array', minItems: 1, maxItems: 80, items: stringSchema('Canonical Claim ref', { pattern: '^claim:[A-Za-z0-9][A-Za-z0-9._-]*$' }) }, observableMetric: stringSchema('Observable metric', { maxLength: 200 }), operator: { type: 'string', enum: ['eq', 'gt', 'gte', 'lt', 'lte'] }, threshold: { type: 'number' }, period: stringSchema('Period', { maxLength: 100 }), deadline: stringSchema('Deadline', { maxLength: 100 }), sourceRequirement: stringSchema('Source requirement', { maxLength: 500 }), thresholdSourceRefs: refArray('Canonical Source ref', 'source'), status: { type: 'string', enum: ['not_yet_observable', 'not_met', 'met', 'inconclusive', 'threshold_pending_evidence'] } }, ['conditionId', 'targetPropositionRefs']) },
}, ['evidence'])

const eventAnchorSchema = { oneOf: [
  strictObjectSchema({ kind: { const: 'daily_signal' }, signalId: stringSchema('Existing daily signal ID', { minLength: 1, maxLength: 160 }) }, ['kind', 'signalId']),
  strictObjectSchema({ kind: { const: 'article' }, url: stringSchema('User-provided article URL', { format: 'uri', maxLength: 2_000 }), title: stringSchema('Article title', { maxLength: 500 }), publishedAt: time('Publication time'), content: stringSchema('User-provided article content', { maxLength: 50_000 }) }, ['kind', 'url']),
  strictObjectSchema({ kind: { const: 'url' }, url: stringSchema('User-provided event URL', { format: 'uri', maxLength: 2_000 }), title: stringSchema('Event title', { maxLength: 500 }), publishedAt: time('Publication time') }, ['kind', 'url']),
  strictObjectSchema({ kind: { const: 'user_event' }, title: stringSchema('User-provided event title', { minLength: 1, maxLength: 500 }), description: stringSchema('User-provided event description', { minLength: 1, maxLength: 4_000 }), eventDate: stringSchema('User-provided event date', { maxLength: 100 }) }, ['kind', 'title', 'description']),
] }

const DEFINITIONS: readonly WorkflowDefinition[] = [
  { id: 'company_research', label: 'Company Research', intentDescription: 'Build an evidence-backed research profile for one A-share company.', inputSchema: workflowSchema({ symbol: stringSchema('Six-digit A-share symbol', { pattern: '^\\d{6}$' }), name: stringSchema('Company name from user context or verified Knowledge', { maxLength: 200 }), exchange: stringSchema('Exchange', { enum: ['SH', 'SZ', 'BJ', 'SSE', 'SZSE', 'BSE'] }), asOf: time('Optional user-requested historical cutoff; omit for current analysis.') }, ['symbol']), requiredInputs: ['symbol'], skillIds: ['business_model_map', 'business_driver_analysis', 'unit_economics', 'financial_quality_analysis', 'management_execution', 'capital_allocation_review', 'market_structure_analysis', 'expectation_gap', 'thesis_formalize'], qualityGateProfile: 'company', outputContract: 'ResearchReport + KnowledgeProposal', knowledgeEffects: ['Company', 'Source', 'Claim', 'Relation'] },
  { id: 'industry_research', label: 'Industry Research', intentDescription: 'Run bounded multi-module research for one industry.', inputSchema: workflowSchema({ name: stringSchema('Industry name', { minLength: 1, maxLength: 200 }), aliases: { type: 'array', maxItems: 8, items: stringSchema('Target alias', { minLength: 1, maxLength: 120 }) }, asOf: time('Optional user-requested historical cutoff.') }, ['name']), requiredInputs: ['name'], skillIds: ['market_structure_analysis', 'industry_supply_demand_cycle', 'competitive_market_map'], qualityGateProfile: 'industry', outputContract: 'ResearchReport + KnowledgeProposal', knowledgeEffects: ['Industry', 'Source', 'Claim', 'Relation'] },
  { id: 'theme_framework', label: 'Theme Framework', intentDescription: 'Construct a bounded, evidence-backed initial Industry network for a named investment Theme and submit it for human review.', inputSchema: workflowSchema({ name: stringSchema('Required Theme name', { minLength: 1, maxLength: 80 }), definition: stringSchema('Optional user-provided Theme definition', { maxLength: 300 }) }, ['name']), requiredInputs: ['name'], skillIds: [], knowledgeSkillIds: ['theme-framework'], outputContract: 'Reviewable Theme Framework candidate; canonical writes only after explicit acceptance', knowledgeEffects: ['Theme', 'Industry', 'Relation', 'Theme scope decisions'] },
  { id: 'earnings_review', label: 'Earnings Review', intentDescription: 'Review an exact fiscal reporting period for a covered A-share company.', inputSchema: workflowSchema({ symbol: stringSchema('Six-digit A-share symbol', { pattern: '^\\d{6}$' }), name: stringSchema('Verified company name', { maxLength: 200 }), exchange: stringSchema('Exchange', { enum: ['SH', 'SZ', 'BJ', 'SSE', 'SZSE', 'BSE'] }), fiscalYear: integerSchema('Fiscal year'), period: { type: 'string', enum: ['Q1', 'H1', 'Q3', 'FY'] }, asOf: time('Optional historical information cutoff; must match a user-requested date.') }, ['symbol', 'fiscalYear', 'period']), requiredInputs: ['symbol', 'fiscalYear', 'period'], skillIds: ['consensus_expectations_analysis', 'earnings_variance_analysis', 'guidance_analysis', 'financial_quality_analysis', 'estimate_revision_analysis', 'expectation_gap', 'thesis_refresh'], qualityGateProfile: 'earnings', outputContract: 'ResearchReport + KnowledgeProposal', knowledgeEffects: ['Source', 'Claim'] },
  { id: 'valuation', label: 'Valuation', intentDescription: 'Calculate bounded valuation scenarios for a covered A-share company.', inputSchema: workflowSchema({ symbol: stringSchema('Six-digit A-share symbol', { pattern: '^\\d{6}$' }), name: stringSchema('Verified company name', { maxLength: 200 }), exchange: stringSchema('Exchange', { enum: ['SH', 'SZ', 'BJ', 'SSE', 'SZSE', 'BSE'] }), asOf: time('User-requested historical cutoff. Omit for current value analysis; Runtime time does not imply historical mode.'), methods: { type: 'array', maxItems: 3, uniqueItems: true, items: { type: 'string', enum: ['PE', 'PB', 'EV_EBITDA'] } }, targetFiscalYear: integerSchema('Optional target fiscal year') }, ['symbol']), requiredInputs: ['symbol'], skillIds: ['consensus_expectations_analysis', 'dcf_valuation', 'reverse_dcf_expectation_decode', 'comps_valuation', 'scenario_valuation'], qualityGateProfile: 'valuation', outputContract: 'ResearchReport + KnowledgeProposal', knowledgeEffects: ['Source', 'Claim'] },
  { id: 'event_research', label: 'Event Research', intentDescription: 'Assess one explicit event anchor and its company-bound impacts.', inputSchema: workflowSchema({ symbol: stringSchema('Six-digit A-share symbol', { pattern: '^\\d{6}$' }), name: stringSchema('Verified company name', { maxLength: 200 }), exchange: stringSchema('Exchange', { enum: ['SH', 'SZ', 'BJ', 'SSE', 'SZSE', 'BSE'] }), asOf: time('Optional user-requested historical cutoff.'), anchor: eventAnchorSchema }, ['symbol', 'anchor']), requiredInputs: ['symbol', 'anchor'], skillIds: ['catalyst_map'], qualityGateProfile: 'event', outputContract: 'ResearchReport + KnowledgeProposal', knowledgeEffects: ['Source', 'Claim', 'Relation'] },
  { id: 'thesis_red_team', label: 'Thesis Red Team', intentDescription: 'Adversarially test one active canonical Thesis Claim.', inputSchema: workflowSchema({ symbol: stringSchema('Six-digit A-share symbol', { pattern: '^\\d{6}$' }), name: stringSchema('Verified company name', { maxLength: 200 }), exchange: stringSchema('Exchange', { enum: ['SH', 'SZ', 'BJ', 'SSE', 'SZSE', 'BSE'] }), asOf: time('Optional historical cutoff.'), thesisRef: stringSchema('Candidate Canonical Claim ref, verified against mounted Knowledge before start.', { pattern: '^claim:[A-Za-z0-9][A-Za-z0-9._-]*$' }), lookbackDays: integerSchema('Optional lookback window', 1, 3650) }, ['symbol', 'thesisRef']), requiredInputs: ['symbol', 'thesisRef'], skillIds: ['thesis_red_team'], qualityGateProfile: 'thesis_lifecycle', outputContract: 'ResearchReport + KnowledgeProposal', knowledgeEffects: ['Source', 'Claim'] },
  { id: 'thesis_lifecycle', label: 'Thesis Lifecycle', intentDescription: 'Create or refresh a structured thesis through peer canonical Skills.', inputSchema: workflowSchema({ mode: { type: 'string', enum: ['CREATE', 'REFRESH'] }, formalization: formalizationSchema, expectationGap: expectationGapSchema, catalystMap: catalystMapSchema, refresh: refreshSchema }, ['mode'], [
    { if: { properties: { mode: { const: 'CREATE' } }, required: ['mode'] }, then: { required: ['formalization'] } },
    { if: { properties: { mode: { const: 'REFRESH' } }, required: ['mode'] }, then: { required: ['refresh'] } },
  ]), requiredInputs: ['mode'], skillIds: ['thesis_formalize', 'expectation_gap', 'thesis_red_team', 'catalyst_map', 'thesis_refresh'], qualityGateProfile: 'thesis_lifecycle', outputContract: 'ThesisLifecycleResult + bounded proposal candidates', knowledgeEffects: ['Source', 'Claim', 'Thesis', 'ReasoningEdge'] },
  { id: 'daily_intelligence', label: 'Daily Intelligence', intentDescription: 'Generate a bounded morning or evening research brief from configured public signals.', inputSchema: workflowSchema({ briefType: { type: 'string', enum: ['morning', 'evening'] }, tradeDate: stringSchema('Trading date', { format: 'iso-date' }) }, ['briefType', 'tradeDate']), requiredInputs: ['briefType', 'tradeDate'], skillIds: ['catalyst_map', 'expectation_gap', 'thesis_refresh'], qualityGateProfile: 'daily_intelligence', outputContract: 'DailyBriefReport + ResearchReport', knowledgeEffects: ['Source', 'Claim'] },
]

function clone(definition: WorkflowDefinition): WorkflowDefinition {
  return { ...definition, inputSchema: JSON.parse(JSON.stringify(definition.inputSchema)) as Readonly<Record<string, unknown>>, requiredInputs: [...definition.requiredInputs], skillIds: [...definition.skillIds], ...(definition.knowledgeSkillIds === undefined ? {} : { knowledgeSkillIds: [...definition.knowledgeSkillIds] }), knowledgeEffects: [...definition.knowledgeEffects] }
}

export class WorkflowDefinitionRegistry {
  private readonly definitions = new Map<string, WorkflowDefinition>()

  constructor(definitions: readonly WorkflowDefinition[] = DEFINITIONS) {
    for (const definition of definitions) this.register(definition)
  }

  register(definition: WorkflowDefinition): void {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(definition.id)) throw new Error(`Unsafe Workflow definition ID: ${definition.id}`)
    if (this.definitions.has(definition.id)) throw new Error(`Duplicate Workflow definition: ${definition.id}`)
    if (!definition.label.trim() || !definition.intentDescription.trim() || !definition.outputContract.trim()) throw new Error(`Incomplete Workflow definition: ${definition.id}`)
    if (definition.requiredInputs.some((item) => typeof item !== 'string' || !item.trim())) throw new Error(`Invalid required input metadata: ${definition.id}`)
    assertWorkflowInputSchema(definition.inputSchema, definition.requiredInputs, definition.id)
    if (definition.skillIds.some((item) => typeof item !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(item))) throw new Error(`Invalid Workflow Skill mapping: ${definition.id}`)
    if (definition.knowledgeSkillIds?.some((item) => typeof item !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(item))) throw new Error(`Invalid Workflow knowledge Skill metadata: ${definition.id}`)
    this.definitions.set(definition.id, clone(definition))
  }

  replace(definition: WorkflowDefinition): void {
    const prior = this.definitions.get(definition.id)
    if (prior === undefined) throw new Error(`Workflow definition not found: ${definition.id}`)
    this.definitions.delete(definition.id)
    try { this.register(definition) } catch (error) { this.definitions.set(prior.id, prior); throw error }
  }

  remove(id: string): boolean { return this.definitions.delete(id) }
  get(id: string): WorkflowDefinition | undefined { const value = this.definitions.get(id); return value === undefined ? undefined : clone(value) }
  list(): readonly WorkflowDefinition[] { return [...this.definitions.values()].sort((left, right) => left.id.localeCompare(right.id)).map(clone) }
}

export function createWorkflowDefinitionRegistry(): WorkflowDefinitionRegistry { return new WorkflowDefinitionRegistry() }
export function listWorkflowDefinitions(): readonly WorkflowDefinition[] { return createWorkflowDefinitionRegistry().list() }
