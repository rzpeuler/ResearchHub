import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { runIsolatedR9Validation } from "./run-isolated-r9-validation.ts";

export function runIsolatedR9R2Validation(): number {
  const baseline = process.env.R9_R2_EXECUTION_BASELINE?.trim();
  if (!baseline) {
    console.error("R9_R2_EXECUTION_BASELINE is required; the real run must name the exact Commit A baseline");
    return 1;
  }
  process.env.RESEARCHHUB_R9_EXECUTION_BASELINE = baseline;
  process.env.RESEARCHHUB_PRODUCT_VALIDATION_TASK_ID = "KNOWLEDGE-V0.3-PRODUCT-VALIDATION-C-004-R9-R2-FINAL";
  process.env.RESEARCHHUB_PRODUCT_VALIDATION_KB_ID = "kb-product-validation-c004-r9-r2-final";
  process.env.RESEARCHHUB_PRODUCT_VALIDATION_DURABLE_EVIDENCE = "tests/knowledge/product-validation/evidence/c004-r9-r2-final-full-pipeline.json";
  process.env.RESEARCHHUB_EXPECT_ZERO_RECONCILIATION = "1";
  return runIsolatedR9Validation();
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  process.exitCode = runIsolatedR9R2Validation();
}
