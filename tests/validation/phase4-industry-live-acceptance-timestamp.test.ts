import assert from 'node:assert/strict'
import test from 'node:test'
import { industryAcceptanceTimestamps } from '../../scripts/acceptance-industry-operating-observations-d4-real.ts'

test('Industry live acceptance records actual retrieval time separately from analysis cutoff', () => {
  const startedAt = '2026-10-08T14:37:45.722Z'
  assert.deepEqual(industryAcceptanceTimestamps(startedAt, '2026-10-01T00:00:00.000Z'), { startedAt, asOf: '2026-10-01T00:00:00.000Z' })
  assert.deepEqual(industryAcceptanceTimestamps(startedAt), { startedAt, asOf: startedAt })
})
