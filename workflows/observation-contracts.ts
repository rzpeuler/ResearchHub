export type WorkflowStageStatus = 'pending' | 'running' | 'completed' | 'skipped' | 'failed' | 'blocked' | 'cancelled' | 'interrupted'
export type WorkflowDataAvailabilityStatus = 'success' | 'partial' | 'unavailable' | 'failed' | 'skipped'
export interface WorkflowAcquisitionActivity {
  readonly activityId: string
  readonly providerId: string
  readonly step: 'discovery' | 'download' | 'body_read' | 'parsing' | 'structured_data'
  readonly status: 'running' | 'completed' | 'failed' | 'timeout' | 'cancelled' | 'interrupted'
  readonly sourceTitle?: string
  readonly startedAt: string
  readonly completedAt?: string
  readonly diagnosticCode?: string
}
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
  readonly acquisitionActivity?: (activity: WorkflowAcquisitionActivity) => Promise<void>
  readonly startStage: (stageId: string, label: string, summary?: string) => Promise<void>
  readonly finishStage: (stageId: string, status: Exclude<WorkflowStageStatus, 'pending' | 'running' | 'interrupted'>, details?: { readonly summary?: string; readonly diagnostics?: readonly string[] }) => Promise<void>
  readonly providerObservations: (observations: readonly WorkflowProviderObservation[]) => Promise<void>
  readonly startSkill: (skillId: string, label: string, summary?: string) => Promise<void>
  readonly finishSkill: (skillId: string, status: Exclude<WorkflowSkillObservation['status'], 'interrupted'>, summary?: string) => Promise<void>
}
