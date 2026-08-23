import type { MemoryEntry, MemoryEntryPatch, MemoryQuery } from './types.ts';

export interface MemoryProvider {
  save(entry: MemoryEntry): Promise<MemoryEntry>;
  retrieve(query?: MemoryQuery): Promise<MemoryEntry[]>;
  update(id: string, patch: MemoryEntryPatch): Promise<MemoryEntry>;
}
