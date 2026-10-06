import type { DataDeterminismClass, DataRequirement, DataRequirementKind, SourceAuthority } from './contracts.ts'
import { COMMON_DATA_CATALOG, createCommonDataCatalog, type CommonDataDefinition } from './common-catalog.ts'
import type { IndustryDataCatalog } from './industry-catalog.ts'

interface SkillDataRequirementBase {
  readonly id: string
  readonly required: boolean
  readonly dataKind: DataRequirementKind
  readonly determinismClass: DataDeterminismClass
  readonly minimumAuthority?: SourceAuthority
  readonly requiredFields?: readonly string[]
}

export interface StaticSkillDataRequirement extends SkillDataRequirementBase {
  readonly kind: 'STATIC'
  readonly metricId: string
}

export interface IndustryDomainDataRequirement extends SkillDataRequirementBase {
  readonly kind: 'DOMAIN'
  readonly domain: 'industry'
  readonly semanticRole?: string
  readonly metricFamily?: string
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
    readonly reason: 'COMMON_DATA_DEFINITION_REQUIRED' | 'COMMON_DATA_KIND_MISMATCH' | 'INDUSTRY_ID_REQUIRED' | 'NO_CANONICAL_INDUSTRY_METRIC' | 'INDUSTRY_DATA_KIND_MISMATCH'
  }[]
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
      asOf: context.asOf,
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
    const matches = industryCatalog?.resolve(industryId, template.semanticRole, template.metricFamily) ?? []
    if (matches.length === 0) {
      unresolved.push({ templateId: template.id, required: template.required, reason: 'NO_CANONICAL_INDUSTRY_METRIC' })
      continue
    }
    const compatibleMatches = matches.filter((definition) => definition.dataKind === template.dataKind)
    if (compatibleMatches.length === 0) {
      unresolved.push({ templateId: template.id, required: template.required, reason: 'INDUSTRY_DATA_KIND_MISMATCH' })
      continue
    }
    if (compatibleMatches.length !== matches.length) {
      unresolved.push({ templateId: template.id, required: template.required, reason: 'INDUSTRY_DATA_KIND_MISMATCH' })
    }
    for (const definition of compatibleMatches) {
      requirements.push({
        ...base,
        id: `${skillId}:${template.id}:${definition.metricId}`,
        dataKind: template.dataKind,
        metricId: definition.metricId,
        metricFamily: definition.metricFamily,
      })
    }
  }
  return { requirements, unresolved }
}
