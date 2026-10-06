import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { DataSourceTestErrorCode, DataSourceTestKind, DataSourceTestStatus, DataSourceTestSummary } from './data-source-administration-contracts.ts'

export interface DataSourceTestStore {
  list(integrationId: string): Promise<readonly DataSourceTestSummary[]>
  put(summary: DataSourceTestSummary): Promise<void>
}

const kinds: readonly DataSourceTestKind[] = ['connection', 'capability_sample']
const statuses: readonly DataSourceTestStatus[] = ['passed', 'failed', 'cancelled', 'unsupported']
const codes: readonly DataSourceTestErrorCode[] = ['missing_configuration', 'authentication_failed', 'timeout', 'rate_limited', 'access_denied', 'no_data', 'contract_mismatch', 'provider_failed']
const safeId = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value)
const safeCapabilityId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value)

function sanitize(value: DataSourceTestSummary): DataSourceTestSummary {
  if (!safeId(value.integrationId) || !kinds.includes(value.kind) || !statuses.includes(value.status) ||
    (value.capabilityId !== undefined && !safeCapabilityId(value.capabilityId)) ||
    (value.errorCode !== undefined && !codes.includes(value.errorCode)) ||
    !Number.isFinite(Date.parse(value.startedAt)) || !Number.isFinite(Date.parse(value.completedAt))) {
    throw new Error('Invalid data source test summary')
  }
  return {
    integrationId: value.integrationId, kind: value.kind,
    ...(value.capabilityId === undefined ? {} : { capabilityId: value.capabilityId }),
    status: value.status, startedAt: value.startedAt, completedAt: value.completedAt,
    ...(value.errorCode === undefined ? {} : { errorCode: value.errorCode }),
  }
}

function upsert(items: readonly DataSourceTestSummary[], summary: DataSourceTestSummary): DataSourceTestSummary[] {
  const safeSummary = sanitize(summary)
  return [...items.filter((item) => item.integrationId !== safeSummary.integrationId || item.kind !== safeSummary.kind ||
    (safeSummary.kind === 'capability_sample' && item.capabilityId !== safeSummary.capabilityId)), safeSummary]
}

export class MemoryDataSourceTestStore implements DataSourceTestStore {
  private items: DataSourceTestSummary[] = []
  async list(integrationId: string): Promise<readonly DataSourceTestSummary[]> { return this.items.filter((item) => item.integrationId === integrationId).map(sanitize) }
  async put(summary: DataSourceTestSummary): Promise<void> { this.items = upsert(this.items, summary) }
}

export class FileDataSourceTestStore implements DataSourceTestStore {
  private readonly path: string
  private queue: Promise<void> = Promise.resolve()
  constructor(root: string) { this.path = join(resolve(root), 'data-source-test-summaries.json') }
  private async read(): Promise<DataSourceTestSummary[]> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.path, 'utf8'))
      if (!Array.isArray(parsed)) throw new Error('Invalid data source test summary file')
      return parsed.map((item) => sanitize(item as DataSourceTestSummary))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }
  async list(integrationId: string): Promise<readonly DataSourceTestSummary[]> {
    await this.queue
    return (await this.read()).filter((item) => item.integrationId === integrationId)
  }
  async put(summary: DataSourceTestSummary): Promise<void> {
    const write = async () => {
      const next = upsert(await this.read(), summary)
      await mkdir(dirname(this.path), { recursive: true })
      const temporary = `${this.path}.${randomUUID()}.tmp`
      await writeFile(temporary, `${JSON.stringify(next)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
      await rename(temporary, this.path)
    }
    const pending = this.queue.then(write)
    this.queue = pending.catch(() => {})
    await pending
  }
}
