import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { Background, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow } from '@xyflow/react'
import type { Edge, Node, NodeProps } from '@xyflow/react'
import { graphlib, layout } from '@dagrejs/dagre'
import type { KnowledgeBaseStatus, KnowledgeDirectoryProjection, RuntimeClient, ThemeWorkspaceCompanyProjection, ThemeWorkspaceContentProjection, ThemeWorkspaceIndustryProjection, ThemeWorkspaceProjection, ThemeWorkspaceTimelineItem } from '../../api/runtime-client'
import { RuntimeClientError } from '../../api/runtime-client'
import { useLanguage } from '../../i18n'
import '@xyflow/react/dist/style.css'
import './theme-workspace.css'

interface Props { readonly knowledgeBase?: KnowledgeBaseStatus; readonly client: RuntimeClient }
interface ThemeItem { readonly ref: string; readonly name: string }
interface GraphNodeData extends Record<string, unknown> { readonly label: string; readonly selected: boolean }
type FlowNode = Node<GraphNodeData, 'industry'>
type FollowedTarget = { readonly kind: 'industry'; readonly ref: string } | { readonly kind: 'company'; readonly ref: string }

const importanceOrder = (value: string | undefined): number => value === 'core' ? 0 : value === 'material' ? 1 : value === 'adjacent' ? 2 : 3
const compareRef = (a: { readonly ref: string }, b: { readonly ref: string }): number => a.ref.localeCompare(b.ref)
const sectionLabel = (value: string): string => value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
const localizedSections: Readonly<Record<string, string>> = {
  industry_definition: '行业定义与范围', market_size_growth: '市场规模与增长', supply_demand_analysis: '供需分析', industry_chain_analysis: '产业链分析',
  competitive_landscape: '竞争格局', technology_evolution: '技术演进', company_mapping: '重点公司', risk_analysis: '风险分析',
  'company-overview': '公司概况', 'business-model': '商业模式', 'business-segments': '业务构成', 'revenue-profit-drivers': '收入与利润驱动',
  products: '产品', technologies: '技术', 'industry-exposure': '行业敞口', 'supply-chain': '供应链', competition: '竞争格局',
  'financial-quality': '财务质量', 'growth-drivers': '增长驱动', 'management-capital-allocation': '管理层与资本配置', catalysts: '催化剂',
  risks: '风险', valuation: '估值', 'bull-base-bear': '多空情景', 'variant-perception': '预期差', 'investment-thesis': '投资逻辑', 'monitoring-checklist': '跟踪清单',
}
const englishSections: Readonly<Record<string, string>> = {
  industry_definition: 'Industry definition and scope', market_size_growth: 'Market size and growth', supply_demand_analysis: 'Supply and demand', industry_chain_analysis: 'Industry value chain',
  competitive_landscape: 'Competitive landscape', technology_evolution: 'Technology evolution', company_mapping: 'Key companies', risk_analysis: 'Risk analysis',
  'company-overview': 'Company overview', 'business-model': 'Business model', 'business-segments': 'Business segments', 'revenue-profit-drivers': 'Revenue and profit drivers',
  products: 'Products', technologies: 'Technologies', 'industry-exposure': 'Industry exposure', 'supply-chain': 'Supply chain', competition: 'Competition',
  'financial-quality': 'Financial quality', 'growth-drivers': 'Growth drivers', 'management-capital-allocation': 'Management and capital allocation', catalysts: 'Catalysts',
  risks: 'Risks', valuation: 'Valuation', 'bull-base-bear': 'Bull, base, and bear cases', 'variant-perception': 'Variant perception', 'investment-thesis': 'Investment thesis', 'monitoring-checklist': 'Monitoring checklist',
}
function localizedSectionTitle(id: string, fallback: string, language: string): string { return language === 'en' ? englishSections[id] ?? fallback : localizedSections[id] ?? fallback }
function relationLabel(value: string, t: (zh: string, en: string) => string): string { return value === 'upstream_of' ? t('上游供给', 'Upstream supply') : value === 'depends_on' ? t('依赖', 'Depends on') : sectionLabel(value) }
function formatCompetitionValue(value: string, role: string, currency: string | undefined, language: string): string {
  if ((role !== 'market_cap' && role !== 'annual_revenue') || !currency) return value
  const amount = Number(value)
  if (!Number.isFinite(amount)) return value
  const absolute = Math.abs(amount)
  const divisor = absolute >= 1_000_000_000_000 ? 1_000_000_000_000 : absolute >= 100_000_000 ? 100_000_000 : undefined
  if (!divisor) return `${new Intl.NumberFormat(language === 'zh-CN' ? 'zh-CN' : 'en-US').format(amount)} ${currency}`
  const scale = language === 'zh-CN' ? (divisor === 1_000_000_000_000 ? '万亿' : '亿') : (divisor === 1_000_000_000_000 ? ' trillion' : ' billion')
  const compact = new Intl.NumberFormat(language === 'zh-CN' ? 'zh-CN' : 'en-US', { maximumFractionDigits: 2 }).format(amount / divisor)
  return currency === 'CNY' && language === 'zh-CN' ? `${compact} ${scale}元` : language === 'zh-CN' ? `${compact} ${scale} ${currency}` : `${compact}${scale} ${currency}`
}
function safeMessage(error: unknown, t: (zh: string, en: string) => string): string {
  if (error instanceof RuntimeClientError && error.code === 'conflict') return t('Knowledge Base 已更新。请重新载入当前 Theme。', 'The Knowledge Base has changed. Reload this Theme.')
  if (error instanceof RuntimeClientError && error.code === 'no_kb_mounted') return t('当前没有已挂载的 Knowledge Base。', 'No Knowledge Base is mounted.')
  if (error instanceof RuntimeClientError && error.code === 'not_found') return t('此 Theme 或行业已不在当前确认范围内。', 'This Theme or industry is no longer in the confirmed scope.')
  return error instanceof Error ? error.message : t('读取 Knowledge Graph 失败。', 'Could not load the Knowledge Graph.')
}
function themeFromLocation(): string | undefined {
  const params = new URLSearchParams(window.location.search)
  const value = params.get('themeRef') ?? params.get('root')
  return value && /^entity:[A-Za-z0-9][A-Za-z0-9._:-]{0,240}$/.test(value) ? value : undefined
}
function writeThemeLocation(themeRef: string | undefined): void {
  const params = new URLSearchParams(window.location.search)
  if (themeRef) params.set('themeRef', themeRef)
  else params.delete('themeRef')
  params.delete('root')
  const query = params.toString()
  window.history.pushState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`)
}

function positionGraph(nodes: ThemeWorkspaceProjection['graph']['nodes'], edges: ThemeWorkspaceProjection['graph']['edges'], selectedRef?: string): FlowNode[] {
  const graph = new graphlib.Graph({ multigraph: true }).setDefaultEdgeLabel(() => ({}))
  graph.setGraph({ rankdir: 'LR', nodesep: 38, ranksep: 90, marginx: 32, marginy: 32 })
  for (const node of nodes) graph.setNode(node.ref, { width: 200, height: 76 })
  for (const edge of edges) graph.setEdge(edge.sourceRef, edge.targetRef, { width: 1, height: 1 }, edge.ref)
  layout(graph)
  return nodes.map((node) => {
    const point = graph.node(node.ref) as { readonly x: number; readonly y: number }
    return { id: node.ref, type: 'industry', position: { x: point.x - 100, y: point.y - 38 }, data: { label: node.name, selected: selectedRef === node.ref } }
  })
}

function IndustryNode({ data }: NodeProps<FlowNode>): ReactElement {
  const { t } = useLanguage()
  return <div className={`theme-graph-node ${data.selected ? 'is-selected' : ''}`}><Handle type="target" position={Position.Left} /><span>{t('产业环节', 'Industry segment')}</span><strong>{data.label}</strong><Handle type="source" position={Position.Right} /></div>
}
const nodeTypes = { industry: IndustryNode }

function ThemeDirectory({ directory, selectedThemeRef, onSelect }: { readonly directory?: KnowledgeDirectoryProjection; readonly selectedThemeRef?: string; readonly onSelect: (theme: ThemeItem) => void }): ReactElement {
  const { t } = useLanguage()
  return <aside className="theme-directory" aria-label={t('主题目录', 'Theme directory')}>
    <div className="theme-panel-kicker">KNOWLEDGE GRAPH</div><h2>{t('主题目录', 'Theme directory')}</h2>
    {!directory ? <p className="theme-muted">{t('主题目录加载中…', 'Loading themes…')}</p> : directory.themeGroups.length === 0 ? <div className="theme-empty-inline">{t('尚无 Theme。', 'No Themes yet.')}</div> : directory.themeGroups.map((group) => <section className="theme-directory-group" key={group.ref}>
      <h3>{group.name}</h3>
      {group.themes.map((theme) => <button key={theme.ref} type="button" className={`theme-directory-item ${theme.ref === selectedThemeRef ? 'is-active' : ''}`} aria-current={theme.ref === selectedThemeRef ? 'page' : undefined} onClick={() => onSelect(theme)}><span>{theme.name}</span></button>)}
      {group.themes.length === 0 ? <p className="theme-muted">{t('该分组暂无主题', 'This group has no Themes.')}</p> : null}
    </section>)}
  </aside>
}

function EmptyState({ title, detail }: { readonly title: string; readonly detail?: string }): ReactElement {
  return <div className="theme-empty-state"><strong>{title}</strong>{detail ? <p>{detail}</p> : null}</div>
}

function GraphPanel({ projection, selectedIndustryRef, busy, onSelectIndustry }: { readonly projection?: ThemeWorkspaceProjection; readonly selectedIndustryRef?: string; readonly busy: boolean; readonly onSelectIndustry: (ref: string) => void }): ReactElement {
  const { t, language } = useLanguage()
  const nodes = useMemo(() => projection ? positionGraph(projection.graph.nodes, projection.graph.edges, selectedIndustryRef) : [], [projection, selectedIndustryRef])
  const edges: Edge[] = useMemo(() => (projection?.graph.edges ?? []).map((edge) => ({ id: edge.ref, source: edge.sourceRef, target: edge.targetRef, label: relationLabel(edge.relationType, t), markerEnd: { type: MarkerType.ArrowClosed, color: '#6bbcb0' }, style: { stroke: '#528e87', strokeWidth: 1.7 }, labelStyle: { fill: '#a8c6c2', fontSize: 10 }, labelBgStyle: { fill: '#15242b', fillOpacity: .94 } })), [projection, language])
  return <section className="theme-workspace-panel theme-graph-panel" aria-labelledby="theme-graph-title">
    <div className="theme-panel-heading"><div><div className="theme-panel-kicker">{t('已确认范围 · Schema 0.4', 'CONFIRMED SCOPE · SCHEMA 0.4')}</div><h2 id="theme-graph-title">{t('产业图谱', 'Industry graph')}</h2></div>{projection ? <span className="theme-revision">Revision {projection.revision}</span> : null}</div>
    {busy ? <div className="theme-graph-loading" role="status">{t('读取已确认的产业范围…', 'Loading confirmed industry scope…')}</div> : !projection ? <EmptyState title={t('选择一个 Theme', 'Select a Theme')} detail={t('图谱只展示该 Theme 已确认纳入的行业环节及关系。', 'The graph shows industry segments and relations confirmed for this Theme.')} /> : projection.graph.nodes.length === 0 ? <EmptyState title={t('尚无已确认的行业节点', 'No confirmed industry nodes yet')} detail={t('该 Theme 目前没有可展示的产业范围。', 'This Theme has no industry scope to display yet.')} /> : <>
      <div className="theme-flow-canvas" aria-label={t('行业关系图谱', 'Industry relations graph')}><ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodeClick={(_, node) => onSelectIndustry(node.id)} nodesConnectable={false} nodesDraggable={false} fitView fitViewOptions={{ padding: .18 }} minZoom={.2} maxZoom={2} proOptions={{ hideAttribution: true }}><Background color="#29404b" gap={24} /><Controls showInteractive={false} /><MiniMap nodeColor={(node) => (node.data as GraphNodeData).selected ? '#8cd4c6' : '#42756f'} pannable zoomable maskColor="rgba(8, 16, 20, .7)" style={{ width: 116, height: 74, backgroundColor: 'rgba(17, 30, 36, .96)' }} /></ReactFlow></div>
      <div className="theme-graph-summary"><span>{t(`${projection.graph.nodes.length}/${projection.graph.nodeTotal} 个行业节点`, `${projection.graph.nodes.length}/${projection.graph.nodeTotal} industry nodes`)}</span><span>{t(`${projection.graph.edges.length}/${projection.graph.edgeTotal} 条关系`, `${projection.graph.edges.length}/${projection.graph.edgeTotal} relations`)}</span>{projection.graph.truncated ? <strong>{t('结果已截断', 'Results truncated')}</strong> : null}</div>
      <nav className="theme-node-list" aria-label={t('图谱行业节点', 'Graph industry nodes')}>{projection.graph.nodes.map((node) => <button type="button" key={node.ref} className={node.ref === selectedIndustryRef ? 'is-selected' : ''} aria-pressed={node.ref === selectedIndustryRef} onClick={() => onSelectIndustry(node.ref)}>{node.name}</button>)}</nav>
      {projection.graph.edges.length > 0 ? <details className="theme-edge-list"><summary>{t('关系明细', 'Relations')}</summary><ul>{projection.graph.edges.map((edge) => <li key={edge.ref}><span>{projection.graph.nodes.find((node) => node.ref === edge.sourceRef)?.name ?? edge.sourceRef}</span><b>→ {relationLabel(edge.relationType, t)} →</b><span>{projection.graph.nodes.find((node) => node.ref === edge.targetRef)?.name ?? edge.targetRef}</span></li>)}</ul></details> : null}
    </>}
  </section>
}

function FactGroups({ content }: { readonly content?: ThemeWorkspaceContentProjection }): ReactElement {
  const { t, language } = useLanguage()
  if (!content) return <EmptyState title={t('暂无已写入知识', 'No written Knowledge yet')} detail={t('没有可展示且符合来源权利要求的 canonical 内容。', 'No canonical content is available under the source rights.')} />
  const sectionFactCount = content.sectionCatalog.reduce((count, section) => count + (content.factsBySection[section.id]?.length ?? 0), 0)
  const statusLabel: Partial<Record<ThemeWorkspaceContentProjection['classification']['status'], string>> = {
    partial: t('部分事实尚未归类', 'Some facts are not classified'),
    llm_unavailable: t('语义分类暂不可用；未归类事实仍保留在下方。', 'Semantic classification is unavailable; unclassified facts remain below.'),
    llm_failed: t('语义分类未完成；未归类事实仍保留在下方。', 'Semantic classification did not complete; unclassified facts remain below.'),
    invalid_output: t('语义分类结果未通过校验；仅展示可确认的归类，其他事实保留在未归类区。', 'Semantic classification failed validation; only confirmed classifications are shown, and other facts remain unclassified.'),
    bounded_fallback: t('部分事实使用规则回退归类；未归类事实仍保留在下方。', 'Some facts use rule-based fallback classification; unclassified facts remain below.'),
  }
  const status = statusLabel[content.classification.status]
  const renderFacts = (facts: ThemeWorkspaceContentProjection['unclassifiedFacts']) => facts.map((fact) => <article className="theme-fact" key={fact.ref}><p>{fact.statement ?? fact.title}</p>{fact.value !== undefined && fact.value !== null ? <small>{String(fact.value)}{fact.unit ? ` ${fact.unit}` : ''}{fact.period ? ` · ${fact.period}` : ''}</small> : null}</article>)
  if (content.sectionCatalog.length === 0 && sectionFactCount === 0 && content.unclassifiedFacts.length === 0) return <EmptyState title={t('暂无已写入知识', 'No written Knowledge yet')} detail={t('没有可展示且符合来源权利要求的 canonical 内容。', 'No canonical content is available under the source rights.')} />
  const populatedSections = content.sectionCatalog.filter((section) => (content.factsBySection[section.id]?.length ?? 0) > 0)
  const emptySections = content.sectionCatalog.filter((section) => (content.factsBySection[section.id]?.length ?? 0) === 0)
  return <div className="theme-fact-groups">
    {status ? <div className="theme-classification-status" role="status">{status}{content.classification.reason ? <details><summary>{t('分类详情', 'Classification details')}</summary><p>{content.classification.reason}</p></details> : null}</div> : null}
    {populatedSections.map((section) => {
      const facts = content.factsBySection[section.id] ?? []
      return <details className="theme-fact-group" key={section.id} open>
        <summary><span>{localizedSectionTitle(section.id, section.title, language)}</span><small>{facts.length > 0 ? t(`${facts.length} 条`, `${facts.length} items`) : t('暂无已归类知识', 'No classified Knowledge yet')}</small></summary>
        <div className="theme-fact-group-content">{renderFacts(facts)}</div>
      </details>
    })}
    {emptySections.length > 0 ? <details className="theme-empty-sections">
      <summary>{t(`暂无内容的章节（${emptySections.length}）`, `Sections without content (${emptySections.length})`)}</summary>
      <div className="theme-empty-sections-list">{emptySections.map((section) => <section key={section.id}><strong>{localizedSectionTitle(section.id, section.title, language)}</strong><p>{t('该模块暂无已归类知识。', 'This module has no classified Knowledge yet.')}</p></section>)}</div>
    </details> : null}
    {content.unclassifiedFacts.length > 0 ? <section className="theme-fact-group theme-unclassified-group"><h4>{t(`未归类（${content.unclassifiedFacts.length}）`, `Unclassified (${content.unclassifiedFacts.length})`)}</h4>{renderFacts(content.unclassifiedFacts)}</section> : null}
  </div>
}

function CompetitionTable({ projection, selectedCompanyRef, onSelectCompany }: { readonly projection?: ThemeWorkspaceIndustryProjection; readonly selectedCompanyRef?: string; readonly onSelectCompany: (companyRef: string) => void }): ReactElement {
  const { t, language } = useLanguage()
  const table = projection?.sections.competition
  if (!table) return <EmptyState title={t('暂无竞争格局表', 'No competitive landscape table')} detail={t('该行业目前没有已写入且具备可读来源的竞争格局 Module。', 'This industry has no written competitive landscape Module with readable sources.')} />
  const companyColumn = table.columns.find((column) => column.role === 'company')
  const otherColumns = table.columns.filter((column) => column.role !== 'company')
  return <div className="theme-table-scroll"><table className="theme-competition-table"><thead><tr><th>{companyColumn?.label ?? t('公司', 'Company')}</th>{otherColumns.map((column) => <th key={column.id}>{column.label}</th>)}</tr></thead><tbody>{table.rows.map((row) => {
    const company = projection.companies.find((item) => item.ref === row.companyRef)
    return <tr key={row.companyRef} className={row.companyRef === selectedCompanyRef ? 'is-selected' : ''}><th scope="row"><button type="button" className="theme-company-link" onClick={() => onSelectCompany(row.companyRef)}>{company?.name ?? row.companyRef}</button></th>{otherColumns.map((column) => {
      const item = row.cells.find((cell) => cell.columnId === column.id)
      const value = item?.value
      if (!value || value.status !== 'available') return <td key={column.id}><span className="theme-unavailable">{value?.status === 'not_comparable' ? t('不可比较', 'Not comparable') : value?.reason ?? t('暂无资料', 'No data available')}</span></td>
      const currency = 'currency' in value ? value.currency : undefined
      const unit = 'unit' in value ? value.unit : undefined
      const uniqueDetail = [('asOf' in value && value.asOf ? t(`交易日 ${value.asOf}`, `As of ${value.asOf}`) : undefined), ('fiscalYear' in value && value.fiscalYear ? t(`${value.fiscalYear} 年报`, `${value.fiscalYear} annual report`) : undefined), currency, unit && unit !== currency ? unit : undefined].filter(Boolean).join(' · ')
      return <td key={column.id}><span>{formatCompetitionValue(value.displayValue, column.role, currency, language)}</span>{item?.notComparable ? <strong className="theme-risk-label">{t('不可直接比较', 'Not directly comparable')}</strong> : null}{uniqueDetail ? <small>{uniqueDetail}</small> : null}</td>
    })}</tr>
  })}</tbody></table>{table.rows.length === 0 ? <EmptyState title={t('表格没有关联到该行业的公司记录', 'The table has no company records linked to this industry')} /> : null}{table.truncated || table.rowTotal > table.rows.length ? <p className="theme-truncation">{t(`显示 ${table.rows.length} / ${table.rowTotal} 行，表格已截断。`, `Showing ${table.rows.length} of ${table.rowTotal} rows; the table is truncated.`)}</p> : null}{table.note ? <p className="theme-muted">{table.note}</p> : null}</div>
}

function ContentPanel({ title, kicker, children, className = '' }: { readonly title: string; readonly kicker?: string; readonly children: ReactElement; readonly className?: string }): ReactElement {
  return <section className={`theme-workspace-panel ${className}`}><div className="theme-panel-heading"><div>{kicker ? <div className="theme-panel-kicker">{kicker}</div> : null}<h2>{title}</h2></div></div>{children}</section>
}

function TimelineList({ items, emptyText }: { readonly items: readonly ThemeWorkspaceTimelineItem[]; readonly emptyText: string }): ReactElement {
  if (items.length === 0) return <p className="theme-muted">{emptyText}</p>
  return <ol className="theme-timeline">{items.map((item) => <li key={item.ref}><time>{item.date ? `${item.dateLabel} · ${item.date}` : item.dateLabel}</time><p>{item.title}</p></li>)}</ol>
}

export function KnowledgeGraphPage({ knowledgeBase, client }: Props): ReactElement {
  const { t } = useLanguage()
  const [directory, setDirectory] = useState<KnowledgeDirectoryProjection>()
  const [directoryError, setDirectoryError] = useState('')
  const [themeRef, setThemeRef] = useState<string | undefined>(themeFromLocation)
  const [overview, setOverview] = useState<ThemeWorkspaceProjection>()
  const [industryProjection, setIndustryProjection] = useState<ThemeWorkspaceIndustryProjection>()
  const [companyProjection, setCompanyProjection] = useState<ThemeWorkspaceCompanyProjection>()
  const [selectedIndustryRef, setSelectedIndustryRef] = useState<string>()
  const [selectedCompanyRef, setSelectedCompanyRef] = useState<string>()
  const [followed, setFollowed] = useState<FollowedTarget>()
  const [expandedCoreViewsTarget, setExpandedCoreViewsTarget] = useState<string>()
  const [overviewBusy, setOverviewBusy] = useState(false)
  const [industryBusy, setIndustryBusy] = useState(false)
  const [companyBusy, setCompanyBusy] = useState(false)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const translateRef = useRef(t)
  translateRef.current = t
  const lastCompanyByIndustry = useRef(new Map<string, string>())
  const overviewSequence = useRef(0)
  const industrySequence = useRef(0)
  const companySequence = useRef(0)

  useEffect(() => {
    if (!knowledgeBase) { setDirectory(undefined); return }
    let cancelled = false
    void client.getKnowledgeDirectory().then((value) => { if (!cancelled) { setDirectory(value); setDirectoryError('') } }).catch((caught: unknown) => { if (!cancelled) setDirectoryError(safeMessage(caught, translateRef.current)) })
    return () => { cancelled = true }
  }, [client, knowledgeBase?.knowledgeBaseId])

  const clearThemeData = useCallback(() => {
    setOverview(undefined); setIndustryProjection(undefined); setCompanyProjection(undefined)
    setSelectedIndustryRef(undefined); setSelectedCompanyRef(undefined); setFollowed(undefined); setError('')
    setExpandedCoreViewsTarget(undefined)
    lastCompanyByIndustry.current.clear()
  }, [])

  const selectTheme = useCallback((theme: ThemeItem): void => {
    overviewSequence.current += 1; industrySequence.current += 1; companySequence.current += 1
    clearThemeData(); setThemeRef(theme.ref); writeThemeLocation(theme.ref)
  }, [clearThemeData])

  useEffect(() => {
    const onPopState = (): void => {
      const next = themeFromLocation()
      if (next === themeRef) return
      overviewSequence.current += 1; industrySequence.current += 1; companySequence.current += 1
      clearThemeData(); setThemeRef(next)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [clearThemeData, themeRef])

  useEffect(() => {
    if (!knowledgeBase || !themeRef) { setOverview(undefined); setOverviewBusy(false); return }
    const sequence = ++overviewSequence.current
    let cancelled = false
    setOverview(undefined); setIndustryProjection(undefined); setCompanyProjection(undefined)
    setSelectedIndustryRef(undefined); setSelectedCompanyRef(undefined); setFollowed(undefined); setError(''); setOverviewBusy(true)
    void client.getThemeWorkspaceOverview(themeRef).then((result) => {
      if (cancelled || sequence !== overviewSequence.current) return
      setOverview(result)
      const initial = [...result.graph.nodes].sort((a, b) => importanceOrder(a.importance) - importanceOrder(b.importance) || compareRef(a, b))[0]
      if (initial) { setSelectedIndustryRef(initial.ref); setFollowed({ kind: 'industry', ref: initial.ref }) }
    }).catch((caught: unknown) => { if (!cancelled && sequence === overviewSequence.current) setError(safeMessage(caught, translateRef.current)) }).finally(() => { if (!cancelled && sequence === overviewSequence.current) setOverviewBusy(false) })
    return () => { cancelled = true }
  }, [client, knowledgeBase?.knowledgeBaseId, knowledgeBase?.revision, themeRef, reloadKey])

  const selectIndustry = useCallback((industryRef: string): void => {
    setExpandedCoreViewsTarget(undefined)
    if (industryRef === selectedIndustryRef) { setFollowed({ kind: 'industry', ref: industryRef }); return }
    industrySequence.current += 1; companySequence.current += 1
    setIndustryProjection(undefined); setCompanyProjection(undefined); setSelectedCompanyRef(undefined)
    setSelectedIndustryRef(industryRef); setFollowed({ kind: 'industry', ref: industryRef }); setError('')
  }, [selectedIndustryRef])

  useEffect(() => {
    if (!overview || !selectedIndustryRef || !themeRef) { setIndustryProjection(undefined); setIndustryBusy(false); return }
    const sequence = ++industrySequence.current
    let cancelled = false
    setIndustryProjection(undefined); setCompanyProjection(undefined); setIndustryBusy(true)
    void client.getThemeWorkspaceIndustry(themeRef, selectedIndustryRef, { expectedRevision: overview.revision }).then((result) => {
      if (cancelled || sequence !== industrySequence.current) return
      setIndustryProjection(result)
      const rowRefs = result.sections.competition?.rows.map((row) => row.companyRef) ?? []
      const restored = lastCompanyByIndustry.current.get(selectedIndustryRef)
      const companyRef = restored && rowRefs.includes(restored) ? restored : rowRefs[0]
      setSelectedCompanyRef(companyRef)
    }).catch((caught: unknown) => { if (!cancelled && sequence === industrySequence.current) setError(safeMessage(caught, translateRef.current)) }).finally(() => { if (!cancelled && sequence === industrySequence.current) setIndustryBusy(false) })
    return () => { cancelled = true }
  }, [client, overview, selectedIndustryRef, themeRef])

  const selectCompany = useCallback((companyRef: string): void => {
    if (!selectedIndustryRef) return
    setExpandedCoreViewsTarget(undefined)
    lastCompanyByIndustry.current.set(selectedIndustryRef, companyRef)
    setFollowed({ kind: 'company', ref: companyRef })
    if (companyRef === selectedCompanyRef) return
    companySequence.current += 1; setCompanyProjection(undefined); setSelectedCompanyRef(companyRef); setError('')
  }, [selectedCompanyRef, selectedIndustryRef])

  useEffect(() => {
    if (!overview || !themeRef || !selectedIndustryRef || !selectedCompanyRef) { setCompanyProjection(undefined); setCompanyBusy(false); return }
    const sequence = ++companySequence.current
    let cancelled = false
    setCompanyProjection(undefined); setCompanyBusy(true)
    void client.getThemeWorkspaceCompany(themeRef, selectedIndustryRef, selectedCompanyRef, { expectedRevision: overview.revision }).then((result) => {
      if (!cancelled && sequence === companySequence.current) setCompanyProjection(result)
    }).catch((caught: unknown) => { if (!cancelled && sequence === companySequence.current) setError(safeMessage(caught, translateRef.current)) }).finally(() => { if (!cancelled && sequence === companySequence.current) setCompanyBusy(false) })
    return () => { cancelled = true }
  }, [client, overview, selectedCompanyRef, selectedIndustryRef, themeRef])

  const selectedTheme = directory?.themeGroups.flatMap((group) => group.themes).find((theme) => theme.ref === themeRef)
  const currentIndustry = industryProjection?.industry.ref === selectedIndustryRef ? industryProjection : undefined
  const industryPending = industryBusy || Boolean(overview && selectedIndustryRef && !currentIndustry && !error)
  const currentCompany = companyProjection?.company.ref === selectedCompanyRef && companyProjection?.industryRef === selectedIndustryRef ? companyProjection : undefined
  const responseTruncated = Boolean(overview?.responseBounds.truncated || currentIndustry?.responseBounds.truncated || currentCompany?.responseBounds.truncated)
  const omittedRestrictedCount = (currentIndustry?.sections.omittedRestrictedCount ?? 0) + (currentCompany?.sections.omittedRestrictedCount ?? 0)
  const rightContent = followed?.kind === 'company' ? currentCompany?.sections : followed?.kind === 'industry' ? currentIndustry?.sections : undefined
  const followedKey = followed ? `${followed.kind}:${followed.ref}` : undefined
  const coreViewsExpanded = followedKey !== undefined && expandedCoreViewsTarget === followedKey
  const rightTitle = followed?.kind === 'company' ? currentCompany?.company.name ?? t('公司观点与时间链', 'Company views and timeline') : currentIndustry?.industry.name ?? t('行业观点与时间链', 'Industry views and timeline')
  const retry = (): void => { clearThemeData(); setReloadKey((value) => value + 1) }

  if (!knowledgeBase) return <main className="theme-workspace-page"><div className="theme-no-kb"><span className="theme-panel-kicker">KNOWLEDGE GRAPH</span><h1>{t('主题工作台', 'Theme workspace')}</h1><EmptyState title={t('没有已挂载的 Knowledge Base', 'No Knowledge Base is mounted')} detail={t('挂载 Schema 0.4 Knowledge Base 后，即可查看已确认的主题范围和知识投影。', 'Mount a Schema 0.4 Knowledge Base to view confirmed Theme scope and Knowledge projections.')} /></div></main>

  return <main className="theme-workspace-page" aria-labelledby="theme-workspace-title">
    <header className="theme-workspace-header"><div><span className="theme-panel-kicker">KNOWLEDGE GRAPH · {t('只读', 'READ ONLY')}</span><h1 id="theme-workspace-title">{t('主题工作台', 'Theme workspace')}</h1><p>{selectedTheme ? selectedTheme.name : t('按主题查看产业范围、公司信息、核心观点与时间链', 'Browse industry scope, company information, key views, and timeline by Theme')}</p></div>{overview ? <div className="theme-header-revision"><span>KB REVISION</span><strong>{overview.revision}</strong></div> : null}</header>
    {directoryError ? <div className="theme-page-alert" role="alert">{directoryError}</div> : null}
    {responseTruncated ? <div className="theme-page-notice" role="status">{t('部分 Knowledge 投影因响应体积上限已截断。可在相关分区查看具体条目数。', 'Some Knowledge projections were truncated by the response size limit. Check each section for item counts.')}</div> : null}
    {omittedRestrictedCount > 0 ? <div className="theme-page-notice" role="status">{t(`有 ${omittedRestrictedCount} 项知识因来源访问权限或有效期限制未展示。`, `${omittedRestrictedCount} Knowledge items are hidden because of source access rights or validity limits.`)}</div> : null}
    <div className="theme-workspace-layout">
      <ThemeDirectory directory={directory} selectedThemeRef={themeRef} onSelect={selectTheme} />
      <div className="theme-workspace-main">
        {!themeRef ? <div className="theme-workspace-empty"><EmptyState title={t('选择一个 Theme 开始浏览', 'Select a Theme to get started')} detail={t('左侧按 ThemeGroup 列出当前可用主题。', 'Available Themes are listed by ThemeGroup on the left.')} /></div> : null}
        {error ? <div className="theme-page-alert" role="alert"><span>{error}</span><button type="button" onClick={retry}>{t('重新载入', 'Reload')}</button></div> : null}
        {themeRef ? <div className="theme-workspace-columns">
          <GraphPanel projection={overview?.theme.ref === themeRef ? overview : undefined} selectedIndustryRef={selectedIndustryRef} busy={overviewBusy} onSelectIndustry={selectIndustry} />
          <div className="theme-workspace-middle">
            <ContentPanel title={t('产业信息', 'Industry information')} kicker={currentIndustry?.industry.name ?? 'INDUSTRY OVERVIEW'}>
              {industryPending ? <div className="theme-loading" role="status">{t('读取产业信息…', 'Loading industry information…')}</div> : !selectedIndustryRef ? <EmptyState title={t('没有已确认的行业节点', 'No confirmed industry nodes')} detail={t('产业信息与竞争格局将在确认行业范围后显示。', 'Industry information and competitive landscape will appear after the industry scope is confirmed.')} /> : currentIndustry ? <>
                {currentIndustry.industry.description ? <p className="theme-industry-description">{currentIndustry.industry.description}</p> : null}
                <FactGroups content={currentIndustry.sections} />
                <div className="theme-competition-block"><div className="theme-subheading"><h3>{t('竞争格局', 'Competitive landscape')}</h3>{currentIndustry.sections.competition ? <span>{t(`${currentIndustry.sections.competition.rows.length} 家`, `${currentIndustry.sections.competition.rows.length} companies`)}</span> : null}</div><CompetitionTable projection={currentIndustry} selectedCompanyRef={selectedCompanyRef} onSelectCompany={selectCompany} /></div>
              </> : <EmptyState title={t('行业内容暂不可用', 'Industry content is unavailable')} detail={t('可能是 Knowledge Base revision 已变化或当前范围已失效。', 'The Knowledge Base revision may have changed or this scope may no longer be valid.')} />}
            </ContentPanel>
            <ContentPanel title={t('公司信息', 'Company information')} kicker={selectedCompanyRef ? 'SELECTED COMPANY' : 'COMPANY PROFILE'}>
              {companyBusy ? <div className="theme-loading" role="status">{t('读取公司信息…', 'Loading company information…')}</div> : !selectedIndustryRef || !industryProjection ? <EmptyState title={t('选择行业后查看公司信息', 'Select an industry to view company information')} /> : !selectedCompanyRef ? <EmptyState title={t('暂无公司记录', 'No company records')} detail={t('竞争格局表中没有已关联的公司。', 'The competitive landscape table has no linked companies.')} /> : currentCompany ? <>
                <div className="theme-company-heading"><strong>{currentCompany.company.name}</strong><span>{[currentCompany.company.ticker, currentCompany.company.exchange].filter(Boolean).join(' · ') || t('证券信息未提供', 'Security information not provided')}</span></div>
                <FactGroups content={currentCompany.sections} />
              </> : <EmptyState title={t('公司内容暂不可用', 'Company content is unavailable')} detail={t('公司事实可能尚未写入，或相关资料不可用。', 'Company facts may not have been written, or related information is unavailable.')} />}
            </ContentPanel>
          </div>
          <div className="theme-workspace-right">
            <ContentPanel title={t('核心观点', 'Key views')} kicker={rightTitle}>
              {!rightContent ? <EmptyState title={t('选择行业或公司查看核心观点', 'Select an industry or company to view key views')} /> : rightContent.coreViews.items.length === 0 ? <EmptyState title={t('暂无已写入核心观点', 'No key views have been written')} detail={t('核心观点只从可读的 canonical Claim 中投影。', 'Key views are projected only from readable canonical Claims.')} /> : <>
                <ul className="theme-core-views">{rightContent.coreViews.items.slice(0, coreViewsExpanded ? undefined : rightContent.coreViews.defaultCount).map((item, index) => <li key={item.ref}><span>{index + 1}</span><p>{item.statement ?? item.title}</p></li>)}</ul>
                {rightContent.coreViews.items.length > rightContent.coreViews.defaultCount ? <button type="button" className="theme-expand-views" onClick={() => setExpandedCoreViewsTarget(coreViewsExpanded ? undefined : followedKey)}>{coreViewsExpanded ? t('收起观点', 'Show fewer views') : t(`展开其余 ${rightContent.coreViews.items.length - rightContent.coreViews.defaultCount} 条观点`, `Show ${rightContent.coreViews.items.length - rightContent.coreViews.defaultCount} more views`)}</button> : null}
                {rightContent.coreViews.total > rightContent.coreViews.items.length ? <p className="theme-truncation">{t(`已读取 ${rightContent.coreViews.items.length} / 共 ${rightContent.coreViews.total} 条观点。`, `Loaded ${rightContent.coreViews.items.length} of ${rightContent.coreViews.total} views.`)}</p> : null}
              </>}
            </ContentPanel>
            <ContentPanel title={t('时间链', 'Timeline')} kicker={followed?.kind === 'company' ? 'COMPANY EVENTS & CATALYSTS' : 'INDUSTRY EVENTS & CATALYSTS'}>
              {!rightContent ? <EmptyState title={t('选择行业或公司查看时间链', 'Select an industry or company to view the timeline')} /> : <>
                <h3 className="theme-timeline-heading">{t('已发生事件', 'Past events')}</h3><TimelineList items={rightContent.timeline.historicalEvents} emptyText={t('暂无已写入事件。', 'No events have been written yet.')} />
                <h3 className="theme-timeline-heading">{t('未来催化剂', 'Future catalysts')}</h3><TimelineList items={rightContent.timeline.futureCatalysts} emptyText={t('暂无已写入的未来催化剂。', 'No future catalysts have been written yet.')} />
                {rightContent.timeline.eventsLimit.truncated || rightContent.timeline.catalystsLimit.truncated ? <p className="theme-truncation">{t('时间链结果已截断，刷新或提高读取上限以查看更多。', 'Timeline results are truncated. Reload or increase the read limit to see more.')}</p> : null}
              </>}
            </ContentPanel>
          </div>
        </div> : null}
      </div>
    </div>
  </main>
}
