import { useState } from 'react'
import type { ReactElement, FormEvent } from 'react'
import { RuntimeClient, RuntimeClientError, type ResearchStartResponse } from '../../api/runtime-client'
import { useLanguage } from '../../i18n'

type Operation = 'company' | 'industry' | 'earnings' | 'valuation' | 'event' | 'thesis'
const operationLabels: Record<Operation, readonly [string, string]> = { company: ['公司研究', 'Company'], industry: ['行业研究', 'Industry'], earnings: ['业绩复盘', 'Earnings'], valuation: ['估值分析', 'Valuation'], event: ['事件研究', 'Event'], thesis: ['论点压力测试', 'Thesis'] }
const operationDescriptions: Record<Operation, readonly [string, string]> = {
  company: ['构建有证据支持的公司档案和关联报告。', 'Build an evidence-backed company profile and linked report.'],
  industry: ['运行有边界的八模块行业研究工作流。', 'Run the bounded eight-module industry research workflow.'],
  earnings: ['针对已覆盖公司复盘一个财务期间。', 'Review one fiscal period against the covered company.'],
  valuation: ['计算有边界的 PE、PB 或 EV/EBITDA 情景。', 'Calculate bounded PE, PB, or EV/EBITDA scenarios.'],
  event: ['评估与公司关联的事件及其二阶影响。', 'Assess a company-bound event and its second-order impact.'],
  thesis: ['对现有 canonical Thesis Claim 进行反方检验。', 'Red-team an existing canonical Thesis Claim.'],
}
const periods = ['Q1', 'H1', 'Q3', 'FY'] as const
const valuationMethods = ['PE', 'PB', 'EV_EBITDA'] as const

interface ResearchRunPageProps { readonly client: RuntimeClient; readonly onLaunched: (result: ResearchStartResponse) => void }
function errorText(error: unknown, t: (zh: string, en: string) => string): string { return error instanceof RuntimeClientError ? error.message : t('ResearchHub runtime 操作失败', 'ResearchHub runtime operation failed') }
function optional(value: string): string | undefined { const trimmed = value.trim(); return trimmed || undefined }
function csv(value: string): readonly string[] | undefined { const items = value.split(',').map((item) => item.trim()).filter(Boolean); return items.length > 0 ? items : undefined }

export function ResearchRunPage({ client, onLaunched }: ResearchRunPageProps): ReactElement {
  const { t } = useLanguage()
  const [operation, setOperation] = useState<Operation>('company')
  const [symbol, setSymbol] = useState('')
  const [name, setName] = useState('')
  const [exchange, setExchange] = useState('')
  const [asOf, setAsOf] = useState('')
  const [industryName, setIndustryName] = useState('')
  const [aliases, setAliases] = useState('')
  const [searchTerms, setSearchTerms] = useState('')
  const [canonicalRef, setCanonicalRef] = useState('')
  const [maxSources, setMaxSources] = useState('')
  const [maxEvidencePerModule, setMaxEvidencePerModule] = useState('')
  const [fiscalYear, setFiscalYear] = useState(String(new Date().getFullYear()))
  const [period, setPeriod] = useState<(typeof periods)[number]>('FY')
  const [methods, setMethods] = useState<readonly (typeof valuationMethods)[number][]>(['PE', 'PB', 'EV_EBITDA'])
  const [targetFiscalYear, setTargetFiscalYear] = useState('')
  const [anchorKind, setAnchorKind] = useState<'daily_signal' | 'article' | 'url' | 'user_event'>('article')
  const [signalId, setSignalId] = useState('')
  const [eventUrl, setEventUrl] = useState('')
  const [eventTitle, setEventTitle] = useState('')
  const [eventDescription, setEventDescription] = useState('')
  const [eventDate, setEventDate] = useState('')
  const [thesisRef, setThesisRef] = useState('')
  const [lookbackDays, setLookbackDays] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const label = (value: readonly [string, string]): string => t(value[0], value[1])
  const input = (fieldLabel: string, value: string, onChange: (value: string) => void, placeholder?: string, required = false): ReactElement => <label className="run-field"><span>{fieldLabel}{required ? ' *' : ''}</span><input value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></label>
  const sharedFields = <div className="run-grid">{input(t('A 股代码', 'A-share symbol'), symbol, setSymbol, '600519', true)}{input(t('交易所', 'Exchange'), exchange, setExchange, 'SSE')}{input(t('公司名称', 'Company name'), name, setName, t('可选', 'Optional'))}{input(t('截至时间', 'As of'), asOf, setAsOf, t('ISO 时间戳，可选', 'ISO timestamp, optional'))}</div>

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault(); if (busy) return; setError('')
    if (operation !== 'industry' && !/^\d{6}$/.test(symbol.trim())) { setError(t('A 股代码必须为六位数字。', 'A-share symbol must be six digits.')); return }
    if (operation === 'industry' && !industryName.trim()) { setError(t('必须填写行业名称。', 'Industry name is required.')); return }
    if (operation === 'valuation' && methods.length === 0) { setError(t('至少选择一种估值方法。', 'Select at least one valuation method.')); return }
    if (operation === 'event' && anchorKind === 'daily_signal' && !signalId.trim()) { setError(t('必须填写 Daily Signal ID。', 'Daily Signal ID is required.')); return }
    if (operation === 'event' && (anchorKind === 'article' || anchorKind === 'url') && !eventUrl.trim()) { setError(t('必须填写事件 URL。', 'Event URL is required.')); return }
    if (operation === 'event' && anchorKind === 'user_event' && (!eventTitle.trim() || !eventDescription.trim())) { setError(t('必须填写用户事件标题和描述。', 'User event title and description are required.')); return }
    if (operation === 'thesis' && !/^claim:\S+$/.test(thesisRef.trim())) { setError(t('论点引用必须是 canonical claim: 引用。', 'Thesis reference must be a canonical claim: reference.')); return }
    setBusy(true)
    try {
      let result: ResearchStartResponse
      if (operation === 'company') result = await client.startResearchCompany({ symbol: symbol.trim(), ...(optional(name) === undefined ? {} : { name: optional(name) }), ...(optional(exchange) === undefined ? {} : { exchange: optional(exchange) }), ...(optional(asOf) === undefined ? {} : { asOf: optional(asOf) }) })
      else if (operation === 'industry') result = await client.startResearchIndustry({ name: industryName.trim(), ...(csv(aliases) === undefined ? {} : { aliases: csv(aliases) }), ...(csv(searchTerms) === undefined ? {} : { searchTerms: csv(searchTerms) }), ...(optional(canonicalRef) === undefined ? {} : { canonicalRef: optional(canonicalRef) }), ...(optional(asOf) === undefined ? {} : { asOf: optional(asOf) }), ...(Number(maxSources) > 0 ? { maxSources: Number(maxSources) } : {}), ...(Number(maxEvidencePerModule) > 0 ? { maxEvidencePerModule: Number(maxEvidencePerModule) } : {}) })
      else if (operation === 'earnings') result = await client.startEarningsReview({ symbol: symbol.trim(), fiscalYear: Number(fiscalYear), period, ...(optional(name) === undefined ? {} : { name: optional(name) }), ...(optional(exchange) === undefined ? {} : { exchange: optional(exchange) }), ...(optional(asOf) === undefined ? {} : { asOf: optional(asOf) }) })
      else if (operation === 'valuation') result = await client.startValuation({ symbol: symbol.trim(), methods, ...(targetFiscalYear.trim() ? { targetFiscalYear: Number(targetFiscalYear) } : {}), ...(optional(name) === undefined ? {} : { name: optional(name) }), ...(optional(exchange) === undefined ? {} : { exchange: optional(exchange) }), ...(optional(asOf) === undefined ? {} : { asOf: optional(asOf) }) })
      else if (operation === 'event') result = await client.startEventResearch({ symbol: symbol.trim(), anchor: anchorKind === 'daily_signal' ? { kind: anchorKind, signalId: signalId.trim() } : anchorKind === 'user_event' ? { kind: anchorKind, title: eventTitle.trim(), description: eventDescription.trim(), ...(optional(eventDate) === undefined ? {} : { eventDate: optional(eventDate) }) } : { kind: anchorKind, url: eventUrl.trim(), ...(optional(eventTitle) === undefined ? {} : { title: optional(eventTitle) }), ...(optional(eventDate) === undefined ? {} : { publishedAt: optional(eventDate) }) }, ...(optional(name) === undefined ? {} : { name: optional(name) }), ...(optional(exchange) === undefined ? {} : { exchange: optional(exchange) }), ...(optional(asOf) === undefined ? {} : { asOf: optional(asOf) }) })
      else result = await client.startThesisRedTeam({ symbol: symbol.trim(), thesisRef: thesisRef.trim(), ...(lookbackDays.trim() ? { lookbackDays: Number(lookbackDays) } : {}), ...(optional(name) === undefined ? {} : { name: optional(name) }), ...(optional(exchange) === undefined ? {} : { exchange: optional(exchange) }), ...(optional(asOf) === undefined ? {} : { asOf: optional(asOf) }) })
      onLaunched(result)
    } catch (caught) { setError(errorText(caught, t)) } finally { setBusy(false) }
  }

  return <main className="page-frame run-page" aria-labelledby="run-title"><div className="page-heading"><div><span className="eyebrow">{t('工作流控制', 'WORKFLOW CONTROL')}</span><h1 id="run-title">{t('启动研究', 'Run Research')}</h1></div><span className="read-only-badge">{t('受治理的启动', 'Governed launch')}</span></div><p>{t('使用有边界的输入启动现有研究工作流。结果异步生成，并受服务可用性和证据质量影响。', 'Start an existing research workflow with bounded inputs. Results are asynchronous and remain subject to provider availability and evidence quality.')}</p><div className="run-layout"><aside className="run-operations" aria-label={t('研究操作', 'Research operations')}><span className="eyebrow">{t('操作', 'OPERATION')}</span>{(Object.keys(operationLabels) as Operation[]).map((item) => <button className={operation === item ? 'run-operation selected' : 'run-operation'} key={item} onClick={() => { setOperation(item); setError('') }}><strong>{label(operationLabels[item])}</strong><small>{label(operationDescriptions[item])}</small></button>)}</aside><form className="run-form" onSubmit={(event) => void submit(event)}><div className="section-title"><div><span className="eyebrow">{label(operationLabels[operation])}</span><h2>{label(operationDescriptions[operation])}</h2></div></div>{operation === 'industry' ? <div className="run-grid">{input(t('行业名称', 'Industry name'), industryName, setIndustryName, 'PCB / AI Server Hardware', true)}{input(t('Canonical ref', 'Canonical ref'), canonicalRef, setCanonicalRef, `entity:industry, ${t('可选', 'optional')}`)}{input(t('别名', 'Aliases'), aliases, setAliases, t('逗号分隔', 'comma-separated'))}{input(t('搜索词', 'Search terms'), searchTerms, setSearchTerms, t('逗号分隔', 'comma-separated'))}{input(t('来源数量上限', 'Max sources'), maxSources, setMaxSources, t('可选，1–50', 'Optional, 1–50'))}{input(t('每个模块的证据上限', 'Evidence per module'), maxEvidencePerModule, setMaxEvidencePerModule, t('可选，1–12', 'Optional, 1–12'))}</div> : <>{sharedFields}{operation === 'earnings' ? <div className="run-grid">{input(t('财年', 'Fiscal year'), fiscalYear, setFiscalYear, '2026', true)}<label className="run-field"><span>{t('期间', 'Period')} *</span><select aria-label={t('期间', 'Period')} value={period} onChange={(event) => setPeriod(event.target.value as (typeof periods)[number])}>{periods.map((item) => <option key={item}>{item}</option>)}</select></label></div> : null}{operation === 'valuation' ? <div className="run-grid"><fieldset className="run-fieldset"><legend>{t('估值方法', 'Methods')} *</legend>{valuationMethods.map((item) => <label className="check-field" key={item}><input type="checkbox" checked={methods.includes(item)} onChange={(event) => setMethods((old) => event.target.checked ? [...old, item] : old.filter((value) => value !== item))} />{item}</label>)}</fieldset>{input(t('目标财年', 'Target fiscal year'), targetFiscalYear, setTargetFiscalYear, t('可选', 'Optional'))}</div> : null}{operation === 'event' ? <div className="run-fields-block"><label className="run-field"><span>{t('锚点类型', 'Anchor kind')} *</span><select aria-label={t('锚点类型', 'Anchor kind')} value={anchorKind} onChange={(event) => setAnchorKind(event.target.value as typeof anchorKind)}><option value="article">{t('文章', 'Article')}</option><option value="url">URL</option><option value="daily_signal">Daily Signal</option><option value="user_event">{t('用户事件', 'User event')}</option></select></label>{anchorKind === 'daily_signal' ? input('Signal ID', signalId, setSignalId, 'signal id', true) : anchorKind === 'user_event' ? <>{input(t('事件标题', 'Event title'), eventTitle, setEventTitle, t('标题', 'Title'), true)}{input(t('事件日期', 'Event date'), eventDate, setEventDate, t('可选', 'Optional'))}<label className="run-field"><span>{t('描述', 'Description')} *</span><textarea aria-label={t('描述', 'Description')} value={eventDescription} onChange={(event) => setEventDescription(event.target.value)} rows={4} /></label></> : <>{input(t('事件 URL', 'Event URL'), eventUrl, setEventUrl, 'https://…', true)}{input(t('文章标题', 'Article title'), eventTitle, setEventTitle, t('可选', 'Optional'))}{input(t('发布时间', 'Published at'), eventDate, setEventDate, t('可选', 'Optional'))}</>}</div> : null}{operation === 'thesis' ? <div className="run-grid">{input(t('Thesis Claim ref', 'Thesis Claim ref'), thesisRef, setThesisRef, 'claim:...', true)}{input(t('回溯天数', 'Lookback days'), lookbackDays, setLookbackDays, t('可选，30–1095', 'Optional, 30–1095'))}</div> : null}</>}{error ? <div className="notice run-error" role="alert"><strong>{t('启动失败', 'Launch failed')}</strong><p>{error}</p></div> : null}<div className="run-submit"><span className="muted">{t('Runtime 创建 Workflow ID，并在 Research 中跟踪完成状态。', 'The runtime creates the Workflow ID and tracks completion in Research.')}</span><button className="primary-action" type="submit" disabled={busy}>{busy ? t('正在启动…', 'Starting…') : `${t('启动', 'Start')} ${label(operationLabels[operation])}`}</button></div></form></div></main>
}
