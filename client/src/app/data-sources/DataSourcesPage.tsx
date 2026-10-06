import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import type { DataSourceCatalogResponse, DataSourceIntegrationView, DataSourceOnboardingDraft, DataSourceOnboardingDraftInput, DataSourceTestSummary, RuntimeClient } from '../../api/runtime-client'
import { useLanguage } from '../../i18n'
import './data-sources-page.css'

type Tab = 'policies' | 'integrations' | 'onboarding'
const safeFailure: Readonly<Record<string, string>> = { missing_configuration: '缺少配置', authentication_failed: '认证失败', timeout: '请求超时', rate_limited: '触发限流', access_denied: '访问被拒绝', no_data: '没有可用数据', contract_mismatch: '返回数据不符合要求', provider_failed: '数据源服务失败' }
const emptyDraft: DataSourceOnboardingDraftInput = { integrationId: '', displayName: '', documentationUrl: '', accessMode: 'api', publisher: '', proposedAuthority: 'unknown', capabilityIds: [], metricIds: [], authenticationMode: 'none', rightsNotes: '', rateLimitNotes: '', timeBoundaryNotes: '', providerTermsReviewed: false }

interface Props { readonly client: RuntimeClient }

export function DataSourcesPage({ client }: Props): ReactElement {
  const { t } = useLanguage()
  const [catalog, setCatalog] = useState<DataSourceCatalogResponse>()
  const [integrations, setIntegrations] = useState<readonly DataSourceIntegrationView[]>([])
  const [drafts, setDrafts] = useState<readonly DataSourceOnboardingDraft[]>([])
  const [tab, setTab] = useState<Tab>('policies')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [credentialTarget, setCredentialTarget] = useState<DataSourceIntegrationView>()
  const [credentialValues, setCredentialValues] = useState<Record<string, string>>({})
  const [credentialMessage, setCredentialMessage] = useState('')
  const [busyCredential, setBusyCredential] = useState(false)
  const [runningTest, setRunningTest] = useState<string>()
  const [runningTestLabel, setRunningTestLabel] = useState('')
  const [testMessage, setTestMessage] = useState<Record<string, string>>({})
  const [draftInput, setDraftInput] = useState<DataSourceOnboardingDraftInput>(emptyDraft)
  const [editingRequestId, setEditingRequestId] = useState<string>()
  const [draftMessage, setDraftMessage] = useState('')
  const activeTestController = useRef<AbortController | undefined>(undefined)

  const refresh = async (): Promise<void> => {
    setLoading(true); setError('')
    try {
      const [policyResult, integrationResult, draftResult] = await Promise.all([client.getDataSourceCatalog(), client.listDataSourceIntegrations(), client.listDataSourceOnboardingDrafts()])
      setCatalog(policyResult); setIntegrations(integrationResult); setDrafts(draftResult)
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('读取数据源配置失败。', 'Could not load data source configuration.')) }
    finally { setLoading(false) }
  }

  useEffect(() => { let active = true; void Promise.all([client.getDataSourceCatalog(), client.listDataSourceIntegrations(), client.listDataSourceOnboardingDrafts()]).then(([policyResult, integrationResult, draftResult]) => { if (active) { setCatalog(policyResult); setIntegrations(integrationResult); setDrafts(draftResult) } }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : t('读取数据源配置失败。', 'Could not load data source configuration.')) }).finally(() => { if (active) setLoading(false) }); return () => { active = false } }, [client, t])

  const displaySource = (source: string | null): string => source?.trim() || t('待接入', 'Not connected')
  const rows = catalog ? [...catalog.rows].sort((a, b) => a.metricId.localeCompare(b.metricId) || a.workflowId.localeCompare(b.workflowId)) : []
  const runTest = async (view: DataSourceIntegrationView, kind: 'connection' | 'capability_sample', capabilityId?: string): Promise<void> => {
    if (activeTestController.current) return
    const key = `${view.integration.integrationId}:${kind}:${capabilityId ?? ''}`
    const controller = new AbortController(); activeTestController.current = controller; setRunningTest(key); setRunningTestLabel(`${view.integration.displayName} · ${kind === 'connection' ? t('连接测试', 'connection test') : t('能力抽样', 'capability sample')}`); setTestMessage((current) => ({ ...current, [key]: '' }))
    try {
      const summary = await client.testDataSourceIntegration(view.integration.integrationId, { kind, ...(capabilityId ? { capabilityId } : {}) }, controller.signal)
      setTestMessage((current) => ({ ...current, [key]: testSummaryText(summary, t) }))
      await refresh()
    } catch (cause) { if (controller.signal.aborted || (cause instanceof DOMException && cause.name === 'AbortError')) setTestMessage((current) => ({ ...current, [key]: t('测试已取消', 'Test cancelled') })); else setTestMessage((current) => ({ ...current, [key]: t('测试失败，未显示原始错误信息', 'Test failed; raw provider details are hidden') })) }
    finally { if (activeTestController.current === controller) activeTestController.current = undefined; setRunningTest((current) => current === key ? undefined : current); setRunningTestLabel('') }
  }
  const cancelTest = (): void => { activeTestController.current?.abort() }

  const submitCredentials = async (event: FormEvent): Promise<void> => {
    event.preventDefault(); if (!credentialTarget) return
    setBusyCredential(true); setCredentialMessage('')
    const submitted = { ...credentialValues }
    try { await client.saveDataSourceCredentials(credentialTarget.integration.integrationId, submitted); setCredentialValues({}); setCredentialMessage(t('凭据已保存到系统凭据库。', 'Credentials were saved to the system vault.')); await refresh() }
    catch { setCredentialValues({}); setCredentialMessage(t('保存失败。凭据输入已清空。', 'Save failed. Credential inputs were cleared.')) }
    finally { setBusyCredential(false) }
  }
  const removeCredentials = async (): Promise<void> => { if (!credentialTarget) return; setBusyCredential(true); try { await client.removeDataSourceCredentials(credentialTarget.integration.integrationId); setCredentialValues({}); setCredentialMessage(t('凭据已移除。', 'Credentials removed.')); await refresh() } catch { setCredentialMessage(t('移除凭据失败。', 'Could not remove credentials.')) } finally { setBusyCredential(false) } }
  const setDraftField = <K extends keyof DataSourceOnboardingDraftInput>(key: K, value: DataSourceOnboardingDraftInput[K]): void => setDraftInput((current) => ({ ...current, [key]: value }))
  const submitDraft = async (event: FormEvent): Promise<void> => {
    event.preventDefault(); setDraftMessage('')
    const { termsUrl, ...draftWithoutTermsUrl } = draftInput
    const input: DataSourceOnboardingDraftInput = { ...draftWithoutTermsUrl, ...(termsUrl?.trim() ? { termsUrl: termsUrl.trim() } : {}), capabilityIds: splitList(draftInput.capabilityIds), metricIds: splitList(draftInput.metricIds) }
    try { const saved = editingRequestId ? await client.updateDataSourceOnboardingDraft(editingRequestId, input) : await client.createDataSourceOnboardingDraft(input); setDrafts((current) => [saved, ...current.filter((draft) => draft.requestId !== saved.requestId)]); setDraftInput(saved.input); setEditingRequestId(saved.requestId); setDraftMessage(t('草稿已保存在本地 runtime-data。', 'Draft saved locally under runtime-data.')) }
    catch { setDraftMessage(t('草稿未保存，请检查必填字段和安全限制。', 'Draft was not saved. Check required fields and safety limits.')) }
  }
  const markReady = async (requestId: string): Promise<void> => { try { const saved = await client.markDataSourceOnboardingDraftReady(requestId); setDrafts((current) => current.map((draft) => draft.requestId === requestId ? saved : draft)); setDraftMessage(t('已标记为待后端适配。', 'Marked ready for backend adapter work.')) } catch { setDraftMessage(t('状态更新失败。', 'Could not update draft status.')) } }
  const editDraft = (draft: DataSourceOnboardingDraft): void => { setDraftInput(draft.input); setEditingRequestId(draft.requestId); setDraftMessage('') }

  return <main className="page-frame data-sources-page" aria-labelledby="data-sources-title">
    <div className="page-heading"><div><span className="eyebrow">{t('数据治理', 'DATA GOVERNANCE')}</span><h1 id="data-sources-title">{t('数据源', 'Data Sources')}</h1></div><button className="data-sources-refresh" onClick={() => void refresh()}>{t('刷新', 'Refresh')}</button></div>
    <p>{t('查看指标来源策略、已配置的数据源连接，并提交新来源适配申请。', 'Review source policies and configured integrations, or submit an adapter request for a new source.')}</p>
    <div role="tablist" aria-label={t('数据源管理', 'Data source management')} className="data-sources-tabs">
      <button role="tab" aria-selected={tab === 'policies'} onClick={() => setTab('policies')}>{t('来源策略', 'Source policies')}</button>
      <button role="tab" aria-selected={tab === 'integrations'} onClick={() => setTab('integrations')}>{t('已配置集成', 'Configured integrations')}</button>
      <button role="tab" aria-selected={tab === 'onboarding'} onClick={() => setTab('onboarding')}>{t('接入新数据源', 'Add a data source')}</button>
    </div>
    {runningTest ? <div className="data-source-active-test" role="status"><span>{t('正在测试', 'Testing')} {runningTestLabel}</span><button onClick={cancelTest}>{t('取消测试', 'Cancel test')}</button></div> : null}
    {error ? <div className="notice" role="alert"><strong>{t('数据源配置不可用', 'Data source configuration unavailable')}</strong><p>{error}</p></div> : null}
    {loading ? <p className="muted" role="status">{t('正在加载数据源配置…', 'Loading data source configuration…')}</p> : null}
    {!loading && tab === 'policies' && catalog ? <section role="tabpanel" aria-label={t('来源策略', 'Source policies')}>
      {!catalog.coverageComplete ? <div className="notice data-sources-coverage" role="status"><strong>{t('来源覆盖尚未完整', 'Source coverage is incomplete')}</strong><p>{t('标为“待接入”的来源尚未配置可执行适配器。', 'Sources marked “Not connected” do not yet have an executable adapter configured.')}</p></div> : null}
      <div className="data-sources-table-wrap"><table className="data-sources-table"><caption>{t('通用指标及其来源顺序', 'Generic metrics and their source order')}</caption><thead><tr><th scope="col">metricId</th><th scope="col">{t('中文含义', 'Chinese meaning')}</th><th scope="col">capability</th><th scope="col">{t('默认源', 'Default source')}</th><th scope="col">{t('一级备用源', 'Fallback 1')}</th><th scope="col">{t('二级备用源', 'Fallback 2')}</th><th scope="col">{t('兜底备用源', 'Final fallback')}</th></tr></thead><tbody>
        {rows.map((row) => <tr key={`${row.workflowId}:${row.capability}:${row.metricId}`}><th scope="row">{row.metricId}</th><td>{row.chineseMeaning || t('待补充', 'Pending')}</td><td>{row.capability}</td><td>{displaySource(row.defaultSource)}</td><td>{displaySource(row.fallback1)}</td><td>{displaySource(row.fallback2)}</td><td>{displaySource(row.finalFallback)}</td></tr>)}
        {rows.length === 0 ? <tr><td colSpan={7} className="data-sources-empty">{t('当前没有可展示的通用指标来源策略。', 'No generic metric source policies are available.')}</td></tr> : null}
      </tbody></table></div>{rows.length > 0 && !catalog.coverageComplete ? <p className="data-sources-coverage-count">{t('不完整覆盖的指标：', 'Metrics with incomplete coverage: ')}{rows.filter((row) => !row.coverageComplete).length}</p> : null}
    </section> : null}
    {!loading && tab === 'integrations' ? <section role="tabpanel" aria-label={t('已配置集成', 'Configured integrations')} className="data-source-integrations">
      {integrations.length === 0 ? <p className="muted">{t('当前没有已配置的数据源集成。', 'No configured data source integrations are available.')}</p> : integrations.map((view) => <IntegrationCard key={view.integration.integrationId} view={view} runningTest={runningTest} testMessage={testMessage} onTest={runTest} onCredentials={() => { setCredentialTarget(view); setCredentialValues({}); setCredentialMessage('') }} t={t} />)}
    </section> : null}
    {!loading && tab === 'onboarding' ? <section role="tabpanel" aria-label={t('接入新数据源', 'Add a data source')} className="data-source-onboarding">
      <h2>{t('新增数据源', 'Add a data source')}</h2><p>{t('受支持的适配器可配置凭据；尚未支持的来源会保存为本地草稿，完成后端适配和验收后才能进入集成目录。', 'Configure a supported adapter, or save a local draft for a source that needs backend implementation and acceptance.')}</p>
      {drafts.map((draft) => <article className="data-source-draft-card" key={draft.requestId}><div><strong>{draft.input.displayName || draft.input.integrationId}</strong><span>{draft.status}</span></div><p>{draft.input.publisher} · {draft.input.accessMode} · {draft.input.proposedAuthority}</p><button onClick={() => editDraft(draft)}>{t('编辑草稿', 'Edit draft')}</button>{draft.status === 'draft' ? <button onClick={() => void markReady(draft.requestId)}>{t('标记为待适配', 'Mark ready for adapter')}</button> : null}</article>)}
      <form className="data-source-draft-form" onSubmit={(event) => void submitDraft(event)}>
        <label>{t('集成 ID', 'Integration ID')}<input required maxLength={64} value={draftInput.integrationId} disabled={Boolean(editingRequestId)} onChange={(event) => setDraftField('integrationId', event.target.value)} /></label>
        <label>{t('显示名称', 'Display name')}<input required maxLength={120} value={draftInput.displayName} onChange={(event) => setDraftField('displayName', event.target.value)} /></label>
        <label>{t('文档地址', 'Documentation URL')}<input required type="url" value={draftInput.documentationUrl} onChange={(event) => setDraftField('documentationUrl', event.target.value)} /></label>
        <label>{t('接入方式', 'Access mode')}<select value={draftInput.accessMode} onChange={(event) => setDraftField('accessMode', event.target.value as DataSourceOnboardingDraftInput['accessMode'])}><option value="api">API</option><option value="rss">RSS</option><option value="web">Web</option><option value="python_bridge">Python bridge</option><option value="other">{t('其他', 'Other')}</option></select></label>
        <label>{t('发布方', 'Publisher')}<input required maxLength={120} value={draftInput.publisher} onChange={(event) => setDraftField('publisher', event.target.value)} /></label>
        <label>{t('建议权威等级', 'Proposed authority')}<select value={draftInput.proposedAuthority} onChange={(event) => setDraftField('proposedAuthority', event.target.value as DataSourceOnboardingDraftInput['proposedAuthority'])}>{['S0_STATUTORY', 'S1_OFFICIAL', 'S2_PROFESSIONAL', 'S3_AGGREGATOR', 'S4_COMMUNITY', 'unknown'].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>{t('能力 ID（逗号分隔）', 'Capability IDs (comma separated)')}<input value={draftInput.capabilityIds.join(', ')} onChange={(event) => setDraftField('capabilityIds', event.target.value.split(','))} /></label>
        <label>{t('metricId（逗号分隔）', 'metricIds (comma separated)')}<input value={draftInput.metricIds.join(', ')} onChange={(event) => setDraftField('metricIds', event.target.value.split(','))} /></label>
        <label>{t('认证方式', 'Authentication mode')}<select value={draftInput.authenticationMode} onChange={(event) => setDraftField('authenticationMode', event.target.value as DataSourceOnboardingDraftInput['authenticationMode'])}><option value="none">{t('无需认证', 'None')}</option><option value="api_key">API Key</option><option value="oauth">OAuth</option><option value="other">{t('其他', 'Other')}</option></select></label>
        <label>{t('服务条款地址（可选）', 'Terms URL (optional)')}<input type="url" value={draftInput.termsUrl ?? ''} onChange={(event) => setDraftField('termsUrl', event.target.value)} /></label>
        <label>{t('权利说明', 'Rights notes')}<textarea required value={draftInput.rightsNotes} onChange={(event) => setDraftField('rightsNotes', event.target.value)} /></label>
        <label>{t('限流说明', 'Rate limit notes')}<textarea required value={draftInput.rateLimitNotes} onChange={(event) => setDraftField('rateLimitNotes', event.target.value)} /></label>
        <label>{t('时间边界说明', 'Time boundary notes')}<textarea required value={draftInput.timeBoundaryNotes} onChange={(event) => setDraftField('timeBoundaryNotes', event.target.value)} /></label>
        <label className="data-source-checkbox"><input type="checkbox" checked={draftInput.providerTermsReviewed} onChange={(event) => setDraftField('providerTermsReviewed', event.target.checked)} />{t('已审阅服务条款', 'Provider terms reviewed')}</label>
        <div className="data-source-form-actions"><button type="submit">{editingRequestId ? t('更新草稿', 'Update draft') : t('保存草稿', 'Save draft')}</button><button type="button" onClick={() => { setDraftInput(emptyDraft); setEditingRequestId(undefined); setDraftMessage('') }}>{t('新建草稿', 'New draft')}</button></div>
      </form>{draftMessage ? <p role="status">{draftMessage}</p> : null}<p className="muted">{t('此表单只保存适配需求元数据，不会调用网络、执行代码或修改来源策略。', 'This form stores adapter request metadata only. It does not access the network, execute code, or change source policies.')}</p>
    </section> : null}
    {credentialTarget ? <div className="data-source-dialog-backdrop" role="presentation"><section className="data-source-dialog" role="dialog" aria-modal="true" aria-labelledby="credential-dialog-title"><h2 id="credential-dialog-title">{t('管理凭据', 'Manage credentials')} · {credentialTarget.integration.displayName}</h2><form onSubmit={(event) => void submitCredentials(event)}>{credentialTarget.integration.credentialFields.map((field) => <label key={field.id}>{field.label}{field.required ? ' *' : ''}<input type="password" autoComplete="new-password" required={field.required} value={credentialValues[field.id] ?? ''} onChange={(event) => setCredentialValues((current) => ({ ...current, [field.id]: event.target.value }))} /></label>)}<button disabled={busyCredential || Object.values(credentialValues).every((value) => !value.trim())}>{t('保存凭据', 'Save credentials')}</button><button type="button" disabled={busyCredential || credentialTarget.credentialState !== 'configured'} onClick={() => void removeCredentials()}>{t('移除凭据', 'Remove credentials')}</button><button type="button" onClick={() => { setCredentialTarget(undefined); setCredentialValues({}); setCredentialMessage('') }}>{t('关闭', 'Close')}</button></form>{credentialMessage ? <p role="status">{credentialMessage}</p> : null}</section></div> : null}
  </main>
}

function splitList(values: readonly string[]): string[] { return values.flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean) }
function testSummaryText(summary: DataSourceTestSummary, t: (zh: string, en: string) => string): string { if (summary.status === 'passed') return t('测试通过', 'Test passed'); if (summary.status === 'cancelled') return t('测试已取消', 'Test cancelled'); if (summary.status === 'unsupported') return t('此测试不受支持', 'This test is unsupported'); return safeFailure[summary.errorCode ?? ''] ? `${t('测试失败', 'Test failed')}：${t(safeFailure[summary.errorCode ?? '']!, safeFailure[summary.errorCode ?? '']!)}` : t('测试失败', 'Test failed') }

function IntegrationCard({ view, runningTest, testMessage, onTest, onCredentials, t }: { readonly view: DataSourceIntegrationView; readonly runningTest?: string; readonly testMessage: Readonly<Record<string, string>>; readonly onTest: (view: DataSourceIntegrationView, kind: 'connection' | 'capability_sample', capabilityId?: string) => Promise<void>; readonly onCredentials: () => void; readonly t: (zh: string, en: string) => string }): ReactElement {
  const id = view.integration.integrationId
  const tests = view.latestTests.map((summary) => ({ summary, key: `${id}:${summary.kind}:${summary.capabilityId ?? ''}` }))
  const active = Boolean(runningTest)
  const requiredSlots = [...(view.integration.supportedTests.connection ? ['connection'] : []), ...view.integration.supportedTests.capabilitySamples.map((capabilityId) => `capability_sample:${capabilityId}`)]
  const verified = requiredSlots.length > 0 && requiredSlots.every((slot) => view.latestTests.some((summary) => `${summary.kind}${summary.capabilityId ? `:${summary.capabilityId}` : ''}` === slot && summary.status === 'passed'))
  return <article className="data-source-integration-card"><header><div><h2>{view.integration.displayName}</h2><code>{id}</code></div><span className="data-source-state">{t('适配器已配置', 'Adapter configured')}</span></header>
    <p>{verified ? <><strong>{t('已验证', 'Verified')}</strong> / {view.policyLinked ? t('SourcePolicy 已接入', 'SourcePolicy linked') : t('待 SourcePolicy 接入', 'Pending SourcePolicy linkage')}</> : <>{t('适配器已配置', 'Adapter configured')} / {t('待验证', 'Pending verification')}</>}</p>
    <p>{view.credentialState === 'configured' ? t('连接凭据已配置', 'Connection credentials configured') : view.credentialState === 'missing' ? t('缺少连接凭据', 'Connection credentials missing') : view.credentialState === 'vault_unavailable' ? t('系统凭据库不可用', 'System credential vault unavailable') : t('无需凭据', 'Credentials not required')}</p>
    <div><h3>{t('能力', 'Capabilities')}</h3>{view.integration.capabilities.map((capability) => <p key={capability.id}>{capability.label} <code>{capability.id}</code> · {capability.metricIds.join(', ')}</p>)}</div>
    <div className="data-source-test-actions">{view.integration.supportedTests.connection ? <button disabled={active} onClick={() => void onTest(view, 'connection')}>{t('测试连接', 'Test connection')}</button> : null}{view.integration.capabilities.filter((capability) => view.integration.supportedTests.capabilitySamples.includes(capability.id)).map((capability) => <button key={capability.id} disabled={active} onClick={() => void onTest(view, 'capability_sample', capability.id)}>{t('抽样测试', 'Sample test')} · {capability.label}</button>)}<button onClick={onCredentials}>{t('管理凭据', 'Manage credentials')}</button></div>
    {tests.map(({ summary, key }) => <p key={key} className="data-source-test-result">{summary.kind === 'connection' ? t('连接测试', 'Connection test') : t('能力抽样', 'Capability sample')}{summary.capabilityId ? ` · ${summary.capabilityId}` : ''}：{testSummaryText(summary, t)}</p>)}
    {Object.entries(testMessage).filter(([key]) => key.startsWith(`${id}:`)).map(([key, message]) => message ? <p role="status" key={key} className="data-source-test-result">{message}</p> : null)}
  </article>
}
