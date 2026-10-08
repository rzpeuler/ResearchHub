import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createFreshKnowledgeBaseV04 } from '../../knowledge/storage/create-v04.ts'
import { ResearchService } from '../../app/services/research-service.ts'
import { WorkflowService } from '../../app/services/workflow-service.ts'
import { ReasoningExecutorError } from '../../plugins/reasoning/errors.ts'
import type { ReasoningExecutor } from '../../plugins/reasoning/contracts.ts'
import { createIndustryProductionReasoningExecutor, INDUSTRY_PRODUCTION_REASONING_SELECTION, PRIMARY_PRODUCTION_REASONING_MODEL } from '../../app/pi/model-selection.ts'
import { createIndustryDataResolver } from '../../app/services/industry-data-resolver.ts'
import { createIndustryDataCatalog } from '../../data/industry-catalog.ts'

const capabilities = { maxContextTokens: 4_000, maxOutputTokens: 1_000, structuredOutputSupport: true, maxConcurrency: 1 } as const
const failing = (failureClass: 'safety_or_policy' | 'transport_or_service'): ReasoningExecutor => ({
  capabilities: () => capabilities,
  execute: async (request) => { throw new ReasoningExecutorError('reasoning_execution_failed', 'fixture failure', { operation: request.operation, failureClass }) },
})

async function serviceFixture(factory: () => Promise<ReasoningExecutor>, general: ReasoningExecutor) {
  const root = await mkdtemp(join(tmpdir(), 'industry-selection-'))
  const reports = join(root, 'reports'); await mkdir(reports); await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-industry-selection' })
  const workflowService = new WorkflowService()
  const service = new ResearchService({ mountedKnowledgeBaseRoot: root, reportRoot: reports, acquisitionPlugins: [], workflowService, reasoningExecutor: general, industryReasoningExecutorFactory: factory, industryDataResolverFactory: (context) => createIndustryDataResolver({ catalog: createIndustryDataCatalog(), policies: [], operations: {} }, context) })
  return { root, service, workflowService }
}

test('Industry metadata and default production model remain distinct', async () => {
  assert.deepEqual(PRIMARY_PRODUCTION_REASONING_MODEL, { providerId: 'zhipu-openapi', modelId: 'glm-5.3-flash' })
  assert.deepEqual(INDUSTRY_PRODUCTION_REASONING_SELECTION, { backend: 'codex-cli', requestedModel: 'gpt-5.6-luna', requestedReasoningEffort: 'medium' })
  const executor = await createIndustryProductionReasoningExecutor({ capabilities, executable: process.execPath })
  assert.equal(executor.runtimeMetadata().requestedModel, 'gpt-5.6-luna')
  assert.equal(executor.runtimeMetadata().requestedReasoningEffort, 'medium')
})

test('Industry factory is lazy and a rejected factory never invokes the general executor', async () => {
  let factoryCalls = 0; let generalCalls = 0
  const general: ReasoningExecutor = { capabilities: () => capabilities, execute: async () => { generalCalls++; throw new Error('general must not run') } }
  const fixture = await serviceFixture(async () => { factoryCalls++; throw new ReasoningExecutorError('reasoning_host_unavailable', 'Codex unavailable') }, general)
  try {
    assert.equal(factoryCalls, 0)
    const started = fixture.service.startIndustryResearch({ workflowRunId: 'lazy-reject', name: 'PCB' })
    await assert.rejects(started.completion, /Codex unavailable/)
    assert.equal(factoryCalls, 1); assert.equal(generalCalls, 0)
  } finally { await rm(fixture.root, { recursive: true, force: true }) }
})

test('Industry executor safety and technical failures do not trigger fallback', async (t) => {
  for (const [index, failureClass] of (['safety_or_policy', 'transport_or_service'] as const).entries()) {
    await t.test(failureClass, async () => {
      let generalCalls = 0; const general: ReasoningExecutor = { capabilities: () => capabilities, execute: async () => { generalCalls++; throw new Error('fallback forbidden') } }
      const fixture = await serviceFixture(async () => failing(failureClass), general)
      try { const started = fixture.service.startIndustryResearch({ workflowRunId: `no-fallback-${index}`, name: 'PCB' }); await started.completion; assert.equal(generalCalls, 0) } finally { await rm(fixture.root, { recursive: true, force: true }) }
    })
  }
})
