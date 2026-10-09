import { createServer } from 'node:http'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

function json(body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }) }
const nativeHttpFetch = globalThis.fetch.bind(globalThis)

async function openReviewsSection(name: string): Promise<void> {
  fireEvent.click(await screen.findByRole('link', { name: 'Reviews' }))
  fireEvent.click(await screen.findByRole('button', { name }))
}

function mockV04UploadRuntime(fetchMock: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): void {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    if (path === '/api/bootstrap') return json({ runtime: { origin: 'http://127.0.0.1:1234', runtimeToken: 'b'.repeat(64) }, origin: 'http://127.0.0.1:1234', session: { conversationId: 'c1', isStreaming: false, isIdle: true, pendingMessageCount: 0, thinkingLevel: 'off' }, conversations: [], knowledgeBase: { knowledgeBaseId: 'kb-1', rootRef: 'root:kb', revision: 7, status: 'active', schemaVersion: '0.4', storageFormatVersion: '1', counts: {} } })
    if (path === '/api/research/workflows') return json({ workflows: [] })
    if (path === '/api/conversations/current') return json({ conversationId: 'c1', isStreaming: false, isIdle: true, pendingMessageCount: 0, thinkingLevel: 'off' })
    if (path === '/api/conversations/messages') return json({ conversationId: 'c1', messages: [] })
    if (path === '/api/conversations') return json({ conversations: [] })
    if (path === '/api/theme-framework/reviews?limit=50') return json({ items: [], total: 0, truncated: false })
    if (path === '/api/theme-scope-impact?limit=50') return json({ items: [], total: 0, truncated: false })
    return fetchMock(input, init)
  }) as typeof fetch
}

const v04Preview = { runId: 'preview-1', status: 'preview_ready', knowledgeBaseId: 'kb-1', candidateGroups: [{ candidateId: 'candidate-claim-1', kind: 'claim', candidate: { statement: 'Revenue grew in FY2025' }, provenanceRefs: { sourceRef: 'source:annual-report', rawRef: `raw-sha256-${'a'.repeat(64)}`, evidenceBlockRefs: ['block-1'] } }], committable: true }

describe('Homepage shell', () => {
  const originalFetch = globalThis.fetch
  const originalEventSource = globalThis.EventSource
  beforeEach(() => {
    window.localStorage.setItem('researchhub.language', 'en')
    window.history.replaceState({}, '', '/')
    const FakeEventSource = class { onopen: ((event: Event) => void) | null = null; onerror: ((event: Event) => void) | null = null; close = vi.fn(); addEventListener = vi.fn(); removeEventListener = vi.fn() }
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource
    Object.defineProperty(window, 'EventSource', { configurable: true, value: FakeEventSource })
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path === '/api/bootstrap') return json({ runtime: { origin: 'http://127.0.0.1:1234', runtimeToken: 'b'.repeat(64) }, origin: 'http://127.0.0.1:1234', session: { conversationId: 'c1', isStreaming: false, isIdle: true, pendingMessageCount: 0, thinkingLevel: 'off' }, conversations: [], knowledgeError: { code: 'no_kb_mounted', error: 'not mounted' } })
      if (path === '/api/research/workflows') return json({ workflows: [{ id: 'earnings_review', label: 'Earnings Review', intentDescription: 'Review earnings', inputSchema: {}, requiredInputs: ['symbol', 'fiscalYear', 'period'], outputContract: 'ResearchReport', knowledgeEffects: ['Claim'] }] })
      if (path === '/api/conversations/current') return json({ conversationId: 'c1', isStreaming: false, isIdle: true, pendingMessageCount: 0, thinkingLevel: 'off' })
      if (path === '/api/conversations/messages') return json({ conversationId: 'c1', messages: [] })
      if (path === '/api/conversations') return json({ conversations: [] })
      if (path === '/api/daily-briefs?limit=20') return json({ briefs: [] })
      if (path === '/api/research-reports?limit=20') return json({ reports: [] })
      return json({ code: 'not_found', error: 'not found' }, 404)
    }) as typeof fetch
  })
  afterEach(() => { cleanup(); window.history.replaceState({}, '', '/'); globalThis.fetch = originalFetch; globalThis.EventSource = originalEventSource; Object.defineProperty(window, 'EventSource', { configurable: true, value: originalEventSource }) })

  it('keeps workflow input feedback visible without falling back to ordinary chat', async () => {
    const calls: string[] = []
    const dispatchRequests: unknown[] = []
    let dispatchCount = 0
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      calls.push(`${init?.method ?? 'GET'} ${path}`)
      if (path === '/api/bootstrap') return json({ runtime: { origin: 'http://127.0.0.1:1234', runtimeToken: 'b'.repeat(64) }, origin: 'http://127.0.0.1:1234', session: { conversationId: 'c1', isStreaming: false, isIdle: true, pendingMessageCount: 0, thinkingLevel: 'off' }, conversations: [], knowledgeError: { code: 'no_kb_mounted', error: 'not mounted' } })
      if (path === '/api/research/workflows') return json({ workflows: [{ id: 'earnings_review', label: 'Earnings Review', intentDescription: 'Review earnings', inputSchema: {}, requiredInputs: ['symbol', 'fiscalYear', 'period'], outputContract: 'ResearchReport', knowledgeEffects: ['Claim'] }] })
      if (path === '/api/conversations/current') return json({ conversationId: 'c1', isStreaming: false, isIdle: true, pendingMessageCount: 0, thinkingLevel: 'off' })
      if (path === '/api/conversations/messages') return json({ conversationId: 'c1', messages: [] })
      if (path === '/api/conversations') return json({ conversations: [] })
      if (path === '/api/daily-briefs?limit=20') return json({ briefs: [] })
      if (path === '/api/research-reports?limit=20') return json({ reports: [] })
      if (path === '/api/research/dispatch') {
        dispatchRequests.push(JSON.parse(String(init?.body)))
        const followUp = dispatchCount++ > 0
        return json({
          accepted: true, status: 'needs_input',
          request: { query: followUp ? 'Q1' : 'Review this quarter', mode: { type: 'workflow', workflowId: 'earnings_review' }, contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: false } },
          decision: { mode: 'workflow', workflow: { id: 'earnings_review', confidence: 1, arguments: followUp ? { period: 'Q1' } : { symbol: 'NVDA', fiscalYear: 2026 } }, skills: [], entities: [], missingRequiredInputs: followUp ? ['fiscalYear'] : ['period'], contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: false }, rationale: 'A required value is missing' },
          summary: { mode: 'Explicit Workflow', workflowId: 'earnings_review', workflowLabel: 'Earnings Review', selectedSkillIds: [], argumentsStatus: 'missing', argumentKeys: followUp ? ['period'] : ['symbol', 'fiscalYear'], contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: false } },
          feedback: followUp
            ? { status: 'NEEDS_INPUT', workflowId: 'earnings_review', missingFields: ['fiscalYear'], validatedArguments: { period: 'Q1' }, reason: 'The fiscal year is required.', suggestedQuestion: 'Which fiscal year should I review?' }
            : { status: 'NEEDS_INPUT', workflowId: 'earnings_review', missingFields: ['period'], validatedArguments: { symbol: 'NVDA', fiscalYear: 2026 }, reason: 'The fiscal period is required.', suggestedQuestion: 'Which quarter should I review?' },
          resolution: { source: 'bounded_repair', attempts: 2, diagnostics: ['invalid_semantic_output_repaired'] },
        })
      }
      return json({ code: 'not_found', error: 'not found' }, 404)
    }) as typeof fetch
    render(<App />)
    const composer = await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    fireEvent.change(composer, { target: { value: 'Review this quarter' } })
    fireEvent.click(screen.getByRole('button', { name: /Send/ }))

    expect(await screen.findByText('The fiscal period is required.')).toBeTruthy()
    expect(screen.getByText('Missing fields: period')).toBeTruthy()
    expect(screen.getByText(/Resolved arguments:.*NVDA.*2026/)).toBeTruthy()
    expect(screen.getByText('Suggested question: Which quarter should I review?')).toBeTruthy()
    expect(screen.getByText('One bounded argument repair was used')).toBeTruthy()
    expect((screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement).value).toBe('Review this quarter')
    expect((screen.getByRole('combobox', { name: 'Workflow' }) as HTMLSelectElement).value).toBe('earnings_review')
    expect(calls).toContain('POST /api/research/dispatch')
    expect(calls).not.toContain('POST /api/conversations/prompt')

    fireEvent.change(composer, { target: { value: 'Q1' } })
    fireEvent.click(screen.getByRole('button', { name: /Send/ }))
    expect(await screen.findByText('Missing fields: fiscalYear')).toBeTruthy()
    expect(screen.getByText(/Resolved arguments:.*NVDA.*2026.*Q1/)).toBeTruthy()
    expect((screen.getByRole('combobox', { name: 'Workflow' }) as HTMLSelectElement).value).toBe('earnings_review')
    expect(dispatchRequests[1]).toMatchObject({ workflowArgumentContext: { workflowId: 'earnings_review', arguments: { symbol: 'NVDA', fiscalYear: 2026 } } })
  })

  it('shows terminal Workflow results and only opens persisted artifacts linked to that run', async () => {
    const calls: string[] = []
    const workflow = { runId: 'run-result-1', workflowType: 'earnings_review', objective: 'Review NVDA earnings', status: 'completed_with_review', startedAt: '2026-10-09T00:00:00.000Z', updatedAt: '2026-10-09T00:01:00.000Z', completedAt: '2026-10-09T00:01:00.000Z', executionResult: { runId: 'run-result-1', workflowId: 'earnings_review', executionStatus: 'completed_with_review', terminalStatus: 'completed_with_review', summary: 'Review completed with one open review case.', reportRef: 'report-nvda-fy26-q1', bundleRef: 'bundle-run-result-1', reviewRef: { kind: 'review_case', id: 'review-case-1' }, diagnostics: [], bundleStatus: 'available' } }
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input); calls.push(`${init?.method ?? 'GET'} ${path}`)
      if (path === '/api/bootstrap') return json({ runtime: { origin: 'http://127.0.0.1:1234', runtimeToken: 'b'.repeat(64) }, origin: 'http://127.0.0.1:1234', session: { conversationId: 'c1', isStreaming: false, isIdle: true, pendingMessageCount: 0, thinkingLevel: 'off' }, conversations: [], knowledgeBase: { knowledgeBaseId: 'kb-1', rootRef: 'root:kb', revision: 1, status: 'active', schemaVersion: '0.4', storageFormatVersion: '1', counts: {} } })
      if (path === '/api/research/workflows') return json({ workflows: [] })
      if (path === '/api/conversations/current') return json({ conversationId: 'c1', isStreaming: false, isIdle: true, pendingMessageCount: 0, thinkingLevel: 'off' })
      if (path === '/api/conversations/messages') return json({ conversationId: 'c1', messages: [] })
      if (path === '/api/conversations') return json({ conversations: [] })
      if (path === '/api/research/dispatch') return json({ accepted: true, status: 'started', request: { query: 'Review NVDA earnings', mode: { type: 'workflow', workflowId: 'earnings_review' }, contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: false } }, decision: { mode: 'workflow', workflow: { id: 'earnings_review', confidence: 1, arguments: {} }, skills: [], entities: [], missingRequiredInputs: [], contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: false }, rationale: 'Explicit Workflow' }, summary: { mode: 'Explicit Workflow', workflowId: 'earnings_review', selectedSkillIds: [], argumentsStatus: 'complete', argumentKeys: [], contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: false } }, runId: 'run-result-1', workflow })
      if (path === '/api/research/bundles/by-run/run-result-1') return json({ bundleId: 'bundle-run-result-1', workflowRunId: 'run-result-1', createdAt: '2026-10-09T00:01:00.000Z', status: 'completed_with_review', proposals: [], sourceLibraryHits: [], structuredResult: {} })
      if (path === '/api/research-reports/report-nvda-fy26-q1') return json({ reportId: 'report-nvda-fy26-q1', reportType: 'earnings_review', subjectRefs: ['entity:NVDA'], generatedAt: '2026-10-09T00:01:00.000Z', asOf: '2026-10-09T00:00:00.000Z', workflowRunId: 'run-result-1', knowledgeBaseRevision: 1, sourceRefs: [], claimRefs: [], methodology: 'bounded', sections: [] })
      if (path === '/api/research-reports?limit=20') return json({ reports: [{ reportId: 'report-nvda-fy26-q1', reportType: 'earnings_review', subjectRefs: ['entity:NVDA'], generatedAt: '2026-10-09T00:01:00.000Z', knowledgeBaseRevision: 1, sectionCount: 0, sourceCount: 0, workflowRunId: 'run-result-1' }] })
      if (path === '/api/reviews/review-case-1') return json({ reviewCaseId: 'review-case-1', producerRunId: 'run-result-1', producerType: 'earnings_review', createdAt: '2026-10-09T00:01:00.000Z', classification: {}, rootProposal: {}, evidenceBindings: [], existingKnowledgeProjections: [], impact: {}, state: {}, totalDependentProposals: 0, dependentProposalSamples: [], dependentProposals: [], dependentsTruncated: false })
      return json({ code: 'not_found', error: 'not found' }, 404)
    }) as typeof fetch
    render(<App />)
    fireEvent.change(await screen.findByRole('textbox', { name: 'Message' }), { target: { value: 'Review NVDA earnings' } })
    fireEvent.click(screen.getByRole('button', { name: /Send/ }))

    expect(await screen.findByText('Workflow completed and requires review')).toBeTruthy()
    expect(screen.getAllByText('Review completed with one open review case.').length).toBeGreaterThan(0)
    expect(await screen.findByRole('button', { name: 'Open Research Bundle' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open Research Report' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open review result' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open Research Report' }))
    await waitFor(() => expect(calls).toContain('GET /api/research-reports/report-nvda-fy26-q1'))
    expect(await screen.findByRole('heading', { name: 'report-nvda-fy26-q1' })).toBeTruthy()
  })

  it('renders dispatch executor gaps as bounded feedback without raw errors', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path === '/api/bootstrap') return json({ runtime: { origin: 'http://127.0.0.1:1234', runtimeToken: 'b'.repeat(64) }, origin: 'http://127.0.0.1:1234', session: { conversationId: 'c1', isStreaming: false, isIdle: true, pendingMessageCount: 0, thinkingLevel: 'off' }, conversations: [], knowledgeBase: { knowledgeBaseId: 'kb-1', rootRef: 'root:kb', revision: 1, status: 'active', schemaVersion: '0.4', storageFormatVersion: '1', counts: {} } })
      if (path === '/api/research/workflows') return json({ workflows: [] })
      if (path === '/api/conversations/current') return json({ conversationId: 'c1', isStreaming: false, isIdle: true, pendingMessageCount: 0, thinkingLevel: 'off' })
      if (path === '/api/conversations/messages') return json({ conversationId: 'c1', messages: [] })
      if (path === '/api/conversations') return json({ conversations: [] })
      if (path === '/api/research/dispatch') return json({ accepted: false, status: 'executor_unavailable', request: { query: 'Research XYZ', mode: { type: 'workflow', workflowId: 'company_research' }, contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: false } }, decision: { mode: 'workflow', workflow: { id: 'company_research', confidence: 1, arguments: {} }, skills: [], entities: [], missingRequiredInputs: [], contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: false }, rationale: 'No binding' }, summary: { mode: 'Explicit Workflow', workflowId: 'company_research', selectedSkillIds: [], argumentsStatus: 'complete', argumentKeys: [], contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: false } }, feedback: { status: 'EXECUTOR_UNAVAILABLE', workflowId: 'company_research', missingFields: [], validatedArguments: {}, reason: 'private stack trace must not appear', suggestedQuestion: '' } })
      return json({ code: 'not_found', error: 'not found' }, 404)
    }) as typeof fetch
    render(<App />)
    fireEvent.change(await screen.findByRole('textbox', { name: 'Message' }), { target: { value: 'Research XYZ' } })
    fireEvent.click(screen.getByRole('button', { name: /Send/ }))
    expect(await screen.findByText('This Workflow executor is unavailable')).toBeTruthy()
    expect(screen.queryByText('private stack trace must not appear')).toBeNull()
  })

  it.each([
    ['invalid_input', 'INVALID_INPUT', 'Workflow input did not pass validation'],
    ['unresolved_reference', 'UNRESOLVED_REFERENCE', 'A required reference could not be resolved'],
  ] as const)('renders %s dispatch feedback without exposing transport details', async (status, feedbackStatus, label) => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path === '/api/bootstrap') return json({ runtime: { origin: 'http://127.0.0.1:1234', runtimeToken: 'b'.repeat(64) }, origin: 'http://127.0.0.1:1234', session: { conversationId: 'c1', isStreaming: false, isIdle: true, pendingMessageCount: 0, thinkingLevel: 'off' }, conversations: [], knowledgeBase: { knowledgeBaseId: 'kb-1', rootRef: 'root:kb', revision: 1, status: 'active', schemaVersion: '0.4', storageFormatVersion: '1', counts: {} } })
      if (path === '/api/research/workflows') return json({ workflows: [] })
      if (path === '/api/conversations/current') return json({ conversationId: 'c1', isStreaming: false, isIdle: true, pendingMessageCount: 0, thinkingLevel: 'off' })
      if (path === '/api/conversations/messages') return json({ conversationId: 'c1', messages: [] })
      if (path === '/api/conversations') return json({ conversations: [] })
      if (path === '/api/research/dispatch') return json({ accepted: false, status, request: { query: 'Research XYZ', mode: { type: 'workflow', workflowId: 'company_research' }, contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: false } }, decision: { mode: 'workflow', workflow: { id: 'company_research', confidence: 1, arguments: {} }, skills: [], entities: [], missingRequiredInputs: [], contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: false }, rationale: 'Input could not be dispatched' }, summary: { mode: 'Explicit Workflow', workflowId: 'company_research', selectedSkillIds: [], argumentsStatus: 'complete', argumentKeys: [], contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: false } }, feedback: { status: feedbackStatus, workflowId: 'company_research', missingFields: [], validatedArguments: {}, reason: 'private transport detail', suggestedQuestion: '' } })
      return json({ code: 'not_found', error: 'not found' }, 404)
    }) as typeof fetch
    render(<App />)
    fireEvent.change(await screen.findByRole('textbox', { name: 'Message' }), { target: { value: 'Research XYZ' } })
    fireEvent.click(screen.getByRole('button', { name: /Send/ }))
    expect(await screen.findByText(label)).toBeTruthy()
    expect(screen.queryByText('private transport detail')).toBeNull()
    cleanup()
  })

  it('renders a Workflow result fetched through RuntimeClient from a real local HTTP endpoint', async () => {
    const run = { runId: 'http-run-1', workflowType: 'company_research', objective: 'Research Example Co', status: 'blocked', startedAt: '2026-10-09T00:00:00.000Z', updatedAt: '2026-10-09T00:01:00.000Z', executionResult: { runId: 'http-run-1', workflowId: 'company_research', executionStatus: 'blocked', terminalStatus: 'blocked', summary: 'No accepted filing source was available.', blockedReason: 'SOURCE_UNAVAILABLE', diagnostics: [], bundleStatus: 'unavailable' } }
    let serverOrigin = ''
    const requestPaths: string[] = []
    const server = createServer((request, response) => {
      const path = request.url ?? ''
      requestPaths.push(path)
      const payload = path === '/api/bootstrap'
        ? { runtime: { origin: serverOrigin, runtimeToken: 'b'.repeat(64) }, origin: serverOrigin, session: { conversationId: 'http-c1', isStreaming: false, isIdle: true, pendingMessageCount: 0, thinkingLevel: 'off' }, conversations: [], knowledgeBase: { knowledgeBaseId: 'http-kb', rootRef: 'root:kb', revision: 1, status: 'active', schemaVersion: '0.4', storageFormatVersion: '1', counts: {} } }
        : path === '/api/research/workflows' ? { workflows: [] }
          : path === '/api/conversations/current' ? { conversationId: 'http-c1', isStreaming: false, isIdle: true, pendingMessageCount: 0, thinkingLevel: 'off' }
            : path === '/api/conversations/messages' ? { conversationId: 'http-c1', messages: [] }
              : path === '/api/conversations' ? { conversations: [] }
                : path === '/api/theme-framework/reviews?limit=50' ? { items: [], total: 0, truncated: false }
                  : path === '/api/theme-scope-impact?limit=50' ? { items: [], total: 0, truncated: false }
                    : path === '/api/research/dispatch' ? { accepted: true, status: 'started', request: { query: 'Research Example Co', mode: { type: 'workflow', workflowId: 'company_research' }, contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: false } }, decision: { mode: 'workflow', workflow: { id: 'company_research', confidence: 1, arguments: {} }, skills: [], entities: [], missingRequiredInputs: [], contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: false }, rationale: 'Explicit Workflow' }, summary: { mode: 'Explicit Workflow', workflowId: 'company_research', selectedSkillIds: [], argumentsStatus: 'complete', argumentKeys: [], contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: false } }, runId: run.runId, workflow: run }
                      : path === `/api/workflows/${run.runId}` ? run
                        : { code: 'not_found', error: 'not found' }
      response.statusCode = path.startsWith('/api/') && payload && 'code' in payload ? 404 : path === '/api/research/dispatch' ? 202 : 200
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify(payload))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Local test server did not bind to a TCP port')
    serverOrigin = `http://127.0.0.1:${address.port}`
    const originalFetch = globalThis.fetch
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => nativeHttpFetch(new URL(String(input), serverOrigin), init)) as typeof fetch
    try {
      render(<App />)
      let composer: HTMLElement
      try { composer = await screen.findByRole('textbox', { name: 'Message' }) } catch { throw new Error(`Local HTTP requests: ${requestPaths.join(', ')}`) }
      fireEvent.change(composer, { target: { value: 'Research Example Co' } })
      fireEvent.click(screen.getByRole('button', { name: /Send/ }))
      expect(await screen.findByText('Workflow is blocked')).toBeTruthy()
      expect(screen.getAllByText('No accepted filing source was available.').length).toBeGreaterThan(0)
      expect(screen.getByText('Blocked because: SOURCE_UNAVAILABLE')).toBeTruthy()
    } finally {
      cleanup()
      globalThis.fetch = originalFetch
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  })

  it('opens a Daily Intelligence reportRef in the Daily Brief viewer', async () => {
    const brief = { reportId: 'morning-2026-10-09', briefType: 'morning', tradeDate: '2026-10-09', generatedAt: '2026-10-09T00:01:00.000Z', asOf: '2026-10-09T00:00:00.000Z', timezone: 'Asia/Shanghai', revision: 1, workflowRunId: 'brief-run-1', quality: { topCount: 0, reportItemWithSourceRatio: 1 }, sections: [], consensusStatement: 'No actionable signals.', committedKnowledgeRefs: [], reviewCaseCount: 0, calendarConfidence: 'bounded' }
    const report = { reportId: brief.reportId, reportType: 'daily_intelligence', subjectRefs: [], generatedAt: brief.generatedAt, asOf: brief.asOf, workflowRunId: brief.workflowRunId, knowledgeBaseRevision: 1, sourceRefs: [], claimRefs: [], methodology: 'bounded', sections: [] }
    const calls: string[] = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input); calls.push(path)
      if (path === '/api/bootstrap') return json({ runtime: { origin: 'http://127.0.0.1:1234', runtimeToken: 'b'.repeat(64) }, origin: 'http://127.0.0.1:1234', session: { conversationId: 'c1', isStreaming: false, isIdle: true, pendingMessageCount: 0, thinkingLevel: 'off' }, conversations: [], knowledgeBase: { knowledgeBaseId: 'kb-1', rootRef: 'root:kb', revision: 1, status: 'active', schemaVersion: '0.4', storageFormatVersion: '1', counts: {} } })
      if (path === '/api/research/workflows') return json({ workflows: [] })
      if (path === '/api/conversations/current') return json({ conversationId: 'c1', isStreaming: false, isIdle: true, pendingMessageCount: 0, thinkingLevel: 'off' })
      if (path === '/api/conversations/messages') return json({ conversationId: 'c1', messages: [] })
      if (path === '/api/conversations') return json({ conversations: [] })
      if (path === '/api/daily-briefs?limit=20') return json({ briefs: [brief] })
      if (path === '/api/research-reports?limit=20') return json({ reports: [report] })
      if (path === '/api/research/dispatch') return json({ accepted: true, status: 'started', request: { query: 'Generate morning brief', mode: { type: 'workflow', workflowId: 'daily_intelligence' }, contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: false } }, decision: { mode: 'workflow', workflow: { id: 'daily_intelligence', confidence: 1, arguments: {} }, skills: [], entities: [], missingRequiredInputs: [], contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: false }, rationale: 'Explicit Workflow' }, summary: { mode: 'Explicit Workflow', workflowId: 'daily_intelligence', selectedSkillIds: [], argumentsStatus: 'complete', argumentKeys: [], contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: false } }, runId: brief.workflowRunId, workflow: { runId: brief.workflowRunId, workflowType: 'daily_intelligence', objective: 'Generate morning brief', status: 'completed', startedAt: brief.generatedAt, updatedAt: brief.generatedAt, completedAt: brief.generatedAt, executionResult: { runId: brief.workflowRunId, workflowId: 'daily_intelligence', executionStatus: 'completed', terminalStatus: 'completed', summary: 'Morning brief is ready.', reportRef: brief.reportId, diagnostics: [], bundleStatus: 'unavailable' } } })
      if (path === `/api/daily-briefs/${brief.reportId}`) return json(brief)
      if (path === '/api/theme-framework/reviews?limit=50') return json({ items: [], total: 0, truncated: false })
      if (path === '/api/theme-scope-impact?limit=50') return json({ items: [], total: 0, truncated: false })
      return json({ code: 'not_found', error: 'not found' }, 404)
    }) as typeof fetch
    render(<App />)
    fireEvent.change(await screen.findByRole('textbox', { name: 'Message' }), { target: { value: 'Generate morning brief' } })
    fireEvent.click(screen.getByRole('button', { name: /Send/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Open Daily Brief' }))
    await waitFor(() => expect(calls).toContain(`/api/daily-briefs/${brief.reportId}`))
    expect(await screen.findByRole('heading', { name: brief.tradeDate })).toBeTruthy()
  })

  it.each([
    ['completed', 'Workflow completed'],
    ['blocked', 'Workflow is blocked'],
    ['failed', 'Workflow failed'],
    ['cancelled', 'Workflow was cancelled'],
  ] as const)('shows an explicit %s terminal result without raw error summaries', async (status, label) => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path === '/api/bootstrap') return json({ runtime: { origin: 'http://127.0.0.1:1234', runtimeToken: 'b'.repeat(64) }, origin: 'http://127.0.0.1:1234', session: { conversationId: 'c1', isStreaming: false, isIdle: true, pendingMessageCount: 0, thinkingLevel: 'off' }, conversations: [], knowledgeBase: { knowledgeBaseId: 'kb-1', rootRef: 'root:kb', revision: 1, status: 'active', schemaVersion: '0.4', storageFormatVersion: '1', counts: {} } })
      if (path === '/api/research/workflows') return json({ workflows: [] })
      if (path === '/api/conversations/current') return json({ conversationId: 'c1', isStreaming: false, isIdle: true, pendingMessageCount: 0, thinkingLevel: 'off' })
      if (path === '/api/conversations/messages') return json({ conversationId: 'c1', messages: [] })
      if (path === '/api/conversations') return json({ conversations: [] })
      if (path === '/api/research/dispatch') return json({ accepted: true, status: 'started', request: { query: 'Research XYZ', mode: { type: 'workflow', workflowId: 'company_research' }, contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: false } }, decision: { mode: 'workflow', workflow: { id: 'company_research', confidence: 1, arguments: {} }, skills: [], entities: [], missingRequiredInputs: [], contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: false }, rationale: 'Explicit Workflow' }, summary: { mode: 'Explicit Workflow', workflowId: 'company_research', selectedSkillIds: [], argumentsStatus: 'complete', argumentKeys: [], contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: false } }, runId: 'terminal-run', workflow: { runId: 'terminal-run', workflowType: 'company_research', objective: 'Research XYZ', status, startedAt: '2026-10-09T00:00:00.000Z', updatedAt: '2026-10-09T00:01:00.000Z', errorSummary: 'private stack trace', executionResult: { runId: 'terminal-run', workflowId: 'company_research', executionStatus: status, terminalStatus: status, blockedReason: status === 'blocked' ? 'NO_CANONICAL_DATA' : undefined, diagnostics: [], bundleStatus: 'unavailable' } } })
      return json({ code: 'not_found', error: 'not found' }, 404)
    }) as typeof fetch
    render(<App />)
    fireEvent.change(await screen.findByRole('textbox', { name: 'Message' }), { target: { value: 'Research XYZ' } })
    fireEvent.click(screen.getByRole('button', { name: /Send/ }))
    expect(await screen.findByText(label)).toBeTruthy()
    expect(screen.queryByText('private stack trace')).toBeNull()
    if (status === 'blocked') expect(screen.getByText('Blocked because: NO_CANONICAL_DATA')).toBeTruthy()
    cleanup()
  })

  it('defaults to Chinese and switches visible App text with persistent language selection', async () => {
    window.localStorage.removeItem('researchhub.language')
    render(<App />)
    expect(await screen.findByRole('heading', { name: '从一个研究问题开始' })).toBeTruthy()
    expect(document.documentElement.lang).toBe('zh-CN')
    fireEvent.click(screen.getByRole('button', { name: '设置' }))
    fireEvent.click(screen.getByRole('button', { name: 'English' }))
    expect(await screen.findByRole('heading', { name: 'Start with a research question' })).toBeTruthy()
    expect(window.localStorage.getItem('researchhub.language')).toBe('en')
    expect(document.documentElement.lang).toBe('en')
  })

  it('keeps the language switch usable when localStorage writes are unavailable', async () => {
    window.localStorage.removeItem('researchhub.language')
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage disabled') })
    render(<App />)
    expect(await screen.findByRole('heading', { name: '从一个研究问题开始' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '设置' }))
    expect(() => fireEvent.click(screen.getByRole('button', { name: 'English' }))).not.toThrow()
    expect(await screen.findByRole('heading', { name: 'Start with a research question' })).toBeTruthy()
    expect(document.documentElement.lang).toBe('en')
    storageWrite.mockRestore()
  })

  it('changes the global model and mounted Knowledge Base, then refreshes bootstrap state', async () => {
    let chosenModel = { provider: 'zhipu-openapi', modelId: 'glm-5.3-flash' }
    let chosenKb: string | undefined = 'kb-old'
    const calls: string[] = []
    const currentSettings = () => ({ revision: calls.filter((path) => path.startsWith('POST /api/settings')).length + 1, model: chosenModel, models: [{ provider: 'zhipu-openapi', modelId: 'glm-5.3-flash', name: 'GLM 5.3 Flash', available: true }, { provider: 'openai-codex', modelId: 'gpt-6-luna', name: 'GPT-6 Luna', available: true }], ...(chosenKb ? { knowledgeBase: { knowledgeBaseId: chosenKb, rootRef: 'root:kb', revision: 4, status: 'active', schemaVersion: '0.4', storageFormatVersion: '1', counts: {} } } : {}), knowledgeBases: ['kb-old', 'kb-new'].map((knowledgeBaseId) => ({ knowledgeBaseId, schemaVersion: '0.4', status: 'active', revision: 4 })) })
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input); const method = init?.method ?? 'GET'; calls.push(`${method} ${path}`)
      if (path === '/api/bootstrap') return json({ runtime: { origin: 'http://127.0.0.1:1234', runtimeToken: 'b'.repeat(64) }, origin: 'http://127.0.0.1:1234', session: { conversationId: 'c1', isStreaming: false, isIdle: true, pendingMessageCount: 0, thinkingLevel: 'off' }, conversations: [], ...(chosenKb ? { knowledgeBase: { knowledgeBaseId: chosenKb, rootRef: 'root:kb', revision: 4, status: 'active', schemaVersion: '0.4', storageFormatVersion: '1', counts: {} } } : {}) })
      if (path === '/api/settings' && method === 'GET') return json(currentSettings())
      if (path === '/api/settings/model') { chosenModel = JSON.parse(String(init?.body)) as typeof chosenModel; return json(currentSettings()) }
      if (path === '/api/settings/knowledge-base') { chosenKb = (JSON.parse(String(init?.body)) as { knowledgeBaseId?: string }).knowledgeBaseId; return json(currentSettings()) }
      if (path === '/api/research/workflows') return json({ workflows: [] })
      if (path === '/api/conversations/current') return json({ conversationId: 'c1', isStreaming: false, isIdle: true, pendingMessageCount: 0, thinkingLevel: 'off' })
      if (path === '/api/conversations/messages') return json({ conversationId: 'c1', messages: [] })
      if (path === '/api/conversations') return json({ conversations: [] })
      return json({ code: 'not_found', error: 'not found' }, 404)
    }) as typeof fetch
    render(<App />)
    const modelSelect = await screen.findByRole('combobox', { name: 'Global model' })
    fireEvent.change(modelSelect, { target: { value: 'openai-codex/gpt-6-luna' } })
    await waitFor(() => expect((screen.getByRole('combobox', { name: 'Global model' }) as HTMLSelectElement).value).toBe('openai-codex/gpt-6-luna'))
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Knowledge Base management' }))
    fireEvent.click(screen.getByRole('button', { name: 'Mount' }))
    await waitFor(() => expect(document.body.textContent).toContain('kb-new'))
    expect(calls.filter((path) => path === 'GET /api/bootstrap')).toHaveLength(3)
    expect(calls).toContain('POST /api/settings/model')
    expect(calls).toContain('POST /api/settings/knowledge-base')
  })

  it('loads conversation UI in no-KB mode without rendering the runtime token', async () => {
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Research conversation', level: 1 })).toBeTruthy()
    expect(screen.getAllByText(/No Knowledge Base mounted/).length).toBeGreaterThan(0)
    expect(screen.queryByRole('region', { name: 'Daily Intelligence' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Theme scope changes' })).toBeNull()
    expect(document.body.textContent).not.toContain('b'.repeat(64))
  })

  it('keeps the Research draft while Reviews owns the review sections', async () => {
    render(<App />)
    const composer = await screen.findByRole('textbox', { name: 'Message' })
    fireEvent.change(composer, { target: { value: 'Keep this draft across routes' } })
    fireEvent.click(screen.getByRole('link', { name: 'Reviews' }))
    expect(await screen.findByRole('heading', { name: 'Review Inbox' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Review cases' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Theme Framework reviews' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Theme scope changes' })).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: 'Research' }))
    expect((await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement).value).toBe('Keep this draft across routes')
    expect(screen.queryByRole('heading', { name: 'Theme scope changes' })).toBeNull()
  })

  it('dispatches a named Theme Framework workflow and reviews only server candidates', async () => {
    const calls: { path: string; init?: RequestInit }[] = []
    let themeCommitted = false
    const candidate = {
      knowledgeBaseId: 'kb-1', basedOnRevision: 7, theme: { name: 'AI 算力' },
      framework: {
        proposedDefinition: { statement: 'AI compute infrastructure and its material supply chain', status: 'provisional' },
        inclusionPrinciples: ['Include researchable supply-chain industries'], exclusionPrinciples: ['Exclude remote downstream end markets'],
        industryCandidates: [{ candidateId: 'pcb', name: 'PCB', description: 'Printed circuit boards', recommendation: 'include', boundaryRationale: 'Core upstream material', themeRelevanceRationale: 'Enables compute systems', evidenceRefs: ['ev-1'], coverageGaps: ['Confirm substrate depth'] }],
        relationCandidates: [{ candidateId: 'pcb-server', sourceIndustryRef: 'PCB', targetIndustryRef: 'AI servers', relationType: 'upstream_of', topologyRole: 'main_chain', recommendation: 'pending', boundaryRationale: 'Direct supply-chain connection', themeRelevanceRationale: 'Relevant to compute delivery', directionRationale: 'PCB supplies server boards', evidenceRefs: ['ev-1'], coverageGaps: [] }],
        coverageGaps: [{ gapId: 'gap-1', question: 'Should copper foil be included?', reason: 'Boundary needs review', affectedCandidateIds: ['pcb'] }],
      }, acquisitionStatus: 'partial', diagnostics: [], evidence: [{ evidenceId: 'ev-1', summary: 'Industry report describes PCB demand from AI servers.', sourceRef: 'source:report-1' }],
    }
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input); calls.push({ path, init })
      if (path === '/api/bootstrap') return json({ runtime: { origin: 'http://127.0.0.1:1234', runtimeToken: 'b'.repeat(64) }, origin: 'http://127.0.0.1:1234', session: { conversationId: 'c1', isStreaming: false, isIdle: true, pendingMessageCount: 0, thinkingLevel: 'off' }, conversations: [], knowledgeBase: { knowledgeBaseId: 'kb-1', rootRef: 'root:kb', revision: 7, status: 'active', schemaVersion: '0.4', storageFormatVersion: '1', counts: {} } })
      if (path === '/api/research/workflows') return json({ workflows: [{ id: 'theme_framework', label: 'Theme Framework', intentDescription: 'Initialize an industry network', inputSchema: {}, requiredInputs: ['name'], outputContract: 'ThemeFrameworkReviewCandidate', knowledgeEffects: ['Theme', 'Industry', 'Relation'] }] })
      if (path === '/api/conversations/current') return json({ conversationId: 'c1', isStreaming: false, isIdle: true, pendingMessageCount: 0, thinkingLevel: 'off' })
      if (path === '/api/conversations/messages') return json({ conversationId: 'c1', messages: [] })
      if (path === '/api/conversations') return json({ conversations: [] })
      if (path === '/api/daily-briefs?limit=20') return json({ briefs: [] })
      if (path === '/api/research-reports?limit=20') return json({ reports: [] })
      if (path === '/api/research/dispatch') return json({ accepted: true, status: 'started', request: { query: 'AI 算力', mode: { type: 'workflow', workflowId: 'theme_framework' }, contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: false } }, decision: { mode: 'workflow', workflow: { id: 'theme_framework', confidence: 1, arguments: { name: 'AI 算力' } }, skills: [], entities: [], missingRequiredInputs: [], contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: false }, rationale: 'Explicit workflow selection' }, summary: { mode: 'Explicit Workflow', workflowId: 'theme_framework', workflowLabel: 'Theme Framework', selectedSkillIds: [], argumentsStatus: 'extracted', argumentKeys: ['name'], contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: false } }, runId: 'theme-run-1', workflow: { runId: 'theme-run-1', workflowType: 'theme_framework_construction', objective: 'Initialize AI 算力', status: 'running', startedAt: '2026-10-03T00:00:00.000Z', updatedAt: '2026-10-03T00:00:00.000Z' } }, 202)
      if (path === '/api/theme-framework/runs/theme-run-1') return json({ status: themeCommitted ? 'committed' : 'awaiting_review', workflowRunId: 'theme-run-1', candidate, ...(themeCommitted ? { receipt: { themeRef: 'entity:theme-ai-compute', committedRevision: 8, decisionCount: 2 } } : {}) })
      if (path === '/api/theme-framework/runs/theme-run-1/accept') { themeCommitted = true; return json({ status: 'committed', workflowRunId: 'theme-run-1', themeRef: 'entity:theme-ai-compute' }) }
      if (path === '/api/workflows/theme-run-1') return json({ runId: 'theme-run-1', workflowType: 'theme_framework_construction', objective: 'Initialize AI 算力', status: 'completed', startedAt: '2026-10-03T00:00:00.000Z', updatedAt: '2026-10-03T00:00:01.000Z' })
      return json({ code: 'not_found', error: 'not found' }, 404)
    }) as typeof fetch
    render(<App />)
    fireEvent.change(await screen.findByRole('combobox', { name: 'Workflow' }), { target: { value: 'theme_framework' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'AI 算力' } })
    fireEvent.click(screen.getByRole('button', { name: /Send/ }))
    expect(screen.queryByRole('heading', { name: 'Industry framework' })).toBeNull()
    await openReviewsSection('Theme Framework reviews')
    expect(await screen.findByRole('heading', { name: 'Industry framework' })).toBeTruthy()
    expect(await screen.findByText('PCB')).toBeTruthy()
    expect(screen.getByText(/Should copper foil be included/)).toBeTruthy()
    expect(screen.getAllByText(/Industry report describes PCB demand/).length).toBe(2)
    expect(screen.getByText(/Some sources were unavailable or the research scope was truncated/)).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Exclude' })[0]!)
    fireEvent.click(screen.getByRole('button', { name: 'Accept framework decisions' }))
    expect(await screen.findByText(/Add a reason for every decision that differs from the recommendation/)).toBeTruthy()
    expect(calls.some((call) => call.path.endsWith('/accept'))).toBe(false)
    fireEvent.change(screen.getByRole('textbox', { name: 'Reason for changing recommendation for PCB' }), { target: { value: 'Include wafer manufacturing when the evidence supports its role in the AI compute supply chain.' } })
    expect(screen.getByRole('textbox', { name: 'Reason for changing recommendation for PCB' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Accept framework decisions' }))
    await waitFor(() => expect(screen.getByText('Theme framework accepted and saved.')).toBeTruthy())
    const dispatch = calls.find((call) => call.path === '/api/research/dispatch')
    expect(JSON.parse(String(dispatch?.init?.body))).toMatchObject({ query: 'AI 算力', mode: { type: 'workflow', workflowId: 'theme_framework' } })
    const accept = calls.find((call) => call.path.endsWith('/accept'))
    expect(JSON.parse(String(accept?.init?.body))).toEqual({ decisions: { pcb: 'exclude', 'pcb-server': 'pending' }, decisionRationales: { pcb: 'Include wafer manufacturing when the evidence supports its role in the AI compute supply chain.' } })
    expect(new Headers(calls.find((call) => call.path.includes('/theme-framework/runs/theme-run-1'))?.init?.headers).get('X-ResearchHub-Runtime-Token')).toBe('b'.repeat(64))
    expect(JSON.stringify(JSON.parse(String(dispatch?.init?.body)))).not.toContain('evidence')
  })

  it('clears decision drafts on a review run switch while preserving them for the current run', async () => {
    const currentCandidate = {
      knowledgeBaseId: 'kb-1', basedOnRevision: 7, theme: { name: 'AI Compute' },
      framework: { proposedDefinition: { statement: 'Compute infrastructure', status: 'provisional' }, inclusionPrinciples: [], exclusionPrinciples: [], industryCandidates: [{ candidateId: 'pcb', name: 'PCB', recommendation: 'include', boundaryRationale: 'Material input', relevanceRationale: 'Supports compute equipment', evidenceRefs: [], coverageGaps: [] }], relationCandidates: [], coverageGaps: [] },
      acquisitionStatus: 'complete', diagnostics: [], evidence: [],
    }
    const savedCandidate = {
      ...currentCandidate,
      framework: { ...currentCandidate.framework, industryCandidates: [{ candidateId: 'data-centers', name: 'Data centers', recommendation: 'pending', boundaryRationale: 'Infrastructure branch', relevanceRationale: 'Hosts compute equipment', evidenceRefs: [], coverageGaps: [] }] },
    }
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path === '/api/bootstrap') return json({ runtime: { origin: 'http://127.0.0.1:1234', runtimeToken: 'b'.repeat(64) }, origin: 'http://127.0.0.1:1234', session: { conversationId: 'c1', isStreaming: false, isIdle: true, pendingMessageCount: 0, thinkingLevel: 'off' }, conversations: [], knowledgeBase: { knowledgeBaseId: 'kb-1', rootRef: 'root:kb', revision: 7, status: 'active', schemaVersion: '0.4', storageFormatVersion: '1', counts: {} } })
      if (path === '/api/research/workflows') return json({ workflows: [{ id: 'theme_framework', label: 'Theme Framework', intentDescription: 'Initialize an industry network', inputSchema: {}, requiredInputs: ['name'], outputContract: 'ThemeFrameworkReviewCandidate', knowledgeEffects: ['Theme', 'Industry', 'Relation'] }] })
      if (path === '/api/conversations/current') return json({ conversationId: 'c1', isStreaming: false, isIdle: true, pendingMessageCount: 0, thinkingLevel: 'off' })
      if (path === '/api/conversations/messages') return json({ conversationId: 'c1', messages: [] })
      if (path === '/api/conversations') return json({ conversations: [] })
      if (path === '/api/daily-briefs?limit=20') return json({ briefs: [] })
      if (path === '/api/research-reports?limit=20') return json({ reports: [] })
      if (path === '/api/theme-framework/reviews?limit=50') return json({ items: [{ runId: 'current-run', themeName: 'AI Compute', basedOnRevision: 7, status: 'awaiting_review' }, { runId: 'saved-run', themeName: 'AI Compute', basedOnRevision: 7, status: 'awaiting_review' }], total: 2, truncated: false })
      if (path === '/api/theme-framework/runs/current-run') return json({ status: 'awaiting_review', workflowRunId: 'current-run', candidate: currentCandidate })
      if (path === '/api/theme-framework/runs/saved-run') return json({ status: 'awaiting_review', workflowRunId: 'saved-run', candidate: savedCandidate })
      if (path === '/api/theme-scope-impact?limit=50') return json({ items: [], total: 0, truncated: false })
      if (path === '/api/research/dispatch') return json({ accepted: true, status: 'started', request: { query: 'AI Compute', mode: { type: 'workflow', workflowId: 'theme_framework' }, contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: false } }, decision: { mode: 'workflow', workflow: { id: 'theme_framework', confidence: 1, arguments: { name: 'AI Compute' } }, skills: [], entities: [], missingRequiredInputs: [], contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: false }, rationale: 'Explicit workflow selection' }, summary: { mode: 'Explicit Workflow', workflowId: 'theme_framework', workflowLabel: 'Theme Framework', selectedSkillIds: [], argumentsStatus: 'extracted', argumentKeys: ['name'], contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: false } }, runId: 'current-run', workflow: { runId: 'current-run', workflowType: 'theme_framework_construction', objective: 'Initialize AI Compute', status: 'running', startedAt: '2026-10-03T00:00:00.000Z', updatedAt: '2026-10-03T00:00:00.000Z' } }, 202)
      return json({ code: 'not_found', error: 'not found' }, 404)
    }) as typeof fetch
    render(<App />)
    fireEvent.change(await screen.findByRole('combobox', { name: 'Workflow' }), { target: { value: 'theme_framework' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Initialize AI Compute' } })
    fireEvent.click(screen.getByRole('button', { name: /Send/ }))
    await openReviewsSection('Theme Framework reviews')
    expect(await screen.findByText('PCB')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Exclude' }))
    const reason = await screen.findByRole('textbox', { name: 'Reason for changing recommendation for PCB' })
    fireEvent.change(reason, { target: { value: 'Keep PCB out until boundary evidence is stronger.' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Review open' }))
    expect((screen.getByRole('textbox', { name: 'Reason for changing recommendation for PCB' }) as HTMLTextAreaElement).value).toBe('Keep PCB out until boundary evidence is stronger.')
    fireEvent.click(screen.getByRole('button', { name: 'Resume review' }))
    expect(await screen.findByRole('heading', { name: 'Data centers' })).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'Reason for changing recommendation for PCB' })).toBeNull()
    expect(screen.queryByText('exclude')).toBeNull()
    expect(screen.getByRole('button', { name: 'Pending' }).className).toContain('selected')
  })

  it('shows the Theme Framework review when automatic dispatch routes the query there', async () => {
    const calls: { path: string; init?: RequestInit }[] = []
    const candidate = {
      knowledgeBaseId: 'kb-1', basedOnRevision: 7, theme: { name: 'AI Compute' },
      framework: { proposedDefinition: { statement: 'Compute infrastructure', status: 'provisional' }, inclusionPrinciples: [], exclusionPrinciples: [], industryCandidates: [], relationCandidates: [], coverageGaps: [] },
      acquisitionStatus: 'complete', diagnostics: [], evidence: [],
    }
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input); calls.push({ path, init })
      if (path === '/api/bootstrap') return json({ runtime: { origin: 'http://127.0.0.1:1234', runtimeToken: 'b'.repeat(64) }, origin: 'http://127.0.0.1:1234', session: { conversationId: 'c1', isStreaming: false, isIdle: true, pendingMessageCount: 0, thinkingLevel: 'off' }, conversations: [], knowledgeBase: { knowledgeBaseId: 'kb-1', rootRef: 'root:kb', revision: 7, status: 'active', schemaVersion: '0.4', storageFormatVersion: '1', counts: {} } })
      if (path === '/api/research/workflows') return json({ workflows: [{ id: 'theme_framework', label: 'Theme Framework', intentDescription: 'Initialize an industry network', inputSchema: {}, requiredInputs: ['name'], outputContract: 'ThemeFrameworkReviewCandidate', knowledgeEffects: ['Theme', 'Industry', 'Relation'] }] })
      if (path === '/api/conversations/current') return json({ conversationId: 'c1', isStreaming: false, isIdle: true, pendingMessageCount: 0, thinkingLevel: 'off' })
      if (path === '/api/conversations/messages') return json({ conversationId: 'c1', messages: [] })
      if (path === '/api/conversations') return json({ conversations: [] })
      if (path === '/api/daily-briefs?limit=20') return json({ briefs: [] })
      if (path === '/api/research-reports?limit=20') return json({ reports: [] })
      if (path === '/api/research/dispatch') return json({ accepted: true, status: 'started', request: { query: 'AI compute', mode: { type: 'free_research' }, contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: false } }, decision: { mode: 'workflow', workflow: { id: 'theme_framework', confidence: 0.94, arguments: { name: 'AI Compute' } }, skills: [], entities: [], missingRequiredInputs: [], contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: false }, rationale: 'Detected a Theme initialization request' }, summary: { mode: 'Explicit Workflow', workflowId: 'theme_framework', workflowLabel: 'Theme Framework', selectedSkillIds: [], argumentsStatus: 'extracted', argumentKeys: ['name'], contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: false } }, runId: 'theme-auto-run', workflow: { runId: 'theme-auto-run', workflowType: 'theme_framework_construction', objective: 'Initialize AI Compute', status: 'running', startedAt: '2026-10-03T00:00:00.000Z', updatedAt: '2026-10-03T00:00:00.000Z' } }, 202)
      if (path === '/api/theme-framework/runs/theme-auto-run') return json({ status: 'awaiting_review', workflowRunId: 'theme-auto-run', candidate })
      return json({ code: 'not_found', error: 'not found' }, 404)
    }) as typeof fetch
    render(<App />)
    fireEvent.change(await screen.findByRole('textbox', { name: 'Message' }), { target: { value: 'Initialize the AI compute theme' } })
    fireEvent.click(screen.getByRole('button', { name: /Send/ }))
    await openReviewsSection('Theme Framework reviews')
    expect(await screen.findByRole('heading', { name: 'Industry framework' })).toBeTruthy()
    expect(await screen.findByRole('heading', { name: 'AI Compute' })).toBeTruthy()
    expect(screen.getByText('Accepting these decisions will write the Theme framework to the Knowledge Base.')).toBeTruthy()
    const dispatch = calls.find((call) => call.path === '/api/research/dispatch')
    expect(JSON.parse(String(dispatch?.init?.body))).toMatchObject({ mode: { type: 'free_research' } })
  })

  it('refreshes a stale Theme Framework candidate into a new review without accepting it', async () => {
    const calls: { path: string; init?: RequestInit }[] = []
    const candidate = {
      knowledgeBaseId: 'kb-1', basedOnRevision: 7, theme: { name: 'AI Compute' },
      framework: { proposedDefinition: { statement: 'Compute infrastructure', status: 'provisional' }, inclusionPrinciples: [], exclusionPrinciples: [], industryCandidates: [{ candidateId: 'pcb', name: 'PCB', recommendation: 'include', boundaryRationale: 'Material input', relevanceRationale: 'Supports compute equipment', evidenceRefs: [], coverageGaps: [] }], relationCandidates: [], coverageGaps: [] },
      acquisitionStatus: 'complete', diagnostics: [], evidence: [],
    }
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input); calls.push({ path, init })
      if (path === '/api/bootstrap') return json({ runtime: { origin: 'http://127.0.0.1:1234', runtimeToken: 'b'.repeat(64) }, origin: 'http://127.0.0.1:1234', session: { conversationId: 'c1', isStreaming: false, isIdle: true, pendingMessageCount: 0, thinkingLevel: 'off' }, conversations: [], knowledgeBase: { knowledgeBaseId: 'kb-1', rootRef: 'root:kb', revision: 8, status: 'active', schemaVersion: '0.4', storageFormatVersion: '1', counts: {} } })
      if (path === '/api/conversations/current') return json({ conversationId: 'c1', isStreaming: false, isIdle: true, pendingMessageCount: 0, thinkingLevel: 'off' })
      if (path === '/api/conversations/messages') return json({ conversationId: 'c1', messages: [] })
      if (path === '/api/conversations') return json({ conversations: [] })
      if (path === '/api/daily-briefs?limit=20') return json({ briefs: [] })
      if (path === '/api/research-reports?limit=20') return json({ reports: [] })
      if (path === '/api/research/workflows') return json({ workflows: [{ id: 'theme_framework', label: 'Theme Framework', intentDescription: 'Initialize an industry network', inputSchema: {}, requiredInputs: ['name'], outputContract: 'ThemeFrameworkReviewCandidate', knowledgeEffects: ['Theme', 'Industry', 'Relation'] }] })
      if (path === '/api/theme-framework/reviews?limit=50') return json({ items: [], total: 0, truncated: false })
      if (path === '/api/theme-scope-impact?limit=50') return json({ items: [], total: 0, truncated: false })
      if (path === '/api/research/dispatch') return json({ accepted: true, status: 'started', request: { query: 'AI Compute', mode: { type: 'workflow', workflowId: 'theme_framework' }, contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: false } }, decision: { mode: 'workflow', workflow: { id: 'theme_framework', confidence: 1, arguments: { name: 'AI Compute' } }, skills: [], entities: [], missingRequiredInputs: [], contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: false }, rationale: 'Explicit workflow selection' }, summary: { mode: 'Explicit Workflow', workflowId: 'theme_framework', workflowLabel: 'Theme Framework', selectedSkillIds: [], argumentsStatus: 'extracted', argumentKeys: ['name'], contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: false } }, runId: 'stale-run', workflow: { runId: 'stale-run', workflowType: 'theme_framework_construction', objective: 'Initialize AI Compute', status: 'running', startedAt: '2026-10-03T00:00:00.000Z', updatedAt: '2026-10-03T00:00:00.000Z' } }, 202)
      if (path === '/api/theme-framework/runs/stale-run') return json({ status: 'stale', workflowRunId: 'stale-run', candidate })
      if (path === '/api/theme-framework/runs/stale-run/refresh') return json({ status: 'awaiting_review', workflowRunId: 'fresh-run', refreshedFromRunId: 'stale-run', basedOnRevision: 8 })
      if (path === '/api/theme-framework/runs/fresh-run') return json({ status: 'awaiting_review', workflowRunId: 'fresh-run', candidate: { ...candidate, basedOnRevision: 8 } })
      if (path === '/api/workflows/stale-run') return json({ runId: 'stale-run', workflowType: 'theme_framework_construction', objective: 'Initialize AI Compute', status: 'completed', startedAt: '2026-10-03T00:00:00.000Z', updatedAt: '2026-10-03T00:00:01.000Z' })
      return json({ code: 'not_found', error: 'not found' }, 404)
    }) as typeof fetch
    render(<App />)
    fireEvent.change(await screen.findByRole('combobox', { name: 'Workflow' }), { target: { value: 'theme_framework' } })
    fireEvent.change(await screen.findByRole('textbox', { name: 'Message' }), { target: { value: 'initialize compute theme' } })
    fireEvent.click(screen.getByRole('button', { name: /Send/ }))
    await openReviewsSection('Theme Framework reviews')
    expect((await screen.findAllByText('stale')).length).toBeGreaterThan(0)
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh to current revision' }))
    expect(await screen.findByText(/From run stale-run · Knowledge revision 7 → 8/)).toBeTruthy()
    expect(screen.getByText(/does not include sources added after revision 7/)).toBeTruthy()
    expect(await screen.findByRole('heading', { name: 'AI Compute' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Accept framework decisions' })).toBeTruthy()
    expect(calls.some((call) => call.path.endsWith('/accept'))).toBe(false)
    const refreshCall = calls.find((call) => call.path.endsWith('/stale-run/refresh'))
    expect(refreshCall?.init?.method).toBe('POST')
    expect(JSON.parse(String(refreshCall?.init?.body))).toEqual({})
  })

  it('resumes a persisted refreshed Theme Framework review with its source revision after a fresh Chat mount', async () => {
    const calls: { path: string; init?: RequestInit }[] = []
    const candidate = {
      knowledgeBaseId: 'kb-1', basedOnRevision: 8, refresh: { refreshedFromRunId: 'original-theme-run', sourceBasedOnRevision: 7, targetRevision: 8, validationSummary: { writerReceipts: 1, sourceIds: ['source:added-source'], evidenceBindings: 2 }, refreshedAt: '2026-10-03T00:00:00.000Z' }, theme: { name: 'AI Compute' },
      framework: { proposedDefinition: { statement: 'Compute infrastructure', status: 'provisional' }, inclusionPrinciples: [], exclusionPrinciples: [], industryCandidates: [], relationCandidates: [], coverageGaps: [] },
      acquisitionStatus: 'complete', diagnostics: [], evidence: [],
    }
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input); calls.push({ path, init })
      if (path === '/api/bootstrap') return json({ runtime: { origin: 'http://127.0.0.1:1234', runtimeToken: 'b'.repeat(64) }, origin: 'http://127.0.0.1:1234', session: { conversationId: 'c1', isStreaming: false, isIdle: true, pendingMessageCount: 0, thinkingLevel: 'off' }, conversations: [], knowledgeBase: { knowledgeBaseId: 'kb-1', rootRef: 'root:kb', revision: 7, status: 'active', schemaVersion: '0.4', storageFormatVersion: '1', counts: {} } })
      if (path === '/api/research/workflows') return json({ workflows: [] })
      if (path === '/api/conversations/current') return json({ conversationId: 'c1', isStreaming: false, isIdle: true, pendingMessageCount: 0, thinkingLevel: 'off' })
      if (path === '/api/conversations/messages') return json({ conversationId: 'c1', messages: [] })
      if (path === '/api/conversations') return json({ conversations: [] })
      if (path === '/api/theme-framework/reviews?limit=50') return json({ items: [{ runId: 'saved-theme-run-3', themeName: 'AI Compute', basedOnRevision: 8, status: 'awaiting_review' }, { runId: 'saved-theme-run-2', themeName: 'AI Compute', basedOnRevision: 7, status: 'awaiting_review' }], total: 2, truncated: false })
      if (path.startsWith('/api/theme-framework/runs/saved-theme-run-')) return json({ status: 'awaiting_review', workflowRunId: path.split('/').at(-1), candidate })
      if (path === '/api/theme-scope-impact?limit=50') return json({ items: [], total: 0, truncated: false })
      return json({ code: 'not_found', error: 'not found' }, 404)
    }) as typeof fetch
    render(<App />)
    fireEvent.click(await screen.findByRole('link', { name: 'Reviews' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Theme Framework reviews' }))
    await waitFor(() => expect(screen.getByRole('region', { name: 'Theme Framework review history' }).textContent).toContain('theme-run-3'))
    const reviewList = screen.getByRole('region', { name: 'Theme Framework review history' }).textContent ?? ''
    expect(reviewList).toContain('theme-run-2')
    expect(reviewList.indexOf('theme-run-3')).toBeLessThan(reviewList.indexOf('theme-run-2'))
    const resumeButtons = await screen.findAllByRole('button', { name: 'Resume review' })
    fireEvent.click(resumeButtons[0]!)
    expect(await screen.findByRole('heading', { name: 'Industry framework' })).toBeTruthy()
    expect(await screen.findByRole('heading', { name: 'AI Compute' })).toBeTruthy()
    expect(await screen.findByText(/From run original-theme-run · Knowledge revision 7 → 8/)).toBeTruthy()
    expect(screen.getByText(/does not include sources added after revision 7/)).toBeTruthy()
    const inboxCall = calls.find((call) => call.path === '/api/theme-framework/reviews?limit=50')
    expect(inboxCall).toBeTruthy()
    expect(new Headers(inboxCall?.init?.headers).get('X-ResearchHub-Runtime-Token')).toBe('b'.repeat(64))
    const detail = calls.find((call) => call.path === '/api/theme-framework/runs/saved-theme-run-3')
    expect(detail).toBeTruthy()
    expect(new Headers(detail?.init?.headers).get('X-ResearchHub-Runtime-Token')).toBe('b'.repeat(64))
    expect(calls.some((call) => call.path === '/api/theme-framework/start')).toBe(false)
  })

  it('stages a pasted source, requires caller-supplied rights, and only accepts explicitly selected V0.4 candidates', async () => {
    const posted: { path: string; body?: Record<string, unknown> }[] = []
    mockV04UploadRuntime(async (input, init) => {
      const path = String(input)
      const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : undefined
      posted.push({ path, body })
      if (path === '/api/attachments') return json({ attachment: { attachmentId: 'attachment-1', filename: 'annual-report.pdf', mediaType: 'application/pdf', size: 1024, sha256: 'c'.repeat(64), createdAt: '2026-10-02T00:00:00.000Z' } }, 201)
      if (path === '/api/production/raw-document-preview-v04') return json({ accepted: true, runId: 'preview-1', committable: false, workflow: { runId: 'preview-1', workflowType: 'raw_document_knowledge_v04', objective: 'Preview source', status: 'running', startedAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z' } }, 202)
      if (path === '/api/production/raw-document-preview-v04/preview-1') return json({ runId: 'preview-1', workflow: { runId: 'preview-1', workflowType: 'raw_document_knowledge_v04', objective: 'Preview source', status: 'completed', startedAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-10-02T00:00:01.000Z' }, preview: v04Preview, committable: true })
      if (path === '/api/production/raw-document-preview-v04/accept') return json({ status: 'committed', knowledgeBaseId: 'kb-1', knowledgeBaseRevision: 8, baseRevision: 7, previewWorkflowRunId: 'preview-1', extractionCompleteness: 'complete', acceptedCandidateIds: ['candidate-claim-1'], createdIds: ['claim:revenue-growth'], updatedIds: [], errors: [] })
      if (path === '/api/workflows/preview-1') return json({ runId: 'preview-1', workflowType: 'raw_document_knowledge_v04', objective: 'Preview source', status: 'completed', startedAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-10-02T00:00:01.000Z' })
      return json({ code: 'not_found', error: 'not found' }, 404)
    })
    render(<App />)
    const file = new File(['annual filing content'], 'annual-report.pdf', { type: 'application/pdf' })
    fireEvent.paste(await screen.findByRole('textbox', { name: 'Message' }), { clipboardData: { files: [file] } })
    expect(await screen.findByText('annual-report.pdf')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Write Knowledge' }))
    fireEvent.change(screen.getByLabelText('Source title'), { target: { value: 'Annual report' } })
    fireEvent.change(screen.getByLabelText(/Policy basis/), { target: { value: 'Publisher terms permit research use' } })
    expect((screen.getByRole('checkbox', { name: 'Raw retention is allowed' }) as HTMLInputElement).checked).toBe(false)
    fireEvent.click(screen.getByRole('checkbox', { name: 'I checked the provider terms' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Raw retention is allowed' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'AI processing is allowed' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Derived Knowledge is allowed' }))
    fireEvent.click(screen.getByRole('button', { name: 'Extract candidates for review' }))
    expect(await screen.findByText('candidate-claim-1')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Accept 0 selected' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select claim candidate' }))
    fireEvent.click(screen.getByRole('button', { name: 'Accept 1 selected' }))
    expect(await screen.findByText('committed')).toBeTruthy()
    const previewPost = posted.find((request) => request.path === '/api/production/raw-document-preview-v04')
    expect(previewPost?.body?.sourceMetadata).toMatchObject({ title: 'Annual report' })
    expect(previewPost?.body?.rights).toMatchObject({ providerTermsKnown: true, retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false, policyBasis: 'Publisher terms permit research use' })
    const acceptancePost = posted.find((request) => request.path === '/api/production/raw-document-preview-v04/accept')
    expect(acceptancePost?.body).toMatchObject({ previewWorkflowRunId: 'preview-1', acceptedCandidateIds: ['candidate-claim-1'] })
  })

  it('keeps candidates hidden while a durable snapshot is noncommittable and accepts a verified read-back without Workflow status', async () => {
    let previewReads = 0
    let releaseTerminalPreview: (response: Response) => void = () => undefined
    const running = { runId: 'preview-race', workflowType: 'raw_document_knowledge_preview_v04', objective: 'Preview source', status: 'running', startedAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z' }
    const earlyPreview = {
      ...v04Preview,
      runId: 'preview-race',
      status: 'stale_revision' as const,
      committable: false,
      candidateGroups: [{ ...v04Preview.candidateGroups[0]!, candidateId: 'candidate-premature' }],
    }
    mockV04UploadRuntime(async (input) => {
      const path = String(input)
      if (path === '/api/attachments') return json({ attachment: { attachmentId: 'attachment-race', filename: 'race.pdf', mediaType: 'application/pdf', size: 16, sha256: 'e'.repeat(64), createdAt: '2026-10-02T00:00:00.000Z' } }, 201)
      if (path === '/api/production/raw-document-preview-v04') return json({ accepted: true, runId: 'preview-race', committable: false, workflow: running }, 202)
      if (path === '/api/production/raw-document-preview-v04/preview-race') {
        previewReads += 1
        if (previewReads === 1) return json({ runId: 'preview-race', workflow: running, preview: earlyPreview, committable: false })
        return new Promise<Response>((resolve) => { releaseTerminalPreview = resolve })
      }
      if (path === '/api/workflows/preview-race') return json(running)
      return json({ code: 'not_found', error: 'not found' }, 404)
    })
    render(<App />)
    const message = await screen.findByRole('textbox', { name: 'Message' })
    fireEvent.paste(message, { clipboardData: { files: [new File(['source'], 'race.pdf', { type: 'application/pdf' })] } })
    await screen.findByText('race.pdf')
    fireEvent.click(screen.getByRole('button', { name: 'Write Knowledge' }))
    fireEvent.change(screen.getByLabelText('Source title'), { target: { value: 'Race source' } })
    fireEvent.change(screen.getByLabelText(/Policy basis/), { target: { value: 'User supplied rights basis' } })
    fireEvent.click(screen.getByRole('button', { name: 'Extract candidates for review' }))

    await waitFor(() => expect(previewReads).toBe(1))
    await new Promise((resolve) => window.setTimeout(resolve, 30))
    expect(screen.queryByText('candidate-premature')).toBeNull()
    await waitFor(() => expect(previewReads).toBe(2), { timeout: 2500 })
    expect(screen.queryByText('candidate-premature')).toBeNull()

    releaseTerminalPreview(json({ runId: 'preview-race', preview: { ...v04Preview, runId: 'preview-race' }, committable: true }))
    expect(await screen.findByText('candidate-claim-1')).toBeTruthy()
    expect(screen.queryByText('candidate-premature')).toBeNull()
  })

  it('stops polling after the bounded wait and reports that the Workflow is still running', async () => {
    let previewReads = 0
    let notifyPollLimitReached!: () => void
    const pollLimitReached = new Promise<void>((resolve) => { notifyPollLimitReached = resolve })
    const running = { runId: 'preview-timeout', workflowType: 'raw_document_knowledge_preview_v04', objective: 'Preview source', status: 'running', startedAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z' }
    mockV04UploadRuntime(async (input) => {
      const path = String(input)
      if (path === '/api/attachments') return json({ attachment: { attachmentId: 'attachment-timeout', filename: 'timeout.pdf', mediaType: 'application/pdf', size: 16, sha256: 'f'.repeat(64), createdAt: '2026-10-02T00:00:00.000Z' } }, 201)
      if (path === '/api/production/raw-document-preview-v04') return json({ accepted: true, runId: 'preview-timeout', committable: false, workflow: running }, 202)
      if (path === '/api/production/raw-document-preview-v04/preview-timeout') { previewReads += 1; if (previewReads === 120) notifyPollLimitReached(); return json({ runId: 'preview-timeout', committable: false }) }
      if (path === '/api/workflows/preview-timeout') return json({ ...running, status: 'completed' })
      return json({ code: 'not_found', error: 'not found' }, 404)
    })
    render(<App />)
    const message = await screen.findByRole('textbox', { name: 'Message' })
    fireEvent.paste(message, { clipboardData: { files: [new File(['source'], 'timeout.pdf', { type: 'application/pdf' })] } })
    await screen.findByText('timeout.pdf')
    fireEvent.click(screen.getByRole('button', { name: 'Write Knowledge' }))
    fireEvent.change(screen.getByLabelText('Source title'), { target: { value: 'Timeout source' } })
    fireEvent.change(screen.getByLabelText(/Policy basis/), { target: { value: 'User supplied rights basis' } })

    const realSetTimeout = window.setTimeout.bind(window)
    const timerSpy = vi.spyOn(window, 'setTimeout').mockImplementation(((handler: TimerHandler, timeout?: number, ...args: unknown[]) => realSetTimeout(handler, timeout === 1000 ? 0 : timeout, ...args)) as typeof window.setTimeout)
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Extract candidates for review' }))
      await pollLimitReached
      await new Promise((resolve) => realSetTimeout(resolve, 0))
      expect(previewReads).toBe(120)
      expect(document.body.textContent).toContain('Preview is still running. Check the Workflow panel for its current status.')
    } finally {
      timerSpy.mockRestore()
    }
  })

  it('accepts document drops on the Chat composer and rejects unsupported files', async () => {
    const mock = vi.fn(async (input: RequestInfo | URL) => String(input) === '/api/attachments'
      ? json({ attachment: { attachmentId: 'attachment-2', filename: 'notes.md', mediaType: 'text/markdown', size: 18, sha256: 'd'.repeat(64), createdAt: '2026-10-02T00:00:00.000Z' } }, 201)
      : json({ code: 'not_found', error: 'not found' }, 404))
    mockV04UploadRuntime(mock)
    render(<App />)
    await screen.findByRole('textbox', { name: 'Message' })
    const composer = document.querySelector('.composer-wrap')
    if (!composer) throw new Error('Composer not found')
    fireEvent.drop(composer, { dataTransfer: { files: [new File(['notes'], 'notes.md', { type: 'text/markdown' })], types: ['Files'] } })
    expect(await screen.findByText('notes.md')).toBeTruthy()
    fireEvent.drop(composer, { dataTransfer: { files: [new File(['binary'], 'archive.zip', { type: 'application/zip' })], types: ['Files'] } })
    expect(await screen.findByText(/Unsupported file/)).toBeTruthy()
    expect(mock.mock.calls.filter(([input]) => String(input) !== '/api/settings')).toHaveLength(1)
  })

  it('rejects files above the upload limit before staging them', async () => {
    const mock = vi.fn(async (_input: RequestInfo | URL) => json({ code: 'not_found', error: 'not found' }, 404))
    mockV04UploadRuntime(mock)
    render(<App />)
    await screen.findByRole('textbox', { name: 'Message' })
    const oversized = new File(['x'], 'large.pdf', { type: 'application/pdf' })
    Object.defineProperty(oversized, 'size', { value: 100 * 1024 * 1024 + 1 })
    fireEvent.change(screen.getByLabelText('Add document'), { target: { files: [oversized] } })
    expect(await screen.findByText('File exceeds the 100 MB upload limit.')).toBeTruthy()
    expect(mock.mock.calls.filter(([input]) => String(input) !== '/api/settings')).toHaveLength(0)
  })

  it('uses the compact composer picker, preserves staged files when cancelled, and clears explicitly', async () => {
    const uploaded = vi.fn(async () => json({ attachment: { attachmentId: 'attachment-picker', filename: 'picked.pdf', mediaType: 'application/pdf', size: 12, sha256: 'e'.repeat(64), createdAt: '2026-10-02T00:00:00.000Z' } }, 201))
    mockV04UploadRuntime(async (input) => String(input) === '/api/attachments' ? uploaded() : json({ code: 'not_found', error: 'not found' }, 404))
    render(<App />)
    await screen.findByRole('textbox', { name: 'Message' })
    expect(screen.queryByRole('region', { name: 'Knowledge upload' })).toBeNull()
    const picker = screen.getByLabelText('Add document') as HTMLInputElement
    fireEvent.change(picker, { target: { files: [new File(['pdf'], 'picked.pdf', { type: 'application/pdf' })] } })
    expect(await screen.findByText('picked.pdf')).toBeTruthy()
    fireEvent.change(picker, { target: { files: [] } })
    expect(screen.getByText('picked.pdf')).toBeTruthy()
    expect(uploaded).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Remove attachment' }))
    expect(screen.queryByText('picked.pdf')).toBeNull()
    expect(screen.getByLabelText('Add document')).toBeTruthy()
  })

  it('keeps an uploaded file staged in no-KB mode and disables governed write', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path === '/api/bootstrap') return json({ runtime: { origin: 'http://127.0.0.1:1234', runtimeToken: 'b'.repeat(64) }, origin: 'http://127.0.0.1:1234', session: { conversationId: 'c1', isStreaming: false, isIdle: true, pendingMessageCount: 0, thinkingLevel: 'off' }, conversations: [], knowledgeError: { code: 'no_kb_mounted', error: 'not mounted' } })
      if (path === '/api/research/workflows') return json({ workflows: [] })
      if (path === '/api/conversations/current') return json({ conversationId: 'c1', isStreaming: false, isIdle: true, pendingMessageCount: 0, thinkingLevel: 'off' })
      if (path === '/api/conversations/messages') return json({ conversationId: 'c1', messages: [] })
      if (path === '/api/conversations') return json({ conversations: [] })
      if (path === '/api/attachments') return json({ attachment: { attachmentId: 'attachment-no-kb', filename: 'no-kb.pdf', mediaType: 'application/pdf', size: 12, sha256: 'f'.repeat(64), createdAt: '2026-10-02T00:00:00.000Z' } }, 201)
      return json({ code: 'not_found', error: 'not found' }, 404)
    }) as typeof fetch
    render(<App />)
    fireEvent.change(await screen.findByLabelText('Add document'), { target: { files: [new File(['pdf'], 'no-kb.pdf', { type: 'application/pdf' })] } })
    expect(await screen.findByText('no-kb.pdf')).toBeTruthy()
    expect(screen.getByText('Mount a Knowledge Base to prepare a governed Schema 0.4 preview.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Write Knowledge' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('resets source rights and ignores a late preview when replacing a file, then locks replacement during acceptance', async () => {
    let resolvePreviewA: (response: Response) => void = () => undefined
    let notifyPreviewAStarted: () => void = () => undefined
    const previewAStarted = new Promise<void>((resolve) => { notifyPreviewAStarted = resolve })
    let resolveAcceptance: (response: Response) => void = () => undefined
    let notifyAcceptanceStarted: () => void = () => undefined
    const acceptanceStarted = new Promise<void>((resolve) => { notifyAcceptanceStarted = resolve })
    const uploadedFiles: string[] = []
    mockV04UploadRuntime(async (input, init) => {
      const path = String(input)
      if (path === '/api/attachments') {
        const form = init?.body as FormData
        const file = form.get('file') as File
        uploadedFiles.push(file.name)
        return json({ attachment: { attachmentId: file.name === 'source-a.pdf' ? 'attachment-a' : 'attachment-b', filename: file.name, mediaType: file.type, size: file.size, sha256: file.name === 'source-a.pdf' ? 'a'.repeat(64) : 'b'.repeat(64), createdAt: '2026-10-02T00:00:00.000Z' } }, 201)
      }
      if (path === '/api/production/raw-document-preview-v04') {
        const body = JSON.parse(String(init?.body)) as { attachmentId: string }
        const runId = body.attachmentId === 'attachment-a' ? 'preview-a' : 'preview-b'
        return json({ accepted: true, runId, committable: false, workflow: { runId, workflowType: 'raw_document_knowledge_v04', objective: 'Preview source', status: 'running', startedAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z' } }, 202)
      }
      if (path === '/api/production/raw-document-preview-v04/preview-a') {
        notifyPreviewAStarted()
        return new Promise<Response>((resolve) => { resolvePreviewA = resolve })
      }
      if (path === '/api/production/raw-document-preview-v04/preview-b') return json({ runId: 'preview-b', workflow: { runId: 'preview-b', workflowType: 'raw_document_knowledge_v04', objective: 'Preview source', status: 'completed', startedAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-10-02T00:00:01.000Z' }, preview: { ...v04Preview, runId: 'preview-b', status: 'preview_partial', extractionCompleteness: 'partial', statusNote: 'The durable preview persisted after the workflow was cancelled and passed read-back verification.', incompleteUnits: [{ unitId: 'unit-failed', proposedUnitId: 'section:risks', status: 'failed', errorSummary: 'Extraction failed for this section.' }] }, committable: true })
      if (path === '/api/production/raw-document-preview-v04/accept') {
        notifyAcceptanceStarted()
        return new Promise<Response>((resolve) => { resolveAcceptance = resolve })
      }
      if (path === '/api/workflows/preview-a' || path === '/api/workflows/preview-b') {
        const runId = path.endsWith('preview-a') ? 'preview-a' : 'preview-b'
        return json({ runId, workflowType: 'raw_document_knowledge_v04', objective: 'Preview source', status: runId === 'preview-b' ? 'completed' : 'running', startedAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-10-02T00:00:01.000Z' })
      }
      return json({ code: 'not_found', error: 'not found' }, 404)
    })
    render(<App />)
    await screen.findByRole('textbox', { name: 'Message' })
    const composer = document.querySelector('.composer-wrap')
    if (!composer) throw new Error('Composer not found')
    fireEvent.drop(composer, { dataTransfer: { files: [new File(['a'], 'source-a.pdf', { type: 'application/pdf' })], types: ['Files'] } })
    expect(await screen.findByText('source-a.pdf')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Write Knowledge' }))
    fireEvent.change(screen.getByLabelText('Source title'), { target: { value: 'Metadata from A' } })
    fireEvent.change(screen.getByLabelText(/Policy basis/), { target: { value: 'Rights basis from A' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'AI processing is allowed' }))
    fireEvent.click(screen.getByRole('button', { name: 'Extract candidates for review' }))
    await previewAStarted

    fireEvent.drop(composer, { dataTransfer: { files: [new File(['b'], 'source-b.pdf', { type: 'application/pdf' })], types: ['Files'] } })
    expect(await screen.findByText('source-b.pdf')).toBeTruthy()
    expect(screen.queryByText('candidate-claim-1')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Write Knowledge' }))
    expect((screen.getByLabelText('Source title') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText(/Policy basis/) as HTMLTextAreaElement).value).toBe('')
    expect((screen.getByRole('checkbox', { name: 'AI processing is allowed' }) as HTMLInputElement).checked).toBe(false)

    resolvePreviewA(json({ runId: 'preview-a', workflow: { runId: 'preview-a', workflowType: 'raw_document_knowledge_v04', objective: 'Preview A', status: 'completed', startedAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-10-02T00:00:01.000Z' }, preview: { ...v04Preview, runId: 'preview-a', candidateGroups: [{ ...v04Preview.candidateGroups[0]!, candidateId: 'candidate-from-A' }] }, committable: true }))
    await waitFor(() => expect(screen.queryByText('candidate-from-A')).toBeNull())

    fireEvent.change(screen.getByLabelText('Source title'), { target: { value: 'Metadata from B' } })
    fireEvent.change(screen.getByLabelText(/Policy basis/), { target: { value: 'Rights basis from B' } })
    fireEvent.click(screen.getByRole('button', { name: 'Extract candidates for review' }))
    expect(await screen.findByText(/1 extraction unit\(s\) failed or were cancelled/)).toBeTruthy()
    expect(screen.getByText(/durable preview persisted after the workflow was cancelled/)).toBeTruthy()
    expect(document.querySelector('.incomplete-units')?.textContent).toContain('Extraction failed for this section.')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select claim candidate' }))
    fireEvent.click(screen.getByRole('button', { name: 'Accept 1 selected' }))
    await acceptanceStarted
    fireEvent.drop(composer, { dataTransfer: { files: [new File(['c'], 'source-c.pdf', { type: 'application/pdf' })], types: ['Files'] } })
    expect(await screen.findByText('Wait for candidate acceptance to finish before replacing this file.')).toBeTruthy()
    expect(uploadedFiles).toEqual(['source-a.pdf', 'source-b.pdf'])
    resolveAcceptance(json({ status: 'committed', knowledgeBaseId: 'kb-1', knowledgeBaseRevision: 8, baseRevision: 7, previewWorkflowRunId: 'preview-b', extractionCompleteness: 'partial', acceptedCandidateIds: ['candidate-claim-1'], createdIds: ['claim:example'], updatedIds: [], errors: [] }))
    expect(await screen.findByText('committed')).toBeTruthy()
  })

  it('renders registry-backed Workflow and safe research policy defaults', async () => {
    render(<App />)
    expect(await screen.findByRole('combobox', { name: 'Workflow' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Free Research' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Earnings Review' })).toBeTruthy()
    expect((screen.getByRole('checkbox', { name: 'Query Knowledge' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('checkbox', { name: 'Search Source Library' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('checkbox', { name: 'Write Knowledge' }) as HTMLInputElement).checked).toBe(false)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Write Knowledge' }))
    expect((screen.getByRole('checkbox', { name: 'Write Knowledge' }) as HTMLInputElement).checked).toBe(true)
  })

  it('keeps Review read-only and does not render decision controls', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Research conversation', level: 1 })).toBeTruthy())
    expect(screen.queryByText('Resolve')).toBeNull()
    expect(screen.queryByText('Approve')).toBeNull()
    expect(screen.queryByText('Reject')).toBeNull()
  })

  it('exposes the six product destinations and keeps Knowledge Graph safe in no-KB mode', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByRole('link', { name: 'Research' }).getAttribute('aria-current')).toBe('page'))
    expect(screen.getByRole('link', { name: 'Knowledge Graph' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Daily Briefs' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Reports' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Run Research' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Reviews' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.click(screen.getByRole('button', { name: '中文' }))
    fireEvent.click(screen.getByRole('link', { name: '知识图谱' }))
    expect(await screen.findByRole('heading', { name: '主题工作台' })).toBeTruthy()
    expect(screen.getByText('没有已挂载的 Knowledge Base')).toBeTruthy()
    expect(screen.queryByRole('canvas')).toBeNull()
    expect(screen.queryByText('Search Knowledge')).toBeNull()
  })

  it('renders the governed Research launcher route', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByRole('link', { name: 'Run Research' })).toBeTruthy())
    fireEvent.click(screen.getByRole('link', { name: 'Run Research' }))
    expect(await screen.findByRole('heading', { name: 'Run Research' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Start Company' })).toBeTruthy()
    expect(screen.getByText('The runtime creates the Workflow ID and tracks completion in Research.')).toBeTruthy()
  })

  it('renders the Research Report catalog as a read-only route', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByRole('link', { name: 'Reports' })).toBeTruthy())
    fireEvent.click(screen.getByRole('link', { name: 'Reports' }))
    expect(await screen.findByRole('heading', { name: 'Research Reports' })).toBeTruthy()
    expect(screen.getByText('No persisted Research Reports')).toBeTruthy()
  })

  it('renders the Daily Brief reader as a read-only route', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByRole('link', { name: 'Daily Briefs' })).toBeTruthy())
    fireEvent.click(screen.getByRole('link', { name: 'Daily Briefs' }))
    expect(await screen.findByRole('heading', { name: 'Daily Briefs' })).toBeTruthy()
    expect(screen.getByText('No persisted Daily Briefs')).toBeTruthy()
  })

  it('renders Reviews as a separate read-only page in no-KB mode', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByRole('link', { name: 'Reviews' })).toBeTruthy())
    fireEvent.click(screen.getByRole('link', { name: 'Reviews' }))
    expect(await screen.findByRole('heading', { name: 'Review Inbox' })).toBeTruthy()
    expect(screen.getByText('Read-only')).toBeTruthy()
    expect(screen.getAllByText(/No Knowledge Base mounted/).length).toBeGreaterThan(0)
    expect(screen.queryByText('Resolve')).toBeNull()
    expect(screen.queryByText('Approve')).toBeNull()
    expect(screen.queryByText('Reject')).toBeNull()
  })

  it('refreshes a canonical Thesis, loads its persisted report, and lets a scoped case be decided', async () => {
    window.history.replaceState({}, '', '/theses')
    let refreshStarted = false
    let accepted = false
    const thesisSummary = { thesisRef: 'thesis:value-driver', title: 'Value driver', statement: 'Growth supports value', status: 'active', companySubject: { companyRef: 'entity:company-acme', name: 'Acme' }, lastReviewedAt: null, propositionCount: 1 }
    let currentConditionRevision = 2
    let currentConditionHash = `sha256:${'d'.repeat(64)}`
    const thesisDetail = () => ({ ...thesisSummary, propositions: [{ claimRef: 'claim:driver', statement: 'Margins will expand', claimType: 'forecast', sourceRefs: ['source:annual-report'], membershipEdgeRef: 'reasoning-edge:qualifies' }], propositionRefs: ['claim:driver'], membershipEdgeRefs: ['reasoning-edge:qualifies'], killCriteria: [{ conditionId: 'revenue-floor', revision: currentConditionRevision, state: 'active', type: 'numeric_threshold', definitionVersion: 1, definition: { metricRef: 'metric:revenue', operator: 'lt', threshold: 1500, unit: 'CNY', period: 'FY2026' }, targetClaimRefs: ['claim:driver'], effectiveAt: '2026-09-22T00:00:00.000Z', definitionHash: currentConditionHash, origin: { kind: 'human_rule' }, authority: { workflowRunId: 'criterion-run', confirmedAt: '2026-09-22T00:00:00.000Z' } }], revision: 7 })
    const reviewDetail = () => ({ reviewCaseId: 'review-thesis-1', producerRunId: 'refresh-thesis-1', producerType: 'thesis_lifecycle', createdAt: '2026-09-24T10:00:00.000Z', classification: { rationale: 'Canonical kill criterion was met' }, rootProposal: { proposalKind: 'update', semanticType: 'claim' }, evidenceBindings: [{ kind: 'canonical_research_evidence', sourceRef: 'source:annual-report', rawRef: 'raw-sha256-abc' }], existingKnowledgeProjections: [], impact: {}, thesisScope: { thesisRef: 'thesis:value-driver', rootClaimRef: 'claim:driver', affectedClaimRefs: ['claim:driver'], evidenceRefs: ['observation:revenue'], reviewedEvidence: [{ evidenceRef: 'observation:revenue', relation: 'context', targetClaimRefs: ['claim:driver'] }], candidateTransition: 'invalidation_condition_met', asOf: '2026-09-24T10:00:00.000Z', proposedThesisStatus: 'invalidated', killCriterionAssessments: [{ conditionId: 'revenue-floor', status: 'met', targetPropositionRefs: ['claim:driver'], evidenceRefs: ['observation:revenue'], rationale: 'Deterministic evaluator found the threshold met.' }], killCriterionBindings: [{ conditionId: 'revenue-floor', revision: 2, definitionHash: `sha256:${'d'.repeat(64)}`, evaluatedValueIdentity: `sha256:${'e'.repeat(64)}`, evidenceRef: 'observation:revenue', value: 1000, metricRef: 'metric:revenue', unit: 'CNY', period: 'FY2026', sourceRef: 'source:annual-report', rawRef: `raw-sha256-${'a'.repeat(64)}`, locator: 'quote:U291cmNlIHF1b3RlIG11c3Qgbm90IGRpc3BsYXk=', publishedAt: '2026-09-22T00:00:00.000Z', targetClaimRefs: ['claim:driver'], numericValueVersionVerified: true, asOf: '2026-09-24T10:00:00.000Z' }] }, decision: { state: accepted ? 'ACCEPTED' : 'OPEN', revision: accepted ? 1 : 0, actionable: !accepted, events: [], totalEvents: 0, eventsTruncated: false }, state: { status: 'open' }, totalDependentProposals: 0, dependentProposalSamples: [], dependentProposals: [], dependentsTruncated: false })
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      if (path === '/api/bootstrap') return json({ runtime: { origin: 'http://127.0.0.1:1234', runtimeToken: 'b'.repeat(64) }, origin: 'http://127.0.0.1:1234', session: { conversationId: 'c1', isStreaming: false, isIdle: true, pendingMessageCount: 0, thinkingLevel: 'off' }, conversations: [], knowledgeBase: { knowledgeBaseId: 'kb-1', rootRef: 'root:kb', revision: 7, status: 'active', schemaVersion: '0.4', storageFormatVersion: '1', counts: {} }, openReviewCases: 1 })
      if (path === '/api/research/workflows') return json({ workflows: [] })
      if (path === '/api/conversations/current') return json({ conversationId: 'c1', isStreaming: false, isIdle: true, pendingMessageCount: 0, thinkingLevel: 'off' })
      if (path === '/api/conversations/messages') return json({ conversationId: 'c1', messages: [] })
      if (path === '/api/conversations') return json({ conversations: [] })
      if (path === '/api/knowledge/directory') return json({ themeGroups: [], industries: { items: [], total: 0, limit: 30, truncated: false }, companies: { items: [{ ref: 'entity:company-acme', name: 'Acme' }], total: 1, limit: 30, truncated: false }, products: { items: [], total: 0, limit: 30, truncated: false }, technologies: { items: [], total: 0, limit: 30, truncated: false } })
      if (path === '/api/knowledge/theses?limit=50') return json({ theses: [thesisSummary], total: 1, limit: 50, truncated: false, revision: 7 })
      if (path === '/api/knowledge/theses/thesis%3Avalue-driver') return json(thesisDetail())
      if (path === '/api/reviews') return json(accepted ? { cases: [], total: 0, limit: 50, truncated: false } : { cases: [{ reviewCaseId: 'review-thesis-1', producerRunId: 'refresh-thesis-1', producerType: 'thesis_lifecycle', createdAt: '2026-09-24T10:00:00.000Z', category: 'semantic_conflict', actionability: 'actionable', origin: 'thesis_refresh', rationale: 'Evidence challenges the load-bearing claim', proposalKind: 'update', semanticType: 'claim', dependentProposalCount: 0, status: 'open', decisionState: 'OPEN' }], total: 1, limit: 50, truncated: false })
      if (path === '/api/production/thesis-lifecycle/refresh') { refreshStarted = true; return json({ accepted: true, runId: 'refresh-thesis-1' }, 202) }
      if (path === '/api/workflows/refresh-thesis-1') return json({ runId: 'refresh-thesis-1', workflowType: 'thesis_lifecycle', objective: 'Refresh Thesis', status: 'completed_with_review', startedAt: '2026-09-24T10:00:00.000Z', updatedAt: '2026-09-24T10:01:00.000Z', completedAt: '2026-09-24T10:01:00.000Z', reviewCount: 1 })
      if (path === '/api/research-reports?limit=50') return json({ reports: refreshStarted ? [{ reportId: 'thesis-lifecycle-refresh-thesis-1', reportType: 'thesis_lifecycle', subjectRefs: ['thesis:value-driver'], generatedAt: '2026-09-24T10:01:00.000Z', asOf: '2026-09-24T10:00:00.000Z', workflowRunId: 'refresh-thesis-1', knowledgeBaseRevision: 7, sourceCount: 1, claimCount: 1, sectionCount: 3, methodology: 'Canonical PIT refresh' }] : [] })
      if (path === '/api/research-reports/thesis-lifecycle-refresh-thesis-1') return json({ reportId: 'thesis-lifecycle-refresh-thesis-1', reportType: 'thesis_lifecycle', subjectRefs: ['thesis:value-driver'], generatedAt: '2026-09-24T10:01:00.000Z', asOf: '2026-09-24T10:00:00.000Z', workflowRunId: 'refresh-thesis-1', knowledgeBaseRevision: 7, sourceCount: 1, claimCount: 1, sectionCount: 3, methodology: 'Canonical PIT refresh', sourceRefs: ['source:annual-report'], claimRefs: ['claim:driver'], sections: [{ id: 'evidence-pit', title: 'Evidence and Point-in-Time Decisions', markdown: 'PIT accepted observation:revenue' }] })
      if (path === '/api/review-cases/review-thesis-1') return json(reviewDetail())
      if (path === '/api/review-cases/review-thesis-1/decision') { accepted = JSON.parse(String(init?.body)).decision === 'ACCEPT'; return json({ status: 'accepted', reviewCaseId: 'review-thesis-1', decisionState: 'ACCEPTED', committedRevision: 8, errors: [] }) }
      return json({ code: 'not_found', error: 'not found' }, 404)
    }) as typeof fetch

    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Thesis Lifecycle' })).toBeTruthy()
    expect(await screen.findByText('Growth supports value')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh Thesis' }))
    expect(await screen.findByText('thesis-lifecycle-refresh-thesis-1')).toBeTruthy()
    expect(await screen.findByText('PIT accepted observation:revenue')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /review-thesis-1/ }))
    expect((await screen.findAllByText('claim:driver', { selector: 'p' })).length).toBeGreaterThan(0)
    const criterionDetails = await screen.findByRole('region', { name: 'Canonical Kill Criterion evaluation' })
    expect(criterionDetails.textContent).toContain('revenue-floor · revision 2')
    expect(criterionDetails.textContent).toContain('Current canonical rule: metric:revenue lt 1500 CNY · FY2026')
    expect(criterionDetails.textContent).toContain(`Definition hash: sha256:${'d'.repeat(64)}`)
    expect(criterionDetails.textContent).toContain('Evaluated value: 1000 CNY · metric:revenue · FY2026')
    expect(criterionDetails.textContent).toContain(`Source: source:annual-report · Raw: raw-sha256-${'a'.repeat(64)}`)
    expect(criterionDetails.textContent).toContain('Numeric value version: verified')
    expect(criterionDetails.textContent).toContain('Matches the active canonical condition revision and hash.')
    expect((screen.getByRole('button', { name: 'Accept reviewed changes' }) as HTMLButtonElement).disabled).toBe(false)
    currentConditionRevision = 3
    currentConditionHash = `sha256:${'e'.repeat(64)}`
    fireEvent.click(screen.getByRole('button', { name: /review-thesis-1/ }))
    await waitFor(() => expect(screen.getByRole('region', { name: 'Canonical Kill Criterion evaluation' }).textContent).toContain(`MISMATCH: active canonical condition is revision 3 with hash sha256:${'e'.repeat(64)}.`))
    const staleDetails = screen.getByRole('region', { name: 'Canonical Kill Criterion evaluation' })
    expect(staleDetails.textContent).toContain(`MISMATCH: active canonical condition is revision 3 with hash sha256:${'e'.repeat(64)}.`)
    let acceptButton = screen.getByRole('button', { name: 'Accept reviewed changes' }) as HTMLButtonElement
    expect(acceptButton.disabled).toBe(true)
    expect(screen.getByText('ACCEPT is disabled because the active condition revision or hash changed; this ReviewCase is stale.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Defer' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: 'Reject' }) as HTMLButtonElement).disabled).toBe(false)
    currentConditionRevision = 2
    currentConditionHash = `sha256:${'d'.repeat(64)}`
    fireEvent.click(screen.getByRole('button', { name: /review-thesis-1/ }))
    await waitFor(() => expect(screen.getByRole('region', { name: 'Canonical Kill Criterion evaluation' }).textContent).toContain('Matches the active canonical condition revision and hash.'))
    acceptButton = screen.getByRole('button', { name: 'Accept reviewed changes' }) as HTMLButtonElement
    expect(acceptButton.disabled).toBe(false)
    fireEvent.change(screen.getByRole('textbox', { name: 'Decision note' }), { target: { value: 'Confirmed after source review' } })
    fireEvent.click(screen.getByRole('button', { name: 'Accept reviewed changes' }))
    await waitFor(() => expect(screen.getByText('This case is resolved or is no longer actionable.')).toBeTruthy())
  })

  it('submits Thesis CREATE with a canonical company and explicit evidence refs', async () => {
    window.history.replaceState({}, '', '/theses')
    let createBody: Record<string, unknown> | undefined
    const report = { reportId: 'thesis-lifecycle-create-ui-1', reportType: 'thesis_lifecycle', subjectRefs: ['entity:company-acme'], generatedAt: '2026-09-24T10:01:00.000Z', asOf: '2026-09-24T10:00:00.000Z', workflowRunId: 'create-ui-1', knowledgeBaseRevision: 3, sourceRefs: ['source:annual'], claimRefs: ['claim:new-driver'], methodology: 'Governed Thesis CREATE', sections: [{ id: 'thesis-created', title: 'Thesis Created', markdown: 'Thesis: thesis:durable-growth' }] }
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      if (path === '/api/bootstrap') return json({ runtime: { origin: 'http://127.0.0.1:1234', runtimeToken: 'b'.repeat(64) }, origin: 'http://127.0.0.1:1234', session: { conversationId: 'c1', isStreaming: false, isIdle: true, pendingMessageCount: 0, thinkingLevel: 'off' }, conversations: [], knowledgeBase: { knowledgeBaseId: 'kb-1', rootRef: 'root:kb', revision: 2, status: 'active', schemaVersion: '0.4', storageFormatVersion: '1', counts: {} }, openReviewCases: 0 })
      if (path === '/api/research/workflows') return json({ workflows: [] })
      if (path === '/api/conversations/current') return json({ conversationId: 'c1', isStreaming: false, isIdle: true, pendingMessageCount: 0, thinkingLevel: 'off' })
      if (path === '/api/conversations/messages') return json({ conversationId: 'c1', messages: [] })
      if (path === '/api/conversations') return json({ conversations: [] })
      if (path === '/api/knowledge/directory') return json({ themeGroups: [], industries: { items: [], total: 0, limit: 30, truncated: false }, companies: { items: [{ ref: 'entity:company-acme', name: 'Acme' }], total: 1, limit: 30, truncated: false }, products: { items: [], total: 0, limit: 30, truncated: false }, technologies: { items: [], total: 0, limit: 30, truncated: false } })
      if (path === '/api/knowledge/theses?limit=50') return json({ theses: [], total: 0, limit: 50, truncated: false, revision: 2 })
      if (path === '/api/reviews') return json({ cases: [], total: 0, limit: 50, truncated: false })
      if (path === '/api/production/thesis-lifecycle/create') { createBody = JSON.parse(String(init?.body)); return json({ accepted: true, runId: 'create-ui-1' }, 202) }
      if (path === '/api/workflows/create-ui-1') return json({ runId: 'create-ui-1', workflowType: 'thesis_lifecycle', objective: 'Create Thesis', status: 'completed', startedAt: '2026-09-24T10:00:00.000Z', updatedAt: '2026-09-24T10:01:00.000Z', completedAt: '2026-09-24T10:01:00.000Z' })
      if (path === '/api/research-reports?limit=50') return json({ reports: [report] })
      if (path === '/api/research-reports/thesis-lifecycle-create-ui-1') return json(report)
      return json({ code: 'not_found', error: 'not found' }, 404)
    }) as typeof fetch

    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Thesis Lifecycle' })).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: 'Thesis title' }), { target: { value: 'Durable growth' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Thesis narrative' }), { target: { value: 'Capacity expansion should support sustained growth.' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'CREATE evidence refs' }), { target: { value: 'claim:accepted-capacity' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Thesis' }))
    await waitFor(() => expect(createBody).toBeDefined())
    expect(createBody).toMatchObject({ companyRef: 'entity:company-acme', thesisTitle: 'Durable growth', narrative: 'Capacity expansion should support sustained growth.', evidenceRefs: ['claim:accepted-capacity'] })
    expect(createBody).not.toHaveProperty('rawPath')
    expect(await screen.findByText('Thesis: thesis:durable-growth')).toBeTruthy()
  })

  it('requires a separate human confirmation for an explicitly defined Kill Criterion and reloads canonical state', async () => {
    window.history.replaceState({}, '', '/theses')
    const thesisSummary = { thesisRef: 'thesis:value-driver', title: 'Value driver', statement: 'Growth supports value', status: 'active', companySubject: { companyRef: 'entity:company-acme', name: 'Acme' }, lastReviewedAt: null, propositionCount: 1 }
    let confirmed = false
    const preview = { knowledgeBaseId: 'kb-1', expectedKnowledgeBaseRevision: 7, thesisRef: 'thesis:value-driver', conditionId: 'margin-floor', revision: 1, type: 'numeric_threshold', definitionVersion: 1, definition: { metricRef: 'gross_margin', operator: 'lt', threshold: 0.2, unit: 'ratio', period: 'FY2026' }, targetClaimRefs: ['claim:driver'], origin: { kind: 'human_rule' }, definitionHash: 'definition-hash', previewHash: 'preview-hash' }
    const confirmedCriterion = { conditionId: 'margin-floor', revision: 1, state: 'active', type: 'numeric_threshold', definitionVersion: 1, definition: preview.definition, targetClaimRefs: ['claim:driver'], effectiveAt: '2026-09-28T00:00:00.000Z', definitionHash: 'definition-hash', origin: { kind: 'human_rule' }, authority: { workflowRunId: 'criterion-run-test', confirmedAt: '2026-09-28T00:00:00.000Z' } }
    const detail = () => ({ ...thesisSummary, propositions: [{ claimRef: 'claim:driver', statement: 'Margins will expand', claimType: 'forecast', sourceRefs: ['source:annual-report'], membershipEdgeRef: 'edge:qualifies' }], propositionRefs: ['claim:driver'], membershipEdgeRefs: ['edge:qualifies'], killCriteria: confirmed ? [confirmedCriterion] : [], revision: confirmed ? 8 : 7 })
    const calls: { path: string; init?: RequestInit }[] = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input); calls.push({ path, init })
      if (path === '/api/bootstrap') return json({ runtime: { origin: 'http://127.0.0.1:1234', runtimeToken: 'b'.repeat(64) }, origin: 'http://127.0.0.1:1234', session: { conversationId: 'c1', isStreaming: false, isIdle: true, pendingMessageCount: 0, thinkingLevel: 'off' }, conversations: [], knowledgeBase: { knowledgeBaseId: 'kb-1', rootRef: 'root:kb', revision: 7, status: 'active', schemaVersion: '0.4', storageFormatVersion: '1', counts: {} } })
      if (path === '/api/research/workflows') return json({ workflows: [] })
      if (path === '/api/conversations/current') return json({ conversationId: 'c1', isStreaming: false, isIdle: true, pendingMessageCount: 0, thinkingLevel: 'off' })
      if (path === '/api/conversations/messages') return json({ conversationId: 'c1', messages: [] })
      if (path === '/api/conversations') return json({ conversations: [] })
      if (path === '/api/knowledge/directory') return json({ themeGroups: [], industries: { items: [], total: 0, limit: 30, truncated: false }, companies: { items: [{ ref: 'entity:company-acme', name: 'Acme' }], total: 1, limit: 30, truncated: false }, products: { items: [], total: 0, limit: 30, truncated: false }, technologies: { items: [], total: 0, limit: 30, truncated: false } })
      if (path === '/api/knowledge/theses?limit=50') return json({ theses: [thesisSummary], total: 1, limit: 50, truncated: false, revision: confirmed ? 8 : 7 })
      if (path === '/api/knowledge/theses/thesis%3Avalue-driver') return json(detail())
      if (path === '/api/reviews') return json({ cases: [], total: 0, limit: 50, truncated: false })
      if (path === '/api/production/thesis-lifecycle/criteria/prepare') return json(preview)
      if (path === '/api/production/thesis-lifecycle/criteria/confirm') { confirmed = true; return json({ status: 'confirmed', replay: false, thesisRef: 'thesis:value-driver', conditionId: 'margin-floor', criterionRevision: 1, definitionHash: 'definition-hash', knowledgeBaseId: 'kb-1', knowledgeBaseRevision: 8, committedRevision: 8, writerRunId: 'criterion-run-test' }) }
      return json({ code: 'not_found', error: 'not found' }, 404)
    }) as typeof fetch

    render(<App />)
    expect(await screen.findByText('Thesis invalidation is blocked pending human confirmation. Narrative text is not inferred as a criterion.')).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: 'Criterion condition ID' }), { target: { value: 'margin-floor' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Criterion metric reference' }), { target: { value: 'gross_margin' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Criterion threshold' }), { target: { value: '0.2' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Criterion unit' }), { target: { value: 'ratio' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Criterion period' }), { target: { value: 'FY2026' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /Margins will expand/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Prepare criterion preview' }))
    expect(await screen.findByRole('heading', { name: 'margin-floor revision 1' })).toBeTruthy()
    expect(calls.some((call) => call.path.endsWith('/criteria/confirm'))).toBe(false)
    fireEvent.change(screen.getByRole('textbox', { name: 'Criterion metric reference' }), { target: { value: 'net_margin' } })
    expect(screen.queryByRole('heading', { name: 'margin-floor revision 1' })).toBeNull()
    fireEvent.change(screen.getByRole('textbox', { name: 'Criterion metric reference' }), { target: { value: 'gross_margin' } })
    fireEvent.click(screen.getByRole('button', { name: 'Prepare criterion preview' }))
    expect(await screen.findByRole('heading', { name: 'margin-floor revision 1' })).toBeTruthy()
    const previewCall = calls.filter((call) => call.path.endsWith('/criteria/prepare')).at(-1)
    expect(JSON.parse(String(previewCall?.init?.body))).toMatchObject({ thesisRef: 'thesis:value-driver', conditionId: 'margin-floor', targetClaimRefs: ['claim:driver'], origin: { kind: 'human_rule' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and write criterion' }))
    expect(await screen.findByRole('status')).toBeTruthy()
    await waitFor(() => expect(calls.some((call) => call.path === '/api/knowledge/theses/thesis%3Avalue-driver' && calls.indexOf(call) > calls.findIndex((item) => item.path.endsWith('/criteria/confirm')))).toBe(true))
    const confirmCall = calls.find((call) => call.path.endsWith('/criteria/confirm'))
    expect(JSON.parse(String(confirmCall?.init?.body))).toMatchObject({ previewHash: 'preview-hash', expectedKnowledgeBaseRevision: 7, workflowRunId: expect.stringMatching(/^criterion-/) })
    expect(await screen.findByText(/active · margin-floor v1/)).toBeTruthy()
  })

  it('shows durable Theme scope proposals in Chat and refreshes after a human decision', async () => {
    const receiptKey = 'a'.repeat(64)
    const proposalId = `theme-scope-impact:${'b'.repeat(40)}`
    let decisionSaved = false
    const proposal = { proposalId, themeRef: 'entity:theme-ai', candidate: { kind: 'industry', name: 'PCB' }, candidateFingerprint: `sha256:${'b'.repeat(64)}`, changeKind: 'new_theme_node', rationale: 'New research evidence identifies PCB as a relevant upstream industry.', evidenceRefs: ['source:annual-report'], changedRefs: ['entity:pcb'], basedOnRevision: 8, status: decisionSaved ? 'accepted' : 'pending', ...(decisionSaved ? { decision: 'include' } : {}) }
    const record = { receiptKey, knowledgeBaseId: 'kb-1', baseRevision: 7, committedRevision: 8, status: 'ready', proposals: [proposal], diagnostics: [] }
    const calls: { path: string; init?: RequestInit }[] = []
    let failRefresh = false
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input); calls.push({ path, init })
      if (path === '/api/bootstrap') return json({ runtime: { origin: 'http://127.0.0.1:1234', runtimeToken: 'b'.repeat(64) }, origin: 'http://127.0.0.1:1234', session: { conversationId: 'c1', isStreaming: false, isIdle: true, pendingMessageCount: 0, thinkingLevel: 'off' }, conversations: [], knowledgeBase: { knowledgeBaseId: 'kb-1', rootRef: 'root:kb', revision: 8, status: 'active', schemaVersion: '0.4', storageFormatVersion: '1', counts: {} } })
      if (path === '/api/research/workflows') return json({ workflows: [] })
      if (path === '/api/conversations/current') return json({ conversationId: 'c1', isStreaming: false, isIdle: true, pendingMessageCount: 0, thinkingLevel: 'off' })
      if (path === '/api/conversations/messages') return json({ conversationId: 'c1', messages: [] })
      if (path === '/api/conversations') return json({ conversations: [] })
      if (path === '/api/daily-briefs?limit=20') return json({ briefs: [] })
      if (path === '/api/theme-scope-impact?limit=50') return failRefresh ? json({ code: 'failed', error: 'Runtime unavailable' }, 500) : json({ items: [{ ...record, status: decisionSaved ? 'stale' : 'ready', proposals: [{ ...proposal, status: decisionSaved ? 'accepted' : 'pending', ...(decisionSaved ? { decision: 'include' } : {}) }] }], total: 1, truncated: false })
      if (path.endsWith('/decisions')) { decisionSaved = true; return json({ ...record, proposals: [{ ...proposal, status: 'accepted', decision: 'include' }] }) }
      return json({ code: 'not_found', error: 'not found' }, 404)
    }) as typeof fetch

    render(<App />)
    await openReviewsSection('Theme scope changes')
    expect(await screen.findByRole('heading', { name: 'Theme scope changes' })).toBeTruthy()
    expect(await screen.findByRole('heading', { name: 'PCB' })).toBeTruthy()
    expect(screen.getByText('New research evidence identifies PCB as a relevant upstream industry.')).toBeTruthy()
    expect(screen.getByText((_, element) => element?.textContent === '1 evidence refs')).toBeTruthy()
    expect(document.body.textContent).not.toContain('rawRef')
    fireEvent.click(screen.getByRole('button', { name: 'Include' }))
    expect(calls.some((call) => call.path.endsWith('/decisions'))).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Save decisions for 1 proposal' }))
    await waitFor(() => expect(screen.getByText('Decision saved · include')).toBeTruthy())
    const decisionCall = calls.find((call) => call.path.endsWith('/decisions'))
    expect(JSON.parse(String(decisionCall?.init?.body))).toMatchObject({ workflowRunId: expect.stringMatching(/^scope-impact-/), decisions: [{ proposalId, decision: 'include' }] })
    expect(JSON.parse(String(decisionCall?.init?.body))).not.toHaveProperty('evidenceRefs')
    expect(new Headers(decisionCall?.init?.headers).get('X-ResearchHub-Runtime-Token')).toBe('b'.repeat(64))
    expect(await screen.findByText('Stale')).toBeTruthy()
    failRefresh = true
    fireEvent.click(screen.getByRole('button', { name: 'Refresh proposals' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText('Scope inbox could not be refreshed')).toBeTruthy()
  })
})
