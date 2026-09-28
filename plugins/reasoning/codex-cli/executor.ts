import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { accessSync, constants as fsConstants, statSync } from 'node:fs'
import { execFile as execFileCallback, spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { ReasoningExecutorError, type ReasoningExitState, type ReasoningFailureClass } from '../errors.ts'
import { validateReasoningCapabilities } from '../capabilities.ts'
import type { Context } from '@earendil-works/pi-ai'
import type { PiCompletionOptions } from '../pi/executor.ts'
import type { ReasoningCapabilities, ReasoningOperation } from '../contracts.ts'

const execFile = promisify(execFileCallback)
const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_OUTPUT_LIMIT = 256_000
const DEFAULT_MODEL = 'gpt-5.6-luna'
const DEFAULT_REASONING_EFFORT = 'medium' as const
const CODEX_COMMAND = ['exec'] as const
const CODEX_REASONING_EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export const CODEX_SCHEMA_MAX_BYTES = 64_000
const RESEARCHHUB_METADATA_KEYS = new Set(['name', 'bounds', 'allowlists', 'proposalRules'])
const CODEX_UNSUPPORTED_GENERATION_KEYS = new Set(['minLength', 'maxLength', 'pattern', 'minItems', 'maxItems', 'uniqueItems', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'])
const CODEX_SCHEMA_KEYS = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'oneOf', 'anyOf', 'description'])
const JSON_SCHEMA_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'])
const CURATION_EXTRACTION_TRANSPORT_INSTRUCTION = 'Codex transport bridge: return entities[].semanticFields and relations[].attributes as complete JSON objects encoded as JSON strings. Do not omit, paraphrase, or drop any fields. Use the literal string "{}" when the source supports an empty object.'

interface CurationExtractionTransport { readonly outputContract: unknown; readonly instruction: string }

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isExactStructuredOutputWrapper(value: unknown): value is Record<string, unknown> & { schema: Record<string, unknown> } {
  if (!isPlainRecord(value)) return false
  const keys = Reflect.ownKeys(value)
  return keys.length === 4 && keys.every((key) => typeof key === 'string' && ['format', 'root', 'additionalProperties', 'schema'].includes(key)) && value.format === 'json' && value.root === 'object' && value.additionalProperties === false && isPlainRecord(value.schema)
}

function isNullableDisjointOneOf(value: unknown): value is Record<string, unknown> & { oneOf: readonly [Record<string, unknown>, Record<string, unknown>] } {
  if (!isPlainRecord(value) || Object.keys(value).length !== 1 || !Array.isArray(value.oneOf) || value.oneOf.length !== 2) return false
  const [left, right] = value.oneOf
  if (!isPlainRecord(left) || !isPlainRecord(right)) return false
  const isNull = (branch: Record<string, unknown>) => Object.keys(branch).length === 1 && branch.type === 'null'
  const nullable = isNull(left) ? right : isNull(right) ? left : undefined
  return nullable !== undefined && typeof nullable.type === 'string' && nullable.type !== 'null' && JSON_SCHEMA_TYPES.has(nullable.type)
}

function lowerNullableOneOf(owner: Record<string, unknown>, key: string, path: string): void {
  const value = owner[key]
  if (!isNullableDisjointOneOf(value)) invalid(`Knowledge Curation extractKnowledge has an unsupported nullable union at ${path}`)
  const { oneOf, ...rest } = value
  owner[key] = { ...rest, anyOf: oneOf }
}

function curationExtractionTransport(operation: string, outputContract: unknown): CurationExtractionTransport | undefined {
  if (operation !== 'extractKnowledge' || !isExactStructuredOutputWrapper(outputContract)) return undefined
  const schema = outputContract.schema
  if (schema.type !== 'object' || schema.additionalProperties !== false || !isPlainRecord(schema.properties)) return undefined
  const rootProperties = schema.properties
  if (Object.keys(rootProperties).sort().join('|') !== 'claims|entities|relations') return undefined
  const entityArray = rootProperties.entities
  const relationArray = rootProperties.relations
  const claimArray = rootProperties.claims
  if (!isPlainRecord(entityArray) || entityArray.type !== 'array' || !isPlainRecord(entityArray.items) || !isPlainRecord(entityArray.items.properties)) invalid('Knowledge Curation extractKnowledge contract has an invalid entities schema')
  if (!isPlainRecord(relationArray) || relationArray.type !== 'array' || !isPlainRecord(relationArray.items) || !isPlainRecord(relationArray.items.properties)) invalid('Knowledge Curation extractKnowledge contract has an invalid relations schema')
  if (!isPlainRecord(claimArray) || claimArray.type !== 'array' || !isPlainRecord(claimArray.items) || !isPlainRecord(claimArray.items.properties)) invalid('Knowledge Curation extractKnowledge contract has an invalid claims schema')
  const entityProperties = entityArray.items.properties
  const relationProperties = relationArray.items.properties
  const openObject = (value: unknown): value is Record<string, unknown> => isPlainRecord(value) && Object.keys(value).length === 1 && value.type === 'object'
  if (!openObject(entityProperties.semanticFields) || !openObject(relationProperties.attributes)) invalid('Knowledge Curation extractKnowledge contract changed the expected open-object transport fields')
  const transportContract = structuredClone(outputContract) as Record<string, unknown>
  const transportedSchema = transportContract.schema as Record<string, unknown>
  const transportedRoot = transportedSchema.properties as Record<string, unknown>
  const transportedEntities = transportedRoot.entities as Record<string, unknown>
  const transportedRelations = transportedRoot.relations as Record<string, unknown>
  const transportedEntityProperties = (transportedEntities.items as Record<string, unknown>).properties as Record<string, unknown>
  const transportedRelationProperties = (transportedRelations.items as Record<string, unknown>).properties as Record<string, unknown>
  const transportedClaims = transportedRoot.claims as Record<string, unknown>
  const transportedClaimProperties = (transportedClaims.items as Record<string, unknown>).properties as Record<string, unknown>
  transportedEntityProperties.semanticFields = { type: 'string', description: 'JSON-encoded object; decoded by the ResearchHub adapter before Knowledge Curation validation.' }
  transportedRelationProperties.attributes = { type: 'string', description: 'JSON-encoded object; decoded by the ResearchHub adapter before Knowledge Curation validation.' }
  lowerNullableOneOf(transportedClaimProperties, 'temporal', 'claims[].temporal')
  lowerNullableOneOf(transportedClaimProperties, 'structuredValue', 'claims[].structuredValue')
  const transportedStructuredValueUnion = transportedClaimProperties.structuredValue as Record<string, unknown>
  const structuredValueBranches = transportedStructuredValueUnion.anyOf as unknown[]
  const structuredValueObject = structuredValueBranches.find((item) => isPlainRecord(item) && item.type === 'object') as Record<string, unknown> | undefined
  if (structuredValueObject === undefined || !isPlainRecord(structuredValueObject.properties)) invalid('Knowledge Curation extractKnowledge structuredValue nullable union changed unexpectedly')
  lowerNullableOneOf(structuredValueObject.properties, 'comparator', 'claims[].structuredValue.comparator')
  return { outputContract: transportContract, instruction: CURATION_EXTRACTION_TRANSPORT_INSTRUCTION }
}

function decodeCurationObjectField(value: unknown, path: string, operation: ReasoningOperation, operationId: string): Record<string, unknown> {
  if (typeof value !== 'string') throw new ReasoningExecutorError('reasoning_output_invalid', `Codex extraction field ${path} must be a JSON-encoded object string`, { operation, operationId })
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch {
    throw new ReasoningExecutorError('reasoning_output_invalid', `Codex extraction field ${path} contains invalid JSON`, { operation, operationId })
  }
  if (!isPlainRecord(parsed)) throw new ReasoningExecutorError('reasoning_output_invalid', `Codex extraction field ${path} must decode to a JSON object`, { operation, operationId })
  return parsed
}

function decodeCurationExtractionOutput(output: string, operation: ReasoningOperation, operationId: string): string {
  let parsed: unknown
  try { parsed = JSON.parse(output) } catch {
    throw new ReasoningExecutorError('reasoning_output_invalid', 'Codex extraction result is not valid JSON', { operation, operationId })
  }
  if (!isPlainRecord(parsed) || !Array.isArray(parsed.entities) || !Array.isArray(parsed.relations)) {
    throw new ReasoningExecutorError('reasoning_output_invalid', 'Codex extraction result must contain entity and relation arrays', { operation, operationId })
  }
  for (const [index, candidate] of parsed.entities.entries()) {
    if (!isPlainRecord(candidate) || !Object.prototype.hasOwnProperty.call(candidate, 'semanticFields')) throw new ReasoningExecutorError('reasoning_output_invalid', `Codex extraction entity ${index} omitted semanticFields`, { operation, operationId })
    candidate.semanticFields = decodeCurationObjectField(candidate.semanticFields, `entities[${index}].semanticFields`, operation, operationId)
  }
  for (const [index, candidate] of parsed.relations.entries()) {
    if (!isPlainRecord(candidate) || !Object.prototype.hasOwnProperty.call(candidate, 'attributes')) throw new ReasoningExecutorError('reasoning_output_invalid', `Codex extraction relation ${index} omitted attributes`, { operation, operationId })
    candidate.attributes = decodeCurationObjectField(candidate.attributes, `relations[${index}].attributes`, operation, operationId)
  }
  return JSON.stringify(parsed)
}

export type CodexCliReasoningEffort = (typeof CODEX_REASONING_EFFORTS)[number]

export type CodexCliResolutionSource = 'explicit' | 'environment' | 'path' | 'appdata' | 'standalone' | 'localappdata'
export type CodexCliExecutableKind = 'native' | 'command-shim'
export interface CodexCliResolution {
  readonly executable: string
  readonly source: CodexCliResolutionSource
  readonly kind: CodexCliExecutableKind
}

interface CodexCliResolutionOptions {
  readonly executable?: string
  readonly env?: NodeJS.ProcessEnv
  readonly platform?: NodeJS.Platform
  readonly fileExists?: (candidate: string) => boolean
}

const DEFAULT_FILE_EXISTS = (candidate: string): boolean => {
  try { accessSync(candidate, fsConstants.F_OK | fsConstants.R_OK); return statSync(candidate).isFile() } catch { return false }
}

function executableKind(candidate: string): CodexCliExecutableKind { return /\.(?:cmd|bat)$/iu.test(candidate) ? 'command-shim' : 'native' }
function isPathLike(value: string): boolean { return value.includes('/') || value.includes('\\') || /^[A-Za-z]:[\\/]/u.test(value) }
function candidateFile(candidate: string, fileExists: (value: string) => boolean): string | undefined {
  try {
    if (fileExists(candidate)) return candidate
  } catch { /* a broken candidate is simply skipped */ }
  return undefined
}

function resolveCandidate(value: string, source: CodexCliResolutionSource, env: NodeJS.ProcessEnv, options: Required<Pick<CodexCliResolutionOptions, 'platform' | 'fileExists'>>): CodexCliResolution | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const direct = candidateFile(trimmed, options.fileExists)
  if (direct) return { executable: direct, source, kind: executableKind(direct) }
  if (isPathLike(trimmed)) return undefined
  const pathValue = options.platform === 'win32' ? (env.Path?.trim() || env.PATH || '') : (env.PATH ?? '')
  const pathExt = options.platform === 'win32' ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : ['']
  for (const entry of pathValue.split(options.platform === 'win32' ? ';' : ':').filter(Boolean)) {
    const names = options.platform === 'win32' && !extname(trimmed) ? [trimmed, ...pathExt.map((extension) => `${trimmed}${extension.toLowerCase()}`)] : [trimmed]
    for (const name of names) {
      const found = candidateFile(join(entry, name), options.fileExists)
      if (found) return { executable: found, source, kind: executableKind(found) }
    }
  }
  return undefined
}

export function resolveCodexCliExecutable(options: CodexCliResolutionOptions = {}): CodexCliResolution {
  const platform = options.platform ?? process.platform
  const fileExists = options.fileExists ?? DEFAULT_FILE_EXISTS
  const env = options.env ?? process.env
  const resolveOptions = { platform, fileExists }
  const explicit = options.executable
  const environment = env.CODEX_EXECUTABLE?.trim()
  const candidates: Array<[string | undefined, CodexCliResolutionSource]> = [[explicit, 'explicit'], [environment, 'environment']]
  for (const [value, source] of candidates) {
    if (!value) continue
    const result = resolveCandidate(value, source, env, resolveOptions)
    if (result) return result
  }
  const pathResult = resolveCandidate('codex', 'path', env, resolveOptions)
  if (pathResult) return pathResult
  if (platform === 'win32') {
    const appData = env.APPDATA?.trim() || (env.USERPROFILE?.trim() ? join(env.USERPROFILE, 'AppData', 'Roaming') : undefined)
    if (appData) for (const candidate of [join(appData, 'npm', 'codex.cmd'), join(appData, 'npm', 'codex.exe')]) {
      const found = candidateFile(candidate, fileExists)
      if (found) return { executable: found, source: 'appdata', kind: executableKind(found) }
    }
    const localAppData = env.LOCALAPPDATA?.trim()
    if (localAppData) {
      const standalone = candidateFile(join(localAppData, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe'), fileExists)
      if (standalone) return { executable: standalone, source: 'standalone', kind: 'native' }
      const localRuntime = candidateFile(join(localAppData, 'OpenAI', 'Codex', 'bin', 'codex.exe'), fileExists)
      if (localRuntime) return { executable: localRuntime, source: 'localappdata', kind: 'native' }
    }
    const userProfile = env.USERPROFILE?.trim()
    if (userProfile) {
      const managedPackage = candidateFile(join(userProfile, '.codex', 'packages', 'standalone', 'current', 'bin', 'codex.exe'), fileExists)
      if (managedPackage) return { executable: managedPackage, source: 'standalone', kind: 'native' }
    }
  }
  throw new ReasoningExecutorError('reasoning_host_unavailable', 'Codex CLI executable was not discovered')
}

export function buildCodexCliProcessInvocation(executable: string, args: readonly string[], platform: NodeJS.Platform = process.platform): { executable: string; args: string[]; shell: false } {
  if (platform !== 'win32' || !/\.(?:cmd|bat)$/iu.test(executable)) return { executable, args: [...args], shell: false }
  const quote = (value: string): string => `"${value.replace(/(\\*)"/gu, '$1$1\\"').replace(/(\\+)$/u, '$1$1')}"`
  return { executable: 'cmd.exe', args: ['/d', '/s', '/c', [quote(executable), ...args.map(quote)].join(' ')], shell: false }
}

export const CODEX_CLI_LUNA_CONFIG = Object.freeze({
  backend: 'codex-cli' as const,
  model: DEFAULT_MODEL,
  reasoningEffort: DEFAULT_REASONING_EFFORT,
})

export interface CodexCliRuntimeMetadata {
  readonly provider: 'codex-cli'
  readonly requestedModel: string
  readonly requestedReasoningEffort: CodexCliReasoningEffort
  readonly invocationMode: 'exec-stdin-json-output-read-only'
  readonly structuredOutputEnabled: true
  readonly structuredOutputSchemaFingerprint?: string
  readonly structuredOutputSchemaBytes?: number
}

export interface CodexCliExecutionDiagnostics {
  readonly executableDiscovered: boolean
  readonly resolutionSource?: CodexCliResolutionSource
  readonly executableKind?: CodexCliExecutableKind
  readonly processStarted: boolean
  readonly exitState: ReasoningExitState
  readonly semanticResultAvailable: boolean
  readonly failureClass?: ReasoningFailureClass
  readonly structuredEventType?: string
  readonly safeErrorCode?: string
}

const FAILURE_PRIORITY: readonly ReasoningFailureClass[] = ['structured_output_configuration', 'authentication_or_account', 'model_unavailable', 'rate_limit_or_quota', 'safety_or_policy', 'transport_or_service', 'unknown_nonzero_exit']
const SAFE_CODE = /^[A-Za-z0-9_.:-]{1,64}$/

export interface CodexCliReasoningExecutorOptions {
  readonly capabilities: ReasoningCapabilities
  readonly executable?: string
  readonly timeoutMs?: number
  readonly maxOutputChars?: number
  readonly tempRoot?: string
  readonly model?: string
  readonly reasoningEffort?: CodexCliReasoningEffort
  /** Test-only command prefix; production is the documented `exec` subcommand. */
  readonly commandPrefix?: readonly string[]
}

export class CodexCliReasoningExecutor {
  private readonly capabilitiesValue: ReasoningCapabilities
  private readonly executable: string
  private readonly executableKind: CodexCliExecutableKind
  private readonly resolutionSource: CodexCliResolutionSource
  private readonly timeoutMs: number
  private readonly maxOutputChars: number
  private readonly tempRoot: string
  private readonly model: string
  private readonly reasoningEffort: CodexCliReasoningEffort
  private readonly commandPrefix: readonly string[]
  private schemaMetadata?: Pick<CodexCliRuntimeMetadata, 'structuredOutputSchemaFingerprint' | 'structuredOutputSchemaBytes'>
  private lastDiagnosticsValue: CodexCliExecutionDiagnostics = { executableDiscovered: true, processStarted: false, exitState: 'not_started', semanticResultAvailable: false }

  constructor(options: CodexCliReasoningExecutorOptions) {
    this.capabilitiesValue = validateReasoningCapabilities(options.capabilities)
    const resolution = resolveCodexCliExecutable({ executable: options.executable })
    this.executable = resolution.executable
    this.executableKind = resolution.kind
    this.resolutionSource = resolution.source
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.maxOutputChars = options.maxOutputChars ?? DEFAULT_OUTPUT_LIMIT
    this.tempRoot = options.tempRoot ?? tmpdir()
    this.model = (options.model ?? DEFAULT_MODEL).trim()
    this.reasoningEffort = options.reasoningEffort ?? DEFAULT_REASONING_EFFORT
    this.commandPrefix = options.commandPrefix ?? CODEX_COMMAND
    if (!this.executable.trim() || !this.model) invalid('executable and model must be non-empty')
    if (!(CODEX_REASONING_EFFORTS as readonly string[]).includes(this.reasoningEffort)) invalid('reasoningEffort is unsupported')
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0) invalid('timeoutMs must be a positive safe integer')
    if (!Number.isSafeInteger(this.maxOutputChars) || this.maxOutputChars <= 0) invalid('maxOutputChars must be a positive safe integer')
    if (this.commandPrefix.length === 0) invalid('commandPrefix must not be empty')
  }

  capabilities(): ReasoningCapabilities { return this.capabilitiesValue }

  runtimeMetadata(): CodexCliRuntimeMetadata {
    return { provider: 'codex-cli', requestedModel: this.model, requestedReasoningEffort: this.reasoningEffort, invocationMode: 'exec-stdin-json-output-read-only', structuredOutputEnabled: true, ...this.schemaMetadata }
  }

  executionDiagnostics(): CodexCliExecutionDiagnostics { return this.lastDiagnosticsValue }

  async complete(_model: unknown, context: Context, options: PiCompletionOptions): Promise<string> {
    const operation = options.metadata.operation as ReasoningOperation
    const operationId = options.operationId || randomUUID()
    const curationTransport = curationExtractionTransport(operation, options.outputContract)
    const directory = await mkdtemp(join(this.tempRoot, 'researchhub-codex-cli-'))
    const outputPath = join(directory, 'final-output.txt')
    const schemaPath = join(directory, 'output-schema.json')
    const prompt = JSON.stringify({ systemPrompt: curationTransport === undefined ? context.systemPrompt : `${context.systemPrompt}\n\n${curationTransport.instruction}`, messages: context.messages })
    try {
      const normalized = normalizeCodexOutputSchema(curationTransport?.outputContract ?? options.outputContract)
      this.schemaMetadata = { structuredOutputSchemaFingerprint: normalized.fingerprint, structuredOutputSchemaBytes: normalized.bytes }
      await writeFile(schemaPath, normalized.serialized, { encoding: 'utf8', flag: 'wx' })
      const args = buildCodexCliInvocationArgs({ commandPrefix: this.commandPrefix, model: this.model, reasoningEffort: this.reasoningEffort, invocationDirectory: directory, outputPath, schemaPath })
      const stdout = await this.runProcess(operation, operationId, directory, args, prompt, options.signal)
      let output = ''
      try { if ((await stat(outputPath)).size > this.maxOutputChars) throw tooLarge(operation, operationId); output = await readFile(outputPath, 'utf8') } catch (error) {
        if (error instanceof ReasoningExecutorError) throw error
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        try { output = parseCodexCliJsonlFinalResponse(stdout, this.maxOutputChars) } catch (error) {
          throw new ReasoningExecutorError('reasoning_output_invalid', error instanceof Error ? error.message : 'Codex CLI emitted invalid structured output', { operation, operationId })
        }
      }
      if (Buffer.byteLength(output, 'utf8') > this.maxOutputChars) throw tooLarge(operation, operationId)
      if (!output.trim()) throw new ReasoningExecutorError('reasoning_output_invalid', 'Codex CLI returned an empty final response', { operation, operationId })
      if (curationTransport !== undefined) output = decodeCurationExtractionOutput(output, operation, operationId)
      if (Buffer.byteLength(output, 'utf8') > this.maxOutputChars) throw tooLarge(operation, operationId)
      this.lastDiagnosticsValue = { ...this.lastDiagnosticsValue, exitState: 'normal_exit', semanticResultAvailable: true }
      return output
    } finally { await rm(directory, { recursive: true, force: true }) }
  }

  private runProcess(operation: ReasoningOperation, operationId: string, cwd: string, args: readonly string[], prompt: string, signal: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
      const invocation = buildCodexCliProcessInvocation(this.executable, args)
      const child = spawn(invocation.executable, invocation.args, { cwd, shell: invocation.shell, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
      let stdout = ''; let stderr = ''; let settled = false; let timedOut = false
      let processStarted = false
      this.lastDiagnosticsValue = { executableDiscovered: true, resolutionSource: this.resolutionSource, executableKind: this.executableKind, processStarted: false, exitState: 'not_started', semanticResultAvailable: false }
      const finish = (fn: () => void) => { if (!settled) { settled = true; clearTimeout(timer); signal.removeEventListener('abort', onAbort); fn() } }
      const terminate = () => { timedOut = true; if (child.pid !== undefined) { if (process.platform === 'win32') void execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }).catch(() => undefined); else { try { process.kill(child.pid, 'SIGTERM') } catch {} } } }
      const onAbort = () => { terminate(); this.lastDiagnosticsValue = { ...this.lastDiagnosticsValue, processStarted, exitState: 'cancelled' }; finish(() => reject(new ReasoningExecutorError('reasoning_execution_failed', 'Codex CLI reasoning execution was cancelled', { operation, operationId, processStarted, exitState: 'cancelled', failureClass: 'timeout_or_cancel' }))) }
      const timer = setTimeout(() => { terminate(); this.lastDiagnosticsValue = { ...this.lastDiagnosticsValue, processStarted, exitState: 'timeout' }; finish(() => reject(new ReasoningExecutorError('reasoning_timeout', 'Codex CLI reasoning execution timed out', { operation, operationId, processStarted, exitState: 'timeout', failureClass: 'timeout_or_cancel' }))) }, this.timeoutMs)
      signal.addEventListener('abort', onAbort, { once: true })
      child.once('spawn', () => { processStarted = true; this.lastDiagnosticsValue = { ...this.lastDiagnosticsValue, processStarted: true, exitState: 'started' } })
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (data: string) => { stdout += data; if (Buffer.byteLength(stdout, 'utf8') > this.maxOutputChars * 2) { terminate(); finish(() => reject(tooLarge(operation, operationId))) } })
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (data: string) => { stderr += data; if (Buffer.byteLength(stderr, 'utf8') > 8_000) stderr = stderr.slice(-8_000) })
      child.once('error', (error: NodeJS.ErrnoException) => finish(() => reject(new ReasoningExecutorError(error.code === 'ENOENT' ? 'reasoning_host_unavailable' : 'reasoning_execution_failed', 'Codex CLI process could not be started', { operation, operationId, processStarted, exitState: 'not_started', failureClass: 'transport_or_service' }))))
      child.once('close', (code) => { if (timedOut || signal.aborted) return; finish(() => { if (code === 0) return resolve(stdout); const signalInfo = classifyCodexFailure(stdout, stderr); this.lastDiagnosticsValue = { executableDiscovered: true, processStarted, exitState: 'nonzero_exit', semanticResultAvailable: false, ...signalInfo }; const codeKind = signalInfo.failureClass === 'structured_output_configuration' ? 'reasoning_structured_output_configuration_failed' : signalInfo.failureClass === 'authentication_or_account' ? 'reasoning_host_unavailable' : 'reasoning_execution_failed'; return reject(new ReasoningExecutorError(codeKind, signalInfo.failureClass === 'structured_output_configuration' ? 'Codex CLI rejected the structured output schema' : signalInfo.failureClass === 'authentication_or_account' ? 'Codex CLI external setup is required' : 'Codex CLI returned a non-zero exit code', { operation, operationId, exitCode: code ?? undefined, processStarted, exitState: 'nonzero_exit', ...signalInfo })) }) })
      child.stdin.end(prompt)
    })
  }
}

export function buildCodexCliInvocationArgs(input: { commandPrefix: readonly string[]; model: string; reasoningEffort: CodexCliReasoningEffort; invocationDirectory: string; outputPath: string; schemaPath: string }): string[] {
  return [...input.commandPrefix, '--model', input.model, '-c', `model_reasoning_effort="${input.reasoningEffort}"`, '--ephemeral', '--sandbox', 'read-only', '--skip-git-repo-check', '-C', input.invocationDirectory, '--output-schema', input.schemaPath, '--json', '-o', input.outputPath, '-']
}

export interface CodexOutputSchema {
  readonly schema: Record<string, unknown>
  readonly serialized: string
  readonly fingerprint: string
  readonly bytes: number
  readonly removedKeywords: readonly string[]
  readonly strengthenedObjectCount: number
  readonly strengthenedObjectPaths: readonly string[]
  readonly primitiveConstTypeCount: number
  readonly guardedKindOneOfConversionCount: number
  readonly redundantRequiredOnlyAnyOfRemovalCount: number
  readonly structuredValueScalarNormalizationCount: number
}

export function normalizeCodexOutputSchema(outputContract: unknown): CodexOutputSchema {
  let schemaContract = outputContract
  let structuredOutputWrapper = false
  if (outputContract !== null && typeof outputContract === 'object' && !Array.isArray(outputContract)) {
    const wrapper = outputContract as Record<string, unknown>
    const hasWrapperField = Object.prototype.hasOwnProperty.call(wrapper, 'format') || Object.prototype.hasOwnProperty.call(wrapper, 'root') || Object.prototype.hasOwnProperty.call(wrapper, 'schema')
    if (hasWrapperField) {
      const exactKeys = ['additionalProperties', 'format', 'root', 'schema']
      const prototype = Object.getPrototypeOf(outputContract)
      const ownKeys = Reflect.ownKeys(outputContract)
      if ((prototype !== Object.prototype && prototype !== null) || ownKeys.length !== exactKeys.length || ownKeys.some((key) => typeof key !== 'string' || !exactKeys.includes(key))) {
        invalid('ResearchHub structured output wrapper must contain only format, root, additionalProperties, and schema')
      }
      if (wrapper.format !== 'json' || wrapper.root !== 'object' || wrapper.additionalProperties !== false) {
        invalid('ResearchHub structured output wrapper must declare JSON object output with additionalProperties disabled')
      }
      const innerSchema = wrapper.schema
      if (innerSchema === null || typeof innerSchema !== 'object' || Array.isArray(innerSchema) || (Object.getPrototypeOf(innerSchema) !== Object.prototype && Object.getPrototypeOf(innerSchema) !== null)) {
        invalid('ResearchHub structured output wrapper schema must be a plain object')
      }
      const inner = innerSchema as Record<string, unknown>
      if (inner.type !== 'object' || inner.additionalProperties !== false) {
        invalid('ResearchHub structured output wrapper schema must preserve its declared object root constraints')
      }
      schemaContract = innerSchema
      structuredOutputWrapper = true
    }
  }
  const removed = new Set<string>()
  let strengthenedObjectCount = 0
  const strengthenedObjectPaths: string[] = []
  let primitiveConstTypeCount = 0
  let guardedKindOneOfConversionCount = 0
  let redundantRequiredOnlyAnyOfRemovalCount = 0
  let structuredValueScalarNormalizationCount = 0
  const isPrimitiveConst = (value: unknown): boolean => value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))
  const inferredType = (value: unknown): string | undefined => value === null ? 'null' : typeof value === 'string' ? 'string' : typeof value === 'boolean' ? 'boolean' : typeof value === 'number' && Number.isFinite(value) ? Number.isInteger(value) ? 'integer' : 'number' : undefined
  const isGuardedKindVariant = (value: unknown): value is Record<string, unknown> => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
    const variant = value as Record<string, unknown>
    const properties = variant.properties
    const kind = properties && typeof properties === 'object' && !Array.isArray(properties) ? (properties as Record<string, unknown>).kind : undefined
    return variant.type === 'object' && variant.additionalProperties === false && Array.isArray(variant.required) && variant.required.includes('kind') && kind !== null && typeof kind === 'object' && !Array.isArray(kind) && Object.prototype.hasOwnProperty.call(kind, 'const') && isPrimitiveConst((kind as Record<string, unknown>).const)
  }
  const isRedundantRequiredOnlyAnyOf = (value: unknown, propertyKeys: readonly string[], finalRequired: readonly string[]): boolean => {
    if (!Array.isArray(value) || value.length === 0) return false
    const allowed = new Set(propertyKeys)
    const required = new Set(finalRequired)
    return value.every((branch) => {
      if (branch === null || typeof branch !== 'object' || Array.isArray(branch)) return false
      const keys = Object.keys(branch as Record<string, unknown>)
      if (keys.length !== 1 || keys[0] !== 'required') return false
      const branchRequired = (branch as Record<string, unknown>).required
      return Array.isArray(branchRequired) && branchRequired.every((item) => typeof item === 'string' && allowed.has(item) && required.has(item))
    })
  }
  const convert = (value: unknown, path: string): unknown => {
    if (Array.isArray(value)) return value.map((item, index) => convert(item, `${path}[${index}]`))
    if (value === null || typeof value !== 'object') {
      if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint' || value === undefined) throw new Error(`outputContract contains a non-JSON value at ${path}`)
      if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`outputContract contains a non-JSON number at ${path}`)
      return value
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) throw new Error(`outputContract contains a non-plain object at ${path}`)
    const sourceOneOf = (value as Record<string, unknown>).oneOf
    const sourceCanConvertOneOf = Array.isArray(sourceOneOf) && sourceOneOf.length > 0 && sourceOneOf.every(isGuardedKindVariant) && new Set(sourceOneOf.map((variant) => ((variant as Record<string, unknown>).properties as Record<string, unknown>).kind as Record<string, unknown>).map((kind) => kind.const)).size === sourceOneOf.length
    const sourceTypeUnion = (value as Record<string, unknown>).type
    if (Array.isArray(sourceTypeUnion)) {
      const primitiveTypes = new Set(['string', 'number', 'integer', 'boolean', 'null'])
      const unionKeys = Object.keys(value as Record<string, unknown>)
      if (!structuredOutputWrapper || sourceTypeUnion.length === 0 || sourceTypeUnion.some((type) => typeof type !== 'string' || !primitiveTypes.has(type)) || new Set(sourceTypeUnion).size !== sourceTypeUnion.length) {
        throw new Error(`outputContract has an unsupported type union at ${path}`)
      }
      if (unionKeys.some((key) => ['anyOf', 'oneOf', 'const', 'enum', 'items', 'properties', 'additionalProperties', 'required'].includes(key))) {
        throw new Error(`outputContract type union has an unsupported combination at ${path}`)
      }
    }
    const result: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (RESEARCHHUB_METADATA_KEYS.has(key)) { removed.add(key); continue }
      if (CODEX_UNSUPPORTED_GENERATION_KEYS.has(key)) { removed.add(key); continue }
      if (!CODEX_SCHEMA_KEYS.has(key)) throw new Error(`outputContract contains unsupported schema keyword ${key}`)
      if (key === 'type' && Array.isArray(child)) {
        result.anyOf = child.map((type) => ({ type }))
      } else if (key === 'properties') {
        if (child === null || typeof child !== 'object' || Array.isArray(child)) throw new Error(`outputContract properties must be an object at ${path}`)
        result[key] = Object.fromEntries(Object.entries(child as Record<string, unknown>).map(([property, schema]) => [property, convert(schema, `${path}.properties.${property}`)]))
      } else if (key === 'const') {
        result[key] = cloneJsonValue(child, `${path}.const`)
      } else result[key] = convert(child, `${path}.${key}`)
    }
    if (result.type === undefined && Object.prototype.hasOwnProperty.call(result, 'const')) {
      const type = inferredType(result.const)
      if (type !== undefined) { result.type = type; primitiveConstTypeCount += 1 }
    }
    if (sourceCanConvertOneOf) {
      result.anyOf = result.oneOf
      delete result.oneOf
      guardedKindOneOfConversionCount += 1
    }
    if (result.properties !== undefined) {
      const propertyKeys = Object.keys(result.properties as Record<string, unknown>)
      if (result.required !== undefined) {
        if (!Array.isArray(result.required) || result.required.some((item) => typeof item !== 'string' || !Object.prototype.hasOwnProperty.call(result.properties, item))) {
          throw new Error(`outputContract required references a property that does not exist at ${path}`)
        }
      }
      if (JSON.stringify(result.required) !== JSON.stringify(propertyKeys)) {
        strengthenedObjectCount += 1
        if (strengthenedObjectPaths.length < 256) strengthenedObjectPaths.push(path)
      }
      result.required = propertyKeys
      if (isRedundantRequiredOnlyAnyOf(result.anyOf, propertyKeys, propertyKeys)) {
        delete result.anyOf
        redundantRequiredOnlyAnyOfRemovalCount += 1
      }
    }
    if (path.endsWith('.properties.structuredValue.properties.value') && Object.keys(result).length === 0) {
      result.anyOf = [{ type: 'number' }, { type: 'string' }, { type: 'boolean' }]
      structuredValueScalarNormalizationCount += 1
    }
    return result
  }
  let schema: unknown
  try { schema = convert(schemaContract, '$') } catch (error) { throw new ReasoningExecutorError('reasoning_configuration_invalid', 'ResearchHub output contract cannot be converted to Codex structured output schema', { cause: error }) }
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema) || Object.keys(schema as object).length === 0) invalid('ResearchHub output contract must convert to one JSON Schema object')
  const root = schema as Record<string, unknown>
  if (typeof root.type !== 'string' && root.oneOf === undefined && root.anyOf === undefined && root.enum === undefined && root.const === undefined) invalid('Codex structured output schema must be rooted in one JSON value')
  validateSchemaShape(root, '$')
  let serialized: string
  try { serialized = JSON.stringify(root) } catch (error) { throw new ReasoningExecutorError('reasoning_configuration_invalid', 'Codex structured output schema is not JSON-serializable', { cause: error }) }
  if (Buffer.byteLength(serialized, 'utf8') > CODEX_SCHEMA_MAX_BYTES) invalid('Codex structured output schema exceeds the configured size limit')
  return { schema: root, serialized, fingerprint: createHash('sha256').update(serialized).digest('hex').slice(0, 16), bytes: Buffer.byteLength(serialized, 'utf8'), removedKeywords: [...removed].sort(), strengthenedObjectCount, strengthenedObjectPaths, primitiveConstTypeCount, guardedKindOneOfConversionCount, redundantRequiredOnlyAnyOfRemovalCount, structuredValueScalarNormalizationCount }
}

function cloneJsonValue(value: unknown, path: string): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error(`outputContract contains a non-JSON number at ${path}`); return value }
  if (Array.isArray(value)) return value.map((item, index) => cloneJsonValue(item, `${path}[${index}]`))
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) throw new Error(`outputContract contains a non-plain object at ${path}`)
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, cloneJsonValue(child, `${path}.${key}`)]))
  }
  throw new Error(`outputContract contains a non-JSON value at ${path}`)
}

function validateSchemaShape(schema: Record<string, unknown>, path: string): void {
  if (schema.type !== undefined && (typeof schema.type !== 'string' || !JSON_SCHEMA_TYPES.has(schema.type))) invalid(`Codex structured output schema has an invalid type at ${path}`)
  if (schema.properties !== undefined && (schema.properties === null || typeof schema.properties !== 'object' || Array.isArray(schema.properties))) invalid(`Codex structured output schema properties are invalid at ${path}`)
  if (schema.properties !== undefined) for (const [key, child] of Object.entries(schema.properties as Record<string, unknown>)) {
    if (child === null || typeof child !== 'object' || Array.isArray(child)) invalid(`Codex structured output property ${key} is not a schema at ${path}`)
    validateSchemaShape(child as Record<string, unknown>, `${path}.properties.${key}`)
  }
  if (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.some((item) => typeof item !== 'string'))) invalid(`Codex structured output required is invalid at ${path}`)
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== 'boolean' && (schema.additionalProperties === null || typeof schema.additionalProperties !== 'object' || Array.isArray(schema.additionalProperties))) invalid(`Codex structured output additionalProperties is invalid at ${path}`)
  if (schema.additionalProperties && typeof schema.additionalProperties === 'object' && !Array.isArray(schema.additionalProperties)) validateSchemaShape(schema.additionalProperties as Record<string, unknown>, `${path}.additionalProperties`)
  if (schema.items !== undefined && (schema.items === null || typeof schema.items !== 'object' || Array.isArray(schema.items))) invalid(`Codex structured output items is invalid at ${path}`)
  if (schema.items && typeof schema.items === 'object' && !Array.isArray(schema.items)) validateSchemaShape(schema.items as Record<string, unknown>, `${path}.items`)
  for (const key of ['oneOf', 'anyOf']) if (schema[key] !== undefined) {
    if (!Array.isArray(schema[key]) || schema[key].length === 0 || schema[key].some((item) => item === null || typeof item !== 'object' || Array.isArray(item))) invalid(`Codex structured output ${key} is invalid at ${path}`)
    for (const [index, child] of (schema[key] as unknown[]).entries()) validateSchemaShape(child as Record<string, unknown>, `${path}.${key}[${index}]`)
  }
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || schema.enum.length === 0)) invalid(`Codex structured output enum is invalid at ${path}`)
}

export function parseCodexCliJsonlFinalResponse(stdout: string, maxOutputChars = DEFAULT_OUTPUT_LIMIT): string {
  let finalText: string | undefined
  for (const line of stdout.split(/\r?\n/).filter((value) => value.trim())) {
    let event: unknown
    try { event = JSON.parse(line) } catch { throw new Error('Codex CLI emitted malformed JSONL output') }
    const item = (event as { type?: string; item?: { type?: string; text?: string; content?: Array<{ type?: string; text?: string }> } })
    if (item.type === 'item.completed' && item.item?.type === 'agent_message') finalText = item.item.text ?? item.item.content?.filter((part) => part.type === 'text').map((part) => part.text ?? '').join('')
  }
  if (!finalText?.trim()) throw new Error('Codex CLI JSONL output did not contain a final assistant response')
  if (Buffer.byteLength(finalText, 'utf8') > maxOutputChars) throw new Error('Codex CLI final response exceeded the configured limit')
  return finalText
}

export interface CodexFailureSignal { readonly failureClass: ReasoningFailureClass; readonly structuredEventType?: string; readonly safeErrorCode?: string }

export function classifyCodexFailure(stdout: string, stderr: string): CodexFailureSignal {
  const signals: CodexFailureSignal[] = []
  for (const line of stdout.split(/\r?\n/).filter((value) => value.trim()).slice(-256)) {
    try {
      const value = JSON.parse(line) as Record<string, unknown>
      const type = typeof value.type === 'string' ? value.type.slice(0, 64) : undefined
      const error = value.error && typeof value.error === 'object' ? value.error as Record<string, unknown> : value
      let nestedError: Record<string, unknown> | undefined
      if (typeof error.message === 'string') {
        try {
          const nested = JSON.parse(error.message) as Record<string, unknown>
          if (nested.error && typeof nested.error === 'object') nestedError = nested.error as Record<string, unknown>
        } catch { /* ordinary event messages need no nested-envelope handling */ }
      }
      const candidateCode = typeof error.code === 'string' ? error.code : typeof nestedError?.code === 'string' ? nestedError.code : undefined
      const code = candidateCode !== undefined && SAFE_CODE.test(candidateCode) ? candidateCode : undefined
      const message = [error.message, nestedError?.message].filter((item): item is string => typeof item === 'string').join(' ')
      const hint = `${type ?? ''} ${typeof error.type === 'string' ? error.type : ''} ${code ?? ''} ${message}`.toLowerCase()
      const failureClass = classifySignalText(hint)
      if (failureClass) signals.push({ failureClass, structuredEventType: type, safeErrorCode: code })
    } catch { /* malformed JSONL is deliberately ignored; stderr remains authoritative */ }
  }
  const stderrClass = classifySignalText(stderr)
  if (stderrClass) signals.push({ failureClass: stderrClass })
  for (const failureClass of FAILURE_PRIORITY) { const match = signals.find((signal) => signal.failureClass === failureClass); if (match) return match }
  return { failureClass: 'unknown_nonzero_exit' }
}

function tooLarge(operation: ReasoningOperation, operationId: string): ReasoningExecutorError { return new ReasoningExecutorError('reasoning_output_too_large', 'Codex CLI output exceeded the configured limit', { operation, operationId }) }
function invalid(message: string): never { throw new ReasoningExecutorError('reasoning_configuration_invalid', message) }
function classifySignalText(value: string): ReasoningFailureClass | undefined {
  if (/invalid[_ -]?json[_ -]?schema|structured[_ -]?output|output[- ]schema|json schema|(?:invalid|unsupported|reject|config).*schema|schema.*(?:invalid|unsupported|reject|config)/iu.test(value)) return 'structured_output_configuration'
  if (/auth|login|sign.?in|account|credential|otp/iu.test(value)) return 'authentication_or_account'
  if (/model.*(?:unavailable|not found|unknown)|model_unavailable/iu.test(value)) return 'model_unavailable'
  if (/rate.?limit|quota|too many requests/iu.test(value)) return 'rate_limit_or_quota'
  if (/safety|policy|refused|blocked/iu.test(value)) return 'safety_or_policy'
  if (/transport|service|network|connection|unreachable|server/iu.test(value)) return 'transport_or_service'
  return undefined
}
