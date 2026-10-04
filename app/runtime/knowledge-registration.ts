import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join, parse, resolve, sep } from 'node:path'
import { loadKnowledgeBaseManifest } from '../../knowledge/storage/manifest-loader.ts'
import { ApplicationServiceError } from '../services/contracts.ts'
import { validateStorageRoots } from './storage-boundary.ts'

export interface RegisteredKnowledgeBase {
  readonly knowledgeBaseId: string
  readonly label: string
  readonly schemaVersion: '0.3' | '0.4'
  readonly status: string
  readonly revision: number
  readonly available: boolean
  /** Server-only canonical root. API adapters must omit this field. */
  readonly root: string
}

interface StoredRegistration {
  readonly knowledgeBaseId: string
  readonly label: string
  readonly schemaVersion: '0.3' | '0.4'
  readonly status: string
  readonly revision: number
  readonly root: string
}

interface RegistryDocument { readonly version: 1; readonly entries: readonly StoredRegistration[] }

const REGISTRY_FILENAME = 'knowledge-base-registrations.json'
const MAX_REGISTRY_BYTES = 64 * 1024
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/

function registryPath(cwd: string): string { return join(cwd, 'runtime-data', REGISTRY_FILENAME) }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function invalid(message: string): ApplicationServiceError { return new ApplicationServiceError('invalid_input', message) }

function parseDocument(value: unknown): RegistryDocument {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.entries) || value.entries.length > 256) throw new Error('Invalid registration document')
  const entries: StoredRegistration[] = []
  const ids = new Set<string>()
  const roots = new Set<string>()
  for (const raw of value.entries) {
    if (!isRecord(raw) || typeof raw.knowledgeBaseId !== 'string' || !SAFE_ID.test(raw.knowledgeBaseId) || typeof raw.label !== 'string' || !raw.label.trim() || raw.label.length > 256 || (raw.schemaVersion !== '0.3' && raw.schemaVersion !== '0.4') || typeof raw.status !== 'string' || !['active', 'readonly', 'archived'].includes(raw.status) || !Number.isSafeInteger(raw.revision) || (raw.revision as number) < 0 || typeof raw.root !== 'string' || !isAbsolute(raw.root)) throw new Error('Invalid registration entry')
    const canonicalRoot = resolve(raw.root)
    const normalizedPath = canonicalRoot.toLocaleLowerCase()
    if (ids.has(raw.knowledgeBaseId) || roots.has(normalizedPath)) throw new Error('Duplicate registration entry')
    ids.add(raw.knowledgeBaseId)
    roots.add(normalizedPath)
    entries.push({ knowledgeBaseId: raw.knowledgeBaseId, label: raw.label, schemaVersion: raw.schemaVersion, status: raw.status, revision: raw.revision as number, root: canonicalRoot })
  }
  return { version: 1, entries }
}

async function readDocument(cwd: string): Promise<RegistryDocument> {
  try {
    const path = registryPath(cwd)
    const directoryInfo = await lstat(join(cwd, 'runtime-data'))
    const fileInfo = await lstat(path)
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() || !fileInfo.isFile() || fileInfo.isSymbolicLink()) throw new Error('Registration storage is not a regular app-local file')
    const text = await readFile(path, 'utf8')
    if (Buffer.byteLength(text, 'utf8') > MAX_REGISTRY_BYTES) throw new Error('Registration document is oversized')
    return parseDocument(JSON.parse(text) as unknown)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, entries: [] }
    throw new ApplicationServiceError('failed', 'Unable to read Knowledge Base registrations', { cause: error })
  }
}

async function writeDocument(cwd: string, document: RegistryDocument): Promise<void> {
  const path = registryPath(cwd)
  const directory = join(cwd, 'runtime-data')
  const temporary = `${path}.${randomUUID()}.tmp`
  await mkdir(directory, { recursive: true })
  try {
    const directoryInfo = await lstat(directory)
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) throw new Error('Registration storage directory is not local')
    const existingInfo = await lstat(path).catch((error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT' ? undefined : Promise.reject(error))
    if (existingInfo && (!existingInfo.isFile() || existingInfo.isSymbolicLink())) throw new Error('Registration storage file is not regular')
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await rename(temporary, path)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw new ApplicationServiceError('failed', 'Unable to save Knowledge Base registrations', { cause: error })
  }
}

/** Reject symlinked or junction path components, including ancestors of the supplied root. */
async function assertNoLinkedComponents(path: string): Promise<void> {
  const absolute = resolve(path)
  const root = parse(absolute).root
  const components = absolute.slice(root.length).split(sep).filter(Boolean)
  let current = root
  for (const component of components) {
    current = join(current, component)
    const info = await lstat(current).catch((error: unknown) => {
      throw invalid((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'Knowledge Base directory does not exist' : 'Knowledge Base directory cannot be inspected')
    })
    if (info.isSymbolicLink()) throw invalid('Knowledge Base directory cannot contain a symbolic link or junction')
  }
}

async function inspectRoot(path: string, workspaceRoot: string): Promise<StoredRegistration> {
  if (typeof path !== 'string' || path.trim() === '' || !isAbsolute(path)) throw invalid('Knowledge Base directory must be an absolute path')
  const requested = resolve(path)
  try {
    await assertNoLinkedComponents(requested)
    const rootInfo = await lstat(requested)
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw invalid('Knowledge Base path must be an existing directory')
    const root = await realpath(requested)
    const manifestPath = join(root, 'manifest.yaml')
    const manifestInfo = await lstat(manifestPath)
    if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink()) throw invalid('Knowledge Base manifest must be a regular file')
    const manifest = await loadKnowledgeBaseManifest(root)
    if (!SAFE_ID.test(manifest.knowledgeBaseId)) throw invalid('Knowledge Base manifest has an invalid identifier')
    if ((manifest.schemaVersion !== '0.3' && manifest.schemaVersion !== '0.4') || manifest.storageFormatVersion !== '1') throw invalid('Only Schema 0.3 or 0.4 / Storage Format 1 Knowledge Bases can be registered')
    await validateStorageRoots(workspaceRoot, root)
    return { knowledgeBaseId: manifest.knowledgeBaseId, label: manifest.name.slice(0, 256), schemaVersion: manifest.schemaVersion, status: manifest.status, revision: manifest.revision, root }
  } catch (error) {
    if (error instanceof ApplicationServiceError) throw error
    throw invalid('Directory is not a valid, isolated Schema 0.3 or 0.4 / Storage Format 1 Knowledge Base')
  }
}

function samePath(left: string, right: string): boolean { return resolve(left).toLocaleLowerCase() === resolve(right).toLocaleLowerCase() }
function toResult(entry: StoredRegistration, available = true): RegisteredKnowledgeBase { return { ...entry, available } }

export async function validateKnowledgeBaseDirectory(workspaceRoot: string, path: string): Promise<RegisteredKnowledgeBase> {
  return toResult(await inspectRoot(path, workspaceRoot))
}

export async function listRegisteredKnowledgeBases(cwd: string, workspaceRoot: string): Promise<RegisteredKnowledgeBase[]> {
  const document = await readDocument(cwd)
  const result: RegisteredKnowledgeBase[] = []
  for (const stored of document.entries) {
    try {
      const current = await inspectRoot(stored.root, workspaceRoot)
      if (current.knowledgeBaseId === stored.knowledgeBaseId) result.push(toResult(current))
      else result.push(toResult(stored, false))
    } catch {
      result.push(toResult(stored, false))
    }
  }
  return result.sort((left, right) => left.knowledgeBaseId.localeCompare(right.knowledgeBaseId))
}

export async function addRegisteredKnowledgeBase(
  cwd: string,
  workspaceRoot: string,
  path: string,
  existingCatalog: readonly { readonly knowledgeBaseId: string; readonly root: string }[] = [],
): Promise<RegisteredKnowledgeBase> {
  const candidate = await inspectRoot(path, workspaceRoot)
  const document = await readDocument(cwd)
  if (document.entries.some((entry) => entry.knowledgeBaseId === candidate.knowledgeBaseId)) throw invalid('A Knowledge Base with this identifier is already registered')
  if (document.entries.some((entry) => samePath(entry.root, candidate.root))) throw invalid('This Knowledge Base directory is already registered')
  if (existingCatalog.some((entry) => entry.knowledgeBaseId === candidate.knowledgeBaseId)) throw invalid('A Knowledge Base with this identifier is already discoverable')
  if (existingCatalog.some((entry) => samePath(entry.root, candidate.root))) throw invalid('This Knowledge Base directory is already discoverable')
  if (document.entries.length >= 256) throw invalid('Knowledge Base registration limit reached')
  await writeDocument(cwd, { version: 1, entries: [...document.entries, candidate] })
  return toResult(candidate)
}

export async function removeRegisteredKnowledgeBase(cwd: string, knowledgeBaseId: string): Promise<void> {
  if (typeof knowledgeBaseId !== 'string' || !SAFE_ID.test(knowledgeBaseId)) throw invalid('knowledgeBaseId is invalid')
  const document = await readDocument(cwd)
  const entries = document.entries.filter((entry) => entry.knowledgeBaseId !== knowledgeBaseId)
  if (entries.length === document.entries.length) throw new ApplicationServiceError('not_found', 'Knowledge Base registration was not found')
  await writeDocument(cwd, { version: 1, entries })
}
