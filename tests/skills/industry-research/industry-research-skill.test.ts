import assert from "node:assert/strict";
import test from "node:test";
import {
  IndustryResearchSkill,
  INDUSTRY_MODULES,
  observationBackedProposalIsDeterministic,
  validateIndustryModuleResult,
  validateIndustryResearchDesign,
  validateCrossModuleSynthesis,
} from "../../../skills/industry-research/index.ts";
import type { ReasoningExecutor } from "../../../plugins/reasoning/contracts.ts";
import {
  INDUSTRY_RESEARCH_DESIGN_CONTRACT,
  INDUSTRY_MODULE_RESULT_CONTRACT,
  INDUSTRY_SYNTHESIS_CONTRACT,
  createIndustryModuleResultContract,
  createIndustrySynthesisContract,
  INDUSTRY_LOCAL_ID_PATTERN,
  INDUSTRY_LOCAL_ID_MAX_LENGTH,
  isValidIndustryLocalId,
} from "../../../skills/industry-research/contracts.ts";
import { createIndustryOperatingObservation } from "../../../plugins/research-acquisition/industry-operating-observations.ts";
const design = {
  definitionHypothesis: "A bounded manufacturing industry.",
  targetKind: "industry",
  scope: { included: ["manufacturing"], excluded: ["broad theme"] },
  moduleQuestions: Object.fromEntries(
    INDUSTRY_MODULES.map((m) => [m, `Question for ${m}`]),
  ),
  keyMetrics: ["capacity"],
  evidenceRequirements: ["official"],
  searchTerms: ["fixture industry"],
  knownGaps: [],
  verificationCandidates: [],
};
const source = {
  candidate: {
    candidateId: "s1",
    kind: "official_disclosure" as const,
    tier: 1 as const,
    title: "Official",
    provider: "fixture",
    publishedAt: "2026-09-01",
  },
  retrievedAt: "2026-09-01",
  title: "Official",
  content: "The industry supplies products.",
  contentHash: "a".repeat(64),
  publisher: "Fixture",
  rights: {
    accessScope: "public" as const,
    retentionAllowed: true,
    aiProcessingAllowed: true,
    derivativeKnowledgeAllowed: true,
    redistributionAllowed: false,
  },
};
function executor(output: unknown): ReasoningExecutor {
  return {
    capabilities: () => ({
      maxContextTokens: 1000,
      maxOutputTokens: 1000,
      structuredOutputSupport: true,
      maxConcurrency: 2,
    }),
    execute: async (r) => ({ operation: r.operation, output }),
  };
}
function moduleOutput(module: (typeof INDUSTRY_MODULES)[number]) {
  return {
    module,
    status: "supported",
    analysis: "Bounded analysis.",
    evidenceIds: ["e1"],
    proposals: [],
    gaps: [],
    reportMaterial: {
      markdown: "Evidence-backed.",
      evidenceIds: ["e1"],
      proposalIds: [],
    },
    ...(module === "competitive_landscape" ? {
      competitionTable: {
        columns: [
          { id: "company", label: "公司", role: "company" },
          { id: "products", label: "主要产品", role: "main_products" },
          { id: "market_cap", label: "市值", role: "market_cap" },
          { id: "revenue", label: "年营收", role: "annual_revenue" },
        ],
        rows: [],
      },
    } : {}),
  };
}

function comparatorObservation(qualifier: "EXACT" | "LOWER_BOUND" | "UPPER_BOUND", value: number) {
  return createIndustryOperatingObservation({
    metricKey: "lithium_battery.total_output",
    observationClass: "PRODUCTION",
    value,
    qualifier,
    unit: "GWh",
    originalValue: String(value),
    originalUnit: "GWh",
    periodStart: "2024-01-01T00:00:00.000Z",
    periodEnd: "2024-12-31T23:59:59.999Z",
    frequency: "ANNUAL",
    aggregation: "PERIOD",
    geography: "China national",
    productOrSegment: "锂离子电池",
    publishedAt: "2025-02-27T15:06:00.000Z",
    retrievedAt: "2026-09-23T00:00:00.000Z",
    originPublisher: "MIIT",
    hostPlatform: "MIIT official web",
    retrievalProvider: "ResearchHub direct HTTPS",
    sourceAuthority: "S1_OFFICIAL",
    determinismClass: "EVIDENCE_BACKED_NUMERIC",
    sourceCandidateId: "s1",
    publicationPit: "VERIFIED",
    valueVersionPit: "UNVERIFIED",
    metadata: { period: "2024" },
  });
}

function comparatorProposal(observation: ReturnType<typeof comparatorObservation>, comparator: string) {
  return {
    proposalId: "observation-proposal",
    kind: "claim" as const,
    subjectKey: "local",
    claimType: "fact" as const,
    statement: "The observation is true.",
    sourceCandidateIds: [`evidence-${observation.sourceCandidateId}`],
    structuredValue: {
      metric: observation.metricKey,
      value: observation.value,
      unit: observation.unit,
      comparator,
      period: "2024",
      semanticKey: `observation:${observation.observationId}`,
    },
  };
}

test("Observation-backed structured claims require the exact Schema comparator for each qualifier", () => {
  const exact = comparatorObservation("EXACT", 1170);
  const lower = comparatorObservation("LOWER_BOUND", 1240);
  const upper = comparatorObservation("UPPER_BOUND", 1300);
  assert.equal(observationBackedProposalIsDeterministic(comparatorProposal(exact, "eq"), [exact]), true);
  for (const comparator of ["gte", "gt", "lte", "lt", "approx"]) assert.equal(observationBackedProposalIsDeterministic(comparatorProposal(exact, comparator), [exact]), false);
  assert.equal(observationBackedProposalIsDeterministic(comparatorProposal(lower, "gte"), [lower]), true);
  for (const comparator of ["eq", "gt", "lte", "lt", "approx"]) assert.equal(observationBackedProposalIsDeterministic(comparatorProposal(lower, comparator), [lower]), false);
  assert.equal(observationBackedProposalIsDeterministic(comparatorProposal(upper, "lte"), [upper]), true);
  for (const comparator of ["eq", "gt", "gte", "lt", "approx"]) assert.equal(observationBackedProposalIsDeterministic(comparatorProposal(upper, comparator), [upper]), false);
});

test("Industry module rejects an observation-backed comparator mismatch without repair", async () => {
  const observation = comparatorObservation("LOWER_BOUND", 1240);
  const proposal = comparatorProposal(observation, "eq");
  const candidate = {
    ...moduleOutput("supply_demand_analysis"),
    evidenceIds: ["evidence-s1"],
    proposals: [proposal],
    reportMaterial: { markdown: "Observation-backed.", evidenceIds: ["evidence-s1"], proposalIds: [proposal.proposalId] },
  };
  assert.doesNotThrow(() => validateIndustryModuleResult(candidate, "supply_demand_analysis", ["evidence-s1"]));
  let calls = 0;
  const skill = new IndustryResearchSkill({
    ...executor(null),
    execute: async (request) => {
      calls++;
      return {
        operation: request.operation,
        output: {
          ...candidate,
        },
      };
    },
  });
  const result = await skill.analyze("supply_demand_analysis", {
    target: { name: "Fixture" },
    evidence: [{ evidenceId: "evidence-s1", source }],
    operatingObservations: [observation],
    existingKnowledge: [],
    localReferences: [],
  });
  assert.equal(result.proposals.length, 0);
  assert.equal(calls, 1);
});

test("competitive landscape binds a compact dynamic table to local evidence-backed proposals", () => {
  const columns = [
    { id: "company", label: "公司", role: "company" },
    { id: "products", label: "主要产品", role: "main_products" },
    { id: "market_cap", label: "最新市值", role: "market_cap" },
    { id: "annual_revenue", label: "最新年报营收", role: "annual_revenue" },
    { id: "barrier", label: "竞争壁垒", role: "custom", customRole: "barrier" },
  ] as const;
  const proposals = [
    { proposalId: "company-a", kind: "entity", subjectKey: "company-a", entityType: "company", entityName: "Fixture Corp", sourceCandidateIds: ["e1"], structuredValue: { ticker: "000001", exchange: "SZSE" } },
    { proposalId: "exposure-a", kind: "relation", subjectKey: "company-a", targetKey: "industry", relationType: "business_exposure", sourceCandidateIds: ["e1"] },
    { proposalId: "product-claim", kind: "claim", subjectKey: "company-a", claimType: "fact", statement: "Makes core products", sourceCandidateIds: ["e1"] },
    { proposalId: "market-cap-claim", kind: "claim", subjectKey: "company-a", claimType: "fact", statement: "Market capitalization on the stated date", sourceCandidateIds: ["e1"], temporal: { asOf: "2026-09-30" }, structuredValue: { metric: "metric:market_cap", value: 100, unit: "CNY", comparator: "eq", period: "2026-09-30" } },
    { proposalId: "annual-revenue-claim", kind: "claim", subjectKey: "company-a", claimType: "fact", statement: "Latest annual report revenue", sourceCandidateIds: ["e1"], structuredValue: { metric: "metric:revenue", value: 20, unit: "CNY", comparator: "eq", fiscalPeriod: "FY2025" } },
  ];
  const candidate = {
    ...moduleOutput("competitive_landscape"),
    evidenceIds: ["e1"],
    proposals,
    reportMaterial: { markdown: "Competition overview.", evidenceIds: ["e1"], proposalIds: proposals.map((item) => item.proposalId), relationProposalIds: ["exposure-a"] },
    competitionTable: {
      columns,
      rows: [{ companyKey: "company-a", businessExposureProposalId: "exposure-a", cells: [
        { columnId: "products", status: "available", displayValue: "Core products", knowledgeProposalIds: ["product-claim"] },
        { columnId: "market_cap", status: "available", displayValue: "100", knowledgeProposalIds: ["market-cap-claim"], asOf: "2026-09-30", unit: "CNY", currency: "CNY" },
        { columnId: "annual_revenue", status: "available", displayValue: "20", knowledgeProposalIds: ["annual-revenue-claim"], fiscalYear: 2025, unit: "CNY", currency: "CNY" },
        { columnId: "barrier", status: "not_comparable", reason: "Source material does not support a comparable barrier assessment." },
      ] }],
    },
  };
  const parsed = validateIndustryModuleResult(candidate, "competitive_landscape", ["e1"]);
  assert.equal(parsed.competitionTable?.columns.length, 5);
  assert.equal(parsed.competitionTable?.rows.length, 1);
  assert.equal(parsed.competitionTable?.rows[0]?.cells.barrier?.status, "not_comparable");
  assert.throws(() => validateIndustryModuleResult({ ...candidate, competitionTable: { ...candidate.competitionTable, rows: [{ ...candidate.competitionTable.rows[0], cells: candidate.competitionTable.rows[0].cells.map((cell) => cell.columnId === "market_cap" ? { ...cell, knowledgeProposalIds: ["missing"] } : cell) }] } }, "competitive_landscape", ["e1"]), /available competition cell/i);
  assert.throws(() => validateIndustryModuleResult({ ...moduleOutput("competitive_landscape"), competitionTable: { ...moduleOutput("competitive_landscape").competitionTable, columns: columns.slice(0, 3) } }, "competitive_landscape", ["e1"]), /table bounds/i);
});

test("Industry Skill emits structured operation contracts and operation-specific bounded instructions", async () => {
  const requests: any[] = [];
  const fake: ReasoningExecutor = {
    capabilities: () => ({
      maxContextTokens: 1000,
      maxOutputTokens: 1000,
      structuredOutputSupport: true,
      maxConcurrency: 1,
    }),
    execute: async (r) => {
      requests.push(r);
      return {
        operation: r.operation,
        output:
          r.operation === "industry_research_design"
            ? design
            : r.operation === "industry_module_analysis"
              ? {
                  ...moduleOutput("risk_analysis"),
                  evidenceIds: [],
                  reportMaterial: {
                    markdown: "x",
                    evidenceIds: [],
                    proposalIds: [],
                  },
                }
              : {
                  executiveView: "view",
                  analysis: "analysis",
                  evidenceIds: [],
                  proposals: [],
                  gaps: [],
                  alternativeViews: [],
                  reportMaterial: {
                    markdown: "x",
                    evidenceIds: [],
                    proposalIds: [],
                  },
                },
      };
    },
  };
  const skill = new IndustryResearchSkill(fake);
  await skill.design({ target: { name: "x" }, existingKnowledge: [] });
  await skill.analyze("risk_analysis", {
    target: { name: "x" },
    evidence: [],
    existingKnowledge: [],
    localReferences: [],
  });
  await skill.synthesize({ modules: [], evidence: [] });
  assert.equal(typeof requests[0].outputContract, "object");
  assert.deepEqual(
    requests.map((r) => r.outputContract.name),
    ["IndustryResearchDesign", "IndustryModuleResult", "CrossModuleSynthesis"],
  );
  assert.match(requests[0].instruction, /ontology/i);
  assert.match(requests[1].instruction, /allowlist/i);
  assert.match(requests[2].instruction, /validated modules/i);
  assert.equal(INDUSTRY_RESEARCH_DESIGN_CONTRACT.type, "object");
  assert.equal(INDUSTRY_MODULE_RESULT_CONTRACT.type, "object");
  assert.equal(INDUSTRY_SYNTHESIS_CONTRACT.type, "object");
});
test("Industry Skill repair carries bounded prior candidate and diagnostics, and parses benign JSON wrappers", async () => {
  const requests: any[] = [];
  let n = 0;
  const fake: ReasoningExecutor = {
    capabilities: () => ({
      maxContextTokens: 1000,
      maxOutputTokens: 1000,
      structuredOutputSupport: true,
      maxConcurrency: 1,
    }),
    execute: async (r) => {
      requests.push(r);
      n++;
      return {
        operation: r.operation,
        output:
          n === 1
            ? { output: { invalid: true } }
            : JSON.stringify({ result: design }),
      };
    },
  };
  const result = await new IndustryResearchSkill(fake).design({
    target: { name: "x" },
    existingKnowledge: [],
  });
  assert.equal(result.targetKind, "industry");
  assert.equal(requests.length, 2);
  assert.match(requests[1].instruction, /Prior:/);
  assert.match(requests[1].instruction, /Diagnostics:/);
  assert.doesNotMatch(requests[1].instruction, /"invalid"\s*:\s*true/);
});
test("Industry Skill exposes exact operations and all eight modules", async () => {
  const skill = new IndustryResearchSkill(executor(design));
  assert.equal(
    (await skill.design({ target: { name: "Fixture" }, existingKnowledge: [] }))
      .targetKind,
    "industry",
  );
  for (const module of INDUSTRY_MODULES)
    assert.equal(
      (
        await new IndustryResearchSkill(executor(moduleOutput(module))).analyze(
          module,
          {
            target: { name: "Fixture" },
            evidence: [{ evidenceId: "e1", source }],
            existingKnowledge: [],
            localReferences: [],
          },
        )
      ).module,
      module,
    );
});
test("Industry Skill keeps bounded module-relevant context from long evidence bodies", async () => {
  const requests: any[] = [];
  const longSource = {
    ...source,
    content: `${"front matter ".repeat(120)} capacity utilization is 72 percent and demand remains firm. ${"unrelated body ".repeat(260)} conclusion`,
  };
  const fake: ReasoningExecutor = {
    capabilities: () => ({
      maxContextTokens: 1000,
      maxOutputTokens: 1000,
      structuredOutputSupport: true,
      maxConcurrency: 1,
    }),
    execute: async (r) => {
      requests.push(r);
      return { operation: r.operation, output: moduleOutput("supply_demand_analysis") };
    },
  };
  await new IndustryResearchSkill(fake).analyze("supply_demand_analysis", {
    target: { name: "Fixture" },
    evidence: [{ evidenceId: "e1", source: longSource }],
    existingKnowledge: [],
    localReferences: [],
  });
  const excerpt = requests[0].input.evidence[0].excerpt;
  assert.ok(excerpt.length <= 2400);
  assert.match(excerpt, /capacity utilization is 72 percent/);
});
test("Industry Skill rejects canonical IDs, unknown evidence, and bounded evidence escape", () => {
  assert.throws(
    () =>
      validateIndustryModuleResult(
        { ...moduleOutput("market_size_growth"), evidenceIds: ["unknown"] },
        "market_size_growth",
        ["e1"],
      ),
    /evidence/,
  );
  assert.throws(
    () =>
      validateIndustryModuleResult(
        {
          ...moduleOutput("market_size_growth"),
          proposals: [
            {
              proposalId: "p",
              kind: "claim",
              subjectKey: "entity:bad",
              claimType: "fact",
              statement: "bad",
              sourceCandidateIds: ["e1"],
            },
          ],
        },
        "market_size_growth",
        ["e1"],
      ),
    /canonical/,
  );
});
test("Industry Skill performs at most one repair attempt and marks repeated invalid output unavailable", async () => {
  let calls = 0;
  const bad: ReasoningExecutor = {
    capabilities: () => ({
      maxContextTokens: 1,
      maxOutputTokens: 1,
      structuredOutputSupport: true,
      maxConcurrency: 1,
    }),
    execute: async (r) => {
      calls++;
      return { operation: r.operation, output: { invalid: true } };
    },
  };
  const result = await new IndustryResearchSkill(bad).analyze("risk_analysis", {
    target: { name: "Fixture" },
    evidence: [],
    existingKnowledge: [],
    localReferences: [],
  });
  assert.equal(calls, 2);
  assert.equal(result.status, "unavailable");
});
test("Industry Skill validates design gaps, candidates, string arrays and quantitative values", () => {
  assert.throws(
    () =>
      validateIndustryResearchDesign({
        ...design,
        knownGaps: [
          {
            gapId: "entity:bad",
            module: "market_size_growth",
            question: "q",
            reason: "r",
            actionable: true,
          },
        ],
      }),
    /known gap/,
  );
  assert.throws(
    () =>
      validateIndustryResearchDesign({
        ...design,
        verificationCandidates: [{ name: "x", kind: "person", reason: "r" }],
      }),
    /candidate/,
  );
  assert.throws(
    () =>
      validateIndustryModuleResult(
        {
          ...moduleOutput("market_size_growth"),
          proposals: [
            {
              proposalId: "p",
              kind: "claim",
              subjectKey: "local",
              claimType: "fact",
              statement: "q",
              sourceCandidateIds: ["e1"],
              structuredValue: {
                metric: "m",
                value: NaN,
                unit: "u",
                comparator: "eq",
                period: "2026",
              },
            },
          ],
        },
        "market_size_growth",
        ["e1"],
      ),
    /quantitative/,
  );
  assert.throws(
    () =>
      validateIndustryModuleResult(
        {
          ...moduleOutput("market_size_growth"),
          proposals: [
            {
              proposalId: "p",
              kind: "claim",
              subjectKey: "local",
              claimType: "unknown",
              statement: "q",
              sourceCandidateIds: ["e1"],
            },
          ],
        },
        "market_size_growth",
        ["e1"],
      ),
    /Claim/,
  );
});
test("Industry Skill rejects producer-owned canonical bindings and malformed local report material", () => {
  assert.throws(
    () =>
      validateIndustryModuleResult(
        {
          ...moduleOutput("market_size_growth"),
          proposals: [
            {
              proposalId: "p",
              kind: "claim",
              subjectKey: "local",
              claimType: "fact",
              statement: "q",
              sourceCandidateIds: ["e1"],
              existingKnowledgeRefs: ["claim:canonical"],
            },
          ],
        },
        "market_size_growth",
        ["e1"],
      ),
    /canonical resolution/,
  );
  assert.throws(
    () =>
      validateIndustryModuleResult(
        {
          ...moduleOutput("market_size_growth"),
          reportMaterial: {
            markdown: "x",
            evidenceIds: ["e1"],
            proposalIds: [],
            relationProposalIds: ["p"],
          },
        },
        "market_size_growth",
        ["e1"],
      ),
    /local report material/,
  );
  assert.throws(
    () =>
      validateIndustryModuleResult(
        {
          ...moduleOutput("market_size_growth"),
          gaps: [
            {
              gapId: "g",
              module: "market_size_growth",
              question: "q",
              reason: "r",
              actionable: true,
              searchTerms: ["x", "x"],
            },
          ],
        },
        "market_size_growth",
        ["e1"],
      ),
    /Research Gap/,
  );
});
test("CrossModuleSynthesis validates module Relation report references separately from proposal IDs", () => {
  const relation = {
    proposalId: "rel",
    kind: "relation",
    subjectKey: "company",
    targetKey: "product",
    relationType: "offers_product",
    sourceCandidateIds: ["e1"],
  };
  const base = {
    executiveView: "view",
    analysis: "analysis",
    evidenceIds: ["e1"],
    proposals: [],
    gaps: [],
    alternativeViews: [],
  };
  assert.doesNotThrow(() =>
    validateCrossModuleSynthesis(
      {
        ...base,
        reportMaterial: {
          markdown: "relation-backed",
          evidenceIds: ["e1"],
          proposalIds: ["rel"],
          relationProposalIds: ["rel"],
        },
      },
      ["e1"],
      ["rel"],
      ["rel"],
    ),
  );
  assert.throws(
    () =>
      validateCrossModuleSynthesis(
        {
          ...base,
          proposals: [relation],
          reportMaterial: {
            markdown: "bad",
            evidenceIds: ["e1"],
            proposalIds: ["rel"],
            relationProposalIds: ["company"],
          },
        },
        ["e1"],
        [],
        ["rel"],
      ),
    /local report material/,
  );
});

test("Industry Skill target diagnosis accepts exactly the five contract kinds and rejects others", () => {
  for (const targetKind of [
    "industry",
    "theme",
    "product",
    "technology",
    "uncertain",
  ] as const)
    assert.equal(
      validateIndustryResearchDesign({ ...design, targetKind }).targetKind,
      targetKind,
    );
  assert.throws(
    () => validateIndustryResearchDesign({ ...design, targetKind: "company" }),
    /target diagnosis/,
  );
});

test("Industry Skill rejects duplicate or malformed ResearchDesign arrays and gap IDs", () => {
  for (const key of [
    "keyMetrics",
    "evidenceRequirements",
    "searchTerms",
  ] as const) {
    assert.throws(
      () => validateIndustryResearchDesign({ ...design, [key]: ["x", "x"] }),
      /non-empty string array/,
    );
    assert.throws(
      () => validateIndustryResearchDesign({ ...design, [key]: [""] }),
      /non-empty string array/,
    );
  }
  const gap = {
    gapId: "gap",
    module: "market_size_growth",
    question: "q",
    reason: "r",
    actionable: true,
  };
  assert.throws(
    () => validateIndustryResearchDesign({ ...design, knownGaps: [gap, gap] }),
    /known gap/,
  );
  assert.throws(
    () =>
      validateIndustryResearchDesign({
        ...design,
        knownGaps: [{ ...gap, searchTerms: ["x", "x"] }],
      }),
    /known gap/,
  );
});

test("Industry local ID authority accepts valid IDs and rejects non-local gap IDs", () => {
  for (const id of ["missing_market_size", "gap-capacity-2026", "company.mapping"])
    assert.equal(isValidIndustryLocalId(id), true);
  for (const id of ["has space", "entity:canonical", "1-leading-digit", "slash/id", "缺口"])
    assert.equal(isValidIndustryLocalId(id), false);
  assert.equal(isValidIndustryLocalId("a".repeat(INDUSTRY_LOCAL_ID_MAX_LENGTH)), true);
  assert.equal(isValidIndustryLocalId("a".repeat(INDUSTRY_LOCAL_ID_MAX_LENGTH + 1)), false);
  for (const value of [
    INDUSTRY_RESEARCH_DESIGN_CONTRACT.properties.knownGaps.items,
    INDUSTRY_MODULE_RESULT_CONTRACT.properties.gaps.items,
    INDUSTRY_SYNTHESIS_CONTRACT.properties.gaps.items,
  ]) {
    assert.equal(value.properties.gapId.pattern, INDUSTRY_LOCAL_ID_PATTERN);
    assert.equal(value.properties.gapId.maxLength, INDUSTRY_LOCAL_ID_MAX_LENGTH);
  }
});

test("Industry Skill rejects invalid verification kind, canonical IDs, resolution fields, links, and quantitative values", () => {
  assert.throws(
    () =>
      validateIndustryResearchDesign({
        ...design,
        verificationCandidates: [{ name: "x", kind: "person", reason: "r" }],
      }),
    /candidate/,
  );
  const base = {
    proposalId: "p",
    kind: "claim",
    subjectKey: "local",
    claimType: "fact",
    statement: "q",
    sourceCandidateIds: ["e1"],
  };
  assert.throws(
    () =>
      validateIndustryModuleResult(
        {
          ...moduleOutput("market_size_growth"),
          proposals: [{ ...base, proposalId: "entity:bad" }],
        },
        "market_size_growth",
        ["e1"],
      ),
    /canonical/,
  );
  assert.throws(
    () =>
      validateIndustryModuleResult(
        {
          ...moduleOutput("market_size_growth"),
          proposals: [{ ...base, existingKnowledgeRefs: ["x"] }],
        },
        "market_size_growth",
        ["e1"],
      ),
    /canonical resolution/,
  );
  assert.throws(
    () =>
      validateIndustryModuleResult(
        {
          ...moduleOutput("market_size_growth"),
          proposals: [{ ...base, supportsProposalIds: ["missing"] }],
        },
        "market_size_growth",
        ["e1"],
      ),
    /unresolved/,
  );
  assert.throws(
    () =>
      validateIndustryModuleResult(
        {
          ...moduleOutput("market_size_growth"),
          proposals: [
            {
              ...base,
              structuredValue: {
                metric: "m",
                value: NaN,
                unit: "u",
                comparator: "eq",
                period: "2026",
              },
            },
          ],
        },
        "market_size_growth",
        ["e1"],
      ),
    /quantitative/,
  );
});

test("Industry Skill validates module and synthesis report material, references, gaps, and relation-only IDs", () => {
  const badMaterial = {
    ...moduleOutput("market_size_growth"),
    reportMaterial: {
      markdown: "x",
      evidenceIds: ["e1"],
      proposalIds: ["missing"],
    },
  };
  assert.throws(
    () =>
      validateIndustryModuleResult(badMaterial, "market_size_growth", ["e1"]),
    /local report material/,
  );
  assert.throws(
    () =>
      validateIndustryModuleResult(
        {
          ...moduleOutput("market_size_growth"),
          gaps: [
            {
              gapId: "g",
              module: "risk_analysis",
              question: "q",
              reason: "r",
              actionable: true,
            },
          ],
        },
        "market_size_growth",
        ["e1"],
      ),
    /Research Gap/,
  );
  const base = {
    executiveView: "view",
    analysis: "analysis",
    evidenceIds: ["e1"],
    proposals: [],
    gaps: [],
    alternativeViews: [],
  };
  assert.throws(
    () =>
      validateCrossModuleSynthesis(
        {
          ...base,
          reportMaterial: {
            markdown: "x",
            evidenceIds: ["e1"],
            proposalIds: ["missing"],
          },
        },
        ["e1"],
        [],
        [],
      ),
    /local report material/,
  );
  const relation = {
    proposalId: "rel",
    kind: "relation",
    subjectKey: "company",
    targetKey: "product",
    relationType: "offers_product",
    sourceCandidateIds: ["e1"],
  };
  assert.doesNotThrow(() =>
    validateCrossModuleSynthesis(
      {
        ...base,
        proposals: [relation],
        reportMaterial: {
          markdown: "x",
          evidenceIds: ["e1"],
          proposalIds: [],
          relationProposalIds: ["rel"],
        },
      },
      ["e1"],
      [],
      ["rel"],
    ),
  );
});

test("Industry contracts expose complete design item schemas and accept empty scope arrays", () => {
  assert.deepEqual(
    INDUSTRY_RESEARCH_DESIGN_CONTRACT.properties.scope.properties.included
      .minItems,
    0,
  );
  assert.equal(
    INDUSTRY_RESEARCH_DESIGN_CONTRACT.properties.moduleQuestions.properties
      .industry_definition.type,
    "string",
  );
  assert.equal(
    INDUSTRY_RESEARCH_DESIGN_CONTRACT.properties.verificationCandidates.items
      .additionalProperties,
    false,
  );
  assert.doesNotThrow(() =>
    validateIndustryResearchDesign({
      ...design,
      scope: { included: [], excluded: [] },
    }),
  );
});

test("Industry module and synthesis contracts bind exact modules and allowlists", () => {
  const moduleContract = createIndustryModuleResultContract(
    "risk_analysis",
    ["e1"],
    ["existing"],
  );
  assert.deepEqual(moduleContract.properties.module.const, "risk_analysis");
  assert.deepEqual(moduleContract.allowlists.evidenceIds, ["e1"]);
  assert.throws(
    () =>
      validateIndustryModuleResult(
        { ...moduleOutput("market_size_growth") },
        "risk_analysis",
        ["e1"],
      ),
    /module/,
  );
  assert.throws(
    () =>
      validateIndustryModuleResult(
        { ...moduleOutput("risk_analysis"), evidenceIds: ["unknown"] },
        "risk_analysis",
        ["e1"],
      ),
    /evidence/,
  );
  const synthesis = createIndustrySynthesisContract(["e1"], ["p1"], ["r1"]);
  assert.deepEqual(synthesis.allowlists.existingRelationProposalIds, ["r1"]);
  assert.equal(
    synthesis.properties.reportMaterial.properties.proposalIds.items.pattern,
    "^[A-Za-z][A-Za-z0-9._-]*$",
  );
  assert.equal(
    synthesis.properties.reportMaterial.properties.relationProposalIds.items
      .pattern,
    "^[A-Za-z][A-Za-z0-9._-]*$",
  );
});

test("CrossModuleSynthesis admits same-response proposals and enforces final reference membership", () => {
  const base = {
    executiveView: "view",
    analysis: "analysis",
    evidenceIds: ["e1"],
    gaps: [],
    alternativeViews: [],
  };
  const claim = {
    proposalId: "new-claim",
    kind: "claim",
    subjectKey: "company",
    claimType: "fact",
    statement: "The company supplies the product.",
    sourceCandidateIds: ["e1"],
  };
  const relation = {
    proposalId: "new-relation",
    kind: "relation",
    subjectKey: "company",
    targetKey: "product",
    relationType: "offers_product",
    sourceCandidateIds: ["e1"],
  };
  assert.doesNotThrow(() =>
    validateCrossModuleSynthesis(
      {
        ...base,
        proposals: [claim, relation],
        reportMaterial: {
          markdown: "new proposals",
          evidenceIds: ["e1"],
          proposalIds: ["new-claim", "new-relation", "module-claim"],
          relationProposalIds: ["new-relation", "module-relation"],
        },
      },
      ["e1"],
      ["module-claim", "module-relation"],
      ["module-relation"],
    ),
  );
  for (const [key, value] of [
    ["proposalIds", ["unknown"]],
    ["relationProposalIds", ["unknown"]],
    ["relationProposalIds", ["module-claim"]],
  ] as const) {
    assert.throws(
      () =>
        validateCrossModuleSynthesis(
          {
            ...base,
            proposals: [],
            reportMaterial: {
              markdown: "bad reference",
              evidenceIds: ["e1"],
              proposalIds: key === "proposalIds" ? value : [],
              relationProposalIds:
                key === "relationProposalIds" ? value : [],
            },
          },
          ["e1"],
          ["module-claim"],
          ["module-relation"],
        ),
      /local report material/,
    );
  }
  assert.throws(
    () =>
      validateCrossModuleSynthesis(
        { ...base, proposals: [{ ...claim, proposalId: "module-claim" }], reportMaterial: { markdown: "collision", evidenceIds: ["e1"], proposalIds: [], relationProposalIds: [] } },
        ["e1"],
        ["module-claim"],
        [],
      ),
    (error: unknown) =>
      error instanceof Error &&
      (error as { code?: string }).code === "synthesis_proposal_collision",
  );
});

test("Industry synthesis repairs once and returns the valid repaired result", async () => {
  let calls = 0;
  const claim = {
    proposalId: "repaired-claim",
    kind: "claim",
    subjectKey: "company",
    claimType: "fact",
    statement: "A bounded repaired claim.",
    sourceCandidateIds: ["e1"],
  };
  const fake: ReasoningExecutor = {
    capabilities: () => ({ maxContextTokens: 1000, maxOutputTokens: 1000, structuredOutputSupport: true, maxConcurrency: 1 }),
    execute: async (r) => {
      calls++;
      return {
        operation: r.operation,
        output: calls === 1
          ? { executiveView: "bad", analysis: "bad", evidenceIds: ["e1"], proposals: [], gaps: [], alternativeViews: [], reportMaterial: { markdown: "bad", evidenceIds: ["e1"], proposalIds: ["unknown"] } }
          : { executiveView: "good", analysis: "good", evidenceIds: ["e1"], proposals: [claim], gaps: [], alternativeViews: [], reportMaterial: { markdown: "good", evidenceIds: ["e1"], proposalIds: ["repaired-claim"] } },
      };
    },
  };
  const result = await new IndustryResearchSkill(fake).synthesize({ modules: [], evidence: [{ evidenceId: "e1", source }], existingKnowledge: [] });
  assert.equal(calls, 2);
  assert.equal(result.proposals[0].proposalId, "repaired-claim");
});

test("Industry module repairs a model-admitted invalid gap ID exactly once", async () => {
  let calls = 0;
  const fake: ReasoningExecutor = {
    capabilities: () => ({ maxContextTokens: 1000, maxOutputTokens: 1000, structuredOutputSupport: true, maxConcurrency: 1 }),
    execute: async (r) => {
      calls++;
      const gapId = calls === 1 ? "gap with spaces" : "gap-capacity-2026";
      return { operation: r.operation, output: { module: "risk_analysis", status: "partial", analysis: "gap", evidenceIds: ["e1"], proposals: [], gaps: [{ gapId, module: "risk_analysis", question: "q", reason: "r", actionable: true }], reportMaterial: { markdown: "gap", evidenceIds: ["e1"], proposalIds: [] } } };
    },
  };
  const result = await new IndustryResearchSkill(fake).analyze("risk_analysis", { target: { name: "Fixture" }, evidence: [{ evidenceId: "e1", source }], existingKnowledge: [], localReferences: [] });
  assert.equal(calls, 2);
  assert.equal(result.gaps[0].gapId, "gap-capacity-2026");
});

test("Industry module fails closed after one repeated invalid gap ID repair", async () => {
  let calls = 0;
  const fake: ReasoningExecutor = {
    capabilities: () => ({ maxContextTokens: 1000, maxOutputTokens: 1000, structuredOutputSupport: true, maxConcurrency: 1 }),
    execute: async (r) => {
      calls++;
      return { operation: r.operation, output: { module: "risk_analysis", status: "partial", analysis: "gap", evidenceIds: ["e1"], proposals: [], gaps: [{ gapId: "gap with spaces", module: "risk_analysis", question: "q", reason: "r", actionable: true }], reportMaterial: { markdown: "gap", evidenceIds: ["e1"], proposalIds: [] } } };
    },
  };
  const result = await new IndustryResearchSkill(fake).analyze("risk_analysis", { target: { name: "Fixture" }, evidence: [{ evidenceId: "e1", source }], existingKnowledge: [], localReferences: [] });
  assert.equal(calls, 2);
  assert.equal(result.status, "unavailable");
});

test("Industry module isolates malformed semantic proposals after one repair", async () => {
  let calls = 0;
  const fake: ReasoningExecutor = {
    capabilities: () => ({ maxContextTokens: 1000, maxOutputTokens: 1000, structuredOutputSupport: true, maxConcurrency: 1 }),
    execute: async (r) => {
      calls++;
      const proposals = [
        { proposalId: "product", kind: "entity", subjectKey: "product", entityType: "product", entityName: "Fixture Product" },
        { proposalId: "broken-relation", kind: "relation", subjectKey: "product", relationType: "offers_product", sourceCandidateIds: ["e1"] },
      ];
      return { operation: r.operation, output: { module: "company_mapping", status: "partial", analysis: "Evidence-backed company mapping narrative.", evidenceIds: ["e1"], proposals, gaps: [], reportMaterial: { markdown: "Evidence-backed company mapping narrative.", evidenceIds: ["e1"], proposalIds: ["product", "broken-relation"], relationProposalIds: ["broken-relation"], reportOnly: true } } };
    },
  };
  const result = await new IndustryResearchSkill(fake).analyze("company_mapping", { target: { name: "Fixture" }, evidence: [{ evidenceId: "e1", source }], existingKnowledge: [], localReferences: [] });
  assert.equal(calls, 2);
  assert.equal(result.status, "partial");
  assert.equal(result.evidenceIds[0], "e1");
  assert.deepEqual(result.proposals.map((item) => item.proposalId), ["product"]);
  assert.deepEqual(result.reportMaterial.proposalIds, ["product"]);
  assert.deepEqual(result.reportMaterial.relationProposalIds, []);
});

test("Industry synthesis fails closed after exactly one repair attempt", async () => {
  let calls = 0;
  const fake = executor({ executiveView: "bad", analysis: "bad", evidenceIds: ["e1"], proposals: [], gaps: [], alternativeViews: [], reportMaterial: { markdown: "bad", evidenceIds: ["e1"], proposalIds: ["unknown"] } });
  const counted: ReasoningExecutor = { ...fake, execute: async (r) => { calls++; return fake.execute(r); } };
  await assert.rejects(() => new IndustryResearchSkill(counted).synthesize({ modules: [], evidence: [{ evidenceId: "e1", source }], existingKnowledge: [] }), /local report material/);
  assert.equal(calls, 2);
});

test("Industry proposal variants and quantitative claims state evidence and period requirements", () => {
  const variants = createIndustryModuleResultContract("risk_analysis", ["e1"])
    .properties.proposals.items.oneOf;
  assert.deepEqual(
    variants.map((variant: any) => variant.required),
    [
      ["proposalId", "kind", "subjectKey", "entityType", "entityName"],
      [
        "proposalId",
        "kind",
        "subjectKey",
        "targetKey",
        "relationType",
        "sourceCandidateIds",
      ],
      [
        "proposalId",
        "kind",
        "subjectKey",
        "claimType",
        "statement",
        "sourceCandidateIds",
      ],
    ],
  );
  const quantitative = {
    ...moduleOutput("risk_analysis"),
    proposals: [
      {
        proposalId: "p",
        kind: "claim",
        subjectKey: "local",
        claimType: "fact",
        statement: "q",
        sourceCandidateIds: ["e1"],
        structuredValue: { metric: "m", value: 1, unit: "u", comparator: "eq", period: "2026" },
      },
    ],
  };
  assert.equal((variants[2] as any).properties.structuredValue.anyOf.length, 2);
  assert.doesNotThrow(() =>
    validateIndustryModuleResult(quantitative, "risk_analysis", ["e1"]),
  );
});

test("Industry structured values converge with Schema 0.4 fields and comparators", () => {
  const base = { proposalId: "p", kind: "claim", subjectKey: "local", claimType: "fact", statement: "q", sourceCandidateIds: ["e1"] };
  const valid = (structuredValue: Record<string, unknown>) => validateIndustryModuleResult({ ...moduleOutput("risk_analysis"), proposals: [{ ...base, structuredValue }] }, "risk_analysis", ["e1"]);
  assert.throws(() => valid({ metric: "m", value: 1, unit: "u", comparator: "eq", period: "2026", geography: "US" }), /quantitative/);
  assert.throws(() => valid({ metric: "m", value: 1, unit: "u", comparator: "equal", period: "2026" }), /quantitative/);
  for (const comparator of ["eq", "gt", "gte", "lt", "lte", "approx"]) assert.doesNotThrow(() => valid({ metric: "m", value: 1, unit: "u", comparator, period: "2026" }));
  assert.doesNotThrow(() => valid({ metric: "m", value: 1, unit: "u", comparator: "eq", period: "2026", semanticKey: "capacity" }));
});

test("Industry structured value repair accepts one compatible replacement and fails closed on a repeated incompatible result", async () => {
  const candidate = (structuredValue: Record<string, unknown>) => ({ ...moduleOutput("risk_analysis"), proposals: [{ proposalId: "p", kind: "claim", subjectKey: "local", claimType: "fact", statement: "q", sourceCandidateIds: ["e1"], structuredValue }] });
  let calls = 0;
  const repaired = new IndustryResearchSkill({ ...executor(null), execute: async (r) => { calls++; return { operation: r.operation, output: calls === 1 ? candidate({ metric: "m", value: 1, unit: "u", comparator: "eq", period: "2026", measurementDefinition: "bad" }) : candidate({ metric: "m", value: 1, unit: "u", comparator: "eq", period: "2026", semanticKey: "ok" }) }; } }).analyze("risk_analysis", { target: { name: "x" }, evidence: [{ evidenceId: "e1", source }], existingKnowledge: [], localReferences: [] });
  assert.equal((await repaired).proposals[0].structuredValue?.semanticKey, "ok");
  assert.equal(calls, 2);
  calls = 0;
  const failed = await new IndustryResearchSkill({ ...executor(null), execute: async (r) => { calls++; return { operation: r.operation, output: candidate({ metric: "m", value: 1, unit: "u", comparator: "equal", period: "2026" }) }; } }).analyze("risk_analysis", { target: { name: "x" }, evidence: [{ evidenceId: "e1", source }], existingKnowledge: [], localReferences: [] });
  assert.equal(failed.status, "unavailable");
  assert.equal(calls, 2);
});

test("Industry model contract exposes only Schema 0.4 structured value fields and comparator enum", () => {
  const structured = (createIndustryModuleResultContract("risk_analysis", ["e1"]).properties.proposals.items.oneOf[2] as any).properties.structuredValue;
  assert.equal(structured.additionalProperties, false);
  assert.deepEqual(Object.keys(structured.properties).sort(), ["comparator", "fiscalPeriod", "metric", "period", "semanticKey", "unit", "value"]);
  assert.deepEqual(structured.properties.comparator.enum, ["eq", "gt", "gte", "lt", "lte", "approx"]);
});
