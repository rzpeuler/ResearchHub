import test from 'node:test'
import assert from 'node:assert/strict'
import { selectCompanyEvidence, withCompanyEvidenceDateContext } from '../../skills/company-research/evidence.ts'
import type { CompanyResearchInput } from '../../skills/company-research/contracts.ts'

const lines = Array.from({ length: 1000 }, (_, index) => `常规经营信息${index}。`)
const put = (index: number, rows: string[]) => rows.forEach((text, offset) => { lines[index + offset] = text })
put(20, ['前五大客户集中度较高，存在主要客户需求下滑风险。'])
put(300, ['公司主要销售客户情况', '前五名客户合计销售金额（元） 25,814,059,702.20', '前五名客户合计销售金额占年度销售总额比例 64.33%', '公司前5大客户资料', '序号 客户名称 销售额（元） 占年度销售总额比例', '1 第一名 18,642,838,150.75 46.46%', '2 第二名 2,809,002,571.15 7.00%', '3 第三名 2,281,029,373.69 5.68%', '4 第四名 1,234,755,113.48 3.08%', '5 第五名 846,434,493.13 2.11%', '合计 -- 25,814,059,702.20 64.33%'])
put(330, ['前五名供应商合计采购金额占年度采购总额比例21.87%', '序号 供应商名称 采购额（元） 占年度采购总额比例', '1 第一名 1,463,828,472.13 5.58%'])
put(400, ['2、员工持股计划的实施情况', '适用', '报告期内全部有效的员工持股计划情况', '员工的范围', '员工人', '数', '持有的股票', '总数（股）', '变更', '情况', '占上市公司股', '本总额的比例', '实施计划的资金来源', '公司及子公司核心技术骨干', '（不包括董事、高级管理人员）', '150 3,048,701 无 0.17%', '员工合法薪酬、自筹资金以', '及法律、行政法规允许的其', '他方式'])
put(500, ['1.报告期内，公司回购股份4,202,200股，导致每股净资产增加。', '影响说明。', '2.报告期内，公司增发股份125,693,822股，导致每股净资产减少。'])
put(550, ['公司计划半年度不派发现金红利。', '公司2025年度利润分配方案：向全体股东每10股派发', '现金红利人民币3.58元，现金红利总额3,263,957千元。', '截至报告披露日权益分派实施完毕。'])
put(650, ['单位：元', '营业收入 营业成本 毛利率', '分产品', '产品甲 1,435,534,921.96 908,137,144.50 36.74%'])
put(750, ['公司研发投入情况', '2025年 2024年 变动比例', '研发投入金额（元） 63441379000 54160964000 17.13%', '研发投入占营业收入比例7.89% 6.97%', '研发投入资本化的金额（元） 5463274000 966219000', '资本化研发投入占研发投入', '的比例 1.78% 0.86% 0.92%'])
put(850, ['管理层主要工作经历', '董事长毕业后从事材料研究，曾任总经理。'])
put(870, ['主要股东持股比例', '甲某 境内自然人 16.53% 302781254'])
put(890, ['公司于一九九五年共同注册成立，后改制为股份公司。'])
put(910, ['公司完成56亿美元闪电配售，为发展筹集资金。'])
const source = { candidate: { candidateId: 'annual', publishedAt: '2026-03-28' }, title: '2025年年度报告', content: lines.join('\n'), publisher: '公司' } as CompanyResearchInput['sources'][number]
const select = (purpose: string, maxCharacters = 32000) => selectCompanyEvidence([source], ['annual'], ['客户', '分产品', '研发', '管理', '分红', '回购', '成立'], { purpose, maxCharacters })[0]!
const has = (purpose: string, row: number) => assert.ok(select(purpose).excerpts.some((excerpt) => excerpt.location === `paragraph:${row}`), `${purpose} missing actual row ${row}`)

test('numeric concentration tables outrank early generic risk text and keep anonymous first-customer plus total rows', () => {
  for (const purpose of ['financial_quality_analysis', 'company_risk_analysis', 'market_structure_analysis']) for (const row of [302, 303, 306, 311]) has(purpose, row)
  has('company_risk_analysis', 654)
})

test('employee-plan full header and data span, share actions and split research ratio survive selection', () => {
  for (const row of [401, 416, 419]) has('management_governance_analysis', row)
  for (const row of [501, 503, 552, 553, 911]) has('capital_allocation_review', row)
  for (const purpose of ['product_technology_analysis', 'financial_quality_analysis', 'capital_allocation_review']) has(purpose, 757)
})

test('bounded independent content review covers uncited concentration, incentives, share actions, segments and biography', () => {
  const packet = select('company_content_review', 12000)
  for (const row of [306, 311, 416, 501, 503, 654, 757, 852, 891]) assert.ok(packet.excerpts.some((excerpt) => excerpt.location === `paragraph:${row}`), `review missing ${row}`)
  assert.ok(packet.excerpts.length <= 120)
  assert.ok(packet.excerpts.reduce((sum, row) => sum + row.text.length, 0) <= 12000)
})

test('only an unfinished financial year-on-year clause binds its supplied immediate percentage continuation', () => {
  const packet = (first: string, second: string, nextLocation = 'paragraph:35') => ({ sourceCandidateId: 'annual', title: '年度报告', publisher: '公司', excerpts: [
    { sourceCandidateId: 'annual', location: 'paragraph:34', text: first },
    { sourceCandidateId: 'annual', location: nextLocation, text: second },
  ] })
  const positive = packet('其中汽车相关业务收入617382百万元，同比', '增长27.70%；手机业务收入159609百万元，同比增长34.60%。')
  assert.deepEqual(withCompanyEvidenceDateContext(positive).excerpts[0]!.contextLocations, ['paragraph:35'])
  assert.deepEqual(withCompanyEvidenceDateContext(packet('汽车收入617382百万元，同比增长', '27.70%；其他业务另行披露。')).excerpts[0]!.contextLocations, ['paragraph:35'])
  for (const value of [
    packet('汽车收入617382百万元，同比增长27.70%。', '增长34.60%；另一业务情况。'),
    packet('汽车收入617382百万元，同比', '手机收入同比增长34.60%。'),
    packet('汽车收入617382百万元，同比下降', '增长27.70%；其他情况。'),
    packet('汽车收入617382百万元，同比', '增长27.70%；其他情况。', 'paragraph:36'),
    { ...positive, excerpts: positive.excerpts.slice(0, 1) },
    packet('风险说明，同比', '增长27.70%；其他情况。'),
  ]) assert.equal(withCompanyEvidenceDateContext(value).excerpts[0]!.contextLocations, undefined)
})
