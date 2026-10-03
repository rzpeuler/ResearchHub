import assert from "node:assert/strict";
import test from "node:test";
import type { ReasoningExecutor, ReasoningRequest, ReasoningResult } from "../../plugins/reasoning/contracts.ts";
import { ReasoningExecutorError } from "../../plugins/reasoning/errors.ts";
import {
  fingerprintThemeIndustry,
  fingerprintThemeRelation,
  ThemeFrameworkValidationError,
  validateThemeFrameworkResult,
  type ThemeFrameworkInput,
} from "../../skills/theme-framework/contracts.ts";
import {
  executeThemeFramework,
} from "../../skills/theme-framework/semantic.ts";

const input: ThemeFrameworkInput = {
  theme: { name: "AI Compute", definition: "Infrastructure enabling AI workloads." },
  existingKnowledge: {
    summary: "Bounded summary of compute demand, servers, memory and board inputs.",
    industries: [],
  },
  evidence: [
    { evidenceId: "e-compute", origin: "external", description: "AI accelerator server bill of materials", sourceRef: "src-server", publishedAt: "2026-09-15" },
    { evidenceId: "e-pcb", origin: "external", description: "High-layer-count PCB uses copper foil and electronic cloth", sourceRef: "src-pcb" },
    { evidenceId: "e-memory", origin: "existing_kb", description: "Memory components are used by consumer devices", sourceRef: "claim-memory" },
    { evidenceId: "e-cross", origin: "external", description: "Data-center power equipment serves server halls", sourceRef: "src-power" },
  ],
  priorDecisions: [],
};

function node(
  candidateId: string,
  name: string,
  recommendation: "include" | "exclude" | "pending",
  evidenceRefs: string[],
  coverageGaps: string[] = [],
) {
  return {
    candidateId,
    name,
    description: `${name} economic activity`,
    independentlyResearchableRationale: `${name} has a distinct supply, demand, cost, and competitive structure.`,
    themeRelevanceRationale: `${name} can affect AI compute capacity or economics.`,
    boundaryRationale: `${name} is evaluated independently against the AI compute scope.`,
    recommendation,
    decisionChange: "new",
    evidenceRefs,
    coverageGaps,
  };
}

function edge(
  candidateId: string,
  sourceIndustryRef: string,
  targetIndustryRef: string,
  evidenceRefs: string[],
  topologyRole: "main_chain" | "cross_chain" = "main_chain",
  recommendation: "include" | "exclude" | "pending" = "include",
) {
  return {
    candidateId,
    sourceIndustryRef,
    targetIndustryRef,
    relationType: "upstream_of",
    topologyRole,
    directionRationale: `${sourceIndustryRef} supplies an input to ${targetIndustryRef}.`,
    themeRelevanceRationale: "The direction clarifies an AI compute capacity or cost dependency.",
    boundaryRationale: "Relation truth and Theme inclusion are assessed separately.",
    recommendation,
    decisionChange: "new",
    evidenceRefs,
    coverageGaps: [],
  };
}

function output() {
  return {
    proposedDefinition: { statement: "Industries whose products or services materially enable AI compute capacity or economics.", status: "supported", evidenceRefs: ["e-compute"] },
    inclusionPrinciples: ["Include independently researchable activities that materially enable AI compute."],
    exclusionPrinciples: ["Exclude downstream markets with no material AI compute decision relevance."],
    industryCandidates: [
      node("pcb", "AI server PCB", "include", ["e-pcb"]),
      node("foil", "Electronic copper foil", "include", ["e-pcb"]),
      node("cloth", "Electronic cloth", "exclude", ["e-pcb"]),
      node("memory", "Memory", "include", ["e-memory"]),
      node("consumer", "Consumer electronics", "exclude", ["e-memory"]),
      node("power", "Data-center infrastructure services", "include", ["e-cross"]),
      node("network", "Data-center networking equipment", "include", ["e-cross"]),
      node("emerging", "Emerging accelerator packaging", "pending", [], ["Need attributable qualification and capacity evidence."]),
    ],
    relationCandidates: [
      edge("foil-pcb", "foil", "pcb", ["e-pcb"]),
      edge("cloth-pcb", "cloth", "pcb", ["e-pcb"], "main_chain", "exclude"),
      edge("memory-consumer", "memory", "consumer", ["e-memory"], "main_chain", "exclude"),
      edge("network-pcb", "network", "pcb", ["e-cross"], "cross_chain"),
    ],
    coverageGaps: [
      { gapId: "gap-packaging", question: "What evidence establishes accelerator package capacity?", reason: "Current bounded evidence does not show qualification or commercial capacity.", affectedCandidateIds: ["emerging"] },
    ],
  };
}

test("theme framework preserves PCB upstream boundary, memory exclusion, cross links and isolated infrastructure", () => {
  const result = validateThemeFrameworkResult(output(), input);
  const nodes = new Map(result.industryCandidates.map((item) => [item.candidateId, item]));
  assert.equal(nodes.get("pcb")?.recommendation, "include");
  assert.equal(nodes.get("foil")?.recommendation, "include");
  assert.equal(nodes.get("cloth")?.recommendation, "exclude");
  assert.equal(nodes.get("consumer")?.recommendation, "exclude");
  assert.equal(nodes.get("emerging")?.recommendation, "pending");
  assert.ok(result.relationCandidates.some((relation) => relation.sourceIndustryRef === "foil" && relation.targetIndustryRef === "pcb"));
  assert.ok(result.relationCandidates.some((relation) => relation.topologyRole === "cross_chain" && relation.sourceIndustryRef === "network"));
  assert.equal(result.relationCandidates.some((relation) => relation.sourceIndustryRef === "power" || relation.targetIndustryRef === "power"), false);
  assert.equal(result.relationCandidates.some((relation) => relation.sourceIndustryRef === "emerging" || relation.targetIndustryRef === "emerging"), false);
  assert.match(nodes.get("power")?.semanticFingerprint ?? "", /^industry-name:/);
});

test("theme framework uses prior scope decisions and permits reopening only with new evidence", () => {
  const fingerprint = fingerprintThemeIndustry("AI server PCB");
  const prior: ThemeFrameworkInput = {
    ...input,
    existingKnowledge: { ...input.existingKnowledge, industries: [{ ref: "entity:industry-pcb", name: "AI server PCB" }] },
    priorDecisions: [{ decisionId: "prior-pcb", semanticFingerprint: fingerprint, candidateType: "industry", recommendation: "exclude", rationale: "Earlier scope decision", evidenceRefs: ["e-pcb"] }],
  };
  const unchanged = output();
  const pcb = unchanged.industryCandidates[0] as Record<string, unknown>;
  pcb.recommendation = "exclude";
  pcb.existingIndustryRef = "entity:industry-pcb";
  pcb.decisionChange = "unchanged";
  pcb.priorDecisionId = "prior-pcb";
  (unchanged.relationCandidates[0] as Record<string, unknown>).recommendation = "exclude";
  (unchanged.relationCandidates[3] as Record<string, unknown>).recommendation = "exclude";
  const accepted = validateThemeFrameworkResult(unchanged, prior);
  assert.equal(accepted.industryCandidates[0]?.decisionChange, "unchanged");

  const reopened = output();
  const reopenedPcb = reopened.industryCandidates[0] as Record<string, unknown>;
  reopenedPcb.decisionChange = "reopen";
  reopenedPcb.priorDecisionId = "prior-pcb";
  reopenedPcb.evidenceRefs = ["e-pcb", "e-cross"];
  reopenedPcb.reopenEvidenceRefs = ["e-cross"];
  assert.equal(validateThemeFrameworkResult(reopened, prior).industryCandidates[0]?.decisionChange, "reopen");

  const unsupportedReopen = output();
  const unsupportedPcb = unsupportedReopen.industryCandidates[0] as Record<string, unknown>;
  unsupportedPcb.decisionChange = "reopen";
  unsupportedPcb.priorDecisionId = "prior-pcb";
  unsupportedPcb.reopenEvidenceRefs = ["e-pcb"];
  assert.throws(() => validateThemeFrameworkResult(unsupportedReopen, prior), (error: unknown) => error instanceof ThemeFrameworkValidationError && error.code === "reopen_requires_new_evidence");
});

test("theme framework rejects cycles among included directed relations", () => {
  const cyclic = output();
  (cyclic.relationCandidates as unknown[]).push(edge("pcb-foil", "pcb", "foil", ["e-pcb"]));
  assert.throws(() => validateThemeFrameworkResult(cyclic, input), (error: unknown) => error instanceof ThemeFrameworkValidationError && error.code === "directed_relation_cycle");
});

test("theme framework rejects forged evidence, unknown nodes, and ungrounded scope recommendations", () => {
  const forgedEvidence = output();
  (forgedEvidence.industryCandidates[0] as { evidenceRefs: string[] }).evidenceRefs = ["e-forged"];
  assert.throws(() => validateThemeFrameworkResult(forgedEvidence, input), (error: unknown) => error instanceof ThemeFrameworkValidationError && error.code === "evidence_ref_unknown");

  const unknownEndpoint = output();
  (unknownEndpoint.relationCandidates[0] as { sourceIndustryRef: string }).sourceIndustryRef = "industry:unprovided";
  assert.throws(() => validateThemeFrameworkResult(unknownEndpoint, input), (error: unknown) => error instanceof ThemeFrameworkValidationError && error.code === "relation_endpoint_unknown");

  const ungrounded = output();
  (ungrounded.industryCandidates[0] as { evidenceRefs: string[] }).evidenceRefs = [];
  assert.throws(() => validateThemeFrameworkResult(ungrounded, input), (error: unknown) => error instanceof ThemeFrameworkValidationError && error.code === "decision_ungrounded");

  const unknownIndustryRef = output();
  (unknownIndustryRef.industryCandidates[0] as { existingIndustryRef?: string }).existingIndustryRef = "entity:unprovided";
  assert.throws(() => validateThemeFrameworkResult(unknownIndustryRef, input), (error: unknown) => error instanceof ThemeFrameworkValidationError && error.code === "existing_industry_ref_unknown");
});

test("semantic transport omits an empty optional Industry enum but preserves non-empty refs", async () => {
  const requests: ReasoningRequest[] = [];
  const executor: ReasoningExecutor = {
    capabilities: () => ({ maxContextTokens: 4000, maxOutputTokens: 2000, structuredOutputSupport: true, maxConcurrency: 1 }),
    execute: async (request) => { requests.push(request); return { operation: request.operation, output: output() }; },
  };

  assert.equal((await executeThemeFramework(input, executor)).status, "complete");
  const emptyContract = requests[0]?.outputContract as { properties: { industryCandidates: { items: { properties: Record<string, unknown> } }; relationCandidates: { items: { properties: Record<string, unknown> } } } };
  const emptyIndustryProperties = emptyContract.properties.industryCandidates.items.properties;
  const emptyRelationProperties = emptyContract.properties.relationCandidates.items.properties;
  assert.equal(Object.hasOwn(emptyIndustryProperties, "existingIndustryRef"), false);
  assert.equal(Object.hasOwn(emptyIndustryProperties, "priorDecisionId"), false);
  assert.equal(Object.hasOwn(emptyIndustryProperties, "reopenEvidenceRefs"), false);
  assert.equal(Object.hasOwn(emptyRelationProperties, "priorDecisionId"), false);
  assert.equal(Object.hasOwn(emptyRelationProperties, "reopenEvidenceRefs"), false);
  assert.deepEqual(emptyIndustryProperties.decisionChange, { enum: ["new"] });
  assert.deepEqual(emptyRelationProperties.decisionChange, { enum: ["new"] });

  const populatedInput: ThemeFrameworkInput = {
    ...input,
    existingKnowledge: { ...input.existingKnowledge, industries: [{ ref: "entity:industry-existing", name: "Existing Industry" }] },
  };
  assert.equal((await executeThemeFramework(populatedInput, executor)).status, "complete");
  const populatedContract = requests[1]?.outputContract as { properties: { industryCandidates: { items: { properties: Record<string, unknown> } } } };
  assert.deepEqual(populatedContract.properties.industryCandidates.items.properties.existingIndustryRef, { enum: ["entity:industry-existing"] });

  const priorInput: ThemeFrameworkInput = {
    ...populatedInput,
    priorDecisions: [{ decisionId: "prior-unmatched", semanticFingerprint: fingerprintThemeIndustry("Unmatched industry"), candidateType: "industry", recommendation: "exclude", rationale: "Earlier bounded scope decision.", evidenceRefs: ["e-compute"] }],
  };
  assert.equal((await executeThemeFramework(priorInput, executor)).status, "complete");
  const priorContract = requests[2]?.outputContract as { properties: { industryCandidates: { items: { properties: Record<string, unknown> } }; relationCandidates: { items: { properties: Record<string, unknown> } } } };
  assert.deepEqual(priorContract.properties.industryCandidates.items.properties.decisionChange, { enum: ["new", "unchanged", "reopen"] });
  assert.deepEqual(priorContract.properties.industryCandidates.items.properties.priorDecisionId, { type: "string", pattern: "^[A-Za-z][A-Za-z0-9._-]{0,79}$" });
  assert.deepEqual(priorContract.properties.relationCandidates.items.properties.priorDecisionId, { type: "string", pattern: "^[A-Za-z][A-Za-z0-9._-]{0,79}$" });
});

test("first semantic instruction surveys chain breadth without forcing unsupported links", async () => {
  let instruction = "";
  const executor: ReasoningExecutor = {
    capabilities: () => ({ maxContextTokens: 4000, maxOutputTokens: 2000, structuredOutputSupport: true, maxConcurrency: 1 }),
    execute: async (request) => { instruction = request.instruction; return { operation: request.operation, output: output() }; },
  };

  assert.equal((await executeThemeFramework(input, executor)).status, "complete");
  assert.match(instruction, /upstream and downstream activities/u);
  assert.match(instruction, /cross-chain connections/u);
  assert.match(instruction, /independently researchable infrastructure or service activities/u);
  assert.match(instruction, /adjacent branches that may warrant exclusion/u);
  assert.match(instruction, /include a Relation only when supplied evidence supports the relationship and its direction/u);
  assert.match(instruction, /pending with empty evidenceRefs and a specific coverageGaps entry/u);
  assert.match(instruction, /Include and exclude recommendations must be supported by supplied evidence/u);
  assert.doesNotMatch(instruction, /AI Compute|consumer electronics|data center|semiconductor/u);
});

test("semantic executor diagnostics expose only the safe error code", async () => {
  const result = await executeThemeFramework(input, {
    capabilities: () => ({ maxContextTokens: 4000, maxOutputTokens: 2000, structuredOutputSupport: true, maxConcurrency: 1 }),
    execute: async () => { throw new ReasoningExecutorError("reasoning_configuration_invalid", "private source text must not appear"); },
  });
  assert.equal(result.status, "blocked");
  assert.deepEqual(result.diagnostics, ["executor_reasoning_configuration_invalid"]);
  assert.equal(JSON.stringify(result).includes("private source text"), false);
});

test("semantic output parsing repairs once then fails closed for malformed or unsupported model output", async () => {
  const requests: ReasoningRequest[] = [];
  const outputs: unknown[] = [
    { ...output(), unsupportedExtra: "must reject" },
    { ...output(), relationCandidates: [edge("forged", "pcb", "industry:forged", ["e-pcb"])] },
  ];
  const executor: ReasoningExecutor = {
    capabilities: () => ({ maxContextTokens: 4000, maxOutputTokens: 2000, structuredOutputSupport: true, maxConcurrency: 1 }),
    execute: async (request): Promise<ReasoningResult> => {
      requests.push(request);
      return { operation: request.operation, output: outputs.shift() };
    },
  };
  const result = await executeThemeFramework(input, executor);
  assert.equal(result.status, "blocked");
  assert.equal(result.telemetry.repairAttempts, 1);
  assert.equal(requests.length, 2);
  assert.match(requests[1]?.instruction ?? "", /Fix malformed or unsupported output/);
  assert.ok(result.diagnostics.includes("relation_endpoint_unknown"));

  const malformedJson = await executeThemeFramework(input, {
    capabilities: () => ({ maxContextTokens: 4000, maxOutputTokens: 2000, structuredOutputSupport: true, maxConcurrency: 1 }),
    execute: async (request) => ({ operation: request.operation, output: "{ this is not JSON" }),
  });
  assert.equal(malformedJson.status, "blocked");
  assert.ok(malformedJson.diagnostics.includes("output_json_invalid"));
});

test("semantic input is bounded and missing executor blocks without fallback", async () => {
  const blocked = await executeThemeFramework(input);
  assert.equal(blocked.status, "blocked");
  assert.deepEqual(blocked.diagnostics, ["reasoning_executor_missing"]);

  const oversized = { ...input, existingKnowledge: { ...input.existingKnowledge, summary: "x".repeat(9000) } };
  const invalid = await executeThemeFramework(oversized);
  assert.equal(invalid.status, "blocked");
  assert.deepEqual(invalid.diagnostics, ["input_existing_knowledge_invalid"]);
});

test("empty Knowledge yields provisional scope and an explicit research gap", () => {
  const emptyInput: ThemeFrameworkInput = {
    ...input,
    existingKnowledge: { summary: "", industries: [] },
    evidence: [],
  };
  const result = validateThemeFrameworkResult({
    proposedDefinition: { statement: "Provisional scope for AI compute enabling activities.", status: "provisional", evidenceRefs: [] },
    inclusionPrinciples: [],
    exclusionPrinciples: [],
    industryCandidates: [],
    relationCandidates: [],
    coverageGaps: [{ gapId: "gap-first-research", question: "Which activities materially enable AI compute?", reason: "No Knowledge or external evidence was supplied.", affectedCandidateIds: [] }],
  }, emptyInput);
  assert.equal(result.proposedDefinition.status, "provisional");
  assert.equal(result.industryCandidates.length, 0);
  assert.equal(result.coverageGaps.length, 1);
});

test("semantic fingerprints are stable for equivalent labels and ordered directed edges", () => {
  assert.equal(fingerprintThemeIndustry("  AI   Compute "), fingerprintThemeIndustry("ai compute"));
  const source = fingerprintThemeIndustry("Copper foil");
  const target = fingerprintThemeIndustry("PCB");
  assert.notEqual(fingerprintThemeRelation("upstream_of", source, target), fingerprintThemeRelation("upstream_of", target, source));
});
