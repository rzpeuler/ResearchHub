import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createPrediction } from '../../artifacts/prediction/index.ts'
import {
  deserializeReview,
  type Review,
} from '../../artifacts/review/index.ts'
import { evaluatePrediction } from '../../evaluation/core/index.ts'
import { createOutcome } from '../../evaluation/outcome/index.ts'
import { MemoryDuplicateError } from '../core/errors.ts'
import type { MemoryEntry } from '../core/index.ts'
import { MemoryValidationError } from '../core/errors.ts'
import { LocalJsonMemoryProvider } from '../providers/local-json-memory-provider.ts'
import { ReviewMemoryAdapter } from './review-memory-adapter.ts'

const prediction = createPrediction({
  id: 'prediction-review-memory-001',
  createdAt: '2026-08-23T09:20:00.000Z',
  sessionId: 'session-review-memory-001',
  metadata: { category: 'forecast' },
  thesisId: 'thesis-001',
  expectation: 'The observed metric will match the expected fixture.',
  evaluationPeriod: {
    start: '2026-08-23T00:00:00.000Z',
    end: '2026-08-31T23:59:59.000Z',
  },
  metrics: { exact: 10 },
})

const outcome = createOutcome({
  description: 'Observed fixture result.',
  timestamp: '2026-08-23T12:00:00.000Z',
  source: 'validation-fixture',
  metrics: { exact: 10 },
})

const review = evaluatePrediction(prediction, outcome, {
  idFactory: () => 'review-memory-001',
  clock: () => '2026-08-23T12:01:00.000Z',
  metadata: { category: 'evaluation' },
})

function expectedEntry(): MemoryEntry {
  return {
    id: 'memory:review:review-memory-001',
    type: 'review',
    content: JSON.stringify(review),
    sourceArtifactId: review.id,
    createdAt: review.createdAt,
    metadata: { sessionId: review.sessionId, artifactType: 'review' },
  }
}

test('maps Evaluation Engine Review to LocalJsonMemoryProvider and retrieves it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'researchhub-review-memory-'))
  const filePath = join(directory, 'memory.json')

  try {
    const provider = new LocalJsonMemoryProvider(filePath)
    const adapter = new ReviewMemoryAdapter(provider)

    const saved = await adapter.saveReview(review)
    assert.deepEqual(saved, expectedEntry())
    assert.deepEqual(deserializeReview(saved.content), review)

    const restored = await new LocalJsonMemoryProvider(filePath).retrieve({
      type: 'review',
      sessionId: review.sessionId,
    })
    assert.deepEqual(restored, [expectedEntry()])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('uses deterministic Review memory IDs across adapter instances', async () => {
  const firstDirectory = await mkdtemp(join(tmpdir(), 'researchhub-review-memory-'))
  const secondDirectory = await mkdtemp(join(tmpdir(), 'researchhub-review-memory-'))

  try {
    const first = await new ReviewMemoryAdapter(
      new LocalJsonMemoryProvider(join(firstDirectory, 'memory.json')),
    ).saveReview(review)
    const second = await new ReviewMemoryAdapter(
      new LocalJsonMemoryProvider(join(secondDirectory, 'memory.json')),
    ).saveReview(review)

    assert.equal(first.id, 'memory:review:review-memory-001')
    assert.equal(second.id, first.id)
  } finally {
    await Promise.all([
      rm(firstDirectory, { recursive: true, force: true }),
      rm(secondDirectory, { recursive: true, force: true }),
    ])
  }
})

test('leaves duplicate Review handling to the injected provider', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'researchhub-review-memory-'))
  const provider = new LocalJsonMemoryProvider(join(directory, 'memory.json'))
  const adapter = new ReviewMemoryAdapter(provider)

  try {
    await adapter.saveReview(review)
    await assert.rejects(() => adapter.saveReview(review), MemoryDuplicateError)
    assert.deepEqual(await provider.retrieve(), [expectedEntry()])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('rejects invalid and unsafe Reviews before invoking the provider', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'researchhub-review-memory-'))
  const provider = new LocalJsonMemoryProvider(join(directory, 'memory.json'))
  const adapter = new ReviewMemoryAdapter(provider)
  const invalidReview = { ...review, id: '' } as never
  const unsafeReview = { ...review } as Review & { toJSON: () => unknown }
  Object.defineProperty(unsafeReview, 'toJSON', { value: () => ({ id: 'spoofed' }) })

  try {
    await assert.rejects(() => adapter.saveReview(invalidReview))
    await assert.rejects(() => adapter.saveReview(unsafeReview))
    assert.deepEqual(await provider.retrieve(), [])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('rejects Object.prototype.toJSON pollution for save, retrieve, and Review adapter flows', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'researchhub-review-memory-'))
  const filePath = join(directory, 'memory.json')
  const provider = new LocalJsonMemoryProvider(filePath)
  const adapter = new ReviewMemoryAdapter(provider)
  const originalDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON')

  try {
    Object.defineProperty(Object.prototype, 'toJSON', {
      configurable: true,
      enumerable: false,
      value: () => ({ spoofed: true }),
      writable: true,
    })

    await assert.rejects(() => provider.save(expectedEntry()), MemoryValidationError)
    await assert.rejects(() => provider.retrieve(), MemoryValidationError)
    await assert.rejects(() => adapter.saveReview(review))
  } finally {
    if (originalDescriptor === undefined) {
      Reflect.deleteProperty(Object.prototype, 'toJSON')
    } else {
      Object.defineProperty(Object.prototype, 'toJSON', originalDescriptor)
    }
    await rm(directory, { recursive: true, force: true })
  }
})
