import type { ReactElement } from 'react'
import type { WorkflowRun, WorkflowStageView } from '../../api/runtime-client'
import { useLanguage } from '../../i18n'
import './workflow-node-graph.css'

interface WorkflowNodeGraphProps {
  readonly workflow: WorkflowRun
  readonly statusLabel: (status: string) => string
  readonly stageDuration: (stage: WorkflowStageView) => string
  readonly duration: (start?: string, end?: string, provided?: number) => string
}

type NodeState = 'pending' | 'running' | 'completed' | 'completed_with_review' | 'skipped' | 'failed' | 'blocked' | 'cancelled' | 'interrupted' | 'not_started' | 'unreported'

interface WorkflowNodeDefinition {
  readonly id: string
  readonly label: readonly [string, string]
}

const COMPANY_RESEARCH_NODES: readonly WorkflowNodeDefinition[] = [
  { id: 'identity_validation', label: ['研究对象校验', 'Identity validation'] },
  { id: 'data_acquisition', label: ['数据获取', 'Data acquisition'] },
  { id: 'research_synthesis', label: ['研究综合分析', 'Research synthesis'] },
  { id: 'quality_gate', label: ['证据质量门', 'Evidence quality gate'] },
  { id: 'knowledge_gateway', label: ['Knowledge Gateway', 'Knowledge Gateway'] },
  { id: 'report_generation', label: ['研究报告生成', 'Report generation'] },
  { id: 'report_persistence', label: ['报告保存', 'Report persistence'] },
]

function isCompanyResearch(workflow: WorkflowRun): boolean {
  return workflow.workflowType === 'company_research' || workflow.executionResult?.workflowId === 'company_research'
}

function missingNodeState(workflow: WorkflowRun, index: number, lastObservedIndex: number): NodeState {
  if (workflow.observationSource === 'historical') return 'unreported'
  if (workflow.status === 'pending') return 'pending'
  if (workflow.status === 'running') return index > lastObservedIndex ? 'pending' : 'unreported'
  return 'not_started'
}

function stateLabel(state: NodeState, statusLabel: (status: string) => string, t: (zh: string, en: string) => string): string {
  if (state === 'not_started') return t('未进入', 'Not entered')
  if (state === 'unreported') return t('运行时未报告', 'Not reported by runtime')
  return statusLabel(state)
}

function providerStatus(status: string, statusLabel: (status: string) => string, t: (zh: string, en: string) => string): string {
  return status === 'failed' ? t('失败', 'Failed')
    : status === 'partial' ? t('部分可用', 'Partial')
      : status === 'success' ? t('成功', 'Success')
        : status === 'unavailable' ? t('不可用', 'Unavailable')
          : statusLabel(status)
}

export function WorkflowNodeGraph({ workflow, statusLabel, stageDuration, duration }: WorkflowNodeGraphProps): ReactElement {
  const { t } = useLanguage()
  const companyResearch = isCompanyResearch(workflow)
  const stages = workflow.stages ?? []
  const stageMap = new Map(stages.map((stage) => [stage.stageId, stage]))
  const knownCompanyStageIds = new Set(COMPANY_RESEARCH_NODES.map((node) => node.id))
  const extraReportedStages = companyResearch ? stages.filter((stage) => !knownCompanyStageIds.has(stage.stageId)) : []
  const nodes: readonly WorkflowNodeDefinition[] = companyResearch
    ? [...COMPANY_RESEARCH_NODES, ...extraReportedStages.map((stage) => ({ id: stage.stageId, label: [stage.label, stage.label] as const }))]
    : stages.map((stage) => ({ id: stage.stageId, label: [stage.label, stage.label] as const }))
  const lastObservedIndex = companyResearch
    ? Math.max(-1, ...stages.map((stage) => COMPANY_RESEARCH_NODES.findIndex((node) => node.id === stage.stageId)))
    : nodes.length - 1
  const providers = workflow.providerObservations ?? []
  const skills = workflow.skillObservations ?? []
  const activeAcquisitionActivities = (workflow.acquisitionActivities ?? []).filter((activity) => activity.status === 'running').slice(-3)

  return <section className="workflow-node-graph" data-testid="workflow-node-graph" aria-label={t('Workflow 节点图', 'Workflow node graph')}>
    <header className="workflow-node-graph-heading">
      <h4>{t('执行节点', 'Execution nodes')}</h4>
      {companyResearch ? <span>{t('公司研究 · 7 个真实阶段', 'Company research · 7 observed stages')}</span> : <span>{t('Runtime 已报告节点', 'Runtime-reported nodes')}</span>}
    </header>
    {nodes.length === 0
      ? <p className="workflow-node-graph-empty">{t('该 Workflow 暂无细分节点观测，仅展示整体运行状态。', 'This Workflow has no detailed node observations; only its overall status is available.')}</p>
      : <ol className="workflow-node-list">{nodes.map((node, index) => {
        const stage = stageMap.get(node.id)
        const state: NodeState = stage?.status ?? (companyResearch ? missingNodeState(workflow, index, lastObservedIndex) : 'unreported')
        const nestedProviders = node.id === 'data_acquisition' ? providers : []
        const nestedSkills = node.id === 'research_synthesis' ? skills : []
        const runningActivities = node.id === 'data_acquisition' ? activeAcquisitionActivities : []
        return <li key={node.id} className={`workflow-node workflow-node-${state}`} data-node-id={node.id} data-node-state={state} aria-current={state === 'running' ? 'step' : undefined}>
          <span className="workflow-node-connector" aria-hidden="true" />
          <span className="workflow-node-marker" aria-hidden="true">{state === 'completed' ? '✓' : state === 'failed' || state === 'blocked' ? '!' : state === 'running' ? '•' : ''}</span>
          <div className="workflow-node-body">
            <div className="workflow-node-title-row"><strong>{t(...node.label)}</strong><span>{stateLabel(state, statusLabel, t)}</span></div>
            {stage ? <div className="workflow-node-meta">{stageDuration(stage)}{stage.summary ? ` · ${stage.summary}` : ''}</div> : companyResearch && state === 'pending' ? <div className="workflow-node-meta">{t('等待前序节点完成', 'Waiting for earlier nodes')}</div> : null}
            {stage?.diagnostics?.length ? <div className="workflow-node-diagnostics">{stage.diagnostics.join(' · ')}</div> : null}
            {runningActivities.map((activity) => <div className="workflow-node-subtask is-running" key={activity.activityId}><i aria-hidden="true" />{activity.providerId} · {activity.sourceTitle || t('正在获取资料', 'Acquiring source')} · {t('进行中', 'Running')}</div>)}
            {nestedProviders.map((provider) => <div className={`workflow-node-subtask workflow-node-provider workflow-node-provider-${provider.status}`} key={provider.providerId}><i aria-hidden="true" /><strong>{provider.label}</strong><span>{providerStatus(provider.status, statusLabel, t)}</span>{provider.recordCount !== undefined ? <small>{t('资料', 'records')} {provider.recordCount}</small> : null}{provider.durationMs !== undefined ? <small>{duration(provider.startedAt, provider.completedAt, provider.durationMs)}</small> : null}{provider.diagnostics.length ? <small>{provider.diagnostics.join(' · ')}</small> : null}</div>)}
            {nestedSkills.map((skill) => <div className={`workflow-node-subtask workflow-node-skill workflow-node-skill-${skill.status}`} key={skill.skillId}><i aria-hidden="true" /><strong>{skill.label}</strong><span>{statusLabel(skill.status)}</span>{skill.durationMs !== undefined ? <small>{duration(skill.startedAt, skill.completedAt, skill.durationMs)}</small> : null}{skill.summary ? <small>{skill.summary}</small> : null}</div>)}
          </div>
        </li>
      })}</ol>}
    {companyResearch && workflow.observationSource === 'historical' ? <p className="workflow-node-graph-note" role="status">{t('这是已保存的运行快照；未报告节点不代表当前仍在执行。', 'This is a saved run snapshot. Unreported nodes are not currently executing.')}</p> : null}
  </section>
}
