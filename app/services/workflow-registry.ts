import type { ResearchQualityGateProfile } from '../../workflows/research-quality-gate.ts'

export interface WorkflowDefinition {
  readonly id: string
  readonly label: string
  readonly intentDescription: string
  readonly inputSchema: Readonly<Record<string, unknown>>
  readonly requiredInputs: readonly string[]
  readonly skillIds: readonly string[]
  /** Knowledge-kind methodology metadata, not an independently dispatched Skill. */
  readonly knowledgeSkillIds?: readonly string[]
  readonly qualityGateProfile?: ResearchQualityGateProfile
  readonly outputContract: string
  readonly knowledgeEffects: readonly string[]
}

const stringSchema = (description: string): Readonly<Record<string, unknown>> => ({ type: 'string', description })
const integerSchema = (description: string): Readonly<Record<string, unknown>> => ({ type: 'integer', description })

const DEFINITIONS: readonly WorkflowDefinition[] = [
  { id: 'company_research', label: 'Company Research', intentDescription: 'Build an evidence-backed research profile for one A-share company.', inputSchema: { symbol: stringSchema('Six-digit A-share symbol'), name: stringSchema('Optional company name'), exchange: stringSchema('Optional exchange') }, requiredInputs: ['symbol'], skillIds: ['business_model_map', 'business_driver_analysis', 'unit_economics', 'financial_quality_analysis', 'management_execution', 'capital_allocation_review', 'market_structure_analysis', 'expectation_gap', 'thesis_formalize'], qualityGateProfile: 'company', outputContract: 'ResearchReport + KnowledgeProposal', knowledgeEffects: ['Company', 'Source', 'Claim', 'Relation'] },
  { id: 'industry_research', label: 'Industry Research', intentDescription: 'Run bounded multi-module research for one industry.', inputSchema: { name: stringSchema('Industry name'), aliases: { type: 'array', items: stringSchema('Target alias') } }, requiredInputs: ['name'], skillIds: ['market_structure_analysis', 'industry_supply_demand_cycle', 'competitive_market_map'], qualityGateProfile: 'industry', outputContract: 'ResearchReport + KnowledgeProposal', knowledgeEffects: ['Industry', 'Source', 'Claim', 'Relation'] },
  { id: 'theme_framework', label: 'Theme Framework', intentDescription: 'Construct a bounded, evidence-backed initial Industry network for a named investment Theme and submit it for human review.', inputSchema: { name: stringSchema('Required Theme name'), definition: stringSchema('Optional Theme definition') }, requiredInputs: ['name'], skillIds: [], knowledgeSkillIds: ['theme-framework'], outputContract: 'Reviewable Theme Framework candidate; canonical writes only after explicit acceptance', knowledgeEffects: ['Theme', 'Industry', 'Relation', 'Theme scope decisions'] },
  { id: 'earnings_review', label: 'Earnings Review', intentDescription: 'Review an exact fiscal reporting period for a covered A-share company.', inputSchema: { symbol: stringSchema('Six-digit A-share symbol'), fiscalYear: integerSchema('Fiscal year'), period: { type: 'string', enum: ['Q1', 'H1', 'Q3', 'FY'] } }, requiredInputs: ['symbol', 'fiscalYear', 'period'], skillIds: ['consensus_expectations_analysis', 'earnings_variance_analysis', 'guidance_analysis', 'financial_quality_analysis', 'estimate_revision_analysis', 'expectation_gap', 'thesis_refresh'], qualityGateProfile: 'earnings', outputContract: 'ResearchReport + KnowledgeProposal', knowledgeEffects: ['Source', 'Claim'] },
  { id: 'valuation', label: 'Valuation', intentDescription: 'Calculate bounded valuation scenarios for a covered A-share company.', inputSchema: { symbol: stringSchema('Six-digit A-share symbol'), methods: { type: 'array', items: { type: 'string', enum: ['PE', 'PB', 'EV_EBITDA'] } }, targetFiscalYear: integerSchema('Optional target fiscal year') }, requiredInputs: ['symbol'], skillIds: ['consensus_expectations_analysis', 'dcf_valuation', 'reverse_dcf_expectation_decode', 'comps_valuation', 'scenario_valuation'], qualityGateProfile: 'valuation', outputContract: 'ResearchReport + KnowledgeProposal', knowledgeEffects: ['Source', 'Claim'] },
  { id: 'event_research', label: 'Event Research', intentDescription: 'Assess one explicit event anchor and its company-bound impacts.', inputSchema: { symbol: stringSchema('Six-digit A-share symbol'), anchor: { type: 'object', description: 'Explicit event anchor' } }, requiredInputs: ['symbol', 'anchor'], skillIds: ['catalyst_map'], qualityGateProfile: 'event', outputContract: 'ResearchReport + KnowledgeProposal', knowledgeEffects: ['Source', 'Claim', 'Relation'] },
  { id: 'thesis_red_team', label: 'Thesis Red Team', intentDescription: 'Adversarially test one active canonical Thesis Claim.', inputSchema: { symbol: stringSchema('Six-digit A-share symbol'), thesisRef: stringSchema('Canonical Claim reference'), lookbackDays: integerSchema('Optional lookback window') }, requiredInputs: ['symbol', 'thesisRef'], skillIds: ['thesis_red_team'], qualityGateProfile: 'thesis_lifecycle', outputContract: 'ResearchReport + KnowledgeProposal', knowledgeEffects: ['Source', 'Claim'] },
  { id: 'thesis_lifecycle', label: 'Thesis Lifecycle', intentDescription: 'Create or refresh a structured thesis through peer canonical Skills.', inputSchema: { mode: { type: 'string', enum: ['CREATE', 'REFRESH'] }, thesis: { type: 'object', description: 'Input-supplied thesis snapshot or formalization' }, expectations: { type: 'object', description: 'Optional injected expectation surfaces' }, catalysts: { type: 'object', description: 'Optional attributable catalyst candidates' }, newEvidence: { type: 'array', description: 'Bounded refresh evidence' } }, requiredInputs: ['mode'], skillIds: ['thesis_formalize', 'expectation_gap', 'thesis_red_team', 'catalyst_map', 'thesis_refresh'], qualityGateProfile: 'thesis_lifecycle', outputContract: 'ThesisLifecycleResult + bounded proposal candidates', knowledgeEffects: ['Source', 'Claim', 'Thesis', 'ReasoningEdge'] },
  { id: 'daily_intelligence', label: 'Daily Intelligence', intentDescription: 'Generate a bounded morning or evening research brief from configured public signals.', inputSchema: { briefType: { type: 'string', enum: ['morning', 'evening'] }, tradeDate: stringSchema('Trading date') }, requiredInputs: ['briefType', 'tradeDate'], skillIds: ['catalyst_map', 'expectation_gap', 'thesis_refresh'], qualityGateProfile: 'daily_intelligence', outputContract: 'DailyBriefReport + ResearchReport', knowledgeEffects: ['Source', 'Claim'] },
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
    if (definition.skillIds.some((item) => typeof item !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(item))) throw new Error(`Invalid Workflow Skill mapping: ${definition.id}`)
    if (definition.knowledgeSkillIds?.some((item) => typeof item !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(item))) throw new Error(`Invalid Workflow knowledge Skill metadata: ${definition.id}`)
    this.definitions.set(definition.id, clone(definition))
  }

  get(id: string): WorkflowDefinition | undefined {
    const value = this.definitions.get(id)
    return value === undefined ? undefined : clone(value)
  }

  list(): readonly WorkflowDefinition[] {
    return [...this.definitions.values()].sort((left, right) => left.id.localeCompare(right.id)).map(clone)
  }
}

export function createWorkflowDefinitionRegistry(): WorkflowDefinitionRegistry {
  return new WorkflowDefinitionRegistry()
}

export function listWorkflowDefinitions(): readonly WorkflowDefinition[] {
  return createWorkflowDefinitionRegistry().list()
}
