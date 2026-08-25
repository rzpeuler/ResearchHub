import { readFile, readdir } from 'node:fs/promises'
import { extname, join, relative, resolve } from 'node:path'
import { KnowledgeError } from './errors.ts'
import { KnowledgeIndex } from './index.ts'
import { parseYaml } from './yaml.ts'
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
  RegistryEntry,
} from './types.ts'

const ENTITY_TYPES = new Set(['industry', 'segment', 'company', 'product', 'technology'])
const INTELLIGENCE_TYPES = new Set(['fact', 'forecast', 'viewpoint', 'trend', 'risk'])
const RELATION_TYPES = new Set([
  'contains', 'upstream_of', 'downstream_of', 'depends_on', 'substitute_for',
  'operates_in', 'supplies', 'customer_of', 'competes_with', 'partner_of',
  'owns_stake_in', 'investor_of', 'project_partner_of',
])
const MODULE_TYPES = new Set(['comparison', 'roadmap', 'market', 'company', 'competition', 'capacity', 'supply-chain'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown, field: string, filePath: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new KnowledgeError('SchemaError', `${field} must be a non-empty string`, filePath)
  }
  return value
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
  if (ENTITY_TYPES.has(type)) return 'entity'
  if (RELATION_TYPES.has(type)) return 'relation'
  if (INTELLIGENCE_TYPES.has(type)) return 'intelligence'
  if (MODULE_TYPES.has(type)) return 'module'
  if (typeof value.source === 'string' && typeof value.target === 'string') return 'relation'
  if (typeof value.title === 'string' && typeof value.publisher === 'string') return 'source'
  return undefined
}

function loadedAsset<T extends object>(kind: KnowledgeAssetKind, value: Record<string, unknown>, filePath: string): LoadedAsset<T> {
  return { kind, value: value as T, filePath }
}

function parseRegistry(value: unknown, filePath: string): RegistryEntry[] {
  if (!isRecord(value) || !Array.isArray(value.assets)) {
    throw new KnowledgeError('SchemaError', 'Registry must contain an assets array', filePath)
  }
  return value.assets.map((entry, index) => {
    if (!isRecord(entry)) throw new KnowledgeError('SchemaError', `Registry entry ${index} must be an object`, filePath)
    return {
      id: asString(entry.id, 'registry.id', filePath),
      type: asString(entry.type, 'registry.type', filePath) as RegistryEntry['type'],
      path: asString(entry.path, 'registry.path', filePath),
    }
  })
}

export class KnowledgeLoader {
  private cache?: KnowledgeIndex

  constructor(private readonly options: KnowledgeLoaderOptions) {}

  async readAssets(): Promise<KnowledgeAssetCollection> {
    const rootDir = resolve(this.options.rootDir)
    const files = await listFiles(rootDir)
    const assets: KnowledgeAssetCollection = { entities: [], relations: [], intelligence: [], modules: [], sources: [], registry: [] }
    for (const filePath of files) {
      const value = parseYaml(await readFile(filePath, 'utf8'), filePath)
      if (!isRecord(value)) throw new KnowledgeError('SchemaError', 'Knowledge asset must be an object', filePath)
      const kind = classify(relative(rootDir, filePath), value)
      if (!kind) continue
      if (kind === 'registry') {
        assets.registry.push(...parseRegistry(value, filePath))
        continue
      }
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
