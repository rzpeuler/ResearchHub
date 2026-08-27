import { KnowledgeBaseHandle } from './handle.ts'
import { KnowledgeLoader } from './loader.ts'
import { CanonicalV02KnowledgeLoader } from './canonical-v02-loader.ts'
import { KnowledgeIndex } from './knowledge-index.ts'
import { KnowledgeIndexV03 } from './knowledge-index-v03.ts'
import type { KnowledgeAssetCollection } from './types.ts'
import { CanonicalV03KnowledgeLoader } from './canonical-v03-loader.ts'
import type { KnowledgeAssetCollectionV03 } from './v03-types.ts'

export interface KnowledgeSchemaAdapter {
  readonly schemaVersion: '0.1' | '0.2'
  readonly storageFormatVersion: '1'
  readAssets(handle: KnowledgeBaseHandle): Promise<KnowledgeAssetCollection>
  load(handle: KnowledgeBaseHandle): Promise<KnowledgeIndex>
}

export interface KnowledgeSchemaAdapterV03 {
  readonly schemaVersion: '0.3'
  readonly storageFormatVersion: '1'
  readAssets(handle: KnowledgeBaseHandle): Promise<KnowledgeAssetCollectionV03>
  load(handle: KnowledgeBaseHandle): Promise<KnowledgeIndexV03>
}

export type VersionedKnowledgeSchemaAdapter = KnowledgeSchemaAdapter | KnowledgeSchemaAdapterV03

export class KnowledgeSchemaAdapterRegistry {
  private readonly adapters = new Map<string, VersionedKnowledgeSchemaAdapter>()

  register(adapter: VersionedKnowledgeSchemaAdapter): this {
    const key = this.key(adapter.schemaVersion, adapter.storageFormatVersion)
    if (this.adapters.has(key)) throw new Error(`Knowledge Schema Adapter already registered: ${key}`)
    this.adapters.set(key, adapter)
    return this
  }

  get(schemaVersion: string, storageFormatVersion: string): VersionedKnowledgeSchemaAdapter | undefined {
    return this.adapters.get(this.key(schemaVersion, storageFormatVersion))
  }

  private key(schemaVersion: string, storageFormatVersion: string): string {
    return `${schemaVersion}\u0000${storageFormatVersion}`
  }
}

export class CanonicalV03SchemaAdapter implements KnowledgeSchemaAdapterV03 {
  readonly schemaVersion = '0.3' as const
  readonly storageFormatVersion = '1' as const

  async readAssets(handle: KnowledgeBaseHandle): Promise<KnowledgeAssetCollectionV03> {
    return new CanonicalV03KnowledgeLoader(handle.rootRef).readAssets()
  }

  async load(handle: KnowledgeBaseHandle): Promise<KnowledgeIndexV03> {
    return KnowledgeIndexV03.fromAssets(await this.readAssets(handle))
  }
}

export class FilesystemKnowledgeSchemaAdapter implements KnowledgeSchemaAdapter {
  constructor(
    public readonly schemaVersion: '0.1' | '0.2',
    public readonly storageFormatVersion: '1',
  ) {}

  async load(handle: KnowledgeBaseHandle): Promise<KnowledgeIndex> {
    return KnowledgeIndex.fromAssets(await this.readAssets(handle))
  }

  async readAssets(handle: KnowledgeBaseHandle): Promise<KnowledgeAssetCollection> {
    if (this.schemaVersion === '0.2' && this.storageFormatVersion === '1') {
      return new CanonicalV02KnowledgeLoader(handle.rootRef).readAssets()
    }
    return new KnowledgeLoader({ rootDir: handle.rootRef }).readAssets()
  }
}

export function createDefaultKnowledgeSchemaAdapterRegistry(): KnowledgeSchemaAdapterRegistry {
  return new KnowledgeSchemaAdapterRegistry()
    .register(new FilesystemKnowledgeSchemaAdapter('0.1', '1'))
    .register(new FilesystemKnowledgeSchemaAdapter('0.2', '1'))
    .register(new CanonicalV03SchemaAdapter())
}
