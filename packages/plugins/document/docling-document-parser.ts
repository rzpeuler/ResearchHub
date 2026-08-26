import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DocumentParserError } from './types.ts'
import type { DocumentParseInput, DocumentParseResult, DocumentParser } from './types.ts'

export interface DoclingDocumentParserOptions {
  readonly pythonExecutable?: string
  readonly bridgePath?: string
}

export class DoclingDocumentParser implements DocumentParser {
  readonly id = 'docling-local'
  private readonly pythonExecutable: string
  private readonly bridgePath: string

  constructor(options: DoclingDocumentParserOptions = {}) {
    this.pythonExecutable = options.pythonExecutable ?? process.env.RESEARCHHUB_PYTHON_EXECUTABLE ?? 'python'
    this.bridgePath = options.bridgePath ?? process.env.RESEARCHHUB_DOCLING_BRIDGE ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../../tools/document-parser/docling_bridge.py')
  }

  supports(input: Pick<DocumentParseInput, 'filename' | 'mediaType'>): boolean {
    return input.mediaType === 'application/pdf' || input.filename.toLowerCase().endsWith('.pdf')
  }

  async parse(input: DocumentParseInput): Promise<DocumentParseResult> {
    const directory = await mkdtemp(resolve(tmpdir(), 'researchhub-docling-'))
    const sourcePath = resolve(directory, input.filename.toLowerCase().endsWith('.pdf') ? 'document.pdf' : 'document.bin')
    try {
      await writeFile(sourcePath, input.bytes)
      const output = await runBridge(this.pythonExecutable, this.bridgePath, sourcePath)
      return parseBridgeResult(output, this.id)
    } catch (error) {
      if (error instanceof DocumentParserError) throw error
      throw new DocumentParserError('document_parser_failed', `document_parser_failed: ${error instanceof Error ? error.message : String(error)}`, this.id)
    } finally { await rm(directory, { recursive: true, force: true }) }
  }
}

function runBridge(pythonExecutable: string, bridgePath: string, sourcePath: string): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    const child = spawn(pythonExecutable, [bridgePath, sourcePath], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(stderr.trim() || `Docling bridge exited with code ${code ?? 'unknown'}`))
      else resolveOutput(stdout)
    })
  })
}

function parseBridgeResult(output: string, parserId: string): DocumentParseResult {
  let result: unknown
  try { result = JSON.parse(output) } catch { throw new DocumentParserError('document_parser_failed', 'document_parser_failed: Docling bridge returned invalid JSON', parserId) }
  if (!isRecord(result) || typeof result.normalizedText !== 'string' || !Array.isArray(result.chunks)) throw new DocumentParserError('document_parser_failed', 'document_parser_failed: Docling bridge returned an invalid parse result', parserId)
  return result as unknown as DocumentParseResult
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null }
