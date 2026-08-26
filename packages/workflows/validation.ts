import { WorkflowValidationError } from './errors.ts'
import type { WorkflowDefinition, WorkflowFieldSchema, WorkflowSchema, WorkflowStep } from './types.ts'

export function validateWorkflowDefinition(value: unknown): asserts value is WorkflowDefinition {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new WorkflowValidationError('workflow definition must be an object')
  }
  const definition = value as Record<string, unknown>
  assertString(definition.id, '$.id')
  assertString(definition.name, '$.name')
  assertString(definition.description, '$.description')
  assertString(definition.version, '$.version')
  assertString(definition.purpose, '$.purpose')
  validateSchema(definition.inputSchema, '$.inputSchema')
  validateSchema(definition.outputSchema, '$.outputSchema')
  if (!Array.isArray(definition.steps) || definition.steps.length === 0) {
    throw new WorkflowValidationError('workflow must contain at least one step', '$.steps')
  }
  const ids = new Set<string>()
  for (const [index, step] of definition.steps.entries()) {
    validateStep(step, index)
    if (ids.has(step.id)) throw new WorkflowValidationError('workflow step IDs must be unique', `$.steps[${index}].id`)
    ids.add(step.id)
  }
  for (const [index, step] of definition.steps.entries()) {
    for (const dependency of step.dependsOn) {
      if (!ids.has(dependency)) throw new WorkflowValidationError('workflow step dependency must reference an existing step', `$.steps[${index}].dependsOn`)
      if (dependency === step.id) throw new WorkflowValidationError('workflow step cannot depend on itself', `$.steps[${index}].dependsOn`)
    }
  }
}

function validateSchema(value: unknown, path: string): asserts value is WorkflowSchema {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new WorkflowValidationError('workflow schema must be an object', path)
  }
  for (const [name, field] of Object.entries(value)) {
    if (!/^\w+$/.test(name)) throw new WorkflowValidationError('workflow schema field name is invalid', `${path}.${name}`)
    validateFieldSchema(field, `${path}.${name}`)
  }
}

function validateFieldSchema(value: unknown, path: string): asserts value is WorkflowFieldSchema {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new WorkflowValidationError('workflow field schema must be an object', path)
  }
  const field = value as Record<string, unknown>
  if (field.type !== 'string' && field.type !== 'object' && field.type !== 'array') {
    throw new WorkflowValidationError('workflow field type is invalid', `${path}.type`)
  }
  if (typeof field.required !== 'boolean') throw new WorkflowValidationError('workflow field required must be boolean', `${path}.required`)
  assertString(field.description, `${path}.description`)
}

function validateStep(value: unknown, index: number): asserts value is WorkflowStep {
  const path = `$.steps[${index}]`
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new WorkflowValidationError('workflow step must be an object', path)
  }
  const step = value as Record<string, unknown>
  assertString(step.id, `${path}.id`)
  if (step.kind !== undefined && step.kind !== 'skill' && step.kind !== 'infrastructure' && step.kind !== 'workflow') throw new WorkflowValidationError('workflow step kind is invalid', `${path}.kind`)
  if (step.kind === 'infrastructure' || step.kind === 'workflow') assertString(step.component, `${path}.component`)
  else assertString(step.skill, `${path}.skill`)
  assertStringArray(step.inputs, `${path}.inputs`)
  assertStringArray(step.outputs, `${path}.outputs`)
  assertStringArray(step.dependsOn, `${path}.dependsOn`)
}

function assertString(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new WorkflowValidationError('expected a non-empty string', path)
}

function assertStringArray(value: unknown, path: string): asserts value is string[] {
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string' && item.trim().length > 0)) {
    throw new WorkflowValidationError('expected a string array', path)
  }
}
