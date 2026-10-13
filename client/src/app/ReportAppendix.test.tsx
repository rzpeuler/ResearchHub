import { cleanup, fireEvent, render as renderBase, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RuntimeClientError, type ResearchReport, type RuntimeClient, type WorkflowRun } from '../api/runtime-client'
import { ReportAppendix } from './ReportAppendix'
import { LanguageProvider } from '../i18n'
import type { ReactNode } from 'react'

function render(node: ReactNode) { return renderBase(node, { wrapper: LanguageProvider }) }

type Bundle = Awaited<ReturnType<RuntimeClient['getResearchBundleForRun']>>
const report: ResearchReport = { reportId: 'report-a', reportType: 'company_research', workflowRunId: 'run-a', subjectRefs: [], generatedAt: '2026-10-13', asOf: '2026-10-13', knowledgeBaseRevision: 1, sourceCount: 1, claimCount: 0, sectionCount: 0, methodology: 'fixture', sourceRefs: ['source-existing'], claimRefs: [], sections: [] }
const bundle: Bundle = { bundleId: 'research-bundle-run-a', workflowRunId: 'run-a', createdAt: '2026-10-13', status: 'completed', report: { reportId: 'report-a' }, proposals: [{ proposalId: 'proposal-a', kind: 'claim' }], structuredResult: { companyName: 'Company Alpha', summary: 'A real summary' }, sourceLibraryHits: [{ sourceLibraryRef: 'source-existing', rawRef: 'https://example.com/filing', title: 'Annual filing', excerpt: 'Revenue grew', contentHash: 'hash-1', chunkIndex: 2, provenance: { rawRef: 'https://example.com/filing' } }] }
const workflow: WorkflowRun = { runId: 'run-a', workflowType: 'company_research', status: 'interrupted', observationSource: 'historical', objective: 'Research', startedAt: '2026-10-13T10:00:00Z', updatedAt: '2026-10-13T10:01:00Z', stages: [{ stageId: 'acquisition', label: 'Data acquisition', status: 'running', startedAt: '2026-10-13T10:00:30Z' }], providerObservations: [{ providerId: 'filing', label: 'Filing Provider', status: 'success', recordCount: 3, durationMs: 25, diagnostics: [] }], skillObservations: [{ skillId: 'analysis', label: 'Analysis Skill', status: 'completed', durationMs: 30 }] }
function client(bundleResult: Bundle = bundle, workflowResult = workflow) {
  const getResearchBundleForRun = vi.fn().mockResolvedValue(bundleResult)
  const getWorkflow = vi.fn().mockResolvedValue(workflowResult)
  return { instance: { getResearchBundleForRun, workflow: getWorkflow } as unknown as RuntimeClient, bundle: getResearchBundleForRun, workflow: getWorkflow }
}
function toggle(title: string, open = true) {
  const element = screen.getByText(title).closest('details')!
  element.open = open
  fireEvent(element, new Event('toggle'))
  return element
}
afterEach(() => { cleanup(); localStorage.removeItem('researchhub.language') })

describe('ReportAppendix', () => {
  it('loads independently on expansion, shows actual provenance without duplicating report refs, and renders historical observations', async () => {
    const api = client()
    render(<ReportAppendix report={report} client={api.instance} />)
    expect(api.bundle).not.toHaveBeenCalled()
    expect(api.workflow).not.toHaveBeenCalled()
    toggle('研究依据与数据来源')
    expect(await screen.findByText('Annual filing')).toBeTruthy()
    expect(screen.queryByText('source-existing')).toBeNull()
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.getByText(/摘要片段，不代表完整原始资料/)).toBeTruthy()
    expect(api.workflow).not.toHaveBeenCalled()
    toggle('结构化研究结果')
    expect(await screen.findByText('Company Alpha')).toBeTruthy()
    expect(screen.getByText('proposal-a · claim')).toBeTruthy()
    expect(screen.getByText('查看受限结构化 JSON').closest('details')!.open).toBe(false)
    toggle('Workflow 执行历史')
    expect(await screen.findByText('historical · 历史快照')).toBeTruthy()
    expect(screen.getByText(/interrupted · 执行中断/)).toBeTruthy()
    expect(screen.getByText('Data acquisition')).toBeTruthy()
    expect(screen.getByText('Filing Provider')).toBeTruthy()
    expect(screen.getByText('Analysis Skill')).toBeTruthy()
    expect(screen.getByText('未记录')).toBeTruthy()
  })

  it('shows absent Bundle and Workflow snapshots without affecting other sections', async () => {
    const api = client()
    api.bundle.mockRejectedValue(new RuntimeClientError('not_found', 'private path', 404))
    api.workflow.mockRejectedValue(new RuntimeClientError('not_found', 'private stack', 404))
    render(<ReportAppendix report={report} client={api.instance} />)
    toggle('结构化研究结果')
    expect(await screen.findByText('该报告没有可用研究资料包。')).toBeTruthy()
    toggle('Workflow 执行历史')
    expect(await screen.findByText('历史阶段不可用：未找到 Workflow 快照。')).toBeTruthy()
    expect(screen.queryByText(/private/)).toBeNull()
  })

  it('isolates read errors and retries only the failed section without exposing server errors', async () => {
    const api = client()
    api.bundle.mockRejectedValueOnce(new Error('secret=unsafe\n at backend (C:/private/a.ts:2)')).mockResolvedValue(bundle)
    api.workflow.mockRejectedValueOnce(new Error('raw stack')).mockResolvedValue(workflow)
    render(<ReportAppendix report={report} client={api.instance} />)
    const results = toggle('结构化研究结果')
    await screen.findByRole('alert')
    expect(screen.queryByText(/secret=unsafe/)).toBeNull()
    fireEvent.click(within(results).getByRole('button', { name: '重试' }))
    expect(await screen.findByText('Company Alpha')).toBeTruthy()
    const history = toggle('Workflow 执行历史')
    await within(history).findByRole('alert')
    fireEvent.click(within(history).getByRole('button', { name: '重试' }))
    expect(await screen.findByText('historical · 历史快照')).toBeTruthy()
    expect(api.bundle).toHaveBeenCalledTimes(2)
  })

  it.each([
    { ...bundle, workflowRunId: 'other-run' },
    { ...bundle, bundleId: 'research-bundle-other-run' },
    { ...bundle, report: { reportId: 'other-report' } },
    { ...bundle, executionResult: { runId: 'other-run', workflowId: 'company_research', executionStatus: 'completed', diagnostics: [], bundleStatus: 'available' } } as Bundle,
    { ...bundle, executionResult: { runId: 'run-a', reportRef: 'other-report', workflowId: 'company_research', executionStatus: 'completed', diagnostics: [], bundleStatus: 'available' } } as Bundle,
  ])('rejects mismatched Bundle identity %#', async wrongBundle => {
    const api = client(wrongBundle)
    render(<ReportAppendix report={report} client={api.instance} />)
    toggle('结构化研究结果')
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByText('Company Alpha')).toBeNull()
  })

  it('rejects a Workflow from a different run', async () => {
    const api = client(bundle, { ...workflow, runId: 'other-run' })
    render(<ReportAppendix report={report} client={api.instance} />)
    toggle('Workflow 执行历史')
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByText('Data acquisition')).toBeNull()
  })

  it('allows Bundle without report metadata and explicit empty sources/proposals', async () => {
    const api = client({ ...bundle, report: undefined, structuredResult: null, sourceLibraryHits: [], proposals: [] })
    render(<ReportAppendix report={report} client={api.instance} />)
    toggle('研究依据与数据来源')
    expect(await screen.findByText('暂无来源库命中。')).toBeTruthy()
    toggle('结构化研究结果')
    expect(await screen.findByText('暂无结构化研究结果。')).toBeTruthy()
    expect(screen.getByText('暂无提案。')).toBeTruthy()
  })

  it('bounds a large result and removes secrets, hidden reasoning, paths, raw provider responses', async () => {
    const structuredResult = { summary: 'Bounded result', apiToken: 'sensitive-token', chainOfThought: 'private thinking', providerResponse: 'RAW_RESPONSE', reportPath: 'C:/private/report.json', safeField: 'password=abc', findings: Array.from({ length: 10000 }, (_, i) => `item-${i}`), nested: { a: { b: { c: 'too deep' } } }, ...Object.fromEntries(Array.from({ length: 10000 }, (_, i) => [`field${i}`, `value-${i}`])) }
    const api = client({ ...bundle, structuredResult })
    const view = render(<ReportAppendix report={report} client={api.instance} />)
    toggle('结构化研究结果')
    await screen.findByText('Bounded result')
    expect(view.container.textContent).not.toMatch(/sensitive-token|private thinking|RAW_RESPONSE|C:\/private|password=abc|item-9999|value-9999|too deep/)
    expect(view.container.textContent!.length).toBeLessThan(15000)
    expect(screen.getByText('查看受限结构化 JSON').closest('details')!.open).toBe(false)
  })

  it('discards late requests after a report switch and resets all panels', async () => {
    let resolveOld!: (value: Bundle) => void
    const api = client()
    api.bundle.mockImplementationOnce(() => new Promise<Bundle>(resolve => { resolveOld = resolve })).mockResolvedValue({ ...bundle, workflowRunId: 'run-b', bundleId: 'research-bundle-run-b', report: { reportId: 'report-b' }, structuredResult: { summary: 'Report B result' } })
    const view = render(<ReportAppendix report={report} client={api.instance} />)
    toggle('结构化研究结果')
    await waitFor(() => expect(api.bundle).toHaveBeenCalledTimes(1))
    view.rerender(<ReportAppendix report={{ ...report, reportId: 'report-b', workflowRunId: 'run-b' }} client={api.instance} />)
    expect(screen.getByText('结构化研究结果').closest('details')!.open).toBe(false)
    toggle('结构化研究结果')
    expect(await screen.findByText('Report B result')).toBeTruthy()
    resolveOld(bundle)
    await waitFor(() => expect(screen.queryByText('Company Alpha')).toBeNull())
    expect(screen.getByText('Report B result')).toBeTruthy()
  })

  it('uses native focusable disclosure controls and responds to open/close events', async () => {
    const api = client()
    render(<ReportAppendix report={report} client={api.instance} />)
    const summary = screen.getByText('结构化研究结果')
    expect(summary.tagName).toBe('SUMMARY')
    summary.focus()
    expect(document.activeElement).toBe(summary)
    // Native summary Enter/Space activation is provided by the browser; jsdom does not implement it.
    const details = toggle('结构化研究结果')
    expect(await screen.findByText('Company Alpha')).toBeTruthy()
    toggle('结构化研究结果', false)
    expect(details.open).toBe(false)
  })

  it.each(['../outside', '', 'x'.repeat(121)])('rejects invalid run IDs before making requests: %s', invalidId => {
    const api = client()
    render(<ReportAppendix report={{ ...report, workflowRunId: invalidId }} client={api.instance} />)
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(api.bundle).not.toHaveBeenCalled()
    expect(api.workflow).not.toHaveBeenCalled()
  })

  it('accepts dotted run IDs consistent with the backend contract', async () => {
    const runId = 'run.fixture-1'
    const api = client({ ...bundle, workflowRunId: runId, bundleId: `research-bundle-${runId}` })
    render(<ReportAppendix report={{ ...report, workflowRunId: runId }} client={api.instance} />)
    toggle('结构化研究结果')
    expect(await screen.findByText('Company Alpha')).toBeTruthy()
    expect(api.bundle).toHaveBeenCalledWith(runId)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('localizes controls and errors to English', async () => {
    localStorage.setItem('researchhub.language', 'en')
    const api = client()
    api.bundle.mockRejectedValue(new Error('private failure'))
    render(<ReportAppendix report={report} client={api.instance} />)
    expect(screen.getByRole('region', { name: 'Research appendix' })).toBeTruthy()
    toggle('Structured research results')
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(screen.getByText('Workflow execution history')).toBeTruthy()
  })

  it('renders safe stage and Skill summaries plus diagnostic codes, excluding stack-like diagnostics', async () => {
    const api = client(bundle, { ...workflow, stages: [{ ...workflow.stages![0], summary: 'Acquisition remains in progress', diagnostics: ['DATA_PARTIAL', 'at unsafe (C:/private/file.ts:2)'] }], skillObservations: [{ ...workflow.skillObservations![0], summary: 'Analysis observations available' }] })
    render(<ReportAppendix report={report} client={api.instance} />)
    toggle('Workflow 执行历史')
    expect(await screen.findByText('Acquisition remains in progress')).toBeTruthy()
    expect(screen.getByText('Analysis observations available')).toBeTruthy()
    expect(screen.getByText('诊断：DATA_PARTIAL')).toBeTruthy()
    expect(screen.queryByText(/at unsafe/)).toBeNull()
  })

  it('discards pending Workflow responses after unmount', async () => {
    let resolveOld!: (value: WorkflowRun) => void
    const api = client()
    api.workflow.mockImplementationOnce(() => new Promise<WorkflowRun>(resolve => { resolveOld = resolve }))
    const view = render(<ReportAppendix report={report} client={api.instance} />)
    toggle('Workflow 执行历史')
    await waitFor(() => expect(api.workflow).toHaveBeenCalledTimes(1))
    view.unmount()
    resolveOld(workflow)
    await Promise.resolve()
    expect(screen.queryByText('Data acquisition')).toBeNull()
  })

  it('rejects malformed Bundle payloads rather than failing the report page', async () => {
    const api = client({ ...bundle, sourceLibraryHits: [null] } as unknown as Bundle)
    render(<ReportAppendix report={report} client={api.instance} />)
    toggle('研究依据与数据来源')
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText('研究附录')).toBeTruthy()
  })

  it('does not expose credentials embedded in a source URL', async () => {
    const api = client({ ...bundle, sourceLibraryHits: [{ ...bundle.sourceLibraryHits[0], rawRef: 'https://user:password@example.com/file', provenance: { rawRef: 'https://user:password@example.com/file' } }] })
    render(<ReportAppendix report={report} client={api.instance} />)
    toggle('研究依据与数据来源')
    await screen.findByText('Annual filing')
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByText(/user:password/)).toBeNull()
  })
})
