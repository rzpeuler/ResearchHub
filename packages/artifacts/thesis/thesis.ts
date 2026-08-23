import {
  assertConfidence,
  assertNonEmptyString,
  assertStringArray,
  deserializeArtifact,
  serializeArtifact,
  validateArtifactBase,
  type ArtifactBase,
} from '../core/index.ts'

export type Thesis = ArtifactBase<'thesis'> & {
  statement: string
  evidenceIds: string[]
  confidence: number
  risks: string[]
}

export type ThesisInput = Omit<Thesis, 'type'>

export function createThesis(input: ThesisInput): Thesis {
  const candidate: unknown = {
    ...input,
    type: 'thesis',
  }

  validateThesis(candidate)
  return {
    ...candidate,
    evidenceIds: [...candidate.evidenceIds],
    risks: [...candidate.risks],
    metadata: { ...candidate.metadata },
  }
}

export function validateThesis(value: unknown): asserts value is Thesis {
  validateArtifactBase(value, 'thesis')
  const record = value as unknown as Record<string, unknown>

  assertNonEmptyString(record.statement, '$.statement')
  assertStringArray(record.evidenceIds, '$.evidenceIds')
  assertConfidence(record.confidence)
  assertStringArray(record.risks, '$.risks')
}

export function isThesis(value: unknown): value is Thesis {
  try {
    validateThesis(value)
    return true
  } catch {
    return false
  }
}

export function serializeThesis(thesis: Thesis): string {
  return serializeArtifact(thesis, validateThesis)
}

export function deserializeThesis(serialized: string): Thesis {
  return deserializeArtifact(serialized, validateThesis)
}
