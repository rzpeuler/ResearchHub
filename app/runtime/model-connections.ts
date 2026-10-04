import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Api, AuthInteraction, AuthType } from '@earendil-works/pi-ai'
import type { ModelRuntime } from '@earendil-works/pi-coding-agent'

const CONNECTIONS_FILENAME = 'model-connections.json'
const MAX_CONNECTIONS_BYTES = 128 * 1024
const SUPPORTED_COMPATIBLE_APIS = new Set<Api>([
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
  'google-generative-ai',
  'mistral-conversations',
])
const SAFE_IDENTIFIER = /^[a-z][a-z0-9-]{0,62}$/u
const SAFE_SOURCES = new Set(['stored', 'runtime', 'environment', 'fallback', 'models_json_key', 'models_json_command'])

/** Persisted custom endpoint definition. Credentials are deliberately excluded. */
export interface ModelConnectionDefinition {
  readonly name: string
  readonly providerId: string
  readonly api: Api
  readonly baseUrl: string
  readonly modelId: string
  readonly modelName: string
  readonly contextWindow: number
  readonly maxTokens: number
}

export interface ModelConnectionInput extends ModelConnectionDefinition {}

export interface SafeModelProviderStatus {
  readonly providerId: string
  readonly name: string
  readonly configured: boolean
  readonly source?: 'stored' | 'runtime' | 'environment' | 'fallback' | 'models_json_key' | 'models_json_command'
  readonly supportsApiKey: boolean
  readonly supportsOAuth: boolean
  readonly appManaged?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateIdentifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !SAFE_IDENTIFIER.test(value)) throw new Error(`${label} must start with a lowercase letter and contain only lowercase letters, digits, and hyphens`)
}

function validateModelIdentifier(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) throw new Error('Model ID must be 1 to 128 letters, digits, periods, underscores, colons, or hyphens')
}

function validateDefinition(value: unknown): ModelConnectionDefinition {
  if (!isRecord(value)) throw new Error('Model connection must be an object')
  const allowedKeys = ['name', 'providerId', 'api', 'baseUrl', 'modelId', 'modelName', 'contextWindow', 'maxTokens']
  if (Object.keys(value).some((key) => !allowedKeys.includes(key))) throw new Error('Model connection contains unsupported fields')
  const { name, providerId, api, baseUrl, modelId, modelName, contextWindow, maxTokens } = value
  if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 80) throw new Error('Model connection name must be 1 to 80 characters')
  validateIdentifier(providerId, 'Provider ID')
  validateModelIdentifier(modelId)
  if (typeof modelName !== 'string' || modelName.trim().length < 1 || modelName.trim().length > 120) throw new Error('Model name must be 1 to 120 characters')
  if (typeof api !== 'string' || !SUPPORTED_COMPATIBLE_APIS.has(api)) throw new Error('The selected API protocol is not supported')
  if (typeof contextWindow !== 'number' || !Number.isSafeInteger(contextWindow) || contextWindow < 1 || contextWindow > 10_000_000) throw new Error('Context window must be a positive safe integer')
  if (typeof maxTokens !== 'number' || !Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > contextWindow) throw new Error('Maximum output tokens must be a positive integer no larger than the context window')
  if (typeof baseUrl !== 'string' || baseUrl.length > 2048) throw new Error('Base URL must be a valid HTTPS or loopback HTTP URL')
  let url: URL
  try { url = new URL(baseUrl) } catch { throw new Error('Base URL must be a valid HTTPS or loopback HTTP URL') }
  if (url.username || url.password || url.hash) throw new Error('Base URL cannot contain credentials or a fragment')
  const loopback = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/u.test(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error('Base URL must use HTTPS or loopback HTTP')
  if (!url.hostname || url.origin === 'null') throw new Error('Base URL must include a host')
  return {
    name: name.trim(), providerId, api, baseUrl: url.toString().replace(/\/$/u, ''), modelId,
    modelName: modelName.trim(), contextWindow, maxTokens,
  }
}

function parseDefinitions(value: unknown): readonly ModelConnectionDefinition[] {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.connections) || Object.keys(value).some((key) => !['version', 'connections'].includes(key))) {
    throw new Error('Model connections configuration is invalid')
  }
  const connections = value.connections.map(validateDefinition)
  const providers = new Set<string>()
  for (const connection of connections) {
    if (providers.has(connection.providerId)) throw new Error('Model connections contain a duplicate provider ID')
    providers.add(connection.providerId)
  }
  return connections
}

function configPath(cwd: string): string { return join(cwd, 'runtime-data', CONNECTIONS_FILENAME) }

/** Loads only app-owned non-secret connection definitions. */
export async function loadModelConnections(cwd: string): Promise<readonly ModelConnectionDefinition[]> {
  try {
    const text = await readFile(configPath(cwd), 'utf8')
    if (Buffer.byteLength(text, 'utf8') > MAX_CONNECTIONS_BYTES) throw new Error('Model connections configuration is oversized')
    let parsed: unknown
    try { parsed = JSON.parse(text) as unknown } catch { throw new Error('Model connections configuration is invalid JSON') }
    return parseDefinitions(parsed)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    if (error instanceof Error && /^(?:Model |Provider |Context |Maximum |Base URL |The selected )/u.test(error.message)) throw error
    throw new Error('Model connections could not be loaded')
  }
}

/** Validates then atomically adds a keyless custom provider definition. */
export async function saveModelConnection(cwd: string, input: ModelConnectionInput, existingProviderIds: readonly string[] = []): Promise<readonly ModelConnectionDefinition[]> {
  const connection = validateDefinition(input)
  if (existingProviderIds.includes(connection.providerId)) throw new Error('A Pi provider with this ID already exists')
  const current = await loadModelConnections(cwd)
  if (current.some((existing) => existing.providerId === connection.providerId)) throw new Error('A model connection with this provider ID already exists')
  const next = [...current, connection]
  const directory = join(cwd, 'runtime-data')
  const path = configPath(cwd)
  const temporary = `${path}.${randomUUID()}.tmp`
  await mkdir(directory, { recursive: true })
  try {
    await writeFile(temporary, `${JSON.stringify({ version: 1, connections: next }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await rename(temporary, path)
  } catch {
    await unlink(temporary).catch(() => undefined)
    throw new Error('Model connection could not be saved')
  }
  return next
}

/** Adds a connection to a live Pi runtime and persists it; failed persistence rolls back registration. */
export async function addModelConnection(runtime: ModelRuntime, cwd: string, input: ModelConnectionInput): Promise<void> {
  const connection = validateDefinition(input)
  const existingProviderIds = runtime.getProviders().map(({ id }) => id)
  if (existingProviderIds.includes(connection.providerId)) throw new Error('A Pi provider with this ID already exists')
  runtime.registerProvider(connection.providerId, {
    name: connection.name,
    baseUrl: connection.baseUrl,
    api: connection.api,
    models: [{
      id: connection.modelId,
      name: connection.modelName,
      api: connection.api,
      baseUrl: connection.baseUrl,
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: connection.contextWindow,
      maxTokens: connection.maxTokens,
    }],
  })
  try {
    await saveModelConnection(cwd, connection, existingProviderIds)
  } catch (error) {
    runtime.unregisterProvider(connection.providerId)
    throw error
  }
}

/** Registers app-owned definitions into Pi; registration itself performs no network calls. */
export async function registerModelConnections(runtime: ModelRuntime, cwd: string): Promise<void> {
  const definitions = await loadModelConnections(cwd)
  for (const connection of definitions) {
    if (runtime.getProvider(connection.providerId) !== undefined) throw new Error('A Pi provider with this ID already exists')
    runtime.registerProvider(connection.providerId, {
      name: connection.name,
      baseUrl: connection.baseUrl,
      api: connection.api,
      models: [{
        id: connection.modelId,
        name: connection.modelName,
        api: connection.api,
        baseUrl: connection.baseUrl,
        reasoning: false,
        input: ['text'],
        // Pi requires cost metadata; zero denotes unspecified for this locally supplied model.
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: connection.contextWindow,
        maxTokens: connection.maxTokens,
      }],
    })
  }
}

/** Returns provider identity, auth presence/source, and available auth paths only. */
export function listSafeModelConnectionStatus(runtime: ModelRuntime, appManagedProviderIds: ReadonlySet<string> = new Set()): readonly SafeModelProviderStatus[] {
  return runtime.getProviders().map((provider) => {
    const status = runtime.getProviderAuthStatus(provider.id)
    const source = status.source !== undefined && SAFE_SOURCES.has(status.source)
      ? status.source as SafeModelProviderStatus['source']
      : undefined
    return {
      providerId: provider.id,
      name: provider.name,
      configured: status.configured,
      ...(source === undefined ? {} : { source }),
      supportsApiKey: 'apiKey' in provider.auth,
      supportsOAuth: 'oauth' in provider.auth,
      ...(appManagedProviderIds.has(provider.id) ? { appManaged: true } : {}),
    }
  }).sort((left, right) => left.name.localeCompare(right.name) || left.providerId.localeCompare(right.providerId))
}

/** Stores a provider API key through Pi's auth store without returning or persisting it here. */
export async function saveModelProviderApiKey(runtime: ModelRuntime, providerId: string, apiKey: string): Promise<void> {
  if (!SAFE_IDENTIFIER.test(providerId) || typeof apiKey !== 'string' || apiKey.trim().length === 0 || apiKey.length > 16_384 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(apiKey)) {
    throw new Error('A valid provider ID and API key are required')
  }
  const provider = runtime.getProvider(providerId)
  if (!provider || !('apiKey' in provider.auth)) throw new Error('This provider does not support API key authentication')
  const interaction: AuthInteraction = {
    prompt: async (prompt) => {
      if (prompt.type !== 'secret') throw new Error('Pi requested an unsupported API-key login input')
      return apiKey
    },
    notify: () => undefined,
  }
  try { await runtime.login(providerId, 'api_key', interaction) } catch { throw new Error('Pi could not save provider authentication') }
}

/** Thin typed bridge for an explicitly managed Pi OAuth/device login session. */
export async function loginModelProvider(runtime: ModelRuntime, providerId: string, type: AuthType, interaction: AuthInteraction): Promise<void> {
  if (!SAFE_IDENTIFIER.test(providerId) || type !== 'oauth') throw new Error('This login path supports Pi provider OAuth only')
  const provider = runtime.getProvider(providerId)
  if (!provider || !('oauth' in provider.auth)) throw new Error('This provider does not support Pi OAuth')
  try { await runtime.login(providerId, type, interaction) } catch { throw new Error('Pi provider login failed or was cancelled') }
}
