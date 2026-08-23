import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { resolve } from 'node:path'

const packageRoot = resolve(process.cwd(), 'packages/skills/company-research')
const requiredFiles = [
  'skill.yaml',
  'SKILL.md',
  'research-framework.md',
  'evidence-schema.yaml',
  'output-schema.yaml',
  'evaluation-rules.md',
]

async function readSkillFile(name: string): Promise<string> {
  return readFile(resolve(packageRoot, name), 'utf8')
}

test('Company Research Skill Package contains the standard contract files', async () => {
  await Promise.all(requiredFiles.map(async (name) => {
    const content = await readSkillFile(name)
    assert.ok(content.trim().length > 0, `${name} must not be empty`)
  }))
})

test('company-research skill.yaml declares required plugins, workflow, and outputs', async () => {
  const metadata = await readSkillFile('skill.yaml')

  for (const field of ['name:', 'version:', 'type:', 'description:', 'required_plugins:', 'compatible_workflows:', 'output_types:']) {
    assert.match(metadata, new RegExp(`^${field}`, 'm'))
  }
  for (const plugin of ['market', 'financial', 'information']) assert.match(metadata, new RegExp(`^  - ${plugin}$`, 'm'))
  assert.match(metadata, /^  - company-research$/m)
  assert.match(metadata, /^  - thesis$/m)
  assert.match(metadata, /^  - prediction$/m)
})

test('Company Research SKILL.md declares all seven research modules and output rules', async () => {
  const skill = await readSkillFile('SKILL.md')

  assert.match(skill, /^---\nname: company-research\ndescription:/)
  for (const section of [
    '## Purpose',
    '## Research Objective',
    '## Research Process',
    '## Business Understanding',
    '## Industry Position',
    '## Competitive Advantage',
    '## Growth Drivers',
    '## Financial Quality',
    '## Capital Allocation',
    '## Risk Analysis',
    '## Evidence Requirements',
    '## Output Contract',
  ]) assert.match(skill, new RegExp(`^${section}$`, 'm'))
  assert.match(skill, /Every Thesis must contain `statement`, `evidenceIds`, `confidence`, and\n`risks`/)
  assert.match(skill, /No Prediction may be emitted without a measurable metric and time period/)
})
