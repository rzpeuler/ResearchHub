import assert from 'node:assert/strict'
import test from 'node:test'
import {
  COMPETITION_MODULE_SCHEMA_ID_V1,
  validateCompetitionModuleV1,
  type CompetitionModuleV1,
} from '../../../knowledge/schema/competition-module-v04.ts'

const columns = [
  { id: 'issuer', role: 'company', label: 'Company' },
  { id: 'products', role: 'main_products', label: 'Main products' },
  { id: 'market-cap', role: 'market_cap', label: 'Market capitalization' },
  { id: 'revenue', role: 'annual_revenue', label: 'Latest annual revenue' },
  { id: 'share', role: 'custom', customRole: 'market_share', label: 'Market share' },
] as const

function validModule(): CompetitionModuleV1 {
  return {
    id: 'module:competition-semiconductor',
    type: 'competition',
    targetEntity: 'entity:semiconductor',
    schemaId: COMPETITION_MODULE_SCHEMA_ID_V1,
    sourceRefs: ['source:industry-research'],
    columns: [...columns],
    rows: [
      {
        companyRef: 'entity:example-company',
        cells: {
          products: { status: 'available', displayValue: 'AI accelerators', knowledgeRefs: ['claim:example-products'] },
          'market-cap': { status: 'available', displayValue: 'CNY 12.4 billion', knowledgeRefs: ['observation:example-market-cap'], asOf: '2026-09-30', unit: 'billion', currency: 'CNY' },
          revenue: { status: 'available', displayValue: 'CNY 3.2 billion', knowledgeRefs: ['observation:example-revenue'], fiscalYear: 2025, unit: 'billion', currency: 'CNY' },
          share: { status: 'available', displayValue: 'About 8%', knowledgeRefs: ['claim:example-share'] },
        },
      },
    ],
  }
}

function cloned(value: CompetitionModuleV1): Record<string, unknown> {
  return structuredClone(value) as unknown as Record<string, unknown>
}

function hasIssue(value: unknown, code: string): boolean {
  return validateCompetitionModuleV1(value).issues.some((issue) => issue.code === code)
}

test('accepts a typed competition module with required roles and dynamic custom columns', () => {
  const module = validModule()
  const result = validateCompetitionModuleV1(module)
  assert.deepEqual(result, { valid: true, issues: [] })
  assert.equal(module.columns.filter((column) => column.role === 'custom').length, 1)
})

test('accepts explicit unavailable and not-comparable states without inventing values', () => {
  const module = cloned(validModule()) as any
  module.rows = [{
    companyRef: 'entity:example-company',
    cells: {
      products: { status: 'unavailable', reason: 'The available filings do not identify leading products.' },
      'market-cap': { status: 'unavailable', reason: 'No verified trading date is available.' },
      revenue: { status: 'not_comparable', reason: 'The reported segment boundary differs from peers.' },
      share: { status: 'not_comparable', reason: 'The available estimates use incompatible market definitions.' },
    },
  }]
  assert.equal(validateCompetitionModuleV1(module).valid, true)
})

test('rejects malformed company and evidence references and a missing cell', () => {
  const malformedCompany = cloned(validModule()) as any
  malformedCompany.rows[0].companyRef = 'company:example-company'
  assert.equal(hasIssue(malformedCompany, 'ROW_COMPANY_REF'), true)

  const malformedEvidence = cloned(validModule()) as any
  malformedEvidence.rows[0].cells.products.knowledgeRefs = ['claim:bad id']
  assert.equal(hasIssue(malformedEvidence, 'CELL_KNOWLEDGE_REF_INVALID'), true)

  const missingCell = cloned(validModule()) as any
  delete missingCell.rows[0].cells.revenue
  assert.equal(hasIssue(missingCell, 'ROW_CELL_MISSING'), true)
})

test('rejects duplicate column ids, required roles, and company rows', () => {
  const duplicateColumnId = cloned(validModule()) as any
  duplicateColumnId.columns[1].id = duplicateColumnId.columns[0].id
  assert.equal(hasIssue(duplicateColumnId, 'COLUMN_ID_DUPLICATE'), true)

  const duplicateRole = cloned(validModule()) as any
  duplicateRole.columns[4] = { id: 'another-company', role: 'company', label: 'Other company' }
  assert.equal(hasIssue(duplicateRole, 'COLUMN_ROLE_CARDINALITY'), true)

  const duplicateCompany = cloned(validModule()) as any
  duplicateCompany.rows.push(structuredClone(duplicateCompany.rows[0]))
  assert.equal(hasIssue(duplicateCompany, 'ROW_COMPANY_DUPLICATE'), true)
})

test('rejects visible labels duplicated after whitespace, NFKC, and casefold normalization', () => {
  const whitespaceAndCase = cloned(validModule()) as any
  whitespaceAndCase.columns[0].label = '  MAIN PRODUCTS  '
  assert.equal(hasIssue(whitespaceAndCase, 'COLUMN_LABEL_DUPLICATE'), true)

  const compatibilityForm = cloned(validModule()) as any
  compatibilityForm.columns[4].label = 'ＣＯＭＰＡＮＹ'
  assert.equal(hasIssue(compatibilityForm, 'COLUMN_LABEL_DUPLICATE'), true)

  const fullCaseFold = cloned(validModule()) as any
  fullCaseFold.columns[4].label = 'Straße'
  fullCaseFold.columns[1].label = 'STRASSE'
  assert.equal(hasIssue(fullCaseFold, 'COLUMN_LABEL_DUPLICATE'), true)
})

test('rejects invalid market-cap and annual-revenue temporal or currency metadata', () => {
  const badMarketCapDate = cloned(validModule()) as any
  badMarketCapDate.rows[0].cells['market-cap'].asOf = '2026-02-30'
  assert.equal(hasIssue(badMarketCapDate, 'MARKET_CAP_AS_OF'), true)

  const badRevenueYear = cloned(validModule()) as any
  badRevenueYear.rows[0].cells.revenue.fiscalYear = 20.25
  assert.equal(hasIssue(badRevenueYear, 'ANNUAL_REVENUE_FISCAL_YEAR'), true)

  const badCurrency = cloned(validModule()) as any
  badCurrency.rows[0].cells.revenue.currency = '¥'
  assert.equal(hasIssue(badCurrency, 'CELL_CURRENCY'), true)
})

test('rejects unbounded columns, rows, cell references, and undeclared fields', () => {
  const tooManyColumns = cloned(validModule()) as any
  tooManyColumns.columns = [...tooManyColumns.columns, { id: 'custom-2', role: 'custom', customRole: 'barrier', label: 'Barrier' }, { id: 'custom-3', role: 'custom', customRole: 'capacity', label: 'Capacity' }, { id: 'custom-4', role: 'custom', customRole: 'customers', label: 'Customers' }]
  assert.equal(hasIssue(tooManyColumns, 'COLUMNS_BOUNDS'), true)

  const tooManyRows = cloned(validModule()) as any
  tooManyRows.rows = Array.from({ length: 41 }, (_, index) => ({ companyRef: `entity:company-${index}`, cells: structuredClone(tooManyRows.rows[0].cells) }))
  assert.equal(hasIssue(tooManyRows, 'ROWS_BOUNDS'), true)

  const tooManyRefs = cloned(validModule()) as any
  tooManyRefs.rows[0].cells.products.knowledgeRefs = Array.from({ length: 17 }, (_, index) => `claim:product-${index}`)
  assert.equal(hasIssue(tooManyRefs, 'CELL_KNOWLEDGE_REFS'), true)

  const tooLongLabel = cloned(validModule()) as any
  tooLongLabel.columns[0].label = 'x'.repeat(129)
  assert.equal(hasIssue(tooLongLabel, 'COLUMN_LABEL'), true)

  const tooLongDisplayValue = cloned(validModule()) as any
  tooLongDisplayValue.rows[0].cells.products.displayValue = 'x'.repeat(2049)
  assert.equal(hasIssue(tooLongDisplayValue, 'CELL_DISPLAY_VALUE'), true)

  const undeclaredField = cloned(validModule()) as any
  undeclaredField.rows[0].cells.products.sourceRefs = ['source:unreviewed']
  assert.equal(hasIssue(undeclaredField, 'FIELD_UNDECLARED'), true)
})

test('rejects sparse arrays and unexpected own properties in every contract array', () => {
  const sparseColumns = cloned(validModule()) as any
  delete sparseColumns.columns[0]
  assert.equal(hasIssue(sparseColumns, 'ARRAY_SLOT_MISSING'), true)

  const sparseRows = cloned(validModule()) as any
  delete sparseRows.rows[0]
  assert.equal(hasIssue(sparseRows, 'ARRAY_SLOT_MISSING'), true)

  const sparseSources = cloned(validModule()) as any
  delete sparseSources.sourceRefs[0]
  assert.equal(hasIssue(sparseSources, 'ARRAY_SLOT_MISSING'), true)

  const sparseKnowledgeRefs = cloned(validModule()) as any
  delete sparseKnowledgeRefs.rows[0].cells.products.knowledgeRefs[0]
  assert.equal(hasIssue(sparseKnowledgeRefs, 'ARRAY_SLOT_MISSING'), true)

  const extraColumnProperty = cloned(validModule()) as any
  extraColumnProperty.columns.extra = true
  assert.equal(hasIssue(extraColumnProperty, 'ARRAY_PROPERTY_UNDECLARED'), true)

  const extraRowProperty = cloned(validModule()) as any
  extraRowProperty.rows.extra = true
  assert.equal(hasIssue(extraRowProperty, 'ARRAY_PROPERTY_UNDECLARED'), true)

  const extraSourceProperty = cloned(validModule()) as any
  extraSourceProperty.sourceRefs.extra = true
  assert.equal(hasIssue(extraSourceProperty, 'ARRAY_PROPERTY_UNDECLARED'), true)

  const extraKnowledgeRefProperty = cloned(validModule()) as any
  extraKnowledgeRefProperty.rows[0].cells.products.knowledgeRefs.extra = true
  assert.equal(hasIssue(extraKnowledgeRefProperty, 'ARRAY_PROPERTY_UNDECLARED'), true)
})

test('indexed traversal catches invalid slots despite overridden array methods', () => {
  const overriddenSlice = cloned(validModule()) as any
  overriddenSlice.rows[0].companyRef = 'company:malformed'
  overriddenSlice.rows.slice = () => []
  assert.equal(hasIssue(overriddenSlice, 'ROW_COMPANY_REF'), true)

  const overriddenForEach = cloned(validModule()) as any
  overriddenForEach.sourceRefs[0] = 'source:bad id'
  overriddenForEach.sourceRefs.forEach = () => undefined
  assert.equal(hasIssue(overriddenForEach, 'MODULE_SOURCE_REF_INVALID'), true)

  const overriddenCellForEach = cloned(validModule()) as any
  overriddenCellForEach.rows[0].cells.products.knowledgeRefs[0] = 'claim:bad id'
  overriddenCellForEach.rows[0].cells.products.knowledgeRefs.forEach = () => undefined
  assert.equal(hasIssue(overriddenCellForEach, 'CELL_KNOWLEDGE_REF_INVALID'), true)
})

test('requires consistent available financial units per role while preserving row-specific dates and years', () => {
  const withSecondRow = (): any => {
    const module = cloned(validModule()) as any
    const secondRow = structuredClone(module.rows[0])
    secondRow.companyRef = 'entity:second-company'
    secondRow.cells['market-cap'].asOf = '2025-05-30'
    secondRow.cells.revenue.fiscalYear = 2024
    module.rows.push(secondRow)
    return module
  }

  assert.equal(validateCompetitionModuleV1(withSecondRow()).valid, true)

  const mixedMarketCapUnit = withSecondRow()
  mixedMarketCapUnit.rows[1].cells['market-cap'].unit = 'million'
  assert.equal(hasIssue(mixedMarketCapUnit, 'MARKET_CAP_UNIT_CURRENCY_INCONSISTENT'), true)

  const mixedMarketCapCurrency = withSecondRow()
  mixedMarketCapCurrency.rows[1].cells['market-cap'].currency = 'USD'
  assert.equal(hasIssue(mixedMarketCapCurrency, 'MARKET_CAP_UNIT_CURRENCY_INCONSISTENT'), true)

  const mixedAnnualRevenuePair = withSecondRow()
  mixedAnnualRevenuePair.rows[1].cells.revenue.unit = 'million'
  mixedAnnualRevenuePair.rows[1].cells.revenue.currency = 'USD'
  assert.equal(hasIssue(mixedAnnualRevenuePair, 'ANNUAL_REVENUE_UNIT_CURRENCY_INCONSISTENT'), true)
})
