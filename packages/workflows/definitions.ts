import type { WorkflowDefinition } from './types.ts'

const researchInputSchema = {
  symbol: { type: 'string', required: true, description: 'Six-digit A-share symbol.' },
  question: { type: 'string', required: true, description: 'Research question.' },
  sessionId: { type: 'string', required: true, description: 'Harness Session identifier.' },
  createdAt: { type: 'string', required: true, description: 'Research creation timestamp.' },
  evaluationPeriod: { type: 'object', required: false, description: 'Optional prediction evaluation period; defaults to 30 days.' },
} as const

const researchOutputSchema = {
  evidenceIds: { type: 'array', required: true, description: 'Evidence Artifact identifiers.' },
  thesisIds: { type: 'array', required: true, description: 'Thesis Artifact identifiers.' },
  predictionIds: { type: 'array', required: true, description: 'Prediction Artifact identifiers.' },
} as const

export const eventAnalysisWorkflowDefinition: WorkflowDefinition = {
  id: 'event-analysis',
  name: 'Event Analysis Workflow',
  description: 'Collect and synthesize market, information, and financial evidence for a neutral event analysis.',
  version: '1.0.0',
  purpose: 'Collect market, official announcement, professional media, and financial evidence for neutral event research.',
  inputSchema: researchInputSchema,
  outputSchema: researchOutputSchema,
  steps: [
    { id: 'collect-market-evidence', skill: 'event-analysis', inputs: ['symbol'], outputs: ['marketEvidence'], dependsOn: [] },
    { id: 'collect-announcement-evidence', skill: 'event-analysis', inputs: ['symbol'], outputs: ['announcementEvidence'], dependsOn: ['collect-market-evidence'] },
    { id: 'collect-media-evidence', skill: 'event-analysis', inputs: ['symbol'], outputs: ['mediaEvidence'], dependsOn: ['collect-announcement-evidence'] },
    { id: 'collect-financial-evidence', skill: 'event-analysis', inputs: ['symbol'], outputs: ['financialEvidence'], dependsOn: ['collect-media-evidence'] },
    { id: 'generate-research-artifacts', skill: 'event-analysis', inputs: ['marketEvidence', 'announcementEvidence', 'mediaEvidence', 'financialEvidence'], outputs: ['evidenceIds', 'thesisIds', 'predictionIds'], dependsOn: ['collect-financial-evidence'] },
  ],
}

export const companyResearchWorkflowDefinition: WorkflowDefinition = {
  id: 'company-research',
  name: 'Company Research Workflow',
  description: 'Analyze a listed company through business, industry, competitive, growth, financial, capital-allocation, and risk research.',
  version: '1.0.0',
  purpose: 'Produce a traceable long-term company research Thesis and reviewable Prediction from structured Capability facts.',
  inputSchema: researchInputSchema,
  outputSchema: researchOutputSchema,
  steps: [
    { id: 'business-understanding', skill: 'company-research', inputs: ['symbol'], outputs: ['businessEvidence'], dependsOn: [] },
    { id: 'industry-position', skill: 'company-research', inputs: ['symbol', 'businessEvidence'], outputs: ['industryEvidence'], dependsOn: ['business-understanding'] },
    { id: 'competitive-advantage', skill: 'company-research', inputs: ['industryEvidence'], outputs: ['competitiveEvidence'], dependsOn: ['industry-position'] },
    { id: 'growth-drivers', skill: 'company-research', inputs: ['competitiveEvidence'], outputs: ['growthEvidence'], dependsOn: ['competitive-advantage'] },
    { id: 'financial-quality', skill: 'company-research', inputs: ['symbol', 'growthEvidence'], outputs: ['financialEvidence'], dependsOn: ['growth-drivers'] },
    { id: 'capital-allocation', skill: 'company-research', inputs: ['financialEvidence'], outputs: ['capitalAllocationEvidence'], dependsOn: ['financial-quality'] },
    { id: 'risk-analysis', skill: 'company-research', inputs: ['businessEvidence', 'industryEvidence', 'competitiveEvidence', 'growthEvidence', 'financialEvidence', 'capitalAllocationEvidence'], outputs: ['riskEvidence'], dependsOn: ['capital-allocation'] },
    { id: 'generate-company-thesis', skill: 'company-research', inputs: ['businessEvidence', 'industryEvidence', 'competitiveEvidence', 'growthEvidence', 'financialEvidence', 'capitalAllocationEvidence', 'riskEvidence'], outputs: ['thesisIds'], dependsOn: ['risk-analysis'] },
    { id: 'generate-company-prediction', skill: 'company-research', inputs: ['thesisIds'], outputs: ['predictionIds'], dependsOn: ['generate-company-thesis'] },
  ],
}
