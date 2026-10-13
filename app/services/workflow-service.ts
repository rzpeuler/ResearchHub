import { ApplicationServiceError, type TerminalWorkflowStatus, type WorkflowCancelResult, type WorkflowExecutionResultProjection, type WorkflowObservationReporter, type WorkflowProviderObservation, type WorkflowRunView, type WorkflowSkillObservation, type WorkflowStageStatus, type WorkflowStageView, type WorkflowStatus } from './contracts.ts'

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
function closeSkills(skills: readonly WorkflowSkillObservation[], status: WorkflowStatus, completedAt: string): readonly WorkflowSkillObservation[] {
  const terminalStatus: WorkflowSkillObservation['status'] = status === 'cancelled' ? 'cancelled' : status === 'failed' || status === 'blocked' ? 'failed' : 'completed'
  return skills.map((skill) => skill.status === 'running'
    ? { ...skill, status: terminalStatus, completedAt, ...(observationDuration(skill.startedAt, completedAt) === undefined ? {} : { durationMs: observationDuration(skill.startedAt, completedAt) }) }
    : skill)
}

export interface WorkflowRegistration { readonly runId: string; readonly workflowType: string; readonly objective: string }
export interface WorkflowOutcome { readonly status: TerminalWorkflowStatus; readonly summary?: string; readonly reviewCount?: number; readonly errorSummary?: string }

export class WorkflowService {
  private readonly runs = new Map<string, RunRecord>()
  observationReporter(runId: string): WorkflowObservationReporter {
    return {
      startStage: (stageId, label, summary) => { this.startStage(runId, stageId, label, summary) },
      finishStage: (stageId, status, details) => { this.finishStage(runId, stageId, status, details) },
      providerObservations: (observations) => { this.setProviderObservations(runId, observations) },
      startSkill: (skillId, label, summary) => { this.startSkill(runId, skillId, label, summary) },
      finishSkill: (skillId, status, summary) => { this.finishSkill(runId, skillId, status, summary) },
    }
  }
  register(input: WorkflowRegistration): WorkflowRunView {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(input.runId)) throw new ApplicationServiceError('invalid_input', 'runId must be a safe deterministic identifier')
    if (this.runs.has(input.runId)) throw new ApplicationServiceError('invalid_input', `Workflow run already exists: ${input.runId}`)
    const timestamp = now()
    const record: RunRecord = { runId: input.runId, workflowType: input.workflowType, objective: input.objective, status: 'pending', startedAt: timestamp, updatedAt: timestamp, observationRevision: 0, stages: [], providerObservations: [], skillObservations: [], terminal: false }
    this.runs.set(input.runId, record)
    return this.view(record)
  }
  start<T extends WorkflowOutcome>(runId: string, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const record = this.runs.get(runId)
    if (!record) return Promise.reject(new ApplicationServiceError('not_found', `Workflow run not found: ${runId}`))
    if (record.status !== 'pending') return Promise.reject(new ApplicationServiceError('invalid_input', `Workflow run is not pending: ${runId}`))
    const controller = new AbortController()
    const startedAt = now()
    this.runs.set(runId, { ...record, status: 'running', startedAt, updatedAt: startedAt, observationRevision: record.observationRevision + 1, controller, terminal: false, progressSummary: `${record.workflowType} is running` })
    return operation(controller.signal).then((outcome) => {
      const current = this.runs.get(runId)
      if (!current || current.status === 'cancelled' || controller.signal.aborted) return outcome
      if (outcome.status === 'failed') this.markFailure(runId, outcome.errorSummary ?? outcome.summary ?? 'Workflow failed')
      else if (outcome.status === 'cancelled') this.cancelWorkflow(runId)
      else this.markTerminal(runId, outcome.status, { summary: outcome.summary, reviewCount: outcome.reviewCount, errorSummary: outcome.errorSummary })
      return outcome
    }).catch((error) => {
      const current = this.runs.get(runId)
      if (current?.status === 'cancelled' || controller.signal.aborted) throw new ApplicationServiceError('cancelled', `Workflow run cancelled: ${runId}`, { cause: error })
      this.markFailure(runId, error)
      throw error
    }).finally(() => {
      const current = this.runs.get(runId)
      if (current) { const { controller: _controller, ...withoutController } = current; this.runs.set(runId, withoutController as RunRecord) }
    })
  }
  markTerminal(runId: string, status: TerminalWorkflowStatus, details: { readonly summary?: string; readonly reviewCount?: number; readonly errorSummary?: string } = {}): WorkflowRunView {
    if (!TERMINAL.has(status)) throw new ApplicationServiceError('invalid_input', `Not a terminal status: ${status}`)
    const current = this.require(runId)
    if (current.status === 'cancelled' || current.terminal) return this.view(current)
    if (status === 'failed') return this.markFailure(runId, details.errorSummary ?? details.summary ?? 'Workflow failed')
    const timestamp = now()
    const next: RunRecord = { ...current, status, updatedAt: timestamp, completedAt: timestamp, stages: closeStages(current.stages, status, timestamp), skillObservations: closeSkills(current.skillObservations, status, timestamp), observationRevision: current.observationRevision + 1, terminal: true, ...(details.summary === undefined ? {} : { progressSummary: boundedObservationText(details.summary, 'Workflow finished') }), ...(details.reviewCount === undefined ? {} : { reviewCount: details.reviewCount }), ...(details.errorSummary === undefined ? {} : { errorSummary: safeFailureSummary(details.errorSummary) }) }
    this.runs.set(runId, next)
    return this.view(next)
  }
  markAuthoritativeTerminal(runId: string, status: TerminalWorkflowStatus, details: { readonly summary?: string; readonly reviewCount?: number; readonly errorSummary?: string } = {}): WorkflowRunView {
    if (!TERMINAL.has(status)) throw new ApplicationServiceError('invalid_input', `Not a terminal status: ${status}`)
    const current = this.require(runId)
    if (current.terminal && current.status !== 'cancelled') return this.view(current)
    if (status === 'failed') return this.markFailure(runId, details.errorSummary ?? details.summary ?? 'Workflow failed')
    const timestamp = now()
    const next: RunRecord = { ...current, status, updatedAt: timestamp, completedAt: timestamp, stages: closeStages(current.stages, status, timestamp), skillObservations: closeSkills(current.skillObservations, status, timestamp), observationRevision: current.observationRevision + 1, terminal: true, ...(details.summary === undefined ? {} : { progressSummary: boundedObservationText(details.summary, 'Workflow finished') }), ...(details.reviewCount === undefined ? {} : { reviewCount: details.reviewCount }), ...(details.errorSummary === undefined ? {} : { errorSummary: safeFailureSummary(details.errorSummary) }) }
    this.runs.set(runId, next)
    return this.view(next)
  }
  markFailure(runId: string, error: unknown): WorkflowRunView {
    const current = this.require(runId)
    if (current.terminal) return this.view(current)
    const timestamp = now(); const message = safeFailureSummary(error)
    const next: RunRecord = { ...current, status: 'failed', updatedAt: timestamp, completedAt: timestamp, stages: closeStages(current.stages, 'failed', timestamp), skillObservations: closeSkills(current.skillObservations, 'failed', timestamp), observationRevision: current.observationRevision + 1, terminal: true, errorSummary: message.slice(0, 500), progressSummary: 'Workflow failed' }
    this.runs.set(runId, next); return this.view(next)
  }
  getWorkflowStatus(runId: string): WorkflowRunView | undefined { const value = this.runs.get(runId); return value === undefined ? undefined : this.view(value) }
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
    this.runs.set(runId, next); return this.view(next)
  }
  finishStage(runId: string, stageIdInput: string, status: Exclude<WorkflowStageStatus, 'pending' | 'running'>, details: { readonly summary?: string; readonly diagnostics?: readonly string[] } = {}): WorkflowRunView {
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
    this.runs.set(runId, next); return this.view(next)
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
    this.runs.set(runId, next); return this.view(next)
  }
  startSkill(runId: string, skillIdInput: string, labelInput: string, summary?: string): WorkflowRunView {
    const skillId = this.observationId(skillIdInput, 'skillId'); const label = this.observationLabel(labelInput); const current = this.require(runId)
    if (current.terminal || current.status !== 'running' || current.skillObservations.some((skill) => skill.skillId === skillId)) return this.view(current)
    const startedAt = now(); const skill: WorkflowSkillObservation = { skillId, label, status: 'running', startedAt, ...(boundedObservationText(summary, 'Additional details omitted.') === undefined ? {} : { summary: boundedObservationText(summary, 'Additional details omitted.') }) }
    const next: RunRecord = { ...current, skillObservations: [...current.skillObservations, skill], updatedAt: startedAt, observationRevision: current.observationRevision + 1 }
    this.runs.set(runId, next); return this.view(next)
  }
  finishSkill(runId: string, skillIdInput: string, status: WorkflowSkillObservation['status'], summary?: string): WorkflowRunView {
    if (status === 'running') throw new ApplicationServiceError('invalid_input', 'Skill completion requires a terminal status')
    const skillId = this.observationId(skillIdInput, 'skillId'); const current = this.require(runId)
    if (current.terminal) return this.view(current)
    const index = current.skillObservations.findIndex((skill) => skill.skillId === skillId)
    if (index < 0 || current.skillObservations[index]!.status !== 'running') return this.view(current)
    const timestamp = now(); const previous = current.skillObservations[index]!; const safeSummary = boundedObservationText(summary, 'Additional details omitted.')
    const updated: WorkflowSkillObservation = { ...previous, status, completedAt: timestamp, ...(observationDuration(previous.startedAt, timestamp) === undefined ? {} : { durationMs: observationDuration(previous.startedAt, timestamp) }), ...(safeSummary === undefined ? {} : { summary: safeSummary }) }
    const skills = current.skillObservations.slice(); skills[index] = updated
    const next: RunRecord = { ...current, skillObservations: skills, updatedAt: timestamp, observationRevision: current.observationRevision + 1 }
    this.runs.set(runId, next); return this.view(next)
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
      this.runs.set(runId, { ...current, status: 'cancelled', updatedAt: timestamp, completedAt: timestamp, stages: closeStages(current.stages, 'cancelled', timestamp), skillObservations: closeSkills(current.skillObservations, 'cancelled', timestamp), observationRevision: current.observationRevision + 1, terminal: true, progressSummary: 'Workflow cancelled' })
      return { runId, status: 'cancelled', cancelled: true, reason: 'cancelled' }
    }
    return { runId, status: current.status, cancelled: false, reason: current.terminal ? 'already_terminal' : 'not_running' }
  }
  private require(runId: string): RunRecord { const value = this.runs.get(runId); if (!value) throw new ApplicationServiceError('not_found', `Workflow run not found: ${runId}`); return value }
  private observationId(value: string, field: string): string { if (typeof value !== 'string' || !safeObservationId.test(value)) throw new ApplicationServiceError('invalid_input', `${field} is invalid`); return value }
  private observationLabel(value: string): string { const safe = boundedObservationText(value, 'Workflow observation'); return safe ?? 'Workflow observation' }
  private view(record: RunRecord): WorkflowRunView { const { controller: _controller, terminal: _terminal, ...view } = record; return view }
}
