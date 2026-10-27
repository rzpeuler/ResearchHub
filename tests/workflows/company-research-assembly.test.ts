import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { assembleCompanyResearch, bindExact2025BydProductMarginSynthesisCitations, buildSynthesisEvidenceLedger, normalizeCompanyRevenueCostSpreadWording, normalizeCompanySynthesisCitations, repairCompanyFinalSynthesisTable, repairCompanyResearchMarkdownTables, validateCompanyResearchMarkdownTables } from '../../workflows/company-deep-research/assembly.ts'
import { mergeExcessTrailingMarkdownTableCells } from '../../skills/company-research/markdown-tables.ts'
import type { CompanyResearchMethodResult } from '../../skills/company-research/methods.ts'
import type { ReasoningExecutor } from '../../plugins/reasoning/contracts.ts'

const method: CompanyResearchMethodResult = { skillId: 'company_history_strategy', status: 'complete', answer: '历史披露支持分析', markdown: '历史披露 [annual@paragraph:1]', sections: [{ id: 'company-overview', markdown: '历史披露 [annual@paragraph:1]' }], findings: [{ text: '公司披露历史', kind: 'fact', evidence: [{ sourceCandidateId: 'annual', location: 'paragraph:1' }] }], limitations: [], risks: [], sourceCandidateIds: ['annual'], diagnostics: [], attempts: 1, executionEvidence: [{ sourceCandidateId: 'annual', title: '年报', publisher: '公司', excerpts: [{ sourceCandidateId: 'annual', location: 'paragraph:1', text: '历史披露' }] }] }
const input = { company: { symbol: '002594', name: '比亚迪', exchange: 'SZ' }, asOf: '2026-10-14T00:00:00Z', sources: [{ candidate: { candidateId: 'annual' }, title: '年报', content: '历史披露' } as any], reportSourceCandidateIds: ['annual'], durableSourceCandidateIds: ['annual'] }
const ids = ['investment-thesis', 'monitoring-checklist']

test('synthesis evidence ledger retains only complete findings bound to exact supplied source rows', () => {
  const body = '历史披露原文。'
  const source = {
    candidate: { candidateId: 'annual', publishedAt: '2026-03-28', metadata: { dataProvenance: { pointInTimeStatus: 'within_cutoff', pointInTimeSafe: true } } },
    content: body,
    contentHash: 'source-hash',
  } as any
  const backed: CompanyResearchMethodResult = {
    ...method,
    executionEvidence: [{ sourceCandidateId: 'annual', title: '年报', publisher: '公司', excerpts: [{ sourceCandidateId: 'annual', location: 'paragraph:1', text: body }] }],
  }
  const unbacked: CompanyResearchMethodResult = { ...method, status: 'failed' }
  const ledger = buildSynthesisEvidenceLedger({ methods: [backed, unbacked], sources: [source] })
  assert.equal(ledger.length, 1)
  assert.equal(ledger[0]?.ownerSkill, 'company_history_strategy')
  assert.equal(ledger[0]?.kind, 'fact')
  assert.deepEqual(ledger[0]?.sectionIds, ['company-overview'])
  assert.deepEqual(ledger[0]?.evidence[0], {
    sourceCandidateId: 'annual', contentHash: 'source-hash', location: 'paragraph:1', excerpt: body,
    publishedAt: '2026-03-28', pointInTimeStatus: 'within_cutoff', pointInTimeSafe: true,
  })
  assert.deepEqual(buildSynthesisEvidenceLedger({ methods: [backed], sources: [source], conflictedSourceCandidateIds: ['annual'] }), [])
  assert.deepEqual(buildSynthesisEvidenceLedger({ methods: [backed], sources: [{ ...source, content: 'changed source' }] }), [])
  assert.deepEqual(buildSynthesisEvidenceLedger({ methods: [backed], sources: [source], allowedSourceCandidateIds: ['other'] }), [])
})

test('synthesis citation handoff rejects findings without exact eligible method-supplied source rows', async () => {
  const source = { candidate: { candidateId: 'annual' }, title: '年报', content: '历史披露' } as any
  const cases: { name: string; method: CompanyResearchMethodResult; reportIds?: string[]; conflicts?: string[] }[] = [
    { name: 'finding-only locator', method: { ...method, executionEvidence: undefined } },
    { name: 'mismatched supplied excerpt', method: { ...method, executionEvidence: [{ sourceCandidateId: 'annual', title: '年报', publisher: '公司', excerpts: [{ sourceCandidateId: 'annual', location: 'paragraph:1', text: '错配正文' }] }] } },
    { name: 'source not eligible for the report', method, reportIds: ['other'] },
    { name: 'conflicted source', method, conflicts: ['annual'] },
  ]
  for (const item of cases) {
    const requests: { allowedCitations: string[]; allowedEvidence: unknown[] }[] = []
    const executor: ReasoningExecutor = { capabilities, execute: async request => {
      const payload = request.input as { allowedCitations: string[]; allowedEvidence: unknown[] }
      requests.push(payload)
      return { operation: request.operation, output: { sections: ids.map(id => ({ id, markdown: `结论 [annual@paragraph:1]`, sourceCandidateIds: ['annual'] })) } }
    } }
    const result = await assembleCompanyResearch(
      { ...input, sources: [source], ...(item.reportIds ? { reportSourceCandidateIds: item.reportIds } : {}) },
      [item.method], executor, () => input.asOf, 1, { conflictedSourceCandidateIds: item.conflicts },
    )
    assert.equal(requests.length, 1, item.name)
    assert.deepEqual(requests[0]?.allowedCitations, [], item.name)
    assert.deepEqual(requests[0]?.allowedEvidence, [], item.name)
    assert.equal(result.synthesisMode, 'deterministic_fallback', item.name)
    assert.match(result.synthesisDiagnostics[0] ?? '', /REFERENCE_ERROR/, item.name)
  }
})

test('final synthesis keeps all 19 stable report section ids while requesting only its two synthesis sections', async () => {
  let requestPayload: { instruction: string; input: { requiredSectionIds: string[] }; outputContract: { properties: { sections: { minItems: number; maxItems: number; items: { properties: { markdown: { maxLength: number } } } } } } } | undefined
  const executor: ReasoningExecutor = { capabilities, execute: async request => {
    requestPayload = request as typeof requestPayload
    return { operation: request.operation, output: { sections: ids.map(id => ({ id, markdown: `有证据支持的结论 [annual@paragraph:1]`, sourceCandidateIds: ['annual'] })) } }
  } }
  const result = await assembleCompanyResearch(input, [method], executor, () => input.asOf)
  assert.equal(result.synthesisMode, 'reasoning_executor', JSON.stringify(result.synthesisDiagnostics))
  assert.deepEqual(requestPayload?.input.requiredSectionIds, ids)
  assert.equal(requestPayload?.outputContract.properties.sections.minItems, 2)
  assert.equal(requestPayload?.outputContract.properties.sections.maxItems, 2)
  assert.equal(requestPayload?.outputContract.properties.sections.items.properties.markdown.maxLength, 5000)
  assert.match(requestPayload?.instruction ?? '', /最多8项/)
  assert.match(requestPayload?.instruction ?? '', /不在这两节抄录数字/)
  assert.doesNotMatch(requestPayload?.instruction ?? '', /吉利银河|银河E8/)
  assert.equal(result.sections.length, 19)
  assert.deepEqual(result.sections.map(section => section.id), [
    'company-overview', 'business-model', 'business-segments', 'revenue-profit-drivers', 'products', 'technologies', 'industry-exposure', 'supply-chain', 'competition', 'financial-quality', 'growth-drivers', 'management-capital-allocation', 'catalysts', 'risks', 'valuation', 'bull-base-bear', 'variant-perception', 'investment-thesis', 'monitoring-checklist',
  ])
  for (const id of ['valuation', 'bull-base-bear', 'variant-perception']) {
    assert.match(result.sections.find(section => section.id === id)?.markdown ?? '', /^研究缺口：/)
  }
})

test('assembly preserves substantive supplied valuation, scenario, and variant sections', async () => {
  const suppliedSections = [
    { id: 'valuation', markdown: '基于同一基准日和已核验盈利基础，估值区间为可复算结果。[annual@paragraph:1]' },
    { id: 'bull-base-bear', markdown: 'Bull、Base、Bear 情景均明确假设、概率和对应结果。[annual@paragraph:1]' },
    { id: 'variant-perception', markdown: '公司指引与可比市场预期采用同一期间和指标后仍存在差异。[annual@paragraph:1]' },
  ]
  const suppliedMethod = { ...method, sections: [...method.sections, ...suppliedSections] }
  const result = await assembleCompanyResearch(input, [suppliedMethod], undefined, () => input.asOf)
  assert.equal(result.sections.length, 19)
  for (const supplied of suppliedSections) {
    const section = result.sections.find(item => item.id === supplied.id)
    assert.ok(section, supplied.id)
    assert.equal(section.markdown, supplied.markdown, supplied.id)
    assert.deepEqual(section.sourceCandidateIds, ['annual'], supplied.id)
  }
})

test('assembly accepts the complete workflow-owned quantitative section set directly', async () => {
  const suppliedSections = [
    { id: 'valuation', title: 'Valuation', markdown: '参考 PE 由可核验收盘价与年报 EPS 复算。[annual@paragraph:1]', sourceCandidateIds: ['annual'] },
    { id: 'bull-base-bear', title: 'Bull / Base / Bear', markdown: 'Bear、Base、Bull 使用同一 FY 和估值基础计算。[annual@paragraph:1]', sourceCandidateIds: ['annual'] },
    { id: 'variant-perception', title: 'Variant Perception', markdown: '预期差缺少第二个同口径预期面，保留研究缺口。', sourceCandidateIds: [] },
  ]
  const result = await assembleCompanyResearch(input, [method], undefined, () => input.asOf, 0, {}, suppliedSections)
  for (const supplied of suppliedSections) {
    const section = result.sections.find(item => item.id === supplied.id)
    assert.equal(section?.markdown, supplied.markdown)
    assert.deepEqual(section?.sourceCandidateIds, supplied.sourceCandidateIds)
  }
  await assert.rejects(assembleCompanyResearch(input, [method], undefined, () => input.asOf, 0, {}, suppliedSections.slice(0, 2)), /Invalid workflow-owned/)
})
const capabilities = () => ({ maxContextTokens: 100000, maxOutputTokens: 16000, structuredOutputSupport: true, maxConcurrency: 1 })

test('Chinese presentation brackets normalize to exact square-bracket source locators', () => {
  assert.equal(normalizeCompanySynthesisCitations('事实〔annual@paragraph:1〕与另一项【half@paragraph:2】'), '事实[annual@paragraph:1]与另一项[half@paragraph:2]')
})

test('exact paragraph locators in prose parentheses normalize without changing their references', () => {
  assert.equal(normalizeCompanySynthesisCitations('证据（annual@paragraph:1）及多项（annual@paragraph:1；half@paragraph:2）'), '证据（[annual@paragraph:1]）及多项（[annual@paragraph:1]；[half@paragraph:2]）')
})

test('revenue-cost growth wording removes only a cited, arithmetically matching positive duplicate spread', () => {
  for (const [revenue, cost, spread] of [['8.67', '8.83', '0.16'], ['3.30', '4.25', '0.95'], ['30.61', '38.36', '7.75']]) {
    const source = `成本增速高于收入${spread}个百分点（${revenue}%−${cost}%＝−${spread}个百分点）[annual@paragraph:8]。`
    assert.equal(normalizeCompanyRevenueCostSpreadWording(source), `成本增速高于收入（${revenue}%−${cost}%＝−${spread}个百分点）[annual@paragraph:8]。`)
  }
  const mismatch = '成本增速高于收入0.16个百分点（8.67%−8.83%＝−0.95个百分点）[annual@paragraph:8]。'
  const reversed = '成本增速高于收入0.16个百分点（8.83%−8.67%＝−0.16个百分点）[annual@paragraph:8]。'
  const uncited = '成本增速高于收入0.16个百分点（8.67%−8.83%＝−0.16个百分点）。'
  const unrelated = '成本增速高于收入0.16个百分点；收入增速为8.67%，成本增速为8.83%（8.67%−8.83%＝−0.16个百分点）[annual@paragraph:8]。'
  for (const value of [mismatch, reversed, uncited, unrelated]) assert.equal(normalizeCompanyRevenueCostSpreadWording(value), value)
})

test('Markdown table validation rejects extra cells and embedded heading rows', () => {
  assert.deepEqual(validateCompanyResearchMarkdownTables('| 指标 | 判断 |\n| --- | --- |\n| 客户集中 | 需持续跟踪 |'), [])
  assert.match(validateCompanyResearchMarkdownTables('| 指标 | 判断 |\n| --- | --- |\n| 客户集中 | 需持续跟踪 | 意外内容 |')[0]!, /row at line 3 has 3 cells; expected 2/)
  assert.match(validateCompanyResearchMarkdownTables('| 指标 | 判断 |\n| --- | --- |\n| ## 竞争风险 | 需持续跟踪 |')[0]!, /heading markup embedded/)
  assert.match(validateCompanyResearchMarkdownTables('| 指标 | ## 判断 |\n| --- | --- |\n| 客户集中 | 需持续跟踪 |')[0]!, /heading markup embedded in table header/)
})

test('table repair reattaches a standalone header across prose only when all following rows match its width', () => {
  const source = [
    '| 产品 | 收入 | 占比 |',
    '|---|---:|---:|',
    '| 电路产品 | 100 | 60% |',
    '| 2025年度地区（金额单位：元） | 营业收入 | 占营业收入比重 |',
    '',
    '地区分类与产品分类不同，不能据此推断产品出口比例。',
    '|---|---:|---:|',
    '| 内销 | 40 | 40% |',
    '| 外销 | 60 | 60% |',
  ].join('\n')
  const repaired = repairCompanyResearchMarkdownTables(source)
  assert.match(repaired.markdown, /地区分类与产品分类不同，不能据此推断产品出口比例。\n\| 2025年度地区（金额单位：元） \| 营业收入 \| 占营业收入比重 \|\n\|---\|---:\|---:\|/)
  assert.deepEqual(validateCompanyResearchMarkdownTables(repaired.markdown), [])
  assert.ok(repaired.repairs.some(repair => repair.startsWith('TABLE_HEADER_REATTACHED_AFTER_INTERVENING_PROSE')))

  const unsupported = source.replace('| 外销 | 60 | 60% |', '| 外销 | 60 | 60% | extra |')
  const unsupportedRepair = repairCompanyResearchMarkdownTables(unsupported)
  assert.ok(!unsupportedRepair.repairs.some(repair => repair.startsWith('TABLE_HEADER_REATTACHED_AFTER_INTERVENING_PROSE')))
  assert.ok(!unsupportedRepair.markdown.includes('产品出口比例。\n| 2025年度地区（金额单位：元） | 营业收入 | 占营业收入比重 |\n|---'))
})

test('final synthesis repairs only a cited missing monitoring cell and a trailing orphan pipe',()=>{
  const source='| 指标/观察项 | 观察频率 | 触发条件/核验信号 | 论点关联与证据 |\n|---|---|---|---|\n| 分行业收入 | 定期报告 | 收入同比变化。[official@paragraph:716] |\n| 毛利率 | 半年报 | 继续观察。[official@paragraph:717] |已证实信号。|\n|'
  const fixed=repairCompanyFinalSynthesisTable('monitoring-checklist',source)
  assert.equal(fixed.repairs.length,2)
  assert.match(fixed.markdown,/继续观察。\[official@paragraph:717\] \|已证实信号。\|/)
  assert.equal(fixed.markdown.split('\n').some(line=>line.trim()==='|'),false)
  assert.deepEqual(validateCompanyResearchMarkdownTables(fixed.markdown),[])
  assert.equal(repairCompanyFinalSynthesisTable('investment-thesis',source).markdown,source)
  const uncited='| 指标/观察项 | 观察频率 | 触发条件/核验信号 | 论点关联与证据 |\n|---|---|---|---|\n| 项目 | 定期 | 观察信号 |'
  assert.equal(repairCompanyFinalSynthesisTable('monitoring-checklist',uncited).markdown,uncited)
})

test('final synthesis merges only the split evidence and thesis cells in a five-cell monitoring row',()=>{
  const source='| 指标/观察项 | 观察频率 | 触发条件/核验信号 | 论点关联与证据 |\n|---|---|---|---|\n| 半年累计收入与利润 | 每期定期报告 | 收入或利润继续下滑时复核 | 收入同比-7.1%。[financial@paragraph:1] | 盈利修复是核心论点必要条件。 |'
  const fixed=repairCompanyFinalSynthesisTable('monitoring-checklist',source)
  assert.deepEqual(fixed.repairs,['MONITORING_EVIDENCE_AND_THESIS_CELLS_MERGED: line 3'])
  assert.match(fixed.markdown,/收入同比-7\.1%。\[financial@paragraph:1\]；盈利修复是核心论点必要条件。 \|/)
  assert.deepEqual(validateCompanyResearchMarkdownTables(fixed.markdown),[])
  const uncited='| 指标/观察项 | 观察频率 | 触发条件/核验信号 | 论点关联与证据 |\n|---|---|---|---|\n| 项目 | 每期 | 复核 | 无引用的说明 | 无引用结论 |'
  assert.equal(repairCompanyFinalSynthesisTable('monitoring-checklist',uncited).markdown,uncited)
  const tooMany='| 指标/观察项 | 观察频率 | 触发条件/核验信号 | 论点关联与证据 |\n|---|---|---|---|\n| 项目 | 每期 | 复核 | 证据。[financial@paragraph:1] | 额外列一 | 额外列二 |'
  assert.equal(repairCompanyFinalSynthesisTable('monitoring-checklist',tooMany).markdown,tooMany)
  const unrelatedExtra='| 指标/观察项 | 观察频率 | 触发条件/核验信号 | 论点关联与证据 |\n|---|---|---|---|\n| 项目 | 每期 | 复核 | 证据。[financial@paragraph:1] | 红色 |'
  assert.equal(repairCompanyFinalSynthesisTable('monitoring-checklist',unrelatedExtra).markdown,unrelatedExtra)
})

test('final synthesis removes an exact output sentinel attached to a monitoring table row',()=>{
  const source='| 指标/观察项 | 观察频率 | 触发条件/核验信号 | 论点关联与证据 |\n|---|---|---|---|\n| 员工持股 | 定期报告 | 核验计划执行。[official@paragraph:1159] | 检验激励安排的实施情况 |<\/markdown>'
  const fixed=repairCompanyFinalSynthesisTable('monitoring-checklist',source)
  assert.deepEqual(fixed.repairs,['MONITORING_OUTPUT_SENTINEL_REMOVED: line 3'])
  assert.ok(fixed.markdown.endsWith('|'))
  assert.deepEqual(validateCompanyResearchMarkdownTables(fixed.markdown),[])
  assert.equal(repairCompanyFinalSynthesisTable('investment-thesis',source).markdown,source)
})

test('table repair removes one empty customer-table header and detaches a trailing prose paragraph', () => {
  const malformed = [
    '### 供应链、客户依赖与规模约束',
    '| 供应商口径 | 披露值 |',
    '|---|---:|',
    '| 前五名合计采购金额 | 5,737,450,383.42元[annual@paragraph:978] |',
    '| 第一名占年度采购总额 | 5.58%[annual@paragraph:983] |',
    '',
    '| | 客户口径 | 披露值 |',
    '|---|---:|',
    '| 前五名客户占年度销售额 | 64.33%[annual@paragraph:965] |',
    '| 第一名占年度销售额 | 46.46%[annual@paragraph:969] | **供应链与价值形成。** 客户集中会影响订单和收入；客户身份、产品映射及切换成本未披露。[annual@paragraph:1321]',
  ].join('\n')
  const repaired = repairCompanyResearchMarkdownTables(malformed)
  assert.deepEqual(repaired.diagnostics, [])
  assert.ok(repaired.repairs.some(item => item.startsWith('TABLE_EMPTY_LEADING_HEADER_CELL_REMOVED')))
  assert.ok(repaired.repairs.some(item => item.startsWith('TABLE_TRAILING_NARRATIVE_MOVED')))
  assert.deepEqual(validateCompanyResearchMarkdownTables(repaired.markdown), [])
  assert.match(repaired.markdown, /\| 客户口径 \| 披露值 \|\n\|---\|---:\|/)
  assert.match(repaired.markdown, /\| 第一名占年度销售额 \| 46\.46%\[annual@paragraph:969\] \|\n\n\*\*供应链与价值形成。\*\*/)
  assert.match(repaired.markdown, /客户身份、产品映射及切换成本未披露。\[annual@paragraph:1321\]/)
})

test('capital-allocation table shape repair joins one excess trailing cell without dropping evidence', () => {
  const malformed='| 配置事项 | 规模与期间 | 目的与结果 | 评价及限制 |\n|---|---|---|---|\n| 研发投入 | 2025年投入人民币金额。[annual@paragraph:1526] | 公司披露研发方向。[annual@paragraph:606] | 原表变动比例13.02%。[annual@paragraph:1527] | 投资回报仍待验证。'
  const repaired=mergeExcessTrailingMarkdownTableCells(malformed)
  assert.deepEqual(validateCompanyResearchMarkdownTables(repaired),[])
  assert.match(repaired,/原表变动比例13\.02%[^\n]*；投资回报仍待验证/)
  assert.match(repaired,/\[annual@paragraph:1526\]/)
  assert.match(repaired,/\[annual@paragraph:606\]/)
  const missing='| 配置事项 | 规模与期间 | 目的与结果 | 评价及限制 |\n|---|---|---|---|\n| 研发投入 | 2025年投入 | 公司披露方向 |'
  assert.ok(validateCompanyResearchMarkdownTables(mergeExcessTrailingMarkdownTableCells(missing)).length>0,'missing cells remain blocked')
  const multiple='| 配置事项 | 规模与期间 | 目的与结果 | 评价及限制 |\n|---|---|---|---|\n| 研发投入 | 2025年投入 | 公司披露方向 | 评价 | 限制 | 额外单元格 |'
  assert.ok(validateCompanyResearchMarkdownTables(mergeExcessTrailingMarkdownTableCells(multiple)).length>0,'multiple excess cells remain blocked')
})

test('industry table repair separates exact repeated header fused after cited narrative', () => {
  const repeated = '| 期间与分类（分行业） | 营业收入（元） | 营业成本（元） | 毛利率 | 营业收入比上年同期增减 | 营业成本比上年同期增减 | 毛利率比上年同期增减 |'
  const malformed = [
    '| 市场边界 | 期间 | 规模 | 来源及适用性 |',
    '|---|---|---:|---|',
    `| 全球液冷市场 | 2025年 | 28.4亿美元 | 年报转述。[annual@paragraph:450] | | 上述行业预测与历史销量定义不同，不能据此推断公司份额。[annual@paragraph:448] ${repeated}`,
    '|---|---:|---:|---:|---:|---:|---:|',
    '| 2025年：电子器件 | 155 | 145 | 6.29% | -2.74% | -0.56% | -2.06% [annual@paragraph:842] |',
    `| 2025年：汽车相关 | 648 | 515 | 20.49% | 5.06% | 7.53% | -1.82% [annual@paragraph:844] | | ${repeated.slice(2)}`,
    '|---|---:|---:|---:|---:|---:|---:|',
    '| 2026年上半年：电子器件 | 69 | 65 | 5.04% | 0.96% | 3.88% | -2.67% [interim@paragraph:728] |',
    '| 2026年上半年：汽车相关 | 275 | 213 | 22.33% | -8.98% | -11.24% | 1.98% [interim@paragraph:729] |',
  ].join('\n')
  const repaired = mergeExcessTrailingMarkdownTableCells(malformed)
  assert.deepEqual(validateCompanyResearchMarkdownTables(repaired), [])
  assert.match(repaired, /\[annual@paragraph:450\] \|\n上述行业预测与历史销量定义不同，不能据此推断公司份额。\[annual@paragraph:448\]\n\| 期间与分类（分行业） \|/)
  assert.match(repaired, /\[annual@paragraph:844\] \|\n\n\| 期间与分类（分行业） \|/)
  assert.equal(repaired.split(repeated).length - 1, 2, 'both distinct tables retain their complete headers')
  const ambiguous = malformed.replace('上述行业预测与历史销量定义不同，不能据此推断公司份额。', '另一张表需要进一步核对。')
  assert.ok(validateCompanyResearchMarkdownTables(mergeExcessTrailingMarkdownTableCells(ambiguous)).length > 0)
})

test('R175 Markdown table validation rejects an empty table shell without inventing rows', () => {
  const header = '| 期间及口径 | 营业收入（人民币亿元） | 营业成本（人民币亿元） | 毛利率 | 变化说明 |'
  const separator = '|---|---:|---:|---:|---|'
  for (const suffix of ['', '\n\n后续为其他研究论点。', '\n| | | | | |']) {
    const shell = `${header}\n${separator}${suffix}`
    assert.ok(validateCompanyResearchMarkdownTables(shell).some(issue => issue.includes('has no data rows')))
    const repaired = repairCompanyResearchMarkdownTables(shell)
    assert.equal(repaired.markdown, shell, 'missing table data cannot be inferred from column headings')
    assert.ok(validateCompanyResearchMarkdownTables(repaired.markdown).some(issue => issue.includes('has no data rows')))
  }
  assert.deepEqual(validateCompanyResearchMarkdownTables(`${header}\n${separator}\n| 2026年上半年累计 | 已披露 | 已披露 | 需复算 | [annual@paragraph:10] |`), [])
})

test('R175 table normalization preserves a financial row when product-growth narrative is fused after it', () => {
  const fixture = [
    '### 收入、利润与成本链路 合并收入承压。[financial@paragraph:1] | 期间及口径 | 营业收入（人民币亿元） | 营业成本（人民币亿元） | 毛利率 | 变化说明 |',
    '|---|---:|---:|---:|---|',
    '| 2026年上半年累计；结构化财务摘要 | 3,448.15 | 2,798.27 | 18.85% | 毛利率同比增加0.84个百分点（按同一毛利率水平计算） [financial@paragraph:1] | 2026年半年度报告的分产品表显示，电子及其他产品收入同比增长0.96%，成本同比增长3.88%，毛利率比上年同期增减为-2.67%； [half@paragraph:732]变化率沿用原表百分比标示，不能解释为百分点。',
  ].join('\n')
  const repaired = repairCompanyResearchMarkdownTables(fixture)
  assert.deepEqual(validateCompanyResearchMarkdownTables(repaired.markdown), [])
  assert.ok(repaired.markdown.includes('| 2026年上半年累计；结构化财务摘要 | 3,448.15 | 2,798.27 | 18.85% | 毛利率同比增加0.84个百分点（按同一毛利率水平计算） [financial@paragraph:1] |'))
  assert.match(repaired.markdown, /\n2026年半年度报告的分产品表显示/)
  for (const citation of ['financial@paragraph:1', 'half@paragraph:732']) {
    assert.equal(repaired.markdown.split(citation).length, fixture.split(citation).length)
  }
})

test('R174 missing product comparison cells remain blocked without invented limitations', () => {
  const fixture = [
    '### 产品矩阵',
    '| 产品/分部 | 覆盖与应用 | 技术路线 | 商业化证据与阶段 | 替代比较限制 |',
    '|---|---|---|---|---|',
    '| Segment A | Stated use | Reported route | Revenue disclosed [annual@paragraph:10] |',
    '| Segment B | Stated use | Reported route | Commercial status [annual@paragraph:11] |',
  ].join('\n')
  const repaired = repairCompanyResearchMarkdownTables(fixture)
  assert.equal(repaired.markdown, fixture, 'four supplied cells do not prove which fifth cell is missing')
  assert.deepEqual(repaired.repairs, [])
  assert.equal(validateCompanyResearchMarkdownTables(repaired.markdown).length, 2)
  assert.ok(!repaired.markdown.includes('同口径替代比较资料未提供'), 'absence of a cell is not evidence of absent data')

  const mixed = fixture.replace('| Segment B | Stated use | Reported route | Commercial status [annual@paragraph:11] |', '| Segment B | Stated use | Reported route | Commercial status [annual@paragraph:11] | Existing limit |')
  assert.equal(repairCompanyResearchMarkdownTables(mixed).markdown, mixed)
  assert.equal(validateCompanyResearchMarkdownTables(mixed).length, 1)
})

test('R174 reattaches a fused segment-margin header only to its unique later seven-column table', () => {
  const header = '| 报告期间及行业分类 | 营业收入（元） | 营业成本（元） | 毛利率 | 营业收入比上年同期增减 | 营业成本比上年同期增减 | 毛利率比上年同期增减 |'
  const fixture = [
    '## 市场规模背景',
    '| 市场 | 期间 | 数值与单位 | 来源 |',
    '|---|---|---|---|',
    '| EV market | 2025 | disclosed context | [annual@paragraph:20] |',
    `${header}`,
    'These markets have different boundaries and units.',
    '## Segment margins',
    'Margin columns and units are described here.',
    '|---|---:|---:|---:|---:|---:|---:|',
    '| 2025: Segment A | 100 | 80 | 20% | 5% | 7% | -1% [annual@paragraph:21] |',
    '| 2025: Segment B | 200 | 150 | 25% | 3% | 4% | 1% [annual@paragraph:22] |',
  ].join('\n')
  const repaired = repairCompanyResearchMarkdownTables(fixture)
  assert.deepEqual(repaired.diagnostics, [])
  assert.deepEqual(validateCompanyResearchMarkdownTables(repaired.markdown), [])
  assert.equal((repaired.markdown.match(new RegExp(header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length, 1)
  assert.match(repaired.markdown, /These markets have different boundaries and units\.\n## Segment margins\nMargin columns and units are described here\.\n\| 报告期间及行业分类 \| 营业收入（元） \|/)
  assert.ok(repaired.repairs.some(repair => repair.startsWith('TABLE_DISPLACED_HEADER_REATTACHED')))
  for (const citation of ['annual@paragraph:20', 'annual@paragraph:21', 'annual@paragraph:22']) assert.ok(repaired.markdown.includes(citation))

  const ambiguous = repairCompanyResearchMarkdownTables(fixture.replace('| 2025: Segment B | 200 | 150 | 25% | 3% | 4% | 1% [annual@paragraph:22] |', '| 2025: Segment B | 200 | 150 | 25% | 3% |'))
  assert.deepEqual(ambiguous.repairs.filter(repair => repair.startsWith('TABLE_DISPLACED_HEADER_REATTACHED')), [])
  assert.notDeepEqual(validateCompanyResearchMarkdownTables(ambiguous.markdown), [])

  const duplicated = repairCompanyResearchMarkdownTables(fixture.replace(header, header + '\n' + header))
  assert.ok(!duplicated.repairs.some(repair => repair.startsWith('TABLE_DISPLACED_HEADER_REATTACHED')))
  assert.notDeepEqual(validateCompanyResearchMarkdownTables(duplicated.markdown), [])
})

test('R159 promotes an independently classified cited segment header only when the table width and rows agree', () => {
  const fixture = [
    '收入结构分产品和独立分类披露。[annual@paragraph:816] 独立分类 2025年收入（元） 占营业收入比重 标签与数据引用 [annual@paragraph:817]',
    '|---|---:|---:|---|',
    '| 行业：日用电子器件制造业 | 155,236,528,000元 | 19.31% | [annual@paragraph:842] |',
    '| 行业：交通运输设备及电气制造业 | 648,645,636,000元 | 80.68% | [annual@paragraph:844] |',
  ].join('\n')
  const repaired = repairCompanyResearchMarkdownTables(fixture)
  assert.deepEqual(repaired.diagnostics, [])
  assert.deepEqual(validateCompanyResearchMarkdownTables(repaired.markdown), [])
  assert.match(repaired.markdown, /收入结构分产品和独立分类披露。\[annual@paragraph:816\]/)
  assert.match(repaired.markdown, /\| 独立分类 \| 2025年收入（元） \| 占营业收入比重 \| 标签与数据引用 \[annual@paragraph:817\] \|/)
  assert.ok(repaired.repairs.some(repair => repair.startsWith('TABLE_CITED_APPENDED_HEADER_PROMOTED')))
  const ambiguous = repairCompanyResearchMarkdownTables(fixture.replace('标签与数据引用 [annual@paragraph:817]', '标签与数据引用 [missing-locator]'))
  assert.notDeepEqual(validateCompanyResearchMarkdownTables(ambiguous.markdown), [])
})

test('R160 separates the explicit industry-background title from a verified five-column header',()=>{
  const fixture=[
    '行业规模背景 市场边界 年份及指标 规模 机构与归属 可比性说明',
    '|---|---|---|---|---|',
    '| 全球服务器及存储设备 | 2025年 | 4130亿美元 | 年报转述 [annual@paragraph:558] | 终端设备市场，不是公司TAM |',
    '| 全球数通光模块 | 2026年 | 228亿美元 | 年报转述 [annual@paragraph:560] | 与服务器市场边界不同 |'
  ].join('\n')
  const repaired=repairCompanyResearchMarkdownTables(fixture)
  assert.deepEqual(repaired.diagnostics,[])
  assert.deepEqual(validateCompanyResearchMarkdownTables(repaired.markdown),[])
  assert.match(repaired.markdown,/^## 行业规模背景\n\| 市场边界 \| 年份及指标 \| 规模 \| 机构与归属 \| 可比性说明 \|/m)
  assert.ok(repaired.repairs.some(item=>item.startsWith('TABLE_INDUSTRY_TITLE_HEADER_PROMOTED')))
  const wrongWidth=repairCompanyResearchMarkdownTables(fixture.replace('行业规模背景 市场边界 年份及指标 规模 机构与归属 可比性说明','行业规模背景 市场边界 规模'))
  assert.ok(!wrongWidth.repairs.some(item=>item.startsWith('TABLE_INDUSTRY_TITLE_HEADER_PROMOTED')))
  assert.doesNotMatch(wrongWidth.markdown,/^## 行业规模背景$/m)
})

test('market-size table repair reattaches only a unique cited three-column header', () => {
  const fixture = [
    '| 市场边界 | 规模/预测期间 | 机构、转述归属及适用限制 |',
    '',
    '下列数据仅作行业背景，不代表公司可服务市场。',
    '',
    '## 行业规模背景',
    '',
    '|---|---|---|',
    '| 全球PCB产值 | 2026年958亿美元；2029年超过1160亿美元 | 公司年报转述 [annual@paragraph:556] [annual@paragraph:557] |',
    '| 全球数通光模块 | 2026年228亿美元 | 公司年报转述 [annual@paragraph:574] |',
  ].join('\n')
  const repaired = repairCompanyResearchMarkdownTables(fixture)
  assert.deepEqual(repaired.diagnostics, [])
  assert.deepEqual(validateCompanyResearchMarkdownTables(repaired.markdown), [])
  assert.match(repaired.markdown, /下列数据仅作行业背景，不代表公司可服务市场。\n\n## 行业规模背景\n\n\| 市场边界 \| 规模\/预测期间 \| 机构、转述归属及适用限制 \|\n\|---\|---\|---\|/)
  assert.ok(repaired.repairs.some(item => item.startsWith('TABLE_MARKET_SIZE_HEADER_REATTACHED')))
  const ambiguous = repairCompanyResearchMarkdownTables(fixture.replace('[annual@paragraph:574]', '[missing-locator]'))
  assert.ok(!ambiguous.repairs.some(item => item.startsWith('TABLE_MARKET_SIZE_HEADER_REATTACHED')))
})

test('R161 restores the known four-column financing header beneath its explicit section title',()=>{
  const fixture='### 融资与现金来源\n|---|---|---|---|\n| 股权融资 | 56亿美元 | 公司称用于业务发展 | 来源未拆分 |\n| 债务融资 | 376.46亿元 | 期末余额 | 结构化数据 |'
  const repaired=repairCompanyResearchMarkdownTables(fixture)
  assert.deepEqual(repaired.diagnostics,[])
  assert.deepEqual(validateCompanyResearchMarkdownTables(repaired.markdown),[])
  assert.match(repaired.markdown,/\| 行动及期间 \| 金额\/比率 \| 目的与后续结果 \| 证据及判断 \|/)
  assert.ok(repaired.repairs.some(item=>item.startsWith('TABLE_FINANCING_HEADER_RESTORED')))
  const wrongWidth=repairCompanyResearchMarkdownTables(fixture.replaceAll('|---|---|---|---|','|---|---|---|'))
  assert.ok(!wrongWidth.repairs.some(item=>item.startsWith('TABLE_FINANCING_HEADER_RESTORED')))
})

test('table repair removes only a leaked structured-output closing sentinel after the final pipe', () => {
  const fixture = '| 指标 | 监控条件 | 依据 |\n|---|---|---|\n| 现金流 | 覆盖持续为负 | 年报披露。[filing@paragraph:1] |</markdown>'
  const repaired = repairCompanyResearchMarkdownTables(fixture)
  assert.deepEqual(repaired.diagnostics, [])
  assert.deepEqual(validateCompanyResearchMarkdownTables(repaired.markdown), [])
  assert.match(repaired.markdown, /年报披露。\[filing@paragraph:1\] \|$/)
  assert.ok(repaired.repairs.some(repair => repair.startsWith('TABLE_OUTPUT_SENTINEL_REMOVED')))
})

test('R137 table repair moves prose tails and detaches fused headings without dropping citations', () => {
  const fixtures = [
    `### Product income\n| product | amount | share | evidence |\n|---|---|---|---|\n| Other | 82 | 0.01% | source [src@paragraph:1] | Product tail survives. [tail66@paragraph:1]`,
    `### Product margin\n| product | customer | sales | margin |\n|---|---|---|---|\n| Other | unknown | separate | no row | Margin tail survives. [tail140@paragraph:1] More evidence [tail140b@paragraph:2]`,
    `| Previous market-boundary explanation survives. ## 行业规模背景 | market | period | scale | source | limits |\n|---|---|---|---|---|---|\n| adjacent market | 2025 | public estimate | source [src@paragraph:2] | not company TAM |`,
    `### Supplier summary\n| metric | value | evidence |\n|---|---|---|\n| Largest supplier share | 9.74% | [src@paragraph:3] | Supplier tail survives. [tail445@paragraph:1]`,
    `### Peer comparison\n| dimension | BYD | peer | limit |\n|---|---|---|---|\n| Channel | brand matrix | official site | qualitative only | Peer tail survives. [tail503@paragraph:1]`,
    `### Financial metrics\n| metric | current | prior | change |\n|---|---|---|---|\n| Capex | 447.03 | 805.25 | down | Financial tail survives. [tail570@paragraph:1]`,
    `| ### 资本开支与现金需求 Cash flow evidence and formulas survive. [tail730@paragraph:1] More cited details [tail730b@paragraph:2] ### 并购 No disclosed acquisitions. [mna@paragraph:1] ### 融资及股东回报 | Action | Amount | Outcome |\n|---|---|---|\n| H-share placement | disclosed | not attributable |`,
  ]
  const repaired = fixtures.map(fixture => repairCompanyResearchMarkdownTables(fixture))
  assert.deepEqual(repaired.flatMap(item => item.diagnostics), [])
  assert.deepEqual(repaired.flatMap(item => validateCompanyResearchMarkdownTables(item.markdown)), [])
  for (const [index, tokens] of [[['tail66@paragraph:1'], ['tail140@paragraph:1', 'tail140b@paragraph:2'], ['src@paragraph:2'], ['tail445@paragraph:1'], ['tail503@paragraph:1'], ['tail570@paragraph:1'], ['tail730@paragraph:1', 'tail730b@paragraph:2']]].flat().entries()) {
    for (const token of tokens) assert.ok(repaired[index]!.markdown.includes(token), `citation ${token} must survive repair`)
  }
  assert.ok(repaired[0]!.markdown.includes('Product tail survives.'))
  assert.ok(repaired[1]!.markdown.includes('More evidence [tail140b@paragraph:2]'))
  assert.match(repaired[2]!.markdown, /Previous market-boundary explanation survives\.\n## 行业规模背景\n\| market \| period \| scale \| source \| limits \|/)
  assert.match(repaired[6]!.markdown, /### 资本开支与现金需求\nCash flow evidence and formulas survive\.[\s\S]*### 并购\nNo disclosed acquisitions\. \[mna@paragraph:1\]\n### 融资及股东回报\n\| Action \| Amount \| Outcome \|/)
})

test('R138 leading heading and narrative prefix is detached only when the header and modal rows prove its width', () => {
  const fixture = `## 谁付费、购买什么及收入结构 比亚迪产品组合以整车销售和相关服务为主，具体收入占比应与财报分类对应。[official-a@paragraph:12] ### 主要分产品收入摘要 | 分产品 | 2025年营业收入（元） | 占营业收入比重 | 证据 |\n|---|---:|---:|---|\n| 汽车相关产品 | 648645636000 | 80.68% | 年报披露 [official-b@paragraph:88] |\n| 手机部件及组装 | 120000000000 | 14.93% | 年报披露 [official-b@paragraph:89] |`
  const repaired = repairCompanyResearchMarkdownTables(fixture)
  assert.deepEqual(repaired.diagnostics, [])
  assert.deepEqual(validateCompanyResearchMarkdownTables(repaired.markdown), [])
  assert.match(repaired.markdown, /## 谁付费、购买什么及收入结构\n比亚迪产品组合以整车销售和相关服务为主，具体收入占比应与财报分类对应。\[official-a@paragraph:12\]\n### 主要分产品收入摘要\n\| 分产品 \| 2025年营业收入（元） \| 占营业收入比重 \| 证据 \|/)
  for (const token of ['official-a@paragraph:12', 'official-b@paragraph:88', 'official-b@paragraph:89']) assert.ok(repaired.markdown.includes(token), `locator ${token} survives`)
  assert.ok(repaired.repairs.some(repair => repair.startsWith('TABLE_LEADING_PREFIX_DETACHED')))
})

test('R154 detaches fused explanatory prose from a verified-width business-segment table', () => {
  const fixture = `## 分部映射\n下表依据年度产品收入构成。产品类别与客户映射并非一一对应，因此不视为已证实。 | 业务/产品 | 客户购买内容 | 收入结构 | 利润边界 |\n|---|---|---|---|\n| 汽车相关产品 | 汽车销售，客户类型未披露 | 收入6486亿元。[annual@paragraph:821] | 毛利率20.49%。[annual@paragraph:833] | 该类别毛利不等于集团净利润。[annual@paragraph:834] |\n| 电子产品 | 部件与组装，定价未披露 | 收入1552亿元。[annual@paragraph:819] | 毛利率6.29%。[annual@paragraph:850] | ## 渠道与交付\n渠道对应产品、费用和库存未披露。[annual@paragraph:3721]`
  const locator = /\[[^\]]+@paragraph:\d+\]/gu
  const beforeLocators = [...fixture.matchAll(locator)].map(match => match[0])
  const repaired = repairCompanyResearchMarkdownTables(fixture)
  assert.ok(repaired.repairs.some(repair => repair.startsWith('TABLE_PROSE_CELL_TAILS_DETACHED')))
  assert.deepEqual(repaired.diagnostics, [])
  assert.deepEqual(validateCompanyResearchMarkdownTables(repaired.markdown), [])
  assert.match(repaired.markdown, /^\|---\|---\|---\|---\|$/m)
  assert.deepEqual([...repaired.markdown.matchAll(locator)].map(match => match[0]), beforeLocators)
  assert.match(repaired.markdown, /产品类别与客户映射并非一一对应，因此不视为已证实。\n\| 业务\/产品 \| 客户购买内容 \| 收入结构 \| 利润边界 \|/)
  assert.match(repaired.markdown, /汽车相关产品 \| 汽车销售，客户类型未披露 \| 收入6486亿元。\[annual@paragraph:821\] \| 毛利率20\.49%。\[annual@paragraph:833\] \|/)
  assert.match(repaired.markdown, /该类别毛利不等于集团净利润。\[annual@paragraph:834\]/)
  assert.match(repaired.markdown, /## 渠道与交付\n渠道对应产品、费用和库存未披露。\[annual@paragraph:3721\]/)
  const ambiguous = repairCompanyResearchMarkdownTables(`| 普通额外单元格 | A | B |\n|---|---|\n| X | Y | narrative prose with sufficient length. |`)
  assert.ok(!ambiguous.repairs.some(repair => repair.startsWith('TABLE_PROSE_CELL_TAILS_DETACHED')))
  assert.ok(validateCompanyResearchMarkdownTables(ambiguous.markdown).length > 0)
})

test('R138 standalone citation overflow is reattached without losing locator tokens', () => {
  const fixture = `### 产品证据\n| 产品 | 客户 | 收入 | 证据 | 边界 |\n|---|---|---|---|---|\n| 电池 | 多类客户 | 未单列 | 官方资料 | 不推断份额 | [official-f7c8d23d2829a5e8@paragraph:845]`
  const repaired = repairCompanyResearchMarkdownTables(fixture)
  assert.deepEqual(repaired.diagnostics, [])
  assert.deepEqual(validateCompanyResearchMarkdownTables(repaired.markdown), [])
  assert.match(repaired.markdown, /不推断份额 \[official-f7c8d23d2829a5e8@paragraph:845\] \|/)
  assert.equal((repaired.markdown.match(/official-f7c8d23d2829a5e8@paragraph:845/g) ?? []).length, 1)
})

test('R139 trailing headings in final table rows move to prose with citations in order', () => {
  const fixtures = [
    { id: 'products', markdown: `| 产品 | 场景 | 技术 | 商业化 |\n|---|---|---|---|\n| 新能源汽车 | 乘用车 [p0@paragraph:0] | 电动化 | 多车型 |\n| 城轨 | 公共交通 [p1@paragraph:1] | 公司方案 [p2@paragraph:2] | 缺少订单 [p3@paragraph:3] | ## 产品层面的经营含义与限制 毛利率分类不能代表车型利润。[p4@paragraph:4] 后续边界仍需跟踪。[p5@paragraph:5]` },
    { id: 'management-capital-allocation', markdown: `| 事项 | 证据 | 判断 |\n|---|---|---|\n| 资本开支 | 基地扩产 | 观察利用率 |\n| 并购 | 未提供具体交易 | 不建立台账 | ## 研发口径与配置判断 年度研发投入与半年度研发费用不可直接比较。[m1@paragraph:1] 需按期间和指标持续监控。[m2@paragraph:2]` },
    { id: 'risks', markdown: `| 风险 | 影响路径 | 监控 | 缓释 | 边界 |\n|---|---|---|---|---|\n| 经营 | 现金占用 | 现金流 | 缓释因素 | 不推断危机 |\n| 政策 | 订单与合规 | 海外收入 | 多市场布局 | 敞口未量化 | ## 客户数据核对与局限 客户匿名标签不能映射法律主体。[r1@paragraph:1] ## 研究结论与失效条件 条件变化时应调整判断。[r2@paragraph:2]` },
  ]
  const locator = /\[[A-Za-z0-9._:-]+@paragraph:\d+\]/gu
  for (const fixture of fixtures) {
    const repaired = repairCompanyResearchMarkdownTables(fixture.markdown)
    assert.deepEqual(repaired.diagnostics, [], fixture.id)
    assert.deepEqual(validateCompanyResearchMarkdownTables(repaired.markdown), [], fixture.id)
    assert.ok(repaired.repairs.some(repair => repair.startsWith('TABLE_TRAILING_HEADING_PROSE_DETACHED')), fixture.id)
    const before = [...fixture.markdown.matchAll(locator)].map(match => match[0])
    const after = [...repaired.markdown.matchAll(locator)].map(match => match[0])
    assert.deepEqual(after, before, `${fixture.id} locator order survives`)
    assert.match(repaired.markdown, /\n## /, fixture.id)
  }
  const ambiguous = repairCompanyResearchMarkdownTables('| A | B |\n|---|---|\n| x | y |\n| x | y | ## heading prose |\n| x | y |')
  assert.ok(ambiguous.diagnostics.some(diagnostic => diagnostic.includes('heading embedded in data row')))
})

test('R140 business-segments and financial-quality detach fused following table headers', () => {
  const fixtures = [
    `## 业务分部与收入逻辑 年报产品口径与集团业务介绍不同，以下收入表仅列实际披露分类。[s1@paragraph:1] | 产品 | 收入 | 占比 | 毛利率 |\n|---|---:|---:|---:|\n| 电子 | 100 | 20% | 6% [s2@paragraph:2] |\n| 汽车 | 300 | 60% | 20% [s3@paragraph:3] |\n| 其他 | 100 | 20% | 未单列 | 毛利表单位为元，按行标签与数值配对阅读。[s4@paragraph:4] | 关系维度 | 已披露信息及解释 |\n|---|---|\n| 客户需求 | 买方未映射。[s5@paragraph:5] |\n| 成本与利润 | 产品毛利不等于分部利润。[s6@paragraph:6] | ### 分部经济解释与限制 毛利率不能代表资本回报。[s7@paragraph:7]`,
    `| 指标 | 本期 | 上期 | 变化 | 口径 |\n|---|---:|---:|---:|---|\n| 营业收入 | 100 | 110 | -9% | 累计 [f1@paragraph:1] |\n| 营业利润 | 10 | 12 | -17% | 累计 [f2@paragraph:2] |\n| 简化自由现金流 | -5 | — | — | 经营现金流减资本支出 [f3@paragraph:3] 上半年累计数据不等于FCFF。[f4@paragraph:4] ## 现金转化与营运资本 现金转化比须结合净利润口径限制。[f5@paragraph:5] | 营运资本指标 | 上半年累计计算 |\n|---|---|\n| DSO | 22天 [f6@paragraph:6] |\n| DIO | 106天 [f7@paragraph:7] |`,
  ]
  const locator = /\[[A-Za-z0-9._:-]+@paragraph:\d+\]/gu
  for (const [fixtureIndex, fixture] of fixtures.entries()) {
    const repaired = repairCompanyResearchMarkdownTables(fixture)
    assert.deepEqual(repaired.diagnostics, [], `R140 fixture ${fixtureIndex}`)
    assert.deepEqual(validateCompanyResearchMarkdownTables(repaired.markdown), [], `R140 fixture ${fixtureIndex}`)
    assert.ok(repaired.repairs.some(repair => repair.startsWith('TABLE_FOLLOWING_TABLE_DETACHED')))
    assert.ok(repaired.markdown.includes('| 关系维度 | 已披露信息及解释 |') || repaired.markdown.includes('| 营运资本指标 | 上半年累计计算 |'))
    assert.deepEqual([...repaired.markdown.matchAll(locator)].map(match => match[0]), [...fixture.matchAll(locator)].map(match => match[0]))
  }
  const ambiguous = repairCompanyResearchMarkdownTables(`| A | B |\n|---|---|\n| x | y | ordinary extra | next |\n|---|---|\n| a | b |`)
  assert.ok(!ambiguous.repairs.some(repair => repair.startsWith('TABLE_FOLLOWING_TABLE_DETACHED')))
})

test('R141 promotes a cited plain-text header only when separator and data widths prove it', () => {
  const fixture = `## 现金周期说明 资产负债表比较列为期末余额与上年末，不是同比。[financial@paragraph:1] ## 营运资本与现金周期 应收、存货和合同负债余额如下。[financial@paragraph:2] 科目 2026年6月末（元） 上年末（元） 原表比较口径\n|---|---:|---:|---|\n| 应收账款 | 50,126,342,000 | 37,004,685,000 | 较上年末增加 [balance@paragraph:7] |\n| 存货 | 189,990,772,000 | 138,420,580,000 | 较上年末增加 [balance@paragraph:8] |`
  const repaired = repairCompanyResearchMarkdownTables(fixture)
  assert.deepEqual(repaired.diagnostics, [])
  assert.deepEqual(validateCompanyResearchMarkdownTables(repaired.markdown), [])
  assert.match(repaired.markdown, /\| 科目 \| 2026年6月末（元） \| 上年末（元） \| 原表比较口径 \|/)
  assert.deepEqual([...repaired.markdown.matchAll(/\[[A-Za-z0-9._:-]+@paragraph:\d+\]/gu)].map(match => match[0]), [...fixture.matchAll(/\[[A-Za-z0-9._:-]+@paragraph:\d+\]/gu)].map(match => match[0]))
  const ambiguous = repairCompanyResearchMarkdownTables(`来源说明 [financial@paragraph:1] 普通叙述词条太多无法确定表头\n|---|---|\n|A|B|`)
  assert.ok(!ambiguous.repairs.some(repair => repair.startsWith('TABLE_CITED_PLAIN_HEADER_PROMOTED')))
  assert.match(validateCompanyResearchMarkdownTables(ambiguous.markdown)[0]!, /no adjacent header row/)
})

test('promotes a cited table header appended after narrative when its suffix matches separator and row widths', () => {
  const fixture = `年度产品组合收入与成本情况以年报口径列示。[annual@paragraph:833] [annual@paragraph:834] 报告期/产品行 营业收入（元） 营业成本（元） 毛利率 营业收入同比变化 营业成本同比变化 毛利率同比变化 [annual@paragraph:845]\n|---|---:|---:|---:|---:|---:|---:|\n|2025年度：手机部件、组装及其他产品|155236528000|145473989000|6.29%|-2.74%|-0.56%|-2.06% [annual@paragraph:851]|\n|2025年度：汽车、汽车相关产品及其他产品|648645636000|515762940000|20.49%|18.52%|16.12%|0.28% [annual@paragraph:855]|`
  const before = [...fixture.matchAll(/\[[^\]]+@paragraph:\d+\]/gu)].map(match => match[0])
  const repaired = repairCompanyResearchMarkdownTables(fixture)
  assert.deepEqual(repaired.diagnostics, [])
  assert.deepEqual(validateCompanyResearchMarkdownTables(repaired.markdown), [])
  assert.ok(repaired.repairs.some(repair => repair.startsWith('TABLE_CITED_APPENDED_HEADER_PROMOTED')))
  assert.match(repaired.markdown, /\| 报告期\/产品行 \| 营业收入（元） \| 营业成本（元） \| 毛利率 \| 营业收入同比变化 \| 营业成本同比变化 \| 毛利率同比变化 \[annual@paragraph:845\] \|/)
  assert.deepEqual([...repaired.markdown.matchAll(/\[[^\]]+@paragraph:\d+\]/gu)].map(match => match[0]), before)
  const ambiguous = repairCompanyResearchMarkdownTables(`说明内容没有明确表头。[annual@paragraph:1] 普通产品特点 尚未量化 缺少对照 公司资料 [annual@paragraph:2]\n|---|---|---|---|\n|A|B|C|D|`)
  assert.ok(!ambiguous.repairs.some(repair => repair.startsWith('TABLE_CITED_APPENDED_HEADER_PROMOTED')))
  assert.match(validateCompanyResearchMarkdownTables(ambiguous.markdown)[0]!, /no adjacent header row/)
})

test('R170 restores fused BYD product-margin and capital-allocation tables without losing citations', () => {
  const product = `## 利润来源\n汽车与电子产品毛利率分属产品口径，单位为元；期间为2025年。[annual@paragraph:833] [annual@paragraph:834] 产品分类 营业收入（元） 营业成本（元） 毛利率\n|---|---:|---:|---:|\n| 手机部件、组装及其他产品 | 155,236,528,000.00；145,473,989,000.00；6.29% [annual@paragraph:851] [annual@paragraph:833] [annual@paragraph:834] |\n| 汽车、汽车相关产品及其他产品 | 648,645,636,000.00；515,762,940,000.00；20.49% [annual@paragraph:855] [annual@paragraph:833] [annual@paragraph:834] | 为避免表格单元格混淆，数据仅按原表栏目比较。[annual@paragraph:850] ## 客户集中度与监测 年报另披露客户结构。[annual@paragraph:918]`
  const management = `## 行动台账\n| 行动及目的 | 金额、期间与状态 | 资金来源及结果 |\n|---|---|---|\n| 研发：持续加码科技创新；年度研发投入金额分别为2025年人民币634.41亿元、2024年人民币541.61亿元，原表变动比例17.13%。[annual@paragraph:2243] 公司另称2026年上半年研发投入约人民币289亿元。[interim@paragraph:1110] | 研发投入并非资本开支或当期现金流的同义项；缺少项目级商业化收益，无法判断投资回报。|\n| 资本开支 | 半年累计资本开支高于经营现金净流量。[financial@paragraph:1] | 具体用途和项目回报未披露。 |\n| 分红 | 已实施。[interim@paragraph:1112] | 与再投资存在现金配置取舍。 | ## 研发口径与资本强度 年报研发投入与结构化研发费用不可直接比较。[annual@paragraph:2243] ## 资金需求与风险 资本开支超过经营现金流会提高对现金存量或融资的依赖。[financial@paragraph:1]`
  const locator = /\[[^\]]+@paragraph:\d+\]/gu
  for (const [section, expected] of [[product, ['| 产品分类 | 营业收入（元） | 营业成本（元） | 毛利率 |', '| 手机部件、组装及其他产品 | 155,236,528,000.00 | 145,473,989,000.00 | 6.29%']], [management, ['| 研发：持续加码科技创新 | 年度研发投入金额分别为2025年人民币634.41亿元、2024年人民币541.61亿元', '## 研发口径与资本强度', '## 资金需求与风险']]] as const) {
    const before = [...section.matchAll(locator)].map(match => match[0])
    const repaired = repairCompanyResearchMarkdownTables(section)
    assert.deepEqual(repaired.diagnostics, [])
    assert.deepEqual(validateCompanyResearchMarkdownTables(repaired.markdown), [])
    assert.deepEqual([...repaired.markdown.matchAll(locator)].map(match => match[0]), before)
    for (const text of expected) assert.ok(repaired.markdown.includes(text), `preserves repaired content: ${text}`)
  }
  const ambiguous = repairCompanyResearchMarkdownTables(`说明段落有一个不明表格。\n|---|---|---|---|\n| 标签 | 1；2；3% | 文本 |`)
  assert.ok(ambiguous.diagnostics.length > 0 || validateCompanyResearchMarkdownTables(ambiguous.markdown).length > 0)
})

test('synthesis binds each split 2025 BYD product margin and change to its exact product label and row', () => {
  const sourceCandidateId = 'official-annual'
  const rows = [
    ['paragraph:833', '单位：元'], ['paragraph:834', '营业收入 营业成本 毛利率 营业收入比上'],
    ['paragraph:835', '年同期增减'], ['paragraph:836', '营业成本比上'], ['paragraph:837', '年同期增减'],
    ['paragraph:838', '毛利率比上'], ['paragraph:839', '年同期增减'], ['paragraph:845', '分产品'],
    ['paragraph:850', '手机部件、组'], ['paragraph:851', '装及其他产品 155,236,528,000.00 145,473,989,000.00 6.29% -2.74% -0.56% -2.06%'],
    ['paragraph:852', '汽车、汽车相'], ['paragraph:853', '关产品及其他'], ['paragraph:854', '产品'],
    ['paragraph:855', '648,645,636,000.00 515,762,940,000.00 20.49% 5.06% 7.53% -1.82%'],
  ] as const
  const packet = { sourceCandidateId, title: '2025年年度报告', excerpts: rows.map(([location, text]) => ({ location, text })) }
  const method = { skillId: 'business_model_map', executionEvidence: [packet], deterministicEvidence: [] } as unknown as CompanyResearchMethodResult
  const input = '2025年度分产品毛利率分别为20.49%和6.29%，表列毛利率同比变化分别为-1.82%和-2.06%（沿用原表百分比口径）'
  const repaired = bindExact2025BydProductMarginSynthesisCitations(input, [method], new Set(rows.map(([location]) => `${sourceCandidateId}@${location}`)))
  assert.match(repaired, /“汽车、汽车相关产品及其他产品”毛利率为20\.49%\[official-annual@paragraph:833\].*official-annual@paragraph:855/u)
  assert.match(repaired, /“手机部件、组装及其他产品”毛利率为6\.29%\[official-annual@paragraph:833\].*official-annual@paragraph:850.*official-annual@paragraph:851/u)
  assert.match(repaired, /毛利率比上年同期增减/u)
  assert.ok(!repaired.includes('20.49%和6.29%'))
  assert.equal(bindExact2025BydProductMarginSynthesisCitations(input, [method], new Set()), input, 'missing evidence keeps the original claim untouched for the numeric gate to reject')
})

test('R173 detaches a uniquely sized table header appended after explanatory prose', () => {
  const fixture = `## 分行业与分产品经营数据 年度报告表头单位为元，按原表披露营业收入、营业成本、毛利率及各自同比变动；变化列保留原单位。[annual@paragraph:833] | 分类 | 营业收入（元） | 营业成本（元） | 毛利率 | 收入同比 | 成本同比 | 毛利率同比（%） |
|---|---:|---:|---:|---:|---:|---:|
| 分行业：电子制造 | 100 | 90 | 10% | 5% | 7% | -2% [annual@paragraph:851] |
| 分行业：汽车制造 | 300 | 240 | 20% | 8% | 6% | 1% [annual@paragraph:855] |`
  const before = [...fixture.matchAll(/\[[^\]]+@paragraph:\d+\]/gu)].map(match => match[0])
  const repaired = repairCompanyResearchMarkdownTables(fixture)
  assert.deepEqual(repaired.diagnostics, [])
  assert.deepEqual(validateCompanyResearchMarkdownTables(repaired.markdown), [])
  assert.ok(repaired.repairs.some(repair => repair.startsWith('TABLE_LEADING_PREFIX_DETACHED') || repair.startsWith('TABLE_HEADER_HEADING_DETACHED')))
  assert.match(repaired.markdown, /变化列保留原单位。\[annual@paragraph:833\]\n\| 分类 \|/)
  assert.deepEqual([...repaired.markdown.matchAll(/\[[^\]]+@paragraph:\d+\]/gu)].map(match => match[0]), before)
  const ambiguous = repairCompanyResearchMarkdownTables(`## 说明 文字含义不清的叙述后跟了一个可能的表头 | A | B | C | D |\n|---|---|---|---|\n| a | b | c | d | unexpected |`)
  assert.ok(ambiguous.diagnostics.length > 0 || validateCompanyResearchMarkdownTables(ambiguous.markdown).length > 0)
})

test('R171 restores the exact business-segments disclosure table and keeps ambiguous shapes fail-closed', () => {
  const fixture = `### 客户、渠道及分部经济机制

可确认的是直销与经销均有披露；产品及客户对应关系尚未拆分。[annual@paragraph:828] 披露维度 可确认事项 解释及限制 [annual@paragraph:817]
|---|---|---|
| 汽车相关产品 | 汽车、汽车相关产品及其他产品 | 主导收入结构；客户和价格未拆分。[annual@paragraph:821] |
| 电子产品 | 手机部件、组装及其他产品 | 重要补充业务。[annual@paragraph:819] |
| 电池与光伏 | 业务介绍列示相关领域 | 产品收入未单列。[annual@paragraph:170] |
| 渠道 | 直销、经销均被披露 | 缺少与产品和客户的交叉表。[annual@paragraph:830] | ### 规模优势、成本与反证 缺乏采购协同和产能利用率数据，规模优势仍待验证。[annual@paragraph:158]`
  const locators = [...fixture.matchAll(/\[[^\]]+@paragraph:\d+\]/gu)].map(match => match[0])
  const repaired = repairCompanyResearchMarkdownTables(fixture)
  assert.deepEqual(repaired.diagnostics, [])
  assert.deepEqual(validateCompanyResearchMarkdownTables(repaired.markdown), [])
  assert.ok(repaired.repairs.some(repair => repair.startsWith('TABLE_BUSINESS_SEGMENTS_HEADER_RESTORED')))
  assert.ok(repaired.markdown.includes('可确认的是直销与经销均有披露；产品及客户对应关系尚未拆分。[annual@paragraph:828]'))
  assert.ok(repaired.markdown.includes('| 披露维度 | 可确认事项 | 解释及限制 [annual@paragraph:817] |'))
  assert.ok(repaired.markdown.includes('### 规模优势、成本与反证'))
  assert.deepEqual([...repaired.markdown.matchAll(/\[[^\]]+@paragraph:\d+\]/gu)].map(match => match[0]), locators)

  const ambiguous = repairCompanyResearchMarkdownTables(fixture.replace('| 渠道 |', '| 未知标签 |'))
  assert.ok(ambiguous.diagnostics.some(diagnostic => diagnostic.includes('business-segments header/table shape')))
  assert.ok(validateCompanyResearchMarkdownTables(ambiguous.markdown).some(error => error.includes('no adjacent header row')))
  assert.ok(!ambiguous.repairs.some(repair => repair.startsWith('TABLE_ORPHAN_SEPARATOR_REMOVED')))
})

test('R142 detaches the products income table only when both table widths and overflow prove the fusion', () => {
  // This is the exact R142 products-section shape: the final product row
  // absorbs a cited heading and six-column income header; the next table has
  // two locator-only overflow cells and one final explanatory prose tail.
  let fixture = `| 产品 | 场景 | 技术与产品 | 商业化阶段 | 证据边界 |\n|---|---|---|---|---|\n| 乘用车 | 国内及海外 | 新能源车型 | 已销售 | 不推断车型利润 |\n| 手机部件 | 消费电子 | 结构件及组装 | 已销售 | 业务口径较宽 |\n| 城市轨道交通 | 公共交通 | 云轨、云巴 | 研发产品 | 运营数据未核实 | ## 产品收入及毛利差异 年报分产品分类仅到手机部件与组装、汽车及相关产品。[income@paragraph:833] | 期间 | 产品标签 | 营业收入（元） | 营业成本（元） | 毛利率 | 毛利率同比变化 |\n|---|---|---:|---:|---:|---:|\n| 2025年度 | 手机部件及组装 | 155236528000 [income@paragraph:851] | 145473989000 [income@paragraph:851] | 6.29% [income@paragraph:851] | -2.06% [income@paragraph:851] | [income@paragraph:845]\n| 2025年度 | 汽车及相关产品 | 648645636000 [income@paragraph:855] | 515762940000 [income@paragraph:855] | 20.49% [income@paragraph:855] | -1.82% [income@paragraph:855] |\n| 2024年度 | 手机部件及组装 | 159608576000 [income24@paragraph:724] | 146289389000 [income24@paragraph:724] | 8.34% [income24@paragraph:724] | -0.30% [income24@paragraph:724] | [income24@paragraph:722]\n| 2024年度 | 汽车及相关产品 | 617381935000 [income24@paragraph:728] | 479660859000 [income24@paragraph:728] | 22.31% [income24@paragraph:728] | 1.29% [income24@paragraph:728] | 2025与2024标签范围较宽，不代表纯汽车或单一手机业务盈利趋势。[income@paragraph:833] [income24@paragraph:710]`
  const artifactPath = 'runtime-data/company-quality-acceptance/R142-byd/002594-report.json'
  if (existsSync(artifactPath)) {
    const report = JSON.parse(readFileSync(artifactPath, 'utf8')) as { sections?: Array<{ id: string; markdown: string }> }
    fixture = report.sections?.find(section => section.id === 'products')?.markdown ?? fixture
  }
  const locator = /\[[A-Za-z0-9._:-]+@paragraph:\d+\]/gu
  const before = [...fixture.matchAll(locator)].map(match => match[0])
  const repaired = repairCompanyResearchMarkdownTables(fixture)
  assert.deepEqual(repaired.diagnostics, [])
  assert.deepEqual(validateCompanyResearchMarkdownTables(repaired.markdown), [])
  assert.ok(repaired.repairs.some(repair => repair.startsWith('TABLE_FOLLOWING_TABLE_DETACHED')))
  assert.ok(repaired.repairs.some(repair => repair.startsWith('TABLE_TRAILING_CITATIONS_REATTACHED')))
  assert.ok(repaired.repairs.some(repair => repair.startsWith('TABLE_TRAILING_NARRATIVE_MOVED')))
  assert.ok(repaired.markdown.includes('## 产品收入及毛利差异\n'))
  assert.ok(repaired.markdown.includes('| 期间 | 产品标签 | 营业收入（元） | 营业成本（元） | 毛利率 | 毛利率比上年同期增减（原表） |') || repaired.markdown.includes('| 期间 | 产品标签 | 营业收入（元） | 营业成本（元） | 毛利率 | 毛利率同比变化 |'))
  assert.ok(repaired.markdown.includes('不能解释为纯汽车或单一手机产品盈利趋势') || repaired.markdown.includes('不代表纯汽车或单一手机业务盈利趋势'))
  assert.deepEqual([...repaired.markdown.matchAll(locator)].map(match => match[0]), before, 'all citation locators retain their original order')

  const ambiguous = repairCompanyResearchMarkdownTables(`| 产品 | 场景 | 技术 | 商业化 | 边界 |\n|---|---|---|---|---|\n| 城轨 | 公共交通 | 已研发 | 未量化 | 未披露 | ## 产品收入说明 [p@paragraph:1] | 期间 | 产品 | 收入 | 成本 | 毛利 | 变化 |\n|---|---|---:|---:|---:|---:|\n| 2025 | A | 1 | 1 | 1% | 0% | unexpected overflow\n| 2024 | B | 1 | 1 | 1% | 0% |`)
  assert.ok(!ambiguous.repairs.some(repair => repair.startsWith('TABLE_FOLLOWING_TABLE_DETACHED')))
  assert.ok(ambiguous.diagnostics.length > 0)
})

test('R174 separates a fused business-model margin table with a blank leading header and prose tail', () => {
  const fixture = `| 产品分类 | 2025年营业收入（元） | 占营业收入比重 |
|---|---:|---:|
| 手机部件、组装及其他产品 | 155,236,528,000.00 [annual@paragraph:820] | 19.31% [annual@paragraph:820] |
| 汽车、汽车相关产品及其他产品 | 648,645,636,000.00 [annual@paragraph:822] | 80.68% [annual@paragraph:822] |
| 其他 | 82,794,000.00 [annual@paragraph:823] | 0.01% [annual@paragraph:823] | | 产品类别 | 2025年毛利率 |
|---|---:|
| 手机部件、组装及其他产品 | 6.29% [annual@paragraph:851] |
| 汽车、汽车相关产品及其他产品 | 20.49% [annual@paragraph:855] | 毛利率表单位为元，数值分别是对应产品分类毛利率，不代表合并毛利率。[annual@paragraph:833] [annual@paragraph:834] |`
  const locator = /\[[A-Za-z0-9._:-]+@paragraph:\d+\]/gu
  const before = [...fixture.matchAll(locator)].map(match => match[0])
  const repaired = repairCompanyResearchMarkdownTables(fixture)
  assert.deepEqual(repaired.diagnostics, [])
  assert.deepEqual(validateCompanyResearchMarkdownTables(repaired.markdown), [])
  assert.ok(repaired.repairs.some(repair => repair.startsWith('TABLE_FOLLOWING_TABLE_DETACHED')))
  assert.match(repaired.markdown, /\| 其他 \| 82,794,000\.00 \[annual@paragraph:823\] \| 0\.01% \[annual@paragraph:823\] \|\n\n\| 产品类别 \| 2025年毛利率 \|/u)
  assert.match(repaired.markdown, /\|---\|---:\|\n\| 手机部件、组装及其他产品 \| 6\.29% \[annual@paragraph:851\] \|\n\| 汽车、汽车相关产品及其他产品 \| 20\.49% \[annual@paragraph:855\] \|\n\n毛利率表单位/u)
  assert.ok(!repaired.markdown.includes('| | 产品类别 |'), 'removes the empty leading header cell only after width proof')
  assert.deepEqual([...repaired.markdown.matchAll(locator)].map(match => match[0]), before, 'all citations retain their original order and count')

  const ambiguous = repairCompanyResearchMarkdownTables(fixture
    .replace('| | 产品类别 | 2025年毛利率 |', '| unclear | 产品类别 | 2025年毛利率 |')
    .replace('| 其他 | 82,794,000.00 [annual@paragraph:823] | 0.01% [annual@paragraph:823] | | 产品类别 | 2025年毛利率 |',
      '| 其他 | 82,794,000.00 [annual@paragraph:823] | 0.01% [annual@paragraph:823] | unclear | 产品类别 | 2025年毛利率 |'))
  assert.ok(!ambiguous.repairs.some(repair => repair.startsWith('TABLE_FOLLOWING_TABLE_DETACHED')))
  assert.ok(ambiguous.diagnostics.length > 0 || validateCompanyResearchMarkdownTables(ambiguous.markdown).length > 0)
})

test('R143 repairs heading and displaced-header fusions only when section widths prove them', () => {
  const fallback: Array<{ id: string; markdown: string }> = [
    { id: 'business-model', markdown: `# 商业模式与变现 ## 谁付费、买什么、如何交付 收入由汽车与电子产品贡献。[bm1@paragraph:1] | 产品收入构成 | 本期金额 | 占比 | 依据 |\n|---|---:|---:|---|\n| 汽车相关 | 648 | 80% | 年报 [bm2@paragraph:2] |\n| 手机部件 | 155 | 19% | 年报 [bm3@paragraph:3] | 年报分类说明，金额单位为元。[bm4@paragraph:4] | 期间 | 关系 | 缺口 |\n|---|---|---|\n| 汽车 | 披露事实 | 不推断 |` },
    { id: 'industry-exposure', markdown: `| 市场 | 产品 | 客户 | 边界 |\n|---|---|---|---|\n| 汽车 | 整车 | 多地 | 仅背景 |\n| 算力 | 服务器 | 未披露 | 不等于TAM | ## 行业规模背景 以下为第三方行业预测，仅作背景。[ind1@paragraph:1] | 市场 | 期间 | 规模 | 来源 |\n|---|---|---|---|\n| AI服务器 | 2025 | 1,672亿美元 | 年报转述 [ind2@paragraph:2] |` },
    { id: 'supply-chain', markdown: `# 供应链与价值链 ## 采购集中度 前五大供应商占比已披露。[sc1@paragraph:1] | 供应商 | 采购额 | 占比 | 口径 |\n|---|---:|---:|---|\n| 供应商一 | 62 | 9.74% | 年报披露 [sc2@paragraph:2] | 供应商映射未知。 ## 客户侧与交付链 客户身份匿名。[sc3@paragraph:3]` },
    { id: 'revenue-profit-drivers', markdown: `## 收入与利润驱动 收入下降、利润承压。[fin1@paragraph:1] | 指标 | 本期 | 上期 | 同比 |\n\n**期间说明：**累计流量可比。[fin2@paragraph:2]\n\n|---|---:|---:|---:|\n| 收入 | 90 | 100 | -10% [fin3@paragraph:3] |` },
  ]
  const artifactPath = 'runtime-data/company-quality-acceptance/R143-byd/002594-report.json'
  let sections = fallback
  if (existsSync(artifactPath)) {
    const report = JSON.parse(readFileSync(artifactPath, 'utf8')) as { sections?: Array<{ id: string; markdown: string }> }
    const wanted = new Set(fallback.map(section => section.id))
    sections = report.sections?.filter(section => wanted.has(section.id)) ?? fallback
  }
  const locator = /\[[A-Za-z0-9._:-]+@paragraph:\d+\]/gu
  for (const section of sections) {
    const before = [...section.markdown.matchAll(locator)].map(match => match[0])
    const repaired = repairCompanyResearchMarkdownTables(section.markdown)
    assert.deepEqual(repaired.diagnostics, [], section.id)
    assert.deepEqual(validateCompanyResearchMarkdownTables(repaired.markdown), [], section.id)
    assert.deepEqual([...repaired.markdown.matchAll(locator)].map(match => match[0]), before, `${section.id} locator order survives`)
    assert.ok(repaired.repairs.length > 0, `${section.id} records a deterministic repair`)
  }
  const displaced = `## 收入与利润驱动 收入下降、利润承压。[fin1@paragraph:1] | 口径与报告表头 | 本报告期收入 | 上年同期收入 | 同比变化 |\n说明文字保留原位置。[fin2@paragraph:2]\n|---|---|---|---|\n| 2026年上半年 | 90 | 100 | -10% |\n| 2025年上半年 | 100 | 95 | 5% |`
  const repairedDisplaced = repairCompanyResearchMarkdownTables(displaced)
  assert.ok(repairedDisplaced.repairs.some(repair => repair.startsWith('TABLE_EMBEDDED_HEADER_MOVED')))
  assert.ok(repairedDisplaced.markdown.includes('| 口径与报告表头 | 本报告期收入 | 上年同期收入 | 同比变化 |'))

  const ambiguous = repairCompanyResearchMarkdownTables(`| ordinary extra cell | A | B |\n|---|---|\n| x | y |\n| x | y | z |`)
  assert.ok(!ambiguous.repairs.some(repair => repair.startsWith('TABLE_LEADING_PREFIX_DETACHED')))
  assert.ok(validateCompanyResearchMarkdownTables(ambiguous.markdown).length > 0)
  const unproven = repairCompanyResearchMarkdownTables(`## Narrative ## Heading explanatory text | A | B | C |\n|---|---|\n| x | y | z | unexpected |`)
  assert.ok(!unproven.repairs.some(repair => repair.startsWith('TABLE_EMBEDDED_HEADER_MOVED')))
})

test('business-model repair moves cited prose out of the exact product table header separator gap', () => {
  const source = `### 商业模式与变现\n| 产品/业务 | 客户类型与购买决策 | 定价、交付与收入机制 | 成本及利润观察 |\n\n产品分类说明及客户决策边界。[bm1@paragraph:11] [bm1@paragraph:12]\n\n|---|---|---|---|\n| 汽车 | 客户类型按车型区分 | 整车销售 | 成本受原材料影响 [bm1@paragraph:13] |\n| 电子产品 | 终端品牌与制造商 | 零部件销售 | 利润随产品组合变化 [bm1@paragraph:14] |`
  const before = [...source.matchAll(/\[[^\]]+\]/g)].map(match => match[0])
  const repaired = repairCompanyResearchMarkdownTables(source)
  assert.ok(repaired.repairs.some(repair => repair.startsWith('TABLE_BUSINESS_MODEL_NARRATIVE_MOVED_AFTER_TABLE')))
  assert.deepEqual(repaired.diagnostics, [])
  assert.deepEqual(validateCompanyResearchMarkdownTables(repaired.markdown), [])
  assert.deepEqual([...repaired.markdown.matchAll(/\[[^\]]+\]/g)].map(match => match[0]).sort(), before.sort(), 'all citations survive the prose relocation')
  assert.ok(repaired.markdown.indexOf('|---|---|---|---|') < repaired.markdown.indexOf('产品分类说明及客户决策边界'))
  assert.ok(repaired.markdown.indexOf('产品分类说明及客户决策边界') > repaired.markdown.indexOf('| 电子产品 |'))

  const ambiguous = repairCompanyResearchMarkdownTables(`### 未知表格\n| A | B | C | D |\n\n普通说明文字和引用。[x@paragraph:1]\n\n|---|---|---|---|\n| 1 | 2 | 3 | 4 |`)
  assert.ok(!ambiguous.repairs.some(repair => repair.startsWith('TABLE_BUSINESS_MODEL_NARRATIVE_MOVED_AFTER_TABLE')))
  assert.ok(validateCompanyResearchMarkdownTables(ambiguous.markdown).length > 0, 'unknown table remains malformed and fail-closed')

  const partial = repairCompanyResearchMarkdownTables(`| 产品/业务 | 客户类型与购买决策 | 定价、交付与收入机制 | 成本及利润观察 |\n\n产品分类说明及客户决策边界。[bm1@paragraph:11]\n\n|---|---|---|---|\n| 汽车 | 个人客户 | 整车销售 | 成本受原材料影响 |\n| 电子产品 | 品牌客户 | 零部件销售 | 成本与毛利变化 | unexpected cell |`)
  assert.ok(!partial.repairs.some(repair => repair.startsWith('TABLE_BUSINESS_MODEL_NARRATIVE_MOVED_AFTER_TABLE')), JSON.stringify(partial))
})

test('industry repair splits the exact fused two-column report-locator header after a seven-column row',()=>{
  const source='official-report'
  const row=`| 2025年：交通运输设备及电气制造业 | 648,645,636,000.00 | 515,762,940,000.00 | 20.49% | 5.06% | 7.53% | -1.82% [${source}@paragraph:843] [${source}@paragraph:844] [${source}@paragraph:833] [${source}@paragraph:839] | | 报告及单位 | 完整分类表头定位 |`
  const input=`| 报告期/分类 | 收入 | 成本 | 毛利率 | 收入同比 | 成本同比 | 毛利率同比 |\n|---|---:|---:|---:|---:|---:|---:|\n${row}\n|---|---|\n| 2025年年报；人民币元，同比列为% | [${source}@paragraph:833] [${source}@paragraph:839] |`
  const repaired=repairCompanyResearchMarkdownTables(input)
  assert.ok(repaired.repairs.some(item=>item.startsWith('TABLE_EMBEDDED_REFERENCE_HEADER_SPLIT')))
  assert.deepEqual(repaired.diagnostics,[])
  assert.deepEqual(validateCompanyResearchMarkdownTables(repaired.markdown),[])
  for(const ref of [`${source}@paragraph:843`,`${source}@paragraph:844`,`${source}@paragraph:833`,`${source}@paragraph:839`])assert.ok(repaired.markdown.includes(`[${ref}]`))
})

test('table repair splits only uniquely sized concatenated rows and detaches a heading tail', () => {
  const source = 'peer'
  const input = `| 竞争维度 | 已披露情况 | 边界 | 来源 |\n|---|---|---|---|\n| 公司A | 路线A | 待核验 | 年报 [${source}@paragraph:1] | | 公司B | 路线B | 待核验 | 年报 [${source}@paragraph:2] | | 公司C | 路线C | 待核验 | 年报 [${source}@paragraph:3] ## 优势持续条件与最强反证\n说明文字保留在表格之后。`
  const before = [...input.matchAll(/\[[^\]]+\]/gu)].map(match => match[0])
  const repaired = repairCompanyResearchMarkdownTables(input)
  assert.ok(repaired.repairs.some(item => item.startsWith('TABLE_CONCATENATED_ROWS_SPLIT')))
  assert.deepEqual(repaired.diagnostics, [])
  assert.deepEqual(validateCompanyResearchMarkdownTables(repaired.markdown), [])
  assert.match(repaired.markdown, /\| 公司A \|[\s\S]*\n\| 公司B \|[\s\S]*\n\| 公司C \|/u)
  assert.match(repaired.markdown, /\n## 优势持续条件与最强反证\n说明文字保留/u)
  assert.deepEqual([...repaired.markdown.matchAll(/\[[^\]]+\]/gu)].map(match => match[0]), before)

  const wrongWidth = `| A | B | C | D |\n|---|---|---|---|\n| 1 | 2 | 3 | 4 | | 5 | 6 | 7 | |`
  const wrongWidthResult = repairCompanyResearchMarkdownTables(wrongWidth)
  assert.equal(wrongWidthResult.markdown, wrongWidth)
  assert.ok(!wrongWidthResult.repairs.some(item => item.startsWith('TABLE_CONCATENATED_ROWS_SPLIT')))
  assert.ok(validateCompanyResearchMarkdownTables(wrongWidthResult.markdown).length > 0)

  const ambiguousCell = `| A | B | C | D |\n|---|---|---|---|\n| 1 | literal | | text | 4 | | 5 | 6 | 7 | 8 |`
  const ambiguousResult = repairCompanyResearchMarkdownTables(ambiguousCell)
  assert.equal(ambiguousResult.markdown, ambiguousCell)
  assert.ok(!ambiguousResult.repairs.some(item => item.startsWith('TABLE_CONCATENATED_ROWS_SPLIT')))
  assert.ok(validateCompanyResearchMarkdownTables(ambiguousResult.markdown).length > 0)
})

test('market matrix preserves an exact orphan PCB label outside a complete four-column table',()=>{
  const input=`| 市场 | 产品边界与排除项 | 地域、客户与时间边界 | 产业链位置与需求因素 |
|---|---|---|---|
| PCB/电子电路
| 数通光模块 | 全球数通光模块为数据通信细分市场。[peer@paragraph:1] | 全球预测，年份见报告。[peer@paragraph:2] | AI算力投资为需求因素。[peer@paragraph:3] |`
  const repaired=repairCompanyResearchMarkdownTables(input)
  assert.ok(repaired.repairs.some(item=>item.startsWith('TABLE_MARKET_MATRIX_ORPHAN_LABEL_MOVED_TO_PROSE')))
  assert.match(repaired.markdown,/PCB\/电子电路\n\n\| 市场 \| 产品边界与排除项/u)
  assert.ok(repaired.markdown.includes('| 数通光模块 | 全球数通光模块为数据通信细分市场。[peer@paragraph:1]'))
  assert.deepEqual(repaired.diagnostics,[])
  assert.deepEqual(validateCompanyResearchMarkdownTables(repaired.markdown),[])
})

test('R144 removes only an orphan separator whose following rows have inconsistent widths', () => {
  const fallback = `### 商业模式与收入来源\n| 产品收入类别 | 本期收入 | 占比 |\n|---|---:|---:|\n| 手机部件 | 155 | 19% |\n| 汽车相关 | 648 | 81% |\n表头口径说明及收入分类边界。[p0@paragraph:1] 谁有付款方 购买内容 收入机制\n|---|---|---|\n| 客户身份未在所给材料中具体说明 | 汽车及电子产品 | 商品销售对价 |\n| 直销或经销渠道的买方 | 渠道收入 | 未披露合同细节 | 收入确认政策按商品控制权转移。[p1@paragraph:2]\n| 销售方式 | 本期收入 | 占比 |\n|---|---:|---:|\n| 直销 | 367 | 46% |\n| 经销 | 436 | 54% |`
  const artifactPath = 'runtime-data/company-quality-acceptance/R144-byd/002594-report.json'
  let fixture = fallback
  if (existsSync(artifactPath)) {
    const report = JSON.parse(readFileSync(artifactPath, 'utf8')) as { sections?: Array<{ id: string; markdown: string }> }
    fixture = report.sections?.find(section => section.id === 'business-model')?.markdown ?? fallback
  }
  const locator = /\[[A-Za-z0-9._:-]+@paragraph:\d+\]/gu
  const before = [...fixture.matchAll(locator)].map(match => match[0])
  const repaired = repairCompanyResearchMarkdownTables(fixture)
  assert.ok(repaired.repairs.some(repair => repair.startsWith('TABLE_ORPHAN_SEPARATOR_REMOVED')))
  assert.deepEqual(repaired.diagnostics, [])
  assert.deepEqual(validateCompanyResearchMarkdownTables(repaired.markdown), [])
  assert.deepEqual([...repaired.markdown.matchAll(locator)].map(match => match[0]), before, 'citation locators retain original order')
  for (const text of ['客户身份未在所给材料中具体说明', '直销或经销渠道的买方', '收入确认政策', '销售方式', '|---|---:|---:|']) assert.ok(repaired.markdown.includes(text), `preserves ${text}`)

  const plausible = repairCompanyResearchMarkdownTables(`Narrative before unknown table.\n|---|---|\n| A | B |\n| C | D |`)
  assert.ok(!plausible.repairs.some(repair => repair.startsWith('TABLE_ORPHAN_SEPARATOR_REMOVED')))
  assert.ok(validateCompanyResearchMarkdownTables(plausible.markdown).some(error => error.includes('no adjacent header row')), 'consistent unknown table remains fail-closed')
})

test('R146 separates inline section headings from body text without touching tables or code fences', () => {
  const fallback = `## 收入、利润与成本传导 ### 合并表现及归因边界 2026年半年度报告披露本报告期营业收入下降。[r1@paragraph:1] 后续贡献未能量化。 ### 分行业表的收入、成本与毛利率变化 行业成本增长快于收入。[r2@paragraph:2]\n\n| 指标 | 说明 |\n|---|---|\n| literal ## table cell | 该单元格保留 ## 标记 |\n\n\`\`\`md\n## literal code heading body\n\`\`\``
  const artifactPath = 'runtime-data/company-quality-acceptance/R146-byd/002594-report.json'
  let fixture = fallback
  if (existsSync(artifactPath)) {
    const report = JSON.parse(readFileSync(artifactPath, 'utf8')) as { sections?: Array<{ id: string; markdown: string }> }
    fixture = report.sections?.find(section => section.id === 'revenue-profit-drivers')?.markdown ?? fallback
  }
  const locator = /\[[A-Za-z0-9._:-]+@paragraph:\d+\]/gu
  const before = [...fixture.matchAll(locator)].map(match => match[0])
  const repaired = repairCompanyResearchMarkdownTables(fixture)
  assert.ok(repaired.repairs.some(repair => repair.startsWith('INLINE_HEADING_BOUNDARIES_NORMALIZED')))
  assert.deepEqual(repaired.diagnostics, [])
  assert.deepEqual(validateCompanyResearchMarkdownTables(repaired.markdown), [])
  assert.deepEqual([...repaired.markdown.matchAll(locator)].map(match => match[0]), before, 'citation locators retain exact order')
  assert.equal(fixture.replace(/\s/gu, ''), repaired.markdown.replace(/\s/gu, ''), 'normalization changes only whitespace boundaries')
  assert.match(repaired.markdown, /^## 收入、利润与成本传导$/m)
  assert.match(repaired.markdown, /^### 合并表现及归因边界$/m)
  const originalBody = fixture.match(/2026年[^#]+/u)?.[0]?.trim()
  assert.ok(originalBody && repaired.markdown.includes(originalBody), 'body wording is retained exactly while heading whitespace is normalized')
  assert.match(repaired.markdown, /^### 分行业表的收入、成本与毛利率变化$/m)
  const protectedFixture = repairCompanyResearchMarkdownTables(fallback)
  assert.ok(protectedFixture.markdown.includes('| literal ## table cell | 该单元格保留 ## 标记 |'))
  assert.ok(protectedFixture.markdown.includes('```md\n## literal code heading body\n```'))
})

test('R147 reattaches a displaced industry-scale header to its uniquely matching orphan table', () => {
  const fixture = `| 市场 | 产品与纳入边界 | 地域与客户 | 时间口径及产业链角色 |
|---|---|---|---|
| 汽车及新能源汽车 | 整车市场 | 中国及境外 | 年度销量 |
| 手机部件及组装 | 部件和组装 | 未充分披露 | 年报分类收入 |
| AI服务器及数据中心液冷 | 相邻市场背景 | 全球行业预测 | 不等同公司TAM |
| 市场边界 | 规模与时间 | 币种/单位 | 预测机构及来源归属 | 解释限制 |
汽车行业需求有官方销量统计支撑，统计销量不是市场金额或公司可服务市场。[auto@paragraph:18]

## 行业规模背景

下列数字保留原市场边界，不相加。
|---|---|---|---|---|
| 中国新能源汽车年度销量 | 2024年全年销量：1,286.6 | 万辆 | 比亚迪年报披露 | 不是收入、金额市场或公司TAM。[byd@paragraph:448] |
| 全球AI服务器市场 | 2025年预测规模：1,672 | 亿美元 | 年报转述 | 相邻行业预测。[byd@paragraph:450] |
| 全球数据中心液冷市场 | 2025年预测规模：28.4 | 亿美元 | 年报转述 | 不等于公司业务规模。[byd@paragraph:451] |`
  const before = [...fixture.matchAll(/\[[^\]]+@paragraph:\d+\]/g)].map(match => match[0])
  const repaired = repairCompanyResearchMarkdownTables(fixture)
  assert.deepEqual(repaired.diagnostics, [])
  assert.ok(repaired.repairs.some(repair => repair.startsWith('TABLE_DISPLACED_HEADER_REATTACHED')))
  assert.deepEqual(validateCompanyResearchMarkdownTables(repaired.markdown), [])
  assert.match(repaired.markdown, /汽车及新能源汽车 \| 整车市场/)
  assert.match(repaired.markdown, /解释限制 \|\n\|---\|---\|---\|---\|---\|\n\| 中国新能源汽车年度销量/)
  assert.deepEqual([...repaired.markdown.matchAll(/\[[^\]]+@paragraph:\d+\]/g)].map(match => match[0]), before)
})

test('R149 reattaches the displaced five-column company-TAM market header without moving narrative', () => {
  const fixture = `| 市场 | 产品边界 | 地域与客户 | 时间口径与限制 | 产业链角色 |
|---|---|---|---|---|
| 新能源汽车行业背景 | 整车销量，不等同公司TAM | 中国 | 2024全年 | 行业需求 |
| 市场边界 | 期间 | 规模与单位 | 来源及转述归属 | 与某公司TAM的关系 |
汽车行业需求有官方销量统计支撑，统计销量不是市场金额或公司可服务市场。[auto@paragraph:18]

## 行业规模背景

下列数字保留原市场边界，不相加。
|---|---|---|---|---|
| 中国新能源汽车全年销量 | 2024全年 | 1,286.6万辆 | 年报转述[byd@paragraph:18] | 历史行业背景，不是公司TAM |
| 全球AI服务器市场 | 2025年预测 | 1,672亿美元 | 年报转述[byd@paragraph:448] | 相邻市场，不适用于汽车 |
| 全球数据中心液冷市场 | 2025年预测 | 28.4亿美元 | 年报转述[byd@paragraph:450] | 相邻市场，不适用于汽车 |`
  const before = [...fixture.matchAll(/\[[^\]]+@paragraph:\d+\]/g)].map(match => match[0])
  const repaired = repairCompanyResearchMarkdownTables(fixture)
  assert.ok(repaired.repairs.some(repair => repair.startsWith('TABLE_ADJACENT_MARKET_HEADER_REATTACHED')))
  assert.deepEqual(repaired.diagnostics, [])
  assert.deepEqual(validateCompanyResearchMarkdownTables(repaired.markdown), [])
  assert.match(repaired.markdown, /与某公司TAM的关系 \|\n\|---\|---\|---\|---\|---\|\n\| 中国新能源汽车全年销量/)
  assert.match(repaired.markdown, /汽车行业需求有官方销量统计支撑[\s\S]*?## 行业规模背景/)
  assert.deepEqual([...repaired.markdown.matchAll(/\[[^\]]+@paragraph:\d+\]/g)].map(match => match[0]), before)
})

test('R150 reattaches the unique Dongshan disclosure-dimension header to its cited sales rows', () => {
  const fixture = `## 商业模式
### 最新完整年度产品收入结构
| 2025年产品分类 | 收入金额（人民币元） | 占营业收入比重 |
|---|---:|---:|
| 电子电路产品 | 25,620,292,915.99 | 63.85%[annual@paragraph:873] |
| 光电显示模组 | 5,985,629,058.48 | 14.92%[annual@paragraph:874] |
| 其他 | 1,153,159,447.10 | 2.87%[annual@paragraph:877] |
| 2025年披露维度 | 金额（人民币元） | 占营业收入比重 |
电子电路是最大产品收入类别。[annual@paragraph:873]

### 客户、销售方式与收入确认
公司按地区披露内销和外销，销售模式为直销；地区与销售模式是不同维度。[annual@paragraph:881]
|---|---:|---:|
| 地区：内销 | 7,459,672,435.12 | 18.59%[annual@paragraph:879] |
| 地区：外销 | 32,665,186,404.40 | 81.41%[annual@paragraph:880] |
| 销售模式：直销 | 40,124,858,839.52 | 100.00%[annual@paragraph:882] |

## 业务分部`
  const before = [...fixture.matchAll(/\[[^\]]+@paragraph:\d+\]/g)].map(match => match[0])
  const repaired = repairCompanyResearchMarkdownTables(fixture)
  assert.ok(repaired.repairs.some(repair => repair.startsWith('TABLE_BUSINESS_MODEL_DISCLOSURE_HEADER_REATTACHED')))
  assert.deepEqual(repaired.diagnostics, [])
  assert.deepEqual(validateCompanyResearchMarkdownTables(repaired.markdown), [])
  assert.match(repaired.markdown, /客户、销售方式与收入确认\n公司按地区披露[\s\S]*?\n\| 2025年披露维度 \| 金额（人民币元） \| 占营业收入比重 \|\n\|---\|---:\|---:\|\n\| 地区：内销/)
  assert.deepEqual([...repaired.markdown.matchAll(/\[[^\]]+@paragraph:\d+\]/g)].map(match => match[0]), before)

  const ambiguous = repairCompanyResearchMarkdownTables(fixture.replace('销售模式：直销', '销售方式：直销'))
  assert.ok(!ambiguous.repairs.some(repair => repair.startsWith('TABLE_BUSINESS_MODEL_DISCLOSURE_HEADER_REATTACHED')))
  assert.ok(validateCompanyResearchMarkdownTables(ambiguous.markdown).some(issue => issue.includes('separator')))
})

test('R148 restores the exact industry citation table header when synthesis leaves a prose header above a separator',()=>{
  const fixture=`适用报告与期间 完整表头（单位：元；末列原单位为%） 分类标签及匹配数据行\n|---|---|---|\n| 2025年年度报告，2025年度 | 单位与表头定位 | 分类标签与数据行定位 |`
  const repaired=repairCompanyResearchMarkdownTables(fixture)
  assert.ok(repaired.repairs.some(item=>item.startsWith('TABLE_INDUSTRY_EVIDENCE_HEADER_RESTORED')))
  assert.match(repaired.markdown,/\| 适用报告与期间 \| 完整表头（单位：元；末列原单位为%） \| 分类标签及匹配数据行 \|\n\|---\|---\|---\|/)
  assert.deepEqual(validateCompanyResearchMarkdownTables(repaired.markdown),[])
  const unknown=repairCompanyResearchMarkdownTables(`Unknown header\n|---|---|---|\n| 2025年年度报告 | A | B |`)
  assert.ok(validateCompanyResearchMarkdownTables(unknown.markdown).length>0)
})

test('R149 restores the fixed four-column industry size header only for its exact three-row summary',()=>{
  const fixture=`中国新能源汽车销量提供历史行业规模背景；AI服务器和数据中心液冷为邻接市场，不与公司收入相加。\n|---|---|---|---|\n| 中国新能源汽车全年销量 | 2024年 | 1,286.6万辆 | 历史行业销量 |\n| 全球AI服务器市场 | 2025年 | 1,672亿美元 | 年报转述预测 |\n| 全球数据中心液冷市场 | 2025年 | 28.4亿美元 | 年报转述预测 |`
  const repaired=repairCompanyResearchMarkdownTables(fixture)
  assert.ok(repaired.repairs.some(item=>item.startsWith('TABLE_INDUSTRY_SIZE_HEADER_RESTORED')))
  assert.match(repaired.markdown,/\| 市场背景指标 \| 期间 \| 报告数值 \| 来源、边界及限制 \|\n\|---\|---\|---\|---\|/)
  assert.deepEqual(validateCompanyResearchMarkdownTables(repaired.markdown),[])
  const unknown=repairCompanyResearchMarkdownTables(`|---|---|---|---|\n| 市场A | 2025 | 10 | 来源 |`)
  assert.ok(validateCompanyResearchMarkdownTables(unknown.markdown).length>0)
})

test('same-width industry forecast header is moved past narrative to the table under its heading', () => {
  const fixture = `| 市场/分类 | 产品边界与产业链位置 | 地区、客户与期间边界 | 证据及限制 |
|---|---|---|---|
| PCB | 板件制造 | 未按客户细分 | 公司披露 |
| 光模块 | 高速连接 | 全球预测 | 不等于TAM |
| 市场边界 | 预测值 | 预测机构及归属 | 可比性说明 |

公司经营端按客户订单组织生产，且未交叉披露产品、终端和地区。[annual@paragraph:1]

### 行业规模背景

以下行业数字仅为背景，不代表公司TAM。
|---|---|---|---|
| 全球PCB市场 | 2026年958亿美元 | Prismark转述 | 仅为PCB市场。[annual@paragraph:2] |
| 全球服务器及存储市场 | 2025年4130亿美元；2030年6300亿美元 | 年报转述 | 不是公司TAM。[annual@paragraph:3] |
| 全球数通光模块 | 2026年228亿美元 | LightCounting转述 | 相邻市场。[annual@paragraph:4] |`
  const repaired = repairCompanyResearchMarkdownTables(fixture)
  assert.ok(repaired.repairs.some(repair => repair.startsWith('TABLE_INDUSTRY_FORECAST_HEADER_REATTACHED')))
  assert.deepEqual(repaired.diagnostics, [])
  assert.deepEqual(validateCompanyResearchMarkdownTables(repaired.markdown), [])
  assert.match(repaired.markdown, /### 行业规模背景\n\n以下行业数字仅为背景，不代表公司TAM。\n\| 市场边界 \| 预测值 \| 预测机构及归属 \| 可比性说明 \|\n\|---\|---\|---\|---\|/)
})

test('same-width market scale header is moved out of the boundary table when its separator sits below the forecast heading', () => {
  const fixture = `## 边界、客户与产业链
| 市场/业务 | 产品边界 | 地域边界 | 客户边界 | 价值链与限制 |
|---|---|---|---|---|
| 汽车 | 整车与部件 | 全球 | 个人及商用 | 不将部件与整车相加 |
| 电子 | 精密制造 | 全球 | 品牌客户 | 不等同终端设备市场 |
| 市场边界 | 期间 | 规模与单位 | 来源及转述归属 | 可比性/适用限制 |

时间边界：市场规模采用来源明确给出的统计期或预测期。

## 行业规模背景

|---|---|---|---|---|
| 中国新能源汽车销量 | 2024全年 | 1,286.6万辆 | 年报转述统计 | 历史行业销量，不是公司TAM |
| 全球AI服务器市场 | 2025预测 | 1,672亿美元 | 年报转述Market Insights | 相邻市场，不是公司TAM |`
  const repaired = repairCompanyResearchMarkdownTables(fixture)
  assert.ok(repaired.repairs.some(repair => repair.startsWith('TABLE_SAME_WIDTH_INDUSTRY_FORECAST_HEADER_REATTACHED')))
  assert.deepEqual(repaired.diagnostics, [])
  assert.deepEqual(validateCompanyResearchMarkdownTables(repaired.markdown), [])
  assert.match(repaired.markdown, /## 行业规模背景\n\n\| 市场边界 \| 期间 \| 规模与单位 \| 来源及转述归属 \| 可比性\/适用限制 \|\n\|---\|---\|---\|---\|---\|/)
})

test('reattaches the real R189 industry forecast header using the disclosed institution conjunction', () => {
  const fixture = `### 市场边界与价值链
| 市场/链条 | 产品与地域边界 | 客户及需求场景 | 公司价值链位置与边界限制 |
|---|---|---|---|
| PCB | 板件制造 | 电子设备 | 部件制造 |
| 光模块 | 数通与电信 | 数据中心 | 部件制造 |
| 市场边界 | 预测值与期间 | 机构与归属 | 可比性说明 |
上述客户用途和产业链边界是结构性归纳，并非订单分配。[annual@paragraph:454]

### 行业规模背景
下列数字均为行业背景，不是公司TAM。[annual@paragraph:556]
|---|---|---|---|
| 全球PCB产业产值 | 2026年958亿美元 | Prismark预测，由公司年报转述 | 不代表公司可服务市场。[annual@paragraph:557] |
| 全球数通光模块 | 2026年228亿美元 | LightCounting预测，由公司年报转述 | 不代表公司可获取份额。[annual@paragraph:574] |
| 全球电信光模块 | 2026年53亿美元 | LightCounting预测，由公司年报转述 | 与PCB市场不相加。[annual@paragraph:576] |`
  const repaired = repairCompanyResearchMarkdownTables(fixture)
  assert.ok(repaired.repairs.some(repair => repair.startsWith('TABLE_INDUSTRY_FORECAST_HEADER_REATTACHED')))
  assert.deepEqual(repaired.diagnostics, [])
  assert.deepEqual(validateCompanyResearchMarkdownTables(repaired.markdown), [])
  assert.match(repaired.markdown, /### 行业规模背景\n下列数字[^\n]+\n\| 市场边界 \| 预测值与期间 \| 机构与归属 \| 可比性说明 \|\n\|---\|---\|---\|---\|/)
})

test('reattaches a displaced capital-expenditure header without keeping it as an R&D data row', () => {
  const fixture = `## 管理层、治理与资本配置
### 资本配置台账与评价
### 研发
| 行动 | 金额 | 目的 | 评价 |
|---|---|---|---|
| 年度研发投入 | 2025年金额 | 技术研发 | 尚未验证回报 |
| 最新累计研发费用 | 半年度金额 | 口径不同 | 不作趋势判断 |
| 行动与期间 | 金额/指标 | 目的与资金覆盖 | 后续结果及限制 |
研发项目没有单独披露商业化回报。[annual@paragraph:10]

### 资本开支与流动性
|---|---|---|---|
| 2026年上半年累计资本开支 | 购建长期资产52.53亿元 | 经营现金23.84亿元 | 简化差额为负，不年化。[annual@paragraph:11] |
| 扩产建设 | 在建工程期末45.14亿元 | 光模块和AI PCB扩产 | 未披露利用率。[annual@paragraph:12] |`
  const repaired = repairCompanyResearchMarkdownTables(fixture)
  assert.ok(repaired.repairs.some(repair => repair.startsWith('TABLE_CAPITAL_EXPENDITURE_HEADER_REATTACHED')))
  assert.deepEqual(repaired.diagnostics, [])
  assert.deepEqual(validateCompanyResearchMarkdownTables(repaired.markdown), [])
  assert.match(repaired.markdown, /### 资本开支与流动性\n\| 行动与期间 \| 金额\/指标 \| 目的与资金覆盖 \| 后续结果及限制 \|\n\|---\|---\|---\|---\|/)
  assert.doesNotMatch(repaired.markdown.split('### 资本开支与流动性')[0]!, /\| 行动与期间 \| 金额\/指标 \|/)
})

test('table repair splits an inline section heading from the next table while retaining cited table header context', () => {
  const businessSegments = `## 业务分部与收入切片 年报产品分类说明。[scope@paragraph:1] | 分产品 | 2025年营业收入（元） | 占营业收入比重 | 2025年产品毛利率 | [filing@paragraph:845]
|---|---:|---:|---:|
| 汽车相关产品 | 648 | 80% | 20% |`
  const repaired = repairCompanyResearchMarkdownTables(businessSegments)
  assert.deepEqual(repaired.diagnostics, [])
  assert.deepEqual(validateCompanyResearchMarkdownTables(repaired.markdown), [])
  assert.match(repaired.markdown, /年报产品分类说明。\[scope@paragraph:1\] \[filing@paragraph:845\]\n\| 分产品 \| 2025年营业收入（元） \| 占营业收入比重 \| 2025年产品毛利率 \|/)

  const industryExposure = `| 市场 | 产品边界 | 客户 | 价值链限制 |
|---|---|---|---|
| 新能源汽车 | 整车 | 消费者 | 不等于电池市场 |
| 电子部件 | 部件 | 终端未披露 | 不等于整机市场 |
| 轨道交通 | 城市交通 | 城市项目 | 不等于汽车市场 | ## 行业规模背景
| 市场 | 期间 | 规模 | 归属 |
|---|---|---|---|
| 新能源汽车销量 | 2024年 | 1,286.6万辆 | 年报转述 |`
  const repairedIndustry = repairCompanyResearchMarkdownTables(industryExposure)
  assert.deepEqual(repairedIndustry.diagnostics, [])
  assert.deepEqual(validateCompanyResearchMarkdownTables(repairedIndustry.markdown), [])
  assert.match(repairedIndustry.markdown, /轨道交通 \| 城市交通 \| 城市项目 \| 不等于汽车市场 \|\n## 行业规模背景\n\| 市场 \| 期间 \| 规模 \| 归属 \|/)

  const boldForecastHeading = `| 市场 | 产品边界 | 地域、客户及时间边界 | 产业链角色与需求证据 |
|---|---|---|---|
| 新能源汽车 | 车辆 | 中国年度销量 | 公司制造；不代表市场份额。 [annual@paragraph:18] |
| 电子器件 | 手机部件 | 地域未披露 | 公司制造；终端用途未披露。 [annual@paragraph:718] | **行业规模背景**
| 市场边界 | 期间 | 规模及单位 | 来源归属 | 适用边界 |
|---|---|---|---|---|
| 中国新能源汽车销量 | 2024全年 | 1,286.6万辆 | 年报转述 [annual@paragraph:18] | 不等于公司销量 |`
  const repairedBoldForecast = repairCompanyResearchMarkdownTables(boldForecastHeading)
  assert.deepEqual(repairedBoldForecast.diagnostics, [])
  assert.deepEqual(validateCompanyResearchMarkdownTables(repairedBoldForecast.markdown), [])
  assert.match(repairedBoldForecast.markdown, /电子器件 \| 手机部件 \| 地域未披露 \| 公司制造；终端用途未披露。 \[annual@paragraph:718\] \|\n## 行业规模背景\n\| 市场边界 \| 期间 \| 规模及单位 \| 来源归属 \| 适用边界 \|/)
})

test('table repair reattaches the cited adjacent-market header after intervening industry narrative', () => {
  const fixture = `| 市场边界 | 预测期间 | 规模与单位 | 预测机构及来源归属 |
上述市场之间产品边界不同，不应相加为一个TAM。[scope@paragraph:1]

### 需求与行业规模背景
中国新能源汽车销量增长，但该数据不等于公司可服务市场。[industry@paragraph:2]
**相邻市场预测（仅作AI基础设施背景）**
|---|---|---|---|
| 全球AI服务器市场 | 二零二五年 | 1,672亿美元 | Market Insights预测；属于AI基础设施，不是汽车市场。[annual@paragraph:448] |
| 全球数据中心液冷市场 | 二零二五年 | 28.4亿美元 | MarketsandMarkets预测；不等于公司液冷产品可服务市场。[annual@paragraph:450] |
这些预测不代表公司份额或收入预测。[scope@paragraph:3]`

  const repaired = repairCompanyResearchMarkdownTables(fixture)
  assert.ok(repaired.repairs.some(repair => repair.startsWith('TABLE_ADJACENT_MARKET_HEADER_REATTACHED')))
  assert.deepEqual(repaired.diagnostics, [])
  assert.deepEqual(validateCompanyResearchMarkdownTables(repaired.markdown), [])
  assert.match(repaired.markdown, /上述市场之间产品边界不同，不应相加为一个TAM。\[scope@paragraph:1\]\n\n### 需求与行业规模背景/)
  assert.match(repaired.markdown, /\*\*相邻市场预测（仅作AI基础设施背景）\*\*\n\| 市场边界 \| 预测期间 \| 规模与单位 \| 预测机构及来源归属 \|\n\|---\|---\|---\|---\|\n\| 全球AI服务器市场/)
  assert.match(repaired.markdown, /这些预测不代表公司份额或收入预测。\[scope@paragraph:3\]/)
})

test('table repair reattaches the industry-scale header only when the following cited paragraph supports its rows', () => {
  const header = '| 市场边界 | 期间 | 数值及单位 | 来源与可比边界 |'
  const rows = `| 中国新能源汽车全年销量，历史行业销量，不是金额规模 | 2024全年 | 1,286.6万辆 | 比亚迪年报转述的行业统计；销量不能代表公司可服务市场或TAM。 |
| 全球AI服务器市场规模，AI基础设施相邻市场 | 2025年 | 1,672亿美元 | 年报转述的市场预测；不是比亚迪可服务市场。 |
| 全球数据中心液冷市场规模，AI基础设施相邻市场 | 2025年 | 28.4亿美元 | 年报转述的市场预测；不等于公司产品可服务市场。 |`
  const supported = `${header}\n公司垂直整合跨越多个环节，简单相加会重复计算，不能据此构造TAM。[web@paragraph:115]\n\n### 行业规模背景\n|---|---|---|---|\n${rows}\n上述数据分别来自行业统计及年报转述，口径均不等同于公司TAM。[annual@paragraph:18] [annual@paragraph:448] [annual@paragraph:450]`
  const repaired = repairCompanyResearchMarkdownTables(supported)
  assert.ok(repaired.repairs.some(repair => repair.startsWith('TABLE_ADJACENT_MARKET_HEADER_REATTACHED')))
  assert.deepEqual(repaired.diagnostics, [])
  assert.deepEqual(validateCompanyResearchMarkdownTables(repaired.markdown), [])
  assert.match(repaired.markdown, /公司垂直整合跨越多个环节，简单相加会重复计算，不能据此构造TAM。\[web@paragraph:115\]\n\n### 行业规模背景\n\| 市场边界 \| 期间 \| 数值及单位 \| 来源与可比边界 \|\n\|---\|---\|---\|---\|\n\| 中国新能源汽车/)
  assert.match(repaired.markdown, /上述数据分别来自行业统计及年报转述，口径均不等同于公司TAM。\[annual@paragraph:18\] \[annual@paragraph:448\] \[annual@paragraph:450\]/)

  const actualReportVariant = supported.replace(header, '| 市场边界与统计性质 | 期间 | 数值及单位 | 来源与可比边界 |')
  const actualRepaired = repairCompanyResearchMarkdownTables(actualReportVariant)
  assert.ok(actualRepaired.repairs.some(repair => repair.startsWith('TABLE_ADJACENT_MARKET_HEADER_REATTACHED')))
  assert.deepEqual(validateCompanyResearchMarkdownTables(actualRepaired.markdown), [])

  const unsupported = repairCompanyResearchMarkdownTables(supported.replace('[annual@paragraph:448] [annual@paragraph:450]', '[annual@paragraph:448]'))
  assert.deepEqual(unsupported.repairs, [])
  assert.ok(validateCompanyResearchMarkdownTables(unsupported.markdown).some(issue => issue.includes('separator')))
})

test('table repair reattaches the cited 2026 interim industry-scale header variant', () => {
  const fixture = `| 市场边界 | 期间 | 规模与单位 | 来源及转述归属 |
边界解释仍保留在行业规模背景之前。[scope@paragraph:1]

## 行业规模背景
|---|---|---|---|
| 全球PCB市场 | 2026 | 958亿美元 | Prismark预测，由年报转述；不是公司TAM。[annual@paragraph:556] |
| 全球数据通信光模块市场 | 2026 | 228亿美元 | LightCounting预测，由年报转述；不是公司TAM。[annual@paragraph:574] |`

  const repaired = repairCompanyResearchMarkdownTables(fixture)
  assert.ok(repaired.repairs.some(repair => repair.startsWith('TABLE_ADJACENT_MARKET_HEADER_REATTACHED')))
  assert.deepEqual(repaired.diagnostics, [])
  assert.deepEqual(validateCompanyResearchMarkdownTables(repaired.markdown), [])
  assert.match(repaired.markdown, /## 行业规模背景\n\| 市场边界 \| 期间 \| 规模与单位 \| 来源及转述归属 \|\n\|---\|---\|---\|---\|\n\| 全球PCB市场/)
})

test('table repair reattaches BYD five-column market-scale header', () => {
  const header = '| 市场边界 | 期间 | 规模与单位 | 来源及转述归属 | 可比性说明 |'
  const fixture = `${header}\n公司业务不构成单一可服务市场。[scope@paragraph:1]\n\n## 行业规模背景\n|---|---|---|---|---|\n| 全球AI服务器市场 | 2025年预测 | 1,672亿美元 | 年报转述行业预测。[annual@paragraph:448] | 相邻市场背景，不是公司TAM。 |\n| 全球数据中心液冷市场 | 2025年预测 | 28.4亿美元 | 年报转述行业预测。[annual@paragraph:450] | 不代表公司收入机会。 |`
  const repaired = repairCompanyResearchMarkdownTables(fixture)
  assert.ok(repaired.repairs.some(repair => repair.startsWith('TABLE_ADJACENT_MARKET_HEADER_REATTACHED')))
  assert.deepEqual(repaired.diagnostics, [])
  assert.deepEqual(validateCompanyResearchMarkdownTables(repaired.markdown), [])
})

test('table repair reattaches BYD five-column market-scale header with applicability limits', () => {
  const fixture = '| 市场边界 | 期间 | 规模与单位 | 来源及转述归属 | 适用范围与限制 |\n说明文本。[scope@paragraph:1]\n\n### 行业规模背景\n|---|---|---|---|---|\n| 中国新能源汽车全年销量 | 2024全年 | 1,286.6万辆 | 年报转述统计。[annual@paragraph:18] | 历史销量，不是公司TAM。 |\n| 全球AI服务器市场 | 2025年预测 | 1,672亿美元 | 年报转述预测。[annual@paragraph:448] | 相邻市场背景。 |'
  const repaired = repairCompanyResearchMarkdownTables(fixture)
  assert.ok(repaired.repairs.some(repair => repair.startsWith('TABLE_ADJACENT_MARKET_HEADER_REATTACHED')))
  assert.deepEqual(repaired.diagnostics, [])
  assert.deepEqual(validateCompanyResearchMarkdownTables(repaired.markdown), [])
})

test('table repair splits only an exact cited 7+1+7 financial row and next table header fusion', () => {
  const columns = ['营业收入（元）', '营业成本（元）', '毛利率', '营业收入比上年同期增减', '营业成本比上年同期增减', '毛利率比上年同期增减']
  const priorHeader = ['2024年度分行业分类', ...columns]
  const productHeader = ['2024年度分产品分类', ...columns]
  const priorRow = ['交通运输设备及电气制造业', '617,381,935,000.00', '479,660,859,000.00', '22.31%', '27.70%', '25.62%', '1.29% [annual@paragraph:720]']
  const productRow = ['汽车、汽车相关产品及其他产品', '617,381,935,000.00', '479,660,859,000.00', '22.31%', '27.70%', '25.62%', '1.29% [annual@paragraph:725]']
  const joined = `| ${[...priorRow, '2024年度分产品标签与匹配数据分别列示：[annual@paragraph:722] [annual@paragraph:723]', ...productHeader].join(' | ')} |
|---|---|---|---|---|---|---|
| ${productRow.join(' | ')} |`
  const fixture = `| ${priorHeader.join(' | ')} |
|---|---|---|---|---|---|---|
${joined}`
  const repaired = repairCompanyResearchMarkdownTables(fixture)
  assert.ok(repaired.repairs.some(repair => repair.startsWith('TABLE_FINANCIAL_HEADER_DETACHED_FROM_PRIOR_ROW')))
  assert.deepEqual(repaired.diagnostics, [])
  assert.deepEqual(validateCompanyResearchMarkdownTables(repaired.markdown), [])
  assert.match(repaired.markdown, /\| 交通运输设备及电气制造业 \| 617,381,935,000\.00 \| 479,660,859,000\.00 \| 22\.31% \| 27\.70% \| 25\.62% \| 1\.29% \[annual@paragraph:720\] \|\n2024年度分产品标签与匹配数据分别列示： ?\[annual@paragraph:722\] \[annual@paragraph:723\]\n\| 2024年度分产品分类 \|/)
  assert.match(repaired.markdown, /\| 2024年度分产品分类 \| 营业收入（元） \| 营业成本（元） \| 毛利率 \| 营业收入比上年同期增减 \| 营业成本比上年同期增减 \| 毛利率比上年同期增减 \|\n\|---\|---\|---\|---\|---\|---\|---\|\n\| 汽车、汽车相关产品及其他产品/)

  const malformedCitation = repairCompanyResearchMarkdownTables(fixture.replace('[annual@paragraph:722] [annual@paragraph:723]', '[missing-locator]'))
  assert.ok(malformedCitation.repairs.every(repair => !repair.startsWith('TABLE_FINANCIAL_HEADER_DETACHED_FROM_PRIOR_ROW')))
  assert.match(malformedCitation.markdown, /\[missing-locator\]/)
  assert.ok(validateCompanyResearchMarkdownTables(malformedCitation.markdown).length > 0)
  const wrongWidth = repairCompanyResearchMarkdownTables(fixture.replace('|---|---|---|---|---|---|---|\n| 汽车', '|---|---|---|---|---|---|\n| 汽车'))
  assert.ok(wrongWidth.repairs.every(repair => !repair.startsWith('TABLE_FINANCIAL_HEADER_DETACHED_FROM_PRIOR_ROW')))
  assert.ok(validateCompanyResearchMarkdownTables(wrongWidth.markdown).length > 0)
})

test('normal nineteen-section assembly surfaces malformed tables from atomic method sections', async () => {
  const industryMethod: CompanyResearchMethodResult = {
    ...method,
    sections: [{ id: 'industry-exposure', markdown: '| ## 行业范围 | 公司关系 |\n| --- | --- |\n| PCB | 业务背景 |' }],
  }
  const result = await assembleCompanyResearch(input, [industryMethod], undefined, () => input.asOf)
  assert.equal(result.sections.length, 19)
  assert.ok(result.tableDiagnostics.some(issue => issue.includes('industry-exposure') && issue.includes('heading markup embedded in table header')))
})

test('final synthesis rejects malformed table structure and accepts a repaired attempt', async () => {
  let calls = 0
  const executor: ReasoningExecutor = { capabilities, execute: async (request) => {
    calls++
    if (calls === 2) {
      const retry = request.input as { repairInstruction: string }
      assert.match(retry.repairInstruction, /每个数据行必须与该表头列数完全一致/)
      assert.match(retry.repairInstruction, /指标\/观察项、观察频率、触发条件\/核验信号、论点关联与证据/)
      assert.match(retry.repairInstruction, /改用有引用的普通段落/)
    }
    const malformed = '| 指标 | 判断 |\n| --- | --- |\n| 客户集中 | 需跟踪 | 合并进来的标题 |\n\n有证据支持的结论 [annual@paragraph:1]'
    const repaired = '| 指标 | 判断 |\n| --- | --- |\n| 客户集中 | 需跟踪 |\n\n有证据支持的结论 [annual@paragraph:1]'
    return { operation: 'company_research_synthesis', output: { sections: ids.map(id => ({ id, markdown: id === 'investment-thesis' ? calls === 1 ? malformed : repaired : '有证据支持的结论 [annual@paragraph:1]', sourceCandidateIds: ['annual'] })) } }
  } }
  const result = await assembleCompanyResearch(input, [method], executor, () => input.asOf)
  assert.equal(calls, 2)
  assert.equal(result.synthesisMode, 'reasoning_executor', JSON.stringify(result.synthesisDiagnostics))
  assert.match(result.synthesisDiagnostics[0]!, /FORMAT_ERROR: TABLE_ERROR: row at line 3 has 3 cells; expected 2/)
  assert.match(result.sections.find(section => section.id === 'investment-thesis')!.markdown, /\| 客户集中 \| 需跟踪 \|/)
  assert.doesNotMatch(result.sections.find(section => section.id === 'investment-thesis')!.markdown, /合并进来的标题/)
})

test('final synthesis deterministically closes a cited four-column monitoring row before consuming a model retry',async()=>{
  let calls=0
  const executor:ReasoningExecutor={capabilities,execute:async request=>{
    calls++
    return {operation:request.operation,output:{sections:ids.map(id=>({id,markdown:id==='monitoring-checklist'
      ?'| 指标/观察项 | 观察频率 | 触发条件/核验信号 | 论点关联与证据 |\n|---|---|---|---|\n| 客户集中度 | 定期报告 | 核验前五客户占比。[annual@paragraph:1] |\n|'
      :'有证据支持的结论 [annual@paragraph:1]',sourceCandidateIds:['annual']}))}}
  }}
  const result=await assembleCompanyResearch(input,[method],executor,()=>input.asOf)
  const monitoring=result.sections.find(section=>section.id==='monitoring-checklist')!.markdown
  assert.equal(calls,1)
  assert.equal(result.synthesisMode,'reasoning_executor',JSON.stringify(result.synthesisDiagnostics))
  assert.ok(result.synthesisDiagnostics.some(item=>item.includes('MONITORING_ROW_FINAL_CELL_RESTORED')))
  assert.deepEqual(validateCompanyResearchMarkdownTables(monitoring),[])
  assert.match(monitoring,/核验前五客户占比。\[annual@paragraph:1\] \| 用于核验该观察项对报告核心论点的兑现/)
})

test('final synthesis accepts supplied Chinese-bracket citations and validates the resolved locator', async () => {
  const citedMethod: CompanyResearchMethodResult = { ...method, sections: [{id:'company-overview',markdown:'公司披露历史 [annual@paragraph:1]'}], executionEvidence:[{sourceCandidateId:'annual',title:'年报',publisher:'公司',excerpts:[{sourceCandidateId:'annual',location:'paragraph:1',text:'历史披露'}]}] }
  const executor:ReasoningExecutor={capabilities,execute:async request=>({operation:request.operation,output:{sections:ids.map(id=>({id,markdown:`有证据支持的结论〔annual@paragraph:1〕`,sourceCandidateIds:['annual']}))}})}
  const result=await assembleCompanyResearch(input,[citedMethod],executor,()=>input.asOf)
  assert.equal(result.synthesisMode,'reasoning_executor',JSON.stringify(result.synthesisDiagnostics))
  assert.match(result.sections.find(section=>section.id==='investment-thesis')!.markdown,/\[annual@paragraph:1\]/)
})

test('invalid final section cannot leak a partially accepted synthesis into report', async () => {
  let calls = 0
  const executor: ReasoningExecutor = { capabilities, execute: async (request) => {
    calls++
    if(calls===2) {
      const repair=request.input as {repairPreviousOutput:unknown;repairInstruction:string}
      assert.match(JSON.stringify(repair.repairPreviousOutput),/无引用的跟踪结论/)
      assert.match(repair.repairInstruction,/保留/)
    }
    return { operation: request.operation, output: { sections: ids.map((id) => ({ id, markdown: id === 'monitoring-checklist' ? '无引用的跟踪结论' : '部分拒绝内容 [annual@paragraph:1]', sourceCandidateIds: ['annual'] })) } }
  } }
  const result = await assembleCompanyResearch(input, [method], executor, () => input.asOf)
  assert.equal(calls, 2)
  assert.equal(result.synthesisMode, 'deterministic_fallback')
  assert.ok(result.sections.filter((section) => ids.includes(section.id)).every((section) => !section.markdown.includes('部分拒绝内容')))
})

test('final synthesis cannot cite an allowed source missing from actual method findings', async () => {
  const executor: ReasoningExecutor = { capabilities, execute: async (request) => ({ operation: request.operation, output: { sections: ids.map((id) => ({ id, markdown: '结论 [other@paragraph:1]', sourceCandidateIds: ['other'] })) } }) }
  const result = await assembleCompanyResearch({ ...input, reportSourceCandidateIds: ['annual', 'other'] }, [method], executor, () => input.asOf)
  assert.equal(result.synthesisMode, 'deterministic_fallback')
  assert.ok(result.synthesisDiagnostics.every((code) => code.includes('REFERENCE_ERROR')))
  assert.equal(result.synthesisAttemptOutputs.length, 2)
  assert.match(result.synthesisDiagnostics[0]!,/other@paragraph:1/)
  assert.ok(JSON.stringify(result.synthesisAttemptOutputs[0]!.output).includes('other@paragraph:1'))
  assert.deepEqual(result.synthesisAttemptOutputs[0]!.allowedCitations,['annual@paragraph:1'])
})

test('final synthesis repairs only a uniquely truncated source ID for the same authorized paragraph', async () => {
  const citedMethod: CompanyResearchMethodResult = {
    ...method,
    executionEvidence: [{ sourceCandidateId: 'annual', title: '年报', publisher: '公司', excerpts: [{ sourceCandidateId: 'annual', location: 'paragraph:1', text: '历史披露' }] }],
  }
  const executor: ReasoningExecutor = { capabilities, execute: async request => ({ operation: request.operation, output: { sections: ids.map(id => ({ id, markdown: `有证据支持的结论 [ann@paragraph:1]`, sourceCandidateIds: ['annual'] })) } }) }
  const result = await assembleCompanyResearch(input, [citedMethod], executor, () => input.asOf)
  assert.equal(result.synthesisMode, 'reasoning_executor', JSON.stringify(result.synthesisDiagnostics))
  assert.equal(result.synthesisAttempts, 1)
  assert.match(result.synthesisDiagnostics[0] ?? '', /UNIQUE_TRUNCATED_SOURCE_ID_REPAIR:ann@paragraph:1 -> annual@paragraph:1/)
  assert.match(result.sections.find(section => section.id === 'investment-thesis')!.markdown, /\[annual@paragraph:1\]/)
  assert.ok(!result.sections.some(section => section.markdown.includes('[ann@paragraph:1]')))
})

test('final synthesis leaves an ambiguous truncated source ID blocked', async () => {
  const both = ['annual-first', 'annual-second']
  const ambiguousMethod: CompanyResearchMethodResult = {
    ...method,
    sourceCandidateIds: both,
    findings: [{ text: '公司披露历史', kind: 'fact', evidence: both.map(sourceCandidateId => ({ sourceCandidateId, location: 'paragraph:1' })) }],
  }
  const ambiguousInput = { ...input, reportSourceCandidateIds: both, durableSourceCandidateIds: both }
  const executor: ReasoningExecutor = { capabilities, execute: async request => ({ operation: request.operation, output: { sections: ids.map(id => ({ id, markdown: `结论 [annual@paragraph:1]`, sourceCandidateIds: both })) } }) }
  const result = await assembleCompanyResearch(ambiguousInput, [ambiguousMethod], executor, () => input.asOf)
  assert.equal(result.synthesisMode, 'deterministic_fallback')
  assert.ok(result.synthesisDiagnostics.every(diagnostic => diagnostic.includes('REFERENCE_ERROR')))
  assert.ok(!result.synthesisDiagnostics.some(diagnostic => diagnostic.includes('UNIQUE_TRUNCATED_SOURCE_ID_REPAIR')))
})

test('final synthesis repair removes an unavailable locator and uses only an allowed citation', async () => {
  const badLocator = 'official-f6274e510499a654@paragraph:18'
  const unsupportedSentence = `现金流改善证明盈利质量已提升。[${badLocator}]`
  let calls = 0
  const executor: ReasoningExecutor = { capabilities, execute: async (request) => {
    calls++
    if (calls === 2) {
      const repair = request.input as { repair: string; repairInstruction: string; allowedCitations: string[] }
      assert.ok(repair.repair.includes(badLocator))
      assert.ok(repair.repairInstruction.includes(badLocator))
      assert.match(repair.repairInstruction, /现金流改善证明盈利质量已提升/)
      assert.match(repair.repairInstruction, /删除包含该定位符的整句\/主张/)
      assert.match(repair.repairInstruction, /不得编造、推算、迁移或按PDF\/年报页码换算paragraph定位符/)
      assert.deepEqual(repair.allowedCitations, ['annual@paragraph:1'])
    }
    return { operation: request.operation, output: { sections: ids.map((id) => ({ id, markdown: id === 'investment-thesis' && calls === 1 ? unsupportedSentence : '定性研究结论 [annual@paragraph:1]', sourceCandidateIds: ['annual'] })) } }
  } }
  const result = await assembleCompanyResearch(input, [method], executor, () => input.asOf)
  assert.equal(calls, 2)
  assert.equal(result.synthesisMode, 'reasoning_executor', JSON.stringify(result.synthesisDiagnostics))
  assert.match(result.synthesisDiagnostics[0]!, /REFERENCE_ERROR: final synthesis locator unavailable: official-f6274e510499a654@paragraph:18/)
  assert.match(result.sections.find((section) => section.id === 'investment-thesis')!.markdown, /annual@paragraph:1/)
  assert.ok(!result.sections.some((section) => section.markdown.includes(badLocator)))
})

test('final synthesis instruction keeps R&D measures separate and prevents broad management-role gaps', async () => {
  const executor: ReasoningExecutor = { capabilities, execute: async (request) => {
    assert.match(request.instruction, /研发投入金额.*研发费用.*不同指标与期间/)
    assert.match(request.instruction, /不能笼统称“完整管理层分工缺失”/)
    assert.match(request.instruction, /具体新任高管履历、具体职责分工或任职后绩效/)
    assert.match(request.instruction, /每条qualityFeedback都是上一轮报告的必修缺口/)
    assert.match(request.instruction, /不得用营业成本构成等邻近表格的单位、期间或表头支持客户\/供应商数据/)
    assert.match(request.instruction, /催化剂应衔接已披露指标和经营信号/)
    assert.match(request.instruction, /风险章节须保留竞争方法识别的具名候选公司/)
    assert.match(request.instruction, /不得一处写成本同比增速低于收入、另一处又写成本扩张更快/)
    assert.match(request.instruction, /先逐项检索本轮有效方法结果、findings 及 allowedEvidence 中与该节对应的具体原表行/)
    assert.match(request.instruction, /已披露的分行业\/分产品收入金额与占比/)
    assert.match(request.instruction, /已披露的并购完成\/并表事实、回购或员工计划购入与持有记录/)
    assert.match(request.instruction, /只有原表未给出的对价、支付细节、参与人数或后续回报可继续列为缺口/)
    assert.deepEqual((request.input as {qualityFeedback: string[]}).qualityFeedback, ['management-capital-allocation: latest employee shareholding plan'])
    return { operation: request.operation, output: { sections: ids.map((id) => ({ id, markdown: '定性研究结论 [annual@paragraph:1]', sourceCandidateIds: ['annual'] })) } }
  } }
  const result = await assembleCompanyResearch({...input, qualityFeedback: ['management-capital-allocation: latest employee shareholding plan']}, [method], executor, () => input.asOf)
  assert.equal(result.synthesisMode, 'reasoning_executor')
})

test('final synthesis requires complete split margin headers and exact segment citations', async () => {
  const executor: ReasoningExecutor = { capabilities, execute: async (request) => {
    assert.match(request.instruction, /引用PDF拆分表头中的分行业\/分产品毛利率变化时，必须直接引用定义该变化列的完整表头片段（所有拆分定位段）、单位段、相应分行业\/分产品区段标题，以及精确完整行标签和数值行/)
    assert.match(request.instruction, /行标签跨段时，标签段与数值续行都须分别引用/)
    assert.match(request.instruction, /缺少任一所需定位时，删除该数值论点/)
    return { operation: request.operation, output: { sections: ids.map((id) => ({ id, markdown: '定性研究结论 [annual@paragraph:1]', sourceCandidateIds: ['annual'] })) } }
  } }
  const result = await assembleCompanyResearch(input, [method], executor, () => input.asOf)
  assert.equal(result.synthesisMode, 'reasoning_executor')
})

test('final section source attribution is derived from cited authorized locations', async () => {
  const twoSourceMethod:CompanyResearchMethodResult={...method,sourceCandidateIds:['annual','half'],findings:[{text:'两份披露共同支持研究。',kind:'fact',evidence:[{sourceCandidateId:'annual',location:'paragraph:1'},{sourceCandidateId:'half',location:'paragraph:1'}]}],executionEvidence:[{sourceCandidateId:'annual',title:'年报',publisher:'公司',excerpts:[{sourceCandidateId:'annual',location:'paragraph:1',text:'年度经营披露。'}]},{sourceCandidateId:'half',title:'半年报',publisher:'公司',excerpts:[{sourceCandidateId:'half',location:'paragraph:1',text:'半年度经营披露。'}]}]}
  const executor:ReasoningExecutor={capabilities,execute:async request=>({operation:request.operation,output:{sections:ids.map(id=>({id,markdown:id==='investment-thesis'?'年度与半年度披露共同支持该定性判断。[annual@paragraph:1] [half@paragraph:1]':'有证据支持的定性判断。[annual@paragraph:1]',sourceCandidateIds:['annual']}))}})}
  const result=await assembleCompanyResearch({...input,sources:[{candidate:{candidateId:'annual'},title:'年报',content:'年度经营披露。'},{candidate:{candidateId:'half'},title:'半年报',content:'半年度经营披露。'}] as any,reportSourceCandidateIds:['annual','half']},[twoSourceMethod],executor,()=>input.asOf)
  assert.equal(result.synthesisMode,'reasoning_executor',JSON.stringify(result.synthesisDiagnostics))
  assert.deepEqual(result.sections.find(section=>section.id==='investment-thesis')!.sourceCandidateIds,['annual','half'])
  assert.deepEqual(result.sections.find(section=>section.id==='monitoring-checklist')!.sourceCandidateIds,['annual'])
})

test('unsupported optional valuation numbers are replaced by explicit basis gaps', async () => {
  const executor: ReasoningExecutor = { capabilities, execute: async (request) => ({ operation: request.operation, output: { sections: ids.map((id) => ({ id, markdown: ['valuation','bull-base-bear','variant-perception'].includes(id) ? '目标价 9999 元 [annual@paragraph:1]' : '定性研究结论 [annual@paragraph:1]', sourceCandidateIds: ['annual'] })) } }) }
  const result = await assembleCompanyResearch(input, [method], executor, () => input.asOf)
  assert.equal(result.synthesisMode, 'reasoning_executor')
  for (const section of result.sections.filter((section) => ['valuation', 'bull-base-bear', 'variant-perception'].includes(section.id))) { assert.match(section.markdown, /^研究缺口/); assert.ok(!section.markdown.includes('9999')); assert.deepEqual(section.sourceCandidateIds, []) }
})

test('unsupported locator in a discarded optional valuation draft does not exhaust synthesis retries', async () => {
  let calls = 0
  const executor: ReasoningExecutor = { capabilities, execute: async (request) => {
    calls++
    return { operation: request.operation, output: { sections: ids.map((id) => ({
      id,
      markdown: id === 'valuation'
        ? '2024年中国新能源汽车销量为1,286.6万辆。[official-f6274e510499a654@paragraph:18]'
        : '定性研究结论 [annual@paragraph:1]',
      sourceCandidateIds: ['annual'],
    })) } }
  } }
  const result = await assembleCompanyResearch(input, [method], executor, () => input.asOf)
  assert.equal(calls, 1)
  assert.equal(result.synthesisMode, 'reasoning_executor')
  assert.deepEqual(result.synthesisDiagnostics, [])
  const valuation = result.sections.find((section) => section.id === 'valuation')!
  assert.match(valuation.markdown, /^研究缺口/)
  assert.ok(!valuation.markdown.includes('1,286.6'))
  assert.ok(!valuation.markdown.includes('official-f6274e510499a654@paragraph:18'))
  assert.deepEqual(valuation.sourceCandidateIds, [])
  assert.match(result.sections.find((section) => section.id === 'investment-thesis')!.markdown, /annual@paragraph:1/)
})

test('final synthesis can reuse a validated section locator absent from concise findings', async () => {
  const contextualMethod: CompanyResearchMethodResult = { ...method, sections: [{id:'company-overview',markdown:'注册与重组口径不同 [annual@paragraph:2]'}], executionEvidence:[{sourceCandidateId:'annual',title:'年报',publisher:'公司',excerpts:[{sourceCandidateId:'annual',location:'paragraph:1',text:'历史披露'},{sourceCandidateId:'annual',location:'paragraph:2',text:'注册与重组口径不同'}]}] }
  const executor:ReasoningExecutor={capabilities,execute:async request=>({operation:request.operation,output:{sections:ids.map(id=>({id,markdown:'注册与重组口径应分别监控 [annual@paragraph:2]',sourceCandidateIds:['annual']}))}})}
  const result=await assembleCompanyResearch({...input,sources:[{candidate:{candidateId:'annual'},title:'年报',content:'历史披露\n注册与重组口径不同'}] as any},[contextualMethod],executor,()=>input.asOf)
  assert.equal(result.synthesisMode,'reasoning_executor',JSON.stringify(result.synthesisDiagnostics))
  assert.match(result.sections.find(section=>section.id==='investment-thesis')!.markdown,/paragraph:2/)
  const invalid = { ...contextualMethod, sections: [{id:'company-overview',markdown:'未供给位置 [annual@paragraph:999]'}] }
  const invalidExecutor:ReasoningExecutor={capabilities,execute:async request=>({operation:request.operation,output:{sections:ids.map(id=>({id,markdown:'未供给位置 [annual@paragraph:999]',sourceCandidateIds:['annual']}))}})}
  assert.equal((await assembleCompanyResearch({...input,sources:[{candidate:{candidateId:'annual'},title:'年报',content:'历史披露\n注册与重组口径不同'}] as any},[invalid],invalidExecutor,()=>input.asOf)).synthesisMode,'deterministic_fallback')
})
test('final synthesis receives the exact text behind every allowed locator', async () => {
  const contextualMethod: CompanyResearchMethodResult = { ...method, executionEvidence:[{sourceCandidateId:'annual',title:'2025年年报',publisher:'公司',excerpts:[{sourceCandidateId:'annual',location:'paragraph:1',text:'2025年营业收入增长，汽车业务为主要收入来源。'}]}] }
  let checked = false
  const executor:ReasoningExecutor={capabilities,execute:async request=>{
    const payload=request.input as {allowedCitations:string[];allowedEvidence:Array<{sourceCandidateId:string;location:string;title:string;text:string}>}
    assert.deepEqual(payload.allowedCitations,['annual@paragraph:1'])
    assert.deepEqual(payload.allowedEvidence,[{sourceCandidateId:'annual',location:'paragraph:1',title:'2025年年报',text:'2025年营业收入增长，汽车业务为主要收入来源。'}])
    checked=true
    return {operation:request.operation,output:{sections:ids.map(id=>({id,markdown:'汽车业务是主要收入来源 [annual@paragraph:1]',sourceCandidateIds:['annual']}))}}
  }}
  const result=await assembleCompanyResearch({...input,sources:[{candidate:{candidateId:'annual'},title:'2025年年报',content:'2025年营业收入增长，汽车业务为主要收入来源。'}] as any},[contextualMethod],executor,()=>input.asOf)
  assert.equal(checked,true)
  assert.equal(result.synthesisMode,'reasoning_executor')
})

test('final numeric grounding uses only exact supplied table context for units and gross-margin change columns', async () => {
  const annualLines = ['单位：元','2025年 2024年','汽车、汽车相关','产品及其他产品 648,645,636,000.00 80.68% 617,381,935,000.00 79.45%','产品分类毛利率','汽车、汽车相关产品及其他产品 20.49%']
  const halfLines = ['单位：元','2026年上半年 2025年上半年','毛利率（%） 同比增减（%）','分行业','交通运输设备及电气制','造业 275,341,358,000.00 213,863,297,000.00 22.33% -8.98% -11.24% 1.98%','日用电子器件制造业 69,404,994,000.00 65,907,931,000.00 5.04% 0.96% 3.88% -2.67%']
  const source = (candidateId:string,title:string,lines:string[]) => ({candidate:{candidateId,kind:'official_disclosure' as const,tier:1 as const,provider:'fixture',title},retrievedAt:'2026-10-14',title,publisher:'公司',contentHash:'fixture',content:lines.join('\n'),rights:{accessScope:'public' as const,retentionAllowed:true,aiProcessingAllowed:true,derivativeKnowledgeAllowed:true,redistributionAllowed:false}})
  const annual=source('annual','2025年年度报告',annualLines), half=source('half','2026年半年度报告',halfLines)
  const excerpt=(sourceCandidateId:string,lines:string[],context:Record<number,number[]>={})=>lines.flatMap((text,index)=>text? [{sourceCandidateId,location:`paragraph:${index+1}`,text,...(context[index+1]?{contextLocations:context[index+1]!.map(number=>`paragraph:${number}`)}:{})}] : [])
  const annualExcerpts=excerpt('annual',annualLines,{4:[1,2],6:[5]})
  const halfExcerpts=excerpt('half',halfLines,{6:[2,3,4],7:[2,3]})
  const citations=[...annualExcerpts.map(item=>({sourceCandidateId:'annual',location:item.location})),...halfExcerpts.map(item=>({sourceCandidateId:'half',location:item.location}))]
  const contextualMethod:CompanyResearchMethodResult={...method,findings:[{text:'披露收入及分行业毛利率。',kind:'fact',evidence:citations}],executionEvidence:[{sourceCandidateId:'annual',title:annual.title,publisher:'公司',excerpts:annualExcerpts},{sourceCandidateId:'half',title:half.title,publisher:'公司',excerpts:halfExcerpts}]}
  const claim='2025年汽车相关产品收入648,645,636,000元，占比80.68%，产品分类毛利率20.49%。[annual@paragraph:3] [annual@paragraph:4] [annual@paragraph:6] 交通运输设备及电气制造业毛利率22.33%，同比增加1.98%。[half@paragraph:5] [half@paragraph:6] 日用电子器件制造业毛利率5.04%、同比下降2.67%。[half@paragraph:7]'
  const executor:ReasoningExecutor={capabilities,execute:async request=>{
    const payload=request.input as {allowedEvidence:Array<{sourceCandidateId:string;location:string;contextLocations?:readonly string[]}>}
    assert.deepEqual(payload.allowedEvidence.find(item=>item.sourceCandidateId==='annual'&&item.location==='paragraph:4')?.contextLocations,['paragraph:1','paragraph:2'])
    assert.deepEqual(payload.allowedEvidence.find(item=>item.sourceCandidateId==='half'&&item.location==='paragraph:6')?.contextLocations,['paragraph:2','paragraph:3','paragraph:4'])
    return {operation:request.operation,output:{sections:ids.map(id=>({id,markdown:id==='investment-thesis'?claim:'有证据支持的定性判断。[annual@paragraph:3]',sourceCandidateIds:['annual','half']}))}}
  }}
  const result=await assembleCompanyResearch({...input,sources:[annual,half],reportSourceCandidateIds:['annual','half']},[contextualMethod],executor,()=>input.asOf)
  assert.equal(result.synthesisMode,'reasoning_executor',JSON.stringify(result.synthesisDiagnostics))
  assert.match(result.sections.find(section=>section.id==='investment-thesis')!.markdown,/1\.98%/)
  const wrongLevelExecutor:ReasoningExecutor={capabilities,execute:async request=>({operation:request.operation,output:{sections:ids.map(id=>({id,markdown:id==='investment-thesis'?claim.replace('毛利率5.04%','毛利率6.04%'):'有证据支持的定性判断。[annual@paragraph:3]',sourceCandidateIds:['annual','half']}))}})}
  const wrongLevel=await assembleCompanyResearch({...input,sources:[annual,half],reportSourceCandidateIds:['annual','half']},[contextualMethod],wrongLevelExecutor,()=>input.asOf)
  assert.equal(wrongLevel.synthesisMode,'deterministic_fallback')
  assert.ok(wrongLevel.synthesisDiagnostics.some(diagnostic=>diagnostic.includes('NUMERIC_GROUNDING_ERROR')))
})

test('numeric synthesis preserves a cited row unit when later table rows reuse it as context', async () => {
  const lines=['单位：元','本报告期 上年同期','营业收入','27,347,867,868.08','成本 21,929,134,042.30']
  const source={candidate:{candidateId:'half',kind:'official_disclosure' as const,tier:1 as const,provider:'fixture',title:'2026年半年度报告'},retrievedAt:'2026-10-23',title:'2026年半年度报告',publisher:'公司',contentHash:'fixture',content:lines.join('\n'),rights:{accessScope:'public' as const,retentionAllowed:true,aiProcessingAllowed:true,derivativeKnowledgeAllowed:true,redistributionAllowed:false}}
  const excerpt=(location:number,contextLocations:number[]=[])=>( {sourceCandidateId:'half',location:`paragraph:${location}`,text:lines[location-1]!,...(contextLocations.length?{contextLocations:contextLocations.map(number=>`paragraph:${number}`)}:{})} )
  const packet={sourceCandidateId:'half',title:source.title,publisher:'公司',excerpts:[excerpt(1),excerpt(2),excerpt(3),excerpt(4,[1,2,3]),excerpt(5,[1,4])]}
  const evidence=[{sourceCandidateId:'half',location:'paragraph:4'},{sourceCandidateId:'half',location:'paragraph:5'}]
  const first:CompanyResearchMethodResult={...method,skillId:'business_model_map',findings:[{text:'披露营业收入行。',kind:'fact',evidence}],executionEvidence:[packet]}
  // A later method may supply the same row with less context; the union must
  // retain the exact source unit and header already supplied by the first.
  const secondPacket={...packet,excerpts:[excerpt(4,[2,3,5]),excerpt(5,[4])]}
  const second:CompanyResearchMethodResult={...method,skillId:'financial_quality_analysis',findings:[{text:'披露收入及成本行。',kind:'fact',evidence}],executionEvidence:[secondPacket]}
  const claim='2026年上半年营业收入27,347,867,868.08元。[half@paragraph:4]'
  const executor:ReasoningExecutor={capabilities,execute:async request=>{
    const payload=request.input as {allowedEvidence:Array<{sourceCandidateId:string;location:string;contextLocations?:readonly string[]}>}
    assert.deepEqual(payload.allowedEvidence.find(item=>item.sourceCandidateId==='half'&&item.location==='paragraph:4')?.contextLocations,['paragraph:1','paragraph:2','paragraph:3','paragraph:5'])
    return {operation:request.operation,output:{sections:ids.map(id=>({id,markdown:id==='investment-thesis'?claim:`该方法结果需持续观察。[half@paragraph:4]`,sourceCandidateIds:['half']}))}}
  }}
  const result=await assembleCompanyResearch({...input,sources:[source],reportSourceCandidateIds:['half'],durableSourceCandidateIds:['half']},[first,second],executor,()=>input.asOf)
  assert.equal(result.synthesisMode,'reasoning_executor',JSON.stringify(result.synthesisDiagnostics))
  assert.match(result.sections.find(section=>section.id==='investment-thesis')!.markdown,/27,347,867,868\.08元/)
})

test('unsupported numbers in core final conclusions block synthesis rather than enter a completed report', async () => {
  const executor:ReasoningExecutor={capabilities,execute:async request=>({operation:request.operation,output:{sections:ids.map(id=>({id,markdown:'确认收入 9999 元 [annual@paragraph:1]',sourceCandidateIds:['annual']}))}})}
  const result=await assembleCompanyResearch(input,[method],executor,()=>input.asOf)
  assert.equal(result.synthesisMode,'deterministic_fallback')
  assert.ok(result.synthesisDiagnostics.every(d=>d.includes('NUMERIC_GROUNDING_ERROR')))
})

test('numeric synthesis reconciles a mismatched locator to the exact supplied cited row', async () => {
  const annual={candidate:{candidateId:'annual',kind:'official_disclosure' as const,tier:1 as const,provider:'fixture',title:'年报'},retrievedAt:'2026-10-14',title:'年报',publisher:'公司',contentHash:'fixture',content:'单位：元\n第一名客户销售占比46.46%',rights:{accessScope:'public' as const,retentionAllowed:true,aiProcessingAllowed:true,derivativeKnowledgeAllowed:true,redistributionAllowed:false}}
  const sourcedMethod:CompanyResearchMethodResult={...method,findings:[{text:'年度第一名客户销售占比46.46%',kind:'fact',evidence:[{sourceCandidateId:'annual',location:'paragraph:1'},{sourceCandidateId:'annual',location:'paragraph:2'}]}],sections:[{id:'company-overview',markdown:'客户表[annual@paragraph:1] [annual@paragraph:2]'}],executionEvidence:[{sourceCandidateId:'annual',title:'年报',publisher:'公司',excerpts:[{sourceCandidateId:'annual',location:'paragraph:1',text:'单位：元'},{sourceCandidateId:'annual',location:'paragraph:2',text:'第一名客户销售占比46.46%'}]}]}
  let calls=0
  const executor:ReasoningExecutor={capabilities,execute:async request=>{
    calls++
    return {operation:request.operation,output:{sections:ids.map(id=>({id,markdown:id==='investment-thesis'?`客户集中度46.46%。[annual@paragraph:${calls===1?'1':'2'}]`:'有证据的定性结论。[annual@paragraph:1]',sourceCandidateIds:['annual']}))}}
  }}
  const result=await assembleCompanyResearch({...input,sources:[annual]},[sourcedMethod],executor,()=>input.asOf)
  assert.equal(calls,1)
  assert.equal(result.synthesisMode,'reasoning_executor',JSON.stringify(result.synthesisDiagnostics))
  assert.match(result.sections.find(section=>section.id==='investment-thesis')!.markdown,/annual@paragraph:2/)
})

test('numeric synthesis repair adds the unique omitted paragraph for a split optical-chip specification', async () => {
  const annual={candidate:{candidateId:'annual' as const,kind:'official_disclosure' as const,tier:1 as const,provider:'fixture',title:'年报'},retrievedAt:'2026-10-14',title:'年报',publisher:'公司',contentHash:'fixture',content:'自研100GPAM4EML芯片在\n模块应用情况需要持续观察。',rights:{accessScope:'public' as const,retentionAllowed:true,aiProcessingAllowed:true,derivativeKnowledgeAllowed:true,redistributionAllowed:false}}
  const citedMethod:CompanyResearchMethodResult={...method,findings:[{text:'模块应用情况需要持续观察。',kind:'fact',evidence:[{sourceCandidateId:'annual',location:'paragraph:2'}]}],executionEvidence:[{sourceCandidateId:'annual',title:'年报',publisher:'公司',excerpts:annual.content.split('\n').map((text,index)=>({sourceCandidateId:'annual',location:`paragraph:${index+1}`,text}))}]}
  let calls=0
  const executor:ReasoningExecutor={capabilities,execute:async request=>{
    calls++
    return {operation:request.operation,output:{sections:ids.map(id=>({id,markdown:id==='investment-thesis'?'持续跟踪100G PAM4 EML芯片在模块中的应用。[annual@paragraph:2]':'有证据支持的定性判断。[annual@paragraph:1]',sourceCandidateIds:['annual']}))}}
  }}
  const result=await assembleCompanyResearch({...input,sources:[annual]},[citedMethod],executor,()=>input.asOf)
  assert.equal(calls,1,JSON.stringify(result.synthesisDiagnostics))
  assert.equal(result.synthesisMode,'reasoning_executor',JSON.stringify(result.synthesisDiagnostics))
  assert.match(result.sections.find(section=>section.id==='investment-thesis')!.markdown,/\[annual@paragraph:1\]/)
})

test('numeric synthesis repair cannot recover a source row omitted from compact method evidence', async () => {
  const annual={candidate:{candidateId:'annual' as const,kind:'official_disclosure' as const,tier:1 as const,provider:'fixture',title:'年报'},retrievedAt:'2026-10-14',title:'年报',publisher:'公司',contentHash:'fixture',content:'自研100GPAM4EML芯片在\n400G及800G光模块累计使用，200GPAM4EML芯片已进入量产。',rights:{accessScope:'public' as const,retentionAllowed:true,aiProcessingAllowed:true,derivativeKnowledgeAllowed:true,redistributionAllowed:false}}
  const sourcedMethod:CompanyResearchMethodResult={...method,findings:[{text:'披露100G PAM4 EML技术规格。',kind:'fact',evidence:[{sourceCandidateId:'annual',location:'paragraph:1'},{sourceCandidateId:'annual',location:'paragraph:2'}]}],executionEvidence:[{sourceCandidateId:'annual',title:'年报',publisher:'公司',excerpts:[{sourceCandidateId:'annual',location:'paragraph:2',text:'400G及800G光模块累计使用，200GPAM4EML芯片已进入量产。'}]}]}
  const claim='100G PAM4 EML用于模块，200G PAM4 EML进入量产。[annual@paragraph:2]'
  const executor:ReasoningExecutor={capabilities,execute:async request=>({operation:request.operation,output:{sections:ids.map(id=>({id,markdown:id==='investment-thesis'?claim:'有证据支持的定性判断。[annual@paragraph:2]',sourceCandidateIds:['annual']}))}})}
  const result=await assembleCompanyResearch({...input,sources:[annual]},[sourcedMethod],executor,()=>input.asOf)
  assert.equal(result.synthesisMode,'deterministic_fallback',JSON.stringify(result.synthesisDiagnostics))
  assert.ok(result.synthesisDiagnostics.some(diagnostic=>diagnostic.includes('NUMERIC_GROUNDING_ERROR')))
})

test('numeric synthesis repair leaves an authorized specification citation unresolved when its source row is ambiguous', async () => {
  const annual={candidate:{candidateId:'annual' as const,kind:'official_disclosure' as const,tier:1 as const,provider:'fixture',title:'年报'},retrievedAt:'2026-10-14',title:'年报',publisher:'公司',contentHash:'fixture',content:'自研100GPAM4EML芯片在\n400G及800G光模块累计使用，200GPAM4EML芯片已进入量产。\n另一处披露100GPAM4EML芯片规格。',rights:{accessScope:'public' as const,retentionAllowed:true,aiProcessingAllowed:true,derivativeKnowledgeAllowed:true,redistributionAllowed:false}}
  const sourcedMethod:CompanyResearchMethodResult={...method,findings:[{text:'披露100G PAM4 EML技术规格。',kind:'fact',evidence:[{sourceCandidateId:'annual',location:'paragraph:1'},{sourceCandidateId:'annual',location:'paragraph:2'},{sourceCandidateId:'annual',location:'paragraph:3'}]}],executionEvidence:[{sourceCandidateId:'annual',title:'年报',publisher:'公司',excerpts:[{sourceCandidateId:'annual',location:'paragraph:2',text:'400G及800G光模块累计使用，200GPAM4EML芯片已进入量产。'}]}]}
  const claim='100G PAM4 EML用于模块，200G PAM4 EML进入量产。[annual@paragraph:2]'
  const executor:ReasoningExecutor={capabilities,execute:async request=>({operation:request.operation,output:{sections:ids.map(id=>({id,markdown:id==='investment-thesis'?claim:'有证据支持的定性判断。[annual@paragraph:2]',sourceCandidateIds:['annual']}))}})}
  const result=await assembleCompanyResearch({...input,sources:[annual]},[sourcedMethod],executor,()=>input.asOf)
  assert.equal(result.synthesisMode,'deterministic_fallback')
  assert.ok(result.synthesisDiagnostics.some(diagnostic=>diagnostic.includes('NUMERIC_GROUNDING_ERROR')))
})

test('numeric synthesis repair adds the unique same-source Juno Newco goodwill original-value row', async () => {
  const sourceLines=Array<string>(7024).fill('')
  sourceLines[7023]='除特别说明外，金额均以人民币千元为单位表示。'
  sourceLines[4814]='（1）商誉原值'
  sourceLines[4820]='Juno Newco 4,361,657 - - 4,361,657'
  const annual={candidate:{candidateId:'annual' as const,kind:'official_disclosure' as const,tier:1 as const,provider:'fixture',title:'2025年年度报告'},retrievedAt:'2026-10-14',title:'2025年年度报告',publisher:'公司',contentHash:'fixture',content:sourceLines.join('\n'),rights:{accessScope:'public' as const,retentionAllowed:true,aiProcessingAllowed:true,derivativeKnowledgeAllowed:true,redistributionAllowed:false}}
  const excerpts=[
    {sourceCandidateId:'annual',location:'paragraph:7024',text:'除特别说明外，金额均以人民币千元为单位表示。'},
    {sourceCandidateId:'annual',location:'paragraph:4815',text:'（1）商誉原值'},
    {sourceCandidateId:'annual',location:'paragraph:4821',text:'Juno Newco 4,361,657 - - 4,361,657'},
  ]
  const citedMethod:CompanyResearchMethodResult={...method,findings:[{text:'Juno Newco商誉原值披露。',kind:'fact',evidence:excerpts.map(({sourceCandidateId,location})=>({sourceCandidateId,location}))}],executionEvidence:[{sourceCandidateId:'annual',title:annual.title,publisher:'公司',excerpts}]}
  const claim='Juno Newco商誉原值为人民币4,361,657千元。[annual@paragraph:7024] [annual@paragraph:4815]'
  let calls=0
  const executor:ReasoningExecutor={capabilities,execute:async request=>{
    calls++
    return {operation:request.operation,output:{sections:ids.map(id=>({id,markdown:id==='investment-thesis'?claim:'有证据支持的定性判断。[annual@paragraph:4815]',sourceCandidateIds:['annual']}))}}
  }}
  const result=await assembleCompanyResearch({...input,sources:[annual],reportSourceCandidateIds:['annual']},[citedMethod],executor,()=>input.asOf)
  assert.equal(calls,1,JSON.stringify(result.synthesisDiagnostics))
  assert.equal(result.synthesisMode,'reasoning_executor',JSON.stringify(result.synthesisDiagnostics))
  assert.match(result.sections.find(section=>section.id==='investment-thesis')!.markdown,/4,361,657\[annual@paragraph:4821\]千元/)
})

test('Juno Newco goodwill numeric citation repair fails closed for ambiguous rows or an uncited source', async () => {
  const makeSource=(candidateId:string,title:string,content:string)=>({candidate:{candidateId,kind:'official_disclosure' as const,tier:1 as const,provider:'fixture',title},retrievedAt:'2026-10-14',title,publisher:'公司',contentHash:'fixture',content,rights:{accessScope:'public' as const,retentionAllowed:true,aiProcessingAllowed:true,derivativeKnowledgeAllowed:true,redistributionAllowed:false}})
  const annual=makeSource('annual','2025年年度报告','单位：人民币千元\n商誉原值\nJuno Newco 4,361,657 - - 4,361,657\nJuno Newco 4,361,657 - - 4,361,657')
  const excerpts=annual.content.split('\n').map((text,index)=>({sourceCandidateId:'annual',location:`paragraph:${index+1}`,text}))
  const citedMethod:CompanyResearchMethodResult={...method,findings:[{text:'Juno Newco商誉原值披露。',kind:'fact',evidence:excerpts.map(excerpt=>({sourceCandidateId:'annual',location:excerpt.location}))}],executionEvidence:[{sourceCandidateId:'annual',title:annual.title,publisher:'公司',excerpts}]}
  const claim='Juno Newco商誉原值为人民币4,361,657千元。[annual@paragraph:1]'
  let calls=0
  const ambiguousExecutor:ReasoningExecutor={capabilities,execute:async request=>{
    calls++
    return {operation:request.operation,output:{sections:ids.map(id=>({id,markdown:id==='investment-thesis'?claim:'有证据支持的定性判断。[annual@paragraph:1]',sourceCandidateIds:['annual']}))}}
  }}
  const ambiguous=await assembleCompanyResearch({...input,sources:[annual],reportSourceCandidateIds:['annual']},[citedMethod],ambiguousExecutor,()=>input.asOf)
  assert.equal(ambiguous.synthesisMode,'deterministic_fallback')
  assert.equal(calls,2)
  assert.ok(ambiguous.synthesisDiagnostics.some(diagnostic=>diagnostic.includes('NUMERIC_GROUNDING_ERROR')))

  const base=makeSource('annual','2025年年度报告','单位：人民币千元\n商誉原值\nJuno Newco')
  const other=makeSource('other','2024年年度报告','单位：人民币千元\n商誉原值\nJuno Newco 4,361,657 - - 4,361,657')
  const baseExcerpts=base.content.split('\n').map((text,index)=>({sourceCandidateId:'annual',location:`paragraph:${index+1}`,text}))
  const otherExcerpts=other.content.split('\n').map((text,index)=>({sourceCandidateId:'other',location:`paragraph:${index+1}`,text}))
  const mismatchedMethod:CompanyResearchMethodResult={...method,findings:[{text:'Juno Newco商誉原值披露。',kind:'fact',evidence:[...baseExcerpts,...otherExcerpts].map(excerpt=>({sourceCandidateId:excerpt.sourceCandidateId,location:excerpt.location}))}],executionEvidence:[{sourceCandidateId:'annual',title:base.title,publisher:'公司',excerpts:baseExcerpts},{sourceCandidateId:'other',title:other.title,publisher:'公司',excerpts:otherExcerpts}]}
  calls=0
  const mismatchedExecutor:ReasoningExecutor={capabilities,execute:async request=>{
    calls++
    return {operation:request.operation,output:{sections:ids.map(id=>({id,markdown:id==='investment-thesis'?claim:'有证据支持的定性判断。[annual@paragraph:1]',sourceCandidateIds:['annual','other']}))}}
  }}
  const mismatched=await assembleCompanyResearch({...input,sources:[base,other],reportSourceCandidateIds:['annual','other']},[mismatchedMethod],mismatchedExecutor,()=>input.asOf)
  assert.equal(mismatched.synthesisMode,'deterministic_fallback')
  assert.equal(calls,2)
  assert.ok(mismatched.synthesisDiagnostics.some(diagnostic=>diagnostic.includes('NUMERIC_GROUNDING_ERROR')))
})

test('final synthesis repairs a missing customer-subject locator when the ratio is duplicated by a generic total row', async () => {
  const annual={candidate:{candidateId:'annual' as const,kind:'official_disclosure' as const,tier:1 as const,provider:'fixture',title:'2025年年度报告'},retrievedAt:'2026-10-14',title:'2025年年度报告',publisher:'公司',contentHash:'fixture',content:'前五名客户合计销售金额占年度销售总额比例 64.33%\n前五名客户合计销售金额（元） 25,814,059,702.20\n合计 -- 25,814,059,702.20 64.33%',rights:{accessScope:'public' as const,retentionAllowed:true,aiProcessingAllowed:true,derivativeKnowledgeAllowed:true,redistributionAllowed:false}}
  const sourcedMethod:CompanyResearchMethodResult={...method,findings:[{text:'前五名客户占年度销售总额64.33%。',kind:'fact',evidence:[{sourceCandidateId:'annual',location:'paragraph:1'},{sourceCandidateId:'annual',location:'paragraph:2'},{sourceCandidateId:'annual',location:'paragraph:3'}]}],sections:[{id:'company-overview',markdown:'客户比例见年报 [annual@paragraph:1] [annual@paragraph:2] [annual@paragraph:3]'}],executionEvidence:[{sourceCandidateId:'annual',title:annual.title,publisher:'公司',excerpts:annual.content.split('\n').map((text,index)=>({sourceCandidateId:'annual',location:`paragraph:${index+1}`,text}))}]}
  const executor:ReasoningExecutor={capabilities,execute:async request=>({operation:request.operation,output:{sections:ids.map(id=>({id,markdown:id==='investment-thesis'?'客户集中度64.33%。[annual@paragraph:2] [annual@paragraph:3]':'有证据的定性结论。[annual@paragraph:1]',sourceCandidateIds:['annual']}))}})}
  const result=await assembleCompanyResearch({...input,sources:[annual]},[sourcedMethod],executor,()=>input.asOf)
  assert.equal(result.synthesisMode,'reasoning_executor',JSON.stringify(result.synthesisDiagnostics))
  assert.match(result.sections.find(section=>section.id==='investment-thesis')!.markdown,/\[annual@paragraph:1\]/)
})

test('final synthesis repairs the exact second-customer ratio row rather than accepting a neighboring customer citation', async () => {
  const annual={candidate:{candidateId:'annual' as const,kind:'official_disclosure' as const,tier:1 as const,provider:'fixture',title:'2025年年度报告'},retrievedAt:'2026-10-14',title:'2025年年度报告',publisher:'公司',contentHash:'fixture',content:'2 第二名 2,809,002,571.15 7.00%\n客户身份及业务映射未披露。',rights:{accessScope:'public' as const,retentionAllowed:true,aiProcessingAllowed:true,derivativeKnowledgeAllowed:true,redistributionAllowed:false}}
  const citedMethod:CompanyResearchMethodResult={...method,findings:[{text:'第二名客户销售占比需持续跟踪。',kind:'fact',evidence:[{sourceCandidateId:'annual',location:'paragraph:2'}]}],executionEvidence:[{sourceCandidateId:'annual',title:annual.title,publisher:'公司',excerpts:annual.content.split('\n').map((text,index)=>({sourceCandidateId:'annual',location:`paragraph:${index+1}`,text}))}]}
  const executor:ReasoningExecutor={capabilities,execute:async request=>({operation:request.operation,output:{sections:ids.map(id=>({id,markdown:id==='investment-thesis'?'第二名客户销售占比7.00%。[annual@paragraph:2]':'有证据支持的定性判断。[annual@paragraph:2]',sourceCandidateIds:['annual']}))}})}
  const result=await assembleCompanyResearch({...input,sources:[annual]},[citedMethod],executor,()=>input.asOf)
  assert.equal(result.synthesisMode,'reasoning_executor',JSON.stringify(result.synthesisDiagnostics))
  assert.match(result.sections.find(section=>section.id==='investment-thesis')!.markdown,/第二名客户销售占比7\.00%[^\n]*\[annual@paragraph:1\]/)
})

test('assembled risk section replaces a false no-named-competitor claim with a sourced candidate and scoped gaps', async () => {
  const annual={candidate:{candidateId:'annual' as const,kind:'official_disclosure' as const,tier:1 as const,provider:'fixture',title:'年报'},retrievedAt:'2026-10-14',title:'年报',publisher:'公司',contentHash:'fixture',content:'公司披露经营风险。',rights:{accessScope:'public' as const,retentionAllowed:true,aiProcessingAllowed:true,derivativeKnowledgeAllowed:true,redistributionAllowed:false}}
  const peer={candidate:{candidateId:'peer' as const,kind:'web_article' as const,tier:3 as const,provider:'fixture',title:'InnoLight产品页'},retrievedAt:'2026-10-14',title:'InnoLight产品页',publisher:'InnoLight',contentHash:'fixture',content:'InnoLight公开了数据中心互联光模块产品。',rights:annual.rights}
  const history:CompanyResearchMethodResult={...method,executionEvidence:[{sourceCandidateId:'annual',title:annual.title,publisher:'公司',excerpts:[{sourceCandidateId:'annual',location:'paragraph:1',text:annual.content}]}]}
  const risk:CompanyResearchMethodResult={...method,skillId:'company_risk_analysis',sections:[{id:'risks',markdown:'现有材料没有具名竞争对手及同口径性能、价格或市场份额数据，无法判断相对竞争位置。[annual@paragraph:1]'}],executionEvidence:[{sourceCandidateId:'annual',title:annual.title,publisher:'公司',excerpts:[{sourceCandidateId:'annual',location:'paragraph:1',text:annual.content}]}]}
  const competition:CompanyResearchMethodResult={...method,skillId:'competitive_market_map',sourceCandidateIds:['peer'],findings:[{text:'InnoLight公开了数据中心互联光模块产品。',kind:'fact',evidence:[{sourceCandidateId:'peer',location:'paragraph:1'}]}],sections:[{id:'competition',markdown:'InnoLight公开了数据中心互联光模块产品。[peer@paragraph:1]'}],executionEvidence:[{sourceCandidateId:'peer',title:peer.title,publisher:'InnoLight',excerpts:[{sourceCandidateId:'peer',location:'paragraph:1',text:peer.content}]}]}
  const executor:ReasoningExecutor={capabilities,execute:async request=>({operation:request.operation,output:{sections:ids.map(id=>({id,markdown:`有证据支持的结论 [annual@paragraph:1]`,sourceCandidateIds:['annual']}))}})}
  const result=await assembleCompanyResearch({...input,company:{...input.company,name:'测试公司'},sources:[annual,peer],reportSourceCandidateIds:['annual','peer']},[history,risk,competition],executor,()=>input.asOf)
  assert.equal(result.synthesisMode,'reasoning_executor',JSON.stringify(result.synthesisDiagnostics))
  const risks=result.sections.find(section=>section.id==='risks')!.markdown
  assert.match(risks,/InnoLight公开了数据中心互联光模块产品/)
  assert.match(risks,/直接竞标、客户重叠及同口径性能/)
  assert.doesNotMatch(risks,/没有具名竞品/)
  assert.ok(result.sections.find(section=>section.id==='risks')!.sourceCandidateIds.includes('peer'))
})

test('R111 carries only the public named competitor into industry, risk, and segments while keeping target route evidence separate', async () => {
  const rights={accessScope:'public' as const,retentionAllowed:true,aiProcessingAllowed:true,derivativeKnowledgeAllowed:true,redistributionAllowed:false}
  const source=(candidateId:string,title:string,publishedAt:string,content:string,kind:'web_article'|'official_disclosure'='web_article')=>({candidate:{candidateId,kind,tier:kind==='official_disclosure'?1 as const:3 as const,provider:'fixture',title,publishedAt},retrievedAt:'2026-10-18',title,publisher:kind==='official_disclosure'?'东山精密':'公开来源',contentHash:candidateId,content,rights})
  const annual=source('annual','年报','2026-04-21T00:00:00Z','公司披露产品分部。','official_disclosure')
  const peer=source('public-web-peer','中际旭创','2024-06-02T00:00:00Z','中际旭创官网披露其高速光互连产品面向云计算与AI，并服务头部云计算和AI客户。')
  const companyRoute=source('official-company-route','半年报','2026-08-21T00:00:00Z','东山披露从EML光芯片到模块制造的整合体系及AI数据中心应用方向。','official_disclosure')
  const history:CompanyResearchMethodResult={...method,executionEvidence:[{sourceCandidateId:'annual',title:annual.title,publisher:annual.publisher,excerpts:[{sourceCandidateId:'annual',location:'paragraph:1',text:annual.content}]}]}
  const industry:CompanyResearchMethodResult={...method,skillId:'market_structure_analysis',sections:[{id:'industry-exposure',markdown:'行业范围按公司产品划分。[annual@paragraph:1]'}],executionEvidence:[{sourceCandidateId:'annual',title:annual.title,publisher:annual.publisher,excerpts:[{sourceCandidateId:'annual',location:'paragraph:1',text:annual.content}]}]}
  const risk:CompanyResearchMethodResult={...method,skillId:'company_risk_analysis',sections:[{id:'risks',markdown:'现有材料没有具名竞品及同口径数据，无法判断相对位置。[annual@paragraph:1]'}],executionEvidence:[{sourceCandidateId:'annual',title:annual.title,publisher:annual.publisher,excerpts:[{sourceCandidateId:'annual',location:'paragraph:1',text:annual.content}]}]}
  const business:CompanyResearchMethodResult={...method,sections:[{id:'business-segments',markdown:'产品分部资料不含同口径对手表。未披露具名竞品及可比产品路线，不作竞争排名。[annual@paragraph:1]'}],executionEvidence:[{sourceCandidateId:'annual',title:annual.title,publisher:annual.publisher,excerpts:[{sourceCandidateId:'annual',location:'paragraph:1',text:annual.content}]}]}
  const competition:CompanyResearchMethodResult={...method,skillId:'competitive_market_map',sourceCandidateIds:['public-web-peer','official-company-route'],findings:[
    {text:'高速光模块是现有材料可支持的有限比较：东山披露从EML光芯片到模块制造的整合体系及AI数据中心应用方向。',kind:'fact',evidence:[{sourceCandidateId:'official-company-route',location:'paragraph:1'}]},
    {text:'中际旭创官网披露其高速光互连产品面向云计算与AI，并服务头部云计算和AI客户；与东山存在应用场景层面的重叠证据，但不能据此推定客户或采购重叠。',kind:'fact',evidence:[{sourceCandidateId:'public-web-peer',location:'paragraph:1'}]},
  ],sections:[{id:'competition',markdown:'候选比较基于中际旭创公开材料。[public-web-peer@paragraph:1]；东山披露自身EML至模块路线。[official-company-route@paragraph:1]'}],executionEvidence:[
    {sourceCandidateId:'public-web-peer',title:peer.title,publisher:peer.publisher,excerpts:[{sourceCandidateId:'public-web-peer',location:'paragraph:1',text:peer.content}]},
    {sourceCandidateId:'official-company-route',title:companyRoute.title,publisher:companyRoute.publisher,excerpts:[{sourceCandidateId:'official-company-route',location:'paragraph:1',text:companyRoute.content}]},
  ]}
  const executor:ReasoningExecutor={capabilities,execute:async request=>({operation:request.operation,output:{sections:ids.map(id=>({id,markdown:'有证据支持的结论 [annual@paragraph:1]',sourceCandidateIds:['annual']}))}})}
  const result=await assembleCompanyResearch({...input,company:{...input.company,symbol:'002384',name:'东山精密'},asOf:'2026-10-18T00:00:00Z',sources:[annual,peer,companyRoute],reportSourceCandidateIds:['annual','public-web-peer','official-company-route']},[history,industry,business,risk,competition],executor,()=>input.asOf)
  const industryText=result.sections.find(section=>section.id==='industry-exposure')!.markdown
  const competitionText=result.sections.find(section=>section.id==='competition')!.markdown
  const risksText=result.sections.find(section=>section.id==='risks')!.markdown
  const businessText=result.sections.find(section=>section.id==='business-segments')!.markdown
  assert.match(industryText,/中际旭创官网披露其高速光互连产品/)
  assert.match(industryText,/public-web-peer@paragraph:1/)
  assert.match(industryText,/东山披露从EML光芯片到模块制造/)
  assert.match(industryText,/official-company-route@paragraph:1/)
  assert.doesNotMatch(industryText,/高速光模块是现有材料可支持的有限比较：东山.*具名候选/)
  assert.match(competitionText,/历史材料时点限制/)
  assert.match(competitionText,/2024年6月2日/)
  assert.match(competitionText,/截至2026-10-18/)
  assert.match(risksText,/候选识别不等于已证实直接竞品/)
  assert.match(risksText,/中际旭创/)
  assert.match(risksText,/public-web-peer@paragraph:1/)
  assert.match(risksText,/official-company-route@paragraph:1/)
  assert.doesNotMatch(risksText,/具名候选及其产品\/路线为：高速光模块是现有材料/)
  assert.match(risksText,/实际客户或招投标重合、市场份额及同口径成本和性能/)
  assert.doesNotMatch(risksText,/现有材料没有具名竞品/)
  assert.match(businessText,/跨方法核实的具名候选为中际旭创/)
  assert.doesNotMatch(businessText,/未披露具名竞品/)
  assert.match(businessText,/public-web-peer@paragraph:1/)
  assert.ok(result.sections.find(section=>section.id==='competition')!.sourceCandidateIds.includes('public-web-peer'))
  assert.ok(result.sections.find(section=>section.id==='industry-exposure')!.sourceCandidateIds.includes('official-company-route'))
  assert.ok(result.sections.find(section=>section.id==='risks')!.sourceCandidateIds.includes('public-web-peer'))
})

test('final synthesis attaches a unique authorized product row to its exact quantitative sentence', async () => {
  const annual={candidate:{candidateId:'annual',kind:'official_disclosure' as const,tier:1 as const,provider:'fixture',title:'2025年年度报告'},retrievedAt:'2026-10-14',title:'2025年年度报告',publisher:'公司',contentHash:'fixture',content:'汽车、汽车相关产品及其他产品收入占比80.68%。\n手机部件、组装及其他产品收入占比19.31%。',rights:{accessScope:'public' as const,retentionAllowed:true,aiProcessingAllowed:true,derivativeKnowledgeAllowed:true,redistributionAllowed:false}}
  const sourcedMethod:CompanyResearchMethodResult={...method,findings:[{text:'已披露产品收入类别。',kind:'fact',evidence:[{sourceCandidateId:'annual',location:'paragraph:1'},{sourceCandidateId:'annual',location:'paragraph:2'}]}],sections:[{id:'company-overview',markdown:'已披露类别 [annual@paragraph:1] [annual@paragraph:2]'}],executionEvidence:[{sourceCandidateId:'annual',title:annual.title,publisher:'公司',excerpts:annual.content.split('\n').map((text,index)=>({sourceCandidateId:'annual',location:`paragraph:${index+1}`,text}))}]}
  const executor:ReasoningExecutor={capabilities,execute:async request=>({operation:request.operation,output:{sections:ids.map(id=>({id,markdown:id==='investment-thesis'?'手机部件、组装及其他产品收入占比19.31%。 [annual@paragraph:1]':'有证据的定性结论。[annual@paragraph:1]',sourceCandidateIds:['annual']}))}})}
  const result=await assembleCompanyResearch({...input,sources:[annual]},[sourcedMethod],executor,()=>input.asOf)
  assert.equal(result.synthesisMode,'reasoning_executor',JSON.stringify(result.synthesisDiagnostics))
  assert.match(result.sections.find(section=>section.id==='investment-thesis')!.markdown,/\[annual@paragraph:2\]/)
})

test('R91 split industry margin repair keeps only the unique industry evidence package', async () => {
  const lines = [
    '半年报财务数据',
    '单位：元',
    '营业收入 营业成本 毛利率',
    '营业收入',
    '比上年同期',
    '期增减',
    '营业成本',
    '比上年同期',
    '期增减',
    '毛利率比',
    '上年同期',
    '增减',
    '分行业',
    '日用电子器件制造业 69,404,994,000.00 65,907,931,000.00 5.04% 0.96% 3.88% -2.67%',
    '交通运输设备及电气制造业 275,341,358,000.00 213,863,297,000.00 22.33% -8.98% -11.24% 1.98%',
    '分产品',
    '电子及其他产品 69,404,994,000.00 65,907,931,000.00 5.04% 0.96% 3.88% -2.67%',
  ]
  const annual = { candidate: { candidateId: 'half', kind: 'official_disclosure' as const, tier: 1 as const, provider: 'fixture', title: '2026年半年度报告' }, retrievedAt: '2026-10-14', title: '2026年半年度报告', publisher: '公司', contentHash: 'fixture', content: lines.join('\n'), rights: { accessScope: 'public' as const, retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false } }
  const excerpts = lines.map((text, index) => ({ sourceCandidateId: 'half', location: `paragraph:${index + 1}`, text }))
  const sourcedMethod: CompanyResearchMethodResult = { ...method, sourceCandidateIds: ['half'], findings: [{ text: '半年度分行业毛利率披露。', kind: 'fact', evidence: excerpts.map(excerpt => ({ sourceCandidateId: 'half', location: excerpt.location })) }], sections: [{ id: 'financial-quality', markdown: '分行业披露 [half@paragraph:14]' }], executionEvidence: [{ sourceCandidateId: 'half', title: annual.title, publisher: '公司', excerpts }] }
  const initialRefs = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17].map(paragraph => `[half@paragraph:${paragraph}]`).join(' ')
  const claim = `日用电子器件制造业毛利率5.04%，同比下降2.67%。 ${initialRefs}`
  const repairedClaim = `日用电子器件制造业毛利率5.04%，同比下降2.67%。 ${[2,10,11,12,13,14].map(paragraph => `[half@paragraph:${paragraph}]`).join(' ')}`
  let calls = 0
  const executor: ReasoningExecutor = { capabilities, execute: async request => {
    calls++
    return { operation: request.operation, output: { sections: ids.map(id => ({ id, markdown: id === 'investment-thesis' ? calls === 1 ? claim : repairedClaim : '半年度披露支持该定性判断。[half@paragraph:1]', sourceCandidateIds: ['half'] })) } }
  } }
  const result = await assembleCompanyResearch({ ...input, sources: [annual], reportSourceCandidateIds: ['half'], durableSourceCandidateIds: ['half'] }, [sourcedMethod], executor, () => input.asOf)
  assert.equal(calls, 1, `deterministic synthesis repair adds the exact row evidence and preserves the displayed unit: ${JSON.stringify(result.synthesisDiagnostics)}`)
  assert.equal(result.synthesisMode, 'reasoning_executor', JSON.stringify(result.synthesisDiagnostics))
  const finalClaim = result.sections.find(section => section.id === 'investment-thesis')!.markdown
  const refs = [...finalClaim.matchAll(/\[(half@paragraph:\d+)\]/g)].map(match => match[1]!)
  assert.deepEqual([...new Set(refs)].sort(), ['half@paragraph:2', 'half@paragraph:10', 'half@paragraph:11', 'half@paragraph:12', 'half@paragraph:13', 'half@paragraph:14'].sort())
  assert.equal(new Set(refs).size, refs.length)
  assert.match(finalClaim, /同比下降2\.67% \[half@paragraph:2\].*\[half@paragraph:14\]。/)
  assert.ok(!refs.includes('half@paragraph:17'), 'same-value 分产品 row must not support the industry claim')
  assert.ok(!refs.includes('half@paragraph:15'), 'unrelated industry row must not be stacked onto this claim')
})

test('final synthesis inserts distinct row citations for multiple split-header industry margins in one paragraph', async () => {
  const lines = [
    '单位：元', '营业收入 营业成本 毛利率', '营业收入', '比上年同期', '期增减',
    '营业成本', '比上年同期', '期增减', '毛利率比', '上年同期', '增减', '分行业',
    '日用电子器件制造业 69,404,994,000.00 65,907,931,000.00 5.04% 0.96% 3.88% -2.67%',
    '交通运输设备及电气制',
    '造业 275,341,358,000.00 213,863,297,000.00 22.33% -8.98% -11.24% 1.98%',
  ]
  const filing = { candidate: { candidateId: 'half', kind: 'official_disclosure' as const, tier: 1 as const, provider: 'fixture', title: '2026年半年度报告' }, retrievedAt: '2026-10-14', title: '2026年半年度报告', publisher: '公司', contentHash: 'fixture', content: lines.join('\n'), rights: { accessScope: 'public' as const, retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false } }
  const excerpts = lines.map((text, index) => ({ sourceCandidateId: 'half', location: `paragraph:${index + 1}`, text }))
  const citedMethod: CompanyResearchMethodResult = { ...method, sourceCandidateIds: ['half'], findings: [{ text: '半年报分行业披露毛利率变化。', kind: 'fact', evidence: excerpts.map(excerpt => ({ sourceCandidateId: 'half', location: excerpt.location })) }], executionEvidence: [{ sourceCandidateId: 'half', title: filing.title, publisher: '公司', excerpts }] }
  const claim = '半年报分行业表列示：日用电子器件制造业毛利率5.04%，同比下降2.67%；交通运输设备及电气制造业毛利率22.33%，同比上升1.98%。原表变化列以百分号显示，保留该单位。 [half@paragraph:1] [half@paragraph:2] [half@paragraph:3] [half@paragraph:4] [half@paragraph:5] [half@paragraph:6] [half@paragraph:7] [half@paragraph:8] [half@paragraph:9] [half@paragraph:10] [half@paragraph:11] [half@paragraph:12]'
  const executor: ReasoningExecutor = { capabilities, execute: async request => ({ operation: request.operation, output: { sections: ids.map(id => ({ id, markdown: id === 'investment-thesis' ? claim : '半年报支持该定性判断。[half@paragraph:2]', sourceCandidateIds: ['half'] })) } }) }
  const result = await assembleCompanyResearch({ ...input, sources: [filing], reportSourceCandidateIds: ['half'] }, [citedMethod], executor, () => input.asOf)
  assert.equal(result.synthesisMode, 'reasoning_executor', JSON.stringify(result.synthesisDiagnostics))
  const markdown = result.sections.find(section => section.id === 'investment-thesis')!.markdown
  const dailySentence = markdown.slice(markdown.indexOf('日用电子器件制造业'), markdown.indexOf('；'))
  const transportSentence = markdown.slice(markdown.indexOf('交通运输设备及电气制造业'), markdown.indexOf('。', markdown.indexOf('交通运输设备及电气制造业')))
  assert.match(dailySentence, /\[half@paragraph:13\]/)
  assert.match(transportSentence, /\[half@paragraph:14\].*\[half@paragraph:15\]/)
  assert.match(transportSentence, /\[half@paragraph:9\].*\[half@paragraph:10\].*\[half@paragraph:11\]/)
  assert.deepEqual([...dailySentence.matchAll(/\[(half@paragraph:\d+)\]/g)].map(match => match[1]!), ['half@paragraph:1', 'half@paragraph:9', 'half@paragraph:10', 'half@paragraph:11', 'half@paragraph:12', 'half@paragraph:13'])
  assert.deepEqual([...transportSentence.matchAll(/\[(half@paragraph:\d+)\]/g)].map(match => match[1]!), ['half@paragraph:1', 'half@paragraph:9', 'half@paragraph:10', 'half@paragraph:11', 'half@paragraph:12', 'half@paragraph:14', 'half@paragraph:15'])
})

test('subtraction from a comparable year label does not create a negative-year numeric failure in final synthesis', async () => {
  const datedMethod:CompanyResearchMethodResult={...method,sourceCandidateIds:['annual'],findings:[{text:'公司报告期及同比基期已标明。',kind:'fact',evidence:[{sourceCandidateId:'annual',location:'paragraph:1'}]}],executionEvidence:[{sourceCandidateId:'annual',title:'2026年半年度报告',publisher:'公司',excerpts:[{sourceCandidateId:'annual',location:'paragraph:1',text:'2026年上半年累计财务数据与2025年同期比较。'}]}]}
  const executor:ReasoningExecutor={capabilities,execute:async request=>({operation:request.operation,output:{sections:ids.map(id=>({id,markdown:id==='investment-thesis'?'同比公式为（本期值−2025年上半年可比值）÷可比值；期间为2026年上半年。[annual@paragraph:1]':'有证据的定性结论。[annual@paragraph:1]',sourceCandidateIds:['annual']}))}})}
  const result=await assembleCompanyResearch({...input,sources:[{candidate:{candidateId:'annual'},title:'2026年半年度报告',content:'2026年上半年累计财务数据与2025年同期比较。'} as any]},[datedMethod],executor,()=>input.asOf)
  assert.equal(result.synthesisMode,'reasoning_executor',JSON.stringify(result.synthesisDiagnostics))
})
test('final synthesis preserves verified split-line dates only when both supplied paragraphs are cited', async () => {
  const datedMethod:CompanyResearchMethodResult={...method,executionEvidence:[{sourceCandidateId:'annual',title:'年报',publisher:'公司',excerpts:[{sourceCandidateId:'annual',location:'paragraph:1',text:'公司于二'},{sourceCandidateId:'annual',location:'paragraph:2',text:'零零二年六月十一日变更。'}]}],sections:[{id:'company-overview',markdown:'2002年变更 [annual@paragraph:1] [annual@paragraph:2]'}]}
  const executor=(both:boolean):ReasoningExecutor=>({capabilities,execute:async request=>({operation:request.operation,output:{sections:ids.map(id=>({id,markdown:`2002年变更影响历史口径 [annual@paragraph:1]${both?' [annual@paragraph:2]':''}`,sourceCandidateIds:['annual']}))}})})
  const datedInput={...input,sources:[{candidate:{candidateId:'annual'},title:'年报',content:'公司于二\n零零二年六月十一日变更。'}] as any}
  assert.equal((await assembleCompanyResearch(datedInput,[datedMethod],executor(true),()=>input.asOf)).synthesisMode,'reasoning_executor')
  assert.equal((await assembleCompanyResearch(datedInput,[datedMethod],executor(false),()=>input.asOf)).synthesisMode,'deterministic_fallback')
})

test('R146 product disclosures bind values to exact annual product rows and cite the prior-year annual rows', async () => {
  const excerpts = [
    ['2025',833,'单位：元'],['2025',834,'营业收入 营业成本 毛利率 营业收入比上年同期增减'],['2025',845,'分产品'],
    ['2025',850,'手机部件、组'],['2025',851,'装及其他产品 155,236,528,000.00 145,473,989,000.00 6.29% -2.74% -0.56% -2.06%'],
    ['2025',852,'汽车、汽车相'],['2025',853,'关产品及其他'],['2025',854,'产品'],['2025',855,'648,645,636,000.00 515,762,940,000.00 20.49% 5.06% 7.53% -1.82%'],
    ['2024',691,'分产品'],['2024',692,'手机部件、组装'],['2024',693,'及其他产品 159,608,576,000.00 20.54%'],['2024',694,'汽车、汽车相关'],['2024',695,'产品及其他产品 617,381,935,000.00 79.45%'],
  ] as const
  const evidence = excerpts.map(([year, paragraph, text]) => ({ sourceCandidateId: `annual-${year}`, location: `paragraph:${paragraph}`, text }))
  const refs = evidence.map(item => ({ sourceCandidateId: item.sourceCandidateId, location: item.location }))
  const productMarkdown = [
    '| 产品 | 收入、成本、毛利率 |', '|---|---|',
    '| 汽车及相关产品 | 2025年年报披露收入648,645,636,000元、成本515,762,940,000元、毛利率20.49%。[annual-2025@paragraph:833] [annual-2025@paragraph:834] [annual-2025@paragraph:852] [annual-2025@paragraph:853] [annual-2025@paragraph:854] [annual-2025@paragraph:855] |',
    '| 手机部件、组装及其他产品 | 2025年年报披露收入155,236,528,000元、成本145,473,989,000元、毛利率6.29%。[annual-2025@paragraph:833] [annual-2025@paragraph:834] [annual-2025@paragraph:845] [annual-2025@paragraph:850] [annual-2025@paragraph:851] |',
    '2024年年报的产品名称为“手机部件、组装及其他产品”与“汽车、汽车相关产品及其他产品”。',
  ].join('\n')
  const productMethod: CompanyResearchMethodResult = {
    ...method,
    sourceCandidateIds: ['annual-2025','annual-2024'],
    sections: [{ id: 'products', markdown: productMarkdown }],
    findings: [{ text: '年报披露分产品收入和成本。', kind: 'fact', evidence: refs }],
    executionEvidence: [
      { sourceCandidateId: 'annual-2025', title: '2025年年度报告', publisher: '公司', excerpts: evidence.filter(item => item.sourceCandidateId === 'annual-2025') },
      { sourceCandidateId: 'annual-2024', title: '2024年年度报告', publisher: '公司', excerpts: evidence.filter(item => item.sourceCandidateId === 'annual-2024') },
    ],
  }
  const executor: ReasoningExecutor = { capabilities, execute: async request => ({ operation: request.operation, output: { sections: ids.map(id => ({ id, markdown: '有证据支持的判断。[annual-2025@paragraph:833]', sourceCandidateIds: ['annual-2025'] })) } }) }
  const sources = (['2025','2024'] as const).map(year => {
    const rows = evidence.filter(item => item.sourceCandidateId === `annual-${year}`)
    const lines = Array.from({ length: Math.max(...rows.map(item => Number(item.location.slice('paragraph:'.length)))) }, () => '')
    for (const row of rows) lines[Number(row.location.slice('paragraph:'.length)) - 1] = row.text
    return { candidate: { candidateId: `annual-${year}` }, title: `${year}年年度报告`, content: lines.join('\n') }
  })
  const result = await assembleCompanyResearch({ ...input, sources: sources as any, reportSourceCandidateIds: ['annual-2025','annual-2024'] }, [productMethod], executor, () => input.asOf)
  const markdown = result.sections.find(section => section.id === 'products')!.markdown
  const phoneRow = markdown.split('\n').find(line => line.includes('155,236,528,000元'))!
  assert.match(phoneRow, /\[annual-2025@paragraph:850\].*\[annual-2025@paragraph:851\]/)
  assert.doesNotMatch(phoneRow, /annual-2025@paragraph:845/)
  const autoRow = markdown.split('\n').find(line => line.includes('648,645,636,000元'))!
  assert.match(autoRow, /\[annual-2025@paragraph:852\].*\[annual-2025@paragraph:853\].*\[annual-2025@paragraph:854\].*\[annual-2025@paragraph:855\]/)
  const yearComparison = markdown.split('\n').find(line => line.includes('2024年年报的产品名称'))!
  assert.match(yearComparison, /\[annual-2024@paragraph:693\].*\[annual-2024@paragraph:694\].*\[annual-2024@paragraph:695\]/)
})

test('R146 product citation repair leaves unsupported and ambiguous product values untouched', async () => {
  const excerpt = { sourceCandidateId: 'annual-2025', location: 'paragraph:845', text: '分产品' }
  const duplicatedRows = [
    { sourceCandidateId: 'annual-2025', location: 'paragraph:851', text: '手机部件、组装及其他产品 155,236,528,000.00 145,473,989,000.00 6.29%' },
    { sourceCandidateId: 'annual-2025b', location: 'paragraph:845', text: '分产品' },
    { sourceCandidateId: 'annual-2025b', location: 'paragraph:851', text: '手机部件、组装及其他产品 155,236,528,000.00 145,473,989,000.00 6.29%' },
  ]
  const claim = '| 手机部件、组装及其他产品 | 2025年年报披露收入155,236,528,000元、成本145,473,989,000元、毛利率6.29%。[annual-2025@paragraph:845] |'
  const productMethod: CompanyResearchMethodResult = {
    ...method,
    sections: [{ id: 'products', markdown: claim }],
    findings: [{ text: '产品分类标题已披露。', kind: 'fact', evidence: [excerpt, ...duplicatedRows].map(item => ({ sourceCandidateId: item.sourceCandidateId, location: item.location })) }],
    executionEvidence: [
      { sourceCandidateId: 'annual-2025', title: '2025年年度报告', publisher: '公司', excerpts: [excerpt, duplicatedRows[0]!] },
      { sourceCandidateId: 'annual-2025b', title: '2025年年度报告', publisher: '公司', excerpts: duplicatedRows.slice(1) },
    ],
  }
  const executor: ReasoningExecutor = { capabilities, execute: async request => ({ operation: request.operation, output: { sections: ids.map(id => ({ id, markdown: '有证据支持的判断。[annual-2025@paragraph:845]', sourceCandidateIds: ['annual-2025'] })) } }) }
  const result = await assembleCompanyResearch({ ...input, reportSourceCandidateIds: ['annual-2025','annual-2025b'] }, [productMethod], executor, () => input.asOf)
  assert.equal(result.sections.find(section => section.id === 'products')!.markdown, claim)
})

test('R147 product citation reconciliation derives issuer labels and annual periods from supplied rows', async () => {
  const sourceRows = [
    ['annual-2023', '2023年年度报告', 1, '单位：元'], ['annual-2023', '2023年年度报告', 2, '分产品'],
    ['annual-2023', '2023年年度报告', 3, '智能云平台服务 12,345,678.00 9,876,543.00 20.00%'],
    ['annual-2022', '2022年年度报告', 10, '分产品'], ['annual-2022', '2022年年度报告', 11, '云平台服务 6,000,000.00 4,000,000.00 33.33%'],
    ['annual-2022', '2022年年度报告', 12, '系统集成服务 4,000,000.00 3,000,000.00 25.00%'],
  ] as const
  const methodsEvidence = sourceRows.map(([sourceCandidateId, title, paragraph, text]) => ({ sourceCandidateId, title, publisher: '公司', excerpts: [{ sourceCandidateId, location: `paragraph:${paragraph}`, text }] }))
  const cited = sourceRows.map(([sourceCandidateId, , paragraph]) => ({ sourceCandidateId, location: `paragraph:${paragraph}` }))
  const productMarkdown = [
    '| 产品 | 收入、成本与毛利率 |', '|---|---|',
    '| 智能云平台服务 | 2023年度报告披露收入12,345,678元、成本9,876,543元、毛利率20%。[annual-2023@paragraph:2] |',
    '2022年年报的产品名称为“云平台服务”与“系统集成服务”。',
  ].join('\n')
  const productMethod: CompanyResearchMethodResult = {
    ...method,
    sections: [{ id: 'products', markdown: productMarkdown }],
    findings: [{ text: '公司产品分类有年度披露。', kind: 'fact', evidence: cited }],
    executionEvidence: methodsEvidence,
  }
  const executor: ReasoningExecutor = { capabilities, execute: async request => ({ operation: request.operation, output: { sections: ids.map(id => ({ id, markdown: '有证据支持的判断。[annual-2023@paragraph:1]', sourceCandidateIds: ['annual-2023'] })) } }) }
  const sources = (['annual-2022','annual-2023'] as const).map(candidateId => {
    const rows = sourceRows.filter(row => row[0] === candidateId)
    const lines = Array.from({ length: Math.max(...rows.map(row => row[2])) }, () => '')
    for (const [, , paragraph, text] of rows) lines[paragraph - 1] = text
    const year = candidateId.slice('annual-'.length)
    return { candidate: { candidateId }, title: `${year}年年度报告`, content: lines.join('\n') }
  })
  const result = await assembleCompanyResearch({ ...input, sources: sources as any, company: { symbol: '600000', name: '示例科技', exchange: 'SH' }, reportSourceCandidateIds: ['annual-2022','annual-2023'] }, [productMethod], executor, () => input.asOf)
  const markdown = result.sections.find(section => section.id === 'products')!.markdown
  assert.match(markdown.split('\n').find(line => line.includes('12,345,678元'))!, /\[annual-2023@paragraph:3\]/)
  assert.match(markdown.split('\n').find(line => line.includes('2022年年报的产品名称'))!, /\[annual-2022@paragraph:11\].*\[annual-2022@paragraph:12\]/)
})

test('R147 product row repair refuses values found only under an industry heading', async () => {
  const rows = [
    { sourceCandidateId: 'annual-2023', location: 'paragraph:1', text: '分行业' },
    { sourceCandidateId: 'annual-2023', location: 'paragraph:2', text: '云计算服务 12,345,678.00 9,876,543.00 20.00%' },
  ]
  const claim = '| 云计算服务 | 2023年度报告披露收入12,345,678元、成本9,876,543元、毛利率20%。[annual-2023@paragraph:1] |'
  const productMethod: CompanyResearchMethodResult = {
    ...method,
    sections: [{ id: 'products', markdown: claim }],
    findings: [{ text: '行业表数据。', kind: 'fact', evidence: rows.map(row => ({ sourceCandidateId: row.sourceCandidateId, location: row.location })) }],
    executionEvidence: [{ sourceCandidateId: 'annual-2023', title: '2023年年度报告', publisher: '公司', excerpts: rows }],
  }
  const executor: ReasoningExecutor = { capabilities, execute: async request => ({ operation: request.operation, output: { sections: ids.map(id => ({ id, markdown: '有证据支持的判断。[annual-2023@paragraph:1]', sourceCandidateIds: ['annual-2023'] })) } }) }
  const result = await assembleCompanyResearch({ ...input, reportSourceCandidateIds: ['annual-2023'] }, [productMethod], executor, () => input.asOf)
  assert.equal(result.sections.find(section => section.id === 'products')!.markdown, claim)
})

test('product lifecycle evidence is ordered before unrelated feature evidence in a product row', async () => {
  const productMarkdown = '| 海豹08 | 公司页面称续航与售价信息。[product-page@paragraph:337] 报道称为下线车型。[product-news@paragraph:331] |'
  const productMethod: CompanyResearchMethodResult = {
    ...method,
    sections: [{ id: 'products', markdown: productMarkdown }],
    findings: [{ text: '车型信息与下线进度。', kind: 'fact', evidence: [
      { sourceCandidateId: 'product-page', location: 'paragraph:337' },
      { sourceCandidateId: 'product-news', location: 'paragraph:331' },
    ] }],
    executionEvidence: [
      { sourceCandidateId: 'product-page', title: '产品页', publisher: '公司', excerpts: [{ sourceCandidateId: 'product-page', location: 'paragraph:337', text: '海豹08车型定位、售价和配置。' }] },
      { sourceCandidateId: 'product-news', title: '下线报道', publisher: '媒体', excerpts: [{ sourceCandidateId: 'product-news', location: 'paragraph:331', text: '海豹08下线。' }] },
    ],
  }
  const executor: ReasoningExecutor = { capabilities, execute: async request => ({ operation: request.operation, output: { sections: ids.map(id => ({ id, markdown: '有证据支持的判断。[product-page@paragraph:337]', sourceCandidateIds: ['product-page'] })) } }) }
  const result = await assembleCompanyResearch({ ...input, sources: [
    { candidate: { candidateId: 'product-page' }, title: '产品页', content: `${'\n'.repeat(336)}海豹08车型定位、售价和配置。` },
    { candidate: { candidateId: 'product-news' }, title: '下线报道', content: `${'\n'.repeat(330)}海豹08下线。` },
  ] as any, reportSourceCandidateIds: ['product-page', 'product-news'] }, [productMethod], executor, () => input.asOf)
  assert.match(result.sections.find(section => section.id === 'products')!.markdown, /\[product-news@paragraph:331\].*\[product-page@paragraph:337\]/)
})
