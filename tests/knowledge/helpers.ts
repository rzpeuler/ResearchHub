import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { KnowledgeBaseStatus } from '../../knowledge/schema/manifest.ts'

export async function createKnowledgeBase(overrides: { schemaVersion?: string; storageFormatVersion?: string; status?: KnowledgeBaseStatus; knowledgeBaseId?: string } = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-kb-'))
  for (const directory of ['raw', 'registry', 'theme-groups', 'entities', 'relations', 'claims', 'sources', 'modules', 'logs/ingestion']) await mkdir(join(root, directory), { recursive: true })
  await writeFile(join(root, 'manifest.yaml'), JSON.stringify({ knowledgeBaseId: overrides.knowledgeBaseId ?? 'kb-test', name: 'Synthetic KB', schemaVersion: overrides.schemaVersion ?? '0.3', storageFormatVersion: overrides.storageFormatVersion ?? '1', revision: 0, status: overrides.status ?? 'active', createdAt: '2026-09-03T00:00:00.000Z', updatedAt: '2026-09-03T00:00:00.000Z' }) + '\n')
  await writeFile(join(root, 'registry', 'assets.yaml'), '{}\n')
  await writeFile(join(root, 'registry', 'raw.yaml'), '{}\n')
  return root
}

export async function readManifest(root: string): Promise<Record<string, unknown>> { return JSON.parse(await readFile(join(root, 'manifest.yaml'), 'utf8')) as Record<string, unknown> }
export async function removeKnowledgeBase(root: string): Promise<void> { await rm(root, { recursive: true, force: true }) }
