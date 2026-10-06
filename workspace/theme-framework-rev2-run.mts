import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { access } from 'node:fs/promises'
import { getAgentDir, ModelRuntime } from '@earendil-works/pi-coding-agent'
import { loadKnowledgeBaseManifest } from '../knowledge/storage/manifest-loader.ts'
import { readCanonicalV04Assets } from '../knowledge/storage/canonical-v04-loader.ts'
import { KnowledgeBaseRegistry } from '../knowledge/registry/registry.ts'
import { PiReasoningExecutor } from '../plugins/reasoning/pi/executor.ts'
import { selectProductionReasoningModel, createThemeFrameworkProductionReasoningExecutor } from '../app/pi/model-selection.ts'
import { ThemeFrameworkService } from '../app/services/theme-framework-service.ts'
import { WorkflowService } from '../app/services/workflow-service.ts'
import { ThemeFrameworkAcquisitionAdapter } from '../plugins/research-acquisition/theme-framework-acquisition.ts'
import { AkshareDataAdapter } from '../plugins/research-acquisition/akshare.ts'
import { AkshareIndustryResearchPlugin } from '../plugins/research-acquisition/industry.ts'
import { EastmoneyIndustryResearchPlugin } from '../plugins/research-acquisition/eastmoney-industry.ts'
import { GovCnIndustryResearchPlugin } from '../plugins/research-acquisition/govcn-industry.ts'
import { MiitIndustryResearchPlugin } from '../plugins/research-acquisition/miit-industry.ts'
import { CpcaIndustryResearchPlugin } from '../plugins/research-acquisition/cpca-industry.ts'
import type { ReasoningExecutor } from '../plugins/reasoning/contracts.ts'

const root = 'C:/Users/Administrator/Desktop/ResearchHubData/knowledge-bases/ai-compute-theme-v04-verified'
const runId = `tf-ai-compute-20261003-${randomUUID()}`
const startedAt = Date.now()
const say = (stage: string, fields: Record<string, unknown> = {}) => process.stdout.write(`${JSON.stringify({ runId, stage, elapsedMs: Date.now() - startedAt, ...fields })}\n`)
let modelRuntime: ModelRuntime | undefined
let modelCalls = 0
try {
  say('preflight_started')
  const before = await loadKnowledgeBaseManifest(root)
  if (before.knowledgeBaseId !== 'kb-ai-compute-theme-v04-verified' || before.schemaVersion !== '0.4' || before.revision !== 2 || before.status !== 'active') throw Object.assign(new Error(), { code: 'kb_revision_preflight_mismatch' })
  const registry = new KnowledgeBaseRegistry()
  modelRuntime = await ModelRuntime.create({ authPath: join(getAgentDir(), 'auth.json'), modelsPath: join(getAgentDir(), 'models.json'), allowModelNetwork: false, refreshOnCreate: false })
  const model = selectProductionReasoningModel(modelRuntime)
  const capabilityOwner = new PiReasoningExecutor({ modelRuntime, model })
  const delegate = await createThemeFrameworkProductionReasoningExecutor({ capabilities: capabilityOwner.capabilities() })
  const modelMetadata = delegate.runtimeMetadata()
  if (modelMetadata.requestedModel !== 'gpt-6-luna' || modelMetadata.requestedReasoningEffort !== 'high') throw Object.assign(new Error(), { code: 'production_model_metadata_mismatch' })

  const targetAssets = await readCanonicalV04Assets(root)
  const targetSources = targetAssets.objects.filter((item) => item.kind === 'source').map((item) => item.value)
    .filter((source) => `${source.title} ${source.publisher ?? ''}`.includes('西部证券'))
  if (targetSources.length === 0) throw Object.assign(new Error(), { code: 'west_securities_source_missing' })
  const targetRefs = new Set(targetSources.map((source) => source.id))
  let actualGate: Record<string, unknown> | undefined
  const guardedExecutor: ReasoningExecutor = {
    capabilities: () => delegate.capabilities(),
    execute: async (request, signal) => {
      const input = request.input as any
      const evidence = Array.isArray(input?.evidence) ? input.evidence : []
      const existing = evidence.filter((item: any) => item?.origin === 'existing_kb')
      const body = existing.filter((item: any) => targetRefs.has(item?.sourceRef) && typeof item?.excerpt === 'string' && item.excerpt.length > 0)
      const locators = body.map((item: any) => {
        const match = typeof item.description === 'string' ? item.description.match(/block=([^;]+); page=([^;]+);/u) : null
        return { evidenceId: item.evidenceId, sourceRef: item.sourceRef, blockId: match?.[1] ?? null, page: match?.[2] ?? null, characters: item.excerpt.length }
      })
      if (evidence.length > 48 || existing.length > 48 || body.length < 2 || locators.some((item: any) => !item.blockId || !item.page)) {
        throw Object.assign(new Error(), { code: 'pre_model_evidence_gate_failed' })
      }
      if (modelCalls >= 1) throw Object.assign(new Error(), { code: 'single_model_call_limit_reached' })
      actualGate = { totalEvidence: evidence.length, existingKbEvidence: existing.length, westSecuritiesBodyExcerptCount: body.length, excerpts: locators }
      modelCalls += 1
      say('model_call_started', { modelCalls, operation: request.operation, modelMetadata, evidenceGate: actualGate })
      try {
        const result = await delegate.execute(request, signal)
        say('model_call_completed', { modelCalls, elapsedMs: Date.now() - startedAt })
        return result
      } catch (error) {
        const code = typeof (error as any)?.code === 'string' ? (error as any).code : 'executor_error'
        say('model_call_failed', { modelCalls, errorCode: code })
        throw error
      }
    },
  }
  const workflowService = new WorkflowService()
  const akshare = new AkshareDataAdapter()
  const acquisition = new ThemeFrameworkAcquisitionAdapter({ knowledgeBaseRoot: root, plugins: [new MiitIndustryResearchPlugin(), new GovCnIndustryResearchPlugin(), new EastmoneyIndustryResearchPlugin(), new CpcaIndustryResearchPlugin(), new AkshareIndustryResearchPlugin(akshare)] })
  const service = new ThemeFrameworkService({ mountedKnowledgeBaseRoot: root, workflowService, reasoningExecutor: guardedExecutor, acquisition, registry })
  const preflightSnapshot = await (service as any).readKnowledgeSnapshot('AI 算力')
  const preflightExisting = preflightSnapshot.evidence.filter((item: any) => item.origin === 'existing_kb')
  const preflightBody = preflightExisting.filter((item: any) => targetRefs.has(item.sourceRef) && typeof item.excerpt === 'string' && item.excerpt.length > 0)
  if (preflightSnapshot.revision !== 2 || preflightSnapshot.evidence.length > 48 || preflightExisting.length > 48 || preflightBody.length < 2) throw Object.assign(new Error(), { code: 'pre_model_snapshot_gate_failed' })
  const snapshotBindings = new Map(preflightSnapshot.durableEvidenceBindings.map((binding: any) => [binding.evidenceId, binding]))
  const preflightLocators = preflightBody.map((item: any) => {
    const binding = snapshotBindings.get(item.evidenceId) as any
    const match = item.description.match(/block=([^;]+); page=([^;]+);/u)
    if (!binding || binding.locator !== match?.[1] || !targetSources.some((source) => source.id === item.sourceRef && source.rawRefs?.includes(binding.rawRef))) throw Object.assign(new Error(), { code: 'pre_model_locator_binding_mismatch' })
    return { evidenceId: item.evidenceId, blockId: binding.locator, page: match?.[2] ?? 'unknown', characters: item.excerpt.length, sourceRef: item.sourceRef }
  })
  const reviewPath = join(root, 'logs', 'theme-framework', 'reviews', `${runId}.candidate.json`)
  try { await access(reviewPath); throw Object.assign(new Error(), { code: 'run_id_collision' }) } catch (error) { if ((error as any)?.code !== 'ENOENT') throw error }
  say('preflight_ready', { kb: { id: before.knowledgeBaseId, revision: before.revision }, totalEvidence: preflightSnapshot.evidence.length, existingKbEvidence: preflightExisting.length, westSecuritiesBodyExcerptCount: preflightBody.length, westSecuritiesExcerpts: preflightLocators, modelMetadata })

  const run = service.start({ workflowRunId: runId, name: 'AI 算力' })
  say('workflow_started', { kbRevisionBefore: before.revision, modelMetadata })
  const heartbeat = setInterval(() => {
    const status = workflowService.getWorkflowStatus(runId)
    say('workflow_wait', { status: status?.status ?? 'unknown', progress: status?.progressSummary ?? 'not_reported', modelCalls })
  }, 30_000)
  let completion: any
  try { completion = await run.completion } finally { clearInterval(heartbeat) }
  say('workflow_completed', { completionStatus: completion.status, workflowStatus: workflowService.getWorkflowStatus(runId)?.status, diagnostics: completion.diagnostics ?? [], modelCalls })
  const review = await service.getReviewCandidate(runId)
  const after = await loadKnowledgeBaseManifest(root)
  const assetsAfter = await readCanonicalV04Assets(root)
  const evidenceMeta = new Map((review.candidate?.evidence ?? []).map((item: any) => [item.evidenceId, item]))
  const bindings = new Map((review.candidate?.durableEvidenceBindings ?? []).map((binding: any) => [binding.evidenceId, binding]))
  const evidenceInfo = (refs: string[]) => refs.map((evidenceId) => {
    const item = evidenceMeta.get(evidenceId) as any
    const binding = bindings.get(evidenceId) as any
    const bodyMatch = item?.summary?.match(/block=([^;]+); page=([^;]+);/u)
    return { evidenceId, sourceRef: item?.sourceRef ?? binding?.sourceRef ?? null, kind: bodyMatch ? 'body_excerpt' : 'source_title', blockId: binding?.locator && binding.locator !== 'retained source document' ? binding.locator : null, page: bodyMatch?.[2] ?? null }
  })
  if (!review.candidate) {
    say('review_candidate_absent', { reviewStatus: review.status, kbRevisionAfter: after.revision, modelCalls, canonicalThemeCount: assetsAfter.objects.filter((item) => item.kind === 'entity' && (item.value as any).type === 'investment_theme').length })
  } else {
    const candidate = review.candidate
    const framework = candidate.framework
    const industries = framework.industryCandidates.map((item: any) => ({ candidateId: item.candidateId, name: item.name, recommendation: item.recommendation, sourceIndustryRef: item.sourceIndustryRef ?? null, existingIndustryRef: item.existingIndustryRef ?? null, rationale: String(item.boundaryRationale ?? '').slice(0, 300), relevance: String(item.themeRelevanceRationale ?? '').slice(0, 300), evidence: evidenceInfo(item.evidenceRefs ?? []), coverageGaps: item.coverageGaps ?? [] }))
    const relations = framework.relationCandidates.map((item: any) => ({ candidateId: item.candidateId, sourceIndustryRef: item.sourceIndustryRef, targetIndustryRef: item.targetIndustryRef, relationType: item.relationType, recommendation: item.recommendation, rationale: String(item.boundaryRationale ?? '').slice(0, 300), evidence: evidenceInfo(item.evidenceRefs ?? []), coverageGaps: item.coverageGaps ?? [] }))
    say('review_candidate_persisted', { reviewStatus: review.status, kb: { id: candidate.knowledgeBaseId, basedOnRevision: candidate.basedOnRevision, revisionAfter: after.revision }, theme: candidate.theme, modelMetadata, modelCalls, acquisitionStatus: candidate.acquisitionStatus, industryCount: industries.length, relationCount: relations.length, proposedDefinition: framework.proposedDefinition, overallCoverageGaps: framework.coverageGaps, industries, relations, evidenceCatalogCount: candidate.evidence.length, canonicalCounts: Object.fromEntries(['entity', 'relation', 'source'].map((kind) => [kind, assetsAfter.objects.filter((item) => item.kind === kind).length])) })
  }
} catch (error) {
  const code = typeof (error as any)?.code === 'string' ? (error as any).code : 'workflow_execution_error'
  say('run_failed', { errorCode: code, modelCalls, evidenceGate: actualGate ?? null })
} finally {
  if (modelRuntime) await (modelRuntime as any).dispose?.()
}
