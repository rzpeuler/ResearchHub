import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createFreshKnowledgeBaseV04, readCanonicalV04Assets } from '../../knowledge/storage/index.ts'
import { KnowledgeBaseRegistry } from '../../knowledge/registry/registry.ts'
import { verifyRaw } from '../../knowledge/raw/raw-archive.ts'
import { CninfoOfficialDisclosureClient, OfficialDisclosureResearchPlugin } from '../../plugins/research-acquisition/official.ts'
import { GdeltResearchPlugin } from '../../plugins/research-acquisition/gdelt.ts'
import { AkshareDataAdapter } from '../../plugins/research-acquisition/akshare.ts'
import { FileResearchSignalStore } from '../../plugins/research-acquisition/signal-store.ts'
import { runCompanyDeepResearch } from '../../workflows/company-deep-research/workflow.ts'
import type { ResearchProviderOutcome } from '../../plugins/research-acquisition/contracts.ts'
import { createCompanyResearchDataResolver } from '../../plugins/research-acquisition/company-research-data.ts'

if (process.env.RESEARCHHUB_PHASE3_LIVE !== '1') {
  console.log(JSON.stringify({ status: 'SKIPPED', reason: 'Set RESEARCHHUB_PHASE3_LIVE=1 to opt in; no network or Knowledge writes were performed.' }))
  process.exit(0)
}

const smokeId = new Date().toISOString().replace(/[:.]/g, '-')
const root = resolve('runtime-data', `personal-research-real-smoke-${smokeId}`, 'kb')
const reportRoot = resolve('runtime-data', `personal-research-real-smoke-${smokeId}`, 'reports')
const signalPath = resolve('runtime-data', `personal-research-real-smoke-${smokeId}`, 'signals.jsonl')
const now = () => '2026-09-08T23:59:59.000Z'
const providers = [new OfficialDisclosureResearchPlugin(new CninfoOfficialDisclosureClient()), new GdeltResearchPlugin()]
await mkdir(reportRoot, { recursive: true })
await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-real-smoke-personal-v1', name: 'Personal Research real-network smoke', now: now() })
const runs = [
  { workflowRunId: 'real-smoke-600519-1', symbol: '600519', name: '贵州茅台', exchange: 'SSE' },
  { workflowRunId: 'real-smoke-000858-1', symbol: '000858', name: '五粮液', exchange: 'SZSE' },
  { workflowRunId: 'real-smoke-600519-2', symbol: '600519', name: '贵州茅台', exchange: 'SSE' },
] as const
const results: Array<{ workflowRunId: string; symbol: string; status: string; beforeRevision: number; afterRevision?: number; reportId: string | null; committedIds: readonly string[]; updatedIds: readonly string[]; sourceCount: number; claimCount: number; errors: readonly string[]; acquisitionDiagnostics: readonly unknown[]; providerOutcomes: readonly ResearchProviderOutcome[]; resolutionIntents: readonly unknown[] }> = []
for (const request of runs) {
  const handle = await new KnowledgeBaseRegistry().mount(root)
  const beforeRevision = handle.revision
  const result = await runCompanyDeepResearch({ workflowRunId: request.workflowRunId, handle, company: request, dataResolverFactory: (options) => createCompanyResearchDataResolver({ ...options, akshare: new AkshareDataAdapter(), officialDisclosure: providers.find((plugin) => /official|cninfo/i.test(plugin.name)), gdelt: providers.find((plugin) => /gdelt/i.test(plugin.name)) }), reportRoot, signalStore: new FileResearchSignalStore(signalPath), maxSources: 6, now })
  results.push({ workflowRunId: request.workflowRunId, symbol: request.symbol, status: result.status, beforeRevision, afterRevision: result.knowledgeBaseRevision, reportId: result.report?.reportId ?? null, committedIds: result.committedIds, updatedIds: result.updatedIds ?? [], sourceCount: result.sourceIds.length, claimCount: result.claimIds.length, errors: result.errors, acquisitionDiagnostics: result.acquisitionDiagnostics ?? [], providerOutcomes: result.providerOutcomes ?? [], resolutionIntents: (result.resolutionIntents ?? []).map((item) => ({ disposition: item.disposition, reason: item.reason, proposalId: item.proposalId ?? null, localKey: item.localKey ?? null })) })
}
const assets = await readCanonicalV04Assets(root)
const finalHandle = await new KnowledgeBaseRegistry().mount(root)
const sources = assets.objects.filter((item) => item.kind === 'source').map((item) => { const value = item.value as { id: string; provider?: string | null; sourceType?: string; contentHash?: string | null; rawRefs?: readonly string[] }; return { id: value.id, provider: value.provider ?? null, sourceType: value.sourceType ?? null, contentHash: value.contentHash ?? null, rawRefs: value.rawRefs ?? [] } })
const rawIntegrity = []
for (const source of sources) for (const rawRef of source.rawRefs) { const verification = await verifyRaw(finalHandle, rawRef); rawIntegrity.push({ rawRef, valid: verification.valid, contentHash: verification.contentHash, sizeBytes: verification.sizeBytes }) }
const providerOutcomes = ['cninfo', 'gdelt', 'akshare'].map((provider) => { const outcomes = results.flatMap((result) => result.providerOutcomes).filter((outcome) => outcome.provider === provider); return { provider, providerAttempted: outcomes.some((outcome) => outcome.providerAttempted), providerSucceeded: outcomes.some((outcome) => outcome.providerSucceeded), providerEmpty: outcomes.some((outcome) => outcome.providerEmpty), providerFailed: outcomes.some((outcome) => outcome.providerFailed), usableSourceCount: outcomes.reduce((sum, outcome) => sum + outcome.usableSourceCount, 0) } })
const evidence = { generatedAt: new Date().toISOString(), scenario: 'real-network multi-run company research', providersAttempted: ['cninfo', 'gdelt', 'akshare'], providerOutcomes, runs: results, final: { knowledgeBaseRevision: finalHandle.revision, canonicalCounts: { entities: assets.objects.filter((item) => item.kind === 'entity').length, sources: assets.objects.filter((item) => item.kind === 'source').length, claims: assets.objects.filter((item) => item.kind === 'claim').length }, sources, rawIntegrity } }
const evidencePath = join(reportRoot, 'smoke-evidence.json')
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ ...evidence, evidencePath }, null, 2))
