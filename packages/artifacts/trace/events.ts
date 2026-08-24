import {
  LINEAGE_RELATION_TYPES,
  TRACE_EVENT_TYPES,
  TRACE_PROTOCOL_VERSION,
  type ArtifactReference,
  type LineageRelation,
  type TraceEvent,
  type TraceEventType,
  type TraceMetadata,
} from './types.ts'

export type TraceEventInput = Omit<TraceEvent, 'protocolVersion'>

export function createTraceEvent(input: TraceEventInput): TraceEvent {
  for (const forbiddenKey of ['prompt', 'token', 'modelReasoning', 'runtimeLog', 'runtime']) {
    if (forbiddenKey in (input as unknown as Record<string, unknown>)) {
      throw new Error(`trace event cannot contain ${forbiddenKey}`)
    }
  }

  const event: TraceEvent = {
    protocolVersion: TRACE_PROTOCOL_VERSION,
    eventId: input.eventId,
    eventType: input.eventType,
    timestamp: input.timestamp,
    artifactReference: cloneReference(input.artifactReference),
    sourceArtifacts: input.sourceArtifacts.map(cloneReference),
    relations: input.relations.map(cloneRelation),
    metadata: { ...input.metadata },
  }

  validateTraceEvent(event)
  return event
}

export function createArtifactCreatedEvent(
  artifactReference: ArtifactReference,
  metadata: TraceMetadata,
  eventId: string,
  timestamp: string,
): TraceEvent {
  return createEvent('artifact_created', artifactReference, metadata, eventId, timestamp)
}

export function createArtifactUpdatedEvent(
  artifactReference: ArtifactReference,
  metadata: TraceMetadata,
  eventId: string,
  timestamp: string,
  sourceArtifacts: readonly ArtifactReference[] = [],
  relations: readonly LineageRelation[] = [],
): TraceEvent {
  return createEvent(
    'artifact_updated',
    artifactReference,
    metadata,
    eventId,
    timestamp,
    sourceArtifacts,
    relations,
  )
}

export function createArtifactDerivedEvent(
  artifactReference: ArtifactReference,
  sourceArtifacts: readonly ArtifactReference[],
  metadata: TraceMetadata,
  eventId: string,
  timestamp: string,
  relations: readonly LineageRelation[] = [],
): TraceEvent {
  return createEvent(
    'artifact_derived',
    artifactReference,
    metadata,
    eventId,
    timestamp,
    sourceArtifacts,
    relations,
  )
}

export function createArtifactLinkedEvent(
  artifactReference: ArtifactReference,
  relations: readonly LineageRelation[],
  metadata: TraceMetadata,
  eventId: string,
  timestamp: string,
  sourceArtifacts: readonly ArtifactReference[] = [],
): TraceEvent {
  return createEvent(
    'artifact_linked',
    artifactReference,
    metadata,
    eventId,
    timestamp,
    sourceArtifacts,
    relations,
  )
}

export function createArtifactValidatedEvent(
  artifactReference: ArtifactReference,
  metadata: TraceMetadata,
  eventId: string,
  timestamp: string,
): TraceEvent {
  return createEvent('artifact_validated', artifactReference, metadata, eventId, timestamp)
}

export function validateTraceEvent(value: unknown): asserts value is TraceEvent {
  if (!isRecord(value)) throw new Error('trace event must be an object')
  if (value.protocolVersion !== TRACE_PROTOCOL_VERSION) {
    throw new Error(`unsupported trace protocol version: ${String(value.protocolVersion)}`)
  }
  assertNonEmptyString(value.eventId, 'eventId')
  assertOneOf(value.eventType, TRACE_EVENT_TYPES, 'eventType')
  assertTimestamp(value.timestamp, 'timestamp')
  validateReference(value.artifactReference, 'artifactReference')
  validateReferenceArray(value.sourceArtifacts, 'sourceArtifacts')
  validateRelationArray(value.relations, 'relations')
  validateMetadata(value.metadata)

  for (const forbiddenKey of ['prompt', 'token', 'modelReasoning', 'runtimeLog', 'runtime']) {
    if (forbiddenKey in value) throw new Error(`trace event cannot contain ${forbiddenKey}`)
  }
}

export function createLineageRelation(
  relationType: LineageRelation['relationType'],
  from: ArtifactReference,
  to: ArtifactReference,
): LineageRelation {
  const relation = { relationType, from: cloneReference(from), to: cloneReference(to) }
  validateRelation(relation, 'relation')
  return relation
}

function createEvent(
  eventType: TraceEventType,
  artifactReference: ArtifactReference,
  metadata: TraceMetadata,
  eventId: string,
  timestamp: string,
  sourceArtifacts: readonly ArtifactReference[] = [],
  relations: readonly LineageRelation[] = [],
): TraceEvent {
  return createTraceEvent({
    eventId,
    eventType,
    timestamp,
    artifactReference,
    sourceArtifacts: [...sourceArtifacts],
    relations: [...relations],
    metadata,
  })
}

function validateReference(value: unknown, path: string): asserts value is ArtifactReference {
  if (!isRecord(value)) throw new Error(`${path} must be an object`)
  assertNonEmptyString(value.artifactId, `${path}.artifactId`)
  assertNonEmptyString(value.artifactType, `${path}.artifactType`)
  if (typeof value.version !== 'number' || !Number.isInteger(value.version) || value.version < 1) {
    throw new Error(`${path}.version must be a positive integer`)
  }
}

function validateReferenceArray(value: unknown, path: string): asserts value is ArtifactReference[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`)
  value.forEach((item, index) => validateReference(item, `${path}[${index}]`))
}

function validateRelation(value: unknown, path: string): asserts value is LineageRelation {
  if (!isRecord(value)) throw new Error(`${path} must be an object`)
  assertOneOf(value.relationType, LINEAGE_RELATION_TYPES, `${path}.relationType`)
  validateReference(value.from, `${path}.from`)
  validateReference(value.to, `${path}.to`)
}

function validateRelationArray(value: unknown, path: string): asserts value is LineageRelation[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`)
  value.forEach((item, index) => validateRelation(item, `${path}[${index}]`))
}

function validateMetadata(value: unknown): asserts value is TraceMetadata {
  if (!isRecord(value)) throw new Error('metadata must be an object')
  assertTimestamp(value.createdAt, 'metadata.createdAt')
  assertNonEmptyString(value.createdBy, 'metadata.createdBy')
  if (value.skillId !== undefined) assertNonEmptyString(value.skillId, 'metadata.skillId')
  if (value.workflowId !== undefined) assertNonEmptyString(value.workflowId, 'metadata.workflowId')
  if (typeof value.version !== 'number' || !Number.isInteger(value.version) || value.version < 1) {
    throw new Error('metadata.version must be a positive integer')
  }
}

function assertNonEmptyString(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${path} must be a non-empty string`)
  }
}

function assertTimestamp(value: unknown, path: string): asserts value is string {
  assertNonEmptyString(value, path)
  if (Number.isNaN(Date.parse(value))) throw new Error(`${path} must be an ISO timestamp`)
}

function assertOneOf<T extends string>(value: unknown, values: readonly T[], path: string): asserts value is T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new Error(`${path} has an unsupported value`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cloneReference(reference: ArtifactReference): ArtifactReference {
  return { ...reference }
}

function cloneRelation(relation: LineageRelation): LineageRelation {
  return { relationType: relation.relationType, from: cloneReference(relation.from), to: cloneReference(relation.to) }
}
