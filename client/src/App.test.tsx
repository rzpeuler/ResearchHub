import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

function json(body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }) }

function mockV04UploadRuntime(fetchMock: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): void {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    if (path === '/api/bootstrap') return json({ runtime: { origin: 'http://127.0.0.1:1234', runtimeToken: 'b'.repeat(64) }, origin: 'http://127.0.0.1:1234', session: { conversationId: 'c1', isStreaming: false, isIdle: true, pendingMessageCount: 0, thinkingLevel: 'off' }, conversations: [], knowledgeBase: { knowledgeBaseId: 'kb-1', rootRef: 'root:kb', revision: 7, status: 'active', schemaVersion: '0.4', storageFormatVersion: '1', counts: {} } })
    if (path === '/api/research/workflows') return json({ workflows: [] })
    if (path === '/api/conversations/current') return json({ conversationId: 'c1', isStreaming: false, isIdle: true, pendingMessageCount: 0, thinkingLevel: 'off' })
    if (path === '/api/conversations/messages') return json({ conversationId: 'c1', messages: [] })
    if (path === '/api/conversations') return json({ conversations: [] })
    return fetchMock(input, init)
  }) as typeof fetch
}

const v04Preview = { runId: 'preview-1', status: 'preview_ready', knowledgeBaseId: 'kb-1', candidateGroups: [{ candidateId: 'candidate-claim-1', kind: 'claim', candidate: { statement: 'Revenue grew in FY2025' }, provenanceRefs: { sourceRef: 'source:annual-report', rawRef: `raw-sha256-${'a'.repeat(64)}`, evidenceBlockRefs: ['block-1'] } }], committable: true }

describe('Homepage shell', () => {
  const originalFetch = globalThis.fetch
  const originalEventSource = globalThis.EventSource
  beforeEach(() => {
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

  it('loads conversation UI in no-KB mode without rendering the runtime token', async () => {
    render(<App />)
    expect(await screen.findByText('Research conversation')).toBeTruthy()
    expect(screen.getByText('No Knowledge Base mounted')).toBeTruthy()
    expect(document.body.textContent).not.toContain('b'.repeat(64))
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
    expect(mock).toHaveBeenCalledTimes(1)
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
    await waitFor(() => expect(screen.getByText('Research conversation')).toBeTruthy())
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
    fireEvent.click(screen.getByRole('link', { name: 'Knowledge Graph' }))
    expect(await screen.findByRole('heading', { name: 'Knowledge Graph' })).toBeTruthy()
    expect(screen.getByText('Mount a canonical Knowledge Base to browse the Directory and explore a rooted graph.')).toBeTruthy()
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
    expect(screen.getByText('No Knowledge Base mounted')).toBeTruthy()
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
})
