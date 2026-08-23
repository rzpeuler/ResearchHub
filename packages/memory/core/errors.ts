/** Base error for Memory framework failures. */
export class MemoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemoryError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Raised when a Memory value does not satisfy its runtime contract. */
export class MemoryValidationError extends MemoryError {
  readonly path: string;

  constructor(message: string, path = '$') {
    super(path === '$' ? message : `${path}: ${message}`);
    this.name = 'MemoryValidationError';
    this.path = path;
  }
}

/** Raised when save() receives an ID already present in storage. */
export class MemoryDuplicateError extends MemoryError {
  readonly id: string;

  constructor(id: string) {
    super(`memory entry already exists: ${id}`);
    this.name = 'MemoryDuplicateError';
    this.id = id;
  }
}

/** Raised when an operation references an ID absent from storage. */
export class MemoryNotFoundError extends MemoryError {
  readonly id: string;

  constructor(id: string) {
    super(`memory entry not found: ${id}`);
    this.name = 'MemoryNotFoundError';
    this.id = id;
  }
}

/** Raised when the local persistence file cannot be read or written safely. */
export class MemoryStorageError extends MemoryError {
  override readonly cause: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'MemoryStorageError';
    this.cause = cause;
  }
}
