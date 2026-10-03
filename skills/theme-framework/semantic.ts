import type { ReasoningExecutor } from "../../plugins/reasoning/contracts.ts";
import { ReasoningExecutorError } from "../../plugins/reasoning/errors.ts";
import {
  createThemeFrameworkOutputContract,
  ThemeFrameworkValidationError,
  validateThemeFrameworkInput,
  validateThemeFrameworkResult,
  type ThemeFrameworkInput,
  type ThemeFrameworkResult,
} from "./contracts.ts";

export interface ThemeFrameworkTelemetry {
  readonly called: boolean;
  readonly validated: boolean;
  readonly fallbackUsed: boolean;
  readonly repairAttempts: number;
  readonly diagnostics: readonly string[];
}

export type ThemeFrameworkExecutionResult =
  | {
      readonly status: "complete";
      readonly result: ThemeFrameworkResult;
      readonly diagnostics: readonly [];
      readonly telemetry: ThemeFrameworkTelemetry;
    }
  | {
      readonly status: "blocked";
      readonly diagnostics: readonly string[];
      readonly telemetry: ThemeFrameworkTelemetry;
    };

function safeCode(error: unknown): string {
  if (error instanceof ThemeFrameworkValidationError) return error.code;
  if (error instanceof ReasoningExecutorError) return `executor_${error.code}`;
  return "theme_framework_semantic_failed";
}

function outputContract(input: ThemeFrameworkInput) {
  const contract = createThemeFrameworkOutputContract(input);
  const omitEmptyIndustryRefs = input.existingKnowledge.industries.length === 0;
  const noPriorDecisions = input.priorDecisions.length === 0;
  if (!omitEmptyIndustryRefs && !noPriorDecisions) return contract;

  const adaptCandidates = <T extends { items: { properties: Record<string, unknown> } }>(
    schema: T,
    omitProperties: readonly string[],
  ): T => {
    const itemProperties = { ...schema.items.properties };
    for (const property of omitProperties) delete itemProperties[property];
    if (noPriorDecisions) itemProperties.decisionChange = { enum: ["new"] };
    return { ...schema, items: { ...schema.items, properties: itemProperties } };
  };
  const industrySchema = contract.properties.industryCandidates;
  const relationSchema = contract.properties.relationCandidates;
  const industryOmissions = [
    ...(omitEmptyIndustryRefs ? ["existingIndustryRef"] : []),
    ...(noPriorDecisions ? ["priorDecisionId", "reopenEvidenceRefs"] : []),
  ];
  const relationOmissions = noPriorDecisions ? ["priorDecisionId", "reopenEvidenceRefs"] : [];
  // Empty allowlists cannot be represented by Codex's structured-output schema.
  // With no prior decisions, unchanged/reopen metadata is also impossible. Omit
  // those transport fields and narrow the enum; the deterministic validator
  // still checks every returned candidate against the complete input contract.
  return {
    ...contract,
    properties: {
      ...contract.properties,
      industryCandidates: adaptCandidates(industrySchema, industryOmissions),
      relationCandidates: adaptCandidates(relationSchema, relationOmissions),
    },
  };
}

function boundedInput(input: ThemeFrameworkInput): ThemeFrameworkInput {
  return {
    theme: input.theme,
    existingKnowledge: {
      summary: input.existingKnowledge.summary,
      industries: input.existingKnowledge.industries,
    },
    evidence: input.evidence,
    priorDecisions: input.priorDecisions,
  };
}

function boundedPreviousOutput(value: unknown): unknown {
  try {
    const serialized = JSON.stringify(value);
    return serialized.length <= 8_000
      ? value
      : `${serialized.slice(0, 8_000)}…[bounded]`;
  } catch {
    return "[unserializable_previous_output]";
  }
}

function telemetry(
  called: boolean,
  validated: boolean,
  fallbackUsed: boolean,
  repairAttempts: number,
  diagnostics: readonly string[],
): ThemeFrameworkTelemetry {
  return { called, validated, fallbackUsed, repairAttempts, diagnostics };
}

export async function executeThemeFramework(
  input: ThemeFrameworkInput,
  executor?: ReasoningExecutor,
): Promise<ThemeFrameworkExecutionResult> {
  try {
    validateThemeFrameworkInput(input);
  } catch (error) {
    const diagnostics = [safeCode(error)];
    return {
      status: "blocked",
      diagnostics,
      telemetry: telemetry(false, false, true, 0, diagnostics),
    };
  }
  if (!executor) {
    const diagnostics = ["reasoning_executor_missing"];
    return {
      status: "blocked",
      diagnostics,
      telemetry: telemetry(false, false, true, 0, diagnostics),
    };
  }

  let firstOutput: unknown;
  let priorDiagnostic = "theme_framework_output_invalid";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const repair = attempt === 1;
    try {
      const response = await executor.execute({
        operation: "theme_framework_semantic",
        instruction: repair
          ? `Repair the previous Theme Framework result. The deterministic validator reported ${priorDiagnostic}. Use only the supplied Theme, bounded Knowledge, evidence, and prior decision references. Fix malformed or unsupported output; do not invent evidence or relationships. Return one strict JSON object.`
          : [
              "Build a bounded, evidence-grounded Theme Framework candidate result. Choose independently researchable Industry activities at a consistent granularity.",
              "Deliberately assess important upstream and downstream activities, cross-chain connections, related but independently researchable infrastructure or service activities, and adjacent branches that may warrant exclusion.",
              "A cross-chain or standalone activity need not have an edge to the main chain; include a Relation only when supplied evidence supports the relationship and its direction.",
              "Decide Theme relevance separately from whether an economic relationship is true. Include and exclude recommendations must be supported by supplied evidence; never invent facts or edges to complete a chain.",
              "When a potentially relevant independent activity lacks direct evidence, you may return it as pending with empty evidenceRefs and a specific coverageGaps entry. State the unresolved question without presenting the activity or its relationships as established facts.",
              "Use only provided evidence refs and existing Industry refs. Mark uncertainty pending. For upstream_of, sourceIndustryRef is upstream and targetIndustryRef downstream; for depends_on, sourceIndustryRef is the dependent activity and targetIndustryRef its dependency.",
              "Do not use fixed-hop expansion. Do not create canonical IDs, invoke another Skill, or write Knowledge. Return one strict JSON object.",
            ].join(" "),
        input: repair
          ? {
              context: boundedInput(input),
              previousOutput: boundedPreviousOutput(firstOutput),
              diagnostic: priorDiagnostic,
            }
          : boundedInput(input),
        outputContract: outputContract(input),
      });
      if (!repair) firstOutput = response.output;
      const result = validateThemeFrameworkResult(response.output, input);
      return {
        status: "complete",
        result,
        diagnostics: [],
        telemetry: telemetry(true, true, false, attempt, []),
      };
    } catch (error) {
      priorDiagnostic = safeCode(error);
    }
  }
  const diagnostics = [priorDiagnostic];
  return {
    status: "blocked",
    diagnostics,
    telemetry: telemetry(true, false, true, 1, diagnostics),
  };
}
