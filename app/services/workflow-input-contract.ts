import { Ajv, type ErrorObject } from 'ajv'

export interface WorkflowInputValidation {
  readonly valid: boolean
  readonly errors: readonly string[]
  readonly missingFields: readonly string[]
}

const ajv = new Ajv({ allErrors: true, strict: true, strictRequired: false })
ajv.addFormat('iso-date-time', {
  type: 'string',
  validate: (value: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)),
})
ajv.addFormat('iso-date', { type: 'string', validate: (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value })
ajv.addFormat('uri', { type: 'string', validate: (value: string) => { try { const parsed = new URL(value); return parsed.protocol === 'http:' || parsed.protocol === 'https:' } catch { return false } } })

function renderError(error: ErrorObject): string {
  const path = error.instancePath || '$'
  if (error.keyword === 'required') return `${path}.${String(error.params.missingProperty)} is required`
  if (error.keyword === 'additionalProperties') return `${path}.${String(error.params.additionalProperty)} is not allowed by this Workflow input contract`
  return `${path} ${error.message ?? 'is invalid'}`
}

export function validateWorkflowInputSchema(schema: Readonly<Record<string, unknown>>, input: unknown): WorkflowInputValidation {
  const validate = ajv.compile(schema as never)
  validate(input)
  const issues = validate.errors ?? []
  // AJV reports an `if` error alongside the branch's `required` error when a
  // conditional Workflow field is missing. Treat that as a missing input,
  // while retaining any real type/enum/additional-property errors in the
  // branch as INVALID_INPUT.
  const onlyMissingRequirements = issues.length > 0
    && issues.some((error) => error.keyword === 'required')
    && issues.every((error) => error.keyword === 'required' || error.keyword === 'if')
  const reportedIssues = onlyMissingRequirements ? issues.filter((error) => error.keyword !== 'if') : issues
  const errors = reportedIssues.map(renderError)
  const missingFields = (validate.errors ?? [])
    .filter((error) => error.keyword === 'required' && error.instancePath === '')
    .map((error) => String(error.params.missingProperty))
    .concat((validate.errors ?? []).filter((error) => error.keyword === 'required' && error.instancePath !== '').map((error) => `${error.instancePath}/${String(error.params.missingProperty)}`))
    .sort()
  return { valid: reportedIssues.every((error) => error.keyword === 'required'), errors, missingFields }
}

export function assertWorkflowInputSchema(schema: Readonly<Record<string, unknown>>, requiredInputs: readonly string[], id: string): void {
  const root = schema as { readonly type?: unknown; readonly properties?: unknown; readonly required?: unknown; readonly additionalProperties?: unknown }
  if (root.type !== 'object' || root.properties === null || typeof root.properties !== 'object' || Array.isArray(root.properties)) throw new Error(`Workflow inputSchema must be a JSON Schema object with properties: ${id}`)
  if (root.additionalProperties !== false) throw new Error(`Workflow inputSchema must reject additional properties: ${id}`)
  const properties = root.properties as Record<string, unknown>
  const schemaRequired = Array.isArray(root.required) ? root.required : []
  if (schemaRequired.some((field) => typeof field !== 'string') || [...schemaRequired].sort().join('\0') !== [...requiredInputs].sort().join('\0')) throw new Error(`Workflow requiredInputs must exactly match inputSchema.required: ${id}`)
  if (requiredInputs.some((field) => !Object.hasOwn(properties, field))) throw new Error(`Workflow required input is not declared in inputSchema.properties: ${id}`)
  ajv.compile(schema as never)
}

export function requiredWorkflowInputFields(schema: Readonly<Record<string, unknown>>): readonly string[] {
  const required = (schema as { readonly required?: unknown }).required
  return Array.isArray(required) ? required.filter((field): field is string => typeof field === 'string').sort() : []
}

export const ISO_DATE_TIME_SCHEMA = Object.freeze({ type: 'string', format: 'iso-date-time', description: 'ISO date-time with an explicit timezone.' })

export const strictObjectSchema = (properties: Readonly<Record<string, unknown>>, required: readonly string[] = []): Readonly<Record<string, unknown>> => ({
  type: 'object',
  properties,
  ...(required.length === 0 ? {} : { required: [...required] }),
  additionalProperties: false,
})
