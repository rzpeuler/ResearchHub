/** JSON values accepted by Memory Entry content metadata. */
export type JsonPrimitive = null | boolean | number | string;

export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export type JsonObject = {
  [key: string]: JsonValue;
};

export const MEMORY_ENTRY_TYPES = ['thesis', 'prediction', 'review'] as const;

export type MemoryEntryType = (typeof MEMORY_ENTRY_TYPES)[number];

/** A structured research record suitable for long-term storage. */
export interface MemoryEntry {
  id: string;
  type: MemoryEntryType;
  content: string;
  sourceArtifactId: string;
  createdAt: string;
  metadata: JsonObject;
}

/** Exact-match filters supported by the MVP plugin. */
export interface MemoryQuery {
  id?: string;
  type?: MemoryEntryType;
  sourceArtifactId?: string;
  /** Matches metadata.sessionId when present. */
  sessionId?: string;
}

/** Mutable fields accepted by MemoryPlugin.update(). */
export interface MemoryEntryPatch {
  content?: string;
  metadata?: JsonObject;
}
