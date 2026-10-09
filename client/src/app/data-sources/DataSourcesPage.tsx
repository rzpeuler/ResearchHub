import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import type { CommonDataCatalogProjection, DataSourceIntegrationView, DataSourceOnboardingDraft, DataSourceOnboardingDraftInput, DataSourceTestSummary, IndustryDataCatalogProjection, RuntimeClient } from '../../api/runtime-client'
import { commonCatalogTableRows, industryCatalogTableRows } from './catalog-table-model'
import { useLanguage } from '../../i18n'
import './data-sources-page.css'

type Tab = 'policies' | 'integrations' | 'onboarding'
type CatalogKind = 'common' | 'industry'
const safeFailure: Readonly<Record<string, string>> = { missing_configuration: '缺少配置', authentication_failed: '认证失败', timeout: '请求超时', rate_limited: '触发限流', access_denied: '访问被拒绝', no_data: '没有可用数据', contract_mismatch: '返回数据不符合要求', provider_failed: '数据源服务失败' }
const emptyDraft: DataSourceOnboardingDraftInput = { integrationId: '', displayName: '', documentationUrl: '', accessMode: 'api', publisher: '', proposedAuthority: 'unknown', capabilityIds: [], metricIds: [], authenticationMode: 'none', rightsNotes: '', rateLimitNotes: '', timeBoundaryNotes: '', providerTermsReviewed: false }

interface Props { readonly client: RuntimeClient }

export function DataSourcesPage({ client }: Props): ReactElement {
  const { t } = useLanguage()
  const [commonCatalog, setCommonCatalog] = useState<CommonDataCatalogProjection>()
  const [industryCatalog, setIndustryCatalog] = useState<IndustryDataCatalogProjection>()
  const [integrations, setIntegrations] = useState<readonly DataSourceIntegrationView[]>([])
  const [drafts, setDrafts] = useState<readonly DataSourceOnboardingDraft[]>([])
  const [tab, setTab] = useState<Tab>('policies')
  const [catalogKind, setCatalogKind] = useState<CatalogKind>('industry')
  const [catalogQuery, setCatalogQuery] = useState('')
  const [commonKindFilter, setCommonKindFilter] = useState('')
  const [commonConsumerFilter, setCommonConsumerFilter] = useState('')
  const [industryFilter, setIndustryFilter] = useState('')
  const [familyFilter, setFamilyFilter] = useState('')
  const [lifecycleFilter, setLifecycleFilter] = useState('ALL')
  const [selectedMetricId, setSelectedMetricId] = useState('')
  const [error, setError] = useState('')
  const [catalogError, setCatalogError] = useState('')
  const [loading, setLoading] = useState(true)
  const [catalogLoading, setCatalogLoading] = useState(true)
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

  const load = useCallback(async (isActive: () => boolean = () => true): Promise<void> => {
    setLoading(true); setCatalogLoading(true); setError(''); setCatalogError('')
    const configurationLoad = Promise.allSettled([
      client.listDataSourceIntegrations(),
      client.listDataSourceOnboardingDrafts(),
    ]).then(([integrationResult, draftResult]) => {
      if (!isActive()) return
      if (integrationResult.status === 'fulfilled') setIntegrations(integrationResult.value)
      if (draftResult.status === 'fulfilled') setDrafts(draftResult.value)
      if ([integrationResult, draftResult].some((result) => result.status === 'rejected')) setError(t('部分数据源配置加载失败。', 'Some data source settings could not be loaded.'))
      setLoading(false)
    })
    const catalogLoad = Promise.allSettled([client.getCommonDataCatalog(), client.getIndustryDataCatalog()]).then(([commonResult, industryResult]) => {
      if (!isActive()) return
      if (commonResult.status === 'fulfilled') setCommonCatalog(commonResult.value)
      if (industryResult.status === 'fulfilled') setIndustryCatalog(industryResult.value)
      if (commonResult.status === 'rejected' || industryResult.status === 'rejected') setCatalogError(t('数据字段目录暂时无法加载。请刷新重试。', 'The data catalog could not be loaded. Refresh to try again.'))
      setCatalogLoading(false)
    })
    void catalogLoad
    await configurationLoad
  }, [client, t])

  const refresh = (): Promise<void> => load()
  useEffect(() => { let active = true; void load(() => active); return () => { active = false } }, [load])

  const commonDefinitions = commonCatalog?.definitions ?? []
  const industryDefinitions = industryCatalog?.definitions ?? []
  const commonKinds = [...new Set(commonDefinitions.map((definition) => definition.dataKind))].sort()
  const commonConsumers = [...new Set(commonDefinitions.flatMap((definition) => definition.consumers))].sort()
  const industryFamilies = [...new Set(industryDefinitions.map((definition) => definition.metricFamily).filter((value): value is string => Boolean(value)))].sort()
  const filteredCommon = useMemo(() => commonDefinitions.filter((definition) => {
    const query = catalogQuery.trim().toLocaleLowerCase()
    const matchesQuery = !query || [definition.metricId, definition.meaning, ...definition.consumers].some((value) => value.toLocaleLowerCase().includes(query))
    return matchesQuery && (!commonKindFilter || definition.dataKind === commonKindFilter) && (!commonConsumerFilter || definition.consumers.includes(commonConsumerFilter))
  }), [commonDefinitions, catalogQuery, commonKindFilter, commonConsumerFilter])
  const filteredIndustry = useMemo(() => industryDefinitions.filter((definition) => {
    const query = catalogQuery.trim().toLocaleLowerCase()
    const matchesQuery = !query || [definition.industryId, definition.metricId, definition.name, definition.description, definition.metricFamily, definition.semanticRole].filter((value): value is string => typeof value === 'string').some((value) => value.toLocaleLowerCase().includes(query))
    return matchesQuery && (!industryFilter || definition.industryId === industryFilter) && (!familyFilter || definition.metricFamily === familyFilter) && (lifecycleFilter === 'ALL' || definition.lifecycleStatus === lifecycleFilter)
  }), [industryDefinitions, catalogQuery, industryFilter, familyFilter, lifecycleFilter])
  const commonRows = commonCatalogTableRows(filteredCommon)
  const industryRows = industryCatalogTableRows(filteredIndustry)
  const selectedCommon = filteredCommon.find((definition) => definition.metricId === selectedMetricId)
  const selectedIndustry = filteredIndustry.find((definition) => definition.metricId === selectedMetricId)
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
    {!loading && tab === 'policies' ? <section role="tabpanel" aria-label={t('来源策略', 'Source policies')} className="data-catalog-explorer">
      <div role="tablist" aria-label={t('字段目录类型', 'Catalog type')} className="data-catalog-tabs">
        <button role="tab" aria-selected={catalogKind === 'common'} onClick={() => { setCatalogKind('common'); setCatalogQuery(''); setSelectedMetricId('') }}>{t('通用字段', 'Common fields')}</button>
        <button role="tab" aria-selected={catalogKind === 'industry'} onClick={() => { setCatalogKind('industry'); setCatalogQuery(''); setSelectedMetricId('') }}>{t('行业字段', 'Industry fields')}</button>
      </div>
      {catalogError ? <div className="notice" role="alert"><strong>{t('数据字段目录暂不可用', 'Data catalog unavailable')}</strong><p>{catalogError}</p></div> : null}
      {catalogLoading ? <p className="muted" role="status">{t('正在加载字段目录…', 'Loading catalog…')}</p> : null}
      {catalogKind === 'common' && commonCatalog ? <>
        <div className="data-catalog-controls">
          <label>{t('搜索字段', 'Search fields')}<input aria-label={t('搜索字段', 'Search fields')} value={catalogQuery} onChange={(event) => { setCatalogQuery(event.target.value); setSelectedMetricId('') }} /></label>
          <label>{t('数据类型', 'Data kind')}<select aria-label={t('数据类型', 'Data kind')} value={commonKindFilter} onChange={(event) => setCommonKindFilter(event.target.value)}><option value="">{t('全部类型', 'All kinds')}</option>{commonKinds.map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select></label>
          <label>{t('消费者', 'Consumer')}<select aria-label={t('消费者', 'Consumer')} value={commonConsumerFilter} onChange={(event) => setCommonConsumerFilter(event.target.value)}><option value="">{t('全部消费者', 'All consumers')}</option>{commonConsumers.map((consumer) => <option key={consumer} value={consumer}>{consumer}</option>)}</select></label>
          <span className="data-catalog-count">{t('显示', 'Showing')} {filteredCommon.length} / {commonCatalog.definitionCount} {t('项', 'fields')}</span>
        </div>
        {commonCatalog.definitionCount === 0 ? <p className="data-catalog-empty">{t('当前 Common Data Catalog 没有已注册字段。', 'The Common Data Catalog has no registered fields.')}</p> : filteredCommon.length === 0 ? <p className="data-catalog-empty">{t('没有匹配的字段', 'No matching fields')}</p> : <div className="data-catalog-layout">
          <div className="data-catalog-table-wrap"><table className="data-catalog-table data-catalog-policy-table"><caption>{t('通用字段来源策略', 'Common field source policies')}</caption><thead><tr><th>{t('字段标识', 'Field ID')}</th><th>{t('中文含义', 'Meaning')}</th><th>{t('消费者', 'Consumers')}</th><th>{t('默认源', 'Default source')}</th><th>{t('一级备用源', 'Fallback 1')}</th><th>{t('二级备用源', 'Fallback 2')}</th><th>{t('兜底备用源', 'Final fallback')}</th></tr></thead><tbody>
            {commonRows.map((row) => <tr key={row.key} aria-selected={selectedMetricId === row.metricId}><th scope="row"><button className="data-catalog-select" onClick={() => setSelectedMetricId(row.metricId)}>{row.metricId}</button></th><td>{row.meaning}</td><td>{row.consumers}</td><td>{row.defaultSource ?? '—'}</td><td>{row.fallback1 ?? '—'}</td><td>{row.fallback2 ?? '—'}</td><td>{row.finalFallback ?? '—'}</td></tr>)}
          </tbody></table></div>
          {selectedCommon ? <aside className="data-catalog-detail" aria-label={t('字段详情', 'Field details')}><h2>{selectedCommon.metricId}</h2><p>{selectedCommon.meaning}</p>
            <dl><MetadataRow label="metricId" value={selectedCommon.metricId} t={t} /><MetadataRow label={t('数据类型', 'Data kind')} value={selectedCommon.dataKind} t={t} /><MetadataRow label={t('消费者', 'Consumers')} value={selectedCommon.consumers} t={t} />
              <MetadataRow label={t('目录注册', 'Catalog registration')} value={t('已注册', 'Registered')} t={t} /><MetadataRow label="SourcePolicy" value={selectedCommon.sourcePolicyStatus === 'CONFIGURED' ? t('已配置', 'Configured') : t('未配置', 'Not configured')} t={t} /><MetadataRow label={t('策略精确映射', 'Policy mapping')} value={selectedCommon.sourceMappingStatus} t={t} />
            </dl>
            {selectedCommon.sourcePolicies.length === 0 ? <p>{t('没有匹配的 SourcePolicy。', 'No matching SourcePolicy is configured.')}</p> : selectedCommon.sourcePolicies.map((policy) => <article className="data-catalog-policy" key={policy.policyId}><h3>{policy.policyId}</h3><MetadataRow label={t('选择模式', 'Selection mode')} value={policy.selectionMode} t={t} /><MetadataRow label={t('主来源与备用顺序', 'Primary and fallback order')} value={policy.candidates.map((candidate) => `${candidate.fallbackLevel}: ${candidate.sourceId}`).join(' · ')} t={t} />
              {policy.candidates.map((candidate) => <div className="data-catalog-candidate" key={`${policy.policyId}:${candidate.sourceId}`}><strong>{fallbackLevelText(candidate.fallbackLevel, t)} · {candidate.sourceId}</strong><dl><MetadataRow label={t('来源权威', 'Origin authority')} value={candidate.originAuthority} t={t} /><MetadataRow label={t('来源发布方', 'Origin publisher')} value={candidate.originPublisher} t={t} /><MetadataRow label="operationId" value={candidate.operationId} t={t} /><MetadataRow label={t('运行适配器', 'Runtime adapter')} value={candidate.runtimeAdapterStatus === 'BOUND' ? t('已绑定', 'Bound') : candidate.runtimeAdapterStatus === 'UNBOUND' ? t('未绑定', 'Unbound') : t('状态未知', 'Unknown')} t={t} /><MetadataRow label={t('连接测试', 'Connection test')} value={testStatusText(candidate.connectionTestStatus, t)} t={t} /><MetadataRow label={t('能力抽样', 'Capability sample')} value={testStatusText(candidate.capabilitySampleStatus, t)} t={t} /><MetadataRow label={t('历史 PIT', 'Historical PIT')} value={t('未验证', 'Not verified')} t={t} /></dl>{candidate.integrations.length ? <ul className="data-catalog-integration-list">{candidate.integrations.map((integration) => <li key={integration.integrationId}>{integration.displayName} · {t('连接', 'Connection')}: {testStatusText(integration.connectionTestStatus, t)} · {t('能力抽样', 'Capability sample')}: {testStatusText(integration.capabilitySampleStatus, t)}</li>)}</ul> : <p className="muted">{t('没有为此 sourceId 提供集成测试映射。', 'No integration test mapping is available for this sourceId.')}</p>}</div>)}
            </article>)}
            <p className="muted">{t('SourcePolicy 已配置只表示存在策略定义，不代表 Provider 已绑定、测试通过或历史 PIT 安全。', 'A configured SourcePolicy only confirms a policy definition. It does not prove an adapter is bound, tests passed, or historical PIT safety.')}</p>
          </aside> : null}
        </div>}
      </> : null}
      {catalogKind === 'industry' && industryCatalog ? <>
        <div className="data-catalog-controls">
          <label>{t('搜索字段', 'Search fields')}<input aria-label={t('搜索字段', 'Search fields')} value={catalogQuery} onChange={(event) => { setCatalogQuery(event.target.value); setSelectedMetricId('') }} /></label>
          <label>{t('行业', 'Industry')}<select aria-label={t('行业', 'Industry')} value={industryFilter} onChange={(event) => setIndustryFilter(event.target.value)}><option value="">{t('全部行业', 'All industries')}</option>{industryCatalog.identities.map((identity) => <option key={identity.industryId} value={identity.industryId}>{identity.industryId}</option>)}</select></label>
          <label>{t('指标族', 'Metric family')}<select aria-label={t('指标族', 'Metric family')} value={familyFilter} onChange={(event) => setFamilyFilter(event.target.value)}><option value="">{t('全部指标族', 'All families')}</option>{industryFamilies.map((family) => <option key={family} value={family}>{family}</option>)}</select></label>
          <label>{t('生命周期', 'Lifecycle')}<select aria-label={t('生命周期', 'Lifecycle')} value={lifecycleFilter} onChange={(event) => setLifecycleFilter(event.target.value)}>{['ALL', 'DISCOVERED', 'VALIDATED', 'CANONICAL'].map((status) => <option key={status} value={status}>{status === 'ALL' ? t('全部', 'All') : status}</option>)}</select></label>
          <span className="data-catalog-count">{t('显示', 'Showing')} {filteredIndustry.length} / {industryCatalog.definitionCount} {t('项', 'metrics')}</span>
        </div>
        <p className="data-catalog-count-summary">{t('已注册行业身份：', 'Registered industry identities: ')}{industryCatalog.registeredIndustryCount} · {t('正式 Canonical 指标：', 'Canonical metrics: ')}{industryCatalog.canonicalCount}</p>
        {industryCatalog.definitionCount === 0 ? <div className="data-catalog-empty"><strong>{t('当前没有已注册的行业数据字段。', 'There are no registered Industry data fields.')}</strong><p>{t('已注册行业身份：', 'Registered industry identities: ')}{industryCatalog.registeredIndustryCount}</p><p>{t('正式 Canonical 指标：', 'Canonical metrics: ')}{industryCatalog.canonicalCount}</p></div> : filteredIndustry.length === 0 ? <p className="data-catalog-empty">{t('没有匹配的字段', 'No matching fields')}</p> : null}
        <div className="data-catalog-layout">
          <div className="data-catalog-table-wrap"><table className="data-catalog-table data-catalog-policy-table"><caption>{t('行业字段来源策略', 'Industry field source policies')}</caption><thead><tr><th>{t('字段标识', 'Field ID')}</th><th>{t('中文含义', 'Meaning')}</th><th>{t('消费者', 'Consumers')}</th><th>{t('默认源', 'Default source')}</th><th>{t('一级备用源', 'Fallback 1')}</th><th>{t('二级备用源', 'Fallback 2')}</th><th>{t('兜底备用源', 'Final fallback')}</th></tr></thead><tbody>
            {industryRows.map((row) => <tr key={row.key} aria-selected={selectedMetricId === row.metricId}><th scope="row"><button className="data-catalog-select" onClick={() => setSelectedMetricId(row.metricId)}>{row.metricId}</button></th><td>{row.meaning}</td><td>{row.consumers}</td><td>{row.defaultSource ?? '—'}</td><td>{row.fallback1 ?? '—'}</td><td>{row.fallback2 ?? '—'}</td><td>{row.finalFallback ?? '—'}</td></tr>)}
          </tbody></table></div>
          {selectedIndustry ? <aside className="data-catalog-detail" aria-label={t('字段详情', 'Field details')}><h2>{selectedIndustry.name}</h2><p>{selectedIndustry.description}</p><dl>
            <MetadataRow label="industryId" value={selectedIndustry.industryId} t={t} /><MetadataRow label="metricId" value={selectedIndustry.metricId} t={t} /><MetadataRow label={t('消费者', 'Consumers')} value={[...new Set(selectedIndustry.sourcePolicies.map((reference) => reference.policy?.requirementMatch.workflow).filter((workflow): workflow is string => Boolean(workflow)))].join(', ') || t('未明确映射', 'Unmapped')} t={t} /><MetadataRow label="metricFamily" value={selectedIndustry.metricFamily} t={t} /><MetadataRow label="semanticRole" value={selectedIndustry.semanticRole} t={t} /><MetadataRow label="dataKind" value={selectedIndustry.dataKind} t={t} /><MetadataRow label="lifecycleStatus" value={selectedIndustry.lifecycleStatus} t={t} />
            {(['canonicalUnit', 'acceptedSourceUnits', 'frequency', 'periodBasis', 'aggregation', 'geography', 'product', 'segment', 'grade', 'requiredQualifiers'] as const).map((key) => <MetadataRow key={key} label={key} value={selectedIndustry[key]} t={t} />)}
            <MetadataRow label={t('publication PIT', 'Publication PIT')} value={selectedIndustry.pitPolicy?.publicationPit} t={t} /><MetadataRow label={t('value-version PIT', 'Value-version PIT')} value={selectedIndustry.pitPolicy?.valueVersionPit} t={t} /><MetadataRow label={t('验证信息', 'Validation metadata')} value={selectedIndustry.validation ? JSON.stringify(selectedIndustry.validation) : undefined} t={t} /><MetadataRow label={t('发现来源', 'Discovery provenance')} value={selectedIndustry.discoveredFrom} t={t} />
          </dl><h3>SourcePolicy</h3>{selectedIndustry.sourcePolicies.length === 0 ? <p>{t('未定义', 'Undefined')}</p> : selectedIndustry.sourcePolicies.map((reference) => <article className="data-catalog-policy" key={reference.policyId}><h4>{reference.policyId}</h4><MetadataRow label={t('策略映射', 'Policy mapping')} value={reference.mappingStatus} t={t} />{reference.policy ? <><MetadataRow label={t('选择模式', 'Selection mode')} value={reference.policy.selectionMode} t={t} />{reference.policy.candidates.map((candidate) => <div className="data-catalog-candidate" key={candidate.sourceId}><strong>{fallbackLevelText(candidate.fallbackLevel, t)} · {candidate.sourceId}</strong><MetadataRow label={t('来源权威', 'Origin authority')} value={candidate.originAuthority} t={t} /><MetadataRow label={t('来源发布方', 'Origin publisher')} value={candidate.originPublisher} t={t} /><MetadataRow label="operationId" value={candidate.operationId} t={t} /><MetadataRow label={t('运行适配器', 'Runtime adapter')} value={candidate.runtimeAdapterStatus === 'BOUND' ? t('已绑定', 'Bound') : candidate.runtimeAdapterStatus === 'UNBOUND' ? t('未绑定', 'Unbound') : t('状态未知', 'Unknown')} t={t} /><MetadataRow label={t('连接测试', 'Connection test')} value={testStatusText(candidate.connectionTestStatus, t)} t={t} /><MetadataRow label={t('能力抽样', 'Capability sample')} value={testStatusText(candidate.capabilitySampleStatus, t)} t={t} /><MetadataRow label={t('历史 PIT', 'Historical PIT')} value={t('未验证', 'Not verified')} t={t} />{candidate.integrations.length ? <ul className="data-catalog-integration-list">{candidate.integrations.map((integration) => <li key={integration.integrationId}>{integration.displayName} · {t('连接', 'Connection')}: {testStatusText(integration.connectionTestStatus, t)} · {t('能力抽样', 'Capability sample')}: {testStatusText(integration.capabilitySampleStatus, t)}</li>)}</ul> : null}</div>)}</> : null}</article>)}</aside> : null}
        </div>
      </> : null}
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
    {credentialTarget && credentialTarget.integration.credentialFields.length > 0 ? <div className="data-source-dialog-backdrop" role="presentation"><section className="data-source-dialog" role="dialog" aria-modal="true" aria-labelledby="credential-dialog-title"><h2 id="credential-dialog-title">{t('管理凭据', 'Manage credentials')} · {credentialTarget.integration.displayName}</h2><form onSubmit={(event) => void submitCredentials(event)}>{credentialTarget.integration.credentialFields.map((field) => <label key={field.id}>{field.label}{field.required ? ' *' : ''}<input type="password" autoComplete="new-password" required={field.required} value={credentialValues[field.id] ?? ''} onChange={(event) => setCredentialValues((current) => ({ ...current, [field.id]: event.target.value }))} /></label>)}<button disabled={busyCredential || Object.values(credentialValues).every((value) => !value.trim())}>{t('保存凭据', 'Save credentials')}</button><button type="button" disabled={busyCredential || credentialTarget.credentialState !== 'configured'} onClick={() => void removeCredentials()}>{t('移除凭据', 'Remove credentials')}</button><button type="button" onClick={() => { setCredentialTarget(undefined); setCredentialValues({}); setCredentialMessage('') }}>{t('关闭', 'Close')}</button></form>{credentialMessage ? <p role="status">{credentialMessage}</p> : null}</section></div> : null}
  </main>
}

function splitList(values: readonly string[]): string[] { return values.flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean) }
function testSummaryText(summary: DataSourceTestSummary, t: (zh: string, en: string) => string): string { if (summary.status === 'passed') return t('测试通过', 'Test passed'); if (summary.status === 'cancelled') return t('测试已取消', 'Test cancelled'); if (summary.status === 'unsupported') return t('此测试不受支持', 'This test is unsupported'); return safeFailure[summary.errorCode ?? ''] ? `${t('测试失败', 'Test failed')}：${t(safeFailure[summary.errorCode ?? '']!, safeFailure[summary.errorCode ?? '']!)}` : t('测试失败', 'Test failed') }
function metadataText(value: unknown, t: (zh: string, en: string) => string): string {
  if (value === undefined || value === null || value === '') return t('未定义', 'Undefined')
  if (Array.isArray(value)) return value.length ? value.map(String).join(', ') : t('未定义', 'Undefined')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
function MetadataRow({ label, value, t }: { readonly label: string; readonly value: unknown; readonly t: (zh: string, en: string) => string }): ReactElement { return <div><dt>{label}</dt><dd>{metadataText(value, t)}</dd></div> }
function testStatusText(status: string, t: (zh: string, en: string) => string): string {
  if (status === 'PASSED') return t('通过', 'Passed')
  if (status === 'FAILED') return t('失败', 'Failed')
  if (status === 'CANCELLED') return t('已取消', 'Cancelled')
  if (status === 'NOT_SUPPORTED') return t('不支持', 'Not supported')
  if (status === 'UNSUPPORTED') return t('不支持', 'Unsupported')
  return t('未测试', 'Not tested')
}
function fallbackLevelText(level: string, t: (zh: string, en: string) => string): string {
  if (level === 'PRIMARY') return t('主来源', 'Primary')
  if (level === 'FALLBACK_1') return t('备用 1', 'Fallback 1')
  if (level === 'FALLBACK_2') return t('备用 2', 'Fallback 2')
  if (level === 'LLM_WEB') return 'LLM_WEB'
  return level
}

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
    <div className="data-source-test-actions">{view.integration.supportedTests.connection ? <button disabled={active} onClick={() => void onTest(view, 'connection')}>{t('测试连接', 'Test connection')}</button> : null}{view.integration.capabilities.filter((capability) => view.integration.supportedTests.capabilitySamples.includes(capability.id)).map((capability) => <button key={capability.id} disabled={active} onClick={() => void onTest(view, 'capability_sample', capability.id)}>{t('抽样测试', 'Sample test')} · {capability.label}</button>)}{view.integration.credentialFields.length > 0 ? <button onClick={onCredentials}>{t('管理凭据', 'Manage credentials')}</button> : null}</div>
    {tests.map(({ summary, key }) => <p key={key} className="data-source-test-result">{summary.kind === 'connection' ? t('连接测试', 'Connection test') : t('能力抽样', 'Capability sample')}{summary.capabilityId ? ` · ${summary.capabilityId}` : ''}：{testSummaryText(summary, t)}</p>)}
    {Object.entries(testMessage).filter(([key]) => key.startsWith(`${id}:`)).map(([key, message]) => message ? <p role="status" key={key} className="data-source-test-result">{message}</p> : null)}
  </article>
}
