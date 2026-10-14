import assert from 'node:assert/strict'
import test from 'node:test'
import { ResearchDispatchService } from '../../../app/services/research-dispatch-service.ts'
import { SecurityIdentityResolver } from '../../../app/services/security-identity-resolver.ts'
import { searchSecurityDirectory } from '../../../app/services/security-directory-search.ts'
import { createSecurityIdentityDataResolver, type AkshareSecurityDirectoryClient } from '../../../plugins/research-acquisition/security-identity-data.ts'
import { WorkflowService } from '../../../app/services/workflow-service.ts'
import { ReasoningExecutorError } from '../../../plugins/reasoning/errors.ts'
import type { ReasoningExecutor } from '../../../plugins/reasoning/contracts.ts'

const rows = [
  { name: '东山精密', symbol: '002384', exchange: 'SZ' as const },
  { name: '东盛精密', symbol: '002999', exchange: 'SZ' as const },
  { name: '重庆钢铁', symbol: '601005', exchange: 'SH' as const },
]
const now = '2026-10-14T00:00:00.000Z'

test('directory returns every initial match, full pinyin, exact name/code and alternative polyphonic readings', () => {
  assert.equal(searchSecurityDirectory(rows, 'dsjm', now).candidates.length, 2)
  assert.deepEqual(searchSecurityDirectory(rows, 'dongshanjingmi', now).candidates.map((row) => row.symbol), ['002384'])
  assert.equal(searchSecurityDirectory(rows, '东山精密', now).candidates[0]?.matchKind, 'exact_name')
  assert.equal(searchSecurityDirectory(rows, '002384', now).candidates[0]?.matchKind, 'exact_code')
  assert.equal(searchSecurityDirectory(rows, 'cqgt', now).candidates[0]?.symbol, '601005')
  assert.equal(searchSecurityDirectory(rows, 'zqgt', now).candidates[0]?.symbol, '601005')
  const many = Array.from({ length: 90 }, (_, index) => ({ ...rows[0]!, symbol: String(200000 + index) }))
  assert.equal(searchSecurityDirectory(many, 'dsjm', now).candidates.length, 90)
  const statusRows = [{ ...rows[0]!, name: '*ST东山精密' }]
  assert.equal(searchSecurityDirectory(statusRows, 'dsjm', now).candidates[0]?.name, '*ST东山精密')
  assert.equal(searchSecurityDirectory(statusRows, 'stdsjm', now).candidates[0]?.name, '*ST东山精密')
  assert.equal(searchSecurityDirectory(statusRows, 'dongshanjingmi', now).candidates[0]?.matchKind, 'pinyin')
})

function harness(object: string, options: { unavailable?: boolean; failure?: 'model' | 'schema' | 'json' } = {}) {
  let snapshot = rows
  let starts = 0
  const workflowService = new WorkflowService()
  const resolver = new SecurityIdentityResolver({ now: () => new Date(now), directoryLoader: async () => { if (options.unavailable) throw new Error('offline'); return snapshot }, dataResolverFactory: ({ now, signal }) => createSecurityIdentityDataResolver({ now, signal, akshare: { securityDirectory: async () => snapshot } as unknown as AkshareSecurityDirectoryClient }) })
  const service = new ResearchDispatchService({ securityIdentityResolver: resolver, workflowService, clock: () => new Date(now),
    reasoningExecutor: {
      capabilities: () => ({ maxContextTokens: 1000, maxOutputTokens: 1000, structuredOutputSupport: true, maxConcurrency: 1 }),
      execute: async (request) => {
        if (options.failure === 'model') throw new Error('provider offline with private detail')
        if (options.failure === 'schema') return { operation: request.operation, output: { mode: 'workflow' } }
        if (options.failure === 'json') return { operation: request.operation, output: '{broken json' }
        const input = request.input as { query: string; runtimeContext: { contextPolicy: unknown; persistencePolicy: unknown } }
        return { operation: request.operation, output: { mode: 'workflow', workflow: { id: input.query.includes('用户研究目标：估值') ? 'valuation' : 'company_research', confidence: 1, arguments: input.query.includes('用户补充') ? {} : { name: object } }, entities: [{ type: 'company', value: object, confidence: 1 }], skills: [], missingRequiredInputs: [], contextPolicy: input.runtimeContext.contextPolicy, persistencePolicy: input.runtimeContext.persistencePolicy, rationale: 'Report intent' } }
      },
    },
    executionBindings: new Map(['company_research', 'valuation'].map((workflowId) => [workflowId, async (context) => {
      starts += 1
      workflowService.register({ runId: context.runId, workflowType: workflowId, objective: 'test' })
      return workflowService.start(context.runId, async () => ({ status: 'completed' }))
    }])),
  })
  return { service, starts: () => starts, replace: () => { snapshot = [...rows, { name: '东山精密', symbol: '002888', exchange: 'SZ' }] } }
}
const policies = { contextPolicy: { structuredKnowledge: false, sourceLibrary: false }, persistencePolicy: { writeKnowledge: false } }

test('clear company name report resolves symbol before required field validation and starts', async () => {
  const h = harness('东山精密')
  const result = await h.service.startAsync({ query: '写一篇东山精密的报告  ', ...policies })
  assert.equal(result.status, 'started', JSON.stringify({ feedback: result.feedback, clarification: result.clarification, decision: result.decision }))
  assert.equal(result.decision.workflow?.arguments.symbol, '002384')
  assert.equal(result.decision.workflow?.arguments.asOf, undefined)
  await result.completion
  assert.equal(h.starts(), 1)
})

test('initials request requires selection; selected report preserves policies and verified identity', async () => {
  const h = harness('dsjm')
  const result = await h.service.startAsync({ query: '写一篇 dsjm 的报告', ...policies })
  assert.equal(result.status, 'needs_clarification')
  assert.equal(result.clarification?.candidates.length, 2)
  assert.equal(h.starts(), 0)
  const started = await h.service.confirmAsync(result, { confirmationId: result.clarification!.confirmationId, candidateId: '002384.SZ', directoryVersion: result.clarification!.directoryVersion })
  assert.equal(started.status, 'started', JSON.stringify(started.feedback))
  assert.deepEqual(started.request.persistencePolicy, policies.persistencePolicy)
  assert.equal(started.decision.workflow?.arguments.name, '东山精密')
  await started.completion
})

test('bare initials selects security first, then asks goal and executes only after goal supplied', async () => {
  const h = harness('dsjm')
  const result = await h.service.startAsync({ query: 'dsjm', ...policies })
  const goal = await h.service.confirmAsync(result, { confirmationId: result.clarification!.confirmationId, candidateId: '002384.SZ', directoryVersion: result.clarification!.directoryVersion })
  assert.equal(goal.clarification?.kind, 'research_goal')
  assert.equal(h.starts(), 0)
  const started = await h.service.confirmAsync(goal, { confirmationId: goal.clarification!.confirmationId, clarificationText: '写一篇完整公司报告' })
  assert.equal(started.status, 'started', JSON.stringify(started.feedback))
  assert.equal(started.decision.workflow?.arguments.symbol, '002384')
  await started.completion
})

test('changed directory requires fresh selection and cannot execute an old candidate version', async () => {
  const h = harness('dsjm')
  const result = await h.service.startAsync({ query: '写一篇 dsjm 的报告', ...policies })
  h.replace()
  const refreshed = await h.service.confirmAsync(result, { confirmationId: result.clarification!.confirmationId, candidateId: '002384.SZ', directoryVersion: result.clarification!.directoryVersion })
  assert.equal(refreshed.status, 'needs_clarification')
  assert.notEqual(refreshed.clarification?.directoryVersion, result.clarification?.directoryVersion)
  assert.equal(h.starts(), 0)
})

test('goal after bare object selection chooses Valuation rather than pinning Company Research', async () => {
  const h = harness('dsjm')
  const result = await h.service.startAsync({ query: 'dsjm', ...policies })
  const goal = await h.service.confirmAsync(result, { confirmationId: result.clarification!.confirmationId, candidateId: '002384.SZ', directoryVersion: result.clarification!.directoryVersion })
  const started = await h.service.confirmAsync(goal, { confirmationId: goal.clarification!.confirmationId, clarificationText: '估值' })
  assert.equal(started.status, 'started', JSON.stringify(started.feedback))
  assert.equal(started.decision.workflow?.id, 'valuation')
  assert.equal(started.decision.workflow?.arguments.name, '东山精密')
  assert.deepEqual(started.request.contextPolicy, policies.contextPolicy)
  await started.completion
})

test('expired confirmation refreshes clarification and never starts a task', async () => {
  const h = harness('dsjm')
  const result = await h.service.startAsync({ query: '写一篇 dsjm 的报告', ...policies })
  const expired = { ...result, clarification: { ...result.clarification!, expiresAt: '2026-10-13T00:00:00.000Z' } }
  const refreshed = await h.service.confirmAsync(expired, { confirmationId: expired.clarification.confirmationId, candidateId: '002384.SZ', directoryVersion: expired.clarification.directoryVersion })
  assert.equal(refreshed.status, 'needs_clarification')
  assert.notEqual(refreshed.clarification?.confirmationId, expired.clarification.confirmationId)
  assert.equal(refreshed.clarification?.expiresAt, '2026-10-14T00:15:00.000Z')
  assert.equal(h.starts(), 0)
})

test('user correction replaces initials with an exact name and preserves the report goal/policies', async () => {
  const h = harness('dsjm')
  const result = await h.service.startAsync({ query: '写一篇 dsjm 的报告', ...policies })
  const started = await h.service.confirmAsync(result, { confirmationId: result.clarification!.confirmationId, clarificationText: '东山精密' })
  assert.equal(started.status, 'started', JSON.stringify(started.feedback))
  assert.equal(started.decision.workflow?.arguments.symbol, '002384')
  assert.equal(started.decision.workflow?.arguments.name, '东山精密')
  assert.match(started.request.query, /写一篇 东山精密 的报告/u)
  assert.deepEqual(started.request.contextPolicy, policies.contextPolicy)
  assert.deepEqual(started.request.persistencePolicy, policies.persistencePolicy)
  await started.completion
})

test('directory outage and semantic exhaustion report separate errors with no free execution', async () => {
  const outage = await harness('dsjm', { unavailable: true }).service.startAsync({ query: '写一篇 dsjm 的报告', ...policies })
  assert.equal(outage.status, 'unresolved_reference')
  for (const failure of ['model', 'schema', 'json'] as const) {
    const h = harness('东山精密', { failure })
    const result = await h.service.startAsync({ query: '写一篇东山精密的报告', ...policies })
    assert.equal(result.status, failure === 'model' ? 'executor_unavailable' : 'invalid_input')
    assert.equal(result.resolution?.attemptErrors?.length, 2)
    if (failure === 'json') assert.equal(result.resolution?.attemptErrors?.[0]?.category, 'json_parse')
    assert.equal(result.runId, undefined)
    assert.equal(h.starts(), 0)
    assert.doesNotMatch(JSON.stringify(result), /private detail/)
  }
})

test('model cannot hide a supplied name/code conflict by generating another company name', async () => {
  const h = harness('东盛精密')
  const result = await h.service.startAsync({ query: '写一篇东山精密 (002999.SZ) 的报告', ...policies })
  assert.equal(result.status, 'unresolved_reference')
  assert.equal(h.starts(), 0)
  assert.match(result.feedback?.reason ?? '', /exact name/u)
})

test('stable provider output/timeout codes classify without inspecting private messages', async () => {
  for (const [code, category, status] of [
    ['reasoning_output_invalid', 'semantic_decision', 'invalid_input'],
    ['reasoning_timeout', 'timeout', 'executor_unavailable'],
    ['reasoning_execution_failed', 'model_call', 'executor_unavailable'],
  ] as const) {
    const executor: ReasoningExecutor = { capabilities: () => ({ maxContextTokens: 1000, maxOutputTokens: 1000, structuredOutputSupport: true, maxConcurrency: 1 }), async execute() { throw new ReasoningExecutorError(code, 'private provider parse timeout schema misleading detail') } }
    const result = await new ResearchDispatchService({ reasoningExecutor: executor }).startAsync({ query: '写一篇东山精密的报告', ...policies })
    assert.equal(result.status, status)
    assert.equal(result.resolution?.attemptErrors?.[0]?.category, category)
    assert.doesNotMatch(JSON.stringify(result), /private provider/u)
  }
})
