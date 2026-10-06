import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { DataSourceIntegrationView, DataSourceTestSummary } from './data-source-administration-contracts.ts'

export type DataSourceOnboardingStatus = 'draft' | 'ready_for_adapter' | 'adapter_available' | 'verified'

export interface DataSourceOnboardingDraftInput {
  readonly integrationId: string
  readonly displayName: string
  readonly documentationUrl: string
  readonly accessMode: 'api' | 'rss' | 'web' | 'python_bridge' | 'other'
  readonly publisher: string
  readonly proposedAuthority: 'S0_STATUTORY' | 'S1_OFFICIAL' | 'S2_PROFESSIONAL' | 'S3_AGGREGATOR' | 'S4_COMMUNITY' | 'unknown'
  readonly capabilityIds: readonly string[]
  readonly metricIds: readonly string[]
  readonly authenticationMode: 'none' | 'api_key' | 'oauth' | 'other'
  readonly termsUrl?: string
  readonly rightsNotes: string
  readonly rateLimitNotes: string
  readonly timeBoundaryNotes: string
  readonly providerTermsReviewed: boolean
}

export interface DataSourceOnboardingDraft {
  readonly requestId: string
  readonly input: DataSourceOnboardingDraftInput
  readonly status: DataSourceOnboardingStatus
  readonly createdAt: string
  readonly updatedAt: string
}

export interface DataSourceOnboardingService {
  list(): Promise<readonly DataSourceOnboardingDraft[]>
  create(input: DataSourceOnboardingDraftInput): Promise<DataSourceOnboardingDraft>
  update(requestId: string, input: DataSourceOnboardingDraftInput): Promise<DataSourceOnboardingDraft>
  markReady(requestId: string): Promise<DataSourceOnboardingDraft>
}

type PersistedDraft = Omit<DataSourceOnboardingDraft, 'status'> & { readonly status: 'draft' | 'ready_for_adapter' }
type IntegrationInventory = Pick<{ listIntegrations(): Promise<readonly DataSourceIntegrationView[]> }, 'listIntegrations'>

const fields = ['integrationId', 'displayName', 'documentationUrl', 'accessMode', 'publisher', 'proposedAuthority',
  'capabilityIds', 'metricIds', 'authenticationMode', 'termsUrl', 'rightsNotes', 'rateLimitNotes', 'timeBoundaryNotes',
  'providerTermsReviewed'] as const
const required = fields.filter((field) => field !== 'termsUrl')
const accessModes = ['api', 'rss', 'web', 'python_bridge', 'other']
const authorities = ['S0_STATUTORY', 'S1_OFFICIAL', 'S2_PROFESSIONAL', 'S3_AGGREGATOR', 'S4_COMMUNITY', 'unknown']
const authenticationModes = ['none', 'api_key', 'oauth', 'other']
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const credentialText = /\bbearer\s+\S+|\b(?:api_key|token|secret|password)\s*[:=]\s*\S+/i
const sensitiveKey = /^(?:key|api_key|token|secret|password)$/i

function invalid(): never { throw new Error('Invalid data source onboarding draft') }

function boundedText(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.length <= limit && !credentialText.test(value)
}

function safeUrl(value: unknown, allowBlank: boolean): value is string {
  if (value === '' && allowBlank) return true
  if (typeof value !== 'string' || value.length > 2048) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password && !url.hash &&
      [...url.searchParams.keys()].every((key) => !sensitiveKey.test(key))
  } catch { return false }
}

function safeIds(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 32 &&
    value.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 64 && /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(id)) &&
    new Set(value).size === value.length
}

function validateInput(value: unknown): DataSourceOnboardingDraftInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  const record = value as Record<string, unknown>
  if (Object.keys(record).some((key) => !fields.includes(key as typeof fields[number])) ||
    required.some((key) => !Object.hasOwn(record, key)) ||
    typeof record.integrationId !== 'string' || record.integrationId.length > 64 || !idPattern.test(record.integrationId) ||
    !boundedText(record.displayName, 120) || !safeUrl(record.documentationUrl, true) ||
    !accessModes.includes(record.accessMode as string) || !boundedText(record.publisher, 200) ||
    !authorities.includes(record.proposedAuthority as string) || !safeIds(record.capabilityIds) || !safeIds(record.metricIds) ||
    !authenticationModes.includes(record.authenticationMode as string) ||
    (record.termsUrl !== undefined && !safeUrl(record.termsUrl, false)) ||
    !boundedText(record.rightsNotes, 2000) || !boundedText(record.rateLimitNotes, 2000) ||
    !boundedText(record.timeBoundaryNotes, 2000) || typeof record.providerTermsReviewed !== 'boolean') invalid()
  const input: DataSourceOnboardingDraftInput = {
    integrationId: record.integrationId as string, displayName: record.displayName as string,
    documentationUrl: record.documentationUrl as string, accessMode: record.accessMode as DataSourceOnboardingDraftInput['accessMode'],
    publisher: record.publisher as string, proposedAuthority: record.proposedAuthority as DataSourceOnboardingDraftInput['proposedAuthority'],
    capabilityIds: [...record.capabilityIds as string[]], metricIds: [...record.metricIds as string[]],
    authenticationMode: record.authenticationMode as DataSourceOnboardingDraftInput['authenticationMode'],
    ...(record.termsUrl === undefined ? {} : { termsUrl: record.termsUrl as string }),
    rightsNotes: record.rightsNotes as string, rateLimitNotes: record.rateLimitNotes as string,
    timeBoundaryNotes: record.timeBoundaryNotes as string, providerTermsReviewed: record.providerTermsReviewed as boolean,
  }
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > 16 * 1024) invalid()
  return input
}

function complete(input: DataSourceOnboardingDraftInput): boolean {
  return !!input.displayName.trim() && safeUrl(input.documentationUrl, false) && !!input.publisher.trim() &&
    input.proposedAuthority !== 'unknown' && input.capabilityIds.length + input.metricIds.length > 0 &&
    input.providerTermsReviewed && !!input.rightsNotes.trim() && !!input.rateLimitNotes.trim() && !!input.timeBoundaryNotes.trim()
}

function safePersisted(value: unknown): PersistedDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== 5 ||
    ['requestId', 'input', 'status', 'createdAt', 'updatedAt'].some((key) => !Object.hasOwn(record, key)) ||
    typeof record.requestId !== 'string' || !/^[0-9a-f-]{36}$/.test(record.requestId) ||
    (record.status !== 'draft' && record.status !== 'ready_for_adapter') ||
    typeof record.createdAt !== 'string' || !Number.isFinite(Date.parse(record.createdAt)) ||
    typeof record.updatedAt !== 'string' || !Number.isFinite(Date.parse(record.updatedAt))) invalid()
  const input = validateInput(record.input)
  if (record.status === 'ready_for_adapter' && !complete(input)) invalid()
  return { requestId: record.requestId as string, input, status: record.status as PersistedDraft['status'],
    createdAt: record.createdAt as string, updatedAt: record.updatedAt as string }
}

function allTestsPassed(view: DataSourceIntegrationView): boolean {
  const slots: Array<{ kind: 'connection' | 'capability_sample'; capabilityId?: string }> = []
  if (view.integration.supportedTests.connection) slots.push({ kind: 'connection' })
  for (const capabilityId of view.integration.supportedTests.capabilitySamples) slots.push({ kind: 'capability_sample', capabilityId })
  return slots.length > 0 && slots.every((slot) => {
    const summary: DataSourceTestSummary | undefined = view.latestTests
      .filter((item) => item.integrationId === view.integration.integrationId && item.kind === slot.kind && item.capabilityId === slot.capabilityId)
      .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt))[0]
    return summary?.status === 'passed'
  })
}

export function createDataSourceOnboardingService(options: { readonly root: string; readonly integrations?: IntegrationInventory }): DataSourceOnboardingService {
  const path = join(resolve(options.root), 'source-onboarding', 'drafts.json')
  let queue: Promise<void> = Promise.resolve()
  const read = async (): Promise<PersistedDraft[]> => {
    try {
      const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
      if (!Array.isArray(parsed)) invalid()
      const drafts = parsed.map(safePersisted)
      if (new Set(drafts.map((item) => item.requestId)).size !== drafts.length ||
        new Set(drafts.map((item) => item.input.integrationId)).size !== drafts.length) invalid()
      return drafts
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }
  const write = async (drafts: readonly PersistedDraft[]): Promise<void> => {
    if (drafts.some((draft) => Buffer.byteLength(JSON.stringify(draft), 'utf8') > 16 * 1024)) invalid()
    await mkdir(dirname(path), { recursive: true })
    const temporary = `${path}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(drafts)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await rename(temporary, path)
  }
  const mutate = async (change: (drafts: PersistedDraft[]) => PersistedDraft): Promise<PersistedDraft> => {
    const pending = queue.then(async () => {
      const drafts = await read()
      const result = change(drafts)
      await write(drafts)
      return result
    })
    queue = pending.then(() => {}, () => {})
    return pending
  }
  const display = async (items: readonly PersistedDraft[]): Promise<DataSourceOnboardingDraft[]> => {
    const views = await options.integrations?.listIntegrations() ?? []
    return items.map((item) => {
      if (item.status === 'draft') return item
      const view = views.find((entry) => entry.integration.integrationId === item.input.integrationId)
      if (!view) return item
      return { ...item, status: complete(item.input) && allTestsPassed(view) ? 'verified' : 'adapter_available' }
    })
  }
  const one = async (item: PersistedDraft): Promise<DataSourceOnboardingDraft> => (await display([item]))[0]!
  return {
    async list() { await queue; return display(await read()) },
    async create(input) {
      const safe = validateInput(input)
      const item = await mutate((drafts) => {
        if (drafts.some((draft) => draft.input.integrationId === safe.integrationId)) invalid()
        const now = new Date().toISOString()
        const created: PersistedDraft = { requestId: randomUUID(), input: safe, status: 'draft', createdAt: now, updatedAt: now }
        drafts.push(created)
        return created
      })
      return one(item)
    },
    async update(requestId, input) {
      const safe = validateInput(input)
      const item = await mutate((drafts) => {
        const index = drafts.findIndex((draft) => draft.requestId === requestId)
        if (index < 0 || drafts[index]!.status !== 'draft' ||
          drafts.some((draft) => draft.requestId !== requestId && draft.input.integrationId === safe.integrationId)) invalid()
        const updated = { ...drafts[index]!, input: safe, updatedAt: new Date().toISOString() }
        drafts[index] = updated
        return updated
      })
      return one(item)
    },
    async markReady(requestId) {
      const item = await mutate((drafts) => {
        const index = drafts.findIndex((draft) => draft.requestId === requestId)
        if (index < 0 || drafts[index]!.status !== 'draft' || !complete(drafts[index]!.input)) invalid()
        const updated: PersistedDraft = { ...drafts[index]!, status: 'ready_for_adapter', updatedAt: new Date().toISOString() }
        drafts[index] = updated
        return updated
      })
      return one(item)
    },
  }
}
