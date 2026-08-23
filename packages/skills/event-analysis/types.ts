import type { Evidence, Prediction, Thesis } from '../../artifacts/index.ts'

export type EvaluationPeriod = Prediction['evaluationPeriod']

export interface EventAnalysisInput {
  symbol: string
  sessionId: string
  createdAt: string
  evaluationPeriod: EvaluationPeriod
}

export interface EventAnalysisArtifacts {
  evidence: Evidence[]
  thesis: Thesis
  prediction: Prediction
}

export interface EventAnalysisResult {
  status: 'success'
  symbol: string
  artifacts: EventAnalysisArtifacts
}

/** Caller-owned deterministic artifact identity strategy. */
export type ArtifactIdFactory = (type: 'evidence' | 'thesis' | 'prediction', ordinal: number) => string

export type EventAnalysisClock = () => string
