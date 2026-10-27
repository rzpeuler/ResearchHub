import test from 'node:test'
import assert from 'node:assert/strict'
import { validateCompanyNumericGrounding, companyPreparedFinancialDateText } from '../../skills/company-research/numeric-grounding.ts'
import { selectCompanyEvidence } from '../../skills/company-research/evidence.ts'
import type { NormalizedResearchSource } from '../../plugins/research-acquisition/contracts.ts'
import { prepareCompanyFinancialAnalysis } from '../../workflows/company-deep-research/financial-analysis.ts'

const source = { candidate: { candidateId: 'filing-2025-003', kind: 'official_disclosure', tier: 1, provider: 'fixture', title: '财报' }, title: '财报', content: '2025年收入 30,396,400,000 元，研发 2 亿元。\n未引用段落收入 999 亿元。' } as NormalizedResearchSource

test('Chinese official product-page price ranges retain their explicit currency symbol', () => {
  const candidateId = 'public-web-byd-model-page'
  const productPage = {
    candidate: { candidateId, kind: 'public_web', tier: 2, provider: 'public_web', title: '比亚迪车型页面' },
    title: '比亚迪车型页面', content: '海豹07DM-i ¥139,800 - ¥195,800 立即订购',
  } as unknown as NormalizedResearchSource
  const markdown = `海豹07 DM-i页面标价¥139,800—¥195,800，页面提供订购入口。[${candidateId}@paragraph:1]`
  const result = validateCompanyNumericGrounding({ markdown, sources: [productPage] })
  assert.equal(result.status, 'grounded', JSON.stringify(result.diagnostics))
})

test('prepared financial growth percentages remain grounded when a cited structured source supports the calculation', () => {
  const preparedAnalysis = { financial: { growth: [{ metric: 'receivables', currentPeriod: '2026-06-30', priorPeriod: '2025-06-30', unit: 'CNY', basis: 'POINT_IN_TIME', growthPercent: 15.547626223152694, sourceCandidateIds: ['financial'] }] } }
  const formula = '应收账款期末余额同比增速15.5476%，比较期间为2025-06-30至2026-06-30。[financial@paragraph:1]'
  const options = { sources: [], preparedAnalysis, trustedText: ['2025-06-30', '2026-06-30'] }
  assert.equal(validateCompanyNumericGrounding({ markdown: formula, ...options }).status, 'grounded')
  assert.equal(validateCompanyNumericGrounding({ markdown: formula.replace('15.5476%', '99.99%'), ...options }).status, 'unsupported_numbers')
})

test('numeric grounding binds bare row values to a declared percent unit and keeps percentage points distinct', () => {
  const candidateId = 'official-rd-ratio'
  const filing = {
    ...source,
    candidate: { ...source.candidate, candidateId },
    title: '年度报告',
    content: '研发投入占营业收入比例（%） 4.56 23.71',
  }
  const valid = `本期研发投入占营业收入比例为4.56%，上期为23.71%。[${candidateId}@paragraph:1]`
  const grounded = validateCompanyNumericGrounding({ markdown: valid, sources: [filing] })
  assert.equal(grounded.status, 'grounded', JSON.stringify(grounded.diagnostics))

  const wrongUnit = valid.replace('4.56%', '4.56个百分点')
  assert.equal(
    validateCompanyNumericGrounding({ markdown: wrongUnit, sources: [filing] }).status,
    'unsupported_numbers',
    'a source row that declares percent does not support percentage-point wording',
  )
})

test('a balance-sheet change is grounded only from its exact cited row, current/prior header, and declared unit', () => {
  const candidateId = 'official-balance-sheet'
  const rows = new Map<number, string>([
    [810, '单位：元'],
    [815, '本报告期末 上年末'],
    [824, '应收账款 10,598,328,021.04 15.32% 9,792,745,060.06 16.25% -0.93%'],
    [825, '存货 11,417,997,322.49 16.51% 8,928,944,182.01 14.82% 1.69%'],
  ])
  const content = Array.from({ length: 825 }, (_, index) => rows.get(index + 1) ?? '').join('\n')
  const filing = { ...source, candidate: { ...source.candidate, candidateId }, title: '2026年半年度报告', content }
  const packet = { sourceCandidateId: candidateId, title: filing.title!, publisher: '公司', excerpts: [...rows].map(([paragraph, text]) => ({ sourceCandidateId: candidateId, location: `paragraph:${paragraph}`, text, ...(paragraph === 824 || paragraph === 825 ? { contextLocations: ['paragraph:810', 'paragraph:815'] } : {}) })) }
  const citations = [810, 815, 824, 825].map(paragraph => `[${candidateId}@paragraph:${paragraph}]`).join(' ')
  const claim = `2026-06-30应收账款105.98亿元、存货114.18亿元，分别较2025年末增加约8.06亿元和24.89亿元。 ${citations}`
  const grounded = validateCompanyNumericGrounding({ markdown: claim, sources: [filing], evidenceContexts: [packet], trustedText: ['2025-12-31', '2026-06-30'] })
  assert.equal(grounded.status, 'grounded', JSON.stringify(grounded.diagnostics))

  const wrongAccount = `2026-06-30存货114.18亿元，较2025年末增加8.06亿元。 ${citations}`
  assert.equal(validateCompanyNumericGrounding({ markdown: wrongAccount, sources: [filing], evidenceContexts: [packet] }).status, 'unsupported_numbers')
  const missingHeaderCitation = claim.replace(`[${candidateId}@paragraph:815] `, '')
  assert.equal(validateCompanyNumericGrounding({ markdown: missingHeaderCitation, sources: [filing], evidenceContexts: [packet] }).status, 'unsupported_numbers')
  const wrongPeriod = claim.replace('较2025年末', '较2024年末')
  assert.equal(validateCompanyNumericGrounding({ markdown: wrongPeriod, sources: [filing], evidenceContexts: [packet] }).status, 'unsupported_numbers')
})

test('deterministic prepared financial periods authorize exact period labels in a sourced method claim', () => {
  const financial = { ...source, candidate: { ...source.candidate, candidateId: 'financial' }, content: 'structured financial history' }
  const preparedAnalysis = { financial: { table: [{ period: '2025-06-30' }, { period: '2026-06-30' }] } }
  const markdown = '2026年上半年累计数据与2025年上半年同期比较。[financial@paragraph:1]'
  const trustedText = companyPreparedFinancialDateText(preparedAnalysis)
  assert.deepEqual(trustedText, ['2025-06-30', '2026-06-30'])
  assert.equal(validateCompanyNumericGrounding({ markdown, sources: [financial], preparedAnalysis, trustedText }).status, 'grounded')
})

test('prepared financial year labels are allowed only for cited periods in a structured financial source', () => {
  const candidateId = 'akshare-financial-periods'
  const financial = { ...source, candidate: { ...source.candidate, candidateId, metadata: { dataProvenance: { metricId: 'company_financial_history' } } }, title: 'Company financial history', content: '2025-06-30;2026-06-30' }
  const official = { ...source, candidate: { ...source.candidate, candidateId: 'official-periods' }, title: '2026年半年度报告', content: '本报告期与上年同期按累计口径比较。' }
  const preparedAnalysis = { financial: { table: [{ period: '2025-06-30' }, { period: '2026-06-30' }] } }
  const valid = '2025年上半年累计与2026年上半年累计为同期间比较。[akshare-financial-periods@paragraph:1]'
  assert.equal(validateCompanyNumericGrounding({ markdown: valid, sources: [financial], preparedAnalysis }).status, 'grounded')
  const unsupportedYear = valid.replace('2025年', '2024年')
  assert.equal(validateCompanyNumericGrounding({ markdown: unsupportedYear, sources: [financial], preparedAnalysis }).status, 'unsupported_numbers')
  const noStructuredCitation = valid.replace('akshare-financial-periods', 'official-periods')
  assert.equal(validateCompanyNumericGrounding({ markdown: noStructuredCitation, sources: [financial, official], preparedAnalysis }).status, 'unsupported_numbers')
})

test('growth divergence formula remains grounded with the exact cited ISO period pair', () => {
  const candidateId = 'akshare-financial-002594'
  const financial = { ...source, candidate: { ...source.candidate, candidateId, title: 'Company financial history' }, title: 'Company financial history', content: JSON.stringify({ rows: [{ periodEnd: '2026-06-30', receivablesGrowth: 15.547626223152694, revenueGrowth: -7.128167265937922 }, { periodEnd: '2025-06-30' }] }) }
  const preparedAnalysis = { financial: { growth: [
    { metric: 'receivables', currentPeriod: '2026-06-30', priorPeriod: '2025-06-30', unit: 'CNY', basis: 'POINT_IN_TIME', growthPercent: 15.547626223152694, sourceCandidateIds: [candidateId] },
    { metric: 'revenue', currentPeriod: '2026-06-30', priorPeriod: '2025-06-30', unit: 'CNY', basis: 'YTD', growthPercent: -7.128167265937922, sourceCandidateIds: [candidateId] },
  ], growthDivergences: [{ leftMetric: 'receivables', rightMetric: 'revenue', unit: 'percentage_points', value: 22.675793489090616, sourceCandidateIds: [candidateId] }] } }
  const claim = '2025-06-30至2026-06-30，应收账款期末余额增速15.5476%，营业收入累计同比-7.1282%；差值公式为15.5476%−(-7.1282%)＝22.6758个百分点。'
  const result = validateCompanyNumericGrounding({ markdown: `${claim}[${candidateId}@paragraph:1]`, sources: [financial], preparedAnalysis })
  assert.equal(result.status, 'grounded', JSON.stringify(result.diagnostics))
})

test('an ISO date followed by a fullwidth comma does not merge its day with the period-day count', () => {
  const report = 'DSO（2026-06-30，181天）为66.39天，公式按平均应收余额÷累计收入×期间天数。'
  const result = validateCompanyNumericGrounding({ markdown: report, sources: [], trustedText: ['2026-06-30', '181天', '66.39天'] })
  assert.equal(result.status, 'grounded', JSON.stringify(result.diagnostics))
})

test('numeric grounding inherits a shared trailing percentage-point unit across a Chinese value list', () => {
  const candidateId = 'akshare-financial-002594'
  const financial = { ...source, candidate: { ...source.candidate, candidateId }, content: 'structured financial source' }
  const preparedAnalysis = { financial: { growthDivergences: [
    { leftMetric: 'receivables', rightMetric: 'revenue', unit: 'percentage_points', value: 22.675793489090616, sourceCandidateIds: [candidateId] },
    { leftMetric: 'inventory', rightMetric: 'revenue', unit: 'percentage_points', value: 42.02709334803838, sourceCandidateIds: [candidateId] },
  ] } }
  const valid = `应收账款与存货期末余额增速分别形成22.6758和42.0271个百分点的跨口径背离。[${candidateId}@paragraph:1]`
  const withChineseConjunction = `应收账款与存货期末余额增速分别形成22.6758与42.0271个百分点的跨口径背离。[${candidateId}@paragraph:1]`
  const invalid = valid.replace('22.6758', '23.6758')
  assert.equal(validateCompanyNumericGrounding({ markdown: valid, sources: [financial], preparedAnalysis }).status, 'grounded')
  assert.equal(validateCompanyNumericGrounding({ markdown: withChineseConjunction, sources: [financial], preparedAnalysis }).status, 'grounded')
  assert.equal(validateCompanyNumericGrounding({ markdown: invalid, sources: [financial], preparedAnalysis }).status, 'unsupported_numbers')
})

test('negative prepared ratio changes may be reported as a positive decrease magnitude', () => {
  const financial = { ...source, candidate: { ...source.candidate, candidateId: 'financial' }, content: 'structured source' }
  const preparedAnalysis = { financial: { ratioChanges: [{
    metric: 'liabilitiesToAssetsPercent', currentPeriod: '2026-06-30', priorPeriod: '2025-06-30',
    currentValue: 70.95749694991416, priorValue: 71.08142972302059,
    changePercentagePoints: -0.12393277310643214, sourceCandidateIds: ['financial'],
  }] } }
  const options = { sources: [financial], preparedAnalysis }
  assert.equal(validateCompanyNumericGrounding({ markdown: '负债/资产比率较上年同期低0.1239个百分点。[financial@paragraph:1]', ...options }).status, 'grounded')
  assert.equal(validateCompanyNumericGrounding({ markdown: '负债/资产比率较上年同期高0.1239个百分点。[financial@paragraph:1]', ...options }).status, 'unsupported_numbers')
})

test('short Chinese decline wording grounds split industry-row percentage magnitudes', () => {
  const candidateId = 'industry-report'
  const filing = { ...source, candidate: { ...source.candidate, candidateId }, title: '2026年半年度报告', content: Array.from({ length: 730 }, (_, index) => index === 728 ? '交通运输设备及电气制' : index === 729 ? '造业 275,341,358,000.00 213,863,297,000.00 22.33% -8.98% -11.24% 1.98%' : '其他披露').join('\n') }
  const markdown = `交通运输设备及电气制造业营业收入同比减8.98%、营业成本同比减11.24%。[${candidateId}@paragraph:729] [${candidateId}@paragraph:730]`
  const result = validateCompanyNumericGrounding({ markdown, sources: [filing] })
  assert.equal(result.status, 'grounded', JSON.stringify(result.diagnostics))
})

test('multiple industry-margin claims in one sentence bind each value to its own cited row', () => {
  const candidateId = 'byd-industry-margin'
  const lines = [
    '毛利率（%） 同比增减（%）',
    '分行业',
    '日用电子器件制造业 5.04% 0.96% 3.88% -2.67%',
    '交通运输设备及电气制造业 22.33% -8.98% -11.24% 1.98%',
  ]
  const filing = { ...source, candidate: { ...source.candidate, candidateId }, title: '2026年半年度报告', content: lines.join('\n') }
  const citations = lines.map((_, index) => `[${candidateId}@paragraph:${index + 1}]`).join(' ')
  const markdown = `半年报分行业表列示：日用电子器件制造业毛利率5.04%，同比下降2.67%。${citations}；交通运输设备及电气制造业毛利率22.33%，同比上升1.98%。${citations}`
  const result = validateCompanyNumericGrounding({ markdown, sources: [filing] })
  assert.equal(result.status, 'grounded', JSON.stringify(result.diagnostics))
})

test('BYD real half-year split header and industry rows ground both claims independently', () => {
  const candidateId = 'byd-half-real-layout'
  const rows = new Map<number, string>([
    [716, '单位：元'], [717, '营业收入 营业成本 毛利率'], [718, '营业收入'], [719, '比上年同'], [720, '期增减'],
    [721, '营业成本'], [722, '比上年同'], [723, '期增减'], [724, '毛利率比'], [725, '上年同期'], [726, '增减'], [727, '分行业'],
    [728, '日用电子器件制造业 69,404,994,000.00 65,907,931,000.00 5.04% 0.96% 3.88% -2.67%'],
    [729, '交通运输设备及电气制'], [730, '造业 275,341,358,000.00 213,863,297,000.00 22.33% -8.98% -11.24% 1.98%'],
  ])
  const content = Array.from({ length: 730 }, (_, index) => rows.get(index + 1) ?? '').join('\n')
  const filing = { ...source, candidate: { ...source.candidate, candidateId }, title: '2026年半年度报告', content }
  const dailyRefs = [716, 717, 724, 725, 726, 727, 728].map(paragraph => `[${candidateId}@paragraph:${paragraph}]`).join(' ')
  const transportRefs = [716, 717, 724, 725, 726, 727, 729, 730].map(paragraph => `[${candidateId}@paragraph:${paragraph}]`).join(' ')
  const markdown = `半年报分行业表列示：日用电子器件制造业毛利率5.04%，同比下降2.67%。${dailyRefs}；交通运输设备及电气制造业毛利率22.33%，同比上升1.98%。${transportRefs}`
  const result = validateCompanyNumericGrounding({ markdown, sources: [filing] })
  assert.equal(result.status, 'grounded', JSON.stringify(result.diagnostics))
  const missingTransportRowRefs = [716, 717, 724, 725, 726, 727, 728].map(paragraph => `[${candidateId}@paragraph:${paragraph}]`).join(' ')
  const unsupportedWithoutValueRow = validateCompanyNumericGrounding({
    markdown: `交通运输设备及电气制造业毛利率22.33%，同比上升1.98%。${missingTransportRowRefs}`,
    sources: [filing],
  })
  assert.equal(unsupportedWithoutValueRow.status, 'unsupported_numbers', 'the transportation row locator remains required for 22.33% and 1.98%')
})

test('segment gross-margin changes cannot borrow an equal-valued row from the other classification', () => {
  const candidateId = 'byd-product-industry-binding'
  const lines = [
    '单位：元',
    '营业收入 营业成本 毛利率 毛利率比上年同期增减',
    '分行业',
    '日用电子器件制造业 159,608,576,000.00 146,289,389,000.00 8.34% 34.60% 35.05% -0.30%',
    '交通运输设备及电气制造业 617,381,935,000.00 479,660,859,000.00 22.31% 27.70% 25.62% 1.29%',
    '分产品',
    '手机部件、组装及其他产品 159,608,576,000.00 146,289,389,000.00 8.34% 34.60% 35.05% -0.30%',
    '汽车、汽车相关产品及其他产品 617,381,935,000.00 479,660,859,000.00 22.31% 27.70% 25.62% 1.29%',
  ]
  const filing = { ...source, candidate: { ...source.candidate, candidateId }, title: '2024年年度报告', content: lines.join('\n') }
  const refsFor = (...paragraphs: number[]) => paragraphs.map(paragraph => `[${candidateId}@paragraph:${paragraph}]`).join(' ')
  const productClaim = '2024年分产品表汽车、汽车相关产品及其他产品毛利率同比上升1.29%。'
  const industryOnly = `${productClaim}${refsFor(1, 2, 3, 5)}`
  const productBound = `${productClaim}${refsFor(1, 2, 6, 8)}`
  assert.equal(validateCompanyNumericGrounding({ markdown: industryOnly, sources: [filing] }).status, 'unsupported_numbers', 'the identical industry row cannot support a product claim')
  assert.equal(validateCompanyNumericGrounding({ markdown: productBound, sources: [filing] }).status, 'grounded', 'the exact product classification and row support the same displayed cells')
  assert.equal(validateCompanyNumericGrounding({ markdown: productBound.replace('汽车、汽车相关产品及其他产品', '汽车电子产品'), sources: [filing] }).status, 'unsupported_numbers', 'a near-match product label cannot borrow the cited row')
  assert.equal(validateCompanyNumericGrounding({ markdown: productBound.replace('1.29%', '1.39%'), sources: [filing] }).status, 'unsupported_numbers', 'a wrong change-cell value cannot borrow the product row label')
})

test('R175 exact financial section binds the comparable period from its own value-cell annotation', () => {
  // Verbatim first-attempt R175 section, including preceding metric rows,
  // generic comparable-period header, same-cell date, equation, and citations.
  // Other numeric families remain outside this regression's prepared fixture;
  // isolate the consolidated-comparison diagnostic without whitelisting them.
  const markdown = "# 财务质量分析\n\n## 核心判断\n\n截至2026年上半年累计，营业收入同比下降7.13%，营业利润同比下降21.24%，结构化净利润（归母属性未注明）同比下降20.54%；合并毛利率为18.85%，较上年同期提高约0.84个百分点；经营现金净流量同比上升17.28%。利润与现金方向不一致：利润下行而经营现金流上升。以下金额均按人民币亿元列示；损益和现金流为年初至期末累计，资产负债为期末余额。[akshare-financial-002594@paragraph:1]\n\n| 指标 | 2026年上半年累计/期末 | 可比期间 | 变化 |\n|---|---:|---:|---:|\n| 营业收入（亿元，累计） | 3,448.15 | 3,712.81（2025年上半年累计） | 同比-7.13% |\n| 营业利润（亿元，累计） | 147.44 | 187.20（2025年上半年累计） | 同比-21.24% |\n| 净利润（结构化字段；归母属性未注明，亿元，累计） | 123.25 | 155.11（2025年上半年累计） | 同比-20.54% |\n| 合并毛利率（%） | 18.85% | 18.01%（2025年上半年） | 18.85%-18.01%=约0.84个百分点 |\n| 经营现金净流量（亿元，累计） | 373.35 | 318.33（2025年上半年累计） | 同比+17.28% |\n| 购建长期资产现金支出（亿元，累计） | 447.03 | 805.25（2025年上半年累计） | 同比-44.49% |\n| 简化自由现金流（亿元，2026年上半年累计） | 373.35-447.03=-73.68 | — | 经营现金净流量−购建长期资产现金支出；非FCFF |\n\n上述增长及毛利率变化由同口径结构化数据计算；结构化净利润字段未注明归母属性，不得解释为归母净利润。合并毛利率变动公式使用展示到两位小数的比率水平，因此表中为约值。[akshare-financial-002594@paragraph:1]\n\n## 现金转化与应计观察\n\n经营现金净流量高于结构化净利润字段，计算器现金转化比为3.03倍（373.35亿元÷123.25亿元）；分母归属范围未注明，故此比率保留“结构化净利润（归母属性未注明）”限制。结构化净利润口径应计代理比率为-2.74%，计算式为（123.25−373.35）÷[（8,837.30＋9,412.78）÷2]；分母采用2025年末与2026年6月末平均总资产。该代理的利润与合并现金流可能存在范围差异，不是标准应计比率，也不能据此断言利润质量或排除应计风险。[akshare-financial-002594@paragraph:1]\n\n经营现金流增而利润降，可视为当期现金实现相对账面利润较强的反证；但不能据此判定趋势持续。现金流与净利润比较受净利润归属口径限制，且缺少客户回款、供应商结算、税费、票据及季节性拆分，无法归因现金流变化。没有足够资料识别一次性损益项目及其对利润的影响。\n\n## 营运资本与现金周期\n\n确定性营运资本计算使用181天累计期间、期初与期末平均余额：DSO为22.87天，公式为((期初应收37,004,685,000元＋期末应收50,126,342,000元)÷2)÷累计收入344,815,421,000元×181天；DIO为106.21天，公式为((期初存货138,420,580,000元＋期末存货189,990,772,000元)÷2)÷累计营业成本279,826,859,000元×181天；DPO为117.43天，公式为((期初应付186,742,375,000元＋期末应付176,356,021,000元)÷2)÷累计营业成本279,826,859,000元×181天；CCC为11.65天，公式为22.87天＋106.21天−117.43天。以上为结构化计算器结果，非期末单点周转天数。[akshare-financial-002594@paragraph:1]\n\n按结构化同日历史序列对比，2025-06-30至2026-06-30，应收账款期末余额同比增长15.55%，存货期末余额同比增长34.90%，同期累计收入同比下降7.13%；应收余额增速减收入增速为15.5476%−(−7.1282%)=22.6758个百分点，存货余额增速减收入增速为34.8989%−(−7.1282%)=42.0271个百分点。收入是累计流量，另两者为期末余额，背离仅是核查信号，不证明收入确认或回款存在问题。[akshare-financial-002594@paragraph:1]\n\n半年报资产负债表原表比较列为“本报告期末／上年末”，因此其应收账款、存货和其他余额的原表比较只能解读为较上年末变化，不能称上年同期余额同比。结构化序列的同比是用2025-06-30与2026-06-30的期末数据另行计算，不是半年报原表直接披露的同比。[official-c19c34dd239b2e9c@paragraph:762] [akshare-financial-002594@paragraph:1]\n\n## 债务、资本投入与分部\n\n截至2026年6月末，结构化余额显示短期借款376.46亿元、长期借款612.01亿元、应付债券149.94亿元，另有“一年内到期非流动负债（含非借款项目）”34.53亿元；货币资金587.38亿元。半年报原表列示短期借款较上年末减少，长期借款较上年末增加；这些余额不能与期间现金流混为一谈。仅凭余额不足以判断净债务、可动用现金或再融资压力，缺少债务期限表、利率、限制性条款及现金受限情况。[akshare-financial-002594@paragraph:1] [official-c19c34dd239b2e9c@paragraph:762] [official-c19c34dd239b2e9c@paragraph:776] [official-c19c34dd239b2e9c@paragraph:778]\n\n2026年上半年累计资本开支（结构化购建长期资产现金支出）为447.03亿元，经营现金净流量373.35亿元，简化自由现金流为373.35−447.03=-73.68亿元；这是经营现金减购建长期资产现金支出的覆盖指标，不是FCFF，不应年化。资本开支较上年同期下降44.49%，但仍超过同期经营现金流，意味着扩张支出仍需由其他资金来源或现金储备补足。结构化研发费用为233.07亿元；所给半年报摘录未提供资本化研发金额，无法评价本期研发资本化对利润的影响。[akshare-financial-002594@paragraph:1]\n\n半年报分行业表显示：日用电子器件制造业毛利率5.04%，同比下降2.67%；交通运输设备及电气制造业毛利率22.33%，同比上升1.98%。原表变化列以百分号显示，故保留百分比披露口径，不改写为百分点。两个行业的毛利率水平差异明显，分行业表的变化单位也不等同合并毛利率的代码计算差额。行业金额以及收入、成本变动列不应替代毛利率变化。[official-c19c34dd239b2e9c@paragraph:716] [official-c19c34dd239b2e9c@paragraph:717] [official-c19c34dd239b2e9c@paragraph:724] [official-c19c34dd239b2e9c@paragraph:725] [official-c19c34dd239b2e9c@paragraph:726] [official-c19c34dd239b2e9c@paragraph:727] [official-c19c34dd239b2e9c@paragraph:728] [official-c19c34dd239b2e9c@paragraph:729] [official-c19c34dd239b2e9c@paragraph:730]\n\n## 风险、反证与监控\n\n公司特定的监控重点是应收账款、存货、经营现金流与资本开支的后续同口径变化。若后续收入恢复而应收和存货继续显著快于收入增长，可能增加回款周期、库存减值或现金占用压力；若经营现金流转弱而资本支出维持高位，外部融资和现金储备承担的资金缺口可能扩大。可观察指标包括同期间累计收入与经营现金流、期末应收及存货、减值准备、客户回款、应付账款以及债务到期与现金受限情况。已披露的现金转化比和较低于前期的资本开支是缓和因素，但不能消除余额增长背离和资金期限信息缺失所留下的残余风险。[akshare-financial-002594@paragraph:1]\n\n最强反证是经营现金流同比上升，而应收账款、存货相对上年同期虽增长，仍不能单凭余额增长判定回款恶化；合同负债增加也可能意味着已收取客户款项，但欠缺可核验的分项现金流和合同履约资料，不能将其作为确定解释。筛查结果仅提示后续核查，不构成舞弊、操纵或审计结论。"
  const preparedAnalysis = { financial: { ratioChanges: [{"metric":"grossMarginPercent","currentPeriod":"2026-06-30","priorPeriod":"2025-06-30","currentValue":18.84734789747121,"priorValue":18.00950448984525,"changePercentagePoints":0.8378434076259609,"displayChangePercentagePoints":0.84,"sourceCandidateIds":["akshare-financial-002594"]}] } }
  const diagnostics = (text: string, prepared: unknown = preparedAnalysis) => validateCompanyNumericGrounding({ markdown: text, sources: [], preparedAnalysis: prepared, trustedText: ['2025-06-30', '2026-06-30'] }).diagnostics.filter(diagnostic => diagnostic.token === '合并毛利率比较')
  assert.deepEqual(diagnostics(markdown), [])
  for (const invalid of [
    markdown.replace('| 合并毛利率（%） | 18.85%', '| 合并毛利率（%） | 19.85%'),
    markdown.replace('18.01%（2025年上半年）', '18.01%（2024年上半年）'),
    markdown.replace('18.01%（2025年上半年）', '18.01%（2025年第二季度）'),
    markdown.replace('2026年上半年累计/期末', '2026年第二季度单季'),
    markdown.replace('18.85%-18.01%=约0.84个百分点', '18.85%-18.01%=约0.94个百分点'),
    markdown.replace('18.01%（2025年上半年）', '18.01%'),
    markdown.replace('18.01%（2025年上半年）', '18.01%（2025年上半年/2026年上半年）'),
  ]) assert.ok(diagnostics(invalid).length > 0, 'wrong or ambiguous operand/period/basis must remain rejected')
  const wrongPrepared = structuredClone(preparedAnalysis)
  wrongPrepared.financial.ratioChanges[0]!.priorPeriod = '2025-03-31'
  assert.ok(diagnostics(markdown, wrongPrepared).length > 0, 'a different prepared period cannot borrow the H1 annotation')
})

test('consolidated gross-margin comparisons require the exact prepared ratio row and its cited source', () => {
  const candidateId = 'prepared-financial'
  const financial = { ...source, candidate: { ...source.candidate, candidateId, metadata: { dataProvenance: { metricId: 'company_financial_history' } } }, content: '2025年上半年累计营业收入3712.81亿元、营业利润187.20亿元、净利润155.11亿元、经营现金净流量318.33亿元；2026年上半年累计营业收入3448.15亿元、营业利润147.44亿元、净利润123.25亿元、经营现金净流量373.35亿元。合并毛利率2025年上半年18.0095%，2026年上半年18.8473%，变化0.8378个百分点。净利率2025年上半年4.1776%，2026年上半年3.5745%，变化-0.6031个百分点。' }
  const preparedAnalysis = { financial: { table: [{ period: '2025-06-30' }, { period: '2026-06-30' }], ratioChanges: [{
    metric: 'grossMarginPercent', currentPeriod: '2026-06-30', priorPeriod: '2025-06-30',
    currentValue: 18.84734789747121, priorValue: 18.00950448984525, unit: 'percentage_points',
    changePercentagePoints: 0.83784340762596, displayChangePercentagePoints: 0.84, sourceCandidateIds: [candidateId],
  }] } }
  const valid = `合并毛利率由2025年上半年的18.01%升至2026年上半年的18.85%，增加0.84个百分点。[${candidateId}@paragraph:1]`
  assert.equal(validateCompanyNumericGrounding({ markdown: valid, sources: [financial], preparedAnalysis }).status, 'grounded')
  assert.equal(validateCompanyNumericGrounding({ markdown: valid.replace('18.85%', '19.85%'), sources: [financial], preparedAnalysis }).status, 'unsupported_numbers', 'a token elsewhere in the cited source cannot replace the prepared current-period value')
  assert.equal(validateCompanyNumericGrounding({ markdown: valid.replace('0.84个百分点', '0.94个百分点'), sources: [financial], preparedAnalysis }).status, 'unsupported_numbers', 'the displayed difference must reconcile to the exact prepared comparison')
  assert.equal(validateCompanyNumericGrounding({ markdown: valid.replace(candidateId, 'unrelated-source'), sources: [financial], preparedAnalysis }).status, 'unsupported_numbers', 'the exact source id recorded by the prepared ratio is required')
  const table = `| 指标 | 2025年上半年累计 | 2026年上半年累计 | 同比或变化 |\n|---|---:|---:|---:|\n| 合并毛利率 | 18.01% | 18.85% | 18.85%−18.01%＝0.84个百分点 |`
  const section = `${valid}\n\n${table}`
  const tableResult = validateCompanyNumericGrounding({ markdown: section, sources: [financial], preparedAnalysis })
  assert.equal(tableResult.status, 'grounded', JSON.stringify(tableResult.diagnostics))
  assert.equal(validateCompanyNumericGrounding({ markdown: table, sources: [financial], preparedAnalysis }).status, 'unsupported_numbers', 'an uncited table cannot borrow a prepared comparison')
  assert.equal(validateCompanyNumericGrounding({ markdown: section.replace('2025年上半年累计', '2024年上半年累计'), sources: [financial], preparedAnalysis }).status, 'unsupported_numbers', 'a different table period cannot borrow the prepared ratio')

  const compactComparisonTable = `| 指标 | 可比期间方向与公式 |\n|---|---|\n| 合并毛利率 | 2026-06-30为18.85%，2025-06-30为18.01%；约上升0.84个百分点（18.85%−18.01%）。[${candidateId}@paragraph:1] |`
  assert.equal(validateCompanyNumericGrounding({ markdown: compactComparisonTable, sources: [financial], preparedAnalysis, trustedText: ['2025-06-30', '2026-06-30'] }).status, 'grounded', 'one comparison cell may bind both values only when each exact ISO period labels its prepared value')
  assert.equal(validateCompanyNumericGrounding({ markdown: compactComparisonTable.replace('2026-06-30为18.85%', '2025-06-30为18.85%'), sources: [financial], preparedAnalysis, trustedText: ['2025-06-30', '2026-06-30'] }).status, 'unsupported_numbers', 'a duplicated period label cannot bind both prepared values')
  assert.equal(validateCompanyNumericGrounding({ markdown: compactComparisonTable.replace('18.85%', '19.85%'), sources: [financial], preparedAnalysis, trustedText: ['2025-06-30', '2026-06-30'] }).status, 'unsupported_numbers', 'a period-labeled value must match the exact prepared value')

  const r171Table = `结构化财务摘要显示，合并毛利率由18.01%升至18.85%，差额为18.85%−18.01%＝约0.84个百分点（2025-06-30至2026-06-30，合并毛利率；结构化确定性比率变化）。[${candidateId}@paragraph:1]\n\n| 指标 | 2025年上半年累计 | 2026年上半年累计 | 代码同比结果 |\n|---|---:|---:|---:|\n| 营业收入（人民币亿元） | 3,712.81 | 3,448.15 | — |\n| 营业利润（人民币亿元） | 187.20 | 147.44 | — |\n| 结构化净利润（归母属性未注明；人民币亿元） | 155.11 | 123.25 | — |\n| 经营现金净流量（人民币亿元） | 318.33 | 373.35 | — |\n| 合并毛利率 | 18.01% | 18.85% | 18.85%−18.01%＝约0.84个百分点 |\n\n分行业表仅显示两个业务板块毛利率变化，不能替代合并毛利率，也不足以解释合并利润下降。`
  const r171Options = { sources: [financial], preparedAnalysis, trustedText: ['2025-06-30', '2026-06-30'] }
  const r171Result = validateCompanyNumericGrounding({ markdown: r171Table, ...r171Options })
  assert.equal(r171Result.status, 'grounded', JSON.stringify(r171Result.diagnostics))
  assert.equal(validateCompanyNumericGrounding({ markdown: r171Table.replace('| 合并毛利率 | 18.01% | 18.85% |', '| 合并毛利率 | 18.01% | 19.85% |'), ...r171Options }).status, 'unsupported_numbers', 'a later-row value mismatch fails closed even when the exact comparison is cited elsewhere')
  assert.equal(validateCompanyNumericGrounding({ markdown: r171Table.replace('| 指标 | 2025年上半年累计 | 2026年上半年累计 | 代码同比结果 |\n|---|---:|---:|---:|\n', ''), ...r171Options }).status, 'unsupported_numbers', 'omitted period headers fail closed even when the report contains the same values')

  const r172CurrentFirst = `合并口径毛利率由2025-06-30的18.01%升至2026-06-30的18.85%，差额为+0.84个百分点。[${candidateId}@paragraph:1]\n\n| 指标 | 2026年上半年累计 | 2025年上半年累计 | 可比变化 |\n|---|---:|---:|---:|\n| 合并毛利率（%） | 18.85% | 18.01% | 约+0.84个百分点 |`
  assert.equal(validateCompanyNumericGrounding({ markdown: r172CurrentFirst, ...r171Options }).status, 'grounded', 'current-first headers bind their own exact cells, including the optional percent label')
  const qualifiedMarginLabel = r172CurrentFirst.replace('合并毛利率（%）', '合并毛利率（半年累计，%）')
  assert.equal(validateCompanyNumericGrounding({ markdown: qualifiedMarginLabel, ...r171Options }).status, 'grounded', 'period qualifiers in a structured margin row label do not break exact source and period binding')
  const ytdMarginLabel = r172CurrentFirst.replace('合并毛利率（%）', '合并毛利率（YTD）')
  assert.equal(validateCompanyNumericGrounding({ markdown: ytdMarginLabel, ...r171Options }).status, 'grounded', 'an explicit YTD row label uses its exact cited structured periods even without repeating the source locator on the data row')
  const inlineMarginHeader = r172CurrentFirst.replace('\n\n| 指标 |', `\n\n结构化期间数据如下。[${candidateId}@paragraph:1] | 指标 |`)
  assert.equal(validateCompanyNumericGrounding({ markdown: inlineMarginHeader, ...r171Options }).status, 'grounded', 'an inline prose prefix before the table header does not hide the exact period columns')
  const r173CandidateId = 'akshare-financial-002594'
  const r173PreparedAnalysis = { ...preparedAnalysis, financial: { ...preparedAnalysis.financial, ratioChanges: [{ ...preparedAnalysis.financial.ratioChanges[0]!, sourceCandidateIds: [r173CandidateId] }] } }
  const r173Options = { sources: [financial], preparedAnalysis: r173PreparedAnalysis, trustedText: ['2025-06-30', '2026-06-30'] }
  const r173Section = `| 指标 | 2025年上半年累计 | 2026年上半年累计 | 可比变化 |\n|---|---:|---:|---:|\n| 合并毛利率 | 18.01% | 18.85% | 18.85%−18.01%＝约0.84个百分点 |\n\n上述合并指标及变化来自2025-06-30与2026-06-30同口径结构化期间值。净利润字段未注明归母属性。[${r173CandidateId}@paragraph:1]`
  const r173Result = validateCompanyNumericGrounding({ markdown: r173Section, ...r173Options })
  assert.equal(r173Result.status, 'grounded', `R173-style prior-first table can bind its exact same-section structured citation: ${JSON.stringify(r173Result.diagnostics)}`)
  assert.equal(validateCompanyNumericGrounding({ markdown: r173Section.replace('| 18.01% | 18.85% |', '| 18.01% | 18.01% |'), ...r173Options }).status, 'unsupported_numbers', 'a prior-period cell duplicated into the current-period column remains rejected')
  assert.equal(validateCompanyNumericGrounding({ markdown: r173Section.replace(r173CandidateId, 'unrelated-source'), ...r173Options }).status, 'unsupported_numbers', 'the table cannot borrow an uncited prepared row source')
  assert.equal(validateCompanyNumericGrounding({ markdown: `合并口径毛利率同期变化为0.84个百分点。[${candidateId}@paragraph:1]`, ...r171Options }).status, 'grounded', 'a point-only prose comparison may bind to the exact cited prepared gross-margin change')
  const mixedRatioFinding = `事实：合并毛利率水平由2025-06-30的18.01%至2026-06-30的18.85%，差额约0.84个百分点（18.85%−18.01%）；净利率同期由4.18%至3.57%，差额约-0.60个百分点。[${candidateId}@paragraph:1]`
  const withNetMargin = { ...preparedAnalysis, financial: { ...preparedAnalysis.financial, ratioChanges: [...preparedAnalysis.financial.ratioChanges, {
    metric: 'netMarginPercent', currentPeriod: '2026-06-30', priorPeriod: '2025-06-30', currentValue: 3.574494424946267, priorValue: 4.177573097556301,
    changePercentagePoints: -0.6030786726100335, displayChangePercentagePoints: -0.60, sourceCandidateIds: [candidateId],
  }] } }
  const mixedResult = validateCompanyNumericGrounding({ markdown: mixedRatioFinding, sources: [financial], preparedAnalysis: withNetMargin, trustedText: ['2025-06-30', '2026-06-30'] })
  assert.equal(mixedResult.status, 'grounded', JSON.stringify(mixedResult.diagnostics))
})

test('capitalized R&D values honor a unit declared inside the cited source row label', () => {
  const candidateId = 'official-f7c8d23d2829a5e8'
  const content = `${Array.from({length:2245},(_,index)=>`披露${index+1}`).join('\n')}\n研发投入资本化的金额（元） 5,463,274,000.00 966,219,000.00 465.43%\n资本化研发投入占研发投入的比例 8.61% 1.78% 6.83%\n报告期内研发投入资本化率大幅变动的原因及其合理性说明`
  const filing = { ...source, candidate: { ...source.candidate, candidateId }, title: '2025年年度报告', content }
  const evidenceContexts = [{ sourceCandidateId: candidateId, title: filing.title, publisher: 'CNINFO', excerpts: [2246,2247,2254].map(paragraph => ({ sourceCandidateId: candidateId, location: `paragraph:${paragraph}`, text: content.split('\n')[paragraph - 1]! })) }]
  const markdown = `事实：2025年度报告研发投入资本化金额及占研发投入比例分别列示为5,463,274,000元和8.61%；这是年度披露，不能替代本期半年资本化数据。[${candidateId}@paragraph:2246] [${candidateId}@paragraph:2247] [${candidateId}@paragraph:2254]`
  const result = validateCompanyNumericGrounding({ markdown, sources: [filing], evidenceContexts })
  assert.equal(result.status, 'grounded', JSON.stringify(result.diagnostics))
})

test('negative prepared ratio changes may be reported as a positive decrease magnitude', () => {
  const financial = { ...source, candidate: { ...source.candidate, candidateId: 'financial' }, content: 'structured source' }
  const preparedAnalysis = { financial: { ratioChanges: [{
    metric: 'liabilitiesToAssetsPercent', currentPeriod: '2026-06-30', priorPeriod: '2025-06-30',
    currentValue: 70.95749694991416, priorValue: 71.08142972302059,
    changePercentagePoints: -0.12393277310643214, sourceCandidateIds: ['financial'],
  }] } }
  const options = { sources: [financial], preparedAnalysis }
  assert.equal(validateCompanyNumericGrounding({ markdown: '负债/资产比率较上年同期低0.1239个百分点。[financial@paragraph:1]', ...options }).status, 'grounded')
  assert.equal(validateCompanyNumericGrounding({ markdown: '负债/资产比率较上年同期高0.1239个百分点。[financial@paragraph:1]', ...options }).status, 'unsupported_numbers')
})

test('split annual cash-dividend total keeps its exact yuan header bound to the amount cell', () => {
  const annual = { ...source, candidate: { ...source.candidate, candidateId: 'annual-dividend' }, title: '2025年年度报告', content: '利润分配方案\n现金分红总额（含其他方式）（元）\n3,263,956,728\n可分配利润（元） 3,504,244,000' }
  const packet = selectCompanyEvidence([annual], ['annual-dividend'], ['现金分红', '利润分配'], { purpose: 'capital_allocation_review' })[0]!
  const amount = packet.excerpts.find(row => row.location === 'paragraph:3')!
  assert.ok(amount.contextLocations?.includes('paragraph:2'), 'the exact adjacent table label must be supplied as amount context')
  assert.ok(packet.excerpts.some(row => row.location === 'paragraph:2'), 'the header locator must be present in the packet')
  const markdown = '2025年度现金分红总额为3,263,956,728元。[annual-dividend@paragraph:3]'
  const withContext = validateCompanyNumericGrounding({ markdown, sources: [annual], evidenceContexts: [{ sourceCandidateId: packet.sourceCandidateId, excerpts: packet.excerpts }] })
  assert.equal(withContext.status, 'grounded')
  const withoutContext = validateCompanyNumericGrounding({ markdown, sources: [annual] })
  assert.equal(withoutContext.status, 'unsupported_numbers', 'the number alone must not establish its metric or unit')
})

test('explicit capex/CFO comparisons must match the disclosed deterministic ratio for that exact period', () => {
  const preparedAnalysis={financial:{periodRatios:[{period:'2026-06-30',capexToOperatingCashFlowMultiple:447.03/373.35,sourceCandidateIds:['financial']},{period:'2025-12-31',capexToOperatingCashFlowMultiple:0.8,sourceCandidateIds:['financial']}]}}
  const check=(markdown:string, prepared:unknown=preparedAnalysis)=>validateCompanyNumericGrounding({markdown,sources:[],preparedAnalysis:prepared,trustedText:['2025年2026年2027年']})
  assert.equal(check('2026年上半年资本开支高于同期经营现金流。').status,'grounded')
  assert.deepEqual(check('2026年上半年资本开支低于同期经营现金流。').diagnostics.map(item=>item.token),['capex<CFO@2026-06-30'])
  assert.equal(check('2025年全年则资本开支低于经营现金流。').status,'grounded')
  assert.equal(check('2025年全年则资本开支高于经营现金流。').status,'unsupported_numbers')
  const equal={financial:{periodRatios:[{period:'2026-06-30',capexToOperatingCashFlowMultiple:1,sourceCandidateIds:['financial']}]}}
  assert.equal(check('2026年上半年资本开支等于同期经营现金流。',equal).status,'grounded')
  assert.equal(check('2026年上半年资本开支高于同期经营现金流。',equal).status,'unsupported_numbers')
  for(const text of ['上半年资本开支低于同期经营现金流。','2026年全年资本开支低于同期经营现金流。','2026年一季度资本开支低于同期经营现金流。','2027年上半年资本开支低于同期经营现金流。','假设2026年上半年资本开支低于同期经营现金流。','预计2026年上半年资本开支低于同期经营现金流。']) assert.equal(check(text).status,'grounded',text)
  assert.equal(check('2026年上半年资本开支低于同期经营现金流。',{financial:{periodRatios:[{period:'2026-06-30',sourceCandidateIds:['financial']}]}}).status,'grounded','missing ratios cannot establish a comparison')
  assert.equal(check('2026年上半年资本开支低于同期经营现金流。',{financial:{periodRatios:[...preparedAnalysis.financial.periodRatios,{period:'2026-06-30',capexToOperatingCashFlowMultiple:0.7,sourceCandidateIds:['other']} ]}}).status,'grounded','conflicting ratio inputs cannot establish a comparison')
})
test('numeric grounding accepts cited amounts and explicit unit conversion, not citation ID numbers', () => {
  const result = validateCompanyNumericGrounding({ markdown: '收入303.964亿元，研发2亿元。[filing-2025-003@paragraph:1]', sources: [source] })
  assert.equal(result.status, 'grounded')
})

test('explicit monetary units must agree with a cited local or global source unit', () => {
  const annual = { ...source, candidate: { ...source.candidate, candidateId: 'annual-goodwill' }, content: [
    '商誉及减值准备',
    '除特别说明外，本公司财务报表均以人民币千元为单位表示。',
    '被投资单位名称 | 期初余额 | 期末余额',
    'Juno Newco | 4,361,657 | 4,361,657',
    ...Array.from({ length: 32 }, (_, index) => `无关披露 ${index + 1}`),
    '客户销售金额表单位：元',
  ].join('\n') }
  const cited = '[annual-goodwill@paragraph:4] [annual-goodwill@paragraph:2]'
  assert.equal(validateCompanyNumericGrounding({ markdown: `商誉余额4,361,657千元。${cited}`, sources: [annual] }).status, 'grounded')
  const wrongUnit = validateCompanyNumericGrounding({ markdown: `商誉余额4,361,657元。${cited}`, sources: [annual] })
  assert.equal(wrongUnit.status, 'unsupported_numbers', 'same raw digits do not authorize a 1000x currency scale error')
  const unrelatedLocalUnit = validateCompanyNumericGrounding({ markdown: '商誉余额4,361,657元。[annual-goodwill@paragraph:4] [annual-goodwill@paragraph:36]', sources: [annual] })
  assert.equal(unrelatedLocalUnit.status, 'unsupported_numbers', 'a distant unrelated table unit cannot override the cited global convention')
  const uncitedUnit = validateCompanyNumericGrounding({ markdown: '商誉余额4,361,657元。[annual-goodwill@paragraph:4]', sources: [annual] })
  assert.equal(uncitedUnit.status, 'unsupported_numbers', 'an uncited global convention cannot establish a currency scale')
  const employeeTable = { ...annual, content: '单位：万元\n员工人数100人。' }
  assert.equal(validateCompanyNumericGrounding({ markdown: '员工薪酬为100万元。[annual-goodwill@paragraph:1] [annual-goodwill@paragraph:2]', sources: [employeeTable] }).status, 'unsupported_numbers', 'declared monetary units do not turn headcounts into financial values')
})

test('a negative goodwill movement is a supported positive amount only when the claim explicitly says decrease', () => {
  const filing = { ...source, title:'2025年年度报告', candidate:{...source.candidate,candidateId:'goodwill-movement'}, content:[
    '商誉原值',
    '单位：元',
    '被投资单位 年初余额 本年增加 本年减少 年末余额',
    '索尔思光电 2,825,093,512.48 -26,063,415.57 2,799,030,096.91',
  ].join('\n') }
  const refs='[goodwill-movement@paragraph:2] [goodwill-movement@paragraph:3] [goodwill-movement@paragraph:4]'
  const check=(claim:string)=>validateCompanyNumericGrounding({markdown:`${claim}。${refs}`,sources:[filing]})
  assert.equal(check('2025年索尔思光电商誉原值本年减少26,063,415.57元').status,'grounded')
  assert.equal(check('2025年索尔思光电商誉原值增加26,063,415.57元').status,'unsupported_numbers')
  assert.equal(check('2025年索尔思光电商誉原值变动26,063,415.57元').status,'unsupported_numbers')
})

test('supplier and customer amount columns inherit only their exact supplied table header unit', () => {
  const content = [
    '公司前五名供应商资料',
    '序号 供应商名称 采购额（元） 占年度采购总额比例',
    '1 供应商一 62,801,970,000.00 9.74%',
    '2 供应商二 9,877,728,000.00 1.53%',
    '另一张表的无关标题',
    '公司前五名客户资料',
    '序号 客户名称 销售额（元） 占年度销售总额比例',
    '1 客户一 12,500,000.00 2.00%',
    '1 第一名 18,642,838,150.75 46.46%',
  ].join('\n')
  const tableSource = { ...source, candidate: { ...source.candidate, candidateId: 'supplier-table' }, content }
  const excerpts = content.split('\n').map((text, index) => ({
    location: `paragraph:${index + 1}`,
    text,
    ...(index === 2 || index === 3 ? { contextLocations: ['paragraph:2'] } : index === 7 || index === 8 ? { contextLocations: ['paragraph:7'] } : {}),
  }))
  const check = (claim: string, locations: string) => validateCompanyNumericGrounding({
    markdown: `${claim} ${locations}`,
    sources: [tableSource],
    evidenceContexts: [{ sourceCandidateId: 'supplier-table', excerpts }],
  })
  assert.equal(check('最大供应商采购额为62801970000元。', '[supplier-table@paragraph:3]').status, 'grounded')
  assert.equal(check('另一供应商采购额为9877728000元。', '[supplier-table@paragraph:4]').status, 'grounded')
  assert.equal(check('客户销售额为12500000元。', '[supplier-table@paragraph:8]').status, 'grounded')
  assert.equal(check('最大单一客户销售额为18642838150.75元。', '[supplier-table@paragraph:9]').status, 'grounded')
  assert.equal(check('最大单一客户销售额为18642838150.76元。', '[supplier-table@paragraph:9]').status, 'unsupported_numbers')
  assert.equal(check('最大供应商采购额为62801970万元。', '[supplier-table@paragraph:3]').status, 'unsupported_numbers')
  const totalRowContent = [
    '公司前五名供应商资料',
    '序号 供应商名称 采购额（元） 占年度采购总额比例',
    '1 供应商一 62,801,970,000.00 9.74%',
    '合计 -- 98,700,166,000.00 15.31%',
  ].join('\n')
  const totalRowSource = { ...tableSource, content: totalRowContent }
  const totalRowExcerpts = totalRowContent.split('\n').map((text, index) => ({
    location: `paragraph:${index + 1}`,
    text,
    ...(index === 2 || index === 3 ? { contextLocations: ['paragraph:2'] } : {}),
  }))
  assert.equal(validateCompanyNumericGrounding({
    markdown: '前五名供应商采购额合计98700166000元，占年度采购总额15.31%。[supplier-table@paragraph:4]',
    sources: [totalRowSource],
    evidenceContexts: [{ sourceCandidateId: 'supplier-table', excerpts: totalRowExcerpts }],
  }).status, 'grounded', 'the total row in the exact supplier table inherits its amount unit from that table header')
  const customerTotalContent = [
    '公司前五名客户资料',
    '序号 客户名称 销售额（元） 占年度销售总额比例',
    '1 第一名 18,642,838,150.75 46.46%',
    '2 第二名 2,809,002,571.15 7.00%',
    '3 第三名 2,281,029,373.69 5.68%',
    '4 第四名 1,234,755,113.48 3.08%',
    '5 第五名 846,434,493.10 2.11%',
    '合计 -- 25,814,059,702.20 64.33%',
  ].join('\n')
  const customerTotalSource = { ...tableSource, content: customerTotalContent }
  const customerTotalExcerpts = customerTotalContent.split('\n').map((text, index) => ({ location: `paragraph:${index + 1}`, text }))
  assert.equal(validateCompanyNumericGrounding({
    markdown: '前五名客户销售额合计25,814,059,702.20元。[supplier-table@paragraph:2] [supplier-table@paragraph:8]',
    sources: [customerTotalSource],
    evidenceContexts: [{ sourceCandidateId: 'supplier-table', excerpts: customerTotalExcerpts }],
  }).status, 'grounded', 'the cited exact table header binds the consolidated total after the five customer rows')
  const unrelatedHeader = excerpts.map((excerpt) => excerpt.location === 'paragraph:3' ? { ...excerpt, contextLocations: ['paragraph:1'] } : excerpt)
  assert.equal(validateCompanyNumericGrounding({
    markdown: '最大供应商采购额为62801970000元。[supplier-table@paragraph:3]',
    sources: [tableSource],
    evidenceContexts: [{ sourceCandidateId: 'supplier-table', excerpts: unrelatedHeader }],
  }).status, 'unsupported_numbers')
})

test('vehicle sales revenue inherits 元 only from its exact supplied split operating-table header', () => {
  const content = [
    '产品类别 产能状况 快报产量 快报销量 销售收入（元）',
    '乘用车 4,479,392 4,479,392 4,545,423 541,917,643,000.00',
    '商用车 57,964 57,964 57,013 11,780,683,000.00',
    '注:产能状况指报告期产量，单位为辆。',
  ].join('\n')
  const tableSource = { ...source, candidate: { ...source.candidate, candidateId: 'vehicle-table' }, content }
  const excerpts = content.split('\n').map((text, index) => ({
    sourceCandidateId: 'vehicle-table',
    location: `paragraph:${index + 1}`,
    text,
    ...(index === 1 || index === 2 ? { contextLocations: ['paragraph:1', 'paragraph:4'] } : {}),
  }))
  const packets = [{ sourceCandidateId: 'vehicle-table', excerpts }]
  const check = (claim: string, packet = packets) => validateCompanyNumericGrounding({ markdown: claim, sources: [tableSource], evidenceContexts: packet })
  assert.equal(check('乘用车销售收入为541,917,643,000.00元。[vehicle-table@paragraph:2]').status, 'grounded')
  assert.equal(check('商用车销售收入为11,780,683,000.00元。[vehicle-table@paragraph:3]').status, 'grounded')
  assert.equal(check('乘用车产量4,479,392辆、销量4,545,423辆。[vehicle-table@paragraph:2]').status, 'grounded', 'the 元 header must scale only the final sales-revenue cell, not the count columns')
  const missingHeader = [{ sourceCandidateId: 'vehicle-table', excerpts: excerpts.filter(excerpt => excerpt.location !== 'paragraph:1') }]
  assert.equal(check('乘用车销售收入为541,917,643,000.00元。[vehicle-table@paragraph:2]', missingHeader).status, 'unsupported_numbers', 'an unprovided table header cannot authorize the 元 unit')
})

test('a distant supplied global currency convention applies only to a verified goodwill table row', () => {
  const goodwillLines = Array.from({ length: 8542 }, (_, index) => `其他附注 ${index + 1}`)
  goodwillLines[7023] = '本公司记账本位币和编制本财务报表所采用的货币均为人民币，除有特别说明外，均以人民币千元为单位表示。'
  goodwillLines[8534] = '19、商誉'
  goodwillLines[8535] = '（1）商誉原值'
  goodwillLines[8536] = '年初余额 本年增加 本年减少 年末余额'
  goodwillLines[8541] = 'Juno Newco 4,361,657 - - 4,361,657'
  const goodwillContent = goodwillLines.join('\n')
  const goodwillSource = { ...source, candidate: { ...source.candidate, candidateId: 'goodwill-global-unit' }, content: goodwillContent }
  const rowParagraph = 8542
  const goodwillEvidence = [{ sourceCandidateId: 'goodwill-global-unit', excerpts: [
    { location: 'paragraph:7024', text: goodwillLines[7023]!, },
    { location: `paragraph:${rowParagraph}`, text: goodwillLines[8541]!, contextLocations: ['paragraph:7024'] },
  ] }]
  const claim = `商誉余额4,361,657千元。[goodwill-global-unit@paragraph:${rowParagraph}]`
  assert.equal(validateCompanyNumericGrounding({ markdown: claim, sources: [goodwillSource], evidenceContexts: goodwillEvidence }).status, 'grounded')

  const operationalLines = [...goodwillLines]
  operationalLines[8534] = '营业收入'
  operationalLines[8535] = '营业收入 4,361,657'
  operationalLines[8536] = '同比增长'
  operationalLines[8541] = '营业收入 4,361,657'
  const operationalContent = operationalLines.join('\n')
  const operationalSource = { ...goodwillSource, candidate: { ...goodwillSource.candidate, candidateId: 'operating-row-global-unit' }, content: operationalContent }
  const operationalRowParagraph = 8542
  const operationalEvidence = [{ sourceCandidateId: 'operating-row-global-unit', excerpts: [
    { location: 'paragraph:7024', text: operationalLines[7023]! },
    { location: `paragraph:${operationalRowParagraph}`, text: operationalLines[8541]!, contextLocations: ['paragraph:7024'] },
  ] }]
  const operationalClaim = `营业收入4,361,657千元。[operating-row-global-unit@paragraph:${operationalRowParagraph}]`
  assert.equal(validateCompanyNumericGrounding({ markdown: operationalClaim, sources: [operationalSource], evidenceContexts: operationalEvidence }).status, 'unsupported_numbers', 'an adversarially attached global context must not scale an ordinary operating row')
})
test('a goodwill closing balance is not made negative by a preceding roll-forward header description', () => {
  const lines = Array.from({ length: 8548 }, (_, index) => `其他附注 ${index + 1}`)
  lines[7023] = '本公司记账本位币和编制本财务报表所采用的货币均为人民币，除有特别说明外，均以人民币千元为单位表示。'
  lines[8534] = '19、商誉'
  lines[8543] = '（2） 商誉减值准备'
  lines[8544] = '年初余额 本年增加 本年减少 年末余额'
  lines[8545] = '比亚迪汽车有限公司 4,796 - - 4,796'
  lines[8546] = '比亚迪电动大巴&卡车匈牙利有限公司 4,875 - - 4,875'
  lines[8547] = '合计 9,671 - - 9,671'
  const content = lines.join('\n')
  const candidateId = 'goodwill-impairment-rollforward'
  const filing = { ...source, candidate: { ...source.candidate, candidateId }, title: '2025年年度报告', content }
  const referencedParagraphs = [7024, 8544, 8545, 8546, 8547, 8548]
  const excerpts = referencedParagraphs.map(paragraph => ({
    sourceCandidateId: candidateId,
    location: `paragraph:${paragraph}`,
    text: lines[paragraph - 1]!,
    ...(paragraph >= 8546 ? { contextLocations: ['paragraph:7024'] } : {}),
  }))
  const evidenceContexts = [{ sourceCandidateId: candidateId, excerpts }]
  const refs = referencedParagraphs.slice(1).map(paragraph => `[${candidateId}@paragraph:${paragraph}]`).join(' ')
  const summary = `减值准备表另列年初余额、本年增加、本年减少、年末余额：比亚迪汽车有限公司4,796人民币千元；比亚迪电动大巴&卡车匈牙利有限公司4,875人民币千元；合计9,671人民币千元。${refs}`
  assert.equal(validateCompanyNumericGrounding({ markdown: summary, sources: [filing], evidenceContexts }).status, 'grounded')
  assert.equal(validateCompanyNumericGrounding({ markdown: `商誉减值准备减少4,796人民币千元。[${candidateId}@paragraph:8546]`, sources: [filing], evidenceContexts }).status, 'unsupported_numbers', 'an explicit decrease claim still has to match the cited sign')
})
test('a non-monetary supplied unit context does not crash or inherit the report-wide currency scale', () => {
  const shareholders = { ...source, candidate: { ...source.candidate, candidateId: 'shareholders' }, content: '除特别说明外，财务报表均以人民币千元为单位表示。\n单位：股\nHKSCC NOMINEES LIMITED 3,681,498,007' }
  const evidenceContexts = [{ sourceCandidateId: 'shareholders', excerpts: [
    { location: 'paragraph:3', text: 'HKSCC NOMINEES LIMITED 3,681,498,007', contextLocations: ['paragraph:2'] },
    { location: 'paragraph:2', text: '单位：股' },
  ] }]
  const result = validateCompanyNumericGrounding({ markdown: 'HKSCC NOMINEES LIMITED持股3,681,498,007股。[shareholders@paragraph:3] [shareholders@paragraph:2]', sources: [shareholders], evidenceContexts })
  assert.equal(result.status, 'grounded', JSON.stringify(result.diagnostics))
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

test('numeric grounding treats an adjacent ASCII percent subtraction as an operator, not a negative source value', () => {
  const growthSource = { ...source, content: '应收账款同比增长76.57%，营业收入累计同比增长63.95%，两者差12.62个百分点。' }
  const result = validateCompanyNumericGrounding({
    markdown: '应收账款同比增长76.57%，营业收入累计同比增长63.95%，两者差12.62个百分点（76.57%-63.95%）。[filing-2025-003@paragraph:1]',
    sources: [growthSource],
  })
  assert.equal(result.status, 'grounded', JSON.stringify(result.diagnostics))
})

test('parenthesized negative growth-rate operands ground only an arithmetically correct percentage-point spread', () => {
  const filing = { ...source, content: '存货期末余额同比增长34.8989%，营业收入上半年累计同比下降7.1282%。' }
  const refs = '[filing-2025-003@paragraph:1]'
  assert.equal(validateCompanyNumericGrounding({ markdown: `34.8989%−(−7.1282%)＝42.0271个百分点。${refs}`, sources: [filing] }).status, 'grounded')
  assert.equal(validateCompanyNumericGrounding({ markdown: `34.8989%−(−7.1282%)＝42.0272个百分点。${refs}`, sources: [filing] }).status, 'unsupported_numbers', 'the stated result must equal the explicit operands')
  assert.equal(validateCompanyNumericGrounding({ markdown: `34.8989%−(−7.1282%)＝42.0271个百分点。[filing-2025-003@paragraph:1]`, sources: [{ ...filing, content: '存货期末余额同比增长34.8989%。' }] }).status, 'unsupported_numbers', 'both operands must independently occur in cited evidence')
  assert.equal(validateCompanyNumericGrounding({ markdown: '34.8989%−7.1282%＝42.0271个百分点。[filing-2025-003@paragraph:1]', sources: [filing] }).status, 'unsupported_numbers', 'the signed negative operand cannot be silently changed to positive')
})

test('label-first percentage-point formula accepts a stated direction only when it agrees with the arithmetic', () => {
  const filing = { ...source, content: '研发投入占营业收入比例 2025年3.57% 2024年3.45%。' }
  const refs = '[filing-2025-003@paragraph:1]'
  assert.equal(validateCompanyNumericGrounding({ markdown: `本期比例−上期比例＝2025年3.57%−2024年3.45%＝上升0.12个百分点。${refs}`, sources: [filing] }).status, 'grounded')
  assert.equal(validateCompanyNumericGrounding({ markdown: `本期比例−上期比例＝2025年3.57%−2024年3.45%＝下降0.12个百分点。${refs}`, sources: [filing] }).status, 'unsupported_numbers', 'direction language must agree with the signed calculation')
})

test('a number explicitly rejected before its source-grounded correction is not treated as an asserted claim', () => {
  const filing = { ...source, content: '购建长期资产现金支出为5,253,357,960.45元。' }
  const refs = '[filing-2025-003@paragraph:1]'
  assert.equal(validateCompanyNumericGrounding({ markdown: `购建长期资产现金支出525.34亿元？否，原始金额为人民币5,253,357,960.45元。${refs}`, sources: [filing] }).status, 'grounded')
  assert.equal(validateCompanyNumericGrounding({ markdown: `购建长期资产现金支出525.34亿元。${refs}`, sources: [filing] }).status, 'unsupported_numbers', 'correction masking requires explicit rejection and a corrected-value cue')
})

test('numeric grounding treats an adjacent unit-bearing subtraction as an operator', () => {
  for (const subtraction of ['−', '-']) {
    const result = validateCompanyNumericGrounding({
      markdown: `现金转换周期为11.65天，公式为DSO+DIO−DPO＝22.87天+106.21天${subtraction}117.43天。[filing-2025-003@paragraph:1]`,
      sources: [source],
      preparedAnalysis: { dso: 22.87, dio: 106.21, dpo: 117.43, cycle: 11.65 },
    })
    assert.equal(result.status, 'grounded', JSON.stringify(result.diagnostics))
  }
  const money = validateCompanyNumericGrounding({ markdown: '简化自由现金流为373.35亿元-447.03亿元=-73.68亿元。[filing-2025-003@paragraph:1]', sources: [source], preparedAnalysis: { positiveCash: 37335000000, capex: 44703000000, result: -7368000000 } })
  assert.equal(money.status, 'grounded', JSON.stringify(money.diagnostics))
  for (const subtraction of ['−', '-']) {
    const narrativeFormula = validateCompanyNumericGrounding({ markdown: `自由现金流采用代码公式：373.35亿元经营现金净流量${subtraction}447.03亿元资本开支。[filing-2025-003@paragraph:1]`, sources: [source], preparedAnalysis: { positiveCash: 37335000000, capex: 44703000000, result: -7368000000 } })
    assert.equal(narrativeFormula.status, 'grounded', JSON.stringify(narrativeFormula.diagnostics))
  }
})

test('numeric grounding accepts a compact cash-conversion-cycle subtraction only when the complete prepared calculation matches', () => {
  const candidateId = 'financial-ccc'
  const filing = { ...source, candidate: { ...source.candidate, candidateId }, content: '结构化财务数据见本段。' }
  const preparedAnalysis = { financial: { workingCapitalCalculations: [
    { metric: 'DSO', period: '2026-06-30', daysInPeriod: 181, value: 66.38654197378288, formula: '((期初应收9,792,745,060.06元＋期末应收10,598,328,021.04元)÷2)÷本期累计收入27,797,683,972.88元×181天＝66.39天', sourceCandidateIds: [candidateId] },
    { metric: 'DIO', period: '2026-06-30', daysInPeriod: 181, value: 82.96053210629293, formula: '((期初存货8,928,944,182.01元＋期末存货11,417,997,322.49元)÷2)÷本期累计营业成本22,196,075,162.56元×181天＝82.96天', sourceCandidateIds: [candidateId] },
    { metric: 'DPO', period: '2026-06-30', daysInPeriod: 181, value: 117.33908416410956, formula: '((期初应付13,043,136,687.34元＋期末应付15,735,505,650.92元)÷2)÷本期累计营业成本22,196,075,162.56元×181天＝117.34天', sourceCandidateIds: [candidateId] },
    { metric: 'CCC', period: '2026-06-30', daysInPeriod: 181, value: 32.007989915966235, formula: 'DSO 66.39天＋DIO 82.96天−DPO 117.34天＝32.01天', sourceCandidateIds: [candidateId] },
  ] } }
  const refs = `[${candidateId}@paragraph:1]`
  const compact = `现金转换周期为32.01天，即66.39天＋82.96天−117.34天。${refs}`
  assert.equal(validateCompanyNumericGrounding({ markdown: compact, sources: [filing], preparedAnalysis }).status, 'grounded')

  const wrongCycle = `现金转换周期为31.01天，即66.39天＋82.96天−117.34天。${refs}`
  assert.equal(validateCompanyNumericGrounding({ markdown: wrongCycle, sources: [filing], preparedAnalysis }).status, 'unsupported_numbers', 'a wrong result must not unlock the negative-looking DPO operand')
  const wrongDpo = `现金转换周期为31.67天，即66.39天＋82.96天−117.68天。${refs}`
  assert.equal(validateCompanyNumericGrounding({ markdown: wrongDpo, sources: [filing], preparedAnalysis }).status, 'unsupported_numbers', 'all operands must match the prepared DSO/DIO/DPO values')
  const invalidAmountDays = `应付金额为-117.34元×181天；现金转换周期约32天。${refs}`
  assert.equal(validateCompanyNumericGrounding({ markdown: invalidAmountDays, sources: [filing], preparedAnalysis }).status, 'unsupported_numbers', 'a monetary amount multiplied by days is not a cash-conversion calculation')

  const bydId = 'akshare-financial-002594'
  const bydSource = { ...source, candidate: { ...source.candidate, candidateId: bydId }, content: '结构化财务数据见本段。' }
  const bydFormula = '((期初应收37,004,685,000元＋期末应收50,126,342,000元)÷2)÷本期累计收入344,815,421,000元×181天＝22.87天'
  const bydPrepared = { financial: { workingCapitalCalculations: [
    { metric: 'DSO', period: '2026-06-30', daysInPeriod: 181, value: 22.868344810773415, formula: bydFormula, sourceCandidateIds: [bydId] },
    { metric: 'DIO', period: '2026-06-30', daysInPeriod: 181, value: 106.21291845326398, formula: '((期初存货138,420,580,000元＋期末存货189,990,772,000元)÷2)÷本期累计营业成本279,826,859,000元×181天＝106.21天', sourceCandidateIds: [bydId] },
    { metric: 'DPO', period: '2026-06-30', daysInPeriod: 181, value: 117.4312035500495, formula: '((期初应付186,742,375,000元＋期末应付176,356,021,000元)÷2)÷本期累计营业成本279,826,859,000元×181天＝117.43天', sourceCandidateIds: [bydId] },
    { metric: 'CCC', period: '2026-06-30', daysInPeriod: 181, value: 11.6500597139879, formula: 'DSO 22.87天＋DIO 106.21天−DPO 117.43天＝11.65天', sourceCandidateIds: [bydId] },
  ] } }
  const bydClaim = `- 现金转换周期＝DSO 22.87天＋DIO 106.21天−DPO 117.43天＝11.65天。[${bydId}@paragraph:1]`
  const bydResult = validateCompanyNumericGrounding({ markdown: bydClaim, sources: [bydSource], preparedAnalysis: bydPrepared, trustedText: ['2026-06-30'] })
  assert.equal(bydResult.status, 'grounded', JSON.stringify(bydResult.diagnostics))
})

test('a prose calculation stated after a negative result keeps subtraction operands positive', () => {
  const preparedAnalysis = { freeCashFlowDifference: -7368322000, operatingCashFlow: 37334744000, capex: 44703066000 }
  for (const operator of ['−', '-']) {
    const result = validateCompanyNumericGrounding({
      markdown: `2026年上半年简化现金流差额为-73.68亿元，计算为373.35亿元${operator}447.03亿元；该累计覆盖指标不是FCFF。`,
      sources: [],
      preparedAnalysis,
      trustedText: ['2026年'],
    })
    assert.equal(result.status, 'grounded', JSON.stringify(result.diagnostics))
  }
})

test('labeled cash-flow formula keeps the capital-spending operand positive', () => {
  for (const [formula, prepared] of [
    ['373.35亿元经营现金净流量−447.03亿元资本开支＝-73.68亿元', { difference: -7368322000, operatingCashFlow: 37334744000, capex: 44703066000 }],
    ['简化自由现金流按318.33亿元−805.25亿元计算为-486.91亿元', { difference: -48691045000, operatingCashFlow: 31833471000, capex: 80524516000 }],
  ] as const) {
    const result = validateCompanyNumericGrounding({ markdown: `${formula}；非FCFF。`, sources: [], preparedAnalysis: prepared, trustedText: ['2026年', '2025年'] })
    assert.equal(result.status, 'grounded', JSON.stringify(result.diagnostics))
  }
})

test('simplified cash-flow wording keeps the second operand positive in a trailing-result formula', () => {
  const result = validateCompanyNumericGrounding({
    markdown: '2026年上半年累计简化现金流按23.84亿元−52.53亿元计算为-28.69亿元；该指标不是FCFF。',
    sources: [],
    preparedAnalysis: { result: -2869470684.35, operatingCashFlow: 2383887276.1, capex: 5253357960.45 },
    trustedText: ['2026年'],
  })
  assert.equal(result.status, 'grounded', JSON.stringify(result.diagnostics))
})

test('a sourced numeric finding treats the second operand after 依据为 as positive', () => {
  const result = validateCompanyNumericGrounding({
    markdown: '2025年简化经营现金流减资本开支为-976.72亿元，依据为591.36亿元−1,568.08亿元；属于同期间确定性结果。',
    sources: [],
    preparedAnalysis: { result: -97672000000, operatingCashFlow: 59135544000, capex: 156807853000 },
    trustedText: ['2025年'],
  })
  assert.equal(result.status, 'grounded', JSON.stringify(result.diagnostics))
})

test('a labelled formula using a colon keeps the second unit-bearing subtraction operand positive', () => {
  const result = validateCompanyNumericGrounding({
    markdown: '营业收入差额-264.65527亿元，公式：3,448.15421亿元−3,712.80948亿元＝-264.65527亿元。',
    sources: [],
    preparedAnalysis: { currentRevenue: 344815421000, priorRevenue: 371280948000, difference: -26465527000 },
  })
  assert.equal(result.status, 'grounded', JSON.stringify(result.diagnostics))
})

test('subtraction before a comparable period year does not turn the year into a negative numeric claim', () => {
  for (const operator of ['−', '-']) {
    const result = validateCompanyNumericGrounding({
      markdown: `同比公式为（本期值${operator}2025年上半年可比值）÷可比值；期间为2026年上半年。`,
      sources: [],
      trustedText: ['2025年', '2026年'],
    })
    assert.equal(result.status, 'grounded', JSON.stringify(result.diagnostics))
  }
})

test('subtraction between ISO period labels does not turn the prior year into a negative amount', () => {
  const preparedAnalysis = { financial: { growth: [{ unit: 'CNY', growthPercent: -7.1282, sourceCandidateIds: ['financial'] }] } }
  for (const operator of ['−', '-']) {
    const claim = `结构化同比公式为(2026-06-30累计营业收入${operator}2025-06-30累计营业收入)÷|2025-06-30累计营业收入|=-7.1282%；比较期间为2025-06-30至2026-06-30。[financial@paragraph:1]`
    const result = validateCompanyNumericGrounding({ markdown: claim, sources: [], preparedAnalysis, trustedText: ['2025-06-30', '2026-06-30'] })
    assert.equal(result.status, 'grounded', JSON.stringify(result.diagnostics))
  }
})

test('numeric grounding converts a cited explicitly yuan-denominated row into rounded hundred-million units', () => {
  const sourceWithYuan = { ...source, content: '研发投入金额（元） 63,441,379,000.00 54,160,964,000.00 17.13%' }
  const result = validateCompanyNumericGrounding({ markdown: '研发投入为634.41亿元。[filing-2025-003@paragraph:1]', sources: [sourceWithYuan] })
  assert.equal(result.status, 'grounded', JSON.stringify(result.diagnostics))
  const tableSource = { ...source, content: '主营业务分行业数据\n单位：元\n日用电子器件制造业 69,404,994,000.00 65,907,931,000.00 5.04%' }
  const evidenceContexts = [{ sourceCandidateId: 'filing-2025-003', excerpts: [
    { location: 'paragraph:3', text: '日用电子器件制造业 69,404,994,000.00 65,907,931,000.00 5.04%', contextLocations: ['paragraph:2'] },
    { location: 'paragraph:2', text: '单位：元' },
  ] }]
  const row = validateCompanyNumericGrounding({ markdown: '日用电子器件制造业收入为694.05亿元。[filing-2025-003@paragraph:3]', sources: [tableSource], evidenceContexts })
  assert.equal(row.status, 'grounded', JSON.stringify(row.diagnostics))
})

test('numeric grounding preserves a spaced negative percentage in source tables', () => {
  for (const separator of ['-', '−']) {
    const tableSource = { ...source, content: `汽车产品毛利率20.49%，同比变动7.53% ${separator}1.82%。` }
    const result = validateCompanyNumericGrounding({
      markdown: '汽车产品毛利率同比下降1.82%。[filing-2025-003@paragraph:1]',
      sources: [tableSource],
    })
    assert.equal(result.status, 'grounded', JSON.stringify(result.diagnostics))
  }
})

test('gross-margin levels and changes preserve the exact percent units shown by the supplied table', () => {
  const table = { ...source, content: '单位：元\n营业收入 营业成本 毛利率\n营业收入比上年同期增减 营业成本比上年同期增减 毛利率比上年同期增减\n日用电子器件制造业 69,404,994,000.00 65,907,931,000.00 5.04% 0.96% 3.88% -2.67%' }
  const refs = '[filing-2025-003@paragraph:1] [filing-2025-003@paragraph:2] [filing-2025-003@paragraph:3] [filing-2025-003@paragraph:4]'
  const valid = '营业收入同比增长0.96%，营业成本同比增长3.88%，毛利率为5.04%，毛利率同比下降2.67%。'
  assert.equal(validateCompanyNumericGrounding({ markdown: `${valid}${refs}`, sources: [table] }).status, 'grounded')
  assert.equal(validateCompanyNumericGrounding({ markdown: `毛利率同比下降2.67个百分点。${refs}`, sources: [table] }).status, 'unsupported_numbers')
  const mixed = { ...source, content: '毛利率20%，营业收入同比增长2%。' }
  assert.equal(validateCompanyNumericGrounding({ markdown: '营业收入同比增长2%。[filing-2025-003@paragraph:1]', sources: [mixed] }).status, 'grounded')
  assert.equal(validateCompanyNumericGrounding({ markdown: '营业收入同比提高2个百分点。[filing-2025-003@paragraph:1]', sources: [mixed] }).status, 'unsupported_numbers')
  const mixedDecline = { ...source, content: '毛利率20%，营业收入同比下降2%。' }
  assert.equal(validateCompanyNumericGrounding({ markdown: '营业收入同比下降2%。[filing-2025-003@paragraph:1]', sources: [mixedDecline] }).status, 'grounded')
  assert.equal(validateCompanyNumericGrounding({ markdown: '营业收入同比下降2个百分点。[filing-2025-003@paragraph:1]', sources: [mixedDecline] }).status, 'unsupported_numbers')
})

test('split annual-report margin-change headers preserve the final table percentage as printed', () => {
  const content = Array.from({ length: 10 }, (_, index) => `unrelated ${index + 1}`)
  content.push('单位：元', '营业收入 营业成本 毛利率', '比上年同', '期增减', '营业成本', '比上年同', '期增减', '毛利率比', '上年同期', '增减', '分行业', '日用电子器件制造业 69,404,994,000.00 65,907,931,000.00 5.04% 0.96% 3.88% -2.67%', '交通运输设备及电气制造业 275,341,358,000.00 213,863,297,000.00 22.33% -8.98% -11.24% 1.98%')
  const annual = { ...source, candidate: { ...source.candidate, candidateId: 'half-year' }, content: content.join('\n') }
  const check = (markdown: string) => validateCompanyNumericGrounding({ markdown: `${markdown}[half-year@paragraph:11] [half-year@paragraph:17] [half-year@paragraph:18] [half-year@paragraph:19] [half-year@paragraph:20] [half-year@paragraph:21] [half-year@paragraph:22] [half-year@paragraph:23]`, sources: [annual] })
  assert.equal(check('电子器件毛利率同比下降2.67%。').status, 'grounded')
  assert.equal(check('交通运输设备及电气制造业毛利率同比上升1.98个百分点。').status, 'unsupported_numbers')
  assert.equal(check('交通运输设备及电气制造业毛利率同比上升1.98%。').status, 'grounded')
  const mixed = { ...source, candidate: { ...source.candidate, candidateId: 'mixed-tables' }, content: '毛利率比上年同期增减\n行业A 20% 3%\n营业收入同比增减\n行业B收入100元 8% 2%' }
  const refs = '[mixed-tables@paragraph:1] [mixed-tables@paragraph:3] [mixed-tables@paragraph:4]'
  assert.equal(validateCompanyNumericGrounding({ markdown: `行业B收入同比增长2%。${refs}`, sources: [mixed] }).status, 'grounded', 'a new revenue table header ends an earlier margin-change header scope')
  assert.equal(validateCompanyNumericGrounding({ markdown: `行业B收入同比增长2个百分点。${refs}`, sources: [mixed] }).status, 'unsupported_numbers')
})

test('BYD half-year segment margin changes require the complete split header citations', () => {
  const content = [
    '营业收入 营业成本 毛利率',
    '毛利率比',
    '上年同期',
    '增减',
    '分行业',
    '日用电子器件制造业 69,404,994,000.00 65,907,931,000.00 5.04% 0.96% 3.88% -2.67%',
  ].join('\n')
  const halfYear = { ...source, candidate: { ...source.candidate, candidateId: 'byd-half-year' }, content }
  const incompleteHeaderRefs = '[byd-half-year@paragraph:1] [byd-half-year@paragraph:2] [byd-half-year@paragraph:6]'
  const completeHeaderRefs = `${incompleteHeaderRefs} [byd-half-year@paragraph:3] [byd-half-year@paragraph:4]`
  const claim = '日用电子器件制造业毛利率5.04%，同比下降2.67%。'

  assert.equal(
    validateCompanyNumericGrounding({ markdown: `${claim}${incompleteHeaderRefs}`, sources: [halfYear] }).status,
    'unsupported_numbers',
    'the row has four percentage columns; the cited header fragments do not identify the final one as a margin change',
  )
  assert.equal(
    validateCompanyNumericGrounding({ markdown: `${claim}${completeHeaderRefs}`, sources: [halfYear] }).status,
    'grounded',
    'the full split header establishes the row cell as a margin change while preserving its printed percent unit',
  )
})

test('industry margin changes bind to the exact named row, final margin column, and disclosed direction', () => {
  const content = [
    '单位：元',
    '营业收入 营业成本 毛利率',
    '营业收入 比上年同期 增减',
    '营业成本 比上年同期 增减',
    '毛利率比',
    '上年同期',
    '增减',
    '分行业',
    '日用电子器件制造业 69,404,994,000.00 65,907,931,000.00 5.04% 0.96% 3.88% -2.67%',
    '交通运输设备及电气制',
    '造业 275,341,358,000.00 213,863,297,000.00 22.33% -8.98% -11.24% 1.98%',
  ].join('\n')
  const annual = { ...source, candidate: { ...source.candidate, candidateId: 'industry-margin' }, content }
  const refs = Array.from({ length: 11 }, (_, index) => `[industry-margin@paragraph:${index + 1}]`).join(' ')
  const check = (claim: string, citations = refs) => validateCompanyNumericGrounding({ markdown: `${claim}。${citations}`, sources: [annual], trustedText: ['2026年'] })

  assert.equal(check('2026年上半年交通运输设备及电气制造业毛利率同比上升1.98%', refs).status, 'grounded')
  assert.equal(check('2026年上半年交通运输设备及电气制造业毛利率同比上升1.98个百分点', refs).status, 'unsupported_numbers')
  assert.equal(check('2026年半年度报告分行业分类中，交通运输设备及电气制造业毛利率为22.33%，毛利率比上年同期增减为1.98%；后者是原表百分比变动，不表示毛利率水平上升1.98个百分点', refs).status, 'grounded', 'a cited percentage followed by an explicitly denied percentage-point interpretation is not a second unit claim')
  assert.equal(check('2026年上半年交通运输设备及电气制造业毛利率同比上升1.98个百分点；原表1.98%不表示该百分点变化', refs).status, 'unsupported_numbers', 'a disclaimed value must not erase an earlier asserted wrong-unit claim')
  assert.equal(check('2026年上半年交通运输设备及电气制造业毛利率同比下降1.98个百分点', refs).status, 'unsupported_numbers', 'the claim direction must agree with the cited row sign')
  assert.equal(check('2026年上半年交通运输设备及电气制造业毛利率同比上升8.98个百分点', refs).status, 'unsupported_numbers', 'revenue growth in the same row cannot be reused as margin change')
  assert.equal(check('2026年上半年交通运输设备及电气制造业毛利率同比下降2.67个百分点', refs).status, 'unsupported_numbers', 'the same metric from another industry row cannot be borrowed')
  const withoutContinuation = refs.split(' ').filter(ref => ref !== '[industry-margin@paragraph:11]').join(' ')
  assert.equal(check('2026年上半年交通运输设备及电气制造业毛利率同比上升1.98个百分点', withoutContinuation).status, 'unsupported_numbers', 'the split numeric continuation row is required')
  const reportFramingRefs = `${refs} [industry-margin@paragraph:12] [industry-margin@paragraph:13] [industry-margin@paragraph:14] [industry-margin@paragraph:15]`
  assert.equal(check('事实：半年度分行业表报告日用电子器件制造业毛利率同比下降2.67%；交通运输设备及电气制造业毛利率同比上升1.98%', reportFramingRefs).status, 'grounded', 'enumerated method/report framing must not become part of the exact row label')
  assert.equal(check('事实：半年度分行业表报告日用电子部件制造业毛利率同比下降2.67个百分点', reportFramingRefs).status, 'unsupported_numbers', 'a near-match row label must still fail exact industry attribution')
  assert.equal(check('事实：半年报分行业披露日用电子器件制造业毛利率5.04%，同比下降2.67%，收入同比增长0.96%', reportFramingRefs).status, 'grounded', 'the exact allowed report preamble is stripped while all numeric cells remain row-bound')
  assert.equal(check('事实：半年报分行业披露日用电子部件制造业毛利率5.04%，同比下降2.67个百分点', reportFramingRefs).status, 'unsupported_numbers', 'the report preamble cannot make a near-match row label valid')
})

test('industry margin guard recognizes an uncited split section heading only for the exact cited row', () => {
  const content = [
    '单位：元',
    '营业收入 营业成本 毛利率',
    '营业收入', '比上年同', '期增减',
    '营业成本', '比上年同', '期增减',
    '毛利率比', '上年同期', '增减',
    '分行业',
    '日用电子器件制造业 69,404,994,000.00 65,907,931,000.00 5.04% 0.96% 3.88% -2.67%',
    '交通运输设备及电气制',
    '造业 275,341,358,000.00 213,863,297,000.00 22.33% -8.98% -11.24% 1.98%',
    '分产品',
    '电子及其他产品 69,404,994,000.00 65,907,931,000.00 5.04% 0.96% 3.88% -2.67%',
  ].join('\n')
  const filing = { ...source, candidate: { ...source.candidate, candidateId: 'split-industry-heading' }, content }
  const headerRefs = Array.from({ length: 11 }, (_, index) => `[split-industry-heading@paragraph:${index + 1}]`).join(' ')
  const check = (claim: string, rows: readonly number[]) => validateCompanyNumericGrounding({
    markdown: `${claim}。${headerRefs} ${rows.map(row => `[split-industry-heading@paragraph:${row}]`).join(' ')}`,
    sources: [filing],
  })

  assert.equal(check('日用电子器件制造业毛利率同比下降2.67%', [13]).status, 'grounded')
  assert.equal(check('交通运输设备及电气制造业毛利率同比上升1.98%', [14, 15]).status, 'grounded')
  assert.equal(check('交通运输设备及电气制造业毛利率同比下降1.98个百分点', [14, 15]).status, 'unsupported_numbers')
  assert.equal(check('交通运输设备及电气制造业毛利率同比上升2.67个百分点', [14, 15]).status, 'unsupported_numbers')
  assert.equal(check('交通运输设备及电气制造业毛利率同比上升1.98个百分点', [14]).status, 'unsupported_numbers', 'the continued row cell remains required')
})

test('industry margin attribution joins a split row label only from adjacent cited label fragments', () => {
  const content = [
    '单位：元',
    '营业收入 营业成本 毛利率',
    '营业收入比上年同期增减',
    '营业成本比上年同期增减',
    '毛利率比上年同期增减',
    '分行业',
    '计算机、通信和',
    '其他电子',
    '27,347,867,868.08 21,929,134,042.30 19.81% 63.21% 51.01% 6.48%',
  ].join('\n')
  const filing = { ...source, candidate: { ...source.candidate, candidateId: 'split-industry-label' }, content }
  const refs = Array.from({ length: 9 }, (_, index) => `[split-industry-label@paragraph:${index + 1}]`).join(' ')
  const check = (label: string, citations = refs) => validateCompanyNumericGrounding({ markdown: `${label}。${citations}`, sources: [filing] })

  assert.equal(check('计算机、通信和其他电子行业毛利率同比上升6.48%').status, 'grounded')
  assert.equal(check('计算机、通信其他电子行业毛利率同比上升6.48%').status, 'unsupported_numbers', 'near-match category names must not pass')
  const withoutFirstLabel = refs.split(' ').filter((ref) => ref !== '[split-industry-label@paragraph:7]').join(' ')
  assert.equal(check('计算机、通信和其他电子行业毛利率同比上升6.48%', withoutFirstLabel).status, 'unsupported_numbers', 'the split category prefix must be cited')
})

test('a split product gross-margin header more than sixteen paragraphs above the row still binds its final column', () => {
  const content = Array.from({length: 855}, (_, index) => `boilerplate ${index + 1}`)
  content[837] = '毛利率比上'
  content[838] = '年同期增减'
  content[854] = '648,645,636,000.00 515,762,940,000.00 20.49% 5.06% 7.53% -1.82%'
  const annual = { ...source, candidate: { ...source.candidate, candidateId: 'byd-annual' }, content: content.join('\n') }
  const refs = '[byd-annual@paragraph:838] [byd-annual@paragraph:839] [byd-annual@paragraph:855]'
  assert.equal(validateCompanyNumericGrounding({ markdown: `汽车相关产品毛利率同比下降1.82%。${refs}`, sources: [annual] }).status, 'grounded')
})

test('capitalized R&D ratio change preserves the disclosed change-column percent unit', () => {
  const content = '2025 年 2024 年 变动比例\n研发投入资本化的金额（元） 5,463,274,000.00 966,219,000.00 465.43%\n资本化研发投入占研发投入的比例 8.61% 1.78% 6.83%'
  const annual = { ...source, candidate: { ...source.candidate, candidateId: 'byd-annual' }, content }
  const refs = '[byd-annual@paragraph:1] [byd-annual@paragraph:3]'
  assert.equal(validateCompanyNumericGrounding({ markdown: `研发投入资本化率由1.78%升至8.61%，原表变动比例为6.83%。${refs}`, sources: [annual] }).status, 'grounded')
  assert.equal(validateCompanyNumericGrounding({ markdown: `研发投入资本化金额同比增长465.43个百分点。[byd-annual@paragraph:2]`, sources: [annual] }).status, 'unsupported_numbers')
  assert.equal(validateCompanyNumericGrounding({ markdown: `研发投入资本化率同比下降6.83个百分点。${refs}`, sources: [annual] }).status, 'unsupported_numbers')
})

test('annual R&D-to-revenue ratio change preserves the original change-column unit',()=>{
  const content='2025 年 2024 年 变动比例\n研发投入占营业收入比例 7.89% 6.97% 0.92%'
  const annual={...source,candidate:{...source.candidate,candidateId:'byd-annual'},content}
  assert.equal(validateCompanyNumericGrounding({markdown:'研发投入占营业收入比例原表变动为0.92%。[byd-annual@paragraph:1] [byd-annual@paragraph:2]',sources:[annual]}).status,'grounded')
  assert.equal(validateCompanyNumericGrounding({markdown:'研发投入占营业收入比例上升0.92个百分点。[byd-annual@paragraph:1] [byd-annual@paragraph:2]',sources:[annual]}).status,'unsupported_numbers','the disclosed change cell uses percent; an independently calculated percentage-point difference needs an explicit equation')
  assert.equal(validateCompanyNumericGrounding({markdown:'研发投入占营业收入比例原表变动为0.92%。[byd-annual@paragraph:2]',sources:[annual]}).status,'grounded','the exact disclosed change cell is directly cited')
})

test('a separate R&D ratio percentage-point calculation accepts a plain subtraction equation',()=>{
  const content='2025 年 2024 年 变动比例\n研发投入占营业收入比例 3.57% 3.45% 0.12%'
  const annual={...source,candidate:{...source.candidate,candidateId:'annual-rd-ratio'},content}
  const refs='[annual-rd-ratio@paragraph:1] [annual-rd-ratio@paragraph:2]'
  assert.equal(validateCompanyNumericGrounding({markdown:`原表变动比例为0.12%；独立计算两期比率水平之差：3.57%−3.45%＝0.12个百分点。${refs}`,sources:[annual]}).status,'grounded')
  assert.equal(validateCompanyNumericGrounding({markdown:`原表变动比例为0.12%；独立计算两期比率水平之差：2025年3.57%−2024年3.45%＝0.12个百分点。${refs}`,sources:[annual]}).status,'grounded')
  assert.equal(validateCompanyNumericGrounding({markdown:`原表变动比例为0.12%；独立计算本期比例−上期比例，即3.57%−3.45%，为0.12个百分点。${refs}`,sources:[annual]}).status,'grounded','the explicitly named formula and operands may precede a Chinese result clause')
  assert.equal(validateCompanyNumericGrounding({markdown:`原表变动比例为0.12%；本期比例−上期比例＝2025年3.57%−2024年3.45%＝0.12个百分点。${refs}`,sources:[annual]}).status,'grounded','the labelled formula may precede its year-labelled operands')
  assert.equal(validateCompanyNumericGrounding({markdown:`本期比例−上期比例＝2025年3.57%−2024年3.45%＝0.13个百分点。${refs}`,sources:[annual]}).status,'unsupported_numbers','labelled formulas still verify the arithmetic')
  assert.equal(validateCompanyNumericGrounding({markdown:`本期比例−上期比例，即3.57%−3.45%，为0.13个百分点。${refs}`,sources:[annual]}).status,'unsupported_numbers','the prose formula still validates its arithmetic')
  assert.equal(validateCompanyNumericGrounding({markdown:`原表0.12%即上升0.12个百分点。${refs}`,sources:[annual]}).status,'unsupported_numbers','a raw percent change must not be relabeled as percentage points')
})

test('annual R&D change-column values retain the disclosed percent unit',()=>{
  const content='2025 年 2024 年 变动比例\n研发投入资本化的金额（元） 5,463,274,000.00 966,219,000.00 465.43%\n资本化研发投入占研发投入的比例 8.61% 1.78% 6.83%'
  const annual={...source,candidate:{...source.candidate,candidateId:'byd-annual'},content}
  const refs='[byd-annual@paragraph:1] [byd-annual@paragraph:3]'
  assert.equal(validateCompanyNumericGrounding({markdown:`资本化研发投入占比原表变动6.83%。${refs}`,sources:[annual]}).status,'grounded')
  assert.equal(validateCompanyNumericGrounding({markdown:`资本化研发投入占比变动6.83个百分点。${refs}`,sources:[annual]}).status,'unsupported_numbers','the printed percent sign must not be silently reinterpreted as percentage points')
})

test('BYD annual R&D split header binds only the two cited ratio rows at their exact report locations',()=>{
  const lines=Array.from({length:2247},(_,index)=>`未引用段落 ${index+1}`)
  lines[2241]='公司研发投入情况'
  lines[2242]='2025 年 2024 年 变动比例'
  lines[2243]='研发投入金额（元） 63,441,379,000.00 54,160,964,000.00 17.13%'
  lines[2244]='研发投入占营业收入比例 7.89% 6.97% 0.92%'
  lines[2245]='研发投入资本化的金额（元） 5,463,274,000.00 966,219,000.00 465.43%'
  lines[2246]='资本化研发投入占研发投入的比例 8.61% 1.78% 6.83%'
  const annual={...source,candidate:{...source.candidate,candidateId:'official-f7c8d23d2829a5e8',title:'2025年年度报告'},title:'2025年年度报告',content:lines.join('\n')}
  const exactRefs='[official-f7c8d23d2829a5e8@paragraph:2243] [official-f7c8d23d2829a5e8@paragraph:2245] [official-f7c8d23d2829a5e8@paragraph:2247]'
  assert.equal(validateCompanyNumericGrounding({markdown:`研发投入占营业收入比例原表变动0.92%，资本化研发投入占研发投入比例原表变动6.83%。${exactRefs}`,sources:[annual]}).status,'grounded')
  assert.equal(validateCompanyNumericGrounding({markdown:'研发投入占营业收入比例上升0.92个百分点。[official-f7c8d23d2829a5e8@paragraph:2245]',sources:[annual]}).status,'unsupported_numbers','the data row alone does not identify the percentage-change column')
})

test('currency-labelled subtraction formula preserves its signed calculated result', () => {
  const financialSource={...source,candidate:{...source.candidate,candidateId:'akshare-financial-002594'},content:'2026年上半年经营现金净流量373.35亿元，购建长期资产现金支出447.03亿元。'}
  const formula = '2026年上半年简化现金流差额为人民币373.35亿元−人民币447.03亿元＝人民币−73.68亿元。[akshare-financial-002594@paragraph:1]'
  const row={period:'2026-06-30',basis:'YTD',unit:'CNY',operatingCashFlow:37334744000,capex:44703066000,value:-7368322000,displayUnit:'亿元',displayOperatingCashFlow:'373.35',displayCapex:'447.03',displayValue:'-73.68',formula:'373.35亿元−447.03亿元＝-73.68亿元',sourceCandidateIds:['akshare-financial-002594']}
  const result = validateCompanyNumericGrounding({ markdown: formula, sources: [financialSource], preparedAnalysis: { financial: { simpleFreeCashFlow: [row] } } })
  assert.equal(result.status, 'grounded', JSON.stringify(result.diagnostics))
  const naturalLanguageResult = validateCompanyNumericGrounding({ markdown: '2026年上半年累计简化自由现金流为373.35亿元经营现金净流量减447.03亿元购建长期资产现金支出，即-73.68亿元。[akshare-financial-002594@paragraph:1]', sources: [financialSource], preparedAnalysis: { financial: { simpleFreeCashFlow: [row] } } })
  assert.equal(naturalLanguageResult.status, 'grounded', JSON.stringify(naturalLanguageResult.diagnostics))
  const smallerFinancialSource = { ...financialSource, content: '2026年上半年经营现金净流量23.84亿元，购建长期资产现金支出52.53亿元。' }
  const resultAfterChineseCue = validateCompanyNumericGrounding({ markdown: '简化自由现金流等于2026年上半年累计经营现金净流量23.84亿元减购建长期资产现金支出52.53亿元，得-28.69亿元，不应年化。[akshare-financial-002594@paragraph:1]', sources: [smallerFinancialSource], preparedAnalysis: { financial: { simpleFreeCashFlow: [{ ...row, operatingCashFlow: 2383887276.1, capex: 5253357960.45, value: -2869470684.35, displayOperatingCashFlow: '23.84', displayCapex: '52.53', displayValue: '-28.69', formula: '23.84亿元−52.53亿元＝-28.69亿元' }] } } })
  assert.equal(resultAfterChineseCue.status, 'grounded', JSON.stringify(resultAfterChineseCue.diagnostics))
  const markerAfterSign = '2026年上半年累计简化自由现金流为人民币373.35亿元−人民币447.03亿元＝-人民币73.68亿元。[akshare-financial-002594@paragraph:1]'
  assert.equal(validateCompanyNumericGrounding({ markdown: markerAfterSign, sources: [financialSource], preparedAnalysis: { financial: { simpleFreeCashFlow: [row] } } }).status, 'grounded', 'an equation result may place the RMB marker after its negative sign')
  const proseNegativeWithCurrency = '2026年上半年累计经营现金流低于购建长期资产支出，简化自由现金流为−人民币73.68亿元。[akshare-financial-002594@paragraph:1]'
  assert.equal(validateCompanyNumericGrounding({ markdown: proseNegativeWithCurrency, sources: [financialSource], preparedAnalysis: { financial: { simpleFreeCashFlow: [row] } } }).status, 'grounded', 'a prose result cue must retain the negative sign when currency follows it')
  const boldNegative = markerAfterSign.replace('＝-人民币73.68亿元', '＝**-人民币73.68亿元**')
  assert.equal(validateCompanyNumericGrounding({ markdown: boldNegative, sources: [financialSource], preparedAnalysis: { financial: { simpleFreeCashFlow: [row] } } }).status, 'grounded', 'paired Markdown emphasis must not detach a minus sign from the prepared result')
  assert.equal(validateCompanyNumericGrounding({ markdown: markerAfterSign.replace('＝-人民币73.68', '＝人民币73.68'), sources: [financialSource], preparedAnalysis: { financial: { simpleFreeCashFlow: [row] } } }).status, 'unsupported_numbers', 'positive FCFF cannot substitute the negative prepared result')
  assert.equal(validateCompanyNumericGrounding({ markdown: markerAfterSign.replace('73.68亿元', '73.69亿元'), sources: [financialSource], preparedAnalysis: { financial: { simpleFreeCashFlow: [row] } } }).status, 'unsupported_numbers', 'rounding tolerance cannot absorb a changed two-decimal result')
  assert.equal(validateCompanyNumericGrounding({ markdown: markerAfterSign.replace('2026年上半年', '2025年上半年'), sources: [financialSource], preparedAnalysis: { financial: { simpleFreeCashFlow: [row] } } }).status, 'unsupported_numbers', 'the prepared value cannot be borrowed across periods')
  assert.equal(validateCompanyNumericGrounding({ markdown: markerAfterSign.replace('[akshare-financial-002594@paragraph:1]', ''), sources: [financialSource], preparedAnalysis: { financial: { simpleFreeCashFlow: [row] } } }).status, 'unsupported_numbers', 'the exact prepared source must be cited')
})

test('prepared simple FCF display values require matching cited source IDs, period, and display unit',()=>{
  const financialSource={...source,candidate:{...source.candidate,candidateId:'akshare-financial-002594'},content:'2026年上半年经营现金净流量373.35亿元，购建长期资产现金支出447.03亿元。'}
  const row={period:'2026-06-30',basis:'YTD',unit:'CNY',operatingCashFlow:37334744000,capex:44703066000,value:-7368322000,displayUnit:'亿元',displayOperatingCashFlow:'373.35',displayCapex:'447.03',displayValue:'-73.68',formula:'373.35亿元−447.03亿元＝-73.68亿元',sourceCandidateIds:['akshare-financial-002594']}
  const preparedAnalysis={financial:{simpleFreeCashFlow:[row]}}
  const good='2026年上半年简化自由现金流为-73.68亿元。[akshare-financial-002594@paragraph:1]'
  const goodResult=validateCompanyNumericGrounding({markdown:good,sources:[financialSource],preparedAnalysis})
  assert.equal(goodResult.status,'grounded',JSON.stringify(goodResult.diagnostics))
  const labeledFormula='2026年上半年累计简化自由现金流为负73.68亿元；公式：373.35亿元−447.03亿元＝负73.68亿元。[akshare-financial-002594@paragraph:1]'
  assert.equal(validateCompanyNumericGrounding({markdown:labeledFormula,sources:[financialSource],preparedAnalysis}).status,'grounded','a negative result following repeated period wording must retain an unambiguous sign')
  const table='| 期间 | 金额（人民币亿元） |\n| --- | ---: |\n| 2026年上半年简化自由现金流 | -73.68 | [akshare-financial-002594@paragraph:1] |'
  const tableResult=validateCompanyNumericGrounding({markdown:table,sources:[financialSource],preparedAnalysis})
  assert.equal(tableResult.status,'grounded',JSON.stringify(tableResult.diagnostics))
  assert.equal(validateCompanyNumericGrounding({markdown:'2025年上半年简化自由现金流为-73.68亿元。[akshare-financial-002594@paragraph:1]',sources:[financialSource],preparedAnalysis}).status,'unsupported_numbers','a prepared value cannot be borrowed across periods')
  assert.equal(validateCompanyNumericGrounding({markdown:'2026年上半年简化自由现金流为-73.68亿元。',sources:[financialSource],preparedAnalysis}).status,'unsupported_numbers','the prepared value requires its exact source candidate to be cited')
  assert.equal(validateCompanyNumericGrounding({markdown:'2026年上半年简化自由现金流为-73.68万元。[akshare-financial-002594@paragraph:1]',sources:[financialSource],preparedAnalysis}).status,'unsupported_numbers','the prepared display unit cannot be changed')
})

test('prepared simple FCF accepts an explicit unit inside its matching cumulative value cell only',()=>{
  const candidateId='dongshan-fcf-financial'
  const financialSource={...source,candidate:{...source.candidate,candidateId},content:'2026年上半年经营现金净流量20.00亿元，购建长期资产现金支出48.69亿元。'}
  const otherSource={...source,candidate:{...source.candidate,candidateId:'other-financial'},content:'其他现金流披露。'}
  const row={period:'2026-06-30',basis:'YTD',unit:'CNY',operatingCashFlow:2000000000,capex:4869000000,value:-2869000000,displayUnit:'亿元',displayOperatingCashFlow:'20.00',displayCapex:'48.69',displayValue:'-28.69',formula:'20.00亿元−48.69亿元＝-28.69亿元',sourceCandidateIds:[candidateId]}
  const preparedAnalysis={financial:{simpleFreeCashFlow:[row]}}
  const table='| 指标 | 结果 | 说明 |\n| --- | --- | --- |\n| 简化自由现金流 | 2026年上半年累计，人民币亿元：-28.69 | — | [dongshan-fcf-financial@paragraph:1]'
  const grounded=validateCompanyNumericGrounding({markdown:table,sources:[financialSource],preparedAnalysis})
  assert.equal(grounded.status,'grounded',JSON.stringify(grounded.diagnostics))
  assert.equal(validateCompanyNumericGrounding({markdown:table.replace('2026年上半年','2025年上半年'),sources:[financialSource],preparedAnalysis}).status,'unsupported_numbers','the unit in a value cell cannot bypass its prepared period')
  assert.equal(validateCompanyNumericGrounding({markdown:table.replace('人民币亿元','人民币万元'),sources:[financialSource],preparedAnalysis}).status,'unsupported_numbers','the explicit value-cell unit must match the prepared display unit')
  assert.equal(validateCompanyNumericGrounding({markdown:table.replace('dongshan-fcf-financial','other-financial'),sources:[financialSource,otherSource],preparedAnalysis}).status,'unsupported_numbers','a different cited source cannot license the prepared value-cell result')
})

test('prepared simple FCF table grounds its displayed cash-flow operands and result only for the exact source period and unit',()=>{
  const candidateId='company-fcf-table-source'
  const financialSource={...source,candidate:{...source.candidate,candidateId},content:'{"kind":"financial","rows":[] }'}
  const rows=[
    {period:'2025-12-31',basis:'YTD',unit:'CNY',operatingCashFlow:5307141746.99,capex:4383254216.35,value:923887530.64,displayUnit:'亿元',displayOperatingCashFlow:'53.07',displayCapex:'43.83',displayValue:'9.24',formula:'53.07亿元−43.83亿元＝9.24亿元',sourceCandidateIds:[candidateId]},
    {period:'2026-06-30',basis:'YTD',unit:'CNY',operatingCashFlow:2383887276.1,capex:5253357960.45,value:-2869470684.35,displayUnit:'亿元',displayOperatingCashFlow:'23.84',displayCapex:'52.53',displayValue:'-28.69',formula:'23.84亿元−52.53亿元＝-28.69亿元',sourceCandidateIds:[candidateId]},
  ]
  const preparedAnalysis={financial:{simpleFreeCashFlow:rows}}
  const table='表内金额单位为人民币亿元。\n| 期间 | 经营现金流（人民币亿元） | 资本开支（人民币亿元） | 简化自由现金流（人民币亿元） | 公式 |\n|---|---:|---:|---:|---|\n| 2025全年 | 53.07 [company-fcf-table-source@paragraph:1] | 43.83 [company-fcf-table-source@paragraph:1] | 9.24 [company-fcf-table-source@paragraph:1] | 53.07亿元−43.83亿元＝9.24亿元 [company-fcf-table-source@paragraph:1] |\n| 2026年上半年累计 | 23.84 [company-fcf-table-source@paragraph:1] | 52.53 [company-fcf-table-source@paragraph:1] | 负28.69 [company-fcf-table-source@paragraph:1] | 23.84亿元−52.53亿元＝负28.69亿元 [company-fcf-table-source@paragraph:1] |'
  const trustedText=['2025-12-31','2026-06-30']
  const grounded=validateCompanyNumericGrounding({markdown:table,sources:[financialSource],preparedAnalysis,trustedText})
  assert.equal(grounded.status,'grounded',JSON.stringify(grounded.diagnostics))
  assert.equal(validateCompanyNumericGrounding({markdown:table.replace('52.53','52.54'),sources:[financialSource],preparedAnalysis,trustedText}).status,'unsupported_numbers','a changed calculator operand must not inherit the prepared period/source result')
  assert.equal(validateCompanyNumericGrounding({markdown:table.replace('2025全年','2024全年'),sources:[financialSource],preparedAnalysis,trustedText}).status,'unsupported_numbers','the annual operand and result cannot be borrowed across periods')
})

test('prepared FCF values in comparison tables bind each signed result to its own period column',()=>{
  const candidateId='akshare-financial-002594'
  const financialSource={...source,candidate:{...source.candidate,candidateId},content:'2026年上半年经营现金净流量373.35亿元，购建长期资产现金支出447.03亿元；2025年上半年经营现金净流量318.33亿元，购建长期资产现金支出805.25亿元。'}
  const rows=[
    {period:'2026-06-30',basis:'YTD',unit:'CNY',operatingCashFlow:37334744000,capex:44703066000,value:-7368322000,displayUnit:'亿元',displayOperatingCashFlow:'373.35',displayCapex:'447.03',displayValue:'-73.68',formula:'373.35亿元−447.03亿元＝-73.68亿元',sourceCandidateIds:[candidateId]},
    {period:'2025-06-30',basis:'YTD',unit:'CNY',operatingCashFlow:31833471000,capex:80524516000,value:-48691045000,displayUnit:'亿元',displayOperatingCashFlow:'318.33',displayCapex:'805.25',displayValue:'-486.91',formula:'318.33亿元−805.25亿元＝-486.91亿元',sourceCandidateIds:[candidateId]},
  ]
  const preparedAnalysis={financial:{simpleFreeCashFlow:rows}}
  const table='| 指标（人民币亿元） | 2026年上半年 | 2025年上半年 |\n| --- | ---: | ---: |\n| 简化自由现金流 | -73.68 | -486.91 | [akshare-financial-002594@paragraph:1]'
  const tableResult=validateCompanyNumericGrounding({markdown:table,sources:[financialSource],preparedAnalysis})
  assert.equal(tableResult.status,'grounded',JSON.stringify(tableResult.diagnostics))
  const rowUnitTable='| 指标 | 2026年上半年 | 2025年上半年 |\n| --- | ---: | ---: |\n| 简化自由现金流（累计，亿元） | -73.68 | -486.91 | [akshare-financial-002594@paragraph:1]'
  const rowUnitResult=validateCompanyNumericGrounding({markdown:rowUnitTable,sources:[financialSource],preparedAnalysis})
  assert.equal(rowUnitResult.status,'grounded',JSON.stringify(rowUnitResult.diagnostics))
  const wrongRowUnitTable=rowUnitTable.replace('（累计，亿元）','（累计，万元）')
  assert.equal(validateCompanyNumericGrounding({markdown:wrongRowUnitTable,sources:[financialSource],preparedAnalysis}).status,'unsupported_numbers','the row unit must match the prepared display unit')
  const swapped='| 指标（人民币亿元） | 2026年上半年 | 2025年上半年 |\n| --- | ---: | ---: |\n| 简化自由现金流 | -486.91 | -73.68 | [akshare-financial-002594@paragraph:1]'
  assert.equal(validateCompanyNumericGrounding({markdown:swapped,sources:[financialSource],preparedAnalysis}).status,'unsupported_numbers','prepared values cannot be reassigned to another period column')
  const wrongSign='| 指标（人民币亿元） | 2026年上半年 | 2025年上半年 |\n| --- | ---: | ---: |\n| 简化自由现金流 | 73.68 | -486.91 | [akshare-financial-002594@paragraph:1]'
  assert.equal(validateCompanyNumericGrounding({markdown:wrongSign,sources:[financialSource],preparedAnalysis}).status,'unsupported_numbers','the prepared signed result must be preserved')
})

test('prepared FCF formula duplicate survives a repaired citation after the closing table pipe only on the exact result row',()=>{
  const candidateId='akshare-financial-002594'
  const financialSource={...source,candidate:{...source.candidate,candidateId},content:'2026年上半年经营现金净流量373.35亿元，购建长期资产现金支出447.03亿元。'}
  const row={period:'2026-06-30',basis:'YTD',unit:'CNY',operatingCashFlow:37334744000,capex:44703066000,value:-7368322000,displayUnit:'亿元',displayOperatingCashFlow:'373.35',displayCapex:'447.03',displayValue:'-73.68',formula:'373.35亿元−447.03亿元＝-73.68亿元',sourceCandidateIds:[candidateId]}
  const preparedAnalysis={financial:{simpleFreeCashFlow:[row]}}
  // This mirrors repairCompanyMethodCitations' post-repair shape: the exact
  // authorized locator is appended after the row's closing Markdown pipe.
  const repaired='| 指标 | 2026年上半年累计结果 | 公式及口径 |\n|---|---:|---|\n| 简化自由现金流（人民币亿元） | -73.68 | 373.35亿元经营现金净流量−447.03亿元购建长期资产现金支出＝-73.68亿元；非FCFF。 | [akshare-financial-002594@paragraph:1]'
  const exact=validateCompanyNumericGrounding({markdown:repaired,sources:[financialSource],preparedAnalysis})
  assert.equal(exact.status,'grounded',JSON.stringify(exact.diagnostics))

  const unrelated=repaired.replace('简化自由现金流（人民币亿元）','其他指标（人民币亿元）')
  const rejected=validateCompanyNumericGrounding({markdown:unrelated,sources:[financialSource],preparedAnalysis})
  assert.equal(rejected.status,'unsupported_numbers','an unrelated row cannot inherit the result-cell period for a repeated formula value')

  const wrongPeriodHeader=repaired.replace('2026年上半年累计结果','2025年上半年累计结果')
  assert.equal(validateCompanyNumericGrounding({markdown:wrongPeriodHeader,sources:[financialSource],preparedAnalysis}).status,'unsupported_numbers','the result column must carry the prepared period')
})

test('prepared annual FCF accepts the natural Chinese period form 2025年度 and rejects another year',()=>{
  const candidateId='akshare-financial-002594'
  const financialSource={...source,candidate:{...source.candidate,candidateId},content:'2025年度资本开支1,568.08亿元，经营现金净流量591.36亿元。'}
  const row={period:'2025-12-31',basis:'YTD',unit:'CNY',operatingCashFlow:59135544000,capex:156807853000,value:-97672309000,displayUnit:'亿元',displayOperatingCashFlow:'591.36',displayCapex:'1,568.08',displayValue:'-976.72',formula:'591.36亿元−1,568.08亿元＝-976.72亿元',sourceCandidateIds:[candidateId]}
  const preparedAnalysis={financial:{simpleFreeCashFlow:[row]}}
  assert.equal(validateCompanyNumericGrounding({markdown:'2025年度简化差额为-976.72亿元。[akshare-financial-002594@paragraph:1]',sources:[financialSource],preparedAnalysis}).status,'grounded')
  assert.equal(validateCompanyNumericGrounding({markdown:'2024年度简化差额为-976.72亿元。[akshare-financial-002594@paragraph:1]',sources:[financialSource],preparedAnalysis}).status,'unsupported_numbers')
})

test('large share counts may be normalized to 亿股 without treating 亿 as a currency scale',()=>{
  const shareSource={...source,content:'本集团已通过配售129,800,000股新H股。'}
  assert.equal(validateCompanyNumericGrounding({markdown:'本集团配售1.298亿股新H股。[filing-2025-003@paragraph:1]',sources:[shareSource]}).status,'grounded')
  assert.equal(validateCompanyNumericGrounding({markdown:'本集团募集资金1.298亿元。[filing-2025-003@paragraph:1]',sources:[shareSource]}).status,'unsupported_numbers','share counts cannot establish currency amounts')
})

test('numeric grounding requires a growth-divergence sign to match the deterministic result', () => {
  const spread = { financial: { growthDivergences: [{ unit: 'percentage_points' as const, value: 12.6234, sourceCandidateIds: ['filing-2025-003'] }] } }
  assert.equal(validateCompanyNumericGrounding({ markdown: '增长背离为12.62%。[filing-2025-003@paragraph:1]', sources: [source], preparedAnalysis: spread }).status, 'unsupported_numbers', 'a percentage-point calculation cannot be borrowed as a percentage')
  assert.equal(validateCompanyNumericGrounding({ markdown: '增长背离为12.62个百分点。[filing-2025-003@paragraph:1]', sources: [source], preparedAnalysis: spread }).status, 'grounded')
  const result = validateCompanyNumericGrounding({
    markdown: '经营现金流增速高于收入增速24.41个百分点。[filing-2025-003@paragraph:1]',
    sources: [source],
    preparedAnalysis: { financial: { growthDivergences: [{ unit: 'percentage_points', value: -24.409578, sourceCandidateIds: ['filing-2025-003'] }] } },
  })
  assert.equal(result.status, 'unsupported_numbers', 'positive phrasing must not match a negative computed gap')
  const negative = validateCompanyNumericGrounding({
    markdown: '收入增速减经营现金流增速为-24.41个百分点。[filing-2025-003@paragraph:1]',
    sources: [source],
    preparedAnalysis: { financial: { growthDivergences: [{ unit: 'percentage_points', value: -24.409578, sourceCandidateIds: ['filing-2025-003'] }] } },
  })
  assert.equal(negative.status, 'grounded', JSON.stringify(negative.diagnostics))
})

test('numeric grounding checks higher/lower growth wording against the named deterministic divergence', () => {
  const sourceWithGrowth = { ...source, candidate: { ...source.candidate, candidateId: 'annual' }, content: '财务摘要。' }
  const preparedAnalysis = { financial: { growthDivergences: [{ leftMetric: 'receivables', rightMetric: 'revenue', unit: 'percentage_points', value: 12.62, sourceCandidateIds: ['annual'] }] } }
  const valid = validateCompanyNumericGrounding({ markdown: '应收账款增速高于收入增速12.62个百分点。[annual@paragraph:1]', sources: [sourceWithGrowth], preparedAnalysis })
  assert.equal(valid.status, 'grounded', JSON.stringify(valid.diagnostics))
  const contradictory = validateCompanyNumericGrounding({ markdown: '应收账款增速低于收入增速12.62个百分点。[annual@paragraph:1]', sources: [sourceWithGrowth], preparedAnalysis })
  assert.equal(contradictory.status, 'unsupported_numbers')
  assert.match(contradictory.diagnostics.at(-1)?.reason ?? '', /contradicts deterministic/)
})

test('numeric grounding treats one hundred million as a fixed yuan-to-yuan-hundred-million conversion factor', () => {
  const result = validateCompanyNumericGrounding({
    markdown: '收入303.964亿元，按人民币元换算亿元：30,396,400,000÷100,000,000＝303.964亿元。[filing-2025-003@paragraph:1]',
    sources: [source],
  })
  assert.equal(result.status, 'grounded', JSON.stringify(result.diagnostics))
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

test('numeric grounding carries a shared decline direction across separately percent-marked figures', () => {
  const financial = { ...source, content: '营业收入同比下降7.1282%，归母净利润同比下降20.5352%。' }
  const preparedAnalysis = { financial: { growth: [
    { metric: 'revenue', growthPercent: -7.128167, sourceCandidateIds: ['filing-2025-003'] },
    { metric: 'netProfit', growthPercent: -20.535239, sourceCandidateIds: ['filing-2025-003'] },
  ] } }
  const result = validateCompanyNumericGrounding({
    markdown: '营业收入、归母净利润分别下降7.1282%和20.5352%。[filing-2025-003@paragraph:1]',
    sources: [financial],
    preparedAnalysis,
  })
  assert.equal(result.status, 'grounded', JSON.stringify(result.diagnostics))
})

test('numeric grounding carries one decline direction across an enumerated percent list with repeated approximation markers', () => {
  const financial = { ...source, content: '结构化财务数据。' }
  const preparedAnalysis = { financial: { growth: [
    { metric: 'revenue', growthPercent: -7.128167265937922, sourceCandidateIds: ['filing-2025-003'] },
    { metric: 'operatingProfit', growthPercent: -21.239504732736314, sourceCandidateIds: ['filing-2025-003'] },
    { metric: 'netProfit', growthPercent: -20.535238859941177, sourceCandidateIds: ['filing-2025-003'] },
  ] } }
  const markdown = '营业收入、营业利润及净利润分别同比下降约7.13%、约21.24%及约20.54%。[filing-2025-003@paragraph:1]'
  const grounded = validateCompanyNumericGrounding({ markdown, sources: [financial], preparedAnalysis })
  assert.equal(grounded.status, 'grounded', JSON.stringify(grounded.diagnostics))

  const wrongValueDirection = { financial: { growth: [
    { metric: 'revenue', growthPercent: -7.128167265937922, sourceCandidateIds: ['filing-2025-003'] },
    { metric: 'operatingProfit', growthPercent: 21.239504732736314, sourceCandidateIds: ['filing-2025-003'] },
    { metric: 'netProfit', growthPercent: -20.535238859941177, sourceCandidateIds: ['filing-2025-003'] },
  ] } }
  assert.equal(validateCompanyNumericGrounding({ markdown, sources: [financial], preparedAnalysis: wrongValueDirection }).status, 'unsupported_numbers', 'shared decline wording cannot ground a positive prepared value')
  assert.equal(validateCompanyNumericGrounding({ markdown: markdown.replace('下降', '增长'), sources: [financial], preparedAnalysis }).status, 'unsupported_numbers', 'shared growth wording cannot ground negative prepared values')
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

test('financial methods may cite exact CNY-to-readable-unit conversions from the deterministic prepared table', () => {
  const financial = {...source,candidate:{...source.candidate,metadata:{dataProvenance:{metricId:'company_financial_history'}}}}
  const preparedAnalysis = prepareCompanyFinancialAnalysis({company:{symbol:'002384'},asOf:'2026-10-15',sources:[financial],financialData:[{periodEnd:'2026-06-30',metrics:{revenue:27797683972.88},metricMetadata:{revenue:{unit:'CNY',currency:'CNY',basis:'YTD'}},pointInTimeSafe:false,pointInTimeStatus:'CURRENT_VALUE_ONLY'}]})
  assert.equal(validateCompanyNumericGrounding({markdown:'收入为277.9768397288亿元。[filing-2025-003@paragraph:1]',sources:[financial],preparedAnalysis}).status,'grounded')
  assert.equal(validateCompanyNumericGrounding({markdown:'收入为277.9768397288亿元。',sources:[financial],preparedAnalysis}).status,'unsupported_numbers','CNY conversion needs a citation to the bound structured source')
})

test('simple free cash flow may use a unit declared in its explicit period column header', () => {
  const financial = {...source,candidate:{...source.candidate,candidateId:'financial'}}
  const preparedAnalysis = {financial:{simpleFreeCashFlow:[{period:'2026-06-30',basis:'YTD',unit:'CNY',operatingCashFlow:37334744000,capex:44703066000,value:-7368322000,displayUnit:'亿元',displayOperatingCashFlow:'373.35',displayCapex:'447.03',displayValue:'-73.68',formula:'373.35亿元−447.03亿元＝-73.68亿元',sourceCandidateIds:['financial']}]}}
  const markdown = `| 指标 | 2026年上半年累计（亿元） | 2025年上半年累计（亿元） |
|---|---:|---:|
| 简化自由现金流 | -73.68 | — | [financial@paragraph:1]`
  const trustedText = ['2026年','2025年']
  assert.equal(validateCompanyNumericGrounding({markdown,sources:[financial],preparedAnalysis,trustedText}).status,'grounded')
  assert.equal(validateCompanyNumericGrounding({markdown:markdown.replace('2026年上半年累计（亿元）','2026年上半年累计').replace('2025年上半年累计（亿元）','2025年上半年累计'),sources:[financial],preparedAnalysis,trustedText}).status,'unsupported_numbers','a period header without a monetary unit cannot ground a bare amount')
  assert.equal(validateCompanyNumericGrounding({markdown:markdown.replace('-73.68','-74.68'),sources:[financial],preparedAnalysis,trustedText}).status,'unsupported_numbers','the exact prepared display amount remains required')
})

test('Unicode mathematical minus preserves deterministic negative growth operands', () => {
  const preparedAnalysis={financial:{growth:[{metric:'operatingCashFlow',growthPercent:-4.649010334339855}]}}
  assert.equal(validateCompanyNumericGrounding({markdown:'经营现金流同比增速为−4.6490%。',sources:[],preparedAnalysis}).status,'grounded')
  assert.equal(validateCompanyNumericGrounding({markdown:'经营现金流同比增速为4.6490%。',sources:[],preparedAnalysis}).status,'unsupported_numbers')
  const spread={financial:{growthDivergences:[{value:12.6234,unit:'percentage_points',sourceCandidateIds:['financial']}],growth:[{growthPercent:76.5716},{growthPercent:63.9482}]}}
  const financial={...source,candidate:{...source.candidate,candidateId:'financial'},content:'结构化财务摘要；增速差由代码按两项增长率计算。'}
  assert.equal(validateCompanyNumericGrounding({markdown:'应收账款同比增速−营业收入同比增速＝76.5716%−63.9482%＝12.6234个百分点。[financial@paragraph:1]',sources:[financial],preparedAnalysis:spread}).status,'grounded','binary subtraction must not turn the second operand into a negative fact')
})

test('percentage-point grounding admits the explicit deterministic display value from rounded formula operands', () => {
  const financial = { ...source, candidate: { ...source.candidate, candidateId: 'financial' }, content: '期末应收账款与存货及累计营业收入同比增长率由结构化财务数据计算。' }
  const preparedAnalysis = { financial: {
    growthDivergences: [{ leftMetric: 'inventory', rightMetric: 'revenue', unit: 'percentage_points', value: 14.226154749927225, displayValue: 14.2261, sourceCandidateIds: ['financial'] }],
    growth: [{ metric: 'inventory', growthPercent: 78.17434268044806, sourceCandidateIds: ['financial'] }, { metric: 'revenue', growthPercent: 63.94818793052084, sourceCandidateIds: ['financial'] }],
  } }
  const formula = '存货同比增速与营业收入同比增速差＝78.1743%−63.9482%＝14.2261个百分点。[financial@paragraph:1]'
  const result = validateCompanyNumericGrounding({ markdown: formula, sources: [financial], preparedAnalysis })
  assert.equal(result.status, 'grounded', JSON.stringify(result.diagnostics))
  assert.equal(validateCompanyNumericGrounding({ markdown: formula.replace('14.2261', '14.2263'), sources: [financial], preparedAnalysis }).status, 'unsupported_numbers')
})

test('risk growth divergence reports a positive spread after describing one operand as declining', () => {
  const financial = { ...source, candidate: { ...source.candidate, candidateId: 'financial' }, content: '结构化财务摘要；同比增速由代码计算。' }
  const preparedAnalysis = { financial: { growthDivergences: [{
    leftMetric: 'revenue', rightMetric: 'operatingCashFlow', unit: 'percentage_points',
    currentPeriod: '2026-06-30', priorPeriod: '2025-06-30',
    value: 68.5971982648607, displayValue: 68.5972, sourceCandidateIds: ['financial'],
  }] } }
  const claim = '2026年上半年累计收入增长与经营现金流下降之间的增速背离为68.5972个百分点。[financial@paragraph:1]'
  const options = { sources: [financial], preparedAnalysis, trustedText: companyPreparedFinancialDateText(preparedAnalysis) }
  assert.equal(validateCompanyNumericGrounding({ markdown: claim, ...options }).status, 'grounded')
  assert.equal(validateCompanyNumericGrounding({ markdown: claim.replace('68.5972', '69.5972'), ...options }).status, 'unsupported_numbers')
  assert.equal(validateCompanyNumericGrounding({ markdown: claim.replace('背离为68.5972', '背离为负68.5972'), ...options }).status, 'unsupported_numbers')
})

test('ratio-change grounding admits only its deterministic displayed-operand calculation', () => {
  const financial = { ...source, candidate: { ...source.candidate, candidateId: 'financial' }, content: '结构化财务数据列示两期合并净利率4.18%和3.57%及变化。' }
  const preparedAnalysis = { financial: { ratioChanges: [{ metric: 'netMarginPercent', changePercentagePoints: -0.6030786726100335, displayChangePercentagePoints: -0.61, sourceCandidateIds: ['financial'] }] } }
  const valid = '合并净利率由4.18%至3.57%，按展示值下降0.61个百分点。[financial@paragraph:1]'
  assert.equal(validateCompanyNumericGrounding({ markdown: valid, sources: [financial], preparedAnalysis }).status, 'grounded')
  assert.equal(validateCompanyNumericGrounding({ markdown: valid.replace('0.61', '0.62'), sources: [financial], preparedAnalysis }).status, 'unsupported_numbers')
})

test('explicit aggregate and difference claims need matching amounts from adjacent cited rows', () => {
  const filing={...source,content:'营业收入 777,102百万元\n汽车相关业务收入 617,382百万元\n手机部件及其他收入 159,609百万元'}
  const supported='两项相加为6173.82亿元＋1596.09亿元＝7,769.91亿元；营业额7,771.02亿元－两项合计7,769.91亿元＝1.11亿元。[filing-2025-003@paragraph:1] [filing-2025-003@paragraph:2] [filing-2025-003@paragraph:3]'
  const aggregateResult=validateCompanyNumericGrounding({markdown:supported,sources:[filing]})
  assert.equal(aggregateResult.status,'grounded',JSON.stringify(aggregateResult.diagnostics))
  assert.equal(validateCompanyNumericGrounding({markdown:'6173.82亿元＋1596.09亿元＝7,769.91亿元；营业额7,771.02亿元－已列两项合计7,769.91亿元＝1.11亿元。[filing-2025-003@paragraph:1] [filing-2025-003@paragraph:2] [filing-2025-003@paragraph:3]',sources:[filing]}).status,'grounded','derived residual requires its explicit operands and formula')
  assert.equal(validateCompanyNumericGrounding({markdown:supported.replace('1.11','2.11'),sources:[filing]}).status,'unsupported_numbers')
  assert.equal(validateCompanyNumericGrounding({markdown:supported.replace('@paragraph:2','@paragraph:1').replace('@paragraph:3','@paragraph:1'),sources:[filing]}).status,'unsupported_numbers','one row cannot be double-counted as separate inputs')
})

test('arbitrary neighboring cited amounts cannot justify an uncalculated aggregate or an absolute-difference direction', () => {
  const filing={...source,content:'营业收入 100亿元。\n经营现金流 20亿元。'}
  const refs='[filing-2025-003@paragraph:1] [filing-2025-003@paragraph:2]'
  assert.equal(validateCompanyNumericGrounding({markdown:`商誉合计120亿元。${refs}`,sources:[filing]}).status,'unsupported_numbers')
  assert.equal(validateCompanyNumericGrounding({markdown:`收入低于现金80亿元。${refs}`,sources:[filing]}).status,'unsupported_numbers')
  assert.equal(validateCompanyNumericGrounding({markdown:`营业收入100亿元－经营现金流20亿元＝80亿元。${refs}`,sources:[filing]}).status,'grounded','an explicit equation may ground an arithmetically correct result; semantic direction remains independently reviewed')
})

test('gross-margin percentage and percentage-point units cannot be swapped', () => {
  const filing={...source,content:'毛利率同比下降2.67个百分点。'}
  assert.equal(validateCompanyNumericGrounding({markdown:'毛利率同比下降2.67个百分点。[filing-2025-003@paragraph:1]',sources:[filing]}).status,'grounded')
  assert.equal(validateCompanyNumericGrounding({markdown:'毛利率同比下降2.67%。[filing-2025-003@paragraph:1]',sources:[filing]}).status,'unsupported_numbers')
  const table={...source,content:'分产品毛利率 2025年 2024年 同比增减\n电子产品 20.49% 22.31% -2.67'}
  assert.equal(validateCompanyNumericGrounding({markdown:'电子产品毛利率同比下降2.67%。[filing-2025-003@paragraph:1] [filing-2025-003@paragraph:2]',sources:[table]}).status,'unsupported_numbers','a supplied table header identifies a margin change even when its data cell omits the unit')
})

test('the neutral gross-margin 增减 header does not turn a positive displayed cell negative', () => {
  const filing={...source,content:'单位：元\n营业收入 营业成本 毛利率\n毛利率比上年同期增减\n分产品\n电子电路产品 12,529,627,775.53 10,174,431,182.90 18.80% 13.29% 11.58% 1.25%'}
  assert.equal(validateCompanyNumericGrounding({markdown:'电子电路产品毛利率比上年同期增减1.25%。[filing-2025-003@paragraph:5]',sources:[filing]}).status,'grounded')
  assert.equal(validateCompanyNumericGrounding({markdown:'电子电路产品毛利率同比下降1.25%。[filing-2025-003@paragraph:5]',sources:[filing]}).status,'unsupported_numbers')
})

test('exact source-backed working-capital formulas authorize their displayed structured operands', () => {
  const candidateId='akshare-financial-002384'
  const financial={...source,candidate:{...source.candidate,candidateId,kind:'structured_data' as const,title:'Structured financial history'},title:'Structured financial history',content:'structured financial source'}
  const formula='DPO=((期初应付13,043,136,687.34元＋期末应付15,735,505,650.92元)÷2)÷本期累计营业成本22,196,075,162.56元×181天＝117.34天'
  const preparedAnalysis={financial:{workingCapitalCalculations:[{metric:'DPO',period:'2026-06-30',daysInPeriod:181,value:117.33908416410956,formula,sourceCandidateIds:[candidateId]}]}}
  const result=validateCompanyNumericGrounding({markdown:`2026年上半年累计${formula}。[${candidateId}@paragraph:1]`,sources:[financial],preparedAnalysis,trustedText:['2026-06-30']})
  assert.equal(result.status,'grounded',JSON.stringify(result.diagnostics))
})

test('PDF revenue reconciliation grounds disclosed million yuan converted to hundred-million yuan', () => {
  const filing={...source,content:['年度报告','',...Array.from({length:30},()=>''),'截至二零二四年十二月三十一日止年度，本集团营业额约人民币','777,102 百万元，同比上升 29.02%。其中汽车相关业务收入约人民币 617,382 百万元','；手机部件及其他业务收入约人民币 159,609 百万元；两项业务占总收入。'].join('\n')}
  const markdown='2024年年报披露营业额约7,771.02亿元，汽车相关业务收入6,173.82亿元，手机部件及其他业务收入1,596.09亿元；两项合计6,173.82亿元＋1,596.09亿元＝7,769.91亿元，营业额7,771.02亿元－已列合计7,769.91亿元＝1.11亿元。原文为777,102百万元、617,382百万元和159,609百万元，按百万元÷100换算为亿元。[filing-2025-003@paragraph:33] [filing-2025-003@paragraph:34] [filing-2025-003@paragraph:35]'
  const result=validateCompanyNumericGrounding({markdown,sources:[filing]})
  assert.equal(result.status,'grounded',JSON.stringify(result.diagnostics))
  const unitlessFormula=validateCompanyNumericGrounding({markdown:markdown.replace('6,173.82亿元＋1,596.09亿元＝','6,173.82＋1,596.09＝').replace('7,771.02亿元－已列合计7,769.91亿元＝','7,771.02－已列合计7,769.91＝'),sources:[filing]})
  assert.equal(unitlessFormula.status,'unsupported_numbers','money operands in formula must carry their own unit')
})

test('company unit-conversion wording is fixed arithmetic and subtraction operands retain their positive sign', () => {
  const filing={...source,content:'营业收入 777,102百万元\n经营现金流 373.35亿元\n购建长期资产现金支出 447.03亿元'}
  const formula='营业收入777,102百万元按除以100换算为7,771.02亿元。[filing-2025-003@paragraph:1]';
  assert.equal(validateCompanyNumericGrounding({markdown:formula,sources:[filing]}).status,'grounded')
  const conciseFormula='营业收入777,102百万元按100换算为7,771.02亿元。[filing-2025-003@paragraph:1]';
  assert.equal(validateCompanyNumericGrounding({markdown:conciseFormula,sources:[filing]}).status,'grounded')
  const subtraction='简化自由现金流＝373.35亿元−447.03亿元＝−73.68亿元。[filing-2025-003@paragraph:2] [filing-2025-003@paragraph:3]'
  const result=validateCompanyNumericGrounding({markdown:subtraction,sources:[filing],preparedAnalysis:{financial:{table:[{metrics:{operatingCashFlow:37335000000,capex:44703000000,freeCashFlow:-7368000000},metadata:{operatingCashFlow:{unit:'CNY',currency:'CNY'},capex:{unit:'CNY',currency:'CNY'},freeCashFlow:{unit:'CNY',currency:'CNY'}}}]}}})
  assert.equal(result.status,'grounded',JSON.stringify(result.diagnostics))
  const loss='报告披露净亏损-73.68亿元。[filing-2025-003@paragraph:1]'
  assert.equal(validateCompanyNumericGrounding({markdown:loss,sources:[{...filing,content:'净亏损-73.68亿元'}]}).status,'grounded')
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
  const markdown='毛利率分别下降1.82和2.06%。[filing-2025-003@paragraph:1]'
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

test('salary amounts inherit only their supplied same-source remuneration table unit, never the age column',()=>{
  const content='单位：万元\n姓名 性别 年龄 职务 任职状态 从公司获得的\n税前报酬总额\n是否在公司关联方获取报酬\n王传福 男 60 董事长、执行董事、总裁 现任 813.90 否';
  const salary={...source,content};
  const excerpts=content.split('\n').map((text,index)=>({location:`paragraph:${index+1}`,text,...(index===4?{contextLocations:['paragraph:1']}: {})}));
  const evidenceContexts=[{sourceCandidateId:source.candidate.candidateId,excerpts}];
  const check=(markdown:string,contexts:typeof evidenceContexts|undefined=evidenceContexts)=>validateCompanyNumericGrounding({markdown:`${markdown}[filing-2025-003@paragraph:5]`,sources:[salary],evidenceContexts:contexts});
  assert.equal(check('税前报酬813.90万元。').status,'grounded');
  assert.equal(check('年龄60岁，税前报酬813.90万元。').status,'grounded');
  assert.equal(check('税前报酬60万元。').status,'unsupported_numbers','age cannot acquire monetary magnitude');
  assert.equal(check('税前报酬813.90亿元。').status,'unsupported_numbers');
  assert.equal(check('税前报酬813.90万元。',[]).status,'unsupported_numbers');
  assert.equal(check('税前报酬813.90万元。',[{...evidenceContexts[0]!,sourceCandidateId:'other'}]).status,'unsupported_numbers');
  assert.equal(check('税前报酬813.90万元。',[{...evidenceContexts[0]!,excerpts:excerpts.filter(e=>e.location!=='paragraph:1')}]).status,'unsupported_numbers','referenced but unprovided context is unavailable');
  assert.equal(check('税前报酬813.90万元。',[{...evidenceContexts[0]!,excerpts:excerpts.filter(e=>e.location!=='paragraph:3')}]).status,'unsupported_numbers','remuneration column header must be supplied');
  assert.equal(check('税前报酬813.90万元。',[{...evidenceContexts[0]!,excerpts:excerpts.map(e=>e.location==='paragraph:5'?{...e,contextLocations:[]}:e)}]).status,'unsupported_numbers','nearby unit alone establishes no binding');
  assert.equal(check('2022年税前报酬813.90万元。').status,'unsupported_numbers','salary context never imports unrelated years');
  const distantContent=content.replace('是否在公司关联方获取报酬','\n'.repeat(15));
  const distantExcerpts=distantContent.split('\n').map((text,index)=>({location:`paragraph:${index+1}`,text,contextLocations:['paragraph:1']}));
  assert.equal(validateCompanyNumericGrounding({markdown:`报酬813.90万元。[filing-2025-003@paragraph:${distantExcerpts.length}]`,sources:[{...salary,content:distantContent}],evidenceContexts:[{sourceCandidateId:source.candidate.candidateId,excerpts:distantExcerpts}]}).status,'unsupported_numbers','distant table declarations cannot leak');
  const ambiguous=content.replace('是否在公司关联方获取报酬','单位：元');
  const ambiguousExcerpts=ambiguous.split('\n').map((text,index)=>({location:`paragraph:${index+1}`,text,contextLocations:['paragraph:1','paragraph:4']}));
  assert.equal(validateCompanyNumericGrounding({markdown:'报酬813.90万元。[filing-2025-003@paragraph:5]',sources:[{...salary,content:ambiguous}],evidenceContexts:[{sourceCandidateId:source.candidate.candidateId,excerpts:ambiguousExcerpts}]}).status,'unsupported_numbers','multiple bound units are ambiguous');
});

test('explicit ASCII monetary price ranges have positive endpoints without erasing subtraction or signed negatives',()=>{
  const range={...source,content:'售价区间为15.98万元-17.98万元。'};
  const check=(markdown:string,s=range)=>validateCompanyNumericGrounding({markdown:`${markdown}[filing-2025-003@paragraph:1]`,sources:[s]});
  assert.equal(check('售价15.98万至17.98万元。').status,'grounded');
  assert.equal(check('售价15.98万至18.98万元。').status,'unsupported_numbers','each endpoint must be cited');
  assert.equal(check('售价16.98万至17.98万元。').status,'unsupported_numbers','lower endpoint must also be cited');
  assert.equal(check('金额-17.98万元。').status,'unsupported_numbers','range endpoint cannot support a negative amount');
  const subtraction={...source,content:'净支出为20万元-17.98万元。'};
  assert.equal(check('金额-17.98万元。',subtraction).status,'grounded');
  assert.equal(check('金额17.98万元。',subtraction).status,'unsupported_numbers');
  assert.equal(check('金额17.98万元。',{...source,content:'经营现金流-17.98万元。'}).status,'unsupported_numbers');
  assert.equal(check('金额17.98万元。',{...source,content:'售价差额为20万元-17.98万元。'}).status,'unsupported_numbers','price arithmetic is not a range');
  assert.equal(check('金额17.98万元。',{...source,content:'售价区间为15.98亿元-17.98万元。'}).status,'unsupported_numbers','mixed units remain ambiguous');
});

test('negative monetary amounts may contain only an explicit RMB currency marker without losing sign',()=>{
  for(const currency of ['人民币','CNY','RMB','CNY ']){
    const check=(amount:string,fcf:number=-7368322000)=>validateCompanyNumericGrounding({markdown:`简化自由现金流为负${currency}${amount}亿元。`,sources:[],preparedAnalysis:{freeCashFlow:fcf}});
    assert.equal(check('73.68').status,'grounded',currency);
    assert.equal(check('735.68').status,'unsupported_numbers',currency);
    assert.equal(check('73.68',7368322000).status,'unsupported_numbers','negative statement still requires negative evidence');
  }
  assert.equal(validateCompanyNumericGrounding({markdown:'金额为非负人民币73.68亿元。',sources:[],preparedAnalysis:{amount:-7368322000}}).status,'unsupported_numbers');
  assert.equal(validateCompanyNumericGrounding({markdown:'金额为正负人民币73.68亿元。',sources:[],preparedAnalysis:{amount:-7368322000}}).status,'unsupported_numbers');
});

test('negative monetary source amounts accept the Chinese "负数人民币" phrasing without dropping the sign',()=>{
  const goodwill={...source,content:'商誉/合并成本小于取得的可辨认净资产公允价值份额的金额 -470,697,770.08 元。'};
  const grounded=validateCompanyNumericGrounding({markdown:'商誉调整为负数人民币470,697,770.08元。[filing-2025-003@paragraph:1]',sources:[goodwill]});
  assert.equal(grounded.status,'grounded');
  const wrongSign=validateCompanyNumericGrounding({markdown:'商誉调整为负数人民币470,697,770.08元。[filing-2025-003@paragraph:1]',sources:[{...goodwill,content:'商誉调整 470,697,770.08 元。'}]});
  assert.equal(wrongSign.status,'unsupported_numbers','explicit negative prose must not ground a positive source amount');
});

test('a subtraction inside a parenthesized ratio keeps the second operand positive',()=>{
  const accrual={...source,content:'归母净利润29.57亿元。经营现金净流量23.84亿元。归母净利口径应计代理比率0.89%。'};
  const result=validateCompanyNumericGrounding({markdown:'归母净利口径应计代理：（29.57亿元−23.84亿元）÷平均总资产＝0.89%。[filing-2025-003@paragraph:1]',sources:[accrual]});
  assert.equal(result.status,'grounded',JSON.stringify(result.diagnostics));
});

test('letter-adjacent optical specifications require the exact cited numeric value and technology unit',()=>{
  const optical={...source,content:'与LRO架构的OSFP及QSFP-DD800G光模块。公司的1.6T光模块提供EML技术。\n其他产品400G光模块。'};
  const check=(text:string,paragraph=1)=>validateCompanyNumericGrounding({markdown:`${text}[filing-2025-003@paragraph:${paragraph}]`,sources:[optical]});
  assert.equal(check('公司披露800G及1.6T光模块。').status,'grounded');
  assert.equal(check('公司披露QSFP-DD800G光模块。').status,'grounded');
  assert.equal(check('公司披露900G光模块。').status,'unsupported_numbers');
  assert.equal(check('公司披露800T光模块。').status,'unsupported_numbers','same numeric amount cannot substitute another technology unit');
  assert.equal(check('公司披露800Gbps光模块。').status,'unsupported_numbers','unit equivalence is not inferred');
  assert.equal(check('公司披露800G光模块。',2).status,'unsupported_numbers','unrelated cited paragraph cannot borrow a specification');
  assert.equal(check('公司披露400G光模块。').status,'unsupported_numbers','uncited source paragraph remains unavailable');
  assert.equal(check('收入800元。').status,'unsupported_numbers','technology speed cannot establish monetary quantity');
  assert.equal(validateCompanyNumericGrounding({markdown:'公司披露800G光模块。',sources:[],preparedAnalysis:{amount:800}}).status,'unsupported_numbers','calculator financial amount cannot establish speed');
  assert.equal(validateCompanyNumericGrounding({markdown:'公司披露800G光模块。',sources:[{...optical,content:'金额800元。'}]}).status,'unsupported_numbers');
});

test('EPS changes may cross consecutively cited PDF lines but cannot borrow buyback net-asset changes',()=>{
  const src={...source,content:'因回购股份导致每股\n净资产增加0.03元/股，回购对基本每股收益和稀释每股收益影响非常小。\n因增发股份导致每\n股净资产减少0.87元/股，因增发股份导致减少基本每股收益和稀释每\n股收益0.03元/股。'};
  const check=(text:string,refs:number[],sources=[src])=>validateCompanyNumericGrounding({markdown:text+refs.map(n=>`[filing-2025-003@paragraph:${n}]`).join(' '),sources});
  assert.equal(check('增发使每股净资产减少0.87元、每股收益减少0.03元。',[3,4,5]).status,'grounded');
  assert.equal(check('公司披露对每股净资产影响为减少0.87元/股，对基本及稀释每股收益影响为减少0.03元/股。',[3,4,5]).status,'grounded','per-share impact prose may state the metric effect between the metric and the direction')
  const annual={...src,content:'2.报告期内，公司增发股份125,693,822股，按2025年年末净资产计算，因增发股份，导致归属于公司普通股股东的每\n股净资产减少0.87元/股，按2025年归属于公司普通股股东的净利润计算，因增发股份导致减少基本每股收益和稀释每\n股收益0.03元/股。'}
  const annualCheck=(text:string)=>validateCompanyNumericGrounding({markdown:text+'[filing-2025-003@paragraph:1] [filing-2025-003@paragraph:2] [filing-2025-003@paragraph:3]',sources:[annual]})
  assert.equal(annualCheck('增发导致每股净资产减少人民币0.87元/股、基本及稀释每股收益减少人民币0.03元/股。').status,'grounded','official per-share changes stay grounded when the prose includes RMB and the split PDF continuations')
  assert.equal(annualCheck('增发导致每股净资产减少人民币0.87元/股，并减少基本及稀释每股收益人民币0.03元/股。').status,'grounded','direction-first basic and diluted EPS wording stays bound to the cited source continuation')
  assert.equal(annualCheck('增发导致每股净资产减少人民币0.87元/股，对基本及稀释每股收益的减少为人民币0.03元/股。').status,'grounded','the impact phrase “EPS reduction was RMB 0.03/share” stays bound to its cited source metric')
  assert.equal(annualCheck('增发导致每股净资产减少人民币0.87元/股，对基本及稀释每股收益的影响为减少人民币0.03元/股。').status,'grounded','the phrasing “the impact on EPS was a reduction of RMB 0.03/share” stays bound to its cited source metric')
  assert.equal(annualCheck('增发导致每股净资产减少人民币0.87元/股，对基本及稀释每股收益的增加为人民币0.03元/股。').status,'unsupported_numbers','the same cited amount cannot reverse the EPS direction')
  assert.equal(check('回购导致每股净资产增加人民币0.03元/股。',[1,2]).status,'grounded','direction-first buyback net-asset wording stays distinct from EPS')
  assert.equal(check('每股收益减少0.03元。',[4]).status,'unsupported_numbers','amount continuation must be cited');
  assert.equal(check('每股收益减少0.03元。',[5]).status,'unsupported_numbers','amount alone cannot establish direction and metric');
  assert.equal(check('每股收益减少0.03元。',[1,2]).status,'unsupported_numbers','buyback net assets are not EPS');
  assert.equal(check('每股收益增加0.03元。',[1,2,3,4,5]).status,'unsupported_numbers','same amount on another metric cannot reverse EPS direction');
  assert.equal(check('每股净资产增加0.03元。',[1,2]).status,'grounded');
  assert.equal(check('每股净资产增加0.87元。',[3,4,5]).status,'unsupported_numbers');
  assert.equal(check('每股收益减少0.04元。',[3,4,5]).status,'unsupported_numbers');
  const separated={...src,content:src.content.replace('股收益0.03','其他内容\n股收益0.03')};
  assert.equal(check('每股收益减少0.03元。',[4,6],[separated]).status,'unsupported_numbers','uncited intervening line cannot be skipped');
});

test('per-share repurchase impacts stated as direction before metric stay tied to the cited metric',()=>{
  const annual={...source,content:'报告期内，公司实施股份回购。按照2024年末净资产计算，增加每股净资产0.01元/股，对稀释每股收益影响较小。'}
  assert.equal(validateCompanyNumericGrounding({markdown:'2024年实施回购后每股净资产增加0.01元/股。[filing-2025-003@paragraph:1]',sources:[annual]}).status,'grounded')
  assert.equal(validateCompanyNumericGrounding({markdown:'2024年实施回购后每股收益增加0.01元/股。[filing-2025-003@paragraph:1]',sources:[annual]}).status,'unsupported_numbers','the source assigns the per-share amount to net assets, not EPS')
})

test('revenue composition needs the cited numeric row rather than a split product label or another metric table',()=>{
  const composition={...source,title:'2025年年度报告',content:'汽车、汽车相关\n产品及其他产品 648,645,636,000.00 80.68% 617,381,935,000.00 79.45% 5.06%\n及其他产品 155,236,528,000.00 19.31% 159,608,576,000.00 20.54% -2.74%\n及电气制造业 648,645,636,000.00 515,762,940,000.00 20.49% 5.06% 7.53% -1.82%'};
  const check=(text:string,refs:number[])=>validateCompanyNumericGrounding({markdown:text+refs.map(n=>`[filing-2025-003@paragraph:${n}]`).join(' '),sources:[composition]});
  assert.equal(check('2025年汽车收入占80.68%。',[1,3]).status,'unsupported_numbers','a selected but uncited numeric continuation is unavailable');
  assert.equal(check('汽车收入占79.45%。',[1,3]).status,'unsupported_numbers','split label does not admit any data column');
  assert.equal(check('| 汽车收入占比 | 80.68% |\n| 电子收入占比 | 19.31% |',[4]).status,'unsupported_numbers','gross margin row cannot establish revenue composition');
  assert.equal(check('2025年汽车收入占80.68%，电子收入占19.31%。',[1,2,3]).status,'grounded');
  assert.equal(check('汽车毛利率20.49%。',[4]).status,'grounded');
});

test('BYD phone-parts revenue share requires the exact split label, numeric row, and supplied period/unit context',()=>{
  const rows=Array.from({length:830},()=> '常规披露。');
  rows[804]='（1）营业收入构成';
  rows[805]='单位：元';
  rows[806]='2025 年 2024 年';
  rows[817]='分产品';
  rows[818]='手机部件、组装';
  rows[819]='及其他产品 155,236,528,000.00 19.31% 159,608,576,000.00 20.54% -2.74%';
  const filing={...source,title:'2025年年度报告',content:rows.join('\n')};
  const packet=selectCompanyEvidence([filing],[filing.candidate.candidateId],['分产品','手机部件','收入'],{purpose:'business_model_map'})[0]!;
  const ref=`[${filing.candidate.candidateId}@paragraph:820]`;
  const claim=`2025年度手机部件、组装及其他产品营业收入155,236,528,000元，占比19.31%。${ref}`;
  const evidenceContexts=[{sourceCandidateId:packet.sourceCandidateId,excerpts:packet.excerpts}];
  const exactLabelGrounding=validateCompanyNumericGrounding({markdown:claim,sources:[filing],evidenceContexts});
  assert.equal(exactLabelGrounding.status,'grounded',JSON.stringify({diagnostics:exactLabelGrounding.diagnostics,row:packet.excerpts.find(row=>row.location==='paragraph:820')}));
  assert.equal(validateCompanyNumericGrounding({markdown:`2024年度手机部件、组装及其他产品营业收入155,236,528,000元，占比19.31%。${ref}`,sources:[filing],evidenceContexts}).status,'unsupported_numbers','the cited row cannot be reassigned to a different year');
});

test('5G product methodology needs its own cited technology paragraph, not selected but uncited evidence',()=>{
  const technology={...source,content:'本集团依托电子信息技术、人工智能技术、5G和物联网技术。\n消费电子业务深度参与客户的新产品开发。\n电子制造业务收入增长5%。'};
  const text='| 电子业务 | 电子信息、AI、5G/物联网、热管理技术 |';
  const check=(refs:number[])=>validateCompanyNumericGrounding({markdown:text+refs.map(n=>`[filing-2025-003@paragraph:${n}]`).join(' '),sources:[technology]});
  assert.equal(check([2]).status,'unsupported_numbers');
  assert.equal(check([3]).status,'unsupported_numbers','financial percentage 5 cannot establish 5G');
  assert.equal(check([1,2]).status,'grounded');
});

test('collapsed PDF optical G/PAM4/EML labels retain exact specification citation requirements',()=>{
  const optical={...source,content:'自研100GPAM4EML芯片在\n400G及800G光模块累计使用超千万颗，200GPAM4EML芯片已进入量产。\n正在研发400GPAM4EML芯片。'};
  const check=(text:string,refs:number[])=>validateCompanyNumericGrounding({markdown:text+refs.map(n=>`[filing-2025-003@paragraph:${n}]`).join(' '),sources:[optical]});
  assert.equal(check('自研100G PAM4 EML用于400G及800G模块，200G PAM4 EML量产。',[1,2]).status,'grounded');
  assert.equal(check('400G PAM4 EML正在研发。',[3]).status,'grounded');
  assert.equal(check('100G PAM4 EML。',[2]).status,'unsupported_numbers','missing exact cited chip specification');
  assert.equal(check('200T PAM4 EML。',[2]).status,'unsupported_numbers','unit is not interchangeable');
  assert.equal(check('300G PAM4 EML。',[1,2,3]).status,'unsupported_numbers','standard suffix cannot create a new quantity');
  assert.equal(validateCompanyNumericGrounding({markdown:'100G芯片。[filing-2025-003@paragraph:1]',sources:[{...optical,content:'型号100GARBAGE，非速率披露。'}]}).status,'unsupported_numbers','arbitrary alphabetic suffixes remain unavailable');
  assert.equal(validateCompanyNumericGrounding({markdown:'100G芯片。[filing-2025-003@paragraph:1]',sources:[{...optical,content:'型号100GPAM4EMLX，非速率披露。'}]}).status,'unsupported_numbers');
  assert.equal(validateCompanyNumericGrounding({markdown:'100G芯片。[filing-2025-003@paragraph:1]',sources:[{...optical,content:'型号ABC100GPAM4EML，非速率披露。'}]}).status,'unsupported_numbers','arbitrary embedded model numbers cannot establish a rate');
  assert.equal(validateCompanyNumericGrounding({markdown:'100T芯片。[filing-2025-003@paragraph:1]',sources:[{...optical,content:'型号100TPAM4EML，非G标签。'}]}).status,'unsupported_numbers','collapsed suffix exception applies only to G');
});

test('R24 BYD risk-table percentages require citations to their exact value rows', () => {
  const productId = 'byd-h1-2026-risk-regression'
  const productLines = Array.from({ length: 708 }, () => '')
  productLines[690] = '营业收入构成'
  productLines[691] = '单位：元'
  productLines[692] = '产品类别 营业收入 占比 营业收入 占比'
  productLines[704] = '分产品'
  productLines[705] = '电子及其他产品 69,404,994,000.00 20.13% 68,743,903,000.00 18.51% 0.96%'
  productLines[706] = '汽车、汽车相关'
  const productSource = { ...source, candidate: { ...source.candidate, candidateId: productId }, title: '2026年半年度报告', content: productLines.join('\n') }
  const productExcerpts = [692, 693, 706, 707].map((paragraph) => ({ location: `paragraph:${paragraph}`, text: productLines[paragraph - 1]! }))
  const productContext = [{ sourceCandidateId: productId, excerpts: productExcerpts }]
  const missingProductValueRow = '电子及其他产品占营业收入20.13%。[byd-h1-2026-risk-regression@paragraph:708]'
  assert.equal(validateCompanyNumericGrounding({ markdown: missingProductValueRow, sources: [productSource], evidenceContexts: productContext }).status, 'unsupported_numbers', 'the adjacent automotive label/value citation cannot support the separate 20.13% electronics row')
  const citedProductValueRow = '电子及其他产品占营业收入20.13%。[byd-h1-2026-risk-regression@paragraph:706]'
  assert.equal(validateCompanyNumericGrounding({ markdown: citedProductValueRow, sources: [productSource], evidenceContexts: productContext }).status, 'grounded', 'the exact value row supports the stated percentage')
  assert.equal(validateCompanyNumericGrounding({ markdown: '2025年上半年电子及其他产品占营业收入20.13%。[byd-h1-2026-risk-regression@paragraph:706]', sources: [productSource], evidenceContexts: productContext }).status, 'unsupported_numbers', 'the cited value belongs to the 2026 half-year report, not 2025')
  assert.equal(validateCompanyNumericGrounding({ markdown: '电子及其他产品占营业收入20.13个百分点。[byd-h1-2026-risk-regression@paragraph:706]', sources: [productSource], evidenceContexts: productContext }).status, 'unsupported_numbers', 'a reported percentage is not a percentage-point change')

  const customerId = 'byd-annual-2025-risk-regression'
  const customerLines = Array.from({ length: 929 }, () => '')
  customerLines[916] = '前五名客户合计销售金额（元） 145,648,095,000.00'
  customerLines[917] = '前五名客户合计销售金额占年度销售总额比例 18.12%'
  customerLines[921] = '1 客户一 100,736,686,000.00 12.53%'
  customerLines[922] = '2 客户二 16,498,131,000.00 2.05%'
  customerLines[918] = '前五名客户销售中关联方销售占年度销售总额比例 0.00%'
  customerLines[927] = '本节风险判断为监控情景。'
  const customerSource = { ...source, candidate: { ...source.candidate, candidateId: customerId }, title: '2025年年度报告', content: customerLines.join('\n') }
  const customerExcerpts = [918, 919, 922, 923, 928].map((paragraph) => ({ location: `paragraph:${paragraph}`, text: customerLines[paragraph - 1]! }))
  const customerContext = [{ sourceCandidateId: customerId, excerpts: customerExcerpts }]
  const exactAttemptTwoClaim = '2025年度前五名客户合计占年度销售总额18.12%；最大客户“客户一”占12.53%，第二大单一客户“客户二”占2.05%。[byd-annual-2025-risk-regression@paragraph:920] [byd-annual-2025-risk-regression@paragraph:929]'
  const rejected = validateCompanyNumericGrounding({ markdown: exactAttemptTwoClaim, sources: [customerSource], evidenceContexts: customerContext })
  assert.equal(rejected.status, 'unsupported_numbers', 'citations to the related-party percentage and risk limitation cannot license the three uncited customer percentages')
  assert.deepEqual(rejected.diagnostics.map((diagnostic) => diagnostic.token), ['18.12', '12.53', '2.05'])
  const citedCustomerRows = '2025年度前五名客户合计占年度销售总额18.12%；最大客户“客户一”占12.53%，第二大单一客户“客户二”占2.05%。[byd-annual-2025-risk-regression@paragraph:918] [byd-annual-2025-risk-regression@paragraph:922] [byd-annual-2025-risk-regression@paragraph:923]'
  assert.equal(validateCompanyNumericGrounding({ markdown: citedCustomerRows, sources: [customerSource], evidenceContexts: customerContext }).status, 'grounded', 'each customer percentage passes when its exact source row is cited')
  assert.equal(validateCompanyNumericGrounding({ markdown: '2025年度前五名客户合计占年度销售总额18.12亿元。[byd-annual-2025-risk-regression@paragraph:918]', sources: [customerSource], evidenceContexts: customerContext }).status, 'unsupported_numbers', 'the exact source row reports a percentage, not a monetary amount')
})

test('BYD small other-product revenue binds the table-header unit and the exact revenue-share row',()=>{
  const rows=Array.from({length:823},(_,index)=>`常规披露${index+1}`)
  rows[805]='单位：元'; rows[806]='2025 年 2024 年'; rows[808]='金额 占营业收入'; rows[809]='比重 金额 占营业收入比重'; rows[822]='其他 82,794,000.00 0.01% 111,944,000.00 0.01% -26.04%'
  const candidateId='official-f7c8d23d2829a5e8'
  const filing={...source,candidate:{...source.candidate,candidateId},title:'2025年年度报告',content:rows.join('\n')}
  const excerpts=[806,807,809,810,823].map(paragraph=>({sourceCandidateId:candidateId,location:`paragraph:${paragraph}`,text:rows[paragraph-1]!,...(paragraph===823?{contextLocations:['paragraph:806','paragraph:807','paragraph:805']}:{}),...(paragraph===807?{contextLocations:['paragraph:806','paragraph:805']}:{} )}))
  const evidenceContexts=[{sourceCandidateId:candidateId,excerpts}]
  const markdown=`2025年度“其他”产品营业收入82,794,000.00元，占比0.01%。${[806,807,809,810,823].map(paragraph=>`[${candidateId}@paragraph:${paragraph}]`).join(' ')}`
  const result=validateCompanyNumericGrounding({markdown,sources:[filing],evidenceContexts})
  assert.equal(result.status,'grounded',JSON.stringify(result.diagnostics))
})

test('cited annual R&D money and ratio keep their own units when stated together',()=>{
  const candidateId='byd-rd-unit-regression'
  const lines=Array.from({length:2247},(_,index)=>`披露${index+1}`)
  lines[2242]='2025 年 2024 年 变动比例'
  lines[2243]='研发投入金额（元） 63,441,379,000.00 54,160,964,000.00 17.13%'
  lines[2244]='研发投入占营业收入比例 7.89% 6.97% 0.92%'
  lines[2245]='研发投入资本化的金额（元） 5,463,274,000.00 966,219,000.00 465.43%'
  lines[2246]='资本化研发投入占研发投入的比例 8.61% 1.78% 6.83%'
  const filing={...source,candidate:{...source.candidate,candidateId},title:'2025年年度报告',content:lines.join('\n')}
  const annualRefs=[2244,2245].map(paragraph=>`[${candidateId}@paragraph:${paragraph}]`).join(' ')
  const capitalizationRefs=[2246,2247].map(paragraph=>`[${candidateId}@paragraph:${paragraph}]`).join(' ')
  const correctClaim=`本期研发投入金额为634.41亿元，占营业收入比例为7.89%；上期研发投入金额为541.61亿元，占营业收入比例为6.97%。${annualRefs} [${candidateId}@paragraph:2243] 本期研发资本化金额为54.63亿元，资本化率为8.61%；上期研发资本化金额为9.66亿元，资本化率为1.78%。${capitalizationRefs} [${candidateId}@paragraph:2243]`
  const grounded=validateCompanyNumericGrounding({markdown:correctClaim,sources:[filing]})
  assert.equal(grounded.status,'grounded',JSON.stringify(grounded.diagnostics))
  assert.equal(validateCompanyNumericGrounding({markdown:correctClaim.replace('541.61亿元','541.62亿元'),sources:[filing]}).status,'unsupported_numbers','a monetary value outside the report rounding tolerance remains rejected')
  assert.equal(validateCompanyNumericGrounding({markdown:correctClaim.replace('6.97%','6.98%'),sources:[filing]}).status,'unsupported_numbers','a ratio outside the source row remains rejected')
})

test('Dongshan FCF formula and signed result stay in their own Markdown cells for colon and semicolon wording', () => {
  const candidateId = 'akshare-financial-002384'
  const financialSource = {...source, candidate:{...source.candidate,candidateId}, content:'{"kind":"financial","rows":[]}'}
  const row = {period:'2026-06-30',basis:'YTD',unit:'CNY',operatingCashFlow:2383887276.1,capex:5253357960.45,value:-2869470684.35,displayUnit:'亿元',displayOperatingCashFlow:'23.84',displayCapex:'52.53',displayValue:'-28.69',formula:'23.84亿元−52.53亿元＝-28.69亿元',sourceCandidateIds:[candidateId]}
  const preparedAnalysis = {financial:{simpleFreeCashFlow:[row]}}
  const otherSource = {...financialSource,candidate:{...financialSource.candidate,candidateId:'unrelated-financial'}}
  for (const punctuation of ['：','；']) for (const operator of ['−','-']) for (const sign of ['-','−']) {
    const table = `| 指标 | 期间、口径与公式 | 结果 |\n|---|---|---:|\n| 简化自由现金流 | 2026年上半年累计${punctuation}23.84亿元${operator}52.53亿元 | ${sign}28.69亿元 | [${candidateId}@paragraph:1]`
    const check = (markdown: string) => validateCompanyNumericGrounding({markdown,sources:[financialSource,otherSource],preparedAnalysis,trustedText:companyPreparedFinancialDateText(preparedAnalysis)})
    const result = check(table)
    assert.equal(result.status,'grounded',`${punctuation}/${operator}/${sign}: ${JSON.stringify(result.diagnostics)}`)
    assert.equal(check(table.replace(`${sign}28.69亿元`,'28.69亿元')).status,'unsupported_numbers','a positive result must not inherit the negative prepared FCF')
    assert.equal(check(table.replace('2026年上半年','2025年上半年')).status,'unsupported_numbers','the exact prepared period is still required')
    assert.equal(check(table.replaceAll('亿元','万元')).status,'unsupported_numbers','a different monetary scale must remain unsupported')
    assert.equal(check(table.replace(`[${candidateId}@paragraph:1]`,'[unrelated-financial@paragraph:1]')).status,'unsupported_numbers','an unrelated source cannot license prepared operands or result')
    assert.equal(check(table.replace('52.53亿元','52.54亿元')).status,'unsupported_numbers','an incorrect operand is not repaired by recognizing subtraction')
    const separatedOperand = table.replace(`${operator}52.53亿元`, `| ${sign}52.53亿元`)
    const rejected = check(separatedOperand)
    assert.ok(rejected.diagnostics.some(issue => /52\.53/.test(issue.token)), 'a unary negative at the next cell start cannot borrow the prior cell operand')
  }
})

test('Markdown cell-start negative amounts remain unary even when a later cell contains an equation', () => {
  const negativeSource = {...source,content:'资本支出52.53亿元，简化现金差额-28.69亿元。'}
  for (const sign of ['-','−']) {
    const markdown = `| 指标 | 资本支出 | 说明 |\n|---|---:|---|\n| 现金流 | ${sign}52.53亿元 | 23.84亿元＝23.84亿元 | [filing-2025-003@paragraph:1]`
    const result = validateCompanyNumericGrounding({markdown,sources:[negativeSource]})
    assert.ok(result.diagnostics.some(issue=>issue.token==='-52.53亿元'),JSON.stringify(result.diagnostics))
  }
})
