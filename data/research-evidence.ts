import type { AcquisitionResult, AcquisitionSourceMetadata, DataRequirement } from './contracts.ts'

export type ResearchEvidenceDateStatus = 'QUALIFIED' | 'UNKNOWN' | 'INVALID' | 'FUTURE' | 'OUTSIDE_PERIOD'

export interface ResearchEvidenceInput<T> {
  readonly record: T
  readonly publishedAt?: string
  readonly retrievedAt: string
  readonly sourceUrl?: string
  readonly contentHash?: string
  readonly sourceIdentity?: string
  readonly originPublisher?: string
  readonly hostPlatform?: string
  readonly retrievalProvider: string
  readonly rights?: {
    readonly accessScope: 'public' | 'authenticated' | 'restricted' | 'unknown'
    readonly retentionAllowed: boolean
    readonly aiProcessingAllowed: boolean
    readonly derivativeKnowledgeAllowed: boolean
    readonly redistributionAllowed: boolean
  }
}

export interface QualifiedResearchEvidence<T> extends ResearchEvidenceInput<T> {
  readonly provenance: AcquisitionSourceMetadata & { readonly contentHash?: string }
  readonly dateStatus: 'QUALIFIED' | 'UNKNOWN'
  readonly pointInTimeSafe: boolean
}

export interface ResearchEvidenceOutcome {
  readonly transportSucceeded: boolean
  readonly fetchSucceeded: boolean
  readonly discovered: number
  readonly fetched: number
  readonly failed: number
  readonly empty: number
  readonly rejected: number
  readonly deduplicated: number
  readonly diagnostics: readonly string[]
}

export interface UnqualifiedResearchEvidenceBatch<T> {
  readonly kind: 'evidence'
  readonly documents: readonly ResearchEvidenceInput<T>[]
  readonly outcome: ResearchEvidenceOutcome
}

export interface ResearchEvidenceBatch<T> {
  readonly kind: 'evidence'
  readonly documents: readonly QualifiedResearchEvidence<T>[]
  readonly outcome: ResearchEvidenceOutcome
}

type ProvenanceAwareSource = {
  readonly candidate: {
    readonly url?: string
    readonly publishedAt?: string
    readonly metadata?: Readonly<Record<string, unknown>>
  }
  readonly retrievedAt: string
  readonly canonicalUrl?: string
  readonly contentHash: string
  readonly publisher: string
}

/** Attach a qualified document's Data lineage to the normalized source before
 * it is passed to Skills and the Knowledge Production Gateway. Volatile
 * retrieval time and content hash remain on the source's existing top-level
 * fields, keeping source identity metadata stable across content updates.
 */
export function sourceWithDataEvidenceProvenance<T extends ProvenanceAwareSource>(document: QualifiedResearchEvidence<T>): T {
  const source = document.record
  const retrievalProvider = document.provenance.retrievalProvider ?? document.retrievalProvider
  const explicitPublisher = document.originPublisher ?? document.provenance.originPublisher
  const publisher = reliableOriginPublisher(explicitPublisher) ?? 'Unknown original publisher'
  const sourceUrl = document.sourceUrl ?? document.provenance.sourceUrl ?? source.canonicalUrl ?? source.candidate.url
  const publishedAt = document.publishedAt ?? document.provenance.publishedAt ?? source.candidate.publishedAt
  const dataProvenance = {
    originAuthority: document.provenance.originAuthority,
    ...(document.hostPlatform ?? document.provenance.hostPlatform ? { hostPlatform: document.hostPlatform ?? document.provenance.hostPlatform } : {}),
    retrievalProvider,
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(document.sourceIdentity ? { sourceIdentity: document.sourceIdentity } : sourceUrl ? { sourceIdentity: `url:${sourceUrl}` } : document.contentHash ? { sourceIdentity: `hash:${document.contentHash}` } : {}),
    ...(publishedAt ? { publishedAt } : {}),
    dateStatus: document.dateStatus,
    pointInTimeSafe: document.pointInTimeSafe,
  }
  return {
    ...source,
    publisher,
    retrievedAt: document.retrievedAt,
    contentHash: document.contentHash ?? source.contentHash,
    ...(sourceUrl ? { canonicalUrl: sourceUrl } : {}),
    candidate: {
      ...source.candidate,
      ...(publishedAt ? { publishedAt } : {}),
      metadata: { ...source.candidate.metadata, dataProvenance },
    },
  } as T
}

function reliableOriginPublisher(value: string | undefined): string | undefined {
  const publisher = value?.trim()
  if (!publisher || /^unknown(?:\s|$)/i.test(publisher) || /^gdelt$/i.test(publisher)) return undefined
  return publisher
}

/** Strictly qualify document dates and deduplicate across all configured sources. */
export function finalizeResearchEvidence<T>(
  requirement: DataRequirement,
  acquired: AcquisitionResult<UnqualifiedResearchEvidenceBatch<T>>,
): AcquisitionResult<ResearchEvidenceBatch<T>> {
  const seenUrls = new Set<string>()
  const seenHashes = new Set<string>()
  let anyRejectedForTime = false
  let anyRejected = false
  let anyDeduplicated = false
  const observations = (acquired.observations ?? []).map((observation) => {
    const documents: QualifiedResearchEvidence<T>[] = []
    let rejected = 0
    let deduplicated = 0
    const diagnostics = [...observation.data.outcome.diagnostics]
    for (const document of observation.data.documents) {
      if (requirement.metricId === 'industry_research_evidence'
        && (!document.rights || document.rights.accessScope !== 'public' || !document.rights.retentionAllowed || !document.rights.aiProcessingAllowed || !document.rights.derivativeKnowledgeAllowed)) {
        rejected += 1
        anyRejected = true
        diagnostics.push('industry_evidence_rights_rejected')
        continue
      }
      const dateStatus = qualifyResearchEvidenceDate(document.publishedAt, requirement)
      if (dateStatus === 'FUTURE' || dateStatus === 'INVALID' || dateStatus === 'OUTSIDE_PERIOD') {
        rejected += 1
        anyRejected = true
        anyRejectedForTime = true
        diagnostics.push(`document_${dateStatus.toLowerCase()}`)
        continue
      }
      const sourceUrl = document.sourceUrl === undefined ? undefined : canonicalResearchUrl(document.sourceUrl)
      if (document.sourceUrl !== undefined && sourceUrl === undefined) {
        rejected += 1
        anyRejected = true
        diagnostics.push('document_unsafe_url')
        continue
      }
      const hash = document.contentHash?.trim().toLowerCase() || undefined
      if ((sourceUrl && seenUrls.has(sourceUrl)) || (hash && seenHashes.has(hash))) {
        deduplicated += 1
        anyDeduplicated = true
        diagnostics.push('document_duplicate')
        continue
      }
      if (sourceUrl) seenUrls.add(sourceUrl)
      if (hash) seenHashes.add(hash)
      const provenance: QualifiedResearchEvidence<T>['provenance'] = {
        ...observation.source,
        ...(document.originPublisher ? { originPublisher: document.originPublisher } : { originPublisher: undefined }),
        ...(document.hostPlatform ? { hostPlatform: document.hostPlatform } : {}),
        retrievalProvider: document.retrievalProvider,
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(document.publishedAt ? { publishedAt: document.publishedAt } : {}),
        retrievedAt: document.retrievedAt,
        ...(hash ? { contentHash: hash } : {}),
      }
      documents.push({ ...document, ...(sourceUrl ? { sourceUrl } : {}), provenance, dateStatus, pointInTimeSafe: dateStatus === 'QUALIFIED' })
    }
    return {
      ...observation,
      data: { ...observation.data, documents, outcome: { ...observation.data.outcome, rejected: observation.data.outcome.rejected + rejected, deduplicated: observation.data.outcome.deduplicated + deduplicated, diagnostics } },
    }
  })
  const usable = observations.filter((observation) => observation.data.documents.length > 0)
  const totalDocuments = usable.reduce((sum, observation) => sum + observation.data.documents.length, 0)
  const hasFailure = acquired.attempts.some((attempt) => attempt.status !== 'SUCCESS') || observations.some((observation) => observation.data.outcome.failed > 0)
  const pointInTimeSafe = totalDocuments > 0 && usable.every((observation) => observation.data.documents.every((document) => document.pointInTimeSafe))
  const complete = acquired.attempts.length > 0 && !hasFailure && !anyRejected && !anyDeduplicated && pointInTimeSafe && observations.every((observation) => observation.data.outcome.rejected === 0 && observation.data.outcome.empty === 0) && usable.length === acquired.attempts.length
  const attempts = acquired.attempts.map((attempt) => {
    if (attempt.status !== 'SUCCESS') return attempt
    const observation = observations.find((item) => item.source.sourceId === attempt.sourceId)
    if (!observation || observation.data.documents.length > 0) return attempt
    const status = observation.data.outcome.failed > 0 ? 'SOURCE_ERROR' as const : observation.data.outcome.rejected > 0 ? 'POINT_IN_TIME_INVALID' as const : 'NO_DATA' as const
    return { ...attempt, status, diagnostic: observation.data.outcome.diagnostics.join('|') || 'no_qualified_documents' }
  })
  const { data: _unqualifiedData, ...retained } = acquired
  return {
    ...retained,
    status: totalDocuments === 0 ? 'UNAVAILABLE' : complete ? 'AVAILABLE' : 'PARTIAL',
    source: usable[0]?.source ?? null,
    sources: observations.map((observation) => observation.source),
    observations,
    attempts,
    quality: { pointInTimeSafe, complete, crossChecked: false, ...(!pointInTimeSafe ? { pitDiagnostic: 'DOCUMENT_PUBLICATION_UNVERIFIED' } : {}) },
    ...(totalDocuments === 0 ? { unavailableReason: anyRejectedForTime || observations.some((observation) => observation.data.outcome.diagnostics.some((diagnostic) => /:(?:INVALID|FUTURE|OUTSIDE_PERIOD)$/.test(diagnostic))) ? 'NO_ELIGIBLE_POINT_IN_TIME_DATA' as const : acquired.unavailableReason ?? 'DATA_NOT_PUBLISHED' as const } : {}),
  }
}

export function qualifyResearchEvidenceDate(value: string | undefined, requirement: DataRequirement): ResearchEvidenceDateStatus {
  if (value === undefined || value.trim() === '') return 'UNKNOWN'
  const date = parseStrictDate(value)
  if (date === undefined) return 'INVALID'
  const cutoff = parseStrictDate(requirement.analysisAsOf ?? requirement.asOf)
  if (cutoff === undefined) return 'INVALID'
  if (date > cutoff) return 'FUTURE'
  const start = requirement.period?.start === undefined ? undefined : parseStrictDate(requirement.period.start)
  const end = requirement.period?.end === undefined ? undefined : parseStrictDate(requirement.period.end)
  const inclusiveEnd = end === undefined ? undefined : /^\d{4}-\d{2}-\d{2}$/.test(requirement.period!.end!) ? end + 86_400_000 - 1 : end
  if ((start !== undefined && date < start) || (inclusiveEnd !== undefined && date > inclusiveEnd)) return 'OUTSIDE_PERIOD'
  return 'QUALIFIED'
}

export function canonicalResearchUrl(value: string): string | undefined {
  try {
    const url = new URL(value)
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) return undefined
    url.hash = ''
    url.pathname = url.pathname.replace(/\/$/, '') || '/'
    for (const key of [...url.searchParams.keys()]) if (/^(utm_.+|fbclid|gclid)$/i.test(key)) url.searchParams.delete(key)
    url.searchParams.sort()
    return url.toString()
  } catch { return undefined }
}

function parseStrictDate(value: string): number | undefined {
  const calendarPrefix = /^(\d{4}-\d{2}-\d{2})(?:$|T)/.exec(value)?.[1]
  if (calendarPrefix) {
    const day = new Date(`${calendarPrefix}T00:00:00.000Z`)
    if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== calendarPrefix) return undefined
  }
  const calendar = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (calendar) {
    const date = new Date(`${value}T00:00:00.000Z`)
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? date.getTime() : undefined
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return undefined
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? undefined : parsed
}
