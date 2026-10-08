import type { CommonDataDefinition } from '../../data/common-catalog.ts'
import type { IndustryDataCatalog, IndustryIdentity, IndustryMetricDefinition, IndustrySourcePolicyReference } from '../../data/industry-catalog.ts'
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
  readonly runtimeAdapterStatus: 'BOUND' | 'UNBOUND'
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
}

interface IndustryProjectionInput {
  readonly catalog: IndustryDataCatalog
  readonly identities: readonly IndustryIdentity[]
  readonly policies: readonly SourcePolicy[]
  readonly integrations: readonly DataSourceIntegrationView[]
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

function projectCandidate(candidate: SourceCandidate, integrations: readonly DataSourceIntegrationView[]): CatalogSourceCandidate {
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
    runtimeAdapterStatus: mapped.length > 0 ? 'BOUND' : 'UNBOUND',
    connectionTestStatus: aggregate(connectionStatuses),
    capabilitySampleStatus: aggregate(capabilityStatuses),
    historicalPitStatus: 'NOT_VERIFIED',
    integrations: integrationStatuses,
  }
}

function projectPolicy(policy: SourcePolicy, integrations: readonly DataSourceIntegrationView[]): CatalogSourcePolicy {
  return {
    policyId: policy.policyId,
    selectionMode: policy.selectionMode,
    requirementMatch: policy.requirementMatch,
    candidates: policy.candidates.map((candidate) => projectCandidate(candidate, integrations)),
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
      .map((policy) => projectPolicy(policy, input.integrations))
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

function projectIndustryDefinition(definition: IndustryMetricDefinition, policies: readonly SourcePolicy[], integrations: readonly DataSourceIntegrationView[]): IndustryDataCatalogDefinition {
  const sourcePolicies = definition.sourcePolicies.map((reference): IndustryDataCatalogSourcePolicy => {
    const matched = policies.find((policy) => matchesIndustryPolicy(reference, policy))
    return {
      ...reference,
      mappingStatus: matched === undefined ? 'UNMAPPED' : 'MAPPED',
      ...(matched === undefined ? {} : { policy: projectPolicy(matched, integrations) }),
    }
  })
  return { ...definition, sourcePolicies }
}

export function projectIndustryDataCatalog(input: IndustryProjectionInput): IndustryDataCatalogProjection {
  const definitions = input.catalog.list().map((definition) => projectIndustryDefinition(definition, input.policies, input.integrations))
  return {
    identities: input.identities,
    definitions,
    registeredIndustryCount: input.identities.length,
    definitionCount: definitions.length,
    canonicalCount: definitions.filter((definition) => definition.lifecycleStatus === 'CANONICAL').length,
  }
}
