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
3. **可复算的规模方法。** 优先引用口径清楚的披露；公式法需给出“市场边界—算式—每个操作数的单位/期间/出处—事实或假设—输出单位”。例如需求数量与同范围单价的乘法仅在输入均有证据且单位成立时适用。数值由已有 `calculateCompanyTam` 结果提供，模型不能心算补数字或发明渗透率。
4. **防重叠与可比校验。** 使用 `analyzeMarketStructure` 既有边界/估计校验与冲突标签。多个市场相加前必须证明地域、客户或产品范围互斥，解释集团纵向环节的重复收入；TAM、可服务市场及公司可获得份额分别说明，不把 TAM 视为公司收入预测。不同年份、地区或方法的估计分别保留，禁止平均冲突来源。
5. **最强反证。** 对需求扩张、价值迁移或 TAM 判断检查替代技术、需求饱和、政策变化、单位价值下降及统计边界扩大等实际证据。解释它削弱数量、价格或可服务边界中的哪一项；有来源的假设须显式标记，不能伪装披露事实。
6. **监控与发布。** 所属章节给出边界/产业链表、市场驱动和约束、公式或规模缺口、最强反证及观察项。缺口说明缺哪个操作数或边界证明、已供材料为何不足及其影响；没有数值 TAM 时仍发布有证据的行业机制分析。

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
