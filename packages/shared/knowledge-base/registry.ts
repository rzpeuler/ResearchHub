import { resolve } from 'node:path'
import { KnowledgeError } from './errors.ts'
import { KnowledgeSchemaCompatibilityResolver } from './compatibility.ts'
import { createKnowledgeBaseHandle, KnowledgeBaseHandle } from './handle.ts'
import { loadKnowledgeBaseManifest } from './manifest-loader.ts'
import type { KnowledgeSchemaCompatibilityResolverOptions } from './compatibility.ts'

export interface KnowledgeBaseRegistryOptions {
  compatibilityResolver?: KnowledgeSchemaCompatibilityResolver
  compatibility?: KnowledgeSchemaCompatibilityResolverOptions
}

export class KnowledgeBaseRegistry {
  private readonly handles = new Map<string, KnowledgeBaseHandle>()
  readonly compatibilityResolver: KnowledgeSchemaCompatibilityResolver

  constructor(options: KnowledgeBaseRegistryOptions = {}) {
    this.compatibilityResolver = options.compatibilityResolver ?? new KnowledgeSchemaCompatibilityResolver(options.compatibility)
  }

  async mount(rootRef: string): Promise<KnowledgeBaseHandle> {
    const manifest = await loadKnowledgeBaseManifest(rootRef)
    const compatibility = this.compatibilityResolver.resolve({
      schemaVersion: manifest.schemaVersion,
      storageFormatVersion: manifest.storageFormatVersion,
      status: manifest.status,
    })
    if (compatibility.status === 'unsupported') {
      throw new KnowledgeError('UnsupportedSchema', compatibility.reason ?? 'Knowledge Base schema is unsupported', rootRef)
    }
    return this.register(createKnowledgeBaseHandle(manifest, resolve(rootRef), compatibility.status))
  }

  register(handle: KnowledgeBaseHandle): KnowledgeBaseHandle {
    const existing = this.handles.get(handle.knowledgeBaseId)
    if (existing) {
      if (resolve(existing.rootRef) !== resolve(handle.rootRef)) {
        throw new KnowledgeError('MountConflict', `Knowledge Base ID is already mounted from another root: ${handle.knowledgeBaseId}`)
      }
      return existing
    }
    if (handle.compatibility === 'unsupported') {
      throw new KnowledgeError('UnsupportedSchema', `Unsupported Knowledge Base cannot be mounted: ${handle.knowledgeBaseId}`)
    }
    this.handles.set(handle.knowledgeBaseId, handle)
    return handle
  }

  unmount(knowledgeBaseId: string): boolean {
    return this.handles.delete(knowledgeBaseId)
  }

  get(knowledgeBaseId: string): KnowledgeBaseHandle | undefined {
    return this.handles.get(knowledgeBaseId)
  }

  list(): KnowledgeBaseHandle[] {
    return [...this.handles.values()].sort((left, right) => left.knowledgeBaseId.localeCompare(right.knowledgeBaseId))
  }
}

export { KnowledgeBaseRegistry as KnowledgeBaseMountRegistry }
