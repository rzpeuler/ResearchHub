import { KNOWLEDGE_SCHEMA_RELEASES, type KnowledgeBaseStatus } from '../../schemas/knowledge/index.ts'

export const KNOWLEDGE_COMPATIBILITY_STATUSES = [
  'compatible',
  'read_only_compatible',
  'migration_available',
  'unsupported',
] as const
export type KnowledgeCompatibilityStatus = (typeof KNOWLEDGE_COMPATIBILITY_STATUSES)[number]

export interface KnowledgeCompatibilityInput {
  schemaVersion: string
  storageFormatVersion: string
  status: KnowledgeBaseStatus
}

export interface KnowledgeCompatibilityResult {
  status: KnowledgeCompatibilityStatus
  readable: boolean
  writable: boolean
  migrationAvailable: boolean
  reason?: string
}

export interface KnowledgeSchemaSupport {
  schemaVersion: string
  storageFormatVersion: string
  readable?: boolean
  writable?: boolean
}

export interface KnowledgeSchemaCompatibilityResolverOptions {
  supported?: KnowledgeSchemaSupport[]
  migrationAvailable?: boolean | ((input: KnowledgeCompatibilityInput) => boolean)
}

const DEFAULT_SUPPORTED: KnowledgeSchemaSupport[] = KNOWLEDGE_SCHEMA_RELEASES.map((release) => ({
  schemaVersion: release.schemaVersion,
  storageFormatVersion: release.storageFormatVersion,
  readable: release.readable,
  writable: release.writable,
}))

export class KnowledgeSchemaCompatibilityResolver {
  private readonly supported: KnowledgeSchemaSupport[]
  private readonly migrationAvailable: boolean | ((input: KnowledgeCompatibilityInput) => boolean)

  constructor(options: KnowledgeSchemaCompatibilityResolverOptions = {}) {
    this.supported = [...(options.supported ?? DEFAULT_SUPPORTED)]
    this.migrationAvailable = options.migrationAvailable ?? (options.supported === undefined
      ? ((input) => (input.schemaVersion === '0.1' && input.storageFormatVersion === '1') || KNOWLEDGE_SCHEMA_RELEASES.some((release) => release.migrationSources.some((source) => source.schemaVersion === input.schemaVersion && source.storageFormatVersion === input.storageFormatVersion)))
      : false)
  }

  resolve(input: KnowledgeCompatibilityInput): KnowledgeCompatibilityResult {
    const support = this.supported.find((candidate) => candidate.schemaVersion === input.schemaVersion && candidate.storageFormatVersion === input.storageFormatVersion)
    if (!support) {
      const hasMigration = typeof this.migrationAvailable === 'function' ? this.migrationAvailable(input) : this.migrationAvailable
      if (hasMigration) {
        return {
          status: 'migration_available',
          readable: false,
          writable: false,
          migrationAvailable: true,
          reason: `Migration is available for schema ${input.schemaVersion} and storage ${input.storageFormatVersion}`,
        }
      }
      return {
        status: 'unsupported',
        readable: false,
        writable: false,
        migrationAvailable: false,
        reason: `Unsupported schema ${input.schemaVersion} and storage ${input.storageFormatVersion}`,
      }
    }

    if (support.readable === false) {
      return {
        status: 'unsupported',
        readable: false,
        writable: false,
        migrationAvailable: false,
        reason: `Runtime cannot read schema ${input.schemaVersion} and storage ${input.storageFormatVersion}`,
      }
    }
    const migrationAvailable = typeof this.migrationAvailable === 'function' ? this.migrationAvailable(input) : this.migrationAvailable
    const writable = support.writable === true && input.status === 'active'
    if (!writable) {
      return {
        status: 'read_only_compatible',
        readable: true,
        writable: false,
        migrationAvailable,
        reason: support.writable !== true
          ? 'Runtime write capability is not implemented or enabled'
          : `Knowledge Base status ${input.status} is read-only at runtime`,
      }
    }
    return { status: 'compatible', readable: true, writable: true, migrationAvailable }
  }

  check(input: KnowledgeCompatibilityInput): KnowledgeCompatibilityResult {
    return this.resolve(input)
  }
}
