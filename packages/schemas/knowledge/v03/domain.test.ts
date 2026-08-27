import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  BusinessExposureRelationV03,
  CompanyV03,
  IndustryV03,
  InvestmentThemeV03,
  KnowledgeClaimV03,
  KnowledgeEntityV03,
  KnowledgeRelationV03,
  KnowledgeSourceV03,
  SourceTypeV03,
} from './domain.ts'

const lifecycle = { status: 'active' as const }

const theme: InvestmentThemeV03 = {
  id: 'entity:ai-compute',
  type: 'investment_theme',
  name: 'AI Compute',
  aliases: [],
  description: null,
  externalIds: {},
  taxonomyRefs: [],
  metadata: {},
  lifecycle,
  themeGroupRef: 'theme-group:technology',
  definition: 'AI compute infrastructure',
  inclusionCriteria: ['compute hardware'],
  exclusionCriteria: [],
}

const industry: IndustryV03 = {
  id: 'entity:semiconductor',
  type: 'industry',
  name: 'Semiconductor',
  aliases: [],
  description: null,
  externalIds: {},
  taxonomyRefs: [],
  metadata: {},
  lifecycle,
}

const company: CompanyV03 = {
  id: 'entity:example-company',
  type: 'company',
  name: 'Example Company',
  aliases: [],
  description: null,
  externalIds: {},
  taxonomyRefs: [],
  metadata: {},
  lifecycle,
  ticker: null,
  exchange: null,
  legalName: null,
}

const businessExposure: BusinessExposureRelationV03 = {
  id: 'relation:example-company-semiconductor',
  type: 'business_exposure',
  sourceRef: company.id,
  targetRef: industry.id,
  attributes: {
    exposureBasis: 'direct_operation',
    realizationStage: 'commercialized',
    materiality: 'core',
    financialContribution: { revenueShare: 0.4, profitShare: 0.2 },
  },
  contextRefs: [],
  supportingClaimRefs: [],
  sourceRefs: ['source:annual-report'],
  confidence: 0.9,
  asOf: null,
  lifecycle,
}

const claim: KnowledgeClaimV03 = {
  id: 'claim:example-revenue',
  claimType: 'fact',
  statement: 'Example Company reports semiconductor revenue.',
  subjectRefs: [company.id, businessExposure.id],
  primarySubjectRef: company.id,
  temporal: {
    asOf: null,
    scope: { type: 'period', start: null, end: null, label: 'FY2025' },
  },
  structuredValue: { metric: 'revenueShare', value: 0.4, unit: 'ratio', comparator: 'eq' },
  sourceRefs: ['source:annual-report'],
  provenance: [{ sourceRef: 'source:annual-report', rawRef: 'raw:annual-report', locator: null, chunkRef: null }],
  confidence: 0.95,
  lifecycle,
  supersedes: [],
  supersededBy: [],
}

const source: KnowledgeSourceV03 = {
  id: 'source:annual-report',
  sourceType: 'official_disclosure',
  sourceReliability: 'high',
  title: 'Annual Report',
  publisher: 'Example Company',
  publishedAt: null,
  rawRefs: ['raw:annual-report'],
  lifecycle,
}

test('v0.3 domain accepts valid Theme, Entity, Relation, Claim, and Source values', () => {
  const entities: KnowledgeEntityV03[] = [theme, industry, company]
  const relations: KnowledgeRelationV03[] = [businessExposure]
  assert.equal(entities[0]?.type, 'investment_theme')
  assert.equal(relations[0]?.type, 'business_exposure')
  assert.equal(claim.claimType, 'fact')
  assert.equal(source.sourceType, 'official_disclosure')
})

test('v0.3 domain rejects arbitrary semantic values and invalid durable namespaces', () => {
  const validSourceType: SourceTypeV03 = 'company_official'
  assert.equal(validSourceType, 'company_official')

  // @ts-expect-error segment is retired from the v0.3 Entity type union
  const invalidEntityType: IndustryV03['type'] = 'segment'
  // @ts-expect-error retired contains is not a v0.3 Relation type
  const invalidRelationType: BusinessExposureRelationV03['type'] = 'contains'
  // @ts-expect-error retired operates_in is not a v0.3 Relation type
  const invalidOperatingRelationType: BusinessExposureRelationV03['type'] = 'operates_in'
  // @ts-expect-error arbitrary claim types are not accepted
  const invalidClaimType: KnowledgeClaimV03['claimType'] = 'arbitrary_claim'
  // @ts-expect-error source types derive from the executable schema authority
  const invalidSourceType: SourceTypeV03 = 'unsupported'
  // @ts-expect-error Entity refs must use the object-kind entity namespace
  const invalidEntityRef: CompanyV03['id'] = 'company:example'
  // @ts-expect-error canonical entities do not accept arbitrary top-level fields
  const invalidEntityField: CompanyV03 = { ...company, industries: ['entity:semiconductor'] }

  assert.equal(typeof invalidEntityType, 'string')
  assert.equal(typeof invalidRelationType, 'string')
  assert.equal(typeof invalidOperatingRelationType, 'string')
  assert.equal(typeof invalidClaimType, 'string')
  assert.equal(typeof invalidSourceType, 'string')
  assert.equal(typeof invalidEntityRef, 'string')
  assert.equal('industries' in invalidEntityField, true)
})

test('v0.3 domain does not expose Intelligence as a canonical type or arbitrary fields', () => {
  const entity = company
  assert.equal('intelligence' in entity, false)
  assert.equal('industries' in entity, false)
  assert.equal('themes' in entity, false)
})
