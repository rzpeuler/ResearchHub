import assert from 'node:assert/strict'
import test from 'node:test'
import { MemoryDuplicateError } from '../core/errors.ts'
import { InMemoryResearchMemoryStore, type MemoryItem } from '../index.ts'

function item(overrides: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id: 'memory:evidence:001',
    type: 'evidence',
    content: { fact: 'Revenue increased.' },
    sourceArtifacts: [{ artifactId: 'evidence-001', artifactType: 'evidence', version: 1 }],
    traceReferences: [{ eventId: 'trace-001', rootArtifactId: 'evidence-001' }],
    entity: '600519',
    topic: 'revenue',
    industry: 'beverages',
    confidence: 0.9,
    createdAt: '2026-08-24T00:00:00.000Z',
    metadata: { provider: 'fixture' },
    ...overrides,
  }
}

test('adds and gets a defensive MemoryItem snapshot', () => {
  const store = new InMemoryResearchMemoryStore()
  const saved = store.add(item())
  const loaded = store.get(saved.id)

  assert.deepEqual(loaded, saved)
  assert.notStrictEqual(loaded, saved)
  assert.notStrictEqual(loaded?.sourceArtifacts, saved.sourceArtifacts)
  assert.throws(() => store.add(item()), MemoryDuplicateError)
})

test('retrieves Evidence by entity and filters by topic, type, industry, and confidence', () => {
  const store = new InMemoryResearchMemoryStore()
  store.add(item())
  store.add(item({
    id: 'memory:thesis:001',
    type: 'thesis',
    content: { statement: 'Margin remains resilient.' },
    sourceArtifacts: [{ artifactId: 'thesis-001', artifactType: 'thesis', version: 1 }],
    traceReferences: [{ eventId: 'trace-002', rootArtifactId: 'thesis-001' }],
    topic: 'profitability',
    confidence: 0.82,
  }))

  assert.equal(store.search({ entity: '600519' }).length, 2)
  assert.equal(store.search({ topic: 'revenue', type: 'evidence', industry: 'beverages' }).length, 1)
  assert.equal(store.search({ minConfidence: 0.85 }).length, 1)
  assert.equal(store.search({ confidence: 0.82 })[0]?.id, 'memory:thesis:001')
})

test('retrieves Thesis by source Artifact ID and removes it by Memory ID', () => {
  const store = new InMemoryResearchMemoryStore()
  const thesis = item({
    id: 'memory:thesis:002',
    type: 'thesis',
    sourceArtifacts: [{ artifactId: 'thesis-002', artifactType: 'thesis', version: 1 }],
    traceReferences: [{ eventId: 'trace-003', rootArtifactId: 'thesis-002' }],
  })
  store.add(thesis)

  assert.deepEqual(store.search({ artifactId: 'thesis-002' }).map((value) => value.id), [thesis.id])
  assert.equal(store.remove(thesis.id), true)
  assert.equal(store.get(thesis.id), undefined)
  assert.equal(store.remove(thesis.id), false)
})

test('stores Prediction Trace association without copying the source Artifact', () => {
  const store = new InMemoryResearchMemoryStore()
  const prediction = item({
    id: 'memory:prediction:001',
    type: 'prediction',
    content: { evaluationStatus: 'pending' },
    sourceArtifacts: [{ artifactId: 'prediction-001', artifactType: 'prediction', version: 1 }],
    traceReferences: [{ eventId: 'trace-prediction-001', rootArtifactId: 'prediction-001' }],
  })
  const saved = store.add(prediction)

  assert.deepEqual(saved.traceReferences, prediction.traceReferences)
  assert.equal('statement' in saved.content, false)
  assert.equal('source' in saved.content, false)
})
