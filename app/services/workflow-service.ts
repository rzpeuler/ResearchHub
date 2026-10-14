import { ApplicationServiceError, type TerminalWorkflowStatus, type WorkflowCancelResult, type WorkflowExecutionResultProjection, type WorkflowObservationReporter, type WorkflowProviderObservation, type WorkflowRunView, type WorkflowSkillObservation, type WorkflowStageStatus, type WorkflowStageView, type WorkflowStatus } from './contracts.ts'
import { WorkflowObservationStore, WorkflowObservationStoreError } from '../runtime/workflow-observation-store.ts'
import type { WorkflowAcquisitionActivity } from '../../workflows/observation-contracts.ts'

interface RunRecord extends WorkflowRunView { readonly controller?: AbortController; readonly terminal: boolean }
const TERMINAL = new Set<WorkflowStatus>(['completed', 'completed_with_review', 'blocked', 'cancelled', 'failed'])
function now(): string { return new Date().toISOString() }
function safeFailureSummary(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const firstLine = message.split(/\r?\n/u, 1)[0]?.trim() ?? ''
  // Only stable diagnostic codes cross the Runtime boundary. Free-form
  // provider, identity, or adapter messages can contain user data or secrets
  // that a pattern-based scrubber cannot reliably recognize.
  const code = firstLine.match(/^([A-Z][A-Z0-9_]{0,63})$/u)?.[1]
  return code ? `Workflow failed (${code}).` : 'Workflow execution failed; details were omitted.'
}

const terminalStageStatuses = new Set<WorkflowStageStatus>(['completed', 'skipped', 'failed', 'blocked', 'cancelled'])
const safeDiagnostic = /^[A-Z][A-Z0-9_]{0,63}$/u
const safeObservationId = /^[a-z0-9][a-z0-9._:-]{0,99}$/u
function boundedObservationText(value: string | undefined, fallback: string): string | undefined {
  if (value === undefined) return undefined
  const text = value.trim().replace(/\s+/gu, ' ').slice(0, 240)
  if (!text || /(?:[A-Za-z]:\\|\\\\|\/(?:Users|home|private|var|tmp)\/|\bBearer\s+\S+|(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|authorization)\s*[:=]\s*\S+)/iu.test(text)) return fallback
  return text
}
function observationDuration(startedAt: string | undefined, completedAt: string): number | undefined {
  if (startedAt === undefined) return undefined
  const start = Date.parse(startedAt); const end = Date.parse(completedAt)
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : undefined
}
function closeStages(stages: readonly WorkflowStageView[], status: WorkflowStatus, completedAt: string): readonly WorkflowStageView[] {
  const terminalStatus: WorkflowStageStatus = status === 'cancelled' ? 'cancelled' : status === 'failed' ? 'failed' : status === 'blocked' ? 'blocked' : 'completed'
  return stages.map((stage) => stage.status === 'running'
    ? { ...stage, status: terminalStatus, completedAt, ...(observationDuration(stage.startedAt, completedAt) === undefined ? {} : { durationMs: observationDuration(stage.startedAt, completedAt) }) }
    : stage)
}
function closeAcquisition(activities: readonly WorkflowAcquisitionActivity[] | undefined, status: WorkflowStatus, completedAt: string): readonly WorkflowAcquisitionActivity[] | undefined {
  return activities?.map((activity) => activity.status === 'running' ? { ...activity, status: status === 'cancelled' ? 'cancelled' : status === 'failed' || status === 'blocked' ? 'failed' : 'completed', completedAt } : activity)
}
function closeSkills(skills: readonly WorkflowSkillObservation[], status: WorkflowStatus, completedAt: string): readonly WorkflowSkillObservation[] {
  const terminalStatus: WorkflowSkillObservation['status'] = status === 'cancelled' ? 'cancelled' : status === 'failed' || status === 'blocked' ? 'failed' : 'completed'
  return skills.map((skill) => skill.status === 'running'
    ? { ...skill, status: terminalStatus, completedAt, ...(observationDuration(skill.startedAt, completedAt) === undefined ? {} : { durationMs: observationDuration(skill.startedAt, completedAt) }) }
    : skill)
}

export interface WorkflowRegistration { readonly runId: string; readonly workflowType: string; readonly objective: string }
export interface WorkflowOutcome { readonly status: TerminalWorkflowStatus; readonly summary?: string; readonly reviewCount?: number; readonly errorSummary?: string }
export interface WorkflowServiceOptions { readonly observationStore?: WorkflowObservationStore }
export interface WorkflowObservationInitialization { readonly available: boolean; readonly diagnosticCodes: readonly string[] }
type PersistenceState = NonNullable<WorkflowRunView['historyPersistence']>

export class WorkflowService {
  private readonly runs = new Map<string, RunRecord>()
  private readonly knownRunIds = new Set<string>()
  private readonly persistenceTails = new Map<string, Promise<void>>()
  private readonly persistenceStates = new Map<string, PersistenceState>()
  private persistenceAvailable = true
  private initialization: Promise<WorkflowObservationInitialization> | undefined

  constructor(private readonly options: WorkflowServiceOptions = {}) {}

  initialize(): Promise<WorkflowObservationInitialization> {
    if (this.initialization) return this.initialization
    this.initialization = (async () => {
      if (!this.options.observationStore) { this.persistenceAvailable = false; return { available: false, diagnosticCodes: ['store_unconfigured'] } }
      try {
        const listed = await this.options.observationStore.listRunIds()
        for (const runId of listed.runIds) this.knownRunIds.add(runId)
        for (const diagnostic of listed.diagnostics) if (diagnostic.runId && /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u.test(diagnostic.runId)) this.knownRunIds.add(diagnostic.runId)
        return { available: true, diagnosticCodes: [...new Set(listed.diagnostics.map((item) => item.code))] }
      } catch (error) {
        this.persistenceAvailable = false
        return { available: false, diagnosticCodes: [this.persistenceErrorCode(error)] }
      }
    })()
    return this.initialization
  }

  observationReporter(runId: string): WorkflowObservationReporter {
    return {
      acquisitionActivity: async (activity) => { await this.confirmTransition(runId, this.setAcquisitionActivity(runId, activity)) },
      startStage: async (stageId, label, summary) => { await this.confirmTransition(runId, this.startStage(runId, stageId, label, summary)) },
      finishStage: async (stageId, status, details) => { await this.confirmTransition(runId, this.finishStage(runId, stageId, status, details)) },
      providerObservations: async (observations) => { await this.confirmTransition(runId, this.setProviderObservations(runId, observations)) },
      startSkill: async (skillId, label, summary) => { await this.confirmTransition(runId, this.startSkill(runId, skillId, label, summary)) },
      finishSkill: async (skillId, status, summary) => { await this.confirmTransition(runId, this.finishSkill(runId, skillId, status, summary)) },
    }
  }
  register(input: WorkflowRegistration): WorkflowRunView {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(input.runId)) throw new ApplicationServiceError('invalid_input', 'runId must be a safe deterministic identifier')
    if (this.runs.has(input.runId) || this.knownRunIds.has(input.runId)) throw new ApplicationServiceError('invalid_input', `Workflow run already exists: ${input.runId}`)
    const timestamp = now()
    const record: RunRecord = { runId: input.runId, workflowType: input.workflowType, objective: input.objective, status: 'pending', startedAt: timestamp, updatedAt: timestamp, observationRevision: 0, stages: [], providerObservations: [], skillObservations: [], terminal: false }
    this.runs.set(input.runId, record)
    this.knownRunIds.add(input.runId)
    this.persist(record)
    return this.view(record)
  }
  async start<T extends WorkflowOutcome>(runId: string, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const record = this.runs.get(runId)
    if (!record) return Promise.reject(new ApplicationServiceError('not_found', `Workflow run not found: ${runId}`))
    if (record.status !== 'pending') return Promise.reject(new ApplicationServiceError('invalid_input', `Workflow run is not pending: ${runId}`))
    const controller = new AbortController()
    const startedAt = now()
    const started: RunRecord = { ...record, status: 'running', startedAt, updatedAt: startedAt, observationRevision: record.observationRevision + 1, controller, terminal: false, progressSummary: `${record.workflowType} is running` }
    this.runs.set(runId, started)
    this.persist(started)
    try {
      if (this.options.observationStore) await this.flushPersistence(runId, started.observationRevision)
      if (controller.signal.aborted) throw new ApplicationServiceError('cancelled', `Workflow run cancelled: ${runId}`)
      const outcome = await operation(controller.signal)
      const current = this.runs.get(runId)
      if (current && current.status !== 'cancelled' && !controller.signal.aborted) {
        if (outcome.status === 'failed') this.markFailure(runId, outcome.errorSummary ?? outcome.summary ?? 'Workflow failed')
        else if (outcome.status === 'cancelled') this.cancelWorkflow(runId)
        else this.markTerminal(runId, outcome.status, { summary: outcome.summary, reviewCount: outcome.reviewCount, errorSummary: outcome.errorSummary })
      }
      await this.flushPersistence(runId)
      return outcome
    } catch (error) {
      const current = this.runs.get(runId)
      if (current?.status === 'cancelled' || controller.signal.aborted) {
        await this.flushPersistence(runId)
        throw new ApplicationServiceError('cancelled', `Workflow run cancelled: ${runId}`, { cause: error })
      }
      this.markFailure(runId, error)
      await this.flushPersistence(runId)
      throw error
    } finally {
      const current = this.runs.get(runId)
      if (current) { const { controller: _controller, ...withoutController } = current; this.runs.set(runId, withoutController as RunRecord) }
    }
  }
  markTerminal(runId: string, status: TerminalWorkflowStatus, details: { readonly summary?: string; readonly reviewCount?: number; readonly errorSummary?: string } = {}): WorkflowRunView {
    if (!TERMINAL.has(status)) throw new ApplicationServiceError('invalid_input', `Not a terminal status: ${status}`)
    const current = this.require(runId)
    if (current.status === 'cancelled' || current.terminal) return this.view(current)
    if (status === 'failed') return this.markFailure(runId, details.errorSummary ?? details.summary ?? 'Workflow failed')
    const timestamp = now()
    const next: RunRecord = { ...current, status, updatedAt: timestamp, completedAt: timestamp, stages: closeStages(current.stages, status, timestamp), acquisitionActivities: closeAcquisition(current.acquisitionActivities, status, timestamp), skillObservations: closeSkills(current.skillObservations, status, timestamp), observationRevision: current.observationRevision + 1, terminal: true, ...(details.summary === undefined ? {} : { progressSummary: boundedObservationText(details.summary, 'Workflow finished') }), ...(details.reviewCount === undefined ? {} : { reviewCount: details.reviewCount }), ...(details.errorSummary === undefined ? {} : { errorSummary: safeFailureSummary(details.errorSummary) }) }
    this.runs.set(runId, next)
    this.persist(next)
    return this.view(next)
  }
  markAuthoritativeTerminal(runId: string, status: TerminalWorkflowStatus, details: { readonly summary?: string; readonly reviewCount?: number; readonly errorSummary?: string } = {}): WorkflowRunView {
    if (!TERMINAL.has(status)) throw new ApplicationServiceError('invalid_input', `Not a terminal status: ${status}`)
    const current = this.require(runId)
    if (current.terminal && current.status !== 'cancelled') return this.view(current)
    if (status === 'failed') return this.markFailure(runId, details.errorSummary ?? details.summary ?? 'Workflow failed')
    const timestamp = now()
    const next: RunRecord = { ...current, status, updatedAt: timestamp, completedAt: timestamp, stages: closeStages(current.stages, status, timestamp), acquisitionActivities: closeAcquisition(current.acquisitionActivities, status, timestamp), skillObservations: closeSkills(current.skillObservations, status, timestamp), observationRevision: current.observationRevision + 1, terminal: true, ...(details.summary === undefined ? {} : { progressSummary: boundedObservationText(details.summary, 'Workflow finished') }), ...(details.reviewCount === undefined ? {} : { reviewCount: details.reviewCount }), ...(details.errorSummary === undefined ? {} : { errorSummary: safeFailureSummary(details.errorSummary) }) }
    this.runs.set(runId, next)
    this.persist(next)
    return this.view(next)
  }
  markFailure(runId: string, error: unknown): WorkflowRunView {
    const current = this.require(runId)
    if (current.terminal) return this.view(current)
    const timestamp = now(); const message = safeFailureSummary(error)
    const next: RunRecord = { ...current, status: 'failed', updatedAt: timestamp, completedAt: timestamp, stages: closeStages(current.stages, 'failed', timestamp), acquisitionActivities: closeAcquisition(current.acquisitionActivities, 'failed', timestamp), skillObservations: closeSkills(current.skillObservations, 'failed', timestamp), observationRevision: current.observationRevision + 1, terminal: true, errorSummary: message.slice(0, 500), progressSummary: 'Workflow failed' }
    this.runs.set(runId, next); this.persist(next); return this.view(next)
  }
  getWorkflowStatus(runId: string): WorkflowRunView | undefined { const value = this.runs.get(runId); return value === undefined ? undefined : this.liveView(value) }
  async getWorkflowStatusWithHistory(runId: string): Promise<WorkflowRunView | undefined> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u.test(runId)) throw new ApplicationServiceError('invalid_input', 'runId is invalid')
    const active = this.runs.get(runId)
    if (active) return this.liveView(active)
    if (!this.options.observationStore) return undefined
    try {
      const stored = await this.options.observationStore.read(runId)
      if (!stored) return undefined
      const workflow = stored.workflow
      if (workflow.status === 'pending' || workflow.status === 'running') {
        return {
          ...workflow,
          status: 'interrupted',
          stages: workflow.stages.map((stage) => stage.status === 'running' ? { ...stage, status: 'interrupted' as const } : stage),
          acquisitionActivities: workflow.acquisitionActivities?.map((activity) => activity.status === 'running' ? { ...activity, status: 'interrupted' as const } : activity),
          skillObservations: workflow.skillObservations.map((skill) => skill.status === 'running' ? { ...skill, status: 'interrupted' as const } : skill),
          ...(workflow.executionResult === undefined ? {} : { executionResult: { ...workflow.executionResult, executionStatus: 'interrupted' as const, terminalStatus: undefined } }),
          observationSource: 'historical',
          recoveryState: { kind: 'interrupted', lastObservedStatus: workflow.status },
          historyPersistence: { status: 'saved', persistedRevision: workflow.observationRevision },
        }
      }
      return { ...workflow, observationSource: 'historical', historyPersistence: { status: 'saved', persistedRevision: workflow.observationRevision } }
    } catch (error) {
      const code = this.persistenceErrorCode(error)
      throw new ApplicationServiceError('failed', `Workflow history snapshot is unavailable (${code}).`)
    }
  }

  async flushPersistence(runId?: string, expectedRevision?: number): Promise<void> {
    if (runId !== undefined) {
      while (true) {
        const tail = this.persistenceTails.get(runId)
        if (tail) await tail
        const current = this.runs.get(runId)
        const targetRevision = expectedRevision ?? current?.observationRevision
        const state = this.persistenceStates.get(runId)
        if (!this.options.observationStore || targetRevision === undefined || state?.status === 'failed' || state?.status === 'unavailable') return
        if (state?.status === 'saved' && (state.persistedRevision ?? -1) >= targetRevision) return
        if (!this.persistenceTails.has(runId)) return
      }
    }
    while (this.persistenceTails.size > 0) await Promise.all([...this.persistenceTails.values()])
  }

  async confirmPersistence(runId: string): Promise<WorkflowRunView | undefined> {
    await this.flushPersistence(runId)
    return this.getWorkflowStatus(runId)
  }

  private async confirmTransition(runId: string, workflow: WorkflowRunView): Promise<void> { await this.flushPersistence(runId, workflow.observationRevision) }

  private liveView(record: RunRecord): WorkflowRunView {
    const state = this.persistenceStates.get(record.runId)
    return {
      ...this.view(record),
      observationSource: 'live',
      historyPersistence: state ?? { status: this.persistenceAvailable ? 'pending' : 'unavailable' },
    }
  }

  private persist(record: RunRecord): void {
    const store = this.options.observationStore
    if (!store) { this.persistenceStates.set(record.runId, { status: 'unavailable', errorCode: 'store_unconfigured' }); return }
    this.persistenceAvailable = true
    const priorState = this.persistenceStates.get(record.runId)
    this.persistenceStates.set(record.runId, { status: 'pending', ...(priorState?.persistedRevision === undefined ? {} : { persistedRevision: priorState.persistedRevision }) })
    const previous = this.persistenceTails.get(record.runId) ?? Promise.resolve()
    const task = previous.catch(() => undefined).then(async () => {
      try {
        const result = await store.write(this.view(record))
        if (result.state === 'stale') throw new WorkflowObservationStoreError('conflict', 'A newer Workflow snapshot already exists')
        const current = this.runs.get(record.runId)
        const revision = Math.max(result.observationRevision, this.persistenceStates.get(record.runId)?.persistedRevision ?? 0)
        this.persistenceStates.set(record.runId, current && current.observationRevision > record.observationRevision
          ? { status: 'pending', persistedRevision: revision }
          : { status: 'saved', persistedRevision: revision })
      } catch (error) {
        const current = this.runs.get(record.runId)
        const previousRevision = this.persistenceStates.get(record.runId)?.persistedRevision
        this.persistenceStates.set(record.runId, current && current.observationRevision > record.observationRevision
          ? { status: 'pending', ...(previousRevision === undefined ? {} : { persistedRevision: previousRevision }) }
          : { status: 'failed', ...(previousRevision === undefined ? {} : { persistedRevision: previousRevision }), errorCode: this.persistenceErrorCode(error) })
      }
    })
    this.persistenceTails.set(record.runId, task)
    void task.finally(() => { if (this.persistenceTails.get(record.runId) === task) this.persistenceTails.delete(record.runId) })
  }

  private persistenceErrorCode(error: unknown): string {
    if (error instanceof WorkflowObservationStoreError) return error.code
    return 'io'
  }
  startStage(runId: string, stageIdInput: string, labelInput: string, summary?: string): WorkflowRunView {
    const stageId = this.observationId(stageIdInput, 'stageId'); const label = this.observationLabel(labelInput)
    const current = this.require(runId)
    if (current.terminal || current.status !== 'running') return this.view(current)
    const existing = current.stages.find((stage) => stage.stageId === stageId)
    if (existing && existing.status !== 'running') return this.view(current)
    if (existing) return this.view(current)
    const startedAt = now()
    const stage: WorkflowStageView = { stageId, label, status: 'running', startedAt, ...(boundedObservationText(summary, 'Additional details omitted.') === undefined ? {} : { summary: boundedObservationText(summary, 'Additional details omitted.') }) }
    const next: RunRecord = { ...current, stages: [...current.stages, stage], currentStageId: stageId, currentStage: label, progressSummary: summary ? boundedObservationText(summary, 'Additional details omitted.') : label, updatedAt: startedAt, observationRevision: current.observationRevision + 1 }
    this.runs.set(runId, next); this.persist(next); return this.view(next)
  }
  finishStage(runId: string, stageIdInput: string, status: Exclude<WorkflowStageStatus, 'pending' | 'running' | 'interrupted'>, details: { readonly summary?: string; readonly diagnostics?: readonly string[] } = {}): WorkflowRunView {
    if (!terminalStageStatuses.has(status)) throw new ApplicationServiceError('invalid_input', `Not a terminal stage status: ${status}`)
    const stageId = this.observationId(stageIdInput, 'stageId'); const current = this.require(runId)
    if (current.terminal) return this.view(current)
    const index = current.stages.findIndex((stage) => stage.stageId === stageId)
    // A completion without a matching start is not a real observed stage. Ignore
    // out-of-order/duplicate producer events instead of inventing a stage label
    // or a duration with no producer timestamp.
    if (index < 0 || current.stages[index]!.status !== 'running') return this.view(current)
    const timestamp = now(); const previous = current.stages[index]!
    const diagnostics = (details.diagnostics ?? []).filter((item) => safeDiagnostic.test(item)).slice(0, 16)
    const stage: WorkflowStageView = { stageId, label: previous?.label ?? 'Workflow stage', status, ...(previous?.startedAt === undefined ? {} : { startedAt: previous.startedAt }), completedAt: timestamp, ...(observationDuration(previous?.startedAt, timestamp) === undefined ? {} : { durationMs: observationDuration(previous?.startedAt, timestamp) }), ...(boundedObservationText(details.summary, 'Additional details omitted.') === undefined ? {} : { summary: boundedObservationText(details.summary, 'Additional details omitted.') }), diagnostics }
    const stages = current.stages.slice(); stages[index] = stage
    const next: RunRecord = { ...current, stages, currentStageId: stageId, currentStage: stage.label, progressSummary: stage.summary ?? stage.label, updatedAt: timestamp, observationRevision: current.observationRevision + 1 }
    this.runs.set(runId, next); this.persist(next); return this.view(next)
  }
  setAcquisitionActivity(runId: string, activity: WorkflowAcquisitionActivity): WorkflowRunView {
    const current = this.runs.get(runId)
    if (!current) throw new ApplicationServiceError('not_found', 'Workflow run not found')
    if (current.terminal) return this.view(current)
    if (!safeObservationId.test(activity.activityId) || !safeObservationId.test(activity.providerId)
      || !['discovery', 'download', 'body_read', 'parsing', 'structured_data'].includes(activity.step)
      || !['running', 'completed', 'failed', 'timeout', 'cancelled', 'interrupted'].includes(activity.status)
      || !Number.isFinite(Date.parse(activity.startedAt))) throw new ApplicationServiceError('invalid_input', 'Invalid acquisition activity')
    const safe: WorkflowAcquisitionActivity = { ...activity,
      ...(activity.sourceTitle === undefined ? {} : { sourceTitle: boundedObservationText(activity.sourceTitle, 'Research source') }),
      ...(activity.diagnosticCode === undefined ? {} : { diagnosticCode: safeDiagnostic.test(activity.diagnosticCode) ? activity.diagnosticCode : 'PROVIDER_ATTEMPT_FAILED' }),
    }
    const activities = new Map((current.acquisitionActivities ?? []).map((entry) => [entry.activityId, entry]))
    const previous = activities.get(safe.activityId)
    if (previous && previous.status !== 'running') return this.view(current)
    activities.set(safe.activityId, safe)
    const next: RunRecord = { ...current, acquisitionActivities: [...activities.values()].slice(-500), updatedAt: now(), observationRevision: current.observationRevision + 1 }
    this.runs.set(runId, next); this.persist(next)
    return this.view(next)
  }
  setProviderObservations(runId: string, observations: readonly WorkflowProviderObservation[]): WorkflowRunView {
    const current = this.require(runId); if (current.terminal) return this.view(current)
    const prior = new Map(current.providerObservations.map((item) => [item.providerId, item]))
    let changed = false
    for (const item of observations.slice(0, 32)) {
      if (!['success', 'partial', 'unavailable', 'failed', 'skipped'].includes(item.status)) continue
      const providerId = this.observationId(item.providerId, 'providerId'); const label = this.observationLabel(item.label)
      if (prior.has(providerId)) continue
      const startMs = item.startedAt === undefined ? Number.NaN : Date.parse(item.startedAt)
      const endMs = item.completedAt === undefined ? Number.NaN : Date.parse(item.completedAt)
      const validInterval = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs
      const timingInvalid = (item.startedAt !== undefined || item.completedAt !== undefined) && !validInterval
      const diagnostics = item.diagnostics.filter((value) => safeDiagnostic.test(value)).slice(0, timingInvalid ? 15 : 16)
      if (timingInvalid) diagnostics.push('PROVIDER_TIMING_INVALID')
      const start = validInterval ? new Date(startMs).toISOString() : undefined
      const end = validInterval ? new Date(endMs).toISOString() : undefined
      const durationMs = validInterval ? endMs - startMs : undefined
      const recordCount = item.recordCount !== undefined && Number.isSafeInteger(item.recordCount) && item.recordCount >= 0 ? item.recordCount : undefined
      prior.set(providerId, { providerId, label, status: item.status, ...(recordCount === undefined ? {} : { recordCount }), ...(start === undefined ? {} : { startedAt: start }), ...(end === undefined ? {} : { completedAt: end }), ...(durationMs === undefined ? {} : { durationMs }), diagnostics }); changed = true
    }
    if (!changed) return this.view(current)
    const timestamp = now(); const next: RunRecord = { ...current, providerObservations: [...prior.values()].sort((left, right) => left.providerId.localeCompare(right.providerId)), updatedAt: timestamp, observationRevision: current.observationRevision + 1 }
    this.runs.set(runId, next); this.persist(next); return this.view(next)
  }
  startSkill(runId: string, skillIdInput: string, labelInput: string, summary?: string): WorkflowRunView {
    const skillId = this.observationId(skillIdInput, 'skillId'); const label = this.observationLabel(labelInput); const current = this.require(runId)
    if (current.terminal || current.status !== 'running' || current.skillObservations.some((skill) => skill.skillId === skillId)) return this.view(current)
    const startedAt = now(); const skill: WorkflowSkillObservation = { skillId, label, status: 'running', startedAt, ...(boundedObservationText(summary, 'Additional details omitted.') === undefined ? {} : { summary: boundedObservationText(summary, 'Additional details omitted.') }) }
    const next: RunRecord = { ...current, skillObservations: [...current.skillObservations, skill], updatedAt: startedAt, observationRevision: current.observationRevision + 1 }
    this.runs.set(runId, next); this.persist(next); return this.view(next)
  }
  finishSkill(runId: string, skillIdInput: string, status: Exclude<WorkflowSkillObservation['status'], 'interrupted'>, summary?: string): WorkflowRunView {
    if (status === 'running') throw new ApplicationServiceError('invalid_input', 'Skill completion requires a terminal status')
    const skillId = this.observationId(skillIdInput, 'skillId'); const current = this.require(runId)
    if (current.terminal) return this.view(current)
    const index = current.skillObservations.findIndex((skill) => skill.skillId === skillId)
    if (index < 0 || current.skillObservations[index]!.status !== 'running') return this.view(current)
    const timestamp = now(); const previous = current.skillObservations[index]!; const safeSummary = boundedObservationText(summary, 'Additional details omitted.')
    const updated: WorkflowSkillObservation = { ...previous, status, completedAt: timestamp, ...(observationDuration(previous.startedAt, timestamp) === undefined ? {} : { durationMs: observationDuration(previous.startedAt, timestamp) }), ...(safeSummary === undefined ? {} : { summary: safeSummary }) }
    const skills = current.skillObservations.slice(); skills[index] = updated
    const next: RunRecord = { ...current, skillObservations: skills, updatedAt: timestamp, observationRevision: current.observationRevision + 1 }
    this.runs.set(runId, next); this.persist(next); return this.view(next)
  }
  /** Attaches the safe ResearchDispatch result projection to the authoritative in-memory run record. */
  setExecutionResult(runId: string, result: WorkflowExecutionResultProjection): WorkflowRunView {
    if (result.runId !== runId || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(result.workflowId)) throw new ApplicationServiceError('invalid_input', 'Execution result identity does not match its Workflow run')
    const current = this.require(runId)
    const terminalStatus = TERMINAL.has(current.status) ? current.status as TerminalWorkflowStatus : undefined
    const executionResult: WorkflowExecutionResultProjection = current.status === 'cancelled'
      ? { runId, workflowId: result.workflowId, executionStatus: 'cancelled', terminalStatus: 'cancelled', summary: 'Workflow was cancelled.', ...(result.bundleRef !== undefined && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(result.bundleRef) ? { bundleRef: result.bundleRef } : {}), diagnostics: [], bundleStatus: result.bundleStatus }
      : { ...result, executionStatus: current.status, ...(terminalStatus === undefined ? { terminalStatus: undefined } : { terminalStatus }) }
    const next = { ...current, executionResult, updatedAt: now(), observationRevision: current.observationRevision + 1 }
    this.runs.set(runId, next)
    this.persist(next)
    return this.view(next)
  }
  /** Includes pending runs so Runtime configuration cannot change between registration and execution. */
  hasActiveRuns(): boolean { return [...this.runs.values()].some((record) => !record.terminal) }
  cancelWorkflow(runId: string): WorkflowCancelResult {
    const current = this.runs.get(runId)
    if (!current) throw new ApplicationServiceError('not_found', `Workflow run not found: ${runId}`)
    if (current.status === 'running') {
      current.controller?.abort()
      const timestamp = now()
      const next: RunRecord = { ...current, status: 'cancelled', updatedAt: timestamp, completedAt: timestamp, stages: closeStages(current.stages, 'cancelled', timestamp), acquisitionActivities: closeAcquisition(current.acquisitionActivities, 'cancelled', timestamp), skillObservations: closeSkills(current.skillObservations, 'cancelled', timestamp), observationRevision: current.observationRevision + 1, terminal: true, progressSummary: 'Workflow cancelled' }
      this.runs.set(runId, next)
      this.persist(next)
      return { runId, status: 'cancelled', cancelled: true, reason: 'cancelled' }
    }
    return { runId, status: current.status, cancelled: false, reason: current.terminal ? 'already_terminal' : 'not_running' }
  }
  private require(runId: string): RunRecord { const value = this.runs.get(runId); if (!value) throw new ApplicationServiceError('not_found', `Workflow run not found: ${runId}`); return value }
  private observationId(value: string, field: string): string { if (typeof value !== 'string' || !safeObservationId.test(value)) throw new ApplicationServiceError('invalid_input', `${field} is invalid`); return value }
  private observationLabel(value: string): string { const safe = boundedObservationText(value, 'Workflow observation'); return safe ?? 'Workflow observation' }
  private view(record: RunRecord): WorkflowRunView { const { controller: _controller, terminal: _terminal, ...view } = record; return view }
}
