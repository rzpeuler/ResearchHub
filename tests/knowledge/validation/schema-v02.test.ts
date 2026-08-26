import assert from 'node:assert/strict'
import { appendFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { KnowledgeBaseLoader } from '../../../packages/shared/knowledge-base/knowledge-base-loader.ts'
import { KnowledgeValidationSkill } from '../../../packages/skills/knowledge-validation/index.ts'
import { createRuntimeKnowledgeBase, removeRuntimeKnowledgeBase } from '../runtime/helpers.ts'

test('v0.2 validation exposes manifest/raw scopes and allows nullable source metadata', async () => {
  const root = await createRuntimeKnowledgeBase({ knowledgeBaseId: 'kb-v02-validation' })
  try {
    await writeFile(join(root, 'sources.yaml'), `id: source:nullable
type: research_report
title: Nullable Source
publisher: null
institution: null
author: null
publishedAt: null
url: null
sourceType: official_disclosure
sourceReliability: high
`)
    await appendFile(join(root, 'registry', 'assets.yaml'), `source:nullable:
  type: source
  storageRef: sources.yaml
`)
    const loader = new KnowledgeBaseLoader()
    const { handle } = await loader.mountAndLoad(root)
    const skill = new KnowledgeValidationSkill({ loader })
    assert.equal((await skill.validateKnowledgeBase(handle, 'manifest')).status, 'passed')
    assert.equal((await skill.validateKnowledgeBase(handle, 'raw')).status, 'passed')
    assert.equal((await skill.validateKnowledgeBase(handle, 'source')).status, 'passed')

    await writeFile(join(root, 'sources.yaml'), `id: source:nullable
type: research_report
title: Nullable Source
publisher: null
publishedAt: null
rawRefs:
  - raw:missing
`)
    assert.equal((await skill.validateKnowledgeBase(handle, 'raw')).status, 'failed')
    assert.ok((await skill.validateKnowledgeBase(handle, 'raw')).errors.some((error) => error.code === 'RAW_REF_MISSING'))
  } finally {
    await removeRuntimeKnowledgeBase(root)
  }
})
