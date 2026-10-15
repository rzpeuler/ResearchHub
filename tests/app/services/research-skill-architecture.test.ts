import assert from 'node:assert/strict'
import test from 'node:test'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CANONICAL_RESEARCH_SKILL_CATALOG, REQUIRED_RESEARCH_SKILL_SECTIONS } from '../../../app/services/research-skill-catalog.ts'
import { createResearchSkillRegistry } from '../../../app/services/skill-registry.ts'
import { createWorkflowDefinitionRegistry } from '../../../app/services/workflow-registry.ts'
import { ResearchDispatchService } from '../../../app/services/research-dispatch-service.ts'
import { calculateForwardDcf } from '../../../skills/valuation/calculations/dcf.ts'
import { calculateBusinessDriverAnalysis } from '../../../skills/business_driver_analysis/calculations.ts'

test('canonical catalog has exactly 30 unique statuses and runtime is a strict implemented subset', () => {
  assert.equal(CANONICAL_RESEARCH_SKILL_CATALOG.length, 30)
  assert.equal(new Set(CANONICAL_RESEARCH_SKILL_CATALOG.map((item) => item.canonicalSkillId)).size, 30)
  assert.equal(CANONICAL_RESEARCH_SKILL_CATALOG.every((item) => ['IMPLEMENTED', 'PARTIAL', 'PLANNED'].includes(item.status)), true)
  const registry = createResearchSkillRegistry()
  const catalog = new Map(CANONICAL_RESEARCH_SKILL_CATALOG.map((item) => [item.canonicalSkillId, item]))
  for (const definition of registry.canonicalResearchCandidates()) {
    const item = catalog.get(definition.id)
    assert.ok(item)
    assert.equal(item?.status, 'IMPLEMENTED')
    assert.equal(item?.runtimeRegistered, true)
    assert.equal(definition.origin, 'canonical')
    assert.ok(definition.purpose)
    assert.ok(definition.invocationMatch)
    assert.ok(definition.inputs?.length)
    assert.ok(definition.produces?.length)
  }
  for (const item of CANONICAL_RESEARCH_SKILL_CATALOG.filter((entry) => !entry.runtimeRegistered)) assert.equal(registry.get(item.canonicalSkillId), undefined, item.canonicalSkillId)
})

test('runtime registration has an explicit execution classification and deterministic binding', () => {
  const registry = createResearchSkillRegistry()
  const runtime = registry.canonicalResearchCandidates()
  const counts = CANONICAL_RESEARCH_SKILL_CATALOG.reduce<Record<string, number>>((result, item) => { result[item.status] = (result[item.status] ?? 0) + 1; return result }, {})
  assert.deepEqual({ IMPLEMENTED: counts.IMPLEMENTED ?? 0, PARTIAL: counts.PARTIAL ?? 0, PLANNED: counts.PLANNED ?? 0 }, { IMPLEMENTED: 26, PARTIAL: 0, PLANNED: 4 })
  assert.deepEqual(runtime.map((item) => item.id), ['business_driver_analysis', 'business_model_map', 'capital_allocation_review', 'catalyst_map', 'company_history_strategy', 'company_risk_analysis', 'competitive_market_map', 'comps_valuation', 'consensus_expectations_analysis', 'dcf_valuation', 'earnings_variance_analysis', 'estimate_revision_analysis', 'expectation_gap', 'financial_quality_analysis', 'guidance_analysis', 'industry_supply_demand_cycle', 'management_execution', 'management_governance_analysis', 'market_structure_analysis', 'product_technology_analysis', 'reverse_dcf_expectation_decode', 'scenario_valuation', 'thesis_formalize', 'thesis_red_team', 'thesis_refresh', 'unit_economics'])
  assert.equal(runtime.every((item) => item.executionClass !== undefined && item.runtimeBinding), true)
  assert.equal(runtime.filter((item) => item.executionClass === 'DETERMINISTIC_EXECUTABLE').every((item) => typeof item.runtimeExecutor === 'function'), true)
  assert.equal(runtime.filter((item) => item.executionClass === 'SEMANTIC_EXECUTABLE').every((item) => item.id !== 'comps_valuation' && item.runtimeExecutor === undefined), true)
  assert.equal(registry.get('valuation_crosscheck'), undefined)
  assert.equal(CANONICAL_RESEARCH_SKILL_CATALOG.find((item) => item.canonicalSkillId === 'business_driver_analysis')?.executionClass, 'DETERMINISTIC_EXECUTABLE')
  assert.equal(CANONICAL_RESEARCH_SKILL_CATALOG.find((item) => item.canonicalSkillId === 'unit_economics')?.executionClass, 'DETERMINISTIC_EXECUTABLE')
  assert.equal(CANONICAL_RESEARCH_SKILL_CATALOG.find((item) => item.canonicalSkillId === 'thesis_formalize')?.executionClass, 'SEMANTIC_EXECUTABLE')
  assert.equal(CANONICAL_RESEARCH_SKILL_CATALOG.find((item) => item.canonicalSkillId === 'catalyst_map')?.executionClass, 'SEMANTIC_EXECUTABLE')
  assert.equal(CANONICAL_RESEARCH_SKILL_CATALOG.find((item) => item.canonicalSkillId === 'thesis_refresh')?.executionClass, 'SEMANTIC_EXECUTABLE')
  assert.equal(CANONICAL_RESEARCH_SKILL_CATALOG.find((item) => item.canonicalSkillId === 'expectation_gap')?.executionClass, 'DETERMINISTIC_EXECUTABLE')
  assert.equal(CANONICAL_RESEARCH_SKILL_CATALOG.some((item) => ['research_qc', 'evidence_normalization', 'valuation_crosscheck'].includes(item.canonicalSkillId)), false)
  assert.equal(CANONICAL_RESEARCH_SKILL_CATALOG.find((item) => item.canonicalSkillId === 'comps_valuation')?.executionClass, 'DETERMINISTIC_EXECUTABLE')
  const input = { fcff: [100, 110, 120], discountRate: 0.09, terminalGrowthRate: 0.03 }
  const direct = calculateForwardDcf(input)
  const bound = registry.get('dcf_valuation')?.runtimeExecutor?.(input) as typeof direct
  assert.deepEqual(bound, direct)
  const driverInput = { companyRef: 'company', currentPeriod: '2026-H1', priorPeriod: '2025-H1', asOf: '2026-09-21T00:00:00.000Z', segments: [{ id: 'main', name: 'Main', outcomes: [{ metric: 'revenue' as const, unit: 'CNY', currentValue: 132, priorValue: 100, currentSourceRefs: ['source:current'], priorSourceRefs: ['source:prior'] }], drivers: [] }] }
  assert.deepEqual(registry.get('business_driver_analysis')?.runtimeExecutor?.(driverInput), calculateBusinessDriverAnalysis(driverInput))
})

test('every runtime canonical methodology contains the required contract sections', async () => {
  const registry = createResearchSkillRegistry()
  for (const definition of registry.canonicalResearchCandidates()) {
    const path = definition.skillMdPath
    assert.ok(path)
    const text = await readFile(path!, 'utf8')
    for (const section of REQUIRED_RESEARCH_SKILL_SECTIONS) assert.match(text, new RegExp(`^##\\s+${section.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\s*$`, 'mi'), `${definition.id}: ${section}`)
  }
})

test('Workflow metadata composes canonical peers without registering composite Skill IDs', () => {
  const registry = createResearchSkillRegistry()
  const workflows = createWorkflowDefinitionRegistry().list()
  assert.equal(workflows.every((workflow) => workflow.skillIds.every((id) => CANONICAL_RESEARCH_SKILL_CATALOG.some((item) => item.canonicalSkillId === id))), true)
  assert.deepEqual(workflows.find((item) => item.id === 'earnings_review')?.skillIds.slice(0, 4), ['consensus_expectations_analysis', 'earnings_variance_analysis', 'guidance_analysis', 'financial_quality_analysis'])
  assert.equal(workflows.every((workflow) => workflow.qualityGateProfile !== undefined), true)
  assert.equal(registry.get('company-research'), undefined)
  assert.equal(registry.get('earnings-review'), undefined)
  assert.equal(registry.get('valuation'), undefined)
})

test('canonical Skill implementations do not directly invoke another Skill, the registry, or a Workflow', async () => {
  const root = join(process.cwd(), 'skills')
  const forbidden = /(?:skill-registry|ResearchSkillRegistry|workflows\/?|WorkflowService|invokeSkill|runSkill)/i
  for (const item of CANONICAL_RESEARCH_SKILL_CATALOG.filter((entry) => entry.runtimeRegistered)) {
    const directory = join(root, item.canonicalSkillId)
    for (const file of await readdir(directory)) {
      if (!file.endsWith('.ts')) continue
      const text = await readFile(join(directory, file), 'utf8')
      assert.equal(forbidden.test(text), false, `${item.canonicalSkillId}/${file}`)
    }
  }
})

test('narrow semantic routing selects the intended canonical Skill and composite requests select a Workflow', () => {
  const service = new ResearchDispatchService()
  const cases = [
    ['当前价格已经price in多少增长？', 'reverse_dcf_expectation_decode'],
    ['按我的收入利润预测给公司做DCF。', 'dcf_valuation'],
    ['这次收入为什么beat consensus？', 'earnings_variance_analysis'],
    ['管理层这次guidance相对上次有什么变化？', 'guidance_analysis'],
    ['这家公司到底靠什么赚钱？', 'business_model_map'],
    ['我这个投资逻辑最容易错在哪里？', 'thesis_red_team'],
    ['市场和我们的核心分歧是什么？', 'expectation_gap'],
    ['把我的投资逻辑整理成可证伪命题。', 'thesis_formalize'],
    ['未来哪些事件会验证这个逻辑？', 'catalyst_map'],
    ['财报出来以后，原来的 thesis 哪些地方变了？', 'thesis_refresh'],
    ['用可比公司和同行估值，给出 peer median 合理价值。', 'comps_valuation'],
  ] as const
  for (const [query, expected] of cases) {
    const result = service.resolve({ query, mode: { type: 'free_research' } })
    assert.equal(result.decision.mode, 'skill_plan', query)
    assert.deepEqual(result.decision.skills.map((skill) => skill.id), [expected], query)
  }
  assert.equal(service.resolve({ query: '收入增长到底是销量、价格还是mix驱动？', mode: { type: 'free_research' } }).decision.mode, 'skill_plan')
  assert.deepEqual(service.resolve({ query: '收入增长到底是销量、价格还是mix驱动？', mode: { type: 'free_research' } }).decision.skills.map((skill) => skill.id), ['business_driver_analysis'])
  assert.equal(service.resolve({ query: '当前最合理的经济单位是什么？', mode: { type: 'free_research' } }).decision.mode, 'skill_plan')
  assert.deepEqual(service.resolve({ query: '当前最合理的经济单位是什么？', mode: { type: 'free_research' } }).decision.skills.map((skill) => skill.id), ['unit_economics'])
  const composite = service.resolve({ query: '完整研究这家公司。', mode: { type: 'free_research' } })
  assert.equal(composite.decision.mode, 'workflow')
  assert.equal(composite.decision.workflow?.id, 'company_research')
})

test('fixture-backed session execution produces a bounded semantic canonical Skill result', async () => {
  const values = new Map<string, any>()
  const store = { async put(bundle: any) { values.set(bundle.bundleId, bundle) }, async get(id: string) { return values.get(id) }, async list() { return [...values.values()] } }
  const service = new ResearchDispatchService({ bundleStore: store as never })
  const started = service.start({ query: '这家公司到底靠什么赚钱？', mode: { type: 'free_research' } })
  assert.equal(started.status, 'skill_plan')
  assert.ok(started.runId)
  const context = await service.getSessionResearchContext(started.runId!)
  assert.deepEqual(context?.selectedSkills.map((skill) => skill.id), ['business_model_map'])
  assert.match(context?.selectedSkills[0]?.methodology ?? '', /## Methodology/)
  await service.completeSessionResearch(started.runId!, 'Evidence-backed result: the company monetizes its disclosed products through identified customer channels; unknown relationships remain unavailable.')
  const bundle = await service.getBundle(`research-bundle-${started.runId!}`) as { readonly structuredResult?: { readonly status: string; readonly answer?: string } }
  assert.equal(bundle.structuredResult?.status, 'completed')
  assert.match(bundle.structuredResult?.answer ?? '', /Evidence-backed result/)
})
