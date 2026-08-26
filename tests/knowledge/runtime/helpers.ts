import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface RuntimeManifestOverrides {
  knowledgeBaseId?: string
  schemaVersion?: string
  storageFormatVersion?: string
  status?: string
}

export async function createRuntimeKnowledgeBase(overrides: RuntimeManifestOverrides = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-runtime-kb-'))
  await mkdir(join(root, 'entities'), { recursive: true })
  await mkdir(join(root, 'modules'), { recursive: true })
  await mkdir(join(root, 'registry'), { recursive: true })
  await writeFile(join(root, 'manifest.yaml'), `knowledgeBaseId: ${overrides.knowledgeBaseId ?? 'kb-runtime-test'}
name: Runtime Test Knowledge Base
schemaVersion: "${overrides.schemaVersion ?? '0.2'}"
storageFormatVersion: "${overrides.storageFormatVersion ?? '1'}"
revision: 0
status: ${overrides.status ?? 'active'}
createdAt: 2026-08-26T00:00:00.000Z
updatedAt: 2026-08-26T00:00:00.000Z
`)
  await writeFile(join(root, 'entities', 'gpu.yaml'), `id: segment:gpu
type: segment
name: GPU
`)
  await writeFile(join(root, 'modules', 'gpu-products.yaml'), `id: module:gpu-products
type: comparison
targetEntity: segment:gpu
schemaId: product-comparison
columns:
  - product
rows: []
`)
  await writeFile(join(root, 'registry', 'assets.yaml'), `segment:gpu:
  type: entity
  storageRef: entities/gpu.yaml
module:gpu-products:
  type: module
  storageRef: modules/gpu-products.yaml
`)
  await writeFile(join(root, 'registry', 'raw.yaml'), '{}\n')
  return root
}

export async function createLegacyV01KnowledgeBase(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-legacy-kb-'))
  await mkdir(join(root, 'entities'), { recursive: true })
  await mkdir(join(root, 'modules'), { recursive: true })
  await mkdir(join(root, 'registry'), { recursive: true })
  await writeFile(join(root, 'manifest.yaml'), `knowledgeBaseId: kb-legacy-test
name: Legacy Test Knowledge Base
schemaVersion: "0.1"
storageFormatVersion: "1"
revision: 0
status: active
createdAt: 2026-08-26T00:00:00.000Z
updatedAt: 2026-08-26T00:00:00.000Z
`)
  await writeFile(join(root, 'entities', 'gpu.yaml'), `id: segment:gpu
type: segment
name: GPU
`)
  await writeFile(join(root, 'modules', 'gpu-products.yaml'), `id: module:gpu-products
type: comparison
schemaId: product-comparison
columns:
  - product
rows: []
`)
  await writeFile(join(root, 'registry', 'index.yaml'), `assets:
  - id: segment:gpu
    type: entity
    path: entities/gpu.yaml
  - id: module:gpu-products
    type: module
    path: modules/gpu-products.yaml
`)
  await writeFile(join(root, 'registry', 'modules.yaml'), `bindings:
  - entityId: segment:gpu
    moduleIds: ["module:gpu-products", "module:gpu-products"]
`)
  return root
}

export async function removeRuntimeKnowledgeBase(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true })
}
