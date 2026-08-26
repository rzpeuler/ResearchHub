import { readFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { KnowledgeError } from './errors.ts'
import type { KnowledgeBaseHandle } from './handle.ts'
import { parseYaml } from './yaml.ts'

function resolveScopedResource(handle: KnowledgeBaseHandle, storageRef: string): string {
  if (isAbsolute(storageRef)) throw new KnowledgeError('StorageError', `Absolute Knowledge resource is not allowed: ${storageRef}`, handle.rootRef)
  const root = resolve(handle.rootRef)
  const resourcePath = resolve(root, storageRef)
  const resourceRelative = relative(root, resourcePath)
  if (resourceRelative === '..' || resourceRelative.startsWith(`..${sep}`)) {
    throw new KnowledgeError('StorageError', `Knowledge resource escapes Knowledge Base root: ${storageRef}`, handle.rootRef)
  }
  return resourcePath
}

export async function readKnowledgeBaseTextResource(handle: KnowledgeBaseHandle, storageRef: string): Promise<string> {
  const resourcePath = resolveScopedResource(handle, storageRef)
  try {
    return await readFile(resourcePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new KnowledgeError('StorageError', `Knowledge resource does not exist: ${storageRef}`, resourcePath)
    }
    throw error
  }
}

export async function readKnowledgeBaseYamlResource(handle: KnowledgeBaseHandle, storageRef: string): Promise<unknown> {
  const text = await readKnowledgeBaseTextResource(handle, storageRef)
  return parseYaml(text, storageRef)
}
