import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import type { SkillDataRequirement } from '../../data/requirements.ts'

export type ResearchSkillCatalogStatus = 'IMPLEMENTED' | 'PARTIAL' | 'PLANNED'
export type ResearchSkillExecutionClass = 'SEMANTIC_EXECUTABLE' | 'DETERMINISTIC_EXECUTABLE' | 'NOT_INDEPENDENTLY_EXECUTABLE'
/**
 * NONE: no requirements are declared or mapped; PARTIAL: known inputs are
 * deferred/unmapped or templates cover only a subset; COMPLETE: every external
 * data input for the method is represented.
 */
/**
 * NONE: no requirements are declared or mapped; PARTIAL: known inputs are
 * deferred/unmapped or templates cover only a subset; COMPLETE: every external
 * data input for the method is represented.
 */
export type SkillRequirementCoverage = 'NONE' | 'PARTIAL' | 'COMPLETE'

export interface ResearchSkillCatalogEntry {
  readonly canonicalSkillId: string
  readonly domain: string
  readonly purpose: string
  readonly invocationMatch: string
  readonly inputs: readonly string[]
  readonly produces: readonly string[]
  readonly status: ResearchSkillCatalogStatus
  readonly runtimeRegistered: boolean
  readonly currentSource: string
  readonly currentOwner: string
  readonly migrationAction: string
  readonly notes: string
  readonly requirementCoverage: SkillRequirementCoverage
  readonly executionClass?: ResearchSkillExecutionClass
  readonly runtimeBinding?: string
  readonly dataRequirements: readonly SkillDataRequirement[]
}

export const REQUIRED_RESEARCH_SKILL_SECTIONS = [
  'Purpose',
  'Invocation Match',
  'Typical Intents',
  'Inputs',
  'Produces',
  'Methodology',
  'Evidence Requirements',
  'Deterministic / Model Boundary',
  'Missing Data',
  'Validation / QC',
  'Related Skills',
] as const

const skillRoot = resolve(fileURLToPath(new URL('../../skills/', import.meta.url)))
const pathFor = (id: string): string => join(skillRoot, id, 'SKILL.md')

const EXECUTION_CLASS_BY_ID: Readonly<Partial<Record<string, ResearchSkillExecutionClass>>> = {
  business_model_map: 'SEMANTIC_EXECUTABLE',
  business_driver_analysis: 'DETERMINISTIC_EXECUTABLE',
  unit_economics: 'DETERMINISTIC_EXECUTABLE',
  financial_quality_analysis: 'DETERMINISTIC_EXECUTABLE',
  management_execution: 'DETERMINISTIC_EXECUTABLE',
  capital_allocation_review: 'DETERMINISTIC_EXECUTABLE',
  market_structure_analysis: 'DETERMINISTIC_EXECUTABLE',
  industry_supply_demand_cycle: 'DETERMINISTIC_EXECUTABLE',
  competitive_market_map: 'DETERMINISTIC_EXECUTABLE',
  consensus_expectations_analysis: 'DETERMINISTIC_EXECUTABLE',
  earnings_variance_analysis: 'DETERMINISTIC_EXECUTABLE',
  guidance_analysis: 'DETERMINISTIC_EXECUTABLE',
  estimate_revision_analysis: 'DETERMINISTIC_EXECUTABLE',
  dcf_valuation: 'DETERMINISTIC_EXECUTABLE',
  reverse_dcf_expectation_decode: 'DETERMINISTIC_EXECUTABLE',
  comps_valuation: 'DETERMINISTIC_EXECUTABLE',
  scenario_valuation: 'DETERMINISTIC_EXECUTABLE',
  thesis_red_team: 'SEMANTIC_EXECUTABLE',
  thesis_formalize: 'SEMANTIC_EXECUTABLE',
  expectation_gap: 'DETERMINISTIC_EXECUTABLE',
  catalyst_map: 'SEMANTIC_EXECUTABLE',
  thesis_refresh: 'SEMANTIC_EXECUTABLE',
}

const RUNTIME_BINDING_BY_ID: Readonly<Partial<Record<string, string>>> = {
  business_model_map: 'ResearchDispatchService session boundary: methodology + bounded captured result',
  business_driver_analysis: 'skills/business_driver_analysis/calculations.ts:calculateBusinessDriverAnalysis',
  unit_economics: 'skills/unit_economics/calculations.ts:calculateUnitEconomics',
  financial_quality_analysis: 'skills/financial_quality_analysis/calculations.ts:calculateFinancialQualityAnalysis',
  management_execution: 'skills/management_execution/calculations.ts:assessManagementExecution',
  capital_allocation_review: 'skills/capital_allocation_review/calculations.ts:assessCapitalAllocation',
  market_structure_analysis: 'skills/market_structure_analysis/calculations.ts:analyzeMarketStructure',
  industry_supply_demand_cycle: 'skills/industry_supply_demand_cycle/calculations.ts:analyzeIndustrySupplyDemandCycle',
  competitive_market_map: 'skills/competitive_market_map/calculations.ts:analyzeCompetitiveMarketMap',
  consensus_expectations_analysis: 'skills/earnings-review/expectations/consensus.ts:buildConsensusSnapshot',
  earnings_variance_analysis: 'skills/earnings-review/expectations/actual-vs-expectation.ts:compareActualToExpectation',
  guidance_analysis: 'skills/earnings-review/expectations/guidance.ts:buildGuidanceRevisionBridge',
  estimate_revision_analysis: 'skills/earnings-review/expectations/actual-vs-expectation.ts:buildEstimateRevisionBridge',
  dcf_valuation: 'skills/valuation/calculations/dcf.ts:calculateForwardDcf',
  reverse_dcf_expectation_decode: 'skills/valuation/calculations/dcf.ts:calculateReverseDcf',
  comps_valuation: 'skills/comps_valuation/skill.ts:executeCompsValuation',
  scenario_valuation: 'skills/valuation/financials.ts:calculateValuation',
  thesis_red_team: 'skills/thesis-red-team/skill.ts through Thesis Red Team Workflow',
  thesis_formalize: 'skills/thesis_formalize/semantic.ts:executeThesisFormalize -> calculations.ts:formalizeThesis',
  expectation_gap: 'skills/expectation_gap/calculations.ts:analyzeExpectationGap',
  catalyst_map: 'skills/catalyst_map/semantic.ts:executeCatalystMap -> calculations.ts:mapCatalysts',
  thesis_refresh: 'skills/thesis_refresh/semantic.ts:executeThesisRefresh -> calculations.ts:refreshThesis',
}

const REQUIREMENT_COVERAGE_BY_ID: Readonly<Partial<Record<string, SkillRequirementCoverage>>> = {
  consensus_expectations_analysis: 'PARTIAL',
  estimate_revision_analysis: 'PARTIAL',
  reverse_dcf_expectation_decode: 'PARTIAL',
  industry_supply_demand_cycle: 'PARTIAL',
}

const entry = (
  canonicalSkillId: string,
  domain: string,
  purpose: string,
  invocationMatch: string,
  inputs: readonly string[],
  produces: readonly string[],
  status: ResearchSkillCatalogStatus,
  runtimeRegistered: boolean,
  currentSource: string,
  currentOwner: string,
  migrationAction: string,
  notes: string,
): ResearchSkillCatalogEntry => ({ canonicalSkillId, domain, purpose, invocationMatch, inputs, produces, status, runtimeRegistered, currentSource, currentOwner, migrationAction, notes, executionClass: EXECUTION_CLASS_BY_ID[canonicalSkillId], runtimeBinding: RUNTIME_BINDING_BY_ID[canonicalSkillId], requirementCoverage: REQUIREMENT_COVERAGE_BY_ID[canonicalSkillId] ?? 'NONE', dataRequirements: [] })

const RESEARCH_SKILL_CATALOG_ENTRIES: readonly ResearchSkillCatalogEntry[] = [
  entry('document_change_analysis', 'Evidence', 'Identify attributable changes between two documents.', 'Use only when two comparable, attributable document versions are supplied; do not infer changes from one document.', ['prior document', 'current document', 'asOf', 'source refs'], ['change set', 'unchanged regions', 'gaps'], 'PLANNED', false, 'None', 'Future Wave', 'Implement a point-in-time document-diff method.', 'No runtime registration.'),
  entry('business_model_map', 'Company Economics', 'Explain how a company makes money and how its segments fit together.', 'Use for how-the-company-makes-money questions; do not use for consolidated driver attribution or unit economics.', ['company identity', 'segments/products', 'source refs', 'asOf'], ['business model map', 'segment relationships', 'source refs'], 'IMPLEMENTED', true, 'Company Research Business Model section', 'Company Research Workflow', 'Register the extracted bounded methodology.', 'The standalone contract preserves the existing evidence-only section boundary.'),
  entry('business_driver_analysis', 'Company Economics', 'Attribute consolidated revenue and profit changes to supplied business drivers.', 'Use for volume/price/mix/segment driver questions; do not use for a generic business model description.', ['period-aligned financials', 'segment/KPI data', 'source refs'], ['driver decomposition', 'contribution diagnostics', 'gaps'], 'IMPLEMENTED', true, 'skills/business_driver_analysis/calculations.ts', 'Company Research Workflow', 'Register the independently callable deterministic driver implementation.', 'Code owns period alignment, supported multiplicative pairs, additive contributions, and residuals.'),
  entry('unit_economics', 'Company Economics', 'Analyze a measurable underlying economic unit and its economics.', 'Use when the user names an economic unit such as customer, shipment, or site; do not use for consolidated financial drivers.', ['unit definition', 'unit counts', 'revenue/cost data', 'period', 'source refs'], ['unit metrics', 'cohort/trend diagnostics', 'gaps'], 'IMPLEMENTED', true, 'skills/unit_economics/calculations.ts', 'Company Economics Workflow', 'Register the independently callable deterministic unit-economics implementation.', 'Code owns explicit unit definition, aligned denominators, per-unit arithmetic, partial growth bridges, and operating leverage.'),
  entry('management_execution', 'Company Economics', 'Assess management execution against attributable prior commitments.', 'Use only when dated commitments and outcomes are supplied; do not infer execution quality from generic management prose.', ['dated commitments', 'outcomes', 'company identity', 'source refs'], ['commitment-to-outcome assessment', 'gaps'], 'IMPLEMENTED', true, 'skills/management_execution/calculations.ts', 'Company Economics Workflow', 'Register the bounded commitment-to-outcome implementation.', 'Code compares explicit numeric bounds; qualitative labels remain non-authoritative and fail closed without a deterministic predicate.'),
  entry('capital_allocation_review', 'Company Economics', 'Review capital allocation decisions and attributable outcomes.', 'Use for capital allocation questions with dated transaction and outcome evidence; do not treat a report heading as an implementation.', ['capital actions', 'financial context', 'outcomes', 'source refs'], ['allocation assessment', 'evidence map', 'gaps'], 'IMPLEMENTED', true, 'skills/capital_allocation_review/calculations.ts', 'Company Economics Workflow', 'Register the bounded capital metrics and action-specific value assessment.', 'Code gates value assessment to CapEx, acquisitions, and R&D with attributable return, hurdle, and subsequent-outcome evidence.'),
  entry('market_structure_analysis', 'Industry', 'Define the market boundary, participants, and structural relationships.', 'Use for market definition and structure questions; do not use for a full supply-demand cycle or competitive ranking.', ['industry target', 'scope', 'market evidence', 'asOf'], ['market boundary', 'participant map', 'gaps'], 'IMPLEMENTED', true, 'skills/market_structure_analysis/calculations.ts', 'Industry Workflow', 'Register the bounded market boundary, segmentation, sizing, and value-chain implementation.', 'Code preserves incomparable estimates and does not synthesize TAM.'),
  entry('industry_supply_demand_cycle', 'Industry', 'Assess industry capacity, demand, inventory, pricing, and cycle evidence.', 'Use for cycle/inflection questions only when the relevant series are supplied; do not fill missing inventory or pricing data.', ['industry target', 'capacity/demand series', 'inventory/pricing evidence', 'asOf', 'comparable periods'], ['cycle assessment', 'inflection diagnostics', 'gaps'], 'IMPLEMENTED', true, 'skills/industry_supply_demand_cycle/calculations.ts', 'Industry Workflow', 'Register the bounded cycle implementation.', 'Code distinguishes announced from effective capacity, keeps utilization level separate from direction, and requires comparable transitions for confirmed inflection.'),
  entry('competitive_market_map', 'Industry', 'Map competitors and relative positioning from attributable evidence.', 'Use for competitor landscape questions; do not infer market share or ranking without evidence.', ['industry target', 'competitor set', 'positioning evidence', 'asOf'], ['competitive map', 'positioning evidence', 'gaps'], 'IMPLEMENTED', true, 'skills/competitive_market_map/calculations.ts', 'Industry Workflow', 'Register the bounded competitive-map implementation.', 'Peer status requires explicit purchase-decision, workflow, economics, and customer-overlap evidence; whitespace keeps need separate from economics.'),
  entry('consensus_expectations_analysis', 'Earnings / Expectations', 'Describe the current point-in-time consensus state.', 'Use for current consensus questions; do not explain a reported beat or old-to-new estimate change.', ['metric', 'fiscal period', 'asOf', 'consensus observations', 'source refs'], ['qualified consensus state', 'PIT diagnostics', 'gaps'], 'IMPLEMENTED', true, 'skills/earnings-review/expectations/consensus.ts', 'Earnings Workflow', 'Register canonical methodology and preserve PIT gates.', 'Runtime methodology is independently invokable.'),
  entry('earnings_variance_analysis', 'Earnings / Expectations', 'Explain reported actual versus eligible expectation or prior comparable period.', 'Use for beat/miss and segment-driver questions; do not use for forward guidance changes.', ['actuals', 'prior actuals', 'consensus', 'segments/KPIs', 'source refs'], ['variance analysis', 'driver diagnostics', 'gaps'], 'IMPLEMENTED', true, 'skills/earnings-review/expectations/actual-vs-expectation.ts', 'Earnings Workflow', 'Register canonical methodology and collision tests.', 'Arithmetic remains code-owned.'),
  entry('guidance_analysis', 'Earnings / Expectations', 'Analyze current and prior forward management guidance.', 'Use for guidance level/change and guidance-vs-consensus questions; do not use for reported actual variance.', ['current/prior guidance', 'consensus', 'period', 'publication times', 'source refs'], ['guidance deltas', 'relationship labels', 'gaps'], 'IMPLEMENTED', true, 'skills/earnings-review/expectations/guidance.ts', 'Earnings Workflow', 'Register canonical methodology and preserve range rules.', 'Missing consensus remains unavailable.'),
  entry('earnings_call_analysis', 'Earnings / Expectations', 'Analyze transcript and Q&A content by speaker and topic.', 'Use only when an attributable transcript and Q&A are supplied; do not claim implementation from earnings filings alone.', ['transcript', 'speaker roles', 'Q&A', 'period', 'source refs'], ['call analysis', 'commentary deltas', 'gaps'], 'PLANNED', false, 'None', 'Future Wave', 'Implement transcript-specific method.', 'No transcript implementation exists.'),
  entry('estimate_revision_analysis', 'Earnings / Expectations', 'Describe old-to-new attributable estimate changes.', 'Use for estimate revision questions; do not use for the current consensus level alone.', ['old/new estimates', 'period', 'contributors', 'publication times', 'source refs'], ['revision deltas', 'direction diagnostics', 'gaps'], 'IMPLEMENTED', true, 'Earnings expectations revision integration', 'Earnings Workflow', 'Register canonical methodology and PIT links.', 'Pairing remains deterministic.'),
  entry('financial_quality_analysis', 'Financial', 'Assess earnings quality, accruals, working capital, and cash conversion from supplied facts.', 'Use when explicit quality inputs are supplied; do not infer quality from a report section or missing data.', ['period facts', 'cash flow', 'working capital', 'accruals', 'source refs'], ['quality metrics', 'diagnostics', 'gaps'], 'IMPLEMENTED', true, 'skills/financial_quality_analysis/calculations.ts plus Wave 1 deterministic calculations', 'Earnings, Company, and Thesis-related Workflows', 'Expose the canonical wrapper while preserving report-only output.', 'The independent wrapper owns the canonical result envelope and reuses existing deterministic calculations.'),
  entry('financial_model_build_update', 'Financial', 'Build or update a complete period-aligned forecast model.', 'Use only with a complete model contract and explicit assumptions; do not create a partial model from narrative.', ['historical series', 'assumptions', 'periods', 'source refs'], ['forecast model', 'assumption set', 'QC'], 'PLANNED', false, 'None', 'Future Wave', 'Implement a governed model contract.', 'No complete model implementation.'),
  entry('model_audit', 'Financial', 'Check model structure, inputs, formulas, and outputs for internal consistency.', 'Use when a structured model is supplied; do not audit a narrative report as though it were a model.', ['model graph', 'formulas', 'inputs', 'outputs'], ['audit findings', 'severity', 'repro steps'], 'PLANNED', false, 'None', 'Future Wave', 'Implement after model build/update exists.', 'No runtime registration.'),
  entry('dcf_valuation', 'Valuation', 'Calculate forward intrinsic value from explicit FCFF forecasts.', 'Use for forward intrinsic-value questions; do not use to decode what the current price implies.', ['FCFF forecast', 'WACC inputs', 'terminal growth', 'debt/cash/shares', 'source refs'], ['DCF result', 'EV-equity bridge', 'sensitivity', 'QC'], 'IMPLEMENTED', true, 'skills/valuation/calculations/dcf.ts, fcff.ts, discount-rate.ts', 'Valuation Workflow', 'Register canonical methodology; preserve product readiness gate.', 'Deterministic primitives are tested; product DCF remains explicitly deferred.'),
  entry('reverse_dcf_expectation_decode', 'Valuation', 'Decode future performance implied by current price or enterprise value.', 'Use for price-in expectation questions; do not use for forward intrinsic value from user forecasts.', ['price/EV', 'shares', 'debt/cash', 'FCFF forecast', 'discount/growth', 'source refs'], ['implied terminal FCFF/revenue/CAGR', 'assumption diagnostics'], 'IMPLEMENTED', true, 'skills/valuation/calculations/dcf.ts:calculateReverseDcf', 'Valuation Workflow', 'Register canonical methodology and routing collision tests.', 'Requires explicit positive terminal economics.'),
  entry('comps_valuation', 'Valuation', 'Calculate an attributable peer-set valuation comparison.', 'Use for comparable-company valuation, peer multiples, and peer-median implied value; do not use for price-implied growth.', ['bounded candidate peers', 'identity/evidence', 'period basis', 'target metrics', 'source refs'], ['accepted/rejected peers', 'multiple distributions', 'implied value', 'diagnostics'], 'IMPLEMENTED', true, 'skills/comps_valuation/skill.ts plus skills/valuation/calculations/comps.ts', 'Valuation Workflow / direct Skill execution', 'Promote the evidence-bound comparable valuation path.', 'Semantic peer candidates are validated before deterministic arithmetic; no synthetic peers or metrics.'),
  entry('scenario_valuation', 'Valuation', 'Calculate Bear/Base/Bull value from explicit assumptions.', 'Use for scenario and sensitivity questions; do not substitute defaults for missing assumptions.', ['valuation basis', 'method', 'three scenarios', 'target year', 'source refs'], ['scenario results', '9-cell sensitivity', 'QC'], 'IMPLEMENTED', true, 'skills/valuation/financials.ts', 'Valuation Workflow', 'Register canonical methodology and preserve code arithmetic.', 'Existing scenario engine is deterministic.'),
  entry('expectation_gap', 'Thesis', 'Locate disagreement between price-implied, consensus, management, and research expectations.', 'Use when the question asks where views differ; do not formalize or attack a thesis or invent an expectation.', ['expectation surfaces', 'metric/period/unit/basis', 'asOf', 'source or upstream refs'], ['comparable pair results', 'numeric gaps', 'gap propositions', 'gaps'], 'IMPLEMENTED', true, 'skills/expectation_gap/calculations.ts', 'Thesis Lifecycle Workflow', 'Register the bounded deterministic comparison implementation.', 'Code owns compatibility, arithmetic, range relationships, and no-material-gap behavior.'),
  entry('thesis_formalize', 'Thesis', 'State explicit thesis propositions, dependencies, evidence basis, and verification conditions.', 'Use to formalize a narrative thesis with bounded research context; do not perform adversarial testing, compare expectations, or mutate canonical Thesis state.', ['narrative thesis', 'bounded evidence', 'optional proposition hints', 'asOf'], ['semantic proposition candidates', 'acyclic dependencies', 'load-bearing refs', 'research gaps'], 'IMPLEMENTED', true, 'skills/thesis_formalize/semantic.ts plus calculations.ts', 'Thesis Lifecycle Workflow', 'Invoke the bounded semantic formalization and retain deterministic validation/normalization.', 'Reasoning proposes propositions; code validates refs, evidence basis, cycles, and derives load-bearing propositions.'),
  entry('thesis_red_team', 'Thesis', 'Adversarially test one active thesis with bounded evidence.', 'Use when the user asks where a thesis may be wrong or what would falsify it; do not run a full Thesis Lifecycle.', ['company', 'thesis ref', 'dependencies', 'signals', 'sources', 'lookback'], ['attack vectors', 'challenge assessments', 'bounded proposals', 'gaps'], 'IMPLEMENTED', true, 'skills/thesis-red-team/', 'Thesis Red Team Workflow', 'Normalize legacy path/ID and retain Workflow boundary.', 'Existing independent methodology and tests exist.'),
  entry('catalyst_map', 'Thesis', 'Map attributable events that could change a thesis.', 'Use for catalyst questions with explicit attributable event evidence; do not infer catalysts from generic news or stock direction.', ['formalized thesis propositions', 'expectation gaps', 'attributable event evidence', 'dates/status', 'source refs'], ['proposition-linked catalysts', 'timing/status', 'resolution mechanisms', 'gaps'], 'IMPLEMENTED', true, 'skills/catalyst_map/semantic.ts plus calculations.ts', 'Thesis Lifecycle Workflow', 'Invoke bounded event-to-proposition semantic mapping and retain deterministic validation.', 'Reasoning proposes mappings; code validates proposition/gap refs, timing provenance, status, and uncertainty.'),
  entry('thesis_refresh', 'Thesis', 'Assess what changed in an existing thesis since its prior review.', 'Use only with a prior thesis snapshot and new point-in-time evidence; do not formalize a new thesis or rewrite unaffected propositions.', ['prior thesis snapshot', 'new evidence without labels', 'priorAsOf/currentAsOf', 'kill criteria', 'source refs'], ['targeted proposition deltas', 'candidate transition', 'kill assessments', 'gaps'], 'IMPLEMENTED', true, 'skills/thesis_refresh/semantic.ts plus calculations.ts', 'Thesis Lifecycle Workflow', 'Invoke bounded evidence classification and retain deterministic PIT/no-drift/kill logic.', 'Reasoning classifies target and relation; code owns PIT filtering, targeted deltas, unchanged preservation, and sourced kill predicates.'),
]

const DATA_REQUIREMENTS_BY_SKILL: Readonly<Record<string, readonly SkillDataRequirement[]>> = {
  reverse_dcf_expectation_decode: [
    { id: 'market-price', kind: 'STATIC', metricId: 'valuation_market_price', dataKind: 'timeseries', determinismClass: 'AUTHORITATIVE_NUMERIC', minimumAuthority: 'S3_AGGREGATOR', requiredFields: ['date', 'close'], required: true },
  ],
  industry_supply_demand_cycle: [
    { id: 'capacity-evidence', kind: 'DOMAIN', domain: 'industry', semanticRole: 'supply', metricFamily: 'capacity', dataKind: 'timeseries', determinismClass: 'EVIDENCE_BACKED_NUMERIC', required: false },
    { id: 'demand-evidence', kind: 'DOMAIN', domain: 'industry', semanticRole: 'demand', metricFamily: 'demand', dataKind: 'timeseries', determinismClass: 'EVIDENCE_BACKED_NUMERIC', required: false },
    { id: 'inventory-evidence', kind: 'DOMAIN', domain: 'industry', semanticRole: 'inventory', metricFamily: 'inventory', dataKind: 'timeseries', determinismClass: 'EVIDENCE_BACKED_NUMERIC', required: false },
    { id: 'pricing-evidence', kind: 'DOMAIN', domain: 'industry', semanticRole: 'pricing', metricFamily: 'pricing', dataKind: 'timeseries', determinismClass: 'EVIDENCE_BACKED_NUMERIC', required: false },
    { id: 'utilization-evidence', kind: 'DOMAIN', domain: 'industry', semanticRole: 'utilization', metricFamily: 'utilization', dataKind: 'timeseries', determinismClass: 'EVIDENCE_BACKED_NUMERIC', required: false },
  ],
}

export const CANONICAL_RESEARCH_SKILL_CATALOG: readonly ResearchSkillCatalogEntry[] = RESEARCH_SKILL_CATALOG_ENTRIES.map((item) => ({
  ...item,
  dataRequirements: Object.freeze((DATA_REQUIREMENTS_BY_SKILL[item.canonicalSkillId] ?? []).map((requirement) => Object.freeze({ ...requirement, ...(requirement.requiredFields ? { requiredFields: Object.freeze([...requirement.requiredFields]) } : {}) }))),
}))

export const CANONICAL_RESEARCH_SKILL_IDS = new Set(CANONICAL_RESEARCH_SKILL_CATALOG.map((item) => item.canonicalSkillId))
export const RUNTIME_CANONICAL_RESEARCH_SKILLS = CANONICAL_RESEARCH_SKILL_CATALOG.filter((item) => item.runtimeRegistered)

export function getCanonicalResearchSkill(id: string): ResearchSkillCatalogEntry | undefined {
  return CANONICAL_RESEARCH_SKILL_CATALOG.find((item) => item.canonicalSkillId === id)
}

export function canonicalResearchSkillMdPath(id: string): string {
  if (!CANONICAL_RESEARCH_SKILL_IDS.has(id)) throw new Error(`Unknown canonical Research Skill: ${id}`)
  return pathFor(id)
}
