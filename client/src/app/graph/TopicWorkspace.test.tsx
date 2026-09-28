import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeClient, KnowledgeTopicKind, KnowledgeTopicSummary } from '../../api/runtime-client'
import { TopicWorkspace } from './TopicWorkspace'
import { TopicInspector } from './TopicInspector'

const kinds: readonly KnowledgeTopicKind[] = ['relation', 'claim', 'observation', 'event', 'thesis', 'module', 'source', 'reasoning_edge']
function summary(): KnowledgeTopicSummary {
  const counts = Object.fromEntries(kinds.map((kind) => [kind, { total: kind === 'claim' ? 2 : 0, totalExact: kind !== 'claim', truncated: kind === 'claim' }])) as KnowledgeTopicSummary['counts']['direct']
  return { knowledgeBaseId: 'kb', schemaVersion: '0.4', revision: 7, theme: { ref: 'entity:theme-a', name: 'AI Hardware', aliases: ['Accelerator supply chain'], definition: 'Compute systems and supply chain', lifecycleStatus: 'active' }, counts: { direct: counts, connected: counts }, connected: { depth: 2, totalExact: false, truncated: true, focusRefs: ['entity:industry-a'] } }
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
    expect(listTopicItems).toHaveBeenCalledWith(expect.objectContaining({ themeRef: 'entity:theme-a', kind: 'claim', scope: 'direct', filters: { lifecycle: 'all', claimType: 'risk' } }))
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
})

describe('TopicInspector', () => {
  afterEach(() => cleanup())

  it('shows a safe canonical source link only when its public terms permit it and hides Raw fields', async () => {
    const getKnowledgeObject = vi.fn().mockImplementation((ref: string) => Promise.resolve({ ref, kind: 'Source', object: ref === 'source:filing-a' ? { id: ref, title: 'Issuer annual report', publisher: 'Issuer', canonicalUrl: 'https://example.test/report', rights: { accessScope: 'public', providerTermsKnown: true, redistributionAllowed: false }, rawRefs: ['raw-sha256-secret'], excerpt: 'private quotation', localPath: 'C:\\private\\report.pdf' } : { id: ref, title: 'Restricted source', publisher: 'Acme C:\\private\\folder', canonicalUrl: 'https://example.test/restricted', rights: { accessScope: 'restricted', providerTermsKnown: true, redistributionAllowed: false }, rawRefs: ['raw-sha256-hidden'], excerpt: 'restricted quote' } }))
    const client = { getKnowledgeObject } as unknown as RuntimeClient
    const view = render(<TopicInspector refValue="source:filing-a" client={client} onFocus={vi.fn()} />)
    expect((await screen.findAllByText('Issuer annual report')).length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: 'Open source' }).getAttribute('href')).toBe('https://example.test/report')
    expect(screen.queryByText(/raw-sha256-secret|private quotation|C:\\private/)).toBeNull()
    expect(screen.queryByText(/Canonical object/)).toBeNull()
    view.rerender(<TopicInspector refValue="source:restricted-a" client={client} onFocus={vi.fn()} />)
    expect((await screen.findAllByText('Restricted source')).length).toBeGreaterThan(0)
    expect(screen.queryByRole('link', { name: 'Open source' })).toBeNull()
    expect(screen.queryByText(/C:\\private|restricted quote|raw-sha256-hidden/)).toBeNull()
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
})
