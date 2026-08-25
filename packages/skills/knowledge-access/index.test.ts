import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { KnowledgeAccessSkill } from './index.ts'
import { KnowledgeLoader } from './loader.ts'

async function createFixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-knowledge-'))
  await writeFile(join(root, 'entity.yaml'), 'id: segment:gpu\ntype: segment\nname: GPU\ntags:\n  - accelerator\n')
  await writeFile(join(root, 'company.yaml'), 'id: company:nvidia\ntype: company\nname: NVIDIA\n')
  await writeFile(join(root, 'relation.yaml'), 'id: relation:nvidia-operates-in-gpu\ntype: operates_in\nsource: company:nvidia\ntarget: segment:gpu\n')
  await writeFile(join(root, 'module.yaml'), 'id: module:gpu-products\ntype: comparison\nschemaId: product-comparison\ntargetEntity: segment:gpu\ncolumns:\n  - product\nrows: []\n')
  await writeFile(join(root, 'source.yaml'), 'id: source:fixture\ntype: research_report\ntitle: Fixture\npublisher: ResearchHub\npublishedAt: 2026-08-25\n')
  await mkdir(join(root, 'registry'))
  await writeFile(join(root, 'registry', 'index.yaml'), `assets:
  - id: segment:gpu
    type: entity
    path: entity.yaml
  - id: company:nvidia
    type: entity
    path: company.yaml
  - id: relation:nvidia-operates-in-gpu
    type: relation
    path: relation.yaml
  - id: module:gpu-products
    type: module
    path: module.yaml
  - id: source:fixture
    type: source
    path: source.yaml
`)
  await writeFile(join(root, 'registry', 'modules.yaml'), `bindings:
  - entityId: segment:gpu
    moduleIds: ["module:gpu-products"]
`)
  return root
}

test('loader parses YAML assets and builds a cached runtime index', async () => {
  const root = await createFixtureRoot()
  try {
    const loader = new KnowledgeLoader({ rootDir: root })
    const first = await loader.load()
    const second = await loader.load()
    assert.strictEqual(first, second)
    assert.equal(first.entities.get('segment:gpu')?.name, 'GPU')
    assert.equal(first.relations.size, 1)
    assert.equal(first.modules.size, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
test('access skill exposes deterministic entity, relation, comparison, and source queries', async () => {
  const root = await createFixtureRoot()
  try {
    const index = await new KnowledgeLoader({ rootDir: root }).load()
    const skill = new KnowledgeAccessSkill({ index })
    assert.equal(skill.getEntity('segment:gpu').name, 'GPU')
    assert.equal(skill.searchEntities('gpu')[0]?.id, 'segment:gpu')
    assert.equal(skill.getRelations('segment:gpu')[0]?.id, 'relation:nvidia-operates-in-gpu')
    assert.equal(skill.getRelatedCompanies('segment:gpu')[0]?.company.id, 'company:nvidia')
    assert.equal(skill.getComparison('segment:gpu', 'product-comparison')[0]?.id, 'module:gpu-products')
    assert.throws(() => skill.getEntity('segment:missing'), /Entity not found/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
