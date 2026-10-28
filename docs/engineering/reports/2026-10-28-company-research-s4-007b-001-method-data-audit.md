# ResearchHub — S4-007B-001 原子方法规范与经济桥字段审计

**任务编号：** `RHL-CQR-P0-19-S4-007B-001-METHOD-DATA-AUDIT`
**审计日期：** 2026-10-29（Asia/Shanghai）
**仓库 / 分支：** `C:\Users\Administrator\Desktop\ResearchHub` / `codex/company-research-p0-01-06`
**冻结起点 / local HEAD / origin：** `9e92da61828dbc2a6a044b451bee85e57cf83c88`
**性质：** 只读源码与已保存文件审计。唯一获准产物是本报告。没有改 Skill、Workflow、Data、Plugin、测试、运行件或 Knowledge；没有获取数据/PDF、运行模型/Reviewer/外部 API、真实计算或双公司重跑。

> **状态校正。** 任务书前置栏写明 `S4-007A Phase 1 ACCEPTED`，但冻结点的 [007A 实施报告](2026-10-28-company-research-s4-007a-implementation.md) 记载停止点为 `S4-007A-FIX-002 Ready for Architecture Re-review`，并写明 19/19 与独立语义审阅仍未通过。本轮未发现更高签署证据。下文依实际仓库记录审计私有契约，不把任务书前置陈述作为已验收事实。

## 结论

已审查 19 节所有权、10 个公司研究 atomic method、scenario_valuation 方法文字、Company Data 字段/路由/normalizer、S4 私有 observation/proof/bridge/review contract，以及既有 DECISION-004、Gate 1、asOf 与 S4-CONTRACT-005 文档。

现有 Skill 边界可保留。scenario_valuation 需在其单一研究问题内增加经济因果、校准、反证及独立审阅门，不应发展成跨 Skill 的预测 Skill。Company Data 公共 financial observation 是通用稀疏记录，不保存可直接用于经济桥的产品行、量价/订单/产能和逐值版本证明；ScenarioForecastBridge 没有数值桥行，ResearchAssumptionProposal 没有校准范围/值基准容器。可作为后续 Workflow 私有设计方向，但不能据此认定真实公司预测数据可用。当前 proof 没有已批准信任根；动态快照与预封存 archive 没有显式区分，见第 6 节。

两家公司未来 causal driver 均不具备资格。历史披露只能作为历史候选或条件基线，不能把 FY/H1 增速极值包装为 Bear/Base/Bull。东山 T0 早于港股挂牌；挂牌后价格严禁回填。没有新增 source、Reviewer、模型、Knowledge 或 19/19 授权。

## 0. 证据索引与范围

冻结提交 `9e92da6` 上直接读取了下列 CURRENT CODE。SAVED AUDIT 指已提交报告/旧 run 摘要，并非本轮重新下载原文。

| 证据 | 位置 | 用途 |
|---|---|---|
| Skill / Workflow | `skills/company-research/skill.ts`、`methods.ts`；`workflows/company-deep-research/workflow.ts`、`assembly.ts` | 19节清单、10 method→14 atomic-owned sections、Workflow/Synthesis所有权 |
| 架构 | `docs/architecture/RESEARCH_SKILL_ARCHITECTURE_V1.md`、`RESEARCH_SKILL_CATALOG_V1.md`、`RESEARCHHUB_DATA_LAYER_ARCHITECTURE_V1.md` | 单层 peer Skills、Workflow composition、Data边界 |
| 10个原子Skill | `skills/company_history_strategy/SKILL.md`、`business_model_map/SKILL.md`、`product_technology_analysis/SKILL.md`、`business_driver_analysis/SKILL.md`、`financial_quality_analysis/SKILL.md`、`market_structure_analysis/SKILL.md`、`competitive_market_map/SKILL.md`、`management_governance_analysis/SKILL.md`、`capital_allocation_review/SKILL.md`、`company_risk_analysis/SKILL.md` | Purpose/Invocation/Inputs/Produces/Methodology/Evidence/Boundary/Missing/QC |
| Scenario/Data源码 | `skills/scenario_valuation/SKILL.md`；`data/company-research-contracts.ts`、`company-research-policies.ts`、`requirements.ts`、`common-catalog.ts`、`valuation-earnings-policies.ts`；`plugins/research-acquisition/company-research-data.ts`、`company-official-financial.ts` | 字段、alias、fallback、时间推断及估值/预测路线 |
| 私有合同 | `workflows/company-deep-research/scenario-assumptions.ts`、`scenario-method-contracts.ts`、`scenario-method-validation.ts` | FY2026 envelope、observation/proposal/bridge/proof/review/hash 与资格门 |
| 既有审计 | `docs/engineering/reports/2026-10-28-company-research-p0-19-decision-004.md`、`...decision-004-independent-review.md`、`2026-10-27-company-research-gate1-field-lineage-detail.md`、`...gate1-contract-lineage-audit.md`、`2026-10-28-asof-and-reverse-dcf-feasibility.md`、`2026-10-28-company-research-s4-scenario-method-contract.md`、`2026-10-28-company-research-s4-007a-implementation.md` | 对照 locator/hash/T0 与缺口，不重拉资料 |
| 旧运行 sidecars | `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/` 下两家公司 analysis/bundle/report/workflow/started/Markdown/KB integrity | 只读 run identity、T0、17/19 状态；15项未改写 |

五个未提交用户 JSON 未读取或改写。测试和所有模型/运行/数据调用均未执行；只在交付前运行文档 diff 检查。

## 1. Gate 1 — 19节 owner map

`COMPANY_RESEARCH_SECTIONS` 列出19节；`COMPANY_METHOD_SECTION_IDS` 把10个研究方法映射到14个 atomic-owned sections，14节并非14个 Skill。`assembly.ts` 指定 valuation、bull-base-bear、variant-perception 为3个 Workflow-owned 节；investment-thesis、monitoring-checklist 为2个 Synthesis-owned 节。19/19 均必需，不能恢复16节口径。

| sectionId | owner | 研究问题 / 输入 | 结果/资格 | 经济驱动提供者 | gap |
|---|---|---|---|---|---|
| `company-overview` | company_history_strategy | 身份、沿革、战略选择；历史事件来源 | 方法独有输出，事实需引用 | 否 | 沿革来源/时间可能不完整 |
| `business-model` | business_model_map | 客户、价值主张、渠道、收入机制 | bounded business model | 否 | 合同、产品盈利性缺项不能补造 |
| `business-segments` | business_model_map | 分部/产品结构与分类标签 | 同一方法第二节 | 历史结构输入 | public Data 无typed segment；并表/消除/分部利润缺 |
| `supply-chain` | business_model_map | 供应链依赖、工序、价值流 | 同一方法第三节 | 否 | 供应商集中和替代性证据有限 |
| `revenue-profit-drivers` | business_driver_analysis | 量价/mix/分部/成本解释可比变化 | deterministic contribution + residual | 是历史驱动 owner | generic metrics不能拆量价及并表贡献 |
| `products` | product_technology_analysis | 产品用途/阶段及证据 | product result | 仅产品事实 | 产品收入/订单/量产 binding 缺 |
| `technologies` | product_technology_analysis | 技术路线、成熟度、进展 | 同一方法第二节 | 否 | 技术进展不能证明收入转化 |
| `industry-exposure` | market_structure_analysis | 市场边界、细分、价值链、行业估计 | scope/reconciliation结果 | 否 | 公司份额和适用市场边界缺 |
| `competition` | competitive_market_map | 同范围具名peer及相对定位 | peer map，冲突保留 | 否 | 同口径份额、定价、成本、PIT不足 |
| `financial-quality` | financial_quality_analysis | 三表质量、现金转换、财务弹性 | deterministic ratios/deltas，组件级unavailable | 是桥接输入校验，不建FCFF | basis/scope/PIT及FCFF字段不全 |
| `growth-drivers` | business_driver_analysis | 可观测增长条件与反证触发 | 同方法章节 | 历史驱动 owner，不外推历史envelope | FY2026机制未校准、FY/H1不可混 |
| `management-capital-allocation` | management_governance_analysis + capital_allocation_review | 治理/执行及资金投放结果 | 两peer结果合于一节 | 否 | hurdle/ROIC/回收/回购注销状态缺 |
| `catalysts` | business_driver_analysis | 何种已证事件改变驱动 | 方法结果；非目标值 | 仅作反证触发依据 | 认证/扩产不等于订单或收入 |
| `risks` | company_risk_analysis | 归属风险、传导、监控项 | bounded risk result | 否 | 匿名客户不能具名映射，无暴露值 |
| `valuation` | Workflow | asOf价格和earnings/book可支持何种估值 | Workflow-generated | 否 | 历史PE不等内在价值；A/H与EV缺 |
| `bull-base-bear` | Workflow | 有因果且可反证的经营case | 结构化候选受review/资格门阻断 | Workflow装配，peer方法供历史输入 | 无数值桥、经济校准和独立review |
| `variant-perception` | Workflow | consensus/指引/隐含/内部预期差 | 需要版本化 expectation surface | 否 | T0预测版本不可证 |
| `investment-thesis` | Synthesis | 哪些已核事实构成论点与反证 | 综合peer结果，不运行peer | 否 | blocked上游不得作为结论 |
| `monitoring-checklist` | Synthesis | 后续更新指标与trigger | 最终综合节 | 否 | 缺值写待观察字段，不填0 |

### 1.1 十个atomic method核查

每个 SKILL.md 均检查 Purpose、Invocation Match、Inputs、Produces、Methodology、Evidence Requirements、Deterministic/Model Boundary、Missing Data、Validation/QC。10个是平级方法；Related Skills只是引用，不是技能调用。最相关的经济桥owners为 business_driver_analysis、financial_quality_analysis、capital_allocation_review。

| 方法 | 单一研究问题 / 输入→结果 | evidence/model/missing/QC | 经济桥责任和gap |
|---|---|---|---|
| company_history_strategy | 公司沿革/战略；身份及历史来源→时间线 | 事实和解释分开 | 供范围/并购背景，不供预测参数 |
| business_model_map | 如何把客户需求转为收入；业务证据→商业模式 | 每环有source，缺项不推断 | 可定义分部，无单位经济数值 |
| product_technology_analysis | 产品技术状态是什么；产品披露→bounded解释 | 状态须有来源 | 阶段FACT不等订单/营收 |
| business_driver_analysis | 历史收入利润由何驱动；可比财务/KPI→贡献和残差 | 代码负责period/unit/算术 | 历史因果owner，无forecast bridge |
| financial_quality_analysis | 报告盈利与现金转换质量；三表→ratio/flags | 组件级available/unavailable | 不含完整未来FCFF输入 |
| market_structure_analysis | 市场边界、细分、价值链 | scope/估计方法验证，冲突不平均 | 行业context，不提供公司份额 |
| competitive_market_map | 可比市场参与者和定位 | peer归属、可比性为前提 | 不供公司未来定价/利润率 |
| management_governance_analysis | 治理安排及管理执行事实 | 不从文本推断人格/结果 | 不替代资本回报数值 |
| capital_allocation_review | 资本投放和事后回报 | 缺分母/后续结果unavailable | 历史投资事实，不造FCFF |
| company_risk_analysis | 有来源的风险及监测触发 | 不臆造概率 | downside反证，不填case概率 |

没有atomic owner的经济字段包括orders/backlog转收入、volume、realized ASP、mix贡献、capacity denominator/utilization、yield、segment operating profit、EBIT税、D&A、maintenance/growth CapEx、operating ΔNWC、unrestricted cash、fully diluted shares、FX、HK share-class allocation和forecast version history。必须保留MISSING，不能新建万能Skill替代。

## 2. scenario_valuation 方法精确 redline

保持一个问题：“显式 Bear/Base/Bull 假设如何改变价值”。下列为可独立PR的文字替换提案，当前文件未改。它只增加输入、经济因果、证据与review约束，不转移Workflow职责。

~~~diff
--- a/skills/scenario_valuation/SKILL.md
+++ b/skills/scenario_valuation/SKILL.md
@@
-Calculate how explicit Bear/Base/Bull assumptions change deterministic value.
+Calculate how explicitly registered, attributable Bear/Base/Bull assumptions
+change deterministic value. This Skill evaluates supplied assumptions; it
+does not author or approve them.
@@
-Validated valuation basis, eligible primary method, target fiscal year, three
-ordered scenario assumptions, explicit source refs, and valuation date.
+Validated basis; explicit base/target periods; currency, unit, financial and
+consolidation scope; evidence-bound base observations; and three
+separately-authored RESEARCH_ASSUMPTION proposals. Each binds driver/value or
+unavailable, mechanism, calibration range and basis, inputs, strongest
+counterevidence, falsifiable trigger and author. Workflow must assign an
+independent reviewer. Period, scope, share basis and PIT/version status are
+explicit.
@@
-Three deterministic scenario results, a 3x3 sensitivity matrix, monotonicity
-diagnostics, and evidence/source bindings.
+Three conditional deterministic results, conditional 3x3 sensitivity,
+monotonicity/reconciliation diagnostics, and assumption/source/formula/review
+bindings. Outputs are conditional calculations, not target prices.
@@
-Validate exactly Bear/Base/Bull assumptions and horizon; calculate each target
-price and implied return in code; recompute all nine sensitivity cells; and
-report unavailable methods without substituting values. This method does not
-calculate a probability-weighted expected value: report the scenarios without
-probabilities or a weighted expected value. A separate calibration-aware
-method would require sourced, independently calibrated probabilities; never
-assign equal default weights.
+Preserve driver -> economic mechanism -> accounting line -> value calculation
+-> observable invalidation trigger. Cases are causally distinct, not historical
+minimum/median/maximum growth. A historical growth envelope is not economic
+calibration or an approved future expectation.
+
+For each non-overlapping line choose disclosed segmentRevenue OR same-scope
+recognizedVolume * realizedNetASP; the paths are mutually exclusive. Include
+evidenced acquisition/elimination/reclassification once and retain RESIDUAL.
+Never infer volume/ASP from total revenue, profit share from revenue share, or
+organic growth from consolidation. Keep FACT, DERIVED, INFERENCE and
+RESEARCH_ASSUMPTION distinct. Each proposal binds baseline, calibrated range
+and basis, mechanism, counterevidence, trigger and owner. MISSING is neither
+zero nor default. Do not annualize H1 or mix periods, flow/stock, unit,
+currency, consolidated/parent scope or basic/diluted/adjusted EPS basis.
+
+FCFF requires aligned EBIT, explicit tax convention, D&A, CapEx, operating
+ΔNWC and lease/non-operating boundary: FCFF = EBIT*(1-T)+D&A-CapEx-ΔNWC.
+CFO less purchases of long-term assets is not FCFF. Missing input means
+unavailable. Set no default WACC, terminal growth, multiple, probability or
+terminal value. Sensitivity results are conditional, not forward target prices.
+
+An independent reviewer checks every assumption, lineage, scope, calibration,
+counterexample, formula and trigger; reviewer differs from author. Arithmetic
+cannot set QUALIFIED or reportEligible. Review binds exact packet hash; input,
+version, rights, horizon, method or formula change makes review stale. This
+Skill does not call peers or acquire data; Workflow owns collection, lineage,
+routing, review and publication qualification.
@@
-Basis inputs and scenario assumptions must be attributable, finite, and aligned
-to the same point-in-time and fiscal horizon. Any probability requires
-independent calibration evidence and an attributable source.
+FACT binds exact token/locator/content/row, source version, rights, period,
+scope, unit and currency. DERIVED binds eligible inputs and formula version.
+Assumptions cite calibration and counterevidence. Publication date, retrieval
+time and local hash do not by themselves prove historical value availability.
@@
-`skills/valuation/financials.ts` owns arithmetic and monotonicity checks. The
-model may provide a bounded rationale for supplied assumptions only.
+Code owns normalization, bridge, reconciliation, rounding and sensitivity.
+Reasoning may explain evidence, not invent or approve values. Workflow owns
+collection, as-of/version freezing, reviewer separation and publication.
@@
-An absent scenario input or ineligible method is `unavailable`; no scenario is
-silently filled from a default.
+Absent, conflicted, non-comparable, unlicensed or unverified inputs are
+unavailable; never fill from zero, history, industry mean or a default.
@@
-Require three ordered scenarios, positive multiples, valid growth, eligible
-methods, finite outputs, and deterministic recomputation equality.
+Require three identified cases, explicit bases, full source/version/rights
+lineage, exclusive revenue paths, single-count adjustments, residual
+reconciliation, finite output and deterministic recomputation. Reject H1
+annualization, CFO-capex-as-FCFF, revenue-share-as-profit-share and duplicate
+costs. Hash-matched independent review precedes QUALIFIED; arithmetic alone
+never grants report or Knowledge eligibility.
~~~

### 2.1 兼容与回退

- 保留三case、九格、monotonicity、deterministic recomputation、unavailable及现有算术owner；不增Skill或peer call。
- 新要求在Workflow输入/发布层体现。旧输入缺lineage、calibration、basis或review packet时返回unavailable/REVIEW_REQUIRED，不补默认值。
- Fixture计算不等于真实forecast/target/QUALIFIED/Knowledge授权。若redline回退只撤该方法文字，不恢复历史extrema=经济校准的说法。

## 3. Gate 2 — Data contract、路由和权利代码审计

### 3.1 route矩阵

| Data metric/consumer | 代码route和raw字段 | 输出和时间/PIT | gap |
|---|---|---|---|
| company_financial_history / Company Research | AKShare financialData primary；financialStatements/EastMoney fallback_1；可选CNINFO annual extraction fallback_2；authority S3/S0 | CompanyFinancialObservation rows + dataset retrievedAt；metadata optional。normalizeFinancial historical也设pointInTimeSafe=false/status UNVERIFIED | authority/route不等于许可或版本proof；无per-field raw key/locator/row hash/revision/right/availableAt |
| company_market_history / Company Research | EastMoney历史日线primary、Tencent fallback；日期和OHLCV aliases | 按交易日/dailyCloseAvailableAt过滤后历史标PIT_VERIFIED，CURRENT标CURRENT_VALUE_ONLY | 仅日期过滤，不证明provider vintage/修订/币种/调整/签名；public row缺currency和share class |
| company_research_evidence / peer methods | CNINFO S0 + GDELT S3 COLLECT_DIVERSE；public web需显式composition | source/published/retrieved/content；Workflow限定excerpt/locator | 通用document route不是typed segment/order/value-version route |
| earnings_expectation_eps / variant-perception | THS/EastMoney估计route；Company只有resolver存在才materialize | 旧summary是候选数量，不是逐点EstimatePoint/proof；采集晚于T0 | generic adapter rights及报告日期不证historical point vintage |
| earnings_expectation_net_profit | THS route，resolver存在时materialize | 每点需机构、FY、metric、unit、basis、版本 | 不得从EPS推NP或混FY |
| valuation_market_price | EastMoney/Tencent A-share历史行情 | 按交易时间截取，日线候选 | 无HK close、FX、share allocation |
| volume/ASP/capacity/segment/order | DOMAIN模板不是专用可执行Company route | 没有标准化经营字段 | financial_model_build_update是PLANNED，不是forecast能力 |

### 3.2 normalizer事实

1. normalizeFinancial aliases：revenue=operating_revenue/TOTALOPERATEREVE/TOTAL_OPERATE_INCOME；netProfit=net_profit/PARENTNETPROFIT/PARENT_NETPROFIT；grossMargin=gross_margin_percent/gross_margin/XSMLL；basicEps=basic_eps/EPSJB；operatingCashFlow=operating_cash_flow/NETCASH_OPERATE；capex=capex/CONSTRUCT_LONG_ASSET；cogs/OPERATE_COST；assets/TOTAL_ASSETS；liabilities/TOTAL_LIABILITIES；equity/TOTAL_PARENT_EQUITY；cash/MONETARYFUNDS；receivables/ACCOUNTS_RECE；inventory/INVENTORY；payables/ACCOUNTS_PAYABLE；R&D/RESEARCH_EXPENSE；operatingProfit/OPERATE_PROFIT；short/long loans、bonds、current portion aliases。源码列出可接受key，不证明旧run实际alias。
2. periodEnd取report_date/REPORT_DATE/reportDate；publishedAt取publication_date/NOTICE_DATE/publicationDate。basis heuristic只有显式QUARTER、显式YTD或存在REPORT_DATE/operating_revenue，其他UNKNOWN；不是逐科目表头解析。
3. knownYuan只看TOTALOPERATEREVE或operating_revenue；若命中，可能给整行其它非percent/EPS字段标CNY；未命中一般UNKNOWN。EPS固定CNY/share、margin为percent。没有逐field元/万元/亿元、currency、scope转换。
4. sourceConflicts只比较revenue/netProfit及部分debt，未保存来源id/raw alias/期间/单位。spread overlay可能覆盖字段；optional conflict list不完整，无记录不等于无冲突。
5. CNINFO extractOfficialAnnualFinancials仅读年报“主要会计数据”后的14,000字、有限科目，需人民币/尺度/year header且收入/归母NP均命中。输出不保留原行token/locator/header/row hash/revision；仍pointInTimeSafe=false/UNVERIFIED。
6. CompanyFinancialObservation无original token/content/locator、per-row retrievedAt、valueVersionAvailableAt/id、revision、rights或row-binding。S4私有proof不接入公共adapter。
7. market historical PIT来自交易日过滤，非来源真实性/历史版本；market row缺quote currency、adjustment、share class。

## 4. 两家公司逐字段 lineage 矩阵

raw alias为代码允许输入，非具体旧run确认值。locator/hash依既有审计保存；逐值侧车未保存的original token/row binding/retrievedAt标MISSING/UNVERIFIED。sourcePublishedAt为载体时间，不等于valueVersionAvailableAt。S0/S3 authority不是license。

### 4.1 BYD 002594（T0 2026-10-27T20:19:59.628Z）

| driver / consumer / owner | metricId；alias→field；route/source | period；flow/stock；scope/parent；unit/currency/share basis | original token+locator；content/row binding | published/retrieved/available/revision；rights/conflict/asOf | formula version；missing/refusal |
|---|---|---|---|---|---|
| Consolidated revenue；B/B/B；business_driver_analysis | company_financial_history；revenue aliases；official-f7c8d23d2829a5e8、official-c19c34dd239b2e9c | FY23–25、H1 FY26/H1 comparator；FLOW；consolidated；CNY；share N/A | 年报para226–227、H1 para96–97；旧S4有source hash；逐值token/binding未存 | FY25 published 2026-03-27T16:00Z；H1 2026-08-28T16:00Z；per-row retrieval/available/revision UNVERIFIED；rights未逐field复核；仅历史候选 | 同口径历史算术待qualify；organic/acquisition与future bridge缺；无forecast formula |
| Segment/product revenue、COGS、gross profit；B/B/B + business-segments；business_driver_analysis / business_model_map显示 | 无typed segment metric；generic cogs/OPERATE_COST、grossMargin/XSMLL不是segment route；official-c19c34dd239b2e9c@paragraph:691–730 | H1 FY26 YTD至06-30；FLOW/RATE；consolidated类别；CNY bn/%；share N/A | pp69–72及source SHA在S4审计；逐行raw token/header binding未存 | carrier 2026-08-28T16:00Z；retrieved/value version/revision缺；既有CNINFO标签非逐值许可；分类冲突/重列未保；仅历史候选 | grossProfit formula未实现；分部OP、量/价、消除/残差/row proof缺；收入份额不等利润 |
| Volume/ASP/mix/capacity/utilization/orders；B/B/B；business_driver_analysis；stage由product_technology_analysis | 无canonical driver ID/aliases/专用route；generic metric/value无经营语义 | matched FY/H1、scope和unit均MISSING；flow/count/rate | FY25产销量只有方向性记录，完整精确locator未见逐字段sidecar；raw token/hash/binding缺 | published/retrieved/value available/revision/right逐点缺；冲突未建；T0前瞻unavailable | formula none；缺volume、realized ASP、mix、capacity分母、utilization、yield、订单/验收/收入确认；不能由revenue反推 |
| Operating profit→parent NP/EPS；B/B/B；business_driver_analysis + financial_quality_analysis | operatingProfit/OPERATE_PROFIT、R&D/RESEARCH_EXPENSE、netProfit别名、basicEps/EPSJB；generic financial route | FY/H1 flows；精确引用的归母NP为parent，其他aliases scope未定；CNY/%/CNY-share；basic/diluted denominator缺 | 年报para226–227、H1 para96–97；token和row-binding未存 | carrier dates同上；retrieve/version/revision/rights缺；net_profit alias不保归属；conflict覆盖有限 | proposed OP→finance/non-op→tax→consolidated NP→NCI→parent NP，无公式版本；SG&A/oneoffs/tax/NCI/diluted shares缺 |
| CFO/CapEx/AR/inventory/AP/FCFF；B/B/B；financial_quality_analysis / capital_allocation_review | NETCASH_OPERATE、CONSTRUCT_LONG_ASSET、ACCOUNTS_RECE、INVENTORY、ACCOUNTS_PAYABLE、MONETARYFUNDS；akshare-financial-002594@paragraph:1 | H1 FY26 YTD flow；2026-06-30 stock；scope/basis待核；CNY bn记载，JSON unit未证 | hash e53f57b48168e99af65db0583011b230157a4c4c23968671111581f114f3b3d8；逐字段token/binding缺 | official H1 2026-08-28T16:00Z；dataset retrieval无法分配到field；value revision缺；aggregator rights/conflict不足 | 旧审计CFO37.335bn − 长期资产现金44.703bn=−7.368bn，是同期间差非FCFF；D&A/EBIT tax/maintenance capex/ΔNWC/配对余额/lease缺 |
| Cash/debt/bonds/current portion/lease/restricted cash/minority/preferred；valuation input；financial_quality_analysis consumer、无atomic total-EV owner | generic cash/debt/bonds/current-portion；lease/restricted/minority/preferred无完整route；official reports | 2026-06-30 STOCK，非T0；consolidated与equity claim要拆；CNYbn | H1 pp65–66/135/83；报告hash可查但逐值raw token、debt non-overlap binding缺 | published 2026-08-28T16:00Z；T0 roll-forward/retrieval/version/revision缺；rights未逐值核；conflict可能不全 | EV formula无资格；restricted/unrestricted cash、lease/current maturity重复、bonds、minority/perpetual和T0余额缺；bond未列非zero |
| A/H shares/quotes/FX/actions/dilution；valuation/variant Workflow；无atomic total EV owner | valuation_market_price仅A行情；无HK/FX/class allocation；DECISION-004 saved candidates | A close CNY82.01；H1 issued A=5,433,797,565/H=3,683,400,000（06-30 stock，非T0稀释股数） | H1 p57及千股表p80；A来自Tencent fallback；H price/FX locator、每值binding缺 | T0 20:19:59.628Z；H价/FX/股份行动/稀释版本无；rights/revision未证 | equityMarket为FIXTURE_ONLY；缺同日H price、FX、treasury/cancelled/diluted count和rights allocation；不出total cap/EV/Reverse DCF |
| M1 estimates；variant-perception Workflow，不属10个company method | earnings_expectation_eps/net_profit；THS/EastMoney渠道而非逐报告身份 | FY/metric/unit/EPS basis/contributor要求；旧摘要THS9、EM19候选数非逐点 | 无逐点EstimatePoint、token/locator/content-row/revision manifest | route完毕20:20:01.163Z、20:20:04.180Z，晚于T0；available/revision/right未知；T0不可用 | no median/gap；缺逐点独立样本和rights |
| FY26+ revenue/margin/FCFF/WACC/terminal；Workflow；无atomic forecast owner | 无active forecast Data route/private proposal是候选容器 | future period/scope/unit/currency/share basis按metric明确但目前missing | 无source token/locator/row/content/calibration | source times/version/revision/right/review皆缺 | no formula/value；无target、概率、Knowledge |

### 4.2 东山精密 002384（T0 2026-10-27T20:26:46.347Z）

| driver / consumer / owner | metricId；alias→field；route/source | period；flow/stock；scope/parent；unit/currency/share basis | token+locator；content/row binding | published/retrieved/available/revision；rights/conflicts/asOf | formula；missing/refusal |
|---|---|---|---|---|---|
| Consolidated revenue / parent NP；B/B/B；business_driver_analysis + financial_quality_analysis | company_financial_history；generic revenue/netProfit；official-39e591fa149e4543 FY、official-296fff2b2889c26f H1 | FY23–25、H1 FY26/H1 FY25；FLOW；revenue consolidated、cited parent NP；CNYbn；share N/A | 年报para228–229、H1 para215–216；raw token/binding未存 | H1 pub 2026-08-21T16:00Z；FY pub本轮未复核；row retrieval/version/revision UNVERIFIED；rights未逐field核；net_profit alias归属未知 | 历史比较待qualification；organic/GMD/future桥缺，利润先降后升非预测区间 |
| Product revenue/COGS/margin：电子电路/精密组件/显示模组；B/B/B+business-segments；business_driver_analysis/business_model_map | 无typed segment route；generic COGS/margin不是产品项；official-296fff2b2889c26f@paragraph:764–795；FY official-39e591fa149e4543@paragraph:885–899 | H1 FY26 YTD、FY25；FLOW/RATE；consolidated类别；CNYbn/%；share N/A | pp44–49、source SHA 6500c4e7c05ab455ebbbfc5eba1fa7ede7a48d6be171c53c4edc87c4682f707a；row/header binding缺 | H1 pub 2026-08-21T16:00Z；retrieve/version/revision缺；internal rights label不是逐值授权；分类冲突/重列未保 | revenue-COGS formula未实施；segment OP/单位经济/并表/消除缺；revenue share≠profit share |
| Volume/ASP/mix/capacity/utilization/GMD；B/B/B；business_driver_analysis；范围背景company_history_strategy | 无driver metric/alias/专用route | FY25产量FLOW/COUNT不等同收入；H1扩产文字；利用率缺 | official-39e591fa149e4543@paragraph:933记录+32.92% production且含French GMD/新投产；H1 official-296fff2b2889c26f@paragraph:528–530；分母/token绑定缺 | published date在旧资料；逐field retrieval/version/revision/rights缺；organic分拆unverified | organic/acquired量、capacity denominator、yield、订单、delivery→recognized revenue和ASP缺；不年化/不称organic |
| EML/光模块认证→交付/收入；B/B/B；阶段product_technology_analysis，结果business_driver_analysis | 无numeric field/route，只有evidence narrative | H1 FY26 TEXT，不是金额；unit/CNY/share N/A | official-296fff2b2889c26f@paragraph:359–362,611–612,682；无订单/收入/良率token row | published 2026-08-21T16:00Z；numeric retrieval/version/revision/right缺；FACT只表示披露阶段 | 缺订单、验收、批量交付、产品收入/ASP/yield/margin；认证不forecast |
| Operating profit/expenses/tax/NCI→parent NP/EPS；B/B/B；business_driver_analysis+financial_quality_analysis | OPERATE_PROFIT、RESEARCH_EXPENSE、netProfit、EPSJB aliases；无完整NCI/oneoff scope route | FY/H1 FLOW；group/parent须拆；CNY/%/CNY-share；EPS basis/diluted denominator缺 | H1 parent NP para215–216、FY para228–229；EPS/持股计划p47非T0 diluted shares；token binding未存 | carrier pub部分可知；per-row retrieved/version/revision/right缺；net_profit归属/conflict未完 | formulaVersion none；SG&A/nonrecurring/finance/tax/NCI/diluted shares缺；不由收入推NP/EPS |
| CFO/capex/WC/FCFF；financial_quality_analysis/capital_allocation_review | NETCASH_OPERATE、CONSTRUCT_LONG_ASSET、ACCOUNTS_RECE、INVENTORY、ACCOUNTS_PAYABLE、MONETARYFUNDS；akshare-financial-002384@paragraph:1 | H1 FY26 YTD flow；2026-06-30 stock；scope/basis待核；CNYbn记载而JSON unit未证 | hash 5696f40e6295a5e5f9500ac52543562171bc80c90490bb448ede4b8371f5c230；per-field token/binding缺 | official H1 pub 2026-08-21T16:00Z；dataset retrieval不能分field；version/revision和rights/conflicts未全 | CFO2.384bn−long asset spend5.253bn=−2.869bn仅同期间差；D&A/tax/maintenance/ΔNWC/paired balances/lease缺，非FCFF |
| Cash/debt/bonds/maturity/lease/restricted/minority；valuation输入，无atomic total EV owner | generic cash/debt/current-portion；lease/restricted/minority route不全；official H1 | 2026-06-30 STOCK非T0；CNYbn；debt/equity scope要拆 | H1 pp41–43/p97/p100，SHA见上；旧审计记录cash8.793bn、restricted1.845bn、cash equivalent6.948bn、short9.630bn、long9.441bn、lease1.917bn、current maturity2.975bn（含long2.697bn+lease0.279bn）、long payable0.028bn；逐token/overlap binding缺 | pub 2026-08-21T16:00Z；June值非T0；per-field retrieve/version/revision/rights缺；无bond项非0 | unrestricted cash、债务/lease重项、bond、minority、IPO现金和T0 roll-forward缺，EV unavailable |
| A/H shares/buyback/IPO allotment/proceeds/price/FX/dilution；valuation/variant Workflow | 仅A daily route；无HK/FX/allotment/proceeds route | A close CNY101.09 candidate；H1 A shares1,831,607,532；9/30回购255,200未证注销；HKD86.80是offer不是trade price；最终配发未定 | H1 p37/p47；official-f5baf98acbff1fd0 paras7,15；official-594d5acb2ae76fb0 paras31,33,35；official-c99ce248ea972a56 paras13,15–17；既有asOf报告有hash/locator | T0 20:26:46.347Z早于港股挂牌；最终配发/净款到账/挂牌后价均后验；FX/版本/rights缺 | fixture only；缺H成交、FX、最终/稀释股数、取消/treasury、rights、net proceeds；不能生成T0 M2 |
| M1 estimates；variant-perception Workflow | THS/EastMoney routes；3/10 report候选不是points | FY/metric/basis/unit/contributor需逐点 | 无EstimatePoint/token/locator/content-row/version/revision manifest | route结束20:26:48Z/20:26:49Z > T0 20:26:46.347Z；rights/available/revision未证 | T0 M1不可行，无median/gap |
| Future revenue/margin/FCFF/IPO capital structure/WACC/terminal；Workflow无atomic forecast owner | 无active forecast route；private proposal仅候选 | target period/scope/unit/currency明确字段当前缺 | 无source token/locator/row/calibration | source times/version/revision/rights/review均缺 | 无eligible formula/output；不出CAGR/target/概率/Knowledge |

### 4.3 来源权利分类与完整性

| 分类 | 当前证据 |
|---|---|
| already authorized and verifiable | 未找到能使新增前瞻数值完整准入的 source/value pair。已有official disclosure有ID/date/locator/hash，只支持有限历史审计，不证明逐field AI/storage rights、精确版本或新增调用授权。 |
| existing record but rights/version unverified | AKShare/EastMoney/Tencent aggregates；THS/EastMoney estimates；CNINFO fallback；未绑定逐field rights/version proof的官方文档字段。S0/S3只是authority rank。 |
| absent route | typed segment/product、volume/ASP/mix/capacity/utilization/yield/orders-to-revenue；HK close、FX、final allotment/net proceeds；逐值version/revision resolver和rights verifier。 |
| requires explicit new authority | 新第三方/付费/券商源、未授权PDF下载/AI处理、公共Data扩展、provider/trust root接线、真实模型/Reviewer/T1/双公司运行/Knowledge写入；本轮均未执行。 |

BYD历史候选有收入/归母净利、部分分行业/产品行、CFO/CapEx差、资产负债及股份/价格线索；token、单位/basis/conflicts/row binding不全。东山另有产品行、GMD并表/扩产、EML阶段和客户集中事实；没有utilization、EML订单到收入或T0港股行情。两家公司qualified future causal driver均为0；FCFF/M1/M2无完整输入。行定位见 [S4-CONTRACT-005 §1](2026-10-28-company-research-s4-scenario-method-contract.md)，不替代当前源码缺口。

## 5. Gate 3 — 私有桥类型、公式与停止规则

仅是后续授权设计，不改public schema、不在本轮建TS。输入先比对company/metric/period/basis/flow-stock/financialScope/comparableScope/unit/currency/origin/value-version/rights；不兼容或不可信即组件UNAVAILABLE，不隐式转换。

1. **Revenue互斥路线：** 每个互斥行选 disclosed segmentRevenue 或同scope recognizedVolume × realizedNetASP；另一条仅可作reconciliation，不能二次相加。产量、出货、销量不可互代。consolidatedRevenue = sum(non-overlap rows) + evidenced acquisitions + evidenced reclassifications - evidenced eliminations + RESIDUAL。每个scope adjustment需唯一id和source ref，只计一次。RESIDUAL = reported consolidated revenue - explicit rows/adjustments；没有报表对账值就不填残差数字。
2. **Gross/parent profit：** grossProfit = revenue - COGS；grossMargin = grossProfit/revenue，要求同scope/period/category且revenue>0。operatingProfit = grossProfit - mapped operating expenses + other operating income，须有不重叠account map。PBT = operatingProfit + netFinanceItems + definedNonOperatingItems；consolidatedNP = PBT - incomeTaxExpense；parentNP = consolidatedNP - NCI attributable profit，仅当原始符号/归属定义明确。SG&A/R&D/one-offs/tax/NCI不重复扣。缺字段则组件unavailable，不以历史margin替成本。
3. **FCFF：** 同scope unlevered basis，FCFF_t = EBIT_t × (1-T_t) + D&A_t - CapEx_t - ΔNWC_t。T为明确的EBIT税负/税盾口径。ΔNWC由同期间、同范围经营性期初/期末资产负债组成，排除现金/债务。租赁/并购/非经营现金说明处理。缺任一项不计算；CFO−购建长期资产只是现金流差；H1不年化。
4. **Scenario：** explicit base、forecast proposals、折现/终值等输入与review完备后才能算条件值/9格。不给默认概率、WACC、terminal growth、multiple或terminal value。条件输出不是目标价/市场预期。

**最小私有扩展：** ResearchAssumptionProposal已有value/mechanism/calibration refs/counterevidence/trigger/input refs，但没有数值range及basis；ScenarioForecastBridge仅scenario/horizon/driver refs/qualitative adjustments/residual policy，无定量bridge rows。建议私有 CalibrationRange(lower/upper/unit/currency/periodBasis/scope/method/evidenceRefs)、EconomicBridgeLine(lineId/scenario/from-to metric/operation/inputRefs/amount|null/unit/currency/period/scope/formulaVersion/evidenceRefs/adjustmentId/disposition)，并给ScenarioForecastBridge加选定收入路线、line set、reported/calculated totals、residual与reconciliation状态。不改public Data/Report/EstimatePoint。
- Workflow冻结source/right/version/horizon；纯函数验证算术；独立具名Reviewer审经济机制与反证；governance owner单独授予consumer资格。
- originKind、valueVersionStatus、eligibility是不同轴。caller VERIFIED/hash/brand不授资格。缺field/conflict/basis mismatch即unavailable或unverified。
- 纯算术只可到STRUCTURALLY_VALID_FIXTURE_ONLY；proposal维持REVIEW_REQUIRED；当前reportEligible固定false。author/reviewer不能相同，现有independentOfAuthorClaim只是caller字段。
- 保留exact raw token、formula version和高精度；展示只round一次。reconciliation tolerance由已存source rounding quantum推导；precision缺失则tolerance未知，显式保留residual，不设任意百分比。
- evidenceManifestHash/valueVersionProofSetHash/reviewPacketHash变化需使review stale；value/basis/rights/proof/asOf/formula/method都触发更新，不能复用旧PASS。

## 6. 时间语义与不可变版本

sourcePublishedAt是载体发布时间；valueVersionAvailableAt是精确value由可信外部记录证明可用时间；retrievedAt是本地响应接收完成时间；snapshotCapturedAt是内容捕获时间；snapshotSealedAt是正文与逐值binding封存时间；analysisAsOf是判断截点。互不替代，SHA只证字节一致。

| 类型 | 时序/信任要求 | 可否晚获取 | 负例 |
|---|---|---|---|
| 动态采集快照 | retrievedAt ≤ capturedAt ≤ sealedAt ≤ asOf；同一provider响应，重解析原文并绑定token/locator/unit/period/revision/rights，外部provenance可验 | T0不允许retrieval晚于截止；晚获取当前响应是后验 | 晚取却自称早capture/seal；seal<capture；改正文复用hash；仅id/status/hash；report date早但numeric version未知 |
| 预先封存可信archive | T0前经批准签名/时间戳和独立链封存，内容/row binding不变；capture≤seal≤asOf，外部registry证明availableAt≤asOf | 可以：retrievedAt可晚，但只下载同一预封存对象，seal≤retrieved并能复验archive proof | T0后下载current page再回填早时间；caller自称trust root；无法复现同一object/row；token/locator变更；revision未知 |
| 官方文档/provider vintage | 外部登记绑定精确版本/row/correction chain，availableAt≤asOf | 可晚取回已有旧版本 | report date/current page/local hash不能单独证明 |

**当前validator差异。** scenario-method-validation.ts对TRUSTED_SEALED_SNAPSHOT要求capture/seal、capture≤seal≤asOf、capture≤retrieved（所以可seal后再检索）；并核验trustRoot是否位于APPROVED_HISTORICAL_TRUST_ROOT_IDS。该数组为空，输出仍UNVERIFIED。类型没有snapshot-origin discriminator，无法分别验证动态链的retrieved≤capture与预封存archive的seal≤later retrieval。当前允许late retrieval形态但无archive provenance验证，也没要求动态retrieval/capture顺序。不能反转当前比较器或称archive已可信。最小后续私有需求：snapshotOrigin=DYNAMIC_CAPTURE|PRESEALED_ARCHIVE；分型时序校验；批准的外部signer/archive verifier；原文/row binding/rights/revision验证；late-fetch、伪造早seal、合法late-download测试。另批前不改。

## 7. F25+测试方案与S4-007B-002拆批

全为合成fixture，不访问真实source、不跑公司、不写Knowledge。

| ID | 输入/预期 | 建议owner/file | 禁止副作用 |
|---|---|---|---|
| F25 | 同业务行volume×ASP或segmentRevenue二选一；同时累加报DOUBLE_COUNTED_REVENUE_PATH | pure calculator / scenario-economic-bridge.ts | 不补量价 |
| F26 | FY/H1、CNY/USD、元/千元、parent/consolidated、basic/diluted混用均拒绝 | private validator | 不自动转换/年化 |
| F27 | 并购/消除/重分类各有证据只计一次；duplicate id拒绝；未归因留RESIDUAL | bridge tests | 不清零残差 |
| F28 | COGS/SG&A/R&D及non-recurring account mapping唯一可算，已包含在operating total中的one-off不得二次扣；重复扣项拒绝 | bridge tests | 不用历史margin替成本，不重复扣non-recurring |
| F29 | NP/NCI归属和符号有证据可得parentNP；缺NCI或用EPS当NP即unavailable | bridge + business_driver tests | 不把consolidated当parent |
| F30 | EBIT/tax/D&A/CapEx/匹配NWC齐备可算FCFF，任缺无结果 | bridge tests | 不用CFO shortcut |
| F31 | 只有CFO及购建长期资产支出时，只输出现金流差和FCFF_INPUTS_MISSING | bridge tests | 不输出Reverse DCF |
| F32 | H1保留YTD；有证据的零可用，missing保持unavailable | observation tests | 不年化/补0 |
| F33 | 并表/处置/重分类要求显式scope adjustment与residual | bridge tests | 不称有机增长 |
| F34 | 三情景有值但缺校准/反证/trigger则REVIEW_REQUIRED | assumption validator | 不以排序代因果 |
| F35 | 历史/行业min-median-max作case而无机制，报HISTORICAL_ENVELOPE_NOT_CALIBRATION | validator | 不包装预测 |
| F36 | 数值相同但换source/version/locator/right后旧review stale；仅canonical key顺序变化时hash稳定 | private hash tests | 不复用review |
| F37 | rights/use/revision/availableAt变更后资格重算且STALE_REVIEW | Workflow review tests | 不信caller ALLOWED |
| F38 | 只有EML认证、扩产、匿名客户而无订单/收入行，future revenue=MISSING | product/driver fixtures | 不造订单客户或营收 |
| F39 | A/H价格/币种/FX/股数齐为结构fixture；缺H/FX/rights则unavailable | equity market tests | 不用A价乘总股数 |
| F40 | 东山T0早于H交易，后验价格拒绝；T1只能新run/asOf/manifest | PIT tests | 不改旧run |
| F41 | atomic ref缺失时对应section保留MISSING，其余有效；19节仍required | assembly tests | 不补0/不降19门 |
| F42 | author=reviewer、reviewer不可信或packet变更则REVIEW_REQUIRED/STALE | Workflow lifecycle | 算术不设Qualified |
| F43 | 正确token/row proof及变更token/period/hash/revision/rights反例 | private observation validator | 不访问真实源/加trust root |

迁移白名单建议：A只改scenario_valuation/SKILL.md，采用第2节redline；B只做经另批的私有economic bridge与synthetic tests，不接真实数据、不改public schema；C另批review handoff/身份资格；D再分开批provider/license/PIT、模型/Reviewer、新T1、公司重跑和Knowledge。每批写明owner、文件白名单、回退和no-source/no-model/no-Knowledge测试。

## 8. Git与停止点

- 开始时local branch codex/company-research-p0-01-06，HEAD和origin都精确为冻结SHA `9e92da61828dbc2a6a044b451bee85e57cf83c88`。
- 保留五个dirty用户 JSON：RHL-EXEC-003-A-004-FIX-002-thesis-authorized.json、FIX-003-event-readonly.json、FIX-003-industry-readonly.json、FIX-003-thesis-references.json、company-quality-pi-default-deny.json。未跟踪/ignored parser __pycache__、runtime-launch日志、tmp不读写、不清理、不暂存。
- 15个旧BYD/东山run/report/bundle/workflow/started/KB integrity sidecars只读、未重哈希或写。
- 19/19及独立审阅标准不变；两家公司T0仍17/19 blocked，S4-007B未实施、P0-19 NOT_ACCEPTED。未签发Skill method APPROVED、S4 implemented、M1/M2数值可行或T1。
- 唯一拟新增文件：`docs/engineering/reports/2026-10-28-company-research-s4-007b-001-method-data-audit.md`。不合并main、不改历史。文档链接检查未发现损坏链接，F25–F43测试计划与19节矩阵存在；暂存后执行git diff --cached --check。未运行测试/数据/模型/Workflow。

**最高状态：** `S4-007B-001 AUDIT_READY_FOR_ARCHITECTURE_REVIEW`。这不是Skill方法批准、S4-007B实施、M1/M2可行、双公司19/19或P0-19接受。
