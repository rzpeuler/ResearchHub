import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { resolve } from 'node:path'
import { eventAnalysisWorkflowDefinition } from '../../workflows/definitions.ts'

const packageRoot = resolve(process.cwd(), 'packages/skills/event-analysis')
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

test('Event Analysis Skill Package contains the standard contract files', async () => {
  await Promise.all(requiredFiles.map(async (name) => {
    const content = await readSkillFile(name)
    assert.ok(content.trim().length > 0, `${name} must not be empty`)
  }))
})

test('skill.yaml declares metadata, plugins, workflow and outputs', async () => {
  const metadata = await readSkillFile('skill.yaml')

  for (const field of ['name:', 'version:', 'description:', 'required_plugins:', 'compatible_workflows:', 'output_types:']) {
    assert.match(metadata, new RegExp(`^${field}`, 'm'))
  }
  assert.match(metadata, /- event-analysis@1\.x/)
  assert.match(metadata, /- Evidence/)
  assert.match(metadata, /- Thesis/)
  assert.match(metadata, /- Prediction/)
})

test('SKILL.md preserves Harness loading and declares the v2 research method', async () => {
  const skill = await readSkillFile('SKILL.md')

  assert.match(skill, /^---\nname: event-analysis\ndescription:/)
  for (const heading of [
    '## Purpose',
    '## Research Objective',
    '## Research Process',
    '## Research Framework',
    '## Evidence Requirements',
    '## Output Contract',
    '## Research Rules',
    '## Quality and Evaluation',
  ]) {
    assert.match(skill, new RegExp(`^${heading}$`, 'm'))
  }
  assert.match(skill, /Every Thesis must reference supporting Evidence IDs/)
  assert.match(skill, /No Prediction may be emitted without a validation metric/)
})

test('Event Analysis Skill Package is compatible with the approved Workflow definition', async () => {
  assert.equal(eventAnalysisWorkflowDefinition.id, 'event-analysis')
  assert.ok(eventAnalysisWorkflowDefinition.steps.length >= 5)
  assert.ok(eventAnalysisWorkflowDefinition.steps.every((step) => step.skill === 'event-analysis'))
  assert.deepEqual(eventAnalysisWorkflowDefinition.outputSchema, {
    evidenceIds: { type: 'array', required: true, description: 'Evidence Artifact identifiers.' },
    thesisIds: { type: 'array', required: true, description: 'Thesis Artifact identifiers.' },
    predictionIds: { type: 'array', required: true, description: 'Prediction Artifact identifiers.' },
  })
})
