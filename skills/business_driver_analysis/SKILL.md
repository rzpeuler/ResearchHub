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

Every numeric finding must cite the exact supplied data row for each reported
value. For split PDF tables, cite the numeric continuation row as well as the
complete matching header; a label row, another segment row, or a similar value
from a different product table cannot support the claim. Place monetary units
inside the table header or value cell. If a required row or locator is absent,
remove that number or state the specific evidence gap rather than inferring it.
When a PDF splits a segment label from its numeric continuation, cite both the
label row and the matching numeric row in each finding; never reuse a neighboring
segment's numeric row. Keep the sourceCandidateId and paragraph locator copied
from the same evidence item.

## 公司首次覆盖执行流程

1. **先确认可比期间。** 固定当前与上年同期间的公司范围、币种、单位、会计口径及累计/单季基础；并购并表、出售业务、追溯重述、汇率和股数变化须单列。季度累计差值只有在相容的已披露输入及确定性结果存在时才可使用。
   数量数据必须沿用原报告名称和统计期间：年报中的全年产量/销量只能称年度数据，不得改称半年报或半年度增长；没有可比来源时删除增长数值并写明缺口。并购并表带来的数量变化不得称为有机增长，除非有相同范围的可比数据支持。
2. **建立分部与量价事实表。** 整理合并及分部收入、利润、销量/出货、价格/ASP、产品组合、产能/利用率和成本输入，每项附期间与来源。销量不等于收入确认量，订单不等于收入；产品型号、地区和渠道组合不能混作纯价格变化。
   **先锁定来源维度和原始标签。** 为每个用于分析的事实绑定“报告期间＋原表标题＋分行业/分产品/分地区区段＋完整行标签＋数值行定位”，之后写入 `findings`、收入驱动、增长驱动和催化章节时沿用这组身份。完整行标签逐字复制，只可拼接原文中明确相邻的跨段标签，不得用简称、同义词、业务俗称或其他报告的名称替换。相同金额、占比或增速可能同时出现在分行业和分产品两张表，数值相等不证明标签或维度可互换，也不证明两个报告期间的产品范围一致。若叙述以“分行业表”开头，后续每一行都必须来自该表的行业区段；分产品事实另起一段明确标记，不能在同一句中接入产品名。行业和产品可做概念性联系，但必须单列为推断，不得改写披露事实的标签。
3. **使用已有计算器。** 采用 `calculateBusinessDriverAnalysis` 及 Workflow 给定结果，呈现总变化、可量化贡献和残差。量价拆分只有同一产品范围的量、价同时可比才成立；交叉项采用计算器约定并披露，不能把混合影响重复放入量与价。分部贡献与合并变化不重复相加。
4. **解释增长链与利润桥。** 从客户需求、订单/交付、产能、量价组合连接到收入、毛利、费用和现金，分别说明已测量归因与有证据的定性解释。收入增长而利润下降时，核查降价、组合、产能爬坡、投入或一次性项目；不能仅以总增长倒推出销量或市场份额。 解释分部毛利率时，先逐列核对同表、同期间、同口径的收入与成本增速及毛利率变化方向；正收入与正成本下，成本增长快于收入意味着毛利率承压，不得将大小关系或因果方向写反。合并境外收入不等于汽车或任一分部的海外收入；产量、销量、出货量和库存量逐项保留原始名称，不得互借同一数值。
   分行业表与分产品表必须分别标记、分别陈述；不能用“分行业/分产品”把不同表的标签合并，也不能把某行业行写成产品行。代码输出的 `A−B` 差额必须保留符号；当差额为负时，文字比较方向应写成“A低于B”，不能反用绝对值说“A高于B”。
   **分行业毛利率的安全重述格式：** 逐字保留原表行业标签、期间、毛利率水平、变化方向及显示单位。变化列以百分号显示时，只按原列名和原单位陈述披露事实，不自行改称百分点；只有明确披露或代码根据两个毛利率水平计算出的差才使用“个百分点”。若行业名跨段，每个数值陈述分别引用标签段、匹配的数值续行及证明列义的完整表头；只引表头或邻近分部行不构成数字依据。“分行业表列示”只能作引导语，不并入行业名称。
   **已知事实与缺口分别列账。** 先在本次允许原文中核对每张表的完整标签、单位、期间和数值续行，列出可引用的收入金额、占比、收入及成本增速、毛利率和披露变化；再列实际缺少的销量、价格、组合与分部利润。缺少量价拆分不代表收入结构未披露，缺少分部利润不代表毛利率行不存在。缺少唯一对应数值行时仅保留该项缺口，不可照抄审查意见中的数值和定位。监控项应以已知事实为带时点基线，说明后续需更新的指标。
5. **最强反证。** 对主要增长解释检验替代原因：并表、低基数、汇率、价格让利、渠道库存、收入确认时点等。指出哪项证据支持或排除替代原因；无法分解的变化保留残差和方向性判断，不制造闭合增长桥。
6. **监控与发布。** 将增长条件及催化连接到披露的经营指标和观察期间，说明什么变化会推翻驱动判断。缺输入时明确需要的量价/分部口径及缺失影响。所属 `sections` 应发布贡献表、实质解释、反证与限制；方法 `markdown` 只作总结，不能替代章节内容。
   **发布前逐项回读来源。** 对 `revenue-profit-drivers`、`growth-drivers`、`catalysts` 及每条 finding，逐项核对上述期间、维度、完整标签和引用；同一事实在不同章节重复出现时仍复制本期原表名称，不把某年的标签平移到另一年。若无法由所给区段标题和行定位唯一确认身份，删除该数字归因并写明缺少的定位或范围，不根据金额匹配猜改标签，也不把其他方法或审查意见视为标签证据。

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
