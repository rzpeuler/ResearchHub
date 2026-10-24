import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { AkshareDataAdapter } from '../../plugins/research-acquisition/akshare.ts'
import { createValuationDataResolver } from '../../plugins/research-acquisition/valuation-data.ts'
import { normalizeMarketTradingDates, normalizeValuationDate } from '../../plugins/research-acquisition/valuation-normalization.ts'
import { materializePhase2CommonRequirement } from '../../data/requirements.ts'

const execFileAsync = promisify(execFile)
const tickers = [
  { symbol: '002487.SZ', ticker: '002487', name: '大金重工', exchange: 'SZ' as const },
  { symbol: '600519.SH', ticker: '600519', name: '贵州茅台', exchange: 'SH' as const },
]
const now = new Date()
const asOf = now.toISOString()
const periodEnd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
const dateToCompact = (value: string) => value.replace(/-/g, '')
const start = new Date(`${periodEnd}T00:00:00.000Z`)
start.setUTCDate(start.getUTCDate() - 30)
const dateRange = { startDate: dateToCompact(start.toISOString().slice(0, 10)), endDate: dateToCompact(periodEnd) }
const isoRange = { requestedStartDate: `${dateRange.startDate.slice(0, 4)}-${dateRange.startDate.slice(4, 6)}-${dateRange.startDate.slice(6, 8)}`, requestedEndDate: periodEnd }

function rowsOf(value: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object' && !Array.isArray(item))
  if (value && typeof value === 'object' && Array.isArray((value as Record<string, unknown>).data)) return rowsOf((value as Record<string, unknown>).data)
  return []
}

function errorCategory(message: string): string {
  if (/ProxyError|proxy/i.test(message)) return 'PROXY_ERROR'
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|Network is unreachable|NameResolutionError/i.test(message)) return 'DNS_NETWORK_CONNECTION'
  if (/timeout|timed out|ETIMEDOUT|AbortError/i.test(message)) return 'TIMEOUT'
  if (/\b(401|403)\b|Forbidden|Access Denied/i.test(message)) return 'ACCESS_DENIED'
  if (/AKSHARE_BRIDGE_/i.test(message)) return 'AKSHARE_BRIDGE_ERROR'
  if (/KeyError|AttributeError|unexpected keyword|parameter|column/i.test(message)) return 'UPSTREAM_API_OR_SCHEMA_CHANGE'
  return 'SOURCE_ERROR'
}

function sanitizedError(error: unknown): { category: string; code: string; message: string } {
  const raw = error instanceof Error ? error.message : String(error)
  const category = errorCategory(raw)
  const code = raw.match(/(?:AKSHARE_BRIDGE_[A-Z0-9_]+|ProxyError|NameResolutionError|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|HTTP\s+\d{3}|HTTPError)/i)?.[0] ?? category
  const message = raw.replace(/https?:\/\/[^\s)]+/gi, '[url-redacted]').replace(/(https?_proxy|all_proxy)=\S+/gi, '$1=[redacted]').replace(/\b[A-Za-z0-9._%+-]+:[^\s@]+@/g, '[credentials-redacted]@').slice(0, 220)
  return { category, code, message }
}

function rowDate(row: Record<string, unknown>): string | undefined {
  for (const key of ['日期', 'date', 'trade_date', '交易日期']) {
    const value = normalizeValuationDate(row[key])
    if (value) return value
  }
  return undefined
}

function eligibleMarketRows(value: unknown): number {
  const cutoff = Date.parse(asOf)
  return rowsOf(value).filter((row) => {
    const date = rowDate(row)
    const closeValue = row['收盘'] ?? row['收盘价'] ?? row.close ?? row.Close ?? row['收盘价(元)']
    const close = typeof closeValue === 'number' ? closeValue : typeof closeValue === 'string' ? Number(closeValue.replace(/,/g, '')) : Number.NaN
    return date !== undefined && date <= periodEnd && Number.isFinite(close) && close > 0 && Date.parse(`${date}T07:00:00.000Z`) <= cutoff
  }).length
}

async function main(): Promise<void> {
  const pythonCommand = 'python'
  const python = await execFileAsync(pythonCommand, ['-c', "import importlib.metadata,json,sys; print(json.dumps({'python':sys.version.split()[0],'akshare':importlib.metadata.version('akshare'),'requests':importlib.metadata.version('requests')}))"], { timeout: 15_000, windowsHide: true })
  const proxyNames = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']
  const proxyConfiguration = proxyNames.filter((name) => Boolean(process.env[name]?.trim())).map((name) => ({ variable: name, configured: true, value: '[redacted]' }))
  const proxyRoutes = await execFileAsync(pythonCommand, ['-c', "import ipaddress,json,requests.utils,urllib.parse; out={};\nfor origin in ['https://push2.eastmoney.com','https://push2his.eastmoney.com','https://web.ifzq.gtimg.cn','https://www.cninfo.com.cn','https://static.cninfo.com.cn']:\n p=requests.utils.get_environ_proxies(origin); route=p.get('https') or p.get('all'); u=urllib.parse.urlparse(route or ''); host=u.hostname or '';\n try: ip=ipaddress.ip_address(host); cls='loopback' if ip.is_loopback else 'private' if ip.is_private else 'public'\n except ValueError: cls='hostname' if host else 'none'\n out[urllib.parse.urlparse(origin).hostname]={'proxyConfigured':bool(route),'proxySchemes':sorted(p.keys()),'proxyHostClass':cls,'proxyPort':u.port,'proxyCredentialsPresent':bool(u.username or u.password)}\nprint(json.dumps(out))"], { timeout: 15_000, windowsHide: true })
  const client = new AkshareDataAdapter({ pythonCommand })
  const calls: Record<string, unknown>[] = []
  const perform = async (ticker: string, operationId: string, requestedDateRange: { startDate: string; endDate: string }, run: () => Promise<unknown>) => {
    const startedAt = new Date().toISOString()
    const startMs = performance.now()
    try {
      const raw = await run()
      const retrievedAt = new Date().toISOString()
      const rows = rowsOf(raw)
      const latestPriceDate = operationId.toLowerCase().includes('calendar') ? null : rows.map(rowDate).filter((date): date is string => date !== undefined).sort().at(-1) ?? null
      calls.push({ provider: operationId.includes('Tencent') ? 'Tencent' : operationId.toLowerCase().includes('calendar') ? 'AKShare/Sina' : 'EastMoney', operationId, ticker, requestedDateRange: { start: requestedDateRange.startDate, end: requestedDateRange.endDate }, startedAt, transportStatus: 'SUCCEEDED', httpStatus: null, errorCategory: rows.length === 0 ? 'DATA_EMPTY' : null, elapsedMs: Math.round(performance.now() - startMs), rowCount: rows.length, eligibleRowCount: operationId.includes('historicalMarketData') ? eligibleMarketRows(raw) : null, latestPriceDate, retrievedAt, fallbackTriggered: false, fallbackSelected: false })
      return raw
    } catch (error) {
      const retrievedAt = new Date().toISOString()
      const detail = sanitizedError(error)
      calls.push({ provider: operationId.includes('Tencent') ? 'Tencent' : operationId.toLowerCase().includes('calendar') ? 'AKShare/Sina' : 'EastMoney', operationId, ticker, requestedDateRange: { start: requestedDateRange.startDate, end: requestedDateRange.endDate }, startedAt, transportStatus: 'FAILED', httpStatus: null, errorCategory: detail.category, errorCode: detail.code, errorMessage: detail.message, elapsedMs: Math.round(performance.now() - startMs), rowCount: 0, eligibleRowCount: operationId.includes('historicalMarketData') ? 0 : null, latestPriceDate: null, retrievedAt, fallbackTriggered: false, fallbackSelected: false })
      return undefined
    }
  }

  const calendar = await perform('calendar', 'akshare.tradingCalendar', dateRange, () => client.tradingCalendar({ symbol: 'calendar', ...dateRange }))
  const calendarRows = rowsOf(calendar)
  const calendarDates = normalizeMarketTradingDates(calendar)
  for (const company of tickers) {
    await perform(company.symbol, 'akshare.companyBasic', { startDate: '', endDate: '' }, () => client.companyBasic({ symbol: company.ticker }))
    const eastmoney = await perform(company.symbol, 'akshare.historicalMarketData', dateRange, () => client.historicalMarketData({ symbol: company.symbol, ...dateRange }))
    const tencent = await perform(company.symbol, 'akshare.historicalMarketDataTencent', dateRange, () => client.historicalMarketDataTencent({ symbol: company.symbol, ...dateRange }))

    const resolver = createValuationDataResolver({
      akshare: client,
      company: { symbol: company.ticker, name: company.name, exchange: company.exchange === 'SH' ? 'SSE' : 'SZSE' },
      valuationDate: periodEnd,
      now: () => new Date().toISOString(),
    })
    const requirement = materializePhase2CommonRequirement('valuation_market_price', { workflowId: 'valuation', ticker: company.symbol, companyId: company.name, asOf, period: { end: periodEnd }, required: true })
    const resolved = await resolver.resolveOne(requirement)
    const byId = new Map([['akshare-historical-market-data', 'akshare.historicalMarketData'], ['akshare-tencent-historical-market-data', 'akshare.historicalMarketDataTencent']])
    for (const attempt of resolved.attempts) {
      const linked = [...calls].reverse().find((entry) => entry.ticker === company.symbol && entry.operationId === byId.get(attempt.sourceId))
      if (linked) {
        linked.fallbackTriggered = resolved.attempts.some((item) => item.fallbackLevel === 'FALLBACK_1')
        linked.fallbackSelected = attempt.status === 'SUCCESS' && resolved.source?.sourceId === attempt.sourceId
        if (attempt.status === 'SUCCESS' && resolved.value?.kind === 'market') linked.eligibleRowCount = eligibleMarketRows(resolved.value.raw)
      }
    }
    calls.push({ provider: 'ResearchHub Runtime DataResolver', operationId: 'valuation_market_price', ticker: company.symbol, requestedDateRange: { start: periodEnd, end: periodEnd }, transportStatus: resolved.status === 'AVAILABLE' ? 'RESOLVED' : 'BLOCKED', errorCategory: resolved.status === 'AVAILABLE' ? null : resolved.unavailableReason ?? 'NO_ELIGIBLE_POINT_IN_TIME_DATA', elapsedMs: resolved.attempts.reduce((sum, item) => sum + Math.max(0, Date.parse(item.completedAt) - Date.parse(item.startedAt)), 0), rowCount: resolved.value?.kind === 'market' ? rowsOf(resolved.value.raw).length : 0, eligibleRowCount: resolved.attempts.find((item) => item.status === 'SUCCESS') ? 1 : 0, latestPriceDate: resolved.source?.observedAt ?? null, retrievedAt: resolved.source?.retrievedAt ?? null, fallbackTriggered: resolved.attempts.some((item) => item.fallbackLevel === 'FALLBACK_1'), fallbackSelected: resolved.source?.originPublisher === 'Tencent', selectedPublisher: resolved.source?.originPublisher ?? null, attempts: resolved.attempts.map((item) => ({ sourceId: item.sourceId, fallbackLevel: item.fallbackLevel, status: item.status, diagnostic: item.diagnostic ?? null })), marketFreshness: resolved.source?.marketFreshness ?? null, selectedClose: resolved.value?.kind === 'market' ? resolved.value.observation.close : null })
    void eastmoney
    void tencent
  }

  const doclingCheckStart = performance.now()
  const doclingCheck = await execFileAsync(process.execPath, ['scripts/document-parser-runtime.mjs', '--check'], { timeout: 45_000, windowsHide: true, maxBuffer: 1_000_000 }).then((result) => ({ status: 'COMPLETED', output: result.stdout.trim(), elapsedMs: Math.round(performance.now() - doclingCheckStart) })).catch((error: unknown) => {
    const detail = error as Error & { readonly stdout?: string; readonly stderr?: string }
    return { status: 'FAILED', error: sanitizedError(error), stdout: detail.stdout?.trim() ?? '', stderr: detail.stderr?.trim() ?? '', elapsedMs: Math.round(performance.now() - doclingCheckStart) }
  })

  const report = {
    taskId: 'RHL-EXEC-004-001',
    phase: 'P0-A pre-fix production-equivalent market diagnostics',
    generatedAt: new Date().toISOString(),
    baselineMain: '46c53a1a15845a44b28ccbbfc87e9c776c8a6842',
    runtimeContext: { node: process.version, python: JSON.parse(python.stdout), proxyEnvironment: proxyConfiguration, pythonRequestsProxyRouting: JSON.parse(proxyRoutes.stdout), proxyValuesRecorded: false, dateRange: { start: isoRange.requestedStartDate, end: periodEnd }, asOf, calendar: { rowCount: calendarRows.length, firstDate: calendarDates[0] ?? null, lastDate: calendarDates.at(-1) ?? null } },
    operations: calls,
    doclingRuntimeCheck: doclingCheck,
    evidenceIntegrity: { rawProviderPayloadsStored: false, apiCredentialsStored: false, proxyValuesStored: false },
  }
  const out = 'tests/validation/evidence/RHL-EXEC-004-001-P0-A-market-diagnostics.json'
  await mkdir('tests/validation/evidence', { recursive: true })
  await writeFile(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify({ evidence: out, operations: calls.length, marketRows: calls.filter((item) => item.operationId === 'valuation_market_price').length, doclingRuntimeCheck: doclingCheck }, null, 2)}\n`)
}

await main()
