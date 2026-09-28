import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { RuntimeClient, RuntimeClientError, type AttachmentRef, type ClientEvent, type ConversationMessage, type ConversationSummary, type DailyBriefReport, type DailyBriefSummary, type KnowledgeBaseStatus, type KnowledgeDirectoryItem, type ResearchBundleSummary, type ResearchDispatchResponse, type ResearchExecutionSummary, type ResearchReport, type ResearchReportSummary, type ResearchStartResponse, type ReviewDetail, type ReviewListResponse, type SessionState, type SourceLibraryHit, type ThesisCriterionConfirmResult, type ThesisCriterionOrigin, type ThesisCriterionPreview, type ThesisDecision, type ThesisQueryDetail, type ThesisQuerySummary, type WorkflowDefinition, type WorkflowRun } from './api/runtime-client'
import { startWorkflowPolling, terminalWorkflowStatuses } from './app/workflow-polling'
import { KnowledgeGraphPage } from './app/graph/KnowledgeGraphPage'
import { ResearchRunPage } from './app/run/ResearchRunPage'
import './styles.css'

type Route = 'research' | 'briefs' | 'reports' | 'bundles' | 'run' | 'graph' | 'reviews' | 'theses'
type ResearchContextPanel = 'attachments' | 'workflow' | 'review'
type LoadState = 'loading' | 'ready' | 'error'
const knownTools: Record<string, string> = { researchhub_status: 'ResearchHub status', search_knowledge: 'Knowledge search', get_knowledge_object: 'Knowledge object lookup', ingest_document: 'Document ingestion', get_workflow_status: 'Workflow status', cancel_workflow: 'Workflow cancellation', list_review_cases: 'Review case list', get_review_case: 'Review case detail' }

function routeForPath(pathname: string): Route { return pathname === '/briefs' ? 'briefs' : pathname === '/reports' ? 'reports' : pathname === '/bundles' ? 'bundles' : pathname === '/run' ? 'run' : pathname === '/graph' ? 'graph' : pathname === '/reviews' ? 'reviews' : pathname === '/theses' ? 'theses' : 'research' }
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

interface TopBarProps { readonly route: Route; readonly knowledgeBase?: KnowledgeBaseStatus; readonly onNavigate: (route: Route) => void }
function TopBar({ route, knowledgeBase, onNavigate }: TopBarProps): ReactElement {
  const links: readonly [Route, string][] = [['research', 'Research'], ['briefs', 'Daily Briefs'], ['reports', 'Reports'], ['bundles', 'Research Bundles'], ['run', 'Run Research'], ['graph', 'Knowledge Graph'], ['theses', 'Theses'], ['reviews', 'Reviews']]
  return <header className="topbar"><div className="topbar-left"><div className="brand"><span className="brand-mark">RH</span><span className="brand-name">ResearchHub</span></div><nav className="primary-nav" aria-label="Primary"><ul>{links.map(([item, label]) => <li key={item}><a className={route === item ? 'nav-link active' : 'nav-link'} href={routePath(item)} aria-current={route === item ? 'page' : undefined} onClick={(event) => { event.preventDefault(); onNavigate(item) }}>{label}</a></li>)}</ul></nav></div><div className="runtime-status"><span className="status-dot" /> <span>Local Runtime</span><span className="status-sub">{knowledgeBase ? 'KB mounted' : 'No KB mounted'}</span></div></header>
}

interface ReviewsPageProps { readonly knowledgeBase?: KnowledgeBaseStatus; readonly reviews?: ReviewListResponse; readonly reviewDetail?: ReviewDetail; readonly reviewsBusy: boolean; readonly onSelect: (reviewCaseId: string) => void; readonly onCloseDetail: () => void }
function ReviewsPage({ knowledgeBase, reviews, reviewDetail, reviewsBusy, onSelect, onCloseDetail }: ReviewsPageProps): ReactElement {
  return <main className="page-frame review-page" aria-labelledby="reviews-title"><div className="page-heading"><div><span className="eyebrow">GOVERNANCE</span><h1 id="reviews-title">Review Inbox</h1></div><span className="read-only-badge">Read-only</span></div>{!knowledgeBase ? <div className="notice"><strong>No Knowledge Base mounted</strong><p>Review cases will appear here when a mounted production run creates actionable decisions.</p></div> : reviewsBusy ? <p className="muted">Loading Review Inbox…</p> : <div className="review-layout"><section aria-label="Open ReviewCases"><div className="section-title"><div><span className="eyebrow">OPEN CASES</span><h2>{reviews?.total ?? 0} review{(reviews?.total ?? 0) === 1 ? '' : 's'}</h2></div></div>{reviews && reviews.cases.length > 0 ? <div className="result-list">{reviews.cases.map((item) => <button className="review-item" key={item.reviewCaseId} onClick={() => onSelect(item.reviewCaseId)}><strong>{item.category}</strong><span>{item.actionability} · {item.proposalKind}</span><small>{item.rationale}</small><small>{item.producerType} · {new Date(item.createdAt).toLocaleString()}</small></button>)}</div> : <div className="notice"><strong>No open Review cases</strong><p>Completed production with review will surface actionable cases here.</p></div>}</section>{reviewDetail ? <section className="review-detail" aria-label="ReviewCase detail"><div className="detail-title"><span>Review detail</span><button onClick={onCloseDetail}>Close</button></div><h2>{reviewDetail.reviewCaseId}</h2><p><strong>Classification:</strong> {safeStructured(reviewDetail.classification)}</p><p><strong>Root proposal:</strong> {safeStructured(reviewDetail.rootProposal)}</p><p><strong>Evidence:</strong> {reviewDetail.evidenceBindings.length} binding(s)</p><p><strong>Existing Knowledge:</strong> {reviewDetail.existingKnowledgeProjections.length} projection(s)</p><p><strong>Impact:</strong> {safeStructured(reviewDetail.impact)}</p>{reviewDetail.advisory ? <p><strong>Advisory:</strong> {safeStructured(reviewDetail.advisory)}</p> : null}<p><strong>Dependent proposals:</strong> {reviewDetail.totalDependentProposals}</p><p className="muted">Review Inbox is read-only in v0.1. Decision controls are intentionally not available.</p></section> : <div className="notice detail-empty"><strong>Select a ReviewCase</strong><p>Review details are bounded and read-only.</p></div>}</div>}</main>
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
function ThesisLifecyclePage({ client, knowledgeBase }: ThesisLifecyclePageProps): ReactElement {
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
  const [decisionNote, setDecisionNote] = useState('')
  const [decisionBusy, setDecisionBusy] = useState(false)
  const [error, setError] = useState('')
  const reportLookupRun = useRef('')

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
    setSelectedCaseId(id); setError('')
    try { const detail = await client.getThesisReview(id); setReviewDetail(detail); setDecisionNote(''); if (detail.thesisScope) setSelectedRef(detail.thesisScope.thesisRef) } catch (caught) { setReviewDetail(undefined); setError(errorText(caught)) }
  }

  const submitDecision = async (decision: ThesisDecision): Promise<void> => {
    if (!selectedCaseId || !reviewDetail?.thesisScope || !reviewDetail.decision?.actionable || decisionBusy) return
    setDecisionBusy(true); setError('')
    try {
      await client.decideThesisReview(selectedCaseId, decision, decisionNote.trim() || undefined)
      const [detail, list] = await Promise.all([client.getThesisReview(selectedCaseId), client.listReviews()])
      setReviewDetail(detail); setReviews(list)
      if (decision === 'ACCEPT') { await reloadTheses(); setThesis(await client.getThesis(detail.thesisScope!.thesisRef)) }
    } catch (caught) { setError(errorText(caught)) } finally { setDecisionBusy(false) }
  }

  const thesisCases = (reviews?.cases ?? []).filter((item) => item.producerType === 'thesis_lifecycle')
  const scopedCase = Boolean(reviewDetail?.producerType === 'thesis_lifecycle' && reviewDetail.thesisScope && reviewDetail.thesisScope.thesisRef === selectedRef)

  return <main className="page-frame thesis-page" aria-labelledby="theses-title">
    <div className="page-heading"><div><span className="eyebrow">CANONICAL KNOWLEDGE · V0.4</span><h1 id="theses-title">Thesis Lifecycle</h1></div><span className="read-only-badge">CREATE uses selected evidence · REFRESH requires review</span></div>
    {!knowledgeBase ? <div className="notice"><strong>No Knowledge Base mounted</strong><p>Mount a canonical Schema 0.4 Knowledge Base to inspect and refresh active theses.</p></div> : <>
      <section className="thesis-panel thesis-create-panel" aria-label="Create Thesis"><div className="section-title"><div><span className="eyebrow">CANONICAL CREATE</span><h2>Formalize a new investment Thesis</h2></div><span className="read-only-badge">Gateway → Writer</span></div><p className="muted">Choose one company and existing canonical evidence. The runtime validates company scope, source rights, raw provenance, and publication time before it writes the Thesis, Claims, and membership edges.</p>
        <form className="thesis-refresh-form thesis-create-form" onSubmit={(event) => void launchCreate(event)}>
          <label className="thesis-field"><span>Company</span><select aria-label="CREATE company" value={createCompanyRef} onChange={(event) => setCreateCompanyRef(event.target.value)} required disabled={companies.length === 0}><option value="">Select a canonical company</option>{companies.map((item) => <option key={item.ref} value={item.ref}>{item.name} · {item.ref}</option>)}</select></label>
          <label className="thesis-field"><span>Thesis title</span><input aria-label="Thesis title" maxLength={240} value={createTitle} onChange={(event) => setCreateTitle(event.target.value)} required /></label>
          <label className="thesis-field"><span>Narrative <small>required · up to 8,000 characters</small></span><textarea aria-label="Thesis narrative" rows={4} maxLength={8000} value={createNarrative} onChange={(event) => setCreateNarrative(event.target.value)} required /></label>
          <label className="thesis-field"><span>Canonical evidence refs <small>required · 1 to 40 Claim/Observation refs</small></span><textarea aria-label="CREATE evidence refs" rows={3} maxLength={4000} value={createEvidenceText} onChange={(event) => setCreateEvidenceText(event.target.value)} placeholder="claim:… or observation:…" required /></label>
          <label className="thesis-field"><span>As of</span><input aria-label="CREATE as of" type="datetime-local" value={asOf} onChange={(event) => setAsOf(event.target.value)} required /></label>
          <button className="primary-action" type="submit" disabled={!createCompanyRef || companies.length === 0 || launchBusy}>{launchBusy && runMode === 'CREATE' ? 'Starting CREATE…' : 'Create Thesis'}</button>
        </form>
      </section>
      <div className="thesis-layout">
        <section className="thesis-panel" aria-label="Active theses"><div className="section-title"><div><span className="eyebrow">ACTIVE THESIS</span><h2>{theses.length} available</h2></div><button className="secondary-action" onClick={() => void reloadTheses()} disabled={thesesBusy}>{thesesBusy ? 'Loading…' : 'Reload'}</button></div>
          <label className="thesis-field"><span>Canonical Thesis</span><select aria-label="Canonical Thesis" value={selectedRef} onChange={(event) => { setSelectedRef(event.target.value); setThesis(undefined); setReport(undefined); setReviewDetail(undefined); setSelectedCaseId('') }} disabled={thesesBusy || theses.length === 0}><option value="">Select a Thesis</option>{theses.map((item) => <option key={item.thesisRef} value={item.thesisRef}>{item.title} · {item.companySubject.name} · {item.status}</option>)}</select></label>
          {thesis ? <div className="thesis-summary"><span className="result-kind">{thesis.status} · revision {thesis.revision}</span><h3>{thesis.title}</h3><p>{thesis.statement}</p><small>{thesis.thesisRef} · {thesis.companySubject.name} · {thesis.propositions.length} propositions</small><div className="thesis-propositions">{thesis.propositions.map((item) => <article key={item.claimRef}><strong>{item.claimType}</strong><p>{item.statement}</p><small>{item.claimRef}</small></article>)}</div></div> : <p className="muted">{thesesBusy ? 'Loading active theses…' : 'No active canonical Theses were found.'}</p>}
          {thesis && thesis.thesisRef === selectedRef ? <ThesisCriterionAuthoring key={thesis.thesisRef} client={client} thesis={thesis} onThesisReload={setThesis} /> : null}
        </section>
        <section className="thesis-panel" aria-label="Refresh controls"><div className="section-title"><div><span className="eyebrow">POINT-IN-TIME REFRESH</span><h2>Re-evaluate accepted evidence</h2></div></div><p className="muted">The runtime reconstructs proposition membership from canonical <code>qualifies</code> edges and admits only source-bound evidence published by the selected time.</p>
          <form className="thesis-refresh-form" onSubmit={(event) => void launchRefresh(event)}>
            <label className="thesis-field"><span>As of</span><input aria-label="As of" type="datetime-local" value={asOf} onChange={(event) => setAsOf(event.target.value)} required /></label>
            <label className="thesis-field"><span>Evidence refs <small>optional · up to 80 canonical Observation/Claim refs</small></span><textarea aria-label="Evidence refs" rows={3} maxLength={5000} value={evidenceText} onChange={(event) => setEvidenceText(event.target.value)} placeholder="observation:… or claim:…" /></label>
            <button className="primary-action" type="submit" disabled={!selectedRef || launchBusy}>{launchBusy ? 'Starting refresh…' : 'Refresh Thesis'}</button>
          </form>
        </section>
      </div>
      {error ? <div className="notice thesis-error" role="alert"><strong>Thesis operation</strong><p>{error}</p></div> : null}
      {runId ? <section className="thesis-result" aria-label={`${runMode} run`}><div className="section-title"><div><span className="eyebrow">{runMode} RUN</span><h2>{workflow?.status ?? 'accepted'}</h2></div><small>{runId}</small></div><p>{workflow?.progressSummary ?? workflow?.errorSummary ?? `Waiting for the lifecycle ${runMode} workflow to finish…`}</p>{workflow?.status === 'blocked' || workflow?.status === 'failed' ? <p className="thesis-diagnostic">{workflow.errorSummary ?? `The ${runMode} did not complete.`}</p> : null}</section> : null}
      {report ? <section className="thesis-result" aria-label="Persisted Thesis Lifecycle report"><div className="section-title"><div><span className="eyebrow">PERSISTED REPORT · {report.reportType}</span><h2>{report.reportId}</h2></div><small>KB revision {report.knowledgeBaseRevision} · as of {report.asOf}</small></div><p>{report.methodology}</p><div className="brief-metrics"><span><b>{report.sourceRefs.length}</b> sources</span><span><b>{report.claimRefs.length}</b> claims</span><span><b>{report.sections.length}</b> sections</span></div>{report.sections.map((section) => <article className="brief-section" key={section.id}><div className="brief-section-heading"><h3>{section.title}</h3><span>{section.id}</span></div><pre className="thesis-report-markdown">{section.markdown}</pre></article>)}</section> : null}
      <section className="thesis-review-area" aria-label="Thesis scoped ReviewCases"><div className="section-title"><div><span className="eyebrow">HUMAN DECISIONS</span><h2>Thesis ReviewCases</h2></div><span className="read-only-badge">Gateway → Writer on ACCEPT</span></div><div className="thesis-review-layout"><section className="thesis-panel"><div className="result-list">{thesisCases.map((item) => <button className={`review-item ${selectedCaseId === item.reviewCaseId ? 'selected' : ''}`} key={item.reviewCaseId} onClick={() => void selectCase(item.reviewCaseId)}><strong>{item.reviewCaseId}</strong><span>{item.decisionState ?? 'OPEN'} · {item.category} · {item.actionability}</span><small>{item.rationale}</small><small>{item.producerRunId}</small></button>)}</div>{thesisCases.length === 0 ? <p className="muted">No actionable Thesis ReviewCases are currently listed.</p> : null}</section>
        {reviewDetail && scopedCase ? <section className="review-detail" aria-label="Thesis ReviewCase detail"><div className="detail-title"><span>Thesis ReviewCase</span><button onClick={() => { setReviewDetail(undefined); setSelectedCaseId('') }}>Close</button></div><h2>{reviewDetail.reviewCaseId}</h2><p><strong>Thesis:</strong> {reviewDetail.thesisScope!.thesisRef}</p><p><strong>Root Claim:</strong> {reviewDetail.thesisScope!.rootClaimRef}</p><p><strong>Transition:</strong> {reviewDetail.thesisScope!.candidateTransition}{reviewDetail.thesisScope!.proposedThesisStatus ? ` → ${reviewDetail.thesisScope!.proposedThesisStatus}` : ''}</p><p><strong>As of:</strong> {reviewDetail.thesisScope!.asOf}</p><p><strong>Affected Claims:</strong> {reviewDetail.thesisScope!.affectedClaimRefs.join(', ')}</p><p><strong>Reviewed evidence:</strong> {safeStructured(reviewDetail.thesisScope!.reviewedEvidence)}</p><p><strong>Evidence bindings:</strong> {safeStructured(reviewDetail.evidenceBindings)}</p><p><strong>Decision state:</strong> {reviewDetail.decision?.state ?? 'OPEN'}</p>{reviewDetail.decision?.events.length ? <div className="thesis-history"><strong>Decision history</strong>{reviewDetail.decision.events.map((item) => <p key={`${item.revision}-${item.type}`}>{item.type} · {item.at}{item.note ? ` · ${item.note}` : ''}{item.writerRunId ? ` · ${item.writerRunId}` : ''}</p>)}</div> : null}{reviewDetail.decision?.actionable ? <div className="thesis-decision-controls"><label className="thesis-field"><span>Decision note <small>optional · up to 1000 characters</small></span><textarea aria-label="Decision note" rows={3} maxLength={1000} value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} /></label><div className="thesis-decision-buttons"><button className="primary-action" onClick={() => void submitDecision('ACCEPT')} disabled={decisionBusy}>Accept reviewed changes</button><button className="secondary-action" onClick={() => void submitDecision('DEFER')} disabled={decisionBusy}>Defer</button><button className="danger-action" onClick={() => void submitDecision('REJECT')} disabled={decisionBusy}>Reject</button></div></div> : <p className="muted">This case is resolved or is no longer actionable.</p>}</section> : <div className="notice detail-empty"><strong>Select a Thesis ReviewCase</strong><p>Acceptance rebinds the current Thesis, propositions, evidence, and provenance before the Gateway and Writer execute the reviewed change.</p></div>}
      </div></section>
    </>}
  </main>
}

function DailyBriefCard(): ReactElement { return <section className="daily-brief-card" aria-label="Daily Intelligence"><div><span className="eyebrow">PERSONAL RESEARCH</span><h2>Daily Intelligence</h2><p>Morning 08:00 · Evening 20:30 · Asia/Shanghai</p></div><span className="read-only-badge">Public sources</span><small>Generate or read bounded briefs from the Pi tools or API. Unavailable sections remain explicit.</small></section> }

interface BriefsPageProps { readonly briefs?: readonly DailyBriefSummary[]; readonly selected?: DailyBriefReport; readonly busy: boolean; readonly error: string; readonly onSelect: (reportId: string) => void }
function BriefsPage({ briefs, selected, busy, error, onSelect }: BriefsPageProps): ReactElement {
  return <main className="page-frame briefs-page" aria-labelledby="briefs-title"><div className="page-heading"><div><span className="eyebrow">PERSONAL RESEARCH</span><h1 id="briefs-title">Daily Briefs</h1></div><span className="read-only-badge">Read-only</span></div><p>Browse persisted Morning and Evening Intelligence outputs with section-level evidence kept visible.</p>{error ? <div className="notice" role="alert"><strong>Daily Briefs unavailable</strong><p>{error}</p></div> : busy ? <p className="muted">Loading Daily Briefs…</p> : briefs && briefs.length > 0 ? <div className="briefs-layout"><section aria-label="Daily Brief history"><div className="section-title"><div><span className="eyebrow">HISTORY</span><h2>{briefs.length} brief{briefs.length === 1 ? '' : 's'}</h2></div></div><div className="result-list">{briefs.map((brief) => <button className={`result-item ${selected?.reportId === brief.reportId ? 'selected' : ''}`} key={brief.reportId} onClick={() => onSelect(brief.reportId)}><strong>{brief.briefType === 'morning' ? 'Morning' : 'Evening'} · {brief.tradeDate}</strong><span>{brief.quality.topCount} top signals · {Math.round(brief.quality.reportItemWithSourceRatio * 100)}% sourced</span><small>{brief.reportId}</small></button>)}</div></section>{selected ? <section className="brief-detail" aria-label="Daily Brief detail"><div className="detail-title"><div><span className="eyebrow">{selected.briefType === 'morning' ? 'MORNING' : 'EVENING'} BRIEF</span><h2>{selected.tradeDate}</h2></div><small>Revision {selected.revision} · {selected.timezone}</small></div><p className="brief-methodology">As of {selected.asOf}. {selected.consensusStatement}</p><div className="brief-metrics"><span><b>{selected.quality.reportItemCount ?? 0}</b> items</span><span><b>{selected.quality.claimCount ?? 0}</b> claims</span><span><b>{selected.reviewCaseCount}</b> reviews</span></div>{selected.sections.map((section) => <article className={`brief-section ${section.unavailable ? 'unavailable' : ''}`} key={section.id}><div className="brief-section-heading"><h3>{section.title}</h3>{section.unavailable ? <span>Unavailable</span> : null}</div>{section.items.map((item) => <div className="brief-item" key={item.itemId}><strong>{item.headline}</strong><p>{item.markdown}</p>{item.sourceRefs.length > 0 ? <small>Sources: {item.sourceRefs.join(', ')}</small> : null}</div>)}</article>)}</section> : <div className="notice detail-empty"><strong>Select a brief</strong><p>Choose a persisted brief to inspect its bounded sections and provenance.</p></div>}</div> : <div className="notice"><strong>No persisted Daily Briefs</strong><p>Run Daily Intelligence through the Agent or API to create a brief.</p></div>}</main>
}

const reportTypeLabel: Record<ResearchReportSummary['reportType'], string> = { company_research: 'Company Research', industry_research: 'Industry Research', earnings_review: 'Earnings Review', valuation: 'Valuation', event_research: 'Event Research', thesis_red_team: 'Thesis Red Team', thesis_lifecycle: 'Thesis Lifecycle' }
interface ReportsPageProps { readonly reports?: readonly ResearchReportSummary[]; readonly selected?: ResearchReport; readonly busy: boolean; readonly error: string; readonly onSelect: (reportId: string) => void }
function ReportsPage({ reports, selected, busy, error, onSelect }: ReportsPageProps): ReactElement {
  return <main className="page-frame reports-page" aria-labelledby="reports-title"><div className="page-heading"><div><span className="eyebrow">PERSONAL RESEARCH</span><h1 id="reports-title">Research Reports</h1></div><span className="read-only-badge">Read-only</span></div><p>Browse persisted Company, Industry, Earnings, Valuation, Event, and Thesis reports with bounded provenance kept visible.</p>{error ? <div className="notice" role="alert"><strong>Research Reports unavailable</strong><p>{error}</p></div> : busy ? <p className="muted">Loading Research Reports…</p> : reports && reports.length > 0 ? <div className="reports-layout"><section aria-label="Research Report history"><div className="section-title"><div><span className="eyebrow">HISTORY</span><h2>{reports.length} report{reports.length === 1 ? '' : 's'}</h2></div></div><div className="result-list">{reports.map((report) => <button className={`result-item ${selected?.reportId === report.reportId ? 'selected' : ''}`} key={report.reportId} onClick={() => onSelect(report.reportId)}><span className="result-kind">{reportTypeLabel[report.reportType]}</span><strong>{report.subjectRefs.join(', ')}</strong><span>{report.sectionCount} sections · {report.sourceCount} sources · KB r{report.knowledgeBaseRevision}</span><small>{new Date(report.generatedAt).toLocaleString()} · {report.reportId}</small></button>)}</div></section>{selected ? <section className="report-detail" aria-label="Research Report detail"><div className="detail-title"><div><span className="eyebrow">{reportTypeLabel[selected.reportType]}</span><h2>{selected.reportId}</h2></div><small>KB revision {selected.knowledgeBaseRevision}</small></div><p className="report-methodology">As of {selected.asOf}. {selected.methodology}</p><div className="brief-metrics"><span><b>{selected.sections.length}</b> sections</span><span><b>{selected.sourceRefs.length}</b> sources</span><span><b>{selected.claimRefs.length}</b> claims</span></div><p className="report-refs"><strong>Subjects:</strong> {selected.subjectRefs.join(', ') || 'None'}</p>{selected.sections.map((section) => <article className="brief-section" key={section.id}><div className="brief-section-heading"><h3>{section.title}</h3><span>{section.id}</span></div><p className="report-markdown">{section.markdown}</p>{section.sourceRefs?.length ? <small>Sources: {section.sourceRefs.join(', ')}</small> : null}{section.claimRefs?.length ? <small>Claims: {section.claimRefs.join(', ')}</small> : null}{section.relationRefs?.length ? <small>Relations: {section.relationRefs.join(', ')}</small> : null}</article>)}</section> : <div className="notice detail-empty"><strong>Select a report</strong><p>Choose a persisted report to inspect its bounded sections and provenance.</p></div>}</div> : <div className="notice"><strong>No persisted Research Reports</strong><p>Run a governed research workflow through the Agent or API to create a report.</p></div>}</main>
}

type ResearchBundleDetail = ResearchBundleSummary & { readonly structuredResult: unknown; readonly sourceLibraryHits: readonly SourceLibraryHit[] }
interface ResearchBundlesPageProps { readonly bundles?: readonly ResearchBundleSummary[]; readonly selected?: ResearchBundleDetail; readonly busy: boolean; readonly error: string; readonly onSelect: (bundleId: string) => void; readonly sourceHits: readonly SourceLibraryHit[]; readonly sourceBusy: boolean; readonly onSearchSources: (query: string) => void }
function ResearchBundlesPage({ bundles, selected, busy, error, onSelect, sourceHits, sourceBusy, onSearchSources }: ResearchBundlesPageProps): ReactElement {
  const [sourceQuery, setSourceQuery] = useState('')
  return <main className="page-frame reports-page" aria-labelledby="bundles-title"><div className="page-heading"><div><span className="eyebrow">RESEARCH ARTIFACTS</span><h1 id="bundles-title">Research Bundles</h1></div><span className="read-only-badge">Read-only</span></div><p>Inspect the unified structured result, report/proposal links, and Raw-backed Source Library evidence candidates.</p>{error ? <div className="notice" role="alert"><strong>Research Bundles unavailable</strong><p>{error}</p></div> : busy ? <p className="muted">Loading Research Bundles…</p> : bundles && bundles.length > 0 ? <div className="reports-layout"><section aria-label="Research Bundle history"><div className="section-title"><div><span className="eyebrow">HISTORY</span><h2>{bundles.length} bundle{bundles.length === 1 ? '' : 's'}</h2></div></div><div className="result-list">{bundles.map((bundle) => <button className={`result-item ${selected?.bundleId === bundle.bundleId ? 'selected' : ''}`} key={bundle.bundleId} onClick={() => onSelect(bundle.bundleId)}><strong>{bundle.status}</strong><span>{bundle.proposals.length} proposal{bundle.proposals.length === 1 ? '' : 's'} · {(bundle.sourceLibraryHits ?? []).length} Source Library hit{(bundle.sourceLibraryHits ?? []).length === 1 ? '' : 's'}</span><small>{new Date(bundle.createdAt).toLocaleString()} · {bundle.workflowRunId}</small></button>)}</div></section>{selected ? <section className="report-detail" aria-label="Research Bundle detail"><div className="detail-title"><div><span className="eyebrow">STRUCTURED RESULT</span><h2>{selected.bundleId}</h2></div><small>{selected.status}</small></div><p><strong>Workflow run:</strong> {selected.workflowRunId}</p>{selected.report ? <p><strong>Report:</strong> {selected.report.reportId}</p> : null}<div className="brief-metrics"><span><b>{selected.proposals.length}</b> proposals</span><span><b>{selected.sourceLibraryHits.length}</b> source hits</span></div><article className="brief-section"><div className="brief-section-heading"><h3>Knowledge Proposals</h3><span>derived from bundle</span></div>{selected.proposals.length ? selected.proposals.map((proposal) => <div className="brief-item" key={proposal.proposalId}><strong>{proposal.proposalId}</strong><small>{proposal.kind ?? 'proposal'}</small></div>) : <p className="muted">No proposals recorded.</p>}</article><article className="brief-section"><div className="brief-section-heading"><h3>Source Library Evidence</h3><span>Raw-backed</span></div>{selected.sourceLibraryHits.length ? selected.sourceLibraryHits.map((hit) => <div className="brief-item" key={hit.sourceLibraryRef}><strong>{hit.title}</strong><p>{hit.excerpt}</p><small>{hit.sourceLibraryRef} · Raw {hit.rawRef}</small></div>) : <p className="muted">No Source Library hits were attached to this bundle.</p>}</article><article className="brief-section"><div className="brief-section-heading"><h3>Structured Result</h3><span>bounded preview</span></div><p className="report-markdown">{safeStructured(selected.structuredResult)}</p></article></section> : <div className="notice detail-empty"><strong>Select a ResearchBundle</strong><p>Choose an artifact to inspect its derived outputs and evidence lineage.</p></div>}</div> : <div className="notice"><strong>No persisted Research Bundles</strong><p>Use the Chat Research entry to create a bundle.</p></div>}<section className="context-section" aria-label="Source Library search"><div className="section-title"><div><span className="eyebrow">RAW-BACKED RETRIEVAL</span><h2>Source Library Search</h2></div><span className="read-only-badge">Read-only</span></div><form className="source-search" onSubmit={(event) => { event.preventDefault(); if (sourceQuery.trim()) onSearchSources(sourceQuery.trim()) }}><input aria-label="Source Library query" value={sourceQuery} onChange={(event) => setSourceQuery(event.target.value)} placeholder="Search archived Raw evidence…" /><button className="secondary-action" type="submit" disabled={sourceBusy || !sourceQuery.trim()}>{sourceBusy ? 'Searching…' : 'Search'}</button></form>{sourceHits.length ? <div className="result-list">{sourceHits.map((hit) => <div className="result-item" key={hit.sourceLibraryRef}><strong>{hit.title}</strong><span>{hit.excerpt}</span><small>{hit.sourceLibraryRef} · Raw {hit.rawRef}</small></div>)}</div> : <p className="muted">Search results are evidence candidates only; canonical Knowledge is unchanged.</p>}</section></main>
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
  readonly attachmentBusy: boolean
  readonly workflowRunId: string
  readonly workflow?: WorkflowRun
  readonly knowledgeBase?: KnowledgeBaseStatus
  readonly openReviewCases: number
  readonly contextPanel: ResearchContextPanel
  readonly workflowDefinitions: readonly WorkflowDefinition[]
  readonly selectedWorkflowId: string
  readonly setSelectedWorkflowId: (value: string) => void
  readonly contextPolicy: { readonly structuredKnowledge: boolean; readonly sourceLibrary: boolean }
  readonly persistencePolicy: { readonly writeKnowledge: boolean }
  readonly setContextPolicy: (value: { readonly structuredKnowledge: boolean; readonly sourceLibrary: boolean }) => void
  readonly setPersistencePolicy: (value: { readonly writeKnowledge: boolean }) => void
  readonly executionSummary?: ResearchExecutionSummary
  readonly setComposer: (value: string) => void
  readonly setContextPanel: (value: ResearchContextPanel) => void
  readonly newConversation: () => void
  readonly switchConversation: (conversationId: string) => void
  readonly runCommand: (operation: 'prompt' | 'steer' | 'follow_up') => void
  readonly abort: () => void
  readonly upload: (file: File | undefined) => void
  readonly addToKnowledge: () => void
  readonly cancelWorkflow: () => void
  readonly dismissError: () => void
  readonly onNavigate: (route: Route) => void
}

function ResearchPageBody(props: ResearchPageProps): ReactElement {
  const noKnowledge = !props.knowledgeBase
  return <main className="workspace-grid"><aside className="conversation-rail" aria-label="Conversations"><div className="rail-heading"><div><span className="eyebrow">WORKSPACE</span><h2>Conversations</h2></div><button className="icon-button" aria-label="New conversation" onClick={props.newConversation} disabled={props.busy}>＋</button></div><button className="new-conversation" onClick={props.newConversation} disabled={props.busy}>＋ New conversation</button><div className="history-label">History</div><nav className="conversation-list" aria-label="Conversation history">{props.conversations.map((conversation) => <button className={`conversation-item ${conversation.isActive ? 'active' : ''}`} key={conversation.conversationId} onClick={() => props.switchConversation(conversation.conversationId)} disabled={props.busy}><span>{conversation.name || 'Untitled conversation'}</span><small>{conversation.messageCount} messages</small></button>)}</nav></aside><section className="conversation-pane" aria-label="Conversation"><div className="conversation-heading"><div><span className="eyebrow">AGENT SESSION</span><h1>{props.session?.name || 'Research conversation'}</h1></div><span className={`session-pill ${props.streaming ? 'live' : ''}`}>{props.streaming ? 'Streaming' : 'Idle'}</span></div><div className="messages" aria-live="polite">{props.messages.length === 0 && !props.streaming ? <div className="empty-conversation"><div className="empty-orbit">✦</div><h2>Start with a research question</h2><p>Ask the Agent to explore the research context or help shape your next research step.</p></div> : props.messages.map((message, index) => <article className={`message ${message.role}`} key={`${message.timestamp ?? 'message'}-${index}`}><div className="message-meta">{message.role === 'user' ? 'You' : message.role === 'tool' ? toolLabel(message.toolName) : 'Agent'}{message.timestamp ? <time>{new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time> : null}</div><div className="message-body">{message.role === 'tool' ? <span className="tool-chip">{toolLabel(message.toolName)}</span> : message.content}</div></article>)}{props.streaming ? <article className="message assistant streaming-message"><div className="message-meta">Agent {props.thinking ? <span className="thinking-label">Thinking…</span> : null}</div><div className="message-body">{props.streamText || (props.thinking ? 'Thinking…' : 'Working…')}{props.streamText ? <span className="cursor" /> : null}</div>{props.toolEvents.length > 0 ? <div className="tool-trace">{props.toolEvents.map((item, index) => <span key={`${item}-${index}`}>{item}</span>)}</div> : null}</article> : null}</div>{props.error ? <div className="inline-error" role="alert">{props.error}<button onClick={props.dismissError}>Dismiss</button></div> : null}<div className="composer-wrap"><div className="research-controls" aria-label="Research execution controls"><label><span>Workflow</span><select aria-label="Workflow" value={props.selectedWorkflowId} onChange={(event) => props.setSelectedWorkflowId(event.target.value)}><option value="">Free Research</option>{props.workflowDefinitions.map((workflow) => <option value={workflow.id} key={workflow.id}>{workflow.label}</option>)}</select></label><label className="check-field"><input type="checkbox" checked={props.contextPolicy.structuredKnowledge} onChange={(event) => props.setContextPolicy({ ...props.contextPolicy, structuredKnowledge: event.target.checked })} />Query Knowledge</label><label className="check-field"><input type="checkbox" checked={props.contextPolicy.sourceLibrary} onChange={(event) => props.setContextPolicy({ ...props.contextPolicy, sourceLibrary: event.target.checked })} />Search Source Library</label><label className="check-field"><input type="checkbox" checked={props.persistencePolicy.writeKnowledge} onChange={(event) => props.setPersistencePolicy({ writeKnowledge: event.target.checked })} />Write Knowledge</label></div>{props.executionSummary ? <div className="execution-summary" aria-label="Research execution summary"><strong>{props.executionSummary.mode}{props.executionSummary.workflowLabel ? ` · ${props.executionSummary.workflowLabel}` : ''}</strong><span>Knowledge: {props.executionSummary.contextPolicy.structuredKnowledge ? 'Read' : 'Off'}</span><span>Source Library: {props.executionSummary.contextPolicy.sourceLibrary ? 'Search' : 'Off'}</span><span>Knowledge Write: {props.executionSummary.persistencePolicy.writeKnowledge ? 'On' : 'Off'}</span>{props.executionSummary.argumentsStatus !== 'not_required' ? <span>Arguments: {props.executionSummary.argumentsStatus}</span> : null}</div> : null}<textarea aria-label="Message" value={props.composer} onChange={(event) => props.setComposer(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !props.streaming) { event.preventDefault(); props.runCommand('prompt') } }} placeholder={props.streaming ? 'Write a steering instruction or follow-up…' : 'Ask the Agent anything about your research…'} rows={3} /><div className="composer-footer"><span>Enter to send · Shift+Enter for newline · queued: {props.queue.steering} steer / {props.queue.followUp} follow-up</span><div className="composer-actions">{props.streaming ? <><button className="secondary-action" onClick={() => props.runCommand('steer')} disabled={props.busy || !props.composer.trim()}>Steer</button><button className="secondary-action" onClick={() => props.runCommand('follow_up')} disabled={props.busy || !props.composer.trim()}>Follow up</button><button className="stop-action" onClick={props.abort} disabled={props.busy}>Stop</button></> : <button className="primary-action" onClick={() => props.runCommand('prompt')} disabled={props.busy || !props.composer.trim()}>Send <span>↗</span></button>}</div></div></div></section><aside className="context-rail" aria-label="Research context"><div className="context-heading"><div><span className="eyebrow">RESEARCH CONTEXT</span><span className="context-count">{props.openReviewCases > 0 ? `${props.openReviewCases} review${props.openReviewCases === 1 ? '' : 's'}` : 'Live'}</span></div></div>{noKnowledge ? <div className="notice context-kb-notice"><strong>No Knowledge Base mounted</strong><p>Free Research remains available; Knowledge Production and Reviews require a mounted Knowledge Base.</p></div> : null}<div className="panel-tabs research-tabs"><button className={props.contextPanel === 'attachments' ? 'selected' : ''} onClick={() => props.setContextPanel('attachments')}>Attachments</button><button className={props.contextPanel === 'workflow' ? 'selected' : ''} onClick={() => props.setContextPanel('workflow')}>Workflow</button><button className={props.contextPanel === 'review' ? 'selected' : ''} onClick={() => props.setContextPanel('review')}>Review{props.openReviewCases > 0 ? <b>{props.openReviewCases}</b> : null}</button></div><div className="context-content">{props.contextPanel === 'attachments' ? <section className="context-section"><div className="section-title"><div><span className="eyebrow">SOURCE MATERIAL</span><h2>Attachments</h2></div></div><label className="drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); props.upload(event.dataTransfer.files[0]) }}><input type="file" onChange={(event) => props.upload(event.target.files?.[0])} /><span className="drop-icon">↑</span><strong>{props.attachmentBusy ? 'Uploading…' : 'Upload a document'}</strong><small>Drag and drop or choose a file</small></label>{props.attachment ? <div className="attachment-card"><div className="file-icon">DOC</div><div className="attachment-info"><strong>{props.attachment.filename}</strong><span>{props.attachment.mediaType} · {formatSize(props.attachment.size)}</span><small>SHA-256 {shortHash(props.attachment.sha256)}</small><small>{new Date(props.attachment.createdAt).toLocaleString()}</small></div><button className="primary-action compact" onClick={props.addToKnowledge} disabled={props.busy || noKnowledge}>Add to Knowledge</button>{noKnowledge ? <small className="muted">Requires a mounted Knowledge Base</small> : null}</div> : <p className="muted">Uploads are kept outside canonical Knowledge until you explicitly add one.</p>}</section> : null}{props.contextPanel === 'workflow' ? <section className="context-section"><div className="section-title"><div><span className="eyebrow">PRODUCTION</span><h2>Workflow</h2></div></div>{!props.workflowRunId ? <div className="notice"><strong>No active Workflow</strong><p>Use Add to Knowledge on an uploaded attachment to start governed production.</p></div> : props.workflow ? <div className="workflow-card"><div className="workflow-status"><span className={`status-dot ${terminalWorkflowStatuses.has(props.workflow.status) ? 'terminal' : ''}`} />{props.workflow.status.replaceAll('_', ' ')}</div><h3>{props.workflow.objective}</h3><dl><dt>Stage</dt><dd>{props.workflow.currentStage || 'Not reported'}</dd><dt>Progress</dt><dd>{props.workflow.progressSummary || 'Not reported'}</dd>{props.workflow.reviewCount !== undefined ? <><dt>Reviews</dt><dd>{props.workflow.reviewCount}</dd></> : null}</dl>{props.workflow.errorSummary ? <div className="inline-error">{props.workflow.errorSummary}</div> : null}{props.workflow.status === 'completed_with_review' && (props.workflow.reviewCount ?? 0) > 0 ? <button className="secondary-action full" onClick={() => props.onNavigate('reviews')}>View Reviews</button> : null}{!terminalWorkflowStatuses.has(props.workflow.status) ? <button className="stop-action full" onClick={props.cancelWorkflow} disabled={props.busy}>Cancel Workflow</button> : null}</div> : <p className="muted">Loading Workflow status…</p>}</section> : null}{props.contextPanel === 'review' ? <section className="context-section"><div className="section-title"><div><span className="eyebrow">GOVERNANCE</span><h2>Reviews</h2></div><span className="rail-badge">Read-only</span></div><div className="notice"><strong>{props.openReviewCases > 0 ? `${props.openReviewCases} items need review` : 'No open Review cases'}</strong><p>{noKnowledge ? 'No Knowledge Base mounted.' : 'Open the Review Inbox to inspect actionable cases.'}</p>{props.openReviewCases > 0 ? <button className="secondary-action full" onClick={() => props.onNavigate('reviews')}>View Reviews</button> : null}</div></section> : null}</div></aside></main>
}

function ResearchPage(props: ResearchPageProps): ReactElement { return <><DailyBriefCard /><ResearchPageBody {...props} /></> }

export default function App(): ReactElement {
  const client = useMemo(() => new RuntimeClient(), [])
  const [route, setRoute] = useState<Route>(() => routeForPath(window.location.pathname))
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [loadError, setLoadError] = useState('')
  const [session, setSession] = useState<SessionState>()
  const [conversations, setConversations] = useState<readonly ConversationSummary[]>([])
  const [messages, setMessages] = useState<readonly ConversationMessage[]>([])
  const [knowledgeBase, setKnowledgeBase] = useState<KnowledgeBaseStatus>()
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
  const [workflowRunId, setWorkflowRunId] = useState('')
  const [workflow, setWorkflow] = useState<WorkflowRun>()
  const [contextPanel, setContextPanel] = useState<ResearchContextPanel>('attachments')
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
  const latestConversation = useRef('')
  const workflowRef = useRef<WorkflowRun | undefined>(undefined)
  workflowRef.current = workflow

  const syncCurrent = useCallback(async (): Promise<void> => {
    const [current, messageResult, list] = await Promise.all([client.currentSession(), client.messages(), client.listConversations()])
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
        const [bootstrap, definitions] = await Promise.all([client.bootstrap(), client.listWorkflowDefinitions()])
        if (cancelled) return
        setWorkflowDefinitions(definitions)
        setSession(bootstrap.session); latestConversation.current = bootstrap.session.conversationId; setConversations(bootstrap.conversations); setKnowledgeBase(bootstrap.knowledgeBase); setOpenReviewCases(bootstrap.openReviewCases ?? 0)
        await syncCurrent()
        if (!cancelled) setLoadState('ready')
      } catch (caught) { if (!cancelled) { setLoadError(errorText(caught)); setLoadState('error') } }
    })()
    return () => { cancelled = true; client.clearToken() }
  }, [client, syncCurrent])

  useEffect(() => {
    if (loadState !== 'ready' || route !== 'reviews' || !knowledgeBase) { setReviews(undefined); setReviewDetail(undefined); return }
    setReviewsBusy(true)
    void client.listReviews().then(setReviews).catch((caught) => setError(errorText(caught))).finally(() => setReviewsBusy(false))
  }, [client, knowledgeBase, loadState, route])

  useEffect(() => {
    if (loadState !== 'ready' || route !== 'bundles') { setBundles(undefined); setSelectedBundle(undefined); setSourceHits([]); return }
    setBundlesBusy(true); setError('')
    void client.listResearchBundles(20).then((items) => { setBundles(items); setSelectedBundle(undefined) }).catch((caught) => setError(errorText(caught))).finally(() => setBundlesBusy(false))
  }, [client, loadState, route])

  useEffect(() => {
    if (loadState !== 'ready' || route !== 'briefs') { setBriefs(undefined); setSelectedBrief(undefined); return }
    setBriefsBusy(true); setError('')
    void client.listDailyBriefs(20).then((items) => { setBriefs(items); setSelectedBrief(undefined) }).catch((caught) => setError(errorText(caught))).finally(() => setBriefsBusy(false))
  }, [client, loadState, route])

  useEffect(() => {
    if (loadState !== 'ready' || route !== 'reports') { setReports(undefined); setSelectedReport(undefined); return }
    setReportsBusy(true); setError('')
    void client.listResearchReports(20).then((items) => { setReports(items); setSelectedReport(undefined) }).catch((caught) => setError(errorText(caught))).finally(() => setReportsBusy(false))
  }, [client, loadState, route])

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
    if (!workflowRunId || !knowledgeBase || (knownWorkflow?.runId === workflowRunId && terminalWorkflowStatuses.has(knownWorkflow.status))) return undefined
    return startWorkflowPolling({ runId: workflowRunId, fetchWorkflow: (runId) => client.workflow(runId), onUpdate: setWorkflow, onError: (caught) => setError(errorText(caught)) })
  }, [client, knowledgeBase, workflowRunId])

  const runCommand = async (operation: 'prompt' | 'steer' | 'follow_up'): Promise<void> => { const text = composer.trim(); if (!text || busy || (operation === 'prompt' && streaming)) return; setBusy(true); setError(''); try { if (operation === 'prompt') { const result: ResearchDispatchResponse = await client.dispatchResearch({ query: text, mode: selectedWorkflowId ? { type: 'workflow', workflowId: selectedWorkflowId } : { type: 'free_research' }, contextPolicy, persistencePolicy }); setExecutionSummary(result.summary); if (result.status === 'started') { setWorkflowRunId(result.runId ?? ''); setWorkflow(result.workflow as WorkflowRun | undefined); setContextPanel('workflow') } else { await client.command('prompt', text, { researchBundleId: result.runId, researchPolicy: { contextPolicy, persistencePolicy } }); setStreaming(true); setThinking(false); setStreamText(''); setToolEvents([]) } } else { await client.command(operation, text); setStreaming(true); setThinking(false); setStreamText(''); setToolEvents([]) } setComposer('') } catch (caught) { setError(errorText(caught)) } finally { setBusy(false) } }
  const abort = async (): Promise<void> => { setBusy(true); setError(''); try { await client.abort(); setStreaming(false); await syncCurrent() } catch (caught) { setError(errorText(caught)) } finally { setBusy(false) } }
  const newConversation = async (): Promise<void> => { setBusy(true); setError(''); try { await client.newConversation(); setStreaming(false); setStreamText(''); await syncCurrent() } catch (caught) { setError(errorText(caught)) } finally { setBusy(false) } }
  const switchConversation = async (conversationId: string): Promise<void> => { if (conversationId === session?.conversationId || busy) return; setBusy(true); setError(''); setStreaming(false); setStreamText(''); setThinking(false); setToolEvents([]); try { await client.switchConversation(conversationId); await syncCurrent() } catch (caught) { setError(errorText(caught)) } finally { setBusy(false) } }
  const upload = async (file: File | undefined): Promise<void> => { if (!file) return; setAttachmentBusy(true); setError(''); try { setAttachment(await client.uploadAttachment(file)) } catch (caught) { setError(errorText(caught)) } finally { setAttachmentBusy(false) } }
  const addToKnowledge = async (): Promise<void> => { if (!attachment || !knowledgeBase) return; setBusy(true); setError(''); try { const result = await client.startProduction(attachment.attachmentId); setWorkflowRunId(result.runId); setWorkflow(result.workflow); setContextPanel('workflow') } catch (caught) { setError(errorText(caught)) } finally { setBusy(false) } }
  const cancelWorkflow = async (): Promise<void> => { if (!workflowRunId) return; setBusy(true); try { await client.cancelWorkflow(workflowRunId); setWorkflow(await client.workflow(workflowRunId)) } catch (caught) { setError(errorText(caught)) } finally { setBusy(false) } }
  const selectReview = async (reviewCaseId: string): Promise<void> => { try { setReviewDetail(await client.getReview(reviewCaseId)) } catch (caught) { setError(errorText(caught)) } }
  const selectBrief = async (reportId: string): Promise<void> => { try { setSelectedBrief(await client.getDailyBrief(reportId)) } catch (caught) { setError(errorText(caught)) } }
  const selectReport = async (reportId: string): Promise<void> => { try { setSelectedReport(await client.getResearchReport(reportId)) } catch (caught) { setError(errorText(caught)) } }
  const selectBundle = async (bundleId: string): Promise<void> => { try { setSelectedBundle(await client.getResearchBundle(bundleId)) } catch (caught) { setError(errorText(caught)) } }
  const searchSources = async (query: string): Promise<void> => { setSourceBusy(true); setError(''); try { const result = await client.searchSourceLibrary(query, true); setSourceHits(result.hits) } catch (caught) { setError(errorText(caught)) } finally { setSourceBusy(false) } }

  if (loadState === 'loading') return <main className="state-screen"><div className="state-card"><span className="eyebrow">RESEARCHHUB RUNTIME</span><h1>Loading workspace</h1><p>Connecting to the local application runtime…</p><div className="loader" /></div></main>
  if (loadState === 'error') return <main className="state-screen"><div className="state-card"><span className="eyebrow">RUNTIME UNAVAILABLE</span><h1>ResearchHub could not start</h1><p>{loadError}</p><button onClick={() => window.location.reload()}>Reload page</button></div></main>
  return <div className="app-shell"><TopBar route={route} knowledgeBase={knowledgeBase} onNavigate={navigate} />{route === 'research' ? <ResearchPage session={session} conversations={conversations} messages={messages} streaming={streaming} thinking={thinking} streamText={streamText} toolEvents={toolEvents} queue={queue} composer={composer} busy={busy} error={error} attachment={attachment} attachmentBusy={attachmentBusy} workflowRunId={workflowRunId} workflow={workflow} knowledgeBase={knowledgeBase} openReviewCases={openReviewCases} contextPanel={contextPanel} workflowDefinitions={workflowDefinitions} selectedWorkflowId={selectedWorkflowId} setSelectedWorkflowId={setSelectedWorkflowId} contextPolicy={contextPolicy} persistencePolicy={persistencePolicy} setContextPolicy={setContextPolicy} setPersistencePolicy={setPersistencePolicy} executionSummary={executionSummary} setComposer={setComposer} setContextPanel={setContextPanel} newConversation={() => void newConversation()} switchConversation={(id) => void switchConversation(id)} runCommand={(operation) => void runCommand(operation)} abort={() => void abort()} upload={(file) => void upload(file)} addToKnowledge={() => void addToKnowledge()} cancelWorkflow={() => void cancelWorkflow()} dismissError={() => setError('')} onNavigate={navigate} /> : route === 'briefs' ? <BriefsPage briefs={briefs} selected={selectedBrief} busy={briefsBusy} error={error} onSelect={(id) => void selectBrief(id)} /> : route === 'reports' ? <ReportsPage reports={reports} selected={selectedReport} busy={reportsBusy} error={error} onSelect={(id) => void selectReport(id)} /> : route === 'bundles' ? <ResearchBundlesPage bundles={bundles} selected={selectedBundle} busy={bundlesBusy} error={error} onSelect={(id) => void selectBundle(id)} sourceHits={sourceHits} sourceBusy={sourceBusy} onSearchSources={(query) => void searchSources(query)} /> : route === 'run' ? <ResearchRunPage client={client} onLaunched={onResearchLaunched} /> : route === 'graph' ? <KnowledgeGraphPage knowledgeBase={knowledgeBase} client={client} /> : route === 'theses' ? <ThesisLifecyclePage client={client} knowledgeBase={knowledgeBase} /> : <ReviewsPage knowledgeBase={knowledgeBase} reviews={reviews} reviewDetail={reviewDetail} reviewsBusy={reviewsBusy} onSelect={(id) => void selectReview(id)} onCloseDetail={() => setReviewDetail(undefined)} />}</div>
}
