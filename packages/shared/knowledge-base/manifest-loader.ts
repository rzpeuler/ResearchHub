import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseKnowledgeBaseManifest } from '../../schemas/knowledge/index.ts'
import { KnowledgeError } from './errors.ts'
import { parseYaml } from './yaml.ts'
import type { KnowledgeBaseManifest } from '../../schemas/knowledge/index.ts'

export async function loadKnowledgeBaseManifest(rootRef: string): Promise<KnowledgeBaseManifest> {
  if (typeof rootRef !== 'string' || rootRef.trim() === '') throw new KnowledgeError('ManifestNotFound', 'Knowledge Base rootRef must be a non-empty path')
  const manifestPath = join(rootRef, 'manifest.yaml')
  let text: string
  try {
    text = await readFile(manifestPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ENOTDIR') {
      throw new KnowledgeError('ManifestNotFound', `Knowledge Base manifest not found: ${manifestPath}`, manifestPath)
    }
    throw new KnowledgeError('ManifestError', `Unable to read Knowledge Base manifest: ${manifestPath}`, manifestPath)
  }
  try {
    return parseKnowledgeBaseManifest(parseYaml(text, manifestPath))
  } catch (error) {
    if (error instanceof KnowledgeError) throw error
    throw new KnowledgeError('ManifestError', String(error), manifestPath)
  }
}
