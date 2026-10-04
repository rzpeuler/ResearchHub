import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { fauxAssistantMessage, fauxProvider, fauxToolCall, type JsonObject } from '@earendil-works/pi-ai'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { createResearchHubPiSession } from '../../../app/pi/session.ts'
import { selectProductionReasoningModel } from '../../../app/pi/model-selection.ts'
import { BASH_ISOLATION_GAP, createProtectedBashOperations, createProtectedEditOperations, createProtectedWriteOperations } from '../../../app/pi/security.ts'
import { createResearchHubTools } from '../../../app/pi/tools.ts'
import { KnowledgeService } from '../../../app/services/knowledge-service.ts'
import { ProductionService } from '../../../app/services/production-service.ts'
import { ReviewService } from '../../../app/services/review-service.ts'
import { WorkflowService } from '../../../app/services/workflow-service.ts'
import type { ReasoningCapabilities, ReasoningExecutor, ReasoningRequest, ReasoningResult } from '../../../plugins/reasoning/contracts.ts'
import { PiReasoningExecutor } from '../../../plugins/reasoning/pi/executor.ts'
import { KnowledgeCurationSkill } from '../../../skills/knowledge-curation/skill.ts'
import { runRawDocumentKnowledgeIngestion } from '../../../workflows/raw-document-knowledge-ingestion/workflow.ts'
import { KnowledgeBaseRegistry } from '../../../knowledge/registry/registry.ts'
import { createKnowledgeBase, removeKnowledgeBase } from '../../knowledge/helpers.ts'

const capabilities: ReasoningCapabilities = { maxContextTokens: 100_000, maxOutputTokens: 10_000, structuredOutputSupport: true, maxConcurrency: 4 }

test('production reasoning model selection stays inside Pi ModelRuntime', async () => {
  const agentDir = await mkdtemp(join(tmpdir(), 'researchhub-pi-selection-agent-'))
  try {
    const runtime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false })
    const faux = fauxProvider({ provider: 'researchhub-selection-faux', models: [{ id: 'selection-model' }] })
    runtime.registerNativeProvider(faux.provider)
    const selected = selectProductionReasoningModel(runtime, { providerId: 'researchhub-selection-faux', modelId: 'selection-model' })
    assert.equal(selected.provider, 'researchhub-selection-faux')
    assert.equal(selected.id, 'selection-model')
  } finally { await rm(agentDir, { recursive: true, force: true }) }
})

test('Pi session ResearchRequest policy gates Knowledge and forwards persistence flags', async () => {
  const received: Record<string, unknown>[] = []; const policyContext = { current: { structuredKnowledge: false, sourceLibrary: false, writeKnowledge: false } }
  const researchService = { startResearchCompany: (value: Record<string, unknown>) => { received.push(value); return { completion: Promise.resolve({ status: 'blocked' }) } } } as never
  const tools = createResearchHubTools({ knowledgeService: { searchKnowledge: async () => ({ results: [] }) } as never, reviewService: { listOpenReviewCases: async () => ({ cases: [] }) } as never, workflowService: new WorkflowService(), productionService: { ingestDocument: async () => ({ status: 'completed' }) } as never, researchService, policyContext })
  const search = await tools.find((tool) => tool.name === 'search_knowledge')!.execute('policy-search', { query: 'blocked' }, undefined, undefined, {} as never); assert.equal(search.content[0]?.type, 'text'); if (search.content[0]?.type === 'text') assert.equal(JSON.parse(search.content[0].text).code, 'conflict')
  const ingest = await tools.find((tool) => tool.name === 'ingest_document')!.execute('policy-ingest', { workflowRunId: 'policy-ingest', text: 'blocked' }, undefined, undefined, {} as never); assert.equal(ingest.content[0]?.type, 'text'); if (ingest.content[0]?.type === 'text') assert.equal(JSON.parse(ingest.content[0].text).code, 'conflict')
  await tools.find((tool) => tool.name === 'research_company')!.execute('policy-research', { workflowRunId: 'policy-research', symbol: '600519' }, undefined, undefined, {} as never); assert.equal(received[0]!.writeKnowledge, false); assert.equal(received[0]!.useStructuredKnowledge, false)
})

class FixtureExecutor implements ReasoningExecutor {
  readonly calls: ReasoningRequest[] = []
  capabilities(): ReasoningCapabilities { return capabilities }
  async execute(request: ReasoningRequest): Promise<ReasoningResult> {
    this.calls.push(structuredClone(request))
    if (request.operation === 'understandAndPlan') return { operation: request.operation, output: { reportMap: { sourceAssessment: { summary: 'fixture', sourceType: 'unknown', reliability: 'unknown' }, researchScope: 'fixture', majorTopics: [], majorEntityMentions: [], majorConclusions: [], sectionSemantics: [{ sectionRef: 'section-0001', summary: 'fixture' }], semanticDependencies: [], themeHypotheses: [], uncertainty: [] }, extractionPlanProposal: { units: [{ proposedUnitId: 'unit-1', topic: 'fixture', semanticPurpose: 'fixture', primaryRefs: [{ kind: 'section', sectionId: 'section-0001' }], contextRefs: [] }], excludedRefs: [] } } }
    if (request.operation === 'extractKnowledge') return { operation: request.operation, output: { entities: [], relations: [], claims: [] } }
    return { operation: request.operation, output: { outcome: 'uncertain', rationale: 'fixture' } }
  }
}

test('ResearchHub custom tool enters the real Workflow/Core boundary', async () => {
  const root = await createKnowledgeBase({ knowledgeBaseId: 'kb-pi-tool' })
  try {
    const executor = new FixtureExecutor()
    const workflowService = new WorkflowService()
    const tool = createResearchHubTools({ knowledgeService: new KnowledgeService(root), reviewService: new ReviewService(root), workflowService, productionService: new ProductionService({ mountedKnowledgeBaseRoot: root, workspaceRoot: join(root, 'workspace'), reasoningExecutor: executor, workflowService }) }).find((item) => item.name === 'ingest_document')!
    const result = await tool.execute('call-1', { text: 'Fixture text', workflowRunId: 'pi-tool-run' }, undefined, undefined, {} as never)
    assert.equal(result.content.length > 0, true)
    assert.equal(executor.calls.some((call) => call.operation === 'understandAndPlan'), true)
  } finally { await removeKnowledgeBase(root) }
})

test('programmatic Pi session streams a model-selected ResearchHub tool call', async () => {
  const root = await createKnowledgeBase({ knowledgeBaseId: 'kb-pi-session' })
  let agentDir: string | undefined
  let session: Awaited<ReturnType<typeof createResearchHubPiSession>> | undefined
  try {
    const faux = fauxProvider({ provider: 'researchhub-faux', models: [{ id: 'fixture-model' }] })
    agentDir = await mkdtemp(join(tmpdir(), 'researchhub-pi-agent-'))
    const runtime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false })
    runtime.registerNativeProvider(faux.provider)
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('researchhub_status', {}, { id: 'status-call' })),
      fauxAssistantMessage('ResearchHub status was read.'),
    ])
    session = await createResearchHubPiSession({ cwd: root, agentDir, mountedKnowledgeBaseRoot: root, reasoningExecutor: new FixtureExecutor(), modelRuntime: runtime, model: faux.getModel() })
    const events: string[] = []
    session.session.subscribe((event) => { events.push(event.type) })
    await session.session.prompt('Check the mounted Knowledge Base status.')
    assert.equal(events.includes('tool_execution_start'), true)
    assert.equal(events.includes('tool_execution_end'), true)
    assert.equal(session.session.state.messages.some((message) => message.role === 'toolResult' && message.toolCallId === 'status-call'), true)
    assert.equal(session.agentDir, agentDir)
    assert.notEqual(session.agentDir, join(root, '.pi', 'agent'))
  } finally {
    session?.session.dispose()
    await removeKnowledgeBase(root)
    if (agentDir !== undefined) await rm(agentDir, { recursive: true, force: true })
  }
})

test('Pi session reuses isolated global and trusted project settings for model, thinking, and tools', async () => {
  let project: string | undefined
  let agentDir: string | undefined
  let created: Awaited<ReturnType<typeof createResearchHubPiSession>> | undefined
  try {
    project = await mkdtemp(join(tmpdir(), 'researchhub-pi-settings-project-'))
    agentDir = await mkdtemp(join(tmpdir(), 'researchhub-pi-settings-agent-'))
    const projectPi = join(project, '.pi')
    await mkdir(projectPi, { recursive: true })
    await writeFile(join(agentDir, 'settings.json'), JSON.stringify({
      defaultProvider: 'researchhub-settings-faux',
      defaultModel: 'settings-model',
      defaultThinkingLevel: 'low',
    }))
    await writeFile(join(projectPi, 'settings.json'), JSON.stringify({
      defaultThinkingLevel: 'high',
      defaultTools: ['read'],
    }))
    const faux = fauxProvider({ provider: 'researchhub-settings-faux', models: [{ id: 'settings-model', reasoning: true }] })
    const runtime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false })
    runtime.registerNativeProvider(faux.provider)
    await runtime.refresh({ allowNetwork: false })
    created = await createResearchHubPiSession({ cwd: project, agentDir, modelRuntime: runtime, reasoningExecutor: new FixtureExecutor() })
    assert.equal(created.session.state.model?.provider, 'researchhub-settings-faux')
    assert.equal(created.session.state.model?.id, 'settings-model')
    assert.equal(created.session.state.thinkingLevel, 'high')
    assert.equal(created.session.getActiveToolNames().includes('read'), true)
    assert.equal(created.session.getActiveToolNames().includes('bash'), false)
    assert.equal(created.session.getActiveToolNames().includes('edit'), false)
    assert.equal(created.session.getActiveToolNames().includes('write'), false)
    assert.equal(created.session.getActiveToolNames().includes('researchhub_status'), true)
    assert.equal(created.session.getActiveToolNames().includes('ingest_document'), true)
  } finally {
    created?.session.dispose()
    if (agentDir !== undefined) await rm(agentDir, { recursive: true, force: true })
    if (project !== undefined) await rm(project, { recursive: true, force: true })
  }
})

test('canonical mutation wrappers block write/edit and honestly identify bash isolation gap', async () => {
  let root: string | undefined
  try {
    const rootPath = await mkdtemp(join(tmpdir(), 'researchhub-pi-security-'))
    root = rootPath
    const write = createProtectedWriteOperations(rootPath, { writeFile: async () => undefined, mkdir: async () => undefined })
    await assert.rejects(() => write.writeFile(join(rootPath, 'manifest.yaml'), 'manual'), /Canonical Knowledge Base is protected/)
    const edit = createProtectedEditOperations(rootPath, { readFile: async () => Buffer.from('old'), access: async () => undefined, writeFile: async () => undefined })
    await assert.rejects(() => edit.writeFile(join(rootPath, 'manifest.yaml'), 'manual'), /Canonical Knowledge Base is protected/)
    assert.equal(BASH_ISOLATION_GAP, 'BASH_ISOLATION_GAP')
  } finally {
    if (root !== undefined) await rm(root, { recursive: true, force: true })
  }
})

test('ResearchHub tools reject duplicate input sources and cancelled Workflow start', async () => {
  const root = await createKnowledgeBase({ knowledgeBaseId: 'kb-pi-boundary' })
  try {
    const executor = new FixtureExecutor()
    const workflowService = new WorkflowService()
    const ingest = createResearchHubTools({ knowledgeService: new KnowledgeService(root), reviewService: new ReviewService(root), workflowService, productionService: new ProductionService({ mountedKnowledgeBaseRoot: root, workspaceRoot: join(root, 'workspace'), reasoningExecutor: executor, workflowService }) }).find((item) => item.name === 'ingest_document')!
    const invalid = await ingest.execute('duplicate', { text: 'x', workspaceFile: 'x', workflowRunId: 'safe-run' }, undefined, undefined, {} as never)
    assert.equal(invalid.content.length > 0, true)
    const controller = new AbortController()
    controller.abort()
    const result = await ingest.execute('cancelled', { text: 'x', workflowRunId: 'safe-run-2' }, controller.signal, undefined, {} as never)
    assert.equal(result.content.length > 0, true)
    assert.equal(executor.calls.length, 0)
  } finally { await removeKnowledgeBase(root) }
})

test('Pi research_event routes the exact EventResearchInput to the Application Service', async () => {
  const received: Record<string, unknown>[] = []
  const researchService = {
    startEventResearch: (input: Record<string, unknown>) => {
      received.push(input)
      return { runId: input.workflowRunId, completion: Promise.resolve({ status: 'completed', runId: input.workflowRunId, knowledgeBaseId: 'kb-event-tool', committedIds: [], proposalCount: 0, summary: 'fixture', telemetry: {}, providerOutcome: [] }) }
    },
  } as never
  const context = { knowledgeService: {} as KnowledgeService, productionService: {} as ProductionService, reviewService: {} as ReviewService, workflowService: new WorkflowService(), researchService }
  const tool = createResearchHubTools(context).find((item) => item.name === 'research_event')!
  const input = { workflowRunId: 'event-tool-routing', symbol: '600519', exchange: 'SSE', asOf: '2026-09-08T23:59:59.000Z', anchor: { kind: 'user_event', title: 'Fixture event', description: 'A bounded fixture event.', eventDate: '2026-09-08' } }
  const result = await tool.execute('event-tool-call', input, undefined, undefined, {} as never)
  assert.equal(result.content[0]?.type, 'text')
  assert.deepEqual(received, [input])
})

test('Pi research_industry is configuration-gated and delegates the validated Application input once', async () => {
  const baseContext = { knowledgeService: {} as KnowledgeService, productionService: {} as ProductionService, reviewService: {} as ReviewService, workflowService: new WorkflowService() }
  assert.equal(createResearchHubTools(baseContext).some((tool) => tool.name === 'research_industry'), false)
  const received: Record<string, unknown>[] = []
  const input = { workflowRunId: 'industry-tool-routing', name: 'PCB', aliases: ['印制电路板'], searchTerms: ['PCB'], asOf: '2026-09-08T00:00:00.000Z', maxSources: 4, maxEvidencePerModule: 2 }
  const researchService = { startIndustryResearch: (value: Record<string, unknown>) => { received.push(value); return { runId: value.workflowRunId as string, completion: Promise.resolve({ runId: value.workflowRunId, status: 'completed', knowledgeBaseId: 'kb-industry-tool', reportPath: 'industry-tool-routing.md', committedIds: ['entity:industry-pcb'], proposalCount: 1, summary: 'bounded fixture', providerOutcomes: [{ provider: 'fixture', providerSucceeded: true }], acquisitionDiagnostics: ['bounded'] }) } } } as never
  const tools = createResearchHubTools({ ...baseContext, researchService })
  const tool = tools.find((item) => item.name === 'research_industry')!
  assert.ok(tool)
  const parameterKeys = Object.keys(((tool as unknown as { parameters: { properties: Record<string, unknown> } }).parameters).properties)
  assert.deepEqual(parameterKeys.sort(), ['aliases', 'asOf', 'canonicalRef', 'maxEvidencePerModule', 'maxSources', 'name', 'searchTerms', 'workflowRunId'].sort())
  const result = await tool.execute('industry-tool-call', input, undefined, undefined, {} as never)
  assert.equal(received.length, 1)
  assert.deepEqual(received, [input])
  assert.equal(result.content[0]?.type, 'text')
  const serialized = result.content[0]?.type === 'text' ? result.content[0].text : ''
  assert.deepEqual(JSON.parse(serialized), { runId: 'industry-tool-routing', status: 'completed', knowledgeBaseId: 'kb-industry-tool', reportPath: 'industry-tool-routing.md', committedIds: ['entity:industry-pcb'], proposalCount: 1, summary: 'bounded fixture', providerOutcomes: [{ provider: 'fixture', providerSucceeded: true }], acquisitionDiagnostics: ['bounded'] })
  assert.doesNotMatch(serialized, /normalized|raw|cookie|credential|authorization|telemetry|[A-Za-z]:\\|\//i)
})

test('Pi tool-call boundary rejects direct write, edit, and explicit-path bash mutation attempts', async () => {
  const root = await createKnowledgeBase({ knowledgeBaseId: 'kb-pi-protected' })
  try {
    const attempts: Array<{ name: string; arguments: JsonObject }> = [
      { name: 'write', arguments: { path: join(root, 'manifest.yaml'), content: 'manual' } },
      { name: 'write', arguments: { path: 'manifest.yaml', content: 'manual' } },
      { name: 'edit', arguments: { path: join(root, 'manifest.yaml'), edits: [{ oldText: 'active', newText: 'archived' }] } },
      { name: 'edit', arguments: { path: 'manifest.yaml', edits: [{ oldText: 'active', newText: 'archived' }] } },
      { name: 'bash', arguments: { command: `echo manual > "${join(root, 'manifest.yaml')}"` } },
      { name: 'bash', arguments: { command: 'echo manual > manifest.yaml' } },
    ]
    for (const [index, attempt] of attempts.entries()) {
      let agentDir: string | undefined
      let created: Awaited<ReturnType<typeof createResearchHubPiSession>> | undefined
      try {
        const faux = fauxProvider({ provider: `researchhub-protected-${index}`, models: [{ id: 'fixture-model' }] })
        agentDir = await mkdtemp(join(tmpdir(), 'researchhub-pi-agent-'))
        const runtime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false })
        runtime.registerNativeProvider(faux.provider)
        faux.setResponses([fauxAssistantMessage(fauxToolCall(attempt.name, attempt.arguments, { id: `blocked-${index}` })), fauxAssistantMessage('blocked')])
        created = await createResearchHubPiSession({ cwd: root, agentDir, mountedKnowledgeBaseRoot: root, reasoningExecutor: new FixtureExecutor(), modelRuntime: runtime, model: faux.getModel() })
        await created.session.prompt('Attempt the requested operation.')
        const blocked = created.session.state.messages.find((message) => message.role === 'toolResult' && message.toolCallId === `blocked-${index}`)
        assert.equal(blocked?.role, 'toolResult', `${attempt.name} must produce a tool result`)
        if (blocked?.role === 'toolResult') assert.equal(blocked.isError, true, `${attempt.name} must fail before canonical mutation`)
      } finally {
        created?.session.dispose()
        if (agentDir !== undefined) await rm(agentDir, { recursive: true, force: true })
      }
    }
  } finally { await removeKnowledgeBase(root) }
})

test('Pi-backed deterministic ingestion derives four-way ExtractionUnit concurrency', async () => {
  const root = await createKnowledgeBase({ knowledgeBaseId: 'kb-pi-concurrency' })
  let active = 0
  let peak = 0
  const executor = new PiReasoningExecutor({
    completion: async (_model, _context, options) => {
      if (options.metadata.operation === 'understandAndPlan') return JSON.stringify({
        reportMap: { sourceAssessment: { summary: 'fixture', sourceType: 'unknown', reliability: 'unknown' }, researchScope: 'fixture', majorTopics: [], majorEntityMentions: [], majorConclusions: [], sectionSemantics: [{ sectionRef: 'section-0001', summary: 'fixture' }], semanticDependencies: [], themeHypotheses: [], uncertainty: [] },
        extractionPlanProposal: {
          units: ['000001', '000002', '000003', '000004'].map((id) => ({ proposedUnitId: `unit-${id}`, topic: 'fixture', semanticPurpose: 'independent fixture extraction', primaryRefs: [{ kind: 'block', blockId: `block-${id}` }], contextRefs: [] })),
          excludedRefs: [],
        },
      })
      if (options.metadata.operation === 'extractKnowledge') {
        active += 1
        peak = Math.max(peak, active)
        await new Promise((resolve) => setTimeout(resolve, 20))
        active -= 1
        return JSON.stringify({ entities: [], relations: [], claims: [] })
      }
      return JSON.stringify({ outcome: 'uncertain', rationale: 'deterministic fixture' })
    },
  })
  try {
    const result = await runRawDocumentKnowledgeIngestion({
      handle: await new KnowledgeBaseRegistry().mount(root),
      documentInput: { type: 'text', text: 'Alpha.\n\nBeta.\n\nGamma.\n\nDelta.', originalFilename: 'pi-concurrency.txt', mediaType: 'text/plain' },
      skill: new KnowledgeCurationSkill({ executor }),
      workflowRunId: 'pi-concurrency-run',
      config: { maxConcurrency: 4 },
    })
    assert.equal(executor.capabilities().maxConcurrency, 4)
    assert.equal(result.acceptedPlan?.units.length, 4)
    assert.equal(result.extractionConcurrency, 4)
    assert.equal(result.peakExtractionConcurrency, 4)
    assert.equal(peak, 4)
  } finally { await removeKnowledgeBase(root) }
})

test('nested canonical Knowledge Base blocks absolute and cwd-relative write/edit/bash paths', async () => {
  let projectRoot: string | undefined
  let temporaryRoot: string | undefined
  let agentDir: string | undefined
  try {
    const projectRootPath = await mkdtemp(join(tmpdir(), 'researchhub-pi-project-'))
    projectRoot = projectRootPath
    const temporaryRootPath = await createKnowledgeBase({ knowledgeBaseId: 'kb-test' })
    temporaryRoot = temporaryRootPath
    const knowledgeBaseRoot = join(projectRootPath, 'runtime-data', 'knowledge-bases', 'kb-test')
    const agentDirPath = await mkdtemp(join(tmpdir(), 'researchhub-pi-agent-'))
    agentDir = agentDirPath
    await mkdir(dirname(knowledgeBaseRoot), { recursive: true })
    await rename(temporaryRootPath, knowledgeBaseRoot)
    const relativeManifest = relative(projectRootPath, join(knowledgeBaseRoot, 'manifest.yaml'))

    const write = createProtectedWriteOperations(knowledgeBaseRoot, { writeFile: async () => undefined, mkdir: async () => undefined }, projectRootPath)
    await assert.rejects(() => write.writeFile(join(knowledgeBaseRoot, 'manifest.yaml'), 'manual'), /Canonical Knowledge Base is protected/)
    await assert.rejects(() => write.writeFile(relativeManifest, 'manual'), /Canonical Knowledge Base is protected/)

    const edit = createProtectedEditOperations(knowledgeBaseRoot, { readFile: async () => Buffer.from('old'), access: async () => undefined, writeFile: async () => undefined }, projectRootPath)
    await assert.rejects(() => edit.writeFile(join(knowledgeBaseRoot, 'manifest.yaml'), 'manual'), /Canonical Knowledge Base is protected/)
    await assert.rejects(() => edit.writeFile(relativeManifest, 'manual'), /Canonical Knowledge Base is protected/)

    const bashCalls: string[] = []
    const bash = createProtectedBashOperations(knowledgeBaseRoot, { exec: async (command) => { bashCalls.push(command); return { exitCode: 0 } } })
    const options = { onData: () => undefined }
    await assert.rejects(() => bash.exec(`echo manual > "${join(knowledgeBaseRoot, 'manifest.yaml')}"`, projectRootPath, options), /Canonical Knowledge Base is protected/)
    await assert.rejects(() => bash.exec(`echo manual > "${relativeManifest}"`, projectRootPath, options), /Canonical Knowledge Base is protected/)
    await bash.exec('echo harmless', projectRootPath, options)
    const archivePath = join(projectRootPath, 'runtime-data', 'knowledge-bases', 'kb-test-archive', 'manifest.yaml')
    const archiveRelativePath = relative(projectRootPath, archivePath)
    await bash.exec(`echo harmless > "${archivePath}"`, projectRootPath, options)
    await bash.exec(`echo harmless > "${archiveRelativePath}"`, projectRootPath, options)
    assert.deepEqual(bashCalls, ['echo harmless', `echo harmless > "${archivePath}"`, `echo harmless > "${archiveRelativePath}"`])

    const faux = fauxProvider({ provider: 'researchhub-nested-protected', models: [{ id: 'fixture-model' }] })
    const runtime = await ModelRuntime.create({ authPath: join(agentDirPath, 'auth.json'), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false })
    runtime.registerNativeProvider(faux.provider)
    const attempts: Array<{ name: string; arguments: JsonObject }> = [
      { name: 'write', arguments: { path: join(knowledgeBaseRoot, 'manifest.yaml'), content: 'manual' } },
      { name: 'write', arguments: { path: relativeManifest, content: 'manual' } },
      { name: 'edit', arguments: { path: join(knowledgeBaseRoot, 'manifest.yaml'), edits: [{ oldText: 'active', newText: 'archived' }] } },
      { name: 'edit', arguments: { path: relativeManifest, edits: [{ oldText: 'active', newText: 'archived' }] } },
      { name: 'bash', arguments: { command: `echo manual > "${join(knowledgeBaseRoot, 'manifest.yaml')}"` } },
      { name: 'bash', arguments: { command: `echo manual > "${relativeManifest}"` } },
    ]
    for (const [index, attempt] of attempts.entries()) {
      faux.setResponses([fauxAssistantMessage(fauxToolCall(attempt.name, attempt.arguments, { id: `nested-blocked-${index}` })), fauxAssistantMessage('blocked')])
      let created: Awaited<ReturnType<typeof createResearchHubPiSession>> | undefined
      try {
        created = await createResearchHubPiSession({ cwd: projectRootPath, agentDir: agentDirPath, mountedKnowledgeBaseRoot: knowledgeBaseRoot, reasoningExecutor: new FixtureExecutor(), modelRuntime: runtime, model: faux.getModel() })
        await created.session.prompt('Attempt the requested operation.')
        const blocked = created.session.state.messages.find((message) => message.role === 'toolResult' && message.toolCallId === `nested-blocked-${index}`)
        assert.equal(blocked?.role, 'toolResult')
        if (blocked?.role === 'toolResult') assert.equal(blocked.isError, true)
      } finally {
        created?.session.dispose()
      }
    }
  } finally {
    if (agentDir !== undefined) await rm(agentDir, { recursive: true, force: true })
    if (projectRoot !== undefined) await rm(projectRoot, { recursive: true, force: true })
    if (temporaryRoot !== undefined) await rm(temporaryRoot, { recursive: true, force: true })
  }
})
