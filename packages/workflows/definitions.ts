import type { WorkflowDefinition } from './types.ts'

const researchInputSchema = {
  symbol: { type: 'string', required: true, description: 'Six-digit A-share symbol.' },
  question: { type: 'string', required: true, description: 'Research question.' },
  sessionId: { type: 'string', required: true, description: 'Harness Session identifier.' },
  createdAt: { type: 'string', required: true, description: 'Research creation timestamp.' },
  evaluationPeriod: { type: 'object', required: true, description: 'Prediction evaluation period.' },
} as const

const researchOutputSchema = {
  evidenceIds: { type: 'array', required: true, description: 'Evidence Artifact identifiers.' },
  thesisIds: { type: 'array', required: true, description: 'Thesis Artifact identifiers.' },
  predictionIds: { type: 'array', required: true, description: 'Prediction Artifact identifiers.' },
} as const

export const eventAnalysisWorkflowDefinition: WorkflowDefinition = {
  id: 'event-analysis',
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
