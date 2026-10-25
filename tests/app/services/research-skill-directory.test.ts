import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ResearchSkillDirectoryService } from '../../../app/services/research-skill-directory.ts'
import { ResearchSkillRegistry } from '../../../app/services/skill-registry.ts'

test('directory projects only enabled research skills and keeps runtime details private', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-skill-directory-'))
  const methodologyPath = join(root, 'SKILL.md')
  try {
    await writeFile(methodologyPath, '# Approved method\nSelected detail only.\n')
    const registry = new ResearchSkillRegistry([
      { id: 'external-z', kind: 'research', intentDescription: 'Z purpose', whenToUse: 'Z when', enabled: true, scope: 'researchhub', methodologySource: { type: 'researchhub_skill', path: methodologyPath }, runtimeExecutor: () => 'private' },
      { id: 'external-a', kind: 'research', intentDescription: 'A purpose', whenToUse: 'A when', enabled: true, scope: 'researchhub', methodologySource: { type: 'researchhub_skill', path: methodologyPath } },
      { id: 'disabled-research', kind: 'research', intentDescription: 'Disabled', whenToUse: 'Never', enabled: false, scope: 'researchhub' },
      { id: 'knowledge-internal', kind: 'knowledge', intentDescription: 'Knowledge', whenToUse: 'Internal', enabled: true, scope: 'researchhub' },
      { id: 'utility-internal', kind: 'utility', intentDescription: 'Utility', whenToUse: 'Internal', enabled: true, scope: 'researchhub' },
    ])
    const service = new ResearchSkillDirectoryService(registry)
    const skills = service.list()
    assert.deepEqual(skills.map((skill) => skill.id), ['external-a', 'external-z'])
    assert.equal('domain' in skills[0]!, false)
    assert.equal(JSON.stringify(skills).includes(methodologyPath), false)
    assert.equal(JSON.stringify(skills).includes('runtimeExecutor'), false)

    const detail = await service.get('external-z')
    assert.equal(detail?.methodology.includes('Selected detail only.'), true)
    assert.equal(detail?.origin, 'external')
    assert.equal('methodologySource' in (detail ?? {}), false)
    assert.equal('runtimeExecutor' in (detail ?? {}), false)
    assert.equal(await service.get('knowledge-internal'), undefined)
    assert.equal(await service.get('missing-skill'), undefined)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('directory canonical entries carry catalog domain and detail data requirements', async () => {
  const registry = new ResearchSkillRegistry()
  const service = new ResearchSkillDirectoryService(registry)
  const summary = service.list().find((skill) => skill.id === 'industry_supply_demand_cycle')
  assert.equal(summary?.domain, 'Industry')
  const detail = await service.get('industry_supply_demand_cycle')
  assert.equal(typeof detail?.methodology, 'string')
  assert.equal(Array.isArray(detail?.dataRequirements), true)
})
