import assert from 'node:assert/strict'
import test from 'node:test'
import { ResearchDispatchService, extractWorkflowArguments } from '../../../app/services/research-dispatch-service.ts'
import { createWorkflowDefinitionRegistry } from '../../../app/services/workflow-registry.ts'
import { ResearchSkillRegistry } from '../../../app/services/skill-registry.ts'

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
  const calls: unknown[] = []
  const store = new (class { readonly values = new Map<string, unknown>(); async put(bundle: { bundleId: string }) { this.values.set(bundle.bundleId, bundle) }; async get(id: string) { return this.values.get(id) }; async list() { return [...this.values.values()] } })()
  const research = ({ startEarningsReview: (input: unknown) => { calls.push(input); return { completion: Promise.resolve({ status: 'completed', report: { reportId: 'earnings-report', outputPath: 'earnings-report.md' }, research: { proposals: [{ proposalId: 'earnings-proposal', kind: 'claim' }] } }) } } } as never)
  const service = new ResearchDispatchService({ researchService: research, bundleStore: store as never })
  const started = service.start({ query: '600519 2026 年半年报', mode: { type: 'workflow', workflowId: 'earnings_review' }, contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: false } })
  await started.completion
  assert.equal((calls[0] as { writeKnowledge: boolean }).writeKnowledge, false)
  const bundle = await service.getBundle(`research-bundle-${started.runId!}`) as { report?: { reportId: string }; proposals: readonly { proposalId: string }[] }
  assert.equal(bundle.report?.reportId, 'earnings-report'); assert.deepEqual(bundle.proposals.map((item) => item.proposalId), ['earnings-proposal'])
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
