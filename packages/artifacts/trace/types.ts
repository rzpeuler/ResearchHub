export const TRACE_PROTOCOL_VERSION = '0.1' as const

export const TRACE_EVENT_TYPES = [
  'artifact_created',
  'artifact_updated',
  'artifact_derived',
  'artifact_linked',
  'artifact_validated',
] as const

export type TraceEventType = (typeof TRACE_EVENT_TYPES)[number]

export const LINEAGE_RELATION_TYPES = [
  'derived_from',
  'supports',
  'contains',
  'supersedes',
] as const

export type LineageRelationType = (typeof LINEAGE_RELATION_TYPES)[number]

export type TraceArtifactType = string

export interface ArtifactReference {
  artifactId: string
  artifactType: TraceArtifactType
  version: number
}
export interface LineageRelation {
  relationType: LineageRelationType
  from: ArtifactReference
  to: ArtifactReference
}

export interface TraceMetadata {
  createdAt: string
  createdBy: string
  skillId?: string
  workflowId?: string
  version: number
}

export interface TraceEvent {
  protocolVersion: typeof TRACE_PROTOCOL_VERSION
  eventId: string
  eventType: TraceEventType
  timestamp: string
  artifactReference: ArtifactReference
  sourceArtifacts: ArtifactReference[]
  relations: LineageRelation[]
  metadata: TraceMetadata
}

export interface TraceLineage {
  root: ArtifactReference
  artifacts: ArtifactReference[]
  relations: LineageRelation[]
  events: TraceEvent[]
}

export interface TraceStore {
  append(event: TraceEvent): void
  queryByArtifact(artifactId: string): TraceEvent[]
  queryLineage(artifactId: string): TraceLineage
  getHistory(artifactId: string): TraceEvent[]
}
