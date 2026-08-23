import {
  assertConfidence,
  assertNonEmptyString,
  assertTimestamp,
  deserializeArtifact,
  serializeArtifact,
  validateArtifactBase,
  type ArtifactBase,
} from '../core/index.ts'

export type Evidence = ArtifactBase<'evidence'> & {
  source: string
  content: string
  timestamp: string
  confidence: number
}

export type EvidenceInput = Omit<Evidence, 'type'>

export function createEvidence(input: EvidenceInput): Evidence {
  const candidate: unknown = {
    ...input,
    type: 'evidence',
  }

  validateEvidence(candidate)
  return { ...candidate, metadata: { ...candidate.metadata } }
}

export function validateEvidence(value: unknown): asserts value is Evidence {
  validateArtifactBase(value, 'evidence')
  const record = value as unknown as Record<string, unknown>

  assertNonEmptyString(record.source, '$.source')
  assertNonEmptyString(record.content, '$.content')
  assertTimestamp(record.timestamp, '$.timestamp')
  assertConfidence(record.confidence)
}

export function isEvidence(value: unknown): value is Evidence {
  try {
    validateEvidence(value)
    return true
  } catch {
    return false
  }
}

export function serializeEvidence(evidence: Evidence): string {
  return serializeArtifact(evidence, validateEvidence)
}

export function deserializeEvidence(serialized: string): Evidence {
  return deserializeArtifact(serialized, validateEvidence)
}
