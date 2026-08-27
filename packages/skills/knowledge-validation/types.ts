import type { KnowledgeAssetCollection } from '../../../packages/shared/knowledge-base/types.ts'
import type { ValidatedKnowledgeChangeSet } from '../../../packages/schemas/knowledge/index.ts'
import type { ValidatedKnowledgeChangeSetV03 } from '../../../packages/schemas/knowledge/v03/mutation.ts'

export type ValidationStatus = 'passed' | 'failed'
export type ValidationSeverity = 'error' | 'warning' | 'info'
export type ValidationScope = 'all' | 'manifest' | 'raw' | 'entity' | 'relation' | 'intelligence' | 'module' | 'source' | 'registry'

export interface ValidationDiagnostic {
  code: string
  severity: ValidationSeverity
  message: string
  assetId?: string
  operationId?: string
  filePath?: string
}
export interface ValidationReport {
  status: ValidationStatus
  errors: ValidationDiagnostic[]
  warnings: ValidationDiagnostic[]
  info: ValidationDiagnostic[]
  timestamp: string
  scope: ValidationScope
}

export interface ValidationInput {
  assets: KnowledgeAssetCollection
}

export interface ChangeSetValidationResult {
  report: ValidationReport
  validatedChangeSet?: ValidatedKnowledgeChangeSet
}

export interface ChangeSetValidationResultV03 {
  report: ValidationReport
  validatedChangeSet?: ValidatedKnowledgeChangeSetV03
}

export interface ChangeSetValidationOptions {
  mode?: 'commit' | 'dry_run'
  virtualRawRefs?: readonly string[]
}
