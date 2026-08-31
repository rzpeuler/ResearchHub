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
import type { DocumentParseResult, DocumentParser } from '../../packages/plugins/document/types.ts'
import { ResearchReportKnowledgeIngestionWorkflow } from '../../packages/workflows/research-report-knowledge-ingestion/index.ts'
import type { ResearchReportKnowledgeIngestionResult, ResearchReportInputRef, ResolvedResearchReportInput, ResearchReportInputResolver } from '../../packages/workflows/research-report-knowledge-ingestion/index.ts'
import { KnowledgeBaseLoader, KnowledgeBaseRegistry, KnowledgeIngestionLogStore, KnowledgeWriter, canonicalSerialize } from '../../packages/shared/knowledge-base/index.ts'
import { createKnowledgeStagedStateValidator, KnowledgeValidationSkill } from '../../packages/skills/knowledge-validation/index.ts'
import type { KnowledgeBaseHandle } from '../../packages/shared/knowledge-base/index.ts'
import { loadLocalRuntimeConfig, LocalRuntimeConfigError } from '../../dsh/llm-runtime/local-runtime-config.ts'
import { createRealKnowledgeCurationModel } from './deepseek-composition.ts'
import { inspectDoclingRuntime } from '../document-parser/doctor-docling.ts'

export const FLASH_SMOKE_TASK_ID = 'KNOWLEDGE-V0.3-FLASH-EXTRACTION-SMOKE-C-004-S1'
export const FLASH_SMOKE_BASELINE = '88e744427c4ccc25bc19362783522a39f3d0055b'
export const FLASH_SMOKE_KNOWLEDGE_BASE_ID = 'kb-product-validation-c004-s1-flash-smoke'
export const FLASH_SMOKE_EXPECTED_MODEL = 'deepseek-v4-flash'
export const FLASH_SMOKE_EXPECTED_PDF_SHA256 = '998703cef102300518bb2edcbcc3e9bc26fa374f157b0714f3986c5028d78d63'
export const FLASH_SMOKE_EXPECTED_PDF_BYTES = 3_209_114
export const FLASH_SMOKE_DEFAULT_PDF = 'C:\\Users\\Administrator\\Documents\\20260805-瑗块儴璇佸埜-AI绠楀姏琛屼笟锛欰I绠楀姏涓婃父鏉愭枡浜т笟閾剧爺绌舵姤鍛?pdf'
const MAX_DISTINCT_EXTRACTION_BATCHES = 2
const MAX_REAL_MODEL_INVOCATIONS = 5
const OBSERVATION_TIMEOUT_MS = 180_000

type JsonRecord = Record<string, unknown>
type SmokeResult = 'PASS' | 'FAIL / SOL REVIEW REQUIRED' | 'BLOCKED'
type RecordedModelCall = {
  operation: string
  batchId?: string
  physicalAttempt: number
  delegatedToRealModel: boolean
  contractObservation?: JsonRecord
  outputShape?: JsonRecord
  modelInputObservation?: JsonRecord
  validationFeedback?: JsonRecord
  runtimeObservation?: JsonRecord
  error?: string
}
type ReasoningObservation = JsonRecord & { operation: string | null; reasoningEffort: string | null; maxTokens: number | null; temperature: number | null }

export class ExpectedSmokeStop extends Error {
  constructor(readonly batchId: string) {
    super(`ExpectedSmokeStop before real model invocation for ${batchId}`)
    this.name = 'ExpectedSmokeStop'
  }
}

export class SmokeHarnessFailure extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SmokeHarnessFailure'
  }
}

export class SmokeObservingRuntime {
  readonly calls: ReasoningObservation[] = []

  constructor(private readonly delegate: { stream(options: GenerateOptions): AsyncIterable<StreamChunk> }) {}

  stream(options: GenerateOptions): AsyncIterable<StreamChunk> { return this.observe(options) }

  private async *observe(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const started = performance.now()
    const observation: ReasoningObservation = {
      operation: operationFromPrompt(options),
      reasoningEffort: options.reasoningEffort === undefined ? null : String(options.reasoningEffort),
      maxTokens: options.maxTokens ?? null,
      temperature: options.temperature ?? null,
      startedAt: new Date().toISOString(),
      firstReasoningDeltaMs: null,
      firstTextDeltaMs: null,
      finishMs: null,
      durationMs: null,
      reasoningDeltaCount: 0,
      textDeltaCount: 0,
      finishReason: null,
      timedOut: false,
    }
    this.calls.push(observation)
    const controller = new AbortController()
    const upstreamAbort = () => controller.abort()
    if (options.signal?.aborted) controller.abort()
    else options.signal?.addEventListener('abort', upstreamAbort, { once: true })
    const timer = setTimeout(() => { observation.timedOut = true; controller.abort() }, OBSERVATION_TIMEOUT_MS)
    try {
      for await (const chunk of this.delegate.stream({ ...options, signal: controller.signal })) {
        const elapsed = Math.round(performance.now() - started)
        if (chunk.type === 'reasoning-delta') { observation.reasoningDeltaCount = Number(observation.reasoningDeltaCount) + 1; if (observation.firstReasoningDeltaMs === null) observation.firstReasoningDeltaMs = elapsed }
        if (chunk.type === 'text-delta') { observation.textDeltaCount = Number(observation.textDeltaCount) + 1; if (observation.firstTextDeltaMs === null) observation.firstTextDeltaMs = elapsed }
        if (chunk.type === 'finish') { observation.finishMs = elapsed; observation.finishReason = chunk.reason.kind }
        yield chunk
      }
    } catch (error) {
      observation.error = error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240)
      throw error
    } finally {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', upstreamAbort)
      observation.durationMs = Math.round(performance.now() - started)
    }
  }
}

export class FlashExtractionSmokeModel implements KnowledgeCurationModel {
  readonly calls: RecordedModelCall[] = []
  readonly distinctExtractionBatchIds: string[] = []
  expectedSmokeStop: { batchId: string } | undefined
  private readonly physicalAttempts = new Map<string, number>()
  private realModelInvocations = 0

  constructor(private readonly delegate: KnowledgeCurationModel, private readonly runtime: SmokeObservingRuntime) {}

  get physicalRealModelInvocations(): number { return this.realModelInvocations }

  async invoke(request: KnowledgeCurationModelRequest): Promise<unknown> {
    if (request.operation !== 'understandReport' && request.operation !== 'extractKnowledge') throw new SmokeHarnessFailure(`Unexpected downstream operation ${request.operation}`)
    const input = isRecord(request.input) ? request.input : undefined
    const batchId = input && isRecord(input.batch) && typeof input.batch.batchId === 'string' ? input.batch.batchId : undefined
    const attemptKey = `${request.operation}|${batchId ?? ''}`
    const physicalAttempt = (this.physicalAttempts.get(attemptKey) ?? 0) + 1
    this.physicalAttempts.set(attemptKey, physicalAttempt)
    const call: RecordedModelCall = { operation: request.operation, batchId, physicalAttempt, delegatedToRealModel: false }
    if (request.operation === 'extractKnowledge') {
      if (!batchId) throw new SmokeHarnessFailure('extractKnowledge request did not contain a batchId')
      if (!this.distinctExtractionBatchIds.includes(batchId)) {
        this.distinctExtractionBatchIds.push(batchId)
        if (this.distinctExtractionBatchIds.length > MAX_DISTINCT_EXTRACTION_BATCHES) {
          this.expectedSmokeStop = { batchId }
          this.calls.push(call)
          throw new ExpectedSmokeStop(batchId)
        }
      }
      call.modelInputObservation = extractionInputObservation(input)
      if (physicalAttempt === 1) call.contractObservation = relationContractObservation(request.outputContract)
      call.validationFeedback = extractValidationFeedback(request.instruction)
    }
    if (this.realModelInvocations >= MAX_REAL_MODEL_INVOCATIONS) throw new SmokeHarnessFailure(`real model invocation budget exceeded before ${request.operation}`)
    call.delegatedToRealModel = true
    this.realModelInvocations += 1
    this.calls.push(call)
    const observationStart = this.runtime.calls.length
    try {
      const output = await this.delegate.invoke(request)
      call.outputShape = outputShape(output)
      call.runtimeObservation = this.runtime.calls[observationStart]
      return output
    } catch (error) {
      call.runtimeObservation = this.runtime.calls[observationStart]
      call.error = error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240)
      throw error
    }
  }
}

export async function main(): Promise<void> {
  const evidencePath = process.env.RESEARCHHUB_PRODUCT_VALIDATION_DURABLE_EVIDENCE ?? join(process.cwd(), 'tests/knowledge/product-validation/evidence/c004-s1-flash-extraction-smoke.json')
  let root: string | undefined
  let runtime: { close: () => Promise<void> } | undefined
  const evidence: JsonRecord = { taskId: FLASH_SMOKE_TASK_ID, baseline: FLASH_SMOKE_BASELINE, startedAt: new Date().toISOString() }
  try {
    const git = await gitPreflight()
    evidence.baselineCheck = git
    if (git.matchesExpected !== true || git.workingTreeClean !== true || git.productionFilesChanged === true) throw new SmokeBlock('baseline preflight failed')
    const config = loadLocalRuntimeConfig(process.env, process.cwd(), { requireRealLlm: true })
    evidence.effectiveModel = { provider: config.provider, model: config.model, baseUrl: redactUrl(config.baseUrl), curationMaxTokens: config.curationMaxTokens }
    if (config.provider !== 'deepseek-official' || config.model !== FLASH_SMOKE_EXPECTED_MODEL) throw new SmokeBlock(`effective runtime must be deepseek-official/${FLASH_SMOKE_EXPECTED_MODEL}`)
    const credential = await inspectCredentialSource()
    evidence.credentialPreflight = credential
    if (credential.match !== true) throw new SmokeBlock(credential.diagnostic)
    const modelPreflight = await verifyDeepSeekModel(config.baseUrl, config.apiKey, config.model)
    evidence.modelPreflight = modelPreflight
    if (modelPreflight.status !== 'READY') throw new SmokeBlock(modelPreflight.diagnostic)
    const pdfPath = resolve(process.env.RESEARCHHUB_PRODUCT_VALIDATION_PDF ?? 'C:\\Users\\Administrator\\Documents\\20260805-西部证券-AI算力行业：AI算力上游材料产业链研究报告.pdf')
    await access(pdfPath)
    const pdfBytes = Uint8Array.from(await readFile(pdfPath))
    const pdfHash = createHash('sha256').update(pdfBytes).digest('hex')
    evidence.pdf = { filename: basename(pdfPath), sha256: pdfHash, bytes: pdfBytes.byteLength, expectedSha256: FLASH_SMOKE_EXPECTED_PDF_SHA256, expectedBytes: FLASH_SMOKE_EXPECTED_PDF_BYTES, sha256Match: pdfHash === FLASH_SMOKE_EXPECTED_PDF_SHA256, bytesMatch: pdfBytes.byteLength === FLASH_SMOKE_EXPECTED_PDF_BYTES }
    if (pdfHash !== FLASH_SMOKE_EXPECTED_PDF_SHA256 || pdfBytes.byteLength !== FLASH_SMOKE_EXPECTED_PDF_BYTES) throw new SmokeBlock('PDF identity mismatch')
    const doctor = await inspectDoclingRuntime()
    evidence.doclingPreflight = doctor
    if (doctor.status !== 'READY') throw new SmokeBlock('Docling Local is unavailable')

    root = await createIsolatedV03KnowledgeBase()
    const loader = new KnowledgeBaseLoader({ registry: new KnowledgeBaseRegistry() })
    const initial = await loader.mount(root)
    const validation = new KnowledgeValidationSkill({ loader })
    const initialValidation = await validation.validateKnowledgeBase(initial, 'all')
    evidence.freshKnowledgeBase = { knowledgeBaseId: initial.knowledgeBaseId, schemaVersion: initial.schemaVersion, storageFormatVersion: initial.storageFormatVersion, revision: initial.revision, writable: initial.writable, validation: initialValidation.status, root: 'system-temp (removed after run)' }
    if (initial.knowledgeBaseId !== FLASH_SMOKE_KNOWLEDGE_BASE_ID || initial.schemaVersion !== '0.3' || initial.storageFormatVersion !== '1' || initial.revision !== 0 || !initial.writable || initialValidation.status !== 'passed') throw new SmokeBlock('fresh Knowledge Base preflight failed')

    const parser = new RecordingParser(new DoclingDocumentParser())
    const resolver = new RecordingResolver(new LocalResearchReportInputResolver({ documentParser: parser, parserId: parser.id }))
    const realRuntime = await createRealKnowledgeCurationModel(config, undefined, (delegate) => {
      const observed = new SmokeObservingRuntime(delegate)
      observingRuntimeRef = observed
      return observed
    })
    runtime = realRuntime
    if (!observingRuntimeRef) throw new SmokeHarnessFailure('Smoke runtime observer was not initialized')
    const smokeModel = new FlashExtractionSmokeModel(realRuntime.model, observingRuntimeRef)
    let writerInvocations = 0
    const writer = new KnowledgeWriter({ loader, stagedStateValidator: createKnowledgeStagedStateValidator(validation) })
    const workflow = new ResearchReportKnowledgeIngestionWorkflow({
      targetResolver: createTargetResolver(root),
      inputResolver: resolver,
      curation: new KnowledgeCurationSkill({ model: smokeModel }),
      validation,
      writer: { write: async (handle, receipt) => { writerInvocations += 1; return writer.write(handle, receipt) } },
    })
    const result = await workflow.execute(inputFor(pdfPath))
    const parsed = parser.result
    const parserSummary = parserEvidence(parsed)
    evidence.docling = parserSummary
    if (!parserMatchesExpected(parserSummary)) throw new SmokeFailure('Docling metrics differ from frozen baseline')
    const planned = summarizeBatches(parsed?.chunks ?? [])
    const firstTwo = smokeModel.distinctExtractionBatchIds.slice(0, MAX_DISTINCT_EXTRACTION_BATCHES)
    evidence.batchPlan = { totalPlannedBatches: planned.length, plannedFirstTwo: planned.slice(0, 2), onlyDelegatedBatches: firstTwo, thirdBatchRequested: smokeModel.expectedSmokeStop?.batchId ?? null, productionWorkflowProducedPlan: planned.length > MAX_DISTINCT_EXTRACTION_BATCHES && firstTwo.every((batchId, index) => batchId === planned[index]?.batchId) }
    evidence.understandReport = callEvidence(smokeModel.calls.find((call) => call.operation === 'understandReport'), observingRuntimeRef?.calls[0])
    evidence.c8Visibility = c8Evidence(smokeModel.calls.filter((call) => call.operation === 'extractKnowledge'))
    evidence.c11Contract = smokeModel.calls.filter((call) => call.operation === 'extractKnowledge' && call.physicalAttempt === 1).map((call) => call.contractObservation)
    evidence.batches = firstTwo.map((batchId) => batchEvidence(batchId, smokeModel.calls, result))
    evidence.r7Regression = r7RegressionEvidence(evidence.batches as JsonRecord[])
    evidence.retry = retryEvidence(result)
    evidence.expectedSmokeStop = { triggered: Boolean(smokeModel.expectedSmokeStop), thirdBatchId: smokeModel.expectedSmokeStop?.batchId ?? null, delegatedToRealModel: smokeModel.calls.find((call) => call.batchId === smokeModel.expectedSmokeStop?.batchId)?.delegatedToRealModel ?? false, physicalCallsForThirdBatch: smokeModel.calls.filter((call) => call.batchId === smokeModel.expectedSmokeStop?.batchId && call.delegatedToRealModel).length }
    evidence.modelAccounting = { logicalModelCalls: result.modelCalls.length, logicalExtractionBatches: result.modelCalls.filter((call) => call.operation === 'extractKnowledge').length, retryInvocations: result.modelCalls.reduce((sum, call) => sum + call.retryCount, 0), physicalRealModelInvocations: smokeModel.physicalRealModelInvocations, maximumAllowed: MAX_REAL_MODEL_INVOCATIONS, underBudget: smokeModel.physicalRealModelInvocations <= MAX_REAL_MODEL_INVOCATIONS }
    evidence.downstream = { writerInvocations, reconciliationCalls: result.modelCalls.filter((call) => call.operation === 'reconcileKnowledge').length, schemaGapCalls: result.modelCalls.filter((call) => call.operation === 'analyzeSchemaGaps').length, revision: result.finalRevision, semanticCommitReached: writerInvocations > 0 }
    evidence.result = { status: result.status, failureStage: result.failureStage ?? null, errors: result.errors, rawPersistence: result.raw }
    const firstTwoPassed = firstTwo.length === 2 && firstTwo.every((batchId) => batchEvidence(batchId, smokeModel.calls, result).strictValidation === 'passed')
    const stopPassed = smokeModel.expectedSmokeStop !== undefined && evidence.expectedSmokeStop && (evidence.expectedSmokeStop as JsonRecord).delegatedToRealModel === false
    if (!firstTwoPassed || !stopPassed || smokeModel.physicalRealModelInvocations > MAX_REAL_MODEL_INVOCATIONS || writerInvocations !== 0 || result.finalRevision !== 0) throw new SmokeFailure('Flash extraction smoke invariants failed')
    evidence.status = 'PASS'
    evidence.recommendation = 'Ready for final full-pipeline validation using Flash.'
    evidence.completedAt = new Date().toISOString()
    await writeEvidence(evidencePath, evidence)
    console.log(JSON.stringify({ status: evidence.status, evidencePath, model: evidence.effectiveModel, parser: evidence.docling, batchPlan: evidence.batchPlan, modelAccounting: evidence.modelAccounting, expectedSmokeStop: evidence.expectedSmokeStop, revision: result.finalRevision }))
  } catch (error) {
    evidence.status = error instanceof SmokeBlock ? 'BLOCKED' : 'FAIL / SOL REVIEW REQUIRED'
    evidence.failure = { message: error instanceof Error ? error.message : String(error) }
    evidence.completedAt = new Date().toISOString()
    await writeEvidence(evidencePath, evidence)
    console.log(JSON.stringify({ status: evidence.status, evidencePath, failure: evidence.failure }))
    process.exitCode = 1
  } finally {
    if (runtime) await runtime.close()
    if (root) await rm(root, { recursive: true, force: true })
  }
}

let observingRuntimeRef: SmokeObservingRuntime | undefined

class RecordingParser implements DocumentParser {
  readonly id: string
  result: DocumentParseResult | undefined
  constructor(private readonly delegate: DocumentParser) { this.id = delegate.id }
  supports(input: { filename: string; mediaType: string }): boolean { return this.delegate.supports(input) }
  async parse(input: { bytes: Uint8Array; filename: string; mediaType: string }): Promise<DocumentParseResult> { this.result = await this.delegate.parse(input); return this.result }
}

class RecordingResolver implements ResearchReportInputResolver {
  result: ResolvedResearchReportInput | undefined
  constructor(private readonly delegate: ResearchReportInputResolver) {}
  async resolve(inputRef: ResearchReportInputRef): Promise<ResolvedResearchReportInput> { this.result = await this.delegate.resolve(inputRef); return this.result }
}

class SmokeBlock extends Error {}
class SmokeFailure extends Error {}

function inputFor(pdfPath: string) { return { workflowRunId: 'product-validation-c004-s1-flash-smoke', knowledgeBaseId: FLASH_SMOKE_KNOWLEDGE_BASE_ID, report: { inputRef: { type: 'file' as const, reference: pdfPath }, suppliedMetadata: { title: basename(pdfPath), publisher: null, institution: null, author: null, publishedAt: null, sourceUrl: null } }, options: { mode: 'commit' as const, reprocess: true } } }

function createTargetResolver(root: string) { return { async resolve(): Promise<{ handle: KnowledgeBaseHandle; index: import('../../packages/shared/knowledge-base/knowledge-index-v03.ts').KnowledgeIndexV03 }> { const loader = new KnowledgeBaseLoader({ registry: new KnowledgeBaseRegistry() }); const handle = await loader.mount(root); const state = await loader.loadRuntimeState(handle); return { handle, index: state.index as import('../../packages/shared/knowledge-base/knowledge-index-v03.ts').KnowledgeIndexV03 } } } }

async function createIsolatedV03KnowledgeBase(): Promise<string> { const root = await mkdtemp(join(tmpdir(), 'researchhub-c004-s1-flash-')); await mkdir(join(root, 'registry'), { recursive: true }); const timestamp = '2026-09-01T00:00:00.000Z'; await writeFile(join(root, 'manifest.yaml'), `${canonicalSerialize({ knowledgeBaseId: FLASH_SMOKE_KNOWLEDGE_BASE_ID, name: 'C-004-S1 Flash smoke disposable KB', schemaVersion: '0.3', storageFormatVersion: '1', revision: 0, status: 'active', createdAt: timestamp, updatedAt: timestamp })}\n`, 'utf8'); await writeFile(join(root, 'registry/assets.yaml'), '{}\n', 'utf8'); await writeFile(join(root, 'registry/raw.yaml'), '{}\n', 'utf8'); return root }

async function gitPreflight(): Promise<JsonRecord> { const head = (await execGit(['rev-parse', 'HEAD'])).trim(); const statusLines = (await execGit(['status', '--porcelain'])).split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean); const changedSinceBaseline = (await execGit(['diff', '--name-only', `${FLASH_SMOKE_BASELINE}..HEAD`])).split(/\r?\n/).map((line) => line.trim()).filter(Boolean); const matchesExpected = head === FLASH_SMOKE_BASELINE || (await execGit(['merge-base', '--is-ancestor', FLASH_SMOKE_BASELINE, head]).then(() => 'true').catch(() => 'false')) === 'true'; const unexpectedStatus = statusLines.filter((line) => !line.startsWith('?? ') || !/^researchhub\.architecture(?:\.|$)/.test(line.slice(3))); return { head, expected: FLASH_SMOKE_BASELINE, matchesExpected, workingTreeClean: unexpectedStatus.length === 0, statusLines, changedSinceBaseline, productionFilesChanged: changedSinceBaseline.some((file) => !isAllowedEvidencePath(file)) } }
async function execGit(args: string[]): Promise<string> { const { execFile } = await import('node:child_process'); const { promisify } = await import('node:util'); return (await promisify(execFile)('git', args)).stdout }
function isAllowedEvidencePath(file: string): boolean { return file.startsWith('tools/knowledge-product-validation/') || file.startsWith('tests/knowledge/product-validation/') || file.startsWith('docs/project-management/') }

async function inspectCredentialSource(): Promise<JsonRecord & { match: boolean; diagnostic: string }> { const raw = await readFile('.env', 'utf8'); const definitions = raw.split(/\r?\n/).filter((line) => /^\s*DEEPSEEK_API_KEY\s*=/.test(line)); const fileKey = parseDotEnvValue(definitions[0]); const processKey = process.env.DEEPSEEK_API_KEY; const fileFingerprint = fingerprint(fileKey); const processFingerprint = fingerprint(processKey); const match = definitions.length === 1 && fileFingerprint === processFingerprint && (fileKey?.length ?? 0) === (processKey?.length ?? 0); return { definitionCount: definitions.length, envFilePresent: Boolean(fileKey), processPresent: Boolean(processKey), fingerprintMatch: fileFingerprint === processFingerprint, lengthMatch: (fileKey?.length ?? 0) === (processKey?.length ?? 0), match, diagnostic: match ? 'Process credential matches .env credential' : 'Process credential does not match .env credential' } }
function parseDotEnvValue(line: string | undefined): string | undefined { if (!line) return undefined; const value = line.slice(line.indexOf('=') + 1).trim(); if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) return value.slice(1, -1); return value.replace(/\s+#.*$/, '').trim() }
function fingerprint(value: string | undefined): string | null { return value ? createHash('sha256').update(value).digest('hex').slice(0, 12) : null }
async function verifyDeepSeekModel(baseUrl: string, apiKey: string | undefined, model: string): Promise<JsonRecord & { status: string; diagnostic: string }> { if (!apiKey) return { status: 'BLOCKED', diagnostic: 'DEEPSEEK_API_KEY is not configured' }; try { const response = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, { headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` } }); if (!response.ok) return { status: 'BLOCKED', httpStatus: response.status, diagnostic: `DeepSeek /models rejected credentials with HTTP ${response.status}` }; const body = await response.json() as { data?: unknown }; const available = Array.isArray(body.data) ? body.data.filter((item): item is { id: string } => isRecord(item) && typeof item.id === 'string') : []; return available.some((item) => item.id === model) ? { status: 'READY', httpStatus: response.status, modelAvailable: true, diagnostic: 'DeepSeek credential and Flash model accepted by /models' } : { status: 'BLOCKED', httpStatus: response.status, modelAvailable: false, diagnostic: `Configured model ${model} is not present in DeepSeek /models` } } catch (error) { return { status: 'BLOCKED', diagnostic: `DeepSeek model preflight transport failure: ${error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180)}` } } }

function parserEvidence(result: DocumentParseResult | undefined): JsonRecord { const chunks = result?.chunks ?? []; return { parser: result?.parser ?? null, pageCount: result?.pageCount ?? result?.quality?.pageCount ?? null, chunks: chunks.length, uniqueChunkIds: new Set(chunks.map((chunk) => chunk.chunkId)).size, emptyChunks: chunks.filter((chunk) => !chunk.text.trim()).length, sections: new Set(chunks.map((chunk) => chunk.section).filter((section): section is string => Boolean(section))).size, tables: result?.structure?.tableCount ?? result?.quality?.tableCount ?? null, images: result?.structure?.imageCount ?? result?.quality?.imageCount ?? null, normalizedCharacters: result?.quality?.normalizedCharacters ?? result?.normalizedText.length ?? 0 } }
function parserMatchesExpected(value: JsonRecord): boolean { return value.pageCount === 103 && value.chunks === 1_523 && value.uniqueChunkIds === 1_523 && value.emptyChunks === 0 && value.sections === 154 && value.tables === 45 && value.images === 178 && value.normalizedCharacters === 97_784 }

function summarizeBatches(chunks: Array<{ chunkId: string; text: string; section?: string | null }>): Array<JsonRecord> { const groups = new Map<string, Array<{ chunkId: string; text: string }>>(); for (const chunk of chunks) { const section = chunk.section?.trim() || '(untitled)'; const group = groups.get(section) ?? []; group.push(chunk); groups.set(section, group) } const batches: Array<{ batchId: string; chunkIds: string[]; characterCount: number }> = []; let current = { batchId: 'batch-0001', chunkIds: [] as string[], characterCount: 0 }; const flush = () => { if (current.chunkIds.length) batches.push(current); current = { batchId: `batch-${String(batches.length + 2).padStart(4, '0')}`, chunkIds: [], characterCount: 0 } }; for (const sectionChunks of groups.values()) { const sectionCharacters = sectionChunks.reduce((sum, chunk) => sum + chunk.text.length, 0); if (current.chunkIds.length && current.characterCount + sectionCharacters <= 6000) { current.chunkIds.push(...sectionChunks.map((chunk) => chunk.chunkId)); current.characterCount += sectionCharacters; continue } if (current.chunkIds.length && current.characterCount + sectionCharacters > 6000) flush(); if (!current.chunkIds.length && sectionCharacters <= 6000) { current.chunkIds.push(...sectionChunks.map((chunk) => chunk.chunkId)); current.characterCount += sectionCharacters; continue } for (const chunk of sectionChunks) { if (current.chunkIds.length && current.characterCount + chunk.text.length > 6000) flush(); current.chunkIds.push(chunk.chunkId); current.characterCount += chunk.text.length } } flush(); return batches }

function relationContractObservation(contract: KnowledgeCurationModelRequest['outputContract']): JsonRecord { const schema = contract.schema as JsonRecord; const properties = isRecord(schema.properties) ? schema.properties : {}; const relations = isRecord(properties.relations) ? properties.relations : {}; const items = isRecord(relations.items) ? relations.items : {}; const branches = Array.isArray(items.oneOf) ? items.oneOf.filter(isRecord) : []; const branch = branches.find((candidate) => isRecord(candidate.properties) && isRecord(candidate.properties.relationType) && (candidate.properties.relationType as JsonRecord).enum?.[0] === 'component_of'); const branchProperties = branch && isRecord(branch.properties) ? branch.properties : undefined; const source = branchProperties && isRecord(branchProperties.sourceMention) && isRecord(branchProperties.sourceMention.properties) ? branchProperties.sourceMention.properties.entityType : undefined; const target = branchProperties && isRecord(branchProperties.targetMention) && isRecord(branchProperties.targetMention.properties) ? branchProperties.targetMention.properties.entityType : undefined; const attributes = branchProperties?.attributes; return { relationsItemsOneOf: Array.isArray(items.oneOf), branchCount: branches.length, expectedBranchCount: KNOWLEDGE_SCHEMA_V03.relation.types.length, component_of: { present: Boolean(branch), sourceEntityTypes: isRecord(source) ? source.enum : null, targetEntityTypes: isRecord(target) ? target.enum : null, attributesAdditionalProperties: isRecord(attributes) ? attributes.additionalProperties : null, attributeProperties: isRecord(attributes) && isRecord(attributes.properties) ? Object.keys(attributes.properties) : [], costSharePresent: Boolean(isRecord(attributes) && isRecord(attributes.properties) && Object.hasOwn(attributes.properties, 'costShare')) } }
}
function extractionInputObservation(input: JsonRecord | undefined): JsonRecord { if (!input) return {}; const batch = isRecord(input.batch) ? input.batch : undefined; const chunks = Array.isArray(batch?.chunks) ? batch.chunks.filter(isRecord) : []; const chunkIds = chunks.flatMap((chunk) => typeof chunk.chunkId === 'string' ? [chunk.chunkId] : []); const understanding = isRecord(input.reportUnderstanding) ? input.reportUnderstanding : undefined; const referenced = [...(Array.isArray(understanding?.majorEntityMentions) ? understanding.majorEntityMentions : []), ...(Array.isArray(understanding?.themeHypotheses) ? understanding.themeHypotheses : [])].flatMap((item) => isRecord(item) && Array.isArray(item.evidenceChunkRefs) ? item.evidenceChunkRefs.filter((ref): ref is string => typeof ref === 'string') : []); const context = isRecord(input.knowledgeContext) ? input.knowledgeContext : undefined; return { batchId: typeof batch?.batchId === 'string' ? batch.batchId : null, currentBatchChunkCount: chunkIds.length, currentBatchCharacterCount: chunks.reduce((sum, chunk) => sum + (typeof chunk.text === 'string' ? chunk.text.length : 0), 0), visibleReferencedChunkCount: new Set(referenced).size, outOfBatchChunkIdsVisible: referenced.filter((ref) => !chunkIds.includes(ref)).length, fullDocumentVisible: Object.hasOwn(input, 'document'), normalizedTextVisible: Object.hasOwn(input, 'normalizedText'), claimsContextVisible: Boolean(context && Object.hasOwn(context, 'claims')), sourcesContextVisible: Boolean(context && Object.hasOwn(context, 'sources')), rawRefsVisible: Boolean(context && Object.hasOwn(context, 'rawRefs')), serializedInputCharacters: JSON.stringify(input).length }
}
function extractValidationFeedback(instruction: string): JsonRecord | undefined { const code = instruction.match(/Validation code: ([^\r\n]+)/)?.[1]; return code ? { code, messageLength: Math.max(0, instruction.indexOf('\nRegenerate') - instruction.indexOf('Validation message: ') - 'Validation message: '.length) } : undefined }
function callEvidence(call: RecordedModelCall | undefined, runtime: ReasoningObservation | undefined): JsonRecord { return { operation: call?.operation ?? null, modelOutputShape: call?.outputShape ?? null, runtime: runtime ?? null } }
function c8Evidence(calls: RecordedModelCall[]): JsonRecord { return { extractionCalls: calls.length, outOfBatchChunkIdsVisible: calls.reduce((sum, call) => sum + Number(call.modelInputObservation?.outOfBatchChunkIdsVisible ?? 0), 0), fullDocumentVisible: calls.some((call) => call.modelInputObservation?.fullDocumentVisible === true), normalizedTextVisible: calls.some((call) => call.modelInputObservation?.normalizedTextVisible === true), claimsContextVisible: calls.some((call) => call.modelInputObservation?.claimsContextVisible === true), sourcesContextVisible: calls.some((call) => call.modelInputObservation?.sourcesContextVisible === true), rawRefsVisible: calls.some((call) => call.modelInputObservation?.rawRefsVisible === true) } }
function batchEvidence(batchId: string, calls: RecordedModelCall[], result: ResearchReportKnowledgeIngestionResult): JsonRecord { const physical = calls.filter((call) => call.batchId === batchId && call.delegatedToRealModel); const logical = result.modelCalls.find((call) => call.operation === 'extractKnowledge' && call.groupId === batchId); const first = physical[0]; const last = physical[physical.length - 1]; const input = first?.modelInputObservation; return { batchId, chunkCount: input?.currentBatchChunkCount ?? null, characterCount: input?.currentBatchCharacterCount ?? null, attemptCount: physical.length, retryCount: logical?.retryCount ?? null, candidateCounts: last?.outputShape ? { entities: last.outputShape.entities ?? null, relations: last.outputShape.relations ?? null, claims: last.outputShape.claims ?? null } : null, strictValidation: logical?.succeeded === true ? 'passed' : 'failed', validationFailures: logical?.validationFailures ?? [] } }
function r7RegressionEvidence(batches: JsonRecord[]): JsonRecord { const classifications = batches.map((batch) => { const failures = Array.isArray(batch.validationFailures) ? batch.validationFailures.filter(isRecord).map((failure) => String(failure.message ?? '')) : []; const values = failures.map((message) => /costShare.*(?:undeclared|not declared)|not declared.*costShare/i.test(message) ? 'A' : /component_of endpoint types invalid/i.test(message) ? 'B' : /RelationCandidate\[/i.test(message) ? 'C' : 'D'); if (batch.strictValidation === 'passed') values.push('E'); return { batchId: batch.batchId ?? null, classifications: [...new Set(values)] } }); const all = classifications.flatMap((item) => item.classifications); return { batches: classifications, observedAUndeclaredComponentAttribute: all.includes('A'), observedBWrongComponentOfEndpoint: all.includes('B'), observedCOtherRelationContractViolation: all.includes('C'), observedDDifferentValidation: all.includes('D'), observedEStrictPass: all.includes('E'), noABRegression: !all.includes('A') && !all.includes('B') } }
function retryEvidence(result: ResearchReportKnowledgeIngestionResult): JsonRecord { const extractions = result.modelCalls.filter((call) => call.operation === 'extractKnowledge'); return { logicalBatches: extractions.length, retriedBatches: extractions.filter((call) => call.retryCount === 1).length, maximumRetryCount: Math.max(0, ...extractions.map((call) => call.retryCount)), noThirdAttempt: extractions.every((call) => call.retryCount <= 1) } }
function outputShape(value: unknown): JsonRecord { if (!isRecord(value)) return { type: Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value }; return { type: 'object', keys: Object.keys(value).sort(), entities: Array.isArray(value.entities) ? value.entities.length : undefined, relations: Array.isArray(value.relations) ? value.relations.length : undefined, claims: Array.isArray(value.claims) ? value.claims.length : undefined } }
function operationFromPrompt(options: GenerateOptions): string | null { for (const message of options.messages) for (const content of message.content) if (content.type === 'text') return content.text.match(/Operation: (understandReport|extractKnowledge|reconcileKnowledge|analyzeSchemaGaps)/)?.[1] ?? null; return null }
function isRecord(value: unknown): value is JsonRecord { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function redactUrl(value: string): string { try { const url = new URL(value); return `${url.protocol}//${url.host}` } catch { return '[configured]' } }
async function writeEvidence(path: string, value: JsonRecord): Promise<void> { await mkdir(resolve(path, '..'), { recursive: true }); await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8') }

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) void main()
