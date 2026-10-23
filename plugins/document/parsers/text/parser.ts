import { createHash } from 'node:crypto'
import { DocumentPluginError } from '../../errors.ts'
import { validateStructuredDocument } from '../../validation.ts'
import type { DocumentBlock, DocumentParser, DocumentParserInput, DocumentSection, StructuredDocument } from '../../contracts.ts'

type MutableSection = Omit<DocumentSection, 'blockRefs'> & { blockRefs: string[] }

const HTML_BLOCK_BOUNDARY_TAGS = new Set(['p', 'div', 'section', 'article', 'li', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br'])

function normalizeHtmlText(value: string): string {
  // Scan tags once instead of using a lazy script/style regex. Public pages can
  // contain malformed, repeated opening tags; the old expression backtracked
  // quadratically and could block the event loop past acquisition deadlines.
  const lower = value.toLowerCase()
  const output: string[] = []
  let cursor = 0
  while (cursor < value.length) {
    const start = value.indexOf('<', cursor)
    if (start < 0) { output.push(value.slice(cursor)); break }
    output.push(value.slice(cursor, start))
    if (value.startsWith('<!--', start)) {
      const end = value.indexOf('-->', start + 4)
      cursor = end < 0 ? value.length : end + 3
      continue
    }
    let nameStart = start + 1
    if (value[nameStart] === '/') nameStart++
    while (nameStart < value.length && /\s/.test(value[nameStart]!)) nameStart++
    let nameEnd = nameStart
    while (nameEnd < value.length && /[a-z\d:-]/i.test(value[nameEnd]!)) nameEnd++
    if (nameEnd === nameStart) { output.push('<'); cursor = start + 1; continue }
    const tag = lower.slice(nameStart, nameEnd)
    const closing = value[start + 1] === '/'
    const tagEnd = findHtmlTagEnd(value, nameEnd)
    if (tagEnd < 0) { output.push(value.slice(start)); break }
    output.push(HTML_BLOCK_BOUNDARY_TAGS.has(tag) ? '\n\n' : ' ')
    cursor = tagEnd + 1
    if (!closing && (tag === 'script' || tag === 'style')) {
      const close = findHtmlClosingTag(lower, `</${tag}`, cursor)
      if (close < 0) { cursor = value.length; continue }
      const closeEnd = findHtmlTagEnd(value, close + tag.length + 2)
      cursor = closeEnd < 0 ? value.length : closeEnd + 1
    }
  }
  return output.join('')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
}

function findHtmlTagEnd(value: string, from: number): number {
  let quote = ''
  for (let index = from; index < value.length; index++) {
    const char = value[index]!
    if (quote) { if (char === quote) quote = ''; continue }
    if (char === '"' || char === "'") quote = char
    else if (char === '>') return index
  }
  return -1
}

function findHtmlClosingTag(lower: string, needle: string, from: number): number {
  let index = from
  while ((index = lower.indexOf(needle, index)) >= 0) {
    const next = lower[index + needle.length]
    if (next === undefined || next === '>' || next === '/' || /\s/.test(next)) return index
    index += needle.length
  }
  return -1
}

export class PlainTextDocumentParser implements DocumentParser {
  readonly id = 'plain-text'
  supports(input: Pick<DocumentParserInput, 'filename' | 'mediaType'>): boolean { return input.mediaType.startsWith('text/') || /\.(csv|html?|json|md|text|txt|xml)$/i.test(input.filename) }

  async parse(input: DocumentParserInput): Promise<StructuredDocument> {
    const html = input.mediaType.includes('html') || /\.html?$/i.test(input.filename)
    const decoded = new TextDecoder().decode(input.bytes)
    const text = (html ? normalizeHtmlText(decoded) : decoded).replace(/\r\n?/g, '\n').trim()
    if (!text) throw new DocumentPluginError('document_text_extraction_insufficient', 'document_text_extraction_insufficient: text input is empty', this.id)
    const sections: MutableSection[] = []
    const blocks: DocumentBlock[] = []
    let current: { section: MutableSection; blockRefs: string[] } | undefined
    const ensureSection = (title: string | null, level: number | null): MutableSection => {
      const section = { sectionId: `section-${String(sections.length + 1).padStart(4, '0')}`, title, level, parentSectionRef: null, blockRefs: [] as string[], pageStart: null, pageEnd: null }
      sections.push(section); current = { section, blockRefs: [] }; return section
    }
    const paragraphs = text.split(/\n{2,}/).map((value) => value.trim()).filter(Boolean)
    for (const paragraph of paragraphs) {
      const heading = /^(#{1,6})\s+(.+)$/.exec(paragraph)
      const section = heading ? ensureSection(heading[2]!, heading[1]!.length) : (current?.section ?? ensureSection(null, null))
      const block: DocumentBlock = { blockId: `block-${String(blocks.length + 1).padStart(6, '0')}`, type: heading ? 'heading' : 'paragraph', text: heading ? heading[2]! : paragraph, sectionRef: section.sectionId, page: null, locator: { page: null, parserItemRef: `text-${blocks.length + 1}`, sectionPath: [section.sectionId], sourceOrder: blocks.length + 1 }, order: blocks.length + 1 }
      blocks.push(block)
      const mutable = current?.section === section ? current : { section, blockRefs: [...section.blockRefs] }
      mutable.blockRefs.push(block.blockId)
      section.blockRefs = mutable.blockRefs
    }
    const document = { documentId: input.documentId ?? `document-${createHash('sha256').update(input.bytes).digest('hex').slice(0, 16)}`, parser: { id: this.id, version: 'text-normalizer-1' }, metadata: { originalFilename: input.filename || null, mediaType: input.mediaType }, normalizedText: blocks.map((block) => block.text).join('\n\n'), sections, blocks, stats: { pageCount: null, sectionCount: sections.length, blockCount: blocks.length, normalizedCharacters: blocks.map((block) => block.text).join('\n\n').length, tableCount: 0, headingCount: blocks.filter((block) => block.type === 'heading').length, listCount: 0, captionCount: 0 }, warnings: [] } satisfies StructuredDocument
    return validateStructuredDocument(document)
  }
}
