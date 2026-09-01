import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { isolatedEnvironment } from './preflight-isolated-env.ts'

export function runIsolatedKnowledgeSmoke(): number {
  const runner = join(dirname(fileURLToPath(import.meta.url)), 'run-post-c12-extraction-smoke.ts')
  const child = spawnSync(process.execPath, [
    `--env-file=${resolve(process.cwd(), '.env')}`,
    '--import',
    'tsx',
    runner,
  ], {
    env: isolatedEnvironment(process.env),
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'pipe'],
  })
  if (child.stdout) process.stdout.write(child.stdout)
  if (child.stderr) process.stderr.write(child.stderr)
  return child.status ?? 1
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exitCode = runIsolatedKnowledgeSmoke()
}
