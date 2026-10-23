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
2. **逐项使用计算器。** 采用 `calculateFinancialQualityAnalysis` 已有输出呈现现金转化、自由现金流、应计、DSO/DIO/DPO 与现金周期。Workflow提供 `workingCapitalCalculations` 时，逐项照录其操作数、单位、期间天数与公式；只报告对应计算结果，不能从报告记忆或原始余额自行估算周转天数。营业成本和应付账款须采用相应科目，不能把全部营业支出或全部负债替代。平均余额、净利润为零或负值等限制按计算器诊断保留；一个比率缺失不抹掉其他可用结果。
3. **三表勾连解释。** Workflow 会在通过验证的方法章节后附上确定性三表对照、公式及来源，不要求模型重新抄写整张数值表。模型应解释收入、毛利/费用、净利润、经营现金与资本支出的关系。应收/存货变化结合销售、采购、结算条款和业务组合；现金增加需区分经营回款、融资与资产处置，不能等同经营改善。
4. **利润质地与财务弹性。** 用附注核查非经常损益、减值、补助、研发费用化/资本化及并购影响；同时讨论现金、债务、期限、利息与融资约束。只在有可比事实和确定性结果时给出比例或变化；缺债务期限资料时不能宣称再融资风险可控。
5. **最强反证。** 对“现金质量改善/恶化”检验季节性、客户预付款、供应商账期、税费、票据及一次性项目等替代解释，区分短期波动与持续迹象。筛查旗标是后续调查线索，绝不是欺诈、操纵或审计结论。
6. **监控与具体缺口。** 给出应持续观察的科目、经营指标、同口径期间及论点改变的条件；无依据不指定绝对安全阈值。最终章节须包含代码提供的结果表、模型的三表解释、最强反证和科目缺口，引用关联到实际披露或确定性结果；不能只复制原始财务行。

7. **增长背离的可复算展示。** 若报告指出应收、存货或经营现金流增速与收入增速相差若干个百分点，必须并列给出两个同期间增速、差值公式、单位和比较日期，并标明期末余额或累计流量。代码计算结果应使用原始未四舍五入值；报告的显示精度应足以复核。背离只是调查信号，不单独证明回款恶化、收入失实或盈余管理。

8. **余额变动口径。** 期末余额同比与较上年末变化是不同比较。只有在 `preparedAnalysis` 明确提供同科目、同币种及同单位的确定性变动值时，才报告较上年末增加/减少金额，并同时写明两个期间、公式及单位；否则保留已披露的期末余额与可复算同比，不自行补算“增加X亿元”等表格数值。

数值表由代码提供，专业解释应优先围绕方向、因果链、替代解释、科目范围和论点改变条件展开，不为重复表格而增加数字。需要突出金额时，只能逐字复制 `financialReadableTable` 对应的期间/科目/金额/单位和原始来源定位；不存在对应展示值就沿用原始金额与单位，不自行换算。财报附注数字也必须核对报告年份与该条论点自己的引用，不从其他年度或记忆补数。

结构化人民币数据可按 `financialReadableTable` 的两位小数亿元展示，或使用已引用来源的原始金额及原单位。不能把确定性金额自行换算成未经代码提供的高精度小数；若使用表内派生百分点，照录代码结果及其期间和科目口径。

每个财务表格的金额单位必须写在该表列标题或金额单元格中；表格外的说明句不能为无单位的金额格提供口径。自由现金流等代码派生指标应在表格和文字中都标注单位，并保留对应期间及累计/单季基础。

引用 PDF 分行业/分产品毛利率时，必须同时引用对应数值行和完整的相关表头段落。表头可能拆成相邻定位段落，例如先出现“营业收入、营业成本、毛利率”，再分别出现“上年同期”和“增减”；此时要逐一引用从指标名到变化列标签的每段，即使中间段只写“上年同期”或“增减”。单独引用“毛利率”或“毛利率比”不能证明后续百分比列是变化值。必须逐列核对毛利率水平、收入增减、成本增减与毛利率增减，不能把同一行的收入或成本增速当作毛利率变动。**变化列的原始显示单位优先于分析者的换算：若报告表格以百分号列示“毛利率比上年同期增减”，须按披露百分比写“同比增加/下降X%”，不得改称“X个百分点”；只有明确披露或由代码根据两个毛利率水平确定的百分点差，才可写百分点。**

重述分行业毛利率时，逐字保留所引报告的行业名称和变化单位，行业标签跨 PDF 段落时，同时引用标签段、数值续行和完整变化列头。分行业、分产品、合并口径分别呈现，不能用另一张表的类似业务标签替换原行名。示例、框架和此前修订中的公司数据均不构成本次证据。

确定性计算接口本身不调用模型。本节专业解释通过 Workflow 现有语义边界形成，不进行外部 I/O、不调用同级 Skill；补采集及重试由 Workflow 负责。缺失和冲突不能补零或用行业均值替代。

## Evidence Requirements

Facts must be explicitly attributable to the requested periods. Current/opening
balances are required for working-capital and accrual calculations; current and
prior-comparable facts are required for growth divergence comparisons.
For any ratio change from `preparedAnalysis.financial.ratioChanges`, use its
deterministic current value, prior value, and change together. If showing the
subtraction, retain enough operand precision for the displayed result to be
recalculated; four-decimal operands can differ from a four-decimal result after
rounding. Otherwise state the deterministic change without presenting a
misleading lower-precision equation.

Every numeric statement in a finding must be supported by that finding's own
`evidence` references to the exact numeric data row(s), plus the matching
period, unit, and table-header rows when needed to establish scope. A citation
in the financial-quality section, another finding, or a neighboring table row
does not authorize a number in this finding. If the finding cannot carry its
own exact references, remove the numeric claim or state the specific evidence
gap; do not borrow sibling locators.

## Deterministic / Model Boundary

Code owns normalization, period alignment, ratios, deltas, finite-value checks,
and thresholds. A model may explain a flag, but this Skill does not call a
model and never turns a flag into a manipulation or fraud finding.

## Missing Data

Missing, malformed, zero-denominator, or non-comparable inputs remain
`unavailable` at the component level. Missing is never zero-filled.

Workflow 提供的结构化财务来源可在同一个 `paragraph:1` 中以 JSON 列示多个期间、指标、单位和口径；这仍是可引用的原始结构化数据，不要求每个指标另有独立段落。逐数值精确引用的含义是该引用正文确实包含对应期间、指标及元数据，不能因多个值共用一个有效 JSON 段落就声称缺少定位或拒绝三表分析。正文按表格行分别附同一真实定位即可；不得编造 JSON 字段路径为新的 paragraph 定位。

当结构化财务原文和确定性结果已提供可比三表数据时，应完成可支持的期间比较、现金转化及资产负债分析；净利润归属未注明、缺账龄/库龄/项目回报或债务期限，只限制相应结论，不否认这些已取得的三表事实。仅核心三表及其期间/单位确实无法核验，致使主要研究问题无法回答时，才返回整体 `insufficient_evidence`。

## Validation / QC

Reject invalid thresholds, preserve unavailable fields, ensure all output
numbers are finite, and keep diagnostics bounded and source-linked.

## Related Skills

`earnings_variance_analysis`, `business_driver_analysis`, and `unit_economics`
are peer analytical methods composed by a Workflow.
