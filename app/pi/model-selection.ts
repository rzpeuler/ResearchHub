import type { ModelRuntime } from '@earendil-works/pi-coding-agent'
import type { Api, Model } from '@earendil-works/pi-ai'
import { PiReasoningExecutor } from '../../plugins/reasoning/pi/executor.ts'
import { CodexCliReasoningExecutor, CODEX_CLI_LUNA_CONFIG, resolveCodexCliExecutable } from '../../plugins/reasoning/codex-cli/executor.ts'
import type { ReasoningCapabilities } from '../../plugins/reasoning/contracts.ts'

export interface ReasoningModelSelection {
  readonly provider: string
  readonly modelId: string
}

/** Kept for existing offline diagnostics that use the old providerId field. */
export interface ProductionReasoningModelSelection {
  readonly providerId: string
  readonly modelId: string
}

export const PRIMARY_PRODUCTION_REASONING_MODEL = Object.freeze({
  providerId: 'zhipu-openapi',
  modelId: 'glm-5.3-flash',
})

export const INDUSTRY_PRODUCTION_REASONING_SELECTION = Object.freeze({ backend: 'codex-cli' as const, requestedModel: 'gpt-5.6-luna' as const, requestedReasoningEffort: 'medium' as const })
export const THEME_FRAMEWORK_PRODUCTION_REASONING_SELECTION = Object.freeze({ backend: 'codex-cli' as const, requestedModel: 'gpt-6-luna' as const, requestedReasoningEffort: 'high' as const })
export const RAW_DOCUMENT_PREVIEW_PRODUCTION_REASONING_SELECTION = THEME_FRAMEWORK_PRODUCTION_REASONING_SELECTION
export const THEME_FRAMEWORK_PRODUCTION_REASONING_TIMEOUT_MS = 180_000
export const RAW_DOCUMENT_PREVIEW_PRODUCTION_REASONING_TIMEOUT_MS = 600_000

export interface ReasoningModelCandidate extends ReasoningModelSelection {
  readonly name: string
  readonly available: boolean
  readonly unavailableReason?: string
}

const PI_TOOL_CALL_APIS = new Set([
  'anthropic-messages',
  'azure-openai-responses',
  'bedrock-converse-stream',
  'google-generative-ai',
  'google-vertex',
  'mistral-conversations',
  'openai-codex-responses',
  'openai-completions',
  'openai-responses',
])

function piModelAdvertisesToolSupport(model: Model<Api>): boolean {
  const compat = model.compat as unknown as Record<string, unknown> | undefined
  return PI_TOOL_CALL_APIS.has(model.api) || compat?.supportsStrictMode === true || compat?.supportsOpenAIGrammarTools === true
}

export class ReasoningModelSelectionError extends Error {
  readonly code: 'invalid_input' | 'model_unavailable'

  constructor(code: 'invalid_input' | 'model_unavailable', message: string) {
    super(message)
    this.name = 'ReasoningModelSelectionError'
    this.code = code
  }
}

/**
 * Lists Pi's catalog without exposing credentials. Availability reflects Pi's
 * provider auth check; semantic output is always parsed and validated by the
 * ResearchHub executor, so providers without strict-tool metadata remain usable.
 */
export async function listReasoningModelCandidates(runtime: ModelRuntime): Promise<readonly ReasoningModelCandidate[]> {
  const models = runtime.getModels()
  const providers = [...new Set(models.map((model) => model.provider))]
  const availableByProvider = new Map<string, Set<string>>()
  const failures = new Map<string, string>()
  await Promise.all(providers.map(async (provider) => {
    try {
      availableByProvider.set(provider, new Set((await runtime.getAvailable(provider)).map((model) => model.id)))
    } catch {
      failures.set(provider, 'Pi could not verify provider authentication')
    }
  }))

  return models
    .map((model): ReasoningModelCandidate => {
      const authAvailable = availableByProvider.get(model.provider)?.has(model.id) ?? false
      const supportsText = model.input.includes('text')
      const supportsPiTools = piModelAdvertisesToolSupport(model)
      const available = authAvailable && supportsText && supportsPiTools
      const unavailableReason = available
        ? undefined
        : !authAvailable
          ? failures.get(model.provider) ?? 'Provider authentication is required'
          : !supportsText
            ? 'Model does not accept text input'
            : 'Pi does not verify tool-call support for this model'
      return { provider: model.provider, modelId: model.id, name: model.name, available, ...(unavailableReason === undefined ? {} : { unavailableReason }) }
    })
    .sort((left, right) => Number(right.available) - Number(left.available) || left.provider.localeCompare(right.provider) || left.name.localeCompare(right.name) || left.modelId.localeCompare(right.modelId))
}

/**
 * Resolves a browser-provided provider/model pair to the exact Pi catalog model
 * and rejects missing or unauthenticated selections before the app is rebuilt.
 */
export async function validateReasoningModelSelection(runtime: ModelRuntime, selection: ReasoningModelSelection): Promise<Model<Api>> {
  if (!selection || typeof selection.provider !== 'string' || selection.provider.trim() === '' || typeof selection.modelId !== 'string' || selection.modelId.trim() === '') {
    throw new ReasoningModelSelectionError('invalid_input', 'provider and modelId are required')
  }
  const model = runtime.getModel(selection.provider, selection.modelId)
  if (model === undefined) throw new ReasoningModelSelectionError('model_unavailable', `Pi does not list ${selection.provider}/${selection.modelId}`)
  if (!model.input.includes('text')) throw new ReasoningModelSelectionError('model_unavailable', `Selected model ${selection.provider}/${selection.modelId} does not accept text input`)
  if (!piModelAdvertisesToolSupport(model)) {
    throw new ReasoningModelSelectionError('model_unavailable', `Pi does not verify tool-call support for ${selection.provider}/${selection.modelId}`)
  }
  try {
    const available = await runtime.getAvailable(selection.provider)
    if (available.some((candidate) => candidate.id === selection.modelId)) return model
  } catch {
    // Provider error details may contain endpoint or account metadata; callers
    // receive only this stable, safe message.
  }
  throw new ReasoningModelSelectionError('model_unavailable', `Pi authentication is missing or unavailable for ${selection.provider}/${selection.modelId}`)
}

/** Backwards-compatible startup default lookup. Authentication is checked on selection and call. */
export function selectProductionReasoningModel(runtime: ModelRuntime, selection: ProductionReasoningModelSelection | ReasoningModelSelection = PRIMARY_PRODUCTION_REASONING_MODEL): Model<Api> {
  const provider = 'provider' in selection ? selection.provider : selection.providerId
  const model = runtime.getModel(provider, selection.modelId)
  if (model === undefined) throw new Error(`Configured production reasoning model is unavailable: ${provider}/${selection.modelId}`)
  return model
}

export interface CodexCliLunaExecutorOptions {
  readonly capabilities: ReasoningCapabilities
  readonly executable?: string
  readonly timeoutMs?: number
  readonly maxOutputChars?: number
  readonly tempRoot?: string
}

/** Explicit test/compatibility factory; Application Runtime production does not use it. */
export async function createCodexCliLunaReasoningExecutor(options: CodexCliLunaExecutorOptions): Promise<PiReasoningExecutor> {
  const adapter = new CodexCliReasoningExecutor({ ...options, model: CODEX_CLI_LUNA_CONFIG.model, reasoningEffort: CODEX_CLI_LUNA_CONFIG.reasoningEffort })
  const metadata = adapter.runtimeMetadata()
  return new PiReasoningExecutor({ capabilities: options.capabilities, timeoutMs: options.timeoutMs, maxOutputChars: options.maxOutputChars, completion: adapter.complete.bind(adapter), runtimeMetadata: { backend: 'codex-cli', requestedModel: metadata.requestedModel, requestedReasoningEffort: metadata.requestedReasoningEffort, invocationMode: metadata.invocationMode, structuredOutputEnabled: metadata.structuredOutputEnabled } })
}

/** Explicit opt-in Industry test/compatibility backend. */
export async function createIndustryProductionReasoningExecutor(options: CodexCliLunaExecutorOptions): Promise<PiReasoningExecutor> {
  return createCodexCliLunaReasoningExecutor(options)
}

export async function createThemeFrameworkProductionReasoningExecutor(options: CodexCliLunaExecutorOptions): Promise<PiReasoningExecutor> {
  return createLegacyCodexCliReasoningExecutor({ ...options, timeoutMs: options.timeoutMs ?? THEME_FRAMEWORK_PRODUCTION_REASONING_TIMEOUT_MS }, THEME_FRAMEWORK_PRODUCTION_REASONING_SELECTION.requestedModel, THEME_FRAMEWORK_PRODUCTION_REASONING_SELECTION.requestedReasoningEffort)
}

export async function createRawDocumentPreviewProductionReasoningExecutor(options: CodexCliLunaExecutorOptions): Promise<PiReasoningExecutor> {
  return createLegacyCodexCliReasoningExecutor({ ...options, timeoutMs: options.timeoutMs ?? RAW_DOCUMENT_PREVIEW_PRODUCTION_REASONING_TIMEOUT_MS }, RAW_DOCUMENT_PREVIEW_PRODUCTION_REASONING_SELECTION.requestedModel, RAW_DOCUMENT_PREVIEW_PRODUCTION_REASONING_SELECTION.requestedReasoningEffort)
}

async function createLegacyCodexCliReasoningExecutor(options: CodexCliLunaExecutorOptions, model: string, reasoningEffort: 'medium' | 'high'): Promise<PiReasoningExecutor> {
  const adapter = new CodexCliReasoningExecutor({ ...options, model, reasoningEffort })
  const metadata = adapter.runtimeMetadata()
  return new PiReasoningExecutor({ capabilities: options.capabilities, timeoutMs: options.timeoutMs, maxOutputChars: options.maxOutputChars, completion: adapter.complete.bind(adapter), runtimeMetadata: { backend: 'codex-cli', requestedModel: metadata.requestedModel, requestedReasoningEffort: metadata.requestedReasoningEffort, invocationMode: metadata.invocationMode, structuredOutputEnabled: metadata.structuredOutputEnabled } })
}

export const discoverCodexCliExecutable = async (): Promise<string> => resolveCodexCliExecutable().executable
