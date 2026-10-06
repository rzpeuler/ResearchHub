import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeClient } from '../../api/runtime-client'
import { LanguageProvider } from '../../i18n'
import { DataSourcesPage } from './DataSourcesPage'

afterEach(cleanup)
beforeEach(() => window.localStorage.setItem('researchhub.language', 'zh-CN'))

const integration = { integration: { integrationId: 'quotes-one', displayName: 'Quotes One', sourceIds: ['quotes-one'], credentialFields: [{ id: 'api_key', label: 'API Key', required: true }], capabilities: [{ id: 'quotes', label: 'Quotes', metricIds: ['price.close'] }], supportedTests: { connection: true, capabilitySamples: ['quotes'] } }, credentialState: 'configured', policyLinked: false, latestTests: [{ integrationId: 'quotes-one', kind: 'connection', status: 'passed', startedAt: '2026-10-06', completedAt: '2026-10-06' }, { integrationId: 'quotes-one', kind: 'capability_sample', capabilityId: 'quotes', status: 'passed', startedAt: '2026-10-06', completedAt: '2026-10-06' }] }
const draft = { requestId: 'req-1', input: { integrationId: 'draft-source', displayName: 'Draft Source', documentationUrl: 'https://example.test/docs', accessMode: 'api', publisher: 'Example', proposedAuthority: 'S1_OFFICIAL', capabilityIds: ['quotes'], metricIds: ['price.close'], authenticationMode: 'api_key', rightsNotes: 'Reviewed', rateLimitNotes: '100/min', timeBoundaryNotes: 'Daily', providerTermsReviewed: true }, status: 'draft', createdAt: 'now', updatedAt: 'now' }

function setup(overrides: Partial<Record<string, unknown>> = {}) {
  const client = {
    getDataSourceCatalog: vi.fn().mockResolvedValue({ rows: [{ metricId: 'price.close', chineseMeaning: '收盘价', capability: 'market_data', workflowId: 'valuation', defaultSource: 'Quotes One', fallback1: null, fallback2: null, finalFallback: '公网搜索', coverageComplete: true }], coverageComplete: true }),
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
  it('keeps source policies, integrations, and onboarding in separate tabs', async () => {
    setup()
    await screen.findByText('收盘价')
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
