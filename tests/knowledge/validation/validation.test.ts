import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { KnowledgeLoader } from '../../../packages/skills/knowledge-access/loader.ts'
import { KnowledgeValidationSkill } from '../../../packages/skills/knowledge-validation/index.ts'

const validRoot = fileURLToPath(new URL('../fixtures/valid/', import.meta.url))
const invalidRoot = fileURLToPath(new URL('../fixtures/invalid/', import.meta.url))

test('validation passes the valid AI Hardware fixture', async () => {
  const report = await new KnowledgeValidationSkill(new KnowledgeLoader({ rootDir: validRoot })).validateKnowledge()
  assert.equal(report.status, 'passed')
  assert.equal(report.errors.length, 0)
})

test('each validation scope passes independently while preserving reference lookups', async () => {
  const skill = new KnowledgeValidationSkill(new KnowledgeLoader({ rootDir: validRoot }))
  for (const scope of ['entity', 'relation', 'intelligence', 'module', 'source', 'all'] as const) {
    const report = await skill.validateKnowledge(scope)
    assert.equal(report.status, 'passed', `${scope} scope should pass`)
  }
})

test('validation identifies missing references, invalid lifecycle, and unknown modules', async () => {
  const report = await new KnowledgeValidationSkill(new KnowledgeLoader({ rootDir: invalidRoot })).validateKnowledge()
  assert.equal(report.status, 'failed')
  assert.ok(report.errors.some((error) => error.code === 'MISSING_REFERENCE'))
  assert.ok(report.errors.some((error) => error.code === 'INVALID_LIFECYCLE'))
  assert.ok(report.errors.some((error) => error.code === 'UNKNOWN_MODULE_TARGET'))
  assert.ok(report.errors.some((error) => error.code === 'INVALID_ID'))
  assert.ok(report.errors.some((error) => error.code === 'SCHEMA_RELATION_TYPE'))
})
