import { readFile, stat } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildConsensusSnapshot } from '../../skills/earnings-review/expectations/consensus.ts'
import { compareActualToExpectation, buildEstimateRevisionBridge } from '../../skills/earnings-review/expectations/actual-vs-expectation.ts'
import { buildGuidanceRevisionBridge } from '../../skills/earnings-review/expectations/guidance.ts'
import { calculateForwardDcf, calculateReverseDcf } from '../../skills/valuation/calculations/dcf.ts'
import { calculateValuation } from '../../skills/valuation/financials.ts'
import { executeCompsValuation } from '../../skills/comps_valuation/skill.ts'
import { calculateBusinessDriverAnalysis } from '../../skills/business_driver_analysis/calculations.ts'
import { calculateUnitEconomics } from '../../skills/unit_economics/calculations.ts'
import { calculateFinancialQualityAnalysis } from '../../skills/financial_quality_analysis/calculations.ts'
import { assessManagementExecution } from '../../skills/management_execution/calculations.ts'
import { assessCapitalAllocation } from '../../skills/capital_allocation_review/calculations.ts'
import { analyzeMarketStructure } from '../../skills/market_structure_analysis/calculations.ts'
import { analyzeIndustrySupplyDemandCycle } from '../../skills/industry_supply_demand_cycle/calculations.ts'
import { analyzeCompetitiveMarketMap } from '../../skills/competitive_market_map/calculations.ts'
import { analyzeExpectationGap } from '../../skills/expectation_gap/calculations.ts'
import { canonicalResearchSkillMdPath, CANONICAL_RESEARCH_SKILL_IDS, getCanonicalResearchSkill, REQUIRED_RESEARCH_SKILL_SECTIONS, RUNTIME_CANONICAL_RESEARCH_SKILLS, type ResearchSkillCatalogStatus, type ResearchSkillExecutionClass } from './research-skill-catalog.ts'
import type { SkillDataRequirement } from '../../data/requirements.ts'
import type { SkillRequirementCoverage } from './research-skill-catalog.ts'

export type ResearchHubSkillKind = 'research' | 'knowledge' | 'utility'
export type ResearchSkillOrigin = 'canonical' | 'external'
export type ResearchSkillRuntimeExecutor = (input: unknown) => unknown | Promise<unknown>

export interface ResearchSkillMethodologySource {
  readonly type: 'researchhub_skill'
  readonly path: string
}

export interface ResearchSkillDefinition {
  readonly id: string
  readonly kind: ResearchHubSkillKind
  readonly researchCapability?: string
  readonly purpose?: string
  readonly invocationMatch?: string
  readonly inputs?: readonly string[]
  readonly produces?: readonly string[]
  readonly intentDescription: string
  readonly whenToUse: string
  readonly inputSchema?: Readonly<Record<string, unknown>>
  readonly outputContract?: string
  readonly methodologySource?: ResearchSkillMethodologySource
  readonly skillMdPath?: string
  readonly catalogStatus?: ResearchSkillCatalogStatus
  readonly executionClass?: ResearchSkillExecutionClass
  readonly runtimeBinding?: string
  readonly requirementCoverage?: SkillRequirementCoverage
  readonly dataRequirements?: readonly SkillDataRequirement[]
  readonly runtimeExecutor?: ResearchSkillRuntimeExecutor
  readonly origin?: ResearchSkillOrigin
  readonly enabled: boolean
  readonly scope: 'researchhub'
}

function canonicalDefinition(id: string): ResearchSkillDefinition {
  const metadata = getCanonicalResearchSkill(id)
  if (metadata === undefined || !metadata.runtimeRegistered || metadata.status !== 'IMPLEMENTED') throw new Error(`Cannot register non-runtime canonical Research Skill: ${id}`)
  const skillMdPath = canonicalResearchSkillMdPath(id)
  const runtimeExecutor = CANONICAL_RUNTIME_EXECUTORS[id]
  return {
    id,
    kind: 'research',
    researchCapability: id,
    purpose: metadata.purpose,
    invocationMatch: metadata.invocationMatch,
    inputs: metadata.inputs,
    produces: metadata.produces,
    intentDescription: metadata.purpose,
    whenToUse: metadata.invocationMatch,
    outputContract: metadata.produces.join(', '),
    methodologySource: { type: 'researchhub_skill', path: skillMdPath },
    skillMdPath,
    catalogStatus: metadata.status,
    executionClass: metadata.executionClass,
    runtimeBinding: metadata.runtimeBinding,
    requirementCoverage: metadata.requirementCoverage,
    dataRequirements: metadata.dataRequirements,
    ...(runtimeExecutor === undefined ? {} : { runtimeExecutor }),
    origin: 'canonical',
    enabled: true,
    scope: 'researchhub',
  }
}

const CANONICAL_RUNTIME_EXECUTORS: Readonly<Partial<Record<string, ResearchSkillRuntimeExecutor>>> = {
  business_driver_analysis: (input) => calculateBusinessDriverAnalysis(input as Parameters<typeof calculateBusinessDriverAnalysis>[0]),
  unit_economics: (input) => calculateUnitEconomics(input as Parameters<typeof calculateUnitEconomics>[0]),
  financial_quality_analysis: (input) => calculateFinancialQualityAnalysis(input as Parameters<typeof calculateFinancialQualityAnalysis>[0]),
  management_execution: (input) => assessManagementExecution(input as Parameters<typeof assessManagementExecution>[0]),
  capital_allocation_review: (input) => assessCapitalAllocation(input as Parameters<typeof assessCapitalAllocation>[0]),
  market_structure_analysis: (input) => analyzeMarketStructure(input as Parameters<typeof analyzeMarketStructure>[0]),
  industry_supply_demand_cycle: (input) => analyzeIndustrySupplyDemandCycle(input as Parameters<typeof analyzeIndustrySupplyDemandCycle>[0]),
  competitive_market_map: (input) => analyzeCompetitiveMarketMap(input as Parameters<typeof analyzeCompetitiveMarketMap>[0]),
  consensus_expectations_analysis: (input) => buildConsensusSnapshot(input as Parameters<typeof buildConsensusSnapshot>[0]),
  earnings_variance_analysis: (input) => {
    const value = input as Parameters<typeof compareActualToExpectation>[0]
    return compareActualToExpectation(value)
  },
  guidance_analysis: (input) => buildGuidanceRevisionBridge(input as Parameters<typeof buildGuidanceRevisionBridge>[0]),
  estimate_revision_analysis: (input) => buildEstimateRevisionBridge(input as Parameters<typeof buildEstimateRevisionBridge>[0]),
  dcf_valuation: (input) => calculateForwardDcf(input as Parameters<typeof calculateForwardDcf>[0]),
  reverse_dcf_expectation_decode: (input) => calculateReverseDcf(input as Parameters<typeof calculateReverseDcf>[0]),
  comps_valuation: (input) => executeCompsValuation(input as Parameters<typeof executeCompsValuation>[0]),
  scenario_valuation: (input) => {
    const value = input as { readonly basis: Parameters<typeof calculateValuation>[0]; readonly plan: Parameters<typeof calculateValuation>[1]; readonly eligibleMethods: Parameters<typeof calculateValuation>[2] }
    return calculateValuation(value.basis, value.plan, value.eligibleMethods)
  },
  expectation_gap: (input) => analyzeExpectationGap(input as Parameters<typeof analyzeExpectationGap>[0]),
}

const CORE_SKILLS: readonly ResearchSkillDefinition[] = [
  ...RUNTIME_CANONICAL_RESEARCH_SKILLS.map((item) => canonicalDefinition(item.canonicalSkillId)),
  { id: 'theme-framework', kind: 'knowledge', intentDescription: 'Construct an evidence-backed initial Industry network for an explicitly named Theme.', whenToUse: 'Use only through the theme_framework Workflow when the user asks to initialize or build a Theme Framework; submit all candidates for human review before canonical persistence.', inputs: ['name', 'optional definition', 'current Knowledge snapshot', 'bounded retained evidence'], produces: ['Industry and Relation candidates', 'include/exclude/pending recommendations', 'boundary rationales and coverage gaps'], enabled: true, scope: 'researchhub' },
  { id: 'knowledge-curation', kind: 'knowledge', intentDescription: 'Knowledge extraction and semantic resolution.', whenToUse: 'Use only inside governed Knowledge Production.', outputContract: 'Validated Knowledge candidates', enabled: true, scope: 'researchhub' },
]

function cloneDataRequirements(requirements: readonly SkillDataRequirement[] | undefined): readonly SkillDataRequirement[] | undefined {
  if (requirements === undefined) return undefined
  return Object.freeze(requirements.map((requirement) => Object.freeze({
    ...requirement,
    ...(requirement.requiredFields === undefined ? {} : { requiredFields: Object.freeze([...requirement.requiredFields]) }),
  })))
}

function clone(definition: ResearchSkillDefinition): ResearchSkillDefinition {
  return { ...definition, ...(definition.inputs === undefined ? {} : { inputs: [...definition.inputs] }), ...(definition.produces === undefined ? {} : { produces: [...definition.produces] }), ...(definition.dataRequirements === undefined ? {} : { dataRequirements: cloneDataRequirements(definition.dataRequirements) }), ...(definition.inputSchema === undefined ? {} : { inputSchema: JSON.parse(JSON.stringify(definition.inputSchema)) as Readonly<Record<string, unknown>> }) }
}

function normalize(definition: ResearchSkillDefinition): ResearchSkillDefinition {
  const origin = definition.origin ?? (CANONICAL_RESEARCH_SKILL_IDS.has(definition.id) ? 'canonical' : 'external')
  const purpose = definition.purpose?.trim() || definition.intentDescription.trim()
  const invocationMatch = definition.invocationMatch?.trim() || definition.whenToUse.trim()
  const inputs = definition.inputs === undefined ? Object.keys(definition.inputSchema ?? {}).sort() : [...definition.inputs]
  const produces = definition.produces === undefined ? [definition.outputContract?.trim() || 'ResearchBundle'] : [...definition.produces]
  return { ...definition, purpose, invocationMatch, inputs, produces, ...(definition.dataRequirements === undefined ? {} : { dataRequirements: cloneDataRequirements(definition.dataRequirements) }), origin, ...(origin === 'canonical' ? { skillMdPath: definition.skillMdPath ?? definition.methodologySource?.path } : {}) }
}

function contractDiagnostics(definition: ResearchSkillDefinition): readonly string[] {
  const errors: string[] = []
  if (!definition.purpose?.trim()) errors.push('purpose_missing')
  if (!definition.invocationMatch?.trim()) errors.push('invocation_match_missing')
  if (definition.inputs === undefined || definition.inputs.length === 0) errors.push('inputs_missing')
  if (definition.produces === undefined || definition.produces.length === 0) errors.push('produces_missing')
  if (definition.origin === 'canonical') {
    if (definition.catalogStatus !== 'IMPLEMENTED') errors.push('canonical_skill_not_implemented')
    if (definition.executionClass === undefined) errors.push('execution_class_missing')
    if (!definition.runtimeBinding?.trim()) errors.push('runtime_binding_missing')
    if (definition.executionClass === 'DETERMINISTIC_EXECUTABLE' && typeof definition.runtimeExecutor !== 'function') errors.push('deterministic_runtime_executor_missing')
    if (definition.executionClass === 'NOT_INDEPENDENTLY_EXECUTABLE') errors.push('canonical_skill_not_independently_executable')
    if (definition.skillMdPath === undefined) errors.push('skill_md_path_missing')
    else {
      try {
        const text = readFileSync(definition.skillMdPath, 'utf8')
        for (const section of REQUIRED_RESEARCH_SKILL_SECTIONS) {
          const escaped = section.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')
          if (!new RegExp(`^##\\s+${escaped}\\s*$`, 'mi').test(text)) errors.push(`skill_md_section_missing:${section}`)
        }
      } catch { errors.push('skill_md_unreadable') }
    }
  }
  return errors
}

export function validateResearchSkillDefinition(definition: ResearchSkillDefinition): void {
  const errors = contractDiagnostics(normalize(definition))
  if (errors.length > 0) throw new Error(`Invalid Research Skill definition ${definition.id}: ${errors.join(', ')}`)
}

export interface LoadedResearchSkill extends ResearchSkillDefinition {
  readonly methodology: string
}

export async function loadResearchSkillMethodology(definition: ResearchSkillDefinition, maxBytes = 64_000): Promise<LoadedResearchSkill> {
  const normalized = normalize(definition)
  if (normalized.kind !== 'research' || normalized.methodologySource?.type !== 'researchhub_skill') throw new Error(`Research Skill methodology source is unavailable: ${definition.id}`)
  const sourcePath = resolve(normalized.methodologySource.path)
  const metadata = await stat(sourcePath)
  if (!metadata.isFile() || metadata.size === 0 || metadata.size > maxBytes) throw new Error(`Research Skill methodology is missing or exceeds ${maxBytes} bytes: ${definition.id}`)
  const methodology = (await readFile(sourcePath, 'utf8')).trim()
  if (methodology === '') throw new Error(`Research Skill methodology is empty: ${definition.id}`)
  return { ...clone(normalized), methodology }
}

export class ResearchSkillRegistry {
  private readonly definitions = new Map<string, ResearchSkillDefinition>()

  constructor(definitions: readonly ResearchSkillDefinition[] = CORE_SKILLS) {
    for (const definition of definitions) this.register(definition)
  }

  register(input: ResearchSkillDefinition): void {
    const definition = normalize(input)
    if (definition.scope !== 'researchhub') throw new Error(`Only ResearchHub skills may enter this registry: ${definition.id}`)
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(definition.id)) throw new Error(`Unsafe Skill definition ID: ${definition.id}`)
    if (this.definitions.has(definition.id)) throw new Error(`Duplicate Skill definition: ${definition.id}`)
    if (!definition.intentDescription.trim() || !definition.whenToUse.trim()) throw new Error(`Incomplete Skill definition: ${definition.id}`)
    if (definition.origin === 'canonical') validateResearchSkillDefinition(definition)
    this.definitions.set(definition.id, clone(definition))
  }

  get(id: string): ResearchSkillDefinition | undefined {
    const value = this.definitions.get(id)
    return value === undefined ? undefined : clone(value)
  }

  list(): readonly ResearchSkillDefinition[] {
    return [...this.definitions.values()].sort((left, right) => left.id.localeCompare(right.id)).map(clone)
  }

  researchCandidates(): readonly ResearchSkillDefinition[] {
    return this.list().filter((definition) => definition.enabled && definition.kind === 'research')
  }

  canonicalResearchCandidates(): readonly ResearchSkillDefinition[] {
    return this.researchCandidates().filter((definition) => definition.origin === 'canonical')
  }
}

export function createResearchSkillRegistry(): ResearchSkillRegistry {
  return new ResearchSkillRegistry()
}
