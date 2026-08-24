import assert from 'node:assert/strict'
import test from 'node:test'
import type { ResearchObjectEnvelope } from './research-object.js'

test('Research Object envelope keeps the public fields stable', () => {
  const object: ResearchObjectEnvelope<{ company: string }> = {
    objectId: 'company-600519',
    objectType: 'company',
    createdAt: '2026-08-25T00:00:00.000Z',
    sourceWorkflow: 'equity-research',
    sourceSkill: 'company-research',
    version: 1,
    payload: { company: '600519' },
  }

  assert.deepEqual(object.payload, { company: '600519' })
  assert.equal(object.version, 1)
})
