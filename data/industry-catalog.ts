import type { DataRequirementKind } from './contracts.ts'

export type IndustryMetricLifecycleStatus = 'DISCOVERED' | 'VALIDATED' | 'CANONICAL'

export interface IndustrySourcePolicyReference {
  readonly policyId: string
  readonly metricFamily?: string
}

export interface IndustryMetricValidation {
  readonly validatedAt: string
  readonly validator: string
  readonly methodology: string
  readonly sourceabilityEvidence: readonly string[]
}

export interface IndustryMetricDefinition {
  /** Must be namespaced as `industry:<industryId>:<local-id>`. */
  readonly metricId: string
  /** Stable namespace key, for example `pcb` or `semiconductor`. */
  readonly industryId: string
  readonly metricFamily: string
  readonly semanticRole: string
  readonly name: string
  readonly description: string
  readonly dataKind: DataRequirementKind
  readonly unit?: string
  readonly periodicity?: string
  readonly geography?: string
  readonly applicability?: string
  readonly lifecycleStatus: IndustryMetricLifecycleStatus
  readonly sourcePolicies: readonly IndustrySourcePolicyReference[]
  readonly discoveredFrom?: string
  readonly validation?: IndustryMetricValidation
}

export interface IndustryMetricTransitionEvidence extends IndustryMetricValidation {}

export interface IndustryDataCatalog {
  list(industryId?: string): readonly IndustryMetricDefinition[]
  get(metricId: string): IndustryMetricDefinition | undefined
  resolve(industryId: string, semanticRole?: string, metricFamily?: string): readonly IndustryMetricDefinition[]
  registerDiscovered(definition: IndustryMetricDefinition): IndustryMetricDefinition
  associateSourcePolicy(metricId: string, reference: IndustrySourcePolicyReference): IndustryMetricDefinition
  transition(metricId: string, next: IndustryMetricLifecycleStatus, evidence?: IndustryMetricTransitionEvidence): IndustryMetricDefinition
}

export function industryMetricId(industryId: string, localId: string): string {
  return `industry:${industryId}:${localId}`
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
  }
}

function freezeDefinition(definition: IndustryMetricDefinition): IndustryMetricDefinition {
  return Object.freeze({
    ...definition,
    sourcePolicies: Object.freeze(definition.sourcePolicies.map((reference) => Object.freeze({ ...reference }))),
    ...(definition.validation ? { validation: Object.freeze({ ...definition.validation, sourceabilityEvidence: Object.freeze([...definition.validation.sourceabilityEvidence]) }) } : {}),
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
      if (!evidence || !Number.isFinite(Date.parse(evidence.validatedAt)) || !evidence.validator.trim()
        || !evidence.methodology.trim() || evidence.sourceabilityEvidence.length === 0
        || current.sourcePolicies.length === 0) {
        throw new Error(`INDUSTRY_TRANSITION_REQUIRES_VALIDATION_EVIDENCE_AND_POLICY:${metricId}`)
      }
      const updated = freezeDefinition({ ...current, lifecycleStatus: next, validation: evidence })
      validateDefinition(updated)
      definitions.set(metricId, updated)
      return updated
    },
  }
}
