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
import { writeResearchReport, type ResearchReport } from '../../../app/services/research-report.ts'
import { WorkflowService } from '../../../app/services/workflow-service.ts'
import type { ReasoningCapabilities, ReasoningExecutor, ReasoningRequest, ReasoningResult } from '../../../plugins/reasoning/contracts.ts'

const capabilities: ReasoningCapabilities = { maxContextTokens: 100_000, maxOutputTokens: 10_000, structuredOutputSupport: true, maxConcurrency: 2 }
class FixtureExecutor implements ReasoningExecutor {
  capabilities(): ReasoningCapabilities { return capabilities }
  async execute(request: ReasoningRequest): Promise<ReasoningResult> { return { operation: request.operation, output: {} } }
}

test('Research Report HTTP catalog is read-only and returns validated summaries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-research-reports-route-'))
  const kb = join(root, 'kb'); const cwd = join(root, 'cwd'); const agentDir = join(root, 'agent'); const workspace = join(root, 'workspace'); const reportRoot = join(root, 'reports')
  await mkdir(cwd); await mkdir(agentDir); await mkdir(workspace); await createFreshKnowledgeBaseV04(kb, { knowledgeBaseId: 'kb-research-reports-route' })
  const report: ResearchReport = { reportId: 'company-report', reportType: 'company_research', subjectRefs: ['entity:company'], generatedAt: '2026-09-15T08:00:00.000Z', asOf: '2026-09-15T07:00:00.000Z', workflowRunId: 'company-report-run', knowledgeBaseRevision: 4, sourceRefs: ['source:fixture'], claimRefs: ['claim:fixture'], methodology: 'bounded fixture', verifiedSecurityIdentity: { symbol: '002640', exchange: 'SZ', verifiedName: 'Company Alpha', verificationSource: 'canonical_knowledge', originAuthority: 'CANONICAL_KNOWLEDGE', verifiedAt: '2026-09-15T07:00:00.000Z', canonicalCompanyRef: 'entity:company' }, sections: [{ id: 'summary', title: 'Summary', markdown: 'Fixture report.', sourceRefs: ['source:fixture'], claimRefs: ['claim:fixture'] }], outputPath: 'company-report.md' }
  await writeResearchReport(report, reportRoot)
  const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false })
  const faux = fauxProvider({ provider: `research-reports-route-${Date.now()}`, models: [{ id: 'fixture-model' }] }); modelRuntime.registerNativeProvider(faux.provider)
  const researchService = new ResearchService({ mountedKnowledgeBaseRoot: kb, reportRoot, acquisitionPlugins: [], workflowService: new WorkflowService() })
  const runtime = await createResearchHubApplicationRuntime({ cwd, agentDir, mountedKnowledgeBaseRoot: kb, workspaceRoot: workspace, modelRuntime, model: faux.getModel(), reasoningExecutor: new FixtureExecutor(), researchService })
  const server = new ResearchHubRuntimeServer({ runtime, clientRoot: join(root, 'missing-client'), port: 0 })
  try {
    const info = await server.start()
    const listResponse = await fetch(`${info.origin}/api/research-reports?limit=1`)
    assert.equal(listResponse.status, 200)
    const listed = await listResponse.json() as { reports: { reportId: string; sectionCount: number; sourceCount: number }[] }
    assert.deepEqual(listed.reports, [{ reportId: 'company-report', reportType: 'company_research', subjectRefs: ['entity:company'], generatedAt: report.generatedAt, asOf: report.asOf, workflowRunId: report.workflowRunId, knowledgeBaseRevision: 4, sourceCount: 1, claimCount: 1, sectionCount: 1, methodology: 'bounded fixture', verifiedName: 'Company Alpha' }])
    assert.equal((await fetch(`${info.origin}/api/research-reports/company-report`)).status, 200)
  } finally {
    await server.close(); await runtime.close(); await Promise.resolve((modelRuntime as unknown as { dispose?: () => void | Promise<void> }).dispose?.()).catch(() => undefined); await rm(root, { recursive: true, force: true })
  }
})
