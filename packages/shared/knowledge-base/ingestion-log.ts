import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseYaml } from './yaml.ts'
import { withKnowledgeBaseMutationLock } from './mutation-lock.ts'
import type { KnowledgeBaseHandle } from './handle.ts'

export interface KnowledgeIngestionLogRecord {
  workflowRunId: string
  knowledgeBaseId: string
  status: 'blocked' | 'completed' | 'completed_with_review'
  ingestionIdentity?: string
  failureStage?: string
  rawRef?: string
  errors?: Array<{ code: string; message: string }>
  [key: string]: unknown
}

function safeRunId(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) || value.includes('..')) throw new Error(`Unsafe workflowRunId: ${value}`)
  return value
}

function logPath(handle: KnowledgeBaseHandle, workflowRunId: string): string {
  return join(resolve(handle.rootRef), 'logs', 'ingestion', `${safeRunId(workflowRunId)}.yaml`)
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true } catch { return false }
}

export class KnowledgeIngestionLogStore {
  async read(handle: KnowledgeBaseHandle, workflowRunId: string): Promise<KnowledgeIngestionLogRecord | undefined> {
    const path = logPath(handle, workflowRunId)
    if (!(await exists(path))) return undefined
    const value = parseYaml(await readFile(path, 'utf8'), path)
    return value && typeof value === 'object' && !Array.isArray(value) ? value as KnowledgeIngestionLogRecord : undefined
  }

  async findSuccessfulByIdentity(handle: KnowledgeBaseHandle, ingestionIdentity: string): Promise<KnowledgeIngestionLogRecord | undefined> {
    const directory = join(resolve(handle.rootRef), 'logs', 'ingestion')
    if (!(await exists(directory))) return undefined
    const { readdir } = await import('node:fs/promises')
    for (const name of (await readdir(directory)).filter((item) => item.endsWith('.yaml')).sort()) {
      const value = parseYaml(await readFile(join(directory, name), 'utf8'), join(directory, name))
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const record = value as KnowledgeIngestionLogRecord
        const context = record.ingestionContext && typeof record.ingestionContext === 'object' && !Array.isArray(record.ingestionContext) ? record.ingestionContext as Record<string, unknown> : undefined
        if ((record.ingestionIdentity === ingestionIdentity || context?.ingestionIdentity === ingestionIdentity) && (record.status === 'completed' || record.status === 'completed_with_review')) return record
      }
    }
    return undefined
  }

  async writeBlocked(handle: KnowledgeBaseHandle, record: KnowledgeIngestionLogRecord): Promise<string> {
    const path = logPath(handle, record.workflowRunId)
    await withKnowledgeBaseMutationLock(resolve(handle.rootRef), async () => {
      if (await exists(path)) return
      await mkdir(join(resolve(handle.rootRef), 'logs', 'ingestion'), { recursive: true })
      await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    })
    return `logs/ingestion/${safeRunId(record.workflowRunId)}.yaml`
  }
}
