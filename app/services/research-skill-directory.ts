import type { SkillDataRequirement } from '../../data/requirements.ts'
import { getCanonicalResearchSkill, type ResearchSkillExecutionClass } from './research-skill-catalog.ts'
import { loadResearchSkillMethodology, type ResearchSkillDefinition, type ResearchSkillOrigin, type ResearchSkillRegistry } from './skill-registry.ts'

/** Safe, presentation-only projection of a registered Research Skill. */
export interface ResearchSkillSummary {
  readonly id: string
  readonly domain?: string
  readonly purpose: string
  readonly invocationMatch: string
  readonly inputs: readonly string[]
  readonly produces: readonly string[]
  readonly executionClass?: ResearchSkillExecutionClass
  readonly origin: ResearchSkillOrigin
}

/** Detail projection adds only selected-skill methodology and data requirements. */
export interface ResearchSkillDetail extends ResearchSkillSummary {
  readonly dataRequirements?: readonly SkillDataRequirement[]
  readonly methodology: string
}

function summary(definition: ResearchSkillDefinition): ResearchSkillSummary {
  const canonical = definition.origin === 'canonical' ? getCanonicalResearchSkill(definition.id) : undefined
  return {
    id: definition.id,
    ...(canonical === undefined ? {} : { domain: canonical.domain }),
    purpose: definition.purpose ?? definition.intentDescription,
    invocationMatch: definition.invocationMatch ?? definition.whenToUse,
    inputs: [...(definition.inputs ?? [])],
    produces: [...(definition.produces ?? [])],
    ...(definition.executionClass === undefined ? {} : { executionClass: definition.executionClass }),
    origin: definition.origin ?? 'external',
  }
}

export class ResearchSkillDirectoryService {
  constructor(private readonly registry: ResearchSkillRegistry) {}

  list(): readonly ResearchSkillSummary[] {
    return this.registry.researchCandidates().map(summary).sort((left, right) => left.id.localeCompare(right.id))
  }

  async get(id: string): Promise<ResearchSkillDetail | undefined> {
    const definition = this.registry.get(id)
    if (definition === undefined || !definition.enabled || definition.kind !== 'research') return undefined
    // The methodology loader enforces the registry's approved source and bounded file size.
    const loaded = await loadResearchSkillMethodology(definition)
    const projected = summary(definition)
    return {
      ...projected,
      ...(definition.dataRequirements === undefined ? {} : { dataRequirements: definition.dataRequirements.map((requirement) => ({ ...requirement })) }),
      methodology: loaded.methodology,
    }
  }
}
