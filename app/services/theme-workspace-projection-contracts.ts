import type { ThemeFrameworkRecommendation } from '../../skills/theme-framework/contracts.ts'
import type { CompetitionColumnV1, CompetitionCellV1 } from '../../knowledge/schema/competition-module-v04.ts'

export interface ThemeWorkspaceProjectionLimits {
  readonly maxNodes?: number
  readonly maxEdges?: number
  readonly maxItemsPerSection?: number
  readonly maxCompaniesPerIndustry?: number
  /** Hard-capped response budget in UTF-8 bytes; defaults to the service budget. */
  readonly maxResponseBytes?: number
}

export interface ThemeWorkspaceResponseBounds {
  readonly maxBytes: number
  readonly serializedBytes: number
  readonly truncated: boolean
}

export interface ThemeWorkspaceProjectionInput extends ThemeWorkspaceProjectionLimits {
  readonly themeRef: string
  readonly expectedRevision?: number
  readonly asOf?: string
}

export interface ThemeWorkspaceTheme {
  readonly ref: string
  readonly name: string
  readonly themeGroupRef: string
  readonly definition?: string
}

export interface ThemeWorkspaceIndustryNode {
  readonly ref: string
  readonly name: string
  readonly description?: string
  readonly importance?: 'core' | 'material' | 'adjacent'
}

export interface ThemeWorkspaceIndustryEdge {
  readonly ref: string
  readonly relationType: 'upstream_of' | 'depends_on'
  readonly sourceRef: string
  readonly targetRef: string
}

export interface ThemeWorkspaceGraph {
  readonly nodes: readonly ThemeWorkspaceIndustryNode[]
  readonly edges: readonly ThemeWorkspaceIndustryEdge[]
  readonly nodeTotal: number
  readonly edgeTotal: number
  readonly nodeLimit: number
  readonly edgeLimit: number
  readonly truncated: boolean
}

export interface ThemeWorkspaceLimitView {
  readonly total: number
  readonly limit: number
  readonly truncated: boolean
}

export interface ThemeWorkspaceFact {
  readonly ref: string
  readonly kind: 'claim' | 'observation' | 'event'
  readonly semanticType: string
  readonly title: string
  readonly statement?: string
  readonly value?: string | number | boolean | null
  readonly unit?: string
  readonly period?: string
  readonly currency?: string
  readonly confidence?: number
  readonly probability?: number
  readonly temporal?: Readonly<Record<string, unknown>>
  readonly sourceRefs: readonly string[]
  readonly recordedAt?: string
}

export interface ThemeWorkspaceCanonicalModule {
  readonly ref: string
  readonly moduleType: string
  readonly schemaId?: string
  readonly targetRef: string
}

export type ThemeWorkspaceCompetitionColumn = CompetitionColumnV1
export interface ThemeWorkspaceCompetitionCell {
  readonly columnId: string
  readonly value: CompetitionCellV1
  readonly notComparable: boolean
  readonly comparabilityNote?: string
}
export interface ThemeWorkspaceCompetitionRow {
  readonly companyRef: string
  readonly cells: readonly ThemeWorkspaceCompetitionCell[]
}
export interface ThemeWorkspaceCompetitionTable {
  readonly ref: string
  readonly schemaId: string
  readonly columns: readonly ThemeWorkspaceCompetitionColumn[]
  readonly rows: readonly ThemeWorkspaceCompetitionRow[]
  readonly rowTotal: number
  readonly truncated: boolean
  readonly note?: string
}

export interface ThemeWorkspaceCoreViews {
  /** First three items are the deterministic default; remaining items are expandable. */
  readonly items: readonly ThemeWorkspaceFact[]
  readonly defaultCount: 3
  readonly total: number
  readonly truncated: boolean
}

export interface ThemeWorkspaceTimelineItem {
  readonly ref: string
  readonly title: string
  readonly date?: string
  readonly dateBasis: 'occurrence' | 'expected' | 'publication' | 'unknown'
  readonly dateLabel: '发生日' | '预计日期' | '资料发布日期' | '日期未知'
  readonly sourceRefs: readonly string[]
}

export interface ThemeWorkspaceContentProjection {
  readonly factsByType: Readonly<Record<string, readonly ThemeWorkspaceFact[]>>
  readonly modules: readonly ThemeWorkspaceCanonicalModule[]
  readonly competition?: ThemeWorkspaceCompetitionTable
  readonly coreViews: ThemeWorkspaceCoreViews
  readonly timeline: {
    readonly historicalEvents: readonly ThemeWorkspaceTimelineItem[]
    readonly futureCatalysts: readonly ThemeWorkspaceTimelineItem[]
    readonly eventsLimit: ThemeWorkspaceLimitView
    readonly catalystsLimit: ThemeWorkspaceLimitView
  }
  readonly limited: Readonly<Record<string, ThemeWorkspaceLimitView>>
  readonly omittedRestrictedCount: number
}

export interface ThemeWorkspaceCompanySummary {
  readonly ref: string
  readonly name: string
  readonly ticker?: string
  readonly exchange?: string
}

export interface ThemeWorkspaceIndustryProjection {
  readonly knowledgeBaseId: string
  readonly revision: number
  readonly themeRef: string
  readonly industry: ThemeWorkspaceIndustryNode
  readonly sections: ThemeWorkspaceContentProjection
  readonly companies: readonly ThemeWorkspaceCompanySummary[]
  readonly companiesLimit: ThemeWorkspaceLimitView
  readonly responseBounds: ThemeWorkspaceResponseBounds
}

export interface ThemeWorkspaceCompanyProjection {
  readonly knowledgeBaseId: string
  readonly revision: number
  readonly themeRef: string
  readonly industryRef: string
  readonly company: ThemeWorkspaceCompanySummary
  readonly sections: ThemeWorkspaceContentProjection
  readonly responseBounds: ThemeWorkspaceResponseBounds
}

export interface ThemeWorkspaceProjection {
  readonly status: 'available'
  readonly knowledgeBaseId: string
  readonly schemaVersion: '0.4'
  readonly revision: number
  readonly theme: ThemeWorkspaceTheme
  readonly graph: ThemeWorkspaceGraph
  readonly scope: {
    readonly includedIndustryCount: number
    readonly includedRelationCount: number
    readonly pendingCount: number
    readonly excludedCount: number
    readonly basedOnRevision: number
  }
  readonly responseBounds: ThemeWorkspaceResponseBounds
}

export type ThemeWorkspaceScopeRecommendation = ThemeFrameworkRecommendation
