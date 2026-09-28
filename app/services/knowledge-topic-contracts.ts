import type { KnowledgeAssetKindV04 } from '../../knowledge/schema/domain-v04.ts'

export type KnowledgeTopicKind = 'relation' | 'claim' | 'observation' | 'event' | 'thesis' | 'module' | 'source' | 'reasoning_edge'
export type KnowledgeTopicScope = 'direct' | 'connected'
export type KnowledgeTopicLifecycleFilter = 'active' | 'all'

export interface KnowledgeTopicFilters {
  /** Defaults to active. `all` explicitly includes historical lifecycle states. */
  readonly lifecycle?: KnowledgeTopicLifecycleFilter
  readonly observationType?: 'metric' | 'estimate' | 'consensus'
  readonly claimType?: string
  readonly relationType?: string
}

export interface KnowledgeTopicPathHop {
  readonly relationRef: string
  /** Stored canonical direction; this is never reversed to fit traversal. */
  readonly sourceRef: string
  readonly targetRef: string
}

export interface KnowledgeTopicAssociationPath {
  readonly entityRef: string
  readonly hops: readonly KnowledgeTopicPathHop[]
}

export interface KnowledgeTopicSummaryCount {
  readonly total: number
  readonly totalExact: boolean
  readonly truncated: boolean
}

export interface KnowledgeTopicSummary {
  readonly knowledgeBaseId: string
  readonly schemaVersion: '0.4'
  readonly revision: number
  readonly theme: {
    readonly ref: string
    readonly name: string
    readonly aliases: readonly string[]
    readonly description?: string
    readonly definition?: string
    readonly inclusionCriteria?: readonly string[]
    readonly exclusionCriteria?: readonly string[]
    readonly themeGroupRef?: string
    readonly lifecycleStatus: string
  }
  readonly counts: Readonly<Record<KnowledgeTopicScope, Readonly<Record<KnowledgeTopicKind, KnowledgeTopicSummaryCount>>>>
  readonly overview: Readonly<Record<KnowledgeTopicScope, {
    /** Latest explicitly dated record among the canonical records included in this scope. */
    readonly latestDatedRecord?: { readonly ref: string; readonly kind: KnowledgeTopicKind; readonly dateField: string; readonly dateValue: string }
    /** Non-Source records in this scope that have no explicit canonical Source reference. */
    readonly nonSourceRecordsWithoutExplicitSourceRef: number
    readonly totalExact: boolean
    readonly truncated: boolean
  }>>
  readonly connected: {
    readonly depth: 1 | 2
    readonly totalExact: boolean
    readonly truncated: boolean
    readonly focusRefs: readonly string[]
    readonly focusRefsTotal: number
    readonly focusRefsTruncated: boolean
  }
}

export interface KnowledgeTopicItem {
  readonly ref: string
  readonly kind: KnowledgeTopicKind
  readonly scope: KnowledgeTopicScope
  readonly lifecycleStatus: string
  readonly label: string
  readonly summary?: string
  /** Field allowlist by canonical kind; never contains Raw body or arbitrary metadata. */
  readonly fields: Readonly<Record<string, string | number | boolean | null | readonly string[]>>
  readonly date?: { readonly field: string; readonly value: string }
  readonly associationPaths?: readonly KnowledgeTopicAssociationPath[]
}

export interface KnowledgeTopicPageInput {
  readonly themeRef: string
  readonly kind: KnowledgeTopicKind
  readonly scope?: KnowledgeTopicScope
  readonly depth?: 1 | 2
  readonly limit?: number
  readonly cursor?: string
  /** Rejects a page request if the mounted Knowledge Base has changed revision. */
  readonly expectedRevision?: number
  readonly filters?: KnowledgeTopicFilters
}

export interface KnowledgeTopicItemPage {
  readonly knowledgeBaseId: string
  readonly schemaVersion: '0.4'
  readonly revision: number
  readonly themeRef: string
  readonly kind: KnowledgeTopicKind
  readonly scope: KnowledgeTopicScope
  readonly depth: 1 | 2
  readonly filters: {
    readonly lifecycle: KnowledgeTopicLifecycleFilter
    readonly observationType?: 'metric' | 'estimate' | 'consensus'
    readonly claimType?: string
    readonly relationType?: string
  }
  readonly items: readonly KnowledgeTopicItem[]
  readonly total: number
  readonly totalExact: boolean
  readonly limit: number
  readonly nextCursor?: string
  readonly truncated: boolean
  readonly focusRefs: readonly string[]
  readonly focusRefsTotal: number
  readonly focusRefsTruncated: boolean
  readonly responseBounded: boolean
}

export type KnowledgeTopicAssetKind = Exclude<KnowledgeAssetKindV04, 'theme_group' | 'entity'>
