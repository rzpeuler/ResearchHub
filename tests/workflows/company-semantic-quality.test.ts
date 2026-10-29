import test from 'node:test'
import assert from 'node:assert/strict'
import { reconcileKnownReviewerFalsePositives, reviewCompanyResearchSemantics, validateCompanySemanticQualityOutput } from '../../workflows/company-deep-research/semantic-quality.ts'
import { COMPANY_CORE_SECTION_IDS } from '../../workflows/company-deep-research/content-quality.ts'
import type { ReasoningExecutor } from '../../plugins/reasoning/contracts.ts'
import type { NormalizedResearchSource } from '../../plugins/research-acquisition/contracts.ts'

const source = { candidate: { candidateId: 'filing', publishedAt: '2026-03-28' }, title: '2025年年度报告', content: '实际经营正文，产品销售给客户，现金回流；订单下降会导致收入减少。\n未引用的正文不应进入审查。', rights: { accessScope: 'public', aiProcessingAllowed: true, retentionAllowed: true } } as NormalizedResearchSource
const sections = COMPANY_CORE_SECTION_IDS.map((id) => ({ id, markdown: `${id} 实质分析与反证。[filing@paragraph:1]` }))
const output = { sectionChecks: COMPANY_CORE_SECTION_IDS.map((sectionId) => ({ sectionId, questionAnswered: true, evidenceSupportsConclusion: true, numericReproducible: true, riskTransmission: true, reasons: [] as string[] })) }
const executor = (run: (request: any) => Promise<unknown>): ReasoningExecutor => ({ capabilities: () => ({ maxContextTokens: 100000, maxOutputTokens: 4000, maxConcurrency: 1, structuredOutputSupport: true }), execute: async (request) => ({ operation: request.operation, output: await run(request) }) })
const input = { company: { symbol: '002594' }, asOf: '2026-10-14', sources: [source], sections }

test('independent semantic review sends actual cited paragraphs and evaluates all 19 required sections', async () => {
  const result = await reviewCompanyResearchSemantics({ ...input, reasoningExecutor: executor(async (request) => {
    assert.equal(request.metadata.stage, 'content_quality_review')
    assert.equal(request.operation, 'company_research_synthesis')
    assert.equal(request.input.sections.length, 19)
    assert.equal(request.input.citedParagraphs.length, 1)
    assert.equal(request.input.citedParagraphs[0].text, source.content.split('\n')[0])
    assert.match(request.instruction, /不得将该行比例表述为公司合并值/)
    assert.match(request.instruction, /输出前进行旗标与理由一致性检查/)
    assert.match(request.instruction, /跨方法一致性核对/)
    assert.match(request.instruction,/年报所属年度只是披露文件年度，不自动等于预测期/)
    assert.match(request.input.rubric['management-capital-allocation'], /不能扩大成“完整管理层分工缺失”/)
    assert.match(request.input.rubric['business-segments'], /已披露分部收入金额或占比/)
    assert.match(request.input.rubric['company-overview'], /财务序列最早期间当作成立或开始经营日期/)
    assert.match(request.input.rubric['company-overview'], /不得强求每家公司都有全部日期/)
    assert.match(request.input.rubric['company-overview'], /不等于来源披露了其原始设立日期/)
    assert.match(request.input.rubric['financial-quality'], /结构化财务来源的paragraph:1/)
    assert.match(request.input.rubric['financial-quality'], /年报与最新半年报可同时提供不同期间的分析背景/)
    assert.match(request.input.rubric['growth-drivers'], /期间表头与数据行/)
    assert.match(request.input.rubric.risks, /被购买方列标题和数值行逐列核对/)
    assert.match(request.input.rubric['industry-exposure'], /不能因此省略行业规模背景/)
    assert.match(request.input.rubric['industry-exposure'], /跨方法核对competitive_market_map/)
    assert.match(request.input.rubric['monitoring-checklist'], /不得使用未定义的“订单转弱”或“回款信号转弱”/)
    assert.match(request.input.rubric['monitoring-checklist'], /每项触发条件必须落到一个具名、可在指定定期报告或公司公告中重复观察的指标/)
    assert.match(request.input.rubric.catalysts, /competitive_market_map/)
    assert.match(request.input.rubric.catalysts, /不得笼统声称“没有具名竞争对手\/产品路线”/)
    return output
  }) })
  assert.equal(result.passed, true)
  assert.equal(result.sectionChecks.length, 19)
})

test('scenario eligibility requires six exact per-driver economic decisions with method support and counterevidence refs', async () => {
  const ref = { sourceCandidateId: 'filing', location: 'paragraph:1' }
  const plan = { h1CrossCheck: { revenue: { evidence: ref }, parentNetProfit: { evidence: ref } } } as any
  const methodResults = [{ skillId: 'business_driver_analysis', status: 'complete', answer: 'Revenue drivers', findings: [{ text: 'Product demand supports revenue', kind: 'fact', evidence: [ref] }], limitations: [], risks: [], sections: [{ id: 'growth-drivers', markdown: 'Product demand supports revenue.[filing@paragraph:1]' }, { id: 'risks', markdown: 'Cash conversion is counterevidence.[filing@paragraph:1]' }] }] as any
  const decisions = (supported = true) => (['bear', 'base', 'bull'] as const).flatMap(scenario => (['revenue', 'parent-net-profit'] as const).map(driverId => ({
    scenario, driverId, supported, economicRationale: 'Demand and product mix support this rate under the stated operating conditions.', falsificationAssessment: 'Repeated FY2026 filing shows the actual target metric below this point forecast, invalidating the point assumption.',
    supportingEvidenceRefs: [ref], counterevidenceRefs: [ref], reasons: supported ? [] : ['No independent driver evidence supports this scenario.'],
  })))
  const accepted = await reviewCompanyResearchSemantics({ ...input, methodResults, scenarioAssumptionsPlan: plan, reasoningExecutor: executor(async request => {
    assert.ok(request.outputContract.required.includes('scenarioRationaleReviews'))
    assert.ok(request.outputContract.properties.scenarioRationaleReviews.items.required.includes('falsificationAssessment'))
    assert.equal(request.outputContract.properties.scenarioRationaleReviews.minItems, 6)
    assert.equal(request.outputContract.properties.scenarioRationaleReviews.maxItems, 6)
    assert.equal(request.input.scenarioAssumptionsPlan, plan)
    return { ...output, scenarioRationaleReviews: decisions() }
  }) })
  assert.equal(accepted.passed, true)
  assert.equal(accepted.scenarioRationaleReviews?.length, 6)
  const rejected = await reviewCompanyResearchSemantics({ ...input, methodResults, scenarioAssumptionsPlan: plan, reasoningExecutor: executor(async () => ({ ...output, scenarioRationaleReviews: decisions(false) })) })
  assert.equal(rejected.passed, false)
  assert.ok(rejected.issues.some(issue => issue.includes('ECONOMIC_RATIONALE_UNSUPPORTED')))
  const badPair = decisions()
  badPair[0] = { ...badPair[0]!, supportingEvidenceRefs: [{ sourceCandidateId: 'filing', location: 'paragraph:2' }] }
  const malformed = await reviewCompanyResearchSemantics({ ...input, methodResults, scenarioAssumptionsPlan: plan, reasoningExecutor: executor(async () => ({ ...output, scenarioRationaleReviews: badPair })) })
  assert.equal(malformed.passed, false)
  const missingFalsification = decisions().map((decision, index) => index === 0 ? (({ falsificationAssessment: _removed, ...rest }) => rest)(decision) : decision)
  const missingFalsificationResult = await reviewCompanyResearchSemantics({ ...input, methodResults, scenarioAssumptionsPlan: plan, reasoningExecutor: executor(async () => ({ ...output, scenarioRationaleReviews: missingFalsification })) })
  assert.equal(missingFalsificationResult.passed, false)
  assert.ok(missingFalsificationResult.diagnostics.some(item => item.code === 'FORMAT_ERROR'))
})

test('semantic review ignores a false 2025-to-2025 period objection only when the report and cited financial source prove 2024-to-2025', () => {
  const financial = {
    ...source,
    candidate: { ...source.candidate, candidateId: 'akshare-financial-period-pair', metadata: { dataProvenance: { metricId: 'company_financial_history' } } },
    title: 'Company financial history',
    content: JSON.stringify({ kind: 'financial', rows: [
      { periodEnd: '2024-12-31', revenue: 777102455000 },
      { periodEnd: '2025-12-31', revenue: 803964958000 },
    ] }),
  } as NormalizedResearchSource
  const body = '年度财务反证（2024—2025年）：营业收入由777,102,455,000元升至803,964,958,000元；同比＝(803,964,958,000−777,102,455,000)÷777,102,455,000＝3.46%。[akshare-financial-period-pair@paragraph:1]'
  const report = sections.map(section => section.id === 'revenue-profit-drivers' || section.id === 'financial-quality'
    ? { ...section, markdown: body }
    : section)
  const reviewerReason = '年度财务段写“2025—2025年”并将777,102,455,000元列作起点；结构化财务序列及preparedAnalysis显示该值为2024年、803,964,958,000元为2025年。同比计算本身约3.46%正确，但期间标签错误，削弱年度比较表述。'
  const checks = output.sectionChecks.map(check => ['revenue-profit-drivers', 'financial-quality'].includes(check.sectionId)
    ? { ...check, evidenceSupportsConclusion: false, numericReproducible: false, reasons: [check.sectionId === 'financial-quality'
      ? '年度财务段将比较期标成“2025—2025年”，但披露值及结构化数据实际对应2024—2025年；金额及同比复算无误，错误影响比较期间标注。报告对分行业毛利率变动沿用原表百分比口径，并另行披露合并毛利率水平差，未据此发现数值错误。'
      : reviewerReason] }
    : check)

  const reconciled = reconcileKnownReviewerFalsePositives(checks as any, report as any, [financial])
  for (const sectionId of ['revenue-profit-drivers', 'financial-quality']) {
    const check = reconciled.find(item => item.sectionId === sectionId)!
    assert.equal(check.evidenceSupportsConclusion, true)
    assert.equal(check.numericReproducible, true)
    assert.deepEqual(check.reasons, [])
  }

  const actuallyWrong = reconcileKnownReviewerFalsePositives(checks as any, report.map(section =>
    section.id === 'financial-quality' ? { ...section, markdown: body.replace('2024—2025年', '2025—2025年') } : section,
  ) as any, [financial])
  assert.equal(actuallyWrong.find(item => item.sectionId === 'financial-quality')?.evidenceSupportsConclusion, false)
  const missingSource = reconcileKnownReviewerFalsePositives(checks as any, report as any, [])
  assert.equal(missingSource.find(item => item.sectionId === 'financial-quality')?.evidenceSupportsConclusion, false)
  const separateBlocker = reconcileKnownReviewerFalsePositives(checks.map(check => check.sectionId === 'financial-quality'
    ? { ...check, reasons: [check.reasons[0]!, '此外，缺少收入与成本增速的对应公式，导致该产品盈利变化无法复算。'] }
    : check) as any, report as any, [financial])
  assert.equal(separateBlocker.find(item => item.sectionId === 'financial-quality')?.evidenceSupportsConclusion, false)
  assert.equal(separateBlocker.find(item => item.sectionId === 'financial-quality')?.reasons.length, 1)
})

test('semantic review clears only source-verified 2024 industry-period and employee-plan-cap self-contradictions', () => {
  const annualLines = Array.from({ length: 3061 }, () => '一般披露。')
  annualLines[17] = '二零二四年中国新能源汽车全年销量达到1,286.6万辆。'
  annualLines[3059] = '2025年员工持股计划涉及不超过2.5万名员工，资金总额不超过41亿元，计划分三期解锁，业绩考核要求为每年营业收入同比增长不低于10%。'
  annualLines[3060] = '截止2025年5月23日，本员工持股计划已通过二级市场集中竞价累计买入公司A股股票10,714,990股。'
  const annual = { ...source, candidate: { ...source.candidate, candidateId: 'annual-plan-report' }, title: '2025年年度报告', content: annualLines.join('\n') } as NormalizedResearchSource
  const priorLines = Array.from({ length: 18 }, () => '一般披露。')
  priorLines[17] = '二零二四年中国新能源汽车全年销量达到1,286.6万辆。'
  const prior = { ...source, candidate: { ...source.candidate, candidateId: 'annual-2024-report' }, title: '2024年年度报告', content: priorLines.join('\n') } as NormalizedResearchSource
  const report = sections.map(section => section.id === 'industry-exposure'
    ? { ...section, markdown: '| 中国新能源汽车全年销量（历史行业销量，非公司TAM） | 2024全年 | 1,286.6万辆 | 来源 [annual-2024-report@paragraph:18] |' }
    : section.id === 'management-capital-allocation'
      ? { ...section, markdown: '2025年计划条款涉及不超过2.5万名员工、资金总额不超过41亿元；这些是计划上限，不等于实际认购人数。[annual-plan-report@paragraph:3060] [annual-plan-report@paragraph:3061]' }
      : section)
  const review = output.sectionChecks.map(check => check.sectionId === 'industry-exposure'
    ? { ...check, evidenceSupportsConclusion: false, reasons: ['该行虽标注2024年，但明确引用的2024年报原文明确为“二零二四年…全年销量达到1,286.6万辆”；报告表述年份与来源及表内期间相符，未见错置。'] }
    : check.sectionId === 'management-capital-allocation'
      ? { ...check, evidenceSupportsConclusion: false, numericReproducible: false, reasons: ['“2025年计划范围不超过2.5万名员工、资金总额不超过41亿元”确实是计划上限，并非执行实际人数或资金；同段明确标为“计划条款”且其后限定计划披露口径，未误报实绩，原有阻塞理由不成立。'] }
      : check)
  const reconciled = reconcileKnownReviewerFalsePositives(review as any, report as any, [prior, annual])
  assert.equal(reconciled.find(check => check.sectionId === 'industry-exposure')?.evidenceSupportsConclusion, true)
  assert.equal(reconciled.find(check => check.sectionId === 'management-capital-allocation')?.numericReproducible, true)
  assert.deepEqual(reconciled.find(check => check.sectionId === 'industry-exposure')?.reasons, [])
  const wrongPeriod = reconcileKnownReviewerFalsePositives(review as any, report.map(section => section.id === 'industry-exposure' ? { ...section, markdown: section.markdown.replace('2024全年', '2025全年') } : section) as any, [prior, annual])
  assert.equal(wrongPeriod.find(check => check.sectionId === 'industry-exposure')?.evidenceSupportsConclusion, false)
})

test('semantic review reconciles only a self-correcting industry verdict backed by both exact forecast citations', async () => {
  const lines = Array.from({ length: 450 }, () => '公司披露经营情况。')
  lines[447] = 'Market Insights 预测，二零二五年全球 AI 服务器市场规模达 1,672 亿美元，按年增长 30.6%。'
  lines[449] = 'MarketsandMarkets 预计，二零二五年全球数据中心液冷市场规模将达 28.4 亿美元，同比增长 44.9%。'
  const marketSource = { ...source, content: lines.join('\n') } as NormalizedResearchSource
  const body = '行业规模背景：2025年全球AI服务器市场规模1,672亿美元；2025年数据中心液冷市场规模28.4亿美元。[filing@paragraph:448][filing@paragraph:450]'
  const report = sections.map(section => section.id === 'industry-exposure' ? { ...section, markdown: body } : section)
  const selfCorrected = { sectionChecks: output.sectionChecks.map(check => check.sectionId === 'industry-exposure' ? { ...check, evidenceSupportsConclusion: false, numericReproducible: false, reasons: ['此处市场年份与来源一致，不应误判。', '分行业数字按来源行列头复核，未发现实质性数值错引，数字旗标应为true。'] } : check) }
  let fixedCalls = 0
  const fixed = await reviewCompanyResearchSemantics({ ...input, sources: [marketSource], sections: report, reasoningExecutor: executor(async () => { fixedCalls++; return selfCorrected }) })
  assert.equal(fixed.passed, true, JSON.stringify(fixed))
  assert.equal(fixedCalls, 2, 'the first contradictory review still receives its bounded repair call')
  assert.equal(fixed.attempts, 2)
  assert.equal(fixed.diagnostics.some(item => item.code === 'REVIEWER_SELF_CORRECTION_RECONCILED'), true)
  const missingExactCitation = await reviewCompanyResearchSemantics({ ...input, sources: [marketSource], sections: report.map(section => section.id === 'industry-exposure' ? { ...section, markdown: body.replace('paragraph:450', 'paragraph:449') } : section), reasoningExecutor: executor(async () => selfCorrected) })
  assert.equal(missingExactCitation.passed, false)
  assert.equal(missingExactCitation.diagnostics.some(item => item.code === 'REVIEWER_SELF_CORRECTION_RECONCILED'), false)
})

test('semantic review repairs an explicit final self-correction but keeps a concrete cited-row defect blocked', async () => {
  const malformed = { sectionChecks: output.sectionChecks.slice(0, 15) }
  const selfCorrected = { sectionChecks: output.sectionChecks.map(check => check.sectionId === 'growth-drivers'
    ? { ...check, evidenceSupportsConclusion: false, numericReproducible: false, reasons: ['引用来源及2025预测数值相符，未发现实质错误，理由与旗标冲突，应置true。'] }
    : check) }
  let calls = 0
  const fixed = await reviewCompanyResearchSemantics({ ...input, reasoningExecutor: executor(async () => { calls++; return calls === 1 ? malformed : selfCorrected }) })
  assert.equal(fixed.passed, true)
  assert.equal(calls, 2)
  assert.equal(fixed.diagnostics.some(item => item.code === 'REVIEWER_SELF_CORRECTION_RECONCILED'), true)
  const concreteDefect = { sectionChecks: output.sectionChecks.map(check => check.sectionId === 'growth-drivers'
    ? { ...check, evidenceSupportsConclusion: false, numericReproducible: false, reasons: ['但引用paragraph:2错列，预测期间错误；其余证据相符，理由与旗标冲突，应置true。'] }
    : check) }
  let blockedCalls = 0
  const blocked = await reviewCompanyResearchSemantics({ ...input, reasoningExecutor: executor(async () => { blockedCalls++; return blockedCalls === 1 ? malformed : concreteDefect }) })
  assert.equal(blocked.passed, false)
  assert.equal(blocked.diagnostics.some(item => item.code === 'REVIEWER_SELF_CORRECTION_RECONCILED'), false)
})

test('semantic review rejects cited but unsupported conclusions and missing risk transmission despite complete prose', async () => {
  const rejected = { sectionChecks: output.sectionChecks.map((check) => check.sectionId === 'risks' ? { ...check, riskTransmission: false, reasons: ['风险只列名称，没有说明订单下降如何影响收入、观察信号和缓解因素。'] } : check.sectionId === 'financial-quality' ? { ...check, evidenceSupportsConclusion: false, reasons: ['引用经营概况不能支持财务现金转化结论。'] } : check) }
  const result = await reviewCompanyResearchSemantics({ ...input, reasoningExecutor: executor(async () => rejected) })
  assert.equal(result.passed, false)
  assert.equal(result.issues.length, 2)
  assert.equal(result.attempts, 1)
})

test('semantic review retries when a numeric failure reason expressly says the figures are accurate', async () => {
  let calls = 0
  const inconsistent = { sectionChecks: output.sectionChecks.map((check) => check.sectionId === 'management-capital-allocation'
    ? { ...check, numericReproducible: false, reasons: ['2025年研发投入为634.41亿元、2024年为541.61亿元，数据准确。'] }
    : check) }
  const result = await reviewCompanyResearchSemantics({ ...input, reasoningExecutor: executor(async () => {
    calls += 1
    return calls === 1 ? inconsistent : output
  }) })
  assert.equal(calls, 2)
  assert.equal(result.passed, true)
  assert.equal(result.attempts, 2)
  assert.match(result.diagnostics[0]?.message ?? '', /Contradictory numeric rejection/)
})

test('numeric flag stays separate from a correct-calculation statement and a citation-scope concern', () => {
  const financialReason = '“资本开支同比增加”相关计算本身复算正确，但年报年度方向摘要列出的收入、营业利润、净利润、经营现金流均有公式和操作数；无实质数值错引。合并毛利率及净利率公式、单位和同期比较与结构化财务源相符。'
  const riskReason = '索尔思光电金额换算值沿用亿元属正确，但应绑定完整单位和表头；现引用值准确，未造成实质误导。'
  const checks = validateCompanySemanticQualityOutput({ sectionChecks: output.sectionChecks.map(check =>
    check.sectionId === 'financial-quality' ? { ...check, numericReproducible: false, reasons: [financialReason] }
      : check.sectionId === 'risks' ? { ...check, evidenceSupportsConclusion: false, numericReproducible: false, reasons: [riskReason] }
        : check
  ) })
  assert.equal(checks.find(check => check.sectionId === 'financial-quality')!.numericReproducible, true)
  const risks = checks.find(check => check.sectionId === 'risks')!
  assert.equal(risks.numericReproducible, true)
  assert.equal(risks.evidenceSupportsConclusion, false, 'a missing row header remains a real citation blocker')
})

test('a mixed financial verdict keeps real disclosure and comparison gaps without rejecting its correct formulas',()=>{
  const reason='正文称2026年上半年收入、营业利润、净利润和合并毛利率均上行，结构化财务来源确认该方向；但另称“研发资本化金额的本期半年报证据未提供”是有界缺口。真正阻塞是把“研发费用结构化半年累计值上升”列为事实却未列明可比两个数/变化率；更重要，现金转化比及应计代理用结构化净利润字段计算并提示归属未注明，公式正确。'
  const input={sectionChecks:output.sectionChecks.map(check=>check.sectionId==='financial-quality'?{...check,questionAnswered:false,evidenceSupportsConclusion:false,numericReproducible:false,reasons:[reason]}:check)}
  const financial=validateCompanySemanticQualityOutput(input).find(check=>check.sectionId==='financial-quality')!
  assert.equal(financial.questionAnswered,false)
  assert.equal(financial.evidenceSupportsConclusion,false)
  assert.equal(financial.numericReproducible,false)
})

test('independent gap check includes eligible uncited late evidence within its own budget and rejects false gaps', async () => {
  const lateSource = {
    ...source,
    retrievedAt: '2026-04-01T00:00:00Z',
    candidate: { ...source.candidate, metadata: { dataProvenance: { dateStatus: 'explicit', pointInTimeStatus: 'within_cutoff', pointInTimeSafe: true } } },
    content: [source.content.split('\n')[0], ...Array.from({ length: 600 }, () => '公司业务模式与经营活动说明。'.repeat(20)), '分产品收入构成：汽车业务收入占比80.68%，电子业务占比19.31%。', '前五大客户销售占比12.34%，客户集中度下降。', '管理层履历：董事长此前从事电池研发，主要工作经历包括产品制造管理。'].join('\n'),
  } as NormalizedResearchSource
  const excluded = { ...lateSource, candidate: { ...lateSource.candidate, candidateId: 'not-report-eligible' } } as NormalizedResearchSource
  const result = await reviewCompanyResearchSemantics({ ...input, sources: [lateSource, excluded], reportSourceCandidateIds: ['filing', 'nonexistent'], durableSourceCandidateIds: ['not-report-eligible'], reasoningExecutor: executor(async (request) => {
    assert.equal(request.input.citedParagraphs.length, 1)
    assert.equal(request.input.citedParagraphs[0].location, 'paragraph:1')
    const packets = request.input.gapCheckEvidence
    assert.deepEqual(packets.map((packet: any) => packet.sourceCandidateId), ['filing'])
    assert.equal(packets[0].publishedAt, '2026-03-28')
    assert.equal(packets[0].retrievedAt, '2026-04-01T00:00:00Z')
    assert.equal(packets[0].pointInTimeSafe, true)
    assert.equal(packets[0].pointInTimeStatus, 'within_cutoff')
    const excerpts = packets.flatMap((packet: any) => packet.excerpts)
    assert.ok(excerpts.reduce((sum: number, excerpt: any) => sum + excerpt.text.length, 0) <= 12000)
    assert.ok(excerpts.some((excerpt: any) => excerpt.location === 'paragraph:602' && excerpt.text.includes('分产品收入构成')))
    assert.ok(excerpts.some((excerpt: any) => excerpt.location === 'paragraph:603' && excerpt.text.includes('前五大客户')))
    assert.ok(excerpts.some((excerpt: any) => excerpt.location === 'paragraph:604' && excerpt.text.includes('管理层履历')))
    assert.match(request.instruction, /未引用证据只可用来拒绝虚假缺口/)
    return { sectionChecks: output.sectionChecks.map((check) => check.sectionId === 'business-segments' ? { ...check, questionAnswered: false, reasons: ['声称缺少分产品收入构成，但实际可用年报paragraph:602已披露，未据此分析分部角色。'] } : check) }
  }) })
  assert.equal(result.passed, false)
  assert.match(result.issues[0]!, /paragraph:602/)
})

test('semantic review format repair is bounded to two calls and does not treat malformed checks as passing', async () => {
  let calls = 0
  const result = await reviewCompanyResearchSemantics({ ...input, reasoningExecutor: executor(async (request) => { calls++; if(calls===2) assert.equal(request.input.repairPreviousOutput.sectionChecks.length,18); return calls === 1 ? { sectionChecks: output.sectionChecks.slice(0, 18) } : output }) })
  assert.equal(result.passed, true)
  assert.equal(result.attempts, 2)
  assert.equal(result.diagnostics[0]?.code, 'FORMAT_ERROR')
  assert.equal(result.attemptOutputs?.length,2)
  const failed = await reviewCompanyResearchSemantics({ ...input, reasoningExecutor: executor(async () => 'malformed') })
  assert.equal(failed.passed, false)
  assert.equal(failed.attempts, 2)
})

test('semantic review fails closed for missing executor, missing paragraph, and cancellation', async () => {
  assert.equal((await reviewCompanyResearchSemantics(input)).passed, false)
  const bad = await reviewCompanyResearchSemantics({ ...input, sections: sections.map((section) => section.id === 'products' ? { ...section, markdown: '产品分析。[filing@paragraph:999]' } : section), reasoningExecutor: executor(async () => output) })
  assert.match(bad.issues[0]!, /UNRESOLVED_REFERENCE/)
  const controller = new AbortController(); controller.abort()
  assert.equal((await reviewCompanyResearchSemantics({ ...input, signal: controller.signal, reasoningExecutor: executor(async () => output) })).status, 'cancelled')
})

test('semantic review output requires all distinct core IDs, failure reasons and risk-only risk flag', () => {
  assert.throws(() => validateCompanySemanticQualityOutput({ sectionChecks: [...output.sectionChecks.slice(0, 18), output.sectionChecks[0]] }), /Duplicate/)
  assert.throws(() => validateCompanySemanticQualityOutput({ sectionChecks: output.sectionChecks.map((check) => check.sectionId === 'products' ? { ...check, questionAnswered: false } : check) }), /need reasons/)
  assert.throws(() => validateCompanySemanticQualityOutput({ sectionChecks: output.sectionChecks.map((check) => check.sectionId === 'products' ? { ...check, riskTransmission: false, reasons: ['不适用字段。'] } : check) }), /only evaluated/)
})

test('semantic review drops only explicitly dismissed false flags while retaining genuine blockers', () => {
  const review = { sectionChecks: output.sectionChecks.map((check) => {
    if (check.sectionId === 'management-capital-allocation') return { ...check, evidenceSupportsConclusion: false, numericReproducible: false, reasons: [
      '管理层部分称所供履历准确限定于该人；总体讨论已充分，故不构成缺口扩大问题。',
      '研发投入原表比例列符合原单位要求，数值可核；研发率变动事实正确。',
      'GMD表格引用没有把标的列错置；数字未发现实质错误。',
    ] }
    if (check.sectionId === 'risks') return { ...check, evidenceSupportsConclusion: false, numericReproducible: false, riskTransmission: false, reasons: [
      '客户比例数值及来源一致，无实质错误。',
      '商誉数字有正式表格证据；风险传导与估值边界已说明。',
    ] }
    if (check.sectionId === 'financial-quality') return { ...check, evidenceSupportsConclusion: false, numericReproducible: false, reasons: [
      'DSO、DIO、DPO及现金周期列有具体数值但未提供公式，无法复算。',
      '应计代理范围差异已在报告中限定，属非阻塞口径边界。',
    ] }
    return check
  }) }
  const checks = validateCompanySemanticQualityOutput(review)
  const management = checks.find(check => check.sectionId === 'management-capital-allocation')!
  assert.equal(management.evidenceSupportsConclusion, true)
  assert.equal(management.numericReproducible, true)
  assert.deepEqual(management.reasons, [])
  const risks = checks.find(check => check.sectionId === 'risks')!
  assert.equal(risks.evidenceSupportsConclusion, true)
  assert.equal(risks.numericReproducible, true)
  assert.equal(risks.riskTransmission, true)
  assert.deepEqual(risks.reasons, [])
  const financial = checks.find(check => check.sectionId === 'financial-quality')!
  assert.equal(financial.numericReproducible, false, 'A genuine missing-formula issue remains blocking even when another concern is explicitly non-blocking')
  assert.match(financial.reasons.join(';'), /未提供公式/)
})

test('reviewer text that explicitly says no error should clear its own false flags',()=>{
  const review={sectionChecks:output.sectionChecks.map(check=>check.sectionId==='industry-exposure'?{...check,questionAnswered:false,evidenceSupportsConclusion:false,numericReproducible:false,reasons:['市场空间数值及计算可以复核，材料总体有支持；无需判错。']}:check)}
  const industry=validateCompanySemanticQualityOutput(review).find(check=>check.sectionId==='industry-exposure')!
  assert.equal(industry.questionAnswered,true)
  assert.equal(industry.evidenceSupportsConclusion,true)
  assert.equal(industry.numericReproducible,true)
  assert.deepEqual(industry.reasons,[])
  const noBlocker=output.sectionChecks.map(check=>check.sectionId==='financial-quality'?{...check,questionAnswered:false,evidenceSupportsConclusion:false,numericReproducible:false,reasons:['所列数字与来源一致，开篇限制已写明；无法找到阻塞数据问题。']}:check)
  const financial=validateCompanySemanticQualityOutput({sectionChecks:noBlocker}).find(check=>check.sectionId==='financial-quality')!
  assert.equal(financial.questionAnswered,true)
  assert.equal(financial.evidenceSupportsConclusion,true)
  assert.equal(financial.numericReproducible,true)
  assert.deepEqual(financial.reasons,[])
})

test('R156 aligned-source and reconciled-calculation review clears contradictory false flags, while preserving a concrete counterdefect',()=>{
  const r156Reason='供应商合计与最大供应商比例、金额均对应官方年报paragraph:931-936及单位/字段，客户比例对应paragraph:918、922；引用一致。CCC列示11.65天与所给精确操作数计算值约11.6501天一致；报告明确限定为筛查指标。供应商和客户集中度均有据，金额/单位均可复核。未发现实质错误。'
  const contradictory={sectionChecks:output.sectionChecks.map(check=>check.sectionId==='supply-chain'?{...check,evidenceSupportsConclusion:false,numericReproducible:false,reasons:[r156Reason]}:check)}
  const supply=validateCompanySemanticQualityOutput(contradictory).find(check=>check.sectionId==='supply-chain')!
  assert.equal(supply.evidenceSupportsConclusion,true)
  assert.equal(supply.numericReproducible,true)
  assert.deepEqual(supply.reasons,[])

  const realCounterdefect={sectionChecks:output.sectionChecks.map(check=>check.sectionId==='supply-chain'?{...check,evidenceSupportsConclusion:false,numericReproducible:false,reasons:['来源金额和引用总体对应，计算结果可复核，未发现实质错误；但客户比例引用实际对应另一期间，口径不一致，可能误导风险判断。']}:check)}
  const retained=validateCompanySemanticQualityOutput(realCounterdefect).find(check=>check.sectionId==='supply-chain')!
  assert.equal(retained.evidenceSupportsConclusion,false,'a concrete period mismatch must remain blocking despite other aligned figures')
  assert.equal(retained.numericReproducible,false,'the independent numeric flag is not cleared when the reviewer also identifies a concrete period mismatch')
  assert.match(retained.reasons.join(';'),/期间.*不一致/)
})

test('R160 clears only explicit industry and financial self-contradictions and retains the M&A coverage failure',()=>{
  const industryReason1='表中“2025年全球AI服务器市场预测规模1,672亿美元”“2025年全球数据中心液冷市场预测规模28.4亿美元”错误改写了年报原文明确的2025年预测为“2025年”吗？原文实为2025年预测。年报标题年份不构成预测期问题，相关年份与数值一致，无此错误。实际阻塞：报告列汽车行业背景时明确写“2024年行业销量与公司销售额并非同一指标”，但随后的表格含AI市场预测且没有实际竞争证据问题？不构成错误。'
  const industryReason2='报告未说明行业规模预测的第三方来源？原文明列Market Insights、MarketsandMarkets，并注明年报转述，故不是缺口。实际可确认的阻塞缺陷未见。'
  const financialReason='正文称净利率由4.18%降至3.57%，按显示值差为-0.61个百分点，结构化准确比率差亦为-0.6031个百分点；方向和约数吻合，不应以此判错。实际数值错误：正文将应收同比余额增速与收入累计同比增速差写22.6758个百分点、库存差42.0271个百分点，原始操作数正确；但报告另列资产负债率70.96%对71.08%，代码计算变化-0.12个百分点吻合；未发现错误。问题在于CCC正文以显示值计算得11.65天，实际22.87+106.21-117.43=11.65吻合。未发现实质数值错误。'
  const mAndAReason='报告称本次材料未提供可核实的具体并购行动、价格或标的后续经营结果；但2024年年报paragraph:586明确说并表一项于2023年底完成收购的业务并拉动零部件规模扩大。影响：并购行动存在且对规模有方向性影响，不能笼统称无并购行动；不过未披露标的名称、对价和标的回报，故具体交易金额及回报确有缺口，限制并购资本配置评估。'
  const review={sectionChecks:output.sectionChecks.map(check=>{
    if(check.sectionId==='industry-exposure') return {...check,evidenceSupportsConclusion:false,numericReproducible:false,reasons:[industryReason1,industryReason2]}
    if(check.sectionId==='financial-quality') return {...check,numericReproducible:false,reasons:[financialReason]}
    if(check.sectionId==='management-capital-allocation') return {...check,evidenceSupportsConclusion:false,numericReproducible:false,reasons:[mAndAReason]}
    return check
  })}
  const checks=validateCompanySemanticQualityOutput(review)
  const industry=checks.find(check=>check.sectionId==='industry-exposure')!
  assert.equal(industry.evidenceSupportsConclusion,true)
  assert.equal(industry.numericReproducible,true)
  assert.deepEqual(industry.reasons,[])
  const financial=checks.find(check=>check.sectionId==='financial-quality')!
  assert.equal(financial.numericReproducible,true)
  assert.deepEqual(financial.reasons,[])
  const mAndA=checks.find(check=>check.sectionId==='management-capital-allocation')!
  assert.equal(mAndA.evidenceSupportsConclusion,false,'the annual-report evidence disproves the report\'s broad no-acquisition gap claim')
  assert.equal(mAndA.numericReproducible,false,'the actionable acquisition-coverage gap is not an explicit affirmation that the numeric review passed')
  assert.match(mAndA.reasons.join(';'),/不能笼统称无并购行动/)
})

test('R161 keeps the same-row driver omission unanswered without misclassifying aligned evidence or omitted calculations',()=>{
  const attempt2='“收入结构摘要”中披露汽车类收入648,645,636,000元，占80.68%，电子类155,236,528,000元，占19.31%，均有对应年报产品表引用；因此该节主要回答了收入利润驱动，且关键产品数据可复核。但段落把2026上半年合并收入3,448.15亿元下降7.1282%、营业利润147.44亿元下降21.2395%、净利润123.25亿元下降20.5352%作为结构化合并值，准确引用financial source paragraph:1，数值、期间及合并范围一致。这里未发现结构化财务引用错误。真正阻塞项是rubric要求同一分产品行已同时披露收入增速与成本增速时呈现方向和差额；本节只写电子产品毛利率变化-2.67%、汽车产品毛利率变化+1.98%，未说明同表电子收入+0.96%而成本+3.88%、汽车收入-8.98%而成本-11.24%及方向差，削弱对成本链路的实质回答。'
  const attempt3='“分行业 半年报分行业表中，交通运输设备及电气制造业收入为人民币275,341,358,000.00元，同比下降8.98%；日用电子器件制造业收入为人民币69,404,994,000.00元，同比增加0.96%”及其分产品复述，引用行与官方表一致。但本节把官方分产品表中的毛利率同比变化-2.67%、+1.98%当作成本链路分析，却遗漏同一分产品表明确列示的电子收入增0.96%、成本增3.88%，以及汽车收入降8.98%、成本降11.24%；因此未满足呈现收入/成本方向及差额的rubric要求，削弱关键驱动解释。报告未列上述增速差，不存在可核算的错误派生数值；其他合并财务数字可复核。'
  for(const reason of [attempt2,attempt3]){
    const review={sectionChecks:output.sectionChecks.map(check=>check.sectionId==='revenue-profit-drivers'?{...check,questionAnswered:false,evidenceSupportsConclusion:false,numericReproducible:false,reasons:[reason]}:check)}
    const drivers=validateCompanySemanticQualityOutput(review).find(check=>check.sectionId==='revenue-profit-drivers')!
    assert.equal(drivers.questionAnswered,false,'the omitted same-row revenue/cost analysis remains a substantive coverage failure')
    assert.equal(drivers.evidenceSupportsConclusion,true,'correctly cited rows remain evidence-supported despite incomplete analysis')
    assert.equal(drivers.numericReproducible,true,'omitted calculations are not erroneous derived values')
    assert.match(drivers.reasons.join(';'),/收入.{0,24}成本|方向和差额/,'preserve the specific missing-analysis blocker')
  }

  const wrongLocator='将交通运输设备及电气制造业称为收入下降8.98%属错期/范围错误：现有引用只显示电子分行业行，实际汽车行业对应段落702–703缺失，影响对分部收入变化的准确归因。'
  const broken={sectionChecks:output.sectionChecks.map(check=>check.sectionId==='revenue-profit-drivers'?{...check,questionAnswered:false,evidenceSupportsConclusion:false,numericReproducible:false,reasons:[wrongLocator]}:check)}
  const retained=validateCompanySemanticQualityOutput(broken).find(check=>check.sectionId==='revenue-profit-drivers')!
  assert.equal(retained.evidenceSupportsConclusion,false,'a wrong locator/scope claim remains a real evidence defect')
  assert.equal(retained.numericReproducible,false)
})

test('R162 clears only explicit no-error financial and allocation verdicts, reconciles cited competitor routes, and retains real defects',()=>{
  const financialReason='报告称“营业收入下降、营业利润下降、净利润下降”，又在另一处用“收入、利润和现金流方向并列”；方向结论有充分结构化证据且净利润已标注归属未明，不构成错引。阻塞错误在完整年度表中把2025-12-31营业利润写作401.85亿元、2024-12-31写504.86亿元，同比-20.40%，数字可复算；没有实质错误。周转天数计算均引用结构化来源paragraph:1并提供准确操作数、公式和181天，计算可复核；无阻塞错误。'
  const allocationReasons=[
    '资本配置表将结构化半年报的研发费用233.07亿元与公司半年报研发投入约289亿元明确区分；但研发费用同比-21.25%正确且标明为结构化口径，年度研发投入金额也单独列示，不构成科目混用。',
    '员工持股计划的实际参与人数21,417、持股22,501,479股与计划上限2.5万人分别列示，口径准确。资本配售美元与港元净募资分开呈列，未合并。',
  ]
  const junoReason='风险表称“2026年半年报披露Juno Newco商誉原值人民币千元4,361,657”，引文所示单位行人民币千元确实支持该金额；但正文又写减值准备人民币千元0并称“该标的减值准备表未列示金额”。报告摘录未提供Juno减值准备金额行，且paragraph:4823只是表标题，故0无来源支撑，影响商誉余额/减值描述准确性。'
  const candidateReason='竞争风险表称“材料没有同口径竞品业绩、产品路线或市场份额数据”，但同一报告的竞争章节及competitive_market_map已列宁德时代乘用车超快充路线与比亚迪闪充路线；报告后段虽又作候选交叉说明，前述句仍与已完成方法结果矛盾，影响风险矩阵的竞争证据边界。'
  const mixedPeriod='本节称“2024年年报”分产品/分地区/分行业收入毛利表，但引用段落属于2026年半年报；影响是期间标签与实际引用不符。'
  const segmentMix='本节将“分行业”表中日用电子器件制造业、交通运输设备及电气制造业的毛利率变化表述为产品类别表现；来源paragraph:731已转入分产品表，而paragraph:728/730为分行业行，该混淆影响分部利润驱动归因。'
  const review={sectionChecks:output.sectionChecks.map(check=>{
    if(check.sectionId==='financial-quality') return {...check,evidenceSupportsConclusion:false,reasons:[financialReason]}
    if(check.sectionId==='management-capital-allocation') return {...check,numericReproducible:false,reasons:allocationReasons}
    if(check.sectionId==='risks') return {...check,evidenceSupportsConclusion:false,numericReproducible:false,reasons:[junoReason,candidateReason]}
    if(check.sectionId==='revenue-profit-drivers') return {...check,evidenceSupportsConclusion:false,numericReproducible:false,reasons:[mixedPeriod,segmentMix]}
    return check
  })}
  const validated=validateCompanySemanticQualityOutput(review)
  const financial=validated.find(check=>check.sectionId==='financial-quality')!
  assert.equal(financial.evidenceSupportsConclusion,true,'explicitly sourced and recalculable statements with no material error are not blockers')
  const allocation=validated.find(check=>check.sectionId==='management-capital-allocation')!
  assert.equal(allocation.numericReproducible,true,'correctly distinguished figures and units are not numeric failures')

  const riskBody='# 风险\n竞争风险表称“材料没有同口径竞品业绩、产品路线或市场份额数据”。跨方法核实的具名候选为宁德时代：宁德时代将乘用车列为解决方案，动力电池技术方向包含超快充。[public-web-0c309ea1e077c959@paragraph:249] 比亚迪披露第二代刀片电池和闪充技术。[official-c19c34dd239b2e9c@paragraph:337] 同类产品和路线存在技术方向重叠。直接竞标、客户重叠及同口径性能、价格、成本或份额仍未验证。'
  const sections=COMPANY_CORE_SECTION_IDS.map(id=>({id,markdown:id==='risks'?riskBody:''}))
  const reconciled=reconcileKnownReviewerFalsePositives(validated,sections)
  const risks=reconciled.find(check=>check.sectionId==='risks')!
  assert.equal(risks.evidenceSupportsConclusion,false,'Juno zero without a cited value remains an evidence blocker')
  assert.equal(risks.numericReproducible,false,'the unsupported Juno zero must not be waived by the unrelated competitor wording')
  assert.equal(risks.reasons.length,1)
  assert.match(risks.reasons[0]!,/0无来源支撑/)
  assert.doesNotMatch(risks.reasons.join(';'),/competitive_market_map已列/)

  const revenue=validated.find(check=>check.sectionId==='revenue-profit-drivers')!
  assert.equal(revenue.evidenceSupportsConclusion,false,'real annual/interim period mismatch remains blocking')
  assert.equal(revenue.numericReproducible,false,'industry/product table misclassification remains blocking')
})


test('a pure numeric confirmation repairs its false flag without a redundant semantic retry', async () => {
  const contradictory={sectionChecks:output.sectionChecks.map(check=>check.sectionId==='financial-quality'?{...check,numericReproducible:false,reasons:['同比与资产负债比率均可复算；此处数字无实质错误。']}:check)}
  let calls=0
  const result=await reviewCompanyResearchSemantics({...input,reasoningExecutor:executor(async()=>{
    calls++
    return calls===1?contradictory:output
  })})
  assert.equal(result.passed,true)
  assert.equal(result.attempts,1)
  assert.equal(result.attemptOutputs?.length,1)
  const repaired = validateCompanySemanticQualityOutput(contradictory).find(check => check.sectionId === 'financial-quality')!
  assert.equal(repaired.numericReproducible,true)
  assert.deepEqual(repaired.reasons,[])
  const realError={sectionChecks:output.sectionChecks.map(check=>check.sectionId==='financial-quality'?{...check,numericReproducible:false,reasons:['未见计算错误，但引用原文没有该科目，无法确认范围和单位。']}:check)}
  assert.equal(validateCompanySemanticQualityOutput(realError).find(check=>check.sectionId==='financial-quality')!.numericReproducible,false,'a concrete remaining evidence problem is not automatically waived')
})

test('BYD reviewer self-corrections clear only the numeric false flag and retain separate defects', () => {
  const selfCorrected = [
    {
      sectionId: 'revenue-profit-drivers',
      reason: '年度收入同比使用的结构化年度数与官方数据吻合，金额、期间、公式可复核，未见错。',
    },
    {
      sectionId: 'financial-quality',
      reason: '“CCC＝DSO 22.87天＋DIO 106.21天−DPO 117.43天＝11.65天”计算错误：依正文列示的已四舍五入操作数应为11.65天？22.87+106.21−117.43=11.65，公式吻合，故无数字错误。',
    },
    {
      sectionId: 'monitoring-checklist',
      reason: '分产品收入与毛利率监控行并列收入表与毛利率指标；报告另引毛利率表，且数值与列头可核，故不存在实质错接。',
    },
  ] as const
  for (const item of selfCorrected) {
    const candidate = { sectionChecks: output.sectionChecks.map(check => check.sectionId === item.sectionId
      ? { ...check, numericReproducible: false, reasons: [item.reason] }
      : check) }
    const normalized = validateCompanySemanticQualityOutput(candidate).find(check => check.sectionId === item.sectionId)!
    assert.equal(normalized.numericReproducible, true, `${item.sectionId}: explicit correction should reconcile the numeric flag`)
    assert.deepEqual(normalized.reasons, [], `${item.sectionId}: all flags pass, so no contradictory-only reason remains`)
  }

  const actualUnitError = { sectionChecks: output.sectionChecks.map(check => check.sectionId === 'financial-quality'
    ? { ...check, numericReproducible: false, reasons: ['CCC公式吻合，但单位错误：报告把天写成月，影响周期解释。'] }
    : check) }
  assert.equal(validateCompanySemanticQualityOutput(actualUnitError).find(check => check.sectionId === 'financial-quality')!.numericReproducible, false,
    'a concrete unit mismatch must remain blocking despite a correct formula')

  const separateMissingOperands = { sectionChecks: output.sectionChecks.map(check => check.sectionId === 'financial-quality'
    ? { ...check, numericReproducible: false, reasons: ['公式结果正确；另有一项派生比率未列两期操作数，无法复算。'] }
    : check) }
  assert.equal(validateCompanySemanticQualityOutput(separateMissingOperands).find(check => check.sectionId === 'financial-quality')!.numericReproducible, false,
    'a separate missing-operands defect must not be erased by an unrelated correct figure')

  const unanswered = { sectionChecks: output.sectionChecks.map(check => check.sectionId === 'financial-quality'
    ? { ...check, questionAnswered: false, numericReproducible: false, reasons: [selfCorrected[1].reason] }
    : check) }
  const retained = validateCompanySemanticQualityOutput(unanswered).find(check => check.sectionId === 'financial-quality')!
  assert.equal(retained.numericReproducible, true)
  assert.equal(retained.questionAnswered, false)
  assert.equal(retained.reasons.length, 1, 'numeric reconciliation must not clear a separate unanswered-section flag')
})

test('a reproducible balance calculation does not become a numeric failure when the defect is period-scope wording', () => {
  const reason = '本节称资产负债表余额变化均只能称较上年末，但又报告结构化历史序列2025-06-30至2026-06-30余额同比及公式；这与其所谓均只能较上年末相矛盾，影响是掩盖独立结构化同日同比序列的有效比较基期。另简化自由现金流＝373.35−447.03＝−73.68亿元与同节结构化值及preparedAnalysis相符，本身可复算，不作为反对理由。'
  const outputWithScopeDefect = { sectionChecks: output.sectionChecks.map(check => check.sectionId === 'financial-quality'
    ? { ...check, evidenceSupportsConclusion: false, numericReproducible: false, reasons: [reason] }
    : check) }
  const checked = validateCompanySemanticQualityOutput(outputWithScopeDefect).find(check => check.sectionId === 'financial-quality')!
  assert.equal(checked.evidenceSupportsConclusion, false, 'the period-scope contradiction remains a real evidence blocker')
  assert.equal(checked.numericReproducible, true, 'the explicitly reproducible formula is not a numeric defect')
  assert.deepEqual(checked.reasons, [reason], 'the real evidence reason remains attached')
  const withFormulaError = { sectionChecks: output.sectionChecks.map(check => check.sectionId === 'financial-quality'
    ? { ...check, evidenceSupportsConclusion: false, numericReproducible: false, reasons: [`${reason}另有一项公式计算错误，实际应为-73.69亿元。`] }
    : check) }
  assert.equal(validateCompanySemanticQualityOutput(withFormulaError).find(check => check.sectionId === 'financial-quality')!.numericReproducible, false,
    'an explicit additional formula error stays blocking despite a separate correct formula')
})

test('R78 reviewer text that concludes a section should pass is retried instead of accepted as a failed verdict',()=>{
  const contradictory={sectionChecks:output.sectionChecks.map(check=>check.sectionId==='financial-quality'?{...check,questionAnswered:false,evidenceSupportsConclusion:false,numericReproducible:false,reasons:['表中DSO公式可复算且结果正确；其余指标也正确。故没有明确的关键数字错误，主要问题均已回答，按规则应通过而非设false。']}:check)}
  assert.throws(()=>validateCompanySemanticQualityOutput(contradictory),/Contradictory verdict/)
})

test('self-contradictory financial verdict saying flags should pass is rejected for bounded reviewer repair', () => {
  const contradictory = { sectionChecks: output.sectionChecks.map(check => check.sectionId === 'financial-quality'
    ? { ...check, evidenceSupportsConclusion: false, numericReproducible: false, reasons: ['已给数据及净利率计算均准确；现无可举证的关键错误，旗标应通过。'] }
    : check) }
  assert.throws(() => validateCompanySemanticQualityOutput(contradictory), /Contradictory verdict/)
})

test('review reconciliation checks split-table headers and one-based cited source rows before clearing proven false positives', () => {
  const annualLines = Array.from({ length: 896 }, () => '常规披露')
  annualLines[884] = '单位：元'
  annualLines[885] = '营业收入 营业成本 毛利率 营业收入比上'
  annualLines[886] = '同期增减'
  annualLines[887] = '营业成本比上'
  annualLines[888] = '同期增减'
  annualLines[889] = '毛利率比上'
  annualLines[890] = '同期增减'
  annualLines[894] = '分产品'
  annualLines[895] = '电子电路产品 25,620,292,915.99 21,113,572,455.81 17.59% 3.30% 4.25% -0.75%'
  const interimLines = Array.from({ length: 775 }, () => '常规披露')
  interimLines[763] = '营业收入构成'
  interimLines[764] = '单位：元'
  interimLines[765] = '本报告期 上年同期'
  interimLines[766] = '同比增减'
  interimLines[767] = '金额 占营业收入比重 金额 占营业收入比重'
  interimLines[772] = '分产品'
  interimLines[774] = '精密组件产品 6,580,692,901.95 23.67% 2,361,835,859.44 13.93% 178.63%'
  const annual = { ...source, candidate: { ...source.candidate, candidateId: 'annual-exact' }, title: '2025年年度报告', content: annualLines.join('\n') }
  const interim = { ...source, candidate: { ...source.candidate, candidateId: 'interim-exact' }, title: '2026年半年度报告', content: interimLines.join('\n') }
  const productRefs = [885, 886, 887, 888, 889, 890, 891, 895, 896].map(row => `[annual-exact@paragraph:${row}]`).join(' ')
  const growthRefs = [764, 765, 766, 767, 768, 773, 775].map(row => `[interim-exact@paragraph:${row}]`).join(' ')
  const reportSections = [...sections]
    .map(section => section.id === 'products' ? { ...section, markdown: `电子电路产品收入25,620,292,915.99元、产品毛利率17.59%。${productRefs}` }
      : section.id === 'growth-drivers' ? { ...section, markdown: `精密组件收入同比大幅增长。${growthRefs}` } : section)
  const falseChecks = output.sectionChecks.map(check => check.sectionId === 'products'
    ? { ...check, numericReproducible: false, reasons: ['表头和精确行缺失；17.59%系产品毛利率，非合并值。'] }
    : check.sectionId === 'growth-drivers'
      ? { ...check, evidenceSupportsConclusion: false, numericReproducible: false, reasons: ['paragraph:775仅为金额/占比行，不含同比增速；另见paragraph:798。'] }
      : check)
  const result = reconcileKnownReviewerFalsePositives(falseChecks, reportSections, [annual, interim])
  assert.equal(result.find(check => check.sectionId === 'products')!.numericReproducible, true)
  assert.deepEqual(result.find(check => check.sectionId === 'products')!.reasons, [])
  assert.equal(result.find(check => check.sectionId === 'growth-drivers')!.evidenceSupportsConclusion, true)
  assert.equal(result.find(check => check.sectionId === 'growth-drivers')!.numericReproducible, true)
  assert.deepEqual(result.find(check => check.sectionId === 'growth-drivers')!.reasons, [])
})

test('industry review does not confuse an annual-report publication year with its explicitly cited forecast horizon',()=>{
  const lines=Array.from({length:576},()=>'常规披露')
  lines[573]='根据Lightcounting预测，全球数通光模块市场规模。'
  lines[574]='光模块市场规模2026年将达到228亿美元，其中，2026年800G与1.6T光模块合计市场规模有望达146亿美元，占当年数通光模块市场总规模的约64%。'
  lines[575]='数通光模块市场总规模的约64%。与此同时，全球电信光模块市场2026年预计为53亿美元。'
  const annual={...source,candidate:{...source.candidate,candidateId:'annual-market'},title:'2025年年度报告',content:lines.join('\n')}
  const body='全球数通光模块2026年预计228亿美元，其中800G与1.6T合计146亿美元，约占当年市场64%。[annual-market@paragraph:574] [annual-market@paragraph:575] [annual-market@paragraph:576]'
  const reason='报告称数通光模块2026年预计228亿美元、800G与1.6T合计146亿美元，但引用的2025年年报实际将这些数据表述为2025年市场规模；将预测期标为2026年会影响行业增长判断。'
  const falseCheck={...output.sectionChecks.find(check=>check.sectionId==='industry-exposure')!,evidenceSupportsConclusion:false,numericReproducible:false,reasons:[reason]}
  const reconciled=reconcileKnownReviewerFalsePositives(output.sectionChecks.map(check=>check.sectionId==='industry-exposure'?falseCheck:check),[...sections].map(section=>section.id==='industry-exposure'?{...section,markdown:body}:section),[annual])
  const industry=reconciled.find(check=>check.sectionId==='industry-exposure')!
  assert.equal(industry.evidenceSupportsConclusion,true)
  assert.equal(industry.numericReproducible,true)
  assert.deepEqual(industry.reasons,[])
  assert.match(reason,/2025年年报/)
})

test('review reconciliation rejects the false p799 optical growth claim from the actual split-table source row', () => {
  const lines = Array.from({length:799},()=> '常规披露')
  lines[775] = '光模块 5,350,999,299.05 19.25%'
  lines[783] = '单位：元'
  lines[784] = '营业收入 营业成本 毛利率'
  lines[785] = '营业收入比上'
  lines[786] = '年同期增减'
  lines[787] = '营业成本比上'
  lines[788] = '年同期增减'
  lines[789] = '毛利率比上'
  lines[790] = '年同期增减'
  lines[798] = '光模块 5,350,999,299.05 3,246,496,191.23 39.33%'
  const filing = {...source,candidate:{...source.candidate,candidateId:'interim-optical'},title:'2026年半年度报告',content:lines.join('\n')}
  const refs=[776,...Array.from({length:8},(_,i)=>784+i)].map(row=>`[interim-optical@paragraph:${row}]`).join(' ')
  const report=[...sections].map(section=>section.id==='revenue-profit-drivers'?{...section,markdown:`光模块本报告期收入5,350,999,299.05元，但本节引用的分产品收入行没有上年同期比较值，不能据此计算同比。[interim-optical@paragraph:776] ${refs}`} : section)
  const falseReason='本节称光模块上年同期比较值未提供，但2026年半年报 paragraph:799 明列本期收入5,350,999,299.05元、上年同期收入3,879,680,?元及同比增减37.96%；故“不能据此计算同比”是虚假缺口。'
  const check={...output.sectionChecks.find(item=>item.sectionId==='revenue-profit-drivers')!,questionAnswered:false,evidenceSupportsConclusion:false,reasons:[falseReason]}
  const resolved=reconcileKnownReviewerFalsePositives(output.sectionChecks.map(item=>item.sectionId==='revenue-profit-drivers'?check:item),report,[filing])
  assert.equal(resolved.find(item=>item.sectionId==='revenue-profit-drivers')!.questionAnswered,true)
  assert.equal(resolved.find(item=>item.sectionId==='revenue-profit-drivers')!.evidenceSupportsConclusion,true)
  assert.deepEqual(resolved.find(item=>item.sectionId==='revenue-profit-drivers')!.reasons,[])
  const stillBlocked=reconcileKnownReviewerFalsePositives(output.sectionChecks.map(item=>item.sectionId==='revenue-profit-drivers'?{...check,reasons:[falseReason,'同年度精密组件的已披露成本增速和收入增速未给出公式与方向。']}:item),report,[filing])
  assert.equal(stillBlocked.find(item=>item.sectionId==='revenue-profit-drivers')!.questionAnswered,false)
  assert.deepEqual(stillBlocked.find(item=>item.sectionId==='revenue-profit-drivers')!.reasons,['同年度精密组件的已披露成本增速和收入增速未给出公式与方向。'])
  const mixed=reconcileKnownReviewerFalsePositives(output.sectionChecks.map(item=>item.sectionId==='revenue-profit-drivers'?{...check,reasons:[`${falseReason}；此外精密组件年度成本增速与收入增速差值缺少公式。`]}:item),report,[filing])
  assert.equal(mixed.find(item=>item.sectionId==='revenue-profit-drivers')!.questionAnswered,false)
  assert.match(mixed.find(item=>item.sectionId==='revenue-profit-drivers')!.reasons[0]!,/此外精密组件年度成本增速/)
})

test('review reconciliation does not misread the optical cost column as prior-period revenue for p776', () => {
  const lines = Array.from({length:800},()=> '常规披露')
  lines[775] = '光模块 5,350,999,299.05 19.25%'
  lines[798] = '光模块 5,350,999,299.05 3,246,496,191.23 39.33%'
  const filing = {...source,candidate:{...source.candidate,candidateId:'interim-optical'},title:'2026年半年度报告',content:lines.join('\n')}
  const report=[...sections].map(section=>section.id==='revenue-profit-drivers'?{...section,markdown:'光模块本期收入5,350,999,299.05元；产品收入构成表p776仅列本期金额及占比，没有上年同期值，故不能据此计算同比。[interim-optical@paragraph:776]'}:section)
  const checks=output.sectionChecks.map(check=>check.sectionId==='revenue-profit-drivers'?{...check,questionAnswered:false,evidenceSupportsConclusion:false,numericReproducible:false,reasons:['paragraph:776列出光模块本期收入5,350,999,299.05元、上年同期收入3,246,496,191.23元、占比13.26%及同比64.82%，报告遗漏了同比贡献。']}:check)
  const resolved=reconcileKnownReviewerFalsePositives(checks,report,[filing])
  const driver=resolved.find(item=>item.sectionId==='revenue-profit-drivers')!
  assert.equal(driver.questionAnswered,true)
  assert.equal(driver.evidenceSupportsConclusion,true)
  assert.equal(driver.numericReproducible,true)
  assert.deepEqual(driver.reasons,[])
})

test('review reconciliation preserves the accurate optical prior-period gap when the cited composition row has no comparison columns', () => {
  const lines=Array.from({length:776},()=>'常规披露')
  lines[775]='光模块 5,350,999,299.05 19.25%'
  const filing={...source,candidate:{...source.candidate,candidateId:'interim-current-only'},title:'2026年半年度报告',content:lines.join('\n')}
  const report=[...sections].map(section=>section.id==='growth-drivers'?{...section,markdown:'光模块本期收入为53.51亿元，但材料未提供该行上年同期值及同比变化。[interim-current-only@paragraph:776]'}:section)
  const reason='称“光模块本期收入为53.51亿元，材料未提供该行上年同期值及同比变化”，但来源分产品行776明确列示本期5,350,999,299.05元、占比19.25%；且该源行确未列上年同期值，金额本身无误。缺口陈述准确，未发现虚假缺口。'
  const result=reconcileKnownReviewerFalsePositives(output.sectionChecks.map(check=>check.sectionId==='growth-drivers'?{...check,evidenceSupportsConclusion:false,reasons:[reason]}:check),report,[filing])
  assert.equal(result.find(check=>check.sectionId==='growth-drivers')!.evidenceSupportsConclusion,true)
  assert.deepEqual(result.find(check=>check.sectionId==='growth-drivers')!.reasons,[])
})

test('review reconciliation does not confuse the optical cost and margin row with prior-period revenue growth',()=>{
  const lines=Array.from({length:799},()=>'常规披露')
  lines[775]='光模块 5,350,999,299.05 19.25%'
  lines[783]='单位：元'; lines[784]='营业收入 营业成本 毛利率'; lines[785]='营业收入比上'; lines[786]='年同期增减'; lines[787]='营业成本比上'; lines[788]='年同期增减'; lines[789]='毛利率比上'; lines[790]='年同期增减'
  lines[798]='光模块 5,350,999,299.05 3,246,496,191.23 39.33%'
  const filing={...source,candidate:{...source.candidate,candidateId:'interim-optical'},title:'2026年半年度报告',content:lines.join('\n')}
  const headerRefs=[776,...Array.from({length:8},(_,i)=>784+i)].map(paragraph=>`[interim-optical@paragraph:${paragraph}]`).join(' ')
  for(const sectionId of ['growth-drivers','monitoring-checklist']){
    const report=sections.map(section=>section.id===sectionId?{...section,markdown:`光模块本期收入5,350,999,299.05元，但该分产品收入行未列上年同期值，不能据此计算同比。[interim-optical@paragraph:776] ${headerRefs}`}:section)
    const reason='报告称同比未提供与2026年半年报paragraph:799相反；该行显示上年同期收入3,246,496,191.23元及同比增长39.33%，影响AI光模块增长证据判断。'
    const checks=output.sectionChecks.map(check=>check.sectionId===sectionId?{...check,questionAnswered:false,evidenceSupportsConclusion:false,numericReproducible:false,reasons:[reason]}:check)
    const result=reconcileKnownReviewerFalsePositives(checks,report,[filing]).find(check=>check.sectionId===sectionId)!
    assert.equal(result.questionAnswered,true)
    assert.equal(result.evidenceSupportsConclusion,true)
    assert.equal(result.numericReproducible,true)
    assert.deepEqual(result.reasons,[])
  }
})

test('R61-style growth review contradiction repairs the format while preserving an independently stated numeric-coverage defect',async()=>{
  const contradictory={sectionChecks:output.sectionChecks.map(check=>check.sectionId==='growth-drivers'?{...check,questionAnswered:false,evidenceSupportsConclusion:false,numericReproducible:false,reasons:['章节给出的产品和地区变动方向与官方半年度收入构成行一致，产量/销量也明确限定为年度数据；但报告未给出增长驱动的可复核量化贡献，仍保留全部合并收入变动残差。该限制已被明确说明，故不应以此判章节未回答或数字不可复算。']}:check)}
  const corrected={sectionChecks:output.sectionChecks.map(check=>check.sectionId==='growth-drivers'?{...check,questionAnswered:true,evidenceSupportsConclusion:false,numericReproducible:true,reasons:['正文未列出已引用官方分产品及分地区表中的具体同比幅度，无法判断变化幅度对本节增长条件判断的影响；应补列这些披露值，并继续说明它们不能组成产品与地区交叉贡献。']}:check)}
  let calls=0
  const result=await reviewCompanyResearchSemantics({...input,reasoningExecutor:executor(async request=>{
    calls++
    if(calls===2){assert.match(request.input.repairErrors[0].message,/corresponding flag true/i);assert.deepEqual(request.input.repairPreviousOutput,contradictory)}
    return calls===1?contradictory:corrected
  })})
  assert.equal(result.status,'failed')
  assert.equal(result.attempts,2)
  assert.deepEqual(result.issues.filter(issue=>issue.startsWith('growth-drivers:')),['growth-drivers:evidenceSupportsConclusion:正文未列出已引用官方分产品及分地区表中的具体同比幅度，无法判断变化幅度对本节增长条件判断的影响；应补列这些披露值，并继续说明它们不能组成产品与地区交叉贡献。'],JSON.stringify(result))
  assert.equal(result.sectionChecks.length,19,'a review-format defect must not erase all substantive section results')
})

test('reviewer verdicts that contradict their own section rationale are repaired while concrete report defects remain blocking', async () => {
  const contradictoryReasons = [
    { sectionId: 'business-segments', key: 'numericReproducible', reason: '表内收入占比从12.35%到14.78%，提高属于正确推断，不应判数字错误。' },
    { sectionId: 'financial-quality', key: 'questionAnswered', reason: '年度利润对比存在口径错误；实际差额为-14.24%。财务质量实质问题已充分回答。' },
    { sectionId: 'management-capital-allocation', key: 'evidenceSupportsConclusion', reason: '实际控制人履历和激励规模均有官方来源，正文也已分析，不存在虚假资料缺失。' },
    { sectionId: 'risks', key: 'evidenceSupportsConclusion', reason: '外销占比期间正确，商誉表未见错列；风险触发、影响、监控及缓解均有覆盖。' },
    { sectionId: 'financial-quality', key: 'numericReproducible', reason: '公式结果0.89%本身正确；作者已明确说明口径限制，不能据此判错。' },
    { sectionId: 'products', key: 'evidenceSupportsConclusion', reason: '数据与收入表和毛利表金额一致，引用范围虽可改善，但不能据此认定关键论点错误。' },
    { sectionId: 'company-overview', key: 'evidenceSupportsConclusion', reason: '竞争章节已经提供具名候选，因此不能说没有具名竞品；该缺口不支持此项false。' },
    { sectionId: 'financial-quality', key: 'evidenceSupportsConclusion', reason: '计算无误且结构化财务期间相符；该项限制为资料边界，不构成缺口错误。' },
    { sectionId: 'management-capital-allocation', key: 'evidenceSupportsConclusion', reason: '前十大持股列表完整度属于事实限制，正文已分析控制人资料，不构成缺口错误。' },
    { sectionId: 'risks', key: 'riskTransmission', reason: '风险矩阵给出触发、影响、监控及缓解，且没有足以判风险传导不完整的具体缺陷。' },
    { sectionId: 'management-capital-allocation', key: 'evidenceSupportsConclusion', reason: '表述虽可补充研发投入金额，但不是rubric要求，且正文已列明研发数据；没有阻塞问题。' },
    { sectionId: 'risks', key: 'riskTransmission', reason: '风险传导矩阵已列公司特定触发、影响、监控与缓解；不能把已满足的条件判为失败。' },
    { sectionId: 'financial-quality', key: 'evidenceSupportsConclusion', reason: '正文已给出差额公式，主要结论已充分回答，本项不应因公式补充判整节不通过。' },
    { sectionId: 'management-capital-allocation', key: 'evidenceSupportsConclusion', reason: '报告未说明研发比重变化原因属准确陈述，不构成虚假缺口。' },
    { sectionId: 'financial-quality', key: 'evidenceSupportsConclusion', reason: '分行业口径标注正确，负债率同比可复算；需拒绝false判定。' },
    { sectionId: 'risks', key: 'evidenceSupportsConclusion', reason: '客户匿名是准确描述，身份缺口不应判为证据不支持；已披露集中度比例与官方表一致，不能据此判false。' },
    { sectionId: 'growth-drivers', key: 'evidenceSupportsConclusion', reason: '公司解释已明确标注，未将库存视为销量；拒绝false判定。' },
    { sectionId: 'management-capital-allocation', key: 'numericReproducible', reason: '原表金额与单位行一致，false理由不能成立。' },
    { sectionId: 'investment-thesis', key: 'numericReproducible', reason: '金额本身可核验，不可复核旗标应为true。' },
    { sectionId: 'management-capital-allocation', key: 'evidenceSupportsConclusion', reason: '原表与报告说法相符；现有证据不足以支持此节为false，故该旗标判断应通过。' },
    { sectionId: 'business-segments', key: 'numericReproducible', reason: '报告所列收入数值均有依据；此处无实质数字错误，故不构成不可复算理由。' },
    { sectionId: 'revenue-profit-drivers', key: 'evidenceSupportsConclusion', reason: '收入与成本增速方向和原表一致，关键链路没有错误，故此理由不支持判false。' },
    { sectionId: 'management-capital-allocation', key: 'evidenceSupportsConclusion', reason: '原文明确支持该事项，报告也说明金额未分列；该表述有依据，不构成反证。' },
  ] as const
  for (const { sectionId, key, reason } of contradictoryReasons) {
    const bad = output.sectionChecks.map(check => check.sectionId === sectionId ? { ...check, [key]: false, reasons: [reason] } : check)
    assert.throws(() => validateCompanySemanticQualityOutput({ sectionChecks: bad }), /Contradictory/)
  }
  const actualIndustryUnitError = output.sectionChecks.map(check => check.sectionId === 'industry-exposure' ? { ...check, numericReproducible: false, reasons: ['毛利率同比变动“-0.75%”应为“-0.75个百分点”，单位表达错误。'] } : check)
  assert.equal(validateCompanySemanticQualityOutput({ sectionChecks: actualIndustryUnitError }).find(check => check.sectionId === 'industry-exposure')!.numericReproducible, false)
  const actualAcquisitionConflict = output.sectionChecks.map(check => check.sectionId === 'competition' ? { ...check, evidenceSupportsConclusion: false, reasons: ['媒体报道的收购比例与官方年报披露不一致，需以年报为准并披露冲突。'] } : check)
  assert.equal(validateCompanySemanticQualityOutput({ sectionChecks: actualAcquisitionConflict }).find(check => check.sectionId === 'competition')!.evidenceSupportsConclusion, false)
})

test('reviewer explicitly saying a scoped gap is accurate and should not be judged wrong clears only that false flag', () => {
  const review = { sectionChecks: output.sectionChecks.map(check => check.sectionId === 'industry-exposure'
    ? { ...check, evidenceSupportsConclusion: false, reasons: ['本节“现有材料没有具名PCB竞争者”仅限定PCB，与其他行业的候选对手并不冲突；“没有具名竞争者的同口径份额数据”准确描述缺少可比资料，故不据此判错。'] }
    : check) }
  const checks = validateCompanySemanticQualityOutput(review)
  const industry = checks.find(check => check.sectionId === 'industry-exposure')!
  assert.equal(industry.evidenceSupportsConclusion, true)
  assert.deepEqual(industry.reasons, [])
})

test('reviewer may identify a concrete broad-gap defect while confirming a separate specific gap is accurate', () => {
  const review = { sectionChecks: output.sectionChecks.map(check => check.sectionId === 'management-capital-allocation'
    ? {
        ...check,
        evidenceSupportsConclusion: false,
        reasons: ['公司已披露商誉减值测试和员工持股计划执行结果，但报告仍称资本配置/持股执行结果资料未提供，缺口范围过宽，影响对配置目的与结果的评价；刘学亮个人履历和职责未见对应证据，不构成虚假缺口。'],
      }
    : check) }
  const management = validateCompanySemanticQualityOutput(review).find(check => check.sectionId === 'management-capital-allocation')!
  assert.equal(management.evidenceSupportsConclusion, false)
  assert.match(management.reasons.join(' '), /缺口范围过宽/)
})

test('a generally positive phrase cannot auto-clear a concrete missing company catalyst', () => {
  const review = { sectionChecks: output.sectionChecks.map(check => check.sectionId === 'catalysts'
    ? { ...check, evidenceSupportsConclusion: false, reasons: ['总体讨论已充分，但未提供公司产品商业化阶段和下一步可观察条件。'] }
    : check) }
  const catalyst = validateCompanySemanticQualityOutput(review).find(check => check.sectionId === 'catalysts')!
  assert.equal(catalyst.evidenceSupportsConclusion, false)
  assert.match(catalyst.reasons[0]!, /未提供公司产品商业化阶段/)
})

test('semantic review reconciliation requires direct report wording for known R&D and employee-plan false positives', () => {
  const checks = output.sectionChecks.map(check => check.sectionId === 'management-capital-allocation'
    ? { ...check, questionAnswered: false, evidenceSupportsConclusion: false, numericReproducible: false, reasons: [
      '正文“变化0.92个百分点”不符合年报变动比例为0.92%的显示单位。',
      '计划涉及不超过2.5万名员工并累计买入10,714,990股，可能混淆实际参与规模。',
    ] }
    : check)
  const report = sections.map(section => section.id === 'management-capital-allocation'
    ? { ...section, markdown: '2025年员工人数上限为2.5万人，实际参与人数未披露；计划累计买入10,714,990股。原表变动比例为0.92%仅照录原表披露列值，不改称百分点。' }
    : section)
  const reconciled = reconcileKnownReviewerFalsePositives(checks, report)
  const management = reconciled.find(check => check.sectionId === 'management-capital-allocation')!
  assert.equal(management.questionAnswered, true)
  assert.equal(management.evidenceSupportsConclusion, true)
  assert.equal(management.numericReproducible, true)
  assert.deepEqual(management.reasons, [])
})

test('semantic review reconciliation removes only customer-ratio claims contradicted by the risk matrix', () => {
  const checks = output.sectionChecks.map(check => check.sectionId === 'risks'
    ? { ...check, questionAnswered: false, evidenceSupportsConclusion: false, reasons: ['风险矩阵“客户名称匿名”本身正确，但缺口被表述为最大客户12.53%、第二大2.05%后未说明已披露具体销售比例仍可核验；更关键的是竞争与政策证据仍不足。'] }
    : check)
  const report = sections.map(section => section.id === 'risks'
    ? { ...section, markdown: '若最大客户缩减采购，收入及产能利用可能受影响。最大客户占12.53%，第二大客户占2.05%；客户姓名匿名。' }
    : section)
  const reconciled = reconcileKnownReviewerFalsePositives(checks, report)
  const risks = reconciled.find(check => check.sectionId === 'risks')!
  assert.equal(risks.evidenceSupportsConclusion, false)
  assert.match(risks.reasons[0]!, /更关键的是竞争与政策证据仍不足/)
})

test('reviewer year-label objection clears only when every annual industry row matches its cited report year', () => {
  const annual2024 = { candidate: { candidateId: 'annual24' }, title: '2024年年度报告', content: '日用电子器件制造业 159,608,576,000.00\n交通运输设备及电气制造业 617,381,935,000.00' } as NormalizedResearchSource
  const annual2025 = { candidate: { candidateId: 'annual25' }, title: '2025年年度报告', content: '日用电子器件制造业 155,236,528,000.00\n交通运输设备及电气制造业 648,645,636,000.00' } as NormalizedResearchSource
  const body = `| 报告期间 | 分行业分类 | 营业收入 |
|---|---|---:|
| 2024年度 | 日用电子器件制造业 | 159,608,576,000.00 [annual24@paragraph:1] |
| 2024年度 | 交通运输设备及电气制造业 | 617,381,935,000.00 [annual24@paragraph:2] |
| 2025年度 | 日用电子器件制造业 | 155,236,528,000.00 [annual25@paragraph:1] |
| 2025年度 | 交通运输设备及电气制造业 | 648,645,636,000.00 [annual25@paragraph:2] |`
  const reason = '表中2024年度分行业行取自2024年报，却标为2025年度；年份错列使年度趋势失真。'
  const checks = output.sectionChecks.map(check => check.sectionId === 'industry-exposure' ? { ...check, numericReproducible: false, reasons: [reason] } : check)
  const report = sections.map(section => section.id === 'industry-exposure' ? { ...section, markdown: body } : section)
  const fixed = reconcileKnownReviewerFalsePositives(validateCompanySemanticQualityOutput({ sectionChecks: checks }), report, [annual2024, annual2025]).find(check => check.sectionId === 'industry-exposure')!
  assert.equal(fixed.numericReproducible, true)
  assert.deepEqual(fixed.reasons, [])
  const mislabeled = reconcileKnownReviewerFalsePositives(validateCompanySemanticQualityOutput({ sectionChecks: checks }), report.map(section => section.id === 'industry-exposure' ? { ...section, markdown: body.replace('| 2024年度 | 日用电子器件制造业', '| 2025年度 | 日用电子器件制造业') } : section), [annual2024, annual2025]).find(check => check.sectionId === 'industry-exposure')!
  assert.equal(mislabeled.numericReproducible, false)
  assert.match(mislabeled.reasons.join(' '), /年份错列/)
})

test('reviewer industry/product-label objection clears only when distinct cited source rows match each classification', () => {
  const sourceLines = Array.from({ length: 734 }, () => '')
  sourceLines[698] = '分行业'
  sourceLines[699] = '日用电子器件制'
  sourceLines[700] = '造业 69,404,994,000.00'
  sourceLines[701] = '交通运输设备及'
  sourceLines[702] = '电气制造业 275,341,358,000.00'
  sourceLines[704] = '分产品'
  sourceLines[705] = '电子及其他产品 69,404,994,000.00'
  sourceLines[706] = '汽车、汽车相关'
  sourceLines[707] = '产品及其他产品 275,341,358,000.00'
  const interim = { candidate: { candidateId: 'interim26' }, title: '2026年半年度报告', content: sourceLines.join('\n') } as NormalizedResearchSource
  const body = '2026年半年度报告的营业收入构成表以本报告期为期间。分行业表中，“日用电子器件制造业”收入为69,404,994,000.00元、同比0.96%；“交通运输设备及电气制造业”收入为275,341,358,000.00元、同比-8.98%。相应表头、单位及行分别见原报告定位。[interim26@paragraph:701] [interim26@paragraph:703] 分产品表另列“电子及其他产品”收入69,404,994,000.00元、同比0.96%；“汽车、汽车相关产品及其他产品”收入275,341,358,000.00元、同比-8.98%。[interim26@paragraph:706] [interim26@paragraph:708]'
  const reason = '半年表分别按分行业及分产品披露收入，但本节对电子产品将行业标签与产品标签相互套用；相同数字使结论归属不可靠。'
  const checks = output.sectionChecks.map(check => check.sectionId === 'revenue-profit-drivers' ? { ...check, numericReproducible: false, reasons: [reason] } : check)
  const report = sections.map(section => section.id === 'revenue-profit-drivers' ? { ...section, markdown: body } : section)
  const fixed = reconcileKnownReviewerFalsePositives(validateCompanySemanticQualityOutput({ sectionChecks: checks }), report, [interim]).find(check => check.sectionId === 'revenue-profit-drivers')!
  assert.equal(fixed.numericReproducible, true)
  assert.deepEqual(fixed.reasons, [])
  const wrong = body.replace('分行业表中，“日用电子器件制造业”', '分行业表中，“电子及其他产品”')
  const remainsBlocked = reconcileKnownReviewerFalsePositives(validateCompanySemanticQualityOutput({ sectionChecks: checks }), report.map(section => section.id === 'revenue-profit-drivers' ? { ...section, markdown: wrong } : section), [interim]).find(check => check.sectionId === 'revenue-profit-drivers')!
  assert.equal(remainsBlocked.numericReproducible, false)
  assert.match(remainsBlocked.reasons.join(' '), /行业标签与产品标签相互套用/)
})

test('R186 cited period-aligned industry, employee-plan, and goodwill facts clear only explicit reviewer self-contradictions',()=>{
  const annualLines=Array.from({length:7672},()=> '')
  annualLines[557]='2025 年全球服务器及存储领域的市场规模为 4130 亿美元，同比大幅增长 42%；预计'
  annualLines[558]='2026 至 2030 年复合增长率为 6%，2030 年市场规模将达 6300 亿美元。'
  annualLines[2710]='公司报告期无股权激励计划、员工持股计划或其他员工激励措施及其实施情况。'
  annualLines[7663]='单位：元'
  annualLines[7671]='合计 169,931,367.54 107,244,670.48 268,811,941.95'
  const interimLines=Array.from({length:1404},()=> '')
  interimLines[1386]='报告期内全部有效的员工持股计划情况'
  interimLines[1400]='150 3,048,701 无 0.17%'
  const annual={candidate:{candidateId:'annual'},title:'2025年年度报告',content:annualLines.join('\n')} as NormalizedResearchSource
  const interim={candidate:{candidateId:'interim'},title:'2026年半年度报告',content:interimLines.join('\n')} as NormalizedResearchSource
  const reasons={
    'industry-exposure':'报告把2025年规模4130亿美元与2026—2030年预测及2030年6300亿美元分开列示，数值及期间吻合，未发现预测期错误。未发现实质证据错误；唯一局限为预测机构未明确。',
    'management-capital-allocation':'2025年年报无计划与2026年半年报披露有效计划的表述均有官方依据；正文对年度与半年期间区分准确，未发现实质错误。',
    risks:'商誉减值合计计提107,244,670.48元与年报段落7664、7672匹配；未发现实质错引或算术错误，且风险路径、触发和监控覆盖充分。',
  }
  const changed=output.sectionChecks.map(check=>{
    if(check.sectionId==='industry-exposure')return {...check,evidenceSupportsConclusion:false,reasons:[reasons['industry-exposure']]}
    if(check.sectionId==='management-capital-allocation')return {...check,evidenceSupportsConclusion:false,reasons:[reasons['management-capital-allocation']]}
    if(check.sectionId==='risks')return {...check,evidenceSupportsConclusion:false,reasons:[reasons.risks]}
    return check
  })
  const report=sections.map(section=>{
    if(section.id==='industry-exposure')return {...section,markdown:'2025年基期4130亿美元；2026—2030年预测复合增长率6%，2030年预计6300亿美元。[annual@paragraph:558] [annual@paragraph:559]'}
    if(section.id==='management-capital-allocation')return {...section,markdown:'2025年年报称当年未实施员工持股计划。[annual@paragraph:2711] 2026年半年度报告披露报告期内有效员工持股计划，150人、3,048,701股。[interim@paragraph:1387]'}
    if(section.id==='risks')return {...section,markdown:'年报商誉减值准备单位为元，合计本期计提107,244,670.48元。[annual@paragraph:7664] [annual@paragraph:7672]'}
    return section
  })
  const fixed=reconcileKnownReviewerFalsePositives(changed,report,[annual,interim])
  for(const id of ['industry-exposure','management-capital-allocation','risks']){
    const check=fixed.find(item=>item.sectionId===id)!
    assert.equal(check.evidenceSupportsConclusion,true,id)
    assert.deepEqual(check.reasons,[],id)
  }
  const mixedRisk=changed.map(check=>check.sectionId==='risks'?{...check,reasons:['年报商誉计提合计107,244,670.48元匹配，未发现实质错引或算术错误；但引用7660对资产组与经营分部的映射不能完整支持，影响减值风险归属。']}:check)
  const preserved=reconcileKnownReviewerFalsePositives(mixedRisk,report,[annual,interim]).find(check=>check.sectionId==='risks')!
  assert.equal(preserved.evidenceSupportsConclusion,false)
  assert.match(preserved.reasons[0]!,/不能完整支持/)
})

test('R196 industry forecast self-contradiction clears only when cited annual paragraphs 556-557 support 2026-2029 forecast',()=>{
  const lines=Array.from({length:7662},()=> '其他年报内容')
  lines[555]='Prismark 预测，2026 年全球 PCB 市场规模将达 958 亿美元，同比增长 13%；2026 至 2029 年间，行业'
  lines[556]='产值年复合增长率约为 7%，到 2029 年有望超过 1160 亿美元。'
  const annual={candidate:{candidateId:'annual-forecast'},title:'2025年年度报告',content:lines.join('\n')} as NormalizedResearchSource
  const body='全球PCB市场预测：2026年规模958亿美元；预测区间2026至2029年，复合增长率约7%，到2029年有望超过1160亿美元，仅作行业背景。[annual-forecast@paragraph:556] [annual-forecast@paragraph:557]'
  const falseReview=output.sectionChecks.map(check=>check.sectionId==='industry-exposure'
    ?{...check,evidenceSupportsConclusion:false,reasons:['预测期年份（2026至2029年）与年报原文一致，2026及2029年市场规模数字、预测期CAGR均有原文支持，但仍将evidenceSupportsConclusion置为false。']}
    :check)
  const report=sections.map(section=>section.id==='industry-exposure'?{...section,markdown:body}:section)
  const fixed=reconcileKnownReviewerFalsePositives(validateCompanySemanticQualityOutput({sectionChecks:falseReview}),report,[annual]).find(check=>check.sectionId==='industry-exposure')!
  assert.equal(fixed.evidenceSupportsConclusion,true)
  assert.deepEqual(fixed.reasons,[])

  const missingSecondCitation=report.map(section=>section.id==='industry-exposure'?{...section,markdown:body.replace(' [annual-forecast@paragraph:557]','')}:section)
  const wrongCitation=reconcileKnownReviewerFalsePositives(validateCompanySemanticQualityOutput({sectionChecks:falseReview}),missingSecondCitation,[annual]).find(check=>check.sectionId==='industry-exposure')!
  assert.equal(wrongCitation.evidenceSupportsConclusion,false,'both exact cited annual paragraphs must support the period and figures')
  const wrongFigure=report.map(section=>section.id==='industry-exposure'?{...section,markdown:body.replace('1160亿美元','1161亿美元')}:section)
  const wrongForecast=reconcileKnownReviewerFalsePositives(validateCompanySemanticQualityOutput({sectionChecks:falseReview}),wrongFigure,[annual]).find(check=>check.sectionId==='industry-exposure')!
  assert.equal(wrongForecast.evidenceSupportsConclusion,false)
  const mixedReview=falseReview.map(check=>check.sectionId==='industry-exposure'?{...check,reasons:['预测期年份（2026至2029年）与年报原文一致，2026及2029年市场规模数字、预测期CAGR均有原文支持；此外存在具体缺失：报告未列公司市场份额，影响竞争地位判断。']}:check)
  const mixed=reconcileKnownReviewerFalsePositives(validateCompanySemanticQualityOutput({sectionChecks:mixedReview}),report,[annual]).find(check=>check.sectionId==='industry-exposure')!
  assert.equal(mixed.evidenceSupportsConclusion,false,'a separate actionable omission must remain blocking')
})

test('R196 goodwill reconciliation clears only when report wording and cited annual row, unit, and total reconcile',()=>{
  const lines=Array.from({length:7662},()=> '其他年报内容')
  lines[7645]='（1）商誉账面原值'
  lines[7646]='单位：元'
  lines[7647]='被投资单位名称或形成商誉的事项 期初余额 本期增加 本期减少 期末余额'
  lines[7648]='企业合并形成的 外币报表折算 处置 其他'
  lines[7659]='索尔思光电 2,825,093,512.48 -26,063,415.57 2,799,030,096.91'
  lines[7660]='Aranda 公司 50,502,380.96 50,502,380.96'
  lines[7661]='合计 2,289,543,588.01 2,825,093,512.48 -26,063,415.57 50,502,380.96 5,038,071,303.96'
  const annual={candidate:{candidateId:'annual-goodwill'},title:'2025年年度报告',content:lines.join('\n')} as NormalizedResearchSource
  const body='年报披露商誉合计期末金额5,038,071,303.96元；索尔思光电2,799,030,096.91元、变动列为负26,063,415.57元。该账面余额变动，不应直接称为当期减值损失。[annual-goodwill@paragraph:7647] [annual-goodwill@paragraph:7660] [annual-goodwill@paragraph:7662]'
  const falseReview=output.sectionChecks.map(check=>check.sectionId==='risks'
    ?{...check,evidenceSupportsConclusion:false,numericReproducible:false,reasons:['年报商誉数值与商誉原值表行对应，合计数亦与期末余额一致；负向变动明确不是当期减值，仍将evidenceSupportsConclusion和numericReproducible置为false。']}
    :check)
  const report=sections.map(section=>section.id==='risks'?{...section,markdown:body}:section)
  const fixed=reconcileKnownReviewerFalsePositives(validateCompanySemanticQualityOutput({sectionChecks:falseReview}),report,[annual]).find(check=>check.sectionId==='risks')!
  assert.equal(fixed.evidenceSupportsConclusion,true)
  assert.equal(fixed.numericReproducible,true)
  assert.deepEqual(fixed.reasons,[])

  const wrongRow=report.map(section=>section.id==='risks'?{...section,markdown:body.replace('paragraph:7660','paragraph:7661')}:section)
  const badLocator=reconcileKnownReviewerFalsePositives(validateCompanySemanticQualityOutput({sectionChecks:falseReview}),wrongRow,[annual]).find(check=>check.sectionId==='risks')!
  assert.equal(badLocator.evidenceSupportsConclusion,false)
  const wrongAmount=report.map(section=>section.id==='risks'?{...section,markdown:body.replace('26,063,415.57','26,063,415.75')}:section)
  const badValue=reconcileKnownReviewerFalsePositives(validateCompanySemanticQualityOutput({sectionChecks:falseReview}),wrongAmount,[annual]).find(check=>check.sectionId==='risks')!
  assert.equal(badValue.numericReproducible,false)
  const mixedReview=falseReview.map(check=>check.sectionId==='risks'?{...check,reasons:['年报商誉原值数值与年报表行对应；负向变动明确不是当期减值，但另有风险归属不支持具体风险传导的缺陷。']}:check)
  const mixed=reconcileKnownReviewerFalsePositives(validateCompanySemanticQualityOutput({sectionChecks:mixedReview}),report,[annual]).find(check=>check.sectionId==='risks')!
  assert.equal(mixed.evidenceSupportsConclusion,false,'a separate risk-attribution defect must remain blocking')
})

test('R16 reviewer contradictions about equal values and explicitly non-blocking issues trigger bounded review repair', () => {
  const cases = [
    { sectionId: 'supply-chain', key: 'evidenceSupportsConclusion', reason: '供应商最大单一占比存在不一致：正文称9.74%，而同列数据为9.74%，该数值本身正确；客户集中度已回答，故不构成实质性不支持。' },
    { sectionId: 'financial-quality', key: 'evidenceSupportsConclusion', reason: '公式运算约为-2.74%，数值正确，范围差异已明确限制，故不构成错误。' },
    { sectionId: 'catalysts', key: 'evidenceSupportsConclusion', reason: '该节主要回答催化剂与风险观察事项，判为false无依据，调整为通过。' },
  ] as const
  for (const { sectionId, key, reason } of cases) {
    const contradictory = output.sectionChecks.map(check => check.sectionId === sectionId ? { ...check, [key]: false, reasons: [reason] } : check)
    assert.throws(() => validateCompanySemanticQualityOutput({ sectionChecks: contradictory }), /Contradictory/)
  }
  const realCapitalCitationGap = output.sectionChecks.map(check => check.sectionId === 'management-capital-allocation' ? { ...check, numericReproducible: false, reasons: ['研发金额行未附对应引用，无法逐行复核。'] } : check)
  assert.equal(validateCompanySemanticQualityOutput({ sectionChecks: realCapitalCitationGap }).find(check => check.sectionId === 'management-capital-allocation')!.numericReproducible, false)
})

test('numeric agreement does not erase a concrete missing-operands reproducibility defect', () => {
  const incompleteReproduction = output.sectionChecks.map(check => check.sectionId === 'risks'
    ? { ...check, numericReproducible: false, reasons: ['这些派生百分点虽与preparedAnalysis计算结果相符，但本节未展示所需两期操作数和公式；影响读者复核两项比率变化。'] }
    : check)
  assert.equal(validateCompanySemanticQualityOutput({ sectionChecks: incompleteReproduction }).find(check => check.sectionId === 'risks')!.numericReproducible, false)

  const coverageIssue = output.sectionChecks.map(check => check.sectionId === 'financial-quality'
    ? { ...check, evidenceSupportsConclusion: false, numericReproducible: false, reasons: ['所列比率及其公式均可复算，但摘要表未列对应原始余额，影响读者在摘要处直接核验。'] }
    : check)
  const coverage = validateCompanySemanticQualityOutput({ sectionChecks: coverageIssue }).find(check => check.sectionId === 'financial-quality')!
  assert.equal(coverage.numericReproducible, true, 'a table coverage defect is separate from the reproducibility of the stated calculation')
  assert.equal(coverage.evidenceSupportsConclusion, false)

  const formulaMeaningMismatch = output.sectionChecks.map(check => check.sectionId === 'revenue-profit-drivers'
    ? { ...check, evidenceSupportsConclusion: false, numericReproducible: false, reasons: ['公式可复算，但收入与成本增速相减不等于毛利率变动；报告把该差额解释为毛利率变化，影响指标解释。'] }
    : check)
  const normalized = validateCompanySemanticQualityOutput({ sectionChecks: formulaMeaningMismatch }).find(check => check.sectionId === 'revenue-profit-drivers')!
  assert.equal(normalized.numericReproducible, true, 'the arithmetic is valid while its economic interpretation remains an evidence defect')
  assert.equal(normalized.evidenceSupportsConclusion, false)

  const exactMissingOperands = output.sectionChecks.map(check => check.sectionId === 'financial-quality'
    ? { ...check, numericReproducible: false, reasons: ['未显示两期负债/资产操作数和公式，需补明两期计算过程，影响杠杆趋势判断。'] }
    : check)
  assert.equal(validateCompanySemanticQualityOutput({ sectionChecks: exactMissingOperands }).find(check => check.sectionId === 'financial-quality')!.numericReproducible, false)

  const unsupportedRejection = output.sectionChecks.map(check => check.sectionId === 'risks'
    ? { ...check, numericReproducible: false, reasons: ['这些比率与代码结果相符，计算无误。'] }
    : check)
  assert.throws(() => validateCompanySemanticQualityOutput({ sectionChecks: unsupportedRejection }), /Contradictory numeric rejection/)

  const nonBlockingMissingFormula = output.sectionChecks.map(check => check.sectionId === 'risks'
    ? { ...check, numericReproducible: false, reasons: ['这些数字均为直接披露事实，无需复算；报告未列出公式，但原文可直接核验。'] }
    : check)
  assert.throws(() => validateCompanySemanticQualityOutput({ sectionChecks: nonBlockingMissingFormula }), /Contradictory numeric rejection/)

  const formulaGapDoesNotProveEvidenceFailure = output.sectionChecks.map(check => check.sectionId === 'risks'
    ? { ...check, evidenceSupportsConclusion: false, reasons: ['引用本身与原表一致，结论有原文依据；未展示两期操作数和公式，影响读者复核比率变化。'] }
    : check)
  assert.throws(() => validateCompanySemanticQualityOutput({ sectionChecks: formulaGapDoesNotProveEvidenceFailure }), /Contradictory evidence rejection/)

  const sourceRowNameMismatch = output.sectionChecks.map(check => check.sectionId === 'revenue-profit-drivers'
    ? { ...check, evidenceSupportsConclusion: false, reasons: ['引用原文paragraph:651虽与报告简称一致，但来源表格完整行实际是触控面板及液晶显示模组，产品名称范围不一致，可能误导跨期趋势判断。'] }
    : check)
  assert.equal(validateCompanySemanticQualityOutput({ sectionChecks: sourceRowNameMismatch }).find(check => check.sectionId === 'revenue-profit-drivers')!.evidenceSupportsConclusion, false)

  const formulaGapDoesNotProveRiskPathFailure = output.sectionChecks.map(check => check.sectionId === 'risks'
    ? { ...check, riskTransmission: false, reasons: ['风险触发、影响、监控和缓释均已覆盖；未展示两期操作数和公式，影响读者复核比率变化。'] }
    : check)
  assert.throws(() => validateCompanySemanticQualityOutput({ sectionChecks: formulaGapDoesNotProveRiskPathFailure }), /Contradictory risk rejection/)
})

test('reviewer may retain an evidence blocker for an explicitly unlabelled annual versus interim period', () => {
  const periodScopeGap = output.sectionChecks.map(check => check.sectionId === 'revenue-profit-drivers'
    ? { ...check, evidenceSupportsConclusion: false, reasons: ['分行业表该行来自年度数据，引用和表列数据相符；但全文未明确年度业务驱动与2026上半年产品数据为不同期间，容易混读。'] }
    : check)
  assert.equal(validateCompanySemanticQualityOutput({ sectionChecks: periodScopeGap }).find(check => check.sectionId === 'revenue-profit-drivers')!.evidenceSupportsConclusion, false)
})

test('reviewer period mismatch remains concrete when an unrelated absence is accurate', () => {
  const periodMismatch = output.sectionChecks.map(check => check.sectionId === 'industry-exposure'
    ? { ...check, evidenceSupportsConclusion: false, reasons: ['原文paragraph:559写2030年市场规模将达6300亿美元，但报告将该终点数值标成2026—2030年期间规模，年份不精确并影响时间口径核对；同一行关于预测机构未明确的限制与方法finding一致，不是虚假缺口。'] }
    : check)
  assert.equal(validateCompanySemanticQualityOutput({ sectionChecks: periodMismatch }).find(check => check.sectionId === 'industry-exposure')!.evidenceSupportsConclusion, false)
})

test('R194 review period objection is cleared only when the report and cited annual paragraphs show the correct 2026-2030 forecast',()=>{
  const lines=Array.from({length:559},()=> '披露正文')
  lines[557]='2025年全球服务器及存储领域的市场规模为 4130 亿美元。'
  lines[558]='2026 至 2030 年复合增长率为 6%，2030 年市场规模将达 6300 亿美元。'
  const annual={candidate:{candidateId:'annual-period'},title:'2025年年度报告',content:lines.join('\n')} as NormalizedResearchSource
  const body='全球服务器及存储市场为相邻市场：2025年基期4130亿美元；公司报告所述预测为2026至2030年复合增长率6%，2030年6300亿美元。[annual-period@paragraph:557] [annual-period@paragraph:558] [annual-period@paragraph:559]'
  const report=sections.map(section=>section.id==='industry-exposure'?{...section,markdown:body}:section)
  const falseChecks=output.sectionChecks.map(check=>check.sectionId==='industry-exposure'
    ?{...check,evidenceSupportsConclusion:false,numericReproducible:false,reasons:['全球服务器市场段落将预测期写为2025年至2030年复合增长率6%；来源原文明确2026至2030年，报告错置预测起始年，影响时间边界。']}
    :check)
  const fixed=reconcileKnownReviewerFalsePositives(validateCompanySemanticQualityOutput({sectionChecks:falseChecks}),report,[annual]).find(check=>check.sectionId==='industry-exposure')!
  assert.equal(fixed.evidenceSupportsConclusion,true)
  assert.equal(fixed.numericReproducible,true)
  assert.deepEqual(fixed.reasons,[])
  const wrongBody=body.replace('2026至2030年','2025至2030年')
  const wrong=reconcileKnownReviewerFalsePositives(validateCompanySemanticQualityOutput({sectionChecks:falseChecks}),report.map(section=>section.id==='industry-exposure'?{...section,markdown:wrongBody}:section),[annual]).find(check=>check.sectionId==='industry-exposure')!
  assert.equal(wrong.evidenceSupportsConclusion,false)
})

test('R194 employee-plan review false positive is dismissed only when the report and filing both preserve the employee-count label and its limitation',()=>{
  const filingLines=Array.from({length:1404},()=> '披露正文')
  filingLines[1386]='全部有效的员工持股计划情况'
  filingLines[1392]='员工人数'
  filingLines[1401]='核心技术（业务）骨干'
  filingLines[1402]='150 3,048,701 无 0.17%'
  const filing={candidate:{candidateId:'employee-filing',publishedAt:'2026-08-22'},title:'2026年半年度报告',content:filingLines.join('\n')} as NormalizedResearchSource
  const body='员工持股计划表“员工人数”列披露150人，不能推断为实际人数；人数上限在可用披露中未见，持股数也不等于实际参与人数。[employee-filing@paragraph:1393] [employee-filing@paragraph:1403]'
  const report=[...COMPANY_CORE_SECTION_IDS.map(id=>({id,markdown:id==='monitoring-checklist'?body:`${id} 正常分析。`}))]
  const falseChecks=output.sectionChecks.map(check=>check.sectionId==='monitoring-checklist'
    ?{...check,evidenceSupportsConclusion:false,numericReproducible:false,reasons:['治理监控行重复写持股数；真正问题是把2026年半年报员工持股人数150人当作计划实际参与人数并据此要求核验人数上限，员工人数与实际参与人数混淆。']}
    :check)
  const reconciled=reconcileKnownReviewerFalsePositives(validateCompanySemanticQualityOutput({sectionChecks:falseChecks}),report,[filing])
  const accepted=reconciled.find(check=>check.sectionId==='monitoring-checklist')!
  assert.equal(accepted.evidenceSupportsConclusion,true)
  assert.equal(accepted.numericReproducible,true)
  assert.deepEqual(accepted.reasons,[])
  const unrelatedValueCitation=report.map(section=>section.id==='monitoring-checklist'?{...section,markdown:body.replace('paragraph:1403','paragraph:1402')}:section)
  const remainsBlocked=reconcileKnownReviewerFalsePositives(validateCompanySemanticQualityOutput({sectionChecks:falseChecks}),unrelatedValueCitation,[filing]).find(check=>check.sectionId==='monitoring-checklist')!
  assert.equal(remainsBlocked.evidenceSupportsConclusion,false,'the value citation must point to the paragraph that actually contains 150 and the share count')
  const unrelatedHeaderCitation=report.map(section=>section.id==='monitoring-checklist'?{...section,markdown:body.replace('paragraph:1393','paragraph:1392')}:section)
  const missingHeader=reconcileKnownReviewerFalsePositives(validateCompanySemanticQualityOutput({sectionChecks:falseChecks}),unrelatedHeaderCitation,[filing]).find(check=>check.sectionId==='monitoring-checklist')!
  assert.equal(missingHeader.evidenceSupportsConclusion,false,'the header citation must point to the paragraph that actually labels employee count')
  const splitHeaderLines=filingLines.slice()
  splitHeaderLines[1392]='员工人'
  splitHeaderLines[1393]='数'
  const splitHeaderFiling={...filing,content:splitHeaderLines.join('\n')}
  const splitHeaderBody=body.replace('paragraph:1393]','paragraph:1393] [employee-filing@paragraph:1394]')
  const splitHeaderReport=report.map(section=>section.id==='monitoring-checklist'?{...section,markdown:splitHeaderBody}:section)
  const splitHeaderAccepted=reconcileKnownReviewerFalsePositives(validateCompanySemanticQualityOutput({sectionChecks:falseChecks}),splitHeaderReport,[splitHeaderFiling]).find(check=>check.sectionId==='monitoring-checklist')!
  assert.equal(splitHeaderAccepted.evidenceSupportsConclusion,true,'both split header fragments and the value row must be cited')
  const ambiguous=report.map(section=>section.id==='monitoring-checklist'?{...section,markdown:'员工人数列列示150人。[employee-filing@paragraph:1393] [employee-filing@paragraph:1402]'}:section)
  const stillBlocked=reconcileKnownReviewerFalsePositives(validateCompanySemanticQualityOutput({sectionChecks:falseChecks}),ambiguous,[filing]).find(check=>check.sectionId==='monitoring-checklist')!
  assert.equal(stillBlocked.evidenceSupportsConclusion,false)
  const unrelatedCitation=report.map(section=>section.id==='monitoring-checklist'?{...section,markdown:body.replace('employee-filing@paragraph:1403','employee-filing@paragraph:1387')}:section)
  const unrelatedStillBlocked=reconcileKnownReviewerFalsePositives(validateCompanySemanticQualityOutput({sectionChecks:falseChecks}),unrelatedCitation,[filing]).find(check=>check.sectionId==='monitoring-checklist')!
  assert.equal(unrelatedStillBlocked.evidenceSupportsConclusion,false)
})

test('a concrete citation defect does not turn explicitly correct amounts into a numeric failure',()=>{
  const sectionChecks=COMPANY_CORE_SECTION_IDS.map(sectionId=>({sectionId,questionAnswered:true,evidenceSupportsConclusion:sectionId==='technologies'?false:true,numericReproducible:sectionId==='technologies'?false:true,riskTransmission:true,reasons:sectionId==='technologies'?['金额正确，但引用列表把研发活动表与利润表定位混杂，呈现区分仍较难复核。']:[]}))
  const checks=validateCompanySemanticQualityOutput({sectionChecks})
  const reconciled=reconcileKnownReviewerFalsePositives(checks,[...COMPANY_CORE_SECTION_IDS].map(id=>({id,markdown:''})))
  assert.equal(reconciled.find(check=>check.sectionId==='technologies')!.numericReproducible,true)
  assert.equal(reconciled.find(check=>check.sectionId==='technologies')!.evidenceSupportsConclusion,false)
})

test('reviewer cannot reject a vehicle specification when its exact cited official paragraph states the number',()=>{
  const sourceId='byd-official'
  const citedLine='海豹08售价19.69万元-23.99万元，并披露905km纯电续航。'
  const sourceLines=Array.from({length:337},(_,index)=>index===336?citedLine:'')
  const official={candidate:{candidateId:sourceId,publishedAt:'2026-07-08'},title:'BYD official product page',content:sourceLines.join('\n')} as NormalizedResearchSource
  const body=`| 海豹08 | 售价19.69万元-23.99万元及905km纯电续航。[${sourceId}@paragraph:337] |`
  const reason='表中“海豹08”称公司披露纯电续航905km，但来源段落337只支持售价、定位及宣传描述，不含该续航数值；该产品规格引用不支持结论，数值不可复核。'
  const checks=output.sectionChecks.map(check=>check.sectionId==='products'?{...check,evidenceSupportsConclusion:false,numericReproducible:false,reasons:[reason]}:check)
  const report=sections.map(section=>section.id==='products'?{...section,markdown:body}:section)
  const fixed=reconcileKnownReviewerFalsePositives(checks,report,[official]).find(check=>check.sectionId==='products')!
  assert.equal(fixed.evidenceSupportsConclusion,true)
  assert.equal(fixed.numericReproducible,true)
  assert.deepEqual(fixed.reasons,[])

  const unsupported={...official,content:Array.from({length:337},(_,index)=>index===336?'海豹08售价19.69万元-23.99万元。':'').join('\n')}
  const stillBlocked=reconcileKnownReviewerFalsePositives(checks,report,[unsupported]).find(check=>check.sectionId==='products')!
  assert.equal(stillBlocked.numericReproducible,false)
  assert.match(stillBlocked.reasons.join(' '),/905km/)
})

test('semantic review retries verdicts that call rejected content disclosed, reproducible, or adequately analyzed', async () => {
  const contradictory = { sectionChecks: output.sectionChecks.map((check) => {
    if (check.sectionId === 'revenue-profit-drivers') return { ...check, evidenceSupportsConclusion: false, reasons: ['事实方向正确，但可能由非经营项目影响；资料不足，边界适当，无实质证据错误。'] }
    if (check.sectionId === 'products') return { ...check, numericReproducible: false, reasons: ['这些数字均为直接披露事实，无需重算。'] }
    if (check.sectionId === 'supply-chain') return { ...check, evidenceSupportsConclusion: false, reasons: ['引用表格确实分别披露相应比例，证据口径相符；未发现具体错误。'] }
    if (check.sectionId === 'management-capital-allocation') return { ...check, evidenceSupportsConclusion: false, reasons: ['履历及持股数据已在报告中引用并分析，没有把已披露资料说成缺失。'] }
    if (check.sectionId === 'risks') return { ...check, riskTransmission: false, reasons: ['风险传导、观察信号及缓释均有描述，数字亦可核验，未发现说明中的实质错误。'] }
    return check
  }) }
  let calls = 0
  const result = await reviewCompanyResearchSemantics({ ...input, reasoningExecutor: executor(async (request) => {
    calls++
    if (calls === 2) assert.ok(request.input.repairErrors.some((error: { message: string }) => /Contradictory/.test(error.message)))
    return calls === 1 ? contradictory : output
  }) })
  assert.equal(calls, 2)
  assert.equal(result.passed, true)
  assert.equal(result.attempts, 2)
})

test('R174 pure confirmations repair false financial-quality and growth-driver flags without retaining blockers', () => {
  const confirmed = output.sectionChecks.map(check => {
    if (check.sectionId === 'financial-quality') return {
      ...check,
      evidenceSupportsConclusion: false,
      numericReproducible: false,
      reasons: ['资产负债率来源及期间一致，公式与数值可复算；经营现金流同比结果与preparedAnalysis吻合，未发现实质错误。'],
    }
    if (check.sectionId === 'growth-drivers') return {
      ...check,
      evidenceSupportsConclusion: false,
      numericReproducible: false,
      reasons: ['合并毛利率变化有preparedAnalysis支持；净利率变动复算吻合，未发现实质错误。'],
    }
    return check
  })

  const validated = validateCompanySemanticQualityOutput({ sectionChecks: confirmed })
  for (const sectionId of ['financial-quality', 'growth-drivers']) {
    const check = validated.find(item => item.sectionId === sectionId)!
    assert.equal(check.evidenceSupportsConclusion, true, `${sectionId}: evidence confirmation should correct the false flag`)
    assert.equal(check.numericReproducible, true, `${sectionId}: numeric confirmation should correct the false flag`)
    assert.deepEqual(check.reasons, [], `${sectionId}: confirmation-only text is not a blocker`)
  }
})

test('company review keeps supported management figures separate from a real risk-matrix coverage gap', () => {
  const checks = output.sectionChecks.map(check => {
    if (check.sectionId === 'management-capital-allocation') return {
      ...check,
      evidenceSupportsConclusion: false,
      numericReproducible: false,
      reasons: [
        '报告准确区分2025员工持股计划人数上限（年报段落3060）与半年报参与人数/持股数（段落1159）；也限定刘学亮履历和职责缺口，没有把管理层整体称为缺失。',
        '资本化比例8.61%与1.78%的百分点差6.83由报告明确给出公式；原表变动比例按原单位使用。研发投入率6.97%与7.89%等原表数字均准确列示。没有关键数字错误。',
      ],
    }
    if (check.sectionId === 'risks') return {
      ...check,
      evidenceSupportsConclusion: false,
      numericReproducible: false,
      riskTransmission: false,
      reasons: [
        '“当前材料不足以确认具体竞品及可比维度”与其他已完成竞争方法及本报告竞争章节已给出的吉利银河E8候选路线不一致；风险矩阵未把具名候选路线纳入具体风险行，仅在末尾补充，影响竞争触发条件与监控的完整性。',
        '公司客户占比、商誉金额及财务指标均已有相应官方/结构化来源，报告未称其缺失；列出的客户静态占比并未被当作实际损失。',
        '风险传导已给出收入/利润、客户/利用率、存货/资金占用、商誉/资产利润等路径及观察指标、缓解和残余风险；竞争行称资料不足虽可限定，但具体具名候选遗漏需修正。',
      ],
    }
    return check
  })
  const validated = validateCompanySemanticQualityOutput({ sectionChecks: checks })
  const management = validated.find(check => check.sectionId === 'management-capital-allocation')!
  assert.equal(management.evidenceSupportsConclusion, true)
  assert.equal(management.numericReproducible, true)
  assert.deepEqual(management.reasons, [])

  const risks = validated.find(check => check.sectionId === 'risks')!
  assert.equal(risks.questionAnswered, true)
  assert.equal(risks.evidenceSupportsConclusion, false)
  assert.equal(risks.numericReproducible, true, 'risk-path omission does not make otherwise supported values unreproducible')
  assert.equal(risks.riskTransmission, false, 'the specific omitted competitor route still leaves this risk row incomplete')
  assert.match(risks.reasons.join(' '), /具体具名候选遗漏需修正/)
})

test('R174 mixed monitoring explanation keeps the concrete missing-count evidence blocker but passes confirmed arithmetic', () => {
  const mixed = output.sectionChecks.map(check => check.sectionId === 'monitoring-checklist'
    ? {
      ...check,
      evidenceSupportsConclusion: false,
      numericReproducible: false,
      reasons: ['2025年汽车产品营业收入同比5.06%、成本同比7.53%，算术差-2.47个百分点正确，原表毛利率变动-1.82%准确沿用；但计划实际参与人数未在本节列出，影响激励覆盖监控。'],
    }
    : check)

  const check = validateCompanySemanticQualityOutput({ sectionChecks: mixed }).find(item => item.sectionId === 'monitoring-checklist')!
  assert.equal(check.numericReproducible, true, 'the unrelated evidence gap cannot make the reproduced arithmetic fail')
  assert.equal(check.evidenceSupportsConclusion, false, 'a concrete missing-count assertion remains fail-closed for evidence review')
  assert.match(check.reasons.join(' '), /实际参与人数未在本节列出/)
})

test('R174 correct numeric confirmation does not mask an independently stated product-versus-industry misclassification', () => {
  const mixed = output.sectionChecks.map(check => check.sectionId === 'revenue-profit-drivers'
    ? {
      ...check,
      evidenceSupportsConclusion: false,
      numericReproducible: false,
      reasons: ['收入金额及同比计算可核验；但正文把分产品收入行错列为分行业数据，导致行业与产品驱动分类不一致。'],
    }
    : check)

  const check = validateCompanySemanticQualityOutput({ sectionChecks: mixed }).find(item => item.sectionId === 'revenue-profit-drivers')!
  assert.equal(check.numericReproducible, true, 'the stated arithmetic remains reproducible')
  assert.equal(check.evidenceSupportsConclusion, false, 'the row-dimension misclassification remains an evidence blocker')
  assert.match(check.reasons.join(' '), /错列为分行业/)
})

test('BYD supply-chain exact inline formula citations override only the false section-end citation objection', () => {
  const financial = { ...source, candidate: { ...source.candidate, candidateId: 'akshare-financial-002594' }, title: '结构化财务数据', content: '营业收入 344815421000；期初应收 37004685000；期末应收 50126342000；存货 189990772000；应付 176356021000；营业成本 279826859000。' }
  const formulaBody = 'DSO：期初应收与期末应收平均值÷收入×181天＝22.87天[akshare-financial-002594@paragraph:1]；DIO：期初存货与期末存货平均值÷营业成本×181天＝106.21天[akshare-financial-002594@paragraph:1]；DPO：期初应付与期末应付平均值÷营业成本×181天＝117.43天[akshare-financial-002594@paragraph:1]；CCC：DSO＋DIO−DPO＝11.65天[akshare-financial-002594@paragraph:1]。'
  const reviewReason = 'DSO/DIO/DPO/CCC各项数值均能由结构化财务段落1复核，故数值本身无误；但关键周转数字段没有精确source@paragraph绑定，现有引文仅位于章节末尾，影响逐项定位与证据追踪。'
  const checks = output.sectionChecks.map(check => check.sectionId === 'supply-chain' ? { ...check, evidenceSupportsConclusion: false, reasons: [reviewReason] } : check)
  const report = sections.map(section => section.id === 'supply-chain' ? { ...section, markdown: formulaBody } : section)
  const fixed = reconcileKnownReviewerFalsePositives(validateCompanySemanticQualityOutput({ sectionChecks: checks }), report, [financial]).find(check => check.sectionId === 'supply-chain')!
  assert.equal(fixed.evidenceSupportsConclusion, true)
  assert.equal(fixed.numericReproducible, true)
  assert.deepEqual(fixed.reasons, [])

  const missingOneInlineCitation = formulaBody.replace('CCC：DSO＋DIO−DPO＝11.65天[akshare-financial-002594@paragraph:1]', 'CCC：DSO＋DIO−DPO＝11.65天')
  const stillBlocked = reconcileKnownReviewerFalsePositives(validateCompanySemanticQualityOutput({ sectionChecks: checks }), sections.map(section => section.id === 'supply-chain' ? { ...section, markdown: missingOneInlineCitation } : section), [financial]).find(check => check.sectionId === 'supply-chain')!
  assert.equal(stillBlocked.evidenceSupportsConclusion, false)
  assert.match(stillBlocked.reasons.join(' '), /仅位于章节末尾/)
})

test('BYD explicit revenue-driver self-retraction clears its false flags but preserves independent defects', () => {
  const citedSource = { ...source, content: '境内收入同比下降30.68%；海外收入同比增长33.92%；财务方向与报告表述一致。' }
  const body = '境内收入同比下降30.68%，海外收入同比增长33.92%；收入与利润方向按报告期引用核对。[filing@paragraph:1]'
  const reason = '本节引用的区域方向及财务方向准确，未发现能支撑false的具体反证，需纠正旗标。'
  const checks = output.sectionChecks.map(check => check.sectionId === 'revenue-profit-drivers' ? { ...check, evidenceSupportsConclusion: false, numericReproducible: false, reasons: [reason] } : check)
  const report = sections.map(section => section.id === 'revenue-profit-drivers' ? { ...section, markdown: body } : section)
  const fixed = reconcileKnownReviewerFalsePositives(validateCompanySemanticQualityOutput({ sectionChecks: checks }), report, [citedSource]).find(check => check.sectionId === 'revenue-profit-drivers')!
  assert.equal(fixed.evidenceSupportsConclusion, true)
  assert.equal(fixed.numericReproducible, true)
  assert.deepEqual(fixed.reasons, [])

  const mixed = checks.map(check => check.sectionId === 'revenue-profit-drivers' ? { ...check, reasons: [reason, '但分产品分类错列为分行业，导致结论口径不一致。'] } : check)
  const remainsBlocked = reconcileKnownReviewerFalsePositives(validateCompanySemanticQualityOutput({ sectionChecks: mixed }), report, [citedSource]).find(check => check.sectionId === 'revenue-profit-drivers')!
  assert.equal(remainsBlocked.evidenceSupportsConclusion, false)
  assert.equal(remainsBlocked.numericReproducible, false)
  assert.match(remainsBlocked.reasons.join(' '), /分类错列/)

  const contrarySource = { ...citedSource, content: '境内收入同比增长30.68%；海外收入同比下降33.92%；财务方向与报告表述不一致。' }
  const mismatchedEvidence = reconcileKnownReviewerFalsePositives(validateCompanySemanticQualityOutput({ sectionChecks: checks }), report, [contrarySource]).find(check => check.sectionId === 'revenue-profit-drivers')!
  assert.equal(mismatchedEvidence.evidenceSupportsConclusion, false, 'self-retraction cannot override cited source values that do not support the report')
  assert.match(mismatchedEvidence.reasons.join(' '), /未发现能支撑false的具体反证/)
})

test('numeric review flag is normalized when the reviewer explicitly retracts the calculation error', () => {
  const reason = '报告未给两个输入数值的派生公式引用之外的完整数值行；更关键的是电子电路产品收入、成本增速之差报告所给算术无误。未发现这些已列数字的计算错误，表格原文支持操作数；此项不判错，原因应收窄。'
  const checks = output.sectionChecks.map(check => check.sectionId === 'revenue-profit-drivers'
    ? { ...check, numericReproducible: false, reasons: [reason] }
    : check)
  const validated = validateCompanySemanticQualityOutput({ sectionChecks: checks })
  assert.equal(validated.find(check => check.sectionId === 'revenue-profit-drivers')!.numericReproducible, true)
})

test('BYD correct derived R&D percentage-point difference clears numeric false positive only when the report distinguishes the source percent', () => {
  const annual = { ...source, content: '资本化研发投入占研发投入的比例 8.61% 1.78% 6.83%' }
  const body = '原表变动比例为6.83%；按比例水平相减，8.61%−1.78%＝6.83个百分点。原表列示的变动比例沿用%单位，百分点差为本报告另行计算。[filing@paragraph:1]'
  const reason = '原表变动列单位为%而非百分点；8.61%−1.78%=6.83个百分点，数学结果正确，且该计算本身是正确的衍生百分点差。'
  const checks = output.sectionChecks.map(check => check.sectionId === 'management-capital-allocation' ? { ...check, numericReproducible: false, reasons: [reason] } : check)
  const report = sections.map(section => section.id === 'management-capital-allocation' ? { ...section, markdown: body } : section)
  const fixed = reconcileKnownReviewerFalsePositives(validateCompanySemanticQualityOutput({ sectionChecks: checks }), report, [annual]).find(check => check.sectionId === 'management-capital-allocation')!
  assert.equal(fixed.numericReproducible, true)
  assert.deepEqual(fixed.reasons, [])

  const mislabeled = body.replace('原表变动比例为6.83%；', '原表披露的6.83%就是百分点差；')
  const stillBlocked = reconcileKnownReviewerFalsePositives(validateCompanySemanticQualityOutput({ sectionChecks: checks }), sections.map(section => section.id === 'management-capital-allocation' ? { ...section, markdown: mislabeled } : section), [annual]).find(check => check.sectionId === 'management-capital-allocation')!
  assert.equal(stillBlocked.numericReproducible, false)
  assert.match(stillBlocked.reasons.join(' '), /原表变动列单位/)
})

test('Dongshan source-backed R&D and employee-plan facts clear a numeric false positive without hiding real evidence gaps', () => {
  const filing = { ...source, content: '研发投入占营业收入比例为3.57%、3.45%，原表变动比例显示0.12%。员工持股计划披露对象为核心技术（业务）骨干；员工人数列披露150人，持有股票3,048,701股，占总股本0.17%。' }
  const body = '研发投入占营业收入比例为3.57%、3.45%；原表变动比例显示0.12%，没有改称百分点。[filing@paragraph:1] 员工持股计划披露对象为核心技术（业务）骨干，员工人数列披露150人，持有股票3,048,701股，占总股本0.17%。[filing@paragraph:1]'
  const reasons = [
    '“研发投入占营业收入比例为3.57%、3.45%；原表变动比例显示0.12%”直接沿用官方原表paragraph:1，且明确没有改称百分点；该值可复核，不应判错。',
    '“员工持股计划披露对象……员工人数列披露150人，并列示持有股票3,048,701股、占总股本0.17%”对应半年报paragraph:1，可复核；报告没有把人数上限误写为实际参与人数。'
  ]
  const checks = output.sectionChecks.map(check => check.sectionId === 'management-capital-allocation'
    ? { ...check, numericReproducible: false, reasons }
    : check)
  const report = sections.map(section => section.id === 'management-capital-allocation' ? { ...section, markdown: body } : section)
  const validated = validateCompanySemanticQualityOutput({ sectionChecks: checks })
  const fixed = reconcileKnownReviewerFalsePositives(validated, report, [filing]).find(check => check.sectionId === 'management-capital-allocation')!
  assert.equal(fixed.numericReproducible, true)
  assert.deepEqual(fixed.reasons, [])

  const unsupported = reconcileKnownReviewerFalsePositives(validated, report, [{ ...filing, content: '未提及相关数据。' }]).find(check => check.sectionId === 'management-capital-allocation')!
  assert.equal(unsupported.numericReproducible, false)
  assert.equal(unsupported.reasons.length, 2)
})

test('financial-quality period-basis mismatch keeps evidence blocked while classifying the comparison arithmetic as reproducible', () => {
  const reason = '“应收账款期末余额同比增长76.5716%”与“存货期末余额同比增长78.1743%”将结构化期末余额序列比较称为同比；官方半年报明确原表比较口径为本报告期末对上年末。虽然报告随后又限定前述为结构化序列计算，仍把余额称同比并与累计收入比较，造成期间基期描述不一致，影响营运资金背离结论的口径。'
  const checks = output.sectionChecks.map(check => check.sectionId === 'financial-quality'
    ? { ...check, evidenceSupportsConclusion: false, numericReproducible: false, reasons: [reason] }
    : check)
  const validated = validateCompanySemanticQualityOutput({ sectionChecks: checks })
  const financial = validated.find(check => check.sectionId === 'financial-quality')!
  assert.equal(financial.evidenceSupportsConclusion, false)
  assert.equal(financial.numericReproducible, true)
  assert.match(financial.reasons.join(' '), /期间基期描述不一致/)
})

test('R30 product-versus-industry mislabel keeps the evidence blocker but normalizes the matching disclosed amounts', () => {
  const reason = '表中产品收入及占比金额引用paragraph 816、814、817，但这些原文属于分行业数据行，而报告称其为分产品行；分产品金额占比实际见paragraph 820、822、823，且收入金额虽相同，来源分类标签未绑定正确，导致分部分类口径不可复核。'
  const checks = output.sectionChecks.map(check => check.sectionId === 'business-segments'
    ? { ...check, evidenceSupportsConclusion: true, numericReproducible: false, reasons: [reason] }
    : check)
  const normalized = validateCompanySemanticQualityOutput({ sectionChecks: checks }).find(check => check.sectionId === 'business-segments')!
  assert.equal(normalized.numericReproducible, true, 'the figures match the disclosed product rows; the wrong row classification is not an arithmetic failure')
  assert.equal(normalized.evidenceSupportsConclusion, false, 'industry rows do not support a product-segment claim')
  assert.match(normalized.reasons.join(' '), /来源分类标签未绑定正确/)

  const wrongValueReason = `${reason} 但产品行收入金额实际应为155,000,000,000元而非155,236,528,000元，报告数值错误。`
  const wrongValue = validateCompanySemanticQualityOutput({ sectionChecks: checks.map(check => check.sectionId === 'business-segments' ? { ...check, numericReproducible: false, reasons: [wrongValueReason] } : check) }).find(check => check.sectionId === 'business-segments')!
  assert.equal(wrongValue.numericReproducible, false, 'an explicit contrary amount remains a numeric blocker')
  assert.equal(wrongValue.evidenceSupportsConclusion, false)
})

test('R30 financial-quality comparison framing stays an evidence blocker while reproducible amounts pass numeric review', () => {
  const reason = '“半年末短期借款略低于上年末”与结构化数据、半年报paragraph 776吻合；但将借款余额变化限定为上年末比较。主要阻塞是正文的周转指标均可复算，但把结构化序列2025-06-30至2026-06-30余额同比计算的增长与原表“本报告期末／上年末”余额变化并置，未充分区分两套比较口径；影响读者区分同期余额同比和半年报期末对年末的方向。其余主要金额及公式均可复核。'
  const checks = output.sectionChecks.map(check => check.sectionId === 'financial-quality'
    ? { ...check, evidenceSupportsConclusion: false, numericReproducible: false, reasons: [reason] }
    : check)
  const normalized = validateCompanySemanticQualityOutput({ sectionChecks: checks }).find(check => check.sectionId === 'financial-quality')!
  assert.equal(normalized.numericReproducible, true, 'the same-date balance arithmetic remains reproducible')
  assert.equal(normalized.evidenceSupportsConclusion, false, 'the mixed comparison frames still fail evidentiary interpretation')
  assert.match(normalized.reasons.join(' '), /未充分区分两套比较口径/)

  const wrongPeriodReason = `${reason} 但该行期间实际应为2025年同期而非上年末，期间错误，导致计算比较基期不符。`
  const wrongPeriod = validateCompanySemanticQualityOutput({ sectionChecks: checks.map(check => check.sectionId === 'financial-quality' ? { ...check, numericReproducible: false, reasons: [wrongPeriodReason] } : check) }).find(check => check.sectionId === 'financial-quality')!
  assert.equal(wrongPeriod.numericReproducible, false, 'an explicitly wrong calculation period remains numeric-blocking')
  assert.equal(wrongPeriod.evidenceSupportsConclusion, false)

  const wrongValueReason = `${reason} 但资产负债率实际应为72.00%，公式结果错误。`
  const wrongValue = validateCompanySemanticQualityOutput({ sectionChecks: checks.map(check => check.sectionId === 'financial-quality' ? { ...check, numericReproducible: false, reasons: [wrongValueReason] } : check) }).find(check => check.sectionId === 'financial-quality')!
  assert.equal(wrongValue.numericReproducible, false, 'an explicit wrong formula result remains numeric-blocking')
  assert.equal(wrongValue.evidenceSupportsConclusion, false)
})
