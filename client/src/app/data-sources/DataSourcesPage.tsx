import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { DataSourceCatalogResponse, RuntimeClient } from '../../api/runtime-client'
import { useLanguage } from '../../i18n'
import './data-sources-page.css'

interface Props { readonly client: RuntimeClient }

export function DataSourcesPage({ client }: Props): ReactElement {
  const { t } = useLanguage()
  const [catalog, setCatalog] = useState<DataSourceCatalogResponse>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    void client.getDataSourceCatalog().then((response) => {
      if (active) setCatalog(response)
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : t('读取数据源策略失败。', 'Could not load data source policies.'))
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [client, t])

  const displaySource = (source: string | null): string => source?.trim() || t('待接入', 'Not connected')
  const rows = catalog ? [...catalog.rows].sort((a, b) => a.metricId.localeCompare(b.metricId) || a.workflowId.localeCompare(b.workflowId)) : []

  return <main className="page-frame data-sources-page" aria-labelledby="data-sources-title">
    <div className="page-heading">
      <div><span className="eyebrow">{t('数据治理', 'DATA GOVERNANCE')}</span><h1 id="data-sources-title">{t('数据源', 'Data Sources')}</h1></div>
      <span className="read-only-badge">{t('只读', 'Read-only')}</span>
    </div>
    <p>{t('查看通用指标在各 Workflow 中配置的数据源顺序。行业研究使用独立字段体系，未纳入此目录。', 'Review the configured source order for generic metrics across workflows. Industry research uses a separate field model and is not included.')}</p>
    {catalog && !catalog.coverageComplete ? <div className="notice data-sources-coverage" role="status"><strong>{t('来源覆盖尚未完整', 'Source coverage is incomplete')}</strong><p>{t('标为“待接入”的来源尚未配置可执行适配器。', 'Sources marked “Not connected” do not yet have an executable adapter configured.')}</p></div> : null}
    {error ? <div className="notice" role="alert"><strong>{t('数据源目录不可用', 'Data source catalog unavailable')}</strong><p>{error}</p></div> : null}
    {loading ? <p className="muted" role="status">{t('正在加载数据源目录…', 'Loading data source catalog…')}</p> : null}
    {!loading && !error && catalog ? <>
      <div className="data-sources-table-wrap">
        <table className="data-sources-table">
          <caption>{t('通用指标及其来源顺序', 'Generic metrics and their source order')}</caption>
          <thead><tr>
            <th scope="col">metricId</th>
            <th scope="col">{t('中文含义', 'Chinese meaning')}</th>
            <th scope="col">capability</th>
            <th scope="col">{t('默认源', 'Default source')}</th>
            <th scope="col">{t('一级备用源', 'Fallback 1')}</th>
            <th scope="col">{t('二级备用源', 'Fallback 2')}</th>
            <th scope="col">{t('兜底备用源', 'Final fallback')}</th>
          </tr></thead>
          <tbody>
            {rows.map((row) => <tr key={`${row.workflowId}:${row.capability}:${row.metricId}`}>
              <th scope="row">{row.metricId}</th>
              <td>{row.chineseMeaning || t('待补充', 'Pending')}</td>
              <td>{row.capability}</td>
              <td>{displaySource(row.defaultSource)}</td>
              <td>{displaySource(row.fallback1)}</td>
              <td>{displaySource(row.fallback2)}</td>
              <td>{displaySource(row.finalFallback)}</td>
            </tr>)}
            {rows.length === 0 ? <tr><td colSpan={7} className="data-sources-empty">{t('当前没有可展示的通用指标来源策略。', 'No generic metric source policies are available.')}</td></tr> : null}
          </tbody>
        </table>
      </div>
      {rows.length > 0 && !catalog.coverageComplete ? <p className="data-sources-coverage-count">{t('不完整覆盖的指标：', 'Metrics with incomplete coverage: ')}{rows.filter((row) => !row.coverageComplete).length}</p> : null}
    </> : null}
  </main>
}
