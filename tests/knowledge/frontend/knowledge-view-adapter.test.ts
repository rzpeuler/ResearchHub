import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { KnowledgeAccessSkill } from '../../../packages/skills/knowledge-access/index.ts'
import { KnowledgeLoader } from '../../../packages/skills/knowledge-access/loader.ts'
import { buildCompanyScaleProjection, KnowledgeViewAdapter } from './knowledge-view-adapter.ts'

const knowledgeRoot = fileURLToPath(new URL('../../../knowledge/', import.meta.url))

async function createAdapter(): Promise<KnowledgeViewAdapter> {
  const access = new KnowledgeAccessSkill({ index: await new KnowledgeLoader({ rootDir: knowledgeRoot }).load() })
  return KnowledgeViewAdapter.create({
    access,
    taxonomyPath: fileURLToPath(new URL('../../../knowledge/taxonomy/sw-level-1.yaml', import.meta.url)),
    viewPath: fileURLToPath(new URL('../../../knowledge/views/ai-hardware-industry.yaml', import.meta.url)),
  })
}

test('directory projection uses the production 31-item taxonomy', async () => {
  const projection = (await createAdapter()).getIndustryDirectoryProjection()
  assert.equal(projection.industries.length, 31)
  const electronics = projection.industries.find((industry) => industry.id === 'sw:electronics')
  assert.deepEqual(electronics?.graphs, [{ id: 'industry:ai-hardware', name: 'AI Hardware' }])
})

test('graph projection uses production entities and relation contract', async () => {
  const projection = (await createAdapter()).getGraphProjection('industry:ai-hardware')
  assert.deepEqual(projection.root, { id: 'industry:ai-hardware', type: 'industry', name: 'AI Hardware', hasChildren: true })
  assert.ok(projection.children.some((child) => child.id === 'segment:gpu'))
  assert.ok(projection.relations.every((relation) => 'source' in relation && 'target' in relation && !('fromEntityId' in relation)))
})

test('entity detail composes GPU companies, dynamic comparison, sources, and no market share semantics', async () => {
  const detail = (await createAdapter()).getEntityDetailProjection('segment:gpu')
  assert.deepEqual(detail.relatedCompanies.map(({ company }) => company.id), ['company:amd', 'company:nvidia'])
  assert.deepEqual(detail.modules[0]?.columns, ['产品', '厂商', '工作负载', '架构代际'])
  assert.ok(detail.sources.some((source) => source.id === 'source:nvidia-annual-report-2025'))
  assert.equal(detail.companyScale, undefined)
  assert.ok(detail.viewSections.includes('company-scale'))
  assert.ok(!detail.viewSections.includes('market-share'))
})

test('company scale projection returns raw comparable revenue inputs without a denominator', () => {
  const projection = buildCompanyScaleProjection('segment:gpu', [
    {
      company: { id: 'company:amd', type: 'company', name: 'AMD' },
      relation: {
        id: 'relation:amd-operates-in-gpu', type: 'operates_in', source: 'company:amd', target: 'segment:gpu',
        attributes: { segmentRevenue: 16.6, period: 'FY2025', unit: 'USD billion', revenueScope: 'Data Center' },
      },
    },
    {
      company: { id: 'company:nvidia', type: 'company', name: 'NVIDIA' },
      relation: {
        id: 'relation:nvidia-operates-in-gpu', type: 'operates_in', source: 'company:nvidia', target: 'segment:gpu',
        attributes: { segmentRevenue: 115.2, period: 'FY2025', currency: 'USD billion', revenueScope: 'Data Center' },
      },
    },
  ])
  assert.deepEqual(projection?.entries.map(({ company, segmentRevenue, period, unit, revenueScope }) => ({
    company: company.id, segmentRevenue, period, unit, revenueScope,
  })), [
    { company: 'company:nvidia', segmentRevenue: 115.2, period: 'FY2025', unit: 'USD billion', revenueScope: 'Data Center' },
    { company: 'company:amd', segmentRevenue: 16.6, period: 'FY2025', unit: 'USD billion', revenueScope: 'Data Center' },
  ])
  assert.ok(projection && !('totalRevenue' in projection) && !('marketShare' in projection))
})

test('company scale projection preserves non-comparable raw inputs for equal-size fallback', () => {
  const projection = buildCompanyScaleProjection('segment:gpu', [
    {
      company: { id: 'company:amd', type: 'company', name: 'AMD' },
      relation: {
        id: 'relation:amd-operates-in-gpu', type: 'operates_in', source: 'company:amd', target: 'segment:gpu',
        attributes: { segmentRevenue: 16.6, period: 'FY2025', unit: 'USD billion', revenueScope: 'Data Center' },
      },
    },
    {
      company: { id: 'company:nvidia', type: 'company', name: 'NVIDIA' },
      relation: {
        id: 'relation:nvidia-operates-in-gpu', type: 'operates_in', source: 'company:nvidia', target: 'segment:gpu',
        attributes: { segmentRevenue: 115.2, period: 'FY2024', unit: 'USD billion', revenueScope: 'Data Center' },
      },
    },
  ])
  assert.equal(projection?.entries.length, 2)
  assert.notEqual(projection?.entries[0]?.period, projection?.entries[1]?.period)
  assert.deepEqual(buildCompanyScaleProjection('segment:gpu', [
    {
      company: { id: 'company:amd', type: 'company', name: 'AMD' },
      relation: { id: 'r', type: 'operates_in', source: 'company:amd', target: 'segment:gpu', attributes: { segmentRevenue: 1 } },
    },
  ]), undefined)
})

test('industry and company details expose production intelligence semantics', async () => {
  const adapter = await createAdapter()
  const industry = adapter.getEntityDetailProjection('industry:ai-hardware')
  const dataCenter = adapter.getEntityDetailProjection('segment:data-center')
  const nvidia = adapter.getEntityDetailProjection('company:nvidia')
  assert.ok(industry.viewpoints.some((item) => item.id === 'viewpoint:ai-hardware-2026'))
  assert.ok(industry.events.some((event) => event.id === 'fact:nvidia-rubin-release-2026'))
  assert.ok(dataCenter.forecasts.some((item) => item.id === 'forecast:data-center-electricity-demand-2030'))
  assert.ok(nvidia.facts.some((item) => item.id === 'fact:nvidia-total-revenue-fy2025' && item.category === 'financial_metric'))
})

test('production human-readable research content is Chinese-first', async () => {
  const adapter = await createAdapter()
  const industry = adapter.getEntityDetailProjection('industry:ai-hardware')
  const viewpoint = industry.viewpoints.find((item) => item.id === 'viewpoint:ai-hardware-2026')
  const gpu = adapter.getEntityDetailProjection('segment:gpu')
  assert.match(industry.entity.description || '', /[一-鿿]/)
  assert.ok(viewpoint?.bullishPoints?.every((point) => /[一-鿿]/.test(String(point))))
  assert.ok(viewpoint?.bearishPoints?.every((point) => /[一-鿿]/.test(String(point))))
  assert.deepEqual(gpu.modules[0]?.columns, ['产品', '厂商', '工作负载', '架构代际'])
})
