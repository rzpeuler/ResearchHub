import test from 'node:test'
import assert from 'node:assert/strict'
import { selectCompanyEvidence, companyCitedSplitDateText, withCompanyEvidenceDateContext } from '../../skills/company-research/evidence.ts'
import { validateCompanyNumericGrounding } from '../../skills/company-research/numeric-grounding.ts'
import { bindCompanyMethodEvidenceContext, calculateCompanyTam, companyMethodOutputSchema, executeCompanyResearchMethod, validateCompanyMethodOutput } from '../../skills/company-research/methods.ts'
import { Ajv } from 'ajv'
import type { ReasoningExecutor } from '../../plugins/reasoning/contracts.ts'
import type { NormalizedResearchSource } from '../../plugins/research-acquisition/contracts.ts'
import { ReasoningExecutorError } from '../../plugins/reasoning/errors.ts'

const source: NormalizedResearchSource = {
  candidate: { candidateId: 'filing-1', title: '年报', kind: 'official_disclosure', tier: 1, provider: 'fixture' },
  retrievedAt: '2026-10-14', title: '年报', publisher: 'Company', contentHash: 'fixture',
  content: `${Array.from({ length: 250 }, (_, i) => `目录占位 ${i}`).join('\n')}\n核心产品业务收入及客户模式。\n关键产品技术与量产风险。`,
  rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false },
}
const output = { status: 'complete', answer: '公司历史有证据支持。', markdown: '公司经历业务转型。[filing-1@paragraph:251]', sections: [{ id: 'company-overview', markdown: '公司经历业务转型。[filing-1@paragraph:251]' }], findings: [{ text: '公司经历业务转型。', kind: 'fact', evidence: [{ sourceCandidateId: 'filing-1', location: 'paragraph:251' }] }], limitations: [], risks: [] }
const executor = (run: (request: unknown, signal?: AbortSignal) => Promise<unknown>): ReasoningExecutor => ({ capabilities: () => ({ maxContextTokens: 10000, maxOutputTokens: 4000, structuredOutputSupport: true, maxConcurrency: 2 }), execute: async (request, signal) => ({ operation: request.operation, output: await run(request, signal) }) })
test('governance selection retains remuneration table values and employee-plan implementation beyond generic biography headings', () => {
  const filing={...source,content:[...Array.from({length:300},()=> '董事会日常治理情况。'),'公司报告期内董事和高级管理人员报酬情况','单位：万元','姓名 性别 职务 从公司获得的','税前报酬总额','是否在关联方获取报酬','董事甲 男 董事长 813.90 否',...Array.from({length:25},()=> '其他一般描述。'),'员工持股计划中授予的股票进行第三期解锁并兑现奖金。'].join('\n')}
  const packet=selectCompanyEvidence([filing],['filing-1'],['董事','治理','报酬','激励'],{purpose:'management_governance_analysis'})[0]!
  const text=packet.excerpts.map(excerpt=>excerpt.text).join('\n')
  assert.match(text,/董事甲 男 董事长 813\.90 否/)
  assert.match(text,/单位：万元/)
  assert.match(text,/第三期解锁并兑现奖金/)
  assert.ok(packet.excerpts.length<=72)
})

test('date context binds supplied adjacent split dates and dated monetary continuations without lending unrelated years', () => {
  const content = '共同注册成立有限公司，于二\n零零二年六月十一日变更为股份有限公司。\n截至二零二五年末，累计研发投入2400亿\n元，全球累计申请专利超7.1万件。'
  const filing = { ...source, content }
  const packet = withCompanyEvidenceDateContext({ sourceCandidateId: 'filing-1', title: '年报', publisher: 'Company', excerpts: content.split('\n').map((text, index) => ({ sourceCandidateId: 'filing-1', location: `paragraph:${index + 1}`, text })) })
  assert.deepEqual(packet.excerpts[1]!.contextLocations, ['paragraph:1'])
  assert.deepEqual(packet.excerpts[3]!.contextLocations, ['paragraph:3'])
  const check = (text: string, rows = [packet]) => validateCompanyNumericGrounding({ markdown: text, sources: [filing], trustedText: companyCitedSplitDateText(text, rows) })
  assert.equal(check('2002年6月11日变更。[filing-1@paragraph:1] [filing-1@paragraph:2]').status, 'grounded')
  assert.equal(check('2018年6月11日变更。[filing-1@paragraph:1] [filing-1@paragraph:2]').status, 'unsupported_numbers')
  assert.equal(check('2002年变更。[filing-1@paragraph:2]').status, 'unsupported_numbers')
  assert.equal(check('2002年变更。[filing-1@paragraph:1] [filing-1@paragraph:2]', [{ ...packet, excerpts: packet.excerpts.slice(1) }]).status, 'unsupported_numbers')
  const nonAdjacent = { ...packet, excerpts: [packet.excerpts[0]!, { ...packet.excerpts[1]!, location: 'paragraph:3' }] }
  assert.deepEqual(companyCitedSplitDateText('2002年变更。[filing-1@paragraph:1] [filing-1@paragraph:3]', [nonAdjacent]), [])
  const bound = bindCompanyMethodEvidenceContext({ ...output, findings: [{ text: '截至2025年末申请专利超7.1万件。', kind: 'fact', evidence: [{ sourceCandidateId: 'filing-1', location: 'paragraph:4' }] }] } as ReturnType<typeof validateCompanyMethodOutput>, [packet])
  assert.ok(bound.findings[0]!.evidence.some((ref) => ref.location === 'paragraph:3'))
  assert.equal(check(`截至2025年末申请专利超7.1万件。 ${bound.findings[0]!.evidence.map((ref) => `[${ref.sourceCandidateId}@${ref.location}]`).join(' ')}`).status, 'grounded')
})

test('an unclosed PDF parenthesis binds only its actual supplied adjacent matching closing row', () => {
  const packet = { sourceCandidateId: 'filing-1', title: '年报', publisher: 'Company', excerpts: [
    { sourceCandidateId: 'filing-1', location: 'paragraph:8', text: '股份收购对价不超过6.29亿美元；ESOP（Employee Stock' },
    { sourceCandidateId: 'filing-1', location: 'paragraph:9', text: 'Option Program，员工期权激励计划，包含在收购方案中）权益收购对价不超过0.58亿美元。' },
  ] }
  assert.deepEqual(withCompanyEvidenceDateContext(packet).excerpts[0]!.contextLocations, ['paragraph:9'])
  assert.equal(withCompanyEvidenceDateContext({ ...packet, excerpts: packet.excerpts.slice(0, 1) }).excerpts[0]!.contextLocations, undefined)
  assert.equal(withCompanyEvidenceDateContext({ ...packet, excerpts: [packet.excerpts[0]!, { ...packet.excerpts[1]!, location: 'paragraph:10' }] }).excerpts[0]!.contextLocations, undefined)
  assert.equal(withCompanyEvidenceDateContext({ ...packet, excerpts: [packet.excerpts[0]!, { ...packet.excerpts[1]!, text: '独立事项，权益收购对价不超过0.58亿美元。' }] }).excerpts[0]!.contextLocations, undefined)
  assert.equal(withCompanyEvidenceDateContext({ ...packet, excerpts: [{ ...packet.excerpts[0]!, text: '已完整闭合（ESOP）。' }, packet.excerpts[1]!] }).excerpts[0]!.contextLocations, undefined)
})

test('summary and sections may cite distinct supplied locations from findings, but never unknown locations', async () => {
  const product = { ...source, candidate: { ...source.candidate, candidateId: 'product-page' }, content: '公司经历业务转型，形成产品技术能力。' }
  const packets = selectCompanyEvidence([source, product], ['filing-1', 'product-page'], ['产品'])
  const resultOutput = { ...output, markdown: '公司形成产品技术能力。[product-page@paragraph:1]', sections: [{ id: 'company-overview', markdown: '公司技术能力与业务相关。[filing-1@paragraph:252]' }] }
  assert.doesNotThrow(() => validateCompanyMethodOutput(resultOutput, packets))
  assert.throws(() => validateCompanyMethodOutput({ ...resultOutput, markdown: '公司形成产品能力。[product-page@paragraph:999]' }, packets), /REFERENCE:/)
  assert.throws(() => validateCompanyMethodOutput({ ...resultOutput, sections: [{ id: 'company-overview', markdown: '公司技术能力。[filing-1@paragraph:252-253]' }] }, packets), /REFERENCE:/)
  assert.throws(() => validateCompanyMethodOutput({ ...resultOutput, findings: [] }, packets), /findings/)
  const history = { ...source, content: '公司发展历史与业务转型。\n公司战略演变形成产品技术能力。' }
  const runtimeOutput = { ...resultOutput, sections: [{ id: 'company-overview', markdown: '公司战略演变形成产品能力。[filing-1@paragraph:2]' }], findings: [{ ...output.findings[0]!, evidence: [{ sourceCandidateId: 'filing-1', location: 'paragraph:1' }] }] }
  const result = await executeCompanyResearchMethod({ skillId: 'company_history_strategy', company: { symbol: '002594' }, asOf: '2026-10-14', sources: [history, product], reportSourceCandidateIds: ['filing-1', 'product-page'], reasoningExecutor: executor(async () => runtimeOutput) })
  assert.equal(result.status, 'complete', JSON.stringify(result.diagnostics))
  assert.deepEqual(new Set(result.sourceCandidateIds), new Set(['filing-1', 'product-page']))
})

test('observed historical web dates reach methods as context without inventing publication timestamps', () => {
  const historical = {...source,candidate:{...source.candidate,metadata:{observedPublicationDate:'2021-07-01',historicalSourceContext:{observedYear:2021,basis:'fetched_html_publication_meta',caution:'历史行业结构资料，不能代表本期排名。'}}}}
  const packet = selectCompanyEvidence([historical], ['filing-1'], ['产品'])[0]!
  assert.equal(packet.publishedAt, undefined)
  assert.equal(packet.observedPublicationDate, '2021-07-01')
  assert.equal(packet.historicalSourceContext?.observedYear, 2021)
})

test('company evidence scans late report body and preserves stable location while excluding context-only sources', () => {
  const packets = selectCompanyEvidence([source, { ...source, candidate: { ...source.candidate, candidateId: 'context-only' } }], ['filing-1'], ['产品'])
  assert.equal(packets.length, 1)
  assert.ok(packets[0]?.excerpts.some((excerpt) => excerpt.location === 'paragraph:251' && excerpt.text.includes('核心产品')))
})

test('company method invalid references cannot escape the two-attempt limit', async () => {
  let attempts = 0
  const result = await executeCompanyResearchMethod({ skillId: 'company_history_strategy', company: { symbol: '002594' }, asOf: '2026-10-14', sources: [source], durableSourceCandidateIds: ['filing-1'], reasoningExecutor: executor(async () => { attempts++; return attempts === 1 ? { ...output, findings: [{ ...output.findings[0], evidence: [{ sourceCandidateId: 'fabricated', location: 'paragraph:1' }] }] } : output }) })
  assert.equal(result.attempts, 2)
  assert.equal(result.status, 'failed')
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === 'REFERENCE_ERROR'))
})

test('company evidence can reach a late relevant sentence inside a long paragraph', () => {
  const oneParagraph = { ...source, content: `${'封面说明。'.repeat(1000)}重要产品技术和量产验证。` }
  const packets = selectCompanyEvidence([oneParagraph], ['filing-1'], ['产品'])
  assert.ok(packets[0]?.excerpts[0]?.text.includes('重要产品技术'))
  assert.equal(packets[0]?.excerpts[0]?.location, 'paragraph:1')
})

test('history evidence retains early founding event and adjacent year beyond recent strategic releases', () => {
  const timeline = { ...source, content: `2026\n发布智能化战略\n2025\n发布新平台\n${'导航菜单\n'.repeat(80)}1994\n\n公司在深圳成立，以充电电池起步。\n2003\n\n进入汽车行业。` }
  const packets = selectCompanyEvidence([timeline], ['filing-1'], ['战略', '成立', '历史'], { purpose: 'company_history_strategy' })
  const texts = packets[0]!.excerpts.map((excerpt) => excerpt.text)
  assert.ok(texts.includes('1994'))
  assert.ok(texts.some((text) => text.includes('充电电池起步')))
  assert.ok(texts.includes('2003'))
  assert.ok(texts.includes('进入汽车行业。'))
})

test('management evidence preserves biographical section spans over frequent numeric governance tables', () => {
  const paragraphs = [...Array.from({ length: 100 }, (_, i) => `董事管理股东表 ${i} 30000 40000 50000`), '公司现任董事、高级管理人员专业背景、主要工作经历以及目前职责', '董事长曾任技术研究员。', '其毕业于工程专业。', '副总裁负责供应链与运营。', '激励与经营目标挂钩。']
  const packets = selectCompanyEvidence([{ ...source, content: paragraphs.join('\n') }], ['filing-1'], ['董事', '管理', '股东'], { purpose: 'management_governance_analysis' })
  const texts = packets[0]!.excerpts.map((excerpt) => excerpt.text)
  assert.ok(texts.includes('其毕业于工程专业。'))
  assert.ok(texts.includes('副总裁负责供应链与运营。'))
})

test('TAM arithmetic is evidence-bound and refuses overlapping additive sizing', () => {
  const packets = selectCompanyEvidence([{ ...source, content: '市场客户数量 1000 个，平均价格 20 元。' }], ['filing-1'], ['市场'])
  const evidence = [{ sourceCandidateId: 'filing-1', location: 'paragraph:1' }]
  const input = { marketBoundary: '国内某产品年度销售市场', asOf: '2026-10-14', formula: 'multiply' as const, outputUnit: '元/年', overlapPolicy: 'single_market' as const, operands: [{ name: '客户数量', value: 1000, unit: '个/年', kind: 'fact' as const, evidence }, { name: '单价', value: 20, unit: '元/个', kind: 'fact' as const, evidence }] }
  assert.equal(calculateCompanyTam(input, packets).value, 20000)
  assert.throws(() => calculateCompanyTam({ ...input, formula: 'sum' }, packets), /non-overlapping/)
  assert.throws(() => calculateCompanyTam({ ...input, operands: [{ ...input.operands[0]!, value: 123456 }] }, packets), /number not found/)
})

test('company method format repair succeeds without degrading to a baseline', async () => {
  const history = { ...source, content: source.content.replace('核心产品业务收入及客户模式。', '核心产品业务收入及客户模式，战略转型历史。') }
  let attempts = 0
  const result = await executeCompanyResearchMethod({ skillId: 'company_history_strategy', company: { symbol: '002594' }, asOf: '2026-10-14', sources: [history], durableSourceCandidateIds: ['filing-1'], reasoningExecutor: executor(async () => { attempts++; return attempts === 1 ? 'invalid JSON' : output }) })
  assert.equal(result.status, 'complete')
  assert.equal(result.attempts, 2)
  assert.equal(result.diagnostics[0]?.code, 'FORMAT_ERROR')
  assert.deepEqual(result.attemptOutputs?.map(item => item.attempt), [1, 2])
  assert.ok(result.attemptOutputs?.every(item => item.executionEvidence?.some(packet => packet.excerpts.length > 0)))
  assert.equal(result.attemptOutputs?.[0]?.output, 'invalid JSON')
  assert.deepEqual(result.sections.map((section) => section.id), ['company-overview'])
})

test('numeric repair receives the actual prior draft and all bounded failing fields instead of regenerating blindly', async () => {
  const history = { ...source, content: '公司成立与战略转型，完成业务演变。' }
  const ref = { sourceCandidateId: 'filing-1', location: 'paragraph:1' }
  const broken = { ...output, answer: '公司增长345.67%。', markdown: '公司增长234.56%。[filing-1@paragraph:1]', sections: [{ id: 'company-overview', markdown: '公司增长123.45%。[filing-1@paragraph:1]' }], findings: [{ text: '公司增长456.78%。', kind: 'fact', evidence: [ref] }], limitations: ['补充资料有限。'] }
  const fixed = { ...broken, answer: '公司发生业务转型。', markdown: '公司发生业务转型。[filing-1@paragraph:1]', sections: [{ id: 'company-overview', markdown: '公司发生业务转型。[filing-1@paragraph:1]' }], findings: [{ text: '公司发生业务转型。', kind: 'fact', evidence: [ref] }] }
  let calls = 0
  const result = await executeCompanyResearchMethod({ skillId: 'company_history_strategy', company: { symbol: '002594' }, asOf: '2026-10-14', sources: [history], reportSourceCandidateIds: ['filing-1'], reasoningExecutor: executor(async (request) => {
    const requestInput = (request as any).input
    calls++
    if (calls === 1) { assert.equal('repairPreviousOutput' in requestInput, false); return broken }
    assert.equal(requestInput.repairPreviousOutput, broken)
    assert.deepEqual(new Set(requestInput.repairNumericIssues.map((issue: any) => issue.id)), new Set(['company-overview', 'method-summary', 'method-answer', 'finding-1']))
    assert.deepEqual(requestInput.repairTargets.map((target: any) => target.fieldPath), ['sections[0].markdown', 'markdown', 'answer', 'findings[0].text'])
    assert.equal(requestInput.repairTargets[0].originalText, broken.sections[0]!.markdown)
    assert.equal(requestInput.repairTargets[3].originalText, broken.findings[0]!.text)
    assert.equal(requestInput.repairTargets[3].issues[0].token, '456.78')
    for (const token of ['123.45', '234.56', '345.67', '456.78']) assert.ok(requestInput.repairErrors[0].message.includes(token))
    assert.match(requestInput.repairInstruction, /逐字保留未报错/)
    assert.match(requestInput.repairInstruction, /不得新增其他数字或主张/)
    assert.match(requestInput.repairInstruction, /每个数值各写明完整单位/)
    assert.match(requestInput.repairInstruction, /不能靠删掉整张表或专业分析/)
    return fixed
  }) })
  assert.equal(result.status, 'complete')
  assert.equal(result.attempts, 2)
  assert.equal(calls, 2)
  assert.deepEqual(result.limitations, broken.limitations)
})

test('a call that returned no raw output never fabricates a previous repair draft', async () => {
  const history = { ...source, content: source.content.replace('核心产品业务收入及客户模式。', '核心产品业务收入及客户模式，战略转型历史。') }
  let calls = 0
  const result = await executeCompanyResearchMethod({ skillId: 'company_history_strategy', company: { symbol: '002594' }, asOf: '2026-10-14', sources: [history], reportSourceCandidateIds: ['filing-1'], reasoningExecutor: executor(async (request) => {
    if (++calls === 1) throw new Error('temporary provider call failed')
    assert.equal('repairPreviousOutput' in (request as any).input, false)
    return output
  }) })
  assert.equal(result.status, 'complete')
  assert.equal(result.attempts, 2)
})

test('method input retains raw periods and code calculations without duplicating the raw financial table', async () => {
  const financialData = [{periodEnd:'2025-12-31',metrics:{revenue:2e8},pointInTimeSafe:false,pointInTimeStatus:'CURRENT_VALUE_ONLY' as const}]
  const preparedAnalysis = {financial:{table:financialData,financialDisplayAmounts:[{metric:'revenue',value:2}],financialReadableTable:'收入2.00亿元 [filing-1@paragraph:251]',growth:[{growthPercent:10}]}}
  let actualInput: any
  const history = {...source,content:source.content.replace('核心产品业务收入及客户模式。','核心产品业务收入及客户模式，战略转型历史。')}
  const result = await executeCompanyResearchMethod({skillId:'company_history_strategy',company:{symbol:'002594'},asOf:'2026-10-14',sources:[history],durableSourceCandidateIds:['filing-1'],financialData,preparedAnalysis,reasoningExecutor:executor(async request=>{actualInput=(request as any).input;return output})})
  assert.equal(result.status,'complete')
  assert.deepEqual(actualInput.structuredFinancialData,financialData)
  assert.equal(actualInput.preparedAnalysis.financial.table,undefined)
  assert.equal(actualInput.preparedAnalysis.financial.financialDisplayAmounts,undefined)
  assert.deepEqual(actualInput.preparedAnalysis.financial.growth,[{growthPercent:10}])
  assert.equal(preparedAnalysis.financial.table,financialData,'Do not mutate calculations used for validation or final audit')
  assert.deepEqual(result.attemptOutputs?.[0]?.preparedAnalysis,actualInput.preparedAnalysis)
})

test('company method cancellation prevents later retry or successful output', async () => {
  const controller = new AbortController()
  const result = await executeCompanyResearchMethod({ skillId: 'company_history_strategy', company: { symbol: '002594' }, asOf: '2026-10-14', sources: [source], durableSourceCandidateIds: ['filing-1'], signal: controller.signal, reasoningExecutor: executor(async () => { controller.abort(); return output }) })
  assert.equal(result.status, 'cancelled')
  assert.equal(result.attempts, 1)
  const preCancelled = await executeCompanyResearchMethod({ skillId: 'company_history_strategy', company: { symbol: '002594' }, asOf: '2026-10-14', sources: [source], signal: controller.signal })
  assert.equal(preCancelled.attempts, 0)
})

test('company method keeps quota failure distinct and does not repeat an exhausted account call', async () => {
  let calls = 0
  const result = await executeCompanyResearchMethod({ skillId: 'company_history_strategy', company: { symbol: '002594' }, asOf: '2026-10-14', sources: [source], durableSourceCandidateIds: ['filing-1'], reasoningExecutor: executor(async () => { calls++; throw new ReasoningExecutorError('reasoning_execution_failed', 'The usage limit has been reached', { failureClass: 'rate_limit_or_quota' }) }) })
  assert.equal(calls, 1)
  assert.equal(result.attempts, 1)
  assert.equal(result.diagnostics[0]?.code, 'RATE_LIMIT_OR_QUOTA')
})

test('company method repairs executor structured JSON errors and preserves numeric grounding failures', async () => {
  const history = { ...source, content: source.content.replace('核心产品业务收入及客户模式。', '核心产品业务收入及客户模式，战略转型历史。') }
  let calls = 0
  const result = await executeCompanyResearchMethod({ skillId: 'company_history_strategy', company: { symbol: '002594' }, asOf: '2026-10-14', sources: [history], durableSourceCandidateIds: ['filing-1'], reasoningExecutor: executor(async () => { calls++; if (calls === 1) throw new ReasoningExecutorError('reasoning_output_invalid', 'JSON Schema contract invalid'); return { ...output, sections: [{ id: 'company-overview', markdown: '公司未来收入增长45.5%。[filing-1@paragraph:251]' }] } }) })
  assert.equal(result.status, 'failed')
  assert.equal(result.diagnostics[0]?.code, 'FORMAT_ERROR')
  assert.equal(result.diagnostics[1]?.code, 'NUMERIC_GROUNDING_ERROR')
  assert.match(result.diagnostics[1]!.message, /45\.5/)
})

test('company method rejects fabricated locations and exact section ownership violations', () => {
  const packets = selectCompanyEvidence([source], ['filing-1'], ['产品'])
  assert.throws(() => validateCompanyMethodOutput({ ...output, findings: [{ ...output.findings[0], evidence: [{ sourceCandidateId: 'filing-1', location: 'paragraph:999' }] }] }, packets), /REFERENCE:/)
  assert.throws(() => validateCompanyMethodOutput(output, packets, ['products']), /owned section IDs/)
  assert.throws(() => validateCompanyMethodOutput({ ...output, sections: [{ id: 'company-overview', markdown: '无证据的概述。' }] }, packets), /Each complete owned section/)
  assert.throws(() => validateCompanyMethodOutput({ ...output, markdown: `${output.markdown} [filing-1@paragraph:251-252]` }, packets), /REFERENCE:/)
  assert.throws(() => validateCompanyMethodOutput({ ...output, sections: [{ id: 'company-overview', markdown: `${output.markdown} [filing-1@preparedAnalysis.growth]` }] }, packets), /REFERENCE:/)
})

test('operation-specific schema rejects source/locator cross-pairing and unowned section IDs', () => {
  const packets = selectCompanyEvidence([source], ['filing-1'], ['产品'])
  packets.push({ sourceCandidateId: 'another-source', title: '官网', publisher: 'Company', excerpts: [{ sourceCandidateId: 'another-source', location: 'paragraph:999', text: '公司业务资料。' }] })
  const validator = new Ajv({ strict: false }).compile(companyMethodOutputSchema('company_history_strategy', packets))
  assert.equal(validator(output), true)
  assert.equal(validator({ ...output, findings: [{ ...output.findings[0], evidence: [{ sourceCandidateId: 'filing-1', location: 'paragraph:999' }] }] }), false)
  assert.equal(validator({ ...output, sections: [{ id: 'products', markdown: output.markdown }] }), false)
})

test('method summary and findings cannot inject unvalidated numeric claims into final synthesis or Knowledge', async () => {
  const history = { ...source, content: source.content.replace('核心产品业务收入及客户模式。', '核心产品业务收入及客户模式，战略转型历史。') }
  const base = { skillId: 'company_history_strategy' as const, company: { symbol: '002594' }, asOf: '2026-10-14', sources: [history], durableSourceCandidateIds: ['filing-1'], maxAttempts: 1 as const }
  const summary = await executeCompanyResearchMethod({ ...base, reasoningExecutor: executor(async () => ({ ...output, markdown: '预计收入增长45.5%。[filing-1@paragraph:251]' })) })
  assert.equal(summary.status, 'failed')
  assert.match(summary.diagnostics[0]!.message, /method-summary/)
  const finding = await executeCompanyResearchMethod({ ...base, reasoningExecutor: executor(async () => ({ ...output, findings: [{ ...output.findings[0], text: '公司收入增长45.5%。' }] })) })
  assert.equal(finding.status, 'failed')
  assert.match(finding.diagnostics[0]!.message, /finding-1/)
})

test('validated timeline context binds event and standalone year without opening unrelated years', async () => {
  const timeline = { ...source, title: '公司发展历程', content: '2008\n\n• 推出双模电动车产品，正式商业化。\n2009\n\n• 进入客车行业。' }
  const packets = selectCompanyEvidence([timeline], ['filing-1'], ['产品', '商业化'], { purpose: 'company_history_strategy' })
  const original = { ...output, markdown: '2008年推出双模电动车。[filing-1@paragraph:3]', sections: [{ id: 'company-overview', markdown: '2008年推出双模电动车。[filing-1@paragraph:3]' }], findings: [{ text: '2008年推出双模电动车。', kind: 'fact', evidence: [{ sourceCandidateId: 'filing-1', location: 'paragraph:3' }] }] }
  const bound = bindCompanyMethodEvidenceContext(validateCompanyMethodOutput(original, packets), packets)
  assert.match(bound.sections[0]!.markdown, /\[filing-1@paragraph:1\]/)
  assert.ok(bound.findings[0]!.evidence.some((ref) => ref.location === 'paragraph:1'))
  assert.ok(!bound.findings[0]!.evidence.some((ref) => ref.location === 'paragraph:4'))
  const result = await executeCompanyResearchMethod({ skillId: 'company_history_strategy', company: { symbol: '002594' }, asOf: '2026-10-15', sources: [timeline], durableSourceCandidateIds: ['filing-1'], maxAttempts: 1, reasoningExecutor: executor(async () => original) })
  assert.equal(result.status, 'complete')
})

test('selected comparative table rows retain actually supplied year and unit headings', () => {
  const table = { ...source, content: '主营业务分析\n单位：元\n2025 年 2024 年\n金额 占比 金额 占比\n汽车收入 648645636000 80.68% 617381935000 79.45%\n其他收入 82794000 0.01% 111944000 0.01%' }
  const packets = selectCompanyEvidence([table], ['filing-1'], ['收入', '主营业务'], { purpose: 'business_model_map' })
  const row = packets[0]!.excerpts.find((excerpt) => excerpt.location === 'paragraph:5')!
  assert.ok(row.contextLocations?.includes('paragraph:2'))
  assert.ok(row.contextLocations?.includes('paragraph:3'))
  const original = { ...output, markdown: '2024年汽车收入占比79.45%。[filing-1@paragraph:5]', sections: [{ id: 'company-overview', markdown: '2024年汽车收入占比79.45%。[filing-1@paragraph:5]' }], findings: [{ text: '2024年汽车收入占比79.45%。', kind: 'fact', evidence: [{ sourceCandidateId: 'filing-1', location: 'paragraph:5' }] }] }
  const bound = bindCompanyMethodEvidenceContext(validateCompanyMethodOutput(original, packets), packets)
  assert.match(bound.markdown, /\[filing-1@paragraph:3\]/)
  assert.ok(!bound.findings[0]!.evidence.some((ref) => ref.location === 'paragraph:6'), 'other-row facts must not be borrowed')
})

test('character budgets preserve substantive early, middle and late evidence rather than an early-document prefix', () => {
  const paragraphs = Array.from({ length: 100 }, (_, index) => `无关目录 ${index}`)
  paragraphs[0] = `主营业务收入说明。${'产品收入与客户经营模式的历史背景。'.repeat(300)}`
  paragraphs[49] = '分产品收入：核心分部经营现金改善，业务组合与客户需求形成中期增长来源。'
  paragraphs[96] = '2025 年 2024 年'
  paragraphs[97] = '单位：元'
  paragraphs[98] = '分产品收入关键证据：海外核心分部收入100元，占收入20%，但产能利用率影响经营现金。'
  paragraphs[99] = '面临的风险：末页客户集中及价格压力会削弱核心分部利润，需要跟踪库存和回款。'
  const packets = selectCompanyEvidence([{ ...source, content: paragraphs.join('\n') }], ['filing-1'], ['主营业务', '分产品', '收入', '经营现金', '风险'], { purpose: 'business_model_map', maxCharacters: 1800 })
  const excerpts = packets[0]!.excerpts
  const combined = excerpts.map((excerpt) => excerpt.text).join('\n')
  assert.ok(combined.includes('主营业务收入说明'))
  assert.ok(combined.includes('中期增长来源'))
  assert.ok(combined.includes('海外核心分部收入100元'))
  assert.ok(combined.includes('末页客户集中'))
  assert.ok(excerpts.reduce((sum, excerpt) => sum + excerpt.text.length, 0) <= 1800)
  assert.ok(excerpts.some((excerpt) => excerpt.location === 'paragraph:99'))
  for (const excerpt of excerpts) for (const context of excerpt.contextLocations ?? []) assert.ok(excerpts.some((supplied) => supplied.location === context))
})

test('per-source and aggregate character limits hold with long relevant passages in several sources', () => {
  const sources = Array.from({ length: 4 }, (_, sourceIndex) => ({ ...source, candidate: { ...source.candidate, candidateId: `filing-${sourceIndex}` }, content: [`主营业务收入。${'经营分析。'.repeat(600)}`, ...Array.from({ length: 35 }, () => '目录'), '分产品收入与客户结构的重要后半部证据。'].join('\n') }))
  const packets = selectCompanyEvidence(sources, sources.map((item) => item.candidate.candidateId), ['收入', '业务', '客户'], { purpose: 'business_model_map', maxCharacters: 5000 })
  assert.ok(packets.reduce((sum, packet) => sum + packet.excerpts.reduce((subtotal, excerpt) => subtotal + excerpt.text.length, 0), 0) <= 5000)
  for (const packet of packets) assert.ok(packet.excerpts.reduce((sum, excerpt) => sum + excerpt.text.length, 0) <= 3000)
  assert.ok(packets.every((packet) => packet.excerpts.some((excerpt) => excerpt.text.includes('后半部证据'))))
})

test('purpose query families retain late split financial tables and governance evidence before generic headings', () => {
  const lines = Array.from({ length: 1600 }, (_, index) => `主营业务经营模式与研发投资分析 ${index}。`.repeat(3))
  const insert = (index: number, rows: string[]) => rows.forEach((row, offset) => { lines[index + offset] = row })
  insert(600, ['单位：元', '营业收入 营业成本 毛利率 营业收入比上', '年同期增减', '营业成本比上', '年同期增减', '毛利率比上', '年同期增减', '分产品', '核心产品、配套', '及其他产品', '145,000,000.00 100,000,000.00 31.03% 5.06% 7.53% -1.82%', '第二类产品 60,000,000.00 50,000,000.00 16.67%'])
  insert(900, ['公司主要销售客户情况', '前五名客户合计销售金额（元） 145,648,095,000.00', '前五名客户合计销售金额占年度销售总额比例 18.12%', '公司主要供应商情况', '前五名供应商合计采购金额占年度采购总额比例 15.31%'])
  insert(1100, ['公司研发投入情况', '2025 年 2024 年 变动比例', '研发投入金额（元） 63,441,379,000.00 54,160,964,000.00 17.13%', '研发投入资本化的金额（元） 5,463,274,000.00 966,219,000.00 465.43%', '资本化研发投入占研发投入的比例 8.61% 1.78% 6.83%'])
  insert(1250, ['单位：元', '2025 年 2024 年', '在建工程 48,293,781,000.00 19,954,343,000.00'])
  insert(1400, ['管理层主要工作经历', '董事长毕业后从事材料研究，曾任制造公司总经理，现任本公司董事长。', '股东持股比例', '第一大股东持股比例为17.06%。'])
  insert(1450, ['主要股东', '甲某 境内自然人 16.53% 302,781,254', '乙某 境内自然人 13.51% 247,526,917'])
  insert(1470, ['上述股东关联关系或一致行动的说明', '上述股东甲某、乙某系兄弟，二人为公司的实际控制人。'])
  const filing = { ...source, content: lines.join('\n') }
  const financial = selectCompanyEvidence([filing], ['filing-1'], ['主营业务', '研发', '投资'], { purpose: 'financial_quality_analysis', maxCharacters: 3000 })[0]!
  for (const index of [601, 602, 608, 609, 610, 611, 902, 903, 1102, 1104, 1105, 1251, 1252, 1253]) assert.ok(financial.excerpts.some((row) => row.location === `paragraph:${index}`), `missing exact late table row ${index}`)
  assert.ok(financial.excerpts.length <= 72)
  assert.ok(financial.excerpts.reduce((sum, row) => sum + row.text.length, 0) <= 3000)
  const management = selectCompanyEvidence([filing], ['filing-1'], ['董事', '研发'], { purpose: 'management_governance_analysis', maxCharacters: 3000 })[0]!
  assert.ok(management.excerpts.some((row) => row.location === 'paragraph:1402' && row.text.includes('材料研究')))
  assert.ok(management.excerpts.some((row) => row.location === 'paragraph:1452' && row.text.includes('16.53%')))
  assert.ok(management.excerpts.some((row) => row.location === 'paragraph:1453' && row.text.includes('13.51%')))
  assert.ok(management.excerpts.some((row) => row.location === 'paragraph:1472' && row.text.includes('兄弟')))
  const product = selectCompanyEvidence([filing], ['filing-1'], ['产品', '研发'], { purpose: 'product_technology_analysis', maxCharacters: 3000 })[0]!
  assert.ok(product.excerpts.some((row) => row.location === 'paragraph:611' && row.text.includes('31.03%')))
})

test('business and capital evidence preserves actual revenue recognition and current acquisition cost spans', () => {
  const lines = Array.from({ length: 1200 }, (_, index) => `主营业务资本投入介绍 ${index}。`)
  const rows = ['3. 收入确认的具体方法', '本公司主要销售制造产品。', '内销收入在货物交付合同地点并由客户确认接受后，', '且已收取价款或取得收款权利时确认。外销收入取得出口报关单和货运提单，', '相关经济利益很可能流入时确认。']
  rows.forEach((row, index) => { lines[800 + index] = row })
  const acquisition = ['收购甲公司100%股份，股份收购对价不超过6.29亿美元。', '本年取得乙公司控制权。', '（2）合并成本及商誉', '单位：元', '合并成本 乙公司 甲公司', '--现金 23.87 4,358,975,888.59', '--发行或承担的债务的公允价值 509,852,329.73', '--其他', '合并成本合计 509,852,353.60 4,358,975,888.59', '甲公司合并成本为购买日取得控制权而支付及待支付的现金。']
  acquisition.forEach((row, index) => { lines[1100 + index] = row })
  const filing = { ...source, content: lines.join('\n') }
  const business = selectCompanyEvidence([filing], ['filing-1'], ['主营业务'], { purpose: 'business_model_map', maxCharacters: 3000 })[0]!
  for (const row of [801, 803, 804, 805]) assert.ok(business.excerpts.some((excerpt) => excerpt.location === `paragraph:${row}`))
  const capital = selectCompanyEvidence([filing], ['filing-1'], ['资本'], { purpose: 'capital_allocation_review', maxCharacters: 3000 })[0]!
  for (const row of [1101, 1104, 1105, 1109, 1110]) assert.ok(capital.excerpts.some((excerpt) => excerpt.location === `paragraph:${row}`))
  assert.ok(capital.excerpts.length <= 72)
  assert.ok(capital.excerpts.reduce((sum, row) => sum + row.text.length, 0) <= 3000)
})

test('driver and business context preserves complete production-sales notes and channel/geographic rows', () => {
  const lines = Array.from({ length: 900 }, (_, index) => `主营业务发展及研发分析${index}。`)
  const put = (start: number, rows: string[]) => rows.forEach((text, index) => { lines[start + index] = text })
  put(100, ['整车产品产销情况', '快报产量 快报销量', '本报告期 上年同期 与上年同比增减'])
  put(600, ['产品类别 产能状况 快报产量 快报销量 销售收入（元）', '乘用车 4,479,392 4,479,392 4,545,423 541,917,643,000.00', '商用车 57,964 57,964 57,013 11,780,683,000.00', '注：产能状况指报告期产量，单位为辆。'])
  put(800, ['分地区', '境外 310,740,988,000.00 38.65%', '分销售模式', '直销 367,210,862,000.00 45.67%', '经销 436,754,096,000.00 54.33%'])
  const filing = { ...source, content: lines.join('\n') }
  const driver = selectCompanyEvidence([filing], ['filing-1'], ['主营业务', '研发'], { purpose: 'business_driver_analysis', maxCharacters: 3000 })[0]!
  for (const row of [601, 602, 603, 604, 801, 802, 803, 804, 805]) assert.ok(driver.excerpts.some((excerpt) => excerpt.location === `paragraph:${row}`))
  const business = selectCompanyEvidence([filing], ['filing-1'], ['主营业务'], { purpose: 'business_model_map', maxCharacters: 3000 })[0]!
  assert.ok(business.excerpts.some((row) => row.location === 'paragraph:805' && row.text.includes('54.33%')))
})
