/**
 * The single runtime-readable structural authority for Knowledge Schema 0.3.
 *
 * This module intentionally contains data only and has no runtime service or
 * storage dependencies.
 */
export const KNOWLEDGE_SCHEMA_V03 = {
  identity: {
    schemaVersion: '0.3',
    storageFormatVersion: '1',
  },
  canonicalObjectKinds: [
    'ThemeGroup',
    'Entity',
    'Relation',
    'Claim',
    'Source',
    'Module',
    'RawRef',
  ],
  canonicalNamespaces: {
    themeGroup: 'theme-group:',
    entity: 'entity:',
    relation: 'relation:',
    claim: 'claim:',
    source: 'source:',
    module: 'module:',
  },
  rawIdentity: {
    namespace: 'raw:',
    description: 'Raw retains immutable evidence identity and is referenced by RawRef.',
  },
  auxiliaryAssets: {
    referenceTaxonomy: {
      name: 'Reference Taxonomy Asset',
      canonical: false,
      referenceField: 'taxonomyRefs',
      description: 'Auxiliary classification references; not ThemeGroup or graph references.',
    },
    projectionConfiguration: {
      name: 'Projection Configuration Asset',
      canonical: false,
      legacyName: 'View',
      description: 'Auxiliary frontend configuration; not a canonical object kind.',
    },
  },
  lifecycle: {
    values: ['active', 'expired', 'superseded', 'archived'],
    fields: ['status', 'validFrom', 'validUntil'],
  },
  themeGroup: {
    fields: ['id', 'name', 'aliases', 'description', 'sortOrder', 'lifecycle', 'metadata'],
    requiredFields: ['id', 'name', 'aliases', 'lifecycle'],
  },
  entity: {
    types: ['investment_theme', 'industry', 'company', 'product', 'technology'],
    requiredFields: ['id', 'type', 'name', 'lifecycle'],
    commonFields: [
      'id',
      'type',
      'name',
      'aliases',
      'description',
      'externalIds',
      'taxonomyRefs',
      'metadata',
      'lifecycle',
      'createdAt',
      'updatedAt',
    ],
    taxonomyRefs: {
      target: 'auxiliary_reference_taxonomy_item_id',
      forbiddenTargets: ['ThemeGroup', 'Relation', 'Claim', 'Source', 'Module', 'RawRef'],
      forbiddenUses: ['canonical graph reference', 'Claim subject', 'Relation replacement'],
    },
    investmentTheme: {
      fields: ['themeGroupRef', 'definition', 'inclusionCriteria', 'exclusionCriteria'],
      requiredFields: ['themeGroupRef'],
      cardinality: 'exactly_one_theme_group',
    },
    industry: {
      forbiddenFields: ['parentTheme', 'themeRefs', 'companyRefs'],
    },
    company: {
      optionalFields: ['ticker', 'exchange', 'legalName'],
      forbiddenFields: ['industries', 'themes', 'conceptTags', 'businessTags', 'taxonomyRefs_as_graph_refs'],
    },
    product: {
      description: 'Recognizable commercial products, product families, components, or equipment categories.',
    },
    technology: {
      description: 'Reusable technical routes, processes, architectures, or capabilities.',
    },
  },
  relation: {
    types: [
      'theme_exposure',
      'business_exposure',
      'upstream_of',
      'supplier_of',
      'competes_with',
      'owns_stake_in',
      'offers_product',
      'belongs_to_industry',
      'component_of',
      'develops_technology',
      'uses_technology',
      'applied_in',
      'depends_on',
      'substitutes_for',
    ],
    directionalityValues: ['directed', 'directed_with_inverse', 'symmetric'],
    commonFields: [
      'id',
      'type',
      'sourceRef',
      'targetRef',
      'attributes',
      'contextRefs',
      'supportingClaimRefs',
      'sourceRefs',
      'confidence',
      'asOf',
      'lifecycle',
      'createdAt',
      'updatedAt',
    ],
    requiredFields: ['id', 'type', 'sourceRef', 'targetRef', 'lifecycle'],
    retiredWritableTypes: [
      'contains',
      'downstream_of',
      'customer_of',
      'substitute_for',
      'operates_in',
      'partner_of',
      'invested_in',
    ],
    definitions: {
      theme_exposure: {
        directionality: 'directed',
        sourceTypes: ['investment_theme'],
        targetTypes: ['industry'],
        cardinality: 'many_to_many',
        attributes: {
          importance: ['core', 'material', 'adjacent'],
          chainPosition: ['upstream', 'midstream', 'downstream', 'infrastructure', 'cross_chain', 'unknown'],
        },
      },
      business_exposure: {
        directionality: 'directed',
        sourceTypes: ['company'],
        targetTypes: ['industry'],
        cardinality: 'at_most_one_active_per_company_industry_pair',
        attributes: {
          exposureBasis: [
            'direct_operation',
            'controlled_subsidiary',
            'non_controlling_investment',
            'joint_venture',
            'project_investment',
            'strategic_cooperation',
            'announced_transaction',
            'other',
            'unknown',
          ],
          realizationStage: ['announced', 'transaction_pending', 'pre_revenue', 'commercialized', 'reported', 'unknown'],
          materiality: ['core', 'material', 'minor', 'immaterial', 'unknown'],
          financialContribution: [
            'period',
            'revenueAmount',
            'revenueShare',
            'profitAmount',
            'profitShare',
            'currency',
            'separatelyReported',
          ],
        },
      },
      upstream_of: {
        directionality: 'directed',
        sourceTypes: ['industry'],
        targetTypes: ['industry'],
      },
      supplier_of: {
        directionality: 'directed',
        sourceTypes: ['company'],
        targetTypes: ['company'],
      },
      competes_with: {
        directionality: 'symmetric',
        sourceTypes: ['company'],
        targetTypes: ['company'],
      },
      owns_stake_in: {
        directionality: 'directed',
        sourceTypes: ['company'],
        targetTypes: ['company'],
        attributes: {
          ownershipPct: 'number_0_to_1_or_null',
          controlType: ['controlling', 'significant_influence', 'minority', 'unknown'],
        },
      },
      offers_product: {
        directionality: 'directed',
        sourceTypes: ['company'],
        targetTypes: ['product'],
      },
      belongs_to_industry: {
        directionality: 'directed',
        sourceTypes: ['product', 'technology'],
        targetTypes: ['industry'],
      },
      component_of: {
        directionality: 'directed',
        sourceTypes: ['product'],
        targetTypes: ['product'],
      },
      develops_technology: {
        directionality: 'directed',
        sourceTypes: ['company'],
        targetTypes: ['technology'],
      },
      uses_technology: {
        directionality: 'directed',
        sourceTypes: ['company', 'product'],
        targetTypes: ['technology'],
      },
      applied_in: {
        directionality: 'directed',
        sourceTypes: ['technology'],
        targetTypes: ['industry'],
      },
      depends_on: {
        directionality: 'directed',
        sourceTypes: ['industry', 'product', 'technology'],
        targetTypes: ['industry', 'product', 'technology'],
      },
      substitutes_for: {
        directionality: 'symmetric',
        sourceTypes: ['product', 'technology'],
        targetTypes: ['product', 'technology'],
        endpointConstraint: 'same_entity_type_on_both_sides',
      },
    },
  },
  claim: {
    types: ['fact', 'forecast', 'viewpoint', 'trend', 'risk'],
    fields: [
      'id', 'claimType', 'statement', 'subjectRefs', 'primarySubjectRef', 'temporal',
      'structuredValue', 'sourceRefs', 'provenance', 'confidence', 'lifecycle',
      'supersedes', 'supersededBy', 'createdAt', 'updatedAt',
    ],
    requiredFields: ['id', 'claimType', 'statement', 'subjectRefs', 'sourceRefs', 'lifecycle'],
    temporalScopeTypes: ['point', 'period', 'ongoing', 'unknown'],
    comparators: ['eq', 'gt', 'gte', 'lt', 'lte', 'approx'],
    subjectKinds: ['Entity', 'Relation'],
    description: 'Claim replaces v0.2 Intelligence and expresses one atomic semantic proposition.',
  },
  source: {
    types: [
      'official_disclosure',
      'company_official',
      'sell_side_research',
      'industry_database',
      'professional_media',
      'general_media',
      'community',
      'unknown',
    ],
    reliabilities: ['high', 'medium', 'low', 'unknown'],
    fields: [
      'id', 'type', 'title', 'publisher', 'institution', 'author', 'publishedAt', 'url',
      'sourceType', 'quality', 'sourceReliability', 'rawRefs', 'metadata', 'lifecycle',
      'createdAt', 'updatedAt',
    ],
    requiredFields: ['id', 'title', 'sourceType'],
  },
  module: {
    types: ['comparison', 'roadmap', 'market', 'competition', 'capacity', 'supply-chain'],
    fields: ['id', 'type', 'targetEntity', 'sourceRefs', 'schemaId', 'columns', 'rows'],
    requiredFields: ['id', 'type'],
    referenceFields: {
      targetEntity: {
        targetKind: 'Entity',
        cardinality: 'zero_or_one',
      },
      sourceRefs: {
        targetKind: 'Source',
        cardinality: 'zero_or_many',
      },
    },
    description: 'Module is canonical but secondary to the semantic graph.',
  },
  numericConstraints: {
    confidence: { minimum: 0, maximum: 1 },
    revenueShare: { minimum: 0, maximum: 1 },
    profitShare: { minimum: 0, maximum: 1 },
    ownershipPct: { minimum: 0, maximum: 1 },
  },
  extensionPolicy: {
    canonicalTopLevelFields: 'declared_only',
    metadata: 'explicitly_extensible_json_object',
    attributes: 'relation_specific_declared_fields_only',
  },
} as const

export type KnowledgeSchemaV03 = typeof KNOWLEDGE_SCHEMA_V03
