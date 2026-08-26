import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { KnowledgeAccessSkill } from '../../../packages/skills/knowledge-access/index.ts'
import { KnowledgeBaseLoader } from '../../../packages/shared/knowledge-base/knowledge-base-loader.ts'
import { parseYaml } from '../../../packages/shared/knowledge-base/yaml.ts'
import { KnowledgeValidationSkill } from '../../../packages/skills/knowledge-validation/index.ts'

const exampleRoot = fileURLToPath(new URL('../../../examples/knowledge-bases/ai-hardware/', import.meta.url))
const taxonomyPath = fileURLToPath(new URL('../../../examples/knowledge-bases/ai-hardware/taxonomy/sw-level-1.yaml', import.meta.url))

async function loadExample() {
  const loader = new KnowledgeBaseLoader()
  const { handle, index } = await loader.mountAndLoad(exampleRoot)
  return { loader, handle, index, assets: await loader.readAssets(handle) }
}

test('AI Hardware Example Knowledge Base is registry-complete and validation-clean', async () => {
  const { loader, handle, index, assets } = await loadExample()
  assert.equal(assets.entities.length, 19)
  assert.equal(assets.relations.length, 23)
  assert.equal(assets.intelligence.length, 14)
  assert.equal(assets.modules.length, 4)
  assert.equal(assets.sources.length, 12)
  assert.equal(assets.registry.length, 72)
  assert.equal(index.moduleRegistry.size, 4)

  const report = await new KnowledgeValidationSkill({ loader }).validateKnowledgeBase(handle)
  assert.equal(report.status, 'passed')
  assert.equal(report.errors.length, 0)
})

test('Example Knowledge Base supports the frontend access queries', async () => {
  const { handle, index } = await loadExample()
  const skill = new KnowledgeAccessSkill({ handle, index })
  assert.ok(skill.getSupplyChain('industry:ai-hardware', 2).some((entity) => entity.id === 'segment:data-center'))
  assert.deepEqual(skill.getRelatedCompanies('segment:gpu').map(({ company }) => company.id), ['company:amd', 'company:nvidia'])
  assert.ok(skill.getIntelligence('segment:data-center').some((item) => item.type === 'forecast'))
  assert.deepEqual(skill.getModules('segment:gpu').map((module) => module.id), ['module:gpu-products'])
  assert.deepEqual(skill.getModules('segment:pcb-material').map((module) => module.id), ['module:pcb-material-products'])
  assert.equal(skill.getSources('fact:nvidia-total-revenue-fy2025')[0]?.id, 'source:nvidia-annual-report-2025')
})

test('Example sources are traceable and contain no fixture or placeholder URLs', async () => {
  const { assets } = await loadExample()
  for (const source of assets.sources) {
    assert.ok(typeof source.value.url === 'string' && /^https?:\/\//.test(source.value.url))
    assert.ok(!source.value.url.includes('example.com'))
    assert.notEqual(source.value.quality, 'fixture')
    assert.notEqual(source.value.publisher, 'ResearchHub fixture')
  }
})

test('all source-bearing Example assets resolve provenance through the registry', async () => {
  const { handle, index, assets } = await loadExample()
  const sourceIds = new Set(assets.sources.map((source) => source.value.id))
  const sourceBearingAssets = [...assets.entities, ...assets.relations, ...assets.intelligence, ...assets.modules]
  for (const asset of sourceBearingAssets) {
    const refs = asset.value.sourceRefs
    assert.ok(Array.isArray(refs) && refs.length > 0, `${asset.value.id} must have sourceRefs`)
    for (const sourceRef of refs) assert.ok(sourceIds.has(sourceRef), `${asset.value.id} references an unregistered Source`)
  }
  const access = new KnowledgeAccessSkill({ handle, index })
  assert.ok(access.getSources('module:gpu-products').some((source) => source.id === 'source:nvidia-annual-report-2025'))
})

test('financial facts do not map reporting segments to Knowledge segments without direct disclosure', async () => {
  const { assets } = await loadExample()
  const nvidiaRelation = assets.relations.find((item) => item.value.id === 'relation:nvidia-operates-in-gpu')
  const nvidiaFact = assets.intelligence.find((item) => item.value.id === 'fact:nvidia-data-center-revenue-fy2025')
  const amdFact = assets.intelligence.find((item) => item.value.id === 'fact:amd-data-center-revenue-fy2025')
  assert.equal(nvidiaRelation?.value.attributes, undefined)
  assert.deepEqual(nvidiaFact?.value.entityRefs, ['company:nvidia'])
  assert.deepEqual(amdFact?.value.entityRefs, ['company:amd'])
})

test('Example taxonomy contains the complete SW Level-1 catalog and AI Hardware link', async () => {
  const taxonomy = parseYaml(await readFile(taxonomyPath, 'utf8'), taxonomyPath) as {
    items?: Array<{ id?: string; graphRefs?: string[] }>
  }
  assert.ok(Array.isArray(taxonomy.items))
  assert.equal(taxonomy.items.length, 31)
  const ids = taxonomy.items.map((item) => item.id)
  assert.equal(new Set(ids).size, 31)
  assert.ok(ids.every((id) => typeof id === 'string' && id.startsWith('sw:')))
  const electronics = taxonomy.items.find((item) => item.id === 'sw:electronics')
  assert.deepEqual(electronics?.graphRefs, ['industry:ai-hardware'])

  const { assets } = await loadExample()
  const aiHardware = assets.entities.find((item) => item.value.id === 'industry:ai-hardware')
  assert.ok(aiHardware?.value.taxonomyRefs?.includes('sw:electronics'))
  for (const legacyDirectory of ['documents', 'graph', 'ingestion', 'ontology']) {
    assert.equal(existsSync(fileURLToPath(new URL(`../../../knowledge/${legacyDirectory}/`, import.meta.url))), false)
  }
})
