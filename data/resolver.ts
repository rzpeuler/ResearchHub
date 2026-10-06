import type { AcquisitionResult, DataRequirement, SourceAuthority } from './contracts.ts'
import { COMMON_DATA_CATALOG, createCommonDataCatalog, type CommonDataDefinition } from './common-catalog.ts'
import type { IndustryDataCatalog } from './industry-catalog.ts'
import { materializeSkillDataRequirements, type DataRequirementRuntimeContext, type MaterializedDataRequirements, type SkillDataRequirement } from './requirements.ts'
import { runResearchDataAcquisition, type ResearchDataAcquisitionOptions } from './workflow.ts'

export interface ResolvedDataItem<T> {
  readonly requirementId: string
  readonly dataKind: DataRequirement['dataKind']
  readonly metricId?: string
  readonly period?: DataRequirement['period']
  readonly status: AcquisitionResult<T>['status']
  readonly value?: T
  readonly source: AcquisitionResult<T>['source']
  readonly sources?: AcquisitionResult<T>['sources']
  readonly authority?: SourceAuthority
  readonly required: boolean
  readonly quality: AcquisitionResult<T>['quality']
  readonly attempts: AcquisitionResult<T>['attempts']
  readonly unavailableReason?: AcquisitionResult<T>['unavailableReason']
  readonly fallbackReason?: string
  readonly crossCheckStatus?: AcquisitionResult<T>['crossCheckStatus']
  /** Retains observations, conflicts, and low-level acquisition detail. */
  readonly acquisition: AcquisitionResult<T>
}

export interface ResolvedDataBundle<T> {
  readonly items: readonly ResolvedDataItem<T>[]
  readonly requiredUnresolved: readonly ResolvedDataItem<T>[]
  readonly optionalUnresolved: readonly ResolvedDataItem<T>[]
  readonly completeness: 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE'
}

export interface DataResolverOptions<T> extends Omit<ResearchDataAcquisitionOptions<T>, 'requirement'> {
  readonly resolveAcquisition?: (requirement: DataRequirement) => Promise<AcquisitionResult<T>>
  readonly commonCatalog?: ReadonlyMap<string, CommonDataDefinition>
  readonly industryCatalog?: IndustryDataCatalog
}

export interface ResolvedSkillDataBundle<T> extends ResolvedDataBundle<T> {
  readonly unresolvedRequirements: MaterializedDataRequirements['unresolved']
}

export class DataResolver<T> {
  private readonly commonCatalog: ReadonlyMap<string, CommonDataDefinition>

  constructor(private readonly options: DataResolverOptions<T>) {
    this.commonCatalog = options.commonCatalog ?? createCommonDataCatalog(COMMON_DATA_CATALOG)
  }

  async resolveOne(requirement: DataRequirement): Promise<ResolvedDataItem<T>> {
    const { resolveAcquisition, commonCatalog: _commonCatalog, industryCatalog: _industryCatalog, ...acquisitionOptions } = this.options
    if (requirement.metricId?.startsWith('industry:')) {
      const definition = this.options.industryCatalog?.get(requirement.metricId)
      const associatedPolicyIds = new Set(definition?.lifecycleStatus === 'CANONICAL'
        ? definition.sourcePolicies.map((reference) => reference.policyId)
        : [])
      const policies = acquisitionOptions.policies.filter((policy) => associatedPolicyIds.has(policy.policyId))
      // Industry identities require an explicit canonical definition and
      // their attached policy IDs. The injected generic test seam cannot
      // override that catalog boundary.
      const acquisition = await runResearchDataAcquisition({ ...acquisitionOptions, policies, requirement })
      return toResolvedDataItem(requirement, acquisition)
    }
    const acquisition = await (resolveAcquisition?.(requirement)
      ?? runResearchDataAcquisition({ ...acquisitionOptions, requirement }))
    return toResolvedDataItem(requirement, acquisition)
  }

  async resolve(requirements: readonly DataRequirement[]): Promise<ResolvedDataBundle<T>> {
    const items = await Promise.all(requirements.map((requirement) => this.resolveOne(requirement)))
    const requiredUnresolved = items.filter((item) => item.required && item.status !== 'AVAILABLE')
    const optionalUnresolved = items.filter((item) => !item.required && item.status !== 'AVAILABLE')
    const completeness = requiredUnresolved.length === 0
      ? (optionalUnresolved.length === 0 ? 'COMPLETE' : 'PARTIAL')
      : (items.some((item) => item.status !== 'UNAVAILABLE') ? 'PARTIAL' : 'UNAVAILABLE')
    return { items, requiredUnresolved, optionalUnresolved, completeness }
  }

  async resolveSkillRequirements(
    skillId: string,
    templates: readonly SkillDataRequirement[],
    context: DataRequirementRuntimeContext,
  ): Promise<ResolvedSkillDataBundle<T>> {
    const materialized = materializeSkillDataRequirements(skillId, templates, context, this.options.industryCatalog, this.commonCatalog)
    const bundle = await this.resolve(materialized.requirements)
    const hasRequiredCatalogGap = materialized.unresolved.some((item) => item.required)
    const hasOptionalCatalogGap = materialized.unresolved.some((item) => !item.required)
    const hasUsableResolvedData = bundle.items.some((item) =>
      (item.status === 'AVAILABLE' || item.status === 'PARTIAL')
      && (item.value !== undefined || item.acquisition.observations?.some((observation) => observation.data !== undefined) === true))
    const completeness = hasRequiredCatalogGap
      ? (hasUsableResolvedData ? 'PARTIAL' : 'UNAVAILABLE')
      : (bundle.completeness === 'UNAVAILABLE'
        ? 'UNAVAILABLE'
        : (hasOptionalCatalogGap ? 'PARTIAL' : bundle.completeness))
    return { ...bundle, completeness, unresolvedRequirements: materialized.unresolved }
  }
}

function toResolvedDataItem<T>(requirement: DataRequirement, acquisition: AcquisitionResult<T>): ResolvedDataItem<T> {
  return {
    requirementId: requirement.id,
    dataKind: requirement.dataKind,
    ...(requirement.metricId ? { metricId: requirement.metricId } : {}),
    ...(requirement.period ? { period: requirement.period } : {}),
    required: requirement.required ?? true,
    status: acquisition.status,
    ...(acquisition.data !== undefined ? { value: acquisition.data } : {}),
    source: acquisition.source,
    ...(acquisition.sources ? { sources: acquisition.sources } : {}),
    ...(acquisition.source ? { authority: acquisition.source.originAuthority } : {}),
    quality: acquisition.quality,
    attempts: acquisition.attempts,
    ...(acquisition.unavailableReason ? { unavailableReason: acquisition.unavailableReason } : {}),
    ...(acquisition.fallbackReason ? { fallbackReason: acquisition.fallbackReason } : {}),
    ...(acquisition.crossCheckStatus ? { crossCheckStatus: acquisition.crossCheckStatus } : {}),
    acquisition,
  }
}
