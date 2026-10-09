import { ApplicationServiceError } from './contracts.ts'

export type ResearchRequestMode =
  | { readonly type: 'free_research' }
  | { readonly type: 'workflow'; readonly workflowId: string }

export interface ResearchContextPolicy {
  readonly structuredKnowledge: boolean
  readonly sourceLibrary: boolean
}

export interface ResearchPersistencePolicy {
  readonly writeKnowledge: boolean
}

export interface ResearchRequest {
  readonly query: string
  readonly mode: ResearchRequestMode
  readonly contextPolicy: ResearchContextPolicy
  readonly persistencePolicy: ResearchPersistencePolicy
  readonly attachments?: readonly string[]
}

export interface ResearchDispatchEntity {
  readonly type: string
  readonly value: string
  readonly confidence: number
}

export interface ResearchDispatchWorkflow {
  readonly id: string
  readonly confidence: number
  readonly arguments: Readonly<Record<string, unknown>>
}

export interface ResearchDispatchSkill {
  readonly id: string
  readonly purpose: string
}

export type ResearchDispatchMode = 'workflow' | 'skill_plan' | 'free_research'

export interface ResearchDispatchDecision {
  readonly mode: ResearchDispatchMode
  readonly workflow?: ResearchDispatchWorkflow
  readonly skills: readonly ResearchDispatchSkill[]
  readonly entities: readonly ResearchDispatchEntity[]
  readonly missingRequiredInputs: readonly string[]
  readonly contextPolicy: ResearchContextPolicy
  readonly persistencePolicy: ResearchPersistencePolicy
  readonly rationale: string
}

export interface ResearchExecutionSummary {
  readonly mode: 'Free Research' | 'Explicit Workflow'
  readonly workflowId?: string
  readonly workflowLabel?: string
  readonly selectedSkillIds: readonly string[]
  readonly argumentsStatus: 'not_required' | 'extracted' | 'missing'
  readonly argumentKeys: readonly string[]
  readonly contextPolicy: ResearchContextPolicy
  readonly persistencePolicy: ResearchPersistencePolicy
}

const DEFAULT_CONTEXT_POLICY: ResearchContextPolicy = Object.freeze({ structuredKnowledge: true, sourceLibrary: true })
const DEFAULT_PERSISTENCE_POLICY: ResearchPersistencePolicy = Object.freeze({ writeKnowledge: false })

export function defaultResearchContextPolicy(): ResearchContextPolicy {
  return { ...DEFAULT_CONTEXT_POLICY }
}

export function defaultResearchPersistencePolicy(): ResearchPersistencePolicy {
  return { ...DEFAULT_PERSISTENCE_POLICY }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw invalid(`${label} must be an object`)
  return value as Record<string, unknown>
}

function nonEmptyString(value: unknown, label: string, maxLength = 5000): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) throw invalid(`${label} must be a non-empty string of at most ${maxLength} characters`)
  return value.trim()
}

function booleanField(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw invalid(`${label} must be a boolean`)
  return value
}

function confidence(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw invalid(`${label} must be a finite number between 0 and 1`)
  return value
}

function safeId(value: unknown, label: string): string {
  const id = nonEmptyString(value, label, 160)
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) throw invalid(`${label} contains unsafe characters`)
  return id
}

function policy(value: unknown, label: string, requiredKeys: readonly string[]): ResearchContextPolicy | ResearchPersistencePolicy {
  const input = record(value, label)
  const keys = Object.keys(input)
  if (keys.some((key) => !requiredKeys.includes(key)) || requiredKeys.some((key) => !keys.includes(key))) throw invalid(`${label} must declare exactly ${requiredKeys.join(', ')}`)
  const output = Object.fromEntries(Object.entries(input).map(([key, item]) => [key, booleanField(item, `${label}.${key}`)]))
  return output as unknown as ResearchContextPolicy | ResearchPersistencePolicy
}

export function normalizeResearchRequest(input: unknown): ResearchRequest {
  const value = record(input, 'ResearchRequest')
  const query = nonEmptyString(value.query, 'query')
  let mode: ResearchRequestMode
  if (value.mode === undefined) mode = { type: 'free_research' }
  else {
    const modeInput = record(value.mode, 'mode')
    if (modeInput.type === 'free_research') mode = { type: 'free_research' }
    else if (modeInput.type === 'workflow') mode = { type: 'workflow', workflowId: safeId(modeInput.workflowId, 'mode.workflowId') }
    else throw invalid('mode.type must be free_research or workflow')
  }
  const contextPolicy = value.contextPolicy === undefined ? defaultResearchContextPolicy() : policy(value.contextPolicy, 'contextPolicy', ['structuredKnowledge', 'sourceLibrary']) as unknown as ResearchContextPolicy
  const persistencePolicy = value.persistencePolicy === undefined ? defaultResearchPersistencePolicy() : policy(value.persistencePolicy, 'persistencePolicy', ['writeKnowledge']) as unknown as ResearchPersistencePolicy
  let attachments: readonly string[] | undefined
  if (value.attachments !== undefined) {
    if (!Array.isArray(value.attachments) || value.attachments.length > 20) throw invalid('attachments must be an array of at most 20 IDs')
    attachments = value.attachments.map((item, index) => safeId(item, `attachments[${index}]`))
  }
  return { query, mode, contextPolicy, persistencePolicy, ...(attachments === undefined ? {} : { attachments }) }
}

function dispatchSkill(value: unknown, index: number): ResearchDispatchSkill {
  const input = record(value, `skills[${index}]`)
  return { id: safeId(input.id, `skills[${index}].id`), purpose: nonEmptyString(input.purpose, `skills[${index}].purpose`, 500) }
}

function dispatchEntity(value: unknown, index: number): ResearchDispatchEntity {
  const input = record(value, `entities[${index}]`)
  return { type: nonEmptyString(input.type, `entities[${index}].type`, 80), value: nonEmptyString(input.value, `entities[${index}].value`, 500), confidence: confidence(input.confidence, `entities[${index}].confidence`) }
}

function dispatchWorkflow(value: unknown): ResearchDispatchWorkflow {
  const input = record(value, 'workflow')
  const args = record(input.arguments, 'workflow.arguments')
  const keys = Object.keys(args)
  if (keys.length > 30 || keys.some((key) => !/^[A-Za-z][A-Za-z0-9._-]*$/.test(key))) throw invalid('workflow.arguments contains unsafe keys')
  return { id: safeId(input.id, 'workflow.id'), confidence: confidence(input.confidence, 'workflow.confidence'), arguments: { ...args } }
}

export function validateResearchDispatchDecision(input: unknown): ResearchDispatchDecision {
  const value = record(input, 'ResearchDispatchDecision')
  if (value.mode !== 'workflow' && value.mode !== 'skill_plan' && value.mode !== 'free_research') throw invalid('mode must be workflow, skill_plan, or free_research')
  if (!Array.isArray(value.skills) || value.skills.length > 20) throw invalid('skills must be an array of at most 20 items')
  if (!Array.isArray(value.entities) || value.entities.length > 50) throw invalid('entities must be an array of at most 50 items')
  if (!Array.isArray(value.missingRequiredInputs) || value.missingRequiredInputs.length > 50) throw invalid('missingRequiredInputs must be an array of at most 50 items')
  const skills = value.skills.map(dispatchSkill)
  const entities = value.entities.map(dispatchEntity)
  const missingRequiredInputs = value.missingRequiredInputs.map((item, index) => nonEmptyString(item, `missingRequiredInputs[${index}]`, 160))
  const contextPolicy = policy(value.contextPolicy, 'contextPolicy', ['structuredKnowledge', 'sourceLibrary']) as ResearchContextPolicy
  const persistencePolicy = policy(value.persistencePolicy, 'persistencePolicy', ['writeKnowledge']) as ResearchPersistencePolicy
  const workflow = value.workflow === undefined ? undefined : dispatchWorkflow(value.workflow)
  if (value.mode === 'workflow' && workflow === undefined) throw invalid('workflow is required when mode is workflow')
  if (value.mode !== 'workflow' && workflow !== undefined) throw invalid('workflow is only allowed when mode is workflow')
  return { mode: value.mode, ...(workflow === undefined ? {} : { workflow }), skills, entities, missingRequiredInputs, contextPolicy, persistencePolicy, rationale: nonEmptyString(value.rationale, 'rationale', 2000) }
}

function invalid(message: string): ApplicationServiceError {
  return new ApplicationServiceError('invalid_input', message)
}
