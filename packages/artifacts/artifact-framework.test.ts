import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createEvidence,
  createPrediction,
  createThesis,
  type Evidence,
  type Prediction,
  type Thesis,
} from './index.ts'

const sessionId = 'session-artifact-001'
const createdAt = '2026-08-23T10:00:00.000Z'

test('links Session, Evidence, Thesis and Prediction by stable IDs', () => {
  const evidence: Evidence = createEvidence({
    id: 'evidence-001',
    createdAt,
    sessionId,
    metadata: { kind: 'fixture' },
    source: 'test-source',
    content: 'Structured evidence fixture.',
    timestamp: createdAt,
    confidence: 0.9,
  })
  const thesis: Thesis = createThesis({
    id: 'thesis-001',
    createdAt,
    sessionId,
    metadata: { kind: 'fixture' },
    statement: 'Evidence supports a testable thesis.',
    evidenceIds: [evidence.id],
    confidence: 0.8,
    risks: ['Fixture data is not live data.'],
  })
  const prediction: Prediction = createPrediction({
    id: 'prediction-001',
    createdAt,
    sessionId,
    metadata: { kind: 'fixture' },
    thesisId: thesis.id,
    expectation: 'The test expectation remains observable.',
    evaluationPeriod: { start: createdAt, end: '2026-08-30T23:59:59.000Z' },
    metrics: { target: 1 },
  })

  assert.equal(evidence.sessionId, sessionId)
  assert.equal(thesis.sessionId, sessionId)
  assert.equal(prediction.sessionId, sessionId)
  assert.deepEqual(thesis.evidenceIds, [evidence.id])
  assert.equal(prediction.thesisId, thesis.id)
})
