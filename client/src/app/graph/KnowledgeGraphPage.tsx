import { Component, Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { Background, Controls, Handle, MarkerType, MiniMap, Panel, Position, ReactFlow } from '@xyflow/react'
import type { Edge, Node, NodeProps } from '@xyflow/react'
import { graphlib, layout } from '@dagrejs/dagre'
import { RuntimeClient, RuntimeClientError, type KnowledgeDirectoryProjection, type KnowledgeGraphEdge, type KnowledgeGraphEntityType, type KnowledgeGraphNode, type KnowledgeGraphProjection, type KnowledgeObjectResponse } from '../../api/runtime-client'
import { TopicWorkspace } from './TopicWorkspace'
import { TopicInspector } from './TopicInspector'
import { parseGraphTopicState, writeGraphTopicState, type GraphTopicState } from './topic-state'
import '@xyflow/react/dist/style.css'

const entityTypes: readonly KnowledgeGraphEntityType[] = ['investment_theme', 'industry', 'company', 'product', 'technology']
const entityLabels: Readonly<Record<KnowledgeGraphEntityType, string>> = { investment_theme: 'Theme', industry: 'Industry', company: 'Company', product: 'Product', technology: 'Technology' }
type Selection = { readonly kind: 'node' | 'edge'; readonly ref: string } | undefined
type GraphNodeData = { readonly label: string; readonly secondaryLabel?: string; readonly entityType: KnowledgeGraphEntityType; readonly isRoot: boolean }
type FlowNode = Node<GraphNodeData, 'knowledge'>

class GraphErrorBoundary extends Component<{ readonly children: ReactNode }, { readonly message?: string }> {
  state: { readonly message?: string } = {}
  static getDerivedStateFromError(error: unknown): { readonly message: string } { return { message: error instanceof Error ? error.message : 'Unknown graph canvas error' } }
  render(): ReactNode { return this.state.message ? <div className="graph-empty-canvas"><strong>Graph canvas unavailable</strong><p>{this.state.message}</p></div> : this.props.children }
}

function writeQuery(state: GraphTopicState): void { writeGraphTopicState(state) }

function layoutGraph(nodes: readonly KnowledgeGraphNode[], edges: readonly KnowledgeGraphEdge[]): FlowNode[] {
  const graph = new graphlib.Graph({ multigraph: true }).setDefaultEdgeLabel(() => ({}))
  graph.setGraph({ rankdir: 'LR', nodesep: 32, ranksep: 90, marginx: 30, marginy: 30 })
  const width = 190
  const height = 74
  for (const node of nodes) graph.setNode(node.ref, { width, height })
  for (const edge of edges) graph.setEdge(edge.sourceRef, edge.targetRef, { width: 1, height: 1 }, edge.ref)
  layout(graph)
  return nodes.map((node) => {
    const position = graph.node(node.ref) as { readonly x: number; readonly y: number }
    return { id: node.ref, type: 'knowledge', position: { x: position.x - width / 2, y: position.y - height / 2 }, data: { label: node.label, ...(node.secondaryLabel ? { secondaryLabel: node.secondaryLabel } : {}), entityType: node.entityType, isRoot: node.isRoot } }
  })
}

function KnowledgeNode({ data }: NodeProps<FlowNode>): ReactElement {
  return <div className={`knowledge-flow-node ${data.isRoot ? 'root' : ''}`}><Handle type="target" position={Position.Left} className="graph-handle" /><span className="graph-node-type">{entityLabels[data.entityType]}</span><strong>{data.label}</strong>{data.secondaryLabel ? <small>{data.secondaryLabel}</small> : null}<Handle type="source" position={Position.Right} className="graph-handle" /></div>
}

const nodeTypes = { knowledge: KnowledgeNode }

function errorText(error: unknown): string { return error instanceof RuntimeClientError ? error.message : 'ResearchHub runtime operation failed' }
function displayRelationType(value: string): string { return value.replaceAll('_', ' ') }
function prettyJson(value: unknown): string { try { return JSON.stringify(value, null, 2).slice(0, 5000) } catch { return '[unavailable]' } }
type JsonRecord = Record<string, unknown>
function record(value: unknown): JsonRecord | undefined { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonRecord : undefined }
function textValue(value: unknown): string | undefined { return typeof value === 'string' && value.trim() !== '' ? value : undefined }
function stringList(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '') : [] }
function safeDisplayText(value: unknown): string | undefined { const text = textValue(value); if (!text) return undefined; return /(?:^|[\s=(])(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|etc|private|tmp|var|mnt|workspace|root)(?:\/|$))/i.test(text) ? undefined : text }
function safeCanonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(safeCanonicalValue).filter((item) => item !== undefined)
  const source = record(value)
  if (source) return Object.fromEntries(Object.entries(source).filter(([key]) => !/raw|quote|excerpt|body|content|path|filesystem|credential|token/i.test(key)).map(([key, item]) => [key, safeCanonicalValue(item)]).filter(([, item]) => item !== undefined))
  return typeof value === 'string' && !safeDisplayText(value) ? undefined : value
}
function fieldRows(value: JsonRecord | undefined, fields: readonly string[]): readonly [string, string][] { return fields.flatMap((field) => { const item = textValue(value?.[field]); return item ? [[field, item] as const] : [] }) }
function truncationLabel(count: number, total: number | undefined, truncated: boolean | undefined, label: string): string { return truncated && total !== undefined ? `Showing ${count} of ${total} ${label}` : `${count} ${label}` }

function RelationCard({ value, safeMode = false }: { readonly value: unknown; readonly safeMode?: boolean }): ReactElement {
  const relation = record(value)
  const attributes = relation?.attributes
  const confidence = textValue(relation?.confidence) ?? (typeof relation?.confidence === 'number' ? String(relation.confidence) : undefined)
  const asOf = textValue(relation?.asOf)
  return <article className="graph-evidence-card"><strong>{displayRelationType(textValue(relation?.type) ?? 'relation')}</strong><dl className="graph-evidence-meta"><dt>Source</dt><dd>{safeDisplayText(relation?.sourceRef) ?? 'Unavailable'}</dd><dt>Target</dt><dd>{safeDisplayText(relation?.targetRef) ?? 'Unavailable'}</dd>{confidence ? <><dt>Confidence</dt><dd>{confidence}</dd></> : null}{asOf ? <><dt>As of</dt><dd>{asOf}</dd></> : null}</dl>{attributes !== undefined ? <div className="graph-evidence-attributes"><span>Attributes</span>{safeMode ? <pre>{prettyJson(safeCanonicalValue(attributes)).slice(0, 900)}</pre> : <pre>{prettyJson(attributes).slice(0, 900)}</pre>}</div> : null}</article>
}

function ClaimCard({ value }: { readonly value: unknown }): ReactElement {
  const claim = record(value)
  const temporal = record(claim?.temporal)
  const asOf = textValue(temporal?.asOf)
  return <article className="graph-evidence-card"><strong>{textValue(claim?.claimType) ?? 'Claim'}</strong>{safeDisplayText(claim?.statement) ? <p className="graph-evidence-statement">{safeDisplayText(claim?.statement)}</p> : null}<dl className="graph-evidence-meta">{asOf ? <><dt>As of</dt><dd>{asOf}</dd></> : null}{typeof claim?.confidence === 'number' ? <><dt>Confidence</dt><dd>{claim.confidence}</dd></> : null}</dl></article>
}

function safeExternalUrl(value: unknown): string | undefined { const candidate = textValue(value); if (!candidate) return undefined; try { const url = new URL(candidate); return candidate.length <= 2_048 && (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password ? url.toString() : undefined } catch { return undefined } }
function SourceCard({ value, safeMode = false }: { readonly value: unknown; readonly safeMode?: boolean }): ReactElement {
  const source = record(value)
  const rights = record(source?.rights)
  const url = safeMode ? (rights?.accessScope === 'public' && rights.providerTermsKnown === true ? safeExternalUrl(source?.canonicalUrl) : undefined) : safeExternalUrl(source?.url ?? source?.canonicalUrl)
  return <article className="graph-evidence-card"><strong>{safeMode ? (safeDisplayText(source?.title) ?? 'Untitled source') : (textValue(source?.title) ?? 'Untitled source')}</strong><dl className="graph-evidence-meta">{textValue(source?.sourceType ?? source?.type) ? <><dt>Type</dt><dd>{textValue(source?.sourceType ?? source?.type)}</dd></> : null}{(safeMode ? safeDisplayText(source?.publisher ?? source?.institution) : textValue(source?.publisher ?? source?.institution)) ? <><dt>Publisher</dt><dd>{safeMode ? safeDisplayText(source?.publisher ?? source?.institution) : textValue(source?.publisher ?? source?.institution)}</dd></> : null}{textValue(source?.publishedAt) ? <><dt>Published</dt><dd>{textValue(source?.publishedAt)}</dd></> : null}</dl>{url ? <a className="graph-evidence-link" href={url} target="_blank" rel="noreferrer noopener">Open source</a> : null}</article>
}

function Directory({ directory, query, setQuery, onSearch, onFocus, currentRef, themeRef }: { readonly directory?: KnowledgeDirectoryProjection; readonly query: string; readonly setQuery: (value: string) => void; readonly onSearch: () => void; readonly onFocus: (ref: string) => void; readonly currentRef?: string; readonly themeRef?: string }): ReactElement {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set())
  useEffect(() => { setExpandedGroups(new Set(directory?.themeGroups.map((group) => group.ref) ?? [])) }, [directory])
  const section = (title: string, items: readonly { readonly ref: string; readonly name: string }[], total: number, truncated: boolean): ReactElement => <section className="graph-directory-section"><div className="graph-directory-title"><span>{title}</span><small>{total}{truncated ? '+' : ''}</small></div>{items.map((item) => <button className={`graph-directory-item ${item.ref === currentRef ? 'active' : ''}`} aria-current={item.ref === currentRef ? 'page' : undefined} key={item.ref} onClick={() => onFocus(item.ref)}><span>{item.name}</span><small>{item.ref}</small></button>)}</section>
  const themeName = directory?.themeGroups.flatMap((group) => group.themes).find((item) => item.ref === themeRef)?.name
  const rootName = directory ? [...directory.industries.items, ...directory.companies.items, ...directory.products.items, ...directory.technologies.items].find((item) => item.ref === currentRef)?.name : undefined
  return <aside className="graph-directory" aria-label="Knowledge Directory"><div className="graph-panel-heading"><div><span className="eyebrow">BROWSE KNOWLEDGE</span><h2>Directory</h2></div></div><form className="graph-search" onSubmit={(event) => { event.preventDefault(); onSearch() }}><input aria-label="Search Knowledge" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search canonical Knowledge" /><button type="submit" aria-label="Search">⌕</button></form>{themeRef || currentRef ? <nav className="graph-breadcrumb" aria-label="Breadcrumb"><span>Knowledge</span>{themeRef ? <><span aria-hidden="true">›</span><span>{themeName ?? themeRef}</span></> : null}{currentRef && currentRef !== themeRef ? <><span aria-hidden="true">›</span><span>{rootName ?? currentRef}</span></> : null}</nav> : null}{directory ? <div className="graph-directory-scroll">{directory.themeGroups.map((group) => { const expanded = expandedGroups.has(group.ref); const contentId = `theme-group-${group.ref.replaceAll(/[^a-zA-Z0-9_-]/g, '-')}`; return <section className="graph-directory-section" key={group.ref}><button type="button" className="graph-directory-title graph-directory-toggle" aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpandedGroups((current) => { const next = new Set(current); if (next.has(group.ref)) next.delete(group.ref); else next.add(group.ref); return next })}><span><span aria-hidden="true">{expanded ? '▾' : '▸'}</span> {group.name}</span><small>ThemeGroup</small></button><div id={contentId} hidden={!expanded}>{group.themes.map((item) => <button className={`graph-directory-item ${item.ref === themeRef ? 'active' : ''}`} aria-current={item.ref === themeRef ? 'page' : undefined} key={item.ref} onClick={() => onFocus(item.ref)}><span>{item.name}</span><small>{item.ref}</small></button>)}{group.themes.length === 0 ? <p className="graph-directory-empty">No active themes</p> : null}</div></section> })}{section('Industries', directory.industries.items, directory.industries.total, directory.industries.truncated)}{section('Companies', directory.companies.items, directory.companies.total, directory.companies.truncated)}{section('Products', directory.products.items, directory.products.total, directory.products.truncated)}{section('Technologies', directory.technologies.items, directory.technologies.total, directory.technologies.truncated)}</div> : <p className="muted">Loading Directory…</p>}</aside>
}

function Filters({ projection, visibleTypes, setVisibleTypes, visibleRelations, setVisibleRelations }: { readonly projection?: KnowledgeGraphProjection; readonly visibleTypes: ReadonlySet<KnowledgeGraphEntityType>; readonly setVisibleTypes: (next: Set<KnowledgeGraphEntityType>) => void; readonly visibleRelations: ReadonlySet<string>; readonly setVisibleRelations: (next: Set<string>) => void }): ReactElement {
  const relationTypes = [...new Set((projection?.edges ?? []).map((edge) => edge.relationType))].sort((left, right) => left.localeCompare(right))
  const toggleType = (type: KnowledgeGraphEntityType): void => { const next = new Set(visibleTypes); if (next.has(type)) next.delete(type); else next.add(type); setVisibleTypes(next) }
  const toggleRelation = (type: string): void => { const next = new Set(visibleRelations); if (next.has(type)) next.delete(type); else next.add(type); setVisibleRelations(next) }
  return <div className="graph-filters"><span className="eyebrow">VIEW FILTERS</span><strong>Entity types</strong>{entityTypes.map((type) => <label key={type}><input type="checkbox" checked={visibleTypes.has(type)} onChange={() => toggleType(type)} />{entityLabels[type]}</label>)}{relationTypes.length > 0 ? <><strong>Relations</strong>{relationTypes.map((type) => <label key={type}><input type="checkbox" checked={visibleRelations.has(type)} onChange={() => toggleRelation(type)} />{displayRelationType(type)}</label>)}</> : null}</div>
}

function GraphCanvas({ root, projection, nodes, edges, busy, error, results, compact, onSearchResult, onNodeSelect, onNodeFocus, onEdgeSelect }: {
  readonly root?: string
  readonly projection?: KnowledgeGraphProjection
  readonly nodes: FlowNode[]
  readonly edges: Edge[]
  readonly busy: boolean
  readonly error: string
  readonly results: readonly { readonly ref: string; readonly kind: string; readonly semanticType?: string; readonly displayName?: string }[]
  readonly compact: boolean
  readonly onSearchResult: (item: { readonly ref: string; readonly kind: string; readonly semanticType?: string }) => void
  readonly onNodeSelect: (ref: string) => void
  readonly onNodeFocus: (ref: string) => void
  readonly onEdgeSelect: (ref: string) => void
}): ReactElement {
  return <section className={`graph-workspace ${compact ? 'graph-workspace-compact' : ''}`} aria-label="Knowledge Graph canvas">
    {results.length > 0 ? <div className="graph-search-results"><span className="eyebrow">SEARCH RESULTS</span>{results.map((item) => <button key={item.ref} onClick={() => onSearchResult(item)}><strong>{item.displayName ?? item.ref}</strong><small>{item.semanticType ?? item.kind}</small></button>)}</div> : null}
    {error ? <div className="inline-error graph-error">{error}</div> : null}
    {busy ? <div className="graph-overlay">Loading projection…</div> : null}
    {projection ? <GraphErrorBoundary><ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} nodesConnectable={false} nodesDraggable={true} deleteKeyCode={null} onNodeClick={(_, node) => onNodeSelect(node.id)} onNodeDoubleClick={(_, node) => onNodeFocus(node.id)} onEdgeClick={(_, edge) => onEdgeSelect(edge.id)} fitView fitViewOptions={{ padding: .2 }} minZoom={.2} maxZoom={2.2}><Background color="#29404b" gap={24} /><Controls showInteractive={false} /><MiniMap nodeColor={(node) => (node.data as GraphNodeData).isRoot ? '#72d2c4' : '#3d6562'} pannable zoomable /><Panel position="top-left" className="graph-canvas-note">{projection.nodes.length} nodes · {projection.edges.length} relations{projection.truncated ? ' · bounded' : ''}</Panel></ReactFlow></GraphErrorBoundary> : <div className="graph-empty-canvas"><strong>{busy ? 'Loading projection' : root ? 'Projection unavailable' : 'Select a root to explore'}</strong><p>{error || 'Select a Theme, Industry, Company, Product or Technology to explore.'}</p></div>}
    {projection?.edges.length ? <div className="graph-text-relations" aria-label="Text relation list"><strong>{projection.truncated ? `Returned relations (${projection.edges.length} of ${projection.edgeTotal})` : `Relations (${projection.edges.length})`}</strong>{projection.edges.map((edge) => <button key={edge.ref} onClick={() => onEdgeSelect(edge.ref)}><span>{edge.sourceRef}</span> → <span>{edge.targetRef}</span><small>{edge.relationType}</small></button>)}</div> : null}
  </section>
}

export function KnowledgeInspector({ selection, projection, client, onFocus, safeMode = false }: { readonly selection: Selection; readonly projection?: KnowledgeGraphProjection; readonly client: RuntimeClient; readonly onFocus: (ref: string) => void; readonly safeMode?: boolean }): ReactElement {
  const selectedNode = selection?.kind === 'node' ? projection?.nodes.find((node) => node.ref === selection.ref) : undefined
  const selectedEdge = selection?.kind === 'edge' ? projection?.edges.find((edge) => edge.ref === selection.ref) : undefined
  const [detail, setDetail] = useState<KnowledgeObjectResponse>()
  const [error, setError] = useState('')
  useEffect(() => {
    const ref = selection?.ref
    if (!ref) { setDetail(undefined); setError(''); return }
    let cancelled = false
    setDetail(undefined); setError('')
    void client.getKnowledgeObject(ref).then((value) => { if (!cancelled) setDetail(value) }).catch((caught) => { if (!cancelled) setError(errorText(caught)) })
    return () => { cancelled = true }
  }, [client, selection?.ref])
  const object = record(detail?.object)
  const relationItems = detail ? selectedEdge ? [detail.object] : detail.relatedRelations ?? [] : []
  const claimItems = detail?.relatedClaims ?? []
  const sourceItems = detail?.supportingSources ?? []
  const relationTruncation = detail?.truncation?.relations
  const claimTruncation = detail?.truncation?.claims
  const sourceTruncation = detail?.truncation?.sources
  const provenanceItems = claimItems.flatMap((item) => { const claim = record(item); return Array.isArray(claim?.provenance) ? claim.provenance : [] })
  const objectProvenance = Array.isArray(object?.provenance) ? object.provenance : []
  const allProvenance = [...objectProvenance, ...provenanceItems]
  const entityRows = fieldRows(object, ['name', 'type', 'description', 'definition', 'legalName', 'ticker', 'exchange'])
  const aliases = stringList(object?.aliases)
  return <aside className="graph-inspector" aria-label="Knowledge Inspector"><div className="graph-panel-heading"><div><span className="eyebrow">CANONICAL DETAIL</span><h2>Inspector</h2></div><span className="read-only-badge">Read-only</span></div>{selectedNode ? <><span className="graph-inspector-type">{entityLabels[selectedNode.entityType]}</span><h3>{safeDisplayText(object?.name) ?? (safeMode ? (safeDisplayText(selectedNode.label) ?? 'Entity') : selectedNode.label)}</h3><p className="graph-ref">{selectedNode.ref}</p><dl className="graph-meta"><dt>Lifecycle</dt><dd>{textValue(record(object?.lifecycle)?.status) ?? selectedNode.lifecycleStatus}</dd><dt>Context</dt><dd>{projection?.profile.replace('_', ' ')}</dd></dl><button className="secondary-action full" onClick={() => onFocus(selectedNode.ref)}>Focus this node</button></> : selectedEdge ? <><span className="graph-inspector-type">Relation</span><h3>{displayRelationType(textValue(object?.type) ?? selectedEdge.relationType)}</h3><p className="graph-ref">{selectedEdge.ref}</p><dl className="graph-meta"><dt>Source</dt><dd>{safeDisplayText(object?.sourceRef) ?? selectedEdge.sourceRef}</dd><dt>Target</dt><dd>{safeDisplayText(object?.targetRef) ?? selectedEdge.targetRef}</dd></dl></> : <div className="notice"><strong>Select a node or edge</strong><p>Canonical detail and evidence appear here. Claims and Sources remain Inspector-only.</p></div>}{selection ? <div className="graph-detail-result">{error ? <div className="inline-error">{error}</div> : detail ? <><span className="eyebrow">BOUNDED CANONICAL VIEW</span>{selectedNode ? <section className="graph-detail-section"><h4>Entity fields</h4><dl className="graph-meta">{entityRows.map(([field, value]) => <Fragment key={field}><dt>{field}</dt><dd>{safeDisplayText(value) ?? 'Not shown'}</dd></Fragment>)}{aliases.length > 0 ? <><dt>Aliases</dt><dd>{aliases.join(', ')}</dd></> : null}</dl></section> : <section className="graph-detail-section"><h4>Relation detail</h4><RelationCard safeMode={safeMode} value={{ ...object, sourceRef: object?.sourceRef ?? selectedEdge?.sourceRef, targetRef: object?.targetRef ?? selectedEdge?.targetRef, type: object?.type ?? selectedEdge?.relationType }} /></section>}<section className="graph-detail-section"><h4>Relations</h4><p className="graph-section-summary">{truncationLabel(relationItems.length, relationTruncation?.total, relationTruncation?.truncated, 'relations')}</p>{relationItems.length > 0 ? relationItems.map((item, index) => <RelationCard safeMode={safeMode} key={textValue(record(item)?.id) ?? String(index)} value={item} />) : <p className="muted">No related relations in the bounded view.</p>}</section><section className="graph-detail-section"><h4>Claims</h4><p className="graph-section-summary">{truncationLabel(claimItems.length, claimTruncation?.total, claimTruncation?.truncated, 'claims')}</p>{claimItems.length > 0 ? claimItems.map((item, index) => <ClaimCard key={textValue(record(item)?.id) ?? String(index)} value={item} />) : <p className="muted">No related claims in the bounded view.</p>}</section><section className="graph-detail-section"><h4>Sources</h4><p className="graph-section-summary">{truncationLabel(sourceItems.length, sourceTruncation?.total, sourceTruncation?.truncated, 'sources')}</p>{sourceItems.length > 0 ? sourceItems.map((item, index) => <SourceCard safeMode={safeMode} key={textValue(record(item)?.id) ?? String(index)} value={item} />) : <p className="muted">No supporting sources in the bounded view.</p>}</section>{safeMode ? null : <section className="graph-detail-section"><h4>Provenance</h4>{allProvenance.length > 0 ? allProvenance.map((item, index) => { const provenance = record(item); return <dl className="graph-evidence-meta" key={String(index)}>{(['sourceRef', 'rawRef', 'locator', 'chunkRef'] as const).map((field) => safeDisplayText(provenance?.[field]) ? <Fragment key={field}><dt>{field}</dt><dd>{safeDisplayText(provenance?.[field])}</dd></Fragment> : null)}</dl> }) : <p className="muted">No provenance fields available.</p>}</section>}{safeMode ? null : <details className="graph-raw-detail"><summary>Canonical object (debug)</summary><pre>{prettyJson(detail.object)}</pre></details>}</> : <p className="muted">Loading canonical detail…</p>}</div> : null}</aside>
}

export function KnowledgeGraphPage({ knowledgeBase, client }: { readonly knowledgeBase?: { readonly knowledgeBaseId: string; readonly schemaVersion?: string; readonly revision?: number }; readonly client: RuntimeClient }): ReactElement {
  const initial = useMemo(() => parseGraphTopicState(window.location.search), [])
  const [root, setRoot] = useState<string | undefined>(initial.graphRootRef ?? initial.themeRef)
  const [themeRef, setThemeRef] = useState<string | undefined>(initial.themeRef)
  const [depth, setDepth] = useState<1 | 2>(initial.depth)
  const [topicSection, setTopicSection] = useState(initial.section)
  const [topicScope, setTopicScope] = useState(initial.scope)
  const [topicLifecycle, setTopicLifecycle] = useState(initial.lifecycle)
  const [observationType, setObservationType] = useState(initial.observationType)
  const [claimType, setClaimType] = useState(initial.claimType)
  const [relationType, setRelationType] = useState(initial.relationType)
  const [selectedRef, setSelectedRef] = useState(initial.selectedRef)
  const [directory, setDirectory] = useState<KnowledgeDirectoryProjection>()
  const [projection, setProjection] = useState<KnowledgeGraphProjection>()
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<readonly { readonly ref: string; readonly kind: string; readonly semanticType?: string; readonly displayName?: string }[]>([])
  const [selection, setSelection] = useState<Selection>()
  const searchSequence = useRef(0)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [visibleTypes, setVisibleTypes] = useState<Set<KnowledgeGraphEntityType>>(() => new Set(entityTypes))
  const [visibleRelations, setVisibleRelations] = useState<Set<string>>(() => new Set())

  useEffect(() => { const onPopState = (): void => { const state = parseGraphTopicState(window.location.search); setRoot(state.graphRootRef ?? state.themeRef); setThemeRef(state.themeRef); setDepth(state.depth); setTopicSection(state.section); setTopicScope(state.scope); setTopicLifecycle(state.lifecycle); setObservationType(state.observationType); setClaimType(state.claimType); setRelationType(state.relationType); setSelectedRef(state.selectedRef); setSelection(undefined) }; window.addEventListener('popstate', onPopState); return () => window.removeEventListener('popstate', onPopState) }, [])
  useEffect(() => { if (!knowledgeBase) return; let cancelled = false; setLoadError(''); void client.getKnowledgeDirectory().then((value) => { if (!cancelled) setDirectory(value) }).catch((caught) => { if (!cancelled) setLoadError(errorText(caught)) }); return () => { cancelled = true } }, [client, knowledgeBase])
  useEffect(() => {
    if (!knowledgeBase || !root) { setProjection(undefined); return }
    let cancelled = false
    setProjection(undefined); setBusy(true); setLoadError('')
    void client.getKnowledgeGraph({ rootRef: root, depth }).then((value) => { if (!cancelled) { setProjection(value); setVisibleRelations(new Set(value.edges.map((edge) => edge.relationType))) } }).catch((caught) => { if (!cancelled) { setProjection(undefined); setLoadError(errorText(caught)) } }).finally(() => { if (!cancelled) setBusy(false) })
    return () => { cancelled = true }
  }, [client, depth, knowledgeBase, root])
  useEffect(() => {
    if (!selectedRef || !projection) { if (!selectedRef) setSelection(undefined); return }
    if (projection.nodes.some((node) => node.ref === selectedRef)) setSelection({ kind: 'node', ref: selectedRef })
    else if (projection.edges.some((edge) => edge.ref === selectedRef)) setSelection({ kind: 'edge', ref: selectedRef })
    else setSelection(undefined)
  }, [selectedRef, projection])
  const pushState = useCallback((patch: Partial<GraphTopicState>): void => { writeQuery({ ...(themeRef ? { themeRef } : {}), ...(root ? { graphRootRef: root } : {}), depth, section: topicSection, scope: topicScope, lifecycle: topicLifecycle, ...(observationType ? { observationType } : {}), ...(claimType ? { claimType } : {}), ...(relationType ? { relationType } : {}), ...(selectedRef ? { selectedRef } : {}), ...patch }) }, [themeRef, root, depth, topicSection, topicScope, topicLifecycle, observationType, claimType, relationType, selectedRef])
  const focus = useCallback((ref: string): void => { setRoot(ref); setThemeRef(undefined); setSelection(undefined); setSelectedRef(undefined); setTopicSection('overview'); setTopicScope('direct'); setTopicLifecycle('active'); setObservationType(undefined); setClaimType(undefined); setRelationType(undefined); writeQuery({ graphRootRef: ref, depth, section: 'overview', scope: 'direct', lifecycle: 'active' }) }, [depth])
  const focusGraphRoot = useCallback((ref: string): void => { setRoot(ref); setSelection(undefined); setSelectedRef(undefined); pushState({ graphRootRef: ref, selectedRef: undefined }) }, [pushState])
  const focusTheme = useCallback((ref: string): void => { setRoot(ref); setThemeRef(ref); setSelection(undefined); setSelectedRef(undefined); setTopicSection('overview'); setTopicScope('direct'); setTopicLifecycle('active'); setObservationType(undefined); setClaimType(undefined); setRelationType(undefined); writeQuery({ themeRef: ref, graphRootRef: ref, depth, section: 'overview', scope: 'direct', lifecycle: 'active' }) }, [depth])
  const focusDirectoryRef = useCallback((ref: string): void => {
    const theme = directory?.themeGroups.some((group) => group.themes.some((item) => item.ref === ref))
    if (theme) focusTheme(ref); else focus(ref)
  }, [directory, focus, focusTheme])
  const updateDepth = (next: 1 | 2): void => { setDepth(next); setSelectedRef(undefined); pushState({ depth: next, selectedRef: undefined }) }
  const selectObject = useCallback((ref: string, graphSelection?: Selection): void => { setSelectedRef(ref); setSelection(graphSelection); pushState({ selectedRef: ref }) }, [pushState])
  const openCanonicalRef = useCallback((ref: string): void => {
    if (projection?.nodes.some((node) => node.ref === ref)) focusGraphRoot(ref)
    else selectObject(ref)
  }, [projection, focusGraphRoot, selectObject])
  const changeTopicSection = (next: typeof topicSection): void => { setTopicSection(next); setSelectedRef(undefined); pushState({ section: next, selectedRef: undefined }) }
  const changeTopicScope = (next: typeof topicScope): void => { setTopicScope(next); setSelectedRef(undefined); pushState({ scope: next, selectedRef: undefined }) }
  const changeLifecycle = (next: typeof topicLifecycle): void => { setTopicLifecycle(next); setSelectedRef(undefined); pushState({ lifecycle: next, selectedRef: undefined }) }
  const changeObservation = (next?: typeof observationType): void => { setObservationType(next); setSelectedRef(undefined); pushState({ observationType: next, selectedRef: undefined }) }
  const changeClaim = (next?: typeof claimType): void => { setClaimType(next); setSelectedRef(undefined); pushState({ claimType: next, selectedRef: undefined }) }
  const changeRelation = (next?: typeof relationType): void => { setRelationType(next); setSelectedRef(undefined); pushState({ relationType: next, selectedRef: undefined }) }
  const search = (): void => {
    const value = query.trim()
    const requestId = ++searchSequence.current
    if (!value) { setSearchResults([]); return }
    void client.searchKnowledge(value).then((result) => {
      if (requestId !== searchSequence.current) return
      const results = result.results.map((item) => ({ ref: item.ref, kind: item.kind, ...(item.semanticType ? { semanticType: item.semanticType } : {}), ...(item.displayName ? { displayName: item.displayName } : {}) }))
      setSearchResults(results)
    }).catch((caught) => { if (requestId === searchSequence.current) setLoadError(errorText(caught)) })
  }
  const visible = useMemo(() => {
    if (!projection) return { nodes: [] as FlowNode[], edges: [] as Edge[] }
    const nodeMap = new Map(projection.nodes.map((node) => [node.ref, node]))
    const graphNodes = projection.nodes.filter((node) => node.isRoot || visibleTypes.has(node.entityType))
    const graphEdges = projection.edges.filter((edge) => visibleRelations.has(edge.relationType) && nodeMap.has(edge.sourceRef) && nodeMap.has(edge.targetRef) && (nodeMap.get(edge.sourceRef)!.isRoot || visibleTypes.has(nodeMap.get(edge.sourceRef)!.entityType)) && (nodeMap.get(edge.targetRef)!.isRoot || visibleTypes.has(nodeMap.get(edge.targetRef)!.entityType)))
    return { nodes: layoutGraph(graphNodes, graphEdges), edges: graphEdges.map((edge) => ({ id: edge.ref, source: edge.sourceRef, target: edge.targetRef, label: edge.label, animated: false, markerEnd: { type: MarkerType.ArrowClosed, color: '#5a8580' }, style: { stroke: '#5a8580' }, labelStyle: { fill: '#8aa9a5', fontSize: 10 }, labelBgStyle: { fill: '#121e25', fillOpacity: .9, color: '#121e25' } })) }
  }, [projection, visibleRelations, visibleTypes])
  if (!knowledgeBase) return <main className="page-frame graph-page"><span className="eyebrow">KNOWLEDGE SURFACE</span><h1 id="graph-title">Knowledge Graph</h1><p>Explore canonical Themes, Industries, Companies, Products, Technologies and their relationships.</p><div className="notice graph-empty-state"><strong>No Knowledge Base mounted</strong><p>Mount a canonical Knowledge Base to browse the Directory and explore a rooted graph.</p></div></main>
  const selectedIsGraphObject = Boolean(selectedRef && (projection?.nodes.some((node) => node.ref === selectedRef) || projection?.edges.some((edge) => edge.ref === selectedRef)))
  const unsupportedTopicSchema = knowledgeBase.schemaVersion === '0.3'
  const graphCanvas = <GraphCanvas root={root} projection={projection} nodes={visible.nodes} edges={visible.edges} busy={busy} error={loadError} results={searchResults} compact={Boolean(themeRef)} onSearchResult={(item) => { if (item.semanticType && entityTypes.includes(item.semanticType as KnowledgeGraphEntityType) && item.ref.startsWith('entity:')) { if (directory?.themeGroups.some((group) => group.themes.some((theme) => theme.ref === item.ref))) focusTheme(item.ref); else if (themeRef) focusGraphRoot(item.ref); else focusDirectoryRef(item.ref) } else selectObject(item.ref); setSearchResults([]) }} onNodeSelect={(ref) => selectObject(ref, { kind: 'node', ref })} onNodeFocus={focusGraphRoot} onEdgeSelect={(ref) => selectObject(ref, { kind: 'edge', ref })} />
  const safeMode = knowledgeBase.schemaVersion === '0.4' || Boolean(themeRef)
  return <main className="graph-page-shell" aria-labelledby="graph-title">
    <header className="graph-page-header"><div><span className="eyebrow">KNOWLEDGE SURFACE</span><h1 id="graph-title">Knowledge Graph</h1><p>Read-only projection of canonical Knowledge.</p></div><div className="graph-toolbar"><span className="eyebrow">DEPTH</span><button className={depth === 1 ? 'selected' : ''} onClick={() => updateDepth(1)}>1 hop</button><button className={depth === 2 ? 'selected' : ''} onClick={() => updateDepth(2)}>2 hops</button></div></header>
    <div className={`graph-layout ${themeRef ? 'has-topic' : ''}`}>
      <Directory directory={directory} query={query} setQuery={setQuery} onSearch={search} onFocus={focusDirectoryRef} currentRef={root} themeRef={themeRef} />
      <div className="graph-workspace-column">
        {themeRef && !unsupportedTopicSchema ? <TopicWorkspace key={themeRef} themeRef={themeRef} graphRootRef={root} section={topicSection} scope={topicScope} depth={depth} lifecycle={topicLifecycle} observationType={observationType} claimType={claimType} relationType={relationType} selectedRef={selectedRef} revisionHint={knowledgeBase.revision} graphContent={graphCanvas} client={client} onSectionChange={changeTopicSection} onScopeChange={changeTopicScope} onLifecycleChange={changeLifecycle} onObservationTypeChange={changeObservation} onClaimTypeChange={changeClaim} onRelationTypeChange={changeRelation} onSelect={(ref) => selectObject(ref)} onFocus={focusGraphRoot} /> : <>{themeRef ? <div className="notice topic-notice"><strong>Topic sections are not supported for Schema 0.3</strong><p>The existing rooted Entity and Relation graph remains available.</p></div> : null}{graphCanvas}</>}
      </div>
      <div className="graph-right-column"><Filters projection={projection} visibleTypes={visibleTypes} setVisibleTypes={setVisibleTypes} visibleRelations={visibleRelations} setVisibleRelations={setVisibleRelations} />{selectedRef && !selectedIsGraphObject ? <TopicInspector refValue={selectedRef} client={client} onFocus={openCanonicalRef} /> : <KnowledgeInspector selection={selection} projection={projection} client={client} onFocus={openCanonicalRef} safeMode={safeMode} />}</div>
    </div>
  </main>
}
