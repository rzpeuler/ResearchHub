// @ts-nocheck
import type {
  ReasoningExecutor,
  ReasoningOperation,
} from "../../plugins/reasoning/contracts.ts";
import type { SemanticProductionProposal } from "../../knowledge/production/contracts.ts";
import { isSupportedBaseCurrencyCodeV1 } from "../../knowledge/schema/competition-module-v04.ts";
import type { IndustryObservationPoint } from "../../data/industry-observations.ts";
import {
  INDUSTRY_MODULES,
  INDUSTRY_CLAIM_TYPES,
  INDUSTRY_STRUCTURED_VALUE_COMPARATORS,
  INDUSTRY_RESEARCH_DESIGN_CONTRACT,
  createIndustryModuleResultContract,
  createIndustrySynthesisContract,
  type CrossModuleSynthesis,
  type IndustryModuleResult,
  type IndustryCompetitionTable,
  type IndustryResearchModule,
  type IndustryResearchSkillInput,
  type LocalReportMaterial,
  type ResearchDesign,
  type ResearchGap,
  isValidIndustryStructuredValue,
  isValidIndustryLocalId,
} from "./contracts.ts";
type R = Record<string, unknown>;
const obj = (v: unknown): v is R =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): v is string =>
  typeof v === "string" && v.trim() !== "";
const arr = (v: unknown): v is readonly unknown[] => Array.isArray(v);
const uniq = (v: unknown): v is readonly string[] =>
  arr(v) && v.every(text) && new Set(v).size === v.length;
const local = (v: unknown): v is string =>
  isValidIndustryLocalId(v);
const finite = (v: unknown) =>
  typeof v === "number"
    ? Number.isFinite(v)
    : typeof v === "string"
      ? v.trim() !== ""
      : typeof v === "boolean";
export type IndustryDiagnosticCode =
  | "target_diagnosis_invalid"
  | "scope_invalid"
  | "module_question_set_invalid"
  | "module_question_value_invalid"
  | "key_metrics_invalid"
  | "evidence_requirements_invalid"
  | "search_terms_invalid"
  | "known_gap_invalid"
  | "verification_candidate_invalid"
  | "module_shape_invalid"
  | "module_evidence_invalid"
  | "proposal_invalid"
  | "report_material_invalid"
  | "synthesis_shape_invalid"
  | "synthesis_evidence_invalid"
  | "synthesis_proposal_collision";
export class IndustryValidationError extends Error {
  constructor(
    readonly code: IndustryDiagnosticCode,
    message: string,
  ) {
    super(message);
    this.name = "IndustryValidationError";
  }
}
const fail = (code: IndustryDiagnosticCode, message: string): never => {
  throw new IndustryValidationError(code, message);
};
const boundedText = (v: unknown, max: number) => text(v) && v.length <= max;
const boundedArray = (v: unknown, max: number, min = 0) =>
  arr(v) && v.length >= min && v.length <= max;
export function validateIndustryResearchDesign(v: unknown): ResearchDesign {
  if (
    !obj(v) ||
    !boundedText(v.definitionHypothesis, 1200) ||
    !["industry", "theme", "product", "technology", "uncertain"].includes(
      String(v.targetKind),
    )
  )
    fail(
      "target_diagnosis_invalid",
      "Invalid Industry Research Design target diagnosis",
    );
  if (
    !obj(v.scope) ||
    !boundedArray(v.scope.included, 32) ||
    !boundedArray(v.scope.excluded, 32) ||
    v.scope.included.some((x) => !boundedText(x, 2000)) ||
    v.scope.excluded.some((x) => !boundedText(x, 2000))
  )
    fail("scope_invalid", "Invalid Industry Research Design scope");
  const questions = obj(v.moduleQuestions) ? v.moduleQuestions : {};
  if (
    !obj(v.moduleQuestions) ||
    Object.keys(questions).some(
      (k) => !INDUSTRY_MODULES.includes(k as IndustryResearchModule),
    ) ||
    INDUSTRY_MODULES.some((m) => !(m in questions))
  )
    fail(
      "module_question_set_invalid",
      "Research Design must contain all eight module questions",
    );
  if (INDUSTRY_MODULES.some((m) => !boundedText(questions[m], 800)))
    fail(
      "module_question_value_invalid",
      "Research Design module question must be a bounded non-empty string",
    );
  for (const k of [
    "keyMetrics",
    "evidenceRequirements",
    "searchTerms",
  ] as const)
    if (
      !uniq(v[k]) ||
      !(v[k] as unknown[]).length ||
      (v[k] as unknown[]).length > 32 ||
      (v[k] as unknown[]).some((x) => x.length > 2000)
    )
      fail(
        `${k === "keyMetrics" ? "key_metrics" : k === "evidenceRequirements" ? "evidence_requirements" : "search_terms"}_invalid` as IndustryDiagnosticCode,
        `Research Design ${k} must be a non-empty string array`,
      );
  if (!boundedArray(v.knownGaps, 16))
    fail(
      "known_gap_invalid",
      "Research Design knownGaps must be a bounded array",
    );
  const gs = new Set<string>();
  for (const g of v.knownGaps) {
    if (
      !obj(g) ||
      !local(g.gapId) ||
      gs.has(String(g.gapId)) ||
      !INDUSTRY_MODULES.includes(g.module as IndustryResearchModule) ||
      !boundedText(g.question, 500) ||
      !boundedText(g.reason, 1000) ||
      typeof g.actionable !== "boolean" ||
      (g.searchTerms !== undefined &&
        (!uniq(g.searchTerms) ||
          (g.searchTerms as readonly string[]).length > 32 ||
          (g.searchTerms as readonly string[]).some((x) => x.length > 2000)))
    )
      fail("known_gap_invalid", "Invalid Research Design known gap");
    gs.add(String(g.gapId));
  }
  if (
    !boundedArray(v.verificationCandidates, 16) ||
    v.verificationCandidates.some(
      (c) =>
        !obj(c) ||
        !boundedText(c.name, 300) ||
        !["product", "technology", "industry", "company"].includes(
          String(c.kind),
        ) ||
        !boundedText(c.reason, 1000),
    )
  )
    fail("verification_candidate_invalid", "Invalid verification candidate");
  return v as unknown as ResearchDesign;
}
function proposal(
  v: unknown,
  ev: Set<string>,
  seen: Set<string>,
): SemanticProductionProposal {
  if (
    !obj(v) ||
    !local(v.proposalId) ||
    seen.has(v.proposalId)
  )
    fail(
      "proposal_invalid",
      "Proposal contains canonical-looking identifier or duplicate local ID",
    );
  if (
    !["entity", "relation", "claim"].includes(String(v.kind)) ||
    !local(v.subjectKey) ||
    (v.targetKey !== undefined && !local(v.targetKey))
  )
    fail(
      "proposal_invalid",
      "Proposal contains canonical-looking identifier or invalid local ID",
    );
  if (
    v.kind === "entity" &&
    (!["industry", "product", "technology", "company"].includes(
      String(v.entityType),
    ) ||
      !text(v.entityName))
  )
    fail("proposal_invalid", "Unsupported Entity proposal");
  if (v.kind === "entity" && v.structuredValue !== undefined) {
    const identity = v.structuredValue;
    if (!obj(identity) || Object.keys(identity).some((key) => !["ticker", "exchange", "aliases"].includes(key)) ||
      (identity.ticker !== undefined && !boundedText(identity.ticker, 32)) ||
      (identity.exchange !== undefined && !boundedText(identity.exchange, 32)) ||
      (identity.aliases !== undefined && (!uniq(identity.aliases) || identity.aliases.length > 16 || identity.aliases.some((alias) => alias.length > 300))))
      fail("proposal_invalid", "Entity identity fields must use the bounded ticker, exchange, and aliases contract");
  }
  if (v.kind === "relation" && (!text(v.relationType) || !text(v.targetKey)))
    fail("proposal_invalid", "Invalid Relation proposal");
  if (
    v.kind === "claim" &&
    (!INDUSTRY_CLAIM_TYPES.includes(v.claimType as any) || !text(v.statement))
  )
    fail("proposal_invalid", "Invalid Claim proposal");
  if (
    v.sourceCandidateIds !== undefined &&
    (!uniq(v.sourceCandidateIds) ||
      v.sourceCandidateIds.some((x) => !ev.has(x)))
  )
    fail("module_evidence_invalid", "Proposal references unknown evidence");
  if (
    v.existingKnowledgeRefs !== undefined ||
    ["update", "supersede", "contradict", "review"].includes(
      String(v.resolution),
    )
  )
    fail(
      "proposal_invalid",
      "Industry Skill cannot own canonical resolution or existing-Knowledge references",
    );
  for (const k of [
    "supportsProposalIds",
    "dependsOnProposalIds",
    "contradictsProposalIds",
  ] as const)
    if (v[k] !== undefined && (!uniq(v[k]) || v[k].some((x) => !local(x))))
      fail("proposal_invalid", "Proposal contains invalid local link");
  if (v.kind === "claim" && v.structuredValue != null) {
    if (!isValidIndustryStructuredValue(v.structuredValue))
      fail("proposal_invalid", "Malformed quantitative structured value");
  }
  seen.add(v.proposalId);
  return v as unknown as SemanticProductionProposal;
}
function gapList(v: unknown, module?: IndustryResearchModule): ResearchGap[] {
  if (!arr(v) || v.length > 16)
    fail("module_shape_invalid", "gaps must be a bounded array");
  const s = new Set<string>();
  return v.map((g) => {
    if (
      !obj(g) ||
      !local(g.gapId) ||
      s.has(String(g.gapId)) ||
      (module !== undefined && g.module !== module) ||
      !INDUSTRY_MODULES.includes(g.module as IndustryResearchModule) ||
      !text(g.question) ||
      !text(g.reason) ||
      typeof g.actionable !== "boolean" ||
      (g.searchTerms !== undefined &&
        (!uniq(g.searchTerms) ||
          (g.searchTerms as readonly string[]).length > 32))
    )
      fail("module_shape_invalid", "Invalid Research Gap");
    s.add(String(g.gapId));
    return g as unknown as ResearchGap;
  });
}
function material(
  v: unknown,
  ev: Set<string>,
  ps: Set<string>,
  rs: Set<string>,
): LocalReportMaterial {
  if (
    !obj(v) ||
    !text(v.markdown) ||
    v.markdown.length > 6000 ||
    !uniq(v.evidenceIds) ||
    v.evidenceIds.some((x) => !ev.has(x)) ||
    !uniq(v.proposalIds) ||
    v.proposalIds.some((x) => !ps.has(x)) ||
    (v.reportOnly !== undefined && typeof v.reportOnly !== "boolean") ||
    (v.relationProposalIds !== undefined &&
      (!uniq(v.relationProposalIds) ||
        v.relationProposalIds.some((x) => !rs.has(x))))
  )
    fail("report_material_invalid", "Invalid local report material");
  return v as unknown as LocalReportMaterial;
}
function links(
  ps: readonly SemanticProductionProposal[],
  allowed: Set<string>,
) {
  for (const p of ps)
    for (const k of [
      "supportsProposalIds",
      "dependsOnProposalIds",
      "contradictsProposalIds",
    ] as const)
      if ((p[k] ?? []).some((x) => x === p.proposalId || !allowed.has(x)))
        fail("proposal_invalid", "Proposal contains unresolved local link");
}
export function validateIndustryModuleResult(
  v: unknown,
  module: IndustryResearchModule,
  supplied: readonly string[],
): IndustryModuleResult {
  if (
    !obj(v) ||
    v.module !== module ||
    !["supported", "partial", "unavailable"].includes(String(v.status)) ||
    !boundedText(v.analysis, 6000) ||
    !uniq(v.evidenceIds) ||
    v.evidenceIds.some((x) => !supplied.includes(x)) ||
    !arr(v.proposals) ||
    v.proposals.length > 24
  )
    fail(
      "module_shape_invalid",
      "Invalid bounded module result or evidence escape",
    );
  const ev = new Set(supplied),
    seen = new Set<string>(),
    ps = v.proposals.map((x) => proposal(x, ev, seen));
  links(ps, seen);
  const ids = new Set(ps.map((x) => x.proposalId)),
    rs = new Set(
      ps.filter((x) => x.kind === "relation").map((x) => x.proposalId),
    );
  const competitionTable = module === "competitive_landscape"
    ? validateCompetitionTable(v.competitionTable, ids, ps)
    : undefined;
  return {
    module,
    status: v.status as IndustryModuleResult["status"],
    analysis: v.analysis,
    evidenceIds: v.evidenceIds as string[],
    proposals: ps,
    gaps: gapList(v.gaps, module),
    reportMaterial: material(v.reportMaterial, ev, ids, rs),
    ...(competitionTable ? { competitionTable } : {}),
  };
}

const competitionDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
function validateCompetitionTable(value: unknown, proposalIds: Set<string>, proposals: readonly SemanticProductionProposal[]): IndustryCompetitionTable {
  if (!obj(value) || Object.keys(value).some((key) => !["columns", "rows"].includes(key)) || !arr(value.columns) || value.columns.length < 4 || value.columns.length > 7 || !arr(value.rows) || value.rows.length > 40)
    fail("module_shape_invalid", "Invalid competitive landscape table bounds");
  const columns = value.columns as readonly R[];
  const requiredRoles = ["company", "main_products", "market_cap", "annual_revenue"];
  const ids = new Set<string>(), labels = new Set<string>(), roles = new Set<string>();
  for (const column of columns) {
    if (!obj(column) || Object.keys(column).some((key) => !["id", "label", "role", "customRole"].includes(key)) || !local(column.id) || column.id.length > 64 || !boundedText(column.label, 128) || ids.has(String(column.id)) || labels.has(String(column.label).trim().toLocaleLowerCase()) || ![...requiredRoles, "custom"].includes(String(column.role)))
      fail("module_shape_invalid", "Invalid or duplicate competition table column");
    if (column.role === "custom" ? !local(column.customRole) || String(column.customRole).length > 64 : column.customRole !== undefined)
      fail("module_shape_invalid", "Invalid custom competition table role");
    if (roles.has(String(column.role)) && column.role !== "custom") fail("module_shape_invalid", "Competition table role must be unique");
    ids.add(String(column.id)); labels.add(String(column.label).trim().toLocaleLowerCase()); roles.add(String(column.role));
  }
  if (requiredRoles.some((role) => !roles.has(role))) fail("module_shape_invalid", "Competition table must contain company, main_products, market_cap, and annual_revenue columns");
  const nonCompanyColumns = columns.filter((column) => column.role !== "company");
  const companies = new Set<string>();
  const rows = value.rows.map((row): IndustryCompetitionTable["rows"][number] => {
    if (!obj(row) || Object.keys(row).some((key) => !["companyKey", "businessExposureProposalId", "cells"].includes(key)) || !local(row.companyKey) || !local(row.businessExposureProposalId) || !arr(row.cells) || row.cells.length > 6 || companies.has(String(row.companyKey)))
      fail("module_shape_invalid", "Invalid or duplicate competition table row");
    companies.add(String(row.companyKey));
    const company = proposals.find((proposal) => proposal.proposalId === row.companyKey);
    const exposure = proposals.find((proposal) => proposal.proposalId === row.businessExposureProposalId);
    if (!company || company.kind !== "entity" || company.entityType !== "company" || !obj(company.structuredValue) || !text(company.structuredValue.ticker) || !text(company.structuredValue.exchange) || !company.sourceCandidateIds?.length || !exposure || exposure.kind !== "relation" || exposure.relationType !== "business_exposure" || exposure.subjectKey !== company.subjectKey)
      fail("module_shape_invalid", "Competition row must bind a proposed Company and its business_exposure Relation");
    const sourceCells = new Map<string, R>();
    for (const cell of row.cells) {
      if (!obj(cell) || !local(cell.columnId) || sourceCells.has(cell.columnId)) fail("module_shape_invalid", "Competition row cells must have unique local column IDs");
      sourceCells.set(cell.columnId, cell);
    }
    const cellKeys = [...sourceCells.keys()];
    if (cellKeys.length !== nonCompanyColumns.length || cellKeys.some((key) => !nonCompanyColumns.some((column) => column.id === key)))
      fail("module_shape_invalid", "Competition row must have exactly one cell for every non-company column");
    const cells: R = {};
    for (const column of nonCompanyColumns) {
      const sourceCell = sourceCells.get(column.id);
      if (!sourceCell) fail("module_shape_invalid", "Competition row is missing a cell for a declared column");
      const { columnId: _columnId, ...cell } = sourceCell;
      if (!obj(cell)) fail("module_shape_invalid", "Competition cell must be an object");
      if (cell.status === "unavailable" || cell.status === "not_comparable") {
        if (Object.keys(cell).some((key) => !["status", "reason"].includes(key)) || !boundedText(cell.reason, 1024)) fail("module_shape_invalid", "Unavailable competition cell requires a bounded reason");
        cells[String(column.id)] = cell as IndustryCompetitionTable["rows"][number]["cells"][string];
        continue;
      }
      const allowed = ["status", "displayValue", "knowledgeProposalIds", ...(column.role === "market_cap" ? ["asOf", "unit", "currency"] : []), ...(column.role === "annual_revenue" ? ["fiscalYear", "unit", "currency"] : [])];
      if (cell.status !== "available" || Object.keys(cell).some((key) => !allowed.includes(key)) || !boundedText(cell.displayValue, 2048) || !uniq(cell.knowledgeProposalIds) || !cell.knowledgeProposalIds.length || cell.knowledgeProposalIds.some((id) => !proposalIds.has(id))) fail("module_shape_invalid", "Available competition cell requires supported local knowledge proposal IDs");
      if (column.role === "market_cap" && (!competitionDate(cell.asOf) || !boundedText(cell.unit, 32) || !isSupportedBaseCurrencyCodeV1(cell.currency) || cell.unit !== cell.currency)) fail("module_shape_invalid", "Market capitalization cell requires a verified date and matching supported ISO currency unit");
      if (column.role === "annual_revenue" && (!Number.isInteger(cell.fiscalYear) || (cell.fiscalYear as number) < 1900 || (cell.fiscalYear as number) > 9999 || !boundedText(cell.unit, 32) || !isSupportedBaseCurrencyCodeV1(cell.currency) || cell.unit !== cell.currency)) fail("module_shape_invalid", "Annual revenue cell requires fiscal year and matching supported ISO currency unit");
      for (const proposalId of cell.knowledgeProposalIds) {
        const referenced = proposals.find((proposal) => proposal.proposalId === proposalId);
        if (!referenced || !["claim", "relation"].includes(referenced.kind)) fail("module_shape_invalid", "Competition cells may reference only Claim or Relation proposals");
        if ((column.role === "market_cap" || column.role === "annual_revenue") && (referenced.kind !== "claim" || referenced.structuredValue?.metric !== (column.role === "market_cap" ? "metric:market_cap" : "metric:revenue"))) fail("module_shape_invalid", "Numeric competition cells must reference the matching structured market_cap or revenue Claim");
        if ((column.role === "market_cap" || column.role === "annual_revenue") && referenced.kind === "claim" && String(referenced.structuredValue?.value) !== cell.displayValue) fail("module_shape_invalid", "Numeric competition cell displayValue must exactly match its cited Claim value");
      }
      cells[String(column.id)] = cell as IndustryCompetitionTable["rows"][number]["cells"][string];
    }
    return { companyKey: row.companyKey, businessExposureProposalId: row.businessExposureProposalId, cells };
  });
  return { columns: columns as IndustryCompetitionTable["columns"], rows };
}

function validateIndustryModuleResultWithProposalIsolation(
  v: unknown,
  module: IndustryResearchModule,
  supplied: readonly string[],
): IndustryModuleResult {
  if (
    !obj(v) ||
    v.module !== module ||
    !["supported", "partial", "unavailable"].includes(String(v.status)) ||
    !boundedText(v.analysis, 6000) ||
    !uniq(v.evidenceIds) ||
    v.evidenceIds.some((x) => !supplied.includes(x)) ||
    !arr(v.proposals) ||
    v.proposals.length > 24
  )
    fail(
      "module_shape_invalid",
      "Invalid bounded module result or evidence escape",
    );

  const ev = new Set(supplied);
  const ps: SemanticProductionProposal[] = [];
  const seen = new Set<string>();
  for (const candidate of v.proposals) {
    try {
      ps.push(proposal(candidate, ev, seen));
    } catch (error) {
      if (
        !(
          error instanceof IndustryValidationError &&
          error.code === "proposal_invalid" &&
          !/canonical|quantitative|resolution/i.test(error.message)
        )
      )
        throw error;
      // Quarantine only the malformed candidate. Evidence and narrative remain
      // subject to the same strict validation as the normal path.
    }
  }
  const ids = new Set(ps.map((item) => item.proposalId));
  const relationIds = new Set(
    ps
      .filter((item) => item.kind === "relation")
      .map((item) => item.proposalId),
  );
  const linkKeys = [
    "supportsProposalIds",
    "dependsOnProposalIds",
    "contradictsProposalIds",
  ] as const;
  const normalized = ps.map((item) => ({
    ...item,
    ...Object.fromEntries(
      linkKeys.map((key) => [
        key,
        (item[key] ?? []).filter(
          (id) => id !== item.proposalId && ids.has(id),
        ),
      ]),
    ),
  }));
  const report = obj(v.reportMaterial)
    ? {
        ...v.reportMaterial,
        proposalIds: arr(v.reportMaterial.proposalIds)
          ? v.reportMaterial.proposalIds.filter((id) => ids.has(id))
          : v.reportMaterial.proposalIds,
        relationProposalIds: arr(v.reportMaterial.relationProposalIds)
          ? v.reportMaterial.relationProposalIds.filter((id) =>
              relationIds.has(id),
            )
          : v.reportMaterial.relationProposalIds,
      }
    : v.reportMaterial;
  return validateIndustryModuleResult(
    { ...v, proposals: normalized, reportMaterial: report },
    module,
    supplied,
  );
}
export function validateCrossModuleSynthesis(
  v: unknown,
  supplied: readonly string[],
  moduleIds: readonly string[],
  moduleRelationIds: readonly string[] = [],
): CrossModuleSynthesis {
  if (
    !obj(v) ||
    !boundedText(v.executiveView, 3000) ||
    !boundedText(v.analysis, 6000) ||
    !uniq(v.evidenceIds) ||
    v.evidenceIds.some((x) => !supplied.includes(x)) ||
    !arr(v.proposals) ||
    v.proposals.length > 24 ||
    !uniq(v.alternativeViews) ||
    v.alternativeViews.length > 6 ||
    v.alternativeViews.some((x) => x.length > 1200)
  )
    fail("synthesis_shape_invalid", "Invalid cross-module synthesis evidence");
  const proposedIds = new Set<string>();
  for (const candidate of v.proposals) {
    const id = obj(candidate) ? candidate.proposalId : undefined;
    if (typeof id === "string" && (moduleIds.includes(id) || proposedIds.has(id)))
      fail(
        "synthesis_proposal_collision",
        "Synthesis proposal ID collides with an existing or same-response proposal",
      );
    if (typeof id === "string") proposedIds.add(id);
  }
  const ev = new Set(supplied),
    seen = new Set(moduleIds),
    ps = v.proposals.map((x) => proposal(x, ev, seen));
  links(ps, seen);
  const rs = new Set([
      ...moduleRelationIds,
      ...ps.filter((p) => p.kind === "relation").map((p) => p.proposalId),
    ]),
    all = new Set([...moduleIds, ...ps.map((p) => p.proposalId)]);
  return {
    executiveView: v.executiveView,
    analysis: v.analysis,
    evidenceIds: v.evidenceIds as string[],
    proposals: ps,
    gaps: gapList(v.gaps),
    alternativeViews: v.alternativeViews as string[],
    reportMaterial: material(v.reportMaterial, ev, all, rs),
  };
}
export function parseIndustryReasoningObject(
  x: unknown,
): Record<string, unknown> {
  let v = x;
  for (let i = 0; i < 3; i++) {
    if (typeof v === "string") {
      try {
        v = JSON.parse(v);
      } catch {
        throw new Error("Industry semantic output is not JSON");
      }
    }
    if (!obj(v))
      throw new Error("Industry semantic output must be a JSON object");
    const record = v as R;
    const k = ["result", "output", "data", "structuredOutput", "response"].find(
      (key) => Object.keys(record).length === 1 && key in record,
    );
    if (!k) return record;
    v = record[k];
  }
  throw new Error("Industry semantic output wrapper depth exceeded");
}
const unwrap = parseIndustryReasoningObject;
function boundedJson(value: unknown, depth = 0): unknown {
  if (depth > 3) return "[bounded]";
  if (typeof value === "string") return value.slice(0, 2000);
  if (Array.isArray(value))
    return value
      .slice(0, depth === 0 ? 80 : 32)
      .map((x) => boundedJson(x, depth + 1));
  if (obj(value))
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 32)
        .map(([k, v]) => [k.slice(0, 120), boundedJson(v, depth + 1)]),
    );
  return value;
}
function knowledge(k: readonly unknown[]) {
  return boundedJson(k.slice(0, 80));
}
const moduleExcerptTerms: Readonly<Record<string, readonly string[]>> = {
  industry_definition: ["定义", "范围", "规范", "标准", "definition", "scope"],
  market_size_growth: ["市场", "营收", "产值", "增长", "收入", "revenue", "growth", "market"],
  supply_demand_analysis: ["产能", "利用率", "需求", "供需", "库存", "价格", "capacity", "utilization", "demand", "supply", "pricing"],
  industry_chain_analysis: ["产业链", "上游", "下游", "材料", "设备", "制程", "供应链", "process", "upstream", "downstream", "supply chain"],
  competitive_landscape: ["企业", "竞争", "排名", "份额", "营收", "客户", "competitor", "market share"],
  technology_evolution: ["技术", "工艺", "制程", "AI", "HDI", "材料", "设备", "技术路线", "technology", "process"],
  company_mapping: ["深南电路", "沪电股份", "鹏鼎科技", "生益科技", "企业", "公司", "主营", "company", "business"],
  risk_analysis: ["风险", "政策", "贸易", "环保", "产能", "利润", "margin", "risk", "regulation"],
  synthesis: ["市场", "产能", "需求", "产业链", "企业", "技术", "风险", "market", "capacity", "demand", "company", "technology", "risk"],
};
function excerptFor(value: string, module?: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= 2400) return compact;

  const pieces = [compact.slice(0, 600)];
  const lower = compact.toLocaleLowerCase();
  const terms = moduleExcerptTerms[module ?? "synthesis"] ?? moduleExcerptTerms.synthesis;
  let windows = 0;
  for (const term of terms) {
    if (windows >= 2) break;
    const needle = term.toLocaleLowerCase();
    let from = 600;
    while (from < lower.length - 300) {
      const index = lower.indexOf(needle, from);
      if (index < 0) break;
      const start = Math.max(600, index - 180);
      const end = Math.min(compact.length - 300, index + 420);
      const piece = compact.slice(start, end);
      if (piece && !pieces.includes(piece)) {
        pieces.push(piece);
        windows++;
        break;
      }
      from = index + needle.length;
    }
  }
  pieces.push(compact.slice(-300));
  const bounded = pieces.join("\n[… contextual excerpt …]\n");
  return bounded.length <= 2400 ? bounded : bounded.slice(0, 2400);
}
function evidence(
  es: readonly IndustryResearchSkillInput["evidence"][number][],
  module?: string,
): Array<{ evidenceId: string }> {
  return es.slice(0, 32).map((e) => ({
    evidenceId: e.evidenceId,
    title: e.source.title.slice(0, 300),
    publisher: e.source.publisher.slice(0, 300),
    provider: e.source.candidate.provider,
    sourceKind: e.source.candidate.kind,
    tier: e.source.candidate.tier,
    publishedAt: e.source.candidate.publishedAt,
    metadata: boundedJson(e.source.candidate.metadata),
    excerpt: excerptFor(e.excerpt ?? e.source.content, module),
  }));
}
export function industryObservationIdentity(observation: IndustryObservationPoint): string {
  return `observation:${observation.metricId}:${encodeURIComponent(observation.sourceIdentity)}:${observation.periodStart}:${observation.periodEnd}:${observation.periodBasis}`
}
function operatingObservationProjection(observations: readonly IndustryObservationPoint[] | undefined): readonly Record<string, unknown>[] {
  return (observations ?? []).slice(0, 12).sort((a, b) => industryObservationIdentity(a).localeCompare(industryObservationIdentity(b))).map((observation) => ({
    observationId: industryObservationIdentity(observation),
    semanticKey: industryObservationIdentity(observation),
    metricId: observation.metricId,
    value: observation.value,
    qualifier: observation.qualifier,
    unit: observation.canonicalUnit,
    period: { start: observation.periodStart, end: observation.periodEnd },
    periodBasis: observation.periodBasis,
    aggregation: observation.aggregation,
    geography: observation.geography,
    product: observation.product,
    segment: observation.segment,
    grade: observation.grade,
    sourceIdentity: observation.sourceIdentity,
    authority: observation.authority,
    publicationPit: observation.publicationPit,
    valueVersion: observation.valueVersion,
  }))
}
function observationPeriodTags(observation: IndustryObservationPoint): Set<string> {
  return new Set([observation.periodStart.slice(0, 4), observation.periodStart.slice(0, 7), observation.periodStart.slice(0, 10), `${observation.periodStart.slice(0, 4)}-${observation.frequency}`].filter(Boolean))
}
const observationComparatorByQualifier = {
  EXACT: 'eq',
  LOWER_BOUND: 'gte',
  UPPER_BOUND: 'lte',
} as const
export function observationBackedProposalIsDeterministic(proposal: SemanticProductionProposal, observations: readonly IndustryObservationPoint[]): boolean {
  const structured = proposal.structuredValue as Record<string, unknown> | undefined
  const semanticKey = typeof structured?.semanticKey === 'string' ? structured.semanticKey : undefined
  if (semanticKey === undefined || !semanticKey.startsWith('observation:')) return true
  const observation = observations.find((item) => semanticKey === industryObservationIdentity(item))
  if (!observation || structured?.metric !== observation.metricId || structured?.unit !== observation.canonicalUnit || structured?.value !== observation.value) return false
  const period = typeof structured.period === 'string' ? structured.period : typeof structured.fiscalPeriod === 'string' ? structured.fiscalPeriod : undefined
  if (period === undefined || !observationPeriodTags(observation).has(period)) return false
  const sourceIds = proposal.sourceCandidateIds ?? []
  if (!sourceIds.includes(observation.sourceIdentity) && !sourceIds.includes(`evidence-${observation.sourceIdentity}`)) return false
  const expectedComparator = observationComparatorByQualifier[observation.qualifier]
  return INDUSTRY_STRUCTURED_VALUE_COMPARATORS.includes(expectedComparator) && structured.comparator === expectedComparator
}
function enforceObservationClaims(result: IndustryModuleResult, observations: readonly IndustryObservationPoint[] | undefined): IndustryModuleResult {
  if (!observations?.length) return result
  const accepted = result.proposals.filter((proposal) => observationBackedProposalIsDeterministic(proposal, observations)).map((proposal) => {
    const structured = proposal.structuredValue as Record<string, unknown> | undefined
    const observation = typeof structured?.semanticKey === 'string' ? observations.find((item) => structured.semanticKey === industryObservationIdentity(item)) : undefined
    if (!observation || !proposal.sourceCandidateIds?.includes(observation.sourceIdentity)) return proposal
    return { ...proposal, sourceCandidateIds: proposal.sourceCandidateIds.map((id) => id === observation.sourceIdentity ? `evidence-${id}` : id) }
  })
  return accepted.length === result.proposals.length && accepted.every((proposal, index) => proposal === result.proposals[index]) ? result : { ...result, proposals: accepted }
}
const instruction = {
  design:
    "Return exactly the bounded IndustryResearchDesign object. Ontology: independently researchable economic/industrial-chain activity=industry; broad cross-industry concept=theme; commercial category/component=product; technical route/process/architecture=technology; insufficiently resolvable=uncertain. Use all eight exact module keys and the explicit property schemas. This is a plan only: no canonical IDs, Knowledge writes, unsupported numbers, or durable proposals.",
  module:
    "Return exactly the bounded IndustryModuleResult for the requested module. The contract fixes module to the requested module and exposes the exact evidence allowlist. Copy evidence IDs exactly; if empty, keep evidenceIds/proposals empty and use partial/unavailable plus explicit gaps. Use local IDs only; industry is the reserved root key. Relations use only frozen names. Claim/Relation candidates require direct evidence; quantitative claims require metric, finite value, unit, comparator and period or fiscalPeriod. Never invent unsupported numbers. Operating observations are code-owned numeric truth: do not mutate value, unit, qualifier, period, geography, product, or sourceCandidateId; do not average conflicts or derive a missing number. Observation-backed structured claims must use semanticKey observation:<observationId> and exactly match the supplied observation or be omitted. If a conclusion is useful for the report but not directly supported enough for a durable candidate, return no candidate for it and set reportMaterial.reportOnly=true. In industry_chain_analysis and company_mapping, prefer report-only material over inferred entities, relations, companies, or quantitative claims when the supplied evidence does not name and support them directly. For competitive_landscape, also produce competitionTable with 4-7 industry-specific columns including company, main_products, market_cap, and annual_revenue. Bind each row to a proposed Company and its evidence-backed business_exposure Relation; bind each available cell to existing local Claim or Relation proposal IDs. Market cap must cite a verified trading date, unit, and currency. Annual revenue must be from the latest verifiable annual report and include fiscalYear, unit, and currency. Missing or incomparable values must be blank by using unavailable/not_comparable plus a reason. The table must not introduce a fact that is absent from the bound proposals. supplier_of requires direct authoritative evidence. No canonical writes.",
  synthesis:
    "Return exactly the bounded CrossModuleSynthesis using only validated modules and supplied evidence. Copy evidence and existing proposal/Relation IDs only from the explicit allowlists; new IDs are local. Keep concrete gap and alternative-view item schemas bounded. No new facts, unsupported numbers, canonical IDs, resolution ownership, or Knowledge writes.",
};
export class IndustryResearchSkill {
  constructor(private readonly executor: ReasoningExecutor) {}
  private async call(
    op: ReasoningOperation,
    input: unknown,
    contract: unknown,
    repair = false,
    prior?: unknown,
    diagnostic?: unknown,
  ) {
    const context = repair
      ? ` Repair invocation: Prior: rejected candidate omitted. Diagnostics: ${JSON.stringify(diagnostic)}. Return a complete replacement without repeating private or source content.`
      : "";
    const text =
      op === "industry_research_design"
        ? instruction.design
        : op === "industry_module_analysis"
          ? `${instruction.module}${obj(input) && (input.module === "industry_chain_analysis" || input.module === "company_mapping") ? " This request is especially evidence-sensitive and must use report-only mode unless every proposed endpoint is explicitly named and the direct relationship is stated in the supplied excerpt: return status partial, copy the supplied evidence IDs, return proposals as an empty array, put the bounded explanation in reportMaterial.markdown, set reportMaterial.reportOnly=true, and add actionable gaps. Do not emit inferred Entity, Relation, Claim, company, chain-edge, or quantitative proposals; do not fill missing facts by inference." : ""}`
          : instruction.synthesis;
    return unwrap(
      (
        await this.executor.execute({
          operation: op,
          instruction: text + context,
          input,
          outputContract: contract,
        })
      ).output,
    );
  }
  async design(input: {
    target: IndustryResearchSkillInput["target"];
    existingKnowledge: readonly unknown[];
  }) {
    const inputBound = {
      target: input.target,
      existingKnowledge: knowledge(input.existingKnowledge),
    };
    let prior: unknown;
    try {
      prior = await this.call(
        "industry_research_design",
        inputBound,
        INDUSTRY_RESEARCH_DESIGN_CONTRACT,
      );
      return validateIndustryResearchDesign(prior);
    } catch (e) {
      const codes = [
        e instanceof IndustryValidationError ? e.code : "parser_failure",
      ];
      try {
        prior = await this.call(
          "industry_research_design",
          inputBound,
          INDUSTRY_RESEARCH_DESIGN_CONTRACT,
          true,
          prior,
          codes,
        );
        return validateIndustryResearchDesign(prior);
      } catch (second) {
        throw second;
      }
    }
  }
  async analyze(
    module: IndustryResearchModule,
    input: IndustryResearchSkillInput,
  ): Promise<IndustryModuleResult> {
    const ev = evidence(input.evidence, module),
      bound = {
        module,
        target: input.target,
        evidence: ev,
        operatingObservations: operatingObservationProjection(input.operatingObservations),
        existingKnowledge: knowledge(input.existingKnowledge),
        localReferences: input.localReferences.slice(0, 32),
      },
      contract = createIndustryModuleResultContract(
        module,
        ev.map((x) => x.evidenceId),
        input.localReferences.slice(0, 32),
      );
    let prior: unknown;
    try {
      prior = await this.call("industry_module_analysis", bound, contract);
      return enforceObservationClaims(validateIndustryModuleResult(prior, module, ev.map((x) => x.evidenceId)), input.operatingObservations);
    } catch (e) {
      let repaired: unknown;
      try {
        repaired = await this.call(
          "industry_module_analysis",
          bound,
          contract,
          true,
          prior,
          [e instanceof IndustryValidationError ? e.code : "parser_failure"],
        );
        return enforceObservationClaims(validateIndustryModuleResult(repaired, module, ev.map((x) => x.evidenceId)), input.operatingObservations);
      } catch (second) {
        try {
          const candidate = repaired ?? prior;
          if (
            !obj(candidate) ||
            !obj(candidate.reportMaterial) ||
            candidate.reportMaterial.reportOnly !== true
          )
            throw second;
          return validateIndustryModuleResultWithProposalIsolation(
            candidate,
            module,
            ev.map((x) => x.evidenceId),
          );
        } catch {
          return {
            module,
            status: "unavailable",
            analysis: "Module reasoning failed after one bounded repair attempt.",
            evidenceIds: [],
            proposals: [],
            gaps: [
              {
                gapId: `${module}-failure`,
                module,
                question: "What evidence is required?",
                reason:
                  second instanceof Error ? second.message : "validation failed",
                actionable: true,
              },
            ],
            reportMaterial: {
              markdown: "Module unavailable.",
              evidenceIds: [],
              proposalIds: [],
            },
          };
        }
      }
    }
  }
  async synthesize(input: {
    modules: readonly IndustryModuleResult[];
    evidence: readonly IndustryResearchSkillInput["evidence"][number][];
    operatingObservations?: readonly IndustryObservationPoint[];
    existingKnowledge?: readonly unknown[];
  }) {
    const bound = {
      modules: input.modules,
      evidence: evidence(input.evidence, "synthesis"),
      operatingObservations: operatingObservationProjection(input.operatingObservations),
      existingKnowledge: knowledge(input.existingKnowledge ?? []),
    };
    const ev = input.evidence.map((x) => x.evidenceId),
      ids = input.modules.flatMap((m) => m.proposals.map((p) => p.proposalId)),
      rels = input.modules.flatMap((m) =>
        m.proposals
          .filter((p) => p.kind === "relation")
          .map((p) => p.proposalId),
      ),
      contract = createIndustrySynthesisContract(ev, ids, rels);
    let prior: unknown;
    try {
      prior = await this.call(
        "industry_cross_module_synthesis",
        bound,
        contract,
      );
      return validateCrossModuleSynthesis(prior, ev, ids, rels);
    } catch (e) {
      return validateCrossModuleSynthesis(
        await this.call(
          "industry_cross_module_synthesis",
          bound,
          contract,
          true,
          prior,
          [e instanceof IndustryValidationError ? e.code : "parser_failure"],
        ),
        ev,
        ids,
        rels,
      );
    }
  }
}
