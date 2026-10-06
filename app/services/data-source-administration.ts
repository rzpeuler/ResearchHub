import type {
  DataSourceAdministrationService, DataSourceIntegrationDefinition, DataSourceIntegrationView,
  DataSourceTestErrorCode, DataSourceTestKind, DataSourceTestSummary, SourceCredentialStore,
} from './data-source-administration-contracts.ts'
import type { DataSourceTestStore } from './data-source-test-store.ts'

export interface DataSourceAdministrationOptions {
  readonly definitions: readonly DataSourceIntegrationDefinition[]
  readonly credentials: SourceCredentialStore
  readonly tests: DataSourceTestStore
  readonly policySourceIds?: readonly string[]
}

export class DataSourceAdministrationError extends Error {
  constructor(readonly code: 'unknown_integration' | 'unsupported_test' | 'invalid_credentials') {
    super(code)
  }
}

function errorCode(error: unknown): DataSourceTestErrorCode {
  const record = error && typeof error === 'object' ? error as { code?: unknown; status?: unknown; statusCode?: unknown; name?: unknown } : {}
  const explicit = String(record.code ?? '')
  const status = Number(record.status ?? record.statusCode)
  if (/missing.?config|not.?configured/i.test(explicit)) return 'missing_configuration'
  if (status === 429 || /rate.?limit|too_many_requests/i.test(explicit)) return 'rate_limited'
  if (status === 401 || /auth|unauthoriz|invalid.?key|invalid.?token/i.test(explicit)) return 'authentication_failed'
  if (status === 403 || /access.?denied|forbidden|permission/i.test(explicit)) return 'access_denied'
  if (/no.?data|empty|not.?found/i.test(explicit)) return 'no_data'
  if (/contract|schema|malformed|invalid.?response/i.test(explicit)) return 'contract_mismatch'
  if (/timeout|timed.?out/i.test(explicit) || record.name === 'TimeoutError') return 'timeout'
  const message = error instanceof Error ? error.message : ''
  if (/missing.?config|not.?configured/i.test(message)) return 'missing_configuration'
  if (/\b429\b|rate.?limit/i.test(message)) return 'rate_limited'
  if (/\b401\b|unauthoriz|authentication/i.test(message)) return 'authentication_failed'
  if (/\b403\b|forbidden|access.?denied/i.test(message)) return 'access_denied'
  if (/no.?data|empty response/i.test(message)) return 'no_data'
  if (/contract|schema|malformed/i.test(message)) return 'contract_mismatch'
  if (/timeout|timed.?out/i.test(message)) return 'timeout'
  return 'provider_failed'
}

export function createDataSourceAdministrationService(options: DataSourceAdministrationOptions): DataSourceAdministrationService {
  const definitions = new Map<string, DataSourceIntegrationDefinition>()
  for (const definition of options.definitions) {
    const id = definition.descriptor.integrationId
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id) || definitions.has(id) ||
      !Number.isSafeInteger(definition.testTimeoutMs) || definition.testTimeoutMs <= 0) {
      throw new Error('Invalid data source integration definition')
    }
    definitions.set(id, definition)
  }
  const policySourceIds = new Set(options.policySourceIds ?? [])
  const requireDefinition = (id: string): DataSourceIntegrationDefinition => {
    const definition = definitions.get(id)
    if (!definition) throw new DataSourceAdministrationError('unknown_integration')
    return definition
  }

  return {
    async listIntegrations(): Promise<readonly DataSourceIntegrationView[]> {
      return Promise.all([...definitions.values()].map(async ({ descriptor }) => {
        let credentialState: DataSourceIntegrationView['credentialState'] = 'not_required'
        if (descriptor.credentialFields.length > 0) {
          try { credentialState = await options.credentials.has(descriptor.integrationId) ? 'configured' : 'missing' }
          catch { credentialState = 'vault_unavailable' }
        }
        return {
          integration: descriptor, credentialState,
          policyLinked: descriptor.sourceIds.some((id) => policySourceIds.has(id)),
          latestTests: await options.tests.list(descriptor.integrationId),
        }
      }))
    },
    async saveCredentials(integrationId, values): Promise<void> {
      const fields = requireDefinition(integrationId).descriptor.credentialFields
      if (!values || typeof values !== 'object' || Array.isArray(values) ||
        Object.keys(values).some((key) => !fields.some((field) => field.id === key) || typeof values[key] !== 'string' || !values[key].trim()) ||
        fields.some((field) => field.required && !values[field.id])) {
        throw new DataSourceAdministrationError('invalid_credentials')
      }
      await options.credentials.write(integrationId, values)
    },
    async removeCredentials(integrationId): Promise<void> {
      requireDefinition(integrationId)
      await options.credentials.delete(integrationId)
    },
    async runTest(input, signal): Promise<DataSourceTestSummary> {
      const definition = requireDefinition(input.integrationId)
      let callback: ((signal: AbortSignal) => Promise<void>) | undefined
      if (input.kind === 'connection' && input.capabilityId === undefined && definition.descriptor.supportedTests.connection) callback = definition.testConnection
      if (input.kind === 'capability_sample' && input.capabilityId &&
        definition.descriptor.supportedTests.capabilitySamples.includes(input.capabilityId) &&
        definition.capabilitySamples && Object.hasOwn(definition.capabilitySamples, input.capabilityId)) {
        callback = definition.capabilitySamples[input.capabilityId]
      }
      if (!callback) throw new DataSourceAdministrationError('unsupported_test')

      const startedAt = new Date().toISOString()
      const result = (status: DataSourceTestSummary['status'], code?: DataSourceTestErrorCode): DataSourceTestSummary => ({
        integrationId: input.integrationId, kind: input.kind as DataSourceTestKind,
        ...(input.capabilityId === undefined ? {} : { capabilityId: input.capabilityId }),
        status, startedAt, completedAt: new Date().toISOString(),
        ...(code === undefined ? {} : { errorCode: code }),
      })
      const controller = new AbortController()
      let endedBy: 'caller' | 'timeout' | undefined
      const abortFromCaller = () => { if (!controller.signal.aborted) { endedBy = 'caller'; controller.abort() } }
      if (signal?.aborted) abortFromCaller()
      else signal?.addEventListener('abort', abortFromCaller, { once: true })
      const timeout = setTimeout(() => { if (!controller.signal.aborted) { endedBy = 'timeout'; controller.abort() } }, definition.testTimeoutMs)
      try {
        const aborted = new Promise<never>((_, reject) => {
          if (controller.signal.aborted) reject(new Error('aborted'))
          else controller.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        })
        const operation = controller.signal.aborted ? aborted : Promise.resolve().then(() => callback(controller.signal))
        await Promise.race([operation, aborted])
        const summary = result('passed')
        await options.tests.put(summary)
        return summary
      } catch (error) {
        const summary = endedBy === 'caller' ? result('cancelled') : result('failed', endedBy === 'timeout' ? 'timeout' : errorCode(error))
        await options.tests.put(summary)
        return summary
      } finally {
        clearTimeout(timeout)
        signal?.removeEventListener('abort', abortFromCaller)
      }
    },
  }
}
