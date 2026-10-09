import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { fauxProvider } from '@earendil-works/pi-ai'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { createFreshKnowledgeBaseV04 } from '../../../knowledge/storage/create-v04.ts'
import { createResearchHubApplicationRuntime } from '../../../app/runtime/application-runtime.ts'
import { ResearchHubRuntimeServer } from '../../../app/runtime/server.ts'
import { ResearchService } from '../../../app/services/research-service.ts'
import { SecurityIdentityResolver } from '../../../app/services/security-identity-resolver.ts'
import { WorkflowService } from '../../../app/services/workflow-service.ts'
import type { AkshareDataClient } from '../../../plugins/research-acquisition/akshare.ts'
import { createSecurityIdentityDataResolver, type AkshareSecurityDirectoryClient } from '../../../plugins/research-acquisition/security-identity-data.ts'
import type { ReasoningExecutor } from '../../../plugins/reasoning/contracts.ts'

class FixtureExecutor implements ReasoningExecutor {
  capabilities() { return { maxContextTokens: 100_000, maxOutputTokens: 10_000, structuredOutputSupport: true, maxConcurrency: 2 } }
  async execute() { return { operation: 'valuation_assumption_design', output: {} } as never }
}

test('VAL-HTTP-001 HTTP valuation route starts authoritative Workflow', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-valuation-route-'))
  const kb = join(root, 'kb'); const cwd = join(root, 'cwd'); const agentDir = join(root, 'agent'); const workspace = join(root, 'workspace')
  await mkdir(cwd); await mkdir(agentDir); await mkdir(workspace); await createFreshKnowledgeBaseV04(kb, { knowledgeBaseId: 'kb-valuation-route' })
  const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false })
  const faux = fauxProvider({ provider: `valuation-route-${Date.now()}`, models: [{ id: 'fixture-model' }] }); modelRuntime.registerNativeProvider(faux.provider)
  const akshare: AkshareDataClient = { companyBasic: async () => [], financialData: async () => [], historicalMarketData: async () => [] }
  const workflowService = new WorkflowService()
  const directory = { async securityDirectory() { return [{ symbol: '600519', name: 'Fixture Company', exchange: 'SH' }] } } as unknown as AkshareSecurityDirectoryClient
  const securityIdentityResolver = new SecurityIdentityResolver({ mountedKnowledgeBaseRoot: kb, dataResolverFactory: ({ now, signal }) => createSecurityIdentityDataResolver({ akshare: directory, now, ...(signal ? { signal } : {}) }) })
  const researchService = new ResearchService({ mountedKnowledgeBaseRoot: kb, reportRoot: join(root, 'reports'), acquisitionPlugins: [], akshare, workflowService, reasoningExecutor: new FixtureExecutor(), securityIdentityResolver })
  const runtime = await createResearchHubApplicationRuntime({ cwd, agentDir, mountedKnowledgeBaseRoot: kb, workspaceRoot: workspace, modelRuntime, model: faux.getModel(), reasoningExecutor: new FixtureExecutor(), researchService })
  const server = new ResearchHubRuntimeServer({ runtime, clientRoot: join(root, 'missing-client'), port: 0 })
  try {
    const info = await server.start()
    const response = await fetch(`${info.origin}/api/production/analyze-valuation`, { method: 'POST', headers: { origin: info.origin, 'x-researchhub-runtime-token': info.runtimeToken, 'content-type': 'application/json' }, body: JSON.stringify({ symbol: '600519', exchange: 'SSE', methods: ['PE'], targetFiscalYear: 2026 }) })
    assert.equal(response.status, 202)
    const body = await response.json() as { accepted: boolean; runId: string }
    assert.equal(body.accepted, true)
    assert.equal(workflowService.getWorkflowStatus(body.runId)?.workflowType, 'valuation')
    for (let attempt = 0; attempt < 50 && workflowService.getWorkflowStatus(body.runId)?.status !== 'blocked'; attempt++) await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(workflowService.getWorkflowStatus(body.runId)?.status, 'blocked')
  } finally {
    await server.close(); await runtime.close(); await Promise.resolve((modelRuntime as unknown as { dispose?: () => void | Promise<void> }).dispose?.()).catch(() => undefined); await rm(root, { recursive: true, force: true })
  }
})
