import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LanguageProvider } from '../../i18n'
import { SettingsPanel } from './SettingsPanel'

afterEach(cleanup)
beforeEach(() => window.localStorage.setItem('researchhub.language', 'zh-CN'))

function renderSettings(overrides: Partial<React.ComponentProps<typeof SettingsPanel>> = {}) {
  const props: React.ComponentProps<typeof SettingsPanel> = {
    model: { selected: { provider: 'openai', modelId: 'gpt-5' }, availableCount: 1, options: [{ provider: 'openai', modelId: 'gpt-5', name: 'GPT 5', available: true }], connections: [{ providerId: 'openai', name: 'OpenAI', status: 'connected' }], subscriptionLogin: { status: 'awaiting_user', prompt: 'Paste the redirect answer', verificationUri: 'https://auth.example.test', userCode: 'ABCD-1234' } },
    knowledge: { mounted: { id: 'kb-main', schemaVersion: '0.4', revision: 8, mounted: true, registered: true }, candidates: [{ id: 'kb-main', schemaVersion: '0.4', revision: 8, mounted: true, registered: true }, { id: 'kb-extra', schemaVersion: '0.3', revision: 2, mounted: false, registered: true }], verification: { valid: false, message: 'Directory has not been validated' } },
    onRefresh: vi.fn(), onBeginSubscriptionLogin: vi.fn(), onSubmitSubscriptionAnswer: vi.fn(), onCancelSubscriptionLogin: vi.fn(), onSaveApiKey: vi.fn(), onRemoveCredentials: vi.fn(), onSaveCompatibleEndpoint: vi.fn(), onTestConnection: vi.fn(), onVerifyKnowledgeDirectory: vi.fn(), onRegisterKnowledgeDirectory: vi.fn(), onRemoveKnowledgeBase: vi.fn(), onRefreshKnowledgeBases: vi.fn(), onMountKnowledgeBase: vi.fn(), onUnmountKnowledgeBase: vi.fn(),
    ...overrides,
  }
  const result = render(<LanguageProvider><SettingsPanel {...props} /></LanguageProvider>)
  return { ...result, props }
}

describe('SettingsPanel', () => {
  it('opens its anchored menu, applies language immediately, and restores focus after Escape', async () => {
    renderSettings()
    const trigger = screen.getByRole('button', { name: '设置' })
    fireEvent.click(trigger)
    expect(screen.getByRole('group', { name: '设置选项' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'English' }))
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Model connections' }))
    const dialog = screen.getByRole('dialog', { name: 'Model connections' })
    expect(dialog).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('keeps the OAuth answer editable and sends only an explicit model test request', async () => {
    const { props } = renderSettings()
    fireEvent.click(screen.getByRole('button', { name: '设置' }))
    fireEvent.click(screen.getByRole('button', { name: '模型接入' }))
    expect(screen.getByText('Paste the redirect answer')).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: '授权码或登录答复' }), { target: { value: 'manual-code' } })
    fireEvent.click(screen.getByRole('button', { name: '提交授权答复' }))
    expect(props.onSubmitSubscriptionAnswer).toHaveBeenCalledWith('manual-code')
    fireEvent.click(screen.getByRole('button', { name: '测试连接' }))
    expect(props.onTestConnection).toHaveBeenCalledWith('openai', 'gpt-5')
  })

  it('keeps the modal open during a busy operation and returns focus after a normal close', async () => {
    const { rerender, props } = renderSettings()
    fireEvent.click(screen.getByRole('button', { name: '设置' }))
    fireEvent.click(screen.getByRole('button', { name: '知识库管理' }))
    const dialog = screen.getByRole('dialog', { name: '知识库管理' })
    rerender(<LanguageProvider><SettingsPanel {...props} busy /></LanguageProvider>)
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.mouseDown(document.querySelector('.settings-backdrop') as HTMLElement)
    expect(screen.getByRole('dialog')).toBe(dialog)
    rerender(<LanguageProvider><SettingsPanel {...props} /></LanguageProvider>)
    fireEvent.click(screen.getByRole('button', { name: '关闭设置' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '设置' })))
  })

  it('submits only deliberate knowledge operations and leaves registration unavailable before successful validation', () => {
    const { props } = renderSettings()
    fireEvent.click(screen.getByRole('button', { name: '设置' }))
    fireEvent.click(screen.getByRole('button', { name: '知识库管理' }))
    expect(screen.getAllByText('kb-main')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: /^挂载$/ }))
    expect(props.onMountKnowledgeBase).toHaveBeenCalledWith('kb-extra')
    const path = screen.getByRole('textbox', { name: '知识库目录绝对路径' })
    fireEvent.change(path, { target: { value: 'C:\\ResearchHubData\\knowledge-bases\\custom' } })
    expect(screen.getByRole('button', { name: '登记目录' })).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('button', { name: '验证目录' }))
    expect(props.onVerifyKnowledgeDirectory).toHaveBeenCalledWith('C:\\ResearchHubData\\knowledge-bases\\custom')
    expect(props.onRefresh).not.toHaveBeenCalled()
  })

  it('retains credential inputs when the parent reports a rejected save', async () => {
    const saveKey = vi.fn().mockRejectedValue(new Error('conflict'))
    const saveEndpoint = vi.fn().mockRejectedValue(new Error('conflict'))
    renderSettings({ model: { selected: { provider: 'openai', modelId: 'gpt-5' }, availableCount: 1, connections: [{ providerId: 'openai', name: 'OpenAI API', status: 'needs_api_key', apiKeySupported: true }] }, onSaveApiKey: saveKey, onSaveCompatibleEndpoint: saveEndpoint })
    fireEvent.click(screen.getByRole('button', { name: '设置' }))
    fireEvent.click(screen.getByRole('button', { name: '模型接入' }))
    const keyField = document.querySelector('.settings-inline-form input[type="password"]') as HTMLInputElement
    fireEvent.change(keyField, { target: { value: 'temporary-secret' } })
    fireEvent.click(screen.getByRole('button', { name: '保存 Key' }))
    await waitFor(() => expect(saveKey).toHaveBeenCalledWith('openai', 'temporary-secret'))
    await waitFor(() => expect(keyField.value).toBe('temporary-secret'))

    fireEvent.change(screen.getByRole('textbox', { name: '名称' }), { target: { value: 'Local endpoint' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Provider ID' }), { target: { value: 'local-provider' } })
    fireEvent.change(screen.getByRole('textbox', { name: '模型 ID' }), { target: { value: 'model-1' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Base URL' }), { target: { value: 'http://127.0.0.1:8080/v1' } })
    const endpointKey = document.querySelector('.settings-endpoint-form input[type="password"]') as HTMLInputElement
    fireEvent.change(endpointKey, { target: { value: 'endpoint-secret' } })
    fireEvent.submit(document.querySelector('.settings-endpoint-form') as HTMLFormElement)
    await waitFor(() => expect(saveEndpoint).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'local-provider', modelId: 'model-1', apiKey: 'endpoint-secret' })))
    await waitFor(() => expect(endpointKey.value).toBe('endpoint-secret'))
  })
})
