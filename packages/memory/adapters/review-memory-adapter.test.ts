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
import { LocalJsonMemoryPlugin } from '../plugins/local-json-memory-plugin.ts'
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

test('maps Evaluation Engine Review to LocalJsonMemoryPlugin and retrieves it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'researchhub-review-memory-'))
  const filePath = join(directory, 'memory.json')

  try {
    const plugin = new LocalJsonMemoryPlugin(filePath)
    const adapter = new ReviewMemoryAdapter(plugin)

    const saved = await adapter.saveReview(review)
    assert.deepEqual(saved, expectedEntry())
    assert.deepEqual(deserializeReview(saved.content), review)

    const restored = await new LocalJsonMemoryPlugin(filePath).retrieve({
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
      new LocalJsonMemoryPlugin(join(firstDirectory, 'memory.json')),
    ).saveReview(review)
    const second = await new ReviewMemoryAdapter(
      new LocalJsonMemoryPlugin(join(secondDirectory, 'memory.json')),
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

test('leaves duplicate Review handling to the injected plugin', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'researchhub-review-memory-'))
  const plugin = new LocalJsonMemoryPlugin(join(directory, 'memory.json'))
  const adapter = new ReviewMemoryAdapter(plugin)

  try {
    await adapter.saveReview(review)
    await assert.rejects(() => adapter.saveReview(review), MemoryDuplicateError)
    assert.deepEqual(await plugin.retrieve(), [expectedEntry()])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('rejects invalid and unsafe Reviews before invoking the plugin', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'researchhub-review-memory-'))
  const plugin = new LocalJsonMemoryPlugin(join(directory, 'memory.json'))
  const adapter = new ReviewMemoryAdapter(plugin)
  const invalidReview = { ...review, id: '' } as never
  const unsafeReview = { ...review } as Review & { toJSON: () => unknown }
  Object.defineProperty(unsafeReview, 'toJSON', { value: () => ({ id: 'spoofed' }) })

  try {
    await assert.rejects(() => adapter.saveReview(invalidReview))
    await assert.rejects(() => adapter.saveReview(unsafeReview))
    assert.deepEqual(await plugin.retrieve(), [])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('rejects Object.prototype.toJSON pollution for save, retrieve, and Review adapter flows', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'researchhub-review-memory-'))
  const filePath = join(directory, 'memory.json')
  const plugin = new LocalJsonMemoryPlugin(filePath)
  const adapter = new ReviewMemoryAdapter(plugin)
  const originalDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON')

  try {
    Object.defineProperty(Object.prototype, 'toJSON', {
      configurable: true,
      enumerable: false,
      value: () => ({ spoofed: true }),
      writable: true,
    })

    await assert.rejects(() => plugin.save(expectedEntry()), MemoryValidationError)
    await assert.rejects(() => plugin.retrieve(), MemoryValidationError)
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
