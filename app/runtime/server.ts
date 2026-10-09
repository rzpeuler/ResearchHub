import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { pipeline } from 'node:stream/promises'
import { createReadStream } from 'node:fs'
import { lstat, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { ApplicationServiceError, type EarningsReviewInput, type EventAnchor, type EventResearchInput, type IndustryResearchInput, type IngestDocumentInput, type KnowledgeGraphProjectionInput, type KnowledgeSearchInput, type ReviewCaseListInput, type ResearchCompanyInput, type ThesisRedTeamInput, type ValuationInput, type ValuationMethod, type RawDocumentPreviewV04Input } from '../services/contracts.ts'
import type { DailyBriefType } from '../../plugins/daily-intelligence/contracts.ts'
import { createResearchHubApplicationRuntime, ResearchHubApplicationRuntime } from './application-runtime.ts'
import { AttachmentService, DEFAULT_MAX_ATTACHMENT_BYTES } from './attachment-service.ts'
import { ClientEventStream } from './event-stream.ts'
import { RuntimeSecurity, RuntimeSecurityError, assertLoopbackBindAddress, type LoopbackBindAddress } from './security.ts'
import type { CurrentSessionState, ResearchHubApplicationRuntimeOptions } from './contracts.ts'
import { safeIdentifier, safeSummary, type ClientEvent } from './client-events.ts'
import type { ResearchDispatchService } from '../services/research-dispatch-service.ts'
import { KnowledgeBaseRegistry } from '../../knowledge/registry/registry.ts'
import { THEME_SCOPE_V04_LIMITS } from '../../knowledge/governance/theme-scope-v04.ts'
import { normalizeResearchRequest } from '../services/research-dispatch-contracts.ts'
import type { ResearchHubRequestPolicy } from '../pi/tools.ts'
import type { ReasoningCapabilities, ReasoningExecutor } from '../../plugins/reasoning/contracts.ts'
import type { ThesisCriterionConfirmInput, ThesisCriterionPrepareInput, ThesisCriterionPreview } from '../services/thesis-criterion-service.ts'
import type { KnowledgeTopicFilters, KnowledgeTopicKind, KnowledgeTopicPageInput, KnowledgeTopicScope } from '../services/knowledge-topic-contracts.ts'
import { configuredKnowledgeBaseCatalogRoot, discoverKnowledgeBases, requireKnowledgeBaseChoice, resolveInitialKnowledgeBase, type ResolvedKnowledgeBase } from './knowledge-selection.ts'
import { readRuntimeSettings, writeRuntimeSettings, type RuntimeSettings } from './runtime-settings.ts'
import { ModelLoginFlowManager } from './model-login-flow.ts'
import { addModelConnection, listSafeModelConnectionStatus, loadModelConnections, saveModelProviderApiKey } from './model-connections.ts'
import { addRegisteredKnowledgeBase, listRegisteredKnowledgeBases, removeRegisteredKnowledgeBase, validateKnowledgeBaseDirectory, type RegisteredKnowledgeBase } from './knowledge-registration.ts'
import { getDataSourceCatalog } from '../services/data-source-catalog.ts'
import { projectCommonDataCatalog, projectIndustryDataCatalog } from '../services/data-catalog-projection.ts'
import { DataSourceAdministrationError } from '../services/data-source-administration.ts'
import type { DataSourceOnboardingDraftInput } from '../services/data-source-onboarding-store.ts'
import { COMMON_DATA_CATALOG } from '../../data/common-catalog.ts'
import { INDUSTRY_IDENTITIES } from '../../data/industry-catalog.ts'
import { INDUSTRY_DATA_SOURCE_POLICIES } from '../../data/industry-policies.ts'
import { PHASE2_COMMON_SOURCE_POLICIES } from '../../data/valuation-earnings-policies.ts'
import { PHASE3_COMMON_SOURCE_POLICIES } from '../../data/company-research-policies.ts'
import { listReasoningModelCandidates, ReasoningModelSelectionError, validateReasoningModelSelection } from '../pi/model-selection.ts'
import type { ThemeWorkspaceProjectionInput } from '../services/theme-workspace-projection-contracts.ts'
import type { RawDocumentMetadataV04, RawDocumentRightsV04 } from '../../knowledge/production/raw-document-gateway-v04.ts'

const MAX_JSON_BYTES = 1_000_000
const MAX_MESSAGE_LENGTH = 50_000
const MAX_SESSION_NAME_LENGTH = 200
const TOKEN_HEADER = 'x-researchhub-runtime-token'
const MAX_SSE_PENDING_FRAMES = 64
const MAX_BACKGROUND_OPERATIONS = 128
const CLIENT_MIME_TYPES: Readonly<Record<string, string>> = { '.css': 'text/css; charset=utf-8', '.gif': 'image/gif', '.html': 'text/html; charset=utf-8', '.ico': 'image/x-icon', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2' }
const THESIS_CRITERION_PREVIEW_FIELDS = ['knowledgeBaseId', 'expectedKnowledgeBaseRevision', 'thesisRef', 'conditionId', 'revision', 'type', 'definitionVersion', 'definition', 'targetClaimRefs', 'origin', 'definitionHash', 'previewHash'] as const
const DISABLED_MODEL_CAPABILITIES: ReasoningCapabilities = { maxContextTokens: 1, maxOutputTokens: 1, structuredOutputSupport: false, maxConcurrency: 1 }

function disabledModelExecutor(): ReasoningExecutor {
  return { capabilities: () => DISABLED_MODEL_CAPABILITIES, async execute() { throw new ApplicationServiceError('conflict', 'The saved Pi model is unavailable. Select an available model before running semantic operations.') } }
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function assertExactFields(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = [], label: string): void {
  const allowed = new Set([...required, ...optional])
  if (required.some((key) => !Object.prototype.hasOwnProperty.call(value, key)) || Object.keys(value).some((key) => !allowed.has(key))) throw new ApplicationServiceError('invalid_input', `${label} contains missing or unsupported fields`)
}
function validateCriterionDefinition(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new ApplicationServiceError('invalid_input', 'definition must be an object')
  assertExactFields(value, ['metricRef', 'operator', 'threshold', 'unit', 'period'], [], 'definition')
  if (typeof value.metricRef !== 'string' || !value.metricRef.trim() || value.metricRef.length > 256 || !['eq', 'gt', 'gte', 'lt', 'lte'].includes(String(value.operator)) || typeof value.threshold !== 'number' || !Number.isFinite(value.threshold) || typeof value.unit !== 'string' || !value.unit.trim() || value.unit.length > 128 || typeof value.period !== 'string' || !value.period.trim() || value.period.length > 256) throw new ApplicationServiceError('invalid_input', 'definition has invalid or oversized fields')
  return value
}
function validateCriterionOrigin(value: unknown): Record<string, unknown> {
  if (!isRecord(value) || typeof value.kind !== 'string') throw new ApplicationServiceError('invalid_input', 'origin must be an object with a supported kind')
  if (value.kind === 'human_rule') { assertExactFields(value, ['kind'], [], 'origin'); return value }
  if (value.kind === 'source_derived') {
    assertExactFields(value, ['kind', 'sourceRef', 'rawRef', 'locator', 'publishedAt'], [], 'origin')
    if (typeof value.sourceRef !== 'string' || value.sourceRef.length > 300 || typeof value.rawRef !== 'string' || value.rawRef.length > 100 || typeof value.locator !== 'string' || !value.locator.trim() || value.locator.length > 2048 || typeof value.publishedAt !== 'string' || value.publishedAt.length > 128) throw new ApplicationServiceError('invalid_input', 'source-derived origin has invalid or oversized fields')
    return value
  }
  throw new ApplicationServiceError('invalid_input', 'origin kind is unsupported')
}
function validateCriterionTargets(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32 || value.some((ref) => typeof ref !== 'string' || ref.length > 300 || !ref.trim())) throw new ApplicationServiceError('invalid_input', 'targetClaimRefs must contain 1 to 32 bounded Claim refs')
  return value as string[]
}
function validateCriterionPrepareBody(value: Record<string, unknown>): ThesisCriterionPrepareInput {
  assertExactFields(value, ['thesisRef', 'conditionId', 'definition', 'targetClaimRefs', 'origin'], ['type', 'definitionVersion'], 'criterion prepare request')
  if (typeof value.thesisRef !== 'string' || value.thesisRef.length > 300 || typeof value.conditionId !== 'string' || value.conditionId.length > 128 || (value.type !== undefined && (typeof value.type !== 'string' || value.type.length > 64)) || (value.definitionVersion !== undefined && (typeof value.definitionVersion !== 'number' || !Number.isSafeInteger(value.definitionVersion)))) throw new ApplicationServiceError('invalid_input', 'criterion prepare identity is invalid or oversized')
  return { thesisRef: value.thesisRef, conditionId: value.conditionId, ...(value.type === undefined ? {} : { type: value.type as string }), ...(value.definitionVersion === undefined ? {} : { definitionVersion: value.definitionVersion as number }), definition: validateCriterionDefinition(value.definition), targetClaimRefs: validateCriterionTargets(value.targetClaimRefs), origin: validateCriterionOrigin(value.origin) }
}
function validateCriterionPreview(value: unknown): ThesisCriterionPreview {
  if (!isRecord(value)) throw new ApplicationServiceError('invalid_input', 'preview must be an object')
  assertExactFields(value, THESIS_CRITERION_PREVIEW_FIELDS, [], 'criterion preview')
  if (typeof value.knowledgeBaseId !== 'string' || !value.knowledgeBaseId || value.knowledgeBaseId.length > 256 || typeof value.expectedKnowledgeBaseRevision !== 'number' || !Number.isSafeInteger(value.expectedKnowledgeBaseRevision) || value.expectedKnowledgeBaseRevision < 0 || typeof value.thesisRef !== 'string' || value.thesisRef.length > 300 || typeof value.conditionId !== 'string' || value.conditionId.length > 128 || typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision) || value.revision < 1 || value.type !== 'numeric_threshold' || value.definitionVersion !== 1 || typeof value.definitionHash !== 'string' || value.definitionHash.length > 256 || typeof value.previewHash !== 'string' || value.previewHash.length > 256) throw new ApplicationServiceError('invalid_input', 'criterion preview metadata is invalid or oversized')
  const definition = validateCriterionDefinition(value.definition)
  const targetClaimRefs = validateCriterionTargets(value.targetClaimRefs)
  const origin = validateCriterionOrigin(value.origin)
  return { knowledgeBaseId: value.knowledgeBaseId, expectedKnowledgeBaseRevision: value.expectedKnowledgeBaseRevision, thesisRef: value.thesisRef, conditionId: value.conditionId, revision: value.revision, type: 'numeric_threshold', definitionVersion: 1, definition: definition as unknown as ThesisCriterionPreview['definition'], targetClaimRefs, origin: origin as unknown as ThesisCriterionPreview['origin'], definitionHash: value.definitionHash, previewHash: value.previewHash }
}
function validateCriterionConfirmBody(value: Record<string, unknown>): ThesisCriterionConfirmInput {
  assertExactFields(value, ['preview', 'previewHash', 'expectedKnowledgeBaseRevision', 'workflowRunId'], [], 'criterion confirm request')
  if (typeof value.previewHash !== 'string' || value.previewHash.length > 256 || typeof value.expectedKnowledgeBaseRevision !== 'number' || !Number.isSafeInteger(value.expectedKnowledgeBaseRevision) || value.expectedKnowledgeBaseRevision < 0 || typeof value.workflowRunId !== 'string' || value.workflowRunId.length > 128) throw new ApplicationServiceError('invalid_input', 'criterion confirmation metadata is invalid or oversized')
  return { preview: validateCriterionPreview(value.preview), previewHash: value.previewHash, expectedKnowledgeBaseRevision: value.expectedKnowledgeBaseRevision, workflowRunId: value.workflowRunId }
}

export interface ResearchHubRuntimeServerOptions extends Omit<ResearchHubApplicationRuntimeOptions, 'cwd'> {
  readonly cwd?: string
  readonly runtime?: ResearchHubApplicationRuntime
  readonly bindAddress?: string
  readonly port?: number
  readonly clientRoot?: string
  readonly attachmentService?: AttachmentService
  readonly maxSseSubscribers?: number
  readonly knowledgeBaseCatalogRoot?: string
  /** Allows deterministic tests to disable the automatic scheduler. */
  readonly startDailyScheduler?: boolean
}

export interface RuntimeServerInfo {
  readonly bindAddress: LoopbackBindAddress
  readonly port: number
  readonly origin: string
  readonly runtimeToken: string
}

interface SseClient {
  readonly response: ServerResponse
  unsubscribe: () => void
  heartbeat?: ReturnType<typeof setInterval>
  onClose: () => void
  onDrain: () => void
  readonly pendingFrames: string[]
  waitingForDrain: boolean
}
type RuntimeServerLifecycle = 'idle' | 'starting' | 'running' | 'closing' | 'closed'
interface BackgroundOperation { readonly completion: Promise<void>; readonly cancel: () => void | Promise<void> }

function httpStatus(code: string): number {
  if (code === 'invalid_input') return 400
  if (code === 'unauthorized_runtime_token') return 401
  if (code === 'not_found') return 404
  if (code === 'no_kb_mounted') return 503
  if (code === 'credential_store_unavailable') return 503
  if (code === 'unsupported_test') return 422
  if (code === 'conflict' || code === 'cancelled') return 409
  return 500
}

function errorCode(error: unknown): string {
  if (error instanceof ApplicationServiceError) return error.code
  if (error instanceof RuntimeSecurityError) return 'unauthorized_runtime_token'
  return 'failed'
}

function safeError(error: unknown): { readonly code: string; readonly error: string } {
  if (error instanceof DataSourceRouteError) return { code: error.code, error: error.message }
  const code = errorCode(error)
  if (code === 'unauthorized_runtime_token') return { code, error: 'Runtime request authorization failed' }
  if (error instanceof ApplicationServiceError) return { code, error: safeSummary(error.message, 300) || 'Application operation failed' }
  if (code === 'not_found') return { code, error: 'Resource not found' }
  return { code, error: 'ResearchHub runtime operation failed' }
}

class DataSourceRouteError extends Error {
  constructor(readonly code: 'unsupported_test' | 'credential_store_unavailable', message: string) { super(message) }
}

const DATA_SOURCE_DRAFT_FIELDS = ['integrationId', 'displayName', 'documentationUrl', 'accessMode', 'publisher', 'proposedAuthority', 'capabilityIds', 'metricIds', 'authenticationMode', 'termsUrl', 'rightsNotes', 'rateLimitNotes', 'timeBoundaryNotes', 'providerTermsReviewed'] as const

function onboardingInput(value: unknown): DataSourceOnboardingDraftInput {
  if (!isRecord(value)) throw new ApplicationServiceError('invalid_input', 'Data source draft input is invalid')
  assertExactFields(value, DATA_SOURCE_DRAFT_FIELDS.filter((field) => field !== 'termsUrl'), ['termsUrl'], 'data source draft')
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 16 * 1024) throw new ApplicationServiceError('invalid_input', 'Data source draft input is too large')
  return value as unknown as DataSourceOnboardingDraftInput
}

function safeIntegrationView(value: Awaited<ReturnType<NonNullable<ResearchHubApplicationRuntime['services']['dataSourceAdministrationService']>['listIntegrations']>>[number]) {
  const integration = value.integration
  return {
    integration: {
      integrationId: integration.integrationId, displayName: integration.displayName,
      sourceIds: [...integration.sourceIds],
      credentialFields: integration.credentialFields.map(({ id, label, required }) => ({ id, label, required })),
      capabilities: integration.capabilities.map(({ id, label, metricIds }) => ({ id, label, metricIds: [...metricIds] })),
      supportedTests: { connection: integration.supportedTests.connection, capabilitySamples: [...integration.supportedTests.capabilitySamples] },
    },
    credentialState: value.credentialState, policyLinked: value.policyLinked,
    latestTests: value.latestTests.map((summary) => ({ integrationId: summary.integrationId, kind: summary.kind, ...(summary.capabilityId === undefined ? {} : { capabilityId: summary.capabilityId }), status: summary.status, startedAt: summary.startedAt, completedAt: summary.completedAt, ...(summary.errorCode === undefined ? {} : { errorCode: summary.errorCode }) })),
  }
}

function safeOnboardingDraft(value: Awaited<ReturnType<NonNullable<ResearchHubApplicationRuntime['services']['dataSourceOnboardingService']>['list']>>[number]) {
  return { requestId: value.requestId, input: value.input, status: value.status, createdAt: value.createdAt, updatedAt: value.updatedAt }
}

function combineErrors(errors: readonly unknown[], message: string): unknown {
  if (errors.length === 1) return errors[0]
  return new AggregateError(errors, message)
}

function originFor(bindAddress: LoopbackBindAddress, port: number): string { return `http://${bindAddress === '::1' ? `[${bindAddress}]` : bindAddress}:${port}` }

function positiveInteger(value: string | null): number | undefined {
  if (value === null) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : Number.NaN
}

function decodeSegment(value: string): string {
  try { return decodeURIComponent(value) } catch { throw new ApplicationServiceError('invalid_input', 'URL path segment is invalid') }
}

const TOPIC_QUERY_KEYS = new Set(['depth', 'kind', 'scope', 'limit', 'cursor', 'expectedRevision', 'lifecycle', 'observationType', 'claimType', 'relationType'])
const TOPIC_KINDS = new Set<KnowledgeTopicKind>(['relation', 'claim', 'observation', 'event', 'thesis', 'module', 'source', 'reasoning_edge'])
const THEME_WORKSPACE_QUERY_KEYS = new Set(['expectedRevision', 'asOf', 'maxNodes', 'maxEdges', 'maxItemsPerSection', 'maxCompaniesPerIndustry', 'maxResponseBytes'])

function topicQueryValue(url: URL, name: string, maxLength?: number): string | undefined {
  const values = url.searchParams.getAll(name)
  if (values.length === 0) return undefined
  if (values.length !== 1 || (maxLength !== undefined && values[0]!.length > maxLength)) throw new ApplicationServiceError('invalid_input', `query parameter ${name} is invalid`)
  return values[0]
}

function validateTopicQuery(url: URL, allowed: ReadonlySet<string>): void {
  for (const [key] of url.searchParams) {
    if ((!TOPIC_QUERY_KEYS.has(key) && !THEME_WORKSPACE_QUERY_KEYS.has(key)) || !allowed.has(key)) throw new ApplicationServiceError('invalid_input', 'Topic query contains an unsupported parameter')
    if (url.searchParams.getAll(key).length !== 1) throw new ApplicationServiceError('invalid_input', `query parameter ${key} must appear once`)
  }
}

function topicDepth(url: URL): 1 | 2 | undefined {
  const value = topicQueryValue(url, 'depth')
  if (value === undefined) return undefined
  if (value !== '1' && value !== '2') throw new ApplicationServiceError('invalid_input', 'depth must be 1 or 2')
  return Number(value) as 1 | 2
}

function topicLimit(url: URL): number | undefined {
  const value = topicQueryValue(url, 'limit')
  if (value === undefined) return undefined
  if (!/^[1-9]\d*$/.test(value)) throw new ApplicationServiceError('invalid_input', 'limit must be a positive integer')
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) throw new ApplicationServiceError('invalid_input', 'limit must be a positive integer')
  return parsed
}

function topicExpectedRevision(url: URL): number | undefined {
  const value = topicQueryValue(url, 'expectedRevision')
  if (value === undefined) return undefined
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new ApplicationServiceError('invalid_input', 'expectedRevision must be a non-negative safe integer')
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) throw new ApplicationServiceError('invalid_input', 'expectedRevision must be a non-negative safe integer')
  return parsed
}

function themeWorkspaceRef(value: string, label: string): string {
  if (value.length > 300 || !/^entity:[A-Za-z0-9][A-Za-z0-9._:-]{0,240}$/u.test(value) || value.includes('..')) throw new ApplicationServiceError('invalid_input', `${label} is invalid`)
  return value
}

function themeWorkspaceQuery(url: URL, allowed: ReadonlySet<string>): Omit<ThemeWorkspaceProjectionInput, 'themeRef'> {
  validateTopicQuery(url, allowed)
  const asOf = topicQueryValue(url, 'asOf', 80)
  if (asOf !== undefined && !Number.isFinite(Date.parse(asOf))) throw new ApplicationServiceError('invalid_input', 'asOf must be a parseable timestamp')
  const boundedLimit = (key: string, maximum: number, minimum = 1): number | undefined => {
    const value = topicQueryValue(url, key)
    if (value === undefined) return undefined
    if (!/^[1-9]\d*$/.test(value)) throw new ApplicationServiceError('invalid_input', `${key} must be a positive integer`)
    const parsed = Number(value)
    if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new ApplicationServiceError('invalid_input', `${key} is outside its supported bound`)
    return parsed
  }
  const expectedRevision = topicExpectedRevision(url)
  const maxNodes = boundedLimit('maxNodes', 150)
  const maxEdges = boundedLimit('maxEdges', 300)
  const maxItemsPerSection = boundedLimit('maxItemsPerSection', 100)
  const maxCompaniesPerIndustry = boundedLimit('maxCompaniesPerIndustry', 100)
  const maxResponseBytes = boundedLimit('maxResponseBytes', 2_000_000, 1_024)
  return {
    ...(expectedRevision === undefined ? {} : { expectedRevision }),
    ...(asOf === undefined ? {} : { asOf }),
    ...(maxNodes === undefined ? {} : { maxNodes }),
    ...(maxEdges === undefined ? {} : { maxEdges }),
    ...(maxItemsPerSection === undefined ? {} : { maxItemsPerSection }),
    ...(maxCompaniesPerIndustry === undefined ? {} : { maxCompaniesPerIndustry }),
    ...(maxResponseBytes === undefined ? {} : { maxResponseBytes }),
  }
}

function isInsideStaticRoot(root: string, candidate: string): boolean {
  const child = relative(resolve(root), resolve(candidate))
  return child === '' || (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${'\\'}`) && !child.startsWith(`..${'/'}`))
}

function pathsOverlap(left: string, right: string): boolean { return isInsideStaticRoot(left, right) || isInsideStaticRoot(right, left) }

/** Local Node HTTP/SSE adapter over the shared Application Runtime and Services. */
export class ResearchHubRuntimeServer {
  private readonly options: ResearchHubRuntimeServerOptions
  private readonly clientRoot: string
  private readonly bindAddress: LoopbackBindAddress
  private readonly port: number
  private runtime?: ResearchHubApplicationRuntime
  private ownsRuntime: boolean
  private startPromise?: Promise<RuntimeServerInfo>
  private closePromise?: Promise<void>
  private attachmentService?: AttachmentService
  private httpServer?: Server
  private runtimeSecurity?: RuntimeSecurity
  private runtimeInfo?: RuntimeServerInfo
  private unsubscribeSessionEvents?: () => void
  private readonly eventStream: ClientEventStream
  private readonly sseClients = new Set<SseClient>()
  private readonly backgroundOperations = new Set<BackgroundOperation>()
  private lifecycle: RuntimeServerLifecycle = 'idle'
  private settings: RuntimeSettings = { revision: 0 }
  private knowledgeBaseCatalog: readonly ResolvedKnowledgeBase[] = []
  private knowledgeBaseSelectionError?: string
  private settingsChanging = false
  private inFlightApiRequests = 0
  private modelSelectionError?: string
  private readonly modelLoginFlows = new ModelLoginFlowManager()

  constructor(options: ResearchHubRuntimeServerOptions) {
    this.options = options
    this.clientRoot = resolve(options.clientRoot ?? join(options.cwd ?? process.cwd(), 'dist', 'client'))
    this.bindAddress = assertLoopbackBindAddress(options.bindAddress ?? '127.0.0.1')
    const selectedPort = options.port ?? 0
    if (!Number.isInteger(selectedPort) || selectedPort < 0 || selectedPort > 65_535) throw new ApplicationServiceError('invalid_input', 'port must be an integer between 0 and 65535')
    this.port = selectedPort
    this.runtime = options.runtime
    this.ownsRuntime = options.runtime === undefined
    this.attachmentService = options.attachmentService
    this.eventStream = new ClientEventStream(options.maxSseSubscribers)
  }

  static async create(options: ResearchHubRuntimeServerOptions): Promise<ResearchHubRuntimeServer> {
    const server = new ResearchHubRuntimeServer(options)
    await server.start()
    return server
  }

  get origin(): string | undefined { return this.runtimeInfo?.origin }
  get runtimeToken(): string | undefined { return this.runtimeInfo?.runtimeToken }
  get security(): RuntimeSecurity | undefined { return this.runtimeSecurity }
  get address(): RuntimeServerInfo | undefined { return this.runtimeInfo }
  get applicationRuntime(): ResearchHubApplicationRuntime | undefined { return this.runtime }

  start(): Promise<RuntimeServerInfo> {
    if (this.lifecycle === 'closing') return Promise.reject(new ApplicationServiceError('conflict', 'Runtime server is closing'))
    if (this.lifecycle === 'closed') return Promise.reject(new ApplicationServiceError('failed', 'Runtime server is closed'))
    if (this.runtimeInfo) return Promise.resolve(this.runtimeInfo)
    if (this.startPromise) return this.startPromise
    this.lifecycle = 'starting'
    const startPromise = this.startInternal()
    this.startPromise = startPromise
    void startPromise.then(
      () => {
        if (this.startPromise !== startPromise) return
        this.startPromise = undefined
        if (this.lifecycle === 'starting') this.lifecycle = 'running'
      },
      () => {
        if (this.startPromise !== startPromise) return
        this.startPromise = undefined
        if (this.lifecycle === 'starting') this.lifecycle = 'idle'
      },
    )
    return startPromise
  }

  private async startInternal(): Promise<RuntimeServerInfo> {
    const cwd = this.options.cwd ?? this.runtime?.cwd ?? process.cwd()
    this.settings = await readRuntimeSettings(cwd)
    if (!this.runtime) {
      const workspaceRoot = resolve(this.options.workspaceRoot ?? join(cwd, 'workspace'))
      const initial = await resolveInitialKnowledgeBase({ cwd, workspaceRoot, configuredRoot: this.options.knowledgeBaseCatalogRoot ?? configuredKnowledgeBaseCatalogRoot(cwd), initialKnowledgeBaseRoot: this.options.mountedKnowledgeBaseRoot, persistedKnowledgeBaseId: this.settings.knowledgeBaseId })
      this.knowledgeBaseCatalog = initial.catalog
      this.knowledgeBaseSelectionError = initial.selectionError
      try {
        this.runtime = await this.createApplicationRuntime(initial.mounted?.root, undefined, this.settings.model, this.options.startDailyScheduler !== false)
      } catch (error) {
        if (!(error instanceof ReasoningModelSelectionError) || error.code !== 'model_unavailable' || this.settings.model === undefined) throw error
        this.modelSelectionError = 'The saved model is unavailable. Choose an available model in Runtime settings.'
        this.runtime = await this.createApplicationRuntime(initial.mounted?.root, undefined, null, false)
      }
      this.ownsRuntime = true
    } else {
      this.knowledgeBaseCatalog = await discoverKnowledgeBases({ cwd, workspaceRoot: this.runtime.workspaceRoot, configuredRoot: this.options.knowledgeBaseCatalogRoot ?? configuredKnowledgeBaseCatalogRoot(cwd), explicitlyMountedRoot: this.explicitlyConfiguredKnowledgeBaseRoot() })
      // Injected runtimes are caller-owned; settings cannot silently replace their bound services.
      const mountedRoot = this.runtime.mountedKnowledgeBaseRoot === undefined ? undefined : await realpath(this.runtime.mountedKnowledgeBaseRoot).catch(() => resolve(this.runtime!.mountedKnowledgeBaseRoot!))
      if (this.settings.knowledgeBaseId !== undefined && this.settings.knowledgeBaseId !== (mountedRoot ? this.knowledgeBaseCatalog.find((item) => item.root.toLocaleLowerCase() === mountedRoot.toLocaleLowerCase())?.knowledgeBaseId : null)) {
        throw new ApplicationServiceError('conflict', 'Persisted Knowledge Base selection cannot be applied to an injected Runtime')
      }
    }
    this.assertClientRootBoundary()
    this.attachmentService ??= new AttachmentService({ workspaceRoot: this.runtime.workspaceRoot, forbiddenRoot: this.runtime.mountedKnowledgeBaseRoot, maxBytes: DEFAULT_MAX_ATTACHMENT_BYTES })
    if (this.runtime.mountedKnowledgeBaseRoot !== undefined) await this.attachmentService.assertCompatibleWithKnowledgeBase(this.runtime.mountedKnowledgeBaseRoot)
    this.httpServer = createServer((request, response) => { void this.handle(request, response) })
    try {
      const address = await new Promise<{ readonly port: number }>((resolve, reject) => {
        const onError = (error: Error) => { this.httpServer?.off('error', onError); reject(error) }
        this.httpServer!.once('error', onError)
        this.httpServer!.listen(this.port, this.bindAddress, () => {
          this.httpServer!.off('error', onError)
          const selected = this.httpServer!.address()
          if (!selected || typeof selected === 'string') { reject(new Error('Runtime server did not expose a TCP address')); return }
          resolve({ port: selected.port })
        })
      })
      const origin = originFor(this.bindAddress, address.port)
      this.runtimeSecurity = new RuntimeSecurity({ bindAddress: this.bindAddress, expectedOrigin: origin })
      this.unsubscribeSessionEvents = this.runtime.sessionRuntime.subscribeClientEvents((event) => this.eventStream.publish(event))
      this.runtimeInfo = { bindAddress: this.bindAddress, port: address.port, origin, runtimeToken: this.runtimeSecurity.runtimeToken }
      return this.runtimeInfo
    } catch (error) {
      const cleanupErrors: unknown[] = []
      try { await this.stopHttpServer() } catch (cleanupError) { cleanupErrors.push(cleanupError) }
      if (this.ownsRuntime && this.runtime) {
        try {
          await this.runtime.close()
          this.runtime = undefined
          this.ownsRuntime = false
        } catch (cleanupError) { cleanupErrors.push(cleanupError) }
      }
      throw combineErrors([error, ...cleanupErrors], 'Runtime server startup and cleanup failed')
    }
  }

  private async createApplicationRuntime(mountedKnowledgeBaseRoot?: string, model = this.options.model, modelSelectionOverride: RuntimeSettings['model'] | null = this.settings.model, startDailyScheduler = false, recoverModel = false): Promise<ResearchHubApplicationRuntime> {
    const reasoningExecutor = this.modelSelectionError !== undefined && !recoverModel ? disabledModelExecutor() : this.options.reasoningExecutor
    const modelSelection = modelSelectionOverride ?? undefined
    return createResearchHubApplicationRuntime({ cwd: this.options.cwd ?? process.cwd(), agentDir: this.options.agentDir, sessionDir: this.options.sessionDir, mountedKnowledgeBaseRoot, workspaceRoot: this.options.workspaceRoot, modelRuntime: this.options.modelRuntime, sessionManager: this.options.sessionManager, model, ...(modelSelection === undefined ? {} : { modelSelection }), startDailyScheduler, reasoningExecutor, settingsManager: this.options.settingsManager, resourceLoader: this.options.resourceLoader, researchService: this.options.researchService, ...(this.options.industryDataCatalog === undefined ? {} : { industryDataCatalog: this.options.industryDataCatalog }) })
  }

  private explicitlyConfiguredKnowledgeBaseRoot(): string | undefined {
    return this.options.mountedKnowledgeBaseRoot ?? this.runtime?.mountedKnowledgeBaseRoot
  }

  private assertClientRootBoundary(): void {
    const runtime = this.runtime!
    const protectedRoots = [runtime.workspaceRoot, runtime.agentDir, runtime.mountedKnowledgeBaseRoot, this.options.sessionDir === undefined ? undefined : resolve(this.options.sessionDir)].filter((value): value is string => value !== undefined)
    if (protectedRoots.some((root) => pathsOverlap(this.clientRoot, root)) || pathsOverlap(this.clientRoot, runtime.cwd) && resolve(this.clientRoot) === resolve(runtime.cwd)) throw new ApplicationServiceError('invalid_input', 'clientRoot overlaps protected Runtime storage')
    if (isInsideStaticRoot(this.clientRoot, runtime.cwd)) throw new ApplicationServiceError('invalid_input', 'clientRoot cannot contain the Runtime workspace')
  }

  close(): Promise<void> {
    if (this.lifecycle === 'closed') return Promise.resolve()
    if (this.closePromise) return this.closePromise
    this.lifecycle = 'closing'
    const closePromise = this.closeInternal()
    this.closePromise = closePromise
    void closePromise.then(
      () => { if (this.closePromise === closePromise) this.closePromise = undefined },
      () => { if (this.closePromise === closePromise) this.closePromise = undefined },
    )
    return closePromise
  }

  private async closeInternal(): Promise<void> {
    this.modelLoginFlows.close()
    const cleanupErrors: unknown[] = []
    if (this.startPromise) {
      try { await this.startPromise } catch (error) { cleanupErrors.push(error) }
    }
    await this.cancelAndSettleBackgroundOperations(cleanupErrors)
    try {
      this.unsubscribeSessionEvents?.()
      this.unsubscribeSessionEvents = undefined
    } catch (error) { cleanupErrors.push(error) }
    try {
      for (const client of [...this.sseClients]) this.removeSseClient(client)
    } catch (error) { cleanupErrors.push(error) }
    try { this.eventStream.clear() } catch (error) { cleanupErrors.push(error) }
    try { await this.stopHttpServer() } catch (error) { cleanupErrors.push(error) }
    // Background command/production promises have rejection handlers installed by
    // trackBackground; they are deliberately not awaited during process shutdown.
    if (this.ownsRuntime && this.runtime) {
      try {
        await this.runtime.close()
        this.runtime = undefined
        this.ownsRuntime = false
      } catch (error) { cleanupErrors.push(error) }
    }
    this.runtimeInfo = undefined
    this.runtimeSecurity = undefined
    if (cleanupErrors.length > 0) throw combineErrors(cleanupErrors, 'Runtime server cleanup failed')
    this.lifecycle = 'closed'
  }

  private async cancelAndSettleBackgroundOperations(errors: unknown[]): Promise<void> {
    const operations = [...this.backgroundOperations]
    const cancellationPromises: Promise<void>[] = []
    for (const operation of operations) {
      try {
        const result = operation.cancel()
        if (result !== undefined) cancellationPromises.push(Promise.resolve(result).catch((error) => { errors.push(error) }))
      } catch (error) { errors.push(error) }
    }
    await Promise.all(cancellationPromises)
    const settlements = await Promise.allSettled(operations.map((operation) => operation.completion))
    for (const settlement of settlements) if (settlement.status === 'rejected') errors.push(settlement.reason)
    this.backgroundOperations.clear()
  }

  async dispose(): Promise<void> { return this.close() }

  private async stopHttpServer(): Promise<void> {
    const server = this.httpServer
    if (!server) return
    const idle = server as Server & { closeIdleConnections?: () => void }
    idle.closeIdleConnections?.()
    try {
      await new Promise<void>((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()) })
      this.httpServer = undefined
    } catch (error) {
      if (!server.listening) this.httpServer = undefined
      throw error
    }
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let countedRequest = false
    let reservedKnowledgeSwitch = false
    try {
      if (this.lifecycle !== 'running') throw new ApplicationServiceError(this.lifecycle === 'closing' ? 'conflict' : 'failed', this.lifecycle === 'closing' ? 'Runtime server is closing' : 'Runtime server is not ready')
      const security = this.runtimeSecurity
      if (!security || !this.runtime || !this.runtimeInfo) throw new ApplicationServiceError('failed', 'Runtime server is not ready')
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`)
      if (request.method === 'OPTIONS') { this.validateRead(request); this.sendEmpty(response, 204); return }
      if (request.method === 'POST' && (url.pathname === '/api/settings/knowledge-base' || url.pathname === '/api/settings/model' || url.pathname === '/api/settings/model-login' || url.pathname === '/api/settings/model-key' || url.pathname === '/api/settings/model-logout' || url.pathname === '/api/settings/model-connection' || url.pathname === '/api/settings/knowledge-directory/register' || url.pathname === '/api/settings/knowledge-directory/remove')) {
        this.validateMutation(request)
        if (this.settingsChanging) throw new ApplicationServiceError('conflict', 'A Runtime settings change is already in progress')
        this.settingsChanging = true
        reservedKnowledgeSwitch = true
      } else if (url.pathname.startsWith('/api/') && url.pathname !== '/api/events') {
        this.inFlightApiRequests += 1
        countedRequest = true
      }
      if (url.pathname === '/api/bootstrap') { this.validateBootstrap(request); if (this.settingsChanging) throw new ApplicationServiceError('conflict', 'Runtime settings are changing; retry the request'); await this.bootstrap(response); return }
      if (url.pathname === '/api/events' && request.method === 'GET') { this.validateRead(request); this.openEvents(response); return }
      const tokenProtectedRead = request.method === 'GET' && (/^\/api\/theme-framework\/reviews$/.test(url.pathname) || /^\/api\/theme-framework\/runs\/[^/]+$/.test(url.pathname) || /^\/api\/theme-scope-impact(?:\/.*)?$/.test(url.pathname) || /^\/api\/settings\/model-login\/[0-9a-f-]+$/.test(url.pathname))
      if (this.isMutation(request.method, url.pathname)) this.validateMutation(request)
      else if (tokenProtectedRead) this.validateTokenProtectedRead(request)
      else this.validateRead(request)
      if (this.settingsChanging && !reservedKnowledgeSwitch) throw new ApplicationServiceError('conflict', 'Runtime settings are changing; retry the request')
      if (this.modelSelectionError !== undefined && request.method === 'POST' && this.isModelDependentCommand(url.pathname)) throw new ApplicationServiceError('conflict', this.modelSelectionError)
      if (this.modelLoginFlows.hasActiveFlow() && request.method === 'POST' && this.isModelDependentCommand(url.pathname)) throw new ApplicationServiceError('conflict', 'Model login is in progress')
      if (url.pathname !== '/api' && !url.pathname.startsWith('/api/')) {
        if (await this.serveClient(request, response, url)) return
      }
      await this.route(request, response, url)
    } catch (error) {
      if (response.headersSent) { response.destroy(); return }
      this.sendError(response, error)
    } finally {
      if (countedRequest) this.inFlightApiRequests -= 1
      if (reservedKnowledgeSwitch) this.settingsChanging = false
    }
  }

  private isMutation(method: string | undefined, pathname: string): boolean {
    if (method !== 'POST' && method !== 'PUT' && method !== 'PATCH' && method !== 'DELETE') return false
    return pathname.startsWith('/api/')
  }

  private isModelDependentCommand(pathname: string): boolean {
    const safeCommands = new Set([
      '/api/settings', '/api/settings/model', '/api/settings/knowledge-base', '/api/settings/model-login', '/api/settings/model-key', '/api/settings/model-connection', '/api/settings/model-test', '/api/settings/model-logout', '/api/settings/knowledge-directory/verify', '/api/settings/knowledge-directory/register', '/api/settings/knowledge-directory/remove',
      '/api/conversations/new', '/api/conversation/new', '/api/conversations/switch', '/api/conversation/switch',
      '/api/conversations/abort', '/api/conversation/abort',
      '/api/attachments', '/api/attachments/upload',
      '/api/knowledge/search', '/api/search-knowledge', '/api/knowledge/object', '/api/knowledge/get',
      '/api/research/source-library/search', '/api/workflows/cancel',
    ])
    if (safeCommands.has(pathname) || /^\/api\/settings\/model-login\/[0-9a-f-]+\/(answer|cancel)$/.test(pathname) || /^\/api\/workflows\/[^/]+\/cancel$/.test(pathname)) return false
    return true
  }

  private async serveClient(request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> {
    if (request.method !== 'GET' && request.method !== 'HEAD') return false
    let decodedPath: string
    try { decodedPath = decodeURIComponent(url.pathname) } catch { this.sendStaticNotFound(response); return true }
    if (decodedPath.includes('\u0000') || decodedPath.includes('\\')) { this.sendStaticNotFound(response); return true }
    const segments = decodedPath.split('/').filter((segment) => segment.length > 0)
    if (segments.includes('..')) { this.sendStaticNotFound(response); return true }
    const clientRoot = await realpath(this.clientRoot).catch(() => undefined)
    if (clientRoot === undefined || !(await lstat(clientRoot).then((info) => info.isDirectory() && !info.isSymbolicLink()).catch(() => false))) return false
    const requestedPath = segments.length === 0 ? join(this.clientRoot, 'index.html') : join(this.clientRoot, ...segments)
    let filePath = requestedPath
    let fileInfo = await lstat(filePath).catch(() => undefined)
    const isAsset = decodedPath === '/assets' || decodedPath.startsWith('/assets/')
    if (!fileInfo) {
      if (isAsset || /\.[^/]+$/.test(decodedPath)) { this.sendStaticNotFound(response); return true }
      filePath = join(this.clientRoot, 'index.html')
      fileInfo = await lstat(filePath).catch(() => undefined)
    }
    if (!fileInfo || fileInfo.isDirectory()) { this.sendStaticNotFound(response); return true }
    const resolvedPath = await realpath(filePath).catch(() => undefined)
    if (resolvedPath === undefined || !isInsideStaticRoot(clientRoot, resolvedPath)) { this.sendStaticNotFound(response); return true }
    const resolvedInfo = await stat(resolvedPath).catch(() => undefined)
    if (!resolvedInfo?.isFile()) { this.sendStaticNotFound(response); return true }
    const extension = resolvedPath.slice(resolvedPath.lastIndexOf('.')).toLowerCase()
    const headers = { ...this.runtimeSecurity!.corsHeaders(), 'Cache-Control': isAsset ? 'public, max-age=31536000, immutable' : 'no-store', 'Content-Type': CLIENT_MIME_TYPES[extension] ?? 'application/octet-stream', 'Content-Length': String(resolvedInfo.size) }
    response.writeHead(200, headers)
    if (request.method === 'HEAD') { response.end(); return true }
    await pipeline(createReadStream(resolvedPath), response)
    return true
  }

  private sendStaticNotFound(response: ServerResponse): void { if (response.writableEnded) return; response.writeHead(404, { ...this.runtimeSecurity!.corsHeaders(), 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' }); response.end('Not found') }

  private validateBootstrap(request: IncomingMessage): void {
    this.validateRead(request)
  }

  private validateRead(request: IncomingMessage): void {
    const security = this.runtimeSecurity!
    const origin = typeof request.headers.origin === 'string' ? request.headers.origin : security.expectedOrigin
    security.validateRequest({ host: request.headers.host, origin }, 'read')
  }

  private validateMutation(request: IncomingMessage): void {
    this.runtimeSecurity!.validateRequest({ host: request.headers.host, origin: request.headers.origin, runtimeToken: request.headers[TOKEN_HEADER] as string | undefined }, 'mutation')
  }

  private validateTokenProtectedRead(request: IncomingMessage): void {
    const security = this.runtimeSecurity!
    const origin = typeof request.headers.origin === 'string' ? request.headers.origin : security.expectedOrigin
    security.validateRequest({ host: request.headers.host, origin, runtimeToken: request.headers[TOKEN_HEADER] as string | undefined }, 'mutation')
  }

  private async route(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    const method = request.method ?? 'GET'
    const path = url.pathname
    if (method === 'GET' && path === '/api/data-sources/policies') { await this.sendJson(response, 200, getDataSourceCatalog()); return }
    if (method === 'GET' && path === '/api/data-sources/catalog/common') {
      const service = this.runtime!.services.dataSourceAdministrationService
      const integrations = service === undefined ? [] : await service.listIntegrations()
      const policies = [...PHASE2_COMMON_SOURCE_POLICIES, ...PHASE3_COMMON_SOURCE_POLICIES, ...INDUSTRY_DATA_SOURCE_POLICIES]
      await this.sendJson(response, 200, projectCommonDataCatalog({ definitions: COMMON_DATA_CATALOG, policies, integrations, boundOperationIds: this.runtime!.industryDataBoundOperationIds })); return
    }
    if (method === 'GET' && path === '/api/data-sources/catalog/industry') {
      const service = this.runtime!.services.dataSourceAdministrationService
      const integrations = service === undefined ? [] : await service.listIntegrations()
      await this.sendJson(response, 200, projectIndustryDataCatalog({ catalog: this.runtime!.industryDataCatalog, identities: INDUSTRY_IDENTITIES, policies: INDUSTRY_DATA_SOURCE_POLICIES, integrations, boundOperationIds: this.runtime!.industryDataBoundOperationIds })); return
    }
    if (method === 'GET' && path === '/api/data-sources/integrations') {
      const service = this.runtime!.services.dataSourceAdministrationService
      if (!service) throw new ApplicationServiceError('failed', 'Data source administration is unavailable')
      await this.sendJson(response, 200, { integrations: (await service.listIntegrations()).map(safeIntegrationView) }); return
    }
    const credentialRoute = /^\/api\/data-sources\/integrations\/([^/]+)\/credentials$/.exec(path)
    if (credentialRoute && (method === 'POST' || method === 'DELETE')) {
      const service = this.runtime!.services.dataSourceAdministrationService
      if (!service) throw new ApplicationServiceError('failed', 'Data source administration is unavailable')
      const integrationId = decodeSegment(credentialRoute[1]!)
      if (method === 'POST') {
        const body = await this.readJson(request, 20_000)
        assertExactFields(body, ['values'], [], 'credential request')
        if (!isRecord(body.values) || Object.keys(body.values).length > 64 || Object.values(body.values).some((value) => typeof value !== 'string' || value.length > 8_192)) throw new ApplicationServiceError('invalid_input', 'Credential values are invalid or oversized')
        try { await service.saveCredentials(integrationId, body.values as Record<string, string>) }
        catch (error) { throw this.dataSourceRouteFailure(error, 'credential') }
        await this.sendJson(response, 200, { saved: true }); return
      }
      try { await service.removeCredentials(integrationId) }
      catch (error) { throw this.dataSourceRouteFailure(error, 'credential') }
      await this.sendJson(response, 200, { removed: true }); return
    }
    const testRoute = /^\/api\/data-sources\/integrations\/([^/]+)\/tests$/.exec(path)
    if (method === 'POST' && testRoute) {
      const service = this.runtime!.services.dataSourceAdministrationService
      if (!service) throw new ApplicationServiceError('failed', 'Data source administration is unavailable')
      const integrationId = decodeSegment(testRoute[1]!)
      const body = await this.readJson(request, 4_096)
      assertExactFields(body, ['kind'], ['capabilityId'], 'data source test request')
      if (body.kind !== 'connection' && body.kind !== 'capability_sample') throw new ApplicationServiceError('invalid_input', 'Data source test kind is invalid')
      if (body.capabilityId !== undefined && (typeof body.capabilityId !== 'string' || body.capabilityId.length === 0 || body.capabilityId.length > 64)) throw new ApplicationServiceError('invalid_input', 'Data source capability ID is invalid')
      const controller = new AbortController()
      const onClose = () => { if (!response.writableEnded) controller.abort() }
      response.once('close', onClose)
      try {
        const summary = await service.runTest({ integrationId, kind: body.kind, ...(body.capabilityId === undefined ? {} : { capabilityId: body.capabilityId as string }) }, controller.signal)
        if (response.destroyed) return
        await this.sendJson(response, 200, { integrationId: summary.integrationId, kind: summary.kind, ...(summary.capabilityId === undefined ? {} : { capabilityId: summary.capabilityId }), status: summary.status, startedAt: summary.startedAt, completedAt: summary.completedAt, ...(summary.errorCode === undefined ? {} : { errorCode: summary.errorCode }) })
        return
      } catch (error) { throw this.dataSourceRouteFailure(error, 'test') }
      finally { response.removeListener('close', onClose) }
    }
    if (path === '/api/data-sources/onboarding' && method === 'GET') {
      const service = this.runtime!.services.dataSourceOnboardingService
      if (!service) throw new ApplicationServiceError('failed', 'Data source onboarding is unavailable')
      await this.sendJson(response, 200, { drafts: (await service.list()).map(safeOnboardingDraft) }); return
    }
    if (path === '/api/data-sources/onboarding' && method === 'POST') {
      const service = this.runtime!.services.dataSourceOnboardingService
      if (!service) throw new ApplicationServiceError('failed', 'Data source onboarding is unavailable')
      const body = await this.readJson(request, 20_000)
      const draft = await this.runDataSourceOnboarding(() => service.create(onboardingInput(body)))
      await this.sendJson(response, 201, { draft: safeOnboardingDraft(draft) }); return
    }
    const onboardingRoute = /^\/api\/data-sources\/onboarding\/([^/]+)$/.exec(path)
    if (method === 'PATCH' && onboardingRoute) {
      const service = this.runtime!.services.dataSourceOnboardingService
      if (!service) throw new ApplicationServiceError('failed', 'Data source onboarding is unavailable')
      const requestId = decodeSegment(onboardingRoute[1]!)
      const body = await this.readJson(request, 20_000)
      let draft
      if (body.action === 'update') {
        assertExactFields(body, ['action', 'input'], [], 'onboarding update request')
        draft = await this.runDataSourceOnboarding(() => service.update(requestId, onboardingInput(body.input)))
      } else if (body.action === 'mark_ready') {
        assertExactFields(body, ['action'], [], 'onboarding ready request')
        draft = await this.runDataSourceOnboarding(() => service.markReady(requestId))
      } else throw new ApplicationServiceError('invalid_input', 'Onboarding action is invalid')
      await this.sendJson(response, 200, { draft: safeOnboardingDraft(draft) }); return
    }
    if (method === 'GET' && path === '/api/settings') { await this.sendJson(response, 200, await this.settingsResponse()); return }
    if (method === 'POST' && path === '/api/settings/knowledge-base') { await this.changeKnowledgeBase(request, response); return }
    if (method === 'POST' && path === '/api/settings/model') { await this.changeModel(request, response); return }
    if (method === 'POST' && path === '/api/settings/model-key') {
      const body = await this.readJson(request, 20_000)
      if (Object.keys(body).length !== 2 || typeof body.providerId !== 'string' || typeof body.apiKey !== 'string') throw new ApplicationServiceError('invalid_input', 'Provider ID and API Key are required')
      this.assertSettingsChangeAllowed('Model authentication')
      try { await saveModelProviderApiKey(this.runtime!.modelRuntime, body.providerId, body.apiKey) }
      catch { throw new ApplicationServiceError('invalid_input', 'Pi could not save authentication for this provider') }
      await this.sendJson(response, 200, await this.settingsResponse()); return
    }
    if (method === 'POST' && path === '/api/settings/model-logout') {
      const body = await this.readJson(request, 1024)
      if (Object.keys(body).length !== 1 || typeof body.providerId !== 'string') throw new ApplicationServiceError('invalid_input', 'Provider ID is required')
      this.assertSettingsChangeAllowed('Model authentication')
      if (this.settings.model?.provider === body.providerId || this.sessionState().model?.provider === body.providerId) throw new ApplicationServiceError('conflict', 'Choose another global model before removing these credentials')
      if (!this.runtime!.modelRuntime.getProvider(body.providerId)) throw new ApplicationServiceError('invalid_input', 'Provider is not configured')
      try { await this.runtime!.modelRuntime.logout(body.providerId) }
      catch { throw new ApplicationServiceError('failed', 'Pi could not remove provider authentication') }
      await this.sendJson(response, 200, await this.settingsResponse()); return
    }
    if (method === 'POST' && path === '/api/settings/model-connection') {
      const body = await this.readJson(request, 4096)
      this.assertSettingsChangeAllowed('Model connection')
      const cwd = this.options.cwd ?? process.cwd()
      try {
        await addModelConnection(this.runtime!.modelRuntime, cwd, body as unknown as Parameters<typeof addModelConnection>[2])
        await this.sendJson(response, 200, await this.settingsResponse()); return
      } catch (error) {
        throw new ApplicationServiceError('invalid_input', error instanceof Error ? error.message : 'Model connection is invalid')
      }
    }
    if (method === 'POST' && path === '/api/settings/model-test') {
      const body = await this.readJson(request, 1024)
      if (Object.keys(body).length !== 2 || typeof body.provider !== 'string' || typeof body.modelId !== 'string') throw new ApplicationServiceError('invalid_input', 'Provider and model ID are required')
      let model
      try { model = await validateReasoningModelSelection(this.runtime!.modelRuntime, { provider: body.provider, modelId: body.modelId }) }
      catch { throw new ApplicationServiceError('conflict', 'Model is unavailable or lacks required capabilities') }
      try {
        const result = await this.runtime!.modelRuntime.completeSimple(model, { messages: [{ role: 'user', content: 'Reply with OK.', timestamp: Date.now() }] }, { maxTokens: 12, timeoutMs: 20_000, maxRetries: 0, signal: AbortSignal.timeout(20_000) })
        if (result.stopReason === 'error') throw new Error('Provider returned an error')
      } catch { throw new ApplicationServiceError('failed', 'Model connection test failed') }
      await this.sendJson(response, 200, { ok: true }); return
    }
    if (method === 'POST' && path === '/api/settings/knowledge-directory/verify') {
      const body = await this.readJson(request, 4096)
      if (Object.keys(body).length !== 1 || typeof body.path !== 'string') throw new ApplicationServiceError('invalid_input', 'A Knowledge Base directory path is required')
      const candidate = await validateKnowledgeBaseDirectory(this.runtime!.workspaceRoot, body.path)
      await this.sendJson(response, 200, this.publicRegistration(candidate)); return
    }
    if (method === 'POST' && path === '/api/settings/knowledge-directory/register') {
      const body = await this.readJson(request, 4096)
      if (Object.keys(body).length !== 1 || typeof body.path !== 'string') throw new ApplicationServiceError('invalid_input', 'A Knowledge Base directory path is required')
      this.assertSettingsChangeAllowed('Knowledge Base registration')
      const cwd = this.options.cwd ?? process.cwd()
      const catalog = await discoverKnowledgeBases({ cwd, workspaceRoot: this.runtime!.workspaceRoot, configuredRoot: this.options.knowledgeBaseCatalogRoot ?? configuredKnowledgeBaseCatalogRoot(cwd), explicitlyMountedRoot: this.explicitlyConfiguredKnowledgeBaseRoot() })
      await addRegisteredKnowledgeBase(cwd, this.runtime!.workspaceRoot, body.path, catalog)
      await this.sendJson(response, 200, await this.settingsResponse()); return
    }
    if (method === 'POST' && path === '/api/settings/knowledge-directory/remove') {
      const body = await this.readJson(request, 1024)
      if (Object.keys(body).length !== 1 || typeof body.knowledgeBaseId !== 'string') throw new ApplicationServiceError('invalid_input', 'Knowledge Base identifier is required')
      this.assertSettingsChangeAllowed('Knowledge Base registration')
      const mountedRoot = this.runtime!.mountedKnowledgeBaseRoot
      const mountedId = mountedRoot === undefined ? undefined : this.knowledgeBaseCatalog.find((item) => item.root.toLocaleLowerCase() === mountedRoot.toLocaleLowerCase())?.knowledgeBaseId
      if (mountedId === body.knowledgeBaseId) throw new ApplicationServiceError('conflict', 'Unmount or switch this Knowledge Base before removing its registration')
      await removeRegisteredKnowledgeBase(this.options.cwd ?? process.cwd(), body.knowledgeBaseId)
      await this.sendJson(response, 200, await this.settingsResponse()); return
    }
    if (method === 'POST' && path === '/api/settings/model-login') {
      const body = await this.readJson(request, 1024)
      if (Object.keys(body).length !== 1 || typeof body.provider !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(body.provider)) throw new ApplicationServiceError('invalid_input', 'A supported provider is required')
      if (body.provider !== 'openai-codex') throw new ApplicationServiceError('invalid_input', 'Only the OpenAI Codex subscription flow is enabled')
      this.assertSettingsChangeAllowed('Model login')
      try { await this.sendJson(response, 202, this.modelLoginFlows.start(this.runtime!.modelRuntime, body.provider)) }
      catch { throw new ApplicationServiceError('conflict', 'Provider subscription login is unavailable or already in progress') }
      return
    }
    const loginMatch = /^\/api\/settings\/model-login\/([0-9a-f-]+)(?:\/(answer|cancel))?$/.exec(path)
    if (loginMatch) {
      const [, id, action] = loginMatch
      if (method === 'GET' && !action) {
        const flow = this.modelLoginFlows.get(id)
        if (!flow) throw new ApplicationServiceError('not_found', 'Model login was not found')
        await this.sendJson(response, 200, flow); return
      }
      if (method === 'POST' && action === 'answer') {
        const body = await this.readJson(request, 5_000)
        if (Object.keys(body).length !== 1 || typeof body.answer !== 'string') throw new ApplicationServiceError('invalid_input', 'Login answer is required')
        try { await this.sendJson(response, 200, this.modelLoginFlows.answer(id, body.answer)) }
        catch { throw new ApplicationServiceError('invalid_input', 'No pending login prompt accepts this answer') }
        return
      }
      if (method === 'POST' && action === 'cancel') {
        const flow = this.modelLoginFlows.cancel(id)
        if (!flow) throw new ApplicationServiceError('not_found', 'Model login was not found')
        await this.sendJson(response, 200, flow); return
      }
    }
    if (method === 'GET' && (path === '/api/researchhub/status' || path === '/api/status')) { await this.sendJson(response, 200, await this.status()) ; return }
    if (method === 'GET' && path === '/api/theme-framework/reviews') {
      if ([...url.searchParams.keys()].some((key) => key !== 'limit')) throw new ApplicationServiceError('invalid_input', 'Theme Framework reviews query contains unsupported fields')
      const limit = positiveInteger(url.searchParams.get('limit'))
      if (Number.isNaN(limit) || (limit !== undefined && limit > 100)) throw new ApplicationServiceError('invalid_input', 'limit must be a positive integer no greater than 100')
      const service = this.runtime!.services.themeFrameworkService
      if (!service) throw new ApplicationServiceError('no_kb_mounted', 'Theme Framework construction requires an active mounted Schema 0.4 Knowledge Base')
      await this.sendJson(response, 200, await service.listReviews(limit)); return
    }
    if (method === 'POST' && path === '/api/theme-framework/start') {
      const body = await this.readJson(request, 8_192)
      assertExactFields(body, ['workflowRunId', 'name'], ['definition'], 'Theme Framework start request')
      const workflowRunId = this.stringField(body, 'workflowRunId', 128)
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(workflowRunId) || workflowRunId.includes('..')) throw new ApplicationServiceError('invalid_input', 'workflowRunId is invalid')
      const name = this.stringField(body, 'name', 300)
      if (!name.trim()) throw new ApplicationServiceError('invalid_input', 'name is invalid')
      const definition = this.optionalString(body, 'definition', 2_000)
      if (definition !== undefined && !definition.trim()) throw new ApplicationServiceError('invalid_input', 'definition is invalid')
      const service = this.runtime!.services.themeFrameworkService
      if (!service) throw new ApplicationServiceError('no_kb_mounted', 'Theme Framework construction requires an active mounted Schema 0.4 Knowledge Base')
      const started = service.start({ workflowRunId, name, ...(definition === undefined ? {} : { definition }) })
      started.completion.catch(() => undefined)
      await this.sendJson(response, 202, { accepted: true, runId: started.runId, workflow: this.runtime!.workflowService.getWorkflowStatus(started.runId) }); return
    }
    if (/^\/api\/theme-framework\/runs\/[^/]+(?:\/(?:accept|reject|refresh))?$/.test(path)) {
      const pieces = path.split('/')
      const runId = decodeSegment(pieces[4] ?? '')
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(runId) || runId.includes('..')) throw new ApplicationServiceError('invalid_input', 'workflowRunId is invalid')
      const service = this.runtime!.services.themeFrameworkService
      if (!service) throw new ApplicationServiceError('no_kb_mounted', 'Theme Framework construction requires an active mounted Schema 0.4 Knowledge Base')
      if (method === 'GET' && pieces.length === 5) { await this.sendJson(response, 200, await service.getReviewCandidate(runId)); return }
      if (method === 'POST' && pieces[5] === 'refresh') {
        const body = await this.readJson(request, 1_024)
        assertExactFields(body, [], [], 'Theme Framework refresh request')
        const result = await service.refresh(runId)
        const status = result.status === 'conflict' ? 409 : result.status === 'blocked' ? 422 : 200
        await this.sendJson(response, status, result); return
      }
      if (method === 'POST' && pieces[5] === 'accept') {
        const body = await this.readJson(request, 32_768)
        assertExactFields(body, [], ['decisions', 'decisionRationales'], 'Theme Framework accept request')
        let decisions: Record<string, 'include' | 'exclude' | 'pending'> | undefined
        if (body.decisions !== undefined) {
          if (!isRecord(body.decisions) || Object.keys(body.decisions).length > 120) throw new ApplicationServiceError('invalid_input', 'decisions must be a bounded candidate decision map')
          decisions = {}
          for (const [candidateId, decision] of Object.entries(body.decisions)) {
            if (!/^[A-Za-z][A-Za-z0-9._-]{0,79}$/u.test(candidateId) || !['include', 'exclude', 'pending'].includes(String(decision))) throw new ApplicationServiceError('invalid_input', 'decisions contains an invalid candidate ref or decision')
            decisions[candidateId] = decision as 'include' | 'exclude' | 'pending'
          }
        }
        let decisionRationales: Record<string, string> | undefined
        if (body.decisionRationales !== undefined) {
          if (!isRecord(body.decisionRationales) || Object.keys(body.decisionRationales).length > 120) throw new ApplicationServiceError('invalid_input', 'decisionRationales must be a bounded candidate rationale map')
          decisionRationales = {}
          for (const [candidateId, rationale] of Object.entries(body.decisionRationales)) {
            if (!/^[A-Za-z][A-Za-z0-9._-]{0,79}$/u.test(candidateId) || typeof rationale !== 'string' || rationale.trim().length === 0 || rationale.trim().length > THEME_SCOPE_V04_LIMITS.maxRationaleLength) throw new ApplicationServiceError('invalid_input', 'decisionRationales contains an invalid candidate ref or rationale')
            decisionRationales[candidateId] = rationale
          }
        }
        await this.sendJson(response, 200, await service.accept({ workflowRunId: runId, ...(decisions === undefined ? {} : { decisions }), ...(decisionRationales === undefined ? {} : { decisionRationales }) })); return
      }
      if (method === 'POST' && pieces[5] === 'reject') {
        const body = await this.readJson(request, 1_024)
        assertExactFields(body, [], [], 'Theme Framework reject request')
        await this.sendJson(response, 200, await service.reject(runId)); return
      }
    }
    if (path === '/api/theme-scope-impact' && method === 'GET') {
      const service = this.runtime!.services.themeScopeImpactService
      if (!service) throw new ApplicationServiceError('no_kb_mounted', 'Theme scope impact inbox requires an active mounted Schema 0.4 Knowledge Base')
      const limit = positiveInteger(url.searchParams.get('limit'))
      if (Number.isNaN(limit) || (limit !== undefined && limit > 100)) throw new ApplicationServiceError('invalid_input', 'limit must be a positive integer no greater than 100')
      if ([...url.searchParams.keys()].some((key) => key !== 'limit')) throw new ApplicationServiceError('invalid_input', 'Theme scope impact inbox query contains unsupported fields')
      await this.sendJson(response, 200, await service.list({ ...(limit === undefined ? {} : { limit }) })); return
    }
    const scopeImpactDetailRoute = path.match(/^\/api\/theme-scope-impact\/records\/([A-Za-z0-9%_-]+)$/u)
    if (method === 'GET' && scopeImpactDetailRoute) {
      const service = this.runtime!.services.themeScopeImpactService
      if (!service) throw new ApplicationServiceError('no_kb_mounted', 'Theme scope impact inbox requires an active mounted Schema 0.4 Knowledge Base')
      await this.sendJson(response, 200, await service.get(decodeSegment(scopeImpactDetailRoute[1]!))); return
    }
    const scopeImpactDecisionBatchRoute = path.match(/^\/api\/theme-scope-impact\/records\/([A-Za-z0-9%_-]+)\/decisions$/u)
    if (method === 'POST' && scopeImpactDecisionBatchRoute) {
      const service = this.runtime!.services.themeScopeImpactService
      if (!service) throw new ApplicationServiceError('no_kb_mounted', 'Theme scope impact inbox requires an active mounted Schema 0.4 Knowledge Base')
      const receiptKey = decodeSegment(scopeImpactDecisionBatchRoute[1]!)
      const body = await this.readJson(request, 128_000)
      assertExactFields(body, ['workflowRunId', 'decisions'], [], 'Theme scope impact decision batch request')
      if (typeof body.workflowRunId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(body.workflowRunId) || body.workflowRunId.includes('..')
        || !Array.isArray(body.decisions) || body.decisions.length < 1 || body.decisions.length > 100) throw new ApplicationServiceError('invalid_input', 'Theme scope impact decision batch is invalid or exceeds its bounded size')
      const decisions: { proposalId: string; decision: 'include' | 'exclude' | 'pending'; rationale?: string }[] = []
      const seen = new Set<string>()
      for (const value of body.decisions) {
        if (!isRecord(value)) throw new ApplicationServiceError('invalid_input', 'Theme scope impact decisions must be objects')
        assertExactFields(value, ['proposalId', 'decision'], ['rationale'], 'Theme scope impact decision')
        if (typeof value.proposalId !== 'string' || !/^theme-scope-impact:[a-f0-9]{40}$/u.test(value.proposalId) || seen.has(value.proposalId)
          || typeof value.decision !== 'string' || !['include', 'exclude', 'pending'].includes(value.decision)
          || (value.rationale !== undefined && (typeof value.rationale !== 'string' || value.rationale.length > 2_000))) throw new ApplicationServiceError('invalid_input', 'Theme scope impact decision contains invalid, duplicate, or oversized fields')
        seen.add(value.proposalId)
        decisions.push({ proposalId: value.proposalId, decision: value.decision as 'include' | 'exclude' | 'pending', ...(value.rationale === undefined ? {} : { rationale: value.rationale as string }) })
      }
      const decisionService = service as typeof service & { decideBatch?: (input: { readonly receiptKey: string; readonly decisions: readonly { readonly proposalId: string; readonly decision: 'include' | 'exclude' | 'pending'; readonly rationale?: string }[]; readonly workflowRunId: string }) => Promise<unknown> }
      if (typeof decisionService.decideBatch !== 'function') throw new ApplicationServiceError('failed', 'Atomic Theme scope impact decision batches are not available')
      await this.sendJson(response, 200, await decisionService.decideBatch({ receiptKey, workflowRunId: body.workflowRunId, decisions })); return
    }
    const scopeImpactRoute = path.match(/^\/api\/theme-scope-impact\/records\/([A-Za-z0-9%_-]+)\/proposals\/([A-Za-z0-9%:._-]+)\/dismiss$/u)
    if (scopeImpactRoute) {
      const [, receiptKey, proposalId] = scopeImpactRoute
      const service = this.runtime!.services.themeScopeImpactService
      if (!service) throw new ApplicationServiceError('no_kb_mounted', 'Theme scope impact inbox requires an active mounted Schema 0.4 Knowledge Base')
      const decodedReceiptKey = decodeSegment(receiptKey!)
      const decodedProposalId = decodeSegment(proposalId!)
      if (method === 'POST') {
        const body = await this.readJson(request, 8_192)
        assertExactFields(body, ['workflowRunId'], [], 'Theme scope impact dismiss request')
        if (typeof body.workflowRunId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(body.workflowRunId) || body.workflowRunId.includes('..')) {
          throw new ApplicationServiceError('invalid_input', 'Theme scope impact decision fields are invalid or do not match the route')
        }
        await this.sendJson(response, 200, await service.reject(decodedReceiptKey, decodedProposalId)); return
      }
    }
    // Exact, human-operated criterion routes precede the broader Thesis and review route families.
    if (method === 'POST' && path === '/api/production/thesis-lifecycle/criteria/prepare') {
      const body = await this.readJson(request)
      const service = this.runtime!.services.thesisCriterionService
      if (!service) throw new ApplicationServiceError('no_kb_mounted', 'Thesis criterion authoring requires an active mounted Schema 0.4 Knowledge Base')
      await this.sendJson(response, 200, await service.prepare(validateCriterionPrepareBody(body))); return
    }
    if (method === 'POST' && path === '/api/production/thesis-lifecycle/criteria/confirm') {
      const body = await this.readJson(request)
      const service = this.runtime!.services.thesisCriterionService
      if (!service) throw new ApplicationServiceError('no_kb_mounted', 'Thesis criterion authoring requires an active mounted Schema 0.4 Knowledge Base')
      await this.sendJson(response, 200, await service.confirm(validateCriterionConfirmBody(body))); return
    }
    if (method === 'GET' && path === '/api/knowledge/theses') {
      const service = this.runtime!.services.thesisQueryService
      if (!service) throw new ApplicationServiceError('no_kb_mounted', 'Thesis queries require a mounted Schema 0.4 Knowledge Base')
      const limit = positiveInteger(url.searchParams.get('limit'))
      if (Number.isNaN(limit)) throw new ApplicationServiceError('invalid_input', 'limit must be a positive integer')
      if (limit !== undefined && limit > 50) throw new ApplicationServiceError('invalid_input', 'limit must be at most 50')
      await this.sendJson(response, 200, await service.listTheses(limit)); return
    }
    if (method === 'GET' && path.startsWith('/api/knowledge/theses/')) {
      const pieces = path.split('/')
      if (pieces.length !== 5 || pieces[4] === '') throw new ApplicationServiceError('not_found', 'Thesis route not found')
      const service = this.runtime!.services.thesisQueryService
      if (!service) throw new ApplicationServiceError('no_kb_mounted', 'Thesis queries require a mounted Schema 0.4 Knowledge Base')
      await this.sendJson(response, 200, await service.getThesis(decodeSegment(pieces[4]!))); return
    }
    if (method === 'GET' && path.startsWith('/api/knowledge/themes/')) {
      const pieces = path.split('/')
      const themeRef = themeWorkspaceRef(decodeSegment(pieces[4] ?? ''), 'themeRef')
      const service = this.runtime!.services.themeWorkspaceProjectionService
      if (!service) throw new ApplicationServiceError('no_kb_mounted', 'Theme Workspace requires a mounted Schema 0.4 Knowledge Base')
      if (pieces.length === 6 && pieces[5] === 'overview') {
        const query = themeWorkspaceQuery(url, new Set(['expectedRevision', 'asOf', 'maxNodes', 'maxEdges', 'maxResponseBytes']))
        await this.sendJson(response, 200, await service.getThemeProjection({ ...query, themeRef })); return
      }
      if (pieces.length === 7 && pieces[5] === 'industries') {
        const industryRef = themeWorkspaceRef(decodeSegment(pieces[6] ?? ''), 'industryRef')
        const query = themeWorkspaceQuery(url, new Set(['expectedRevision', 'asOf', 'maxItemsPerSection', 'maxCompaniesPerIndustry', 'maxResponseBytes']))
        await this.sendJson(response, 200, await service.getIndustryProjection({ ...query, themeRef }, industryRef)); return
      }
      if (pieces.length === 9 && pieces[5] === 'industries' && pieces[7] === 'companies') {
        const industryRef = themeWorkspaceRef(decodeSegment(pieces[6] ?? ''), 'industryRef')
        const companyRef = themeWorkspaceRef(decodeSegment(pieces[8] ?? ''), 'companyRef')
        const query = themeWorkspaceQuery(url, new Set(['expectedRevision', 'asOf', 'maxItemsPerSection', 'maxResponseBytes']))
        await this.sendJson(response, 200, await service.getCompanyProjection({ ...query, themeRef }, industryRef, companyRef)); return
      }
      throw new ApplicationServiceError('not_found', 'Theme Workspace route not found')
    }
    if (method === 'GET' && path.startsWith('/api/knowledge/topics/')) {
      const pieces = path.split('/')
      if (pieces.length !== 6 || !pieces[4] || (pieces[5] !== 'summary' && pieces[5] !== 'items')) throw new ApplicationServiceError('not_found', 'Knowledge topic route not found')
      const themeRef = decodeSegment(pieces[4])
      if (themeRef.length > 300) throw new ApplicationServiceError('invalid_input', 'themeRef is invalid or oversized')
      const service = this.runtime!.knowledgeTopicProjectionService
      if (pieces[5] === 'summary') {
        validateTopicQuery(url, new Set(['depth']))
        await this.sendJson(response, 200, await service.getSummary(themeRef, topicDepth(url) ?? 1)); return
      }
      validateTopicQuery(url, new Set(['kind', 'scope', 'depth', 'limit', 'cursor', 'expectedRevision', 'lifecycle', 'observationType', 'claimType', 'relationType']))
      const kindValue = topicQueryValue(url, 'kind')
      if (kindValue === undefined || !TOPIC_KINDS.has(kindValue as KnowledgeTopicKind)) throw new ApplicationServiceError('invalid_input', 'kind is required and must be supported')
      const scopeValue = topicQueryValue(url, 'scope')
      const cursor = topicQueryValue(url, 'cursor', 4_096)
      const lifecycle = topicQueryValue(url, 'lifecycle')
      const observationType = topicQueryValue(url, 'observationType')
      const claimType = topicQueryValue(url, 'claimType')
      const relationType = topicQueryValue(url, 'relationType')
      const depth = topicDepth(url)
      const limit = topicLimit(url)
      const expectedRevision = topicExpectedRevision(url)
      const input: KnowledgeTopicPageInput = {
        themeRef,
        kind: kindValue as KnowledgeTopicKind,
        ...(scopeValue === undefined ? {} : { scope: scopeValue as KnowledgeTopicScope }),
        ...(depth === undefined ? {} : { depth }),
        ...(limit === undefined ? {} : { limit }),
        ...(cursor === undefined ? {} : { cursor }),
        ...(expectedRevision === undefined ? {} : { expectedRevision }),
        ...([lifecycle, observationType, claimType, relationType].every((value) => value === undefined) ? {} : {
          filters: {
            ...(lifecycle === undefined ? {} : { lifecycle }),
            ...(observationType === undefined ? {} : { observationType }),
            ...(claimType === undefined ? {} : { claimType }),
            ...(relationType === undefined ? {} : { relationType }),
          } as KnowledgeTopicFilters,
        }),
      }
      await this.sendJson(response, 200, await service.listItems(input)); return
    }
    if ((method === 'GET' || method === 'POST') && (path === '/api/knowledge/search' || path === '/api/search-knowledge')) { const input = (method === 'GET' ? this.searchInputFromQuery(url) : await this.readJson(request)) as KnowledgeSearchInput; await this.sendJson(response, 200, await this.runtime!.knowledgeService.searchKnowledge(input)); return }
    if (method === 'GET' && (path === '/api/knowledge/object' || path === '/api/knowledge/get')) { await this.sendJson(response, 200, await this.runtime!.knowledgeService.getKnowledgeObject(url.searchParams.get('ref') ?? '', positiveInteger(url.searchParams.get('relatedLimit')))); return }
    if (method === 'GET' && path === '/api/knowledge/directory') { await this.sendJson(response, 200, await this.runtime!.knowledgeGraphService.getDirectoryProjection(positiveInteger(url.searchParams.get('limit')))); return }
    if (method === 'GET' && path === '/api/knowledge/graph') {
      const depthValue = url.searchParams.get('depth')
      const depth = depthValue === null ? undefined : depthValue === '1' || depthValue === '2' ? Number(depthValue) as 1 | 2 : Number.NaN
      const input: KnowledgeGraphProjectionInput = { rootRef: url.searchParams.get('rootRef') ?? url.searchParams.get('root') ?? '', ...(depth === undefined ? {} : { depth: depth as 1 | 2 }), ...(url.searchParams.has('maxNodes') ? { maxNodes: positiveInteger(url.searchParams.get('maxNodes')) } : {}), ...(url.searchParams.has('maxEdges') ? { maxEdges: positiveInteger(url.searchParams.get('maxEdges')) } : {}) }
      await this.sendJson(response, 200, await this.runtime!.knowledgeGraphService.getGraphProjection(input)); return
    }
    if (method === 'POST' && path === '/api/knowledge/object') { const input = await this.readJson(request); await this.sendJson(response, 200, await this.runtime!.knowledgeService.getKnowledgeObject(this.stringField(input, 'ref'), this.optionalPositive(input, 'relatedLimit'))); return }
    if (method === 'GET' && path.startsWith('/api/workflows/')) { const runId = decodeSegment(path.split('/')[3] ?? ''); const value = this.runtime!.workflowService.getWorkflowStatus(runId); if (!value) throw new ApplicationServiceError('not_found', 'Workflow run not found'); await this.sendJson(response, 200, value); return }
    if (method === 'GET' && path.startsWith('/api/production/raw-document-preview-v04/')) {
      const runId = decodeSegment(path.split('/')[4] ?? '')
      const workflow = this.runtime!.workflowService.getWorkflowStatus(runId)
      const preview = await this.runtime!.productionService.readRawDocumentKnowledgePreviewV04(runId)
      if (!workflow && !preview) throw new ApplicationServiceError('not_found', 'Raw-document preview not found')
      await this.sendJson(response, 200, { runId, workflow, preview: preview ?? null, committable: preview?.committable ?? false }); return
    }
    if (method === 'GET' && path === '/api/research-reports') { const service = this.runtime!.researchService; if (!service) throw new ApplicationServiceError('not_found', 'Research Reports are not configured'); await this.sendJson(response, 200, { reports: await service.listResearchReports(positiveInteger(url.searchParams.get('limit'))) }); return }
    if (method === 'GET' && path === '/api/research/workflows') { await this.sendJson(response, 200, { workflows: this.runtime!.services.researchDispatchService?.listWorkflowDefinitions() ?? [] }); return }
    if (method === 'GET' && path === '/api/research/bundles') { const service = this.runtime!.services.researchDispatchService; if (!service) throw new ApplicationServiceError('not_found', 'Research dispatch is not configured'); await this.sendJson(response, 200, { bundles: await service.listBundles(positiveInteger(url.searchParams.get('limit'))) }); return }
    if (method === 'GET' && path.startsWith('/api/research/bundles/')) { const service = this.runtime!.services.researchDispatchService; if (!service) throw new ApplicationServiceError('not_found', 'Research dispatch is not configured'); const bundle = await service.getBundle(decodeSegment(path.split('/')[4] ?? '')); if (bundle === undefined) throw new ApplicationServiceError('not_found', 'ResearchBundle not found'); await this.sendJson(response, 200, bundle); return }
    if (method === 'POST' && path === '/api/research/source-library/search') { const body = await this.readJson(request); const context = body.contextPolicy as { readonly sourceLibrary?: unknown } | undefined; if (context !== undefined && context.sourceLibrary !== true) { await this.sendJson(response, 200, { enabled: false, hits: [] }); return } if (!this.runtime!.mountedKnowledgeBaseRoot || !this.runtime!.services.sourceLibraryService) throw new ApplicationServiceError('no_kb_mounted', 'Source Library requires a mounted Knowledge Base'); const query = this.stringField(body, 'query', 2_000); const handle = await new KnowledgeBaseRegistry().mount(this.runtime!.mountedKnowledgeBaseRoot); const hits = await this.runtime!.services.sourceLibraryService.search(handle, { query, limit: body.limit === undefined ? undefined : this.optionalPositive(body, 'limit') }); await this.sendJson(response, 200, { enabled: true, hits }); return }
    if (method === 'POST' && path === '/api/research/dispatch') { await this.dispatchResearch(request, response); return }
    if (method === 'GET' && path.startsWith('/api/research-reports/')) { const reportId = decodeSegment(path.split('/')[3] ?? ''); const service = this.runtime!.researchService; if (!service) throw new ApplicationServiceError('not_found', 'Research Reports are not configured'); await this.sendJson(response, 200, await service.getResearchReport(reportId)); return }
    if (method === 'GET' && path === '/api/daily-briefs') { const service = this.runtime!.services.dailyIntelligenceService; if (!service) throw new ApplicationServiceError('not_found', 'Daily Intelligence is not configured'); await this.sendJson(response, 200, { briefs: await service.listBriefs(positiveInteger(url.searchParams.get('limit'))) }); return }
    if (method === 'GET' && path.startsWith('/api/daily-briefs/')) { const service = this.runtime!.services.dailyIntelligenceService; if (!service) throw new ApplicationServiceError('not_found', 'Daily Intelligence is not configured'); await this.sendJson(response, 200, await service.getBrief(decodeSegment(path.split('/')[3] ?? ''))); return }
    if (method === 'POST' && (path === '/api/workflows/cancel' || /^\/api\/workflows\/[^/]+\/cancel$/.test(path))) { const body = await this.readJson(request); const runId = path === '/api/workflows/cancel' ? this.stringField(body, 'runId') : decodeSegment(path.split('/')[3]!); await this.sendJson(response, 200, this.runtime!.workflowService.cancelWorkflow(runId)); return }
    if (method === 'GET' && (path === '/api/reviews' || path === '/api/review-cases')) { await this.sendJson(response, 200, await this.runtime!.reviewService.listOpenReviewCases(this.reviewInputFromQuery(url))); return }
    if (method === 'GET' && (path.startsWith('/api/reviews/') || path.startsWith('/api/review-cases/'))) { const pieces = path.split('/'); await this.sendJson(response, 200, await this.runtime!.reviewService.getReviewCase(decodeSegment(pieces[3] ?? ''), positiveInteger(url.searchParams.get('dependentLimit')))); return }
    if (method === 'POST' && /^\/api\/review-cases\/[^/]+\/decision$/.test(path)) {
      const body = await this.readJson(request)
      if (Object.keys(body).some((key) => !['decision', 'note'].includes(key))) throw new ApplicationServiceError('invalid_input', 'decision request accepts only decision and note')
      const decision = this.stringField(body, 'decision', 20)
      if (!['ACCEPT', 'REJECT', 'DEFER'].includes(decision)) throw new ApplicationServiceError('invalid_input', 'decision must be ACCEPT, REJECT, or DEFER')
      const note = this.optionalString(body, 'note', 1000)
      const reviewCaseId = decodeSegment(path.split('/')[3]!)
      const service = this.runtime!.services.thesisDecisionService
      if (!service) throw new ApplicationServiceError('no_kb_mounted', 'Thesis decisions require a mounted Schema 0.4 Knowledge Base')
      await this.sendJson(response, 200, await service.decide({ reviewCaseId, decision: decision as 'ACCEPT' | 'REJECT' | 'DEFER', ...(note === undefined ? {} : { note }) })); return
    }
    if (method === 'GET' && (path === '/api/conversations' || path === '/api/conversation/list')) { await this.sendJson(response, 200, { conversations: await this.runtime!.sessionRuntime.listConversations() }); return }
    if (method === 'GET' && (path === '/api/conversations/current' || path === '/api/conversation/current')) { await this.sendJson(response, 200, this.sessionState()); return }
    if (method === 'GET' && (path === '/api/conversations/messages' || path === '/api/conversation/messages')) { await this.sendJson(response, 200, { conversationId: this.sessionState().conversationId, messages: this.runtime!.sessionRuntime.getCurrentMessages() }); return }
    if (method === 'POST' && (path === '/api/conversations/new' || path === '/api/conversation/new')) { const body = await this.readJson(request); await this.sendJson(response, 200, await this.runtime!.sessionRuntime.createConversation(this.optionalString(body, 'name', MAX_SESSION_NAME_LENGTH))); return }
    if (method === 'POST' && (path === '/api/conversations/switch' || path === '/api/conversation/switch')) { const body = await this.readJson(request); await this.sendJson(response, 200, await this.runtime!.sessionRuntime.switchConversation(this.stringField(body, 'conversationId'))); return }
    if (method === 'POST' && (path === '/api/conversations/prompt' || path === '/api/conversation/prompt')) { await this.acceptConversationCommand(request, response, 'prompt'); return }
    if (method === 'POST' && (path === '/api/conversations/steer' || path === '/api/conversation/steer')) { await this.acceptConversationCommand(request, response, 'steer'); return }
    if (method === 'POST' && (path === '/api/conversations/follow_up' || path === '/api/conversation/follow_up' || path === '/api/conversations/follow-up' || path === '/api/conversation/follow-up')) { await this.acceptConversationCommand(request, response, 'followUp'); return }
    if (method === 'POST' && (path === '/api/conversations/abort' || path === '/api/conversation/abort')) { await this.runtime!.sessionRuntime.abort(); await this.sendJson(response, 200, { accepted: true, aborted: true, conversationId: this.sessionState().conversationId }); return }
    if (method === 'POST' && (path === '/api/attachments' || path === '/api/attachments/upload')) { const contentType = request.headers['content-type']; if (typeof contentType !== 'string') throw new ApplicationServiceError('invalid_input', 'multipart Content-Type is required'); const length = Number(request.headers['content-length']); if (Number.isFinite(length) && length > (this.attachmentService?.maxBytes ?? DEFAULT_MAX_ATTACHMENT_BYTES) + 1024 * 1024) throw new ApplicationServiceError('invalid_input', 'attachment request is too large'); const attachment = await this.attachmentService!.upload(request, contentType); await this.sendJson(response, 201, { attachment }); return }
    if (method === 'GET' && path.startsWith('/api/attachments/')) { const pieces = path.split('/'); const id = decodeSegment(pieces[3] ?? ''); if (pieces[4] === 'content') { await this.streamAttachment(response, id); return } await this.sendJson(response, 200, { attachment: await this.attachmentService!.getAttachment(id) }); return }
    if (method === 'POST' && (path === '/api/production/ingest' || path === '/api/production/ingest-document' || path === '/api/production/start-ingest' || path === '/api/workflows/ingest' || path === '/api/ingest-document' || path === '/api/ingestion')) { await this.startIngestion(request, response); return }
    if (method === 'POST' && path === '/api/production/raw-document-preview-v04') { await this.startRawDocumentPreviewV04(request, response); return }
    if (method === 'POST' && path === '/api/production/raw-document-preview-v04/accept') { await this.acceptRawDocumentPreviewV04(request, response); return }
    if (method === 'POST' && path === '/api/production/thesis-lifecycle/create') { await this.startThesisLifecycleCreate(request, response); return }
    if (method === 'POST' && path === '/api/production/thesis-lifecycle/refresh') { await this.startThesisLifecycleRefresh(request, response); return }
    if (method === 'POST' && (path === '/api/production/research-company' || path === '/api/research-company')) { await this.startCompanyResearch(request, response); return }
    if (method === 'POST' && (path === '/api/production/research-industry' || path === '/api/research-industry')) { await this.startIndustryResearch(request, response); return }
    if (method === 'POST' && (path === '/api/production/review-earnings' || path === '/api/review-earnings')) { await this.startEarningsReview(request, response); return }
    if (method === 'POST' && (path === '/api/production/analyze-valuation' || path === '/api/analyze-valuation')) { await this.startValuation(request, response); return }
      if (method === 'POST' && (path === '/api/production/research-event' || path === '/api/research-event')) { await this.startEventResearch(request, response); return }
      if (method === 'POST' && (path === '/api/production/red-team-thesis' || path === '/api/red-team-thesis')) { await this.startThesisRedTeam(request, response); return }
    if (method === 'POST' && (path === '/api/daily-briefs/morning' || path === '/api/daily-briefs/evening')) { await this.startDailyBrief(request, response, path.endsWith('/morning') ? 'morning' : 'evening'); return }
    this.sendError(response, new ApplicationServiceError('not_found', 'Runtime route not found'))
  }

  private async bootstrap(response: ServerResponse): Promise<void> {
    const session = this.sessionState()
    const conversations = await this.runtime!.sessionRuntime.listConversations()
    let knowledgeBase: unknown = undefined
    let openReviewCases: number | undefined
    let knowledgeError: { readonly code: string; readonly error: string } | undefined
    try { knowledgeBase = await this.runtime!.knowledgeService.status(); openReviewCases = await this.runtime!.reviewService.countOpenReviewCases() } catch (error) { knowledgeError = safeError(error) }
    await this.sendJson(response, 200, { runtime: this.runtimeInfo, origin: this.runtimeInfo!.origin, runtimeToken: this.runtimeInfo!.runtimeToken, session, conversations, ...(knowledgeBase === undefined ? {} : { knowledgeBase }), ...(openReviewCases === undefined ? {} : { openReviewCases }), ...(knowledgeError === undefined ? {} : { knowledgeError }) })
  }

  private async settingsResponse(): Promise<unknown> {
    const cwd = this.options.cwd ?? process.cwd()
    this.knowledgeBaseCatalog = await discoverKnowledgeBases({ cwd, workspaceRoot: this.runtime!.workspaceRoot, configuredRoot: this.options.knowledgeBaseCatalogRoot ?? configuredKnowledgeBaseCatalogRoot(cwd), explicitlyMountedRoot: this.explicitlyConfiguredKnowledgeBaseRoot() })
    const registeredKnowledgeBases = await listRegisteredKnowledgeBases(cwd, this.runtime!.workspaceRoot)
    const appManagedProviderIds = new Set((await loadModelConnections(cwd)).map((connection) => connection.providerId))
    const sessionModel = this.settings.model ?? this.sessionState().model
    const model = sessionModel ?? { provider: '', modelId: '' }
    const knowledgeBase = this.runtime!.mountedKnowledgeBaseRoot === undefined ? undefined : await this.runtime!.knowledgeService.status().catch(() => undefined)
    const models = await listReasoningModelCandidates(this.runtime!.modelRuntime)
    return {
      revision: this.settings.revision,
      model,
      models,
      modelProviders: listSafeModelConnectionStatus(this.runtime!.modelRuntime, appManagedProviderIds),
      ...(knowledgeBase === undefined ? {} : { knowledgeBase }),
      knowledgeBases: this.knowledgeBaseCatalog.map((choice) => this.publicKnowledgeBase(choice)),
      registeredKnowledgeBases: registeredKnowledgeBases.map((choice) => this.publicRegistration(choice)),
      ...(this.knowledgeBaseSelectionError === undefined ? {} : { knowledgeBaseError: this.knowledgeBaseSelectionError }),
      ...(this.modelSelectionError === undefined ? {} : { modelError: this.modelSelectionError }),
    }
  }

  private publicKnowledgeBase(choice: ResolvedKnowledgeBase): { readonly knowledgeBaseId: string; readonly schemaVersion: string; readonly status: string; readonly revision: number } {
    return { knowledgeBaseId: choice.knowledgeBaseId, schemaVersion: choice.schemaVersion, status: choice.status, revision: choice.revision }
  }

  private publicRegistration(choice: RegisteredKnowledgeBase): { readonly knowledgeBaseId: string; readonly label: string; readonly schemaVersion: string; readonly status: string; readonly revision: number; readonly available: boolean } {
    return { knowledgeBaseId: choice.knowledgeBaseId, label: choice.label, schemaVersion: choice.schemaVersion, status: choice.status, revision: choice.revision, available: choice.available }
  }

  private async changeKnowledgeBase(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await this.readJson(request)
    if (Object.keys(body).some((field) => field !== 'knowledgeBaseId')) throw new ApplicationServiceError('invalid_input', 'Knowledge Base settings accept only knowledgeBaseId')
    const requestedId = Object.prototype.hasOwnProperty.call(body, 'knowledgeBaseId') ? body.knowledgeBaseId : null
    if (requestedId !== null && typeof requestedId !== 'string') throw new ApplicationServiceError('invalid_input', 'knowledgeBaseId must be a catalog identifier or null')
    if (!this.ownsRuntime) throw new ApplicationServiceError('conflict', 'Knowledge Base selection is unavailable for a caller-owned Runtime')
    this.assertSettingsChangeAllowed('Knowledge Base')

    const cwd = this.options.cwd ?? process.cwd()
    const catalog = await discoverKnowledgeBases({ cwd, workspaceRoot: this.runtime!.workspaceRoot, configuredRoot: this.options.knowledgeBaseCatalogRoot ?? configuredKnowledgeBaseCatalogRoot(cwd), explicitlyMountedRoot: this.explicitlyConfiguredKnowledgeBaseRoot() })
    const target = requireKnowledgeBaseChoice(catalog, requestedId)
    const currentRoot = this.runtime!.mountedKnowledgeBaseRoot
    const canonicalCurrentRoot = currentRoot === undefined ? undefined : await realpath(currentRoot).catch(() => resolve(currentRoot))
    if (target?.root.toLocaleLowerCase() === canonicalCurrentRoot?.toLocaleLowerCase() || (target === undefined && currentRoot === undefined)) {
      const persisted = await writeRuntimeSettings(cwd, { ...this.settings, revision: this.settings.revision + 1, knowledgeBaseId: requestedId as string | null })
      this.settings = persisted
      this.knowledgeBaseCatalog = catalog
      this.knowledgeBaseSelectionError = undefined
      await this.sendJson(response, 200, await this.settingsResponse())
      return
    }

    const currentRuntime = this.runtime!
    const selected = this.modelSelectionError ? null : this.settings.model
    let activeModel = this.options.model
    if (selected === undefined && this.modelSelectionError === undefined) {
      const currentSelection = this.sessionState().model
      if (currentSelection) activeModel = currentRuntime.modelRuntime.getModel(currentSelection.provider, currentSelection.modelId)
    }
    let candidateRuntime: ResearchHubApplicationRuntime | undefined
    let candidateUnsubscribe: (() => void) | undefined
    try {
      candidateRuntime = await this.createApplicationRuntime(target?.root, activeModel, selected ?? null, false)
      const nextAttachmentService = new AttachmentService({ workspaceRoot: candidateRuntime.workspaceRoot, forbiddenRoot: candidateRuntime.mountedKnowledgeBaseRoot, maxBytes: DEFAULT_MAX_ATTACHMENT_BYTES })
      if (candidateRuntime.mountedKnowledgeBaseRoot !== undefined) await nextAttachmentService.assertCompatibleWithKnowledgeBase(candidateRuntime.mountedKnowledgeBaseRoot)
      const stagedRuntime = candidateRuntime
      candidateUnsubscribe = stagedRuntime.sessionRuntime.subscribeClientEvents((event) => { if (this.runtime === stagedRuntime) this.eventStream.publish(event) })
      const persisted = await writeRuntimeSettings(cwd, { ...this.settings, revision: this.settings.revision + 1, knowledgeBaseId: requestedId as string | null })

      try { this.unsubscribeSessionEvents?.() } catch { /* the staged subscription is already ready */ }
      this.runtime = candidateRuntime
      candidateRuntime = undefined
      this.attachmentService = nextAttachmentService
      this.knowledgeBaseCatalog = catalog
      this.knowledgeBaseSelectionError = undefined
      this.settings = persisted
      this.unsubscribeSessionEvents = candidateUnsubscribe
      candidateUnsubscribe = undefined
      try { await currentRuntime.close() } catch { /* The replacement Runtime is active; preserve the completed mount change. */ }
      if (this.options.startDailyScheduler !== false) { try { this.runtime.startDailyScheduler() } catch { /* the committed Runtime remains active; scheduler failure does not roll back settings */ } }
    } catch (error) {
      try { candidateUnsubscribe?.() } catch { /* preserve the original replacement error */ }
      if (candidateRuntime) {
        try { await candidateRuntime.close() } catch { /* preserve the original replacement error */ }
      }
      throw error
    }
    await this.sendJson(response, 200, await this.settingsResponse())
  }

  private assertSettingsChangeAllowed(label: string): void {
    if (!this.ownsRuntime) throw new ApplicationServiceError('conflict', `${label} selection is unavailable for a caller-owned Runtime`)
    if (this.modelLoginFlows.hasActiveFlow()) throw new ApplicationServiceError('conflict', 'Model login is in progress')
    if (this.inFlightApiRequests > 0 || this.backgroundOperations.size > 0 || this.runtime!.workflowService.hasActiveRuns()) throw new ApplicationServiceError('conflict', `${label} cannot change while a request or workflow is active`)
    const session = this.sessionState()
    if (session.isStreaming || session.pendingMessageCount > 0) throw new ApplicationServiceError('conflict', `${label} cannot change while a conversation is active`)
  }

  private async changeModel(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await this.readJson(request)
    if (Object.keys(body).some((field) => !['provider', 'modelId'].includes(field)) || typeof body.provider !== 'string' || typeof body.modelId !== 'string') throw new ApplicationServiceError('invalid_input', 'Model settings require provider and modelId')
    this.assertSettingsChangeAllowed('Model')
    const selection = { provider: body.provider, modelId: body.modelId }
    let model
    try { model = await validateReasoningModelSelection(this.runtime!.modelRuntime, selection) }
    catch (error) {
      if (error instanceof ReasoningModelSelectionError) throw new ApplicationServiceError(error.code === 'invalid_input' ? 'invalid_input' : 'conflict', error.message)
      throw error
    }
    if (!this.ownsRuntime) throw new ApplicationServiceError('conflict', 'Model selection is unavailable for a caller-owned Runtime')
    const currentRuntime = this.runtime!
    const same = this.modelSelectionError === undefined && this.settings.model?.provider === selection.provider && this.settings.model.modelId === selection.modelId && this.sessionState().model?.provider === selection.provider && this.sessionState().model?.modelId === selection.modelId
    if (same) {
      this.settings = await writeRuntimeSettings(this.options.cwd ?? process.cwd(), { ...this.settings, revision: this.settings.revision + 1, model: selection })
      this.modelSelectionError = undefined
      await this.sendJson(response, 200, await this.settingsResponse())
      return
    }
    let candidateRuntime: ResearchHubApplicationRuntime | undefined
    let candidateUnsubscribe: (() => void) | undefined
    try {
      candidateRuntime = await this.createApplicationRuntime(currentRuntime.mountedKnowledgeBaseRoot, model, selection, false, true)
      const stagedRuntime = candidateRuntime
      candidateUnsubscribe = stagedRuntime.sessionRuntime.subscribeClientEvents((event) => { if (this.runtime === stagedRuntime) this.eventStream.publish(event) })
      const persisted = await writeRuntimeSettings(this.options.cwd ?? process.cwd(), { ...this.settings, revision: this.settings.revision + 1, model: selection })
      try { this.unsubscribeSessionEvents?.() } catch { /* the staged subscription is ready */ }
      this.runtime = candidateRuntime
      candidateRuntime = undefined
      this.unsubscribeSessionEvents = candidateUnsubscribe
      candidateUnsubscribe = undefined
      this.settings = persisted
      this.modelSelectionError = undefined
      try { await currentRuntime.close() } catch { /* the new model runtime is active */ }
      if (this.options.startDailyScheduler !== false) { try { this.runtime.startDailyScheduler() } catch { /* the committed Runtime remains active; scheduler failure does not roll back settings */ } }
    } catch (error) {
      try { candidateUnsubscribe?.() } catch { /* preserve the original error */ }
      if (candidateRuntime) { try { await candidateRuntime.close() } catch { /* preserve the original error */ } }
      throw error
    }
    await this.sendJson(response, 200, await this.settingsResponse())
  }

  private async status(): Promise<unknown> { return { knowledgeBase: await this.runtime!.knowledgeService.status(), openReviewCases: await this.runtime!.reviewService.countOpenReviewCases() } }
  private sessionState(): CurrentSessionState { return this.runtime!.sessionRuntime.getCurrentState() }

  private searchInputFromQuery(url: URL): { readonly query: string; readonly entityType?: string; readonly limit?: number } { const limit = positiveInteger(url.searchParams.get('limit')); return { query: url.searchParams.get('query') ?? '', ...(url.searchParams.has('entityType') ? { entityType: url.searchParams.get('entityType')! } : {}), ...(limit === undefined ? {} : { limit }) } }
  private reviewInputFromQuery(url: URL): ReviewCaseListInput { const limit = positiveInteger(url.searchParams.get('limit')); return { ...(limit === undefined ? {} : { limit }), ...(url.searchParams.has('actionability') ? { actionability: url.searchParams.get('actionability')! as ReviewCaseListInput['actionability'] } : {}), ...(url.searchParams.has('category') ? { category: url.searchParams.get('category')! } : {}), ...(url.searchParams.has('producerRunId') ? { producerRunId: url.searchParams.get('producerRunId')! } : {}) } }

  private async acceptConversationCommand(request: IncomingMessage, response: ServerResponse, operation: 'prompt' | 'steer' | 'followUp'): Promise<void> {
    const body = await this.readJson(request)
    const text = this.stringField(body, 'text', MAX_MESSAGE_LENGTH) || this.stringField(body, 'prompt', MAX_MESSAGE_LENGTH)
    if (text.trim() === '') throw new ApplicationServiceError('invalid_input', 'conversation text is required')
    this.ensureRunning()
    const conversationId = this.runtime!.sessionRuntime.getCurrentState().conversationId
    const runId = randomUUID()
    if (operation === 'prompt') {
      const bundleRunId = this.optionalString(body, 'researchBundleId', 160)
      let policy: ResearchHubRequestPolicy | undefined
      if (body.researchPolicy !== undefined) {
        if (!body.researchPolicy || typeof body.researchPolicy !== 'object' || Array.isArray(body.researchPolicy)) throw new ApplicationServiceError('invalid_input', 'researchPolicy must be an object')
        const researchPolicy = body.researchPolicy as Record<string, unknown>
        const request = normalizeResearchRequest({ query: text, contextPolicy: researchPolicy.contextPolicy, persistencePolicy: researchPolicy.persistencePolicy })
        policy = { ...request.contextPolicy, ...request.persistencePolicy }
      }
      const beforeMessageCount = this.runtime!.sessionRuntime.getCurrentMessages().length
      const researchContext = bundleRunId === undefined ? undefined : await this.runtime!.services.researchDispatchService?.getSessionResearchContext(bundleRunId)
      const started = this.runtime!.sessionRuntime.startPrompt(text, policy, researchContext)
      await started.accepted
      const completion = started.completion.then(async () => {
        if (bundleRunId === undefined) return
        const assistantText = this.runtime!.sessionRuntime.getCurrentMessages().slice(beforeMessageCount).filter((message) => message.role === 'assistant').map((message) => message.content).at(-1) ?? ''
        await this.runtime!.services.researchDispatchService?.completeSessionResearch(bundleRunId, assistantText)
      })
      this.trackBackground(completion, () => this.runtime!.sessionRuntime.abort())
    } else {
      const command = operation === 'steer' ? this.runtime!.sessionRuntime.steer(text) : this.runtime!.sessionRuntime.followUp(text)
      await command
      this.trackBackground(command, () => this.runtime!.sessionRuntime.abort())
    }
    await this.sendJson(response, 202, { accepted: true, conversationId, run: { runId, operation } })
  }

  private async startIngestion(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await this.readJson(request)
    this.ensureRunning()
    const attachmentId = this.optionalString(body, 'attachmentId', 120)
    let input: IngestDocumentInput
    if (attachmentId !== undefined) {
      const attachment = await this.attachmentService!.getAttachment(attachmentId)
      input = { workflowRunId: randomUUID(), workspaceFile: await this.attachmentService!.getWorkspaceFileReference(attachmentId), originalFilename: attachment.filename, mediaType: attachment.mediaType, instructions: this.optionalString(body, 'instructions', MAX_MESSAGE_LENGTH), sourceMetadata: this.sourceMetadata(body) }
    } else {
      const text = this.optionalString(body, 'text', 2_000_000)
      if (text === undefined) throw new ApplicationServiceError('invalid_input', 'attachmentId or text is required')
      input = { workflowRunId: randomUUID(), text, originalFilename: this.optionalString(body, 'originalFilename', 255), mediaType: this.optionalString(body, 'mediaType', 120), instructions: this.optionalString(body, 'instructions', MAX_MESSAGE_LENGTH), sourceMetadata: this.sourceMetadata(body) }
    }
    this.ensureRunning()
    const controller = new AbortController()
    const started = this.runtime!.productionService.startIngestDocument(input, controller.signal)
    this.trackBackground(started.completion, () => { controller.abort() })
    await this.sendJson(response, 202, { accepted: true, runId: started.runId, workflow: this.runtime!.workflowService.getWorkflowStatus(started.runId) })
  }
  private async startRawDocumentPreviewV04(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await this.readJson(request)
    this.ensureRunning()
    const allowed = ['workflowRunId', 'attachmentId', 'text', 'originalFilename', 'mediaType', 'instructions', 'sourceMetadata', 'rights']
    if (Object.keys(body).some((key) => !allowed.includes(key))) throw new ApplicationServiceError('invalid_input', 'V0.4 raw-document preview contains unsupported fields')
    const attachmentId = this.optionalString(body, 'attachmentId', 120)
    const text = this.optionalString(body, 'text', 2_000_000)
    if ((attachmentId === undefined) === (text === undefined)) throw new ApplicationServiceError('invalid_input', 'Exactly one of attachmentId or text is required')
    const workflowRunId = this.optionalString(body, 'workflowRunId', 80) ?? randomUUID()
    const sourceMetadata = this.rawDocumentMetadataV04(body.sourceMetadata)
    const rights = this.rawDocumentRightsV04(body.rights)
    let input: RawDocumentPreviewV04Input
    if (attachmentId !== undefined) {
      const attachment = await this.attachmentService!.getAttachment(attachmentId)
      input = { workflowRunId, workspaceFile: await this.attachmentService!.getWorkspaceFileReference(attachmentId), originalFilename: attachment.filename, mediaType: attachment.mediaType, sourceMetadata, rights, ...(this.optionalString(body, 'instructions', MAX_MESSAGE_LENGTH) === undefined ? {} : { instructions: this.optionalString(body, 'instructions', MAX_MESSAGE_LENGTH) }) }
    } else {
      input = { workflowRunId, text: text!, sourceMetadata, rights, ...(this.optionalString(body, 'originalFilename', 255) === undefined ? {} : { originalFilename: this.optionalString(body, 'originalFilename', 255) }), ...(this.optionalString(body, 'mediaType', 120) === undefined ? {} : { mediaType: this.optionalString(body, 'mediaType', 120) }), ...(this.optionalString(body, 'instructions', MAX_MESSAGE_LENGTH) === undefined ? {} : { instructions: this.optionalString(body, 'instructions', MAX_MESSAGE_LENGTH) }) }
    }
    this.ensureRunning()
    const controller = new AbortController()
    const started = this.runtime!.productionService.startRawDocumentKnowledgePreviewV04(input, controller.signal)
    this.trackBackground(started.completion, () => { controller.abort(); try { this.runtime!.workflowService.cancelWorkflow(started.runId) } catch { /* workflow may already be terminal */ } })
    await this.sendJson(response, 202, { accepted: true, runId: started.runId, committable: false, workflow: this.runtime!.workflowService.getWorkflowStatus(started.runId) })
  }
  private async acceptRawDocumentPreviewV04(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await this.readJson(request)
    if (Object.keys(body).some((key) => !['previewWorkflowRunId', 'acceptedCandidateIds'].includes(key))) throw new ApplicationServiceError('invalid_input', 'Candidate acceptance contains unsupported fields')
    const previewWorkflowRunId = this.stringField(body, 'previewWorkflowRunId', 80)
    if (!Array.isArray(body.acceptedCandidateIds) || body.acceptedCandidateIds.length > 4096 || body.acceptedCandidateIds.some((item) => typeof item !== 'string' || item.length > 200)) throw new ApplicationServiceError('invalid_input', 'acceptedCandidateIds must contain at most 4096 bounded candidate IDs')
    const result = await this.runtime!.productionService.acceptRawDocumentV04Candidates({ previewWorkflowRunId, acceptedCandidateIds: body.acceptedCandidateIds as string[] })
    const successful = ['committed', 'already_committed', 'no_changes'].includes(result.status)
    await this.sendJson(response, result.status === 'stale_revision' || result.status === 'incompatible_schema' ? 409 : successful ? 200 : 422, result)
  }
  private async startThesisLifecycleRefresh(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const service = this.runtime!.researchService
    if (!service) throw new ApplicationServiceError('failed', 'Thesis lifecycle refresh is not configured for this runtime')
    const body = await this.readJson(request)
    if (Object.keys(body).some((key) => !['thesisRef', 'asOf', 'evidenceRefs'].includes(key))) throw new ApplicationServiceError('invalid_input', 'Thesis refresh accepts only thesisRef, asOf, and evidenceRefs')
    this.ensureRunning()
    const thesisRef = this.stringField(body, 'thesisRef', 500)
    if (!/^thesis:[A-Za-z0-9._-]+$/.test(thesisRef)) throw new ApplicationServiceError('invalid_input', 'thesisRef must be an exact canonical Thesis reference')
    const asOf = this.stringField(body, 'asOf', 100)
    if (!Number.isFinite(Date.parse(asOf))) throw new ApplicationServiceError('invalid_input', 'asOf must be a valid date-time')
    let evidenceRefs: string[] | undefined
    if (body.evidenceRefs !== undefined) {
      if (!Array.isArray(body.evidenceRefs) || body.evidenceRefs.length > 80 || body.evidenceRefs.some((ref) => typeof ref !== 'string' || !/^(observation|claim):[A-Za-z0-9._-]+$/.test(ref))) throw new ApplicationServiceError('invalid_input', 'evidenceRefs must contain at most 80 canonical Observation or Claim references')
      evidenceRefs = [...new Set(body.evidenceRefs as string[])]
    }
    const controller = new AbortController()
    const started = service.startThesisLifecycleRefresh({ thesisRef, asOf, ...(evidenceRefs === undefined ? {} : { evidenceRefs }) }, controller.signal)
    this.trackBackground(started.completion, () => controller.abort())
    await this.sendJson(response, 202, { accepted: true, runId: started.runId, workflow: this.runtime!.workflowService.getWorkflowStatus(started.runId) })
  }
  private async startThesisLifecycleCreate(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const service = this.runtime!.researchService
    if (!service) throw new ApplicationServiceError('failed', 'Thesis lifecycle CREATE is not configured for this runtime')
    const body = await this.readJson(request)
    if (Object.keys(body).some((key) => !['workflowRunId', 'companyRef', 'thesisTitle', 'narrative', 'evidenceRefs', 'asOf'].includes(key))) throw new ApplicationServiceError('invalid_input', 'Thesis CREATE accepts only workflowRunId, companyRef, thesisTitle, narrative, evidenceRefs, and asOf')
    this.ensureRunning()
    const workflowRunId = this.optionalString(body, 'workflowRunId', 96) ?? `thesis-create-${randomUUID()}`
    const companyRef = this.stringField(body, 'companyRef', 240)
    if (!/^entity:[A-Za-z0-9][A-Za-z0-9._-]*$/.test(companyRef)) throw new ApplicationServiceError('invalid_input', 'companyRef must be an exact canonical company Entity reference')
    const thesisTitle = this.stringField(body, 'thesisTitle', 240)
    const narrative = this.stringField(body, 'narrative', 8_000)
    const asOf = this.stringField(body, 'asOf', 100)
    if (!Number.isFinite(Date.parse(asOf))) throw new ApplicationServiceError('invalid_input', 'asOf must be a valid date-time')
    if (!Array.isArray(body.evidenceRefs) || body.evidenceRefs.length === 0 || body.evidenceRefs.length > 40 || body.evidenceRefs.some((ref) => typeof ref !== 'string' || !/^(claim|observation):[A-Za-z0-9][A-Za-z0-9._-]*$/.test(ref))) throw new ApplicationServiceError('invalid_input', 'evidenceRefs must contain 1 to 40 canonical Claim or Observation references')
    const evidenceRefs = body.evidenceRefs as string[]
    if (new Set(evidenceRefs).size !== evidenceRefs.length) throw new ApplicationServiceError('invalid_input', 'evidenceRefs must be unique')
    const controller = new AbortController()
    const started = service.startThesisLifecycleCreate({ workflowRunId, companyRef: companyRef as `entity:${string}`, thesisTitle, narrative, evidenceRefs: evidenceRefs as (`claim:${string}` | `observation:${string}`)[], asOf }, controller.signal)
    this.trackBackground(started.completion, () => controller.abort())
    await this.sendJson(response, 202, { accepted: true, runId: started.runId, workflow: this.runtime!.workflowService.getWorkflowStatus(started.runId) })
  }
  private async startCompanyResearch(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const service = this.runtime!.researchService
    if (!service) throw new ApplicationServiceError('failed', 'Company Research is not configured for this runtime')
    const body = await this.readJson(request); this.ensureRunning(); const symbol = this.stringField(body, 'symbol', 6); const name = this.optionalString(body, 'name', 500); const exchange = this.optionalString(body, 'exchange', 50); const asOf = this.optionalString(body, 'asOf', 100); const input: ResearchCompanyInput = { workflowRunId: randomUUID(), symbol, ...(name === undefined ? {} : { name }), ...(exchange === undefined ? {} : { exchange }), ...(asOf === undefined ? {} : { asOf }) }; const controller = new AbortController(); const started = service.startResearchCompany(input, controller.signal); this.trackBackground(started.completion, () => controller.abort()); await this.sendJson(response, 202, { accepted: true, runId: started.runId, workflow: this.runtime!.workflowService.getWorkflowStatus(started.runId) })
  }
  private async startIndustryResearch(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const service = this.runtime!.researchService; if (!service) throw new ApplicationServiceError('failed', 'Industry Research is not configured for this runtime')
    const body = await this.readJson(request); this.ensureRunning(); const workflowRunId = this.optionalString(body, 'workflowRunId', 120) ?? randomUUID(); const name = this.stringField(body, 'name', 200); const aliases = body.aliases === undefined ? undefined : this.stringArray(body, 'aliases', 8, 120); const searchTerms = body.searchTerms === undefined ? undefined : this.stringArray(body, 'searchTerms', 8, 120); const canonicalRef = this.optionalString(body, 'canonicalRef', 200); const asOf = this.optionalString(body, 'asOf', 100); const maxSources = body.maxSources === undefined ? undefined : this.integerField(body, 'maxSources', 1, 50); const maxEvidencePerModule = body.maxEvidencePerModule === undefined ? undefined : this.integerField(body, 'maxEvidencePerModule', 1, 12); const input: IndustryResearchInput = { workflowRunId, name, ...(aliases === undefined ? {} : { aliases }), ...(searchTerms === undefined ? {} : { searchTerms }), ...(canonicalRef === undefined ? {} : { canonicalRef }), ...(asOf === undefined ? {} : { asOf }), ...(maxSources === undefined ? {} : { maxSources }), ...(maxEvidencePerModule === undefined ? {} : { maxEvidencePerModule }) }; const controller = new AbortController(); const started = service.startIndustryResearch(input, controller.signal); this.trackBackground(started.completion, () => controller.abort()); await this.sendJson(response, 202, { accepted: true, runId: started.runId, workflow: this.runtime!.workflowService.getWorkflowStatus(started.runId) })
  }
  private async startEarningsReview(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const service = this.runtime!.researchService
    if (!service) throw new ApplicationServiceError('failed', 'Earnings Review is not configured for this runtime')
    const body = await this.readJson(request); this.ensureRunning(); const symbol = this.stringField(body, 'symbol', 6); const name = this.optionalString(body, 'name', 500); const exchange = this.optionalString(body, 'exchange', 50); const asOf = this.optionalString(body, 'asOf', 100); const workflowRunId = this.optionalString(body, 'workflowRunId', 120) ?? randomUUID(); const fiscalYear = this.integerField(body, 'fiscalYear', 1900, 2200); const period = this.stringField(body, 'period', 2) as EarningsReviewInput['period']; const input: EarningsReviewInput = { workflowRunId, symbol, fiscalYear, period, ...(name === undefined ? {} : { name }), ...(exchange === undefined ? {} : { exchange }), ...(asOf === undefined ? {} : { asOf }) }; const controller = new AbortController(); const started = service.startEarningsReview(input, controller.signal); this.trackBackground(started.completion, () => controller.abort()); await this.sendJson(response, 202, { accepted: true, runId: started.runId, workflow: this.runtime!.workflowService.getWorkflowStatus(started.runId) })
  }
  private async startValuation(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const service = this.runtime!.researchService
    if (!service) throw new ApplicationServiceError('failed', 'Valuation is not configured for this runtime')
    const body = await this.readJson(request); this.ensureRunning(); const symbol = this.stringField(body, 'symbol', 6); const name = this.optionalString(body, 'name', 500); const exchange = this.optionalString(body, 'exchange', 50); const asOf = this.optionalString(body, 'asOf', 100); const workflowRunId = this.optionalString(body, 'workflowRunId', 120) ?? randomUUID(); const targetFiscalYear = body.targetFiscalYear === undefined ? undefined : this.integerField(body, 'targetFiscalYear', 1900, 2200); const rawMethods = body.methods; if (rawMethods !== undefined && (!Array.isArray(rawMethods) || rawMethods.some((method) => typeof method !== 'string' || !['PE', 'PB', 'EV_EBITDA'].includes(method)))) throw new ApplicationServiceError('invalid_input', 'methods must contain only PE, PB, or EV_EBITDA'); const methods = rawMethods === undefined ? undefined : rawMethods as ValuationMethod[]; const input: ValuationInput = { workflowRunId, symbol, ...(name === undefined ? {} : { name }), ...(exchange === undefined ? {} : { exchange }), ...(asOf === undefined ? {} : { asOf }), ...(methods === undefined ? {} : { methods }), ...(targetFiscalYear === undefined ? {} : { targetFiscalYear }) }; const controller = new AbortController(); const started = service.startValuation(input, controller.signal); this.trackBackground(started.completion, () => controller.abort()); await this.sendJson(response, 202, { accepted: true, runId: started.runId, workflow: this.runtime!.workflowService.getWorkflowStatus(started.runId) })
  }
    private async startEventResearch(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const service = this.runtime!.researchService
    if (!service) throw new ApplicationServiceError('failed', 'Event Research is not configured for this runtime')
    const body = await this.readJson(request); this.ensureRunning(); const symbol = this.stringField(body, 'symbol', 6); const name = this.optionalString(body, 'name', 500); const exchange = this.optionalString(body, 'exchange', 50); const asOf = this.optionalString(body, 'asOf', 100); const workflowRunId = this.optionalString(body, 'workflowRunId', 120) ?? randomUUID(); const rawAnchor = body.anchor; if (!rawAnchor || typeof rawAnchor !== 'object' || Array.isArray(rawAnchor)) throw new ApplicationServiceError('invalid_input', 'anchor is required'); const anchor = rawAnchor as Record<string, unknown>; const kind = this.stringField(anchor, 'kind', 20) as EventAnchor['kind']; if (!['daily_signal', 'article', 'url', 'user_event'].includes(kind)) throw new ApplicationServiceError('invalid_input', 'anchor kind is invalid'); let inputAnchor: EventAnchor
    if (kind === 'daily_signal') inputAnchor = { kind, signalId: this.stringField(anchor, 'signalId', 200) }
    else if (kind === 'article') inputAnchor = { kind, url: this.stringField(anchor, 'url', 2_048), ...(this.optionalString(anchor, 'title', 500) === undefined ? {} : { title: this.optionalString(anchor, 'title', 500) }), ...(this.optionalString(anchor, 'publishedAt', 100) === undefined ? {} : { publishedAt: this.optionalString(anchor, 'publishedAt', 100) }), ...(this.optionalString(anchor, 'content', 50_000) === undefined ? {} : { content: this.optionalString(anchor, 'content', 50_000) }) }
    else if (kind === 'url') inputAnchor = { kind, url: this.stringField(anchor, 'url', 2_048), ...(this.optionalString(anchor, 'title', 500) === undefined ? {} : { title: this.optionalString(anchor, 'title', 500) }), ...(this.optionalString(anchor, 'publishedAt', 100) === undefined ? {} : { publishedAt: this.optionalString(anchor, 'publishedAt', 100) }) }
    else inputAnchor = { kind, title: this.stringField(anchor, 'title', 500), description: this.stringField(anchor, 'description', 5_000), ...(this.optionalString(anchor, 'eventDate', 100) === undefined ? {} : { eventDate: this.optionalString(anchor, 'eventDate', 100) }) }
    const input: EventResearchInput = { workflowRunId, symbol, anchor: inputAnchor, ...(name === undefined ? {} : { name }), ...(exchange === undefined ? {} : { exchange }), ...(asOf === undefined ? {} : { asOf }) }; const controller = new AbortController(); const started = service.startEventResearch(input, controller.signal); this.trackBackground(started.completion, () => controller.abort()); await this.sendJson(response, 202, { accepted: true, runId: started.runId, workflow: this.runtime!.workflowService.getWorkflowStatus(started.runId) })
  }
  private async startThesisRedTeam(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const service = this.runtime!.researchService
    if (!service) throw new ApplicationServiceError('failed', 'Thesis Red Team is not configured for this runtime')
    const body = await this.readJson(request); this.ensureRunning(); const symbol = this.stringField(body, 'symbol', 6); const name = this.optionalString(body, 'name', 500); const exchange = this.optionalString(body, 'exchange', 50); const thesisRef = this.stringField(body, 'thesisRef', 500); const workflowRunId = this.optionalString(body, 'workflowRunId', 120) ?? randomUUID(); const lookbackDays = body.lookbackDays === undefined ? undefined : this.integerField(body, 'lookbackDays', 30, 1095); const input: ThesisRedTeamInput = { workflowRunId, symbol, thesisRef, ...(name === undefined ? {} : { name }), ...(exchange === undefined ? {} : { exchange }), ...(lookbackDays === undefined ? {} : { lookbackDays }) }; const controller = new AbortController(); const started = service.startThesisRedTeam(input, controller.signal); this.trackBackground(started.completion, () => controller.abort()); await this.sendJson(response, 202, { accepted: true, runId: started.runId, workflow: this.runtime!.workflowService.getWorkflowStatus(started.runId) })
  }
  private async startDailyBrief(request: IncomingMessage, response: ServerResponse, briefType: DailyBriefType): Promise<void> {
    const service = this.runtime!.services.dailyIntelligenceService; if (!service) throw new ApplicationServiceError('failed', 'Daily Intelligence is not configured for this runtime'); const body = await this.readJson(request); this.ensureRunning(); const tradeDate = this.stringField(body, 'tradeDate', 10); const asOf = this.optionalString(body, 'asOf', 100); const forceRefresh = body.forceRefresh === undefined ? undefined : body.forceRefresh === true; const controller = new AbortController(); const started = service.startBrief({ workflowRunId: randomUUID(), briefType, tradeDate, asOf, forceRefresh }, controller.signal); this.trackBackground(started.completion, () => controller.abort()); await this.sendJson(response, 202, { accepted: true, runId: started.runId, workflow: this.runtime!.workflowService.getWorkflowStatus(started.runId) })
  }

  private async dispatchResearch(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const service: ResearchDispatchService | undefined = this.runtime!.services.researchDispatchService
    if (!service) throw new ApplicationServiceError('failed', 'Research dispatch is not configured for this runtime')
    const body = await this.readJson(request)
    this.ensureRunning()
    const controller = new AbortController()
    const started = await service.startAsync(body, controller.signal)
    if (started.completion !== undefined) {
      this.trackBackground(started.completion, () => {
        controller.abort()
        if (started.runId !== undefined) {
          try { this.runtime!.workflowService.cancelWorkflow(started.runId) } catch { /* completion owns final state */ }
        }
      })
    }
    await this.sendJson(response, started.status === 'started' ? 202 : 200, { accepted: started.status === 'started', status: started.status, request: started.request, decision: started.decision, summary: started.summary, ...(started.runId === undefined ? {} : { runId: started.runId }), ...(started.workflow === undefined ? {} : { workflow: started.workflow }) })
  }

  private sourceMetadata(value: Record<string, unknown>): IngestDocumentInput['sourceMetadata'] | undefined { const raw = value.sourceMetadata; if (raw === undefined) return undefined; if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ApplicationServiceError('invalid_input', 'sourceMetadata must be an object'); const input = raw as Record<string, unknown>; return { ...(this.optionalString(input, 'title', 500) === undefined ? {} : { title: this.optionalString(input, 'title', 500) }), ...(this.optionalString(input, 'institution', 500) === undefined ? {} : { institution: this.optionalString(input, 'institution', 500) }), ...(this.optionalString(input, 'author', 500) === undefined ? {} : { author: this.optionalString(input, 'author', 500) }), ...(this.optionalString(input, 'publishedAt', 100) === undefined ? {} : { publishedAt: this.optionalString(input, 'publishedAt', 100) }), ...(this.optionalString(input, 'sourceUrl', 2_000) === undefined ? {} : { sourceUrl: this.optionalString(input, 'sourceUrl', 2_000) }) } }
  private rawDocumentMetadataV04(value: unknown): RawDocumentMetadataV04 {
    if (value === undefined) return {}
    if (!isRecord(value)) throw new ApplicationServiceError('invalid_input', 'sourceMetadata must be an object')
    const fields = ['title', 'sourceType', 'sourceReliability', 'publisher', 'institution', 'author', 'publishedAt', 'canonicalUrl']
    if (Object.keys(value).some((key) => !fields.includes(key))) throw new ApplicationServiceError('invalid_input', 'sourceMetadata contains unsupported fields')
    const textOrNull = (field: string, max: number): string | null | undefined => {
      const item = value[field]
      if (item === undefined || item === null) return item
      if (typeof item !== 'string' || item.length > max || /[\u0000-\u001f\u007f-\u009f]/u.test(item)) throw new ApplicationServiceError('invalid_input', `sourceMetadata.${field} is invalid`)
      return item
    }
    const sourceType = value.sourceType
    const sourceReliability = value.sourceReliability
    if (sourceType !== undefined && !['official_disclosure', 'company_official', 'sell_side_research', 'industry_database', 'professional_media', 'general_media', 'community', 'unknown'].includes(String(sourceType))) throw new ApplicationServiceError('invalid_input', 'sourceMetadata.sourceType is invalid')
    if (sourceReliability !== undefined && !['high', 'medium', 'low', 'unknown'].includes(String(sourceReliability))) throw new ApplicationServiceError('invalid_input', 'sourceMetadata.sourceReliability is invalid')
    const title = textOrNull('title', 500); const publisher = textOrNull('publisher', 500); const institution = textOrNull('institution', 500); const author = textOrNull('author', 500); const publishedAt = textOrNull('publishedAt', 100); const canonicalUrl = textOrNull('canonicalUrl', 2_000)
    return { ...(title === undefined ? {} : { title }), ...(sourceType === undefined ? {} : { sourceType: sourceType as RawDocumentMetadataV04['sourceType'] }), ...(sourceReliability === undefined ? {} : { sourceReliability: sourceReliability as RawDocumentMetadataV04['sourceReliability'] }), ...(publisher === undefined ? {} : { publisher }), ...(institution === undefined ? {} : { institution }), ...(author === undefined ? {} : { author }), ...(publishedAt === undefined ? {} : { publishedAt }), ...(canonicalUrl === undefined ? {} : { canonicalUrl }) }
  }
  private rawDocumentRightsV04(value: unknown): RawDocumentRightsV04 {
    if (!isRecord(value)) throw new ApplicationServiceError('invalid_input', 'rights must be supplied explicitly')
    const required = ['accessScope', 'providerTermsKnown', 'retentionAllowed', 'aiProcessingAllowed', 'derivativeKnowledgeAllowed', 'redistributionAllowed', 'policyBasis']
    const allowed = [...required, 'expiresAt', 'entitlementRef']
    if (required.some((key) => !Object.hasOwn(value, key)) || Object.keys(value).some((key) => !allowed.includes(key))) throw new ApplicationServiceError('invalid_input', 'rights must explicitly state access scope, terms, retention, AI processing, derived knowledge, redistribution, and policy basis')
    if (!['public', 'authenticated', 'restricted', 'unknown'].includes(String(value.accessScope))) throw new ApplicationServiceError('invalid_input', 'rights.accessScope is invalid')
    for (const key of ['providerTermsKnown', 'retentionAllowed', 'aiProcessingAllowed', 'derivativeKnowledgeAllowed', 'redistributionAllowed']) if (typeof value[key] !== 'boolean') throw new ApplicationServiceError('invalid_input', `rights.${key} must be an explicit boolean`)
    if (typeof value.policyBasis !== 'string' || !value.policyBasis.trim() || value.policyBasis.length > 512) throw new ApplicationServiceError('invalid_input', 'rights.policyBasis must be a non-empty bounded string')
    const optional = (key: string): string | null | undefined => { const item = value[key]; if (item === undefined || item === null) return item; if (typeof item !== 'string' || item.length > 256) throw new ApplicationServiceError('invalid_input', `rights.${key} is invalid`); return item }
    const expiresAt = optional('expiresAt'); const entitlementRef = optional('entitlementRef')
    return { accessScope: value.accessScope as RawDocumentRightsV04['accessScope'], providerTermsKnown: value.providerTermsKnown as boolean, retentionAllowed: value.retentionAllowed as boolean, aiProcessingAllowed: value.aiProcessingAllowed as boolean, derivativeKnowledgeAllowed: value.derivativeKnowledgeAllowed as boolean, redistributionAllowed: value.redistributionAllowed as boolean, policyBasis: value.policyBasis, ...(expiresAt === undefined ? {} : { expiresAt }), ...(entitlementRef === undefined ? {} : { entitlementRef }) }
  }

  private ensureRunning(): void { if (this.lifecycle !== 'running') throw new ApplicationServiceError(this.lifecycle === 'closing' ? 'conflict' : 'failed', this.lifecycle === 'closing' ? 'Runtime server is closing' : 'Runtime server is not ready') }
  private observeBackground(operation: Promise<unknown>): Promise<void> {
    return operation.then(() => undefined, (error) => { try { this.publishRuntimeError(error) } catch { /* preserve the settled operation */ } })
  }
  private trackBackground(operation: Promise<unknown>, cancel: () => void | Promise<void>): void {
    if (this.backgroundOperations.size >= MAX_BACKGROUND_OPERATIONS) {
      const observed = this.observeBackground(operation)
      void observed.then(() => undefined, () => undefined)
      try { const result = cancel(); if (result !== undefined) void Promise.resolve(result).catch(() => undefined) } catch { /* the operation is rejected below */ }
      throw new ApplicationServiceError('conflict', 'Runtime background operation limit reached')
    }
    const record: BackgroundOperation = {
      completion: this.observeBackground(operation),
      cancel,
    }
    this.backgroundOperations.add(record)
    void record.completion.then(() => { this.backgroundOperations.delete(record) }, () => { this.backgroundOperations.delete(record) })
  }
  private publishRuntimeError(error: unknown): void { if (this.lifecycle === 'closing' || this.lifecycle === 'closed') return; const conversationId = (() => { try { return (this.sessionState() as { conversationId: string }).conversationId } catch { return 'conversation' } })(); const code = errorCode(error) === 'cancelled' ? 'agent_aborted' : 'agent_error'; this.eventStream.publish({ eventId: `runtime:${randomUUID()}`, conversationId: safeIdentifier(conversationId, 'conversation'), timestamp: new Date().toISOString(), type: 'error', code, summary: code === 'agent_aborted' ? 'Agent request aborted' : 'Agent request failed' } satisfies ClientEvent) }

  private async readJson(request: IncomingMessage, maxBytes = MAX_JSON_BYTES): Promise<Record<string, unknown>> { const length = Number(request.headers['content-length']); if (Number.isFinite(length) && length > maxBytes) throw new ApplicationServiceError('invalid_input', 'JSON request is too large'); const chunks: Buffer[] = []; let total = 0; for await (const input of request) { const chunk = Buffer.isBuffer(input) ? input : Buffer.from(input); total += chunk.length; if (total > maxBytes) throw new ApplicationServiceError('invalid_input', 'JSON request is too large'); chunks.push(chunk) } if (total === 0) return {}; try { const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required'); return value as Record<string, unknown> } catch (error) { throw new ApplicationServiceError('invalid_input', 'JSON request is invalid', { cause: error }) } }
  private dataSourceRouteFailure(error: unknown, operation: 'credential' | 'test'): unknown {
    if (error instanceof DataSourceAdministrationError) {
      if (error.code === 'unknown_integration') return new ApplicationServiceError('not_found', 'Data source integration was not found')
      if (error.code === 'unsupported_test') return new DataSourceRouteError('unsupported_test', 'This integration does not support the requested test')
      if (error.code === 'credential_store_unavailable') return new DataSourceRouteError('credential_store_unavailable', 'Credential storage is unavailable')
      return new ApplicationServiceError('invalid_input', 'Credential values are invalid')
    }
    if (operation === 'credential') return new DataSourceRouteError('credential_store_unavailable', 'Credential storage is unavailable')
    return error
  }
  private async runDataSourceOnboarding<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation() }
    catch (error) {
      if (error instanceof Error && error.message === 'Invalid data source onboarding draft') throw new ApplicationServiceError('invalid_input', 'Data source draft is invalid or unavailable')
      throw error
    }
  }
  private stringField(body: Record<string, unknown>, field: string, maxLength = 2_000_000): string { const value = body[field]; if (typeof value !== 'string' || value.length > maxLength) throw new ApplicationServiceError('invalid_input', `${field} is invalid`); return value }
  private optionalString(body: Record<string, unknown>, field: string, maxLength: number): string | undefined { const value = body[field]; if (value === undefined || value === null) return undefined; if (typeof value !== 'string' || value.length > maxLength) throw new ApplicationServiceError('invalid_input', `${field} is invalid`); return value }
  private stringArray(body: Record<string, unknown>, field: string, maxItems: number, maxLength: number): string[] { const value = body[field]; if (!Array.isArray(value) || value.length > maxItems || value.some((x) => typeof x !== 'string' || !x.trim() || x.length > maxLength)) throw new ApplicationServiceError('invalid_input', `${field} is invalid`); return value as string[] }
  private optionalPositive(body: Record<string, unknown>, field: string): number | undefined { const value = body[field]; if (value === undefined) return undefined; if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new ApplicationServiceError('invalid_input', `${field} is invalid`); return value }
  private integerField(body: Record<string, unknown>, field: string, minimum: number, maximum: number): number { const value = body[field]; if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw new ApplicationServiceError('invalid_input', `${field} is invalid`); return value }

  private openEvents(response: ServerResponse): void {
    const client: SseClient = { response, unsubscribe: () => undefined, onClose: () => undefined, onDrain: () => undefined, pendingFrames: [], waitingForDrain: false }
    client.onDrain = () => this.flushSseClient(client)
    try {
      // Register first. A rejected subscription must not create a timer or a
      // response listener that would outlive the failed connection.
      client.unsubscribe = this.eventStream.subscribe((frame) => this.enqueueSseFrame(client, frame))
      this.sseClients.add(client)
      client.onClose = () => this.removeSseClient(client)
      response.once('close', client.onClose)
      response.writeHead(200, { ...this.runtimeSecurity!.corsHeaders(), 'Cache-Control': 'no-store', 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
      this.enqueueSseFrame(client, ': connected\n\n')
      client.heartbeat = setInterval(() => {
        if (response.destroyed || !response.writable) { this.removeSseClient(client); return }
        this.enqueueSseFrame(client, ': heartbeat\n\n')
      }, 15_000)
    } catch (error) {
      this.removeSseClient(client)
      throw error
    }
  }

  private enqueueSseFrame(client: SseClient, frame: string): void {
    if (!this.sseClients.has(client) || client.response.destroyed || !client.response.writable) { this.removeSseClient(client); return }
    if (client.waitingForDrain || client.pendingFrames.length > 0) {
      if (client.pendingFrames.length >= MAX_SSE_PENDING_FRAMES) { this.removeSseClient(client); return }
      client.pendingFrames.push(frame)
      return
    }
    this.writeSseFrame(client, frame)
  }

  private flushSseClient(client: SseClient): void {
    if (!this.sseClients.has(client) || client.response.destroyed || !client.response.writable) { this.removeSseClient(client); return }
    client.waitingForDrain = false
    while (client.pendingFrames.length > 0) {
      const frame = client.pendingFrames.shift()!
      try {
        if (!client.response.write(frame)) {
          client.waitingForDrain = true
          client.response.once('drain', client.onDrain)
          return
        }
      } catch { this.removeSseClient(client); return }
    }
  }

  private writeSseFrame(client: SseClient, frame: string): void {
    try {
      if (!client.response.write(frame)) {
        client.waitingForDrain = true
        client.response.once('drain', client.onDrain)
      }
    } catch { this.removeSseClient(client) }
  }

  private removeSseClient(client: SseClient): void {
    const wasRegistered = this.sseClients.delete(client)
    if (client.heartbeat !== undefined) { clearInterval(client.heartbeat); client.heartbeat = undefined }
    client.pendingFrames.length = 0
    client.waitingForDrain = false
    client.unsubscribe()
    client.response.off('close', client.onClose)
    client.response.off('drain', client.onDrain)
    if (wasRegistered && !client.response.destroyed) client.response.end()
  }

  private async streamAttachment(response: ServerResponse, attachmentId: string): Promise<void> {
    const opened = await this.attachmentService!.openAttachment(attachmentId)
    response.writeHead(200, { ...this.runtimeSecurity!.corsHeaders(), 'Cache-Control': 'no-store', 'Content-Type': opened.metadata.mediaType, 'Content-Length': String(opened.metadata.size), 'Content-Disposition': `attachment; filename="${opened.metadata.filename.replace(/"/g, '')}"` })
    await pipeline(createReadStream(opened.path), response)
  }

  private async sendJson(response: ServerResponse, status: number, value: unknown): Promise<void> { if (response.destroyed || response.writableEnded) return; response.writeHead(status, { ...this.runtimeSecurity!.corsHeaders(), 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value)) }
  private sendEmpty(response: ServerResponse, status: number): void { response.writeHead(status, { ...this.runtimeSecurity!.corsHeaders(), 'Cache-Control': 'no-store', Allow: 'GET,POST,PATCH,DELETE,OPTIONS', 'Access-Control-Allow-Headers': `Content-Type, ${TOKEN_HEADER}`, 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS' }); response.end() }
  private sendError(response: ServerResponse, error: unknown): void { const safe = safeError(error); response.writeHead(httpStatus(safe.code), { ...this.runtimeSecurity?.corsHeaders(), 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(safe)) }
}

export async function createResearchHubRuntimeServer(options: ResearchHubRuntimeServerOptions): Promise<ResearchHubRuntimeServer> { return ResearchHubRuntimeServer.create(options) }
export async function startResearchHubRuntimeServer(options: ResearchHubRuntimeServerOptions): Promise<{ readonly server: ResearchHubRuntimeServer; readonly info: RuntimeServerInfo }> { const server = await ResearchHubRuntimeServer.create(options); return { server, info: server.address! } }
