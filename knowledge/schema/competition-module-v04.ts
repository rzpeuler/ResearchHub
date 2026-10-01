import type { EntityRefV04, KnowledgeModuleV04, RelationRefV04, ClaimRefV04, ObservationRefV04 } from './domain-v04.ts'
import type { ModuleRefV03, SourceRefV03 } from './domain.ts'

export const COMPETITION_MODULE_SCHEMA_ID_V1 = 'competition-landscape-v1' as const

export const COMPETITION_MODULE_V1_LIMITS = {
  minColumns: 4,
  maxColumns: 7,
  maxRows: 40,
  maxSourceRefs: 40,
  maxCellKnowledgeRefs: 16,
  maxModuleRefLength: 160,
  maxColumnIdLength: 64,
  maxColumnLabelLength: 128,
  maxCustomRoleKeyLength: 64,
  maxDisplayValueLength: 2048,
  maxReasonLength: 1024,
  maxUnitLength: 32,
} as const

export type CompetitionColumnRoleV1 = 'company' | 'main_products' | 'market_cap' | 'annual_revenue' | 'custom'

interface CompetitionColumnBaseV1 {
  readonly id: string
  readonly label: string
}

export type CompetitionColumnV1 =
  | (CompetitionColumnBaseV1 & { readonly role: 'company' })
  | (CompetitionColumnBaseV1 & { readonly role: 'main_products' })
  | (CompetitionColumnBaseV1 & { readonly role: 'market_cap' })
  | (CompetitionColumnBaseV1 & { readonly role: 'annual_revenue' })
  | (CompetitionColumnBaseV1 & { readonly role: 'custom'; readonly customRole: string })

export type CompetitionCellKnowledgeRefV1 = ClaimRefV04 | ObservationRefV04 | RelationRefV04

export interface CompetitionAvailableCellV1 {
  readonly status: 'available'
  readonly displayValue: string
  readonly knowledgeRefs: readonly CompetitionCellKnowledgeRefV1[]
}

export interface CompetitionMarketCapCellV1 extends CompetitionAvailableCellV1 {
  readonly asOf: string
  readonly unit: string
  readonly currency: string
}

export interface CompetitionAnnualRevenueCellV1 extends CompetitionAvailableCellV1 {
  readonly fiscalYear: number
  readonly unit: string
  readonly currency: string
}

export interface CompetitionUnavailableCellV1 {
  readonly status: 'unavailable' | 'not_comparable'
  readonly reason: string
}

export type CompetitionCellV1 =
  | CompetitionAvailableCellV1
  | CompetitionMarketCapCellV1
  | CompetitionAnnualRevenueCellV1
  | CompetitionUnavailableCellV1

/**
 * A row's company is represented once by companyRef. `cells` contains exactly
 * one cell for every non-company column, keyed by that column's stable id.
 */
export interface CompetitionRowV1 {
  readonly companyRef: EntityRefV04
  readonly cells: Readonly<Record<string, CompetitionCellV1>>
}

export type CompetitionModuleV1 = Omit<
  KnowledgeModuleV04,
  'id' | 'type' | 'targetEntity' | 'schemaId' | 'columns' | 'rows'
> & {
  readonly id: ModuleRefV03
  readonly type: 'competition'
  readonly targetEntity: EntityRefV04
  readonly sourceRefs?: readonly SourceRefV03[]
  readonly schemaId: typeof COMPETITION_MODULE_SCHEMA_ID_V1
  readonly columns: readonly CompetitionColumnV1[]
  readonly rows: readonly CompetitionRowV1[]
}

export interface CompetitionModuleIssueV1 {
  readonly code: string
  readonly path: string
  readonly message: string
}

export interface CompetitionModuleValidationResultV1 {
  readonly valid: boolean
  readonly issues: readonly CompetitionModuleIssueV1[]
}

type Dict = Record<string, unknown>

const MODULE_FIELDS = ['id', 'type', 'targetEntity', 'sourceRefs', 'schemaId', 'columns', 'rows'] as const
const REQUIRED_MODULE_FIELDS = ['id', 'type', 'targetEntity', 'schemaId', 'columns', 'rows'] as const
const REQUIRED_ROLES = ['company', 'main_products', 'market_cap', 'annual_revenue'] as const
const SAFE_LOCAL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const COLUMN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const REF_PREFIXES = ['claim:', 'observation:', 'relation:'] as const
const MAX_DIAGNOSTICS = 256
const MAX_UNKNOWN_FIELD_DIAGNOSTICS = 16

function isRecord(value: unknown): value is Dict {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOwn(value: Dict, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function boundedNonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength
}

function isValidColumnId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= COMPETITION_MODULE_V1_LIMITS.maxColumnIdLength && COLUMN_ID.test(value)
}

function normalizeColumnLabel(value: string): string {
  const compatible = value.trim().normalize('NFKC')
  // ECMAScript has no casefold API. Upper-then-lower performs locale-neutral
  // Unicode folding for case variants; keep dotless i distinct and expand sharp s.
  return Array.from(compatible, (character) => character === '\u0131'
    ? character
    : character.toUpperCase().toLowerCase()).join('').replace(/\u00df/g, 'ss')
}

function validCanonicalRef(value: unknown, prefix: string, maxLength = COMPETITION_MODULE_V1_LIMITS.maxModuleRefLength): value is string {
  if (typeof value !== 'string' || value.length > maxLength || !value.startsWith(prefix)) return false
  const localId = value.slice(prefix.length)
  return localId.length > 0 && localId.length <= maxLength - prefix.length && SAFE_LOCAL_ID.test(localId)
}

function isIsoCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [yearText, monthText, dayText] = value.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return false
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  date.setUTCHours(0, 0, 0, 0)
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function addIssue(issues: CompetitionModuleIssueV1[], code: string, path: string, message: string): void {
  if (issues.length < MAX_DIAGNOSTICS) issues.push({ code, path, message })
}

function checkExactFields(
  value: Dict,
  allowed: readonly string[],
  required: readonly string[],
  path: string,
  issues: CompetitionModuleIssueV1[],
): void {
  const allowedSet = new Set(allowed)
  let unknownCount = 0
  for (const field of Object.keys(value)) {
    if (!allowedSet.has(field)) {
      if (unknownCount < MAX_UNKNOWN_FIELD_DIAGNOSTICS) addIssue(issues, 'FIELD_UNDECLARED', `${path}.[unknown]`, 'Field is not declared by the competition module schema')
      unknownCount += 1
    }
  }
  if (unknownCount > MAX_UNKNOWN_FIELD_DIAGNOSTICS) addIssue(issues, 'FIELD_UNDECLARED_BOUNDS', `${path}.[unknown]`, 'Object has too many undeclared fields')
  for (const field of required) {
    if (!hasOwn(value, field)) addIssue(issues, 'FIELD_REQUIRED', `${path}.${field}`, 'Required field is missing')
  }
}

function allowedKnowledgeRefPrefixes(role: CompetitionColumnRoleV1): readonly string[] {
  if (role === 'main_products' || role === 'custom') return REF_PREFIXES
  return ['claim:', 'observation:']
}

function validateAvailableCell(
  cell: Dict,
  role: CompetitionColumnRoleV1,
  path: string,
  issues: CompetitionModuleIssueV1[],
): void {
  const requiredFields = ['status', 'displayValue', 'knowledgeRefs']
  if (role === 'market_cap') requiredFields.push('asOf', 'unit', 'currency')
  if (role === 'annual_revenue') requiredFields.push('fiscalYear', 'unit', 'currency')
  checkExactFields(cell, requiredFields, requiredFields, path, issues)

  if (cell.status !== 'available') addIssue(issues, 'CELL_STATUS', `${path}.status`, 'Available cell status must be "available"')
  if (!boundedNonEmptyString(cell.displayValue, COMPETITION_MODULE_V1_LIMITS.maxDisplayValueLength)) {
    addIssue(issues, 'CELL_DISPLAY_VALUE', `${path}.displayValue`, `Display value must be non-empty and at most ${COMPETITION_MODULE_V1_LIMITS.maxDisplayValueLength} characters`)
  }

  if (!Array.isArray(cell.knowledgeRefs) || cell.knowledgeRefs.length < 1 || cell.knowledgeRefs.length > COMPETITION_MODULE_V1_LIMITS.maxCellKnowledgeRefs) {
    addIssue(issues, 'CELL_KNOWLEDGE_REFS', `${path}.knowledgeRefs`, `Available cells require 1-${COMPETITION_MODULE_V1_LIMITS.maxCellKnowledgeRefs} canonical knowledge refs`)
  } else {
    const allowedPrefixes = allowedKnowledgeRefPrefixes(role)
    const seen = new Set<string>()
    cell.knowledgeRefs.forEach((ref, index) => {
      const matchesAllowedKind = allowedPrefixes.some((prefix) => validCanonicalRef(ref, prefix))
      if (!matchesAllowedKind) addIssue(issues, 'CELL_KNOWLEDGE_REF_INVALID', `${path}.knowledgeRefs[${index}]`, `Reference must use an allowed canonical kind for the ${role} role`)
      if (typeof ref === 'string') {
        if (seen.has(ref)) addIssue(issues, 'CELL_KNOWLEDGE_REF_DUPLICATE', `${path}.knowledgeRefs[${index}]`, 'Knowledge refs must be unique within a cell')
        seen.add(ref)
      }
    })
  }

  if (role === 'market_cap') {
    if (!isIsoCalendarDate(cell.asOf)) addIssue(issues, 'MARKET_CAP_AS_OF', `${path}.asOf`, 'Market capitalization requires a valid YYYY-MM-DD as-of date')
    validateFinancialUnits(cell, path, issues)
  }
  if (role === 'annual_revenue') {
    if (!Number.isSafeInteger(cell.fiscalYear) || Number(cell.fiscalYear) < 1900 || Number(cell.fiscalYear) > 9999) {
      addIssue(issues, 'ANNUAL_REVENUE_FISCAL_YEAR', `${path}.fiscalYear`, 'Annual revenue requires a fiscal year integer from 1900 through 9999')
    }
    validateFinancialUnits(cell, path, issues)
  }
}

function validateFinancialUnits(cell: Dict, path: string, issues: CompetitionModuleIssueV1[]): void {
  if (!boundedNonEmptyString(cell.unit, COMPETITION_MODULE_V1_LIMITS.maxUnitLength)) {
    addIssue(issues, 'CELL_UNIT', `${path}.unit`, `Unit must be non-empty and at most ${COMPETITION_MODULE_V1_LIMITS.maxUnitLength} characters`)
  }
  if (typeof cell.currency !== 'string' || !/^[A-Z]{3}$/.test(cell.currency)) {
    addIssue(issues, 'CELL_CURRENCY', `${path}.currency`, 'Currency must be a three-letter uppercase currency code')
  }
}

function validateCell(value: unknown, role: CompetitionColumnRoleV1, path: string, issues: CompetitionModuleIssueV1[]): void {
  if (!isRecord(value)) {
    addIssue(issues, 'CELL_INVALID', path, 'Cell must be an object')
    return
  }

  if (value.status === 'available') {
    validateAvailableCell(value, role, path, issues)
    return
  }

  if (value.status === 'unavailable' || value.status === 'not_comparable') {
    checkExactFields(value, ['status', 'reason'], ['status', 'reason'], path, issues)
    if (!boundedNonEmptyString(value.reason, COMPETITION_MODULE_V1_LIMITS.maxReasonLength)) {
      addIssue(issues, 'CELL_REASON', `${path}.reason`, `Unavailable cells require a non-empty reason of at most ${COMPETITION_MODULE_V1_LIMITS.maxReasonLength} characters`)
    }
    return
  }

  addIssue(issues, 'CELL_STATUS', `${path}.status`, 'Cell status must be available, unavailable, or not_comparable')
}

function validateColumn(value: unknown, path: string, issues: CompetitionModuleIssueV1[]): CompetitionColumnRoleV1 | undefined {
  if (!isRecord(value)) {
    addIssue(issues, 'COLUMN_INVALID', path, 'Column must be an object')
    return undefined
  }

  const role = value.role
  if (role === 'custom') checkExactFields(value, ['id', 'role', 'label', 'customRole'], ['id', 'role', 'label', 'customRole'], path, issues)
  else checkExactFields(value, ['id', 'role', 'label'], ['id', 'role', 'label'], path, issues)

  if (!isValidColumnId(value.id)) {
    addIssue(issues, 'COLUMN_ID', `${path}.id`, `Column id must be a stable identifier of at most ${COMPETITION_MODULE_V1_LIMITS.maxColumnIdLength} characters`)
  }
  if (!boundedNonEmptyString(value.label, COMPETITION_MODULE_V1_LIMITS.maxColumnLabelLength)) {
    addIssue(issues, 'COLUMN_LABEL', `${path}.label`, `Column label must be non-empty and at most ${COMPETITION_MODULE_V1_LIMITS.maxColumnLabelLength} characters`)
  }
  if (role === 'custom' && (typeof value.customRole !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(value.customRole) || value.customRole.length > COMPETITION_MODULE_V1_LIMITS.maxCustomRoleKeyLength)) {
    addIssue(issues, 'COLUMN_CUSTOM_ROLE', `${path}.customRole`, `Custom role must be a stable key of at most ${COMPETITION_MODULE_V1_LIMITS.maxCustomRoleKeyLength} characters`)
  }
  if (typeof role !== 'string' || !['company', 'main_products', 'market_cap', 'annual_revenue', 'custom'].includes(role)) {
    addIssue(issues, 'COLUMN_ROLE', `${path}.role`, 'Column role is not declared by the competition module schema')
    return undefined
  }
  return role as CompetitionColumnRoleV1
}

/** Validate the bounded, versioned structure carried by a canonical competition Module. */
export function validateCompetitionModuleV1(value: unknown): CompetitionModuleValidationResultV1 {
  const issues: CompetitionModuleIssueV1[] = []
  if (!isRecord(value)) {
    return { valid: false, issues: [{ code: 'MODULE_INVALID', path: '$', message: 'Competition module must be an object' }] }
  }

  checkExactFields(value, MODULE_FIELDS, REQUIRED_MODULE_FIELDS, '$', issues)
  if (!validCanonicalRef(value.id, 'module:')) addIssue(issues, 'MODULE_ID', '$.id', 'Module id must use a canonical module reference')
  if (value.type !== 'competition') addIssue(issues, 'MODULE_TYPE', '$.type', 'Module type must be competition')
  if (!validCanonicalRef(value.targetEntity, 'entity:')) addIssue(issues, 'MODULE_TARGET', '$.targetEntity', 'Module targetEntity must use a canonical Entity reference')
  if (value.schemaId !== COMPETITION_MODULE_SCHEMA_ID_V1) addIssue(issues, 'MODULE_SCHEMA_ID', '$.schemaId', `schemaId must be ${COMPETITION_MODULE_SCHEMA_ID_V1}`)

  if (value.sourceRefs !== undefined) {
    if (!Array.isArray(value.sourceRefs) || value.sourceRefs.length > COMPETITION_MODULE_V1_LIMITS.maxSourceRefs) {
      addIssue(issues, 'MODULE_SOURCE_REFS', '$.sourceRefs', `sourceRefs must be an array of at most ${COMPETITION_MODULE_V1_LIMITS.maxSourceRefs} refs`)
    } else {
      const seen = new Set<string>()
      value.sourceRefs.forEach((sourceRef, index) => {
        if (!validCanonicalRef(sourceRef, 'source:')) addIssue(issues, 'MODULE_SOURCE_REF_INVALID', `$.sourceRefs[${index}]`, 'sourceRef must use a canonical Source reference')
        if (typeof sourceRef === 'string') {
          if (seen.has(sourceRef)) addIssue(issues, 'MODULE_SOURCE_REF_DUPLICATE', `$.sourceRefs[${index}]`, 'sourceRefs must be unique')
          seen.add(sourceRef)
        }
      })
    }
  }

  const columnsById = new Map<string, { role: CompetitionColumnRoleV1; index: number }>()
  const seenColumnIds = new Map<string, number>()
  const seenColumnLabels = new Map<string, number>()
  const roleCounts = new Map<CompetitionColumnRoleV1, number>()
  if (!Array.isArray(value.columns)) {
    addIssue(issues, 'COLUMNS_INVALID', '$.columns', 'columns must be an array')
  } else {
    if (value.columns.length < COMPETITION_MODULE_V1_LIMITS.minColumns || value.columns.length > COMPETITION_MODULE_V1_LIMITS.maxColumns) {
      addIssue(issues, 'COLUMNS_BOUNDS', '$.columns', `columns must contain ${COMPETITION_MODULE_V1_LIMITS.minColumns}-${COMPETITION_MODULE_V1_LIMITS.maxColumns} entries`)
    }
    value.columns.slice(0, COMPETITION_MODULE_V1_LIMITS.maxColumns).forEach((column, index) => {
      const path = `$.columns[${index}]`
      const role = validateColumn(column, path, issues)
      if (!isRecord(column)) return
      if (typeof column.id === 'string' && column.id.length <= COMPETITION_MODULE_V1_LIMITS.maxColumnIdLength) {
        const previous = seenColumnIds.get(column.id)
        if (previous !== undefined) addIssue(issues, 'COLUMN_ID_DUPLICATE', `${path}.id`, `Column id duplicates $.columns[${previous}].id`)
        else seenColumnIds.set(column.id, index)
        if (isValidColumnId(column.id) && role !== undefined && previous === undefined) columnsById.set(column.id, { role, index })
      }
      if (boundedNonEmptyString(column.label, COMPETITION_MODULE_V1_LIMITS.maxColumnLabelLength)) {
        const normalizedLabel = normalizeColumnLabel(column.label)
        const previous = seenColumnLabels.get(normalizedLabel)
        if (previous !== undefined) addIssue(issues, 'COLUMN_LABEL_DUPLICATE', `${path}.label`, `Column label duplicates $.columns[${previous}].label after normalization`)
        else seenColumnLabels.set(normalizedLabel, index)
      }
      if (role !== undefined) roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1)
    })

    for (const requiredRole of REQUIRED_ROLES) {
      if (roleCounts.get(requiredRole) !== 1) {
        addIssue(issues, 'COLUMN_ROLE_CARDINALITY', '$.columns', `Exactly one ${requiredRole} column is required`)
      }
    }
    if ((roleCounts.get('custom') ?? 0) > 3) addIssue(issues, 'CUSTOM_COLUMN_BOUNDS', '$.columns', 'At most three custom columns are allowed')
  }

  if (!Array.isArray(value.rows)) {
    addIssue(issues, 'ROWS_INVALID', '$.rows', 'rows must be an array')
  } else {
    if (value.rows.length > COMPETITION_MODULE_V1_LIMITS.maxRows) {
      addIssue(issues, 'ROWS_BOUNDS', '$.rows', `rows must contain at most ${COMPETITION_MODULE_V1_LIMITS.maxRows} entries`)
    }
    const seenCompanies = new Map<string, number>()
    const nonCompanyColumns = [...columnsById.entries()].filter(([, column]) => column.role !== 'company')
    value.rows.slice(0, COMPETITION_MODULE_V1_LIMITS.maxRows).forEach((row, rowIndex) => {
      const rowPath = `$.rows[${rowIndex}]`
      if (!isRecord(row)) {
        addIssue(issues, 'ROW_INVALID', rowPath, 'Row must be an object')
        return
      }
      checkExactFields(row, ['companyRef', 'cells'], ['companyRef', 'cells'], rowPath, issues)
      if (!validCanonicalRef(row.companyRef, 'entity:')) {
        addIssue(issues, 'ROW_COMPANY_REF', `${rowPath}.companyRef`, 'companyRef must use a canonical Entity reference')
      } else {
        const previous = seenCompanies.get(row.companyRef)
        if (previous !== undefined) addIssue(issues, 'ROW_COMPANY_DUPLICATE', `${rowPath}.companyRef`, `Company ref duplicates $.rows[${previous}].companyRef`)
        else seenCompanies.set(row.companyRef, rowIndex)
      }

      if (!isRecord(row.cells)) {
        addIssue(issues, 'ROW_CELLS_INVALID', `${rowPath}.cells`, 'cells must be an object keyed by non-company column id')
        return
      }
      const expectedCellIds = new Set(nonCompanyColumns.map(([id]) => id))
      let unknownCellCount = 0
      for (const cellId of Object.keys(row.cells)) {
        if (!expectedCellIds.has(cellId)) {
          if (unknownCellCount < MAX_UNKNOWN_FIELD_DIAGNOSTICS) addIssue(issues, 'ROW_CELL_UNDECLARED', `${rowPath}.cells.[unknown]`, 'Cell does not match a declared non-company column id')
          unknownCellCount += 1
        }
      }
      if (unknownCellCount > MAX_UNKNOWN_FIELD_DIAGNOSTICS) addIssue(issues, 'ROW_CELL_UNDECLARED_BOUNDS', `${rowPath}.cells.[unknown]`, 'Row has too many undeclared cells')
      for (const [cellId, column] of nonCompanyColumns) {
        const cellPath = `${rowPath}.cells.${cellId}`
        if (!hasOwn(row.cells, cellId)) {
          addIssue(issues, 'ROW_CELL_MISSING', cellPath, 'Every non-company column requires an explicit cell state')
        } else {
          validateCell(row.cells[cellId], column.role, cellPath, issues)
        }
      }
    })
  }

  return { valid: issues.length === 0, issues }
}
