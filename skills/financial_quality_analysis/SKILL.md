# Financial Quality Analysis

## Purpose

Run a bounded, report-level screen of working capital, accruals, cash
conversion, and revenue-recognition divergence from explicit period facts.

## Invocation Match

Use for earnings-quality and cash-conversion diagnostics when period facts are
supplied. Do not use a screen as a fraud conclusion or as a substitute for
source acquisition.

## Typical Intents

- “Are receivables or inventory moving differently from reported sales?”
- “How well did cash conversion track net income?”

## Inputs

Normalized current, opening, and prior-comparable period facts, an explicit
divergence threshold, and the attributable source candidate ID.

## Produces

Deterministic DSO, DIO, DPO, cash conversion cycle, accrual ratio, cash
conversion, free-cash-flow, and bounded revenue-recognition follow-up flags.

## Methodology

For first coverage, compare aligned periods across the income statement, balance sheet and cash flow statement, including segment economics, receivables, inventory, debt, R&D and capital expenditure when supplied. Explain cash conversion, one-offs, capitalization and working-capital changes rather than repeat financial rows. Use the deterministic calculator for ratios and changes; retain unit/currency, cumulative versus single-period basis and publication boundary. Missing one ratio does not erase supported qualitative analysis.

Reuse the existing Wave 1 deterministic financial-quality calculations. Keep
each component independently available or unavailable, preserve period and
source identity, and return a partial result when only some components have
the required facts.

## 公司首次覆盖执行流程

1. **建立三表可比输入。** 先核对合并范围、人民币/外币、元/万元、期末余额与期间流量、累计/单季及披露时间。当前流量需匹配相应期间天数；营运资本与应计诊断需明确期初和期末。冲突、重述或未知口径独立标记，不能默选对结论有利的数据。
2. **逐项使用计算器。** 采用 `calculateFinancialQualityAnalysis` 已有输出呈现现金转化、自由现金流、应计、DSO/DIO/DPO 与现金周期。营业成本和应付账款须采用相应科目，不能把全部营业支出或全部负债替代。平均余额、净利润为零或负值等限制按计算器诊断保留；一个比率缺失不抹掉其他可用结果。
3. **三表勾连解释。** 在所属章节形成期间对照表，并解释收入、毛利/费用、净利润、经营现金与资本支出的关系。应收/存货变化结合销售、采购、结算条款和业务组合；现金增加需区分经营回款、融资与资产处置，不能等同经营改善。
4. **利润质地与财务弹性。** 用附注核查非经常损益、减值、补助、研发费用化/资本化及并购影响；同时讨论现金、债务、期限、利息与融资约束。只在有可比事实和确定性结果时给出比例或变化；缺债务期限资料时不能宣称再融资风险可控。
5. **最强反证。** 对“现金质量改善/恶化”检验季节性、客户预付款、供应商账期、税费、票据及一次性项目等替代解释，区分短期波动与持续迹象。筛查旗标是后续调查线索，绝不是欺诈、操纵或审计结论。
6. **监控与具体缺口。** 给出应持续观察的科目、经营指标、同口径期间及论点改变的条件；无依据不指定绝对安全阈值。章节必须发布结果表、三表解释、最强反证和科目缺口，引用关联到实际披露或确定性结果；不能只复制原始财务行。

确定性计算接口本身不调用模型。本节专业解释通过 Workflow 现有语义边界形成，不进行外部 I/O、不调用同级 Skill；补采集及重试由 Workflow 负责。缺失和冲突不能补零或用行业均值替代。

## Evidence Requirements

Facts must be explicitly attributable to the requested periods. Current/opening
balances are required for working-capital and accrual calculations; current and
prior-comparable facts are required for growth divergence comparisons.

## Deterministic / Model Boundary

Code owns normalization, period alignment, ratios, deltas, finite-value checks,
and thresholds. A model may explain a flag, but this Skill does not call a
model and never turns a flag into a manipulation or fraud finding.

## Missing Data

Missing, malformed, zero-denominator, or non-comparable inputs remain
`unavailable` at the component level. Missing is never zero-filled.

## Validation / QC

Reject invalid thresholds, preserve unavailable fields, ensure all output
numbers are finite, and keep diagnostics bounded and source-linked.

## Related Skills

`earnings_variance_analysis`, `business_driver_analysis`, and `unit_economics`
are peer analytical methods composed by a Workflow.
