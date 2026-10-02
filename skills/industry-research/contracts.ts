import type { NormalizedResearchSource } from "../../plugins/research-acquisition/contracts.ts";
import type { IndustryOperatingObservation } from "../../plugins/research-acquisition/industry-operating-observations.ts";
import type { SemanticProductionProposal } from "../../knowledge/production/contracts.ts";
import type { CompetitionColumnV1 } from "../../knowledge/schema/competition-module-v04.ts";
import { KNOWLEDGE_SCHEMA_V04 } from "../../knowledge/schema/executable-schema-v04.ts";
export const INDUSTRY_MODULES = [
  "industry_definition",
  "market_size_growth",
  "supply_demand_analysis",
  "industry_chain_analysis",
  "competitive_landscape",
  "technology_evolution",
  "company_mapping",
  "risk_analysis",
] as const;
export type IndustryResearchModule = (typeof INDUSTRY_MODULES)[number];
export const INDUSTRY_STRUCTURED_VALUE_FIELDS = KNOWLEDGE_SCHEMA_V04.claim.structuredValueFields;
export const INDUSTRY_STRUCTURED_VALUE_COMPARATORS = KNOWLEDGE_SCHEMA_V04.claim.comparators;
const structuredValueFieldSet = new Set<string>(INDUSTRY_STRUCTURED_VALUE_FIELDS);
const structuredValueComparatorSet = new Set<string>(INDUSTRY_STRUCTURED_VALUE_COMPARATORS);
export const INDUSTRY_LOCAL_ID_PATTERN = "^[A-Za-z][A-Za-z0-9._-]*$";
export const INDUSTRY_LOCAL_ID_MAX_LENGTH = 120;
const industryLocalIdPattern = new RegExp(INDUSTRY_LOCAL_ID_PATTERN);
const industryCanonicalIdPattern = /^(entity|relation|claim|source|raw|changeset|review-case):/i;

export function isValidIndustryLocalId(value: unknown): value is string {
  return typeof value === "string" &&
    value.length <= INDUSTRY_LOCAL_ID_MAX_LENGTH &&
    industryLocalIdPattern.test(value) &&
    !industryCanonicalIdPattern.test(value);
}

export function isValidIndustryStructuredValue(value: unknown): value is {
  metric: string;
  value: number | string | boolean;
  unit: string;
  comparator: (typeof INDUSTRY_STRUCTURED_VALUE_COMPARATORS)[number];
  period?: string;
  fiscalPeriod?: string;
  semanticKey?: string;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const x = value as Record<string, unknown>;
  if (Object.keys(x).some((key) => !structuredValueFieldSet.has(key))) return false;
  if (typeof x.metric !== "string" || x.metric.trim() === "" || x.metric.length > 200) return false;
  if (!(typeof x.value === "number" ? Number.isFinite(x.value) : typeof x.value === "string" ? x.value.trim() !== "" : typeof x.value === "boolean")) return false;
  if (typeof x.unit !== "string" || x.unit.trim() === "" || x.unit.length > 80) return false;
  if (typeof x.comparator !== "string" || !structuredValueComparatorSet.has(x.comparator)) return false;
  if ((x.period !== undefined && (typeof x.period !== "string" || x.period.trim() === "" || x.period.length > 80)) || (x.fiscalPeriod !== undefined && (typeof x.fiscalPeriod !== "string" || x.fiscalPeriod.trim() === "" || x.fiscalPeriod.length > 80)) || (x.semanticKey !== undefined && (typeof x.semanticKey !== "string" || x.semanticKey.trim() === "" || x.semanticKey.length > 200))) return false;
  return (typeof x.period === "string" && x.period.trim() !== "") || (typeof x.fiscalPeriod === "string" && x.fiscalPeriod.trim() !== "" );
}
export type IndustryTargetKind =
  "industry" | "theme" | "product" | "technology" | "uncertain";
export const INDUSTRY_RELATION_TYPES = [
  "upstream_of",
  "business_exposure",
  "belongs_to_industry",
  "offers_product",
  "component_of",
  "develops_technology",
  "uses_technology",
  "applied_in",
  "depends_on",
  "substitutes_for",
  "competes_with",
  "supplier_of",
] as const;
export const INDUSTRY_CLAIM_TYPES = [
  "fact",
  "forecast",
  "viewpoint",
  "trend",
  "risk",
  "assumption",
  "thesis",
  "catalyst",
] as const;
export const INDUSTRY_MODEL_BOUNDS = {
  maxString: 2000,
  maxAnalysis: 6000,
  maxArray: 32,
  maxEvidence: 32,
  maxProposals: 24,
  maxGaps: 16,
  maxAlternatives: 6,
  maxExistingKnowledge: 80,
  maxEvidenceExcerpt: 2400,
  maxPriorOutput: 6000,
  maxDiagnostics: 1200,
  maxDepth: 3,
} as const;
export interface IndustryTargetInput {
  readonly name: string;
  readonly canonicalRef?: string;
  readonly aliases?: readonly string[];
  readonly geography?: string;
  readonly asOf?: string;
}
export interface ResearchGap {
  readonly gapId: string;
  readonly module: IndustryResearchModule;
  readonly question: string;
  readonly reason: string;
  readonly actionable: boolean;
  readonly searchTerms?: readonly string[];
}
export interface ResearchDesign {
  readonly definitionHypothesis: string;
  readonly targetKind: IndustryTargetKind;
  readonly scope: {
    readonly included: readonly string[];
    readonly excluded: readonly string[];
  };
  readonly moduleQuestions: Readonly<Record<IndustryResearchModule, string>>;
  readonly keyMetrics: readonly string[];
  readonly evidenceRequirements: readonly string[];
  readonly searchTerms: readonly string[];
  readonly knownGaps: readonly ResearchGap[];
  readonly verificationCandidates: readonly {
    readonly name: string;
    readonly kind: "product" | "technology" | "industry" | "company";
    readonly reason: string;
  }[];
}
export interface ModuleEvidence {
  readonly evidenceId: string;
  readonly source: NormalizedResearchSource;
  readonly excerpt?: string;
}
export interface LocalReportMaterial {
  readonly markdown: string;
  readonly evidenceIds: readonly string[];
  readonly proposalIds: readonly string[];
  readonly relationProposalIds?: readonly string[];
  readonly reportOnly?: boolean;
}
export interface IndustryModuleResult {
  readonly module: IndustryResearchModule;
  readonly status: "supported" | "partial" | "unavailable";
  readonly analysis: string;
  readonly evidenceIds: readonly string[];
  readonly proposals: readonly SemanticProductionProposal[];
  readonly gaps: readonly ResearchGap[];
  readonly reportMaterial: LocalReportMaterial;
  /** Local-only table proposal emitted by competitive_landscape. */
  readonly competitionTable?: IndustryCompetitionTable;
}
export type IndustryCompetitionCell =
  | { readonly status: "available"; readonly displayValue: string; readonly knowledgeProposalIds: readonly string[]; readonly asOf?: string; readonly fiscalYear?: number; readonly unit?: string; readonly currency?: string }
  | { readonly status: "unavailable" | "not_comparable"; readonly reason: string };
export interface IndustryCompetitionTable {
  readonly columns: readonly CompetitionColumnV1[];
  readonly rows: readonly {
    readonly companyKey: string;
    readonly businessExposureProposalId: string;
    readonly cells: Readonly<Record<string, IndustryCompetitionCell>>;
  }[];
}
export interface CrossModuleSynthesis {
  readonly executiveView: string;
  readonly analysis: string;
  readonly evidenceIds: readonly string[];
  readonly proposals: readonly SemanticProductionProposal[];
  readonly gaps: readonly ResearchGap[];
  readonly alternativeViews: readonly string[];
  readonly reportMaterial: LocalReportMaterial;
}
export interface IndustryResearchSkillInput {
  readonly target: IndustryTargetInput;
  readonly designContext?: unknown;
  readonly evidence: readonly ModuleEvidence[];
  readonly operatingObservations?: readonly IndustryOperatingObservation[];
  readonly existingKnowledge: readonly unknown[];
  readonly localReferences: readonly string[];
}
export const ALL_INDUSTRY_OPERATION_NAMES = [
  "industry_research_design",
  "industry_module_analysis",
  "industry_cross_module_synthesis",
] as const;
export type IndustryOperationName =
  (typeof ALL_INDUSTRY_OPERATION_NAMES)[number];
const boundedString = (maxLength: number) => ({
  type: "string",
  minLength: 1,
  maxLength,
});
const strings = (minItems = 1, maxItems = INDUSTRY_MODEL_BOUNDS.maxArray) => ({
  type: "array",
  minItems,
  maxItems,
  uniqueItems: true,
  items: boundedString(INDUSTRY_MODEL_BOUNDS.maxString),
});
const gap = {
  type: "object",
  additionalProperties: false,
  required: ["gapId", "module", "question", "reason", "actionable"],
  properties: {
    gapId: {
      type: "string",
      minLength: 1,
      pattern: INDUSTRY_LOCAL_ID_PATTERN,
      maxLength: INDUSTRY_LOCAL_ID_MAX_LENGTH,
      description:
        "Local ID only; never canonical entity:, relation:, claim:, source:, raw:, changeset: or review-case:.",
    },
    module: { enum: [...INDUSTRY_MODULES] },
    question: boundedString(500),
    reason: boundedString(1000),
    actionable: { type: "boolean" },
    searchTerms: strings(1, INDUSTRY_MODEL_BOUNDS.maxArray),
  },
};
const verificationCandidate = {
  type: "object",
  additionalProperties: false,
  required: ["name", "kind", "reason"],
  properties: {
    name: boundedString(300),
    kind: { enum: ["product", "technology", "industry", "company"] },
    reason: boundedString(1000),
  },
};
const localId = {
  type: "string",
  pattern: INDUSTRY_LOCAL_ID_PATTERN,
  maxLength: INDUSTRY_LOCAL_ID_MAX_LENGTH,
  description:
    "Local ID only; never canonical entity:, relation:, claim:, source:, raw:, changeset: or review-case:.",
};
const evidenceRefs = (allowed: readonly string[]) => ({
  type: "array",
  minItems: 0,
  maxItems: INDUSTRY_MODEL_BOUNDS.maxEvidence,
  uniqueItems: true,
  items: allowed.length ? { enum: [...allowed] } : boundedString(120),
  description: allowed.length
    ? `Exact evidence allowlist: ${allowed.join(", ")}`
    : "No evidence is available; keep this empty.",
});
const structuredValue = {
  type: "object",
  additionalProperties: false,
  required: ["metric", "value", "unit", "comparator"],
  anyOf: [{ required: ["period"] }, { required: ["fiscalPeriod"] }],
  properties: {
    metric: boundedString(200),
    value: {},
    unit: boundedString(80),
    comparator: { enum: [...INDUSTRY_STRUCTURED_VALUE_COMPARATORS] },
    period: boundedString(80),
    fiscalPeriod: boundedString(80),
    semanticKey: boundedString(200),
  },
};
const entityProposal = (allowed: readonly string[]) => ({
  type: "object",
  additionalProperties: false,
  required: ["proposalId", "kind", "subjectKey", "entityType", "entityName"],
  properties: {
    proposalId: localId,
    kind: { const: "entity" },
    subjectKey: localId,
    entityType: { enum: ["industry", "product", "technology", "company"] },
    entityName: boundedString(300),
    structuredValue: {
      type: "object",
      additionalProperties: false,
      properties: {
        ticker: boundedString(32),
        exchange: boundedString(32),
        aliases: { type: "array", minItems: 0, maxItems: 16, uniqueItems: true, items: boundedString(300) },
      },
    },
    sourceCandidateIds: evidenceRefs(allowed),
  },
});
const relationProposal = (allowed: readonly string[]) => ({
  type: "object",
  additionalProperties: false,
  required: [
    "proposalId",
    "kind",
    "subjectKey",
    "targetKey",
    "relationType",
    "sourceCandidateIds",
  ],
  properties: {
    proposalId: localId,
    kind: { const: "relation" },
    subjectKey: localId,
    targetKey: localId,
    relationType: { enum: [...INDUSTRY_RELATION_TYPES] },
    sourceCandidateIds: evidenceRefs(allowed),
  },
});
const claimProposal = (allowed: readonly string[]) => ({
  type: "object",
  additionalProperties: false,
  required: [
    "proposalId",
    "kind",
    "subjectKey",
    "claimType",
    "statement",
    "sourceCandidateIds",
  ],
  properties: {
    proposalId: localId,
    kind: { const: "claim" },
    subjectKey: localId,
    claimType: { enum: [...INDUSTRY_CLAIM_TYPES] },
    statement: boundedString(2000),
    sourceCandidateIds: evidenceRefs(allowed),
    structuredValue,
  },
});
const proposalVariants = (allowed: readonly string[]) => ({
  oneOf: [entityProposal(allowed), relationProposal(allowed), claimProposal(allowed)],
  description: "Exactly one kind-specific proposal variant; all IDs are local.",
});
const material = (
  allowedEvidence: readonly string[],
  allowedProposals: readonly string[] = [],
) => ({
  type: "object",
  additionalProperties: false,
  required: ["markdown", "evidenceIds", "proposalIds"],
  properties: {
    markdown: boundedString(6000),
    evidenceIds: evidenceRefs(allowedEvidence),
    proposalIds: {
      type: "array",
      minItems: 0,
      maxItems: 24,
      uniqueItems: true,
      items: allowedProposals.length
        ? { enum: [...allowedProposals] }
        : localId,
    },
    relationProposalIds: {
      type: "array",
      minItems: 0,
      maxItems: 24,
      uniqueItems: true,
      items: allowedProposals.length
        ? { enum: [...allowedProposals] }
        : localId,
    },
    reportOnly: { type: "boolean" },
  },
});
export const INDUSTRY_RESEARCH_DESIGN_CONTRACT = {
  name: "IndustryResearchDesign",
  type: "object",
  additionalProperties: false,
  required: [
    "definitionHypothesis",
    "targetKind",
    "scope",
    "moduleQuestions",
    "keyMetrics",
    "evidenceRequirements",
    "searchTerms",
    "knownGaps",
    "verificationCandidates",
  ],
  bounds: INDUSTRY_MODEL_BOUNDS,
  properties: {
    definitionHypothesis: boundedString(1200),
    targetKind: {
      enum: ["industry", "theme", "product", "technology", "uncertain"],
    },
    scope: {
      type: "object",
      additionalProperties: false,
      required: ["included", "excluded"],
      properties: { included: strings(0), excluded: strings(0) },
    },
    moduleQuestions: {
      type: "object",
      additionalProperties: false,
      required: [...INDUSTRY_MODULES],
      properties: Object.fromEntries(
        INDUSTRY_MODULES.map((m) => [m, boundedString(800)]),
      ),
    },
    keyMetrics: strings(),
    evidenceRequirements: strings(),
    searchTerms: strings(),
    knownGaps: { type: "array", minItems: 0, maxItems: 16, items: gap },
    verificationCandidates: {
      type: "array",
      minItems: 0,
      maxItems: 16,
      items: verificationCandidate,
    },
  },
};
export const createIndustryModuleResultContract = (
  module: IndustryResearchModule,
  allowedEvidence: readonly string[],
  allowedProposals: readonly string[] = [],
) => ({
  name: "IndustryModuleResult",
  type: "object",
  additionalProperties: false,
  required: [
    "module",
    "status",
    "analysis",
    "evidenceIds",
    "proposals",
    "gaps",
    "reportMaterial",
    ...(module === "competitive_landscape" ? ["competitionTable"] : []),
  ],
  bounds: INDUSTRY_MODEL_BOUNDS,
  properties: {
    module: { const: module },
    status: { enum: ["supported", "partial", "unavailable"] },
    analysis: boundedString(INDUSTRY_MODEL_BOUNDS.maxAnalysis),
    evidenceIds: evidenceRefs(allowedEvidence),
    proposals: {
      type: "array",
      minItems: 0,
      maxItems: 24,
      items: proposalVariants(allowedEvidence),
    },
    gaps: { type: "array", minItems: 0, maxItems: 16, items: gap },
    reportMaterial: material(allowedEvidence, allowedProposals),
    ...(module === "competitive_landscape" ? {
      competitionTable: {
        type: "object",
        additionalProperties: false,
        required: ["columns", "rows"],
        properties: {
          columns: {
            type: "array", minItems: 4, maxItems: 7,
            items: { oneOf: [
              ...["company", "main_products", "market_cap", "annual_revenue"].map((role) => ({ type: "object", additionalProperties: false, required: ["id", "label", "role"], properties: { id: localId, label: boundedString(128), role: { const: role } } })),
              { type: "object", additionalProperties: false, required: ["id", "label", "role", "customRole"], properties: { id: localId, label: boundedString(128), role: { const: "custom" }, customRole: localId } },
            ] },
          },
          rows: {
            type: "array", minItems: 0, maxItems: 40,
            items: {
              type: "object", additionalProperties: false,
              required: ["companyKey", "businessExposureProposalId", "cells"],
              properties: {
                companyKey: localId,
                businessExposureProposalId: localId,
                cells: {
                  type: "array", minItems: 3, maxItems: 6,
                  items: {
                    type: "object", additionalProperties: false, required: ["columnId", "status"],
                    properties: {
                      columnId: localId,
                      status: { enum: ["available", "unavailable", "not_comparable"] },
                      displayValue: boundedString(2048),
                      knowledgeProposalIds: { type: "array", minItems: 1, maxItems: 16, uniqueItems: true, items: localId },
                      asOf: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
                      fiscalYear: { type: "integer", minimum: 1900, maximum: 9999 },
                      unit: boundedString(32), currency: boundedString(3), reason: boundedString(1024),
                    },
                  },
                },
              },
            },
          },
        },
        rules: "Columns must include company, main_products, market_cap, and annual_revenue. Every row must provide one cell entry for each non-company column. Available cells bind local Claim or Relation proposal IDs; missing evidence uses unavailable or not_comparable with a reason. Market cap uses the matching metric:market_cap numeric Claim with temporal.asOf. Revenue uses metric:revenue and its latest annual fiscal period. Numeric displayValue must equal the cited Claim value.",
      },
    } : {}),
  },
  allowlists: {
    evidenceIds: [...allowedEvidence],
    existingProposalIds: [...allowedProposals],
  },
  proposalRules:
    "Claim and Relation candidates require supplied evidence; Entity candidates may be evidence-free.",
});
export const INDUSTRY_MODULE_RESULT_CONTRACT =
  createIndustryModuleResultContract("industry_definition", []);
export const createIndustrySynthesisContract = (
  allowedEvidence: readonly string[],
  allowedProposals: readonly string[] = [],
  allowedRelations: readonly string[] = [],
) => ({
  name: "CrossModuleSynthesis",
  type: "object",
  additionalProperties: false,
  required: [
    "executiveView",
    "analysis",
    "evidenceIds",
    "proposals",
    "gaps",
    "alternativeViews",
    "reportMaterial",
  ],
  bounds: INDUSTRY_MODEL_BOUNDS,
  properties: {
    executiveView: boundedString(3000),
    analysis: boundedString(INDUSTRY_MODEL_BOUNDS.maxAnalysis),
    evidenceIds: evidenceRefs(allowedEvidence),
    proposals: {
      type: "array",
      minItems: 0,
      maxItems: 24,
      items: proposalVariants(allowedEvidence),
    },
    gaps: { type: "array", minItems: 0, maxItems: 16, items: gap },
    alternativeViews: {
      type: "array",
      minItems: 0,
      maxItems: 6,
      items: boundedString(1200),
    },
    reportMaterial: {
      ...material(allowedEvidence, [...allowedProposals, ...allowedRelations]),
      properties: {
        ...material(allowedEvidence, [...allowedProposals, ...allowedRelations])
          .properties,
        proposalIds: {
          type: "array",
          minItems: 0,
          maxItems: 24,
          uniqueItems: true,
          items: localId,
        },
        relationProposalIds: {
          type: "array",
          minItems: 0,
          maxItems: 24,
          uniqueItems: true,
          // Same-response Relation proposals do not exist when the schema is
          // built. Exact membership is checked after parsing.
          items: localId,
        },
      },
    },
  },
  allowlists: {
    evidenceIds: [...allowedEvidence],
    existingProposalIds: [...allowedProposals],
    existingRelationProposalIds: [...allowedRelations],
  },
  proposalRules:
    "New proposal IDs are local; report references are checked after parsing against supplied and same-response proposals.",
});
export const INDUSTRY_SYNTHESIS_CONTRACT = createIndustrySynthesisContract(
  [],
  [],
  [],
);
