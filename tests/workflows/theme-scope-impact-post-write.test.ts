import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { triggerThemeScopeImpactPostWrite, type ThemeScopeImpactChecker } from '../../workflows/theme-scope-impact-check/post-write.ts'
import { ApplicationServiceError } from '../../app/services/contracts.ts'
import type { ThemeScopeImpactWriteReceipt } from '../../app/services/theme-scope-impact-service.ts'

async function withLog(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'rhl-post-write-impact-'))
  try {
    await mkdir(join(root, 'logs', 'research'), { recursive: true })
    await writeFile(join(root, 'logs', 'research', 'research-run.yaml'), JSON.stringify({
      workflowRunId: 'research-run', changeSetId: 'changeset-run', knowledgeBaseId: 'kb-post-write', status: 'completed',
      writeStatus: 'committed', committedRevision: 8, changes: { createdIds: ['entity:created'], updatedIds: ['claim:updated'] },
    }), 'utf8')
    await run(root)
  } finally { await rm(root, { recursive: true, force: true }) }
}

function input(root: string, checker?: ThemeScopeImpactChecker) {
  return { mountedKnowledgeBaseRoot: root, writerRunId: 'research-run', expectedKnowledgeBaseId: 'kb-post-write', expectedCommittedRevision: 8, expectedCreatedIds: ['entity:created'], expectedUpdatedIds: ['claim:updated'], ...(checker === undefined ? {} : { checker }) }
}

test('post-write trigger maps a bounded exact Writer log into a deduplicable receipt', async () => {
  await withLog(async (root) => {
    let captured: unknown
    const checker: ThemeScopeImpactChecker = { check: async (receipt) => {
      captured = receipt
      return { receiptKey: 'a'.repeat(64), knowledgeBaseId: 'kb-post-write', baseRevision: 7, committedRevision: 8, status: 'ready', proposals: [], diagnostics: [] }
    } }
    const result = await triggerThemeScopeImpactPostWrite(input(root, checker))
    assert.equal(result.status, 'ready')
    assert.deepEqual(captured, {
      knowledgeBaseRoot: root, knowledgeBaseId: 'kb-post-write', writerRunId: 'research-run', changeSetId: 'changeset-run',
      status: 'committed', baseRevision: 7, committedRevision: 8, createdRefs: ['entity:created'], updatedRefs: ['claim:updated'],
    } satisfies ThemeScopeImpactWriteReceipt)
  })
})

test('post-write trigger fails closed on stale revision and checker failures without affecting the committed receipt', async () => {
  await withLog(async (root) => {
    const stale = await triggerThemeScopeImpactPostWrite(input(root, { check: async () => { throw new ApplicationServiceError('conflict', 'Canonical Knowledge Base revision has moved.') } }))
    assert.equal(stale.status, 'stale')
    const failed = await triggerThemeScopeImpactPostWrite(input(root, { check: async () => { throw new ApplicationServiceError('failed', 'Impact runner failed.') } }))
    assert.equal(failed.status, 'failed')
    assert.match(failed.diagnostics[0] ?? '', /Impact runner failed/)
  })
})

test('post-write trigger rejects missing, mismatched, and unchanged write inventories before calling the inbox', async () => {
  await withLog(async (root) => {
    let calls = 0
    const checker: ThemeScopeImpactChecker = { check: async () => { calls++; return { receiptKey: 'b'.repeat(64), knowledgeBaseId: 'kb-post-write', baseRevision: 7, committedRevision: 8, status: 'ready', proposals: [], diagnostics: [] } } }
    const missing = await triggerThemeScopeImpactPostWrite({ ...input(root, checker), writerRunId: 'missing-run' })
    assert.equal(missing.status, 'blocked')
    const mismatch = await triggerThemeScopeImpactPostWrite({ ...input(root, checker), expectedCreatedIds: ['entity:other'] })
    assert.equal(mismatch.status, 'blocked')
    const unchanged = await triggerThemeScopeImpactPostWrite({ ...input(root, checker), expectedCreatedIds: [], expectedUpdatedIds: [] })
    assert.equal(unchanged.status, 'blocked')
    assert.equal(calls, 0)
  })
})
