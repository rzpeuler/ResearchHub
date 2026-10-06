import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DocumentPluginError } from '../../errors.ts'
import { validateStructuredDocument } from '../../validation.ts'
import type { DocumentBlock, DocumentParser, DocumentParserInput, DocumentSection, StructuredDocument } from '../../contracts.ts'

export interface DoclingDocumentParserOptions {
  readonly pythonExecutable?: string
  readonly bridgePath?: string
  readonly artifactsPath?: string
}

interface BridgePayload {
  parser: { id: string; version?: string }
  metadata?: Record<string, unknown>
  normalizedText?: string
  sections: DocumentSection[]
  blocks: DocumentBlock[]
  stats?: Partial<StructuredDocument['stats']>
  warnings?: string[]
}

export class DoclingDocumentParser implements DocumentParser {
  readonly id = 'docling-local'
  private readonly pythonExecutable: string
  private readonly bridgePath: string
  private readonly artifactsPath: string

  constructor(options: DoclingDocumentParserOptions = {}) {
    this.pythonExecutable = options.pythonExecutable ?? process.env.RESEARCHHUB_PYTHON_EXECUTABLE ?? resolve(process.cwd(), '.researchhub-document-parser', process.platform === 'win32' ? 'venv/Scripts/python.exe' : 'venv/bin/python')
    this.bridgePath = options.bridgePath ?? process.env.RESEARCHHUB_DOCLING_BRIDGE ?? resolve(dirname(fileURLToPath(import.meta.url)), 'bridge/docling_bridge.py')
    this.artifactsPath = options.artifactsPath ?? process.env.RESEARCHHUB_DOCLING_ARTIFACTS_PATH ?? resolve(process.cwd(), '.researchhub-document-parser/models')
  }

  supports(input: Pick<DocumentParserInput, 'filename' | 'mediaType'>): boolean { return input.mediaType === 'application/pdf' || input.filename.toLowerCase().endsWith('.pdf') }

  async parse(input: DocumentParserInput): Promise<StructuredDocument> {
    if (!await executableExists(this.pythonExecutable)) throw new DocumentPluginError('document_parser_environment_not_ready', 'document_parser_environment_not_ready: managed Python interpreter was not found', this.id)
    const directory = await mkdtemp(resolve(tmpdir(), 'researchhub-docling-'))
    const sourcePath = resolve(directory, input.filename.toLowerCase().endsWith('.pdf') ? 'document.pdf' : 'document.bin')
    try {
      await writeFile(sourcePath, input.bytes)
      const output = await runBridge(this.pythonExecutable, this.bridgePath, sourcePath, this.artifactsPath)
      return normalizeBridgeResult(output, input, this.id)
    } catch (error) {
      if (error instanceof DocumentPluginError) throw error
      throw new DocumentPluginError('document_parser_failed', `document_parser_failed: ${error instanceof Error ? error.message : String(error)}`, this.id)
    } finally { await rm(directory, { recursive: true, force: true }) }
  }
}

function runBridge(pythonExecutable: string, bridgePath: string, sourcePath: string, artifactsPath: string): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    const child = spawn(pythonExecutable, [bridgePath, sourcePath], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, RESEARCHHUB_DOCLING_ARTIFACTS_PATH: artifactsPath, HF_HUB_OFFLINE: process.env.HF_HUB_OFFLINE ?? '1' } })
    let stdout = ''; let stderr = ''
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
    child.stdout.on('data', (value: string) => { stdout += value }); child.stderr.on('data', (value: string) => { stderr += value })
    child.on('error', (error) => reject(new DocumentPluginError('document_parser_environment_not_ready', `document_parser_environment_not_ready: ${error.message}`, 'docling-local')))
    child.on('close', (code) => {
      if (code !== 0) {
        const message = stderr.trim() || `Docling bridge exited with code ${code ?? 'unknown'}`
        const errorCode = message.startsWith('document_parser_environment_not_ready:') ? 'document_parser_environment_not_ready' : 'document_parser_failed'
        reject(new DocumentPluginError(errorCode, message, 'docling-local'))
      } else resolveOutput(stdout)
    })
  })
}

function normalizeBridgeResult(output: string, input: DocumentParserInput, parserId: string): StructuredDocument {
  let value: unknown
  try { value = JSON.parse(output) } catch { throw new DocumentPluginError('document_parser_failed', 'document_parser_failed: Docling bridge returned invalid JSON', parserId) }
  if (!isBridgePayload(value)) throw new DocumentPluginError('document_parser_failed', 'document_parser_failed: Docling bridge returned invalid StructuredDocument data', parserId)
  const normalizedText = value.normalizedText ?? value.blocks.map((block) => block.text).join('\n\n').trim()
  const stats = { pageCount: value.stats?.pageCount ?? value.metadata?.pageCount as number | null ?? null, sectionCount: value.sections.length, blockCount: value.blocks.length, normalizedCharacters: normalizedText.length, tableCount: value.stats?.tableCount ?? value.blocks.filter((block) => block.type === 'table').length, headingCount: value.stats?.headingCount ?? value.blocks.filter((block) => block.type === 'heading').length, listCount: value.stats?.listCount ?? value.blocks.filter((block) => block.type === 'list').length, captionCount: value.stats?.captionCount ?? value.blocks.filter((block) => block.type === 'caption').length }
  const document: StructuredDocument = { documentId: input.documentId ?? `document-${hashBytes(input.bytes)}`, parser: value.parser, metadata: { originalFilename: input.filename || null, mediaType: input.mediaType, pageCount: stats.pageCount, parserMetadata: value.metadata }, normalizedText, sections: value.sections, blocks: value.blocks, stats, warnings: value.warnings ?? [] }
  try { return validateStructuredDocument(document) } catch (error) { if (error instanceof DocumentPluginError) throw error; throw new DocumentPluginError('document_parser_failed', String(error), parserId) }
}

function isBridgePayload(value: unknown): value is BridgePayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  const parser = record.parser as Record<string, unknown> | undefined
  const sections = record.sections as unknown[] | undefined
  const blocks = record.blocks as unknown[] | undefined
  if (!parser || Array.isArray(parser) || typeof parser.id !== 'string' || !Array.isArray(sections) || !Array.isArray(blocks)) return false
  return sections.every((section) => {
    if (!section || typeof section !== 'object' || Array.isArray(section)) return false
    const value = section as Record<string, unknown>
    return typeof value.sectionId === 'string' && (value.title === null || typeof value.title === 'string') && (value.level === null || Number.isInteger(value.level)) && (value.parentSectionRef === null || typeof value.parentSectionRef === 'string') && Array.isArray(value.blockRefs) && value.blockRefs.every((ref) => typeof ref === 'string')
  }) && blocks.every((block) => {
    if (!block || typeof block !== 'object' || Array.isArray(block)) return false
    const value = block as Record<string, unknown>
    return typeof value.blockId === 'string' && typeof value.type === 'string' && typeof value.text === 'string' && (value.sectionRef === null || typeof value.sectionRef === 'string') && (value.page === null || Number.isInteger(value.page)) && Number.isInteger(value.order) && !!value.locator && typeof value.locator === 'object' && !Array.isArray(value.locator)
  })
}
function hashBytes(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex').slice(0, 16) }
async function executableExists(executable: string): Promise<boolean> { if (!executable.includes('/') && !executable.includes('\\')) return true; try { await access(executable); return true } catch { return false } }
