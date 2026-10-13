import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
const date = '2026-10-13T09:00:00.000Z'
const report = (id: string) => ({ reportId: id, reportType: 'company_research', workflowRunId: `run-${id}`, subjectRefs: ['entity:company'], generatedAt: date, asOf: date, knowledgeBaseRevision: 1, sourceCount: 0, claimCount: 0, sectionCount: 1, methodology: 'Fixture methodology', sourceRefs: [], claimRefs: [], sections: [{ id: 'summary', title: 'Summary', markdown: `Body of ${id}` }] })
const session = { conversationId: 'c1', isStreaming: false, isIdle: true, pendingMessageCount: 0, thinkingLevel: 'off' }
function runtime(extra: (path: string) => Promise<Response> | Response, activities: unknown[] = []) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input)
    if (path === '/api/bootstrap') return json({ runtime: { origin: 'http://127.0.0.1:1234', runtimeToken: 'b'.repeat(64) }, origin: 'http://127.0.0.1:1234', session, conversations: [], knowledgeError: { code: 'no_kb_mounted' } })
    if (path === '/api/conversations/current') return json(session)
    if (path === '/api/conversations/messages') return json({ conversationId: 'c1', messages: [], activities })
    if (path.startsWith('/api/conversations')) return json({ conversations: [] })
    if (path === '/api/research/workflows') return json({ workflows: [] })
    if (path === '/api/settings') return json({ revision: 1, model: {}, models: [], knowledgeBases: [] })
    return extra(path)
  }) as typeof fetch
}
describe('Report navigation and original conversation artifacts', () => {
  const oldFetch = globalThis.fetch, oldSource = globalThis.EventSource
  beforeEach(() => {
    window.localStorage.setItem('researchhub.language', 'en'); window.sessionStorage.clear(); window.history.replaceState({}, '', '/reports')
    const Source = class { onopen = null; onerror = null; close() {} addEventListener() {} removeEventListener() {} }
    globalThis.EventSource = Source as unknown as typeof EventSource
  })
  afterEach(() => { cleanup(); globalThis.fetch = oldFetch; globalThis.EventSource = oldSource; window.history.replaceState({}, '', '/'); vi.restoreAllMocks() })
  it('isolates two report requests when their replies arrive in reverse order', async () => {
    let finishA!: (value: Response) => void, finishB!: (value: Response) => void
    runtime(path => path === '/api/research-reports?limit=20' ? json({ reports: [report('a'), report('b')] }) : path === '/api/research-reports/a' ? new Promise(resolve => { finishA = resolve }) : path === '/api/research-reports/b' ? new Promise(resolve => { finishB = resolve }) : json({}, 404))
    render(<App />)
    const history = await screen.findByRole('region', { name: 'Research Report history' }).catch(() => screen.getByLabelText('Research Report history'))
    fireEvent.click(within(history).getByRole('button', { name: /a$/ }))
    expect(await screen.findByText('Loading report content…')).toBeTruthy()
    fireEvent.click(within(history).getByRole('button', { name: /b$/ }))
    await act(async () => { finishB(json(report('b'))) })
    expect(await screen.findByText('Body of b')).toBeTruthy()
    await act(async () => { finishA(json(report('a'))) })
    expect(screen.queryByText('Body of a')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Research Bundles' })).toBeNull()
  })
  it('keeps the legacy bundles route accessible without a main navigation entry', async () => {
    window.history.replaceState({}, '', '/bundles')
    runtime(path => path === '/api/research/bundles?limit=20' ? json({ bundles: [] }) : json({}, 404))
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Research Bundles' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Research Bundles' })).toBeNull()
    expect(await screen.findByText('No persisted Research Bundles')).toBeTruthy()
  })
  it('opens a no-report bundle from its durable original conversation Activity', async () => {
    window.history.replaceState({}, '', '/research')
    const run = 'free-11111111-1111-4111-8111-111111111111'
    const bundle = { bundleId: `research-bundle-${run}`, workflowRunId: run, createdAt: date, status: 'completed', proposals: [], sourceLibraryHits: [], structuredResult: { answer: 'Bounded free research answer' } }
    runtime(path => path === '/api/research/bundles?limit=20' ? json({ bundles: [bundle] }) : path === `/api/research/bundles/${bundle.bundleId}` ? json(bundle) : json({}, 404), [{ activityId: 'a1', conversationId: 'c1', operationId: 'o1', kind: 'accepted_request', operation: 'prompt', status: 'completed', createdAt: date, researchBundleRunId: run, requestText: 'Free research' }])
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'View Research Bundle' }))
    expect(await screen.findByRole('heading', { name: bundle.bundleId })).toBeTruthy()
    expect(screen.getByText(/Bounded free research answer/)).toBeTruthy()
  })
  it('rejects another run returned to a conversation artifact request', async () => {
    window.history.replaceState({}, '', '/research')
    const bundle = { bundleId: 'research-bundle-wrong', workflowRunId: 'wrong', createdAt: date, status: 'completed', proposals: [], sourceLibraryHits: [], structuredResult: { summary: 'WRONG DATA' } }
    runtime(path => path === '/api/research/bundles?limit=20' ? json({ bundles: [] }) : path === '/api/research/bundles/research-bundle-owned' ? json(bundle) : json({}, 404), [{ activityId: 'a1', conversationId: 'c1', operationId: 'o1', kind: 'accepted_request', operation: 'prompt', status: 'cancelled', createdAt: date, workflowRunId: 'owned', requestText: 'Cancelled research' }])
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'View Research Bundle' }))
    await waitFor(() => expect(screen.getByText('Research artifact could not be loaded or its association is invalid.')).toBeTruthy())
    expect(screen.queryByText(/WRONG DATA/)).toBeNull()
  })
})
