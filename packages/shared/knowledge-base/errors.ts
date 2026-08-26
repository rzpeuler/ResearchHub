export type KnowledgeErrorCode =
  | 'NotFound'
  | 'ParseError'
  | 'SchemaError'
  | 'InvalidReference'
  | 'InvalidRelation'
  | 'InvalidLifecycle'
  | 'UnknownModule'
  | 'ManifestNotFound'
  | 'ManifestError'
  | 'DataRootError'
  | 'MountConflict'
  | 'UnsupportedSchema'
  | 'CompatibilityError'
  | 'RegistryError'
  | 'StorageError'
  | 'RawArchiveError'
  | 'CanonicalHashError'

export class KnowledgeError extends Error {
  constructor(
    public readonly code: KnowledgeErrorCode,
    message: string,
    public readonly filePath?: string,
  ) {
    super(message)
    this.name = `Knowledge${code}Error`
  }
}
