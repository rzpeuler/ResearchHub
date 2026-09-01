import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { isolatedEnvironment } from "./preflight-isolated-env.ts";

export function runIsolatedR9Validation(): number {
  const runner = join(dirname(fileURLToPath(import.meta.url)), "run-v03-r9-final-validation.ts");
  const child = spawnSync(process.execPath, [
    `--env-file=${resolve(process.cwd(), ".env")}`,
    "--import",
    "tsx",
    runner,
  ], {
    env: isolatedEnvironment(process.env),
    stdio: ["inherit", "inherit", "inherit"],
  });
  return child.status ?? 1;
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  process.exitCode = runIsolatedR9Validation();
}
