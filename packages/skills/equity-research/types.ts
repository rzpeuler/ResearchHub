import type { ResearchEvidence, ResearchReport, ResearchSection } from '../shared/research-report.ts'

export interface EquityResearchInput {
  symbol: string
  companyName: string
  asOf: string
  researchQuestion?: string
}

export interface EquityMarketPort {
  get_market_snapshot(input: { symbol: string }): Promise<Record<string, unknown>>
}

export interface EquityFinancialPort {
  get_financial_snapshot(input: { symbol: string }): Promise<Record<string, unknown>>
}

export interface EquityInformationPort {
  search_company_news(input: { symbol: string }): Promise<Record<string, unknown>>
}

export interface EquityResearchPlugins {
  market: EquityMarketPort
  financial: EquityFinancialPort
  information: EquityInformationPort
}

export interface EquityResearchResult extends ResearchReport {
  skillId: 'equity-research'
  sections: EquityResearchSection[]
  thesis: {
    statement: string
    drivers: string[]
    risks: string[]
    evidenceIds: string[]
  }
}

export interface EquityResearchSection extends ResearchSection {
  id:
    | 'business-understanding'
    | 'industry-position'
    | 'competitive-advantage'
    | 'financial-quality'
    | 'growth-drivers'
    | 'risk-analysis'
}

export type { ResearchEvidence }
