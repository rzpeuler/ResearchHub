import { DataResolver } from '../../data/resolver.ts'
import type { DataRequirement, SourcePolicy, SourceExecutionResult } from '../../data/contracts.ts'
import type { IndustryDataCatalog } from '../../data/industry-catalog.ts'
import { validateIndustryObservation } from '../../data/industry-observations.ts'
import type { IndustryDataOperation, IndustryDataOperationPayload } from '../../plugins/research-acquisition/industry-data-operations.ts'
import type { IndustryTargetInput } from '../../skills/industry-research/contracts.ts'

export interface IndustryDataResolverContext {
  readonly target: IndustryTargetInput
  readonly asOf: string
  readonly now: () => string
  readonly signal?: AbortSignal
}

export interface IndustryDataResolverDependencies {
  readonly catalog: IndustryDataCatalog
  readonly policies: readonly SourcePolicy[]
  /** Operation IDs are explicit SourcePolicy contracts, never provider display names. */
  readonly operations: Readonly<Record<string, IndustryDataOperation | undefined>>
}

/** Compose the existing resolver with the reviewed Industry catalog and named Plugin operations. */
export function createIndustryDataResolver(
  dependencies: IndustryDataResolverDependencies,
  context: IndustryDataResolverContext,
): DataResolver<IndustryDataOperationPayload> {
  return new DataResolver<IndustryDataOperationPayload>({
    policies: dependencies.policies,
    industryCatalog: dependencies.catalog,
    now: context.now,
    ...(context.signal ? { signal: context.signal } : {}),
    executor: async (requirement: DataRequirement, candidate): Promise<SourceExecutionResult<IndustryDataOperationPayload>> => {
      const operation = dependencies.operations[candidate.operationId]
      if (!operation) return { status: 'UNSUPPORTED', diagnostic: `INDUSTRY_OPERATION_NOT_BOUND:${candidate.operationId}` }
      const execution = await operation({ requirement, candidate, target: context.target, now: context.now, ...(context.signal ? { signal: context.signal } : {}) })
      if (execution.status !== 'SUCCESS') return execution
      if (!requirement.metricId?.startsWith('industry:')) return execution
      const definition = dependencies.catalog.get(requirement.metricId)
      if (!definition || definition.lifecycleStatus !== 'CANONICAL') {
        return { status: 'UNSUPPORTED', diagnostic: `INDUSTRY_METRIC_NOT_CANONICAL:${requirement.metricId}` }
      }
      const observationPoints = []
      const observationDiagnostics: string[] = []
      for (const observation of execution.data.observationCandidates) {
        const validated = validateIndustryObservation(observation, definition, requirement)
        if (validated.status === 'VALID' && validated.point) observationPoints.push(validated.point)
        else observationDiagnostics.push(...validated.diagnostics.map((code) => `${requirement.metricId}:${code}`))
      }
      return {
        ...execution,
        data: {
          ...execution.data,
          observationPoints: Object.freeze(observationPoints),
          observationDiagnostics: Object.freeze(observationDiagnostics.slice(0, 32)),
        },
      }
    },
  })
}
