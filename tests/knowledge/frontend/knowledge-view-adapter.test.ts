import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { KnowledgeAccessSkill } from '../../../packages/skills/knowledge-access/index.ts'
import { KnowledgeLoader } from '../../../packages/skills/knowledge-access/loader.ts'
import { KnowledgeViewAdapter } from './knowledge-view-adapter.ts'

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

test('entity detail composes GPU companies, dynamic comparison, sources, and no unsupported market share', async () => {
  const detail = (await createAdapter()).getEntityDetailProjection('segment:gpu')
  assert.deepEqual(detail.relatedCompanies.map(({ company }) => company.id), ['company:amd', 'company:nvidia'])
  assert.deepEqual(detail.modules[0]?.columns, ['product', 'vendor', 'workload', 'architectureGeneration'])
  assert.ok(detail.sources.some((source) => source.id === 'source:nvidia-annual-report-2025'))
  assert.equal(detail.marketShare, undefined)
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
