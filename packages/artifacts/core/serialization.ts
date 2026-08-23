import { ArtifactValidationError } from './errors.ts';
import { isJsonObject } from './validation.ts';
import type { ArtifactBase } from './types.ts';

export type ArtifactValidator<TArtifact extends ArtifactBase> = (value: unknown) => asserts value is TArtifact;

/** Serializes a JSON-safe artifact after validating its shared envelope. */
export function serializeArtifact<TArtifact extends ArtifactBase>(
  artifact: TArtifact,
  validate: ArtifactValidator<TArtifact>,
): string {
  validate(artifact);

  if (!isJsonObject(artifact)) {
    throw new ArtifactValidationError('artifact must be a plain JSON-safe object');
  }

  try {
    const serialized = JSON.stringify(artifact);
    if (serialized === undefined) {
      throw new ArtifactValidationError('artifact could not be serialized');
    }

    return serialized;
  } catch (error) {
    if (error instanceof ArtifactValidationError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : 'artifact could not be serialized';
    throw new ArtifactValidationError(message);
  }
}

/** Parses and validates the shared envelope of a serialized artifact. */
export function deserializeArtifact<TArtifact extends ArtifactBase = ArtifactBase>(
  serialized: string,
  validate: ArtifactValidator<TArtifact>,
): TArtifact {
  if (typeof serialized !== 'string') {
    throw new ArtifactValidationError('serialized artifact must be a string');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid JSON';
    throw new ArtifactValidationError(`invalid JSON: ${message}`);
  }

  validate(parsed);
  return parsed;
}
