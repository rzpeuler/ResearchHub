import type { CommonDataDefinition } from '../../data/common-catalog.ts'
import type { IndustryDataCatalog, IndustryIdentity, IndustryMetricDefinition, IndustryMetricValidation, IndustrySourcePolicyReference } from '../../data/industry-catalog.ts'
import type { DataSourceIntegrationView } from './data-source-administration-contracts.ts'
import type { FallbackLevel, SourceAuthority, SourceCandidate, SourcePolicy, SourceSelectionMode } from '../../data/contracts.ts'

export type CatalogMappingStatus = 'MAPPED' | 'UNMAPPED'
export type CatalogTestStatus = 'NOT_SUPPORTED' | 'NOT_TESTED' | 'PASSED' | 'FAILED' | 'CANCELLED' | 'UNSUPPORTED'

export interface CatalogIntegrationStatus {
  readonly integrationId: string
  readonly displayName: string
  readonly connectionTestStatus: CatalogTestStatus
  readonly capabilitySampleStatus: CatalogTestStatus
}

export interface CatalogSourceCandidate {
  readonly sourceId: string
  readonly fallbackLevel: FallbackLevel
  readonly originAuthority: SourceAuthority
  readonly originPublisher?: string
  readonly operationId: string
  readonly supports: SourceCandidate['supports']
  readonly runtimeAdapterStatus: 'BOUND' | 'UNBOUND' | 'UNKNOWN'
  readonly connectionTestStatus: CatalogTestStatus
  readonly capabilitySampleStatus: CatalogTestStatus
  /** Policy presence and generic provider tests never establish historical PIT safety. */
  readonly historicalPitStatus: 'NOT_VERIFIED'
  readonly integrations: readonly CatalogIntegrationStatus[]
}

export interface CatalogSourcePolicy {
  readonly policyId: string
  readonly selectionMode: SourceSelectionMode
  readonly requirementMatch: SourcePolicy['requirementMatch']
  readonly candidates: readonly CatalogSourceCandidate[]
}

export interface CommonDataCatalogDefinition extends CommonDataDefinition {
  readonly sourcePolicyStatus: 'CONFIGURED' | 'NOT_CONFIGURED'
  readonly sourceMappingStatus: CatalogMappingStatus
  readonly sourcePolicies: readonly CatalogSourcePolicy[]
}

export interface CommonDataCatalogProjection {
  readonly definitions: readonly CommonDataCatalogDefinition[]
  readonly definitionCount: number
}

export interface IndustryDataCatalogSourcePolicy extends IndustrySourcePolicyReference {
  readonly mappingStatus: CatalogMappingStatus
  readonly policy?: CatalogSourcePolicy
}

export type IndustryDataCatalogDefinition = Omit<IndustryMetricDefinition, 'sourcePolicies'> & {
  readonly sourcePolicies: readonly IndustryDataCatalogSourcePolicy[]
}

export interface IndustryDataCatalogProjection {
  readonly identities: readonly IndustryIdentity[]
  readonly definitions: readonly IndustryDataCatalogDefinition[]
  readonly registeredIndustryCount: number
  readonly definitionCount: number
  readonly canonicalCount: number
}

interface CommonProjectionInput {
  readonly definitions: readonly CommonDataDefinition[]
  readonly policies: readonly SourcePolicy[]
  readonly integrations: readonly DataSourceIntegrationView[]
  /** Exact operation IDs bound by the active Runtime resolver composition; undefined means unknown. */
  readonly boundOperationIds?: readonly string[]
}

interface IndustryProjectionInput {
  readonly catalog: IndustryDataCatalog
  readonly identities: readonly IndustryIdentity[]
  readonly policies: readonly SourcePolicy[]
  readonly integrations: readonly DataSourceIntegrationView[]
  /** Exact operation IDs bound by the active Runtime resolver composition; undefined means unknown. */
  readonly boundOperationIds?: readonly string[]
}

const SAFE_VALIDATION_CHECKS = ['SEMANTIC', 'UNIT', 'PERIOD', 'SCOPE', 'PIT', 'EXTRACTION', 'ACCEPTANCE'] as const
const LOCAL_PATH_PATTERN = /(?:\b[A-Z]:\\(?:[^\\\s"'<>]+\\)*[^\\\s"'<>]*|\\\\[^\\\s]+\\[^\\\s"'<>]+(?:\\[^\\\s"'<>]*)*|\/(?:Users|home|tmp|private|var)\/[^\s"'<>]*)/giu
const SECRET_ASSIGNMENT_PATTERN = /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret|credential(?:value)?)\s*([:=])\s*[^\s,;]+/giu

function safeText(value: string): string {
  return value
    .slice(0, 2048)
    .replace(/\bBearer\s+[^\s,;]+/giu, 'Bearer [redacted]')
    .replace(SECRET_ASSIGNMENT_PATTERN, '$1$2[redacted]')
    .replace(LOCAL_PATH_PATTERN, '[redacted local path]')
    .replace(/\b(?:Error|TypeError|RangeError|ReferenceError|SyntaxError):[^\r\n]*/gu, '[redacted internal error]')
    .replace(/(?:^|\n)\s*at\s+[^\n]+/gu, '')
}

function safeValidation(validation: IndustryMetricDefinition['validation']): IndustryMetricDefinition['validation'] {
  if (!validation) return undefined
  const checks: IndustryMetricValidation['checks'] | undefined = validation.checks === undefined ? undefined : Object.fromEntries(
    SAFE_VALIDATION_CHECKS.flatMap((key) => validation.checks?.[key] === undefined ? [] : [[key, validation.checks[key]!.map(safeText)]]),
  ) as IndustryMetricValidation['checks']
  return {
    validatedAt: safeText(validation.validatedAt),
    validator: safeText(validation.validator),
    methodology: safeText(validation.methodology),
    sourceabilityEvidence: validation.sourceabilityEvidence.map(safeText),
    ...(checks === undefined ? {} : { checks }),
  }
}

function statusForLatestTest(view: DataSourceIntegrationView, kind: 'connection' | 'capability_sample', capabilityId?: string): CatalogTestStatus {
  const supported = kind === 'connection'
    ? view.integration.supportedTests.connection
    : capabilityId !== undefined && view.integration.supportedTests.capabilitySamples.includes(capabilityId)
  if (!supported) return 'NOT_SUPPORTED'
  const summaries = view.latestTests
    .filter((summary) => summary.kind === kind && (kind === 'connection' || summary.capabilityId === capabilityId))
    .sort((left, right) => right.completedAt.localeCompare(left.completedAt))
  const latest = summaries[0]
  if (!latest) return 'NOT_TESTED'
  return latest.status.toUpperCase() as Exclude<CatalogTestStatus, 'NOT_SUPPORTED' | 'NOT_TESTED'>
}

function capabilityIdFor(candidate: SourceCandidate, view: DataSourceIntegrationView): string | undefined {
  const metricIds = candidate.supports.metricIds ?? []
  return view.integration.capabilities.find((capability) => metricIds.some((metricId) => capability.metricIds.includes(metricId)))?.id
}

function projectCandidate(candidate: SourceCandidate, integrations: readonly DataSourceIntegrationView[], boundOperationIds?: readonly string[]): CatalogSourceCandidate {
  const mapped = integrations.filter((view) => view.integration.sourceIds.includes(candidate.sourceId))
  const integrationStatuses = mapped.map((view): CatalogIntegrationStatus => {
    const capabilityId = capabilityIdFor(candidate, view)
    return {
      integrationId: view.integration.integrationId,
      displayName: view.integration.displayName,
      connectionTestStatus: statusForLatestTest(view, 'connection'),
      capabilitySampleStatus: capabilityId === undefined ? 'NOT_SUPPORTED' : statusForLatestTest(view, 'capability_sample', capabilityId),
    }
  })
  const capabilityStatuses = integrationStatuses.map((status) => status.capabilitySampleStatus)
  const connectionStatuses = integrationStatuses.map((status) => status.connectionTestStatus)
  const aggregate = (statuses: readonly CatalogTestStatus[]): CatalogTestStatus => {
    if (statuses.includes('PASSED')) return 'PASSED'
    return statuses[0] ?? 'NOT_TESTED'
  }
  return {
    sourceId: candidate.sourceId,
    fallbackLevel: candidate.fallbackLevel,
    originAuthority: candidate.originAuthority,
    ...(candidate.originPublisher === undefined ? {} : { originPublisher: candidate.originPublisher }),
    operationId: candidate.operationId,
    supports: candidate.supports,
    runtimeAdapterStatus: mapped.length > 0 || boundOperationIds?.includes(candidate.operationId)
      ? 'BOUND'
      : boundOperationIds === undefined ? 'UNKNOWN' : 'UNBOUND',
    connectionTestStatus: aggregate(connectionStatuses),
    capabilitySampleStatus: aggregate(capabilityStatuses),
    historicalPitStatus: 'NOT_VERIFIED',
    integrations: integrationStatuses,
  }
}

function projectPolicy(policy: SourcePolicy, integrations: readonly DataSourceIntegrationView[], boundOperationIds?: readonly string[]): CatalogSourcePolicy {
  return {
    policyId: policy.policyId,
    selectionMode: policy.selectionMode,
    requirementMatch: policy.requirementMatch,
    candidates: policy.candidates.map((candidate) => projectCandidate(candidate, integrations, boundOperationIds)),
  }
}

function matchesCommonDefinition(policy: SourcePolicy, definition: CommonDataDefinition): boolean {
  const match = policy.requirementMatch
  return match.metricId === definition.metricId
    && (match.dataKind === undefined || match.dataKind === definition.dataKind)
    && (match.workflow === undefined || definition.consumers.includes(match.workflow))
}

export function projectCommonDataCatalog(input: CommonProjectionInput): CommonDataCatalogProjection {
  const definitions = input.definitions.map((definition): CommonDataCatalogDefinition => {
    const policies = input.policies
      .filter((policy) => matchesCommonDefinition(policy, definition))
      .map((policy) => projectPolicy(policy, input.integrations, input.boundOperationIds))
      .sort((left, right) => left.policyId.localeCompare(right.policyId))
    return {
      metricId: definition.metricId,
      meaning: definition.meaning,
      dataKind: definition.dataKind,
      consumers: definition.consumers,
      sourcePolicyStatus: policies.length > 0 ? 'CONFIGURED' : 'NOT_CONFIGURED',
      sourceMappingStatus: policies.length > 0 ? 'MAPPED' : 'UNMAPPED',
      sourcePolicies: policies,
    }
  }).sort((left, right) => left.metricId.localeCompare(right.metricId))
  return { definitions, definitionCount: definitions.length }
}

function matchesIndustryPolicy(reference: IndustrySourcePolicyReference, policy: SourcePolicy): boolean {
  return policy.policyId === reference.policyId
    && (reference.metricFamily === undefined || policy.requirementMatch.metricFamily === undefined || policy.requirementMatch.metricFamily === reference.metricFamily)
}

function projectIndustryDefinition(definition: IndustryMetricDefinition, policies: readonly SourcePolicy[], integrations: readonly DataSourceIntegrationView[], boundOperationIds?: readonly string[]): IndustryDataCatalogDefinition {
  const sourcePolicies = definition.sourcePolicies.map((reference): IndustryDataCatalogSourcePolicy => {
    const matched = policies.find((policy) => matchesIndustryPolicy(reference, policy))
    return {
      policyId: safeText(reference.policyId),
      ...(reference.metricFamily === undefined ? {} : { metricFamily: safeText(reference.metricFamily) }),
      mappingStatus: matched === undefined ? 'UNMAPPED' : 'MAPPED',
      ...(matched === undefined ? {} : { policy: projectPolicy(matched, integrations, boundOperationIds) }),
    }
  })
  return {
    metricId: safeText(definition.metricId),
    industryId: safeText(definition.industryId),
    metricFamily: safeText(definition.metricFamily),
    semanticRole: safeText(definition.semanticRole),
    name: safeText(definition.name),
    description: safeText(definition.description),
    dataKind: definition.dataKind,
    ...(definition.unit === undefined ? {} : { unit: safeText(definition.unit) }),
    ...(definition.canonicalUnit === undefined ? {} : { canonicalUnit: safeText(definition.canonicalUnit) }),
    ...(definition.acceptedSourceUnits === undefined ? {} : { acceptedSourceUnits: definition.acceptedSourceUnits.map(safeText) }),
    ...(definition.unitConversions === undefined ? {} : { unitConversions: definition.unitConversions.map((conversion) => ({ sourceUnit: safeText(conversion.sourceUnit), targetUnit: safeText(conversion.targetUnit), conversionId: safeText(conversion.conversionId) })) }),
    ...(definition.periodicity === undefined ? {} : { periodicity: safeText(definition.periodicity) }),
    ...(definition.frequency === undefined ? {} : { frequency: safeText(definition.frequency) }),
    ...(definition.periodBasis === undefined ? {} : { periodBasis: definition.periodBasis }),
    ...(definition.aggregation === undefined ? {} : { aggregation: definition.aggregation }),
    ...(definition.geography === undefined ? {} : { geography: safeText(definition.geography) }),
    ...(definition.applicability === undefined ? {} : { applicability: safeText(definition.applicability) }),
    ...(definition.product === undefined ? {} : { product: safeText(definition.product) }),
    ...(definition.segment === undefined ? {} : { segment: safeText(definition.segment) }),
    ...(definition.grade === undefined ? {} : { grade: safeText(definition.grade) }),
    ...(definition.requiredQualifiers === undefined ? {} : { requiredQualifiers: [...definition.requiredQualifiers] }),
    ...(definition.pitPolicy === undefined ? {} : { pitPolicy: { publicationPit: definition.pitPolicy.publicationPit, valueVersionPit: definition.pitPolicy.valueVersionPit } }),
    lifecycleStatus: definition.lifecycleStatus,
    sourcePolicies,
    ...(definition.discoveredFrom === undefined ? {} : { discoveredFrom: safeText(definition.discoveredFrom) }),
    ...(definition.validation === undefined ? {} : { validation: safeValidation(definition.validation) }),
  }
}

export function projectIndustryDataCatalog(input: IndustryProjectionInput): IndustryDataCatalogProjection {
  const definitions = input.catalog.list().map((definition) => projectIndustryDefinition(definition, input.policies, input.integrations, input.boundOperationIds))
  return {
    identities: input.identities,
    definitions,
    registeredIndustryCount: input.identities.length,
    definitionCount: definitions.length,
    canonicalCount: definitions.filter((definition) => definition.lifecycleStatus === 'CANONICAL').length,
  }
}
