import assert from 'node:assert/strict'
import test from 'node:test'
import { LocalResearchReportInputResolver } from '../../../packages/plugins/document/index.ts'

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
