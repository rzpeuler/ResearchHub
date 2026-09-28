import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KnowledgeGraphPage, KnowledgeInspector } from './KnowledgeGraphPage'
import type { RuntimeClient } from '../../api/runtime-client'

describe('KnowledgeGraphPage', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/graph')
    Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: class { observe() {} unobserve() {} disconnect() {} } })
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }) })
  })
  afterEach(() => cleanup())

  it('shows the empty root state and focuses a Directory entity into URL state', async () => {
    const client = {
      getKnowledgeDirectory: vi.fn().mockResolvedValue({ themeGroups: [], industries: { items: [{ ref: 'entity:industry', name: 'Semiconductors' }], total: 1, limit: 30, truncated: false }, companies: { items: [], total: 0, limit: 30, truncated: false }, products: { items: [], total: 0, limit: 30, truncated: false }, technologies: { items: [], total: 0, limit: 30, truncated: false } }),
      getKnowledgeGraph: vi.fn().mockResolvedValue({ rootRef: 'entity:industry', profile: 'industry_context', depth: 1, nodes: [{ ref: 'entity:industry', entityType: 'industry', label: 'Semiconductors', lifecycleStatus: 'active', isRoot: true }, { ref: 'entity:technology', entityType: 'technology', label: 'HBM', lifecycleStatus: 'active', isRoot: false }], edges: [{ ref: 'relation:industry-tech', relationType: 'depends_on', sourceRef: 'entity:industry', targetRef: 'entity:technology', label: 'depends on' }], nodeTotal: 2, edgeTotal: 1, nodeLimit: 60, edgeLimit: 120, truncated: false }),
      getKnowledgeObject: vi.fn(),
      searchKnowledge: vi.fn(),
    } as unknown as RuntimeClient
    render(<KnowledgeGraphPage knowledgeBase={{ knowledgeBaseId: 'kb' }} client={client} />)
    expect(await screen.findByText('Select a root to explore')).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: /Semiconductors/ }))
    await waitFor(() => expect(client.getKnowledgeGraph).toHaveBeenCalledWith({ rootRef: 'entity:industry', depth: 1 }))
    expect(window.location.search).toBe('?root=entity%3Aindustry')
    expect(await screen.findByText('2 nodes · 1 relations')).toBeTruthy()
    expect(screen.getByText('Read-only')).toBeTruthy()
    expect(screen.queryByText('Connect')).toBeNull()
  })

  it('toggles ThemeGroup themes without treating the group as a graph root', async () => {
    const getKnowledgeGraph = vi.fn().mockResolvedValue({ rootRef: 'entity:theme-a', profile: 'theme_context', depth: 1, nodes: [{ ref: 'entity:theme-a', entityType: 'investment_theme', label: 'Theme A', lifecycleStatus: 'active', isRoot: true }], edges: [], nodeTotal: 1, edgeTotal: 0, nodeLimit: 60, edgeLimit: 120, truncated: false })
    const counts = Object.fromEntries(['relation', 'claim', 'observation', 'event', 'thesis', 'module', 'source', 'reasoning_edge'].map((kind) => [kind, { total: 0, totalExact: true, truncated: false }]))
    const overview = { direct: { nonSourceRecordsWithoutExplicitSourceRef: 0, totalExact: true, truncated: false }, connected: { nonSourceRecordsWithoutExplicitSourceRef: 0, totalExact: true, truncated: false } }
    const client = { getKnowledgeDirectory: vi.fn().mockResolvedValue({ themeGroups: [{ ref: 'theme-group:infra', name: 'Infrastructure', themes: [{ ref: 'entity:theme-a', name: 'Theme A' }, { ref: 'entity:theme-b', name: 'Theme B' }] }], industries: { items: [], total: 0, limit: 30, truncated: false }, companies: { items: [], total: 0, limit: 30, truncated: false }, products: { items: [], total: 0, limit: 30, truncated: false }, technologies: { items: [], total: 0, limit: 30, truncated: false } }), getKnowledgeGraph, getTopicSummary: vi.fn().mockImplementation((themeRef: string) => Promise.resolve({ knowledgeBaseId: 'kb', schemaVersion: '0.4', revision: 1, theme: { ref: themeRef, name: 'Theme A', aliases: [], lifecycleStatus: 'active' }, counts: { direct: counts, connected: counts }, overview, connected: { depth: 1, totalExact: true, truncated: false, focusRefs: [] } })), listTopicItems: vi.fn().mockResolvedValue({ items: [], total: 0, totalExact: true, limit: 30, truncated: false }), getKnowledgeObject: vi.fn(), searchKnowledge: vi.fn() } as unknown as RuntimeClient
    render(<KnowledgeGraphPage knowledgeBase={{ knowledgeBaseId: 'kb' }} client={client} />)
    const group = await screen.findByRole('button', { name: /Infrastructure/ })
    await waitFor(() => expect(group.getAttribute('aria-expanded')).toBe('true'))
    expect(screen.getByRole('button', { name: /Theme A/ })).toBeTruthy()
    fireEvent.click(group)
    expect(group.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: /Theme A/ })).toBeNull()
    fireEvent.click(group)
    expect(screen.getByRole('button', { name: /Theme B/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Theme A/ }))
    await waitFor(() => expect(getKnowledgeGraph).toHaveBeenCalledWith({ rootRef: 'entity:theme-a', depth: 1 }))
    expect(getKnowledgeGraph).not.toHaveBeenCalledWith(expect.objectContaining({ rootRef: 'theme-group:infra' }))
  })

  it('searches a supported Entity and focuses the canonical result', async () => {
    const getKnowledgeGraph = vi.fn().mockResolvedValue({ rootRef: 'entity:company', profile: 'company_context', depth: 1, nodes: [{ ref: 'entity:company', entityType: 'company', label: 'Acme Compute', lifecycleStatus: 'active', isRoot: true }], edges: [], nodeTotal: 1, edgeTotal: 0, nodeLimit: 60, edgeLimit: 120, truncated: false })
    const client = { getKnowledgeDirectory: vi.fn().mockResolvedValue({ themeGroups: [], industries: { items: [], total: 0, limit: 30, truncated: false }, companies: { items: [], total: 0, limit: 30, truncated: false }, products: { items: [], total: 0, limit: 30, truncated: false }, technologies: { items: [], total: 0, limit: 30, truncated: false } }), getKnowledgeGraph, getKnowledgeObject: vi.fn(), searchKnowledge: vi.fn().mockResolvedValue({ results: [{ ref: 'entity:company', kind: 'Entity', semanticType: 'company', displayName: 'Acme Compute' }], total: 1, limit: 20, truncated: false }) } as unknown as RuntimeClient
    render(<KnowledgeGraphPage knowledgeBase={{ knowledgeBaseId: 'kb' }} client={client} />)
    fireEvent.change(await screen.findByRole('textbox', { name: 'Search Knowledge' }), { target: { value: 'Acme' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    fireEvent.click(await screen.findByRole('button', { name: /Acme Compute/ }))
    await waitFor(() => expect(getKnowledgeGraph).toHaveBeenCalledWith({ rootRef: 'entity:company', depth: 1 }))
    expect(window.location.search).toBe('?root=entity%3Acompany')
  })

  it('re-roots an in-theme graph without dropping theme context and opens non-Entity search results in Inspector', async () => {
    const graph = vi.fn().mockImplementation(({ rootRef, depth }: { rootRef: string; depth: 1 | 2 }) => Promise.resolve({ rootRef, profile: 'theme_context', depth, nodes: [{ ref: rootRef, entityType: rootRef === 'entity:theme-a' ? 'investment_theme' : 'industry', label: rootRef === 'entity:theme-a' ? 'AI Hardware' : 'Semiconductor industry', lifecycleStatus: 'active', isRoot: true }, ...(rootRef === 'entity:theme-a' ? [{ ref: 'entity:industry-a', entityType: 'industry', label: 'Semiconductor industry', lifecycleStatus: 'active', isRoot: false }] : [])], edges: [], nodeTotal: 2, edgeTotal: 0, nodeLimit: 60, edgeLimit: 120, truncated: false }))
    const counts = Object.fromEntries(['relation', 'claim', 'observation', 'event', 'thesis', 'module', 'source', 'reasoning_edge'].map((kind) => [kind, { total: 0, totalExact: true, truncated: false }]))
    const client = {
      getKnowledgeDirectory: vi.fn().mockResolvedValue({ themeGroups: [{ ref: 'theme-group:infra', name: 'Infrastructure', themes: [{ ref: 'entity:theme-a', name: 'AI Hardware' }] }], industries: { items: [{ ref: 'entity:industry-a', name: 'Semiconductor industry' }], total: 1, limit: 30, truncated: false }, companies: { items: [], total: 0, limit: 30, truncated: false }, products: { items: [], total: 0, limit: 30, truncated: false }, technologies: { items: [], total: 0, limit: 30, truncated: false } }),
      getKnowledgeGraph: graph,
      getTopicSummary: vi.fn().mockResolvedValue({ knowledgeBaseId: 'kb', schemaVersion: '0.4', revision: 7, theme: { ref: 'entity:theme-a', name: 'AI Hardware', aliases: [], lifecycleStatus: 'active' }, counts: { direct: counts, connected: counts }, overview: { direct: { nonSourceRecordsWithoutExplicitSourceRef: 0, totalExact: true, truncated: false }, connected: { nonSourceRecordsWithoutExplicitSourceRef: 0, totalExact: true, truncated: false } }, connected: { depth: 1, totalExact: true, truncated: false, focusRefs: [] } }),
      listTopicItems: vi.fn().mockResolvedValue({ items: [], total: 0, totalExact: true, limit: 30, truncated: false }),
      getKnowledgeObject: vi.fn().mockResolvedValue({ ref: 'claim:forecast-a', kind: 'Claim', object: { id: 'claim:forecast-a', claimType: 'forecast', statement: 'Memory shipments may rise.', lifecycle: { status: 'active' } } }),
      searchKnowledge: vi.fn().mockResolvedValue({ results: [{ ref: 'claim:forecast-a', kind: 'Claim', semanticType: 'forecast', displayName: 'Memory shipment forecast' }], total: 1, limit: 20, truncated: false }),
    } as unknown as RuntimeClient
    window.history.replaceState({}, '', '/graph?themeRef=entity%3Atheme-a')
    render(<KnowledgeGraphPage knowledgeBase={{ knowledgeBaseId: 'kb', schemaVersion: '0.4', revision: 7 }} client={client} />)
    await waitFor(() => expect(graph).toHaveBeenCalledWith({ rootRef: 'entity:theme-a', depth: 1 }))
    await screen.findAllByText('Semiconductor industry')
    fireEvent.doubleClick(screen.getAllByText('Semiconductor industry').at(-1)!)
    await waitFor(() => expect(graph).toHaveBeenCalledWith({ rootRef: 'entity:industry-a', depth: 1 }))
    expect(window.location.search).toContain('themeRef=entity%3Atheme-a')
    expect(window.location.search).toContain('graphRootRef=entity%3Aindustry-a')
    fireEvent.change(screen.getByRole('textbox', { name: 'Search Knowledge' }), { target: { value: 'shipment' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    fireEvent.click(await screen.findByRole('button', { name: /Memory shipment forecast/ }))
    expect((await screen.findAllByText('Memory shipments may rise.')).length).toBeGreaterThan(0)
    expect(window.location.search).toContain('selectedRef=claim%3Aforecast-a')
    expect(window.location.search).toContain('themeRef=entity%3Atheme-a')
  })

  it('clears the previous topic workspace immediately when switching themes', async () => {
    const counts = Object.fromEntries(['relation', 'claim', 'observation', 'event', 'thesis', 'module', 'source', 'reasoning_edge'].map((kind) => [kind, { total: 0, totalExact: true, truncated: false }]))
    const overview = { direct: { nonSourceRecordsWithoutExplicitSourceRef: 0, totalExact: true, truncated: false }, connected: { nonSourceRecordsWithoutExplicitSourceRef: 0, totalExact: true, truncated: false } }
    let resolveThemeB: ((value: unknown) => void) | undefined
    const themeBSummary = new Promise<unknown>((resolve) => { resolveThemeB = resolve })
    const summary = (themeRef: string) => ({ knowledgeBaseId: 'kb', schemaVersion: '0.4', revision: 7, theme: { ref: themeRef, name: themeRef === 'entity:theme-a' ? 'Theme A' : 'Theme B', aliases: [], lifecycleStatus: 'active' }, counts: { direct: counts, connected: counts }, overview, connected: { depth: 1, totalExact: true, truncated: false, focusRefs: [] } })
    const client = {
      getKnowledgeDirectory: vi.fn().mockResolvedValue({ themeGroups: [{ ref: 'theme-group:test', name: 'Test themes', themes: [{ ref: 'entity:theme-a', name: 'Theme A' }, { ref: 'entity:theme-b', name: 'Theme B' }] }], industries: { items: [], total: 0, limit: 30, truncated: false }, companies: { items: [], total: 0, limit: 30, truncated: false }, products: { items: [], total: 0, limit: 30, truncated: false }, technologies: { items: [], total: 0, limit: 30, truncated: false } }),
      getKnowledgeGraph: vi.fn().mockImplementation(({ rootRef, depth }: { rootRef: string; depth: 1 | 2 }) => Promise.resolve({ rootRef, profile: 'theme_context', depth, nodes: [{ ref: rootRef, entityType: 'investment_theme', label: rootRef, lifecycleStatus: 'active', isRoot: true }], edges: [], nodeTotal: 1, edgeTotal: 0, nodeLimit: 60, edgeLimit: 120, truncated: false })),
      getTopicSummary: vi.fn().mockImplementation((ref: string) => ref === 'entity:theme-b' ? themeBSummary : Promise.resolve(summary(ref))),
      listTopicItems: vi.fn().mockResolvedValue({ items: [], total: 0, totalExact: true, limit: 30, truncated: false }), getKnowledgeObject: vi.fn(), searchKnowledge: vi.fn(),
    } as unknown as RuntimeClient
    window.history.replaceState({}, '', '/graph?themeRef=entity%3Atheme-a')
    render(<KnowledgeGraphPage knowledgeBase={{ knowledgeBaseId: 'kb', schemaVersion: '0.4', revision: 7 }} client={client} />)
    expect(await screen.findByRole('heading', { name: 'Theme A' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Theme B/ }))
    await waitFor(() => expect(client.getTopicSummary).toHaveBeenCalledWith('entity:theme-b', 1))
    expect(screen.queryByRole('heading', { name: 'Theme A' })).toBeNull()
    expect(resolveThemeB).toBeTruthy()
    resolveThemeB!(summary('entity:theme-b'))
    expect(await screen.findByRole('heading', { name: 'Theme B' })).toBeTruthy()
  })

  it('renders bounded node canonical fields, relations, claims, sources, and provenance', async () => {
    const getKnowledgeObject = vi.fn().mockResolvedValue({ ref: 'entity:company', kind: 'Entity', object: { id: 'entity:company', type: 'company', name: 'Acme Compute', aliases: ['ACME Corp'], description: 'Compute systems', ticker: 'ACME', exchange: 'NYSE', lifecycle: { status: 'active' } }, relatedRelations: [{ id: 'relation:exposure', type: 'business_exposure', sourceRef: 'entity:company', targetRef: 'entity:industry', attributes: { materiality: 'high' } }], relatedClaims: [{ id: 'claim:one', claimType: 'fact', statement: 'Acme builds accelerators.', temporal: { asOf: '2026-01-01' }, confidence: 0.9, provenance: [{ sourceRef: 'source:one', rawRef: 'raw:one', locator: 'p. 2', chunkRef: 'chunk:one' }] }], supportingSources: [{ id: 'source:one', title: 'Annual report', sourceType: 'filing', publisher: 'Acme', publishedAt: '2026-02-01', url: 'https://example.com/report' }], truncation: { relations: { limit: 20, total: 21, truncated: true }, claims: { limit: 20, total: 1, truncated: false }, sources: { limit: 20, total: 1, truncated: false } } })
    const client = { getKnowledgeObject } as unknown as RuntimeClient
    render(<KnowledgeInspector selection={{ kind: 'node', ref: 'entity:company' }} projection={{ rootRef: 'entity:company', profile: 'company_context', depth: 1, nodes: [{ ref: 'entity:company', entityType: 'company', label: 'Acme Compute', lifecycleStatus: 'active', isRoot: true }], edges: [], nodeTotal: 1, edgeTotal: 0, nodeLimit: 60, edgeLimit: 120, truncated: false }} client={client} onFocus={vi.fn()} />)
    expect(await screen.findByText('Acme builds accelerators.')).toBeTruthy()
    expect(screen.getByText('Relations')).toBeTruthy()
    expect(screen.getByText('Claims')).toBeTruthy()
    expect(screen.getByText('Sources')).toBeTruthy()
    expect(screen.getByText('Showing 1 of 21 relations')).toBeTruthy()
    expect(screen.getByText('Annual report')).toBeTruthy()
    expect(screen.getByText('raw:one')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open source' }).getAttribute('rel')).toBe('noreferrer noopener')
    expect(getKnowledgeObject).toHaveBeenCalledWith('entity:company')
  })

  it('renders relation edge detail with canonical direction, attributes, claims, and sources', async () => {
    const getKnowledgeObject = vi.fn().mockResolvedValue({ ref: 'relation:exposure', kind: 'Relation', object: { id: 'relation:exposure', type: 'business_exposure', sourceRef: 'entity:company', targetRef: 'entity:industry', attributes: { materiality: 'high' }, confidence: 0.8, asOf: '2026-01-01' }, relatedClaims: [{ id: 'claim:edge', claimType: 'fact', statement: 'Edge evidence.' }], supportingSources: [{ id: 'source:edge', title: 'Edge source', sourceType: 'research' }], truncation: { relations: { limit: 20, total: 0, truncated: false }, claims: { limit: 20, total: 1, truncated: false }, sources: { limit: 20, total: 1, truncated: false } } })
    const client = { getKnowledgeObject } as unknown as RuntimeClient
    render(<KnowledgeInspector selection={{ kind: 'edge', ref: 'relation:exposure' }} projection={{ rootRef: 'entity:company', profile: 'company_context', depth: 1, nodes: [], edges: [{ ref: 'relation:exposure', relationType: 'business_exposure', sourceRef: 'entity:company', targetRef: 'entity:industry', label: 'business exposure' }], nodeTotal: 0, edgeTotal: 1, nodeLimit: 60, edgeLimit: 120, truncated: false }} client={client} onFocus={vi.fn()} />)
    expect(await screen.findByText('Edge evidence.')).toBeTruthy()
    expect(screen.getAllByText('entity:company').length).toBeGreaterThan(0)
    expect(screen.getAllByText('entity:industry').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Attributes').length).toBeGreaterThan(0)
    expect(screen.getByText('Edge source')).toBeTruthy()
    expect(getKnowledgeObject).toHaveBeenCalledWith('relation:exposure')
  })

  it('requests depth two, shows bounded graph status, and follows popstate URL state', async () => {
    const getKnowledgeGraph = vi.fn().mockImplementation(({ rootRef, depth }: { rootRef: string; depth: 1 | 2 }) => Promise.resolve({ rootRef, profile: 'industry_context', depth, nodes: [{ ref: rootRef, entityType: 'industry', label: rootRef, lifecycleStatus: 'active', isRoot: true }], edges: [], nodeTotal: 2, edgeTotal: 1, nodeLimit: 60, edgeLimit: 120, truncated: true }))
    const client = { getKnowledgeDirectory: vi.fn().mockResolvedValue({ themeGroups: [], industries: { items: [], total: 0, limit: 30, truncated: false }, companies: { items: [], total: 0, limit: 30, truncated: false }, products: { items: [], total: 0, limit: 30, truncated: false }, technologies: { items: [], total: 0, limit: 30, truncated: false } }), getKnowledgeGraph, getKnowledgeObject: vi.fn(), searchKnowledge: vi.fn() } as unknown as RuntimeClient
    window.history.replaceState({}, '', '/graph?root=entity%3Aindustry')
    render(<KnowledgeGraphPage knowledgeBase={{ knowledgeBaseId: 'kb' }} client={client} />)
    await waitFor(() => expect(getKnowledgeGraph).toHaveBeenCalledWith({ rootRef: 'entity:industry', depth: 1 }))
    fireEvent.click(screen.getByRole('button', { name: '2 hops' }))
    await waitFor(() => expect(getKnowledgeGraph).toHaveBeenCalledWith({ rootRef: 'entity:industry', depth: 2 }))
    expect(window.location.search).toContain('depth=2')
    expect(await screen.findByText(/bounded/)).toBeTruthy()
    window.history.pushState({}, '', '/graph?root=entity%3Aproduct&depth=2')
    fireEvent(window, new PopStateEvent('popstate'))
    await waitFor(() => expect(getKnowledgeGraph).toHaveBeenCalledWith({ rootRef: 'entity:product', depth: 2 }))
  })
})
