import { createHash } from "node:crypto";

export const THEME_FRAMEWORK_BOUNDS = {
  maxThemeName: 300,
  maxDefinition: 2000,
  maxSummary: 8000,
  maxIndustries: 40,
  maxRelations: 80,
  maxEvidence: 80,
  maxEvidenceRefs: 24,
  maxPriorDecisions: 120,
  maxGaps: 24,
  maxString: 1200,
  maxExcerpt: 2400,
} as const;

export const THEME_FRAMEWORK_RECOMMENDATIONS = [
  "include",
  "exclude",
  "pending",
] as const;
export type ThemeFrameworkRecommendation =
  (typeof THEME_FRAMEWORK_RECOMMENDATIONS)[number];

export type ThemeFrameworkRelationType = "upstream_of" | "depends_on";
export type ThemeFrameworkDecisionChange = "new" | "unchanged" | "reopen";

export interface ThemeFrameworkInput {
  readonly theme: {
    readonly name: string;
    readonly definition?: string;
  };
  readonly existingKnowledge: {
    readonly summary: string;
    readonly industries: readonly {
      readonly ref: string;
      readonly name: string;
      readonly description?: string;
    }[];
  };
  readonly evidence: readonly {
    readonly evidenceId: string;
    readonly origin: "existing_kb" | "external";
    readonly description: string;
    readonly sourceRef: string;
    readonly publishedAt?: string;
    readonly excerpt?: string;
  }[];
  readonly priorDecisions: readonly {
    readonly decisionId: string;
    readonly semanticFingerprint: string;
    readonly candidateType: "industry" | "relation";
    readonly recommendation: ThemeFrameworkRecommendation;
    readonly rationale: string;
    readonly evidenceRefs: readonly string[];
  }[];
}

export interface ThemeFrameworkIndustryCandidate {
  readonly candidateId: string;
  readonly semanticFingerprint: string;
  readonly existingIndustryRef?: string;
  readonly name: string;
  readonly description: string;
  readonly independentlyResearchableRationale: string;
  readonly themeRelevanceRationale: string;
  readonly boundaryRationale: string;
  readonly recommendation: ThemeFrameworkRecommendation;
  readonly decisionChange: ThemeFrameworkDecisionChange;
  readonly priorDecisionId?: string;
  readonly reopenEvidenceRefs?: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly coverageGaps: readonly string[];
}

export interface ThemeFrameworkRelationCandidate {
  readonly candidateId: string;
  readonly semanticFingerprint: string;
  readonly sourceIndustryRef: string;
  readonly targetIndustryRef: string;
  readonly relationType: ThemeFrameworkRelationType;
  readonly topologyRole: "main_chain" | "cross_chain";
  readonly directionRationale: string;
  readonly themeRelevanceRationale: string;
  readonly boundaryRationale: string;
  readonly recommendation: ThemeFrameworkRecommendation;
  readonly decisionChange: ThemeFrameworkDecisionChange;
  readonly priorDecisionId?: string;
  readonly reopenEvidenceRefs?: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly coverageGaps: readonly string[];
}

export interface ThemeFrameworkCoverageGap {
  readonly gapId: string;
  readonly question: string;
  readonly reason: string;
  readonly affectedCandidateIds: readonly string[];
}

export interface ThemeFrameworkResult {
  readonly proposedDefinition: {
    readonly statement: string;
    readonly status: "supported" | "provisional";
    readonly evidenceRefs: readonly string[];
  };
  readonly inclusionPrinciples: readonly string[];
  readonly exclusionPrinciples: readonly string[];
  readonly industryCandidates: readonly ThemeFrameworkIndustryCandidate[];
  readonly relationCandidates: readonly ThemeFrameworkRelationCandidate[];
  readonly coverageGaps: readonly ThemeFrameworkCoverageGap[];
}

export interface ThemeFrameworkDiagnostic {
  readonly code: string;
  readonly path?: string;
}

export class ThemeFrameworkValidationError extends Error {
  constructor(
    readonly code: string,
    readonly path?: string,
    message = code,
  ) {
    super(message);
    this.name = "ThemeFrameworkValidationError";
  }
}

const ID = /^[A-Za-z][A-Za-z0-9._-]{0,79}$/;
const text = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const boundedText = (value: unknown, max: number): value is string =>
  text(value) && value.length <= max;
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const stringArray = (
  value: unknown,
  maxItems: number,
  maxLength: number,
  minItems = 0,
): value is readonly string[] =>
  Array.isArray(value) &&
  value.length >= minItems &&
  value.length <= maxItems &&
  value.every((item) => boundedText(item, maxLength)) &&
  new Set(value).size === value.length;

function fail(code: string, path?: string): never {
  throw new ThemeFrameworkValidationError(code, path);
}

function normalizeLabel(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function fingerprintThemeIndustry(
  name: string,
  existingIndustryRef?: string,
): string {
  return existingIndustryRef
    ? `industry-ref:${hash(existingIndustryRef)}`
    : `industry-name:${hash(normalizeLabel(name))}`;
}

export function fingerprintThemeRelation(
  relationType: ThemeFrameworkRelationType,
  sourceIndustryFingerprint: string,
  targetIndustryFingerprint: string,
): string {
  return `relation:${hash(`${relationType}\0${sourceIndustryFingerprint}\0${targetIndustryFingerprint}`)}`;
}

function parseObject(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return parseObject(
        JSON.parse(value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")),
      );
    } catch {
      fail("output_json_invalid");
    }
  }
  if (!object(value)) fail("output_shape_invalid");
  for (const key of ["output", "result", "data"]) {
    if (object(value[key])) return parseObject(value[key]);
  }
  return value;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  path: string,
): void {
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !(key in value)) || Object.keys(value).some((key) => !allowed.has(key))) {
    fail("output_fields_invalid", path);
  }
}

export function validateThemeFrameworkInput(input: ThemeFrameworkInput): void {
  if (
    !input ||
    !object(input.theme) ||
    !boundedText(input.theme.name, THEME_FRAMEWORK_BOUNDS.maxThemeName) ||
    (input.theme.definition !== undefined &&
      !boundedText(input.theme.definition, THEME_FRAMEWORK_BOUNDS.maxDefinition))
  ) fail("input_theme_invalid", "theme");
  if (
    !object(input.existingKnowledge) ||
    typeof input.existingKnowledge.summary !== "string" ||
    input.existingKnowledge.summary.length > THEME_FRAMEWORK_BOUNDS.maxSummary ||
    !Array.isArray(input.existingKnowledge.industries) ||
    input.existingKnowledge.industries.length > THEME_FRAMEWORK_BOUNDS.maxEvidence
  ) fail("input_existing_knowledge_invalid", "existingKnowledge");
  const existingRefs = new Set<string>();
  for (const [index, industry] of input.existingKnowledge.industries.entries()) {
    if (
      !object(industry) ||
      !boundedText(industry.ref, 200) ||
      !boundedText(industry.name, 300) ||
      (industry.description !== undefined && !boundedText(industry.description, 1200)) ||
      existingRefs.has(industry.ref)
    ) fail("input_existing_industry_invalid", `existingKnowledge.industries.${index}`);
    existingRefs.add(industry.ref);
  }
  if (!Array.isArray(input.evidence) || input.evidence.length > THEME_FRAMEWORK_BOUNDS.maxEvidence) {
    fail("input_evidence_invalid", "evidence");
  }
  const evidenceIds = new Set<string>();
  for (const [index, item] of input.evidence.entries()) {
    if (
      !object(item) ||
      !ID.test(String(item.evidenceId)) ||
      !["existing_kb", "external"].includes(String(item.origin)) ||
      !boundedText(item.description, 500) ||
      !boundedText(item.sourceRef, 200) ||
      (item.publishedAt !== undefined && !boundedText(item.publishedAt, 80)) ||
      (item.excerpt !== undefined && !boundedText(item.excerpt, THEME_FRAMEWORK_BOUNDS.maxExcerpt)) ||
      evidenceIds.has(String(item.evidenceId))
    ) fail("input_evidence_item_invalid", `evidence.${index}`);
    evidenceIds.add(String(item.evidenceId));
  }
  if (!Array.isArray(input.priorDecisions) || input.priorDecisions.length > THEME_FRAMEWORK_BOUNDS.maxPriorDecisions) {
    fail("input_prior_decisions_invalid", "priorDecisions");
  }
  const decisionIds = new Set<string>();
  const fingerprints = new Set<string>();
  for (const [index, decision] of input.priorDecisions.entries()) {
    if (
      !object(decision) ||
      !ID.test(String(decision.decisionId)) ||
      !boundedText(decision.semanticFingerprint, 200) ||
      !["industry", "relation"].includes(String(decision.candidateType)) ||
      !THEME_FRAMEWORK_RECOMMENDATIONS.includes(decision.recommendation as ThemeFrameworkRecommendation) ||
      !boundedText(decision.rationale, 1200) ||
      !stringArray(decision.evidenceRefs, THEME_FRAMEWORK_BOUNDS.maxEvidenceRefs, 120) ||
      decisionIds.has(String(decision.decisionId)) ||
      fingerprints.has(String(decision.semanticFingerprint))
    ) fail("input_prior_decision_invalid", `priorDecisions.${index}`);
    decisionIds.add(String(decision.decisionId));
    fingerprints.add(String(decision.semanticFingerprint));
  }
}

function validateRefs(
  value: unknown,
  evidenceIds: ReadonlySet<string>,
  path: string,
): readonly string[] {
  if (!stringArray(value, THEME_FRAMEWORK_BOUNDS.maxEvidenceRefs, 80)) {
    fail("evidence_refs_invalid", path);
  }
  if (value.some((ref) => !evidenceIds.has(ref))) fail("evidence_ref_unknown", path);
  return value;
}

function validateDecision(
  item: Record<string, unknown>,
  candidateType: "industry" | "relation",
  evidenceRefs: readonly string[],
  prior: ThemeFrameworkInput["priorDecisions"][number] | undefined,
  path: string,
): { readonly decisionChange: ThemeFrameworkDecisionChange; readonly priorDecisionId?: string; readonly reopenEvidenceRefs?: readonly string[] } {
  const decisionChange = item.decisionChange;
  if (!THEME_FRAMEWORK_RECOMMENDATIONS.includes(item.recommendation as ThemeFrameworkRecommendation)) {
    fail("recommendation_invalid", path);
  }
  if (!(["new", "unchanged", "reopen"] as const).includes(decisionChange as ThemeFrameworkDecisionChange)) {
    fail("decision_change_invalid", path);
  }
  const evidenceSet = new Set(evidenceRefs);
  if (item.recommendation !== "pending" && evidenceRefs.length === 0) {
    fail("decision_ungrounded", path);
  }
  if (!prior) {
    if (decisionChange !== "new" || item.priorDecisionId !== undefined || item.reopenEvidenceRefs !== undefined) {
      fail("prior_decision_missing", path);
    }
    return { decisionChange: "new" };
  }
  if (prior.candidateType !== candidateType || item.priorDecisionId !== prior.decisionId) {
    fail("prior_decision_mismatch", path);
  }
  if (decisionChange === "unchanged") {
    if (item.recommendation !== prior.recommendation || item.reopenEvidenceRefs !== undefined) {
      fail("unchanged_decision_mismatch", path);
    }
    return { decisionChange: "unchanged", priorDecisionId: prior.decisionId };
  }
  if (decisionChange !== "reopen" || item.recommendation === prior.recommendation) {
    fail("reopen_decision_invalid", path);
  }
  const reopenEvidenceRefs = validateRefs(item.reopenEvidenceRefs, new Set(evidenceSet), `${path}.reopenEvidenceRefs`);
  if (reopenEvidenceRefs.length === 0 || reopenEvidenceRefs.every((ref) => prior.evidenceRefs.includes(ref))) {
    fail("reopen_requires_new_evidence", path);
  }
  return { decisionChange: "reopen", priorDecisionId: prior.decisionId, reopenEvidenceRefs };
}

function checkAcyclic(edges: readonly { source: string; target: string }[]): void {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (node: string): boolean => {
    if (visiting.has(node)) return false;
    if (visited.has(node)) return true;
    visiting.add(node);
    for (const target of adjacency.get(node) ?? []) if (!visit(target)) return false;
    visiting.delete(node);
    visited.add(node);
    return true;
  };
  for (const node of adjacency.keys()) if (!visit(node)) fail("directed_relation_cycle", "relationCandidates");
}

export function validateThemeFrameworkResult(
  value: unknown,
  input: ThemeFrameworkInput,
): ThemeFrameworkResult {
  validateThemeFrameworkInput(input);
  const output = parseObject(value);
  exactKeys(output, ["proposedDefinition", "inclusionPrinciples", "exclusionPrinciples", "industryCandidates", "relationCandidates", "coverageGaps"], [], "output");
  const allowedEvidence = new Set(input.evidence.map((item) => item.evidenceId));
  const priorByFingerprint = new Map(input.priorDecisions.map((item) => [item.semanticFingerprint, item]));
  if (!object(output.proposedDefinition)) fail("proposed_definition_invalid", "proposedDefinition");
  exactKeys(output.proposedDefinition, ["statement", "status", "evidenceRefs"], [], "proposedDefinition");
  if (!boundedText(output.proposedDefinition.statement, THEME_FRAMEWORK_BOUNDS.maxDefinition) || !["supported", "provisional"].includes(String(output.proposedDefinition.status))) {
    fail("proposed_definition_invalid", "proposedDefinition");
  }
  const definitionEvidence = validateRefs(output.proposedDefinition.evidenceRefs, allowedEvidence, "proposedDefinition.evidenceRefs");
  if (output.proposedDefinition.status === "supported" && definitionEvidence.length === 0) fail("definition_ungrounded", "proposedDefinition");
  for (const key of ["inclusionPrinciples", "exclusionPrinciples"] as const) {
    if (!stringArray(output[key], 16, 500)) fail("scope_principles_invalid", key);
  }
  if (!Array.isArray(output.industryCandidates) || output.industryCandidates.length > THEME_FRAMEWORK_BOUNDS.maxIndustries) {
    fail("industry_candidates_invalid", "industryCandidates");
  }
  const candidates: ThemeFrameworkIndustryCandidate[] = [];
  const byCandidateId = new Map<string, ThemeFrameworkIndustryCandidate>();
  const byIndustryRef = new Map<string, ThemeFrameworkIndustryCandidate>();
  const industryFingerprints = new Set<string>();
  const candidateIds = new Set<string>();
  const allowedIndustryRefs = new Set(input.existingKnowledge.industries.map((industry) => industry.ref));
  for (const [index, raw] of output.industryCandidates.entries()) {
    const path = `industryCandidates.${index}`;
    if (!object(raw)) fail("industry_candidate_invalid", path);
    exactKeys(raw, ["candidateId", "name", "description", "independentlyResearchableRationale", "themeRelevanceRationale", "boundaryRationale", "recommendation", "decisionChange", "evidenceRefs", "coverageGaps"], ["existingIndustryRef", "priorDecisionId", "reopenEvidenceRefs"], path);
    if (!ID.test(String(raw.candidateId)) || candidateIds.has(String(raw.candidateId))) fail("candidate_id_invalid", `${path}.candidateId`);
    if (!boundedText(raw.name, 300) || !boundedText(raw.description, THEME_FRAMEWORK_BOUNDS.maxString) || !boundedText(raw.independentlyResearchableRationale, 1000) || !boundedText(raw.themeRelevanceRationale, 1000) || !boundedText(raw.boundaryRationale, 1000) || !stringArray(raw.coverageGaps, 8, 500)) fail("industry_candidate_fields_invalid", path);
    const existingIndustryRef = raw.existingIndustryRef;
    if (existingIndustryRef !== undefined && (!text(existingIndustryRef) || !allowedIndustryRefs.has(existingIndustryRef))) fail("existing_industry_ref_unknown", `${path}.existingIndustryRef`);
    const canonicalFingerprint = fingerprintThemeIndustry(raw.name, existingIndustryRef as string | undefined);
    const nameFingerprint = fingerprintThemeIndustry(raw.name);
    // Keep the earlier semantic fingerprint when a formerly uncanonical candidate
    // is now matched to a canonical Industry ref.
    const prior = priorByFingerprint.get(canonicalFingerprint) ?? priorByFingerprint.get(nameFingerprint);
    const semanticFingerprint = prior?.semanticFingerprint ?? canonicalFingerprint;
    if (industryFingerprints.has(semanticFingerprint)) fail("industry_candidate_duplicate", path);
    const evidenceRefs = validateRefs(raw.evidenceRefs, allowedEvidence, `${path}.evidenceRefs`);
    if (raw.recommendation === "pending" && raw.coverageGaps.length === 0) fail("pending_candidate_gap_missing", path);
    const decision = validateDecision(raw, "industry", evidenceRefs, prior, path);
    const candidate: ThemeFrameworkIndustryCandidate = {
      candidateId: raw.candidateId as string,
      semanticFingerprint,
      ...(typeof existingIndustryRef === "string" ? { existingIndustryRef } : {}),
      name: raw.name,
      description: raw.description,
      independentlyResearchableRationale: raw.independentlyResearchableRationale,
      themeRelevanceRationale: raw.themeRelevanceRationale,
      boundaryRationale: raw.boundaryRationale,
      recommendation: raw.recommendation as ThemeFrameworkRecommendation,
      ...decision,
      evidenceRefs,
      coverageGaps: raw.coverageGaps as string[],
    };
    candidates.push(candidate);
    byCandidateId.set(candidate.candidateId, candidate);
    if (candidate.existingIndustryRef) byIndustryRef.set(candidate.existingIndustryRef, candidate);
    industryFingerprints.add(semanticFingerprint);
    candidateIds.add(candidate.candidateId);
  }
  if (!Array.isArray(output.relationCandidates) || output.relationCandidates.length > THEME_FRAMEWORK_BOUNDS.maxRelations) fail("relation_candidates_invalid", "relationCandidates");
  const relationCandidates: ThemeFrameworkRelationCandidate[] = [];
  const relationFingerprints = new Set<string>();
  const relationCandidateIds = new Set<string>();
  const includedEdgesByType = new Map<ThemeFrameworkRelationType, { source: string; target: string }[]>();
  for (const [index, raw] of output.relationCandidates.entries()) {
    const path = `relationCandidates.${index}`;
    if (!object(raw)) fail("relation_candidate_invalid", path);
    exactKeys(raw, ["candidateId", "sourceIndustryRef", "targetIndustryRef", "relationType", "topologyRole", "directionRationale", "themeRelevanceRationale", "boundaryRationale", "recommendation", "decisionChange", "evidenceRefs", "coverageGaps"], ["priorDecisionId", "reopenEvidenceRefs"], path);
    if (!ID.test(String(raw.candidateId)) || candidateIds.has(String(raw.candidateId)) || relationCandidateIds.has(String(raw.candidateId))) fail("relation_candidate_id_invalid", path);
    if (!boundedText(raw.sourceIndustryRef, 200) || !boundedText(raw.targetIndustryRef, 200) || raw.sourceIndustryRef === raw.targetIndustryRef) fail("relation_endpoint_invalid", path);
    if (!["upstream_of", "depends_on"].includes(String(raw.relationType))) fail("relation_type_invalid", `${path}.relationType`);
    if (!["main_chain", "cross_chain"].includes(String(raw.topologyRole))) fail("relation_topology_invalid", `${path}.topologyRole`);
    if (!boundedText(raw.directionRationale, 1000) || !boundedText(raw.themeRelevanceRationale, 1000) || !boundedText(raw.boundaryRationale, 1000) || !stringArray(raw.coverageGaps, 8, 500)) fail("relation_candidate_fields_invalid", path);
    const sourceNode = byCandidateId.get(raw.sourceIndustryRef) ?? byIndustryRef.get(raw.sourceIndustryRef);
    const targetNode = byCandidateId.get(raw.targetIndustryRef) ?? byIndustryRef.get(raw.targetIndustryRef);
    if (!sourceNode || !targetNode) fail("relation_endpoint_unknown", path);
    const sourceFingerprint = sourceNode.semanticFingerprint;
    const targetFingerprint = targetNode.semanticFingerprint;
    const relationType = raw.relationType as ThemeFrameworkRelationType;
    const semanticFingerprint = fingerprintThemeRelation(relationType, sourceFingerprint, targetFingerprint);
    if (relationFingerprints.has(semanticFingerprint)) fail("relation_candidate_duplicate", path);
    const evidenceRefs = validateRefs(raw.evidenceRefs, allowedEvidence, `${path}.evidenceRefs`);
    if (raw.recommendation === "pending" && raw.coverageGaps.length === 0) fail("pending_candidate_gap_missing", path);
    const prior = priorByFingerprint.get(semanticFingerprint);
    const decision = validateDecision(raw, "relation", evidenceRefs, prior, path);
    const recommendation = raw.recommendation as ThemeFrameworkRecommendation;
    if (recommendation === "include" && (sourceNode.recommendation !== "include" || targetNode.recommendation !== "include")) fail("relation_included_with_unincluded_endpoint", path);
    if (recommendation === "include") includedEdgesByType.set(relationType, [...(includedEdgesByType.get(relationType) ?? []), { source: sourceFingerprint, target: targetFingerprint }]);
    relationCandidates.push({
      candidateId: raw.candidateId as string,
      semanticFingerprint,
      sourceIndustryRef: raw.sourceIndustryRef,
      targetIndustryRef: raw.targetIndustryRef,
      relationType,
      topologyRole: raw.topologyRole as "main_chain" | "cross_chain",
      directionRationale: raw.directionRationale,
      themeRelevanceRationale: raw.themeRelevanceRationale,
      boundaryRationale: raw.boundaryRationale,
      recommendation,
      ...decision,
      evidenceRefs,
      coverageGaps: raw.coverageGaps as string[],
    });
    relationFingerprints.add(semanticFingerprint);
    relationCandidateIds.add(raw.candidateId as string);
    candidateIds.add(raw.candidateId as string);
  }
  for (const edges of includedEdgesByType.values()) checkAcyclic(edges);
  if (!Array.isArray(output.coverageGaps) || output.coverageGaps.length > THEME_FRAMEWORK_BOUNDS.maxGaps) fail("coverage_gaps_invalid", "coverageGaps");
  const coverageGaps: ThemeFrameworkCoverageGap[] = [];
  const gapIds = new Set<string>();
  for (const [index, raw] of output.coverageGaps.entries()) {
    const path = `coverageGaps.${index}`;
    if (!object(raw)) fail("coverage_gap_invalid", path);
    exactKeys(raw, ["gapId", "question", "reason", "affectedCandidateIds"], [], path);
    if (!ID.test(String(raw.gapId)) || gapIds.has(String(raw.gapId)) || !boundedText(raw.question, 500) || !boundedText(raw.reason, 1000) || !stringArray(raw.affectedCandidateIds, THEME_FRAMEWORK_BOUNDS.maxIndustries + THEME_FRAMEWORK_BOUNDS.maxRelations, 80)) fail("coverage_gap_invalid", path);
    if (raw.affectedCandidateIds.some((id) => !candidateIds.has(id))) fail("coverage_gap_candidate_unknown", path);
    coverageGaps.push({ gapId: raw.gapId as string, question: raw.question, reason: raw.reason, affectedCandidateIds: raw.affectedCandidateIds });
    gapIds.add(raw.gapId as string);
  }
  return {
    proposedDefinition: { statement: output.proposedDefinition.statement, status: output.proposedDefinition.status as "supported" | "provisional", evidenceRefs: definitionEvidence },
    inclusionPrinciples: output.inclusionPrinciples as string[],
    exclusionPrinciples: output.exclusionPrinciples as string[],
    industryCandidates: candidates,
    relationCandidates,
    coverageGaps,
  };
}

export function createThemeFrameworkOutputContract(input: ThemeFrameworkInput) {
  const evidenceRefs = {
    type: "array",
    minItems: 0,
    maxItems: THEME_FRAMEWORK_BOUNDS.maxEvidenceRefs,
    uniqueItems: true,
    items: input.evidence.length ? { enum: input.evidence.map((item) => item.evidenceId) } : { enum: [] },
  };
  const textValue = (maxLength: number) => ({ type: "string", minLength: 1, maxLength });
  const candidateId = { type: "string", pattern: "^[A-Za-z][A-Za-z0-9._-]{0,79}$" };
  const recommendation = { enum: [...THEME_FRAMEWORK_RECOMMENDATIONS] };
  const decisionChange = { enum: ["new", "unchanged", "reopen"] };
  const coverageGapList = { type: "array", maxItems: 8, uniqueItems: true, items: textValue(500) };
  const decisionOptionals = {
    priorDecisionId: candidateId,
    reopenEvidenceRefs: evidenceRefs,
  };
  const industryCandidate = {
    type: "object",
    additionalProperties: false,
    required: ["candidateId", "name", "description", "independentlyResearchableRationale", "themeRelevanceRationale", "boundaryRationale", "recommendation", "decisionChange", "evidenceRefs", "coverageGaps"],
    properties: {
      candidateId,
      existingIndustryRef: { enum: input.existingKnowledge.industries.map((industry) => industry.ref) },
      name: textValue(300),
      description: textValue(THEME_FRAMEWORK_BOUNDS.maxString),
      independentlyResearchableRationale: textValue(1000),
      themeRelevanceRationale: textValue(1000),
      boundaryRationale: textValue(1000),
      recommendation,
      decisionChange,
      priorDecisionId: decisionOptionals.priorDecisionId,
      reopenEvidenceRefs: decisionOptionals.reopenEvidenceRefs,
      evidenceRefs,
      coverageGaps: coverageGapList,
    },
  };
  const relationCandidate = {
    type: "object",
    additionalProperties: false,
    required: ["candidateId", "sourceIndustryRef", "targetIndustryRef", "relationType", "topologyRole", "directionRationale", "themeRelevanceRationale", "boundaryRationale", "recommendation", "decisionChange", "evidenceRefs", "coverageGaps"],
    properties: {
      candidateId,
      sourceIndustryRef: { type: "string", minLength: 1, maxLength: 200 },
      targetIndustryRef: { type: "string", minLength: 1, maxLength: 200 },
      relationType: { enum: ["upstream_of", "depends_on"] },
      topologyRole: { enum: ["main_chain", "cross_chain"] },
      directionRationale: textValue(1000),
      themeRelevanceRationale: textValue(1000),
      boundaryRationale: textValue(1000),
      recommendation,
      decisionChange,
      priorDecisionId: decisionOptionals.priorDecisionId,
      reopenEvidenceRefs: decisionOptionals.reopenEvidenceRefs,
      evidenceRefs,
      coverageGaps: coverageGapList,
    },
  };
  return {
    name: "ThemeFrameworkResult",
    type: "object",
    additionalProperties: false,
    required: ["proposedDefinition", "inclusionPrinciples", "exclusionPrinciples", "industryCandidates", "relationCandidates", "coverageGaps"],
    bounds: THEME_FRAMEWORK_BOUNDS,
    properties: {
      proposedDefinition: {
        type: "object", additionalProperties: false, required: ["statement", "status", "evidenceRefs"],
        properties: { statement: textValue(THEME_FRAMEWORK_BOUNDS.maxDefinition), status: { enum: ["supported", "provisional"] }, evidenceRefs },
      },
      inclusionPrinciples: { type: "array", maxItems: 16, uniqueItems: true, items: textValue(500) },
      exclusionPrinciples: { type: "array", maxItems: 16, uniqueItems: true, items: textValue(500) },
      industryCandidates: { type: "array", maxItems: THEME_FRAMEWORK_BOUNDS.maxIndustries, items: industryCandidate },
      relationCandidates: { type: "array", maxItems: THEME_FRAMEWORK_BOUNDS.maxRelations, items: relationCandidate },
      coverageGaps: {
        type: "array", maxItems: THEME_FRAMEWORK_BOUNDS.maxGaps,
        items: { type: "object", additionalProperties: false, required: ["gapId", "question", "reason", "affectedCandidateIds"], properties: { gapId: candidateId, question: textValue(500), reason: textValue(1000), affectedCandidateIds: { type: "array", maxItems: THEME_FRAMEWORK_BOUNDS.maxIndustries + THEME_FRAMEWORK_BOUNDS.maxRelations, uniqueItems: true, items: candidateId } } },
      },
    },
  };
}
