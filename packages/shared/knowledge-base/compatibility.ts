import type { KnowledgeBaseStatus } from '../../schemas/knowledge/index.ts'

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
  writable?: boolean
}

export interface KnowledgeSchemaCompatibilityResolverOptions {
  supported?: KnowledgeSchemaSupport[]
  migrationAvailable?: boolean | ((input: KnowledgeCompatibilityInput) => boolean)
}

const DEFAULT_SUPPORTED: KnowledgeSchemaSupport[] = [
  { schemaVersion: '0.1', storageFormatVersion: '1', writable: false },
  { schemaVersion: '0.2', storageFormatVersion: '1' },
]

export class KnowledgeSchemaCompatibilityResolver {
  private readonly supported: KnowledgeSchemaSupport[]
  private readonly migrationAvailable: boolean | ((input: KnowledgeCompatibilityInput) => boolean)

  constructor(options: KnowledgeSchemaCompatibilityResolverOptions = {}) {
    this.supported = [...(options.supported ?? DEFAULT_SUPPORTED)]
    this.migrationAvailable = options.migrationAvailable ?? false
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

    const writable = support.writable !== false && input.status === 'active'
    if (!writable) {
      return {
        status: 'read_only_compatible',
        readable: true,
        writable: false,
        migrationAvailable: false,
        reason: `Knowledge Base status ${input.status} is read-only at runtime`,
      }
    }
    return { status: 'compatible', readable: true, writable: true, migrationAvailable: false }
  }

  check(input: KnowledgeCompatibilityInput): KnowledgeCompatibilityResult {
    return this.resolve(input)
  }
}
