import type { DataRequirementKind } from './contracts.ts'

export type IndustryMetricLifecycleStatus = 'DISCOVERED' | 'VALIDATED' | 'CANONICAL'
export type IndustryPeriodBasis = 'PERIOD' | 'YTD' | 'POINT_IN_TIME'
export type IndustryMetricQualifier = 'EXACT' | 'LOWER_BOUND' | 'UPPER_BOUND'

export interface IndustryIdentity {
  readonly industryId: string
  readonly aliases: readonly string[]
}

export const INDUSTRY_IDENTITIES: readonly IndustryIdentity[] = Object.freeze([
  Object.freeze({ industryId: 'lithium_battery', aliases: Object.freeze(['锂离子电池', '锂电池', 'lithium-ion battery', 'lithium-ion batteries', 'lithium battery']) }),
  Object.freeze({ industryId: 'household_air_conditioner', aliases: Object.freeze(['家用空调', '房间空气调节器', 'household air conditioner', 'room air conditioner']) }),
])

export type IndustryIdentityResolution =
  | { readonly status: 'RESOLVED'; readonly industryId: string }
  | { readonly status: 'UNRESOLVED' | 'AMBIGUOUS'; readonly input: string; readonly candidateIndustryIds: readonly string[] }

function normalizeAlias(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US')
}

export function resolveIndustryIdentity(input: string, catalog: readonly IndustryIdentity[] = INDUSTRY_IDENTITIES): IndustryIdentityResolution {
  const normalized = normalizeAlias(input)
  const matches = catalog.filter((identity) => identity.aliases.some((alias) => normalizeAlias(alias) === normalized))
  const candidateIndustryIds = [...new Set(matches.map((identity) => identity.industryId))].sort((left, right) => left.localeCompare(right))
  if (candidateIndustryIds.length === 1) return { status: 'RESOLVED', industryId: candidateIndustryIds[0]! }
  if (candidateIndustryIds.length > 1) return { status: 'AMBIGUOUS', input, candidateIndustryIds }
  return { status: 'UNRESOLVED', input, candidateIndustryIds: [] }
}

export interface IndustrySourcePolicyReference {
  readonly policyId: string
  readonly metricFamily?: string
}

export interface IndustryUnitConversion {
  readonly sourceUnit: string
  readonly targetUnit: string
  readonly conversionId: string
}

export interface IndustryMetricPitPolicy {
  readonly publicationPit: 'REQUIRED' | 'OPTIONAL'
  readonly valueVersionPit: 'REQUIRED_FOR_HISTORICAL' | 'UNVERIFIED_CURRENT_VALUE_ONLY'
}

export type IndustryMetricValidationCheck = 'SEMANTIC' | 'UNIT' | 'PERIOD' | 'SCOPE' | 'PIT' | 'EXTRACTION' | 'ACCEPTANCE'

export interface IndustryMetricValidation {
  readonly validatedAt: string
  readonly validator: string
  readonly methodology: string
  readonly sourceabilityEvidence: readonly string[]
  readonly checks?: Partial<Readonly<Record<IndustryMetricValidationCheck, readonly string[]>>>
}

export interface IndustryMetricDefinition {
  /** Must be namespaced as `industry:<industryId>:<local-id>`. */
  readonly metricId: string
  /** Stable namespace key, for example `lithium_battery`. */
  readonly industryId: string
  readonly metricFamily: string
  readonly semanticRole: string
  readonly name: string
  readonly description: string
  readonly dataKind: DataRequirementKind
  /** Legacy display field; canonical definitions use `canonicalUnit`. */
  readonly unit?: string
  readonly canonicalUnit?: string
  readonly acceptedSourceUnits?: readonly string[]
  readonly unitConversions?: readonly IndustryUnitConversion[]
  /** Legacy display field; canonical definitions use `frequency` and `periodBasis`. */
  readonly periodicity?: string
  readonly frequency?: string
  readonly periodBasis?: IndustryPeriodBasis
  readonly aggregation?: 'SUM' | 'AVERAGE' | 'END_OF_PERIOD' | 'NONE'
  readonly geography?: string
  readonly applicability?: string
  readonly product?: string
  readonly segment?: string
  readonly grade?: string
  readonly requiredQualifiers?: readonly IndustryMetricQualifier[]
  readonly pitPolicy?: IndustryMetricPitPolicy
  readonly lifecycleStatus: IndustryMetricLifecycleStatus
  readonly sourcePolicies: readonly IndustrySourcePolicyReference[]
  readonly discoveredFrom?: string
  readonly validation?: IndustryMetricValidation
}

export interface IndustryMetricTransitionEvidence extends IndustryMetricValidation {}

export type ExactIndustryMetricResolution =
  | { readonly status: 'MATCHED'; readonly definition: IndustryMetricDefinition; readonly incompatibleMetricIds?: readonly string[] }
  | { readonly status: 'NO_CANONICAL_INDUSTRY_METRIC' }
  | { readonly status: 'INDUSTRY_DATA_KIND_MISMATCH'; readonly candidateMetricIds: readonly string[] }
  | { readonly status: 'AMBIGUOUS_CANONICAL_INDUSTRY_METRIC'; readonly candidateMetricIds: readonly string[] }

export interface IndustryDataCatalog {
  list(industryId?: string): readonly IndustryMetricDefinition[]
  get(metricId: string): IndustryMetricDefinition | undefined
  resolve(industryId: string, semanticRole?: string, metricFamily?: string): readonly IndustryMetricDefinition[]
  resolveExact(industryId: string, semanticRole: string, metricFamily: string, dataKind: DataRequirementKind): ExactIndustryMetricResolution
  registerDiscovered(definition: IndustryMetricDefinition): IndustryMetricDefinition
  associateSourcePolicy(metricId: string, reference: IndustrySourcePolicyReference): IndustryMetricDefinition
  transition(metricId: string, next: IndustryMetricLifecycleStatus, evidence?: IndustryMetricTransitionEvidence): IndustryMetricDefinition
}

export function industryMetricId(industryId: string, localId: string): string {
  return `industry:${industryId}:${localId}`
}

function nonEmpty(values: readonly string[] | undefined): boolean {
  return Boolean(values?.length && values.every((value) => value.trim() !== ''))
}

function hasDefinitionSemantics(definition: IndustryMetricDefinition): boolean {
  if (!definition.canonicalUnit?.trim() || !definition.acceptedSourceUnits?.length
    || !definition.acceptedSourceUnits.includes(definition.canonicalUnit)
    || !definition.frequency?.trim() || !definition.periodBasis || !definition.aggregation
    || !definition.geography?.trim() || !definition.applicability?.trim() || !definition.pitPolicy) return false
  if (definition.acceptedSourceUnits.some((unit) => unit !== definition.canonicalUnit
    && !definition.unitConversions?.some((conversion) => conversion.sourceUnit === unit && conversion.targetUnit === definition.canonicalUnit && conversion.conversionId.trim() !== ''))) return false
  return true
}

function hasValidationChecks(validation: IndustryMetricValidation | undefined, checks: readonly IndustryMetricValidationCheck[]): boolean {
  return Boolean(validation && checks.every((check) => nonEmpty(validation.checks?.[check])))
}

function validateDefinition(definition: IndustryMetricDefinition): void {
  const expectedPrefix = `industry:${definition.industryId}:`
  if (!definition.industryId.trim() || !definition.metricId.startsWith(expectedPrefix) || definition.metricId.length === expectedPrefix.length) {
    throw new Error(`INVALID_INDUSTRY_METRIC_NAMESPACE:${definition.metricId}`)
  }
  if (!definition.metricFamily.trim() || !definition.semanticRole.trim() || !definition.name.trim() || !definition.description.trim()) {
    throw new Error(`INVALID_INDUSTRY_METRIC_DEFINITION:${definition.metricId}`)
  }
  if (definition.lifecycleStatus === 'CANONICAL') {
    if (!definition.validation || definition.sourcePolicies.length === 0) throw new Error(`INDUSTRY_CANONICAL_REQUIRES_VALIDATION_AND_POLICY:${definition.metricId}`)
    if (!hasDefinitionSemantics(definition) || !nonEmpty(definition.requiredQualifiers)
      || !hasValidationChecks(definition.validation, ['SEMANTIC', 'UNIT', 'PERIOD', 'SCOPE', 'PIT', 'EXTRACTION', 'ACCEPTANCE'])) {
      throw new Error(`INDUSTRY_CANONICAL_REQUIRES_COMPLETE_DEFINITION_AND_EVIDENCE:${definition.metricId}`)
    }
  }
}

function freezeDefinition(definition: IndustryMetricDefinition): IndustryMetricDefinition {
  return Object.freeze({
    ...definition,
    sourcePolicies: Object.freeze(definition.sourcePolicies.map((reference) => Object.freeze({ ...reference }))),
    ...(definition.acceptedSourceUnits ? { acceptedSourceUnits: Object.freeze([...definition.acceptedSourceUnits]) } : {}),
    ...(definition.unitConversions ? { unitConversions: Object.freeze(definition.unitConversions.map((conversion) => Object.freeze({ ...conversion }))) } : {}),
    ...(definition.requiredQualifiers ? { requiredQualifiers: Object.freeze([...definition.requiredQualifiers]) } : {}),
    ...(definition.pitPolicy ? { pitPolicy: Object.freeze({ ...definition.pitPolicy }) } : {}),
    ...(definition.validation ? {
      validation: Object.freeze({
        ...definition.validation,
        sourceabilityEvidence: Object.freeze([...definition.validation.sourceabilityEvidence]),
        ...(definition.validation.checks ? { checks: Object.freeze(Object.fromEntries(Object.entries(definition.validation.checks).map(([key, values]) => [key, Object.freeze([...(values ?? [])])])) as IndustryMetricValidation['checks']) } : {}),
      }),
    } : {}),
  })
}

export function createIndustryDataCatalog(initial: readonly IndustryMetricDefinition[] = []): IndustryDataCatalog {
  const definitions = new Map<string, IndustryMetricDefinition>()
  for (const definition of initial) {
    validateDefinition(definition)
    if (definitions.has(definition.metricId)) throw new Error(`DUPLICATE_INDUSTRY_METRIC_ID:${definition.metricId}`)
    definitions.set(definition.metricId, freezeDefinition(definition))
  }

  return {
    list(industryId) {
      return [...definitions.values()].filter((definition) => industryId === undefined || definition.industryId === industryId)
        .sort((left, right) => left.metricId.localeCompare(right.metricId))
    },
    get(metricId) { return definitions.get(metricId) },
    resolve(industryId, semanticRole, metricFamily) {
      return [...definitions.values()]
        .filter((definition) => definition.industryId === industryId && definition.lifecycleStatus === 'CANONICAL'
        && (semanticRole === undefined || definition.semanticRole === semanticRole)
        && (metricFamily === undefined || definition.metricFamily === metricFamily))
        .sort((left, right) => left.metricId.localeCompare(right.metricId))
    },
    resolveExact(industryId, semanticRole, metricFamily, dataKind) {
      const candidates = [...definitions.values()].filter((definition) => definition.industryId === industryId
        && definition.lifecycleStatus === 'CANONICAL' && definition.semanticRole === semanticRole && definition.metricFamily === metricFamily)
        .sort((left, right) => left.metricId.localeCompare(right.metricId))
      if (candidates.length === 0) return { status: 'NO_CANONICAL_INDUSTRY_METRIC' }
      const compatible = candidates.filter((definition) => definition.dataKind === dataKind)
      if (compatible.length === 0) return { status: 'INDUSTRY_DATA_KIND_MISMATCH', candidateMetricIds: candidates.map((definition) => definition.metricId) }
      if (compatible.length > 1) return { status: 'AMBIGUOUS_CANONICAL_INDUSTRY_METRIC', candidateMetricIds: compatible.map((definition) => definition.metricId) }
      return {
        status: 'MATCHED',
        definition: compatible[0]!,
        ...(candidates.length > compatible.length ? { incompatibleMetricIds: candidates.filter((definition) => definition.dataKind !== dataKind).map((definition) => definition.metricId) } : {}),
      }
    },
    registerDiscovered(definition) {
      if (definition.lifecycleStatus !== 'DISCOVERED') throw new Error(`INDUSTRY_REGISTRATION_MUST_START_DISCOVERED:${definition.metricId}`)
      validateDefinition(definition)
      if (definitions.has(definition.metricId)) throw new Error(`DUPLICATE_INDUSTRY_METRIC_ID:${definition.metricId}`)
      const registered = freezeDefinition(definition)
      definitions.set(definition.metricId, registered)
      return registered
    },
    associateSourcePolicy(metricId, reference) {
      const current = definitions.get(metricId)
      if (!current) throw new Error(`UNKNOWN_INDUSTRY_METRIC_ID:${metricId}`)
      if (current.lifecycleStatus === 'CANONICAL') throw new Error(`INDUSTRY_CANONICAL_POLICY_CHANGE_REQUIRES_REVIEW:${metricId}`)
      if (!reference.policyId.trim()) throw new Error(`INVALID_INDUSTRY_SOURCE_POLICY_REFERENCE:${metricId}`)
      if (current.sourcePolicies.some((item) => item.policyId === reference.policyId)) throw new Error(`DUPLICATE_INDUSTRY_SOURCE_POLICY_REFERENCE:${metricId}:${reference.policyId}`)
      const updated = freezeDefinition({ ...current, sourcePolicies: [...current.sourcePolicies, reference] })
      definitions.set(metricId, updated)
      return updated
    },
    transition(metricId, next, evidence) {
      const current = definitions.get(metricId)
      if (!current) throw new Error(`UNKNOWN_INDUSTRY_METRIC_ID:${metricId}`)
      const allowed = (current.lifecycleStatus === 'DISCOVERED' && next === 'VALIDATED')
        || (current.lifecycleStatus === 'VALIDATED' && next === 'CANONICAL')
      if (!allowed) throw new Error(`INVALID_INDUSTRY_METRIC_TRANSITION:${current.lifecycleStatus}->${next}`)
      const requiredChecks: IndustryMetricValidationCheck[] = next === 'VALIDATED'
        ? ['SEMANTIC', 'UNIT', 'PERIOD', 'SCOPE', 'PIT']
        : ['SEMANTIC', 'UNIT', 'PERIOD', 'SCOPE', 'PIT', 'EXTRACTION', 'ACCEPTANCE']
      if (!evidence || !Number.isFinite(Date.parse(evidence.validatedAt)) || !evidence.validator.trim()
        || !evidence.methodology.trim() || !nonEmpty(evidence.sourceabilityEvidence)
        || !hasValidationChecks(evidence, requiredChecks) || current.sourcePolicies.length === 0
        || (next === 'VALIDATED' && !hasDefinitionSemantics(current))) {
        throw new Error(next === 'CANONICAL'
          ? `INDUSTRY_CANONICAL_REQUIRES_COMPLETE_DEFINITION_AND_EVIDENCE:${metricId}`
          : `INDUSTRY_TRANSITION_REQUIRES_VALIDATION_EVIDENCE_AND_POLICY:${metricId}`)
      }
      const updated = freezeDefinition({ ...current, lifecycleStatus: next, validation: evidence })
      validateDefinition(updated)
      definitions.set(metricId, updated)
      return updated
    },
  }
}
