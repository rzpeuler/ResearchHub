import { lstat, realpath } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { loadKnowledgeBaseManifest } from '../../knowledge/storage/manifest-loader.ts'
import { ApplicationServiceError } from '../services/contracts.ts'
import { validateStorageRoots } from './storage-boundary.ts'
import { listRegisteredKnowledgeBases } from './knowledge-registration.ts'

export interface KnowledgeBaseChoice {
  readonly knowledgeBaseId: string
  readonly schemaVersion: string
  readonly status: string
  readonly revision: number
}

export interface ResolvedKnowledgeBase extends KnowledgeBaseChoice { readonly root: string }

export interface KnowledgeBaseCatalogOptions {
  readonly cwd: string
  readonly workspaceRoot: string
  readonly configuredRoot?: string
  readonly explicitlyMountedRoot?: string
}

function isInside(root: string, candidate: string): boolean {
  const child = relative(resolve(root), resolve(candidate))
  return child === '' || (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`))
}

function safeId(value: string): boolean { return /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(value) }

async function inspectKnowledgeBase(root: string, workspaceRoot: string): Promise<ResolvedKnowledgeBase | undefined> {
  try {
    const info = await lstat(root)
    if (!info.isDirectory() || info.isSymbolicLink()) return undefined
    const canonicalRoot = await realpath(root)
    const manifestPath = join(canonicalRoot, 'manifest.yaml')
    const manifestInfo = await lstat(manifestPath)
    if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink()) return undefined
    const canonicalManifest = await realpath(manifestPath)
    if (!isInside(canonicalRoot, canonicalManifest)) return undefined
    const manifest = await loadKnowledgeBaseManifest(canonicalRoot)
    if (!safeId(manifest.knowledgeBaseId) || !['0.3', '0.4'].includes(manifest.schemaVersion) || manifest.storageFormatVersion !== '1') return undefined
    await validateStorageRoots(workspaceRoot, canonicalRoot)
    return { root: canonicalRoot, knowledgeBaseId: manifest.knowledgeBaseId, schemaVersion: manifest.schemaVersion, status: manifest.status, revision: manifest.revision }
  } catch {
    return undefined
  }
}

function defaultCatalogRoot(cwd: string): string { return resolve(cwd, '..', 'ResearchHubData', 'knowledge-bases') }

export async function discoverKnowledgeBases(options: KnowledgeBaseCatalogOptions): Promise<readonly ResolvedKnowledgeBase[]> {
  const configuredRoot = options.configuredRoot?.trim()
  const catalogRoot = resolve(configuredRoot || defaultCatalogRoot(options.cwd))
  const byId = new Map<string, ResolvedKnowledgeBase>()
  const ambiguousIds = new Set<string>()
  const addUnambiguous = (candidate: ResolvedKnowledgeBase): void => {
    if (ambiguousIds.has(candidate.knowledgeBaseId)) return
    const previous = byId.get(candidate.knowledgeBaseId)
    if (previous?.root === candidate.root) return
    if (previous !== undefined) {
      byId.delete(candidate.knowledgeBaseId)
      ambiguousIds.add(candidate.knowledgeBaseId)
      return
    }
    byId.set(candidate.knowledgeBaseId, candidate)
  }
  const rootInfo = await lstat(catalogRoot).catch(() => undefined)
  if (rootInfo?.isDirectory() && !rootInfo.isSymbolicLink()) {
    const canonicalCatalogRoot = await realpath(catalogRoot).catch(() => undefined)
    if (canonicalCatalogRoot !== undefined) {
      const { readdir } = await import('node:fs/promises')
      for (const entry of await readdir(canonicalCatalogRoot, { withFileTypes: true }).catch(() => [])) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue
        const candidatePath = join(canonicalCatalogRoot, entry.name)
        const candidate = await inspectKnowledgeBase(candidatePath, options.workspaceRoot)
        if (candidate && isInside(canonicalCatalogRoot, candidate.root) && basename(candidate.root) === entry.name) addUnambiguous(candidate)
      }
    }
  }

  const explicitlyMountedRoot = options.explicitlyMountedRoot?.trim()
  if (explicitlyMountedRoot) {
    const explicit = await inspectKnowledgeBase(resolve(explicitlyMountedRoot), options.workspaceRoot)
    if (explicit) addUnambiguous(explicit)
  }
  for (const registered of await listRegisteredKnowledgeBases(options.cwd, options.workspaceRoot)) {
    if (registered.available) addUnambiguous({ root: registered.root, knowledgeBaseId: registered.knowledgeBaseId, schemaVersion: registered.schemaVersion, status: registered.status, revision: registered.revision })
  }
  return [...byId.values()].sort((left, right) => left.knowledgeBaseId.localeCompare(right.knowledgeBaseId))
}

export async function resolveInitialKnowledgeBase(options: KnowledgeBaseCatalogOptions & { readonly persistedKnowledgeBaseId?: string | null; readonly initialKnowledgeBaseRoot?: string }): Promise<{ readonly catalog: readonly ResolvedKnowledgeBase[]; readonly mounted?: ResolvedKnowledgeBase; readonly selectionError?: string }> {
  const catalog = await discoverKnowledgeBases({ ...options, explicitlyMountedRoot: options.initialKnowledgeBaseRoot ?? options.explicitlyMountedRoot })
  if (options.persistedKnowledgeBaseId !== undefined) {
    if (options.persistedKnowledgeBaseId === null) return { catalog }
    const mounted = catalog.find((candidate) => candidate.knowledgeBaseId === options.persistedKnowledgeBaseId)
    if (!mounted) return { catalog, selectionError: 'The saved Knowledge Base is unavailable. Select a valid Knowledge Base to continue.' }
    return { catalog, mounted }
  }
  if (options.initialKnowledgeBaseRoot) {
    const canonicalInitialRoot = await realpath(resolve(options.initialKnowledgeBaseRoot)).catch(() => resolve(options.initialKnowledgeBaseRoot!))
    const mounted = catalog.find((candidate) => candidate.root.toLocaleLowerCase() === canonicalInitialRoot.toLocaleLowerCase())
    if (!mounted) throw new ApplicationServiceError('invalid_input', 'The configured Knowledge Base is not a supported Schema 0.3/0.4 Storage 1 base')
    return { catalog, mounted }
  }
  return { catalog }
}

export function requireKnowledgeBaseChoice(catalog: readonly ResolvedKnowledgeBase[], knowledgeBaseId: unknown): ResolvedKnowledgeBase | undefined {
  if (knowledgeBaseId === undefined) return undefined
  if (knowledgeBaseId === null) return undefined
  if (typeof knowledgeBaseId !== 'string' || !safeId(knowledgeBaseId)) throw new ApplicationServiceError('invalid_input', 'knowledgeBaseId is invalid')
  const choice = catalog.find((item) => item.knowledgeBaseId === knowledgeBaseId)
  if (!choice) throw new ApplicationServiceError('invalid_input', 'knowledgeBaseId is not present in the server Knowledge Base catalog')
  return choice
}

export function configuredKnowledgeBaseCatalogRoot(cwd: string): string {
  return resolve(process.env.RESEARCHHUB_KNOWLEDGE_BASES_ROOT?.trim() || defaultCatalogRoot(cwd))
}
