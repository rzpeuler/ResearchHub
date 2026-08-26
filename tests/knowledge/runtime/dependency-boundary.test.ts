import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

async function sourceFiles(root: string): Promise<string[]> {
  const result: string[] = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) result.push(...await sourceFiles(path))
    else if (entry.name.endsWith('.ts')) result.push(path)
  }
  return result
}

test('shared Knowledge runtime remains independent from Skills, Workflow, DSH, and Curation', async () => {
  const roots = [join(process.cwd(), 'packages', 'shared', 'knowledge-base'), join(process.cwd(), 'packages', 'schemas', 'knowledge')]
  const forbidden = /(?:packages\/skills|packages\\skills|packages\/workflows|packages\\workflows|\bdsh\b|knowledge-curation)/i
  for (const root of roots) {
    for (const file of await sourceFiles(root)) {
      const text = await readFile(file, 'utf8')
      assert.equal(forbidden.test(text), false, `${file} imports or names a forbidden dependency`)
    }
  }
})

test('Knowledge Writer does not import Validation Skill implementation', async () => {
  const root = join(process.cwd(), 'packages', 'shared', 'knowledge-base', 'write')
  for (const file of await sourceFiles(root)) {
    const text = await readFile(file, 'utf8')
    assert.equal(/knowledge-validation|KnowledgeValidationSkill/.test(text), false, `${file} imports Validation Skill implementation`)
  }
})
