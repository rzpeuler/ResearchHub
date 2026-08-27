import assert from 'node:assert/strict'
import test from 'node:test'
import { KNOWLEDGE_SCHEMA_V03 } from '../../../packages/schemas/knowledge/v03/executable-schema.ts'
import { buildCurationSchemaContext } from '../../../packages/skills/knowledge-curation/index.ts'

const SLICES = ['report_understanding', 'knowledge_extraction', 'reconciliation', 'schema_gap'] as const

function schemaOf(slice: typeof SLICES[number]): Record<string, any> {
  return buildCurationSchemaContext(slice).schema as Record<string, any>
}

function collectKeys(value: unknown, result = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const item of value) collectKeys(item, result)
  else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
    result.add(key)
    collectKeys(child, result)
  }
  return result
}

test('Schema Context builds all four slices with explicit identity', () => {
  for (const slice of SLICES) {
    const context = buildCurationSchemaContext(slice)
    assert.equal(context.schemaVersion, KNOWLEDGE_SCHEMA_V03.identity.schemaVersion)
    assert.equal(context.storageFormatVersion, KNOWLEDGE_SCHEMA_V03.identity.storageFormatVersion)
    assert.equal(context.slice, slice)
    assert.deepEqual(context.canonicalObjectKinds, KNOWLEDGE_SCHEMA_V03.canonicalObjectKinds)
    assert.equal(typeof context.schema, 'object')
  }
})

test('report_understanding is a minimal schema projection', () => {
  const schema = schemaOf('report_understanding')
  assert.deepEqual(schema.identity, KNOWLEDGE_SCHEMA_V03.identity)
  assert.deepEqual(schema.lifecycle, KNOWLEDGE_SCHEMA_V03.lifecycle)
  assert.deepEqual(schema.auxiliaryAssets.referenceTaxonomy, KNOWLEDGE_SCHEMA_V03.auxiliaryAssets.referenceTaxonomy)
  assert.deepEqual(schema.themeGroup, KNOWLEDGE_SCHEMA_V03.themeGroup)
  assert.deepEqual(schema.entity.investmentTheme, KNOWLEDGE_SCHEMA_V03.entity.investmentTheme)
  assert.deepEqual(schema.entity.taxonomyRefs, KNOWLEDGE_SCHEMA_V03.entity.taxonomyRefs)
  assert.deepEqual(schema.source, {
    fields: KNOWLEDGE_SCHEMA_V03.source.fields,
    requiredFields: KNOWLEDGE_SCHEMA_V03.source.requiredFields,
    types: KNOWLEDGE_SCHEMA_V03.source.types,
    reliabilities: KNOWLEDGE_SCHEMA_V03.source.reliabilities,
  })
  assert.equal('relation' in schema, false)
  assert.equal('claim' in schema, false)
})

test('knowledge_extraction derives complete routine semantics from the authority', () => {
  const schema = schemaOf('knowledge_extraction')
  assert.deepEqual(schema.entity, KNOWLEDGE_SCHEMA_V03.entity)
  assert.deepEqual(schema.relation, KNOWLEDGE_SCHEMA_V03.relation)
  assert.deepEqual(schema.claim, KNOWLEDGE_SCHEMA_V03.claim)
  assert.deepEqual(schema.source, {
    fields: KNOWLEDGE_SCHEMA_V03.source.fields,
    requiredFields: KNOWLEDGE_SCHEMA_V03.source.requiredFields,
    types: KNOWLEDGE_SCHEMA_V03.source.types,
    reliabilities: KNOWLEDGE_SCHEMA_V03.source.reliabilities,
  })
  assert.deepEqual(schema.rawIdentity, KNOWLEDGE_SCHEMA_V03.rawIdentity)
  assert.deepEqual(schema.numericConstraints, KNOWLEDGE_SCHEMA_V03.numericConstraints)
  assert.deepEqual(schema.extensionPolicy, KNOWLEDGE_SCHEMA_V03.extensionPolicy)
  assert.deepEqual(schema.relation.types, KNOWLEDGE_SCHEMA_V03.relation.types)
  assert.deepEqual(schema.relation.retiredWritableTypes, KNOWLEDGE_SCHEMA_V03.relation.retiredWritableTypes)
  assert.deepEqual(schema.claim.comparators, KNOWLEDGE_SCHEMA_V03.claim.comparators)
  assert.deepEqual(schema.claim.temporalScopeTypes, KNOWLEDGE_SCHEMA_V03.claim.temporalScopeTypes)
})

test('reconciliation contains update-relevant authority without operation decisions', () => {
  const schema = schemaOf('reconciliation')
  assert.deepEqual(schema.lifecycle, KNOWLEDGE_SCHEMA_V03.lifecycle)
  assert.deepEqual(schema.claim, {
    types: KNOWLEDGE_SCHEMA_V03.claim.types,
    fields: KNOWLEDGE_SCHEMA_V03.claim.fields,
    requiredFields: KNOWLEDGE_SCHEMA_V03.claim.requiredFields,
    temporalScopeTypes: KNOWLEDGE_SCHEMA_V03.claim.temporalScopeTypes,
    subjectKinds: KNOWLEDGE_SCHEMA_V03.claim.subjectKinds,
  })
  assert.deepEqual(schema.relation, {
    types: KNOWLEDGE_SCHEMA_V03.relation.types,
    commonFields: KNOWLEDGE_SCHEMA_V03.relation.commonFields,
    requiredFields: KNOWLEDGE_SCHEMA_V03.relation.requiredFields,
    definitions: KNOWLEDGE_SCHEMA_V03.relation.definitions,
  })
  assert.deepEqual(schema.numericConstraints, KNOWLEDGE_SCHEMA_V03.numericConstraints)
  assert.equal(collectKeys(schema).has('resolution'), false)
  assert.equal(collectKeys(schema).has('decision'), false)
})

test('schema_gap exposes the complete authority as an independent deep copy', () => {
  const context = buildCurationSchemaContext('schema_gap')
  assert.deepEqual(context.schema, KNOWLEDGE_SCHEMA_V03)
  const entityTypesBefore = [...KNOWLEDGE_SCHEMA_V03.entity.types]
  const mutable = context.schema as any
  mutable.entity.types.push('not-canonical')
  mutable.relation.definitions.depends_on.sourceTypes.push('not-canonical')
  assert.deepEqual(KNOWLEDGE_SCHEMA_V03.entity.types, entityTypesBefore)
  assert.equal(KNOWLEDGE_SCHEMA_V03.relation.definitions.depends_on.sourceTypes.includes('not-canonical'), false)
  assert.equal((buildCurationSchemaContext('schema_gap').schema as any).entity.types.includes('not-canonical'), false)
})

test('all slices are deterministic, independently mutable, and instance-free', () => {
  for (const slice of SLICES) {
    assert.deepEqual(buildCurationSchemaContext(slice), buildCurationSchemaContext(slice))
    const keys = collectKeys(schemaOf(slice))
    assert.equal(keys.has('knowledgeBaseId'), false)
    assert.equal(keys.has('workflowRunId'), false)
    assert.equal(keys.has('canonicalId'), false)
  }
  const first = buildCurationSchemaContext('knowledge_extraction')
  const second = buildCurationSchemaContext('knowledge_extraction')
  ;(first.schema as any).claim.types.push('mutated')
  assert.equal((second.schema as any).claim.types.includes('mutated'), false)
  assert.deepEqual((second.schema as any).claim.types, KNOWLEDGE_SCHEMA_V03.claim.types)
})

test('unknown slice fails with a stable error code and no fallback', () => {
  assert.throws(
    () => buildCurationSchemaContext('unknown' as never),
    (error: any) => error?.code === 'invalid_schema_context_slice' && error?.name === 'InvalidSchemaContextSliceError',
  )
})
