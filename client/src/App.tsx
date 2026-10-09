import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { RuntimeClient, RuntimeClientError, type AttachmentRef, type ClientEvent, type ConversationMessage, type ConversationSummary, type DailyBriefReport, type DailyBriefSummary, type KnowledgeBaseStatus, type KnowledgeDirectoryItem, type RawDocumentAcceptanceV04, type RawDocumentCandidateGroupV04, type RawDocumentPreviewV04, type RawDocumentPreviewPollV04, type ResearchBundleSummary, type ResearchDispatchFeedback, type ResearchDispatchResolution, type ResearchDispatchResponse, type ResearchExecutionSummary, type ResearchReport, type ResearchReportSummary, type ResearchStartResponse, type ReviewDetail, type ReviewListResponse, type RuntimeModelLoginFlow, type RuntimeSettings, type SessionState, type SourceLibraryHit, type ThesisCriterionConfirmResult, type ThesisCriterionOrigin, type ThesisCriterionPreview, type ThesisDecision, type ThesisQueryDetail, type ThesisQuerySummary, type ThesisReviewScope, type ThemeFrameworkDecision, type ThemeFrameworkRefreshResult, type ThemeFrameworkReviewCandidate, type ThemeFrameworkReviewResponse, type ThemeFrameworkReviewSummary, type ThemeScopeImpactInboxRecord, type ThemeScopeImpactProposal, type WorkflowDefinition, type WorkflowRun } from './api/runtime-client'
import { SettingsPanel, type CompatibleEndpointInput, type SettingsPanelProps } from './app/settings/SettingsPanel'
import { startWorkflowPolling, terminalWorkflowStatuses } from './app/workflow-polling'
import { KnowledgeGraphPage } from './app/graph/KnowledgeGraphPage'
import { ResearchRunPage } from './app/run/ResearchRunPage'
import { DataSourcesPage } from './app/data-sources/DataSourcesPage'
import { LanguageProvider, useLanguage } from './i18n'
import './styles.css'

type Route = 'research' | 'briefs' | 'reports' | 'bundles' | 'run' | 'graph' | 'reviews' | 'theses' | 'sources'
type ReviewsSection = 'review-cases' | 'theme-framework' | 'theme-scope'
type LoadState = 'loading' | 'ready' | 'error'
type WorkflowArtifactTarget = { readonly kind: 'report' | 'bundle' | 'review_case' | 'theme_framework_candidate' | 'daily_brief'; readonly id: string; readonly runId: string }
type V04RightsForm = { accessScope: 'public' | 'authenticated' | 'restricted' | 'unknown'; providerTermsKnown: boolean; retentionAllowed: boolean; aiProcessingAllowed: boolean; derivativeKnowledgeAllowed: boolean; redistributionAllowed: boolean; policyBasis: string; expiresAt: string; entitlementRef: string }
type V04SourceForm = { title: string; sourceType: string; sourceReliability: string; publisher: string; institution: string; author: string; publishedAt: string; canonicalUrl: string }
const defaultRightsForm: V04RightsForm = { accessScope: 'unknown', providerTermsKnown: false, retentionAllowed: false, aiProcessingAllowed: false, derivativeKnowledgeAllowed: false, redistributionAllowed: false, policyBasis: '', expiresAt: '', entitlementRef: '' }
const defaultSourceForm: V04SourceForm = { title: '', sourceType: 'unknown', sourceReliability: 'unknown', publisher: '', institution: '', author: '', publishedAt: '', canonicalUrl: '' }
const supportedDocumentExtension = /\.(pdf|csv|htm|html|json|md|text|txt|xml)$/i
const knownTools: Record<string, string> = { researchhub_status: 'ResearchHub status', search_knowledge: 'Knowledge search', get_knowledge_object: 'Knowledge object lookup', ingest_document: 'Document ingestion', get_workflow_status: 'Workflow status', cancel_workflow: 'Workflow cancellation', list_review_cases: 'Review case list', get_review_case: 'Review case detail' }
const rawDocumentPreviewPollLimit = 120

function previewPollTerminalDisposition(result: RawDocumentPreviewPollV04): 'wait' | 'verified' | 'terminal' {
  if (result.preview?.committable) return 'verified'
  return result.workflow && terminalWorkflowStatuses.has(result.workflow.status) ? 'terminal' : 'wait'
}

function routeForPath(pathname: string): Route { return pathname === '/briefs' ? 'briefs' : pathname === '/reports' ? 'reports' : pathname === '/bundles' ? 'bundles' : pathname === '/run' ? 'run' : pathname === '/graph' ? 'graph' : pathname === '/reviews' ? 'reviews' : pathname === '/theses' ? 'theses' : pathname === '/sources' ? 'sources' : 'research' }
function routePath(route: Route): string { return route === 'research' ? '/research' : `/${route}` }
function errorText(error: unknown): string { return error instanceof RuntimeClientError ? error.message : 'ResearchHub runtime operation failed' }
function toolLabel(name: string | undefined): string { return name === undefined ? 'Tool execution' : knownTools[name] ?? 'Tool execution' }
function formatSize(size: number): string { if (size < 1024) return `${size} B`; if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`; return `${(size / (1024 * 1024)).toFixed(1)} MB` }
function shortHash(value: string): string { return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-8)}` : value }
function safeStructured(value: unknown, depth = 0): string {
  if (depth > 3) return '[truncated]'
  if (typeof value === 'string') return value.replace(/(?:[A-Za-z]:[\\/]|\\\\|\.\.?[\\/])[^\s"']+/g, '[path]').slice(0, 700)
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `[${value.slice(0, 6).map((item) => safeStructured(item, depth + 1)).join(', ')}]`
  if (typeof value === 'object') return Object.entries(value as Record<string, unknown>).slice(0, 12).map(([key, item]) => /path|root|workspace|directory|filename/i.test(key) ? `${key}: [redacted]` : `${key}: ${safeStructured(item, depth + 1)}`).join(' · ')
  return '[unavailable]'
}

interface ApplicationSidebarProps { readonly route: Route; readonly knowledgeBase?: KnowledgeBaseStatus; readonly settings?: RuntimeSettings; readonly settingsError?: string; readonly settingsBusy: boolean; readonly interactionsDisabled: boolean; readonly settingsPanelProps: SettingsPanelProps; readonly onNavigate: (route: Route) => void; readonly onLoadSettings: () => void; readonly onModelChange: (value: string) => void }
function ApplicationSidebar({ route, knowledgeBase, settings, settingsError, settingsBusy, interactionsDisabled, settingsPanelProps, onNavigate, onLoadSettings, onModelChange }: ApplicationSidebarProps): ReactElement {
  const { t } = useLanguage()
  const [collapsed, setCollapsed] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 900px)').matches)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const viewport = window.matchMedia('(max-width: 900px)')
    const syncCollapse = (): void => setCollapsed(viewport.matches)
    viewport.addEventListener('change', syncCollapse)
    return () => viewport.removeEventListener('change', syncCollapse)
  }, [])
  const links: readonly [Route, string, string, string][] = [['research', '研究', 'Research', 'R'], ['briefs', '每日简报', 'Daily Briefs', 'B'], ['reports', '研究报告', 'Reports', 'P'], ['bundles', '研究资料包', 'Research Bundles', 'D'], ['run', '运行研究', 'Run Research', '▶'], ['graph', '知识图谱', 'Knowledge Graph', 'G'], ['sources', '数据源', 'Data Sources', 'S'], ['theses', '投资论点', 'Theses', 'T'], ['reviews', '审核', 'Reviews', '✓']]
  const currentModelValue = settings?.model.provider && settings.model.modelId ? `${settings.model.provider}/${settings.model.modelId}` : ''
  const currentModelListed = Boolean(currentModelValue && settings?.models.some((model) => `${model.provider}/${model.modelId}` === currentModelValue))
  const ensureSettings = (): void => { if (!settings && !settingsBusy) onLoadSettings() }
  return <aside className={`app-sidebar ${collapsed ? 'collapsed' : ''}`} aria-label={t('应用侧栏', 'Application sidebar')}>
    <div className="sidebar-brand"><a className="brand" href="/research" onClick={(event) => { event.preventDefault(); onNavigate('research') }} aria-label="ResearchHub"><span className="brand-mark">RH</span><span className="brand-name">ResearchHub</span></a><button className="sidebar-collapse" type="button" aria-label={collapsed ? t('展开导航', 'Expand navigation') : t('折叠导航', 'Collapse navigation')} aria-expanded={!collapsed} onClick={() => setCollapsed((value) => !value)}>{collapsed ? '»' : '«'}</button></div>
    <nav className="primary-nav" aria-label={t('主导航', 'Primary navigation')}><ul>{links.map(([item, zh, en, icon]) => <li key={item}><a className={route === item ? 'nav-link active' : 'nav-link'} href={routePath(item)} title={t(zh, en)} aria-label={t(zh, en)} aria-current={route === item ? 'page' : undefined} onClick={(event) => { event.preventDefault(); onNavigate(item) }}><span className="nav-icon" aria-hidden="true">{icon}</span><span className="nav-label">{t(zh, en)}</span></a></li>)}</ul></nav>
    <div className="sidebar-bottom">
      <div className="sidebar-control"><label htmlFor="global-model-select">{t('全局模型', 'Global model')}</label><select id="global-model-select" aria-label={t('全局模型', 'Global model')} value={currentModelValue} disabled={!settings || settingsBusy || interactionsDisabled} onFocus={ensureSettings} onChange={(event) => onModelChange(event.target.value)}>{!settings ? <option value="">{settingsBusy ? t('正在加载…', 'Loading…') : t('加载模型…', 'Load models…')}</option> : null}{settings && !currentModelValue ? <option value="" disabled>{t('当前模型未配置', 'No model is configured')}</option> : null}{settings && currentModelValue && !currentModelListed ? <option value={currentModelValue} disabled>{t('当前模型不在目录中', 'Current model missing from catalog')} · {settings.model.provider}/{settings.model.modelId}</option> : null}{settings?.models.map((model) => { const value = `${model.provider}/${model.modelId}`; return <option key={value} value={value} disabled={!model.available} title={model.unavailableReason}>{model.name} · {model.provider}{model.available ? '' : ` — ${model.unavailableReason ?? t('不可用', 'Unavailable')}`}</option> })}</select>{settings?.model.provider && settings.model.modelId ? <small title={`${settings.model.provider}/${settings.model.modelId}`}>{settings.model.provider} · {settings.model.modelId}</small> : null}{settings?.modelError ? <small className="sidebar-settings-error" role="status">{settings.modelError}</small> : null}</div>
      {(settingsError || settingsBusy) ? <p className={settingsError ? 'sidebar-settings-error' : 'sidebar-settings-hint'} role="status">{settingsError ?? t('正在加载配置…', 'Loading settings…')}</p> : null}
      <SettingsPanel {...settingsPanelProps} />
      <div className="runtime-status"><span className="status-dot" /><span>{t('本地运行时', 'Local Runtime')}</span><span className="status-sub">{knowledgeBase ? t('知识库已挂载', 'KB mounted') : t('未挂载知识库', 'No KB mounted')}</span></div>
    </div>
  </aside>
}

interface ReviewsPageProps {
  readonly client: RuntimeClient
  readonly knowledgeBase?: KnowledgeBaseStatus
  readonly reviews?: ReviewListResponse
  readonly reviewDetail?: ReviewDetail
  readonly reviewsBusy: boolean
  readonly themeFrameworkRunId: string
  readonly setThemeFrameworkRunId: (value: string) => void
  readonly themeFrameworkRefreshInfo?: ResearchPageProps['themeFrameworkRefreshInfo']
  readonly setThemeFrameworkRefreshInfo: (value: ResearchPageProps['themeFrameworkRefreshInfo']) => void
  readonly themeFrameworkReviewRevision: number
  readonly refreshThemeFrameworkReviews: () => void
  readonly acceptance?: RawDocumentAcceptanceV04
  readonly workflowRunId: string
  readonly workflow?: WorkflowRun
  readonly onSelect: (reviewCaseId: string) => void
  readonly onCloseDetail: () => void
}
function ReviewsPage({ client, knowledgeBase, reviews, reviewDetail, reviewsBusy, themeFrameworkRunId, setThemeFrameworkRunId, themeFrameworkRefreshInfo, setThemeFrameworkRefreshInfo, themeFrameworkReviewRevision, refreshThemeFrameworkReviews, acceptance, workflowRunId, workflow, onSelect, onCloseDetail }: ReviewsPageProps): ReactElement {
  const { t } = useLanguage()
  const [section, setSection] = useState<ReviewsSection>('review-cases')
  const frameworkProps = { client, knowledgeBase, themeFrameworkRunId, setThemeFrameworkRunId, themeFrameworkRefreshInfo, setThemeFrameworkRefreshInfo, themeFrameworkReviewRevision, refreshThemeFrameworkReviews }
  const scopeProps = { client, knowledgeBase, acceptance, workflowRunId, workflow }
  const reviewCasesUnavailable = !knowledgeBase
  return <main className="page-frame review-page" aria-labelledby="reviews-title"><div className="page-heading"><div><span className="eyebrow">{t('治理', 'GOVERNANCE')}</span><h1 id="reviews-title">{t('审核收件箱', 'Review Inbox')}</h1></div></div>
    <nav className="panel-tabs reviews-sections" aria-label={t('审核分区', 'Review sections')}>
      <button type="button" className={section === 'review-cases' ? 'selected' : ''} aria-pressed={section === 'review-cases'} onClick={() => setSection('review-cases')}>{t('审核案例', 'Review cases')}</button>
      <button type="button" className={section === 'theme-framework' ? 'selected' : ''} aria-pressed={section === 'theme-framework'} onClick={() => setSection('theme-framework')}>{t('主题框架审核', 'Theme Framework reviews')}</button>
      <button type="button" className={section === 'theme-scope' ? 'selected' : ''} aria-pressed={section === 'theme-scope'} onClick={() => setSection('theme-scope')}>{t('主题范围变更', 'Theme scope changes')}</button>
    </nav>
    <section className="reviews-section" aria-label={t('待处理案例', 'Review cases')} hidden={section !== 'review-cases'}>
      <div className="section-title"><div><span className="eyebrow">{t('待处理案例', 'OPEN CASES')}</span><h2>{reviews?.total ?? 0} {t('个审核', 'reviews')}</h2></div><span className="read-only-badge">{t('只读', 'Read-only')}</span></div>
      {reviewCasesUnavailable ? <div className="notice"><strong>{t('未挂载知识库', 'No Knowledge Base mounted')}</strong><p>{t('挂载知识库并完成生产后，审核案例才可用。', 'Review cases require a mounted Knowledge Base.')}</p></div> : reviewsBusy ? <p className="muted">{t('正在加载审核收件箱…', 'Loading Review Inbox…')}</p> : <div className="review-layout">
        <section aria-label={t('待处理案例', 'Open ReviewCases')}>
          {reviews && reviews.cases.length > 0 ? <div className="result-list">{reviews.cases.map((item) => <button className="review-item" key={item.reviewCaseId} onClick={() => onSelect(item.reviewCaseId)}><strong>{item.category}</strong><span>{item.actionability} · {item.proposalKind}</span><small>{item.rationale}</small><small>{item.producerType} · {new Date(item.createdAt).toLocaleString()}</small></button>)}</div> : <div className="notice"><strong>{t('没有待处理的审核案例', 'No open Review cases')}</strong><p>{t('需要审核的生产结果会显示在这里。', 'Completed production with review will surface actionable cases here.')}</p></div>}
        </section>
        {reviewDetail ? <section className="review-detail" aria-label={t('审核详情', 'ReviewCase detail')}><div className="detail-title"><span>{t('审核详情', 'Review detail')}</span><button onClick={onCloseDetail}>{t('关闭', 'Close')}</button></div><h2>{reviewDetail.reviewCaseId}</h2><p><strong>{t('分类：', 'Classification:')}</strong> {safeStructured(reviewDetail.classification)}</p><p><strong>{t('根提案：', 'Root proposal:')}</strong> {safeStructured(reviewDetail.rootProposal)}</p><p><strong>{t('证据：', 'Evidence:')}</strong> {reviewDetail.evidenceBindings.length} {t('项绑定', 'binding(s)')}</p><p><strong>{t('已有知识：', 'Existing Knowledge:')}</strong> {reviewDetail.existingKnowledgeProjections.length} {t('项投影', 'projection(s)')}</p><p><strong>{t('影响：', 'Impact:')}</strong> {safeStructured(reviewDetail.impact)}</p>{reviewDetail.advisory ? <p><strong>{t('建议：', 'Advisory:')}</strong> {safeStructured(reviewDetail.advisory)}</p> : null}<p><strong>{t('后续提案：', 'Dependent proposals:')}</strong> {reviewDetail.totalDependentProposals}</p><p className="muted">{t('v0.1 中审核收件箱为只读状态，不提供决策操作。', 'Review Inbox is read-only in v0.1. Decision controls are intentionally not available.')}</p></section> : <div className="notice detail-empty"><strong>{t('选择一个审核案例', 'Select a ReviewCase')}</strong><p>{t('审核详情范围明确且只读。', 'Review details are bounded and read-only.')}</p></div>}
      </div>}
    </section>
    <section className="reviews-section" aria-label={t('主题框架审核', 'Theme Framework reviews')} hidden={section !== 'theme-framework'}>
      {knowledgeBase ? <><ThemeFrameworkReviewInbox props={frameworkProps} />{themeFrameworkRunId ? <ThemeFrameworkReviewPanel client={client} runId={themeFrameworkRunId} onChanged={refreshThemeFrameworkReviews} refreshInfo={themeFrameworkRefreshInfo} onRefreshed={(id, info) => { setThemeFrameworkRefreshInfo(info); setThemeFrameworkRunId(id) }} /> : <div className="notice"><strong>{t('选择一个已保存的框架审核', 'Select a saved framework review')}</strong><p>{t('可以恢复待审核运行，并继续进行明确的人工决策。', 'Resume an awaiting review run to continue with an explicit human decision.')}</p></div>}</> : <div className="notice"><strong>{t('未挂载知识库', 'No Knowledge Base mounted')}</strong><p>{t('主题框架审核需要挂载知识库。', 'Theme Framework reviews require a mounted Knowledge Base.')}</p></div>}
    </section>
    <section className="reviews-section" aria-label={t('主题范围变更', 'Theme scope changes')} hidden={section !== 'theme-scope'}>
      {knowledgeBase ? <ThemeScopeImpactInbox props={scopeProps} /> : <div className="notice"><strong>{t('未挂载知识库', 'No Knowledge Base mounted')}</strong><p>{t('主题范围变更需要挂载知识库。', 'Theme scope changes require a mounted Knowledge Base.')}</p></div>}
    </section>
  </main>
}

function initialAsOfInput(): string { const date = new Date(); date.setSeconds(0, 0); return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16) }
function parseEvidenceRefs(value: string): readonly string[] { return [...new Set(value.split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean))].slice(0, 80) }
function criterionRunId(): string { return `criterion-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}` }

interface ThesisCriterionAuthoringProps { readonly client: RuntimeClient; readonly thesis: ThesisQueryDetail; readonly onThesisReload: (thesis: ThesisQueryDetail) => void }
function ThesisCriterionAuthoring({ client, thesis, onThesisReload }: ThesisCriterionAuthoringProps): ReactElement {
  const [conditionId, setConditionId] = useState('')
  const [metricRef, setMetricRef] = useState('')
  const [operator, setOperator] = useState<'eq' | 'gt' | 'gte' | 'lt' | 'lte'>('lt')
  const [threshold, setThreshold] = useState('')
  const [unit, setUnit] = useState('')
  const [period, setPeriod] = useState('')
  const [targetClaimRefs, setTargetClaimRefs] = useState<readonly string[]>([])
  const [originKind, setOriginKind] = useState<'human_rule' | 'source_derived'>('human_rule')
  const [sourceRef, setSourceRef] = useState('')
  const [rawRef, setRawRef] = useState('')
  const [locator, setLocator] = useState('')
  const [publishedAt, setPublishedAt] = useState('')
  const [preview, setPreview] = useState<ThesisCriterionPreview>()
  const [workflowRunId, setWorkflowRunId] = useState('')
  const [prepareBusy, setPrepareBusy] = useState(false)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [confirmResult, setConfirmResult] = useState<ThesisCriterionConfirmResult>()
  const [criterionError, setCriterionError] = useState('')
  const previewGeneration = useRef(0)
  const criteria = thesis.killCriteria ?? []
  const activeCriteria = criteria.filter((item) => item.state === 'active')
  const invalidatePreview = (): void => { previewGeneration.current += 1; setPreview(undefined); setWorkflowRunId(''); setConfirmResult(undefined); setCriterionError('') }
  const origin: ThesisCriterionOrigin = originKind === 'human_rule'
    ? { kind: 'human_rule' }
    : { kind: 'source_derived', sourceRef, rawRef, locator, publishedAt: publishedAt ? new Date(publishedAt).toISOString() : '' }

  const prepare = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!conditionId.trim() || !metricRef.trim() || threshold.trim() === '' || !unit.trim() || !period.trim() || targetClaimRefs.length === 0) return
    const generation = ++previewGeneration.current
    setPrepareBusy(true); setCriterionError(''); setPreview(undefined); setWorkflowRunId(''); setConfirmResult(undefined)
    try {
      const result = await client.prepareThesisCriterion({ thesisRef: thesis.thesisRef, conditionId: conditionId.trim(), definition: { metricRef: metricRef.trim(), operator, threshold: Number(threshold), unit: unit.trim(), period: period.trim() }, targetClaimRefs, origin })
      if (generation === previewGeneration.current) { setPreview(result); setWorkflowRunId(criterionRunId()) }
    } catch (caught) { setCriterionError(errorText(caught)) } finally { setPrepareBusy(false) }
  }
  const confirm = async (): Promise<void> => {
    if (!preview || !workflowRunId || confirmBusy) return
    setConfirmBusy(true); setCriterionError('')
    try {
      const result = await client.confirmThesisCriterion({ preview, previewHash: preview.previewHash, expectedKnowledgeBaseRevision: preview.expectedKnowledgeBaseRevision, workflowRunId })
      setConfirmResult(result)
      try { onThesisReload(await client.getThesis(thesis.thesisRef)) }
      catch (caught) { setCriterionError(`Criterion was confirmed, but canonical Thesis reload failed: ${errorText(caught)}`) }
    } catch (caught) { setCriterionError(errorText(caught)) } finally { setConfirmBusy(false) }
  }

  return <section className="thesis-criterion" aria-label="Kill Criterion authoring">
    <div className="section-title"><div><span className="eyebrow">HUMAN-AUTHORED INVALIDATION RULE</span><h4>Kill Criterion</h4></div><span className="read-only-badge">Prepare → review → confirm</span></div>
    {activeCriteria.length === 0 ? <div className="notice thesis-criterion-missing"><strong>No active Kill Criterion</strong><p>Thesis invalidation is blocked pending human confirmation. Narrative text is not inferred as a criterion.</p></div> : null}
    {criteria.length > 0 ? <div className="thesis-criterion-history" aria-label="Canonical Kill Criterion revisions"><strong>Canonical criterion revisions</strong>{criteria.map((item) => <article key={`${item.conditionId}-${item.revision}`}><span>{item.state} · {item.conditionId} v{item.revision} · {item.type}</span><p>{JSON.stringify(item.definition)}</p><small>Targets: {item.targetClaimRefs.join(', ')} · Origin: {item.origin.kind} · Confirmed {item.authority.confirmedAt}</small><small>Definition hash: {shortHash(item.definitionHash)}</small></article>)}</div> : null}
    <form className="thesis-refresh-form thesis-criterion-form" onSubmit={(event) => void prepare(event)}>
      <p className="muted">Define a numeric threshold and explicitly select its qualifying Claims. Preparation is read-only; only the separate confirmation action writes through the Knowledge Production Gateway.</p>
      <label className="thesis-field"><span>Condition ID</span><input aria-label="Criterion condition ID" maxLength={128} value={conditionId} onChange={(event) => { invalidatePreview(); setConditionId(event.target.value) }} required /></label>
      <label className="thesis-field"><span>Metric reference</span><input aria-label="Criterion metric reference" maxLength={256} value={metricRef} onChange={(event) => { invalidatePreview(); setMetricRef(event.target.value) }} required /></label>
      <div className="thesis-criterion-definition">
        <label className="thesis-field"><span>Operator</span><select aria-label="Criterion operator" value={operator} onChange={(event) => { invalidatePreview(); setOperator(event.target.value as typeof operator) }}><option value="lt">less than</option><option value="lte">less than or equal</option><option value="eq">equal</option><option value="gte">greater than or equal</option><option value="gt">greater than</option></select></label>
        <label className="thesis-field"><span>Threshold</span><input aria-label="Criterion threshold" type="number" step="any" value={threshold} onChange={(event) => { invalidatePreview(); setThreshold(event.target.value) }} required /></label>
      </div>
      <div className="thesis-criterion-definition">
        <label className="thesis-field"><span>Exact unit</span><input aria-label="Criterion unit" maxLength={128} value={unit} onChange={(event) => { invalidatePreview(); setUnit(event.target.value) }} required /></label>
        <label className="thesis-field"><span>Exact period</span><input aria-label="Criterion period" maxLength={256} value={period} onChange={(event) => { invalidatePreview(); setPeriod(event.target.value) }} required /></label>
      </div>
      <fieldset className="thesis-criterion-targets"><legend>Qualifying Claim targets <small>select one or more canonical active Claims</small></legend>{thesis.propositions.map((claim) => <label key={claim.claimRef}><input type="checkbox" checked={targetClaimRefs.includes(claim.claimRef)} onChange={(event) => { invalidatePreview(); setTargetClaimRefs((current) => event.target.checked ? [...current, claim.claimRef] : current.filter((ref) => ref !== claim.claimRef)) }} /><span>{claim.statement}</span><small>{claim.claimRef}</small></label>)}</fieldset>
      <label className="thesis-field"><span>Definition origin</span><select aria-label="Criterion definition origin" value={originKind} onChange={(event) => { invalidatePreview(); setOriginKind(event.target.value as typeof originKind) }}><option value="human_rule">Human-set investment rule</option><option value="source_derived">Source-derived threshold</option></select></label>
      {originKind === 'source_derived' ? <>
        <label className="thesis-field"><span>Canonical Source ref</span><input aria-label="Criterion source ref" value={sourceRef} onChange={(event) => { invalidatePreview(); setSourceRef(event.target.value) }} placeholder="source:…" required /></label>
        <label className="thesis-field"><span>Bound Raw ref</span><input aria-label="Criterion raw ref" value={rawRef} onChange={(event) => { invalidatePreview(); setRawRef(event.target.value) }} placeholder="raw-sha256-…" required /></label>
        <label className="thesis-field"><span>Exact quote locator</span><input aria-label="Criterion quote locator" value={locator} onChange={(event) => { invalidatePreview(); setLocator(event.target.value) }} placeholder="quote:<base64url exact span>" required /></label>
        <label className="thesis-field"><span>Source publication time</span><input aria-label="Criterion source published at" type="datetime-local" value={publishedAt} onChange={(event) => { invalidatePreview(); setPublishedAt(event.target.value) }} required /></label>
      </> : null}
      <button className="primary-action" type="submit" disabled={prepareBusy || targetClaimRefs.length === 0 || (originKind === 'source_derived' && !publishedAt)}>{prepareBusy ? 'Preparing preview…' : 'Prepare criterion preview'}</button>
    </form>
    {preview ? <section className="thesis-criterion-preview" aria-label="Prepared Kill Criterion preview"><span className="eyebrow">IMMUTABLE PREVIEW · NO WRITE YET</span><h5>{preview.conditionId} revision {preview.revision}</h5><p>{preview.definition.metricRef} {preview.definition.operator} {preview.definition.threshold} {preview.definition.unit} · {preview.definition.period}</p><p><strong>Definition hash:</strong> {preview.definitionHash}</p><p><strong>Targets:</strong> {preview.targetClaimRefs.join(', ')}</p><p><strong>Origin:</strong> {safeStructured(preview.origin)}</p><p><strong>Knowledge Base revision:</strong> {preview.expectedKnowledgeBaseRevision} · <strong>Confirmation run:</strong> {workflowRunId}</p><button className="primary-action" type="button" onClick={() => void confirm()} disabled={confirmBusy || Boolean(confirmResult)}>{confirmBusy ? 'Confirming…' : confirmResult ? 'Criterion confirmed' : 'Confirm and write criterion'}</button></section> : null}
    {confirmResult ? <div className="notice thesis-criterion-confirmed" role="status"><strong>Criterion {confirmResult.status}</strong><p>Canonical revision {confirmResult.criterionRevision} · Knowledge Base revision {confirmResult.knowledgeBaseRevision} · Writer run {confirmResult.writerRunId}</p></div> : null}
    {criterionError ? <div className="notice thesis-error" role="alert"><strong>Kill Criterion operation</strong><p>{criterionError}</p></div> : null}
  </section>
}

interface ThesisLifecyclePageProps { readonly client: RuntimeClient; readonly knowledgeBase?: KnowledgeBaseStatus }

function ThesisKillCriterionBindings({ scope, currentThesis, loading, loadError }: { readonly scope: ThesisReviewScope; readonly currentThesis?: ThesisQueryDetail; readonly loading: boolean; readonly loadError?: string }): ReactElement | null {
  const bindings = scope.killCriterionBindings ?? []
  if (bindings.length === 0) return null
  const canonicalThesis = currentThesis?.thesisRef === scope.thesisRef ? currentThesis : undefined
  return <section className="thesis-kill-bindings" aria-label="Canonical Kill Criterion evaluation">
    <h3>Canonical Kill Criterion evaluation</h3>
    {loading ? <p className="thesis-kill-current-state">Loading the current canonical Thesis definition before decision controls become available…</p> : null}
    {loadError ? <p className="thesis-kill-current-state thesis-kill-mismatch" role="alert">Current canonical Thesis definition could not be loaded: {loadError}</p> : null}
    {bindings.map((binding) => {
      const assessment = scope.killCriterionAssessments?.find((item) => item.conditionId === binding.conditionId)
      const criterion = canonicalThesis?.killCriteria?.find((item) => item.conditionId === binding.conditionId && item.state === 'active')
      const definition = criterion?.type === 'numeric_threshold' ? criterion.definition : undefined
      const metricRef = typeof definition?.metricRef === 'string' ? definition.metricRef : undefined
      const operator = typeof definition?.operator === 'string' ? definition.operator : undefined
      const threshold = typeof definition?.threshold === 'number' && Number.isFinite(definition.threshold) ? definition.threshold : undefined
      const unit = typeof definition?.unit === 'string' ? definition.unit : undefined
      const period = typeof definition?.period === 'string' ? definition.period : undefined
      const definitionComplete = metricRef !== undefined && operator !== undefined && threshold !== undefined && unit !== undefined && period !== undefined
      const matches = criterion?.revision === binding.revision && criterion.definitionHash === binding.definitionHash
      const matchStatus = !canonicalThesis
        ? loading ? 'Current canonical condition is loading.' : 'Current canonical condition is unavailable; this binding has not been compared.'
        : !criterion ? 'No active canonical condition matches this binding; the case is stale.'
          : matches ? 'Matches the active canonical condition revision and hash.'
            : `MISMATCH: active canonical condition is revision ${criterion.revision} with hash ${criterion.definitionHash}.`
      return <article className="thesis-kill-binding" key={`${binding.conditionId}-${binding.revision}`}>
        <p><strong>Condition:</strong> {binding.conditionId} · revision {binding.revision}</p>
        <p><strong>Assessment:</strong> {assessment?.status ?? 'Unreported'}</p>
        <p><strong>Current canonical rule:</strong> {definitionComplete ? `${metricRef} ${operator} ${threshold} ${unit} · ${period}` : criterion ? 'The active condition does not contain a complete numeric threshold definition.' : 'No active matching canonical numeric threshold is available.'}</p>
        <p className={matches ? '' : 'thesis-kill-mismatch'}><strong>Binding check:</strong> {matchStatus}</p>
        <p><strong>Definition hash:</strong> {binding.definitionHash}</p>
        <p><strong>Evaluated value:</strong> {binding.value} {binding.unit} · {binding.metricRef} · {binding.period}</p>
        <p><strong>Evidence:</strong> {binding.evidenceRef} · <strong>Source:</strong> {binding.sourceRef} · <strong>Raw:</strong> {binding.rawRef}</p>
        <p><strong>Published:</strong> {binding.publishedAt} · <strong>As of:</strong> {binding.asOf}</p>
        <p><strong>Target Claims:</strong> {binding.targetClaimRefs.join(', ')}</p>
        <p><strong>Numeric value version:</strong> {binding.numericValueVersionVerified ? 'verified' : 'unverified'}</p>
      </article>
    })}
  </section>
}

function thesisKillCriterionAcceptBlockReason(scope: ThesisReviewScope | undefined, currentThesis: ThesisQueryDetail | undefined, loading: boolean, loadError: string): string | undefined {
  const bindings = scope?.killCriterionBindings ?? []
  if (bindings.length === 0) return undefined
  if (loading) return 'ACCEPT is unavailable while the current canonical condition loads.'
  if (!currentThesis || currentThesis.thesisRef !== scope?.thesisRef) return loadError ? 'ACCEPT is disabled because the current canonical condition could not be loaded.' : 'ACCEPT is disabled until the current canonical condition is available.'
  for (const binding of bindings) {
    const criterion = currentThesis.killCriteria?.find((item) => item.conditionId === binding.conditionId && item.state === 'active')
    if (!criterion) return 'ACCEPT is disabled because an active canonical condition is missing; this ReviewCase is stale.'
    if (criterion.revision !== binding.revision || criterion.definitionHash !== binding.definitionHash) return 'ACCEPT is disabled because the active condition revision or hash changed; this ReviewCase is stale.'
  }
  return undefined
}

function ThesisLifecyclePage({ client, knowledgeBase }: ThesisLifecyclePageProps): ReactElement {
  const { t } = useLanguage()
  const [theses, setTheses] = useState<readonly ThesisQuerySummary[]>([])
  const [companies, setCompanies] = useState<readonly KnowledgeDirectoryItem[]>([])
  const [thesesBusy, setThesesBusy] = useState(false)
  const [selectedRef, setSelectedRef] = useState('')
  const [createCompanyRef, setCreateCompanyRef] = useState('')
  const [createTitle, setCreateTitle] = useState('')
  const [createNarrative, setCreateNarrative] = useState('')
  const [createEvidenceText, setCreateEvidenceText] = useState('')
  const [createRunId, setCreateRunId] = useState('')
  const [runMode, setRunMode] = useState<'CREATE' | 'REFRESH'>('REFRESH')
  const [thesis, setThesis] = useState<ThesisQueryDetail>()
  const [asOf, setAsOf] = useState(initialAsOfInput)
  const [evidenceText, setEvidenceText] = useState('')
  const [launchBusy, setLaunchBusy] = useState(false)
  const [runId, setRunId] = useState('')
  const [workflow, setWorkflow] = useState<WorkflowRun>()
  const [report, setReport] = useState<ResearchReport>()
  const [reviews, setReviews] = useState<ReviewListResponse>()
  const [selectedCaseId, setSelectedCaseId] = useState('')
  const [reviewDetail, setReviewDetail] = useState<ReviewDetail>()
  const [reviewThesis, setReviewThesis] = useState<ThesisQueryDetail>()
  const [reviewThesisBusy, setReviewThesisBusy] = useState(false)
  const [reviewThesisError, setReviewThesisError] = useState('')
  const [decisionNote, setDecisionNote] = useState('')
  const [decisionBusy, setDecisionBusy] = useState(false)
  const [error, setError] = useState('')
  const reportLookupRun = useRef('')
  const reviewLoadGeneration = useRef(0)

  const reloadTheses = useCallback(async (): Promise<void> => {
    setThesesBusy(true)
    try {
      const result = await client.listTheses(50)
      setTheses(result.theses)
      setSelectedRef((current) => result.theses.some((item) => item.thesisRef === current) ? current : result.theses[0]?.thesisRef ?? '')
    } catch (caught) { setError(errorText(caught)) } finally { setThesesBusy(false) }
  }, [client])

  useEffect(() => {
    if (!knowledgeBase) { setTheses([]); setThesis(undefined); return }
    void reloadTheses()
  }, [knowledgeBase, reloadTheses])

  useEffect(() => {
    if (!knowledgeBase) { setCompanies([]); setCreateCompanyRef(''); return }
    let cancelled = false
    void client.getKnowledgeDirectory().then((directory) => {
      if (cancelled) return
      setCompanies(directory.companies.items)
      setCreateCompanyRef((current) => directory.companies.items.some((item) => item.ref === current) ? current : directory.companies.items[0]?.ref ?? '')
    }).catch((caught) => { if (!cancelled) setError(errorText(caught)) })
    return () => { cancelled = true }
  }, [client, knowledgeBase])

  useEffect(() => {
    if (!selectedRef || !knowledgeBase) { setThesis(undefined); return }
    let cancelled = false
    void client.getThesis(selectedRef).then((value) => { if (!cancelled) setThesis(value) }).catch((caught) => { if (!cancelled) setError(errorText(caught)) })
    return () => { cancelled = true }
  }, [client, knowledgeBase, selectedRef])

  useEffect(() => {
    if (!knowledgeBase) { setReviews(undefined); return }
    void client.listReviews().then(setReviews).catch((caught) => setError(errorText(caught)))
  }, [client, knowledgeBase, runId, selectedCaseId])

  useEffect(() => {
    if (!runId) return undefined
    return startWorkflowPolling({
      runId,
      fetchWorkflow: (id) => client.workflow(id),
      onUpdate: (next) => {
        setWorkflow(next)
        if (!terminalWorkflowStatuses.has(next.status) || reportLookupRun.current === runId) return
        reportLookupRun.current = runId
        void client.listResearchReports(50).then(async (items) => {
          const match = items.find((item) => item.reportType === 'thesis_lifecycle' && item.workflowRunId === runId)
          if (match) setReport(await client.getResearchReport(match.reportId))
          else setError('Workflow completed but its persisted Thesis Lifecycle report is not in the report catalog yet.')
        }).catch((caught) => setError(errorText(caught)))
      },
      onError: (caught) => setError(errorText(caught)),
    })
  }, [client, runId])

  const launchRefresh = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!selectedRef || launchBusy || !asOf) return
    setLaunchBusy(true); setError(''); setReport(undefined); setWorkflow(undefined); setSelectedCaseId(''); setReviewDetail(undefined); reportLookupRun.current = ''
    try {
      const refs = parseEvidenceRefs(evidenceText)
      setRunMode('REFRESH')
      const result = await client.startThesisLifecycleRefresh({ thesisRef: selectedRef, asOf: new Date(asOf).toISOString(), ...(refs.length > 0 ? { evidenceRefs: refs } : {}) })
      setRunId(result.runId); setWorkflow(result.workflow)
    } catch (caught) { setError(errorText(caught)) } finally { setLaunchBusy(false) }
  }

  const launchCreate = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!createCompanyRef || !createTitle.trim() || !createNarrative.trim() || launchBusy) return
    const refs = parseEvidenceRefs(createEvidenceText)
    if (refs.length === 0 || refs.length > 40) { setError('Select between 1 and 40 canonical Claim or Observation references.'); return }
    setLaunchBusy(true); setError(''); setReport(undefined); setWorkflow(undefined); setSelectedCaseId(''); setReviewDetail(undefined); reportLookupRun.current = ''
    const workflowRunId = createRunId || `thesis-create-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`
    setCreateRunId(workflowRunId)
    try {
      setRunMode('CREATE')
      const result = await client.startThesisLifecycleCreate({ workflowRunId, companyRef: createCompanyRef, thesisTitle: createTitle.trim(), narrative: createNarrative.trim(), evidenceRefs: refs, asOf: new Date(asOf).toISOString() })
      setRunId(result.runId); setWorkflow(result.workflow); setCreateRunId('')
    } catch (caught) { setError(errorText(caught)) } finally { setLaunchBusy(false) }
  }

  const selectCase = async (id: string): Promise<void> => {
    const generation = ++reviewLoadGeneration.current
    setSelectedCaseId(id); setError(''); setReviewDetail(undefined); setReviewThesis(undefined); setReviewThesisBusy(false); setReviewThesisError('')
    try {
      const detail = await client.getThesisReview(id)
      if (generation !== reviewLoadGeneration.current) return
      setReviewDetail(detail); setDecisionNote('')
      const scope = detail.thesisScope
      if (scope) setSelectedRef(scope.thesisRef)
      if (scope?.killCriterionBindings?.length) {
        setReviewThesisBusy(true)
        const currentThesis = await client.getThesis(scope.thesisRef)
        if (generation !== reviewLoadGeneration.current) return
        setReviewThesis(currentThesis)
        setThesis(currentThesis)
      }
    } catch (caught) {
      if (generation === reviewLoadGeneration.current) { setReviewThesisError(errorText(caught)); setError(errorText(caught)) }
    } finally {
      if (generation === reviewLoadGeneration.current) setReviewThesisBusy(false)
    }
  }

  const submitDecision = async (decision: ThesisDecision): Promise<void> => {
    if (!selectedCaseId || !reviewDetail?.thesisScope || !reviewDetail.decision?.actionable || decisionBusy) return
    setDecisionBusy(true); setError('')
    try {
      await client.decideThesisReview(selectedCaseId, decision, decisionNote.trim() || undefined)
      const [detail, list] = await Promise.all([client.getThesisReview(selectedCaseId), client.listReviews()])
      setReviewDetail(detail); setReviews(list)
      if (decision === 'ACCEPT') { await reloadTheses(); const currentThesis = await client.getThesis(detail.thesisScope!.thesisRef); setThesis(currentThesis); setReviewThesis(currentThesis) }
    } catch (caught) { setError(errorText(caught)) } finally { setDecisionBusy(false) }
  }

  const thesisCases = (reviews?.cases ?? []).filter((item) => item.producerType === 'thesis_lifecycle')
  const scopedCase = Boolean(reviewDetail?.producerType === 'thesis_lifecycle' && reviewDetail.thesisScope && reviewDetail.thesisScope.thesisRef === selectedRef)
  const killCriterionAcceptBlockReason = thesisKillCriterionAcceptBlockReason(reviewDetail?.thesisScope, reviewThesis, reviewThesisBusy, reviewThesisError)

  return <main className="page-frame thesis-page" aria-labelledby="theses-title">
    <div className="page-heading"><div><span className="eyebrow">{t('规范知识 · V0.4', 'CANONICAL KNOWLEDGE · V0.4')}</span><h1 id="theses-title">{t('投资论点生命周期', 'Thesis Lifecycle')}</h1></div><span className="read-only-badge">{t('CREATE 使用所选证据 · REFRESH 需要审核', 'CREATE uses selected evidence · REFRESH requires review')}</span></div>
    {!knowledgeBase ? <div className="notice"><strong>{t('未挂载知识库', 'No Knowledge Base mounted')}</strong><p>{t('挂载规范 Schema 0.4 知识库后，可查看并刷新有效论点。', 'Mount a canonical Schema 0.4 Knowledge Base to inspect and refresh active theses.')}</p></div> : <>
      <section className="thesis-panel thesis-create-panel" aria-label={t('创建投资论点', 'Create Thesis')}><div className="section-title"><div><span className="eyebrow">{t('规范创建', 'CANONICAL CREATE')}</span><h2>{t('创建新的正式投资论点', 'Formalize a new investment Thesis')}</h2></div><span className="read-only-badge">Gateway → Writer</span></div><p className="muted">{t('选择一家公司及已有的规范证据。运行时会在写入论点、主张和成员关系前，验证公司范围、来源权利、Raw 来源脉络和发布时间。', 'Choose one company and existing canonical evidence. The runtime validates company scope, source rights, raw provenance, and publication time before it writes the Thesis, Claims, and membership edges.')}</p>
        <form className="thesis-refresh-form thesis-create-form" onSubmit={(event) => void launchCreate(event)}>
          <label className="thesis-field"><span>Company</span><select aria-label="CREATE company" value={createCompanyRef} onChange={(event) => setCreateCompanyRef(event.target.value)} required disabled={companies.length === 0}><option value="">Select a canonical company</option>{companies.map((item) => <option key={item.ref} value={item.ref}>{item.name} · {item.ref}</option>)}</select></label>
          <label className="thesis-field"><span>Thesis title</span><input aria-label="Thesis title" maxLength={240} value={createTitle} onChange={(event) => setCreateTitle(event.target.value)} required /></label>
          <label className="thesis-field"><span>Narrative <small>required · up to 8,000 characters</small></span><textarea aria-label="Thesis narrative" rows={4} maxLength={8000} value={createNarrative} onChange={(event) => setCreateNarrative(event.target.value)} required /></label>
          <label className="thesis-field"><span>Canonical evidence refs <small>required · 1 to 40 Claim/Observation refs</small></span><textarea aria-label="CREATE evidence refs" rows={3} maxLength={4000} value={createEvidenceText} onChange={(event) => setCreateEvidenceText(event.target.value)} placeholder="claim:… or observation:…" required /></label>
          <label className="thesis-field"><span>As of</span><input aria-label="CREATE as of" type="datetime-local" value={asOf} onChange={(event) => setAsOf(event.target.value)} required /></label>
          <button className="primary-action" type="submit" disabled={!createCompanyRef || companies.length === 0 || launchBusy}>{launchBusy && runMode === 'CREATE' ? t('正在创建…', 'Starting CREATE…') : t('创建投资论点', 'Create Thesis')}</button>
        </form>
      </section>
      <div className="thesis-layout">
        <section className="thesis-panel" aria-label="Active theses"><div className="section-title"><div><span className="eyebrow">ACTIVE THESIS</span><h2>{theses.length} available</h2></div><button className="secondary-action" onClick={() => void reloadTheses()} disabled={thesesBusy}>{thesesBusy ? 'Loading…' : 'Reload'}</button></div>
          <label className="thesis-field"><span>Canonical Thesis</span><select aria-label="Canonical Thesis" value={selectedRef} onChange={(event) => { setSelectedRef(event.target.value); setThesis(undefined); setReport(undefined); setReviewDetail(undefined); setSelectedCaseId('') }} disabled={thesesBusy || theses.length === 0}><option value="">Select a Thesis</option>{theses.map((item) => <option key={item.thesisRef} value={item.thesisRef}>{item.title} · {item.companySubject.name} · {item.status}</option>)}</select></label>
          {thesis ? <div className="thesis-summary"><span className="result-kind">{thesis.status} · revision {thesis.revision}</span><h3>{thesis.title}</h3><p>{thesis.statement}</p><small>{thesis.thesisRef} · {thesis.companySubject.name} · {thesis.propositions.length} propositions</small><div className="thesis-propositions">{thesis.propositions.map((item) => <article key={item.claimRef}><strong>{item.claimType}</strong><p>{item.statement}</p><small>{item.claimRef}</small></article>)}</div></div> : <p className="muted">{thesesBusy ? t('正在加载有效论点…', 'Loading active theses…') : t('未找到有效的规范论点。', 'No active canonical Theses were found.')}</p>}
          {thesis && thesis.thesisRef === selectedRef ? <ThesisCriterionAuthoring key={thesis.thesisRef} client={client} thesis={thesis} onThesisReload={setThesis} /> : null}
        </section>
        <section className="thesis-panel" aria-label="Refresh controls"><div className="section-title"><div><span className="eyebrow">POINT-IN-TIME REFRESH</span><h2>Re-evaluate accepted evidence</h2></div></div><p className="muted">The runtime reconstructs proposition membership from canonical <code>qualifies</code> edges and admits only source-bound evidence published by the selected time.</p>
          <form className="thesis-refresh-form" onSubmit={(event) => void launchRefresh(event)}>
            <label className="thesis-field"><span>As of</span><input aria-label="As of" type="datetime-local" value={asOf} onChange={(event) => setAsOf(event.target.value)} required /></label>
            <label className="thesis-field"><span>Evidence refs <small>optional · up to 80 canonical Observation/Claim refs</small></span><textarea aria-label="Evidence refs" rows={3} maxLength={5000} value={evidenceText} onChange={(event) => setEvidenceText(event.target.value)} placeholder="observation:… or claim:…" /></label>
            <button className="primary-action" type="submit" disabled={!selectedRef || launchBusy}>{launchBusy ? t('正在刷新…', 'Starting refresh…') : t('刷新投资论点', 'Refresh Thesis')}</button>
          </form>
        </section>
      </div>
      {error ? <div className="notice thesis-error" role="alert"><strong>Thesis operation</strong><p>{error}</p></div> : null}
      {runId ? <section className="thesis-result" aria-label={`${runMode} run`}><div className="section-title"><div><span className="eyebrow">{runMode} RUN</span><h2>{workflow?.status ?? 'accepted'}</h2></div><small>{runId}</small></div><p>{workflow?.progressSummary ?? workflow?.errorSummary ?? `Waiting for the lifecycle ${runMode} workflow to finish…`}</p>{workflow?.status === 'blocked' || workflow?.status === 'failed' ? <p className="thesis-diagnostic">{workflow.errorSummary ?? `The ${runMode} did not complete.`}</p> : null}</section> : null}
      {report ? <section className="thesis-result" aria-label="Persisted Thesis Lifecycle report"><div className="section-title"><div><span className="eyebrow">PERSISTED REPORT · {report.reportType}</span><h2>{report.reportId}</h2></div><small>KB revision {report.knowledgeBaseRevision} · as of {report.asOf}</small></div><p>{report.methodology}</p><div className="brief-metrics"><span><b>{report.sourceRefs.length}</b> sources</span><span><b>{report.claimRefs.length}</b> claims</span><span><b>{report.sections.length}</b> sections</span></div>{report.sections.map((section) => <article className="brief-section" key={section.id}><div className="brief-section-heading"><h3>{section.title}</h3><span>{section.id}</span></div><pre className="thesis-report-markdown">{section.markdown}</pre></article>)}</section> : null}
      <section className="thesis-review-area" aria-label="Thesis scoped ReviewCases"><div className="section-title"><div><span className="eyebrow">HUMAN DECISIONS</span><h2>Thesis ReviewCases</h2></div><span className="read-only-badge">Gateway → Writer on ACCEPT</span></div><div className="thesis-review-layout"><section className="thesis-panel"><div className="result-list">{thesisCases.map((item) => <button className={`review-item ${selectedCaseId === item.reviewCaseId ? 'selected' : ''}`} key={item.reviewCaseId} onClick={() => void selectCase(item.reviewCaseId)}><strong>{item.reviewCaseId}</strong><span>{item.decisionState ?? 'OPEN'} · {item.category} · {item.actionability}</span><small>{item.rationale}</small><small>{item.producerRunId}</small></button>)}</div>{thesisCases.length === 0 ? <p className="muted">No actionable Thesis ReviewCases are currently listed.</p> : null}</section>
        {reviewDetail && scopedCase ? <section className="review-detail" aria-label="Thesis ReviewCase detail"><div className="detail-title"><span>Thesis ReviewCase</span><button onClick={() => { reviewLoadGeneration.current++; setReviewDetail(undefined); setReviewThesis(undefined); setReviewThesisBusy(false); setReviewThesisError(''); setSelectedCaseId('') }}>{t('关闭', 'Close')}</button></div><h2>{reviewDetail.reviewCaseId}</h2><p><strong>Thesis:</strong> {reviewDetail.thesisScope!.thesisRef}</p><p><strong>Root Claim:</strong> {reviewDetail.thesisScope!.rootClaimRef}</p><p><strong>Transition:</strong> {reviewDetail.thesisScope!.candidateTransition}{reviewDetail.thesisScope!.proposedThesisStatus ? ` → ${reviewDetail.thesisScope!.proposedThesisStatus}` : ''}</p><p><strong>As of:</strong> {reviewDetail.thesisScope!.asOf}</p><p><strong>Affected Claims:</strong> {reviewDetail.thesisScope!.affectedClaimRefs.join(', ')}</p><p><strong>Reviewed evidence:</strong> {safeStructured(reviewDetail.thesisScope!.reviewedEvidence)}</p><p><strong>Evidence bindings:</strong> {safeStructured(reviewDetail.evidenceBindings)}</p><ThesisKillCriterionBindings scope={reviewDetail.thesisScope!} currentThesis={reviewThesis} loading={reviewThesisBusy} loadError={reviewThesisError || undefined} /><p><strong>Decision state:</strong> {reviewDetail.decision?.state ?? 'OPEN'}</p>{reviewDetail.decision?.events.length ? <div className="thesis-history"><strong>Decision history</strong>{reviewDetail.decision.events.map((item) => <p key={`${item.revision}-${item.type}`}>{item.type} · {item.at}{item.note ? ` · ${item.note}` : ''}{item.writerRunId ? ` · ${item.writerRunId}` : ''}</p>)}</div> : null}{reviewDetail.decision?.actionable ? <div className="thesis-decision-controls"><label className="thesis-field"><span>Decision note <small>optional · up to 1000 characters</small></span><textarea aria-label="Decision note" rows={3} maxLength={1000} value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} /></label>{killCriterionAcceptBlockReason ? <p className="thesis-kill-accept-block" role="status">{killCriterionAcceptBlockReason}</p> : null}<div className="thesis-decision-buttons"><button className="primary-action" onClick={() => void submitDecision('ACCEPT')} disabled={decisionBusy || Boolean(killCriterionAcceptBlockReason)}>{t('接受已审核的变更', 'Accept reviewed changes')}</button><button className="secondary-action" onClick={() => void submitDecision('DEFER')} disabled={decisionBusy}>{t('暂缓', 'Defer')}</button><button className="danger-action" onClick={() => void submitDecision('REJECT')} disabled={decisionBusy}>{t('拒绝', 'Reject')}</button></div></div> : <p className="muted">This case is resolved or is no longer actionable.</p>}</section> : <div className="notice detail-empty"><strong>Select a Thesis ReviewCase</strong><p>Acceptance rebinds the current Thesis, propositions, evidence, and provenance before the Gateway and Writer execute the reviewed change.</p></div>}
      </div></section>
    </>}
  </main>
}


interface BriefsPageProps { readonly briefs?: readonly DailyBriefSummary[]; readonly selected?: DailyBriefReport; readonly busy: boolean; readonly error: string; readonly onSelect: (reportId: string) => void }
function BriefsPage({ briefs, selected, busy, error, onSelect }: BriefsPageProps): ReactElement {
  const { t } = useLanguage()
  return <main className="page-frame briefs-page" aria-labelledby="briefs-title"><div className="page-heading"><div><span className="eyebrow">{t('个人研究', 'PERSONAL RESEARCH')}</span><h1 id="briefs-title">{t('每日简报', 'Daily Briefs')}</h1></div><span className="read-only-badge">{t('只读', 'Read-only')}</span></div><p>{t('浏览已保存的早间和晚间情报，查看各部分证据。', 'Browse persisted Morning and Evening Intelligence outputs with section-level evidence kept visible.')}</p>{error ? <div className="notice" role="alert"><strong>{t('每日简报不可用', 'Daily Briefs unavailable')}</strong><p>{error}</p></div> : busy ? <p className="muted">{t('正在加载每日简报…', 'Loading Daily Briefs…')}</p> : briefs && briefs.length > 0 ? <div className="briefs-layout"><section aria-label={t('每日简报历史', 'Daily Brief history')}><div className="section-title"><div><span className="eyebrow">{t('历史记录', 'HISTORY')}</span><h2>{briefs.length} {t('份简报', 'briefs')}</h2></div></div><div className="result-list">{briefs.map((brief) => <button className={`result-item ${selected?.reportId === brief.reportId ? 'selected' : ''}`} key={brief.reportId} onClick={() => onSelect(brief.reportId)}><strong>{brief.briefType === 'morning' ? t('早间', 'Morning') : t('晚间', 'Evening')} · {brief.tradeDate}</strong><span>{brief.quality.topCount} {t('条重点信号 ·', 'top signals ·')} {Math.round(brief.quality.reportItemWithSourceRatio * 100)}% {t('有来源', 'sourced')}</span><small>{brief.reportId}</small></button>)}</div></section>{selected ? <section className="brief-detail" aria-label={t('每日简报详情', 'Daily Brief detail')}><div className="detail-title"><div><span className="eyebrow">{selected.briefType === 'morning' ? t('早间简报', 'MORNING BRIEF') : t('晚间简报', 'EVENING BRIEF')}</span><h2>{selected.tradeDate}</h2></div><small>{t('修订', 'Revision')} {selected.revision} · {selected.timezone}</small></div><p className="brief-methodology">As of {selected.asOf}. {selected.consensusStatement}</p><div className="brief-metrics"><span><b>{selected.quality.reportItemCount ?? 0}</b> {t('条目', 'items')}</span><span><b>{selected.quality.claimCount ?? 0}</b> {t('主张', 'claims')}</span><span><b>{selected.reviewCaseCount}</b> {t('项审核', 'reviews')}</span></div>{selected.sections.map((section) => <article className={`brief-section ${section.unavailable ? 'unavailable' : ''}`} key={section.id}><div className="brief-section-heading"><h3>{section.title}</h3>{section.unavailable ? <span>{t('不可用', 'Unavailable')}</span> : null}</div>{section.items.map((item) => <div className="brief-item" key={item.itemId}><strong>{item.headline}</strong><p>{item.markdown}</p>{item.sourceRefs.length > 0 ? <small>{t('来源：', 'Sources: ')}{item.sourceRefs.join(', ')}</small> : null}</div>)}</article>)}</section> : <div className="notice detail-empty"><strong>{t('选择一份简报', 'Select a brief')}</strong><p>{t('选择已保存的简报以查看范围明确的内容和来源脉络。', 'Choose a persisted brief to inspect its bounded sections and provenance.')}</p></div>}</div> : <div className="notice"><strong>{t('暂无已保存的每日简报', 'No persisted Daily Briefs')}</strong><p>{t('通过 Agent 或 API 运行每日情报以生成简报。', 'Run Daily Intelligence through the Agent or API to create a brief.')}</p></div>}</main>
}

const reportTypeLabel: Record<ResearchReportSummary['reportType'], string> = { company_research: 'Company Research', industry_research: 'Industry Research', earnings_review: 'Earnings Review', valuation: 'Valuation', event_research: 'Event Research', thesis_red_team: 'Thesis Red Team', thesis_lifecycle: 'Thesis Lifecycle' }
interface ReportsPageProps { readonly reports?: readonly ResearchReportSummary[]; readonly selected?: ResearchReport; readonly busy: boolean; readonly error: string; readonly onSelect: (reportId: string) => void }
function ReportsPage({ reports, selected, busy, error, onSelect }: ReportsPageProps): ReactElement {
  const { t } = useLanguage()
  return <main className="page-frame reports-page" aria-labelledby="reports-title"><div className="page-heading"><div><span className="eyebrow">{t('个人研究', 'PERSONAL RESEARCH')}</span><h1 id="reports-title">{t('研究报告', 'Research Reports')}</h1></div><span className="read-only-badge">{t('只读', 'Read-only')}</span></div><p>{t('浏览已保存的公司、行业、业绩、估值、事件和论点报告及其来源脉络。', 'Browse persisted Company, Industry, Earnings, Valuation, Event, and Thesis reports with bounded provenance kept visible.')}</p>{error ? <div className="notice" role="alert"><strong>{t('研究报告不可用', 'Research Reports unavailable')}</strong><p>{error}</p></div> : busy ? <p className="muted">{t('正在加载研究报告…', 'Loading Research Reports…')}</p> : reports && reports.length > 0 ? <div className="reports-layout"><section aria-label={t('研究报告历史', 'Research Report history')}><div className="section-title"><div><span className="eyebrow">{t('历史记录', 'HISTORY')}</span><h2>{reports.length} {t('份报告', 'reports')}</h2></div></div><div className="result-list">{reports.map((report) => <button className={`result-item ${selected?.reportId === report.reportId ? 'selected' : ''}`} key={report.reportId} onClick={() => onSelect(report.reportId)}><span className="result-kind">{reportTypeLabel[report.reportType]}</span><strong>{report.subjectRefs.join(', ')}</strong><span>{report.sectionCount} {t('个章节 ·', 'sections ·')} {report.sourceCount} {t('个来源 · KB r', 'sources · KB r')}{report.knowledgeBaseRevision}</span><small>{new Date(report.generatedAt).toLocaleString()} · {report.reportId}</small></button>)}</div></section>{selected ? <section className="report-detail" aria-label={t('研究报告详情', 'Research Report detail')}><div className="detail-title"><div><span className="eyebrow">{reportTypeLabel[selected.reportType]}</span><h2>{selected.reportId}</h2></div><small>{t('知识库修订', 'KB revision')} {selected.knowledgeBaseRevision}</small></div><p className="report-methodology">As of {selected.asOf}. {selected.methodology}</p><div className="brief-metrics"><span><b>{selected.sections.length}</b> {t('个章节', 'sections')}</span><span><b>{selected.sourceRefs.length}</b> {t('个来源', 'sources')}</span><span><b>{selected.claimRefs.length}</b> {t('条主张', 'claims')}</span></div><p className="report-refs"><strong>{t('主题：', 'Subjects:')}</strong> {selected.subjectRefs.join(', ') || t('无', 'None')}</p>{selected.sections.map((section) => <article className="brief-section" key={section.id}><div className="brief-section-heading"><h3>{section.title}</h3><span>{section.id}</span></div><p className="report-markdown">{section.markdown}</p>{section.sourceRefs?.length ? <small>{t('来源：', 'Sources: ')}{section.sourceRefs.join(', ')}</small> : null}{section.claimRefs?.length ? <small>{t('主张：', 'Claims: ')}{section.claimRefs.join(', ')}</small> : null}{section.relationRefs?.length ? <small>{t('关系：', 'Relations: ')}{section.relationRefs.join(', ')}</small> : null}</article>)}</section> : <div className="notice detail-empty"><strong>{t('选择一份报告', 'Select a report')}</strong><p>{t('选择已保存的报告以查看范围明确的章节和来源脉络。', 'Choose a persisted report to inspect its bounded sections and provenance.')}</p></div>}</div> : <div className="notice"><strong>{t('暂无已保存的研究报告', 'No persisted Research Reports')}</strong><p>{t('通过 Agent 或 API 运行受治理的研究工作流以生成报告。', 'Run a governed research workflow through the Agent or API to create a report.')}</p></div>}</main>
}

type ResearchBundleDetail = ResearchBundleSummary & { readonly structuredResult: unknown; readonly sourceLibraryHits: readonly SourceLibraryHit[] }
interface ResearchBundlesPageProps { readonly bundles?: readonly ResearchBundleSummary[]; readonly selected?: ResearchBundleDetail; readonly busy: boolean; readonly error: string; readonly onSelect: (bundleId: string) => void; readonly sourceHits: readonly SourceLibraryHit[]; readonly sourceBusy: boolean; readonly onSearchSources: (query: string) => void }
function ResearchBundlesPage({ bundles, selected, busy, error, onSelect, sourceHits, sourceBusy, onSearchSources }: ResearchBundlesPageProps): ReactElement {
  const { t } = useLanguage()
  const [sourceQuery, setSourceQuery] = useState('')
  return <main className="page-frame reports-page" aria-labelledby="bundles-title"><div className="page-heading"><div><span className="eyebrow">{t('研究资料', 'RESEARCH ARTIFACTS')}</span><h1 id="bundles-title">{t('研究资料包', 'Research Bundles')}</h1></div><span className="read-only-badge">{t('只读', 'Read-only')}</span></div><p>{t('查看统一结构化结果、报告与提案链接，以及有 Raw 来源支持的资料库证据候选。', 'Inspect the unified structured result, report/proposal links, and Raw-backed Source Library evidence candidates.')}</p>{error ? <div className="notice" role="alert"><strong>{t('研究资料包不可用', 'Research Bundles unavailable')}</strong><p>{error}</p></div> : busy ? <p className="muted">{t('正在加载研究资料包…', 'Loading Research Bundles…')}</p> : bundles && bundles.length > 0 ? <div className="reports-layout"><section aria-label="Research Bundle history"><div className="section-title"><div><span className="eyebrow">{t('历史记录', 'HISTORY')}</span><h2>{bundles.length} {t('个资料包', 'bundles')}</h2></div></div><div className="result-list">{bundles.map((bundle) => <button className={`result-item ${selected?.bundleId === bundle.bundleId ? 'selected' : ''}`} key={bundle.bundleId} onClick={() => onSelect(bundle.bundleId)}><strong>{bundle.status}</strong><span>{bundle.proposals.length} {t('个提案 ·', 'proposals ·')} {(bundle.sourceLibraryHits ?? []).length} {t('条资料库结果', 'Source Library hits')}</span><small>{new Date(bundle.createdAt).toLocaleString()} · {bundle.workflowRunId}</small></button>)}</div></section>{selected ? <section className="report-detail" aria-label="Research Bundle detail"><div className="detail-title"><div><span className="eyebrow">{t('结构化结果', 'STRUCTURED RESULT')}</span><h2>{selected.bundleId}</h2></div><small>{selected.status}</small></div><p><strong>{t('工作流运行：', 'Workflow run:')}</strong> {selected.workflowRunId}</p>{selected.report ? <p><strong>{t('报告：', 'Report:')}</strong> {selected.report.reportId}</p> : null}<div className="brief-metrics"><span><b>{selected.proposals.length}</b> proposals</span><span><b>{selected.sourceLibraryHits.length}</b> source hits</span></div><article className="brief-section"><div className="brief-section-heading"><h3>{t('知识提案', 'Knowledge Proposals')}</h3><span>{t('由资料包生成', 'derived from bundle')}</span></div>{selected.proposals.length ? selected.proposals.map((proposal) => <div className="brief-item" key={proposal.proposalId}><strong>{proposal.proposalId}</strong><small>{proposal.kind ?? 'proposal'}</small></div>) : <p className="muted">{t('没有记录提案。', 'No proposals recorded.')}</p>}</article><article className="brief-section"><div className="brief-section-heading"><h3>{t('来源资料库证据', 'Source Library Evidence')}</h3><span>{t('基于 Raw', 'Raw-backed')}</span></div>{selected.sourceLibraryHits.length ? selected.sourceLibraryHits.map((hit) => <div className="brief-item" key={hit.sourceLibraryRef}><strong>{hit.title}</strong><p>{hit.excerpt}</p><small>{hit.sourceLibraryRef} · Raw {hit.rawRef}</small></div>) : <p className="muted">{t('此资料包未附带来源资料库结果。', 'No Source Library hits were attached to this bundle.')}</p>}</article><article className="brief-section"><div className="brief-section-heading"><h3>{t('结构化结果', 'Structured Result')}</h3><span>{t('范围受限的预览', 'bounded preview')}</span></div><p className="report-markdown">{safeStructured(selected.structuredResult)}</p></article></section> : <div className="notice detail-empty"><strong>{t('选择一个研究资料包', 'Select a ResearchBundle')}</strong><p>{t('选择资料以查看派生输出和证据脉络。', 'Choose an artifact to inspect its derived outputs and evidence lineage.')}</p></div>}</div> : <div className="notice"><strong>{t('暂无已保存的研究资料包', 'No persisted Research Bundles')}</strong><p>{t('通过聊天研究入口创建资料包。', 'Use the Chat Research entry to create a bundle.')}</p></div>}<section className="context-section" aria-label="Source Library search"><div className="section-title"><div><span className="eyebrow">RAW-BACKED RETRIEVAL</span><h2>{t('来源资料库搜索', 'Source Library Search')}</h2></div><span className="read-only-badge">{t('只读', 'Read-only')}</span></div><form className="source-search" onSubmit={(event) => { event.preventDefault(); if (sourceQuery.trim()) onSearchSources(sourceQuery.trim()) }}><input aria-label="Source Library query" value={sourceQuery} onChange={(event) => setSourceQuery(event.target.value)} placeholder={t('搜索已存档的 Raw 证据…', 'Search archived Raw evidence…')} /><button className="secondary-action" type="submit" disabled={sourceBusy || !sourceQuery.trim()}>{sourceBusy ? t('正在搜索…', 'Searching…') : t('搜索', 'Search')}</button></form>{sourceHits.length ? <div className="result-list">{sourceHits.map((hit) => <div className="result-item" key={hit.sourceLibraryRef}><strong>{hit.title}</strong><span>{hit.excerpt}</span><small>{hit.sourceLibraryRef} · Raw {hit.rawRef}</small></div>)}</div> : <p className="muted">{t('搜索结果仅为证据候选，不会修改规范知识。', 'Search results are evidence candidates only; canonical Knowledge is unchanged.')}</p>}</section></main>
}

interface ResearchPageProps {
  readonly session?: SessionState
  readonly conversations: readonly ConversationSummary[]
  readonly messages: readonly ConversationMessage[]
  readonly streaming: boolean
  readonly thinking: boolean
  readonly streamText: string
  readonly toolEvents: readonly string[]
  readonly queue: { readonly steering: number; readonly followUp: number }
  readonly composer: string
  readonly busy: boolean
  readonly error: string
  readonly attachment?: AttachmentRef
  readonly attachmentUiVersion: number
  readonly attachmentBusy: boolean
  readonly preview?: RawDocumentPreviewV04
  readonly previewBusy: boolean
  readonly acceptanceBusy: boolean
  readonly selectedCandidates: ReadonlySet<string>
  readonly acceptance?: RawDocumentAcceptanceV04
  readonly rightsForm: V04RightsForm
  readonly sourceForm: V04SourceForm
  readonly uploadStatus: string
  readonly workflowRunId: string
  readonly themeFrameworkRunId: string
  readonly setThemeFrameworkRunId: (value: string) => void
  readonly themeFrameworkRefreshInfo?: { readonly fromRunId: string; readonly fromRevision: number; readonly toRevision: number }
  readonly setThemeFrameworkRefreshInfo: (value: ResearchPageProps['themeFrameworkRefreshInfo']) => void
  readonly themeFrameworkReviewRevision: number
  readonly refreshThemeFrameworkReviews: () => void
  readonly client: RuntimeClient
  readonly workflow?: WorkflowRun
  readonly knowledgeBase?: KnowledgeBaseStatus
  readonly openReviewCases: number
  readonly workflowDefinitions: readonly WorkflowDefinition[]
  readonly selectedWorkflowId: string
  readonly setSelectedWorkflowId: (value: string) => void
  readonly contextPolicy: { readonly structuredKnowledge: boolean; readonly sourceLibrary: boolean }
  readonly persistencePolicy: { readonly writeKnowledge: boolean }
  readonly setContextPolicy: (value: { readonly structuredKnowledge: boolean; readonly sourceLibrary: boolean }) => void
  readonly setPersistencePolicy: (value: { readonly writeKnowledge: boolean }) => void
  readonly executionSummary?: ResearchExecutionSummary
  readonly dispatchFeedback?: ResearchDispatchFeedback
  readonly dispatchResolution?: ResearchDispatchResolution
  readonly verifiedWorkflowBundleId?: string
  readonly workflowPollNotice: string
  readonly setComposer: (value: string) => void
  readonly newConversation: () => void
  readonly switchConversation: (conversationId: string) => void
  readonly runCommand: (operation: 'prompt' | 'steer' | 'follow_up') => void
  readonly abort: () => void
  readonly upload: (file: File | undefined) => void
  readonly toggleCandidate: (candidateId: string) => void
  readonly setRightsForm: (value: V04RightsForm) => void
  readonly setSourceForm: (value: V04SourceForm) => void
  readonly startPreview: () => void
  readonly acceptCandidates: () => void
  readonly clearAttachment: () => void
  readonly cancelWorkflow: () => void
  readonly openWorkflowReport: (reportId: string) => void
  readonly openWorkflowBundle: (bundleId: string) => void
  readonly openWorkflowReview: (kind: NonNullable<NonNullable<WorkflowRun['executionResult']>['reviewRef']>['kind'], id: string) => void
  readonly dismissError: () => void
  readonly onNavigate: (route: Route) => void
}

function DispatchFeedbackPanel({ feedback }: { readonly feedback: ResearchDispatchFeedback }): ReactElement {
  const { t } = useLanguage()
  const statusCopy: Readonly<Record<ResearchDispatchFeedback['status'], { readonly zh: string; readonly en: string }>> = {
    NEEDS_INPUT: { zh: '需要补充工作流输入', en: 'Workflow needs additional input' },
    INVALID_INPUT: { zh: '输入未通过工作流校验', en: 'Workflow input did not pass validation' },
    UNRESOLVED_REFERENCE: { zh: '无法解析所需引用', en: 'A required reference could not be resolved' },
    EXECUTOR_UNAVAILABLE: { zh: '当前工作流执行器不可用', en: 'This Workflow executor is unavailable' },
  }
  return <section className="execution-summary" aria-label={t('Workflow 输入反馈', 'Workflow input feedback')} role="status">
    <strong>{feedback.workflowId} · {t(statusCopy[feedback.status].zh, statusCopy[feedback.status].en)}</strong>
    <span>{feedback.status === 'NEEDS_INPUT' ? feedback.reason : t(statusCopy[feedback.status].zh, statusCopy[feedback.status].en)}</span>
    {feedback.missingFields.length ? <span>{t('缺失字段：', 'Missing fields: ')}{feedback.missingFields.join(', ')}</span> : null}
    <span>{t('已解析参数：', 'Resolved arguments: ')}{Object.keys(feedback.validatedArguments).length ? JSON.stringify(feedback.validatedArguments) : t('无', 'none')}</span>
    <span>{t('建议补充：', 'Suggested question: ')}{feedback.suggestedQuestion}</span>
  </section>
}

function WorkflowResultFeedback({ workflow, verifiedBundleId, onOpenReport, onOpenBundle, onOpenReview }: {
  readonly workflow: WorkflowRun
  readonly verifiedBundleId?: string
  readonly onOpenReport: (reportId: string) => void
  readonly onOpenBundle: (bundleId: string) => void
  readonly onOpenReview: (kind: NonNullable<NonNullable<WorkflowRun['executionResult']>['reviewRef']>['kind'], id: string) => void
}): ReactElement | null {
  const { t } = useLanguage()
  if (!terminalWorkflowStatuses.has(workflow.status)) return null
  const result = workflow.executionResult
  const stateCopy: Readonly<Record<WorkflowRun['status'], { readonly zh: string; readonly en: string }>> = {
    pending: { zh: '等待执行', en: 'Waiting to execute' },
    running: { zh: '正在执行', en: 'Running' },
    completed: { zh: '工作流已完成', en: 'Workflow completed' },
    completed_with_review: { zh: '工作流完成，等待审核', en: 'Workflow completed and requires review' },
    blocked: { zh: '工作流受阻', en: 'Workflow is blocked' },
    cancelled: { zh: '工作流已取消', en: 'Workflow was cancelled' },
    failed: { zh: '工作流未能完成', en: 'Workflow failed' },
  }
  const state = stateCopy[workflow.status]
  return <section className={`workflow-result-feedback workflow-result-${workflow.status}`} aria-label={t('工作流结果', 'Workflow result')} role="status">
    <strong>{t(state.zh, state.en)}</strong>
    {result?.summary ? <p>{result.summary}</p> : workflow.progressSummary ? <p>{workflow.progressSummary}</p> : null}
    {result?.blockedReason ? <p>{t('阻断原因：', 'Blocked because: ')}{result.blockedReason}</p> : null}
    {result?.diagnostics.length ? <small>{t('诊断代码：', 'Diagnostics: ')}{result.diagnostics.join(', ')}</small> : null}
    <div className="workflow-result-links">
      {result?.reportRef ? <button type="button" className="secondary-action" onClick={() => onOpenReport(result.reportRef!)}>{workflow.workflowType === 'daily_intelligence' ? t('打开每日简报', 'Open Daily Brief') : t('打开研究报告', 'Open Research Report')}</button> : null}
      {result?.bundleRef && verifiedBundleId === result.bundleRef ? <button type="button" className="secondary-action" onClick={() => onOpenBundle(result.bundleRef!)}>{t('打开研究资料包', 'Open Research Bundle')}</button> : result?.bundleStatus === 'pending' ? <span>{t('正在同步研究资料包…', 'Syncing Research Bundle…')}</span> : null}
      {result?.reviewRef ? <button type="button" className="secondary-action" onClick={() => onOpenReview(result.reviewRef!.kind, result.reviewRef!.id)}>{t('打开审核结果', 'Open review result')}</button> : null}
    </div>
  </section>
}

function DispatchResolutionNotice({ resolution }: { readonly resolution: ResearchDispatchResolution }): ReactElement | null {
  const { t } = useLanguage()
  if (resolution.source === 'reasoning_executor' && resolution.attempts === 1 && resolution.diagnostics.length === 0) return null
  const source = resolution.source === 'bounded_repair'
    ? t('已执行一次有界参数修复', 'One bounded argument repair was used')
    : resolution.source === 'deterministic_fallback'
      ? t('已使用确定性参数回退', 'Deterministic argument fallback was used')
      : t('语义解析执行器不可用', 'Semantic resolver was unavailable')
  const diagnostics: Readonly<Record<string, { readonly zh: string; readonly en: string }>> = {
    invalid_semantic_output_repaired: { zh: '首次语义输出未通过输入契约，修复后通过校验。', en: 'The first semantic output failed the input contract and was repaired.' },
    reasoning_executor_unconfigured: { zh: '未配置语义推理执行器。', en: 'No semantic reasoning executor is configured.' },
    semantic_output_rejected: { zh: '语义输出未通过契约校验。', en: 'Semantic output failed contract validation.' },
    deterministic_fallback_used: { zh: '回退参数仍经过同一 Workflow 输入契约校验。', en: 'Fallback arguments were validated against the same Workflow input contract.' },
  }
  const details = resolution.diagnostics.flatMap((code) => { const item = diagnostics[code]; return item ? [t(item.zh, item.en)] : [] })
  return <section className="execution-summary" aria-label={t('Workflow 解析记录', 'Workflow resolution record')} role="status"><strong>{source}</strong><span>{t('尝试次数：', 'Attempts: ')}{resolution.attempts}</span>{details.map((detail) => <span key={detail}>{detail}</span>)}</section>
}

function KnowledgeUploadSection(props: ResearchPageProps): ReactElement | null {
  const { t } = useLanguage()

  const [rightsOpen, setRightsOpen] = useState(false)
  const groups = props.preview?.candidateGroups ?? []
  const groupKinds: readonly RawDocumentCandidateGroupV04['kind'][] = ['entity', 'relation', 'claim']
  const rightsChecks: readonly [keyof Pick<V04RightsForm, 'providerTermsKnown' | 'retentionAllowed' | 'aiProcessingAllowed' | 'derivativeKnowledgeAllowed' | 'redistributionAllowed'>, string][] = [
    ['providerTermsKnown', t('我已查阅服务方条款', 'I checked the provider terms')], ['retentionAllowed', t('允许保留 Raw 数据', 'Raw retention is allowed')], ['aiProcessingAllowed', t('允许进行 AI 处理', 'AI processing is allowed')], ['derivativeKnowledgeAllowed', t('允许生成派生知识', 'Derived Knowledge is allowed')], ['redistributionAllowed', t('允许再分发', 'Redistribution is allowed')],
  ]
  if (!props.attachment && !props.uploadStatus && !props.preview && !props.acceptance) return null
  return <section className="attachment-review" aria-label={t('知识上传', 'Knowledge upload')}>
    {props.attachment ? <div className="staged-attachment"><span className="attachment-icon" aria-hidden="true">↥</span><span className="attachment-file"><strong title={props.attachment.filename}>{props.attachment.filename}</strong><small>{props.attachment.mediaType} · {formatSize(props.attachment.size)} · {t('已暂存，尚未写入', 'staged, not written')}</small></span>{props.preview ? <span className="preview-ready-label">{t('预览已就绪', 'Preview ready')}</span> : <button type="button" className="secondary-action attachment-write" onClick={() => setRightsOpen(true)} disabled={!props.knowledgeBase || props.attachmentBusy || props.previewBusy || props.acceptanceBusy}>{t('写入知识', 'Write Knowledge')}</button>}<button type="button" className="text-action attachment-clear" aria-label={t('移除附件', 'Remove attachment')} onClick={props.clearAttachment} disabled={props.attachmentBusy || props.acceptanceBusy}>{t('移除', 'Remove')}</button></div> : null}
    {props.uploadStatus ? <p className="upload-status" role="status">{props.uploadStatus}</p> : null}
    {props.attachment && !props.knowledgeBase ? <p className="muted">{t('挂载知识库以准备受治理的 Schema 0.4 预览。', 'Mount a Knowledge Base to prepare a governed Schema 0.4 preview.')}</p> : null}
    {rightsOpen && props.attachment && !props.preview ? <form className="v04-rights-form" aria-label={t('来源与权利信息', 'Source and rights details')} onSubmit={(event) => { event.preventDefault(); props.startPreview() }}>
      <div className="section-title"><div><span className="eyebrow">{t('V0.4 知识生产', 'V0.4 KNOWLEDGE PRODUCTION')}</span><h3>{t('来源与权利', 'Source and rights')}</h3></div><button type="button" className="text-action" onClick={() => setRightsOpen(false)}>{t('关闭', 'Close')}</button></div>
      <p className="muted">{t('请由你提供权利信息。上传文件本身不代表已获授权。未勾选的权限将视为不允许。', 'Rights must be supplied by you. An uploaded file does not establish permission. Unchecked permissions remain denied.')}</p>
      <label className="v04-field">{t('来源标题', 'Source title')}<input required maxLength={512} value={props.sourceForm.title} onChange={(event) => props.setSourceForm({ ...props.sourceForm, title: event.target.value })} /></label>
      <div className="v04-field-grid">
        <label className="v04-field">{t('来源类型', 'Source type')}<select value={props.sourceForm.sourceType} onChange={(event) => props.setSourceForm({ ...props.sourceForm, sourceType: event.target.value })}>{['unknown', 'official_disclosure', 'company_official', 'sell_side_research', 'industry_database', 'professional_media', 'general_media', 'community'].map((item) => <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>)}</select></label>
        <label className="v04-field">{t('可靠性', 'Reliability')}<select value={props.sourceForm.sourceReliability} onChange={(event) => props.setSourceForm({ ...props.sourceForm, sourceReliability: event.target.value })}>{['unknown', 'high', 'medium', 'low'].map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      </div>
      <label className="v04-field">{t('发布方', 'Publisher')}<input maxLength={512} value={props.sourceForm.publisher} onChange={(event) => props.setSourceForm({ ...props.sourceForm, publisher: event.target.value })} /></label>
      <label className="v04-field">{t('机构', 'Institution')}<input maxLength={512} value={props.sourceForm.institution} onChange={(event) => props.setSourceForm({ ...props.sourceForm, institution: event.target.value })} /></label>
      <label className="v04-field">{t('作者', 'Author')}<input maxLength={512} value={props.sourceForm.author} onChange={(event) => props.setSourceForm({ ...props.sourceForm, author: event.target.value })} /></label>
      <label className="v04-field">{t('发布日期', 'Publication date')}<input type="datetime-local" value={props.sourceForm.publishedAt} onChange={(event) => props.setSourceForm({ ...props.sourceForm, publishedAt: event.target.value })} /></label>
      <label className="v04-field">{t('规范来源 URL', 'Canonical source URL')}<input type="url" maxLength={2048} value={props.sourceForm.canonicalUrl} onChange={(event) => props.setSourceForm({ ...props.sourceForm, canonicalUrl: event.target.value })} /></label>
      <label className="v04-field">{t('访问范围', 'Access scope')}<select value={props.rightsForm.accessScope} onChange={(event) => props.setRightsForm({ ...props.rightsForm, accessScope: event.target.value as V04RightsForm['accessScope'] })}>{['unknown', 'public', 'authenticated', 'restricted'].map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <fieldset className="rights-checks"><legend>{t('确认权限', 'Confirm permissions')}</legend>{rightsChecks.map(([key, label]) => <label key={key}><input type="checkbox" checked={props.rightsForm[key]} onChange={(event) => props.setRightsForm({ ...props.rightsForm, [key]: event.target.checked })} />{label}</label>)}</fieldset>
      <label className="v04-field">{t('政策依据', 'Policy basis')} <span>({t('必填', 'required')})</span><textarea required maxLength={512} rows={2} value={props.rightsForm.policyBasis} onChange={(event) => props.setRightsForm({ ...props.rightsForm, policyBasis: event.target.value })} placeholder={t('说明此权限的来源或适用政策', 'Describe the source of this permission or the applicable policy')} /></label>
      <div className="v04-field-grid"><label className="v04-field">{t('权利到期时间', 'Rights expire')}<input type="datetime-local" value={props.rightsForm.expiresAt} onChange={(event) => props.setRightsForm({ ...props.rightsForm, expiresAt: event.target.value })} /></label><label className="v04-field">{t('授权凭据引用', 'Entitlement reference')}<input maxLength={512} value={props.rightsForm.entitlementRef} onChange={(event) => props.setRightsForm({ ...props.rightsForm, entitlementRef: event.target.value })} /></label></div>
      <button className="primary-action" type="submit" disabled={props.previewBusy || props.attachmentBusy || props.acceptanceBusy || !props.knowledgeBase}>{props.previewBusy ? t('正在准备预览…', 'Preparing preview…') : t('提取候选项以供审核', 'Extract candidates for review')}</button>
    </form> : null}
    {props.preview ? <section className="v04-preview" aria-label={t('知识候选项', 'Knowledge candidates')}>
      <div className="section-title"><div><span className="eyebrow">{t('受治理的预览', 'GOVERNED PREVIEW')}</span><h3>{t('知识候选项', 'Knowledge candidates')}</h3></div><span className={`preview-status ${props.preview.status}`}>{props.preview.status === 'preview_ready' ? t('提取完整', 'complete extraction') : props.preview.status === 'preview_partial' ? t('部分提取', 'partial extraction') : props.preview.status.replaceAll('_', ' ')}</span></div>
      {props.preview.status === 'incompatible_schema' || props.knowledgeBase?.schemaVersion !== '0.4' ? <div className="notice incompatibility-notice"><strong>{t('需要 Schema 0.4', 'Schema 0.4 required')}</strong><p>{t('此知识库使用 Schema', 'This Knowledge Base uses Schema')} {props.knowledgeBase?.schemaVersion ?? 'unknown'}{t('。上传来源仍处于暂存状态；未迁移，也未作为 Schema 0.4 知识写入。', ' The uploaded source remains staged; it was not migrated or written as Schema 0.4 Knowledge.')}</p></div> : null}
      {props.preview.status === 'preview_partial' ? <div className="notice partial-notice"><strong>{t('提取不完整，部分知识可能缺失', 'Partial extraction; some knowledge may be missing')}</strong><p>{t('请考虑此限制后再审核候选项。系统不会推断提取是否完整。', 'Review the available candidates with that limit in mind. Extraction completeness is not inferred.')}</p></div> : null}
      {props.preview.status === 'stale_revision' ? <div className="notice incompatibility-notice"><strong>{t('预览已过期', 'Preview is stale')}</strong><p>{t('准备预览后知识库已有变化。接受候选项前请重新准备预览。', 'The Knowledge Base changed after this preview. Prepare a fresh preview before accepting candidates.')}</p></div> : null}
      {props.preview.errorSummary ? <p className="inline-error" role="alert">{props.preview.errorSummary}</p> : null}
      {props.preview.statusNote ? <div className="notice preview-status-note" role="status"><strong>{t('预览状态更新', 'Preview status update')}</strong><p>{props.preview.statusNote}</p></div> : null}
      {props.preview.extractionCompleteness ? <p className="muted">{t('已验证的提取完整度：', 'Verified extraction completeness: ')}{props.preview.extractionCompleteness}</p> : null}
      {props.preview.incompleteUnits?.length ? <details className="incomplete-units"><summary>{props.preview.incompleteUnits.length} {t('个提取单元失败或已取消', 'extraction unit(s) failed or were cancelled')}</summary>{props.preview.incompleteUnits.map((unit) => <div key={unit.unitId}><strong>{unit.proposedUnitId}</strong><small>{unit.status} · {unit.errorSummary}</small></div>)}</details> : null}
      <p className="muted">{props.preview.sourceRef ? `Source ${props.preview.sourceRef}` : ''}{props.preview.rawRef ? ` · Raw ${props.preview.rawRef}` : ''}{props.preview.documentId ? ` · Document ${props.preview.documentId}` : ''}</p>
      {groupKinds.map((kind) => { const items = groups.filter((item) => item.kind === kind); return items.length ? <section className="candidate-group" key={kind} aria-label={`${kind} candidates`}><h4>{kind === 'entity' ? t('实体', 'Entities') : kind === 'relation' ? t('关系', 'Relations') : t('主张', 'Claims')} <small>{items.length}</small></h4>{items.map((item) => <label className="candidate-item" key={item.candidateId}><input type="checkbox" aria-label={`${t('选择', 'Select')} ${kind} ${t('候选项', 'candidate')}`} checked={props.selectedCandidates.has(item.candidateId)} onChange={() => props.toggleCandidate(item.candidateId)} /><span><strong>{item.candidateId}</strong><small>{safeStructured(item.candidate)}</small><small>{item.provenanceRefs.evidenceBlockRefs.length} {t('条证据区块 · ', 'evidence block(s) · ')}{item.provenanceRefs.sourceRef}</small></span></label>)}</section> : null })}
      {groups.length === 0 ? <p className="muted">{t('没有生成可提交的候选组。', 'No committable candidate groups were produced.')}</p> : null}
      {props.acceptance ? <div className={`acceptance-result ${['committed', 'already_committed', 'no_changes'].includes(props.acceptance.status) ? 'success' : 'failure'}`} role="status"><strong>{props.acceptance.status.replaceAll('_', ' ')}</strong>{props.acceptance.extractionCompleteness ? <span>{t('提取完整度：', 'Extraction: ')}{props.acceptance.extractionCompleteness}</span> : null}{props.acceptance.errors.map((item) => <small key={`${item.code}-${item.message}`}>{item.code}: {item.message}</small>)}</div> : null}
      {props.preview.committable && groups.length > 0 ? <div className="candidate-accept-actions"><span>{props.selectedCandidates.size} {t('项已选 · 确认前不会写入', 'selected · nothing is written until you confirm')}</span><button className="primary-action" type="button" onClick={props.acceptCandidates} disabled={props.previewBusy || props.selectedCandidates.size === 0}>{props.previewBusy ? t('正在写入…', 'Writing…') : t(`接受已选的 ${props.selectedCandidates.size} 项`, `Accept ${props.selectedCandidates.size} selected`)}</button></div> : null}
    </section> : null}
  </section>
}

function ThemeFrameworkReviewPanel({ client, runId, onChanged, refreshInfo, onRefreshed }: { readonly client: RuntimeClient; readonly runId: string; readonly onChanged: () => void; readonly refreshInfo?: ResearchPageProps['themeFrameworkRefreshInfo']; readonly onRefreshed: (runId: string, info: NonNullable<ResearchPageProps['themeFrameworkRefreshInfo']>) => void }): ReactElement {
  const { t } = useLanguage()
  const [review, setReview] = useState<ThemeFrameworkReviewResponse>()
  const [decisions, setDecisions] = useState<Record<string, ThemeFrameworkDecision>>({})
  const [decisionRationales, setDecisionRationales] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    setReview(undefined)
    setDecisions({})
    setDecisionRationales({})
    setError('')
    const poll = async (): Promise<void> => {
      try {
        const result = await client.getThemeFrameworkRun(runId)
        if (!active) return
        setReview(result)
        setError('')
        if (result.status !== 'running') onChanged()
        const proposal = result.candidate
        if (result.status === 'awaiting_review' && proposal) {
          setDecisions((current) => {
            if (Object.keys(current).length) return current
            const defaults: Record<string, ThemeFrameworkDecision> = {}
            for (const item of [...proposal.framework.industryCandidates, ...proposal.framework.relationCandidates]) defaults[item.candidateId] = item.recommendation
            return defaults
          })
        }
        if (result.status === 'running') timer = setTimeout(() => void poll(), 900)
      } catch (caught) {
        if (!active) return
        setError(errorText(caught))
      }
    }
    void poll()
    return () => { active = false; if (timer) clearTimeout(timer) }
  }, [client, runId])

  const accept = async (): Promise<void> => {
    const items = [...(review?.candidate?.framework.industryCandidates ?? []), ...(review?.candidate?.framework.relationCandidates ?? [])]
    const overridden = items.filter((item) => (decisions[item.candidateId] ?? item.recommendation) !== item.recommendation)
    const missingRationale = overridden.some((item) => !decisionRationales[item.candidateId]?.trim())
    if (missingRationale) { setError('Add a reason for every decision that differs from the recommendation before accepting. Your entered reasons will be kept.'); return }
    const rationales = Object.fromEntries(overridden.map((item) => [item.candidateId, decisionRationales[item.candidateId]!.trim()]))
    setBusy(true); setError('')
    try { await client.acceptThemeFrameworkRun(runId, decisions, rationales); const refreshed = await client.getThemeFrameworkRun(runId); setReview(refreshed); onChanged() }
    catch (caught) { setError(errorText(caught)) }
    finally { setBusy(false) }
  }
  const reject = async (): Promise<void> => {
    setBusy(true); setError('')
    try { await client.rejectThemeFrameworkRun(runId); const refreshed = await client.getThemeFrameworkRun(runId); setReview(refreshed); onChanged() }
    catch (caught) { setError(errorText(caught)) }
    finally { setBusy(false) }
  }
  const refresh = async (): Promise<void> => {
    setBusy(true); setError('')
    try {
      const result: ThemeFrameworkRefreshResult = await client.refreshThemeFrameworkRun(runId)
      if (result.status === 'conflict' || result.status === 'blocked') { setError(result.diagnostics?.join(' ') || (result.status === 'conflict' ? 'The Knowledge Base changed during refresh. Reload this review and try again.' : 'This review cannot be safely refreshed.')); return }
      const refreshed = await client.getThemeFrameworkRun(result.workflowRunId)
      if (refreshed.status !== 'awaiting_review' || !refreshed.candidate) { setError('The refreshed run is not available for review yet.'); return }
      onRefreshed(result.workflowRunId, { fromRunId: result.refreshedFromRunId, fromRevision: review?.candidate?.basedOnRevision ?? refreshed.candidate.basedOnRevision, toRevision: result.basedOnRevision ?? refreshed.candidate.basedOnRevision })
      onChanged()
    } catch (caught) { setError(errorText(caught)) }
    finally { setBusy(false) }
  }
  const candidate = review?.candidate
  const refreshDisplay = candidate?.refresh
    ? { fromRunId: candidate.refresh.refreshedFromRunId, fromRevision: candidate.refresh.sourceBasedOnRevision, toRevision: candidate.refresh.targetRevision }
    : refreshInfo
  const terminalCopy: Readonly<Record<string, string>> = { stale: t('研究期间知识库发生变化。请重新开始审核，以使用当前主题和证据。', 'Knowledge changed during research. Restart the review to use the current Theme and evidence.'), blocked: t('无法安全完成框架。重试前请检查报告的缺口。', 'The framework could not be safely completed. Review the reported gaps before retrying.'), failed: t('框架研究未能生成可审核的候选项。', 'Framework research failed before it produced a reviewable candidate.'), rejected: t('此框架提案已被拒绝。', 'This framework proposal was rejected.'), committed: t('主题框架已接受并保存。', 'Theme framework accepted and saved.') }
  const evidenceFor = (refs: readonly string[]) => refs.map((ref) => candidate?.evidence.find((evidence) => evidence.evidenceId === ref)).filter((value): value is NonNullable<typeof value> => Boolean(value))
  const setDecision = (candidateId: string, decision: ThemeFrameworkDecision): void => setDecisions((current) => ({ ...current, [candidateId]: decision }))
  const setDecisionRationale = (candidateId: string, rationale: string): void => setDecisionRationales((current) => ({ ...current, [candidateId]: rationale }))
  const itemCard = (item: ThemeFrameworkReviewCandidate['framework']['industryCandidates'][number] | ThemeFrameworkReviewCandidate['framework']['relationCandidates'][number]) => {
    const relation = 'sourceIndustryRef' in item
    const evidence = evidenceFor(item.evidenceRefs)
    const decision = decisions[item.candidateId] ?? item.recommendation
    const itemName = relation ? `${item.sourceIndustryRef} → ${item.targetIndustryRef}` : item.name
    return <article className="theme-framework-candidate" key={item.candidateId}>
      <header><div><span className="eyebrow">{relation ? (item.topologyRole === 'cross_chain' ? t('跨链连接', 'CROSS CONNECTION') : t('行业连接', 'INDUSTRY LINK')) : t('行业', 'INDUSTRY')}</span><h4>{relation ? `${item.sourceIndustryRef} → ${item.targetIndustryRef}` : item.name}</h4></div><span className={`theme-decision-pill ${decisions[item.candidateId] ?? item.recommendation}`}>{decisions[item.candidateId] ?? item.recommendation}</span></header>
      {!relation && item.description ? <p>{item.description}</p> : null}
      {relation ? <p className="muted">{t('关系：', 'Relation:')} {item.relationType}</p> : null}
      <p><strong>{t('边界：', 'Boundary:')}</strong> {item.boundaryRationale}</p>
      <p><strong>{t('主题契合度：', 'Theme fit:')}</strong> {item.relevanceRationale}</p>
      {relation && item.directionRationale ? <p><strong>{t('方向：', 'Direction:')}</strong> {item.directionRationale}</p> : null}
      {item.coverageGaps.length ? <div className="theme-framework-gaps"><strong>{t('覆盖缺口', 'Coverage gaps')}</strong><ul>{item.coverageGaps.map((gap, index) => <li key={`${item.candidateId}-gap-${index}`}>{gap}</li>)}</ul></div> : null}
      <div className="theme-framework-evidence"><strong>{t('证据', 'Evidence')}</strong>{evidence.length ? evidence.map((source) => <p key={source.evidenceId}>{source.summary}<small>{source.sourceRef}</small></p>) : <p className="muted">{t('此候选项没有保留的来源摘要。', 'No retained source summary for this candidate.')}</p>}</div>
      <div className="theme-decision-controls" aria-label={`${t('决策', 'Decision')} ${relation ? t('关系', 'relation') : item.name}`}>
        {(['include', 'exclude', 'pending'] as const).map((value) => <button type="button" key={value} className={decision === value ? 'selected' : ''} onClick={() => setDecision(item.candidateId, value)} disabled={review?.status !== 'awaiting_review' || busy}>{value === 'include' ? t('纳入', 'Include') : value === 'exclude' ? t('排除', 'Exclude') : t('待处理', 'Pending')}</button>)}
      </div>
      {decision !== item.recommendation ? <label className="theme-framework-rationale-field"><span>{t('更改建议的原因 · 必填 · 最多 4000 个字符', 'Reason for changing the recommendation · required · up to 4000 characters')}</span><textarea aria-label={`${t('更改建议的原因', 'Reason for changing recommendation for')} ${itemName}`} rows={2} maxLength={4000} value={decisionRationales[item.candidateId] ?? ''} onChange={(event) => setDecisionRationale(item.candidateId, event.target.value)} disabled={review?.status !== 'awaiting_review' || busy} /></label> : null}
    </article>
  }
  return <section className="theme-framework-review" aria-label={t('主题框架审核', 'Theme framework review')}>
    <div className="section-title"><div><span className="eyebrow">{t('主题初始化', 'THEME INITIALIZATION')}</span><h2>{t('行业框架', 'Industry framework')}</h2></div>{review ? <span className={`rail-badge theme-status-${review.status}`}>{review.status.replaceAll('_', ' ')}</span> : null}</div>
    {error ? <p role="alert" className="inline-error">{error}</p> : null}
    {!review || review.status === 'running' ? <p className="muted" role="status">{t('正在研究范围明确的行业分支和证据…', 'Researching bounded industry branches and evidence…')}</p> : null}
    {review?.status === 'awaiting_review' && candidate ? <>
      {refreshDisplay ? <div className="notice theme-framework-refresh-note" role="status"><strong>{t('已刷新候选项', 'Refreshed candidate')}</strong><p>From run {refreshDisplay.fromRunId} · Knowledge revision {refreshDisplay.fromRevision} → {refreshDisplay.toRevision}.</p><p>{t('此候选项保留了之前的提案，不包含修订', 'This candidate preserves the prior proposal and does not include sources added after revision')} {refreshDisplay.fromRevision}{t('之后添加的来源。接受前请审核每个条目和决策。', ' Review every item and decision before accepting.')}</p></div> : null}
      <div className="theme-framework-summary"><h3>{candidate.theme.name}</h3><p>{candidate.framework.proposedDefinition.statement}</p><small>Based on Knowledge revision {candidate.basedOnRevision} · acquisition: {candidate.acquisitionStatus}</small>{candidate.acquisitionStatus !== 'complete' ? <p className="theme-framework-limited">{t('部分来源不可用或研究范围被截断；接受前请评估这些缺口。', 'Some sources were unavailable or the research scope was truncated; assess the gaps before accepting.')}</p> : null}</div>
      {candidate.framework.inclusionPrinciples.length ? <div className="theme-framework-branch"><h3>{t('纳入条件', 'Include when')}</h3><ul>{candidate.framework.inclusionPrinciples.map((value, index) => <li key={`include-${index}`}>{value}</li>)}</ul></div> : null}
      {candidate.framework.exclusionPrinciples.length ? <div className="theme-framework-branch"><h3>{t('排除条件', 'Exclude when')}</h3><ul>{candidate.framework.exclusionPrinciples.map((value, index) => <li key={`exclude-${index}`}>{value}</li>)}</ul></div> : null}
      <div className="theme-framework-branch"><h3>{t('行业候选项 ·', 'Industry candidates ·')} {candidate.framework.industryCandidates.length}</h3>{candidate.framework.industryCandidates.map(itemCard)}</div>
      <div className="theme-framework-branch"><h3>{t('行业连接 ·', 'Industry connections ·')} {candidate.framework.relationCandidates.length}</h3>{candidate.framework.relationCandidates.length ? candidate.framework.relationCandidates.map(itemCard) : <p className="muted">{t('没有提出有依据的关系。', 'No supported relations were proposed.')}</p>}</div>
      {candidate.framework.coverageGaps.length ? <div className="theme-framework-branch"><h3>{t('未解决的覆盖问题', 'Unresolved coverage questions')}</h3>{candidate.framework.coverageGaps.map((gap) => <article key={gap.gapId} className="theme-framework-gap"><strong>{gap.question}</strong><p>{gap.reason}</p></article>)}</div> : null}
      <div className="theme-framework-actions"><p className="theme-framework-write-note">{t('接受这些决策后，将把主题框架写入知识库。', 'Accepting these decisions will write the Theme framework to the Knowledge Base.')}</p><button type="button" className="primary-action" onClick={() => void accept()} disabled={busy}>{busy ? t('正在保存…', 'Saving…') : t('接受框架决策', 'Accept framework decisions')}</button><button type="button" className="danger-action" onClick={() => void reject()} disabled={busy}>{t('拒绝框架', 'Reject framework')}</button></div>
    </> : null}
    {review && ['stale', 'blocked', 'failed', 'rejected', 'committed'].includes(review.status) ? <div className={`notice theme-framework-terminal theme-status-${review.status}`} role="status"><strong>{review.status.replaceAll('_', ' ')}</strong><p>{terminalCopy[review.status] ?? t('此运行已无法继续处理。', 'This run is no longer actionable.')}</p>{review.receipt ? <small>{review.receipt.themeRef} · Knowledge revision {review.receipt.committedRevision} · {review.receipt.decisionCount} decisions</small> : null}{review.status === 'stale' ? <button type="button" className="primary-action" onClick={() => void refresh()} disabled={busy}>{busy ? t('正在刷新…', 'Refreshing…') : t('刷新到当前修订', 'Refresh to current revision')}</button> : null}</div> : null}
  </section>
}

function ThemeFrameworkReviewInbox({ props }: { readonly props: Pick<ResearchPageProps, 'client' | 'knowledgeBase' | 'themeFrameworkRunId' | 'setThemeFrameworkRunId' | 'themeFrameworkRefreshInfo' | 'setThemeFrameworkRefreshInfo' | 'themeFrameworkReviewRevision' | 'refreshThemeFrameworkReviews'> }): ReactElement | null {
  const { t } = useLanguage()
  const [items, setItems] = useState<readonly ThemeFrameworkReviewSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const knowledgeBaseId = props.knowledgeBase?.knowledgeBaseId
  const load = useCallback(async (): Promise<void> => {
    if (!knowledgeBaseId) { setItems([]); return }
    setLoading(true)
    try { const result = await props.client.listThemeFrameworkReviews(50); setItems(result.items); setError('') }
    catch (caught) { setError(errorText(caught)) }
    finally { setLoading(false) }
  }, [knowledgeBaseId, props.client])
  useEffect(() => { void load() }, [load, props.themeFrameworkRunId, props.themeFrameworkReviewRevision])
  if (!knowledgeBaseId) return null
  const awaiting = items.filter((item) => item.status === 'awaiting_review')
  return <section className="theme-framework-review-inbox" aria-label={t('主题框架审核历史', 'Theme Framework review history')}>
    <div className="section-title"><div><span className="eyebrow">{t('主题初始化', 'THEME INITIALIZATION')}</span><h2>{t('可恢复的框架审核', 'Resumable framework reviews')}</h2></div><span className="rail-badge">{awaiting.length} {t('项待审核', 'awaiting')}</span></div>
    {error ? <div className="notice" role="alert"><strong>{t('审核列表不可用', 'Review list unavailable')}</strong><p>{error}</p><button type="button" className="secondary-action" onClick={() => void load()} disabled={loading}>{t('重试', 'Retry')}</button></div> : null}
    {loading && items.length === 0 ? <p className="muted" role="status">{t('正在加载已保存的主题审核…', 'Loading saved Theme reviews…')}</p> : null}
    {!loading && items.length === 0 && !error ? <p className="muted">{t('没有已保存的主题框架审核。', 'No saved Theme Framework reviews.')}</p> : null}
    {items.map((item) => <div className="theme-framework-resume-item" key={item.runId}><div><strong>{item.themeName}</strong><small>Run …{item.runId.slice(-11)} · {t('知识库修订', 'Knowledge revision')} {item.basedOnRevision} · {item.status.replaceAll('_', ' ')}</small></div>{item.status === 'awaiting_review' ? <button type="button" className="secondary-action" onClick={() => { props.setThemeFrameworkRefreshInfo(undefined); props.setThemeFrameworkRunId(item.runId) }}>{props.themeFrameworkRunId === item.runId ? t('审核已打开', 'Review open') : t('恢复审核', 'Resume review')}</button> : <span className={`rail-badge theme-status-${item.status}`}>{item.status}</span>}</div>)}
  </section>
}

function ThemeScopeImpactInbox({ props }: { readonly props: Pick<ResearchPageProps, 'client' | 'knowledgeBase' | 'acceptance' | 'workflowRunId' | 'workflow'> }): ReactElement | null {
  const { t } = useLanguage()
  const [records, setRecords] = useState<readonly ThemeScopeImpactInboxRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')
  const [rationales, setRationales] = useState<Readonly<Record<string, string>>>({})
  const [decisionDrafts, setDecisionDrafts] = useState<Readonly<Record<string, 'include' | 'exclude' | 'pending'>>>({})
  const knowledgeBaseId = props.knowledgeBase?.knowledgeBaseId
  const revision = props.acceptance?.knowledgeBaseRevision
  const workflowRunId = props.workflowRunId
  const workflowStatus = props.workflow?.status
  const load = useCallback(async (): Promise<void> => {
    if (!knowledgeBaseId) { setRecords([]); return }
    setLoading(true)
    try { const result = await props.client.listThemeScopeImpactInbox(50); setRecords(result.items); setError('') }
    catch (caught) { setError(errorText(caught)) }
    finally { setLoading(false) }
  }, [knowledgeBaseId, props.client])
  useEffect(() => { void load() }, [load, workflowRunId, workflowStatus, revision])
  if (!knowledgeBaseId) return null

  const updateProposal = (receiptKey: string, proposal: ThemeScopeImpactProposal): void => {
    setRecords((current) => current.map((record) => record.receiptKey !== receiptKey ? record : { ...record, proposals: record.proposals.map((item) => item.proposalId === proposal.proposalId ? proposal : item) }))
  }
  const dismissProposal = async (record: ThemeScopeImpactInboxRecord, proposal: ThemeScopeImpactProposal): Promise<void> => {
    const actionId = `${record.receiptKey}:${proposal.proposalId}`
    setBusyId(actionId); setError('')
    try {
      const workflowRunId = `scope-impact-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      const updated = await props.client.dismissThemeScopeImpact({ receiptKey: record.receiptKey, proposalId: proposal.proposalId, workflowRunId })
      updateProposal(record.receiptKey, updated)
      await load()
    } catch (caught) {
      setError(errorText(caught))
      // A revision conflict can make the current record stale; re-read the persisted inbox state.
      await load()
    } finally { setBusyId('') }
  }
  const saveRecordDecisions = async (record: ThemeScopeImpactInboxRecord): Promise<void> => {
    const pending = record.proposals.filter((proposal) => proposal.status === 'pending')
    if (!pending.length) return
    setBusyId(record.receiptKey); setError('')
    try {
      const workflowRunId = `scope-impact-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      await props.client.decideThemeScopeImpactBatch({ receiptKey: record.receiptKey, workflowRunId, decisions: pending.map((proposal) => {
        const actionId = `${record.receiptKey}:${proposal.proposalId}`
        return { proposalId: proposal.proposalId, decision: decisionDrafts[actionId] ?? 'pending', ...(rationales[actionId]?.trim() ? { rationale: rationales[actionId]!.trim() } : {}) }
      }) })
      await load()
    } catch (caught) {
      setError(errorText(caught))
      await load()
    } finally { setBusyId('') }
  }
  const pendingCount = records.reduce((total, record) => total + record.proposals.filter((proposal) => proposal.status === 'pending').length, 0)
  const label = (proposal: ThemeScopeImpactProposal): string => proposal.candidate.kind === 'industry'
    ? `${proposal.candidate.name}${proposal.candidate.identityContext ? ` · ${proposal.candidate.identityContext}` : ''}`
    : `${proposal.candidate.relationType.replaceAll('_', ' ')} · ${proposal.candidate.sourceFingerprint.slice(0, 16)} → ${proposal.candidate.targetFingerprint.slice(0, 16)}`
  const statusText = (proposal: ThemeScopeImpactProposal): string => proposal.status === 'accepted'
    ? `${t('决策已保存', 'Decision saved')}${proposal.decision ? ` · ${proposal.decision}` : ''}`
    : proposal.status === 'rejected' ? t('已忽略', 'Dismissed') : t('需要决策', 'Needs decision')
  return <section className="theme-scope-impact-inbox" aria-label={t('主题范围影响提案', 'Theme scope impact proposals')}>
    <div className="section-title"><div><span className="eyebrow">{t('知识治理', 'KNOWLEDGE GOVERNANCE')}</span><h2>{t('主题范围变更', 'Theme scope changes')}</h2></div><span className="rail-badge">{pendingCount} {t('项待处理', 'pending')}</span></div>
    <p className="theme-scope-impact-intro">{t('规范研究写入可能影响主题的行业节点或连接。请审核下方范围明确的变更及证据。', 'Canonical research writes may affect a Theme’s industry nodes or connections. Review the bounded changes and evidence below.')}</p>
    {error ? <div className="notice theme-scope-impact-error" role="alert"><strong>{t('无法刷新范围收件箱', 'Scope inbox could not be refreshed')}</strong><p>{error}</p><button className="secondary-action" type="button" onClick={() => void load()} disabled={loading}>{t('重试', 'Retry')}</button></div> : null}
    {loading && records.length === 0 ? <p className="muted" role="status">{t('正在加载范围提案…', 'Loading scope proposals…')}</p> : null}
    {!loading && records.length === 0 && !error ? <div className="notice"><strong>{t('没有主题范围变更', 'No Theme scope changes')}</strong><p>{t('相关工作流完成规范写入后，新提案会显示在这里。', 'New proposals will appear here after a relevant Workflow completes a canonical write.')}</p></div> : null}
    {records.map((record) => { const pendingProposals = record.proposals.filter((proposal) => proposal.status === 'pending'); return <div className={`theme-scope-impact-record ${record.status === 'stale' ? 'stale' : ''}`} key={record.receiptKey}>
      <header><div><strong>{t('知识库修订', 'Knowledge revision')} {record.committedRevision}</strong><small>{t('基础修订', 'Base revision')} {record.baseRevision} · {record.proposals.length} {t('个提案', 'proposals')}{record.proposals.length === 1 ? '' : 's'}</small></div><span className={`scope-impact-status ${record.status}`}>{record.status === 'stale' ? t('已过期', 'Stale') : record.status === 'no_changes' ? t('无变更', 'No changes') : t('就绪', 'Ready')}</span></header>
      {record.status === 'stale' ? <p className="scope-impact-stale-note">{t('准备这些提案后知识库已有变化。决策前请刷新或重新运行影响检查。', 'Knowledge has changed since these proposals were prepared. Refresh or rerun the impact check before deciding.')}</p> : null}
      {record.diagnostics.map((diagnostic, index) => <p className="scope-impact-diagnostic" key={`${record.receiptKey}-diagnostic-${index}`}>{diagnostic}</p>)}
      {record.proposals.length === 0 ? <p className="muted">{t('没有提出新的主题范围决策。', 'No new Theme scope decisions were proposed.')}</p> : record.proposals.map((proposal) => {
        const actionId = `${record.receiptKey}:${proposal.proposalId}`
        const actionable = proposal.status === 'pending' && record.status !== 'stale'
        const canonicalRefs = [...new Set([...proposal.changedRefs, ...(proposal.candidate.canonicalRef ? [proposal.candidate.canonicalRef] : [])])]
        return <article className="theme-scope-impact-proposal" key={proposal.proposalId}>
          <header><div><span className="eyebrow">{proposal.changeKind.replaceAll('_', ' ')}</span><h3>{label(proposal)}</h3><small>{t('主题', 'Theme')} {proposal.themeRef}</small></div><span className={`scope-impact-status proposal-${proposal.status}`}>{statusText(proposal)}</span></header>
          <p className="scope-impact-rationale">{proposal.rationale}</p>
          <div className="scope-impact-counts"><span><b>{canonicalRefs.length}</b> {t('条规范引用已变更', 'changed canonical refs')}</span><span><b>{proposal.evidenceRefs.length}</b> {t('条证据引用', 'evidence refs')}</span><span>{t('修订', 'Revision')} {proposal.basedOnRevision}</span></div>
          {canonicalRefs.length ? <details className="scope-impact-refs"><summary>{t('规范引用', 'Canonical references')}</summary><ul>{canonicalRefs.slice(0, 24).map((ref) => <li key={ref}>{ref}</li>)}</ul>{canonicalRefs.length > 24 ? <small>{canonicalRefs.length - 24} {t('条其他引用', 'additional refs')}</small> : null}</details> : null}
          {proposal.evidenceRefs.length ? <details className="scope-impact-refs"><summary>{t('证据引用', 'Evidence references')} ({proposal.evidenceRefs.length})</summary><ul>{proposal.evidenceRefs.slice(0, 16).map((ref) => <li key={ref}>{ref}</li>)}</ul>{proposal.evidenceRefs.length > 16 ? <small>{proposal.evidenceRefs.length - 16} {t('条其他引用', 'additional refs')}</small> : null}</details> : <p className="scope-impact-no-evidence">{t('没有可用的证据引用；补充证据后才能接受此提案。', 'No evidence refs are available; this proposal cannot be accepted until evidence is supplied.')}</p>}
          {actionable ? <>
            <label className="scope-impact-rationale-field">{t('决策备注', 'Decision note')} <textarea aria-label={`${t('决策备注', 'Decision note')} ${proposal.proposalId}`} value={rationales[actionId] ?? ''} maxLength={2_000} onChange={(event) => setRationales((current) => ({ ...current, [actionId]: event.target.value }))} placeholder={t('可填写审计记录的理由', 'Optional rationale for the audit record')} /></label>
            <div className="scope-impact-actions">
              {(['include', 'exclude', 'pending'] as const).map((decision) => <button type="button" key={decision} className={`${decision === 'include' ? 'primary-action' : 'secondary-action'} ${(decisionDrafts[actionId] ?? 'pending') === decision ? 'selected' : ''}`} onClick={() => setDecisionDrafts((current) => ({ ...current, [actionId]: decision }))} disabled={Boolean(busyId) || (decision === 'include' && proposal.evidenceRefs.length === 0)}>{decision === 'include' ? t('纳入', 'Include') : decision === 'exclude' ? t('排除', 'Exclude') : t('保持待处理', 'Keep pending')}</button>)}
              <button type="button" className="text-action" onClick={() => void dismissProposal(record, proposal)} disabled={Boolean(busyId)}>{t('忽略', 'Dismiss')}</button>
            </div>
          </> : null}
        </article>
      })}
      {pendingProposals.length && record.status !== 'stale' ? <div className="scope-impact-save-row"><button type="button" className="primary-action" onClick={() => void saveRecordDecisions(record)} disabled={Boolean(busyId)}>{busyId === record.receiptKey ? t('正在保存决策…', 'Saving decisions…') : t(`保存 ${pendingProposals.length} 个提案的决策`, `Save decisions for ${pendingProposals.length} proposal${pendingProposals.length === 1 ? '' : 's'}`)}</button><span>{t('本次检查中剩余的提案将一并写入；未更改的提案仍保持待处理。', 'All remaining proposals in this check are written together; unchanged proposals stay pending.')}</span></div> : null}
    </div>})}
    <div className="scope-impact-footer"><button type="button" className="secondary-action" onClick={() => void load()} disabled={loading}>{loading ? t('正在刷新…', 'Refreshing…') : t('刷新提案', 'Refresh proposals')}</button><span>{t('打开聊天以及工作流或知识接受完成后会自动刷新。', 'Refreshes when Chat opens and after Workflow or Knowledge acceptance completes.')}</span></div>
  </section>
}

function ResearchPageBody(props: ResearchPageProps): ReactElement {
  const { t } = useLanguage()
  const noKnowledge = !props.knowledgeBase
  return <main className="workspace-grid"><aside className="conversation-rail" aria-label={t('对话', 'Conversations')}><div className="rail-heading"><div><span className="eyebrow">WORKSPACE</span><h2>{t('对话', 'Conversations')}</h2></div><button className="icon-button" aria-label={t('新建对话', 'New conversation')} onClick={props.newConversation} disabled={props.busy}>＋</button></div><button className="new-conversation" onClick={props.newConversation} disabled={props.busy}>{t('＋ 新建对话', '＋ New conversation')}</button><div className="history-label">{t('历史记录', 'History')}</div><nav className="conversation-list" aria-label={t('对话历史', 'Conversation history')}>{props.conversations.map((conversation) => <button className={`conversation-item ${conversation.isActive ? 'active' : ''}`} key={conversation.conversationId} onClick={() => props.switchConversation(conversation.conversationId)} disabled={props.busy}><span>{conversation.name || t('未命名对话', 'Untitled conversation')}</span><small>{conversation.messageCount} {t('条消息', 'messages')}</small></button>)}</nav></aside><section className="conversation-pane" aria-label={t('对话', 'Conversation')}><div className="conversation-heading"><div><span className="eyebrow">{t('Agent 会话', 'AGENT SESSION')}</span><h1>{props.session?.name || t('研究对话', 'Research conversation')}</h1></div><span className={`session-pill ${props.streaming ? 'live' : ''}`}>{props.streaming ? t('生成中', 'Streaming') : t('空闲', 'Idle')}</span></div><div className="messages" aria-live="polite">{props.messages.length === 0 && !props.streaming ? <div className="empty-conversation"><div className="empty-orbit">✦</div><h2>{t('从一个研究问题开始', 'Start with a research question')}</h2><p>{t('请 Agent 探索研究背景，或协助规划下一步研究。', 'Ask the Agent to explore the research context or help shape your next research step.')}</p></div> : props.messages.map((message, index) => <article className={`message ${message.role}`} key={`${message.timestamp ?? 'message'}-${index}`}><div className="message-meta">{message.role === 'user' ? t('你', 'You') : message.role === 'tool' ? toolLabel(message.toolName) : 'Agent'}{message.timestamp ? <time>{new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time> : null}</div><div className="message-body">{message.role === 'tool' ? <span className="tool-chip">{toolLabel(message.toolName)}</span> : message.content}</div></article>)}{props.streaming ? <article className="message assistant streaming-message"><div className="message-meta">Agent {props.thinking ? <span className="thinking-label">{t('正在思考…', 'Thinking…')}</span> : null}</div><div className="message-body">{props.streamText || (props.thinking ? t('正在思考…', 'Thinking…') : t('正在处理…', 'Working…'))}{props.streamText ? <span className="cursor" /> : null}</div>{props.toolEvents.length > 0 ? <div className="tool-trace">{props.toolEvents.map((item, index) => <span key={`${item}-${index}`}>{item}</span>)}</div> : null}</article> : null}</div>{props.error ? <div className="inline-error" role="alert">{props.error}<button onClick={props.dismissError}>{t('忽略', 'Dismiss')}</button></div> : null}<div className="composer-wrap" onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() }} onDrop={(event) => { if (!event.dataTransfer.files.length) return; event.preventDefault(); props.upload(event.dataTransfer.files[0]) }}><div className="research-composer-content"><div className="research-controls" aria-label={t('研究执行控制', 'Research execution controls')}><label><span>Workflow</span><select aria-label="Workflow" value={props.selectedWorkflowId} onChange={(event) => props.setSelectedWorkflowId(event.target.value)}><option value="">{t('自由研究', 'Free Research')}</option>{props.workflowDefinitions.map((workflow) => <option value={workflow.id} key={workflow.id}>{workflow.label}</option>)}</select></label><label className="check-field"><input type="checkbox" checked={props.contextPolicy.structuredKnowledge} onChange={(event) => props.setContextPolicy({ ...props.contextPolicy, structuredKnowledge: event.target.checked })} />{t('查询知识', 'Query Knowledge')}</label><label className="check-field"><input type="checkbox" checked={props.contextPolicy.sourceLibrary} onChange={(event) => props.setContextPolicy({ ...props.contextPolicy, sourceLibrary: event.target.checked })} />{t('搜索来源资料库', 'Search Source Library')}</label><label className="check-field"><input type="checkbox" checked={props.persistencePolicy.writeKnowledge} onChange={(event) => props.setPersistencePolicy({ writeKnowledge: event.target.checked })} />{t('写入知识', 'Write Knowledge')}</label></div>{props.executionSummary ? <div className="execution-summary" aria-label={t('研究执行摘要', 'Research execution summary')}><strong>{props.executionSummary.mode}{props.executionSummary.workflowLabel ? ` · ${props.executionSummary.workflowLabel}` : ''}</strong><span>{t('知识库：', 'Knowledge: ')}{props.executionSummary.contextPolicy.structuredKnowledge ? t('读取', 'Read') : t('关闭', 'Off')}</span><span>{t('来源资料库：', 'Source Library: ')}{props.executionSummary.contextPolicy.sourceLibrary ? t('搜索', 'Search') : t('关闭', 'Off')}</span><span>{t('知识写入：', 'Knowledge Write: ')}{props.executionSummary.persistencePolicy.writeKnowledge ? t('开启', 'On') : t('关闭', 'Off')}</span>{props.executionSummary.argumentsStatus !== 'not_required' ? <span>{t('参数：', 'Arguments: ')}{props.executionSummary.argumentsStatus}</span> : null}</div> : null}{props.dispatchFeedback ? <DispatchFeedbackPanel feedback={props.dispatchFeedback} /> : null}{props.dispatchResolution ? <DispatchResolutionNotice resolution={props.dispatchResolution} /> : null}<textarea aria-label={t('消息', 'Message')} value={props.composer} onChange={(event) => props.setComposer(event.target.value)} onPaste={(event) => { const file = Array.from(event.clipboardData.files)[0]; if (file) { event.preventDefault(); props.upload(file) } }} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !props.streaming) { event.preventDefault(); props.runCommand('prompt') } }} placeholder={props.streaming ? t('输入指导或后续问题…', 'Write a steering instruction or follow-up…') : t('询问 Agent 任何研究相关问题…', 'Ask the Agent anything about your research…')} rows={3} /><div className="composer-attachment-row"><label className="composer-file-picker" aria-label={t('附加文档', 'Attach a document')}>{props.attachmentBusy ? t('正在添加…', 'Adding…') : t('＋ 附加文件', '＋ Attach file')}<input aria-label={t('添加文档', 'Add document')} type="file" accept=".pdf,.csv,.htm,.html,.json,.md,.text,.txt,.xml" onChange={(event) => { props.upload(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} disabled={props.attachmentBusy || props.acceptanceBusy} /></label><span className="composer-file-hint">{t('PDF、CSV、HTML、JSON、Markdown、文本、XML · 最大 100 MB', 'PDF, CSV, HTML, JSON, Markdown, text, XML · up to 100 MB')}</span></div><KnowledgeUploadSection key={props.attachmentUiVersion} {...props} /><div className="composer-footer"><span>{t('Enter 发送 · Shift+Enter 换行 · 队列：', 'Enter to send · Shift+Enter for newline · queued: ')}{props.queue.steering} {t('条指导 /', ' steer / ')} {props.queue.followUp} {t('条后续问题', ' follow-up')}</span><div className="composer-actions">{props.streaming ? <><button className="secondary-action" onClick={() => props.runCommand('steer')} disabled={props.busy || !props.composer.trim()}>{t('指导', 'Steer')}</button><button className="secondary-action" onClick={() => props.runCommand('follow_up')} disabled={props.busy || !props.composer.trim()}>{t('继续追问', 'Follow up')}</button><button className="stop-action" onClick={props.abort} disabled={props.busy}>{t('停止', 'Stop')}</button></> : <button className="primary-action" onClick={() => props.runCommand('prompt')} disabled={props.busy || !props.composer.trim()}>{t('发送', 'Send')} <span>↗</span></button>}</div></div></div></div></section><aside className="context-rail" aria-label={t('研究背景', 'Research context')}>
  <div className="context-heading"><div><span className="eyebrow">{t('研究背景', 'RESEARCH CONTEXT')}</span><span className="context-count">{props.streaming ? t('生成中', 'Streaming') : t('空闲', 'Idle')}</span></div></div>
  <section className="context-section" aria-label={t('会话状态', 'Session status')}><div className="section-title"><div><span className="eyebrow">{t('会话', 'SESSION')}</span><h2>{props.session?.name || t('研究对话', 'Research conversation')}</h2></div></div><p className="muted">{props.streaming ? t('Agent 正在响应。', 'The Agent is responding.') : t('会话已就绪。', 'Session is ready.')}</p></section>
  <section className="context-section" aria-label={t('消息队列', 'Message queue')}><div className="section-title"><div><span className="eyebrow">{t('队列', 'QUEUE')}</span><h2>{t('待处理消息', 'Pending messages')}</h2></div></div><p>{props.queue.steering} {t('条指导', 'steering')} · {props.queue.followUp} {t('条后续问题', 'follow-up')}</p></section>
  <section className="context-section" aria-label={t('工作流状态', 'Workflow status')}><div className="section-title"><div><span className="eyebrow">{t('生产', 'PRODUCTION')}</span><h2>{t('工作流', 'Workflow')}</h2></div></div>{noKnowledge ? <p className="muted">{t('未挂载知识库。', 'No Knowledge Base mounted.')}</p> : null}{!props.workflowRunId ? <div className="notice"><strong>{t('没有运行中的工作流', 'No active Workflow')}</strong><p>{t('运行状态会在启动工作流后显示在这里。', 'Workflow status appears here after a run starts.')}</p></div> : props.workflow ? <div className="workflow-card"><div className="workflow-status"><span className={`status-dot ${terminalWorkflowStatuses.has(props.workflow.status) ? 'terminal' : ''}`} />{props.workflow.status.replaceAll('_', ' ')}</div><h3>{props.workflow.objective}</h3><dl><dt>{t('阶段', 'Stage')}</dt><dd>{props.workflow.currentStage || t('暂无报告', 'Not reported')}</dd><dt>{t('进度', 'Progress')}</dt><dd>{props.workflow.executionResult?.summary || props.workflow.progressSummary || t('暂无报告', 'Not reported')}</dd></dl>{props.workflowPollNotice ? <p role="status">{props.workflowPollNotice}</p> : null}<WorkflowResultFeedback workflow={props.workflow} verifiedBundleId={props.verifiedWorkflowBundleId} onOpenReport={props.openWorkflowReport} onOpenBundle={props.openWorkflowBundle} onOpenReview={props.openWorkflowReview} />{props.workflow.status === 'completed_with_review' && !props.workflow.executionResult?.reviewRef && (props.workflow.reviewCount ?? 0) > 0 ? <button className="secondary-action full" onClick={() => props.onNavigate('reviews')}>{t('查看审核', 'View Reviews')}</button> : null}{!terminalWorkflowStatuses.has(props.workflow.status) ? <button className="stop-action full" onClick={props.cancelWorkflow} disabled={props.busy}>{t('取消工作流', 'Cancel Workflow')}</button> : null}</div> : <p className="muted">{t('正在加载工作流状态…', 'Loading Workflow status…')}</p>}</section>
  <a className="secondary-action full research-reviews-link" href="/reviews" onClick={(event) => { event.preventDefault(); props.onNavigate('reviews') }}>{t('打开审核', 'Open Reviews')}{props.openReviewCases > 0 ? ` · ${props.openReviewCases}` : ''}</a>
</aside></main>
}

function ResearchPage(props: ResearchPageProps): ReactElement { return <ResearchPageBody {...props} /> }

function AppContent(): ReactElement {
  const { t } = useLanguage()
  const client = useMemo(() => new RuntimeClient(), [])
  const [route, setRoute] = useState<Route>(() => routeForPath(window.location.pathname))
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [loadError, setLoadError] = useState('')
  const [session, setSession] = useState<SessionState>()
  const [conversations, setConversations] = useState<readonly ConversationSummary[]>([])
  const [messages, setMessages] = useState<readonly ConversationMessage[]>([])
  const [knowledgeBase, setKnowledgeBase] = useState<KnowledgeBaseStatus>()
  const [settings, setSettings] = useState<RuntimeSettings>()
  const [settingsError, setSettingsError] = useState('')
  const [settingsBusy, setSettingsBusy] = useState(false)
  const [knowledgeDirectoryVerification, setKnowledgeDirectoryVerification] = useState<{ readonly valid: boolean; readonly message: string }>()
  const [modelLoginFlow, setModelLoginFlow] = useState<RuntimeModelLoginFlow>()
  const [modelTestMessage, setModelTestMessage] = useState('')
  const [openReviewCases, setOpenReviewCases] = useState(0)
  const [streaming, setStreaming] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [thinking, setThinking] = useState(false)
  const [toolEvents, setToolEvents] = useState<readonly string[]>([])
  const [queue, setQueue] = useState({ steering: 0, followUp: 0 })
  const [composer, setComposer] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [attachment, setAttachment] = useState<AttachmentRef>()
  const [attachmentBusy, setAttachmentBusy] = useState(false)
  const [attachmentUiVersion, setAttachmentUiVersion] = useState(0)
  const [preview, setPreview] = useState<RawDocumentPreviewV04>()
  const [previewBusy, setPreviewBusy] = useState(false)
  const [acceptanceBusy, setAcceptanceBusy] = useState(false)
  const [selectedCandidates, setSelectedCandidates] = useState<ReadonlySet<string>>(new Set())
  const [acceptance, setAcceptance] = useState<RawDocumentAcceptanceV04>()
  const [rightsForm, setRightsForm] = useState<V04RightsForm>(defaultRightsForm)
  const [sourceForm, setSourceForm] = useState<V04SourceForm>(defaultSourceForm)
  const [uploadStatus, setUploadStatus] = useState('')
  const [workflowRunId, setWorkflowRunId] = useState('')
  const [themeFrameworkRunId, setThemeFrameworkRunId] = useState('')
  const [themeFrameworkRefreshInfo, setThemeFrameworkRefreshInfo] = useState<ResearchPageProps['themeFrameworkRefreshInfo']>()
  const [themeFrameworkReviewRevision, setThemeFrameworkReviewRevision] = useState(0)
  const [workflow, setWorkflow] = useState<WorkflowRun>()
  const [verifiedWorkflowBundleId, setVerifiedWorkflowBundleId] = useState('')
  const [workflowPollNotice, setWorkflowPollNotice] = useState('')
  const [workflowCanceling, setWorkflowCanceling] = useState(false)
  const [workflowArtifactTarget, setWorkflowArtifactTarget] = useState<WorkflowArtifactTarget>()
  const [reviews, setReviews] = useState<ReviewListResponse>()
  const [reviewDetail, setReviewDetail] = useState<ReviewDetail>()
  const [reviewsBusy, setReviewsBusy] = useState(false)
  const [briefs, setBriefs] = useState<readonly DailyBriefSummary[]>()
  const [selectedBrief, setSelectedBrief] = useState<DailyBriefReport>()
  const [briefsBusy, setBriefsBusy] = useState(false)
  const [reports, setReports] = useState<readonly ResearchReportSummary[]>()
  const [selectedReport, setSelectedReport] = useState<ResearchReport>()
  const [reportsBusy, setReportsBusy] = useState(false)
  const [bundles, setBundles] = useState<readonly ResearchBundleSummary[]>()
  const [selectedBundle, setSelectedBundle] = useState<ResearchBundleDetail>()
  const [bundlesBusy, setBundlesBusy] = useState(false)
  const [sourceHits, setSourceHits] = useState<readonly SourceLibraryHit[]>([])
  const [sourceBusy, setSourceBusy] = useState(false)
  const [workflowDefinitions, setWorkflowDefinitions] = useState<readonly WorkflowDefinition[]>([])
  const [selectedWorkflowId, setSelectedWorkflowId] = useState('')
  const [contextPolicy, setContextPolicy] = useState({ structuredKnowledge: true, sourceLibrary: true })
  const [persistencePolicy, setPersistencePolicy] = useState({ writeKnowledge: false })
  const [executionSummary, setExecutionSummary] = useState<ResearchExecutionSummary>()
  const [dispatchFeedback, setDispatchFeedback] = useState<ResearchDispatchFeedback>()
  const [dispatchResolution, setDispatchResolution] = useState<ResearchDispatchResolution>()
  const latestConversation = useRef('')
  const previewGeneration = useRef(0)
  const workflowRef = useRef<WorkflowRun | undefined>(undefined)
  workflowRef.current = workflow
  const requestEpoch = useRef(0)

  const syncCurrent = useCallback(async (): Promise<void> => {
    const epoch = requestEpoch.current
    const [current, messageResult, list] = await Promise.all([client.currentSession(), client.messages(), client.listConversations()])
    if (epoch !== requestEpoch.current) return
    latestConversation.current = current.conversationId
    setSession(current)
    setMessages(messageResult.messages)
    setConversations(list)
  }, [client])

  const navigate = useCallback((nextRoute: Route): void => { const path = routePath(nextRoute); if (window.location.pathname !== path) window.history.pushState({}, '', path); setRoute(nextRoute) }, [])
  const onResearchLaunched = useCallback((result: ResearchStartResponse): void => { setWorkflowRunId(result.runId); setWorkflow(result.workflow); navigate('research') }, [navigate])

  useEffect(() => { const onPopState = (): void => setRoute(routeForPath(window.location.pathname)); window.addEventListener('popstate', onPopState); return () => window.removeEventListener('popstate', onPopState) }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const bootstrap = await client.bootstrap()
        const [definitions, loadedSettings] = await Promise.all([client.listWorkflowDefinitions(), client.getSettings().catch((caught: unknown) => { if (!cancelled) setSettingsError(errorText(caught)); return undefined })])
        if (cancelled) return
        setSettings(loadedSettings)
        setWorkflowDefinitions(definitions)
        setSession(bootstrap.session); latestConversation.current = bootstrap.session.conversationId; setConversations(bootstrap.conversations); setKnowledgeBase(bootstrap.knowledgeBase); setOpenReviewCases(bootstrap.openReviewCases ?? 0)
        await syncCurrent()
        if (!cancelled) setLoadState('ready')
      } catch (caught) { if (!cancelled) { setLoadError(errorText(caught)); setLoadState('error') } }
    })()
    return () => { cancelled = true; client.clearToken() }
  }, [client, syncCurrent])

  const loadSettings = async (): Promise<void> => {
    setSettingsBusy(true); setSettingsError('')
    try { setSettings(await client.getSettings()) } catch (caught) { setSettingsError(errorText(caught)) }
    finally { setSettingsBusy(false) }
  }

  useEffect(() => {
    if (!modelLoginFlow?.id || ['complete', 'failed', 'cancelled'].includes(modelLoginFlow.state)) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async (): Promise<void> => {
      try {
        const flow = await client.modelLoginStatus(modelLoginFlow.id)
        if (cancelled) return
        setModelLoginFlow(flow)
        if (flow.state === 'complete') { void loadSettings(); return }
        if (flow.state === 'failed' || flow.state === 'cancelled') return
      } catch (caught) {
        if (cancelled) return
        setSettingsError(errorText(caught))
      }
      timer = setTimeout(() => void poll(), 1200)
    }
    timer = setTimeout(() => void poll(), 1200)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [client, modelLoginFlow?.id, modelLoginFlow?.state])

  const clearKnowledgeScopedState = (): void => {
    requestEpoch.current += 1; previewGeneration.current += 1
    latestConversation.current = ''
    setKnowledgeBase(undefined); setOpenReviewCases(0); setSession(undefined); setConversations([]); setMessages([]); setStreaming(false); setThinking(false); setStreamText(''); setToolEvents([]); setQueue({ steering: 0, followUp: 0 }); setComposer('')
    setAttachment(undefined); setAttachmentBusy(false); setAttachmentUiVersion((version) => version + 1); setPreview(undefined); setPreviewBusy(false); setAcceptanceBusy(false); setSelectedCandidates(new Set()); setAcceptance(undefined); setRightsForm(defaultRightsForm); setSourceForm(defaultSourceForm); setUploadStatus('')
    setWorkflowRunId(''); setThemeFrameworkRunId(''); setThemeFrameworkRefreshInfo(undefined); setThemeFrameworkReviewRevision(0); setWorkflow(undefined); setReviews(undefined); setReviewDetail(undefined); setReviewsBusy(false); setBriefs(undefined); setSelectedBrief(undefined); setBriefsBusy(false); setReports(undefined); setSelectedReport(undefined); setReportsBusy(false); setBundles(undefined); setSelectedBundle(undefined); setBundlesBusy(false); setSourceHits([]); setSourceBusy(false); setExecutionSummary(undefined); setError('')
  }

  const refreshAfterSettingsChange = async (nextSettings: RuntimeSettings): Promise<void> => {
    setSettings(nextSettings); setSettingsError(''); clearKnowledgeScopedState(); setLoadState('loading')
    try {
      const bootstrap = await client.bootstrap()
      const [definitions, refreshedSettings] = await Promise.all([client.listWorkflowDefinitions(), client.getSettings()])
      setSettings(refreshedSettings); setWorkflowDefinitions(definitions); setSession(bootstrap.session); latestConversation.current = bootstrap.session.conversationId; setConversations(bootstrap.conversations); setKnowledgeBase(bootstrap.knowledgeBase); setOpenReviewCases(bootstrap.openReviewCases ?? 0)
      await syncCurrent(); setLoadState('ready')
    } catch (caught) { setLoadError(errorText(caught)); setLoadState('error') }
  }

  const changeModel = async (value: string): Promise<void> => {
    if (!settings || settingsBusy || busy || streaming || attachmentBusy || previewBusy || acceptanceBusy || sourceBusy || Boolean(workflowRunId && (!workflow || !terminalWorkflowStatuses.has(workflow.status)))) return
    const slash = value.indexOf('/')
    if (slash < 1) return
    setSettingsBusy(true); setSettingsError('')
    try { await refreshAfterSettingsChange(await client.setModel(value.slice(0, slash), value.slice(slash + 1))) }
    catch (caught) { setSettingsError(errorText(caught)) }
    finally { setSettingsBusy(false) }
  }

  const changeKnowledgeBase = async (knowledgeBaseId: string): Promise<void> => {
    if (!settings || settingsBusy || busy || streaming || attachmentBusy || previewBusy || acceptanceBusy || sourceBusy || Boolean(workflowRunId && (!workflow || !terminalWorkflowStatuses.has(workflow.status)))) return
    setSettingsBusy(true); setSettingsError('')
    try { await refreshAfterSettingsChange(await client.setKnowledgeBase(knowledgeBaseId || undefined)) }
    catch (caught) { setSettingsError(errorText(caught)) }
    finally { setSettingsBusy(false) }
  }

  useEffect(() => {
    if (loadState !== 'ready' || route !== 'reviews' || !knowledgeBase) { setReviews(undefined); setReviewDetail(undefined); return }
    const epoch = requestEpoch.current
    setReviewsBusy(true)
    void client.listReviews().then((items) => { if (epoch === requestEpoch.current) setReviews(items) }).catch((caught) => { if (epoch === requestEpoch.current) setError(errorText(caught)) }).finally(() => { if (epoch === requestEpoch.current) setReviewsBusy(false) })
  }, [client, knowledgeBase, loadState, route])

  useEffect(() => {
    if (loadState !== 'ready' || route !== 'bundles') { setBundles(undefined); setSelectedBundle(undefined); setSourceHits([]); return }
    const epoch = requestEpoch.current
    setBundlesBusy(true); setError('')
    void client.listResearchBundles(20).then((items) => { if (epoch === requestEpoch.current) { setBundles(items); setSelectedBundle(undefined) } }).catch((caught) => { if (epoch === requestEpoch.current) setError(errorText(caught)) }).finally(() => { if (epoch === requestEpoch.current) setBundlesBusy(false) })
  }, [client, loadState, route])

  useEffect(() => {
    if (loadState !== 'ready' || route !== 'briefs') { setBriefs(undefined); setSelectedBrief(undefined); return }
    const epoch = requestEpoch.current
    setBriefsBusy(true); setError('')
    void client.listDailyBriefs(20).then((items) => { if (epoch === requestEpoch.current) { setBriefs(items); setSelectedBrief(undefined) } }).catch((caught) => { if (epoch === requestEpoch.current) setError(errorText(caught)) }).finally(() => { if (epoch === requestEpoch.current) setBriefsBusy(false) })
  }, [client, loadState, route])

  useEffect(() => {
    if (loadState !== 'ready' || route !== 'reports') { setReports(undefined); setSelectedReport(undefined); return }
    const epoch = requestEpoch.current
    setReportsBusy(true); setError('')
    void client.listResearchReports(20).then((items) => { if (epoch === requestEpoch.current) setReports(items) }).catch((caught) => { if (epoch === requestEpoch.current) setError(errorText(caught)) }).finally(() => { if (epoch === requestEpoch.current) setReportsBusy(false) })
  }, [client, loadState, route])

  useEffect(() => {
    const target = workflowArtifactTarget
    if (!target || route !== (target.kind === 'report' ? 'reports' : target.kind === 'bundle' ? 'bundles' : target.kind === 'daily_brief' ? 'briefs' : 'reviews')) return undefined
    let cancelled = false
    const open = async (): Promise<void> => {
      try {
        if (target.kind === 'report') {
          const item = await client.getResearchReport(target.id)
          if (!cancelled && item.workflowRunId === target.runId) setSelectedReport(item)
        } else if (target.kind === 'bundle') {
          const item = await client.getResearchBundle(target.id)
          if (!cancelled && item.workflowRunId === target.runId) setSelectedBundle(item)
        } else if (target.kind === 'review_case') {
          const item = await client.getReview(target.id)
          if (!cancelled && item.producerRunId === target.runId) setReviewDetail(item)
        } else if (target.kind === 'daily_brief') {
          const item = await client.getDailyBrief(target.id)
          if (!cancelled && item.workflowRunId === target.runId) setSelectedBrief(item)
        } else {
          const item = await client.getThemeFrameworkRun(target.id)
          if (!cancelled && item.workflowRunId === target.runId) setThemeFrameworkRunId(item.workflowRunId)
        }
      } catch { /* artifact links are shown only after a matching persisted artifact is loaded */ }
      if (!cancelled) setWorkflowArtifactTarget(undefined)
    }
    void open()
    return () => { cancelled = true }
  }, [client, route, workflowArtifactTarget])

  const handleEvent = useCallback((event: ClientEvent): void => {
    if (event.conversationId !== latestConversation.current && event.type !== 'session.changed') return
    if (event.type === 'agent.started') { setStreaming(true); setThinking(false); setStreamText(''); setToolEvents([]) }
    if (event.type === 'message.delta') { setStreaming(true); setThinking(false); setStreamText((old) => `${old}${event.summary ?? ''}`) }
    if (event.type === 'thinking.status') { setStreaming(true); setThinking(true) }
    if (event.type.startsWith('tool.')) setToolEvents((old) => [...old.slice(-3), `${event.type.replace('tool.', '')}: ${toolLabel(event.name)}`])
    if (event.type === 'queue.updated') setQueue({ steering: event.steeringCount ?? 0, followUp: event.followUpCount ?? 0 })
    if (event.type === 'agent.completed' || event.type === 'error') { setStreaming(false); setThinking(false); void syncCurrent().catch((caught) => setError(errorText(caught))) }
    if (event.type === 'session.changed') { setStreaming(false); setStreamText(''); setThinking(false); void syncCurrent().catch((caught) => setError(errorText(caught))) }
  }, [syncCurrent])

  useEffect(() => { if (loadState !== 'ready') return undefined; return client.openEvents(handleEvent, () => { void syncCurrent().catch((caught) => setError(errorText(caught))) }) }, [client, handleEvent, loadState, syncCurrent])

  useEffect(() => {
    const knownWorkflow = workflowRef.current
    if (route !== 'research' || workflowCanceling || !workflowRunId || !knowledgeBase || (knownWorkflow?.runId === workflowRunId && terminalWorkflowStatuses.has(knownWorkflow.status))) return undefined
    setWorkflowPollNotice('')
    return startWorkflowPolling({ runId: workflowRunId, fetchWorkflow: (runId) => client.workflow(runId), onUpdate: (next) => { setWorkflow(next); setWorkflowPollNotice('') }, onError: () => undefined, onExhausted: () => setWorkflowPollNotice('Workflow status could not be synchronized after several attempts.') })
  }, [client, knowledgeBase, route, workflowCanceling, workflowRunId])

  useEffect(() => {
    const result = workflow?.executionResult
    if (route !== 'research' || !workflowRunId || workflow?.runId !== workflowRunId || !terminalWorkflowStatuses.has(workflow.status) || !result?.bundleRef) {
      setVerifiedWorkflowBundleId('')
      return undefined
    }
    let cancelled = false
    let timer: number | undefined
    let attempts = 0
    setVerifiedWorkflowBundleId('')
    const sync = async (): Promise<void> => {
      if (cancelled || attempts >= 4) return
      attempts += 1
      try {
        const bundle = await client.getResearchBundleForRun(workflowRunId)
        if (cancelled) return
        if (bundle.bundleId === result.bundleRef && bundle.workflowRunId === workflowRunId) {
          setVerifiedWorkflowBundleId(bundle.bundleId)
          return
        }
      } catch { /* bounded retries below; no raw transport error is shown */ }
      if (!cancelled && attempts < 4 && result.bundleStatus === 'pending') timer = window.setTimeout(() => void sync(), 700)
    }
    void sync()
    return () => { cancelled = true; if (timer !== undefined) window.clearTimeout(timer) }
  }, [client, route, workflow, workflowRunId])

  const runCommand = async (operation: 'prompt' | 'steer' | 'follow_up'): Promise<void> => {
    const text = composer.trim()
    if (!text || busy || (operation === 'prompt' && streaming)) return
    setBusy(true); setError('')
    let preserveComposer = false
    try {
      if (operation === 'prompt') {
        const requestMode = selectedWorkflowId ? { type: 'workflow' as const, workflowId: selectedWorkflowId } : { type: 'free_research' as const }
        const priorFeedback = dispatchFeedback
        const workflowArgumentContext = requestMode.type === 'workflow' && priorFeedback?.status === 'NEEDS_INPUT' && priorFeedback.workflowId === requestMode.workflowId
          ? { workflowId: priorFeedback.workflowId, arguments: priorFeedback.validatedArguments }
          : undefined
        const result: ResearchDispatchResponse = await client.dispatchResearch({ query: text, mode: requestMode, contextPolicy, persistencePolicy, ...(workflowArgumentContext === undefined ? {} : { workflowArgumentContext }) })
        setExecutionSummary(result.summary)
        setDispatchResolution(result.resolution)
        if (result.feedback || result.status === 'needs_input') {
          preserveComposer = true
          if (result.feedback) {
            const previousFeedback = dispatchFeedback
            const keepValidatedValues = previousFeedback?.status === 'NEEDS_INPUT' && previousFeedback.workflowId === result.feedback.workflowId
            setDispatchFeedback({ ...result.feedback, validatedArguments: keepValidatedValues ? { ...previousFeedback.validatedArguments, ...result.feedback.validatedArguments } : result.feedback.validatedArguments })
          } else setDispatchFeedback(undefined)
          if (result.feedback?.workflowId) setSelectedWorkflowId(result.feedback.workflowId)
          if (!result.feedback) setError('Workflow needs input, but the dispatch response did not include feedback details.')
        } else if (result.status === 'started') {
          setDispatchFeedback(undefined)
          setWorkflowRunId(result.runId ?? '')
          setThemeFrameworkRefreshInfo(undefined)
          setThemeFrameworkRunId(result.decision.workflow?.id === 'theme_framework' || result.summary.workflowId === 'theme_framework' ? (result.runId ?? '') : '')
          setWorkflow(result.workflow as WorkflowRun | undefined)
        } else {
          setDispatchFeedback(undefined)
          await client.command('prompt', text, { researchBundleId: result.runId, researchPolicy: { contextPolicy, persistencePolicy } })
          setStreaming(true); setThinking(false); setStreamText(''); setToolEvents([])
        }
      } else {
        await client.command(operation, text)
        setStreaming(true); setThinking(false); setStreamText(''); setToolEvents([])
      }
      if (!preserveComposer) setComposer('')
    } catch (caught) { setError(errorText(caught)) }
    finally { setBusy(false) }
  }
  const abort = async (): Promise<void> => { setBusy(true); setError(''); try { await client.abort(); setStreaming(false); await syncCurrent() } catch (caught) { setError(errorText(caught)) } finally { setBusy(false) } }
  const newConversation = async (): Promise<void> => { setBusy(true); setError(''); try { await client.newConversation(); setStreaming(false); setStreamText(''); await syncCurrent() } catch (caught) { setError(errorText(caught)) } finally { setBusy(false) } }
  const switchConversation = async (conversationId: string): Promise<void> => { if (conversationId === session?.conversationId || busy) return; setBusy(true); setError(''); setStreaming(false); setStreamText(''); setThinking(false); setToolEvents([]); try { await client.switchConversation(conversationId); await syncCurrent() } catch (caught) { setError(errorText(caught)) } finally { setBusy(false) } }
  const upload = async (file: File | undefined): Promise<void> => {
    if (!file) return
    if (!supportedDocumentExtension.test(file.name)) { setUploadStatus('Unsupported file. Choose a PDF, CSV, HTML, JSON, Markdown, text, or XML document.'); return }
    if (file.size > 100 * 1024 * 1024) { setUploadStatus('File exceeds the 100 MB upload limit.'); return }
    if (acceptanceBusy) { setUploadStatus('Wait for candidate acceptance to finish before replacing this file.'); return }
    if (attachmentBusy) { setUploadStatus('A document is already being staged. Wait for it to finish before choosing another.'); return }
    const generation = ++previewGeneration.current
    setPreview(undefined); setAcceptance(undefined); setSelectedCandidates(new Set()); setPreviewBusy(false); setWorkflowRunId(''); setWorkflow(undefined)
    setAttachmentBusy(true); setError(''); setUploadStatus('Staging document outside canonical Knowledge…')
    try {
      const staged = await client.uploadAttachment(file)
      if (generation !== previewGeneration.current) return
      setAttachment(staged); setRightsForm(defaultRightsForm); setSourceForm(defaultSourceForm); setAttachmentUiVersion((version) => version + 1); setUploadStatus('Document staged. No Knowledge has been written.')
    }
    catch (caught) { if (generation === previewGeneration.current) { setUploadStatus(''); setError(errorText(caught)) } }
    finally { if (generation === previewGeneration.current) setAttachmentBusy(false) }
  }
  const startRawDocumentPreview = async (): Promise<void> => {
    if (!attachment || !knowledgeBase || previewBusy || attachmentBusy || acceptanceBusy) return
    if (!sourceForm.title.trim() || !rightsForm.policyBasis.trim()) { setError('Enter a source title and a policy basis before preparing candidates.'); return }
    const generation = ++previewGeneration.current
    setPreviewBusy(true); setError(''); setAcceptance(undefined); setPreview(undefined); setSelectedCandidates(new Set()); setUploadStatus('Preparing a governed V0.4 candidate preview…')
    try {
      const sourceMetadata = { title: sourceForm.title.trim(), sourceType: sourceForm.sourceType, sourceReliability: sourceForm.sourceReliability, ...(sourceForm.publisher.trim() ? { publisher: sourceForm.publisher.trim() } : {}), ...(sourceForm.institution.trim() ? { institution: sourceForm.institution.trim() } : {}), ...(sourceForm.author.trim() ? { author: sourceForm.author.trim() } : {}), ...(sourceForm.publishedAt ? { publishedAt: new Date(sourceForm.publishedAt).toISOString() } : {}), ...(sourceForm.canonicalUrl.trim() ? { canonicalUrl: sourceForm.canonicalUrl.trim() } : {}) }
      const rights = { accessScope: rightsForm.accessScope, providerTermsKnown: rightsForm.providerTermsKnown, retentionAllowed: rightsForm.retentionAllowed, aiProcessingAllowed: rightsForm.aiProcessingAllowed, derivativeKnowledgeAllowed: rightsForm.derivativeKnowledgeAllowed, redistributionAllowed: rightsForm.redistributionAllowed, policyBasis: rightsForm.policyBasis.trim(), ...(rightsForm.expiresAt ? { expiresAt: new Date(rightsForm.expiresAt).toISOString() } : {}), ...(rightsForm.entitlementRef.trim() ? { entitlementRef: rightsForm.entitlementRef.trim() } : {}) }
      const started = await client.startRawDocumentPreviewV04({ attachmentId: attachment.attachmentId, sourceMetadata, rights })
      if (generation !== previewGeneration.current) return
      setWorkflowRunId(started.runId); setWorkflow(started.workflow);
      for (let attempt = 0; attempt < rawDocumentPreviewPollLimit && generation === previewGeneration.current; attempt += 1) {
        const result = await client.getRawDocumentPreviewV04(started.runId)
        if (generation !== previewGeneration.current) return
        if (result.workflow) setWorkflow(result.workflow)
        const disposition = previewPollTerminalDisposition(result)
        if (disposition === 'verified' && result.preview) { setPreview(result.preview); setUploadStatus(''); return }
        if (disposition === 'terminal') {
          if (result.preview) setPreview(result.preview)
          setUploadStatus('')
          setError(result.workflow?.errorSummary ?? result.preview?.statusNote ?? 'Preview workflow ended without a verified candidate preview.')
          return
        }
        if (attempt + 1 < rawDocumentPreviewPollLimit) await new Promise((resolve) => window.setTimeout(resolve, 1000))
      }
      if (generation === previewGeneration.current) { setUploadStatus(''); setError('Preview is still running. Check the Workflow panel for its current status.') }
    } catch (caught) { if (generation === previewGeneration.current) { setUploadStatus(''); setError(errorText(caught)) } }
    finally { if (generation === previewGeneration.current) setPreviewBusy(false) }
  }
  const acceptRawDocumentCandidates = async (): Promise<void> => {
    if (!preview?.committable || selectedCandidates.size === 0 || previewBusy) return
    if (attachmentBusy || acceptanceBusy) return
    setPreviewBusy(true); setAcceptanceBusy(true); setError(''); setAcceptance(undefined)
    try {
      const result = await client.acceptRawDocumentPreviewV04(preview.runId, [...selectedCandidates])
      setAcceptance(result)
      if (result.status === 'stale_revision') setPreview({ ...preview, status: 'stale_revision', committable: false })
      else if (['committed', 'already_committed', 'no_changes'].includes(result.status)) setSelectedCandidates(new Set())
      if (!['committed', 'already_committed', 'no_changes'].includes(result.status)) setError(result.errors.map((item) => `${item.code}: ${item.message}`).join(' · ') || result.status.replaceAll('_', ' '))
    } catch (caught) { setError(errorText(caught)) }
    finally { setPreviewBusy(false); setAcceptanceBusy(false) }
  }
  const toggleCandidate = (candidateId: string): void => setSelectedCandidates((previous) => { const next = new Set(previous); if (next.has(candidateId)) next.delete(candidateId); else next.add(candidateId); return next })
  const clearAttachment = (): void => { if (acceptanceBusy) return; previewGeneration.current += 1; setAttachment(undefined); setPreview(undefined); setAcceptance(undefined); setSelectedCandidates(new Set()); setPreviewBusy(false); setWorkflowRunId(''); setWorkflow(undefined); setUploadStatus(''); setRightsForm(defaultRightsForm); setSourceForm(defaultSourceForm); setAttachmentUiVersion((version) => version + 1) }
  const cancelWorkflow = async (): Promise<void> => { if (!workflowRunId) return; setBusy(true); setWorkflowCanceling(true); setError(''); try { await client.cancelWorkflow(workflowRunId); setWorkflow(await client.workflow(workflowRunId)) } catch { setWorkflowPollNotice('Cancellation could not be confirmed. Workflow status will continue to synchronize.') } finally { setWorkflowCanceling(false); setBusy(false) } }
  const selectReview = async (reviewCaseId: string): Promise<void> => { const epoch = requestEpoch.current; try { const result = await client.getReview(reviewCaseId); if (epoch === requestEpoch.current) setReviewDetail(result) } catch (caught) { if (epoch === requestEpoch.current) setError(errorText(caught)) } }
  const selectBrief = async (reportId: string): Promise<void> => { const epoch = requestEpoch.current; try { const result = await client.getDailyBrief(reportId); if (epoch === requestEpoch.current) setSelectedBrief(result) } catch (caught) { if (epoch === requestEpoch.current) setError(errorText(caught)) } }
  const selectReport = async (reportId: string): Promise<void> => { const epoch = requestEpoch.current; try { const result = await client.getResearchReport(reportId); if (epoch === requestEpoch.current) setSelectedReport(result) } catch (caught) { if (epoch === requestEpoch.current) setError(errorText(caught)) } }
  const selectBundle = async (bundleId: string): Promise<void> => { const epoch = requestEpoch.current; try { const result = await client.getResearchBundle(bundleId); if (epoch === requestEpoch.current) setSelectedBundle(result) } catch (caught) { if (epoch === requestEpoch.current) setError(errorText(caught)) } }
  const openWorkflowReport = (id: string): void => {
    if (!workflowRunId) return
    const dailyBrief = workflow?.workflowType === 'daily_intelligence'
    setWorkflowArtifactTarget({ kind: dailyBrief ? 'daily_brief' : 'report', id, runId: workflowRunId })
    navigate(dailyBrief ? 'briefs' : 'reports')
  }
  const openWorkflowBundle = (id: string): void => { if (!workflowRunId) return; setWorkflowArtifactTarget({ kind: 'bundle', id, runId: workflowRunId }); navigate('bundles') }
  const openWorkflowReview = (kind: NonNullable<NonNullable<WorkflowRun['executionResult']>['reviewRef']>['kind'], id: string): void => {
    if (!workflowRunId) return
    const targetKind = kind === 'review_case' ? 'review_case' : kind === 'daily_brief' ? 'daily_brief' : 'theme_framework_candidate'
    setWorkflowArtifactTarget({ kind: targetKind, id, runId: workflowRunId })
    navigate(kind === 'daily_brief' ? 'briefs' : 'reviews')
  }
  const searchSources = async (query: string): Promise<void> => { const epoch = requestEpoch.current; setSourceBusy(true); setError(''); try { const result = await client.searchSourceLibrary(query, true); if (epoch === requestEpoch.current) setSourceHits(result.hits) } catch (caught) { if (epoch === requestEpoch.current) setError(errorText(caught)) } finally { if (epoch === requestEpoch.current) setSourceBusy(false) } }

  const updateSettings = async (action: () => Promise<RuntimeSettings>): Promise<void> => {
    setSettingsBusy(true); setSettingsError('')
    try { setSettings(await action()) }
    catch (caught) { setSettingsError(errorText(caught)); throw caught }
    finally { setSettingsBusy(false) }
  }
  const beginSubscriptionLogin = async (): Promise<void> => {
    setSettingsBusy(true); setSettingsError('')
    try { setModelLoginFlow(await client.startModelLogin()) }
    catch (caught) { setSettingsError(errorText(caught)) }
    finally { setSettingsBusy(false) }
  }
  const answerSubscriptionLogin = async (answer: string): Promise<void> => {
    if (!modelLoginFlow) return
    setSettingsBusy(true); setSettingsError('')
    try { setModelLoginFlow(await client.answerModelLogin(modelLoginFlow.id, answer)) }
    catch (caught) { setSettingsError(errorText(caught)); throw caught }
    finally { setSettingsBusy(false) }
  }
  const cancelSubscriptionLogin = async (): Promise<void> => {
    if (!modelLoginFlow) return
    try { setModelLoginFlow(await client.cancelModelLogin(modelLoginFlow.id)) }
    catch (caught) { setSettingsError(errorText(caught)) }
  }
  const saveApiKey = (providerId: string, apiKey: string): Promise<void> => updateSettings(() => client.saveModelApiKey(providerId, apiKey))
  const saveCompatibleEndpoint = async (endpoint: CompatibleEndpointInput): Promise<void> => {
    await updateSettings(() => client.saveModelConnection({ name: endpoint.name, providerId: endpoint.providerId, api: endpoint.protocol === 'openai' ? 'openai-completions' : 'anthropic-messages', baseUrl: endpoint.baseUrl, modelId: endpoint.modelId, modelName: endpoint.name, contextWindow: endpoint.contextWindow, maxTokens: endpoint.maxOutputTokens }))
    if (endpoint.apiKey.trim()) await saveApiKey(endpoint.providerId, endpoint.apiKey)
  }
  const verifyKnowledgeDirectory = async (path: string): Promise<void> => {
    setSettingsBusy(true); setSettingsError(''); setKnowledgeDirectoryVerification(undefined)
    try { const result = await client.verifyKnowledgeDirectory(path); setKnowledgeDirectoryVerification({ valid: true, message: `${result.knowledgeBaseId} · Schema ${result.schemaVersion} · r${result.revision}` }) }
    catch (caught) { setKnowledgeDirectoryVerification({ valid: false, message: errorText(caught) }) }
    finally { setSettingsBusy(false) }
  }
  const testModelConnection = async (provider: string, modelId: string): Promise<void> => {
    setSettingsBusy(true); setSettingsError(''); setModelTestMessage('')
    try { await client.testModelConnection(provider, modelId); setModelTestMessage(t('连接测试成功', 'Connection test succeeded')) }
    catch (caught) { setSettingsError(errorText(caught)) }
    finally { setSettingsBusy(false) }
  }

  if (loadState === 'loading') return <main className="state-screen"><div className="state-card"><span className="eyebrow">RESEARCHHUB RUNTIME</span><h1>{t('正在加载工作区', 'Loading workspace')}</h1><p>{t('正在连接本地应用运行时…', 'Connecting to the local application runtime…')}</p><div className="loader" /></div></main>
  if (loadState === 'error') return <main className="state-screen"><div className="state-card"><span className="eyebrow">RUNTIME UNAVAILABLE</span><h1>{t('ResearchHub 无法启动', 'ResearchHub could not start')}</h1><p>{loadError}</p><button onClick={() => window.location.reload()}>{t('重新加载页面', 'Reload page')}</button></div></main>
  const configurationBlocked = busy || streaming || attachmentBusy || previewBusy || acceptanceBusy || sourceBusy || Boolean(workflowRunId && (!workflow || !terminalWorkflowStatuses.has(workflow.status)))
  const registrationById = new Map((settings?.registeredKnowledgeBases ?? []).map((item) => [item.knowledgeBaseId, item]))
  const mountedId = settings?.knowledgeBase?.knowledgeBaseId
  const knowledgeCandidates = [
    ...(settings?.knowledgeBases ?? []).map((item) => ({ id: item.knowledgeBaseId, schemaVersion: item.schemaVersion, revision: item.revision, mounted: item.knowledgeBaseId === mountedId, registered: registrationById.has(item.knowledgeBaseId), available: true })),
    ...(settings?.registeredKnowledgeBases ?? []).filter((item) => !item.available && !settings?.knowledgeBases.some((choice) => choice.knowledgeBaseId === item.knowledgeBaseId)).map((item) => ({ id: item.knowledgeBaseId, schemaVersion: item.schemaVersion, revision: item.revision, mounted: false, registered: true, available: false })),
  ]
  const authorizationEvent = [...(modelLoginFlow?.events ?? [])].reverse().find((event) => event.type === 'auth_url' || event.type === 'device_code')
  const settingsPanelProps: SettingsPanelProps = {
    model: {
      selected: settings?.model.provider ? settings.model : undefined,
      availableCount: settings?.models.filter((item) => item.available).length ?? 0,
      options: settings?.models.filter((item) => item.available || (item.provider === settings.model.provider && item.modelId === settings.model.modelId)),
      connections: (settings?.modelProviders ?? []).filter((item) => item.configured || item.appManaged || ['openai-codex', 'openai', 'anthropic', 'google', 'openrouter'].includes(item.providerId)).map((item) => ({ providerId: item.providerId, name: item.name, status: item.configured ? 'connected' as const : item.supportsApiKey ? 'needs_api_key' as const : 'needs_auth' as const, apiKeySupported: item.supportsApiKey, detail: item.providerId === 'openai-codex' ? t('使用上方订阅登录；Codex CLI 登录状态不会自动复用。', 'Use subscription sign-in above; Codex CLI credentials are not reused automatically.') : undefined })),
      subscriptionLogin: modelLoginFlow ? { status: modelLoginFlow.state === 'complete' ? 'connected' : modelLoginFlow.state === 'failed' || modelLoginFlow.state === 'cancelled' ? 'failed' : authorizationEvent || modelLoginFlow.prompt ? 'awaiting_user' : 'pending', ...(authorizationEvent?.type === 'auth_url' ? { verificationUri: authorizationEvent.url } : {}), ...(authorizationEvent?.type === 'device_code' ? { verificationUri: authorizationEvent.verificationUri, userCode: authorizationEvent.userCode } : {}), ...(modelLoginFlow.prompt ? { message: modelLoginFlow.prompt.message, prompt: modelLoginFlow.prompt.message } : {}), ...(modelLoginFlow.error ? { message: modelLoginFlow.error } : {}) } : undefined,
    },
    knowledge: { mounted: settings?.knowledgeBase ? { id: settings.knowledgeBase.knowledgeBaseId, schemaVersion: settings.knowledgeBase.schemaVersion, revision: settings.knowledgeBase.revision, mounted: true, registered: registrationById.has(settings.knowledgeBase.knowledgeBaseId) } : undefined, candidates: knowledgeCandidates, discoverySummary: t('默认扫描 ResearchHubData/knowledge-bases，也可登记已有知识库目录。', 'The default catalog is ResearchHubData/knowledge-bases; you can also register an existing directory.'), verification: knowledgeDirectoryVerification },
    busy: settingsBusy,
    error: settingsError || settings?.knowledgeBaseError || settings?.modelError,
    modelTestMessage,
    onRefresh: loadSettings,
    onBeginSubscriptionLogin: beginSubscriptionLogin,
    onSubmitSubscriptionAnswer: answerSubscriptionLogin,
    onCancelSubscriptionLogin: cancelSubscriptionLogin,
    onSaveApiKey: saveApiKey,
    onRemoveCredentials: (providerId) => { void updateSettings(() => client.removeModelCredentials(providerId)).catch(() => undefined) },
    onSaveCompatibleEndpoint: saveCompatibleEndpoint,
    onTestConnection: (providerId, modelId) => { void testModelConnection(providerId, modelId) },
    onVerifyKnowledgeDirectory: verifyKnowledgeDirectory,
    onRegisterKnowledgeDirectory: (path) => { void updateSettings(() => client.registerKnowledgeDirectory(path)).then(() => setKnowledgeDirectoryVerification(undefined)).catch(() => undefined) },
    onRemoveKnowledgeBase: (knowledgeBaseId) => { void updateSettings(() => client.removeKnowledgeRegistration(knowledgeBaseId)).catch(() => undefined) },
    onRefreshKnowledgeBases: loadSettings,
    onMountKnowledgeBase: (knowledgeBaseId) => { void changeKnowledgeBase(knowledgeBaseId) },
    onUnmountKnowledgeBase: () => { void changeKnowledgeBase('') },
  }
  return <div className="app-shell"><ApplicationSidebar route={route} knowledgeBase={knowledgeBase} settings={settings} settingsError={settingsError} settingsBusy={settingsBusy} interactionsDisabled={configurationBlocked} onNavigate={navigate} onLoadSettings={() => void loadSettings()} onModelChange={(value) => void changeModel(value)} settingsPanelProps={settingsPanelProps} /><div className="app-main">{route === 'research' ? <ResearchPage session={session} conversations={conversations} messages={messages} streaming={streaming} thinking={thinking} streamText={streamText} toolEvents={toolEvents} queue={queue} composer={composer} busy={busy} error={error} attachment={attachment} attachmentUiVersion={attachmentUiVersion} attachmentBusy={attachmentBusy} preview={preview} previewBusy={previewBusy} acceptanceBusy={acceptanceBusy} selectedCandidates={selectedCandidates} acceptance={acceptance} rightsForm={rightsForm} sourceForm={sourceForm} uploadStatus={uploadStatus} workflowRunId={workflowRunId} themeFrameworkRunId={themeFrameworkRunId} setThemeFrameworkRunId={setThemeFrameworkRunId} themeFrameworkRefreshInfo={themeFrameworkRefreshInfo} setThemeFrameworkRefreshInfo={setThemeFrameworkRefreshInfo} themeFrameworkReviewRevision={themeFrameworkReviewRevision} refreshThemeFrameworkReviews={() => setThemeFrameworkReviewRevision((value) => value + 1)} client={client} workflow={workflow} knowledgeBase={knowledgeBase} openReviewCases={openReviewCases} workflowDefinitions={workflowDefinitions} selectedWorkflowId={selectedWorkflowId} setSelectedWorkflowId={setSelectedWorkflowId} contextPolicy={contextPolicy} persistencePolicy={persistencePolicy} setContextPolicy={setContextPolicy} setPersistencePolicy={setPersistencePolicy} executionSummary={executionSummary} dispatchFeedback={dispatchFeedback} dispatchResolution={dispatchResolution} verifiedWorkflowBundleId={verifiedWorkflowBundleId} workflowPollNotice={workflowPollNotice} setComposer={setComposer} newConversation={() => void newConversation()} switchConversation={(id) => void switchConversation(id)} runCommand={(operation) => void runCommand(operation)} abort={() => void abort()} upload={(file) => void upload(file)} toggleCandidate={toggleCandidate} setRightsForm={setRightsForm} setSourceForm={setSourceForm} startPreview={() => void startRawDocumentPreview()} acceptCandidates={() => void acceptRawDocumentCandidates()} clearAttachment={clearAttachment} cancelWorkflow={() => void cancelWorkflow()} openWorkflowReport={openWorkflowReport} openWorkflowBundle={openWorkflowBundle} openWorkflowReview={openWorkflowReview} dismissError={() => setError('')} onNavigate={navigate} /> : route === 'briefs' ? <BriefsPage briefs={briefs} selected={selectedBrief} busy={briefsBusy} error={error} onSelect={(id) => void selectBrief(id)} /> : route === 'reports' ? <ReportsPage reports={reports} selected={selectedReport} busy={reportsBusy} error={error} onSelect={(id) => void selectReport(id)} /> : route === 'bundles' ? <ResearchBundlesPage bundles={bundles} selected={selectedBundle} busy={bundlesBusy} error={error} onSelect={(id) => void selectBundle(id)} sourceHits={sourceHits} sourceBusy={sourceBusy} onSearchSources={(query) => void searchSources(query)} /> : route === 'run' ? <ResearchRunPage client={client} onLaunched={onResearchLaunched} /> : route === 'graph' ? <KnowledgeGraphPage knowledgeBase={knowledgeBase} client={client} /> : route === 'sources' ? <DataSourcesPage client={client} /> : route === 'theses' ? <ThesisLifecyclePage client={client} knowledgeBase={knowledgeBase} /> : <ReviewsPage client={client} knowledgeBase={knowledgeBase} reviews={reviews} reviewDetail={reviewDetail} reviewsBusy={reviewsBusy} themeFrameworkRunId={themeFrameworkRunId} setThemeFrameworkRunId={setThemeFrameworkRunId} themeFrameworkRefreshInfo={themeFrameworkRefreshInfo} setThemeFrameworkRefreshInfo={setThemeFrameworkRefreshInfo} themeFrameworkReviewRevision={themeFrameworkReviewRevision} refreshThemeFrameworkReviews={() => setThemeFrameworkReviewRevision((value) => value + 1)} acceptance={acceptance} workflowRunId={workflowRunId} workflow={workflow} onSelect={(id) => void selectReview(id)} onCloseDetail={() => setReviewDetail(undefined)} />}</div></div>
}

export default function App(): ReactElement {
  return <LanguageProvider><AppContent /></LanguageProvider>
}
