import type { KnowledgeSchemaVersionRef } from '../schema-release.ts'
import type { KnowledgeMigrationDefinition } from './types.ts'

function key(version: KnowledgeSchemaVersionRef): string { return `${version.schemaVersion}\u0000${version.storageFormatVersion}` }
function sameVersion(left: KnowledgeSchemaVersionRef, right: KnowledgeSchemaVersionRef): boolean { return left.schemaVersion === right.schemaVersion && left.storageFormatVersion === right.storageFormatVersion }

export class KnowledgeMigrationRegistry {
  private readonly definitions = new Map<string, KnowledgeMigrationDefinition>()

  register(definition: KnowledgeMigrationDefinition): this {
    if (!definition.id || !definition.source || !definition.target) throw new Error('Migration definition requires id, source, and target')
    if (sameVersion(definition.source, definition.target)) throw new Error(`Self migration is not allowed: ${definition.id}`)
    if (this.definitions.has(definition.id)) throw new Error(`Migration already registered: ${definition.id}`)
    if ([...this.definitions.values()].some((item) => sameVersion(item.source, definition.source) && sameVersion(item.target, definition.target))) throw new Error(`Duplicate migration path: ${key(definition.source)} -> ${key(definition.target)}`)
    this.definitions.set(definition.id, structuredClone(definition))
    return this
  }

  get(id: string): KnowledgeMigrationDefinition | undefined { return this.definitions.get(id) }

  findDirect(source: KnowledgeSchemaVersionRef, target: KnowledgeSchemaVersionRef): KnowledgeMigrationDefinition | undefined {
    return [...this.definitions.values()].find((definition) => sameVersion(definition.source, source) && sameVersion(definition.target, target))
  }

  resolvePath(source: KnowledgeSchemaVersionRef, target: KnowledgeSchemaVersionRef): KnowledgeMigrationDefinition[] {
    if (sameVersion(source, target)) return []
    const queue: Array<{ version: KnowledgeSchemaVersionRef; path: KnowledgeMigrationDefinition[] }> = [{ version: source, path: [] }]
    const visited = new Set<string>([key(source)])
    while (queue.length > 0) {
      const current = queue.shift()!
      const next = [...this.definitions.values()].filter((definition) => sameVersion(definition.source, current.version)).sort((left, right) => left.id.localeCompare(right.id))
      for (const definition of next) {
        const path = [...current.path, definition]
        if (sameVersion(definition.target, target)) return path
        const targetKey = key(definition.target)
        if (!visited.has(targetKey)) { visited.add(targetKey); queue.push({ version: definition.target, path }) }
      }
    }
    return []
  }

  canMigrate(source: KnowledgeSchemaVersionRef, target?: KnowledgeSchemaVersionRef): boolean {
    if (!target) return this.resolvePath(source, { schemaVersion: '0.2', storageFormatVersion: '1' }).length > 0
    return sameVersion(source, target) || this.resolvePath(source, target).length > 0
  }
}

export const DEFAULT_KNOWLEDGE_MIGRATION_REGISTRY = new KnowledgeMigrationRegistry().register({
  id: 'knowledge-schema-0.1-to-0.2',
  source: { schemaVersion: '0.1', storageFormatVersion: '1' },
  target: { schemaVersion: '0.2', storageFormatVersion: '1' },
})
