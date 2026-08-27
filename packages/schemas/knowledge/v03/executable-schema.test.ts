import assert from 'node:assert/strict'
import test from 'node:test'
import { KNOWLEDGE_SCHEMA_V03 } from './executable-schema.ts'
import { findKnowledgeSchemaRelease } from '../schema-release.ts'
import { KNOWLEDGE_SCHEMA_V03 as ROOT_KNOWLEDGE_SCHEMA_V03 } from '../index.ts'

test('Schema 0.3 exposes the frozen identity, kinds, and namespaces', () => {
  assert.deepEqual(KNOWLEDGE_SCHEMA_V03.identity, { schemaVersion: '0.3', storageFormatVersion: '1' })
  assert.deepEqual(KNOWLEDGE_SCHEMA_V03.canonicalObjectKinds, [
    'ThemeGroup', 'Entity', 'Relation', 'Claim', 'Source', 'Module', 'RawRef',
  ])
  assert.deepEqual(KNOWLEDGE_SCHEMA_V03.canonicalNamespaces, {
    themeGroup: 'theme-group:',
    entity: 'entity:',
    relation: 'relation:',
    claim: 'claim:',
    source: 'source:',
    module: 'module:',
  })
  assert.deepEqual(KNOWLEDGE_SCHEMA_V03.rawIdentity, {
    prefix: 'raw-sha256-',
    pattern: '^raw-sha256-[0-9a-f]{64}$',
    preservedAcrossMigration: true,
    description: 'Raw retains the existing immutable Storage/Provenance identity and is referenced by RawRef.',
  })
})

test('Schema 0.3 contains the frozen semantic vocabularies and boundaries', () => {
  assert.deepEqual(KNOWLEDGE_SCHEMA_V03.entity.types, [
    'investment_theme', 'industry', 'company', 'product', 'technology',
  ])
  assert.deepEqual(KNOWLEDGE_SCHEMA_V03.claim.types, ['fact', 'forecast', 'viewpoint', 'trend', 'risk'])
  assert.deepEqual(KNOWLEDGE_SCHEMA_V03.source.types, [
    'official_disclosure', 'company_official', 'sell_side_research', 'industry_database',
    'professional_media', 'general_media', 'community', 'unknown',
  ])
  assert.deepEqual(KNOWLEDGE_SCHEMA_V03.source.reliabilities, ['high', 'medium', 'low', 'unknown'])
  assert.deepEqual(KNOWLEDGE_SCHEMA_V03.lifecycle.values, ['active', 'expired', 'superseded', 'archived'])
  assert.deepEqual(KNOWLEDGE_SCHEMA_V03.themeGroup.requiredFields, ['id', 'name', 'aliases', 'lifecycle'])
  assert.deepEqual(KNOWLEDGE_SCHEMA_V03.relation.requiredFields, ['id', 'type', 'sourceRef', 'targetRef', 'lifecycle'])
  assert.deepEqual(KNOWLEDGE_SCHEMA_V03.source.requiredFields, [
    'id', 'title', 'sourceType',
  ])
  assert.deepEqual(KNOWLEDGE_SCHEMA_V03.source.fields, [
    'id', 'type', 'title', 'publisher', 'institution', 'author', 'publishedAt', 'url',
    'sourceType', 'quality', 'sourceReliability', 'rawRefs', 'metadata', 'lifecycle',
    'createdAt', 'updatedAt',
  ])
  assert.deepEqual(KNOWLEDGE_SCHEMA_V03.module.types, [
    'comparison', 'roadmap', 'market', 'competition', 'capacity', 'supply-chain',
  ])
  assert.deepEqual(KNOWLEDGE_SCHEMA_V03.module.fields, [
    'id', 'type', 'targetEntity', 'sourceRefs', 'schemaId', 'columns', 'rows',
  ])
  assert.deepEqual(KNOWLEDGE_SCHEMA_V03.module.requiredFields, ['id', 'type'])
  assert.deepEqual(KNOWLEDGE_SCHEMA_V03.module.referenceFields, {
    targetEntity: { targetKind: 'Entity', cardinality: 'zero_or_one' },
    sourceRefs: { targetKind: 'Source', cardinality: 'zero_or_many' },
  })
  assert.deepEqual(KNOWLEDGE_SCHEMA_V03.relation.definitions.business_exposure.attributes.financialContribution, {
    nullable: true,
    fields: [
      'period', 'revenueAmount', 'revenueShare', 'profitAmount', 'profitShare',
      'currency', 'separatelyReported',
    ],
  })
  assert.equal(KNOWLEDGE_SCHEMA_V03.module.fields.includes('name'), false)
  assert.equal(KNOWLEDGE_SCHEMA_V03.module.fields.includes('targetRefs'), false)
  assert.equal(KNOWLEDGE_SCHEMA_V03.auxiliaryAssets.referenceTaxonomy.canonical, false)
  assert.equal(KNOWLEDGE_SCHEMA_V03.auxiliaryAssets.projectionConfiguration.canonical, false)
  assert.deepEqual(KNOWLEDGE_SCHEMA_V03.entity.taxonomyRefs.forbiddenUses, [
    'canonical graph reference', 'Claim subject', 'Relation replacement',
  ])
})

test('Schema 0.3 encodes relation rules, constraints, and retired vocabulary', () => {
  assert.deepEqual(KNOWLEDGE_SCHEMA_V03.relation.types, [
    'theme_exposure', 'business_exposure', 'upstream_of', 'supplier_of', 'competes_with',
    'owns_stake_in', 'offers_product', 'belongs_to_industry', 'component_of',
    'develops_technology', 'uses_technology', 'applied_in', 'depends_on', 'substitutes_for',
  ])
  assert.deepEqual(KNOWLEDGE_SCHEMA_V03.relation.definitions.business_exposure, {
    directionality: 'directed',
    sourceTypes: ['company'],
    targetTypes: ['industry'],
    cardinality: 'at_most_one_active_per_company_industry_pair',
    attributes: {
      exposureBasis: [
        'direct_operation', 'controlled_subsidiary', 'non_controlling_investment',
        'joint_venture', 'project_investment', 'strategic_cooperation',
        'announced_transaction', 'other', 'unknown',
      ],
      realizationStage: ['announced', 'transaction_pending', 'pre_revenue', 'commercialized', 'reported', 'unknown'],
      materiality: ['core', 'material', 'minor', 'immaterial', 'unknown'],
      financialContribution: {
        nullable: true,
        fields: [
          'period', 'revenueAmount', 'revenueShare', 'profitAmount', 'profitShare',
          'currency', 'separatelyReported',
        ],
      },
    },
  })
  assert.deepEqual(KNOWLEDGE_SCHEMA_V03.numericConstraints, {
    confidence: { minimum: 0, maximum: 1 },
    revenueShare: { minimum: 0, maximum: 1 },
    profitShare: { minimum: 0, maximum: 1 },
    ownershipPct: { minimum: 0, maximum: 1 },
  })
  assert.deepEqual(KNOWLEDGE_SCHEMA_V03.relation.directionalityValues, [
    'directed', 'directed_with_inverse', 'symmetric',
  ])
  assert.deepEqual(KNOWLEDGE_SCHEMA_V03.relation.definitions.theme_exposure, {
    directionality: 'directed',
    sourceTypes: ['investment_theme'],
    targetTypes: ['industry'],
    cardinality: 'many_to_many',
    attributes: {
      importance: ['core', 'material', 'adjacent'],
      chainPosition: ['upstream', 'midstream', 'downstream', 'infrastructure', 'cross_chain', 'unknown'],
    },
  })
  assert.deepEqual(KNOWLEDGE_SCHEMA_V03.relation.definitions.substitutes_for, {
    directionality: 'symmetric',
    sourceTypes: ['product', 'technology'],
    targetTypes: ['product', 'technology'],
    endpointConstraint: 'same_entity_type_on_both_sides',
  })
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(KNOWLEDGE_SCHEMA_V03.relation.definitions).map(([type, definition]) => [
        type,
        { sourceTypes: definition.sourceTypes, targetTypes: definition.targetTypes },
      ]),
    ),
    {
      theme_exposure: { sourceTypes: ['investment_theme'], targetTypes: ['industry'] },
      business_exposure: { sourceTypes: ['company'], targetTypes: ['industry'] },
      upstream_of: { sourceTypes: ['industry'], targetTypes: ['industry'] },
      supplier_of: { sourceTypes: ['company'], targetTypes: ['company'] },
      competes_with: { sourceTypes: ['company'], targetTypes: ['company'] },
      owns_stake_in: { sourceTypes: ['company'], targetTypes: ['company'] },
      offers_product: { sourceTypes: ['company'], targetTypes: ['product'] },
      belongs_to_industry: { sourceTypes: ['product', 'technology'], targetTypes: ['industry'] },
      component_of: { sourceTypes: ['product'], targetTypes: ['product'] },
      develops_technology: { sourceTypes: ['company'], targetTypes: ['technology'] },
      uses_technology: { sourceTypes: ['company', 'product'], targetTypes: ['technology'] },
      applied_in: { sourceTypes: ['technology'], targetTypes: ['industry'] },
      depends_on: {
        sourceTypes: ['industry', 'product', 'technology'],
        targetTypes: ['industry', 'product', 'technology'],
      },
      substitutes_for: { sourceTypes: ['product', 'technology'], targetTypes: ['product', 'technology'] },
    },
  )
  for (const retired of KNOWLEDGE_SCHEMA_V03.relation.retiredWritableTypes) {
    assert.equal((KNOWLEDGE_SCHEMA_V03.relation.types as readonly string[]).includes(retired), false)
  }
})

test('Schema 0.3 is pure JSON data and does not activate runtime release support', () => {
  const serialized = JSON.stringify(KNOWLEDGE_SCHEMA_V03)
  const parsed: unknown = JSON.parse(serialized)
  assert.deepEqual(parsed, KNOWLEDGE_SCHEMA_V03)

  const values: unknown[] = []
  const visit = (value: unknown): void => {
    values.push(value)
    if (Array.isArray(value)) {
      value.forEach(visit)
    } else if (typeof value === 'object' && value !== null) {
      Object.values(value).forEach(visit)
    }
  }
  visit(KNOWLEDGE_SCHEMA_V03)
  assert.equal(values.some((value) => typeof value === 'function'), false)
  assert.equal(ROOT_KNOWLEDGE_SCHEMA_V03, KNOWLEDGE_SCHEMA_V03)

  assert.equal(findKnowledgeSchemaRelease({ schemaVersion: '0.3', storageFormatVersion: '1' })?.writable, false)
})
