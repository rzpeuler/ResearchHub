import { evaluatePrediction } from '../core/index.ts'
import type { EvaluationEngineOptions } from '../core/index.ts'
import type { Outcome } from '../outcome/index.ts'
import type { Prediction } from '../../artifacts/prediction/index.ts'
import type { Review } from '../../artifacts/review/index.ts'

/** Review-facing entry point for the deterministic evaluation engine. */
export function createEvaluationReview(
  prediction: Prediction,
  outcome: Outcome,
  options: EvaluationEngineOptions = {},
): Review {
  return evaluatePrediction(prediction, outcome, options)
}

export { evaluatePrediction }
