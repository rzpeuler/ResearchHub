export type DataSourceTestKind = 'connection' | 'capability_sample'
export type DataSourceTestStatus = 'passed' | 'failed' | 'cancelled' | 'unsupported'
export type DataSourceTestErrorCode =
  | 'missing_configuration' | 'authentication_failed' | 'timeout' | 'rate_limited'
  | 'access_denied' | 'no_data' | 'contract_mismatch' | 'provider_failed'

export interface DataSourceTestSummary {
  readonly integrationId: string
  readonly kind: DataSourceTestKind
  readonly capabilityId?: string
  readonly status: DataSourceTestStatus
  readonly startedAt: string
  readonly completedAt: string
  readonly errorCode?: DataSourceTestErrorCode
}

export interface DataSourceIntegrationDescriptor {
  readonly integrationId: string
  readonly displayName: string
  readonly sourceIds: readonly string[]
  readonly credentialFields: readonly { readonly id: string; readonly label: string; readonly required: boolean }[]
  readonly capabilities: readonly { readonly id: string; readonly label: string; readonly metricIds: readonly string[] }[]
  readonly supportedTests: { readonly connection: boolean; readonly capabilitySamples: readonly string[] }
}

export interface DataSourceIntegrationDefinition {
  readonly descriptor: DataSourceIntegrationDescriptor
  readonly testTimeoutMs: number
  readonly testConnection?: (signal: AbortSignal, credentials: Readonly<Record<string, string>>) => Promise<void>
  readonly capabilitySamples?: Readonly<Record<string, (signal: AbortSignal, credentials: Readonly<Record<string, string>>) => Promise<void>>>
}

export interface DataSourceIntegrationView {
  readonly integration: DataSourceIntegrationDescriptor
  readonly credentialState: 'not_required' | 'missing' | 'configured' | 'vault_unavailable'
  readonly policyLinked: boolean
  readonly latestTests: readonly DataSourceTestSummary[]
}

export interface SourceCredentialStore {
  read(integrationId: string): Promise<Readonly<Record<string, string>> | undefined>
  write(integrationId: string, values: Readonly<Record<string, string>>): Promise<void>
  has(integrationId: string): Promise<boolean>
  delete(integrationId: string): Promise<void>
}

export interface DataSourceAdministrationService {
  listIntegrations(): Promise<readonly DataSourceIntegrationView[]>
  saveCredentials(integrationId: string, values: Readonly<Record<string, string>>): Promise<void>
  removeCredentials(integrationId: string): Promise<void>
  runTest(input: { readonly integrationId: string; readonly kind: DataSourceTestKind; readonly capabilityId?: string }, signal?: AbortSignal): Promise<DataSourceTestSummary>
}
