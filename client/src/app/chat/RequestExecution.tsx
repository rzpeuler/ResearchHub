import { useEffect, useState } from 'react'
import type { ConversationActivity, RuntimeClient, WorkflowRun } from '../../api/runtime-client'
import { useLanguage } from '../../i18n'
import { isWorkflowFinalResultSynchronized, terminalWorkflowStatuses } from '../workflow-polling'

function statusLabel(status: string, t: (zh: string, en: string) => string): string {
  const labels: Record<string, [string, string]> = { pending: ['等待开始', 'Pending'], started: ['已开始', 'Started'], updated: ['执行中', 'Running'], running: ['执行中', 'Running'], completed: ['已完成', 'Completed'], completed_with_review: ['完成，待审核', 'Completed, review required'], failed: ['失败', 'Failed'], blocked: ['存在阻塞', 'Blocked'], timeout: ['超时', 'Timed out'], cancelled: ['已取消', 'Cancelled'], interrupted: ['已中断', 'Interrupted'], success: ['成功', 'Successful'], partial: ['部分可用', 'Partially available'], unavailable: ['不可用', 'Unavailable'], skipped: ['已跳过', 'Skipped'] }
  return labels[status] ? t(...labels[status]!) : status
}
function workflowLabel(id: string, t: (zh: string, en: string) => string): string {
  const labels: Record<string, [string, string]> = { company_research: ['公司深度研究', 'Company research'], research_company: ['公司研究', 'Company research'], industry_research: ['行业深度研究', 'Industry research'], research_industry: ['行业研究', 'Industry research'], earnings_review: ['财报复盘', 'Earnings review'], event_research: ['事件研究', 'Event research'], valuation_analysis: ['估值分析', 'Valuation analysis'], thesis_red_team: ['投资命题压力测试', 'Thesis review'], search_knowledge: ['知识查询', 'Knowledge search'] }
  return labels[id] ? t(...labels[id]!) : t('研究任务', 'Research task')
}
function matchLabel(kind: string, t: (zh: string, en: string) => string): string {
  if (/initial/i.test(kind)) return t('拼音首字母', 'Pinyin initials')
  if (/pinyin|full拼|full_spell/.test(kind)) return t('全拼', 'Full pinyin')
  if (/code|symbol/.test(kind)) return t('证券代码', 'Security code')
  if (/alias/.test(kind)) return t('名称别名', 'Name alias')
  if (/exact|name/.test(kind)) return t('证券名称', 'Security name')
  return t('名称匹配', 'Name match')
}
export function ResolutionDiagnostics({ resolution }: { resolution: NonNullable<ConversationActivity['resolution']> }) {
  const { t } = useLanguage()
  const labels: Record<string, [string, string]> = { model_call: ['模型调用失败', 'Model call failed'], model_timeout: ['模型响应超时', 'Model response timed out'], timeout: ['模型响应超时', 'Model response timed out'], json_parse: ['模型返回内容无法解析', 'Model response could not be parsed'], semantic_decision: ['模型识别结果缺少有效研究意图', 'Model decision lacks a valid research intent'], workflow_input: ['识别出的工作流参数未通过校验', 'Resolved Workflow arguments failed validation'], security_identity: ['证券身份未能验证', 'Security identity could not be verified'] }
  return <>{resolution.attemptErrors?.map((error) => <div key={`${error.attempt}:${error.code}`}><p>{t('识别尝试', 'Resolution attempt')} {error.attempt} · {labels[error.category] ? t(...labels[error.category]!) : t('意图识别未完成', 'Intent resolution did not complete')}</p><details><summary>{t('技术诊断', 'Technical diagnostic')}</summary><small>{error.category} · {error.code}{error.fieldPaths.length ? ` · ${error.fieldPaths.join(', ')}` : ''}</small></details></div>)}</>
}
export type OpenResearchArtifact = (kind: 'report' | 'bundle' | 'review_case' | 'theme_framework_candidate' | 'daily_brief', id: string, runId: string) => void
export function RequestExecution({ activity, client, onChanged, onOpenArtifact, showWorkflow = true }: { activity: ConversationActivity; client?: RuntimeClient; onChanged?: () => void; onOpenArtifact?: OpenResearchArtifact; showWorkflow?: boolean }) {
  const { t } = useLanguage()
  const [page, setPage] = useState(0)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const clarification = activity.clarification
  useEffect(() => { setPage(0); setText(''); setError('') }, [clarification?.confirmationId])
  const confirm = async (candidateId?: string) => {
    if (!client || !clarification || busy) return
    setBusy(true); setError('')
    try {
      await client.confirmResearch({ conversationId: activity.conversationId, operationId: activity.operationId, confirmationId: clarification.confirmationId, ...(candidateId ? { candidateId } : { clarificationText: text.trim() }), ...(clarification.directoryVersion ? { directoryVersion: clarification.directoryVersion } : {}) })
      onChanged?.()
    } catch (caught) { setError(caught instanceof Error ? caught.message : t('确认失败，请重试', 'Confirmation failed. Retry.')) }
    finally { setBusy(false) }
  }
  return <section className="request-execution" aria-label={t('请求执行详情', 'Request execution details')}>
    {activity.failureCode ? <div role="alert">{t('请求失败：', 'Request failed: ')}{t('请查看本请求的诊断记录，或重试。', 'Review this request’s diagnostics or retry.')}<details><summary>{t('技术诊断', 'Technical diagnostic')}</summary>{activity.failureCode}</details></div> : null}
    {activity.dispatchFeedback ? <div role="status"><strong>{activity.dispatchFeedback.reason}</strong><p>{activity.dispatchFeedback.suggestedQuestion}</p></div> : null}
    {(activity.resolution ?? activity.dispatchResolution) ? <ResolutionDiagnostics resolution={(activity.resolution ?? activity.dispatchResolution)!} /> : null}
    {clarification ? <div className="clarification-card"><strong>{clarification.question}</strong>
      {clarification.directoryTimestamp ? <p>{t('证券目录时间：', 'Security directory: ')}{clarification.directoryTimestamp}</p> : null}
      {clarification.candidates.length ? <><p>{clarification.candidates.length} {t('个匹配对象', 'matching securities')}</p><div className="security-candidates">{clarification.candidates.slice(page * 10, (page + 1) * 10).map((candidate) => <button type="button" key={candidate.candidateId} aria-label={`${candidate.name} ${candidate.symbol} ${candidate.exchange} ${matchLabel(candidate.matchKind, t)}`} disabled={busy || !client} onClick={() => void confirm(candidate.candidateId)}><strong>{candidate.name}</strong><span>{candidate.symbol} · {candidate.exchange} · {matchLabel(candidate.matchKind, t)}</span></button>)}</div>{clarification.candidates.length > 10 ? <nav aria-label={t('候选对象分页', 'Candidate pages')}><button type="button" disabled={page === 0 || busy} onClick={() => setPage(page - 1)}>{t('上一页', 'Previous')}</button><span>{page + 1} / {Math.ceil(clarification.candidates.length / 10)}</span><button type="button" disabled={(page + 1) * 10 >= clarification.candidates.length || busy} onClick={() => setPage(page + 1)}>{t('下一页', 'Next')}</button></nav> : null}</> : <form onSubmit={(event) => { event.preventDefault(); void confirm() }}><label>{t('补充研究目标或信息', 'Additional research goal or information')}<input value={text} onChange={(event) => setText(event.target.value)} disabled={busy} /></label><button type="submit" disabled={busy || !client || !text.trim()}>{t('继续研究', 'Continue research')}</button></form>}
      {clarification.candidates.length ? <form onSubmit={(event) => { event.preventDefault(); void confirm() }}><label>{t('更换研究对象', 'Change research object')}<input value={text} onChange={(event) => setText(event.target.value)} disabled={busy} /></label><button type="submit" disabled={busy || !client || !text.trim()}>{t('重新匹配', 'Find another object')}</button></form> : null}{error ? <p role="alert">{error}</p> : null}</div> : null}
    {showWorkflow && client && (activity.linkedWorkflows?.length || activity.workflowRunId) ? <LinkedWorkflowPanel client={client} activities={[activity]} streaming={activity.status !== 'cancelled' && activity.status !== 'completed'} onOpenArtifact={onOpenArtifact} /> : null}
    {activity.toolActivities?.length ? <details open><summary>{t('工具活动', 'Tool activity')}</summary>{activity.toolActivities.map((tool) => <p key={tool.toolCallId}>{workflowLabel(tool.name, t)} · {statusLabel(tool.status, t)}{tool.summary ? ` · ${tool.summary}` : ''}</p>)}</details> : null}
  </section>
}

export function LinkedWorkflowPanel({ client, activities, streaming, onOpenArtifact, presentation = 'conversation', onRunUpdate, onStatusError, retryStatusSyncToken = 0 }: { client: RuntimeClient; activities: readonly ConversationActivity[]; streaming: boolean; onOpenArtifact?: OpenResearchArtifact; presentation?: 'conversation' | 'sidebar'; onRunUpdate?: (run: WorkflowRun) => void; onStatusError?: (runId: string, error?: string) => void; retryStatusSyncToken?: number }) {
  const { t } = useLanguage()
  const [runs, setRuns] = useState<Record<string, WorkflowRun>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [canceling, setCanceling] = useState('')
  const [clock, setClock] = useState(Date.now())
  const linked = [...new Map(activities.flatMap((activity) => activity.linkedWorkflows ?? (activity.workflowRunId ? [{ runId: activity.workflowRunId, workflowRegistryId: activity.workflowRegistryId ?? '', subject: activity.workflowSubject }] : [])).map((item) => [item.runId, item])).values()]
  const key = linked.map((item) => item.runId).sort().join('|')
  useEffect(() => {
    let active = true
    const synchronized = new Set<string>()
    const load = async () => { await Promise.all(key.split('|').filter(Boolean).map(async (runId) => {
      if (synchronized.has(runId)) return
      try { const run = await client.workflow(runId); if (isWorkflowFinalResultSynchronized(run)) synchronized.add(runId); if (active && run.runId === runId) { setRuns((previous) => ({ ...previous, [runId]: run })); setErrors((previous) => ({ ...previous, [runId]: '' })); onRunUpdate?.(run); onStatusError?.(runId) } }
      catch (caught) { if (active) { const error = caught instanceof Error ? caught.message : 'Status unavailable'; setErrors((previous) => ({ ...previous, [runId]: error })); onStatusError?.(runId, error) } }
    })) }
    void load()
    const timer = window.setInterval(() => { setClock(Date.now()); void load() }, 1500)
    return () => { active = false; window.clearInterval(timer) }
  }, [client, key, retryStatusSyncToken])
  const cancel = async (runId: string) => { setCanceling(runId); try { await client.cancelWorkflow(runId); const run = await client.workflow(runId); setRuns((previous) => ({ ...previous, [runId]: run })) } catch (caught) { setErrors((previous) => ({ ...previous, [runId]: caught instanceof Error ? caught.message : 'Cancellation unavailable' })) } finally { setCanceling('') } }
  const detached = !streaming && activities.some((activity) => activity.status === 'cancelled' && (activity.linkedWorkflows ?? []).some((link) => runs[link.runId] && !terminalWorkflowStatuses.has(runs[link.runId]!.status)))
  const labels = { discovery: t('发现来源', 'Source discovery'), download: t('下载', 'Download'), body_read: t('读取正文', 'Read body'), parsing: t('解析', 'Parse'), structured_data: t('结构化数据', 'Structured data') }
  const cards = linked.map((link) => { const run = runs[link.runId]; return <article key={link.runId} className="linked-workflow-card"><strong>{link.subject ?? workflowLabel(link.workflowRegistryId, t)}</strong><small>{link.runId}</small>{errors[link.runId] ? <p role="alert">{errors[link.runId]}</p> : null}{run ? <>{presentation === 'sidebar' ? <><p>{statusLabel(run.status, t)}{run.currentStage ? ` · ${run.currentStage}` : ''}</p>{run.progressSummary ? <p>{run.progressSummary}</p> : null}</> : <><p>{statusLabel(run.status, t)} · {run.currentStage ?? run.currentStageId ?? ''} · {Math.max(0, Math.floor(((run.completedAt ? Date.parse(run.completedAt) : clock) - Date.parse(run.startedAt)) / 1000))}s</p>{run.progressSummary ? <p>{run.progressSummary}</p> : null}{run.errorSummary ? <p role="alert">{run.errorSummary}</p> : null}{run.stages?.length ? <details><summary>{t('阶段记录', 'Stage history')}</summary>{run.stages.map((stage) => <p key={stage.stageId}>{stage.label} · {statusLabel(stage.status, t)}{stage.summary ? ` · ${stage.summary}` : ''}</p>)}</details> : null}{run.acquisitionActivities?.length ? <details open><summary>{t('数据获取过程', 'Data acquisition')}</summary>{run.acquisitionActivities.map((step) => <p key={step.activityId}>{labels[step.step]} · {step.providerId}{step.sourceTitle ? ` · ${step.sourceTitle}` : ''} · {statusLabel(step.status, t)} · {Math.max(0, Math.floor(((step.completedAt ? Date.parse(step.completedAt) : clock) - Date.parse(step.startedAt)) / 1000))}s{step.diagnosticCode ? ` · ${step.diagnosticCode}` : ''}</p>)}</details> : null}{run.providerObservations?.map((provider) => <p key={provider.providerId}>{provider.label} · {statusLabel(provider.status, t)}</p>)}{run.executionResult ? <p>{t('执行结果：', 'Execution result: ')}{run.executionResult.summary ?? run.executionResult.executionStatus}{run.executionResult.blockedReason ? ` · ${run.executionResult.blockedReason}` : ''}</p> : null}{onOpenArtifact && run.executionResult?.runId === run.runId ? <div className="workflow-artifact-actions">{run.executionResult.reportRef ? <button type="button" onClick={() => onOpenArtifact('report', run.executionResult!.reportRef!, run.runId)}>{t('查看报告', 'View report')}</button> : null}{run.executionResult.bundleRef && run.executionResult.bundleStatus === 'available' ? <button type="button" onClick={() => onOpenArtifact('bundle', run.executionResult!.bundleRef!, run.runId)}>{t('查看研究资料包', 'View research bundle')}</button> : null}{run.executionResult.reviewRef ? <button type="button" onClick={() => onOpenArtifact(run.executionResult!.reviewRef!.kind, run.executionResult!.reviewRef!.id, run.runId)}>{t('查看审核', 'View review')}</button> : null}</div> : null}</>}{!terminalWorkflowStatuses.has(run.status) ? <button type="button" className="stop-action" disabled={Boolean(canceling)} onClick={() => void cancel(link.runId)}>{t('取消此研究任务', 'Cancel this research task')}</button> : null}</> : <p>{t('正在同步任务状态…', 'Synchronizing task status…')}</p>}</article> })
  return presentation === 'conversation' ? <article className="message assistant workflow-result-message" aria-label={t('Agent 研究执行结果', 'Agent research execution result')}><div className="message-meta">Agent · {t('研究执行', 'Research execution')}</div><div className="message-body"><section className="linked-workflow-panel" aria-label={t('关联研究任务', 'Linked research tasks')}>{detached ? <p role="status">{t('Agent 已停止，研究任务仍在运行。', 'Agent stopped. Research tasks are still running.')}</p> : null}{cards}</section></div></article> : <section className="linked-workflow-panel" aria-label={t('关联研究任务', 'Linked research tasks')}>{detached ? <p role="status">{t('Agent 已停止，研究任务仍在运行。', 'Agent stopped. Research tasks are still running.')}</p> : null}{cards}</section>
}
