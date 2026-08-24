import { validateTraceEvent } from '../events.ts'
import type {
  ArtifactReference,
  LineageRelation,
  TraceEvent,
  TraceLineage,
  TraceStore,
} from '../types.ts'

export class InMemoryTraceStore implements TraceStore {
  private readonly events: TraceEvent[] = []
  private readonly eventIds = new Set<string>()

  append(event: TraceEvent): void {
    validateTraceEvent(event)
    if (this.eventIds.has(event.eventId)) throw new Error(`duplicate trace event id: ${event.eventId}`)

    this.events.push(cloneEvent(event))
    this.eventIds.add(event.eventId)
  }

  queryByArtifact(artifactId: string): TraceEvent[] {
    assertArtifactId(artifactId)
    return this.events
      .filter((event) => eventReferencesArtifact(event, artifactId))
      .map(cloneEvent)
  }

  getHistory(artifactId: string): TraceEvent[] {
    assertArtifactId(artifactId)
    return this.events
      .filter((event) => event.artifactReference.artifactId === artifactId)
      .map(cloneEvent)
  }

  queryLineage(artifactId: string): TraceLineage {
    assertArtifactId(artifactId)
    const root = findReference(this.events, artifactId)
    if (!root) {
      throw new Error(`no trace found for artifact: ${artifactId}`)
    }

    const relations = allRelations(this.events)
    const connected = collectConnectedArtifacts(root, relations)
    const relevantRelations = relations.filter(
      (relation) => connected.has(referenceKey(relation.from)) && connected.has(referenceKey(relation.to)),
    )
    const relevantEvents = this.events.filter((event) => {
      const primary = referenceKey(event.artifactReference)
      return connected.has(primary) || event.relations.some((relation) =>
        connected.has(referenceKey(relation.from)) && connected.has(referenceKey(relation.to)),
      )
    })

    return {
      root: { ...root },
      artifacts: [...connected].map(parseReferenceKey),
      relations: relevantRelations.map(cloneRelation),
      events: relevantEvents.map(cloneEvent),
    }
  }
}
function eventReferencesArtifact(event: TraceEvent, artifactId: string): boolean {
  return (
    event.artifactReference.artifactId === artifactId ||
    event.sourceArtifacts.some((reference) => reference.artifactId === artifactId) ||
    event.relations.some(
      (relation) => relation.from.artifactId === artifactId || relation.to.artifactId === artifactId,
    )
  )
}

function findReference(events: readonly TraceEvent[], artifactId: string): ArtifactReference | undefined {
  for (const event of events) {
    if (event.artifactReference.artifactId === artifactId) return event.artifactReference
    const related = [...event.sourceArtifacts, ...event.relations.flatMap((relation) => [relation.from, relation.to])]
    const match = related.find((reference) => reference.artifactId === artifactId)
    if (match) return match
  }
  return undefined
}

function allRelations(events: readonly TraceEvent[]): LineageRelation[] {
  const relations: LineageRelation[] = []
  const keys = new Set<string>()

  for (const event of events) {
    for (const relation of event.relations) {
      const key = `${relation.relationType}:${referenceKey(relation.from)}:${referenceKey(relation.to)}`
      if (!keys.has(key)) {
        keys.add(key)
        relations.push(relation)
      }
    }
  }
  return relations
}

function collectConnectedArtifacts(root: ArtifactReference, relations: readonly LineageRelation[]): Set<string> {
  const connected = new Set<string>([referenceKey(root)])
  let changed = true

  while (changed) {
    changed = false
    for (const relation of relations) {
      const fromKey = referenceKey(relation.from)
      const toKey = referenceKey(relation.to)
      if (connected.has(fromKey) && !connected.has(toKey)) {
        connected.add(toKey)
        changed = true
      } else if (connected.has(toKey) && !connected.has(fromKey)) {
        connected.add(fromKey)
        changed = true
      }
    }
  }
  return connected
}

function cloneEvent(event: TraceEvent): TraceEvent {
  return {
    ...event,
    artifactReference: { ...event.artifactReference },
    sourceArtifacts: event.sourceArtifacts.map((reference) => ({ ...reference })),
    relations: event.relations.map(cloneRelation),
    metadata: { ...event.metadata },
  }
}

function cloneRelation(relation: LineageRelation): LineageRelation {
  return { relationType: relation.relationType, from: { ...relation.from }, to: { ...relation.to } }
}

function referenceKey(reference: ArtifactReference): string {
  return JSON.stringify([reference.artifactType, reference.artifactId, reference.version])
}

function parseReferenceKey(key: string): ArtifactReference {
  const value: unknown = JSON.parse(key)
  if (!Array.isArray(value) || value.length !== 3 || typeof value[0] !== 'string' || typeof value[1] !== 'string' || typeof value[2] !== 'number') {
    throw new Error(`invalid reference key: ${key}`)
  }
  return { artifactType: value[0], artifactId: value[1], version: value[2] }
}

function assertArtifactId(value: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error('artifactId must be non-empty')
}
