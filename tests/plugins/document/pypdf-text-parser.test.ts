import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { PypdfTextDocumentParser } from '../../../plugins/document/parsers/pypdf-text-parser.ts'
import { DocumentPluginError } from '../../../plugins/document/errors.ts'

const bytes = new TextEncoder().encode('%PDF-1.4\n%%EOF')
const document = { documentId: 'bridge-id', parser: { id: 'pypdf-text-only', version: 'fixture' }, metadata: { originalFilename: 'fixture.pdf', mediaType: 'application/pdf', pageCount: 1, parserMetadata: { tableStructure: 'TEXT_ONLY' } }, normalizedText: 'Real page text with a visible source location.', sections: [{ sectionId: 'page-1', title: null, level: null, parentSectionRef: null, blockRefs: ['block-1'], pageStart: 1, pageEnd: 1 }], blocks: [{ blockId: 'block-1', type: 'paragraph', text: 'Real page text with a visible source location.', sectionRef: 'page-1', page: 1, locator: { page: 1, parserItemRef: 'pypdf-page-0001', sectionPath: ['page-1'], sourceOrder: 1 }, order: 1 }], stats: { pageCount: 1, sectionCount: 1, blockCount: 1, normalizedCharacters: 46, tableCount: 0, headingCount: 0, listCount: 0, captionCount: 0 }, warnings: [] }

async function bridge(contents: string): Promise<{ directory: string; path: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'pypdf-bridge-test-'))
  const path = join(directory, 'bridge.cjs')
  await writeFile(path, contents, 'utf8')
  return { directory, path }
}

test('pypdf wrapper validates a page-located StructuredDocument and uses a full SHA-256 document ID', async () => {
  const fake = await bridge(`process.stdout.write(${JSON.stringify(JSON.stringify({ status: 'USABLE', document }))})`)
  try {
    const parsed = await new PypdfTextDocumentParser({ pythonExecutable: process.execPath, bridgePath: fake.path }).parse({ bytes, filename: 'fixture.pdf', mediaType: 'application/pdf' })
    assert.equal(parsed.parser.id, 'pypdf-text-only')
    assert.match(parsed.documentId, /^document-[a-f0-9]{64}$/)
    assert.equal(parsed.blocks[0]?.locator.parserItemRef, 'pypdf-page-0001')
    assert.equal(parsed.metadata.parserMetadata?.tableStructure, 'TEXT_ONLY')
  } finally { await rm(fake.directory, { recursive: true, force: true }) }
})

test('pypdf wrapper distinguishes invalid PDF bytes from insufficient text and removes temporary files', async () => {
  const fake = await bridge(`process.stdout.write(${JSON.stringify(JSON.stringify({ status: 'INSUFFICIENT', reason: 'page text coverage below bound' }))})`)
  const before = new Set((await readdir(tmpdir())).filter((name) => name.startsWith('researchhub-pypdf-')))
  try {
    await assert.rejects(() => new PypdfTextDocumentParser({ pythonExecutable: process.execPath, bridgePath: fake.path }).parse({ bytes: new TextEncoder().encode('not-a-pdf'), filename: 'fixture.pdf', mediaType: 'application/pdf' }), (error: unknown) => error instanceof DocumentPluginError && error.code === 'document_read_failed')
    await assert.rejects(() => new PypdfTextDocumentParser({ pythonExecutable: process.execPath, bridgePath: fake.path }).parse({ bytes, filename: 'fixture.pdf', mediaType: 'application/pdf' }), (error: unknown) => error instanceof DocumentPluginError && error.code === 'document_text_extraction_insufficient')
  } finally { await rm(fake.directory, { recursive: true, force: true }) }
  const after = (await readdir(tmpdir())).filter((name) => name.startsWith('researchhub-pypdf-'))
  assert.deepEqual(after.filter((name) => !before.has(name)), [])
})

test('pypdf hard timeout terminates its bridge and removes the owned temporary directory', async () => {
  const fake = await bridge('setInterval(() => {}, 1000)\n')
  const before = new Set((await readdir(tmpdir())).filter((name) => name.startsWith('researchhub-pypdf-')))
  try {
    await assert.rejects(() => new PypdfTextDocumentParser({ pythonExecutable: process.execPath, bridgePath: fake.path, timeoutMs: 100 }).parse({ bytes, filename: 'fixture.pdf', mediaType: 'application/pdf' }), (error: unknown) => error instanceof DocumentPluginError && error.code === 'document_parser_timeout')
  } finally { await rm(fake.directory, { recursive: true, force: true }) }
  const after = (await readdir(tmpdir())).filter((name) => name.startsWith('researchhub-pypdf-'))
  assert.deepEqual(after.filter((name) => !before.has(name)), [])
})
