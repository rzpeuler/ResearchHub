import { Fragment, useEffect, useMemo, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { RuntimeClientError, type RuntimeClient, type KnowledgeTopicItem, type KnowledgeTopicKind, type KnowledgeTopicItemPage, type KnowledgeTopicSummary, type KnowledgeTopicFilters, type KnowledgeTopicScope } from '../../api/runtime-client'
import type { TopicSection } from './topic-state'

const sections: readonly { readonly key: TopicSection; readonly label: string }[] = [
  { key: 'overview', label: 'Overview' }, { key: 'relation', label: 'Relation' }, { key: 'claim', label: 'Claim' },
  { key: 'observation', label: 'Observation' }, { key: 'event', label: 'Event' }, { key: 'thesis', label: 'Thesis' },
  { key: 'module', label: 'Module' }, { key: 'source', label: 'Source' }, { key: 'reasoning_edge', label: 'ReasoningEdge' },
]
const pageSize = 30
const hiddenSourceKeys = /raw|quote|excerpt|body|content|local|absolute|path|filesystem|credential|token/i
const relationTypes = ['theme_exposure', 'business_exposure', 'upstream_of', 'supplier_of', 'competes_with', 'owns_stake_in', 'offers_product', 'belongs_to_industry', 'component_of', 'develops_technology', 'uses_technology', 'applied_in', 'depends_on', 'substitutes_for'] as const

function text(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value : undefined }
function errorMessage(error: unknown): string { return error instanceof RuntimeClientError ? error.message : 'Knowledge topic request failed' }
function isUnsupported(error: unknown): boolean { return error instanceof RuntimeClientError && (error.code === 'schema_not_supported' || error.status === 501 || /schema.{0,12}0\.3|not supported/i.test(error.message)) }
function safeUrl(value: unknown): string | undefined {
  const candidate = text(value)
  if (!candidate) return undefined
  try { const parsed = new URL(candidate); return candidate.length <= 2_048 && (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !parsed.username && !parsed.password ? parsed.toString() : undefined } catch { return undefined }
}
function titleFor(kind: KnowledgeTopicKind): string { return sections.find((item) => item.key === kind)?.label ?? kind }
function fieldText(key: string, value: unknown): string | undefined {
  if (hiddenSourceKeys.test(key)) return undefined
  if (value === null || value === undefined || value === '') return undefined
  if (Array.isArray(value)) return value.filter((item) => ['string', 'number', 'boolean'].includes(typeof item)).map(String).join(', ')
  if (typeof value === 'object') return undefined
  const result = String(value)
  if (/(?:^|[\s=(])(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|etc|private|tmp|var|mnt|workspace|root)(?:\/|$))/i.test(result)) return undefined
  return result
}
function countLabel(count: { readonly total: number; readonly totalExact: boolean; readonly truncated: boolean } | undefined): string {
  if (!count) return 'Not available'
  const number = count.totalExact ? String(count.total) : `At least ${count.total}`
  return `Active baseline ${number}${count.truncated ? ' · truncated' : ''}`
}
function itemDate(item: KnowledgeTopicItem): string { return item.date ? `${item.date.field}: ${item.date.value}` : 'Time not provided' }
function pathText(path: NonNullable<KnowledgeTopicItem['associationPaths']>[number]): string {
  return path.hops.map((hop) => `${hop.sourceRef} —[${hop.relationRef}]→ ${hop.targetRef}`).join(' · ')
}

export function TopicWorkspace({ themeRef, graphRootRef, section, scope, depth, lifecycle, observationType, claimType, relationType, selectedRef, revisionHint, graphContent, client, onSectionChange, onScopeChange, onLifecycleChange, onObservationTypeChange, onClaimTypeChange, onRelationTypeChange, onSelect, onFocus }: {
  readonly themeRef: string
  readonly graphRootRef?: string
  readonly section: TopicSection
  readonly scope: KnowledgeTopicScope
  readonly depth: 1 | 2
  readonly lifecycle: 'active' | 'all'
  readonly observationType?: 'metric' | 'estimate' | 'consensus'
  readonly claimType?: string
  readonly relationType?: string
  readonly selectedRef?: string
  readonly revisionHint?: number
  readonly graphContent?: ReactNode
  readonly client: RuntimeClient
  readonly onSectionChange: (section: TopicSection) => void
  readonly onScopeChange: (scope: KnowledgeTopicScope) => void
  readonly onLifecycleChange: (value: 'active' | 'all') => void
  readonly onObservationTypeChange: (value?: 'metric' | 'estimate' | 'consensus') => void
  readonly onClaimTypeChange: (value?: string) => void
  readonly onRelationTypeChange: (value?: string) => void
  readonly onSelect: (ref: string) => void
  readonly onFocus: (ref: string) => void
}): ReactElement {
  const [summary, setSummary] = useState<KnowledgeTopicSummary>()
  const [summaryError, setSummaryError] = useState('')
  const [unsupported, setUnsupported] = useState(false)
  const [page, setPage] = useState<KnowledgeTopicItemPage>()
  const [pageError, setPageError] = useState('')
  const [pageBusy, setPageBusy] = useState(false)
  const [cursorStack, setCursorStack] = useState<readonly (string | undefined)[]>([undefined])
  const [pageIndex, setPageIndex] = useState(0)
  const [observedRevision, setObservedRevision] = useState<number | undefined>(revisionHint)
  const [summaryRefresh, setSummaryRefresh] = useState(0)

  useEffect(() => {
    let current = true
    setSummary(undefined); setSummaryError(''); setUnsupported(false)
    void client.getTopicSummary(themeRef, depth).then((value) => {
      if (!current) return
      setSummary(value); setObservedRevision(value.revision); setSummaryError('')
    }).catch((error: unknown) => {
      if (!current) return
      setSummaryError(errorMessage(error)); setUnsupported(isUnsupported(error))
    })
    return () => { current = false }
  }, [client, depth, themeRef, revisionHint, summaryRefresh])

  const kind = section === 'overview' ? undefined : section as KnowledgeTopicKind
  const filters: KnowledgeTopicFilters = useMemo(() => ({ lifecycle, ...(kind === 'observation' && observationType ? { observationType } : {}), ...(kind === 'claim' && claimType ? { claimType } : {}), ...(kind === 'relation' && relationType ? { relationType } : {}) }), [kind, lifecycle, observationType, claimType, relationType])
  const cursor = cursorStack[pageIndex]
  useEffect(() => {
    setCursorStack([undefined]); setPageIndex(0); setPage(undefined); setPageError('')
  }, [themeRef, graphRootRef, kind, scope, depth, lifecycle, observationType, claimType, relationType, observedRevision])
  useEffect(() => {
    if (!kind || unsupported) { setPage(undefined); setPageBusy(false); return }
    let current = true
    setPageBusy(true); setPageError('')
    void client.listTopicItems({ themeRef, kind, scope, depth, limit: pageSize, ...(cursor ? { cursor } : {}), filters }).then((value) => {
      if (!current) return
      if (observedRevision !== undefined && value.revision !== observedRevision) {
        setObservedRevision(value.revision); setCursorStack([undefined]); setPageIndex(0); setPage(undefined); setSummaryRefresh((current) => current + 1); return
      }
      setPage(value)
    }).catch((error: unknown) => {
      if (!current) return
      setPageError(errorMessage(error)); setPage(undefined)
      if (error instanceof RuntimeClientError && (error.code === 'conflict' || error.status === 409)) { setCursorStack([undefined]); setPageIndex(0) }
    }).finally(() => { if (current) setPageBusy(false) })
    return () => { current = false }
  }, [client, themeRef, kind, scope, depth, cursor, filters, observedRevision, unsupported])

  const count = kind && summary ? summary.counts[scope][kind] : undefined
  const pageCountLabel = page ? `${page.totalExact ? page.total : `At least ${page.total}`}${page.truncated ? ' · truncated' : ''}` : countLabel(count)
  const scopeSummary = summary?.connected
  const onNext = (): void => {
    if (!page?.nextCursor) return
    setCursorStack((current) => [...current.slice(0, pageIndex + 1), page.nextCursor!]); setPageIndex((current) => current + 1)
  }
  const onPrevious = (): void => { if (pageIndex > 0) setPageIndex((current) => current - 1) }

  return <section className="topic-workspace" aria-label="Investment theme knowledge">
    {summary ? <header className="topic-identity">
      <div className="topic-identity-main"><span className="eyebrow">INVESTMENT THEME</span><h2>{summary.theme.name}</h2><p className="graph-ref">{summary.theme.ref}</p>
        <div className="topic-badges"><span>Lifecycle: {summary.theme.lifecycleStatus}</span><span>Schema {summary.schemaVersion}</span><span>KB revision {summary.revision}</span></div>
      </div>
      <dl className="topic-identity-fields">
        <dt>Aliases</dt><dd>{summary.theme.aliases.length ? summary.theme.aliases.join(', ') : 'Not recorded'}</dd>
        <dt>Description</dt><dd>{summary.theme.description ?? 'Not recorded'}</dd>
        <dt>Definition</dt><dd>{summary.theme.definition ?? 'Not recorded'}</dd>
        <dt>Inclusion</dt><dd>{summary.theme.inclusionCriteria?.join(' · ') ?? 'Not recorded'}</dd>
        <dt>Exclusion</dt><dd>{summary.theme.exclusionCriteria?.join(' · ') ?? 'Not recorded'}</dd>
        <dt>ThemeGroup</dt><dd>{summary.theme.themeGroupRef ?? 'Not recorded'}</dd>
      </dl>
    </header> : null}
    {summaryError ? <div className="notice topic-notice"><strong>{unsupported ? 'Topic workspace unavailable for this schema' : 'Topic summary unavailable'}</strong><p>{unsupported ? 'Schema 0.3 supports the existing rooted Entity and Relation graph. Topic sections require Schema 0.4.' : summaryError}</p></div> : null}
    {graphContent}
    {summary ? <>
      <div className="topic-scope-bar"><div><span className="eyebrow">TOPIC CONTENT</span><p>Direct records belong to this theme. Connected records belong to entities reached by canonical relations.</p></div><div className="topic-segmented" role="group" aria-label="Knowledge scope"><button aria-pressed={scope === 'direct'} className={scope === 'direct' ? 'selected' : ''} onClick={() => onScopeChange('direct')}>Direct</button><button aria-pressed={scope === 'connected'} className={scope === 'connected' ? 'selected' : ''} onClick={() => onScopeChange('connected')}>Connected</button></div></div>
      {scope === 'connected' ? <p className="topic-boundary">Depth {scopeSummary?.depth ?? depth}: {scopeSummary?.totalExact ? 'connected totals are exact' : 'connected totals are at least the returned counts'} · {scopeSummary?.truncated ? 'association traversal truncated' : 'bounded relation paths'}{scopeSummary?.focusRefs.length ? <> · focus refs available: {scopeSummary.focusRefs.map((ref) => <button className="topic-inline-link" key={ref} onClick={() => onFocus(ref)}>{ref}</button>)}</> : null}</p> : null}
      <nav className="topic-section-nav" aria-label="Topic sections">{sections.map((entry) => {
        const sectionCount = entry.key === 'overview' ? undefined : summary.counts[scope][entry.key as KnowledgeTopicKind]
        return <button key={entry.key} type="button" aria-current={section === entry.key ? 'page' : undefined} className={section === entry.key ? 'selected' : ''} onClick={() => onSectionChange(entry.key)}><span>{entry.label}</span>{sectionCount ? <small>{countLabel(sectionCount)}</small> : null}</button>
      })}</nav>
      {section === 'overview' ? <div className="topic-overview">
        <div className="topic-overview-heading"><div><h3>{summary.theme.name} overview</h3><p>Counts and reach come from the mounted Knowledge projection at revision {summary.revision}.</p></div>{summary.connected.truncated ? <span className="topic-state topic-state-warning">Connected traversal truncated</span> : null}</div>
        <div className="topic-count-grid">{sections.filter((entry) => entry.key !== 'overview').map((entry) => { const value = summary.counts[scope][entry.key as KnowledgeTopicKind]; return <button key={entry.key} className="topic-count-card" onClick={() => onSectionChange(entry.key)}><span>{entry.label}</span><strong>{countLabel(value)}</strong></button> })}</div>
        <p className="topic-boundary">Connected context uses canonical relation paths up to depth {summary.connected.depth}. {summary.connected.totalExact ? 'The projection reports exact connected totals.' : 'Connected totals are lower bounds.'}{summary.connected.truncated ? ' The association scan is incomplete.' : ''}</p>
        <p className="topic-boundary">Latest recorded time and evidence gap summaries are not included in this topic summary response.</p>
        {summary.schemaVersion !== '0.4' ? <p className="topic-boundary">Topic sections are not supported for this schema version.</p> : null}
      </div> : <div className="topic-list-panel">
        <div className="topic-list-heading"><div><span className="eyebrow">{scope === 'direct' ? 'DIRECTLY ATTRIBUTED' : 'RELATED ENTITY CONTEXT'}</span><h3>{titleFor(kind!)}</h3><p>{pageCountLabel} in this filtered scope{page ? ` · page ${pageIndex + 1} · KB revision ${page.revision}` : ''}</p></div><label className="topic-filter">Lifecycle<select aria-label="Lifecycle filter" value={lifecycle} onChange={(event) => onLifecycleChange(event.target.value as 'active' | 'all')}><option value="active">Active</option><option value="all">All lifecycle states</option></select></label></div>
        {kind === 'observation' ? <label className="topic-filter">Observation type<select aria-label="Observation type" value={observationType ?? ''} onChange={(event) => onObservationTypeChange(event.target.value ? event.target.value as 'metric' | 'estimate' | 'consensus' : undefined)}><option value="">All observation types</option><option value="metric">Metric</option><option value="estimate">Estimate</option><option value="consensus">Consensus</option></select></label> : null}
        {kind === 'claim' ? <label className="topic-filter">Claim type<select aria-label="Claim type" value={claimType ?? ''} onChange={(event) => onClaimTypeChange(event.target.value || undefined)}><option value="">All claim types</option>{['fact','forecast','viewpoint','trend','risk','assumption','thesis','catalyst'].map((value) => <option key={value} value={value}>{value}</option>)}</select></label> : null}
        {kind === 'relation' ? <label className="topic-filter">Relation type<select aria-label="Relation type" value={relationType ?? ''} onChange={(event) => onRelationTypeChange(event.target.value || undefined)}><option value="">All relation types</option>{relationTypes.map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label> : null}
        {pageError ? <div className="inline-error topic-error">{pageError} <button type="button" onClick={() => { setCursorStack([undefined]); setPageIndex(0); setPageError('') }}>Reload first page</button></div> : null}
        {pageBusy ? <p className="topic-empty">Loading {titleFor(kind!)}…</p> : null}
        {!pageBusy && page?.items.length === 0 ? <p className="topic-empty">No {titleFor(kind!).toLowerCase()} records in this scope.</p> : null}
        <div className="topic-item-list">{page?.items.map((item) => <TopicItemCard key={`${item.kind}:${item.ref}`} item={item} selected={item.ref === selectedRef} onSelect={onSelect} onFocus={onFocus} />)}</div>
        {page ? <div className="topic-pagination"><span>{page.totalExact ? `${page.total} total` : `At least ${page.total} · total not exact`}{page.truncated ? ' · results truncated' : ''}</span><div><button disabled={pageIndex === 0 || pageBusy} onClick={onPrevious}>Previous</button><button disabled={!page.nextCursor || pageBusy} onClick={onNext}>Next</button></div></div> : null}
      </div>}
    </> : null}
  </section>
}

function TopicItemCard({ item, selected, onSelect, onFocus }: { readonly item: KnowledgeTopicItem; readonly selected: boolean; readonly onSelect: (ref: string) => void; readonly onFocus: (ref: string) => void }): ReactElement {
  const entries = Object.entries(item.fields).filter(([key, value]) => !['url', 'sourceUrl', 'canonicalUrl'].includes(key) && fieldText(key, value) !== undefined)
  const linkPermitted = item.kind === 'source' && item.fields.rightsAccessScope === 'public' && item.fields.providerTermsKnown === true
  const url = linkPermitted ? safeUrl(item.fields.canonicalUrl) : undefined
  return <article className={`topic-item-card ${selected ? 'selected' : ''}`}>
    <div className="topic-item-topline"><span className="topic-kind">{titleFor(item.kind)}</span><span className="topic-lifecycle">{item.lifecycleStatus}</span>{item.scope === 'connected' ? <span className="topic-state">Related entity knowledge</span> : <span className="topic-state">Direct</span>}</div>
    <button type="button" className="topic-item-title" onClick={() => onSelect(item.ref)}>{item.label}</button>
    <p className="topic-item-summary">{item.summary ?? 'No summary recorded.'}</p>
    <p className="topic-item-date">{itemDate(item)}</p>
    {entries.length ? <dl className="topic-item-fields">{entries.map(([key, value]) => <Fragment key={key}><dt>{key}</dt><dd>{fieldText(key, value)}</dd></Fragment>)}</dl> : null}
    {item.associationPaths?.length ? <div className="topic-paths"><strong>Proven association path</strong>{item.associationPaths.map((path, index) => <div key={`${path.entityRef}:${index}`}><p>{pathText(path)}</p><button type="button" onClick={() => onFocus(path.entityRef)}>Focus {path.entityRef}</button></div>)}</div> : null}
    {url ? <a className="graph-evidence-link" href={url} target="_blank" rel="noreferrer noopener">Open source</a> : item.kind === 'source' ? <p className="topic-rights-note">Source URL is unavailable or not permitted for this view.</p> : null}
  </article>
}
