import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, extname, join, relative, resolve, sep } from 'node:path'
import { KnowledgeError } from './errors.ts'
import { parseYaml } from './yaml.ts'

const RAW_REF_PATTERN = /^raw-sha256-([0-9a-f]{64})$/
const CONTENT_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/
const SAFE_EXTENSION_PATTERN = /^[a-z0-9]+$/

export type RawMetadataScalar = string | number | boolean | null
export type RawSourceMetadata = Record<string, RawMetadataScalar>

export interface RawManifest {
  schemaVersion: '0.1'
  rawRef: string
  contentHash: string
  originalFilename: string
  safeExtension: string
  contentType: string
  byteLength: number
  sourceMetadata: RawSourceMetadata
  receivedAt: string
  capturedAt: string
  createdAt: string
}

export interface RawRecord {
  manifest: RawManifest
  bundlePath: string
  manifestPath: string
  originalPath: string
  reused?: boolean
}

export interface PutRawInput {
  rawRoot: string
  bytes: Uint8Array
  originalFilename: string
  contentType?: string
  sourceMetadata?: RawSourceMetadata
  capturedAt?: string
  createdAt?: string
}

export interface RawVerification {
  valid: true
  rawRef: string
  contentHash: string
  byteLength: number
}

function assertRawRoot(rawRoot: string): string {
  if (typeof rawRoot !== 'string' || rawRoot.trim() === '') {
    throw new KnowledgeError('RawArchiveError', 'Raw archive root must be a non-empty path')
  }
  return resolve(rawRoot)
}

function assertRawRef(rawRef: string): string {
  if (typeof rawRef !== 'string' || !RAW_REF_PATTERN.test(rawRef)) {
    throw new KnowledgeError('RawArchiveError', `Invalid rawRef: ${String(rawRef)}`)
  }
  return rawRef
}

function assertContained(root: string, candidate: string, description: string): void {
  const escape = relative(root, candidate)
  if (escape === '..' || escape.startsWith(`..${sep}`) || escape.includes(`${sep}..${sep}`)) {
    throw new KnowledgeError('RawArchiveError', `${description} escapes raw archive root: ${candidate}`)
  }
}

function rawPaths(rawRoot: string, rawRef: string): Pick<RawRecord, 'bundlePath' | 'manifestPath'> {
  const root = assertRawRoot(rawRoot)
  const checkedRawRef = assertRawRef(rawRef)
  const rawDirectory = resolve(root, 'raw')
  const bundlePath = resolve(rawDirectory, checkedRawRef)
  assertContained(root, bundlePath, 'Raw bundle path')
  assertContained(rawDirectory, bundlePath, 'Raw bundle path')
  return {
    bundlePath,
    manifestPath: resolve(bundlePath, 'manifest.yaml'),
  }
}

function safeExtension(originalFilename: string): string {
  const extension = extname(basename(originalFilename)).slice(1).toLowerCase()
  return SAFE_EXTENSION_PATTERN.test(extension) ? extension : 'bin'
}

function assertPutInput(input: PutRawInput): void {
  if (!(input.bytes instanceof Uint8Array)) throw new KnowledgeError('RawArchiveError', 'Raw bytes must be a Uint8Array')
  if (typeof input.originalFilename !== 'string' || input.originalFilename.trim() === '' || input.originalFilename.includes('\0')) {
    throw new KnowledgeError('RawArchiveError', 'originalFilename must be a non-empty string without null bytes')
  }
  if (input.contentType !== undefined && (typeof input.contentType !== 'string' || input.contentType.trim() === '')) {
    throw new KnowledgeError('RawArchiveError', 'contentType must be a non-empty string when provided')
  }
  for (const [name, timestamp] of [['capturedAt', input.capturedAt] as const, ['createdAt', input.createdAt] as const]) {
    if (timestamp !== undefined && (typeof timestamp !== 'string' || timestamp.trim() === '')) {
      throw new KnowledgeError('RawArchiveError', `${name} must be a non-empty string when provided`)
    }
  }
}

function assertManifest(value: unknown, expectedRawRef: string): RawManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new KnowledgeError('RawArchiveError', 'Raw manifest must be an object')
  }
  const manifest = value as Partial<RawManifest>
  if (manifest.schemaVersion !== '0.1') throw new KnowledgeError('RawArchiveError', 'Raw manifest schemaVersion must be 0.1')
  if (manifest.rawRef !== expectedRawRef || typeof manifest.rawRef !== 'string' || !RAW_REF_PATTERN.test(manifest.rawRef)) {
    throw new KnowledgeError('RawArchiveError', 'Raw manifest rawRef does not match the requested rawRef')
  }
  if (typeof manifest.contentHash !== 'string' || !CONTENT_HASH_PATTERN.test(manifest.contentHash) || manifest.contentHash !== `sha256:${expectedRawRef.slice('raw-sha256-'.length)}`) {
    throw new KnowledgeError('RawArchiveError', 'Raw manifest contentHash is invalid or does not match rawRef')
  }
  if (typeof manifest.originalFilename !== 'string' || manifest.originalFilename.trim() === '') {
    throw new KnowledgeError('RawArchiveError', 'Raw manifest originalFilename must be a non-empty string')
  }
  if (typeof manifest.safeExtension !== 'string' || !SAFE_EXTENSION_PATTERN.test(manifest.safeExtension)) {
    throw new KnowledgeError('RawArchiveError', 'Raw manifest safeExtension is invalid')
  }
  if (typeof manifest.contentType !== 'string' || manifest.contentType.trim() === '') {
    throw new KnowledgeError('RawArchiveError', 'Raw manifest contentType must be a non-empty string')
  }
  if (!Number.isInteger(manifest.byteLength) || (manifest.byteLength as number) < 0) {
    throw new KnowledgeError('RawArchiveError', 'Raw manifest byteLength must be a non-negative integer')
  }
  if (!manifest.sourceMetadata || typeof manifest.sourceMetadata !== 'object' || Array.isArray(manifest.sourceMetadata)) {
    throw new KnowledgeError('RawArchiveError', 'Raw manifest sourceMetadata must be an object')
  }
  if (typeof manifest.receivedAt !== 'string' || manifest.receivedAt.trim() === '' || typeof manifest.capturedAt !== 'string' || manifest.capturedAt.trim() === '' || typeof manifest.createdAt !== 'string' || manifest.createdAt.trim() === '') {
    throw new KnowledgeError('RawArchiveError', 'Raw manifest receivedAt, capturedAt, and createdAt must be non-empty strings')
  }
  return manifest as RawManifest
}

async function readManifest(rawRoot: string, rawRef: string): Promise<RawRecord> {
  const paths = rawPaths(rawRoot, rawRef)
  for (const path of [resolve(assertRawRoot(rawRoot), 'raw'), paths.bundlePath, paths.manifestPath]) {
    try {
      if ((await lstat(path)).isSymbolicLink()) throw new KnowledgeError('RawArchiveError', `Raw archive path cannot be a symlink: ${path}`, path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  let text: string
  try {
    text = await readFile(paths.manifestPath, 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') throw new KnowledgeError('NotFound', `Raw bundle not found: ${rawRef}`, paths.manifestPath)
    throw new KnowledgeError('RawArchiveError', `Unable to read raw manifest: ${paths.manifestPath}`, paths.manifestPath)
  }
  let manifest: unknown
  try {
    manifest = parseYaml(text, paths.manifestPath)
  } catch (error) {
    if (error instanceof KnowledgeError) throw new KnowledgeError('RawArchiveError', error.message, paths.manifestPath)
    throw new KnowledgeError('RawArchiveError', String(error), paths.manifestPath)
  }
  const checkedManifest = assertManifest(manifest, rawRef)
  const originalPath = resolve(paths.bundlePath, `original.${checkedManifest.safeExtension}`)
  try {
    if ((await lstat(originalPath)).isSymbolicLink()) throw new KnowledgeError('RawArchiveError', `Raw archive file cannot be a symlink: ${originalPath}`, originalPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return {
    manifest: checkedManifest,
    bundlePath: paths.bundlePath,
    manifestPath: paths.manifestPath,
    originalPath,
  }
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

async function updateRawRegistry(rawRoot: string, record: RawRecord): Promise<void> {
  const root = assertRawRoot(rawRoot)
  const registryDir = join(root, 'registry')
  const registryPath = join(registryDir, 'raw.yaml')
  try {
    if ((await lstat(registryDir)).isSymbolicLink()) throw new KnowledgeError('RawArchiveError', `Raw registry directory cannot be a symlink: ${registryDir}`, registryDir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  try {
    if ((await lstat(registryPath)).isSymbolicLink()) throw new KnowledgeError('RawArchiveError', `Raw registry cannot be a symlink: ${registryPath}`, registryPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  let value: Record<string, unknown> = {}
  try {
    const parsed = parseYaml(await readFile(registryPath, 'utf8'), registryPath)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) value = parsed as Record<string, unknown>
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  if (value[record.manifest.rawRef] !== undefined) return
  const storageRef = relative(root, record.originalPath).replaceAll('\\', '/')
  const resolved = resolve(root, storageRef)
  const escaped = relative(root, resolved)
  if (escaped === '..' || escaped.startsWith(`..${sep}`) || storageRef.startsWith('../') || /^[A-Za-z]:[\\/]/.test(storageRef)) throw new KnowledgeError('RawArchiveError', `Raw registry storageRef escapes Knowledge Base root: ${storageRef}`)
  value[record.manifest.rawRef] = { contentHash: record.manifest.contentHash, storageRef }
  await mkdir(registryDir, { recursive: true })
  const temporaryPath = `${registryPath}.tmp-${record.manifest.rawRef.slice(-16)}`
  await writeFile(temporaryPath, `${JSON.stringify(Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))), null, 2)}\n`, 'utf8')
  await rename(temporaryPath, registryPath)
}

export async function putRaw(input: PutRawInput): Promise<RawRecord> {
  assertPutInput(input)
  const rawRoot = assertRawRoot(input.rawRoot)
  const digest = createHash('sha256').update(input.bytes).digest('hex')
  const rawRef = `raw-sha256-${digest}`
  const paths = rawPaths(rawRoot, rawRef)

  try {
    const existing = await getRaw(rawRoot, rawRef)
    const verified = await verifyRaw(rawRoot, rawRef)
    const result = { ...existing, manifest: verified.manifest, originalPath: verified.originalPath, reused: true }
    await updateRawRegistry(rawRoot, result)
    return result
  } catch (error) {
    if (!(error instanceof KnowledgeError) || error.code !== 'NotFound') throw error
  }

  const extension = safeExtension(input.originalFilename)
  const originalPath = resolve(paths.bundlePath, `original.${extension}`)
  const manifest: RawManifest = {
    schemaVersion: '0.1',
    rawRef,
    contentHash: `sha256:${digest}`,
    originalFilename: input.originalFilename,
    safeExtension: extension,
    contentType: input.contentType ?? 'application/octet-stream',
    byteLength: input.bytes.byteLength,
    sourceMetadata: input.sourceMetadata ?? {},
    receivedAt: input.capturedAt ?? new Date().toISOString(),
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    createdAt: input.createdAt ?? new Date().toISOString(),
  }

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
      const existing = await getRaw(rawRoot, rawRef)
      if (existing.originalPath !== originalPath) await unlink(originalPath).catch(() => undefined)
    }
  }
  const verified = await verifyRaw(rawRoot, rawRef)
  const result = {
    manifest: verified.manifest,
    bundlePath: paths.bundlePath,
    manifestPath: paths.manifestPath,
    originalPath: verified.originalPath,
    reused: false,
  }
  await updateRawRegistry(rawRoot, result)
  return result
}

export async function getRaw(rawRoot: string, rawRef: string): Promise<RawRecord> {
  return readManifest(rawRoot, assertRawRef(rawRef))
}

export async function readRaw(rawRoot: string, rawRef: string): Promise<Buffer> {
  const record = await getRaw(rawRoot, rawRef)
  try {
    return await readFile(record.originalPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ENOTDIR') {
      throw new KnowledgeError('NotFound', `Raw bytes not found: ${rawRef}`, record.originalPath)
    }
    throw new KnowledgeError('RawArchiveError', `Unable to read raw bytes: ${record.originalPath}`, record.originalPath)
  }
}

export async function verifyRaw(rawRoot: string, rawRef: string): Promise<RawVerification & { manifest: RawManifest; originalPath: string }> {
  const record = await getRaw(rawRoot, rawRef)
  const bytes = await readRaw(rawRoot, rawRef)
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (bytes.byteLength !== record.manifest.byteLength || digest !== record.manifest.contentHash.slice('sha256:'.length)) {
    throw new KnowledgeError('RawArchiveError', `Raw bytes failed integrity verification: ${rawRef}`, record.originalPath)
  }
  return {
    valid: true,
    rawRef,
    contentHash: record.manifest.contentHash,
    byteLength: bytes.byteLength,
    manifest: record.manifest,
    originalPath: record.originalPath,
  }
}
