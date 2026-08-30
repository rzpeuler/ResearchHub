import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { basename, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { KnowledgeCurationSkill } from '../../packages/skills/knowledge-curation/index.ts'
import type { KnowledgeCurationModel, KnowledgeCurationModelRequest } from '../../packages/skills/knowledge-curation/index.ts'
import { LocalResearchReportInputResolver } from '../../packages/plugins/document/index.ts'
import type { DocumentParseInput, DocumentParseResult, DocumentParser } from '../../packages/plugins/document/types.ts'
import { ResearchReportKnowledgeIngestionWorkflow } from '../../packages/workflows/research-report-knowledge-ingestion/index.ts'
import type { ResearchReportKnowledgeIngestionResult } from '../../packages/workflows/research-report-knowledge-ingestion/index.ts'
import { KnowledgeBaseLoader, KnowledgeBaseRegistry, KnowledgeWriter, canonicalSerialize } from '../../packages/shared/knowledge-base/index.ts'
import { createKnowledgeStagedStateValidator, KnowledgeValidationSkill } from '../../packages/skills/knowledge-validation/index.ts'
import type { KnowledgeBaseHandle } from '../../packages/shared/knowledge-base/index.ts'
import { loadLocalRuntimeConfig, LocalRuntimeConfigError } from '../../dsh/llm-runtime/local-runtime-config.ts'
import { createRealKnowledgeCurationModel } from './deepseek-composition.ts'
import { inspectDoclingRuntime } from '../document-parser/doctor-docling.ts'

const execFileAsync = promisify(execFile)
const TASK_ID = 'KNOWLEDGE-V0.3-PRODUCT-VALIDATION-C-004-R2'
const BASELINE = 'bd55e759cf65f31f3980fffc66d984686318484c'
const KNOWLEDGE_BASE_ID = 'kb-product-validation-c004-r2'
const EXPECTED_PDF_SHA256 = '998703cef102300518bb2edcbcc3e9bc26fa374f157b0714f3986c5028d78d63'
const DEFAULT_PDF = 'C:\\Users\\Administrator\\Documents\\20260805-西部证券-AI算力行业：AI算力上游材料产业链研究报告.pdf'

type JsonRecord = Record<string, unknown>
type CredentialSourceEvidence = JsonRecord & { match: boolean; diagnostic: string }
type ParserEvidence = JsonRecord & { chunks: number; uniqueChunkIds: number; emptyChunks: number }

class RecordingParser implements DocumentParser {
  readonly id: string
  result: DocumentParseResult | undefined

  constructor(private readonly delegate: DocumentParser) { this.id = delegate.id }

  supports(input: Pick<DocumentParseInput, 'filename' | 'mediaType'>): boolean { return this.delegate.supports(input) }

  async parse(input: DocumentParseInput): Promise<DocumentParseResult> {
    const result = await this.delegate.parse(input)
    this.result = result
    return result
  }
}

type RecordedModelCall = {
  operation: string
  slice: string | undefined
  batchId?: string
  groupId?: string
  succeeded: boolean
  retryCount: 0
  outputShape?: JsonRecord
  error?: string
}

class RecordingModel implements KnowledgeCurationModel {
  readonly calls: RecordedModelCall[] = []

  constructor(private readonly delegate: KnowledgeCurationModel) {}

  async invoke(request: KnowledgeCurationModelRequest): Promise<unknown> {
    const input = isRecord(request.input) ? request.input : undefined
    const batch = input && isRecord(input.batch) ? input.batch : undefined
    const call: RecordedModelCall = {
      operation: request.operation,
      slice: request.schemaContext?.slice,
      batchId: typeof batch?.batchId === 'string' ? batch.batchId : undefined,
      groupId: typeof input?.groupId === 'string' ? input.groupId : undefined,
      succeeded: false,
      retryCount: 0,
    }
    this.calls.push(call)
    try {
      const output = await this.delegate.invoke(request)
      call.succeeded = true
      call.outputShape = outputShape(output)
      return output
    } catch (error) {
      call.error = error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240)
      throw error
    }
  }
}

async function main(): Promise<void> {
  const evidencePath = process.env.RESEARCHHUB_PRODUCT_VALIDATION_EVIDENCE ?? join(tmpdir(), 'researchhub-knowledge-v03-c004-r2-evidence.json')
  const durableEvidencePath = process.env.RESEARCHHUB_PRODUCT_VALIDATION_DURABLE_EVIDENCE
  let root: string | undefined
  const keepRoot = process.env.RESEARCHHUB_KEEP_PRODUCT_VALIDATION_KB === '1'
  const evidence: JsonRecord = { taskId: TASK_ID, baseline: BASELINE, startedAt: new Date().toISOString() }
  try {
    const git = await gitPreflight()
    evidence.baselineCheck = git
    if (git.matchesExpected !== true || git.workingTreeClean !== true || git.productionFilesChanged === true) throw new ProductValidationStop('Blocked / Baseline Preflight Failed', JSON.stringify(git))
    const config = loadLocalRuntimeConfig(process.env, process.cwd(), { requireRealLlm: true })
    evidence.runtime = { provider: config.provider, model: config.model, baseUrl: redactUrl(config.baseUrl), curationMaxTokens: config.curationMaxTokens, credentialsPresent: Boolean(config.apiKey) }
    const credentialSource = await inspectCredentialSource()
    evidence.credentialSource = credentialSource
    if (credentialSource.match !== true) throw new ProductValidationStop('Blocked / Environment Credential Override', credentialSource.diagnostic)
    const llmPreflight = await verifyDeepSeekCredentials(config.baseUrl, config.apiKey, config.model)
    evidence.llmPreflight = llmPreflight
    if (llmPreflight.status !== 'READY') throw new ProductValidationStop('Blocked / Runtime Credential Invalid', llmPreflight.diagnostic)
    const pdfPath = resolve(process.env.RESEARCHHUB_PRODUCT_VALIDATION_PDF ?? DEFAULT_PDF)
    await access(pdfPath)
    const pdfBytes = Uint8Array.from(await readFile(pdfPath))
    const pdfHash = createHash('sha256').update(pdfBytes).digest('hex')
    evidence.pdf = { filename: basename(pdfPath), path: pdfPath, sha256: pdfHash, bytes: pdfBytes.byteLength }
    if (pdfHash !== EXPECTED_PDF_SHA256) throw new ProductValidationStop('Blocked / PDF Artifact Mismatch', `Expected ${EXPECTED_PDF_SHA256}, received ${pdfHash}`)

    const doctor = await inspectDoclingRuntime()
    evidence.parserPreflight = doctor
    if (doctor.status !== 'READY') throw new ProductValidationStop('Blocked / Real PDF Parser Missing', doctor.diagnostics.join(', '))

    root = await createIsolatedV03KnowledgeBase()
    const loader = new KnowledgeBaseLoader({ registry: new KnowledgeBaseRegistry() })
    const initial = await loader.mount(root)
    const validation = new KnowledgeValidationSkill({ loader })
    const initialValidation = await validation.validateKnowledgeBase(initial, 'all')
    evidence.isolatedKnowledgeBase = { root: keepRoot ? root : 'system-temp (removed after run)', knowledgeBaseId: initial.knowledgeBaseId, schemaVersion: initial.schemaVersion, storageFormatVersion: initial.storageFormatVersion, initialRevision: initial.revision, seedObjects: 0, target: 'KnowledgeIndexV03', writable: initial.writable, fullValidation: initialValidation.status }
    if (initial.schemaVersion !== '0.3' || initial.storageFormatVersion !== '1' || initial.revision !== 0 || !initial.writable || initialValidation.status !== 'passed') throw new ProductValidationStop('Blocked / Isolated KB Preflight Failed', JSON.stringify(initialValidation.errors.slice(0, 5)))

    const parser = new RecordingParser(new (await import('../../packages/plugins/document/docling-document-parser.ts')).DoclingDocumentParser())
    const resolver = new LocalResearchReportInputResolver({ documentParser: parser, parserId: parser.id })
    const realRuntime = await createRealKnowledgeCurationModel(config)
    const model = new RecordingModel(realRuntime.model)
    let writerInvocations = 0
    const writer = new KnowledgeWriter({ loader, stagedStateValidator: createKnowledgeStagedStateValidator(validation) })
    const workflow = new ResearchReportKnowledgeIngestionWorkflow({
      targetResolver: createTargetResolver(root),
      inputResolver: resolver,
      curation: new KnowledgeCurationSkill({ model }),
      validation,
      writer: { write: async (handle, receipt) => { writerInvocations += 1; return writer.write(handle, receipt) } },
    })
    try {
      const first = await workflow.execute(inputFor(pdfPath, 'product-validation-c004-r2-first', true))
      const parserSummary = parserEvidence(parser.result)
      evidence.parser = parserSummary
      if (parserSummary.uniqueChunkIds !== parserSummary.chunks || parserSummary.emptyChunks !== 0) throw new ProductValidationStop('FAIL / SOL REVIEW REQUIRED', 'Docling output failed chunk integrity checks')
      evidence.firstRun = await runEvidence(first, model, writerInvocations, 0, 0)
      if (first.status === 'blocked') throw new ProductValidationStop('FAIL / SOL REVIEW REQUIRED', JSON.stringify(first.errors))
      const replayCallsBefore = model.calls.length
      const replayWriterBefore = writerInvocations
      const replay = await workflow.execute(inputFor(pdfPath, 'product-validation-c004-r2-replay', false))
      evidence.replay = await runEvidence(replay, model, writerInvocations, replayCallsBefore, replayWriterBefore)
      if (replay.status === 'blocked') throw new ProductValidationStop('FAIL / SOL REVIEW REQUIRED', JSON.stringify(replay.errors))
      const reprocessCallsBefore = model.calls.length
      const reprocessWriterBefore = writerInvocations
      const reprocess = await workflow.execute(inputFor(pdfPath, 'product-validation-c004-r2-reprocess', true))
      evidence.reprocess = await runEvidence(reprocess, model, writerInvocations, reprocessCallsBefore, reprocessWriterBefore)
      if (reprocess.status === 'blocked') throw new ProductValidationStop('FAIL / SOL REVIEW REQUIRED', JSON.stringify(reprocess.errors))
      const finalTarget = await resolveTarget(root)
      const finalValidation = await validation.validateKnowledgeBase(finalTarget.handle, 'all')
      evidence.finalKnowledgeBase = { revision: finalTarget.handle.revision, counts: indexCounts(finalTarget.index), fullValidation: finalValidation.status, validationErrors: finalValidation.errors.slice(0, 10) }
      evidence.writer = { invocations: writerInvocations, expected: '0 or 1 per workflow execution; no direct filesystem semantic writes' }
      evidence.semanticSampling = semanticSamples(finalTarget.index, parser.result)
      evidence.provenanceSampling = provenanceSamples(finalTarget.index, parser.result)
      evidence.completedAt = new Date().toISOString()
      evidence.status = finalValidation.status === 'passed' ? 'TECHNICAL PASS / PRODUCT QUALITY REVIEW REQUIRED' : 'FAIL / SOL REVIEW REQUIRED'
      evidence.recommendation = finalValidation.status === 'passed' ? 'Review semantic and provenance samples before Sol acceptance.' : 'Engineering rework required; preserve diagnostics.'
      await persistEvidence(evidencePath, durableEvidencePath, evidence)
      console.log(JSON.stringify({ status: evidence.status, evidencePath, isolatedKnowledgeBase: keepRoot ? root : 'removed', parser: evidence.parser, firstRun: summarizeRun(first), replay: summarizeRun(replay), reprocess: summarizeRun(reprocess), finalKnowledgeBase: evidence.finalKnowledgeBase, writer: evidence.writer }))
    } finally { await realRuntime.close() }
  } catch (error) {
    evidence.completedAt = new Date().toISOString()
    evidence.status = error instanceof ProductValidationStop ? error.status : error instanceof LocalRuntimeConfigError && error.code === 'missing_deepseek_api_key' ? 'Blocked / Runtime Credential Missing' : 'FAIL / SOL REVIEW REQUIRED'
    evidence.failure = { message: error instanceof Error ? error.message : String(error) }
    await persistEvidence(evidencePath, durableEvidencePath, evidence)
    console.log(JSON.stringify({ status: evidence.status, evidencePath, failure: evidence.failure, isolatedKnowledgeBase: keepRoot ? root : 'removed' }))
    process.exitCode = 1
  } finally {
    if (root && !keepRoot) await rm(root, { recursive: true, force: true })
  }
}

function inputFor(pdfPath: string, workflowRunId: string, reprocess: boolean) {
  return { workflowRunId, knowledgeBaseId: KNOWLEDGE_BASE_ID, report: { inputRef: { type: 'file' as const, reference: pdfPath }, suppliedMetadata: { title: basename(pdfPath), publisher: null, institution: null, author: null, publishedAt: null, sourceUrl: null } }, options: { mode: 'commit' as const, reprocess } }
}

function createTargetResolver(root: string) {
  return { async resolve(): Promise<{ handle: KnowledgeBaseHandle; index: import('../../packages/shared/knowledge-base/knowledge-index-v03.ts').KnowledgeIndexV03 }> { return resolveTarget(root) } }
}

async function resolveTarget(root: string): Promise<{ handle: KnowledgeBaseHandle; index: import('../../packages/shared/knowledge-base/knowledge-index-v03.ts').KnowledgeIndexV03 }> {
  const loader = new KnowledgeBaseLoader({ registry: new KnowledgeBaseRegistry() })
  const handle = await loader.mount(root)
  const state = await loader.loadRuntimeState(handle)
  if (!(state.index instanceof (await import('../../packages/shared/knowledge-base/knowledge-index-v03.ts')).KnowledgeIndexV03)) throw new Error('isolated target is not KnowledgeIndexV03')
  return { handle, index: state.index }
}

async function createIsolatedV03KnowledgeBase(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-c004-r2-v03-'))
  await mkdir(join(root, 'registry'), { recursive: true })
  await writeFile(join(root, 'manifest.yaml'), `${canonicalSerialize({ knowledgeBaseId: KNOWLEDGE_BASE_ID, name: 'C-004-R2 disposable real PDF validation KB', schemaVersion: '0.3', storageFormatVersion: '1', revision: 0, status: 'active', createdAt: '2026-08-31T00:00:00.000Z', updatedAt: '2026-08-31T00:00:00.000Z' })}\n`, 'utf8')
  await writeFile(join(root, 'registry/assets.yaml'), '{}\n', 'utf8')
  await writeFile(join(root, 'registry/raw.yaml'), '{}\n', 'utf8')
  return root
}

async function gitPreflight(): Promise<JsonRecord> {
  const head = (await execFileAsync('git', ['rev-parse', 'HEAD'])).stdout.trim()
  const status = (await execFileAsync('git', ['status', '--porcelain'])).stdout.trim()
  const changedSinceBaseline = (await execFileAsync('git', ['diff', '--name-only', `${BASELINE}..HEAD`])).stdout.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
  const matchesExpected = head === BASELINE || await execFileAsync('git', ['merge-base', '--is-ancestor', BASELINE, head]).then(() => true).catch(() => false)
  const productionFilesChanged = changedSinceBaseline.some((file) => !isAllowedEvidencePath(file))
  return { head, expected: BASELINE, matchesExpected, workingTreeClean: status === '', changedSinceBaseline, productionFilesChanged }
}
function isAllowedEvidencePath(file: string): boolean { return file.startsWith('tools/knowledge-product-validation/') || file.startsWith('tests/knowledge/product-validation/') || file.startsWith('docs/project-management/') }

async function inspectCredentialSource(): Promise<CredentialSourceEvidence> {
  const raw = await readFile('.env', 'utf8')
  const definitions = raw.split(/\r?\n/).filter((line) => /^\s*DEEPSEEK_API_KEY\s*=/.test(line))
  const envFileKey = parseDotEnvValue(definitions[0])
  const processKey = process.env.DEEPSEEK_API_KEY
  const envSummary = credentialSummary(envFileKey)
  const processSummary = credentialSummary(processKey)
  const fingerprintMatch = envSummary.fingerprint === processSummary.fingerprint
  const lengthMatch = envSummary.length === processSummary.length
  return { definitionCount: definitions.length, envFile: envSummary, process: processSummary, fingerprintMatch, lengthMatch, match: definitions.length === 1 && fingerprintMatch && lengthMatch, diagnostic: fingerprintMatch && lengthMatch ? 'Process credential matches .env credential' : 'Process credential does not match .env credential' }
}

function parseDotEnvValue(line: string | undefined): string | undefined {
  if (!line) return undefined
  const value = line.slice(line.indexOf('=') + 1).trim()
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) return value.slice(1, -1)
  return value.replace(/\s+#.*$/, '').trim()
}

function credentialSummary(value: string | undefined): JsonRecord { return { present: Boolean(value), length: value?.length ?? 0, fingerprint: value ? createHash('sha256').update(value).digest('hex').slice(0, 12) : null, startsWithSk: value?.startsWith('sk-') ?? false, containsBearerPrefix: value ? /^Bearer\s+/i.test(value) : false, containsWhitespaceInside: value ? /\s/.test(value) : false, containsNewline: value ? /[\r\n]/.test(value) : false, containsQuoteCharacterAfterParsing: value ? /["']/.test(value) : false } }

function parserEvidence(result: DocumentParseResult | undefined): ParserEvidence { const chunks = result?.chunks ?? []; return { parser: result?.parser ?? null, pageCount: result?.pageCount ?? result?.quality?.pageCount ?? null, chunks: chunks.length, uniqueChunkIds: new Set(chunks.map((chunk) => chunk.chunkId)).size, emptyChunks: chunks.filter((chunk) => !chunk.text.trim()).length, sections: new Set(chunks.map((chunk) => chunk.section).filter((section): section is string => Boolean(section))).size, tables: result?.structure?.tableCount ?? result?.quality?.tableCount ?? null, images: result?.structure?.imageCount ?? result?.quality?.imageCount ?? null, normalizedCharacters: result?.quality?.normalizedCharacters ?? result?.normalizedText.length ?? 0, warnings: result?.quality?.warnings ?? [] } }

async function runEvidence(result: ResearchReportKnowledgeIngestionResult, model: RecordingModel, writerInvocations: number, callStart: number, writerStart: number): Promise<JsonRecord> {
  const calls = result.modelCalls
  const runModelCalls = model.calls.slice(callStart)
  const batchSizes = result.batches.batches.map((batch) => batch.chunkIds.length)
  const charSizes = result.batches.batches.map((batch) => batch.characterCount)
  const groups = model.calls.filter((call) => call.operation === 'reconcileKnowledge').map((call) => ({ groupId: call.groupId, batchId: call.batchId, slice: call.slice }))
  const decisionCount = Object.values(result.reconciliation.decisions).reduce((sum, count) => sum + count, 0)
  return { status: result.status, workflowRunId: result.workflowRunId, raw: result.raw, source: result.source ? { sourceId: result.source.sourceId, resolution: result.source.resolution, rawRefs: result.source.source.rawRefs ?? [] } : null, understanding: result.reportUnderstanding ? { sourceType: result.reportUnderstanding.sourceAssessment.sourceType, sourceReliability: result.reportUnderstanding.sourceAssessment.sourceReliability, publisher: result.reportUnderstanding.sourceAssessment.publisher, institution: result.reportUnderstanding.sourceAssessment.institution, publishedAt: result.reportUnderstanding.sourceAssessment.publishedAt, sourceIdentityConfidence: result.reportUnderstanding.sourceAssessment.sourceIdentityConfidence, researchScopeCount: result.reportUnderstanding.researchScope.length, majorTopics: result.reportUnderstanding.majorTopics.slice(0, 12), majorEntityMentionCount: result.reportUnderstanding.majorEntityMentions.length, themeHypotheses: result.reportUnderstanding.themeHypotheses.map((item) => ({ mention: short(item.mention), disposition: item.disposition })), uncertaintyCount: result.reportUnderstanding.uncertainty.length } : null, batching: { sections: result.batches.sectionCount, batches: result.batches.batchCount, chunkCount: result.batches.chunkCount, uniqueChunkCount: new Set(result.batches.chunkIds).size, coveredChunkCount: new Set(result.batches.batches.flatMap((batch) => batch.chunkIds)).size, duplicateCoverage: result.batches.batches.flatMap((batch) => batch.chunkIds).length - new Set(result.batches.batches.flatMap((batch) => batch.chunkIds)).size, omittedChunkCount: result.batches.chunkCount - new Set(result.batches.batches.flatMap((batch) => batch.chunkIds)).size, chunkCountMin: Math.min(...batchSizes), chunkCountMax: Math.max(...batchSizes), chunkCountMedian: median(batchSizes), characterMin: Math.min(...charSizes), characterMax: Math.max(...charSizes), characterMedian: median(charSizes), oversizedSectionSplits: splitSections(result.batches) }, extraction: result.extraction, consolidation: result.consolidation, resolution: result.referenceResolution, reconciliation: { ...result.reconciliation, modelCalls: calls.filter((call) => call.operation === 'reconcileKnowledge').length, decisionCount, coverage: { candidates: result.reconciliation.candidates, decisions: decisionCount, exactlyOnce: result.reconciliation.candidates === decisionCount } }, schemaGaps: { calls: calls.filter((call) => call.operation === 'analyzeSchemaGaps').length, outputs: result.schemaGaps.map((gap) => ({ candidateRefs: gap.candidateRefs, gapType: gap.gapType })) }, reviews: { roots: result.reviewItems.filter((item) => item.candidateId && item.category !== 'dependency_review').length, dependencyClosure: result.reviewItems.filter((item) => item.category === 'dependency_review').length, total: result.reviewItems.length }, validation: result.validation, writerInvocations: writerInvocations - writerStart, callsByOperation: calls.map((call) => ({ operation: call.operation, groupId: call.groupId, attempted: call.attempted, succeeded: call.succeeded, retryCount: call.retryCount })), recordedModelCalls: runModelCalls.map((call) => ({ operation: call.operation, slice: call.slice, batchId: call.batchId, groupId: call.groupId, succeeded: call.succeeded, retryCount: call.retryCount, outputShape: call.outputShape, error: call.error })) }
}

function semanticSamples(index: import('../../packages/shared/knowledge-base/knowledge-index-v03.ts').KnowledgeIndexV03, parsed: DocumentParseResult | undefined): JsonRecord { return { entities: [...index.entities.values()].slice(0, 5).map((item) => ({ id: item.id, type: item.type, name: short(item.name), aliases: (item.aliases ?? []).slice(0, 5) })), relations: [...index.relations.values()].slice(0, 5).map((item) => ({ id: item.id, type: item.type, sourceRef: item.sourceRef, targetRef: item.targetRef, attributes: item.attributes ?? null })), claims: [...index.claims.values()].slice(0, 10).map((item) => ({ id: item.id, claimType: item.claimType, statement: short(item.statement), subjectRefs: item.subjectRefs, temporal: item.temporal ?? null, structuredValue: item.structuredValue ?? null, sourceRefs: item.sourceRefs ?? [], provenance: item.provenance ?? [] })), temporalClaimCount: [...index.claims.values()].filter((item) => item.temporal !== undefined && item.temporal !== null).length, parsedChunkCount: parsed?.chunks.length ?? null, manualClassification: 'pending Sol review' } }

function provenanceSamples(index: import('../../packages/shared/knowledge-base/knowledge-index-v03.ts').KnowledgeIndexV03, parsed: DocumentParseResult | undefined): JsonRecord { const chunks = new Map((parsed?.chunks ?? []).map((chunk) => [chunk.chunkId, chunk.text])); return { claims: [...index.claims.values()].slice(0, 10).map((claim) => ({ claimId: claim.id, sourceRefs: claim.sourceRefs ?? [], provenance: (claim.provenance ?? []).map((item) => ({ sourceRef: item.sourceRef, rawRef: item.rawRef, chunkRef: item.chunkRef, excerpt: item.chunkRef ? short(chunks.get(item.chunkRef) ?? '', 180) : null })) })), manualSupportClassification: 'pending Sol review' } }

function indexCounts(index: import('../../packages/shared/knowledge-base/knowledge-index-v03.ts').KnowledgeIndexV03): JsonRecord { return { themeGroups: index.themeGroups.size, investmentThemes: [...index.entities.values()].filter((item) => item.type === 'investment_theme').length, industries: [...index.entities.values()].filter((item) => item.type === 'industry').length, companies: [...index.entities.values()].filter((item) => item.type === 'company').length, products: [...index.entities.values()].filter((item) => item.type === 'product').length, technologies: [...index.entities.values()].filter((item) => item.type === 'technology').length, relations: index.relations.size, claims: index.claims.size, sources: index.sources.size, modules: index.modules.size, rawRefs: new Set([...index.sources.values()].flatMap((source) => source.rawRefs ?? [])).size } }

function outputShape(value: unknown): JsonRecord { if (!isRecord(value)) return { type: Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value }; return { type: 'object', keys: Object.keys(value).sort(), entities: Array.isArray(value.entities) ? value.entities.length : undefined, relations: Array.isArray(value.relations) ? value.relations.length : undefined, claims: Array.isArray(value.claims) ? value.claims.length : undefined, decisions: Array.isArray(value.decisions) ? value.decisions.length : undefined, gaps: Array.isArray(value.gaps) ? value.gaps.length : undefined } }
function isRecord(value: unknown): value is JsonRecord { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function short(value: string, max = 180): string { const normalized = value.replace(/\s+/g, ' ').trim(); return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized }
function median(values: number[]): number { if (!values.length) return 0; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)] ?? 0 }
function splitSections(summary: ResearchReportKnowledgeIngestionResult['batches']): string[] { const counts = new Map<string, number>(); for (const batch of summary.batches) for (const sectionId of batch.sectionIds) counts.set(sectionId, (counts.get(sectionId) ?? 0) + 1); return [...counts.entries()].filter(([, count]) => count > 1).map(([sectionId]) => sectionId) }
function summarizeRun(result: ResearchReportKnowledgeIngestionResult): JsonRecord { return { status: result.status, raw: result.raw, source: result.source ? { sourceId: result.source.sourceId, resolution: result.source.resolution } : null, revision: { before: result.baseRevision, after: result.finalRevision }, extraction: result.extraction, consolidation: result.consolidation, resolution: result.referenceResolution, reconciliation: result.reconciliation, validation: result.validation?.status ?? null, modelCalls: result.modelCalls.length, errors: result.errors } }
function redactUrl(value: string): string { try { const url = new URL(value); return `${url.protocol}//${url.host}` } catch { return '[configured]' } }
async function verifyDeepSeekCredentials(baseUrl: string, apiKey: string | undefined, model: string): Promise<JsonRecord & { status: string; diagnostic: string }> {
  if (!apiKey) return { status: 'BLOCKED', diagnostic: 'DEEPSEEK_API_KEY is not configured' }
  try {
    const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
    const response = await fetch(`${normalizedBaseUrl}/models`, { headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` } })
    if (!response.ok) return { status: 'BLOCKED', httpStatus: response.status, diagnostic: `DeepSeek /models rejected credentials with HTTP ${response.status}` }
    const body = await response.json() as { data?: unknown }
    const availableModels = Array.isArray(body.data) ? body.data.filter((item): item is { id: string } => isRecord(item) && typeof item.id === 'string') : []
    const modelAvailable = availableModels.some((item) => item.id === model)
    if (!modelAvailable) return { status: 'BLOCKED', httpStatus: response.status, modelAvailable: false, diagnostic: `Configured model ${model} is not present in DeepSeek /models` }
    return { status: 'READY', httpStatus: response.status, modelAvailable: true, diagnostic: 'DeepSeek credential and configured model accepted by /models' }
  } catch (error) {
    return { status: 'BLOCKED', diagnostic: `DeepSeek credential preflight transport failure: ${error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180)}` }
  }
}
async function writeEvidence(path: string, value: JsonRecord): Promise<void> { await mkdir(resolve(path, '..'), { recursive: true }); await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8') }
async function persistEvidence(tempPath: string, durablePath: string | undefined, value: JsonRecord): Promise<void> { await writeEvidence(tempPath, value); if (durablePath) await writeEvidence(durablePath, value) }

class ProductValidationStop extends Error {
  constructor(readonly status: string, message: string) { super(message) }
}

await main()
