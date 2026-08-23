import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createOutcome,
  deserializeOutcome,
  isOutcome,
  serializeOutcome,
  validateOutcome,
} from './index.ts'

const input = {
  description: 'Observed fixture result.',
  timestamp: '2026-08-23T12:00:00.000Z',
  source: 'validation-fixture',
  metrics: {
    target: 1,
    label: 'met',
    nested: { active: true },
  },
}

test('creates and validates a JSON-safe Outcome', () => {
  const outcome = createOutcome(input)

  assert.equal(outcome.description, input.description)
  assert.equal(outcome.source, input.source)
  assert.deepEqual(outcome.metrics, input.metrics)
  assert.equal(isOutcome(outcome), true)
})

test('rejects malformed Outcome fields and non-JSON metrics', () => {
  assert.throws(() => validateOutcome({ ...input, timestamp: 'not-a-timestamp' }))
  assert.throws(() => validateOutcome({ ...input, timestamp: '2026-02-30T12:00:00.000Z' }))
  assert.throws(() => createOutcome({ ...input, metrics: { invalid: undefined } as never }))

  const cyclicMetrics: Record<string, unknown> = {}
  cyclicMetrics.self = cyclicMetrics
  assert.throws(() => createOutcome({ ...input, metrics: cyclicMetrics as never }))

  const maliciousMetrics: Record<string, unknown> = { target: 1 }
  Object.defineProperty(maliciousMetrics, 'toJSON', {
    value: () => ({ target: 999 }),
    enumerable: true,
  })
  assert.throws(() => createOutcome({ ...input, metrics: maliciousMetrics as never }))
})

test('round-trips Outcome through JSON serialization', () => {
  const outcome = createOutcome(input)
  const restored = deserializeOutcome(serializeOutcome(outcome))

  assert.deepEqual(restored, outcome)
  assert.notStrictEqual(restored, outcome)
})

test('rejects malformed serialized Outcome data', () => {
  assert.throws(() => deserializeOutcome('{"description":"missing fields"}'))
  assert.throws(() => deserializeOutcome('not-json'))
})

test('keeps Outcome validation and serialization aligned for unsafe structure properties', () => {
  const sparseMetrics: unknown[] = []
  sparseMetrics.length = 2
  sparseMetrics[1] = 1

  const withExtraField = { ...input, extra: true }
  const withSparseMetrics = { ...input, metrics: { values: sparseMetrics } }

  const withToJson = { ...input }
  Object.defineProperty(withToJson, 'toJSON', {
    value: () => ({ changed: true }),
    enumerable: true,
  })

  const withAccessor = { ...input }
  Object.defineProperty(withAccessor, 'source', {
    get: () => 'changed',
    enumerable: true,
  })

  const withSymbol = { ...input } as Record<string | symbol, unknown>
  withSymbol[Symbol('hidden')] = 'ignored by JSON'

  const withNonEnumerable = { ...input }
  Object.defineProperty(withNonEnumerable, 'hidden', {
    value: 'ignored by JSON',
    enumerable: false,
  })

  for (const candidate of [
    withExtraField,
    withSparseMetrics,
    withToJson,
    withAccessor,
    withSymbol,
    withNonEnumerable,
  ]) {
    assert.equal(isOutcome(candidate), false)
    assert.throws(() => validateOutcome(candidate))
    assert.throws(() => serializeOutcome(candidate as never))
  }
})
