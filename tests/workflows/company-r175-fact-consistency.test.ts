import test from 'node:test'
import assert from 'node:assert/strict'
import type { CompanyResearchMethodResult } from '../../skills/company-research/methods.ts'
import { findCustomerConcentrationComparisonContradictions, reconcileCompanyEmployeePlanEvidence, reconcileCompanyRiskBoundaries } from '../../workflows/company-deep-research/content-quality.ts'

const participantSource = 'official-interim'
const participantRows = [
  { sourceCandidateId: participantSource, location: 'paragraph:1138', text: '报告期内全部有效的员工持股计划情况' },
  { sourceCandidateId: participantSource, location: 'paragraph:1139', text: '员工的范围 员工人数 持有的股票总数' },
  { sourceCandidateId: participantSource, location: 'paragraph:1140', text: '（股） 变更情况 占上市公司股本' },
  { sourceCandidateId: participantSource, location: 'paragraph:1141', text: '总额的比例' },
  { sourceCandidateId: participantSource, location: 'paragraph:1145', text: '2024年员工持股计划：' },
  { sourceCandidateId: participantSource, location: 'paragraph:1148', text: '100 1,595,465 无 0.0175%' },
  { sourceCandidateId: participantSource, location: 'paragraph:1154', text: '2025年员工持股计划：' },
  { sourceCandidateId: participantSource, location: 'paragraph:1155', text: '公司曾任职工代表监事、高级管理人员及中层管理人员、核心骨干员工' },
  { sourceCandidateId: participantSource, location: 'paragraph:1159', text: '21,417 22,501,479 无 0.2468%' },
]
const planMethod = (rows = participantRows, title = '2026年半年度报告') => ({
  skillId: 'management_governance_analysis', status: 'complete', executionEvidence: [{ sourceCandidateId: participantSource, title, publisher: '公司', excerpts: rows }],
} as unknown as CompanyResearchMethodResult)
const missingParticipants = '| 治理及员工激励；2026年半年度报告 | 2025年员工计划上限不超过2.5万名员工；截至2025年5月23日累计购入10,714,990股；最新半年报告列示计划持有股票22,501,479股。实际参与人数未见披露，不将上限或购股股数当参与人数。[official-interim@paragraph:1154] [official-interim@paragraph:1159] | 计划兑现结果及实际参与人数仍待具体披露。 |'
const employeeSections = () => [{ id: 'management-capital-allocation', markdown: '员工计划及治理资料。' }, { id: 'monitoring-checklist', markdown: missingParticipants }]

test('R175 employee-plan false gap uses the same plan and period employee-count column, not share count or upper limit', () => {
  const fixed = reconcileCompanyEmployeePlanEvidence({ sections: employeeSections(), methodResults: [planMethod()] })[1]!.markdown
  assert.doesNotMatch(fixed, /实际参与人数未见披露|实际参与人数仍待具体披露/)
  assert.match(fixed, /(?:员工人数|人数列).{0,12}21,?417\s*人/)
  assert.doesNotMatch(fixed, /22,?501,?479\s*人|(?:员工人数|人数列).{0,12}100\s*人/)
  assert.ok(fixed.includes('[official-interim@paragraph:1139]'), 'employee-count claim needs the actual header')
  assert.ok(fixed.includes('[official-interim@paragraph:1154]'), 'employee-count claim needs the plan-year anchor')
  assert.ok(fixed.includes('[official-interim@paragraph:1159]'), 'employee-count claim needs the exact numeric row')
  assert.match(fixed, /10,714,990股/, 'cumulative purchase disclosure is a separate preserved metric')
  const again = reconcileCompanyEmployeePlanEvidence({ sections: [{ id: 'management-capital-allocation', markdown: '员工计划及治理资料。' }, { id: 'monitoring-checklist', markdown: fixed }], methodResults: [planMethod()] })[1]!.markdown
  assert.equal(again, fixed, 'reconciliation must be idempotent')
})

test('employee-plan correction requires an employee-count header and does not treat shares as people', () => {
  const rows = participantRows.filter(row => row.location !== 'paragraph:1139')
  const fixed = reconcileCompanyEmployeePlanEvidence({ sections: employeeSections(), methodResults: [planMethod(rows)] })[1]!.markdown
  assert.equal(fixed, missingParticipants)
})

test('employee-plan correction does not borrow a different named plan', () => {
  const rows = participantRows.filter(row => !['paragraph:1145', 'paragraph:1148'].includes(row.location)).map(row => row.location === 'paragraph:1154' ? { ...row, text: '2024年员工持股计划：' } : row)
  const fixed = reconcileCompanyEmployeePlanEvidence({ sections: employeeSections(), methodResults: [planMethod(rows)] })[1]!.markdown
  assert.equal(fixed, missingParticipants)
})

test('employee-plan correction does not use a different report period for the current-period count', () => {
  const fixed = reconcileCompanyEmployeePlanEvidence({ sections: employeeSections(), methodResults: [planMethod(participantRows, '2025年半年度报告')] })[1]!.markdown
  assert.equal(fixed, missingParticipants)
})

test('conflicting employee counts for the same cited plan remain a visible unresolved gap', () => {
  const rows = [...participantRows, { sourceCandidateId: participantSource, location: 'paragraph:1160', text: '21,418 22,501,479 无 0.2468%' }]
  const sections = employeeSections()
  sections[1]!.markdown += ' [official-interim@paragraph:1160]'
  const fixed = reconcileCompanyEmployeePlanEvidence({ sections, methodResults: [planMethod(rows)] })[1]!.markdown
  assert.equal(fixed, sections[1]!.markdown)
})

const customerSource = 'official-annual'
const customerRows = [
  { sourceCandidateId: customerSource, location: 'paragraph:921', text: '序号 客户名称 销售额（元） 占年度销售总额比例' },
  { sourceCandidateId: customerSource, location: 'paragraph:922', text: '1 客户一 100,736,686,000.00 12.53%' },
  { sourceCandidateId: customerSource, location: 'paragraph:923', text: '2 客户二 16,498,131,000.00 2.05%' },
]
const riskMethod = (rows = customerRows) => ({ skillId: 'company_risk_analysis', status: 'complete', executionEvidence: [{ sourceCandidateId: customerSource, title: '2025年年度报告', publisher: '公司', excerpts: rows }] } as unknown as CompanyResearchMethodResult)
const reverseComparison = '| 客户集中与身份归因 | 最大客户削减采购可能减少相应收入，并降低专用产能利用率；披露中最大客户销售占比低于第二大客户，但静态销售占比不等于实际损失。[official-annual@paragraph:921] [official-annual@paragraph:922] [official-annual@paragraph:923] | 监控客户订单和回款变化 |'

test('R175 max-versus-second customer wording is checked and corrected from the cited official rows', () => {
  const sections = [{ id: 'risks', markdown: reverseComparison }]
  assert.deepEqual(findCustomerConcentrationComparisonContradictions({ sections, methodResults: [riskMethod()] }), [{ sectionId: 'risks' }])
  const fixed = reconcileCompanyRiskBoundaries({ sections, methodResults: [riskMethod()] })[0]!.markdown
  assert.match(fixed, /最大客户销售占比高于第二大客户/)
  assert.match(fixed, /静态销售占比不等于实际损失/)
  for (const p of [922, 923]) assert.ok(fixed.includes(`[official-annual@paragraph:${p}]`))
  assert.deepEqual(findCustomerConcentrationComparisonContradictions({ sections: [{ id: 'risks', markdown: fixed }], methodResults: [riskMethod()] }), [])
})

test('correct max-versus-second comparison and incomplete cited evidence are preserved', () => {
  const correct = reverseComparison.replace('低于第二大客户', '高于第二大客户')
  assert.deepEqual(findCustomerConcentrationComparisonContradictions({ sections: [{ id: 'risks', markdown: correct }], methodResults: [riskMethod()] }), [])
  const missingSecond = riskMethod(customerRows.filter(row => row.location !== 'paragraph:923'))
  assert.deepEqual(findCustomerConcentrationComparisonContradictions({ sections: [{ id: 'risks', markdown: reverseComparison }], methodResults: [missingSecond] }), [])
  assert.equal(reconcileCompanyRiskBoundaries({ sections: [{ id: 'risks', markdown: reverseComparison }], methodResults: [missingSecond] })[0]!.markdown, reverseComparison)
})

test('conflicting cited customer ratios are not silently replaced by a chosen ratio', () => {
  const rows = [...customerRows, { sourceCandidateId: customerSource, location: 'paragraph:924', text: '2 客户二 120,000,000,000.00 15.00%' }]
  const line = `${reverseComparison} [official-annual@paragraph:924]`
  assert.equal(reconcileCompanyRiskBoundaries({ sections: [{ id: 'risks', markdown: line }], methodResults: [riskMethod(rows)] })[0]!.markdown, line)
})
