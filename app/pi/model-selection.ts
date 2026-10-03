import type { ModelRuntime } from '@earendil-works/pi-coding-agent'
import type { Api, Model } from '@earendil-works/pi-ai'
import { PiReasoningExecutor } from '../../plugins/reasoning/pi/executor.ts'
import { CodexCliReasoningExecutor, CODEX_CLI_LUNA_CONFIG, resolveCodexCliExecutable } from '../../plugins/reasoning/codex-cli/executor.ts'
import type { ReasoningCapabilities } from '../../plugins/reasoning/contracts.ts'

export interface ProductionReasoningModelSelection {
  readonly providerId: string
  readonly modelId: string
}

export const PRIMARY_PRODUCTION_REASONING_MODEL: ProductionReasoningModelSelection = Object.freeze({
  providerId: 'zhipu-openapi',
  modelId: 'glm-5.3-flash',
})

export interface IndustryProductionReasoningSelection {
  readonly backend: 'codex-cli'
  readonly requestedModel: 'gpt-5.6-luna'
  readonly requestedReasoningEffort: 'medium'
}

export const INDUSTRY_PRODUCTION_REASONING_SELECTION: IndustryProductionReasoningSelection = Object.freeze({
  backend: 'codex-cli',
  requestedModel: 'gpt-5.6-luna',
  requestedReasoningEffort: 'medium',
})

export interface ThemeFrameworkProductionReasoningSelection {
  readonly backend: 'codex-cli'
  readonly requestedModel: 'gpt-6-luna'
  readonly requestedReasoningEffort: 'high'
}

export const THEME_FRAMEWORK_PRODUCTION_REASONING_SELECTION: ThemeFrameworkProductionReasoningSelection = Object.freeze({
  backend: 'codex-cli',
  requestedModel: 'gpt-6-luna',
  requestedReasoningEffort: 'high',
})

export const THEME_FRAMEWORK_PRODUCTION_REASONING_TIMEOUT_MS = 180_000

export interface RawDocumentPreviewProductionReasoningSelection {
  readonly backend: 'codex-cli'
  readonly requestedModel: 'gpt-6-luna'
  readonly requestedReasoningEffort: 'high'
}

export const RAW_DOCUMENT_PREVIEW_PRODUCTION_REASONING_SELECTION: RawDocumentPreviewProductionReasoningSelection = Object.freeze({
  backend: 'codex-cli',
  requestedModel: 'gpt-6-luna',
  requestedReasoningEffort: 'high',
})

export const RAW_DOCUMENT_PREVIEW_PRODUCTION_REASONING_TIMEOUT_MS = 600_000

export function selectProductionReasoningModel(runtime: ModelRuntime, selection: ProductionReasoningModelSelection = PRIMARY_PRODUCTION_REASONING_MODEL): Model<Api> {
  const model = runtime.getModel(selection.providerId, selection.modelId)
  if (model === undefined) throw new Error(`Configured production reasoning model is unavailable: ${selection.providerId}/${selection.modelId}`)
  return model
}

export interface CodexCliLunaExecutorOptions {
  readonly capabilities: ReasoningCapabilities
  readonly executable?: string
  readonly timeoutMs?: number
  readonly maxOutputChars?: number
  readonly tempRoot?: string
}

/** Explicit opt-in factory. It never participates in Application Runtime default selection. */
export async function createCodexCliLunaReasoningExecutor(options: CodexCliLunaExecutorOptions): Promise<PiReasoningExecutor> {
  const adapter = new CodexCliReasoningExecutor({ ...options, model: CODEX_CLI_LUNA_CONFIG.model, reasoningEffort: CODEX_CLI_LUNA_CONFIG.reasoningEffort })
  const metadata = adapter.runtimeMetadata()
  return new PiReasoningExecutor({ capabilities: options.capabilities, timeoutMs: options.timeoutMs, maxOutputChars: options.maxOutputChars, completion: adapter.complete.bind(adapter), runtimeMetadata: { backend: 'codex-cli', requestedModel: metadata.requestedModel, requestedReasoningEffort: metadata.requestedReasoningEffort, invocationMode: metadata.invocationMode, structuredOutputEnabled: metadata.structuredOutputEnabled } })
}

/** The sole explicit Industry production backend. It has no fallback policy. */
export async function createIndustryProductionReasoningExecutor(options: CodexCliLunaExecutorOptions): Promise<PiReasoningExecutor> {
  return createCodexCliLunaReasoningExecutor(options)
}

/** Explicit Theme Framework production backend. It has no fallback policy. */
export async function createThemeFrameworkProductionReasoningExecutor(options: CodexCliLunaExecutorOptions): Promise<PiReasoningExecutor> {
  const timeoutMs = options.timeoutMs ?? THEME_FRAMEWORK_PRODUCTION_REASONING_TIMEOUT_MS
  const adapter = new CodexCliReasoningExecutor({
    ...options,
    timeoutMs,
    model: THEME_FRAMEWORK_PRODUCTION_REASONING_SELECTION.requestedModel,
    reasoningEffort: THEME_FRAMEWORK_PRODUCTION_REASONING_SELECTION.requestedReasoningEffort,
  })
  const metadata = adapter.runtimeMetadata()
  return new PiReasoningExecutor({
    capabilities: options.capabilities,
    timeoutMs,
    maxOutputChars: options.maxOutputChars,
    completion: adapter.complete.bind(adapter),
    runtimeMetadata: {
      backend: 'codex-cli',
      requestedModel: metadata.requestedModel,
      requestedReasoningEffort: metadata.requestedReasoningEffort,
      invocationMode: metadata.invocationMode,
      structuredOutputEnabled: metadata.structuredOutputEnabled,
    },
  })
}

/** Explicit Schema 0.4 Raw Document preview backend; never changes other workflow model selection. */
export async function createRawDocumentPreviewProductionReasoningExecutor(options: CodexCliLunaExecutorOptions): Promise<PiReasoningExecutor> {
  const timeoutMs = options.timeoutMs ?? RAW_DOCUMENT_PREVIEW_PRODUCTION_REASONING_TIMEOUT_MS
  const adapter = new CodexCliReasoningExecutor({
    ...options,
    timeoutMs,
    model: RAW_DOCUMENT_PREVIEW_PRODUCTION_REASONING_SELECTION.requestedModel,
    reasoningEffort: RAW_DOCUMENT_PREVIEW_PRODUCTION_REASONING_SELECTION.requestedReasoningEffort,
  })
  const metadata = adapter.runtimeMetadata()
  return new PiReasoningExecutor({
    capabilities: options.capabilities,
    timeoutMs,
    maxOutputChars: options.maxOutputChars,
    completion: adapter.complete.bind(adapter),
    runtimeMetadata: {
      backend: 'codex-cli',
      requestedModel: metadata.requestedModel,
      requestedReasoningEffort: metadata.requestedReasoningEffort,
      invocationMode: metadata.invocationMode,
      structuredOutputEnabled: metadata.structuredOutputEnabled,
    },
  })
}

export const discoverCodexCliExecutable = async (): Promise<string> => resolveCodexCliExecutable().executable
