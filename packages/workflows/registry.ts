import { WorkflowDuplicateError, WorkflowNotFoundError } from './errors.ts'
import { validateWorkflowDefinition } from './validation.ts'
import type { WorkflowDefinition } from './types.ts'

export class WorkflowRegistry {
  private readonly definitions = new Map<string, WorkflowDefinition>()

  register(definition: WorkflowDefinition): WorkflowDefinition {
    validateWorkflowDefinition(definition)
    if (this.definitions.has(definition.id)) throw new WorkflowDuplicateError(definition.id)
    const snapshot = structuredClone(definition)
    this.definitions.set(snapshot.id, snapshot)
    return structuredClone(snapshot)
  }

  get(workflowId: string): WorkflowDefinition {
    if (typeof workflowId !== 'string' || workflowId.trim().length === 0) throw new WorkflowNotFoundError(String(workflowId))
    const definition = this.definitions.get(workflowId)
    if (definition === undefined) throw new WorkflowNotFoundError(workflowId)
    return structuredClone(definition)
  }

  has(workflowId: string): boolean {
    return this.definitions.has(workflowId)
  }

  list(): string[] {
    return [...this.definitions.keys()]
  }
}
