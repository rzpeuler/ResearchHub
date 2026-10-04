import { useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent, ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { useLanguage } from '../../i18n'
import './settings-panel.css'

export interface SettingsConnection {
  readonly providerId: string
  readonly name: string
  readonly status: 'connected' | 'needs_api_key' | 'needs_auth' | 'unsupported'
  readonly apiKeySupported?: boolean
  readonly detail?: string
}

export interface SettingsModelState {
  readonly selected?: { readonly provider: string; readonly modelId: string }
  readonly availableCount: number
  readonly options?: readonly { readonly provider: string; readonly modelId: string; readonly name: string; readonly available: boolean; readonly unavailableReason?: string }[]
  readonly connections: readonly SettingsConnection[]
  readonly subscriptionLogin?: {
    readonly status: 'idle' | 'pending' | 'awaiting_user' | 'connected' | 'failed'
    readonly prompt?: string
    readonly verificationUri?: string
    readonly userCode?: string
    readonly message?: string
  }
}

export interface SettingsKnowledgeBase {
  readonly id: string
  readonly schemaVersion: string
  readonly revision: number
  readonly mounted: boolean
  readonly registered: boolean
  readonly available?: boolean
}

export interface SettingsKnowledgeState {
  readonly mounted?: SettingsKnowledgeBase
  readonly candidates: readonly SettingsKnowledgeBase[]
  readonly discoverySummary?: string
  readonly verification?: { readonly valid: boolean; readonly message: string }
}

export interface CompatibleEndpointInput {
  readonly name: string
  readonly providerId: string
  readonly modelId: string
  readonly protocol: 'openai' | 'anthropic'
  readonly baseUrl: string
  readonly contextWindow: number
  readonly maxOutputTokens: number
  readonly apiKey: string
}

export interface SettingsPanelProps {
  readonly model: SettingsModelState
  readonly knowledge: SettingsKnowledgeState
  readonly busy?: boolean
  readonly error?: string
  readonly modelTestMessage?: string
  readonly onRefresh: () => void | Promise<void>
  readonly onBeginSubscriptionLogin: () => void | Promise<void>
  readonly onSubmitSubscriptionAnswer: (answer: string) => void | Promise<void>
  readonly onCancelSubscriptionLogin: () => void | Promise<void>
  readonly onSaveApiKey: (providerId: string, apiKey: string) => void | Promise<void>
  readonly onRemoveCredentials: (providerId: string) => void | Promise<void>
  readonly onSaveCompatibleEndpoint: (endpoint: CompatibleEndpointInput) => void | Promise<void>
  readonly onTestConnection: (providerId: string, modelId: string) => void | Promise<void>
  readonly onVerifyKnowledgeDirectory: (path: string) => void | Promise<void>
  readonly onRegisterKnowledgeDirectory: (path: string) => void | Promise<void>
  readonly onRemoveKnowledgeBase: (knowledgeBaseId: string) => void | Promise<void>
  readonly onRefreshKnowledgeBases: () => void | Promise<void>
  readonly onMountKnowledgeBase: (knowledgeBaseId: string) => void | Promise<void>
  readonly onUnmountKnowledgeBase: () => void | Promise<void>
}

type SettingsView = 'models' | 'knowledge'

const focusableSelector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'

export function SettingsPanel(props: SettingsPanelProps): ReactElement {
  const { t, language, setLanguage } = useLanguage()
  const [menuOpen, setMenuOpen] = useState(false)
  const [view, setView] = useState<SettingsView>()
  const [menuPosition, setMenuPosition] = useState({ left: 0, bottom: 0 })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const busy = props.busy ?? false

  useEffect(() => {
    if (menuOpen) menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
  }, [menuOpen])

  useEffect(() => {
    if (view) dialogRef.current?.querySelector<HTMLElement>(focusableSelector)?.focus()
  }, [view])

  useEffect(() => {
    if (!menuOpen && !view) return
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault()
        if (view) closeDialog()
        else setMenuOpen(false)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [menuOpen, view, busy])

  function closeDialog(): void {
    if (busy) return
    setView(undefined)
    window.requestAnimationFrame(() => triggerRef.current?.focus())
  }

  function openDialog(next: SettingsView): void {
    setMenuOpen(false)
    setView(next)
  }

  function toggleMenu(): void {
    setView(undefined)
    if (!menuOpen) {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (rect) setMenuPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 230)), bottom: Math.max(8, window.innerHeight - rect.top + 10) })
    }
    setMenuOpen((open) => !open)
  }

  function trapDialogFocus(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'Tab' || !dialogRef.current) return
    const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector)]
    if (focusable.length === 0) { event.preventDefault(); return }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  return <><div className="settings-panel">
    <button ref={triggerRef} className="sidebar-settings-button" type="button" aria-haspopup="true" aria-expanded={menuOpen || Boolean(view)} aria-label={t('设置', 'Settings')} onClick={toggleMenu}>
      <span className="nav-icon" aria-hidden="true">⚙</span><span>{t('设置', 'Settings')}</span>
    </button>
    </div>{menuOpen && typeof document !== 'undefined' ? createPortal(<div className="settings-popover" style={{ left: menuPosition.left, bottom: menuPosition.bottom }} ref={menuRef} role="group" aria-label={t('设置选项', 'Settings options')}>
      <span className="settings-popover-label">{t('界面语言', 'Interface language')}</span>
      <div className="settings-language-buttons" role="group" aria-label={t('界面语言', 'Interface language')}>
        <button type="button" aria-pressed={language === 'zh-CN'} onClick={() => setLanguage('zh-CN')}>中文</button>
        <button type="button" aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>English</button>
      </div>
      <div className="settings-popover-divider" />
      <button type="button" className="settings-popover-action" onClick={() => openDialog('models')}><span aria-hidden="true">◇</span>{t('模型接入', 'Model connections')}</button>
      <button type="button" className="settings-popover-action" onClick={() => openDialog('knowledge')}><span aria-hidden="true">▧</span>{t('知识库管理', 'Knowledge Base management')}</button>
    </div>, document.body) : null}
    {view && typeof document !== 'undefined' ? createPortal(<div className="settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog() }}>
      <section ref={dialogRef} className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-dialog-title" onKeyDown={trapDialogFocus}>
        <header className="settings-dialog-header">
          <div><span className="settings-eyebrow">{t('应用配置', 'APPLICATION SETTINGS')}</span><h2 id="settings-dialog-title">{view === 'models' ? t('模型接入', 'Model connections') : t('知识库管理', 'Knowledge Base management')}</h2></div>
          <button className="settings-close" type="button" aria-label={t('关闭设置', 'Close settings')} disabled={busy} onClick={closeDialog}>×</button>
        </header>
        <div className="settings-dialog-tabs" role="tablist" aria-label={t('设置类别', 'Settings category')}>
          <button id="settings-tab-models" role="tab" aria-selected={view === 'models'} aria-controls="settings-dialog-content" type="button" onClick={() => setView('models')}>{t('模型接入', 'Model connections')}</button>
          <button id="settings-tab-knowledge" role="tab" aria-selected={view === 'knowledge'} aria-controls="settings-dialog-content" type="button" onClick={() => setView('knowledge')}>{t('知识库管理', 'Knowledge Bases')}</button>
        </div>
        <div id="settings-dialog-content" className="settings-dialog-content" role="tabpanel" aria-labelledby={view === 'models' ? 'settings-tab-models' : 'settings-tab-knowledge'}>
          {props.error ? <div className="settings-message settings-error" role="alert">{props.error}</div> : null}
          {view === 'models' ? <ModelConnections {...props} /> : <KnowledgeManagement {...props} />}
        </div>
        <footer className="settings-dialog-footer"><span role="status">{busy ? t('正在保存配置…', 'Saving settings…') : ''}</span><button type="button" className="settings-secondary" disabled={busy} onClick={() => void props.onRefresh()}>{t('刷新状态', 'Refresh status')}</button></footer>
      </section>
    </div>, document.body) : null}</>
}

function ModelConnections(props: SettingsPanelProps): ReactElement {
  const { t } = useLanguage()
  const [providerId, setProviderId] = useState(() => props.model.connections.find((connection) => connection.apiKeySupported)?.providerId ?? '')
  const [apiKey, setApiKey] = useState('')
  const [subscriptionAnswer, setSubscriptionAnswer] = useState('')
  const [endpoint, setEndpoint] = useState<CompatibleEndpointInput>({ name: '', providerId: '', modelId: '', protocol: 'openai', baseUrl: '', contextWindow: 128000, maxOutputTokens: 8192, apiKey: '' })
  useEffect(() => {
    if (!providerId) {
      const firstApiKeyProvider = props.model.connections.find((connection) => connection.apiKeySupported)?.providerId
      if (firstApiKeyProvider) setProviderId(firstApiKeyProvider)
    }
  }, [providerId, props.model.connections])
  const onApiKeySubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => { event.preventDefault(); if (!apiKey.trim() || props.busy) return; try { await props.onSaveApiKey(providerId, apiKey); setApiKey('') } catch { /* Keep the value available for retry; the parent supplies a sanitized error. */ } }
  const onEndpointSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => { event.preventDefault(); if (props.busy) return; try { await props.onSaveCompatibleEndpoint(endpoint); setEndpoint((current) => ({ ...current, apiKey: '' })) } catch { /* Keep the value available for retry; the parent supplies a sanitized error. */ } }
  const login = props.model.subscriptionLogin
  return <div className="settings-section-stack">
    <div className="settings-summary-card"><div><strong>{props.model.selected ? `${props.model.selected.provider} / ${props.model.selected.modelId}` : t('尚未选择全局模型', 'No global model selected')}</strong><span>{t('当前全局模型', 'Current global model')}</span></div><b>{t(`${props.model.availableCount} 个可用模型`, `${props.model.availableCount} available models`)}</b></div>
    {props.model.options?.length ? <section className="settings-section"><div className="settings-section-heading"><div><h3>{t('Pi 模型目录', 'Pi model catalog')}</h3><p>{t('目录状态不代表实调成功。仅在你点击测试时发送外部请求。', 'Catalog status does not prove a live connection. A provider request is sent only when you choose to test.')}</p></div></div>{props.modelTestMessage ? <p className="settings-test-result" role="status">{props.modelTestMessage}</p> : null}<div className="settings-model-list">{props.model.options.map((option) => <article className="settings-model-row" key={`${option.provider}/${option.modelId}`}><div><strong>{option.name}</strong><span>{option.provider} · {option.modelId}</span>{!option.available && option.unavailableReason ? <small>{option.unavailableReason}</small> : null}</div><div className="settings-row-actions"><span className={`settings-status settings-status-${option.available ? 'connected' : 'needs_api_key'}`}>{option.available ? t('可用', 'Available') : t('不可用', 'Unavailable')}</span><button type="button" className="settings-secondary" disabled={Boolean(props.busy) || !option.available} onClick={() => void props.onTestConnection(option.provider, option.modelId)}>{t('测试连接', 'Test connection')}</button></div></article>)}</div></section> : null}
    <section className="settings-section"><div className="settings-section-heading"><div><h3>{t('订阅登录', 'Subscription sign-in')}</h3><p>{t('通过 Pi 支持的 OAuth 登录连接 OpenAI。', 'Connect OpenAI through Pi’s supported OAuth sign-in.')}</p></div><button type="button" className="settings-primary" disabled={Boolean(props.busy) || login?.status === 'pending'} onClick={() => void props.onBeginSubscriptionLogin()}>{login?.status === 'pending' ? t('正在连接…', 'Connecting…') : t('连接 OpenAI', 'Connect OpenAI')}</button></div>
      {login?.status === 'awaiting_user' ? <div className="settings-login-prompt"><p>{login.prompt ?? login.message ?? t('请在浏览器中完成授权。', 'Complete authorization in your browser.')}</p>{login.verificationUri ? <a href={login.verificationUri} target="_blank" rel="noreferrer">{login.verificationUri}</a> : null}{login.userCode ? <strong>{t('设备码', 'Device code')}: {login.userCode}</strong> : null}<button type="button" className="settings-secondary" disabled={Boolean(props.busy)} onClick={() => void props.onCancelSubscriptionLogin()}>{t('取消登录', 'Cancel sign-in')}</button></div> : null}
      {login?.status === 'awaiting_user' ? <form className="settings-oauth-answer" onSubmit={(event) => { event.preventDefault(); if (subscriptionAnswer.trim() && !props.busy) { void Promise.resolve(props.onSubmitSubscriptionAnswer(subscriptionAnswer.trim())).then(() => setSubscriptionAnswer('')).catch(() => undefined) } }}><label>{t('授权码或登录答复', 'Authorization code or sign-in answer')}<input value={subscriptionAnswer} onChange={(event) => setSubscriptionAnswer(event.target.value)} autoComplete="off" /></label><button type="submit" className="settings-primary" disabled={Boolean(props.busy) || !subscriptionAnswer.trim()}>{t('提交授权答复', 'Submit sign-in answer')}</button></form> : null}
      {login?.status === 'failed' ? <p className="settings-inline-error" role="status">{login.message ?? t('登录未完成', 'Sign-in did not complete')}</p> : null}
      <div className="settings-provider-grid">{props.model.connections.map((connection) => <article className="settings-provider-card" key={connection.providerId}><div className="settings-provider-heading"><strong>{connection.name}</strong><span className={`settings-status settings-status-${connection.status}`}>{connection.status === 'connected' ? t('已连接', 'Connected') : connection.status === 'needs_api_key' ? t('需要 API Key', 'API key needed') : connection.status === 'needs_auth' ? t('需要登录', 'Sign-in required') : t('不支持', 'Unsupported')}</span></div><p>{connection.detail ?? (connection.status === 'unsupported' ? t('不能作为全局模型使用。', 'Cannot be used as a global model.') : t('管理此提供商的凭据。', 'Manage credentials for this provider.'))}</p>{connection.status === 'connected' ? <button type="button" className="settings-text-action" disabled={Boolean(props.busy)} onClick={() => void props.onRemoveCredentials(connection.providerId)}>{t('移除凭据', 'Remove credentials')}</button> : null}</article>)}</div>
    </section>
    <section className="settings-section"><div className="settings-section-heading"><div><h3>{t('提供商 API Key', 'Provider API key')}</h3><p>{t('密钥只会提交给本地服务端，并由 Pi 凭据存储管理。', 'The key is sent to the local server and stored by Pi credential storage.')}</p></div></div>
      <form className="settings-inline-form" onSubmit={onApiKeySubmit}><label>{t('提供商', 'Provider')}<select value={providerId} onChange={(event) => setProviderId(event.target.value)}>{props.model.connections.filter((connection) => connection.apiKeySupported).map((connection) => <option key={connection.providerId} value={connection.providerId}>{connection.name}</option>)}</select></label><label>{t('API Key', 'API key')}<input type="password" autoComplete="new-password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={t('粘贴 API Key', 'Paste API key')} /></label><button type="submit" className="settings-primary" disabled={Boolean(props.busy) || !apiKey.trim() || !providerId}>{t('保存 Key', 'Save key')}</button></form>
      <p className="settings-footnote">{t('保存后不会回显密钥。仅显式测试连接时才会发起可能计费的外部请求。', 'Saved keys are never shown again. External requests that may incur charges happen only when you explicitly test a connection.')}</p>
    </section>
    <CompatibleEndpointForm endpoint={endpoint} setEndpoint={setEndpoint} onSubmit={onEndpointSubmit} disabled={Boolean(props.busy)} />
    <section className="settings-section settings-provider-notes"><h3>{t('其他服务', 'Other services')}</h3><p><strong>Claude Code</strong> — {t('登录状态不会用于 ResearchHub；可使用 Claude API Key。', 'Claude Code sign-in is not used by ResearchHub; a Claude API key is supported.')}</p><p><strong>WorkBuddy</strong> — {t('独立智能体服务，不作为全局模型候选。', 'A separate agent service, not a global model candidate.')}</p></section>
  </div>
}

function CompatibleEndpointForm({ endpoint, setEndpoint, onSubmit, disabled }: { readonly endpoint: CompatibleEndpointInput; readonly setEndpoint: (value: (current: CompatibleEndpointInput) => CompatibleEndpointInput) => void; readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void; readonly disabled: boolean }): ReactElement {
  const { t } = useLanguage()
  const patch = <K extends keyof CompatibleEndpointInput>(key: K, value: CompatibleEndpointInput[K]): void => setEndpoint((current) => ({ ...current, [key]: value }))
  return <section className="settings-section"><div className="settings-section-heading"><div><h3>{t('兼容 API 地址', 'Compatible API endpoint')}</h3><p>{t('登记已知协议的端点；仅支持 HTTPS 或本机地址。', 'Register a known protocol endpoint; HTTPS or local loopback only.')}</p></div></div><form className="settings-endpoint-form" onSubmit={onSubmit}>
    <label>{t('名称', 'Name')}<input value={endpoint.name} onChange={(event) => patch('name', event.target.value)} required /></label><label>Provider ID<input value={endpoint.providerId} onChange={(event) => patch('providerId', event.target.value)} required /></label><label>{t('模型 ID', 'Model ID')}<input value={endpoint.modelId} onChange={(event) => patch('modelId', event.target.value)} required /></label><label>{t('协议', 'Protocol')}<select value={endpoint.protocol} onChange={(event) => patch('protocol', event.target.value as CompatibleEndpointInput['protocol'])}><option value="openai">OpenAI compatible</option><option value="anthropic">Anthropic compatible</option></select></label><label className="settings-field-wide">Base URL<input type="url" value={endpoint.baseUrl} onChange={(event) => patch('baseUrl', event.target.value)} placeholder="https://api.example.com/v1" required /></label><label>{t('上下文窗口', 'Context window')}<input type="number" min="1" value={endpoint.contextWindow} onChange={(event) => patch('contextWindow', Number(event.target.value))} required /></label><label>{t('最大输出 Token', 'Max output tokens')}<input type="number" min="1" value={endpoint.maxOutputTokens} onChange={(event) => patch('maxOutputTokens', Number(event.target.value))} required /></label><label className="settings-field-wide">API Key<input type="password" autoComplete="new-password" value={endpoint.apiKey} onChange={(event) => patch('apiKey', event.target.value)} /></label><div className="settings-form-actions"><button type="submit" className="settings-primary" disabled={disabled}>{t('登记端点', 'Register endpoint')}</button><span>{t('保存配置不会自动请求外部服务。', 'Saving configuration does not contact the provider.')}</span></div>
  </form></section>
}

function KnowledgeManagement(props: SettingsPanelProps): ReactElement {
  const { t } = useLanguage()
  const [path, setPath] = useState('')
  const submitPath = (event: FormEvent<HTMLFormElement>): void => { event.preventDefault(); if (!path.trim() || props.busy) return; void props.onVerifyKnowledgeDirectory(path.trim()) }
  return <div className="settings-section-stack">
    <section className="settings-section"><div className="settings-section-heading"><div><h3>{t('当前挂载', 'Current mount')}</h3><p>{t('只显示知识库标识与版本信息。', 'Only the Knowledge Base ID and version metadata are shown.')}</p></div><button type="button" className="settings-secondary" disabled={Boolean(props.busy) || !props.knowledge.mounted} onClick={() => void props.onUnmountKnowledgeBase()}>{t('取消挂载', 'Unmount')}</button></div>
      {props.knowledge.mounted ? <div className="settings-mounted-card"><strong>{props.knowledge.mounted.id}</strong><span>Schema {props.knowledge.mounted.schemaVersion} · r{props.knowledge.mounted.revision}</span></div> : <p className="settings-empty-state">{t('当前没有已挂载的知识库。', 'No Knowledge Base is mounted.')}</p>}
    </section>
    <section className="settings-section"><div className="settings-section-heading"><div><h3>{t('可用知识库', 'Available Knowledge Bases')}</h3><p>{props.knowledge.discoverySummary ?? t('刷新以发现已登记及默认目录中的知识库。', 'Refresh to discover Knowledge Bases in registered and default directories.')}</p></div><button type="button" className="settings-secondary" disabled={Boolean(props.busy)} onClick={() => void props.onRefreshKnowledgeBases()}>{t('刷新列表', 'Refresh list')}</button></div>
      <div className="settings-kb-list">{props.knowledge.candidates.length ? props.knowledge.candidates.map((item) => <article className="settings-kb-row" key={item.id}><div><strong>{item.id}</strong><span>Schema {item.schemaVersion} · r{item.revision}</span>{item.available === false ? <small className="settings-inline-error">{t('目录当前不可用', 'Directory is currently unavailable')}</small> : null}</div><div className="settings-row-actions">{item.mounted ? <span className="settings-status settings-status-connected">{t('已挂载', 'Mounted')}</span> : item.available === false ? <span className="settings-status settings-status-unsupported">{t('不可用', 'Unavailable')}</span> : <button type="button" className="settings-secondary" disabled={Boolean(props.busy)} onClick={() => void props.onMountKnowledgeBase(item.id)}>{t('挂载', 'Mount')}</button>}{item.registered && !item.mounted ? <button type="button" className="settings-text-action" disabled={Boolean(props.busy)} onClick={() => void props.onRemoveKnowledgeBase(item.id)}>{t('移除登记', 'Remove registration')}</button> : null}</div></article>) : <p className="settings-empty-state">{t('没有发现可用知识库。', 'No Knowledge Bases found.')}</p>}</div>
    </section>
    <section className="settings-section"><h3>{t('登记已有目录', 'Register an existing directory')}</h3><p>{t('输入本机绝对路径。浏览器无法安全选择本机文件夹；登记不会复制、移动或删除目录中的文件。', 'Enter an absolute local path. Browsers cannot safely select local folders; registration never copies, moves, or deletes files.')}</p>
      <form className="settings-directory-form" onSubmit={submitPath}><label>{t('知识库目录绝对路径', 'Absolute Knowledge Base directory path')}<input value={path} onChange={(event) => setPath(event.target.value)} placeholder={t('例如：C:\\ResearchHubData\\knowledge-bases\\my-kb', 'Example: C:\\ResearchHubData\\knowledge-bases\\my-kb')} /></label><div className="settings-form-actions"><button type="submit" className="settings-secondary" disabled={Boolean(props.busy) || !path.trim()}>{t('验证目录', 'Validate directory')}</button><button type="button" className="settings-primary" disabled={Boolean(props.busy) || !path.trim() || props.knowledge.verification?.valid !== true} onClick={() => void props.onRegisterKnowledgeDirectory(path.trim())}>{t('登记目录', 'Register directory')}</button></div></form>
      {props.knowledge.verification ? <p className={props.knowledge.verification.valid ? 'settings-inline-success' : 'settings-inline-error'} role="status">{props.knowledge.verification.message}</p> : null}
    </section>
  </div>
}
