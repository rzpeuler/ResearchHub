import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeClient } from '../../api/runtime-client'
import { LanguageProvider } from '../../i18n'
import { DataSourcesPage } from './DataSourcesPage'

afterEach(cleanup)
beforeEach(() => window.localStorage.setItem('researchhub.language', 'zh-CN'))

const integration = { integration: { integrationId: 'quotes-one', displayName: 'Quotes One', sourceIds: ['quotes-one'], credentialFields: [{ id: 'api_key', label: 'API Key', required: true }], capabilities: [{ id: 'quotes', label: 'Quotes', metricIds: ['price.close'] }], supportedTests: { connection: true, capabilitySamples: ['quotes'] } }, credentialState: 'configured', policyLinked: false, latestTests: [{ integrationId: 'quotes-one', kind: 'connection', status: 'passed', startedAt: '2026-10-06', completedAt: '2026-10-06' }, { integrationId: 'quotes-one', kind: 'capability_sample', capabilityId: 'quotes', status: 'passed', startedAt: '2026-10-06', completedAt: '2026-10-06' }] }
const draft = { requestId: 'req-1', input: { integrationId: 'draft-source', displayName: 'Draft Source', documentationUrl: 'https://example.test/docs', accessMode: 'api', publisher: 'Example', proposedAuthority: 'S1_OFFICIAL', capabilityIds: ['quotes'], metricIds: ['price.close'], authenticationMode: 'api_key', rightsNotes: 'Reviewed', rateLimitNotes: '100/min', timeBoundaryNotes: 'Daily', providerTermsReviewed: true }, status: 'draft', createdAt: 'now', updatedAt: 'now' }
const commonCatalog = { definitions: [
  { metricId: 'revenue', meaning: 'Revenue', dataKind: 'metric', consumers: ['valuation', 'company-research'], sourcePolicyStatus: 'CONFIGURED', sourceMappingStatus: 'MAPPED', sourcePolicies: [{ policyId: 'revenue-policy', selectionMode: 'FIRST_VALID', requirementMatch: { metricId: 'revenue' }, candidates: [{ sourceId: 'nbs', fallbackLevel: 'PRIMARY', originAuthority: 'S1_OFFICIAL', operationId: 'nbs.revenue', supports: {}, runtimeAdapterStatus: 'UNKNOWN', connectionTestStatus: 'NOT_TESTED', capabilitySampleStatus: 'NOT_TESTED', historicalPitStatus: 'NOT_VERIFIED', integrations: [] }] }] },
  { metricId: 'revenue_growth', meaning: '营收增长', dataKind: 'derived_metric', consumers: ['valuation'], sourcePolicyStatus: 'NOT_CONFIGURED', sourceMappingStatus: 'UNMAPPED', sourcePolicies: [] },
], definitionCount: 2 }
const industryCatalog = { identities: [{ industryId: 'lithium_battery', aliases: ['锂电池'] }, { industryId: 'household_air_conditioner', aliases: ['家用空调'] }], definitions: [
  { industryId: 'lithium_battery', metricId: 'battery_output', name: 'Battery output', description: 'Lithium battery output', metricFamily: 'supply', semanticRole: 'production', dataKind: 'timeseries', lifecycleStatus: 'VALIDATED', sourcePolicies: [], canonicalUnit: 'GWh', acceptedSourceUnits: ['GWh'], frequency: 'ANNUAL', periodBasis: 'PERIOD', aggregation: 'SUM', geography: 'China', product: 'Lithium battery', grade: undefined, requiredQualifiers: ['reported'], pitPolicy: { publicationPit: 'REQUIRED', valueVersionPit: 'REQUIRED_FOR_HISTORICAL' }, validation: { validator: 'reviewer' }, discoveredFrom: 'audit' },
  { industryId: 'household_air_conditioner', metricId: 'ac_inventory', name: 'AC inventory', description: 'Air conditioner inventory', metricFamily: 'demand', semanticRole: 'inventory', dataKind: 'timeseries', lifecycleStatus: 'DISCOVERED', sourcePolicies: [] },
], registeredIndustryCount: 2, definitionCount: 2, canonicalCount: 0 }

function setup(overrides: Partial<Record<string, unknown>> = {}) {
  const client = {
    getDataSourceCatalog: vi.fn().mockResolvedValue({ rows: [{ metricId: 'price.close', chineseMeaning: '收盘价', capability: 'market_data', workflowId: 'valuation', defaultSource: 'Quotes One', fallback1: null, fallback2: null, finalFallback: '公网搜索', coverageComplete: true }], coverageComplete: true }),
    getCommonDataCatalog: vi.fn().mockResolvedValue(commonCatalog),
    getIndustryDataCatalog: vi.fn().mockResolvedValue(industryCatalog),
    listDataSourceIntegrations: vi.fn().mockResolvedValue([integration]),
    listDataSourceOnboardingDrafts: vi.fn().mockResolvedValue([]),
    testDataSourceIntegration: vi.fn().mockResolvedValue({ status: 'passed' }),
    saveDataSourceCredentials: vi.fn().mockResolvedValue({ saved: true }),
    removeDataSourceCredentials: vi.fn().mockResolvedValue({ removed: true }),
    createDataSourceOnboardingDraft: vi.fn().mockResolvedValue(draft),
    updateDataSourceOnboardingDraft: vi.fn().mockResolvedValue(draft),
    markDataSourceOnboardingDraftReady: vi.fn().mockResolvedValue(draft),
    ...overrides,
  } as unknown as RuntimeClient
  render(<LanguageProvider><DataSourcesPage client={client} /></LanguageProvider>)
  return client
}

describe('DataSourcesPage', () => {
  it('keeps only the three top-level tabs and nests both catalogs under Source policies', async () => {
    const client = setup()
    const tabs = within(screen.getByRole('tablist', { name: '数据源管理' })).getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['来源策略', '已配置集成', '接入新数据源'])
    expect(screen.queryByRole('tab', { name: '数据字段' })).toBeNull()
    expect(await screen.findByRole('tab', { name: '通用字段' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: '行业字段' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: '行业字段' }).getAttribute('aria-selected')).toBe('true')
    expect(await screen.findByRole('table', { name: '行业指标目录' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'battery_output' })).toBeTruthy()
    expect(client.getDataSourceCatalog).not.toHaveBeenCalled()
    window.localStorage.setItem('researchhub.language', 'en')
    cleanup()
    setup()
    expect(await screen.findByRole('tab', { name: 'Source policies' })).toBeTruthy()
    expect(screen.queryByRole('tab', { name: 'Data Fields' })).toBeNull()
    expect(screen.getByRole('tab', { name: 'Common fields' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Industry fields' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Industry fields' }).getAttribute('aria-selected')).toBe('true')
    expect(await screen.findByRole('table', { name: 'Industry metric catalog' })).toBeTruthy()
  })

  it('keeps the Common source-policy columns and projects Industry metric semantics in its list', async () => {
    setup()
    const commonHeaders = ['字段标识', '中文含义', '消费者', '默认源', '一级备用源', '二级备用源', '兜底备用源']
    fireEvent.click(await screen.findByRole('tab', { name: '通用字段' }))
    expect(within(await screen.findByRole('table')).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(commonHeaders)
    expect(screen.queryByText('capability', { selector: 'th' })).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: '行业字段' }))
    const industryTable = await screen.findByRole('table', { name: '行业指标目录' })
    expect(within(industryTable).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['industryId', 'metricId', '名称', '描述', 'metricFamily', 'semanticRole', 'dataKind', 'lifecycleStatus'])
    expect(Array.from(industryTable.querySelectorAll<HTMLTableRowElement>('tbody tr')[0]!.cells).map((cell) => cell.textContent)).toEqual(['lithium_battery', 'battery_output', 'Battery output', 'Lithium battery output', 'supply', 'production', 'timeseries', 'VALIDATED'])
    window.localStorage.setItem('researchhub.language', 'en')
    cleanup()
    setup()
    const englishHeaders = ['Field ID', 'Meaning', 'Consumers', 'Default source', 'Fallback 1', 'Fallback 2', 'Final fallback']
    fireEvent.click(await screen.findByRole('tab', { name: 'Common fields' }))
    expect(within(await screen.findByRole('table')).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(englishHeaders)
    fireEvent.click(await screen.findByRole('tab', { name: 'Industry fields' }))
    expect(within(await screen.findByRole('table', { name: 'Industry metric catalog' })).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['industryId', 'metricId', 'Name', 'Description', 'metricFamily', 'semanticRole', 'dataKind', 'lifecycleStatus'])
  })

  it('keeps Common SourcePolicy boundaries, groups every source level, and omits unbound LLM_WEB', async () => {
    const candidate = (sourceId: string, fallbackLevel: string, runtimeAdapterStatus = 'BOUND') => ({ sourceId, fallbackLevel, originAuthority: 'S1_OFFICIAL', operationId: `${sourceId}.read`, supports: {}, runtimeAdapterStatus, connectionTestStatus: 'NOT_TESTED', capabilitySampleStatus: 'NOT_TESTED', historicalPitStatus: 'NOT_VERIFIED', integrations: [] })
    const definition = commonCatalog.definitions[0]!
    const projection = { definitions: [{ ...definition, sourcePolicies: [
      { policyId: 'valuation-policy', selectionMode: 'CROSS_CHECK', requirementMatch: { workflow: 'valuation', metricId: 'revenue' }, candidates: [candidate('nbs', 'PRIMARY'), candidate('cninfo', 'PRIMARY'), candidate('eastmoney', 'FALLBACK_1'), candidate('vendor-b', 'FALLBACK_2'), candidate('public-search', 'LLM_WEB', 'UNBOUND')] },
      { policyId: 'company-policy', selectionMode: 'FIRST_VALID', requirementMatch: { workflow: 'company-research', metricId: 'revenue' }, candidates: [candidate('company-api', 'PRIMARY')] },
    ] }], definitionCount: 1 }
    const legacyPolicies = vi.fn().mockResolvedValue({ rows: [{ metricId: 'revenue', finalFallback: '公网搜索' }], coverageComplete: true })
    const client = setup({ getCommonDataCatalog: vi.fn().mockResolvedValue(projection), getDataSourceCatalog: legacyPolicies })
    fireEvent.click(await screen.findByRole('tab', { name: '通用字段' }))
    const rows = Array.from((await screen.findByRole('table')).querySelectorAll('tbody tr'))
    expect(rows).toHaveLength(2)
    const values = rows.map((row) => Array.from(row.querySelectorAll('th, td')).map((cell) => cell.textContent?.trim()))
    expect(values[0]).toEqual(['revenue', 'Revenue', 'valuation, company-research', 'nbs, cninfo', 'eastmoney', 'vendor-b', '—'])
    expect(values[1]).toEqual(['revenue', 'Revenue', 'valuation, company-research', 'company-api', '—', '—', '—'])
    expect(client.getDataSourceCatalog).not.toHaveBeenCalled()
    expect(screen.queryByText('公网搜索')).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: /^revenue$/ })[0]!)
    expect(await screen.findByText('valuation-policy')).toBeTruthy()
    expect(screen.getByText('company-policy')).toBeTruthy()
  })

  it('keeps Industry rows metric-scoped and exposes policy consumers and mappings in details', async () => {
    const candidate = { sourceId: 'miit', fallbackLevel: 'PRIMARY', originAuthority: 'S1_OFFICIAL', operationId: 'miit.metric', supports: {}, runtimeAdapterStatus: 'BOUND', connectionTestStatus: 'NOT_TESTED', capabilitySampleStatus: 'NOT_TESTED', historicalPitStatus: 'NOT_VERIFIED', integrations: [] }
    const definition = industryCatalog.definitions[0]!
    const projection = { ...industryCatalog, definitions: [{ ...definition, sourcePolicies: [
      { policyId: 'industry-workflow-policy', mappingStatus: 'MAPPED', policy: { policyId: 'industry-workflow-policy', selectionMode: 'FIRST_VALID', requirementMatch: { workflow: 'industry-deep-research', metricId: definition.metricId }, candidates: [candidate] } },
      { policyId: 'workflow-not-declared', mappingStatus: 'MAPPED', policy: { policyId: 'workflow-not-declared', selectionMode: 'FIRST_VALID', requirementMatch: { metricId: definition.metricId }, candidates: [candidate] } },
      { policyId: 'policy-not-registered', mappingStatus: 'UNMAPPED' },
    ] }], definitionCount: 1, canonicalCount: 0 }
    setup({ getIndustryDataCatalog: vi.fn().mockResolvedValue(projection) })
    fireEvent.click(await screen.findByRole('tab', { name: '行业字段' }))
    const table = await screen.findByRole('table', { name: '行业指标目录' })
    const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>('tbody tr'))
    expect(rows).toHaveLength(1)
    expect(rows[0]!.cells[4]?.textContent).toBe(definition.metricFamily)
    expect(rows[0]!.cells[5]?.textContent).toBe(definition.semanticRole)
    fireEvent.click(within(rows[0]!).getByRole('button'))
    expect(await screen.findByText('industry-workflow-policy')).toBeTruthy()
    expect(screen.getByText('workflow-not-declared')).toBeTruthy()
    expect(screen.getByText('policy-not-registered')).toBeTruthy()
    expect(within(screen.getByRole('complementary', { name: '字段详情' })).getByText('industry-deep-research')).toBeTruthy()
    expect(within(screen.getByRole('complementary', { name: '字段详情' })).getByText('UNMAPPED')).toBeTruthy()
  })

  it('searches and filters Common definitions', async () => {
    setup()
    fireEvent.click(await screen.findByRole('tab', { name: '来源策略' }))
    fireEvent.click(await screen.findByRole('tab', { name: '通用字段' }))
    expect(await screen.findByRole('button', { name: /^revenue$/ })).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: '搜索字段' }), { target: { value: 'revenue' } })
    expect(screen.getByRole('button', { name: /^revenue$/ })).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: '搜索字段' }), { target: { value: '增长' } })
    expect(screen.getByRole('button', { name: /revenue_growth/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^revenue$/ })).toBeNull()
    fireEvent.change(screen.getByRole('textbox', { name: '搜索字段' }), { target: { value: '' } })
    fireEvent.change(screen.getByRole('combobox', { name: '数据类型' }), { target: { value: 'derived_metric' } })
    expect(screen.getByRole('button', { name: /revenue_growth/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^revenue$/ })).toBeNull()
    fireEvent.change(screen.getByRole('combobox', { name: '消费者' }), { target: { value: 'company-research' } })
    expect(screen.queryByRole('button', { name: /revenue_growth/ })).toBeNull()
    expect(screen.getByText('没有匹配的字段')).toBeTruthy()
  })

  it('filters Industry metrics by identity family and lifecycle', async () => {
    setup()
    fireEvent.click(await screen.findByRole('tab', { name: '来源策略' }))
    fireEvent.click(screen.getByRole('tab', { name: '行业字段' }))
    expect(await screen.findByRole('button', { name: /battery_output/ })).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox', { name: '行业' }), { target: { value: 'household_air_conditioner' } })
    expect(screen.getByRole('button', { name: /ac_inventory/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /battery_output/ })).toBeNull()
    fireEvent.change(screen.getByRole('combobox', { name: '行业' }), { target: { value: '' } })
    fireEvent.change(screen.getByRole('combobox', { name: '指标族' }), { target: { value: 'supply' } })
    expect(screen.getByRole('button', { name: /battery_output/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /ac_inventory/ })).toBeNull()
    fireEvent.change(screen.getByRole('combobox', { name: '指标族' }), { target: { value: '' } })
    fireEvent.change(screen.getByRole('combobox', { name: '生命周期' }), { target: { value: 'DISCOVERED' } })
    expect(screen.getByRole('button', { name: /ac_inventory/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /battery_output/ })).toBeNull()
    fireEvent.change(screen.getByRole('combobox', { name: '生命周期' }), { target: { value: 'ALL' } })
    fireEvent.change(screen.getByRole('textbox', { name: '搜索字段' }), { target: { value: 'Battery output' } })
    expect(screen.getByRole('button', { name: /battery_output/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /ac_inventory/ })).toBeNull()
  })

  it('shows complete metric details with undefined optional metadata', async () => {
    setup()
    fireEvent.click(await screen.findByRole('tab', { name: '来源策略' }))
    fireEvent.click(screen.getByRole('tab', { name: '行业字段' }))
    fireEvent.click(await screen.findByRole('button', { name: /battery_output/ }))
    expect(screen.getAllByText('GWh').length).toBeGreaterThan(0)
    expect(screen.getByText('PERIOD')).toBeTruthy()
    expect(within(screen.getByRole('complementary', { name: '字段详情' })).getAllByText('未定义').length).toBeGreaterThan(0)
    expect(within(screen.getByRole('complementary', { name: '字段详情' })).getAllByText('VALIDATED').length).toBeGreaterThan(0)
  })

  it('separates policy configuration from adapter and test state', async () => {
    setup()
    fireEvent.click(await screen.findByRole('tab', { name: '来源策略' }))
    fireEvent.click(await screen.findByRole('tab', { name: '通用字段' }))
    fireEvent.click(await screen.findByRole('button', { name: /^revenue$/ }))
    expect(screen.getAllByText('已配置').length).toBeGreaterThan(0)
    expect(screen.getByText('状态未知')).toBeTruthy()
    expect(within(screen.getByRole('complementary', { name: '字段详情' })).getAllByText('未测试').length).toBeGreaterThan(0)
    expect(screen.getByText('未验证')).toBeTruthy()
    window.localStorage.setItem('researchhub.language', 'en')
    cleanup()
    setup()
    fireEvent.click(await screen.findByRole('tab', { name: 'Source policies' }))
    fireEvent.click(await screen.findByRole('tab', { name: 'Common fields' }))
    fireEvent.click(await screen.findByRole('button', { name: /^revenue$/ }))
    expect(within(screen.getByRole('complementary', { name: 'Field details' })).getAllByText('Configured').length).toBeGreaterThan(0)
    expect(screen.getByText('Unknown')).toBeTruthy()
    expect(within(screen.getByRole('complementary', { name: 'Field details' })).getAllByText('Not tested').length).toBeGreaterThan(0)
    expect(screen.getByText('Not verified')).toBeTruthy()
  })

  it('renders unknown adapter status in Chinese and English', async () => {
    setup()
    fireEvent.click(await screen.findByRole('tab', { name: '来源策略' }))
    fireEvent.click(await screen.findByRole('tab', { name: '通用字段' }))
    fireEvent.click(await screen.findByRole('button', { name: /^revenue$/ }))
    expect(screen.getByText('状态未知')).toBeTruthy()
    window.localStorage.setItem('researchhub.language', 'en')
    cleanup()
    setup()
    fireEvent.click(await screen.findByRole('tab', { name: 'Source policies' }))
    fireEvent.click(await screen.findByRole('tab', { name: 'Common fields' }))
    fireEvent.click(await screen.findByRole('button', { name: /^revenue$/ }))
    expect(screen.getByText('Unknown')).toBeTruthy()
  })

  it('shows empty production Industry catalog without fixtures', async () => {
    setup({ getIndustryDataCatalog: vi.fn().mockResolvedValue({ identities: industryCatalog.identities, definitions: [], registeredIndustryCount: 2, definitionCount: 0, canonicalCount: 0 }) })
    fireEvent.click(await screen.findByRole('tab', { name: '来源策略' }))
    fireEvent.click(screen.getByRole('tab', { name: '行业字段' }))
    expect(await screen.findByText('当前没有已注册的行业数据字段。')).toBeTruthy()
    expect(screen.getAllByText(/已注册行业身份：2/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/正式 Canonical 指标：0/).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /battery_output|ac_inventory/ })).toBeNull()
    expect(within(await screen.findByRole('table', { name: '行业指标目录' })).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['industryId', 'metricId', '名称', '描述', 'metricFamily', 'semanticRole', 'dataKind', 'lifecycleStatus'])
  })

  it('isolates catalog load errors from integrations and onboarding', async () => {
    setup({ getCommonDataCatalog: vi.fn().mockRejectedValue(new Error('projection failed')) })
    fireEvent.click(await screen.findByRole('tab', { name: '已配置集成' }))
    expect(await screen.findByText('Quotes One')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: '来源策略' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByText('projection failed')).toBeNull()
  })

  it('refresh reloads both catalog projections', async () => {
    const client = setup()
    fireEvent.click(await screen.findByRole('tab', { name: '来源策略' }))
    await waitFor(() => expect(client.getCommonDataCatalog).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(client.getIndustryDataCatalog).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    await waitFor(() => expect(client.getCommonDataCatalog).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(client.getIndustryDataCatalog).toHaveBeenCalledTimes(2))
  })

  it('finishes credential saves while catalog refresh requests remain pending', async () => {
    const commonResolvers: Array<(value: typeof commonCatalog) => void> = []
    const industryResolvers: Array<(value: typeof industryCatalog) => void> = []
    const client = setup({
      getCommonDataCatalog: vi.fn(() => new Promise((resolve) => commonResolvers.push(resolve))),
      getIndustryDataCatalog: vi.fn(() => new Promise((resolve) => industryResolvers.push(resolve))),
    })
    fireEvent.click(await screen.findByRole('tab', { name: '已配置集成' }))
    fireEvent.click(await screen.findByRole('button', { name: '管理凭据' }))
    fireEvent.change(screen.getByLabelText(/^API Key/), { target: { value: 'typed-secret' } })
    fireEvent.click(screen.getByRole('button', { name: '保存凭据' }))
    expect(await screen.findByText('凭据已保存到系统凭据库。')).toBeTruthy()
    expect((screen.getByRole('button', { name: '移除凭据' }) as HTMLButtonElement).disabled).toBe(false)
    commonResolvers.forEach((resolve) => resolve(commonCatalog))
    industryResolvers.forEach((resolve) => resolve(industryCatalog))
    expect(client.saveDataSourceCredentials).toHaveBeenCalledTimes(1)
  })

  it('finishes credential removal while catalog refresh requests remain pending', async () => {
    const commonResolvers: Array<(value: typeof commonCatalog) => void> = []
    const industryResolvers: Array<(value: typeof industryCatalog) => void> = []
    const client = setup({
      getCommonDataCatalog: vi.fn(() => new Promise((resolve) => commonResolvers.push(resolve))),
      getIndustryDataCatalog: vi.fn(() => new Promise((resolve) => industryResolvers.push(resolve))),
    })
    fireEvent.click(await screen.findByRole('tab', { name: '已配置集成' }))
    fireEvent.click(await screen.findByRole('button', { name: '管理凭据' }))
    fireEvent.click(screen.getByRole('button', { name: '移除凭据' }))
    expect(await screen.findByText('凭据已移除。')).toBeTruthy()
    expect((screen.getByRole('button', { name: '移除凭据' }) as HTMLButtonElement).disabled).toBe(false)
    commonResolvers.forEach((resolve) => resolve(commonCatalog))
    industryResolvers.forEach((resolve) => resolve(industryCatalog))
    expect(client.removeDataSourceCredentials).toHaveBeenCalledTimes(1)
  })

  it('clears a completed test while catalog refresh requests remain pending', async () => {
    const commonResolvers: Array<(value: typeof commonCatalog) => void> = []
    const industryResolvers: Array<(value: typeof industryCatalog) => void> = []
    const client = setup({
      getCommonDataCatalog: vi.fn(() => new Promise((resolve) => commonResolvers.push(resolve))),
      getIndustryDataCatalog: vi.fn(() => new Promise((resolve) => industryResolvers.push(resolve))),
    })
    fireEvent.click(await screen.findByRole('tab', { name: '已配置集成' }))
    fireEvent.click(await screen.findByRole('button', { name: '测试连接' }))
    expect(await screen.findByRole('button', { name: '测试连接' })).toBeTruthy()
    commonResolvers.forEach((resolve) => resolve(commonCatalog))
    industryResolvers.forEach((resolve) => resolve(industryCatalog))
    expect(client.testDataSourceIntegration).toHaveBeenCalledTimes(1)
  })

  it('shows catalog loading while projections are pending', async () => {
    let resolveCommon!: (value: typeof commonCatalog) => void
    let resolveIndustry!: (value: typeof industryCatalog) => void
    const client = setup({
      getCommonDataCatalog: vi.fn(() => new Promise((resolve) => { resolveCommon = resolve })),
      getIndustryDataCatalog: vi.fn(() => new Promise((resolve) => { resolveIndustry = resolve })),
    })
    fireEvent.click(await screen.findByRole('tab', { name: '来源策略' }))
    expect(await screen.findByText('正在加载字段目录…')).toBeTruthy()
    resolveCommon(commonCatalog); resolveIndustry(industryCatalog)
    await waitFor(() => expect(client.getCommonDataCatalog).toHaveBeenCalledTimes(1))
    expect(await screen.findByText(/显示 2 \/ 2 项/)).toBeTruthy()
  })

  it('keeps source policies, integrations, and onboarding in separate tabs', async () => {
    setup()
    fireEvent.click(await screen.findByRole('tab', { name: '通用字段' }))
    await screen.findByRole('button', { name: /^revenue$/ })
    expect(screen.getByRole('tab', { name: '来源策略' })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: '已配置集成' }))
    expect(await screen.findByText('Quotes One')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: '接入新数据源' }))
    expect(screen.getByRole('heading', { name: '新增数据源' })).toBeTruthy()
    expect(screen.queryByText('Quotes One')).toBeNull()
  })

  it('distinguishes adapter/configuration state from test state', async () => {
    setup()
    fireEvent.click(screen.getByRole('tab', { name: '已配置集成' }))
    expect(await screen.findByText(/已验证/)).toBeTruthy()
    expect(screen.getByText(/待 SourcePolicy 接入/)).toBeTruthy()
    expect(screen.getByText(/连接凭据已配置/)).toBeTruthy()
    expect(screen.getByText((_text, element) => element?.tagName === 'P' && element.textContent?.includes('连接测试：测试通过') === true)).toBeTruthy()
  })

  it('shows credential management only for integrations with credential fields', async () => {
    const noCredentials = { ...integration, integration: { ...integration.integration, integrationId: 'public-feed', displayName: 'Public Feed', credentialFields: [] }, credentialState: 'not_required' as const, latestTests: [] }
    setup({ listDataSourceIntegrations: vi.fn().mockResolvedValue([integration, noCredentials]) })
    fireEvent.click(screen.getByRole('tab', { name: '已配置集成' }))
    const credentialCard = (await screen.findByRole('heading', { name: 'Quotes One' })).closest('article')!
    const publicCard = screen.getByRole('heading', { name: 'Public Feed' }).closest('article')!
    expect(within(credentialCard).getByRole('button', { name: '管理凭据' })).toBeTruthy()
    expect(within(publicCard).queryByRole('button', { name: '管理凭据' })).toBeNull()
  })

  it('clears credential inputs after save and never renders returned secret values', async () => {
    const client = setup({ saveDataSourceCredentials: vi.fn().mockResolvedValue({ secret: 'returned-secret' }) })
    fireEvent.click(screen.getByRole('tab', { name: '已配置集成' }))
    fireEvent.click(await screen.findByRole('button', { name: '管理凭据' }))
    const input = screen.getByLabelText(/^API Key/) as HTMLInputElement
    expect(input.value).toBe('')
    fireEvent.change(input, { target: { value: 'typed-secret' } })
    fireEvent.click(screen.getByRole('button', { name: '保存凭据' }))
    await waitFor(() => expect(input.value).toBe(''))
    expect(screen.queryByText('returned-secret')).toBeNull()
    expect(client.saveDataSourceCredentials).toHaveBeenCalledWith('quotes-one', { api_key: 'typed-secret' })
  })

  it('renders supported tests and safe failure categories only', async () => {
    setup({ testDataSourceIntegration: vi.fn().mockResolvedValue({ status: 'failed', errorCode: 'authentication_failed', error: 'secret token leaked' }) })
    fireEvent.click(screen.getByRole('tab', { name: '已配置集成' }))
    fireEvent.click(await screen.findByRole('button', { name: '测试连接' }))
    expect(await screen.findByText(/认证失败/)).toBeTruthy()
    expect(screen.queryByText(/secret token leaked/)).toBeNull()
    expect(screen.queryByRole('button', { name: /任意 URL|脚本测试/ })).toBeNull()
  })

  it('cancels a running test and restores its idle state', async () => {
    let signal: AbortSignal | undefined
    setup({ testDataSourceIntegration: vi.fn((_id: string, _input: unknown, value: AbortSignal) => { signal = value; return new Promise((_resolve, reject) => value.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))) }) })
    fireEvent.click(screen.getByRole('tab', { name: '已配置集成' }))
    fireEvent.click(await screen.findByRole('button', { name: '测试连接' }))
    fireEvent.click(await screen.findByRole('button', { name: '取消测试' }))
    await waitFor(() => expect(signal?.aborted).toBe(true))
    expect(await screen.findByRole('button', { name: '测试连接' })).toBeTruthy()
  })

  it('keeps one global test cancellable after switching integrations and tabs', async () => {
    let firstSignal: AbortSignal | undefined
    const second = { ...integration, integration: { ...integration.integration, integrationId: 'quotes-two', displayName: 'Quotes Two' }, latestTests: [] }
    const client = setup({
      listDataSourceIntegrations: vi.fn().mockResolvedValue([integration, second]),
      testDataSourceIntegration: vi.fn((_id: string, _input: unknown, signal: AbortSignal) => {
        firstSignal = signal
        return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))))
      }),
    })
    fireEvent.click(screen.getByRole('tab', { name: '已配置集成' }))
    const firstCard = await screen.findByRole('heading', { name: 'Quotes One' })
    fireEvent.click(within(firstCard.closest('article')!).getByRole('button', { name: '测试连接' }))
    await waitFor(() => expect(firstSignal).toBeInstanceOf(AbortSignal))
    expect(screen.getAllByRole('button', { name: '测试连接' }).every((button) => (button as HTMLButtonElement).disabled)).toBe(true)
    fireEvent.click(screen.getByRole('tab', { name: '接入新数据源' }))
    expect(await screen.findByText(/正在测试 Quotes One/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '取消测试' }))
    await waitFor(() => expect(firstSignal?.aborted).toBe(true))
    fireEvent.click(screen.getByRole('tab', { name: '已配置集成' }))
    await waitFor(() => expect(screen.getAllByRole('button', { name: '测试连接' }).every((button) => !(button as HTMLButtonElement).disabled)).toBe(true))
    expect(client.testDataSourceIntegration).toHaveBeenCalledTimes(1)
  })

  it('creates and edits a local onboarding draft without offering arbitrary code or URL tests', async () => {
    const client = setup()
    fireEvent.click(screen.getByRole('tab', { name: '接入新数据源' }))
    await screen.findByRole('heading', { name: '新增数据源' })
    fireEvent.change(screen.getByLabelText('集成 ID'), { target: { value: 'draft-source' } })
    fireEvent.change(screen.getByLabelText('显示名称'), { target: { value: 'Draft Source' } })
    fireEvent.change(screen.getByLabelText('文档地址'), { target: { value: 'https://example.test/docs' } })
    fireEvent.change(screen.getByLabelText('发布方'), { target: { value: 'Example' } })
    fireEvent.change(screen.getByLabelText('能力 ID（逗号分隔）'), { target: { value: 'quotes' } })
    fireEvent.change(screen.getByLabelText('metricId（逗号分隔）'), { target: { value: 'price.close' } })
    fireEvent.change(screen.getByLabelText('权利说明'), { target: { value: 'Reviewed' } })
    fireEvent.change(screen.getByLabelText('限流说明'), { target: { value: '100/min' } })
    fireEvent.change(screen.getByLabelText('时间边界说明'), { target: { value: 'Daily' } })
    fireEvent.click(screen.getByLabelText('已审阅服务条款'))
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() => expect(client.createDataSourceOnboardingDraft).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText('发布方'), { target: { value: 'Example Updated' } })
    fireEvent.click(screen.getByRole('button', { name: '更新草稿' }))
    await waitFor(() => expect(client.updateDataSourceOnboardingDraft).toHaveBeenCalledWith('req-1', expect.objectContaining({ publisher: 'Example Updated' })))
    expect(screen.queryByRole('button', { name: /执行代码|测试 URL/ })).toBeNull()
    expect(screen.getByRole('button', { name: '标记为待适配' })).toBeTruthy()
  })
})
