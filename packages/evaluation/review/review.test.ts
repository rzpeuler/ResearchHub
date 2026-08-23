import assert from 'node:assert/strict'
import test from 'node:test'

import { type JsonObject } from '../../artifacts/core/index.ts'
import { createPrediction } from '../../artifacts/prediction/index.ts'
import { compareMetrics } from '../core/index.ts'
import { createOutcome, type Outcome } from '../outcome/index.ts'
import { createEvaluationReview, evaluatePrediction } from './index.ts'

const prediction = createPrediction({
  id: 'prediction-001',
  createdAt: '2026-08-23T09:20:00.000Z',
  sessionId: 'session-001',
  metadata: { category: 'forecast' },
  thesisId: 'thesis-001',
  expectation: 'The observed metrics will match the expected fixture.',
  evaluationPeriod: {
    start: '2026-08-23T00:00:00.000Z',
    end: '2026-08-31T23:59:59.000Z',
  },
  metrics: {
    exact: 10,
    near: 20,
    different: 'expected',
    nested: { state: 'ready', flags: [true, null] },
  },
})

function outcome(metrics: JsonObject): Outcome {
  return createOutcome({
    description: 'Observed fixture result.',
    timestamp: '2026-08-23T12:00:00.000Z',
    source: 'validation-fixture',
    metrics,
  })
}

const deterministicOptions = {
  idFactory: () => 'review-001',
  clock: () => '2026-08-23T12:01:00.000Z',
  metadata: { category: 'evaluation' },
}

test('derives all four evaluation statuses from same-key metrics', () => {
  const cases = [
    {
      name: 'met',
      metrics: { exact: 10, near: 20 },
      status: 'met',
      compared: 2,
      matched: 2,
    },
    {
      name: 'partially_met',
      metrics: { exact: 10, near: 99 },
      status: 'partially_met',
      compared: 2,
      matched: 1,
    },
    {
      name: 'not_met',
      metrics: { exact: 11, near: 99 },
      status: 'not_met',
      compared: 2,
      matched: 0,
    },
    {
      name: 'inconclusive',
      metrics: { unrelated: 1 },
      status: 'inconclusive',
      compared: 0,
      matched: 0,
    },
  ] as const

  for (const testCase of cases) {
    const review = evaluatePrediction(prediction, outcome(testCase.metrics), deterministicOptions)
    assert.equal(review.evaluation.status, testCase.status, testCase.name)
    assert.equal(review.evaluation.comparedMetricCount, testCase.compared, testCase.name)
    assert.equal(review.evaluation.matchedMetricCount, testCase.matched, testCase.name)
  }
})

test('applies absolute numeric tolerance and records it on numeric metrics', () => {
  const review = evaluatePrediction(
    prediction,
    outcome({ exact: 10.25, near: 20.5 }),
    { ...deterministicOptions, numericTolerance: 0.5 },
  )

  assert.equal(review.evaluation.status, 'met')
  assert.deepEqual(review.evaluation.metrics, [
    { name: 'exact', expected: 10, actual: 10.25, matched: true, tolerance: 0.5 },
    { name: 'near', expected: 20, actual: 20.5, matched: true, tolerance: 0.5 },
  ])
})

test('uses deterministic deep equality for non-numeric JSON values', () => {
  const review = evaluatePrediction(
    prediction,
    outcome({
      different: 'expected',
      nested: { flags: [true, null], state: 'ready' },
    }),
    deterministicOptions,
  )

  assert.equal(review.evaluation.status, 'met')
  assert.equal(review.evaluation.metrics[0]?.name, 'different')
  assert.equal(review.evaluation.metrics[1]?.matched, true)
})

test('does not mutate inputs and returns independent nested values', () => {
  const actualOutcome = outcome({
    exact: 10,
    nested: { state: 'ready', flags: [true, null] },
  })
  const predictionBefore = structuredClone(prediction)
  const outcomeBefore = structuredClone(actualOutcome)

  const review = evaluatePrediction(prediction, actualOutcome, deterministicOptions)

  assert.deepEqual(prediction, predictionBefore)
  assert.deepEqual(actualOutcome, outcomeBefore)
  assert.notStrictEqual(review.outcome.metrics.nested, actualOutcome.metrics.nested)
  assert.notStrictEqual(review.evaluation.metrics[1]?.actual, actualOutcome.metrics.nested)
})

test('rejects blank metric keys before producing an invalid EvaluationSummary', () => {
  assert.throws(() => compareMetrics({ ...prediction, metrics: { '': 1 } } as never, outcome({})))
  assert.throws(() => compareMetrics(prediction, outcome({ '   ': 1 })))
  assert.throws(() => evaluatePrediction(prediction, outcome({ '': 1 }), deterministicOptions))
})

test('passes deep-cloned snapshots to idFactory and clock callbacks', () => {
  const actualOutcome = outcome({ exact: 10, nested: { state: 'ready', flags: [true, null] } })
  const predictionBefore = structuredClone(prediction)
  const outcomeBefore = structuredClone(actualOutcome)

  const review = evaluatePrediction(prediction, actualOutcome, {
    idFactory: (predictionSnapshot, outcomeSnapshot) => {
      assert.notStrictEqual(predictionSnapshot, prediction)
      assert.notStrictEqual(outcomeSnapshot, actualOutcome)
      assert.notStrictEqual(predictionSnapshot.metrics, prediction.metrics)
      assert.notStrictEqual(outcomeSnapshot.metrics.nested, actualOutcome.metrics.nested)

      predictionSnapshot.metrics.exact = 999
      outcomeSnapshot.metrics.nested = { state: 'changed' }
      return 'review-snapshot'
    },
    clock: (predictionSnapshot, outcomeSnapshot) => {
      assert.equal(predictionSnapshot.metrics.exact, 10)
      assert.deepEqual(outcomeSnapshot.metrics.nested, actualOutcome.metrics.nested)
      return '2026-08-23T12:01:00.000Z'
    },
  })

  assert.deepEqual(prediction, predictionBefore)
  assert.deepEqual(actualOutcome, outcomeBefore)
  assert.equal(review.id, 'review-snapshot')
})

test('uses injected identity, clock, metadata and prediction session', () => {
  const review = createEvaluationReview(prediction, outcome({ exact: 10 }), deterministicOptions)

  assert.equal(review.id, 'review-001')
  assert.equal(review.createdAt, '2026-08-23T12:01:00.000Z')
  assert.equal(review.sessionId, 'session-001')
  assert.deepEqual(review.metadata, { category: 'evaluation' })
  assert.equal(review.predictionId, prediction.id)
  assert.deepEqual(review.outcome, outcome({ exact: 10 }))
})

test('rejects invalid predictions, outcomes, tolerance and identity options', () => {
  assert.throws(() => evaluatePrediction({ ...prediction, metrics: [] } as never, outcome({})))
  assert.throws(() => evaluatePrediction(prediction, { ...outcome({}), timestamp: 'not-a-time' }))
  assert.throws(() => evaluatePrediction(prediction, outcome({}), { numericTolerance: -1 }))
  assert.throws(() => evaluatePrediction(prediction, outcome({}), { numericTolerance: Infinity }))
  assert.throws(() => evaluatePrediction(prediction, outcome({}), { numericTolerance: null as never }))
  assert.throws(() => evaluatePrediction(prediction, outcome({}), { idFactory: 'review-001' as never }))
  assert.throws(() => evaluatePrediction(prediction, outcome({}), { idFactory: null as never }))
  assert.throws(() => evaluatePrediction(prediction, outcome({}), { clock: () => 'not-a-time' }))
  assert.throws(() => evaluatePrediction(prediction, outcome({}), { clock: null as never }))
  assert.throws(() => evaluatePrediction(prediction, outcome({}), { metadata: [] as never }))
  assert.throws(() => evaluatePrediction(prediction, outcome({}), { metadata: null as never }))
  assert.throws(() => evaluatePrediction(prediction, outcome({}), new Date() as never))
  assert.throws(() => evaluatePrediction(prediction, outcome({}), [] as never))
  assert.doesNotThrow(() => evaluatePrediction(prediction, outcome({}), undefined))
})

test('default identity and clock are deterministic', () => {
  const first = evaluatePrediction(prediction, outcome({ exact: 10 }))
  const second = evaluatePrediction(prediction, outcome({ exact: 10 }))

  assert.deepEqual(first, second)
  assert.equal(first.id, 'review:prediction-001:2026-08-23T12:00:00.000Z')
  assert.equal(first.createdAt, '2026-08-23T12:00:00.000Z')
})
