import assert from 'node:assert/strict'
import test from 'node:test'

import { createOutcome } from '../../evaluation/outcome/index.ts'
import {
  createReview,
  deserializeReview,
  isReview,
  serializeReview,
  validateReview,
} from './index.ts'

const outcome = createOutcome({
  description: 'Observed fixture result.',
  timestamp: '2026-08-23T12:00:00.000Z',
  source: 'validation-fixture',
  metrics: { target: 1, label: 'met' },
})

const input = {
  id: 'review-001',
  createdAt: '2026-08-23T12:01:00.000Z',
  sessionId: 'session-001',
  metadata: { category: 'evaluation' },
  predictionId: 'prediction-001',
  outcome,
  evaluation: {
    status: 'met' as const,
    comparedMetricCount: 2,
    matchedMetricCount: 2,
    metrics: [
      { name: 'target', expected: 1, actual: 1, matched: true, tolerance: 0 },
      { name: 'label', expected: 'met', actual: 'met', matched: true },
    ],
  },
}

test('creates a Review linked to Prediction, Outcome and Session', () => {
  const review = createReview(input)

  assert.equal(review.type, 'review')
  assert.equal(review.predictionId, 'prediction-001')
  assert.equal(review.outcome.source, 'validation-fixture')
  assert.equal(review.sessionId, 'session-001')
  assert.equal(isReview(review), true)
})

test('rejects malformed nested Outcome and Evaluation data', () => {
  assert.throws(() => validateReview({ ...input, outcome: { ...outcome, metrics: ['invalid'] } }))
  assert.throws(() => validateReview({ ...input, evaluation: { ...input.evaluation, metrics: [{ ...input.evaluation.metrics[0], actual: undefined }] } }))
  assert.throws(() => validateReview({ ...input, evaluation: { ...input.evaluation, matchedMetricCount: 1 } }))
})

test('rejects invalid Review dates and malicious toJSON properties', () => {
  const review = createReview(input)
  assert.throws(() => validateReview({ ...review, createdAt: '2026-02-30T12:01:00.000Z' }))

  const maliciousReview = { ...review }
  Object.defineProperty(maliciousReview, 'toJSON', {
    value: () => ({ type: 'prediction' }),
    enumerable: true,
  })
  assert.throws(() => createReview(maliciousReview as never))
})

test('requires EvaluationSummary status to match metric counts', () => {
  const cases = [
    {
      status: 'inconclusive' as const,
      comparedMetricCount: 0,
      matchedMetricCount: 0,
      metrics: [],
    },
    {
      status: 'met' as const,
      comparedMetricCount: 2,
      matchedMetricCount: 2,
      metrics: input.evaluation.metrics,
    },
    {
      status: 'partially_met' as const,
      comparedMetricCount: 2,
      matchedMetricCount: 1,
      metrics: [
        input.evaluation.metrics[0],
        { ...input.evaluation.metrics[1], matched: false },
      ],
    },
    {
      status: 'not_met' as const,
      comparedMetricCount: 2,
      matchedMetricCount: 0,
      metrics: input.evaluation.metrics.map((metric) => ({ ...metric, matched: false })),
    },
  ]

  for (const evaluation of cases) {
    assert.doesNotThrow(() => createReview({ ...input, evaluation }))
  }

  assert.throws(() => createReview({
    ...input,
    evaluation: { ...cases[0], status: 'met' },
  }))
  assert.throws(() => createReview({
    ...input,
    evaluation: { ...cases[1], status: 'partially_met' },
  }))
  assert.throws(() => createReview({
    ...input,
    evaluation: { ...cases[2], status: 'not_met' },
  }))
  assert.throws(() => createReview({
    ...input,
    evaluation: { ...cases[3], status: 'inconclusive' },
  }))
})

test('rejects a non-review artifact type without changing core types', () => {
  assert.throws(() => validateReview({ ...input, type: 'prediction' }))
})

test('round-trips Review through JSON serialization', () => {
  const review = createReview(input)
  const restored = deserializeReview(serializeReview(review))

  assert.deepEqual(restored, review)
  assert.equal(restored.predictionId, 'prediction-001')
  assert.equal(restored.sessionId, 'session-001')
})

test('rejects malformed serialized Review data', () => {
  assert.throws(() => deserializeReview('{"type":"review"}'))
  assert.throws(() => deserializeReview('not-json'))
})

test('keeps Review validation and serialization aligned for unsafe nested structures', () => {
  const review = createReview(input)
  const sparseMetrics: unknown[] = []
  sparseMetrics.length = 2
  sparseMetrics[1] = review.evaluation.metrics[1]

  const withExtraField = { ...review, extra: true }
  const withEvaluationExtra = {
    ...review,
    evaluation: { ...review.evaluation, extra: true },
  }
  const withMetricExtra = {
    ...review,
    evaluation: {
      ...review.evaluation,
      metrics: [{ ...review.evaluation.metrics[0], extra: true }, review.evaluation.metrics[1]],
    },
  }
  const withSparseMetrics = {
    ...review,
    evaluation: { ...review.evaluation, metrics: sparseMetrics },
  }

  const withToJson = { ...review }
  Object.defineProperty(withToJson, 'toJSON', {
    value: () => ({ changed: true }),
    enumerable: true,
  })

  const withAccessor = { ...review }
  Object.defineProperty(withAccessor, 'predictionId', {
    get: () => 'changed',
    enumerable: true,
  })

  const withSymbol = { ...review } as Record<string | symbol, unknown>
  withSymbol[Symbol('hidden')] = 'ignored by JSON'

  const withNonEnumerable = { ...review }
  Object.defineProperty(withNonEnumerable, 'hidden', {
    value: 'ignored by JSON',
    enumerable: false,
  })

  for (const candidate of [
    withExtraField,
    withEvaluationExtra,
    withMetricExtra,
    withSparseMetrics,
    withToJson,
    withAccessor,
    withSymbol,
    withNonEnumerable,
  ]) {
    assert.equal(isReview(candidate), false)
    assert.throws(() => validateReview(candidate))
    assert.throws(() => serializeReview(candidate as never))
  }
})
