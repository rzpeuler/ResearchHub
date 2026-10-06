import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { access, readFile } from 'node:fs/promises'
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
import { RawDocumentKnowledgeGatewayV04 } from '../knowledge/production/raw-document-gateway-v04.ts'
import { verifyRaw } from '../knowledge/raw/raw-archive.ts'
import type { ReasoningExecutor } from '../plugins/reasoning/contracts.ts'

const root = 'C:/Users/Administrator/Desktop/ResearchHubData/knowledge-bases/ai-compute-theme-v04-verified'
const previousRunId = 'tf-ai-compute-20261003-931745f8-e81e-4741-9ea3-825a5e6e2da7'
const runId = `tf-ai-compute-20261003-${randomUUID()}`
const startedAt = Date.now()
const say = (stage: string, fields: Record<string, unknown> = {}) => process.stdout.write(`${JSON.stringify({ runId, stage, elapsedMs: Date.now() - startedAt, ...fields })}\n`)
let modelRuntime: ModelRuntime | undefined
let modelCalls = 0
let gatewayStatuses: string[] = []
let actualGate: Record<string, unknown> | undefined
try {
  say('preflight_started')
  const before = await loadKnowledgeBaseManifest(root)
  if (before.knowledgeBaseId !== 'kb-ai-compute-theme-v04-verified' || before.schemaVersion !== '0.4' || before.revision !== 3 || before.status !== 'active') throw Object.assign(new Error(), { code: 'kb_revision_preflight_mismatch' })
  const priorCandidatePath = join(root, 'logs', 'theme-framework', 'reviews', `${previousRunId}.candidate.json`)
  const priorEnvelope = JSON.parse(await readFile(priorCandidatePath, 'utf8'))
  if (priorEnvelope.payload?.candidate?.workflowRunId !== previousRunId || priorEnvelope.payload?.candidate?.basedOnRevision !== 3) throw Object.assign(new Error(), { code: 'previous_review_candidate_invalid' })
  const reviewPath = join(root, 'logs', 'theme-framework', 'reviews', `${runId}.candidate.json`)
  try { await access(reviewPath); throw Object.assign(new Error(), { code: 'run_id_collision' }) } catch (error) { if ((error as any)?.code !== 'ENOENT') throw error }

  const registry = new KnowledgeBaseRegistry()
  const mounted = await registry.mount(root)
  if (!mounted.writable || mounted.status !== 'active' || mounted.revision !== 3) throw Object.assign(new Error(), { code: 'kb_writable_mount_preflight_failed' })
  const assetsBefore = await readCanonicalV04Assets(root)
  const sourcesBefore = assetsBefore.objects.filter((item) => item.kind === 'source').length
  const sourceObjectsBefore = assetsBefore.objects.filter((item) => item.kind === 'source').map((item) => item.value as any)
  const rawRefsBefore = [...new Set(sourceObjectsBefore.flatMap((source) => Array.isArray(source.rawRefs) ? source.rawRefs : []))]
  const targetSources = sourceObjectsBefore
    .filter((source) => `${source.title} ${source.publisher ?? ''}`.includes('西部证券'))
  if (targetSources.length === 0) throw Object.assign(new Error(), { code: 'west_securities_source_missing' })
  const targetRefs = new Set(targetSources.map((source) => source.id))
  const officialAnchorUrl = 'https://www.miit.gov.cn/cms_files/filemanager/1226211233/attach/20238/1f932a10298244da844cacef2baa63c7.pdf'
  const officialSourcesBefore = sourceObjectsBefore.filter((source) => source.canonicalUrl === officialAnchorUrl && source.title === '算力基础设施高质量发展行动计划' && source.publisher === 'Ministry of Industry and Information Technology')
  const canonicalEntitiesBefore = assetsBefore.objects.filter((item) => item.kind === 'entity').map((item) => item.value as any)
  const canonicalRelationsBefore = assetsBefore.objects.filter((item) => item.kind === 'relation')
  if (sourcesBefore !== 3 || rawRefsBefore.length !== 3 || officialSourcesBefore.length !== 1 || officialSourcesBefore.some((source) => !Array.isArray(source.rawRefs) || source.rawRefs.length !== 1) || canonicalEntitiesBefore.filter((entity) => entity.type === 'investment_theme').length !== 0 || canonicalEntitiesBefore.filter((entity) => entity.type === 'industry').length !== 0 || canonicalRelationsBefore.length !== 0) throw Object.assign(new Error(), { code: 'kb_rev3_content_preflight_mismatch' })
  const verificationHandle = await registry.mount(root)
  const verifiedRawRefsBefore = new Set<string>()
  for (const rawRef of rawRefsBefore) { try { await verifyRaw(verificationHandle, rawRef); verifiedRawRefsBefore.add(rawRef) } catch { /* report only a safe verification failure */ } }
  if (verifiedRawRefsBefore.size !== 3 || officialSourcesBefore.some((source) => !source.rawRefs.every((rawRef: string) => verifiedRawRefsBefore.has(rawRef)))) throw Object.assign(new Error(), { code: 'kb_rev3_raw_verification_failed' })

  modelRuntime = await ModelRuntime.create({ authPath: join(getAgentDir(), 'auth.json'), modelsPath: join(getAgentDir(), 'models.json'), allowModelNetwork: false, refreshOnCreate: false })
  const model = selectProductionReasoningModel(modelRuntime)
  const capabilityOwner = new PiReasoningExecutor({ modelRuntime, model })
  const delegate = await createThemeFrameworkProductionReasoningExecutor({ capabilities: capabilityOwner.capabilities() })
  const modelMetadata = delegate.runtimeMetadata()
  if (modelMetadata.requestedModel !== 'gpt-6-luna' || modelMetadata.requestedReasoningEffort !== 'high') throw Object.assign(new Error(), { code: 'production_model_metadata_mismatch' })
  const guardedExecutor: ReasoningExecutor = {
    capabilities: () => delegate.capabilities(),
    execute: async (request, signal) => {
      const requestInput = request.input as any
      const input = Array.isArray(requestInput?.evidence) ? requestInput : requestInput?.context
      const evidence = Array.isArray(input?.evidence) ? input.evidence : []
      const existing = evidence.filter((item: any) => item?.origin === 'existing_kb')
      const westBody = existing.filter((item: any) => targetRefs.has(item?.sourceRef) && typeof item?.excerpt === 'string' && item.excerpt.length > 0)
      const officialRefs = new Set(officialSourcesBefore.map((source) => source.id))
      const officialBody = existing.filter((item: any) => officialRefs.has(item?.sourceRef) && typeof item?.excerpt === 'string' && item.excerpt.length > 0)
      const body = [...westBody, ...officialBody]
      const locators = body.map((item: any) => {
        const match = typeof item.description === 'string' ? item.description.match(/block=([^;]+); page=([^;]+);/u) : null
        return { evidenceId: item.evidenceId, sourceRef: item.sourceRef, blockId: match?.[1] ?? null, page: match?.[2] ?? null, characters: item.excerpt.length }
      })
      if (evidence.length > 48 || existing.length > 48 || westBody.length < 2 || officialBody.length < 1 || locators.some((item: any) => !item.blockId || !item.page)) throw Object.assign(new Error(), { code: 'pre_model_evidence_gate_failed' })
      if (modelCalls >= 2) throw Object.assign(new Error(), { code: 'model_call_limit_exceeded' })
      const currentManifest = await loadKnowledgeBaseManifest(root)
      if (currentManifest.revision !== 3) throw Object.assign(new Error(), { code: 'kb_revision_changed_before_model' })
      if (!gatewayStatuses.length || gatewayStatuses.some((status) => status !== 'already_committed')) throw Object.assign(new Error(), { code: 'gateway_not_idempotent_already_committed' })
      actualGate = { totalEvidence: evidence.length, existingKbEvidence: existing.length, westSecuritiesBodyExcerptCount: westBody.length, officialMiitBodyExcerptCount: officialBody.length, excerpts: locators }
      const callAttempt = modelCalls + 1
      const phase = callAttempt === 1 ? 'initial' : 'repair'
      if (request.operation !== 'theme_framework_semantic') throw Object.assign(new Error(), { code: 'unexpected_semantic_operation' })
      const isRepairRequest = requestInput?.context && typeof requestInput?.diagnostic === 'string' && requestInput.previousOutput !== undefined
      if ((callAttempt === 1 && isRepairRequest) || (callAttempt === 2 && !isRepairRequest)) throw Object.assign(new Error(), { code: 'repair_phase_guard_failed' })
      const priorValidationCode = typeof requestInput?.diagnostic === 'string' && /^[A-Za-z0-9_.-]{1,100}$/u.test(requestInput.diagnostic) ? requestInput.diagnostic : null
      modelCalls += 1
      say('model_call_started', { modelCalls, callAttempt, phase, priorValidationCode, operation: request.operation, modelMetadata, evidenceGate: actualGate })
      try { const result = await delegate.execute(request, signal); say('model_call_completed', { modelCalls }); return result }
      catch (error) { const code = typeof (error as any)?.code === 'string' ? (error as any).code : 'executor_error'; say('model_call_failed', { modelCalls, errorCode: code }); throw error }
    },
  }
  const rawGateway = new RawDocumentKnowledgeGatewayV04({ registry })
  const observedGateway = { submit: async (input: Parameters<typeof rawGateway.submit>[0]) => { const result = await rawGateway.submit(input); gatewayStatuses.push(result.status); return result } }
  const workflowService = new WorkflowService()
  const akshare = new AkshareDataAdapter()
  const acquisition = new ThemeFrameworkAcquisitionAdapter({ knowledgeBaseRoot: root, registry, rawGateway: observedGateway, plugins: [new MiitIndustryResearchPlugin(), new GovCnIndustryResearchPlugin(), new EastmoneyIndustryResearchPlugin(), new CpcaIndustryResearchPlugin(), new AkshareIndustryResearchPlugin(akshare)] })
  const service = new ThemeFrameworkService({ mountedKnowledgeBaseRoot: root, workflowService, reasoningExecutor: guardedExecutor, acquisition, registry })
  const snapshot = await (service as any).readKnowledgeSnapshot('AI 算力')
  const existing = snapshot.evidence.filter((item: any) => item.origin === 'existing_kb')
  const westBody = existing.filter((item: any) => targetRefs.has(item.sourceRef) && typeof item.excerpt === 'string' && item.excerpt.length > 0)
  const officialRefSet = new Set(officialSourcesBefore.map((source) => source.id))
  const officialBody = existing.filter((item: any) => officialRefSet.has(item.sourceRef) && typeof item.excerpt === 'string' && item.excerpt.length > 0)
  if (snapshot.revision !== 3 || snapshot.evidence.length > 48 || existing.length > 48 || westBody.length < 2 || officialBody.length < 1) throw Object.assign(new Error(), { code: 'pre_model_snapshot_gate_failed' })
  const bindings = new Map(snapshot.durableEvidenceBindings.map((item: any) => [item.evidenceId, item]))
  const evidenceLocators = [...westBody, ...officialBody].map((item: any) => {
    const binding = bindings.get(item.evidenceId) as any
    const match = item.description.match(/block=([^;]+); page=([^;]+);/u)
    const sourceSet = targetSources.some((source) => source.id === item.sourceRef && source.rawRefs?.includes(binding?.rawRef)) || officialSourcesBefore.some((source) => source.id === item.sourceRef && source.rawRefs?.includes(binding?.rawRef))
    if (!binding || binding.locator !== match?.[1] || !sourceSet || !verifiedRawRefsBefore.has(binding.rawRef)) throw Object.assign(new Error(), { code: 'pre_model_binding_mismatch' })
    return { evidenceId: item.evidenceId, blockId: binding.locator, page: match?.[2] ?? 'unknown', characters: item.excerpt.length, sourceRef: item.sourceRef }
  })
  say('preflight_ready', { previousRunId, previousRunStatus: 'awaiting_review', kb: { id: before.knowledgeBaseId, revision: before.revision }, sourceCountBefore: sourcesBefore, rawRefCountBefore: rawRefsBefore.length, totalEvidence: snapshot.evidence.length, existingKbEvidence: existing.length, westSecuritiesBodyExcerptCount: westBody.length, officialMiitBodyExcerptCount: officialBody.length, excerpts: evidenceLocators, modelMetadata })

  const run = service.start({ workflowRunId: runId, name: 'AI 算力' })
  say('workflow_started', { kbRevisionBefore: before.revision, modelMetadata })
  const heartbeat = setInterval(() => { const status = workflowService.getWorkflowStatus(runId); say('workflow_wait', { status: status?.status ?? 'unknown', progress: status?.progressSummary ?? 'not_reported', modelCalls, gatewayStatuses }) }, 30_000)
  let completion: any
  try { completion = await run.completion } finally { clearInterval(heartbeat) }
  say('workflow_completed', { completionStatus: completion.status, workflowStatus: workflowService.getWorkflowStatus(runId)?.status, diagnostics: completion.diagnostics ?? [], semanticValidationCategory: completion.status === 'awaiting_review' ? 'validated_candidate' : (completion.diagnostics ?? []).map((code: string) => /^[A-Za-z0-9_.-]{1,100}$/u.test(code) ? code : 'unknown_diagnostic'), modelCalls, gatewayStatuses })
  const review = await service.getReviewCandidate(runId)
  const persistedEnvelope = JSON.parse(await readFile(join(root, 'logs', 'theme-framework', 'reviews', `${runId}.candidate.json`), 'utf8'))
  const persistedBindings = persistedEnvelope.payload?.candidate?.durableEvidenceBindings
  if (!Array.isArray(persistedBindings)) throw Object.assign(new Error(), { code: 'persisted_candidate_bindings_unavailable' })
  const after = await loadKnowledgeBaseManifest(root)
  const assetsAfter = await readCanonicalV04Assets(root)
  const sourceCountAfter = assetsAfter.objects.filter((item) => item.kind === 'source').length
  const sourceObjectsAfter = assetsAfter.objects.filter((item) => item.kind === 'source').map((item) => item.value as any)
  const rawRefsAfter = [...new Set(sourceObjectsAfter.flatMap((item) => Array.isArray(item.rawRefs) ? item.rawRefs : []))]
  const officialSources = sourceObjectsAfter.filter((source) => source.canonicalUrl === officialAnchorUrl && source.title === '算力基础设施高质量发展行动计划' && source.publisher === 'Ministry of Industry and Information Technology')
  const officialRawRefs = [...new Set(officialSources.flatMap((source) => Array.isArray(source.rawRefs) ? source.rawRefs : []))]
  const verificationHandleAfter = await registry.mount(root)
  const verifiedRawRefs = new Set<string>()
  for (const rawRef of rawRefsAfter) { try { await verifyRaw(verificationHandleAfter, rawRef); verifiedRawRefs.add(rawRef) } catch { /* summarized below without content */ } }
  const officialSourceRawValid = officialSources.length > 0 && officialRawRefs.length > 0 && officialRawRefs.every((ref) => verifiedRawRefs.has(ref))
  if (!review.candidate) { say('review_candidate_absent', { reviewStatus: review.status, kbRevisionAfter: after.revision, sourceCountBefore: sourcesBefore, sourceCountAfter, modelCalls, gatewayStatuses }); }
  else {
    const c = review.candidate
    const industries = c.framework.industryCandidates
    const relations = c.framework.relationCandidates
    const recommendationCounts = (items: readonly any[]) => Object.fromEntries(['include', 'exclude', 'pending'].map((kind) => [kind, items.filter((item) => item.recommendation === kind).length]))
    const incidentIndustryRefs = new Set(relations.flatMap((item: any) => [item.sourceIndustryRef, item.targetIndustryRef]))
    const standalone = industries.filter((item: any) => !incidentIndustryRefs.has(item.candidateId) && !incidentIndustryRefs.has(item.existingIndustryRef))
    const bindingById = new Map(persistedBindings.map((item: any) => [item.evidenceId, item]))
    const evidenceById = new Map((c.evidence ?? []).map((item: any) => [item.evidenceId, item]))
    const referencedEvidence = [...new Set([...(c.framework.proposedDefinition.evidenceRefs ?? []), ...industries.flatMap((item: any) => item.evidenceRefs ?? []), ...relations.flatMap((item: any) => item.evidenceRefs ?? [])])]
    const boundReferencesValid = referencedEvidence.every((evidenceId) => {
      const binding = bindingById.get(evidenceId) as any
      const evidence = evidenceById.get(evidenceId) as any
      const sourceRef = evidence?.sourceRef
      const source = sourceObjectsAfter.find((item) => item.id === sourceRef)
      return Boolean(evidence && binding && source && binding.sourceRef === sourceRef && typeof binding.locator === 'string' && source.rawRefs?.includes(binding.rawRef) && verifiedRawRefs.has(binding.rawRef))
    })
    const relationTopology = Object.fromEntries(['main_chain', 'cross_chain'].map((topologyRole) => [topologyRole, recommendationCounts(relations.filter((item: any) => item.topologyRole === topologyRole))]))
    say('review_candidate_persisted', {
      reviewStatus: review.status,
      kb: { id: c.knowledgeBaseId, basedOnRevision: c.basedOnRevision, revisionAfter: after.revision },
      modelMetadata,
      modelCalls,
      acquisitionStatus: c.acquisitionStatus,
      gatewayStatuses,
      sourceCount: sourceCountAfter,
      rawRefCount: rawRefsAfter.length,
      officialSourcePersisted: officialSources.length > 0,
      officialSourceCount: officialSources.length,
      officialRawRefCount: officialRawRefs.length,
      officialSourceRawValid,
      sourceCountBefore: sourcesBefore,
      rawRefCountBefore: rawRefsBefore.length,
      recommendationCounts: recommendationCounts(industries),
      relationRecommendationCounts: recommendationCounts(relations),
      relationTopology,
      standaloneNodeRecommendationCounts: recommendationCounts(standalone),
      candidateCounts: { industries: industries.length, relations: relations.length, evidenceRefs: referencedEvidence.length, persistedEvidenceBindings: persistedBindings.length, validEvidenceBindings: boundReferencesValid },
      canonicalCounts: Object.fromEntries(['entity', 'relation', 'source'].map((kind) => [kind, assetsAfter.objects.filter((item) => item.kind === kind).length])),
    })
  }
} catch (error) {
  const code = typeof (error as any)?.code === 'string' ? (error as any).code : 'workflow_execution_error'
  let revisionAfterFailure: number | null = null
  try { revisionAfterFailure = (await loadKnowledgeBaseManifest(root)).revision } catch { /* retain a redacted unavailable state */ }
  say('run_failed', { errorCode: code, modelCalls, gatewayStatuses, revisionAfterFailure, evidenceGate: actualGate ?? null })
} finally { if (modelRuntime) await (modelRuntime as any).dispose?.() }


