import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { runIsolatedR9Validation } from "./run-isolated-r9-validation.ts";

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  process.env.RESEARCHHUB_PRODUCT_VALIDATION_TASK_ID ??= "KNOWLEDGE-V0.3-PRODUCT-VALIDATION-C-004-R9-R1";
  process.env.RESEARCHHUB_PRODUCT_VALIDATION_KB_ID ??= "kb-product-validation-c004-r9-r1-final";
  process.env.RESEARCHHUB_PRODUCT_VALIDATION_DURABLE_EVIDENCE ??= "tests/knowledge/product-validation/evidence/c004-r9-r1-final-full-pipeline.json";
  process.exitCode = runIsolatedR9Validation();
}
