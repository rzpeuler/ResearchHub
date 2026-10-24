import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { CninfoOfficialDisclosureClient, type OfficialDisclosureRecord } from '../../plugins/research-acquisition/official.ts'
import { DocumentInputResolver } from '../../plugins/document/input-resolver.ts'

const evidencePath = resolve(process.env.RHL_EXEC004_PDF_PROBE_EVIDENCE ?? 'tests/validation/evidence/RHL-EXEC-004-001-production-pdf-parser-probe.json')
const client = new CninfoOfficialDisclosureClient()
const cases = [
  { company: { symbol: '002487', name: '大金重工', exchange: 'SZSE' }, fiscalYear: 2025, fiscalPeriod: 'FY' as const, term: /2025年.*年度报告/u },
  { company: { symbol: '002487', name: '大金重工', exchange: 'SZSE' }, fiscalYear: 2026, fiscalPeriod: 'H1' as const, term: /2026年.*半年度报告/u },
  { company: { symbol: '600519', name: '贵州茅台', exchange: 'SSE' }, fiscalYear: 2025, fiscalPeriod: 'FY' as const, term: /2025年.*年度报告/u },
  { company: { symbol: '600519', name: '贵州茅台', exchange: 'SSE' }, fiscalYear: 2026, fiscalPeriod: 'H1' as const, term: /2026年.*半年度报告/u },
]
const resolver = new DocumentInputResolver({ pdfTextFirst: true })
const runs: Record<string, unknown>[] = []
for (const item of cases) {
  const discoverStart = performance.now()
  const records = await client.list({ company: item.company, asOf: new Date().toISOString(), limitPerKind: 20, filingPeriod: { fiscalYear: item.fiscalYear, fiscalPeriod: item.fiscalPeriod } })
  const record: OfficialDisclosureRecord | undefined = records.find((candidate) => item.term.test(candidate.title.normalize('NFKC').replace(/\s+/g, '')))
  const discoveryMs = Math.round(performance.now() - discoverStart)
  if (!record) { runs.push({ ticker: item.company.symbol, fiscalPeriod: `${item.fiscalYear}-${item.fiscalPeriod}`, status: 'NO_EXACT_PERIOD_RECORD', discoveryMs, recordCount: records.length }); continue }
  const downloadStart = performance.now()
  const response = await fetch(record.url, { headers: { accept: 'application/pdf' }, signal: AbortSignal.timeout(60_000) })
  const downloadMs = Math.round(performance.now() - downloadStart)
  if (!response.ok) { runs.push({ ticker: item.company.symbol, fiscalPeriod: `${item.fiscalYear}-${item.fiscalPeriod}`, status: 'DOWNLOAD_FAILED', httpStatus: response.status, discoveryMs, downloadMs }); continue }
  const bytes = new Uint8Array(await response.arrayBuffer())
  const source = await resolver.acquire({ type: 'bytes', bytes, originalFilename: 'cninfo-official.pdf', mediaType: 'application/pdf' })
  const parseStart = performance.now()
  try {
    const document = await resolver.parse(source)
    const text = document.normalizedText.normalize('NFKC').replace(/\s+/g, '')
    const statements = ['资产负债表', '利润表', '现金流量表'].map((term) => ({ term, present: text.includes(term) }))
    runs.push({ ticker: item.company.symbol, fiscalPeriod: `${item.fiscalYear}-${item.fiscalPeriod}`, title: record.title, announcementId: record.announcementId ?? null, officialUrl: record.url, publishedAt: record.publishedAt, discoveryMs, downloadMs, parseMs: Math.round(performance.now() - parseStart), status: 'PARSED', parser: document.parser, parserStats: document.stats, textHasPeriodMarker: item.term.test(document.normalizedText.normalize('NFKC').replace(/\s+/g, '')), statementMarkers: statements, textCharacters: text.length, documentSha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.byteLength, noTextPersisted: true })
  } catch (error) { runs.push({ ticker: item.company.symbol, fiscalPeriod: `${item.fiscalYear}-${item.fiscalPeriod}`, title: record.title, announcementId: record.announcementId ?? null, officialUrl: record.url, discoveryMs, downloadMs, parseMs: Math.round(performance.now() - parseStart), status: 'PARSE_FAILED', error: (error instanceof Error ? error.message : String(error)).slice(0, 900), byteLength: bytes.byteLength, documentSha256: createHash('sha256').update(bytes).digest('hex'), noTextPersisted: true }) }
}
const evidence = { taskId: 'RHL-EXEC-004-001', phase: 'production pypdf-to-Docling parser path', generatedAt: new Date().toISOString(), pythonExecutableClass: process.env.RESEARCHHUB_PYTHON_EXECUTABLE ? 'configured-managed-python' : 'workspace-default', artifactsConfigured: Boolean(process.env.RESEARCHHUB_DOCLING_ARTIFACTS_PATH), runs, secretsIncluded: false, rawPdfOrTextIncluded: false }
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ evidencePath, runs }, null, 2))
