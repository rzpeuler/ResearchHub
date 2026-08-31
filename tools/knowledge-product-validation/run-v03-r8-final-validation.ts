import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { basename, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { KnowledgeCurationSkill } from '../../packages/skills/knowledge-curation/index.ts'
import type { KnowledgeCurationModel, KnowledgeCurationModelRequest } from '../../packages/skills/knowledge-curation/index.ts'
import { STRUCTURED_OUTPUT_CONTRACTS } from '../../packages/skills/knowledge-curation/contracts.ts'
import { KNOWLEDGE_SCHEMA_V03 } from '../../packages/schemas/knowledge/v03/executable-schema.ts'
import { DoclingDocumentParser, LocalResearchReportInputResolver } from '../../packages/plugins/document/index.ts'
import type { DocumentParseInput, DocumentParseResult, DocumentParser } from '../../packages/plugins/document/types.ts'
import { ResearchReportKnowledgeIngestionWorkflow } from '../../packages/workflows/research-report-knowledge-ingestion/index.ts'
import type { ResearchReportKnowledgeIngestionResult, ResearchReportInputRef, ResolvedResearchReportInput, ResearchReportInputResolver } from '../../packages/workflows/research-report-knowledge-ingestion/index.ts'
import { KnowledgeBaseLoader, KnowledgeBaseRegistry, KnowledgeIngestionLogStore, KnowledgeWriter, canonicalSerialize } from '../../packages/shared/knowledge-base/index.ts'
import type { KnowledgeBaseHandle } from '../../packages/shared/knowledge-base/index.ts'
import { createKnowledgeStagedStateValidator, KnowledgeValidationSkill } from '../../packages/skills/knowledge-validation/index.ts'
import { loadLocalRuntimeConfig } from '../../dsh/llm-runtime/local-runtime-config.ts'
import { createRealKnowledgeCurationModel } from './deepseek-composition.ts'
import { SmokeObservingRuntime } from './run-flash-extraction-smoke.ts'
import { inspectDoclingRuntime } from '../document-parser/doctor-docling.ts'

export const R8_TASK_ID = 'KNOWLEDGE-V0.3-PRODUCT-VALIDATION-C-004-R8-FINAL'
export const R8_BASELINE = 'ea2e8233637e7a1ee1c48a8df70a0bdd482f4fc2'
export const R8_KNOWLEDGE_BASE_ID = 'kb-product-validation-c004-r8-final'
export const R8_EXPECTED_MODEL = 'deepseek-v4-flash'
export const R8_EXPECTED_PDF_SHA256 = '998703cef102300518bb2edcbcc3e9bc26fa374f157b0714f3986c5028d78d63'
export const R8_EXPECTED_PDF_BYTES = 3_209_114
export const R8_DEFAULT_PDF = 'C:\\Users\\Administrator\\Documents\\20260805-西部证券-AI算力行业：AI算力上游材料产业链研究报告.pdf'
const R8_EVIDENCE_PATH = 'tests/knowledge/product-validation/evidence/c004-r8-final-full-pipeline.json'
const EXPECTED_REASONING_POLICY = { understandReport: 'off', extractKnowledge: 'off', reconcileKnowledge: 'low', analyzeSchemaGaps: 'low' } as const

type JsonRecord = Record<string, unknown>
type FinalStatus = 'PASS' | 'TECHNICAL PASS / PRODUCT QUALITY REVIEW REQUIRED' | 'FAIL / SOL REVIEW REQUIRED' | 'BLOCKED'

class ReplayModelCallBlocked extends Error {}
class ValidationFailure extends Error { constructor(readonly status: FinalStatus, message: string) { super(message) } }

type R8ModelCall = {
  operation: string
  batchId?: string
  groupId?: string
  physicalAttempt: number
  delegatedToProvider: boolean
  validationFeedback?: JsonRecord
  modelInput?: JsonRecord
  contract?: JsonRecord
  outputShape?: JsonRecord
  runtime?: JsonRecord
  error?: string
}

class R8RecordingModel implements KnowledgeCurationModel {
  readonly calls: R8ModelCall[] = []
  private readonly attempts = new Map<string, number>()
  private replayGuard = false

  constructor(private readonly delegate: KnowledgeCurationModel, private readonly runtime: SmokeObservingRuntime) {}

  get replayIntercepted(): boolean { return this.calls.some((call) => call.error === 'replay_model_call_intercepted') }
  setReplayGuard(): void { this.replayGuard = true }

  async invoke(request: KnowledgeCurationModelRequest): Promise<unknown> {
    const input = isRecord(request.input) ? request.input : undefined
    const batch = input && isRecord(input.batch) ? input.batch : undefined
    const batchId = typeof batch?.batchId === 'string' ? batch.batchId : undefined
    const groupId = input && typeof input.groupId === 'string' ? input.groupId : undefined
    const key = `${request.operation}|${batchId ?? ''}|${groupId ?? ''}`
    const physicalAttempt = (this.attempts.get(key) ?? 0) + 1
    this.attempts.set(key, physicalAttempt)
    const call: R8ModelCall = { operation: request.operation, batchId, groupId, physicalAttempt, delegatedToProvider: false }
    if (request.operation === 'extractKnowledge') {
      call.modelInput = extractionInputObservation(input)
      call.validationFeedback = validationFeedback(request.instruction)
      if (physicalAttempt === 1) call.contract = relationContractObservation(request.outputContract)
    }
    if (this.replayGuard) {
      call.error = 'replay_model_call_intercepted'
      this.calls.push(call)
      throw new ReplayModelCallBlocked(`reprocess=false attempted ${request.operation}`)
    }
    this.calls.push(call)
    const runtimeStart = this.runtime.calls.length
    try {
      call.delegatedToProvider = true
      const output = await this.delegate.invoke(request)
      call.outputShape = outputShape(output)
      call.runtime = this.runtime.calls[runtimeStart]
      return output
    } catch (error) {
      call.runtime = this.runtime.calls[runtimeStart]
      call.error = error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240)
      throw error
    }
  }
}

class RecordingParser implements DocumentParser {
  readonly id: string
  result: DocumentParseResult | undefined
  constructor(private readonly delegate: DocumentParser) { this.id = delegate.id }
  supports(input: Pick<DocumentParseInput, 'filename' | 'mediaType'>): boolean { return this.delegate.supports(input) }
  async parse(input: DocumentParseInput): Promise<DocumentParseResult> { this.result = await this.delegate.parse(input); return this.result }
}

class RecordingResolver implements ResearchReportInputResolver {
  result: ResolvedResearchReportInput | undefined
  constructor(private readonly delegate: ResearchReportInputResolver) {}
  async resolve(inputRef: ResearchReportInputRef): Promise<ResolvedResearchReportInput> { this.result = await this.delegate.resolve(inputRef); return this.result }
}

async function main(): Promise<void> {
  const evidencePath = process.env.RESEARCHHUB_PRODUCT_VALIDATION_DURABLE_EVIDENCE ?? join(process.cwd(), R8_EVIDENCE_PATH)
  const evidence: JsonRecord = { taskId: R8_TASK_ID, baseline: R8_BASELINE, startedAt: new Date().toISOString(), skippedReprocessTrue: 'Real reprocess=true product rerun not executed in R8 due explicit token-budget policy; deterministic/integration reprocess coverage retained.' }
  let root: string | undefined
  let realRuntime: { close: () => Promise<void> } | undefined
  try {
    const git = await gitPreflight()
    evidence.baselineCheck = git
    if (git.matchesExpected !== true || git.workingTreeClean !== true || git.productionFilesChanged === true) throw new ValidationFailure('BLOCKED', 'baseline preflight failed')
    const config = loadLocalRuntimeConfig(process.env, process.cwd(), { requireRealLlm: true })
    evidence.effectiveRuntime = { provider: config.provider, model: config.model, baseUrl: redactUrl(config.baseUrl), maxTokens: config.curationMaxTokens }
    if (config.provider !== 'deepseek-official' || config.model !== R8_EXPECTED_MODEL) throw new ValidationFailure('BLOCKED', 'effective runtime is not deepseek-official/deepseek-v4-flash')
    const credential = await credentialPreflight()
    evidence.credentialPreflight = credential
    if (credential.match !== true) throw new ValidationFailure('BLOCKED', credential.diagnostic)
    const modelPreflight = await deepSeekModelPreflight(config.baseUrl, config.apiKey, config.model)
    evidence.modelPreflight = modelPreflight
    if (modelPreflight.status !== 'READY') throw new ValidationFailure('BLOCKED', modelPreflight.diagnostic)

    const pdfPath = resolve(process.env.RESEARCHHUB_PRODUCT_VALIDATION_PDF ?? R8_DEFAULT_PDF)
    await access(pdfPath)
    const pdfBytes = Uint8Array.from(await readFile(pdfPath))
    const pdfHash = createHash('sha256').update(pdfBytes).digest('hex')
    evidence.pdf = { filename: basename(pdfPath), sha256: pdfHash, bytes: pdfBytes.byteLength, expectedSha256: R8_EXPECTED_PDF_SHA256, expectedBytes: R8_EXPECTED_PDF_BYTES, sha256Match: pdfHash === R8_EXPECTED_PDF_SHA256, bytesMatch: pdfBytes.byteLength === R8_EXPECTED_PDF_BYTES }
    if (pdfHash !== R8_EXPECTED_PDF_SHA256 || pdfBytes.byteLength !== R8_EXPECTED_PDF_BYTES) throw new ValidationFailure('BLOCKED', 'PDF identity mismatch')
    const doctor = await inspectDoclingRuntime()
    evidence.doclingPreflight = doctor
    if (doctor.status !== 'READY') throw new ValidationFailure('BLOCKED', 'Docling Local is unavailable')

    root = await createFreshKnowledgeBase()
    const loader = new KnowledgeBaseLoader({ registry: new KnowledgeBaseRegistry() })
    const initialHandle = await loader.mount(root)
    const validation = new KnowledgeValidationSkill({ loader })
    const initialValidation = await validation.validateKnowledgeBase(initialHandle, 'all')
    evidence.freshKnowledgeBase = { knowledgeBaseId: initialHandle.knowledgeBaseId, schemaVersion: initialHandle.schemaVersion, storageFormatVersion: initialHandle.storageFormatVersion, revision: initialHandle.revision, writable: initialHandle.writable, seedObjects: 0, initialFullValidation: initialValidation.status, root: 'system-temp (removed after run)' }
    if (initialHandle.knowledgeBaseId !== R8_KNOWLEDGE_BASE_ID || initialHandle.schemaVersion !== '0.3' || initialHandle.storageFormatVersion !== '1' || initialHandle.revision !== 0 || !initialHandle.writable || initialValidation.status !== 'passed') throw new ValidationFailure('BLOCKED', 'fresh Knowledge Base preflight failed')

    const parser = new RecordingParser(new DoclingDocumentParser())
    const resolver = new RecordingResolver(new LocalResearchReportInputResolver({ documentParser: parser, parserId: parser.id }))
    let observer: SmokeObservingRuntime | undefined
    realRuntime = await createRealKnowledgeCurationModel(config, undefined, (delegate) => { observer = new SmokeObservingRuntime(delegate); return observer })
    if (!observer) throw new Error('runtime observer was not initialized')
    const model = new R8RecordingModel(realRuntime.model, observer)
    let writerInvocations = 0
    const writer = new KnowledgeWriter({ loader, stagedStateValidator: createKnowledgeStagedStateValidator(validation) })
    const workflow = new ResearchReportKnowledgeIngestionWorkflow({
      targetResolver: createTargetResolver(root),
      inputResolver: resolver,
      curation: new KnowledgeCurationSkill({ model }),
      validation,
      writer: { write: async (handle, receipt) => { writerInvocations += 1; return writer.write(handle, receipt) } },
    })

    const primary = await workflow.execute(inputFor(pdfPath, 'product-validation-c004-r8-primary', true))
    evidence.docling = parserEvidence(parser.result)
    evidence.primary = primaryEvidence(primary, model, observer, writerInvocations)
    const primaryLog = await readIngestionLog(root, primary.workflowRunId)
    const primaryAccounting = (evidence.primary as JsonRecord).modelAccounting as JsonRecord
    primaryAccounting.changeSetIngestionContextModelCalls = primaryLog.modelCalls
    primaryAccounting.changeSetMatches = primaryLog.modelCalls === primaryAccounting.physicalModelInvocations
    if (!parserMatchesExpected(evidence.docling as JsonRecord)) throw new ValidationFailure('FAIL / SOL REVIEW REQUIRED', 'Docling metrics differ from frozen baseline')
    if (primary.status === 'blocked') throw new ValidationFailure('FAIL / SOL REVIEW REQUIRED', `primary workflow blocked at ${primary.failureStage ?? 'unknown stage'}`)
    validatePrimaryInvariants(evidence.primary as JsonRecord, primary, model, writerInvocations)

    const writerBeforeReplay = writerInvocations
    const callsBeforeReplay = model.calls.length
    model.setReplayGuard()
    const replay = await workflow.execute(inputFor(pdfPath, 'product-validation-c004-r8-replay', false))
    evidence.replay = replayEvidence(replay, model, callsBeforeReplay, writerInvocations, writerBeforeReplay)
    if (model.replayIntercepted) throw new ValidationFailure('FAIL / SOL REVIEW REQUIRED', 'reprocess=false attempted a model call; provider invocation was intercepted')
    if (replay.status === 'blocked' || replay.finalRevision !== 1 || model.calls.length !== callsBeforeReplay || writerInvocations !== writerBeforeReplay) throw new ValidationFailure('FAIL / SOL REVIEW REQUIRED', 'reprocess=false replay invariants failed')

    const finalTarget = await resolveTarget(root)
    const finalValidation = await validation.validateKnowledgeBase(finalTarget.handle, 'all')
    evidence.finalKnowledgeBase = { revision: finalTarget.handle.revision, counts: indexCounts(finalTarget.index), fullValidation: finalValidation.status, validationErrors: finalValidation.errors.slice(0, 10) }
    evidence.semanticQuality = semanticQuality(finalTarget.index)
    evidence.provenance = provenanceReview(finalTarget.index, parser.result)
    evidence.writer = { invocations: writerInvocations, expected: 1, committedChanges: primary.committedChanges }
    evidence.finalClassification = finalValidation.status === 'passed' && evidence.provenance && (evidence.provenance as JsonRecord).coherent === true ? 'TECHNICAL PASS / PRODUCT QUALITY REVIEW REQUIRED' : 'FAIL / SOL REVIEW REQUIRED'
    evidence.status = evidence.finalClassification
    evidence.governance = { c11: 'Accepted - Sol verified', flashDefault: 'Accepted - Sol verified', s1: 'Accepted - Sol verified', r8: 'Completed / TECHNICAL PASS - PRODUCT QUALITY REVIEW REQUIRED - Sol Verification Pending', stageC: 'In Progress / Awaiting R8 Sol Verification', deferredRequirement: 'DSH multi-provider / other-API capability portability (including reasoning capability compatibility): Deferred / Awaiting Detailed User Requirements' }
    evidence.completedAt = new Date().toISOString()
    await writeEvidence(evidencePath, evidence)
    console.log(JSON.stringify({ status: evidence.status, evidencePath, parser: evidence.docling, primary: summarizeResult(primary), replay: summarizeResult(replay), finalKnowledgeBase: evidence.finalKnowledgeBase, writer: evidence.writer }))
  } catch (error) {
    evidence.status = error instanceof ValidationFailure ? error.status : 'FAIL / SOL REVIEW REQUIRED'
    evidence.failure = { message: error instanceof Error ? error.message.slice(0, 400) : String(error).slice(0, 400) }
    evidence.completedAt = new Date().toISOString()
    await writeEvidence(evidencePath, evidence)
    console.log(JSON.stringify({ status: evidence.status, evidencePath, failure: evidence.failure }))
    process.exitCode = 1
  } finally {
    if (realRuntime) await realRuntime.close()
    if (root) await rm(root, { recursive: true, force: true })
  }
}

function inputFor(pdfPath: string, workflowRunId: string, reprocess: boolean) { return { workflowRunId, knowledgeBaseId: R8_KNOWLEDGE_BASE_ID, report: { inputRef: { type: 'file' as const, reference: pdfPath }, suppliedMetadata: { title: basename(pdfPath), publisher: null, institution: null, author: null, publishedAt: null, sourceUrl: null } }, options: { mode: 'commit' as const, reprocess } } }
function createTargetResolver(root: string) { return { async resolve(): Promise<{ handle: KnowledgeBaseHandle; index: import('../../packages/shared/knowledge-base/knowledge-index-v03.ts').KnowledgeIndexV03 }> { return resolveTarget(root) } } }
async function resolveTarget(root: string): Promise<{ handle: KnowledgeBaseHandle; index: import('../../packages/shared/knowledge-base/knowledge-index-v03.ts').KnowledgeIndexV03 }> { const loader = new KnowledgeBaseLoader({ registry: new KnowledgeBaseRegistry() }); const handle = await loader.mount(root); const state = await loader.loadRuntimeState(handle); return { handle, index: state.index as import('../../packages/shared/knowledge-base/knowledge-index-v03.ts').KnowledgeIndexV03 } }
async function readIngestionLog(root: string, workflowRunId: string): Promise<JsonRecord & { modelCalls: number }> { const handle = (await resolveTarget(root)).handle; const log = await new KnowledgeIngestionLogStore().read(handle, workflowRunId); const context = log && isRecord(log.ingestionContext) ? log.ingestionContext : undefined; const calls = context && Array.isArray(context.modelCalls) ? context.modelCalls.length : typeof context?.modelCalls === 'number' ? context.modelCalls : 0; return { present: Boolean(log), status: log?.status ?? null, writeStatus: typeof log?.writeStatus === 'string' ? log.writeStatus : null, committedRevision: typeof log?.committedRevision === 'number' ? log.committedRevision : null, modelCalls: calls } }
async function createFreshKnowledgeBase(): Promise<string> { const root = await mkdtemp(join(tmpdir(), 'researchhub-c004-r8-final-')); await mkdir(join(root, 'registry'), { recursive: true }); const timestamp = '2026-09-01T00:00:00.000Z'; await writeFile(join(root, 'manifest.yaml'), `${canonicalSerialize({ knowledgeBaseId: R8_KNOWLEDGE_BASE_ID, name: 'C-004-R8 final disposable KB', schemaVersion: '0.3', storageFormatVersion: '1', revision: 0, status: 'active', createdAt: timestamp, updatedAt: timestamp })}\n`, 'utf8'); await writeFile(join(root, 'registry/assets.yaml'), '{}\n', 'utf8'); await writeFile(join(root, 'registry/raw.yaml'), '{}\n', 'utf8'); return root }

async function gitPreflight(): Promise<JsonRecord> { const head = (await git(['rev-parse', 'HEAD'])).trim(); const status = (await git(['status', '--porcelain'])).split(/\r?\n/).filter(Boolean); const changed = (await git(['diff', '--name-only', `${R8_BASELINE}..HEAD`])).split(/\r?\n/).map((item) => item.trim()).filter(Boolean); const matchesExpected = head === R8_BASELINE || await git(['merge-base', '--is-ancestor', R8_BASELINE, head]).then(() => true).catch(() => false); const unexpected = status.filter((line) => !line.startsWith('?? ') || !/^researchhub\.architecture(?:\.|$)/.test(line.slice(3))); return { head, expected: R8_BASELINE, matchesExpected, workingTreeClean: unexpected.length === 0, statusLines: status, changedSinceBaseline: changed, productionFilesChanged: changed.some((file) => !isAllowed(file)) } }
async function git(args: string[]): Promise<string> { const { execFile } = await import('node:child_process'); const { promisify } = await import('node:util'); return (await promisify(execFile)('git', args)).stdout }
function isAllowed(file: string): boolean { return file.startsWith('tools/knowledge-product-validation/') || file.startsWith('tests/knowledge/product-validation/') || file.startsWith('docs/project-management/') }
async function credentialPreflight(): Promise<JsonRecord & { match: boolean; diagnostic: string }> { const envFile = await readFile('.env', 'utf8'); const definition = envFile.split(/\r?\n/).find((line) => /^\s*DEEPSEEK_API_KEY\s*=/.test(line)); const fileKey = dotenvValue(definition); const processKey = process.env.DEEPSEEK_API_KEY; const fileFp = fingerprint(fileKey); const processFp = fingerprint(processKey); const match = Boolean(fileKey && processKey && fileFp === processFp && fileKey.length === processKey.length); return { definitionCount: envFile.split(/\r?\n/).filter((line) => /^\s*DEEPSEEK_API_KEY\s*=/.test(line)).length, envFilePresent: Boolean(fileKey), processPresent: Boolean(processKey), fingerprintMatch: fileFp === processFp, lengthMatch: (fileKey?.length ?? 0) === (processKey?.length ?? 0), match, diagnostic: match ? 'Process credential matches .env credential' : 'Process credential does not match .env credential' } }
function dotenvValue(line: string | undefined): string | undefined { if (!line) return undefined; const value = line.slice(line.indexOf('=') + 1).trim(); return value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) ? value.slice(1, -1) : value.replace(/\s+#.*$/, '').trim() }
function fingerprint(value: string | undefined): string | null { return value ? createHash('sha256').update(value).digest('hex').slice(0, 12) : null }
async function deepSeekModelPreflight(baseUrl: string, apiKey: string | undefined, model: string): Promise<JsonRecord & { status: string; diagnostic: string }> { if (!apiKey) return { status: 'BLOCKED', diagnostic: 'DEEPSEEK_API_KEY is not configured' }; try { const response = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, { headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` } }); if (!response.ok) return { status: 'BLOCKED', httpStatus: response.status, diagnostic: `DeepSeek /models rejected credentials with HTTP ${response.status}` }; const body = await response.json() as { data?: unknown }; const models = Array.isArray(body.data) ? body.data.filter((item): item is { id: string } => isRecord(item) && typeof item.id === 'string') : []; return models.some((item) => item.id === model) ? { status: 'READY', httpStatus: response.status, modelAvailable: true, diagnostic: 'DeepSeek credential and Flash model accepted by /models' } : { status: 'BLOCKED', httpStatus: response.status, modelAvailable: false, diagnostic: `Configured model ${model} is not present in DeepSeek /models` } } catch (error) { return { status: 'BLOCKED', diagnostic: `DeepSeek model preflight transport failure: ${error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180)}` } } }

function parserEvidence(result: DocumentParseResult | undefined): JsonRecord { const chunks = result?.chunks ?? []; return { parser: result?.parser ?? null, pageCount: result?.pageCount ?? result?.quality?.pageCount ?? null, chunks: chunks.length, uniqueChunkIds: new Set(chunks.map((chunk) => chunk.chunkId)).size, emptyChunks: chunks.filter((chunk) => !chunk.text.trim()).length, sections: new Set(chunks.map((chunk) => chunk.section).filter((section): section is string => Boolean(section))).size, tables: result?.structure?.tableCount ?? result?.quality?.tableCount ?? null, images: result?.structure?.imageCount ?? result?.quality?.imageCount ?? null, normalizedCharacters: result?.quality?.normalizedCharacters ?? result?.normalizedText.length ?? 0 } }
function parserMatchesExpected(value: JsonRecord): boolean { return value.pageCount === 103 && value.chunks === 1_523 && value.uniqueChunkIds === 1_523 && value.emptyChunks === 0 && value.sections === 154 && value.tables === 45 && value.images === 178 && value.normalizedCharacters === 97_784 }
function primaryEvidence(result: ResearchReportKnowledgeIngestionResult, model: R8RecordingModel, runtime: SmokeObservingRuntime, writerInvocations: number): JsonRecord { const extraction = model.calls.filter((call) => call.operation === 'extractKnowledge'); const firstAttempts = extraction.filter((call) => call.physicalAttempt === 1); const completedBatches = result.batches.batches.map((batch) => { const calls = extraction.filter((call) => call.batchId === batch.batchId); const terminal = calls.at(-1); return { batchId: batch.batchId, chunkCount: batch.chunkIds.length, characterCount: batch.characterCount, attempts: calls.length, retryCount: result.modelCalls.find((item) => item.operation === 'extractKnowledge' && item.groupId === batch.batchId)?.retryCount ?? 0, candidateCounts: terminal?.outputShape ? { entities: terminal.outputShape.entities ?? null, relations: terminal.outputShape.relations ?? null, claims: terminal.outputShape.claims ?? null } : null, validation: result.modelCalls.find((item) => item.operation === 'extractKnowledge' && item.groupId === batch.batchId)?.succeeded === true ? 'passed' : 'failed', validationFailures: result.modelCalls.find((item) => item.operation === 'extractKnowledge' && item.groupId === batch.batchId)?.validationFailures ?? [] } }); const logical = result.modelCalls; const physical = model.calls.filter((call) => call.delegatedToProvider).length; const retryInvocations = logical.reduce((sum, item) => sum + item.retryCount, 0); return { workflow: summarizeResult(result), reportUnderstanding: callSummary(model.calls.find((call) => call.operation === 'understandReport')), themeHandling: result.themeHandling.dispositions, reviewRoots: result.themeHandling.reviewItems.length, batching: batchingEvidence(result), extraction: { plannedBatches: result.batches.batchCount, completedBatches: completedBatches.length, batches: completedBatches }, c8: c8Evidence(extraction), c11: firstAttempts.map((call) => call.contract), c9: { retryInvocations, maximumRetryCount: Math.max(0, ...logical.filter((item) => item.operation === 'extractKnowledge').map((item) => item.retryCount)), noThirdAttempt: logical.filter((item) => item.operation === 'extractKnowledge').every((item) => item.retryCount <= 1), validationFeedback: extraction.filter((call) => call.validationFeedback).map((call) => call.validationFeedback) }, consolidation: result.consolidation, referenceResolution: result.referenceResolution, preciseRetrieval: { reconciliationGroups: result.reconciliation.groups, candidateCount: result.reconciliation.candidates }, reconciliation: { calls: logical.filter((item) => item.operation === 'reconcileKnowledge').length, groups: result.reconciliation.groups, candidates: result.reconciliation.candidates, decisions: result.reconciliation.decisions, classifications: result.reconciliation.classifications, exactlyOnce: Object.values(result.reconciliation.decisions).reduce((sum, count) => sum + count, 0) === result.reconciliation.candidates }, schemaGaps: { calls: logical.filter((item) => item.operation === 'analyzeSchemaGaps').length, gapCount: result.schemaGaps.length, gapTypes: result.schemaGaps.map((gap) => gap.gapType) }, reviewIsolation: { roots: result.reviewItems.filter((item) => item.candidateId && item.category !== 'dependency_review').length, dependencyClosure: result.reviewItems.filter((item) => item.category === 'dependency_review').length, total: result.reviewItems.length }, changeSet: { plannedChanges: result.plannedChanges, committedChanges: result.committedChanges }, modelAccounting: { logicalModelCallRecords: logical.length, retryInvocations, physicalModelInvocations: physical, formulaMatches: physical === logical.length + retryInvocations, changeSetIngestionContextModelCalls: null }, writerInvocations, reasoning: { expected: EXPECTED_REASONING_POLICY, observations: runtime.calls, mismatches: policyMismatches(runtime.calls) }, recordedModelCalls: model.calls.map(sanitizeCall) } }
function validatePrimaryInvariants(primary: JsonRecord, result: ResearchReportKnowledgeIngestionResult, model: R8RecordingModel, writerInvocations: number): void { const c8 = primary.c8 as JsonRecord; const c11 = Array.isArray(primary.c11) ? primary.c11.filter(isRecord) : []; const accounting = primary.modelAccounting as JsonRecord; const contractSchema = STRUCTURED_OUTPUT_CONTRACTS.extractKnowledge.schema as JsonRecord; const contractProperties = isRecord(contractSchema.properties) ? contractSchema.properties : {}; const expectedHash = hashValue(isRecord(contractProperties.relations) ? contractProperties.relations : null); if (c8.outOfBatchChunkIdsVisible !== 0 || c8.fullDocumentVisible !== false || c8.normalizedTextVisible !== false || c8.claimsContextVisible !== false || c8.sourcesContextVisible !== false || c8.rawRefsVisible !== false) throw new ValidationFailure('FAIL / SOL REVIEW REQUIRED', 'C8 invariant failed'); if (c11.length !== result.batches.batchCount || c11.some((item) => item.relationContractHash !== expectedHash || item.relationsItemsOneOf !== true || item.branchCount !== KNOWLEDGE_SCHEMA_V03.relation.types.length || !isRecord(item.component_of) || item.component_of.present !== true || JSON.stringify(item.component_of.sourceEntityTypes) !== JSON.stringify(['product', null]) || JSON.stringify(item.component_of.targetEntityTypes) !== JSON.stringify(['product', null]) || item.component_of.attributesAdditionalProperties !== false || !Array.isArray(item.component_of.attributeProperties) || item.component_of.attributeProperties.length !== 0 || item.component_of.costSharePresent !== false)) throw new ValidationFailure('FAIL / SOL REVIEW REQUIRED', 'C11 relation contract invariant failed'); if (accounting.formulaMatches !== true || accounting.changeSetMatches !== true || writerInvocations !== 1 || result.finalRevision !== 1 || model.calls.some((call) => call.physicalAttempt > 2 && call.operation === 'extractKnowledge')) throw new ValidationFailure('FAIL / SOL REVIEW REQUIRED', 'primary accounting, Writer, revision, or retry invariant failed') }
function batchingEvidence(result: ResearchReportKnowledgeIngestionResult): JsonRecord { const ids = result.batches.batches.flatMap((batch) => batch.chunkIds); return { planned: result.batches.batchCount, inputChunks: result.batches.chunkCount, inputUniqueChunks: new Set(result.batches.chunkIds).size, coveredChunks: ids.length, coveredUniqueChunks: new Set(ids).size, omissions: result.batches.chunkCount - new Set(ids).size, duplicateCoverage: ids.length - new Set(ids).size, complete: ids.length === result.batches.chunkCount && new Set(ids).size === result.batches.chunkCount } }
function c8Evidence(calls: R8ModelCall[]): JsonRecord { return { physicalExtractionInvocations: calls.filter((call) => call.delegatedToProvider).length, outOfBatchChunkIdsVisible: calls.reduce((sum, call) => sum + Number(call.modelInput?.outOfBatchChunkIdsVisible ?? 0), 0), fullDocumentVisible: calls.some((call) => call.modelInput?.fullDocumentVisible === true), normalizedTextVisible: calls.some((call) => call.modelInput?.normalizedTextVisible === true), normalizedTextHidden: calls.every((call) => call.modelInput?.normalizedTextVisible === false), claimsContextVisible: calls.some((call) => call.modelInput?.claimsContextVisible === true), sourcesContextVisible: calls.some((call) => call.modelInput?.sourcesContextVisible === true), rawRefsVisible: calls.some((call) => call.modelInput?.rawRefsVisible === true) } }
function extractionInputObservation(input: JsonRecord | undefined): JsonRecord { const batch = input && isRecord(input.batch) ? input.batch : undefined; const chunks = Array.isArray(batch?.chunks) ? batch.chunks.filter(isRecord) : []; const ids = chunks.flatMap((chunk) => typeof chunk.chunkId === 'string' ? [chunk.chunkId] : []); const understanding = input && isRecord(input.reportUnderstanding) ? input.reportUnderstanding : undefined; const referenced = [...(Array.isArray(understanding?.majorEntityMentions) ? understanding.majorEntityMentions : []), ...(Array.isArray(understanding?.themeHypotheses) ? understanding.themeHypotheses : [])].flatMap((item) => isRecord(item) && Array.isArray(item.evidenceChunkRefs) ? item.evidenceChunkRefs.filter((ref): ref is string => typeof ref === 'string') : []); const context = input && isRecord(input.knowledgeContext) ? input.knowledgeContext : undefined; return { batchId: typeof batch?.batchId === 'string' ? batch.batchId : null, currentBatchChunkCount: ids.length, currentBatchCharacterCount: chunks.reduce((sum, chunk) => sum + (typeof chunk.text === 'string' ? chunk.text.length : 0), 0), outOfBatchChunkIdsVisible: referenced.filter((ref) => !ids.includes(ref)).length, fullDocumentVisible: Boolean(input && Object.hasOwn(input, 'document')), normalizedTextVisible: Boolean(input && Object.hasOwn(input, 'normalizedText')), claimsContextVisible: Boolean(context && Object.hasOwn(context, 'claims')), sourcesContextVisible: Boolean(context && Object.hasOwn(context, 'sources')), rawRefsVisible: Boolean(context && Object.hasOwn(context, 'rawRefs')), serializedInputCharacters: input ? JSON.stringify(input).length : 0 } }
function relationContractObservation(contract: KnowledgeCurationModelRequest['outputContract']): JsonRecord { const schema = contract.schema as JsonRecord; const properties = isRecord(schema.properties) ? schema.properties : {}; const relations = isRecord(properties.relations) ? properties.relations : {}; const items = isRecord(relations.items) ? relations.items : {}; const branches = Array.isArray(items.oneOf) ? items.oneOf.filter(isRecord) : []; const component = branches.find((candidate) => { const props = isRecord(candidate.properties) ? candidate.properties : {}; const relation = isRecord(props.relationType) ? props.relationType : {}; return Array.isArray(relation.enum) && relation.enum[0] === 'component_of' }); const componentProps = component && isRecord(component.properties) ? component.properties : undefined; const entityTypes = (node: unknown) => isRecord(node) && Array.isArray(node.enum) ? node.enum : null; const source = componentProps && isRecord(componentProps.sourceMention) && isRecord(componentProps.sourceMention.properties) ? componentProps.sourceMention.properties.entityType : null; const target = componentProps && isRecord(componentProps.targetMention) && isRecord(componentProps.targetMention.properties) ? componentProps.targetMention.properties.entityType : null; const attributes = componentProps?.attributes; return { relationContractHash: hashValue(relations), relationsItemsOneOf: Array.isArray(items.oneOf), branchCount: branches.length, expectedBranchCount: KNOWLEDGE_SCHEMA_V03.relation.types.length, component_of: { present: Boolean(component), sourceEntityTypes: entityTypes(source), targetEntityTypes: entityTypes(target), attributesAdditionalProperties: isRecord(attributes) ? attributes.additionalProperties : null, attributeProperties: isRecord(attributes) && isRecord(attributes.properties) ? Object.keys(attributes.properties) : [], costSharePresent: Boolean(isRecord(attributes) && isRecord(attributes.properties) && Object.hasOwn(attributes.properties, 'costShare')) } } }
function hashValue(value: unknown): string { return createHash('sha256').update(canonicalSerialize(value)).digest('hex') }
function validationFeedback(instruction: string): JsonRecord | undefined { const code = instruction.match(/Validation code: ([^\r\n]+)/)?.[1]; return code ? { code, message: instruction.slice(Math.max(0, instruction.indexOf('Validation message: ') + 19), Math.max(0, instruction.indexOf('\nRegenerate'))).slice(0, 240) } : undefined }
function callSummary(call: R8ModelCall | undefined): JsonRecord { return { operation: call?.operation ?? null, outputShape: call?.outputShape ?? null, runtime: call?.runtime ?? null } }
function sanitizeCall(call: R8ModelCall): JsonRecord { return { operation: call.operation, batchId: call.batchId ?? null, groupId: call.groupId ?? null, physicalAttempt: call.physicalAttempt, delegatedToProvider: call.delegatedToProvider, validationFeedback: call.validationFeedback ?? null, modelInput: call.modelInput ?? null, contract: call.contract ?? null, outputShape: call.outputShape ?? null, runtime: call.runtime ?? null, error: call.error ?? null } }
function policyMismatches(calls: Array<JsonRecord>): JsonRecord[] { return calls.filter((call) => call.operation === null || EXPECTED_REASONING_POLICY[call.operation as keyof typeof EXPECTED_REASONING_POLICY] !== call.reasoningEffort) }
function replayEvidence(result: ResearchReportKnowledgeIngestionResult, model: R8RecordingModel, callsBefore: number, writerInvocations: number, writerBefore: number): JsonRecord { return { status: result.status, raw: result.raw, revision: { before: result.baseRevision, after: result.finalRevision }, modelCalls: result.modelCalls.length, modelCallsBefore: callsBefore, modelCallsAfter: model.calls.length, interceptedBeforeProvider: model.replayIntercepted, writerInvocations: writerInvocations - writerBefore, expectedModelCalls: 0, expectedWriterInvocations: 0 } }
function summarizeResult(result: ResearchReportKnowledgeIngestionResult): JsonRecord { return { status: result.status, revision: { before: result.baseRevision, after: result.finalRevision }, raw: result.raw, extraction: result.extraction, consolidation: result.consolidation, resolution: result.referenceResolution, reconciliation: result.reconciliation, validation: result.validation?.status ?? null, modelCalls: result.modelCalls.length, errors: result.errors } }
function indexCounts(index: import('../../packages/shared/knowledge-base/knowledge-index-v03.ts').KnowledgeIndexV03): JsonRecord { return { themeGroups: index.themeGroups.size, entities: index.entities.size, relations: index.relations.size, claims: index.claims.size, sources: index.sources.size, modules: index.modules.size, rawRefs: new Set([...index.sources.values()].flatMap((source) => source.rawRefs ?? [])).size } }
function semanticQuality(index: import('../../packages/shared/knowledge-base/knowledge-index-v03.ts').KnowledgeIndexV03): JsonRecord { const relations = [...index.relations.values()]; const danglingRelations = relations.filter((relation) => !index.entities.has(relation.sourceRef) || !index.entities.has(relation.targetRef)).length; const claims = [...index.claims.values()]; return { entitySample: [...index.entities.values()].slice(0, 5).map((item) => ({ id: item.id, type: item.type, name: String(item.name).slice(0, 100) })), relationSample: relations.slice(0, 5).map((item) => ({ id: item.id, type: item.type, sourceRef: item.sourceRef, targetRef: item.targetRef })), claimSample: claims.slice(0, 10).map((item) => ({ id: item.id, claimType: item.claimType, statement: String(item.statement).slice(0, 120), subjectRefs: item.subjectRefs, temporalPresent: Boolean(item.temporal), provenanceCount: item.provenance?.length ?? 0 })), structuralConcerns: { danglingRelations }, manualAssessment: 'pending Sol product-quality review' } }
function provenanceReview(index: import('../../packages/shared/knowledge-base/knowledge-index-v03.ts').KnowledgeIndexV03, parsed: DocumentParseResult | undefined): JsonRecord { const chunks = new Set((parsed?.chunks ?? []).map((chunk) => chunk.chunkId)); const claims = [...index.claims.values()].slice(0, 10); const checks = claims.map((claim) => { const provenance = claim.provenance ?? []; const rawRefs = provenance.map((item) => item.rawRef); const chunkRefs = provenance.map((item) => item.chunkRef).filter((item): item is string => typeof item === 'string'); return { claimId: claim.id, sourceRefPresent: (claim.sourceRefs ?? []).length > 0, rawRefPresent: rawRefs.length > 0, exactRawRef: rawRefs.every((ref) => ref === `raw-sha256-${R8_EXPECTED_PDF_SHA256}`), evidenceRefsResolvable: chunkRefs.every((ref) => chunks.has(ref)) } }); return { sampledClaims: checks.length, checks, coherent: checks.length > 0 && checks.every((item) => item.sourceRefPresent && item.rawRefPresent && item.exactRawRef && item.evidenceRefsResolvable), orphanProvenance: checks.filter((item) => !item.sourceRefPresent || !item.rawRefPresent || !item.exactRawRef || !item.evidenceRefsResolvable).length } }
function outputShape(value: unknown): JsonRecord { if (!isRecord(value)) return { type: Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value }; return { type: 'object', keys: Object.keys(value).sort(), entities: Array.isArray(value.entities) ? value.entities.length : undefined, relations: Array.isArray(value.relations) ? value.relations.length : undefined, claims: Array.isArray(value.claims) ? value.claims.length : undefined, decisions: Array.isArray(value.decisions) ? value.decisions.length : undefined, gaps: Array.isArray(value.gaps) ? value.gaps.length : undefined } }
function isRecord(value: unknown): value is JsonRecord { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function redactUrl(value: string): string { try { const url = new URL(value); return `${url.protocol}//${url.host}` } catch { return '[configured]' } }
async function writeEvidence(path: string, value: JsonRecord): Promise<void> { await mkdir(resolve(path, '..'), { recursive: true }); await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8') }

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) void main()
