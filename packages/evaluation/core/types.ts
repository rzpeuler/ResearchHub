import type { Outcome } from '../outcome/index.ts'
import type { Prediction } from '../../artifacts/prediction/index.ts'
import type { JsonObject } from '../../artifacts/core/index.ts'

export type ReviewIdFactory = (prediction: Prediction, outcome: Outcome) => string

export type ReviewClock = (prediction: Prediction, outcome: Outcome) => string

export type EvaluationEngineOptions = {
  numericTolerance?: number
  idFactory?: ReviewIdFactory
  clock?: ReviewClock
  metadata?: JsonObject
}
