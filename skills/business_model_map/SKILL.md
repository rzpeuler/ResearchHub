# Business Model Map

## Purpose

Explain how a company creates, delivers, and captures economic value across
products, customers, segments, and channels.

## Invocation Match

Use this Skill when the question asks what a company sells, who pays, or how
the business model fits together. Do not use it to attribute a period's growth
to volume/price/mix or to calculate unit economics.

## Typical Intents

- “What does this company actually make money from?”
- “Who are the customers and how do the segments connect?”

## Inputs

Company identity, products/services, customer types, segments, pricing/revenue
mechanisms, channels, supply/value-chain relationships, period/as-of, and
source refs.

## Produces

A bounded model map with revenue mechanisms, segment relationships, customer
and channel roles, evidence bindings, and explicit gaps.

## Methodology

First-coverage analysis must explain the paying customer, buying decision, product/service, pricing, fulfillment and revenue recognition for each material segment. Connect segment economics to suppliers, distribution and working capital. Identify disclosed scale/network/technology advantages and conditions under which they fail. Produce a readable segment table; unknown customer concentration or revenue shares remain gaps, not industry stereotypes.

Separate product, customer, channel, monetization, cost/value-chain, and
segment relationships; distinguish disclosed facts from interpretation; map
each relationship to supplied evidence; and preserve alternative or unknown
mechanisms as gaps.

## 公司首次覆盖执行流程

1. **证据到业务边界。** 依据提供的年报、分部附注及官方产品资料，确认合并主体、主要分部、产品与客户类型。建立“产品/服务—实际使用者—付费者—采购决策—交付方式—收入确认”关系；集团、子公司、品牌和产品线分别标明，不能把全集团规模归给单一业务。
2. **分部经济表。** 在所属 `sections` 中给出分部、客户需求、收入机制、供应链角色、已披露规模/利润口径、来源与期间的可读表格。分部收入与外部客户收入、内部交易抵销分开；没有分部利润或客户集中度时填写具体缺口，不把合并毛利率当成所有业务的毛利率。
3. **确定性检查。** 采用 Workflow 提供的结构化事实和已有确定性结果检查分部合计、占比与币种、期间；没有已验证计算结果时不心算补比例。解释口径差异或抵销项，不能调整原始数字使其凑齐。商业模式图与关系校验不替代增长归因计算。
4. **解释现金与价值形成。** 逐项回答为什么客户购买、定价依据是什么、公司承担哪些生产/库存/信用风险、回款周期如何影响现金，以及研发、渠道、产能与售后如何支持收入。把披露事实与“可能产生议价权”的推断分开；只有有具体机制和证据的优势才能讨论持续性。
5. **最强反证。** 选择最能削弱主要模式判断的实际材料，例如客户可切换、代工议价弱、产品替代、内部交易占比或增长未转化为现金；解释它影响哪条因果链、在哪些条件下使判断失效。缺反证材料时说明证据边界，不写“未发现风险”作为安全结论。
6. **监控与发布。** 对主要判断给出可观测指标、期间与判断改变的条件；无来源阈值不自创数字。缺口注明需要何种材料、已给定来源的不足及对结论的影响，提交 Workflow 补采集。每个所属 `section` 必须包含完整表格、因果解释、反证和引用，不能把分析仅放在未发布的摘要字段。

本方法是同级原子 Skill，不调用 peer Skill、不进行检索或文件 I/O；补采集、重试和预算由 Workflow 控制。只研究提供的证据，不能用行业惯例补成公司事实。

## Evidence Requirements

Use attributable company filings, official materials, or bounded industry
evidence with an explicit as-of boundary. A generic company description is not
evidence of a monetization mechanism.

## Deterministic / Model Boundary

Code owns source/reference validation, identity, and output bounds. The model
may synthesize the map from supplied evidence but may not invent customers,
segments, prices, or revenue shares.

## Missing Data

Unknown monetization, customer, or segment relationships are `unavailable` or
research gaps, never inferred from a typical industry pattern.

## Validation / QC

Every material edge must have a source reference; facts and interpretations are
separate; and no edge may reference a different company.

## Related Skills

`business_driver_analysis`, `unit_economics`, and `market_structure_analysis`
are peer methods selected by a Workflow.
