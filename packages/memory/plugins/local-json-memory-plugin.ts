import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { MemoryDuplicateError, MemoryNotFoundError, MemoryStorageError } from '../core/errors.ts';
import { cloneMemoryEntry, cloneMemoryEntryPatch, cloneMemoryQuery, deserializeMemoryEntries, serializeMemoryEntries } from '../core/serialization.ts';
import type { MemoryEntry, MemoryEntryPatch, MemoryPlugin, MemoryQuery } from '../core/index.ts';
import { assertMemoryId, validateMemoryEntry } from '../core/validation.ts';

interface OperationQueueState {
  tail: Promise<void>;
  pending: number;
}

/** JSON-file implementation of the MemoryPlugin contract. */
export class LocalJsonMemoryPlugin implements MemoryPlugin {
  private static readonly operationQueues = new Map<string, OperationQueueState>();
  private static temporaryFileCounter = 0;
  private readonly filePath: string;

  constructor(filePath: string) {
    if (typeof filePath !== 'string' || filePath.trim().length === 0) {
      throw new Error('filePath must be a non-empty string');
    }

    this.filePath = resolve(filePath);
  }

  async save(entry: MemoryEntry): Promise<MemoryEntry> {
    const entrySnapshot = cloneMemoryEntry(entry);

    return this.enqueue(async () => {
      const entries = await this.loadEntries();
      if (entries.some((storedEntry) => storedEntry.id === entrySnapshot.id)) {
        throw new MemoryDuplicateError(entrySnapshot.id);
      }

      const savedEntry = cloneMemoryEntry(entrySnapshot);
      await this.persistEntries([...entries, savedEntry]);
      return cloneMemoryEntry(savedEntry);
    });
  }

  async retrieve(query?: MemoryQuery): Promise<MemoryEntry[]> {
    const querySnapshot = query === undefined ? undefined : cloneMemoryQuery(query);

    return this.enqueue(async () => {
      const entries = await this.loadEntries();
      const matchingEntries = querySnapshot === undefined
        ? entries
        : entries.filter((entry) => this.matchesQuery(entry, querySnapshot));

      return matchingEntries.map((entry) => cloneMemoryEntry(entry));
    });
  }

  async update(id: string, patch: MemoryEntryPatch): Promise<MemoryEntry> {
    assertMemoryId(id);
    const patchSnapshot = cloneMemoryEntryPatch(patch);

    return this.enqueue(async () => {
      const entries = await this.loadEntries();
      const index = entries.findIndex((entry) => entry.id === id);
      if (index < 0) {
        throw new MemoryNotFoundError(id);
      }

      const currentEntry = entries[index];
      if (currentEntry === undefined) {
        throw new MemoryNotFoundError(id);
      }

      const updatedEntry: MemoryEntry = {
        ...currentEntry,
        ...(Object.prototype.hasOwnProperty.call(patchSnapshot, 'content') ? { content: patchSnapshot.content } : {}),
        ...(Object.prototype.hasOwnProperty.call(patchSnapshot, 'metadata') ? { metadata: patchSnapshot.metadata } : {}),
      };
      validateMemoryEntry(updatedEntry);
      entries[index] = cloneMemoryEntry(updatedEntry);
      await this.persistEntries(entries);
      return cloneMemoryEntry(updatedEntry);
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    let queue = LocalJsonMemoryPlugin.operationQueues.get(this.filePath);
    if (queue === undefined) {
      queue = { tail: Promise.resolve(), pending: 0 };
      LocalJsonMemoryPlugin.operationQueues.set(this.filePath, queue);
    }

    queue.pending += 1;
    const previous = queue.tail;
    const result = previous.then(operation, operation);
    const settled = result.then(
      () => {
        this.releaseQueue(queue as OperationQueueState);
      },
      (error: unknown) => {
        this.releaseQueue(queue as OperationQueueState);
        throw error;
      },
    );
    queue.tail = settled.then(() => undefined, () => undefined);
    return result;
  }

  private releaseQueue(queue: OperationQueueState): void {
    queue.pending -= 1;
    if (queue.pending === 0 && LocalJsonMemoryPlugin.operationQueues.get(this.filePath) === queue) {
      LocalJsonMemoryPlugin.operationQueues.delete(this.filePath);
    }
  }

  private async loadEntries(): Promise<MemoryEntry[]> {
    await this.ensureParentDirectory();

    let serialized: string;
    try {
      serialized = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if (this.isFileMissing(error)) {
        await this.persistEntries([]);
        return [];
      }

      throw new MemoryStorageError(`could not read memory file: ${this.filePath}`, error);
    }

    return deserializeMemoryEntries(serialized);
  }

  private async persistEntries(entries: readonly MemoryEntry[]): Promise<void> {
    await this.ensureParentDirectory();
    const serialized = serializeMemoryEntries(entries);
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.${LocalJsonMemoryPlugin.temporaryFileCounter++}.tmp`;

    try {
      await writeFile(temporaryPath, serialized, 'utf8');
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      throw new MemoryStorageError(`could not persist memory file: ${this.filePath}`, error);
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }

  private async ensureParentDirectory(): Promise<void> {
    try {
      await mkdir(dirname(this.filePath), { recursive: true });
    } catch (error) {
      throw new MemoryStorageError(`could not create memory directory: ${dirname(this.filePath)}`, error);
    }
  }

  private matchesQuery(entry: MemoryEntry, query: MemoryQuery): boolean {
    return (query.id === undefined || entry.id === query.id)
      && (query.type === undefined || entry.type === query.type)
      && (query.sourceArtifactId === undefined || entry.sourceArtifactId === query.sourceArtifactId)
      && (query.sessionId === undefined || entry.metadata.sessionId === query.sessionId);
  }

  private isFileMissing(error: unknown): boolean {
    return typeof error === 'object'
      && error !== null
      && 'code' in error
      && error.code === 'ENOENT';
  }
}
