import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RuntimeClientError, type RuntimeClient, type KnowledgeTopicKind, type KnowledgeTopicSummary } from '../../api/runtime-client'
import { TopicWorkspace } from './TopicWorkspace'
import { TopicInspector } from './TopicInspector'

const kinds: readonly KnowledgeTopicKind[] = ['relation', 'claim', 'observation', 'event', 'thesis', 'module', 'source', 'reasoning_edge']
function summary(): KnowledgeTopicSummary {
  const counts = Object.fromEntries(kinds.map((kind) => [kind, { total: kind === 'claim' ? 2 : 0, totalExact: kind !== 'claim', truncated: kind === 'claim' }])) as KnowledgeTopicSummary['counts']['direct']
  return { knowledgeBaseId: 'kb', schemaVersion: '0.4', revision: 7, theme: { ref: 'entity:theme-a', name: 'AI Hardware', aliases: ['Accelerator supply chain'], definition: 'Compute systems and supply chain', lifecycleStatus: 'active' }, counts: { direct: counts, connected: counts }, overview: { direct: { latestDatedRecord: { ref: 'claim:risk-a', kind: 'claim', dateField: 'asOf', dateValue: '2026-06-01' }, nonSourceRecordsWithoutExplicitSourceRef: 1, totalExact: true, truncated: false }, connected: { latestDatedRecord: { ref: 'observation:metric-a', kind: 'observation', dateField: 'reportedAt', dateValue: '2026-06-02' }, nonSourceRecordsWithoutExplicitSourceRef: 4, totalExact: false, truncated: true } }, connected: { depth: 2, totalExact: false, truncated: true, focusRefs: ['entity:industry-a'] } }
}
function page(kind: KnowledgeTopicKind, items: readonly unknown[], extra: Record<string, unknown> = {}): unknown {
  return { knowledgeBaseId: 'kb', schemaVersion: '0.4', revision: 7, themeRef: 'entity:theme-a', kind, scope: 'direct', depth: 1, filters: { lifecycle: 'active' }, items, total: 2, totalExact: true, limit: 1, truncated: false, ...extra }
}
function workspaceProps(client: RuntimeClient) {
  return { themeRef: 'entity:theme-a', section: 'claim' as const, scope: 'direct' as const, depth: 1 as const, lifecycle: 'all' as const, observationType: 'estimate' as const, claimType: 'risk', relationType: 'depends_on', selectedRef: undefined, client, onSectionChange: vi.fn(), onScopeChange: vi.fn(), onLifecycleChange: vi.fn(), onObservationTypeChange: vi.fn(), onClaimTypeChange: vi.fn(), onRelationTypeChange: vi.fn(), onSelect: vi.fn(), onFocus: vi.fn() }
}

describe('TopicWorkspace', () => {
  afterEach(() => { cleanup(); window.history.replaceState({}, '', '/graph') })

  it('loads filtered pages without sending filters for other sections and follows cursor pages', async () => {
    const first = { ref: 'claim:risk-a', kind: 'claim', scope: 'direct', lifecycleStatus: 'active', label: 'Memory supply risk', summary: 'HBM supply is tight.', fields: { claimType: 'risk', probability: 0.7 }, date: { field: 'asOf', value: '2026-06-01' } }
    const second = { ...first, ref: 'claim:risk-b', label: 'Packaging capacity risk' }
    const listTopicItems = vi.fn().mockImplementation(({ cursor, kind }: { cursor?: string; kind: KnowledgeTopicKind }) => Promise.resolve(page(kind, cursor ? [second] : [first], cursor ? {} : { nextCursor: 'cursor-page-2' })))
    const client = { getTopicSummary: vi.fn().mockResolvedValue(summary()), listTopicItems } as unknown as RuntimeClient
    const props = workspaceProps(client)
    const view = render(<TopicWorkspace {...props} />)
    expect(await screen.findByText('AI Hardware')).toBeTruthy()
    expect(await screen.findByText('Memory supply risk')).toBeTruthy()
    expect(listTopicItems).toHaveBeenCalledWith(expect.objectContaining({ themeRef: 'entity:theme-a', kind: 'claim', scope: 'direct', expectedRevision: 7, filters: { lifecycle: 'all', claimType: 'risk' } }))
    expect(screen.getByText(/At least 2/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Packaging capacity risk')).toBeTruthy()
    expect(listTopicItems).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'claim', cursor: 'cursor-page-2' }))
    view.rerender(<TopicWorkspace {...props} graphRootRef="entity:industry-a" />)
    await waitFor(() => expect(listTopicItems).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'claim', scope: 'direct' })))
    expect(listTopicItems.mock.calls.at(-1)?.[0].cursor).toBeUndefined()
    view.rerender(<TopicWorkspace {...props} section="observation" />)
    await waitFor(() => expect(listTopicItems).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'observation', filters: { lifecycle: 'all', observationType: 'estimate' } })))
    expect(listTopicItems).not.toHaveBeenLastCalledWith(expect.objectContaining({ filters: expect.objectContaining({ claimType: 'risk', relationType: 'depends_on' }) }))
  })

  it('labels connected records and preserves their returned path', async () => {
    const connected = { ref: 'observation:metric-a', kind: 'observation', scope: 'connected', lifecycleStatus: 'active', label: 'HBM shipment index', summary: 'metric:hbm_shipments', fields: { observationType: 'metric', value: 120, unit: 'index' }, associationPaths: [{ entityRef: 'entity:industry-a', hops: [{ relationRef: 'relation:theme-a-industry', sourceRef: 'entity:theme-a', targetRef: 'entity:industry-a' }] }] }
    const client = { getTopicSummary: vi.fn().mockResolvedValue(summary()), listTopicItems: vi.fn().mockResolvedValue(page('observation', [connected], { scope: 'connected' })) } as unknown as RuntimeClient
    render(<TopicWorkspace {...workspaceProps(client)} section="observation" scope="connected" lifecycle="active" observationType="metric" claimType={undefined} relationType={undefined} />)
    expect(await screen.findByText('HBM shipment index')).toBeTruthy()
    expect(screen.getByText('Related entity knowledge')).toBeTruthy()
    expect(screen.getByText(/entity:theme-a —\[relation:theme-a-industry\]→ entity:industry-a/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Focus entity:industry-a' })).toBeTruthy()
  })

  it('shows per-scope overview fields and honest connected lower-bound guidance', async () => {
    const client = { getTopicSummary: vi.fn().mockResolvedValue(summary()), listTopicItems: vi.fn() } as unknown as RuntimeClient
    render(<TopicWorkspace {...workspaceProps(client)} section="overview" />)
    expect(await screen.findByRole('region', { name: 'direct overview' })).toBeTruthy()
    expect(screen.getByText('asOf: 2026-06-01 (Claim)')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'claim:risk-a' })).toBeTruthy()
    expect(screen.getAllByText('Records without explicit Source refs')).toHaveLength(2)
    expect(screen.getByText(/At least the returned counts; association scan truncated/)).toBeTruthy()
    expect(screen.queryByText(/not included in this topic summary/)).toBeNull()
    expect(client.listTopicItems).not.toHaveBeenCalled()
  })

  it('renders Source backlinks with the exact count and opens referenced items in Inspector selection', async () => {
    const source = { ref: 'source:filing-a', kind: 'source', scope: 'direct', lifecycleStatus: 'active', label: 'Issuer filing', fields: { provider: 'Issuer', rightsAccessScope: 'public', rightsProviderTermsKnown: true, rightsRedistributionAllowed: false, rightsRetentionAllowed: 'conditional', rightsAiProcessingAllowed: true, rightsDerivativeKnowledgeAllowed: false, rightsExpiresAt: '2027-01-01', rightsPolicyBasis: 'public filing', usagePolicyMode: 'personal_noncommercial_research', usagePolicyRetainRaw: false, usagePolicyAllowAiProcessing: true, usagePolicyAllowDerivedKnowledge: true, usagePolicyRedistributionAllowed: false, canonicalUrl: 'https://example.test/filing', referencedByRefs: ['claim:risk-a', 'observation:metric-a'], referencedByTotal: 5, referencedByTruncated: true } }
    const client = { getTopicSummary: vi.fn().mockResolvedValue(summary()), listTopicItems: vi.fn().mockResolvedValue(page('source', [source])) } as unknown as RuntimeClient
    const props = workspaceProps(client)
    render(<TopicWorkspace {...props} section="source" />)
    expect(await screen.findByText('Issuer filing')).toBeTruthy()
    expect(screen.getByText('5 supported items · reference list truncated')).toBeTruthy()
    expect(screen.getByText('Provider terms known')).toBeTruthy()
    expect(screen.getByText('Rights redistribution allowed')).toBeTruthy()
    expect(screen.getByText('Usage policy permits Raw retention')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'claim:risk-a' }))
    expect(props.onSelect).toHaveBeenCalledWith('claim:risk-a')
    expect(screen.getByRole('link', { name: 'Open source' }).getAttribute('href')).toBe('https://example.test/filing')
  })

  it('refreshes summary and fetches page one after an expected-revision conflict; retry performs a new fetch', async () => {
    const fresh = { ...summary(), revision: 8 }
    const getTopicSummary = vi.fn().mockResolvedValueOnce(summary()).mockResolvedValue(fresh)
    const listTopicItems = vi.fn().mockRejectedValueOnce(new RuntimeClientError('conflict', 'Revision changed', 409)).mockResolvedValue(page('claim', [], { revision: 8 }))
    const client = { getTopicSummary, listTopicItems } as unknown as RuntimeClient
    function Harness() {
      const [lifecycle, setLifecycle] = useState<'all' | 'active'>('all')
      return <TopicWorkspace {...workspaceProps(client)} lifecycle={lifecycle} onLifecycleChange={setLifecycle} />
    }
    render(<Harness />)
    await waitFor(() => expect(listTopicItems).toHaveBeenCalledTimes(2))
    expect(getTopicSummary).toHaveBeenCalledTimes(2)
    expect(listTopicItems.mock.calls[0][0]).toMatchObject({ expectedRevision: 7 })
    expect(listTopicItems.mock.calls[1][0]).toMatchObject({ expectedRevision: 8 })
    expect(listTopicItems.mock.calls[1][0].cursor).toBeUndefined()
    listTopicItems.mockRejectedValueOnce(new Error('Temporary read error'))
    fireEvent.change(screen.getByLabelText('Lifecycle filter'), { target: { value: 'active' } })
    await waitFor(() => expect(listTopicItems).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(screen.getByText('Knowledge topic request failed')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Reload first page' }))
    await waitFor(() => expect(listTopicItems).toHaveBeenCalledTimes(4))
    expect(listTopicItems.mock.calls[3][0].cursor).toBeUndefined()
  })
})

describe('TopicInspector', () => {
  afterEach(() => cleanup())

  it('shows a safe canonical source link only when its public terms permit it and hides Raw fields', async () => {
    const getKnowledgeObject = vi.fn().mockImplementation((ref: string) => Promise.resolve({ ref, kind: 'Source', object: ref === 'source:filing-a' ? { id: ref, title: 'Issuer annual report', publisher: 'Issuer', provider: 'Issuer portal', retrievedAt: '2026-06-02', contentHash: 'sha256:abc', canonicalUrl: 'https://example.test/report', rights: { accessScope: 'public', providerTermsKnown: true, redistributionAllowed: false, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, retentionAllowed: true, policyBasis: 'public filing' }, usagePolicy: { mode: 'metadata_only', retainRaw: false, allowAiProcessing: true, allowDerivedKnowledge: false }, rawRefs: ['raw-sha256-secret'], excerpt: 'private quotation', localPath: 'C:\\private\\report.pdf' } : ref === 'source:restricted-a' ? { id: ref, title: 'Restricted source', publisher: 'Acme C:\\private\\folder', canonicalUrl: 'https://example.test/restricted', rights: { accessScope: 'restricted', providerTermsKnown: true, redistributionAllowed: false }, rawRefs: ['raw-sha256-hidden'], excerpt: 'restricted quote' } : { id: ref, title: 'Unsafe URL source', canonicalUrl: 'file:///C:/private/report.pdf', rights: { accessScope: 'public', providerTermsKnown: true } } }))
    const client = { getKnowledgeObject } as unknown as RuntimeClient
    const view = render(<TopicInspector refValue="source:filing-a" client={client} onFocus={vi.fn()} />)
    expect((await screen.findAllByText('Issuer annual report')).length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: 'Open source' }).getAttribute('href')).toBe('https://example.test/report')
    expect(screen.getByText('Issuer portal')).toBeTruthy()
    expect(screen.getByText('2026-06-02')).toBeTruthy()
    expect(screen.getByText('sha256:abc')).toBeTruthy()
    expect(screen.getByText('AI processing allowed')).toBeTruthy()
    expect(screen.getAllByText(/Usage policy/).length).toBeGreaterThan(0)
    const retainRawPolicy = screen.getByText('Usage policy Retain Raw')
    expect(retainRawPolicy.nextElementSibling?.textContent).toBe('false')
    expect(screen.queryByText(/raw-sha256-secret|private quotation|C:\\private/)).toBeNull()
    expect(screen.queryByText(/Canonical object/)).toBeNull()
    view.rerender(<TopicInspector refValue="source:restricted-a" client={client} onFocus={vi.fn()} />)
    expect((await screen.findAllByText('Restricted source')).length).toBeGreaterThan(0)
    expect(screen.queryByRole('link', { name: 'Open source' })).toBeNull()
    expect(screen.queryByText(/C:\\private|restricted quote|raw-sha256-hidden/)).toBeNull()
    view.rerender(<TopicInspector refValue="source:unsafe-a" client={client} onFocus={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Unsafe URL source' })).toBeTruthy())
    expect(screen.queryByText('file:///C:/private/report.pdf')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Open source' })).toBeNull()
  })

  it('separates Thesis status and lifecycle, marks unknown criterion types unevaluable, and renders Module object rows', async () => {
    const getKnowledgeObject = vi.fn().mockImplementation((ref: string) => Promise.resolve(ref.startsWith('thesis:')
      ? { ref, kind: 'Thesis', object: { id: ref, title: 'Cloud demand thesis', statement: 'Demand grows.', status: 'invalidated', lifecycle: { status: 'active' }, killCriteria: [{ conditionId: 'future-rule', revision: 3, state: 'active', type: 'future_condition', definitionVersion: 2, definition: { threshold: 5 }, effectiveAt: '2026-01-01', definitionHash: 'hash', authority: { workflowRunId: 'run-1', confirmedAt: '2026-01-02', origin: { kind: 'human_rule' } } }] } }
      : { ref, kind: 'Module', object: { id: ref, type: 'comparison', columns: [{ name: 'company' }], rows: [{ company: 'Chipmaker' }] } }))
    const client = { getKnowledgeObject } as unknown as RuntimeClient
    const view = render(<TopicInspector refValue="thesis:cloud-demand" client={client} onFocus={vi.fn()} />)
    expect(await screen.findByText('Thesis status')).toBeTruthy()
    expect(screen.getByText('invalidated')).toBeTruthy()
    expect(screen.getAllByText('active').length).toBeGreaterThan(1)
    expect(screen.getByText('Current type/version is not evaluable')).toBeTruthy()
    view.rerender(<TopicInspector refValue="module:comparison" client={client} onFocus={vi.fn()} />)
    expect(await screen.findByText('Chipmaker')).toBeTruthy()
  })

  it('shows complete observation variants and labeled Claim relationships as Inspector navigation', async () => {
    const getKnowledgeObject = vi.fn().mockImplementation((ref: string) => Promise.resolve(ref.startsWith('observation:metric')
      ? { ref, kind: 'Observation', object: { id: ref, observationType: 'metric', metricRef: 'metric:shipments', value: 120, unit: 'index', dimensions: { region: 'global', product: 'HBM' } } }
      : ref.startsWith('observation:estimate')
      ? { ref, kind: 'Observation', object: { id: ref, observationType: 'estimate', metricRef: 'metric:revenue', fiscalPeriod: 'FY2027', estimateValue: 42, institutionRef: 'entity:bank', analystRef: 'entity:analyst', currency: 'USD', estimateHorizon: '12 months', ...(ref === 'observation:estimate-current' ? { revisionOf: 'observation:estimate-old' } : {}) } }
      : ref.startsWith('observation:consensus')
        ? { ref, kind: 'Observation', object: { id: ref, observationType: 'consensus', metricRef: 'metric:revenue', median: 42, high: 50, low: 35, dispersion: 4, contributingObservationRefs: ['observation:estimate-a'] } }
        : { ref, kind: 'Claim', object: { id: ref, claimType: 'fact', statement: 'Production improved.', supportsClaimRefs: ['claim:support'], dependsOnClaimRefs: ['claim:dependency'], contradictsClaimRefs: ['claim:contradiction'], supersedes: ['claim:old'], supersededBy: ['claim:new'] } }))
    const onFocus = vi.fn()
    const client = { getKnowledgeObject } as unknown as RuntimeClient
    const view = render(<TopicInspector refValue="observation:metric-current" client={client} onFocus={onFocus} />)
    expect(await screen.findByText('Metric dimensions')).toBeTruthy()
    expect(screen.getByText('global')).toBeTruthy()
    view.rerender(<TopicInspector refValue="observation:estimate-current" client={client} onFocus={onFocus} />)
    expect(await screen.findByRole('button', { name: 'entity:bank' })).toBeTruthy()
    expect(screen.getByText('USD')).toBeTruthy()
    expect(screen.getByText('12 months')).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'observation:estimate-old' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'entity:bank' }))
    expect(onFocus).toHaveBeenCalledWith('entity:bank')
    view.rerender(<TopicInspector refValue="observation:consensus-current" client={client} onFocus={onFocus} />)
    expect(await screen.findByText('42')).toBeTruthy()
    expect(screen.getByText('35 – 50')).toBeTruthy()
    expect(screen.getByText('Range (low–high)')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'observation:estimate-a' })).toBeTruthy()
    view.rerender(<TopicInspector refValue="claim:current" client={client} onFocus={onFocus} />)
    expect(await screen.findByText('Claim relationships')).toBeTruthy()
    for (const label of ['Supports', 'Depends on', 'Contradicts', 'Supersedes', 'Superseded by']) expect(screen.getByText(label)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'claim:old' }))
    expect(onFocus).toHaveBeenCalledWith('claim:old')
  })

  it('explains when Module table columns or rows are missing', async () => {
    const client = { getKnowledgeObject: vi.fn().mockResolvedValue({ ref: 'module:empty', kind: 'Module', object: { id: 'module:empty', type: 'comparison', columns: [{ name: 'company' }] } }) } as unknown as RuntimeClient
    render(<TopicInspector refValue="module:empty" client={client} onFocus={vi.fn()} />)
    expect(await screen.findByText('Module table unavailable: rows are not recorded.')).toBeTruthy()
  })

  it('redacts arbitrary Unix absolute paths in free text while retaining safe links and canonical refs', async () => {
    const getKnowledgeObject = vi.fn().mockImplementation((ref: string) => Promise.resolve(ref.startsWith('source:')
      ? { ref, kind: 'Source', object: { id: ref, title: 'Report /opt/private/report.pdf', publisher: 'Stored under /srv/research/restricted', canonicalUrl: 'https://example.test/public/report', rights: { accessScope: 'public', providerTermsKnown: true } } }
      : { ref, kind: 'Claim', object: { id: ref, title: 'Path check', statement: 'See /usr/local/share and /System/Library/PrivateFrameworks; /var/lib/research.', subjectRefs: ['entity:usable'], sourceRefs: ['source:usable'] } }))
    const onFocus = vi.fn()
    const client = { getKnowledgeObject } as unknown as RuntimeClient
    const view = render(<TopicInspector refValue="source:report" client={client} onFocus={onFocus} />)
    expect((await screen.findByRole('link', { name: 'Open source' })).getAttribute('href')).toBe('https://example.test/public/report')
    expect(screen.queryByText(/\/opt\/private|\/srv\/research/)).toBeNull()
    view.rerender(<TopicInspector refValue="claim:path-check" client={client} onFocus={onFocus} />)
    expect(await screen.findByRole('heading', { name: 'Path check' })).toBeTruthy()
    expect(screen.queryByText(/\/usr\/local|\/System\/Library|\/var\/lib/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'entity:usable' }))
    expect(onFocus).toHaveBeenCalledWith('entity:usable')
  })

  it('loads and presents an ordered estimate revision chain with explicit data and navigable refs', async () => {
    const values: Record<string, Record<string, unknown>> = {
      'observation:estimate-current': { id: 'observation:estimate-current', observationType: 'estimate', estimateValue: 42, publishedAt: '2026-06-03', revisionOf: 'observation:estimate-mid' },
      'observation:estimate-mid': { id: 'observation:estimate-mid', observationType: 'estimate', estimateValue: 37, publishedAt: '2026-06-02', revisionOf: 'observation:estimate-old' },
      'observation:estimate-old': { id: 'observation:estimate-old', observationType: 'estimate', estimateValue: 30, publishedAt: '2026-06-01' },
    }
    const getKnowledgeObject = vi.fn((ref: string) => Promise.resolve({ ref, kind: 'Observation', object: values[ref] }))
    const onFocus = vi.fn()
    const client = { getKnowledgeObject } as unknown as RuntimeClient
    render(<TopicInspector refValue="observation:estimate-current" client={client} onFocus={onFocus} />)
    const chain = await screen.findByRole('region', { name: 'Estimate revision chain' })
    const refs = Array.from(chain.querySelectorAll('li button')).map((button) => button.textContent)
    expect(refs).toEqual(['observation:estimate-old', 'observation:estimate-mid', 'observation:estimate-current'])
    expect(chain.textContent).toContain('2026-06-01')
    expect(chain.textContent).toContain('30')
    expect(chain.textContent).toContain('2026-06-03')
    expect(chain.textContent).toContain('42')
    fireEvent.click(screen.getByRole('button', { name: 'observation:estimate-old' }))
    expect(onFocus).toHaveBeenCalledWith('observation:estimate-old')
  })

  it('labels missing, cyclic, and capped estimate revision chains', async () => {
    const missingClient = { getKnowledgeObject: vi.fn().mockImplementation((ref: string) => ref === 'observation:estimate-a' ? Promise.resolve({ ref, kind: 'Observation', object: { id: ref, observationType: 'estimate', estimateValue: 10, revisionOf: 'observation:missing' } }) : Promise.reject(new RuntimeClientError('not_found', 'missing', 404))) } as unknown as RuntimeClient
    const view = render(<TopicInspector refValue="observation:estimate-a" client={missingClient} onFocus={vi.fn()} />)
    expect(await screen.findByText('Referenced predecessor is missing: observation:missing.')).toBeTruthy()
    const cycleClient = { getKnowledgeObject: vi.fn().mockImplementation((ref: string) => Promise.resolve(ref.endsWith(':a') ? { ref, kind: 'Observation', object: { id: ref, observationType: 'estimate', revisionOf: 'observation:b' } } : { ref, kind: 'Observation', object: { id: ref, observationType: 'estimate', revisionOf: 'observation:a' } })) } as unknown as RuntimeClient
    view.rerender(<TopicInspector refValue="observation:a" client={cycleClient} onFocus={vi.fn()} />)
    expect(await screen.findByText(/Revision cycle detected at observation:a/)).toBeTruthy()
    const cappedObjects: Record<string, Record<string, unknown>> = {}
    for (let index = 0; index <= 20; index += 1) cappedObjects[`observation:cap-${index}`] = { id: `observation:cap-${index}`, observationType: 'estimate', estimateValue: index, publishedAt: `2026-06-${String(index + 1).padStart(2, '0')}`, ...(index > 0 ? { revisionOf: `observation:cap-${index - 1}` } : {}) }
    const capClient = { getKnowledgeObject: vi.fn((ref: string) => Promise.resolve({ ref, kind: 'Observation', object: cappedObjects[ref] })) } as unknown as RuntimeClient
    view.rerender(<TopicInspector refValue="observation:cap-20" client={capClient} onFocus={vi.fn()} />)
    expect(await screen.findByText(/Revision history is capped at 20 observations/)).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Estimate revision chain' }).querySelectorAll('li')).toHaveLength(20)
    expect(capClient.getKnowledgeObject).toHaveBeenCalledTimes(20)
  })
})
