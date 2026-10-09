import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createResearchBundle, FileResearchBundleStore } from '../../../app/services/research-bundle.ts'
import { defaultResearchContextPolicy, defaultResearchPersistencePolicy, validateResearchDispatchDecision } from '../../../app/services/research-dispatch-contracts.ts'

function decision() { return validateResearchDispatchDecision({ mode: 'workflow', workflow: { id: 'company_research', confidence: 1, arguments: { symbol: '600519' } }, skills: [], entities: [], missingRequiredInputs: [], contextPolicy: defaultResearchContextPolicy(), persistencePolicy: defaultResearchPersistencePolicy(), rationale: 'test' }) }

test('ResearchBundle requires a verified report reference and derives proposals from the structured result', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-bundle-'))
  try {
    const request = { query: '研究贵州茅台', mode: { type: 'workflow' as const, workflowId: 'company_research' }, contextPolicy: defaultResearchContextPolicy(), persistencePolicy: defaultResearchPersistencePolicy() }
    const d = decision()
    const result = { status: 'completed', report: { reportId: 'report-1', outputPath: 'report-1.md' }, research: { proposals: [{ proposalId: 'proposal-1', kind: 'claim', statement: 'Fact' }] } }
    const unverified = createResearchBundle({ request, decision: d, summary: { mode: 'Explicit Workflow', workflowId: 'company_research', workflowLabel: 'Company Research', selectedSkillIds: [], argumentsStatus: 'extracted', argumentKeys: ['symbol'], contextPolicy: request.contextPolicy, persistencePolicy: request.persistencePolicy }, workflowRunId: 'unverified-run', result })
    assert.equal(unverified.report, undefined)
    const bundle = createResearchBundle({ request, decision: d, summary: { mode: 'Explicit Workflow', workflowId: 'company_research', workflowLabel: 'Company Research', selectedSkillIds: [], argumentsStatus: 'extracted', argumentKeys: ['symbol'], contextPolicy: request.contextPolicy, persistencePolicy: request.persistencePolicy }, workflowRunId: 'run-1', verifiedReportId: 'report-1', result })
    assert.equal(bundle.bundleId, 'research-bundle-run-1')
    assert.deepEqual(bundle.report, { reportId: 'report-1' })
    assert.deepEqual(bundle.proposals.map((item) => item.proposalId), ['proposal-1'])
    const store = new FileResearchBundleStore(root); await store.put(bundle)
    assert.match(await readFile(join(root, 'research-bundle-run-1.json'), 'utf8'), /proposal-1/)
    assert.equal((await store.get(bundle.bundleId))?.workflowRunId, 'run-1')
    assert.equal((await store.list()).length, 1)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('ResearchBundle writes are idempotent for equivalent runs and reject non-equivalent reuse', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-bundle-idempotency-'))
  try {
    const request = { query: '研究贵州茅台', mode: { type: 'workflow' as const, workflowId: 'company_research' }, contextPolicy: defaultResearchContextPolicy(), persistencePolicy: defaultResearchPersistencePolicy() }
    const base = createResearchBundle({ request, decision: decision(), summary: { mode: 'Explicit Workflow', workflowId: 'company_research', workflowLabel: 'Company Research', selectedSkillIds: [], argumentsStatus: 'extracted', argumentKeys: ['symbol'], contextPolicy: request.contextPolicy, persistencePolicy: request.persistencePolicy }, workflowRunId: 'same-run', result: { status: 'completed', summary: 'same' }, executionResult: { runId: 'same-run', workflowId: 'company_research', executionStatus: 'completed', terminalStatus: 'completed', diagnostics: [], bundleStatus: 'available' } })
    const store = new FileResearchBundleStore(root)
    await store.put(base)
    await store.put({ ...base, createdAt: '2026-10-09T08:00:00.000Z' })
    assert.equal((await store.get(base.bundleId))?.createdAt, base.createdAt)
    await assert.rejects(store.put({ ...base, structuredResult: { status: 'blocked', summary: 'different' } }), /identity conflict/u)
    await assert.rejects(store.put({ ...base, executionResult: { ...base.executionResult!, runId: 'another-run' } }), /execution result identity/u)
  } finally { await rm(root, { recursive: true, force: true }) }
})
