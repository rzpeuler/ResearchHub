import type { WorkflowDefinition } from '../types.ts'

const inputSchema = {
  symbol: { type: 'string', required: true, description: 'Six-digit listed-company symbol.' },
  companyName: { type: 'string', required: true, description: 'Company name used by the research Skills.' },
  industry: { type: 'string', required: true, description: 'Industry scope for Industry Research.' },
  geography: { type: 'string', required: true, description: 'Geographic scope for Industry Research.' },
  question: { type: 'string', required: true, description: 'Natural-language equity research question.' },
  sessionId: { type: 'string', required: true, description: 'Research session identifier.' },
  createdAt: { type: 'string', required: true, description: 'Research creation timestamp.' },
  asOf: { type: 'string', required: true, description: 'Research evidence cut-off timestamp.' },
  earningsPeriod: { type: 'string', required: true, description: 'Earnings period to review.' },
  evaluationPeriod: { type: 'object', required: true, description: 'Prediction evaluation period.' },
  valuation: { type: 'object', required: true, description: 'Forecasts and valuation assumptions.' },
} as const

const outputSchema = {
  evidence: { type: 'array', required: true, description: 'Linked Evidence Artifacts.' },
  thesis: { type: 'object', required: true, description: 'Synthesized Thesis Artifact.' },
  prediction: { type: 'object', required: true, description: 'Reviewable Prediction Artifact.' },
  report: { type: 'object', required: true, description: 'Runtime-neutral ResearchReport.' },
  stepStates: { type: 'array', required: true, description: 'Ordered step execution states.' },
} as const

export const equityResearchWorkflowDefinition: WorkflowDefinition = {
  id: 'equity-research',
  name: 'Equity Research Workflow',
  description: 'Compose company, industry, financial, earnings, and valuation Skills into a standard equity research SOP.',
  version: '1.0.0',
  purpose: 'Produce a traceable Equity Research Artifact Bundle without owning research methodology or external data access.',
  inputSchema,
  outputSchema,
  steps: [
    { id: 'company-understanding', skill: 'company-research', inputs: ['symbol', 'companyName', 'question'], outputs: ['companyOutput'], dependsOn: [] },
    { id: 'industry-analysis', skill: 'industry-research', inputs: ['industry', 'geography', 'companyOutput'], outputs: ['industryOutput'], dependsOn: ['company-understanding'] },
    { id: 'financial-analysis', skill: 'equity-research', inputs: ['symbol', 'companyName', 'industryOutput'], outputs: ['financialOutput'], dependsOn: ['industry-analysis'] },
    { id: 'earnings-review', skill: 'earnings-review', inputs: ['symbol', 'companyName', 'earningsPeriod', 'financialOutput'], outputs: ['earningsOutput'], dependsOn: ['financial-analysis'] },
    { id: 'valuation-analysis', skill: 'valuation', inputs: ['symbol', 'companyName', 'valuation', 'earningsOutput'], outputs: ['valuationOutput'], dependsOn: ['earnings-review'] },
    { id: 'investment-thesis-generation', skill: 'workflow-assembly', inputs: ['companyOutput', 'industryOutput', 'financialOutput', 'earningsOutput', 'valuationOutput'], outputs: ['evidence', 'thesis', 'prediction', 'report'], dependsOn: ['valuation-analysis'] },
  ],
}
