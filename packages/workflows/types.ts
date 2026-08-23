import type { JsonObject } from '../plugins/core/index.ts'

export type WorkflowFieldType = 'string' | 'object' | 'array'

export interface WorkflowFieldSchema {
  type: WorkflowFieldType
  required: boolean
  description: string
}

export type WorkflowSchema = Readonly<Record<string, WorkflowFieldSchema>>

export interface WorkflowStep {
  id: string
  skill: string
  inputs: string[]
  outputs: string[]
  dependsOn: string[]
}

export interface WorkflowDefinition {
  id: string
  name: string
  description: string
  version: string
  purpose: string
  inputSchema: WorkflowSchema
  outputSchema: WorkflowSchema
  steps: WorkflowStep[]
}

export type WorkflowContext = JsonObject
