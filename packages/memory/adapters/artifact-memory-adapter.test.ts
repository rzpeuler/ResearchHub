import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  createPrediction,
  createThesis,
  deserializePrediction,
  deserializeThesis,
  serializePrediction,
  serializeThesis,
} from '../../artifacts/index.ts'
import { ArtifactValidationError } from '../../artifacts/core/errors.ts'
import { MemoryDuplicateError } from '../core/errors.ts'
import type { MemoryEntry, MemoryEntryPatch, MemoryPlugin } from '../core/index.ts'
import { LocalJsonMemoryPlugin } from '../plugins/local-json-memory-plugin.ts'
import { ArtifactMemoryAdapter } from './artifact-memory-adapter.ts'

const thesis = createThesis({
  id: 'thesis-001',
  createdAt: '2026-08-23T09:10:00.000Z',
  sessionId: 'session-001',
  metadata: { category: 'research' },
  statement: 'The evidence supports a testable research thesis.',
  evidenceIds: ['evidence-001'],
  confidence: 0.7,
  risks: ['Fixture data is not a live market source.'],
})

const prediction = createPrediction({
  id: 'prediction-001',
  createdAt: '2026-08-23T09:20:00.000Z',
  sessionId: 'session-001',
  metadata: { category: 'forecast' },
  thesisId: thesis.id,
  expectation: 'The test subject will meet the stated expectation.',
  evaluationPeriod: {
    start: '2026-08-24T00:00:00.000Z',
    end: '2026-08-31T23:59:59.000Z',
  },
  metrics: { target: 1, unit: 'fixture' },
})

class InMemoryPlugin implements MemoryPlugin {
  readonly entries: MemoryEntry[] = []

  async save(entry: MemoryEntry): Promise<MemoryEntry> {
    if (this.entries.some((storedEntry) => storedEntry.id === entry.id)) {
      throw new MemoryDuplicateError(entry.id)
    }

    this.entries.push(entry)
    return entry
  }

  async retrieve(): Promise<MemoryEntry[]> {
    return [...this.entries]
  }

  async update(id: string, patch: MemoryEntryPatch): Promise<MemoryEntry> {
    const entry = this.entries.find((candidate) => candidate.id === id)
    if (entry === undefined) {
      throw new Error(`missing entry: ${id}`)
    }

    Object.assign(entry, patch)
    return entry
  }
}

function expectedThesisEntry(): MemoryEntry {
  return {
    id: 'memory:thesis:thesis-001',
    type: 'thesis',
    content: serializeThesis(thesis),
    sourceArtifactId: thesis.id,
    createdAt: thesis.createdAt,
    metadata: { sessionId: thesis.sessionId, artifactType: 'thesis' },
  }
}

function expectedPredictionEntry(): MemoryEntry {
  return {
    id: 'memory:prediction:prediction-001',
    type: 'prediction',
    content: serializePrediction(prediction),
    sourceArtifactId: prediction.id,
    createdAt: prediction.createdAt,
    metadata: { sessionId: prediction.sessionId, artifactType: 'prediction' },
  }
}

test('maps Thesis to a deterministic Memory Entry with session metadata', async () => {
  const plugin = new InMemoryPlugin()
  const adapter = new ArtifactMemoryAdapter(plugin)

  const saved = await adapter.saveThesis(thesis)
  assert.deepEqual(deserializeThesis(saved.content), thesis)
  assert.deepEqual(saved, expectedThesisEntry())
  assert.deepEqual(await plugin.retrieve(), [expectedThesisEntry()])
})

test('maps Prediction and dispatches supported artifacts through saveArtifact', async () => {
  const plugin = new InMemoryPlugin()
  const adapter = new ArtifactMemoryAdapter(plugin)

  const saved = await adapter.savePrediction(prediction)
  assert.deepEqual(deserializePrediction(saved.content), prediction)
  assert.deepEqual(saved, expectedPredictionEntry())

  const dispatchPlugin = new InMemoryPlugin()
  const dispatchAdapter = new ArtifactMemoryAdapter(dispatchPlugin)
  assert.deepEqual(await dispatchAdapter.saveArtifact(thesis), expectedThesisEntry())
  assert.deepEqual(await dispatchAdapter.saveArtifact(prediction), expectedPredictionEntry())
})

test('rejects unsupported artifact types', async () => {
  const adapter = new ArtifactMemoryAdapter(new InMemoryPlugin())

  await assert.rejects(
    () => adapter.saveArtifact({ type: 'evidence', id: 'evidence-001' } as never),
    /supports Thesis and Prediction artifacts only/,
  )
})

test('rejects Thesis and Prediction values with malicious toJSON hooks before saving', async () => {
  const plugin = new InMemoryPlugin()
  const adapter = new ArtifactMemoryAdapter(plugin)
  const maliciousThesis = {
    ...thesis,
    toJSON: () => ({ id: 'spoofed-thesis' }),
  } as never
  const maliciousPrediction = {
    ...prediction,
    metrics: {
      ...prediction.metrics,
      toJSON: () => ({ target: 'spoofed' }),
    },
  } as never

  await assert.rejects(() => adapter.saveThesis(maliciousThesis), ArtifactValidationError)
  await assert.rejects(() => adapter.savePrediction(maliciousPrediction), ArtifactValidationError)
  assert.deepEqual(await plugin.retrieve(), [])
})

test('persists mapped artifacts and retrieves them after plugin restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'researchhub-artifact-memory-'))
  const filePath = join(directory, 'memory.json')

  try {
    const firstAdapter = new ArtifactMemoryAdapter(new LocalJsonMemoryPlugin(filePath))
    await firstAdapter.saveArtifact(thesis)
    await firstAdapter.saveArtifact(prediction)

    const secondPlugin = new LocalJsonMemoryPlugin(filePath)
    assert.deepEqual(await secondPlugin.retrieve({ sourceArtifactId: thesis.id }), [expectedThesisEntry()])
    assert.deepEqual(await secondPlugin.retrieve({ sessionId: prediction.sessionId, type: 'prediction' }), [expectedPredictionEntry()])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('keeps deterministic duplicate IDs plugin-owned and does not upsert', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'researchhub-artifact-memory-'))
  const plugin = new LocalJsonMemoryPlugin(join(directory, 'memory.json'))
  const adapter = new ArtifactMemoryAdapter(plugin)

  try {
    await adapter.saveThesis(thesis)
    await assert.rejects(() => adapter.saveThesis(thesis), MemoryDuplicateError)
    assert.deepEqual(await plugin.retrieve(), [expectedThesisEntry()])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
