import { KnowledgeBaseRegistry } from '../registry/registry.ts'
import { allocateEntityId, allocateKnowledgeId, normalizeSemanticText } from '../registry/id-allocation.ts'
import type { KnowledgeInvestmentThemeV04, KnowledgeAssetV04, KnowledgeThemeGroupV04 } from '../schema/domain-v04.ts'
import type { KnowledgeBaseHandle } from '../storage/handle.ts'
import { hashKnowledgeObject } from '../storage/canonical-hash.ts'
import { loadKnowledgeBaseManifest } from '../storage/manifest-loader.ts'
import { readCanonicalV04Assets } from '../storage/canonical-v04-loader.ts'
import type { KnowledgeChangeSetV04, KnowledgeOperationV04, KnowledgeWriteResultV04 } from '../schema/mutation-v04.ts'
import { validateKnowledgeChangeSetV04 } from '../validation/v04-change-set-validator.ts'
import { writeKnowledgeBase } from '../writer/writer.ts'

export const DEFAULT_THEME_GROUP_REF_V04 = 'theme-group:default' as const
export const DEFAULT_THEME_GROUP_NAME_V04 = 'Default'

export type ThemeManagementStatusV04 = 'committed' | 'already_committed' | 'no_changes' | 'blocked' | 'failed'

export interface ThemeManagementErrorV04 {
  readonly code: string
  readonly message: string
}

export interface ThemeManagementResultV04 {
  readonly status: ThemeManagementStatusV04
  readonly knowledgeBaseId: string
  readonly baseRevision: number
  readonly knowledgeBaseRevision: number
  readonly changeSetId?: string
  readonly themeRef?: string
  readonly themeGroupRef?: string
  readonly targetThemeGroupRef?: string
  readonly createdIds: readonly string[]
  readonly updatedIds: readonly string[]
  readonly errors: readonly ThemeManagementErrorV04[]
  readonly notices: readonly string[]
}

export type ThemeCreationPlanV04 =
  | { readonly status: 'planned'; readonly result: ThemeManagementResultV04; readonly operations: readonly KnowledgeOperationV04[] }
  | { readonly status: 'no_changes' | 'blocked' | 'failed'; readonly result: ThemeManagementResultV04; readonly operations: readonly [] }

type ThemeRefsV04 = { readonly themeRef?: string; readonly themeGroupRef?: string; readonly targetThemeGroupRef?: string }

export interface CreateThemeV04Input {
  readonly name: string
  readonly themeGroupRef?: string
  readonly definition?: string | null
  readonly inclusionCriteria?: readonly string[]
  readonly exclusionCriteria?: readonly string[]
}

export interface CreateThemeGroupV04Input {
  readonly name: string
  readonly description?: string | null
  readonly sortOrder?: number | null
}

export interface UpdateThemeV04Input {
  readonly themeRef: string
  readonly definition?: string | null
  readonly inclusionCriteria?: readonly string[]
  readonly exclusionCriteria?: readonly string[]
}

export interface RenameThemeGroupV04Input {
  readonly themeGroupRef: string
  readonly name: string
}

export interface MoveThemeV04Input {
  readonly themeRef: string
  readonly targetThemeGroupRef: string
}

export interface ArchiveThemeGroupV04Input {
  readonly themeGroupRef: string
  readonly targetThemeGroupRef?: string
}

export interface ThemeManagementGatewayV04Options {
  readonly registry?: KnowledgeBaseRegistry
  readonly clock?: () => string
  readonly writer?: typeof writeKnowledgeBase
}

interface CanonicalThemeState {
  readonly groups: readonly KnowledgeThemeGroupV04[]
  readonly themes: readonly KnowledgeInvestmentThemeV04[]
  readonly byId: ReadonlyMap<string, KnowledgeAssetV04>
}

interface StateRead {
  readonly state?: CanonicalThemeState
  readonly error?: ThemeManagementErrorV04
  readonly currentRevision?: number
}

const MAX_NAME_LENGTH = 256
const MAX_DESCRIPTION_LENGTH = 4096
const MAX_DEFINITION_LENGTH = 8192
const MAX_CRITERIA = 64
const MAX_CRITERION_LENGTH = 2048
const DEFAULT_GROUP_NOTICE = 'theme-group:default is the protected V1 system fallback.'
const GROUP_ARCHIVE_NOTICE = 'ThemeGroup was archived; its canonical record and references remain available.'

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function baseResult(handle: KnowledgeBaseHandle): Pick<ThemeManagementResultV04, 'knowledgeBaseId' | 'baseRevision' | 'knowledgeBaseRevision' | 'createdIds' | 'updatedIds' | 'errors' | 'notices'> {
  return {
    knowledgeBaseId: handle.knowledgeBaseId,
    baseRevision: handle.revision,
    knowledgeBaseRevision: handle.revision,
    createdIds: [],
    updatedIds: [],
    errors: [],
    notices: [],
  }
}

function blocked(handle: KnowledgeBaseHandle, code: string, message: string, refs: ThemeRefsV04 = {}, knowledgeBaseRevision = handle.revision, notices: readonly string[] = []): ThemeManagementResultV04 {
  return { status: 'blocked', ...baseResult(handle), ...refs, knowledgeBaseRevision, errors: [{ code, message }], notices }
}

function failed(handle: KnowledgeBaseHandle, code: string, message: string, refs: ThemeRefsV04 = {}, knowledgeBaseRevision = handle.revision): ThemeManagementResultV04 {
  return { status: 'failed', ...baseResult(handle), ...refs, knowledgeBaseRevision, errors: [{ code, message }], notices: [] }
}

function active(value: { readonly lifecycle?: { readonly status?: string } }): boolean {
  return value.lifecycle?.status === 'active'
}

function normalizedName(value: string): string {
  return normalizeSemanticText(value)
}

function cleanedName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ')
}

function validateName(value: unknown, label: string): ThemeManagementErrorV04 | undefined {
  if (typeof value !== 'string' || value.trim() === '' || value.length > MAX_NAME_LENGTH) {
    return { code: 'THEME_MANAGEMENT_NAME_INVALID', message: `${label} name must be a non-empty string of at most ${MAX_NAME_LENGTH} characters` }
  }
  return undefined
}

function validCriteriaArray(value: unknown): value is readonly string[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > MAX_CRITERIA || Object.getOwnPropertySymbols(value).length > 0) return false
  for (const key of Object.getOwnPropertyNames(value)) {
    if (key === 'length') continue
    const index = Number(key)
    if (!Number.isInteger(index) || index < 0 || index >= value.length || String(index) !== key) return false
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return false
    const item = descriptor.value
    if (typeof item !== 'string' || item.trim() === '' || item.length > MAX_CRITERION_LENGTH) return false
  }
  return true
}

function validateThemeFields(input: unknown): ThemeManagementErrorV04 | undefined {
  if (!record(input)) return { code: 'THEME_MANAGEMENT_INPUT_INVALID', message: 'Theme creation input must be an object' }
  const nameError = validateName(input.name, 'InvestmentTheme')
  if (nameError) return nameError
  if (input.themeGroupRef !== undefined && (typeof input.themeGroupRef !== 'string' || !input.themeGroupRef.startsWith('theme-group:'))) {
    return { code: 'THEME_GROUP_REF_INVALID', message: 'themeGroupRef must be a canonical ThemeGroup reference' }
  }
  if (input.definition !== undefined && input.definition !== null && (typeof input.definition !== 'string' || input.definition.trim() === '' || input.definition.length > MAX_DEFINITION_LENGTH)) {
    return { code: 'THEME_MANAGEMENT_DEFINITION_INVALID', message: `Theme definition must be a non-empty string or null with at most ${MAX_DEFINITION_LENGTH} characters` }
  }
  for (const field of ['inclusionCriteria', 'exclusionCriteria'] as const) {
    const values = input[field]
    if (values === undefined) continue
    if (!validCriteriaArray(values)) {
      return { code: 'THEME_MANAGEMENT_CRITERIA_INVALID', message: `${field} must contain at most ${MAX_CRITERIA} non-empty strings of at most ${MAX_CRITERION_LENGTH} characters` }
    }
  }
  return undefined
}

function validateGroupFields(input: unknown): ThemeManagementErrorV04 | undefined {
  if (!record(input)) return { code: 'THEME_MANAGEMENT_INPUT_INVALID', message: 'ThemeGroup creation input must be an object' }
  const nameError = validateName(input.name, 'ThemeGroup')
  if (nameError) return nameError
  if (input.description !== undefined && input.description !== null && (typeof input.description !== 'string' || input.description.length > MAX_DESCRIPTION_LENGTH)) {
    return { code: 'THEME_MANAGEMENT_DESCRIPTION_INVALID', message: `ThemeGroup description must be a string or null with at most ${MAX_DESCRIPTION_LENGTH} characters` }
  }
  if (input.sortOrder !== undefined && input.sortOrder !== null && (typeof input.sortOrder !== 'number' || !Number.isFinite(input.sortOrder))) {
    return { code: 'THEME_MANAGEMENT_SORT_ORDER_INVALID', message: 'ThemeGroup sortOrder must be a finite number or null' }
  }
  return undefined
}

function validateThemeUpdateFields(input: unknown): ThemeManagementErrorV04 | undefined {
  if (!record(input)) return { code: 'THEME_MANAGEMENT_INPUT_INVALID', message: 'Theme update input must be an object' }
  if (typeof input.themeRef !== 'string' || !input.themeRef.startsWith('entity:')) return { code: 'THEME_REF_INVALID', message: 'themeRef must be a canonical Entity reference' }
  const allowedFields = new Set(['themeRef', 'definition', 'inclusionCriteria', 'exclusionCriteria'])
  if (Object.keys(input).some((key) => !allowedFields.has(key))) return { code: 'THEME_UPDATE_FIELD_UNSUPPORTED', message: 'Theme updates can change definition and criteria only; the required name is preserved' }
  if (!['definition', 'inclusionCriteria', 'exclusionCriteria'].some((field) => Object.hasOwn(input, field))) return { code: 'THEME_UPDATE_EMPTY', message: 'Theme update must provide a definition or criteria field' }
  if (input.definition !== undefined && input.definition !== null && (typeof input.definition !== 'string' || input.definition.trim() === '' || input.definition.length > MAX_DEFINITION_LENGTH)) {
    return { code: 'THEME_MANAGEMENT_DEFINITION_INVALID', message: `Theme definition must be a non-empty string or null with at most ${MAX_DEFINITION_LENGTH} characters` }
  }
  for (const field of ['inclusionCriteria', 'exclusionCriteria'] as const) {
    const values = input[field]
    if (values !== undefined && !validCriteriaArray(values)) {
      return { code: 'THEME_MANAGEMENT_CRITERIA_INVALID', message: `${field} must contain at most ${MAX_CRITERIA} non-empty strings of at most ${MAX_CRITERION_LENGTH} characters` }
    }
  }
  return undefined
}

function sameCriteria(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  return hashKnowledgeObject(left ?? null) === hashKnowledgeObject(right ?? null)
}

function canonicalThemeRequestMatches(theme: KnowledgeInvestmentThemeV04, input: CreateThemeV04Input): boolean {
  return normalizedName(theme.name) === normalizedName(input.name)
    && (theme.definition ?? null) === (input.definition ?? null)
    && sameCriteria(theme.inclusionCriteria, input.inclusionCriteria)
    && sameCriteria(theme.exclusionCriteria, input.exclusionCriteria)
    && theme.themeGroupRef === (input.themeGroupRef ?? DEFAULT_THEME_GROUP_REF_V04)
}

function makeChangeSet(handle: KnowledgeBaseHandle, action: string, identity: unknown, operations: readonly KnowledgeOperationV04[]): KnowledgeChangeSetV04 {
  const digest = hashKnowledgeObject({ knowledgeBaseId: handle.knowledgeBaseId, expectedBaseRevision: handle.revision, action, identity }).slice('sha256:'.length, 'sha256:'.length + 24)
  return {
    changeSetId: `theme-management-${digest}`,
    workflowRunId: `theme-mgmt-${digest}`,
    knowledgeBaseId: handle.knowledgeBaseId,
    schemaVersion: '0.4',
    storageFormatVersion: '1',
    expectedBaseRevision: handle.revision,
    operations,
    ingestionContext: { producerType: 'theme_management', operation: action },
  }
}

function createOperation(operationId: string, object: KnowledgeAssetV04): KnowledgeOperationV04 {
  return { operationId, type: 'create', object }
}

function updateOperation(operationId: string, before: KnowledgeAssetV04, object: KnowledgeAssetV04): KnowledgeOperationV04 {
  return { operationId, type: 'update', knowledgeId: before.id, expectedBeforeHash: hashKnowledgeObject(before), object }
}

export class ThemeManagementGatewayV04 {
  private readonly registry: KnowledgeBaseRegistry
  private readonly clock: () => string
  private readonly writer: typeof writeKnowledgeBase

  constructor(options: ThemeManagementGatewayV04Options = {}) {
    this.registry = options.registry ?? new KnowledgeBaseRegistry()
    this.clock = options.clock ?? (() => new Date().toISOString())
    this.writer = options.writer ?? writeKnowledgeBase
  }

  async ensureDefaultThemeGroup(handle: KnowledgeBaseHandle): Promise<ThemeManagementResultV04> {
    const read = await this.readState(handle)
    if (!read.state) return this.readFailure(handle, read)
    const byId = read.state.byId.get(DEFAULT_THEME_GROUP_REF_V04)
    if (byId) {
      if (!byId.id.startsWith('theme-group:')) return blocked(handle, 'THEME_DEFAULT_ID_COLLISION', 'The reserved default ThemeGroup reference is occupied by an incompatible asset', { themeGroupRef: DEFAULT_THEME_GROUP_REF_V04 })
      const group = byId as KnowledgeThemeGroupV04
      if (!active(group)) return blocked(handle, 'THEME_DEFAULT_GROUP_ARCHIVED', 'The V1 system fallback ThemeGroup must remain active', { themeGroupRef: DEFAULT_THEME_GROUP_REF_V04 }, handle.revision, [DEFAULT_GROUP_NOTICE])
      if (normalizedName(group.name) !== normalizedName(DEFAULT_THEME_GROUP_NAME_V04)) return blocked(handle, 'THEME_DEFAULT_GROUP_IDENTITY_INVALID', 'The reserved default ThemeGroup must keep its system name “Default”', { themeGroupRef: DEFAULT_THEME_GROUP_REF_V04 }, handle.revision, [DEFAULT_GROUP_NOTICE])
      return this.noChanges(handle, { themeGroupRef: DEFAULT_THEME_GROUP_REF_V04 }, [DEFAULT_GROUP_NOTICE])
    }
    if (read.state.groups.some((group) => normalizedName(group.name) === normalizedName(DEFAULT_THEME_GROUP_NAME_V04))) {
      return blocked(handle, 'THEME_GROUP_NAME_DUPLICATE', 'Another ThemeGroup already uses the reserved default name “Default”', { themeGroupRef: DEFAULT_THEME_GROUP_REF_V04 }, handle.revision, [DEFAULT_GROUP_NOTICE])
    }
    const group: KnowledgeThemeGroupV04 = {
      id: DEFAULT_THEME_GROUP_REF_V04,
      name: DEFAULT_THEME_GROUP_NAME_V04,
      aliases: [],
      lifecycle: { status: 'active' },
    }
    return this.commit(handle, 'ensure_default_group', { themeGroupRef: DEFAULT_THEME_GROUP_REF_V04 }, [createOperation('create-default-theme-group', group)], { themeGroupRef: group.id }, [DEFAULT_GROUP_NOTICE])
  }

  async createTheme(handle: KnowledgeBaseHandle, input: CreateThemeV04Input): Promise<ThemeManagementResultV04> {
    const plan = await this.planCreateTheme(handle, input)
    if (plan.status !== 'planned') return plan.result
    return this.commit(handle, 'create_theme', { theme: { ...input, name: cleanedName(input.name) }, themeGroupRef: plan.result.themeGroupRef }, plan.operations, { themeRef: plan.result.themeRef, themeGroupRef: plan.result.themeGroupRef })
  }

  /** Read-only A3 planning seam for composing Theme creation into a larger atomic ChangeSet. */
  async planCreateTheme(handle: KnowledgeBaseHandle, input: CreateThemeV04Input): Promise<ThemeCreationPlanV04> {
    const fieldError = validateThemeFields(input)
    if (fieldError) return { status: 'blocked', result: blocked(handle, fieldError.code, fieldError.message), operations: [] }
    const read = await this.readState(handle)
    if (!read.state) return { status: 'blocked', result: this.readFailure(handle, read), operations: [] }
    const name = cleanedName(input.name)
    const themeId = allocateEntityId('investment_theme', normalizedName(name)) as `entity:${string}`
    const existingById = read.state.byId.get(themeId)
    const request = { ...input, name }
    if (existingById) {
      if (!existingById.id.startsWith('entity:') || (existingById as KnowledgeInvestmentThemeV04).type !== 'investment_theme') return { status: 'blocked', result: blocked(handle, 'THEME_ID_COLLISION', `Stable Theme identity is occupied by an incompatible object: ${themeId}`, { themeRef: themeId }), operations: [] }
      const theme = existingById as KnowledgeInvestmentThemeV04
      if (!active(theme)) return { status: 'blocked', result: blocked(handle, 'THEME_ARCHIVED', `An archived InvestmentTheme already uses this normalized name: ${theme.id}`, { themeRef: theme.id, themeGroupRef: theme.themeGroupRef }), operations: [] }
      if (!canonicalThemeRequestMatches(theme, request)) return { status: 'blocked', result: blocked(handle, 'THEME_NAME_DUPLICATE', `A Theme with normalized name “${name}” already exists with different fields`, { themeRef: theme.id, themeGroupRef: theme.themeGroupRef }), operations: [] }
      const group = read.state.byId.get(theme.themeGroupRef) as KnowledgeThemeGroupV04 | undefined
      if (!group || !active(group)) return { status: 'blocked', result: blocked(handle, 'THEME_GROUP_NOT_ACTIVE', `Existing Theme ${theme.id} does not reference an active ThemeGroup`, { themeRef: theme.id, themeGroupRef: theme.themeGroupRef }), operations: [] }
      return { status: 'no_changes', result: this.noChanges(handle, { themeRef: theme.id, themeGroupRef: theme.themeGroupRef }), operations: [] }
    }
    const normalized = normalizedName(name)
    const nameMatch = read.state.themes.find((theme) => normalizedName(theme.name) === normalized)
    if (nameMatch) return { status: 'blocked', result: blocked(handle, 'THEME_NAME_DUPLICATE', `A Theme with normalized name “${name}” already exists`, { themeRef: nameMatch.id, themeGroupRef: nameMatch.themeGroupRef }), operations: [] }

    const requestedGroupRef = input.themeGroupRef
    if (requestedGroupRef !== undefined && (typeof requestedGroupRef !== 'string' || !requestedGroupRef.startsWith('theme-group:'))) return { status: 'blocked', result: blocked(handle, 'THEME_GROUP_REF_INVALID', 'themeGroupRef must be a canonical ThemeGroup reference'), operations: [] }
    const selectedGroupRef = requestedGroupRef ?? DEFAULT_THEME_GROUP_REF_V04
    let selectedGroup = read.state.byId.get(selectedGroupRef) as KnowledgeThemeGroupV04 | undefined
    const operations: KnowledgeOperationV04[] = []
    if (!selectedGroup && requestedGroupRef !== undefined) return { status: 'blocked', result: blocked(handle, 'THEME_GROUP_NOT_FOUND', `ThemeGroup reference does not resolve: ${selectedGroupRef}`, { themeRef: themeId, themeGroupRef: selectedGroupRef }), operations: [] }
    if (!selectedGroup && selectedGroupRef === DEFAULT_THEME_GROUP_REF_V04) {
      if (read.state.groups.some((group) => normalizedName(group.name) === normalizedName(DEFAULT_THEME_GROUP_NAME_V04))) return { status: 'blocked', result: blocked(handle, 'THEME_GROUP_NAME_DUPLICATE', 'Another ThemeGroup already uses the reserved default name “Default”', { themeGroupRef: DEFAULT_THEME_GROUP_REF_V04 }, handle.revision, [DEFAULT_GROUP_NOTICE]), operations: [] }
      selectedGroup = { id: DEFAULT_THEME_GROUP_REF_V04, name: DEFAULT_THEME_GROUP_NAME_V04, aliases: [], lifecycle: { status: 'active' } }
      operations.push(createOperation('create-default-theme-group', selectedGroup))
    }
    if (!selectedGroup || !active(selectedGroup)) return { status: 'blocked', result: blocked(handle, 'THEME_GROUP_NOT_ACTIVE', `InvestmentTheme must reference an active ThemeGroup: ${selectedGroupRef}`, { themeRef: themeId, themeGroupRef: selectedGroupRef }), operations: [] }

    const now = this.clock()
    const theme: KnowledgeInvestmentThemeV04 = {
      id: themeId,
      type: 'investment_theme',
      name,
      themeGroupRef: selectedGroup.id,
      ...(input.definition === undefined || input.definition === null ? {} : { definition: input.definition }),
      ...(input.inclusionCriteria === undefined ? {} : { inclusionCriteria: [...input.inclusionCriteria] }),
      ...(input.exclusionCriteria === undefined ? {} : { exclusionCriteria: [...input.exclusionCriteria] }),
      lifecycle: { status: 'active' },
      createdAt: now,
      updatedAt: now,
    }
    operations.push(createOperation('create-investment-theme', theme))
    return {
      status: 'planned',
      result: { status: 'no_changes', ...baseResult(handle), themeRef: theme.id, themeGroupRef: selectedGroup.id },
      operations,
    }
  }

  async updateTheme(handle: KnowledgeBaseHandle, input: UpdateThemeV04Input): Promise<ThemeManagementResultV04> {
    const fieldError = validateThemeUpdateFields(input)
    if (fieldError) return blocked(handle, fieldError.code, fieldError.message, record(input) ? { themeRef: typeof input.themeRef === 'string' ? input.themeRef : undefined } : {})
    const read = await this.readState(handle)
    if (!read.state) return this.readFailure(handle, read, { themeRef: input.themeRef })
    const themeAsset = read.state.byId.get(input.themeRef)
    if (!themeAsset || !themeAsset.id.startsWith('entity:') || (themeAsset as KnowledgeInvestmentThemeV04).type !== 'investment_theme') return blocked(handle, 'THEME_NOT_FOUND', `InvestmentTheme reference does not resolve: ${input.themeRef}`, { themeRef: input.themeRef })
    const theme = themeAsset as KnowledgeInvestmentThemeV04
    if (!active(theme)) return blocked(handle, 'THEME_NOT_ACTIVE', `InvestmentTheme is archived: ${theme.id}`, { themeRef: theme.id, themeGroupRef: theme.themeGroupRef })
    const nameError = validateName(theme.name, 'InvestmentTheme')
    if (nameError) return blocked(handle, 'THEME_NAME_REQUIRED', 'An InvestmentTheme update must preserve its required non-empty name', { themeRef: theme.id, themeGroupRef: theme.themeGroupRef })

    const hasDefinition = Object.hasOwn(input, 'definition')
    const hasInclusion = Object.hasOwn(input, 'inclusionCriteria')
    const hasExclusion = Object.hasOwn(input, 'exclusionCriteria')
    const nextDefinition = hasDefinition ? input.definition : theme.definition
    const nextInclusion = hasInclusion ? input.inclusionCriteria : theme.inclusionCriteria
    const nextExclusion = hasExclusion ? input.exclusionCriteria : theme.exclusionCriteria
    const changed = (hasDefinition && theme.definition !== nextDefinition)
      || (hasInclusion && !sameCriteria(theme.inclusionCriteria, nextInclusion))
      || (hasExclusion && !sameCriteria(theme.exclusionCriteria, nextExclusion))
    if (!changed) return this.noChanges(handle, { themeRef: theme.id, themeGroupRef: theme.themeGroupRef })

    const patch = {
      ...(hasDefinition ? { definition: nextDefinition } : {}),
      ...(hasInclusion ? { inclusionCriteria: nextInclusion ? [...nextInclusion] : nextInclusion } : {}),
      ...(hasExclusion ? { exclusionCriteria: nextExclusion ? [...nextExclusion] : nextExclusion } : {}),
    }
    const updated: KnowledgeInvestmentThemeV04 = { ...theme, ...patch, updatedAt: this.clock() }
    const operation = updateOperation('update-investment-theme', theme as unknown as KnowledgeAssetV04, updated as unknown as KnowledgeAssetV04)
    return this.commit(handle, 'update_theme', { themeRef: theme.id, patch }, [operation], { themeRef: theme.id, themeGroupRef: theme.themeGroupRef })
  }

  async createThemeGroup(handle: KnowledgeBaseHandle, input: CreateThemeGroupV04Input): Promise<ThemeManagementResultV04> {
    const fieldError = validateGroupFields(input)
    if (fieldError) return blocked(handle, fieldError.code, fieldError.message)
    const read = await this.readState(handle)
    if (!read.state) return this.readFailure(handle, read)
    const name = cleanedName(input.name)
    const key = normalizedName(name)
    const groupId = allocateKnowledgeId('theme-group', { normalizedName: key }) as `theme-group:${string}`
    const existingById = read.state.byId.get(groupId)
    if (existingById) {
      if (!existingById.id.startsWith('theme-group:')) return blocked(handle, 'THEME_GROUP_ID_COLLISION', `Stable ThemeGroup identity is occupied by an incompatible object: ${groupId}`, { themeGroupRef: groupId })
      const group = existingById as KnowledgeThemeGroupV04
      if (!active(group)) return blocked(handle, 'THEME_GROUP_ARCHIVED', `An archived ThemeGroup already uses this normalized name: ${group.id}`, { themeGroupRef: group.id })
      if (normalizedName(group.name) === key && group.description === input.description && group.sortOrder === input.sortOrder) return this.noChanges(handle, { themeGroupRef: group.id })
      return blocked(handle, 'THEME_GROUP_NAME_DUPLICATE', `A ThemeGroup with normalized name “${name}” already exists with different fields`, { themeGroupRef: group.id })
    }
    const collision = read.state.groups.find((group) => normalizedName(group.name) === key)
    if (collision) return blocked(handle, 'THEME_GROUP_NAME_DUPLICATE', `A ThemeGroup with normalized name “${name}” already exists`, { themeGroupRef: collision.id })
    if (key === normalizedName(DEFAULT_THEME_GROUP_NAME_V04)) return blocked(handle, 'THEME_GROUP_RESERVED_NAME', 'The name “Default” is reserved for the protected V1 system fallback', { themeGroupRef: DEFAULT_THEME_GROUP_REF_V04 }, handle.revision, [DEFAULT_GROUP_NOTICE])
    const group: KnowledgeThemeGroupV04 = {
      id: groupId,
      name,
      aliases: [],
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }),
      lifecycle: { status: 'active' },
    }
    return this.commit(handle, 'create_theme_group', { name: key, description: input.description ?? null, sortOrder: input.sortOrder ?? null }, [createOperation('create-theme-group', group)], { themeGroupRef: group.id })
  }

  async renameThemeGroup(handle: KnowledgeBaseHandle, input: RenameThemeGroupV04Input): Promise<ThemeManagementResultV04> {
    if (!record(input)) return blocked(handle, 'THEME_MANAGEMENT_INPUT_INVALID', 'ThemeGroup rename input must be an object')
    const nameError = validateName(input.name, 'ThemeGroup')
    if (nameError) return blocked(handle, nameError.code, nameError.message, { themeGroupRef: input.themeGroupRef })
    const read = await this.readState(handle)
    if (!read.state) return this.readFailure(handle, read, { themeGroupRef: input.themeGroupRef })
    if (input.themeGroupRef === DEFAULT_THEME_GROUP_REF_V04) return blocked(handle, 'THEME_DEFAULT_GROUP_PROTECTED', 'The V1 system fallback ThemeGroup cannot be renamed', { themeGroupRef: input.themeGroupRef }, handle.revision, [DEFAULT_GROUP_NOTICE])
    const group = read.state.byId.get(input.themeGroupRef)
    if (!group || !group.id.startsWith('theme-group:')) return blocked(handle, 'THEME_GROUP_NOT_FOUND', `ThemeGroup reference does not resolve: ${input.themeGroupRef}`, { themeGroupRef: input.themeGroupRef })
    const oldGroup = group as KnowledgeThemeGroupV04
    if (!active(oldGroup)) return blocked(handle, 'THEME_GROUP_NOT_ACTIVE', `ThemeGroup is archived: ${oldGroup.id}`, { themeGroupRef: oldGroup.id })
    const name = cleanedName(input.name)
    const key = normalizedName(name)
    if (key === normalizedName(DEFAULT_THEME_GROUP_NAME_V04)) return blocked(handle, 'THEME_GROUP_RESERVED_NAME', 'The name “Default” is reserved for the protected V1 system fallback', { themeGroupRef: DEFAULT_THEME_GROUP_REF_V04 }, handle.revision, [DEFAULT_GROUP_NOTICE])
    const duplicate = read.state.groups.find((item) => item.id !== oldGroup.id && normalizedName(item.name) === key)
    if (duplicate) return blocked(handle, 'THEME_GROUP_NAME_DUPLICATE', `A ThemeGroup with normalized name “${name}” already exists`, { themeGroupRef: duplicate.id })
    if (oldGroup.name === name) return this.noChanges(handle, { themeGroupRef: oldGroup.id })
    const updated: KnowledgeThemeGroupV04 = { ...oldGroup, name }
    const operation = updateOperation('rename-theme-group', oldGroup as unknown as KnowledgeAssetV04, updated as unknown as KnowledgeAssetV04)
    return this.commit(handle, 'rename_theme_group', { themeGroupRef: oldGroup.id, name: key }, [operation], { themeGroupRef: oldGroup.id })
  }

  async moveTheme(handle: KnowledgeBaseHandle, input: MoveThemeV04Input): Promise<ThemeManagementResultV04> {
    if (!record(input)) return blocked(handle, 'THEME_MANAGEMENT_INPUT_INVALID', 'Theme move input must be an object')
    const read = await this.readState(handle)
    if (!read.state) return this.readFailure(handle, read, { themeRef: input.themeRef, themeGroupRef: input.targetThemeGroupRef })
    const themeAsset = read.state.byId.get(input.themeRef)
    if (!themeAsset || !themeAsset.id.startsWith('entity:') || (themeAsset as KnowledgeInvestmentThemeV04).type !== 'investment_theme') return blocked(handle, 'THEME_NOT_FOUND', `InvestmentTheme reference does not resolve: ${input.themeRef}`, { themeRef: input.themeRef, themeGroupRef: input.targetThemeGroupRef })
    const theme = themeAsset as KnowledgeInvestmentThemeV04
    if (!active(theme)) return blocked(handle, 'THEME_NOT_ACTIVE', `InvestmentTheme is archived: ${theme.id}`, { themeRef: theme.id, themeGroupRef: input.targetThemeGroupRef })
    const targetAsset = read.state.byId.get(input.targetThemeGroupRef)
    if (!targetAsset || !targetAsset.id.startsWith('theme-group:')) return blocked(handle, 'THEME_GROUP_NOT_FOUND', `Target ThemeGroup reference does not resolve: ${input.targetThemeGroupRef}`, { themeRef: theme.id, themeGroupRef: input.targetThemeGroupRef })
    const target = targetAsset as KnowledgeThemeGroupV04
    if (!active(target)) return blocked(handle, 'THEME_GROUP_NOT_ACTIVE', `Target ThemeGroup is archived: ${target.id}`, { themeRef: theme.id, themeGroupRef: target.id })
    if (theme.themeGroupRef === target.id) return this.noChanges(handle, { themeRef: theme.id, themeGroupRef: target.id })
    const updated: KnowledgeInvestmentThemeV04 = { ...theme, themeGroupRef: target.id, updatedAt: this.clock() }
    const operation = updateOperation('move-investment-theme', theme as unknown as KnowledgeAssetV04, updated as unknown as KnowledgeAssetV04)
    return this.commit(handle, 'move_theme', { themeRef: theme.id, targetThemeGroupRef: target.id }, [operation], { themeRef: theme.id, themeGroupRef: target.id })
  }

  /**
   * Deleting a ThemeGroup is a lifecycle archive so canonical refs remain valid.
   * The default group is protected. Every referencing Theme, including archived
   * Themes, moves before the group is archived in the same ChangeSet and Writer transaction.
   */
  async deleteThemeGroup(handle: KnowledgeBaseHandle, input: ArchiveThemeGroupV04Input): Promise<ThemeManagementResultV04> {
    if (!record(input)) return blocked(handle, 'THEME_MANAGEMENT_INPUT_INVALID', 'ThemeGroup archive input must be an object')
    const read = await this.readState(handle)
    if (!read.state) return this.readFailure(handle, read, { themeGroupRef: input.themeGroupRef })
    if (input.themeGroupRef === DEFAULT_THEME_GROUP_REF_V04) return blocked(handle, 'THEME_DEFAULT_GROUP_PROTECTED', 'The protected V1 system fallback ThemeGroup cannot be deleted or archived', { themeGroupRef: input.themeGroupRef }, handle.revision, [DEFAULT_GROUP_NOTICE])
    const groupAsset = read.state.byId.get(input.themeGroupRef)
    if (!groupAsset || !groupAsset.id.startsWith('theme-group:')) return blocked(handle, 'THEME_GROUP_NOT_FOUND', `ThemeGroup reference does not resolve: ${input.themeGroupRef}`, { themeGroupRef: input.themeGroupRef })
    const group = groupAsset as KnowledgeThemeGroupV04
    const themesToMigrate = read.state.themes.filter((theme) => theme.themeGroupRef === group.id).sort((left, right) => left.id.localeCompare(right.id))
    if (!active(group) && themesToMigrate.some(active)) return blocked(handle, 'THEME_GROUP_ARCHIVED_WITH_ACTIVE_THEMES', 'Archived ThemeGroup still has active Themes and cannot be treated as a completed deletion', { themeGroupRef: group.id })
    if (!active(group) && themesToMigrate.length === 0) return this.noChanges(handle, { themeGroupRef: group.id }, [GROUP_ARCHIVE_NOTICE])
    if (themesToMigrate.length > 0 && input.targetThemeGroupRef === undefined) return blocked(handle, 'THEME_GROUP_TARGET_REQUIRED', 'Archiving a non-empty ThemeGroup requires an explicit active target ThemeGroup for every referenced Theme', { themeGroupRef: group.id })
    const operations: KnowledgeOperationV04[] = []
    let target: KnowledgeThemeGroupV04 | undefined
    if (input.targetThemeGroupRef !== undefined) {
      const targetAsset = read.state.byId.get(input.targetThemeGroupRef)
      if (!targetAsset || !targetAsset.id.startsWith('theme-group:')) return blocked(handle, 'THEME_GROUP_NOT_FOUND', `Target ThemeGroup reference does not resolve: ${input.targetThemeGroupRef}`, { themeGroupRef: input.targetThemeGroupRef })
      target = targetAsset as KnowledgeThemeGroupV04
      if (!active(target)) return blocked(handle, 'THEME_GROUP_NOT_ACTIVE', `Target ThemeGroup is archived: ${target.id}`, { themeGroupRef: target.id })
      if (target.id === group.id) return blocked(handle, 'THEME_GROUP_TARGET_INVALID', 'ThemeGroup cannot be its own migration target', { themeGroupRef: group.id })
    }
    if (themesToMigrate.length > 0 && !target) return blocked(handle, 'THEME_GROUP_TARGET_REQUIRED', 'Archiving a non-empty ThemeGroup requires an explicit active target ThemeGroup', { themeGroupRef: group.id })
    if (target) {
      const now = this.clock()
      for (const theme of themesToMigrate) {
        const updated: KnowledgeInvestmentThemeV04 = { ...theme, themeGroupRef: target.id, updatedAt: now }
        operations.push(updateOperation(`move-theme-${operations.length + 1}`, theme as unknown as KnowledgeAssetV04, updated as unknown as KnowledgeAssetV04))
      }
    }
    if (active(group)) {
      const archived: KnowledgeThemeGroupV04 = { ...group, lifecycle: { ...group.lifecycle, status: 'archived' } }
      operations.push(updateOperation(`archive-theme-group-${operations.length + 1}`, group as unknown as KnowledgeAssetV04, archived as unknown as KnowledgeAssetV04))
    }
    return this.commit(handle, 'delete_theme_group', { themeGroupRef: group.id, targetThemeGroupRef: target?.id ?? null, migratedThemeRefs: themesToMigrate.map((theme) => theme.id) }, operations, { themeGroupRef: group.id, ...(target ? { targetThemeGroupRef: target.id } : {}) }, [GROUP_ARCHIVE_NOTICE])
  }

  async archiveThemeGroup(handle: KnowledgeBaseHandle, input: ArchiveThemeGroupV04Input): Promise<ThemeManagementResultV04> {
    return this.deleteThemeGroup(handle, input)
  }

  private async readState(handle: KnowledgeBaseHandle): Promise<StateRead> {
    if (!handle || handle.schemaVersion !== '0.4' || handle.storageFormatVersion !== '1') return { error: { code: 'THEME_MANAGEMENT_VERSION_UNSUPPORTED', message: 'Theme management requires a Schema 0.4 / Storage Format 1 Knowledge Base' } }
    if (!handle.writable || handle.status !== 'active') return { error: { code: 'THEME_MANAGEMENT_HANDLE_NOT_WRITABLE', message: 'Theme management requires an active writable Knowledge Base handle' } }
    try {
      const manifest = await loadKnowledgeBaseManifest(handle.rootRef)
      if (manifest.knowledgeBaseId !== handle.knowledgeBaseId || manifest.schemaVersion !== '0.4' || manifest.storageFormatVersion !== '1' || manifest.status !== 'active') {
        return { error: { code: 'THEME_MANAGEMENT_HANDLE_MISMATCH', message: 'Knowledge Base manifest identity or writable state no longer matches the mounted handle' }, currentRevision: manifest.revision }
      }
      if (manifest.revision !== handle.revision) return { error: { code: 'THEME_MANAGEMENT_STALE_HANDLE', message: `Mounted handle revision ${handle.revision} is stale; current Knowledge Base revision is ${manifest.revision}` }, currentRevision: manifest.revision }
      const assets = await readCanonicalV04Assets(handle.rootRef)
      const byId = new Map<string, KnowledgeAssetV04>(assets.objects.map((item) => [item.value.id, item.value]))
      return {
        state: {
          groups: assets.objects.filter((item) => item.kind === 'theme_group').map((item) => item.value as KnowledgeThemeGroupV04),
          themes: assets.objects.filter((item) => item.kind === 'entity' && (item.value as { type?: string }).type === 'investment_theme').map((item) => item.value as KnowledgeInvestmentThemeV04),
          byId,
        },
        currentRevision: manifest.revision,
      }
    } catch (error) {
      return { error: { code: 'THEME_MANAGEMENT_STATE_READ_FAILED', message: error instanceof Error ? error.message : String(error) } }
    }
  }

  private readFailure(handle: KnowledgeBaseHandle, read: StateRead, refs: ThemeRefsV04 = {}): ThemeManagementResultV04 {
    const error = read.error ?? { code: 'THEME_MANAGEMENT_STATE_READ_FAILED', message: 'Unable to read canonical Theme state' }
    return blocked(handle, error.code, error.message, refs, read.currentRevision ?? handle.revision)
  }

  private noChanges(handle: KnowledgeBaseHandle, refs: ThemeRefsV04 = {}, notices: readonly string[] = []): ThemeManagementResultV04 {
    return { status: 'no_changes', ...baseResult(handle), ...refs, notices }
  }

  private async commit(handle: KnowledgeBaseHandle, action: string, identity: unknown, operations: readonly KnowledgeOperationV04[], refs: ThemeRefsV04 = {}, notices: readonly string[] = []): Promise<ThemeManagementResultV04> {
    if (operations.length === 0) return this.noChanges(handle, refs, notices)
    const changeSet = makeChangeSet(handle, action, identity, operations)
    const validation = await validateKnowledgeChangeSetV04(handle, changeSet, { mode: 'commit', now: this.clock })
    if (!validation.validatedChangeSet) {
      return {
        status: 'blocked', ...baseResult(handle), ...refs,
        changeSetId: changeSet.changeSetId,
        errors: validation.report.errors.map((error) => ({ code: error.code, message: error.message })),
        notices,
      }
    }
    let result: KnowledgeWriteResultV04
    try {
      result = await this.writer(handle, validation.validatedChangeSet, { registry: this.registry, clock: this.clock }) as KnowledgeWriteResultV04
    } catch (error) {
      return failed(handle, 'THEME_MANAGEMENT_WRITER_FAILED', error instanceof Error ? error.message : String(error), refs)
    }
    if (result.status === 'rejected' || result.status === 'failed') {
      return {
        status: 'failed', ...baseResult(handle), ...refs,
        changeSetId: result.changeSetId,
        knowledgeBaseRevision: result.committedRevision,
        errors: [{ code: result.error?.code ?? 'THEME_MANAGEMENT_WRITER_REJECTED', message: result.error?.message ?? 'Shared Writer rejected the validated Theme management ChangeSet' }],
        notices,
      }
    }
    return {
      status: result.status,
      knowledgeBaseId: result.knowledgeBaseId,
      baseRevision: result.baseRevision,
      knowledgeBaseRevision: result.committedRevision,
      changeSetId: result.changeSetId,
      ...refs,
      createdIds: result.createdIds,
      updatedIds: result.updatedIds,
      errors: [],
      notices,
    }
  }
}
