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
  assert.equal(validateCompanyNumericGrounding({markdown:'简化自由现金流为负73.68亿元。',sources:[],preparedAnalysis:{freeCashFlow:-7368000000}}).status,'grounded')
  assert.equal(validateCompanyNumericGrounding({markdown:'简化自由现金流为负73.68亿元。',sources:[],preparedAnalysis:{freeCashFlow:7368000000}}).status,'unsupported_numbers')
  assert.equal(validateCompanyNumericGrounding({markdown:'负债73.68亿元。',sources:[],preparedAnalysis:{liabilities:7368000000}}).status,'grounded')
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
  const official = {...source,title:'年度报告',content:'行业面临竞争者追赶。',candidate:{...source.candidate,publishedAt:'2025-04-15T00:00:00Z'}}
  assert.equal(validateCompanyNumericGrounding({markdown:'年报发布于2025年。[filing-2025-003@paragraph:1]',sources:[official]}).status,'grounded')
  assert.equal(validateCompanyNumericGrounding({markdown:'年报发布于2024年。[filing-2025-003@paragraph:1]',sources:[official]}).status,'unsupported_numbers')
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
  const spacedPercent='| 指标 | 金额（亿元） |\n|---|---:|\n| 利润率 | 12.5 % |'
  assert.equal(validateCompanyNumericGrounding({markdown:spacedPercent,sources:[],preparedAnalysis:{ratio:12.5}}).status,'grounded')
  assert.equal(validateCompanyNumericGrounding({markdown:spacedPercent,sources:[],preparedAnalysis:{money:1250000000}}).status,'unsupported_numbers','explicit spaced percent cannot borrow a monetary amount')
  const markdown='**比较（人民币亿元）**\n| 产品 | 本期收入 | 收入同比 | 天数 | 倍数 | 日期 |\n|---|---:|---:|---:|---:|---|\n| A | 125.30 | 10 | 30 | 2 | 2026年 |'
  assert.equal(validateCompanyNumericGrounding({markdown,sources:[],preparedAnalysis:{revenue:12530120000,growth:10,days:30,multiple:2},trustedText:['2026年']}).status,'grounded')
  const wrong='**比较（人民币亿元）**\n| 产品 | 收入同比 | 天数 | 倍数 | 日期 |\n|---|---:|---:|---:|---|\n| A | 125.30 | 125.30 | 125.30 | 2026年 |'
  assert.equal(validateCompanyNumericGrounding({markdown:wrong,sources:[],preparedAnalysis:{revenue:12530120000},trustedText:['2026年']}).diagnostics.length,3)
  const explicitRow='| 指标 | 本期 | 收入同比 | 现金转化率 |\n|---|---:|---:|---:|\n| 收入（亿元） | 125.30 | 10 | 2 |'
  assert.equal(validateCompanyNumericGrounding({markdown:explicitRow,sources:[],preparedAnalysis:{revenue:12530120000,growth:10,ratio:2}}).status,'grounded')
})

test('currency in the table header never scales its reporting years but applies to monetary data rows', () => {
  const markdown='| 指标（亿元） | 2026上半年 | 2025上半年 | 同比 |\n|---|---:|---:|---:|\n| 收入 | 277.98 | 169.55 | 63.95% |'
  const preparedAnalysis={currentRevenue:27798000000,priorRevenue:16955000000,growth:63.95}
  assert.equal(validateCompanyNumericGrounding({markdown,sources:[],preparedAnalysis,trustedText:['2026年','2025年']}).status,'grounded')
  const wrongYear=validateCompanyNumericGrounding({markdown:markdown.replace('2026上半年','2031上半年'),sources:[],preparedAnalysis,trustedText:['2026年','2025年']})
  assert.deepEqual(wrongYear.diagnostics.map(item=>item.token),['2031'])
  assert.equal(validateCompanyNumericGrounding({markdown:markdown.replace('亿元','万元'),sources:[],preparedAnalysis,trustedText:['2026年','2025年']}).status,'unsupported_numbers')
})

test('explicit mixed income and percentage table cells scale only their first monetary amount', () => {
  const article={...source,content:'电子电路收入25,620,292,915.99元，毛利率17.59%；本期收入12,530,120,000元，毛利率18.80%。'}
  const prefix='**分部经营对照（人民币亿元；毛利率）**\n'
  const header='| 产品 | 2025全年收入/毛利率 |\n|---|---:|\n'
  const markdown=prefix+header+'| 电子电路 | 256.20 / 17.59% |\n[filing-2025-003@paragraph:1]'
  assert.equal(validateCompanyNumericGrounding({markdown,sources:[article],trustedText:['2025年']}).status,'grounded')
  const product='| 产品 | 2026上半年收入（亿元）及毛利率 |\n|---|---:|\n| 电路 | 125.30；18.80% |\n[filing-2025-003@paragraph:1]'
  assert.equal(validateCompanyNumericGrounding({markdown:product,sources:[article],trustedText:['2026年']}).status,'grounded')
  assert.equal(validateCompanyNumericGrounding({markdown:markdown.replace('256.20 / 17.59%','17.59 / 256.20%'),sources:[article],trustedText:['2025年']}).status,'unsupported_numbers','money and percentage cannot swap roles')
  assert.equal(validateCompanyNumericGrounding({markdown:markdown.replace('256.20 / 17.59%','256.20 / 18.80亿元'),sources:[article],trustedText:['2025年']}).status,'unsupported_numbers')
  assert.equal(validateCompanyNumericGrounding({markdown:markdown.replace('人民币亿元','人民币万元'),sources:[article],trustedText:['2025年']}).status,'unsupported_numbers')
  assert.equal(validateCompanyNumericGrounding({markdown:markdown.replace(prefix,''),sources:[article],trustedText:['2025年']}).status,'unsupported_numbers','mixed percentages do not imply a monetary unit')
  const detached=prefix+header+'| 其他 | 无数据 |\n\n另一张表不继承前表单位。\n\n'+header+'| 电子电路 | 256.20 / 17.59% |\n[filing-2025-003@paragraph:1]'
  assert.equal(validateCompanyNumericGrounding({markdown:detached,sources:[article],trustedText:['2025年']}).status,'unsupported_numbers')
})

test('explicit trailing monetary unit covers a pure enumerated list without leaking to adjacent clauses or percentages', () => {
  const article={...source,content:'电子电路12,530,120,000元，毛利率18.80%。\n精密组件6,581,120,000元，毛利率12.13%。\n光模块5,351,120,000元，毛利率39.33%。\n显示模组2,723,120,000元，毛利率5.89%。'}
  const refs=[1,2,3,4].map(n=>`[filing-2025-003@paragraph:${n}]`).join(' ')
  const markdown=`收入分别为125.30、65.81、53.51、27.23亿元；对应毛利率分别为18.80%、12.13%、39.33%、5.89%。${refs}`
  assert.equal(validateCompanyNumericGrounding({markdown,sources:[article]}).status,'grounded')
  assert.equal(validateCompanyNumericGrounding({markdown:markdown.replace('亿元','万元'),sources:[article]}).status,'unsupported_numbers')
  assert.equal(validateCompanyNumericGrounding({markdown:markdown.replace('125.30','135.30'),sources:[article]}).status,'unsupported_numbers')
  assert.equal(validateCompanyNumericGrounding({markdown:markdown.replace('125.30、65.81','125.30%；收入65.81'),sources:[article]}).status,'unsupported_numbers','unit cannot cross a percentage or new clause')
  assert.equal(validateCompanyNumericGrounding({markdown:markdown.replace('[filing-2025-003@paragraph:2]',''),sources:[article]}).status,'unsupported_numbers','each amount still requires the corresponding cited source row')
})

test('an explicit shared decrease direction applies across a conjunction-only numeric list', () => {
  const article={...source,content:'汽车毛利率20.49%，同比变化-1.82%；电子毛利率6.29%，同比变化-2.06%。'}
  const markdown='毛利率分别下降1.82和2.06个百分点。[filing-2025-003@paragraph:1]'
  assert.equal(validateCompanyNumericGrounding({markdown,sources:[article]}).status,'grounded')
  assert.equal(validateCompanyNumericGrounding({markdown:markdown.replace('下降','增长'),sources:[article]}).status,'unsupported_numbers')
  assert.equal(validateCompanyNumericGrounding({markdown:markdown.replace('1.82和2.06','1.82%；收入2.06'),sources:[article]}).status,'unsupported_numbers','direction cannot leak past a completed percentage or new clause')
  assert.equal(validateCompanyNumericGrounding({markdown:markdown.replace('下降1.82和2.06','下降1.82而收入2.06'),sources:[article]}).status,'unsupported_numbers','a new metric is not a shared-direction list')
})

test('split research capitalization ratio requires the cited numeric continuation, not only its label', () => {
  const article={...source,content:'资本化研发投入占研发投入\n的比例 1.78% 0.86% 0.92%'}
  assert.equal(validateCompanyNumericGrounding({markdown:'资本化研发投入比例1.78%。[filing-2025-003@paragraph:1]',sources:[article]}).status,'unsupported_numbers')
  assert.equal(validateCompanyNumericGrounding({markdown:'资本化研发投入比例1.78%。[filing-2025-003@paragraph:1] [filing-2025-003@paragraph:2]',sources:[article]}).status,'grounded')
})
