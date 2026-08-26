import { createHash } from 'node:crypto'
import { access, cp, lstat, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { parseKnowledgeBaseManifest } from '../../schemas/knowledge/index.ts'
import { canonicalSerialize } from './canonical-hash.ts'
import { parseYaml } from './yaml.ts'

export type KnowledgeRootTransactionFailpoint = (point: 'before_switch' | 'during_switch' | 'after_switch') => void | Promise<void>

export interface KnowledgeRootTransactionJournal {
  transactionId: string
  transactionKind?: 'write' | 'migration'
  knowledgeBaseId: string
  previousRevision: number
  nextRevision: number
  stagingPath: string
  backupPath: string
  rootPath: string
  status: 'staged' | 'switching' | 'committed'
  targetSchemaVersion?: string
  targetStorageFormatVersion?: string
  targetStatus?: string
}

export interface KnowledgeRootTransactionOptions {
  rootRef: string
  transactionId: string
  transactionKind: 'write' | 'migration'
  knowledgeBaseId: string
  previousRevision: number
  nextRevision: number
  targetSchemaVersion: string
  targetStorageFormatVersion: string
  targetStatus?: string
  prepare(stagingPath: string): Promise<void>
  validate(stagingPath: string): Promise<void>
  failpoint?: KnowledgeRootTransactionFailpoint
}

function markerPath(rootPath: string): string { return `${rootPath}.recovery.json` }
function exists(path: string): Promise<boolean> { return access(path).then(() => true, () => false) }
function journalPaths(rootPath: string, transactionId: string): { stagingPath: string; backupPath: string } {
  const suffix = createHash('sha256').update(transactionId).digest('hex').slice(0, 16)
  return { stagingPath: `${rootPath}.staging-${suffix}`, backupPath: `${rootPath}.backup-${suffix}` }
}
function jsonYaml(value: unknown): string { return `${canonicalSerialize(value)}\n` }

function validateJournal(rootPath: string, journal: KnowledgeRootTransactionJournal): void {
  if (!journal || typeof journal !== 'object' || journal.rootPath !== rootPath || typeof journal.knowledgeBaseId !== 'string' || journal.knowledgeBaseId.trim() === '') throw new Error('Recovery marker identity is invalid')
  if (!Number.isInteger(journal.previousRevision) || !Number.isInteger(journal.nextRevision) || journal.previousRevision < 0 || journal.nextRevision < journal.previousRevision) throw new Error('Recovery marker revision is invalid')
  if (!['staged', 'switching', 'committed'].includes(journal.status)) throw new Error('Recovery marker status is invalid')
  const siblingPattern = (prefix: string, value: unknown) => typeof value === 'string' && value.startsWith(`${rootPath}.${prefix}-`) && /^[0-9a-f]{16}$/.test(value.slice(`${rootPath}.${prefix}-`.length)) && dirname(resolve(value)) === dirname(rootPath)
  if (!siblingPattern('staging', journal.stagingPath) || !siblingPattern('backup', journal.backupPath)) throw new Error('Recovery marker paths are invalid')
}

async function validateRecoveredRoot(rootPath: string, journal: KnowledgeRootTransactionJournal): Promise<void> {
  const manifest = parseKnowledgeBaseManifest(parseYaml(await readFile(resolve(rootPath, 'manifest.yaml'), 'utf8'), resolve(rootPath, 'manifest.yaml')))
  if (manifest.knowledgeBaseId !== journal.knowledgeBaseId || manifest.revision !== journal.nextRevision) throw new Error('Recovery manifest identity or revision is invalid')
  if (journal.targetSchemaVersion && manifest.schemaVersion !== journal.targetSchemaVersion) throw new Error('Recovery target schema is invalid')
  if (journal.targetStorageFormatVersion && manifest.storageFormatVersion !== journal.targetStorageFormatVersion) throw new Error('Recovery target storage format is invalid')
  if (journal.targetStatus && manifest.status !== journal.targetStatus) throw new Error('Recovery target lifecycle is invalid')
  const registryPath = resolve(rootPath, 'registry', 'assets.yaml')
  const registry = parseYaml(await readFile(registryPath, 'utf8'), registryPath)
  if (typeof registry !== 'object' || registry === null || Array.isArray(registry)) throw new Error('Recovery canonical Registry is invalid')
}

export async function recoverKnowledgeBaseRoot(rootRef: string): Promise<'none' | 'recovered' | 'committed'> {
  const rootPath = resolve(rootRef)
  const recoveryPath = markerPath(rootPath)
  if (!(await exists(recoveryPath))) return 'none'
  if ((await lstat(recoveryPath)).isSymbolicLink()) throw new Error('Recovery marker cannot be a symlink')
  const journal = JSON.parse(await readFile(recoveryPath, 'utf8')) as KnowledgeRootTransactionJournal
  validateJournal(rootPath, journal)
  for (const path of [journal.stagingPath, journal.backupPath]) if (await exists(path) && (await lstat(path)).isSymbolicLink()) throw new Error(`Recovery transaction path cannot be a symlink: ${path}`)
  const rootExists = await exists(journal.rootPath)
  const stagingExists = await exists(journal.stagingPath)
  const backupExists = await exists(journal.backupPath)
  if (!rootExists && stagingExists) {
    await rename(journal.stagingPath, journal.rootPath)
    try {
      await validateRecoveredRoot(journal.rootPath, journal)
    } catch (error) {
      await rm(journal.rootPath, { recursive: true, force: true })
      if (backupExists) await rename(journal.backupPath, journal.rootPath)
      throw error
    }
  } else if (!rootExists && backupExists) await rename(journal.backupPath, journal.rootPath)
  else if (rootExists && stagingExists) await rm(journal.stagingPath, { recursive: true, force: true })
  if (await exists(journal.backupPath)) await rm(journal.backupPath, { recursive: true, force: true })
  if (await exists(journal.stagingPath)) await rm(journal.stagingPath, { recursive: true, force: true })
  await rm(recoveryPath, { force: true })
  return rootExists || stagingExists ? 'recovered' : 'committed'
}

export async function runKnowledgeRootTransaction(options: KnowledgeRootTransactionOptions): Promise<void> {
  const rootPath = resolve(options.rootRef)
  const recoveryPath = markerPath(rootPath)
  const { stagingPath, backupPath } = journalPaths(rootPath, options.transactionId)
  const journal: KnowledgeRootTransactionJournal = { transactionId: options.transactionId, transactionKind: options.transactionKind, knowledgeBaseId: options.knowledgeBaseId, previousRevision: options.previousRevision, nextRevision: options.nextRevision, stagingPath, backupPath, rootPath, status: 'staged', targetSchemaVersion: options.targetSchemaVersion, targetStorageFormatVersion: options.targetStorageFormatVersion, targetStatus: options.targetStatus }
  await rm(stagingPath, { recursive: true, force: true })
  await rm(backupPath, { recursive: true, force: true })
  try {
    await cp(rootPath, stagingPath, { recursive: true, errorOnExist: true })
    await options.prepare(stagingPath)
    await options.validate(stagingPath)
    await writeFile(recoveryPath, jsonYaml(journal), 'utf8')
    await options.failpoint?.('before_switch')
    await rename(rootPath, backupPath)
    journal.status = 'switching'
    await writeFile(recoveryPath, jsonYaml(journal), 'utf8')
    await options.failpoint?.('during_switch')
    await rename(stagingPath, rootPath)
    journal.status = 'committed'
    await writeFile(recoveryPath, jsonYaml(journal), 'utf8')
    await options.failpoint?.('after_switch')
    await rm(backupPath, { recursive: true, force: true })
    await rm(recoveryPath, { force: true })
  } catch (error) {
    if (!(await exists(recoveryPath))) {
      await rm(stagingPath, { recursive: true, force: true }).catch(() => undefined)
      await rm(backupPath, { recursive: true, force: true }).catch(() => undefined)
    }
    throw error
  }
}
