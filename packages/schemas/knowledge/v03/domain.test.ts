import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  BusinessExposureRelationV03,
  CompanyV03,
  IndustryV03,
  InvestmentThemeV03,
  KnowledgeClaimV03,
  KnowledgeEntityV03,
  KnowledgeModuleV03,
  KnowledgeRelationV03,
  KnowledgeSourceV03,
  SourceTypeV03,
} from './domain.ts'

type RequiredKeys<T> = {
  [K in keyof T]-?: {} extends Pick<T, K> ? never : K
}[keyof T]
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false
type Assert<T extends true> = T

export type DomainRequiredFieldParityChecks = [
  Assert<Equal<RequiredKeys<IndustryV03>, 'id' | 'type' | 'name' | 'lifecycle'>>,
  Assert<Equal<RequiredKeys<InvestmentThemeV03>, 'id' | 'type' | 'name' | 'lifecycle' | 'themeGroupRef'>>,
  Assert<Equal<RequiredKeys<BusinessExposureRelationV03>, 'id' | 'type' | 'sourceRef' | 'targetRef' | 'lifecycle'>>,
  Assert<Equal<RequiredKeys<KnowledgeClaimV03>, 'id' | 'claimType' | 'statement' | 'subjectRefs' | 'sourceRefs' | 'lifecycle'>>,
  Assert<Equal<RequiredKeys<KnowledgeSourceV03>, 'id' | 'title' | 'sourceType'>>,
  Assert<Equal<RequiredKeys<KnowledgeModuleV03>, 'id' | 'type'>>,
]

const lifecycle = { status: 'active' as const }

const theme: InvestmentThemeV03 = {
  id: 'entity:ai-compute',
  type: 'investment_theme',
  name: 'AI Compute',
  lifecycle,
  themeGroupRef: 'theme-group:technology',
}

const industry: IndustryV03 = {
  id: 'entity:semiconductor',
  type: 'industry',
  name: 'Semiconductor',
  lifecycle,
}

const company: CompanyV03 = {
  id: 'entity:example-company',
  type: 'company',
  name: 'Example Company',
  lifecycle,
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
  lifecycle,
}

const minimalRelation: KnowledgeRelationV03 = {
  id: 'relation:semiconductor-upstream-of-chip-design',
  type: 'upstream_of',
  sourceRef: industry.id,
  targetRef: 'entity:chip-design',
  lifecycle,
}

const claim: KnowledgeClaimV03 = {
  id: 'claim:example-revenue',
  claimType: 'fact',
  statement: 'Example Company reports semiconductor revenue.',
  subjectRefs: [company.id, businessExposure.id],
  sourceRefs: ['source:annual-report'],
  lifecycle,
}

const source: KnowledgeSourceV03 = {
  id: 'source:annual-report',
  title: 'Annual Report',
  sourceType: 'official_disclosure',
  type: 'research_report',
  quality: { score: 0.9, note: 'reviewed' },
}

const module: KnowledgeModuleV03 = {
  id: 'module:comparison',
  type: 'comparison',
  targetEntity: 'segment:semiconductor',
  sourceRefs: ['source:annual-report'],
  schemaId: 'comparison.v0.2',
  columns: ['company', 'revenueShare'],
  rows: [['Example Company', 0.4]],
}

test('v0.3 domain accepts minimal canonical objects and the compatible Module shape', () => {
  const entities: KnowledgeEntityV03[] = [theme, industry, company]
  const relations: KnowledgeRelationV03[] = [businessExposure, minimalRelation]
  assert.equal(entities[0]?.type, 'investment_theme')
  assert.equal(relations[0]?.type, 'business_exposure')
  assert.equal(relations[1]?.type, 'upstream_of')
  assert.equal(claim.claimType, 'fact')
  assert.equal(source.sourceType, 'official_disclosure')
  assert.equal(module.targetEntity, 'segment:semiconductor')
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
  // @ts-expect-error Module preserves declared v0.2 fields and does not invent targetRefs
  const invalidModuleField: KnowledgeModuleV03 = { ...module, targetRefs: ['entity:semiconductor'] }

  assert.equal(typeof invalidEntityType, 'string')
  assert.equal(typeof invalidRelationType, 'string')
  assert.equal(typeof invalidOperatingRelationType, 'string')
  assert.equal(typeof invalidClaimType, 'string')
  assert.equal(typeof invalidSourceType, 'string')
  assert.equal(typeof invalidEntityRef, 'string')
  assert.equal('industries' in invalidEntityField, true)
  assert.equal('targetRefs' in invalidModuleField, true)
})

test('v0.3 domain does not expose Intelligence as a canonical type or arbitrary fields', () => {
  const entity = company
  assert.equal('intelligence' in entity, false)
  assert.equal('industries' in entity, false)
  assert.equal('themes' in entity, false)
})
