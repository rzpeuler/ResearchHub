import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ResearchDispatchService, type WorkflowExecutionBindingContext } from '../../../app/services/research-dispatch-service.ts'
import { SecurityIdentityResolver } from '../../../app/services/security-identity-resolver.ts'
import { createSecurityIdentityDataResolver, type AkshareSecurityDirectoryClient } from '../../../plugins/research-acquisition/security-identity-data.ts'
import { createFreshKnowledgeBaseV04 } from '../../../knowledge/storage/create-v04.ts'
import { WorkflowService } from '../../../app/services/workflow-service.ts'

const NOW = '2026-10-08T12:00:00.000Z'
const ROW = { symbol: '002487', name: '大金重工', exchange: 'SZ' as const }

async function emptyKnowledgeBase() {
  const root = await mkdtemp(join(tmpdir(), 'rhl-dispatch-security-identity-'))
  const kb = join(root, 'kb')
  await createFreshKnowledgeBaseV04(kb, { knowledgeBaseId: `kb-dispatch-security-${Math.random().toString(36).slice(2)}`, now: NOW })
  return { kb, close: () => rm(root, { recursive: true, force: true }) }
}

function createHarness(options: { rows?: readonly typeof ROW[]; unavailable?: boolean } = {}) {
  const directoryCalls: unknown[] = []
  const akshare = (options.unavailable ? {} : {
    async securityDirectory(request: unknown) { directoryCalls.push(request); return options.rows ?? [ROW] },
  }) as unknown as AkshareSecurityDirectoryClient
  const identity = new SecurityIdentityResolver({
    now: () => new Date(NOW),
    dataResolverFactory: ({ now, signal }) => createSecurityIdentityDataResolver({ akshare, now, ...(signal ? { signal } : {}) }),
  })
  const workflowService = new WorkflowService()
  const started: Array<{ workflowId: string; args: Readonly<Record<string, unknown>>; writeKnowledge: boolean; useStructuredKnowledge: boolean }> = []
  const executionBindings = new Map<string, (context: WorkflowExecutionBindingContext) => Promise<unknown>>(['company_research', 'valuation', 'earnings_review'].map((workflowId) => [workflowId, async (context: WorkflowExecutionBindingContext) => {
    started.push({ workflowId, args: context.args, writeKnowledge: context.writeKnowledge, useStructuredKnowledge: context.useStructuredKnowledge })
    workflowService.register({ runId: context.runId, workflowType: workflowId, objective: 'Identity dispatch test' })
    return workflowService.start(context.runId, async () => ({ status: 'completed' }))
  }]))
  const service = (kb?: string) => new ResearchDispatchService({
    securityIdentityResolver: identity,
    ...(kb ? { mountedKnowledgeBaseRoot: kb } : {}),
    workflowService,
    executionBindings,
    clock: () => new Date(NOW),
  })
  return { service, workflowService, started, directoryCalls }
}

async function completed(service: ResearchDispatchService, input: unknown) {
  const result = await service.startAsync(input)
  assert.equal(result.status, 'started', JSON.stringify(result.feedback))
  if (result.status !== 'started') throw new Error(`Expected started, received ${result.status}`)
  await result.completion
  return result
}

test('manual company name-only dispatch resolves a trusted symbol before required-field validation', async () => {
  const kb = await emptyKnowledgeBase()
  const harness = createHarness()
  try {
    const result = await completed(harness.service(kb.kb), {
      query: '大金重工', mode: { type: 'workflow', workflowId: 'company_research' },
      contextPolicy: { structuredKnowledge: true, sourceLibrary: false },
      persistencePolicy: { writeKnowledge: false },
    })
    assert.equal(result.decision.workflow?.arguments.symbol, '002487')
    assert.equal(result.decision.workflow?.arguments.exchange, 'SZ')
    assert.equal(result.decision.workflow?.arguments.name, '大金重工')
    assert.equal(harness.started[0]?.writeKnowledge, false)
  } finally { await kb.close() }
})

test('automatic routing starts each identity workflow with exact directory-backed code and exchange', async () => {
  const kb = await emptyKnowledgeBase()
  const harness = createHarness()
  const cases = [
    ['company_research', '请研究 002487.SZ'] as const,
    ['valuation', '002487.SZ 估值'] as const,
    ['earnings_review', '002487.SZ 2026 年半年报'] as const,
  ]
  try {
    for (const [workflowId, query] of cases) {
      const result = await completed(harness.service(kb.kb), {
        query, mode: { type: 'free_research' },
        contextPolicy: { structuredKnowledge: true, sourceLibrary: false },
        persistencePolicy: { writeKnowledge: false },
      })
      assert.equal(result.decision.workflow?.id, workflowId)
      assert.equal(result.decision.workflow?.arguments.symbol, '002487')
      assert.equal(result.decision.workflow?.arguments.exchange, 'SZ')
      assert.equal(result.decision.workflow?.arguments.name, '大金重工')
    }
    assert.equal(harness.started.length, 3)
    assert.equal(harness.started.every((item) => item.writeKnowledge === false), true)
  } finally { await kb.close() }
})

test('identity failures stay unresolved before execution for mismatch, unavailable provider, historical cutoff, and exchange conflict', async () => {
  const kb = await emptyKnowledgeBase()
  const cases: Array<{ readonly title: string; readonly harness: ReturnType<typeof createHarness>; readonly input: Record<string, unknown> }> = [
    { title: 'name/code mismatch', harness: createHarness(), input: { query: '大金重工 002488.SZ 估值', mode: { type: 'workflow', workflowId: 'valuation' } } },
    { title: 'provider unavailable', harness: createHarness({ unavailable: true }), input: { query: '002487.SZ 估值', mode: { type: 'workflow', workflowId: 'valuation' } } },
    { title: 'historical identity', harness: createHarness(), input: { query: '请按截至2025-06-30时点估值 002487.SZ', mode: { type: 'workflow', workflowId: 'valuation' } } },
    { title: 'explicit exchange conflict', harness: createHarness(), input: { query: '002487.SH 估值', mode: { type: 'workflow', workflowId: 'valuation' } } },
  ]
  try {
    for (const item of cases) {
      const result = await item.harness.service(kb.kb).startAsync({
        ...item.input,
        contextPolicy: { structuredKnowledge: true, sourceLibrary: false },
        persistencePolicy: { writeKnowledge: false },
      })
      assert.equal(result.status, 'unresolved_reference', item.title)
      assert.equal(result.feedback?.status, 'UNRESOLVED_REFERENCE', item.title)
      assert.equal(item.harness.started.length, 0, item.title)
      if (item.title === 'historical identity') assert.equal(item.harness.directoryCalls.length, 0)
      if (item.title === 'explicit exchange conflict') assert.equal(item.harness.directoryCalls.length, 1)
    }
  } finally { await kb.close() }
})

test('verified identity permits read-only dispatch when structured Knowledge is disabled', async () => {
  const kb = await emptyKnowledgeBase()
  const harness = createHarness()
  try {
    await completed(harness.service(kb.kb), {
      query: '002487.SZ 估值', mode: { type: 'workflow', workflowId: 'valuation' },
      contextPolicy: { structuredKnowledge: false, sourceLibrary: false },
      persistencePolicy: { writeKnowledge: false },
    })
    assert.equal(harness.started[0]?.useStructuredKnowledge, false)
    assert.equal(harness.started[0]?.writeKnowledge, false)
    assert.equal(harness.directoryCalls.length, 1)
  } finally { await kb.close() }
})

test('unrelated canonical-reference workflow remains blocked by empty Knowledge', async () => {
  const kb = await emptyKnowledgeBase()
  const harness = createHarness()
  try {
    const result = await harness.service(kb.kb).startAsync({
      query: 'Red team 002487.SZ claim:missing', mode: { type: 'workflow', workflowId: 'thesis_red_team' },
      contextPolicy: { structuredKnowledge: true, sourceLibrary: false },
      persistencePolicy: { writeKnowledge: false },
    })
    assert.equal(result.status, 'unresolved_reference')
    assert.equal(result.feedback?.status, 'UNRESOLVED_REFERENCE')
    assert.equal(harness.started.length, 0)
  } finally { await kb.close() }
})
