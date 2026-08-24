import {
  assertNonEmptyString,
  assertTimestamp,
  createEvidence,
  normalizeSymbol,
} from '../../shared/research-report.ts'
import type { EquityResearchInput, EquityResearchPlugins, EquityResearchResult, EquityResearchSection } from '../types.ts'

export async function runEquityResearchCommand(input: EquityResearchInput, plugins: EquityResearchPlugins): Promise<EquityResearchResult> {
  const normalized = validateInput(input)
  const [market, financial, information] = await Promise.all([
    plugins.market.get_market_snapshot({ symbol: normalized.symbol }),
    plugins.financial.get_financial_snapshot({ symbol: normalized.symbol }),
    plugins.information.search_company_news({ symbol: normalized.symbol }),
  ])

  const evidence = [
    createEvidence('equity-market-1', 'market-plugin', normalized.asOf, 'Current market snapshot', market),
    createEvidence('equity-financial-1', 'financial-plugin', normalized.asOf, 'Reported financial snapshot', financial),
    createEvidence('equity-information-1', 'information-plugin', normalized.asOf, 'Recent company information', information),
  ]
  const sections: EquityResearchSection[] = [
    section('business-understanding', 'Business Understanding', ['Describe products, customers, channels, and the value-creation mechanism.'], ['equity-information-1']),
    section('industry-position', 'Industry Position', ['Map the company to its industry, value chain, competitors, substitutes, and regulation.'], ['equity-information-1']),
    section('competitive-advantage', 'Competitive Advantage', ['Test cost, technology, brand, distribution, ecosystem, switching-cost, and licensing advantages against observable evidence.'], ['equity-information-1', 'equity-financial-1']),
    section('financial-quality', 'Financial Quality', ['Review growth quality, profitability, cash conversion, leverage, working capital, and capital intensity without turning the section into a valuation.'], ['equity-financial-1']),
    section('growth-drivers', 'Growth Drivers', ['State each growth driver as a mechanism with an evidence-backed validation metric.'], ['equity-market-1', 'equity-financial-1', 'equity-information-1']),
    section('risk-analysis', 'Risk Analysis', ['Record industry, competition, execution, regulatory, governance, financial, concentration, and technology risks.'], ['equity-information-1', 'equity-financial-1']),
  ]
  const risks = ['Evidence freshness and source coverage must be reviewed before publication.', 'Competitive durability and growth assumptions require later validation.']
  const drivers = ['Observable demand and operating performance should support the stated growth mechanism.', 'Financial quality and capital allocation should remain consistent with the research thesis.']
  return {
    skillId: 'equity-research',
    subject: `${normalized.companyName} (${normalized.symbol})`,
    asOf: normalized.asOf,
    template: 'equity-coverage-report',
    sections,
    evidence,
    keyRisks: risks,
    openQuestions: [normalized.researchQuestion ?? 'Which assumptions require the next research review?'],
    thesis: {
      statement: `The evidence package describes ${normalized.companyName} as a business; durable investment conclusions require explicit review of the linked evidence and risks.`,
      drivers,
      risks,
      evidenceIds: evidence.map((item) => item.id),
    },
  }
}

function section(id: EquityResearchSection['id'], title: string, findings: string[], evidenceIds: string[]): EquityResearchSection {
  return { id, title, findings, evidenceIds }
}

function validateInput(input: EquityResearchInput): EquityResearchInput & { symbol: string } {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('equity research input must be an object')
  const value = input as unknown as Record<string, unknown>
  const companyName = value.companyName
  const asOf = value.asOf
  const researchQuestion = value.researchQuestion
  assertNonEmptyString(companyName, '$.companyName')
  assertTimestamp(asOf, '$.asOf')
  if (researchQuestion !== undefined) assertNonEmptyString(researchQuestion, '$.researchQuestion')
  return {
    symbol: normalizeSymbol(value.symbol, '$.symbol'),
    companyName: companyName.trim(),
    asOf,
    researchQuestion: researchQuestion === undefined ? undefined : researchQuestion.trim(),
  }
}
