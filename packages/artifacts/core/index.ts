export { ArtifactValidationError } from './errors.ts';
export { deserializeArtifact, serializeArtifact, type ArtifactValidator } from './serialization.ts';
export { ARTIFACT_TYPES } from './types.ts';
export type { ArtifactBase, ArtifactType, JsonObject, JsonPrimitive, JsonValue } from './types.ts';
export {
  isArtifactType,
  isIsoTimestamp,
  isJsonObject,
  isJsonValue,
  assertConfidence,
  assertNonEmptyString,
  assertStringArray,
  assertTimestamp,
  validateArtifactBase,
} from './validation.ts';
