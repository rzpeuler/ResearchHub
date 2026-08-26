import { execFile } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { promisify } from 'node:util'
import { inspectDoclingRuntime } from './doctor-docling.ts'
import { DOCLING_MODEL_NAMES, getManagedDoclingPaths, pathExists, updateLocalEnv } from './runtime.ts'

const execFileAsync = promisify(execFile)
const paths = getManagedDoclingPaths()

async function run(command: string, args: string[], options: { maxBuffer?: number } = {}): Promise<void> {
  await execFileAsync(command, args, { windowsHide: true, maxBuffer: options.maxBuffer ?? 20 * 1024 * 1024 })
}

async function main(): Promise<void> {
  await mkdir(paths.managedRoot, { recursive: true })
  await mkdir(paths.modelRoot, { recursive: true })
  if (!await pathExists(paths.pythonExecutable)) await run(process.env.RESEARCHHUB_BOOTSTRAP_PYTHON ?? 'python', ['-m', 'venv', paths.venvRoot])
  await run(paths.pythonExecutable, ['-m', 'pip', 'install', '--disable-pip-version-check', '--progress-bar', 'off', '-r', paths.requirementsPath], { maxBuffer: 50 * 1024 * 1024 })
  await updateLocalEnv({ RESEARCHHUB_PYTHON_EXECUTABLE: paths.pythonExecutable, RESEARCHHUB_DOCLING_ARTIFACTS_PATH: paths.modelRoot })

  const before = await inspectDoclingRuntime(paths)
  let modelDownload: 'PASS' | 'SKIPPED' | 'FAIL' = before.status === 'READY' ? 'SKIPPED' : 'FAIL'
  if (before.status !== 'READY') {
    await run(paths.doclingToolsExecutable, ['models', 'download', ...DOCLING_MODEL_NAMES, '--output-dir', paths.modelRoot, '--quiet'], { maxBuffer: 50 * 1024 * 1024 })
    modelDownload = 'PASS'
  }
  const after = await inspectDoclingRuntime(paths)
  console.log(JSON.stringify({ ...after, dependencies: after.status === 'READY' ? 'READY' : 'CHECKED', modelDownload, setupStatus: after.status === 'READY' ? 'READY' : 'NOT_READY', setupIdempotent: before.status === 'READY' || after.status === 'READY' }))
  if (after.status !== 'READY') process.exitCode = 1
}

await main()
