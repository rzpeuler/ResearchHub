import { Fragment, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { RuntimeClientError, type KnowledgeObjectResponse, type KnowledgeTopicKind } from '../../api/runtime-client'

type RecordValue = Record<string, unknown>
type EstimateRevisionEntry = { readonly ref: string; readonly publishedAt?: string; readonly value?: string }
type EstimateRevisionChain = { readonly ref: string; readonly entries: readonly EstimateRevisionEntry[]; readonly status: 'loading' | 'complete' | 'cycle' | 'missing' | 'incompatible' | 'capped' | 'error'; readonly issueRef?: string }
const maxEstimateRevisionEntries = 20
const blockedField = /raw|quote|excerpt|body|content|local|absolute|file.?path|filesystem|credential|token/i
function rec(value: unknown): RecordValue | undefined { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as RecordValue : undefined }
function str(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value : undefined }
function safeText(value: string): string | undefined {
  if (/(?:^|[^A-Za-z0-9+.-])file:/i.test(value) || /(?:^|[\s=(\["'])\/(?!\/)(?:[^\s/]+\/)*[^\s/]+/.test(value) || /(?:^|[\s=(])(?:[A-Za-z]:[\\/]|\\\\)/i.test(value)) return undefined
  return value
}
function safeUrl(value: unknown): string | undefined {
  const candidate = str(value); if (!candidate) return undefined
  try { const parsed = new URL(candidate); return candidate.length <= 2_048 && (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !parsed.username && !parsed.password ? parsed.toString() : undefined } catch { return undefined }
}
function displayKey(value: string): string {
  const labels: Readonly<Record<string, string>> = { institutionRef: 'Institution', analystRef: 'Analyst', currency: 'Currency', estimateHorizon: 'Estimate horizon', revisionOf: 'Revised from', contributingObservationRefs: 'Contributing observations', contentHash: 'Content hash', aiProcessingAllowed: 'AI processing allowed', derivativeKnowledgeAllowed: 'Derivative knowledge allowed', retainRaw: 'Retain Raw', allowAiProcessing: 'Allow AI processing', allowDerivedKnowledge: 'Allow derived knowledge' }
  return labels[value] ?? value.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ')
}
function displayValue(value: unknown, key: string): string | undefined {
  if ((blockedField.test(key) && key !== 'contentHash') || value === undefined || value === null) return undefined
  if (typeof value === 'string') return safeText(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.filter((item) => ['string', 'number', 'boolean'].includes(typeof item)).map((item) => typeof item === 'string' ? safeText(item) : String(item)).filter((item): item is string => item !== undefined).join(', ') || undefined
  return undefined
}
function usagePolicyValue(key: string, value: unknown): string | undefined {
  // This one known boolean is safe policy metadata despite the generic Raw-field denylist.
  if (key === 'retainRaw' && typeof value === 'boolean') return String(value)
  return displayValue(value, key)
}
function nestedRows(value: unknown, prefix: string, depth = 0): readonly [string, string][] {
  if (depth > 2 || blockedField.test(prefix)) return []
  if (Array.isArray(value)) return value.flatMap((item, index) => typeof item === 'object' && item !== null ? nestedRows(item, `${prefix}.${index}`, depth + 1) : displayValue(item, prefix) ? [[`${prefix}.${index}`, displayValue(item, prefix)!] as const] : [])
  const nested = rec(value)
  if (!nested) return []
  return Object.entries(nested).flatMap(([key, item]) => {
    const path = `${prefix}.${key}`
    const rendered = displayValue(item, key)
    return rendered ? [[path, rendered] as const] : nestedRows(item, path, depth + 1)
  })
}
function safeFields(object: RecordValue, kind: KnowledgeTopicKind): readonly [string, unknown][] {
  const common = ['id', 'type', 'title', 'name', 'description', 'claimType', 'statement', 'structuredValue', 'confidence', 'probability', 'value', 'unit', 'period', 'metricRef', 'estimateValue', 'fiscalPeriod', 'analyst', 'analystRef', 'institutionRef', 'currency', 'estimateHorizon', 'revisionOf', 'contributorCount', 'count', 'mean', 'median', 'high', 'low', 'dispersion', 'contributingObservationRefs', 'eventType', 'occurredAt', 'announcedAt', 'startAt', 'endAt', 'effectiveAt', 'asOf', 'recordedAt', 'createdAt', 'updatedAt', 'publishedAt', 'sourceRef', 'sourceRefs', 'publisher', 'provider', 'retrievedAt', 'contentHash', 'status', 'lifecycle', 'subjectRef', 'subjectRefs', 'participantRefs', 'targetRef', 'targetRefs', 'contextRefs', 'supportsClaimRefs', 'dependsOnClaimRefs', 'contradictsClaimRefs', 'supersedes', 'supersededBy', 'relationType', 'columns', 'rows', 'targetEntity', 'source', 'target', 'fromRef', 'toRef', 'attributes', 'temporal', 'dimensions']
  const thesis = ['title', 'statement', 'status', 'createdAt', 'updatedAt', 'lastReviewedAt', 'killCriteria']
  const relation = ['type', 'sourceRef', 'targetRef', 'contextRefs', 'confidence', 'asOf', 'attributes', 'lifecycle']
  const reasoning = ['type', 'sourceRef', 'targetRef', 'sourceRefs', 'confidence', 'asOf', 'createdAt', 'updatedAt', 'lifecycle']
  const preferred = kind === 'thesis' ? thesis : kind === 'relation' ? relation : kind === 'reasoning_edge' ? reasoning : common
  return preferred.filter((key) => key in object && (!blockedField.test(key) || key === 'contentHash')).map((key) => [key, object[key]] as const)
}
function flattenCriterion(value: unknown): readonly [string, string][] {
  const criterion = rec(value); if (!criterion) return []
  const definition = rec(criterion.definition)
  const authority = rec(criterion.authority)
  const origin = rec(authority?.origin)
  const definitionKnown = criterion.type === 'numeric_threshold' && criterion.definitionVersion === 1
  const rows: [string, string][] = []
  for (const key of ['conditionId', 'type', 'revision', 'state', 'definitionVersion', 'effectiveAt', 'definitionHash']) {
    const text = displayValue(criterion[key], key); if (text) rows.push([displayKey(key), text])
  }
  if (Array.isArray(criterion.targetClaimRefs)) rows.push(['Target claims', criterion.targetClaimRefs.filter((item): item is string => typeof item === 'string' && /^claim:[^\s/\\]+$/.test(item)).join(', ')])
  rows.push(['Evaluation', definitionKnown ? 'Known numeric threshold definition' : 'Current type/version is not evaluable'])
  if (definition) for (const [key, item] of Object.entries(definition)) { const text = displayValue(item, key); if (text) rows.push([displayKey(key), text]) }
  for (const key of ['workflowRunId', 'confirmedAt']) { const text = displayValue(authority?.[key], key); if (text) rows.push([`authority ${displayKey(key)}`, text]) }
  const originKind = displayValue(origin?.kind, 'kind'); if (originKind) rows.push(['authority origin', originKind])
  const originSource = displayValue(origin?.sourceRef, 'sourceRef'); if (originSource) rows.push(['authority source', originSource])
  return rows
}

export function TopicInspector({ refValue, client, onFocus }: { readonly refValue?: string; readonly client: import('../../api/runtime-client').RuntimeClient; readonly onFocus: (ref: string) => void }): ReactElement {
  const [detail, setDetail] = useState<KnowledgeObjectResponse>()
  const [error, setError] = useState('')
  const [revisionChain, setRevisionChain] = useState<EstimateRevisionChain>()
  useEffect(() => {
    if (!refValue) { setDetail(undefined); setError(''); return }
    let current = true
    setDetail(undefined); setError('')
    void client.getKnowledgeObject(refValue).then((value) => { if (current) setDetail(value) }).catch((caught: unknown) => { if (current) setError(caught instanceof RuntimeClientError ? caught.message : 'Canonical detail unavailable') })
    return () => { current = false }
  }, [client, refValue])
  const object = rec(detail?.object)
  const kind = (detail?.kind ?? refValue?.split(':')[0] ?? 'Knowledge').toLowerCase().replace('-', '_') as KnowledgeTopicKind
  const source = kind === 'source'
  const rights = rec(object?.rights)
  const usagePolicy = rec(object?.usagePolicy)
  const accessScope = str(rights?.accessScope) ?? 'unknown'
  const linkPermitted = accessScope === 'public' && rights?.providerTermsKnown === true
  const url = source && linkPermitted ? safeUrl(object?.canonicalUrl) : undefined
  const entries = object ? safeFields(object, kind).filter(([key]) => key !== 'canonicalUrl' && !(kind === 'claim' && ['supportsClaimRefs', 'dependsOnClaimRefs', 'contradictsClaimRefs', 'supersedes', 'supersededBy'].includes(key))) : []
  const criteria = Array.isArray(object?.killCriteria) ? object.killCriteria : []
  const isThesis = kind === 'thesis'
  const isModule = kind === 'module'
  const observationType = kind === 'observation' ? str(object?.observationType) : undefined
  const isConsensus = observationType === 'consensus'
  const isEstimate = observationType === 'estimate'
  const rows = Array.isArray(object?.rows) ? object.rows : []
  const columns = Array.isArray(object?.columns) ? object.columns : []
  const moduleColumns = columns.map((column) => str(rec(column)?.name) ?? str(column) ?? '')
  const claimRelationKeys = ['supportsClaimRefs', 'dependsOnClaimRefs', 'contradictsClaimRefs', 'supersedes', 'supersededBy'] as const
  const claimRelationships = object && kind === 'claim' ? claimRelationKeys.flatMap((key) => {
    const value = object[key]
    const refs = typeof value === 'string' ? [value] : Array.isArray(value) ? value : []
    return refs.filter((ref): ref is string => typeof ref === 'string' && /^claim:/.test(ref)).map((ref) => [key, ref] as const)
  }) : []
  const linkRefs = object ? Object.entries(object).flatMap(([key, value]) => {
    if (claimRelationKeys.includes(key as typeof claimRelationKeys[number])) return []
    if (blockedField.test(key)) return []
    if (typeof value === 'string' && /(?:Ref|Refs)$/.test(key) && /^(?:entity|relation|claim|source|module|event|observation|thesis|reasoning-edge):/.test(value)) return [value]
    if (Array.isArray(value) && /Refs$/.test(key)) return value.filter((item): item is string => typeof item === 'string' && /^(?:entity|relation|claim|source|module|event|observation|thesis|reasoning-edge):/.test(item))
    return []
  }).concat(criteria.flatMap((criterion) => {
    const value = rec(criterion)?.targetClaimRefs
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && /^claim:/.test(item)) : []
  })) : []
  useEffect(() => {
    if (!refValue || detail?.ref !== refValue || !object || kind !== 'observation' || observationType !== 'estimate') { setRevisionChain(undefined); return }
    let current = true
    setRevisionChain({ ref: refValue, entries: [], status: 'loading' })
    const load = async (): Promise<void> => {
      const newestFirst: EstimateRevisionEntry[] = []
      const seen = new Set<string>()
      let cursorRef = refValue
      let cursorObject: RecordValue = object
      let status: EstimateRevisionChain['status'] = 'capped'
      let issueRef: string | undefined
      for (let index = 0; index < maxEstimateRevisionEntries; index += 1) {
        if (seen.has(cursorRef)) { status = 'cycle'; issueRef = cursorRef; break }
        seen.add(cursorRef)
        const value = displayValue(cursorObject.estimateValue, 'estimateValue')
        const publishedAt = safeText(str(cursorObject.publishedAt) ?? '')
        newestFirst.push({ ref: cursorRef, ...(publishedAt ? { publishedAt } : {}), ...(value !== undefined ? { value } : {}) })
        const predecessor = cursorObject.revisionOf
        if (predecessor === undefined || predecessor === null || predecessor === '') { status = 'complete'; break }
        if (typeof predecessor !== 'string' || !/^observation:[^\s/\\]+$/.test(predecessor)) { status = 'incompatible'; issueRef = typeof predecessor === 'string' ? predecessor : undefined; break }
        if (seen.has(predecessor)) { status = 'cycle'; issueRef = predecessor; break }
        if (newestFirst.length >= maxEstimateRevisionEntries) { status = 'capped'; issueRef = predecessor; break }
        let response: KnowledgeObjectResponse
        try { response = await client.getKnowledgeObject(predecessor) }
        catch (caught) {
          status = caught instanceof RuntimeClientError && (caught.code === 'not_found' || caught.status === 404) ? 'missing' : 'error'
          issueRef = predecessor
          break
        }
        const predecessorObject = rec(response.object)
        if (response.ref !== predecessor || response.kind.toLowerCase() !== 'observation' || predecessorObject?.observationType !== 'estimate') { status = 'incompatible'; issueRef = predecessor; break }
        cursorRef = predecessor
        cursorObject = predecessorObject
      }
      if (current) setRevisionChain({ ref: refValue, entries: newestFirst.reverse(), status, ...(issueRef ? { issueRef } : {}) })
    }
    void load()
    return () => { current = false }
  }, [client, detail?.ref, kind, object, observationType, refValue])
  return <aside className="graph-inspector topic-inspector" aria-label="Knowledge Inspector"><div className="graph-panel-heading"><div><span className="eyebrow">CANONICAL DETAIL</span><h2>Inspector</h2></div><span className="read-only-badge">Read-only</span></div>
    {!refValue ? <div className="notice"><strong>Select a graph or content item</strong><p>Canonical fields, lifecycle, time, relations, and provenance appear here.</p></div> : <>
      <span className="graph-inspector-type">{detail?.kind ?? 'Knowledge object'}</span><h3>{safeText(str(object?.title) ?? str(object?.name) ?? str(object?.statement) ?? refValue) ?? refValue}</h3><p className="graph-ref">{refValue}</p>
      {error ? <div className="inline-error topic-error">{error}</div> : !detail ? <p className="topic-empty">Loading canonical detail…</p> : <>
      {source ? <p className="topic-rights-note">Source access: {accessScope}. {url ? 'Only permitted source metadata and a safe external link are shown.' : 'No safe, permitted HTTP(S) canonical URL is available.'}</p> : null}
        <section className="graph-detail-section"><h4>{isThesis ? 'Thesis fields' : kind === 'relation' ? 'Relation direction and attributes' : kind === 'reasoning_edge' ? 'Reasoning direction' : `${detail.kind} fields`}</h4>
          {isThesis ? <dl className="graph-meta"><dt>Thesis status</dt><dd>{str(object?.status) ?? 'Not recorded'}</dd><dt>Lifecycle</dt><dd>{str(rec(object?.lifecycle)?.status) ?? 'Not recorded'}</dd></dl> : null}
          <dl className="graph-meta">{entries.filter(([key]) => !['status', 'lifecycle', 'killCriteria', 'columns', 'rows'].includes(key) && !(key === 'dimensions' && kind === 'observation') && !(isConsensus && ['median', 'high', 'low', 'dispersion'].includes(key))).flatMap(([key, value]) => { const rendered = displayValue(value, key); if (rendered) return [<Fragment key={key}><dt>{displayKey(key)}</dt><dd>{rendered}</dd></Fragment>]; return nestedRows(value, key).map(([nestedKey, nestedValue]) => <Fragment key={nestedKey}><dt>{displayKey(nestedKey)}</dt><dd>{nestedValue}</dd></Fragment>) })}</dl>
          {kind === 'observation' && observationType === 'metric' && object?.dimensions !== undefined ? <section className="graph-detail-section"><h4>Metric dimensions</h4><dl className="graph-meta">{nestedRows(object.dimensions, 'dimensions').map(([key, value]) => <Fragment key={key}><dt>{displayKey(key.replace(/^dimensions\./, ''))}</dt><dd>{value}</dd></Fragment>)}</dl></section> : null}
          {isConsensus ? <dl className="graph-meta topic-consensus-range"><dt>Median</dt><dd>{displayValue(object?.median, 'median') ?? 'Not recorded'}</dd><dt>Range (low–high)</dt><dd>{`${displayValue(object?.low, 'low') ?? 'Not recorded'} – ${displayValue(object?.high, 'high') ?? 'Not recorded'}`}</dd><dt>Dispersion</dt><dd>{displayValue(object?.dispersion, 'dispersion') ?? 'Not recorded'}</dd></dl> : null}
          {source ? <dl className="graph-meta"><dt>Rights access scope</dt><dd>{accessScope}</dd>{(['providerTermsKnown', 'redistributionAllowed', 'aiProcessingAllowed', 'derivativeKnowledgeAllowed', 'retentionAllowed', 'expiresAt', 'entitlementRef', 'policyBasis'] as const).flatMap((key) => { const rendered = displayValue(rights?.[key], key); return rendered ? [<Fragment key={`rights-${key}`}><dt>{displayKey(key)}</dt><dd>{rendered}</dd></Fragment>] : [] })}{(['mode', 'retainRaw', 'allowAiProcessing', 'allowDerivedKnowledge', 'redistributionAllowed'] as const).flatMap((key) => { const rendered = usagePolicyValue(key, usagePolicy?.[key]); return rendered ? [<Fragment key={`usage-${key}`}><dt>Usage policy {displayKey(key)}</dt><dd>{rendered}</dd></Fragment>] : [] })}</dl> : null}
          {source && url ? <a className="graph-evidence-link" href={url} target="_blank" rel="noreferrer noopener">Open source</a> : null}
          {isModule ? columns.length && rows.length ? <div className="topic-module-table-wrap"><table className="topic-module-table"><thead><tr>{moduleColumns.map((column, index) => <th key={`${column}:${index}`}>{column}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => { const rowRecord = rec(row); const cells = Array.isArray(row) ? row : []; return <tr key={rowIndex}>{moduleColumns.map((column, colIndex) => <td key={colIndex}>{displayValue(Array.isArray(row) ? cells[colIndex] : rowRecord?.[column], `cell${colIndex}`) ?? '—'}</td>)}</tr> })}</tbody></table></div> : <p className="topic-empty">Module table unavailable: {!columns.length && !rows.length ? 'columns and rows are not recorded.' : !columns.length ? 'columns are not recorded.' : 'rows are not recorded.'}</p> : null}
        </section>
        {isThesis ? <section className="graph-detail-section"><h4>Kill criteria</h4>{criteria.length ? criteria.map((criterion, index) => <dl className="graph-evidence-meta topic-criterion" key={index}>{flattenCriterion(criterion).map(([key, value]) => <Fragment key={key}><dt>{key}</dt><dd>{value}</dd></Fragment>)}</dl>) : <p className="muted">No kill criteria recorded.</p>}</section> : null}
        {isEstimate && revisionChain?.ref === refValue ? <section className="graph-detail-section topic-revision-chain" aria-label="Estimate revision chain"><h4>Estimate revision chain</h4>
          {revisionChain.status === 'loading' ? <p className="topic-empty">Loading referenced estimate revisions…</p> : null}
          {revisionChain.status === 'complete' ? <p className="topic-boundary">{revisionChain.entries.length === 1 ? 'No predecessor reference is recorded.' : 'Reached the oldest referenced estimate; no earlier revision is recorded.'}</p> : null}
          {revisionChain.status === 'cycle' ? <p className="topic-rights-note">Revision cycle detected at {revisionChain.issueRef}; only the bounded unique chain is shown.</p> : null}
          {revisionChain.status === 'missing' ? <p className="topic-rights-note">Referenced predecessor is missing: {revisionChain.issueRef}.</p> : null}
          {revisionChain.status === 'incompatible' ? <p className="topic-rights-note">The referenced predecessor is not a valid canonical Estimate Observation: {revisionChain.issueRef ?? 'reference unavailable'}.</p> : null}
          {revisionChain.status === 'capped' ? <p className="topic-rights-note">Revision history is capped at {maxEstimateRevisionEntries} observations. An older referenced observation may remain: {revisionChain.issueRef ?? 'not loaded'}.</p> : null}
          {revisionChain.status === 'error' ? <p className="topic-rights-note">Could not load the referenced predecessor: {revisionChain.issueRef ?? 'reference unavailable'}.</p> : null}
          {revisionChain.entries.length ? <ol>{revisionChain.entries.map((entry, index) => <li key={`${entry.ref}:${index}`}><dl className="graph-meta"><dt>Published at</dt><dd>{entry.publishedAt ?? 'Not recorded'}</dd><dt>Estimate value</dt><dd>{entry.value ?? 'Not recorded'}</dd><dt>Canonical ref</dt><dd><button type="button" className="topic-inline-link" aria-current={entry.ref === refValue ? 'true' : undefined} onClick={() => onFocus(entry.ref)}>{entry.ref}</button>{entry.ref === refValue ? ' · selected' : ''}</dd></dl></li>)}</ol> : null}
        </section> : null}
        {claimRelationships.length ? <section className="graph-detail-section"><h4>Claim relationships</h4><dl className="graph-meta">{claimRelationships.map(([key, ref], index) => <Fragment key={`${key}:${ref}:${index}`}><dt>{{ supportsClaimRefs: 'Supports', dependsOnClaimRefs: 'Depends on', contradictsClaimRefs: 'Contradicts', supersedes: 'Supersedes', supersededBy: 'Superseded by' }[key]}</dt><dd><button type="button" className="topic-inline-link" onClick={() => onFocus(ref)}>{ref}</button></dd></Fragment>)}</dl></section> : null}
        {linkRefs.length ? <section className="graph-detail-section"><h4>Canonical references</h4><div className="topic-reference-list">{[...new Set(linkRefs)].map((ref) => <button key={ref} onClick={() => onFocus(ref)}>{ref}</button>)}</div></section> : null}
        {!source && Array.isArray(object?.provenance) && object.provenance.length ? <section className="graph-detail-section"><h4>Evidence locations</h4>{object.provenance.map((item, index) => { const evidence = rec(item); if (!evidence) return null; return <dl className="graph-evidence-meta" key={index}>{(['sourceRef', 'locator', 'chunkRef'] as const).map((key) => { const rendered = displayValue(evidence[key], key); return rendered ? <Fragment key={key}><dt>{displayKey(key)}</dt><dd>{rendered}</dd></Fragment> : null })}</dl> })}</section> : null}
      </>}
    </>}
  </aside>
}
