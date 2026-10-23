import test from 'node:test'
import assert from 'node:assert/strict'
import { reconcileKnownReviewerFalsePositives, reviewCompanyResearchSemantics, validateCompanySemanticQualityOutput } from '../../workflows/company-deep-research/semantic-quality.ts'
import { COMPANY_CORE_SECTION_IDS } from '../../workflows/company-deep-research/content-quality.ts'
import type { ReasoningExecutor } from '../../plugins/reasoning/contracts.ts'
import type { NormalizedResearchSource } from '../../plugins/research-acquisition/contracts.ts'

const source = { candidate: { candidateId: 'filing', publishedAt: '2026-03-28' }, title: '2025年年度报告', content: '实际经营正文，产品销售给客户，现金回流；订单下降会导致收入减少。\n未引用的正文不应进入审查。' } as NormalizedResearchSource
const sections = [...COMPANY_CORE_SECTION_IDS.map((id) => ({ id, markdown: `${id} 实质分析与反证。[filing@paragraph:1]` })), { id: 'valuation', markdown: '研究缺口：缺少估值输入。' }]
const output = { sectionChecks: COMPANY_CORE_SECTION_IDS.map((sectionId) => ({ sectionId, questionAnswered: true, evidenceSupportsConclusion: true, numericReproducible: true, riskTransmission: true, reasons: [] as string[] })) }
const executor = (run: (request: any) => Promise<unknown>): ReasoningExecutor => ({ capabilities: () => ({ maxContextTokens: 100000, maxOutputTokens: 4000, maxConcurrency: 1, structuredOutputSupport: true }), execute: async (request) => ({ operation: request.operation, output: await run(request) }) })
const input = { company: { symbol: '002594' }, asOf: '2026-10-14', sources: [source], sections }

test('independent semantic review sends actual cited paragraphs and evaluates exact core sections, leaving optional gaps', async () => {
  const result = await reviewCompanyResearchSemantics({ ...input, reasoningExecutor: executor(async (request) => {
    assert.equal(request.metadata.stage, 'content_quality_review')
    assert.equal(request.operation, 'company_research_synthesis')
    assert.equal(request.input.sections.length, 16)
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
    assert.match(request.input.rubric.catalysts, /competitive_market_map/)
    assert.match(request.input.rubric.catalysts, /不得笼统声称“没有具名竞争对手\/产品路线”/)
    return output
  }) })
  assert.equal(result.passed, true)
  assert.equal(result.sectionChecks.length, 16)
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
  const result = await reviewCompanyResearchSemantics({ ...input, reasoningExecutor: executor(async (request) => { calls++; if(calls===2) assert.equal(request.input.repairPreviousOutput.sectionChecks.length,15); return calls === 1 ? { sectionChecks: output.sectionChecks.slice(0, 15) } : output }) })
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
  assert.throws(() => validateCompanySemanticQualityOutput({ sectionChecks: [...output.sectionChecks.slice(0, 15), output.sectionChecks[0]] }), /Duplicate/)
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


test('self-contradictory numeric rejection is repaired within the same two review calls rather than treated as substantive failure', async () => {
  const contradictory={sectionChecks:output.sectionChecks.map(check=>check.sectionId==='financial-quality'?{...check,numericReproducible:false,reasons:['同比与资产负债比率均可复算；此处数字无实质错误。']}:check)}
  let calls=0
  const result=await reviewCompanyResearchSemantics({...input,reasoningExecutor:executor(async request=>{
    calls++
    if(calls===2){assert.match(request.input.repairErrors[0].message,/Contradictory numeric rejection/);assert.match(request.input.repairErrors[0].message,/set numericReproducible=true/);assert.deepEqual(request.input.repairPreviousOutput,contradictory)}
    return calls===1?contradictory:output
  })})
  assert.equal(result.passed,true)
  assert.equal(result.attempts,2)
  assert.equal(result.attemptOutputs?.length,2)
  assert.equal(result.diagnostics[0]?.code,'FORMAT_ERROR')
  assert.throws(()=>validateCompanySemanticQualityOutput(contradictory),/Contradictory numeric rejection/)
  const realError={sectionChecks:output.sectionChecks.map(check=>check.sectionId==='financial-quality'?{...check,numericReproducible:false,reasons:['未见计算错误，但引用原文没有该科目，无法确认范围和单位。']}:check)}
  assert.equal(validateCompanySemanticQualityOutput(realError).find(check=>check.sectionId==='financial-quality')!.numericReproducible,false,'a concrete remaining evidence problem is not automatically waived')
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
  assert.equal(result.sectionChecks.length,16,'a review-format defect must not erase all substantive section results')
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
