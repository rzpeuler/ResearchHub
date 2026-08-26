import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DOCLING_VERSION = '2.116.0'
export const DOCLING_MODEL_NAMES = ['layout', 'tableformer'] as const

export interface ManagedDoclingPaths {
  readonly projectRoot: string
  readonly managedRoot: string
  readonly venvRoot: string
  readonly pythonExecutable: string
  readonly doclingToolsExecutable: string
  readonly modelRoot: string
  readonly requirementsPath: string
  readonly bridgePath: string
  readonly doctorFixturePath: string
}

export function getManagedDoclingPaths(projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')): ManagedDoclingPaths {
  const managedRoot = resolve(projectRoot, '.researchhub-document-parser')
  const venvRoot = resolve(managedRoot, 'venv')
  const scriptsRoot = process.platform === 'win32' ? resolve(venvRoot, 'Scripts') : resolve(venvRoot, 'bin')
  return {
    projectRoot,
    managedRoot,
    venvRoot,
    pythonExecutable: resolve(scriptsRoot, process.platform === 'win32' ? 'python.exe' : 'python'),
    doclingToolsExecutable: resolve(scriptsRoot, process.platform === 'win32' ? 'docling-tools.exe' : 'docling-tools'),
    modelRoot: resolve(managedRoot, 'models'),
    requirementsPath: resolve(projectRoot, 'tools/document-parser/requirements-docling.txt'),
    bridgePath: resolve(projectRoot, 'tools/document-parser/docling_bridge.py'),
    doctorFixturePath: resolve(managedRoot, 'doctor-fixture.pdf')
  }
}

export async function pathExists(path: string): Promise<boolean> {
  try { await access(path); return true } catch { return false }
}

export function managedArtifactsPath(env: NodeJS.ProcessEnv = process.env, paths = getManagedDoclingPaths()): string {
  return resolve(env.RESEARCHHUB_DOCLING_ARTIFACTS_PATH?.trim() || paths.modelRoot)
}

export async function writeDoctorFixture(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, minimalPdf())
}

export async function updateLocalEnv(values: Record<string, string>, envPath = resolve(getManagedDoclingPaths().projectRoot, '.env')): Promise<void> {
  const existing = await readFile(envPath, 'utf8').catch(() => '')
  const lines = existing.split(/\r?\n/)
  for (const [key, value] of Object.entries(values)) {
    const index = lines.findIndex((line) => new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`).test(line))
    const replacement = `${key}=${value}`
    if (index >= 0) lines[index] = replacement
    else lines.push(replacement)
  }
  await writeFile(envPath, `${lines.filter((line, index) => index < lines.length - 1 || line !== '').join('\n').replace(/\n+$/, '')}\n`, 'utf8')
}

function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

function minimalPdf(): Uint8Array {
  const stream = 'BT /F1 12 Tf 72 720 Td (ResearchHub Docling fixture) Tj ET'
  const bodies = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
  ]
  let document = '%PDF-1.4\n'
  const offsets = [0]
  for (let index = 0; index < bodies.length; index += 1) {
    offsets.push(document.length)
    document += `${index + 1} 0 obj\n${bodies[index]}\nendobj\n`
  }
  const xrefOffset = document.length
  document += `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`
  document += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  document += `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return new TextEncoder().encode(document)
}
