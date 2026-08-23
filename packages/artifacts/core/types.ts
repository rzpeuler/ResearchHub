/** JSON values accepted by artifact metadata and future artifact payloads. */
export type JsonPrimitive = null | boolean | number | string;

export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export type JsonObject = {
  [key: string]: JsonValue;
};

export const ARTIFACT_TYPES = ['evidence', 'thesis', 'prediction', 'review'] as const;

export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

/** Shared envelope carried by every ResearchHub artifact. */
export interface ArtifactBase<TType extends ArtifactType = ArtifactType> {
  id: string;
  type: TType;
  createdAt: string;
  sessionId: string;
  metadata: JsonObject;
}
