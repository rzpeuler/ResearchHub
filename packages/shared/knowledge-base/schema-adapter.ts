import { KnowledgeBaseHandle } from './handle.ts'
import { KnowledgeLoader } from './loader.ts'
import { CanonicalV02KnowledgeLoader } from './canonical-v02-loader.ts'
import { KnowledgeIndex } from './knowledge-index.ts'

export interface KnowledgeSchemaAdapter {
  readonly schemaVersion: string
  readonly storageFormatVersion: string
  load(handle: KnowledgeBaseHandle): Promise<KnowledgeIndex>
}

export class KnowledgeSchemaAdapterRegistry {
  private readonly adapters = new Map<string, KnowledgeSchemaAdapter>()

  register(adapter: KnowledgeSchemaAdapter): this {
    const key = this.key(adapter.schemaVersion, adapter.storageFormatVersion)
    if (this.adapters.has(key)) throw new Error(`Knowledge Schema Adapter already registered: ${key}`)
    this.adapters.set(key, adapter)
    return this
  }

  get(schemaVersion: string, storageFormatVersion: string): KnowledgeSchemaAdapter | undefined {
    return this.adapters.get(this.key(schemaVersion, storageFormatVersion))
  }

  private key(schemaVersion: string, storageFormatVersion: string): string {
    return `${schemaVersion}\u0000${storageFormatVersion}`
  }
}

export class FilesystemKnowledgeSchemaAdapter implements KnowledgeSchemaAdapter {
  constructor(
    public readonly schemaVersion: string,
    public readonly storageFormatVersion: string,
  ) {}

  async load(handle: KnowledgeBaseHandle): Promise<KnowledgeIndex> {
    if (this.schemaVersion === '0.2' && this.storageFormatVersion === '1') {
      return new CanonicalV02KnowledgeLoader(handle.rootRef).load()
    }
    return new KnowledgeLoader({ rootDir: handle.rootRef }).load()
  }
}

export function createDefaultKnowledgeSchemaAdapterRegistry(): KnowledgeSchemaAdapterRegistry {
  return new KnowledgeSchemaAdapterRegistry()
    .register(new FilesystemKnowledgeSchemaAdapter('0.1', '1'))
    .register(new FilesystemKnowledgeSchemaAdapter('0.2', '1'))
}
