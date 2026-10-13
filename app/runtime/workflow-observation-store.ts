import { randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type { WorkflowRunView } from '../services/contracts.ts'

export const WORKFLOW_OBSERVATION_SCHEMA_VERSION = 1 as const
const MAX_SNAPSHOT_BYTES = 512 * 1024
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u
const SNAPSHOT_KEYS = ['schemaVersion', 'runId', 'observationRevision', 'persistedAt', 'workflow'] as const
const WORKFLOW_REQUIRED_KEYS = ['runId', 'workflowType', 'objective', 'status', 'startedAt', 'updatedAt', 'observationRevision', 'stages', 'providerObservations', 'skillObservations'] as const
const WORKFLOW_OPTIONAL_KEYS = ['currentStage', 'currentStageId', 'progressSummary', 'completedAt', 'reviewCount', 'errorSummary', 'executionResult'] as const
const STATUS_VALUES = ['pending', 'running', 'completed', 'completed_with_review', 'blocked', 'cancelled', 'failed'] as const
const STAGE_STATUS_VALUES = ['pending', 'running', 'completed', 'skipped', 'failed', 'blocked', 'cancelled'] as const
const PROVIDER_STATUS_VALUES = ['success', 'partial', 'unavailable', 'failed', 'skipped'] as const
const SKILL_STATUS_VALUES = ['running', 'completed', 'failed', 'cancelled'] as const

export interface WorkflowObservationSnapshot {
  readonly schemaVersion: typeof WORKFLOW_OBSERVATION_SCHEMA_VERSION
  readonly runId: string
  readonly observationRevision: number
  readonly persistedAt: string
  readonly workflow: WorkflowRunView
}

export interface WorkflowObservationStoreOptions { readonly rootDir: string }
export interface WorkflowObservationDiagnostic { readonly runId?: string; readonly code: string }
export interface WorkflowObservationListResult { readonly runIds: string[]; readonly diagnostics: readonly WorkflowObservationDiagnostic[] }
export interface WorkflowObservationWriteResult { readonly state: 'written' | 'unchanged' | 'stale'; readonly observationRevision: number; readonly persistedAt?: string }
export interface WorkflowObservationReadResult { readonly workflow: WorkflowRunView; readonly persistedAt: string }

export type WorkflowObservationStoreErrorCode = 'invalid_input' | 'corrupt' | 'unsupported_version' | 'io' | 'capacity' | 'conflict'

export class WorkflowObservationStoreError extends Error {
  constructor(readonly code: WorkflowObservationStoreErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'WorkflowObservationStoreError'
  }
}

const writeTails = new Map<string, Promise<void>>()

/** Durable, atomic snapshots of caller-projected Workflow observations; this store never resumes execution. */
export class WorkflowObservationStore {
  private readonly rootDir: string

  constructor(options: WorkflowObservationStoreOptions) {
    if (typeof options?.rootDir !== 'string' || options.rootDir.trim() === '') throw invalid('rootDir is required')
    this.rootDir = resolve(options.rootDir)
  }

  async listRunIds(): Promise<WorkflowObservationListResult> {
    await this.ensureRoot()
    let names: string[]
    try { names = await readdir(this.rootDir) }
    catch (error) { throw io('Workflow observation directory could not be listed', error) }
    const runIds: string[] = []
    const diagnostics: WorkflowObservationDiagnostic[] = []
    for (const name of names.filter((item) => item.endsWith('.json')).sort((left, right) => left.localeCompare(right))) {
      const runId = name.slice(0, -5)
      if (!isSafeRunId(runId)) { diagnostics.push({ runId, code: 'invalid_input' }); continue }
      try {
        const snapshot = await this.readSnapshot(runId)
        if (snapshot !== undefined) runIds.push(runId)
      } catch (error) {
        diagnostics.push({ runId, code: errorCode(error) })
      }
    }
    return { runIds, diagnostics }
  }

  async write(workflow: WorkflowRunView): Promise<WorkflowObservationWriteResult> {
    validateWorkflow(workflow)
    const runId = workflow.runId
    let projection: WorkflowRunView
    try { projection = projectWorkflow(workflow) }
    catch (error) { throw invalid('workflow projection must be JSON serializable', error) }
    validateWorkflow(projection)
    return this.serialized(runId, async () => {
      const existing = await this.readSnapshot(runId)
      if (existing !== undefined) {
        if (projection.observationRevision < existing.observationRevision) return { state: 'stale', observationRevision: existing.observationRevision, persistedAt: existing.persistedAt }
        if (projection.observationRevision === existing.observationRevision) {
          if (!isDeepStrictEqual(projection, existing.workflow)) throw conflict(`Workflow observation revision conflicts for run: ${runId}`)
          return { state: 'unchanged', observationRevision: existing.observationRevision, persistedAt: existing.persistedAt }
        }
      }
      const snapshot: WorkflowObservationSnapshot = {
        schemaVersion: WORKFLOW_OBSERVATION_SCHEMA_VERSION,
        runId,
        observationRevision: projection.observationRevision,
        persistedAt: new Date().toISOString(),
        workflow: projection,
      }
      await this.writeSnapshot(snapshot)
      return { state: 'written', observationRevision: snapshot.observationRevision, persistedAt: snapshot.persistedAt }
    })
  }

  async read(runIdInput: string): Promise<WorkflowObservationReadResult | undefined> {
    const runId = normalizeRunId(runIdInput)
    const snapshot = await this.readSnapshot(runId)
    return snapshot === undefined ? undefined : { workflow: snapshot.workflow, persistedAt: snapshot.persistedAt }
  }

  private path(runId: string): string { return join(this.rootDir, `${runId}.json`) }

  private async serialized<T>(runId: string, operation: () => Promise<T>): Promise<T> {
    const key = `${this.rootDir}\0${runId}`
    const previous = writeTails.get(key) ?? Promise.resolve()
    let release!: () => void
    const tail = new Promise<void>((resolveTail) => { release = resolveTail })
    writeTails.set(key, tail)
    await previous.catch(() => undefined)
    try { return await operation() }
    finally {
      release()
      if (writeTails.get(key) === tail) writeTails.delete(key)
    }
  }

  private async ensureRoot(): Promise<void> {
    try {
      await mkdir(this.rootDir, { recursive: true })
      const info = await lstat(this.rootDir)
      if (!info.isDirectory() || info.isSymbolicLink()) throw corrupt('Workflow observation root is not a safe directory')
    } catch (error) {
      if (error instanceof WorkflowObservationStoreError) throw error
      throw io('Workflow observation directory is unavailable', error)
    }
  }

  private async readSnapshot(runId: string): Promise<WorkflowObservationSnapshot | undefined> {
    await this.ensureRoot()
    const path = this.path(runId)
    try {
      const info = await lstat(path)
      if (!info.isFile() || info.isSymbolicLink()) throw corrupt(`Workflow observation is not a regular file: ${runId}`)
      if (info.size > MAX_SNAPSHOT_BYTES) throw capacity(`Workflow observation exceeds ${MAX_SNAPSHOT_BYTES} bytes: ${runId}`)
      await chmod(path, 0o600)
      const text = await readFile(path, 'utf8')
      if (Buffer.byteLength(text, 'utf8') > MAX_SNAPSHOT_BYTES) throw capacity(`Workflow observation exceeds ${MAX_SNAPSHOT_BYTES} bytes: ${runId}`)
      let value: unknown
      try { value = JSON.parse(text) as unknown }
      catch (error) { throw corrupt(`Workflow observation JSON is malformed: ${runId}`, error) }
      return validateSnapshot(value, runId)
    } catch (error) {
      if (isNotFound(error)) return undefined
      if (error instanceof WorkflowObservationStoreError) throw error
      throw io(`Workflow observation could not be read: ${runId}`, error)
    }
  }

  private async writeSnapshot(snapshot: WorkflowObservationSnapshot): Promise<void> {
    await this.ensureRoot()
    const destination = this.path(snapshot.runId)
    const temporary = join(dirname(destination), `.${snapshot.runId}.${randomUUID()}.tmp`)
    const text = `${JSON.stringify(snapshot)}\n`
    if (Buffer.byteLength(text, 'utf8') > MAX_SNAPSHOT_BYTES) throw capacity(`Workflow observation exceeds ${MAX_SNAPSHOT_BYTES} bytes`)
    let handle: Awaited<ReturnType<typeof open>> | undefined
    try {
      handle = await open(temporary, 'wx', 0o600)
      await handle.writeFile(text, 'utf8')
      await handle.sync()
      await handle.close(); handle = undefined
      await chmod(temporary, 0o600)
      await rename(temporary, destination)
      if (process.platform !== 'win32') {
        const directory = await open(dirname(destination), 'r')
        try { await directory.sync() } finally { await directory.close() }
      }
    } catch (error) {
      await handle?.close().catch(() => undefined)
      await unlink(temporary).catch(() => undefined)
      if (error instanceof WorkflowObservationStoreError) throw error
      throw io(`Workflow observation could not be saved: ${snapshot.runId}`, error)
    }
  }
}

function validateSnapshot(value: unknown, expectedRunId: string): WorkflowObservationSnapshot {
  if (!isRecord(value)) throw corrupt('Workflow observation must be an object')
  if (value.schemaVersion !== WORKFLOW_OBSERVATION_SCHEMA_VERSION) throw new WorkflowObservationStoreError('unsupported_version', `Unsupported Workflow observation schema version: ${String(value.schemaVersion)}`)
  if (!hasExactKeys(value, SNAPSHOT_KEYS)) throw corrupt('Workflow observation fields are invalid')
  if (!isSafeRunId(value.runId) || value.runId !== expectedRunId) throw corrupt('Workflow observation runId does not match its filename')
  if (!Number.isSafeInteger(value.observationRevision) || (value.observationRevision as number) < 0) throw corrupt('Workflow observation revision is invalid')
  if (!isTimestamp(value.persistedAt)) throw corrupt('Workflow observation persistedAt is invalid')
  try { validateWorkflow(value.workflow, expectedRunId) }
  catch (error) {
    if (error instanceof WorkflowObservationStoreError && error.code === 'invalid_input') throw corrupt('Workflow observation projection is malformed', error)
    throw error
  }
  if (value.workflow.observationRevision !== value.observationRevision) throw corrupt('Workflow observation revision does not match its workflow projection')
  return value as unknown as WorkflowObservationSnapshot
}

function validateWorkflow(value: unknown, expectedRunId?: string): asserts value is WorkflowRunView {
  if (!isRecord(value)) throw invalid('workflow must be an object')
  if (!hasOnlyKeys(value, WORKFLOW_REQUIRED_KEYS, WORKFLOW_OPTIONAL_KEYS) || WORKFLOW_REQUIRED_KEYS.some((key) => !Object.hasOwn(value, key))) throw invalid('workflow projection fields are invalid')
  const requiredStrings = ['runId', 'workflowType', 'objective', 'status', 'startedAt', 'updatedAt'] as const
  for (const key of requiredStrings) if (typeof value[key] !== 'string') throw invalid(`workflow.${key} must be text`)
  if (!isSafeRunId(value.runId)) throw invalid('workflow.runId is not a safe run ID')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u.test(value.workflowType as string)) throw invalid('workflow.workflowType is invalid')
  if (expectedRunId !== undefined && value.runId !== expectedRunId) throw corrupt('Workflow projection runId does not match its filename')
  if (!STATUS_VALUES.includes(value.status as typeof STATUS_VALUES[number])) throw invalid('workflow.status is invalid')
  if (!isTimestamp(value.startedAt) || !isTimestamp(value.updatedAt) || (value.completedAt !== undefined && !isTimestamp(value.completedAt))) throw invalid('workflow timestamps are invalid')
  if (!Number.isSafeInteger(value.observationRevision) || (value.observationRevision as number) < 0) throw invalid('workflow.observationRevision is invalid')
  if (value.currentStage !== undefined && typeof value.currentStage !== 'string' || value.currentStageId !== undefined && typeof value.currentStageId !== 'string' || value.progressSummary !== undefined && typeof value.progressSummary !== 'string' || value.reviewCount !== undefined && (!Number.isSafeInteger(value.reviewCount) || (value.reviewCount as number) < 0) || value.errorSummary !== undefined && typeof value.errorSummary !== 'string') throw invalid('workflow optional projection fields are invalid')
  if (!Array.isArray(value.stages) || !Array.isArray(value.providerObservations) || !Array.isArray(value.skillObservations)) throw invalid('workflow observation collections are invalid')
  for (const stage of value.stages) {
    if (!isRecord(stage) || !hasOnlyKeys(stage, ['stageId', 'label', 'status'], ['startedAt', 'completedAt', 'durationMs', 'summary', 'diagnostics']) || typeof stage.stageId !== 'string' || !safeObservationId(stage.stageId) || typeof stage.label !== 'string' || !STAGE_STATUS_VALUES.includes(stage.status as typeof STAGE_STATUS_VALUES[number]) || !optionalTimestamps(stage, ['startedAt', 'completedAt']) || (stage.durationMs !== undefined && (!Number.isSafeInteger(stage.durationMs) || (stage.durationMs as number) < 0)) || (stage.summary !== undefined && typeof stage.summary !== 'string') || (stage.diagnostics !== undefined && (!Array.isArray(stage.diagnostics) || stage.diagnostics.some((item) => typeof item !== 'string' || !isSafeDiagnostic(item))))) throw invalid('workflow stage observation is invalid')
  }
  for (const provider of value.providerObservations) {
    if (!isRecord(provider) || !hasOnlyKeys(provider, ['providerId', 'label', 'status', 'diagnostics'], ['recordCount', 'startedAt', 'completedAt', 'durationMs']) || typeof provider.providerId !== 'string' || !safeObservationId(provider.providerId) || typeof provider.label !== 'string' || !PROVIDER_STATUS_VALUES.includes(provider.status as typeof PROVIDER_STATUS_VALUES[number]) || !Array.isArray(provider.diagnostics) || provider.diagnostics.some((item) => typeof item !== 'string' || !isSafeDiagnostic(item)) || !optionalTimestamps(provider, ['startedAt', 'completedAt']) || (provider.durationMs !== undefined && (!Number.isSafeInteger(provider.durationMs) || (provider.durationMs as number) < 0)) || (provider.recordCount !== undefined && (!Number.isSafeInteger(provider.recordCount) || (provider.recordCount as number) < 0))) throw invalid('workflow provider observation is invalid')
  }
  for (const skill of value.skillObservations) {
    if (!isRecord(skill) || !hasOnlyKeys(skill, ['skillId', 'label', 'status'], ['startedAt', 'completedAt', 'durationMs', 'summary']) || typeof skill.skillId !== 'string' || !safeObservationId(skill.skillId) || typeof skill.label !== 'string' || !SKILL_STATUS_VALUES.includes(skill.status as typeof SKILL_STATUS_VALUES[number]) || !optionalTimestamps(skill, ['startedAt', 'completedAt']) || (skill.durationMs !== undefined && (!Number.isSafeInteger(skill.durationMs) || (skill.durationMs as number) < 0)) || (skill.summary !== undefined && typeof skill.summary !== 'string')) throw invalid('workflow Skill observation is invalid')
  }
  if (value.executionResult !== undefined && !validateExecutionResult(value.executionResult, value.runId)) throw invalid('workflow execution result projection is invalid')
}

function validateExecutionResult(value: unknown, runId: string): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, ['runId', 'workflowId', 'executionStatus', 'diagnostics', 'bundleStatus'], ['terminalStatus', 'summary', 'reportRef', 'bundleRef', 'reviewRef', 'blockedReason']) || value.runId !== runId || typeof value.workflowId !== 'string' || !RUN_ID_PATTERN.test(value.workflowId) || !STATUS_VALUES.includes(value.executionStatus as typeof STATUS_VALUES[number]) || (value.terminalStatus !== undefined && !STATUS_VALUES.includes(value.terminalStatus as typeof STATUS_VALUES[number])) || (value.summary !== undefined && typeof value.summary !== 'string') || (value.reportRef !== undefined && (typeof value.reportRef !== 'string' || !RUN_ID_PATTERN.test(value.reportRef))) || (value.bundleRef !== undefined && (typeof value.bundleRef !== 'string' || !RUN_ID_PATTERN.test(value.bundleRef))) || !Array.isArray(value.diagnostics) || value.diagnostics.some((item) => typeof item !== 'string' || !isSafeDiagnostic(item)) || !['pending', 'available', 'failed', 'unavailable'].includes(String(value.bundleStatus))) return false
  if (value.blockedReason !== undefined && (typeof value.blockedReason !== 'string' || !isSafeDiagnostic(value.blockedReason))) return false
  if (value.reviewRef !== undefined && (!isRecord(value.reviewRef) || !hasOnlyKeys(value.reviewRef, ['kind', 'id'], []) || !['review_case', 'theme_framework_candidate', 'daily_brief'].includes(String(value.reviewRef.kind)) || typeof value.reviewRef.id !== 'string' || !RUN_ID_PATTERN.test(value.reviewRef.id))) return false
  return true
}

function optionalTimestamps(value: Record<string, unknown>, keys: readonly string[]): boolean { return keys.every((key) => value[key] === undefined || isTimestamp(value[key])) }
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)) }
function hasOnlyKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[]): boolean { const allowed = new Set([...required, ...optional]); return Object.keys(value).every((key) => allowed.has(key)) && required.every((key) => Object.hasOwn(value, key)) }
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function isSafeRunId(value: unknown): value is string { return typeof value === 'string' && RUN_ID_PATTERN.test(value) }
function safeObservationId(value: string): boolean { return /^[a-z0-9][a-z0-9._:-]{0,99}$/u.test(value) }
function isSafeDiagnostic(value: string): boolean { return /^[A-Z][A-Z0-9_]{0,63}$/u.test(value) }
function safeSnapshotText(value: string, limit: number, fallback: string): string { const text = value.trim().replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ').replace(/\s+/gu, ' ').slice(0, limit); return !text || /(?:[A-Za-z]:\\|\\\\|\/(?:Users|home|private|var|tmp)\/|\bBearer\s+\S+|(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|authorization)\s*[:=]\s*\S+)/iu.test(text) ? fallback : text }
function projectWorkflow(value: WorkflowRunView): WorkflowRunView {
  const { observationSource: _source, recoveryState: _recovery, historyPersistence: _persistence, ...workflow } = value
  const result = workflow.executionResult
  return JSON.parse(JSON.stringify({
    ...workflow,
    objective: safeSnapshotText(workflow.objective, 240, 'Workflow objective omitted for safety.'),
    ...(workflow.currentStage === undefined ? {} : { currentStage: safeSnapshotText(workflow.currentStage, 240, 'Workflow stage omitted for safety.') }),
    ...(workflow.progressSummary === undefined ? {} : { progressSummary: safeSnapshotText(workflow.progressSummary, 240, 'Workflow progress omitted for safety.') }),
    ...(workflow.errorSummary === undefined ? {} : { errorSummary: safeSnapshotText(workflow.errorSummary, 240, 'Workflow error details omitted for safety.') }),
    stages: workflow.stages.map((stage) => ({ ...stage, label: safeSnapshotText(stage.label, 240, 'Workflow stage'), ...(stage.summary === undefined ? {} : { summary: safeSnapshotText(stage.summary, 240, 'Workflow stage details omitted for safety.') }), ...(stage.diagnostics === undefined ? {} : { diagnostics: stage.diagnostics.filter(isSafeDiagnostic) }) })),
    providerObservations: workflow.providerObservations.map((provider) => ({ ...provider, label: safeSnapshotText(provider.label, 240, 'Workflow provider'), diagnostics: provider.diagnostics.filter(isSafeDiagnostic) })),
    skillObservations: workflow.skillObservations.map((skill) => ({ ...skill, label: safeSnapshotText(skill.label, 240, 'Workflow skill'), ...(skill.summary === undefined ? {} : { summary: safeSnapshotText(skill.summary, 240, 'Workflow skill details omitted for safety.') }) })),
    ...(result === undefined ? {} : { executionResult: {
    ...result,
    ...(result.summary === undefined ? {} : { summary: safeSnapshotText(result.summary, 500, 'Workflow result summary omitted for safety.') }),
    ...(result.blockedReason !== undefined && !isSafeDiagnostic(result.blockedReason) ? { blockedReason: undefined } : {}),
    diagnostics: result.diagnostics.filter(isSafeDiagnostic),
  } })
  })) as WorkflowRunView
}
function isTimestamp(value: unknown): value is string { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) && Number.isFinite(Date.parse(value)) }
function normalizeRunId(value: unknown): string { if (!isSafeRunId(value)) throw invalid('runId is not a safe deterministic identifier'); return value }
function isNotFound(error: unknown): boolean { return isRecord(error) && error.code === 'ENOENT' }
function errorCode(error: unknown): string { return error instanceof WorkflowObservationStoreError ? error.code : 'io' }
function invalid(message: string, cause?: unknown): WorkflowObservationStoreError { return new WorkflowObservationStoreError('invalid_input', message, cause === undefined ? undefined : { cause }) }
function corrupt(message: string, cause?: unknown): WorkflowObservationStoreError { return new WorkflowObservationStoreError('corrupt', message, cause === undefined ? undefined : { cause }) }
function capacity(message: string): WorkflowObservationStoreError { return new WorkflowObservationStoreError('capacity', message) }
function conflict(message: string): WorkflowObservationStoreError { return new WorkflowObservationStoreError('conflict', message) }
function io(message: string, cause?: unknown): WorkflowObservationStoreError { return new WorkflowObservationStoreError('io', message, cause === undefined ? undefined : { cause }) }
