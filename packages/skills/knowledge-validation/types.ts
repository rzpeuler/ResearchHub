import type { KnowledgeAssetCollection } from '../knowledge-access/types.ts'

export type ValidationStatus = 'passed' | 'failed'
export type ValidationSeverity = 'error' | 'warning' | 'info'
export type ValidationScope = 'all' | 'entity' | 'relation' | 'intelligence' | 'module' | 'source'

export interface ValidationDiagnostic {
  code: string
  severity: ValidationSeverity
  message: string
  assetId?: string
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
