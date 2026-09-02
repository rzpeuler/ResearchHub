import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { GenerateOptions } from "@deepseek-ai/dsh-llm";
import { FullValidationObservingRuntime } from "../../../tools/knowledge-product-validation/full-validation-observing-runtime.ts";
import { buildReconciliationBoundary, c14FreshKbReconciliationBoundaryPasses, classifyBlockedStatusFromUpstreamError, evaluatePrimaryCompletionGate } from "../../../tools/knowledge-product-validation/run-v03-r9-final-validation.ts";

test("R9 full-validation observer is passive and preserves the upstream signal", async () => {
  const source = await readFile(new URL("../../../tools/knowledge-product-validation/full-validation-observing-runtime.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /new AbortController\s*\(/);
  assert.doesNotMatch(source, /setTimeout\s*\(/);

  const controller = new AbortController();
  let receivedSignal: AbortSignal | undefined;
  const runtime = new FullValidationObservingRuntime({
    async *stream(options) {
      receivedSignal = options.signal;
      await new Promise((resolve) => setTimeout(resolve, 220));
    },
  });
  const options = {
    messages: [{ content: [{ type: "text", text: "Operation: extractKnowledge" }] }],
    signal: controller.signal,
    reasoningEffort: "off",
    maxTokens: 64,
    temperature: 0,
  } as unknown as GenerateOptions;

  for await (const _chunk of runtime.stream(options)) { /* passive stream */ }

  assert.equal(receivedSignal, controller.signal);
  assert.equal(runtime.observerCreatedTimeout, false);
  assert.equal(runtime.observerCreatedAbortController, false);
  assert.equal(runtime.originalSignalPreserved, true);
  assert.ok((runtime.calls[0]?.durationMs ?? 0) >= 200);
  assert.equal(runtime.calls[0]?.upstreamError, undefined);
});

test("R9 blocked-result diagnosis follows independent frozen facts before success-only invariants", () => {
  const docling = {
    pageCount: 103,
    chunks: 1_523,
    uniqueChunkIds: 1_523,
    emptyChunks: 0,
    sections: 154,
    tables: 45,
    images: 178,
    normalizedCharacters: 97_784,
  };
  const planned = {
    planned: 18,
    inputChunks: 1_523,
    inputUniqueChunks: 1_523,
    plannedCoveredChunks: 1_523,
    plannedCoveredUniqueChunks: 1_523,
    omissions: 0,
    duplicateCoverage: 0,
    complete: true,
  };
  const gate = evaluatePrimaryCompletionGate({ status: "blocked", batches: { batchCount: 0, chunkCount: 0 } } as never, docling, planned);
  assert.equal(gate, "blocked");
});

test("R9 boundary records not_reached before Reference Resolution", () => {
  const boundary = buildReconciliationBoundary({ referenceResolutionReached: false, referenceResolution: { existing_ref: 0, new_object_key: 0, ambiguous: 0, invalid: 0 }, reconciliation: { groups: 0 } }, 0, 0);
  assert.deepEqual(boundary, { status: "not_reached", existingRefCandidates: null, newObjectKeyCandidates: null, ambiguousCandidates: null, invalidCandidates: null, reconciliationGroups: null, logicalCalls: 0, physicalCalls: 0 });
});

test("R9 boundary reachability is sourced from the explicit stage fact", async () => {
  const source = await readFile(new URL("../../../tools/knowledge-product-validation/run-v03-r9-final-validation.ts", import.meta.url), "utf8");
  const start = source.indexOf("export function buildReconciliationBoundary");
  const end = source.indexOf("export function c14FreshKbReconciliationBoundaryPasses");
  assert.ok(start >= 0 && end > start);
  const boundarySource = source.slice(start, end);
  assert.match(boundarySource, /referenceResolutionReached/);
  assert.doesNotMatch(boundarySource, /primary\.status/);
});

test("R9 C14 boundary is passed only after a reached zero-call resolution", () => {
  const clean = { existingRefCandidates: 0, reconciliationGroups: 0, logicalCalls: 0, physicalCalls: 0 };
  assert.equal(c14FreshKbReconciliationBoundaryPasses(clean), true);
  assert.equal(c14FreshKbReconciliationBoundaryPasses({ ...clean, existingRefCandidates: 1 }), false);
  assert.equal(c14FreshKbReconciliationBoundaryPasses({ ...clean, logicalCalls: 1 }), false);
  assert.equal(c14FreshKbReconciliationBoundaryPasses({ ...clean, physicalCalls: 1 }), false);
  const reached = buildReconciliationBoundary({ referenceResolutionReached: true, referenceResolution: { existing_ref: 0, new_object_key: 4, ambiguous: 1, invalid: 0 }, reconciliation: { groups: 0 } }, 0, 0);
  assert.equal(reached.status, "reached_and_passed");
  assert.equal(reached.newObjectKeyCandidates, 4);
  assert.equal(reached.ambiguousCandidates, 1);
  const postResolutionBlock = buildReconciliationBoundary({ referenceResolutionReached: true, referenceResolution: { existing_ref: 0, new_object_key: 0, ambiguous: 0, invalid: 0 }, reconciliation: { groups: 0 } }, 0, 0);
  assert.equal(postResolutionBlock.status, "reached_and_passed");
  const failed = buildReconciliationBoundary({ referenceResolutionReached: true, referenceResolution: { existing_ref: 1, new_object_key: 0, ambiguous: 0, invalid: 0 }, reconciliation: { groups: 1 } }, 1, 1);
  assert.equal(failed.status, "reached_and_failed");
});

test("R9 blocked classification reserves external status for upstream errors", () => {
  assert.equal(classifyBlockedStatusFromUpstreamError(false), "FAIL / SOL REVIEW REQUIRED");
  assert.equal(classifyBlockedStatusFromUpstreamError(true), "BLOCKED / EXTERNAL SERVICE - SOL REVIEW REQUIRED");
});

test("R9-R2 launcher requires an explicit Commit A baseline and pins fresh-run identity", async () => {
  const source = await readFile(new URL("../../../tools/knowledge-product-validation/run-isolated-r9-r2-validation.ts", import.meta.url), "utf8");
  assert.match(source, /R9_R2_EXECUTION_BASELINE/);
  assert.match(source, /KNOWLEDGE-V0\.3-PRODUCT-VALIDATION-C-004-R9-R2-FINAL/);
  assert.match(source, /kb-product-validation-c004-r9-r2-final/);
  assert.match(source, /RESEARCHHUB_EXPECT_ZERO_RECONCILIATION/);
});

test("C15 preserves the historical R9-R2 evidence and uses derived adjudication", async () => {
  const historicalPath = "tests/knowledge/product-validation/evidence/c004-r9-r2-final-full-pipeline.json";
  const current = await readFile(new URL(`../../../${historicalPath}`, import.meta.url), "utf8");
  const committed = execFileSync("git", ["show", "def4b01622bcd6b2b2307ee54e171a7f7a0eebeb:" + historicalPath], { encoding: "utf8" });
  assert.equal(current, committed);
  const adjudication = await readFile(new URL("../../../tests/knowledge/product-validation/evidence/c004-r9-r2-sol-adjudication.json", import.meta.url), "utf8");
  assert.match(adjudication, /originalEvidencePreserved/);
  assert.match(adjudication, /Extraction Output Completion Boundary Defect/);
});
