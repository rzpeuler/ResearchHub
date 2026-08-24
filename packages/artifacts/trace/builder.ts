import {
  createEvidence,
  type Evidence,
  type EvidenceInput,
} from '../evidence/index.ts'
import {
  createPrediction,
  type Prediction,
  type PredictionInput,
} from '../prediction/index.ts'
import {
  createThesis,
  type Thesis,
  type ThesisInput,
} from '../thesis/index.ts'
import {
  createArtifactCreatedEvent,
  createArtifactDerivedEvent,
  createArtifactLinkedEvent,
  createLineageRelation,
} from './events.ts'
import type { ArtifactReference, TraceMetadata, TraceStore } from './types.ts'

export interface TraceArtifactBuilderOptions {
  store: TraceStore
  eventIdFactory?: () => string
  clock?: () => string
}
export class TraceArtifactBuilder {
  private readonly eventIdFactory: () => string
  private readonly clock: () => string

  constructor(private readonly options: TraceArtifactBuilderOptions) {
    this.eventIdFactory = options.eventIdFactory ?? (() => crypto.randomUUID())
    this.clock = options.clock ?? (() => new Date().toISOString())
  }

  createEvidence(input: EvidenceInput, metadata: TraceMetadata): Evidence {
    const artifact = createEvidence(input)
    this.options.store.append(
      createArtifactCreatedEvent(toReference(artifact), metadata, this.eventIdFactory(), this.clock()),
    )
    return artifact
  }

  createThesis(input: ThesisInput, evidenceReferences: readonly ArtifactReference[], metadata: TraceMetadata): Thesis {
    const artifact = createThesis(input)
    const artifactReference = toReference(artifact)
    const relations = evidenceReferences.map((evidence) =>
      createLineageRelation('supports', evidence, artifactReference),
    )
    this.options.store.append(
      createArtifactDerivedEvent(
        artifactReference,
        evidenceReferences,
        metadata,
        this.eventIdFactory(),
        this.clock(),
        relations,
      ),
    )
    return artifact
  }

  createPrediction(input: PredictionInput, thesisReference: ArtifactReference, metadata: TraceMetadata): Prediction {
    const artifact = createPrediction(input)
    const artifactReference = toReference(artifact)
    const relation = createLineageRelation('derived_from', thesisReference, artifactReference)
    this.options.store.append(
      createArtifactDerivedEvent(
        artifactReference,
        [thesisReference],
        metadata,
        this.eventIdFactory(),
        this.clock(),
        [relation],
      ),
    )
    return artifact
  }

  linkResearchReport(
    reportReference: ArtifactReference,
    containedReferences: readonly ArtifactReference[],
    metadata: TraceMetadata,
  ): void {
    const relations = containedReferences.map((reference) =>
      createLineageRelation('contains', reportReference, reference),
    )
    this.options.store.append(
      createArtifactLinkedEvent(
        reportReference,
        relations,
        metadata,
        this.eventIdFactory(),
        this.clock(),
        containedReferences,
      ),
    )
  }
}

function toReference(artifact: { id: string; type: string; metadata: { version?: unknown } }): ArtifactReference {
  const version = artifact.metadata.version
  return {
    artifactId: artifact.id,
    artifactType: artifact.type,
    version: typeof version === 'number' && Number.isInteger(version) && version > 0 ? version : 1,
  }
}
