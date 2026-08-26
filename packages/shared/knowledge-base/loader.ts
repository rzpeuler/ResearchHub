import { readFile, readdir } from 'node:fs/promises'
import { extname, join, relative, resolve, sep } from 'node:path'
import { KnowledgeError } from './errors.ts'
import { KnowledgeIndex } from './knowledge-index.ts'
import { parseYaml } from './yaml.ts'
import { ENTITY_TYPES, INTELLIGENCE_TYPES, MODULE_TYPES, RELATION_TYPES } from '../../schemas/knowledge/index.ts'
import type {
  KnowledgeAssetCollection,
  KnowledgeAssetKind,
  KnowledgeEntity,
  KnowledgeIntelligence,
  KnowledgeLoaderOptions,
  KnowledgeModule,
  KnowledgeRelation,
  KnowledgeSource,
  LoadedAsset,
  ModuleRegistryBinding,
  RegistryEntry,
} from './types.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function listFiles(rootDir: string): Promise<string[]> {
  const entries = await readdir(rootDir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const path = join(rootDir, entry.name)
    if (entry.isDirectory()) files.push(...await listFiles(path))
    else if (['.yaml', '.yml', '.json'].includes(extname(entry.name).toLowerCase())) files.push(path)
  }
  return files.sort((left, right) => left.localeCompare(right))
}

function classify(relativePath: string, value: Record<string, unknown>): KnowledgeAssetKind | 'registry' | undefined {
  const normalized = relativePath.replaceAll('\\', '/').toLowerCase()
  if (normalized.startsWith('registry/')) return 'registry'
  if (normalized.startsWith('entities/')) return 'entity'
  if (normalized.startsWith('relations/')) return 'relation'
  if (normalized.startsWith('intelligence/')) return 'intelligence'
  if (normalized.startsWith('modules/')) return 'module'
  if (normalized.startsWith('sources/')) return 'source'
  const type = typeof value.type === 'string' ? value.type : ''
  if ((ENTITY_TYPES as readonly string[]).includes(type)) return 'entity'
  if ((RELATION_TYPES as readonly string[]).includes(type)) return 'relation'
  if ((INTELLIGENCE_TYPES as readonly string[]).includes(type)) return 'intelligence'
  if ((MODULE_TYPES as readonly string[]).includes(type)) return 'module'
  if (typeof value.source === 'string' && typeof value.target === 'string') return 'relation'
  if (typeof value.title === 'string' && typeof value.publisher === 'string') return 'source'
  return undefined
}

function loadedAsset<T extends object>(kind: KnowledgeAssetKind, value: Record<string, unknown>, filePath: string): LoadedAsset<T> {
  return { kind, value: value as T, filePath }
}

function parseRegistry(value: unknown, filePath: string): RegistryEntry[] {
  if (!isRecord(value) || !Array.isArray(value.assets)) throw new KnowledgeError('SchemaError', 'Registry index must contain an assets array', filePath)
  return value.assets.map((entry, index) => {
    if (!isRecord(entry)) throw new KnowledgeError('SchemaError', `Registry entry ${index} must be an object`, filePath)
    return {
      id: typeof entry.id === 'string' ? entry.id : String(entry.id),
      type: typeof entry.type === 'string' ? entry.type as RegistryEntry['type'] : String(entry.type) as RegistryEntry['type'],
      path: typeof entry.path === 'string' ? entry.path : String(entry.path),
    }
  })
}

function parseModuleRegistry(value: unknown, filePath: string): ModuleRegistryBinding[] {
  if (!isRecord(value) || !Array.isArray(value.bindings)) throw new KnowledgeError('SchemaError', 'Module registry must contain a bindings array', filePath)
  return value.bindings.map((entry, index) => {
    if (!isRecord(entry)) throw new KnowledgeError('SchemaError', `Module binding ${index} must be an object`, filePath)
    return {
      entityId: typeof entry.entityId === 'string' ? entry.entityId : String(entry.entityId),
      moduleIds: Array.isArray(entry.moduleIds) ? entry.moduleIds.map(String) : [],
    }
  })
}

function isWithinRoot(rootDir: string, candidate: string): boolean {
  const root = resolve(rootDir)
  const resolved = resolve(rootDir, candidate)
  const rel = relative(root, resolved)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`))
}

export class KnowledgeLoader {
  private cache?: KnowledgeIndex

  constructor(private readonly options: KnowledgeLoaderOptions) {}

  async readAssets(): Promise<KnowledgeAssetCollection> {
    const rootDir = resolve(this.options.rootDir)
    const files = await listFiles(rootDir)
    const registryFiles = files.filter((filePath) => relative(rootDir, filePath).replaceAll('\\', '/').toLowerCase().startsWith('registry/'))
    const assets: KnowledgeAssetCollection = {
      rootDir,
      entities: [],
      relations: [],
      intelligence: [],
      modules: [],
      sources: [],
      registry: [],
      moduleRegistry: [],
    }

    if (registryFiles.length > 0) {
      for (const registryFile of registryFiles) {
        const value = parseYaml(await readFile(registryFile, 'utf8'), registryFile)
        if (!isRecord(value)) throw new KnowledgeError('SchemaError', 'Registry must be an object', registryFile)
        if (Array.isArray(value.assets)) {
          const entries = parseRegistry(value, registryFile)
          assets.registry.push(...entries)
          for (const entry of entries) {
            if (!isWithinRoot(rootDir, entry.path)) continue
            const assetPath = resolve(rootDir, entry.path)
            try {
              const assetValue = parseYaml(await readFile(assetPath, 'utf8'), assetPath)
              if (!isRecord(assetValue)) continue
              const kind = classify(relative(rootDir, assetPath), assetValue)
              if (!kind || kind === 'registry') continue
              if (kind === 'entity') assets.entities.push(loadedAsset<KnowledgeEntity>(kind, assetValue, assetPath))
              if (kind === 'relation') assets.relations.push(loadedAsset<KnowledgeRelation>(kind, assetValue, assetPath))
              if (kind === 'intelligence') assets.intelligence.push(loadedAsset<KnowledgeIntelligence>(kind, assetValue, assetPath))
              if (kind === 'module') assets.modules.push(loadedAsset<KnowledgeModule>(kind, assetValue, assetPath))
              if (kind === 'source') assets.sources.push(loadedAsset<KnowledgeSource>(kind, assetValue, assetPath))
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
              if (error instanceof KnowledgeError) throw error
              throw new KnowledgeError('ParseError', String(error), assetPath)
            }
          }
        }
        if (Array.isArray(value.bindings)) assets.moduleRegistry.push(...parseModuleRegistry(value, registryFile))
      }
      return assets
    }

    for (const filePath of files) {
      const value = parseYaml(await readFile(filePath, 'utf8'), filePath)
      if (!isRecord(value)) throw new KnowledgeError('SchemaError', 'Knowledge asset must be an object', filePath)
      const kind = classify(relative(rootDir, filePath), value)
      if (!kind || kind === 'registry') continue
      if (kind === 'entity') assets.entities.push(loadedAsset<KnowledgeEntity>(kind, value, filePath))
      if (kind === 'relation') assets.relations.push(loadedAsset<KnowledgeRelation>(kind, value, filePath))
      if (kind === 'intelligence') assets.intelligence.push(loadedAsset<KnowledgeIntelligence>(kind, value, filePath))
      if (kind === 'module') assets.modules.push(loadedAsset<KnowledgeModule>(kind, value, filePath))
      if (kind === 'source') assets.sources.push(loadedAsset<KnowledgeSource>(kind, value, filePath))
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

export async function loadKnowledge(options: KnowledgeLoaderOptions): Promise<KnowledgeIndex> {
  return new KnowledgeLoader(options).load()
}

export function resolveAssetPath(rootDir: string, assetPath: string): string {
  return resolve(rootDir, assetPath)
}
