import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { reconcileCompanyDriverConsolidatedGrossMargin } from '../../workflows/company-deep-research/content-quality.ts'
import { executeCompanyResearchMethod, type CompanyResearchMethodResult } from '../../skills/company-research/methods.ts'
import type { ReasoningExecutor } from '../../plugins/reasoning/contracts.ts'
import type { NormalizedResearchSource } from '../../plugins/research-acquisition/contracts.ts'

const financialMethod = {
  skillId: 'financial_quality_analysis',
  status: 'complete',
  executionEvidence: [{
    sourceCandidateId: 'akshare-financial-002594',
    title: '结构化财务数据',
    excerpts: [{
      location: 'paragraph:1',
      text: JSON.stringify({ kind: 'financial', rows: [
        { periodEnd: '2026-06-30', metrics: { grossMargin: 18.8473478975 }, metricMetadata: { grossMargin: { basis: 'YTD', unit: 'percent' } } },
        { periodEnd: '2025-06-30', metrics: { grossMargin: 18.0095044898 }, metricMetadata: { grossMargin: { basis: 'YTD', unit: 'percent' } } },
      ] }),
    }],
  }],
} as unknown as CompanyResearchMethodResult

const preparedAnalysis = {
  financial: { table: [
    { period: '2026-06-30', metrics: { grossMargin: 18.8473478975 }, metadata: { grossMargin: { basis: 'YTD', unit: 'percent' } } },
    { period: '2025-06-30', metrics: { grossMargin: 18.0095044898 }, metadata: { grossMargin: { basis: 'YTD', unit: 'percent' } } },
  ] },
}

test('R176 driver execution receives canonical dimension and exact-label checks for every owned section', async () => {
  const methodology = readFileSync(new URL('../../skills/business_driver_analysis/SKILL.md', import.meta.url), 'utf8')
  const source: NormalizedResearchSource = {
    candidate: { candidateId: 'generic-filing', title: '定期报告', kind: 'official_disclosure', tier: 1, provider: 'fixture' },
    retrievedAt: '2026-10-23', title: '定期报告', publisher: '公司', contentHash: 'fixture',
    content: '主营业务收入构成：分行业，精密设备制造业。\n主营业务收入构成：分产品，精密组件及配套产品。\n未披露可比分部利润和量价拆解。',
    rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false },
  }
  let dispatchedMethodology: unknown
  const reasoningExecutor: ReasoningExecutor = {
    capabilities: () => ({ maxContextTokens: 10000, maxOutputTokens: 4000, structuredOutputSupport: true, maxConcurrency: 1 }),
    execute: async request => {
      dispatchedMethodology = (request.input as { canonicalMethodology?: unknown }).canonicalMethodology
      return { operation: request.operation, output: {
        status: 'complete', answer: '分行业与分产品标签分别保留。',
        markdown: '分行业披露精密设备制造业；分产品披露精密组件及配套产品。[generic-filing@paragraph:1] [generic-filing@paragraph:2]',
        sections: ['revenue-profit-drivers', 'growth-drivers', 'catalysts'].map(id => ({ id, markdown: '分行业披露精密设备制造业；分产品披露精密组件及配套产品，不能互换标签。[generic-filing@paragraph:1] [generic-filing@paragraph:2]' })),
        findings: [{ text: '行业名称为精密设备制造业，产品名称为精密组件及配套产品。', kind: 'fact', evidence: [{ sourceCandidateId: 'generic-filing', location: 'paragraph:1' }, { sourceCandidateId: 'generic-filing', location: 'paragraph:2' }] }],
        limitations: ['没有可比量价与分部利润数据。'], risks: [],
      } }
    },
  }
  const result = await executeCompanyResearchMethod({ company: { symbol: '000001' }, asOf: '2026-10-23', sources: [source], reportSourceCandidateIds: ['generic-filing'], skillId: 'business_driver_analysis', methodology, reasoningExecutor, maxAttempts: 1 })
  assert.equal(result.status, 'complete', result.diagnostics.join('; '))
  assert.equal(dispatchedMethodology, methodology)
  assert.match(String(dispatchedMethodology), /完整行标签逐字复制/)
  assert.match(String(dispatchedMethodology), /数值相等不证明标签或维度可互换/)
  assert.match(String(dispatchedMethodology), /同一事实在不同章节重复出现时仍复制本期原表名称/)
  assert.match(String(dispatchedMethodology), /不根据金额匹配猜改标签/)
  for (const section of result.sections) assert.match(section.markdown, /精密设备制造业；分产品披露精密组件及配套产品/)
})

test('driver bridge adds a same-basis consolidated gross-margin formula only with prepared operands and exact structured evidence', () => {
  const result = reconcileCompanyDriverConsolidatedGrossMargin({
    sections: [{ id: 'revenue-profit-drivers', markdown: '收入和利润变化。', sourceCandidateIds: [] }],
    methodResults: [financialMethod],
    preparedAnalysis,
  })
  const markdown = result[0]!.markdown
  assert.match(markdown, /18\.01%升至2026年上半年的18\.85%/)
  assert.match(markdown, /18\.85%-18\.01%＝\+0\.84个百分点/)
  assert.match(markdown, /\[akshare-financial-002594@paragraph:1\]/)
})

test('driver bridge does not invent a margin delta when preparedAnalysis lacks the comparable prior period', () => {
  const result = reconcileCompanyDriverConsolidatedGrossMargin({
    sections: [{ id: 'revenue-profit-drivers', markdown: '收入和利润变化。', sourceCandidateIds: [] }],
    methodResults: [financialMethod],
    preparedAnalysis: { financial: { table: [{ period: '2026-06-30', metrics: { grossMargin: 18.8 }, metadata: { grossMargin: { basis: 'YTD', unit: 'percent' } } }] } },
  })
  assert.equal(result[0]!.markdown, '收入和利润变化。')
})

test('driver bridge renders a negative consolidated gross-margin change with a minus sign', () => {
  const negativeMarginMethod = {
    ...financialMethod,
    executionEvidence: [{
      sourceCandidateId: 'akshare-financial-002594',
      title: '结构化财务数据',
      excerpts: [{ location: 'paragraph:1', text: JSON.stringify({ kind: 'financial', rows: [
        { periodEnd: '2026-06-30', metrics: { grossMargin: 17.5 }, metricMetadata: { grossMargin: { basis: 'YTD', unit: 'percent' } } },
        { periodEnd: '2025-06-30', metrics: { grossMargin: 18 }, metricMetadata: { grossMargin: { basis: 'YTD', unit: 'percent' } } },
      ] }) }],
    }],
  } as unknown as CompanyResearchMethodResult
  const result = reconcileCompanyDriverConsolidatedGrossMargin({
    sections: [{ id: 'revenue-profit-drivers', markdown: '收入和利润变化。', sourceCandidateIds: [] }],
    methodResults: [negativeMarginMethod],
    preparedAnalysis: {
      financial: { table: [
        { period: '2026-06-30', metrics: { grossMargin: 17.5 }, metadata: { grossMargin: { basis: 'YTD', unit: 'percent' } } },
        { period: '2025-06-30', metrics: { grossMargin: 18.0 }, metadata: { grossMargin: { basis: 'YTD', unit: 'percent' } } },
      ] },
    },
  })
  assert.match(result[0]!.markdown, /由2025年上半年的18\.00%降至2026年上半年的17\.50%/)
  assert.match(result[0]!.markdown, /17\.50%-18\.00%＝−0\.50个百分点/)
})

test('driver margin uses the supplied year pair and rejects conflicting or unconfirmed operands', () => {
  const method=JSON.parse(JSON.stringify(financialMethod).replaceAll('2026-06-30','2024-06-30').replaceAll('2025-06-30','2023-06-30')) as CompanyResearchMethodResult
  const analysis=JSON.parse(JSON.stringify(preparedAnalysis).replaceAll('2026-06-30','2024-06-30').replaceAll('2025-06-30','2023-06-30'))
  const sections=[{id:'revenue-profit-drivers',markdown:'收入和利润变化。',sourceCandidateIds:[]}]
  const result=reconcileCompanyDriverConsolidatedGrossMargin({sections,methodResults:[method],preparedAnalysis:analysis})
  assert.match(result[0]!.markdown,/2023年上半年的18\.01%升至2024年上半年的18\.85%/)
  assert.doesNotMatch(result[0]!.markdown,/2025|2026/)
  analysis.financial.table[0].conflicts=[{metric:'grossMargin'}]
  assert.deepEqual(reconcileCompanyDriverConsolidatedGrossMargin({sections,methodResults:[method],preparedAnalysis:analysis}),sections)
  delete analysis.financial.table[0].conflicts
  analysis.financial.table[0].metrics.grossMargin=19
  assert.deepEqual(reconcileCompanyDriverConsolidatedGrossMargin({sections,methodResults:[method],preparedAnalysis:analysis}),sections)
})
