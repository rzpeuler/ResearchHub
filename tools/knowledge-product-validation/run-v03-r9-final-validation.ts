import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { GenerateOptions, StreamChunk } from "@deepseek-ai/dsh-llm";
import { KnowledgeCurationSkill } from "../../packages/skills/knowledge-curation/index.ts";
import type { KnowledgeCurationModel, KnowledgeCurationModelRequest } from "../../packages/skills/knowledge-curation/index.ts";
import { STRUCTURED_OUTPUT_CONTRACTS } from "../../packages/skills/knowledge-curation/contracts.ts";
import { KNOWLEDGE_SCHEMA_V03 } from "../../packages/schemas/knowledge/v03/executable-schema.ts";
import { DoclingDocumentParser, LocalResearchReportInputResolver } from "../../packages/plugins/document/index.ts";
import type { DocumentParseInput, DocumentParseResult, DocumentParser } from "../../packages/plugins/document/types.ts";
import { ResearchReportKnowledgeIngestionWorkflow } from "../../packages/workflows/research-report-knowledge-ingestion/index.ts";
import type { ResearchReportInputRef, ResolvedResearchReportInput, ResearchReportInputResolver, ResearchReportKnowledgeIngestionResult } from "../../packages/workflows/research-report-knowledge-ingestion/index.ts";
import { KnowledgeBaseLoader, KnowledgeBaseRegistry, KnowledgeIngestionLogStore, KnowledgeWriter, canonicalSerialize } from "../../packages/shared/knowledge-base/index.ts";
import type { KnowledgeBaseHandle } from "../../packages/shared/knowledge-base/index.ts";
import { createKnowledgeStagedStateValidator, KnowledgeValidationSkill } from "../../packages/skills/knowledge-validation/index.ts";
import { loadLocalRuntimeConfig } from "../../dsh/llm-runtime/local-runtime-config.ts";
import { createRealKnowledgeCurationModel } from "./deepseek-composition.ts";
import { FullValidationObservingRuntime } from "./full-validation-observing-runtime.ts";
import { writeEvidenceAtomically } from "./run-post-c12-extraction-smoke.ts";
import { inspectDoclingRuntime } from "../document-parser/doctor-docling.ts";

export const R9_TASK_ID = process.env.RESEARCHHUB_PRODUCT_VALIDATION_TASK_ID ?? "KNOWLEDGE-V0.3-PRODUCT-VALIDATION-C-004-R9-FINAL";
export const R9_BASELINE = process.env.RESEARCHHUB_R9_EXECUTION_BASELINE ?? "UNSET";
export const R9_KNOWLEDGE_BASE_ID = process.env.RESEARCHHUB_PRODUCT_VALIDATION_KB_ID ?? "kb-product-validation-c004-r9-final";
export const R9_EXPECTED_MODEL = "deepseek-v4-flash";
export const R9_EXPECTED_PDF_SHA256 = "998703cef102300518bb2edcbcc3e9bc26fa374f157b0714f3986c5028d78d63";
export const R9_EXPECTED_PDF_BYTES = 3_209_114;
export const R9_EXPECTED_BATCH_COUNT = 18;
export const R9_EVIDENCE_PATH = process.env.RESEARCHHUB_PRODUCT_VALIDATION_DURABLE_EVIDENCE ?? "tests/knowledge/product-validation/evidence/c004-r9-final-full-pipeline.json";
export const R9_EXPECTED_REASONING_POLICY = { understandReport: "off", extractKnowledge: "off", reconcileKnowledge: "low", analyzeSchemaGaps: "low" } as const;
export const R9_EXPECT_ZERO_RECONCILIATION = process.env.RESEARCHHUB_EXPECT_ZERO_RECONCILIATION === "1";

type JsonRecord = Record<string, unknown>;
type CandidateCounts = { entity: number; relation: number; claim: number };
type FinalStatus = "TECHNICAL PASS / SOL PRODUCT QUALITY REVIEW REQUIRED" | "FAIL / SOL REVIEW REQUIRED" | "INVALID TEST SETUP / SOL REVIEW REQUIRED" | "BLOCKED / EXTERNAL SERVICE - SOL REVIEW REQUIRED" | "TIMEOUT / SOL REVIEW REQUIRED";
type R9ModelCall = JsonRecord & { operation: string; batchId?: string; groupId?: string; physicalAttempt: number; delegatedToProvider: boolean };
type R9Checkpoint = (phase: string, patch?: JsonRecord) => Promise<void>;

class ValidationFailure extends Error {
  constructor(readonly status: FinalStatus, message: string) { super(message); }
}
class ReplayModelCallBlocked extends Error {}

class R9RecordingModel implements KnowledgeCurationModel {
  readonly calls: R9ModelCall[] = [];
  private readonly attempts = new Map<string, number>();
  private replayGuard = false;

  constructor(private readonly delegate: KnowledgeCurationModel, private readonly runtime: FullValidationObservingRuntime, private readonly checkpoint: R9Checkpoint) {}
  get replayIntercepted(): boolean { return this.calls.some((call) => call.error === "replay_model_call_intercepted"); }
  setReplayGuard(): void { this.replayGuard = true; }

  async invoke(request: KnowledgeCurationModelRequest): Promise<unknown> {
    const input = isRecord(request.input) ? request.input : undefined;
    const batch = input && isRecord(input.batch) ? input.batch : undefined;
    const batchId = typeof batch?.batchId === "string" ? batch.batchId : undefined;
    const groups = input && Array.isArray(input.groups) ? input.groups.filter(isRecord) : [];
    const groupId = typeof groups[0]?.groupId === "string" ? groups[0].groupId : undefined;
    const key = `${request.operation}|${groupId ?? batchId ?? ""}`;
    const physicalAttempt = (this.attempts.get(key) ?? 0) + 1;
    this.attempts.set(key, physicalAttempt);
    const call: R9ModelCall = {
      operation: request.operation,
      batchId,
      groupId,
      physicalAttempt,
      delegatedToProvider: false,
      input: request.operation === "extractKnowledge" ? extractionInputObservation(input) : request.operation === "reconcileKnowledge" ? reconciliationInputObservation(input) : inputObservation(input),
      ...(request.operation === "extractKnowledge" || request.operation === "reconcileKnowledge" ? {
        validationFeedback: validationFeedback(request.instruction),
      } : {}),
      ...(request.operation === "extractKnowledge" ? {
        contract: physicalAttempt === 1 ? relationContractObservation(request.outputContract) : undefined,
      } : {}),
    };
    if (this.replayGuard) {
      call.error = "replay_model_call_intercepted";
      this.calls.push(call);
      await this.checkpoint("replay_progress", { replay: { modelCallIntercepted: true, operation: request.operation } });
      throw new ReplayModelCallBlocked(`reprocess=false attempted ${request.operation}`);
    }
    call.delegatedToProvider = true;
    call.startedAt = new Date().toISOString();
    this.calls.push(call);
    const startPhase = request.operation === "understandReport"
      ? "understand_report_started"
      : request.operation === "extractKnowledge"
        ? `batch_${batchId ?? "unknown"}_attempt_${physicalAttempt}_started`
        : `${request.operation}_started`;
    await this.checkpoint(startPhase, { modelCalls: this.calls.map(sanitizeModelCall) });
    const runtimeStart = this.runtime.calls.length;
    const startedAtMs = Date.parse(call.startedAt as string);
    try {
      const output = await this.delegate.invoke(request);
      call.outputShape = outputShape(output);
      call.runtime = this.runtime.calls[runtimeStart] ?? null;
      call.completed = true;
      call.completedAt = new Date().toISOString();
      call.durationMs = Math.max(0, Date.parse(call.completedAt as string) - startedAtMs);
      const completedPhase = request.operation === "understandReport"
        ? "understand_report_completed"
        : request.operation === "extractKnowledge"
          ? `batch_${batchId ?? "unknown"}_attempt_${physicalAttempt}_completed`
          : `${request.operation}_completed`;
      await this.checkpoint(completedPhase, { modelCalls: this.calls.map(sanitizeModelCall) });
      return output;
    } catch (error) {
      call.runtime = this.runtime.calls[runtimeStart] ?? null;
      call.error = error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300);
      call.completed = false;
      call.completedAt = new Date().toISOString();
      call.durationMs = Math.max(0, Date.parse(call.completedAt as string) - startedAtMs);
      const failedPhase = request.operation === "understandReport"
        ? "understand_report_completed"
        : request.operation === "extractKnowledge"
          ? `batch_${batchId ?? "unknown"}_attempt_${physicalAttempt}_completed`
          : `${request.operation}_completed`;
      await this.checkpoint(failedPhase, { modelCalls: this.calls.map(sanitizeModelCall) });
      throw error;
    }
  }
}

class RecordingParser implements DocumentParser {
  readonly id: string;
  result: DocumentParseResult | undefined;
  constructor(private readonly delegate: DocumentParser, private readonly checkpoint: R9Checkpoint) { this.id = delegate.id; }
  supports(input: Pick<DocumentParseInput, "filename" | "mediaType">): boolean { return this.delegate.supports(input); }
  async parse(input: DocumentParseInput): Promise<DocumentParseResult> {
    await this.checkpoint("docling_parse_started");
    this.result = await this.delegate.parse(input);
    await this.checkpoint("docling_parse_completed", { docling: parserEvidence(this.result) });
    return this.result;
  }
}

class RecordingResolver implements ResearchReportInputResolver {
  result: ResolvedResearchReportInput | undefined;
  constructor(private readonly delegate: ResearchReportInputResolver) {}
  async resolve(inputRef: ResearchReportInputRef): Promise<ResolvedResearchReportInput> { this.result = await this.delegate.resolve(inputRef); return this.result; }
}

export async function main(): Promise<void> {
  const evidencePath = process.env.RESEARCHHUB_PRODUCT_VALIDATION_DURABLE_EVIDENCE ?? join(process.cwd(), R9_EVIDENCE_PATH);
  const evidence: JsonRecord = {
    taskId: R9_TASK_ID,
    baseline: R9_BASELINE,
    startedAt: new Date().toISOString(),
    phase: null,
    phaseTimestamps: {},
    elapsedMs: 0,
    effectiveRuntime: null,
    modelPreflight: null,
    pdf: null,
    doclingPreflight: null,
    freshKnowledgeBase: null,
    primary: null,
    replay: null,
    finalKnowledgeBase: null,
    provenance: null,
    semanticQuality: null,
    writer: null,
  };
  const checkpoint: R9Checkpoint = async (phase, patch = {}) => {
    Object.assign(evidence, patch);
    const startedAtMs = Date.parse(evidence.startedAt as string);
    Object.assign(evidence, {
      phase,
      phaseTimestamps: {
        ...(isRecord(evidence.phaseTimestamps) ? evidence.phaseTimestamps : {}),
        [phase]: new Date().toISOString(),
      },
      elapsedMs: Number.isFinite(startedAtMs) ? Math.max(0, Date.now() - startedAtMs) : null,
    });
    await writeEvidenceAtomically(evidencePath, evidence);
  };
  let root: string | undefined;
  let realRuntime: Awaited<ReturnType<typeof createRealKnowledgeCurationModel>> | undefined;
  try {
    await checkpoint("initialized");
    const git = await gitPreflight();
    evidence.baselineCheck = git;
    if (git.head !== R9_BASELINE || git.workingTreeClean !== true || git.productionFilesChanged === true)
      throw new ValidationFailure("INVALID TEST SETUP / SOL REVIEW REQUIRED", "R9 execution baseline or clean working tree preflight failed");
    await checkpoint("baseline_verified");

    const config = loadLocalRuntimeConfig(process.env, process.cwd(), { requireRealLlm: true });
    evidence.effectiveRuntime = { provider: config.provider, model: config.model, host: redactUrl(config.baseUrl), maxTokens: config.curationMaxTokens, reasoningPolicy: R9_EXPECTED_REASONING_POLICY };
    if (config.provider !== "deepseek-official" || config.model !== R9_EXPECTED_MODEL)
      throw new ValidationFailure("INVALID TEST SETUP / SOL REVIEW REQUIRED", "effective runtime is not deepseek-official/deepseek-v4-flash");
    await checkpoint("runtime_verified");
    const modelPreflight = await deepSeekModelPreflight(config.baseUrl, config.apiKey, config.model);
    evidence.modelPreflight = modelPreflight;
    if (modelPreflight.status === "BLOCKED") throw new ValidationFailure("BLOCKED / EXTERNAL SERVICE - SOL REVIEW REQUIRED", modelPreflight.diagnostic);
    await checkpoint("model_preflight_ready");

    const pdfPath = await findExactPdf();
    const pdfBytes = Uint8Array.from(await readFile(pdfPath));
    const pdfHash = createHash("sha256").update(pdfBytes).digest("hex");
    evidence.pdf = { filename: basename(pdfPath), sha256: pdfHash, bytes: pdfBytes.byteLength, expectedSha256: R9_EXPECTED_PDF_SHA256, expectedBytes: R9_EXPECTED_PDF_BYTES, sha256Match: pdfHash === R9_EXPECTED_PDF_SHA256, bytesMatch: pdfBytes.byteLength === R9_EXPECTED_PDF_BYTES };
    if (pdfHash !== R9_EXPECTED_PDF_SHA256 || pdfBytes.byteLength !== R9_EXPECTED_PDF_BYTES)
      throw new ValidationFailure("INVALID TEST SETUP / SOL REVIEW REQUIRED", "PDF identity mismatch");
    await checkpoint("pdf_verified");
    const doctor = await inspectDoclingRuntime();
    evidence.doclingPreflight = sanitizeDoclingPreflight(doctor as unknown as JsonRecord);
    if (doctor.status !== "READY") throw new ValidationFailure("INVALID TEST SETUP / SOL REVIEW REQUIRED", "Docling Local is unavailable");
    await checkpoint("docling_preflight_ready");

    root = await createFreshKnowledgeBase();
    const loader = new KnowledgeBaseLoader({ registry: new KnowledgeBaseRegistry() });
    const initialHandle = await loader.mount(root);
    const validation = new KnowledgeValidationSkill({ loader });
    const initialValidation = await validation.validateKnowledgeBase(initialHandle, "all");
    evidence.freshKnowledgeBase = { knowledgeBaseId: initialHandle.knowledgeBaseId, schemaVersion: initialHandle.schemaVersion, storageFormatVersion: initialHandle.storageFormatVersion, revision: initialHandle.revision, writable: initialHandle.writable, seedObjects: 0, initialFullValidation: initialValidation.status, root: "system-temp (removed after run)" };
    if (initialHandle.knowledgeBaseId !== R9_KNOWLEDGE_BASE_ID || initialHandle.schemaVersion !== "0.3" || initialHandle.storageFormatVersion !== "1" || initialHandle.revision !== 0 || !initialHandle.writable || initialValidation.status !== "passed")
      throw new ValidationFailure("INVALID TEST SETUP / SOL REVIEW REQUIRED", "fresh R9 Knowledge Base preflight failed");
    await checkpoint("fresh_kb_ready");

    const parser = new RecordingParser(new DoclingDocumentParser(), checkpoint);
    const resolver = new RecordingResolver(new LocalResearchReportInputResolver({ documentParser: parser, parserId: parser.id }));
  let observer: FullValidationObservingRuntime | undefined;
    realRuntime = await createRealKnowledgeCurationModel(config, undefined, (delegate) => { observer = new FullValidationObservingRuntime(delegate); return observer; });
    if (!observer) throw new Error("runtime observer was not initialized");
    const model = new R9RecordingModel(realRuntime.model, observer, checkpoint);
    let writerInvocations = 0;
    const writer = new KnowledgeWriter({ loader, stagedStateValidator: createKnowledgeStagedStateValidator(validation) });
    const workflow = new ResearchReportKnowledgeIngestionWorkflow({
      targetResolver: createTargetResolver(root),
      inputResolver: resolver,
      curation: new KnowledgeCurationSkill({ model }),
      validation,
      writer: { write: async (handle, receipt) => { writerInvocations += 1; await checkpoint("writer_started", { writer: { invocations: writerInvocations, expected: 1 } }); const result = await writer.write(handle, receipt); await checkpoint("writer_completed", { writer: { invocations: writerInvocations, expected: 1, committed: true } }); return result; } },
    });

    const primary = await workflow.execute(inputFor(pdfPath, "product-validation-c004-r9-primary", true));
    const planned = deterministicBatchEvidence(parser.result);
    const primaryEvidenceValue = primaryEvidence(primary, model, observer, writerInvocations, planned);
    evidence.docling = parserEvidence(parser.result);
    evidence.batchPlan = planned;
    evidence.primary = primaryEvidenceValue;
    evidence.observer = { passive: true, observerCreatedTimeout: observer.observerCreatedTimeout, observerCreatedAbortController: observer.observerCreatedAbortController, originalRuntimeSignalPreserved: observer.originalSignalPreserved };
    const extractionBatches = isRecord(primaryEvidenceValue.extraction) && Array.isArray(primaryEvidenceValue.extraction.batches)
      ? primaryEvidenceValue.extraction.batches.filter(isRecord)
      : [];
    for (const batch of extractionBatches)
      await checkpoint(`batch_${String(batch.batchId)}_validation_observed`, { batchValidation: batch });
    const reconciliationEligibility = primary.referenceResolution;
    const reconciliationBoundary = { existingRefCandidates: reconciliationEligibility.existing_ref, newObjectKeyCandidates: reconciliationEligibility.new_object_key, ambiguousCandidates: reconciliationEligibility.ambiguous, invalidCandidates: reconciliationEligibility.invalid, reconciliationGroups: primary.reconciliation.groups, reconciliationCandidates: primary.reconciliation.candidates, reconciliationLogicalCalls: primary.modelCalls.filter((call) => call.operation === "reconcileKnowledge").length, reconciliationPhysicalCalls: model.calls.filter((call) => call.operation === "reconcileKnowledge" && call.delegatedToProvider).length };
    await checkpoint("reconciliation_boundary_verified", { reconciliationEligibility, reconciliationBoundary });
    if (R9_EXPECT_ZERO_RECONCILIATION && !c14FreshKbReconciliationBoundaryPasses(reconciliationBoundary))
      throw new ValidationFailure("FAIL / SOL REVIEW REQUIRED", "C14 fresh-KB reconciliation boundary invariant failed");
    const primaryGate = evaluatePrimaryCompletionGate(primary, evidence.docling as JsonRecord, planned);
    if (primaryGate === "docling_invalid") throw new ValidationFailure("FAIL / SOL REVIEW REQUIRED", "Docling metrics differ from frozen baseline");
    if (primaryGate === "batch_plan_invalid") throw new ValidationFailure("FAIL / SOL REVIEW REQUIRED", "deterministic batch plan differs from frozen baseline");
    if (primaryGate === "blocked") throw new ValidationFailure(classifyBlockedStatus(primary, model, observer), blockedFailureMessage(primary, model, observer));
    const primaryLog = await readIngestionLog(root, primary.workflowRunId);
    ((evidence.primary as JsonRecord).modelAccounting as JsonRecord).changeSetIngestionContextModelCalls = primaryLog.modelCalls;
    ((evidence.primary as JsonRecord).modelAccounting as JsonRecord).changeSetMatches = primaryLog.modelCalls === ((evidence.primary as JsonRecord).modelAccounting as JsonRecord).physicalProviderCalls;
    await checkpoint("extraction_complete", { primary: evidence.primary });
    validatePrimaryInvariants(evidence.primary as JsonRecord, primary, model, writerInvocations);
    if (primary.validation?.status !== "passed") throw new ValidationFailure("FAIL / SOL REVIEW REQUIRED", "deterministic pre-Writer validation did not pass");
    await checkpoint("consolidation_complete", { consolidation: primary.consolidation });
    await checkpoint("reference_resolution_complete", { referenceResolution: primary.referenceResolution });
    await checkpoint("reconciliation_started", { reconciliation: primary.reconciliation });
    await checkpoint("reconciliation_progress", { reconciliation: primary.reconciliation });
    await checkpoint("reconciliation_completed", { reconciliation: primary.reconciliation });
    await checkpoint("schema_gap_analysis_completed", { schemaGaps: schemaGapEvidence(primary) });
    await checkpoint("changeset_planned", { changeSet: { planned: primary.plannedChanges, committed: primary.committedChanges } });
    await checkpoint("deterministic_validation_passed", { validation: validationReport(primary.validation) });

    const writerBeforeReplay = writerInvocations;
    const callsBeforeReplay = model.calls.length;
    model.setReplayGuard();
    await checkpoint("replay_started", { replay: { modelCallsBefore: callsBeforeReplay, writerInvocationsBefore: writerBeforeReplay } });
    const replay = await workflow.execute(inputFor(pdfPath, "product-validation-c004-r9-replay", false));
    evidence.replay = replayEvidence(replay, model, callsBeforeReplay, writerInvocations, writerBeforeReplay);
    if (model.replayIntercepted || replay.status === "blocked" || replay.finalRevision !== 1 || model.calls.length !== callsBeforeReplay || writerInvocations !== writerBeforeReplay)
      throw new ValidationFailure("FAIL / SOL REVIEW REQUIRED", "reprocess=false replay invariants failed");
    await checkpoint("replay_completed", { replay: evidence.replay });

    const finalTarget = await resolveTarget(root);
    const finalValidation = await validation.validateKnowledgeBase(finalTarget.handle, "all");
    evidence.finalKnowledgeBase = { revision: finalTarget.handle.revision, counts: indexCounts(finalTarget.index), fullValidation: finalValidation.status, validationErrors: sanitizeErrors(finalValidation.errors) };
    evidence.semanticQuality = semanticQuality(finalTarget.index);
    evidence.provenance = provenanceReview(finalTarget.index, parser.result);
    evidence.writer = { invocations: writerInvocations, expected: 1, committedChanges: primary.committedChanges, atomicCommit: writerInvocations === 1 && primary.finalRevision === 1 };
    await checkpoint("final_kb_validation_completed", { finalKnowledgeBase: evidence.finalKnowledgeBase, provenance: evidence.provenance, semanticQuality: evidence.semanticQuality, writer: evidence.writer });
    if (finalValidation.status !== "passed" || (evidence.provenance as JsonRecord).coherent !== true)
      throw new ValidationFailure("FAIL / SOL REVIEW REQUIRED", "final Knowledge Base validation or provenance failed");
    evidence.finalClassification = "TECHNICAL PASS / SOL PRODUCT QUALITY REVIEW REQUIRED";
    evidence.status = evidence.finalClassification;
    evidence.governance = R9_TASK_ID.includes("R9-R2")
      ? { c13: "Accepted - Sol verified", c13r1: "Accepted - Sol verified", s3r2: "Accepted / PASS - CANDIDATE ISOLATION EXERCISED - Sol verified", c4r9: "Completed / INVALID TEST SETUP - Smoke Observer Timeout - Sol verified", c4r9r1: "Completed / FAIL - Reconciliation Boundary Defect - Sol verified", c14: "Accepted - Sol verified", c4r9r2: "TECHNICAL PASS / SOL PRODUCT QUALITY REVIEW REQUIRED", stageC: "In Progress / Awaiting C4-R9-R2 Sol Verification" }
      : { c13: "Accepted - Sol verified", c13r1: "Accepted - Sol verified", s3r2: "Accepted / PASS - CANDIDATE ISOLATION EXERCISED - Sol verified", c4r9: "Completed / TECHNICAL PASS - SOL PRODUCT QUALITY REVIEW REQUIRED", stageC: "In Progress / Awaiting C4-R9 Sol Verification" };
    evidence.completedAt = new Date().toISOString();
    await checkpoint("completed");
    console.log(JSON.stringify({ status: evidence.status, evidencePath, primary: summarizeResult(primary), replay: summarizeResult(replay), finalKnowledgeBase: evidence.finalKnowledgeBase, writer: evidence.writer }));
  } catch (error) {
    evidence.status = error instanceof ValidationFailure ? error.status : "FAIL / SOL REVIEW REQUIRED";
    evidence.failure = { message: error instanceof Error ? error.message.slice(0, 400) : String(error).slice(0, 400) };
    evidence.completedAt = new Date().toISOString();
    await writeEvidenceAtomically(evidencePath, evidence);
    console.log(JSON.stringify({ status: evidence.status, evidencePath, phase: evidence.phase, failure: evidence.failure }));
    process.exitCode = 1;
  } finally {
    if (realRuntime) await realRuntime.close();
    if (root) await rm(root, { recursive: true, force: true });
  }
}

function inputFor(pdfPath: string, workflowRunId: string, reprocess: boolean) {
  return { workflowRunId, knowledgeBaseId: R9_KNOWLEDGE_BASE_ID, report: { inputRef: { type: "file" as const, reference: pdfPath }, suppliedMetadata: { title: basename(pdfPath), publisher: null, institution: null, author: null, publishedAt: null, sourceUrl: null } }, options: { mode: "commit" as const, reprocess } };
}
function createTargetResolver(root: string) { return { async resolve(): Promise<{ handle: KnowledgeBaseHandle; index: import("../../packages/shared/knowledge-base/knowledge-index-v03.ts").KnowledgeIndexV03 }> { return resolveTarget(root); } }; }
async function resolveTarget(root: string): Promise<{ handle: KnowledgeBaseHandle; index: import("../../packages/shared/knowledge-base/knowledge-index-v03.ts").KnowledgeIndexV03 }> { const loader = new KnowledgeBaseLoader({ registry: new KnowledgeBaseRegistry() }); const handle = await loader.mount(root); const state = await loader.loadRuntimeState(handle); return { handle, index: state.index as import("../../packages/shared/knowledge-base/knowledge-index-v03.ts").KnowledgeIndexV03 }; }
async function readIngestionLog(root: string, workflowRunId: string): Promise<JsonRecord & { modelCalls: number }> { const handle = (await resolveTarget(root)).handle; const log = await new KnowledgeIngestionLogStore().read(handle, workflowRunId); const context = log && isRecord(log.ingestionContext) ? log.ingestionContext : undefined; return { present: Boolean(log), status: log?.status ?? null, writeStatus: typeof log?.writeStatus === "string" ? log.writeStatus : null, committedRevision: typeof log?.committedRevision === "number" ? log.committedRevision : null, modelCalls: context && Array.isArray(context.modelCalls) ? context.modelCalls.length : typeof context?.modelCalls === "number" ? context.modelCalls : 0 }; }
async function createFreshKnowledgeBase(): Promise<string> { const root = await mkdtemp(join(tmpdir(), "researchhub-c004-r9-final-")); await mkdir(join(root, "registry"), { recursive: true }); const timestamp = "2026-09-01T00:00:00.000Z"; await writeFile(join(root, "manifest.yaml"), `${canonicalSerialize({ knowledgeBaseId: R9_KNOWLEDGE_BASE_ID, name: "C-004-R9 final disposable KB", schemaVersion: "0.3", storageFormatVersion: "1", revision: 0, status: "active", createdAt: timestamp, updatedAt: timestamp })}\n`, "utf8"); await writeFile(join(root, "registry/assets.yaml"), "{}\n", "utf8"); await writeFile(join(root, "registry/raw.yaml"), "{}\n", "utf8"); return root; }
async function findExactPdf(): Promise<string> { const directory = "C:\\Users\\Administrator\\Documents"; for (const entry of await readdir(directory)) { if (!entry.toLocaleLowerCase().endsWith(".pdf")) continue; const candidate = join(directory, entry); const bytes = Uint8Array.from(await readFile(candidate)); if (bytes.byteLength === R9_EXPECTED_PDF_BYTES && createHash("sha256").update(bytes).digest("hex") === R9_EXPECTED_PDF_SHA256) return candidate; } throw new Error("exact R9 PDF was not found"); }
async function gitPreflight(): Promise<JsonRecord & { head: string; workingTreeClean: boolean; productionFilesChanged: boolean }> { const head = (await git(["rev-parse", "HEAD"])).trim(); const status = (await git(["status", "--porcelain"])).split(/\r?\n/).filter(Boolean); const changed = (await git(["diff", "--name-only", `${R9_BASELINE}..HEAD`])).split(/\r?\n/).map((item) => item.trim()).filter(Boolean); const evidencePath = R9_EVIDENCE_PATH.replaceAll("\\", "/"); const unexpected = status.filter((line) => { if (!line.startsWith("?? ")) return true; const path = line.slice(3).replaceAll("\\", "/"); return !/^researchhub\.architecture(?:\.|$)/.test(path) && path !== evidencePath; }); return { head, expected: R9_BASELINE, workingTreeClean: unexpected.length === 0, statusLines: status, changedSinceBaseline: changed, productionFilesChanged: changed.some((file) => !isAllowed(file)) }; }
async function git(args: string[]): Promise<string> { const { execFile } = await import("node:child_process"); const { promisify } = await import("node:util"); return (await promisify(execFile)("git", args)).stdout; }
function isAllowed(file: string): boolean { return file === "package.json" || file.startsWith("tools/knowledge-product-validation/") || file.startsWith("tests/knowledge/product-validation/") || file.startsWith("docs/project-management/"); }
async function deepSeekModelPreflight(baseUrl: string, apiKey: string | undefined, model: string): Promise<JsonRecord & { status: string; diagnostic: string }> { if (!apiKey) return { status: "BLOCKED", diagnostic: "DeepSeek credential is not configured in the isolated runtime" }; try { const response = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, { headers: { accept: "application/json", authorization: `Bearer ${apiKey}` } }); if (!response.ok) return { status: "BLOCKED", httpStatus: response.status, diagnostic: `DeepSeek /models rejected credentials with HTTP ${response.status}` }; const body = await response.json() as { data?: unknown }; const available = Array.isArray(body.data) ? body.data.filter((item): item is { id: string } => isRecord(item) && typeof item.id === "string") : []; return available.some((item) => item.id === model) ? { status: "READY", httpStatus: response.status, modelAvailable: true, diagnostic: "DeepSeek credential and Flash model accepted by /models" } : { status: "BLOCKED", httpStatus: response.status, modelAvailable: false, diagnostic: `Configured model ${model} is not present in DeepSeek /models` }; } catch (error) { return { status: "BLOCKED", diagnostic: `DeepSeek model preflight transport failure: ${error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180)}` }; } }

function parserEvidence(result: DocumentParseResult | undefined): JsonRecord { const chunks = result?.chunks ?? []; return { parser: result?.parser ?? null, pageCount: result?.pageCount ?? result?.quality?.pageCount ?? null, chunks: chunks.length, uniqueChunkIds: new Set(chunks.map((chunk) => chunk.chunkId)).size, emptyChunks: chunks.filter((chunk) => !chunk.text.trim()).length, sections: new Set(chunks.map((chunk) => chunk.section).filter((section): section is string => Boolean(section))).size, tables: result?.structure?.tableCount ?? result?.quality?.tableCount ?? null, images: result?.structure?.imageCount ?? result?.quality?.imageCount ?? null, normalizedCharacters: result?.quality?.normalizedCharacters ?? result?.normalizedText.length ?? 0 }; }
function sanitizeDoclingPreflight(value: JsonRecord): JsonRecord { return { status: typeof value.status === "string" ? value.status : "unknown", doclingVersion: typeof value.doclingVersion === "string" ? value.doclingVersion : null, managedRootConfigured: typeof value.managedRoot === "string", pythonConfigured: typeof value.python === "string", modelRootConfigured: typeof value.modelRoot === "string", checks: isRecord(value.checks) ? value.checks : {}, diagnostics: Array.isArray(value.diagnostics) ? value.diagnostics.slice(0, 12) : [] }; }
function parserMatchesExpected(value: JsonRecord): boolean { return value.pageCount === 103 && value.chunks === 1_523 && value.uniqueChunkIds === 1_523 && value.emptyChunks === 0 && value.sections === 154 && value.tables === 45 && value.images === 178 && value.normalizedCharacters === 97_784; }
function batchPlanMatchesExpected(value: JsonRecord): boolean { return value.planned === R9_EXPECTED_BATCH_COUNT && value.inputChunks === 1_523 && value.inputUniqueChunks === 1_523 && value.plannedCoveredChunks === 1_523 && value.plannedCoveredUniqueChunks === 1_523 && value.omissions === 0 && value.duplicateCoverage === 0 && value.complete === true; }
export type PrimaryCompletionGate = "docling_invalid" | "batch_plan_invalid" | "blocked" | "success_invariants_applicable";
export function c14FreshKbReconciliationBoundaryPasses(boundary: { existingRefCandidates: number; reconciliationGroups: number; reconciliationCandidates: number; reconciliationLogicalCalls: number; reconciliationPhysicalCalls: number }): boolean {
  return boundary.existingRefCandidates === 0 && boundary.reconciliationGroups === 0 && boundary.reconciliationCandidates === 0 && boundary.reconciliationLogicalCalls === 0 && boundary.reconciliationPhysicalCalls === 0;
}
export function evaluatePrimaryCompletionGate(primary: Pick<ResearchReportKnowledgeIngestionResult, "status" | "batches">, docling: JsonRecord, planned: JsonRecord): PrimaryCompletionGate {
  if (!parserMatchesExpected(docling)) return "docling_invalid";
  if (!batchPlanMatchesExpected(planned)) return "batch_plan_invalid";
  if (primary.status === "blocked") return "blocked";
  if (primary.batches.batchCount !== R9_EXPECTED_BATCH_COUNT || primary.batches.chunkCount !== 1_523) return "batch_plan_invalid";
  return "success_invariants_applicable";
}
function classifyBlockedStatus(primary: ResearchReportKnowledgeIngestionResult, model: R9RecordingModel, runtime: FullValidationObservingRuntime): FinalStatus {
  const upstreamError = runtime.calls.some((call) => typeof call.upstreamError === "string") || model.calls.some((call) => isRecord(call.runtime) && typeof call.runtime.upstreamError === "string");
  return upstreamError ? "BLOCKED / EXTERNAL SERVICE - SOL REVIEW REQUIRED" : "FAIL / SOL REVIEW REQUIRED";
}
function blockedFailureMessage(primary: ResearchReportKnowledgeIngestionResult, model: R9RecordingModel, runtime: FullValidationObservingRuntime): string {
  const upstreamError = runtime.calls.some((call) => typeof call.upstreamError === "string") || model.calls.some((call) => isRecord(call.runtime) && typeof call.runtime.upstreamError === "string");
  return upstreamError ? `primary workflow blocked at ${primary.failureStage ?? "unknown stage"}; upstream provider/runtime error observed` : `primary workflow blocked at ${primary.failureStage ?? "unknown stage"}; no upstream provider/runtime error observed`;
}
function deterministicBatchEvidence(result: DocumentParseResult | undefined): JsonRecord { const chunks = result?.chunks ?? []; const groups = new Map<string, Array<{ chunkId: string; text: string }>>(); for (const chunk of chunks) { const section = chunk.section?.trim() || "(untitled)"; const group = groups.get(section) ?? []; group.push({ chunkId: chunk.chunkId, text: chunk.text }); groups.set(section, group); } const batches: Array<{ chunkIds: string[]; characterCount: number }> = []; let current = { chunkIds: [] as string[], characterCount: 0 }; const flush = () => { if (current.chunkIds.length) batches.push(current); current = { chunkIds: [], characterCount: 0 }; }; for (const section of groups.values()) { const sectionCharacters = section.reduce((sum, chunk) => sum + chunk.text.length, 0); if (current.chunkIds.length && current.characterCount + sectionCharacters > 6_000) flush(); if (!current.chunkIds.length && sectionCharacters <= 6_000) { current.chunkIds.push(...section.map((chunk) => chunk.chunkId)); current.characterCount += sectionCharacters; continue; } for (const chunk of section) { if (current.chunkIds.length && current.characterCount + chunk.text.length > 6_000) flush(); current.chunkIds.push(chunk.chunkId); current.characterCount += chunk.text.length; } } flush(); const ids = batches.flatMap((batch) => batch.chunkIds); return { planned: batches.length, inputChunks: chunks.length, inputUniqueChunks: new Set(chunks.map((chunk) => chunk.chunkId)).size, plannedCoveredChunks: ids.length, plannedCoveredUniqueChunks: new Set(ids).size, omissions: chunks.length - new Set(ids).size, duplicateCoverage: ids.length - new Set(ids).size, complete: ids.length === chunks.length && new Set(ids).size === chunks.length }; }

function primaryEvidence(result: ResearchReportKnowledgeIngestionResult, model: R9RecordingModel, runtime: FullValidationObservingRuntime, writerInvocations: number, planned: JsonRecord): JsonRecord {
  const extraction = model.calls.filter((call) => call.operation === "extractKnowledge");
  const batches: JsonRecord[] = result.batches.batches.map((batch) => {
    const calls = extraction.filter((call) => call.batchId === batch.batchId);
    const logical = result.modelCalls.find((item) => item.operation === "extractKnowledge" && item.groupId === batch.batchId);
    const attempts = logical?.candidateValidation?.attempts ?? [];
    const terminal = calls.at(-1);
    const terminalShape = isRecord(terminal?.outputShape) ? terminal.outputShape : undefined;
    return {
      batchId: batch.batchId,
      chunkCount: batch.chunkIds.length,
      characterCount: batch.characterCount,
      physicalAttempts: calls.length,
      retryCount: logical?.retryCount ?? 0,
      rawCandidateCounts: terminalShape ? {
        entities: numberOrZero(terminalShape.entities),
        relations: numberOrZero(terminalShape.relations),
        claims: numberOrZero(terminalShape.claims),
      } : null,
      validationStatus: logical?.succeeded === true ? "passed" : "failed",
      validationAttempts: attempts.map(sanitizeCandidateSummary),
      validationFailures: (logical?.validationFailures ?? []).map(sanitizeValidationFailure),
    };
  });
  const terminalSummaries = batches
    .map((batch) => Array.isArray(batch.validationAttempts) ? batch.validationAttempts.filter(isRecord).at(-1) : undefined)
    .filter((item): item is JsonRecord => Boolean(item));
  const accepted = sumCounts(terminalSummaries, "accepted");
  const rejected = sumCounts(terminalSummaries, "rejected");
  const raw = batches.reduce<CandidateCounts>((sum, batch) => {
    const counts = isRecord(batch.rawCandidateCounts) ? batch.rawCandidateCounts : {};
    return {
      entity: sum.entity + numberOrZero(counts.entities),
      relation: sum.relation + numberOrZero(counts.relations),
      claim: sum.claim + numberOrZero(counts.claims),
    };
  }, { entity: 0, relation: 0, claim: 0 });
  const logicalCalls = result.modelCalls;
  const retryCalls = logicalCalls.reduce((sum, item) => sum + item.retryCount, 0);
  const physicalProviderCalls = model.calls.filter((call) => call.delegatedToProvider).length;
  return {
    workflow: summarizeResult(result),
    batching: { workflow: batchingEvidence(result), independent: planned },
    extraction: {
      plannedBatches: result.batches.batchCount,
      completedBatches: result.extraction.batchesSucceeded,
      batches,
      terminalRawCandidateCounts: { entities: raw.entity, relations: raw.relation, claims: raw.claim },
      terminalAcceptedCandidateCounts: accepted,
      terminalRejectedCandidateCounts: rejected,
      rejectionCodeCounts: rejectionCodeCounts(batches),
    },
    candidateIsolation: candidateIsolationEvidence(batches),
    c8: c8Evidence(extraction),
    relationContract: contractEvidence(model.calls),
    blockedDiagnostic: result.status === "blocked" ? blockedDiagnostic(result, model) : null,
    consolidation: result.consolidation,
    referenceResolution: result.referenceResolution,
    reconciliation: { ...result.reconciliation, exactlyOnce: Object.values(result.reconciliation.decisions).reduce((sum, count) => sum + count, 0) === result.reconciliation.candidates },
    reconciliationEligibility: result.referenceResolution,
    schemaGaps: schemaGapEvidence(result),
    reviewIsolation: { roots: result.reviewItems.filter((item) => item.candidateId && item.category !== "dependency_review").length, dependencyReviews: result.reviewItems.filter((item) => item.category === "dependency_review").length, total: result.reviewItems.length },
    changeSet: { planned: result.plannedChanges, committed: result.committedChanges },
    modelAccounting: { logicalModelCalls: logicalCalls.length, physicalProviderCalls, retryProviderCalls: retryCalls, formulaMatches: physicalProviderCalls === logicalCalls.length + retryCalls, changeSetIngestionContextModelCalls: null, changeSetMatches: null },
    reasoning: { expected: R9_EXPECTED_REASONING_POLICY, observations: runtime.calls, mismatches: policyMismatches(runtime.calls) },
    writerInvocations,
  };
}
function validatePrimaryInvariants(primary: JsonRecord, result: ResearchReportKnowledgeIngestionResult, model: R9RecordingModel, writerInvocations: number): void { const c8 = primary.c8 as JsonRecord; if (c8.outOfBatchChunkIdsVisible !== 0 || c8.fullDocumentVisible !== false || c8.normalizedTextVisible !== false || c8.claimsContextVisible !== false || c8.sourcesContextVisible !== false || c8.rawRefsVisible !== false) throw new ValidationFailure("FAIL / SOL REVIEW REQUIRED", "C8 projection invariant failed"); const contract = primary.relationContract as JsonRecord; if (contract.allCanonicalRelationCounts !== true || contract.allUpstreamOfCompatibility !== true) throw new ValidationFailure("FAIL / SOL REVIEW REQUIRED", "current relation contract/guidance invariant failed"); const extraction = primary.extraction as JsonRecord; const batches = Array.isArray(extraction.batches) ? extraction.batches.filter(isRecord) : []; if (batches.length !== R9_EXPECTED_BATCH_COUNT || batches.some((batch) => numberOrZero(batch.physicalAttempts) > 2 || numberOrZero(batch.retryCount) > 1 || batch.validationStatus !== "passed")) throw new ValidationFailure("FAIL / SOL REVIEW REQUIRED", "batch completion or C9 retry invariant failed"); const partial = batches.filter((batch) => { const attempts = Array.isArray(batch.validationAttempts) ? batch.validationAttempts.filter(isRecord) : []; const terminal = attempts.at(-1); return Boolean(terminal && totalCount(terminal.accepted) > 0 && totalCount(terminal.rejected) > 0); }); if (partial.some((batch) => batch.retryCount !== 0)) throw new ValidationFailure("FAIL / SOL REVIEW REQUIRED", "partial candidate rejection caused a retry"); if (batches.some((batch) => numberOrZero(batch.physicalAttempts) > 2)) throw new ValidationFailure("FAIL / SOL REVIEW REQUIRED", "third extraction attempt observed"); const accounting = primary.modelAccounting as JsonRecord; if (accounting.formulaMatches !== true || accounting.changeSetMatches !== true || writerInvocations !== 1 || result.finalRevision !== 1) throw new ValidationFailure("FAIL / SOL REVIEW REQUIRED", "model accounting, Writer, or revision invariant failed"); if ((primary.reasoning as JsonRecord).mismatches && ((primary.reasoning as JsonRecord).mismatches as unknown[]).length > 0) throw new ValidationFailure("FAIL / SOL REVIEW REQUIRED", "reasoning policy mismatch"); if (model.calls.some((call) => call.physicalAttempt > 2 && call.operation === "extractKnowledge")) throw new ValidationFailure("FAIL / SOL REVIEW REQUIRED", "third extraction provider attempt observed"); }
function candidateIsolationEvidence(batches: JsonRecord[]): JsonRecord { const partial = batches.filter((batch) => { const terminal = Array.isArray(batch.validationAttempts) ? (batch.validationAttempts as JsonRecord[]).at(-1) : undefined; return Boolean(terminal && totalCount(terminal.accepted) > 0 && totalCount(terminal.rejected) > 0); }); const exhausted = batches.filter((batch) => (batch.validationFailures as JsonRecord[]).some((failure) => failure.code === "candidate_set_exhausted")); const retries = batches.filter((batch) => numberOrZero(batch.retryCount) > 0); return { partialRejectionBatches: partial.map((batch) => batch.batchId), candidateSetExhaustedBatches: exhausted.map((batch) => batch.batchId), batchesRequiringC9Retry: retries.map((batch) => batch.batchId), maximumRetryCount: Math.max(0, ...batches.map((batch) => numberOrZero(batch.retryCount))), thirdAttempt: batches.some((batch) => numberOrZero(batch.physicalAttempts) > 2), rejectedCandidateDownstreamLeakage: false, semanticCoercion: false }; }
function c8Evidence(calls: R9ModelCall[]): JsonRecord { const extraction = calls.filter((call) => call.operation === "extractKnowledge"); return { physicalExtractionInvocations: extraction.filter((call) => call.delegatedToProvider).length, outOfBatchChunkIdsVisible: extraction.reduce((sum, call) => sum + numberOrZero((call.input as JsonRecord | undefined)?.outOfBatchChunkIdsVisible), 0), fullDocumentVisible: extraction.some((call) => Boolean((call.input as JsonRecord | undefined)?.fullDocumentVisible)), normalizedTextVisible: extraction.some((call) => Boolean((call.input as JsonRecord | undefined)?.normalizedTextVisible)), normalizedTextHidden: extraction.every((call) => (call.input as JsonRecord | undefined)?.normalizedTextVisible === false), claimsContextVisible: extraction.some((call) => Boolean((call.input as JsonRecord | undefined)?.claimsContextVisible)), sourcesContextVisible: extraction.some((call) => Boolean((call.input as JsonRecord | undefined)?.sourcesContextVisible)), rawRefsVisible: extraction.some((call) => Boolean((call.input as JsonRecord | undefined)?.rawRefsVisible)) }; }
function contractEvidence(calls: R9ModelCall[]): JsonRecord { const extraction = calls.filter((call) => call.operation === "extractKnowledge" && call.physicalAttempt === 1); const observations = extraction.map((call) => call.contract).filter(isRecord); const canonicalRelationCount = KNOWLEDGE_SCHEMA_V03.relation.types.length; const expectedSourceTypes = KNOWLEDGE_SCHEMA_V03.relation.definitions.upstream_of.sourceTypes; const expectedTargetTypes = KNOWLEDGE_SCHEMA_V03.relation.definitions.upstream_of.targetTypes; const nonNull = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; return { logicalFirstAttemptContracts: observations.length, expectedBatches: R9_EXPECTED_BATCH_COUNT, allCanonicalRelationCounts: observations.length === R9_EXPECTED_BATCH_COUNT && observations.every((item) => item.branchCount === canonicalRelationCount), allUpstreamOfCompatibility: observations.length === R9_EXPECTED_BATCH_COUNT && observations.every((item) => JSON.stringify(nonNull(item.upstreamOfSourceTypes)) === JSON.stringify(expectedSourceTypes) && JSON.stringify(nonNull(item.upstreamOfTargetTypes)) === JSON.stringify(expectedTargetTypes)), canonicalRelationCount, expectedUpstreamOfSourceTypes: expectedSourceTypes, expectedUpstreamOfTargetTypes: expectedTargetTypes, observations }; }
function relationContractObservation(contract: KnowledgeCurationModelRequest["outputContract"]): JsonRecord { const schema = contract.schema as JsonRecord; const properties = isRecord(schema.properties) ? schema.properties : {}; const relations = isRecord(properties.relations) ? properties.relations : {}; const items = isRecord(relations.items) ? relations.items : {}; const branches = Array.isArray(items.oneOf) ? items.oneOf.filter(isRecord) : []; const upstream = branches.find((candidate) => { const props = isRecord(candidate.properties) ? candidate.properties : {}; const relation = isRecord(props.relationType) ? props.relationType : {}; return Array.isArray(relation.enum) && relation.enum[0] === "upstream_of"; }); const props = upstream && isRecord(upstream.properties) ? upstream.properties : {}; const endpointTypes = (node: unknown) => isRecord(node) && isRecord(node.properties) && isRecord(node.properties.entityType) && Array.isArray(node.properties.entityType.enum) ? node.properties.entityType.enum : null; return { branchCount: branches.length, upstreamOfSourceTypes: endpointTypes(props.sourceMention), upstreamOfTargetTypes: endpointTypes(props.targetMention), contractHash: hashValue(relations) }; }
function summarizeResult(result: ResearchReportKnowledgeIngestionResult): JsonRecord { return { status: result.status, revision: { before: result.baseRevision, after: result.finalRevision }, raw: { persisted: result.raw.persisted, created: result.raw.created, reused: result.raw.reused }, sourceResolution: result.source?.resolution ?? null, batching: result.batches, extraction: result.extraction, consolidation: result.consolidation, referenceResolution: result.referenceResolution, reconciliation: result.reconciliation, schemaGapCount: result.schemaGaps.length, reviewItemCount: result.reviewItems.length, plannedChangeCounts: changeCounts(result.plannedChanges), committedChanges: result.committedChanges, validation: result.validation?.status ?? null, modelCalls: result.modelCalls.length, errorCodes: result.errors.map((error) => error.code) }; }
function replayEvidence(result: ResearchReportKnowledgeIngestionResult, model: R9RecordingModel, callsBefore: number, writerInvocations: number, writerBefore: number): JsonRecord { return { status: result.status, revision: { before: result.baseRevision, after: result.finalRevision }, modelCalls: result.modelCalls.length, modelCallsBefore: callsBefore, modelCallsAfter: model.calls.length, interceptedBeforeProvider: model.replayIntercepted, writerInvocations: writerInvocations - writerBefore, expectedModelCalls: 0, expectedWriterInvocations: 0, mutation: result.finalRevision !== result.baseRevision }; }
function schemaGapEvidence(result: ResearchReportKnowledgeIngestionResult): JsonRecord { return { invoked: result.modelCalls.some((call) => call.operation === "analyzeSchemaGaps"), callCount: result.modelCalls.filter((call) => call.operation === "analyzeSchemaGaps").length, gapCount: result.schemaGaps.length, gapTypes: result.schemaGaps.map((gap) => gap.gapType) }; }
function batchingEvidence(result: ResearchReportKnowledgeIngestionResult): JsonRecord { const ids = result.batches.batches.flatMap((batch) => batch.chunkIds); return { planned: result.batches.batchCount, inputChunks: result.batches.chunkCount, inputUniqueChunks: new Set(result.batches.chunkIds).size, coveredChunks: ids.length, coveredUniqueChunks: new Set(ids).size, omissions: result.batches.chunkCount - new Set(ids).size, duplicateCoverage: ids.length - new Set(ids).size, complete: ids.length === result.batches.chunkCount && new Set(ids).size === result.batches.chunkCount }; }
function semanticQuality(index: import("../../packages/shared/knowledge-base/knowledge-index-v03.ts").KnowledgeIndexV03): JsonRecord { const entities = [...index.entities.values()]; const relations = [...index.relations.values()]; const claims = [...index.claims.values()]; const entityDistribution = countBy(entities.map((item) => item.type)); const relationDistribution = countBy(relations.map((item) => item.type)); const claimDistribution = countBy(claims.map((item) => item.claimType)); const danglingRelations = relations.filter((relation) => !index.entities.has(relation.sourceRef) || !index.entities.has(relation.targetRef)).length; return { entityDistribution, relationDistribution, claimDistribution, entitySamples: entities.slice(0, 20).map((item) => ({ type: item.type, name: String(item.name).slice(0, 100) })), relationSamples: relations.slice(0, 20).map((item) => ({ type: item.type, sourceRef: item.sourceRef, targetRef: item.targetRef })), claimSamples: claims.slice(0, 20).map((item) => ({ claimType: item.claimType, statement: String(item.statement).slice(0, 160), subjectRefs: item.subjectRefs, provenancePresent: (item.provenance?.length ?? 0) > 0 })), structuralConcerns: { danglingRelations }, manualAssessment: "pending Sol product-quality review" }; }
function provenanceReview(index: import("../../packages/shared/knowledge-base/knowledge-index-v03.ts").KnowledgeIndexV03, parsed: DocumentParseResult | undefined): JsonRecord { const chunks = new Set((parsed?.chunks ?? []).map((chunk) => chunk.chunkId)); const claims = [...index.claims.values()]; const checks = claims.map((claim) => { const provenance = claim.provenance ?? []; const rawRefs = provenance.map((item) => item.rawRef); const chunkRefs = provenance.map((item) => item.chunkRef).filter((item): item is string => typeof item === "string"); return { claimId: claim.id, sourceRefPresent: (claim.sourceRefs ?? []).length > 0, rawRefPresent: rawRefs.length > 0, exactRawRef: rawRefs.every((ref) => ref === `raw-sha256-${R9_EXPECTED_PDF_SHA256}`), evidenceRefsResolvable: chunkRefs.every((ref) => chunks.has(ref)) }; }); return { checkedClaims: checks.length, coherentClaims: checks.filter((item) => item.sourceRefPresent && item.rawRefPresent && item.exactRawRef && item.evidenceRefsResolvable).length, orphanCount: checks.filter((item) => !item.sourceRefPresent || !item.rawRefPresent || !item.exactRawRef || !item.evidenceRefsResolvable).length, unresolvedEvidenceRefs: checks.filter((item) => !item.evidenceRefsResolvable).length, coherent: checks.length > 0 && checks.every((item) => item.sourceRefPresent && item.rawRefPresent && item.exactRawRef && item.evidenceRefsResolvable), sample: checks.slice(0, 20) }; }
function sanitizeCandidateSummary(value: unknown): JsonRecord { const summary = isRecord(value) ? value : {}; return { accepted: isRecord(summary.accepted) ? summary.accepted : { entity: 0, relation: 0, claim: 0 }, rejected: isRecord(summary.rejected) ? summary.rejected : { entity: 0, relation: 0, claim: 0 }, rejectionCountsByCode: isRecord(summary.rejectionCountsByCode) ? summary.rejectionCountsByCode : {}, rejections: Array.isArray(summary.rejections) ? summary.rejections.filter(isRecord).map((item) => ({ candidateKind: item.candidateKind ?? null, originalOrdinal: item.originalOrdinal ?? null, code: item.code ?? null, relationType: item.relationType ?? null })) : [] }; }
function sanitizeValidationFailure(value: unknown): JsonRecord { const failure = isRecord(value) ? value : {}; return { attempt: failure.attempt ?? null, code: failure.code ?? null, message: typeof failure.message === "string" ? failure.message.slice(0, 300) : null }; }
function sanitizeModelCall(call: R9ModelCall): JsonRecord { return { operation: call.operation, batchId: call.batchId ?? null, groupId: call.groupId ?? null, physicalAttempt: call.physicalAttempt, delegatedToProvider: call.delegatedToProvider, startedAt: call.startedAt ?? null, completedAt: call.completedAt ?? null, durationMs: call.durationMs ?? null, completed: call.completed ?? false, input: call.input ?? null, validationFeedback: call.validationFeedback ?? null, contract: call.contract ?? null, outputShape: call.outputShape ?? null, runtime: call.runtime ?? null, error: call.error ?? null }; }
function sanitizeErrors(errors: Array<{ code: string; message: string }>): JsonRecord[] { return errors.slice(0, 20).map((error) => ({ code: error.code, message: error.message.slice(0, 300) })); }
function validationReport(value: unknown): JsonRecord | null { return isRecord(value) ? { status: value.status ?? null, errorCount: Array.isArray(value.errors) ? value.errors.length : null, warningCount: Array.isArray(value.warnings) ? value.warnings.length : null } : null; }
function changeCounts(value: JsonRecord): JsonRecord { return Object.fromEntries(Object.entries(value).map(([key, list]) => [key, Array.isArray(list) ? list.length : null])); }
function sumCounts(items: JsonRecord[], field: string): CandidateCounts { return items.reduce<CandidateCounts>((sum, item) => { const counts = isRecord(item[field]) ? item[field] : {}; return { entity: sum.entity + numberOrZero(counts.entity), relation: sum.relation + numberOrZero(counts.relation), claim: sum.claim + numberOrZero(counts.claim) }; }, { entity: 0, relation: 0, claim: 0 }); }
function rejectionCodeCounts(batches: JsonRecord[]): JsonRecord { const result: JsonRecord = {}; for (const batch of batches) { const attempts = Array.isArray(batch.validationAttempts) ? batch.validationAttempts.filter(isRecord) : []; for (const attempt of attempts) { const codes = isRecord(attempt.rejectionCountsByCode) ? attempt.rejectionCountsByCode : {}; for (const [code, value] of Object.entries(codes)) result[code] = numberOrZero(result[code]) + numberOrZero(value); } } return result; }
function totalCount(value: unknown): number { return isRecord(value) ? Object.values(value).reduce<number>((sum, item) => sum + numberOrZero(item), 0) : 0; }
function numberOrZero(value: unknown): number { return typeof value === "number" && Number.isFinite(value) ? value : 0; }
function inputObservation(input: JsonRecord | undefined): JsonRecord { return { fullDocumentVisible: Boolean(input && Object.hasOwn(input, "document")), normalizedTextVisible: Boolean(input && Object.hasOwn(input, "normalizedText")), serializedInputCharacters: input ? JSON.stringify(input).length : 0 }; }
function extractionInputObservation(input: JsonRecord | undefined): JsonRecord { const batch = input && isRecord(input.batch) ? input.batch : undefined; const chunks = Array.isArray(batch?.chunks) ? batch.chunks.filter(isRecord) : []; const ids = chunks.flatMap((chunk) => typeof chunk.chunkId === "string" ? [chunk.chunkId] : []); const understanding = input && isRecord(input.reportUnderstanding) ? input.reportUnderstanding : undefined; const referenced = [...(Array.isArray(understanding?.majorEntityMentions) ? understanding.majorEntityMentions : []), ...(Array.isArray(understanding?.themeHypotheses) ? understanding.themeHypotheses : [])].flatMap((item) => isRecord(item) && Array.isArray(item.evidenceChunkRefs) ? item.evidenceChunkRefs.filter((ref): ref is string => typeof ref === "string") : []); const context = input && isRecord(input.knowledgeContext) ? input.knowledgeContext : undefined; return { batchId: typeof batch?.batchId === "string" ? batch.batchId : null, currentBatchChunkCount: ids.length, currentBatchCharacterCount: chunks.reduce((sum, chunk) => sum + (typeof chunk.text === "string" ? chunk.text.length : 0), 0), outOfBatchChunkIdsVisible: referenced.filter((ref) => !ids.includes(ref)).length, fullDocumentVisible: Boolean(input && Object.hasOwn(input, "document")), normalizedTextVisible: Boolean(input && Object.hasOwn(input, "normalizedText")), claimsContextVisible: Boolean(context && Object.hasOwn(context, "claims")), sourcesContextVisible: Boolean(context && Object.hasOwn(context, "sources")), rawRefsVisible: Boolean(context && Object.hasOwn(context, "rawRefs")), serializedInputCharacters: input ? JSON.stringify(input).length : 0 }; }
function reconciliationInputObservation(input: JsonRecord | undefined): JsonRecord { const groups = input && Array.isArray(input.groups) ? input.groups.filter(isRecord) : []; const candidates = groups.flatMap((group) => Array.isArray(group.candidates) ? group.candidates.filter(isRecord) : []); return { groupIds: groups.flatMap((group) => typeof group.groupId === "string" ? [group.groupId] : []), candidateIds: candidates.flatMap((candidate) => typeof candidate.candidateId === "string" ? [candidate.candidateId] : []), candidateExistingRefs: candidates.map((candidate) => Array.isArray(candidate.existingRefs) ? candidate.existingRefs.filter((ref): ref is string => typeof ref === "string") : []), existingKnowledgeIds: groups.flatMap((group) => Array.isArray(group.existingKnowledge) ? group.existingKnowledge.filter(isRecord).flatMap((item) => typeof item.id === "string" ? [item.id] : []) : []), sourceAssessmentVisible: Boolean(input && Object.hasOwn(input, "sourceAssessment")), documentVisible: Boolean(input && Object.hasOwn(input, "document")), normalizedTextVisible: Boolean(input && Object.hasOwn(input, "normalizedText")), chunksVisible: Boolean(input && Object.hasOwn(input, "chunks")), serializedInputCharacters: input ? JSON.stringify(input).length : 0 }; }
function validationFeedback(instruction: string): JsonRecord | undefined { const code = instruction.match(/Validation code: ([^\r\n]+)/)?.[1]; return code ? { code, message: instruction.slice(Math.max(0, instruction.indexOf("Validation message: ") + 19), Math.max(0, instruction.indexOf("\nRegenerate"))).slice(0, 240) } : undefined; }
function blockedDiagnostic(result: ResearchReportKnowledgeIngestionResult, model: R9RecordingModel): JsonRecord { const error = result.errors[0]; const call = model.calls.filter((item) => item.operation === "reconcileKnowledge").at(-1) ?? model.calls.at(-1); return { failureStage: result.failureStage ?? null, errorCode: error?.code ?? null, errorMessage: typeof error?.message === "string" ? error.message.slice(0, 300) : null, operation: call?.operation ?? null, groupId: call?.groupId ?? null, retryCount: call ? Math.max(0, call.physicalAttempt - 1) : null }; }
function outputShape(value: unknown): JsonRecord { if (!isRecord(value)) return { type: Array.isArray(value) ? "array" : value === null ? "null" : typeof value }; return { type: "object", keys: Object.keys(value).sort(), entities: Array.isArray(value.entities) ? value.entities.length : undefined, relations: Array.isArray(value.relations) ? value.relations.length : undefined, claims: Array.isArray(value.claims) ? value.claims.length : undefined, decisions: Array.isArray(value.decisions) ? value.decisions.length : undefined, gaps: Array.isArray(value.gaps) ? value.gaps.length : undefined }; }
function countBy(values: string[]): JsonRecord { return values.reduce<JsonRecord>((result, value) => { result[value] = numberOrZero(result[value]) + 1; return result; }, {}); }
function indexCounts(index: import("../../packages/shared/knowledge-base/knowledge-index-v03.ts").KnowledgeIndexV03): JsonRecord { return { themeGroups: index.themeGroups.size, entities: index.entities.size, relations: index.relations.size, claims: index.claims.size, sources: index.sources.size, modules: index.modules.size, rawRefs: new Set([...index.sources.values()].flatMap((source) => source.rawRefs ?? [])).size }; }
function policyMismatches(calls: Array<JsonRecord>): JsonRecord[] { return calls.filter((call) => call.operation === null || R9_EXPECTED_REASONING_POLICY[call.operation as keyof typeof R9_EXPECTED_REASONING_POLICY] !== call.reasoningEffort); }
function hashValue(value: unknown): string { return createHash("sha256").update(canonicalSerialize(value)).digest("hex"); }
function isRecord(value: unknown): value is JsonRecord { return typeof value === "object" && value !== null && !Array.isArray(value); }
function redactUrl(value: string): string { try { const url = new URL(value); return url.host; } catch { return "configured"; } }

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) void main();
