import { describe, expect, it, vi } from 'vitest'
import { RuntimeClient, RuntimeClientError, parseClientEvent } from './runtime-client'

function json(body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }) }
const bootstrap = { runtime: { origin: 'http://127.0.0.1:1234', runtimeToken: 'a'.repeat(64) }, origin: 'http://127.0.0.1:1234', session: { conversationId: 'c1', isStreaming: false, isIdle: true, pendingMessageCount: 0, thinkingLevel: 'off' }, conversations: [] }

describe('RuntimeClient', () => {
  it('keeps the bootstrap token in the client and adds it only to mutations', async () => {
    const calls: RequestInit[] = []
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => { calls.push(init ?? {}); return calls.length === 1 ? json(bootstrap) : json({ accepted: true, aborted: true }) })
    const client = new RuntimeClient(fetchMock)
    await client.bootstrap()
    await client.abort()
    expect(new Headers(calls[1]?.headers).get('X-ResearchHub-Runtime-Token')).toBe('a'.repeat(64))
    expect(JSON.stringify(document.body)).not.toContain('a'.repeat(64))
  })

  it('projects only normalized SSE event fields and ignores raw payloads', () => {
    const event = parseClientEvent(JSON.stringify({ eventId: 'e1', conversationId: 'c1', timestamp: 'now', type: 'tool.updated', name: 'search_knowledge', summary: 'Knowledge search', args: { secret: 'hidden' }, result: 'raw' }))
    expect(event).toEqual({ eventId: 'e1', conversationId: 'c1', timestamp: 'now', type: 'tool.updated', name: 'search_knowledge', summary: 'Knowledge search' })
    expect(parseClientEvent(JSON.stringify({ eventId: 'e2', conversationId: 'c1', timestamp: 'now', type: 'raw.pi.event', args: 'secret' }))).toBeUndefined()
  })

  it('subscribes to named normalized SSE events and reconnects through the resync hook', async () => {
    const listeners = new Map<string, (event: MessageEvent<string>) => void>()
    const source = { onopen: null as ((event: Event) => void) | null, onerror: null as ((event: Event) => void) | null, close: vi.fn(), addEventListener: (type: string, listener: (event: MessageEvent<string>) => void) => { listeners.set(type, listener) }, removeEventListener: (type: string) => { listeners.delete(type) } }
    const client = new RuntimeClient(async () => json(bootstrap)); await client.bootstrap()
    const received: string[] = []; const resync = vi.fn(); const dispose = client.openEvents((event) => received.push(event.type), resync, () => source)
    source.onopen?.(new Event('open')); listeners.get('message.delta')?.({ data: JSON.stringify({ eventId: 'e1', conversationId: 'c1', timestamp: 'now', type: 'message.delta', role: 'assistant', summary: 'safe' }) } as MessageEvent<string>)
    expect(resync).toHaveBeenCalledOnce(); expect(received).toEqual(['message.delta']); dispose(); expect(source.close).toHaveBeenCalledOnce(); expect(listeners.size).toBe(0)
  })

  it('uses explicit command endpoints and the safe authorization message', async () => {
    const paths: string[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => { paths.push(String(input)); return paths.length === 1 ? json(bootstrap) : json({ accepted: true, conversationId: 'c1', run: { runId: 'r1', operation: 'follow_up' } }, 202) })
    const client = new RuntimeClient(fetchMock)
    await client.bootstrap()
    await client.command('follow_up', 'continue')
    expect(paths[1]).toBe('/api/conversations/follow_up')

    const unauthorized = new RuntimeClient(async () => json({ code: 'unauthorized_runtime_token', error: 'unsafe detail' }, 401))
    await expect(unauthorized.bootstrap()).rejects.toBeInstanceOf(RuntimeClientError)
    await expect(unauthorized.bootstrap()).rejects.toMatchObject({ message: 'ResearchHub Runtime authorization expired. Reload the page.' })
  })

  it('preserves structured V0.4 stale revision conflicts from candidate acceptance', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => fetchMock.mock.calls.length === 1
      ? json(bootstrap)
      : json({ status: 'stale_revision', knowledgeBaseId: 'kb-1', knowledgeBaseRevision: 8, baseRevision: 7, previewWorkflowRunId: 'preview-1', acceptedCandidateIds: [], createdIds: [], updatedIds: [], errors: [{ code: 'STALE_REVISION', message: 'Knowledge Base revision changed' }] }, 409))
    const client = new RuntimeClient(fetchMock)
    await client.bootstrap()
    const result = await client.acceptRawDocumentPreviewV04('preview-1', ['candidate-1'])
    expect(result.status).toBe('stale_revision')
    expect(result.errors[0]?.message).toBe('Knowledge Base revision changed')
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe('/api/production/raw-document-preview-v04/accept')
  })

  it('authorizes Theme Framework review reads and posts only explicit decision maps', async () => {
    const calls: { path: string; init?: RequestInit }[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ path: String(input), init })
      if (calls.length === 1) return json(bootstrap)
      if (String(input).endsWith('/accept')) return json({ status: 'committed', workflowRunId: 'run / 1' })
      if (String(input).endsWith('/reject')) return json({ status: 'rejected', workflowRunId: 'run / 1' })
      return json({ status: 'running', workflowRunId: 'run / 1' })
    })
    const client = new RuntimeClient(fetchMock)
    await client.bootstrap()
    expect((await client.getThemeFrameworkRun('run / 1')).status).toBe('running')
    await client.acceptThemeFrameworkRun('run / 1', { 'industry-a': 'include', 'relation-a': 'pending' })
    await client.rejectThemeFrameworkRun('run / 1')
    expect(calls.map((call) => call.path)).toEqual([
      '/api/bootstrap',
      '/api/theme-framework/runs/run%20%2F%201',
      '/api/theme-framework/runs/run%20%2F%201/accept',
      '/api/theme-framework/runs/run%20%2F%201/reject',
    ])
    expect(new Headers(calls[1]?.init?.headers).get('X-ResearchHub-Runtime-Token')).toBe('a'.repeat(64))
    expect(JSON.parse(String(calls[2]?.init?.body))).toEqual({ decisions: { 'industry-a': 'include', 'relation-a': 'pending' } })
    expect(JSON.parse(String(calls[3]?.init?.body))).toEqual({})
  })

  it('encodes Graph read contracts and never adds a mutation token', async () => {
    const paths: string[] = []; const headers: Headers[] = []
    const client = new RuntimeClient(async (input, init) => { paths.push(String(input)); headers.push(new Headers(init?.headers)); return json({ themeGroups: [], industries: { items: [], total: 0, limit: 30, truncated: false }, companies: { items: [], total: 0, limit: 30, truncated: false }, products: { items: [], total: 0, limit: 30, truncated: false }, technologies: { items: [], total: 0, limit: 30, truncated: false } }) })
    await client.getKnowledgeDirectory()
    await client.getKnowledgeGraph({ rootRef: 'entity:company/acme', depth: 2, maxNodes: 10, maxEdges: 20 })
    expect(paths[0]).toBe('/api/knowledge/directory')
    expect(paths[1]).toBe('/api/knowledge/graph?rootRef=entity%3Acompany%2Facme&depth=2&maxNodes=10&maxEdges=20')
    expect(headers.every((value) => value.has('X-ResearchHub-Runtime-Token') === false)).toBe(true)
  })

  it('reads Theme workspace projections with encoded canonical refs and revision/volume bounds', async () => {
    const paths: string[] = []; const headers: Headers[] = []
    const client = new RuntimeClient(async (input, init) => { paths.push(String(input)); headers.push(new Headers(init?.headers)); return json({ status: 'available' }) })
    await client.getThemeWorkspaceOverview('entity:theme-a', { expectedRevision: 8, maxNodes: 60, maxEdges: 120, maxResponseBytes: 1_000_000 })
    await client.getThemeWorkspaceIndustry('entity:theme-a', 'entity:industry-b', { expectedRevision: 8, maxItemsPerSection: 30, maxCompaniesPerIndustry: 40 })
    await client.getThemeWorkspaceCompany('entity:theme-a', 'entity:industry-b', 'entity:company-c', { expectedRevision: 8, maxItemsPerSection: 30 })
    expect(paths).toEqual([
      '/api/knowledge/themes/entity%3Atheme-a/overview?expectedRevision=8&maxNodes=60&maxEdges=120&maxResponseBytes=1000000',
      '/api/knowledge/themes/entity%3Atheme-a/industries/entity%3Aindustry-b?expectedRevision=8&maxItemsPerSection=30&maxCompaniesPerIndustry=40',
      '/api/knowledge/themes/entity%3Atheme-a/industries/entity%3Aindustry-b/companies/entity%3Acompany-c?expectedRevision=8&maxItemsPerSection=30',
    ])
    expect(headers.every((value) => value.has('X-ResearchHub-Runtime-Token') === false)).toBe(true)
  })

  it('uses the standard RuntimeClientError path for Graph read failures', async () => {
    const client = new RuntimeClient(async () => json({ code: 'not_found', error: 'Resource not found' }, 404))
    await expect(client.getKnowledgeGraph({ rootRef: 'entity:missing' })).rejects.toMatchObject({ code: 'not_found', status: 404 })
  })

  it('reads bounded Daily Brief history and one persisted brief without a mutation token', async () => {
    const paths: string[] = []; const headers: Headers[] = []
    const client = new RuntimeClient(async (input, init) => { paths.push(String(input)); headers.push(new Headers(init?.headers)); return json(paths.length === 1 ? { briefs: [] } : { reportId: 'daily-morning-2026-09-08', briefType: 'morning', tradeDate: '2026-09-08', generatedAt: '2026-09-08T08:00:00.000Z', asOf: '2026-09-08T07:00:00.000Z', timezone: 'Asia/Shanghai', revision: 1, workflowRunId: 'daily-run', sections: [], topSignals: [], providerOutcomes: [], quality: { topCount: 0, reportItemWithSourceRatio: 0, reportItemCount: 0, claimCount: 0 }, consensusStatement: 'Unavailable', committedKnowledgeRefs: [], reviewCaseCount: 0, calendarConfidence: 'fallback' }) })
    await client.listDailyBriefs(20); await client.getDailyBrief('daily-morning-2026-09-08')
    expect(paths).toEqual(['/api/daily-briefs?limit=20', '/api/daily-briefs/daily-morning-2026-09-08'])
    expect(headers.every((value) => value.has('X-ResearchHub-Runtime-Token') === false)).toBe(true)
  })

  it('reads the bounded Research Report catalog and one report without a mutation token', async () => {
    const paths: string[] = []; const headers: Headers[] = []
    const client = new RuntimeClient(async (input, init) => { paths.push(String(input)); headers.push(new Headers(init?.headers)); return json(paths.length === 1 ? { reports: [] } : { reportId: 'company-600519', reportType: 'company_research', subjectRefs: ['entity:company-600519'], generatedAt: '2026-09-15T08:00:00.000Z', asOf: '2026-09-15T07:00:00.000Z', workflowRunId: 'company-run', knowledgeBaseRevision: 2, sourceRefs: [], claimRefs: [], methodology: 'bounded fixture', sections: [{ id: 'summary', title: 'Summary', markdown: 'Fixture.' }] }) })
    await client.listResearchReports(20); await client.getResearchReport('company-600519')
    expect(paths).toEqual(['/api/research-reports?limit=20', '/api/research-reports/company-600519'])
    expect(headers.every((value) => value.has('X-ResearchHub-Runtime-Token') === false)).toBe(true)
  })

  it('maps every Research launcher operation to its governed mutation endpoint', async () => {
    const paths: string[] = []; const headers: Headers[] = []
    const client = new RuntimeClient(async (input, init) => { paths.push(String(input)); headers.push(new Headers(init?.headers)); return paths.length === 1 ? json(bootstrap) : json({ accepted: true, runId: `run-${paths.length}` }) })
    await client.bootstrap()
    await client.startResearchCompany({ symbol: '600519' })
    await client.startResearchIndustry({ name: 'PCB' })
    await client.startEarningsReview({ symbol: '600519', fiscalYear: 2026, period: 'FY' })
    await client.startValuation({ symbol: '600519', methods: ['PE'] })
    await client.startEventResearch({ symbol: '600519', anchor: { kind: 'user_event', title: 'Fixture', description: 'Fixture event' } })
    await client.startThesisRedTeam({ symbol: '600519', thesisRef: 'claim:thesis' })
    expect(paths).toEqual(['/api/bootstrap', '/api/production/research-company', '/api/production/research-industry', '/api/production/review-earnings', '/api/production/analyze-valuation', '/api/production/research-event', '/api/production/red-team-thesis'])
    expect(headers.slice(1).every((value) => value.get('X-ResearchHub-Runtime-Token') === 'a'.repeat(64))).toBe(true)
  })

  it('keeps Thesis lifecycle queries, refresh input, scoped review, and decisions on bounded contracts', async () => {
    const calls: { path: string; init?: RequestInit }[] = []
    const client = new RuntimeClient(async (input, init) => {
      const path = String(input); calls.push({ path, init })
      if (path === '/api/bootstrap') return json(bootstrap)
      if (path === '/api/knowledge/theses?limit=50') return json({ theses: [], total: 0, limit: 50, truncated: false, revision: 4 })
      if (path === '/api/knowledge/theses/thesis%3Avalue-driver') return json({ thesisRef: 'thesis:value-driver', title: 'Value driver', statement: 'S', status: 'active', companySubject: { companyRef: 'entity:company-acme', name: 'Acme' }, lastReviewedAt: null, propositionCount: 0, propositions: [], propositionRefs: [], membershipEdgeRefs: [], revision: 4 })
      if (path === '/api/production/thesis-lifecycle/create') return json({ accepted: true, runId: 'create-1' }, 202)
      if (path === '/api/production/thesis-lifecycle/refresh') return json({ accepted: true, runId: 'refresh-1' }, 202)
      if (path === '/api/review-cases/review-1') return json({ reviewCaseId: 'review-1', producerRunId: 'refresh-1', producerType: 'thesis_lifecycle', createdAt: '2026-09-24T00:00:00.000Z', classification: {}, rootProposal: {}, evidenceBindings: [], existingKnowledgeProjections: [], impact: {}, thesisScope: { thesisRef: 'thesis:value-driver', rootClaimRef: 'claim:driver', affectedClaimRefs: ['claim:driver'], evidenceRefs: ['observation:evidence'], reviewedEvidence: [], candidateTransition: 'weakening', asOf: '2026-09-24T00:00:00.000Z' }, decision: { state: 'OPEN', revision: 0, actionable: true, events: [], totalEvents: 0, eventsTruncated: false }, state: {}, totalDependentProposals: 0, dependentProposalSamples: [], dependentProposals: [], dependentsTruncated: false })
      if (path === '/api/review-cases/review-1/decision') return json({ status: 'deferred', reviewCaseId: 'review-1', decisionState: 'DEFERRED', errors: [] })
      return json({ code: 'not_found', error: 'not found' }, 404)
    })
    await client.bootstrap()
    await client.listTheses(50)
    await client.getThesis('thesis:value-driver')
    await client.startThesisLifecycleCreate({ workflowRunId: 'create-1', companyRef: 'entity:company-acme', thesisTitle: 'Durable growth', narrative: 'Capacity expansion supports growth.', evidenceRefs: ['claim:evidence-1'], asOf: '2026-09-24T00:00:00.000Z' })
    await client.startThesisLifecycleRefresh({ thesisRef: 'thesis:value-driver', asOf: '2026-09-24T00:00:00.000Z', evidenceRefs: ['observation:evidence'] })
    const review = await client.getThesisReview('review-1')
    expect(review.thesisScope?.rootClaimRef).toBe('claim:driver')
    await client.decideThesisReview('review-1', 'DEFER', 'Review next week')
    expect(calls.map((call) => call.path)).toEqual(['/api/bootstrap', '/api/knowledge/theses?limit=50', '/api/knowledge/theses/thesis%3Avalue-driver', '/api/production/thesis-lifecycle/create', '/api/production/thesis-lifecycle/refresh', '/api/review-cases/review-1', '/api/review-cases/review-1/decision'])
    expect(JSON.parse(String(calls[3]?.init?.body))).toEqual({ workflowRunId: 'create-1', companyRef: 'entity:company-acme', thesisTitle: 'Durable growth', narrative: 'Capacity expansion supports growth.', evidenceRefs: ['claim:evidence-1'], asOf: '2026-09-24T00:00:00.000Z' })
    expect(JSON.parse(String(calls[4]?.init?.body))).toEqual({ thesisRef: 'thesis:value-driver', asOf: '2026-09-24T00:00:00.000Z', evidenceRefs: ['observation:evidence'] })
    expect(JSON.parse(String(calls[6]?.init?.body))).toEqual({ decision: 'DEFER', note: 'Review next week' })
    expect(new Headers(calls[1]?.init?.headers).has('X-ResearchHub-Runtime-Token')).toBe(false)
    expect(new Headers(calls[3]?.init?.headers).get('X-ResearchHub-Runtime-Token')).toBe('a'.repeat(64))
    expect(new Headers(calls[4]?.init?.headers).get('X-ResearchHub-Runtime-Token')).toBe('a'.repeat(64))
    expect(new Headers(calls[6]?.init?.headers).get('X-ResearchHub-Runtime-Token')).toBe('a'.repeat(64))
  })

  it('prepares and explicitly confirms a Thesis Kill Criterion through separate authorized routes', async () => {
    const calls: { path: string; init?: RequestInit }[] = []
    const preview = { knowledgeBaseId: 'kb-1', expectedKnowledgeBaseRevision: 7, thesisRef: 'thesis:value-driver', conditionId: 'margin-floor', revision: 1, type: 'numeric_threshold', definitionVersion: 1, definition: { metricRef: 'gross_margin', operator: 'lt', threshold: 0.2, unit: 'ratio', period: 'FY2026' }, targetClaimRefs: ['claim:driver'], origin: { kind: 'human_rule' }, definitionHash: 'definition-hash', previewHash: 'preview-hash' } as const
    const result = { status: 'confirmed', replay: false, thesisRef: 'thesis:value-driver', conditionId: 'margin-floor', criterionRevision: 1, definitionHash: 'definition-hash', knowledgeBaseId: 'kb-1', knowledgeBaseRevision: 8, committedRevision: 8, writerRunId: 'criterion-run-1' }
    const client = new RuntimeClient(async (input, init) => { calls.push({ path: String(input), init }); return json(calls.length === 1 ? bootstrap : calls.length === 2 ? preview : result) })
    await client.bootstrap()
    const prepared = await client.prepareThesisCriterion({ thesisRef: preview.thesisRef, conditionId: preview.conditionId, definition: preview.definition, targetClaimRefs: preview.targetClaimRefs, origin: preview.origin })
    expect(prepared).toEqual(preview)
    expect(calls.map((call) => call.path)).toEqual(['/api/bootstrap', '/api/production/thesis-lifecycle/criteria/prepare'])
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({ thesisRef: preview.thesisRef, conditionId: preview.conditionId, definition: preview.definition, targetClaimRefs: preview.targetClaimRefs, origin: preview.origin })
    expect(new Headers(calls[1]?.init?.headers).get('X-ResearchHub-Runtime-Token')).toBe('a'.repeat(64))
    const confirmed = await client.confirmThesisCriterion({ preview: prepared, previewHash: prepared.previewHash, expectedKnowledgeBaseRevision: prepared.expectedKnowledgeBaseRevision, workflowRunId: 'criterion-run-1' })
    expect(confirmed).toEqual(result)
    expect(calls[2]?.path).toBe('/api/production/thesis-lifecycle/criteria/confirm')
    expect(JSON.parse(String(calls[2]?.init?.body))).toEqual({ preview, previewHash: 'preview-hash', expectedKnowledgeBaseRevision: 7, workflowRunId: 'criterion-run-1' })
    expect(new Headers(calls[2]?.init?.headers).get('X-ResearchHub-Runtime-Token')).toBe('a'.repeat(64))
  })

  it('preserves stale criterion conflicts as RuntimeClientError details', async () => {
    let calls = 0
    const client = new RuntimeClient(async () => ++calls === 1 ? json(bootstrap) : json({ code: 'conflict', error: 'Knowledge Base revision changed after criterion preparation' }, 409))
    await client.bootstrap()
    await expect(client.confirmThesisCriterion({ preview: { knowledgeBaseId: 'kb', expectedKnowledgeBaseRevision: 2, thesisRef: 'thesis:t', conditionId: 'c', revision: 1, type: 'numeric_threshold', definitionVersion: 1, definition: { metricRef: 'm', operator: 'lt', threshold: 1, unit: 'x', period: 'y' }, targetClaimRefs: ['claim:c'], origin: { kind: 'human_rule' }, definitionHash: 'd', previewHash: 'p' }, previewHash: 'p', expectedKnowledgeBaseRevision: 2, workflowRunId: 'criterion-run-1' })).rejects.toMatchObject({ code: 'conflict', status: 409, message: 'Knowledge Base revision changed after criterion preparation' })
  })

  it('encodes topic API paths and filters and uses the standard error path', async () => {
    const paths: string[] = []
    const summary = { knowledgeBaseId: 'kb', schemaVersion: '0.4', revision: 3, theme: { ref: 'entity:theme-a', name: 'A', aliases: [], lifecycleStatus: 'active' }, counts: {}, overview: { direct: { nonSourceRecordsWithoutExplicitSourceRef: 0, totalExact: true, truncated: false }, connected: { nonSourceRecordsWithoutExplicitSourceRef: 0, totalExact: true, truncated: false } }, connected: { depth: 2, totalExact: true, truncated: false, focusRefs: [] } }
    const page = { knowledgeBaseId: 'kb', schemaVersion: '0.4', revision: 3, themeRef: 'entity:theme-a', kind: 'claim', scope: 'connected', depth: 2, filters: { lifecycle: 'all', claimType: 'viewpoint' }, items: [], total: 0, totalExact: true, limit: 20, truncated: false, focusRefs: [] }
    const client = new RuntimeClient(async (input) => { paths.push(String(input)); return json(paths.length === 1 ? summary : page) })
    await client.getTopicSummary('entity:theme-a', 2)
    await client.listTopicItems({ themeRef: 'entity:theme-a', kind: 'claim', scope: 'connected', depth: 2, limit: 20, cursor: 'cursor +/=secret', expectedRevision: 3, filters: { lifecycle: 'all', claimType: 'viewpoint' } })
    expect(paths).toEqual([
      '/api/knowledge/topics/entity%3Atheme-a/summary?depth=2',
      '/api/knowledge/topics/entity%3Atheme-a/items?kind=claim&scope=connected&depth=2&limit=20&cursor=cursor+%2B%2F%3Dsecret&expectedRevision=3&lifecycle=all&claimType=viewpoint',
    ])
    const rejected = new RuntimeClient(async () => json({ code: 'not_found', error: 'Theme not found' }, 404))
    await expect(rejected.getTopicSummary('entity:missing')).rejects.toMatchObject({ code: 'not_found', status: 404, message: 'Theme not found' })
    const unsafe = new RuntimeClient(async () => json({}))
    await expect(unsafe.getTopicSummary('../private')).rejects.toMatchObject({ code: 'invalid_input', status: 400 })
  })
})
