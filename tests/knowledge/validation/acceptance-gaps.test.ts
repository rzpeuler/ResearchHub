import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { KnowledgeLoader } from '../../../packages/skills/knowledge-access/loader.ts'
import { KnowledgeBaseLoader } from '../../../packages/shared/knowledge-base/knowledge-base-loader.ts'
import { RELATION_TYPES } from '../../../packages/skills/knowledge-access/types.ts'
import { KnowledgeValidationSkill } from '../../../packages/skills/knowledge-validation/index.ts'
import { createTestHandle } from '../test-handle.ts'

async function makeRegistryRoot(registry: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-knowledge-registry-'))
  await mkdir(join(root, 'entities'), { recursive: true })
  await writeFile(join(root, 'entities', 'gpu.yaml'), 'id: segment:gpu\ntype: segment\nname: GPU\n')
  await writeFile(join(root, 'entities', 'extra.yaml'), 'id: segment:extra\ntype: segment\nname: Extra\n')
  await mkdir(join(root, 'registry'))
  await writeFile(join(root, 'registry', 'index.yaml'), registry)
  return root
}

test('registry is authoritative and does not load unregistered assets', async () => {
  const root = await makeRegistryRoot(`assets:
  - id: segment:gpu
    type: entity
    path: entities/gpu.yaml
`)
  try {
    const assets = await new KnowledgeLoader({ rootDir: root }).readAssets()
    assert.deepEqual(assets.entities.map((item) => item.value.id), ['segment:gpu'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('registry validation reports missing, mismatch, duplicate, and unsafe entries', async () => {
  const root = await makeRegistryRoot(`assets:
  - id: segment:gpu
    type: entity
    path: entities/gpu.yaml
  - id: segment:gpu
    type: entity
    path: entities/extra.yaml
  - id: segment:wrong
    type: entity
    path: entities/gpu.yaml
  - id: segment:gpu
    type: relation
    path: entities/gpu.yaml
  - id: segment:missing
    type: entity
    path: entities/missing.yaml
  - id: segment:escape
    type: entity
    path: ../outside.yaml
`)
  try {
    const loader = new KnowledgeBaseLoader()
    const report = await new KnowledgeValidationSkill({ loader }).validateKnowledgeBase(createTestHandle(root))
    assert.equal(report.status, 'failed')
    assert.ok(report.errors.some((error) => error.code === 'REGISTRY_DUPLICATE_ID'))
    assert.ok(report.errors.some((error) => error.code === 'REGISTRY_ID_MISMATCH'))
    assert.ok(report.errors.some((error) => error.code === 'REGISTRY_TYPE_MISMATCH'))
    assert.ok(report.errors.some((error) => error.code === 'REGISTRY_MISSING_ASSET'))
    assert.ok(report.errors.some((error) => error.code === 'REGISTRY_UNSAFE_PATH'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('canonical relation vocabulary and intelligence field rules are enforced', async () => {
  assert.ok(RELATION_TYPES.includes('supplier_of'))
  assert.ok(RELATION_TYPES.includes('invested_in'))
  assert.ok(!RELATION_TYPES.includes('supplies' as never))
  assert.ok(!RELATION_TYPES.includes('investor_of' as never))
  const root = await mkdtemp(join(tmpdir(), 'researchhub-knowledge-rules-'))
  try {
    await writeFile(join(root, 'legacy-relation.yaml'), 'id: relation:legacy\ntype: supplies\nsource: company:a\ntarget: segment:gpu\n')
    await writeFile(join(root, 'incomplete-forecast.yaml'), 'id: forecast:incomplete\ntype: forecast\nentityRefs:\n  - segment:gpu\n')
    const loader = new KnowledgeBaseLoader()
    const report = await new KnowledgeValidationSkill({ loader }).validateKnowledgeBase(createTestHandle(root))
    assert.ok(report.errors.some((error) => error.code === 'SCHEMA_RELATION_TYPE'))
    assert.ok(report.errors.some((error) => error.code === 'INTELLIGENCE_REQUIRED_FIELD'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Module Registry validates entity/module references, duplicate bindings, and target conflicts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-knowledge-modules-'))
  try {
    await mkdir(join(root, 'entities'), { recursive: true })
    await mkdir(join(root, 'modules'), { recursive: true })
    await mkdir(join(root, 'registry'))
    await writeFile(join(root, 'entities', 'gpu.yaml'), 'id: segment:gpu\ntype: segment\nname: GPU\n')
    await writeFile(join(root, 'modules', 'gpu.yaml'), 'id: module:gpu-products\ntype: comparison\ntargetEntity: segment:gpu\ncolumns: []\nrows: []\n')
    await writeFile(join(root, 'registry', 'index.yaml'), `assets:
  - id: segment:gpu
    type: entity
    path: entities/gpu.yaml
  - id: module:gpu-products
    type: module
    path: modules/gpu.yaml
`)
    await writeFile(join(root, 'registry', 'modules.yaml'), `bindings:
  - entityId: segment:gpu
    moduleIds: ["module:gpu-products"]
  - entityId: segment:gpu
    moduleIds: ["module:gpu-products"]
  - entityId: segment:missing
    moduleIds: ["module:unknown"]
  - entityId: segment:other
    moduleIds: ["module:gpu-products"]
`)
    const loader = new KnowledgeBaseLoader()
    const report = await new KnowledgeValidationSkill({ loader }).validateKnowledgeBase(createTestHandle(root), 'module')
    assert.equal(report.status, 'failed')
    assert.ok(report.errors.some((error) => error.code === 'MODULE_REGISTRY_DUPLICATE_BINDING'))
    assert.ok(report.errors.some((error) => error.code === 'MODULE_REGISTRY_UNKNOWN_ENTITY'))
    assert.ok(report.errors.some((error) => error.code === 'MODULE_REGISTRY_UNKNOWN_MODULE'))
    assert.ok(report.errors.some((error) => error.code === 'MODULE_REGISTRY_TARGET_CONFLICT'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
