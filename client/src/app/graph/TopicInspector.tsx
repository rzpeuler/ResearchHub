import { Fragment, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { RuntimeClientError, type KnowledgeObjectResponse, type KnowledgeTopicKind } from '../../api/runtime-client'

type RecordValue = Record<string, unknown>
const blockedField = /raw|quote|excerpt|body|content|local|absolute|file.?path|filesystem|credential|token/i
function rec(value: unknown): RecordValue | undefined { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as RecordValue : undefined }
function str(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value : undefined }
function safeText(value: string): string | undefined {
  if (/(?:^|[\s=(])(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|etc|private|tmp|var|mnt|workspace|root)(?:\/|$))/i.test(value)) return undefined
  return value
}
function safeUrl(value: unknown): string | undefined {
  const candidate = str(value); if (!candidate) return undefined
  try { const parsed = new URL(candidate); return candidate.length <= 2_048 && (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !parsed.username && !parsed.password ? parsed.toString() : undefined } catch { return undefined }
}
function displayKey(value: string): string { return value.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ') }
function displayValue(value: unknown, key: string): string | undefined {
  if (blockedField.test(key) || value === undefined || value === null) return undefined
  if (typeof value === 'string') return safeText(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.filter((item) => ['string', 'number', 'boolean'].includes(typeof item)).map(String).join(', ') || undefined
  return undefined
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
  const common = ['id', 'type', 'title', 'name', 'description', 'claimType', 'statement', 'structuredValue', 'confidence', 'probability', 'value', 'unit', 'period', 'metricRef', 'estimateValue', 'fiscalPeriod', 'analyst', 'contributorCount', 'mean', 'median', 'high', 'low', 'dispersion', 'eventType', 'occurredAt', 'announcedAt', 'startAt', 'endAt', 'effectiveAt', 'asOf', 'recordedAt', 'createdAt', 'updatedAt', 'publishedAt', 'sourceRef', 'publisher', 'canonicalUrl', 'status', 'lifecycle', 'subjectRef', 'subjectRefs', 'participantRefs', 'sourceRefs', 'targetRef', 'targetRefs', 'contextRefs', 'supportingClaimRefs', 'contradictingClaimRefs', 'supersedesRefs', 'relationType', 'columns', 'rows', 'targetEntity', 'source', 'target', 'fromRef', 'toRef', 'attributes', 'temporal', 'dimensions']
  const thesis = ['title', 'statement', 'status', 'createdAt', 'updatedAt', 'lastReviewedAt', 'killCriteria']
  const relation = ['type', 'sourceRef', 'targetRef', 'contextRefs', 'confidence', 'asOf', 'attributes', 'lifecycle']
  const reasoning = ['type', 'sourceRef', 'targetRef', 'sourceRefs', 'confidence', 'asOf', 'createdAt', 'updatedAt', 'lifecycle']
  const preferred = kind === 'thesis' ? thesis : kind === 'relation' ? relation : kind === 'reasoning_edge' ? reasoning : common
  return preferred.filter((key) => key in object && !blockedField.test(key)).map((key) => [key, object[key]] as const)
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
  if (Array.isArray(criterion.targetClaimRefs)) rows.push(['Target claims', criterion.targetClaimRefs.filter((item): item is string => typeof item === 'string').join(', ')])
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
  const accessScope = str(rights?.accessScope) ?? 'unknown'
  const linkPermitted = accessScope === 'public' && rights?.providerTermsKnown === true
  const url = source && linkPermitted ? safeUrl(object?.canonicalUrl) : undefined
  const entries = object ? safeFields(object, kind).filter(([key]) => key !== 'canonicalUrl' || linkPermitted) : []
  const criteria = Array.isArray(object?.killCriteria) ? object.killCriteria : []
  const isThesis = kind === 'thesis'
  const isModule = kind === 'module'
  const rows = Array.isArray(object?.rows) ? object.rows : []
  const columns = Array.isArray(object?.columns) ? object.columns : []
  const moduleColumns = columns.map((column) => str(rec(column)?.name) ?? str(column) ?? '')
  const linkRefs = object ? Object.entries(object).flatMap(([key, value]) => {
    if (blockedField.test(key)) return []
    if (typeof value === 'string' && /(?:Ref|Refs)$/.test(key) && /^(?:entity|relation|claim|source|module|event|observation|thesis|reasoning-edge):/.test(value)) return [value]
    if (Array.isArray(value) && /Refs$/.test(key)) return value.filter((item): item is string => typeof item === 'string' && /^(?:entity|relation|claim|source|module|event|observation|thesis|reasoning-edge):/.test(item))
    return []
  }).concat(criteria.flatMap((criterion) => {
    const value = rec(criterion)?.targetClaimRefs
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && /^claim:/.test(item)) : []
  })) : []
  return <aside className="graph-inspector topic-inspector" aria-label="Knowledge Inspector"><div className="graph-panel-heading"><div><span className="eyebrow">CANONICAL DETAIL</span><h2>Inspector</h2></div><span className="read-only-badge">Read-only</span></div>
    {!refValue ? <div className="notice"><strong>Select a graph or content item</strong><p>Canonical fields, lifecycle, time, relations, and provenance appear here.</p></div> : <>
      <span className="graph-inspector-type">{detail?.kind ?? 'Knowledge object'}</span><h3>{safeText(str(object?.title) ?? str(object?.name) ?? str(object?.statement) ?? refValue) ?? refValue}</h3><p className="graph-ref">{refValue}</p>
      {error ? <div className="inline-error topic-error">{error}</div> : !detail ? <p className="topic-empty">Loading canonical detail…</p> : <>
        {source ? <p className="topic-rights-note">Source access: {accessScope}. {linkPermitted ? 'Only permitted source metadata and a safe external link are shown.' : 'Rights metadata does not permit a source link in this view.'}</p> : null}
        <section className="graph-detail-section"><h4>{isThesis ? 'Thesis fields' : kind === 'relation' ? 'Relation direction and attributes' : kind === 'reasoning_edge' ? 'Reasoning direction' : `${detail.kind} fields`}</h4>
          {isThesis ? <dl className="graph-meta"><dt>Thesis status</dt><dd>{str(object?.status) ?? 'Not recorded'}</dd><dt>Lifecycle</dt><dd>{str(rec(object?.lifecycle)?.status) ?? 'Not recorded'}</dd></dl> : null}
          <dl className="graph-meta">{entries.filter(([key]) => !['status', 'lifecycle', 'killCriteria', 'columns', 'rows'].includes(key)).flatMap(([key, value]) => { const rendered = displayValue(value, key); if (rendered) return [<Fragment key={key}><dt>{displayKey(key)}</dt><dd>{rendered}</dd></Fragment>]; return nestedRows(value, key).map(([nestedKey, nestedValue]) => <Fragment key={nestedKey}><dt>{displayKey(nestedKey)}</dt><dd>{nestedValue}</dd></Fragment>) })}</dl>
          {source ? <dl className="graph-meta"><dt>Rights</dt><dd>{accessScope}</dd>{typeof rights?.providerTermsKnown === 'boolean' ? <><dt>Terms known</dt><dd>{String(rights.providerTermsKnown)}</dd></> : null}{typeof rights?.retentionAllowed === 'string' || typeof rights?.retentionAllowed === 'boolean' ? <><dt>Retention</dt><dd>{String(rights.retentionAllowed)}</dd></> : null}</dl> : null}
          {source && url ? <a className="graph-evidence-link" href={url} target="_blank" rel="noreferrer noopener">Open source</a> : null}
          {isModule && columns.length && rows.length ? <div className="topic-module-table-wrap"><table className="topic-module-table"><thead><tr>{moduleColumns.map((column, index) => <th key={`${column}:${index}`}>{column}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => { const rowRecord = rec(row); const cells = Array.isArray(row) ? row : []; return <tr key={rowIndex}>{moduleColumns.map((column, colIndex) => <td key={colIndex}>{displayValue(Array.isArray(row) ? cells[colIndex] : rowRecord?.[column], `cell${colIndex}`) ?? '—'}</td>)}</tr> })}</tbody></table></div> : null}
        </section>
        {isThesis ? <section className="graph-detail-section"><h4>Kill criteria</h4>{criteria.length ? criteria.map((criterion, index) => <dl className="graph-evidence-meta topic-criterion" key={index}>{flattenCriterion(criterion).map(([key, value]) => <Fragment key={key}><dt>{key}</dt><dd>{value}</dd></Fragment>)}</dl>) : <p className="muted">No kill criteria recorded.</p>}</section> : null}
        {linkRefs.length ? <section className="graph-detail-section"><h4>Canonical references</h4><div className="topic-reference-list">{[...new Set(linkRefs)].map((ref) => <button key={ref} onClick={() => onFocus(ref)}>{ref}</button>)}</div></section> : null}
        {!source && Array.isArray(object?.provenance) && object.provenance.length ? <section className="graph-detail-section"><h4>Evidence locations</h4>{object.provenance.map((item, index) => { const evidence = rec(item); if (!evidence) return null; return <dl className="graph-evidence-meta" key={index}>{(['sourceRef', 'locator', 'chunkRef'] as const).map((key) => { const rendered = displayValue(evidence[key], key); return rendered ? <Fragment key={key}><dt>{displayKey(key)}</dt><dd>{rendered}</dd></Fragment> : null })}</dl> })}</section> : null}
      </>}
    </>}
  </aside>
}
