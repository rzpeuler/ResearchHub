/** Isolated, provider-free UI acceptance fixture. Never mounts or writes canonical Knowledge. */
import { mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai'
import { createResearchHubApplicationRuntime } from '../../../app/runtime/application-runtime.ts'
import { ResearchHubRuntimeServer } from '../../../app/runtime/server.ts'
import { normalizeResearchRequest } from '../../../app/services/research-dispatch-contracts.ts'
import type { ResearchDispatchStart } from '../../../app/services/research-dispatch-service.ts'

const root = await mkdtemp(join(tmpdir(), 'rhl-activity-browser-')); const cwd = join(root, 'cwd'); const agentDir = join(root, 'agent')
await mkdir(cwd); await mkdir(agentDir)
const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false })
const faux = fauxProvider({ provider: `activity-browser-${Date.now()}`, models: [{ id: 'fixture' }] }); modelRuntime.registerNativeProvider(faux.provider)
let runtime: Awaited<ReturnType<typeof createResearchHubApplicationRuntime>>
function start(runId: string) {
  const service = runtime.workflowService
  service.register({ runId, workflowType: 'company_research', objective: '东山精密 · UI fixture' })
  const completion = service.start(runId, async signal => {
    await service.observationReporter(runId).startStage('data_acquisition', '数据获取')
    await service.observationReporter(runId).acquisitionActivity!( { activityId: 'cninfo-download-1', providerId: 'cninfo', step: 'download', status: 'running', sourceTitle: '东山精密年度报告', startedAt: new Date().toISOString() })
    await new Promise<void>(resolve => { const timer = setTimeout(resolve, 120000); signal.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true }) })
    return { status: signal.aborted ? 'cancelled' as const : 'blocked' as const, summary: 'UI fixture completed; no real provider or Knowledge writes.' }
  })
  void completion.catch(() => undefined)
  return { runId, completion }
}
const researchService = { startResearchCompany(input: { workflowRunId: string }) { return start(input.workflowRunId) } }
runtime = await createResearchHubApplicationRuntime({ cwd, agentDir, modelRuntime, model: faux.getModel(), researchService: researchService as never })
function envelope(raw: unknown): ResearchDispatchStart {
  const request = normalizeResearchRequest(raw)
  return { request, status: 'needs_clarification', decision: { mode: 'workflow', workflow: { id: 'company_research', confidence: 1, arguments: { name: '东山精密' } }, skills: [], entities: [], missingRequiredInputs: [], contextPolicy: request.contextPolicy, persistencePolicy: request.persistencePolicy, rationale: 'UI fixture: company report' }, summary: { mode: 'Free Research', workflowId: 'company_research', selectedSkillIds: [], argumentsStatus: 'missing', argumentKeys: ['name'], contextPolicy: request.contextPolicy, persistencePolicy: request.persistencePolicy }, clarification: { confirmationId: randomUUID(), kind: 'security_selection', query: 'dsjm', workflowId: 'company_research', candidates: [{ candidateId: 'SZ-002384', name: '东山精密', symbol: '002384', exchange: 'SZ', matchKind: 'initials' }, { candidateId: 'SH-688100', name: '测试同首字母', symbol: '688100', exchange: 'SH', matchKind: 'initials' }], missingFields: [], directoryTimestamp: new Date().toISOString(), directoryVersion: 'ui-fixture-v1', question: '请选择研究对象（隔离测试目录）' } }
}
runtime.services.researchDispatchService!.startAsync = async (raw, _signal, reserved) => {
  const result = envelope(raw)
  if (result.request.query.includes('tool') || result.request.query.includes('工具')) {
    const runId = randomUUID(); faux.setResponses([fauxAssistantMessage(fauxToolCall('research_company', { workflowRunId: runId, symbol: '002384' }, { id: 'fixture-tool-1' })), fauxAssistantMessage('Agent 已完成。')])
    return { ...result, clarification: undefined, status: 'free_research', decision: { ...result.decision, mode: 'free_research', workflow: undefined } }
  }
  if (/dsjm/i.test(result.request.query)) return result
  const started = start(reserved ?? randomUUID())
  return { ...result, clarification: undefined, status: 'started', ...started, decision: { ...result.decision, workflow: { id: 'company_research', confidence: 1, arguments: { symbol: '002384', name: '东山精密', exchange: 'SZ' } } } }
}
runtime.services.researchDispatchService!.confirmAsync = async (original, input, _signal, runId) => {
  if (input.confirmationId !== original.clarification?.confirmationId || input.directoryVersion !== 'ui-fixture-v1') throw new Error('Fixture candidate version changed')
  const started = start(runId ?? randomUUID())
  return { ...original, clarification: undefined, status: 'started', ...started, decision: { ...original.decision, workflow: { id: 'company_research', confidence: 1, arguments: { symbol: '002384', name: '东山精密', exchange: 'SZ' } } } }
}
const server = new ResearchHubRuntimeServer({ runtime, clientRoot: resolve('dist/client'), port: 0 }); const info = await server.start()
console.log(JSON.stringify({ origin: info.origin, fixtureRoot: root, pid: process.pid, scenarios: ['写一篇东山精密的报告', '写一篇 dsjm 的报告', '工具研究公司'] }))
process.on('SIGINT', () => { void server.close().then(() => runtime.close()).then(() => process.exit(0)) })
