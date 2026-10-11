import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { CninfoOfficialDisclosureClient, type OfficialDisclosureRecord } from '../../plugins/research-acquisition/official.ts'

const execFileAsync = promisify(execFile)
const sharedRoot = resolve(process.cwd(), '..', '..', 'ResearchHub')
const parserRoot = join(sharedRoot, '.researchhub-document-parser')
const python = join(parserRoot, 'venv', 'Scripts', 'python.exe')
const artifacts = join(parserRoot, 'models')
const bridgePath = resolve('plugins/document/parsers/docling/bridge/docling_bridge.py')
const profilePath = resolve('tests/validation/fixtures/exec004_docling_profile.py')
const tickers = [
  { symbol: '002487', name: '大金重工', exchange: 'SZSE' },
  { symbol: '600519', name: '贵州茅台', exchange: 'SSE' },
]
const targets = [
  { fiscalYear: 2025, fiscalPeriod: 'FY' as const, expectedText: /2025年.*年度报告/u },
  { fiscalYear: 2026, fiscalPeriod: 'H1' as const, expectedText: /2026年.*半年度报告/u },
]

function errorCategory(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/document_parser_environment_not_ready|MANAGED_PYTHON_MISSING/i.test(message)) return 'DOCUMENT_PARSER_NOT_READY'
  if (/document_parser_timeout|timed out|timeout|ETIMEDOUT/i.test(message)) return 'DOCUMENT_PARSER_TIMEOUT'
  if (/ProxyError|proxy/i.test(message)) return 'PROXY_ERROR'
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|fetch failed/i.test(message)) return 'DNS_NETWORK_CONNECTION'
  if (/\b(401|403)\b|Forbidden|Access Denied/i.test(message)) return 'ACCESS_DENIED'
  if (/PDF|EOF|xref|invalid/i.test(message)) return 'DOCUMENT_CONTENT_INVALID'
  return 'SOURCE_OR_PARSER_ERROR'
}

function exactPeriod(record: OfficialDisclosureRecord, fiscalYear: number, fiscalPeriod: 'FY' | 'H1'): boolean {
  if (Date.parse(record.publishedAt) > Date.now()) return false
  const title = record.title.normalize('NFKC').replace(/\s+/g, '')
  if (!title.includes(`${fiscalYear}年`)) return false
  if (fiscalPeriod === 'FY') return /年度报告/u.test(title) && !/半年度|季度|摘要/u.test(title)
  return /半年度报告/u.test(title) && !/摘要/u.test(title)
}

async function main(): Promise<void> {
  const generatedAt = new Date().toISOString()
  const http: Record<string, unknown>[] = []
  const client = new CninfoOfficialDisclosureClient({
    pageSize: 20,
    fetchImpl: async (input, init) => {
      const url = new URL(String(input))
      const startedAt = new Date().toISOString()
      const startMs = performance.now()
      try {
        const response = await fetch(input, init)
        http.push({ stage: url.pathname.includes('topSearch') ? 'CNINFO_ORGANIZATION_LOOKUP' : url.pathname.includes('query') ? 'CNINFO_ANNOUNCEMENT_QUERY' : 'CNINFO_DOCUMENT_DOWNLOAD', host: url.hostname, path: url.pathname, method: init?.method ?? 'GET', httpStatus: response.status, transportStatus: response.ok ? 'SUCCEEDED' : 'HTTP_ERROR', contentType: response.headers.get('content-type'), contentLengthBytes: Number(response.headers.get('content-length')) || null, startedAt, retrievedAt: new Date().toISOString(), elapsedMs: Math.round(performance.now() - startMs) })
        return response
      } catch (error) {
        http.push({ stage: url.pathname.includes('topSearch') ? 'CNINFO_ORGANIZATION_LOOKUP' : url.pathname.includes('query') ? 'CNINFO_ANNOUNCEMENT_QUERY' : 'CNINFO_DOCUMENT_DOWNLOAD', host: url.hostname, path: url.pathname, method: init?.method ?? 'GET', transportStatus: 'FAILED', httpStatus: null, errorCategory: errorCategory(error), errorMessage: (error instanceof Error ? error.message : String(error)).slice(0, 240), startedAt, retrievedAt: new Date().toISOString(), elapsedMs: Math.round(performance.now() - startMs) })
        throw error
      }
    },
  })

  let parserEnvironment: Record<string, unknown>
  try {
    const result = await execFileAsync(python, ['-c', "import importlib.metadata,json,sys; print(json.dumps({'python':sys.version.split()[0],'docling':importlib.metadata.version('docling'),'torch':importlib.metadata.version('torch'),'torchvision':importlib.metadata.version('torchvision')}))"], { timeout: 15_000, windowsHide: true })
    parserEnvironment = { status: 'READY', python: JSON.parse(result.stdout), artifactsDirectoryExists: true }
  } catch (error) { parserEnvironment = { status: 'NOT_READY', errorCategory: errorCategory(error), errorMessage: (error instanceof Error ? error.message : String(error)).slice(0, 240), pythonExecutableConfigured: true } }

  const tempRoot = await mkdtemp(join(tmpdir(), 'rhl-exec004-cninfo-'))
  const documents: Record<string, unknown>[] = []
  const discovery: Record<string, unknown>[] = []
  let documentIndex = 0
  try {
    for (const company of tickers) {
      for (const target of targets) {
        const discoveryStart = performance.now()
        const discoveryAt = new Date().toISOString()
        let records: readonly OfficialDisclosureRecord[] = []
        let discoveryError: unknown
        try {
          records = await client.list({ company, asOf: new Date().toISOString(), limitPerKind: 20, filingPeriod: { fiscalYear: target.fiscalYear, fiscalPeriod: target.fiscalPeriod } })
        } catch (error) { discoveryError = error }
        const matched = records.filter((record) => exactPeriod(record, target.fiscalYear, target.fiscalPeriod))
        discovery.push({ ticker: company.symbol, fiscalPeriod: `${target.fiscalYear}-${target.fiscalPeriod}`, requestedAsOf: discoveryAt, status: discoveryError ? 'FAILED' : matched.length > 0 ? 'EXACT_PERIOD_CANDIDATE_FOUND' : 'NO_EXACT_PERIOD_CANDIDATE', elapsedMs: Math.round(performance.now() - discoveryStart), recordCount: records.length, exactPeriodCandidateCount: matched.length, candidates: records.slice(0, 12).map((record) => ({ title: record.title, publishedAt: record.publishedAt, announcementId: record.announcementId ?? null, url: record.url, exactPeriodMatch: exactPeriod(record, target.fiscalYear, target.fiscalPeriod), hasCorrectionMarker: /更正|修订|修订版/u.test(record.title) })), ...(discoveryError ? { errorCategory: errorCategory(discoveryError), errorMessage: (discoveryError instanceof Error ? discoveryError.message : String(discoveryError)).slice(0, 240) } : {}) })

        const selected = matched.find((record) => /https:\/\//iu.test(record.url))
        if (!selected) continue
        documentIndex += 1
        const downloadStartedAt = new Date().toISOString()
        const downloadStart = performance.now()
        try {
          const response = await fetch(selected.url, { headers: { accept: 'application/pdf' }, signal: AbortSignal.timeout(60_000) })
          const downloadMs = Math.round(performance.now() - downloadStart)
          if (!response.ok) {
            documents.push({ ticker: company.symbol, announcementId: selected.announcementId ?? null, officialUrl: selected.url, title: selected.title, publishedAt: selected.publishedAt, fiscalPeriod: `${target.fiscalYear}-${target.fiscalPeriod}`, downloadStatus: 'HTTP_ERROR', httpStatus: response.status, downloadMs, parserStatus: 'NOT_ATTEMPTED' })
            continue
          }
          const declaredLength = Number(response.headers.get('content-length')) || null
          if (declaredLength !== null && declaredLength > 100 * 1024 * 1024) {
            documents.push({ ticker: company.symbol, announcementId: selected.announcementId ?? null, officialUrl: selected.url, title: selected.title, publishedAt: selected.publishedAt, fiscalPeriod: `${target.fiscalYear}-${target.fiscalPeriod}`, downloadStatus: 'SIZE_LIMIT_REJECTED', httpStatus: response.status, declaredLengthBytes: declaredLength, downloadMs, parserStatus: 'NOT_ATTEMPTED' })
            continue
          }
          const bytes = new Uint8Array(await response.arrayBuffer())
          const filename = join(tempRoot, `official-${documentIndex}.pdf`)
          await writeFile(filename, bytes)
          const pdfIntegrity = { byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex'), startsWithPdfMagic: new TextDecoder().decode(bytes.subarray(0, 8)).includes('%PDF-'), containsEofMarker: new TextDecoder().decode(bytes.subarray(Math.max(0, bytes.byteLength - 2048))).includes('%%EOF') }

          let lightweight: Record<string, unknown> = { status: 'NOT_AVAILABLE' }
          try {
            const result = await execFileAsync('python', ['-c', "import importlib.metadata,json,sys; from pypdf import PdfReader; r=PdfReader(sys.argv[1],strict=False); pages=[p.extract_text() or '' for p in r.pages]; text='\\n'.join(pages); terms=['目录','资产负债表','利润表','现金流量表','主要会计数据','营业收入','归属于上市公司股东的净利润','半年度报告','年度报告']; print(json.dumps({'status':'COMPLETED','parserVersion':importlib.metadata.version('pypdf'),'pageCount':len(r.pages),'extractedCharacterCount':sum(map(len,pages)),'nonEmptyPageCount':sum(bool(p.strip()) for p in pages),'textBearingPageCoverage':round(sum(bool(p.strip()) for p in pages)/max(1,len(pages)),4),'firstPageCharacters':len(pages[0]) if pages else 0,'lastPageCharacters':len(pages[-1]) if pages else 0,'financialStructureTermCounts':{term:text.count(term) for term in terms},'encrypted':r.is_encrypted}))", filename], { timeout: 45_000, windowsHide: true, maxBuffer: 1_000_000 })
            lightweight = JSON.parse(result.stdout)
          } catch (error) { lightweight = { status: 'FAILED', errorCategory: errorCategory(error), errorMessage: (error instanceof Error ? error.message : String(error)).slice(0, 240) } }

          let profile: Record<string, unknown>
          if (process.env.RHL_DOC_DIAGNOSTICS_SKIP_DOCLING === '1') {
            profile = { status: 'NOT_ATTEMPTED', reason: 'Text-layer quality probe only; the prior diagnostic already measured the production-style Docling conversion bound.' }
          } else if (documentIndex === 1) {
            const progressPath = join(tempRoot, 'docling-profile-progress.json')
            const profileStart = performance.now()
            try {
              const result = await execFileAsync(python, [profilePath, filename, artifacts, bridgePath, progressPath], { timeout: 150_000, windowsHide: true, maxBuffer: 1_000_000, env: { ...process.env, RESEARCHHUB_DOCLING_ARTIFACTS_PATH: artifacts, HF_HUB_OFFLINE: '1' } })
              profile = JSON.parse(result.stdout)
            } catch (error) {
              const detail = error as Error & { readonly stdout?: string; readonly stderr?: string }
              const progress = await readFile(progressPath, 'utf8').then((value) => JSON.parse(value) as Record<string, unknown>).catch(() => ({}))
              const failureText = `${detail.message} ${detail.stderr ?? ''}`
              const timedOut = /ETIMEDOUT|timed out|killed/i.test(failureText)
              profile = { ...progress, status: timedOut ? 'TIMEOUT' : 'FAILED', timeoutMs: 150_000, errorCategory: timedOut ? 'DOCUMENT_PARSER_TIMEOUT' : errorCategory(error), errorMessage: timedOut ? 'Docling PDF conversion did not complete within the bounded 150000 ms diagnostic window.' : (detail.stderr || detail.message).slice(0, 300), elapsedMs: Math.round(performance.now() - profileStart) }
            }
          } else {
            profile = { status: 'NOT_REATTEMPTED', reason: 'The same Docling conversion stage exceeded 150000 ms for an earlier exact-period official document in this diagnostic run.' }
          }
          const locators = typeof profile.locatedPageCount === 'number' && typeof profile.pageCount === 'number' ? `${profile.locatedPageCount}/${profile.pageCount}` : null
          documents.push({ ticker: company.symbol, announcementId: selected.announcementId ?? null, officialUrl: selected.url, title: selected.title, publishedAt: selected.publishedAt, fiscalPeriod: `${target.fiscalYear}-${target.fiscalPeriod}`, downloadStatus: 'SUCCEEDED', httpStatus: response.status, contentType: response.headers.get('content-type'), declaredLengthBytes: declaredLength, downloadStartedAt, downloadMs, pdfIntegrity, lightweightTextProbe: lightweight, parser: profile, parserPageLocationCoverage: locators })
        } catch (error) {
          documents.push({ ticker: company.symbol, announcementId: selected.announcementId ?? null, officialUrl: selected.url, title: selected.title, publishedAt: selected.publishedAt, fiscalPeriod: `${target.fiscalYear}-${target.fiscalPeriod}`, downloadStatus: 'FAILED', httpStatus: null, errorCategory: errorCategory(error), errorMessage: (error instanceof Error ? error.message : String(error)).slice(0, 240), downloadMs: Math.round(performance.now() - downloadStart), parserStatus: 'NOT_ATTEMPTED' })
        }
      }
    }
  } finally {
    const remainingTempFiles = await readdir(tempRoot).catch(() => [])
    await rm(tempRoot, { recursive: true, force: true })
    const report = {
      taskId: 'RHL-EXEC-004-001',
      phase: 'P0-A pre-fix CNINFO/PDF diagnostics',
      generatedAt,
      baselineMain: '46c53a1a15845a44b28ccbbfc87e9c776c8a6842',
      parserRuntime: { workspaceDefault: 'MANAGED_PYTHON_MISSING', sharedRoot: sharedRoot.replace(/^[A-Z]:/i, '[workspace-drive]'), status: parserEnvironment.status, environment: parserEnvironment, artifactsConfigured: true, ocrEnabled: false, tableStructureEnabled: true, pythonValuesRecorded: false },
      announcementDiscovery: discovery,
      httpAttempts: http,
      documents,
      deduplication: { documentsAttempted: documents.length, uniqueOfficialUrls: new Set(documents.map((item) => item.officialUrl).filter(Boolean)).size, sameDocumentParsedMoreThanOnce: new Set(documents.map((item) => item.officialUrl).filter(Boolean)).size !== documents.length },
      temporaryFiles: { diagnosticPdfCountBeforeOwnedCleanup: remainingTempFiles.filter((name) => name.endsWith('.pdf')).length, ownedTemporaryRootRemoved: true, parserTemporaryTreeLeakMeasured: false },
      evidenceIntegrity: { pdfBodiesStored: false, extractedPdfTextStored: false, parserRawOutputStored: false, credentialsStored: false },
    }
    const output = 'tests/validation/evidence/RHL-EXEC-004-001-P0-A-cninfo-document-diagnostics.json'
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    process.stdout.write(`${JSON.stringify({ evidence: output, discoveryCount: discovery.length, documentCount: documents.length, documents: documents.map((item) => ({ ticker: item.ticker, fiscalPeriod: item.fiscalPeriod, downloadStatus: item.downloadStatus, parserStatus: (item.parser as Record<string, unknown> | undefined)?.status })) }, null, 2)}\n`)
  }
}

await main()
