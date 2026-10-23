import test from 'node:test'
import assert from 'node:assert/strict'
import { executeCompanyResearchMethod, type CompanyResearchMethodId } from '../../skills/company-research/methods.ts'
import type { NormalizedResearchSource } from '../../plugins/research-acquisition/contracts.ts'
import type { ReasoningExecutor } from '../../plugins/reasoning/contracts.ts'

const pageSource = (options: { readonly id?: string; readonly metrics?: readonly string[] } = {}): NormalizedResearchSource => {
  const id = options.id ?? 'byd-haibao-model-page'
  const content = [
    '2026款海豹07DM-i',
    '海豹07DM-i ¥139,800 - ¥195,800 立即订购',
    ...(options.metrics ?? ['满电满油综合续航1585KM']),
    '覆盖日常通勤与长途出行场景，页面信息属于公司产品披露，未提供独立测试。',
    '插混系统由专用发动机、EHS电混系统和功率型刀片电池组成。',
  ].join('\n')
  return {
    candidate: { candidateId: id, kind: 'web_article', tier: 3, title: '比亚迪 2026 海豹07DM-i车型页', url: 'https://www.byd.com/cn/ocean-home/models/haibao/haibao-07-dm-i', provider: 'public-web', metadata: { officialCompanyHost: true, curatedUrlSeed: true, focusedResearchQuery: 'model_price_launch' } },
    retrievedAt: '2026-10-19T00:00:00.000Z', title: '比亚迪 2026 海豹07DM-i车型页', canonicalUrl: 'https://www.byd.com/cn/ocean-home/models/haibao/haibao-07-dm-i', content, contentHash: `hash-${id}-${(options.metrics ?? []).length}`, publisher: 'byd.com',
    rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false },
  }
}

const productOutput = (sectionClaim = '综合续航1585公里') => ({
  status: 'complete',
  answer: '公司官网提供了车型配置和技术路线信息，独立实测及车型盈利资料仍需补充。',
  markdown: '公司页面披露了车型信息，需与独立测试和经营结果交叉验证。',
  sections: [
    { id: 'products', markdown: `| 车型 | 页面披露 |\n|---|---|\n| 海豹07DM-i | ${sectionClaim}；公司页面提供订购入口。[byd-haibao-model-page@paragraph:2] |` },
    { id: 'technologies', markdown: '页面列示插混系统构成；现有材料未提供独立实测或车型级收益验证。[byd-haibao-model-page@paragraph:5]' },
  ],
  findings: [{ text: '车型规格属于公司页面披露，独立测试和车型盈利仍待验证。', kind: 'fact', evidence: [{ sourceCandidateId: 'byd-haibao-model-page', location: 'paragraph:2' }] }],
  limitations: [],
  risks: [],
})

function makeExecutor(output: unknown): ReasoningExecutor {
  return {
    capabilities: () => ({ maxContextTokens: 10000, maxOutputTokens: 4000, structuredOutputSupport: true, maxConcurrency: 1 }),
    execute: async request => ({ operation: request.operation, output }),
  }
}

async function runProductMethod(source: NormalizedResearchSource, claim?: string, additionalSources: readonly NormalizedResearchSource[] = []) {
  const sources = [source, ...additionalSources]
  return executeCompanyResearchMethod({
    skillId: 'product_technology_analysis' satisfies CompanyResearchMethodId,
    company: { symbol: '002594', name: '比亚迪股份有限公司' },
    asOf: '2026-10-19',
    sources,
    durableSourceCandidateIds: sources.map(item => item.candidate.candidateId),
    reasoningExecutor: makeExecutor(productOutput(claim)),
    maxAttempts: 1,
  })
}

test('product table backfills a unique exact metric locator from an already-cited official model page', async () => {
  const result = await runProductMethod(pageSource())
  assert.equal(result.status, 'complete', JSON.stringify(result.diagnostics))
  const products = result.sections.find(section => section.id === 'products')!.markdown
  assert.match(products, /综合续航1585公里/)
  assert.match(products, /\[byd-haibao-model-page@paragraph:3\]/)
  assert.ok(result.citationRepairs?.some(repair => repair.reason.includes('unique exact metric locator from an already-cited official model page')))
})

test('product table numeric citation backfill rejects ambiguous or metric-mismatched excerpts', async () => {
  const ambiguous = await runProductMethod(pageSource({ metrics: ['满电满油综合续航1585KM', '满电满油综合续航1585KM'] }))
  assert.equal(ambiguous.status, 'failed', 'two matching supplied excerpts are ambiguous')
  assert.ok(ambiguous.diagnostics.some(diagnostic => diagnostic.code === 'NUMERIC_GROUNDING_ERROR'))

  const wrongMetric = await runProductMethod(pageSource({ metrics: ['满电满油综合续航1585KM'] }), '纯电续航1585公里')
  assert.equal(wrongMetric.status, 'failed', 'the same number on a different product metric cannot be borrowed')
  assert.ok(wrongMetric.diagnostics.some(diagnostic => diagnostic.code === 'NUMERIC_GROUNDING_ERROR'))

  const citedPageWithoutMetric = pageSource({ metrics: ['海豹07DM-i配备舒适座椅与智能座舱。'] })
  const uncitedExactPage = pageSource({ id: 'uncited-official-model-page' })
  const crossSource = await runProductMethod(citedPageWithoutMetric, undefined, [uncitedExactPage])
  assert.equal(crossSource.status, 'failed', 'an uncited second page cannot license a numeric claim merely because it has the exact value')
  assert.ok(crossSource.diagnostics.some(diagnostic => diagnostic.code === 'NUMERIC_GROUNDING_ERROR'))
})
