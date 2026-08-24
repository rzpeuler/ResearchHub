import type { ResearchReport, ResearchSection } from '../shared/research-report.ts'

export interface EarningsReviewInput {
  symbol: string
  companyName: string
  period: string
  asOf: string
}

export interface EarningsMetricSet {
  revenue?: number
  eps?: number
  grossMargin?: number
  operatingMargin?: number
}

export interface EarningsSnapshot {
  symbol: string
  period: string
  actual: EarningsMetricSet
  consensus?: EarningsMetricSet
  guidance: 'raised' | 'maintained' | 'lowered' | 'not-provided'
  source: string
  asOf: string
  notes?: string[]
}

export interface EarningsReviewPlugins {
  earnings: {
    get_earnings_snapshot(input: { symbol: string; period: string }): Promise<EarningsSnapshot>
  }
}

export interface EarningsVariance {
  metric: keyof EarningsMetricSet
  actual?: number
  consensus?: number
  variance?: number
  status: 'beat' | 'miss' | 'inline' | 'unavailable'
}

export interface EarningsReviewSection extends ResearchSection {
  id: 'results-snapshot' | 'beat-miss' | 'guidance' | 'thesis-impact' | 'sources'
}

export interface EarningsReviewResult extends ResearchReport {
  skillId: 'earnings-review'
  variances: EarningsVariance[]
  guidance: EarningsSnapshot['guidance']
  thesisImpact: 'positive' | 'negative' | 'neutral' | 'undetermined'
}
