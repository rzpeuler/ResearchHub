import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { selectCompanyEvidence, companyCitedSplitDateText, withCompanyEvidenceDateContext } from '../../skills/company-research/evidence.ts'
import { validateCompanyNumericGrounding } from '../../skills/company-research/numeric-grounding.ts'
import { bindCompanyMethodEvidenceContext, calculateCompanyTam, companyMethodOutputSchema, COMPANY_METHOD_METHODOLOGY, executeCompanyResearchMethod, validateCompanyMethodOutput } from '../../skills/company-research/methods.ts'
import { Ajv } from 'ajv'
import type { ReasoningExecutor } from '../../plugins/reasoning/contracts.ts'
import type { NormalizedResearchSource } from '../../plugins/research-acquisition/contracts.ts'
import { PiReasoningExecutor } from '../../plugins/reasoning/pi/executor.ts'
import { ReasoningExecutorError, summarizeReasoningFailure } from '../../plugins/reasoning/errors.ts'
import { repairUnavailableCompanyMethodCitations } from '../../skills/company-research/citation-repair.ts'

const source: NormalizedResearchSource = {
  candidate: { candidateId: 'filing-1', title: '年报', kind: 'official_disclosure', tier: 1, provider: 'fixture' },
  retrievedAt: '2026-10-14', title: '年报', publisher: 'Company', contentHash: 'fixture',
  content: `${Array.from({ length: 250 }, (_, i) => `目录占位 ${i}`).join('\n')}\n核心产品业务收入及客户模式。\n关键产品技术与量产风险。`,
  rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false },
}
const output = { status: 'complete', answer: '公司历史有证据支持。', markdown: '公司经历业务转型。[filing-1@paragraph:251]', sections: [{ id: 'company-overview', markdown: '公司经历业务转型。[filing-1@paragraph:251]' }], findings: [{ text: '公司经历业务转型。', kind: 'fact', evidence: [{ sourceCandidateId: 'filing-1', location: 'paragraph:251' }] }], limitations: [], risks: [] }
const executor = (run: (request: unknown, signal?: AbortSignal) => Promise<unknown>): ReasoningExecutor => ({ capabilities: () => ({ maxContextTokens: 10000, maxOutputTokens: 4000, structuredOutputSupport: true, maxConcurrency: 2 }), execute: async (request, signal) => ({ operation: request.operation, output: await run(request, signal) }) })

test('citation repair resolves a malformed source id only from a unique same-claim source and exact supplied locator', () => {
  const sourceId = 'official-f7c8d23d2829a5e8'
  const malformedId = 'official-f7c8d2829a5e8'
  const lines = Array<string>(788).fill('')
  lines[784] = '领汽车行业智能化变革。本集团凭借在汽车电动化、智能化等关键领域的核心技术，实现新能源汽车在安全保护、动力性能和能源消费等方面的多重跨越，加速推动全球汽车产业转型升级进程。'
  lines[786] = '在已建立起全球领先的技术优势的基础之上，本集团积极布局产业链关键环节，具备显著的成本优势。为满足日益增长'
  lines[787] = '增长的产品需求，本集团快速提升整车及关键零部件领域产能，亦建立起领先的规模优势。此外，强大的工程化能力亦'
  const content = lines.join('\n')
  const filing = { ...source, candidate: { ...source.candidate, candidateId: sourceId }, content }
  const packet = { sourceCandidateId: sourceId, title: '2025年年度报告', publisher: 'CNINFO', excerpts: [
    { sourceCandidateId: sourceId, location: 'paragraph:785', text: lines[784]! },
    { sourceCandidateId: sourceId, location: 'paragraph:787', text: lines[786]! },
    { sourceCandidateId: sourceId, location: 'paragraph:788', text: lines[787]! },
  ] }
  const input = { company: { symbol: '002594' }, asOf: '2026-10-18', sources: [filing] } as any

  const markdownOutput = { markdown: `公司报告称产品需求增长并提升产能，也称汽车产品在安全、动力和能源消费方面取得进展；这是公司陈述，不能作为客户偏好或独立测试事实。现有资料没有消费者调查、客户反馈或购买行为的专门证据，因此客户对安全、动力、能耗、成本及车型选择的实际权重未有调研/反馈验证。[${sourceId}@paragraph:785] [${sourceId}@paragraph:787] [${malformedId}@paragraph:788]`, sections: [], findings: [] }
  const markdownResult = repairUnavailableCompanyMethodCitations(markdownOutput, [packet], input)
  assert.equal(markdownResult.repairs.length, 1)
  assert.deepEqual(markdownResult.repairs[0]!.addedReferences, [{ sourceCandidateId: sourceId, location: 'paragraph:788' }])
  assert.equal(markdownResult.output.markdown, markdownOutput.markdown.replace(`[${malformedId}@paragraph:788]`, `[${sourceId}@paragraph:788]`))

  const findingOutput = { markdown: '', sections: [], findings: [{ text: '公司称新能源汽车产品在安全、动力和能源消费方面取得进展，但这些属于公司披露，不是独立客户偏好证据。', kind: 'fact', evidence: [
    { sourceCandidateId: sourceId, location: 'paragraph:785' },
    { sourceCandidateId: malformedId, location: 'paragraph:787' },
  ] }] }
  const findingResult = repairUnavailableCompanyMethodCitations(findingOutput, [packet], input)
  assert.deepEqual(findingResult.output.findings[0]!.evidence, [
    { sourceCandidateId: sourceId, location: 'paragraph:785' },
    { sourceCandidateId: sourceId, location: 'paragraph:787' },
  ])
  assert.ok(findingResult.repairs.some(repair => repair.addedReferences.some(ref => ref.sourceCandidateId === sourceId && ref.location === 'paragraph:787')))

  const unsupportedOutput = { markdown: `消费者偏爱轻薄笔记本电脑。[${sourceId}@paragraph:785] [${malformedId}@paragraph:788]`, sections: [], findings: [] }
  const unsupported = repairUnavailableCompanyMethodCitations(unsupportedOutput, [packet], input)
  assert.equal(unsupported.output.markdown, unsupportedOutput.markdown, 'a unique source anchor does not repair an excerpt with no meaningful claim overlap')
  assert.equal(unsupported.repairs.length, 0)

  const ambiguousPacket = { ...packet, sourceCandidateId: 'other-report', title: '另一份报告', excerpts: packet.excerpts.map(excerpt => ({ ...excerpt, sourceCandidateId: 'other-report' })) }
  const ambiguousOutput = { markdown: '工程化能力支持未来发展。[official-f7c8d2829a5e8@paragraph:788]', sections: [], findings: [] }
  const ambiguous = repairUnavailableCompanyMethodCitations(ambiguousOutput, [packet, ambiguousPacket], { ...input, sources: [filing, { ...filing, candidate: { ...filing.candidate, candidateId: 'other-report' }, title: '另一份报告' }] } as any)
  assert.equal(ambiguous.output.markdown, ambiguousOutput.markdown, 'ambiguous paragraph collisions remain untouched')
  assert.equal(ambiguous.repairs.length, 0)
})
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

test('history answer years reuse only one independently grounded finding with exact supplied locators', async () => {
  const history = { ...source, content: [
    '1995年2月，王传福与吕向阳共同注册成立深圳市比亚迪实业有限公司。',
    '2002年6月11日，该主体整体变更设立比亚迪股份有限公司。',
    '另有报道声称比亚迪于1994年创立。',
    '公司随后发展新能源汽车业务。',
  ].join('\n') }
  const refs = [1, 2, 3].map(location => ({ sourceCandidateId: 'filing-1', location: `paragraph:${location}` }))
  const numericHistoryOutput = {
    ...output,
    answer: '创业起点有不同口径：1995年共同注册前身，2002年整体变更为股份公司，另有报道指1994年创立。',
    markdown: '公司由电池业务发展至新能源汽车。[filing-1@paragraph:4]',
    sections: [{ id: 'company-overview', markdown: '公司由电池业务发展至新能源汽车。[filing-1@paragraph:4]' }],
    findings: [{ text: '公司前身于1995年共同注册，2002年整体变更为股份公司；另有报道指1994年创立，但该报道口径不能替代法定主体沿革。', kind: 'fact', evidence: refs }],
  }
  const result = await executeCompanyResearchMethod({ skillId: 'company_history_strategy', company: { symbol: '002594' }, asOf: '2026-10-14', sources: [history], reportSourceCandidateIds: ['filing-1'], reasoningExecutor: executor(async () => numericHistoryOutput) })
  assert.equal(result.status, 'complete', JSON.stringify(result.diagnostics))
  assert.match(result.answer, /\[filing-1@paragraph:1\]/)
  assert.match(result.answer, /\[filing-1@paragraph:2\]/)
  assert.match(result.answer, /\[filing-1@paragraph:3\]/)
  assert.equal(result.diagnostics.some(item => item.code === 'NUMERIC_GROUNDING_ERROR'), false)
})

test('history answer year binding fails closed when multiple findings could support the same years', async () => {
  const history = { ...source, content: '1995年创立前身公司。\n2002年整体变更设立股份公司。\n公司发展新能源汽车业务。' }
  const yearFinding = { text: '1995年创立前身公司，2002年整体变更设立股份公司。', kind: 'fact', evidence: [{ sourceCandidateId: 'filing-1', location: 'paragraph:1' }, { sourceCandidateId: 'filing-1', location: 'paragraph:2' }] }
  const duplicateOutput = {
    ...output,
    answer: '公司前身于1995年创立，2002年整体变更为股份公司。',
    markdown: '公司发展新能源汽车业务。[filing-1@paragraph:3]',
    sections: [{ id: 'company-overview', markdown: '公司发展新能源汽车业务。[filing-1@paragraph:3]' }],
    findings: [yearFinding, { ...yearFinding }],
  }
  const result = await executeCompanyResearchMethod({ skillId: 'company_history_strategy', company: { symbol: '002594' }, asOf: '2026-10-14', sources: [history], reportSourceCandidateIds: ['filing-1'], maxAttempts: 1, reasoningExecutor: executor(async () => duplicateOutput) })
  assert.equal(result.status, 'failed')
  assert.equal(result.answer, '', JSON.stringify(result.diagnostics))
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

test('nested markdown citation brackets from model output normalize to supplied inline references', () => {
  const nested = { ...output, markdown: '公司经历业务转型。[[filing-1@paragraph:251]]', sections: [{ id: 'company-overview', markdown: '公司经历业务转型。[[filing-1@paragraph:251]]' }] }
  const packet = { sourceCandidateId: 'filing-1', title: '年报', publisher: 'Company', excerpts: [{ sourceCandidateId: 'filing-1', location: 'paragraph:251', text: '公司经历业务转型。' }] }
  const result = validateCompanyMethodOutput(nested, [packet])
  assert.equal(result.markdown, '公司经历业务转型。[filing-1@paragraph:251]')
  assert.equal(result.sections[0]!.markdown, '公司经历业务转型。[filing-1@paragraph:251]')
})

test('Chinese citation brackets normalize only exact supplied locators to inline references', () => {
  const packet = { sourceCandidateId: 'filing-1', title: '年报', publisher: 'Company', excerpts: [{ sourceCandidateId: 'filing-1', location: 'paragraph:251', text: '公司经历业务转型。' }] }
  const chinese = { ...output, markdown: '公司经历业务转型。〔filing-1@paragraph:251〕', sections: [{ id: 'company-overview', markdown: '公司经历业务转型。〔filing-1@paragraph:251〕' }] }
  const normalized = validateCompanyMethodOutput(chinese, [packet])
  assert.equal(normalized.markdown, '公司经历业务转型。[filing-1@paragraph:251]')
  assert.equal(normalized.sections[0]!.markdown, '公司经历业务转型。[filing-1@paragraph:251]')
  const unknown = { ...chinese, markdown: '公司经历业务转型。〔filing-1@paragraph:999〕', sections: [{ id: 'company-overview', markdown: '公司经历业务转型。〔filing-1@paragraph:999〕' }] }
  assert.throws(() => validateCompanyMethodOutput(unknown, [packet]), /Each complete owned section requires an inline citation/)
})

test('grouped exact paragraph locators normalize to separate supplied inline citations', () => {
  const packet = { sourceCandidateId: 'filing-1', title: '年报', publisher: 'Company', excerpts: [
    { sourceCandidateId: 'filing-1', location: 'paragraph:251', text: '公司经历业务转型。' },
    { sourceCandidateId: 'filing-1', location: 'paragraph:252', text: '公司形成新业务分部。' },
  ] }
  const grouped = { ...output, markdown: '公司经历转型并形成新分部。[filing-1@paragraph:251; filing-1@paragraph:252]', sections: [{ id: 'company-overview', markdown: '公司经历转型并形成新分部。[filing-1@paragraph:251; filing-1@paragraph:252]' }] }
  const normalized = validateCompanyMethodOutput(grouped, [packet])
  assert.equal(normalized.markdown, '公司经历转型并形成新分部。[filing-1@paragraph:251] [filing-1@paragraph:252]')
  assert.equal(normalized.sections[0]!.markdown, normalized.markdown)
  assert.throws(() => validateCompanyMethodOutput({ ...grouped, markdown: '公司经历转型。[filing-1@paragraph:251; filing-1@paragraph:999]' }, [packet]), /REFERENCE: Grouped inline citation contains a locator not supplied/)
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

test('competitive analysis permits a bounded one-peer segment comparison only with localized gaps', () => {
  const question = COMPANY_METHOD_METHODOLOGY.competitive_market_map.questions
  assert.match(question, /只支持一个具名竞争者或替代路线/)
  assert.match(question, /其他细分市场逐项标为缺少的具名对手或同口径输入及其影响/)
  assert.match(question, /没有任何有证据的公司\/产品\/路线比较，必须标记insufficient_evidence/)
})

test('market-structure method separates reported global industry forecast context from unavailable company TAM', () => {
  const question = COMPANY_METHOD_METHODOLOGY.market_structure_analysis.questions
  assert.match(question, /“行业规模背景”/)
  assert.match(question, /预测机构/)
  assert.match(question, /不能因公司级TAM输入不足而省略/)
  assert.match(question, /不相加，不推断公司份额/)
})

test('company history distinguishes predecessor, incorporation, listing, and the financial observation window', () => {
  const question = COMPANY_METHOD_METHODOLOGY.company_history_strategy.questions
  assert.match(question, /股份制整体变更及股份公司登记日期/)
  assert.match(question, /股票挂牌日期也要单独说明/)
  assert.match(question, /最早可用期间只代表数据窗口/)
  assert.match(question, /不能用结构化财务数据代替沿革证据/)
  assert.match(COMPANY_METHOD_METHODOLOGY.market_structure_analysis.questions, /列名为“同比增减（%）”/)
  assert.match(COMPANY_METHOD_METHODOLOGY.market_structure_analysis.questions, /相邻而非直接可比市场/)
  assert.match(COMPANY_METHOD_METHODOLOGY.financial_quality_analysis.questions, /不得称“上年同期”或余额同比/)
  assert.match(COMPANY_METHOD_METHODOLOGY.company_risk_analysis.questions, /禁止称“未提供治理结构或内控意见”/)
  assert.match(COMPANY_METHOD_METHODOLOGY.company_risk_analysis.questions, /不得对其他客户比例求和、做心算差值/)
  assert.match(COMPANY_METHOD_METHODOLOGY.company_risk_analysis.questions, /每个金额都须紧邻重复币种及单位/)
  assert.match(COMPANY_METHOD_METHODOLOGY.product_technology_analysis.questions, /必须引用同一条实际包含该标签的证据段落/)
  assert.match(COMPANY_METHOD_METHODOLOGY.capital_allocation_review.questions, /不得输出裸小数/)
  assert.match(COMPANY_METHOD_METHODOLOGY.capital_allocation_review.questions, /原表将原因说明标为不适用/)
  assert.match(COMPANY_METHOD_METHODOLOGY.capital_allocation_review.questions, /每个金额、比率、期间都必须在该行或对应单元格紧邻引用/)
  assert.match(COMPANY_METHOD_METHODOLOGY.company_history_strategy.questions, /“共同注册成立”前身企业/)
  assert.match(COMPANY_METHOD_METHODOLOGY.company_history_strategy.questions, /不得再称前身首次设立年份未披露/)
  assert.match(COMPANY_METHOD_METHODOLOGY.business_driver_analysis.questions, /任何包含数字的finding都要在该finding自身引用数据行/)
})

test('history and product skills require dated, source-bound milestones and concrete official catalog examples', async () => {
  const historyMethodology = readFileSync(new URL('../../skills/company_history_strategy/SKILL.md', import.meta.url), 'utf8')
  const productMethodology = readFileSync(new URL('../../skills/product_technology_analysis/SKILL.md', import.meta.url), 'utf8')
  assert.match(historyMethodology, /有明确日期的里程碑.*按时间顺序组织为阶段/s)
  assert.match(historyMethodology, /只有原文同时支持事件和日期时才报告该事件/)
  assert.match(historyMethodology, /区分“宣布\/规划”.*“量产\/持续销售”/s)
  assert.match(historyMethodology, /标为发行人陈述.*独立来源能够佐证/s)
  assert.match(historyMethodology, /可能的传导机制、替代解释及缺失指标/)
  assert.match(productMethodology, /官方产品目录、产品\/发布页面或官方价格资料.*具体产品、车型或型号/s)
  assert.match(productMethodology, /产品\/型号、应用或产品定位.*价格、规格或性能和商业化阶段/s)
  assert.match(productMethodology, /研发、样机、认证\/客户导入、发布、交付、批量出货和持续销售不能互换/)
  assert.match(productMethodology, /不得从产品规格、公司定位、宣传材料或通用常识推断客户偏好/)
  assert.match(productMethodology, /必须逐项绑定本次材料中实际包含该字段的 `sourceCandidateId` 和段落位置/)

  const datedHistory = { ...source, content: '1995年，公司共同注册成立前身企业。\n2003年，公司进入汽车业务。' }
  const historyOutput = {
    ...output,
    markdown: '1995年共同注册成立前身企业，2003年进入汽车业务。[filing-1@paragraph:1] [filing-1@paragraph:2]',
    sections: [{ id: 'company-overview', markdown: '1995年共同注册成立前身企业，2003年进入汽车业务。[filing-1@paragraph:1] [filing-1@paragraph:2]' }],
    findings: [
      { text: '1995年共同注册成立前身企业。', kind: 'fact', evidence: [{ sourceCandidateId: 'filing-1', location: 'paragraph:1' }] },
      { text: '2003年进入汽车业务。', kind: 'fact', evidence: [{ sourceCandidateId: 'filing-1', location: 'paragraph:2' }] },
    ],
  }
  let dispatchedHistory: any
  const historyResult = await executeCompanyResearchMethod({ skillId: 'company_history_strategy', company: { symbol: '002594' }, asOf: '2026-10-19', sources: [datedHistory], durableSourceCandidateIds: ['filing-1'], methodology: historyMethodology, reasoningExecutor: executor(async request => { dispatchedHistory = request; return historyOutput }) })
  assert.equal(historyResult.status, 'complete', JSON.stringify(historyResult.diagnostics))
  assert.equal(dispatchedHistory.input.canonicalMethodology, historyMethodology)

  const catalog = { ...source, candidate: { ...source.candidate, candidateId: 'official-catalog' }, content: '官方产品目录\n2026款车型甲，官方指导价人民币12.8万元，CLTC续航520公里。\n该车型已于2026年3月上市。' }
  const productClaim = '官方目录列出2026款车型甲，指导价为人民币12.8万元，CLTC续航520公里；公司称该车型于2026年3月上市。[official-catalog@paragraph:2] [official-catalog@paragraph:3]'
  const productOutput = {
    ...output,
    markdown: productClaim,
    sections: ['products', 'technologies'].map(id => ({ id, markdown: productClaim })),
    findings: [{ text: '官方目录列出2026款车型甲，指导价为人民币12.8万元，CLTC续航520公里。', kind: 'fact', evidence: [{ sourceCandidateId: 'official-catalog', location: 'paragraph:2' }] }],
  }
  let dispatchedProduct: any
  const productResult = await executeCompanyResearchMethod({ skillId: 'product_technology_analysis', company: { symbol: '002594' }, asOf: '2026-10-19', sources: [catalog], durableSourceCandidateIds: ['official-catalog'], methodology: productMethodology, reasoningExecutor: executor(async request => { dispatchedProduct = request; return productOutput }) })
  assert.equal(productResult.status, 'complete', JSON.stringify(productResult.diagnostics))
  assert.equal(dispatchedProduct.input.canonicalMethodology, productMethodology)

  const unsupportedPriceOutput = {
    ...productOutput,
    markdown: productClaim.replace('12.8万元', '10.8万元'),
    sections: ['products', 'technologies'].map(id => ({ id, markdown: productClaim.replace('12.8万元', '10.8万元') })),
    findings: [{ text: '官方目录列出2026款车型甲，指导价为人民币10.8万元，CLTC续航520公里。', kind: 'fact', evidence: [{ sourceCandidateId: 'official-catalog', location: 'paragraph:2' }] }],
  }
  const unsupportedPrice = await executeCompanyResearchMethod({ skillId: 'product_technology_analysis', company: { symbol: '002594' }, asOf: '2026-10-19', sources: [catalog], durableSourceCandidateIds: ['official-catalog'], maxAttempts: 1, methodology: productMethodology, reasoningExecutor: executor(async () => unsupportedPriceOutput) })
  assert.equal(unsupportedPrice.status, 'failed')
  assert.ok(unsupportedPrice.diagnostics.some(diagnostic => diagnostic.code === 'NUMERIC_GROUNDING_ERROR'))
})

test('peer-company web evidence is restricted to the competitive method', () => {
  const peer = { ...source, candidate: { ...source.candidate, candidateId: 'peer-pengding', metadata: { researchSubject: 'peer_company', peerCompanyName: '鹏鼎控股' } }, title: '鹏鼎控股年报', content: '鹏鼎控股披露FPC客户、产品收入、产能及经营结果。' }
  const all = [source, peer]
  assert.equal(selectCompanyEvidence(all, ['filing-1', 'peer-pengding'], ['FPC', '客户'], { purpose: 'product_technology_analysis' }).some(packet => packet.sourceCandidateId === 'peer-pengding'), false)
  assert.equal(selectCompanyEvidence(all, ['filing-1', 'peer-pengding'], ['FPC', '客户'], { purpose: 'competitive_market_map' }).some(packet => packet.sourceCandidateId === 'peer-pengding'), true)
})

test('competitive evidence selection retains late peer product and technology specifics', () => {
  const peer = { ...source, candidate: { ...source.candidate, candidateId: 'peer-optical', metadata: { researchSubject: 'peer_company', peerCompanyName: '中际旭创' } }, title: '中际旭创产品组合', content: [...Array.from({ length: 310 }, (_, i) => `常规公司介绍材料 ${i}`), 'Complete Optical Transceiver Product Portfolio for AI and Data Center Networking', '推出800G ZR/ZR+相干光收发模块', '发布1.6T OSFP-XD DR8+光模块，提供低功耗方案。'].join('\n') }
  const all = [source, peer]
  const competition = selectCompanyEvidence(all, ['filing-1', 'peer-optical'], ['竞争', '800G', '1.6T', '产品'], { purpose: 'competitive_market_map' })
  const peerPacket = competition.find(packet => packet.sourceCandidateId === 'peer-optical')
  assert.ok(peerPacket)
  const selected = peerPacket.excerpts.map(excerpt => `${excerpt.location} ${excerpt.text}`).join('\n')
  assert.match(selected, /Complete Optical Transceiver Product Portfolio/)
  assert.match(selected, /800G ZR\/ZR\+/)
  assert.match(selected, /1\.6T OSFP-XD DR8\+/)
  assert.equal(selectCompanyEvidence(all, ['filing-1', 'peer-optical'], ['800G', '1.6T', '产品'], { purpose: 'product_technology_analysis' }).some(packet => packet.sourceCandidateId === 'peer-optical'), false)
})

test('company product pages and focused peer model pages route to their owning method with exact body locators', () => {
  const catalogueId = 'byd-product-catalogue'
  const launchId = 'byd-haibao-launch'
  const geelyHomeId = 'geely-broad-home'
  const galaxyId = 'geely-galaxy-e8'
  const marketId = 'miit-nev-market'
  const catalogue = { ...source, candidate: { ...source.candidate, candidateId: catalogueId, kind: 'web_article' as const, tier: 3 as const, metadata: { officialCompanyHost: true, focusedResearchQuery: 'products_models' } }, title: '比亚迪官方车型与技术目录', content: ['比亚迪官方网站车型目录', '海豹07 DM-i', '搭载第五代DM技术与插混专用刀片电池。', '第二代刀片电池与闪充技术。'].join('\n') }
  const launchBody = ['2026款海豹07DM-i', ...Array.from({ length: 325 }, (_, index) => `车型页面导航与说明 ${index + 1}`), '海豹07DM-i ¥139,800 - ¥195,800 立即订购', '超长纯电续航230公里', '第五代DM技术兼顾能耗与续航。'].join('\n')
  const launch = { ...source, candidate: { ...source.candidate, candidateId: launchId, kind: 'web_article' as const, tier: 3 as const, metadata: { officialCompanyHost: true, curatedUrlSeed: true, focusedResearchQuery: 'model_price_launch' } }, title: '比亚迪 2026 海豹07DM-i 车型页', content: launchBody }
  const broadPeer = { ...source, candidate: { ...source.candidate, candidateId: geelyHomeId, kind: 'web_article' as const, tier: 3 as const, metadata: { researchSubject: 'peer_company', peerCompanyName: '吉利汽车', peerIdentityTerms: ['吉利汽车'] } }, title: '吉利汽车官方网站首页', content: ['吉利汽车官方网站', ...Array.from({ length: 40 }, (_, index) => `吉利品牌与服务介绍 ${index + 1}`), '吉利汽车提供智能出行体验。'].join('\n') }
  const focusedPeer = { ...source, candidate: { ...source.candidate, candidateId: galaxyId, kind: 'web_article' as const, tier: 3 as const, metadata: { researchSubject: 'peer_company', peerCompanyName: '吉利汽车', peerIdentityTerms: ['吉利汽车', '银河E8'], focusedPeerProduct: true } }, title: '吉利银河E8官方车型页', content: ['吉利汽车 银河E8', ...Array.from({ length: 120 }, (_, index) => `车型功能介绍 ${index + 1}`), '银河E8 CLTC纯电续航665公里，支持800V高压快充。', '银河E8官方售价17.58万元起。'].join('\n') }
  const market = { ...source, candidate: { ...source.candidate, candidateId: marketId, kind: 'web_article' as const, tier: 3 as const, metadata: { researchScope: 'industry_context', contextTopics: ['新能源汽车', '销量'] } }, title: '工信部新能源汽车市场数据', content: '2025年我国新能源汽车销量达到1649万辆，同比增长28.2%。' }
  const all = [catalogue, launch, broadPeer, focusedPeer, market]
  const ids = all.map(item => item.candidate.candidateId)

  const productPackets = selectCompanyEvidence(all, ids, ['产品', '技术', '车型', '续航', '销量'], { purpose: 'product_technology_analysis' })
  const cataloguePacket = productPackets.find(packet => packet.sourceCandidateId === catalogueId)
  assert.ok(cataloguePacket, 'the official product catalogue reaches the product method')
  assert.match(cataloguePacket.excerpts.map(row => row.text).join('\n'), /海豹07 DM-i/)
  const launchPacket = productPackets.find(packet => packet.sourceCandidateId === launchId)
  assert.ok(launchPacket, 'the official launch page reaches the product method')
  assert.ok(launchPacket.excerpts.some(row => row.location === 'paragraph:327' && /海豹07DM-i ¥139,800 - ¥195,800/.test(row.text)), 'model/price remains at its exact original normalized paragraph locator')
  assert.ok(launchPacket.excerpts.some(row => /纯电续航230公里/.test(row.text)), 'adjacent product specification is retained')
  assert.equal(productPackets.some(packet => packet.sourceCandidateId === galaxyId), false, 'peer evidence cannot leak into the company product method')
  assert.equal(productPackets.some(packet => packet.sourceCandidateId === marketId), false, 'industry evidence cannot leak into the company product method')

  const competitionPackets = selectCompanyEvidence(all, ids, ['竞争', '产品', '续航', '车型'], { purpose: 'competitive_market_map', maxSources: 1, requiredSourceCandidateIds: [geelyHomeId, galaxyId] })
  assert.equal(competitionPackets.length, 2, 'explicitly required peer candidates remain within the source cap')
  assert.equal(competitionPackets[0]!.sourceCandidateId, galaxyId, 'focused official peer model evidence outranks its broad homepage')
  const galaxyPacket = competitionPackets.find(packet => packet.sourceCandidateId === galaxyId)!
  assert.ok(galaxyPacket.excerpts.some(row => row.location === 'paragraph:122' && /银河E8 CLTC纯电续航665公里/.test(row.text)), 'peer model specifications retain exact supplied body locators')

  const marketPackets = selectCompanyEvidence(all, ids, ['新能源汽车', '销量', '市场规模'], { purpose: 'market_structure_analysis', maxSources: 1 })
  assert.equal(marketPackets[0]?.sourceCandidateId, marketId, 'the public industry market page remains available to market structure analysis')
  assert.ok(marketPackets[0]!.excerpts.some(row => row.location === 'paragraph:1' && /新能源汽车销量达到1649万辆/.test(row.text)))
  assert.equal(marketPackets.some(packet => packet.sourceCandidateId === galaxyId), false, 'peer materials remain excluded from market analysis')
})

test('company method repairs a malformed finding reference only from supplied evidence', async () => {
  let attempts = 0
  const history = { ...source, content: source.content.replace('核心产品业务收入及客户模式。', '公司历史经历业务转型。') }
  const result = await executeCompanyResearchMethod({ skillId: 'company_history_strategy', company: { symbol: '002594' }, asOf: '2026-10-14', sources: [history], durableSourceCandidateIds: ['filing-1'], reasoningExecutor: executor(async () => { attempts++; return attempts === 1 ? { ...output, findings: [{ ...output.findings[0], evidence: [{ sourceCandidateId: 'fabricated', location: 'paragraph:1' }] }] } : output }) })
  assert.equal(result.attempts, 2)
  assert.equal(result.status, 'complete')
  assert.ok(!JSON.stringify(result.findings).includes('fabricated'))
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === 'REFERENCE_ERROR'))
})

test('invalid paragraph locator is deterministically repaired only to a unique semantically matched supplied excerpt', async () => {
  const history = { ...source, content: source.content.replace('核心产品业务收入及客户模式。', '公司商誉来自收购对价超过可辨认净资产公允价值份额。') }
  const invalid = { ...output, markdown: '收购形成商誉。[filing-1@paragraph:999]', sections: [{ id: 'company-overview', markdown: '收购形成商誉。[filing-1@paragraph:999]' }], findings: [{ text: '收购形成商誉。', kind: 'fact', evidence: [{ sourceCandidateId: 'filing-1', location: 'paragraph:999' }] }] }
  let attempts = 0
  const result = await executeCompanyResearchMethod({ skillId: 'company_history_strategy', company: { symbol: '002594' }, asOf: '2026-10-14', sources: [history], durableSourceCandidateIds: ['filing-1'], reasoningExecutor: executor(async () => {
    attempts++
    return invalid
  }) })
  assert.equal(result.status, 'complete', JSON.stringify(result.diagnostics))
  assert.equal(result.attempts, 1)
  assert.equal(attempts, 1)
  assert.ok(result.sections[0]!.markdown.includes('[filing-1@paragraph:251]'))
  assert.ok(result.citationRepairs?.some(repair => repair.addedReferences.some(ref => ref.location === 'paragraph:251')))
})

test('unknown inline markdown citation is repaired from exact supplied same-source evidence without a model retry', async () => {
  let calls = 0
  const matchingSource = { ...source, content: source.content.replace('核心产品业务收入及客户模式。', '公司商誉来自收购对价超过可辨认净资产公允价值份额。') }
  const bad = { ...output, markdown: '收购形成商誉。[filing-1@paragraph:999]', sections: [{ id: 'company-overview', markdown: '收购形成商誉。[filing-1@paragraph:999]' }] }
  const result = await executeCompanyResearchMethod({ skillId: 'company_history_strategy', company: { symbol: '002594' }, asOf: '2026-10-14', sources: [matchingSource], durableSourceCandidateIds: ['filing-1'], reasoningExecutor: executor(async () => {
    calls++
    return bad
  }) })
  assert.equal(result.status, 'complete', JSON.stringify(result.diagnostics))
  assert.equal(calls, 1)
  assert.ok(result.sections[0]!.markdown.includes('[filing-1@paragraph:251]'))
  assert.ok(result.citationRepairs?.some(repair => repair.addedReferences.some(ref => ref.location === 'paragraph:251')))
})

test('a supplied source id paired with another report exact locator is repaired only from unique semantic evidence', async () => {
  const wrongIdSource = { ...source, candidate: { ...source.candidate, candidateId: 'annual-2025', title: '2025年年度报告' }, title: '2025年年度报告', content: [...Array.from({ length: 170 }, (_, i) => `2025报告目录和一般披露 ${i}`), '公司年度财务报表附注及资产负债表项目。', ...Array.from({ length: 80 }, (_, i) => `2025年报告其他披露 ${i}`)].join('\n') }
  const supportingSource = { ...source, candidate: { ...source.candidate, candidateId: 'annual-2024', title: '2024年年度报告' }, title: '2024年年度报告', content: [...Array.from({ length: 170 }, (_, i) => `2024报告目录和一般披露 ${i}`), '上市后公司进行产业结构战略性升级，并拓展新能源业务。', ...Array.from({ length: 80 }, (_, i) => `2024年报告其他披露 ${i}`)].join('\n') }
  const bad = { ...output, markdown: '公司上市后进行产业结构战略性升级并拓展新能源业务。[annual-2025@paragraph:171]', sections: [{ id: 'company-overview', markdown: '公司上市后进行产业结构战略性升级并拓展新能源业务。[annual-2025@paragraph:171]' }], findings: [{ text: '公司上市后进行产业结构战略性升级并拓展新能源业务。', kind: 'fact', evidence: [{ sourceCandidateId: 'annual-2025', location: 'paragraph:171' }] }] }
  let calls = 0
  const result = await executeCompanyResearchMethod({ skillId: 'company_history_strategy', company: { symbol: '002384' }, asOf: '2026-10-18', sources: [wrongIdSource, supportingSource], durableSourceCandidateIds: ['annual-2025', 'annual-2024'], reasoningExecutor: executor(async () => { calls++; return bad }) })
  assert.equal(result.status, 'complete', JSON.stringify(result.diagnostics))
  assert.equal(calls, 1)
  assert.ok(result.sections[0]!.markdown.includes('[annual-2024@paragraph:171]'))
  assert.ok(result.citationRepairs?.some(repair => repair.addedReferences.some(ref => ref.sourceCandidateId === 'annual-2024' && ref.location === 'paragraph:171')))

  const competingSource = { ...supportingSource, candidate: { ...supportingSource.candidate, candidateId: 'annual-2023', title: '2023年年度报告' }, title: '2023年年度报告' }
  calls = 0
  const ambiguous = await executeCompanyResearchMethod({ skillId: 'company_history_strategy', company: { symbol: '002384' }, asOf: '2026-10-18', sources: [wrongIdSource, supportingSource, competingSource], durableSourceCandidateIds: ['annual-2025', 'annual-2024', 'annual-2023'], reasoningExecutor: executor(async () => { calls++; return bad }) })
  assert.equal(ambiguous.status, 'failed', 'same-locator candidates in two reports remain ambiguous without a valid same-claim source anchor')
  assert.equal(calls, 2)
  assert.ok(ambiguous.diagnostics.some(diagnostic => diagnostic.code === 'REFERENCE_ERROR'))
})

test('business model method removes only a standalone claim whose citation is absent from its supplied evidence', async () => {
  const businessSource = { ...source, content: '公司主营产品和服务通过直销及经销渠道交付，收入在客户接受商品并取得控制权时确认。' }
  let calls = 0
  const valid = {
    status: 'complete', answer: '公司通过产品制造与销售获得收入。[filing-1@paragraph:1]',
    markdown: '公司通过产品制造与销售获得收入。[filing-1@paragraph:1]\n\n材料未提供具名竞品资料。[official-old@paragraph:18]',
    sections: [
      { id: 'business-model', markdown: '公司通过产品制造与销售获得收入。[filing-1@paragraph:1]\n材料未提供具名竞品资料。[official-old@paragraph:18]' },
      { id: 'business-segments', markdown: '主营产品按渠道交付。[filing-1@paragraph:1]' },
      { id: 'supply-chain', markdown: '现有材料仅支持一般供应链描述。[filing-1@paragraph:1]' },
    ],
    findings: [{ text: '公司通过产品制造与销售获得收入。', kind: 'fact', evidence: [{ sourceCandidateId: 'filing-1', location: 'paragraph:1' }] }],
    limitations: [], risks: [],
  }
  const result = await executeCompanyResearchMethod({
    skillId: 'business_model_map', company: { symbol: '002594' }, asOf: '2026-10-19',
    sources: [businessSource], durableSourceCandidateIds: ['filing-1'],
    reasoningExecutor: executor(async () => { calls++; return calls === 1 ? { status: 'complete', answer: 'repair the schema' } : valid }),
  })
  assert.equal(calls, 2)
  assert.equal(result.status, 'complete', JSON.stringify(result.diagnostics))
  assert.ok(!result.markdown.includes('official-old@paragraph:18'))
  assert.ok(!result.sections.find(section => section.id === 'business-model')!.markdown.includes('具名竞品资料'))
  assert.ok(result.limitations.some(item => item.includes('已剔除本轮证据包未提供')))
})

test('risk method derives transmission records from cited matrix rows and binds an uncited summary to validated evidence', () => {
  const riskSource={...source,content:'单一客户流失可能导致收入和回款承压。'}
  const packets=selectCompanyEvidence([riskSource],['filing-1'],['客户','风险'],{purpose:'company_risk_analysis'})
  const cited='[filing-1@paragraph:1]'
  const riskOutput={...output,markdown:'风险判断摘要',sections:[{id:'risks',markdown:`| 风险 | 触发与影响 | 监控 | 缓解及残余风险 |\n|---|---|---|---|\n| 客户集中 | 单一客户流失会导致收入与回款承压。 ${cited} | 前五名占比和应收账款。 | 客户拓展缓解集中，但替代性未知。 ${cited} |`}],findings:[{text:'客户流失可能造成收入和回款承压。',kind:'inference',evidence:[{sourceCandidateId:'filing-1',location:'paragraph:1'}]}],risks:[]}
  const validated=validateCompanyMethodOutput(riskOutput,packets,['risks'])
  assert.equal(validated.risks.length,1)
  assert.match(validated.risks[0]!,/客户集中/)
  assert.match(validated.markdown,/\[filing-1@paragraph:1\]/)
})

test('risk evidence selection supplies disclosed control and internal-control arrangements',()=>{
  const governanceSource={...source,content:'实际控制人兼任董事长、总裁。内部控制审计报告中的审议意见段：公司于报告期末在所有重大方面保持有效的财务报告内部控制。关联交易决策制度（2025年10月）。'}
  const packets=selectCompanyEvidence([governanceSource],['filing-1'],COMPANY_METHOD_METHODOLOGY.company_risk_analysis.terms,{purpose:'company_risk_analysis'})
  const text=packets.flatMap(packet=>packet.excerpts).map(excerpt=>excerpt.text).join('\n')
  assert.match(text,/内部控制审计报告中的审议意见段/)
  assert.match(text,/关联交易决策制度/)
})

test('company evidence can reach a late relevant sentence inside a long paragraph', () => {
  const oneParagraph = { ...source, content: `${'封面说明。'.repeat(1000)}重要产品技术和量产验证。` }
  const packets = selectCompanyEvidence([oneParagraph], ['filing-1'], ['产品'])
  assert.ok(packets[0]?.excerpts[0]?.text.includes('重要产品技术'))
  assert.equal(packets[0]?.excerpts[0]?.location, 'paragraph:1')
})

test('business-driver evidence keeps the complete split product margin header with both product rows', () => {
  const lines = Array.from({ length: 740 }, () => '一般披露事项。')
  const rows = new Map<number, string>([
    [716,'单位：元'],[717,'营业收入 营业成本 毛利率'],[718,'营业收入'],[719,'比上年同'],[720,'期增减'],
    [721,'营业成本'],[722,'比上年同'],[723,'期增减'],[724,'毛利率比'],[725,'上年同期'],[726,'增减'],[727,'分行业'],
    [728,'日用电子器件制造业 69,404,994,000.00 65,907,931,000.00 5.04% 0.96% 3.88% -2.67%'],
    [729,'交通运输设备及电气制'],[730,'造业 275,341,358,000.00 213,863,297,000.00 22.33% -8.98% -11.24% 1.98%'],
    [731,'分产品'],[732,'电子及其他产品 69,404,994,000.00 65,907,931,000.00 5.04% 0.96% 3.88% -2.67%'],
    [733,'汽车、汽车相关产品及'],[734,'其他产品 275,341,358,000.00 213,863,297,000.00 22.33% -8.98% -11.24% 1.98%'],
  ])
  for (const [paragraph, text] of rows) lines[paragraph - 1] = text
  const filing = { ...source, candidate: { ...source.candidate, candidateId: 'industry-table' }, title: '2026年半年度报告', content: lines.join('\n') }
  const [packet] = selectCompanyEvidence([filing], ['industry-table'], ['收入','成本','毛利率','分产品'], { purpose: 'business_driver_analysis' })
  const locations = new Set(packet!.excerpts.map(excerpt => excerpt.location))
  for (let paragraph = 716; paragraph <= 734; paragraph++) assert.ok(locations.has(`paragraph:${paragraph}`), `keeps table header/label/data paragraph ${paragraph}`)
})

test('business-driver repair corrects a uniquely matched product row mislabeled as an industry row', async () => {
  const lines=Array.from({length:740},()=> '一般披露事项。')
  const rows=new Map<number,string>([
    [716,'单位：元'],[717,'营业收入 营业成本 毛利率'],[718,'营业收入'],[719,'比上年同'],[720,'期增减'],
    [721,'营业成本'],[722,'比上年同'],[723,'期增减'],[724,'毛利率比'],[725,'上年同期'],[726,'增减'],[727,'分行业'],
    [728,'日用电子器件制造业 69,404,994,000.00 65,907,931,000.00 5.04% 0.96% 3.88% -2.67%'],
    [731,'分产品'],[732,'电子及其他产品 69,404,994,000.00 65,907,931,000.00 5.04% 0.96% 3.88% -2.67%'],
    [733,'汽车、汽车相关产品及'],[734,'其他产品 275,341,358,000.00 213,863,297,000.00 22.33% -8.98% -11.24% 1.98%']
  ])
  for(const [paragraph,text] of rows)lines[paragraph-1]=text
  const filing={...source,candidate:{...source.candidate,candidateId:'segment-pdf'},title:'2026年半年度报告',content:lines.join('\n')}
  const cited=[716,717,718,719,720,721,722,723,724,725,726,727].map(location=>({sourceCandidateId:'segment-pdf',location:`paragraph:${location}`}))
  const claim='半年报分行业表中，交通运输设备及电气制造业毛利率比上年同期增减为1.98%。'
  const draft={status:'complete',answer:`${claim} [segment-pdf@paragraph:734]`,markdown:`${claim} [segment-pdf@paragraph:734]`,sections:[
    {id:'revenue-profit-drivers',markdown:`${claim} [segment-pdf@paragraph:734]`},
    {id:'growth-drivers',markdown:'收入驱动仍需观察。[segment-pdf@paragraph:734]'},
    {id:'catalysts',markdown:'商业化进展仍需观察。[segment-pdf@paragraph:734]'}
  ],findings:[{text:claim,kind:'fact',evidence:cited}],limitations:[],risks:[]}
  const result=await executeCompanyResearchMethod({company:{symbol:'002594',name:'比亚迪',exchange:'SZ'},asOf:'2026-10-19',sources:[filing],reportSourceCandidateIds:['segment-pdf'],skillId:'business_driver_analysis',reasoningExecutor:executor(async()=>draft),maxAttempts:1})
  assert.equal(result.status,'complete',JSON.stringify({findings:result.findings,diagnostics:result.diagnostics,evidence:(result.attemptOutputs?.[0]?.reasoningInput as any)?.evidence?.map((packet:any)=>packet.excerpts.map((item:any)=>item.location)),answer:result.answer,sections:result.sections}))
  assert.match(result.findings[0]!.text,/半年报分产品表中，汽车、汽车相关产品及其他产品毛利率/)
  assert.ok(result.findings[0]!.evidence.some(ref=>ref.location==='paragraph:733'))
  assert.ok(result.findings[0]!.evidence.some(ref=>ref.location==='paragraph:734'))
  assert.ok(result.findings[0]!.evidence.some(ref=>ref.location==='paragraph:731'))
  assert.match(result.sections.find(section=>section.id==='revenue-profit-drivers')!.markdown,/半年报分产品表中，汽车、汽车相关产品及其他产品毛利率/)
})

test('business-driver finding binds the unique split product margin row and drops the wrong industry marker', async () => {
  const lines = Array.from({ length: 740 }, () => '一般披露事项。')
  const rows = new Map<number, string>([
    [716, '单位：元'], [717, '营业收入 营业成本 毛利率'], [718, '营业收入'], [719, '比上年同'], [720, '期增减'],
    [721, '营业成本'], [722, '比上年同'], [723, '期增减'], [724, '毛利率比'], [725, '上年同期'], [726, '增减'],
    [727, '分行业'], [728, '日用电子器件制造业 69,404,994,000.00 65,907,931,000.00 5.04% 0.96% 3.88% -2.67%'],
    [729, '交通运输设备及电气制'], [730, '造业 275,341,358,000.00 213,863,297,000.00 22.33% -8.98% -11.24% 1.98%'],
    [731, '分产品'], [732, '电子及其他产品 69,404,994,000.00 65,907,931,000.00 5.04% 0.96% 3.88% -2.67%'],
    [733, '汽车、汽车相关产品及'], [734, '其他产品 275,341,358,000.00 213,863,297,000.00 22.33% -8.98% -11.24% 1.98%'],
  ])
  for (const [paragraph, text] of rows) lines[paragraph - 1] = text
  const filing = { ...source, candidate: { ...source.candidate, candidateId: 'driver-split-product' }, title: '2026年半年度报告', content: lines.join('\n') }
  const claim = '汽车、汽车相关产品及其他产品毛利率比上年同期增减为1.98%。'
  const citations = [716, 717, 718, 719, 720, 721, 722, 723, 724, 725, 726, 731]
    .map(location => ({ sourceCandidateId: 'driver-split-product', location: `paragraph:${location}` }))
  const draft = {
    status: 'complete', answer: '分部变化可用于观察，量价归因仍有边界。', markdown: '公司披露的分部变化不能替代量价拆分。',
    sections: [
      { id: 'revenue-profit-drivers', markdown: '收入、成本与毛利率方向应结合业务范围解释。[driver-split-product@paragraph:716]' },
      { id: 'growth-drivers', markdown: '缺少同口径销量与价格输入，不能量化量价贡献。[driver-split-product@paragraph:716]' },
      { id: 'catalysts', markdown: '后续跟踪分部收入与毛利率变化。[driver-split-product@paragraph:716]' },
    ],
    findings: [{ text: claim, kind: 'fact', evidence: citations }], limitations: [], risks: [],
  }
  const result = await executeCompanyResearchMethod({
    company: { symbol: '002594', name: '比亚迪', exchange: 'SZ' }, asOf: '2026-10-23', sources: [filing],
    reportSourceCandidateIds: ['driver-split-product'], skillId: 'business_driver_analysis', maxAttempts: 1,
    reasoningExecutor: executor(async () => draft),
  })
  assert.equal(result.status, 'complete', JSON.stringify(result.diagnostics))
  const evidence = result.findings[0]!.evidence
  assert.ok(evidence.some(ref => ref.location === 'paragraph:731'), 'retains the matching product table marker')
  assert.ok(evidence.some(ref => ref.location === 'paragraph:733'), 'adds the exact split product label')
  assert.ok(evidence.some(ref => ref.location === 'paragraph:734'), 'adds the exact matching numeric continuation')
  assert.ok(!evidence.some(ref => ref.location === 'paragraph:727'), 'does not leave the conflicting industry marker attached')
})

test('business-driver segment repair preserves preceding exact-row citations and does not transfer them to the replacement sentence', async () => {
  const interimLines = Array.from({ length: 740 }, () => '一般披露事项。')
  const interimRows = new Map<number, string>([
    [716, '单位：元'], [717, '营业收入 营业成本 毛利率'], [718, '营业收入'], [719, '比上年同'], [720, '期增减'],
    [721, '营业成本'], [722, '比上年同'], [723, '期增减'], [724, '毛利率比'], [725, '上年同期'], [726, '增减'], [727, '分行业'],
    [728, '日用电子器件制造业 69,404,994,000.00 65,907,931,000.00 5.04% 0.96% 3.88% -2.67%'],
  ])
  for (const [paragraph, text] of interimRows) interimLines[paragraph - 1] = text
  const interimId = 'interim-industry-margin'
  const interim = { ...source, candidate: { ...source.candidate, candidateId: interimId }, title: '2026年半年度报告', content: interimLines.join('\n') }

  const annualLines = Array.from({ length: 15 }, () => '一般披露事项。')
  const annualRows = new Map<number, string>([
    [1, '单位：元'], [2, '营业收入 营业成本 毛利率'], [3, '营业收入比上年同期增减'], [4, '营业成本比上年同期增减'],
    [5, '毛利率比上年同期增减'], [6, '分行业'], [7, '交通运输设备及电气制造业 100 90 18.00% 2.00% 3.00% -1.00%'],
    [8, '分产品'], [9, '汽车、汽车相关产品及其他产品 100 90 20.49% 5.06% 7.53% -1.82%'],
  ])
  for (const [paragraph, text] of annualRows) annualLines[paragraph - 1] = text
  const annualId = 'annual-product-margin'
  const annual = { ...source, candidate: { ...source.candidate, candidateId: annualId }, title: '2025年年度报告', content: annualLines.join('\n') }

  const interimRefs = [716, 717, 721, 722, 723, 724, 725, 726, 727, 728].map(paragraph => ({ sourceCandidateId: interimId, location: `paragraph:${paragraph}` }))
  const interimSectionRefs = Array.from({ length: 13 }, (_, index) => ({ sourceCandidateId: interimId, location: `paragraph:${index + 716}` }))
  const annualRefs = [1, 2, 3, 4, 5, 6, 7].map(paragraph => ({ sourceCandidateId: annualId, location: `paragraph:${paragraph}` }))
  const interimClaim = '同一半年报分行业表中，日用电子器件制造业毛利率水平为5.04%，毛利率比上年同期增减为-2.67%；营业收入同比增加0.96%，营业成本同比增加3.88%。'
  const mislabeledAnnualClaim = '2025年年度报告分行业表显示，交通运输设备及电气制造业毛利率水平为20.49%，毛利率比上年同期增减为-1.82%；营业收入同比增加5.06%，营业成本同比增加7.53%。'
  const refs = (items: readonly { sourceCandidateId: string; location: string }[]) => items.map(ref => `[${ref.sourceCandidateId}@${ref.location}]`).join(' ')
  const draft = {
    status: 'complete', answer: '分行业毛利变化需结合期间和范围判断。', markdown: '公司披露的分部毛利变化仍需结合收入结构观察。',
    sections: [
      { id: 'revenue-profit-drivers', markdown: `${interimClaim} ${refs(interimSectionRefs)}\n\n${mislabeledAnnualClaim} ${refs(annualRefs)}` },
      { id: 'growth-drivers', markdown: `缺少同期间量价数据，不能量化收入贡献。[${interimId}@paragraph:728]` },
      { id: 'catalysts', markdown: `继续观察公司特定商业化节点及后续兑现。[${annualId}@paragraph:9]` },
    ],
    findings: [
      { text: interimClaim, kind: 'fact', evidence: interimRefs },
      { text: mislabeledAnnualClaim, kind: 'fact', evidence: annualRefs },
    ], limitations: [], risks: [],
  }
  const result = await executeCompanyResearchMethod({
    company: { symbol: '002594', name: '比亚迪', exchange: 'SZ' }, asOf: '2026-10-24', sources: [interim, annual],
    reportSourceCandidateIds: [interimId, annualId], skillId: 'business_driver_analysis', maxAttempts: 1,
    reasoningExecutor: executor(async () => draft),
  })
  assert.equal(result.status, 'complete', JSON.stringify({ diagnostics: result.diagnostics, findings: result.findings }))
  const section = result.sections.find(item => item.id === 'revenue-profit-drivers')!.markdown
  const interimSentence = section.slice(section.indexOf(interimClaim), section.indexOf('2025年年度报告'))
  const annualSentence = section.slice(section.indexOf('2025年年度报告'))
  assert.match(interimSentence, new RegExp(`${interimId}@paragraph:728`), 'the exact same-row evidence remains attached to the interim-period claim')
  const grounding = validateCompanyNumericGrounding({ markdown: interimSentence, sources: [interim, annual], evidenceContexts: result.executionEvidence })
  assert.equal(grounding.status, 'grounded', JSON.stringify(grounding.diagnostics))
  assert.doesNotMatch(annualSentence, new RegExp(`${interimId}@paragraph:728`), 'the preceding sentence’s row citation is not transferred to the repaired annual sentence')
  assert.match(annualSentence, new RegExp(`${annualId}@paragraph:9`), 'the replacement sentence uses its own exact product-row evidence')
})

test('business-driver split-product row repair requires the product marker in the finding citations', async () => {
  const lines = Array.from({ length: 740 }, () => '一般披露事项。')
  const rows = new Map<number, string>([
    [716, '单位：元'], [717, '营业收入 营业成本 毛利率'], [718, '营业收入'], [719, '比上年同'], [720, '期增减'],
    [721, '营业成本'], [722, '比上年同'], [723, '期增减'], [724, '毛利率比'], [725, '上年同期'], [726, '增减'],
    [727, '分行业'], [728, '日用电子器件制造业 69,404,994,000.00 65,907,931,000.00 5.04% 0.96% 3.88% -2.67%'],
    [731, '分产品'], [732, '电子及其他产品 69,404,994,000.00 65,907,931,000.00 5.04% 0.96% 3.88% -2.67%'],
    [733, '汽车、汽车相关产品及'], [734, '其他产品 275,341,358,000.00 213,863,297,000.00 22.33% -8.98% -11.24% 1.98%'],
  ])
  for (const [paragraph, text] of rows) lines[paragraph - 1] = text
  const filing = { ...source, candidate: { ...source.candidate, candidateId: 'driver-split-product-negative' }, title: '2026年半年度报告', content: lines.join('\n') }
  const claim = '汽车、汽车相关产品及其他产品毛利率比上年同期增减为1.98%。'
  const citations = [716, 717, 718, 719, 720, 721, 722, 723, 724, 725, 726, 727]
    .map(location => ({ sourceCandidateId: 'driver-split-product-negative', location: `paragraph:${location}` }))
  const draft = {
    status: 'complete', answer: '分部变化可用于观察，量价归因仍有边界。', markdown: '公司披露的分部变化不能替代量价拆分。',
    sections: [
      { id: 'revenue-profit-drivers', markdown: '收入、成本与毛利率方向应结合业务范围解释。[driver-split-product-negative@paragraph:716]' },
      { id: 'growth-drivers', markdown: '缺少同口径销量与价格输入，不能量化量价贡献。[driver-split-product-negative@paragraph:716]' },
      { id: 'catalysts', markdown: '后续跟踪分部收入与毛利率变化。[driver-split-product-negative@paragraph:716]' },
    ],
    findings: [{ text: claim, kind: 'fact', evidence: citations }], limitations: [], risks: [],
  }
  const result = await executeCompanyResearchMethod({
    company: { symbol: '002594', name: '比亚迪', exchange: 'SZ' }, asOf: '2026-10-23', sources: [filing],
    reportSourceCandidateIds: ['driver-split-product-negative'], skillId: 'business_driver_analysis', maxAttempts: 1,
    reasoningExecutor: executor(async () => draft),
  })
  assert.equal(result.status, 'failed')
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === 'NUMERIC_GROUNDING_ERROR'))
  const attempt = result.attemptOutputs?.[0]?.output as any
  assert.ok(!attempt.findings[0].evidence.some((ref: any) => ref.location === 'paragraph:734'), 'does not infer a product row from an uncited product marker')
})

test('business-driver finding with one margin value gets its exact same-source data row citation', async () => {
  const lines = Array.from({ length: 12 }, () => '一般披露事项。')
  const rows = new Map<number, string>([
    [1, '单位：元'], [2, '营业收入 营业成本 毛利率'], [3, '营业收入比上年同期增减'],
    [4, '营业成本比上年同期增减'], [5, '毛利率比上年同期增减'], [6, '分行业'],
    [7, '日用电子器件制造业 69,404,994,000.00 65,907,931,000.00 5.04% 0.96% 3.88% -2.67%'],
  ])
  for (const [paragraph, text] of rows) lines[paragraph - 1] = text
  const filing = { ...source, candidate: { ...source.candidate, candidateId: 'single-margin-row' }, title: '2026年半年度报告', content: lines.join('\n') }
  const claim = '2026年上半年分行业表中，日用电子器件制造业毛利率比上年同期增减为-2.67%。'
  const draft = {
    status: 'complete', answer: '分部毛利率表现不同，量价归因仍有缺口。', markdown: '分行业毛利率表现不同，仍需结合业务结构观察。',
    sections: [
      { id: 'revenue-profit-drivers', markdown: '已披露收入及成本变化提供方向线索，但不能替代量价归因。[single-margin-row@paragraph:7]' },
      { id: 'growth-drivers', markdown: '后续应跟踪相同分行业口径下的收入、成本及毛利率。[single-margin-row@paragraph:7]' },
      { id: 'catalysts', markdown: '现有材料未提供足够的量价数据以量化增长催化。[single-margin-row@paragraph:7]' },
    ],
    findings: [{ text: claim, kind: 'fact', evidence: [1, 2, 3, 4, 5, 6].map(paragraph => ({ sourceCandidateId: 'single-margin-row', location: `paragraph:${paragraph}` })) }],
    limitations: [], risks: [],
  }
  const result = await executeCompanyResearchMethod({ company: { symbol: '002594', name: '比亚迪', exchange: 'SZ' }, asOf: '2026-10-23', sources: [filing], reportSourceCandidateIds: ['single-margin-row'], skillId: 'business_driver_analysis', reasoningExecutor: executor(async () => draft), maxAttempts: 1 })
  assert.equal(result.status, 'complete', JSON.stringify({ findings: result.findings, diagnostics: result.diagnostics }))
  assert.ok(result.findings[0]!.evidence.some(ref => ref.location === 'paragraph:7'), 'the exact row containing -2.67% is attached to this finding')
})

test('single-value industry findings bind distinct exact rows, including a split transport label', async () => {
  const lines = Array.from({ length: 10 }, () => '一般披露事项。')
  const rows = new Map<number, string>([
    [1, '单位：元'], [2, '营业收入 营业成本 毛利率'], [3, '营业收入比上年同期增减'],
    [4, '营业成本比上年同期增减'], [5, '毛利率比上年同期增减'], [6, '分行业'],
    [7, '日用电子器件制造业 69,404,994,000.00 65,907,931,000.00 5.04% 0.96% 3.88% -2.67%'],
    [8, '交通运输设备及电气制'], [9, '造业 275,341,358,000.00 213,863,297,000.00 22.33% -8.98% -11.24% 1.98%'],
  ])
  for (const [paragraph, text] of rows) lines[paragraph - 1] = text
  const filing = { ...source, candidate: { ...source.candidate, candidateId: 'split-industry-margin' }, title: '2026年半年度报告', content: lines.join('\n') }
  const sharedHeaders = [1, 2, 3, 4, 5, 6].map(paragraph => ({ sourceCandidateId: 'split-industry-margin', location: `paragraph:${paragraph}` }))
  const draft = {
    status: 'complete', answer: '分行业毛利率表现不一，量价归因仍有边界。', markdown: '分行业毛利率方向可作线索，单位成本不可由总额直接推断。',
    sections: [
      { id: 'revenue-profit-drivers', markdown: '毛利率变化需结合收入、成本与经营范围解释。[split-industry-margin@paragraph:7]' },
      { id: 'growth-drivers', markdown: '后续应跟踪相同分行业口径下的收入和成本变化。[split-industry-margin@paragraph:9]' },
      { id: 'catalysts', markdown: '现有材料没有足够量价数据支持定量增长催化判断。[split-industry-margin@paragraph:7]' },
    ],
    findings: [
      { text: '2026年上半年分行业区段日用电子器件制造业毛利率比上年同期增减为-2.67%。', kind: 'fact', evidence: sharedHeaders },
      { text: '2026年上半年分行业区段交通运输设备及电气制造业毛利率比上年同期增减为1.98%。', kind: 'fact', evidence: sharedHeaders },
    ],
    limitations: [], risks: [],
  }
  const result = await executeCompanyResearchMethod({ company: { symbol: '002594', name: '比亚迪', exchange: 'SZ' }, asOf: '2026-10-23', sources: [filing], reportSourceCandidateIds: ['split-industry-margin'], skillId: 'business_driver_analysis', reasoningExecutor: executor(async () => draft), maxAttempts: 1 })
  assert.equal(result.status, 'complete', JSON.stringify({ findings: result.findings, diagnostics: result.diagnostics }))
  assert.ok(result.findings[0]!.evidence.some(ref => ref.location === 'paragraph:7'), 'the electronic-industry value binds only to its exact data row')
  assert.ok(result.findings[1]!.evidence.some(ref => ref.location === 'paragraph:8'), 'the transport finding cites the split industry label')
  assert.ok(result.findings[1]!.evidence.some(ref => ref.location === 'paragraph:9'), 'the transport finding cites its matching numeric continuation')
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

test('malformed atomic product tables use the remaining format retry and never pass after exhaustion', async () => {
  const filing = { ...source, content: '公司生产甲类及乙类产品，技术路线均已量产。' }
  const ref = '[filing-1@paragraph:1]'
  const header = '| 产品/分部 | 应用 | 路线 | 商业化 | 比较限制 |\n|---|---|---|---|---|'
  const brokenTable = `${header}\n| 甲类 | 工业 | 公司披露 | 已量产 ${ref} |\n| 乙类 | 工业 | 公司披露 | 已量产 ${ref} |`
  const goodTable = `${header}\n| 甲类 | 工业 | 公司披露 | 已量产 ${ref} | 竞品资料未提供 |\n| 乙类 | 工业 | 公司披露 | 已量产 ${ref} | 竞品资料未提供 |`
  const makeOutput = (table: string) => ({ ...output, answer: '公司披露产品和技术。', markdown: `公司披露产品和技术。${ref}`, sections: [{ id: 'products', markdown: table }, { id: 'technologies', markdown: `公司披露技术路线已量产。${ref}` }], findings: [{ text: '公司披露技术路线已量产。', kind: 'fact', evidence: [{ sourceCandidateId: 'filing-1', location: 'paragraph:1' }] }] })
  let calls = 0
  const repaired = await executeCompanyResearchMethod({ skillId: 'product_technology_analysis', company: { symbol: '002594' }, asOf: '2026-10-14', sources: [filing], durableSourceCandidateIds: ['filing-1'], reasoningExecutor: executor(async request => {
    calls++
    if (calls === 2) assert.match(JSON.stringify(request), /Owned section products.*malformed Markdown tables/)
    return makeOutput(calls === 1 ? brokenTable : goodTable)
  }) })
  assert.equal(repaired.status, 'complete', JSON.stringify(repaired.diagnostics))
  assert.equal(calls, 2)
  assert.equal(repaired.attempts, 2)
  assert.equal(repaired.diagnostics[0]?.code, 'FORMAT_ERROR')
  assert.match(repaired.diagnostics[0]?.message ?? '', /products.*4 cells; expected 5/)
  assert.equal(repaired.sections.find(section => section.id === 'products')?.markdown, goodTable)

  calls = 0
  const exhausted = await executeCompanyResearchMethod({ skillId: 'product_technology_analysis', company: { symbol: '002594' }, asOf: '2026-10-14', sources: [filing], durableSourceCandidateIds: ['filing-1'], reasoningExecutor: executor(async () => { calls++; return makeOutput(brokenTable) }) })
  assert.equal(calls, 2)
  assert.notEqual(exhausted.status, 'complete')
  assert.equal(exhausted.attempts, 2)
  assert.ok(exhausted.diagnostics.filter(diagnostic => diagnostic.code === 'FORMAT_ERROR').length === 2)
  assert.equal(exhausted.sections.length, 0, 'no malformed section is accepted as a completed method result')
})

test('business segment format repair fills only a missing channel cell from adjacent cited group-level disclosure', async () => {
  const lines = Array.from({ length: 830 }, () => '一般披露事项。')
  lines[827] = '分销售模式'
  lines[828] = '直销 销售收入'
  lines[829] = '经销 销售收入'
  const filing = { ...source, content: lines.join('\n') }
  const ref = (paragraph: number) => `[filing-1@paragraph:${paragraph}]`
  const header = '| 披露产品 | 客户及需求边界 | 收入与毛利口径 | 渠道与解释限制 |\n|---|---|---|---|'
  const channelProse = `报告按集团销售模式披露直销与经销，但未提供分产品渠道拆分，不能将集团结构分配给单一产品。${ref(828)} ${ref(829)} ${ref(830)}`
  const malformed = `${header}\n| 汽车、汽车相关产品及其他产品 | 具体采购者未披露 | 产品收入与毛利率详见相应披露。 |\n| 手机部件、组装及其他产品 | 客户身份未披露 | 产品收入与毛利率详见相应披露。 |\n\n${channelProse}`
  const methodOutput = {
    status: 'complete', answer: `公司按产品披露收入与毛利，渠道限制见年报。${ref(828)}`,
    markdown: `公司按产品披露收入与毛利，渠道限制见年报。${ref(828)}`,
    sections: [
      { id: 'business-model', markdown: `产品收入及毛利分别披露。${ref(828)}` },
      { id: 'business-segments', markdown: malformed },
      { id: 'supply-chain', markdown: `年报披露集团直销与经销模式。${ref(829)} ${ref(830)}` },
    ],
    findings: [{ text: '公司按产品披露收入，并以集团口径披露销售模式。', kind: 'fact', evidence: [828, 829, 830].map(paragraph => ({ sourceCandidateId: 'filing-1', location: `paragraph:${paragraph}` })) }],
    limitations: [], risks: [],
  }
  const result = await executeCompanyResearchMethod({ skillId: 'business_model_map', company: { symbol: '002594' }, asOf: '2026-10-23', sources: [filing], reportSourceCandidateIds: ['filing-1'], reasoningExecutor: executor(async () => methodOutput) })
  assert.equal(result.status, 'complete', JSON.stringify(result.diagnostics))
  const repaired = result.sections.find(section => section.id === 'business-segments')!.markdown
  assert.equal((repaired.match(/集团直销、经销数据仅为销售模式汇总/g) ?? []).length, 2)
  assert.match(repaired, /不能将集团渠道结构分配至该产品。 \[filing-1@paragraph:828\] \[filing-1@paragraph:829\] \[filing-1@paragraph:830\]/)
  assert.match(repaired, /汽车、汽车相关产品及其他产品 \| 具体采购者未披露 \| 产品收入与毛利率详见相应披露。 \|/)
  assert.match(repaired, /手机部件、组装及其他产品 \| 客户身份未披露 \| 产品收入与毛利率详见相应披露。 \|/)
  assert.ok(result.attemptOutputs?.[0]?.formatRepairs?.length === 2)
})

test('business segment channel-cell repair fails closed without the adjacent limitation or exact schema', async () => {
  const lines = Array.from({ length: 830 }, () => '一般披露事项。')
  lines[827] = '分销售模式'
  lines[828] = '直销 销售收入'
  lines[829] = '经销 销售收入'
  const filing = { ...source, content: lines.join('\n') }
  const ref = '[filing-1@paragraph:828] [filing-1@paragraph:829] [filing-1@paragraph:830]'
  const exactHeader = '| 披露产品 | 客户及需求边界 | 收入与毛利口径 | 渠道与解释限制 |\n|---|---|---|---|'
  const shortRows = '| 汽车、汽车相关产品及其他产品 | 采购者未披露 | 收入与毛利见披露 |\n| 手机部件、组装及其他产品 | 客户未披露 | 收入与毛利见披露 |'
  const makeOutput = (header: string, prose: string) => ({
    status: 'complete', answer: `公司披露产品业务。${ref}`, markdown: `公司披露产品业务。${ref}`,
    sections: [
      { id: 'business-model', markdown: `公司披露产品业务。${ref}` },
      { id: 'business-segments', markdown: `${header}\n${shortRows}\n\n${prose}` },
      { id: 'supply-chain', markdown: `销售模式见年报。${ref}` },
    ],
    findings: [{ text: '公司披露产品业务。', kind: 'fact', evidence: [828, 829, 830].map(paragraph => ({ sourceCandidateId: 'filing-1', location: `paragraph:${paragraph}` })) }],
    limitations: [], risks: [],
  })
  const unsupportedProse = `报告披露直销与经销，但未提供分产品渠道拆分，不能将集团结构分配给单一产品。${ref}`
  for (const draft of [
    makeOutput(exactHeader, `报告披露直销与经销，具体渠道安排未说明。${ref}`),
    makeOutput(exactHeader.replace('披露产品', '产品'), unsupportedProse),
  ]) {
    const result = await executeCompanyResearchMethod({ skillId: 'business_model_map', company: { symbol: '002594' }, asOf: '2026-10-23', sources: [filing], reportSourceCandidateIds: ['filing-1'], reasoningExecutor: executor(async () => draft) })
    assert.notEqual(result.status, 'complete', JSON.stringify(result.diagnostics))
    assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === 'FORMAT_ERROR'))
  }
})

test('malformed risk matrix retry names the exact five-column contract and preserves row content', async () => {
  const filing = { ...source, content: '公司披露客户、技术与商誉相关风险。' }
  const ref = '[filing-1@paragraph:1]'
  const header = '| 风险类别 | 触发条件与影响路径 | 可监控指标 | 缓解因素 | 残余风险 |\n|---|---|---|---|---|'
  const broken = `${header}\n| 并购风险 | 假设未兑现时可能减值 ${ref} | 现金流与减值准备 | 已披露资产组口径 ${ref} | 估值假设背景 ${ref} | 安全边际尚不可量化 ${ref} |`
  const repairedTable = `${header}\n| 并购风险 | 假设未兑现时可能减值 ${ref} | 现金流与减值准备 | 已披露资产组口径 ${ref}；估值假设背景 ${ref} | 安全边际尚不可量化 ${ref} |`
  const makeOutput = (table: string) => ({
    status: 'complete', answer: `公司披露相关风险。${ref}`, markdown: `公司披露相关风险。${ref}`,
    sections: [{ id: 'risks', markdown: table }],
    findings: [{ text: '公司披露客户、技术与商誉相关风险。', kind: 'fact', evidence: [{ sourceCandidateId: 'filing-1', location: 'paragraph:1' }] }],
    limitations: [], risks: [`相关假设仍需跟踪。${ref}`],
  })
  let calls = 0
  let retryRequest: any
  const result = await executeCompanyResearchMethod({ skillId: 'company_risk_analysis', company: { symbol: '002384' }, asOf: '2026-10-14', sources: [filing], reportSourceCandidateIds: ['filing-1'], reasoningExecutor: executor(async request => {
    calls++
    if (calls === 2) retryRequest = request
    return makeOutput(calls === 1 ? broken : repairedTable)
  }) })
  assert.equal(calls, 2)
  assert.equal(result.status, 'complete', JSON.stringify(result.diagnostics))
  assert.match(retryRequest.instruction, /必须使用五列/)
  assert.match(retryRequest.instruction, /row at line 3 has 6 cells; expected 5/)
  assert.match(retryRequest.instruction, /不得丢弃事实、数字或引用/)
  assert.match(retryRequest.input.repairInstruction, /必须使用五列/)
  assert.match(result.diagnostics[0]?.message ?? '', /row at line 3 has 6 cells; expected 5/)
  assert.equal(result.sections.find(section => section.id === 'risks')?.markdown, repairedTable)
})

test('company risk matrix applies and records only explicit, lossless goodwill and residual-risk cell repairs', async () => {
  const filing = { ...source, content: '公司披露商誉原值及相关风险。' }
  const ref = '[filing-1@paragraph:1]'
  const header = '| 风险类别 | 触发条件与影响路径 | 可监控指标 | 缓解因素 | 残余风险 |\n|---|---|---|---|---|'
  const goodwillRow = `| 商誉与估值 | 预测偏差可能导致减值 ${ref} | 现金流与折现率 | 公司披露资产组测试 ${ref} | 商誉原值合计 ${ref} | 未提供完整账面价值，无法量化减值情景 ${ref} |`
  const mergedMitigationRow = `| 治理与关键人 | 权力集中可能增加关键人依赖 ${ref} | 继任安排 | 公司披露内部控制体系 ${ref}；残余风险：执行效果和继任安排缺少直接证据 ${ref} |`
  const repairedGoodwillRow = `| 商誉与估值 | 预测偏差可能导致减值 ${ref} | 现金流与折现率 | 公司披露资产组测试 ${ref} | 商誉原值合计 ${ref}；未提供完整账面价值，无法量化减值情景 ${ref} |`
  const repairedGovernanceRow = `| 治理与关键人 | 权力集中可能增加关键人依赖 ${ref} | 继任安排 | 公司披露内部控制体系 ${ref} | 残余风险：执行效果和继任安排缺少直接证据 ${ref} |`
  const makeOutput = (table: string, tableHeader = header) => ({ ...output, answer: `公司存在相关风险。${ref}`, markdown: `公司存在相关风险。${ref}`, sections: [{ id: 'risks', markdown: `${tableHeader}\n${table}` }], findings: [{ text: `公司披露商誉与治理风险。`, kind: 'fact', evidence: [{ sourceCandidateId: 'filing-1', location: 'paragraph:1' }] }], risks: [`公司存在需跟踪的风险。${ref}`] })
  const result = await executeCompanyResearchMethod({ skillId: 'company_risk_analysis', company: { symbol: '002594' }, asOf: '2026-10-14', sources: [filing], reportSourceCandidateIds: ['filing-1'], reasoningExecutor: executor(async () => makeOutput(`${goodwillRow}\n${mergedMitigationRow}`)) })
  assert.equal(result.status, 'complete', JSON.stringify(result.diagnostics))
  assert.equal(result.attempts, 1)
  assert.deepEqual(result.attemptOutputs?.[0]?.formatRepairs, [
    'risks line 3: merged explicit goodwill disclosure into residual-risk cell',
    'risks line 4: split explicitly labeled residual-risk text into fifth cell',
  ])
  const repaired = result.sections.find(section => section.id === 'risks')?.markdown
  assert.ok(repaired?.includes(repairedGoodwillRow))
  assert.ok(repaired?.includes(repairedGovernanceRow))
  for (const token of ['商誉原值合计', '[filing-1@paragraph:1]', '未提供完整账面价值', '执行效果和继任安排']) assert.ok(repaired?.includes(token), `repair preserves ${token}`)

  const ambiguousRows = [
    `| 非商誉经营风险 | 可能导致经营波动 ${ref} | 经营指标 | 已披露缓释 ${ref} | 商誉原值 ${ref} | 未提供敏感度 ${ref} |`,
    `| 商誉与估值 | 预测偏差可能导致减值 ${ref} | 现金流 | 已披露测试 ${ref} | 账面价值资料 ${ref} | 尚待补充资料 ${ref} |`,
    `| 治理与关键人 | 权力集中可能增加依赖 ${ref} | 继任 | 公司披露内控 ${ref}；执行效果尚待核验 ${ref} |`,
  ]
  for (const row of ambiguousRows) {
    let calls = 0
    const blocked = await executeCompanyResearchMethod({ skillId: 'company_risk_analysis', company: { symbol: '002594' }, asOf: '2026-10-14', sources: [filing], reportSourceCandidateIds: ['filing-1'], reasoningExecutor: executor(async () => { calls++; return makeOutput(row) }) })
    assert.equal(calls, 2)
    assert.notEqual(blocked.status, 'complete')
    assert.deepEqual(blocked.attemptOutputs?.map(attempt => attempt.formatRepairs ?? []), [[], []])
  }
  const changedHeader = header.replace('残余风险', '其他事项')
  let calls = 0
  const wrongHeader = await executeCompanyResearchMethod({ skillId: 'company_risk_analysis', company: { symbol: '002594' }, asOf: '2026-10-14', sources: [filing], reportSourceCandidateIds: ['filing-1'], reasoningExecutor: executor(async () => { calls++; return makeOutput(goodwillRow, changedHeader) }) })
  assert.equal(calls, 2)
  assert.notEqual(wrongHeader.status, 'complete')
  assert.deepEqual(wrongHeader.attemptOutputs?.map(attempt => attempt.formatRepairs ?? []), [[], []])
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
    assert.deepEqual(requestInput.repairPreviousOutput, broken)
    assert.deepEqual(new Set(requestInput.repairNumericIssues.map((issue: any) => issue.id)), new Set(['company-overview', 'method-summary', 'method-answer', 'finding-1']))
    assert.deepEqual(requestInput.repairTargets.map((target: any) => target.fieldPath), ['sections[0].markdown', 'markdown', 'answer', 'findings[0]'])
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
  assert.equal(calls, 2, JSON.stringify(result.diagnostics))
  assert.deepEqual(result.limitations, broken.limitations)
  assert.deepEqual((result.attemptOutputs?.[1]?.reasoningInput as any).repairPreviousOutput, broken)
  assert.deepEqual((result.attemptOutputs?.[1]?.reasoningInput as any).repairTargets.map((target: any) => target.fieldPath), ['sections[0].markdown', 'markdown', 'answer', 'findings[0]'])
})

test('numeric-only method retry applies only targeted fields and discards unrelated retry citation mutations', async () => {
  const filing = { ...source, content: '公司业务增长需要跟踪经营兑现。公司披露了扩产计划及经营风险。' }
  const ref = { sourceCandidateId: 'filing-1', location: 'paragraph:1' }
  const original = {
    status: 'complete', answer: '公司增长与经营兑现并存。', markdown: '研究结论保持审慎。[filing-1@paragraph:1]',
    sections: [
      { id: 'revenue-profit-drivers', markdown: '收入变化须结合业务结构判断。[filing-1@paragraph:1]' },
      { id: 'growth-drivers', markdown: '待验证驱动增长999.99%。[filing-1@paragraph:1]' },
      { id: 'catalysts', markdown: '扩产计划仍须由客户交付验证。[filing-1@paragraph:1]' },
    ],
    findings: [{ text: '扩产兑现仍需后续验证。', kind: 'inference', evidence: [ref] }], limitations: [], risks: [],
  }
  const retried = {
    ...original,
    sections: [
      original.sections[0],
      { id: 'growth-drivers', markdown: '需求与扩产是待验证驱动，不能直接推定收入贡献。[filing-1@paragraph:1]' },
      { id: 'catalysts', markdown: '扩产已经成功并带来显著订单。[official-unknown@paragraph:1]' },
    ],
  }
  let calls = 0
  const result = await executeCompanyResearchMethod({ skillId: 'business_driver_analysis', company: { symbol: '002384' }, asOf: '2026-10-17', sources: [filing], reportSourceCandidateIds: ['filing-1'], reasoningExecutor: executor(async () => ++calls === 1 ? original : retried) })
  assert.equal(result.status, 'complete', JSON.stringify(result.diagnostics))
  assert.equal(calls, 2)
  assert.equal(result.sections.find(section => section.id === 'growth-drivers')?.markdown, retried.sections[1]!.markdown)
  assert.equal(result.sections.find(section => section.id === 'catalysts')?.markdown, original.sections[2]!.markdown)
  assert.equal(result.sections.some(section => section.markdown.includes('official-unknown')), false)
})

test('business-driver retry after citation failure accepts corrected citation and numeric repair together', async () => {
  const filing = { ...source, content: '公司营业收入同比增长10%。公司业务增长仍需结合经营兑现判断。' }
  const original = {
    status: 'complete', answer: '增长判断需要持续跟踪。', markdown: '收入增长仍需观察。[filing-1@paragraph:1]',
    sections: [
      { id: 'revenue-profit-drivers', markdown: '收入同比增长999.99%。[filing-1@paragraph:1]' },
      { id: 'growth-drivers', markdown: '业务扩张是潜在驱动。[official-unknown@paragraph:1]' },
      { id: 'catalysts', markdown: '后续观察经营兑现。[filing-1@paragraph:1]' },
    ],
    findings: [{ text: '收入同比增长999.99%。', kind: 'fact' as const, evidence: [{ sourceCandidateId: 'filing-1', location: 'paragraph:1' }] }], limitations: [], risks: [],
  }
  const corrected = {
    ...original,
    sections: [
      { id: 'revenue-profit-drivers', markdown: '公司披露收入同比增长10.00%。[filing-1@paragraph:1]' },
      { id: 'growth-drivers', markdown: '业务扩张是潜在驱动，仍需观察经营兑现。[filing-1@paragraph:1]' },
      original.sections[2],
    ],
    findings: [{ text: '公司披露收入同比增长10.00%。', kind: 'fact' as const, evidence: [{ sourceCandidateId: 'filing-1', location: 'paragraph:1' }] }],
  }
  let calls = 0
  const result = await executeCompanyResearchMethod({ skillId: 'business_driver_analysis', company: { symbol: '002384' }, asOf: '2026-10-17', sources: [filing], reportSourceCandidateIds: ['filing-1'], reasoningExecutor: executor(async request => {
    calls++
    if (calls === 1) return original
    const requestInput = (request as any).input
    assert.equal(requestInput.repairErrors[0].code, 'REFERENCE_ERROR')
    assert.ok(requestInput.repairNumericIssues.length > 0, JSON.stringify(requestInput.repairNumericIssues))
    return corrected
  }) })
  assert.equal(calls, 2)
  assert.equal(result.status, 'complete', JSON.stringify(result.diagnostics))
  assert.equal(result.sections.find(section => section.id === 'growth-drivers')?.markdown, corrected.sections[1]!.markdown)
  assert.equal(result.sections.some(section => section.markdown.includes('official-unknown')), false)
})

test('numeric-only retry carries a corrected exact source id without importing unrelated prose changes', async () => {
  const filing = { ...source, content: '公司业务仍需跟踪经营兑现。公司披露扩产计划。' }
  const original = {
    status: 'complete', answer: '增长与经营兑现并存。', markdown: '研究结论保持审慎。[filing-1@paragraph:1]',
    sections: [
      { id: 'revenue-profit-drivers', markdown: '收入变化须结合业务结构判断。[filing-1@paragraph:1]' },
      { id: 'growth-drivers', markdown: '收入增速为999.99%。[filing-1@paragraph:1]' },
      { id: 'catalysts', markdown: '扩产仍在观察。[filing-1x@paragraph:1]' },
    ],
    findings: [{ text: '扩产计划待兑现。', kind: 'inference', evidence: [{ sourceCandidateId: 'filing-1', location: 'paragraph:1' }] }], limitations: [], risks: [],
  }
  const retry = {
    ...original,
    sections: [
      original.sections[0],
      { id: 'growth-drivers', markdown: '收入增长的精确数值缺少直接证据。[filing-1@paragraph:1]' },
      { id: 'catalysts', markdown: '扩产已经成功并带来订单。[filing-1@paragraph:1]' },
    ],
  }
  let calls = 0
  const result = await executeCompanyResearchMethod({ skillId: 'business_driver_analysis', company: { symbol: '002384' }, asOf: '2026-10-17', sources: [filing], reportSourceCandidateIds: ['filing-1'], reasoningExecutor: executor(async () => ++calls === 1 ? original : retry) })
  assert.equal(calls, 2)
  assert.equal(result.status, 'complete', JSON.stringify(result.diagnostics))
  const catalysts = result.sections.find(section => section.id === 'catalysts')!.markdown
  assert.equal(catalysts, '扩产仍在观察。[filing-1@paragraph:1]')
  assert.equal(catalysts.includes('已经成功'), false)
  assert.equal(catalysts.includes('filing-1x'), false)
})

test('risk numeric retry discovers the exact same-report annual goodwill total row after stripping a unit suffix', async () => {
  const annualLines = Array.from({ length: 7662 }, (_, index) => `年报经营情况第${index + 1}段。`)
  annualLines[7659] = '（1）商誉原值合计'
  annualLines[7660] = '单位：元'
  annualLines[7658] = '索尔思光电 2,825,093,512.48 -26,063,415.57 2,799,030,096.91'
  annualLines[7661] = '合计 2,289,543,588.01 2,825,093,512.48 -26,063,415.57 50,502,380.96 5,038,071,303.96'
  const annual = { ...source, title: '2025年年度报告', content: annualLines.join('\n') }
  const halfYear = { ...source, candidate: { ...source.candidate, candidateId: 'half-year', title: '2026年半年度报告' }, title: '2026年半年度报告', content: '商誉期初余额 5,038,071,303.96 元。' }
  const broken = {
    status: 'complete', answer: '商誉并购风险仍需关注。', markdown: '商誉并购风险仍需关注。[filing-1@paragraph:7662]',
    sections: [{ id: 'risks', markdown: '2025年年报披露商誉原值合计人民币5,038,071,303.96元。[filing-1@paragraph:7661] [filing-1@paragraph:7660]' }],
    findings: [{ text: '2025年年报披露商誉原值合计人民币5,038,071,303.96元。', kind: 'fact', evidence: [{ sourceCandidateId: 'filing-1', location: 'paragraph:7661' }, { sourceCandidateId: 'filing-1', location: 'paragraph:7660' }] }],
    limitations: [], risks: ['商誉减值会影响利润和资产价值。'],
  }
  const fixed = {
    ...broken,
    sections: [{ id: 'risks', markdown: '2025年年报披露商誉原值合计人民币5,038,071,303.96元。[filing-1@paragraph:7661] [filing-1@paragraph:7662]' }],
    findings: [{ text: '2025年年报披露商誉原值合计人民币5,038,071,303.96元。', kind: 'fact', evidence: [{ sourceCandidateId: 'filing-1', location: 'paragraph:7661' }, { sourceCandidateId: 'filing-1', location: 'paragraph:7662' }] }],
  }
  let calls = 0
  const result = await executeCompanyResearchMethod({ skillId: 'company_risk_analysis', company: { symbol: '002384' }, asOf: '2026-10-17', sources: [annual, halfYear], reportSourceCandidateIds: ['filing-1', 'half-year'], reasoningExecutor: executor(async request => {
    if (++calls === 1) return broken
    const requestInput = (request as any).input
    if (!requestInput.repairTargets) return broken
    const riskTarget = requestInput.repairTargets.find((target: any) => target.id === 'risks')
    assert.ok(riskTarget.candidateExcerpts.some((excerpt: any) => excerpt.sourceCandidateId === 'filing-1' && excerpt.location === 'paragraph:7662' && excerpt.text.includes('5,038,071,303.96')), JSON.stringify(riskTarget.candidateExcerpts))
    assert.equal(riskTarget.candidateExcerpts[0]?.sourceCandidateId, 'filing-1', 'prefer the exact row from the report already cited by the claim')
    return fixed
  }) })
  assert.equal(result.status, 'complete', JSON.stringify(result.diagnostics))
  assert.ok(result.sections[0]!.markdown.includes('[filing-1@paragraph:7662]'), result.sections[0]!.markdown)
  assert.ok(!result.sections[0]!.markdown.includes('[half-year@'), result.sections[0]!.markdown)
})

test('risk numeric retry strips 千元 and supplies the matching goodwill row as a citation candidate', async () => {
  const annualLines = Array.from({ length: 7662 }, (_, index) => `年报经营情况第${index + 1}段。`)
  annualLines[7659] = '（1）商誉原值合计'
  annualLines[7660] = '单位：人民币千元'
  annualLines[7661] = '合计 4,437,242 - - 4,437,242'
  annualLines[7662] = 'Juno Newco 商誉原值 4,361,657千元 - - 4,361,657千元'
  const annual = { ...source, title: '2025年年度报告', content: annualLines.join('\n') }
  const broken = {
    status: 'complete', answer: '商誉估值风险需要监控。', markdown: '商誉风险来自资产组预测兑现情况。',
    sections: [{ id: 'risks', markdown: 'Juno Newco商誉原值为4,361,657千元。[filing-1@paragraph:9999]' }],
    findings: [{ text: 'Juno Newco商誉原值需要结合资产组预测持续评估。', kind: 'inference', evidence: [{ sourceCandidateId: 'filing-1', location: 'paragraph:9999' }] }],
    limitations: [], risks: ['预测未兑现可能降低资产组可收回金额。'],
  }
  const fixed = {
    ...broken,
    sections: [{ id: 'risks', markdown: 'Juno Newco商誉原值为4,361,657千元。[filing-1@paragraph:7662] [filing-1@paragraph:7661]' }],
    findings: [{ text: 'Juno Newco商誉原值需要结合资产组预测持续评估。', kind: 'inference', evidence: [{ sourceCandidateId: 'filing-1', location: 'paragraph:7662' }] }],
  }
  let calls = 0
  const result = await executeCompanyResearchMethod({ skillId: 'company_risk_analysis', company: { symbol: '002384' }, asOf: '2026-10-17', sources: [annual], reportSourceCandidateIds: ['filing-1'], reasoningExecutor: executor(async request => {
    if (++calls === 1) return broken
    const input = (request as any).input
    const riskTarget = input.repairTargets.find((target: any) => target.id === 'risks')
    assert.ok(riskTarget.candidateExcerpts.some((excerpt: any) => excerpt.sourceCandidateId === 'filing-1' && excerpt.location === 'paragraph:7663' && excerpt.text.includes('4,361,657')), JSON.stringify(riskTarget.candidateExcerpts))
    assert.deepEqual(input.repairPreviousOutput, broken, 'candidate rows are hints and must not be attached to the draft automatically')
    assert.equal(riskTarget.originalText, broken.sections[0]!.markdown)
    return fixed
  }) })
  assert.equal(calls, 2, JSON.stringify({ status: result.status, diagnostics: result.diagnostics }))
  assert.equal(result.status, 'complete', JSON.stringify(result.diagnostics))
  assert.ok(result.sections[0]!.markdown.includes('[filing-1@paragraph:7663]'), result.sections[0]!.markdown)
})

test('financial-quality findings bind an exact split industry row and remove paragraph locators from prose', async () => {
  const annualLines = Array.from({ length: 734 }, (_, index) => `经营情况第${index + 1}段。`)
  annualLines[715] = '单位：元'
  annualLines[716] = '营业收入 营业成本 毛利率'
  annualLines[717] = '营业收入'
  annualLines[718] = '比上年同期'
  annualLines[719] = '期增减'
  annualLines[720] = '营业成本'
  annualLines[721] = '比上年同期'
  annualLines[722] = '期增减'
  annualLines[723] = '毛利率比'
  annualLines[724] = '上年同期'
  annualLines[725] = '增减'
  annualLines[726] = '分行业'
  annualLines[727] = '日用电子器件制造业 69,404,994,000.00 65,907,931,000.00 5.04% 0.96% 3.88% -2.67%'
  annualLines[728] = '交通运输设备及电气制'
  annualLines[729] = '造业 275,341,358,000.00 213,863,297,000.00 22.33% -8.98% -11.24% 1.98%'
  const annual = { ...source, title: '2026年半年度报告', content: annualLines.join('\n') }
  const headerRefs = [716, 717, 724, 725, 726, 727].map(location => ({ sourceCandidateId: 'filing-1', location: `paragraph:${location}` }))
  const output = {
    status: 'complete', answer: '分行业毛利率表现存在差异。', markdown: '分行业数据需要结合完整行标签和可比口径阅读。',
    sections: [{ id: 'financial-quality', markdown: '分行业表列示交通运输设备及电气制造业毛利率22.33%，同比上升1.98%。[filing-1@paragraph:716] [filing-1@paragraph:717] [filing-1@paragraph:724] [filing-1@paragraph:725] [filing-1@paragraph:726] [filing-1@paragraph:727] [filing-1@paragraph:729] [filing-1@paragraph:730]' }],
    findings: [{ text: '事实：半年报分行业表列示：交通运输设备及电气制造业毛利率22.33%，同比上升1.98%。行业标签由paragraph:729与paragraph:730两行组成，数据行为paragraph:730；毛利率变动单位沿用原表的%。', kind: 'fact', evidence: headerRefs }],
    limitations: [], risks: [],
  }
  const result = await executeCompanyResearchMethod({ skillId: 'financial_quality_analysis', company: { symbol: '002594' }, asOf: '2026-10-23', sources: [annual], reportSourceCandidateIds: ['filing-1'], reasoningExecutor: executor(async () => output) })
  assert.equal(result.status, 'complete', JSON.stringify(result.diagnostics))
  const finding = result.findings[0]!
  assert.doesNotMatch(finding.text, /(?:paragraph:\d+|段落\s*\d+)/i)
  assert.ok(finding.evidence.some(ref => ref.sourceCandidateId === 'filing-1' && ref.location === 'paragraph:729'))
  assert.ok(finding.evidence.some(ref => ref.sourceCandidateId === 'filing-1' && ref.location === 'paragraph:730'))
})

test('risk numeric retry does not preserve a positive goodwill increase from a negative source movement', async () => {
  const annual = { ...source, title:'2025年年度报告', content:[
    '商誉原值',
    '单位：元',
    '被投资单位 年初余额 本年增加 本年减少 年末余额',
    '索尔思光电 2,825,093,512.48 -26,063,415.57 2,799,030,096.91',
  ].join('\n') }
  const broken = {
    ...output,
    answer:'商誉变化需要监控。',markdown:'商誉变化需要监控。[filing-1@paragraph:4]',
    sections:[{id:'risks',markdown:'|风险|触发条件与影响路径|监控信号|缓解及残余风险|\n|---|---|---|---|\n|商誉变动|索尔思光电商誉增加26,063,415.57元。[filing-1@paragraph:2] [filing-1@paragraph:3] [filing-1@paragraph:4]，若资产组表现不及预期可能发生减值并压低利润。|商誉余额及减值|需跟踪资产组现金流，当前未提供减值测试参数。|'}],
    findings:[{text:'索尔思光电商誉增加26,063,415.57元。',kind:'fact',evidence:[{sourceCandidateId:'filing-1',location:'paragraph:2'},{sourceCandidateId:'filing-1',location:'paragraph:3'},{sourceCandidateId:'filing-1',location:'paragraph:4'}]}],
    risks:['若资产组经营表现不及预期，商誉可能减值并影响利润。'],
  }
  const fixed = {
    ...broken,
    sections:[{...broken.sections[0]!,markdown:broken.sections[0]!.markdown.replace('增加26,063,415.57元','减少26,063,415.57元')}],
    findings:[{...broken.findings[0]!,text:'索尔思光电商誉原值本年减少26,063,415.57元。'}],
  }
  let calls=0
  const result=await executeCompanyResearchMethod({skillId:'company_risk_analysis',company:{symbol:'002384'},asOf:'2026-10-17',sources:[annual],reportSourceCandidateIds:['filing-1'],reasoningExecutor:executor(async request=>{
    if(++calls===1)return broken
    const input=(request as any).input
    assert.equal(input.repairErrors[0].code,'NUMERIC_GROUNDING_ERROR')
    assert.match(input.repairInstruction,/原文金额前的负号必须保留/)
    assert.ok(!input.repairInstruction.includes('26,063,415.57（来源为负值，正文明确写作减少幅度） → filing-1@paragraph:4'))
    return fixed
  })})
  assert.equal(result.status,'complete',JSON.stringify(result.diagnostics))
  assert.equal(calls,2)
  assert.match(result.findings[0]!.text,/减少26,063,415\.57元/)
})

test('reference repair reports independent numeric defects in the same bounded retry', async () => {
  const history = { ...source, content: '2026年上半年累计经营现金净流量37334744000元，购建长期资产现金支出44703066000元。' }
  const validRef = { sourceCandidateId: 'filing-1', location: 'paragraph:1' }
  const textWithoutPeriod = '推断：简化自由现金流为373.35亿元经营现金流减447.03亿元资本开支，即-73.68亿元。'
  const fixedFinding = '推断：2026年上半年累计简化自由现金流为373.35亿元经营现金流减447.03亿元资本开支，即-73.68亿元。'
  const broken = {
    ...output,
    answer: '现金流风险需要持续监控。', markdown: '现金流风险需要持续监控。',
    sections: [{ id: 'risks', markdown: `| 财务 | 若现金流覆盖不足，融资需求可能上升。 | 跟踪经营现金流和资本开支。 | 经营现金流为正。 | 未披露项目回报。 |\n|---|---|---|---|---|\n| 现金覆盖 | 2026年上半年累计简化自由现金流373.35亿元−447.03亿元＝-73.68亿元。[filing-1@paragraph:999] | 同期经营现金流与资本开支。 | 经营现金流为正。[filing-1@paragraph:1] | 仍需核验项目回报。[filing-1@paragraph:1] |` }],
    findings: [{ text: textWithoutPeriod, kind: 'inference', evidence: [validRef] }],
    risks: ['资本开支持续超出经营现金覆盖可能增加融资需求。'],
  }
  const fixed = { ...broken, sections: [{ ...broken.sections[0]!, markdown: broken.sections[0]!.markdown.replace('paragraph:999', 'paragraph:1') }], findings: [{ ...broken.findings[0]!, text: fixedFinding }] }
  const preparedAnalysis = { financial: { simpleFreeCashFlow: [{ period: '2026-06-30', basis: 'YTD', unit: 'CNY', value: -7_368_322_000, operatingCashFlow: 37_334_744_000, capex: 44_703_066_000, displayValue: '-73.68', displayUnit: '亿元', displayOperatingCashFlow: '373.35', displayCapex: '447.03', formula: '373.35亿元−447.03亿元＝-73.68亿元', sourceCandidateIds: ['filing-1'] }] } }
  const fixedGrounding = validateCompanyNumericGrounding({ markdown: `${fixedFinding} [filing-1@paragraph:1]`, sources: [history], preparedAnalysis })
  assert.equal(fixedGrounding.status, 'grounded', JSON.stringify(fixedGrounding.diagnostics))
  let calls = 0
  const result = await executeCompanyResearchMethod({ skillId: 'company_risk_analysis', company: { symbol: '002594' }, asOf: '2026-10-14', sources: [history], reportSourceCandidateIds: ['filing-1'], preparedAnalysis, reasoningExecutor: executor(async request => {
    calls++
    if (calls === 1) return broken
    const input = (request as any).input
    assert.equal(input.repairErrors[0].code, 'REFERENCE_ERROR')
    assert.ok(input.repairNumericIssues.some((issue: any) => issue.id === 'finding-1'), JSON.stringify(input.repairNumericIssues))
    assert.match(input.repairInstruction, /repairNumericIssues列出本次已独立检测到的数值错误/)
    return fixed
  }) })
  assert.equal(result.status, 'complete', JSON.stringify(result.diagnostics))
  assert.equal(result.attempts, 2)
  assert.equal(calls, 2)
})

test('risk numeric retry preserves each grounded customer ratio citation and repairs only from its exact numeric row', async () => {
  const paragraphs = Array.from({ length: 930 }, (_, index) => `年报一般经营描述第${index + 1}段。`)
  paragraphs[705] = '分产品收入占比：电子及其他产品 20.13%。'
  paragraphs[917] = '前五大客户销售额占年度销售总额比例 18.12%。'
  paragraphs[918] = '相邻客户明细说明，不含前述比例。'
  paragraphs[921] = '客户一销售额占年度销售总额比例 12.53%。'
  paragraphs[922] = '客户二销售额占年度销售总额比例 2.05%。'
  paragraphs[927] = '相邻表格说明，不含前述客户比例。'
  const filing = { ...source, title: '2025年度报告', content: paragraphs.join('\n') }
  const refs = (locations: number[]) => locations.map(location => ({ sourceCandidateId: 'filing-1', location: `paragraph:${location}` }))
  const broken = {
    ...output,
    answer: '公司面临产品结构与客户集中相关风险。', markdown: '公司面临产品结构与客户集中相关风险。',
    sections: [{ id: 'risks', markdown: [
      '| 风险 | 触发条件与影响路径 | 监控指标 | 缓解及残余风险 |',
      '|---|---|---|---|',
      '| 产品结构风险 | 电子及其他产品收入占比20.13%。[filing-1@paragraph:919] 若需求波动可能影响收入结构。 | 分产品收入占比 | 产品多元化缓解，具体替代速度待观察。 |',
      '| 客户集中风险 | 前五大客户占比18.12%。[filing-1@paragraph:918] | 客户集中度 | 客户匿名，替代能力待观察。 |',
      '| 大客户依赖 | 最大客户占比12.53%。[filing-1@paragraph:922] | 最大客户占比 | 客户匿名，业务映射未披露。 |',
      '| 次大客户依赖 | 第二大客户占比2.05%。[filing-1@paragraph:923] | 第二大客户占比 | 暴露较低但客户身份未知。 |',
    ].join('\n') }],
    findings: [{ text: '前五大客户占比18.12%。最大客户占比12.53%，第二大客户占比2.05%。', kind: 'fact', evidence: refs([918, 922, 923]) }],
  }
  let calls = 0
  const result = await executeCompanyResearchMethod({ skillId: 'company_risk_analysis', company: { symbol: '002594' }, asOf: '2026-10-14', sources: [filing], reportSourceCandidateIds: ['filing-1'], reasoningExecutor: executor(async request => {
    if (++calls === 1) return broken
    const input = (request as any).input
    assert.equal(input.repairErrors[0].code, 'NUMERIC_GROUNDING_ERROR')
    const repairInstruction = input.repairInstruction as string
    for (const pair of ['18.12% → filing-1@paragraph:918', '12.53% → filing-1@paragraph:922', '2.05% → filing-1@paragraph:923']) assert.ok(repairInstruction.includes(pair), `${pair}\n${repairInstruction}`)
    assert.match(repairInstruction, /禁止用p919、p928或任何相邻段落支持客户占比/)
    const numericTarget = input.repairTargets.find((target: any) => target.id === 'risks')
    assert.ok(!numericTarget?.candidateExcerpts?.some((candidate: any) => candidate.location === 'paragraph:919' || candidate.location === 'paragraph:928'), JSON.stringify(numericTarget))
    const fixed = {
      ...broken,
      sections: [{ ...broken.sections[0]!, markdown: broken.sections[0]!.markdown
        .replace('电子及其他产品收入占比20.13%。[filing-1@paragraph:919]', '电子及其他产品收入占比暂不量化，因本次输入缺少对应数值行。') }],
    }
    return fixed
  }) })
  assert.equal(result.status, 'complete', JSON.stringify(result.diagnostics))
  assert.equal(result.attempts, 2)
  assert.equal(calls, 2)
})

test('risk governance retry removes an unavailable paragraph claim and records the missing governance evidence', async () => {
  const selectedDisclosure={...source,title:'风险补充资料',content:'公司披露重大诉讼风险可能影响经营和现金流。'}
  const unselectedAnnual={...source,candidate:{...source.candidate,candidateId:'official-39e591fa149e4543',title:'2025年度报告'},title:'2025年度报告',content:'年报原文未纳入本次方法证据包。'}
  const riskPacket=selectCompanyEvidence([selectedDisclosure],['filing-1'],['风险','诉讼','客户','商誉'],{purpose:'company_risk_analysis'})[0]!
  const litigationLocation=riskPacket.excerpts.find(excerpt=>excerpt.text.includes('重大诉讼'))!.location
  const broken={...output,answer:'公司治理制度可缓释风险。',markdown:'公司治理制度可缓释风险。',sections:[{id:'risks',markdown:`| 风险 | 触发与影响 | 监控及缓解 |\n|---|---|---|\n| 治理 | 年报披露实际控制人兼任董事长、总裁并设有关联交易制度。[official-39e591fa149e4543@paragraph:1] | 检查制衡执行。 |\n| 诉讼 | 公司披露诉讼风险可能影响经营。[filing-1@${litigationLocation}] | 跟踪诉讼进展。 |`}],findings:[{text:'公司披露诉讼风险可能影响经营。',kind:'fact' as const,evidence:[{sourceCandidateId:'filing-1',location:litigationLocation}]}]}
  let calls=0
  const result=await executeCompanyResearchMethod({skillId:'company_risk_analysis',company:{symbol:'002384'},asOf:'2026-10-14',sources:[selectedDisclosure,unselectedAnnual],reportSourceCandidateIds:['filing-1'],reasoningExecutor:executor(async request=>{
    calls++
    if(calls===1)return broken
    const input=(request as any).input
    assert.equal(input.repairErrors[0].code,'REFERENCE_ERROR')
    assert.match(input.repairInstruction,/paragraph:1不在本方法实际供给的证据片段/)
    assert.match(input.repairInstruction,/不得继续声称年报披露了这些具体安排/)
    return {...broken,answer:'本次风险证据未包含治理安排原文，需补采以评估治理执行风险。',markdown:'本次风险证据未包含治理安排原文，需补采以评估治理执行风险。',sections:[{id:'risks',markdown:`| 风险 | 触发与影响 | 监控及缓解 |\n|---|---|---|\n| 治理 | 本次风险证据未包含治理安排原文，无法验证制衡、回避执行、内控整改或继任风险，需补采治理/内控原文。 | 跟踪董事会审议、回避和内控整改证据。 |\n| 诉讼 | 公司披露诉讼风险可能影响经营。[filing-1@${litigationLocation}] | 跟踪诉讼进展。 |`}],findings:[{text:'公司披露诉讼风险可能影响经营。',kind:'fact' as const,evidence:[{sourceCandidateId:'filing-1',location:litigationLocation}]}]}
  })})
  assert.equal(calls,2)
  assert.equal(result.status,'complete',JSON.stringify(result.diagnostics))
  assert.doesNotMatch(result.sections[0]!.markdown,/official-39e591fa149e4543@paragraph:1/)
})

test('reference-first repair gives numeric failures exact supplied excerpt candidates without attaching them', async () => {
  const paragraphs = Array.from({ length: 932 }, (_, index) => `年报一般经营描述第${index + 1}段。`)
  paragraphs[821] = '汽车相关产品销售额为648,645,636,000.00元。'
  paragraphs[916] = '前五大客户销售额合计（元）。'
  paragraphs[917] = '前五大客户销售额145,648,095,000.00元，占年度销售额18.12%。'
  paragraphs[926] = '前五大客户销售额合计145,648,095,000.00元。'
  paragraphs[930] = '前五大供应商采购额合计（元）。'
  paragraphs[931] = '前五大供应商采购额98,700,166,000.00元，占年度采购额15.31%。'
  const filing = { ...source, content: paragraphs.join('\n') }
  const refs = (locations: number[]) => locations.map(location => ({ sourceCandidateId: 'filing-1', location: `paragraph:${location}` }))
  const invalid = [{ sourceCandidateId: 'filing-1', location: 'paragraph:999' }]
  const broken = {
    status: 'complete', answer: '公司业务具有多元结构。', markdown: '业务结构需要结合收入和客户数据分析。',
    sections: [
      { id: 'business-model', markdown: '公司通过产品销售实现收入。[filing-1@paragraph:999]' },
      { id: 'business-segments', markdown: '汽车相关产品贡献收入。[filing-1@paragraph:999]' },
      { id: 'supply-chain', markdown: '供应商结构需要持续监控。[filing-1@paragraph:999]' },
    ],
    findings: [
      { text: '汽车相关产品销售额为648,645,636,000.00元。', kind: 'fact', evidence: invalid },
      { text: '前五大客户销售额为145,648,095,000.00元，占18.12%。', kind: 'fact', evidence: invalid },
      { text: '前五大供应商采购额为98,700,166,000.00元，占15.31%。', kind: 'fact', evidence: invalid },
    ], limitations: [], risks: [],
  }
  let calls = 0
  const result = await executeCompanyResearchMethod({ skillId: 'business_model_map', company: { symbol: '002594' }, asOf: '2026-10-14', sources: [filing], reportSourceCandidateIds: ['filing-1'], reasoningExecutor: executor(async request => {
    calls++
    if (calls === 1) return broken
    const input = (request as any).input
    assert.equal(input.repairErrors[0].code, 'REFERENCE_ERROR')
    const targets = input.repairTargets
    assert.deepEqual(targets.map((target: any) => target.fieldPath), ['findings[0]', 'findings[1]', 'findings[2]'])
    const candidates = (index: number) => targets[index].candidateExcerpts.map((item: any) => `${item.sourceCandidateId}@${item.location}`)
    assert.ok(candidates(0).includes('filing-1@paragraph:822'), JSON.stringify(candidates(0)))
    assert.ok(candidates(1).includes('filing-1@paragraph:918'), JSON.stringify(candidates(1)))
    assert.ok(candidates(1).includes('filing-1@paragraph:927'), JSON.stringify(candidates(1)))
    assert.ok(candidates(2).includes('filing-1@paragraph:932'), JSON.stringify(candidates(2)))
    for (const target of targets) for (const candidate of target.candidateExcerpts) {
      assert.ok(target.issues.some((issue: any) => issue.token === candidate.token))
    }
    assert.deepEqual(targets.map((target: any) => target.originalText), broken.findings.map(finding => finding.text))
    assert.deepEqual(input.repairPreviousOutput, broken)
    // Candidate excerpts are hints only: the retry itself must choose and cite
    // rows; the adapter never adds them to the finding's evidence array.
    return {
      ...broken,
      sections: [
        { id: 'business-model', markdown: '公司通过产品销售实现收入。[filing-1@paragraph:822]' },
        { id: 'business-segments', markdown: '汽车相关产品贡献收入。[filing-1@paragraph:822]' },
        { id: 'supply-chain', markdown: '供应商结构需要持续监控。[filing-1@paragraph:932]' },
      ],
      findings: [
        { ...broken.findings[0]!, evidence: refs([822]) },
        { ...broken.findings[1]!, evidence: refs([917, 918]) },
        { ...broken.findings[2]!, evidence: refs([931, 932]) },
      ],
    }
  }) })
  assert.equal(calls, 2)
  assert.equal(result.status, 'complete', JSON.stringify(result.diagnostics))
  assert.deepEqual(result.findings.map(finding => finding.evidence.map(ref => ref.location)), [['paragraph:822'], ['paragraph:917', 'paragraph:918'], ['paragraph:931', 'paragraph:932']])
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

test('a mixed finding repair targets its evidence array and shows actual cited text without automatically borrowing another source', async () => {
  const legal = { ...source, content: '公司于2001年改制，完成战略转型。' }
  const business = { ...source, candidate: { ...source.candidate, candidateId: 'company-page' }, content: '公司于1997年成立，开始经营。' }
  const firstRef = { sourceCandidateId: 'filing-1', location: 'paragraph:1' }
  const missing = { ...output, markdown: '公司发生业务转型。[filing-1@paragraph:1]', sections: [{ id: 'company-overview', markdown: '公司发展经历不同法律和经营阶段。[filing-1@paragraph:1]' }], findings: [{ text: '公司于2001年改制，与1997年成立口径不同。', kind: 'fact', evidence: [firstRef] }] }
  const fixed = { ...missing, findings: [{ ...missing.findings[0]!, evidence: [firstRef, { sourceCandidateId: 'company-page', location: 'paragraph:1' }] }] }
  const base = { skillId: 'company_history_strategy' as const, company: { symbol: '002594' }, asOf: '2026-10-14', sources: [legal, business], reportSourceCandidateIds: ['filing-1', 'company-page'] }
  let calls = 0
  const result = await executeCompanyResearchMethod({ ...base, reasoningExecutor: executor(async (request) => {
    if (++calls === 1) return missing
    const actual = (request as any).input
    const target = actual.repairTargets[0]
    assert.equal(target.fieldPath, 'findings[0]')
    assert.equal(target.textFieldPath, 'findings[0].text')
    assert.equal(target.evidenceFieldPath, 'findings[0].evidence')
    assert.deepEqual(target.citedEvidence.map((ref: any) => ref.sourceCandidateId), ['filing-1'])
    assert.equal(target.citedEvidence[0].text, legal.content)
    assert.ok(actual.repairEvidenceGuide.some((guide: any) => guide.sourceCandidateId === 'company-page' && guide.suppliedExcerptsPath.startsWith('evidence[')))
    assert.match(actual.repairInstruction, /分别补齐支持各数字及同一科目/)
    assert.deepEqual(actual.repairPreviousOutput.findings[0].evidence, [firstRef], 'Repair guidance must not silently mutate the original draft')
    return fixed
  }) })
  assert.equal(result.status, 'complete')
  assert.equal(result.attempts, 2)
  const unchanged = await executeCompanyResearchMethod({ ...base, reasoningExecutor: executor(async () => missing) })
  assert.equal(unchanged.status, 'failed')
  assert.equal(unchanged.attempts, 2)
  assert.ok(unchanged.diagnostics.every((diagnostic) => diagnostic.code === 'NUMERIC_GROUNDING_ERROR'))
})

test('each actual request is snapshotted before dispatch, including a failed call and exact canonical methodology', async () => {
  const history = { ...source, content: source.content.replace('核心产品业务收入及客户模式。', '核心产品业务收入及客户模式，战略转型历史。') }
  const methodology = '# 公司历史方法\n原始方法版本，逐项核对事实。'
  const prepared = { governance: { note: 'original input' } }
  const requests: any[] = []
  const result = await executeCompanyResearchMethod({ skillId: 'company_history_strategy', company: { symbol: '002594' }, asOf: '2026-10-14', sources: [history], reportSourceCandidateIds: ['filing-1'], methodology, preparedAnalysis: prepared, reasoningExecutor: executor(async (request) => {
    requests.push(request)
    if (requests.length === 1) throw new Error('temporary provider call failed')
    return output
  }) })
  assert.equal(result.status, 'complete')
  assert.equal(result.attemptOutputs?.length, 2)
  assert.match(requests[0].instruction,/聚焦时间线、战略转型和路径依赖/)
  assert.match(requests[0].instruction,/不同报告的 paragraph 编号不能互换/)
  assert.match(requests[0].instruction,/每个标题.*必须独占一行.*标题行后立即换行/)
  assert.match(requests[0].instruction,/正文、表格标题和表头必须从后续行开始/)
  assert.match(requests[0].instruction,/income|revenue|营业收入/)
  assert.equal(Object.hasOwn(result.attemptOutputs![0]!, 'output'), false)
  assert.deepEqual(result.attemptOutputs?.[1]?.output, output)
  for (const [index, trace] of result.attemptOutputs!.entries()) {
    assert.equal(trace.reasoningInput, requests[index].input, 'Persist exactly the object dispatched to the executor')
    assert.equal(trace.reasoningInstruction, requests[index].instruction)
    assert.equal((trace.reasoningInput as any).canonicalMethodology, methodology)
    assert.deepEqual((trace.reasoningInput as any).ownedSectionIds, ['company-overview'])
  }
  assert.equal('repairPreviousOutput' in (result.attemptOutputs![1]!.reasoningInput as any), false)
  prepared.governance.note = 'caller changed after execution'
  assert.equal((result.attemptOutputs![0]!.reasoningInput as any).preparedAnalysis.governance.note, 'original input')
})

test('provider call diagnostics retain bounded safe cause codes without leaking URLs or secrets', async () => {
  const networkError = Object.assign(new TypeError('socket failure https://provider.invalid/path?token=private'), { code: 'UND_ERR_SOCKET' })
  const reasonError = new ReasoningExecutorError('reasoning_execution_failed', 'fetch failed', { cause: networkError })
  const summary = summarizeReasoningFailure(reasonError)
  assert.equal(summary.message, 'fetch failed')
  assert.match(summary.causeSummary ?? '', /reasoning_execution_failed <- TypeError\[UND_ERR_SOCKET\]/)
  assert.doesNotMatch(JSON.stringify(summary), /provider\.invalid|private|token=/)

  const result = await executeCompanyResearchMethod({
    skillId: 'company_history_strategy', company: { symbol: '002594' }, asOf: '2026-10-14',
    sources: [source], reportSourceCandidateIds: ['filing-1'], maxAttempts: 1,
    reasoningExecutor: executor(async () => { throw reasonError }),
  })
  assert.equal(result.status, 'failed')
  assert.equal(result.diagnostics[0]?.code, 'CALL_FAILED')
  assert.equal(result.diagnostics[0]?.message, 'fetch failed')
  assert.match(result.diagnostics[0]?.causeSummary ?? '', /UND_ERR_SOCKET/)
  assert.doesNotMatch(JSON.stringify(result.diagnostics), /provider\.invalid|private|token=/)
})

test('reasoning failure summary does not invent transport causes and bounds nested cause traversal', () => {
  const noDetail = summarizeReasoningFailure(new ReasoningExecutorError('reasoning_execution_failed', 'fetch failed'))
  assert.equal(noDetail.message, 'fetch failed')
  assert.equal(noDetail.causeSummary, undefined)
  const secretCause = new Error(`failed https://host.invalid/path?api_key=secret ${'x'.repeat(800)}`)
  const wrapped = new ReasoningExecutorError('reasoning_execution_failed', 'fetch failed', { cause: secretCause })
  const safe = summarizeReasoningFailure(wrapped)
  assert.match(safe.causeSummary ?? '', /cause detail unavailable/)
  assert.ok((safe.causeSummary ?? '').length <= 180)
  assert.doesNotMatch(JSON.stringify(safe), /host\.invalid|secret|api_key/)
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

test('financial-quality prompt requires numeric findings to carry their own exact row evidence', async () => {
  const filing={...source,content:'经营现金流与利润需要按同一期间比较。\n资金结构需区分期末余额和期间流量。'}
  let actualInstruction=''
  const ref={sourceCandidateId:'filing-1',location:'paragraph:1'}
  const result=await executeCompanyResearchMethod({skillId:'financial_quality_analysis',company:{symbol:'002594'},asOf:'2026-10-14',sources:[filing],durableSourceCandidateIds:['filing-1'],reasoningExecutor:executor(async request=>{
    actualInstruction=(request as any).instruction
    return {...output,markdown:'经营现金流和利润的期间口径需要分别核对。[filing-1@paragraph:1]',sections:[{id:'financial-quality',markdown:'经营现金流和利润的期间口径需要分别核对。[filing-1@paragraph:1]'}],findings:[{text:'经营现金流和利润的期间口径需要分别核对。',kind:'inference',evidence:[ref]}]}
  })})
  assert.equal(result.status,'complete',JSON.stringify(result.diagnostics))
  assert.match(actualInstruction,/findings逐条自足/)
  assert.match(actualInstruction,/每个finding中的每个数字都必须由该finding\.evidence内的精确数据行支持/)
  assert.match(actualInstruction,/section正文或其他finding中的引用不能借给该finding/)
  assert.match(actualInstruction,/结构化期末数据计算，不是半年报原表“本报告期末／上年末”的直接同比披露/)
  assert.match(actualInstruction,/同一合并指标具备两个可比期间/)
  assert.match(actualInstruction,/毛利率\/净利率水平及派生差额保留两位小数/)
  assert.match(actualInstruction,/半年报分行业表列示：<官方完整行业行名>/)
  assert.match(actualInstruction,/单位行、从“营业收入\/营业成本\/毛利率”到毛利率同比增减列的全部拆分表头段、分行业标题/)
  assert.match(actualInstruction,/不能只依赖excerpt的contextLocations代替finding自身的引用/)
  assert.match(actualInstruction,/不要重复该数字并搭配被否定的错误单位/)
  assert.match(actualInstruction,/不要在本方法输出中生成简化自由现金流的表格、金额或公式/)
  assert.match(actualInstruction,/Workflow会在方法通过后自动附上来源绑定的确定性现金流及资本支出计算/)
})

test('market-structure prompt binds split margin values to their own period and industry or product rows', async () => {
  const filing = { ...source, title: '2026年半年度报告', content: '市场边界需按产品、地区和期间区分。' }
  const reference = { sourceCandidateId: 'filing-1', location: 'paragraph:1' }
  let instruction = ''
  const result = await executeCompanyResearchMethod({ skillId: 'market_structure_analysis', company: { symbol: '002594' }, asOf: '2026-10-14', sources: [filing], durableSourceCandidateIds: ['filing-1'], reasoningExecutor: executor(async request => {
    instruction = (request as any).instruction
    const text = '市场边界需按产品、地区和期间区分。'
    return { ...output, answer: text, markdown: `${text}[filing-1@paragraph:1]`, sections: [{ id: 'industry-exposure', markdown: `${text}[filing-1@paragraph:1]` }], findings: [{ text, kind: 'inference', evidence: [reference] }] }
  }) })
  assert.equal(result.status, 'complete', JSON.stringify(result.diagnostics))
  assert.match(instruction, /市场结构分析引用定期报告中的分行业或分产品毛利率时/)
  assert.match(instruction, /完整分类标签、匹配的数值行、单位和从营业收入\/营业成本\/毛利率指标至同比增减列的完整表头/)
  assert.match(instruction, /引用的报告期间必须与句中期间和来源标题一致/)
  assert.match(instruction, /不能拿同值的另一分类行替代/)
})

test('market-structure findings gain the exact same-source product classification and split value-row citations', async () => {
  const lines = [
    '单位：元', '营业收入', '营业成本', '毛利率', '营业收入比上年同期增减', '营业成本比上年同期增减', '毛利率比上年同期增减',
    '分产品', '汽车、相关产品及', '其他产品 275,341,358,000.00 213,863,297,000.00 22.33% -8.98% -11.24% 1.98%',
  ]
  const candidateId = 'official-product-table'
  const filing = { ...source, candidate: { ...source.candidate, candidateId }, title: '2026年半年度报告', content: lines.join('\n') }
  const initiallyCited = [1, 2, 3, 4, 5, 6, 7, 9].map(paragraph => ({ sourceCandidateId: candidateId, location: `paragraph:${paragraph}` }))
  const findingText = '2026年半年度报告产品分类“汽车、相关产品及其他产品”的营业收入为275,341,358,000.00元、营业成本为213,863,297,000.00元、毛利率为22.33%，毛利率比上年同期增减为1.98%。'
  const result = await executeCompanyResearchMethod({
    skillId: 'market_structure_analysis', company: { symbol: '002594' }, asOf: '2026-10-23',
    sources: [filing], durableSourceCandidateIds: [candidateId],
    reasoningExecutor: executor(async () => ({
      ...output, answer: '产品分类及其财务披露应按原表口径理解。',
      markdown: `产品分类及其财务披露应按原表口径理解。[${candidateId}@paragraph:1]`,
      sections: [{ id: 'industry-exposure', markdown: `产品分类及其财务披露应按原表口径理解。[${candidateId}@paragraph:1]` }],
      findings: [{ text: findingText, kind: 'fact', evidence: initiallyCited }],
    })),
  })
  assert.equal(result.status, 'complete', JSON.stringify(result.diagnostics))
  const addedLocations = new Set(result.findings[0]!.evidence.filter(ref => ref.sourceCandidateId === candidateId).map(ref => ref.location))
  assert.ok(addedLocations.has('paragraph:8'), 'the same table’s split-product marker is cited')
  assert.ok(addedLocations.has('paragraph:10'), 'the exact cited numeric continuation is added')
})

test('financial period-column numeric retry distinguishes prior balance from unsupported change', async () => {
  const paragraphs = Array.from({ length: 768 }, (_, index) => `年报一般经营说明第${index + 1}段。`)
  paragraphs[760] = '单位：元'
  paragraphs[761] = '本报告期末 上年末'
  paragraphs[767] = '应收账款 50,126,342,000.00 5.33% 37,004,685,000.00 4.19% 1.14% 无'
  const filing = { ...source, content: paragraphs.join('\n') }
  const packet = selectCompanyEvidence([filing], ['filing-1'], ['应收账款', '期末', '上年末'], { purpose: 'financial_quality_analysis' })
  const cites = '[filing-1@paragraph:761] [filing-1@paragraph:762] [filing-1@paragraph:768]'
  const check = (claim: string) => validateCompanyNumericGrounding({ markdown: `${claim} ${cites}`, sources: [filing], evidenceContexts: packet })
  assert.equal(check('本期末应收账款501.26亿元、较上年末37.00亿元。').status, 'unsupported_numbers')
  assert.equal(check('本期末应收账款501.26亿元、上年末370.05亿元。').status, 'grounded')
  assert.equal(check('本期末应收账款501.26亿元、较上年末增加131.22亿元。').status, 'unsupported_numbers')

  const broken = {
    ...output,
    answer: '应收账款余额应区分本期末与上年末口径。',
    markdown: '应收账款余额应区分本期末与上年末口径。',
    sections: [{ id: 'financial-quality', markdown: `本期末应收账款501.26亿元、较上年末37.00亿元。${cites}` }],
    findings: [{ text: '本期末应收账款501.26亿元、较上年末37.00亿元。', kind: 'fact', evidence: [761, 762, 768].map(location => ({ sourceCandidateId: 'filing-1', location: `paragraph:${location}` })) }],
    risks: [],
  }
  const fixed = {
    ...broken,
    sections: [{ id: 'financial-quality', markdown: `本期末应收账款501.26亿元、上年末370.05亿元。${cites}` }],
    findings: [{ text: '本期末应收账款501.26亿元、上年末370.05亿元。', kind: 'fact', evidence: [761, 762, 768].map(location => ({ sourceCandidateId: 'filing-1', location: `paragraph:${location}` })) }],
  }
  let calls = 0
  const result = await executeCompanyResearchMethod({ skillId: 'financial_quality_analysis', company: { symbol: '002594' }, asOf: '2026-10-18', sources: [filing], reportSourceCandidateIds: ['filing-1'], reasoningExecutor: executor(async request => {
    if (++calls === 1) return broken
    const input = (request as any).input
    assert.equal(input.repairErrors[0].code, 'NUMERIC_GROUNDING_ERROR')
    assert.ok(input.repairNumericIssues.some((issue: any) => issue.token === '37.00亿元'), JSON.stringify(input.repairNumericIssues))
    for (const phrase of ['上年末列的余额不能改写成', 'preparedAnalysis明确提供', '只修改repairTargets所指向的错误句', '1亿元=100,000,000元', '37,004,685,000元=370.05亿元']) assert.ok(input.repairInstruction.includes(phrase), `${phrase}\n${input.repairInstruction}`)
    return fixed
  }) })
  assert.equal(result.status, 'complete', JSON.stringify(result.diagnostics))
  assert.equal(result.attempts, 2)
  assert.equal(calls, 2)
})

test('company history method receives cited structured financial evidence when it discusses financial history', async () => {
  const history={...source,content:source.content.replace('核心产品业务收入及客户模式。','公司战略转型历史及发展阶段。')}
  const financial={...source,candidate:{...source.candidate,candidateId:'financial-1',metadata:{dataProvenance:{metricId:'company_financial_history'}}},title:'Company financial history',content:'{"kind":"financial","rows":[{"periodEnd":"2025-12-31","metrics":{"revenue":803965000000,"netProfit":32619000000}}]}'}
  const result=await executeCompanyResearchMethod({skillId:'company_history_strategy',company:{symbol:'002594'},asOf:'2026-10-15',sources:[history,financial],reportSourceCandidateIds:['filing-1','financial-1'],reasoningExecutor:executor(async()=>output)})
  assert.equal(result.status,'complete')
  assert.ok(result.executionEvidence?.some(packet=>packet.sourceCandidateId==='financial-1' && packet.excerpts.some(excerpt=>excerpt.location==='paragraph:1')))
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

test('business model method recovers omitted owned-section wrappers only from unique explicit markdown headings', () => {
  const packets = selectCompanyEvidence([source], ['filing-1'], ['产品'])
  const markdown = [
    '# 公司商业模式',
    '公司通过制造产品服务客户。[filing-1@paragraph:251]',
    '# 业务分部',
    '产品结构决定收入来源。[filing-1@paragraph:251]',
    '# 供应链',
    '客户和供应商映射存在资料限制。[filing-1@paragraph:251]',
  ].join('\n')
  const partial = { ...output, markdown, sections: [{ id: 'business-model', markdown: '公司通过制造产品服务客户。[filing-1@paragraph:251]' }] }
  const recovered = validateCompanyMethodOutput(partial, packets, ['business-model', 'business-segments', 'supply-chain'])
  assert.deepEqual(recovered.sections.map((section) => section.id), ['business-model', 'business-segments', 'supply-chain'])
  assert.match(recovered.sections[1]!.markdown, /产品结构决定收入来源/)
  assert.match(recovered.sections[2]!.markdown, /客户和供应商映射存在资料限制/)
  assert.throws(() => validateCompanyMethodOutput({ ...partial, markdown: `${markdown}\n# 供应链` }, packets, ['business-model', 'business-segments', 'supply-chain']), /owned section IDs/)
})

test('host schema checks strict shape while adapter rejects cross-paired locations and unowned sections', () => {
  const packets = selectCompanyEvidence([source], ['filing-1'], ['产品'])
  packets.push({ sourceCandidateId: 'another-source', title: '官网', publisher: 'Company', excerpts: [{ sourceCandidateId: 'another-source', location: 'paragraph:999', text: '公司业务资料。' }] })
  const validator = new Ajv({ strict: false }).compile(companyMethodOutputSchema('company_history_strategy', packets))
  assert.equal(validator(output), true)
  const crossed={ ...output, findings: [{ ...output.findings[0], evidence: [{ sourceCandidateId: 'filing-1', location: 'paragraph:999' }] }] }
  const unowned={ ...output, sections: [{ id: 'products', markdown: output.markdown }] }
  assert.equal(validator(crossed),true)
  assert.equal(validator(unowned),true)
  assert.throws(()=>validateCompanyMethodOutput(crossed,packets,['company-overview']),/REFERENCE: Evidence location not supplied: filing-1@paragraph:999/)
  assert.throws(()=>validateCompanyMethodOutput(unowned,packets,['company-overview']),/FORMAT: Sections must match exact owned section IDs/)
  assert.equal(validator({...output,findings:[{...output.findings[0],evidence:[{sourceCandidateId:'filing-1',location:'paragraph:1-3'}]}]}),false)
  assert.equal(validator({...output,x:true}),false)
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

test('history evidence keeps the subject-company transformation, registration, and stock listing while excluding investee dates', () => {
  const filing = { ...source, content: [
    '公司基本情况',
    '苏州东山精密制造股份有限公司（以下简称公司或本公司）系由苏州市东山钣金有限责任公司整体变更设立的股份有限公司，于2007年12月24日在江苏省苏州工商行政管理局登记注册。',
    '本公司股票于2010年4月9日在深圳证券交易所挂牌交易。',
    ...Array.from({ length: 12 }, (_, index) => `其他年度披露事项 ${index + 1}。`),
    '参股公司甲成立于2021年9月27日，注册资本33亿元。',
    '参股公司乙成立于2012年4月6日，注册资本3600万元。',
  ].join('\n') }
  const packets = selectCompanyEvidence([filing], ['filing-1'], ['历史', '前身', '战略'], { purpose: 'company_history_strategy' })
  const rows = packets[0]!.excerpts
  assert.ok(rows.some(row => row.text.includes('整体变更设立')))
  assert.ok(rows.some(row => row.text.includes('登记注册')))
  assert.ok(rows.some(row => row.text.includes('挂牌交易')))
  assert.ok(!rows.some(row => row.text.includes('参股公司甲成立于')))
  assert.ok(!rows.some(row => row.text.includes('参股公司乙成立于')))
})

test('management and capital methods receive the current top-ten shareholder header and holder rows', () => {
  const filing = { ...source, content: [
    '公司股东数量及持股情况',
    '单位：股',
    '报告期末普通股股东总数 389315',
    '持股5%以上的股东或前10名股东持股情况（不含通过转融通出借股份）',
    '股东名称 股东性质 持股比例 报告期末持股数量 报告期内增减变动情况',
    '袁永刚 境内自然人 16.53% 302781254 252224705',
    '袁永峰 境内自然人 13.51% 247526917 191929879',
    '香港中央结算有限公司 境外法人 3.77% 69090247 69090247',
  ].join('\n') }
  for (const purpose of ['management_governance_analysis', 'capital_allocation_review'] as const) {
    const packets = selectCompanyEvidence([filing], ['filing-1'], ['股东', '持股', '治理'], { purpose })
    const rows = packets[0]!.excerpts.map(row => row.text).join('\n')
    assert.match(rows, /前10名股东持股情况/)
    assert.match(rows, /袁永刚 境内自然人 16\.53% 302781254/)
    assert.match(rows, /袁永峰 境内自然人 13\.51% 247526917/)
  }
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


test('host schema rejection without a raw output repairs the full sibling-field shape on the second request', async () => {
  let calls = 0
  const result = await executeCompanyResearchMethod({skillId:'product_technology_analysis',company:{symbol:'002594'},asOf:'2026-10-14',sources:[source],durableSourceCandidateIds:['filing-1'],reasoningExecutor:executor(async request => {
    const actual = request as any
    calls++
    assert.match(actual.instruction,/^仅返回一个完整JSON对象/)
    assert.match(actual.instruction,/status、answer、markdown、sections、findings、limitations、risks七个字段/)
    assert.match(actual.instruction,/sections仅含\["products","technologies"\]指定的各一项，每项只能是\{id,markdown\}/)
    assert.match(actual.instruction,/findings是与sections并列的顶层数组/)
    assert.match(actual.instruction,/包含相同完整产品标签和数值的原表行/)
    assert.match(actual.instruction,/不得用同比率反推并呈现未直接披露的前期金额/)
    assert.match(actual.instruction,/limitations和risks无内容也须返回\[\]/)
    assert.deepEqual(Object.keys(actual.input.outputExample),['status','answer','markdown','sections','findings','limitations','risks'])
    assert.equal('repairPreviousOutput' in actual.input,false,'Host rejection returned no actual output')
    if (calls === 1) throw new ReasoningExecutorError('reasoning_output_invalid',"JSON Schema contract: findings required; sections must NOT have more than 2 items")
    assert.equal(actual.input.repairErrors[0].code,'FORMAT_ERROR')
    assert.match(actual.input.repairInstruction,/^仅返回一个完整JSON对象/)
    assert.match(actual.input.repairInstruction,/findings是与sections并列的顶层数组/)
    assert.match(actual.input.repairInstruction,/limitations和risks无内容也须返回\[\]/)
    return {...output,sections:['products','technologies'].map(id=>({id,markdown:'产品形成业务能力。[filing-1@paragraph:251]'}))}
  })})
  assert.equal(calls,2)
  assert.equal(result.status,'complete',JSON.stringify(result.diagnostics))
  assert.equal(result.attempts,2)
  assert.equal('output' in result.attemptOutputs![0]!,false)
  assert.deepEqual(result.attemptOutputs![1]!.output && (result.attemptOutputs![1]!.output as any).limitations,[])
})

test('Pi schema validation paths and rejected draft are surfaced in the bounded second attempt', async () => {
  let calls = 0
  const raw = JSON.stringify({ ...output, limitations: undefined, risks: undefined, findings: [{ text: '有证据支持的论点。' }] })
  const schemaMessage = 'JSON Schema contract invalid: required property limitations; required property risks; /findings/6 must have required properties kind, evidence'
  const result = await executeCompanyResearchMethod({skillId:'business_model_map',company:{symbol:'002594'},asOf:'2026-10-14',sources:[source],durableSourceCandidateIds:['filing-1'],reasoningExecutor:executor(async request => {
    calls++
    const actual = request as any
    if (calls === 1) throw new ReasoningExecutorError('reasoning_output_invalid', schemaMessage, { rawOutput: raw })
    assert.match(actual.instruction,/required property limitations/)
    assert.match(actual.instruction,/required property risks/)
    assert.match(actual.instruction,/\/findings\/6/)
    assert.match(actual.instruction,/不得从草稿或记忆推造定位/)
    assert.equal(actual.input.repairRejectedRawOutput,raw)
    assert.match(actual.input.repairInstruction,/自身不证明任何事实或引用/)
    return { ...output, sections: ['business-model','business-segments','supply-chain'].map(id => ({ id, markdown: '公司经营活动由公开披露的业务构成。[filing-1@paragraph:251]' })) }
  })})
  assert.equal(calls,2)
  assert.equal(result.status,'complete',JSON.stringify(result.diagnostics))
  assert.equal(result.attempts,2)
  assert.equal(result.attemptOutputs?.[0]?.rejectedRawOutput,raw)
})

test('product method repairs unsupported customer preferences into an explicit unverified hypothesis', async () => {
  const filing={...source,content:'公司新能源汽车产品覆盖乘用车和商用车，产品矩阵面向多元应用场景。'}
  const unsupported={...output,answer:'公司产品覆盖乘用和商用场景。',markdown:'产品覆盖乘用车和商用车。[filing-1@paragraph:1]',sections:[{id:'products',markdown:'| 新能源汽车 | 客户关注安全、动力、能耗、成本及车型选择。 [filing-1@paragraph:1] |'},{id:'technologies',markdown:'公司披露新能源汽车产品覆盖乘用车和商用车。[filing-1@paragraph:1]'}],findings:[{text:'客户关注安全、动力、能耗、成本及车型选择。',kind:'fact',evidence:[{sourceCandidateId:'filing-1',location:'paragraph:1'}]}]}
  const repaired={...unsupported,sections:[{id:'products',markdown:'| 新能源汽车 | 公司披露产品覆盖乘用车和商用车；客户对安全、动力、能耗、成本及车型的实际关注未有客户需求调研或反馈验证，以上仅为待验证的潜在购买因素。[filing-1@paragraph:1] |'},{id:'technologies',markdown:'公司披露新能源汽车产品覆盖乘用车和商用车。[filing-1@paragraph:1]'}],findings:[{text:'客户实际关注尚未有调研或反馈验证；安全、动力、能耗、成本及车型选择仅为待验证分析假设。',kind:'assumption',evidence:[{sourceCandidateId:'filing-1',location:'paragraph:1'}]}]}
  let calls=0
  const result=await executeCompanyResearchMethod({skillId:'product_technology_analysis',company:{symbol:'002594'},asOf:'2026-10-14',sources:[filing],durableSourceCandidateIds:['filing-1'],reasoningExecutor:executor(async request=>{
    calls++
    const actual=request as any
    assert.match(actual.instruction,/只有明确的客户\/消费者调研、问卷、访谈、反馈/)
    if(calls===1) return unsupported
    assert.match(actual.input.repairErrors[0].message,/PRODUCT_CUSTOMER_NEEDS_UNVERIFIED/)
    assert.match(actual.input.repairInstruction,/产品规格、配置、用途、公司定位或市场布局不能证明客户实际关注/)
    assert.match(actual.input.repairInstruction,/输出必须仍完整包含products和technologies各一次/)
    assert.match(actual.input.repairInstruction,/status按repairPreviousOutput保留/)
    assert.match(actual.input.repairInstruction,/只有本次材料确实无法支持产品组合与商业化分析，或无法支持任何技术路线\/研发量产阶段分析时，才标为insufficient_evidence/)
    assert.match(actual.input.repairInstruction,/不得把“客户偏好、独立竞品性能、产品级盈利归因未验证”单独作为核心缺失/)
    return repaired
  })})
  assert.equal(calls,2)
  assert.equal(result.status,'complete',JSON.stringify(result.diagnostics))
  assert.match(result.sections.find(section=>section.id==='products')!.markdown,/未有客户需求调研或反馈验证/)
  assert.equal(result.findings[0]!.kind,'assumption')
})

test('product customer-demand repair keeps bounded evidence gaps complete but leaves a missing core technical analysis insufficient', async () => {
  const filing={...source,content:'公司披露新能源汽车覆盖乘用车与商用车；动力电池采用磷酸铁锂路线，相关产品已量产。'}
  const first={...output,status:'complete' as const,answer:'产品和技术已有公司披露，但客户偏好缺少独立验证。',markdown:'产品及技术路线见公司披露。[filing-1@paragraph:1]',sections:[
    {id:'products',markdown:'公司产品覆盖乘用车和商用车，产品应用明确；动力电池已量产。[filing-1@paragraph:1] 客户关注安全、动力、能耗、成本及车型选择。'},
    {id:'technologies',markdown:'公司披露动力电池采用磷酸铁锂路线并已量产，能够确认技术路线和商业化阶段；材料没有第三方性能对标，因此不据此认定相对优势。[filing-1@paragraph:1]'},
  ],findings:[{text:'公司披露动力电池采用磷酸铁锂路线并已量产。',kind:'fact' as const,evidence:[{sourceCandidateId:'filing-1',location:'paragraph:1'}]}]}
  const repaired={...first,sections:[
    {id:'products',markdown:'公司产品覆盖乘用车和商用车，产品应用明确；动力电池已量产。[filing-1@paragraph:1] 客户实际偏好未有调研、反馈或购买行为验证，不能据此推断。'},
    first.sections[1]!,
  ],findings:[{text:'公司披露动力电池采用磷酸铁锂路线并已量产；客户偏好仍待独立验证。',kind:'fact' as const,evidence:[{sourceCandidateId:'filing-1',location:'paragraph:1'}]}]}
  let calls=0
  const complete=await executeCompanyResearchMethod({skillId:'product_technology_analysis',company:{symbol:'002594'},asOf:'2026-10-14',sources:[filing],durableSourceCandidateIds:['filing-1'],reasoningExecutor:executor(async request=>{calls++;if(calls===1)return first;assert.match((request as any).input.repairInstruction,/只有本次材料确实无法支持产品组合与商业化分析/);return repaired})})
  assert.equal(calls,2)
  assert.equal(complete.status,'complete',JSON.stringify(complete.diagnostics))

  const missingCore={...repaired,status:'insufficient_evidence' as const,sections:[
    repaired.sections[0]!,
    {id:'technologies',markdown:'本次材料未提供技术路线、研发/量产阶段或技术性能证据。'},
  ],limitations:['缺少可核验的技术路线、研发/量产阶段和技术结果材料，无法完成技术分析。']}
  const insufficient=await executeCompanyResearchMethod({skillId:'product_technology_analysis',company:{symbol:'002594'},asOf:'2026-10-14',sources:[filing],durableSourceCandidateIds:['filing-1'],reasoningExecutor:executor(async()=>missingCore)})
  assert.equal(insufficient.status,'insufficient_evidence',JSON.stringify(insufficient.diagnostics))
})

test('product method accepts an explicit customer-preference evidence gap without accepting a positive preference claim', async () => {
  const filing={...source,content:'公司新能源汽车产品覆盖乘用车和商用车，产品矩阵面向多元应用场景。'}
  const qualified={...output,answer:'客户偏好与竞品对比证据有限，故不作推断。',markdown:'公司披露新能源汽车产品覆盖乘用车和商用车。[filing-1@paragraph:1]',sections:[{id:'products',markdown:'客户偏好与竞品对比证据有限，故不作推断。[filing-1@paragraph:1]'},{id:'technologies',markdown:'公司披露新能源汽车产品覆盖乘用车和商用车。[filing-1@paragraph:1]'}],findings:[{text:'客户偏好与竞品对比证据有限，故不作推断。',kind:'assumption' as const,evidence:[{sourceCandidateId:'filing-1',location:'paragraph:1'}]}]}
  let calls=0
  let repairErrors: unknown
  const result=await executeCompanyResearchMethod({skillId:'product_technology_analysis',company:{symbol:'002594'},asOf:'2026-10-14',sources:[filing],durableSourceCandidateIds:['filing-1'],reasoningExecutor:executor(async request=>{calls++;repairErrors=(request as any).input.repairErrors;return qualified})})
  assert.equal(calls,1,`an explicit limitation should not consume a repair attempt: ${JSON.stringify(repairErrors)}`)
  assert.equal(result.status,'complete',JSON.stringify(result.diagnostics))
  assert.match(result.sections.find(section=>section.id==='products')!.markdown,/客户偏好与竞品对比证据有限/)
})

test('product method accepts enumerated evidence gaps but rejects positive preference claims with a trailing caveat', async () => {
  const filing={...source,content:'公司新能源汽车产品覆盖乘用车和商用车，产品矩阵面向多元应用场景。'}
  const gapClaims=[
    '未提供足以确认消费者偏好的调研材料',
    '客户对成本、性能、交付或具体产品选择的偏好应视为待验证假设',
    '产品技术优势不等于客户偏好或已实现市场份额',
    '公司宣称、产品规格与实际客户偏好应分别看待',
    '公司陈述与独立验证、产品用途与实际客户偏好应分别看待',
    '但该定位与客户实测需求或购买偏好是不同证据层级',
    '但实际相对竞争力、客户偏好及各技术的独立性能验证资料不足',
    '客户偏好、相对竞品表现及护城河强度仍需独立证据验证',
    '竞品维度及客户偏好验证不足，结论应视为基于公司披露的分析，而非独立性能评测',
    '现有材料不足以确认实际消费者偏好，也不足以对竞品作同口径性能或经济性排序',
    '但竞争优势及客户偏好尚缺独立验证',
    '但产品定位不等于客户偏好，专利数量也不能单独证明护城河',
    '但各产品的客户需求证据、独立性能对标及具名竞品比较不足',
    '客户偏好、相对竞品表现与研发回报仍缺乏独立验证',
    '但目前材料不足以证明相对竞品的性能、成本优势及客户偏好',
    '但现有材料不足以独立验证相对竞品优势或客户偏好',
    '目前资料不足以独立验证性能领先、客户偏好或长期护城河',
    '但相对竞品的量化性能、成本和客户选择证据不足，不能据此确认持久护城河',
    '但竞品同口径性能、成本和客户选择证据不足，尚不能确认持久护城河',
    '也不能替代客户偏好研究',
    '消费者实际偏好未获调研、反馈或购买行为证据',
    '但竞品对标、客户需求验证和独立性能证据有限，不能据此断言客户偏好或形成持久护城河',
    '相对竞争优势、客户真实偏好以及产品级回报归因仍有证据边界',
    '客户需求调研和购买行为证据缺失，不能把安全、动力、能耗或价格等直接写成消费者偏好事实',
    '客户需求调研或反馈证据不足，实际购买偏好未获验证',
    '公司称乘用车品牌梯度覆盖家用至豪华等市场，但这是公司产品定位，不是独立消费者偏好证据',
    '公司所述品牌梯度和应用场景属于产品定位，不是消费者实际偏好证据',
    '客户偏好不能由产品定位推定',
    '年度报告称相关业务曾受客户需求增长带动，但该陈述不是消费者偏好调查',
    '产品布局不能直接证明客户偏好或竞争优势',
    '客户偏好也不能由产品配置或用途直接推定',
    '客户实际偏好、产品相对性能及研发回报仍缺关键证据',
    '并非独立测试或客户偏好证据',
    '公司产品定位不能替代实际客户偏好证据',
    '但公司自述不能替代独立性能、成本及客户偏好验证',
    '但对客户偏好、相对竞品性能与长期回报的独立验证有限',
    '但未提供具体车型的价格、配置、客户选择理由或同口径竞品参数',
    '客户偏好与持久护城河仍需验证',
    '客户偏好、竞品优劣及持久护城河仍待证据支持',
    '安全、动力、能耗或成本不能推导为实际客户偏好',
    '现有材料不能推断客户实际偏好',
    '实际客户偏好未获验证',
    '安全、动力、能耗、成本或车型选择是否为消费者实际关注点，均属待验证假设，现有资料不足以证明实际偏好',
    '不能据此认定消费者偏好',
    '公司对产品需求和技术优势的表述不能等同于消费者偏好事实',
    '产品定位不能代表消费者偏好',
    '但不足以证明各产品的相对性能优势、客户偏好或持久护城河',
    '现有材料不足以确认实际消费者偏好、竞品相对性能或持久护城河',
    '但竞争优势及客户偏好仍需独立验证',
    '现有材料亦不足以确认客户实际偏好或进行具名竞品排名',
    '故不能把安全、动力、能耗、成本、车型选择或充电体验列为已验证的实际客户关注',
    '客户实际偏好和竞品相对表现仍缺证据',
    '但产品性能优势与客户真实偏好尚缺独立验证',
    '但客户偏好、相对竞品表现及投入回报尚缺独立验证',
    '但客户偏好、与具名对手的同口径性能成本比较，以及各技术对利润的可归因贡献，现有材料未充分验证',
    '客户偏好、相对竞品表现及技术对利润的可归因贡献尚缺实证',
    '但不能替代独立性能验证、客户偏好证据或竞争对手同口径比较',
    '不是消费者偏好调研或独立验证',
    '不能据此认定消费者偏好或相对技术领先',
    '现有材料未验证客户实际偏好，也不足以与具名竞品作相对比较',
    '客户真实偏好也未获调研、反馈或购买行为材料验证',
    '但技术优势及客户需求偏好尚缺充分独立验证',
    '不能据此推断安全、动力、能耗或价格是已证实的客户关注因素',
    '竞品比较和真实客户偏好证据不足',
    '不足以单独证明客户偏好、相对竞品优势或长期护城河',
    '尚不足以证明客户偏好、相对竞品优势或长期技术壁垒',
    '其实际差异化程度及客户偏好，仍需独立客户与同业对比证据验证',
    '因此无法独立判断消费者偏好或相对竞争胜负',
    '因此安全、动力、能耗、价格、充电便利性或车型偏好均不能写成实际客户关注事实',
    '地域覆盖不证明客户偏好，也不能单独代表独立市场地位',
    '不能将安全、动力、能耗或车型选择表述为已验证的客户偏好',
    '安全、动力、能耗、成本及车型选择不能作为已验证客户偏好，公司所称满足细分市场需求仅属公司定位',
    '但客户偏好、独立性能验证及具名竞品可比资料不足，尚不能据此确认技术护城河或客户需求结论',
    '不能归因为技术变化或客户偏好',
    '安全、动力、能耗、成本及车型选择不得写成已验证的客户偏好，潜在影响仅属待验证假设',
    '竞争力和客户偏好仍须谨慎判断',
    '客户偏好、相对竞品性能和研发投入的可归因回报，现有材料均不足以独立验证',
    '不应升级为消费者偏好事实',
    '但性能优势、成本领先和客户偏好大多尚无独立验证',
    '不能据产品属性推断客户偏好',
    '客户偏好、相对竞品优势与壁垒强度仍需独立证据验证',
    '并不能证明客户实际重视哪些属性',
    '属于公司经营披露而非消费者偏好调查',
    '但无法独立判断消费者偏好',
    '不能称为实际客户偏好',
    '客户实际偏好、具名竞品优劣及持久技术壁垒均缺乏验证，宜将其视为待核实事项',
    '不能改写成独立客户偏好事实',
    '但产品优势、客户实际偏好和相对竞争地位尚缺独立验证',
    '实际客户对安全、续航、空间、成本、智能化的关注未被验证',
    '公司未提供客户实际偏好应严格谨慎',
    '实际客户对安全、动力、能耗、成本或车型选择的关注未获验证',
    '实际客户对安全、动力、能耗、成本或车型的关注程度不能从产品规格和公司宣传推导',
    '公司陈述与客户实际偏好应严格区分',
    '产品规格、公司定位与客户实际偏好亦不能混为一谈',
    '不能升级为独立消费者偏好事实',
    '但非客户偏好证据',
    '潜在购买因素不能当作客户偏好事实',
    '客户偏好调研及具名竞品的可比数据不足',
    '客户偏好和竞争替代的相对表现仍有证据缺口',
    '不应将这些特征写成实际客户关注事实',
    '相关客户偏好不得据产品宣传推定',
    '不能写作客户偏好事实',
    '也没有对安全、能耗、成本等客户偏好的明确独立验证',
    '并非客户偏好事实',
    '公司自述的产品布局、研发项目进展和性能作用不等于客户偏好或独立验证',
    '这些内容说明公司产品布局，不构成客户偏好或各业务盈利的独立证明',
    '客户偏好亦未见调研或购买行为验证',
    '客户偏好亦未见调研或购买行为验证，潜在因素仅作待验证假设',
  ]
  for(const claim of gapClaims){
    let calls=0
    let repairErrors: unknown
    const qualified={...output,answer:`${claim}。`,markdown:'公司披露新能源汽车产品覆盖乘用车和商用车。[filing-1@paragraph:1]',sections:[{id:'products',markdown:`${claim}。[filing-1@paragraph:1]`},{id:'technologies',markdown:'公司披露新能源汽车产品覆盖乘用车和商用车。[filing-1@paragraph:1]'}],findings:[{text:`${claim}。`,kind:'assumption' as const,evidence:[{sourceCandidateId:'filing-1',location:'paragraph:1'}]}]}
    const result=await executeCompanyResearchMethod({skillId:'product_technology_analysis',company:{symbol:'002594'},asOf:'2026-10-14',sources:[filing],durableSourceCandidateIds:['filing-1'],reasoningExecutor:executor(async request=>{calls++;repairErrors=(request as any).input.repairErrors;return qualified})})
    assert.equal(calls,1,`${claim} should be accepted as a limitation: ${JSON.stringify(repairErrors)}`)
    assert.equal(result.status,'complete',JSON.stringify(result.diagnostics))
  }

  const positive='消费者看重安全、动力、能耗与价格，但相关证据不足'
  const unsupported={...output,answer:`${positive}。`,markdown:'公司披露新能源汽车产品覆盖乘用车和商用车。[filing-1@paragraph:1]',sections:[{id:'products',markdown:`${positive}。[filing-1@paragraph:1]`},{id:'technologies',markdown:'公司披露新能源汽车产品覆盖乘用车和商用车。[filing-1@paragraph:1]'}],findings:[{text:`${positive}。`,kind:'fact' as const,evidence:[{sourceCandidateId:'filing-1',location:'paragraph:1'}]}]}
  let calls=0
  const rejected=await executeCompanyResearchMethod({skillId:'product_technology_analysis',company:{symbol:'002594'},asOf:'2026-10-14',sources:[filing],durableSourceCandidateIds:['filing-1'],reasoningExecutor:executor(async request=>{calls++;if(calls===1)assert.match((request as any).input.repairErrors[0].message,/PRODUCT_CUSTOMER_NEEDS_UNVERIFIED/);return unsupported})})
  assert.equal(calls,2)
  assert.equal(rejected.status,'failed','a trailing evidence caveat cannot validate stated customer preferences')

  const directPositive='客户关注安全'
  const unsupportedDirect={...unsupported,answer:`${directPositive}。`,sections:unsupported.sections.map(section=>section.id==='products'?{...section,markdown:`${directPositive}。[filing-1@paragraph:1]`}:section),findings:[{text:`${directPositive}。`,kind:'fact' as const,evidence:[{sourceCandidateId:'filing-1',location:'paragraph:1'}]}]}
  calls=0
  const directPositiveRejected=await executeCompanyResearchMethod({skillId:'product_technology_analysis',company:{symbol:'002594'},asOf:'2026-10-14',sources:[filing],durableSourceCandidateIds:['filing-1'],reasoningExecutor:executor(async request=>{calls++;if(calls===1)assert.match((request as any).input.repairErrors[0].message,/PRODUCT_CUSTOMER_NEEDS_UNVERIFIED/);return unsupportedDirect})})
  assert.equal(calls,2)
  assert.equal(directPositiveRejected.status,'failed','an unsupported direct customer-interest assertion remains blocked')

  const positiveWithExactR70Caveat='消费者偏好安全、续航和价格，现有材料不足以确认实际消费者偏好，也不足以对竞品作同口径性能或经济性排序'
  const adversarial={...unsupported,answer:`${positiveWithExactR70Caveat}。`,sections:unsupported.sections.map(section=>section.id==='products'?{...section,markdown:`${positiveWithExactR70Caveat}。[filing-1@paragraph:1]`}:section),findings:[{text:`${positiveWithExactR70Caveat}。`,kind:'fact' as const,evidence:[{sourceCandidateId:'filing-1',location:'paragraph:1'}]}]}
  calls=0
  const stillRejected=await executeCompanyResearchMethod({skillId:'product_technology_analysis',company:{symbol:'002594'},asOf:'2026-10-14',sources:[filing],durableSourceCandidateIds:['filing-1'],reasoningExecutor:executor(async request=>{calls++;if(calls===1)assert.match((request as any).input.repairErrors[0].message,/PRODUCT_CUSTOMER_NEEDS_UNVERIFIED/);return adversarial})})
  assert.equal(calls,2)
  assert.equal(stillRejected.status,'failed','the R70 limitation wording cannot launder a concrete stated preference')

  const postposedDenialThenPositive='客户偏好亦未见调研或购买行为验证，但消费者看重低价'
  const postposedAdversarial={...unsupported,answer:`${postposedDenialThenPositive}。`,sections:unsupported.sections.map(section=>section.id==='products'?{...section,markdown:`${postposedDenialThenPositive}。[filing-1@paragraph:1]`}:section),findings:[{text:`${postposedDenialThenPositive}。`,kind:'fact' as const,evidence:[{sourceCandidateId:'filing-1',location:'paragraph:1'}]}]}
  calls=0
  const postposedStillRejected=await executeCompanyResearchMethod({skillId:'product_technology_analysis',company:{symbol:'002594'},asOf:'2026-10-14',sources:[filing],durableSourceCandidateIds:['filing-1'],reasoningExecutor:executor(async request=>{calls++;if(calls===1)assert.match((request as any).input.repairErrors[0].message,/PRODUCT_CUSTOMER_NEEDS_UNVERIFIED/);return postposedAdversarial})})
  assert.equal(calls,2)
  assert.equal(postposedStillRejected.status,'failed','a postposed denial cannot mask a separate unsupported positive preference assertion')

  for (const caveat of [
    '客户偏好与持久护城河仍需验证',
    '客户偏好、竞品优劣及持久护城河仍待证据支持',
    '实际客户偏好未获验证',
    '不能据此认定消费者偏好',
    '公司对产品需求和技术优势的表述不能等同于消费者偏好事实',
    '产品定位不能代表消费者偏好',
    '但不足以证明各产品的相对性能优势、客户偏好或持久护城河',
    '现有材料不足以确认实际消费者偏好、竞品相对性能或持久护城河',
    '但竞争优势及客户偏好仍需独立验证',
    '现有材料亦不足以确认客户实际偏好或进行具名竞品排名',
    '故不能把安全、动力、能耗、成本、车型选择或充电体验列为已验证的实际客户关注',
    '客户实际偏好和竞品相对表现仍缺证据',
    '但产品性能优势与客户真实偏好尚缺独立验证',
    '但客户偏好、相对竞品表现及投入回报尚缺独立验证',
    '但不能替代独立性能验证、客户偏好证据或竞争对手同口径比较',
    '不是消费者偏好调研或独立验证',
    '不能据此认定消费者偏好或相对技术领先',
    '现有材料未验证客户实际偏好，也不足以与具名竞品作相对比较',
    '客户真实偏好也未获调研、反馈或购买行为材料验证',
    '竞品比较和真实客户偏好证据不足',
    '不足以单独证明客户偏好、相对竞品优势或长期护城河',
    '尚不足以证明客户偏好、相对竞品优势或长期技术壁垒',
    '其实际差异化程度及客户偏好，仍需独立客户与同业对比证据验证',
    '因此无法独立判断消费者偏好或相对竞争胜负',
    '因此安全、动力、能耗、价格、充电便利性或车型偏好均不能写成实际客户关注事实',
    '地域覆盖不证明客户偏好，也不能单独代表独立市场地位',
    '不能将安全、动力、能耗或车型选择表述为已验证的客户偏好',
    '安全、动力、能耗、成本及车型选择不能作为已验证客户偏好，公司所称满足细分市场需求仅属公司定位',
    '安全、动力、能耗、成本及车型选择不得写成已验证的客户偏好，潜在影响仅属待验证假设',
    '竞争力和客户偏好仍须谨慎判断',
    '客户偏好、相对竞品性能和研发投入的可归因回报，现有材料均不足以独立验证',
    '不应升级为消费者偏好事实',
    '但性能优势、成本领先和客户偏好大多尚无独立验证',
    '不能据产品属性推断客户偏好',
    '客户偏好、相对竞品优势与壁垒强度仍需独立证据验证',
    '并不能证明客户实际重视哪些属性',
    '属于公司经营披露而非消费者偏好调查',
    '但不能将其他因素表述为已验证的客户偏好',
    '实际客户对安全、续航、空间、成本、智能化的关注未被验证',
    '公司未提供客户实际偏好应严格谨慎',
    '实际客户对安全、动力、能耗、成本或车型选择的关注未获验证',
    '公司陈述与客户实际偏好应严格区分',
    '产品规格、公司定位与客户实际偏好亦不能混为一谈',
    '不能升级为独立消费者偏好事实',
  ]) {
    for (const positiveClaim of ['消费者偏好安全', '消费者偏好已验证', '消费者偏好已证实', '客户真实偏好已验证', '客户偏好已验证', '公司竞争优势已验证', '竞品表现已证实', '相对竞品优势已证实', '相对竞争优势已证实']) {
      const positiveWithCaveat=`${positiveClaim}，${caveat}`
      const adversarialWithCaveat={...unsupported,answer:`${positiveWithCaveat}。`,sections:unsupported.sections.map(section=>section.id==='products'?{...section,markdown:`${positiveWithCaveat}。[filing-1@paragraph:1]`}:section),findings:[{text:`${positiveWithCaveat}。`,kind:'fact' as const,evidence:[{sourceCandidateId:'filing-1',location:'paragraph:1'}]}]}
      calls=0
      const rejectedWithCaveat=await executeCompanyResearchMethod({skillId:'product_technology_analysis',company:{symbol:'002594'},asOf:'2026-10-14',sources:[filing],durableSourceCandidateIds:['filing-1'],reasoningExecutor:executor(async request=>{calls++;if(calls===1)assert.match((request as any).input.repairErrors[0].message,/PRODUCT_CUSTOMER_NEEDS_UNVERIFIED/);return adversarialWithCaveat})})
      assert.equal(calls,2)
      assert.equal(rejectedWithCaveat.status,'failed',`${positiveClaim} cannot be laundered by an explicit research-gap clause`)
    }
  }

  for (const genericProofGap of ['客户偏好已验证，但不足以证明', '客户偏好已验证，但不能写成事实', '客户偏好已验证，但不能将其他因素表述为已验证偏好']) {
    const genericProofGapOutput={...unsupported,answer:`${genericProofGap}。`,sections:unsupported.sections.map(section=>section.id==='products'?{...section,markdown:`${genericProofGap}。[filing-1@paragraph:1]`}:section),findings:[{text:`${genericProofGap}。`,kind:'fact' as const,evidence:[{sourceCandidateId:'filing-1',location:'paragraph:1'}]}]}
    calls=0
    const genericProofGapResult=await executeCompanyResearchMethod({skillId:'product_technology_analysis',company:{symbol:'002594'},asOf:'2026-10-14',sources:[filing],durableSourceCandidateIds:['filing-1'],reasoningExecutor:executor(async request=>{calls++;if(calls===1)assert.match((request as any).input.repairErrors[0].message,/PRODUCT_CUSTOMER_NEEDS_UNVERIFIED/);return genericProofGapOutput})})
    assert.equal(calls,2)
    assert.equal(genericProofGapResult.status,'failed','a generic caveat must not erase the adjacent positive preference assertion')
  }

  const positiveWithR81Caveat='消费者偏好安全，并非独立测试或客户偏好证据'
  const r81Adversarial={...unsupported,answer:`${positiveWithR81Caveat}。`,sections:unsupported.sections.map(section=>section.id==='products'?{...section,markdown:`${positiveWithR81Caveat}。[filing-1@paragraph:1]`}:section),findings:[{text:`${positiveWithR81Caveat}。`,kind:'fact' as const,evidence:[{sourceCandidateId:'filing-1',location:'paragraph:1'}]}]}
  calls=0
  const r81Rejected=await executeCompanyResearchMethod({skillId:'product_technology_analysis',company:{symbol:'002594'},asOf:'2026-10-14',sources:[filing],durableSourceCandidateIds:['filing-1'],reasoningExecutor:executor(async request=>{calls++;if(calls===1)assert.match((request as any).input.repairErrors[0].message,/PRODUCT_CUSTOMER_NEEDS_UNVERIFIED/);return r81Adversarial})})
  assert.equal(calls,2)
  assert.equal(r81Rejected.status,'failed','the R81 limitation wording cannot launder a concrete stated customer preference')

  const positiveWithR82Caveat='消费者偏好安全，但公司自述不能替代独立性能、成本及客户偏好验证'
  const r82Adversarial={...unsupported,answer:`${positiveWithR82Caveat}。`,sections:unsupported.sections.map(section=>section.id==='products'?{...section,markdown:`${positiveWithR82Caveat}。[filing-1@paragraph:1]`}:section),findings:[{text:`${positiveWithR82Caveat}。`,kind:'fact' as const,evidence:[{sourceCandidateId:'filing-1',location:'paragraph:1'}]}]}
  calls=0
  const r82Rejected=await executeCompanyResearchMethod({skillId:'product_technology_analysis',company:{symbol:'002594'},asOf:'2026-10-14',sources:[filing],durableSourceCandidateIds:['filing-1'],reasoningExecutor:executor(async request=>{calls++;if(calls===1)assert.match((request as any).input.repairErrors[0].message,/PRODUCT_CUSTOMER_NEEDS_UNVERIFIED/);return r82Adversarial})})
  assert.equal(calls,2)
  assert.equal(r82Rejected.status,'failed','the R82 limitation wording cannot launder a concrete stated customer preference')

  for(const [claim,label] of [
    ['消费者偏好安全，但对客户偏好、相对竞品性能与长期回报的独立验证有限','independent-comparison limitation'],
    ['消费者偏好安全，但未提供具体车型的价格、配置、客户选择理由或同口径竞品参数','missing model-level comparison inputs'],
  ] as const){
    const laundering={...unsupported,answer:`${claim}。`,sections:unsupported.sections.map(section=>section.id==='products'?{...section,markdown:`${claim}。[filing-1@paragraph:1]`}:section),findings:[{text:`${claim}。`,kind:'fact' as const,evidence:[{sourceCandidateId:'filing-1',location:'paragraph:1'}]}]}
    calls=0
    const result=await executeCompanyResearchMethod({skillId:'product_technology_analysis',company:{symbol:'002594'},asOf:'2026-10-14',sources:[filing],durableSourceCandidateIds:['filing-1'],reasoningExecutor:executor(async request=>{calls++;if(calls===1)assert.match((request as any).input.repairErrors[0].message,/PRODUCT_CUSTOMER_NEEDS_UNVERIFIED/);return laundering})})
    assert.equal(calls,2)
    assert.equal(result.status,'failed',`the ${label} cannot launder a concrete stated customer preference`)
  }

  const positiveWithR71Caveat='客户偏好安全并且关注续航，但产品定位不等于客户偏好，专利数量也不能单独证明护城河'
  const r71Adversarial={...unsupported,answer:`${positiveWithR71Caveat}。`,sections:unsupported.sections.map(section=>section.id==='products'?{...section,markdown:`${positiveWithR71Caveat}。[filing-1@paragraph:1]`}:section),findings:[{text:`${positiveWithR71Caveat}。`,kind:'fact' as const,evidence:[{sourceCandidateId:'filing-1',location:'paragraph:1'}]}]}
  calls=0
  const r71Rejected=await executeCompanyResearchMethod({skillId:'product_technology_analysis',company:{symbol:'002594'},asOf:'2026-10-14',sources:[filing],durableSourceCandidateIds:['filing-1'],reasoningExecutor:executor(async request=>{calls++;if(calls===1)assert.match((request as any).input.repairErrors[0].message,/PRODUCT_CUSTOMER_NEEDS_UNVERIFIED/);return r71Adversarial})})
  assert.equal(calls,2)
  assert.equal(r71Rejected.status,'failed','the R71 distinction cannot launder a concrete asserted customer preference')

  const positiveWithR72Caveat='客户偏好安全和续航，但各产品的客户需求证据、独立性能对标及具名竞品比较不足'
  const r72Adversarial={...unsupported,answer:`${positiveWithR72Caveat}。`,sections:unsupported.sections.map(section=>section.id==='products'?{...section,markdown:`${positiveWithR72Caveat}。[filing-1@paragraph:1]`}:section),findings:[{text:`${positiveWithR72Caveat}。`,kind:'fact' as const,evidence:[{sourceCandidateId:'filing-1',location:'paragraph:1'}]}]}
  calls=0
  const r72Rejected=await executeCompanyResearchMethod({skillId:'product_technology_analysis',company:{symbol:'002594'},asOf:'2026-10-14',sources:[filing],durableSourceCandidateIds:['filing-1'],reasoningExecutor:executor(async request=>{calls++;if(calls===1)assert.match((request as any).input.repairErrors[0].message,/PRODUCT_CUSTOMER_NEEDS_UNVERIFIED/);return r72Adversarial})})
  assert.equal(calls,2)
  assert.equal(r72Rejected.status,'failed','the R72 gap phrase cannot launder stated safety and range preferences')

  const positiveWithR73Caveat='消费者偏好安全、续航与低成本，但目前材料不足以证明相对竞品的性能、成本优势及客户偏好'
  const r73Adversarial={...unsupported,answer:`${positiveWithR73Caveat}。`,sections:unsupported.sections.map(section=>section.id==='products'?{...section,markdown:`${positiveWithR73Caveat}。[filing-1@paragraph:1]`}:section),findings:[{text:`${positiveWithR73Caveat}。`,kind:'fact' as const,evidence:[{sourceCandidateId:'filing-1',location:'paragraph:1'}]}]}
  calls=0
  const r73Rejected=await executeCompanyResearchMethod({skillId:'product_technology_analysis',company:{symbol:'002594'},asOf:'2026-10-14',sources:[filing],durableSourceCandidateIds:['filing-1'],reasoningExecutor:executor(async request=>{calls++;assert.match((request as any).instruction,/分产品毛利率.*不得改称.*个百分点/);if(calls===1)assert.match((request as any).input.repairErrors[0].message,/PRODUCT_CUSTOMER_NEEDS_UNVERIFIED/);return r73Adversarial})})
  assert.equal(calls,2)
  assert.equal(r73Rejected.status,'failed','comparative advantage caveats cannot launder stated customer preferences')

  for (const caveat of [
    '但相对竞品的量化性能、成本和客户选择证据不足，不能据此确认持久护城河',
    '但竞品同口径性能、成本和客户选择证据不足，尚不能确认持久护城河',
  ]) {
    const positiveWithR74Caveat=`消费者选择高性能、低成本车型，但${caveat.replace(/^但/, '')}`
    const r74Adversarial={...unsupported,answer:`${positiveWithR74Caveat}。`,sections:unsupported.sections.map(section=>section.id==='products'?{...section,markdown:`${positiveWithR74Caveat}。[filing-1@paragraph:1]`}:section),findings:[{text:`${positiveWithR74Caveat}。`,kind:'fact' as const,evidence:[{sourceCandidateId:'filing-1',location:'paragraph:1'}]}]}
    calls=0
    const r74Rejected=await executeCompanyResearchMethod({skillId:'product_technology_analysis',company:{symbol:'002594'},asOf:'2026-10-14',sources:[filing],durableSourceCandidateIds:['filing-1'],reasoningExecutor:executor(async request=>{calls++;if(calls===1)assert.match((request as any).input.repairErrors[0].message,/PRODUCT_CUSTOMER_NEEDS_UNVERIFIED/);return r74Adversarial})})
    assert.equal(calls,2)
    assert.equal(r74Rejected.status,'failed','an exact R74 limitation cannot launder an unsupported positive customer-choice claim')
  }

  for (const caveat of [
    '也不能替代客户偏好研究',
    '消费者实际偏好未获调研、反馈或购买行为证据',
  ]) {
    const positiveWithR75Caveat=`消费者偏好安全且看重续航，但${caveat}`
    const r75Adversarial={...unsupported,answer:`${positiveWithR75Caveat}。`,sections:unsupported.sections.map(section=>section.id==='products'?{...section,markdown:`${positiveWithR75Caveat}。[filing-1@paragraph:1]`}:section),findings:[{text:`${positiveWithR75Caveat}。`,kind:'fact' as const,evidence:[{sourceCandidateId:'filing-1',location:'paragraph:1'}]}]}
    calls=0
    const r75Rejected=await executeCompanyResearchMethod({skillId:'product_technology_analysis',company:{symbol:'002594'},asOf:'2026-10-14',sources:[filing],durableSourceCandidateIds:['filing-1'],reasoningExecutor:executor(async request=>{calls++;if(calls===1)assert.match((request as any).input.repairErrors[0].message,/PRODUCT_CUSTOMER_NEEDS_UNVERIFIED/);return r75Adversarial})})
    assert.equal(calls,2)
    assert.equal(r75Rejected.status,'failed','an R75 research-gap phrase cannot launder stated preferences in the same sentence')
  }

  const positiveWithR76Caveat='消费者偏好安全和续航但竞品对标、客户需求验证和独立性能证据有限，不能据此断言客户偏好或形成持久护城河'
  const r76Adversarial={...unsupported,answer:`${positiveWithR76Caveat}。`,sections:unsupported.sections.map(section=>section.id==='products'?{...section,markdown:`${positiveWithR76Caveat}。[filing-1@paragraph:1]`}:section),findings:[{text:`${positiveWithR76Caveat}。`,kind:'fact' as const,evidence:[{sourceCandidateId:'filing-1',location:'paragraph:1'}]}]}
  calls=0
  const r76Rejected=await executeCompanyResearchMethod({skillId:'product_technology_analysis',company:{symbol:'002594'},asOf:'2026-10-14',sources:[filing],durableSourceCandidateIds:['filing-1'],reasoningExecutor:executor(async request=>{calls++;if(calls===1)assert.match((request as any).input.repairErrors[0].message,/PRODUCT_CUSTOMER_NEEDS_UNVERIFIED/);return r76Adversarial})})
  assert.equal(calls,2)
  assert.equal(r76Rejected.status,'failed','the exact R76 caveat cannot launder positive preference claims in the same sentence')

  const r77Cases=[
    '消费者偏好安全但客户需求调研和购买行为证据缺失，不能把安全、动力、能耗或价格等直接写成消费者偏好事实',
    '消费者偏好安全但客户需求调研或反馈证据不足，实际购买偏好未获验证',
  ]
  for (const positiveWithR77Caveat of r77Cases) {
    const r77Adversarial={...unsupported,answer:`${positiveWithR77Caveat}。`,sections:unsupported.sections.map(section=>section.id==='products'?{...section,markdown:`${positiveWithR77Caveat}。[filing-1@paragraph:1]`}:section),findings:[{text:`${positiveWithR77Caveat}。`,kind:'fact' as const,evidence:[{sourceCandidateId:'filing-1',location:'paragraph:1'}]}]}
    calls=0
    const r77Rejected=await executeCompanyResearchMethod({skillId:'product_technology_analysis',company:{symbol:'002594'},asOf:'2026-10-14',sources:[filing],durableSourceCandidateIds:['filing-1'],reasoningExecutor:executor(async request=>{calls++;if(calls===1)assert.match((request as any).input.repairErrors[0].message,/PRODUCT_CUSTOMER_NEEDS_UNVERIFIED/);return r77Adversarial})})
    assert.equal(calls,2)
    assert.equal(r77Rejected.status,'failed','R77 limitation wording cannot launder an adjacent positive preference assertion')
  }

  const explicitNonUpgrade='客户需求调研和反馈未提供，安全、动力及车型不能升级为消费者偏好事实'
  const explicitNonUpgradeOutput={...unsupported,answer:explicitNonUpgrade,markdown:explicitNonUpgrade,sections:unsupported.sections.map(section=>section.id==='products'?{...section,markdown:`${explicitNonUpgrade}。[filing-1@paragraph:1]`}:section),findings:[{text:explicitNonUpgrade,kind:'assumption' as const,evidence:[{sourceCandidateId:'filing-1',location:'paragraph:1'}]}]}
  const explicitNonUpgradeResult=await executeCompanyResearchMethod({skillId:'product_technology_analysis',company:{symbol:'002594'},asOf:'2026-10-14',sources:[filing],durableSourceCandidateIds:['filing-1'],reasoningExecutor:executor(async()=>explicitNonUpgradeOutput)})
  assert.equal(explicitNonUpgradeResult.status,'complete','an explicit non-upgrade statement is a denial, not a positive customer preference claim')
  for (const explicitGap of [
    '客户对安全、能耗、成本或方案选择的实际偏好不能由产品规格和公司定位替代。相关因素仅可作为待验证分析假设。',
    '客户对能耗、成本、可靠性或产品路线的偏好只能作为待验证分析假设，而非客户事实',
    '客户实际需求偏好亦未获调研、访谈、反馈或购买行为验证',
    '现有材料不足以证明是实际客户关注或偏好',
    '公司将产品定位于AI基础设施场景，是公司定位而非独立客户偏好事实',
    '产品用途和公司关于客户要求的说法不能升级为独立客户偏好事实',
    '公司策略陈述不证明采购客户的真实偏好或订单承诺',
    '因而产品用途和公司定位不能被当作实际客户偏好事实',
    '本节不据此作客户偏好或产品级盈利判断',
    '现有产品资料不足以验证实际客户偏好或具名竞品的同口径优劣',
    '本次材料未提供明确客户需求调研、消费者反馈或可观察购买行为来验证安全、能耗、价格、车型选择等因素；这些只能作为待验证分析假设，不能作为客户事实。',
    '本次资料没有消费者调研、客户访谈或反馈、可观察购买行为，也没有公司明确披露的具体客户偏好结论。因此，安全、性能、能耗、成本或车型选择等只能作为待验证的潜在采购因素，不能写成实际客户关注事实。',
  ]) {
    const gapOutput={...unsupported,answer:explicitGap,markdown:explicitGap,sections:unsupported.sections.map(section=>section.id==='products'?{...section,markdown:`${explicitGap}。[filing-1@paragraph:1]`}:section),findings:[{text:explicitGap,kind:'assumption' as const,evidence:[{sourceCandidateId:'filing-1',location:'paragraph:1'}]}]}
    const accepted=await executeCompanyResearchMethod({skillId:'product_technology_analysis',company:{symbol:'002594'},asOf:'2026-10-14',sources:[filing],durableSourceCandidateIds:['filing-1'],reasoningExecutor:executor(async()=>gapOutput)})
    assert.equal(accepted.status,'complete',`explicit research gap should be accepted: ${explicitGap}; diagnostics=${JSON.stringify(accepted.diagnostics)}`)
  }
  const explicitNotValidated='公司扩展高多层板和HDI供给属于经营计划，不等于已验证的竞争优势'
  const notValidatedOutput={...unsupported,answer:explicitNotValidated,markdown:explicitNotValidated,sections:unsupported.sections.map(section=>section.id==='products'?{...section,markdown:`${explicitNotValidated}。[filing-1@paragraph:1]`}:section),findings:[{text:explicitNotValidated,kind:'inference' as const,evidence:[{sourceCandidateId:'filing-1',location:'paragraph:1'}]}]}
  const notValidatedResult=await executeCompanyResearchMethod({skillId:'product_technology_analysis',company:{symbol:'002594'},asOf:'2026-10-14',sources:[filing],durableSourceCandidateIds:['filing-1'],reasoningExecutor:executor(async()=>notValidatedOutput)})
  assert.equal(notValidatedResult.status,'complete',`a planned expansion explicitly distinguished from a validated advantage is a limitation, not a positive claim: ${JSON.stringify(notValidatedResult.diagnostics)}`)
})

test('product method does not let a nearby negative customer-preference clause mask a positive preference claim', async () => {
  const filing={...source,content:'公司新能源汽车产品覆盖乘用车和商用车。'}
  const launderingClaims=[
    '本次材料未提供明确客户需求调研、消费者反馈或可观察购买行为来验证安全、能耗、价格、车型选择等因素，但消费者偏好安全；相关因素只能作为待验证假设。',
    '客户偏好尚未验证但消费者偏好安全',
    '客户偏好研究尚未开展但消费者偏好安全',
    '公司未提供客户偏好研究但消费者偏好安全',
    '客户偏好证据不足但消费者偏好安全',
    '消费者偏好安全，但公司定位并非独立客户偏好事实',
    '公司竞争优势已验证，但产品扩产不等于已验证的竞争优势',
    '消费者偏好安全，但现有产品资料不足以验证实际客户偏好或具名竞品的同口径优劣',
    '客户对安全、能耗、成本或方案选择的实际偏好不能由产品规格和公司定位替代，但客户更偏好安全；相关因素仅可作为待验证分析假设',
  ]
  for (const claim of launderingClaims) {
    const candidate={...output,answer:claim,markdown:claim,sections:[
      {id:'products',markdown:`${claim} [filing-1@paragraph:1]`},
      {id:'technologies',markdown:'公司披露新能源汽车产品覆盖乘用车和商用车。[filing-1@paragraph:1]'},
    ],findings:[{text:claim,kind:'fact' as const,evidence:[{sourceCandidateId:'filing-1',location:'paragraph:1'}]}]}
    let calls=0
    const result=await executeCompanyResearchMethod({skillId:'product_technology_analysis',company:{symbol:'002594'},asOf:'2026-10-14',sources:[filing],durableSourceCandidateIds:['filing-1'],reasoningExecutor:executor(async request=>{
      calls++
      if(calls===1)assert.match((request as any).input.repairErrors[0].message,/PRODUCT_CUSTOMER_NEEDS_UNVERIFIED/)
      return candidate
    })})
    assert.equal(calls,2,claim)
    assert.equal(result.status,'failed',`nearby gap wording must not launder: ${claim}`)
    assert.ok(result.diagnostics.some(diagnostic=>diagnostic.message.includes('PRODUCT_CUSTOMER_NEEDS_UNVERIFIED')),JSON.stringify(result.diagnostics))
  }
})


test('numeric table repair pinpoints every failed row and requires its own exact cell evidence', async () => {
  const filing = {...source,content:'公司业务经营模式和财务盈利质量。\n光电显示模组毛利率 5.18%。\n光模块毛利率与利润表现 36.74%。'}
  const table = '| 业务 | 年度毛利率 |\n|---|---:|\n| 光电显示模组 | 5.18% |\n| 光模块 | 36.74% |'
  const broken = {...output,markdown:'业务存在利润率差异。[filing-1@paragraph:1]',findings:[{...output.findings[0]!,evidence:[{sourceCandidateId:'filing-1',location:'paragraph:1'}]}],sections:[{id:'financial-quality',markdown:`${table}\n\n业务有利润率差异。[filing-1@paragraph:1]`}]}
  let calls = 0
  const result = await executeCompanyResearchMethod({skillId:'financial_quality_analysis',company:{symbol:'002594'},asOf:'2026-10-14',sources:[filing],durableSourceCandidateIds:['filing-1'],reasoningExecutor:executor(async request=>{
    calls++
    const input = (request as any).input
    if (calls === 1) return broken
    assert.deepEqual(input.repairPreviousOutput,broken,'No citations are attached to the raw draft automatically')
    const target = input.repairTargets.find((item:any)=>item.fieldPath==='sections[0].markdown')
    assert.deepEqual(target.tableRows,[
      {rowIndex:2,header:'| 业务 | 年度毛利率 |',originalRow:'| 光电显示模组 | 5.18% |',unsupportedTokens:['5.18'],inlineReferences:[]},
      {rowIndex:3,header:'| 业务 | 年度毛利率 |',originalRow:'| 光模块 | 36.74% |',unsupportedTokens:['36.74'],inlineReferences:[]},
    ])
    assert.match(input.repairInstruction,/每个数值单元格的科目、期间和计量单位/)
    assert.match(input.repairInstruction,/不能复制附近文字的引用/)
    assert.match(input.repairInstruction,/findings中的引用、其他表行或表后散列引用不能代替本行/)
    return {...broken,sections:[{id:'financial-quality',markdown:table.replace('5.18% |','5.18% [filing-1@paragraph:2] |').replace('36.74% |','36.74% [filing-1@paragraph:3] |')}]}
  })})
  assert.equal(calls,2)
  assert.equal(result.status,'complete',JSON.stringify(result.diagnostics))
  assert.equal(result.attempts,2)
})

test('business-driver finding binds only the uniquely matching supplied transport-industry continuation row', async () => {
  const lines = Array.from({ length: 760 }, () => '一般经营披露。')
  const place = (start: number, rows: string[]) => rows.forEach((row, index) => { lines[start - 1 + index] = row })
  place(716, [
    '单位：元',
    '营业收入 营业成本 毛利率',
    '本期金额',
    '上年同期金额',
    '同比变动',
    '营业收入比上年同期增减',
    '营业成本比上年同期增减',
    '毛利率比上年同期增减',
    '营业收入',
    '营业成本',
    '毛利率比上年同期增减',
    '分行业',
    '日用电子器件制造业 69,404,994,000.00 65,907,931,000.00 5.04% 0.96% 3.88% -2.67%',
    '交通运输设备及电气制',
    '造业 275,341,358,000.00 213,863,297,000.00 22.33% -8.98% -11.24% 1.98%',
  ])
  const sourceId = 'official-industry'
  const claim = '交通运输设备及电气制造业营业收入同比-8.98%、营业成本同比-11.24%，该行毛利率同比增加1.98%；成本降幅更大与毛利率改善方向一致，但不能据此判断单位成本下降。'
  const evidence = [716, 717, 721, 722, 723, 724, 725, 726, 727, 729].map(paragraph => ({ sourceCandidateId: sourceId, location: `paragraph:${paragraph}` }))
  const makeOutput = (text = claim, refs = evidence) => ({
    status: 'complete', answer: '行业收入和毛利变化需结合业务结构解释。', markdown: '行业收入和毛利变化需结合业务结构解释。',
    sections: ['revenue-profit-drivers', 'growth-drivers', 'catalysts'].map(id => ({ id, markdown: `行业收入和毛利变化需结合业务结构解释。[${sourceId}@paragraph:716]` })),
    findings: [{ text, kind: 'fact' as const, evidence: refs }], limitations: [], risks: [],
  })
  const run = async (filing: NormalizedResearchSource, result = makeOutput()) => executeCompanyResearchMethod({ skillId: 'business_driver_analysis', company: { symbol: '002594' }, asOf: '2026-10-17', sources: [filing], durableSourceCandidateIds: [sourceId], maxAttempts: 1, reasoningExecutor: executor(async () => result) })

  const filing = { ...source, candidate: { ...source.candidate, candidateId: sourceId }, content: lines.join('\n') }
  const repaired = await run(filing)
  assert.equal(repaired.status, 'complete', JSON.stringify(repaired.diagnostics))
  assert.ok(repaired.findings[0]!.evidence.some(ref => ref.location === 'paragraph:730'), `the exact adjacent continuation is bound before normal validation: ${JSON.stringify({ findings: repaired.findings, diagnostics: repaired.diagnostics, repairs: repaired.citationRepairs })}`)

  const electronicsClaim = '日用电子器件制造业收入同比增长0.96%、营业成本同比增长3.88%，毛利率同比下降2.67%；总额增速不能证明单位成本变化。'
  const industryHeaders = [716,717,721,722,723,724,725,726,727].map(paragraph => ({ sourceCandidateId: sourceId, location: `paragraph:${paragraph}` }))
  const electronics = await run(filing, makeOutput(electronicsClaim, industryHeaders))
  assert.equal(electronics.status, 'complete', JSON.stringify(electronics.diagnostics))
  assert.ok(electronics.findings[0]!.evidence.some(ref => ref.location === 'paragraph:728'), 'the exact cited industry row must accompany its header citations')

  const combinedClaim = '日用电子器件制造业收入增长0.96%、营业成本增长3.88%；交通运输设备及电气制造业收入下降8.98%、营业成本下降11.24%。'
  const combined = await run(filing, makeOutput(combinedClaim, industryHeaders))
  assert.equal(combined.status, 'complete', JSON.stringify(combined.diagnostics))
  for (const paragraph of [728,729,730]) assert.ok(combined.findings[0]!.evidence.some(ref => ref.location === `paragraph:${paragraph}`), `combined finding binds exact row/label paragraph ${paragraph}`)

  const wrongAdjacentValues = [...lines]
  wrongAdjacentValues[729] = '造业 275,341,358,000.00 213,863,297,000.00 22.33% -8.98% -11.24% 1.97%'
  const wrongValue = await run({ ...filing, content: wrongAdjacentValues.join('\n') })
  assert.equal(wrongValue.status, 'failed', 'a neighboring row with a different final margin-change cell must not be borrowed')

  const wrongAdjacentMetric = [...lines]
  wrongAdjacentMetric[729] = '造业 275,341,358,000.00 213,863,297,000.00 22.33% -8.98% -11.24% 0.98%'
  const wrongMetric = await run({ ...filing, content: wrongAdjacentMetric.join('\n') })
  assert.equal(wrongMetric.status, 'failed', 'different adjacent-row margin data cannot ground the claim')

})

test('reference retry identifies the exact invalid document locator and forbids borrowing a matching paragraph number from another report', async () => {
  const annualLines = Array.from({ length: 920 }, () => '一般披露事项。')
  annualLines[0] = '公司经营情况及收入结构。'
  annualLines[912] = '董事会会议和金融资产管理情况。'
  const interimLines = Array.from({ length: 920 }, () => '一般披露事项。')
  interimLines[0] = '公司主营电子产品收入与产量情况。'
  interimLines[912] = '金融衍生资产余额12.34亿元；该指标不是电子产品收入或产量数据。'
  const annualId = 'annual-company-report'
  const interimId = 'interim-company-report'
  const makeSource = (candidateId: string, title: string, lines: string[]) => ({
    ...source,
    candidate: { ...source.candidate, candidateId, title },
    title,
    content: lines.join('\n'),
  })
  const annual = makeSource(annualId, '2025年度报告', annualLines)
  const interim = makeSource(interimId, '2026年半年度报告', interimLines)
  const invalid = {
    ...output,
    status: 'insufficient_evidence',
    answer: `业务增长仍需核验。[${interimId}@paragraph:913]`,
    markdown: `业务增长仍需核验。[${interimId}@paragraph:913]`,
    sections: [
      { id: 'revenue-profit-drivers', markdown: `2025年上半年电子产品收入增长8.8%。[${annualId}@paragraph:913]` },
      { id: 'growth-drivers', markdown: `公司收入与产量变化需持续跟踪。[${interimId}@paragraph:1]` },
      { id: 'catalysts', markdown: `后续经营变化仍待观察。[${interimId}@paragraph:1]` },
    ],
    findings: [],
    limitations: ['本次材料未提供能支持该期间分产品收入增速的精确数据行。'],
  }
  let calls = 0
  const result = await executeCompanyResearchMethod({ skillId: 'business_driver_analysis', company: { symbol: '002384' }, asOf: '2026-10-18', sources: [annual, interim], durableSourceCandidateIds: [annualId, interimId], reasoningExecutor: executor(async request => {
    calls++
    const actual = request as any
    if (calls === 1) {
      assert.ok(actual.input.evidence.some((packet: any) => packet.sourceCandidateId === interimId && packet.excerpts.some((row: any) => row.location === 'paragraph:913' && row.text.includes('金融衍生资产'))))
      assert.ok(!actual.input.evidence.some((packet: any) => packet.sourceCandidateId === annualId && packet.excerpts.some((row: any) => row.location === 'paragraph:913')))
      return invalid
    }
    const reference = actual.input.repairReferenceEvidence[0]
    assert.deepEqual(reference.invalidReference, {
      sourceCandidateId: annualId,
      location: 'paragraph:913',
      reason: '该定位未包含在本方法本轮实际供给的evidence摘录中；同段号的其他报告不能替代该来源定位。',
    })
    assert.ok(reference.candidates.some((candidate: any) => candidate.sourceCandidateId === interimId && candidate.location === 'paragraph:913' && candidate.text.includes('金融衍生资产')))
    assert.match(actual.input.repairInstruction, new RegExp(`${annualId}\\@paragraph:913`))
    assert.match(actual.input.repairInstruction, /sourceCandidateId\+location\+text证据配对/)
    assert.match(actual.input.repairInstruction, /严禁把一份报告的来源ID与另一份报告的相同段号拼接/)
    assert.match(actual.input.repairInstruction, /若没有完全匹配的候选，删除该句或数字并在limitations具体说明缺口/)
    assert.match(actual.instruction, /同段号的其他报告不能替代该来源定位/)
    return {
      ...invalid,
      answer: `分产品收入增速尚未核实。[${interimId}@paragraph:913]`,
      markdown: `该半年度报告段落披露金融衍生资产，不能支持产品收入增速。[${interimId}@paragraph:913]`,
      sections: [
        { id: 'revenue-profit-drivers', markdown: `产品收入增长尚未由本轮材料验证，应补采对应期间的分产品收入表。[${interimId}@paragraph:913]` },
        { id: 'growth-drivers', markdown: `公司收入与产量变化需持续跟踪。[${interimId}@paragraph:913]` },
        { id: 'catalysts', markdown: `后续经营变化仍待观察。[${interimId}@paragraph:913]` },
      ],
      findings: [{ text: '半年度报告的金融衍生资产数据不支持产品收入增速判断。', kind: 'inference', evidence: [{ sourceCandidateId: interimId, location: 'paragraph:913' }] }],
      limitations: ['本次材料未提供能支持该期间分产品收入增速的精确数据行。'],
    }
  }) })
  assert.equal(result.status, 'insufficient_evidence', JSON.stringify(result.diagnostics))
  assert.equal(result.attempts, 2)
  assert.ok(!result.sections.some(section => section.markdown.includes('电子产品收入增长8.8%')), 'the unsupported original growth claim is removed rather than rebound to the other report')
})

test('market-structure repairs a wrong annual-report locator only when an exact quote maps to one supplied paragraph', async () => {
  const makeAnnual = (candidateId: string, year: string, target: string) => {
    const lines = Array.from({ length: 40 }, (_, index) => `一般年度披露第${index + 1}段。`)
    lines[31] = target
    return { ...source, candidate: { ...source.candidate, candidateId, title: `${year}年年度报告` }, title: `${year}年年度报告`, content: lines.join('\n') }
  }
  const annual2025 = makeAnnual('annual-2025', '2025', '中国汽车工业电动化和智能化变革带来机遇，也有利于促进世界汽车产业升级和“双碳”目标。')
  const annual2024 = makeAnnual('annual-2024', '2024', '董事会会议和金融资产管理情况。')
  let calls = 0
  const wrongLocator = {
    ...output,
    answer: '年报提及“双碳”目标，行业政策仍需跟踪。[annual-2024@paragraph:32]',
    markdown: '年报提及“双碳”目标，行业政策仍需跟踪。[annual-2024@paragraph:32]',
    sections: [{ id: 'industry-exposure', markdown: '年报提及“双碳”目标，行业政策仍需跟踪。[annual-2024@paragraph:32]' }],
    findings: [{ text: '年报提及“双碳”目标。', kind: 'fact', evidence: [{ sourceCandidateId: 'annual-2024', location: 'paragraph:32' }] }],
  }
  const result = await executeCompanyResearchMethod({
    skillId: 'market_structure_analysis', company: { symbol: '002594' }, asOf: '2026-10-23',
    sources: [annual2024, annual2025], durableSourceCandidateIds: ['annual-2024', 'annual-2025'],
    reasoningExecutor: executor(async request => {
      calls++
      const actual = request as any
      if (calls === 1) throw new ReasoningExecutorError('reasoning_output_invalid', 'JSON Schema contract: findings, limitations, and risks are required')
      assert.ok(actual.input.evidence.some((packet: any) => packet.sourceCandidateId === 'annual-2025' && packet.excerpts.some((row: any) => row.location === 'paragraph:32' && row.text.includes('“双碳”目标'))), 'the replacement paragraph must have been supplied to this method')
      return wrongLocator
    }),
  })
  assert.equal(calls, 2, 'the deterministic repair stays within the existing two-attempt method budget')
  assert.equal(result.status, 'complete', JSON.stringify(result.diagnostics))
  assert.equal(result.attempts, 2)
  assert.ok(result.sections[0]!.markdown.includes('[annual-2025@paragraph:32]'))
  assert.ok(result.findings[0]!.evidence.some(ref => ref.sourceCandidateId === 'annual-2025' && ref.location === 'paragraph:32'))
  assert.ok((result.citationRepairs ?? []).some(repair => repair.originalReferences.some(ref => ref.sourceCandidateId === 'annual-2024' && ref.location === 'paragraph:32') && repair.addedReferences.some(ref => ref.sourceCandidateId === 'annual-2025' && ref.location === 'paragraph:32')))
})

test('market-structure leaves an unavailable locator untouched when its quoted anchor matches multiple supplied paragraphs', async () => {
  const makeAnnual = (candidateId: string, target: string) => {
    const lines = Array.from({ length: 40 }, (_, index) => `一般年度披露第${index + 1}段。`)
    lines[31] = target
    return { ...source, candidate: { ...source.candidate, candidateId, title: `${candidateId} 年度报告` }, title: `${candidateId} 年度报告`, content: lines.join('\n') }
  }
  const annual2024 = makeAnnual('annual-2024', '董事会会议和金融资产管理情况。')
  const annual2025a = makeAnnual('annual-2025-a', '中国汽车工业电动化和智能化变革带来机遇，也有利于促进世界汽车产业升级和“双碳”目标。')
  const annual2025b = makeAnnual('annual-2025-b', '行业电动化和智能化发展带来“双碳”目标相关机遇。')
  const outputWithWrongLocator = {
    ...output,
    answer: '年报提及“双碳”目标。[annual-2024@paragraph:32]',
    markdown: '年报提及“双碳”目标。[annual-2024@paragraph:32]',
    sections: [{ id: 'industry-exposure', markdown: '年报提及“双碳”目标。[annual-2024@paragraph:32]' }],
    findings: [{ text: '年报提及“双碳”目标。', kind: 'fact', evidence: [{ sourceCandidateId: 'annual-2024', location: 'paragraph:32' }] }],
  }
  const result = await executeCompanyResearchMethod({
    skillId: 'market_structure_analysis', company: { symbol: '002594' }, asOf: '2026-10-23',
    sources: [annual2024, annual2025a, annual2025b], durableSourceCandidateIds: ['annual-2024', 'annual-2025-a', 'annual-2025-b'],
    reasoningExecutor: executor(async () => outputWithWrongLocator),
  })
  assert.equal(result.status, 'failed', 'ambiguous source mapping must still fail closed')
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === 'REFERENCE_ERROR'))
  assert.equal((result.citationRepairs ?? []).length, 0)
})


test('reference retry extracts the cited Markdown table row and excludes same-number locators without claim overlap', async () => {
  const priorId = 'prior-annual-report'
  const currentId = 'current-annual-report'
  const duplicateId = 'duplicate-current-report'
  const unrelatedId = 'unrelated-geely-page'
  const make = (candidateId: string, title: string, targetText: string) => {
    const lines = Array.from({ length: 322 }, () => '一般披露事项。')
    lines[0] = '公司业务与产品情况。'
    lines[321] = targetText
    return { ...source, candidate: { ...source.candidate, candidateId, title, metadata: undefined }, title, content: lines.join('\n') }
  }
  const prior = make(priorId, '2024年度报告', '董事会办公用品采购情况。')
  const current = make(currentId, '2025年度报告', '光伏业务覆盖硅片、电池片、组件与系统应用，是公司清洁能源布局。')
  const duplicate = make(duplicateId, '2025年度报告副本', '光伏业务覆盖硅片、电池片、组件与系统应用，是公司清洁能源布局。')
  const unrelated = make(unrelatedId, '吉利汽车官网', '一键开启智慧汽车生活。')
  let calls = 0
  const broken = {
    status: 'complete', answer: '光伏竞争情况待核验。', markdown: '光伏业务分析。',
    sections: [{ id: 'competition', markdown: '| 细分市场 | 公司产品与路线 |\n|---|---|\n| 光伏 | 比亚迪覆盖硅片、电池片、组件及系统应用。[prior-annual-report@paragraph:322] |' }],
    findings: [{ text: '比亚迪光伏业务覆盖硅片、电池片、组件与系统应用。', kind: 'fact', evidence: [{ sourceCandidateId: priorId, location: 'paragraph:322' }] }],
    limitations: [], risks: [],
  }
  const corrected = {
    ...broken,
    sections: [{ id: 'competition', markdown: '| 细分市场 | 公司产品与路线 |\n|---|---|\n| 光伏 | 比亚迪覆盖硅片、电池片、组件及系统应用。[current-annual-report@paragraph:322] |' }],
    findings: [{ text: '比亚迪光伏业务覆盖硅片、电池片、组件与系统应用。', kind: 'fact', evidence: [{ sourceCandidateId: currentId, location: 'paragraph:322' }] }],
  }
  const result = await executeCompanyResearchMethod({ skillId: 'competitive_market_map', company: { symbol: '002594' }, asOf: '2026-10-18', sources: [prior, current, duplicate, unrelated], durableSourceCandidateIds: [priorId, currentId, duplicateId, unrelatedId], reasoningExecutor: executor(async request => {
    calls++
    const input = (request as any).input
    if (calls === 1) {
      assert.ok(!input.evidence.some((packet: any) => packet.sourceCandidateId === priorId && packet.excerpts.some((row: any) => row.location === 'paragraph:322')))
      assert.ok(input.evidence.some((packet: any) => packet.sourceCandidateId === currentId && packet.excerpts.some((row: any) => row.location === 'paragraph:322' && row.text.includes('光伏业务'))))
      return broken
    }
    const repair = input.repairReferenceEvidence[0]
    assert.match(repair.claim, /光伏.*比亚迪覆盖硅片.*组件及系统应用/)
    assert.ok(repair.candidates.some((candidate: any) => candidate.sourceCandidateId === currentId && candidate.location === 'paragraph:322' && candidate.text.includes('光伏业务')))
    assert.ok(repair.candidates.some((candidate: any) => candidate.sourceCandidateId === duplicateId && candidate.location === 'paragraph:322' && candidate.text.includes('光伏业务')))
    assert.ok(!repair.candidates.some((candidate: any) => candidate.sourceCandidateId === unrelatedId && candidate.location === 'paragraph:322'), 'a paragraph-number collision without claim overlap is not offered')
    assert.match(input.repairInstruction, /sourceCandidateId\+location\+text证据配对/)
    return corrected
  }) })
  assert.equal(calls, 2)
  assert.equal(result.status, 'complete', JSON.stringify(result.diagnostics))
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === 'REFERENCE_ERROR'))
})

test('R144 BYD competitive evidence reserves battery, storage, and photovoltaic rows and repairs to the explicit citation inventory', async () => {
  const sourceId = 'official-f6274e510499a654'
  const catlId = 'catl-profile'
  const lines = Array.from({ length: 604 }, () => '一般披露事项。')
  lines[318] = '董事会会议和金融资产管理情况。'
  lines[595] = '作为全球新能源汽车行业先行者，本集团持续开展技术创新。'
  lines[598] = '本集团为全球领先的二次充电电池制造商之一。'
  lines[599] = '动力电池领域，本集团开发了磷酸铁锂电池“刀片电池”，用于新能源汽车。'
  lines[600] = '储能电池领域，本集团在电源侧储能、电网储能、工商业储能、家庭储能等领域发力。'
  lines[601] = '光伏业务是本集团在清洁能源领域的重要布局。'
  lines[602] = '本集团拥有硅片、电池片、光伏组件、光伏系统应用等全产业链布局。'
  lines[603] = '本集团将继续布局新技术并推动产品发展。'
  const filing = { ...source, candidate: { ...source.candidate, candidateId: sourceId, metadata: undefined }, title: '比亚迪2024年年度报告', content: lines.join('\n') }
  const catl = { ...source, candidate: { ...source.candidate, candidateId: catlId, metadata: { researchSubject: 'peer_company', peerCompanyName: '宁德时代' } }, title: '宁德时代产品资料', content: '宁德时代提供动力电池与储能系统解决方案。' }
  const packet = selectCompanyEvidence([filing, catl], [sourceId, catlId], ['竞争', '电池', '储能', '光伏', '产品'], { purpose: 'competitive_market_map' }).find(row => row.sourceCandidateId === sourceId)!
  for (const location of ['paragraph:600', 'paragraph:601', 'paragraph:602', 'paragraph:603', 'paragraph:604']) assert.ok(packet.excerpts.some(row => row.location === location), `required product/technology row ${location}`)
  assert.ok(!packet.excerpts.some(row => row.location === 'paragraph:319'), 'stale/unrelated locator is not supplied')
  const productPacket = selectCompanyEvidence([filing], [sourceId], ['产品', '技术', '电池', '储能', '光伏'], { purpose: 'product_technology_analysis' }).find(row => row.sourceCandidateId === sourceId)!
  for (const location of ['paragraph:600', 'paragraph:601', 'paragraph:602']) assert.ok(productPacket.excerpts.some(row => row.location === location), `product method must receive ${location}`)
  const broken = {
    status: 'complete', answer: '动力电池和储能路线有限交叠。', markdown: `比亚迪披露动力电池与储能产品。[${sourceId}@paragraph:319]`,
    sections: [{ id: 'competition', markdown: `比亚迪披露刀片电池及多类储能应用；客户与同规格性能尚未比较。[${sourceId}@paragraph:319]` }],
    findings: [{ text: '比亚迪披露动力电池和储能产品。', kind: 'fact', evidence: [{ sourceCandidateId: sourceId, location: 'paragraph:319' }] }], limitations: [], risks: [],
  }
  const corrected = {
    ...broken,
    markdown: `比亚迪披露动力电池与储能产品。[${sourceId}@paragraph:600]`,
    sections: [{ id: 'competition', markdown: `比亚迪披露刀片电池及多类储能应用；客户与同规格性能尚未比较。[${sourceId}@paragraph:600] [${sourceId}@paragraph:601] [${sourceId}@paragraph:602]` }],
    findings: [{ text: '比亚迪披露动力电池和储能产品。', kind: 'fact', evidence: [{ sourceCandidateId: sourceId, location: 'paragraph:600' }, { sourceCandidateId: sourceId, location: 'paragraph:601' }, { sourceCandidateId: sourceId, location: 'paragraph:602' }] }],
  }
  let calls = 0
  const result = await executeCompanyResearchMethod({ skillId: 'competitive_market_map', company: { symbol: '002594' }, asOf: '2026-10-18', sources: [filing, catl], durableSourceCandidateIds: [sourceId, catlId], reasoningExecutor: executor(async request => {
    calls++
    const input = (request as any).input
    if (calls === 1) return broken
    assert.ok(input.allowedCitationPairs.includes(`${sourceId}@paragraph:600`))
    assert.ok(input.allowedCitationPairs.includes(`${sourceId}@paragraph:601`))
    assert.ok(!input.allowedCitationPairs.includes(`${sourceId}@paragraph:319`))
    assert.match((request as any).instruction, /allowedCitationPairs是唯一可使用的来源-定位清单/)
    assert.ok(input.evidence.some((evidencePacket: any) => evidencePacket.sourceCandidateId === sourceId && evidencePacket.excerpts.some((row: any) => row.location === 'paragraph:600' && row.text.includes('刀片电池'))), JSON.stringify(input.evidence.find((p: any) => p.sourceCandidateId === sourceId)?.excerpts.filter((e: any) => /^paragraph:(59[5-9]|60[0-4])$/.test(e.location)).map((e: any) => [e.location,e.text])))
    assert.ok(input.repairReferenceEvidence[0].candidates.some((candidate: any) => candidate.sourceCandidateId === sourceId && candidate.location === 'paragraph:600' && candidate.text.includes('刀片电池')), JSON.stringify(input.repairReferenceEvidence[0]))
    return corrected
  }) })
  assert.equal(calls, 2)
  assert.equal(result.status, 'complete', JSON.stringify(result.diagnostics))
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === 'REFERENCE_ERROR'))
})

test('competitive method fails closed when a retry invents a source id outside the supplied evidence inventory', async () => {
  const filing = { ...source, content: '刀片电池用于新能源汽车。' }
  const unsupportedId = 'invented-annual-report-id'
  const wrong = {
    status: 'complete', answer: '动力电池路线。', markdown: `动力电池路线。[${unsupportedId}@paragraph:1]`,
    sections: [{ id: 'competition', markdown: `比亚迪披露刀片电池。[${unsupportedId}@paragraph:1]` }],
    findings: [{ text: '比亚迪披露刀片电池。', kind: 'fact', evidence: [{ sourceCandidateId: unsupportedId, location: 'paragraph:1' }] }], limitations: [], risks: [],
  }
  let calls = 0
  const result = await executeCompanyResearchMethod({ skillId: 'competitive_market_map', company: { symbol: '002594' }, asOf: '2026-10-18', sources: [filing], durableSourceCandidateIds: ['filing-1'], reasoningExecutor: executor(async request => {
    calls++
    if (calls === 2) assert.ok(!(request as any).input.allowedCitationPairs.includes(`${unsupportedId}@paragraph:1`))
    return wrong
  }) })
  assert.equal(calls, 2)
  assert.equal(result.status, 'failed')
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === 'REFERENCE_ERROR'))
})

test('review-driven competitive revision repairs only a unique same-claim supplied source and never authorizes feedback ids', async () => {
  const sourceId = 'official-c19c34dd239b2e9c'
  const wrongId = 'official-f7c8d23d2829b2e9c'
  const lines = Array.from({ length: 166 }, () => '一般披露事项。')
  lines[163] = '动力电池、电驱动、电控、整车平台及智能座舱等领域形成技术布局。'
  lines[164] = '汽车电动化：本集团围绕动力电池、纯电/插混平台持续开展技术研发。'
  lines[165] = '相关技术成果在多品牌、多车型中规模化应用。'
  const filing = { ...source, candidate: { ...source.candidate, candidateId: sourceId }, title: '2026年半年度报告', content: lines.join('\n') }
  const claim = '公司披露动力电池及电驱动、电控、整车平台技术布局，并将关键技术成果在多品牌、多车型中规模化应用。'
  const rejectedReviewDraft = {
    status: 'complete', answer: '关键技术成果持续应用。', markdown: `${claim}[${wrongId}@paragraph:165]`,
    sections: [{ id: 'competition', markdown: `${claim}[${wrongId}@paragraph:165]` }],
    findings: [{ text: claim, kind: 'fact', evidence: [{ sourceCandidateId: wrongId, location: 'paragraph:165' }] }], limitations: [], risks: [],
  }
  let calls = 0
  const result = await executeCompanyResearchMethod({ skillId: 'competitive_market_map', company: { symbol: '002594' }, asOf: '2026-10-18', sources: [filing], durableSourceCandidateIds: [sourceId], methodology: 'Canonical method. Workflow 上轮内容审查反馈：复核动力电池技术路线。', reasoningExecutor: executor(async request => {
    calls++
    const input = (request as any).input
    assert.ok(input.allowedCitationPairs.includes(`${sourceId}@paragraph:165`))
    assert.ok(!input.allowedCitationPairs.includes(`${wrongId}@paragraph:165`))
    assert.match((request as any).instruction, /allowedCitationPairs是唯一可使用的来源-定位清单/)
    return rejectedReviewDraft
  }) })
  assert.equal(calls, 1)
  assert.equal(result.status, 'complete', JSON.stringify(result.diagnostics))
  assert.match(result.sections[0]!.markdown, new RegExp(`\\[${sourceId}@paragraph:165\\]`))
  assert.ok(![result.markdown, ...result.sections.map(section => section.markdown), ...result.findings.flatMap(finding => [finding.text, ...finding.evidence.map(ref => ref.sourceCandidateId)])].join('\n').includes(wrongId))
})

test('business packet retains a separate annual revenue-composition table and its exact product-share citation', async () => {
  const lines = Array.from({length:1000},()=> '一般披露事项。')
  const place = (start:number,rows:string[])=>rows.forEach((row,index)=>{lines[start-1+index]=row})
  place(862,['（1） 营业收入构成','单位：元','2025 年 2024 年','同比增减','金额 占营业收入比重 金额 占营业收入比重','营业收入合计 40,124,858,839.52 100% 36,770,374,347.58 100% 9.12%','分行业','计算机、通信和','其他电子 39,643,732,616.04 98.80% 36,479,191,979.20 99.21% 8.67%','其他 481,126,223.48 1.20% 291,182,368.38 0.79% 65.23%','分产品','电子电路产品 25,620,292,915.99 63.85% 24,800,813,670.87 67.45% 3.30%','光电显示模组 5,985,629,058.48 14.92%','精密组件产品 5,930,242,495.99 14.78%','光模块 1,435,534,921.96 3.58%'])
  place(886,['营业收入 营业成本 毛利率','同期增减','营业成本比上年','同期增减','毛利率比上年','同期增减','分行业','计算机、通信','和其他电子 39,643,732,616.04 34,153,971,460.65 13.85%','分产品','电子电路产品 25,620,292,915.99 21,113,572,455.81 17.59%'])
  const filing = {...source,content:lines.join('\n')}
  const packet = selectCompanyEvidence([filing],['filing-1'],['业务','收入','客户','成本'],{purpose:'business_model_map'})[0]!
  for (const row of [862,863,864,866,868,870,872,873]) assert.ok(packet.excerpts.some(excerpt=>excerpt.location===`paragraph:${row}`),`composition row ${row}`)
  assert.ok(packet.excerpts.reduce((sum,row)=>sum+row.text.length,0)<=32000)
  assert.ok(packet.excerpts.length<=96)
  const citation = '[filing-1@paragraph:873] [filing-1@paragraph:864] [filing-1@paragraph:866]'
  const result = await executeCompanyResearchMethod({skillId:'business_model_map',company:{symbol:'002384'},asOf:'2026-10-14',sources:[filing],durableSourceCandidateIds:['filing-1'],reasoningExecutor:executor(async request=>{
    const actual = request as any
    assert.ok(actual.input.evidence[0].excerpts.some((row:any)=>row.location==='paragraph:873'))
    assert.match(actual.instruction,/不能只查毛利表后宣称收入占比未列示/)
    return {...output,markdown:`公司主要收入来自电子电路产品。${citation}`,sections:['business-model','business-segments','supply-chain'].map(id=>({id,markdown:`2025年电子电路产品收入占比63.85%。${citation}`})),findings:[{text:'2025年电子电路产品收入占比63.85%。',kind:'fact',evidence:[{sourceCandidateId:'filing-1',location:'paragraph:873'},{sourceCandidateId:'filing-1',location:'paragraph:864'},{sourceCandidateId:'filing-1',location:'paragraph:866'}]}]}
  })})
  assert.equal(result.status,'complete',JSON.stringify(result.diagnostics))
  assert.equal(result.attempts,1)
})


test('business model preserves disclosed customer concentration ratios while leaving anonymous identity and segment mapping as gaps', async () => {
  const lines = Array.from({length:1000},()=> '一般披露事项。')
  const place=(start:number,rows:string[])=>rows.forEach((row,index)=>{lines[start-1+index]=row})
  place(916,['公司主要销售客户情况','前五名客户合计销售金额（元） 145,648,095,000.00','前五名客户合计销售金额占年度销售总额比例 18.12%','前五名客户销售额中关联方销售额占年度销售总额比例 0.00%','公司前5大客户资料','序号 客户名称 销售额（元） 占年度销售总额比例','1 客户一 100,736,686,000.00 12.53%','2 客户二 16,498,131,000.00 2.05%'])
  const filing={...source,title:'2025年度报告',content:lines.join('\n')}
  const packet=selectCompanyEvidence([filing],['filing-1'],['业务','收入','客户','供应链'],{purpose:'business_model_map'})[0]!
  for(const row of [917,918,921,922])assert.ok(packet.excerpts.some(excerpt=>excerpt.location===`paragraph:${row}`),`customer concentration row ${row}`)
  const ratioRefs=[{sourceCandidateId:'filing-1',location:'paragraph:918'},{sourceCandidateId:'filing-1',location:'paragraph:921'},{sourceCandidateId:'filing-1',location:'paragraph:922'}]
  const ratioText='年报披露前五大客户销售额占年度销售总额18.12%，其中最大匿名客户占12.53%；客户名称匿名，且未披露客户对应的产品或业务分部，不能把集团客户集中度归属于特定业务。'
  const citation=ratioRefs.map(ref=>`[${ref.sourceCandidateId}@${ref.location}]`).join(' ')
  const result=await executeCompanyResearchMethod({skillId:'business_model_map',company:{symbol:'002594'},asOf:'2026-10-14',sources:[filing],durableSourceCandidateIds:['filing-1'],reasoningExecutor:executor(async request=>{
    const actual=request as any
    assert.match(actual.instruction,/不得因客户名称匿名而称集中度比例未披露或不可验证/)
    assert.match(actual.instruction,/客户匿名、客户所属产品\/分部未披露/)
    assert.match(actual.instruction,/客户与供应商字段必须各自引用对应客户表或供应商表的摘要行、明细表头、单位\/期间和数值行/)
    assert.match(actual.instruction,/不得借用相邻营业成本构成、分产品收入\/毛利表或其他业务表的表头、单位和期间/)
    assert.ok(actual.input.evidence[0].excerpts.some((row:any)=>row.location==='paragraph:918'&&row.text.includes('18.12%')))
    assert.ok(actual.input.evidence[0].excerpts.some((row:any)=>row.location==='paragraph:922'&&row.text.includes('12.53%')))
    return {...output,markdown:`${ratioText} ${citation}`,sections:['business-model','business-segments','supply-chain'].map(id=>({id,markdown:`${ratioText} ${citation}`})),findings:[{text:'前五大客户占年度销售总额18.12%，最大匿名客户占12.53%。',kind:'fact',evidence:ratioRefs}]}
  })})
  assert.equal(result.status,'complete',JSON.stringify(result.diagnostics))
  assert.match(result.sections.find(section=>section.id==='business-model')!.markdown,/18\.12%.*12\.53%.*匿名/)
  assert.match(result.sections.find(section=>section.id==='supply-chain')!.markdown,/18\.12%.*12\.53%.*未披露客户对应的产品或业务分部/)
})


test('numeric repair offers bounded actually supplied token rows without silently attaching label-neighbour citations', async () => {
  const lines = Array.from({length:900},()=> '一般披露事项。')
  lines[818]='营业收入构成'
  lines[819]='2025年 2024年；金额 占营业收入比重 金额 占营业收入比重'
  lines[820]='汽车及相关产品业务收入'
  lines[821]='汽车及相关产品 648,645,636,000 80.68% 617,382,000,000 79.45%'
  const filing = {...source,content:lines.join('\n')}
  const refs=[{sourceCandidateId:'filing-1',location:'paragraph:820'},{sourceCandidateId:'filing-1',location:'paragraph:821'}]
  const text='2025年汽车业务收入占比80.68%，2024年占比79.45%。'
  const citations=refs.map(ref=>`[${ref.sourceCandidateId}@${ref.location}]`).join(' ')
  const broken={...output,markdown:`公司汽车业务构成主要收入。${citations}`,sections:['business-model','business-segments','supply-chain'].map(id=>({id,markdown:`${text}${citations}`})),findings:[{text:'汽车业务收入占比80.68%。',kind:'fact',evidence:refs}]}
  let calls=0
  const result=await executeCompanyResearchMethod({skillId:'business_model_map',company:{symbol:'002594'},asOf:'2026-10-14',sources:[filing],durableSourceCandidateIds:['filing-1'],reasoningExecutor:executor(async request=>{
    calls++
    const input=(request as any).input
    if(calls===1)return broken
    assert.deepEqual(input.repairPreviousOutput,broken)
    const candidates=input.repairTargets.flatMap((target:any)=>target.candidateExcerpts??[])
    for(const token of ['80.68'])assert.ok(candidates.some((row:any)=>row.token===token && row.location==='paragraph:822' && row.sourceCandidateId==='filing-1'),JSON.stringify(candidates))
    assert.ok(candidates.length<=24)
    assert.ok(candidates.reduce((sum:number,row:any)=>sum+row.text.length+(row.context??[]).reduce((n:number,context:any)=>n+context.text.length,0),0)<=6000)
    assert.ok(candidates.find((row:any)=>row.location==='paragraph:822').context.some((row:any)=>row.location==='paragraph:820' && row.text.includes('2025年 2024年')))
    for(const candidate of candidates)assert.ok(input.evidence.some((packet:any)=>packet.sourceCandidateId===candidate.sourceCandidateId && packet.excerpts.some((row:any)=>row.location===candidate.location && row.text.includes(candidate.text))))
    assert.match(input.repairInstruction,/候选可能是另一年份或另一科目/)
    assert.match(input.repairInstruction,/不是自动引用或口径正确的证明/)
    return {...broken,sections:broken.sections.map(section=>({...section,markdown:`${section.markdown} [filing-1@paragraph:822]`})),findings:[{...broken.findings[0],evidence:[...refs,{sourceCandidateId:'filing-1',location:'paragraph:822'}]}]}
  })})
  assert.equal(result.status,'complete',JSON.stringify(result.diagnostics))
  assert.equal(result.attempts,2)
  assert.deepEqual((result.attemptOutputs![0]!.output as any).findings[0].evidence,refs,'Candidates never mutate original output citations')
  const unsupportedCurrent={...broken,findings:[{text:'本期汽车业务收入占比79.45%。',kind:'fact',evidence:refs}]}
  const rejected=await executeCompanyResearchMethod({skillId:'business_model_map',company:{symbol:'002594'},asOf:'2026-10-14',sources:[filing],durableSourceCandidateIds:['filing-1'],reasoningExecutor:executor(async()=>unsupportedCurrent)})
  assert.equal(rejected.status,'failed','Candidate suggestions alone cannot support an uncited current-period claim')
  assert.equal(rejected.attempts,2)
})

test('business model numeric claims bind citations in the same sentence, including repeated values', async () => {
  const filing = { ...source, content: '电子电路产品毛利率18.59%。' }
  const broken = {
    ...output,
    answer: '公司产品结构已披露。',
    markdown: '公司产品盈利能力存在差异。',
    sections: [
      { id: 'business-model', markdown: '公司通过电子制造产品实现收入。[filing-1@paragraph:1]' },
      { id: 'business-segments', markdown: '产品层级毛利率存在差异。[filing-1@paragraph:1]' },
      { id: 'supply-chain', markdown: '电子电路产品毛利率为17.59%。[filing-1@paragraph:1]' },
    ],
    findings: [{ text: '电子制造业务的毛利表现需结合产品结构分析。', kind: 'inference', evidence: [{ sourceCandidateId: 'filing-1', location: 'paragraph:1' }] }],
  }
  let calls = 0
  const result = await executeCompanyResearchMethod({ skillId: 'business_model_map', company: { symbol: '002384' }, asOf: '2026-10-18', sources: [filing], durableSourceCandidateIds: ['filing-1'], reasoningExecutor: executor(async request => {
    calls++
    const actual = request as any
    assert.match(actual.instruction, /同一句出现收入金额、占比、毛利率/)
    assert.match(actual.instruction, /每个出现处重新附上相应数据行引用/)
    if (calls === 1) return broken
    assert.equal(actual.input.repairErrors[0].code, 'NUMERIC_GROUNDING_ERROR')
    assert.match(actual.input.repairInstruction, /每个错误数字所在句必须直接引用包含该数字的对应行/)
    assert.match(actual.input.repairInstruction, /该处也必须重新引用对应行/)
    return {
      ...broken,
      sections: broken.sections.map(section => section.id === 'supply-chain'
        ? { ...section, markdown: '电子电路产品毛利率为18.59%。[filing-1@paragraph:1]' }
        : section),
    }
  }) })
  assert.equal(result.status, 'complete', JSON.stringify(result.diagnostics))
  assert.equal(result.attempts, 2)
})

test('numeric repair exposes an adjacent supplied label line when a per-share fact spans PDF paragraphs', async () => {
  const filing = { ...source, content: '报告期内，公司增发股份125,693,822股。\n每股净资产减少0.87元/股，按净利润计算，因增发股份导致减少基本每股收益和稀释每\n股收益0.03元/股。' }
  const broken = { ...output, answer: '增发对每股收益有影响。', markdown: '增发的每股收益变化有年报依据。[filing-1@paragraph:1]', sections: [{ id: 'management-capital-allocation', markdown: '增发使每股收益减少0.03元/股。[filing-1@paragraph:1] [filing-1@paragraph:3]' }], findings: [{ text: '增发使每股收益减少0.03元/股。', kind: 'fact', evidence: [{ sourceCandidateId: 'filing-1', location: 'paragraph:1' }, { sourceCandidateId: 'filing-1', location: 'paragraph:3' }] }] }
  let calls = 0
  const result = await executeCompanyResearchMethod({ skillId: 'capital_allocation_review', company: { symbol: '002384' }, asOf: '2026-10-15', sources: [filing], durableSourceCandidateIds: ['filing-1'], reasoningExecutor: executor(async request => {
    const input = (request as any).input
    if (++calls === 1) return broken
    const candidate = input.repairTargets.flatMap((target: any) => target.candidateExcerpts ?? []).find((item: any) => item.location === 'paragraph:3')
    assert.ok(candidate?.context?.some((item: any) => item.location === 'paragraph:2' && item.text.includes('减少基本每股收益')))
    return { ...broken, sections: broken.sections.map(section => ({ ...section, markdown: `${section.markdown} [filing-1@paragraph:2]` })), findings: broken.findings.map(finding => ({ ...finding, evidence: [...finding.evidence, { sourceCandidateId: 'filing-1', location: 'paragraph:2' }] })) }
  }) })
  assert.equal(result.status, 'complete', JSON.stringify(result.diagnostics))
  assert.equal(result.attempts, 2)
})

test('capital allocation prompt separates annual R&D investment from interim R&D expense and narrows executive evidence gaps', async () => {
  const filing = { ...source, content: '研发投入金额（元）：2025年63,441,379,000，2024年54,160,964,000。\n2026年上半年利润表研发费用：23,307,152千元。' }
  const response = { ...output, markdown: '公司披露年度研发投入。[filing-1@paragraph:1]', sections: [{ id: 'management-capital-allocation', markdown: '年度研发投入有披露。[filing-1@paragraph:1]' }], findings: [{ text: '年度研发投入有披露。', kind: 'fact', evidence: [{ sourceCandidateId: 'filing-1', location: 'paragraph:1' }] }] }
  const result = await executeCompanyResearchMethod({ skillId: 'capital_allocation_review', company: { symbol: '002594' }, asOf: '2026-10-17', sources: [filing], durableSourceCandidateIds: ['filing-1'], reasoningExecutor: executor(async (request) => {
    assert.match((request as any).instruction, /不同披露指标、会计范围和期间口径/)
    assert.match((request as any).instruction, /外币融资金额时优先照录官方原始披露币种、数字和单位/)
    assert.match((request as any).instruction, /严禁用“paragraph:8686—paragraph:8689”或任何起止段落范围/)
    assert.match((request as any).instruction, /拆行并购金额（如ESOP对价）必须引用实际包含该金额与单位的续行/)
    assert.match((request as any).instruction, /不得把年度研发投入与半年度研发费用并列成趋势/)
    assert.match((request as any).instruction, /按原表列名和显示单位照录为披露事实/)
    assert.match((request as any).instruction, /禁止手工相减、心算或把原表单元改称百分点/)
    return response
  }) })
  assert.equal(result.status, 'complete', JSON.stringify(result.diagnostics))
})

test('capital allocation binds single acquisition cost rows to the right target using totals and disclosed accounting method', async () => {
  const filing = { ...source, content: [
    '（2）合并成本及商誉',
    '单位：元',
    '合并成本 标的甲 标的乙',
    '--现金 23.87 4,358,975,888.59',
    '--发行或承担的债务的公允价值 509,852,329.73',
    '合并成本合计 509,852,353.60 4,358,975,888.59',
    '合并成本公允价值的确定方法：',
    '标的甲合并成本为购买方支付的名义并购对价以及承担的债务金额之和。',
    '标的乙合并成本为在购买日为取得被购买方控制权而支付及待支付的现金。',
  ].join('\n') }
  const response = { ...output, markdown: '并购成本已按标的核对。[filing-1@paragraph:1]', sections: [{ id: 'management-capital-allocation', markdown: '并购成本已按标的核对。[filing-1@paragraph:1]' }], findings: [{ text: '并购成本已按标的核对。', kind: 'fact' as const, evidence: [{ sourceCandidateId: 'filing-1', location: 'paragraph:1' }] }] }
  const result = await executeCompanyResearchMethod({ skillId: 'capital_allocation_review', company: { symbol: '002384' }, asOf: '2026-10-18', sources: [filing], durableSourceCandidateIds: ['filing-1'], reasoningExecutor: executor(async request => {
    const actual = request as any
    assert.match(actual.instruction, /不得把单一债务\/现金金额复制到另一标的名下/)
    assert.match(actual.instruction, /合计与来源披露的合并成本确定方法/)
    assert.match(actual.instruction, /交叉核对支持唯一归属/)
    const excerpts = actual.input.evidence.flatMap((packet: any) => packet.excerpts.map((excerpt: any) => excerpt.text))
    for (const text of ['合并成本 标的甲 标的乙', '--现金 23.87 4,358,975,888.59', '--发行或承担的债务的公允价值 509,852,329.73', '合并成本合计 509,852,353.60 4,358,975,888.59', '标的甲合并成本为购买方支付的名义并购对价以及承担的债务金额之和。']) assert.ok(excerpts.includes(text), `missing acquisition table context: ${text}`)
    return response
  }) })
  assert.equal(result.status, 'complete', JSON.stringify(result.diagnostics))
})

test('capital allocation numeric retry directs exact paragraph citations and forbids citation ranges', async()=>{
  const filing={...source,content:'公司业务情况，所给段落未披露金额。'}
  const unsupported={...output,answer:'交易金额为123元。',markdown:'交易金额为123元。[filing-1@paragraph:1]',sections:[{id:'management-capital-allocation',markdown:'交易金额为123元。[filing-1@paragraph:1]'}],findings:[{text:'交易金额为123元。',kind:'fact' as const,evidence:[{sourceCandidateId:'filing-1',location:'paragraph:1'}]}]}
  const corrected={...output,answer:'交易金额缺少可核实的披露。',markdown:'交易金额缺少可核实的披露。[filing-1@paragraph:1]',sections:[{id:'management-capital-allocation',markdown:'所供材料未披露可核实的交易金额，无法评价实际现金投入。[filing-1@paragraph:1]'}],findings:[{text:'本次提供的材料未披露交易金额。',kind:'assumption' as const,evidence:[{sourceCandidateId:'filing-1',location:'paragraph:1'}]}]}
  let calls=0
  const result=await executeCompanyResearchMethod({skillId:'capital_allocation_review',company:{symbol:'002384'},asOf:'2026-10-18',sources:[filing],durableSourceCandidateIds:['filing-1'],reasoningExecutor:executor(async request=>{
    calls++
    if(calls===2){
      assert.equal((request as any).input.repairErrors[0].code,'NUMERIC_GROUNDING_ERROR')
      assert.match((request as any).input.repairInstruction,/资本配置数值定向修复/)
      assert.match((request as any).input.repairInstruction,/不得使用paragraph起止范围或长破折号表示定位/)
      assert.match((request as any).input.repairInstruction,/持股\/增发股数段不能代替每股净资产影响的实际金额行/)
      assert.match((request as any).input.repairInstruction,/简化自由现金流等确定性计算只能按preparedAnalysis中同期间、同单位的financial\.simpleFreeCashFlow字段原样报告/)
      assert.match((request as any).input.repairInstruction,/必须完整列出字段的两个操作数、运算符、结果和单位/)
      assert.match((request as any).input.repairInstruction,/字段未提供或口径不匹配时删除计算结果并写明缺口/)
      assert.match((request as any).input.repairInstruction,/多标的并购成本表中，按表头、金额行和各标的合计逐项绑定/)
      assert.match((request as any).input.repairInstruction,/findings须为每项自身带齐同一组逐段引用/)
    }
    return calls===1?unsupported:corrected
  })})
  assert.equal(result.status,'complete',JSON.stringify(result.diagnostics))
  assert.equal(result.attempts,2)
})

test('capital allocation preserves only the exact supplied annual-dividend row citation on a matching finding', async () => {
  const filing = { ...source, content: '2024年度利润分配预案：每10股派发现金红利0.70元（含税）。\n2025年度拟不派发现金红利。' }
  const response = {
    ...output,
    answer: '分红安排随年度变化。',
    markdown: '分红安排随年度变化。',
    sections: [{ id: 'management-capital-allocation', markdown: '| 2024年度方案 | 每10股派发现金红利0.70元（含税）。[filing-1@paragraph:1] |\n| 2025年度拟案 | 不派发现金红利。[filing-1@paragraph:2] |' }],
    findings: [{ text: '2025年度拟不派发现金红利；2024年度预案为每10股派发现金红利0.70元（含税）。', kind: 'fact' as const, evidence: [{ sourceCandidateId: 'filing-1', location: 'paragraph:2' }] }],
  }
  const result = await executeCompanyResearchMethod({ skillId: 'capital_allocation_review', company: { symbol: '002384' }, asOf: '2026-10-18', sources: [filing], durableSourceCandidateIds: ['filing-1'], reasoningExecutor: executor(async () => response) })
  assert.equal(result.status, 'complete', JSON.stringify(result.diagnostics))
  assert.equal(result.attempts, 1)
  assert.deepEqual(result.findings[0]?.evidence, [
    { sourceCandidateId: 'filing-1', location: 'paragraph:2' },
    { sourceCandidateId: 'filing-1', location: 'paragraph:1' },
  ])
  assert.ok(result.citationRepairs?.some(repair => repair.findingIndex === 0 && repair.addedReferences.some(ref => ref.location === 'paragraph:1')))

  const unsupported = { ...filing, content: '2024年度利润分配预案每10股派发现金红利0.70元（含税）。\n无关交易金额为0.70元。' }
  const wrongContextResponse = { ...response, sections: [{ id: 'management-capital-allocation', markdown: '| 2024年度方案 | 每10股派发现金红利0.70元（含税）。[filing-1@paragraph:2] |' }] }
  const rejected = await executeCompanyResearchMethod({ skillId: 'capital_allocation_review', company: { symbol: '002384' }, asOf: '2026-10-18', sources: [unsupported], durableSourceCandidateIds: ['filing-1'], reasoningExecutor: executor(async () => wrongContextResponse) })
  assert.equal(rejected.status, 'failed')
  assert.equal(rejected.diagnostics.at(-1)?.code, 'NUMERIC_GROUNDING_ERROR')
  assert.equal(rejected.citationRepairs?.some(repair => repair.addedReferences.some(ref => ref.location === 'paragraph:2')), false)
})

test('governance prompt preserves disclosed roles and scopes missing details to specific new executives', async () => {
  const filing = { ...source, content: '董事长兼总裁负责公司一般营运及制定业务策略。\n两名新任副总裁的具体职责尚未列明。' }
  const response = { ...output, markdown: '董事长兼总裁的职责已有披露。[filing-1@paragraph:1]', sections: [{ id: 'management-capital-allocation', markdown: '董事长兼总裁负责一般营运及制定业务策略。[filing-1@paragraph:1]' }], findings: [{ text: '董事长兼总裁职责已有披露。', kind: 'fact', evidence: [{ sourceCandidateId: 'filing-1', location: 'paragraph:1' }] }] }
  const result = await executeCompanyResearchMethod({ skillId: 'management_governance_analysis', company: { symbol: '002594' }, asOf: '2026-10-17', sources: [filing], durableSourceCandidateIds: ['filing-1'], reasoningExecutor: executor(async (request) => {
    assert.match((request as any).instruction, /不得笼统称“管理层完整分工\/职责缺失”/)
    assert.match((request as any).instruction, /具体人员或事项/)
    assert.match((request as any).instruction, /股东持股比例.*含数字的同一句句末紧邻引用/)
    assert.match((request as any).instruction, /持有人名称行及对应比例数据行/)
    return response
  }) })
  assert.equal(result.status, 'complete', JSON.stringify(result.diagnostics))
})


test('technical identifier citations are deterministically repaired from the exact supplied technology paragraph', async()=>{
  const filing={...source,content:'公司产品业务发展情况。\n财务收入增长5%。\n核心技术支持5G及物联网产品。'}
  const base={...output,markdown:'公司形成产品能力。[filing-1@paragraph:1]',findings:[{text:'公司形成产品能力。',kind:'fact',evidence:[{sourceCandidateId:'filing-1',location:'paragraph:1'}]}],sections:['products','technologies'].map(id=>({id,markdown:'产品支持5G及物联网。[filing-1@paragraph:1]'}))}
  let calls=0
  const result=await executeCompanyResearchMethod({skillId:'product_technology_analysis',company:{symbol:'002594'},asOf:'2026-10-14',sources:[filing],durableSourceCandidateIds:['filing-1'],reasoningExecutor:executor(async()=>{calls++;return base})})
  assert.equal(result.status,'complete',JSON.stringify(result.diagnostics))
  assert.equal(result.attempts,1)
  assert.equal(calls,1)
  assert.ok(result.sections.every(section=>section.markdown.includes('[filing-1@paragraph:3]')))
  assert.ok(result.citationRepairs?.some(repair=>repair.addedReferences.some(ref=>ref.location==='paragraph:3')))
})

test('competitive method reserves eligible peer-company web pages in its evidence packet', async()=>{
  const peer:NormalizedResearchSource={
    candidate:{candidateId:'public-web-geely-galaxy',kind:'web_article',tier:3,title:'吉利银河官方车型页',provider:'public-web',metadata:{companySymbol:'002594',researchSubject:'peer_company',peerCompanyName:'吉利'}},
    retrievedAt:'2026-10-17',title:'吉利银河官方车型页',publisher:'Geely',canonicalUrl:'https://example.test/geely',contentHash:'peer',
    content:'吉利银河车型介绍\n银河E5为纯电动SUV。',rights:{accessScope:'public',retentionAllowed:true,aiProcessingAllowed:true,derivativeKnowledgeAllowed:true,redistributionAllowed:false},
  }
  const result=await executeCompanyResearchMethod({skillId:'competitive_market_map',company:{symbol:'002594'},asOf:'2026-10-17',sources:[peer],reportSourceCandidateIds:[peer.candidate.candidateId],reasoningExecutor:executor(async request=>{
    const packets=(request as any).input.evidence as {sourceCandidateId:string;excerpts:{location:string;text:string}[]}[]
    const packet=packets.find(item=>item.sourceCandidateId==='public-web-geely-galaxy')
    assert.ok(packet,'eligible peer-company source must be reserved for competition research')
    const excerpt=packet.excerpts.find(item=>item.text.includes('银河E5'))!
    const ref=`[${packet.sourceCandidateId}@${excerpt.location}]`
    const owned=(request as any).input.ownedSectionIds as string[]
    return {status:'complete',answer:'识别到一个候选车型。',markdown:`候选车型分析。 ${ref}`,sections:owned.map(id=>({id,markdown:`银河E5是待验证候选产品。 ${ref}`})),findings:[{text:'吉利官网列示银河E5车型。',kind:'fact',evidence:[{sourceCandidateId:packet.sourceCandidateId,location:excerpt.location}]}],limitations:[],risks:[]}
  })})
  assert.equal(result.status,'complete',JSON.stringify(result.diagnostics))
  assert.ok(result.sourceCandidateIds.includes('public-web-geely-galaxy'))
})


test('method retry receives actual Pi-rejected raw draft separately from returned validated-shape output',async()=>{
  let calls=0
  const valid=JSON.parse(JSON.stringify(output).replaceAll('paragraph:251','paragraph:1'))
  const filing={...source,content:'公司成立历史与战略转型。'}
  const rejected=JSON.stringify({...valid,x:'untrusted extra field'})
  const pi=new PiReasoningExecutor({completion:async(_model,context)=>{
    if(++calls===1)return rejected
    const content=context.messages[0]!.content
    assert.equal(typeof content,'string')
    const actual=JSON.parse(content as string).input
    assert.equal(actual.repairRejectedRawOutput,rejected)
    assert.equal('repairPreviousOutput' in actual,false)
    assert.match(actual.repairInstruction,/自身不证明任何事实或引用/)
    assert.match(actual.repairInstruction,/重新构造完整合同/)
    assert.match(actual.repairInstruction,/经实际evidence核对且能通过全部校验/)
    return JSON.stringify(valid)
  }})
  const result=await executeCompanyResearchMethod({skillId:'company_history_strategy',company:{symbol:'002594'},asOf:'2026-10-14',sources:[filing],durableSourceCandidateIds:['filing-1'],reasoningExecutor:pi})
  assert.equal(result.status,'complete',JSON.stringify(result.diagnostics))
  assert.equal(result.attempts,2)
  assert.equal(result.diagnostics[0]!.code,'FORMAT_ERROR')
  assert.equal(result.attemptOutputs![0]!.rejectedRawOutput,rejected)
  assert.equal('output' in result.attemptOutputs![0]!,false)
  assert.deepEqual(result.attemptOutputs![1]!.output,valid)
  assert.equal('rejectedRawOutput' in result.attemptOutputs![1]!,false)
})


test('Pi structural contract lets the adapter diagnose a wrong source-location pair and repair it on the second call',async()=>{
  const filing={...source,content:'公司成立历史与战略。'}
  const website={...source,candidate:{...source.candidate,candidateId:'website-1'},content:[...Array(195).fill('背景资料。'),'公司成立历史与战略演变。'].join('\n')}
  const wrong=JSON.parse(JSON.stringify(output).replaceAll('paragraph:251','paragraph:196'))
  const correct=JSON.parse(JSON.stringify(wrong).replaceAll('filing-1','website-1'))
  let calls=0
  const pi=new PiReasoningExecutor({completion:async(_model,context)=>{
    if(++calls===1)return JSON.stringify(wrong)
    const input=JSON.parse(context.messages[0]!.content as string).input
    assert.equal(input.repairErrors[0].code,'REFERENCE_ERROR')
    assert.match(input.repairErrors[0].message,/filing-1@paragraph:196/)
    assert.deepEqual(input.repairPreviousOutput,wrong)
    assert.equal('repairRejectedRawOutput' in input,false)
    assert.ok(input.evidence.some((packet:any)=>packet.sourceCandidateId==='website-1' && packet.excerpts.some((row:any)=>row.location==='paragraph:196')))
    return JSON.stringify(correct)
  }})
  const result=await executeCompanyResearchMethod({skillId:'company_history_strategy',company:{symbol:'002594'},asOf:'2026-10-14',sources:[filing,website],durableSourceCandidateIds:['filing-1','website-1'],reasoningExecutor:pi})
  assert.equal(result.status,'complete',JSON.stringify(result.diagnostics))
  assert.equal(result.attempts,2)
  assert.equal(result.diagnostics[0]!.code,'REFERENCE_ERROR')
})

test('a structurally valid partial product draft reaches adapter coverage diagnostics and a bounded complete retry',async()=>{
  const filing={...source,content:'产品技术业务情况。'}
  const valid={...JSON.parse(JSON.stringify(output).replaceAll('paragraph:251','paragraph:1')),sections:['products','technologies'].map(id=>({id,markdown:'产品技术业务有证据。[filing-1@paragraph:1]'}))}
  const partial={...valid,sections:valid.sections.slice(0,1)}
  let calls=0
  const pi=new PiReasoningExecutor({completion:async(_model,context)=>{
    if(++calls===1)return JSON.stringify(partial)
    const input=JSON.parse(context.messages[0]!.content as string).input
    assert.match(context.messages[0]!.content as string,/technologies专门分析技术架构和路线/)
    assert.equal(input.repairErrors[0].code,'FORMAT_ERROR')
    assert.match(input.repairErrors[0].message,/missing=\["technologies"\]/)
    assert.deepEqual(input.repairPreviousOutput,partial)
    assert.equal('repairRejectedRawOutput' in input,false)
    assert.match(input.repairInstruction,/补齐ownedSectionIds中列出的每个缺失章节/)
    assert.match(input.repairInstruction,/缺失章节定向修复/)
    assert.match(input.repairInstruction,/technologies专门分析已披露技术\/产品架构/)
    assert.deepEqual(input.ownedSectionIds,['products','technologies'])
    assert.equal('anyOf' in input.outputExample.findings[0].evidence[0],false)
    return JSON.stringify(valid)
  }})
  const result=await executeCompanyResearchMethod({skillId:'product_technology_analysis',company:{symbol:'002594'},asOf:'2026-10-14',sources:[filing],durableSourceCandidateIds:['filing-1'],reasoningExecutor:pi})
  assert.equal(result.status,'complete',JSON.stringify(result.diagnostics))
  assert.equal(result.attempts,2)
})

test('a missing product-method owned section after the bounded retry remains failed',async()=>{
  const filing={...source,content:'产品技术业务情况。'}
  const partial={...JSON.parse(JSON.stringify(output).replaceAll('paragraph:251','paragraph:1')),sections:[{id:'products',markdown:'产品组合有证据。[filing-1@paragraph:1]'}]}
  let calls=0
  const result=await executeCompanyResearchMethod({skillId:'product_technology_analysis',company:{symbol:'002594'},asOf:'2026-10-14',sources:[filing],durableSourceCandidateIds:['filing-1'],reasoningExecutor:executor(async request=>{
    calls++
    if(calls===2)assert.match((request as any).input.repairInstruction,/缺失章节定向修复/)
    return partial
  })})
  assert.equal(calls,2)
  assert.equal(result.status,'failed')
  assert.equal(result.attempts,2)
  assert.ok(result.diagnostics.some(diagnostic=>diagnostic.message.includes('missing=["technologies"]')))
})
