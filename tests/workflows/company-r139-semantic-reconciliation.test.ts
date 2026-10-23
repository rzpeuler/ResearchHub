import assert from 'node:assert/strict'
import test from 'node:test'
import { reconcileCompanyConsolidatedGrossMargin, reconcileCompanyPlacementFacts, reconcileCompanyProductRevenueShares } from '../../workflows/company-deep-research/content-quality.ts'
import type { CompanyResearchMethodResult } from '../../skills/company-research/methods.ts'

test('R139 fixes reversed current/prior gross-margin row only from exact YTD structured periods', () => {
  const structured = { kind: 'financial', rows: [
    { periodEnd: '2026-06-30', metrics: { grossMargin: 18.8473478975 }, metricMetadata: { grossMargin: { basis: 'YTD' } } },
    { periodEnd: '2025-06-30', metrics: { grossMargin: 18.0095044898 }, metricMetadata: { grossMargin: { basis: 'YTD' } } }
  ] }
  const method: CompanyResearchMethodResult = { skillId: 'financial_quality_analysis', status: 'complete', attempts: 1, answer: '', markdown: '', sections: [], findings: [], sourceCandidateIds: ['akshare-financial-002594'], limitations: [], risks: [], diagnostics: [], executionEvidence: [{ sourceCandidateId: 'akshare-financial-002594', title: 'Company financial history', publisher: 'Structured data', excerpts: [{ sourceCandidateId: 'akshare-financial-002594', location: 'paragraph:1', text: JSON.stringify(structured) }] }] }
  const input = [{ id: 'financial-quality', sourceCandidateIds: [] as string[], markdown: '| 指标 | 本期 | 上年同期 | 同比 |\n|---|---:|---:|---|\n| 合并毛利率（半年累计） | 18.01% | 18.85% | 18.85%-18.01%≈0.84个百分点 |' }]
  const fixed = reconcileCompanyConsolidatedGrossMargin({ sections: input, methodResults: [method] })[0]!
  assert.match(fixed.markdown, /\| 合并毛利率（半年累计） \| 18\.85% \| 18\.01% \| 18\.85%-18\.01%≈0\.84个百分点 \[akshare-financial-002594@paragraph:1\] \|/)
  assert.ok(fixed.sourceCandidateIds?.includes('akshare-financial-002594'))
  const alreadyCorrect = [{ ...input[0]!, markdown: input[0]!.markdown.replace('18.01% | 18.85%', '18.85% | 18.01%') }]
  assert.deepEqual(reconcileCompanyConsolidatedGrossMargin({ sections: alreadyCorrect, methodResults: [method] }), alreadyCorrect, 'a correctly ordered row is not rewritten')
})

test('R139 relabels 2024 product mix as historical when 2025 annual product facts are already present', () => {
  const method: CompanyResearchMethodResult = { skillId: 'business_model_map', status: 'complete', attempts: 1, answer: '', markdown: '', sections: [], findings: [], sourceCandidateIds: ['annual-2024'], limitations: [], risks: [], diagnostics: [], executionEvidence: [{ sourceCandidateId: 'annual-2024', title: '2024年年度报告', publisher: 'Company', excerpts: [
    { sourceCandidateId: 'annual-2024', location: 'paragraph:679', text: '营业收入构成' },
    { sourceCandidateId: 'annual-2024', location: 'paragraph:680', text: '单位：元' },
    { sourceCandidateId: 'annual-2024', location: 'paragraph:681', text: '2024年' },
    { sourceCandidateId: 'annual-2024', location: 'paragraph:682', text: '金额 占营业收入比重 金额 占营业收入比重' },
    { sourceCandidateId: 'annual-2024', location: 'paragraph:683', text: '分产品' },
    { sourceCandidateId: 'annual-2024', location: 'paragraph:684', text: '汽车、汽车相关产品及其他产品 8,000 80.00% 7,000 70.00% 10.00%' }
  ] }] }
  const input = [{ id: 'products', sourceCandidateIds: ['annual-2024', 'annual-2025'], markdown: '2025年年报分产品表列示汽车产品及手机部件收入和毛利率。[annual-2025@paragraph:833]\n\n#### 年报披露的产品收入结构（2024年，仅列最新完整年度）\n汽车、汽车相关产品及其他产品占营业收入80.00% [annual-2024@paragraph:684]' }]
  const fixed = reconcileCompanyProductRevenueShares({ sections: input, methodResults: [method] })[0]!
  assert.match(fixed.markdown, /#### 年报披露的产品收入结构（2024年历史对照；最新完整年度为2025年）/)
  assert.doesNotMatch(fixed.markdown, /2024年，仅列最新完整年度/)
  assert.match(fixed.markdown, /2025年年报分产品表列示/)
  const repeated = reconcileCompanyProductRevenueShares({ sections: [fixed], methodResults: [method] })[0]!
  assert.equal(repeated.markdown.match(/年报披露的产品收入结构/g)?.length, 1)
})

test('R139 reconciles dollar gross placement size and HKD net proceeds as one H-share event without addition', () => {
  const method: CompanyResearchMethodResult = { skillId: 'capital_allocation_review', status: 'complete', attempts: 1, answer: '', markdown: '', sections: [], findings: [], sourceCandidateIds: ['official-f7c8d23d2829a5e8', 'official-f6274e510499a654'], limitations: [], risks: [], diagnostics: [], executionEvidence: [
    { sourceCandidateId: 'official-f7c8d23d2829a5e8', title: '2025年年度报告', publisher: 'Company', excerpts: [{ sourceCandidateId: 'official-f7c8d23d2829a5e8', location: 'paragraph:41', text: '二零二五年三月，我们成功完成 56 亿美元闪电配售，全球投资者参与。' }] },
    { sourceCandidateId: 'official-f6274e510499a654', title: '2024年年度报告', publisher: 'Company', excerpts: [
      { sourceCandidateId: 'official-f6274e510499a654', location: 'paragraph:8798', text: '本集团已于 2025 年 3 月 11 日通过配售 129,800,000 股新 H 股，扣除佣金和估计费用后募集资金净额约为港元' },
      { sourceCandidateId: 'official-f6274e510499a654', location: 'paragraph:8799', text: '43,383,000 千元，根据本公司管理层编制的现金流预测。' },
      { sourceCandidateId: 'official-f6274e510499a654', location: 'paragraph:8800', text: '信贷额度以及资本性投入的速度，本集团董事认为有足够营运资金。' }
    ] }
  ] }
  const input = [{ id: 'management-capital-allocation', sourceCandidateIds: ['official-f7c8d23d2829a5e8', 'official-f6274e510499a654'], markdown: '| 行动 | 已知规模、期间与状态 | 目的、来源及结果 |\n|---|---|---|\n| 融资 | 2025年3月完成56亿美元配售；2025年3月另有新H股配售，扣除费用后净募集约港元43,383,000千元。 | 不能将两项披露合并成同一净额口径。 |' }]
  const fixed = reconcileCompanyPlacementFacts({ sections: input, methodResults: [method] })[0]!
  assert.match(fixed.markdown, /2025年3月同一笔新H股配售/)
  assert.match(fixed.markdown, /配售129,800,000股新H股/)
  assert.match(fixed.markdown, /分别以美元描述配售规模、以港元披露扣费后的净募集额/)
  assert.match(fixed.markdown, /不是两笔融资，金额不可相加/)
  assert.doesNotMatch(fixed.markdown, /另有新H股配售/)
  for (const ref of ['official-f7c8d23d2829a5e8@paragraph:41', 'official-f6274e510499a654@paragraph:8798', 'official-f6274e510499a654@paragraph:8799']) assert.ok(fixed.markdown.includes(`[${ref}]`))
  assert.deepEqual(reconcileCompanyPlacementFacts({ sections: [fixed], methodResults: [method] }), [fixed], 'reconciliation is idempotent')
})
