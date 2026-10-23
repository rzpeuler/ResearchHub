import assert from 'node:assert/strict'
import test from 'node:test'
import { reconcileCompanyPreparedAnalysisFacts, reconcileCompanyProductRevenueRowCitations } from '../../workflows/company-deep-research/content-quality.ts'
import type { CompanyResearchMethodResult } from '../../skills/company-research/methods.ts'

const method = (chinaText = '台地区） 163,547,247,000.00 47.43% 235,923,281,000.00 63.54% -30.68%'): CompanyResearchMethodResult => ({
  skillId: 'business_driver_analysis', status: 'complete', attempts: 1, answer: '', markdown: '', sections: [], findings: [], sourceCandidateIds: ['official-c19c34dd239b2e9c'], limitations: [], risks: [], diagnostics: [],
  executionEvidence: [{ sourceCandidateId: 'official-c19c34dd239b2e9c', title: '2026年半年度报告', publisher: 'CNINFO', excerpts: [
    { sourceCandidateId: 'official-c19c34dd239b2e9c', location: 'paragraph:710', text: '分地区' },
    { sourceCandidateId: 'official-c19c34dd239b2e9c', location: 'paragraph:711', text: '中国（包括港澳' },
    { sourceCandidateId: 'official-c19c34dd239b2e9c', location: 'paragraph:712', text: chinaText },
    { sourceCandidateId: 'official-c19c34dd239b2e9c', location: 'paragraph:713', text: '境外 181,268,174,000.00 52.57% 135,357,667,000.00 36.46% 33.92%' }
  ] }]
})

test('R142 attaches the exact China and overseas H1 rows to the matching geographic revenue conclusion', () => {
  const section = { id: 'revenue-profit-drivers', sourceCandidateIds: [] as string[], markdown: '分地区行则显示境外收入增长、中国（包括港澳台地区）收入下降。两套表反映的维度不同。' }
  const fixed = reconcileCompanyProductRevenueRowCitations({ sections: [section], methodResults: [method()] })[0]!
  assert.match(fixed.markdown, /境外收入增长、中国（包括港澳台地区）收入下降 \[official-c19c34dd239b2e9c@paragraph:712\] \[official-c19c34dd239b2e9c@paragraph:713\]。/)
  assert.ok(fixed.sourceCandidateIds?.includes('official-c19c34dd239b2e9c'))
  const repeated = reconcileCompanyProductRevenueRowCitations({ sections: [fixed], methodResults: [method()] })[0]!
  assert.equal(repeated.markdown.match(/official-c19c34dd239b2e9c@paragraph:712/g)?.length, 1)
  assert.equal(repeated.markdown.match(/official-c19c34dd239b2e9c@paragraph:713/g)?.length, 1)
})

test('R142 does not attach geographic evidence unless the source rows exactly support the stated direction and amounts', () => {
  const section = { id: 'revenue-profit-drivers', sourceCandidateIds: [] as string[], markdown: '分地区行则显示境外收入增长、中国（包括港澳台地区）收入下降。' }
  const mismatched = reconcileCompanyProductRevenueRowCitations({ sections: [section], methodResults: [method('台地区） 163,547,247,000.00 47.43% 235,923,281,000.00 63.54% +30.68%')] })
  assert.deepEqual(mismatched, [section])
  const unrelated = { ...section, markdown: '境外收入增长。' }
  assert.deepEqual(reconcileCompanyProductRevenueRowCitations({ sections: [unrelated], methodResults: [method()] }), [unrelated])
})

test('R142 restores historical China NEV scale and scopes acquisition evidence to the FY2024 disclosure', () => {
  const sourceBody = Array.from({ length: 586 }, () => '其他年度报告披露。')
  sourceBody[17] = '中国新能源汽车全年销量达到 1,286.6 万辆，同比增长。'
  sourceBody[585] = '此外，随着本集团并表二零二三年年底完成收购的业务，拉动零部件业务规模快速扩大，并通过资源整合提升经营效率。'
  const source = { candidate: { candidateId: 'official-f6274e510499a654' }, title: '2024年年度报告', content: sourceBody.join('\n') }
  const sections = [
    { id: 'industry-exposure', sourceCandidateIds: [] as string[], markdown: '行业规模背景。中国新能源汽车历史销量规模虽出现在preparedAnalysis的计算结果中，但其引用的年报原文定位未被本轮证据摘录提供，故不保留该数值，亦不以其他段落替代。' },
    { id: 'management-capital-allocation', sourceCandidateIds: [] as string[], markdown: '关于收购并表及其业务规模影响的待核查反馈并非本轮可核验原文，故不把该反馈当作事实，也不再笼统声称不存在可核实并购；相关交易标的、对价、资金来源和可归因回报仍需本轮证据补足。\n\n### 并购与资本回报判断\n现有材料没有可核实的具体并购交易标的、对价、资金来源及后续经营结果，因此不能建立并购投入台账或判断并购价值。并购方面，所给证据仍未显示可核验的并购交易金额、支付状态或标的级投入；回购方面没有相关数据。' }
  ]
  const preparedAnalysis = { marketSizing: { calculations: { status: 'calculated', value: 1286.6, unit: '万辆', formula: '2024年中国新能源汽车全年销量(1286.6 万辆)', marketBoundary: '2024年中国新能源汽车全年销量（历史行业销量规模，不代表比亚迪可服务市场或公司TAM）', asOf: '2024-12-31', evidence: [{ sourceCandidateId: 'official-f6274e510499a654', location: 'paragraph:18' }] } } }
  const fixed = reconcileCompanyPreparedAnalysisFacts({ sections, methodResults: [], preparedAnalysis, sources: [source] })
  const market = fixed.find(item => item.id === 'industry-exposure')!
  assert.doesNotMatch(market.markdown, /年报原文定位未被本轮证据摘录提供/)
  assert.match(market.markdown, /2024年中国新能源汽车全年销量为1,286\.6万辆/)
  assert.match(market.markdown, /历史行业销量规模，不代表比亚迪销量、份额或公司TAM/)
  assert.match(market.markdown, /official-f6274e510499a654@paragraph:18/)
  const capital = fixed.find(item => item.id === 'management-capital-allocation')!
  assert.match(capital.markdown, /2024年年报披露，集团并表一项于2023年年底完成收购的业务/)
  assert.match(capital.markdown, /拉动零部件业务规模快速扩大/)
  assert.match(capital.markdown, /未披露标的名称、交易对价、资金来源或可单独归因的收入、利润及现金流/)
  assert.match(capital.markdown, /official-f6274e510499a654@paragraph:586/)
  assert.doesNotMatch(capital.markdown, /并购方面，所给证据仍未显示可核验的并购交易金额/)
  assert.doesNotMatch(capital.markdown, /现有材料没有可核实的具体并购交易标的/)
})

test('R142 leaves prepared NEV and acquisition claims untouched when FY2024 source paragraphs do not verify', () => {
  const lines = Array.from({ length: 586 }, () => '其他披露。')
  lines[17] = '中国汽车销量有披露，但本段未列新能源汽车全年销量。'
  lines[585] = '本集团业务规模增长。'
  const source = { candidate: { candidateId: 'official-f6274e510499a654' }, title: '2024年年度报告', content: lines.join('\n') }
  const sections = [
    { id: 'industry-exposure', sourceCandidateIds: [] as string[], markdown: '中国新能源汽车历史销量规模虽出现在preparedAnalysis的计算结果中，但其引用的年报原文定位未被本轮证据摘录提供，故不保留该数值。' },
    { id: 'management-capital-allocation', sourceCandidateIds: [] as string[], markdown: '现有材料没有可核实的具体并购交易标的、对价、资金来源及后续经营结果，因此不能建立并购投入台账或判断并购价值。' }
  ]
  const preparedAnalysis = { marketSizing: { calculations: { status: 'calculated', value: 1286.6, unit: '万辆', formula: '2024年中国新能源汽车全年销量', marketBoundary: '历史行业销量规模', asOf: '2024-12-31', evidence: [{ sourceCandidateId: 'official-f6274e510499a654', location: 'paragraph:18' }] } } }
  assert.deepEqual(reconcileCompanyPreparedAnalysisFacts({ sections, methodResults: [], preparedAnalysis, sources: [source] }), sections)
  const wrongYear = { ...source, title: '2025年年度报告' }
  assert.deepEqual(reconcileCompanyPreparedAnalysisFacts({ sections, methodResults: [], preparedAnalysis, sources: [wrongYear] }), sections)
})
