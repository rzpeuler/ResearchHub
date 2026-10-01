import assert from 'node:assert/strict'
import test from 'node:test'
import { COMPETITION_MODULE_SCHEMA_ID_V1 } from '../../knowledge/schema/competition-module-v04.ts'
import { validateKnowledgeV04Objects } from '../../knowledge/validation/v04-validator.ts'

const COMPANY_REF = 'entity:competition-company'
const INDUSTRY_REF = 'entity:competition-industry'
const SOURCE_REF = 'source:competition-evidence'
const BUSINESS_EXPOSURE_REF = 'relation:competition-company-industry'

function competitionObjects(): unknown[] {
  return [
    {
      id: SOURCE_REF,
      title: 'Competition evidence',
      sourceType: 'official_disclosure',
      rights: { accessScope: 'public', providerTermsKnown: true, derivativeKnowledgeAllowed: true },
      usagePolicy: {
        mode: 'personal_noncommercial_research',
        retainRaw: false,
        allowAiProcessing: true,
        allowDerivedKnowledge: true,
        redistributionAllowed: false,
      },
    },
    { id: COMPANY_REF, type: 'company', name: 'Example Company', lifecycle: { status: 'active' } },
    { id: INDUSTRY_REF, type: 'industry', name: 'Example Industry', lifecycle: { status: 'active' } },
    {
      id: BUSINESS_EXPOSURE_REF,
      type: 'business_exposure',
      sourceRef: COMPANY_REF,
      targetRef: INDUSTRY_REF,
      lifecycle: { status: 'active' },
    },
    {
      id: 'claim:competition-products',
      claimType: 'fact',
      statement: 'The company makes example products.',
      subjectRefs: [COMPANY_REF],
      sourceRefs: [SOURCE_REF],
      lifecycle: { status: 'active' },
    },
    {
      id: 'claim:competition-market-cap',
      claimType: 'fact',
      statement: 'The company has a verified market capitalization.',
      subjectRefs: [COMPANY_REF],
      sourceRefs: [SOURCE_REF],
      lifecycle: { status: 'active' },
    },
    {
      id: 'observation:competition-revenue',
      observationType: 'metric',
      subjectRef: COMPANY_REF,
      metricRef: 'metric:revenue',
      value: 125,
      unit: 'CNY 100M',
      sourceRef: SOURCE_REF,
      reportedAt: '2026-03-31T00:00:00.000Z',
      lifecycle: { status: 'active' },
    },
    {
      id: 'module:competition-industry',
      type: 'competition',
      targetEntity: INDUSTRY_REF,
      sourceRefs: [SOURCE_REF],
      schemaId: COMPETITION_MODULE_SCHEMA_ID_V1,
      columns: [
        { id: 'company', role: 'company', label: 'Company' },
        { id: 'main_products', role: 'main_products', label: 'Main products' },
        { id: 'market_cap', role: 'market_cap', label: 'Market cap' },
        { id: 'annual_revenue', role: 'annual_revenue', label: 'Annual revenue' },
        { id: 'business_link', role: 'custom', label: 'Industry exposure', customRole: 'industry_exposure' },
      ],
      rows: [
        {
          companyRef: COMPANY_REF,
          cells: {
            main_products: {
              status: 'available',
              displayValue: 'Example products',
              knowledgeRefs: ['claim:competition-products'],
            },
            market_cap: {
              status: 'available',
              displayValue: 'USD 3B',
              knowledgeRefs: ['claim:competition-market-cap'],
              asOf: '2026-09-30',
              unit: 'USD',
              currency: 'USD',
            },
            annual_revenue: {
              status: 'available',
              displayValue: 'CNY 12.5B',
              knowledgeRefs: ['observation:competition-revenue'],
              fiscalYear: 2025,
              unit: 'CNY 100M',
              currency: 'CNY',
            },
            business_link: {
              status: 'available',
              displayValue: 'Active business exposure',
              knowledgeRefs: [BUSINESS_EXPOSURE_REF],
            },
          },
        },
      ],
    },
  ]
}

function moduleFrom(objects: unknown[]): Record<string, unknown> {
  return objects.find((value) => typeof value === 'object' && value !== null && 'id' in value && value.id === 'module:competition-industry') as Record<string, unknown>
}

function errorCodes(objects: unknown[]): string[] {
  return validateKnowledgeV04Objects(objects as never).errors.map((error) => error.code)
}

test('global Schema 0.4 validation accepts a competition module with candidate-batch references and mixed currencies', () => {
  const result = validateKnowledgeV04Objects(competitionObjects() as never)
  assert.equal(result.status, 'passed', JSON.stringify(result.errors))
})

test('competition target must resolve to an active Industry Entity', () => {
  const missingTarget = competitionObjects()
  moduleFrom(missingTarget).targetEntity = 'entity:missing-industry'
  assert.ok(errorCodes(missingTarget).includes('V04_COMPETITION_MODULE_TARGET'))

  const wrongTarget = competitionObjects()
  moduleFrom(wrongTarget).targetEntity = COMPANY_REF
  assert.ok(errorCodes(wrongTarget).includes('V04_COMPETITION_MODULE_TARGET'))

  const inactiveTarget = competitionObjects()
  const industry = inactiveTarget.find((value) => typeof value === 'object' && value !== null && 'id' in value && value.id === INDUSTRY_REF) as Record<string, unknown>
  industry.lifecycle = { status: 'archived' }
  assert.ok(errorCodes(inactiveTarget).includes('V04_COMPETITION_MODULE_TARGET'))
})

test('competition type rejects an unsupported schemaId', () => {
  const objects = competitionObjects()
  moduleFrom(objects).schemaId = 'competition-module-v99'
  assert.ok(errorCodes(objects).includes('V04_COMPETITION_MODULE_SCHEMA'))
})

test('competition row company must resolve to an active Company Entity', () => {
  const missingCompany = competitionObjects()
  const module = moduleFrom(missingCompany)
  const rows = module.rows as Array<Record<string, unknown>>
  rows[0]!.companyRef = 'entity:missing-company'
  assert.ok(errorCodes(missingCompany).includes('V04_COMPETITION_MODULE_COMPANY'))

  const wrongCompanyType = competitionObjects()
  const wrongModule = moduleFrom(wrongCompanyType)
  ;(wrongModule.rows as Array<Record<string, unknown>>)[0]!.companyRef = INDUSTRY_REF
  assert.ok(errorCodes(wrongCompanyType).includes('V04_COMPETITION_MODULE_COMPANY'))
})

test('competition row requires an active Company-to-Industry business_exposure relation', () => {
  const objects = competitionObjects()
  const relation = objects.find((value) => typeof value === 'object' && value !== null && 'id' in value && value.id === BUSINESS_EXPOSURE_REF) as Record<string, unknown>
  relation.lifecycle = { status: 'archived' }
  assert.ok(errorCodes(objects).includes('V04_COMPETITION_MODULE_BUSINESS_EXPOSURE'))
})

test('competition module sourceRefs must resolve to Source objects', () => {
  const objects = competitionObjects()
  moduleFrom(objects).sourceRefs = ['source:missing-evidence']
  assert.ok(errorCodes(objects).includes('V04_COMPETITION_MODULE_SOURCE_REF'))
})

test('available competition cell references must resolve and match the row Company', () => {
  const missingReference = competitionObjects()
  const module = moduleFrom(missingReference)
  const rows = module.rows as Array<{ cells: Record<string, { knowledgeRefs: string[] }> }>
  rows[0]!.cells.main_products!.knowledgeRefs = ['claim:missing-products']
  assert.ok(errorCodes(missingReference).includes('V04_COMPETITION_MODULE_KNOWLEDGE_REF'))

  const unrelatedReference = competitionObjects()
  unrelatedReference.push({ id: 'entity:other-company', type: 'company', name: 'Other Company', lifecycle: { status: 'active' } })
  unrelatedReference.push({
    id: 'claim:other-company-products',
    claimType: 'fact',
    statement: 'This claim is about a different company.',
    subjectRefs: ['entity:other-company'],
    sourceRefs: [SOURCE_REF],
    lifecycle: { status: 'active' },
  })
  const unrelatedModule = moduleFrom(unrelatedReference)
  const unrelatedRows = unrelatedModule.rows as Array<{ cells: Record<string, { knowledgeRefs: string[] }> }>
  unrelatedRows[0]!.cells.main_products!.knowledgeRefs = ['claim:other-company-products']
  assert.ok(errorCodes(unrelatedReference).includes('V04_COMPETITION_MODULE_KNOWLEDGE_RELEVANCE'))

  const relationSubjectClaim = competitionObjects()
  relationSubjectClaim.push({
    id: 'claim:competition-relation-subject',
    claimType: 'fact',
    statement: 'The company has an active exposure to the industry.',
    subjectRefs: [BUSINESS_EXPOSURE_REF],
    sourceRefs: [SOURCE_REF],
    lifecycle: { status: 'active' },
  })
  const relationSubjectModule = moduleFrom(relationSubjectClaim)
  const relationSubjectRows = relationSubjectModule.rows as Array<{ cells: Record<string, { knowledgeRefs: string[] }> }>
  relationSubjectRows[0]!.cells.main_products!.knowledgeRefs = ['claim:competition-relation-subject']
  const relationSubjectResult = validateKnowledgeV04Objects(relationSubjectClaim as never)
  assert.equal(relationSubjectResult.status, 'passed', JSON.stringify(relationSubjectResult.errors))

  const unrelatedObservation = competitionObjects()
  unrelatedObservation.push({ id: 'entity:other-company', type: 'company', name: 'Other Company', lifecycle: { status: 'active' } })
  unrelatedObservation.push({
    id: 'observation:other-company-revenue',
    observationType: 'metric',
    subjectRef: 'entity:other-company',
    metricRef: 'metric:revenue',
    value: 300,
    unit: 'CNY 100M',
    sourceRef: SOURCE_REF,
    lifecycle: { status: 'active' },
  })
  const unrelatedObservationModule = moduleFrom(unrelatedObservation)
  const unrelatedObservationRows = unrelatedObservationModule.rows as Array<{ cells: Record<string, { knowledgeRefs: string[] }> }>
  unrelatedObservationRows[0]!.cells.annual_revenue!.knowledgeRefs = ['observation:other-company-revenue']
  assert.ok(errorCodes(unrelatedObservation).includes('V04_COMPETITION_MODULE_KNOWLEDGE_RELEVANCE'))

  const unrelatedRelation = competitionObjects()
  unrelatedRelation.push({ id: 'entity:other-company', type: 'company', name: 'Other Company', lifecycle: { status: 'active' } })
  unrelatedRelation.push({
    id: 'relation:other-company-industry',
    type: 'business_exposure',
    sourceRef: 'entity:other-company',
    targetRef: INDUSTRY_REF,
    lifecycle: { status: 'active' },
  })
  const unrelatedRelationModule = moduleFrom(unrelatedRelation)
  const unrelatedRelationRows = unrelatedRelationModule.rows as Array<{ cells: Record<string, { knowledgeRefs: string[] }> }>
  unrelatedRelationRows[0]!.cells.business_link!.knowledgeRefs = ['relation:other-company-industry']
  assert.ok(errorCodes(unrelatedRelation).includes('V04_COMPETITION_MODULE_KNOWLEDGE_RELEVANCE'))
})

test('malformed competition module input reports diagnostics without throwing', () => {
  const malformed = [
    null,
    {
      id: 'module:malformed-competition',
      type: 'competition',
      schemaId: COMPETITION_MODULE_SCHEMA_ID_V1,
      targetEntity: INDUSTRY_REF,
      columns: { unexpected: true },
      rows: null,
    },
  ]
  assert.doesNotThrow(() => validateKnowledgeV04Objects(malformed as never))
  assert.equal(validateKnowledgeV04Objects(malformed as never).status, 'failed')
})

test('legacy non-competition modules remain readable', () => {
  const objects = competitionObjects().filter((value) => !(typeof value === 'object' && value !== null && 'id' in value && value.id === 'module:competition-industry'))
  objects.push({ id: 'module:legacy-comparison', type: 'comparison' })
  const result = validateKnowledgeV04Objects(objects as never)
  assert.equal(result.status, 'passed', JSON.stringify(result.errors))
})
