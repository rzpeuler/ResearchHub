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
put(950, ['公司现任董事、高级管理人员专业背景、主要工作经历以及目前在公司的主要职责', '董事长履历及职责摘要。', '常规人员信息。', '常规人员信息。', '常规人员信息。', '常规人员信息。', '常规人员信息。', '常规人员信息。', '常规人员信息。', '常规人员信息。', '常规人员信息。', '常规人员信息。', '常规人员信息。', '常规人员信息。', '常规人员信息。', '常规人员信息。', '常规人员信息。', '常规人员信息。', '常规人员信息。', '常规人员信息。', '高级管理人员甲，主要工作经历为汽车电子研发，现任公司副总裁并负责该业务。'])
const source = { candidate: { candidateId: 'annual', publishedAt: '2026-03-28' }, title: '2025年年度报告', content: lines.join('\n'), publisher: '公司' } as CompanyResearchInput['sources'][number]
const select = (purpose: string, maxCharacters = 32000) => selectCompanyEvidence([source], ['annual'], ['客户', '分产品', '研发', '管理', '分红', '回购', '成立'], { purpose, maxCharacters })[0]!
const has = (purpose: string, row: number) => assert.ok(select(purpose).excerpts.some((excerpt) => excerpt.location === `paragraph:${row}`), `${purpose} missing actual row ${row}`)

test('numeric concentration tables outrank early generic risk text and keep anonymous first-customer plus total rows', () => {
  for (const purpose of ['financial_quality_analysis', 'company_risk_analysis', 'market_structure_analysis']) for (const row of [302, 303, 306, 311]) has(purpose, row)
  has('company_risk_analysis', 654)
})

test('business model packets reserve the exact product cost and margin table alongside revenue composition', () => {
  for (const paragraph of [651,652,653,654]) has('business_model_map', paragraph)
})

test('business model packets keep product-margin rows beyond the short continuation window and all split label fragments', () => {
  const rows = Array.from({ length: 55 }, () => '常规披露')
  rows.splice(15, 0,
    '单位：元', '营业收入 营业成本 毛利率', '营业收入比上年同期增减', '营业成本比上年同期增减', '毛利率比上年同期增减',
    '分产品', '表格说明', '表格说明', '汽车、汽车相', '关产品及其他', '产品',
    '648,645,636,000.00 515,762,940,000.00 20.49% 5.06% 7.53% -1.82%')
  const filing = { ...source, content: rows.join('\n') }
  const packet = selectCompanyEvidence([filing], ['annual'], ['分产品', '汽车', '毛利率'], { purpose: 'business_model_map' })[0]!
  const row = packet.excerpts.find(excerpt => excerpt.text.includes('648,645,636,000.00'))
  assert.ok(row, 'the margin data row must survive selection even when it is ten paragraphs after 分产品')
  for (const location of ['paragraph:24', 'paragraph:25', 'paragraph:26']) {
    assert.ok(packet.excerpts.some(excerpt => excerpt.location === location), `split product-label fragment ${location} must be supplied`)
    assert.ok(row.contextLocations?.includes(location), `numeric margin row must carry ${location} as label context`)
  }
})

test('risk packets reserve the exact annual top-five and largest-customer concentration rows', () => {
  const rows = Array.from({ length: 3400 }, (_, index) => `常规披露${index + 1}`)
  rows[915] = '公司主要销售客户情况'
  rows[916] = '前五名客户合计销售金额（元） 145,648,095,000'
  rows[917] = '前五名客户合计销售金额占年度销售总额比例 18.12%'
  rows[919] = '公司前5大客户资料'
  rows[920] = '序号 客户名称 销售额（元） 占年度销售总额比例'
  rows[921] = '1 客户一 100,736,686,000 12.53%'
  rows[922] = '2 客户二 16,498,131,000 2.05%'
  const filing = { ...source, content: rows.join('\n') }
  const packet = selectCompanyEvidence([filing], ['annual'], ['风险', '客户集中', '客户'], { purpose: 'company_risk_analysis' })[0]!
  for (const row of [917, 918, 921, 922, 923]) assert.ok(packet.excerpts.some(excerpt => excerpt.location === `paragraph:${row}`), `risk packet missing concentration paragraph:${row}`)
})

test('market-structure evidence selects the annual China NEV sales paragraph before synthesis can cite it', () => {
  const rows = Array.from({ length: 30 }, (_, index) => `行业背景${index + 1}`)
  rows[17] = '中国汽车产销达到3,143.6万辆，同比增长4.5%。中国新能源汽车全年销量达到1,286.6万辆，同比增长35.5%。'
  const filing = { ...source, content: rows.join('\n') }
  const packet = selectCompanyEvidence([filing], ['annual'], ['行业', '新能源汽车', '销量', '市场规模'], { purpose: 'market_structure_analysis' })[0]!
  assert.ok(packet.excerpts.some(excerpt => excerpt.location === 'paragraph:18' && excerpt.text.includes('1,286.6万辆')))
})

test('employee share-plan table continuation carries exact people, share-count, and percentage rows into capital-allocation evidence', () => {
  const rows = Array.from({ length: 90 }, (_, index) => `常规披露${index + 1}`)
  rows[28] = '三、公司股权激励计划、员工持股计划或其他员工激励措施的实施情况'
  rows[29] = '适用 □不适用'
  rows[30] = '1、股权激励：无'
  rows[31] = '2、员工持股计划的实施情况'
  rows[32] = '员工持股计划名称 参加人数 期末持有股数（股） 占公司总股本比例'
  rows[33] = '第一期员工持股计划 150 3,048,701 0.17%'
  rows[34] = '报告期内员工持股计划持有人变更情况：无'
  const filing = { ...source, content: rows.join('\n') }
  const packet = selectCompanyEvidence([filing], ['annual'], ['员工持股计划', '资本配置'], { purpose: 'capital_allocation_review' })[0]!
  for (const paragraph of [32, 33, 34]) assert.ok(packet.excerpts.some(row => row.location === `paragraph:${paragraph + 1}`), `missing employee-plan table row paragraph:${paragraph + 1}`)
})

test('management evidence prioritizes the current-year employee plan disclosure with its reported metrics', () => {
  const rows = Array.from({ length: 240 }, (_, index) => `常规披露${index + 1}`)
  rows[24] = '2、员工持股计划的实施情况'
  rows[25] = '报告期内全部有效的员工持股计划情况'
  rows[26] = '2022年员工持股计划按原方案实施。'
  rows[180] = '本公司 2025 年员工持股计划参与对象包括高级管理人员及核心骨干员工，总人数不超过 25,000 人。'
  rows[181] = '本员工持股计划已累计买入公司 A 股股票 10,714,990 股，约占总股本的 0.3526%，成交均价约为人民币 372.18 元/股。'
  rows[182] = '本员工持股计划已完成股票购买，持有的标的股票分三期解锁，解锁比例分别为 30%、30%、40%。'
  const filing = { ...source, content: rows.join('\n') }
  for (const purpose of ['management_governance_analysis', 'capital_allocation_review']) {
    const packet = selectCompanyEvidence([filing], ['annual'], ['员工持股计划', '治理', '激励'], { purpose })[0]!
    for (const paragraph of [181, 182, 183]) assert.ok(packet.excerpts.some(row => row.location === `paragraph:${paragraph + 1}`), `${purpose} missing current plan disclosure paragraph:${paragraph + 1}`)
  }
})

test('management packets preserve the reported participant and ending-share rows of an interim employee plan table', () => {
  const rows = Array.from({ length: 1240 }, (_, index) => `常规披露${index + 1}`)
  rows[1137] = '2025年员工持股计划实施情况'
  rows[1138] = '计划名称 员工人数 持有股票总数（股） 占总股本比例'
  rows[1139] = '2024年员工持股计划 100 1,595,465 0.0175%'
  rows[1153] = '2025年员工持股计划期末情况'
  rows[1157] = '计划名称 员工人数 持有股票总数（股） 占总股本比例'
  rows[1158] = '2025年员工持股计划 21,417 22,501,479 0.2468%'
  const filing = { ...source, content: rows.join('\n') }
  const packet = selectCompanyEvidence([filing], ['annual'], ['员工持股计划', '人员激励'], { purpose: 'management_governance_analysis' })[0]!
  for (const row of [1138, 1139, 1154, 1158, 1159]) assert.ok(packet.excerpts.some(excerpt => excerpt.location === `paragraph:${row}`), `management packet missing employee-plan paragraph:${row}`)
})

test('management and capital-allocation packets preserve split HKSCC name and holding rows together', () => {
  const rows = Array.from({ length: 2300 }, (_, index) => `常规披露${index + 1}，股东及治理背景材料。`)
  rows[2229] = 'HKSCC NOMINEES'
  rows[2230] = 'LIMITED'
  rows[2231] = '境外法人 40.38% 3,681,498,007'
  const filing = { ...source, title: '2026年半年度报告', content: rows.join('\n') }
  for (const purpose of ['management_governance_analysis', 'capital_allocation_review']) {
    const packet = selectCompanyEvidence([filing], ['annual'], ['前十大股东', 'HKSCC NOMINEES', '持股比例'], { purpose })[0]!
    for (const row of [2230, 2231, 2232]) assert.ok(packet.excerpts.some(excerpt => excerpt.location === `paragraph:${row}`), `${purpose} missing split shareholder paragraph:${row}`)
  }
})

test('management packets preserve the current-period named director and executive appointment rows', () => {
  const rows = Array.from({ length: 1500 }, (_, index) => `常规披露${index + 1}`)
  rows[1373] = '一、公司董事、高级管理人员变动情况'
  rows[1374] = '适用 □不适用'
  rows[1375] = '姓名 担任的职务 类型 日期 原因'
  rows[1376] = '王章忠 独立董事 任期届满离任 2026 年 05 月 15 日 换届'
  rows[1377] = '宋利国 独立董事 任期届满离任 2026 年 05 月 15 日 换届'
  rows[1378] = '高永如 独立董事 任期届满离任 2026 年 05 月 15 日 换届'
  rows[1379] = '王雷刚 独立董事 被选举 2026 年 05 月 15 日 换届'
  rows[1380] = '潘永诚 独立董事 被选举 2026 年 05 月 15 日 换届'
  rows[1381] = '蔡卫华 独立董事 被选举 2026 年 05 月 15 日 换届'
  rows[1382] = 'Li Ting Wei 副总经理 聘任 2026 年 03 月 25 日 聘任'
  rows[1383] = '二、本报告期利润分配及资本公积金转增股本情况'
  const filing = { ...source, title: '2026年半年度报告', content: rows.join('\n') }
  const packet = selectCompanyEvidence([filing], ['annual'], ['董事', '高级管理人员', '聘任', '治理'], { purpose: 'management_governance_analysis', maxExcerptsPerSource: 28, maxCharacters: 8000 })[0]!
  for (const row of [1374, 1376, 1377, 1378, 1379, 1380, 1381, 1382, 1383]) assert.ok(packet.excerpts.some(excerpt => excerpt.location === `paragraph:${row}`), `appointment bundle missing paragraph:${row}`)
})

test('current-period employee-plan metrics survive budget competition and outrank an older plan table', () => {
  const rows = Array.from({ length: 2600 }, (_, index) => `常规披露${index + 1}，公司治理及资本安排背景材料。`)
  rows[240] = '报告期内全部有效的员工持股计划情况'
  rows[241] = '员工的范围'
  rows[242] = '员工人数'
  rows[243] = '持有的股票总数（股）'
  rows[244] = '占上市公司股本总额的比例'
  rows[245] = '实施计划的资金来源'
  rows[246] = '公司及子公司核心技术（业务）骨干'
  rows[247] = '（不包括公司董事、高级管理人员）'
  rows[248] = '150 3,048,701 无 0.17%'
  rows[249] = '员工合法薪酬、自筹资金以及法律、行政法规允许的其他方式'
  rows[250] = '报告期内资产管理机构的变更情况'
  // A later appendix repeats an older plan with tempting numeric details.
  rows[1800] = '2022年员工持股计划实施情况'
  rows[1801] = '2022年员工持股计划 120 9,999,999 0.50%'
  const filing = { ...source, title: '2026年半年度报告', content: rows.join('\n') }
  for (const purpose of ['management_governance_analysis', 'capital_allocation_review']) {
    const packet = selectCompanyEvidence([filing], ['annual'], ['员工持股计划', '核心技术骨干', '人数', '持股'], {
      purpose,
      maxExcerptsPerSource: 28,
      maxCharacters: 6000,
    })[0]!
    for (const paragraph of [241, 242, 243, 244, 245, 246, 247, 248, 249]) {
      assert.ok(packet.excerpts.some(excerpt => excerpt.location === `paragraph:${paragraph + 1}`), `${purpose} missing current-plan table paragraph:${paragraph + 1}`)
    }
    assert.ok(packet.excerpts.some(excerpt => excerpt.location === 'paragraph:249' && excerpt.text.includes('150 3,048,701 无 0.17%')), `${purpose} must retain the current-period reported metrics even when an older numeric plan competes for space`)
  }
})

test('growth-driver evidence includes company-specific commercialization milestones', () => {
  const rows = Array.from({ length: 220 }, (_, index) => `常规经营信息${index + 1}。`)
  rows[160] = '公司服务器多个项目已实现批量出货，海外大客户最新一代液冷冷板项目处于量产爬坡阶段。'
  const filing = { ...source, content: rows.join('\n') }
  const packet = selectCompanyEvidence([filing], ['annual'], ['增长', '收入', '出货'], { purpose: 'business_driver_analysis' })[0]!
  assert.ok(packet.excerpts.some(row => row.location === 'paragraph:161'), 'the commercial-stage disclosure must be available to growth-driver analysis')
})

test('risk evidence includes the annual report governance and internal-control disclosures', () => {
  const rows = Array.from({ length: 3400 }, (_, index) => `常规披露${index + 1}`)
  rows[3314] = '实际控制人兼任董事长、总裁。'
  rows[3316] = '公司已建立内部控制体系和关联交易决策制度。'
  const filing = { ...source, content: rows.join('\n') }
  const selected = selectCompanyEvidence([filing], ['annual'], ['风险', '治理', '内部控制', '关联交易'], { purpose: 'company_risk_analysis', maxExcerptsPerSource: 120, maxCharacters: 24000 })
  const excerpts = selected.flatMap(packet => packet.excerpts)
  assert.ok(excerpts.some(excerpt => excerpt.location === 'paragraph:3315'))
  assert.ok(excerpts.some(excerpt => excerpt.location === 'paragraph:3317'))
})

test('risk evidence reserves a full long-form controller and internal-control disclosure bundle under report-sized competition', () => {
  const rows = Array.from({ length: 3400 }, (_, index) => `常规披露${index + 1}`)
  rows[2019] = '袁永刚先生：中国香港籍，拥有新加坡永久居留权，大学本科学历，公司控股股东、实际控制人。1998年10月起历任公司市场部部长、副经理、副董事长。现任本公司董事长，江苏省总商会副会长，苏州市工商联副主席，苏州市民营经济国际合作商会会长。'
  rows[2022] = '袁永峰先生：中国国籍，大学本科学历，公司控股股东、实际控制人。1998年10月起历任公司制造部部长、监事。'
  rows[2023] = '现任本公司董事、总经理，政协苏州市吴中区第五届委员会委员，苏州市吴中区工商联副主席，苏州市东山镇商会会长。'
  rows[2058] = '控股股东、实际控制人同时担任上市公司董事长和总经理的情况'
  rows[2060] = '公司控股股东、实际控制人袁永刚先生、袁永峰先生分别担任公司董事长及总经理职务，系公司结合自身发展阶段、经营管理实际需要作出的合理安排，有利于提高公司经营决策效率，保障发展战略有效落地及经营管理持续稳定，该任职安排具备合理性。'
  rows[2711] = '十一、报告期内的内部控制制度建设及实施情况'
  rows[2712] = '1、内部控制建设及实施情况'
  rows[2713] = '公司已依据《中华人民共和国公司法》《企业内部控制基本规范》及其配套指引等相关要求，结合公司实际情况和管理需要，建立了完善的内部控制体系。'
  rows[2714] = '报告期内，公司持续完善内控制度建设，开展上市公司内控自我评价，梳理排查内控缺陷和风险隐患，不断提升内控有效性。'
  rows[2715] = '根据公司财务报告内部控制重大缺陷的认定情况，于内部控制评价报告基准日，不存在财务报告内部控制重大缺陷，公司已按照企业内部控制规范体系和相关规定的要求在所有重大方面保持了有效的财务报告内部控制；'
  rows[2716] = '根据公司非财务报告内部控制重大缺陷认定情况，于内部控制评价报告基准日，公司未发现非财务报告内部控制重大缺陷。'
  const filing = { ...source, content: rows.join('\n') }
  const packet = selectCompanyEvidence([filing], ['annual'], ['风险', '治理', '内部控制', '关联交易', '实际控制人', '董事长', '总经理'], { purpose: 'company_risk_analysis', maxExcerptsPerSource: 120, maxCharacters: 24000 })[0]!
  for (const row of [2020, 2023, 2024, 2059, 2061, 2712, 2714, 2716, 2717]) assert.ok(packet.excerpts.some(excerpt => excerpt.location === `paragraph:${row}`), `risk packet missing governance paragraph ${row}`)
  const defaultBudgetPacket = selectCompanyEvidence([filing], ['annual'], ['风险', '客户', '竞争', '政策', '负债', '汇率', '诉讼'], { purpose: 'company_risk_analysis' })[0]!
  for (const row of [2061, 2717]) assert.ok(defaultBudgetPacket.excerpts.some(excerpt => excerpt.location === `paragraph:${row}`), `default risk packet missing key governance disclosure ${row}`)
})

test('employee-plan full header and data span, share actions and split research ratio survive selection', () => {
  for (const row of [401, 416, 419]) has('management_governance_analysis', row)
  for (const row of [501, 503, 552, 553, 911]) has('capital_allocation_review', row)
  for (const purpose of ['product_technology_analysis', 'financial_quality_analysis', 'capital_allocation_review']) has(purpose, 757)
})

test('financial evidence keeps split margin-change column headers through the final continuation row', () => {
  const rows = Array.from({ length: 80 }, (_, index) => `常规披露${index}`)
  rows.splice(15, 0, '单位：元', '营业收入 营业成本 毛利率', '营业收入', '比上年同期', '增减', '营业成本', '比上年同期', '增减', '毛利率比上年同期增减', '分行业', '交通运输设备及电气制造业 275,341 213,863 22.33% -8.98% -11.24% 1.98%')
  const filing = { ...source, content: rows.join('\n') }
  const packet = selectCompanyEvidence([filing], ['annual'], ['毛利率'], { purpose: 'financial_quality_analysis' })[0]!
  assert.ok(packet.excerpts.some((excerpt) => excerpt.text === '营业收入'))
  assert.ok(packet.excerpts.some((excerpt) => excerpt.text === '比上年同期'))
  assert.ok(packet.excerpts.some((excerpt) => excerpt.text === '毛利率比上年同期增减'))
  const marginRow = packet.excerpts.find((excerpt) => excerpt.text.includes('22.33% -8.98% -11.24% 1.98%'))
  assert.ok(marginRow)
  assert.ok(marginRow.contextLocations?.includes('paragraph:19'), 'the comparator-period continuation must be bound to the row')
  assert.ok(marginRow.contextLocations?.includes('paragraph:20'), 'the change-column label must be bound to the row')
  assert.ok(marginRow.contextLocations?.includes('paragraph:24'), 'the complete gross-margin change header must be bound to the row')
})

test('business-driver evidence binds a split segment label to its numeric continuation and the complete margin header', () => {
  const rows = Array.from({ length: 80 }, (_, index) => `常规披露${index}`)
  rows.splice(18, 0,
    '营业收入 营业成本 毛利率',
    '营业收入', '比上年同期', '增减',
    '营业成本', '比上年同期', '增减',
    '毛利率比上年同期', '增减',
    '分行业',
    '交通运输设备及电气制',
    '造业 275,341,358,000.00 213,863,297,000.00 22.33% -8.98% -11.24% 1.98%',
    '分产品',
    '汽车、汽车相关产品及',
    '其他产品 275,341,358,000.00 213,863,297,000.00 22.33% -8.98% -11.24% 1.98%',
  )
  const filing = { ...source, content: rows.join('\n') }
  const packet = selectCompanyEvidence([filing], ['annual'], ['收入', '成本', '毛利率'], { purpose: 'business_driver_analysis' })[0]!
  for (const row of [30, 33]) {
    const values = packet.excerpts.find(excerpt => excerpt.location === `paragraph:${row}`)
    const splitLabel = row - 1
    assert.ok(values, `numeric segment row ${row} must remain available`)
    assert.ok(packet.excerpts.some(excerpt => excerpt.location === `paragraph:${splitLabel}`), `split label ${splitLabel} must remain available`)
    assert.ok(values.contextLocations?.includes(`paragraph:${splitLabel}`), `numeric row ${row} must carry its split label`)
    assert.ok(values.contextLocations?.includes('paragraph:27'), 'the metric row must carry the complete change-column header')
  }
})

test('driver packets retain both industry and product margin rows under competing annual-report evidence', () => {
  const rows = Array.from({ length: 1800 }, (_, i) => `收入成本与增长背景${i}。`)
  rows.splice(1400, 0, '2026年半年度', '单位：元', '营业收入 营业成本 毛利率',
    '营业收入比上年同期增减', '营业成本比上年同期增减', '毛利率比上年同期增减',
    '分行业', '电子制造业 100,000 90,000 10% 2% 3% -1%', '交通运输设备及电气制',
    '造业 400,000 300,000 25% -5% -7% 2%', '分产品', '电子产品 100,000 90,000 10% 2% 3% -1%',
    '汽车及其他产品 400,000 300,000 25% -5% -7% 2%', '分地区', '境内 500,000 390,000 22%')
  const filing = { ...source, content: rows.join('\n') }
  const packet = selectCompanyEvidence([filing], ['annual'], ['收入', '成本', '增长'], { purpose: 'business_driver_analysis', maxCharacters: 5000, maxExcerptsPerSource: 36 })[0]!
  for (const text of ['造业 400,000', '汽车及其他产品 400,000']) {
    const values = packet.excerpts.find(row => row.text.startsWith(text))
    assert.ok(values, `${text} must survive budget competition`)
    for (const location of ['paragraph:1402', 'paragraph:1403', 'paragraph:1406']) assert.ok(values.contextLocations?.includes(location), `${text} missing unit/header ${location}`)
  }
  assert.ok(packet.excerpts.some(row => row.text === '交通运输设备及电气制'))
  assert.ok(packet.excerpts.reduce((sum, row) => sum + row.text.length, 0) <= 5000)
})

test('capital-allocation packets retain historical actions without inventing acquisition consideration', () => {
  const rows = Array.from({ length: 11000 }, (_, i) => `投资状况、研发投入与资本支出常规背景${i}。`)
  rows[580] = '本集团于2023年底完成收购甲公司相关业务，并表带来业务规模扩大。'
  rows[581] = '该交易对报告期业务收入具有贡献；本段未列交易对价或投资回报。'
  rows[10480] = '2022年员工持股计划'
  rows[10481] = '公司通过回购专用账户累计回购 A 股股份的数量为 5,123,456 股，'
  rows[10482] = '占总股本的0.20%，并于2022年6月完成回购，7月完成过户登记。'
  rows[10483] = '本员工持股计划认购价为0元/股，参与对象无需出资。'
  rows[900] = '公司计划半年度不派发现金红利。'
  rows[1600] = '研发投入金额（元） 500,000 400,000 25%'
  const filing = { ...source, content: rows.join('\n') }
  const packet = selectCompanyEvidence([filing], ['annual'], ['投资', '研发', '回购'], { purpose: 'capital_allocation_review', maxCharacters: 6000, maxExcerptsPerSource: 48 })[0]!
  for (const location of ['paragraph:581', 'paragraph:582', 'paragraph:10482', 'paragraph:10483', 'paragraph:901', 'paragraph:1601']) assert.ok(packet.excerpts.some(row => row.location === location), `missing distinct capital question ${location}`)
  assert.ok(packet.excerpts.reduce((sum, row) => sum + row.text.length, 0) <= 6000)
  assert.ok(packet.excerpts.every(row => rows[Number(row.location.split(':')[1]) - 1] === row.text), 'selection must preserve original source facts')
})

test('focused peer product packets retain fetched model identity alongside late specification rows', () => {
  const rows = Array.from({ length: 850 }, (_, i) => `页面导航${i}`)
  rows[120] = '全新甲牌银河E8'
  rows[477] = '充电5分钟补能200公里'
  rows[749] = '纯电续航700km'
  const peer = { ...source, title: '甲牌银河E8 官方车型与配置', content: rows.join('\n'), candidate: { ...source.candidate, candidateId: 'peer-model', metadata: { researchSubject: 'peer_company', focusedPeerProduct: true } } } as typeof source
  const packet = selectCompanyEvidence([peer], ['peer-model'], ['竞争', '续航', '充电'], { purpose: 'competitive_market_map', maxCharacters: 1500 })[0]!
  for (const location of ['paragraph:121', 'paragraph:478', 'paragraph:750']) assert.ok(packet.excerpts.some(row => row.location === location), `missing fetched peer answer ${location}`)
  const noBodyIdentity = { ...peer, content: peer.content.replace('全新甲牌银河E8', '车型展示') }
  const noIdentityPacket = selectCompanyEvidence([noBodyIdentity], ['peer-model'], ['续航'], { purpose: 'competitive_market_map', maxCharacters: 1500 })[0]!
  assert.ok(noIdentityPacket.excerpts.every(row => !row.text.includes('E8')), 'candidate title must not be inserted as body evidence')
})

test('management evidence keeps career and responsibility rows throughout the biography section', () => {
  const packet = select('management_governance_analysis')
  assert.ok(packet.excerpts.some((excerpt) => excerpt.location === 'paragraph:971'), 'the later executive biography and responsibility must survive the packet budget')
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

test('all five business question families retain complete revenue policy instead of spending every slot on earlier tables', () => {
  const text = source.content.split('\n')
  const insert = (index: number, rows: string[]) => rows.forEach((row, offset) => { text[index + offset] = row })
  insert(250, ['分地区', '境外收入100元 占比50%', '境内收入100元 占比50%', '分销售模式', '直销收入200元 占比100%'])
  insert(920, ['公司按照客户取得商品控制权转移条件确认收入。'])
  insert(950, ['同类业务采用不同经营模式涉及不同收入确认方式及计量方法的情况', '公司主要销售产品，属于在某一时点履行的履约义', '务。内销收入在送达地点并由客户确认接受后，', '且相关经济利益很可能流入时确认。外销收入在取得出口报关单及提单后，', '且已取得收款权利并预计经济利益流入时确认。'])
  const businessSource = { ...source, content: text.join('\n') }
  for (const purpose of ['business_model_map', 'company_content_review']) {
    const cap = purpose === 'company_content_review' ? 12000 : 32000
    const packet = selectCompanyEvidence([businessSource], ['annual'], ['主要业务', '客户', '供应商', '分产品', '收入确认'], { purpose, maxCharacters: cap })[0]!
    for (const row of [...purpose === 'business_model_map' ? [251] : [], 306, 331, 654, 951, 952, 953, 954, 955]) assert.ok(packet.excerpts.some((excerpt) => excerpt.location === `paragraph:${row}`), `${purpose} missing family row ${row}`)
    assert.ok(packet.excerpts.length <= (purpose === 'company_content_review' ? 120 : 96))
    assert.ok(packet.excerpts.reduce((sum, row) => sum + row.text.length, 0) <= cap)
  }
})

test('product evidence preserves current distinct commercialization stages alongside dated older outlook', () => {
  const old = { ...source, candidate: { ...source.candidate, candidateId: 'old', publishedAt: '2025-03-28' }, title: '2024年年度报告', content: '公司研发人工智能服务器，预计未来将实现批量出货。' }
  const current = { ...source, candidate: { ...source.candidate, candidateId: 'current', publishedAt: '2026-08-28' }, title: '2026年半年度报告', content: '主要产品及技术进展\n服务器多款产品已批量出货。\n液冷冷板产品完成开发，进入量产爬坡。\n高压电源及高速互联产品仍处于研发阶段。' }
  const packets = selectCompanyEvidence([old, current], ['old', 'current'], ['产品', '技术', '研发'], { purpose: 'product_technology_analysis', maxCharacters: 3000 })
  const latest = packets.find((packet) => packet.sourceCandidateId === 'current')!
  assert.equal(latest.publishedAt, '2026-08-28')
  for (const row of [2, 3, 4]) assert.ok(latest.excerpts.some((excerpt) => excerpt.location === `paragraph:${row}`))
  assert.ok(packets.find((packet) => packet.sourceCandidateId === 'old')!.excerpts.some((excerpt) => excerpt.text.includes('预计未来')))
  assert.ok(packets.flatMap((packet) => packet.excerpts).reduce((sum, row) => sum + row.text.length, 0) <= 3000)
})


test('risk packet independently retains acquisition goodwill and geographic revenue rows with actual headers',()=>{
  const text=Array.from({length:9000},()=> '常规经营披露。')
  const place=(start:number,rows:string[])=>rows.forEach((row,index)=>{text[start-1+index]=row})
  place(300,['前五名客户合计销售金额占年度销售总额比例64.33%','序号 客户名称 销售额（元） 占比','1 第一名 18,642,838,150.75 46.46%'])
  place(862,['（1） 营业收入构成','单位：元','2025 年 2024 年','同比增减','金额 占营业收入比重 金额 占营业收入比重','营业收入合计 40,124,858,839.52 100% 36,770,374,347.58 100% 9.12%','分行业','计算机、通信和','其他电子 39,643,732,616.04 98.80%','其他 481,126,223.48 1.20%','分产品','电子电路产品 25,620,292,915.99 63.85%','光电显示模组 5,985,629,058.48 14.92%','精密组件产品 5,930,242,495.99 14.78%','光模块 1,435,534,921.96 3.58%','其他 1,153,159,447.10 2.87%','分地区','内销 7,459,672,435.12 18.59%','外销 32,665,186,404.40 81.41%'])
  place(8694,['（2） 合并成本及商誉','单位：元','合并成本 GMD集团 索尔思光电','--现金 23.87 4,358,975,888.59','--非现金资产的公允价值','--发行或承担的债务的公允价值 509,852,329.73','--发行的权益性证券的公允价值','--或有对价的公允价值','--购买日之前持有的股权于购买日的公允价值','--其他','合并成本合计 509,852,353.60 4,358,975,888.59','加：已归属 ESOP 部分的公允价值 304,121,718.99','减：取得的可辨认净资产公允价值份额 980,550,123.68 1,838,004,095.10','商誉/合并成本小于取得的可辨认净资产公允价值份额的金额 -470,697,770.08 2,825,093,512.48'])
  place(8705,['本公司记账本位币和编制本财务报表所采用的货币均为人民币，除有特别说明外，均以人民币千元为单位表示。'])
  place(8712,['商誉原值','被购买方 年初余额 本年增加 本年减少 年末余额','比亚迪汽车有限公司 63,399 - - 63,399','Juno Newco 4,361,657 - - 4,361,657','合计 4,437,242 - - 4,437,242','商誉减值准备','被购买方 年初余额 本年计提 本年处置 年末余额','比亚迪汽车有限公司 - 9,671 - 9,671','商誉所在资产组为手机部件业务，关键假设包含预测收入增长率、毛利率及折现率。'])
  const filing={...source,content:text.join('\n')}
  const fillers=Array.from({length:8},(_,index)=>({...filing,candidate:{...filing.candidate,candidateId:`filler-${index}`},title:`公开风险资料${index}`,content:'风险与客户、竞争、政策、负债和汇率情况。'.repeat(400)}))
  const selected=selectCompanyEvidence([...fillers,filing],['annual',...fillers.map(item=>item.candidate.candidateId)],['风险','客户','竞争','政策','负债','汇率','诉讼'],{purpose:'company_risk_analysis'})
  const packet=selected.find(item=>item.sourceCandidateId==='annual')!
  for(const row of [300,302,862,863,864,866,878,879,880,8695,8696,8704,8705,8707,8712,8713,8714,8715,8716,8717,8718,8719,8720,8721,8722])assert.ok(packet.excerpts.some(excerpt=>excerpt.location===`paragraph:${row}`),`risk omitted primary source row ${row}`)
  assert.ok(packet.excerpts.length<=96)
  assert.ok(packet.excerpts.reduce((sum,row)=>sum+row.text.length,0)<=32000)
})

test('default risk evidence reserves customer concentration summary and largest two rows beside governance and goodwill bundles',()=>{
  const rows=Array.from({length:9000},(_,index)=>`常规经营披露${index+1}`)
  const place=(start:number,values:string[])=>values.forEach((value,index)=>{rows[start-1+index]=value})
  place(300,['公司主要销售客户情况','前五名客户合计销售金额（元） 145,648,095,000.00','前五名客户合计销售金额占年度销售总额比例18.12%','公司前5大客户资料','序号 客户名称 销售额（元） 占年度销售总额比例','1 客户一 100,736,686,000.00 12.53%','2 客户二 16,498,131,000.00 2.05%','3 客户三 8,000,000,000.00 1.00%'])
  place(2058,['控股股东、实际控制人同时担任上市公司董事长和总经理的情况','公司实际控制人同时担任董事长和总经理，相关安排可能形成决策集中。'])
  place(2711,['十一、报告期内的内部控制制度建设及实施情况','公司已建立内部控制体系并持续完善制度建设。','报告期内持续开展内控自我评价。','不存在财务报告内部控制重大缺陷。'])
  place(8500,['19、商誉','商誉原值','年初余额 本年增加 本年减少 年末余额','被购买方甲 4,361,657 - - 4,361,657','商誉减值准备','被购买方 年初余额 本年计提 本年处置 年末余额','被购买方甲 - 96,621 - 96,621','商誉所在资产组关键假设包含预测收入增长率、毛利率和折现率。'])
  const filing={...source,content:rows.join('\n')}
  const fillers=Array.from({length:7},(_,index)=>({...filing,candidate:{...filing.candidate,candidateId:`risk-filler-${index}`},title:`公开风险资料${index}`,content:'风险、客户、竞争、政策、负债、汇率、诉讼与治理信息。'.repeat(500)}))
  const selected=selectCompanyEvidence([...fillers,filing],['annual',...fillers.map(item=>item.candidate.candidateId)],['风险','客户','竞争','政策','负债','汇率','诉讼'],{purpose:'company_risk_analysis'})
  const packet=selected.find(item=>item.sourceCandidateId==='annual')!
  const find=(row:number)=>packet.excerpts.find(excerpt=>excerpt.location===`paragraph:${row}`)
  for(const row of [301,302,304,305,306])assert.ok(find(row),`default multi-source risk packet omitted customer concentration paragraph ${row}`)
  assert.ok(find(305)?.contextLocations?.includes('paragraph:304'),'largest-customer value must bind the exact customer-table header')
  assert.ok(find(306)?.contextLocations?.includes('paragraph:304'),'second-largest-customer value must bind the exact customer-table header')
  for(const row of [2059,8500,8501,8502,8503,8504,8505,8506,8507])assert.ok(find(row),`competing risk evidence bundle omitted paragraph ${row}`)
})

test('default multi-source risk packets reserve exact latest goodwill discount-rate tables under R82-sized competition',()=>{
  const annualRows=Array.from({length:9000},()=> '常规经营披露。')
  const interimRows=Array.from({length:5100},()=> '常规经营披露。')
  const place=(rows:string[],start:number,values:string[])=>values.forEach((value,index)=>{rows[start-1+index]=value})
  place(annualRows,8571,['（4）可收回金额的具体确定方法','项目 预算/预测期','Juno Newco','预测期 5年','预测期增长率 2%~5%','折现率 14.67%','永续增长率 2.0%','预计现金流量根据经公司管理层审批的5年现金流量预测为基础'])
  place(interimRows,4850,['关键参数','稳定期的关键参数 稳定期的关键参数的确定依据','Juno Newco* 5','可收回金额按照未来','现金流量的现值计算','预测期增长率2%~5%','折现率14.67%','永续增长率2.0%','预计现金流量根据经公司管理','层审批的5年现金流量预测为','基础','*采用资产组组合的预计未来现金流量现值计算的可收回金额高于资产组账面价值，上述参数的合理变化不会导致商誉出现减值。'])
  const annual={...source,candidate:{...source.candidate,candidateId:'byd-annual-2025',publishedAt:'2026-03-28'},title:'2025年年度报告',content:annualRows.join('\n')}
  const interim={...source,candidate:{...source.candidate,candidateId:'byd-interim-2026',publishedAt:'2026-08-28'},title:'2026年半年度报告',content:interimRows.join('\n')}
  const fillers=Array.from({length:8},(_,index)=>({...source,candidate:{...source.candidate,candidateId:`risk-filler-${index}`},title:`公开风险资料${index}`,content:'风险、客户、竞争、政策、负债、汇率、诉讼与治理信息。\n'.repeat(500)}))
  const packets=selectCompanyEvidence([...fillers,annual,interim],['byd-annual-2025','byd-interim-2026',...fillers.map(item=>item.candidate.candidateId)],['风险','客户','竞争','政策','负债','汇率','商誉'],{purpose:'company_risk_analysis'})
  const annualPacket=packets.find(packet=>packet.sourceCandidateId==='byd-annual-2025')
  const interimPacket=packets.find(packet=>packet.sourceCandidateId==='byd-interim-2026')
  assert.ok(annualPacket,'2025 annual filing must remain eligible in the default source set')
  assert.ok(interimPacket,'latest interim filing must remain eligible in the default source set')
  for(const [packet,row] of [[annualPacket,8576],[interimPacket,4856]] as const){
    const discount=packet.excerpts.find(excerpt=>excerpt.location===`paragraph:${row}`)
    assert.match(discount?.text??'',/折现率\s*14\.67%/)
    assert.ok(packet.excerpts.some(excerpt=>excerpt.location===`paragraph:${row-1}`&&/预测期增长率/.test(excerpt.text)),'the discount row must retain its adjacent growth-rate label')
    assert.ok(packet.excerpts.some(excerpt=>excerpt.location===`paragraph:${row+1}`&&/永续增长率/.test(excerpt.text)),'the discount row must retain its adjacent terminal-growth label')
  }
  assert.ok(interimPacket.excerpts.some(excerpt=>excerpt.location==='paragraph:4850'&&/关键参数/.test(excerpt.text)),'the latest interim discount rate must retain the exact table heading')
  assert.ok(interimPacket.excerpts.some(excerpt=>excerpt.location==='paragraph:4861'&&/不会导致商誉出现减值/.test(excerpt.text)),'the packet must retain the stated impairment sensitivity conclusion')
})

test('required structured financial evidence survives a relevance-ranked method refresh',()=>{
  const sources=Array.from({length:20},(_,index)=>({...source,candidate:{...source.candidate,candidateId:`public-${index}`},title:`公开风险资料 ${index}`,content:`风险客户竞争政策负债情况 ${index}`}))
  const financial={...source,candidate:{...source.candidate,candidateId:'akshare-financial-002384'},title:'Company financial history',content:'{"kind":"financial","rows":[{"periodEnd":"2026-06-30","metrics":{"revenue":100,"operatingCashFlow":60}}]}'}
  const selected=selectCompanyEvidence([...sources,financial],[...sources.map(item=>item.candidate.candidateId),'akshare-financial-002384'],['风险','客户','负债'],{purpose:'company_risk_analysis',maxSources:4,requiredSourceCandidateIds:['akshare-financial-002384']})
  assert.ok(selected.some(packet=>packet.sourceCandidateId==='akshare-financial-002384'))
})

test('customer and supplier amounts bind their own inline-unit column headers and goodwill uses the financial-statement convention',()=>{
  const lines=Array.from({length:8600},()=> '常规披露。');
  const place=(number:number,text:string)=>{lines[number-1]=text};
  place(888,'单位：元');place(889,'产品分类 项目');place(890,'2025 年 2024 年');place(896,'产品 主营业务成本 144,552,489,000.00 21.86%');
  place(910,'（6） 报告期内合并范围是否发生变动');place(915,'（8） 主要销售客户和主要供应商情况');place(916,'公司主要销售客户情况');place(917,'前五名客户合计销售金额（元） 145,648,095,000.00');place(918,'前五名客户合计销售金额占年度销售总额比例18.12%');place(920,'公司前5大客户资料');place(921,'序号 客户名称 销售额（元） 占年度销售总额比例');place(922,'1 客户一 100,736,686,000.00 12.53%');place(923,'2 客户二 16,498,131,000.00 2.05%');
  place(930,'公司主要供应商情况');place(932,'前五名供应商合计采购金额占年度采购总额比例15.31%');place(934,'公司前5名供应商资料');place(935,'序号 供应商名称 采购额（元） 占年度采购总额比例');place(936,'1 供应商一 62,801,970,000.00 9.74%');
  place(7023,'3、记账本位币');place(7024,'本公司记账本位币和编制本财务报表所采用的货币均为人民币，除有特别说明外，均以人民币千元为单位表示。');
  place(8525,'于2025年12月31日，通过内部研发形成的无形资产占无形资产年末余额的比例为0.21%（2024年：2.26%）');place(8534,'七、合并财务报表主要项目注释（续）');place(8535,'19、商誉');place(8536,'（1）商誉原值');place(8537,'年初余额 本年增加 本年减少 年末余额');place(8542,'Juno Newco 4,361,657 - - 4,361,657');place(8543,'合计 4,437,242 - - 4,437,242');
  place(8570,'（4）可收回金额的具体确定方法');place(8571,'项目 预算/预测期');place(8572,'预测期 5年');place(8573,'预测期增长率 2%~5%');place(8574,'折现率 14.67%');place(8575,'永续增长率 2.0%');
  const filing={...source,content:lines.join('\n')};
  const packet=selectCompanyEvidence([filing],['annual'],['客户','供应商','商誉'],{purpose:'company_risk_analysis',maxExcerptsPerSource:120,maxCharacters:24000})[0]!;
  const find=(n:number)=>packet.excerpts.find(e=>e.location===`paragraph:${n}`);
  assert.ok(find(922)?.contextLocations?.includes('paragraph:921'));
  assert.ok(find(923)?.contextLocations?.includes('paragraph:921'));
  assert.ok(find(936)?.contextLocations?.includes('paragraph:935'));
  for(const n of [922,923,936])assert.ok(!find(n)?.contextLocations?.includes('paragraph:888'));
  assert.ok(find(8542)?.contextLocations?.includes('paragraph:7024'));
  assert.ok(find(7024),'the convention text must actually be supplied');
  assert.ok(!find(8542)?.contextLocations?.includes('paragraph:8525'),'an explanatory narrative is not a table date header');
  for(const n of [8571,8572,8573,8574,8575])assert.ok(find(n),`risk packet must include recoverable amount assumption row ${n}`)
  assert.ok(!find(8542)?.contextLocations?.includes('paragraph:888'));
  const overridden={...filing,content:lines.map((line,index)=>index===8535?'单位：元':line).join('\n')};
  const explicit=selectCompanyEvidence([overridden],['annual'],['商誉'],{purpose:'company_risk_analysis',maxExcerptsPerSource:120,maxCharacters:24000})[0]!.excerpts.find(e=>e.location==='paragraph:8542');
  assert.ok(explicit?.contextLocations?.includes('paragraph:8536'),'the explicit unit inside the goodwill note takes precedence');
  assert.ok(!explicit?.contextLocations?.includes('paragraph:7024'),'a local unit cannot be replaced by the global convention');
});

test('vehicle operating data binds the split vehicle header and its production-count footnote',()=>{
  const rows=Array.from({length:420},()=> '常规披露。');
  rows.splice(60,0,'公司开展新能源汽车相关业务','新能源汽车整车及零部件的生产经营情况','产品类别 产能状况 快报产量 快报销量 销售收入（元）','乘用车 4,479,392 4,479,392 4,545,423 541,917,643,000.00','商用车 57,964 57,964 57,013 11,780,683,000.00','注:产能状况指报告期产量，单位为辆。','二、报告期内公司所处行业情况');
  const filing={...source,content:rows.join('\n')};
  const packet=selectCompanyEvidence([filing],['annual'],['产销量','汽车'],{purpose:'business_driver_analysis'})[0]!;
  const passenger=packet.excerpts.find(row=>row.text.startsWith('乘用车 4,479,392'));
  const commercial=packet.excerpts.find(row=>row.text.startsWith('商用车 57,964'));
  assert.ok(passenger?.contextLocations?.includes('paragraph:63'),'passenger-car values must retain the monetary column header');
  assert.ok(commercial?.contextLocations?.includes('paragraph:63'),'commercial-vehicle values must retain the monetary column header');
  assert.ok(passenger?.contextLocations?.includes('paragraph:66'),'passenger-car production-count units must retain the footnote');
  assert.ok(commercial?.contextLocations?.includes('paragraph:66'),'commercial-vehicle production-count units must retain the footnote');
});

test('business model evidence binds a split product-segment label to its numeric continuation row',()=>{
  const rows=Array.from({length:830},()=> '常规披露。');
  rows[804]='（1）营业收入构成';
  rows[805]='单位：元';
  rows[806]='2025 年 2024 年';
  rows[817]='分产品';
  rows[818]='手机部件及组装';
  rows[819]='手机部件及组装 155,236,528,000.00 19.31%';
  rows[820]='汽车、汽车相关';
  rows[821]='产品及其他产品 648,645,636,000.00 80.68%';
  const filing={...source,content:rows.join('\n')};
  const packet=selectCompanyEvidence([filing],['annual'],['分产品','汽车'],{purpose:'business_model_map'})[0]!;
  const continuation=packet.excerpts.find(row=>row.location==='paragraph:822');
  assert.ok(continuation,'the numeric continuation row must remain in the packet');
  assert.ok(continuation.contextLocations?.includes('paragraph:821'),'the split label paragraph must be explicitly linked to its value row');
  assert.ok(packet.excerpts.some(row=>row.location==='paragraph:821'));
});

test('business model selection binds the exact BYD phone-parts label split to the 2025 revenue row',()=>{
  const rows=Array.from({length:830},()=> '常规披露。');
  rows[804]='（1）营业收入构成';
  rows[805]='单位：元';
  rows[806]='2025 年 2024 年';
  rows[817]='分产品';
  rows[818]='手机部件、组装';
  rows[819]='及其他产品 155,236,528,000.00 19.31% 159,608,576,000.00 20.54% -2.74%';
  const filing={...source,content:rows.join('\n')};
  const packet=selectCompanyEvidence([filing],['annual'],['分产品','手机部件','收入'],{purpose:'business_model_map'})[0]!;
  const valueRow=packet.excerpts.find(row=>row.location==='paragraph:820');
  assert.ok(valueRow,'the row containing the 2025 amount and share must be supplied');
  assert.ok(valueRow.contextLocations?.includes('paragraph:819'),'the exact product-label fragment must be explicitly linked to the numeric row');
  assert.ok(valueRow.contextLocations?.includes('paragraph:807'),'year and column header context remains linked');

  const alteredRows=[...rows];
  alteredRows[818]='手机部件组装';
  const altered=selectCompanyEvidence([{...filing,content:alteredRows.join('\n')}],['annual'],['分产品','手机部件','收入'],{purpose:'business_model_map'})[0]!;
  assert.ok(!altered.excerpts.find(row=>row.location==='paragraph:820')?.contextLocations?.includes('paragraph:819'), 'non-matching label fragments must not be promoted to context');
});

test('business model always retains split automotive product revenue label and exact numeric continuation',()=>{
  const rows=Array.from({length:900},()=> '常规经营披露。');
  rows[804]='（1） 营业收入构成';
  rows[805]='单位：元';
  rows[806]='2025 年 2024 年';
  rows[807]='同比增减';
  rows[808]='金额 占营业收入';
  rows[809]='比重 金额 占营业收入比重';
  rows[817]='分产品';
  rows[818]='手机部件、组装';
  rows[819]='及其他产品 155,236,528,000.00 19.31% 159,608,576,000.00 20.54% -2.74%';
  rows[820]='汽车、汽车相关';
  rows[821]='产品及其他产品 648,645,636,000.00 80.68% 617,381,935,000.00 79.45% 5.06%';
  rows[822]='其他 82,794,000.00 0.01% 111,944,000.00 0.01% -26.04%';
  rows[823]='分地区';
  const filing={...source,content:rows.join('\n')};
  const packet=selectCompanyEvidence([filing],['annual'],['商业模式','经营模式','客户','供应商','业务','主营','渠道','产品','成本','收入确认','收入结构','分部'],{purpose:'business_model_map'})[0]!;
  const value=packet.excerpts.find(row=>row.location==='paragraph:822');
  assert.ok(value,'the automotive product amount/share continuation must be retained');
  assert.ok(packet.excerpts.some(row=>row.location==='paragraph:821'),'the split automotive product label must be retained');
  assert.ok(value.contextLocations?.includes('paragraph:821'),'the exact split label must be linked to the automotive numeric row');
  assert.ok(value.contextLocations?.includes('paragraph:807'),'the year and table header remain linked to the value row');
});

test('governance method receives internal-control and related-transaction disclosures rather than making false absence claims',()=>{
  const lines=Array.from({length:80},(_,index)=>`常规治理披露${index+1}`)
  lines[30]='公司已建立内部控制体系，并制定关联交易决策制度。'
  lines[31]='内部控制审计报告认为公司财务报告内部控制在所有重大方面保持有效。'
  const filing={...source,candidate:{...source.candidate,candidateId:'governance-filing'},content:lines.join('\n')}
  const packet=selectCompanyEvidence([filing],['governance-filing'],['治理','关联交易','内控'],{purpose:'management_governance_analysis'})[0]!
  const selected=packet.excerpts.map(row=>row.text).join('\n')
  assert.match(selected,/已建立内部控制体系/)
  assert.match(selected,/关联交易决策制度/)
  assert.match(selected,/内部控制审计报告/)
});

test('official introduction and legal predecessor dates survive competing reports for different issuers', () => {
  for (const [issuer, founded, registered, converted] of [['甲制造', 1994, 1995, 2002], ['乙电子', 1980, 1998, 2006]] as const) {
    const intro = { ...source, candidate: { ...source.candidate, candidateId: `${issuer}-intro`, kind: 'web_article', tier: 3, metadata: { officialCompanyHost: true } }, title: `${issuer} About`, content: ['About the company', `Founded in ${founded}, ${issuer} develops industrial products.`, 'Company statement; this describes operating origins.'].join('\n') } as typeof source
    const legal = { ...source, candidate: { ...source.candidate, candidateId: `${issuer}-legal`, kind: 'official_disclosure', tier: 1 }, title: '年度报告', content: `本公司前身于${registered}年共同注册成立。\n公司于${converted}年整体变更为股份有限公司。` } as typeof source
    const noisy = Array.from({length: 8}, (_, i) => ({ ...source, candidate: { ...source.candidate, candidateId: `noisy-${i}` }, content: '发展历程 战略转型 公司历程 成立\n'.repeat(100) }))
    const all = [...noisy, legal, intro]
    const packets = selectCompanyEvidence(all, all.map(row => row.candidate.candidateId), ['发展历程', '公司历程'], {purpose: 'company_history_strategy', maxSources: 2, maxCharacters: 1800})
    assert.equal(packets.length, 2)
    assert.ok(packets.some(packet => packet.sourceCandidateId === intro.candidate.candidateId && packet.excerpts.some(row => row.location === 'paragraph:2' && row.text.includes(`Founded in ${founded}`))))
    assert.ok(packets.some(packet => packet.sourceCandidateId === legal.candidate.candidateId && packet.excerpts.some(row => row.text.includes(`${registered}`))))
    assert.ok(packets.flatMap(packet => packet.excerpts).reduce((sum,row) => sum + row.text.length,0) <= 1800)
  }
})

test('official model parameters retain exact labels, test conditions and locators across issuers and method owners', () => {
  for (const [issuer, model, range] of [['甲汽车', 'A9', 2100], ['乙汽车', 'E2', 620]] as const) {
    const rows = ['车型：' + model, '公司披露，满油满电、NEDC工况；非独立实测。', `综合续航${range}公里`, '充电从10%到70%只需5分钟', '需使用指定充电设施；低温表现可能不同。', '平台电压1000V']
    const page = { ...source, candidate: {...source.candidate, candidateId: issuer, kind:'web_article', tier:3, metadata:{officialCompanyHost:true}}, title: `${issuer} 产品`, content:rows.join('\n') } as typeof source
    const noisy = Array.from({length:6}, (_,i) => ({...source,candidate:{...source.candidate,candidateId:`report-${i}`}, content:'主要产品 核心竞争力分析 技术创新 产品矩阵 研发项目\n'.repeat(100)}))
    for (const purpose of ['product_technology_analysis', 'competitive_market_map']) {
      const all=[...noisy,page]
      const packets=selectCompanyEvidence(all,all.map(row=>row.candidate.candidateId),['产品矩阵','核心竞争力分析'],{purpose,maxSources:1,maxCharacters:1000})
      assert.equal(packets[0]?.sourceCandidateId, issuer)
      for (const [index,text] of rows.entries()) assert.ok(packets[0]!.excerpts.some(row=>row.location===`paragraph:${index+1}` && row.text===text), `${purpose} omitted ${text}`)
      const locations=new Set(packets[0]!.excerpts.map(row=>row.location))
      assert.ok(packets[0]!.excerpts.every(row=>row.contextLocations?.every(location=>locations.has(location)) ?? true))
      assert.ok(packets[0]!.excerpts.reduce((sum,row)=>sum+row.text.length,0)<=1000)
    }
  }
})

test('market packet keeps sourced prior and current industry volumes without relabeling them company TAM', () => {
  const historical={...source,candidate:{...source.candidate,candidateId:'past',kind:'official_disclosure',tier:1},title:'2024年度报告',content:'行业情况\n2024年中国新能源汽车全年销量达到 1,286.6 万辆，同比\n大幅增长 35.5%。该数字为行业历史销量，不代表公司可服务市场。'} as typeof source
  const current={...source,candidate:{...source.candidate,candidateId:'current',kind:'web_article',tier:3,metadata:{researchScope:'industry_context'}},title:'2025行业情况',content:'2025年中国新能源汽车销量1649万辆。\n统计范围为中国全行业全年销量。'} as typeof source
  const noisy=Array.from({length:5},(_,i)=>({...source,candidate:{...source.candidate,candidateId:`noise-${i}`},content:'行业情况 产业链 市场规模 市场空间\n'.repeat(100)}))
  const all=[...noisy,historical,current]
  const packets=selectCompanyEvidence(all,all.map(row=>row.candidate.candidateId),['产业链','市场规模'],{purpose:'market_structure_analysis',maxSources:2,maxCharacters:1200})
  assert.deepEqual(new Set(packets.map(row=>row.sourceCandidateId)),new Set(['past','current']))
  assert.ok(packets.find(row=>row.sourceCandidateId==='past')!.excerpts.some(row=>row.location==='paragraph:2' && row.text.includes('1,286.6')))
  assert.ok(packets.find(row=>row.sourceCandidateId==='current')!.excerpts.some(row=>row.location==='paragraph:1' && row.text.includes('1649')))
  assert.ok(packets.flatMap(row=>row.excerpts).some(row=>row.text.includes('不代表公司可服务市场')))
})

test('unverified promotional text and peer pages do not obtain issuer official-answer priority', () => {
  const trusted={...source,candidate:{...source.candidate,candidateId:'issuer',kind:'official_disclosure',tier:1},content:'主要产品\n研发项目：工业控制器已量产。'} as typeof source
  const promotion={...source,candidate:{...source.candidate,candidateId:'promo',kind:'web_article',tier:3},content:'车型：促销车\n综合续航9999公里\n充电1分钟。'} as typeof source
  const peer={...promotion,candidate:{...promotion.candidate,candidateId:'peer',metadata:{officialCompanyHost:true,researchSubject:'peer_company'}}} as typeof source
  const packets=selectCompanyEvidence([trusted,promotion,peer],['issuer','promo','peer'],['主要产品','研发项目'],{purpose:'product_technology_analysis',maxSources:1})
  assert.equal(packets[0]?.sourceCandidateId,'issuer')
})
