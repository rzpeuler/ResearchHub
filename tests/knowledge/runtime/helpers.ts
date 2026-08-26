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
  await writeFile(join(root, 'registry', 'index.yaml'), `assets:
  - id: segment:gpu
    type: entity
    path: entities/gpu.yaml
`)
  return root
}

export async function removeRuntimeKnowledgeBase(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true })
}
