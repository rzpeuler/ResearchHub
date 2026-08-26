import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { DoclingDocumentParser, DocumentParserError, DocumentParserRegistry, LocalResearchReportInputResolver, PdfJsDocumentParser } from '../../../packages/plugins/document/index.ts'

test('local resolver preserves bytes and creates paragraph chunks for text reports', async () => {
  const input = 'Title\r\n\r\nFirst paragraph.\r\n\r\nSecond paragraph.'
  const result = await new LocalResearchReportInputResolver().resolve({ type: 'text', text: input, originalFilename: 'report.txt' })
  assert.deepEqual([...result.rawBytes], [...new TextEncoder().encode(input)])
  assert.equal(result.originalFilename, 'report.txt')
  assert.equal(result.mediaType, 'text/plain')
  assert.deepEqual(result.chunks.map((chunk) => chunk.locator), ['paragraph:1', 'paragraph:2', 'paragraph:3'])
})

test('PDF resolver preserves page-aware chunks and reports insufficient extraction clearly', async () => {
  const resolver = new LocalResearchReportInputResolver({ pdfTextExtractor: { extractPages: async () => ['Page one', '', 'Page three'] } })
  const result = await resolver.resolve({ type: 'file', reference: 'C:\\does-not-exist.pdf' }).catch((error) => error)
  assert.match(result.message, /document_read_failed/)

  const injected = new LocalResearchReportInputResolver({ pdfTextExtractor: { extractPages: async () => ['Page one', '', 'Page three'] } })
  const fs = await import('node:fs/promises')
  const path = `${process.cwd()}\\tests\\knowledge\\product-validation\\resolver-fixture.pdf`
  await fs.writeFile(path, new Uint8Array([37, 80, 68, 70]))
  try {
    const resolved = await injected.resolve({ type: 'file', reference: path })
    assert.deepEqual(resolved.chunks.map((chunk) => ({ page: chunk.page, locator: chunk.locator })), [{ page: 1, locator: 'page:1' }, { page: 3, locator: 'page:3' }])
    assert.equal(resolved.mediaType, 'application/pdf')
  } finally { await fs.rm(path, { force: true }) }
})

test('PDF resolver rejects documents with no extractable text', async () => {
  const fs = await import('node:fs/promises')
  const path = `${process.cwd()}\\tests\\knowledge\\product-validation\\empty-fixture.pdf`
  await fs.writeFile(path, new Uint8Array([37, 80, 68, 70]))
  try {
    await assert.rejects(() => new LocalResearchReportInputResolver({ pdfTextExtractor: { extractPages: async () => ['', '  '] } }).resolve({ type: 'file', reference: path }), /document_text_extraction_insufficient/)
  } finally { await fs.rm(path, { force: true }) }
})

test('PDF resolver preserves canonical raw bytes when a parser mutates its input', async () => {
  const fs = await import('node:fs/promises')
  const path = `${process.cwd()}\\tests\\knowledge\\product-validation\\raw-ownership-fixture.pdf`
  const source = new Uint8Array([37, 80, 68, 70, 10, 65, 73, 45, 72, 87])
  const expectedHash = createHash('sha256').update(source).digest('hex')
  await fs.writeFile(path, source)
  try {
    const resolver = new LocalResearchReportInputResolver({ pdfTextExtractor: { extractPages: async (parserBytes) => { parserBytes.fill(0); return ['Page one'] } } })
    const result = await resolver.resolve({ type: 'file', reference: path })
    assert.equal(result.rawBytes.byteLength, source.byteLength)
    assert.equal(createHash('sha256').update(result.rawBytes).digest('hex'), expectedHash)
    assert.deepEqual([...result.rawBytes], [...source])
  } finally { await fs.rm(path, { force: true }) }
})

test('PDF parser keeps caller bytes unchanged when parsing fails after mutating its copy', async () => {
  const source = new Uint8Array([1, 2, 3, 4])
  const before = [...source]
  const parser = new PdfJsDocumentParser({ extractPages: async (parserBytes) => { parserBytes.fill(0); throw new Error('fixture parser failure') } })
  await assert.rejects(() => parser.parse({ bytes: source, filename: 'fixture.pdf', mediaType: 'application/pdf' }), (error: unknown) => error instanceof DocumentParserError && error.code === 'document_text_extraction_insufficient')
  assert.deepEqual([...source], before)
})

test('document parser registry selects explicit providers deterministically', () => {
  const pdfjs = new PdfJsDocumentParser({ extractPages: async () => ['text'] })
  const registry = new DocumentParserRegistry([pdfjs])
  assert.deepEqual(registry.providerIds, ['pdfjs-text'])
  assert.equal(registry.select({ filename: 'report.pdf', mediaType: 'application/pdf' }, 'pdfjs-text'), pdfjs)
  assert.throws(() => registry.select({ filename: 'report.pdf', mediaType: 'application/pdf' }, 'docling-local'), /document_parser_unavailable/)
})

test('Docling provider adapts a local structured bridge without exposing it to Workflow', async () => {
  const bridgePath = fileURLToPath(new URL('./fixtures/docling-bridge-fixture.py', import.meta.url))
  const parser = new DoclingDocumentParser({ bridgePath })
  const result = await parser.parse({ bytes: new Uint8Array([37, 80, 68, 70]), filename: 'fixture.pdf', mediaType: 'application/pdf' })
  assert.equal(result.parser.id, 'docling-local')
  assert.equal(result.quality?.tableCount, 1)
  assert.equal(result.chunks[1]?.section, 'AI Hardware')
  assert.match(result.chunks[1]?.text ?? '', /\| Product \|/)
})
