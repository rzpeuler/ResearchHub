import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
export interface AkshareDataRequest { readonly symbol: string; readonly startDate?: string; readonly endDate?: string }
export interface AkshareSecurityDirectoryRequest { readonly symbol?: string; readonly name?: string; readonly exchange?: string; readonly limit?: number }
export interface AkshareSecurityDirectoryEntry { readonly symbol: string; readonly name: string; readonly exchange: 'SH' | 'SZ' | 'BJ' }
export type AksharePeerComparisonFamily = 'growth' | 'valuation' | 'dupont' | 'scale'
export interface AksharePeerComparisonRequest { readonly symbol: string; readonly family: AksharePeerComparisonFamily; readonly correlatedSymbol?: string }
export interface AkshareForecastRequest extends AkshareDataRequest { readonly indicator?: string }
export interface AkshareInstitutionalResearchRequest { readonly date: string }
export interface AkshareDataClient { companyBasic(request: AkshareDataRequest): Promise<unknown>; financialData(request: AkshareDataRequest): Promise<unknown>; valuationFinancialIndicators?(request: AkshareDataRequest): Promise<unknown>; historicalMarketData(request: AkshareDataRequest): Promise<unknown>; securityDirectory?(request: AkshareSecurityDirectoryRequest): Promise<unknown>; peerComparison?(request: AksharePeerComparisonRequest): Promise<unknown>; profitForecastThs?(request: AkshareForecastRequest): Promise<unknown>; researchReportEm?(request: AkshareDataRequest): Promise<unknown>; profitForecastEm?(request?: AkshareDataRequest): Promise<unknown>; indexDaily?(request: AkshareDataRequest): Promise<unknown>; sectorPerformance?(request: AkshareDataRequest): Promise<unknown>; tradingCalendar?(request: AkshareDataRequest): Promise<unknown>; exchangeQaSzse?(request: AkshareDataRequest): Promise<unknown>; exchangeQaSzseAnswer?(request: AkshareDataRequest): Promise<unknown>; exchangeQaSse?(request: AkshareDataRequest): Promise<unknown>; institutionalResearchDetail?(request: AkshareInstitutionalResearchRequest): Promise<unknown> }
export interface AkshareClientOptions { readonly pythonCommand?: string; readonly timeoutMs?: number; readonly runner?: (script: string, args: readonly string[], timeoutMs?: number) => Promise<string>; readonly onCall?: (kind: string, args: readonly string[]) => void }

const BRIDGE = `import json,sys,akshare as ak
kind,symbol,start_date,end_date=sys.argv[1:5]
indicator=sys.argv[5] if len(sys.argv)>5 else ''
query_exchange=sys.argv[6].strip().upper() if len(sys.argv)>6 else ''
if kind=='basic': value=ak.stock_individual_info_em(symbol=symbol)
elif kind=='financial':
    market_symbol=symbol if symbol.endswith(('.SH','.SZ')) else symbol + ('.SH' if symbol.startswith('6') else '.SZ')
    value=ak.stock_financial_analysis_indicator_em(symbol=market_symbol).rename(columns={'REPORT_DATE':'report_date','NOTICE_DATE':'publication_date','EPSJB':'basic_eps','TOTALOPERATEREVE':'operating_revenue','PARENTNETPROFIT':'net_profit','XSMLL':'gross_margin'})
elif kind=='valuation-financial':
    market_symbol=symbol if symbol.endswith(('.SH','.SZ')) else symbol + ('.SH' if symbol.startswith('6') else '.SZ')
    value=ak.stock_financial_analysis_indicator_em(symbol=market_symbol).rename(columns={'REPORT_DATE':'report_date','NOTICE_DATE':'aggregator_notice_date','EPSJB':'eps_jb','BPS':'bvps'})
elif kind=='index': value=ak.stock_zh_index_daily(symbol=symbol)
elif kind=='sector': value=ak.stock_board_industry_name_em()
elif kind=='calendar': value=ak.tool_trade_date_hist_sina()
elif kind=='ths-profit-forecast': value=ak.stock_profit_forecast_ths(symbol=symbol, indicator=indicator)
elif kind=='em-research-report': value=ak.stock_research_report_em(symbol=symbol)
elif kind=='em-profit-forecast': value=ak.stock_profit_forecast_em()
elif kind=='szse-qa': value=ak.stock_irm_cninfo(symbol=symbol)
elif kind=='szse-qa-answer': value=ak.stock_irm_ans_cninfo(symbol=symbol)
elif kind=='sse-qa': value=ak.stock_sns_sseinfo(symbol=symbol)
elif kind=='em-institutional-research': value=ak.stock_jgdy_detail_em(date=start_date)
elif kind=='security-directory':
    rows=ak.stock_info_a_code_name()
    code_col='code' if 'code' in rows.columns else '代码'
    name_col='name' if 'name' in rows.columns else '名称'
    query_code=symbol.strip().upper().replace('.SH','').replace('.SZ','').replace('.BJ','')
    query_name=end_date.strip()
    if query_exchange and query_exchange not in ('SH','SZ','BJ'): raise ValueError('unsupported exchange')
    if query_code and query_name: rows=rows[(rows[code_col].astype(str).str.zfill(6)==query_code) | (rows[name_col].astype(str)==query_name)]
    elif query_code: rows=rows[rows[code_col].astype(str).str.zfill(6)==query_code]
    elif query_name: rows=rows[rows[name_col].astype(str)==query_name]
    limit=max(1,min(int(indicator or '20'),50))
    if len(rows)>limit: raise ValueError('exact security directory query exceeded its result limit')
    result=[]
    for _,row in rows.iterrows():
        code=str(row[code_col]).strip().zfill(6)
        name=str(row[name_col]).strip()
        exchange='SH' if code.startswith('6') else ('SZ' if code.startswith(('0','3')) else ('BJ' if code.startswith(('4','8')) else None))
        if len(code)==6 and code.isdigit() and name and exchange and (not query_exchange or exchange==query_exchange):
            result.append({'symbol':code,'name':name,'exchange':exchange})
    value=result
else: value=ak.stock_zh_a_hist(symbol=symbol,period='daily',start_date=start_date or None,end_date=end_date or None,adjust='')
print(json.dumps(value,ensure_ascii=False) if isinstance(value,list) else value.to_json(orient='records',force_ascii=False))`

export class AkshareDataAdapter implements AkshareDataClient {
  private readonly runner: (script: string, args: readonly string[], timeoutMs?: number) => Promise<string>
  private readonly onCall?: (kind: string, args: readonly string[]) => void
  constructor(options: AkshareClientOptions = {}) { this.timeoutMs = options.timeoutMs ?? 60_000; this.onCall = options.onCall; this.runner = options.runner ?? (async (script, args, timeoutMs = this.timeoutMs) => (await execFileAsync(options.pythonCommand ?? 'python', ['-c', script, ...args], { timeout: timeoutMs, maxBuffer: 8_000_000, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })).stdout) }
  companyBasic(request: AkshareDataRequest): Promise<unknown> { return this.run('basic', request) }
  financialData(request: AkshareDataRequest): Promise<unknown> { return this.run('financial', request) }
  valuationFinancialIndicators(request: AkshareDataRequest): Promise<unknown> { return this.run('valuation-financial', request) }
  historicalMarketData(request: AkshareDataRequest): Promise<unknown> { return this.run('market', request) }
  async securityDirectory(request: AkshareSecurityDirectoryRequest): Promise<readonly AkshareSecurityDirectoryEntry[]> {
    const symbol = request.symbol?.trim().toUpperCase()
    const name = request.name?.trim()
    const exchange = request.exchange?.trim().toUpperCase()
    if (!symbol && !name) throw new Error('AKShare security directory requires an exact symbol or name')
    if (symbol && !/^\d{6}(?:\.(?:SH|SZ|BJ))?$/.test(symbol)) throw new Error('AKShare security directory symbol must be a six digit ticker with an optional SH, SZ, or BJ suffix')
    if (exchange && exchange !== 'SH' && exchange !== 'SZ' && exchange !== 'BJ') throw new Error('AKShare security directory exchange must be SH, SZ, or BJ')
    if (name && (name.length > 100 || /[\u0000-\u001f]/.test(name))) throw new Error('AKShare security directory name must be at most 100 printable characters')
    const limit = request.limit ?? 20
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('AKShare security directory limit must be an integer from 1 to 50')
    const args = ['security-directory', symbol ?? '', '', name ?? '', String(limit), exchange ?? '']
    this.onCall?.('security-directory', args)
    const output = await this.runWithArgs(BRIDGE, args, 15_000)
    if (!Array.isArray(output) || output.length > limit) throw new Error('AKShare security directory returned an invalid or oversized result')
    return output.map((entry): AkshareSecurityDirectoryEntry => {
      if (typeof entry !== 'object' || entry === null) throw new Error('AKShare security directory returned an invalid entry')
      const candidate = entry as Record<string, unknown>
      const symbolValue = candidate.symbol
      const nameValue = candidate.name
      const exchangeValue = candidate.exchange
      if (typeof symbolValue !== 'string' || !/^\d{6}$/.test(symbolValue) || typeof nameValue !== 'string' || nameValue.length < 1 || nameValue.length > 200 || /[\u0000-\u001f]/.test(nameValue) || (exchangeValue !== 'SH' && exchangeValue !== 'SZ' && exchangeValue !== 'BJ')) throw new Error('AKShare security directory returned an invalid entry')
      const inferredExchange = symbolValue.startsWith('6') ? 'SH' : symbolValue.startsWith('0') || symbolValue.startsWith('3') ? 'SZ' : symbolValue.startsWith('4') || symbolValue.startsWith('8') ? 'BJ' : undefined
      if (inferredExchange !== exchangeValue) throw new Error('AKShare security directory exchange does not match the ticker prefix')
      return { symbol: symbolValue, name: nameValue, exchange: exchangeValue }
    })
  }
  async peerComparison(request: AksharePeerComparisonRequest): Promise<unknown> {
    const reportName = { growth: 'RPT_PCF10_INDUSTRY_GROWTH', valuation: 'RPT_PCF10_INDUSTRY_CVALUE', dupont: 'RPT_PCF10_INDUSTRY_DBFX', scale: 'RPT_PCF10_INDUSTRY_MARKET' }[request.family]
    const exchange = request.symbol.toUpperCase().endsWith('.SH') ? 'SH' : 'SZ'
    const ticker = request.symbol.toUpperCase().replace(/\.(SH|SZ)$/, '')
    const secucode = `${ticker}.${exchange}`
    const correlated = request.correlatedSymbol === undefined ? undefined : request.correlatedSymbol.toUpperCase().replace(/\.(SH|SZ)$/, '')
    const correlatedExchange = correlated === undefined ? undefined : correlated.startsWith('6') ? 'SH' : 'SZ'
    const filter = correlated === undefined ? `(SECUCODE="${secucode}")` : `(SECUCODE="${secucode}")(CORRE_SECUCODE="${correlated}.${correlatedExchange}")`
    const params = new URLSearchParams({ reportName, columns: request.family === 'scale' ? 'SECUCODE,SECURITY_CODE,SECURITY_NAME_ABBR,ORG_CODE,CORRE_SECUCODE,CORRE_SECURITY_CODE,CORRE_SECURITY_NAME,CORRE_ORG_CODE,TOTAL_CAP,FREECAP,TOTAL_OPERATEINCOME,NETPROFIT,REPORT_TYPE,TOTAL_CAP_RANK,FREECAP_RANK,TOTAL_OPERATEINCOME_RANK,NETPROFIT_RANK' : 'ALL', quoteColumns: '', filter, pageNumber: request.family === 'scale' ? '1' : '', pageSize: request.family === 'scale' ? (correlated === undefined ? '5' : '1') : '', sortTypes: request.family === 'scale' ? '-1' : '1', sortColumns: request.family === 'scale' ? 'TOTAL_CAP' : 'PAIMING', source: 'HSF10', client: 'PC' })
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await fetch(`https://datacenter.eastmoney.com/securities/api/data/v1/get?${params.toString()}`, { signal: controller.signal })
      if (!response.ok) throw new Error(`EastMoney peer comparison HTTP ${response.status}`)
      return await response.json() as unknown
    } finally { clearTimeout(timer) }
  }
  profitForecastThs(request: AkshareForecastRequest): Promise<unknown> { return this.run('ths-profit-forecast', request, request.indicator ?? '') }
  researchReportEm(request: AkshareDataRequest): Promise<unknown> { return this.run('em-research-report', request) }
  profitForecastEm(request: AkshareDataRequest = { symbol: '' }): Promise<unknown> { return this.run('em-profit-forecast', request) }
  exchangeQaSzse(request: AkshareDataRequest): Promise<unknown> { return this.run('szse-qa', request) }
  exchangeQaSzseAnswer(request: AkshareDataRequest): Promise<unknown> { return this.run('szse-qa-answer', request) }
  exchangeQaSse(request: AkshareDataRequest): Promise<unknown> { return this.run('sse-qa', request) }
  institutionalResearchDetail(request: AkshareInstitutionalResearchRequest): Promise<unknown> { return this.run('em-institutional-research', { symbol: '', startDate: request.date }) }
  indexDaily(request: AkshareDataRequest): Promise<unknown> { return this.run('index', request) }
  sectorPerformance(request: AkshareDataRequest): Promise<unknown> { return this.run('sector', request) }
  tradingCalendar(request: AkshareDataRequest): Promise<unknown> { return this.run('calendar', request) }
  private readonly timeoutMs: number
  private async run(kind: string, request: AkshareDataRequest, indicator?: string): Promise<unknown> { const args = [kind, request.symbol, request.startDate ?? '', request.endDate ?? '', ...(indicator === undefined ? [] : [indicator])]; this.onCall?.(kind, args); return this.runWithArgs(BRIDGE, args) }
  private async runWithArgs(script: string, args: readonly string[], timeoutMs = this.timeoutMs): Promise<unknown> { const output = await this.runner(script, args, timeoutMs); try { return JSON.parse(output) as unknown } catch (error) { throw new Error(`AKShare bridge returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`) } }
}
