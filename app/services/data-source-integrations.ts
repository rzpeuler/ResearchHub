import type { DataSourceIntegrationDefinition } from './data-source-administration-contracts.ts'
import type { IndustryOperatingObservationAcquisitionPort } from '../../plugins/research-acquisition/industry-operating-observations.ts'

type Capability = DataSourceIntegrationDefinition['descriptor']['capabilities'][number]

export function sourceIntegration(input: {
  readonly id: string
  readonly name: string
  readonly sourceIds?: readonly string[]
  readonly capabilities: readonly Capability[]
  readonly capabilitySamples?: DataSourceIntegrationDefinition['capabilitySamples']
}): DataSourceIntegrationDefinition {
  const capabilitySamples = input.capabilitySamples ?? {}
  return {
    descriptor: {
      integrationId: input.id,
      displayName: input.name,
      sourceIds: input.sourceIds ?? [],
      credentialFields: [],
      capabilities: input.capabilities,
      supportedTests: { connection: false, capabilitySamples: Object.keys(capabilitySamples) },
    },
    testTimeoutMs: 15_000,
    ...(Object.keys(capabilitySamples).length ? { capabilitySamples } : {}),
  }
}

export function mergeSourceIntegrations(definitions: readonly DataSourceIntegrationDefinition[]): readonly DataSourceIntegrationDefinition[] {
  const merged = new Map<string, DataSourceIntegrationDefinition>()
  for (const definition of definitions) {
    const id = definition.descriptor.integrationId
    const previous = merged.get(id)
    if (!previous) { merged.set(id, definition); continue }
    const capabilities = new Map(previous.descriptor.capabilities.map((capability) => [capability.id, capability]))
    for (const capability of definition.descriptor.capabilities) {
      const prior = capabilities.get(capability.id)
      capabilities.set(capability.id, prior === undefined ? capability : { ...prior, metricIds: [...new Set([...prior.metricIds, ...capability.metricIds])] })
    }
    const capabilitySamples = { ...previous.capabilitySamples, ...definition.capabilitySamples }
    merged.set(id, {
      ...previous,
      descriptor: {
        ...previous.descriptor,
        sourceIds: [...new Set([...previous.descriptor.sourceIds, ...definition.descriptor.sourceIds])],
        capabilities: [...capabilities.values()],
        supportedTests: {
          connection: Boolean(previous.testConnection ?? definition.testConnection),
          capabilitySamples: Object.keys(capabilitySamples),
        },
      },
      testTimeoutMs: Math.min(previous.testTimeoutMs, definition.testTimeoutMs),
      ...(previous.testConnection ?? definition.testConnection ? { testConnection: previous.testConnection ?? definition.testConnection } : {}),
      ...(Object.keys(capabilitySamples).length ? { capabilitySamples } : {}),
    })
  }
  return [...merged.values()]
}

export function industryOperatingIntegration(acquisition: IndustryOperatingObservationAcquisitionPort, boundedSampleAvailable = false): DataSourceIntegrationDefinition {
  return sourceIntegration({
    id: 'industry-operating',
    name: 'Industry operating observations',
    capabilities: [{ id: 'industry-operating-observations', label: 'Industry operating observations', metricIds: [] }],
    ...(boundedSampleAvailable ? { capabilitySamples: {
      'industry-operating-observations': async (signal) => {
        const now = new Date().toISOString()
        const result = await acquisition.acquire({ target: { name: 'lithium battery' }, asOf: '2026-01-01T00:00:00.000Z', now: () => now, signal })
        if (signal.aborted) throw new Error('cancelled')
        if (result.observations.length === 0 || result.sources.length === 0) throw new Error('no_data')
        const sourceIds = new Set(result.sources.map((source) => source.candidate.candidateId))
        if (result.observations.some((item) =>
          !sourceIds.has(item.sourceCandidateId) || !item.publicationPit || !item.valueVersionPit ||
          !Number.isFinite(Date.parse(item.publishedAt)) ||
          !Number.isFinite(Date.parse(item.periodStart)) ||
          !Number.isFinite(Date.parse(item.periodEnd)) ||
          item.publishedAt > '2026-01-01T00:00:00.000Z')) throw new Error('contract_mismatch')
      },
    } } : {}),
  })
}
