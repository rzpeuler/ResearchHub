import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { Background, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow } from '@xyflow/react'
import type { Edge, Node, NodeProps } from '@xyflow/react'
import { graphlib, layout } from '@dagrejs/dagre'
import type { KnowledgeBaseStatus, KnowledgeDirectoryProjection, RuntimeClient, ThemeWorkspaceCompanyProjection, ThemeWorkspaceContentProjection, ThemeWorkspaceIndustryProjection, ThemeWorkspaceProjection, ThemeWorkspaceTimelineItem } from '../../api/runtime-client'
import { RuntimeClientError } from '../../api/runtime-client'
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
function safeMessage(error: unknown): string {
  if (error instanceof RuntimeClientError && error.code === 'conflict') return 'Knowledge Base 已更新。请重新载入当前 Theme。'
  if (error instanceof RuntimeClientError && error.code === 'no_kb_mounted') return '当前没有已挂载的 Knowledge Base。'
  if (error instanceof RuntimeClientError && error.code === 'not_found') return '此 Theme 或行业已不在当前确认范围内。'
  return error instanceof Error ? error.message : '读取 Knowledge Graph 失败。'
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
  return <div className={`theme-graph-node ${data.selected ? 'is-selected' : ''}`}><Handle type="target" position={Position.Left} /><span>产业环节</span><strong>{data.label}</strong><Handle type="source" position={Position.Right} /></div>
}
const nodeTypes = { industry: IndustryNode }

function ThemeDirectory({ directory, selectedThemeRef, onSelect }: { readonly directory?: KnowledgeDirectoryProjection; readonly selectedThemeRef?: string; readonly onSelect: (theme: ThemeItem) => void }): ReactElement {
  return <aside className="theme-directory" aria-label="主题目录">
    <div className="theme-panel-kicker">KNOWLEDGE GRAPH</div><h2>主题目录</h2>
    {!directory ? <p className="theme-muted">主题目录加载中…</p> : directory.themeGroups.length === 0 ? <div className="theme-empty-inline">尚无 Theme。</div> : directory.themeGroups.map((group) => <section className="theme-directory-group" key={group.ref}>
      <h3>{group.name}</h3>
      {group.themes.map((theme) => <button key={theme.ref} type="button" className={`theme-directory-item ${theme.ref === selectedThemeRef ? 'is-active' : ''}`} aria-current={theme.ref === selectedThemeRef ? 'page' : undefined} onClick={() => onSelect(theme)}><span>{theme.name}</span></button>)}
      {group.themes.length === 0 ? <p className="theme-muted">该分组暂无主题</p> : null}
    </section>)}
  </aside>
}

function EmptyState({ title, detail }: { readonly title: string; readonly detail?: string }): ReactElement {
  return <div className="theme-empty-state"><strong>{title}</strong>{detail ? <p>{detail}</p> : null}</div>
}

function GraphPanel({ projection, selectedIndustryRef, busy, onSelectIndustry }: { readonly projection?: ThemeWorkspaceProjection; readonly selectedIndustryRef?: string; readonly busy: boolean; readonly onSelectIndustry: (ref: string) => void }): ReactElement {
  const nodes = useMemo(() => projection ? positionGraph(projection.graph.nodes, projection.graph.edges, selectedIndustryRef) : [], [projection, selectedIndustryRef])
  const edges: Edge[] = useMemo(() => (projection?.graph.edges ?? []).map((edge) => ({ id: edge.ref, source: edge.sourceRef, target: edge.targetRef, label: edge.relationType.replaceAll('_', ' '), markerEnd: { type: MarkerType.ArrowClosed, color: '#6bbcb0' }, style: { stroke: '#528e87', strokeWidth: 1.7 }, labelStyle: { fill: '#a8c6c2', fontSize: 10 }, labelBgStyle: { fill: '#15242b', fillOpacity: .94 } })), [projection])
  return <section className="theme-workspace-panel theme-graph-panel" aria-labelledby="theme-graph-title">
    <div className="theme-panel-heading"><div><div className="theme-panel-kicker">CONFIRMED SCOPE · SCHEMA 0.4</div><h2 id="theme-graph-title">产业图谱</h2></div>{projection ? <span className="theme-revision">Revision {projection.revision}</span> : null}</div>
    {busy ? <div className="theme-graph-loading" role="status">读取已确认的产业范围…</div> : !projection ? <EmptyState title="选择一个 Theme" detail="图谱只展示该 Theme 已确认纳入的行业环节及关系。" /> : projection.graph.nodes.length === 0 ? <EmptyState title="尚无已确认的行业节点" detail="该 Theme 目前没有可展示的产业范围。" /> : <>
      <div className="theme-flow-canvas" aria-label="行业关系图谱"><ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodeClick={(_, node) => onSelectIndustry(node.id)} nodesConnectable={false} nodesDraggable={false} fitView fitViewOptions={{ padding: .18 }} minZoom={.2} maxZoom={2}><Background color="#29404b" gap={24} /><Controls showInteractive={false} /><MiniMap nodeColor={(node) => (node.data as GraphNodeData).selected ? '#8cd4c6' : '#42756f'} pannable zoomable /></ReactFlow></div>
      <div className="theme-graph-summary"><span>{projection.graph.nodes.length}/{projection.graph.nodeTotal} 个行业节点</span><span>{projection.graph.edges.length}/{projection.graph.edgeTotal} 条关系</span>{projection.graph.truncated ? <strong>结果已截断</strong> : null}</div>
      <nav className="theme-node-list" aria-label="图谱行业节点">{projection.graph.nodes.map((node) => <button type="button" key={node.ref} className={node.ref === selectedIndustryRef ? 'is-selected' : ''} aria-pressed={node.ref === selectedIndustryRef} onClick={() => onSelectIndustry(node.ref)}>{node.name}</button>)}</nav>
      {projection.graph.edges.length > 0 ? <details className="theme-edge-list"><summary>关系明细</summary><ul>{projection.graph.edges.map((edge) => <li key={edge.ref}><span>{projection.graph.nodes.find((node) => node.ref === edge.sourceRef)?.name ?? edge.sourceRef}</span><b>→ {sectionLabel(edge.relationType)} →</b><span>{projection.graph.nodes.find((node) => node.ref === edge.targetRef)?.name ?? edge.targetRef}</span></li>)}</ul></details> : null}
    </>}
  </section>
}

function FactGroups({ content }: { readonly content?: ThemeWorkspaceContentProjection }): ReactElement {
  const groups = content ? Object.entries(content.factsByType).sort(([a], [b]) => a.localeCompare(b)) : []
  if (groups.length === 0) return <EmptyState title="暂无已写入知识" detail="没有可展示且符合来源权利要求的 canonical 内容。" />
  return <div className="theme-fact-groups">{groups.map(([kind, facts]) => <section className="theme-fact-group" key={kind}><h4>{sectionLabel(kind)}</h4>{facts.map((fact) => <article className="theme-fact" key={fact.ref}><p>{fact.statement ?? fact.title}</p>{fact.value !== undefined && fact.value !== null ? <small>{String(fact.value)}{fact.unit ? ` ${fact.unit}` : ''}{fact.period ? ` · ${fact.period}` : ''}</small> : null}</article>)}{content?.limited[kind]?.truncated ? <p className="theme-truncation">仅显示 {facts.length} 条 / 共 {content.limited[kind].total} 条</p> : null}</section>)}</div>
}

function CompetitionTable({ projection, selectedCompanyRef, onSelectCompany }: { readonly projection?: ThemeWorkspaceIndustryProjection; readonly selectedCompanyRef?: string; readonly onSelectCompany: (companyRef: string) => void }): ReactElement {
  const table = projection?.sections.competition
  if (!table) return <EmptyState title="暂无竞争格局表" detail="该行业目前没有已写入且具备可读来源的竞争格局 Module。" />
  const companyColumn = table.columns.find((column) => column.role === 'company')
  const otherColumns = table.columns.filter((column) => column.role !== 'company')
  return <div className="theme-table-scroll"><table className="theme-competition-table"><thead><tr><th>{companyColumn?.label ?? '公司'}</th>{otherColumns.map((column) => <th key={column.id}>{column.label}</th>)}</tr></thead><tbody>{table.rows.map((row) => {
    const company = projection.companies.find((item) => item.ref === row.companyRef)
    return <tr key={row.companyRef} className={row.companyRef === selectedCompanyRef ? 'is-selected' : ''}><th scope="row"><button type="button" className="theme-company-link" onClick={() => onSelectCompany(row.companyRef)}>{company?.name ?? row.companyRef}</button></th>{otherColumns.map((column) => {
      const item = row.cells.find((cell) => cell.columnId === column.id)
      const value = item?.value
      if (!value || value.status !== 'available') return <td key={column.id}><span className="theme-unavailable">{value?.status === 'not_comparable' ? '不可比较' : value?.reason ?? '暂无资料'}</span></td>
      const detail = value.status === 'available' ? [('asOf' in value && value.asOf ? `交易日 ${value.asOf}` : undefined), ('fiscalYear' in value && value.fiscalYear ? `${value.fiscalYear} 年报` : undefined), ('currency' in value ? value.currency : undefined), ('unit' in value ? value.unit : undefined)].filter(Boolean).join(' · ') : ''
      return <td key={column.id}><span>{value.displayValue}</span>{item?.notComparable ? <strong className="theme-risk-label">不可直接比较</strong> : null}{detail ? <small>{detail}</small> : null}</td>
    })}</tr>
  })}</tbody></table>{table.rows.length === 0 ? <EmptyState title="表格没有关联到该行业的公司记录" /> : null}{table.truncated || table.rowTotal > table.rows.length ? <p className="theme-truncation">显示 {table.rows.length} / {table.rowTotal} 行，表格已截断。</p> : null}{table.note ? <p className="theme-muted">{table.note}</p> : null}</div>
}

function ContentPanel({ title, kicker, children, className = '' }: { readonly title: string; readonly kicker?: string; readonly children: ReactElement; readonly className?: string }): ReactElement {
  return <section className={`theme-workspace-panel ${className}`}><div className="theme-panel-heading"><div>{kicker ? <div className="theme-panel-kicker">{kicker}</div> : null}<h2>{title}</h2></div></div>{children}</section>
}

function TimelineList({ items, emptyText }: { readonly items: readonly ThemeWorkspaceTimelineItem[]; readonly emptyText: string }): ReactElement {
  if (items.length === 0) return <p className="theme-muted">{emptyText}</p>
  return <ol className="theme-timeline">{items.map((item) => <li key={item.ref}><time>{item.date ? `${item.dateLabel} · ${item.date}` : item.dateLabel}</time><p>{item.title}</p></li>)}</ol>
}

export function KnowledgeGraphPage({ knowledgeBase, client }: Props): ReactElement {
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
  const lastCompanyByIndustry = useRef(new Map<string, string>())
  const overviewSequence = useRef(0)
  const industrySequence = useRef(0)
  const companySequence = useRef(0)

  useEffect(() => {
    if (!knowledgeBase) { setDirectory(undefined); return }
    let cancelled = false
    void client.getKnowledgeDirectory().then((value) => { if (!cancelled) { setDirectory(value); setDirectoryError('') } }).catch((caught: unknown) => { if (!cancelled) setDirectoryError(safeMessage(caught)) })
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
    }).catch((caught: unknown) => { if (!cancelled && sequence === overviewSequence.current) setError(safeMessage(caught)) }).finally(() => { if (!cancelled && sequence === overviewSequence.current) setOverviewBusy(false) })
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
    }).catch((caught: unknown) => { if (!cancelled && sequence === industrySequence.current) setError(safeMessage(caught)) }).finally(() => { if (!cancelled && sequence === industrySequence.current) setIndustryBusy(false) })
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
    }).catch((caught: unknown) => { if (!cancelled && sequence === companySequence.current) setError(safeMessage(caught)) }).finally(() => { if (!cancelled && sequence === companySequence.current) setCompanyBusy(false) })
    return () => { cancelled = true }
  }, [client, overview, selectedCompanyRef, selectedIndustryRef, themeRef])

  const selectedTheme = directory?.themeGroups.flatMap((group) => group.themes).find((theme) => theme.ref === themeRef)
  const currentIndustry = industryProjection?.industry.ref === selectedIndustryRef ? industryProjection : undefined
  const currentCompany = companyProjection?.company.ref === selectedCompanyRef && companyProjection?.industryRef === selectedIndustryRef ? companyProjection : undefined
  const responseTruncated = Boolean(overview?.responseBounds.truncated || currentIndustry?.responseBounds.truncated || currentCompany?.responseBounds.truncated)
  const omittedRestrictedCount = (currentIndustry?.sections.omittedRestrictedCount ?? 0) + (currentCompany?.sections.omittedRestrictedCount ?? 0)
  const rightContent = followed?.kind === 'company' ? currentCompany?.sections : followed?.kind === 'industry' ? currentIndustry?.sections : undefined
  const followedKey = followed ? `${followed.kind}:${followed.ref}` : undefined
  const coreViewsExpanded = followedKey !== undefined && expandedCoreViewsTarget === followedKey
  const rightTitle = followed?.kind === 'company' ? currentCompany?.company.name ?? '公司观点与时间链' : currentIndustry?.industry.name ?? '行业观点与时间链'
  const retry = (): void => { clearThemeData(); setReloadKey((value) => value + 1) }

  if (!knowledgeBase) return <main className="theme-workspace-page"><div className="theme-no-kb"><span className="theme-panel-kicker">KNOWLEDGE GRAPH</span><h1>主题工作台</h1><EmptyState title="没有已挂载的 Knowledge Base" detail="挂载 Schema 0.4 Knowledge Base 后，即可查看已确认的主题范围和知识投影。" /></div></main>

  return <main className="theme-workspace-page" aria-labelledby="theme-workspace-title">
    <header className="theme-workspace-header"><div><span className="theme-panel-kicker">KNOWLEDGE GRAPH · READ ONLY</span><h1 id="theme-workspace-title">主题工作台</h1><p>{selectedTheme ? selectedTheme.name : '按主题查看产业范围、公司信息、核心观点与时间链'}</p></div>{overview ? <div className="theme-header-revision"><span>KB REVISION</span><strong>{overview.revision}</strong></div> : null}</header>
    {directoryError ? <div className="theme-page-alert" role="alert">{directoryError}</div> : null}
    {responseTruncated ? <div className="theme-page-notice" role="status">部分 Knowledge 投影因响应体积上限已截断。可在相关分区查看具体条目数。</div> : null}
    {omittedRestrictedCount > 0 ? <div className="theme-page-notice" role="status">有 {omittedRestrictedCount} 项知识因来源访问权限或有效期限制未展示。</div> : null}
    <div className="theme-workspace-layout">
      <ThemeDirectory directory={directory} selectedThemeRef={themeRef} onSelect={selectTheme} />
      <div className="theme-workspace-main">
        {!themeRef ? <div className="theme-workspace-empty"><EmptyState title="选择一个 Theme 开始浏览" detail="左侧按 ThemeGroup 列出当前可用主题。" /></div> : null}
        {error ? <div className="theme-page-alert" role="alert"><span>{error}</span><button type="button" onClick={retry}>重新载入</button></div> : null}
        {themeRef ? <div className="theme-workspace-columns">
          <GraphPanel projection={overview?.theme.ref === themeRef ? overview : undefined} selectedIndustryRef={selectedIndustryRef} busy={overviewBusy} onSelectIndustry={selectIndustry} />
          <div className="theme-workspace-middle">
            <ContentPanel title="产业信息" kicker={currentIndustry?.industry.name ?? 'INDUSTRY OVERVIEW'}>
              {industryBusy ? <div className="theme-loading" role="status">读取产业信息…</div> : !selectedIndustryRef ? <EmptyState title="没有已确认的行业节点" detail="产业信息与竞争格局将在确认行业范围后显示。" /> : currentIndustry ? <>
                {currentIndustry.industry.description ? <p className="theme-industry-description">{currentIndustry.industry.description}</p> : null}
                <FactGroups content={currentIndustry.sections} />
                <div className="theme-competition-block"><div className="theme-subheading"><h3>竞争格局</h3>{currentIndustry.sections.competition ? <span>{currentIndustry.sections.competition.rows.length} 家</span> : null}</div><CompetitionTable projection={currentIndustry} selectedCompanyRef={selectedCompanyRef} onSelectCompany={selectCompany} /></div>
              </> : <EmptyState title="行业内容暂不可用" detail="可能是 Knowledge Base revision 已变化或当前范围已失效。" />}
            </ContentPanel>
            <ContentPanel title="公司信息" kicker={selectedCompanyRef ? 'SELECTED COMPANY' : 'COMPANY PROFILE'}>
              {companyBusy ? <div className="theme-loading" role="status">读取公司信息…</div> : !selectedIndustryRef || !industryProjection ? <EmptyState title="选择行业后查看公司信息" /> : !selectedCompanyRef ? <EmptyState title="暂无公司记录" detail="竞争格局表中没有已关联的公司。" /> : currentCompany ? <>
                <div className="theme-company-heading"><strong>{currentCompany.company.name}</strong><span>{[currentCompany.company.ticker, currentCompany.company.exchange].filter(Boolean).join(' · ') || '证券信息未提供'}</span></div>
                <FactGroups content={currentCompany.sections} />
              </> : <EmptyState title="公司内容暂不可用" detail="公司事实可能尚未写入，或相关资料不可用。" />}
            </ContentPanel>
          </div>
          <div className="theme-workspace-right">
            <ContentPanel title="核心观点" kicker={rightTitle}>
              {!rightContent ? <EmptyState title="选择行业或公司查看核心观点" /> : rightContent.coreViews.items.length === 0 ? <EmptyState title="暂无已写入核心观点" detail="核心观点只从可读的 canonical Claim 中投影。" /> : <>
                <ul className="theme-core-views">{rightContent.coreViews.items.slice(0, coreViewsExpanded ? undefined : rightContent.coreViews.defaultCount).map((item, index) => <li key={item.ref}><span>{index + 1}</span><p>{item.statement ?? item.title}</p></li>)}</ul>
                {rightContent.coreViews.items.length > rightContent.coreViews.defaultCount ? <button type="button" className="theme-expand-views" onClick={() => setExpandedCoreViewsTarget(coreViewsExpanded ? undefined : followedKey)}>{coreViewsExpanded ? '收起观点' : `展开其余 ${rightContent.coreViews.items.length - rightContent.coreViews.defaultCount} 条观点`}</button> : null}
                {rightContent.coreViews.total > rightContent.coreViews.items.length ? <p className="theme-truncation">已读取 {rightContent.coreViews.items.length} / 共 {rightContent.coreViews.total} 条观点。</p> : null}
              </>}
            </ContentPanel>
            <ContentPanel title="时间链" kicker={followed?.kind === 'company' ? 'COMPANY EVENTS & CATALYSTS' : 'INDUSTRY EVENTS & CATALYSTS'}>
              {!rightContent ? <EmptyState title="选择行业或公司查看时间链" /> : <>
                <h3 className="theme-timeline-heading">已发生事件</h3><TimelineList items={rightContent.timeline.historicalEvents} emptyText="暂无已写入事件。" />
                <h3 className="theme-timeline-heading">未来催化剂</h3><TimelineList items={rightContent.timeline.futureCatalysts} emptyText="暂无已写入的未来催化剂。" />
                {rightContent.timeline.eventsLimit.truncated || rightContent.timeline.catalystsLimit.truncated ? <p className="theme-truncation">时间链结果已截断，刷新或提高读取上限以查看更多。</p> : null}
              </>}
            </ContentPanel>
          </div>
        </div> : null}
      </div>
    </div>
  </main>
}
