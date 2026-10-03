import { createHash } from 'node:crypto'
import { THEME_FRAMEWORK_BOUNDS } from '../../skills/theme-framework/contracts.ts'
import type { StructuredDocument } from '../../plugins/document/contracts.ts'

export const THEME_FRAMEWORK_RAW_EVIDENCE_LIMITS = Object.freeze({
  maxExcerptsPerRaw: 16,
  maxExcerptLength: THEME_FRAMEWORK_BOUNDS.maxExcerpt,
})

export interface ThemeFrameworkRawEvidenceExcerpt {
  readonly evidenceId: string
  readonly blockId: string
  readonly order: number
  readonly page: number | null
  readonly sectionTitle: string | null
  /** An exact, bounded prefix of the selected StructuredDocument block text. */
  readonly excerpt: string
}

interface SectionBucket {
  readonly key: string
  readonly blocks: StructuredDocument['blocks'][number][]
}

function compareBlocks(left: StructuredDocument['blocks'][number], right: StructuredDocument['blocks'][number]): number {
  return left.order - right.order || left.blockId.localeCompare(right.blockId)
}

function sectionKey(block: StructuredDocument['blocks'][number]): string {
  if (block.sectionRef) return `section:${block.sectionRef}`
  const path = block.locator.sectionPath?.map((part) => part.trim()).filter(Boolean) ?? []
  if (path.length > 0) return `path:${path.join('\u0000')}`
  if (block.page !== null) return `page:${block.page}`
  return 'unsectioned'
}

function sectionTitle(
  block: StructuredDocument['blocks'][number],
  sectionsById: ReadonlyMap<string, string>,
): string | null {
  const fromSection = block.sectionRef ? sectionsById.get(block.sectionRef) : undefined
  if (fromSection) return fromSection
  const path = block.locator.sectionPath?.map((part) => part.trim()).filter(Boolean) ?? []
  return path.at(-1) ?? null
}

export function themeFrameworkRawEvidenceId(sourceRef: string, rawRef: string, blockId: string): string {
  const digest = createHash('sha256').update(`${sourceRef}\u0000${rawRef}\u0000${blockId}`, 'utf8').digest('hex').slice(0, 32)
  return `raw-evidence-${digest}`
}

function evenlySpacedIndices(length: number, count: number): number[] {
  if (count <= 0 || length <= 0) return []
  if (count === 1) return [Math.floor((length - 1) / 2)]
  return Array.from({ length: count }, (_, index) => Math.round((index * (length - 1)) / (count - 1)))
}

/**
 * Selects a deterministic, topic-independent set of body excerpts. It first
 * covers document sections, then samples the remaining blocks across document
 * order. The returned values retain only bounded snippets and exact locators.
 */
export function sampleThemeFrameworkRawEvidence(input: {
  readonly document: StructuredDocument
  readonly sourceRef: string
  readonly rawRef: string
  readonly maxExcerptsPerRaw?: number
  readonly maxExcerptLength?: number
}): readonly ThemeFrameworkRawEvidenceExcerpt[] {
  const maxExcerpts = Math.max(0, Math.min(THEME_FRAMEWORK_RAW_EVIDENCE_LIMITS.maxExcerptsPerRaw, Math.floor(input.maxExcerptsPerRaw ?? THEME_FRAMEWORK_RAW_EVIDENCE_LIMITS.maxExcerptsPerRaw)))
  const maxExcerptLength = Math.max(0, Math.min(THEME_FRAMEWORK_RAW_EVIDENCE_LIMITS.maxExcerptLength, Math.floor(input.maxExcerptLength ?? THEME_FRAMEWORK_RAW_EVIDENCE_LIMITS.maxExcerptLength)))
  if (maxExcerpts === 0 || maxExcerptLength === 0) return []

  const orderedBlocks = [...input.document.blocks]
    .filter((block) => block.text.trim().length > 0)
    .sort(compareBlocks)
  if (orderedBlocks.length === 0) return []

  const bucketsByKey = new Map<string, SectionBucket>()
  for (const block of orderedBlocks) {
    const key = sectionKey(block)
    const bucket = bucketsByKey.get(key) ?? { key, blocks: [] }
    bucket.blocks.push(block)
    bucketsByKey.set(key, bucket)
  }
  const buckets = [...bucketsByKey.values()]
  const excerptCount = Math.min(maxExcerpts, orderedBlocks.length)
  const sectionIndices = evenlySpacedIndices(buckets.length, Math.min(buckets.length, excerptCount))
  const selected = new Set<string>()
  for (const index of sectionIndices) {
    const first = buckets[index]?.blocks[0]
    if (first) selected.add(first.blockId)
  }

  const remaining = orderedBlocks.filter((block) => !selected.has(block.blockId))
  const remainingSlots = excerptCount - selected.size
  for (const index of evenlySpacedIndices(remaining.length, remainingSlots)) {
    const block = remaining[index]
    if (block) selected.add(block.blockId)
  }

  // Defend against repeated/malformed block IDs while preserving the same
  // deterministic document-order projection.
  const selectedBlocks: StructuredDocument['blocks'][number][] = []
  const emitted = new Set<string>()
  for (const block of orderedBlocks) {
    if (!selected.has(block.blockId) || emitted.has(block.blockId)) continue
    emitted.add(block.blockId)
    selectedBlocks.push(block)
  }
  const sectionsById = new Map(input.document.sections.map((section) => [section.sectionId, section.title?.trim() || '']))
  return selectedBlocks.map((block) => ({
    evidenceId: themeFrameworkRawEvidenceId(input.sourceRef, input.rawRef, block.blockId),
    blockId: block.blockId,
    order: block.order,
    page: block.page,
    sectionTitle: sectionTitle(block, sectionsById),
    excerpt: block.text.trim().slice(0, maxExcerptLength),
  }))
}
