import assert from 'node:assert/strict'
import test from 'node:test'
import { createArtifactCreatedEvent } from '../../packages/artifacts/trace/index.ts'
import { InMemoryTraceStore } from '../../packages/artifacts/trace/index.ts'
import { InMemoryResearchMemoryStore, type MemoryItem } from '../../packages/memory/index.ts'

test('Artifact -> Trace -> Memory Reference chain remains queryable', () => {
  const traceStore = new InMemoryTraceStore()
  const artifactReference = { artifactId: 'thesis-600519-001', artifactType: 'thesis', version: 1 }
  const traceEvent = createArtifactCreatedEvent(
    artifactReference,
    {
      createdAt: '2026-08-24T00:00:00.000Z',
      createdBy: 'skill:equity-research',
      skillId: 'equity-research',
      workflowId: 'equity-research',
      version: 1,
    },
    'trace-thesis-600519-001',
    '2026-08-24T00:00:00.000Z',
  )
  traceStore.append(traceEvent)

  const memoryItem: MemoryItem = {
    id: 'memory:thesis:600519:001',
    type: 'thesis',
    content: { statement: '贵州茅台的核心盈利能力仍具韧性。' },
    sourceArtifacts: [artifactReference],
    traceReferences: [{ eventId: traceEvent.eventId, rootArtifactId: artifactReference.artifactId }],
    entity: '600519',
    topic: 'investment-value',
    industry: 'beverages',
    confidence: 0.8,
    createdAt: '2026-08-24T00:00:00.000Z',
    metadata: { source: 'equity-research-pipeline' },
  }
  const memory = new InMemoryResearchMemoryStore()
  memory.add(memoryItem)

  const retrieved = memory.search({ entity: '600519', type: 'thesis' })[0]
  assert.ok(retrieved)
  assert.equal(retrieved.sourceArtifacts[0]?.artifactId, artifactReference.artifactId)
  const traceReference = retrieved.traceReferences[0]
  assert.equal(typeof traceReference === 'string' ? traceReference : traceReference?.eventId, traceEvent.eventId)
  assert.deepEqual(traceStore.queryByArtifact(retrieved.sourceArtifacts[0]!.artifactId).map((event) => event.eventId), [traceEvent.eventId])
})
