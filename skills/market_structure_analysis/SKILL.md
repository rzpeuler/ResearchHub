# Market Structure Analysis

## Purpose

Define a bounded market, its segmentation, sizing methodology, participants,
and value-chain relationships from attributable evidence.

## Invocation Match

Use for questions about what belongs in a market, how it is segmented, and how
value flows. Do not use for a supply-demand cycle or a competitor ranking.

## Typical Intents

- “How should this market be defined and divided?”
- “What is the source-backed market size on a comparable basis?”

## Inputs

Included/excluded boundary, edge cases, geography, period, unit, one primary
segmentation axis, estimates with method metadata, value-chain nodes, and
source references.

## Produces

An explicit boundary, segmentation, separately preserved market estimates,
reconciliations, and source-linked value-chain map.

## Methodology

For first coverage, define product, geography, customer and time boundaries separately for every material market. Explain participants, value-chain roles, demand drivers, policy and substitution. TAM may use a disclosed comparable estimate or an explicit evidence-bound formula evaluated by code; preserve operand sources, units, assumptions and overlap exclusions. Do not sum overlapping addressable markets or invent a numeric TAM to make a section look complete.

Validate scope before accepting any estimate. Preserve estimates with different
definitions, periods, geographies, units, or methods; never average them.

## 公司首次覆盖执行流程

1. **市场边界先行。** 对每项主要业务写明产品、客户用途、地域、期间和价值链层级，并列纳入/排除项及替代品。整车、部件、材料、终端销售额与制造端收入不可混作同一市场；每个细分结果只使用一个清楚的主分轴。
2. **证据到行业结构。** 结合给定官方、协会或有出处的行业正文，说明需求来源、采购方式、供给参与者、政策、技术替代及价值分配，区分公司披露与行业估计。材料只能支撑结构时仍应完成定性研究，不能因缺数字把整章写成空白。
3. **行业预测与公司 TAM 分开。** 若材料已提供全球或细分行业规模预测，必须按市场边界分别列示规模、预测年份、币种/单位、预测机构和来源归属（例如公司年报转述第三方预测），并标记为行业背景预测。它不等于公司可服务市场、公司 TAM、收入预测或公司份额；PCB、数通光模块和电信模块等不同边界不得相加。缺少公司产品范围、地域、客户口径或公司份额时，单独说明这些具体缺口和对公司 TAM 的影响，不得因此省略已有行业规模数字。
4. **可复算的规模方法。** 优先引用口径清楚的披露；公式法需给出“市场边界—算式—每个操作数的单位/期间/出处—事实或假设—输出单位”。例如需求数量与同范围单价的乘法仅在输入均有证据且单位成立时适用。数值由已有 `calculateCompanyTam` 结果提供，模型不能心算补数字或发明渗透率。
5. **防重叠与可比校验。** 使用 `analyzeMarketStructure` 既有边界/估计校验与冲突标签。多个市场相加前必须证明地域、客户或产品范围互斥，解释集团纵向环节的重复收入；TAM、可服务市场及公司可获得份额分别说明，不把 TAM 视为公司收入预测。不同年份、地区或方法的估计分别保留，禁止平均冲突来源。
6. **最强反证。** 对需求扩张、价值迁移或 TAM 判断检查替代技术、需求饱和、政策变化、单位价值下降及统计边界扩大等实际证据。解释它削弱数量、价格或可服务边界中的哪一项；有来源的假设须显式标记，不能伪装披露事实。
7. **监控与发布。** 所属章节给出边界/产业链表、行业规模背景（如有来源数字）、市场驱动和约束、公式或公司 TAM 缺口、最强反证及观察项。缺口说明缺哪个公司级操作数或边界证明、已供材料为何不足及其影响；没有数值公司 TAM 时仍须保留已有行业规模预测并完成有证据的行业机制分析。

公司报告中的财务表格须保留期间、单位、完整拆分表头及对应分类数据行。毛利率水平以 `%` 表示；来源披露的同比变化严格沿用原表列名和单元格单位，原表为 `%` 时不得自行改称百分点。只有代码使用两个可比毛利率水平计算差额，且报告列明两个操作数、公式及各自引用时，才以“百分点”描述该派生结果。保留原始数字和符号，不得以另一产品或行业行的毛利变化代替。

行业数据归属应区分网页发布方、原始统计机构和转述方。政府、协会或公司网站刊载第三方统计时，按实际正文写“该网站发布/转载的行业统计”，保留原始机构（若正文明确）；仅凭官方域名不能将网站发布方说成独立测算机构。正文未说明原始统计方时明确这一限制，不凭模型知识补机构名称。

本方法不调用同级 Skill、不执行搜索或抓取。Workflow 提供相关正文与确定性结果，并负责补采集/有界重试；不存在无来源市场份额、增长率或规模兜底。

## Evidence Requirements

Every boundary statement, segmentation value, estimate, and value-chain node
requires attributable source references.

## Deterministic / Model Boundary

Code owns scope validation, comparability checks, and reconciliation labels. A
model may propose search terms or explain differences but may not create TAM or
market-share numbers.

## Missing Data

Missing boundary or segmentation makes the result unavailable. Missing sizing
data is reported as unavailable; it is not estimated from a generic industry
label.

## Validation / QC

Require explicit included/excluded scope, one axis per segmentation result,
finite estimates, and preserved conflicts.

## Related Skills

`industry_supply_demand_cycle` and `competitive_market_map` are peer Industry
methods composed by the Industry Workflow.
