import assert from 'node:assert/strict'
import test from 'node:test'
import type { ReasoningExecutor, ReasoningRequest } from '../../../plugins/reasoning/contracts.ts'
import { ThemeWorkspaceSectionClassifier, type ThemeWorkspaceClassifierInput } from '../../../app/services/theme-workspace-section-classifier.ts'
import type { ThemeWorkspaceFact } from '../../../app/services/theme-workspace-projection-contracts.ts'

const fact = (ref: string, semanticType = 'fact'): ThemeWorkspaceFact => ({ ref, kind: 'claim', semanticType, title: `Title ${ref}`, statement: `Statement ${ref}`, sourceRefs: ['source:test'] })
const input = (revision: number, facts: readonly ThemeWorkspaceFact[] = [fact('claim:a')]): ThemeWorkspaceClassifierInput => ({
  knowledgeBaseId: 'kb-test', revision, scopeRef: 'entity:industry-test', taxonomy: 'industry', facts,
})
function executor(run: (request: ReasoningRequest) => unknown): ReasoningExecutor {
  return {
    capabilities: () => ({ maxContextTokens: 1000, maxOutputTokens: 1000, structuredOutputSupport: true, maxConcurrency: 1 }),
    execute: async (request) => ({ operation: request.operation, output: run(request) }),
  }
}

test('section classifier caches by KB, revision, scope, taxonomy, and fact set', async () => {
  let calls = 0
  const classifier = new ThemeWorkspaceSectionClassifier(executor((request) => {
    calls += 1
    const facts = (request.input as { facts: { factRef: string }[] }).facts
    return { assignments: facts.map(({ factRef }) => ({ factRef, sectionId: 'industry_chain_analysis' })) }
  }))

  const [first, concurrentSameRevision] = await Promise.all([classifier.classify(input(4)), classifier.classify(input(4))])
  const sameRevision = await classifier.classify(input(4))
  const nextRevision = await classifier.classify(input(5))

  assert.equal(calls, 2)
  assert.equal(first.classification.revision, 4)
  assert.equal(concurrentSameRevision.classification.classifiedCount, 1)
  assert.equal(sameRevision.classification.classifiedCount, 1)
  assert.equal(nextRevision.classification.revision, 5)
})

test('section classifier rejects unknown, duplicate, and multi-section assignments and keeps facts visible', async () => {
  const classifier = new ThemeWorkspaceSectionClassifier(executor(() => ({ assignments: [
    { factRef: 'claim:a', sectionId: 'industry_chain_analysis' },
    { factRef: 'claim:a', sectionId: 'risk_analysis' },
  ] })))
  const result = await classifier.classify(input(2, [fact('claim:a'), fact('claim:b')]))

  assert.equal(result.classification.status, 'invalid_output')
  assert.equal(result.classification.method, 'deterministic_fallback')
  assert.equal(result.unclassifiedFacts.length, 2)
  assert.equal(Object.values(result.factsBySection).flat().length, 0)
  assert.equal(result.unclassifiedFacts.length + Object.values(result.factsBySection).flat().length, 2)
})

test('deterministic fallback only maps explicit known semantic types', async () => {
  const result = await new ThemeWorkspaceSectionClassifier().classify(input(1, [fact('claim:risk', 'risk'), fact('claim:other', 'viewpoint'), fact('claim:capacity-forecast', 'forecast')]))
  assert.equal(result.classification.status, 'llm_unavailable')
  assert.deepEqual(result.factsBySection.risk_analysis?.map((item) => item.ref), ['claim:risk'])
  assert.deepEqual(result.unclassifiedFacts.map((item) => item.ref), ['claim:other', 'claim:capacity-forecast'])
  assert.equal(result.factsBySection.market_size_growth?.some((item) => item.ref === 'claim:capacity-forecast'), false)
  assert.deepEqual(result.sectionCatalog.map((section) => section.title), ['行业定义与范围', '市场规模与增长', '供需分析', '产业链分析', '竞争格局', '技术演进', '重点公司', '风险分析'])
})
