import assert from 'node:assert/strict'
import test from 'node:test'
import {
  InMemoryTraceStore,
  TraceArtifactBuilder,
  createTraceEvent,
  type ArtifactReference,
  type TraceMetadata,
} from './index.ts'

const metadata: TraceMetadata = {
  createdAt: '2026-08-24T00:00:00.000Z',
  createdBy: 'skill:equity-research',
  skillId: 'equity-research',
  workflowId: 'equity-research',
  version: 1,
}
test('creates a trace event when an Evidence artifact is built', () => {
  const store = new InMemoryTraceStore()
  const builder = createBuilder(store)

  const evidence = builder.createEvidence(
    {
      id: 'evidence-001',
      createdAt: '2026-08-24T00:00:00.000Z',
      sessionId: 'session-001',
      metadata: {},
      source: 'official-filing',
      content: 'Revenue increased year over year.',
      timestamp: '2026-08-23T00:00:00.000Z',
      confidence: 0.95,
    },
    metadata,
  )

  const events = store.getHistory(evidence.id)
  assert.equal(events.length, 1)
  assert.equal(events[0].eventType, 'artifact_created')
  assert.deepEqual(events[0].artifactReference, {
    artifactId: evidence.id,
    artifactType: 'evidence',
    version: 1,
  })
})

test('records Thesis derivation from Evidence and Prediction derivation from Thesis', () => {
  const store = new InMemoryTraceStore()
  const builder = createBuilder(store)
  const evidence = builder.createEvidence(
    {
      id: 'evidence-002',
      createdAt: '2026-08-24T00:00:00.000Z',
      sessionId: 'session-001',
      metadata: {},
      source: 'financial-plugin',
      content: 'Operating margin was 30%.',
      timestamp: '2026-08-23T00:00:00.000Z',
      confidence: 0.9,
    },
    metadata,
  )
  const evidenceReference = reference('evidence', evidence.id)

  const thesis = builder.createThesis(
    {
      id: 'thesis-001',
      createdAt: '2026-08-24T00:00:00.000Z',
      sessionId: 'session-001',
      metadata: {},
      statement: 'The company has durable operating leverage.',
      evidenceIds: [evidence.id],
      confidence: 0.8,
      risks: ['Demand slowdown'],
    },
    [evidenceReference],
    metadata,
  )

  const thesisEvent = store.getHistory(thesis.id)[0]
  assert.equal(thesisEvent.eventType, 'artifact_derived')
  assert.equal(thesisEvent.relations[0].relationType, 'supports')
  assert.equal(thesisEvent.relations[0].from.artifactId, evidence.id)
  assert.equal(thesisEvent.relations[0].to.artifactId, thesis.id)

  const prediction = builder.createPrediction(
    {
      id: 'prediction-001',
      createdAt: '2026-08-24T00:00:00.000Z',
      sessionId: 'session-001',
      metadata: {},
      thesisId: thesis.id,
      expectation: 'Operating margin remains above 28%.',
      evaluationPeriod: {
        start: '2026-08-24T00:00:00.000Z',
        end: '2027-08-24T00:00:00.000Z',
      },
      metrics: { operatingMargin: 0.28 },
    },
    reference('thesis', thesis.id),
    metadata,
  )

  assert.equal(store.getHistory(prediction.id)[0].eventType, 'artifact_derived')
  assert.equal(store.getHistory(prediction.id)[0].relations[0].relationType, 'derived_from')
})

test('links a ResearchReport and queries the complete lineage graph', () => {
  const store = new InMemoryTraceStore()
  const builder = createBuilder(store)
  const evidenceId = 'evidence-003'
  const thesisId = 'thesis-002'
  const predictionId = 'prediction-002'
  const reportReference = reference('research_report', 'report-001')

  builder.createEvidence(
    {
      id: evidenceId,
      createdAt: '2026-08-24T00:00:00.000Z',
      sessionId: 'session-002',
      metadata: {},
      source: 'official-filing',
      content: 'Cash flow remained positive.',
      timestamp: '2026-08-23T00:00:00.000Z',
      confidence: 0.95,
    },
    metadata,
  )
  const thesis = builder.createThesis(
    {
      id: thesisId,
      createdAt: '2026-08-24T00:00:00.000Z',
      sessionId: 'session-002',
      metadata: {},
      statement: 'Cash generation supports resilience.',
      evidenceIds: [evidenceId],
      confidence: 0.85,
      risks: [],
    },
    [reference('evidence', evidenceId)],
    metadata,
  )
  const prediction = builder.createPrediction(
    {
      id: predictionId,
      createdAt: '2026-08-24T00:00:00.000Z',
      sessionId: 'session-002',
      metadata: {},
      thesisId,
      expectation: 'Cash flow stays positive.',
      evaluationPeriod: {
        start: '2026-08-24T00:00:00.000Z',
        end: '2027-08-24T00:00:00.000Z',
      },
      metrics: { freeCashFlow: 1 },
    },
    reference('thesis', thesis.id),
    metadata,
  )

  builder.linkResearchReport(reportReference, [reference('thesis', thesis.id), reference('prediction', prediction.id)], metadata)

  const lineage = store.queryLineage(reportReference.artifactId)
  const artifactIds = new Set(lineage.artifacts.map((artifact) => artifact.artifactId))
  assert.deepEqual(artifactIds, new Set(['report-001', predictionId, thesisId, evidenceId]))
  assert.ok(lineage.relations.some((relation) => relation.relationType === 'contains'))
  assert.ok(lineage.relations.some((relation) => relation.relationType === 'derived_from'))
  assert.ok(lineage.relations.some((relation) => relation.relationType === 'supports'))
  assert.equal(lineage.events.length, 4)
})

test('rejects duplicate events and prohibited runtime payloads', () => {
  const event = createTraceEvent({
    eventId: 'trace-001',
    eventType: 'artifact_created',
    timestamp: '2026-08-24T00:00:00.000Z',
    artifactReference: reference('evidence', 'evidence-004'),
    sourceArtifacts: [],
    relations: [],
    metadata,
  })
  const store = new InMemoryTraceStore()
  store.append(event)
  assert.throws(() => store.append(event), /duplicate trace event id/)
  assert.throws(
    () =>
      createTraceEvent({
        ...event,
        eventId: 'trace-002',
        prompt: 'must not be stored',
      } as never),
    /prompt/,
  )
})

function createBuilder(store: InMemoryTraceStore): TraceArtifactBuilder {
  let eventNumber = 0
  return new TraceArtifactBuilder({
    store,
    eventIdFactory: () => `trace-${++eventNumber}`,
    clock: () => '2026-08-24T00:00:00.000Z',
  })
}

function reference(artifactType: string, artifactId: string): ArtifactReference {
  return { artifactType, artifactId, version: 1 }
}
