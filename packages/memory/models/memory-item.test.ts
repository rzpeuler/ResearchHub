import assert from 'node:assert/strict'
import test from 'node:test'
import { MemoryValidationError } from '../core/errors.ts'
import { validateMemoryItem, type MemoryItem } from './index.ts'

const item: MemoryItem = {
  id: 'memory:thesis:001',
  type: 'thesis',
  content: { statement: 'Operating margin remains resilient.' },
  sourceArtifacts: [{ artifactId: 'thesis-001', artifactType: 'thesis', version: 1 }],
  traceReferences: [{ eventId: 'trace-001', rootArtifactId: 'thesis-001' }],
  entity: '600519',
  topic: 'profitability',
  industry: 'beverages',
  confidence: 0.82,
  createdAt: '2026-08-24T00:00:00.000Z',
  metadata: { sessionId: 'session-001' },
}

test('validates a MemoryItem with Artifact and Trace references', () => {
  assert.doesNotThrow(() => validateMemoryItem(item))
  assert.doesNotThrow(() => validateMemoryItem({ ...item, traceReferences: ['trace-001'] }))
})

test('rejects Prompt, Token, and Model Reasoning payloads', () => {
  assert.throws(
    () => validateMemoryItem({ ...item, content: { statement: 'x', prompt: 'hidden prompt' } }),
    MemoryValidationError,
  )
  assert.throws(
    () => validateMemoryItem({ ...item, metadata: { token: 42 } }),
    MemoryValidationError,
  )
  assert.throws(
    () => validateMemoryItem({ ...item, content: { reasoning: 'hidden reasoning' } }),
    MemoryValidationError,
  )
})
