export type WorkflowStageStatus = 'pending' | 'running' | 'completed' | 'skipped' | 'failed' | 'blocked' | 'cancelled'
export type WorkflowDataAvailabilityStatus = 'success' | 'partial' | 'unavailable' | 'failed' | 'skipped'
export interface WorkflowStageView {
  readonly stageId: string
  readonly label: string
  readonly status: WorkflowStageStatus
  readonly startedAt?: string
  readonly completedAt?: string
  readonly durationMs?: number
  readonly summary?: string
  readonly diagnostics?: readonly string[]
}
export interface WorkflowProviderObservation {
  readonly providerId: string
  readonly label: string
  readonly status: WorkflowDataAvailabilityStatus
  readonly recordCount?: number
  readonly startedAt?: string
  readonly completedAt?: string
  readonly durationMs?: number
  readonly diagnostics: readonly string[]
}
export interface WorkflowSkillObservation {
  readonly skillId: string
  readonly label: string
  readonly status: Exclude<WorkflowStageStatus, 'pending' | 'blocked' | 'skipped'>
  readonly startedAt?: string
  readonly completedAt?: string
  readonly durationMs?: number
  readonly summary?: string
}
export interface WorkflowObservationReporter {
  readonly startStage: (stageId: string, label: string, summary?: string) => void
  readonly finishStage: (stageId: string, status: Exclude<WorkflowStageStatus, 'pending' | 'running'>, details?: { readonly summary?: string; readonly diagnostics?: readonly string[] }) => void
  readonly providerObservations: (observations: readonly WorkflowProviderObservation[]) => void
  readonly startSkill: (skillId: string, label: string, summary?: string) => void
  readonly finishSkill: (skillId: string, status: WorkflowSkillObservation['status'], summary?: string) => void
}
