import { join } from 'node:path'
import { getAgentDir, ModelRuntime } from '@earendil-works/pi-coding-agent'
import { loadKnowledgeBaseManifest } from '../knowledge/storage/manifest-loader.ts'
import { KnowledgeBaseRegistry } from '../knowledge/registry/registry.ts'
import { readCanonicalV04Assets } from '../knowledge/storage/canonical-v04-loader.ts'
import { getRaw, verifyRaw } from '../knowledge/raw/raw-archive.ts'
import { PiReasoningExecutor } from '../plugins/reasoning/pi/executor.ts'
import { selectProductionReasoningModel, createThemeFrameworkProductionReasoningExecutor } from '../app/pi/model-selection.ts'
import { ThemeFrameworkService } from '../app/services/theme-framework-service.ts'
import { WorkflowService } from '../app/services/workflow-service.ts'
import type { ReasoningExecutor } from '../plugins/reasoning/contracts.ts'

const root = 'C:/Users/Administrator/Desktop/ResearchHubData/knowledge-bases/ai-compute-theme-v04-verified'
const manifest = await loadKnowledgeBaseManifest(root)
if (manifest.knowledgeBaseId !== 'kb-ai-compute-theme-v04-verified' || manifest.schemaVersion !== '0.4' || manifest.revision !== 2 || manifest.status !== 'active') throw new Error('kb_preflight_mismatch')
const registry = new KnowledgeBaseRegistry()
const handle = await registry.mount(root)
const assets = await readCanonicalV04Assets(root)
const sources = assets.objects.filter((x) => x.kind === 'source').map((x) => x.value)
const targetSources = sources.filter((source) => `${source.title} ${source.publisher ?? ''}`.includes('西部证券'))
if (targetSources.length === 0) throw new Error('west_securities_source_missing')
const rawChecks = []
for (const source of targetSources) {
  for (const rawRef of source.rawRefs ?? []) {
    const raw = await getRaw(handle, rawRef)
    const verified = await verifyRaw(handle, rawRef)
    if (!verified.valid || raw.manifest.sizeBytes > 8_000_000) throw new Error('target_raw_not_verified_or_over_size')
    rawChecks.push({ sourceRef: source.id, rawRef, sizeBytes: raw.manifest.sizeBytes })
  }
}
const modelRuntime = await ModelRuntime.create({ authPath: join(getAgentDir(), 'auth.json'), modelsPath: join(getAgentDir(), 'models.json'), allowModelNetwork: false, refreshOnCreate: false })
try {
  const model = selectProductionReasoningModel(modelRuntime)
  const base = new PiReasoningExecutor({ modelRuntime, model })
  const production = await createThemeFrameworkProductionReasoningExecutor({ capabilities: base.capabilities() })
  const metadata = production.runtimeMetadata()
  const noCall: ReasoningExecutor = { capabilities: () => base.capabilities(), execute: async () => { throw new Error('preflight_must_not_call_model') } }
  const service = new ThemeFrameworkService({ mountedKnowledgeBaseRoot: root, registry, workflowService: new WorkflowService(), reasoningExecutor: noCall })
  const snapshot = await (service as any).readKnowledgeSnapshot('AI 算力')
  const bindings = new Map(snapshot.durableEvidenceBindings.map((binding: any) => [binding.evidenceId, binding]))
  if (snapshot.evidence.length > 48) throw new Error('existing_evidence_over_48')
  const body = snapshot.evidence.filter((item: any) => item.origin === 'existing_kb' && typeof item.excerpt === 'string')
  const targetRefs = new Set(targetSources.map((source) => source.id))
  const targetBody = body.filter((item: any) => targetRefs.has(item.sourceRef))
  if (targetBody.length < 2) throw new Error('west_securities_body_evidence_below_minimum')
  const excerpts = targetBody.map((item: any) => {
    const binding = bindings.get(item.evidenceId) as any
    const blockMatch = item.description.match(/block=([^;]+); page=([^;]+); section=([^\n]+)/u)
    if (!binding || binding.locator !== blockMatch?.[1] || binding.rawRef == null) throw new Error('body_locator_binding_mismatch')
    return { evidenceId: item.evidenceId, blockId: binding.locator, page: blockMatch?.[2] ?? 'unknown', section: blockMatch?.[3] ?? 'unlabeled', characters: item.excerpt.length, sourceRef: item.sourceRef }
  })
  if (!excerpts.every((item: any) => targetSources.some((source) => source.id === item.sourceRef && (source.rawRefs ?? []).includes((bindings.get(item.evidenceId) as any).rawRef)))) throw new Error('body_source_raw_binding_mismatch')
  console.log(JSON.stringify({ stage: 'preflight_ready', kb: { id: manifest.knowledgeBaseId, revision: manifest.revision, schemaVersion: manifest.schemaVersion }, totalEvidence: snapshot.evidence.length, existingKbEvidence: snapshot.evidence.filter((item: any) => item.origin === 'existing_kb').length, bodyEvidenceCount: body.length, westSecuritiesSources: targetSources.map((source) => ({ sourceRef: source.id, title: source.title, publisher: source.publisher ?? null })), verifiedRaws: rawChecks, targetBodyExcerpts: excerpts, modelMetadata: metadata }))
} finally {
  ;(modelRuntime as any).dispose?.()
}
