import type { ResearchReport, ResearchSection } from '../shared/research-report.ts'

export interface IndustryResearchInput {
  industry: string
  geography: string
  asOf: string
  researchQuestion?: string
}

export interface IndustrySearchRecord {
  source: string
  title: string
  content: string
  asOf: string
  confidence: number
}

export interface IndustryPeerRecord {
  name: string
  revenueGrowth?: number
  ebitdaMargin?: number
  marketShare?: number
  valuationMultiple?: number
  source: string
  asOf: string
}

export interface IndustryResearchPlugins {
  research: {
    search_industry(input: { query: string; industry: string; geography: string }): Promise<IndustrySearchRecord[]>
    list_peer_metrics(input: { industry: string; geography: string }): Promise<IndustryPeerRecord[]>
  }
}

export interface IndustryResearchSection extends ResearchSection {
  id: 'market-overview' | 'industry-structure' | 'competitive-landscape' | 'valuation-context' | 'investment-implications'
}

export interface IndustryResearchResult extends ResearchReport {
  skillId: 'industry-research'
  sections: IndustryResearchSection[]
  peerMetrics: IndustryPeerRecord[]
}
