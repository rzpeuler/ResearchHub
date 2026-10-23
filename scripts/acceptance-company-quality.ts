import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { resolve, join, relative, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createFreshKnowledgeBaseV04 } from '../knowledge/storage/create-v04.ts'
import { createResearchHubRuntimeServer } from '../app/runtime/server.ts'
import { verifyCompanyResearchKnowledge } from './company-quality-knowledge-verification.ts'

async function fingerprint(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  async function visit(dir: string): Promise<void> { for (const entry of await readdir(dir, { withFileTypes: true })) { const path = join(dir, entry.name); if (entry.isDirectory()) await visit(path); else if (entry.isFile()) result[relative(root, path)] = createHash('sha256').update(await readFile(path)).digest('hex') } }
  await visit(root); return result
}
const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: npx tsx scripts/acceptance-company-quality.ts [--runtime-cwd <path>] [--model-config <path>] [--symbols 002594,002384] [--output <path>] [--write-disposable-kb]')
  console.log('Runs the real company-research Runtime/API workflow in an isolated temporary Runtime and disposable Knowledge Base.')
  process.exit(0)
}
const option = (key: string): string | undefined => { const index = args.indexOf(key); return index < 0 ? undefined : args[index + 1] }
const cwd = resolve(option('--runtime-cwd') ?? process.cwd())
// Root-managed parser dependencies are runtime assets, independent of the imported checkout.
const managedPython = join(cwd, '.researchhub-document-parser', process.platform === 'win32' ? 'venv/Scripts/python.exe' : 'venv/bin/python')
try { await access(managedPython); process.env.RESEARCHHUB_PYTHON_EXECUTABLE ??= managedPython; process.env.RESEARCHHUB_DOCLING_ARTIFACTS_PATH ??= join(cwd, '.researchhub-document-parser/models') } catch { /* Runtime records parser unavailability; no installation or downgrade is performed here. */ }
const output = resolve(option('--output') ?? join(cwd, 'runtime-data', 'company-quality-acceptance', new Date().toISOString().replace(/[:.]/g, '-')))
const writeAcceptance = args.includes('--write-disposable-kb')
const symbols = (option('--symbols') ?? '002594,002384').split(',')
assert.ok(symbols.every((symbol) => ['002594', '002384'].includes(symbol)), 'Only the approved acceptance companies may run')
let selectedModel: {provider:string;modelId:string}|undefined
try {
  const modelConfigPath = resolve(option('--model-config') ?? join(cwd, 'runtime-data/application-settings.json'))
  const configured = JSON.parse(await readFile(modelConfigPath, 'utf8')) as {model?:unknown}
  if (configured.model && typeof configured.model === 'object' && typeof (configured.model as any).provider === 'string' && typeof (configured.model as any).modelId === 'string') selectedModel = {provider:(configured.model as any).provider,modelId:(configured.model as any).modelId}
} catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
assert.ok(selectedModel, 'ACCEPTANCE_MODEL_CONFIG_MISSING: pass --model-config with the existing Runtime model selection')
const kb = await mkdtemp(join(tmpdir(), 'researchhub-company-quality-'))
const disposableKnowledgeBaseId = `kb-company-quality-${Date.now()}`
// A saved user Knowledge Base selection in the project runtime settings must
// never override this test's disposable KB. Keep runtime settings and persisted
// reports in a separate temporary cwd, carrying only the configured model.
const isolatedRuntimeCwd = await mkdtemp(join(tmpdir(), 'researchhub-company-quality-runtime-'))
const isolatedRuntimeData = join(isolatedRuntimeCwd, 'runtime-data')
await mkdir(isolatedRuntimeData, { recursive: true })
await writeFile(join(isolatedRuntimeData, 'application-settings.json'), `${JSON.stringify({revision:0,...(selectedModel?{model:selectedModel}:{})},null,2)}\n`, 'utf8')
await createFreshKnowledgeBaseV04(kb, { knowledgeBaseId: disposableKnowledgeBaseId, name: 'Disposable company quality acceptance' })
await mkdir(output, { recursive: true })
const server = await createResearchHubRuntimeServer({ cwd: isolatedRuntimeCwd, clientRoot: fileURLToPath(new URL('../dist/client/', import.meta.url)), mountedKnowledgeBaseRoot: kb, port: 0, startDailyScheduler: false })
const { origin, runtimeToken } = server.address!
async function api(path: string, body?: unknown, timeoutMs = 60_000): Promise<any> {
  let response: Response
  try {
    response = await fetch(`${origin}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Origin: origin, 'x-researchhub-runtime-token': runtimeToken, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(timeoutMs) })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') throw new Error(`ACCEPTANCE_API_TIMEOUT:${path}:${timeoutMs}ms`)
    throw error
  }
  const result = await response.json(); if (!response.ok) throw new Error(`API_${response.status}:${path}:${JSON.stringify(result)}`); return result
}
async function save(name: string, value: unknown): Promise<void> { await writeFile(join(output, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`) }
const summaries: unknown[] = []
async function saveSummary(): Promise<void> { await save('summary', { generatedAt: new Date().toISOString(), executionClass: 'real Runtime/API and configured Pi model; no fixture providers', modelSelection: selectedModel ?? null, disposableKnowledgeBase: kb, writeAcceptance, cases: summaries }) }
function skipRemaining(symbol: string, reason: string): void { for (const skipped of symbols.slice(symbols.indexOf(symbol) + 1)) summaries.push({ symbol: skipped, status: 'not_started', reason }) }
try {
  const selectedRuntimeKnowledge = await api('/api/status')
  assert.equal(selectedRuntimeKnowledge.knowledgeBase?.knowledgeBaseId, disposableKnowledgeBaseId, 'Runtime must mount the fresh disposable KB, never the project-persisted user selection')
  console.log(JSON.stringify({ origin, output, modelSelection: selectedModel ?? null, disposableKnowledgeBase: kb, writeAcceptance }))
  for (const symbol of symbols) {
    const name = symbol === '002594' ? '比亚迪' : '东山精密'
    const before = await fingerprint(kb)
    const conversation = await api('/api/conversations/new', { name: 'Company quality acceptance' })
    console.log(JSON.stringify({ symbol, stage: 'dispatching' }))
    // Intent resolution can take two bounded reasoning calls before the
    // background workflow is accepted; do not abort it at the default 60s API
    // polling timeout when the configured model is slow but still progressing.
    const started = await api('/api/research/dispatch', { conversationId: conversation.conversationId, operationId: randomUUID(), query: `首次覆盖公司研究 ${name} ${symbol}：完整分析公司历史、产品技术、行业市场空间、竞争、财务质量、管理层及风险。`, mode: { type: 'workflow', workflowId: 'company_research' }, workflowArgumentContext: { workflowId: 'company_research', arguments: { symbol, name, exchange: 'SZ', maxSources: 50 } }, contextPolicy: { structuredKnowledge: true, sourceLibrary: false }, persistencePolicy: { writeKnowledge: writeAcceptance } }, 600_000)
    await save(`${symbol}-started`, started)
    if (started.status !== 'started') {
      const after = await fingerprint(kb)
      await save(`${symbol}-kb-integrity`, { mode: writeAcceptance ? 'disposable_write' : 'readonly', before, after, unchanged: JSON.stringify(before) === JSON.stringify(after) })
      summaries.push({ symbol, status: 'not_started', dispatchStatus: started.status, feedback: started.feedback, resolution: started.resolution, knowledgeUnchanged: JSON.stringify(before) === JSON.stringify(after) })
      skipRemaining(symbol, `TERMINAL_DISPATCH:${started.status}`)
      await saveSummary(); process.exitCode = 1; break
    }
    const deadline = Date.now() + 60 * 60_000
    let workflow: any
    while (Date.now() < deadline) {
      workflow = await api(`/api/workflows/${started.runId}`)
      await save(`${symbol}-workflow`, workflow)
      if (['completed', 'completed_with_review', 'blocked', 'failed', 'cancelled'].includes(workflow.status)) break
      console.log(JSON.stringify({ symbol, runId: started.runId, status: workflow.status, stage: workflow.stages?.find((item: any) => item.status === 'running')?.stageId }))
      await delay(15_000)
    }
    if (!['completed', 'completed_with_review', 'blocked', 'failed', 'cancelled'].includes(workflow?.status)) { await api('/api/workflows/cancel', { runId: started.runId }); throw new Error(`ACCEPTANCE_DEADLINE:${symbol}`) }
    const bundle = await api(`/api/research/bundles/by-run/${started.runId}`)
    await save(`${symbol}-bundle`, bundle)
    const reportList = await api('/api/research-reports?limit=100')
    const summary = reportList.reports.find((report: any) => report.workflowRunId === started.runId)
    const reportResponse = summary ? await api(`/api/research-reports/${summary.reportId}`) : undefined
    if (reportResponse) await save(`${symbol}-report`, reportResponse)
    const after = await fingerprint(kb)
    await save(`${symbol}-kb-integrity`, { mode: writeAcceptance ? 'disposable_write' : 'readonly', before, after, unchanged: JSON.stringify(before) === JSON.stringify(after) })
    const report = reportResponse?.report ?? reportResponse
    let analysis: any
    if (report?.outputPath) {
      try { analysis = JSON.parse(await readFile(resolve(isolatedRuntimeCwd, 'runtime-data/reports', report.outputPath.replace(/\.md$/, '.analysis.json')), 'utf8')); await save(`${symbol}-analysis`, analysis) } catch { /* Missing sidecar remains visible through report and workflow diagnostics. */ }
      try { const markdown = await readFile(resolve(isolatedRuntimeCwd, 'runtime-data/reports', report.outputPath), 'utf8'); await writeFile(join(output, `${symbol}-${basename(report.outputPath)}`), markdown, 'utf8') } catch { /* Report JSON remains available if the rendered Markdown is absent. */ }
    }
    const executionDiagnostics = { methods: analysis?.methodResults?.map((method: any) => method.diagnostics), review: analysis?.contentQuality?.semanticReview?.diagnostics ?? report?.researchQuality?.semanticReview?.diagnostics, synthesis: analysis?.synthesisDiagnostics, workflow: workflow?.errors, stages: workflow?.stages?.map((stage: any) => stage.diagnostics) }
    const quotaReached = /RATE_LIMIT_OR_QUOTA|usage limit has been reached|quota exceeded/i.test(JSON.stringify(executionDiagnostics))
    summaries.push({ symbol, runId: started.runId, status: workflow.status, reportId: summary?.reportId, researchQuality: report?.researchQuality, knowledgeIntegrityMode: writeAcceptance ? 'disposable_write' : 'readonly', knowledgeUnchanged: JSON.stringify(before) === JSON.stringify(after), ...(quotaReached ? { terminalReason: 'RATE_LIMIT_OR_QUOTA' } : {}) })
    await saveSummary()
    if (!writeAcceptance) assert.deepEqual(after, before, 'Readonly acceptance changed Knowledge Base files')
    if (writeAcceptance && report?.researchQuality?.passed) {
      assert.notDeepEqual(after, before, 'Disposable write acceptance produced no durable Knowledge changes')
      const resolutions = []
      for (const ref of [...report.subjectRefs ?? [], ...report.sourceRefs ?? [], ...report.claimRefs ?? []]) resolutions.push({ ref, value: await api(`/api/knowledge/object?ref=${encodeURIComponent(ref)}`) })
      await save(`${symbol}-knowledge-resolution`, resolutions)
      assert.ok(resolutions.length > 0, 'Write acceptance requires durable provenance references')
      await save(`${symbol}-raw-backed-verification`, await verifyCompanyResearchKnowledge(kb, report, symbol))
    }
    console.log(JSON.stringify(summaries.at(-1)))
    if (!report?.researchQuality?.passed) process.exitCode = 1
    if (quotaReached) { skipRemaining(symbol, 'RATE_LIMIT_OR_QUOTA'); await saveSummary(); break }
  }
} catch (error) {
  await save('failure', { generatedAt: new Date().toISOString(), message: error instanceof Error ? error.message : String(error), disposableKnowledgeBase: kb })
  await saveSummary()
  throw error
} finally {
  await server.close()
  // These roots were allocated by this invocation and are the only paths removed.
  await rm(isolatedRuntimeCwd, {recursive:true,force:true})
  await rm(kb, {recursive:true,force:true})
}
