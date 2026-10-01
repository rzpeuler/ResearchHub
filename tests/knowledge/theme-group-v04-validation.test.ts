import assert from 'node:assert/strict'
import test from 'node:test'
import type { KnowledgeAssetV04 } from '../../knowledge/schema/domain-v04.ts'
import { validateKnowledgeV04Objects } from '../../knowledge/validation/v04-validator.ts'

const activeLifecycle = { status: 'active' }

function themeGroup(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'theme-group:default',
    name: 'Default',
    aliases: [],
    lifecycle: activeLifecycle,
    ...overrides,
  }
}

function investmentTheme(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'entity:ai-compute',
    type: 'investment_theme',
    name: 'AI Compute',
    themeGroupRef: 'theme-group:default',
    lifecycle: activeLifecycle,
    ...overrides,
  }
}

function validate(...objects: Record<string, unknown>[]) {
  return validateKnowledgeV04Objects(objects as unknown as KnowledgeAssetV04[])
}

function hasCode(report: ReturnType<typeof validateKnowledgeV04Objects>, code: string): boolean {
  return report.errors.some((error) => error.code === code)
}

test('Schema 0.4 accepts a default ThemeGroup and its InvestmentTheme', () => {
  const report = validate(themeGroup(), investmentTheme())
  assert.equal(report.status, 'passed', JSON.stringify(report.errors))
})

test('Schema 0.4 accepts an empty Knowledge Base without a ThemeGroup', () => {
  assert.equal(validateKnowledgeV04Objects([]).status, 'passed')
})

test('Schema 0.4 requires InvestmentTheme.themeGroupRef to resolve to a ThemeGroup', () => {
  const missing = validate(investmentTheme())
  assert.ok(hasCode(missing, 'V04_THEME_GROUP_REF_INVALID'))

  const wrongNamespace = validate(themeGroup({ id: 'group:default' }), investmentTheme())
  assert.ok(hasCode(wrongNamespace, 'V04_THEME_GROUP_ID'))
  assert.ok(hasCode(wrongNamespace, 'V04_THEME_GROUP_REF_INVALID'))
})

test('Schema 0.4 requires an active InvestmentTheme to reference an active ThemeGroup', () => {
  const activeAgainstArchived = validate(themeGroup({ lifecycle: { status: 'archived' } }), investmentTheme())
  assert.ok(hasCode(activeAgainstArchived, 'V04_THEME_GROUP_NOT_ACTIVE'))

  const archivedPair = validate(themeGroup({ lifecycle: { status: 'archived' } }), investmentTheme({ lifecycle: { status: 'archived' } }))
  assert.equal(archivedPair.status, 'passed', JSON.stringify(archivedPair.errors))
})

test('Schema 0.4 bounds ThemeGroup names and validates aliases, optional fields, and lifecycle shape', () => {
  const malformed = validate(themeGroup({
    name: '   ',
    aliases: ['valid', 7],
    description: 3,
    sortOrder: 'first',
    lifecycle: { status: 'unknown', ignored: true },
  }))
  assert.ok(hasCode(malformed, 'V04_THEME_GROUP_NAME'))
  assert.ok(hasCode(malformed, 'V04_THEME_GROUP_ALIASES'))
  assert.ok(hasCode(malformed, 'V04_THEME_GROUP_DESCRIPTION'))
  assert.ok(hasCode(malformed, 'V04_THEME_GROUP_SORT_ORDER'))
  assert.ok(hasCode(malformed, 'V04_THEME_LIFECYCLE'))

  const tooLong = validate(themeGroup({ name: 'n'.repeat(257) }))
  assert.ok(hasCode(tooLong, 'V04_THEME_GROUP_NAME'))
})

test('Schema 0.4 bounds optional InvestmentTheme definition and criteria fields', () => {
  const malformed = validate(themeGroup(), investmentTheme({
    name: 't'.repeat(257),
    definition: 17,
    inclusionCriteria: 'include this',
    exclusionCriteria: Array.from({ length: 65 }, (_, index) => `criterion ${index}`),
  }))
  assert.ok(hasCode(malformed, 'V04_THEME_NAME'))
  assert.ok(hasCode(malformed, 'V04_THEME_DEFINITION'))
  assert.ok(hasCode(malformed, 'V04_THEME_CRITERIA'))

  const oversizedCriterion = validate(themeGroup(), investmentTheme({ exclusionCriteria: ['x'.repeat(2049)] }))
  assert.ok(hasCode(oversizedCriterion, 'V04_THEME_CRITERIA'))
})
