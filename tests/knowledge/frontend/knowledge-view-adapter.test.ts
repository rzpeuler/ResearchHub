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

const companyRelation = (companyId: string) => ({
  id: `relation:${companyId}-operates-in-gpu`, type: 'operates_in', source: companyId, target: 'segment:gpu',
  attributes: { segmentRevenue: 999 },
})

test('directory projection uses the production 31-item taxonomy and Chinese graph name', async () => {
  const projection = (await createAdapter()).getIndustryDirectoryProjection()
  assert.equal(projection.industries.length, 31)
  const electronics = projection.industries.find((industry) => industry.id === 'sw:electronics')
  assert.deepEqual(electronics?.graphs, [{ id: 'industry:ai-hardware', name: 'AI 硬件' }])
})

test('graph projection uses production entities and relation contract', async () => {
  const projection = (await createAdapter()).getGraphProjection('industry:ai-hardware')
  assert.deepEqual(projection.root, { id: 'industry:ai-hardware', type: 'industry', name: 'AI 硬件', hasChildren: true })
  assert.ok(projection.children.some((child) => child.id === 'segment:gpu'))
  assert.ok(projection.relations.every((relation) => 'source' in relation && 'target' in relation && !('fromEntityId' in relation)))
})

test('entity detail uses company total-revenue Facts and no market share semantics', async () => {
  const detail = (await createAdapter()).getEntityDetailProjection('segment:gpu')
  assert.deepEqual(detail.relatedCompanies.map(({ company }) => company.id), ['company:amd', 'company:nvidia'])
  assert.deepEqual(detail.modules[0]?.columns, ['产品', '厂商', '工作负载', '架构代际'])
  assert.ok(detail.sources.some((source) => source.id === 'source:nvidia-annual-report-2025'))
  assert.deepEqual(detail.companyScale?.entries.map(({ company, revenue, period, unit }) => ({ company: company.id, revenue, period, unit })), [
    { company: 'company:nvidia', revenue: 130.5, period: 'FY2025', unit: 'USD billion' },
    { company: 'company:amd', revenue: 34.6, period: 'FY2025', unit: 'USD billion' },
  ])
  assert.ok(detail.viewSections.includes('company-scale'))
  assert.ok(!detail.viewSections.includes('market-share'))
})

test('company scale projection uses total-revenue Facts instead of segmentRevenue', () => {
  const projection = buildCompanyScaleProjection('segment:gpu', [
    { company: { id: 'company:amd', type: 'company', name: 'AMD' }, relation: companyRelation('company:amd') },
    { company: { id: 'company:nvidia', type: 'company', name: 'NVIDIA' }, relation: companyRelation('company:nvidia') },
  ], (companyId) => companyId === 'company:nvidia' ? [{
    id: 'fact:nvidia-total-revenue-fy2025', type: 'fact', entityRefs: ['company:nvidia'], metric: 'total-revenue',
    category: 'financial_metric', value: 130.5, period: 'FY2025', unit: 'USD billion', sourceRefs: ['source:nvidia-annual-report-2025'], confidence: 0.99, lifecycle: { status: 'active' },
  }] : [{
    id: 'fact:amd-total-revenue-fy2025', type: 'fact', entityRefs: ['company:amd'], metric: 'total-revenue',
    category: 'financial_metric', value: 34.6, period: 'FY2025', unit: 'USD billion', sourceRefs: ['source:amd-annual-report-2025'], confidence: 0.99, lifecycle: { status: 'active' },
  }])
  assert.equal(projection?.entityId, 'segment:gpu')
  assert.deepEqual(projection?.entries.map(({ company, revenue, period, unit, sourceRefs }) => ({ company: company.id, revenue, period, unit, sourceRefs })), [
    { company: 'company:nvidia', revenue: 130.5, period: 'FY2025', unit: 'USD billion', sourceRefs: ['source:nvidia-annual-report-2025'] },
    { company: 'company:amd', revenue: 34.6, period: 'FY2025', unit: 'USD billion', sourceRefs: ['source:amd-annual-report-2025'] },
  ])
  assert.ok(projection && !('totalRevenue' in projection) && !('marketShare' in projection) && !JSON.stringify(projection).includes('segmentRevenue'))
})

test('company scale projection selects active highest-confidence facts and latest period on ties', () => {
  const projection = buildCompanyScaleProjection('segment:gpu', [
    { company: { id: 'company:amd', type: 'company', name: 'AMD' }, relation: companyRelation('company:amd') },
  ], () => [
    { id: 'fact:inactive', type: 'fact', entityRefs: ['company:amd'], metric: 'total-revenue', category: 'financial_metric', value: 30, period: 'FY2025', unit: 'USD billion', confidence: 1, lifecycle: { status: 'inactive' } },
    { id: 'fact:lower-confidence', type: 'fact', entityRefs: ['company:amd'], metric: 'total-revenue', category: 'financial_metric', value: 31, period: 'FY2025', unit: 'USD billion', confidence: 0.8, lifecycle: { status: 'active' } },
    { id: 'fact:high-confidence-old', type: 'fact', entityRefs: ['company:amd'], metric: 'total-revenue', category: 'financial_metric', value: 32, period: 'FY2024', unit: 'USD billion', confidence: 0.99, lifecycle: { status: 'active' } },
    { id: 'fact:high-confidence-new', type: 'fact', entityRefs: ['company:amd'], metric: 'total-revenue', category: 'financial_metric', value: 34.6, period: 'FY2025', unit: 'USD billion', confidence: 0.99, lifecycle: { status: 'active' } },
  ])
  assert.equal(projection?.entries[0]?.revenue, 34.6)
  assert.equal(projection?.entries[0]?.period, 'FY2025')
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

test('production human-readable names and research content are Chinese-first', async () => {
  const adapter = await createAdapter()
  const industry = adapter.getEntityDetailProjection('industry:ai-hardware')
  const viewpoint = industry.viewpoints.find((item) => item.id === 'viewpoint:ai-hardware-2026')
  const names = [
    ['industry:ai-hardware', 'AI 硬件'],
    ['segment:data-center', '数据中心'],
    ['segment:server', '服务器'],
    ['segment:liquid-cooling', '液冷'],
    ['segment:optical-module', '光模块'],
    ['segment:pcb-material', 'PCB 材料'],
    ['segment:pcb-manufacturing', 'PCB 制造'],
    ['segment:gpu', 'GPU'],
    ['segment:hbm', 'HBM'],
  ] as const
  for (const [id, name] of names) assert.equal(adapter.getEntityDetailProjection(id).entity.name, name)
  assert.match(industry.entity.description || '', /[\u4e00-\u9fff]/)
  assert.ok(viewpoint?.bullishPoints?.every((point) => /[\u4e00-\u9fff]/.test(String(point))))
  assert.ok(viewpoint?.bearishPoints?.every((point) => /[\u4e00-\u9fff]/.test(String(point))))
})
