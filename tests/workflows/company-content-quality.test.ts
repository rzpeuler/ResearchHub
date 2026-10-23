import assert from 'node:assert/strict'
import test from 'node:test'
import { validateCompanyResearchMarkdownTables } from '../../workflows/company-deep-research/assembly.ts'
import { COMPANY_CORE_SECTION_IDS, companySynthesisEvidenceFingerprint, ensureCompanyIncompleteSynthesisSections, evaluateCompanyResearchContent, findKnownCompetitorDenials, findKnownCustomerConcentrationDenials, findCustomerConcentrationComparisonContradictions, reconcileCompanyCompetitorEvidence, reconcileCompanyControlOwnerHoldings, reconcileCompanyCrossSectionBoundaries, reconcileCompanyDriverClassificationLabels, reconcileCompanyDriverConsolidatedGrossMargin, reconcileCompanyDriverFinancialReferences, reconcileCompanyEmployeePlanEvidence, reconcileCompanyFinancialGrowthFormula, reconcileCompanyAnnualFinancialCounterevidence, reconcileCompanyFinancialPeriodScope, reconcileCompanyFinancialScopeLimitations, reconcileCompanyFinancialSummaryTable, reconcileCompanyIndustryForecastPeriods, reconcileCompanyIndustryGrowthSpread, reconcileCompanyNumericMovementVerbs, reconcileCompanyNonRecurringDisclosure, reconcileCompanyLeverageFormula, reconcileCompanyAnnualGrossMargin, reconcileCompanyConsolidatedGrossMargin, reconcileCompanyProductCustomerConcentration, reconcileCompanyProductGrowthReferences, reconcileCompanyProductProductionGrowth, reconcileCompanyProductRevenueCostGrowth, reconcileCompanyProductRevenueDrivers, reconcileCompanyUnsupportedProductGrowth, reconcileCompanyProductRevenueRowCitations, reconcileCompanyProductRevenueShares, reconcileCompanyProductTableSectionReferences, reconcileCompanyProductMatrixFromMethod, reconcileCompanyRiskBoundaries, reconcileCompanySegmentRowCitations, reconcileCompanyTechnologyProgressReferences, reconcileCompanyPreparedAnalysisFacts } from '../../workflows/company-deep-research/content-quality.ts'
import type { CompanyResearchMethodResult } from '../../skills/company-research/methods.ts'

test('classification repair restores a uniquely sourced industry label and adds its exact row citation', () => {
  const method:CompanyResearchMethodResult={skillId:'business_driver_analysis',status:'complete',attempts:1,answer:'',markdown:'',sections:[],findings:[],sourceCandidateIds:['annual'],limitations:[],risks:[],diagnostics:[],executionEvidence:[{sourceCandidateId:'annual',title:'2026年半年度报告',publisher:'Issuer',excerpts:[
    {sourceCandidateId:'annual',location:'paragraph:1',text:'单位：元'},
    {sourceCandidateId:'annual',location:'paragraph:2',text:'分行业'},
    {sourceCandidateId:'annual',location:'paragraph:3',text:'行业甲 100.00 80.00'},
    {sourceCandidateId:'annual',location:'paragraph:4',text:'分产品'},
    {sourceCandidateId:'annual',location:'paragraph:5',text:'产品乙 100.00 80.00'},
  ]}]}
  const original='半年报分行业收入表中，行业甲本期收入100元；产品乙收入100元。[annual@paragraph:4] [annual@paragraph:5]'
  const input=[{id:'revenue-profit-drivers',markdown:original,sourceCandidateIds:['annual']}]
  const result=reconcileCompanyDriverClassificationLabels({sections:input,methodResults:[method]})
  assert.match(result[0]!.markdown,/行业甲本期收入100元；行业甲收入100元/)
  assert.match(result[0]!.markdown,/\[annual@paragraph:2\]/)
  assert.match(result[0]!.markdown,/\[annual@paragraph:3\]/)
  assert.equal(reconcileCompanyDriverClassificationLabels({sections:result,methodResults:[method]})[0]!.markdown,result[0]!.markdown)
})

const sections = () => COMPANY_CORE_SECTION_IDS.map((id) => ({ id, markdown: id === 'industry-exposure'
  ? '公司产品对应服务器PCB细分市场，行业预测显示需求增长；但缺少公司可服务市场边界和份额，因此不能据行业总量推算公司TAM。[annual-report@paragraph:1]'
  : id === 'competition'
    ? '与中际旭创相比，公司披露光模块产品路线和客户类型，但没有同口径成本和份额数据，因此无法判断竞争胜负。[annual-report@paragraph:1]'
    : `对 ${id} 的分析：披露事实支持经营机制判断，同时存在执行风险。`, sourceCandidateIds: ['annual-report'] }))
test('domain quality gate rejects cited market and competition gap-only sections', () => {
  const value = sections()
  const market = COMPANY_CORE_SECTION_IDS.indexOf('industry-exposure')
  const competition = COMPANY_CORE_SECTION_IDS.indexOf('competition')
  value[market] = { ...value[market]!, markdown: '市场规模、市场边界和需求增速缺数据，无法判断。[annual-report@paragraph:1]' }
  value[competition] = { ...value[competition]!, markdown: '年报未披露具名竞争对手、份额或可比数据，无法判断竞争位置。[annual-report@paragraph:2]' }
  const result = evaluateCompanyResearchContent({ sections: value, methodResults: [] })
  assert.ok(result.issues.includes('industry-exposure:INSUFFICIENT_MARKET_ANALYSIS'))
  assert.ok(result.issues.includes('competition:INSUFFICIENT_COMPETITIVE_ANALYSIS'))
})
test('domain quality gate allows evidenced market context with a scoped company-TAM limitation', () => {
  const value = sections()
  const market = COMPANY_CORE_SECTION_IDS.indexOf('industry-exposure')
  value[market] = { ...value[market]!, markdown: '公司电子电路产品对应服务器PCB细分市场，官方披露该市场2025年规模与需求预测，显示云计算建设带动行业扩张；但缺少公司可服务市场边界和份额，因此不能据行业总量直接推算公司TAM。[annual-report@paragraph:3]', sourceCandidateIds: ['annual-report'] }
  const result = evaluateCompanyResearchContent({ sections: value, methodResults: [] })
  assert.ok(!result.issues.includes('industry-exposure:INSUFFICIENT_MARKET_ANALYSIS'))
})
test('domain quality gate allows a cited, bounded peer comparison or specific evidence-limited competitor analysis', () => {
  const value = sections()
  const competition = COMPANY_CORE_SECTION_IDS.indexOf('competition')
  value[competition] = { ...value[competition]!, markdown: '与中际旭创相比，公司披露光模块产品路线和客户类型，但没有同口径成本、份额及客户重叠数据，因此只能比较产品与技术方向，不能判断竞争胜负。[annual-report@paragraph:4]', sourceCandidateIds: ['annual-report'] }
  assert.ok(!evaluateCompanyResearchContent({ sections: value, methodResults: [] }).issues.includes('competition:INSUFFICIENT_COMPETITIVE_ANALYSIS'))

  value[competition] = { ...value[competition]!, markdown: '公司披露光模块及电子电路产品路线，材料未提供分业务同口径竞品、价格成本、份额及客户重叠信息，因此竞争位置和利润影响无法判断。[annual-report@paragraph:5]' }
  assert.ok(!evaluateCompanyResearchContent({ sections: value, methodResults: [] }).issues.includes('competition:INSUFFICIENT_COMPETITIVE_ANALYSIS'))
})
test('consolidated gross margin is recalculated from exact statutory income-statement rows', () => {
  const method: CompanyResearchMethodResult = {skillId:'financial_quality_analysis',status:'complete',attempts:1,answer:'毛利率水平上升。',markdown:'结构化合并毛利率由13.59%至20.15%。',sections:[],findings:[],sourceCandidateIds:['akshare'],limitations:[],risks:[],diagnostics:[],deterministicEvidence:[{sourceCandidateId:'official-interim',title:'2026年半年度报告',publisher:'CNINFO',excerpts:[
    {sourceCandidateId:'official-interim',location:'paragraph:2457',text:'单位：元'},
    {sourceCandidateId:'official-interim',location:'paragraph:2458',text:'项目 2026 年半年度 2025 年半年度'},
    {sourceCandidateId:'official-interim',location:'paragraph:2459',text:'一、营业总收入 27,797,683,972.88 16,955,163,898.89'},
    {sourceCandidateId:'official-interim',location:'paragraph:2465',text:'其中：营业成本 22,196,075,162.56 14,650,499,235.90'}
  ]}]}
  const input={sections:[{id:'financial-quality',markdown:'期间对照：毛利率水平上升。\n\n| 毛利率（结构化合并指标，%） | 20.15% | 13.59% | 约上升6.56个百分点 |',sourceCandidateIds:['akshare']}],methodResults:[method]}
  const fixed=reconcileCompanyConsolidatedGrossMargin(input)
  assert.match(fixed[0]!.markdown,/27,797,683,972\.88元−营业成本22,196,075,162\.56元/)
  assert.match(fixed[0]!.markdown,/16,955,163,898\.89元−营业成本14,650,499,235\.90元/)
  assert.match(fixed[0]!.markdown,/20\.15%−13\.59%＝6\.56个百分点/)
  assert.doesNotMatch(fixed[0]!.markdown,/毛利率（结构化合并指标/)
  for(const paragraph of [2457,2458,2459,2465])assert.match(fixed[0]!.markdown,new RegExp(`\\[official-interim@paragraph:${paragraph}\\]`))
  assert.ok(fixed[0]!.sourceCandidateIds?.includes('official-interim'))
})
test('annual consolidated gross margin is reproduced from exact annual statutory rows',()=>{
  const method:CompanyResearchMethodResult={skillId:'financial_quality_analysis',status:'complete',attempts:1,answer:'年度财务对照。',markdown:'',sections:[],findings:[],sourceCandidateIds:['annual'],limitations:[],risks:[],diagnostics:[],deterministicEvidence:[{sourceCandidateId:'official-annual',title:'2025年年度报告',publisher:'CNINFO',excerpts:[
    {sourceCandidateId:'official-annual',location:'paragraph:4613',text:'单位：元'},
    {sourceCandidateId:'official-annual',location:'paragraph:4614',text:'项目 2025 年度 2024 年度'},
    {sourceCandidateId:'official-annual',location:'paragraph:4615',text:'一、营业总收入 40,124,858,839.52 36,770,374,347.58'},
    {sourceCandidateId:'official-annual',location:'paragraph:4620',text:'其中：营业成本 34,472,669,748.77 31,615,008,629.39'}
  ]}]}
  const result=reconcileCompanyAnnualGrossMargin({sections:[{id:'financial-quality',markdown:'年度收入、营业利润、净利润和现金流方向。',sourceCandidateIds:['akshare']}],methodResults:[method]})
  assert.match(result[0]!.markdown,/2024年（营业收入36,770,374,347\.58−营业成本31,615,008,629\.39）÷营业收入36,770,374,347\.58×100%＝14\.02%/)
  assert.match(result[0]!.markdown,/2025年（营业收入40,124,858,839\.52−营业成本34,472,669,748\.77）÷营业收入40,124,858,839\.52×100%＝14\.09%/)
  assert.match(result[0]!.markdown,/14\.09%−14\.02%＝0\.07个百分点/)
  for(const paragraph of [4613,4614,4615,4620])assert.match(result[0]!.markdown,new RegExp(`\\[official-annual@paragraph:${paragraph}\\]`))
})
test('R146 period reconciliation fixes reversed YTD rows and binds annual/segment claims to exact source periods',()=>{
  const financialMarkdown='年度同比对照（2024-12-31至2025-12-31）：净利润（结构化字段；归母属性未注明）下降18.97%。\n\n| 指标 | 2025-06-30上半年累计 | 2026-06-30上半年累计 | 同比 |\n|---|---:|---:|---:|\n| 营业收入（人民币亿元） | 3,712.81 | 3,448.15 | -7.1282% |\n| 营业利润（人民币亿元） | 187.20 | 147.44 | -21.2395% |\n| 结构化净利润（归母属性未注明，人民币亿元） | 155.11 | 123.25 | -20.5352% |\n| 经营现金净流量（人民币亿元） | 318.33 | 373.35 | +17.2814% |\n| 合并毛利率（%） | 18.01% | 18.85% | 约+0.84个百分点 |\n| 净利率（%） | 4.18% | 3.57% | 约-0.60个百分点 |'
  const financial:CompanyResearchMethodResult={skillId:'financial_quality_analysis',status:'complete',attempts:1,answer:'',markdown:'',sections:[{id:'financial-quality',markdown:financialMarkdown}],findings:[],sourceCandidateIds:['akshare-financial-002594'],limitations:[],risks:[],diagnostics:[]}
  const excerpt=(sourceCandidateId:string,location:string,text:string)=>({sourceCandidateId,location:`paragraph:${location}`,text})
  const interim='official-c19c34dd239b2e9c'
  const annual25='official-f7c8d23d2829a5e8'
  const annual24='official-f6274e510499a654'
  const drivers:CompanyResearchMethodResult={skillId:'business_driver_analysis',status:'complete',attempts:1,answer:'',markdown:'',sections:[],findings:[],sourceCandidateIds:[interim,annual25,annual24],limitations:[],risks:[],diagnostics:[],executionEvidence:[
    {sourceCandidateId:interim,title:'2026年半年度报告',publisher:'CNINFO',excerpts:[
      excerpt(interim,'717','营业收入 营业成本 毛利率'),excerpt(interim,'718','营业收入'),excerpt(interim,'719','比上年同'),excerpt(interim,'720','期增减'),excerpt(interim,'721','营业成本'),excerpt(interim,'722','比上年同'),excerpt(interim,'723','期增减'),excerpt(interim,'724','毛利率比'),excerpt(interim,'725','上年同期'),excerpt(interim,'726','增减'),excerpt(interim,'727','分行业'),excerpt(interim,'728','日用电子器件制造业 69,404,994,000.00 65,907,931,000.00 5.04% 0.96% 3.88% -2.67%'),excerpt(interim,'729','交通运输设备及电气制'),excerpt(interim,'730','造业 275,341,358,000.00 213,863,297,000.00 22.33% -8.98% -11.24% 1.98%'),excerpt(interim,'691','营业收入构成'),excerpt(interim,'692','单位：元'),excerpt(interim,'693','本报告期 上年同期'),excerpt(interim,'694','同比增减'),excerpt(interim,'695','金额 占营业收入比重 金额 占营业收入比重'),excerpt(interim,'696','同比增减'),excerpt(interim,'705','分产品'),excerpt(interim,'706','电子及其他产品 69,404,994,000.00 20.13% 68,743,903,000.00 18.51% 0.96%'),excerpt(interim,'707','汽车、汽车相关'),excerpt(interim,'708','产品及其他产品 275,341,358,000.00 79.85% 302,506,271,000.00 81.48% -8.98%')
    ]},
    {sourceCandidateId:annual25,title:'2025年年度报告',publisher:'CNINFO',excerpts:[excerpt(annual25,'833','单位：元'),excerpt(annual25,'834','营业收入 营业成本 毛利率 营业收入比上'),excerpt(annual25,'835','年同期增减'),excerpt(annual25,'836','营业成本比上'),excerpt(annual25,'837','年同期增减'),excerpt(annual25,'838','毛利率比上'),excerpt(annual25,'839','年同期增减'),excerpt(annual25,'845','分产品'),excerpt(annual25,'850','手机部件、组'),excerpt(annual25,'851','装及其他产品 155,236,528,000.00 145,473,989,000.00 6.29% -2.74% -0.56% -2.06%'),excerpt(annual25,'3028','二零二五年，本集团实现收入。'),excerpt(annual25,'3031','归属于上市公司股东的净利润约人民币32,619百万元，同比下降18.97%。')]},
    {sourceCandidateId:annual24,title:'2024年年度报告',publisher:'CNINFO',excerpts:[excerpt(annual24,'710','单位：元'),excerpt(annual24,'711','营业收入 营业成本 毛利率'),excerpt(annual24,'712','营业收入比上年同期增减'),excerpt(annual24,'713','营业成本比上年同期增减'),excerpt(annual24,'714','毛利率比上年同期增减'),excerpt(annual24,'715','金额'),excerpt(annual24,'716','同比增减'),excerpt(annual24,'722','分产品'),excerpt(annual24,'723','手机部件、组'),excerpt(annual24,'724','装及其他产品 159,608,576,000.00 146,289,389,000.00 8.34% 34.60% 35.05% -0.30%')]}
  ]}
  const sections=[
    {id:'financial-quality',markdown:'全年归母比较：2025年全年收入增长3.46%而归母净利润下降18.97%。\n\n| 指标 | 本期 | 上年同期 | 同比 |\n|---|---:|---:|---:|\n| 营业收入（人民币亿元） | 3,712.81 | 3,448.15 | -7.1282% |\n| 营业利润（人民币亿元） | 187.20 | 147.44 | -21.2395% |\n| 结构化净利润（归母属性未注明，人民币亿元） | 155.11 | 123.25 | -20.5352% |\n| 经营现金净流量（人民币亿元） | 318.33 | 373.35 | +17.2814% |\n| 合并毛利率（%） | 18.01% | 18.85% | 约+0.84个百分点 |\n| 净利率（%） | 4.18% | 3.57% | 约-0.60个百分点 |\n\n#### 净利润同比复算'},
    {id:'revenue-profit-drivers',markdown:'### 分行业表的收入、成本与毛利率变化\n\n2026年半年度报告分行业表列示电子行业收入0.96%。 [official-f6274e510499a654@paragraph:717]\n\n### 数量、产能与经营限制\n'},
    {id:'growth-drivers',markdown:'### 已披露经营结构 本期半年度报告分产品表显示收入变化。[official-f6274e510499a654@paragraph:693] 公司披露电子业务收入受到部分产品规格变化影响，零部件收入同比减少；整机组装业务受益于海外大客户，收入同比增长。这提供了电子业务内部产品与客户组合差异的定性解释，但没有给出各自收入贡献或售价变化，不能把大客户订单等同于已确认收入增长的全部来源。\n\n2025年度 手机部件、组装及其他产品营业收入同比下降2.74%，营业成本同比下降0.56%，毛利率变化-2.06%。[official-f7c8d23d2829a5e8@paragraph:851]\n\n2024年度 手机部件、组装及其他产品营业收入同比增长34.60%，营业成本同比增长35.05%，毛利率变化-0.30%。[official-f6274e510499a654@paragraph:724]'}
  ]
  const result=reconcileCompanyFinancialPeriodScope({sections,methodResults:[financial,drivers]})
  const fin=result.find(item=>item.id==='financial-quality')!.markdown
  assert.match(fin,/2026-06-30上半年累计 \| 2025-06-30上半年累计/)
  assert.match(fin,/营业收入（人民币亿元） \| 3,448\.15 \| 3,712\.81/)
  assert.match(fin,/营业利润（人民币亿元） \| 147\.44 \| 187\.20/)
  assert.match(fin,/结构化净利润（归母属性未注明，人民币亿元） \| 123\.25 \| 155\.11/)
  assert.match(fin,/经营现金净流量（人民币亿元） \| 373\.35 \| 318\.33/)
  assert.match(fin,/净利率（%） \| 3\.57% \| 4\.18%/)
  assert.match(fin,/而结构化 netProfit（归属未注明）下降18\.97%/)
  assert.match(fin,/该法定归母指标与本节结构化 netProfit 字段分别列示/)
  assert.match(fin,/法定披露另列2025年度归母净利润：年度报告披露归属于上市公司股东的净利润同比下降18\.97%/)
  assert.match(fin,/\[official-f7c8d23d2829a5e8@paragraph:3031\]/)
  const revenue=result.find(item=>item.id==='revenue-profit-drivers')!.markdown
  assert.match(revenue,/2026年半年度报告\*\*分行业表\*\*（不与分产品表混用）/)
  assert.match(revenue,/\[official-c19c34dd239b2e9c@paragraph:728\]/)
  assert.doesNotMatch(revenue,/\[official-f6274e510499a654@paragraph:717\]/)
  const growth=result.find(item=>item.id==='growth-drivers')!.markdown
  assert.match(growth,/2026年半年度报告\*\*分产品表\*\*/)
  assert.match(growth,/\[official-c19c34dd239b2e9c@paragraph:706\]/)
  assert.doesNotMatch(growth,/\[official-f6274e510499a654@paragraph:693\]/)
  assert.match(growth,/2025年度（2025年年度报告分产品表）/)
  assert.match(growth,/\[official-f7c8d23d2829a5e8@paragraph:851\]/)
  assert.match(growth,/2024年度（2024年年度报告分产品表）/)
  assert.match(growth,/\[official-f6274e510499a654@paragraph:724\]/)
})
test('period reconciler uses replacement source ids, report years, and financial values without company constants',()=>{
  const structured='structured-financial-X9'
  const interim='filing-interim-X9'
  const annual='filing-annual-X9'
  const financial:CompanyResearchMethodResult={skillId:'financial_quality_analysis',status:'complete',attempts:1,answer:'',markdown:'',sections:[{id:'financial-quality',markdown:'2022-12-31至2023-12-31年度对照：净利润（结构化字段；归属未注明）下降7.5%。\n\n| 指标 | 2024-06-30上半年累计 | 2025-06-30上半年累计 | 同比 |\n|---|---:|---:|---:|\n| 营业收入（人民币亿元） | 222.00 | 187.00 | -15.7658% |\n| 营业利润（人民币亿元） | 28.00 | 24.00 | -14.2857% |\n| 结构化净利润（归母属性未注明，人民币亿元） | 20.00 | 18.00 | -10.0000% |'}],findings:[],sourceCandidateIds:[structured],limitations:[],risks:[],diagnostics:[],deterministicEvidence:[{sourceCandidateId:structured,title:'结构化财务序列',publisher:'Data service',excerpts:[{sourceCandidateId:structured,location:'paragraph:1',text:'period rows'}]}]}
  const para=(sourceCandidateId:string,n:number,text:string)=>({sourceCandidateId,location:`paragraph:${n}`,text})
  const evidence:CompanyResearchMethodResult={skillId:'business_driver_analysis',status:'complete',attempts:1,answer:'',markdown:'',sections:[],findings:[],sourceCandidateIds:[interim,annual],limitations:[],risks:[],diagnostics:[],executionEvidence:[
    {sourceCandidateId:interim,title:'2025年半年度报告',publisher:'Public company filing',excerpts:[
      para(interim,20,'营业收入 营业成本 毛利率'),para(interim,21,'营业收入比上年同期增减'),para(interim,22,'营业成本比上年同期增减'),para(interim,23,'毛利率比上年同期增减'),para(interim,24,'分行业'),para(interim,25,'精密电子设备业 12,345,000.00 9,876,000.00 20.00% 6.50% 2.50% 1.25%'),para(interim,26,'光电显示器件业 5,432,100.00 4,321,000.00 20.45% 3.25% 2.15% 0.75%'),
      para(interim,30,'本报告期 上年同期'),para(interim,31,'营业收入金额 占营业收入比重 金额 占营业收入比重 同比增减'),para(interim,32,'分产品'),para(interim,33,'模块产品 9,000,000.00 10.00% 8,000,000.00 9.00% 12.50%'),para(interim,34,'传感器产品 3,000,000.00 5.00% 2,500,000.00 4.00% 20.00%')
    ]},
    {sourceCandidateId:annual,title:'2023年年度报告',publisher:'Public company filing',excerpts:[
      para(annual,40,'归属于上市公司股东的净利润为9,876万元，同比下降7.5%。'),para(annual,50,'单位：元'),para(annual,51,'营业收入 营业成本 毛利率 营业收入比上年同期增减'),para(annual,52,'营业成本比上年同期增减'),para(annual,53,'毛利率比上年同期增减'),para(annual,54,'分产品'),para(annual,55,'模块产品 7,654,000.00 6,000,000.00 21.60% 8.50% 7.50% 0.80%')
    ]}
  ]}
  const sections=[
    {id:'financial-quality',markdown:'2023年营业收入增长而归母净利润下降7.5%。\n\n| 指标 | 本期 | 上年同期 | 同比 |\n|---|---:|---:|---:|\n| 营业收入（人民币亿元） | 222.00 | 187.00 | -15.7658% |\n| 营业利润（人民币亿元） | 28.00 | 24.00 | -14.2857% |\n| 结构化净利润（归母属性未注明，人民币亿元） | 20.00 | 18.00 | -10.0000% |\n\n#### 净利润同比复算'},
    {id:'revenue-profit-drivers',markdown:'### 分行业表的收入、成本与毛利率变化\n2025年半年报分产品表有其他数据。[filing-annual-X9@paragraph:99]\n\n### 后续分析\n保留本段。'},
    {id:'growth-drivers',markdown:'### 已披露经营结构 半年报分产品表显示模块收入、销量、价格情况。[filing-annual-X9@paragraph:98]\n\n2023年度模块产品收入同比增长8.50%，成本同比增长7.50%。[filing-annual-X9@paragraph:55]'}
  ]
  const fixed=reconcileCompanyFinancialPeriodScope({sections,methodResults:[financial,evidence]})
  const fin=fixed.find(section=>section.id==='financial-quality')!.markdown
  assert.match(fin,/2025-06-30上半年累计 \| 2024-06-30上半年累计/)
  assert.match(fin,/营业收入（人民币亿元） \| 187\.00 \| 222\.00/)
  assert.match(fin,/结构化 netProfit（归属未注明）下降7\.5%/)
  assert.match(fin,/法定披露另列2023年度归母净利润/)
  assert.match(fin,/\[filing-annual-X9@paragraph:40\]/)
  const revenue=fixed.find(section=>section.id==='revenue-profit-drivers')!.markdown
  assert.match(revenue,/2025年半年度报告\*\*分行业表\*\*/)
  assert.match(revenue,/精密电子设备业：营业收入同比6\.50%，营业成本同比2\.50%，毛利率20\.00%，毛利率变化列同比增减1\.25%。/)
  assert.match(revenue,/光电显示器件业：营业收入同比3\.25%，营业成本同比2\.15%，毛利率20\.45%，毛利率变化列同比增减0\.75%。/)
  assert.match(revenue,/\[filing-interim-X9@paragraph:25\]/)
  assert.match(revenue,/\[filing-interim-X9@paragraph:26\]/)
  assert.doesNotMatch(revenue,/\[filing-annual-X9@paragraph:99\]/)
  const growth=fixed.find(section=>section.id==='growth-drivers')!.markdown
  assert.match(growth,/2025年半年度报告\*\*分产品表\*\*/)
  assert.match(growth,/模块产品营业收入同比12\.50%/)
  assert.match(growth,/传感器产品营业收入同比20\.00%/)
  assert.match(growth,/\[filing-interim-X9@paragraph:33\]/)
  assert.match(growth,/2023年度（2023年年度报告分产品表）/)
  assert.match(growth,/\[filing-annual-X9@paragraph:55\]/)
  assert.doesNotMatch(growth,/\[filing-annual-X9@paragraph:98\]/)
})
test('period reconciler leaves segment synthesis untouched when the located table is incomplete or conflicting',()=>{
  const id='public-filing-Q2'
  const section={id:'revenue-profit-drivers',markdown:'### 分行业表的收入、成本与毛利率变化\n\n2024年半年度报告分产品表的相关结论。[older-filing@paragraph:8]\n\n### 其他分析\n保留。'}
  const makeMethod=(secondRow?:string,conflict=false):CompanyResearchMethodResult=>({skillId:'business_driver_analysis',status:'complete',attempts:1,answer:'',markdown:'',sections:[],findings:[],sourceCandidateIds:[id],limitations:[],risks:[],diagnostics:[],executionEvidence:[{sourceCandidateId:id,title:'2025年半年度报告',publisher:'Public filing',excerpts:[
    {sourceCandidateId:id,location:'paragraph:10',text:'营业收入 营业成本 毛利率'},
    {sourceCandidateId:id,location:'paragraph:11',text:'营业收入比上年同期增减'},
    {sourceCandidateId:id,location:'paragraph:12',text:'营业成本比上年同期增减'},
    {sourceCandidateId:id,location:'paragraph:13',text:'毛利率比上年同期增减'},
    {sourceCandidateId:id,location:'paragraph:14',text:'分行业'},
    {sourceCandidateId:id,location:'paragraph:15',text:'精密制造业 100.00 80.00 20.00% 10.00% 8.00% 1.00%'},
    ...(secondRow?[{sourceCandidateId:id,location:'paragraph:16',text:secondRow}]:[]),
    ...(conflict?[{sourceCandidateId:id,location:'paragraph:15',text:'精密制造业 100.00 70.00 30.00% 10.00% 8.00% 1.00%'}]:[])
  ]}]})
  const incomplete=reconcileCompanyFinancialPeriodScope({sections:[section],methodResults:[makeMethod()]})
  assert.equal(incomplete[0]!.markdown,section.markdown)
  const conflicting=reconcileCompanyFinancialPeriodScope({sections:[section],methodResults:[makeMethod('电子组件业 50.00 40.00 20.00% 5.00% 4.00% 0.50%',true)]})
  assert.equal(conflicting[0]!.markdown,section.markdown)
})
test('driver comparison links to the completed financial table and keeps industry margin separate',()=>{
  const method:CompanyResearchMethodResult={skillId:'financial_quality_analysis',status:'complete',attempts:1,answer:'财务。',markdown:'',sections:[],findings:[],sourceCandidateIds:['official-interim'],limitations:[],risks:[],diagnostics:[],deterministicEvidence:[{sourceCandidateId:'official-interim',title:'2026年半年度报告',publisher:'CNINFO',excerpts:[
    {sourceCandidateId:'official-interim',location:'paragraph:2457',text:'单位：元'},
    {sourceCandidateId:'official-interim',location:'paragraph:2458',text:'项目 2026 年半年度 2025 年半年度'},
    {sourceCandidateId:'official-interim',location:'paragraph:2459',text:'一、营业总收入 27,797,683,972.88 16,955,163,898.89'},
    {sourceCandidateId:'official-interim',location:'paragraph:2465',text:'其中：营业成本 22,196,075,162.56 14,650,499,235.90'}
  ]}]}
  const sections=[
    {id:'revenue-profit-drivers',markdown:'财务摘要见下表 | 指标（口径） | 2026年上半年累计/期末 | 2025年上半年累计/期末 | 结构化同比'},
    {id:'growth-drivers',markdown:'分行业毛利率6.48%。该观察与综合毛利改善方向一致。'},
    {id:'financial-quality',markdown:'| 营业收入（累计） | 277.98 | 169.55 | +63.95% |\n|---|---:|---:|---:|'}
  ]
  const fixed=reconcileCompanyDriverFinancialReferences({sections,methodResults:[method]})
  assert.doesNotMatch(fixed[0]!.markdown,/指标（口径）/)
  assert.match(fixed[0]!.markdown,/操作数及复算结果列于“财务质量”章节/)
  assert.match(fixed[1]!.markdown,/该分行业指标仅说明行业自身变化/)
  assert.doesNotMatch(fixed[1]!.markdown,/与综合毛利改善方向一致/)
  for(const paragraph of [2457,2458,2459,2465])assert.match(fixed[1]!.markdown,new RegExp(`\\[official-interim@paragraph:${paragraph}\\]`))
})

test('growth-driver reconciliation adds source-matched consolidated counterevidence and exact same-period formulas', () => {
  const source = 'akshare-financial-test'
  const values = [
    { period: '2026-06-30', metrics: { revenue: 344815421000, operatingProfit: 14743578000, netProfit: 12325408000, operatingCashFlow: 37334744000, grossMargin: 18.8473478975 }, metricMetadata: Object.fromEntries(['revenue','operatingProfit','netProfit','operatingCashFlow'].map(metric => [metric, { unit: 'CNY', currency: 'CNY', basis: 'YTD' }]).concat([['grossMargin', { unit: 'percent', currency: 'CNY', basis: 'YTD' }]])) },
    { period: '2025-06-30', metrics: { revenue: 371280948000, operatingProfit: 18719509000, netProfit: 15510533000, operatingCashFlow: 31833471000, grossMargin: 18.01 }, metricMetadata: Object.fromEntries(['revenue','operatingProfit','netProfit','operatingCashFlow'].map(metric => [metric, { unit: 'CNY', currency: 'CNY', basis: 'YTD' }]).concat([['grossMargin', { unit: 'percent', currency: 'CNY', basis: 'YTD' }]])) },
  ]
  const preparedAnalysis = { financial: { table: values.map(row => ({ ...row, period: row.period, metadata: row.metricMetadata })) } }
  const packet = { sourceCandidateId: source, title: '2026年半年度报告', excerpts: [{ sourceCandidateId: source, location: 'paragraph:1', text: JSON.stringify({ kind: 'financial', rows: values.map(row => ({ periodEnd: row.period, metrics: row.metrics, metricMetadata: row.metricMetadata })) }) }] }
  const method = { skillId: 'financial_quality_analysis', status: 'complete', executionEvidence: [packet] } as unknown as CompanyResearchMethodResult
  const inputSections = [{ id: 'revenue-profit-drivers', markdown: '利润桥尚未完全归因。' }, { id: 'growth-drivers', markdown: '分行业和分产品走势有差异；需与合并财务结果并列分析。' }]
  const result = reconcileCompanyDriverConsolidatedGrossMargin({ sections: inputSections, methodResults: [method], preparedAnalysis })
  const growth = result.find(section => section.id === 'growth-drivers')!.markdown
  assert.match(growth, /合并财务反证（半年累计，同期对同期）/)
  assert.match(growth, /收入3712\.80948亿元降至3448\.15421亿元/)
  assert.match(growth, /营业利润187\.19509亿元降至147\.43578亿元/)
  assert.match(growth, /结构化净利润字段（归属口径未注明）155\.10533亿元降至123\.25408亿元/)
  assert.match(growth, /经营现金净流量318\.33471亿元升至373\.34744亿元/)
  assert.match(growth, /合并毛利率由18\.01%升至18\.85%（\+0\.84个百分点）/)
  assert.match(growth, /净利率按净利润÷收入复算由4\.18%降至3\.57%（−0\.60个百分点）/)
  assert.ok(growth.includes(`[${source}@paragraph:1]`))
  assert.equal(reconcileCompanyDriverConsolidatedGrossMargin({ sections: result, methodResults: [method], preparedAnalysis })[1]!.markdown, growth, 'repeated reconciliation is idempotent')

  const conflict = { ...preparedAnalysis, financial: { table: preparedAnalysis.financial.table.map(row => row.period === '2026-06-30' ? { ...row, conflicts: [{ metric: 'netProfit' }] } : row) } }
  const withheld = reconcileCompanyDriverConsolidatedGrossMargin({ sections: inputSections, methodResults: [method], preparedAnalysis: conflict })
  assert.equal(withheld.find(section => section.id === 'growth-drivers')!.markdown, inputSections[1]!.markdown, 'conflicting structured inputs fail closed')
})
test('final financial table replaces the separated semantic header with a complete deterministic table',()=>{
  const sections=[{id:'financial-quality',markdown:'财务质量开篇。\n\n| 指标（口径） | 2026年上半年累计/期末 | 2025年上半年累计/期末 | 结构化同比\n\n同口径结论。\n|---|---:|---:|\n| 营业收入 | 277.98 | 169.55 | +63.95% |'}]
  const table='确定性财务摘要（人民币亿元）。[akshare@paragraph:1]\n\n| 指标 | 2026-06-30 | 2025-06-30 |\n|---|---:|---:|\n| 营业收入 | 277.98 | 169.55 |'
  const fixed=reconcileCompanyFinancialSummaryTable({sections,markdown:table})
  assert.doesNotMatch(fixed[0]!.markdown,/指标（口径）/)
  assert.match(fixed[0]!.markdown,/同口径结论/)
  assert.match(fixed[0]!.markdown,/\| 指标 \| 2026-06-30 \| 2025-06-30 \|\n\|---\|---:\|---:\|/)
  assert.equal(fixed[0]!.markdown.match(/确定性财务摘要/g)?.length,1)
})
test('final financial table removes an empty date-header placeholder and preserves populated tables',()=>{
  const orphan='| 指标 | 2025-06-30 | 2026-06-30 | 同期变化 |\n|---|---:|---:|---:|'
  const legitimate='| 指标 | 2025-06-30 | 2026-06-30 | 同期变化 |\n|---|---:|---:|---:|\n| 经营现金流 | 25.00 | 23.84 | -4.65% |'
  const sections=[{id:'financial-quality',markdown:`财务质量开篇。\n\n${orphan}\n\n现金流反向，需结合利润与资本开支复核。\n\n${legitimate}`}]
  const table='确定性财务摘要（人民币亿元）。[akshare@paragraph:1]\n\n| 指标 | 2026-06-30 | 2025-06-30 |\n|---|---:|---:|\n| 营业收入 | 277.98 | 169.55 |'
  const fixed=reconcileCompanyFinancialSummaryTable({sections,markdown:table})
  assert.equal(fixed[0]!.markdown.match(/\| 指标 \| 2025-06-30 \| 2026-06-30 \| 同期变化 \|/g)?.length,1)
  assert.ok(fixed[0]!.markdown.includes(legitimate))
  assert.match(fixed[0]!.markdown,/\| 营业收入 \| 277\.98 \| 169\.55 \|/)
  assert.equal(fixed[0]!.markdown.match(/确定性财务摘要/g)?.length,1)
})

test('driver chapter replaces an empty comparative placeholder with sourced consolidated movement rows', () => {
  const driver = { id: 'revenue-profit-drivers', markdown: '## 收入与利润驱动\n\n## 可比期间主要方向 | 指标 | 2025-06-30累计 | 2026-06-30累计 | 同比变化 |\n\n后续需要联系分产品表现解释方向。' }
  const finance = { id: 'financial-quality', markdown: '财务分析。' }
  const comparison = `同期口径复核（人民币亿元）。[akshare-financial-002384@paragraph:1]\n\n| 指标与口径 | 上年同期 | 本期 | 同比公式及变化 |\n|---|---:|---:|---|\n| 营业收入（年初至期末累计） | 169.55 | 277.98 | 63.95% |\n| 营业利润（年初至期末累计） | 15.00 | 28.00 | 86.67% |\n| 净利润（结构化字段；归母属性未注明）（年初至期末累计） | 5.60 | 8.00 | 42.86% |\n| 经营现金净流量（年初至期末累计） | 20.89 | 23.84 | 14.12% |\n| 购建长期资产现金支出（年初至期末累计） | 16.44 | 52.53 | 219.52% |`
  const fixed = reconcileCompanyFinancialSummaryTable({ sections: [driver, finance], markdown: comparison })
  const result = fixed.find(section => section.id === 'revenue-profit-drivers')!.markdown
  assert.match(result, /\| 营业收入（年初至期末累计） \| 169\.55 \| 277\.98 \| 63\.95% \[akshare-financial-002384@paragraph:1\] \|/)
  assert.match(result, /\| 营业利润（年初至期末累计）/)
  assert.match(result, /\| 经营现金净流量（年初至期末累计）/)
  assert.doesNotMatch(result, /购建长期资产现金支出（年初至期末累计）/)
  assert.match(result, /后续需要联系分产品表现解释方向/)
  const again = reconcileCompanyFinancialSummaryTable({ sections: fixed, markdown: comparison })
  assert.equal(again.find(section => section.id === 'revenue-profit-drivers')!.markdown.match(/结构化合并财务同期间对照/g)?.length, 1)
})
test('financial summary drops a conflicting dated header when the complete deterministic table follows',()=>{
  const sections=[{id:'financial-quality',markdown:'## 趋势\n| 指标 | 2026-06-30本期 | 2025-06-30上年同期 | 同比 |\n| 指标与口径 | 2025年上半年累计 | 2026年上半年累计 | 同比变化 |\n|---|---:|---:|---:|\n| 合并毛利率 | 18.01% | 18.85% | +0.84个百分点 |'}]
  const fixed=reconcileCompanyFinancialSummaryTable({sections,markdown:'确定性财务摘要。'})[0]!
  assert.doesNotMatch(fixed.markdown,/2026-06-30本期/)
  assert.match(fixed.markdown,/\| 指标与口径 \| 2025年上半年累计 \| 2026年上半年累计 \| 同比变化 \|/)
  assert.match(fixed.markdown,/\| 合并毛利率 \| 18\.01% \| 18\.85% \| \+0\.84个百分点 \|/)
})
test('financial reconciliation restores labels on an orphan comparison-table separator',()=>{
  const sections=[{id:'financial-quality',markdown:'### 可比期间对照\n营业收入比较。\n|---|---:|---:|---|\n| 营业收入 | 277.98 | 169.55 | 增长63.95% |'}]
  const fixed=reconcileCompanyFinancialSummaryTable({sections,markdown:'确定性财务摘要（人民币亿元）。\n\n| 指标 | 本期 | 上年同期 |\n|---|---:|---:|\n| 营业收入 | 277.98 | 169.55 |'})
  assert.match(fixed[0]!.markdown,/\| 指标 \| 本期 \| 上年同期 \| 同比 \|\n\|---\|---:\|---:\|---\|\n\| 营业收入 \| 277\.98 \| 169\.55 \| 增长63\.95% \|/)
})
test('content gate rejects missing core research even with admissible evidence', () => { const result = evaluateCompanyResearchContent({ sections: sections().slice(1) }); assert.equal(result.passed, false); assert.ok(result.issues.includes('company-overview:MISSING_SECTION')) })
test('localized evidence gaps inside a substantive section do not erase completed research', () => {
  const value = sections()
  const index = COMPANY_CORE_SECTION_IDS.indexOf('management-capital-allocation')
  value[index] = { ...value[index]!, markdown: '## 管理与资本配置\n已分析研发、融资和分红安排。现有材料无可用证据证明项目级资本回报，因此价值创造仍不确定。' }
  assert.equal(evaluateCompanyResearchContent({ sections: value }).passed, true)
  value[index] = { ...value[index]!, markdown: '## 管理与资本配置\n研究缺口：未获取到管理层及资本配置资料。' }
  assert.ok(evaluateCompanyResearchContent({ sections: value }).issues.includes('management-capital-allocation:RESEARCH_GAP'))
})
test('fallback cannot pass through content gate', () => { assert.equal(evaluateCompanyResearchContent({ sections: sections(), synthesisMode: 'deterministic_fallback' }).passed, false) })
test('observations duplicated as financial analysis fail independently of citations', () => { const value = sections(); value[9] = { ...value[9]!, markdown: 'Retrieved structured financial observations (provider-reported values): revenue 10' }; assert.ok(evaluateCompanyResearchContent({ sections: value }).issues.includes('financial-quality:OBSERVATIONS_WITHOUT_ANALYSIS')) })
test('content gate rejects a currency unit asserted in the same sentence as an explicit unknown-unit caveat', () => {
  const value = sections()
  const index = COMPANY_CORE_SECTION_IDS.indexOf('risks')
  value[index] = { ...value[index]!, markdown: '商誉原值63,399元；单位行未提供，金额单位无法核实。' }
  assert.ok(evaluateCompanyResearchContent({ sections: value }).issues.includes('risks:UNVERIFIED_CURRENCY_UNIT_ASSERTED'))
  value[index] = { ...value[index]!, markdown: '商誉原值63,399；单位行未提供，金额单位无法核实。' }
  assert.ok(!evaluateCompanyResearchContent({ sections: value }).issues.includes('risks:UNVERIFIED_CURRENCY_UNIT_ASSERTED'))
})
test('optional valuation gaps do not block core completion', () => { assert.equal(evaluateCompanyResearchContent({ sections: [...sections(), { id: 'valuation', markdown: '研究缺口：无法获取估值基础', sourceCandidateIds: [] }] }).passed, true) })
test('broad executive-division gap is rejected when the report already states executive roles, while a specific new-hire gap is retained', () => {
  const value = sections()
  const management = COMPANY_CORE_SECTION_IDS.indexOf('management-capital-allocation')
  const thesis = COMPANY_CORE_SECTION_IDS.indexOf('investment-thesis')
  value[management] = { ...value[management]!, markdown: '年报披露董事长兼总裁负责公司营运和策略；另披露两名新任副总裁，但未说明其具体分工。' }
  value[thesis] = { ...value[thesis]!, markdown: '由于缺少完整管理层分工，本结论不能评价管理能力。' }
  assert.ok(evaluateCompanyResearchContent({ sections: value }).issues.includes('investment-thesis:UNSCOPED_MANAGEMENT_ROLE_GAP'))
  value[thesis] = { ...value[thesis]!, markdown: '董事长负责公司营运和策略已有披露；缺口仅为两名新任副总裁的具体职责、履职记录及绩效。' }
  assert.ok(!evaluateCompanyResearchContent({ sections: value }).issues.includes('investment-thesis:UNSCOPED_MANAGEMENT_ROLE_GAP'))
})

test('R102 governance wording rejects a blanket role-gap characterization without claiming that gap', () => {
  const value = sections()
  const management = COMPANY_CORE_SECTION_IDS.indexOf('management-capital-allocation')
  const thesis = COMPANY_CORE_SECTION_IDS.indexOf('investment-thesis')
  value[management] = { ...value[management]!, markdown: '年报披露董事长兼总裁负责公司营运和策略。' }
  const rejectedCharacterization = '治理风险应具体关注权责集中、监督执行和接续安排，而非笼统称管理层职责缺失'
  value[thesis] = { ...value[thesis]!, markdown: rejectedCharacterization }
  assert.equal(evaluateCompanyResearchContent({ sections: value }).passed, true)

  for (const markdown of [
    '由于缺少完整管理层分工，本结论不能评价管理能力。',
    `${rejectedCharacterization}；但由于缺少完整管理层分工，本结论不能评价管理能力。`,
    `由于缺少完整管理层分工，本结论不能评价管理能力；${rejectedCharacterization}。`,
    '治理风险应具体关注权责集中、监督执行和接续安排，但管理层职责缺失。',
  ]) {
    value[thesis] = { ...value[thesis]!, markdown }
    assert.ok(evaluateCompanyResearchContent({ sections: value }).issues.includes('investment-thesis:UNSCOPED_MANAGEMENT_ROLE_GAP'), markdown)
  }
})
test('R108 specifically scoped new-executive disclosure gap is not mistaken for a blanket management-role gap', () => {
  const value = sections()
  const management = COMPANY_CORE_SECTION_IDS.indexOf('management-capital-allocation')
  const thesis = COMPANY_CORE_SECTION_IDS.indexOf('investment-thesis')
  value[management] = { ...value[management]!, markdown: '公司披露王传福任董事长、执行董事兼总裁并负责一般营运及业务策略；另披露新任副总裁，但未说明其具体分工。' }
  value[thesis] = { ...value[thesis]!, markdown: '新任副总裁的具体履历、职责分工和任职后绩效未见，属于有限的具体披露缺项，不应泛称管理层分工缺失。' }
  assert.ok(!evaluateCompanyResearchContent({ sections: value }).issues.includes('investment-thesis:UNSCOPED_MANAGEMENT_ROLE_GAP'))

  value[thesis] = { ...value[thesis]!, markdown: '新任副总裁的具体履历未见，不应泛称管理层分工缺失；由于缺少完整管理层分工，本结论不能评价管理能力。' }
  assert.ok(evaluateCompanyResearchContent({ sections: value }).issues.includes('investment-thesis:UNSCOPED_MANAGEMENT_ROLE_GAP'))
})
test('cross-method check rejects blanket competitor absence after a named candidate was established', () => {
  const competitor: CompanyResearchMethodResult = { skillId: 'competitive_market_map', status: 'complete', attempts: 1, answer: '吉利是有材料支持的具名竞争者；同口径价格和份额缺少。', markdown: '竞争比较已识别吉利。', sections: [{ id: 'competition', markdown: '吉利是具名候选竞争者。' }], findings: [{ text: '吉利是有材料支持的具名竞争者。', kind: 'fact', evidence: [{ sourceCandidateId: 'annual-report', location: 'paragraph:1' }] }], sourceCandidateIds: ['annual-report'], limitations: [], risks: [], diagnostics: [] }
  const value = sections()
  const risk = COMPANY_CORE_SECTION_IDS.indexOf('risks')
  value[risk] = { ...value[risk]!, markdown: '竞争风险：没有具名竞品、产品路线或可比经营指标，无法判断竞争位势。' }
  assert.deepEqual(findKnownCompetitorDenials({ sections: value, methodResults: [competitor] }), [{ sectionId: 'risks', candidate: '吉利' }])
  value[risk] = { ...value[risk]!, markdown: '竞争风险：吉利是已识别的候选对手；缺少同口径价格、成本和份额，无法判断竞争位势。' }
  assert.deepEqual(findKnownCompetitorDenials({ sections: value, methodResults: [competitor] }), [])
  value[risk] = { ...value[risk]!, markdown: '汽车业务的主要风险仍包括价格竞争。' }
  assert.deepEqual(findKnownCompetitorDenials({ sections: value, methodResults: [{ ...competitor, answer: '需要按客户场景比较产品路线。' }] }), [])
  value[risk] = { ...value[risk]!, markdown: '风险矩阵称无具名竞品、市场份额、路线或可比性能证据。' }
  assert.deepEqual(findKnownCompetitorDenials({ sections: value, methodResults: [competitor] }), [{ sectionId: 'risks', candidate: '吉利' }])
})

test('cross-method competitor detection strips Chinese narrative connectives and allows a scoped comparable-data gap', () => {
  const competitor: CompanyResearchMethodResult = { skillId: 'competitive_market_map', status: 'complete', attempts: 1, answer: '因此中际旭创是候选对手。', markdown: '因此中际旭创是候选对手。', sections: [], findings: [], sourceCandidateIds: [], limitations: [], risks: [], diagnostics: [] }
  const denial = [{ id: 'business-model', markdown: '公司未披露价格条款，也缺少具名竞争者的可比资料，因此不能判断议价优势。' }]
  assert.deepEqual(findKnownCompetitorDenials({ sections: denial, methodResults: [competitor] }), [])
  assert.deepEqual(findKnownCompetitorDenials({ sections: [{ id: 'competition', markdown: '本节没有具名竞品，无法判断竞争位势。' }], methodResults: [competitor] }), [{ sectionId: 'competition', candidate: '中际旭创' }])
})

test('product and technology chapters carry an exact cited cross-method candidate while retaining scoped comparison gaps', () => {
  const candidate: CompanyResearchMethodResult = {
    skillId: 'competitive_market_map', status: 'complete', attempts: 1,
    answer: '中际旭创是有材料支持的具名竞争者；同口径经营比较有限。',
    markdown: '竞争方法识别中际旭创。', sections: [{ id: 'competition', markdown: '中际旭创是有材料支持的具名竞争者。[public-web-peer-report@paragraph:3]' }],
    findings: [{ text: '中际旭创是有材料支持的具名竞争者，其公开高速光模块产品路线。', kind: 'fact', evidence: [{ sourceCandidateId: 'public-web-peer-report', location: 'paragraph:3' }] }],
    sourceCandidateIds: ['public-web-peer-report'], limitations: [], risks: [], diagnostics: [],
    executionEvidence: [{ sourceCandidateId: 'public-web-peer-report', title: '竞品产品资料', publisher: '公开资料', excerpts: [{ sourceCandidateId: 'public-web-peer-report', location: 'paragraph:3', text: '中际旭创公开高速光模块产品路线。' }] }],
  }
  const sections = [
    { id: 'products', markdown: '本节产品资料未提供具名竞品的同口径比较，无法判断相对性能。[annual@paragraph:1]', sourceCandidateIds: ['annual'] },
    { id: 'technologies', markdown: '现有技术证据未提供具名竞品同口径比较，技术领先性仍待验证。[annual@paragraph:2]', sourceCandidateIds: ['annual'] },
  ]
  const reconciled = reconcileCompanyCompetitorEvidence({ sections, methodResults: [candidate] })
  assert.equal(reconciled.length, 2)
  for (const section of reconciled) {
    assert.match(section.markdown, /中际旭创是有材料支持的具名竞争者/)
    assert.match(section.markdown, /直接竞标、客户重叠及与公司产品同口径/)
    assert.match(section.markdown, /\[public-web-peer-report@paragraph:3\]/)
    assert.ok(section.sourceCandidateIds?.includes('public-web-peer-report'))
  }
})

test('CATL route carryover cites the separate passenger-car solution heading without overstating the product text',()=>{
  const candidate:CompanyResearchMethodResult={
    skillId:'competitive_market_map',status:'complete',attempts:1,answer:'CATL是动力电池场景候选。',markdown:'CATL路线候选。',sections:[],
    findings:[{text:'宁德时代官网明确涉及乘用车动力电池，并宣传超快充、长寿命和高比能，构成动力电池场景的具名候选对照；现有材料不足以验证同一采购决策或完全可比性。',kind:'inference',evidence:[{sourceCandidateId:'public-web-catl',location:'paragraph:249'}]}],
    sourceCandidateIds:['public-web-catl'],limitations:[],risks:[],diagnostics:[],
    executionEvidence:[{sourceCandidateId:'public-web-catl',title:'宁德时代·CATL',publisher:'宁德时代',excerpts:[
      {sourceCandidateId:'public-web-catl',location:'paragraph:35',text:'乘用车'},
      {sourceCandidateId:'public-web-catl',location:'paragraph:249',text:'宁德时代引领电动出行科技潮流，致力于为电动汽车提供可靠动力，凭借超快充、长寿命、高比能等先进技术。'}
    ]}]
  }
  const result=reconcileCompanyCompetitorEvidence({sections:[{id:'company-overview',markdown:'战略候选：宁德时代官网明确涉及乘用车动力电池，并宣传超快充、长寿命和高比能，构成动力电池场景的具名候选对照；现有材料不足以验证同一采购决策或完全可比性。[public-web-catl@paragraph:249]'}],methodResults:[candidate]})[0]!
  assert.match(result.markdown,/将“乘用车”列为单独解决方案入口/)
  assert.match(result.markdown,/该页面未将这些性能表述单独限定于乘用车/)
  assert.match(result.markdown,/\[public-web-catl@paragraph:35\]/)
  assert.doesNotMatch(result.markdown,/官网明确涉及乘用车动力电池/)
})

test('competitor reconciliation recognizes attributed candidate wording and repairs product, technology, and industry context', () => {
  const candidate: CompanyResearchMethodResult = {
    skillId:'competitive_market_map',status:'complete',attempts:1,answer:'双方具名候选竞争者仍需核实采购重叠。',markdown:'中际旭创披露高速光互连产品，故将其视为具名候选竞争者。',
    sections:[{id:'competition',markdown:'双方存在具名候选竞争者。'}],findings:[{text:'中际旭创披露云计算及AI高速光互连产品路线，是具名候选竞争者；客户重叠未证实。',kind:'fact',evidence:[{sourceCandidateId:'public-web-peer',location:'paragraph:26'}]}],sourceCandidateIds:['public-web-peer'],limitations:[],risks:[],diagnostics:[],
    executionEvidence:[{sourceCandidateId:'public-web-peer',title:'竞品产品资料',publisher:'公开资料',excerpts:[{sourceCandidateId:'public-web-peer',location:'paragraph:26',text:'中际旭创披露高速光互连产品路线。'}]}],
  }
  const sections=[
    {id:'products',markdown:'未有客户需求调研/反馈验证，不能据此推断客户偏好。',sourceCandidateIds:['annual']},
    {id:'technologies',markdown:'本节产品/技术资料未提供具名竞品的同口径比较；不能确认直接竞争。',sourceCandidateIds:['annual']},
    {id:'industry-exposure',markdown:'缺少可比公司或具体竞品产品、路线、客户覆盖和市占数据，无法作具名竞争对比。',sourceCandidateIds:['annual']},
  ]
  const result=reconcileCompanyCompetitorEvidence({sections,methodResults:[candidate]})
  for(const section of result){assert.match(section.markdown,/中际旭创披露云计算及AI高速光互连产品路线/);assert.match(section.markdown,/实际客户重叠|客户重叠未证实/);assert.match(section.markdown,/\[public-web-peer@paragraph:26\]/)}
  assert.match(result.find(section=>section.id==='products')!.markdown,/不能据此推断客户偏好/)
})

test('R104 reconciles broad competitor denials in overview, products, and risks using only a located candidate finding', () => {
  const candidate: CompanyResearchMethodResult = {
    skillId: 'competitive_market_map', status: 'complete', attempts: 1,
    answer: '中际旭创是高速光互连的具名候选。', markdown: '已识别中际旭创产品路线。',
    sections: [{ id: 'competition', markdown: '中际旭创是已识别候选。' }],
    findings: [{ text: '中际旭创披露高速光互连产品路线，是具名候选；实际竞争关系未证实。', kind: 'fact', evidence: [{ sourceCandidateId: 'public-web-peer', location: 'paragraph:26' }] }],
    sourceCandidateIds: ['public-web-peer'], limitations: [], risks: [], diagnostics: [],
    executionEvidence: [{ sourceCandidateId: 'public-web-peer', title: '竞品产品资料', publisher: '公开资料', excerpts: [{ sourceCandidateId: 'public-web-peer', location: 'paragraph:26', text: '中际旭创披露高速光互连产品路线。' }] }],
  }
  const sections = [
    { id: 'company-overview', markdown: '目前没有可直接比较的具名竞品，公司的竞争位置需要后续研究。', sourceCandidateIds: ['annual'] },
    { id: 'products', markdown: '产品资料缺少具名竞品/候选及同口径性能数据，无法比较优劣。', sourceCandidateIds: ['annual'] },
    { id: 'risks', markdown: '风险在于缺少具名竞品和可比指标，因此竞争风险暂时无法判断。', sourceCandidateIds: ['annual'] },
    { id: 'competition', markdown: '竞争分析需核实客户重叠。', sourceCandidateIds: ['annual'] },
  ]
  const result = reconcileCompanyCompetitorEvidence({ sections, methodResults: [candidate] })
  for (const section of result.slice(0, 3)) {
    assert.match(section.markdown, /中际旭创披露高速光互连产品路线/)
    assert.match(section.markdown, /\[public-web-peer@paragraph:26\]/)
    assert.match(section.markdown, /直接竞标、客户重叠/); assert.match(section.markdown, /市场份额|份额数据/); assert.match(section.markdown, /同口径胜负仍未验证|同口径的性能、成本、价格或份额数据/)
    assert.match(section.markdown, /不能据此断言存在真实竞争关系|不据此断言直接竞争/)
    assert.ok(section.sourceCandidateIds?.includes('public-web-peer'))
  }
  assert.equal(result[3]!.markdown, sections[3]!.markdown)
})

test('cross-method reconciliation catches the compact phrase no comparable competitor', () => {
  const candidate: CompanyResearchMethodResult = {
    skillId: 'competitive_market_map', status: 'complete', attempts: 1,
    answer: '鹏鼎控股是具名候选。', markdown: '已识别鹏鼎控股的PCB产品材料。',
    sections: [{ id: 'competition', markdown: '鹏鼎控股为候选对象。' }],
    findings: [{ text: '鹏鼎控股披露FPC产品与应用，是具名候选，直接竞争关系未验证。', kind: 'fact', evidence: [{ sourceCandidateId: 'public-web-peer', location: 'paragraph:1' }] }],
    sourceCandidateIds: ['public-web-peer'], limitations: [], risks: [], diagnostics: [],
    executionEvidence: [{ sourceCandidateId: 'public-web-peer', title: '竞品产品资料', publisher: '公开资料', excerpts: [{ sourceCandidateId: 'public-web-peer', location: 'paragraph:1', text: '鹏鼎控股披露FPC产品用于汽车电池板。' }] }],
  }
  const sections = [{ id: 'company-overview', markdown: '现有材料也没有可比竞品的产品、路线和经营数据。', sourceCandidateIds: ['annual'] }]
  const result = reconcileCompanyCompetitorEvidence({ sections, methodResults: [candidate] })
  assert.match(result[0]!.markdown, /鹏鼎控股披露FPC产品与应用/)
  assert.match(result[0]!.markdown, /直接竞标、客户重叠/)
  assert.doesNotMatch(result[0]!.markdown, /没有可比竞品/)
})

test('R104 does not reconcile competitor gaps without a complete located finding and matching excerpt', () => {
  const incomplete: CompanyResearchMethodResult = {
    skillId: 'competitive_market_map', status: 'insufficient_evidence', attempts: 1,
    answer: '中际旭创是具名候选。', markdown: '', sections: [],
    findings: [{ text: '中际旭创是具名候选。', kind: 'fact', evidence: [{ sourceCandidateId: 'official-peer', location: 'paragraph:26' }] }],
    sourceCandidateIds: ['peer'], limitations: [], risks: [], diagnostics: [],
  }
  const sections = [{ id: 'company-overview', markdown: '没有可直接比较的具名竞品。', sourceCandidateIds: ['annual'] }]
  assert.equal(reconcileCompanyCompetitorEvidence({ sections, methodResults: [incomplete] }), sections)
  assert.equal(reconcileCompanyCompetitorEvidence({ sections, methodResults: [{ ...incomplete, status: 'complete' }] }), sections)
})

test('cross-method competitor reconciliation recognizes Latin-script company names only from a located finding', () => {
  const candidate: CompanyResearchMethodResult = {
    skillId: 'competitive_market_map', status: 'complete', attempts: 1,
    answer: 'InnoLight是有证据支持的具名竞争者。', markdown: '候选对照限于高速光通信产品。',
    sections: [{ id: 'competition', markdown: 'InnoLight是具名候选对照。' }],
    findings: [{ text: 'InnoLight是有证据支持的具名竞争者，其资料披露高速收发器产品路线。', kind: 'fact', evidence: [{ sourceCandidateId: 'public-web-peer', location: 'paragraph:101' }] }],
    sourceCandidateIds: ['public-web-peer'], limitations: [], risks: [], diagnostics: [],
    executionEvidence: [{ sourceCandidateId: 'public-web-peer', title: '公开产品资料', publisher: '公开资料', excerpts: [{ sourceCandidateId: 'public-web-peer', location: 'paragraph:101', text: 'InnoLight披露高速收发器产品路线。' }] }],
  }
  const sections = [
    { id: 'company-overview', markdown: '现有材料没有具名竞争对手的可比产品或路线数据。', sourceCandidateIds: ['annual'] },
    { id: 'risks', markdown: '风险分析缺少具名竞品、路线和市场份额。', sourceCandidateIds: ['annual'] },
  ]
  const reconciled = reconcileCompanyCompetitorEvidence({ sections, methodResults: [candidate] })
  for (const section of reconciled) {
    assert.match(section.markdown, /InnoLight是有证据支持的具名竞争者/)
    assert.match(section.markdown, /\[public-web-peer@paragraph:101\]/)
    assert.match(section.markdown, /直接竞标、客户重叠/)
    assert.match(section.markdown, /不能据此断言存在真实竞争关系|不据此断言直接竞争/)
  }
  assert.deepEqual(findKnownCompetitorDenials({ sections: reconciled, methodResults: [candidate] }), [])
  assert.equal(reconcileCompanyCompetitorEvidence({ sections, methodResults: [{ ...candidate, executionEvidence: [] }] }), sections)
})

test('monitoring progress citations stay attached to matching 100G/200G evidence rather than the adjacent 400G research row', () => {
  const method: CompanyResearchMethodResult={
    skillId:'product_technology_analysis',status:'complete',attempts:1,answer:'芯片阶段不同。',markdown:'技术路线。',sections:[{id:'technologies',markdown:'技术路线。'}],findings:[],sourceCandidateIds:['interim'],limitations:[],risks:[],diagnostics:[],
    executionEvidence:[{sourceCandidateId:'interim',title:'2026年半年度报告',publisher:'Company',excerpts:[
      {sourceCandidateId:'interim',location:'paragraph:359',text:'自研100GPAM4EML芯片在'},
      {sourceCandidateId:'interim',location:'paragraph:360',text:'400G及800G光模块中累计使用超千万颗，200GPAM4EML芯片已进入量产阶段，为1.6T光模块提供支撑。'},
      {sourceCandidateId:'interim',location:'paragraph:362',text:'400G PAM4 EML芯片仍处于研发阶段，共封装光学持续推进。'}
    ]}]
  }
  const sections=[
    {id:'monitoring-checklist',title:'跟踪事项',markdown:'100G EML已用于400G及800G模块，200G EML进入量产；[interim@paragraph:362]400G EML仍在研发，共封装光学推进。',sourceCandidateIds:['interim'],proposalIds:[]},
    {id:'catalysts',title:'催化因素',markdown:'100G EML已用于400G及800G模块，200G EML进入量产。',sourceCandidateIds:['interim'],proposalIds:[]}
  ]
  const fixed=reconcileCompanyTechnologyProgressReferences({sections,methodResults:[method]})
  for(const section of fixed){
    assert.match(section.markdown,/100G EML已用于400G及800G模块，累计使用超千万颗/)
    assert.match(section.markdown,/\[interim@paragraph:359\] \[interim@paragraph:360\]/)
    assert.match(section.markdown,/200G EML进入量产/)
    assert.match(section.markdown,/\[interim@paragraph:360\]/)
    assert.match(section.markdown,/不等同于本期销量、订单或收入/)
  }
  assert.match(fixed[0]!.markdown,/；\[interim@paragraph:362\]400G EML仍在研发/)
})

test('revenue-driver reconciliation adds same-row product revenue and cost growth only with the full cited table header', () => {
  const packet = (excerpts: {location:string;text:string}[]) => ({ sourceCandidateId:'interim', title:'2026年半年度报告', publisher:'Company', excerpts:excerpts.map(item=>({...item,sourceCandidateId:'interim'})) })
  const method: CompanyResearchMethodResult = {
    skillId:'business_driver_analysis', status:'complete', attempts:1, answer:'精密组件收入增长且毛利变化。', markdown:'收入与利润受产品组合影响。',
    sections:[{id:'revenue-profit-drivers',markdown:'精密组件收入增长。'}], findings:[{text:'精密组件产品毛利率变动为3.86%。',kind:'fact',evidence:[{sourceCandidateId:'interim',location:'paragraph:798'}]}], sourceCandidateIds:['interim'], limitations:[], risks:[], diagnostics:[],
    executionEvidence:[packet([
      {location:'paragraph:784',text:'单位：元'},
      {location:'paragraph:785',text:'营业收入 营业成本 毛利率'},
      {location:'paragraph:786',text:'营业收入比上'},
      {location:'paragraph:787',text:'年同期增减'},
      {location:'paragraph:788',text:'营业成本比上'},
      {location:'paragraph:789',text:'年同期增减'},
      {location:'paragraph:790',text:'毛利率比上'},
      {location:'paragraph:791',text:'年同期增减'},
      {location:'paragraph:796',text:'分产品'},
      {location:'paragraph:798',text:'精密组件产品 6,580,692,901.95 5,782,359,541.79 12.13% 178.63% 166.89% 3.86%'}
    ])]
  }
  const source = [{ id:'revenue-profit-drivers', title:'收入与利润驱动', markdown:'### 分部与产品组合\n精密组件收入增长。\n### 毛利与成本链路\n毛利改善。', sourceCandidateIds:['interim'], proposalIds:[] }]
  const repaired = reconcileCompanyProductRevenueCostGrowth({sections:source,methodResults:[method]})
  assert.match(repaired[0]!.markdown,/营业收入同比增长178\.63%，营业成本同比增长166\.89%；两项同比增速的算术差为178\.63%−166\.89%＝11\.74个百分点（收入增速高于成本增速11\.74个百分点）/)
  assert.match(repaired[0]!.markdown,/该差值不是毛利率变动/)
  assert.match(repaired[0]!.markdown,/\[interim@paragraph:784\].*\[interim@paragraph:787\].*\[interim@paragraph:798\]/)
  assert.equal(repaired[0]!.title,'收入与利润驱动')
  assert.deepEqual(repaired[0]!.proposalIds,[])
  const incomplete = reconcileCompanyProductRevenueCostGrowth({sections:source,methodResults:[{...method,executionEvidence:[packet([{location:'paragraph:798',text:'精密组件产品 6,580,692,901.95 5,782,359,541.79 12.13% 178.63% 166.89% 3.86%'}])]}]})
  assert.doesNotMatch(incomplete[0]!.markdown,/高于成本增速11\.74个百分点/)
})

test('revenue-driver reconciliation computes a negative revenue-minus-cost spread with the correct direction and formula', () => {
  const packet = (excerpts: {location:string;text:string}[]) => ({ sourceCandidateId:'annual', title:'2025年年度报告', publisher:'Company', excerpts:excerpts.map(item=>({...item,sourceCandidateId:'annual'})) })
  const method: CompanyResearchMethodResult = {
    skillId:'business_driver_analysis', status:'complete', attempts:1, answer:'成本增速大于收入增速。', markdown:'分产品增长不一。',
    sections:[{id:'revenue-profit-drivers',markdown:'精密组件年度毛利承压。'}], findings:[], sourceCandidateIds:['annual'], limitations:[], risks:[], diagnostics:[],
    executionEvidence:[packet([
      {location:'paragraph:885',text:'单位：元'},
      {location:'paragraph:886',text:'营业收入 营业成本 毛利率'},
      {location:'paragraph:887',text:'营业收入比上年同期增减'},
      {location:'paragraph:888',text:'营业成本比上年同期增减'},
      {location:'paragraph:889',text:'毛利率比上年同期增减'},
      {location:'paragraph:894',text:'分产品'},
      {location:'paragraph:898',text:'精密组件产品 8,053,219,122.00 6,987,544,233.00 13.24% 30.61% 38.36% -5.08%'}
    ])]
  }
  const source = [{id:'revenue-profit-drivers',title:'收入与利润驱动',markdown:'精密组件成本增速高于收入增速，毛利率同比下降。\n### 毛利与成本链路\n成本承压。',sourceCandidateIds:['annual'],proposalIds:[]}]
  const repaired = reconcileCompanyProductRevenueCostGrowth({sections:source,methodResults:[method]})
  assert.match(repaired[0]!.markdown,/2025年度 精密组件产品同一报告期营业收入同比增长30\.61%，营业成本同比增长38\.36%；两项同比增速的算术差为30\.61%−38\.36%＝-7\.75个百分点（成本增速高于收入增速7\.75个百分点）/)
  assert.match(repaired[0]!.markdown,/30\.61%−38\.36%＝-7\.75个百分点/)
})

test('revenue-driver reconciliation handles interim module rows with negative growth in both revenue and cost', () => {
  const excerpts = [
    {location:'paragraph:784',text:'单位：元'},
    {location:'paragraph:785',text:'营业收入 营业成本 毛利率'},
    {location:'paragraph:786',text:'营业收入比上'},
    {location:'paragraph:787',text:'年同期增减'},
    {location:'paragraph:788',text:'营业成本比上'},
    {location:'paragraph:789',text:'年同期增减'},
    {location:'paragraph:790',text:'毛利率比上'},
    {location:'paragraph:791',text:'年同期增减'},
    {location:'paragraph:796',text:'分产品'},
    {location:'paragraph:800',text:'光电显示模组 2,723,476,776.77 2,563,023,488.98 5.89% -10.68% -11.53% 0.90%'}
  ]
  const method: CompanyResearchMethodResult = {
    skillId:'business_driver_analysis',status:'complete',attempts:1,answer:'显示模组收入与成本下降。',markdown:'毛利率改善。',
    sections:[{id:'revenue-profit-drivers',markdown:'显示模组收入与成本下降，但成本降幅略大。'}],findings:[],sourceCandidateIds:['interim'],limitations:[],risks:[],diagnostics:[],
    executionEvidence:[{sourceCandidateId:'interim',title:'2026年半年度报告',publisher:'Company',excerpts:excerpts.map(item=>({...item,sourceCandidateId:'interim'}))}]
  }
  const source = [{id:'revenue-profit-drivers',title:'收入与利润驱动',markdown:'显示模组收入与成本均下降，成本降幅较大。\n### 毛利与成本链路\n毛利率改善。',sourceCandidateIds:['interim'],proposalIds:[]}]
  const repaired = reconcileCompanyProductRevenueCostGrowth({sections:source,methodResults:[method]})
  assert.match(repaired[0]!.markdown,/2026年上半年 光电显示模组同一报告期营业收入同比下降10\.68%，营业成本同比下降11\.53%；两项同比增速的算术差为\(-10\.68%\)−\(-11\.53%\)＝0\.85个百分点（收入降幅小于成本降幅0\.85个百分点）/)
})

test('annual revenue-cost reconciliation keeps only current-period product rows and excludes prior tables or unlabeled region rows',()=>{
  const rows=[
    {location:'paragraph:1',text:'营业收入构成'},{location:'paragraph:2',text:'2025年 2024年'},
    {location:'paragraph:3',text:'金额 占营业收入比重 金额 占营业收入比重'},{location:'paragraph:4',text:'分产品'},
    {location:'paragraph:5',text:'产品甲 100.00 50.00% 80.00 40.00% 25.00%'},
    {location:'paragraph:6',text:'产品乙 200.00 50.00% 180.00 60.00% 11.11%'},
    {location:'paragraph:7',text:'单位：元'},{location:'paragraph:8',text:'营业收入 营业成本 毛利率'},
    {location:'paragraph:9',text:'营业收入比上年同期增减'},{location:'paragraph:10',text:'营业成本比上年同期增减'},
    {location:'paragraph:11',text:'毛利率比上年同期增减'},{location:'paragraph:12',text:'分产品'},
    {location:'paragraph:13',text:'产品甲 100.00 70.00 30.00% 25.00% 20.00% 2.00%'},
    {location:'paragraph:14',text:'产品乙 180.00 150.00 16.67% 11.11% 8.00% 1.00%'},
    {location:'paragraph:15',text:'境外 100.00 90.00 10.00% 22.00% 18.00% 1.00%'}
  ]
  const method:CompanyResearchMethodResult={skillId:'business_driver_analysis',status:'complete',attempts:1,answer:'分产品差异。',markdown:'',sections:[],findings:[],sourceCandidateIds:['annual'],limitations:[],risks:[],diagnostics:[],executionEvidence:[{sourceCandidateId:'annual',title:'2025年年度报告',publisher:'Company',excerpts:rows.map(row=>({...row,sourceCandidateId:'annual'}))}]}
  const fixed=reconcileCompanyProductRevenueCostGrowth({sections:[{id:'revenue-profit-drivers',markdown:'### 毛利与成本链路\n需要复核。'},{id:'growth-drivers',markdown:'增长分析。'}],methodResults:[method]})
  assert.match(fixed[0]!.markdown,/2025年度 产品甲同一报告期营业收入同比增长25\.00%，营业成本同比增长20\.00%/)
  assert.doesNotMatch(fixed[0]!.markdown,/产品乙同一报告期|境外同一报告期/)
  assert.doesNotMatch(fixed[1]!.markdown,/产品乙同一报告期|境外同一报告期/)
})

test('revenue-cost growth reconciliation ignores later region and sales-channel segments',()=>{
  const rows=[
    {location:'paragraph:1',text:'单位：元'},{location:'paragraph:2',text:'营业收入 营业成本 毛利率'},
    {location:'paragraph:3',text:'营业收入比上年同期增减'},{location:'paragraph:4',text:'营业成本比上年同期增减'},
    {location:'paragraph:5',text:'毛利率比上年同期增减'},{location:'paragraph:6',text:'分产品'},
    {location:'paragraph:7',text:'电子电路产品 100.00 80.00 20.00% 10.00% 11.00% -0.50%'},
    {location:'paragraph:8',text:'分地区'},{location:'paragraph:9',text:'内销 100.00 80.00 20.00% 20.56% 20.56% 0.00%'},
    {location:'paragraph:10',text:'分销售模式'},{location:'paragraph:11',text:'直销 100.00 80.00 20.00% 9.12% 9.04% 0.07%'}
  ]
  const method:CompanyResearchMethodResult={skillId:'business_driver_analysis',status:'complete',attempts:1,answer:'分产品增长。',markdown:'业务。',sections:[],findings:[],sourceCandidateIds:['annual'],limitations:[],risks:[],diagnostics:[],executionEvidence:[{sourceCandidateId:'annual',title:'2025年年度报告',publisher:'Company',excerpts:rows.map(item=>({...item,sourceCandidateId:'annual'}))}]}
  const sections=[{id:'revenue-profit-drivers',markdown:'### 毛利与成本链路\n收入与成本分析。',sourceCandidateIds:['annual']}]
  const fixed=reconcileCompanyProductRevenueCostGrowth({sections,methodResults:[method]})
  assert.match(fixed[0]!.markdown,/电子电路产品同一报告期营业收入同比增长10\.00%，营业成本同比增长11\.00%/)
  assert.match(fixed[0]!.markdown,/该差值不是毛利率变动/)
  assert.doesNotMatch(fixed[0]!.markdown,/内销同一报告期|直销同一报告期/)
})

test('annual product revenue and cost growth reconciliation joins split headers with line breaks', () => {
  const excerpts = [
    {location:'paragraph:885',text:'单位：元'},
    {location:'paragraph:886',text:'营业收入 营业成本 毛利率 营业收入比上年'},
    {location:'paragraph:887',text:'同期增减'},
    {location:'paragraph:888',text:'营业成本比上年'},
    {location:'paragraph:889',text:'同期增减'},
    {location:'paragraph:890',text:'毛利率比上年'},
    {location:'paragraph:891',text:'同期增减'},
    {location:'paragraph:895',text:'分产品'},
    {location:'paragraph:896',text:'电子电路产品 12,194,000,000.00 10,381,000,000.00 14.87% 3.30% 4.25% -0.75%'},
    {location:'paragraph:897',text:'光电显示模组 2,850,000,000.00 2,610,000,000.00 8.42% -6.03% -7.84% 1.86%'},
    {location:'paragraph:898',text:'精密组件产品 8,053,219,122.00 6,987,544,233.00 13.24% 30.61% 38.36% -5.08%'}
  ]
  const method: CompanyResearchMethodResult = { skillId:'business_driver_analysis', status:'complete', attempts:1, answer:'产品增长存在差异。', markdown:'产品结构。', sections:[{id:'revenue-profit-drivers',markdown:'毛利率有所变化。'}], findings:[], sourceCandidateIds:['annual'], limitations:[], risks:[], diagnostics:[], executionEvidence:[{sourceCandidateId:'annual',title:'2025年年度报告',publisher:'Company',excerpts:excerpts.map(item=>({...item,sourceCandidateId:'annual'}))}] }
  const sections=[{id:'revenue-profit-drivers',title:'收入与利润驱动',markdown:'产品收入与利润分析。\n### 毛利与成本链路\n边际分析。',sourceCandidateIds:['annual'],proposalIds:[]}]
  const fixed=reconcileCompanyProductRevenueCostGrowth({sections,methodResults:[method]})
  assert.match(fixed[0]!.markdown,/电子电路产品同一报告期营业收入同比增长3\.30%，营业成本同比增长4\.25%/)
  assert.match(fixed[0]!.markdown,/光电显示模组同一报告期营业收入同比下降6\.03%，营业成本同比下降7\.84%/)
  assert.match(fixed[0]!.markdown,/精密组件产品同一报告期营业收入同比增长30\.61%，营业成本同比增长38\.36%/)
  assert.match(fixed[0]!.markdown,/\[annual@paragraph:886\].*\[annual@paragraph:887\].*\[annual@paragraph:896\]/)
})

test('annual product revenue and cost growth joins a product label split across source paragraphs and replaces the truncated claim',()=>{
  const excerpts=[
    {location:'paragraph:637',text:'单位：元'},
    {location:'paragraph:638',text:'营业收入 营业成本 毛利率 营业收入比上'},
    {location:'paragraph:639',text:'年同期增减'},
    {location:'paragraph:640',text:'营业成本比上年'},
    {location:'paragraph:641',text:'同期增减'},
    {location:'paragraph:642',text:'毛利率比上年'},
    {location:'paragraph:643',text:'同期增减'},
    {location:'paragraph:647',text:'分产品'},
    {location:'paragraph:650',text:'触控面板及液'},
    {location:'paragraph:651',text:'晶显示模组 6,369,925,398.02 6,158,426,707.63 3.32% 31.02% 28.95% 1.55%'}
  ]
  const method:CompanyResearchMethodResult={skillId:'business_driver_analysis',status:'complete',attempts:1,answer:'产品增长。',markdown:'产品。',sections:[],findings:[],sourceCandidateIds:['annual'],limitations:[],risks:[],diagnostics:[],executionEvidence:[{sourceCandidateId:'annual',title:'2024年年度报告',publisher:'Company',excerpts:excerpts.map(item=>({...item,sourceCandidateId:'annual'}))}]}
  const sections=[{id:'revenue-profit-drivers',markdown:'2024年度 晶显示模组收入同比31.02%，成本同比28.95%，毛利率变动1.55%。\n### 毛利与成本链路\n原分析。',sourceCandidateIds:['annual']}]
  const fixed=reconcileCompanyProductRevenueCostGrowth({sections,methodResults:[method]})
  assert.match(fixed[0]!.markdown,/2024年度 触控面板及液晶显示模组同一报告期营业收入同比增长31\.02%，营业成本同比增长28\.95%/)
  assert.match(fixed[0]!.markdown,/\[annual@paragraph:650\].*\[annual@paragraph:651\]/)
  assert.doesNotMatch(fixed[0]!.markdown,/2024年度 晶显示模组收入同比31\.02%/)
})

test('product revenue share reconciliation requires complete annual table context and cites each row', () => {
  const excerpts=[
    {location:'paragraph:862',text:'营业收入构成'}, {location:'paragraph:863',text:'单位：元'},
    {location:'paragraph:864',text:'2025 年 2024 年'}, {location:'paragraph:865',text:'同比增减'},
    {location:'paragraph:866',text:'金额 占营业收入比重 金额 占营业收入比重'}, {location:'paragraph:872',text:'分产品'},
    {location:'paragraph:873',text:'电子电路产品 27,000,000,000.00 63.85% 24,000,000,000.00 61.20% 10.00%'},
    {location:'paragraph:874',text:'光电显示模组 6,300,000,000.00 14.92% 6,600,000,000.00 16.83% -4.55%'},
    {location:'paragraph:875',text:'精密组件产品 6,250,000,000.00 14.78% 4,800,000,000.00 12.25% 30.21%'},
    {location:'paragraph:876',text:'光模块 1,435,534,921.96 3.58%'},
    {location:'paragraph:877',text:'其他产品 1,150,000,000.00 2.87%'},
    {location:'paragraph:878',text:'分地区'},
    {location:'paragraph:879',text:'内销 4,669,148,407.96 18.59% 3,787,323,865.50 22.34% 23.28%'},
    {location:'paragraph:880',text:'外销 20,445,000,000.00 81.41% 13,167,840,033.39 77.66% 75.64%'}
  ]
  const method:CompanyResearchMethodResult={skillId:'business_model_map',status:'complete',attempts:1,answer:'公司有多个产品线。',markdown:'产品组合。',sections:[{id:'products',markdown:'主营产品包括电路板和精密组件。'}],findings:[],sourceCandidateIds:['annual'],limitations:[],risks:[],diagnostics:[],executionEvidence:[{sourceCandidateId:'annual',title:'2025年年度报告',publisher:'Company',excerpts:excerpts.map(item=>({...item,sourceCandidateId:'annual'}))}]}
  const sections=[{id:'products',title:'产品',markdown:'主营产品包括电子电路产品、光电显示模组与精密组件产品。',sourceCandidateIds:['annual']}]
  const fixed=reconcileCompanyProductRevenueShares({sections,methodResults:[method]})
  assert.match(fixed[0]!.markdown,/电子电路产品占营业收入63\.85%/)
  assert.match(fixed[0]!.markdown,/光电显示模组占营业收入14\.92%/)
  assert.match(fixed[0]!.markdown,/精密组件产品占营业收入14\.78%/)
  assert.match(fixed[0]!.markdown,/光模块占营业收入3\.58% \[annual@paragraph:876\]/)
  assert.match(fixed[0]!.markdown,/其他产品占营业收入2\.87% \[annual@paragraph:877\]/)
  assert.doesNotMatch(fixed[0]!.markdown,/内销占营业收入|外销占营业收入/)
  assert.match(fixed[0]!.markdown,/\[annual@paragraph:862\].*\[annual@paragraph:863\].*\[annual@paragraph:864\].*\[annual@paragraph:866\].*\[annual@paragraph:872\]/)
  for (const paragraph of [873,874,875,876,877]) assert.match(fixed[0]!.markdown,new RegExp(`\\[annual@paragraph:${paragraph}\\]`))
  assert.ok(fixed[0]!.sourceCandidateIds?.includes('annual'))
  const incomplete=reconcileCompanyProductRevenueShares({sections,methodResults:[{...method,executionEvidence:[{...method.executionEvidence![0]!,excerpts:excerpts.filter(item=>item.location!=='paragraph:866').map(item=>({...item,sourceCandidateId:'annual'}))}]}]})
  assert.equal(incomplete[0]!.markdown,sections[0]!.markdown)
})

test('final financial section carries exact net-profit growth calculation at the opening with its source', () => {
  const method:CompanyResearchMethodResult={skillId:'financial_quality_analysis',status:'complete',attempts:1,answer:'净利润累计同比增长290.0891%。',markdown:'财务结论。',sections:[{id:'financial-quality',markdown:'净利润同比复算（结构化字段）：（2,956,898,811.04元−758,006,007.10元）÷abs(758,006,007.10元)×100%＝290.0891%；来源 [akshare-financial-002384@paragraph:1]'}],findings:[],sourceCandidateIds:['akshare-financial-002384'],limitations:[],risks:[],diagnostics:[]}
  const sections=[{id:'financial-quality',markdown:'本期净利润累计同比增长290.0891%，显示利润改善。',sourceCandidateIds:[] as string[]}]
  const fixed=reconcileCompanyFinancialGrowthFormula({sections,methodResults:[method]})
  assert.match(fixed[0]!.markdown,/^#### 净利润同比复算\n净利润同比复算/)
  assert.match(fixed[0]!.markdown,/\[akshare-financial-002384@paragraph:1\]/)
  assert.ok(fixed[0]!.sourceCandidateIds?.includes('akshare-financial-002384'))
})

test('annual direction comparison already present in drafted financial prose is moved to the section opening', () => {
  const annual='完整年度同比对照（2024-12-31至2025-12-31）：营业收入增长9.12%；营业利润下降14.24%。[akshare-financial-002384@paragraph:1]'
  const method:CompanyResearchMethodResult={skillId:'financial_quality_analysis',status:'complete',attempts:1,answer:'',markdown:'',sections:[{id:'financial-quality',markdown:annual}],findings:[],sourceCandidateIds:['akshare-financial-002384'],limitations:[],risks:[],diagnostics:[]}
  const drafted=`#### 完整年度方向对照\n${annual}\n\n# 财务质量\n\n最新半年趋势。\n\n确定性财务摘要（人民币亿元）。\n| 指标 | 数值 |\n|---|---:|\n| 营业利润 | 35.03 |\n\n${annual}`
  const fixed=reconcileCompanyFinancialGrowthFormula({sections:[{id:'financial-quality',markdown:drafted}],methodResults:[method]})
  assert.ok(fixed[0]!.markdown.startsWith(`# 财务质量\n\n#### 完整年度方向对照\n${annual}`))
  assert.equal(fixed[0]!.markdown.match(/完整年度同比对照/g)?.length,1)
  assert.ok(fixed[0]!.markdown.indexOf('营业利润下降14.24%')<fixed[0]!.markdown.indexOf('确定性财务摘要'))
})

test('annual production growth reconciles the disclosed percentage and acquisition/capacity boundary', () => {
  const method:CompanyResearchMethodResult={skillId:'business_driver_analysis',status:'complete',attempts:1,answer:'产量上升。',markdown:'增长驱动。',sections:[{id:'growth-drivers',markdown:'精密组件产能提升。'}],findings:[],sourceCandidateIds:['annual'],limitations:[],risks:[],diagnostics:[],executionEvidence:[{sourceCandidateId:'annual',title:'2025年年度报告',publisher:'Company',excerpts:[{sourceCandidateId:'annual',location:'paragraph:933',text:'2、精密组件产品生产量同比增长 32.92%，除四季度合并法国 GMD 集团外，由于部分生产基地的投产增加了产销量。'}]}]}
  const sections=[{id:'growth-drivers',title:'增长',markdown:'精密组件产能提升。',sourceCandidateIds:['annual']}]
  const fixed=reconcileCompanyProductProductionGrowth({sections,methodResults:[method]})
  assert.match(fixed[0]!.markdown,/精密组件产品生产量同比增长32\.92%/)
  assert.match(fixed[0]!.markdown,/不等同于销量、收入或利润增长/)
  assert.match(fixed[0]!.markdown,/并购并表与新增产能的贡献未量化/)
  assert.match(fixed[0]!.markdown,/\[annual@paragraph:933\]/)
})

test('product revenue driver reconciliation reports exact period values and does not invent growth for a one-period row', () => {
  const excerpts=[
    {location:'paragraph:764',text:'营业收入构成'},{location:'paragraph:765',text:'单位：元'},
    {location:'paragraph:766',text:'本报告期 上年同期'},{location:'paragraph:768',text:'金额 占营业收入比重 金额 占营业收入比重'},
    {location:'paragraph:773',text:'分产品'},
    {location:'paragraph:775',text:'精密组件产品 6,580,692,901.95 23.67% 2,361,835,859.44 13.93% 178.63%'},
    {location:'paragraph:776',text:'光模块 5,350,999,299.05 19.25%'}
  ]
  const method:CompanyResearchMethodResult={skillId:'business_driver_analysis',status:'complete',attempts:1,answer:'产品收入增长。',markdown:'增长。',sections:[{id:'growth-drivers',markdown:'增长。'}],findings:[],sourceCandidateIds:['interim'],limitations:[],risks:[],diagnostics:[],executionEvidence:[{sourceCandidateId:'interim',title:'2026年半年度报告',publisher:'Company',excerpts:excerpts.map(item=>({...item,sourceCandidateId:'interim'}))}]}
  const sections=[{id:'growth-drivers',markdown:'结构化业务驱动分析没有可量化贡献项，收入变化全部保留为未归因残差；没有数量、单价或同范围分部桥，不能强行拆成销量、价格或组合效应。',sourceCandidateIds:['interim']}]
  const partialDriver={...method,executionEvidence:[{...method.executionEvidence![0]!,excerpts:method.executionEvidence![0]!.excerpts.filter(item=>item.location!=='paragraph:768')}]}
  const businessModel={...method,skillId:'business_model_map' as const}
  const fixed=reconcileCompanyProductRevenueDrivers({sections,methodResults:[partialDriver,businessModel]})
  assert.match(fixed[0]!.markdown,/2026年上半年精密组件产品收入6,580,692,901\.95元，占营业收入23\.67%，同比增长178\.63%/)
  assert.match(fixed[0]!.markdown,/2026年上半年光模块收入5,350,999,299\.05元，占营业收入19\.25%；该行摘录没有列出上年同期收入或同比值，故不补算增速/)
  assert.match(fixed[0]!.markdown,/分产品表已披露各业务收入规模及部分同比变化/)
  assert.doesNotMatch(fixed[0]!.markdown,/收入变化全部保留为未归因残差/)
  for(const paragraph of [765,766,768,773,775,776])assert.match(fixed[0]!.markdown,new RegExp(`\\[interim@paragraph:${paragraph}\\]`))
})

test('revenue and profit drivers withdraw a product-growth claim when the official row has no comparable period', () => {
  const excerpts = [
    {sourceCandidateId:'interim',location:'paragraph:764',text:'营业收入构成'},
    {sourceCandidateId:'interim',location:'paragraph:765',text:'单位：元'},
    {sourceCandidateId:'interim',location:'paragraph:766',text:'本报告期 上年同期'},
    {sourceCandidateId:'interim',location:'paragraph:767',text:'同比增减'},
    {sourceCandidateId:'interim',location:'paragraph:768',text:'金额 占营业收入比重 金额 占营业收入比重'},
    {sourceCandidateId:'interim',location:'paragraph:773',text:'分产品'},
    {sourceCandidateId:'interim',location:'paragraph:776',text:'光模块 5,350,999,299.05 19.25%'},
  ]
  const method:CompanyResearchMethodResult={skillId:'business_driver_analysis',status:'complete',attempts:1,answer:'',markdown:'',sections:[],findings:[],sourceCandidateIds:['interim'],limitations:[],risks:[],diagnostics:[],executionEvidence:[{sourceCandidateId:'interim',title:'2026年半年度报告',publisher:'Company',excerpts}]}
  const input=[{id:'revenue-profit-drivers',markdown:'2026年半年度报告的分产品收入构成显示，精密组件产品、光模块增长，而光电显示模组下降。[interim@paragraph:776]'}]
  const fixed=reconcileCompanyUnsupportedProductGrowth({sections:input,methodResults:[method]})[0]!
  assert.doesNotMatch(fixed.markdown,/光模块增长/)
  assert.match(fixed.markdown,/光模块本期收入5,350,999,299.05元、占营业收入19.25%/)
  assert.match(fixed.markdown,/该行未提供上年同期值或同比，不据此判断增长方向/)
  for(const paragraph of [765,766,767,768,773,776])assert.match(fixed.markdown,new RegExp(`\\[interim@paragraph:${paragraph}\\]`))
})

test('product customer chapter carries company-wide disclosed concentration without product mapping claims',()=>{
  const method:CompanyResearchMethodResult={skillId:'company_risk_analysis',status:'complete',attempts:1,answer:'客户集中度偏高。',markdown:'客户风险。',sections:[{id:'risks',markdown:'客户集中度。'}],findings:[],sourceCandidateIds:['annual'],limitations:[],risks:[],diagnostics:[],executionEvidence:[{sourceCandidateId:'annual',title:'2025年年度报告',publisher:'Company',excerpts:[
    {sourceCandidateId:'annual',location:'paragraph:965',text:'前五名客户合计销售金额占年度销售总额比例 64.33%'},
    {sourceCandidateId:'annual',location:'paragraph:969',text:'1 第一名 18,642,838,150.75 46.46%'},
    {sourceCandidateId:'annual',location:'paragraph:970',text:'2 第二名 2,809,002,571.15 7.00%'}
  ]}]}
  const sections=[{id:'products',markdown:'本节未见客户集中度和前五名客户资料；客户与具体产品映射不明。',sourceCandidateIds:['annual']}]
  const fixed=reconcileCompanyProductCustomerConcentration({sections,methodResults:[method]})
  assert.match(fixed[0]!.markdown,/前五名客户占年度销售总额64\.33%，第一名46\.46%、第二名7\.00%/)
  assert.match(fixed[0]!.markdown,/客户身份匿名/)
  assert.match(fixed[0]!.markdown,/不能将公司级集中度映射到具体产品/)
  for(const paragraph of [965,969,970])assert.match(fixed[0]!.markdown,new RegExp(`\\[annual@paragraph:${paragraph}\\]`))
  assert.ok(fixed[0]!.sourceCandidateIds?.includes('annual'))
})

test('employee plan reconciliation preserves ambiguous row values without claiming participant count',()=>{
  const method:CompanyResearchMethodResult={skillId:'management_governance_analysis',status:'complete',attempts:1,answer:'员工计划。',markdown:'计划见半年报。',sections:[{id:'management-capital-allocation',markdown:'管理分析。'}],findings:[],sourceCandidateIds:['interim'],limitations:[],risks:[],diagnostics:[],executionEvidence:[{sourceCandidateId:'interim',title:'2026年半年度报告',publisher:'Company',excerpts:[
    {sourceCandidateId:'interim',location:'paragraph:1402',text:'公司及子公司核心技术（业务）骨干'},
    {sourceCandidateId:'interim',location:'paragraph:1403',text:'（不包括公司董事、高级管理人员）'},
    {sourceCandidateId:'interim',location:'paragraph:1404',text:'150 3,048,701 无 0.17%'}
  ]}]}
  const sections=[{id:'management-capital-allocation',markdown:'员工持股计划已披露。',sourceCandidateIds:['interim']}]
  const fixed=reconcileCompanyEmployeePlanEvidence({sections,methodResults:[method]})
  assert.match(fixed[0]!.markdown,/同一数据行列示150；当前可用摘录未提供能确认“150”是员工人数还是人数上限的完整列标题或定义/)
  assert.match(fixed[0]!.markdown,/列示持有股票3,048,701股、占总股本0\.17%/)
  assert.match(fixed[0]!.markdown,/未提供能确认“150”是员工人数还是人数上限的完整列标题或定义/)
  assert.doesNotMatch(fixed[0]!.markdown,/参与人数150人|实际参与人数150人/)
  for(const paragraph of [1402,1403,1404])assert.match(fixed[0]!.markdown,new RegExp(`\\[interim@paragraph:${paragraph}\\]`))
})

test('R161 keeps employee-plan terms and execution rows bound to their named plan years',()=>{
  const annualExcerpts=[
    {sourceCandidateId:'annual',location:'paragraph:3060',text:'2025年员工持股计划涉及不超过2.5万名员工，资金总额不超过41亿元，计划分三期解锁。'},
    {sourceCandidateId:'annual',location:'paragraph:3061',text:'考核要求为考核期内每年营业收入同比上一年度增长不低于10%。'}
  ]
  const interimExcerpts=[
    {sourceCandidateId:'interim',location:'paragraph:1145',text:'2024年员工持股计划：'},
    {sourceCandidateId:'interim',location:'paragraph:1154',text:'2025年员工持股计划：'},
    {sourceCandidateId:'interim',location:'paragraph:1159',text:'21,417 22,501,479 无 0.2468%'}
  ]
  const method={skillId:'management_governance_analysis',status:'complete',executionEvidence:[
    {sourceCandidateId:'annual',title:'2025年年度报告',excerpts:annualExcerpts},
    {sourceCandidateId:'interim',title:'2026年半年度报告',excerpts:interimExcerpts}
  ]} as unknown as CompanyResearchMethodResult
  const sections=[{id:'management-capital-allocation',sourceCandidateIds:[] as string[],markdown:'2025年员工持股计划设定营业收入增长考核并分期解锁，半年度报告披露计划参与规模和持股数据；收入条件不能替代利润、现金回报或股东价值检验。'}]
  const fixed=reconcileCompanyEmployeePlanEvidence({sections,methodResults:[method]})[0]!
  assert.match(fixed.markdown,/2026年半年报将2024年计划与2025年计划分列/)
  assert.match(fixed.markdown,/21,417与22,501,479股这一行明确位于2025年计划项下/)
  assert.doesNotMatch(fixed.markdown,/计划参与规模和持股数据/)
  for(const ref of ['annual@paragraph:3060','annual@paragraph:3061','interim@paragraph:1145','interim@paragraph:1154','interim@paragraph:1159'])assert.ok(fixed.markdown.includes(`[${ref}]`))
})

test('employee plan reconciliation scopes an annual no-plan statement to its period and preserves the later plan',()=>{
  const method:CompanyResearchMethodResult={skillId:'management_governance_analysis',status:'complete',attempts:1,answer:'员工计划。',markdown:'计划见半年报。',sections:[{id:'management-capital-allocation',markdown:'管理分析。'}],findings:[],sourceCandidateIds:['interim'],limitations:[],risks:[],diagnostics:[],executionEvidence:[{sourceCandidateId:'interim',title:'2026年半年度报告',publisher:'Company',excerpts:[
    {sourceCandidateId:'interim',location:'paragraph:1402',text:'公司及子公司核心技术（业务）骨干'},
    {sourceCandidateId:'interim',location:'paragraph:1403',text:'（不包括公司董事、高级管理人员）'},
    {sourceCandidateId:'interim',location:'paragraph:1404',text:'150 3,048,701 无 0.17%'}
  ]}]}
  const old='激励安排有阶段变化：上一年度报告披露两项员工持股计划及其人数、持股数和比例，并称期末已出售完毕；本年度报告则称报告期无股权激励、员工持股计划或其他员工激励实施。旧计划曾使核心人员与股东价值存在一定关联，但出售完毕及当期无计划，意味着持续激励机制的证据减弱；不能仅据此断定人员流失或绩效下降。'
  const sections=[{id:'management-capital-allocation',markdown:`${old}\n\n#### 员工持股计划覆盖范围\n参与人数150人、持股3,048,701股、占总股本0.17%。`,sourceCandidateIds:['annual','interim']}]
  const fixed=reconcileCompanyEmployeePlanEvidence({sections,methodResults:[method]})
  assert.match(fixed[0]!.markdown,/2025年度年报所称报告期无员工持股计划，描述的是2025年度情况；2026年半年度报告随后披露新一期员工持股计划/)
  assert.doesNotMatch(fixed[0]!.markdown,/意味着持续激励机制的证据减弱/)
  assert.doesNotMatch(fixed[0]!.markdown,/参与人数150人|实际参与人数150人/)
})

test('employee plan reconciliation uses the same report table header when it is present',()=>{
  const method:CompanyResearchMethodResult={skillId:'management_governance_analysis',status:'complete',attempts:1,answer:'员工计划。',markdown:'计划见半年报。',sections:[{id:'management-capital-allocation',markdown:'管理分析。'}],findings:[],sourceCandidateIds:['interim'],limitations:[],risks:[],diagnostics:[],executionEvidence:[{sourceCandidateId:'interim',title:'2026年半年度报告',publisher:'Company',excerpts:[
    {sourceCandidateId:'interim',location:'paragraph:1391',text:'报告期内全部有效的员工持股计划情况'},
    {sourceCandidateId:'interim',location:'paragraph:1392',text:'员工的范围'},
    {sourceCandidateId:'interim',location:'paragraph:1393',text:'员工人'},
    {sourceCandidateId:'interim',location:'paragraph:1394',text:'数'},
    {sourceCandidateId:'interim',location:'paragraph:1402',text:'公司及子公司核心技术（业务）骨干'},
    {sourceCandidateId:'interim',location:'paragraph:1403',text:'（不包括公司董事、高级管理人员）'},
    {sourceCandidateId:'interim',location:'paragraph:1404',text:'150 3,048,701 无 0.17%'}
  ]}]}
  const sections=[{id:'management-capital-allocation',markdown:'员工持股计划已披露。'},{id:'monitoring-checklist',markdown:'| 治理、任职与员工持股：员工持股计划表格同行列示数值150（其是否代表实际参与人数或人数上限未能由所供表头确认）、持股3,048,701股。该人数是实际参与人数，不是计划人数上限；证据包未给可核验的计划人数上限或截至期末持有数，不以其他列替代。 [interim@paragraph:1404] |'}]
  const fixed=reconcileCompanyEmployeePlanEvidence({sections,methodResults:[method]})
  assert.match(fixed[0]!.markdown,/员工人数列披露150人/)
  assert.doesNotMatch(fixed[0]!.markdown,/人数上限的完整列标题或定义/)
  for(const paragraph of [1393,1394,1402,1403,1404])assert.match(fixed[0]!.markdown,new RegExp(`\\[interim@paragraph:${paragraph}\\]`))
  const monitoring=fixed[1]!.markdown
  assert.match(monitoring,/员工人数150人/)
  assert.match(monitoring,/150为员工人数列/)
  assert.doesNotMatch(monitoring,/150是实际参与人数/)
  assert.doesNotMatch(monitoring,/证据包未给可核验/)
  for(const paragraph of [1393,1394])assert.match(monitoring,new RegExp(`\\[interim@paragraph:${paragraph}\\]`))
  const twice=reconcileCompanyEmployeePlanEvidence({sections:fixed,methodResults:[method]})
  assert.equal(twice[0]!.markdown.match(/#### 员工持股计划披露口径/g)?.length,1)
})

test('monitoring reconciliation does not turn the employee-count column into a participant cap or unknown headcount',()=>{
  const method:CompanyResearchMethodResult={skillId:'management_governance_analysis',status:'complete',attempts:1,answer:'员工计划。',markdown:'计划见半年报。',sections:[],findings:[],sourceCandidateIds:['interim'],limitations:[],risks:[],diagnostics:[],executionEvidence:[{sourceCandidateId:'interim',title:'2026年半年度报告',publisher:'Company',excerpts:[
    {sourceCandidateId:'interim',location:'paragraph:1393',text:'员工人'},
    {sourceCandidateId:'interim',location:'paragraph:1394',text:'数'},
    {sourceCandidateId:'interim',location:'paragraph:1402',text:'公司及子公司核心技术（业务）骨干'},
    {sourceCandidateId:'interim',location:'paragraph:1403',text:'（不包括公司董事、高级管理人员）'},
    {sourceCandidateId:'interim',location:'paragraph:1404',text:'150 3,048,701 无 0.17%'}
  ]}]}
  const sections=[{id:'management-capital-allocation',markdown:'员工持股计划已披露。'},{id:'monitoring-checklist',markdown:'| 治理与激励执行 | 最新半年度表列参与对象上限150人、实际参与人数在所给披露中未明确、持有公司股票3,048,701股。150人为人数上限而非实际人数，股数不等于参与人数。 |'}]
  const fixed=reconcileCompanyEmployeePlanEvidence({sections,methodResults:[method]})
  const monitoring=fixed.find(item=>item.id==='monitoring-checklist')!.markdown
  assert.match(monitoring,/员工人数”列列示150人/)
  assert.match(monitoring,/该字段不直接代表实际认购或期末持有人数/)
  assert.doesNotMatch(monitoring,/参与对象上限150人|150人为人数上限|实际参与人数在所给披露中未明确/)
  assert.match(monitoring,/持有公司股票3,048,701股/)
  for(const paragraph of [1393,1394,1402,1403,1404])assert.match(monitoring,new RegExp(`\\[interim@paragraph:${paragraph}\\]`))
})

test('segment table reconciliation attaches an exact source row to each industry, product, region and sales-mode value',()=>{
  const excerpts=[
    {location:'paragraph:870',text:'计算机、通信和其他电子 39,643,732,616.04 98.80%'},
    {location:'paragraph:871',text:'其他 481,126,223.48 1.20%'},
    {location:'paragraph:873',text:'电子电路产品 25,620,292,915.99 63.85%'},
    {location:'paragraph:876',text:'光模块 1,435,534,921.96 3.58%'},
    {location:'paragraph:879',text:'内销 7,459,672,435.12 18.59%'},
    {location:'paragraph:880',text:'外销 32,665,186,404.40 81.41%'},
    {location:'paragraph:882',text:'直销 40,124,858,839.52 100.00%'}
  ]
  const method:CompanyResearchMethodResult={skillId:'business_model_map',status:'complete',attempts:1,answer:'分部表。',markdown:'分部表。',sections:[],findings:[],sourceCandidateIds:['annual'],limitations:[],risks:[],diagnostics:[],executionEvidence:[{sourceCandidateId:'annual',title:'2025年年度报告',publisher:'Company',excerpts:excerpts.map(item=>({...item,sourceCandidateId:'annual'}))}]}
  const rows=['| 分行业 | 计算机、通信和其他电子 | 39,643,732,616.04 | 98.80% |','| 分行业 | 其他 | 481,126,223.48 | 1.20% |','| 分产品 | 电子电路产品 | 25,620,292,915.99 | 63.85% |','| 分产品 | 光模块 | 1,435,534,921.96 | 3.58% |','| 分地区 | 内销 | 7,459,672,435.12 | 18.59% |','| 分地区 | 外销 | 32,665,186,404.40 | 81.41% |','| 分销售模式 | 直销 | 40,124,858,839.52 | 100.00% |']
  const fixed=reconcileCompanySegmentRowCitations({sections:[{id:'business-segments',markdown:rows.join('\n')}],methodResults:[method]})
  for(const [index,paragraph] of [870,871,873,876,879,880,882].entries())assert.match(fixed[0]!.markdown.split('\n')[index]!,new RegExp(`\\[annual@paragraph:${paragraph}\\]`))
})

test('control-owner holdings reconciliation replaces the broad false shareholding gap with cited ratios',()=>{
  const method:CompanyResearchMethodResult={skillId:'management_governance_analysis',status:'complete',attempts:1,answer:'控制人。',markdown:'控制人。',sections:[],findings:[],sourceCandidateIds:['interim'],limitations:[],risks:[],diagnostics:[],executionEvidence:[{sourceCandidateId:'interim',title:'2026年半年度报告',publisher:'Company',excerpts:[
    {sourceCandidateId:'interim',location:'paragraph:2136',text:'袁永刚 境内自然人 16.53% 302,781,254'},
    {sourceCandidateId:'interim',location:'paragraph:2137',text:'袁永峰 境内自然人 13.51% 247,526,917'},
    {sourceCandidateId:'interim',location:'paragraph:2139',text:'袁富根 境内自然人 3.21% 58,796,052'},
    {sourceCandidateId:'interim',location:'paragraph:2168',text:'袁永刚、袁永峰系袁富根之子'},
    {sourceCandidateId:'interim',location:'paragraph:2169',text:'上述父子三人系公司的实际控制人'}
  ]}]}
  const sections=[{id:'management-capital-allocation',markdown:'本次材料提供的股东表仅包含表头与少数持有人行，未包含足以完整复核各控制人持股比例的对应股东数据行，因此不在此推算或汇总比例。'}]
  const fixed=reconcileCompanyControlOwnerHoldings({sections,methodResults:[method]})
  assert.match(fixed[0]!.markdown,/袁永刚持股16\.53%、袁永峰持股13\.51%、袁富根持股3\.21%/)
  assert.doesNotMatch(fixed[0]!.markdown,/不在此推算或汇总比例/)
  for(const paragraph of [2136,2137,2139,2168,2169])assert.match(fixed[0]!.markdown,new RegExp(`\\[interim@paragraph:${paragraph}\\]`))
})

test('competitor reconciliation ignores a company self-description sourced only to its own filing',()=>{
  const ownCompany:CompanyResearchMethodResult={skillId:'competitive_market_map',status:'complete',attempts:1,answer:'东山精密是具名竞争候选。',markdown:'东山精密披露光模块业务。',sections:[],findings:[{text:'东山精密披露光模块业务及全链条布局，是候选。',kind:'fact',evidence:[{sourceCandidateId:'official-company',location:'paragraph:58'}]}],sourceCandidateIds:['official-company'],limitations:[],risks:[],diagnostics:[],executionEvidence:[{sourceCandidateId:'official-company',title:'年度报告',publisher:'Company',excerpts:[{sourceCandidateId:'official-company',location:'paragraph:58',text:'公司业务包含光模块及光芯片。'}]}]}
  const sections=[{id:'products',markdown:'产品分析材料有限。',sourceCandidateIds:['official-company']}]
  assert.equal(reconcileCompanyCompetitorEvidence({sections,methodResults:[ownCompany]}),sections)
})

test('leverage formula includes both period balance operands and fails closed for incompatible bases',()=>{
  const sections=[{id:'management-capital-allocation',markdown:'负债占资产比例上升。',sourceCandidateIds:[] as string[]},{id:'financial-quality',markdown:'杠杆趋势需要复算。',sourceCandidateIds:[] as string[]}]
  const financialTable=[
    {period:'2025-06-30',metrics:{assets:100e8,liabilities:56.29e8},metadata:{assets:{unit:'CNY',currency:'CNY',basis:'POINT_IN_TIME'},liabilities:{unit:'CNY',currency:'CNY',basis:'POINT_IN_TIME'}},conflicts:[]},
    {period:'2026-06-30',metrics:{assets:120e8,liabilities:77.412e8},metadata:{assets:{unit:'CNY',currency:'CNY',basis:'POINT_IN_TIME'},liabilities:{unit:'CNY',currency:'CNY',basis:'POINT_IN_TIME'}},conflicts:[]}
  ]
  const fixed=reconcileCompanyLeverageFormula({sections,financialTable,sourceCandidateId:'akshare-financial-002384'})
  for(const section of fixed){assert.match(section.markdown,/2025-06-30负债56\.29÷资产100\.00＝56\.29%/);assert.match(section.markdown,/2026-06-30负债77\.41÷资产120\.00＝64\.51%/);assert.match(section.markdown,/变化64\.51%−56\.29%＝8\.22个百分点/);assert.match(section.markdown,/\[akshare-financial-002384@paragraph:1\]/)}
  const invalid=reconcileCompanyLeverageFormula({sections,financialTable:[{...financialTable[0]!,metadata:{...financialTable[0]!.metadata,assets:{unit:'UNKNOWN',currency:'CNY',basis:'POINT_IN_TIME'}}},financialTable[1]!],sourceCandidateId:'akshare-financial-002384'})
  assert.deepEqual(invalid.map(item=>item.markdown),sections.map(item=>item.markdown))
})

test('risk leverage comparison is recalculated from compatible sourced balance-sheet periods',()=>{
  const sections=[{id:'risks',markdown:'结构化数据的资产负债率约70.96%，较上年同期约70.96%变化约负0.12个百分点，提示比例略降。',sourceCandidateIds:[] as string[]}]
  const financialTable=[
    {period:'2025-06-30',metrics:{assets:100e8,liabilities:71.08e8},metadata:{assets:{unit:'CNY',currency:'CNY',basis:'POINT_IN_TIME'},liabilities:{unit:'CNY',currency:'CNY',basis:'POINT_IN_TIME'}},conflicts:[]},
    {period:'2026-06-30',metrics:{assets:100e8,liabilities:70.96e8},metadata:{assets:{unit:'CNY',currency:'CNY',basis:'POINT_IN_TIME'},liabilities:{unit:'CNY',currency:'CNY',basis:'POINT_IN_TIME'}},conflicts:[]}
  ]
  const fixed=reconcileCompanyLeverageFormula({sections,financialTable,sourceCandidateId:'akshare-financial-002594'})
  assert.match(fixed[0]!.markdown,/2026-06-30资产负债率70\.96%，较2025-06-30的71\.08%变化-0\.12个百分点/)
  assert.deepEqual(fixed[0]!.sourceCandidateIds,['akshare-financial-002594'])
  const aliasSections=[{...sections[0]!,markdown:'负债资产比约70.96%，较上年同期约70.96%变化约负0.12个百分点。'}]
  const alias=reconcileCompanyLeverageFormula({sections:aliasSections,financialTable,sourceCandidateId:'akshare-financial-002594'})
  assert.match(alias[0]!.markdown,/较2025-06-30的71\.08%变化-0\.12个百分点\[akshare-financial-002594@paragraph:1\]/)
  assert.doesNotMatch(alias[0]!.markdown,/上年同期约70\.96/)
  const conflicted=reconcileCompanyLeverageFormula({sections,financialTable:[{...financialTable[0]!,conflicts:[{metric:'liabilities'}]},financialTable[1]!],sourceCandidateId:'akshare-financial-002594'})
  assert.equal(conflicted[0]!.markdown,sections[0]!.markdown)
})

test('financial summary table rebuild is followed by reinsertion of the leverage formula into financial quality',()=>{
  const sections=[{id:'management-capital-allocation',markdown:'负债占资产比例上升。',sourceCandidateIds:[] as string[]},{id:'financial-quality',markdown:'杠杆趋势需要复算。\n\n确定性财务摘要（人民币亿元）。\n| 指标 | 数值 |\n|---|---:|\n| 资产 | 120.00 |',sourceCandidateIds:[] as string[]}]
  const financialTable=[
    {period:'2025-06-30',metrics:{assets:100e8,liabilities:56.29e8},metadata:{assets:{unit:'CNY',currency:'CNY',basis:'POINT_IN_TIME'},liabilities:{unit:'CNY',currency:'CNY',basis:'POINT_IN_TIME'}},conflicts:[]},
    {period:'2026-06-30',metrics:{assets:120e8,liabilities:77.412e8},metadata:{assets:{unit:'CNY',currency:'CNY',basis:'POINT_IN_TIME'},liabilities:{unit:'CNY',currency:'CNY',basis:'POINT_IN_TIME'}},conflicts:[]},
  ]
  const first=reconcileCompanyLeverageFormula({sections,financialTable,sourceCandidateId:'akshare-financial-002384'})
  const rebuilt=reconcileCompanyFinancialSummaryTable({sections:first,markdown:'确定性财务摘要（人民币亿元）。\n\n| 指标 | 数值 |\n|---|---:|\n| 资产 | 120.00 |'})
  assert.doesNotMatch(rebuilt.find(item=>item.id==='financial-quality')!.markdown,/资产负债率可复算/)
  const final=reconcileCompanyLeverageFormula({sections:rebuilt,financialTable,sourceCandidateId:'akshare-financial-002384'})
  assert.match(final.find(item=>item.id==='financial-quality')!.markdown,/资产负债率可复算（期末余额/)
  assert.match(final.find(item=>item.id==='management-capital-allocation')!.markdown,/资产负债率可复算（期末余额/)
})

test('financial and concentration risk boundaries remove unsupported severity and incompatible accrual proxy',()=>{
  const risk=[{id:'risks',markdown:'若第一名缩减采购，影响可能显著，但静态销售占比不等于实际损失。'}]
  const riskFixed=reconcileCompanyRiskBoundaries({sections:risk})
  assert.match(riskFixed[0]!.markdown,/实际影响取决于客户产品映射、订单替代性和固定成本吸收/)
  assert.doesNotMatch(riskFixed[0]!.markdown,/影响可能显著/)
  const financial=[{id:'financial-quality',markdown:'结构化净利润口径应计代理为0.89%，其分子利润归属范围不清，且与合并现金流、总资产口径可能不同；该代理不是标准应计比率，不能单独证明盈余管理。经营现金净流量同比下降4.6490%。'}]
  const fixed=reconcileCompanyFinancialScopeLimitations({sections:financial})
  assert.match(fixed[0]!.markdown,/不计算或解释应计比率/)
  assert.match(fixed[0]!.markdown,/包含并购并表/)
  assert.doesNotMatch(fixed[0]!.markdown,/结构化净利润口径应计代理为0\.89%/)
})

test('risk matrix retains disclosed annual customer concentration ratios while scoping identity and product-mapping gaps',()=>{
  const method={skillId:'company_risk_analysis',status:'complete',executionEvidence:[{sourceCandidateId:'annual',title:'2025年年度报告',publisher:'Company',excerpts:[
    {sourceCandidateId:'annual',location:'paragraph:965',text:'前五名客户合计销售金额占年度销售总额比例 64.33%'},
    {sourceCandidateId:'annual',location:'paragraph:969',text:'1 第一名 18,642,838,150.75 46.46%'},
    {sourceCandidateId:'annual',location:'paragraph:970',text:'2 第二名 2,809,002,571.15 7.00%'}
  ]}]} as unknown as CompanyResearchMethodResult
  const sections=[{id:'risks',markdown:'| 客户集中 | 采购收缩→收入及产能受压 | 未披露 | 所给候选摘录没有客户明细、客户身份或客户与产品/产能映射，无法量化最大客户冲击及产能影响；不能以其他年度材料替代该缺口。 |'}]
  const result=reconcileCompanyRiskBoundaries({sections,methodResults:[method]})[0]!.markdown
  assert.match(result,/2025年度前五名客户销售占比64\.33%，第一名占46\.46%、第二名占7\.00%/)
  assert.match(result,/客户身份匿名，产品\/产能映射和合同替代性仍未披露/)
  assert.match(result,/比例本身可核验/)
  for(const paragraph of [965,969,970])assert.match(result,new RegExp(`\\[annual@paragraph:${paragraph}\\]`))
})

test('interim revenue claims drop colliding locators from older annual filings',()=>{
  const sections=[{id:'revenue-profit-drivers',markdown:'2026年上半年半年度报告分行业毛利率变化为-2.67%。[annual24@paragraph:728] [interim26@paragraph:728]',sourceCandidateIds:['annual24','interim26']}]
  const method={skillId:'business_driver_analysis',status:'complete',executionEvidence:[
    {sourceCandidateId:'annual24',title:'2024年年度报告',publisher:'Company',excerpts:[{sourceCandidateId:'annual24',location:'paragraph:728',text:'日用电子器件制造业 2024年度'}]},
    {sourceCandidateId:'interim26',title:'2026年半年度报告',publisher:'Company',excerpts:[{sourceCandidateId:'interim26',location:'paragraph:728',text:'日用电子器件制造业 2026年上半年'}]}
  ]} as unknown as CompanyResearchMethodResult
  const fixed=reconcileCompanyProductRevenueCostGrowth({sections,methodResults:[method]})[0]!
  assert.doesNotMatch(fixed.markdown,/\[annual24@paragraph:728\]/)
  assert.match(fixed.markdown,/\[interim26@paragraph:728\]/)
})

test('risk reconciliation removes unsupported zero impairment and preserves a named competitor route candidate',()=>{
  const sections=[
    {id:'competition',markdown:'宁德时代将乘用车列为解决方案，并描述超快充电池路线。[catl@paragraph:35] [catl@paragraph:249]',sourceCandidateIds:['catl']},
    {id:'risks',markdown:'| 竞争 | 风险影响 | 指标 | 缓释 | 材料没有同口径竞品业绩、产品路线或市场份额数据，不能验证相对优势。 | Juno Newco商誉原值人民币千元4,361,657，减值准备人民币千元0（该标的减值准备表未列示金额）。[interim@paragraph:4821] [interim@paragraph:4823] |',sourceCandidateIds:['interim']}
  ]
  const fixed=reconcileCompanyRiskBoundaries({sections})[1]!
  assert.match(fixed.markdown,/虽识别宁德时代乘用车电池超快充路线这一候选对照/)
  assert.match(fixed.markdown,/仍缺少同口径竞品业绩、价格、成本、市场份额及客户重叠数据/)
  assert.doesNotMatch(fixed.markdown,/减值准备人民币千元\s*0/)
  assert.match(fixed.markdown,/减值准备金额未在当前摘录中确认/)
  assert.match(fixed.markdown,/\[catl@paragraph:249\]/)
})

test('structured year-over-year monitoring growth is cited to the structured financial source, not the prior-year-end balance rows',()=>{
  const sections=[
    {id:'financial-quality',markdown:'财务说明。'},
    {id:'monitoring-checklist',markdown:'应收余额同比增速76.5716%、存货余额同比增速78.1743%、收入累计流量同比增速63.9482%；[interim@paragraph:824]这是余额与流量的跨口径筛查，不证明因果。[akshare-financial-002384@paragraph:1]'}
  ]
  const method={skillId:'financial_quality_analysis',status:'complete',executionEvidence:[
    {sourceCandidateId:'interim',title:'2026年半年度报告',publisher:'Company',excerpts:[{sourceCandidateId:'interim',location:'paragraph:824',text:'应收账款 10,598,328,021.04 15.32% 9,792,745,060.06 16.25% -0.93%'},{sourceCandidateId:'interim',location:'paragraph:825',text:'存货 11,417,997,322.49 16.51% 8,928,944,182.01 14.82% 1.69%'}]},
    {sourceCandidateId:'akshare-financial-002384',title:'结构化财务历史',publisher:'AKShare',excerpts:[{sourceCandidateId:'akshare-financial-002384',location:'paragraph:1',text:'{"metrics":{"receivables":10598328021.04,"inventory":11417997322.49}}'}]}
  ]} as unknown as CompanyResearchMethodResult
  const fixed=reconcileCompanyFinancialScopeLimitations({sections,methodResults:[method]})
  const monitoring=fixed.find(item=>item.id==='monitoring-checklist')!.markdown
  assert.match(monitoring,/收入累计流量同比增速63\.9482% \[akshare-financial-002384@paragraph:1\]/)
  assert.doesNotMatch(monitoring,/应收余额同比增速[^\n]*\[interim@paragraph:824\]/)
  assert.doesNotMatch(monitoring,/存货余额同比增速[^\n]*\[interim@paragraph:825\]/)
  assert.match(monitoring,/应收余额同比增速[^\n]*存货余额同比增速[^\n]*收入累计流量同比增速[^\n]*\[akshare-financial-002384@paragraph:1\]/)
})

test('risk matrix uses researched competitor candidates without claiming verified direct competition',()=>{
  const sections=[
    {id:'risks',markdown:'| 竞争风险 | 本次材料没有具名竞争者、产品路线、份额或可比成本/毛利数据，不能判断竞争地位或量化竞争冲击。 |'},
    {id:'competition',markdown:'中际旭创是光模块行业具名对照，东山精密路线另有EML、DFB产品。[industry@paragraph:55]'}
  ]
  const fixed=reconcileCompanyRiskBoundaries({sections})
  assert.match(fixed[0]!.markdown,/竞争章节已识别中际旭创等具名对照及光模块\/EML产品路线/)
  assert.match(fixed[0]!.markdown,/直接竞争关系、可比市场份额和成本\/毛利数据尚未证实/)
  assert.match(fixed[0]!.markdown,/\[industry@paragraph:55\]/)
})

test('cross-section reconciliation removes false evidence gaps, scopes customer evidence, and balances financial summary',()=>{
  const methods=[
    {skillId:'business_model_map',status:'complete',markdown:'产品和行业。',sections:[],findings:[],sourceCandidateIds:['interim'],limitations:[],risks:[],diagnostics:[],attempts:1,answer:'',executionEvidence:[{sourceCandidateId:'interim',title:'2026年半年度报告',publisher:'Company',excerpts:[{sourceCandidateId:'interim',location:'paragraph:773',text:'分产品'},{sourceCandidateId:'interim',location:'paragraph:774',text:'电子电路产品 12,529,627,775.53 45.07%'}]}]},
    {skillId:'financial_quality_analysis',status:'complete',markdown:'# 财务质量分析 最新半年累计收入和营业利润增长，净利润（归母属性未注明）增长；经营现金流同比下降。[akshare-financial-002384@paragraph:1]',sections:[],findings:[],sourceCandidateIds:['akshare-financial-002384'],limitations:[],risks:[],diagnostics:[],attempts:1,answer:''}
  ] as unknown as CompanyResearchMethodResult[]
  const sections=[
    {id:'revenue-profit-drivers',markdown:'## 收入与利润\n产品表并未提供同表完整收入行、同比行及合并收入桥的全部内容，不能把个别产品同比简单相加为合并贡献，也不能据此确认量、价或纯组合效应。',sourceCandidateIds:[]},
    {id:'growth-drivers',markdown:'分产品表没有在本次摘录中完整呈现全部匹配行、表头与比较期间数据，因此不补写其余产品的量价贡献，也不将增长等同于利润增量。',sourceCandidateIds:[]},
    {id:'products',markdown:'本次产品资料没有客户调研、访谈、反馈或可观察购买行为，未有客户需求调研/反馈验证。产品应用和公司定位不能证明客户实际关注或偏好；成本、性能、可靠性、交付等只能作为待验证的潜在购买因素。公司关于需求旺盛的表述应视为公司判断，而不是独立客户事实。[official-296fff2b2889c26f@paragraph:1806] [official-296fff2b2889c26f@paragraph:1807]\n2025年年度产品收入25,620,292,915.99元、毛利率17.59%；年度报告列示其收入同比增减3.30%、毛利率比上年同期增减-0.75%。',sourceCandidateIds:[]}
  ]
  const fixed=reconcileCompanyCrossSectionBoundaries({sections,methodResults:methods})
  assert.match(fixed.find(section=>section.id==='revenue-profit-drivers')!.markdown,/同期间财务方向并列：\*\*最新半年累计收入和营业利润增长，净利润（归母属性未注明）增长；经营现金流同比下降/)
  assert.doesNotMatch(fixed.find(section=>section.id==='revenue-profit-drivers')!.markdown,/产品表并未提供同表完整收入行/)
  assert.match(fixed.find(section=>section.id==='growth-drivers')!.markdown,/半年报分产品表已列示电子电路、精密组件、光模块及显示模组/)
  const product=fixed.find(section=>section.id==='products')!.markdown
  assert.match(product,/公司披露与部分客户开展协同设计、并在产品开发早期参与/)
  assert.match(product,/不是独立客户访谈、终端购买偏好或可观察采购行为/)
  assert.match(product,/2025年分产品表水平值：营业收入25,620,292,915\.99元、毛利率水平17\.59%；表内同比变化列/)
})
test('product section scopes annual optical-data gap and identifies the interim gross-margin row as cost, not prior-year revenue',()=>{
  const method={skillId:'product_technology_analysis',status:'complete',executionEvidence:[{sourceCandidateId:'interim',title:'2026年半年度报告',publisher:'Company',excerpts:[
    {sourceCandidateId:'interim',location:'paragraph:765',text:'单位：元'},
    {sourceCandidateId:'interim',location:'paragraph:766',text:'本报告期 上年同期'},
    {sourceCandidateId:'interim',location:'paragraph:768',text:'金额 占营业收入比重 金额 占营业收入比重'},
    {sourceCandidateId:'interim',location:'paragraph:773',text:'分产品'},
    {sourceCandidateId:'interim',location:'paragraph:776',text:'光模块 5,350,999,299.05 19.25%'},
    {sourceCandidateId:'interim',location:'paragraph:784',text:'单位：元'},
    {sourceCandidateId:'interim',location:'paragraph:785',text:'营业收入 营业成本 毛利率'},
    {sourceCandidateId:'interim',location:'paragraph:799',text:'光模块 5,350,999,299.05 3,246,496,191.23 39.33%'}
  ]}]} as unknown as CompanyResearchMethodResult
  const sections=[{id:'products',markdown:'2025年产品表未披露光模块同比数据。'}]
  const result=reconcileCompanyCrossSectionBoundaries({sections,methodResults:[method]})[0]!.markdown
  assert.match(result,/2026年上半年分产品收入表列示光模块收入5,350,999,299\.05元、占营业收入19\.25%/)
  assert.match(result,/3,246,496,191\.23元是营业成本而非上年同期收入/)
  assert.match(result,/2025年度年报行未列同比也仅限该年度报告口径/)
  assert.match(result,/不能据此计算光模块收入同比/)
  for(const paragraph of [765,766,768,773,776,784,785,799])assert.match(result,new RegExp(`\\[interim@paragraph:${paragraph}\\]`))
})
test('product matrix uses one interim period for revenue, cost, and margin instead of mixing half-year and annual values',()=>{
  const excerpt=(location:string,text:string)=>({sourceCandidateId:'interim',location,text})
  const rows=[
    excerpt('paragraph:774','电子电路产品 12,529,627,775.53 45.07%'),excerpt('paragraph:775','精密组件产品 6,580,692,901.95 23.67%'),excerpt('paragraph:776','光模块 5,350,999,299.05 19.25%'),excerpt('paragraph:777','光电显示模组 2,723,476,776.77 9.80%'),
    excerpt('paragraph:797','电子电路产品 12,529,627,775.53 10,174,431,182.90 18.80%'),excerpt('paragraph:798','精密组件产品 6,580,692,901.95 5,782,359,541.79 12.13%'),excerpt('paragraph:799','光模块 5,350,999,299.05 3,246,496,191.23 39.33%'),excerpt('paragraph:800','光电显示模组 2,723,476,776.77 2,563,023,488.98 5.89%'),
    ...[765,766,767,768,773,784,785,786,787,788,789,790,791,796].map(n=>excerpt(`paragraph:${n}`,n===773||n===796?'分产品':n===765||n===784?'单位：元':n===785?'营业收入 营业成本 毛利率':'本报告期 上年同期'))
  ]
  const method={skillId:'product_technology_analysis',status:'complete',executionEvidence:[{sourceCandidateId:'interim',title:'2026年半年度报告',publisher:'Company',excerpts:rows}]} as unknown as CompanyResearchMethodResult
  const prior='| 产品 | 主要应用/公司定位 | 技术路线或产品差异 | 收入（元） | 营业成本（元） | 毛利率 | 商业化与替代比较 |\n|---|---|---|---:|---:|---:|---|\n| 电子电路产品 | PCB制造 | 高频高速 | 2026上半年12,529,627,775.53；2025全年25,620,292,915.99 | 2026上半年10,174,431,182.90；2025全年21,113,572,455.81 | 18.80%；17.59% | 已商业化 |\n\n#### 年报披露的产品收入结构（2025年）'
  const result=reconcileCompanyCrossSectionBoundaries({sections:[{id:'products',markdown:prior}],methodResults:[method]})[0]!.markdown
  assert.match(result,/2026年上半年营业收入（元） \| 2026年上半年营业成本（元） \| 2026年上半年毛利率/)
  assert.match(result,/\| 光模块 \|[^\n]*5,350,999,299\.05[^\n]*3,246,496,191\.23[^\n]*39\.33%/)
  assert.doesNotMatch(result,/2025全年25,620,292,915\.99/)
})

test('R161 rebuilds missing split growth headers from the same acquired official report before computing product direction gaps',()=>{
  const lines=Array.from({length:734},()=> '')
  lines[715]='单位：元';lines[716]='营业收入 营业成本 毛利率';lines[717]='营业收入';lines[718]='比上年同';lines[719]='期增减';lines[720]='营业成本';lines[721]='比上年同';lines[722]='期增减';lines[723]='毛利率比';lines[724]='上年同期';lines[725]='增减';lines[730]='分产品';lines[731]='电子及其他产品 69,404,994,000.00 65,907,931,000.00 5.04% 0.96% 3.88% -2.67%';lines[732]='汽车、汽车相关产品及';lines[733]='其他产品 275,341,358,000.00 213,863,297,000.00 22.33% -8.98% -11.24% 1.98%'
  const packet={sourceCandidateId:'interim',title:'2026年半年度报告',excerpts:[{sourceCandidateId:'interim',location:'paragraph:733',text:lines[732]},{sourceCandidateId:'interim',location:'paragraph:734',text:lines[733]}]}
  const method={skillId:'business_driver_analysis',status:'complete',executionEvidence:[packet]} as unknown as CompanyResearchMethodResult
  const sections=[{id:'revenue-profit-drivers',markdown:'## 收入与利润\n基础观察。[interim@paragraph:733]\n\n### 毛利与成本链路\n成本解释有限。',sourceCandidateIds:['interim']},{id:'growth-drivers',markdown:'驱动因素。',sourceCandidateIds:['interim']}]
  const fixed=reconcileCompanyProductRevenueCostGrowth({sections,methodResults:[method],sources:[{candidate:{candidateId:'interim'},title:'2026年半年度报告',content:lines.join('\n')} ]})
  const text=fixed.find(item=>item.id==='revenue-profit-drivers')!.markdown
  assert.match(text,/电子及其他产品同一报告期营业收入同比增长0\.96%，营业成本同比增长3\.88%/)
  assert.match(text,/0\.96%−3\.88%＝-2\.92个百分点/)
  assert.match(text,/汽车、汽车相关产品及其他产品同一报告期营业收入同比下降8\.98%，营业成本同比下降11\.24%/)
  assert.match(text,/\(-8\.98%\)−\(-11\.24%\)＝2\.26个百分点/)
  for(const n of [716,717,718,719,720,721,722,723,724,725,726,731,732,733,734])assert.ok(text.includes(`[interim@paragraph:${n}]`),`paragraph ${n} is cited`)
  const fused='| 指标 | 本期 | 说明 |\n|---|---|---|\n| 合并收入 | 3448.15亿元 | 2026年上半年电子及其他产品收入0.96%、成本3.88%、毛利变化-2.67%。[interim@paragraph:732] |'
  const preserved=reconcileCompanyProductRevenueCostGrowth({sections:[{id:'revenue-profit-drivers',markdown:fused,sourceCandidateIds:['interim']}],methodResults:[method],sources:[{candidate:{candidateId:'interim'},title:'2026年半年度报告',content:lines.join('\n')}]})[0]!.markdown
  assert.ok(preserved.includes('| 合并收入 | 3448.15亿元 |'),'stale narrative cleanup must never delete a whole financial table row')
  assert.ok(preserved.includes('[interim@paragraph:732]'))
})
test('cross-section product narrative replaces an unsupported direction claim with exact comparable values and formula',()=>{
  const method={skillId:'business_model_map',status:'complete',executionEvidence:[{sourceCandidateId:'annual-2025',title:'2025年年度报告',publisher:'Company',excerpts:[{sourceCandidateId:'annual-2025',location:'paragraph:873',text:'电子电路产品 25,620,292,915.99 63.85% 24,800,813,670.87 67.45% 3.30%'}]}]} as unknown as CompanyResearchMethodResult
  const sections=[{id:'products',markdown:'对照前一年度，电子电路产品收入增加且毛利率仍较高。'}]
  const result=reconcileCompanyCrossSectionBoundaries({sections,methodResults:[method]})[0]!.markdown
  assert.match(result,/收入由24,800,813,670\.87元增至25,620,292,915\.99元/)
  assert.match(result,/（25,620,292,915\.99−24,800,813,670\.87）÷24,800,813,670\.87×100%＝3\.30%/)
  assert.match(result,/\[annual-2025@paragraph:873\]/)
  assert.doesNotMatch(result,/收入增加且毛利率仍较高/)
})
test('revenue-driver wording does not present product mix as an established cause of consolidated profit movement',()=>{
  const result=reconcileCompanyCrossSectionBoundaries({sections:[{id:'revenue-profit-drivers',markdown:'收入扩张及分产品毛利结构有关。'}],methodResults:[]})[0]!.markdown
  assert.match(result,/仅提供业务层面的观察线索/)
  assert.match(result,/缺少可勾稽至合并利润变化的量化桥/)
  assert.doesNotMatch(result,/收入扩张及分产品毛利结构有关/)
})
test('competition and monitoring wording scopes a disclosed tender-share target as a development target rather than a won contract',()=>{
  const sections=[{id:'competition',markdown:'东山项目目标为设备商集采 [official-39e591fa149e4543@paragraph:1293]'}]
  const result=reconcileCompanyCrossSectionBoundaries({sections,methodResults:[]})[0]!.markdown
  assert.match(result,/公司披露的开发目标是拓展主流设备商集采中标份额/)
  assert.match(result,/不代表已中标或已实现市场份额/)
  assert.match(result,/\[official-39e591fa149e4543@paragraph:1294\]/)
})

test('industry forecast period reconciliation uses only exact cited horizons from the market method packet', () => {
  const method: CompanyResearchMethodResult = {
    skillId:'market_structure_analysis',status:'complete',attempts:1,answer:'行业预测有明确期间。',markdown:'行业背景。',sections:[{id:'industry-exposure',markdown:'行业背景。'}],findings:[],sourceCandidateIds:['annual'],limitations:[],risks:[],diagnostics:[],
    executionEvidence:[{sourceCandidateId:'annual',title:'2025年年度报告',publisher:'Company',excerpts:[
      {sourceCandidateId:'annual',location:'paragraph:558',text:'分领域看，2025年全球服务器及存储领域市场规模为4130亿美元。'},
      {sourceCandidateId:'annual',location:'paragraph:559',text:'预计2026至2030年复合增长率为6%，2030年市场规模将达6300亿美元。'},
      {sourceCandidateId:'annual',location:'paragraph:574',text:'根据Lightcounting预测，全球数通光模块市场规模。'},
      {sourceCandidateId:'annual',location:'paragraph:575',text:'光模块市场规模2026年将达到228亿美元。'}
    ]}]
  }
  const refs = [558,559,574,575].map(paragraph=>`[annual@paragraph:${paragraph}]`).join(' ')
  const source = [{id:'industry-exposure',title:'行业暴露与市场结构',markdown:`| 全球服务器及存储市场 | 预测期末预测规模6300亿美元，预测复合增速6% | ${refs} |\n| 全球数通光模块 | 预测规模228亿美元 | ${refs} |`,sourceCandidateIds:['annual'],proposalIds:[]}]
  const fixed = reconcileCompanyIndustryForecastPeriods({sections:source,methodResults:[method]})
  assert.match(fixed[0]!.markdown,/2030年预测规模6300亿美元/)
  assert.match(fixed[0]!.markdown,/2026至2030年复合增速6%/)
  assert.match(fixed[0]!.markdown,/预测规模为2026年228亿美元/)
  const uncited = reconcileCompanyIndustryForecastPeriods({sections:[{...source[0]!,markdown:source[0]!.markdown.replaceAll(refs,'')}],methodResults:[method]})
  assert.doesNotMatch(uncited[0]!.markdown,/预测规模为2026年228亿美元/)
})
test('industry forecast reconciliation keeps the server end-market separate from related PCB output and produces a valid four-column table',()=>{
  const method={skillId:'market_structure_analysis',status:'complete',sourceCandidateIds:['annual'],executionEvidence:[{sourceCandidateId:'annual',title:'2025年年度报告',publisher:'Company',excerpts:[
    {sourceCandidateId:'annual',location:'paragraph:558',text:'2025年全球服务器及存储领域市场规模为4130亿美元，同比42%。'},
    {sourceCandidateId:'annual',location:'paragraph:559',text:'预计2026至2030年复合增长率为6%，2030年市场规模将达6300亿美元。与之对应，2025年服务器及存储相关PCB产'},
    {sourceCandidateId:'annual',location:'paragraph:560',text:'值约为160亿美元，同比增长46%；2025至2029年复合增长率预计为13%。'}
  ]}]} as unknown as CompanyResearchMethodResult
  const sections=[{id:'industry-exposure',sourceCandidateIds:['existing'],markdown:'## 市场边界\n| 市场 | 产品边界 | 地域与客户 | 公司角色 |\n|---|---|---|---|\n| 精密组件、显示及汽车相关 | 公司披露相关产品。 | 未提供细分市场数据。 | 公司参与制造。 | ## 行业规模背景 这些是年报转述的第三方行业预测，不是公司TAM；不同边界分别列示且不相加。 | 市场边界 | 规模、预测年份与单位 | 预测机构、披露归属 | 解释边界 |\n|---|---|---|---|\n| 全球服务器及存储设备 | 2025年4130亿美元；预计2026—2030年复合增长率6%，2030年6300亿美元。 | 年报转述。[annual@paragraph:558] [annual@paragraph:559] | 终端设备市场，不能作为公司部件TAM。 |\n| 全球数通光模块 | 2026年228亿美元。 | 年报转述。 | 与服务器设备市场边界不同。 |'}]
  const fixed=reconcileCompanyIndustryForecastPeriods({sections,methodResults:[method]})[0]!
  const result=fixed.markdown
  assert.match(result,/^## 行业规模背景$/m)
  assert.match(result,/服务器及存储终端市场 \| 2025年4130亿美元，同比增长42%/)
  assert.match(result,/全球服务器及存储相关PCB产值 \| 2025年约160亿美元，同比增长46%；2025—2029年复合增长率预计13%/)
  assert.match(result,/\[annual@paragraph:560\]/)
  assert.deepEqual(validateCompanyResearchMarkdownTables(result),[])
  assert.ok(fixed.sourceCandidateIds?.includes('annual'))
})

test('industry forecast reconciliation adds the available related-PCB forecast when synthesis omitted its row',()=>{
  const method={skillId:'market_structure_analysis',status:'complete',sourceCandidateIds:['annual'],executionEvidence:[{sourceCandidateId:'annual',title:'2025年年度报告',publisher:'Company',excerpts:[
    {sourceCandidateId:'annual',location:'paragraph:558',text:'2025年全球服务器及存储领域市场规模为4130亿美元，同比42%。'},
    {sourceCandidateId:'annual',location:'paragraph:559',text:'预计2026至2030年复合增长率为6%，2030年市场规模将达6300亿美元。与之对应，2025年服务器及存储相关PCB产'},
    {sourceCandidateId:'annual',location:'paragraph:560',text:'值约为160亿美元，同比增长46%；2025至2029年复合增长率预计为13%。'}
  ]}]} as unknown as CompanyResearchMethodResult
  const sections=[{id:'industry-exposure',markdown:'## 行业规模背景\n预测背景。\n| 市场边界 | 预测规模/期间 | 预测机构与披露归属 | 可比性与限制 |\n|---|---|---|---|\n| 全球服务器及存储设备 | 2025年4130亿美元；预计2026—2030年复合增长率6%，2030年6300亿美元 | 年报转述 | 终端市场，不是PCB市场。[annual@paragraph:558] [annual@paragraph:559] |'}]
  const once=reconcileCompanyIndustryForecastPeriods({sections,methodResults:[method]})[0]!.markdown
  assert.match(once,/服务器及存储终端市场[^\n]*4130亿美元/)
  assert.match(once,/服务器及存储相关PCB产值 \| 2025年约160亿美元，同比增长46%；2025—2029年复合增长率预计13%/)
  assert.match(once,/\[annual@paragraph:559\] \[annual@paragraph:560\]/)
  assert.deepEqual(validateCompanyResearchMarkdownTables(once),[])
  const twice=reconcileCompanyIndustryForecastPeriods({sections:[{...sections[0]!,markdown:once}],methodResults:[method]})[0]!.markdown
  assert.equal(twice.match(/服务器及存储相关PCB产值/g)?.length,1)
})

test('industry forecast explicitly separates the 2025 base value from the 2026-2030 forecast period',()=>{
  const method={skillId:'market_structure_analysis',status:'complete',sourceCandidateIds:['annual'],executionEvidence:[{sourceCandidateId:'annual',title:'2025年年度报告',publisher:'Company',excerpts:[
    {sourceCandidateId:'annual',location:'paragraph:558',text:'2025年全球服务器及存储领域市场规模为4130亿美元，同比42%。'},
    {sourceCandidateId:'annual',location:'paragraph:559',text:'预计2026至2030年复合增长率为6%，2030年市场规模将达6300亿美元。'},
  ]}]} as unknown as CompanyResearchMethodResult
  const row='| 全球服务器及存储市场 | 2025年4130亿美元；2030年预计6300亿美元；2026—2030年复合增长率6% | 年报转述 | 不是公司TAM。[annual@paragraph:558] [annual@paragraph:559] |'
  const fixed=reconcileCompanyIndustryForecastPeriods({sections:[{id:'industry-exposure',markdown:`## 行业规模背景\n| 市场边界 | 预测值 | 预测机构及归属 | 可比性说明 |\n|---|---|---|---|\n${row}`}],methodResults:[method]})[0]!
  assert.match(fixed.markdown,/2025年基期4130亿美元；2026—2030年预测复合增长率6%，2030年预计6300亿美元。来源未提供2026年基期金额，因此不补算该数值/)
})

test('official industry row gets a reproducible revenue-cost growth spread distinct from gross-margin change',()=>{
  const excerpts=[
    {sourceCandidateId:'interim',location:'paragraph:784',text:'单位：元'},
    {sourceCandidateId:'interim',location:'paragraph:785',text:'营业收入 营业成本 毛利率'},
    {sourceCandidateId:'interim',location:'paragraph:786',text:'营业收入比上'},
    {sourceCandidateId:'interim',location:'paragraph:787',text:'年同期增减'},
    {sourceCandidateId:'interim',location:'paragraph:788',text:'营业成本比上'},
    {sourceCandidateId:'interim',location:'paragraph:789',text:'年同期增减'},
    {sourceCandidateId:'interim',location:'paragraph:790',text:'毛利率比上'},
    {sourceCandidateId:'interim',location:'paragraph:791',text:'年同期增减'},
    {sourceCandidateId:'interim',location:'paragraph:792',text:'分行业'},
    {sourceCandidateId:'interim',location:'paragraph:793',text:'计算机、通信和'},
    {sourceCandidateId:'interim',location:'paragraph:794',text:'其他电子'},
    {sourceCandidateId:'interim',location:'paragraph:795',text:'27,347,867,868.08 21,929,134,042.30 19.81% 63.21% 51.01% 6.48%'},
  ]
  const method={skillId:'business_driver_analysis',status:'complete',executionEvidence:[{sourceCandidateId:'interim',title:'2026年半年度报告',publisher:'CNINFO',excerpts}]} as unknown as CompanyResearchMethodResult
  const sections=[{id:'revenue-profit-drivers',markdown:'分行业表显示收入增速高于成本增速，毛利率同比增减为正。[interim@paragraph:795]'}]
  const fixed=reconcileCompanyIndustryGrowthSpread({sections,methodResults:[method]})[0]!
  assert.match(fixed.markdown,/63\.21%−51\.01%＝12\.20个百分点/)
  assert.match(fixed.markdown,/不等于毛利率变动/)
  assert.match(fixed.markdown,/毛利率同比增减6\.48%，沿用原表单位/)
  for(const paragraph of [784,785,786,787,788,789,790,791,792,793,794,795])assert.match(fixed.markdown,new RegExp(`\\[interim@paragraph:${paragraph}\\]`))
  assert.equal(reconcileCompanyIndustryGrowthSpread({sections:[fixed],methodResults:[method]})[0]!.markdown,fixed.markdown)
})

test('direction words follow the sign of same-unit numeric movement',()=>{
  const fixed=reconcileCompanyNumericMovementVerbs([
    {id:'growth-drivers',markdown:'半年收入169.55亿元降至277.98亿元；现金流25.00亿元升至23.84亿元；净利率由4.47%降至10.64%。'},
    {id:'risks',markdown:'该风险段落不修改。'},
  ])
  assert.match(fixed[0]!.markdown,/169\.55亿元升至277\.98亿元/)
  assert.match(fixed[0]!.markdown,/25\.00亿元降至23\.84亿元/)
  assert.match(fixed[0]!.markdown,/由4\.47%升至10\.64%/)
  assert.equal(fixed[1]!.markdown,'该风险段落不修改。')
})

test('exact annual product rows attach their source locator inside the matching Markdown data cell',()=>{
  const packet={sourceCandidateId:'annual',title:'2025年年度报告',publisher:'CNINFO',excerpts:[
    {sourceCandidateId:'annual',location:'paragraph:862',text:'营业收入构成'},
    {sourceCandidateId:'annual',location:'paragraph:863',text:'单位：元'},
    {sourceCandidateId:'annual',location:'paragraph:864',text:'2025 年 2024 年'},
    {sourceCandidateId:'annual',location:'paragraph:865',text:'同比增减'},
    {sourceCandidateId:'annual',location:'paragraph:866',text:'金额 占营业收入比重 金额 占营业收入比重'},
    {sourceCandidateId:'annual',location:'paragraph:876',text:'光模块 1,435,534,921.96 3.58%'},
    {sourceCandidateId:'annual',location:'paragraph:895',text:'分产品'},
    {sourceCandidateId:'annual',location:'paragraph:896',text:'营业收入 营业成本 毛利率'},
    {sourceCandidateId:'annual',location:'paragraph:899',text:'光模块 1,435,534,921.96 908,137,144.50 36.74%'},
  ]}
  const method={skillId:'business_model_map',status:'complete',executionEvidence:[packet]} as unknown as CompanyResearchMethodResult
  const sections=[
    {id:'business-segments',markdown:'| 产品 | 2025营业收入（元） | 2025占比 | 2024营业收入（元） | 2024占比 |\n|---|---:|---:|---:|---:|\n| 光模块 | 1,435,534,921.96 | 3.58% | 未列示 | 未列示 |'},
    {id:'products',markdown:'| 产品 | 经营与技术信息 | 规格 | 收入、成本与毛利 | 竞争边界 |\n|---|---|---|---|---|\n| 光模块 | 公司披露产品 | 400G/800G | 2025年收入1,435,534,921.96元、成本908,137,144.50元、毛利率36.74% | 同口径数据缺失 |'},
  ]
  const fixed=reconcileCompanyProductRevenueRowCitations({sections,methodResults:[method]})
  const segmentRow=fixed.find(item=>item.id==='business-segments')!.markdown.split('\n')[2]!
  const productRow=fixed.find(item=>item.id==='products')!.markdown.split('\n')[2]!
  assert.match(segmentRow,/\|\s*1,435,534,921\.96[^|]*\[annual@paragraph:876\]\s*\|/)
  assert.match(productRow,/36\.74%[^|]*\[annual@paragraph:899\][^|]*\|/)
  assert.doesNotMatch(productRow,/\|\s*\[annual@paragraph:899\]/)
})

test('financial quality replaces the unsupported interim non-recurring-loss absence with the official statement and keeps development spending scoped',()=>{
  const content=[
    '六、非经常性损益项目及金额','适用 □不适用','单位：元','项目 金额 说明',
    '非流动性资产处置损益 -6,925,770.36','计入当期损益的政府补助 115,191,692.39','合计 477,317,288.78',
    '3、合并资产负债表','单位：元','项目 期末余额 期初余额','开发支出 45,633,398.23 41,694,639.16',
  ].join('\n')
  const input=[{id:'financial-quality',sourceCandidateIds:['akshare'],markdown:'一次性项目及研发资本化方面，本轮材料没有足以归因本期半年利润变化的明确非经常损益拆分，也没有半年报研发资本化金额的直接披露行；年度报告数字不能替代半年数据。故不能判断本期利润变化有多少来自一次性项目，或研发资本化是否改变利润与现金关系。应补充核对半年报非经常损益附注、研发费用化/资本化明细及相关会计政策。'}]
  const fixed=reconcileCompanyNonRecurringDisclosure({sections:input,sources:[{candidate:{candidateId:'interim',kind:'official_disclosure',publishedAt:'2026-08-22'},title:'2026年半年度报告',content}]})[0]!
  assert.doesNotMatch(fixed.markdown,/本轮材料没有足以归因本期半年利润变化的明确非经常损益拆分/)
  assert.match(fixed.markdown,/非经常性损益项目及金额标注为“适用”/)
  assert.match(fixed.markdown,/合计477,317,288\.78元/)
  assert.match(fixed.markdown,/“开发支出”期末余额45,633,398\.23元、期初余额41,694,639\.16元/)
  assert.match(fixed.markdown,/不等于当期资本化研发投入/)
  for(const paragraph of [1,2,3,4,7,8,9,10,11]) assert.match(fixed.markdown,new RegExp(`\\[interim@paragraph:${paragraph}\\]`))
})

test('industry denial of any named comparator is narrowed when the competitive method has a cited candidate',()=>{
  const candidate:CompanyResearchMethodResult={skillId:'competitive_market_map',status:'complete',attempts:1,answer:'鹏鼎控股是汽车FPC具名候选。',markdown:'鹏鼎控股是候选。',sections:[],findings:[{text:'鹏鼎控股是汽车FPC具名候选，其公开资料披露应用于汽车电池板。',kind:'fact',evidence:[{sourceCandidateId:'public-web-peer',location:'paragraph:1'}]}],sourceCandidateIds:['public-web-peer'],limitations:[],risks:[],diagnostics:[],executionEvidence:[{sourceCandidateId:'public-web-peer',title:'鹏鼎控股汽车FPC产品资料',publisher:'公开资料',excerpts:[{sourceCandidateId:'public-web-peer',location:'paragraph:1',text:'鹏鼎控股披露其产品包含应用于汽车电池板的FPC。'}]}]}
  const section={id:'industry-exposure',markdown:'竞争分析同样缺乏可具名比较对象及其产品规格、价格、产能、份额和客户认证材料，不能宣称排名、领先幅度或份额。'}
  const fixed=reconcileCompanyCompetitorEvidence({sections:[section],methodResults:[candidate]})[0]!
  assert.doesNotMatch(fixed.markdown,/缺乏可具名比较对象/)
  assert.match(fixed.markdown,/鹏鼎控股/)
  assert.match(fixed.markdown,/同口径性能成本及市场份额仍未验证/)
  assert.match(fixed.markdown,/\[public-web-peer@paragraph:1\]/)
})

test('cross-method check rejects the observed Dongshan and BYD report contradictions verbatim', () => {
  const candidates = [
    { name: '中际旭创', answer: '中际旭创是有证据支持的候选对手。', denial: '未提供具名竞品、产品路线或可比经营指标。' },
    { name: '吉利', answer: '吉利是有材料支持的具名竞争者。', denial: '没有具名竞品、同口径路线及价格比较。' },
  ]
  for (const item of candidates) {
    const method: CompanyResearchMethodResult = { skillId: 'competitive_market_map', status: 'complete', attempts: 1, answer: item.answer, markdown: item.answer, sections: [{ id: 'competition', markdown: item.answer }], findings: [{ text: item.answer, kind: 'fact', evidence: [{ sourceCandidateId: 'annual-report', location: 'paragraph:1' }] }], sourceCandidateIds: ['annual-report'], limitations: [], risks: [], diagnostics: [] }
    const result = findKnownCompetitorDenials({ sections: [{ id: 'risks', markdown: item.denial }], methodResults: [method] })
    assert.deepEqual(result, [{ sectionId: 'risks', candidate: item.name }])
  }
})

test('R137 prepared-analysis reconciliation restores exact BYD segment revenue, NEV market context, and working-capital formulas', () => {
  const business: CompanyResearchMethodResult = {
    skillId:'business_model_map',status:'complete',attempts:1,answer:'业务收入结构。',markdown:'',sections:[],sourceCandidateIds:['annual'],limitations:[],risks:[],diagnostics:[],
    findings:[
      {text:'2025年汽车、汽车相关产品及其他产品收入648,645,636,000.00元，占营业收入80.68%；分产品标签和数据行对应报告汽车产品行。',kind:'fact',evidence:[{sourceCandidateId:'annual',location:'paragraph:821'},{sourceCandidateId:'annual',location:'paragraph:822'}]},
      {text:'2025年手机部件、组装及其他产品收入155,236,528,000.00元，占营业收入19.31%；该比例来自产品行而非地区或销售模式行。',kind:'fact',evidence:[{sourceCandidateId:'annual',location:'paragraph:819'},{sourceCandidateId:'annual',location:'paragraph:820'}]},
    ],
    executionEvidence:[{sourceCandidateId:'annual',title:'2025年年度报告',publisher:'Company',excerpts:[
      {sourceCandidateId:'annual',location:'paragraph:819',text:'手机部件、组装'},
      {sourceCandidateId:'annual',location:'paragraph:820',text:'及其他产品 155,236,528,000.00 19.31%'},
      {sourceCandidateId:'annual',location:'paragraph:821',text:'汽车、汽车相关'},
      {sourceCandidateId:'annual',location:'paragraph:822',text:'产品及其他产品 648,645,636,000.00 80.68%'}
    ]}]
  }
  const competitor: CompanyResearchMethodResult = {
    skillId:'competitive_market_map',status:'complete',attempts:1,answer:'吉利为具名候选。',markdown:'',sections:[],sourceCandidateIds:['public-web-geely'],limitations:[],risks:[],diagnostics:[],
    findings:[{text:'吉利公开品牌覆盖主流至豪华，并列有电池、电驱、辅助驾驶和智能座舱，属于乘用车候选对手；车型级重叠尚未证明。',kind:'fact',evidence:[{sourceCandidateId:'public-web-geely',location:'paragraph:95'}]}],
    executionEvidence:[{sourceCandidateId:'public-web-geely',title:'吉利产品资料',publisher:'公开资料',excerpts:[{sourceCandidateId:'public-web-geely',location:'paragraph:95',text:'吉利公开品牌覆盖主流至豪华，并列有电池、电驱、辅助驾驶和智能座舱。'}]}]
  }
  const market: CompanyResearchMethodResult = {
    skillId:'market_structure_analysis',status:'complete',attempts:1,answer:'行业数据。',markdown:'',sections:[],findings:[],sourceCandidateIds:['official-f6274e510499a654'],limitations:[],risks:[],diagnostics:[],
    executionEvidence:[{sourceCandidateId:'official-f6274e510499a654',title:'2024年年度报告',publisher:'Company',excerpts:[{sourceCandidateId:'official-f6274e510499a654',location:'paragraph:18',text:'中国新能源汽车全年销量达到 1,286.6 万辆，同比继续增长。'}]}]
  }
  const financial: CompanyResearchMethodResult = {
    skillId:'financial_quality_analysis',status:'complete',attempts:1,answer:'周转指标。',markdown:'',sections:[],findings:[],sourceCandidateIds:['akshare-financial'],limitations:[],risks:[],diagnostics:[],
    executionEvidence:[{sourceCandidateId:'akshare-financial',title:'Company financial history',publisher:'EastMoney',excerpts:[{sourceCandidateId:'akshare-financial',location:'paragraph:1',text:'{"metrics":{"receivables":50126342000,"inventory":189990772000,"payables":176356021000,"revenue":344815421000,"cogs":279826859000},"opening":{"receivables":37004685000,"inventory":138420580000,"payables":186742375000}}'}]}]
  }
  const rawSections=[
    {id:'business-segments',markdown:'## 分部\n未提供具名竞品及同口径价格、毛利、份额或交付资料，无法做竞争比较。',sourceCandidateIds:['annual']},
    {id:'industry-exposure',markdown:'本轮供给材料中没有可核验的中国新能源汽车行业销量数字定位；上一版所引用的官方年报段落并未出现在本轮实际摘录中，故不保留该数字。公司级TAM边界仍无法建立。',sourceCandidateIds:['official-market']},
    {id:'supply-chain',markdown:'应收周转22.87天、存货周转106.21天、应付周转117.43天、现金转换周期11.65天。',sourceCandidateIds:['akshare-financial']}
  ]
  const annualSourceLines=Array.from({length:18},()=> '其他年报披露。')
  annualSourceLines[17]='中国新能源汽车全年销量达到 1,286.6 万辆，同比增长。'
  const annualSource={candidate:{candidateId:'official-f6274e510499a654'},title:'2024年年度报告',content:annualSourceLines.join('\n')}
  const businessAndPeer=reconcileCompanyCompetitorEvidence({sections:rawSections,methodResults:[competitor]})
  const prepared=reconcileCompanyPreparedAnalysisFacts({sections:businessAndPeer,methodResults:[business,market,financial],preparedAnalysis:{
    marketSizing:{calculations:{status:'calculated',value:1286.6,unit:'万辆',formula:'2024年中国新能源汽车全年销量(1286.6 万辆)',marketBoundary:'2024年中国新能源汽车全年销量（历史行业销量规模，不代表比亚迪可服务市场或公司TAM）',asOf:'2024-12-31',evidence:[{sourceCandidateId:'official-f6274e510499a654',location:'paragraph:18'}]}},
    financial:{workingCapitalCalculations:[
      {metric:'DSO',period:'2026-06-30',daysInPeriod:181,value:22.868,formula:'((期初应收37,004,685,000元＋期末应收50,126,342,000元)÷2)÷本期累计收入344,815,421,000元×181天＝22.87天',sourceCandidateIds:['akshare-financial']},
      {metric:'DIO',period:'2026-06-30',daysInPeriod:181,value:106.213,formula:'((期初存货138,420,580,000元＋期末存货189,990,772,000元)÷2)÷本期累计营业成本279,826,859,000元×181天＝106.21天',sourceCandidateIds:['akshare-financial']},
      {metric:'DPO',period:'2026-06-30',daysInPeriod:181,value:117.431,formula:'((期初应付186,742,375,000元＋期末应付176,356,021,000元)÷2)÷本期累计营业成本279,826,859,000元×181天＝117.43天',sourceCandidateIds:['akshare-financial']},
      {metric:'CCC',period:'2026-06-30',daysInPeriod:181,value:11.650,formula:'DSO 22.87天＋DIO 106.21天−DPO 117.43天＝11.65天',sourceCandidateIds:['akshare-financial']}
    ]}
  },sources:[annualSource]})
  const segments=prepared.find(item=>item.id==='business-segments')!
  assert.match(segments.markdown,/汽车、汽车相关产品及其他产品收入648,645,636,000\.00元，占营业收入80\.68%/)
  assert.match(segments.markdown,/手机部件、组装及其他产品收入155,236,528,000\.00元，占营业收入19\.31%/)
  assert.match(segments.markdown,/吉利公开品牌覆盖主流至豪华/)
  assert.match(segments.markdown,/客户重叠|车型级重叠/)
  assert.doesNotMatch(segments.markdown,/未提供具名竞品/)
  assert.ok(segments.sourceCandidateIds?.includes('annual'))
  assert.ok(segments.sourceCandidateIds?.includes('public-web-geely'))
  for(const ref of ['annual@paragraph:821','annual@paragraph:822','annual@paragraph:819','annual@paragraph:820','public-web-geely@paragraph:95'])assert.ok(segments.markdown.includes(`[${ref}]`))

  const industry=prepared.find(item=>item.id==='industry-exposure')!
  assert.match(industry.markdown,/2024年中国新能源汽车全年销量为1,286\.6万辆/)
  assert.match(industry.markdown,/不代表比亚迪销量、份额或公司TAM/)
  assert.doesNotMatch(industry.markdown,/没有可核验的中国新能源汽车行业销量/)
  assert.ok(industry.sourceCandidateIds?.includes('official-f6274e510499a654'))
  assert.match(industry.markdown,/\[official-f6274e510499a654@paragraph:18\]/)

  const supply=prepared.find(item=>item.id==='supply-chain')!
  assert.match(supply.markdown,/\(\(期初应收37,004,685,000元＋期末应收50,126,342,000元\)÷2\).*×181天＝22\.87天/)
  assert.match(supply.markdown,/\(\(期初存货138,420,580,000元＋期末存货189,990,772,000元\)÷2\).*×181天＝106\.21天/)
  assert.match(supply.markdown,/\(\(期初应付186,742,375,000元＋期末应付176,356,021,000元\)÷2\).*×181天＝117\.43天/)
  assert.match(supply.markdown,/DSO 22\.87天＋DIO 106\.21天−DPO 117\.43天＝11\.65天/)
  assert.match(supply.markdown,/\[akshare-financial@paragraph:1\]/)
  assert.ok(supply.sourceCandidateIds?.includes('akshare-financial'))
  const repeated=reconcileCompanyPreparedAnalysisFacts({sections:prepared,methodResults:[business,market,financial],preparedAnalysis:{marketSizing:{calculations:{status:'calculated',value:1286.6,unit:'万辆',formula:'2024年中国新能源汽车全年销量(1286.6 万辆)',marketBoundary:'2024年中国新能源汽车全年销量（历史行业销量规模，不代表比亚迪可服务市场或公司TAM）',asOf:'2024-12-31',evidence:[{sourceCandidateId:'official-f6274e510499a654',location:'paragraph:18'}]}},financial:{workingCapitalCalculations:[]}},sources:[annualSource]})
  assert.equal(repeated.find(item=>item.id==='business-segments')!.markdown.match(/#### 2025年产品收入规模/g)?.length,1)
})
test('R137 prepared-analysis reconciliation fails closed when the bound source excerpt or calculation is absent',()=>{
  const value=[
    {id:'business-segments',markdown:'无业务数据。',sourceCandidateIds:[]},
    {id:'industry-exposure',markdown:'本轮供给材料中没有可核验的中国新能源汽车行业销量数字定位。',sourceCandidateIds:[]},
    {id:'supply-chain',markdown:'现金转换周期11.65天。',sourceCandidateIds:[]}
  ]
  const market:CompanyResearchMethodResult={skillId:'market_structure_analysis',status:'complete',attempts:1,answer:'',markdown:'',sections:[],findings:[],sourceCandidateIds:['official'],limitations:[],risks:[],diagnostics:[],executionEvidence:[{sourceCandidateId:'official',title:'年报',publisher:'Company',excerpts:[{sourceCandidateId:'official',location:'paragraph:18',text:'Other market data'}]}]}
  const financial:CompanyResearchMethodResult={skillId:'financial_quality_analysis',status:'complete',attempts:1,answer:'',markdown:'',sections:[],findings:[],sourceCandidateIds:['financial'],limitations:[],risks:[],diagnostics:[]}
  const result=reconcileCompanyPreparedAnalysisFacts({sections:value,methodResults:[market,financial],preparedAnalysis:{marketSizing:{calculations:{status:'calculated',value:1286.6,unit:'万辆',formula:'2024年中国新能源汽车全年销量',evidence:[{sourceCandidateId:'official',location:'paragraph:18'}]}},financial:{workingCapitalCalculations:[{metric:'CCC',period:'2026-06-30',daysInPeriod:181,value:11.65,formula:'DSO 22.87天＋DIO 106.21天−DPO 117.43天＝11.65天',sourceCandidateIds:['financial']}]}}})
  assert.deepEqual(result,value)
})
test('R138 pairs duplicate interim industry and product rows with their own headers before retaining product cost/margin',()=>{
  const driver:CompanyResearchMethodResult={skillId:'business_driver_analysis',status:'complete',attempts:1,answer:'分产品收入。',markdown:'',sections:[],findings:[],sourceCandidateIds:['official-c19c34dd239b2e9c'],limitations:[],risks:[],diagnostics:[],executionEvidence:[{sourceCandidateId:'official-c19c34dd239b2e9c',title:'2026年半年度报告',publisher:'CNINFO',excerpts:[
    {sourceCandidateId:'official-c19c34dd239b2e9c',location:'paragraph:727',text:'分行业'},
    {sourceCandidateId:'official-c19c34dd239b2e9c',location:'paragraph:728',text:'日用电子器件制造业 69,404,994,000.00 65,907,931,000.00 5.04% 0.96% 3.88% -2.67%'},
    {sourceCandidateId:'official-c19c34dd239b2e9c',location:'paragraph:731',text:'分产品'},
    {sourceCandidateId:'official-c19c34dd239b2e9c',location:'paragraph:732',text:'电子及其他产品 69,404,994,000.00 65,907,931,000.00 5.04% 0.96% 3.88% -2.67%'}
  ]}]}
  const input=[{id:'products',sourceCandidateIds:['official-c19c34dd239b2e9c'],markdown:'| 产品 | 期间 | 说明 | 收入 | 成本 | 毛利率 | 阶段 |\n|---|---|---|---:|---:|---:|---|\n| 电子及其他产品；2026年上半年 | 电子业务 | 制造 | 69,404,994,000.00 [official-c19c34dd239b2e9c@paragraph:706] | 65,907,931,000.00 [official-c19c34dd239b2e9c@paragraph:732] | 5.04%；-2.67% [official-c19c34dd239b2e9c@paragraph:732] | 已商业化 |\n| 汽车产品；2026年上半年 | 汽车 | 制造 | 10 | 8 | 20% | 已商业化 |'}]
  const fixed=reconcileCompanyPreparedAnalysisFacts({sections:input,methodResults:[driver]})[0]!
  const electronics=fixed.markdown.split('\n').find(line=>line.startsWith('| 电子及其他产品；2026年上半年'))!
  assert.match(electronics,/69,404,994,000\.00 \[official-c19c34dd239b2e9c@paragraph:706\]/)
  assert.match(electronics,/65,907,931,000\.00 \[official-c19c34dd239b2e9c@paragraph:731\] \[official-c19c34dd239b2e9c@paragraph:732\]/)
  assert.match(electronics,/5\.04%；-2\.67%（分产品原表口径） \[official-c19c34dd239b2e9c@paragraph:731\] \[official-c19c34dd239b2e9c@paragraph:732\]/)
  assert.match(fixed.markdown,/段落727—728为分行业表，段落731明确转入分产品表/)
  assert.match(fixed.markdown,/不能仅凭数值相同把分行业日用电子器件制造业一行并入产品口径/)
  for(const paragraph of [727,728,731,732])assert.ok(fixed.markdown.includes(`[official-c19c34dd239b2e9c@paragraph:${paragraph}]`))
  assert.match(fixed.markdown,/\| 汽车产品；2026年上半年 \| 汽车 \| 制造 \| 10 \| 8 \| 20% \| 已商业化 \|/)
  assert.ok(fixed.sourceCandidateIds?.includes('official-c19c34dd239b2e9c'))
})
test('R138 preserves sourced 2022 employee-plan repurchase while retaining only the acquisition evidence gap',()=>{
  const capital:CompanyResearchMethodResult={skillId:'capital_allocation_review',status:'complete',attempts:1,answer:'回购与并购。',markdown:'',sections:[],findings:[],sourceCandidateIds:['official-f7c8d23d2829a5e8'],limitations:[],risks:[],diagnostics:[],executionEvidence:[{sourceCandidateId:'official-f7c8d23d2829a5e8',title:'2025年年度报告',publisher:'CNINFO',excerpts:[
    {sourceCandidateId:'official-f7c8d23d2829a5e8',location:'paragraph:20',text:'本方法虽未取回历史回购段落，但官方年报完整正文已在本次来源中可用。'}
  ]}]}
  const source={candidate:{candidateId:'official-f7c8d23d2829a5e8'},title:'2025年年度报告',content:['封面','十五、股份支付','（1）2022年本集团之员工持股计划','公司通过回购专用证券账户累计回购 A 股股份的数量为 5,511,024 股，','占公司于本报告之日已发行股本的 0.1813%，并于 2022 年 6 月完成回购，2022 年 7 月完成过户登记。'].join('\n')}
  const input=[{id:'management-capital-allocation',sourceCandidateIds:['official-f7c8d23d2829a5e8'],markdown:'并购和回购缺少可核验的具体行动台账，以下不推定其发生或规模。\n\n并购方面，所给证据未显示可核验的并购交易金额、支付状态或标的级投入。'}]
  const fixed=reconcileCompanyPreparedAnalysisFacts({sections:input,methodResults:[capital],sources:[source]})[0]!
  assert.doesNotMatch(fixed.markdown,/并购和回购缺少可核验的具体行动台账/)
  assert.match(fixed.markdown,/并购方面，所给证据仍未显示可核验的并购交易金额、支付状态或标的级投入/)
  assert.match(fixed.markdown,/2022年员工持股计划累计回购A股5,511,024股，占报告日已发行股本0\.1813%/)
  assert.match(fixed.markdown,/2022年6月完成回购、同年7月完成过户登记/)
  for(const paragraph of [3,4,5])assert.ok(fixed.markdown.includes(`[official-f7c8d23d2829a5e8@paragraph:${paragraph}]`))
  assert.doesNotMatch(fixed.markdown,/paragraph:1195[5-8]/)
  assert.ok(fixed.sourceCandidateIds?.includes('official-f7c8d23d2829a5e8'))
  const again=reconcileCompanyPreparedAnalysisFacts({sections:[fixed],methodResults:[capital],sources:[source]})[0]!
  assert.equal(again.markdown.match(/2022年员工持股计划累计回购A股5,511,024股/g)?.length,1)
})
test('cross-method competitor consistency checks each denial clause even if a candidate appears later in the chapter', () => {
  const competitor: CompanyResearchMethodResult = { skillId: 'competitive_market_map', status: 'complete', attempts: 1, answer: '吉利是有材料支持的具名竞争者。', markdown: '吉利是已识别候选。', sections: [{ id: 'competition', markdown: '吉利是已识别候选。' }], findings: [{ text: '吉利是有材料支持的具名竞争者。', kind: 'fact', evidence: [{ sourceCandidateId: 'annual-report', location: 'paragraph:1' }] }], sourceCandidateIds: ['annual-report'], limitations: [], risks: [], diagnostics: [] }
  assert.deepEqual(findKnownCompetitorDenials({ sections: [{ id: 'risks', markdown: '客户集中度未核实。风险矩阵称没有具名竞品。后文已将吉利列为候选。' }], methodResults: [competitor] }), [{ sectionId: 'risks', candidate: '吉利' }])
})

test('R174 competitor carryover selects the located peer rather than the target and does not invent a connective entity', () => {
  const method: CompanyResearchMethodResult = {
    skillId:'competitive_market_map',status:'complete',attempts:1,answer:'故仅是候选竞争者，不能认定直接竞争。',markdown:'路线比较。',sections:[],
    findings:[
      {text:'比亚迪海豹采用插混路线。',kind:'fact',evidence:[{sourceCandidateId:'public-web-own',location:'paragraph:2'}]},
      {text:'吉利银河E8披露全域高压架构，是具名的纯电候选路线。',kind:'fact',evidence:[{sourceCandidateId:'public-web-peer',location:'paragraph:2'}]},
    ],sourceCandidateIds:['public-web-own','public-web-peer'],limitations:[],risks:[],diagnostics:[],executionEvidence:[
      {sourceCandidateId:'public-web-own',title:'比亚迪海豹',publisher:'BYD',evidenceScope:'company',excerpts:[{sourceCandidateId:'public-web-own',location:'paragraph:2',text:'比亚迪海豹采用插混路线。'}]},
      {sourceCandidateId:'public-web-peer',title:'吉利银河E8 官方车型与配置',publisher:'Geely',evidenceScope:'peer_company',excerpts:[
        {sourceCandidateId:'public-web-peer',location:'paragraph:1',text:'吉利银河E8'},
        {sourceCandidateId:'public-web-peer',location:'paragraph:2',text:'全域高压架构'},
      ]},
    ],
  }
  const raw=[{id:'technologies',markdown:'本节未提供具名竞品的同口径比较。[annual@paragraph:1]',sourceCandidateIds:['annual']}]
  const result=reconcileCompanyCompetitorEvidence({sections:raw,methodResults:[method]})
  assert.match(result[0]!.markdown,/吉利银河E8披露/)
  assert.match(result[0]!.markdown,/\[public-web-peer@paragraph:1\]/)
  assert.match(result[0]!.markdown,/\[public-web-peer@paragraph:2\]/)
  assert.doesNotMatch(result[0]!.markdown,/候选.*比亚迪海豹/)
  assert.deepEqual(findKnownCompetitorDenials({sections:result,methodResults:[method]}),[])
  assert.deepEqual(findKnownCompetitorDenials({sections:[{id:'risks',markdown:'没有具名竞品。'}],methodResults:[method]}),[])
  const phone='| 手机部件 | 本节产品资料未提供具名竞品的同口径比较。 |'
  const phoneResult=reconcileCompanyCompetitorEvidence({sections:[{id:'products',markdown:phone,sourceCandidateIds:[]}],methodResults:[method]})
  assert.equal(phoneResult[0]!.markdown.split('\n')[0],phone,'a car candidate must not be injected into a phone business row')
  assert.equal(reconcileCompanyCompetitorEvidence({sections:phoneResult,methodResults:[method]})[0]!.markdown,phoneResult[0]!.markdown)
  const riskDenial = '没有具名竞品及其可比产品、技术路线、价格、成本或份额的证据，故不作排名。'
  const repairedRisk = reconcileCompanyCompetitorEvidence({sections:[{id:'risks',markdown:riskDenial,sourceCandidateIds:[]}],methodResults:[method]})
  assert.match(repairedRisk[0]!.markdown,/吉利银河E8披露/)
  assert.doesNotMatch(repairedRisk[0]!.markdown,/没有具名竞品/)
  const industryDenial = '缺少具体竞品同口径数据，无法进行具名竞争对比。'
  const repairedIndustry = reconcileCompanyCompetitorEvidence({sections:[{id:'industry-exposure',markdown:industryDenial,sourceCandidateIds:[]}],methodResults:[method]})
  assert.match(repairedIndustry[0]!.markdown,/具名产品路线候选已由竞争方法核实/)
  assert.match(repairedIndustry[0]!.markdown,/\[public-web-peer@paragraph:1\]/)
})
test('cross-method check rejects a customer-concentration denial when a report table with percentages is already supplied', () => {
  const method: CompanyResearchMethodResult = { skillId: 'company_risk_analysis', status: 'complete', attempts: 1, answer: '前五名客户比例已披露。', markdown: '客户集中度见报告。', sections: [{ id: 'risks', markdown: '客户风险。' }], findings: [{ text: '前五名客户销售占比已披露。', kind: 'fact', evidence: [{ sourceCandidateId: 'annual-report', location: 'paragraph:2' }] }], sourceCandidateIds: ['annual-report'], limitations: [], risks: [], diagnostics: [], executionEvidence: [{ sourceCandidateId: 'annual-report', title: '2025年年度报告', publisher: 'Company', excerpts: [{ sourceCandidateId: 'annual-report', location: 'paragraph:2', text: '前五名客户合计销售金额占年度销售总额比例 18.12%' }, { sourceCandidateId: 'annual-report', location: 'paragraph:3', text: '1 第一名 12.53%' }] }] }
  assert.deepEqual(findKnownCustomerConcentrationDenials({ sections: [{ id: 'risks', markdown: '风险矩阵称没有前五大客户比例和最大客户数据。' }], methodResults: [method] }), [{ sectionId: 'risks', metric: 'customer_concentration' }])
  assert.deepEqual(findKnownCustomerConcentrationDenials({ sections: [{ id: 'risks', markdown: '客户身份匿名，合同与替代性未披露；年报已披露集中度比例。' }], methodResults: [method] }), [])
  assert.deepEqual(findKnownCustomerConcentrationDenials({ sections: [{ id: 'products', markdown: '本轮产品证据未提供客户身份与客户销售占比，不能识别某一产品对应的具名客户。' }], methodResults: [method] }), [], 'product-level customer mapping gaps must not be treated as denying disclosed company-wide concentration ratios')
  assert.deepEqual(findKnownCustomerConcentrationDenials({ sections: [{ id: 'monitoring-checklist', markdown: '第二大客户比例本轮未提供。' }], methodResults: [method] }), [{ sectionId: 'monitoring-checklist', metric: 'customer_concentration' }])
})
test('R36 does not join an unrelated missing-threshold sentence to a later management-role disclosure', () => {
  const value = sections()
  const management = COMPANY_CORE_SECTION_IDS.indexOf('management-capital-allocation')
  const thesis = COMPANY_CORE_SECTION_IDS.indexOf('investment-thesis')
  value[management] = { ...value[management]!, markdown: '公司披露董事长、总经理职责与履历。' }
  value[thesis] = { ...value[thesis]!, markdown: '但现有材料未提供可量化门槛。公司披露管理层职责与履历、内控体系及有效财务报告内控审计意见；治理风险应聚焦家族控制下的具体制衡。' }
  assert.ok(!evaluateCompanyResearchContent({ sections: value }).issues.includes('investment-thesis:UNSCOPED_MANAGEMENT_ROLE_GAP'))
})
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

test('product tables retain the exact split product-section heading beside cited unit, headers, and value rows', () => {
  const body = '| 电子电路产品 | 年报披露收入25,620,292,915.99元、产品毛利率17.59%。 [annual@paragraph:885] [annual@paragraph:886] [annual@paragraph:887] [annual@paragraph:888] [annual@paragraph:889] [annual@paragraph:890] [annual@paragraph:891] [annual@paragraph:896] |'
  const lines = Array.from({ length: 896 }, () => '常规披露')
  lines[884] = '单位：元'
  lines[885] = '营业收入 营业成本 毛利率 营业收入比上'
  lines[886] = '同期增减'
  lines[887] = '营业成本比上'
  lines[888] = '同期增减'
  lines[889] = '毛利率比上'
  lines[890] = '同期增减'
  lines[894] = '分产品'
  lines[895] = '电子电路产品 25,620,292,915.99 21,113,572,455.81 17.59% 3.30% 4.25% -0.75%'
  const packet = { sourceCandidateId: 'annual', title: '2025年年度报告', publisher: 'Company', excerpts: lines.flatMap((text, index) => [885, 886, 887, 888, 889, 890, 891, 895, 896].includes(index + 1) ? [{ sourceCandidateId: 'annual', location: `paragraph:${index + 1}`, text }] : []) }
  const method = { skillId: 'product_technology_analysis', status: 'complete', executionEvidence: [packet] } as unknown as CompanyResearchMethodResult
  const result = reconcileCompanyProductTableSectionReferences({ sections: [{ id: 'products', markdown: body }], methodResults: [method] })[0]!
  assert.match(result.markdown, /\[annual@paragraph:895\]/)
  for (const paragraph of [885, 886, 887, 888, 889, 890, 891, 896]) assert.match(result.markdown, new RegExp(`\\[annual@paragraph:${paragraph}\\]`))
})

test('interim product growth citations retain exact period, unit, and comparison-column headers', () => {
  const body = '精密组件收入同比大幅增长。[interim@paragraph:764] [interim@paragraph:765] [interim@paragraph:766] [interim@paragraph:773] [interim@paragraph:775]'
  const rows: Record<number, string> = { 764: '营业收入构成', 765: '单位：元', 766: '本报告期 上年同期', 767: '同比增减', 768: '金额 占营业收入比重 金额 占营业收入比重', 773: '分产品', 775: '精密组件产品 6,580,692,901.95 23.67% 2,361,835,859.44 13.93% 178.63%' }
  const packet = { sourceCandidateId: 'interim', title: '2026年半年度报告', publisher: 'Company', excerpts: Object.entries(rows).map(([paragraph, text]) => ({ sourceCandidateId: 'interim', location: `paragraph:${paragraph}`, text })) }
  const method = { skillId: 'business_driver_analysis', status: 'complete', executionEvidence: [packet] } as unknown as CompanyResearchMethodResult
  const result = reconcileCompanyProductGrowthReferences({ sections: [{ id: 'growth-drivers', markdown: body }], methodResults: [method] })[0]!
  for (const paragraph of [767, 768]) assert.match(result.markdown, new RegExp(`\\[interim@paragraph:${paragraph}\\]`))
})

test('product-revenue amounts are directly bound to the revenue row even when the draft cites the margin row', () => {
  const rows: Record<number, string> = { 760: '营业收入构成', 761: '单位：元', 762: '本报告期 上年同期', 763: '同比增减', 764: '金额 占营业收入比重 金额 占营业收入比重', 770: '分产品', 772: '电子电路产品 12,529,627,775.53 45.08% 9,889,996,000.00 58.33% 26.72%' }
  const packet = { sourceCandidateId: 'interim', title: '2026年半年度报告', publisher: 'Company', excerpts: Object.entries(rows).map(([paragraph, text]) => ({ sourceCandidateId: 'interim', location: `paragraph:${paragraph}`, text })) }
  const method = { skillId: 'business_driver_analysis', status: 'complete', executionEvidence: [packet] } as unknown as CompanyResearchMethodResult
  const sections = [{ id: 'growth-drivers', markdown: '电子电路产品收入12,529,627,775.53元，同比26.72%。[interim@paragraph:797]' }]
  const result = reconcileCompanyProductRevenueRowCitations({ sections, methodResults: [method] })[0]!
  assert.match(result.markdown, /12,529,627,775\.53\[interim@paragraph:772\]元/)
  assert.match(result.markdown, /\[interim@paragraph:797\]/, 'existing gross-margin context may remain, but revenue must have its own precise row citation')
})

test('segment revenue rows use the latest annual table as the primary citation and remove stale same-value annual locators',()=>{
  const oldPacket={sourceCandidateId:'older',title:'2024年年度报告',publisher:'Company',excerpts:[{sourceCandidateId:'older',location:'paragraph:693',text:'及其他产品 159,608,576,000.00 20.54% 118,576,910,000.00 19.68% 34.60%'}]}
  const latestPacket={sourceCandidateId:'latest',title:'2025年年度报告',publisher:'Company',excerpts:[{sourceCandidateId:'latest',location:'paragraph:807',text:'2025年 2024年'},{sourceCandidateId:'latest',location:'paragraph:818',text:'分产品'},{sourceCandidateId:'latest',location:'paragraph:819',text:'手机部件、组装'},{sourceCandidateId:'latest',location:'paragraph:820',text:'及其他产品 155,236,528,000.00 19.31% 159,608,576,000.00 20.54% -2.74%'}]}
  const method={skillId:'business_model_map',status:'complete',executionEvidence:[oldPacket,latestPacket]} as unknown as CompanyResearchMethodResult
  const line='| 手机部件、组装及其他产品 | 155,236,528,000.00 | 19.31% | 159,608,576,000.00[older@paragraph:693] | 20.54% |'
  const fixed=reconcileCompanyProductRevenueRowCitations({sections:[{id:'business-segments',markdown:line}],methodResults:[method]})[0]!
  assert.doesNotMatch(fixed.markdown,/older@paragraph:693/)
  assert.match(fixed.markdown,/159,608,576,000\.00[^\n]*\[latest@paragraph:820\]/)
})

test('product table citations discard byte-identical industry rows when an exact product row is cited',()=>{
  const packet={sourceCandidateId:'annual',title:'2025年年度报告',publisher:'Company',excerpts:[
    {sourceCandidateId:'annual',location:'paragraph:833',text:'单位：元'},
    {sourceCandidateId:'annual',location:'paragraph:834',text:'营业收入 营业成本 毛利率'},
    {sourceCandidateId:'annual',location:'paragraph:840',text:'分行业'},
    {sourceCandidateId:'annual',location:'paragraph:842',text:'日用电子器件制造业 155,236,528,000.00 145,473,989,000.00 6.29% -2.74% -0.56% -2.06%'},
    {sourceCandidateId:'annual',location:'paragraph:845',text:'分产品'},
    {sourceCandidateId:'annual',location:'paragraph:850',text:'手机部件、组'},
    {sourceCandidateId:'annual',location:'paragraph:851',text:'装及其他产品 155,236,528,000.00 145,473,989,000.00 6.29% -2.74% -0.56% -2.06%'},
  ]}
  const method={skillId:'business_model_map',status:'complete',executionEvidence:[packet]} as unknown as CompanyResearchMethodResult
  const line='| 手机部件、组装及其他产品 | 155,236,528,000.00 | 145,473,989,000.00 | 6.29% | -2.74% | -0.56% | -2.06% [annual@paragraph:833] [annual@paragraph:834] [annual@paragraph:840] [annual@paragraph:842] [annual@paragraph:850] [annual@paragraph:851] |'
  const fixed=reconcileCompanyProductRevenueRowCitations({sections:[{id:'products',markdown:line}],methodResults:[method]})[0]!
  assert.doesNotMatch(fixed.markdown,/annual@paragraph:(?:840|842)\]/)
  for(const paragraph of [833,834,850,851])assert.match(fixed.markdown,new RegExp(`\\[annual@paragraph:${paragraph}\\]`))
})


test('R145 cited-evidence fingerprint retains a synthesis across unrelated method edits but fails closed on changed or missing cited excerpts', () => {
  const method: CompanyResearchMethodResult = { skillId: 'company_history_strategy', status: 'complete', attempts: 1, answer: 'history', markdown: 'method result', sections: [], findings: [], sourceCandidateIds: ['annual'], limitations: [], risks: [], diagnostics: [], executionEvidence: [{ sourceCandidateId: 'annual', title: '2025年年度报告', publisher: 'Company', excerpts: [{ sourceCandidateId: 'annual', location: 'paragraph:18', text: '战略披露原文' }] }] }
  const sections = [{ id: 'investment-thesis', markdown: '判断引用。[annual@paragraph:18]' }]
  const initial = companySynthesisEvidenceFingerprint({ sections, methodResults: [method] })
  assert.ok(initial)
  assert.equal(companySynthesisEvidenceFingerprint({ sections, methodResults: [{ ...method, markdown: '修订了未被引用的方法摘要' }] }), initial)
  const changed = { ...method, executionEvidence: [{ ...method.executionEvidence![0]!, excerpts: [{ sourceCandidateId: 'annual', location: 'paragraph:18', text: '同定位内容已变更' }] }] }
  assert.notEqual(companySynthesisEvidenceFingerprint({ sections, methodResults: [changed] }), initial)
  assert.equal(companySynthesisEvidenceFingerprint({ sections, methodResults: [{ ...method, executionEvidence: [{ ...method.executionEvidence![0]!, excerpts: [] }] }] }), undefined)
})

test('R145 split-label annual product rows are repaired only from the exact annual table and are labeled historical', () => {
  const excerpt = (sourceCandidateId: string, paragraph: number, text: string) => ({ sourceCandidateId, location: `paragraph:${paragraph}`, text })
  const annual2024 = { sourceCandidateId: 'official-f6274e510499a654', title: '2024年年度报告', publisher: 'Company', excerpts: [
    excerpt('official-f6274e510499a654', 679, '（1）营业收入构成'), excerpt('official-f6274e510499a654', 680, '单位：元'), excerpt('official-f6274e510499a654', 681, '2024 年 2023 年'), excerpt('official-f6274e510499a654', 683, '金额 占营业收入比重 金额 占营业收入比重'), excerpt('official-f6274e510499a654', 691, '分产品'), excerpt('official-f6274e510499a654', 692, '手机部件、组装'), excerpt('official-f6274e510499a654', 693, '及其他产品 159,608,576,000.00 20.54% 118,576,910,000.00 19.68% 34.60%'), excerpt('official-f6274e510499a654', 694, '汽车、汽车相关'), excerpt('official-f6274e510499a654', 695, '产品及其他产品 617,381,935,000.00 79.45% 483,453,318,000.00 80.27% 27.70%'), excerpt('official-f6274e510499a654', 696, '其他 111,944,000.00 0.01% 285,126,000.00 0.05% -60.74%'),
  ] }
  const annual2025 = { sourceCandidateId: 'official-f7c8d23d2829a5e8', title: '2025年年度报告', publisher: 'Company', excerpts: [
    excerpt('official-f7c8d23d2829a5e8', 805, '(1) 营业收入构成'), excerpt('official-f7c8d23d2829a5e8', 806, '单位：元'), excerpt('official-f7c8d23d2829a5e8', 807, '2025 年 2024 年'), excerpt('official-f7c8d23d2829a5e8', 809, '金额 占营业收入'), excerpt('official-f7c8d23d2829a5e8', 810, '比重 金额 占营业收入比重'), excerpt('official-f7c8d23d2829a5e8', 818, '分产品'), excerpt('official-f7c8d23d2829a5e8', 819, '手机部件、组装'), excerpt('official-f7c8d23d2829a5e8', 820, '及其他产品 155,236,528,000.00 19.31% 159,608,576,000.00 20.54% -2.74%'), excerpt('official-f7c8d23d2829a5e8', 821, '汽车、汽车相关'), excerpt('official-f7c8d23d2829a5e8', 822, '产品及其他产品 648,645,636,000.00 80.68% 617,381,935,000.00 79.45% 5.06%'), excerpt('official-f7c8d23d2829a5e8', 823, '其他 82,794,000.00 0.01% 111,944,000.00 0.01% -26.04%'),
  ] }
  const method = { skillId: 'business_model_map', status: 'complete', executionEvidence: [annual2024, annual2025] } as unknown as CompanyResearchMethodResult
  const section = { id: 'products', markdown: '#### 年报披露的产品收入结构（2024年，仅列最新完整年度）\n[official-f6274e510499a654@paragraph:679] [official-f6274e510499a654@paragraph:680] [official-f6274e510499a654@paragraph:681] [official-f6274e510499a654@paragraph:683] [official-f6274e510499a654@paragraph:691] [official-f6274e510499a654@paragraph:693] [official-f6274e510499a654@paragraph:695] [official-f6274e510499a654@paragraph:696]\n\n及其他产品占营业收入20.54% [official-f6274e510499a654@paragraph:693]；产品及其他产品占营业收入79.45% [official-f6274e510499a654@paragraph:695]；其他占营业收入0.01% [official-f6274e510499a654@paragraph:696]。占比直接引用年报披露值，不据此推断利润贡献、客户结构或未来增速。 2025年年报分产品表列示新的最新收入。' }
  const fixed = reconcileCompanyProductRevenueShares({ sections: [section], methodResults: [method] })[0]!
  assert.match(fixed.markdown, /2024年历史对照；最新完整年度为2025年/)
  assert.match(fixed.markdown, /手机部件、组装及其他产品占营业收入20\.54%/)
  assert.match(fixed.markdown, /汽车、汽车相关产品及其他产品占营业收入79\.45%/)
  assert.doesNotMatch(fixed.markdown, /\n\n及其他产品占营业收入20\.54%/)
  assert.doesNotMatch(fixed.markdown, /；产品及其他产品占营业收入79\.45%/)
  assert.equal(fixed.markdown.match(/#### 年报披露的产品收入结构（2024年历史对照；最新完整年度为2025年）/g)?.length, 1)
  assert.match(fixed.markdown, /手机部件、组装及其他产品占营业收入19\.31%/)
  assert.match(fixed.markdown, /汽车、汽车相关产品及其他产品占营业收入80\.68%/)
  for (const paragraph of [692, 693, 694, 695]) assert.ok(fixed.markdown.includes(`[official-f6274e510499a654@paragraph:${paragraph}]`))
})

test('R145 acquisition wording acknowledges the sourced consolidation and keeps missing return inputs narrow', () => {
  const method = { skillId: 'capital_allocation_review', status: 'complete', sourceCandidateIds: ['official-f6274e510499a654'] } as unknown as CompanyResearchMethodResult
  const lines = Array.from({ length: 586 }, () => '')
  lines[585] = '并表二零二三年年底完成收购的业务，拉动零部件业务规模快速扩大。'
  const source = { candidate: { candidateId: 'official-f6274e510499a654' }, title: '2024年年度报告', content: lines.join('\n') }
  const row = '| 并购、回购及偿债 | 当前证据未提供可核实的并购交易对价、回购实施金额或相关资金流明细。 | 无法可靠说明交易目的、资金来源或实际执行状态。 | 不对并购回报、回购净效应或偿债资本配置作定量判断。 |\n本次材料未提供可核实的具体并购行动。'
  const fixed = reconcileCompanyPreparedAnalysisFacts({ sections: [{ id: 'management-capital-allocation', markdown: row }], methodResults: [method], sources: [source] })[0]!
  assert.match(fixed.markdown, /2023年年底完成收购并于2024年并表、拉动零部件业务规模扩大的事项/)
  assert.match(fixed.markdown, /标的名称、交易对价和资金来源未见于该段/)
  assert.match(fixed.markdown, /并购回报、回购净效应及偿债资金配置仍缺少可归因现金流/)
  assert.doesNotMatch(fixed.markdown, /当前证据未提供可核实的并购交易对价/)
  assert.doesNotMatch(fixed.markdown, /无法可靠说明交易目的、资金来源或实际执行状态/)
  assert.doesNotMatch(fixed.markdown, /本次材料未提供可核实的具体并购行动/)
  assert.match(fixed.markdown, /标的身份、对价和可归因回报仍未披露/)
  assert.ok(fixed.markdown.includes('[official-f6274e510499a654@paragraph:586]'))
  const crossSection = reconcileCompanyCrossSectionBoundaries({ sections: [{ id: 'management-capital-allocation', markdown: '| 并购 | 所给证据未提供可逐笔确认的并购交易金额、标的或已支付对价。 | 无从判定并购目的、资金来源或执行状态。 |' }], methodResults: [] })[0]!
  assert.match(crossSection.markdown, /已披露一项于2023年年底完成收购并于2024年并表的业务/)
  assert.match(crossSection.markdown, /交易金额、已支付对价或标的级回报/)
  assert.doesNotMatch(crossSection.markdown, /无从判定并购目的、资金来源或执行状态/)
})

test('R145 risk summary names quantified customer concentration as a risk when exact annual rows are supplied', () => {
  const packet = { sourceCandidateId: 'official-f7c8d23d2829a5e8', title: '2025年年度报告', publisher: 'Company', excerpts: [
    { sourceCandidateId: 'official-f7c8d23d2829a5e8', location: 'paragraph:918', text: '前五名客户合计销售金额占年度销售总额比例 18.12%' },
    { sourceCandidateId: 'official-f7c8d23d2829a5e8', location: 'paragraph:922', text: '1 客户一 100,736,686,000.00 12.53%' },
    { sourceCandidateId: 'official-f7c8d23d2829a5e8', location: 'paragraph:923', text: '2 客户二 16,498,131,000.00 2.05%' },
  ] }
  const method = { skillId: 'company_risk_analysis', status: 'complete', executionEvidence: [packet] } as unknown as CompanyResearchMethodResult
  const sections = [{ id: 'risks', markdown: '现有证据显示，风险并非来自单一客户集中或已确认的商誉减值，而更多体现为库存与应收扩张。' }]
  const fixed = reconcileCompanyRiskBoundaries({ sections, methodResults: [method] })[0]!
  assert.doesNotMatch(fixed.markdown, /风险并非来自单一客户集中/)
  assert.match(fixed.markdown, /风险包括已披露的客户集中暴露/)
  assert.match(fixed.markdown, /18\.12%/)
  assert.match(fixed.markdown, /12\.53%/)
  assert.match(fixed.markdown, /2\.05%/)
  assert.ok(fixed.markdown.includes('[official-f7c8d23d2829a5e8@paragraph:922]'))
})

test('R169 content gate rejects customer concentration comparisons contradicted by cited official ratios', () => {
  const source = 'official-f7c8d23d2829a5e8'
  const packet = { sourceCandidateId: source, title: '2025年年度报告', publisher: 'CNINFO', excerpts: [
    { sourceCandidateId: source, location: 'paragraph:918', text: '前五名客户合计销售金额占年度销售总额比例 18.12%' },
    { sourceCandidateId: source, location: 'paragraph:922', text: '1 客户一 100,736,686,000.00 12.53%' },
  ] }
  const method = { skillId: 'company_risk_analysis', status: 'complete', attempts: 1, answer: '前五名客户集中度高于最大单一客户。', markdown: '客户集中度事实。[official-f7c8d23d2829a5e8@paragraph:918] [official-f7c8d23d2829a5e8@paragraph:922]', sections: [], findings: [], sourceCandidateIds: [source], limitations: [], risks: ['客户集中度需监控。'], diagnostics: [], executionEvidence: [packet] } as unknown as CompanyResearchMethodResult
  const value = sections()
  const risksIndex = COMPANY_CORE_SECTION_IDS.indexOf('risks')
  const contradicted = '年报披露的前五名合计占比较低于最大客户单项占比。[official-f7c8d23d2829a5e8@paragraph:918] [official-f7c8d23d2829a5e8@paragraph:922]'
  value[risksIndex] = { ...value[risksIndex]!, markdown: contradicted }
  const quality = evaluateCompanyResearchContent({ sections: value, methodResults: [method] })
  assert.ok(quality.issues.includes('risks:CONTRADICTORY_CUSTOMER_CONCENTRATION_COMPARISON'))
  assert.deepEqual(findCustomerConcentrationComparisonContradictions({ sections: [{ id: 'risks', markdown: contradicted }], methodResults: [method] }), [{ sectionId: 'risks' }])
  const corrected = reconcileCompanyRiskBoundaries({ sections: [{ id: 'risks', markdown: contradicted }], methodResults: [method] })[0]!
  assert.match(corrected.markdown, /前五名合计占比高于最大客户单项占比/)
  assert.ok(corrected.markdown.includes('[official-f7c8d23d2829a5e8@paragraph:918]'))
  assert.ok(corrected.markdown.includes('[official-f7c8d23d2829a5e8@paragraph:922]'))
  assert.deepEqual(findCustomerConcentrationComparisonContradictions({ sections: [{ id: 'risks', markdown: corrected.markdown }], methodResults: [method] }), [])

  const noEvidence = { ...method, executionEvidence: [] }
  assert.deepEqual(findCustomerConcentrationComparisonContradictions({ sections: [{ id: 'risks', markdown: contradicted }], methodResults: [noEvidence] }), [])
  assert.deepEqual(findCustomerConcentrationComparisonContradictions({ sections: [{ id: 'risks', markdown: contradicted }], methodResults: [] }), [])
})

test('customer concentration comparison correction requires a unique cited official pair', () => {
  const source = 'official-annual'
  const line = '前五名合计占比低于最大客户单项占比。[official-annual@paragraph:1] [official-annual@paragraph:2]'
  const packet = { sourceCandidateId: source, title: '2025年年度报告', publisher: 'CNINFO', excerpts: [
    { sourceCandidateId: source, location: 'paragraph:1', text: '前五名客户合计销售占比 18.12%' },
    { sourceCandidateId: source, location: 'paragraph:2', text: '1 客户一 12.53%' },
  ] }
  const method = { skillId: 'company_risk_analysis', status: 'complete', executionEvidence: [packet] } as unknown as CompanyResearchMethodResult
  const sections = [{ id: 'monitoring-checklist', markdown: line }]
  const corrected = reconcileCompanyRiskBoundaries({ sections, methodResults: [method] })[0]!
  assert.match(corrected.markdown, /前五名合计占比高于最大客户单项占比/)

  const correctLine = line.replace('低于', '高于')
  assert.deepEqual(findCustomerConcentrationComparisonContradictions({ sections: [{ id: 'monitoring-checklist', markdown: correctLine }], methodResults: [method] }), [])

  const ambiguous = { ...method, executionEvidence: [{ ...packet, excerpts: [...packet.excerpts, { sourceCandidateId: source, location: 'paragraph:3', text: '前五名客户合计销售占比 10.00%' }] }] }
  const ambiguousLine = `${line} [official-annual@paragraph:3]`
  const unchanged = reconcileCompanyRiskBoundaries({ sections: [{ id: 'monitoring-checklist', markdown: ambiguousLine }], methodResults: [ambiguous] })[0]!
  assert.equal(unchanged.markdown, ambiguousLine)
  assert.deepEqual(findCustomerConcentrationComparisonContradictions({ sections, methodResults: [ambiguous] }), [{ sectionId: 'monitoring-checklist' }])
})

test('customer concentration comparison check handles the reverse contradictory wording', () => {
  const source = 'official-annual'
  const method = { skillId: 'company_risk_analysis', status: 'complete', executionEvidence: [{ sourceCandidateId: source, title: '2025年年度报告', publisher: 'CNINFO', excerpts: [
    { sourceCandidateId: source, location: 'paragraph:1', text: '前五名客户合计销售占比 10.00%' },
    { sourceCandidateId: source, location: 'paragraph:2', text: '1 客户一 12.53%' },
  ] }] } as unknown as CompanyResearchMethodResult
  const result = findCustomerConcentrationComparisonContradictions({ sections: [{ id: 'monitoring-checklist', markdown: '前五名合计占比高于最大客户单项占比。[official-annual@paragraph:1] [official-annual@paragraph:2]' }], methodResults: [method] })
  assert.deepEqual(result, [{ sectionId: 'monitoring-checklist' }])
})

test('R145 competitor denial for PV/other business does not contradict the sourced passenger-car candidate', () => {
  const competitor: CompanyResearchMethodResult = { skillId: 'competitive_market_map', status: 'complete', attempts: 1, answer: '吉利是乘用车新能源整车市场的候选对手。', markdown: '吉利是乘用车候选对手。', sections: [], findings: [{ text: '吉利是乘用车新能源整车市场候选对手。', kind: 'fact', evidence: [{ sourceCandidateId: 'annual-report', location: 'paragraph:1' }] }], sourceCandidateIds: ['annual-report'], limitations: [], risks: [], diagnostics: [] }
  assert.deepEqual(findKnownCompetitorDenials({ sections: [{ id: 'competition', markdown: '光伏和储能业务没有具名竞争者及同口径数据，不能比较。' }], methodResults: [competitor] }), [])
})

test('R194 product synthesis repair replaces a malformed matrix with validated method rows and exact annual revenue shares',()=>{
  const products=[
    ['电子电路产品','25,620,292,915.99','21,113,572,455.81','17.59%','3.30%'],
    ['光电显示模组','5,985,629,058.48','5,675,456,101.15','5.18%','-6.03%'],
    ['精密组件产品','5,930,242,495.99','5,383,316,361.13','9.22%','30.61%'],
    ['光模块','1,435,534,921.96','908,137,144.50','36.74%',''],
  ] as const
  const methodRows=products.map(([name,revenue,cost,margin,growth])=>`| ${name} | 公司披露的产品用途 | 公司披露的产品方向 | 2025年收入${revenue}元、营业成本${cost}元、毛利率${margin}；${growth?`营业收入同比增减${growth}。`:'未提供同比值。'} [annual-product@paragraph:896] | 已形成产品收入；缺少客户级持续性证据。 |`).join('\n')
  const method:CompanyResearchMethodResult={skillId:'product_technology_analysis',status:'complete',attempts:1,answer:'',markdown:'',sections:[{id:'products',markdown:`### 产品矩阵\n| 产品类别 | 应用或定位 | 技术路线与差异 | 产品收入、成本及毛利 | 商业化阶段与替代比较 |\n|---|---|---|---|---|\n${methodRows}`}],findings:[],sourceCandidateIds:['annual-product'],limitations:[],risks:[],diagnostics:[]}
  const business:CompanyResearchMethodResult={skillId:'business_model_map',status:'complete',attempts:1,answer:'',markdown:'',sections:[],findings:[],sourceCandidateIds:['annual-mix'],limitations:[],risks:[],diagnostics:[],executionEvidence:[{sourceCandidateId:'annual-mix',title:'2025年年度报告',publisher:'Issuer',excerpts:[
    {sourceCandidateId:'annual-mix',location:'paragraph:860',text:'营业收入构成'},
    {sourceCandidateId:'annual-mix',location:'paragraph:861',text:'单位：元'},
    {sourceCandidateId:'annual-mix',location:'paragraph:862',text:'2025年营业收入构成'},
    {sourceCandidateId:'annual-mix',location:'paragraph:863',text:'金额 占营业收入比重 金额 占营业收入比重'},
    {sourceCandidateId:'annual-mix',location:'paragraph:872',text:'分产品'},
    ...products.map(([name,revenue],index)=>({sourceCandidateId:'annual-mix',location:`paragraph:${873+index}`,text:`${name} ${revenue} ${['63.85','14.92','14.78','3.58'][index]}% 0.00 0.00% 0.00%`}))
  ]}]}
  const final=`### 产品矩阵\n\n| 产品类别 | 应用或定位 | 技术路线与差异 | 产品收入、成本及毛利 | 商业化阶段与替代比较 |\n|---|---|---|---|---|\n| 电子电路产品 | PCB | 高阶HDI | 不能据此断言直接竞争或相对优势59%；金额未列 | 已形成分部收入 |\n| 光电显示模组 | 显示 | 未披露 | 空 | 已形成分部收入 |\n| 精密组件产品 | 组件 | 未披露 | 空 | 已形成分部收入 |\n| 光模块 | 光模块 | 未披露 | 空 | 已形成分部收入 |\n\n#### 年报披露的产品收入结构（2025年）`
  const fixed=reconcileCompanyProductMatrixFromMethod({sections:[{id:'products',markdown:final}],methodResults:[method,business]})[0]!.markdown
  assert.doesNotMatch(fixed,/相对优势\s*59%/)
  assert.match(fixed,/2025年占营业收入63\.85%\s*\[annual-mix@paragraph:873\]/)
  assert.match(fixed,/25,620,292,915\.99元、营业成本21,113,572,455\.81元、毛利率17\.59%/)
  const table=fixed.split('### 产品矩阵')[1]!.split('#### 年报披露')[0]!.split(/\r?\n/).filter(line=>line.startsWith('|'))
  assert.equal(table.length,6)
  assert.ok(table.slice(2).every(line=>line.split('|').length===7),'each repaired matrix row has five cells')
})

test('R194 financial opening adds only source-matched same-period annual direction counterevidence',()=>{
  const values={
    '2024-12-31':{revenue:36770374347.58,operatingProfit:1479602468.51,netProfit:1085641847.89},
    '2025-12-31':{revenue:40124858839.52,operatingProfit:1268880792.11,netProfit:1386066705.56},
  }
  const metadata=Object.fromEntries(['revenue','operatingProfit','netProfit'].map(metric=>[metric,{unit:'CNY',currency:'CNY',basis:'YTD'}]))
  const table=Object.entries(values).map(([period,metrics])=>({period,metrics,metadata,conflicts:[]}))
  const sourceRows=Object.entries(values).map(([period,metrics])=>({periodEnd:period,metrics,metricMetadata:metadata}))
  const method:CompanyResearchMethodResult={skillId:'financial_quality_analysis',status:'complete',attempts:1,answer:'',markdown:'',sections:[],findings:[],sourceCandidateIds:['akshare-financial-test'],limitations:[],risks:[],diagnostics:[],executionEvidence:[{sourceCandidateId:'akshare-financial-test',title:'Financial history',publisher:'Provider',excerpts:[{sourceCandidateId:'akshare-financial-test',location:'paragraph:1',text:JSON.stringify({kind:'financial',rows:sourceRows})}]}]}
  const sections=[{id:'financial-quality',markdown:'# 财务质量分析\n\n半年收入增长。'},{id:'revenue-profit-drivers',markdown:'## 收入与利润驱动\n\n半年产品增长。'}]
  const fixed=reconcileCompanyAnnualFinancialCounterevidence({sections,methodResults:[method],preparedAnalysis:{financial:{table}}})
  const result=fixed.find(section=>section.id==='financial-quality')!.markdown
  assert.match(result,/2024—2025年/)
  assert.match(result,/营业收入：36,770,374,347\.58元至40,124,858,839\.52元/)
  assert.match(result,/营业利润：1,479,602,468\.51元至1,268,880,792\.11元/)
  assert.match(result,/同比＝\(1,268,880,792\.11−1,479,602,468\.51\)÷abs\(1,479,602,468\.51\)×100%＝−14\.24%/)
  assert.match(result,/\[akshare-financial-test@paragraph:1\]/)
  assert.match(fixed.find(section=>section.id==='revenue-profit-drivers')!.markdown,/年度财务反证（2024—2025年/)
  const invertedValues={
    '2024-12-31':values['2025-12-31'],
    '2025-12-31':values['2024-12-31'],
  }
  const invertedRows=Object.entries(invertedValues).map(([period,metrics])=>({periodEnd:period,metrics,metricMetadata:metadata}))
  const invertedMethod={...method,executionEvidence:[{...method.executionEvidence![0]!,excerpts:[{...method.executionEvidence![0]!.excerpts[0]!,text:JSON.stringify({kind:'financial',rows:invertedRows})}]}]}
  const inverted=reconcileCompanyAnnualFinancialCounterevidence({sections,methodResults:[invertedMethod],preparedAnalysis:{financial:{table:Object.entries(invertedValues).map(([period,metrics])=>({period,metrics,metadata,conflicts:[]}))}}}).find(section=>section.id==='financial-quality')!.markdown
  assert.match(inverted,/变动方向分别为：营业收入下降、营业利润增长、结构化净利润下降/)
  assert.match(inverted,/营业收入下降而营业利润增长/)
  assert.doesNotMatch(inverted,/收入与净利润增长而营业利润下降/)
  const conflicted={...table[1]!,conflicts:[{metric:'operatingProfit'}]}
  const withheld=reconcileCompanyAnnualFinancialCounterevidence({sections:[{id:'financial-quality',markdown:'# 财务质量分析\n\n半年收入增长。'}],methodResults:[method],preparedAnalysis:{financial:{table:[table[0],conflicted]}}})[0]!.markdown
  assert.doesNotMatch(withheld,/2024—2025年/)
})

test('R194 MFLEX repair withholds a percentage whose split PDF row cannot bind it to the revenue-growth column',()=>{
  const risk='MFLEX资产组预测期收入复合增长率0.10%、毛利率17.00%，折现率10.62%。[annual@paragraph:7695]'
  const fixed=reconcileCompanyCrossSectionBoundaries({sections:[{id:'risks',markdown:risk}],methodResults:[]})[0]!.markdown
  assert.doesNotMatch(fixed,/预测期收入复合增长率0\.10%/)
  assert.match(fixed,/未能将该值可靠对应到预测期收入增长假设/)
  assert.match(fixed,/\[annual@paragraph:7695\]/)
})

test('old public competitor evidence is explicitly labeled as historical wherever it is cited',()=>{
  const method:CompanyResearchMethodResult={skillId:'competitive_market_map',status:'complete',attempts:1,answer:'历史候选。',markdown:'',sections:[],findings:[],sourceCandidateIds:['public-peer'],limitations:[],risks:[],diagnostics:[],executionEvidence:[{sourceCandidateId:'public-peer',title:'2026年半年度报告及竞争证据',publisher:'Web',excerpts:[{sourceCandidateId:'public-peer',location:'paragraph:214',text:'候选技术路线。'}]}]}
  const sections=[{id:'competition',markdown:'鹏鼎汽车电池板FPC可作为历史候选。[public-peer@paragraph:214]'},{id:'technologies',markdown:'路线比较提及鹏鼎。[public-peer@paragraph:214]'}]
  const oldSource={candidate:{candidateId:'public-peer'},title:'媒体历史报道',content:'2021-10-25 16:13:26 来源: 媒体\n汽车电池板FPC。'}
  const latest={candidate:{candidateId:'annual-current'},title:'2026年半年度报告',content:'公司最新披露。'}
  const fixed=reconcileCompanyCrossSectionBoundaries({sections,methodResults:[method],sources:[oldSource,latest]})
  for(const section of fixed){assert.match(section.markdown,/发表于2021年的历史公开资料/);assert.match(section.markdown,/不代表当前竞争能力/)}
})


test('incomplete synthesis diagnosis fills empty core conclusions with the specific failed evidence boundary', () => {
  const input = [{ id: 'investment-thesis', markdown: '研究缺口：Investment Thesis 尚未完成。' }, { id: 'monitoring-checklist', markdown: '' }, { id: 'risks', markdown: '已完成的风险分析。' }]
  const fixed = ensureCompanyIncompleteSynthesisSections(input, 'cited_evidence_unresolved')
  assert.match(fixed[0]!.markdown, /研究未完成：上一版综合所引用的证据定位无法在当前方法结果中全部复核/)
  assert.match(fixed[1]!.markdown, /不复用旧结论/)
  assert.equal(fixed[2]!.markdown, '已完成的风险分析。')
  const incomplete = ensureCompanyIncompleteSynthesisSections(input, 'methods_incomplete')
  assert.match(incomplete[0]!.markdown, /至少一个原子研究方法未完成/)
})
