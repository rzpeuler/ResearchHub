import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ResearchService } from '../app/services/research-service.ts'
import { ResearchDispatchService } from '../app/services/research-dispatch-service.ts'
import { FileResearchBundleStore } from '../app/services/research-bundle.ts'
import { SecurityIdentityResolver } from '../app/services/security-identity-resolver.ts'
import { WorkflowService } from '../app/services/workflow-service.ts'
import { createFreshKnowledgeBaseV04, readCanonicalV04Assets } from '../knowledge/storage/index.ts'
import { AkshareDataAdapter } from '../plugins/research-acquisition/akshare.ts'
import { createSecurityIdentityDataResolver } from '../plugins/research-acquisition/security-identity-data.ts'
import { CninfoOfficialDisclosureClient } from '../plugins/research-acquisition/official.ts'
import { createValuationDataResolver } from '../plugins/research-acquisition/valuation-data.ts'
import type { ReasoningCapabilities, ReasoningExecutor, ReasoningRequest, ReasoningResult } from '../plugins/reasoning/contracts.ts'

const rootPath = resolve(import.meta.dirname, '..')
const evidencePath = resolve(rootPath, 'tests/validation/evidence/RHL_EXEC_003_A_002_FIX_001_REAL_E2E.json')
const targets = [
  { symbol: '002487', exchange: 'SZSE', name: '大金重工' },
  { symbol: '600519', exchange: 'SSE', name: '贵州茅台' },
] as const
const generatedAt = new Date().toISOString()

class DeterministicNoPlanExecutor implements ReasoningExecutor {
  capabilities(): ReasoningCapabilities { return { maxContextTokens: 100_000, maxOutputTokens: 20_000, structuredOutputSupport: true, maxConcurrency: 2 } }
  async execute(request: ReasoningRequest): Promise<ReasoningResult> {
    if (request.operation === 'research_dispatch_decision') {
      const input = request.input as { workflowArgumentContext?: { arguments?: Record<string, unknown> }; contextPolicy?: unknown; persistencePolicy?: unknown }
      const args = input.workflowArgumentContext?.arguments ?? {}
      return { operation: request.operation, operationId: 'exec-003-a-002-fix-001-dispatch', output: { mode: 'workflow', workflow: { id: 'valuation', confidence: 1, arguments: args }, skills: [], entities: [], missingRequiredInputs: [], contextPolicy: input.contextPolicy, persistencePolicy: input.persistencePolicy, rationale: 'Explicit deterministic FIX-001 real-provider validation.' } }
    }
    return { operation: request.operation, operationId: 'exec-003-a-002-fix-001-no-plan', output: {} }
  }
}

async function runTarget(target: typeof targets[number]): Promise<Record<string, unknown>> {
  const root = await mkdtemp(join(tmpdir(), `rhl-exec-003-a-002-fix-001-${target.symbol}-`))
  const kbRoot = join(root, 'kb')
  const reportRoot = join(root, 'reports')
  const bundleRoot = join(root, 'bundles')
  const now = () => new Date().toISOString()
  const akshare = new AkshareDataAdapter({ timeoutMs: 60_000 })
  const cninfo = new CninfoOfficialDisclosureClient({ timeoutMs: 30_000 })
  const workflowService = new WorkflowService()
  try {
    await createFreshKnowledgeBaseV04(kbRoot, { knowledgeBaseId: `kb-exec-003-a-002-fix-001-${target.symbol}`, now: generatedAt })
    const before = await readCanonicalV04Assets(kbRoot)
    const securityIdentityResolver = new SecurityIdentityResolver({ mountedKnowledgeBaseRoot: kbRoot, dataResolverFactory: ({ now: clock, signal }) => createSecurityIdentityDataResolver({ akshare, now: clock, ...(signal ? { signal } : {}) }) })
    const researchService = new ResearchService({
      mountedKnowledgeBaseRoot: kbRoot,
      reportRoot,
      acquisitionPlugins: [],
      akshare,
      officialDisclosure: cninfo,
      workflowService,
      reasoningExecutor: new DeterministicNoPlanExecutor(),
      securityIdentityResolver,
      valuationDataResolverFactory: ({ company, valuationDate, asOf, now: clock, signal }) => createValuationDataResolver({ akshare, officialDisclosure: cninfo, company, valuationDate, ...(asOf ? { historicalAsOf: asOf } : {}), now: clock, ...(signal ? { signal } : {}) }),
    })
    const dispatch = new ResearchDispatchService({ researchService, workflowService, mountedKnowledgeBaseRoot: kbRoot, securityIdentityResolver, reasoningExecutor: new DeterministicNoPlanExecutor(), bundleStore: new FileResearchBundleStore(bundleRoot), clock: () => new Date() })
    const workflowArguments = { symbol: target.symbol, name: target.name, exchange: target.exchange }
    const started = await dispatch.startAsync({
      query: `当前 ${target.symbol} ${target.name} 估值`,
      mode: { type: 'workflow', workflowId: 'valuation' },
      workflowArgumentContext: { workflowId: 'valuation', arguments: workflowArguments },
      contextPolicy: { structuredKnowledge: true, sourceLibrary: false },
      persistencePolicy: { writeKnowledge: false },
    })
    if (started.status !== 'started' || !started.runId || !started.completion) throw new Error(`dispatch did not start: ${started.status}; feedback=${JSON.stringify(started.feedback ?? null)}; diagnostics=${JSON.stringify(started.resolution?.diagnostics ?? [])}`)
    const workflowResult = await started.completion as Record<string, unknown>
    const bundle = await dispatch.getBundleForRun(started.runId)
    const reportNames = await readdir(reportRoot).catch(() => [])
    const jsonName = reportNames.find((name) => name.endsWith('.md.json'))
    if (!jsonName) throw new Error(`valuation JSON report was not persisted; status=${String(workflowResult.status ?? 'unknown')}; blockedReason=${String(workflowResult.blockedReason ?? 'none')}; errorSummary=${String(workflowResult.errorSummary ?? 'none')}; diagnostics=${JSON.stringify(workflowResult.diagnostics ?? [])}; providerOutcome=${JSON.stringify(workflowResult.providerOutcome ?? {})}`)
    const json = JSON.parse(await readFile(join(reportRoot, jsonName), 'utf8')) as { workflowRunId?: string; reportType?: string; sections?: Array<{ id?: string; title?: string; markdown?: string; evidenceLinks?: string[] }>; sourceRefs?: string[]; claimRefs?: string[] }
    const markdown = await readFile(join(reportRoot, jsonName.replace(/\.json$/, '')), 'utf8')
    const after = await readCanonicalV04Assets(kbRoot)
    const section = (id: string) => json.sections?.find((item) => item.id === id)?.markdown ?? ''
    const excerpt = ['valuation-snapshot', 'data-basis-point-in-time-status', 'fy-based-reference-multiples'].map((id) => section(id)).filter(Boolean).join('\n\n')
    const sourceRefs = json.sourceRefs ?? []
    const claimRefs = json.claimRefs ?? []
    const links = (json.sections ?? []).flatMap((item) => item.evidenceLinks ?? [])
    const result = {
      symbol: target.symbol,
      requestedName: target.name,
      dispatchStatus: started.status,
      runId: started.runId,
      workflowStatus: workflowResult.status ?? null,
      reportId: jsonName.replace(/\.md\.json$/, ''),
      reportType: json.reportType ?? null,
      jsonReloaded: json.workflowRunId === started.runId,
      markdownReloaded: markdown.includes(`Workflow Run: ${started.runId}`) || markdown.includes(started.runId),
      bundleId: bundle?.bundleId ?? null,
      bundleRunId: bundle?.workflowRunId ?? null,
      bundleMatchesRun: bundle?.workflowRunId === started.runId,
      canonicalBefore: { entities: before.objects.filter((item) => item.kind === 'entity').length, sources: before.objects.filter((item) => item.kind === 'source').length, claims: before.objects.filter((item) => item.kind === 'claim').length },
      canonicalAfter: { entities: after.objects.filter((item) => item.kind === 'entity').length, sources: after.objects.filter((item) => item.kind === 'source').length, claims: after.objects.filter((item) => item.kind === 'claim').length },
      noCanonicalWrites: before.objects.length === after.objects.length,
      sourceRefs,
      claimRefs,
      externalEvidenceLinks: links,
      reportExcerpts: excerpt,
      diagnostics: Array.isArray(workflowResult.diagnostics) ? workflowResult.diagnostics : [],
      providerOutcome: workflowResult.providerOutcome ?? null,
    }
    assert.equal(result.jsonReloaded, true, 'JSON report reload should preserve runId')
    assert.equal(result.bundleMatchesRun, true, 'ResearchBundle runId should match Application runId')
    assert.equal(result.noCanonicalWrites, true, 'writeKnowledge=false must leave canonical objects unchanged')
    assert.equal(result.sourceRefs.length + result.claimRefs.length, 0, 'read-only report must not invent canonical references')
    assert.equal(json.reportType, 'valuation', 'persisted report should remain a Valuation report')
    assert.ok(excerpt.includes(`Verified company name: ${target.name}.`), 'report should retain the externally verified company name')
    assert.ok(excerpt.includes(`${target.symbol}.`), 'report should retain the verified ticker')
    for (const field of ['Selected market close:', 'Market publisher: Tencent;', 'Market freshness: FRESH;', 'FY2025', 'EPS:', 'BVPS:', 'Official annual report:', 'publisher: EastMoney', 'PIT classification: CURRENT_VALUE_ONLY', 'numeric value-version status: UNVERIFIED', 'Current PE:', 'current PB:']) {
      assert.ok(excerpt.includes(field), `report should retain required valuation evidence: ${field}`)
    }
    assert.ok(links.length > 0 && links.every((url) => /^https:\/\//i.test(url)), 'report should retain valid external HTTPS evidence links')
    assert.ok(markdown.includes('Market publisher: Tencent') && markdown.includes('Official annual report:'), 'Markdown reload should retain market attribution and official publication evidence')
    return result
  } catch (error) {
    return { symbol: target.symbol, requestedName: target.name, status: 'REAL_SOURCE_ATTEMPT_FAILED', error: (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, 1000) }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  const reports = []
  for (const target of targets) reports.push(await runTarget(target))
  const evidence = { taskId: 'RHL-EXEC-003-A-002-FIX-001', generatedAt, execution: 'ResearchDispatchService.startAsync -> ResearchService -> Valuation Workflow -> DataResolver -> Industry Catalog/SourcePolicy -> AKShare Plugin + CNINFO -> Skill -> ResearchReport/ResearchBundle', reports, secretsIncluded: false, rawProviderBodiesIncluded: false }
  await mkdir(resolve(evidencePath, '..'), { recursive: true })
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(evidence, null, 2))
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
