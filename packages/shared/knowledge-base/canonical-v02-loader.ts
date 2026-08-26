import { readFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { KnowledgeError } from './errors.ts'
import { KnowledgeIndex } from './knowledge-index.ts'
import { classifyKnowledgeAsset, loadedAsset, isWithinRoot } from './loader.ts'
import { parseYaml } from './yaml.ts'
import type {
  KnowledgeAssetCollection,
  KnowledgeAssetKind,
  KnowledgeRegistryAssetEntry,
  KnowledgeEntity,
  KnowledgeIntelligence,
  KnowledgeModule,
  KnowledgeRelation,
  KnowledgeSource,
} from './types.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function emptyAssets(rootDir: string): KnowledgeAssetCollection {
  return {
    rootDir,
    entities: [],
    relations: [],
    intelligence: [],
    modules: [],
    sources: [],
    registry: [],
    moduleRegistry: [],
  }
}

function parseCanonicalRegistry(value: unknown, filePath: string): Array<{ id: string; entry: KnowledgeRegistryAssetEntry }> {
  if (!isRecord(value)) throw new KnowledgeError('RegistryError', 'Canonical registry/assets.yaml must be an object map', filePath)
  if ('assets' in value) throw new KnowledgeError('RegistryError', 'Canonical registry/assets.yaml must not use legacy assets[] representation', filePath)
  return Object.entries(value).map(([id, rawEntry]) => {
    if (!isRecord(rawEntry)) throw new KnowledgeError('RegistryError', `Registry entry must be an object: ${id}`, filePath)
    const type = rawEntry.type
    const storageRef = rawEntry.storageRef
    if (typeof type !== 'string' || !(['entity', 'relation', 'intelligence', 'module', 'source'] as readonly string[]).includes(type)) {
      throw new KnowledgeError('RegistryError', `Invalid registry asset type for ${id}`, filePath)
    }
    if (typeof storageRef !== 'string' || storageRef.trim() === '') {
      throw new KnowledgeError('RegistryError', `Registry asset storageRef must be a non-empty string: ${id}`, filePath)
    }
    return { id, entry: { type: type as KnowledgeAssetKind, storageRef } }
  })
}

function resolveStorageRef(rootDir: string, storageRef: string, registryPath: string): string {
  if (isAbsolute(storageRef)) throw new KnowledgeError('RegistryError', `Absolute storageRef is not allowed: ${storageRef}`, registryPath)
  if (!isWithinRoot(rootDir, storageRef)) {
    throw new KnowledgeError('RegistryError', `Registry storageRef escapes Knowledge Base root: ${storageRef}`, registryPath)
  }
  const assetPath = resolve(rootDir, storageRef)
  const rel = relative(rootDir, assetPath)
  if (rel === '..' || rel.startsWith(`..${sep}`)) throw new KnowledgeError('RegistryError', `Registry storageRef escapes Knowledge Base root: ${storageRef}`, registryPath)
  return assetPath
}

function addAsset(assets: KnowledgeAssetCollection, kind: KnowledgeAssetKind, value: Record<string, unknown>, filePath: string): void {
  if (kind === 'entity') assets.entities.push(loadedAsset<KnowledgeEntity>(kind, value, filePath))
  if (kind === 'relation') assets.relations.push(loadedAsset<KnowledgeRelation>(kind, value, filePath))
  if (kind === 'intelligence') assets.intelligence.push(loadedAsset<KnowledgeIntelligence>(kind, value, filePath))
  if (kind === 'module') assets.modules.push(loadedAsset<KnowledgeModule>(kind, value, filePath))
  if (kind === 'source') assets.sources.push(loadedAsset<KnowledgeSource>(kind, value, filePath))
}

export class CanonicalV02KnowledgeLoader {
  private cache?: KnowledgeIndex

  constructor(private readonly rootDir: string) {}

  async readAssets(): Promise<KnowledgeAssetCollection> {
    const rootDir = resolve(this.rootDir)
    const registryPath = join(rootDir, 'registry', 'assets.yaml')
    let registryValue: unknown
    try {
      registryValue = parseYaml(await readFile(registryPath, 'utf8'), registryPath)
    } catch (error) {
      if (error instanceof KnowledgeError) throw error
      throw new KnowledgeError('RegistryError', `Unable to read canonical registry: ${registryPath}`, registryPath)
    }

    const assets = emptyAssets(rootDir)
    const entries = parseCanonicalRegistry(registryValue, registryPath)
    for (const { id, entry } of entries) {
      const assetPath = resolveStorageRef(rootDir, entry.storageRef, registryPath)
      let assetValue: unknown
      try {
        assetValue = parseYaml(await readFile(assetPath, 'utf8'), assetPath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new KnowledgeError('RegistryError', `Registry asset does not exist: ${id} -> ${entry.storageRef}`, registryPath)
        }
        if (error instanceof KnowledgeError) throw error
        throw new KnowledgeError('StorageError', `Unable to read registry asset: ${entry.storageRef}`, assetPath)
      }
      if (!isRecord(assetValue)) throw new KnowledgeError('RegistryError', `Registry asset must be an object: ${id}`, assetPath)
      const kind = classifyKnowledgeAsset(relative(rootDir, assetPath), assetValue)
      if (kind !== entry.type) throw new KnowledgeError('RegistryError', `Registry type does not match asset: ${id}`, assetPath)
      assets.registry.push({ id, type: entry.type, path: entry.storageRef, storageRef: entry.storageRef })
      addAsset(assets, entry.type, assetValue, assetPath)
    }
    return assets
  }

  async load(): Promise<KnowledgeIndex> {
    if (this.cache) return this.cache
    this.cache = KnowledgeIndex.fromAssets(await this.readAssets())
    return this.cache
  }

  async reload(): Promise<KnowledgeIndex> {
    this.cache = undefined
    return this.load()
  }
}
