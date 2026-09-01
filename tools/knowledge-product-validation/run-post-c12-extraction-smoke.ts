import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { KnowledgeCurationSkill } from "../../packages/skills/knowledge-curation/index.ts";
import type {
  KnowledgeCurationModel,
  KnowledgeCurationModelRequest,
} from "../../packages/skills/knowledge-curation/index.ts";
import { KNOWLEDGE_SCHEMA_V03 } from "../../packages/schemas/knowledge/v03/executable-schema.ts";
import { RELATION_SELECTION_GUIDANCE } from "../../packages/skills/knowledge-curation/prompts/relation-selection-guidance.ts";
import {
  DoclingDocumentParser,
  LocalResearchReportInputResolver,
} from "../../packages/plugins/document/index.ts";
import type {
  DocumentParseResult,
  DocumentParser,
} from "../../packages/plugins/document/types.ts";
import type {
  ResearchReportInputRef,
  ResolvedResearchReportInput,
  ResearchReportInputResolver,
  ResearchReportKnowledgeIngestionResult,
} from "../../packages/workflows/research-report-knowledge-ingestion/index.ts";
import { ResearchReportKnowledgeIngestionWorkflow } from "../../packages/workflows/research-report-knowledge-ingestion/index.ts";
import {
  KnowledgeBaseLoader,
  KnowledgeBaseRegistry,
  KnowledgeWriter,
  canonicalSerialize,
} from "../../packages/shared/knowledge-base/index.ts";
import {
  createKnowledgeStagedStateValidator,
  KnowledgeValidationSkill,
} from "../../packages/skills/knowledge-validation/index.ts";
import type { KnowledgeBaseHandle } from "../../packages/shared/knowledge-base/index.ts";
import { loadLocalRuntimeConfig } from "../../dsh/llm-runtime/local-runtime-config.ts";
import { createRealKnowledgeCurationModel } from "./deepseek-composition.ts";
import { inspectDoclingRuntime } from "../document-parser/doctor-docling.ts";
import { SmokeObservingRuntime } from "./run-flash-extraction-smoke.ts";

export const POST_C12_TASK_ID =
  "KNOWLEDGE-V0.3-POST-C12-REAL-EXTRACTION-SMOKE-C-004-S2";
export const POST_C12_BASELINE = "81b7b4b831c3630c2071a58e39026694bf7c682c";
export const POST_C12_KNOWLEDGE_BASE_ID =
  "kb-product-validation-c004-s2-post-c12";
export const POST_C12_EXPECTED_MODEL = "deepseek-v4-flash";
export const POST_C12_EXPECTED_PDF_SHA256 =
  "998703cef102300518bb2edcbcc3e9bc26fa374f157b0714f3986c5028d78d63";
export const POST_C12_EXPECTED_PDF_BYTES = 3_209_114;
const MAX_REAL_MODEL_INVOCATIONS = 5;
const EXPECTED_FIRST_BATCH = "batch-0001";

type JsonRecord = Record<string, unknown>;
type RelationObservation = {
  relationType: string | null;
  sourceEntityType: string | null;
  targetEntityType: string | null;
};

class PostC12SmokeStop extends Error {
  constructor(readonly batchId: string) {
    super(
      `Post-C12 smoke boundary before real model invocation for ${batchId}`,
    );
    this.name = "PostC12SmokeStop";
  }
}

class PostC12SmokeModel implements KnowledgeCurationModel {
  readonly calls: Array<
    JsonRecord & {
      instruction: string;
      operation: string;
      batchId?: string;
      delegatedToRealModel: boolean;
    }
  > = [];
  readonly instructions: string[] = [];
  readonly outputs: Array<{ batchId: string; output: JsonRecord }> = [];
  readonly requestedBatches: string[] = [];
  private readonly attempts = new Map<string, number>();
  private physicalCalls = 0;
  expectedStop: string | null = null;

  constructor(
    private readonly delegate: KnowledgeCurationModel,
    private readonly runtime: SmokeObservingRuntime,
  ) {}

  get physicalRealModelInvocations(): number {
    return this.physicalCalls;
  }

  async invoke(request: KnowledgeCurationModelRequest): Promise<unknown> {
    const input = isRecord(request.input) ? request.input : {};
    const operation = request.operation;
    const batchId =
      isRecord(input.batch) && typeof input.batch.batchId === "string"
        ? input.batch.batchId
        : undefined;
    const key = `${operation}|${batchId ?? ""}`;
    const attempt = (this.attempts.get(key) ?? 0) + 1;
    this.attempts.set(key, attempt);
    if (operation !== "understandReport" && operation !== "extractKnowledge")
      throw new Error(`Unexpected downstream operation ${operation}`);
    const call: JsonRecord & {
      instruction: string;
      operation: string;
      batchId?: string;
      delegatedToRealModel: boolean;
    } = {
      operation,
      ...(batchId ? { batchId } : {}),
      physicalAttempt: attempt,
      instruction: request.instruction,
      delegatedToRealModel: false,
      guidancePresent:
        operation === "extractKnowledge"
          ? request.instruction.includes(RELATION_SELECTION_GUIDANCE)
          : undefined,
      relationEntryCount:
        operation === "extractKnowledge"
          ? relationEntryCount(request.instruction)
          : undefined,
      input: inputObservation(input),
    };
    if (operation === "extractKnowledge") {
      if (!batchId)
        throw new Error("extractKnowledge request did not contain a batchId");
      this.requestedBatches.push(batchId);
      if (batchId !== EXPECTED_FIRST_BATCH) {
        this.expectedStop = batchId;
        this.calls.push(call);
        throw new PostC12SmokeStop(batchId);
      }
      this.instructions.push(request.instruction);
    }
    if (this.physicalCalls >= MAX_REAL_MODEL_INVOCATIONS)
      throw new Error(
        `real model invocation budget exceeded before ${operation}`,
      );
    call.delegatedToRealModel = true;
    this.physicalCalls += 1;
    this.calls.push(call);
    const observationStart = this.runtime.calls.length;
    try {
      const output = await this.delegate.invoke(request);
      call.outputShape = outputShape(output);
      call.runtimeObservation = this.runtime.calls[observationStart] ?? null;
      if (operation === "extractKnowledge" && batchId)
        this.outputs.push({ batchId, output: summarizeExtraction(output) });
      return output;
    } catch (error) {
      call.runtimeObservation = this.runtime.calls[observationStart] ?? null;
      call.error =
        error instanceof Error
          ? error.message.slice(0, 240)
          : String(error).slice(0, 240);
      throw error;
    }
  }
}

export async function main(): Promise<void> {
  const evidencePath =
    process.env.RESEARCHHUB_PRODUCT_VALIDATION_DURABLE_EVIDENCE ??
    join(
      process.cwd(),
      "tests/knowledge/product-validation/evidence/c004-s2-post-c12-extraction-smoke.json",
    );
  const evidence: JsonRecord = {
    taskId: POST_C12_TASK_ID,
    baseline: POST_C12_BASELINE,
    startedAt: new Date().toISOString(),
  };
  let root: string | undefined;
  let runtime: { close: () => Promise<void> } | undefined;
  try {
    const head = (await execGit(["rev-parse", "HEAD"])).trim();
    evidence.baselineCheck = {
      head,
      expected: POST_C12_BASELINE,
      exact: head === POST_C12_BASELINE,
    };
    if (head !== POST_C12_BASELINE)
      throw new Error("C12 accepted baseline mismatch");
    const config = loadLocalRuntimeConfig(process.env, process.cwd(), {
      requireRealLlm: true,
    });
    evidence.effectiveModel = {
      provider: config.provider,
      model: config.model,
      baseUrl: redactUrl(config.baseUrl),
      curationMaxTokens: config.curationMaxTokens,
    };
    if (
      config.provider !== "deepseek-official" ||
      config.model !== POST_C12_EXPECTED_MODEL
    )
      throw new Error(
        `effective runtime must be deepseek-official/${POST_C12_EXPECTED_MODEL}`,
      );
    const modelPreflight = await verifyDeepSeekModel(
      config.baseUrl,
      config.apiKey,
      config.model,
    );
    evidence.modelPreflight = modelPreflight;
    if (modelPreflight.status !== "READY")
      throw new Error(modelPreflight.diagnostic);
    const pdfPath = await findExactPdf();
    const pdfBytes = Uint8Array.from(await readFile(pdfPath));
    const sha256 = createHash("sha256").update(pdfBytes).digest("hex");
    evidence.pdf = {
      filename: basename(pdfPath),
      sha256,
      bytes: pdfBytes.byteLength,
      expectedSha256: POST_C12_EXPECTED_PDF_SHA256,
      expectedBytes: POST_C12_EXPECTED_PDF_BYTES,
      sha256Match: sha256 === POST_C12_EXPECTED_PDF_SHA256,
      bytesMatch: pdfBytes.byteLength === POST_C12_EXPECTED_PDF_BYTES,
    };
    if (
      sha256 !== POST_C12_EXPECTED_PDF_SHA256 ||
      pdfBytes.byteLength !== POST_C12_EXPECTED_PDF_BYTES
    )
      throw new Error("PDF identity mismatch");
    const doclingPreflight = await inspectDoclingRuntime();
    evidence.doclingPreflight = doclingPreflight;
    if (doclingPreflight.status !== "READY")
      throw new Error("Local Docling is unavailable");
    root = await createFreshKnowledgeBase();
    const loader = new KnowledgeBaseLoader({
      registry: new KnowledgeBaseRegistry(),
    });
    const initial = await loader.mount(root);
    const validation = new KnowledgeValidationSkill({ loader });
    const initialValidation = await validation.validateKnowledgeBase(
      initial,
      "all",
    );
    evidence.freshKnowledgeBase = {
      knowledgeBaseId: initial.knowledgeBaseId,
      schemaVersion: initial.schemaVersion,
      storageFormatVersion: initial.storageFormatVersion,
      revision: initial.revision,
      writable: initial.writable,
      validation: initialValidation.status,
      root: "system-temp (removed after run)",
    };
    if (
      initial.knowledgeBaseId !== POST_C12_KNOWLEDGE_BASE_ID ||
      initial.schemaVersion !== "0.3" ||
      initial.storageFormatVersion !== "1" ||
      initial.revision !== 0 ||
      !initial.writable ||
      initialValidation.status !== "passed"
    )
      throw new Error("fresh Knowledge Base preflight failed");
    const parser = new RecordingParser(new DoclingDocumentParser());
    const resolver = new RecordingResolver(
      new LocalResearchReportInputResolver({
        documentParser: parser,
        parserId: parser.id,
      }),
    );
    let observingRuntime: SmokeObservingRuntime | undefined;
    const real = await createRealKnowledgeCurationModel(
      config,
      undefined,
      (delegate) => {
        const observer = new SmokeObservingRuntime(delegate);
        observingRuntime = observer;
        return observer;
      },
    );
    runtime = real;
    if (!observingRuntime)
      throw new Error("runtime observer was not initialized");
    const smokeModel = new PostC12SmokeModel(real.model, observingRuntime);
    const writer = new KnowledgeWriter({
      loader,
      stagedStateValidator: createKnowledgeStagedStateValidator(validation),
    });
    let writerInvocations = 0;
    const workflow = new ResearchReportKnowledgeIngestionWorkflow({
      targetResolver: createTargetResolver(root),
      inputResolver: resolver,
      curation: new KnowledgeCurationSkill({ model: smokeModel }),
      validation,
      writer: {
        write: async (handle, receipt) => {
          writerInvocations += 1;
          return writer.write(handle, receipt);
        },
      },
    });
    const result = await workflow.execute(inputFor(pdfPath));
    const parsed = parser.result;
    const parserSummary = parserEvidence(parsed);
    evidence.docling = parserSummary;
    if (!parserMatchesExpected(parserSummary))
      throw new Error("Docling metrics differ from frozen baseline");
    const firstBatchCalls = smokeModel.calls.filter(
      (call) =>
        call.operation === "extractKnowledge" &&
        call.batchId === EXPECTED_FIRST_BATCH &&
        call.delegatedToRealModel,
    );
    const firstBatchLogical = result.modelCalls.find(
      (call) =>
        call.operation === "extractKnowledge" &&
        call.groupId === EXPECTED_FIRST_BATCH,
    );
    const firstBatchOutput = smokeModel.outputs.at(-1)?.output ?? {};
    evidence.result = {
      status: result.status,
      failureStage: result.failureStage ?? null,
      errors: result.errors,
      raw: result.raw,
      modelCalls: result.modelCalls,
    };
    evidence.modelCalls = smokeModel.calls.map((call) => ({
      operation: call.operation,
      batchId: call.batchId ?? null,
      physicalAttempt: call.physicalAttempt,
      delegatedToRealModel: call.delegatedToRealModel,
      guidancePresent: call.guidancePresent ?? null,
      canonicalRelationEntryCount: call.relationEntryCount ?? null,
      input: call.input,
      outputShape: call.outputShape ?? null,
      runtimeObservation: call.runtimeObservation ?? null,
      error: call.error ?? null,
    }));
    const retryGuidanceEqual =
      smokeModel.instructions.length < 2 ||
      smokeModel.instructions[1]?.slice(
        0,
        smokeModel.instructions[0]!.length,
      ) === smokeModel.instructions[0];
    evidence.c12RuntimeObservation = {
      operation: "extractKnowledge",
      guidancePresent: smokeModel.calls
        .filter((call) => call.operation === "extractKnowledge")
        .every((call) => call.guidancePresent === true),
      canonicalRelationEntryCount: relationEntryCount(
        RELATION_SELECTION_GUIDANCE,
      ),
      upstreamOfAdvertisedEndpointCompatibility: `${KNOWLEDGE_SCHEMA_V03.relation.definitions.upstream_of.sourceTypes.join("|")} -> ${KNOWLEDGE_SCHEMA_V03.relation.definitions.upstream_of.targetTypes.join("|")}`,
      extractionRequestCount: smokeModel.instructions.length,
      retryGuidanceEqual,
      retryFeedbackBounded:
        smokeModel.instructions.length < 2 ||
        retryFeedbackBounded(smokeModel.instructions[1]!),
      retryCount: firstBatchLogical?.retryCount ?? null,
    };
    evidence.extractionResult = {
      entities: firstBatchOutput.entities ?? null,
      relations: firstBatchOutput.relations ?? null,
      claims: firstBatchOutput.claims ?? null,
      validationStatus:
        firstBatchLogical?.succeeded === true ? "passed" : "failed",
      retryCount: firstBatchLogical?.retryCount ?? null,
      validationFailures: firstBatchLogical?.validationFailures ?? [],
      relationObservations: firstBatchOutput.relationObservations ?? [],
    };
    evidence.batch0001 = {
      realPhysicalAttempts: firstBatchCalls.length,
      calls: firstBatchCalls.map((call) => ({
        physicalAttempt: call.physicalAttempt,
        guidancePresent: call.guidancePresent,
        canonicalRelationEntryCount: call.relationEntryCount,
        input: call.input,
        outputShape: call.outputShape,
        error: call.error ?? null,
      })),
    };
    evidence.smokeBoundary = {
      expectedStop: smokeModel.expectedStop,
      nextBatchRequested:
        smokeModel.requestedBatches.find(
          (batchId) => batchId !== EXPECTED_FIRST_BATCH,
        ) ?? null,
      nextBatchDelegatedToRealModel: smokeModel.calls.some(
        (call) =>
          call.operation === "extractKnowledge" &&
          call.batchId !== EXPECTED_FIRST_BATCH &&
          call.delegatedToRealModel,
      ),
      writerInvocations,
      downstreamModelCalls: result.modelCalls.filter((call) =>
        ["reconcileKnowledge", "analyzeSchemaGaps"].includes(call.operation),
      ).length,
      finalRevision: result.finalRevision,
    };
    evidence.modelAccounting = {
      logicalModelCalls: result.modelCalls.length,
      physicalRealModelInvocations: smokeModel.physicalRealModelInvocations,
      maximumAllowed: MAX_REAL_MODEL_INVOCATIONS,
      underBudget:
        smokeModel.physicalRealModelInvocations <= MAX_REAL_MODEL_INVOCATIONS,
    };
    const pass =
      firstBatchLogical?.succeeded === true &&
      smokeModel.calls
        .filter((call) => call.operation === "extractKnowledge")
        .every((call) => call.guidancePresent === true) &&
      relationEntryCount(RELATION_SELECTION_GUIDANCE) ===
        KNOWLEDGE_SCHEMA_V03.relation.types.length &&
      smokeModel.expectedStop !== null &&
      !Boolean(
        evidence.smokeBoundary &&
        (evidence.smokeBoundary as JsonRecord).nextBatchDelegatedToRealModel,
      ) &&
      writerInvocations === 0 &&
      result.finalRevision === 0 &&
      smokeModel.physicalRealModelInvocations <= MAX_REAL_MODEL_INVOCATIONS &&
      retryGuidanceEqual;
    evidence.status = pass ? "PASS" : "FAIL / SOL REVIEW REQUIRED";
    evidence.recommendation = pass
      ? "Eligible for C4-R9 final full-pipeline validation using Flash."
      : "Stop; do not reinterpret this smoke as product acceptance.";
    evidence.completedAt = new Date().toISOString();
    await writeEvidence(evidencePath, evidence);
    console.log(
      JSON.stringify({
        status: evidence.status,
        evidencePath,
        model: evidence.effectiveModel,
        pdf: evidence.pdf,
        docling: evidence.docling,
        c12RuntimeObservation: evidence.c12RuntimeObservation,
        extractionResult: evidence.extractionResult,
        smokeBoundary: evidence.smokeBoundary,
        modelAccounting: evidence.modelAccounting,
      }),
    );
    if (!pass) process.exitCode = 1;
  } catch (error) {
    evidence.status = "FAIL / SOL REVIEW REQUIRED";
    evidence.failure = {
      message: error instanceof Error ? error.message : String(error),
    };
    evidence.completedAt = new Date().toISOString();
    await writeEvidence(evidencePath, evidence);
    console.log(
      JSON.stringify({
        status: evidence.status,
        evidencePath,
        failure: evidence.failure,
      }),
    );
    process.exitCode = 1;
  } finally {
    if (runtime) await runtime.close();
    if (root) await rm(root, { recursive: true, force: true });
  }
}

class RecordingParser implements DocumentParser {
  readonly id: string;
  result: DocumentParseResult | undefined;
  constructor(private readonly delegate: DocumentParser) {
    this.id = delegate.id;
  }
  supports(input: { filename: string; mediaType: string }): boolean {
    return this.delegate.supports(input);
  }
  async parse(input: {
    bytes: Uint8Array;
    filename: string;
    mediaType: string;
  }): Promise<DocumentParseResult> {
    this.result = await this.delegate.parse(input);
    return this.result;
  }
}

class RecordingResolver implements ResearchReportInputResolver {
  constructor(private readonly delegate: ResearchReportInputResolver) {}
  async resolve(
    inputRef: ResearchReportInputRef,
  ): Promise<ResolvedResearchReportInput> {
    return this.delegate.resolve(inputRef);
  }
}

function inputFor(pdfPath: string) {
  return {
    workflowRunId: "product-validation-c004-s2-post-c12",
    knowledgeBaseId: POST_C12_KNOWLEDGE_BASE_ID,
    report: {
      inputRef: { type: "file" as const, reference: pdfPath },
      suppliedMetadata: {
        title: basename(pdfPath),
        publisher: null,
        institution: null,
        author: null,
        publishedAt: null,
        sourceUrl: null,
      },
    },
    options: { mode: "commit" as const, reprocess: true },
  };
}
function createTargetResolver(root: string) {
  return {
    async resolve(): Promise<{
      handle: KnowledgeBaseHandle;
      index: import("../../packages/shared/knowledge-base/knowledge-index-v03.ts").KnowledgeIndexV03;
    }> {
      const loader = new KnowledgeBaseLoader({
        registry: new KnowledgeBaseRegistry(),
      });
      const handle = await loader.mount(root);
      const state = await loader.loadRuntimeState(handle);
      return {
        handle,
        index:
          state.index as import("../../packages/shared/knowledge-base/knowledge-index-v03.ts").KnowledgeIndexV03,
      };
    },
  };
}
async function createFreshKnowledgeBase(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "researchhub-c004-s2-post-c12-"));
  await mkdir(join(root, "registry"), { recursive: true });
  const timestamp = "2026-09-01T00:00:00.000Z";
  await writeFile(
    join(root, "manifest.yaml"),
    `${canonicalSerialize({ knowledgeBaseId: POST_C12_KNOWLEDGE_BASE_ID, name: "C-004-S2 post-C12 disposable KB", schemaVersion: "0.3", storageFormatVersion: "1", revision: 0, status: "active", createdAt: timestamp, updatedAt: timestamp })}\n`,
    "utf8",
  );
  await writeFile(join(root, "registry/assets.yaml"), "{}\n", "utf8");
  await writeFile(join(root, "registry/raw.yaml"), "{}\n", "utf8");
  return root;
}
async function findExactPdf(): Promise<string> {
  const requested = process.env.RESEARCHHUB_PRODUCT_VALIDATION_PDF;
  if (requested) {
    await access(requested);
    return resolve(requested);
  }
  const directory = "C:\\Users\\Administrator\\Documents";
  for (const entry of await readdir(directory)) {
    if (!entry.toLocaleLowerCase().endsWith(".pdf")) continue;
    const candidate = join(directory, entry);
    const bytes = Uint8Array.from(await readFile(candidate));
    if (
      bytes.byteLength === POST_C12_EXPECTED_PDF_BYTES &&
      createHash("sha256").update(bytes).digest("hex") ===
        POST_C12_EXPECTED_PDF_SHA256
    )
      return candidate;
  }
  throw new Error("exact R8 PDF was not found");
}
async function verifyDeepSeekModel(
  baseUrl: string,
  apiKey: string | undefined,
  model: string,
): Promise<JsonRecord & { status: string; diagnostic: string }> {
  if (!apiKey)
    return {
      status: "BLOCKED",
      diagnostic: "DEEPSEEK_API_KEY is not configured",
    };
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
      },
    });
    if (!response.ok)
      return {
        status: "BLOCKED",
        httpStatus: response.status,
        diagnostic: `DeepSeek /models rejected credentials with HTTP ${response.status}`,
      };
    const body = (await response.json()) as { data?: unknown };
    const available = Array.isArray(body.data)
      ? body.data.filter(
          (item): item is { id: string } =>
            isRecord(item) && typeof item.id === "string",
        )
      : [];
    return available.some((item) => item.id === model)
      ? {
          status: "READY",
          httpStatus: response.status,
          modelAvailable: true,
          diagnostic: "DeepSeek credential and Flash model accepted by /models",
        }
      : {
          status: "BLOCKED",
          httpStatus: response.status,
          modelAvailable: false,
          diagnostic: `Configured model ${model} is not present in DeepSeek /models`,
        };
  } catch (error) {
    return {
      status: "BLOCKED",
      diagnostic: `DeepSeek model preflight transport failure: ${error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180)}`,
    };
  }
}
function parserEvidence(result: DocumentParseResult | undefined): JsonRecord {
  const chunks = result?.chunks ?? [];
  return {
    parser: result?.parser ?? null,
    pageCount: result?.pageCount ?? result?.quality?.pageCount ?? null,
    chunks: chunks.length,
    uniqueChunkIds: new Set(chunks.map((chunk) => chunk.chunkId)).size,
    emptyChunks: chunks.filter((chunk) => !chunk.text.trim()).length,
    sections: new Set(
      chunks
        .map((chunk) => chunk.section)
        .filter((section): section is string => Boolean(section)),
    ).size,
    tables:
      result?.structure?.tableCount ?? result?.quality?.tableCount ?? null,
    images:
      result?.structure?.imageCount ?? result?.quality?.imageCount ?? null,
    normalizedCharacters:
      result?.quality?.normalizedCharacters ??
      result?.normalizedText.length ??
      0,
  };
}
function parserMatchesExpected(value: JsonRecord): boolean {
  return (
    value.pageCount === 103 &&
    value.chunks === 1_523 &&
    value.uniqueChunkIds === 1_523 &&
    value.emptyChunks === 0 &&
    value.sections === 154 &&
    value.tables === 45 &&
    value.images === 178 &&
    value.normalizedCharacters === 97_784
  );
}
function relationEntryCount(instruction: string): number {
  return instruction
    .split("\n")
    .filter(
      (line) =>
        line.startsWith("- ") &&
        line.includes(": ") &&
        line.includes("semanticDescription="),
    ).length;
}
function relationObservations(output: JsonRecord): RelationObservation[] {
  return Array.isArray(output.relations)
    ? output.relations.filter(isRecord).map((relation) => ({
        relationType:
          typeof relation.relationType === "string"
            ? relation.relationType
            : null,
        sourceEntityType:
          isRecord(relation.sourceMention) &&
          typeof relation.sourceMention.entityType === "string"
            ? relation.sourceMention.entityType
            : null,
        targetEntityType:
          isRecord(relation.targetMention) &&
          typeof relation.targetMention.entityType === "string"
            ? relation.targetMention.entityType
            : null,
      }))
    : [];
}
function summarizeExtraction(value: unknown): JsonRecord {
  if (!isRecord(value))
    return {
      entities: null,
      relations: null,
      claims: null,
      relationObservations: [],
    };
  return {
    entities: Array.isArray(value.entities) ? value.entities.length : null,
    relations: Array.isArray(value.relations) ? value.relations.length : null,
    claims: Array.isArray(value.claims) ? value.claims.length : null,
    relationObservations: relationObservations(value),
  };
}

function inputObservation(input: JsonRecord): JsonRecord {
  const batch = isRecord(input.batch) ? input.batch : {};
  const chunks = Array.isArray(batch.chunks)
    ? batch.chunks.filter(isRecord)
    : [];
  return {
    batchId: typeof batch.batchId === "string" ? batch.batchId : null,
    currentBatchChunkCount: chunks.length,
    currentBatchCharacterCount: chunks.reduce(
      (sum, chunk) =>
        sum + (typeof chunk.text === "string" ? chunk.text.length : 0),
      0,
    ),
    fullDocumentVisible: Object.hasOwn(input, "document"),
    normalizedTextVisible: Object.hasOwn(input, "normalizedText"),
    serializedInputCharacters: JSON.stringify(input).length,
  };
}
function retryFeedbackBounded(instruction: string): boolean {
  const marker = "Validation message: ";
  const start = instruction.indexOf(marker);
  const end = instruction.indexOf("\nRegenerate", start);
  return start < 0 || end < 0 || end - (start + marker.length) <= 240;
}
function outputShape(value: unknown): JsonRecord {
  if (!isRecord(value))
    return {
      type: Array.isArray(value)
        ? "array"
        : value === null
          ? "null"
          : typeof value,
    };
  return {
    type: "object",
    keys: Object.keys(value).sort(),
    entities: Array.isArray(value.entities) ? value.entities.length : undefined,
    relations: Array.isArray(value.relations)
      ? value.relations.length
      : undefined,
    claims: Array.isArray(value.claims) ? value.claims.length : undefined,
  };
}
function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "[configured]";
  }
}
async function execGit(args: string[]): Promise<string> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  return (await promisify(execFile)("git", args)).stdout;
}
async function writeEvidence(path: string, value: JsonRecord): Promise<void> {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href)
  void main();
