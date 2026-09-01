import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { GenerateOptions } from "@deepseek-ai/dsh-llm";
import { FullValidationObservingRuntime } from "../../../tools/knowledge-product-validation/full-validation-observing-runtime.ts";
import { c14FreshKbReconciliationBoundaryPasses, evaluatePrimaryCompletionGate } from "../../../tools/knowledge-product-validation/run-v03-r9-final-validation.ts";

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

test("R9-R2 C14 fresh-KB boundary requires zero existing candidates and reconciliation calls", () => {
  const clean = { existingRefCandidates: 0, reconciliationGroups: 0, reconciliationCandidates: 0, reconciliationLogicalCalls: 0, reconciliationPhysicalCalls: 0 };
  assert.equal(c14FreshKbReconciliationBoundaryPasses(clean), true);
  assert.equal(c14FreshKbReconciliationBoundaryPasses({ ...clean, existingRefCandidates: 1 }), false);
  assert.equal(c14FreshKbReconciliationBoundaryPasses({ ...clean, reconciliationLogicalCalls: 1 }), false);
  assert.equal(c14FreshKbReconciliationBoundaryPasses({ ...clean, reconciliationPhysicalCalls: 1 }), false);
});

test("R9-R2 launcher requires an explicit Commit A baseline and pins fresh-run identity", async () => {
  const source = await readFile(new URL("../../../tools/knowledge-product-validation/run-isolated-r9-r2-validation.ts", import.meta.url), "utf8");
  assert.match(source, /R9_R2_EXECUTION_BASELINE/);
  assert.match(source, /KNOWLEDGE-V0\.3-PRODUCT-VALIDATION-C-004-R9-R2-FINAL/);
  assert.match(source, /kb-product-validation-c004-r9-r2-final/);
  assert.match(source, /RESEARCHHUB_EXPECT_ZERO_RECONCILIATION/);
});
