import { readFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { KNOWLEDGE_SCHEMA_V03 } from '../../schemas/knowledge/v03/executable-schema.ts'
import { KnowledgeError } from './errors.ts'
import { isWithinRoot } from './loader.ts'
import { parseYaml } from './yaml.ts'
import type { KnowledgeAssetCollectionV03, KnowledgeAssetKindV03, KnowledgeRegistryEntryV03 } from './v03-types.ts'

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
const namespaceByKind: Record<KnowledgeAssetKindV03, string> = {
  theme_group: KNOWLEDGE_SCHEMA_V03.canonicalNamespaces.themeGroup,
  entity: KNOWLEDGE_SCHEMA_V03.canonicalNamespaces.entity,
  relation: KNOWLEDGE_SCHEMA_V03.canonicalNamespaces.relation,
  claim: KNOWLEDGE_SCHEMA_V03.canonicalNamespaces.claim,
  module: KNOWLEDGE_SCHEMA_V03.canonicalNamespaces.module,
  source: KNOWLEDGE_SCHEMA_V03.canonicalNamespaces.source,
}
const kinds = Object.keys(namespaceByKind) as KnowledgeAssetKindV03[]

function resolveStorageRef(root: string, storageRef: string, registryPath: string): string {
  if (isAbsolute(storageRef) || storageRef.trim() === '' || !isWithinRoot(root, storageRef)) throw new KnowledgeError('RegistryError', `Unsafe registry storageRef: ${storageRef}`, registryPath)
  const resolved = resolve(root, storageRef)
  const rel = relative(root, resolved)
  if (rel === '..' || rel.startsWith(`..${sep}`)) throw new KnowledgeError('RegistryError', `Registry storageRef escapes Knowledge Base root: ${storageRef}`, registryPath)
  return resolved
}

function add(collection: KnowledgeAssetCollectionV03, kind: KnowledgeAssetKindV03, value: Record<string, unknown>, filePath: string, storageRef: string): void {
  const asset = { kind, value, filePath, storageRef } as never
  if (kind === 'theme_group') collection.themeGroups.push(asset)
  if (kind === 'entity') collection.entities.push(asset)
  if (kind === 'relation') collection.relations.push(asset)
  if (kind === 'claim') collection.claims.push(asset)
  if (kind === 'module') collection.modules.push(asset)
  if (kind === 'source') collection.sources.push(asset)
}

export class CanonicalV03KnowledgeLoader {
  constructor(private readonly rootDir: string) {}

  async readAssets(): Promise<KnowledgeAssetCollectionV03> {
    const root = resolve(this.rootDir)
    const registryPath = join(root, 'registry', 'assets.yaml')
    let parsed: unknown
    try { parsed = parseYaml(await readFile(registryPath, 'utf8'), registryPath) } catch (error) {
      if (error instanceof KnowledgeError) throw error
      throw new KnowledgeError('RegistryError', `Unable to read canonical v0.3 registry: ${registryPath}`, registryPath)
    }
    if (!isRecord(parsed) || 'assets' in parsed) throw new KnowledgeError('RegistryError', 'Canonical v0.3 registry must be an object map', registryPath)
    const collection: KnowledgeAssetCollectionV03 = { rootDir: root, themeGroups: [], entities: [], relations: [], claims: [], modules: [], sources: [], registry: [] }
    const ids = new Set<string>()
    for (const [id, raw] of Object.entries(parsed)) {
      if (!isRecord(raw) || typeof raw.type !== 'string' || !kinds.includes(raw.type as KnowledgeAssetKindV03)) throw new KnowledgeError('RegistryError', `Invalid v0.3 registry entry: ${id}`, registryPath)
      const kind = raw.type as KnowledgeAssetKindV03
      if (ids.has(id)) throw new KnowledgeError('RegistryError', `Duplicate v0.3 registry id: ${id}`, registryPath)
      ids.add(id)
      if (!id.startsWith(namespaceByKind[kind])) throw new KnowledgeError('RegistryError', `Registry namespace does not match kind: ${id}`, registryPath)
      if (typeof raw.storageRef !== 'string') throw new KnowledgeError('RegistryError', `Registry storageRef must be a string: ${id}`, registryPath)
      const filePath = resolveStorageRef(root, raw.storageRef, registryPath)
      let value: unknown
      try { value = parseYaml(await readFile(filePath, 'utf8'), filePath) } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new KnowledgeError('RegistryError', `Registry asset does not exist: ${id}`, registryPath)
        throw error
      }
      if (!isRecord(value) || value.id !== id) throw new KnowledgeError('RegistryError', `Registry key does not match asset id: ${id}`, filePath)
      collection.registry.push({ id, type: kind, storageRef: raw.storageRef } satisfies KnowledgeRegistryEntryV03)
      add(collection, kind, value, filePath, raw.storageRef)
    }
    collection.registry.sort((a, b) => a.id.localeCompare(b.id))
    return collection
  }
}

export async function readCanonicalV03Assets(rootDir: string): Promise<KnowledgeAssetCollectionV03> { return new CanonicalV03KnowledgeLoader(rootDir).readAssets() }
