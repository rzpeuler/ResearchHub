import { KNOWLEDGE_SCHEMA_V03 } from '../../schemas/knowledge/v03/executable-schema.ts'
import type { CurationSchemaContext, CurationSchemaContextError, CurationSchemaContextSlice } from './schema-context-types.ts'

type SchemaData = Record<string, unknown>

class InvalidSchemaContextSliceError extends Error implements CurationSchemaContextError {
  readonly code = 'invalid_schema_context_slice' as const

  constructor(slice: unknown) {
    super(`Unsupported Knowledge Curation Schema Context slice: ${String(slice)}`)
    this.name = 'InvalidSchemaContextSliceError'
  }
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function projection(value: unknown): SchemaData {
  return clone(value) as SchemaData
}

function reportUnderstandingProjection(): SchemaData {
  const schema = KNOWLEDGE_SCHEMA_V03
  return projection({
    identity: schema.identity,
    lifecycle: schema.lifecycle,
    auxiliaryAssets: {
      referenceTaxonomy: schema.auxiliaryAssets.referenceTaxonomy,
    },
    themeGroup: schema.themeGroup,
    entity: {
      types: schema.entity.types,
      investmentTheme: schema.entity.investmentTheme,
      typeDefinitions: schema.entity.typeDefinitions,
      taxonomyRefs: schema.entity.taxonomyRefs,
    },
    source: {
      fields: schema.source.fields,
      requiredFields: schema.source.requiredFields,
      types: schema.source.types,
      typeDefinitions: schema.source.typeDefinitions,
      reliabilities: schema.source.reliabilities,
      reliabilityDefinitions: schema.source.reliabilityDefinitions,
      reliabilitySemanticRule: schema.source.reliabilitySemanticRule,
    },
  })
}

function knowledgeExtractionProjection(): SchemaData {
  const schema = KNOWLEDGE_SCHEMA_V03
  return projection({
    identity: schema.identity,
    lifecycle: schema.lifecycle,
    auxiliaryAssets: {
      referenceTaxonomy: schema.auxiliaryAssets.referenceTaxonomy,
    },
    rawIdentity: schema.rawIdentity,
    entity: schema.entity,
    relation: schema.relation,
    claim: schema.claim,
    source: {
      fields: schema.source.fields,
      requiredFields: schema.source.requiredFields,
      types: schema.source.types,
      typeDefinitions: schema.source.typeDefinitions,
      reliabilities: schema.source.reliabilities,
      reliabilityDefinitions: schema.source.reliabilityDefinitions,
      reliabilitySemanticRule: schema.source.reliabilitySemanticRule,
    },
    numericConstraints: schema.numericConstraints,
    extensionPolicy: schema.extensionPolicy,
  })
}

function reconciliationProjection(): SchemaData {
  const schema = KNOWLEDGE_SCHEMA_V03
  return projection({
    identity: schema.identity,
    lifecycle: schema.lifecycle,
    claim: {
      types: schema.claim.types,
      fields: schema.claim.fields,
      requiredFields: schema.claim.requiredFields,
      temporalScopeTypes: schema.claim.temporalScopeTypes,
      comparators: schema.claim.comparators,
      subjectKinds: schema.claim.subjectKinds,
      typeDefinitions: schema.claim.typeDefinitions,
      semanticGuidance: schema.claim.semanticGuidance,
    },
    relation: {
      types: schema.relation.types,
      commonFields: schema.relation.commonFields,
      requiredFields: schema.relation.requiredFields,
      definitions: schema.relation.definitions,
    },
    source: {
      fields: schema.source.fields,
      requiredFields: schema.source.requiredFields,
      types: schema.source.types,
      typeDefinitions: schema.source.typeDefinitions,
      reliabilities: schema.source.reliabilities,
      reliabilityDefinitions: schema.source.reliabilityDefinitions,
      reliabilitySemanticRule: schema.source.reliabilitySemanticRule,
    },
    numericConstraints: schema.numericConstraints,
  })
}

function schemaGapProjection(): SchemaData {
  return projection(KNOWLEDGE_SCHEMA_V03)
}

function buildProjection(slice: CurationSchemaContextSlice): SchemaData {
  switch (slice) {
    case 'report_understanding': return reportUnderstandingProjection()
    case 'knowledge_extraction': return knowledgeExtractionProjection()
    case 'reconciliation': return reconciliationProjection()
    case 'schema_gap': return schemaGapProjection()
    default: throw new InvalidSchemaContextSliceError(slice)
  }
}

export function buildCurationSchemaContext(slice: CurationSchemaContextSlice): CurationSchemaContext {
  if (!['report_understanding', 'knowledge_extraction', 'reconciliation', 'schema_gap'].includes(slice)) {
    throw new InvalidSchemaContextSliceError(slice)
  }
  const schema = KNOWLEDGE_SCHEMA_V03
  return {
    schemaVersion: schema.identity.schemaVersion,
    storageFormatVersion: schema.identity.storageFormatVersion,
    slice,
    canonicalObjectKinds: clone(schema.canonicalObjectKinds),
    schema: buildProjection(slice),
  }
}

export { InvalidSchemaContextSliceError }
