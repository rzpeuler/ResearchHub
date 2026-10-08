import type { SourcePolicy, SourceCandidate } from './contracts.ts'

const evidenceCandidate = (sourceId: string, authority: SourceCandidate['originAuthority'], operationId: string, fallbackLevel: SourceCandidate['fallbackLevel']): SourceCandidate => ({
  sourceId, fallbackLevel, originAuthority: authority, operationId,
  supports: { dataKinds: ['evidence'], metricIds: ['industry_research_evidence'] },
})

/** Generic documents can support any registered or unregistered Industry identity. */
export const INDUSTRY_RESEARCH_EVIDENCE_POLICY: SourcePolicy = Object.freeze({
  policyId: 'industry-research-evidence-v1',
  requirementMatch: { workflow: 'industry-deep-research', dataKind: 'evidence', metricId: 'industry_research_evidence' } as const,
  selectionMode: 'COLLECT_DIVERSE',
  candidates: Object.freeze([
    evidenceCandidate('industry-miit-evidence', 'S1_OFFICIAL', 'industry.evidence.miit', 'PRIMARY'),
    evidenceCandidate('industry-govcn-evidence', 'S1_OFFICIAL', 'industry.evidence.govcn', 'PRIMARY'),
    evidenceCandidate('industry-cpca-evidence', 'S2_PROFESSIONAL', 'industry.evidence.cpca', 'FALLBACK_1'),
    evidenceCandidate('industry-eastmoney-snapshot', 'S3_AGGREGATOR', 'industry.evidence.eastmoney-board', 'FALLBACK_2'),
  ]),
})

function metricPolicy(metricId: string, sourceId: string, authority: SourceCandidate['originAuthority'], operationId: string): SourcePolicy {
  return Object.freeze({
    policyId: `industry-metric:${metricId}`,
    requirementMatch: { workflow: 'industry-deep-research', dataKind: 'timeseries', metricId } as const,
    selectionMode: 'FIRST_VALID',
    candidates: Object.freeze([Object.freeze({
      sourceId, fallbackLevel: 'PRIMARY' as const, originAuthority: authority, operationId,
      supports: Object.freeze({ dataKinds: Object.freeze(['timeseries'] as const), metricIds: Object.freeze([metricId]) }),
    })]),
  })
}

/** Candidate policies are kept detached from the catalog until each source acceptance qualifies the metric. */
export const INDUSTRY_METRIC_CANDIDATE_POLICIES: readonly SourcePolicy[] = Object.freeze([
  metricPolicy('industry:household_air_conditioner:room-air-conditioner-production', 'industry-nbs-room-air-conditioner-production', 'S0_STATUTORY', 'industry.metric.nbs.room-air-conditioner-production'),
  metricPolicy('industry:household_air_conditioner:air-conditioner-export-volume', 'industry-cheaa-air-conditioner-monthly-export-volume', 'S2_PROFESSIONAL', 'industry.metric.cheaa.air-conditioner-export-volume'),
  metricPolicy('industry:lithium_battery:lithium-battery-total-output', 'industry-miit-lithium-total-output', 'S1_OFFICIAL', 'industry.metric.miit.lithium-total-output'),
  metricPolicy('industry:lithium_battery:lithium-carbonate-period-average-price', 'industry-miit-lithium-carbonate-average-price', 'S1_OFFICIAL', 'industry.metric.miit.lithium-carbonate-average-price'),
  metricPolicy('industry:lithium_battery:lithium-hydroxide-period-average-price', 'industry-miit-lithium-hydroxide-average-price', 'S1_OFFICIAL', 'industry.metric.miit.lithium-hydroxide-average-price'),
])

export const INDUSTRY_DATA_SOURCE_POLICIES: readonly SourcePolicy[] = Object.freeze([
  INDUSTRY_RESEARCH_EVIDENCE_POLICY,
  ...INDUSTRY_METRIC_CANDIDATE_POLICIES,
])
