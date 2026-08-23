import type { Evidence, Prediction, Thesis } from '../../artifacts/index.ts'

export type CompanyResearchEvaluationPeriod = Prediction['evaluationPeriod']

export interface CompanyResearchInput {
  symbol: string
  sessionId: string
  createdAt: string
  evaluationPeriod: CompanyResearchEvaluationPeriod
}

export interface CompanyResearchArtifacts {
  evidence: Evidence[]
  thesis: Thesis
  prediction: Prediction
}

export interface CompanyResearchResult {
  status: 'success'
  symbol: string
  artifacts: CompanyResearchArtifacts
}

export type CompanyResearchArtifactIdFactory = (
  type: 'evidence' | 'thesis' | 'prediction',
  ordinal: number,
) => string
