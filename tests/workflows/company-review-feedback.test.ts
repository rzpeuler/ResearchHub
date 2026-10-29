import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCompanyMethodReviewFeedback } from '../../workflows/company-deep-research/workflow.ts'

test('cross-method competitor review feedback is reduced to method-local scope guidance', () => {
  const feedback = buildCompanyMethodReviewFeedback('company_history_strategy', [{
    sectionId: 'company-overview',
    reasons: ['称没有具名竞争者，但中际旭创提供1.6T产品路线（public-web-85e9bf355ddc644e@paragraph:26）；不要误称整个报告无竞品。'],
  }]).join('\n')
  assert.match(feedback, /删除或改写本节任何关于报告整体/)
  assert.match(feedback, /具名候选与已披露产品路线见竞争章节/)
  assert.match(feedback, /本方法输入未提供直接竞争关系、客户重叠、市场份额及同口径成本\/性能证据/)
  assert.doesNotMatch(feedback, /中际旭创|1\.6T|public-web|paragraph:26/)
})

test('business-driver review feedback distinguishes disclosed progress from missing quantified order evidence', () => {
  const feedback = buildCompanyMethodReviewFeedback('business_driver_analysis', [{
    sectionId: 'catalysts',
    reasons: ['称没有量产进度，但材料显示扩产爬坡；没有订单数量与未来收入预测。'],
  }]).join('\n')
  assert.match(feedback, /区分公司披露的项目进展与可核验的量化兑现/)
  assert.doesNotMatch(feedback, /不能引用/)
})

test('general review notes strip fullwidth-bracket citations and paragraph numbers before method revision', () => {
  const feedback = buildCompanyMethodReviewFeedback('business_model_map', [{
    sectionId: 'business-model',
    reasons: ['引用错行〔official-39e591fa149e4543@paragraph:1323〕，应复核收入构成表。'],
  }]).join('\n')
  assert.doesNotMatch(feedback, /official-|paragraph:1323|1323/)
  assert.match(feedback, /应复核收入构成表/)
})

test('driver revision separates supplied financial rows from unresolved attribution without importing reviewer facts', () => {
  for (const sectionId of ['revenue-profit-drivers', 'growth-drivers']) {
    const feedback = buildCompanyMethodReviewFeedback('business_driver_analysis', [{
      sectionId,
      reasons: ['漏掉幻想工业收入345.67亿元、22.33%毛利率〔official-secret@paragraph:730〕，应写销量增加导致增长。'],
    }]).join('\n')
    assert.match(feedback, /完整表头、标签及数值续行/)
    assert.match(feedback, /半年报“营业收入构成”分产品表若已列本期占比，必须在收入结构中逐项列出具名产品、占比和精确行级引用/)
    assert.match(feedback, /不得再称分部收入占比未披露/)
    assert.match(feedback, /不得因缺少量价或分部利润而否定已给出的收入行/)
    assert.match(feedback, /保留该项缺口/)
    assert.match(feedback, /有序操作数和差额方向/)
    assert.doesNotMatch(feedback, /幻想工业|345\.67|22\.33|official-secret|paragraph:730|销量增加导致增长/)
  }
})

test('capital revision distinguishes historical action facts from missing valuation inputs', () => {
  for (const skillId of ['capital_allocation_review', 'management_governance_analysis']) {
    const feedback = buildCompanyMethodReviewFeedback(skillId, [{
      sectionId: 'management-capital-allocation',
      reasons: ['收购幻象公司对价999亿元，回购888股，应认定创造价值 [official-secret@paragraph:10154]。'],
    }]).join('\n')
    assert.match(feedback, /行动发生期间、授权、实施、完成及后续结果分别建账/)
    assert.match(feedback, /不能因缺少交易对价、回购价格或增量回报而写成没有行动/)
    assert.match(feedback, /员工持股购买不得直接称注销回购/)
    assert.match(feedback, /仍逐项列为缺口/)
    assert.doesNotMatch(feedback, /幻象公司|999|888|official-secret|paragraph:10154|应认定创造价值/)
  }
})

test('review feedback preserves disclosed employee-plan scope, technology progress, and named competitor boundaries', () => {
  const plan = buildCompanyMethodReviewFeedback('management_governance_analysis', [{
    sectionId: 'management-capital-allocation',
    reasons: ['计划参与范围缺少披露。'],
  }]).join('\n')
  assert.match(plan, /完整名称、年份、适用对象或人员范围及人数/)
  assert.match(plan, /不能再把已列明的计划期间、名称或参与范围称为未披露/)

  const technology = buildCompanyMethodReviewFeedback('product_technology_analysis', [{
    sectionId: 'technologies',
    reasons: ['已有产品进入量产资料，但称无商业进展。'],
  }]).join('\n')
  assert.match(technology, /研发路线、累计使用、进入量产或应用进展/)
  assert.match(technology, /不得将这些缺口扩大成没有商业转化证据/)

  const risk = buildCompanyMethodReviewFeedback('company_risk_analysis', [{
    sectionId: 'risks',
    reasons: ['竞争章节已列具名对手，但称具名竞品横向数据未提供。'],
  }]).join('\n')
  assert.match(risk, /不得称“没有具名竞品\/路线”或“具名竞品未提供”/)
  assert.match(risk, /尚未验证的直接采购重叠/)
})
