import { spawn } from 'node:child_process'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DocumentParserError } from './types.ts'
import type { DocumentParseInput, DocumentParseResult, DocumentParser } from './types.ts'

export interface DoclingDocumentParserOptions {
  readonly pythonExecutable?: string
  readonly bridgePath?: string
  readonly artifactsPath?: string
}

export class DoclingDocumentParser implements DocumentParser {
  readonly id = 'docling-local'
  private readonly pythonExecutable: string
  private readonly bridgePath: string
  private readonly artifactsPath: string

  constructor(options: DoclingDocumentParserOptions = {}) {
    this.pythonExecutable = options.pythonExecutable ?? process.env.RESEARCHHUB_PYTHON_EXECUTABLE ?? resolve(process.cwd(), '.researchhub-document-parser', process.platform === 'win32' ? 'venv/Scripts/python.exe' : 'venv/bin/python')
    this.bridgePath = options.bridgePath ?? process.env.RESEARCHHUB_DOCLING_BRIDGE ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../../tools/document-parser/docling_bridge.py')
    this.artifactsPath = options.artifactsPath ?? process.env.RESEARCHHUB_DOCLING_ARTIFACTS_PATH ?? resolve(process.cwd(), '.researchhub-document-parser/models')
  }

  supports(input: Pick<DocumentParseInput, 'filename' | 'mediaType'>): boolean {
    return input.mediaType === 'application/pdf' || input.filename.toLowerCase().endsWith('.pdf')
  }

  async parse(input: DocumentParseInput): Promise<DocumentParseResult> {
    if (!await executableExists(this.pythonExecutable)) throw new DocumentParserError('document_parser_environment_not_ready', 'document_parser_environment_not_ready: managed Python interpreter was not found', this.id)
    const directory = await mkdtemp(resolve(tmpdir(), 'researchhub-docling-'))
    const sourcePath = resolve(directory, input.filename.toLowerCase().endsWith('.pdf') ? 'document.pdf' : 'document.bin')
    try {
      await writeFile(sourcePath, input.bytes)
      const output = await runBridge(this.pythonExecutable, this.bridgePath, sourcePath, this.artifactsPath)
      return parseBridgeResult(output, this.id)
    } catch (error) {
      if (error instanceof DocumentParserError) throw error
      throw new DocumentParserError('document_parser_failed', `document_parser_failed: ${error instanceof Error ? error.message : String(error)}`, this.id)
    } finally { await rm(directory, { recursive: true, force: true }) }
  }
}

function runBridge(pythonExecutable: string, bridgePath: string, sourcePath: string, artifactsPath: string): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    const child = spawn(pythonExecutable, [bridgePath, sourcePath], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, RESEARCHHUB_DOCLING_ARTIFACTS_PATH: artifactsPath, HF_HUB_OFFLINE: process.env.HF_HUB_OFFLINE ?? '1' } })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        const message = stderr.trim() || `Docling bridge exited with code ${code ?? 'unknown'}`
        const errorCode = message.startsWith('document_parser_environment_not_ready:') ? 'document_parser_environment_not_ready' : 'document_parser_failed'
        reject(new DocumentParserError(errorCode, message, 'docling-local'))
      }
      else resolveOutput(stdout)
    })
  })
}

async function executableExists(executable: string): Promise<boolean> {
  if (!executable.includes('/') && !executable.includes('\\')) return true
  try { await access(executable); return true } catch { return false }
}

function parseBridgeResult(output: string, parserId: string): DocumentParseResult {
  let result: unknown
  try { result = JSON.parse(output) } catch { throw new DocumentParserError('document_parser_failed', 'document_parser_failed: Docling bridge returned invalid JSON', parserId) }
  if (!isRecord(result) || typeof result.normalizedText !== 'string' || !Array.isArray(result.chunks)) throw new DocumentParserError('document_parser_failed', 'document_parser_failed: Docling bridge returned an invalid parse result', parserId)
  return result as unknown as DocumentParseResult
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null }
