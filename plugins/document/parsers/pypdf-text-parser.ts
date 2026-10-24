import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DocumentPluginError } from '../errors.ts'
import { validateStructuredDocument } from '../validation.ts'
import type { DocumentParser, DocumentParserInput, StructuredDocument } from '../contracts.ts'

const bridgePath = resolve(dirname(fileURLToPath(import.meta.url)), 'docling/bridge/pypdf_text_bridge.py')

export interface PypdfTextDocumentParserOptions {
  readonly pythonExecutable?: string
  readonly bridgePath?: string
  readonly timeoutMs?: number
}

interface BridgeResult {
  readonly status: 'USABLE' | 'INSUFFICIENT' | 'INVALID_INPUT' | 'ERROR'
  readonly reason?: string
  readonly document?: StructuredDocument
}

export class PypdfTextDocumentParser implements DocumentParser {
  readonly id = 'pypdf-text-only'
  private readonly pythonExecutable: string
  private readonly bridgePath: string
  private readonly timeoutMs: number

  constructor(options: PypdfTextDocumentParserOptions = {}) {
    this.pythonExecutable = options.pythonExecutable ?? process.env.RESEARCHHUB_PYTHON_EXECUTABLE ?? resolve(process.cwd(), '.researchhub-document-parser', process.platform === 'win32' ? 'venv/Scripts/python.exe' : 'venv/bin/python')
    this.bridgePath = options.bridgePath ?? bridgePath
    this.timeoutMs = Math.max(1_000, Math.min(options.timeoutMs ?? 30_000, 60_000))
  }

  supports(input: Pick<DocumentParserInput, 'filename' | 'mediaType'>): boolean {
    return input.mediaType === 'application/pdf' || input.filename.toLowerCase().endsWith('.pdf')
  }

  async parse(input: DocumentParserInput): Promise<StructuredDocument> {
    if (input.signal?.aborted) throw new DocumentPluginError('document_parser_cancelled', 'document_parser_cancelled: PDF text parsing was cancelled', this.id)
    const trailer = new TextDecoder().decode(input.bytes.subarray(Math.max(0, input.bytes.byteLength - 8_192)))
    if (input.bytes.byteLength < 8 || new TextDecoder().decode(input.bytes.subarray(0, 5)) !== '%PDF-' || !trailer.includes('%%EOF')) throw new DocumentPluginError('document_read_failed', 'document_read_failed: PDF header or end marker is invalid', this.id)
    if (input.bytes.byteLength > 100 * 1024 * 1024) throw new DocumentPluginError('document_parser_failed', 'document_parser_failed: PDF exceeds the 100 MB text-parser bound', this.id)
    const directory = await mkdtemp(resolve(tmpdir(), 'researchhub-pypdf-'))
    const sourcePath = resolve(directory, 'document.pdf')
    try {
      await writeFile(sourcePath, input.bytes)
      const output = await runBridge(this.pythonExecutable, this.bridgePath, sourcePath, input.signal, this.timeoutMs)
      let result: BridgeResult
      try { result = JSON.parse(output) as BridgeResult } catch { throw new DocumentPluginError('document_parser_failed', 'document_parser_failed: pypdf bridge returned invalid JSON', this.id) }
      if (result.status !== 'USABLE' || !result.document) {
        if (result.status === 'INSUFFICIENT') throw new DocumentPluginError('document_text_extraction_insufficient', `document_text_extraction_insufficient: ${result.reason ?? 'PDF text layer is not sufficient'}`, this.id)
        if (result.status === 'INVALID_INPUT') throw new DocumentPluginError('document_read_failed', `document_read_failed: ${result.reason ?? 'PDF integrity check failed'}`, this.id)
        if (/ModuleNotFoundError|ImportError/.test(result.reason ?? '')) throw new DocumentPluginError('document_parser_environment_not_ready', `document_parser_environment_not_ready: ${result.reason}`, this.id)
        throw new DocumentPluginError('document_parser_failed', `document_parser_failed: ${result.reason ?? 'pypdf extraction failed'}`, this.id)
      }
      const document: StructuredDocument = { ...result.document, documentId: input.documentId ?? `document-${hashBytes(input.bytes)}`, metadata: { ...result.document.metadata, originalFilename: input.filename || null, mediaType: input.mediaType } }
      try { return validateStructuredDocument(document) } catch (error) { throw new DocumentPluginError('document_parser_failed', `document_parser_failed: ${error instanceof Error ? error.message : String(error)}`, this.id) }
    } catch (error) {
      if (error instanceof DocumentPluginError) throw error
      const message = error instanceof Error ? error.message : String(error)
      throw new DocumentPluginError('document_parser_failed', `document_parser_failed: ${message}`, this.id)
    } finally { await rm(directory, { recursive: true, force: true }) }
  }
}

function runBridge(pythonExecutable: string, bridge: string, sourcePath: string, signal: AbortSignal | undefined, timeoutMs: number): Promise<string> {
  if (signal?.aborted) return Promise.reject(new DocumentPluginError('document_parser_cancelled', 'document_parser_cancelled: PDF text parsing was cancelled', 'pypdf-text-only'))
  return new Promise((resolveOutput, reject) => {
    const child = spawn(pythonExecutable, [bridge, sourcePath], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32' })
    let stdout = ''; let stderr = ''; let stopReason: 'cancelled' | 'timeout' | undefined; let settled = false
    const stop = (reason: 'cancelled' | 'timeout') => { if (settled || stopReason) return; stopReason = reason; terminateProcessTree(child) }
    const timer = setTimeout(() => stop('timeout'), timeoutMs)
    const onAbort = () => stop('cancelled')
    signal?.addEventListener('abort', onAbort, { once: true })
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
    child.stdout.on('data', (value: string) => { stdout += value })
    child.stderr.on('data', (value: string) => { stderr += value })
    child.on('error', (error) => { settled = true; cleanup(); reject(new DocumentPluginError('document_parser_environment_not_ready', `document_parser_environment_not_ready: ${error.message}`, 'pypdf-text-only')) })
    child.on('close', (code) => {
      settled = true; cleanup()
      if (stopReason === 'cancelled') { reject(new DocumentPluginError('document_parser_cancelled', 'document_parser_cancelled: PDF text parsing was cancelled', 'pypdf-text-only')); return }
      if (stopReason === 'timeout') { reject(new DocumentPluginError('document_parser_timeout', `document_parser_timeout: pypdf exceeded ${timeoutMs} ms`, 'pypdf-text-only')); return }
      if (code !== 0) { reject(new DocumentPluginError('document_parser_failed', `document_parser_failed: ${stderr.trim() || `pypdf bridge exited with code ${code ?? 'unknown'}`}`.slice(0, 320), 'pypdf-text-only')); return }
      resolveOutput(stdout)
    })
    function cleanup(): void { clearTimeout(timer); signal?.removeEventListener('abort', onAbort) }
  })
}

function terminateProcessTree(child: ReturnType<typeof spawn>): void {
  if (child.pid === undefined) return
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true })
    killer.on('error', () => child.kill())
    killer.on('close', () => child.kill())
    return
  }
  try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') }
}

function hashBytes(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex') }
