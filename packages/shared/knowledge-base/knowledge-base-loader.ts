import { KnowledgeError } from './errors.ts'
import { KnowledgeBaseHandle } from './handle.ts'
import { KnowledgeBaseRegistry } from './registry.ts'
import { createDefaultKnowledgeSchemaAdapterRegistry, KnowledgeSchemaAdapterRegistry } from './schema-adapter.ts'
import type { KnowledgeIndex } from './knowledge-index.ts'
import type { KnowledgeAssetCollection } from './types.ts'

export interface KnowledgeBaseLoaderOptions {
  registry?: KnowledgeBaseRegistry
  adapters?: KnowledgeSchemaAdapterRegistry
}

export class KnowledgeBaseLoader {
  readonly registry: KnowledgeBaseRegistry
  readonly adapters: KnowledgeSchemaAdapterRegistry

  constructor(options: KnowledgeBaseLoaderOptions = {}) {
    this.registry = options.registry ?? new KnowledgeBaseRegistry()
    this.adapters = options.adapters ?? createDefaultKnowledgeSchemaAdapterRegistry()
  }

  async mount(rootRef: string): Promise<KnowledgeBaseHandle> {
    return this.registry.mount(rootRef)
  }

  async load(handle: KnowledgeBaseHandle): Promise<KnowledgeIndex> {
    if (handle.compatibility === 'unsupported') {
      throw new KnowledgeError('UnsupportedSchema', `Unsupported Knowledge Base schema: ${handle.schemaVersion}/${handle.storageFormatVersion}`, handle.rootRef)
    }
    if (handle.compatibility === 'migration_available') {
      throw new KnowledgeError('CompatibilityError', `Knowledge Base requires migration before loading: ${handle.knowledgeBaseId}`, handle.rootRef)
    }
    const adapter = this.adapters.get(handle.schemaVersion, handle.storageFormatVersion)
    if (!adapter) {
      throw new KnowledgeError('UnsupportedSchema', `No Knowledge Schema Adapter for ${handle.schemaVersion}/${handle.storageFormatVersion}`, handle.rootRef)
    }
    return adapter.load(handle)
  }

  async readAssets(handle: KnowledgeBaseHandle): Promise<KnowledgeAssetCollection> {
    if (handle.compatibility === 'unsupported') {
      throw new KnowledgeError('UnsupportedSchema', `Unsupported Knowledge Base schema: ${handle.schemaVersion}/${handle.storageFormatVersion}`, handle.rootRef)
    }
    if (handle.compatibility === 'migration_available') {
      throw new KnowledgeError('CompatibilityError', `Knowledge Base requires migration before loading: ${handle.knowledgeBaseId}`, handle.rootRef)
    }
    const adapter = this.adapters.get(handle.schemaVersion, handle.storageFormatVersion)
    if (!adapter) {
      throw new KnowledgeError('UnsupportedSchema', `No Knowledge Schema Adapter for ${handle.schemaVersion}/${handle.storageFormatVersion}`, handle.rootRef)
    }
    return adapter.readAssets(handle)
  }

  async mountAndLoad(rootRef: string): Promise<{ handle: KnowledgeBaseHandle; index: KnowledgeIndex }> {
    const handle = await this.mount(rootRef)
    return { handle, index: await this.load(handle) }
  }
}
