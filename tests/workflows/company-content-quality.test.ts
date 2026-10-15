import assert from 'node:assert/strict'
import test from 'node:test'
import { COMPANY_CORE_SECTION_IDS, evaluateCompanyResearchContent } from '../../workflows/company-deep-research/content-quality.ts'
import type { CompanyResearchMethodResult } from '../../skills/company-research/methods.ts'
const sections = () => COMPANY_CORE_SECTION_IDS.map((id) => ({ id, markdown: `对 ${id} 的分析：披露事实支持经营机制判断，同时存在执行风险。`, sourceCandidateIds: ['annual-report'] }))
test('content gate rejects missing core research even with admissible evidence', () => { const result = evaluateCompanyResearchContent({ sections: sections().slice(1) }); assert.equal(result.passed, false); assert.ok(result.issues.includes('company-overview:MISSING_SECTION')) })
test('fallback cannot pass through content gate', () => { assert.equal(evaluateCompanyResearchContent({ sections: sections(), synthesisMode: 'deterministic_fallback' }).passed, false) })
test('observations duplicated as financial analysis fail independently of citations', () => { const value = sections(); value[9] = { ...value[9]!, markdown: 'Retrieved structured financial observations (provider-reported values): revenue 10' }; assert.ok(evaluateCompanyResearchContent({ sections: value }).issues.includes('financial-quality:OBSERVATIONS_WITHOUT_ANALYSIS')) })
test('optional valuation gaps do not block core completion', () => { assert.equal(evaluateCompanyResearchContent({ sections: [...sections(), { id: 'valuation', markdown: '研究缺口：无法获取估值基础', sourceCandidateIds: [] }] }).passed, true) })
test('failed selected method blocks completion', () => { assert.equal(evaluateCompanyResearchContent({ sections: sections(), methodExecutions: [{ skillId: 'business_model_map', status: 'failed', attempts: 2, errorCode: 'TIMEOUT' }] }).passed, false) })
test('a shared section is not counted complete when one required owning method failed', () => {
  const failed:CompanyResearchMethodResult={skillId:'capital_allocation_review',status:'failed',attempts:2,answer:'',markdown:'',sections:[],findings:[],sourceCandidateIds:[],limitations:['尚未完成资本配置'],risks:[],diagnostics:[]}
  const quality=evaluateCompanyResearchContent({sections:sections(),methodResults:[failed]})
  assert.equal(quality.passed,false)
  assert.equal(quality.coreCoverage.completed,15)
  assert.ok(quality.sectionChecks.find(check=>check.sectionId==='management-capital-allocation')!.reasons.includes('OWNER_METHOD_NOT_COMPLETED:capital_allocation_review'))
})

test('content gate accepts independent actual summary and section locations but rejects unsupplied locators', () => {
  const method: CompanyResearchMethodResult = { skillId: 'company_history_strategy', status: 'complete', attempts: 1, answer: '公司业务演变。', markdown: '概括发展阶段。[annual-report@paragraph:2]', sections: [{ id: 'company-overview', markdown: '分析战略转折。[annual-report@paragraph:3]' }], findings: [{ text: '公司业务演变。', kind: 'fact', evidence: [{ sourceCandidateId: 'annual-report', location: 'paragraph:1' }] }], sourceCandidateIds: ['annual-report'], limitations: [], risks: [], diagnostics: [], executionEvidence: [{ sourceCandidateId: 'annual-report', title: '年度报告', publisher: 'Company', excerpts: [1, 2, 3].map((row) => ({ sourceCandidateId: 'annual-report', location: `paragraph:${row}`, text: '公司业务演变与战略转折。' })) }] }
  assert.equal(evaluateCompanyResearchContent({ sections: sections(), methodResults: [method] }).passed, true)
  const invalid = { ...method, sections: [{ id: 'company-overview', markdown: '正确及错误定位。[annual-report@paragraph:3] [annual-report@paragraph:999]' }] }
  assert.ok(evaluateCompanyResearchContent({ sections: sections(), methodResults: [invalid] }).issues.includes('METHOD_SECTION_WITHOUT_LOCATED_EVIDENCE:company_history_strategy'))
  assert.equal(evaluateCompanyResearchContent({ sections: sections(), methodResults: [{ ...method, findings: [] }] }).passed, false)
})
