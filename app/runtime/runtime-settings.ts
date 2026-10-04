import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface RuntimeModelSelection {
  readonly provider: string
  readonly modelId: string
}

export interface RuntimeSettings {
  readonly revision: number
  readonly model?: RuntimeModelSelection
  /** undefined means no explicit choice has been persisted; null means unmounted. */
  readonly knowledgeBaseId?: string | null
}

const SETTINGS_FILENAME = 'application-settings.json'
const MAX_SETTINGS_BYTES = 16_384

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }

function parseSettings(value: unknown): RuntimeSettings {
  if (!isRecord(value) || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0) throw new Error('Runtime settings document is invalid')
  if (value.model !== undefined && (!isRecord(value.model) || typeof value.model.provider !== 'string' || !value.model.provider || typeof value.model.modelId !== 'string' || !value.model.modelId)) throw new Error('Runtime model selection is invalid')
  if (value.knowledgeBaseId !== undefined && value.knowledgeBaseId !== null && (typeof value.knowledgeBaseId !== 'string' || !value.knowledgeBaseId)) throw new Error('Runtime Knowledge Base selection is invalid')
  if (Object.keys(value).some((key) => !['revision', 'model', 'knowledgeBaseId'].includes(key))) throw new Error('Runtime settings document contains unsupported fields')
  return {
    revision: value.revision as number,
    ...(value.model === undefined ? {} : { model: { provider: (value.model as Record<string, string>).provider, modelId: (value.model as Record<string, string>).modelId } }),
    ...(value.knowledgeBaseId === undefined ? {} : { knowledgeBaseId: value.knowledgeBaseId as string | null }),
  }
}

export async function readRuntimeSettings(cwd: string): Promise<RuntimeSettings> {
  try {
    const text = await readFile(join(cwd, 'runtime-data', SETTINGS_FILENAME), 'utf8')
    if (Buffer.byteLength(text, 'utf8') > MAX_SETTINGS_BYTES) throw new Error('Runtime settings document is oversized')
    return parseSettings(JSON.parse(text) as unknown)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { revision: 0 }
    throw error
  }
}

/** Writes the complete non-secret application settings document using atomic replacement. */
export async function writeRuntimeSettings(cwd: string, next: RuntimeSettings): Promise<RuntimeSettings> {
  const normalized = parseSettings(next)
  const directory = join(cwd, 'runtime-data')
  await mkdir(directory, { recursive: true })
  const path = join(directory, SETTINGS_FILENAME)
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await rename(temporary, path)
  } catch (error) {
    await import('node:fs/promises').then(({ unlink }) => unlink(temporary).catch(() => undefined))
    throw error
  }
  return normalized
}
