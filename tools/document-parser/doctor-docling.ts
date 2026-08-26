import { execFile } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { promisify } from 'node:util'
import { getManagedDoclingPaths, managedArtifactsPath, pathExists, writeDoctorFixture, DOCLING_VERSION } from './runtime.ts'
import type { ManagedDoclingPaths } from './runtime.ts'

const execFileAsync = promisify(execFile)

export interface DoclingDoctorReport {
  readonly status: 'READY' | 'NOT_READY'
  readonly managedRoot: string
  readonly python: string
  readonly doclingVersion: string | null
  readonly modelRoot: string
  readonly checks: Record<string, 'PASS' | 'FAIL' | 'SKIP'>
  readonly diagnostics: string[]
}

export async function inspectDoclingRuntime(paths = getManagedDoclingPaths()): Promise<DoclingDoctorReport> {
  const diagnostics: string[] = []
  const checks: Record<string, 'PASS' | 'FAIL' | 'SKIP'> = { python: 'FAIL', doclingImport: 'SKIP', version: 'SKIP', artifactsDirectory: 'FAIL', modelInitialization: 'SKIP', fixtureParse: 'SKIP', tablePipeline: 'SKIP' }
  let doclingVersion: string | null = null
  if (await pathExists(paths.pythonExecutable)) checks.python = 'PASS'
  else diagnostics.push('python_not_found')

  if (checks.python === 'PASS') {
    try {
      const result = await execFileAsync(paths.pythonExecutable, ['-c', "import importlib.metadata; print(importlib.metadata.version('docling'))"], { windowsHide: true })
      doclingVersion = result.stdout.trim()
      checks.doclingImport = 'PASS'
      if (doclingVersion === DOCLING_VERSION) checks.version = 'PASS'
      else diagnostics.push(doclingVersion ? 'docling_version_mismatch' : 'docling_not_installed')
    } catch { diagnostics.push('docling_not_installed') }
  }

  const modelRoot = managedArtifactsPath(process.env, paths)
  if (await pathExists(modelRoot)) checks.artifactsDirectory = 'PASS'
  else diagnostics.push('docling_models_missing')

  if (checks.python === 'PASS' && checks.doclingImport === 'PASS' && checks.version === 'PASS' && checks.artifactsDirectory === 'PASS') {
    await writeDoctorFixture(paths.doctorFixturePath)
    try {
      const result = await execFileAsync(paths.pythonExecutable, [paths.bridgePath, paths.doctorFixturePath], { windowsHide: true, env: { ...process.env, RESEARCHHUB_DOCLING_ARTIFACTS_PATH: modelRoot, HF_HUB_OFFLINE: '1' }, maxBuffer: 10 * 1024 * 1024 })
      const payload = JSON.parse(result.stdout) as { pageCount?: number; structure?: { tableCount?: number }; quality?: { tableCount?: number } }
      checks.modelInitialization = 'PASS'
      if (typeof payload.pageCount === 'number' && payload.pageCount > 0) checks.fixtureParse = 'PASS'
      else diagnostics.push('docling_fixture_parse_failed')
      if (typeof payload.structure?.tableCount === 'number' || typeof payload.quality?.tableCount === 'number') checks.tablePipeline = 'PASS'
      else diagnostics.push('docling_table_pipeline_not_initialized')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      checks.modelInitialization = 'FAIL'
      diagnostics.push(message.includes('model.safetensors') || message.includes('cached snapshot') ? 'docling_models_missing' : 'docling_model_initialization_failed')
    } finally { await rm(paths.doctorFixturePath, { force: true }) }
  }

  return { status: diagnostics.length === 0 ? 'READY' : 'NOT_READY', managedRoot: paths.managedRoot, python: paths.pythonExecutable, doclingVersion, modelRoot, checks, diagnostics: [...new Set(diagnostics)] }
}

if (process.argv[1]?.endsWith('doctor-docling.ts')) {
  const report = await inspectDoclingRuntime()
  console.log(JSON.stringify(report))
  if (report.status !== 'READY') process.exitCode = 1
}
