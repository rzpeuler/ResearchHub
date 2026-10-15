import test from 'node:test'
import assert from 'node:assert/strict'
import { extractOfficialAnnualFinancials } from '../../../plugins/research-acquisition/company-official-financial.ts'
import type { NormalizedResearchSource } from '../../../plugins/research-acquisition/contracts.ts'
const source: NormalizedResearchSource = { candidate: { candidateId: 'report', kind: 'official_disclosure', tier: 1, title: '2025年年度报告', provider: 'cninfo', publishedAt: '2026-03-28' }, title: '2025年年度报告', retrievedAt: '2026-10-14', publisher: 'CNINFO', contentHash: 'hash', rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false }, content: '主要会计数据和财务指标\n单位：人民币元\n| 项目 | 2025 年 | 2024 年 | 本年增长 |\n| 营业收入 | 1,000.00 | 800 | 25% |\n| 归属于上市公司股东的净利润 | 100 | 80 | 25% |\n| 经营活动产生的现金流量净额 | 110 | 90 | 22% |\n| 总资产 | 2,000 | 1800 | 11% |' }
test('official annual fallback reads explicit first-year accounting values with units and publication', () => {
  const [row] = extractOfficialAnnualFinancials(source)
  assert.equal(row?.periodEnd, '2025-12-31')
  assert.equal(row?.publishedAt, '2026-03-28')
  assert.equal(row?.metrics.revenue, 1000)
  assert.equal(row?.metrics.operatingCashFlow, 110)
  assert.equal(row?.metricMetadata?.assets?.basis, 'POINT_IN_TIME')
  assert.equal(row?.pointInTimeSafe, false)
})
test('unclear units, wrong fiscal columns and summaries fail closed', () => {
  assert.deepEqual(extractOfficialAnnualFinancials({ ...source, content: source.content.replace('单位：人民币元', '') }), [])
  assert.deepEqual(extractOfficialAnnualFinancials({ ...source, content: source.content.replace('2025 年', '2024 年') }), [])
  assert.deepEqual(extractOfficialAnnualFinancials({ ...source, title: '2025年年度报告摘要' }), [])
})
test('text-first annual accounting rows require explicit ordered fiscal header and exact labels', () => {
  const plain = { ...source, content: '主要会计数据和财务指标\n2025 年 2024 年 本年比上年增减 2023 年\n营业收入（元） 803,964,958,000.00 777,102,455,000.00 3.46% 602,315,354,000.00\n归属于上市公司股东的净利润（元） 32,619,022,000.00 40,254,346,000.00 -18.97% 30,040,811,000.00\n经营活动产生的现金流量净额（元） 59,135,544,000.00 133,453,873,000.00 -55.69% 169,725,025,000.00' }
  assert.equal(extractOfficialAnnualFinancials(plain)[0]?.metrics.revenue, 803964958000)
  assert.deepEqual(extractOfficialAnnualFinancials({ ...plain, content: plain.content.replace('2025 年 2024 年', '2024 年 2025 年') }), [])
})
