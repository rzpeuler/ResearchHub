import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ResearchDispatchService, type WorkflowExecutionBindingContext } from '../../../app/services/research-dispatch-service.ts'
import { SecurityIdentityResolver } from '../../../app/services/security-identity-resolver.ts'
import { ResearchService } from '../../../app/services/research-service.ts'
import { createSecurityIdentityDataResolver, type AkshareSecurityDirectoryClient } from '../../../plugins/research-acquisition/security-identity-data.ts'
import { createValuationDataResolver } from '../../../plugins/research-acquisition/valuation-data.ts'
import type { AkshareDataClient } from '../../../plugins/research-acquisition/akshare.ts'
import { createFreshKnowledgeBaseV04 } from '../../../knowledge/storage/create-v04.ts'
import { readCanonicalV04Assets } from '../../../knowledge/storage/canonical-v04-loader.ts'
import { WorkflowService } from '../../../app/services/workflow-service.ts'
import type { ReasoningRequest } from '../../../plugins/reasoning/contracts.ts'

const NOW = '2026-10-08T12:00:00.000Z'
const ROW = { symbol: '002487', name: '大金重工', exchange: 'SZ' as const }

async function emptyKnowledgeBase() {
  const root = await mkdtemp(join(tmpdir(), 'rhl-dispatch-security-identity-'))
  const kb = join(root, 'kb')
  await createFreshKnowledgeBaseV04(kb, { knowledgeBaseId: `kb-dispatch-security-${Math.random().toString(36).slice(2)}`, now: NOW })
  return { kb, close: () => rm(root, { recursive: true, force: true }) }
}

function createHarness(options: { rows?: readonly typeof ROW[]; unavailable?: boolean; reasoningWorkflowArgs?: Readonly<Record<string, unknown>> } = {}) {
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
    ...(options.reasoningWorkflowArgs === undefined ? {} : {
      reasoningExecutor: {
        capabilities: () => ({ maxContextTokens: 10_000, maxOutputTokens: 2_000, structuredOutputSupport: true, maxConcurrency: 1 }),
        async execute(request: ReasoningRequest) {
          const explicitWorkflow = request.input && typeof request.input === 'object' ? (request.input as { explicitWorkflow?: { id?: string } }).explicitWorkflow : undefined
          const workflowId = explicitWorkflow?.id
          if (workflowId === undefined) throw new Error('Test requires an explicitly selected Workflow')
          return { operation: request.operation, output: {
            mode: 'workflow',
            workflow: { id: workflowId, confidence: 1, arguments: options.reasoningWorkflowArgs },
            skills: [], entities: [], missingRequiredInputs: [],
            contextPolicy: { structuredKnowledge: true, sourceLibrary: false },
            persistencePolicy: { writeKnowledge: false },
            rationale: 'FIX-A exchange integrity regression fixture.',
          } }
        },
      },
    }),
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

test('verified SZ identity cannot be overwritten by a reasoning result that says SH', async (t) => {
  const kb = await emptyKnowledgeBase()
  const cases = ['company_research', 'valuation', 'earnings_review'] as const
  try {
    for (const workflowId of cases) {
      await t.test(workflowId, async () => {
        const args = {
          symbol: '002487', name: '大金重工', exchange: 'SH',
          ...(workflowId === 'earnings_review' ? { fiscalYear: 2026, period: 'H1' } : {}),
        }
        const harness = createHarness({ reasoningWorkflowArgs: args })
        const result = await harness.service(kb.kb).startAsync({
          query: '002487.SZ 当前估值', mode: { type: 'workflow', workflowId },
          contextPolicy: { structuredKnowledge: true, sourceLibrary: false },
          persistencePolicy: { writeKnowledge: false },
        })

        if (result.status === 'started') {
          assert.deepEqual(
            { symbol: result.decision.workflow?.arguments.symbol, name: result.decision.workflow?.arguments.name, exchange: result.decision.workflow?.arguments.exchange },
            { symbol: '002487', name: '大金重工', exchange: 'SZ' },
            `${workflowId} dispatch decision must contain only the verified identity`,
          )
          assert.deepEqual(
            { symbol: harness.started[0]?.args.symbol, name: harness.started[0]?.args.name, exchange: harness.started[0]?.args.exchange },
            { symbol: '002487', name: '大金重工', exchange: 'SZ' },
            `${workflowId} execution binding must receive only the verified identity`,
          )
        } else {
          assert.ok(['unresolved_reference', 'invalid_input'].includes(result.status), `${workflowId} must explicitly reject the conflicting identity, received ${result.status}`)
          assert.equal(harness.started.length, 0, `${workflowId} must not execute after rejecting the conflicting identity`)
        }
      })
    }
  } finally { await kb.close() }
})

test('Dispatch hands one verified identity through the production Valuation binding into ResearchService acquisition', async () => {
  const kb = await emptyKnowledgeBase()
  let directoryCalls = 0
  const domainCalls: string[] = []
  const akshare = {
    async securityDirectory() {
      directoryCalls += 1
      if (directoryCalls > 1) throw new Error('controlled second identity-directory call failure')
      return [ROW]
    },
    async companyBasic() { domainCalls.push('companyBasic'); return [] },
    async valuationFinancialIndicators() { domainCalls.push('valuationFinancialIndicators'); return [] },
    async historicalMarketData() { domainCalls.push('historicalMarketData'); return [] },
  } as unknown as AkshareDataClient
  const identityResolver = new SecurityIdentityResolver({
    mountedKnowledgeBaseRoot: kb.kb,
    now: () => new Date(NOW),
    dataResolverFactory: ({ now, signal }) => createSecurityIdentityDataResolver({ akshare, now, ...(signal ? { signal } : {}) }),
  })
  const workflowService = new WorkflowService()
  const researchService = new ResearchService({
    mountedKnowledgeBaseRoot: kb.kb,
    reportRoot: join(kb.kb, '..', 'reports'),
    acquisitionPlugins: [],
    akshare,
    workflowService,
    securityIdentityResolver: identityResolver,
    valuationDataResolverFactory: ({ company, valuationDate, asOf, now, signal }) => createValuationDataResolver({
      company, valuationDate, ...(asOf ? { historicalAsOf: asOf } : {}), now, ...(signal ? { signal } : {}), akshare,
    }),
  })
  const dispatch = new ResearchDispatchService({
    researchService,
    workflowService,
    mountedKnowledgeBaseRoot: kb.kb,
    securityIdentityResolver: identityResolver,
    clock: () => new Date(NOW),
    reasoningExecutor: {
      capabilities: () => ({ maxContextTokens: 10_000, maxOutputTokens: 2_000, structuredOutputSupport: true, maxConcurrency: 1 }),
      async execute(request: ReasoningRequest) {
        return { operation: request.operation, output: {
          mode: 'workflow',
          workflow: { id: 'valuation', confidence: 1, arguments: { name: '大金重工', methods: ['PE'] } },
          skills: [], entities: [], missingRequiredInputs: [],
          contextPolicy: { structuredKnowledge: true, sourceLibrary: false },
          persistencePolicy: { writeKnowledge: false },
          rationale: 'Production binding identity handoff regression.',
        } }
      },
    },
  })
  try {
    const started = await dispatch.startAsync({
      query: '大金重工 估值', mode: { type: 'workflow', workflowId: 'valuation' },
      contextPolicy: { structuredKnowledge: true, sourceLibrary: false },
      persistencePolicy: { writeKnowledge: false },
    })
    assert.equal(started.status, 'started', JSON.stringify(started.feedback))
    if (started.status !== 'started' || !started.completion || !started.runId) throw new Error('Expected the production Valuation Workflow to start')
    const result = await started.completion as { readonly status: string; readonly blockedReason?: string }
    assert.equal(result.status, 'blocked')
    assert.equal(result.blockedReason, 'VALUATION_MARKET_PRICE_UNAVAILABLE')
    assert.equal(directoryCalls, 1, 'one dispatch run must issue exactly one external security-directory call')
    assert.ok(domainCalls.includes('historicalMarketData'), 'the production Valuation DataResolver must be reached')
    assert.ok(domainCalls.includes('valuationFinancialIndicators'), 'the production financial requirement must be reached')
    assert.equal(workflowService.getWorkflowStatus(started.runId)?.status, 'blocked')
    const assets = await readCanonicalV04Assets(kb.kb)
    assert.equal(assets.objects.some((item) => {
      const value = item.value as unknown as Record<string, unknown>
      return value.type === 'company' && value.ticker === '002487'
    }), false)
  } finally { await kb.close() }
})

test('independent ResearchService calls verify identity and do not reuse a same-name different-security cache entry', async () => {
  const kb = await emptyKnowledgeBase()
  let directoryCalls = 0
  const akshare = {
    async securityDirectory() {
      directoryCalls += 1
      if (directoryCalls === 1) return [{ symbol: '000001', name: 'Shared Name', exchange: 'SZ' as const }]
      throw new Error('controlled identity provider failure for the other security')
    },
  } as unknown as AkshareSecurityDirectoryClient
  const identityResolver = new SecurityIdentityResolver({
    mountedKnowledgeBaseRoot: kb.kb,
    now: () => new Date(NOW),
    dataResolverFactory: ({ now, signal }) => createSecurityIdentityDataResolver({ akshare, now, ...(signal ? { signal } : {}) }),
  })
  const workflowService = new WorkflowService()
  const research = new ResearchService({
    mountedKnowledgeBaseRoot: kb.kb,
    reportRoot: join(kb.kb, '..', 'reports'),
    acquisitionPlugins: [],
    workflowService,
    securityIdentityResolver: identityResolver,
  })
  try {
    const first = research.startValuation({ workflowRunId: 'direct-identity-first', symbol: '000001', name: 'Shared Name', exchange: 'SZ', writeKnowledge: false, useStructuredKnowledge: false })
    const firstResult = await first.completion as { readonly status: string; readonly blockedReason?: string }
    assert.equal(firstResult.status, 'blocked')
    assert.equal(firstResult.blockedReason, 'VALUATION_MARKET_PRICE_UNAVAILABLE')
    assert.equal(directoryCalls, 1, 'direct ResearchService invocation must verify identity itself')

    const second = research.startValuation({ workflowRunId: 'direct-identity-other', symbol: '000002', name: 'Shared Name', exchange: 'SZ', writeKnowledge: false, useStructuredKnowledge: false })
    await assert.rejects(second.completion, /UNRESOLVED_REFERENCE/)
    assert.equal(directoryCalls, 2, 'a different symbol with the same name must not reuse the first security identity')
    assert.equal(workflowService.getWorkflowStatus(second.runId)?.status, 'failed')
  } finally { await kb.close() }
})

test('caller cancellation terminates an in-flight direct ResearchService identity lookup as cancelled', async () => {
  const kb = await emptyKnowledgeBase()
  let markDirectoryStarted!: () => void
  let releaseDirectory!: (rows: readonly typeof ROW[]) => void
  const directoryStarted = new Promise<void>((resolve) => { markDirectoryStarted = resolve })
  const directoryResult = new Promise<readonly typeof ROW[]>((resolve) => { releaseDirectory = resolve })
  const akshare = {
    async securityDirectory() { markDirectoryStarted(); return directoryResult },
  } as unknown as AkshareSecurityDirectoryClient
  const identityResolver = new SecurityIdentityResolver({
    mountedKnowledgeBaseRoot: kb.kb,
    now: () => new Date(NOW),
    dataResolverFactory: ({ now, signal }) => createSecurityIdentityDataResolver({ akshare, now, ...(signal ? { signal } : {}) }),
  })
  const workflowService = new WorkflowService()
  const research = new ResearchService({ mountedKnowledgeBaseRoot: kb.kb, reportRoot: join(kb.kb, '..', 'reports'), acquisitionPlugins: [], workflowService, securityIdentityResolver: identityResolver })
  try {
    const controller = new AbortController()
    const started = research.startValuation({ workflowRunId: 'direct-identity-cancel', symbol: '002487', writeKnowledge: false }, controller.signal)
    await directoryStarted
    controller.abort()
    releaseDirectory([ROW])
    await assert.rejects(started.completion, /cancelled/i)
    assert.equal(workflowService.getWorkflowStatus(started.runId)?.status, 'cancelled')
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
