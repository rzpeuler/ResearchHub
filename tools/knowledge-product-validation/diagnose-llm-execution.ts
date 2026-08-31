import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { apply as applyDeepSeek } from '@deepseek-ai/dsh-llm-deepseek'
import { createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { KnowledgeCurationSkill, type KnowledgeCurationModel, type KnowledgeCurationModelRequest, type KnowledgeContext, type NormalizedResearchDocument, type ReportUnderstanding, type ExtractionBatch, type JsonRecord } from '../../packages/skills/knowledge-curation/index.ts'
import { buildCurationSchemaContext } from '../../packages/skills/knowledge-curation/schema-context.ts'
import { STRUCTURED_OUTPUT_CONTRACTS } from '../../packages/skills/knowledge-curation/contracts.ts'
import { UNDERSTAND_REPORT_PROMPT } from '../../packages/skills/knowledge-curation/prompts/understand-report.ts'
import { validateUnderstandReport } from '../../packages/skills/knowledge-curation/validation.ts'
import { LocalResearchReportInputResolver } from '../../packages/plugins/document/index.ts'
import { DoclingDocumentParser } from '../../packages/plugins/document/docling-document-parser.ts'
import type { DocumentParseInput, DocumentParseResult, DocumentParser } from '../../packages/plugins/document/types.ts'
import { createKnowledgeScopeContext } from '../../packages/workflows/research-report-knowledge-ingestion/index.ts'
import { KnowledgeBaseLoader, KnowledgeBaseRegistry, canonicalSerialize, deriveRawIdentity } from '../../packages/shared/knowledge-base/index.ts'
import { KnowledgeValidationSkill } from '../../packages/skills/knowledge-validation/index.ts'
import { loadLocalRuntimeConfig } from '../../dsh/llm-runtime/local-runtime-config.ts'
import type { HarnessLlmRuntime } from '../../dsh/llm-runtime/types.ts'
import { createKnowledgeCurationModelAdapter } from '../../dsh/llm-runtime/knowledge-curation-model-adapter.ts'
import type { LlmResolvedModelInfo, ReasoningEffortId } from '@deepseek-ai/dsh-llm'

const TASK_ID = 'KNOWLEDGE-V0.3-LLM-EXECUTION-DIAGNOSTIC-C-006'
const BASELINE = '5ea04fbe879ddd414981c7eba02e9e0a2f56298b'
const C5 = '2b29e6b224aeb64ae235aa745eaa181f4a02c0aa'
const KNOWLEDGE_BASE_ID = 'kb-product-validation-c004-r3-diagnostic'
const PDF_PATH = 'C:\\Users\\Administrator\\Documents\\20260805-西部证券-AI算力行业：AI算力上游材料产业链研究报告.pdf'
const EXPECTED_SHA256 = '998703cef102300518bb2edcbcc3e9bc26fa374f157b0714f3986c5028d78d63'
const EVIDENCE_PATH = resolve('tests/knowledge/product-validation/evidence/c006-llm-execution-diagnostic-summary.json')
const ABORT_MS = 120_000

type ObservationLabel = 'harnessControl' | 'currentPolicy' | 'reasoningOff' | 'maxTokens16384' | 'projectedInput'
type Observation = {
  label: ObservationLabel | 'unknown'
  requestStart: string
  firstChunk?: string
  firstReasoningDelta?: string
  firstTextDelta?: string
  firstUsage?: string
  finish?: string
  elapsedMs: Partial<Record<'firstChunk' | 'firstReasoningDelta' | 'firstTextDelta' | 'firstUsage' | 'finish', number>>
  counts: Record<'block-start' | 'reasoning-delta' | 'text-delta' | 'block-end' | 'usage' | 'finish', number>
  reasoningCharacters: number
  textCharacters: number
  finishReason?: string
  controlledAbort: boolean
  error?: string
  options?: JsonRecord
}

class DiagnosticAbort extends Error {}

class ObservingRuntime implements HarnessLlmRuntime {
  readonly observations: Observation[] = []
  nextLabel: ObservationLabel | undefined
  nextTimeoutMs = ABORT_MS
  nextOverride: { reasoningEffort?: string; maxTokens?: number } = {}

  constructor(private readonly inner: HarnessLlmRuntime) {}

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const started = Date.now()
    const requestStart = new Date(started).toISOString()
    const observation: Observation = {
      label: this.nextLabel ?? 'unknown', requestStart, elapsedMs: {},
      counts: { 'block-start': 0, 'reasoning-delta': 0, 'text-delta': 0, 'block-end': 0, usage: 0, finish: 0 },
      reasoningCharacters: 0, textCharacters: 0, controlledAbort: false,
    }
    this.observations.push(observation)
    const label = this.nextLabel
    const timeoutMs = this.nextTimeoutMs
    const override = this.nextOverride
    this.nextLabel = undefined
    this.nextOverride = {}
    const controller = new AbortController()
    const forwarded: GenerateOptions = {
      ...options,
      ...(override.reasoningEffort ? { reasoningEffort: override.reasoningEffort as ReasoningEffortId } : {}),
      ...(override.maxTokens ? { maxTokens: override.maxTokens } : {}),
      signal: controller.signal,
    }
    observation.options = summarizeOptions(forwarded)
    const timer = setTimeout(() => { observation.controlledAbort = true; controller.abort() }, timeoutMs)
    const abortToken = Symbol('diagnostic-abort')
    const abortTimer = setTimeout(() => controller.abort(), timeoutMs)
    let deadlineTimer: ReturnType<typeof setTimeout>
    const abortPromise = new Promise<typeof abortToken>((resolveAbort) => { deadlineTimer = setTimeout(() => resolveAbort(abortToken), timeoutMs) })
    const iterator = this.inner.stream(forwarded)[Symbol.asyncIterator]()
    try {
      while (true) {
        const nextPromise = iterator.next()
        const next = await Promise.race([nextPromise, abortPromise])
        if (next === abortToken) {
          observation.controlledAbort = true
          void nextPromise.catch(() => undefined)
          await iterator.return?.()
          throw new DiagnosticAbort(`controlled abort after ${timeoutMs}ms`)
        }
        if (next.done) break
        const chunk = next.value
        observeChunk(observation, chunk, started)
        yield chunk
      }
    } catch (error) {
      observation.error = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      clearTimeout(timer)
      clearTimeout(abortTimer)
      clearTimeout(deadlineTimer)
      observation.label = label ?? observation.label
    }
  }
}

class CaptureModel implements KnowledgeCurationModel {
  request: KnowledgeCurationModelRequest | undefined
  async invoke(request: KnowledgeCurationModelRequest): Promise<unknown> { this.request = request; throw new Error('diagnostic request capture') }
}

async function main(): Promise<void> {
  const evidence: JsonRecord = { taskId: TASK_ID, baseline: BASELINE, c5Commit: C5, startedAt: new Date().toISOString() }
  let root: string | undefined
  let ctx: Context | undefined
  try {
    const config = loadLocalRuntimeConfig(process.env, process.cwd(), { requireRealLlm: true })
    const credential = await credentialEvidence(config.baseUrl, config.apiKey, config.model)
    evidence.runtime = { provider: config.provider, model: config.model, configuredMaxTokens: config.curationMaxTokens, baseUrl: redactUrl(config.baseUrl) }
    evidence.credential = credential
    if (credential.match !== true || credential.modelsHttpStatus !== 200 || credential.modelAvailable !== true) throw new Error('credential or model preflight failed')

    const pdfBytes = Uint8Array.from(await readFile(PDF_PATH))
    const sha256 = createHash('sha256').update(pdfBytes).digest('hex')
    evidence.pdf = { filename: basename(PDF_PATH), sha256, bytes: pdfBytes.byteLength }
    if (sha256 !== EXPECTED_SHA256 || pdfBytes.byteLength !== 3_209_114) throw new Error('exact PDF verification failed')

    root = await createDiagnosticKnowledgeBase()
    const loader = new KnowledgeBaseLoader({ registry: new KnowledgeBaseRegistry() })
    const handle = await loader.mount(root)
    const state = await loader.loadRuntimeState(handle)
    const validation = new KnowledgeValidationSkill({ loader })
    const initialValidation = await validation.validateKnowledgeBase(handle, 'all')
    evidence.knowledgeBase = { knowledgeBaseId: handle.knowledgeBaseId, schemaVersion: handle.schemaVersion, storageFormatVersion: handle.storageFormatVersion, revision: handle.revision, writable: handle.writable, seedObjects: 0, fullValidation: initialValidation.status }

    const parser = new RecordingParser(new DoclingDocumentParser())
    const resolver = new LocalResearchReportInputResolver({ documentParser: parser, parserId: parser.id })
    const resolved = await resolver.resolve({ type: 'file', reference: PDF_PATH })
    const document: NormalizedResearchDocument = { rawRef: deriveRawIdentity(pdfBytes).rawRef, suppliedMetadata: { title: basename(PDF_PATH), publisher: null, institution: null, author: null, publishedAt: null, sourceUrl: null }, normalizedText: resolved.normalizedText, chunks: resolved.chunks }
    const parserMetrics = { parser: parser.id, pages: parser.result?.pageCount ?? parser.result?.quality?.pageCount ?? null, sections: new Set(document.chunks.map((chunk) => chunk.section).filter(Boolean)).size, tables: parser.result?.structure?.tableCount ?? parser.result?.quality?.tableCount ?? null, images: parser.result?.structure?.imageCount ?? parser.result?.quality?.imageCount ?? null, chunks: document.chunks.length, uniqueChunkIds: new Set(document.chunks.map((chunk) => chunk.chunkId)).size, emptyChunks: document.chunks.filter((chunk) => !chunk.text.trim()).length, normalizedCharacters: document.normalizedText.length, sumChunkTextCharacters: document.chunks.reduce((sum, chunk) => sum + chunk.text.length, 0), warnings: parser.result?.quality?.warnings ?? [] }
    evidence.parser = parserMetrics

    const scopeContext = createKnowledgeScopeContext(handle, state.index)
    const input = { workflowRunId: 'product-validation-c004-r3-diagnostic', knowledgeBaseId: KNOWLEDGE_BASE_ID, document, themeContext: scopeContext }
    const capture = new CaptureModel()
    try { await new KnowledgeCurationSkill({ model: capture }).understandReport(input) } catch (error) { if (!(error instanceof Error) || error.message !== 'diagnostic request capture') { /* expected Skill wrapping */ } }
    const request = capture.request
    if (!request) throw new Error('unable to reconstruct understandReport request')
    evidence.prompt = promptEvidence(request)
    evidence.staticEnvelope = staticEnvelopeEvidence(request, document, scopeContext)

    ctx = new Context()
    await ctx.plugin(LlmRuntime)
    applyDeepSeek(ctx, { apiKeyEnv: 'DEEPSEEK_API_KEY', baseURL: config.baseUrl, maxTokens: config.curationMaxTokens, models: [{ id: config.model, name: config.model }] })
    const modelInfo = await ctx.llm.resolveModelInfo(config.provider, config.model)
    evidence.generateOptions = { provider: config.provider, model: config.model, configuredMaxTokens: config.curationMaxTokens, resolved: summarizeModelInfo(modelInfo), currentAdapterReasoningEffort: 'omitted; adapter default / provider-resolved' }
    const observed = new ObservingRuntime(ctx.llm)
    const adapter = createKnowledgeCurationModelAdapter({ llm: observed, provider: config.provider, model: config.model, maxTokens: config.curationMaxTokens })

    observed.nextLabel = 'harnessControl'
    observed.nextTimeoutMs = 60_000
    await runHarnessControl(observed, config.provider, config.model)
    evidence.harnessControl = observed.observations.at(-1)

    observed.nextLabel = 'currentPolicy'
    observed.nextTimeoutMs = ABORT_MS
    const current = await runUnderstand(observed, adapter, request, input)
    evidence.currentPolicy = current
    observed.nextLabel = 'reasoningOff'
    observed.nextTimeoutMs = ABORT_MS
    const reasoningOff = await runUnderstand(observed, adapter, request, input, { reasoningEffort: 'off' })
    evidence.reasoningOff = reasoningOff

    if (!finishedNormally(reasoningOff)) {
      observed.nextLabel = 'maxTokens16384'
      observed.nextTimeoutMs = ABORT_MS
      const boundedRequest = request
      evidence.maxTokensComparison = await runUnderstand(observed, adapter, boundedRequest, input, { maxTokens: 16_384 })
      if (!finishedNormally(evidence.maxTokensComparison as JsonRecord)) {
        observed.nextLabel = 'projectedInput'
        observed.nextTimeoutMs = ABORT_MS
        const projected = projectUnderstandRequest(request)
        evidence.inputProjection = await runUnderstand(observed, adapter, projected, input)
      } else evidence.inputProjection = { skipped: true, rationale: '16k maxTokens comparison completed, so projection was not needed to isolate budget contribution.' }
    } else {
      evidence.maxTokensComparison = { skipped: true, rationale: 'reasoning-off path completed; task permits skipping the bounded comparison.' }
      evidence.inputProjection = { skipped: true, rationale: 'reasoning-off path completed; task permits skipping the input projection experiment.' }
    }

    evidence.classification = classify(evidence)
    evidence.status = (evidence.classification as JsonRecord).primary
    evidence.completedAt = new Date().toISOString()
    await writeEvidence(EVIDENCE_PATH, evidence)
    console.log(JSON.stringify({ taskId: TASK_ID, classification: evidence.classification, evidencePath: EVIDENCE_PATH, prompt: evidence.prompt, generateOptions: evidence.generateOptions, harnessControl: evidence.harnessControl, currentPolicy: evidence.currentPolicy, reasoningOff: evidence.reasoningOff, maxTokensComparison: evidence.maxTokensComparison, inputProjection: evidence.inputProjection, staticEnvelope: evidence.staticEnvelope }))
  } catch (error) {
    evidence.completedAt = new Date().toISOString()
    evidence.status = 'UNRESOLVED / DIAGNOSTIC EXECUTION FAILED'
    evidence.failure = error instanceof Error ? error.message : String(error)
    await writeEvidence(EVIDENCE_PATH, evidence)
    console.log(JSON.stringify({ taskId: TASK_ID, status: evidence.status, evidencePath: EVIDENCE_PATH, failure: evidence.failure }))
    process.exitCode = 1
  } finally {
    if (ctx) await ctx.fiber.dispose()
    if (root) await rm(root, { recursive: true, force: true })
  }
}

async function runUnderstand(observed: ObservingRuntime, adapter: KnowledgeCurationModel, request: KnowledgeCurationModelRequest, input: { workflowRunId: string; knowledgeBaseId: string; document: NormalizedResearchDocument; themeContext: KnowledgeContext }, override: { reasoningEffort?: string; maxTokens?: number } = {}): Promise<JsonRecord> {
  observed.nextOverride = override
  const before = Date.now()
  try {
    const output = await adapter.invoke(request)
    const shape = outputShape(output)
    try { validateUnderstandReport(output, input); return { durationMs: Date.now() - before, finished: true, outputShape: shape, validation: 'passed' } } catch (error) { return { durationMs: Date.now() - before, finished: true, outputShape: shape, validation: 'rejected', validationError: error instanceof Error ? error.message.slice(0, 240) : String(error) } }
  } catch (error) {
    return { durationMs: Date.now() - before, finished: false, error: error instanceof Error ? error.message.slice(0, 240) : String(error), observation: latestObservation() }
  }
  function latestObservation(): Observation | undefined { return observed.observations.at(-1) }
}

async function runHarnessControl(observed: ObservingRuntime, provider: string, model: string): Promise<void> {
  const options: GenerateOptions = { provider, model, temperature: 0, maxTokens: 128, messages: [createUserMessage({ content: [{ type: 'text', text: 'Return exactly this JSON object and nothing else: {"ok":true}' }], source: { kind: 'user' } })] }
  try { for await (const _chunk of observed.stream(options)) { /* observation wrapper only */ } } catch { /* recorded in observation */ }
}

function promptEvidence(request: KnowledgeCurationModelRequest): JsonRecord {
  const input = request.input as { document?: NormalizedResearchDocument; themeContext?: unknown }
  const document = input.document
  const serializedDocument = JSON.stringify(document ?? null)
  const serializedThemeContext = JSON.stringify(input.themeContext ?? null)
  const serializedInput = JSON.stringify(request.input)
  const serializedSchemaContext = JSON.stringify(request.schemaContext)
  const serializedOutputContract = JSON.stringify(request.outputContract)
  const prompt = exactAdapterPrompt(request)
  const normalizedCharacters = document?.normalizedText.length ?? 0
  const chunkCharacters = document?.chunks.reduce((sum, chunk) => sum + chunk.text.length, 0) ?? 0
  return { documentNormalizedTextCharacters: normalizedCharacters, documentChunks: document?.chunks.length ?? 0, documentChunkTextCharacters: chunkCharacters, serializedDocumentCharacters: serializedDocument.length, serializedThemeContextCharacters: serializedThemeContext.length, serializedOperationInputCharacters: serializedInput.length, schemaContextSerializedCharacters: serializedSchemaContext.length, outputContractSerializedCharacters: serializedOutputContract.length, instructionCharacters: request.instruction.length, finalModelPromptCharacters: prompt.length, finalModelPromptUtf8Bytes: Buffer.byteLength(prompt, 'utf8'), finalPromptSha256: createHash('sha256').update(prompt).digest('hex'), normalizedTextIncluded: serializedDocument.includes('normalizedText'), chunkTextsIncluded: document?.chunks.some((chunk) => serializedDocument.includes(JSON.stringify(chunk.text))) ?? false, documentTextDuplicationRatio: normalizedCharacters ? Number((chunkCharacters / normalizedCharacters).toFixed(4)) : null }
}

function exactAdapterPrompt(request: KnowledgeCurationModelRequest): string {
  return ['You are a ResearchHub Knowledge Curation model.', 'Return JSON only and follow the supplied Output Contract exactly.', 'Property names must exactly match the Output Contract; do not add undeclared properties.', 'Treat canonical enum values in the Schema Context as authoritative.', 'Do not invent references, durable IDs, sourceRefs, or rawRefs.', `Operation: ${request.operation}`, `Schema Context:\n${JSON.stringify(request.schemaContext)}`, `Output Contract:\n${JSON.stringify(request.outputContract)}`, `Instruction:\n${request.instruction}`, `Input:\n${JSON.stringify(request.input)}`].join('\n\n')
}

function staticEnvelopeEvidence(request: KnowledgeCurationModelRequest, document: NormalizedResearchDocument, context: KnowledgeContext): JsonRecord {
  const batches = sectionAndBatches(document).batches
  const understanding = { sourceAssessment: { sourceType: 'research_report', publisher: null, institution: null, author: null, publishedAt: null, primaryOrSecondary: 'unknown', sourceReliability: 'medium', sourceIdentityConfidence: 0, reasoning: [] }, researchScope: [], majorTopics: [], majorEntityMentions: [], themeHypotheses: [], uncertainty: [] }
  const sizes = batches.map((batch) => JSON.stringify({ workflowRunId: 'diagnostic', knowledgeBaseId: KNOWLEDGE_BASE_ID, document, batch, reportUnderstanding: understanding, knowledgeContext: context }).length).sort((a, b) => a - b)
  const reconciliationGroup = { groupId: 'diagnostic-group', candidateIds: [], candidates: [], existingKnowledge: [] }
  const reconciliationSize = JSON.stringify({ workflowRunId: 'diagnostic', knowledgeBaseId: KNOWLEDGE_BASE_ID, document, groups: [reconciliationGroup], sourceAssessment: understanding.sourceAssessment }).length
  const schemaGapSize = JSON.stringify({ workflowRunId: 'diagnostic', knowledgeBaseId: KNOWLEDGE_BASE_ID, document, candidates: [], knowledgeContext: context }).length
  return { currentRequestIncludes: ['document.normalizedText', 'all document.chunks', 'themeContext'], extraction: { batchCount: batches.length, minSerializedCharacters: sizes[0] ?? 0, medianSerializedCharacters: median(sizes), maxSerializedCharacters: sizes.at(-1) ?? 0, repeatsFullNormalizedText: true, repeatsAllDocumentChunks: true, repeatsCurrentBatch: true, reportUnderstanding: true, knowledgeContext: true }, reconciliation: { serializedCharacters: reconciliationSize, repeatsFullNormalizedText: true, repeatsAllDocumentChunks: true, groups: true, knowledgeContext: false }, schemaGap: { serializedCharacters: schemaGapSize, repeatsFullNormalizedText: true, repeatsAllDocumentChunks: true, knowledgeContext: true }, batchCoverage: { sections: sectionAndBatches(document).sections.length, batches: batches.length, chunkCount: document.chunks.length, uniqueCoveredChunks: new Set(batches.flatMap((batch) => batch.chunks.map((chunk) => chunk.chunkId))).size, omissions: document.chunks.length - new Set(batches.flatMap((batch) => batch.chunks.map((chunk) => chunk.chunkId))).size, duplicateCoverage: batches.flatMap((batch) => batch.chunks.map((chunk) => chunk.chunkId)).length - new Set(batches.flatMap((batch) => batch.chunks.map((chunk) => chunk.chunkId))).size } }
}

function projectUnderstandRequest(request: KnowledgeCurationModelRequest): KnowledgeCurationModelRequest {
  const input = request.input as { document: NormalizedResearchDocument; [key: string]: unknown }
  const { normalizedText: _normalizedText, ...projectedDocument } = input.document
  return { ...request, input: { ...input, document: projectedDocument } }
}

function classify(evidence: JsonRecord): JsonRecord {
  const current = evidence.currentPolicy as JsonRecord | undefined
  const control = evidence.harnessControl as Observation | undefined
  const off = evidence.reasoningOff as JsonRecord | undefined
  const projection = evidence.inputProjection as JsonRecord | undefined
  const bounded = evidence.maxTokensComparison as JsonRecord | undefined
  const currentObservation = findObservation(evidence, 'currentPolicy')
  const primary = currentObservation && currentObservation.counts['reasoning-delta'] > 0 && !finishedNormally(current ?? {}) && off && finishedNormally(off) ? 'LONG_REASONING_POLICY_CONFIRMED' : bounded && finishedNormally(bounded) && !finishedNormally(current ?? {}) ? 'GENERATION_BUDGET_TOO_LARGE' : projection && finishedNormally(projection) && !finishedNormally(current ?? {}) ? 'MODEL_INPUT_BLOAT_CONFIRMED' : control && control.counts['reasoning-delta'] === 0 && control.counts['text-delta'] > 0 && control.counts.finish > 0 && currentObservation && currentObservation.counts['reasoning-delta'] === 0 && currentObservation.counts['text-delta'] === 0 && currentObservation.counts.finish === 0 ? 'EXTERNAL_PROVIDER_QUEUE_CONFIRMED' : 'UNRESOLVED'
  return { primary, contributingFactors: { currentPolicyFinished: finishedNormally(current ?? {}), reasoningOffFinished: finishedNormally(off ?? {}), boundedFinished: finishedNormally(bounded ?? {}), projectedFinished: finishedNormally(projection ?? {}) } }
}

function findObservation(evidence: JsonRecord, label: ObservationLabel): Observation | undefined { const value = evidence[label]; return isRecord(value) && isRecord(value.observation) ? value.observation as unknown as Observation : undefined }

function finishedNormally(value: JsonRecord): boolean { return value.finished === true || value.finish === true }
function outputShape(value: unknown): JsonRecord { if (!isRecord(value)) return { type: Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value }; return { type: 'object', keys: Object.keys(value).sort() } }
function isRecord(value: unknown): value is JsonRecord { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function observeChunk(observation: Observation, chunk: StreamChunk, started: number): void { const now = Date.now(); const elapsed = now - started; if (!observation.firstChunk) { observation.firstChunk = new Date(now).toISOString(); observation.elapsedMs.firstChunk = elapsed } if (chunk.type in observation.counts) observation.counts[chunk.type as keyof Observation['counts']] += 1; if (chunk.type === 'reasoning-delta') { observation.reasoningCharacters += chunk.text.length; if (!observation.firstReasoningDelta) { observation.firstReasoningDelta = new Date(now).toISOString(); observation.elapsedMs.firstReasoningDelta = elapsed } } if (chunk.type === 'text-delta') { observation.textCharacters += chunk.text.length; if (!observation.firstTextDelta) { observation.firstTextDelta = new Date(now).toISOString(); observation.elapsedMs.firstTextDelta = elapsed } } if (chunk.type === 'usage' && !observation.firstUsage) { observation.firstUsage = new Date(now).toISOString(); observation.elapsedMs.firstUsage = elapsed } if (chunk.type === 'finish') { observation.finish = new Date(now).toISOString(); observation.elapsedMs.finish = elapsed; observation.finishReason = chunk.reason.kind } }
function summarizeOptions(options: GenerateOptions): JsonRecord { return { provider: options.provider, model: options.model, maxTokens: options.maxTokens ?? null, temperature: options.temperature ?? null, reasoningEffort: options.reasoningEffort ?? null, reasoningEffortPresence: options.reasoningEffort === undefined ? 'omitted' : 'explicit', messageCount: options.messages.length } }
function summarizeModelInfo(info: LlmResolvedModelInfo): JsonRecord { return { provider: info.provider, model: info.id, defaultMaxTokens: info.defaultMaxTokens ?? null, reasoning: info.reasoning ? { efforts: info.reasoning.efforts.map((effort) => String(effort.id)), defaultEffort: info.reasoning.defaultEffort ? String(info.reasoning.defaultEffort) : null } : null, contextWindow: info.context?.contextWindow ?? null } }
function median(values: number[]): number { if (!values.length) return 0; return values[Math.floor(values.length / 2)] ?? 0 }
function sectionAndBatches(document: NormalizedResearchDocument, maxChars = 6000): { sections: NonNullable<NormalizedResearchDocument['sections']>; batches: ExtractionBatch[] } { const groups = new Map<string, NormalizedResearchDocument['chunks']>(); for (const chunk of document.chunks) { const key = chunk.section?.trim() || '(untitled)'; groups.set(key, [...(groups.get(key) ?? []), chunk]) } const sections = [...groups.entries()].map(([title, chunks], index) => ({ sectionId: `section-${String(index + 1).padStart(4, '0')}`, title: title === '(untitled)' ? null : title, chunkIds: chunks.map((chunk) => chunk.chunkId) })); const batches: ExtractionBatch[] = []; let current: ExtractionBatch = { batchId: 'batch-0001', sections: [], chunks: [] }; const size = (chunks: NormalizedResearchDocument['chunks']): number => chunks.reduce((sum, chunk) => sum + chunk.text.length, 0); const flush = (): void => { if (current.chunks.length) batches.push(current); current = { batchId: `batch-${String(batches.length + 2).padStart(4, '0')}`, sections: [], chunks: [] } }; for (const section of sections) { const sectionChunks = section.chunkIds.map((id) => document.chunks.find((chunk) => chunk.chunkId === id)!).filter(Boolean); if (current.chunks.length && size(current.chunks) + size(sectionChunks) > maxChars) flush(); if (size(sectionChunks) <= maxChars) { current.sections.push({ ...section }); current.chunks.push(...sectionChunks); continue } for (const chunk of sectionChunks) { if (current.chunks.length && size(current.chunks) + chunk.text.length > maxChars) flush(); let batchSection = current.sections.find((item) => item.sectionId === section.sectionId); if (!batchSection) { batchSection = { sectionId: section.sectionId, title: section.title, chunkIds: [] }; current.sections.push(batchSection) } batchSection.chunkIds.push(chunk.chunkId); current.chunks.push(chunk) } } flush(); return { sections, batches } }
async function createDiagnosticKnowledgeBase(): Promise<string> { const root = await mkdtemp(join(tmpdir(), 'researchhub-c006-v03-')); await mkdir(join(root, 'registry'), { recursive: true }); await writeFile(join(root, 'manifest.yaml'), `${canonicalSerialize({ knowledgeBaseId: KNOWLEDGE_BASE_ID, name: 'C-006 disposable diagnostic KB', schemaVersion: '0.3', storageFormatVersion: '1', revision: 0, status: 'active', createdAt: '2026-08-31T00:00:00.000Z', updatedAt: '2026-08-31T00:00:00.000Z' })}\n`, 'utf8'); await writeFile(join(root, 'registry/assets.yaml'), '{}\n', 'utf8'); await writeFile(join(root, 'registry/raw.yaml'), '{}\n', 'utf8'); return root }
class RecordingParser implements DocumentParser {
  readonly id: string
  result: DocumentParseResult | undefined
  constructor(private readonly delegate: DocumentParser) { this.id = delegate.id }
  supports(input: Pick<DocumentParseInput, 'filename' | 'mediaType'>): boolean { return this.delegate.supports(input) }
  async parse(input: DocumentParseInput): Promise<DocumentParseResult> { this.result = await this.delegate.parse(input); return this.result }
}
async function credentialEvidence(baseUrl: string, apiKey: string | undefined, model: string): Promise<JsonRecord & { match: boolean }> { const raw = await readFile('.env', 'utf8'); const line = raw.split(/\r?\n/).find((item) => /^\s*DEEPSEEK_API_KEY\s*=/.test(item)); const envKey = line ? line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '') : ''; const fp = (value: string | undefined): string | null => value ? createHash('sha256').update(value).digest('hex').slice(0, 12) : null; const response = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, { headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` } }); const body = await response.json() as { data?: unknown[] }; const ids = (body.data ?? []).filter((item): item is { id: string } => isRecord(item) && typeof item.id === 'string').map((item) => item.id); return { envFingerprint: fp(envKey), processFingerprint: fp(apiKey), envLength: envKey.length, processLength: apiKey?.length ?? 0, match: envKey.length === (apiKey?.length ?? 0) && fp(envKey) === fp(apiKey), modelsHttpStatus: response.status, modelAvailable: ids.includes(model) } }
function redactUrl(value: string): string { try { const url = new URL(value); return `${url.protocol}//${url.host}` } catch { return '[configured]' } }
async function writeEvidence(path: string, value: JsonRecord): Promise<void> { await mkdir(resolve(path, '..'), { recursive: true }); await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8') }

await main()
