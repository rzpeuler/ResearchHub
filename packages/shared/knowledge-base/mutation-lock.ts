import { createHash } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const processLocks = new Map<string, Promise<void>>()

export class KnowledgeMutationLockError extends Error {
  constructor(message: string, public readonly conflict: boolean) {
    super(message)
    this.name = 'KnowledgeMutationLockError'
  }
}

function normalizedRoot(rootRef: string): string {
  if (typeof rootRef !== 'string' || rootRef.trim() === '') throw new KnowledgeMutationLockError('Knowledge Base rootRef must be non-empty', false)
  return resolve(rootRef)
}

export function knowledgeBaseMutationLockPath(rootRef: string): string {
  const root = normalizedRoot(rootRef)
  return `${resolve(dirname(root), `.${createHash('sha256').update(root).digest('hex').slice(0, 24)}.knowledge-write-lock`)}`
}

async function acquireFilesystemLock(rootRef: string): Promise<() => Promise<void>> {
  const root = normalizedRoot(rootRef)
  const lockPath = knowledgeBaseMutationLockPath(root)
  try {
    await mkdir(lockPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new KnowledgeMutationLockError('Knowledge Base mutation lock is already held', true)
    throw new KnowledgeMutationLockError(`Unable to create Knowledge Base mutation lock: ${String(error)}`, false)
  }
  try {
    await writeFile(resolve(lockPath, 'owner.json'), JSON.stringify({ rootPath: root, acquiredAt: new Date().toISOString() }) + '\n', 'utf8')
  } catch (error) {
    await rm(lockPath, { recursive: true, force: true }).catch(() => undefined)
    throw new KnowledgeMutationLockError(`Unable to write Knowledge Base mutation lock owner: ${String(error)}`, false)
  }
  return async () => {
    try {
      await rm(lockPath, { recursive: true, force: false })
    } catch (error) {
      throw new KnowledgeMutationLockError(`Unable to release Knowledge Base mutation lock: ${String(error)}`, false)
    }
  }
}

export async function withKnowledgeBaseMutationLock<T>(rootRef: string, task: () => Promise<T>): Promise<T> {
  const root = normalizedRoot(rootRef)
  const previous = processLocks.get(root) ?? Promise.resolve()
  let releaseProcess!: () => void
  const current = new Promise<void>((resolveRelease) => { releaseProcess = resolveRelease })
  const chain = previous.then(() => current)
  processLocks.set(root, chain)
  await previous
  let releaseFilesystem: (() => Promise<void>) | undefined
  try {
    releaseFilesystem = await acquireFilesystemLock(root)
    return await task()
  } finally {
    try {
      await releaseFilesystem?.()
    } finally {
      releaseProcess()
      if (processLocks.get(root) === chain) processLocks.delete(root)
    }
  }
}
