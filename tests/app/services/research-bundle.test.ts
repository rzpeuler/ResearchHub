import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createResearchBundle, FileResearchBundleStore, type ResearchBundle } from '../../../app/services/research-bundle.ts'
import { defaultResearchContextPolicy, defaultResearchPersistencePolicy, validateResearchDispatchDecision } from '../../../app/services/research-dispatch-contracts.ts'

function decision() { return validateResearchDispatchDecision({ mode: 'workflow', workflow: { id: 'company_research', confidence: 1, arguments: { symbol: '600519' } }, skills: [], entities: [], missingRequiredInputs: [], contextPolicy: defaultResearchContextPolicy(), persistencePolicy: defaultResearchPersistencePolicy(), rationale: 'test' }) }

function sessionBundle(mode: 'free_research' | 'skill_plan', runId: string): ResearchBundle {
  const request = { query: `Original ${mode} request`, mode: { type: 'free_research' as const }, contextPolicy: defaultResearchContextPolicy(), persistencePolicy: defaultResearchPersistencePolicy() }
  const skills = mode === 'skill_plan' ? [{ id: 'custom-methodology', purpose: 'bounded test method' }] : []
  const researchDecision = validateResearchDispatchDecision({ mode, skills, entities: [], missingRequiredInputs: [], contextPolicy: request.contextPolicy, persistencePolicy: request.persistencePolicy, rationale: 'Original dispatch decision.' })
  const summary = { mode: 'Free Research' as const, selectedSkillIds: skills.map((skill) => skill.id), argumentsStatus: 'not_required' as const, argumentKeys: [], contextPolicy: request.contextPolicy, persistencePolicy: request.persistencePolicy }
  const pending = mode === 'free_research' ? 'free_research_pending' : 'skill_plan_pending'
  return createResearchBundle({ request, decision: researchDecision, summary, workflowRunId: runId, result: { status: pending, executionBoundary: 'session', selectedSkills: skills } })
}

function completedSession(bundle: ResearchBundle, answer: string): ResearchBundle {
  return { ...bundle, status: 'completed', structuredResult: { status: 'completed', executionBoundary: 'session', answer, selectedSkills: bundle.decision.skills, sourceLibraryHits: bundle.sourceLibraryHits, entities: bundle.decision.entities, evidenceRefs: bundle.sourceLibraryHits.map((hit) => hit.sourceLibraryRef), proposalCandidates: bundle.proposals } }
}

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

test('FileResearchBundleStore permits only a constrained atomic Session Research completion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-bundle-session-transition-'))
  try {
    const store = new FileResearchBundleStore(root)
    const pending = sessionBundle('free_research', 'free-session')
    await store.put(pending)
    const completed = completedSession(pending, 'The assistant completed this Free Research session.')
    await Promise.all([store.put(completed), new FileResearchBundleStore(root).put(completed)])
    const reopened = new FileResearchBundleStore(root)
    assert.deepEqual((await reopened.get(pending.bundleId))?.structuredResult, completed.structuredResult)
    await assert.rejects(store.put(completedSession(pending, 'A different answer must not replace the completed session.')), /identity conflict/u)
    assert.deepEqual((await reopened.get(pending.bundleId))?.structuredResult, completed.structuredResult)

    const skillPending = sessionBundle('skill_plan', 'skill-session')
    await store.put(skillPending)
    const changedPolicy = { ...completedSession(skillPending, 'Skill plan answer.'), request: { ...skillPending.request, persistencePolicy: { ...skillPending.request.persistencePolicy, writeKnowledge: true } } }
    await assert.rejects(store.put(changedPolicy), /identity conflict/u)
    assert.equal((await reopened.get(skillPending.bundleId))?.status, 'skill_plan_pending')
    assert.equal((await reopened.get(skillPending.bundleId))?.decision.persistencePolicy.writeKnowledge, false)

    const failedPending = sessionBundle('free_research', 'free-session-failed')
    await store.put(failedPending)
    const failed: ResearchBundle = { ...failedPending, status: 'failed', structuredResult: { status: 'failed', executionBoundary: 'session', error: 'No assistant output was captured for the Free Research session.', selectedSkills: failedPending.decision.skills, sourceLibraryHits: failedPending.sourceLibraryHits, entities: failedPending.decision.entities, evidenceRefs: [], proposalCandidates: failedPending.proposals } }
    await store.put(failed)
    assert.deepEqual((await reopened.get(failedPending.bundleId))?.structuredResult, failed.structuredResult)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('FileResearchBundleStore leaves the pending Session Bundle readable when an atomic completion write fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-bundle-session-write-failure-'))
  try {
    class FailingReplaceStore extends FileResearchBundleStore {
      override async writeAtomic(target: string, bundle: ResearchBundle, replace: boolean): Promise<void> {
        if (replace) throw new Error('controlled atomic replace failure')
        await super.writeAtomic(target, bundle, replace)
      }
    }
    const store = new FailingReplaceStore(root)
    const pending = sessionBundle('skill_plan', 'skill-session-write-failure')
    await store.put(pending)
    await assert.rejects(store.put(completedSession(pending, 'Answer is not committed.')), /controlled atomic replace failure/u)
    const reopened = new FileResearchBundleStore(root)
    assert.deepEqual(await reopened.get(pending.bundleId), pending)
  } finally { await rm(root, { recursive: true, force: true }) }
})
