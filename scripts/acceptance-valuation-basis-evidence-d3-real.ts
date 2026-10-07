import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { AkshareDataAdapter } from '../plugins/research-acquisition/akshare.ts'
import { CninfoOfficialDisclosureClient, cninfoShanghaiCalendarDate } from '../plugins/research-acquisition/official.ts'
import { validateUsableAcquisitionPayload } from '../plugins/research-acquisition/payload-validation.ts'
import { normalizeValuationFinancialData, normalizeValuationMarketData } from '../plugins/research-acquisition/valuation-normalization.ts'
import { resolveValuationBasisEvidence } from '../workflows/valuation/basis-evidence.ts'

const enabled = process.env.RESEARCHHUB_RUN_REAL_VALUATION_BASIS === '1'
const repoRoot = resolve(import.meta.dirname, '..')
const evidencePath = resolve(repoRoot, 'runtime-data', 'validation', 'rhl-d3-001-real-acceptance.json')
const targets = ['600519', '000333', '300750', '601398']
const now = new Date().toISOString()

if (!enabled) {
  console.log(JSON.stringify({ classification: 'REAL_ACCEPTANCE_NOT_RUN', reason: 'Set RESEARCHHUB_RUN_REAL_VALUATION_BASIS=1 to enable external transport.' }))
} else {
  const akshare = new AkshareDataAdapter({ timeoutMs: 60_000 })
  const cninfoRequests: Array<Record<string, unknown>> = []
  const cninfo = new CninfoOfficialDisclosureClient({ timeoutMs: 20_000, fetchImpl: async (input, init = {}) => {
    const form = init.body instanceof URLSearchParams ? Object.fromEntries(init.body.entries()) : undefined
    try {
      const response = await fetch(input, init)
      const summary: Record<string, unknown> = { endpoint: String(input), method: init.method ?? 'GET', status: response.status, ...(form === undefined ? {} : { form }) }
      if (String(input).includes('/hisAnnouncement/query')) {
        try { const payload = await response.clone().json() as Record<string, unknown>; const rows = Array.isArray(payload.announcements) ? payload.announcements : []; summary.rawAnnouncementCount = rows.length; summary.totalPages = payload.totalpages ?? null; summary.hasMore = payload.hasMore ?? null } catch { summary.rawAnnouncementCount = null }
      }
      cninfoRequests.push(summary)
      return response
    } catch (error) { cninfoRequests.push({ endpoint: String(input), method: init.method ?? 'GET', status: 'TRANSPORT_ERROR', error: error instanceof Error ? error.message : String(error), ...(form === undefined ? {} : { form }) }); throw error }
  } })
  const results: Record<string, unknown> = {}
  for (const symbol of targets) {
    const stages: Record<string, unknown> = {}
    let financial: unknown = []
    let market: unknown = []
    try { financial = await akshare.valuationFinancialIndicators({ symbol }); stages.eastmoneyFinancial = { status: validateUsableAcquisitionPayload(financial).status, rowCount: Array.isArray(financial) ? financial.length : null } } catch (error) { stages.eastmoneyFinancial = { status: 'UNAVAILABLE', error: error instanceof Error ? error.message : String(error) } }
    try { market = await akshare.historicalMarketData({ symbol, endDate: now.slice(0, 10) }); stages.marketTransport = { status: validateUsableAcquisitionPayload(market).status, rowCount: Array.isArray(market) ? market.length : null } } catch (error) { stages.marketTransport = { status: 'UNAVAILABLE', error: error instanceof Error ? error.message : String(error) } }
    const financialNormalized = normalizeValuationFinancialData(financial)
    const marketNormalized = normalizeValuationMarketData(market, now)
    const row = financialNormalized.rows[0]
    let publication: unknown
    if (row) {
      const requestStart = cninfoRequests.length
      try { publication = await cninfo.resolveAnnualReportPublication({ company: { symbol }, fiscalYear: row.basisFiscalYear, asOf: now }); const queries = cninfoRequests.slice(requestStart).filter((item) => String(item.endpoint).includes('/hisAnnouncement/query')); stages.cninfoPublication = publication ? { status: 'FOUND', sourceUrl: (publication as { sourceUrl: string }).sourceUrl, officialPublishedAt: (publication as { officialPublishedAt: string }).officialPublishedAt, officialPublishedCalendarDate: cninfoShanghaiCalendarDate((publication as { officialPublishedAt: string }).officialPublishedAt), rawAnnouncementCount: queries.reduce((sum, item) => sum + Number(item.rawAnnouncementCount ?? 0), 0) } : { status: queries.some((item) => item.status === 'TRANSPORT_ERROR') ? 'CNINFO_TRANSPORT_UNAVAILABLE' : queries.every((item) => Number(item.rawAnnouncementCount ?? 0) === 0) ? 'CNINFO_ANNUAL_REPORT_QUERY_EMPTY_UNEXPECTED' : 'CNINFO_ANNUAL_REPORT_NOT_FOUND', rawAnnouncementCount: queries.reduce((sum, item) => sum + Number(item.rawAnnouncementCount ?? 0), 0) } } catch (error) { stages.cninfoPublication = { status: 'CNINFO_TRANSPORT_UNAVAILABLE', error: error instanceof Error ? error.message : String(error) } }
    } else stages.cninfoPublication = { status: 'NOT_ATTEMPTED', reason: 'No annual EastMoney row' }
    if (symbol === '600519') {
      const historicalPublication: Record<string, unknown> = {}; const rawWindows: Record<string, Record<string, unknown>> = {}
      for (const [window, asOf] of [['beforePublication', '2025-03-01T00:00:00.000Z'], ['afterPublication', '2025-04-10T00:00:00.000Z']] as const) {
        const requestStart = cninfoRequests.length
        try {
          const historical = await cninfo.resolveAnnualReportPublication({ company: { symbol }, fiscalYear: 2024, asOf })
          const queries = cninfoRequests.slice(requestStart).filter((item) => String(item.endpoint).includes('/hisAnnouncement/query')); rawWindows[window] = historical === undefined ? { recordStatus: 'NOT_FOUND', rawAnnouncementCount: queries.reduce((sum, item) => sum + Number(item.rawAnnouncementCount ?? 0), 0), transportUnavailable: queries.some((item) => item.status === 'TRANSPORT_ERROR') } : { recordStatus: 'FOUND', officialPublishedAt: historical.officialPublishedAt, officialPublishedCalendarDate: cninfoShanghaiCalendarDate(historical.officialPublishedAt), sourceUrl: historical.sourceUrl, rawAnnouncementCount: queries.reduce((sum, item) => sum + Number(item.rawAnnouncementCount ?? 0), 0) }
        } catch (error) { rawWindows[window] = { recordStatus: 'UNAVAILABLE', error: error instanceof Error ? error.message : String(error) } }
      }
      const after = rawWindows.afterPublication; const before = rawWindows.beforePublication; historicalPublication.afterPublication = after?.recordStatus === 'FOUND' ? { ...after, status: 'CNINFO_KNOWN_RECORD_VERIFIED', pitClassification: 'PUBLICATION_VERIFIED_VALUE_VERSION_UNVERIFIED', strictHistoricalBasisEligible: false } : { ...after, status: after?.recordStatus === 'UNAVAILABLE' || after?.transportUnavailable ? 'CNINFO_TRANSPORT_UNAVAILABLE' : 'CNINFO_ANNUAL_REPORT_QUERY_EMPTY_UNEXPECTED', pitClassification: 'UNVERIFIED_QUERY_RESULT' }; historicalPublication.beforePublication = before?.recordStatus === 'NOT_FOUND' && after?.recordStatus === 'FOUND' ? { ...before, status: 'CNINFO_ANNUAL_REPORT_NOT_FOUND', pitClassification: 'DATA_NOT_PUBLISHED' } : { ...before, status: before?.recordStatus === 'UNAVAILABLE' || before?.transportUnavailable ? 'CNINFO_TRANSPORT_UNAVAILABLE' : before?.recordStatus === 'FOUND' ? 'UNEXPECTED_RECORD_BEFORE_CUTOFF' : 'CNINFO_ANNUAL_REPORT_QUERY_EMPTY_UNEXPECTED', pitClassification: 'UNVERIFIED_QUERY_RESULT' }
      stages.historicalPublicationTests = historicalPublication
    }
    if (symbol === '000333') {
      const requestStart = cninfoRequests.length
      try { const known = await cninfo.resolveAnnualReportPublication({ company: { symbol }, fiscalYear: 2024, asOf: '2025-04-10T00:00:00.000Z' }); const queries = cninfoRequests.slice(requestStart).filter((item) => String(item.endpoint).includes('/hisAnnouncement/query')); stages.cninfoKnownRecord = known === undefined ? { status: queries.some((item) => item.status === 'TRANSPORT_ERROR') ? 'CNINFO_TRANSPORT_UNAVAILABLE' : 'CNINFO_ANNUAL_REPORT_QUERY_EMPTY_UNEXPECTED', rawAnnouncementCount: queries.reduce((sum, item) => sum + Number(item.rawAnnouncementCount ?? 0), 0) } : { status: 'CNINFO_KNOWN_RECORD_VERIFIED', reportTitle: known.reportTitle, officialPublishedAt: known.officialPublishedAt, officialPublishedCalendarDate: cninfoShanghaiCalendarDate(known.officialPublishedAt), sourceUrl: known.sourceUrl, rawAnnouncementCount: queries.reduce((sum, item) => sum + Number(item.rawAnnouncementCount ?? 0), 0) } } catch (error) { stages.cninfoKnownRecord = { status: 'CNINFO_TRANSPORT_UNAVAILABLE', error: error instanceof Error ? error.message : String(error) } }
    }
    if (marketNormalized.observation && row && publication && stages.cninfoPublication && typeof stages.cninfoPublication === 'object') stages.basisResolution = resolveValuationBasisEvidence({ market: marketNormalized.observation, financialRows: financialNormalized.rows, publication: publication as never, valuationDate: now, now, retrievedAt: now, marketRetrievedAt: now })
    else stages.basisResolution = { status: 'UNAVAILABLE', diagnostics: [...financialNormalized.diagnostics, ...marketNormalized.diagnostics] }
    results[symbol] = stages
  }
  const serialized = { generatedAt: now, taskId: 'RHL-D3-001', classification: 'REAL_SOURCE_ACCEPTANCE_ATTEMPTED', targets, stages: results, secretsIncluded: false, rawBodiesIncluded: false }
  await mkdir(resolve(repoRoot, 'runtime-data', 'validation'), { recursive: true })
  await writeFile(evidencePath, `${JSON.stringify(serialized, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(serialized, null, 2))
}
