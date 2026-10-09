import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ResearchDispatchService, extractWorkflowArguments } from '../../../app/services/research-dispatch-service.ts'
import { createWorkflowDefinitionRegistry } from '../../../app/services/workflow-registry.ts'
import { ResearchSkillRegistry } from '../../../app/services/skill-registry.ts'
import { createFreshKnowledgeBaseV04 } from '../../../knowledge/storage/index.ts'
import type { ReasoningRequest } from '../../../plugins/reasoning/contracts.ts'

const NOW = '2026-10-09T08:00:00.000Z'
async function identityKnowledgeBase(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'rhl-exec-001-dispatch-kb-'))
  await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: `exec-001-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, now: NOW })
  const assets = {
    'entity:fixture-company': { type: 'entity', storageRef: 'entities/fixture-company.yaml' },
    'claim:fixture-claim': { type: 'claim', storageRef: 'claims/fixture-claim.yaml' },
    'thesis:fixture-thesis': { type: 'thesis', storageRef: 'theses/fixture-thesis.yaml' },
  }
  await writeFile(join(root, 'entities', 'fixture-company.yaml'), JSON.stringify({ id: 'entity:fixture-company', type: 'company', name: '贵州茅台', aliases: ['茅台'], ticker: '600519', exchange: 'SSE', lifecycle: { status: 'active' } }) + '\n')
  await writeFile(join(root, 'claims', 'fixture-claim.yaml'), JSON.stringify({ id: 'claim:fixture-claim', claimType: 'fact', statement: 'Fixture canonical claim.', subjectRefs: ['entity:fixture-company'], sourceRefs: [], lifecycle: { status: 'active' } }) + '\n')
  await writeFile(join(root, 'theses', 'fixture-thesis.yaml'), JSON.stringify({ id: 'thesis:fixture-thesis', title: 'Fixture thesis', lifecycle: { status: 'active' } }) + '\n')
  await writeFile(join(root, 'registry', 'assets.yaml'), JSON.stringify(assets) + '\n')
  return root
}

function semanticExecutor(output: unknown, onRequest?: (request: ReasoningRequest) => void) {
  return {
    capabilities: () => ({ maxContextTokens: 100_000, maxOutputTokens: 10_000, structuredOutputSupport: true, maxConcurrency: 1 }),
    async execute(request: ReasoningRequest) { onRequest?.(request); return { operation: request.operation, output } },
  }
}

test('explicit Earnings Review extracts company, fiscal year, and half-year period', () => {
  const registry = createWorkflowDefinitionRegistry()
  const result = extractWorkflowArguments(registry.get('earnings_review')!, '帮我分析 600519 2026 年半年报相比去年最重要的变化。')
  assert.deepEqual(result.arguments, { symbol: '600519', fiscalYear: 2026, period: 'H1' })
  assert.deepEqual(result.missingRequiredInputs, [])
})

test('Free Research prefers a matching existing Workflow over a Skill plan', () => {
  const resolved = new ResearchDispatchService().resolve({ query: '研究 600519 2026 年半年报', mode: { type: 'free_research' }, contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: false } })
  assert.equal(resolved.decision.mode, 'workflow')
  assert.equal(resolved.decision.workflow?.id, 'earnings_review')
  assert.equal(resolved.summary.mode, 'Free Research')
})

test('explicit Workflow selection is never replaced by automatic routing', () => {
  const resolved = new ResearchDispatchService().resolve({ query: '研究 600519 2026 年半年报', mode: { type: 'workflow', workflowId: 'valuation' }, contextPolicy: { structuredKnowledge: false, sourceLibrary: false }, persistencePolicy: { writeKnowledge: true } })
  assert.equal(resolved.decision.workflow?.id, 'valuation')
  assert.equal(resolved.decision.missingRequiredInputs.includes('symbol'), false)
  assert.deepEqual(resolved.decision.contextPolicy, { structuredKnowledge: false, sourceLibrary: false })
  assert.deepEqual(resolved.decision.persistencePolicy, { writeKnowledge: true })
})

test('Free Research falls back to an eligible research Skill, then to free mode', () => {
  const skill = new ResearchDispatchService({ skillRegistry: new ResearchSkillRegistry([{ id: 'custom-methodology', kind: 'research', researchCapability: 'custom_research', intentDescription: 'Custom methodology', whenToUse: 'custom-methodology', enabled: true, scope: 'researchhub' }]) }).resolve({ query: 'custom-methodology', mode: { type: 'free_research' } })
  assert.equal(skill.decision.mode, 'skill_plan')
  assert.deepEqual(skill.decision.skills.map((item) => item.id), ['custom-methodology'])
  const free = new ResearchDispatchService().resolve({ query: '请帮我整理一个完全泛化的想法' })
  assert.equal(free.decision.mode, 'free_research')
})

test('English FY notation and explicit Daily Intelligence are dispatched with complete arguments', () => {
  const service = new ResearchDispatchService()
  const earnings = service.resolve({ query: 'Review FY2026 earnings for 600519', mode: { type: 'free_research' } })
  assert.equal(earnings.decision.workflow?.id, 'earnings_review')
  assert.deepEqual(earnings.decision.workflow?.arguments, { symbol: '600519', fiscalYear: 2026, period: 'FY' })
  const daily = service.resolve({ query: '生成 morning brief 2026-09-17', mode: { type: 'workflow', workflowId: 'daily_intelligence' } })
  assert.deepEqual(daily.decision.workflow?.arguments, { briefType: 'morning', tradeDate: '2026-09-17' })
  assert.deepEqual(daily.decision.missingRequiredInputs, [])
})

test('Theme Framework intent routes to the governed Workflow and extracts the Theme name', () => {
  const service = new ResearchDispatchService()
  const resolved = service.resolve({ query: '请创建 AI 算力投资主题框架', mode: { type: 'free_research' } })
  assert.equal(resolved.decision.mode, 'workflow')
  assert.equal(resolved.decision.workflow?.id, 'theme_framework')
  assert.deepEqual(resolved.decision.workflow?.arguments, { name: 'AI 算力' })
  assert.deepEqual(resolved.decision.skills, [])
  assert.deepEqual(service.workflowRegistry.get('theme_framework')?.knowledgeSkillIds, ['theme-framework'])
  assert.equal(service.skillRegistry.get('theme-framework')?.kind, 'knowledge')
})

test('explicit Theme Framework accepts a short bare Chinese or English Theme name', () => {
  const service = new ResearchDispatchService()
  for (const [query, expectedName] of [['AI 算力', 'AI 算力'], ['AI compute', 'AI compute']] as const) {
    const resolved = service.resolve({ query, mode: { type: 'workflow', workflowId: 'theme_framework' } })
    assert.deepEqual(resolved.decision.workflow?.arguments, { name: expectedName }, query)
    assert.deepEqual(resolved.decision.missingRequiredInputs, [], query)
  }
})

test('explicit Theme Framework retains phrase extraction and rejects a question as a bare name', () => {
  const service = new ResearchDispatchService()
  const phrase = service.resolve({ query: '请创建 AI 算力投资主题框架', mode: { type: 'workflow', workflowId: 'theme_framework' } })
  assert.deepEqual(phrase.decision.workflow?.arguments, { name: 'AI 算力' })
  const question = service.resolve({ query: 'AI 算力目前的发展趋势有哪些', mode: { type: 'workflow', workflowId: 'theme_framework' } })
  assert.equal(question.decision.workflow?.arguments.name, undefined)
  assert.deepEqual(question.decision.missingRequiredInputs, ['name'])
})

test('automatic routing does not treat an unqualified Theme name as Theme Framework intent', () => {
  const resolved = new ResearchDispatchService().resolve({ query: 'AI 算力' })
  assert.equal(resolved.decision.mode, 'free_research')
})

test('semantic Chat routing sees the narrow Theme Framework knowledge Skill metadata', async () => {
  let metadata: unknown
  const service = new ResearchDispatchService({ reasoningExecutor: {
    capabilities: () => ({ maxContextTokens: 4_000, maxOutputTokens: 2_000, structuredOutputSupport: true, maxConcurrency: 1 }),
    async execute(request) {
      metadata = (request.input as { knowledgeSkillMetadata?: unknown }).knowledgeSkillMetadata
      return { operation: request.operation, output: { mode: 'workflow', workflow: { id: 'theme_framework', confidence: 0.98, arguments: { name: 'AI 算力' } }, skills: [], entities: [], missingRequiredInputs: [], contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: false }, rationale: 'Explicit Theme Framework intent.' } }
    },
  } })
  const resolved = await service.resolveAsync({ query: '初始化 AI 算力主题框架', mode: { type: 'free_research' } })
  assert.equal(resolved.decision.workflow?.id, 'theme_framework')
  assert.deepEqual((metadata as readonly { id: string; kind: string }[]).map(({ id, kind }) => ({ id, kind })), [{ id: 'theme-framework', kind: 'knowledge' }])
})

test('Theme Framework dispatch returns only the safe review candidate projection', async () => {
  const calls: unknown[] = []
  let safeView: unknown
  const themeFrameworkService = {
    start(input: { readonly workflowRunId: string }) { calls.push(input); return { runId: input.workflowRunId, completion: Promise.resolve({ status: 'awaiting_review', workflowRunId: input.workflowRunId }) } },
    async getReviewCandidate(workflowRunId: string) { safeView = { status: 'awaiting_review', workflowRunId, candidate: { knowledgeBaseId: 'kb-safe', basedOnRevision: 1, theme: { name: 'AI 算力' }, framework: { industryCandidates: [], relationCandidates: [] }, acquisitionStatus: 'unavailable', diagnostics: [], evidence: [{ evidenceId: 'evidence-1', summary: 'Public source', sourceRef: 'source:safe' }] } }; return safeView },
  }
  const service = new ResearchDispatchService({ themeFrameworkService: themeFrameworkService as never })
  const started = service.start({ query: '请创建 AI 算力投资主题框架', mode: { type: 'workflow', workflowId: 'theme_framework' } })
  assert.equal(started.status, 'started')
  const result = await started.completion
  assert.deepEqual(calls, [{ workflowRunId: started.runId, name: 'AI 算力' }])
  assert.deepEqual(result, safeView)
  assert.equal(JSON.stringify(result).includes('rawRef'), false)
})

test('started dispatch persists one ResearchBundle from the workflow result and forwards policy', async () => {
  const knowledgeBase = await identityKnowledgeBase()
  const calls: unknown[] = []
  const store = new (class { readonly values = new Map<string, unknown>(); async put(bundle: { bundleId: string }) { this.values.set(bundle.bundleId, bundle) }; async get(id: string) { return this.values.get(id) }; async list() { return [...this.values.values()] } })()
  const research = ({ startEarningsReview: (input: unknown) => { calls.push(input); return { completion: Promise.resolve({ status: 'completed', report: { reportId: 'earnings-report', outputPath: 'earnings-report.md' }, research: { proposals: [{ proposalId: 'earnings-proposal', kind: 'claim' }] } }) } } } as never)
  try {
    const service = new ResearchDispatchService({ researchService: research, bundleStore: store as never, mountedKnowledgeBaseRoot: knowledgeBase })
    const started = await service.startAsync({ query: '600519 2026 年半年报', mode: { type: 'workflow', workflowId: 'earnings_review' }, contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: false } })
    assert.equal(started.status, 'started')
    await started.completion
    assert.equal((calls[0] as { writeKnowledge: boolean }).writeKnowledge, false)
    const bundle = await service.getBundle(`research-bundle-${started.runId!}`) as { report?: { reportId: string }; proposals: readonly { proposalId: string }[] }
    assert.equal(bundle.report?.reportId, 'earnings-report'); assert.deepEqual(bundle.proposals.map((item) => item.proposalId), ['earnings-proposal'])
  } finally { await rm(knowledgeBase, { recursive: true, force: true }) }
})

test('session-bound ResearchBundle is finalized from the captured assistant output', async () => {
  const values = new Map<string, any>(); const store = { async put(bundle: any) { values.set(bundle.bundleId, bundle) }, async get(id: string) { return values.get(id) }, async list() { return [...values.values()] } }
  const service = new ResearchDispatchService({ bundleStore: store as never }); const started = service.start({ query: '整理一个泛化研究问题' }); assert.equal(started.status, 'free_research'); assert.ok(started.runId)
  await service.completeSessionResearch(started.runId!, 'captured assistant answer')
  const bundle = values.get(`research-bundle-${started.runId!}`); assert.equal(bundle.status, 'completed'); assert.deepEqual(bundle.structuredResult, { status: 'completed', executionBoundary: 'session', answer: 'captured assistant answer', selectedSkills: [], sourceLibraryHits: [], entities: [], evidenceRefs: [], proposalCandidates: [] })
})

test('Name-only company mentions are unresolved without Knowledge or semantic identity evidence', () => {
  const resolved = new ResearchDispatchService().resolve({ query: '研究贵州茅台 2026 年半年报', mode: { type: 'workflow', workflowId: 'earnings_review' } })
  assert.equal(resolved.decision.missingRequiredInputs.includes('symbol'), true)
})

test('synchronous compatibility dispatch rejects unverified company references before invoking an adapter', () => {
  let starts = 0
  const service = new ResearchDispatchService({ researchService: ({ startValuation: () => { starts += 1; return { completion: Promise.resolve({ status: 'completed' }) } } } as never) })
  const result = service.start({ query: '当前 600519 的估值水平如何？', mode: { type: 'workflow', workflowId: 'valuation' } })
  assert.equal(result.status, 'unresolved_reference')
  assert.equal(result.runId, undefined)
  assert.equal(result.feedback?.status, 'UNRESOLVED_REFERENCE')
  assert.equal(starts, 0)
})

test('semantic resolver uses the ReasoningExecutor boundary and repairs one invalid output', async () => {
  const calls: string[] = []
  const valid = { mode: 'workflow', workflow: { id: 'earnings_review', confidence: 0.93, arguments: { symbol: '600519', fiscalYear: 2026, period: 'H1', name: '贵州茅台' } }, skills: [], entities: [{ type: 'company', value: '贵州茅台', confidence: 0.99 }], missingRequiredInputs: [], contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: false }, rationale: 'Semantic earnings intent.' }
  const service = new ResearchDispatchService({ reasoningExecutor: { capabilities: () => ({ maxContextTokens: 1000, maxOutputTokens: 1000, structuredOutputSupport: true, maxConcurrency: 1 }), execute: async (request) => { calls.push(request.operation); return { operation: request.operation, output: calls.length === 1 ? { mode: 'workflow' } : valid } } } })
  const resolved = await service.resolveAsync({ query: '最近一次披露后贵州茅台经营变化最值得关注什么？' })
  assert.equal(resolved.decision.workflow?.id, 'earnings_review'); assert.equal(resolved.decision.workflow?.arguments.symbol, '600519'); assert.deepEqual(calls, ['research_dispatch_resolution', 'research_dispatch_resolution']); assert.equal(resolved.resolution.source, 'bounded_repair')
})

test('semantic resolver cannot replace an explicit Workflow or policy', async () => {
  const service = new ResearchDispatchService({ reasoningExecutor: { capabilities: () => ({ maxContextTokens: 1000, maxOutputTokens: 1000, structuredOutputSupport: true, maxConcurrency: 1 }), execute: async (request) => ({ operation: request.operation, output: { mode: 'workflow', workflow: { id: 'company_research', confidence: 1, arguments: { symbol: '600519' } }, skills: [], entities: [], missingRequiredInputs: [], contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: false }, rationale: 'attempted replacement' } }) } })
  const resolved = await service.resolveAsync({ query: '请估值 600519', mode: { type: 'workflow', workflowId: 'valuation' }, contextPolicy: { structuredKnowledge: false, sourceLibrary: false }, persistencePolicy: { writeKnowledge: true } })
  assert.equal(resolved.decision.workflow?.id, 'valuation'); assert.deepEqual(resolved.decision.contextPolicy, { structuredKnowledge: false, sourceLibrary: false }); assert.equal(resolved.resolution.source, 'deterministic_fallback')
})

test('semantic Workflow decisions reject mapped but unavailable canonical Skills', async () => {
  const cases = [
    { workflowId: 'company_research', unavailableSkill: 'research_qc', query: '研究 600519 公司' },
    { workflowId: 'earnings_review', unavailableSkill: 'earnings_call_analysis', query: '研究 600519 2026 年半年报' },
    { workflowId: 'industry_research', unavailableSkill: 'research_qc', query: '研究 PCB 行业' },
  ] as const
  for (const item of cases) {
    let calls = 0
    const service = new ResearchDispatchService({
      reasoningExecutor: {
        capabilities: () => ({ maxContextTokens: 1000, maxOutputTokens: 1000, structuredOutputSupport: true, maxConcurrency: 1 }),
        execute: async (request) => {
          calls += 1
          const argumentsValue = item.workflowId === 'company_research'
            ? { symbol: '600519' }
            : item.workflowId === 'earnings_review'
              ? { symbol: '600519', fiscalYear: 2026, period: 'H1' }
              : { name: 'PCB' }
          return {
            operation: request.operation,
            output: {
              mode: 'workflow',
              workflow: { id: item.workflowId, confidence: 1, arguments: argumentsValue },
              skills: [{ id: item.unavailableSkill, purpose: 'future peer capability' }],
              entities: [],
              missingRequiredInputs: [],
              contextPolicy: { structuredKnowledge: true, sourceLibrary: true },
              persistencePolicy: { writeKnowledge: false },
              rationale: 'fixture proposes an unavailable mapped peer',
            },
          }
        },
      },
    })
    const resolved = await service.resolveAsync({ query: item.query, mode: { type: 'free_research' } })
    assert.equal(calls, 2, item.workflowId)
    assert.equal(resolved.resolution.source, 'deterministic_fallback', item.workflowId)
    assert.equal(resolved.decision.workflow?.id, item.workflowId)
    assert.equal(resolved.decision.skills.some((skill) => skill.id === item.unavailableSkill), false, item.workflowId)
    assert.equal(resolved.decision.skills.every((skill) => { const definition = service.skillRegistry.get(skill.id); return definition?.kind === 'research' && definition.enabled === true && (definition.origin !== 'canonical' || definition.catalogStatus === 'IMPLEMENTED') }), true, item.workflowId)
  }
})

test('industry depth queries route to the narrow executable canonical Skill', () => {
  const service = new ResearchDispatchService()
  const cases = [
    ['这个市场的边界和细分市场怎么定义？', 'market_structure_analysis'],
    ['这个行业库存、产能利用率和供需周期如何？', 'industry_supply_demand_cycle'],
    ['哪些公司是真正的竞争对手，市场份额如何比较？', 'competitive_market_map'],
  ] as const
  for (const [query, expected] of cases) {
    const result = service.resolve({ query, mode: { type: 'free_research' } })
    assert.equal(result.decision.mode, 'skill_plan', query)
    assert.deepEqual(result.decision.skills.map((item) => item.id), [expected], query)
  }
})

test('Workflow contract missing inputs return structured NEEDS_INPUT and never call an adapter', async () => {
  let starts = 0
  const output = { mode: 'workflow', workflow: { id: 'earnings_review', confidence: 0.98, arguments: { symbol: '600519', name: '贵州茅台', fiscalYear: 2026 } }, skills: [], entities: [], missingRequiredInputs: [], contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: false }, rationale: 'Annual report review.' }
  const service = new ResearchDispatchService({ reasoningExecutor: semanticExecutor(output), researchService: ({ startEarningsReview: () => { starts += 1; return { completion: Promise.resolve({ status: 'completed' }) } } } as never) })
  const result = await service.startAsync({ query: '研究贵州茅台 2026 年半年报', mode: { type: 'workflow', workflowId: 'earnings_review' } })
  assert.equal(result.status, 'needs_input')
  assert.equal(result.feedback?.status, 'NEEDS_INPUT')
  assert.deepEqual(result.feedback?.missingFields, ['period'])
  assert.deepEqual(result.feedback?.validatedArguments, { symbol: '600519', name: '贵州茅台', fiscalYear: 2026 })
  assert.match(result.feedback?.suggestedQuestion ?? '', /报告期间/)
  assert.deepEqual(result.decision.missingRequiredInputs, ['period'])
  assert.equal(starts, 0)
})

test('Registered Workflow argument schemas reject unknown fields and get one bounded repair attempt', async () => {
  const calls: unknown[] = []
  const invalid = { mode: 'workflow', workflow: { id: 'earnings_review', confidence: 1, arguments: { symbol: '600519', fiscalYear: 2026, period: 'Q4', invented: 'value' } }, skills: [], entities: [], missingRequiredInputs: [], contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: false }, rationale: 'Invalid period and field.' }
  const service = new ResearchDispatchService({ reasoningExecutor: semanticExecutor(invalid, (request) => calls.push(request.input)) })
  const result = await service.resolveAsync({ query: '研究 600519 2026 年半年报', mode: { type: 'workflow', workflowId: 'earnings_review' } })
  assert.equal(calls.length, 2)
  assert.equal(result.resolution.source, 'deterministic_fallback')
  assert.ok(result.resolution.diagnostics.some((item) => item.includes('invented')))
  assert.equal(result.decision.workflow?.arguments.invented, undefined)
  assert.equal(result.decision.workflow?.arguments.period, 'H1')
})

test('Valuation current and historical dispatch use an injected clock without inventing an asOf', async () => {
  const knowledgeBase = await identityKnowledgeBase()
  try {
    const inputs: Record<string, unknown>[] = []
    const requests: Record<string, unknown>[] = []
    const research = { startValuation(input: Record<string, unknown>) { inputs.push(input); return { completion: Promise.resolve({ status: 'blocked', blockedReason: 'COMPANY_COVERAGE_NOT_FOUND' }) } } }
    const output = { mode: 'workflow', workflow: { id: 'valuation', confidence: 1, arguments: { symbol: '600519', name: '贵州茅台' } }, skills: [], entities: [], missingRequiredInputs: [], contextPolicy: { structuredKnowledge: true, sourceLibrary: false }, persistencePolicy: { writeKnowledge: false }, rationale: 'Current valuation.' }
    const service = new ResearchDispatchService({ mountedKnowledgeBaseRoot: knowledgeBase, reasoningExecutor: semanticExecutor(output, (request) => requests.push(request.input as Record<string, unknown>)), researchService: research as never, clock: () => new Date(NOW) })
    const current = await service.startAsync({ query: '当前贵州茅台的估值水平如何？', mode: { type: 'workflow', workflowId: 'valuation' }, contextPolicy: { structuredKnowledge: true, sourceLibrary: false }, persistencePolicy: { writeKnowledge: false } })
    assert.equal(current.status, 'started')
    assert.equal(Object.hasOwn(inputs[0]!, 'asOf'), true)
    assert.equal(inputs[0]!.asOf, undefined)
    assert.equal(((requests[0]!.runtimeContext as Record<string, unknown>).requestTimestamp), NOW)
    assert.deepEqual((requests[0]!.runtimeContext as Record<string, unknown>).persistencePolicy, { writeKnowledge: false })
    const historical = await service.startAsync({ query: '请按截至2025-06-30时点估值贵州茅台', mode: { type: 'workflow', workflowId: 'valuation' }, contextPolicy: { structuredKnowledge: true, sourceLibrary: false }, persistencePolicy: { writeKnowledge: false } })
    assert.equal(historical.status, 'started')
    assert.equal(inputs[1]!.asOf, '2025-06-30T23:59:59.999Z')
    assert.equal(await historical.completion instanceof Object, true)
    const zoned = await service.startAsync({ query: '请按截至2025-06-30T15:00:00+08:00时点估值贵州茅台', mode: { type: 'workflow', workflowId: 'valuation' }, contextPolicy: { structuredKnowledge: true, sourceLibrary: false }, persistencePolicy: { writeKnowledge: false } })
    assert.equal(zoned.status, 'started')
    assert.equal(inputs[2]!.asOf, '2025-06-30T07:00:00.000Z')
    const future = await service.startAsync({ query: '请按截至2026-10-10时点估值贵州茅台', mode: { type: 'workflow', workflowId: 'valuation' }, contextPolicy: { structuredKnowledge: true, sourceLibrary: false }, persistencePolicy: { writeKnowledge: false } })
    assert.equal(future.status, 'invalid_input')
    assert.equal(future.feedback?.status, 'INVALID_INPUT')
    assert.match(future.feedback?.reason ?? '', /earlier than the injected Runtime clock/)
    const invalidDate = await service.startAsync({ query: '请按截至2025-02-30时点估值贵州茅台', mode: { type: 'workflow', workflowId: 'valuation' }, contextPolicy: { structuredKnowledge: true, sourceLibrary: false }, persistencePolicy: { writeKnowledge: false } })
    assert.equal(invalidDate.status, 'invalid_input')
    assert.match(invalidDate.feedback?.reason ?? '', /valid calendar date/)
    assert.equal(inputs.length, 3)
  } finally { await rm(knowledgeBase, { recursive: true, force: true }) }
})

test('Unverified company identity and canonical references are returned as explicit gaps', async () => {
  let starts = 0
  const output = { mode: 'workflow', workflow: { id: 'valuation', confidence: 1, arguments: { symbol: '600519', name: '贵州茅台' } }, skills: [], entities: [], missingRequiredInputs: [], contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: false }, rationale: 'Candidate company.' }
  const service = new ResearchDispatchService({ reasoningExecutor: semanticExecutor(output), researchService: ({ startValuation: () => { starts += 1; return { completion: Promise.resolve({ status: 'completed' }) } } } as never) })
  const company = await service.startAsync({ query: '当前贵州茅台估值', mode: { type: 'workflow', workflowId: 'valuation' } })
  assert.equal(company.status, 'unresolved_reference')
  assert.equal(company.feedback?.status, 'UNRESOLVED_REFERENCE')
  assert.match(company.feedback?.reason ?? '', /mounted Knowledge Base/)
  assert.equal(starts, 0)
  const thesis = await service.startAsync({ query: 'red team claim:invented', mode: { type: 'workflow', workflowId: 'thesis_red_team' } })
  assert.equal(thesis.status, 'needs_input')
  assert.deepEqual(thesis.feedback?.missingFields, ['symbol'])
  assert.equal(starts, 0)
})

test('Industry Research passes a semantic industry name without requiring a fabricated canonical ID', async () => {
  let input: Record<string, unknown> | undefined
  const output = { mode: 'workflow', workflow: { id: 'industry_research', confidence: 1, arguments: { name: '锂电池', aliases: ['动力电池'] } }, skills: [], entities: [], missingRequiredInputs: [], contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: false }, rationale: 'Industry supply and demand.' }
  const service = new ResearchDispatchService({ reasoningExecutor: semanticExecutor(output), researchService: ({ startIndustryResearch: (value: Record<string, unknown>) => { input = value; return { completion: Promise.resolve({ status: 'blocked', blockedReason: 'INDUSTRY_COVERAGE_NOT_FOUND' }) } } } as never) })
  const result = await service.startAsync({ query: '分析一下锂电池行业的供需变化', mode: { type: 'workflow', workflowId: 'industry_research' } })
  assert.equal(result.status, 'started')
  assert.equal(input?.name, '锂电池')
  assert.deepEqual(input?.aliases, ['动力电池'])
  assert.equal(Object.hasOwn(input ?? {}, 'canonicalRef'), false)
})

test('Test-only Workflow definitions validate new fields without a dispatch parser and cannot claim start without an adapter', async () => {
  const registry = new (await import('../../../app/services/workflow-registry.ts')).WorkflowDefinitionRegistry([])
  const inputSchema = { type: 'object', properties: { benchmark: { type: 'string' }, holdings: { type: 'array', items: { type: 'object', properties: { symbol: { type: 'string' }, weight: { type: 'number' } }, required: ['symbol', 'weight'], additionalProperties: false } }, reviewPeriod: { type: 'string', enum: ['MONTH', 'QUARTER'] } }, required: ['benchmark', 'holdings', 'reviewPeriod'], additionalProperties: false }
  const base = { id: 'test_portfolio_review', label: 'Test Portfolio Review', intentDescription: 'A dynamically registered portfolio review.', inputSchema, requiredInputs: ['benchmark', 'holdings', 'reviewPeriod'], skillIds: [], outputContract: 'Test result only', knowledgeEffects: [] }
  registry.register(base)
  const executor = semanticExecutor({ mode: 'workflow', workflow: { id: base.id, confidence: 1, arguments: { benchmark: 'CSI300', holdings: [{ symbol: '600519', weight: 0.2 }], reviewPeriod: 'QUARTER' } }, skills: [], entities: [], missingRequiredInputs: [], contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: false }, rationale: 'Test-only Workflow.' })
  const service = new ResearchDispatchService({ workflowRegistry: registry, reasoningExecutor: executor })
  const resolved = await service.resolveAsync({ query: 'review portfolio', mode: { type: 'workflow', workflowId: base.id } })
  assert.deepEqual(resolved.decision.workflow?.arguments, { benchmark: 'CSI300', holdings: [{ symbol: '600519', weight: 0.2 }], reviewPeriod: 'QUARTER' })
  const start = await service.startAsync({ query: 'review portfolio', mode: { type: 'workflow', workflowId: base.id } })
  assert.equal(start.status, 'invalid_input')
  assert.match(start.feedback?.reason ?? '', /no execution adapter/)
  registry.replace({ ...base, inputSchema: { ...inputSchema, properties: { ...inputSchema.properties, reportingCurrency: { type: 'string', enum: ['CNY', 'USD'] } } } as never })
  assert.equal(registry.list().length, 1)
  assert.equal(registry.remove(base.id), true)
  assert.equal(registry.get(base.id), undefined)
})

test('Thesis Lifecycle CREATE/REFRESH contracts and canonical Thesis refs are gated before execution', async () => {
  const missingService = new ResearchDispatchService({ reasoningExecutor: semanticExecutor({ mode: 'workflow', workflow: { id: 'thesis_lifecycle', confidence: 1, arguments: { mode: 'CREATE' } }, skills: [], entities: [], missingRequiredInputs: [], contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: false }, rationale: 'Create a thesis.' }) })
  const missing = await missingService.startAsync({ query: 'CREATE a thesis', mode: { type: 'workflow', workflowId: 'thesis_lifecycle' } })
  assert.equal(missing.status, 'needs_input')
  assert.deepEqual(missing.feedback?.missingFields, ['formalization'])

  const knowledgeBase = await identityKnowledgeBase()
  try {
    const output = { mode: 'workflow', workflow: { id: 'thesis_lifecycle', confidence: 1, arguments: { mode: 'REFRESH', refresh: { priorSnapshot: { thesisId: 'thesis:fixture-thesis', priorAsOf: '2026-09-01T00:00:00.000Z', propositions: [{ propositionId: 'claim:fixture-claim', statement: 'Fixture claim.' }] }, evidence: [] } } }, skills: [], entities: [], missingRequiredInputs: [], contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: false }, rationale: 'Refresh the canonical thesis.' }
    const service = new ResearchDispatchService({ mountedKnowledgeBaseRoot: knowledgeBase, reasoningExecutor: semanticExecutor(output), clock: () => new Date(NOW) })
    const result = await service.startAsync({ query: 'Refresh thesis:fixture-thesis', mode: { type: 'workflow', workflowId: 'thesis_lifecycle' } })
    assert.equal(result.status, 'started')
    const completion = await result.completion as { mode?: string; status?: string }
    assert.equal(completion.mode, 'REFRESH')
    const injected = result.decision.workflow?.arguments.refresh as Record<string, unknown>
    assert.equal(injected.currentAsOf, NOW)
    const unknownRefOutput = JSON.parse(JSON.stringify(output).replace('thesis:fixture-thesis', 'thesis:missing')) as unknown
    const unknownRef = await new ResearchDispatchService({ mountedKnowledgeBaseRoot: knowledgeBase, reasoningExecutor: semanticExecutor(unknownRefOutput), clock: () => new Date(NOW) }).startAsync({ query: 'Refresh thesis:missing', mode: { type: 'workflow', workflowId: 'thesis_lifecycle' } })
    assert.equal(unknownRef.status, 'unresolved_reference')
    assert.match(unknownRef.feedback?.reason ?? '', /Canonical reference not found: thesis:missing/)
    await writeFile(join(knowledgeBase, 'claims', 'fixture-claim.yaml'), JSON.stringify({ id: 'claim:fixture-claim', claimType: 'fact', statement: 'Fixture canonical claim.', subjectRefs: ['entity:fixture-company'], sourceRefs: [], lifecycle: { status: 'superseded' } }) + '\n')
    const inactiveRef = await service.startAsync({ query: 'Refresh thesis:fixture-thesis', mode: { type: 'workflow', workflowId: 'thesis_lifecycle' } })
    assert.equal(inactiveRef.status, 'unresolved_reference')
    assert.match(inactiveRef.feedback?.reason ?? '', /inactive or outside its lifecycle window/)
  } finally { await rm(knowledgeBase, { recursive: true, force: true }) }
})
