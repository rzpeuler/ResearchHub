import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KnowledgeGraphPage } from './KnowledgeGraphPage'
import type { RuntimeClient } from '../../api/runtime-client'
import type { ThemeWorkspaceCompanyProjection, ThemeWorkspaceIndustryProjection, ThemeWorkspaceProjection } from '../../api/runtime-client'

const emptyContent = { factsByType: {}, sectionCatalog: [], factsBySection: {}, unclassifiedFacts: [], classification: { status: 'classified' as const, method: 'not_needed' as const, revision: 7, classifiedCount: 0, unclassifiedCount: 0 }, modules: [], coreViews: { items: [], defaultCount: 3 as const, total: 0, truncated: false }, timeline: { historicalEvents: [], futureCatalysts: [], eventsLimit: { total: 0, limit: 30, truncated: false }, catalystsLimit: { total: 0, limit: 30, truncated: false } }, limited: {}, omittedRestrictedCount: 0 }
const directory = { themeGroups: [{ ref: 'theme-group:default', name: '默认分组', themes: [{ ref: 'entity:theme-a', name: '主题 A' }, { ref: 'entity:theme-b', name: '主题 B' }] }], industries: { items: [], total: 0, limit: 30, truncated: false }, companies: { items: [], total: 0, limit: 30, truncated: false }, products: { items: [], total: 0, limit: 30, truncated: false }, technologies: { items: [], total: 0, limit: 30, truncated: false } }

function overview(themeRef = 'entity:theme-a'): ThemeWorkspaceProjection {
  return { status: 'available', knowledgeBaseId: 'kb', schemaVersion: '0.4', revision: 7, theme: { ref: themeRef, name: themeRef.endsWith('a') ? '主题 A' : '主题 B', themeGroupRef: 'theme-group:default' }, graph: { nodes: [{ ref: 'entity:industry-a', name: '行业 A', importance: 'core' }, { ref: 'entity:industry-b', name: '行业 B', importance: 'material' }], edges: [{ ref: 'relation:a-b', relationType: 'upstream_of', sourceRef: 'entity:industry-b', targetRef: 'entity:industry-a' }], nodeTotal: 2, edgeTotal: 1, nodeLimit: 60, edgeLimit: 120, truncated: false }, scope: { includedIndustryCount: 2, includedRelationCount: 1, pendingCount: 0, excludedCount: 0, basedOnRevision: 7 }, responseBounds: { maxBytes: 1_000_000, serializedBytes: 500, truncated: false } }
}

function industryProjection(industryRef: string, companyRefs: readonly string[]): ThemeWorkspaceIndustryProjection {
  const companies = companyRefs.map((ref) => ({ ref, name: ref.split(':').at(-1)!, ticker: ref.toUpperCase(), exchange: 'SSE' }))
  const competition = { ref: `module:${industryRef}`, schemaId: 'competition-landscape-v1', columns: [{ id: 'company', label: '公司', role: 'company' as const }, { id: 'products', label: '主要产品', role: 'main_products' as const }], rows: companies.map((company) => ({ companyRef: company.ref, cells: [{ columnId: 'products', value: { status: 'available' as const, displayValue: '服务器' }, notComparable: false }] })), rowTotal: companies.length, truncated: false }
  return { knowledgeBaseId: 'kb', revision: 7, themeRef: 'entity:theme-a', industry: { ref: industryRef, name: industryRef.endsWith('a') ? '行业 A' : '行业 B' }, sections: { ...emptyContent, competition }, companies, companiesLimit: { total: companies.length, limit: 40, truncated: false }, responseBounds: { maxBytes: 1_000_000, serializedBytes: 700, truncated: false } }
}

function companyProjection(industryRef: string, companyRef: string): ThemeWorkspaceCompanyProjection {
  const fact = { ref: `claim:${companyRef}`, kind: 'claim' as const, semanticType: 'fact', title: '经营情况', statement: `${companyRef} 的详细公司事实` }
  return { knowledgeBaseId: 'kb', revision: 7, themeRef: 'entity:theme-a', industryRef, company: { ref: companyRef, name: `详情 ${companyRef.split(':').at(-1)}` }, sections: { ...emptyContent, factsByType: { fact: [fact] }, sectionCatalog: [{ id: 'company_profile', title: '公司概况' }], factsBySection: { company_profile: [fact] }, classification: { status: 'classified', method: 'deterministic_fallback', revision: 7, classifiedCount: 1, unclassifiedCount: 0 } }, responseBounds: { maxBytes: 1_000_000, serializedBytes: 400, truncated: false } }
}

function makeClient(overrides: Partial<RuntimeClient> = {}): RuntimeClient {
  return {
    getKnowledgeDirectory: vi.fn().mockResolvedValue(directory),
    getThemeWorkspaceOverview: vi.fn().mockResolvedValue(overview()),
    getThemeWorkspaceIndustry: vi.fn().mockImplementation((_themeRef: string, industryRef: string) => Promise.resolve(industryProjection(industryRef, industryRef.endsWith('a') ? ['entity:company-a', 'entity:company-b'] : ['entity:company-c']))),
    getThemeWorkspaceCompany: vi.fn().mockImplementation((_themeRef: string, industryRef: string, companyRef: string) => Promise.resolve(companyProjection(industryRef, companyRef))),
    ...overrides,
  } as unknown as RuntimeClient
}

describe('KnowledgeGraphPage', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/graph')
    Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: class { observe() {} unobserve() {} disconnect() {} } })
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }) })
  })
  afterEach(() => cleanup())

  it('keeps Theme graph industry selection separate from company selection and restores last company per industry', async () => {
    const client = makeClient()
    render(<KnowledgeGraphPage knowledgeBase={{ knowledgeBaseId: 'kb', rootRef: 'kb:root', status: 'mounted', schemaVersion: '0.4', storageFormatVersion: '0.4', revision: 7, counts: {} }} client={client} />)
    fireEvent.click(await screen.findByRole('button', { name: '主题 A' }))
    await screen.findByRole('button', { name: 'company-a' })
    await screen.findByText('entity:company-a 的详细公司事实')

    fireEvent.click(screen.getByRole('button', { name: 'company-b' }))
    await screen.findByText('entity:company-b 的详细公司事实')
    expect(screen.getByRole('button', { name: '行业 A' }).getAttribute('aria-pressed')).toBe('true')

    const visualIndustryB = screen.getByText('行业 B', { selector: '.theme-graph-node strong' }).closest('.react-flow__node')
    expect(visualIndustryB).toBeTruthy()
    fireEvent.click(visualIndustryB!)
    await screen.findByRole('button', { name: 'company-c' })
    await waitFor(() => expect(client.getThemeWorkspaceCompany).toHaveBeenLastCalledWith('entity:theme-a', 'entity:industry-b', 'entity:company-c', { expectedRevision: 7 }))
    expect(screen.getByRole('button', { name: '行业 B' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'company-c' }))
    await waitFor(() => expect(client.getThemeWorkspaceCompany).toHaveBeenLastCalledWith('entity:theme-a', 'entity:industry-b', 'entity:company-c', { expectedRevision: 7 }))

    fireEvent.click(screen.getByRole('button', { name: '行业 A' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'company-b' }).closest('tr')?.className).toContain('is-selected'))
    await screen.findByText('entity:company-b 的详细公司事实')
    expect(client.getThemeWorkspaceCompany).toHaveBeenLastCalledWith('entity:theme-a', 'entity:industry-a', 'entity:company-b', { expectedRevision: 7 })
  })

  it('ignores late overview responses from a Theme that has already been switched away', async () => {
    let resolveThemeA: ((result: ThemeWorkspaceProjection) => void) | undefined
    const delayedA = new Promise<ThemeWorkspaceProjection>((resolve) => { resolveThemeA = resolve })
    const client = makeClient({
      getThemeWorkspaceOverview: vi.fn().mockImplementation((themeRef: string) => themeRef === 'entity:theme-a' ? delayedA : Promise.resolve({ ...overview(themeRef), graph: { ...overview(themeRef).graph, nodes: [{ ref: 'entity:industry-theme-b', name: '行业 B 专属' }], edges: [], nodeTotal: 1, edgeTotal: 0 } })),
      getThemeWorkspaceIndustry: vi.fn().mockImplementation((_themeRef: string, industryRef: string) => Promise.resolve(industryProjection(industryRef, []))),
    })
    render(<KnowledgeGraphPage knowledgeBase={{ knowledgeBaseId: 'kb', rootRef: 'kb:root', status: 'mounted', schemaVersion: '0.4', storageFormatVersion: '0.4', revision: 7, counts: {} }} client={client} />)
    fireEvent.click(await screen.findByRole('button', { name: '主题 A' }))
    fireEvent.click(screen.getByRole('button', { name: '主题 B' }))
    await screen.findByRole('button', { name: '行业 B 专属' })
    resolveThemeA?.(overview('entity:theme-a'))
    await waitFor(() => expect(screen.queryByRole('button', { name: '行业 A' })).toBeNull())
    expect(window.location.search).toContain('themeRef=entity%3Atheme-b')
  })

  it('shows the empty and no Knowledge Base states without inventing graph content', async () => {
    const client = makeClient({ getThemeWorkspaceOverview: vi.fn().mockResolvedValue({ ...overview(), graph: { ...overview().graph, nodes: [], edges: [], nodeTotal: 0, edgeTotal: 0 } }) })
    const { rerender } = render(<KnowledgeGraphPage knowledgeBase={{ knowledgeBaseId: 'kb', rootRef: 'kb:root', status: 'mounted', schemaVersion: '0.4', storageFormatVersion: '0.4', revision: 7, counts: {} }} client={client} />)
    fireEvent.click(await screen.findByRole('button', { name: '主题 A' }))
    expect(await screen.findByText('尚无已确认的行业节点')).toBeTruthy()
    rerender(<KnowledgeGraphPage client={client} />)
    expect(screen.getByText('没有已挂载的 Knowledge Base')).toBeTruthy()
  })

  it('surfaces response-size truncation and facts omitted by source rights', async () => {
    const base = overview()
    const client = makeClient({
      getThemeWorkspaceOverview: vi.fn().mockResolvedValue({ ...base, responseBounds: { ...base.responseBounds, truncated: true } }),
      getThemeWorkspaceIndustry: vi.fn().mockResolvedValue({ ...industryProjection('entity:industry-a', []), sections: { ...emptyContent, omittedRestrictedCount: 2 } }),
    })
    render(<KnowledgeGraphPage knowledgeBase={{ knowledgeBaseId: 'kb', rootRef: 'kb:root', status: 'mounted', schemaVersion: '0.4', storageFormatVersion: '0.4', revision: 7, counts: {} }} client={client} />)
    fireEvent.click(await screen.findByRole('button', { name: '主题 A' }))
    expect(await screen.findByText(/响应体积上限已截断/)).toBeTruthy()
    expect(await screen.findByText(/有 2 项知识因来源访问权限或有效期限制未展示/)).toBeTruthy()
  })

  it('shows three core views by default, expands them, and resets on a followed-target change', async () => {
    const views = Array.from({ length: 5 }, (_, index) => ({ ref: `claim:view-${index + 1}`, kind: 'claim' as const, semanticType: 'viewpoint', title: `观点 ${index + 1}` }))
    const client = makeClient({
      getThemeWorkspaceCompany: vi.fn().mockImplementation((_themeRef: string, industryRef: string, companyRef: string) => {
        const result = companyProjection(industryRef, companyRef)
        return Promise.resolve({ ...result, sections: { ...result.sections, coreViews: { items: views, defaultCount: 3, total: 5, truncated: false } } })
      }),
    })
    render(<KnowledgeGraphPage knowledgeBase={{ knowledgeBaseId: 'kb', rootRef: 'kb:root', status: 'mounted', schemaVersion: '0.4', storageFormatVersion: '0.4', revision: 7, counts: {} }} client={client} />)
    fireEvent.click(await screen.findByRole('button', { name: '主题 A' }))
    fireEvent.click(await screen.findByRole('button', { name: 'company-a' }))
    await waitFor(() => expect(client.getThemeWorkspaceCompany).toHaveBeenLastCalledWith('entity:theme-a', 'entity:industry-a', 'entity:company-a', { expectedRevision: 7 }))
    await screen.findByText('entity:company-a 的详细公司事实')
    expect(await screen.findByText('观点 1')).toBeTruthy()
    expect(screen.getByText('观点 3')).toBeTruthy()
    expect(screen.queryByText('观点 4')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '展开其余 2 条观点' }))
    expect(screen.getByText('观点 5')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '收起观点' }))
    expect(screen.queryByText('观点 4')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '展开其余 2 条观点' }))
    expect(screen.getByText('观点 4')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'company-b' }))
    await waitFor(() => expect(screen.getByText('观点 3')).toBeTruthy())
    expect(screen.queryByText('观点 4')).toBeNull()
  })

  it('renders canonical facts in the returned research chapters and keeps unclassified facts visible', async () => {
    const chapterFact = { ref: 'claim:chapter-fact', kind: 'claim' as const, semanticType: 'fact', title: '供需情况', statement: '服务器需求保持增长。' }
    const looseFact = { ref: 'claim:loose-fact', kind: 'claim' as const, semanticType: 'viewpoint', title: '其他观察', statement: '仍需跟踪行业变化。' }
    const industry = industryProjection('entity:industry-a', [])
    const client = makeClient({ getThemeWorkspaceIndustry: vi.fn().mockResolvedValue({
      ...industry,
      sections: { ...emptyContent, sectionCatalog: [{ id: 'supply_demand_analysis', title: '供需分析' }, { id: 'risk_analysis', title: '风险分析' }], factsBySection: { supply_demand_analysis: [chapterFact], risk_analysis: [] }, unclassifiedFacts: [looseFact], classification: { status: 'partial', method: 'reasoning_executor', revision: 7, classifiedCount: 1, unclassifiedCount: 1 } },
    }) })
    render(<KnowledgeGraphPage knowledgeBase={{ knowledgeBaseId: 'kb', rootRef: 'kb:root', status: 'mounted', schemaVersion: '0.4', storageFormatVersion: '0.4', revision: 7, counts: {} }} client={client} />)
    fireEvent.click(await screen.findByRole('button', { name: '主题 A' }))
    expect(await screen.findByText('服务器需求保持增长。')).toBeTruthy()
    expect(screen.getByText('仍需跟踪行业变化。')).toBeTruthy()
    expect(screen.getByText('部分事实尚未归类')).toBeTruthy()
    const emptyChapter = screen.getByText('风险分析').closest('details')
    expect(emptyChapter?.open).toBe(false)
    expect(emptyChapter?.textContent).toContain('暂无已归类知识')
  })

  it('formats competition scale values while retaining currency, date, and comparability cues', async () => {
    const industry = industryProjection('entity:industry-a', ['entity:company-a', 'entity:company-b'])
    const competition = {
      ref: 'module:market-overview', schemaId: 'competition-landscape-v1',
      columns: [{ id: 'company', label: '公司', role: 'company' as const }, { id: 'market-cap', label: '市值', role: 'market_cap' as const }, { id: 'annual-revenue', label: '年营收', role: 'annual_revenue' as const }],
      rows: [
        { companyRef: 'entity:company-a', cells: [
          { columnId: 'market-cap', value: { status: 'available' as const, displayValue: '128000000000', asOf: '2026-10-01', currency: 'CNY', unit: 'CNY' }, notComparable: true },
          { columnId: 'annual-revenue', value: { status: 'available' as const, displayValue: '8600000000', fiscalYear: 2025, currency: 'CNY', unit: 'CNY' }, notComparable: false },
        ] },
        { companyRef: 'entity:company-b', cells: [
          { columnId: 'market-cap', value: { status: 'available' as const, displayValue: '12800000000', asOf: '2026-10-01', currency: 'USD', unit: 'USD' }, notComparable: true },
          { columnId: 'annual-revenue', value: { status: 'available' as const, displayValue: '5200000000', fiscalYear: 2025, currency: 'USD', unit: 'USD' }, notComparable: true },
        ] },
      ], rowTotal: 2, truncated: false,
    }
    const client = makeClient({ getThemeWorkspaceIndustry: vi.fn().mockResolvedValue({ ...industry, sections: { ...emptyContent, competition } }) })
    const { container } = render(<KnowledgeGraphPage knowledgeBase={{ knowledgeBaseId: 'kb', rootRef: 'kb:root', status: 'mounted', schemaVersion: '0.4', storageFormatVersion: '0.4', revision: 7, counts: {} }} client={client} />)
    fireEvent.click(await screen.findByRole('button', { name: '主题 A' }))
    const rowA = await screen.findByRole('row', { name: /company-a/ })
    expect(rowA.textContent).toContain('1,280 亿元')
    expect(rowA.textContent).toContain('86 亿元')
    expect(rowA.textContent).toContain('交易日 2026-10-01 · CNY')
    expect(rowA.textContent).not.toContain('CNY · CNY')
    expect(rowA.textContent).toContain('不可直接比较')
    const rowB = screen.getByRole('row', { name: /company-b/ })
    expect(rowB.textContent).toContain('128 亿 USD')
    expect(rowB.textContent).toContain('年报 · USD')
    const minimap = container.querySelector<HTMLElement>('.react-flow__minimap')
    expect(minimap?.style.width).toBe('116px')
    expect(minimap?.style.height).toBe('74px')
    expect(screen.queryByRole('link', { name: 'React Flow attribution' })).toBeNull()
  })

  it('accepts a legacy root URL parameter when it identifies a Theme ref', async () => {
    window.history.replaceState({}, '', '/graph?root=entity%3Atheme-a')
    const client = makeClient()
    render(<KnowledgeGraphPage knowledgeBase={{ knowledgeBaseId: 'kb', rootRef: 'kb:root', status: 'mounted', schemaVersion: '0.4', storageFormatVersion: '0.4', revision: 7, counts: {} }} client={client} />)
    await waitFor(() => expect(client.getThemeWorkspaceOverview).toHaveBeenCalledWith('entity:theme-a'))
    expect(window.location.search).toContain('root=entity%3Atheme-a')
  })
})
