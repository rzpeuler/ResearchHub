# Competitive Market Map

## Purpose

Map attributable market participants, positioning, comparable peer evidence,
and competitive entry, exit, acquisition, capacity-entry, and pivot dynamics.

## Invocation Match

Use for competitor landscapes, customer overlap, positioning, and competitive
dynamics. Do not infer peer status from a broad industry label alone.

## Typical Intents

- “Which companies actually compete for the same purchase decision?”
- “Where is there a supported whitespace, and is it economically attractive?”

## Inputs

An explicit market boundary and segmentation, players with status and sourced
positioning, geography, optional scale proxies, explicit peer comparability
evidence, competitive events, whitespace evidence, and an as-of boundary.

## Produces

A sourced player map, attributable-peer assessments, competitive event map, and
a whitespace conclusion that keeps unmet need separate from economics.

## Methodology

For company coverage, compare evidence-backed competitors and alternatives by product/customer overlap, differentiation, technology/cost, distribution and commercialization. A peer table must state comparability limits and source dates. Explain why an advantage may persist and the strongest counter-evidence; never infer rank/share from unaligned shipments or an unattributed industry list. Use deterministic comparability checks when suitable prepared inputs exist.

Validate the market scope and each player first. A player is an attributable
peer only when purchase decision, workflow, economics, and customer overlap are
all explicitly supported by evidence. Entry, exit, acquisition, capacity entry,
and pivot events remain event records rather than inferred trends.

## 公司首次覆盖执行流程

1. **识别真实竞争场景。** 从主要产品和客户采购决策确定竞争边界，区分直接竞品、替代方案、相邻环节和供应商/客户。每个竞争者必须有提供材料支持其相关业务；大行业名单、估值可比公司或知名品牌不能自动变成直接竞品。
2. **建立可读比较矩阵。** 所属 `sections` 至少发布有证据的公司与竞争者/替代方案比较：目标客户及应用、产品/技术路径、性能或质量、价格/成本条件、制造/交付能力、渠道/认证、规模指标及期间、证据与可比限制。若公司横跨多个细分市场而只有一个细分市场有具名对手的可用证据，可完成这个有边界的比较，但必须逐项说明其余市场缺少的竞品或同口径输入及影响，且不得外推为全公司竞争优势。至少要有一个具体、可引用的产品/路线重叠或差异；只有行业概述、无具名参与者的竞争描述，或只列待研究对象，仍属证据不足。未知单元格标明缺口；不能用形容词代替具体差异，也不能把集团总规模拿来比较单一产品市场。
3. **适用性与确定性校验。** 采用 `analyzeCompetitiveMarketMap` 的市场边界、参与者、可比性和事件分类结果。比较份额、出货、收入或产能前核对同产品、地域、期间与单位；不匹配就分别呈现，不能排序。客户重叠、采购决策、工作流及经济性证据不足时保留候选关系，不升级为完全可比 peer。
4. **从差异解释优势。** 对每项优势说明它如何影响客户选择、成本、切换难度、质量/交付或盈利，以及复制需要什么条件。技术投入或专利数量只能是证据的一部分，不能直接等同护城河；进入、退出、并购和新增产能作为具体事件记录，不泛化成持续趋势。
5. **最强反证。** 寻找客户多源采购、竞品追赶、技术替代、价格压力、认证失效或规模未转化盈利等实际证据；说明优势最容易在哪个客户/产品场景失效。“空白市场”须分别证明未满足需求和经济性，缺后者就保持不确定，不能以竞争者少推导机会大。
6. **监控与发布。** 明确应观察的产品迭代、客户认证、竞品资本投入、价格/组合或交付指标及结论变化条件。缺口说明需要哪个竞争者业务口径或对照材料。完整矩阵、竞争机制、最强反证和限制必须进入所属章节，不能把最终报告写成无比较的公司简介。

本方法是独立同级 Skill，不调用 peer 方法、不进行外部 I/O；Workflow 负责资料获取、补采集与重试。判断只依据给定正文和校验结果，不编造排名、份额、客户或“行业公认”优势。

## Evidence Requirements

Every player, positioning statement, peer assertion, scale proxy, event, and
whitespace conclusion requires source references. Status `unknown` is valid and
does not imply active competition.

## Deterministic / Model Boundary

Code owns validation and peer/evidence classification. A model may propose
candidate players or explain positioning, but may not invent market share,
ranking, customer overlap, or economic attractiveness.

## Missing Data

Missing scope makes the result unavailable. Missing comparability evidence
means a player is not an attributable peer. Missing economics makes whitespace
inconclusive; an empty player list is never proof of a large opportunity.

## Validation / QC

Reject future evidence, invalid statuses, unsourced positioning, invalid scale
proxies, duplicate players, and unsupported peer claims. Preserve event types
and contradictory or unknown status explicitly.

## Related Skills

`market_structure_analysis` and `industry_supply_demand_cycle` are peer Industry
methods composed by the Industry Workflow.
