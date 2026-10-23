import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCompanySynthesisReviewFeedback } from '../../workflows/company-deep-research/workflow.ts'

test('synthesis review feedback scopes revenue, cost, margin, and row-level citation repairs', () => {
  const feedback = buildCompanySynthesisReviewFeedback([
    { sectionId: 'revenue-profit-drivers', reasons: ['收入变动残差范围过宽，毛利率差值未复算。'] },
    { sectionId: 'business-model', reasons: ['多行产品数据共用不精确引用。'] },
  ]).join('\n')
  assert.match(feedback, /分行业\/分产品和分地区原表已披露的收入变化/)
  assert.match(feedback, /未归因残差/)
  assert.match(feedback, /两个操作数和百分点差公式/)
  assert.match(feedback, /每个产品数据行应直接引用对应的完整产品行/)
  assert.doesNotMatch(feedback, /official-|paragraph:\d+|\d+(?:\.\d+)?%/)
})

test('synthesis review feedback preserves known competitor routes and scopes only remaining evidence gaps', () => {
  const feedback = buildCompanySynthesisReviewFeedback([
    { sectionId: 'catalysts', reasons: ['缺少具名竞品。'] },
    { sectionId: 'risks', reasons: ['竞争可比信息缺失。'] },
    { sectionId: 'products', reasons: ['较高没有比较基准。'] },
    { sectionId: 'industry-exposure', reasons: ['产品分类定位错误。'] },
  ]).join('\n')
  assert.match(feedback, /保留该候选及路线/)
  assert.match(feedback, /直接竞争\/竞标、客户重叠、市场份额及同口径性能成本比较/)
  assert.match(feedback, /不得无比较基准地称某产品毛利率/)
  assert.match(feedback, /严格区分分行业、分产品、分地区表/)
  assert.doesNotMatch(feedback, /CATL|刀片电池|宁德时代/)
})

test('synthesis repairs false gaps using allowed evidence while preserving unavailable inputs and dated baselines', () => {
  const feedback = buildCompanySynthesisReviewFeedback([
    { sectionId: 'growth-drivers', reasons: ['幻想工业收入123.45亿元、占比79.85% [official-private@paragraph:703]。'] },
    { sectionId: 'management-capital-allocation', reasons: ['收购幻象公司价格999元，应判定创造价值。'] },
    { sectionId: 'monitoring-checklist', reasons: ['2025计划累计10714990股 [official-private@paragraph:3062]，不能说缺失。'] },
  ])
  assert.equal(feedback.length, 3)
  const text = feedback.join('\n')
  assert.match(text, /先列出这些已知事实及行级引用/)
  assert.match(text, /没有直接证据的指标仍保留缺口/)
  assert.match(text, /不能据此否认行动存在/)
  assert.match(text, /员工持股购买与注销回购/)
  assert.match(text, /可核验的累计数作为带截止日期及精确引用的监控基线/)
  assert.match(text, /不得将不同计划或截止时点相加/)
  assert.doesNotMatch(text, /幻想工业|123\.45|79\.85|official-private|paragraph:703|幻象公司|999|10714990|2025|应判定创造价值/)
})

test('passing sections do not receive false-gap repair instructions', () => {
  assert.deepEqual(buildCompanySynthesisReviewFeedback([
    { sectionId: 'growth-drivers', reasons: [] },
    { sectionId: 'management-capital-allocation', reasons: [] },
    { sectionId: 'monitoring-checklist', reasons: [] },
  ]), [])
})
