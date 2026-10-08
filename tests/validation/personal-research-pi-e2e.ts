import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ModelRuntime, getAgentDir } from '@earendil-works/pi-coding-agent'
import type { Api, Model } from '@earendil-works/pi-ai'
import { PiReasoningExecutor } from '../../plugins/reasoning/pi/executor.ts'
import { selectProductionReasoningModel } from '../../app/pi/model-selection.ts'
import { createFreshKnowledgeBaseV04, readCanonicalV04Assets } from '../../knowledge/storage/index.ts'
import { KnowledgeBaseRegistry } from '../../knowledge/registry/registry.ts'
import { runCompanyDeepResearch } from '../../workflows/company-deep-research/workflow.ts'
import type { ResearchAcquisitionPlugin } from '../../plugins/research-acquisition/contracts.ts'
import { sha256 } from '../../plugins/research-acquisition/hash.ts'
import { createCompanyResearchDataResolver } from '../../plugins/research-acquisition/company-research-data.ts'

if (process.env.RESEARCHHUB_PHASE3_LIVE !== '1') {
  console.log(JSON.stringify({ status: 'SKIPPED', reason: 'Set RESEARCHHUB_PHASE3_LIVE=1 to opt in; no network or Knowledge writes were performed.' }))
  process.exit(0)
}

const runId = `pi-e2e-${new Date().toISOString().replace(/[:.]/g, '-')}`
const root = await mkdtemp(join(tmpdir(), 'rhl-personal-pi-e2e-'))
const reports = join(root, 'reports')
const evidencePath = join(root, 'evidence.json')
const sourceText = '贵州茅台（600519）reported stable premium spirits demand, resilient gross margin, and continued investment in channel quality.'
const plugin: ResearchAcquisitionPlugin = { name: 'fixture-official', discover: async () => [{ candidateId: 'pi-fixture-600519', kind: 'official_disclosure', tier: 1, title: 'Official retained fixture', provider: 'cninfo', publishedAt: '2026-09-07T00:00:00.000Z', metadata: { companySymbol: '600519', fixture: true } }], fetch: async (candidate) => ({ candidate, retrievedAt: '2026-09-08T00:00:00.000Z', content: sourceText, contentHash: sha256(sourceText) }), normalize: async (fetched) => ({ candidate: fetched.candidate, retrievedAt: fetched.retrievedAt, title: fetched.candidate.title, content: fetched.content, contentHash: fetched.contentHash!, publisher: fetched.candidate.provider, rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false } }) }

let modelRuntime: ModelRuntime | undefined
try {
  await mkdir(reports, { recursive: true })
  modelRuntime = await ModelRuntime.create({ authPath: join(getAgentDir(), 'auth.json'), modelsPath: join(getAgentDir(), 'models.json'), allowModelNetwork: true, refreshOnCreate: false })
  const model = selectProductionReasoningModel(modelRuntime)
  const executor = new PiReasoningExecutor({ modelRuntime, model: model as Model<Api>, timeoutMs: 900_000, maxOutputChars: 400_000 })
  const kbRoot = join(root, 'kb'); await createFreshKnowledgeBaseV04(kbRoot, { knowledgeBaseId: 'kb-personal-pi-e2e', now: '2026-09-08T23:59:59.000Z' })
  const result = await runCompanyDeepResearch({ workflowRunId: runId, handle: await new KnowledgeBaseRegistry().mount(kbRoot), company: { symbol: '600519', name: '贵州茅台' }, dataResolverFactory: (options) => createCompanyResearchDataResolver({ ...options, officialDisclosure: plugin }), reportRoot: reports, reasoningExecutor: executor, now: () => '2026-09-08T23:59:59.000Z' })
  const assets = await readCanonicalV04Assets(kbRoot)
  const report = result.report ? JSON.parse(await readFile(join(reports, `${result.report.reportId}.md.json`), 'utf8')) as { sections?: unknown[] } : undefined
  const evidence = { classification: result.status === 'completed' ? 'EXECUTED' : 'PRODUCT_OR_ENVIRONMENT_BLOCKED', host: executor.runtimeMetadata(), operation: 'company_research_synthesis', realPiReasoningExecutor: true, run: { status: result.status, reportId: result.report?.reportId ?? null, sections: report?.sections?.length ?? 0, proposalCount: result.proposalIds.length, claimCount: result.claimIds.length, knowledgeRevision: result.knowledgeBaseRevision, errors: result.errors }, canonicalCounts: { entities: assets.objects.filter((item) => item.kind === 'entity').length, sources: assets.objects.filter((item) => item.kind === 'source').length, claims: assets.objects.filter((item) => item.kind === 'claim').length, relations: assets.objects.filter((item) => item.kind === 'relation').length }, secretsIncluded: false, rawBodiesIncluded: false }
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8'); console.log(JSON.stringify(evidence, null, 2))
  if (result.status !== 'completed' || (report?.sections?.length ?? 0) !== 19 || result.claimIds.length < 1) process.exitCode = 1
} catch (error) {
  const evidence = { classification: 'ENVIRONMENT_BLOCKED', realPiReasoningExecutor: true, operation: 'company_research_synthesis', error: error instanceof Error ? error.message : String(error), secretsIncluded: false, rawBodiesIncluded: false }
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8'); console.error(JSON.stringify(evidence, null, 2)); process.exitCode = 1
} finally {
  if (modelRuntime) await Promise.resolve((modelRuntime as unknown as { dispose?: () => void | Promise<void> }).dispose?.()).catch(() => undefined)
  await rm(root, { recursive: true, force: true })
}
