import { useEffect, useRef, useState, type ReactNode } from 'react'
import { RuntimeClientError, type ResearchReport, type RuntimeClient, type WorkflowRun } from '../api/runtime-client'
import { reportEvidenceEntries, reportEvidenceNavigationEvent, type ReportEvidenceNavigation } from './report-evidence'
import { safeReportUrl } from '../components/ResearchReportBody'
import { useLanguage } from '../i18n'
import './ReportAppendix.css'

type Bundle = Awaited<ReturnType<RuntimeClient['getResearchBundleForRun']>>
type Load<T> = { status: 'idle' | 'loading' | 'empty' | 'error' | 'ready'; value?: T }
const sensitiveKey = /secret|password|token|credential|authorization|raw|provider|payload|response|reasoning|chain.?of.?thought|stack|path|prompt|stdout|stderr|debug|environment|trace/i
const unsafeText = /(?:(?:^|[\s("'=])[A-Za-z]:[\\/]|\\\\|(?:^|[\s("'=])\/(?!\/)[\w.-]+\/|Bearer\s|sk-[A-Za-z0-9]{12}|(?:api[_ -]?key|password|secret|token|authorization)\s*[:=]|at\s+\S+\s*\([^)]*:\d+|hidden.?reasoning)/i
function text(value: unknown, limit = 300): string { return typeof value === 'string' && !unsafeText.test(value) ? value.slice(0, limit) : '' }
function safeRef(value: unknown): string {
  const result = text(value)
  if (/^https?:\/\/[^\s]+$/.test(result)) {
    try { const url = new URL(result); return url.username || url.password ? '' : result } catch { return '' }
  }
  return /^[\w.-]+(?::[\w.-]+)?$/.test(result) ? result : ''
}

/** A bounded display projection, never a serialization of the complete Bundle. */
function resultProjection(value: unknown, t: (zh: string, en: string) => string): unknown {
  let budget = 100
  const visit = (item: unknown, depth: number): unknown => {
    if (--budget < 0) return t('…已省略其余字段', '…additional fields omitted')
    if (item === null || typeof item === 'boolean' || typeof item === 'number') return item
    if (typeof item === 'string') return text(item, 500) || t('内容不可展示', 'Content unavailable for display')
    if (depth >= 3) return t('…展开深度已限制', '…display depth limited')
    if (Array.isArray(item)) return item.slice(0, 12).map(child => visit(child, depth + 1))
    if (item && typeof item === 'object') {
      const entries: [string, unknown][] = []
      // Enumeration and child access stop after a fixed budget, even for very large results.
      let inspected = 0
      for (const key in item) {
        if (++inspected > 40 || entries.length >= 16 || budget <= 0) break
        if (Object.prototype.hasOwnProperty.call(item, key) && !sensitiveKey.test(key) && text(key)) entries.push([key, visit((item as Record<string, unknown>)[key], depth + 1)])
      }
      return Object.fromEntries(entries)
    }
    return t('无可展示结果', 'No displayable result')
  }
  return visit(value, 0)
}
const fieldNames: Record<string, readonly [string, string]> = { summary: ['结果摘要', 'Result summary'], status: ['状态', 'Status'], companyName: ['公司名称', 'Company name'], companyRef: ['公司引用', 'Company reference'], reportId: ['报告引用', 'Report reference'], asOf: ['截至日期', 'As of'], findings: ['研究发现', 'Findings'], metrics: ['指标', 'Metrics'], sourceRefs: ['来源引用', 'Source references'], claimRefs: ['论点引用', 'Claim references'], title: ['标题', 'Title'], result: ['结果', 'Result'] }

function ResultValue({ value }: { value: unknown }) {
  const { t } = useLanguage()
  if (value === null || value === undefined) return <span>{t('未提供', 'Not provided')}</span>
  if (Array.isArray(value)) return value.length ? <ul>{value.slice(0, 12).map((item, index) => <li key={index}><ResultValue value={item} /></li>)}</ul> : <span>{t('无条目', 'No entries')}</span>
  if (typeof value === 'object') return <dl>{Object.entries(value).slice(0, 12).map(([key, item]) => <div key={key}><dt>{fieldNames[key] ? t(...fieldNames[key]) : key}</dt><dd><ResultValue value={item} /></dd></div>)}</dl>
  return <span>{String(value)}</span>
}

function useLazy<T>(open: boolean, load: () => Promise<T>, valid: (value: T) => boolean) {
  const [state, setState] = useState<Load<T>>({ status: 'idle' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!open) return
    let active = true
    setState({ status: 'loading' })
    void load().then(value => { if (active) setState(valid(value) ? { status: 'ready', value } : { status: 'error' }) }).catch(error => {
      if (active) setState({ status: error instanceof RuntimeClientError && error.status === 404 ? 'empty' : 'error' })
    })
    return () => { active = false }
    // Bound to this report instance; closing invalidates in-flight responses and reopening reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, attempt])
  return { state, retry: () => setAttempt(value => value + 1) }
}
function ReadState({ state, retry, empty, children }: { state: Load<unknown>; retry: () => void; empty: string; children: ReactNode }) {
  const { t } = useLanguage()
  if (state.status === 'idle' || state.status === 'loading') return <p role="status">{t('正在加载附录…', 'Loading appendix…')}</p>
  if (state.status === 'empty') return <p>{empty}</p>
  if (state.status === 'error') return <div role="alert"><p>{t('附录暂时无法读取或关联信息不一致。', 'The appendix could not be read or its association is inconsistent.')}</p><button type="button" onClick={retry}>{t('重试', 'Retry')}</button></div>
  return <>{children}</>
}
function Reference({ value }: { value: string }) { return /^https?:\/\//.test(value) ? <a href={value} target="_blank" rel="noreferrer">{value}</a> : <span>{value}</span> }
function WorkflowHistory({ workflow }: { workflow: WorkflowRun }) {
  const { t } = useLanguage()
  const rows = [
    { title: t('已观测阶段', 'Observed stages'), items: workflow.stages ?? [], name: (item: { label: string }) => item.label },
    { title: t('Provider 结果', 'Provider results'), items: workflow.providerObservations ?? [], name: (item: { label: string }) => item.label },
    { title: t('Skill 结果', 'Skill results'), items: workflow.skillObservations ?? [], name: (item: { label: string }) => item.label },
  ]
  return <div><dl><dt>Workflow</dt><dd>{text(workflow.workflowType)}</dd><dt>Run ID</dt><dd>{text(workflow.runId)}</dd><dt>{t('执行状态', 'Execution status')}</dt><dd>{workflow.status === 'interrupted' ? t('interrupted · 执行中断，未确认完成', 'interrupted · Execution interrupted; completion unconfirmed') : text(workflow.status)}</dd><dt>{t('记录来源', 'Observation source')}</dt><dd>{workflow.observationSource === 'historical' ? t('historical · 历史快照', 'historical · Saved snapshot') : t('live · 当前观测', 'live · Current observation')}</dd><dt>{t('开始时间', 'Started at')}</dt><dd>{text(workflow.startedAt)}</dd><dt>{t('完成时间', 'Completed at')}</dt><dd>{text(workflow.completedAt) || t('未记录', 'Not recorded')}</dd></dl>
    {rows.map(row => <section key={row.title}><h4>{row.title}</h4>{!row.items.length ? <p>{t('暂无观测记录。', 'No observations available.')}</p> : <ul>{row.items.slice(0, 30).map((item, index) => <li key={index}><strong>{text(row.name(item))}</strong> · {text(item.status)}{item.startedAt && <span> · {t('开始', 'Started')} {text(item.startedAt)}</span>}{item.completedAt && <span> · {t('完成', 'Completed')} {text(item.completedAt)}</span>}{typeof item.durationMs === 'number' && <span> · {item.durationMs}ms</span>}{'recordCount' in item && typeof item.recordCount === 'number' && <span> · {item.recordCount} {t('条记录', 'records')}</span>}{'summary' in item && text(item.summary) && <p>{text(item.summary)}</p>}{'diagnostics' in item && item.diagnostics?.filter(code => /^[A-Z][A-Z0-9_]{0,63}$/.test(code)).slice(0, 4).map((code, diagnosticIndex) => <p key={diagnosticIndex}>{t('诊断', 'Diagnostic')}：{code}</p>)}</li>)}</ul>}{row.items.length > 30 && <p>{t('仅展示前 30 项观测。', 'Showing the first 30 observations.')}</p>}</section>)}
    {workflow.executionResult?.diagnostics.filter(code => /^[A-Z][A-Z0-9_]{0,63}$/.test(code)).slice(0, 8).map((code, index) => <p key={index}>{t('诊断', 'Diagnostic')}：{code}</p>)}
    {workflow.historyPersistence?.status === 'failed' && <p>{t('历史快照保存失败。', 'Historical snapshot could not be saved.')}</p>}
  </div>
}
function EvidenceAppendix({ report }: { report: ResearchReport }) {
  const { t } = useLanguage()
  const appendixRef = useRef<HTMLDetailsElement>(null)
  const evidenceRefs = useRef(new Map<string, HTMLDetailsElement>())
  const entries = reportEvidenceEntries(report)
  useEffect(() => {
    const navigate = (event: Event) => {
      const detail = (event as CustomEvent<ReportEvidenceNavigation>).detail
      if (!detail || detail.reportId !== report.reportId || !entries.some((entry) => entry.id === detail.evidenceId)) return
      const appendix = appendixRef.current
      const evidence = evidenceRefs.current.get(detail.evidenceId)
      if (!appendix || !evidence) return
      appendix.open = true
      evidence.open = true
      window.setTimeout(() => evidence.scrollIntoView?.({ behavior: 'smooth', block: 'center' }), 0)
    }
    window.addEventListener(reportEvidenceNavigationEvent, navigate)
    return () => window.removeEventListener(reportEvidenceNavigationEvent, navigate)
  }, [report.reportId, entries])
  if (!entries.length) return null
  return <details ref={appendixRef} className="report-appendix-evidence"><summary>{t('报告证据定位', 'Report evidence references')} · {entries.length}</summary><p>{t('正文中的证据编号对应原文段落定位、来源链接和已保存摘录。', 'Inline evidence numbers link to source locators, source links and saved excerpts.')}</p>{entries.map(({ id, location, index }) => { const url = safeReportUrl(location.url); return <details className="research-report-evidence" id={id} key={id} ref={(element) => { if (element) evidenceRefs.current.set(id, element); else evidenceRefs.current.delete(id) }}><summary>{t('证据', 'Evidence')} {index} · {location.locator}</summary><div><p className="muted">{text(location.sourceCandidateId) || t('来源未记录', 'Source not recorded')}</p>{url ? <a href={url} target="_blank" rel="noopener noreferrer">{t('查看公开来源', 'Open public source')}</a> : null}<blockquote>{text(location.excerpt, 2000) || t('此旧报告未保存段落原文。', 'This legacy report has no saved excerpt.')}</blockquote></div></details> })}</details>
}
function Appendix({ report, client }: { report: ResearchReport; client: RuntimeClient }) {
  const { t } = useLanguage()
  const [sourceOpen, setSourceOpen] = useState(false)
  const [resultOpen, setResultOpen] = useState(false)
  const [workflowOpen, setWorkflowOpen] = useState(false)
  const validBundle = (bundle: Bundle) => bundle.workflowRunId === report.workflowRunId && bundle.bundleId === `research-bundle-${report.workflowRunId}` && Array.isArray(bundle.proposals) && Array.isArray(bundle.sourceLibraryHits) && bundle.sourceLibraryHits.slice(0, 24).every(hit => hit && typeof hit.title === 'string' && typeof hit.excerpt === 'string') && bundle.proposals.slice(0, 24).every(proposal => proposal && typeof proposal.proposalId === 'string') && (!bundle.report || bundle.report.reportId === report.reportId) && (!bundle.executionResult || (bundle.executionResult.runId === report.workflowRunId && (!bundle.executionResult.reportRef || bundle.executionResult.reportRef === report.reportId)))
  const sources = useLazy(sourceOpen, () => client.getResearchBundleForRun(report.workflowRunId), validBundle)
  const result = useLazy(resultOpen, () => client.getResearchBundleForRun(report.workflowRunId), validBundle)
  const history = useLazy(workflowOpen, () => client.workflow(report.workflowRunId), workflow => workflow.runId === report.workflowRunId && (!workflow.executionResult || (workflow.executionResult.runId === report.workflowRunId && (!workflow.executionResult.reportRef || workflow.executionResult.reportRef === report.reportId))))
  const existingRefs = new Set([...report.sourceRefs, ...report.sections.flatMap(section => section.sourceRefs ?? [])])
  const hits = sources.state.value?.sourceLibraryHits ?? []
  const projection = resultOpen && result.state.value ? resultProjection(result.state.value.structuredResult, t) : undefined
  const proposals = result.state.value?.proposals ?? []
  const noBundle = t('该报告没有可用研究资料包。', 'No research bundle is available for this report.')
  return <section className="report-appendix" aria-label={t('研究附录', 'Research appendix')}><h3>{t('研究附录', 'Research appendix')}</h3><p>{t('附录来自该报告对应的研究执行，执行状态独立于报告质量。', 'This appendix belongs to the report’s research run. Execution status is independent of report quality.')}</p>
    <EvidenceAppendix report={report} />
    <details onToggle={event => setSourceOpen(event.currentTarget.open)}><summary>{t('研究依据与数据来源', 'Research evidence and sources')}</summary><ReadState state={sources.state} retry={sources.retry} empty={noBundle}>{!hits.length ? <p>{t('暂无来源库命中。', 'No source library hits available.')}</p> : <><p>{t('来源库候选证据 · 摘要片段，不代表完整原始资料。', 'Source library candidate evidence · Excerpts, not complete original documents.')}</p><ul>{hits.slice(0, 24).map((hit, index) => { const refs = [...new Set([hit.sourceLibraryRef, hit.rawRef, hit.provenance?.rawRef].map(safeRef).filter(ref => ref && !existingRefs.has(ref)))]; return <li key={index}><strong>{text(hit.title)}</strong><p>{text(hit.excerpt, 600)}</p><p>{t('片段索引', 'Chunk index')}：{hit.chunkIndex} · {t('内容哈希', 'Content hash')}：{text(hit.contentHash, 80)}</p>{refs.map(ref => <p key={ref}>{t('出处', 'Provenance')}：<Reference value={ref} /></p>)}{!refs.length && <p>{t('来源引用已列于报告正文或暂无可展示引用。', 'Source references are already in the report or unavailable for display.')}</p>}</li> })}</ul>{hits.length > 24 && <p>{t('仅展示前 24 条候选证据。', 'Showing the first 24 candidate evidence entries.')}</p>}</>}</ReadState></details>
    <details onToggle={event => setResultOpen(event.currentTarget.open)}><summary>{t('结构化研究结果', 'Structured research results')}</summary><ReadState state={result.state} retry={result.retry} empty={noBundle}>{result.state.value && <><dl><dt>{t('资料包执行状态', 'Bundle execution status')}</dt><dd>{text(result.state.value.status)}</dd>{result.state.value.executionResult?.summary && <><dt>{t('结果摘要', 'Result summary')}</dt><dd>{text(result.state.value.executionResult.summary, 600)}</dd></>}</dl>{projection && typeof projection === 'object' && !Array.isArray(projection) ? <dl>{Object.entries(projection).slice(0, 12).map(([key, value]) => <div key={key}><dt>{fieldNames[key] ? t(...fieldNames[key]) : key}</dt><dd><ResultValue value={value} /></dd></div>)}</dl> : <p>{projection === null || projection === undefined ? t('暂无结构化研究结果。', 'No structured research results available.') : <ResultValue value={projection} />}</p>}<h4>{t('提案', 'Proposals')}</h4>{proposals.length ? <ul>{proposals.slice(0, 24).map((proposal, index) => <li key={index}>{text(proposal.proposalId)}{proposal.kind && ` · ${text(proposal.kind)}`}</li>)}</ul> : <p>{t('暂无提案。', 'No proposals available.')}</p>}{proposals.length > 24 && <p>{t('仅展示前 24 项提案。', 'Showing the first 24 proposals.')}</p>}<details><summary>{t('查看受限结构化 JSON', 'View bounded structured JSON')}</summary><p>{t('已限制字段、数量与深度，并省略敏感字段。', 'Fields, size and depth are limited; sensitive fields are omitted.')}</p><pre>{JSON.stringify(projection, null, 2)}</pre></details></>}</ReadState></details>
    <details onToggle={event => setWorkflowOpen(event.currentTarget.open)}><summary>{t('Workflow 执行历史', 'Workflow execution history')}</summary><ReadState state={history.state} retry={history.retry} empty={t('历史阶段不可用：未找到 Workflow 快照。', 'Historical stages unavailable: no Workflow snapshot was found.')}>{history.state.value && <WorkflowHistory workflow={history.state.value} />}</ReadState></details>
  </section>
}

export function ReportAppendix(props: { report: ResearchReport; client: RuntimeClient }) {
  const { t } = useLanguage()
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(props.report.workflowRunId)) return <section className="report-appendix" aria-label={t('研究附录', 'Research appendix')}><h3>{t('研究附录', 'Research appendix')}</h3><p role="alert">{t('报告缺少有效执行关联，附录不可用。', 'The report has no valid run association; appendix unavailable.')}</p></section>
  return <Appendix key={`${props.report.reportId}:${props.report.workflowRunId}`} {...props} />
}
