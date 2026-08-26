import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, extname, join, relative, resolve, sep } from 'node:path'
import { KnowledgeError } from './errors.ts'
import { KnowledgeBaseHandle } from './handle.ts'
import { loadKnowledgeBaseManifest } from './manifest-loader.ts'
import { parseYaml } from './yaml.ts'
import type { KnowledgeBaseManifest } from '../../schemas/knowledge/index.ts'

const RAW_REF_PATTERN = /^raw-sha256-([0-9a-f]{64})$/
const CONTENT_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/
const SAFE_EXTENSION_PATTERN = /^[a-z0-9]+$/

export interface RawSuppliedMetadata {
  title: string | null
  institution: string | null
  author: string | null
  publishedAt: string | null
  sourceUrl: string | null
}

export interface RawManifest {
  rawRef: string
  originalFilename: string | null
  mediaType: string
  contentHash: string
  sizeBytes: number
  receivedAt: string
  suppliedMetadata: RawSuppliedMetadata
}

export interface RawRecord {
  manifest: RawManifest
  bundlePath: string
  manifestPath: string
  originalPath: string
  reused?: boolean
}

export interface RawArchiveInput {
  bytes: Uint8Array
  originalFilename?: string | null
  mediaType?: string
  suppliedMetadata?: Partial<RawSuppliedMetadata>
}

export interface RawArchiveOptions {
  clock?: () => string
}

export interface RawVerification {
  valid: true
  rawRef: string
  contentHash: string
  sizeBytes: number
}

function assertHandle(handle: KnowledgeBaseHandle): void {
  if (!(handle instanceof KnowledgeBaseHandle)) throw new KnowledgeError('RawArchiveError', 'Raw API requires a KnowledgeBaseHandle')
  if (typeof handle.rootRef !== 'string' || handle.rootRef.trim() === '') throw new KnowledgeError('RawArchiveError', 'Knowledge Base handle rootRef must be non-empty')
}

async function assertMountedKnowledgeBase(handle: KnowledgeBaseHandle, forWrite: boolean): Promise<KnowledgeBaseManifest> {
  assertHandle(handle)
  const root = resolve(handle.rootRef)
  let manifest
  try {
    manifest = await loadKnowledgeBaseManifest(root)
  } catch (error) {
    if (error instanceof KnowledgeError) throw error
    throw new KnowledgeError('RawArchiveError', String(error), root)
  }
  if (manifest.knowledgeBaseId !== handle.knowledgeBaseId) throw new KnowledgeError('RawArchiveError', 'Knowledge Base handle identity does not match mounted manifest', root)
  if (manifest.schemaVersion !== handle.schemaVersion || manifest.storageFormatVersion !== handle.storageFormatVersion) throw new KnowledgeError('RawArchiveError', 'Knowledge Base handle compatibility does not match mounted manifest', root)
  if (forWrite && (manifest.schemaVersion !== '0.2' || manifest.storageFormatVersion !== '1' || manifest.status !== 'active' || !handle.writable)) {
    throw new KnowledgeError('RawArchiveError', 'Raw archive requires an active writable Schema 0.2 / Storage 1 Knowledge Base', root)
  }
  return manifest
}

function assertRawRef(rawRef: string): string {
  if (typeof rawRef !== 'string' || !RAW_REF_PATTERN.test(rawRef)) throw new KnowledgeError('RawArchiveError', `Invalid rawRef: ${String(rawRef)}`)
  return rawRef
}

function assertContained(root: string, candidate: string, description: string): void {
  const escape = relative(root, candidate)
  if (escape === '..' || escape.startsWith(`..${sep}`) || escape.includes(`${sep}..${sep}`)) throw new KnowledgeError('RawArchiveError', `${description} escapes Knowledge Base root: ${candidate}`)
}

function rawPaths(rootRef: string, rawRef: string): Pick<RawRecord, 'bundlePath' | 'manifestPath'> {
  const root = resolve(rootRef)
  const checkedRef = assertRawRef(rawRef)
  const rawDirectory = resolve(root, 'raw')
  const bundlePath = resolve(rawDirectory, checkedRef)
  assertContained(root, bundlePath, 'Raw bundle path')
  assertContained(rawDirectory, bundlePath, 'Raw bundle path')
  return { bundlePath, manifestPath: resolve(bundlePath, 'manifest.yaml') }
}

function safeExtension(originalFilename: string | null | undefined): string {
  if (!originalFilename) return 'bin'
  const extension = extname(basename(originalFilename)).slice(1).toLowerCase()
  return SAFE_EXTENSION_PATTERN.test(extension) ? extension : 'bin'
}

function assertArchiveInput(input: RawArchiveInput): void {
  if (!(input.bytes instanceof Uint8Array)) throw new KnowledgeError('RawArchiveError', 'Raw bytes must be a Uint8Array')
  if (input.originalFilename !== undefined && input.originalFilename !== null && (typeof input.originalFilename !== 'string' || input.originalFilename.includes('\0'))) throw new KnowledgeError('RawArchiveError', 'originalFilename must be a string, null, or omitted without null bytes')
  if (input.mediaType !== undefined && (typeof input.mediaType !== 'string' || input.mediaType.trim() === '')) throw new KnowledgeError('RawArchiveError', 'mediaType must be a non-empty string when provided')
  if (input.suppliedMetadata !== undefined && (typeof input.suppliedMetadata !== 'object' || input.suppliedMetadata === null || Array.isArray(input.suppliedMetadata))) throw new KnowledgeError('RawArchiveError', 'suppliedMetadata must be an object')
  for (const field of ['title', 'institution', 'author', 'publishedAt', 'sourceUrl'] as const) {
    const value = input.suppliedMetadata?.[field]
    if (value !== undefined && value !== null && typeof value !== 'string') throw new KnowledgeError('RawArchiveError', `suppliedMetadata.${field} must be a string or null`)
  }
}

function assertManifest(value: unknown, expectedRawRef: string): RawManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new KnowledgeError('RawArchiveError', 'Raw manifest must be an object')
  const manifest = value as Partial<RawManifest>
  if (manifest.rawRef !== expectedRawRef || typeof manifest.rawRef !== 'string' || !RAW_REF_PATTERN.test(manifest.rawRef)) throw new KnowledgeError('RawArchiveError', 'Raw manifest rawRef does not match requested rawRef')
  if (typeof manifest.contentHash !== 'string' || !CONTENT_HASH_PATTERN.test(manifest.contentHash) || manifest.contentHash !== `sha256:${expectedRawRef.slice('raw-sha256-'.length)}`) throw new KnowledgeError('RawArchiveError', 'Raw manifest contentHash is invalid or does not match rawRef')
  if (manifest.originalFilename !== null && typeof manifest.originalFilename !== 'string') throw new KnowledgeError('RawArchiveError', 'Raw manifest originalFilename must be a string or null')
  if (typeof manifest.mediaType !== 'string' || manifest.mediaType.trim() === '') throw new KnowledgeError('RawArchiveError', 'Raw manifest mediaType must be a non-empty string')
  if (!Number.isInteger(manifest.sizeBytes) || (manifest.sizeBytes as number) < 0) throw new KnowledgeError('RawArchiveError', 'Raw manifest sizeBytes must be a non-negative integer')
  if (typeof manifest.receivedAt !== 'string' || manifest.receivedAt.trim() === '' || Number.isNaN(Date.parse(manifest.receivedAt))) throw new KnowledgeError('RawArchiveError', 'Raw manifest receivedAt must be a valid datetime')
  const metadata = manifest.suppliedMetadata
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new KnowledgeError('RawArchiveError', 'Raw manifest suppliedMetadata must be an object')
  for (const field of ['title', 'institution', 'author', 'publishedAt', 'sourceUrl'] as const) {
    const value = (metadata as unknown as Record<string, unknown>)[field]
    if (value !== null && typeof value !== 'string') throw new KnowledgeError('RawArchiveError', `Raw manifest suppliedMetadata.${field} must be a string or null`)
  }
  return manifest as RawManifest
}

async function rejectSymlink(path: string, description: string): Promise<void> {
  try {
    if ((await lstat(path)).isSymbolicLink()) throw new KnowledgeError('RawArchiveError', `${description} cannot be a symlink: ${path}`, path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

async function readRegistryEntry(root: string, rawRef: string): Promise<{ contentHash: string; storageRef: string }> {
  await rejectSymlink(join(root, 'registry'), 'Raw registry directory')
  const registryPath = join(root, 'registry', 'raw.yaml')
  await rejectSymlink(registryPath, 'Raw registry')
  let registryValue: unknown
  try {
    registryValue = parseYaml(await readFile(registryPath, 'utf8'), registryPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new KnowledgeError('NotFound', `Raw registry entry not found: ${rawRef}`, registryPath)
    throw new KnowledgeError('RawArchiveError', String(error), registryPath)
  }
  const entry = registryValue && typeof registryValue === 'object' && !Array.isArray(registryValue) ? (registryValue as Record<string, unknown>)[rawRef] : undefined
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new KnowledgeError('NotFound', `Raw registry entry not found: ${rawRef}`, registryPath)
  const value = entry as { contentHash?: unknown; storageRef?: unknown }
  if (typeof value.contentHash !== 'string' || typeof value.storageRef !== 'string') throw new KnowledgeError('RawArchiveError', `Raw registry entry is invalid: ${rawRef}`, registryPath)
  return { contentHash: value.contentHash, storageRef: value.storageRef }
}

async function readManifest(handle: KnowledgeBaseHandle, rawRef: string): Promise<RawRecord> {
  await assertMountedKnowledgeBase(handle, false)
  const root = resolve(handle.rootRef)
  const checkedRef = assertRawRef(rawRef)
  const paths = rawPaths(root, checkedRef)
  await rejectSymlink(resolve(root, 'raw'), 'Raw directory')
  await rejectSymlink(paths.bundlePath, 'Raw bundle')
  await rejectSymlink(paths.manifestPath, 'Raw manifest')
  let parsed: unknown
  try {
    parsed = parseYaml(await readFile(paths.manifestPath, 'utf8'), paths.manifestPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ENOTDIR') throw new KnowledgeError('NotFound', `Raw bundle not found: ${checkedRef}`, paths.manifestPath)
    throw new KnowledgeError('RawArchiveError', String(error), paths.manifestPath)
  }
  const manifest = assertManifest(parsed, checkedRef)
  const registryEntry = await readRegistryEntry(root, checkedRef)
  const originalPath = resolve(root, registryEntry.storageRef)
  assertContained(root, originalPath, 'Raw registry storageRef')
  assertContained(paths.bundlePath, originalPath, 'Raw registry storageRef')
  if (registryEntry.contentHash !== manifest.contentHash) throw new KnowledgeError('RawArchiveError', `Raw registry hash does not match manifest: ${checkedRef}`, join(root, 'registry', 'raw.yaml'))
  await rejectSymlink(originalPath, 'Raw bytes')
  return { manifest, bundlePath: paths.bundlePath, manifestPath: paths.manifestPath, originalPath }
}

async function bytesMatch(path: string, expected: Uint8Array): Promise<boolean> {
  try {
    const actual = await readFile(path)
    return actual.length === expected.byteLength && Buffer.from(actual).equals(Buffer.from(expected))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function updateRawRegistry(root: string, record: RawRecord): Promise<void> {
  const registryDir = join(root, 'registry')
  const registryPath = join(registryDir, 'raw.yaml')
  await rejectSymlink(registryDir, 'Raw registry directory')
  await rejectSymlink(registryPath, 'Raw registry')
  let value: Record<string, unknown> = {}
  try {
    const parsed = parseYaml(await readFile(registryPath, 'utf8'), registryPath)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) value = parsed as Record<string, unknown>
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new KnowledgeError('RawArchiveError', String(error), registryPath)
  }
  if (value[record.manifest.rawRef] !== undefined) return
  const storageRef = relative(root, record.originalPath).replaceAll('\\', '/')
  const resolved = resolve(root, storageRef)
  assertContained(root, resolved, 'Raw registry storageRef')
  value[record.manifest.rawRef] = { contentHash: record.manifest.contentHash, storageRef }
  await mkdir(registryDir, { recursive: true })
  const temporaryPath = `${registryPath}.tmp-${record.manifest.rawRef.slice(-16)}`
  await writeFile(temporaryPath, `${JSON.stringify(Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))), null, 2)}\n`, 'utf8')
  await rename(temporaryPath, registryPath)
}

export async function archiveRaw(handle: KnowledgeBaseHandle, input: RawArchiveInput, options: RawArchiveOptions = {}): Promise<RawRecord> {
  assertArchiveInput(input)
  await assertMountedKnowledgeBase(handle, true)
  const root = resolve(handle.rootRef)
  const digest = createHash('sha256').update(input.bytes).digest('hex')
  const rawRef = `raw-sha256-${digest}`
  const paths = rawPaths(root, rawRef)
  try {
    const existing = await getRaw(handle, rawRef)
    const verified = await verifyRaw(handle, rawRef)
    return { ...existing, manifest: verified.manifest, originalPath: verified.originalPath, reused: true }
  } catch (error) {
    if (!(error instanceof KnowledgeError) || error.code !== 'NotFound') throw error
  }

  const extension = safeExtension(input.originalFilename)
  const originalPath = resolve(paths.bundlePath, `original.${extension}`)
  const metadata: RawSuppliedMetadata = {
    title: input.suppliedMetadata?.title ?? null,
    institution: input.suppliedMetadata?.institution ?? null,
    author: input.suppliedMetadata?.author ?? null,
    publishedAt: input.suppliedMetadata?.publishedAt ?? null,
    sourceUrl: input.suppliedMetadata?.sourceUrl ?? null,
  }
  const receivedAt = options.clock?.() ?? new Date().toISOString()
  if (typeof receivedAt !== 'string' || receivedAt.trim() === '') throw new KnowledgeError('RawArchiveError', 'Raw archive clock must return a non-empty string')
  const manifest: RawManifest = { rawRef, originalFilename: input.originalFilename ?? null, mediaType: input.mediaType ?? 'application/octet-stream', contentHash: `sha256:${digest}`, sizeBytes: input.bytes.byteLength, receivedAt, suppliedMetadata: metadata }

  await mkdir(paths.bundlePath, { recursive: true })
  let createdOriginal = false
  try {
    await writeFile(originalPath, input.bytes, { flag: 'wx' })
    createdOriginal = true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new KnowledgeError('RawArchiveError', `Unable to write raw bytes: ${originalPath}`, originalPath)
    if (!(await bytesMatch(originalPath, input.bytes))) throw new KnowledgeError('RawArchiveError', `Existing raw bytes do not match content hash: ${originalPath}`, originalPath)
  }
  try {
    await writeFile(paths.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      if (createdOriginal) await unlink(originalPath).catch(() => undefined)
      throw new KnowledgeError('RawArchiveError', `Unable to write raw manifest: ${paths.manifestPath}`, paths.manifestPath)
    }
    if (createdOriginal) {
      const existing = await getRaw(handle, rawRef)
      if (existing.originalPath !== originalPath) await unlink(originalPath).catch(() => undefined)
      return { ...existing, reused: true }
    }
  }
  const result: RawRecord = { manifest, bundlePath: paths.bundlePath, manifestPath: paths.manifestPath, originalPath, reused: false }
  await updateRawRegistry(root, result)
  const verified = await verifyRaw(handle, rawRef)
  return { ...result, manifest: verified.manifest, originalPath: verified.originalPath }
}

export async function getRaw(handle: KnowledgeBaseHandle, rawRef: string): Promise<RawRecord> {
  return readManifest(handle, assertRawRef(rawRef))
}

export async function readRaw(handle: KnowledgeBaseHandle, rawRef: string): Promise<Buffer> {
  const record = await getRaw(handle, rawRef)
  try {
    return await readFile(record.originalPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ENOTDIR') throw new KnowledgeError('NotFound', `Raw bytes not found: ${rawRef}`, record.originalPath)
    throw new KnowledgeError('RawArchiveError', `Unable to read raw bytes: ${record.originalPath}`, record.originalPath)
  }
}

export async function verifyRaw(handle: KnowledgeBaseHandle, rawRef: string): Promise<RawVerification & { manifest: RawManifest; originalPath: string }> {
  const record = await getRaw(handle, rawRef)
  const bytes = await readRaw(handle, rawRef)
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (bytes.byteLength !== record.manifest.sizeBytes || digest !== record.manifest.contentHash.slice('sha256:'.length)) throw new KnowledgeError('RawArchiveError', `Raw bytes failed integrity verification: ${rawRef}`, record.originalPath)
  return { valid: true, rawRef, contentHash: record.manifest.contentHash, sizeBytes: bytes.byteLength, manifest: record.manifest, originalPath: record.originalPath }
}
