import type { ReasoningExecutor } from "../../plugins/reasoning/contracts.ts";
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
  return "theme_framework_semantic_failed";
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
          : "Build a bounded, evidence-grounded Theme Framework candidate result. Choose independently researchable Industry activities at a consistent granularity. Decide Theme relevance separately from whether an economic relationship is true. Use only the provided evidence refs and existing Industry refs. Mark uncertainty pending. Preserve true cross-chain edges, allow related standalone infrastructure nodes, and do not add edges merely to connect every node. For upstream_of, sourceIndustryRef is upstream and targetIndustryRef downstream; for depends_on, sourceIndustryRef is the dependent activity and targetIndustryRef its dependency. Do not use fixed-hop expansion. Do not create canonical IDs, invoke another Skill, or write Knowledge. Return one strict JSON object.",
        input: repair
          ? {
              context: boundedInput(input),
              previousOutput: boundedPreviousOutput(firstOutput),
              diagnostic: priorDiagnostic,
            }
          : boundedInput(input),
        outputContract: createThemeFrameworkOutputContract(input),
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
