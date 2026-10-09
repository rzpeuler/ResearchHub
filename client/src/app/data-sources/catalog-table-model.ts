import type { CommonDataCatalogProjection } from '../../api/runtime-client'

type CommonDataCatalogDefinition = CommonDataCatalogProjection['definitions'][number]

export interface CatalogTableRow {
  readonly key: string
  readonly metricId: string
  readonly meaning: string
  readonly consumers: string
  readonly defaultSource: string | null
  readonly fallback1: string | null
  readonly fallback2: string | null
  readonly finalFallback: string | null
}

type Candidate = { readonly sourceId: string; readonly fallbackLevel: string; readonly runtimeAdapterStatus: string }

function sourceColumns(candidates: readonly Candidate[]): Pick<CatalogTableRow, 'defaultSource' | 'fallback1' | 'fallback2' | 'finalFallback'> {
  const ids = (level: string): string | null => {
    const sources = [...new Set(candidates
      .filter((candidate) => candidate.fallbackLevel === level)
      // An unbound or unknown LLM_WEB operation is not an executable source.
      .filter((candidate) => level !== 'LLM_WEB' || candidate.runtimeAdapterStatus === 'BOUND')
      .map((candidate) => candidate.sourceId))]
    return sources.length ? sources.join(', ') : null
  }
  return { defaultSource: ids('PRIMARY'), fallback1: ids('FALLBACK_1'), fallback2: ids('FALLBACK_2'), finalFallback: ids('LLM_WEB') }
}

function policyRows(input: {
  readonly metricId: string
  readonly meaning: string
  readonly consumers: string
  readonly policies: readonly { readonly policyId: string; readonly candidates: readonly Candidate[] }[]
}): CatalogTableRow[] {
  if (input.policies.length === 0) return [{
    key: `${input.metricId}:unconfigured`, metricId: input.metricId, meaning: input.meaning, consumers: input.consumers,
    defaultSource: null, fallback1: null, fallback2: null, finalFallback: null,
  }]
  return input.policies.map((policy) => ({
    key: `${input.metricId}:${policy.policyId}`,
    metricId: input.metricId,
    meaning: input.meaning,
    consumers: input.consumers,
    ...sourceColumns(policy.candidates),
  }))
}

export function commonCatalogTableRows(definitions: readonly CommonDataCatalogDefinition[]): CatalogTableRow[] {
  return definitions.flatMap((definition) => policyRows({
    metricId: definition.metricId,
    meaning: definition.meaning,
    consumers: definition.consumers.length ? definition.consumers.join(', ') : '未明确映射',
    policies: definition.sourcePolicies,
  }))
}
