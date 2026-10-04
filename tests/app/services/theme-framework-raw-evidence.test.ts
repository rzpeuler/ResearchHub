import assert from 'node:assert/strict'
import test from 'node:test'
import type { StructuredDocument } from '../../../plugins/document/contracts.ts'
import { sampleThemeFrameworkRawEvidence } from '../../../app/services/theme-framework-raw-evidence.ts'

function documentFixture(sectionCounts: readonly number[], textLength = 80): StructuredDocument {
  const sections = sectionCounts.map((_, index) => ({
    sectionId: `section-${index}`,
    title: `Section ${index}`,
    level: 1,
    parentSectionRef: null,
    blockRefs: Array.from({ length: sectionCounts[index] ?? 0 }, (_, blockIndex) => `block-${index}-${blockIndex}`),
    pageStart: index + 1,
    pageEnd: index + 1,
  }))
  const blocks = sectionCounts.flatMap((count, sectionIndex) => Array.from({ length: count }, (_, blockIndex) => ({
    blockId: `block-${sectionIndex}-${blockIndex}`,
    type: blockIndex === 0 ? 'heading' as const : 'paragraph' as const,
    text: `${sectionIndex}/${blockIndex}: ${'x'.repeat(textLength)}`,
    sectionRef: `section-${sectionIndex}`,
    page: sectionIndex + 1,
    locator: { page: sectionIndex + 1, sectionPath: [`Section ${sectionIndex}`], sourceOrder: blockIndex },
    order: blocksOrder(sectionCounts, sectionIndex, blockIndex),
  })))
  return {
    documentId: 'fixture-doc',
    parser: { id: 'fixture-parser' },
    metadata: { originalFilename: 'fixture.pdf', mediaType: 'application/pdf', pageCount: sectionCounts.length },
    normalizedText: blocks.map((block) => block.text).join('\n'),
    sections,
    blocks,
    stats: { pageCount: sectionCounts.length, sectionCount: sections.length, blockCount: blocks.length, normalizedCharacters: blocks.reduce((sum, block) => sum + block.text.length, 0), tableCount: 0, headingCount: sections.length, listCount: 0, captionCount: 0 },
    warnings: [],
  }
}

function blocksOrder(sectionCounts: readonly number[], sectionIndex: number, blockIndex: number): number {
  return sectionCounts.slice(0, sectionIndex).reduce((sum, count) => sum + count, 0) + blockIndex
}

test('samples across sections first, then spreads remaining excerpts over document order', () => {
  const document = documentFixture([100, 1, 1])
  const sampled = sampleThemeFrameworkRawEvidence({ document, sourceRef: 'source:fixture', rawRef: `raw-sha256-${'a'.repeat(64)}`, maxExcerptsPerRaw: 6 })

  assert.equal(sampled.length, 6)
  assert.deepEqual(sampled.map((item) => item.sectionTitle), ['Section 0', 'Section 0', 'Section 0', 'Section 0', 'Section 1', 'Section 2'])
  assert.deepEqual(sampled.map((item) => item.blockId), ['block-0-1', 'block-0-2', 'block-0-51', 'block-0-99', 'block-1-0', 'block-2-0'])
  assert.ok(sampled.every((item) => item.page === Number(item.sectionTitle?.slice(-1)) + 1))
})

test('prefers substantial section body blocks over headings and preserves their exact locators', () => {
  const document = documentFixture([2, 2, 2])
  const sampled = sampleThemeFrameworkRawEvidence({ document, sourceRef: 'source:body-first', rawRef: `raw-sha256-${'d'.repeat(64)}`, maxExcerptsPerRaw: 3 })

  assert.deepEqual(sampled.map((item) => item.blockId), ['block-0-1', 'block-1-1', 'block-2-1'])
  assert.deepEqual(sampled.map((item) => item.page), [1, 2, 3])
  assert.deepEqual(sampled.map((item) => item.sectionTitle), ['Section 0', 'Section 1', 'Section 2'])
  assert.ok(sampled.every((item) => document.blocks.find((block) => block.blockId === item.blockId)?.type === 'paragraph'))
})

test('global fill prefers substantive bodies while maintaining document-wide first and last coverage', () => {
  const document = documentFixture([30])
  const sampled = sampleThemeFrameworkRawEvidence({ document, sourceRef: 'source:body-spread', rawRef: `raw-sha256-${'e'.repeat(64)}`, maxExcerptsPerRaw: 16 })

  assert.equal(sampled.length, 16)
  assert.ok(sampled.every((item) => item.blockId !== 'block-0-0'))
  assert.ok(sampled.every((item) => document.blocks.find((block) => block.blockId === item.blockId)?.type === 'paragraph'))
  assert.equal(sampled[0]?.blockId, 'block-0-1')
  assert.equal(sampled.at(-1)?.blockId, 'block-0-29')
})

test('caps large documents and distributes section representatives from beginning to end', () => {
  const document = documentFixture(Array.from({ length: 30 }, () => 2), 4_000)
  const sampled = sampleThemeFrameworkRawEvidence({ document, sourceRef: 'source:fixture', rawRef: `raw-sha256-${'b'.repeat(64)}` })

  assert.equal(sampled.length, 16)
  assert.equal(sampled[0]?.sectionTitle, 'Section 0')
  assert.equal(sampled.at(-1)?.sectionTitle, 'Section 29')
  assert.ok(sampled.every((item) => item.excerpt.length === 2_400))
  assert.ok(sampled.every((item) => document.blocks.some((block) => block.blockId === item.blockId && block.text.trim().startsWith(item.excerpt.slice(0, 24)))))
})

test('preserves exact block IDs, section/page locators, stable unique evidence IDs, and ignores empty text', () => {
  const document = documentFixture([2, 1])
  const blocks = [...document.blocks, { ...document.blocks[0]!, blockId: 'empty-block', text: '  ', order: 99 }]
  const sampledDocument = { ...document, blocks }
  const input = { document: sampledDocument, sourceRef: 'source:fixture', rawRef: `raw-sha256-${'c'.repeat(64)}` }
  const first = sampleThemeFrameworkRawEvidence(input)
  const replay = sampleThemeFrameworkRawEvidence(input)

  assert.deepEqual(first, replay)
  assert.equal(new Set(first.map((item) => item.evidenceId)).size, first.length)
  assert.ok(!first.some((item) => item.blockId === 'empty-block'))
  assert.ok(first.every((item) => item.blockId.startsWith('block-') && item.page !== null && item.sectionTitle !== null))
  assert.ok(first.every((item) => item.evidenceId.startsWith('raw-evidence-')))
})
