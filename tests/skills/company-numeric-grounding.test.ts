import test from 'node:test'
import assert from 'node:assert/strict'
import { validateCompanyNumericGrounding } from '../../skills/company-research/numeric-grounding.ts'
import type { NormalizedResearchSource } from '../../plugins/research-acquisition/contracts.ts'
import { prepareCompanyFinancialAnalysis } from '../../workflows/company-deep-research/financial-analysis.ts'

const source = { candidate: { candidateId: 'filing-2025-003', kind: 'official_disclosure', tier: 1, provider: 'fixture', title: '财报' }, title: '财报', content: '2025年收入 30,396,400,000 元，研发 2 亿元。\n未引用段落收入 999 亿元。' } as NormalizedResearchSource
test('numeric grounding accepts cited amounts and explicit unit conversion, not citation ID numbers', () => {
  const result = validateCompanyNumericGrounding({ markdown: '收入303.964亿元，研发2亿元。[filing-2025-003@paragraph:1]', sources: [source] })
  assert.equal(result.status, 'grounded')
})
test('numeric grounding rejects novel forecasts and uncited-document numbers', () => {
  const result = validateCompanyNumericGrounding({ markdown: '预测增长45.5%，未来收入999亿元。[filing-2025-003@paragraph:1]', sources: [source] })
  assert.deepEqual(result.diagnostics.map((item) => item.token), ['45.5', '999亿元'])
})
test('numeric grounding accepts rounded prepared calculation and editorial ordinal/cadence', () => {
  const result = validateCompanyNumericGrounding({ markdown: '1. 收入分析\n同比增长19.1%。每3个月监控订单。第4阶段。', sources: [], preparedAnalysis: { growthPercent: 19.079 }, trustedText: ['002594', '2026-10-14'] })
  assert.equal(result.status, 'grounded')
})
test('numeric grounding preserves magnitude distinction and does not borrow an equal raw value from another unit', () => {
  const result = validateCompanyNumericGrounding({ markdown: '研发2万元。[filing-2025-003@paragraph:1]', sources: [source] })
  assert.equal(result.status, 'unsupported_numbers')
})

test('numeric grounding allows ordinary source rounding and trusted ratio to percent conversion', () => {
  const result = validateCompanyNumericGrounding({ markdown: '收入约303.96亿元，现金转化率20.1%。[filing-2025-003@paragraph:1]', sources: [source], preparedAnalysis: { ratio: 0.20079 } })
  assert.equal(result.status, 'grounded')
})

test('numeric grounding resolves report metadata years and explicit Chinese registration dates', () => {
  const official = { ...source, title: '2025年年度报告', content: '其于一九九五年二月注册成立。' }
  assert.equal(validateCompanyNumericGrounding({ markdown: '2025年报说明，前身于1995年2月注册。[filing-2025-003@paragraph:1]', sources: [official] }).status, 'grounded')
  assert.equal(validateCompanyNumericGrounding({ markdown: '于1996年注册。[filing-2025-003@paragraph:1]', sources: [official] }).status, 'unsupported_numbers')
})

test('numeric grounding preserves decrease/outflow signs without accepting the opposite growth direction', () => {
  const official = { ...source, content: '投资活动产生的现金流量净额 -197,463,109,000 元。现金净增加额 -33,861,345,000 元。' }
  assert.equal(validateCompanyNumericGrounding({ markdown: '收入同比下降7.1%。投资净流出约1975亿元，现金净减少约339亿元。[filing-2025-003@paragraph:1]', sources: [official], preparedAnalysis: { growthPercent: -7.128167 } }).status, 'grounded')
  assert.equal(validateCompanyNumericGrounding({ markdown: '收入同比增长7.1%。', sources: [], preparedAnalysis: { growthPercent: -7.128167 } }).status, 'unsupported_numbers')
})

test('numeric grounding supports explicitly shared monetary unit in one table cell only', () => {
  const result = validateCompanyNumericGrounding({ markdown: '| 经营现金流 / 资本开支 | 373 / 447亿元 |', sources: [], preparedAnalysis: { operatingCashFlow: 37310000000, capex: 44730000000 } })
  assert.equal(result.status, 'grounded')
  assert.equal(validateCompanyNumericGrounding({ markdown: '373元，447亿元。', sources: [], preparedAnalysis: { operatingCashFlow: 37310000000, capex: 44730000000 } }).status, 'unsupported_numbers')
})

test('numeric grounding respects explicit monetary row unit without scaling percent changes', () => {
  const preparedAnalysis = { current:27798000000, prior:16955000000, growthPercent:63.95 }
  assert.equal(validateCompanyNumericGrounding({markdown:'| 收入（亿元） | 277.98 | 169.55 | +63.95% |',sources:[],preparedAnalysis}).status,'grounded')
  assert.equal(validateCompanyNumericGrounding({markdown:'| 收入（万元） | 277.98 | 169.55 | +63.95% |',sources:[],preparedAnalysis}).status,'unsupported_numbers')
})

test('numeric grounding distinguishes shorthand decline from a positive level declined to', () => {
  assert.equal(validateCompanyNumericGrounding({markdown:'收入同比降18.97%。',sources:[],preparedAnalysis:{growth:-18.97}}).status,'grounded')
  assert.equal(validateCompanyNumericGrounding({markdown:'收入下降至100亿元。',sources:[],preparedAnalysis:{revenue:1e10}}).status,'grounded')
  assert.equal(validateCompanyNumericGrounding({markdown:'收入降到100亿元。',sources:[],preparedAnalysis:{revenue:1e10}}).status,'grounded')
  assert.equal(validateCompanyNumericGrounding({markdown:'收入同比降18.97%。',sources:[],preparedAnalysis:{growth:18.97}}).status,'unsupported_numbers')
})

test('decrease direction ends at comma or completed number and never negates a reporting year', () => {
  const preparedAnalysis = {growth:-7.1,revenue:100,netProfit:20}
  const trustedText = ['2025年', '2026-10-15']
  for (const markdown of ['2025年收入小幅增长而归母净利润下降，2026年上半年。', '利润下降2026年重新核对。', '利润下降7.1%而收入100、净利润20。', '利润下降，收入100。']) {
    assert.equal(validateCompanyNumericGrounding({markdown,sources:[],preparedAnalysis,trustedText}).status,'grounded',markdown)
  }
  assert.equal(validateCompanyNumericGrounding({markdown:'利润下降7.1%。',sources:[],preparedAnalysis:{growth:7.1}}).status,'unsupported_numbers')
  assert.equal(validateCompanyNumericGrounding({markdown:'收入降至约100亿元。',sources:[],preparedAnalysis:{revenue:1e10}}).status,'grounded')
  assert.equal(validateCompanyNumericGrounding({markdown:'利润下降，2027年收入100。',sources:[],preparedAnalysis,trustedText}).status,'unsupported_numbers','unknown year is still unsupported')
})

test('unitless table amounts follow deterministic financial display calculations without trusting model strings', () => {
  const financial = {...source,candidate:{...source.candidate,metadata:{dataProvenance:{metricId:'company_financial_history'}}}}
  const preparedAnalysis = prepareCompanyFinancialAnalysis({company:{symbol:'002594'},asOf:'2026-10-15',sources:[financial],financialData:[{periodEnd:'2026-06-30',metrics:{revenue:344815000000},metricMetadata:{revenue:{unit:'CNY',currency:'CNY',basis:'YTD'}},pointInTimeSafe:false,pointInTimeStatus:'CURRENT_VALUE_ONLY'}]})
  const markdown='以下金额亿元。\n| 指标 | 2026年 |\n| 营业收入 | 3,448.15 |'
  assert.equal(validateCompanyNumericGrounding({markdown,sources:[financial],preparedAnalysis,trustedText:['2026年']}).status,'grounded')
  assert.equal(validateCompanyNumericGrounding({markdown:markdown.replace('3,448.15','3,548.15'),sources:[financial],preparedAnalysis,trustedText:['2026年']}).status,'unsupported_numbers')
  assert.equal(validateCompanyNumericGrounding({markdown:'收入3,448.15万元。',sources:[financial],preparedAnalysis}).status,'unsupported_numbers','explicit wrong magnitude is not rescued by display value')
  assert.equal(validateCompanyNumericGrounding({markdown:'收入3,448.15。',sources:[],preparedAnalysis:{markdown:'model says 3,448.15'}}).status,'unsupported_numbers')
})

test('publication year context is admitted only from the cited source verified metadata', () => {
  const article = {...source,title:'行业文章',content:'沪电股份专注于企业通讯板。',candidate:{...source.candidate,metadata:{observedPublicationDate:'2019-08-19',historicalSourceContext:{observedYear:2019,basis:'fetched_html_publication_meta'}}}}
  assert.equal(validateCompanyNumericGrounding({markdown:'2019年行业文章说明业务。[filing-2025-003@paragraph:1]',sources:[article]}).status,'grounded')
  assert.equal(validateCompanyNumericGrounding({markdown:'2018年行业文章说明业务。[filing-2025-003@paragraph:1]',sources:[article]}).status,'unsupported_numbers')
  const other={...article,candidate:{...article.candidate,candidateId:'other'}}
  assert.equal(validateCompanyNumericGrounding({markdown:'2019年行业文章说明业务。[filing-2025-003@paragraph:1]',sources:[{...source,title:'行业文章',content:'企业产品说明。'},other]}).status,'unsupported_numbers')
  const invalid={...article,candidate:{...article.candidate,metadata:{observedPublicationDate:'2019-02-31',historicalSourceContext:{observedYear:2019,basis:'arbitrary_model_claim'}}}}
  assert.equal(validateCompanyNumericGrounding({markdown:'2019年行业文章。[filing-2025-003@paragraph:1]',sources:[invalid]}).status,'unsupported_numbers')
  const titleContext={...article,candidate:{...article.candidate,metadata:{historicalSourceContext:{observedYear:2019,basis:'explicit_title_year'}}}}
  assert.equal(validateCompanyNumericGrounding({markdown:'2019年行业文章。[filing-2025-003@paragraph:1]',sources:[titleContext]}).status,'grounded')
  assert.equal(validateCompanyNumericGrounding({markdown:'2019年行业文章。',sources:[article]}).status,'unsupported_numbers')
})

test('bare financial cells inherit only this table explicit column or immediately preceding declared unit', () => {
  const article={...source,content:'分部收入12,530,120,000元；6,581,120,000元；5,351,120,000元；2,723,120,000元。'}
  const markdown='**产品分部比较（人民币亿元）**\n\n| 产品 | 本期收入 | 同比% |\n|---|---:|---:|\n| 软板 | 125.30 | 10% |\n| 硬板 | 65.81 | 20% |\n| 显示 | 53.51 | 30% |\n| 其他 | 27.23 | 40% |\n[filing-2025-003@paragraph:1]'
  const preparedAnalysis={growth:[10,20,30,40]}
  assert.equal(validateCompanyNumericGrounding({markdown,sources:[article],preparedAnalysis}).status,'grounded')
  assert.equal(validateCompanyNumericGrounding({markdown:markdown.replace('（人民币亿元）',''),sources:[article],preparedAnalysis}).status,'unsupported_numbers')
  assert.equal(validateCompanyNumericGrounding({markdown:markdown.replace('125.30','135.30'),sources:[article],preparedAnalysis}).status,'unsupported_numbers')
  const header='| 产品 | 收入（万元） |\n|---|---:|\n| 软板 | 1253012.00 |\n[filing-2025-003@paragraph:1]'
  assert.equal(validateCompanyNumericGrounding({markdown:header,sources:[article]}).status,'grounded')
  assert.equal(validateCompanyNumericGrounding({markdown:header.replace('万元','亿元'),sources:[article]}).status,'unsupported_numbers')
  const detached=markdown.replace('\n\n| 产品','\n\n下面另列未声明口径的数据。\n\n| 产品')
  assert.equal(validateCompanyNumericGrounding({markdown:detached,sources:[article],preparedAnalysis}).status,'unsupported_numbers')
})

test('declared monetary table unit does not scale percentage, days, multiples, dates or header years', () => {
  const markdown='**比较（人民币亿元）**\n| 产品 | 本期收入 | 收入同比 | 天数 | 倍数 | 日期 |\n|---|---:|---:|---:|---:|---|\n| A | 125.30 | 10 | 30 | 2 | 2026年 |'
  assert.equal(validateCompanyNumericGrounding({markdown,sources:[],preparedAnalysis:{revenue:12530120000,growth:10,days:30,multiple:2},trustedText:['2026年']}).status,'grounded')
  const wrong='**比较（人民币亿元）**\n| 产品 | 收入同比 | 天数 | 倍数 | 日期 |\n|---|---:|---:|---:|---|\n| A | 125.30 | 125.30 | 125.30 | 2026年 |'
  assert.equal(validateCompanyNumericGrounding({markdown:wrong,sources:[],preparedAnalysis:{revenue:12530120000},trustedText:['2026年']}).diagnostics.length,3)
  const explicitRow='| 指标 | 本期 | 收入同比 | 现金转化率 |\n|---|---:|---:|---:|\n| 收入（亿元） | 125.30 | 10 | 2 |'
  assert.equal(validateCompanyNumericGrounding({markdown:explicitRow,sources:[],preparedAnalysis:{revenue:12530120000,growth:10,ratio:2}}).status,'grounded')
})
