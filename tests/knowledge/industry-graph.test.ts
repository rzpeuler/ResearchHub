import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  calculateMarketShare,
  getContainedEntities,
  getEventsForEntity,
  getListedCompanyAssociations,
  getResearchForEntity,
  getEntity,
  type IndustryGraphDataset,
  validateGraphDataset,
} from './industry-graph.ts'

const dataset = JSON.parse(
  await readFile(new URL('./industry-graph.json', import.meta.url), 'utf8'),
) as IndustryGraphDataset
const directory = JSON.parse(
  await readFile(new URL('./industry-directory.json', import.meta.url), 'utf8'),
) as { classification: string; industries: { id: string; name: string; graphs: { id: string; name: string }[] }[] }

test('AI Hardware mock dataset contains the required graph coverage', () => {
  const requiredSegments = ['GPU', 'HBM', 'PCB Material', 'PCB Manufacturing', 'Optical Module', 'Server', 'Data Center']
  const requiredCompanies = ['生益科技', '沪电股份', '深南电路', 'NVIDIA', 'AMD', '浪潮信息', '工业富联', 'SK Hynix', 'Samsung', 'Micron']
  const entityNames = new Set(dataset.entities.map((entity) => entity.name))

  for (const name of [...requiredSegments, ...requiredCompanies]) assert.ok(entityNames.has(name), `missing ${name}`)
  assert.deepEqual(new Set(dataset.events.map((event) => event.title)), new Set(['NVIDIA Rubin Release', 'AI Server Architecture Upgrade']))
  assert.equal(dataset.research.length >= 3, true)
  assert.deepEqual(validateGraphDataset(dataset), [])
})

test('industry directory contains all mock Shenwan level-one industries and mounts AI Hardware under Electronics', () => {
  assert.equal(directory.industries.length, 31)
  const electronics = directory.industries.find((industry) => industry.name === '电子')

  assert.ok(electronics)
  assert.deepEqual(electronics?.graphs.map((graph) => graph.id), ['industry:ai-hardware'])
})

test('industry knowledge keeps product comparison scoped to product variants within a segment', () => {
  const industry = getEntity(dataset, 'industry:ai-hardware')
  const gpu = getEntity(dataset, 'segment:gpu')
  const pcbMaterial = getEntity(dataset, 'segment:pcb-material')

  assert.ok(industry?.knowledge?.description)
  assert.equal(industry?.knowledge?.marketForecast?.length, 5)
  assert.equal(industry?.knowledge?.productComparison, undefined)
  assert.deepEqual(gpu?.knowledge?.productComparison?.map((item) => item.product), ['训练型 GPU', '推理型 GPU', '边缘型 GPU'])
  assert.equal(pcbMaterial?.knowledge?.productComparison?.length, 3)
  assert.equal(pcbMaterial?.knowledge?.images, undefined)
})

test('core views and event links support node-following analysis panels', () => {
  const industry = getEntity(dataset, 'industry:ai-hardware')
  const server = getEntity(dataset, 'segment:server')
  const inspur = getEntity(dataset, 'company:inspur')
  const serverEvent = dataset.events.find((event) => event.id === 'event:server-architecture-upgrade')

  assert.ok(industry?.coreView?.bullish?.length)
  assert.ok(server?.coreView?.logic?.length)
  assert.ok(inspur?.coreView?.contradictions?.length)
  assert.ok(serverEvent?.affectedEntityIds.includes('company:inspur'))
})

test('contains relations support nested Data Center -> Server -> components navigation', () => {
  const dataCenterChildren = getContainedEntities(dataset, 'segment:data-center').map((entity) => entity.name)
  const serverChildren = getContainedEntities(dataset, 'segment:server').map((entity) => entity.name)

  assert.deepEqual(dataCenterChildren, ['Data Center Construction', 'Server', 'Network & Power Infrastructure'])
  assert.deepEqual(serverChildren, ['GPU', 'Liquid Cooling', 'Rack Assembly'])
})

test('market share derives from operates_in segment revenue without new data types', () => {
  const entries = calculateMarketShare(dataset, 'segment:liquid-cooling')
  const totalShare = entries.reduce((sum, entry) => sum + entry.marketShare, 0)

  assert.equal(entries[0]?.company.name, '浪潮信息')
  assert.equal(entries.length, 5)
  assert.ok(Math.abs(totalShare - 1) < 0.000001)
  assert.equal(entries[0]?.totalRevenue, 780)
})

test('company profiles and listing state support card and side-panel details', () => {
  const privateCompany = getEntity(dataset, 'company:liquid-mock')
  const profile = privateCompany?.profile

  assert.equal(privateCompany?.listingStatus, 'private')
  assert.deepEqual(profile?.productTypes, ['CDU', '液冷板'])
  assert.ok(profile?.technologyMoats.length)
  assert.ok(profile?.customerCertifications.length)
})

test('listed-company relations are filtered to the active business segment', () => {
  const associations = getListedCompanyAssociations(dataset, 'company:liquid-mock', 'segment:liquid-cooling')

  assert.deepEqual(associations.map(({ relation }) => relation.type), ['owns_stake_in', 'project_partner_of', 'project_investor_of'])
  assert.deepEqual(associations.map(({ company }) => company.name), ['上市公司 A（Mock）', '上市公司 B（Mock）', '上市公司 C（Mock）'])
  assert.equal(getListedCompanyAssociations(dataset, 'company:liquid-mock', 'segment:gpu').length, 0)
})

test('research and events remain queryable from any linked Entity', () => {
  const liquidResearch = getResearchForEntity(dataset, 'segment:liquid-cooling')
  const liquidEvents = getEventsForEntity(dataset, 'segment:liquid-cooling')
  const serverResearch = getResearchForEntity(dataset, 'segment:server')
  const inspurResearch = getResearchForEntity(dataset, 'company:inspur')

  assert.equal(liquidResearch.length, 2)
  assert.ok(liquidResearch.some((item) => item.documentPath?.endsWith('liquid-cooling-competition.md')))
  assert.ok(serverResearch.some((item) => item.title === 'AI Server Architecture Upgrade 研究摘要'))
  assert.ok(inspurResearch.some((item) => item.title === 'AI Server Architecture Upgrade 研究摘要'))
  assert.equal(liquidEvents[0]?.title, 'AI Server Architecture Upgrade')
  assert.ok(liquidEvents.some((event) => event.title === 'NVIDIA Rubin Release'))
})
