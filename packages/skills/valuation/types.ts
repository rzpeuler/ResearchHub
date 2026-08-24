import type { ResearchReport, ResearchSection } from '../shared/research-report.ts'

export interface ValuationForecast {
  year: number
  revenue: number
  ebitda: number
  freeCashFlow: number
}

export interface ValuationAssumptions {
  wacc: number
  terminalGrowth: number
  netDebt: number
  sharesOutstanding: number
}

export interface ValuationInput {
  symbol: string
  companyName: string
  asOf: string
  currentPrice?: number
  forecasts: ValuationForecast[]
  assumptions: ValuationAssumptions
}

export interface ValuationPeer {
  symbol: string
  name: string
  evRevenue?: number
  evEbitda?: number
  pe?: number
  revenueGrowth?: number
  ebitdaMargin?: number
  source: string
  asOf: string
}

export interface ValuationPlugins {
  peers: {
    list_peer_valuations(input: { symbol: string }): Promise<ValuationPeer[]>
  }
  market?: {
    get_market_snapshot(input: { symbol: string }): Promise<{ price: number; source: string; timestamp: string }>
  }
}

export interface ValuationStatistic {
  metric: 'evRevenue' | 'evEbitda' | 'pe' | 'revenueGrowth' | 'ebitdaMargin'
  count: number
  min?: number
  percentile25?: number
  median?: number
  percentile75?: number
  max?: number
}

export interface DcfResult {
  enterpriseValue: number
  equityValue: number
  impliedSharePrice: number
  presentValueOfForecasts: number
  presentValueOfTerminalValue: number
  terminalValueShare: number
  sensitivity: Array<{ wacc: number; terminalGrowth: number; impliedSharePrice: number }>
}

export interface ValuationSection extends ResearchSection {
  id: 'peer-selection' | 'operating-benchmarks' | 'dcf' | 'cross-checks' | 'risks'
}

export interface ValuationResult extends ResearchReport {
  skillId: 'valuation'
  sections: ValuationSection[]
  peers: ValuationPeer[]
  statistics: ValuationStatistic[]
  dcf: DcfResult
}
