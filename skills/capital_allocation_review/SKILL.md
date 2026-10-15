# Capital Allocation Review

## Purpose

Review attributable capital actions and calculate bounded capital-intensity,
payout, leverage, share-count, and acquisition metrics.

## Invocation Match

Use for CapEx, M&A, buybacks, dividends, debt repayment, cash accumulation, or
economically relevant R&D questions with dated evidence. Do not infer that an
action created value merely because it occurred.

## Typical Intents

- “How much capital did the company return or reinvest?”
- “Did the acquisition clear an explicit return hurdle?”

## Inputs

Dated actions, amounts and units, period context such as revenue/net income or
market capitalization, optional share/debt observations, subsequent outcomes,
and source references.

## Produces

Deterministic capital metrics plus `value_supported`, `value_destroyed`, or
`inconclusive`. Value assessment is limited to organic CapEx, acquisitions, and
R&D/reinvestment, and requires attributable return, hurdle, action amount, and
subsequent outcome evidence.

## Methodology

For company first coverage, trace dated R&D, capital expenditure, acquisitions, financing, dividends and buybacks to strategic purpose, funding and subsequent results. Separate announced investment from deployed capital and realized return. Explain competing uses of cash and remaining execution risk. Use deterministic action metrics only with aligned attributable inputs; absent return or hurdle data prohibit declaring value creation but do not prevent describing the decision.

Calculate only ratios supported by explicit denominators. Preserve action type,
period, source references, and unavailable metrics independently. Do not apply
an incremental-return/hurdle test to dividends, buybacks, debt repayment, cash
accumulation, or generic actions.

## 公司首次覆盖执行流程

1. **行动证据台账。** 整理研发、资本开支、并购、融资、偿债、分红和回购的日期、金额/单位、实际实施状态、资金来源与战略目的。公告授权额度、已支付现金、承诺投资及累计实施分别记录；研发费用不能默认为全部研发现金流或资本开支。
2. **确定性指标与口径。** 使用 `assessCapitalAllocation` 的行动分类、资本强度、派息/股数/杠杆变化及适用诊断。分母必须同期间、同币种且有归属；回购注销与员工激励净发股分开。不同科目重叠时不能把总投资、并购现金和资本开支重复相加。
3. **资金用途与机会成本。** 在所属章节发布“行动—实际投入—融资方式—目的—后续结果—证据/限制”表格，解释经营现金能否支撑投入、对债务与流动性的影响，以及再投资、偿债和股东回报之间的取舍。规模大或公告积极不等于决策优秀。
4. **资本回报审查。** 对有适用证据的有机资本开支、并购和研发，区分建设/整合期、实现收入与实现增量回报；只使用有来源的回报、门槛及后续结果进行比较。没有增量回报或机会成本数据时保持 `inconclusive`，可解释执行进展，不能套行业 WACC、假设协同或自创回收期。
5. **最强反证。** 检查产能利用不达预期、并购减值/整合受阻、持续稀释、投入上升而经营现金恶化等实际材料；同时检验短期费用与长期成果的时间错配。不得将一般回购、分红或偿债机械套入增量投资回报门槛测试。
6. **监控与发布。** 指定投入兑现、产能爬坡、并购整合、现金来源与融资期限等观察项及判断变化条件。缺口指出缺哪个行动/后续结果/回报口径及其影响。完整台账、专业解释、反证与适用性限制必须进入所属 `sections`，不能只在摘要中评价资本配置。

本方法保持同级原子边界，不调用其他 Skill、不检索或写入；Workflow 负责资料补采集、重试与最终报告组装。所有回报判断必须受具体证据与计算器适用范围约束。

## Evidence Requirements

Every action and subsequent outcome must be attributable and within the as-of
boundary. Value creation requires explicit return, hurdle, action amount, and
subsequent operating/economic outcome evidence.

## Deterministic / Model Boundary

Code owns amount validation, ratios, changes, action-type applicability, and
hurdle comparison. A model may summarize strategic rationale but may not invent
a return, price paid, or economic outcome.

## Missing Data

Missing denominators or value-assessment evidence remain unavailable or
inconclusive and are never replaced with industry defaults.

## Validation / QC

Reject duplicate IDs, future actions, negative amounts, absent units, and
unattributed outcomes. Keep value judgments bounded to explicit metrics.

## Related Skills

`management_execution`, `financial_quality_analysis`, and
`business_driver_analysis` are peer methods composed by a Company Workflow.
