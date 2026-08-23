import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MarketPluginError, timestampFromSource } from './market-types.ts'

test('timestamp normalization rejects impossible calendar dates without JavaScript rollover', () => {
  for (const value of ['2026-02-30', '2026-02-30T09:00:00.000Z', '20260230']) {
    assert.throws(
      () => timestampFromSource(value, () => new Date('2026-08-23T09:00:00.000Z')),
      (error: unknown) => error instanceof MarketPluginError
        && /invalid plugin timestamp/.test(error.message),
    )
  }
})

test('timestamp normalization preserves valid leap-day timestamps', () => {
  assert.equal(
    timestampFromSource('2024-02-29T09:00:00+08:00', () => new Date('2026-08-23T09:00:00.000Z')),
    '2024-02-29T01:00:00.000Z',
  )
})

test('timestamp normalization accepts only supported date and timezone-qualified ISO formats', () => {
  assert.equal(
    timestampFromSource('20260821', () => new Date('2026-08-23T09:00:00.000Z')),
    '2026-08-21T00:00:00.000Z',
  )
  assert.equal(
    timestampFromSource('2026-08-21', () => new Date('2026-08-23T09:00:00.000Z')),
    '2026-08-21T00:00:00.000Z',
  )
  assert.equal(
    timestampFromSource('2026-08-21T09:00:00.123Z', () => new Date('2026-08-23T09:00:00.000Z')),
    '2026-08-21T09:00:00.123Z',
  )
})

test('timestamp normalization rejects locale, ambiguous, and invalid ISO timestamps', () => {
  for (const value of [
    '2026/08/21',
    'August 21, 2026',
    '2026-08-21T09:00:00',
    '2026-08-21 09:00:00Z',
    '2026-08-21T09:00:00+0800',
    '2026-08-21T24:00:00Z',
    '2026-08-21T09:60:00Z',
    '2026-08-21T09:00:60Z',
    '2026-08-21T09:00:00+24:00',
  ]) {
    assert.throws(
      () => timestampFromSource(value, () => new Date('2026-08-23T09:00:00.000Z')),
      (error: unknown) => error instanceof MarketPluginError
        && /invalid plugin timestamp/.test(error.message),
      value,
    )
  }
})
