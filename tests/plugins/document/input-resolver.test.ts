import assert from 'node:assert/strict'
import { writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { DocumentInputResolver } from '../../../plugins/document/input-resolver.ts'
import { DocumentPluginError } from '../../../plugins/document/errors.ts'
import type { DocumentParser, StructuredDocument } from '../../../plugins/document/contracts.ts'

test('text input preserves raw bytes and produces Sections/Blocks, not the retired model', async () => {
  const input = 'Heading\r\n\r\nFirst paragraph.\r\n\r\nSecond paragraph.'
  const result = await new DocumentInputResolver().resolve({ type: 'text', text: input, originalFilename: 'report.txt' })
  assert.deepEqual([...result.rawBytes], [...new TextEncoder().encode(input)])
  assert.equal(result.document.parser.id, 'plain-text')
  assert.equal(result.document.blocks.length, 3)
  assert.equal('chunks' in result.document, false)
  assert.deepEqual(result.document.blocks.map((block) => block.order), [1, 2, 3])
})

test('document acquisition and parsing are independently callable', async () => {
  const resolver = new DocumentInputResolver()
  const acquired = await resolver.acquire({ type: 'text', text: 'Acquired text', originalFilename: 'acquired.txt', documentId: 'doc-acquired' })
  assert.equal(acquired.filename, 'acquired.txt')
  assert.equal(acquired.documentId, 'doc-acquired')
  const document = await resolver.parse(acquired)
  assert.equal(document.documentId, 'doc-acquired')
  assert.equal(document.normalizedText, 'Acquired text')
})

test('file input resolves media type and missing references use Document Plugin errors', async () => {
  const path = join(process.cwd(), 'tests', 'plugins', 'document', 'resolver-fixture.md')
  await writeFile(path, '# Title\n\nBody')
  try {
    const result = await new DocumentInputResolver().resolve({ type: 'file', reference: path })
    assert.equal(result.mediaType, 'text/markdown')
    assert.equal(result.originalFilename, 'resolver-fixture.md')
  } finally { await rm(path, { force: true }) }
  await assert.rejects(() => new DocumentInputResolver().resolve({ type: 'file', reference: 'missing-document.pdf' }), (error: unknown) => error instanceof DocumentPluginError && error.code === 'document_read_failed')
})

test('CNINFO PDF resolver falls back to Docling after an insufficient text layer', async () => {
  const order: string[] = []
  const input = { bytes: new Uint8Array([37, 80, 68, 70]), filename: 'filing.pdf', mediaType: 'application/pdf' }
  const fast: DocumentParser = { id: 'pypdf-fixture', supports: () => true, parse: async () => { order.push('pypdf'); throw new DocumentPluginError('document_text_extraction_insufficient', 'text page coverage below minimum') } }
  const fallbackDocument: StructuredDocument = { documentId: 'fallback-doc', parser: { id: 'docling-fixture' }, metadata: { originalFilename: 'filing.pdf', mediaType: 'application/pdf', pageCount: 1 }, normalizedText: 'Docling located table evidence.', sections: [], blocks: [], stats: { pageCount: 1, sectionCount: 0, blockCount: 0, normalizedCharacters: 31, tableCount: 0, headingCount: 0, listCount: 0, captionCount: 0 }, warnings: [] }
  const fallback: DocumentParser = { id: 'docling-fixture', supports: () => true, parse: async (parserInput) => { order.push('docling'); return { ...fallbackDocument, documentId: parserInput.documentId ?? fallbackDocument.documentId } } }
  const resolver = new DocumentInputResolver({ pdfTextFirst: true, pdfTextParser: fast, pdfFallbackParsers: [fallback] })
  const result = await resolver.parse({ ...input, documentId: 'requested-doc' })
  assert.deepEqual(order, ['pypdf', 'docling'])
  assert.equal(result.parser.id, 'docling-fixture')
  assert.equal(result.documentId, 'requested-doc')
})

test('CNINFO PDF diagnostics retain both bounded parser failure causes', async () => {
  const fast: DocumentParser = { id: 'pypdf-fixture', supports: () => true, parse: async () => { throw new DocumentPluginError('document_text_extraction_insufficient', 'text page coverage below minimum') } }
  const fallback: DocumentParser = { id: 'docling-fixture', supports: () => true, parse: async () => { throw new DocumentPluginError('document_parser_timeout', 'Docling exceeded the bounded timeout') } }
  const resolver = new DocumentInputResolver({ pdfTextFirst: true, pdfTextParser: fast, pdfFallbackParsers: [fallback] })
  await assert.rejects(() => resolver.parse({ bytes: new Uint8Array([37, 80, 68, 70]), filename: 'filing.pdf', mediaType: 'application/pdf' }), (error: unknown) => error instanceof DocumentPluginError && error.code === 'document_parser_timeout' && /pypdf-fixture:.*page coverage below minimum.*docling-fixture:.*bounded timeout/i.test(error.message))
})

test('CNINFO PDF parser work is limited to two concurrent resolver jobs', async () => {
  let active = 0
  let maximum = 0
  const parser: DocumentParser = {
    id: 'bounded-test-parser',
    supports: () => true,
    parse: async (input) => {
      active += 1; maximum = Math.max(maximum, active)
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 20))
      active -= 1
      const document: StructuredDocument = { documentId: input.documentId ?? 'doc', parser: { id: 'bounded-test-parser' }, metadata: { originalFilename: input.filename, mediaType: input.mediaType, pageCount: 1 }, normalizedText: 'bounded text', sections: [], blocks: [], stats: { pageCount: 1, sectionCount: 0, blockCount: 0, normalizedCharacters: 12, tableCount: 0, headingCount: 0, listCount: 0, captionCount: 0 }, warnings: [] }
      return document
    },
  }
  const resolver = new DocumentInputResolver({ pdfTextFirst: true, pdfTextParser: parser, pdfFallbackParsers: [] })
  await Promise.all(Array.from({ length: 6 }, (_, index) => resolver.parse({ bytes: new Uint8Array([index]), filename: `filing-${index}.pdf`, mediaType: 'application/pdf', documentId: `doc-${index}` })))
  assert.equal(maximum, 2)
  assert.equal(active, 0)
})
