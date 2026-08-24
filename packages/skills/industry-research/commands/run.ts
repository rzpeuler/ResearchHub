import { assertNonEmptyString, assertTimestamp, createEvidence } from '../../shared/research-report.ts'
import type { IndustryResearchInput, IndustryResearchPlugins, IndustryResearchResult, IndustryResearchSection } from '../types.ts'

export async function runIndustryResearchCommand(input: IndustryResearchInput, plugins: IndustryResearchPlugins): Promise<IndustryResearchResult> {
  const normalized = validateInput(input)
  const queries = ['market size and growth', 'value chain and industry structure', 'regulation, disruption, and competitive dynamics']
  const records = (await Promise.all(queries.map((query) => plugins.research.search_industry({ query, industry: normalized.industry, geography: normalized.geography })))).flat()
  const peerMetrics = await plugins.research.list_peer_metrics({ industry: normalized.industry, geography: normalized.geography })
  const evidence = records.map((record, index) => createEvidence(
    `industry-source-${index + 1}`,
    record.source,
    record.asOf,
    record.title,
    { content: record.content, industry: normalized.industry, geography: normalized.geography },
    record.confidence,
  ))
  const peerEvidence = createEvidence('industry-peers-1', 'peer-metrics-plugin', normalized.asOf, 'Peer operating and valuation context', { peers: peerMetrics })
  evidence.push(peerEvidence)
  const ids = evidence.map((item) => item.id)
  const sections: IndustryResearchSection[] = [
    makeSection('market-overview', 'Market Overview', ['Define the addressable market, historical growth, forecast assumptions, and segmentation.'], ids.slice(0, Math.max(1, Math.floor(ids.length / 2)))),
    makeSection('industry-structure', 'Industry Structure', ['Map the value chain, business models, barriers to entry, concentration, and where value accrues.'], ids),
    makeSection('competitive-landscape', 'Competitive Landscape', ['Compare leading players, strategic positioning, share movement, moats, substitutes, and disruption risk.'], ids),
    makeSection('valuation-context', 'Valuation Context', ['Compare peer multiples, historical ranges, premium/discount drivers, and transaction context.'], ['industry-peers-1']),
    makeSection('investment-implications', 'Investment Implications', ['Frame bull and bear debates, catalysts, risks, and the research questions that would change the sector narrative.'], ids),
  ]
  return {
    skillId: 'industry-research',
    subject: `${normalized.industry} — ${normalized.geography}`,
    asOf: normalized.asOf,
    template: 'industry-landscape-report',
    sections,
    evidence,
    peerMetrics,
    keyRisks: ['Market-size estimates can mix addressable-market potential with realized demand.', 'Industry data can become stale quickly; every report must carry an as-of date.'],
    openQuestions: [normalized.researchQuestion ?? 'Which market, regulatory, or competitive change would invalidate the current industry thesis?'],
  }
}

function makeSection(id: IndustryResearchSection['id'], title: string, findings: string[], evidenceIds: string[]): IndustryResearchSection {
  return { id, title, findings, evidenceIds }
}

function validateInput(input: IndustryResearchInput): IndustryResearchInput {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('industry research input must be an object')
  const value = input as unknown as Record<string, unknown>
  assertNonEmptyString(value.industry, '$.industry')
  assertNonEmptyString(value.geography, '$.geography')
  assertTimestamp(value.asOf, '$.asOf')
  if (value.researchQuestion !== undefined) assertNonEmptyString(value.researchQuestion, '$.researchQuestion')
  return {
    industry: value.industry.trim(),
    geography: value.geography.trim(),
    asOf: value.asOf,
    researchQuestion: value.researchQuestion === undefined ? undefined : value.researchQuestion.trim(),
  }
}
