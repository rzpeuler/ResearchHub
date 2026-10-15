# Business Driver Analysis

## Purpose

Attribute a company's consolidated revenue or profit change to explicit
business drivers such as volume, price, mix, segment, or cost inputs.

## Invocation Match

Use this Skill when the question asks whether growth came from volume, price,
mix, segment, or cost drivers. Do not use it for a generic business model map
or for per-customer/unit economics.

## Typical Intents

- “Was revenue growth driven by volume, price, or mix?”
- “Which segment explains the change in operating profit?”

## Inputs

Two comparable periods, consolidated and segment financials, operating KPIs,
volume/price/mix disclosures when available, units, as-of boundary, and source
refs.

## Produces

A period-aligned driver decomposition, contribution diagnostics, confidence and
availability flags, evidence bindings, and unresolved gaps.

## Methodology

For company first coverage, explain the causal bridge from demand and capacity through volume, price and mix to revenue, margins and cash. Use the existing deterministic calculation result for contribution values and residuals; semantic analysis must distinguish measured attribution from a qualitative explanation. Link growth conditions, catalysts and monitoring indicators to disclosed segment/KPI evidence, and state alternate explanations when driver data are absent.

Align periods and units; prefer disclosed driver bridges; calculate only
deterministic decompositions supported by supplied numbers; separate direct
contributions from plausible explanations; and preserve residual/unattributed
change rather than forcing a complete bridge.

## 公司首次覆盖执行流程

1. **先确认可比期间。** 固定当前与上年同期间的公司范围、币种、单位、会计口径及累计/单季基础；并购并表、出售业务、追溯重述、汇率和股数变化须单列。季度累计差值只有在相容的已披露输入及确定性结果存在时才可使用。
2. **建立分部与量价事实表。** 整理合并及分部收入、利润、销量/出货、价格/ASP、产品组合、产能/利用率和成本输入，每项附期间与来源。销量不等于收入确认量，订单不等于收入；产品型号、地区和渠道组合不能混作纯价格变化。
3. **使用已有计算器。** 采用 `calculateBusinessDriverAnalysis` 及 Workflow 给定结果，呈现总变化、可量化贡献和残差。量价拆分只有同一产品范围的量、价同时可比才成立；交叉项采用计算器约定并披露，不能把混合影响重复放入量与价。分部贡献与合并变化不重复相加。
4. **解释增长链与利润桥。** 从客户需求、订单/交付、产能、量价组合连接到收入、毛利、费用和现金，分别说明已测量归因与有证据的定性解释。收入增长而利润下降时，核查降价、组合、产能爬坡、投入或一次性项目；不能仅以总增长倒推出销量或市场份额。
5. **最强反证。** 对主要增长解释检验替代原因：并表、低基数、汇率、价格让利、渠道库存、收入确认时点等。指出哪项证据支持或排除替代原因；无法分解的变化保留残差和方向性判断，不制造闭合增长桥。
6. **监控与发布。** 将增长条件及催化连接到披露的经营指标和观察期间，说明什么变化会推翻驱动判断。缺输入时明确需要的量价/分部口径及缺失影响。所属 `sections` 应发布贡献表、实质解释、反证与限制；方法 `markdown` 只作总结，不能替代章节内容。

本方法不调用同级 Skill、不获取外部数据；Workflow 负责补采集与有界重试。缺失驱动不能补零，无来源预测或行业平均不能冒充公司输入。

## Evidence Requirements

Actual financials and operating drivers must be attributable to the same
periods. A narrative claim about volume or price without a metric is
interpretive context, not a quantified driver.

## Deterministic / Model Boundary

Code owns period matching, arithmetic, and residuals. The model may explain a
bounded causal chain but cannot invent volume, price, mix, or segment values.

## Missing Data

Missing driver data is `unavailable` and the residual remains explicit; it is
never zero-filled or inferred from total growth alone.

## Validation / QC

Check units, period identity, finite values, contribution totals, residual
signs, and source refs. Do not claim a full bridge when material residuals are
unresolved.

## Related Skills

`business_model_map`, `unit_economics`, and `earnings_variance_analysis` are
peer methods composed by a Workflow.
