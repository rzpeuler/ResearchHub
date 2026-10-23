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

First-coverage analysis must explain the paying customer, buying decision, product/service, pricing, fulfillment and revenue recognition for each material segment. Connect segment economics to suppliers, distribution and working capital. Identify disclosed scale/network/technology advantages and conditions under which they fail. Produce a readable segment table; unknown customer concentration ratios or revenue shares remain gaps, not industry stereotypes. Keep disclosed concentration ratios distinct from customer identity and product/segment mapping: anonymous names do not make the reported ratios unavailable.

Separate product, customer, channel, monetization, cost/value-chain, and
segment relationships; distinguish disclosed facts from interpretation; map
each relationship to supplied evidence; and preserve alternative or unknown
mechanisms as gaps.

## 公司首次覆盖执行流程

1. **证据到业务边界。** 依据提供的年报、分部附注及官方产品资料，确认合并主体、主要分部、产品与客户类型。建立“产品/服务—实际使用者—付费者—采购决策—交付方式—收入确认”关系；集团、子公司、品牌和产品线分别标明，不能把全集团规模归给单一业务。
2. **分部经济表。** 在所属 `sections` 中给出分部、客户需求、收入机制、供应链角色、已披露规模/利润口径、来源与期间的可读表格。分部收入与外部客户收入、内部交易抵销分开；没有分部利润或客户集中度比例时填写具体缺口，不把合并毛利率当成所有业务的毛利率。若年报列出前五大客户销售额/占比或最大客户占比，必须报告披露的合计及最大客户比例，并为每个比例引用对应数值行；客户名称匿名、客户所属产品/分部不明，只能作为身份和业务归属缺口，不得据此称集中度数据缺失。
3. **确定性检查。** 采用 Workflow 提供的结构化事实和已有确定性结果检查分部合计、占比与币种、期间；没有已验证计算结果时不心算补比例。解释口径差异或抵销项，不能调整原始数字使其凑齐。商业模式图与关系校验不替代增长归因计算。
4. **解释现金与价值形成。** 逐项回答为什么客户购买、定价依据是什么、公司承担哪些生产/库存/信用风险、回款周期如何影响现金，以及研发、渠道、产能与售后如何支持收入。把披露事实与“可能产生议价权”的推断分开；只有有具体机制和证据的优势才能讨论持续性。
5. **最强反证。** 选择最能削弱主要模式判断的实际材料，例如客户可切换、代工议价弱、产品替代、内部交易占比或增长未转化为现金；解释它影响哪条因果链、在哪些条件下使判断失效。缺反证材料时说明证据边界，不写“未发现风险”作为安全结论。
6. **监控与发布。** 对主要判断给出可观测指标、期间与判断改变的条件；无来源阈值不自创数字。缺口注明需要何种材料、已给定来源的不足及对结论的影响，提交 Workflow 补采集。每个所属 `section` 必须包含完整表格、因果解释、反证和引用，不能把分析仅放在未发布的摘要字段。

自由现金流、现金流与资本开支的确定性金额及差额由财务质量/资本配置方法负责；本 Skill 不复制或重算这些数字。若讨论供应链或营运资金对现金的影响，应引用直接的周转、付款条款或供需资料；资料缺失时只描述待补证的问题，不用自由现金流金额替代供应链证据。

每个所属章节的关键金额、收入占比和毛利率都要引用同一章节中相应的表头及数据行。**每句中的每个数字必须在该句末紧邻引用直接包含该数字的对应数据行；数字在另一句、表格、摘要或 finding 中重复出现时，必须在每个出现处重新引用，其他位置的引用不能回溯支持本句。**摘要合计行只能支持该摘要行实际披露的字段；例如，单一客户金额须引用客户明细数值行，不能仅引用前五名客户合计金额/比例行。PDF 表格常将业务名称与数值拆成相邻段落：数值断言必须引用实际包含该数值的段落；只引用前一段业务名称不构成数字证据。表头、单位行与数值行分开时分别引用三者，不能用另一业务行的数值、占比或毛利率替代。报告披露前五大客户/供应商的金额或比例时，必须引用实际包含该金额或比例的数值行，不得只引用“主要客户/供应商情况”小标题、表头或分部说明；例如客户合计销售额与占比应分别绑定各自数据行，最大客户比例须绑定最大客户对应行。若毛利率变化列及单元格以百分号显示，必须原样按百分比报告，不能将年度同比变化转换为百分点；百分点只用于两个可比毛利率水平经代码计算并列出公式的差额。结构化财务来源的固定定位可用作原始指标引用，但不能省略其来源标识或把一个业务/行业行当作合并指标；引用在其他章节出现不构成本节的证据绑定。

若供应商表披露前五名合计采购金额、占采购总额比例或第一名供应商金额/比例，逐项报告已披露数据。合计金额与比例分别引用各自的实际数据行；第一名等明细行同时绑定其金额/占比数据行、供应商表头（如“序号/供应商名称/采购额/占年度采购总额比例”）、适用单位行及年度期间行。不能用客户资料表头代替供应商表头，也不能把上一期供应商行当作本期。

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
