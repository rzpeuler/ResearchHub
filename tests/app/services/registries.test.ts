import assert from 'node:assert/strict'
import test from 'node:test'
import { createResearchSkillRegistry } from '../../../app/services/skill-registry.ts'
import { WorkflowDefinitionRegistry, createWorkflowDefinitionRegistry } from '../../../app/services/workflow-registry.ts'
import { strictObjectSchema, validateWorkflowInputSchema } from '../../../app/services/workflow-input-contract.ts'

test('Workflow Definition Registry exposes the current executable research set', () => {
  const registry = createWorkflowDefinitionRegistry()
  const ids = registry.list().map((definition) => definition.id)
  assert.deepEqual(ids, ['company_research', 'daily_intelligence', 'earnings_review', 'event_research', 'industry_research', 'theme_framework', 'thesis_lifecycle', 'thesis_red_team', 'valuation'])
  assert.deepEqual(registry.get('earnings_review')?.requiredInputs, ['symbol', 'fiscalYear', 'period'])
  const definition = registry.get('company_research')!
  ;((definition.inputSchema.properties as Record<string, unknown>).symbol as Record<string, unknown>).type = 'number'
  assert.deepEqual((registry.get('company_research')?.inputSchema.properties as Record<string, unknown>).symbol, { type: 'string', description: 'Six-digit A-share symbol', pattern: '^\\d{6}$' })
  assert.equal((registry.get('company_research')?.inputSchema as { additionalProperties?: boolean }).additionalProperties, false)
})

test('Workflow input JSON Schema validates nested, enum, array, bounds, and unknown fields generically', () => {
  const schema = strictObjectSchema({ benchmark: { type: 'string', minLength: 1 }, holdings: { type: 'array', minItems: 1, items: strictObjectSchema({ symbol: { type: 'string', pattern: '^\\d{6}$' }, weight: { type: 'number', minimum: 0, maximum: 1 } }, ['symbol', 'weight']) }, reviewPeriod: { type: 'string', enum: ['MONTH', 'QUARTER'] } }, ['benchmark', 'holdings', 'reviewPeriod'])
  assert.equal(validateWorkflowInputSchema(schema, { benchmark: 'CSI300', holdings: [{ symbol: '600519', weight: 0.25 }], reviewPeriod: 'QUARTER' }).valid, true)
  const missing = validateWorkflowInputSchema(schema, { benchmark: 'CSI300', holdings: [{ symbol: '600519', weight: 0.25 }] })
  assert.equal(missing.valid, true)
  assert.deepEqual(missing.missingFields, ['reviewPeriod'])
  assert.equal(validateWorkflowInputSchema(schema, { benchmark: 'CSI300', holdings: [{ symbol: 'bad', weight: 2 }], reviewPeriod: 'YEAR' }).valid, false)
  assert.match(validateWorkflowInputSchema(schema, { benchmark: 'CSI300', holdings: [], reviewPeriod: 'MONTH', surprise: true }).errors.join(' '), /surprise.*not allowed/)
})

test('Workflow Definition Registry supports adding, changing, and deleting future input contracts', () => {
  const workflow = (schema: Readonly<Record<string, unknown>>): import('../../../app/services/workflow-registry.ts').WorkflowDefinition => ({ id: 'test_portfolio_review', label: 'Test Portfolio Review', intentDescription: 'Test-only dynamic contract.', inputSchema: schema, requiredInputs: ['benchmark', 'holdings', 'reviewPeriod'], skillIds: [], outputContract: 'Test only', knowledgeEffects: [] })
  const registry = new WorkflowDefinitionRegistry([])
  const first = workflow(strictObjectSchema({ benchmark: { type: 'string' }, holdings: { type: 'array', items: { type: 'string' } }, reviewPeriod: { type: 'string', enum: ['MONTH', 'QUARTER'] } }, ['benchmark', 'holdings', 'reviewPeriod']))
  registry.register(first)
  assert.equal(validateWorkflowInputSchema(registry.get(first.id)!.inputSchema, { benchmark: 'CSI300', holdings: ['600519'], reviewPeriod: 'MONTH' }).valid, true)
  const changed = workflow(strictObjectSchema({ benchmark: { type: 'string' }, holdings: { type: 'array', items: { type: 'string' } }, reviewPeriod: { type: 'string', enum: ['QUARTER', 'YEAR'] }, currency: { type: 'string', enum: ['CNY', 'USD'] } }, ['benchmark', 'holdings', 'reviewPeriod']))
  registry.replace(changed)
  assert.equal(validateWorkflowInputSchema(registry.get(first.id)!.inputSchema, { benchmark: 'CSI300', holdings: ['600519'], reviewPeriod: 'YEAR', currency: 'CNY' }).valid, true)
  assert.equal(validateWorkflowInputSchema(registry.get(first.id)!.inputSchema, { benchmark: 'CSI300', holdings: ['600519'], reviewPeriod: 'MONTH', currency: 'CNY' }).valid, false)
  assert.equal(registry.remove(first.id), true)
  assert.equal(registry.get(first.id), undefined)
})

test('Research Skill Registry separates research and knowledge candidates', () => {
  const registry = createResearchSkillRegistry()
  assert.equal(registry.get('knowledge-curation')?.kind, 'knowledge')
  assert.equal(registry.researchCandidates().some((skill) => skill.id === 'knowledge-curation'), false)
  assert.equal(registry.researchCandidates().every((skill) => skill.kind === 'research' && skill.enabled && skill.scope === 'researchhub'), true)
  assert.equal(registry.list().some((skill) => skill.id.includes('.pi')), false)
})
