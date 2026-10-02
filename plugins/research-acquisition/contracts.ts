export type ResearchSourceKind = 'official_disclosure' | 'structured_data' | 'news' | 'rss' | 'web_article'
export type ResearchSourceTier = 1 | 2 | 3 | 4 | 5

export interface ResearchCompanyIdentity {
  readonly symbol: string
  readonly name?: string
  readonly exchange?: 'SSE' | 'SZSE' | 'BSE' | string
}
export interface ResearchIndustryIdentity {
  readonly name: string
  readonly aliases?: readonly string[]
  readonly canonicalRef?: string
  readonly searchTerms: readonly string[]
}

export interface ResearchSourceCandidate {
  readonly candidateId: string
  readonly kind: ResearchSourceKind
  readonly tier: ResearchSourceTier
  readonly title: string
  readonly url?: string
  readonly provider: string
  readonly publishedAt?: string
  readonly snippet?: string
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface ResearchFetchedSource {
  readonly candidate: ResearchSourceCandidate
  readonly retrievedAt: string
  readonly content: string
  readonly contentType?: string
  readonly contentHash?: string
  readonly rawReference?: string
  readonly rawBytes?: Uint8Array
  readonly mediaType?: string
}

export interface NormalizedResearchSource {
  readonly candidate: ResearchSourceCandidate
  readonly retrievedAt: string
  readonly title: string
  readonly content: string
  readonly canonicalUrl?: string
  readonly contentHash: string
  readonly rawBytes?: Uint8Array
  /** Original fetched representation type; required by retention adapters. */
  readonly mediaType?: string
  readonly author?: string
  readonly publisher: string
  readonly rights: {
    readonly accessScope: 'public' | 'authenticated' | 'restricted' | 'unknown'
    /** Explicitly known provider terms; absence is treated as false. */
    readonly providerTermsKnown?: boolean
    readonly retentionAllowed: boolean
    readonly aiProcessingAllowed: boolean
    readonly derivativeKnowledgeAllowed: boolean
    readonly redistributionAllowed: boolean
    readonly policyBasis?: 'personal_noncommercial_research'
  }
}

export type ResearchAcquisitionRequest =
  | {
      /** Established Company callers remain source-compatible. */
      readonly company: ResearchCompanyIdentity
      readonly industry?: never
      readonly asOf?: string
      readonly limitPerKind?: number
    }
  | {
      /** Industry acquisition never carries a fabricated Company identity. */
      readonly industry: ResearchIndustryIdentity
      readonly company?: never
      readonly asOf?: string
      readonly limitPerKind?: number
    }

export interface ResearchAcquisitionPlugin {
  readonly name: string
  discover(request: ResearchAcquisitionRequest, signal?: AbortSignal): Promise<readonly ResearchSourceCandidate[]>
  fetch(candidate: ResearchSourceCandidate, signal?: AbortSignal): Promise<ResearchFetchedSource>
  normalize(source: ResearchFetchedSource, signal?: AbortSignal): Promise<NormalizedResearchSource>
}

export type AcquisitionPayloadStatus = 'usable' | 'empty' | 'failed'

export interface ResearchAcquisitionDiagnostic {
  readonly provider: string
  readonly candidateId?: string
  readonly kind?: ResearchSourceKind
  readonly status: AcquisitionPayloadStatus
  readonly reason: string
}

export interface ResearchProviderOutcome {
  readonly provider: string
  readonly providerAttempted: boolean
  readonly providerSucceeded: boolean
  readonly providerEmpty: boolean
  readonly providerFailed: boolean
  readonly usableSourceCount: number
}

export interface ResearchSignal {
  readonly signalId: string
  readonly kind: 'news' | 'announcement' | 'institutional_view' | 'community' | 'social_attention'
  readonly source: ResearchSourceCandidate
  readonly publishedAt?: string
  readonly discoveredAt: string
  readonly authorOrAccount?: string
  readonly candidateEntityRefs?: readonly string[]
  readonly themeHints?: readonly string[]
  readonly relevance?: number
  readonly novelty?: number
  readonly sentiment?: number
  readonly engagement?: Readonly<Record<string, number>>
  readonly contentReference?: string
}

export interface ResearchSignalStore {
  append(signal: ResearchSignal): Promise<void>
  listForCompany(symbol: string): Promise<readonly ResearchSignal[]>
}
