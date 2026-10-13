import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { DoclingDocumentParser } from '../../../plugins/document/parsers/docling/parser.ts'
import { DocumentPluginError } from '../../../plugins/document/errors.ts'

test('Docling bridge output normalizes headings, tables, captions, pages, and stats', async () => {
  const bridgePath = fileURLToPath(new URL('./fixtures/structured-bridge-fixture.py', import.meta.url))
  const result = await new DoclingDocumentParser({ bridgePath, pythonExecutable: 'python', artifactsPath: 'fixture-artifacts' }).parse({ bytes: new Uint8Array([37, 80, 68, 70]), filename: 'fixture.pdf', mediaType: 'application/pdf' })
  assert.equal(result.parser.id, 'docling-local')
  assert.equal(result.parser.version, 'fixture')
  assert.equal(result.sections[0]?.blockRefs.length, 3)
  assert.equal(result.blocks[1]?.type, 'table')
  assert.equal(result.blocks[1]?.structuredContent?.kind, 'table')
  assert.equal(result.blocks[2]?.type, 'caption')
  assert.equal(result.stats.pageCount, 2)
})

test('selected Docling parser reports explicit environment-not-ready errors', async () => {
  const missingPython = join(process.cwd(), 'missing-docling-python.exe')
  await assert.rejects(() => new DoclingDocumentParser({ pythonExecutable: missingPython }).parse({ bytes: new Uint8Array([37, 80, 68, 70]), filename: 'fixture.pdf', mediaType: 'application/pdf' }), (error: unknown) => error instanceof DocumentPluginError && error.code === 'document_parser_environment_not_ready')
})

test('Docling cancellation terminates the bridge process and returns a cancellation error', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'docling-cancel-test-'))
  const bridgePath = join(directory, 'hang.cjs')
  await writeFile(bridgePath, 'setInterval(() => {}, 1000)\n', 'utf8')
  const controller = new AbortController()
  const parser = new DoclingDocumentParser({ pythonExecutable: process.execPath, bridgePath, artifactsPath: directory, timeoutMs: 30_000 })
  const parsing = parser.parse({ bytes: new Uint8Array([37, 80, 68, 70]), filename: 'fixture.pdf', mediaType: 'application/pdf', signal: controller.signal })
  const timer = setTimeout(() => controller.abort(), 100)
  try {
    await assert.rejects(parsing, (error: unknown) => error instanceof DocumentPluginError && error.code === 'document_parser_cancelled')
  } finally {
    clearTimeout(timer)
    await rm(directory, { recursive: true, force: true })
  }
})

test('Docling hard timeout terminates the bridge process and reports a bounded parser failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'docling-timeout-test-'))
  const bridgePath = join(directory, 'hang.cjs')
  await writeFile(bridgePath, 'setInterval(() => {}, 1000)\n', 'utf8')
  const parser = new DoclingDocumentParser({ pythonExecutable: process.execPath, bridgePath, artifactsPath: directory, timeoutMs: 1_000 })
  try {
    await assert.rejects(() => parser.parse({ bytes: new Uint8Array([37, 80, 68, 70]), filename: 'fixture.pdf', mediaType: 'application/pdf' }), (error: unknown) => error instanceof DocumentPluginError && error.code === 'document_parser_timeout')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
