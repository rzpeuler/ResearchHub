import { DataResolver } from '../../data/resolver.ts'
import { createIndustryDataCatalog } from '../../data/industry-catalog.ts'
import type { AcquisitionResult, DataRequirement } from '../../data/contracts.ts'
import type { IndustryDataOperationPayload, IndustryOperationDocument } from '../../plugins/research-acquisition/industry-data-operations.ts'
import type { NormalizedResearchSource } from '../../plugins/research-acquisition/contracts.ts'
import type { IndustryAcquisitionWaveRequest } from '../../workflows/industry-deep-research/contracts.ts'

export function createIndustryWorkflowResolverFixture(
  acquire: (request: IndustryAcquisitionWaveRequest) => Promise<readonly NormalizedResearchSource[]>,
  now: () => string,
) {
  return (context: { readonly target: { readonly name: string }; readonly signal?: AbortSignal }) => new DataResolver<IndustryDataOperationPayload>({
    policies: [],
    industryCatalog: createIndustryDataCatalog(),
    now,
    ...(context.signal ? { signal: context.signal } : {}),
    executor: async () => ({ status: 'UNSUPPORTED', diagnostic: 'fixture executor is intentionally unused' }),
    resolveAcquisition: async (requirement: DataRequirement): Promise<AcquisitionResult<IndustryDataOperationPayload>> => {
      if (requirement.metricId !== 'industry_research_evidence') return unavailable(requirement)
      const wave = requirement.id.endsWith('wave-2') ? 2 : 1
      const query = requirement.industryEvidenceQueryContext!
      const sources = await acquire({ target: { name: query.displayTarget }, wave, design: {} as never, gaps: [query.purpose], searchTerms: query.searchTerms })
      const documents: IndustryOperationDocument[] = sources.map((source) => ({
        record: source,
        ...(source.candidate.publishedAt ? { publishedAt: source.candidate.publishedAt } : {}),
        retrievedAt: source.retrievedAt,
        ...(source.canonicalUrl ? { sourceUrl: source.canonicalUrl } : {}),
        contentHash: source.contentHash,
        sourceIdentity: source.canonicalUrl ? `url:${source.canonicalUrl}` : `hash:${source.contentHash}`,
        originPublisher: source.publisher,
        retrievalProvider: source.candidate.provider,
        rights: { accessScope: source.rights.accessScope, retentionAllowed: source.rights.retentionAllowed, aiProcessingAllowed: source.rights.aiProcessingAllowed, derivativeKnowledgeAllowed: source.rights.derivativeKnowledgeAllowed, redistributionAllowed: source.rights.redistributionAllowed },
      }))
      const payload: IndustryDataOperationPayload = { documents, observationCandidates: [], diagnostics: [], outcome: { transportSucceeded: true, fetchSucceeded: documents.length > 0, discovered: documents.length, fetched: documents.length, failed: 0, empty: documents.length ? 0 : 1, rejected: 0, deduplicated: 0 } }
      const source = { sourceId: 'fixture-evidence', fallbackLevel: 'PRIMARY' as const, originAuthority: 'S1_OFFICIAL' as const, retrievalProvider: 'fixture', retrievedAt: now() }
      return { requirementId: requirement.id, status: documents.length ? 'AVAILABLE' : 'UNAVAILABLE', ...(documents.length ? { data: payload, observations: [{ data: payload, source }], sources: [source], source } : { source: null, unavailableReason: 'DATA_NOT_PUBLISHED' }), quality: { pointInTimeSafe: true, complete: true, crossChecked: false }, attempts: [] }
    },
  })
}

function unavailable(requirement: DataRequirement): AcquisitionResult<IndustryDataOperationPayload> {
  return { requirementId: requirement.id, status: 'UNAVAILABLE', source: null, quality: { pointInTimeSafe: false, complete: false, crossChecked: false }, attempts: [], unavailableReason: 'NO_REGISTERED_POLICY' }
}
