/** Provider-neutral financial inputs owned by the Data Layer, shared with semantic methods. */
export interface CompanyFinancialObservation {
  readonly periodEnd?: string
  readonly publishedAt?: string
  readonly metrics: Readonly<{
    revenue?: number; netProfit?: number; grossMargin?: number; basicEps?: number; metric?: number
    operatingCashFlow?: number; capex?: number; assets?: number; liabilities?: number; equity?: number
    cash?: number; receivables?: number; inventory?: number; payables?: number; cogs?: number
    researchDevelopment?: number; operatingProfit?: number
    shortTermBorrowings?: number; longTermBorrowings?: number; bondsPayable?: number
    /** Reported current portion of non-current liabilities; may also include lease/non-debt items. */
    currentPortionLongTermDebt?: number
  }>
  readonly metricMetadata?: Readonly<Record<string, {
    readonly unit: string
    readonly currency: string
    readonly basis: 'YTD' | 'QUARTER' | 'POINT_IN_TIME' | 'UNKNOWN'
  }>>
  readonly sourceConflicts?: readonly { readonly metric: string; readonly indicatorValue: number; readonly statementValue: number }[]
  readonly pointInTimeSafe: boolean
  readonly pointInTimeStatus: 'CURRENT_VALUE_ONLY' | 'UNVERIFIED'
}

export interface CompanyFinancialHistory {
  readonly kind: 'financial'
  readonly rows: readonly CompanyFinancialObservation[]
  readonly retrievedAt: string
  readonly pointInTimeStatus: 'CURRENT_VALUE_ONLY' | 'UNVERIFIED'
}
