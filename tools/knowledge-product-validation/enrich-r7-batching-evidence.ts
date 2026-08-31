import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { DoclingDocumentParser } from '../../packages/plugins/document/docling-document-parser.ts'
import type { DocumentParseResult } from '../../packages/plugins/document/types.ts'

const PDF_PATH = process.env.RESEARCHHUB_PRODUCT_VALIDATION_PDF ?? 'C:\\Users\\Administrator\\Documents\\20260805-西部证券-AI算力行业：AI算力上游材料产业链研究报告.pdf'
const EVIDENCE_PATH = process.env.RESEARCHHUB_PRODUCT_VALIDATION_EVIDENCE ?? 'tests/knowledge/product-validation/evidence/c004-r7-real-pdf-summary.json'
const MAX_CHARS = 6000

type Chunk = DocumentParseResult['chunks'][number]
type Batch = { batchId: string; sectionIds: string[]; chunkIds: string[]; characterCount: number }

function batchPlan(chunks: Chunk[]): { sectionCount: number; batchCount: number; chunkCount: number; uniqueChunkCount: number; coveredChunkCount: number; duplicateCoverage: number; omittedChunkCount: number; chunkCountMin: number; chunkCountMax: number; chunkCountMedian: number; characterMin: number; characterMax: number; characterMedian: number; batches: Batch[]; chunkIds: string[] } {
  const groups = new Map<string, Chunk[]>()
  for (const chunk of chunks) { const key = chunk.section?.trim() || '(untitled)'; groups.set(key, [...(groups.get(key) ?? []), chunk]) }
  const sections = [...groups.entries()].map(([title, sectionChunks], index) => ({ sectionId: `section-${String(index + 1).padStart(4, '0')}`, title, chunks: sectionChunks }))
  const batches: Array<{ batchId: string; sectionIds: string[]; chunks: Chunk[] }> = []
  let current = { batchId: 'batch-0001', sectionIds: [] as string[], chunks: [] as Chunk[] }
  const size = (items: Chunk[]): number => items.reduce((sum, item) => sum + item.text.length, 0)
  const flush = (): void => { if (current.chunks.length) batches.push(current); current = { batchId: `batch-${String(batches.length + 2).padStart(4, '0')}`, sectionIds: [], chunks: [] } }
  for (const section of sections) {
    if (current.chunks.length && size(current.chunks) + size(section.chunks) > MAX_CHARS) flush()
    if (size(section.chunks) <= MAX_CHARS) { current.sectionIds.push(section.sectionId); current.chunks.push(...section.chunks); continue }
    for (const chunk of section.chunks) {
      if (current.chunks.length && size(current.chunks) + chunk.text.length > MAX_CHARS) flush()
      if (!current.sectionIds.includes(section.sectionId)) current.sectionIds.push(section.sectionId)
      current.chunks.push(chunk)
    }
  }
  flush()
  const plan = batches.map((batch) => ({ batchId: batch.batchId, sectionIds: batch.sectionIds, chunkIds: batch.chunks.map((chunk) => chunk.chunkId), characterCount: size(batch.chunks) }))
  const counts = plan.map((batch) => batch.chunkIds.length)
  const characters = plan.map((batch) => batch.characterCount)
  const median = (values: number[]): number => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)] ?? 0 }
  const covered = plan.flatMap((batch) => batch.chunkIds)
  const unique = new Set(covered)
  return { sectionCount: sections.length, batchCount: plan.length, chunkCount: chunks.length, uniqueChunkCount: new Set(chunks.map((chunk) => chunk.chunkId)).size, coveredChunkCount: unique.size, duplicateCoverage: covered.length - unique.size, omittedChunkCount: chunks.length - unique.size, chunkCountMin: Math.min(...counts), chunkCountMax: Math.max(...counts), chunkCountMedian: median(counts), characterMin: Math.min(...characters), characterMax: Math.max(...characters), characterMedian: median(characters), batches: plan, chunkIds: chunks.map((chunk) => chunk.chunkId) }
}

const evidence = JSON.parse(await readFile(EVIDENCE_PATH, 'utf8')) as Record<string, any>
const parser = new DoclingDocumentParser()
const bytes = Uint8Array.from(await readFile(PDF_PATH))
const parsed = await parser.parse({ bytes, filename: basename(PDF_PATH), mediaType: 'application/pdf' })
const plan = batchPlan(parsed.chunks)
const batching = evidence.firstRun.batching as Record<string, unknown>
Object.assign(batching, plan, { deterministicPlan: plan })
evidence.validationOnlyAudit = { type: 'deterministic batch-plan enrichment', modelInvocations: 0, source: 'Docling chunks and frozen 6000-character batching rule' }
await writeFile(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ evidencePath: EVIDENCE_PATH, parser: { pageCount: parsed.pageCount, chunks: parsed.chunks.length }, batching: { sectionCount: plan.sectionCount, batchCount: plan.batchCount, chunkCount: plan.chunkCount, uniqueChunkCount: plan.uniqueChunkCount, coveredChunkCount: plan.coveredChunkCount, omittedChunkCount: plan.omittedChunkCount, duplicateCoverage: plan.duplicateCoverage } }))
