import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import type { Api, AssistantMessage, Context, Model } from '@earendil-works/pi-ai'
import { randomUUID } from 'node:crypto'
import { Ajv, type ValidateFunction } from 'ajv'
import { ReasoningExecutorError } from '../errors.ts'
import { validateReasoningCapabilities } from '../capabilities.ts'
import type {
  ReasoningCapabilities,
  ReasoningExecutor,
  ReasoningOperation,
  ReasoningRequest,
  ReasoningResult,
} from '../contracts.ts'

const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_OUTPUT_LIMIT = 256_000
const MAX_OUTPUT_SCHEMA_BYTES = 64_000
const DEFAULT_CAPABILITIES: ReasoningCapabilities = Object.freeze({
  maxContextTokens: 128_000,
  maxOutputTokens: 16_384,
  structuredOutputSupport: true,
  maxConcurrency: 4,
})
const outputSchemaValidator = new Ajv({ allErrors: true, strict: false, validateFormats: false })

export interface PiCompletionOptions {
  readonly signal: AbortSignal
  readonly maxTokens: number
  readonly metadata: Record<string, unknown>
  readonly operationId: string
  /** The unchanged ResearchHub contract, supplied as transport metadata to adapters. */
  readonly outputContract: unknown
}

export type PiCompletionResult = AssistantMessage | string

/** A deterministic seam for tests and callers that already own a Pi completion surface. */
export type PiCompletion = (
  model: Model<Api> | undefined,
  context: Context,
  options: PiCompletionOptions,
) => Promise<PiCompletionResult>

export type PiModelRuntime = Pick<ModelRuntime, 'getModels' | 'complete'> & Partial<Pick<ModelRuntime, 'getAvailableSnapshot'>>

export interface PiReasoningRuntimeMetadata {
  readonly provider: 'pi-coding-agent'
  readonly backend?: 'codex-cli'
  readonly requestedModel?: string
  readonly requestedReasoningEffort?: string
  readonly invocationMode?: string
  readonly structuredOutputEnabled?: boolean
}

export interface PiReasoningExecutorOptions {
  readonly capabilities?: ReasoningCapabilities
  readonly modelRuntime?: PiModelRuntime
  readonly model?: Model<Api>
  readonly completion?: PiCompletion
  readonly runtimeMetadata?: Omit<PiReasoningRuntimeMetadata, 'provider'>
  readonly timeoutMs?: number
  readonly maxOutputChars?: number
}

export class PiReasoningExecutor implements ReasoningExecutor {
  private readonly configuredCapabilities: ReasoningCapabilities
  private readonly hasExplicitCapabilities: boolean
  private readonly modelRuntime?: PiModelRuntime
  private readonly configuredModel?: Model<Api>
  private readonly completion?: PiCompletion
  private readonly runtimeMetadataValue?: Omit<PiReasoningRuntimeMetadata, 'provider'>
  private readonly timeoutMs: number
  private readonly maxOutputChars: number
  private runtimePromise?: Promise<PiModelRuntime>
  private modelPromise?: Promise<Model<Api> | undefined>
  private resolvedModel?: Model<Api>
  private effectiveCapabilities: ReasoningCapabilities

  constructor(options: PiReasoningExecutorOptions = {}) {
    this.modelRuntime = options.modelRuntime
    this.configuredModel = options.model
    this.completion = options.completion
    this.runtimeMetadataValue = options.runtimeMetadata
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.maxOutputChars = options.maxOutputChars ?? DEFAULT_OUTPUT_LIMIT

    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0) invalid('timeoutMs must be a positive safe integer')
    if (!Number.isSafeInteger(this.maxOutputChars) || this.maxOutputChars <= 0) invalid('maxOutputChars must be a positive safe integer')

    this.hasExplicitCapabilities = options.capabilities !== undefined
    const initialModel = options.model ?? (options.completion === undefined
      ? options.modelRuntime?.getAvailableSnapshot?.()[0] ?? options.modelRuntime?.getModels()[0]
      : undefined)
    const initialCapabilities = options.capabilities ?? (initialModel === undefined ? DEFAULT_CAPABILITIES : capabilitiesFromModel(initialModel))
    this.configuredCapabilities = validateReasoningCapabilities(initialCapabilities)
    this.effectiveCapabilities = this.configuredCapabilities
  }

  capabilities(): ReasoningCapabilities {
    return this.effectiveCapabilities
  }

  runtimeMetadata(): PiReasoningRuntimeMetadata {
    const model = this.configuredModel ?? this.resolvedModel
    if (this.completion !== undefined && this.runtimeMetadataValue !== undefined) return { provider: 'pi-coding-agent', ...this.runtimeMetadataValue }
    return model === undefined
      ? { provider: 'pi-coding-agent' }
      : { provider: 'pi-coding-agent', requestedModel: `${model.provider}/${model.id}` }
  }

  async execute(request: ReasoningRequest, externalSignal?: AbortSignal): Promise<ReasoningResult> {
    const operationId = request.metadata?.executionId ?? randomUUID()
    const started = Date.now()

    try {
      const model = await this.resolveModel()
      this.resolvedModel = model
      if (this.completion === undefined && model === undefined) {
        throw new ReasoningExecutorError('reasoning_host_unavailable', 'Pi has no available model', {
          operation: request.operation,
          operationId,
        })
      }
      if (model !== undefined && !this.hasExplicitCapabilities) {
        this.effectiveCapabilities = capabilitiesFromModel(model)
      }

      const context = buildContext(request, operationId, started)
      const metadata = {
        ...(request.metadata ?? {}),
        operation: request.operation,
        executionId: operationId,
      }
      const maxTokens = Math.min(this.effectiveCapabilities.maxOutputTokens, model?.maxTokens ?? this.effectiveCapabilities.maxOutputTokens)
      const response = await this.completeWithTimeout(model, context, {
        maxTokens,
        metadata,
        operationId,
        outputContract: request.outputContract,
      }, request.operation, operationId, externalSignal)
      const rawOutput = extractRawOutput(response, request.operation, operationId)
      if (Buffer.byteLength(rawOutput, 'utf8') > this.maxOutputChars) {
        throw new ReasoningExecutorError('reasoning_output_too_large', 'Pi reasoning output exceeded the configured limit', {
          operation: request.operation,
          operationId,
        })
      }
      const output = parseJsonOutput(rawOutput, request.operation, operationId)
      validateOutputContract(output, request.outputContract, request.operation, operationId)
      return { operation: request.operation, operationId, output, rawOutput, durationMs: Date.now() - started }
    } catch (error) {
      if (error instanceof ReasoningExecutorError) throw error
      throw new ReasoningExecutorError('reasoning_execution_failed', error instanceof Error ? error.message : String(error), {
        operation: request.operation,
        operationId,
        cause: error,
      })
    }
  }

  private async resolveModel(): Promise<Model<Api> | undefined> {
    if (this.configuredModel !== undefined || this.completion !== undefined) return this.configuredModel
    this.modelPromise ??= (async () => {
      const runtime = await this.resolveRuntime()
      const available = runtime.getAvailableSnapshot?.() ?? []
      return available[0] ?? runtime.getModels()[0]
    })()
    return this.modelPromise
  }

  private async resolveRuntime(): Promise<PiModelRuntime> {
    if (this.modelRuntime !== undefined) return this.modelRuntime
    this.runtimePromise ??= ModelRuntime.create({ modelsPath: null, allowModelNetwork: false, refreshOnCreate: false })
      .then((runtime) => runtime)
      .catch((error: unknown) => {
        throw new ReasoningExecutorError('reasoning_host_unavailable', 'Unable to initialize Pi ModelRuntime', { cause: error })
      })
    return this.runtimePromise
  }

  private async completeWithTimeout(
    model: Model<Api> | undefined,
    context: Context,
    options: Omit<PiCompletionOptions, 'signal'>,
    operation: ReasoningOperation,
    operationId: string,
    externalSignal?: AbortSignal,
  ): Promise<PiCompletionResult> {
    const controller = new AbortController()
    const completionOptions = { ...options, signal: controller.signal }
    let timeoutHandle: NodeJS.Timeout | undefined
    let timedOut = false
    let cancelListener: (() => void) | undefined
    const cancellation = new Promise<never>((_, reject) => {
      if (!externalSignal) return
      cancelListener = () => { controller.abort(); reject(new ReasoningExecutorError('reasoning_execution_failed', 'Pi reasoning execution was cancelled', { operation, operationId })) }
      if (externalSignal.aborted) cancelListener()
      else externalSignal.addEventListener('abort', cancelListener, { once: true })
    })
    const timeout = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        timedOut = true
        controller.abort()
        reject(new ReasoningExecutorError('reasoning_timeout', 'Pi reasoning execution timed out', { operation, operationId }))
      }, this.timeoutMs)
    })

    try {
      const completionPromise = this.completion === undefined
        ? (async () => {
          if (model === undefined) throw new Error('Pi reasoning requires a selected model')
          return (await this.resolveRuntime()).complete(model, context, { signal: completionOptions.signal, maxTokens: completionOptions.maxTokens })
        })()
        : this.completion(model, context, completionOptions)
      const response = await Promise.race([completionPromise, timeout, cancellation])
      if (isAssistantMessage(response) && isAssistantError(response)) {
        throw new ReasoningExecutorError('reasoning_execution_failed', response.errorMessage ?? 'Pi returned an error response', {
          operation,
          operationId,
        })
      }
      return response
    } catch (error) {
      if (timedOut) {
        if (error instanceof ReasoningExecutorError && error.code === 'reasoning_timeout') throw error
        throw new ReasoningExecutorError('reasoning_timeout', 'Pi reasoning execution timed out', { operation, operationId, cause: error })
      }
      if (error instanceof ReasoningExecutorError) throw error
      throw new ReasoningExecutorError('reasoning_execution_failed', error instanceof Error ? error.message : String(error), {
        operation,
        operationId,
        cause: error,
      })
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle)
      if (externalSignal && cancelListener) externalSignal.removeEventListener('abort', cancelListener)
    }
  }
}

function buildContext(request: ReasoningRequest, operationId: string, timestamp: number): Context {
  const outputContract = stringifyForPrompt(request.outputContract, 'outputContract')
  const input = stringifyForPrompt(request.input, 'input')
  return {
    systemPrompt: [
      'You are the ResearchHub semantic reasoning executor.',
      `Authorized operation: ${request.operation}.`,
      'Return exactly one JSON value and no Markdown fences or explanatory text.',
      `Output contract:\n${outputContract}`,
    ].join('\n'),
    messages: [{
      role: 'user',
      timestamp,
      content: JSON.stringify({ operationId, instruction: request.instruction, input: JSON.parse(input) }),
    }],
  }
}

function extractRawOutput(response: PiCompletionResult, operation: ReasoningOperation, operationId: string): string {
  if (typeof response === 'string') {
    if (response.trim() === '') invalidOutput('Pi returned an empty completion', operation, operationId)
    return response
  }
  if (!isAssistantMessage(response)) invalidOutput('Pi returned an unsupported completion result', operation, operationId)
  if (isAssistantError(response)) {
    throw new ReasoningExecutorError('reasoning_execution_failed', response.errorMessage ?? 'Pi returned an error response', { operation, operationId })
  }
  const text = response.content.filter((part): part is { type: 'text'; text: string } => part.type === 'text').map((part) => part.text).join('')
  if (text.trim() === '') invalidOutput('Pi returned no text completion', operation, operationId)
  return text
}

function parseJsonOutput(rawOutput: string, operation: ReasoningOperation, operationId: string): unknown {
  const trimmed = rawOutput.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    return JSON.parse(trimmed)
  } catch (error) {
    throw new ReasoningExecutorError('reasoning_output_invalid', 'Pi reasoning output is not valid JSON', {
      operation,
      operationId,
      cause: error,
    })
  }
}

function validateOutputContract(output: unknown, outputContract: unknown, operation: ReasoningOperation, operationId: string): void {
  // JSON Schema contracts are validated locally after JSON parsing. Legacy
  // prose-shaped contracts remain prompt guidance and retain their existing
  // operation-specific Workflow validators; runtime metadata does not claim a
  // provider-enforced constraint for either path.
  let schema: Record<string, unknown> | undefined
  try {
    schema = jsonSchemaFromContract(outputContract)
    if (schema === undefined) return
    const serialized = JSON.stringify(schema)
    if (serialized === undefined || Buffer.byteLength(serialized, 'utf8') > MAX_OUTPUT_SCHEMA_BYTES) throw new Error('JSON Schema exceeds the configured size limit')
    const validator: ValidateFunction = outputSchemaValidator.compile(schema)
    if (validator(output)) return
    const issueCount = validator.errors?.length ?? 1
    throw new ReasoningExecutorError('reasoning_output_invalid', `Pi reasoning output did not satisfy its JSON Schema contract (${issueCount} validation issue${issueCount === 1 ? '' : 's'})`, { operation, operationId })
  } catch (error) {
    if (error instanceof ReasoningExecutorError) throw error
    throw new ReasoningExecutorError('reasoning_configuration_invalid', 'Pi reasoning output contract is not a supported JSON Schema', { operation, operationId, cause: error })
  }
}

function jsonSchemaFromContract(contract: unknown): Record<string, unknown> | undefined {
  if (!isPlainRecord(contract)) return undefined
  const keys = Object.keys(contract)
  let schema: unknown = contract
  if (contract.format !== undefined || contract.root !== undefined || contract.schema !== undefined) {
    if (keys.length !== 4 || keys.some((key) => !['format', 'root', 'additionalProperties', 'schema'].includes(key)) || contract.format !== 'json' || contract.root !== 'object' || contract.additionalProperties !== false || !isPlainRecord(contract.schema)) {
      throw new Error('structured output wrapper is invalid')
    }
    schema = contract.schema
  }
  if (!isPlainRecord(schema)) return undefined
  const schemaRecord = schema as Record<string, unknown>
  const looksLikeSchema = typeof schemaRecord.type === 'string' || Array.isArray(schemaRecord.type) || schemaRecord.properties !== undefined || schemaRecord.items !== undefined || schemaRecord.enum !== undefined || schemaRecord.const !== undefined || schemaRecord.anyOf !== undefined || schemaRecord.oneOf !== undefined
  return looksLikeSchema ? schemaRecord : undefined
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function stringifyForPrompt(value: unknown, label: string): string {
  try {
    const result = JSON.stringify(value)
    if (result === undefined) throw new Error(`${label} is not JSON-serializable`)
    return result
  } catch (error) {
    throw new ReasoningExecutorError('reasoning_configuration_invalid', `${label} must be JSON-serializable`, { cause: error })
  }
}

function isAssistantMessage(value: PiCompletionResult): value is AssistantMessage {
  return typeof value !== 'string' && Array.isArray(value.content)
}

function isAssistantError(value: AssistantMessage): boolean {
  return value.stopReason === 'error' || value.errorMessage !== undefined
}

function capabilitiesFromModel(model: Model<Api>): ReasoningCapabilities {
  return validateReasoningCapabilities({
    maxContextTokens: model.contextWindow,
    maxOutputTokens: model.maxTokens,
    structuredOutputSupport: true,
    maxConcurrency: 4,
  })
}

function invalidOutput(message: string, operation: ReasoningOperation, operationId: string): never {
  throw new ReasoningExecutorError('reasoning_output_invalid', message, { operation, operationId })
}

function invalid(message: string): never {
  throw new ReasoningExecutorError('reasoning_configuration_invalid', message)
}
