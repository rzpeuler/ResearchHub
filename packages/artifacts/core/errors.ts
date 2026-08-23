/** Raised when an artifact or serialized artifact is not structurally valid. */
export class ArtifactValidationError extends Error {
  readonly path: string;

  constructor(message: string, path = '$') {
    super(path === '$' ? message : `${path}: ${message}`);
    this.name = 'ArtifactValidationError';
    this.path = path;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
