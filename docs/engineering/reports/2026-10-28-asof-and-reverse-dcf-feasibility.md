# `asOf` 时间语义与 Reverse DCF 可行性审计

日期：2026-10-28
审计代码基线：`15eebc942d02d7ccaf6b433f67c3e2ed70dfef6a`（包含 `254a9d9` 后续修复；本次仅追加审计澄清）
范围：仅复核已保存的 BYD（002594）和东山精密（002384）只读运行；不调用数据源、模型或 Knowledge 写入。

## 结论

- 已修复当前动态来源快照的私有 Workflow 校验：来源原文哈希和原始预测行须与点证明一致；采集、捕获、封存必须按 `retrievedAt <= snapshotCapturedAt <= snapshotSealedAt <= asOf` 排序。`publishedAt` 是来源所报的发布日期，不是本地捕获时间；动态快照可用于截止前当前观察，但不构成历史版本。只有可信版本登记路径提供的 `versionAvailableAt <= asOf` 才可能证明某一不可变版本在截止时已可用；当前没有此类 resolver/信任根，所以历史模式一律拒绝把 `valueVersionId`、`IMMUTABLE_DOCUMENT`/`VERIFIED` 字符串或非空哈希当作已验证版本。
- 合并旧字段盘点及 Recovery 003 官方披露复核后的结论是：Reverse DCF / Price-implied Expectation 在现有保存数据下对两家公司都**不可行**。BYD 的 A/H 股数有部分官方披露支持，但无同截止 H 股价格及完整 EV 桥；东山截止时 H 股尚未挂牌，禁止使用截止后价格，HKD 86.80 IPO 发行价也不是可交易报价。两家公司均缺同截止完整 EV 桥和经独立复核的前瞻 FCFF、WACC 与终值输入。没有实施替代预期面。
- 之前“单凭已保存数据无法判断股数”的概括已被官方 CNINFO 披露复核细化：BYD A/H 股数、东山 A 股基数/回购及 IPO 条款有来源定位；这不消除市场价格、稀释和 EV 桥缺口。
- 本审计不改变 19/19 核心章节和独立语义复核标准。现有对应运行仍为 17/19、`blocked`；不能把本地规则测试视为真实公司验收。

**合并后的总判定：** 已存官方披露与 A 股收盘字段可以定位，故部分历史输入“可观察”；这不等于 Reverse DCF 或 Price-implied Expectation 可行。BYD 缺同截止 H 股价格及完整 EV 桥；东山精密旧 `asOf=2026-10-27T20:26:46.347Z`（上海 2026-10-28 04:26:46）早于挂牌及开市，严禁使用挂牌后任何价格，也不得用 HKD 86.80 发行价替代交易价。两家公司均缺完整 EV 桥和经过来源/责任人登记、独立语义复核的逐年 FCFF/WACC/终值输入。结论为 `NOT_FEASIBLE_WITH_EXISTING_AUTHORIZED_DATA`，未执行反向 DCF，也未实施替代预期面。

## 按字段的可行性判断

以下数值来自 `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/` 下两份已保存的 `analysis.json` 及相应验收清单。财务期间为 2026-06-30，报告披露时间分别为 BYD 2026-08-29、东山精密 2026-08-22。财务行被保存为 `CURRENT_VALUE_ONLY`；期间早于运行截止，但这不等于运行截止日的资产负债快照。

| 字段 | BYD 002594 | 东山精密 002384 | 判断与使用边界 |
|---|---|---|---|
| 价格 | CNY 82.01/A 股；未复权；2026-10-27 收盘候选 | CNY 101.09/A 股；未复权；2026-10-27 收盘候选 | 保存来源是 AKShare/Tencent 历史行情。日线可用时点须按交易日收盘规则核验。东山 cutoff 为 2026-10-28 04:26 Shanghai，H 股当时尚未挂牌；任何挂牌后报价均晚于 `asOf`，不得使用。截止前公开的 HKD 86.80 是发行价，不是可交易报价。 |
| 稀释股数及股份类别 | H1/月报可定位 A/H 已发行股数，但缺完整 cutoff 稀释审计 | H1 可定位 A 股基数，另有 H 股 IPO 条款；最终配发及 cutoff 后状态不构成截止前可用报价 | **不完整**。BYD 缺 H 股同截止市场价和全部稀释核对；东山缺最终配发数及可交易 H 股价格。 |
| 现金 | CNY 58.738bn（2026-06-30） | CNY 8.793bn（2026-06-30） | 有上半年资产负债表时点值；受限现金及可用于 EV 桥接的现金定义未证明，且非截止日余额。仅作字段存在性和旧期间拒绝测试。 |
| 债务范围 | 短借 CNY 37.646bn；长借 CNY 61.201bn；应付债券 CNY 14.994bn；一年内到期非流动负债 CNY 3.453bn | 短借 CNY 9.630bn；长借 CNY 9.441bn；应付债券字段缺失；一年内到期非流动负债 CNY 2.975bn | **不具备完整净债务桥**。一年内到期非流动负债可能包含非债务项目，是否与已列借款重叠、租赁负债及受限现金均未核实；不得直接求和或构造净债务。 |
| 现金流 / 资本开支 | H1 CFO CNY 37.335bn；资本开支映射 CNY 44.703bn；同期差额 **−CNY 7.368bn** | H1 CFO CNY 2.384bn；资本开支映射 CNY 5.253bn；同期差额 **−CNY 2.869bn** | 正向测试仅限同期间减法及 YTD 标签。该值不是完整 FCFF；税、利息/债务处理、非现金项、营运资本标准化及少数股东口径未形成桥接。不得年化。 |
| 股权价值到 EV 桥接 | 缺少股数；净债务口径不完整 | 缺少股数；债券字段缺失且净债务范围不完整 | **不可计算**。不得用未核验的同日行情、市值或账面数补足。 |
| 前瞻经营预测 / FCFF | 无经独立复核的收入、利润、税、再投资与营运资本路径 | 同左 | **缺失**。历史 FY2025 或 H1 观察不构成可证伪的前瞻现金流预测。 |
| WACC | 无风险利率、ERP、Beta、债务成本、税率、资本权重及引用/假设登记 | 同左 | **缺失**。无法折现。 |
| 终值 | 无明确年限、永续增长、稳定期利润率/再投资或有来源依据的退出倍数 | 同左 | **缺失**。无法形成终值；禁止用任意倍数代替。 |
| 来源时间与版本 | H1 报告发布时间早于 `asOf`；行情记录是 10-27 日期日线 | 同左 | 财报的报告发布日期可以证明报告已公开，不会把它升级为截止日资产负债表。历史预期仍须有精确版本/修订证明；`retrievedAt` 不应替代 `publishedAt` 或版本可用时点。 |

### 保存运行的状态

配对 run ID：BYD `82bcc425-d48d-4e55-bc45-111aa8c28ba4`；东山精密 `860916a8-4958-4d29-8da1-56ad5dd1c2c6`。两份验收清单均为 `blocked`、17/19；`bull-base-bear` 缺少有定位证据的研究输入，`variant-perception` 的预期版本未核验。清单记录 Knowledge 未变。本次不重跑公司研究，也不修改既有 run 的 `asOf`。

## 正反测试矩阵

| 面 | 正向测试 | 反向测试 | 结论 |
|---|---|---|---|
| 动态快照时间及内容 | 来源正文哈希匹配，原始行/预测点字段、期间、机构、发布日期和行哈希/指纹一致，且 `retrievedAt <= capturedAt <= sealedAt <= asOf` | 将晚获取来源配上伪造的 cutoff 前 seal；篡改正文但保留旧哈希；单独伪造非空 row hash/fingerprint | 三项反例均拒绝；当前快照不升级为历史版本证明。 |
| 市场收盘可用时间 | 同日收盘且 `observationAvailableAt = dailyCloseAvailableAt(priceDate) <= asOf` 可用 | 截止早于上海 15:00 收盘、缺失/伪造可用时点、或可用时间晚于截止时拒绝，即使日期相同且旧质量标记为 safe | 已新增确定性 Workflow 单测。 |
| CFO 减资本开支 | 仅当两项同币种、同期间、均为 YTD 时复算上述差额并明确标为“CFO 减资本开支” | 把半年 YTD 年化、命名为完整 FCFF，或漏掉任一输入时拒绝估值使用 | 当前保留输入盘点；未实现 Reverse DCF 算法。 |
| EV 与每股价值 | 只有同截止的价格、适用稀释股数/类别换算、现金和明确债务范围都可追溯时，才允许按定义做确定性桥接 | 股数缺失/过期、现金受限范围不明、债务重复或口径缺失、财务期间与价格截止不一致时拒绝 | 两家公司均无法通过正向条件。 |
| 折现与终值 | 只有经独立审查、来源或明确批准边界支持的 WACC/现金流/终值参数，且 `WACC > g` 时才可做敏感性面 | 缺少 WACC/年限/终值假设，或 `g >= WACC`、参数无出处、任意退出倍数时拒绝 | 两家公司均无法通过正向条件。 |

## 最小授权需求

若要继续评估 Reverse DCF，请先提供或明确授权一套**仅 Workflow 内部使用、可定位来源/责任人且经独立审查**的输入：

1. `asOf` 对应的价格可用时点和稀释股数/股份类别换算；
2. 同截止现金与债务清单、受限现金及一年内到期负债/租赁负债的纳入规则；
3. 可证伪的前瞻 FCFF 逐年桥接（含税、再投资、营运资本和债务处理）；
4. WACC 组成及来源，或用户批准的敏感性边界；明确预测年限、终值增长/稳定经营假设，及独立复核人。

这些资料目前不在现有已保存数据中。要把它们作为正式公共解析字段接入、增加来源或写入 Knowledge，均不属于本次授权范围；在缺少上述输入前停止 Reverse DCF 实施，不构造替代预期面。

## 验证

- `node --import tsx --test tests/workflows/company-valuation-sections.test.ts`：本次修订后 15/15 通过。
- `npm test -- --run tests/workflows/company-valuation-sections.test.ts`：客户端测试阶段先行执行全套 Vitest，15 个文件通过、2 个文件失败（5 项与本次 Workflow 无关的会话重命名/归档导航断言）；npm 脚本因此未运行 Node 测试。此命令不是有效的单文件过滤方式。
- 未运行模型、公司研究重试、外部数据采集或 Knowledge 写入。

## Recovery 003 补充审计（CNINFO 现有披露路径）

复核时间：2026-10-28（Asia/Shanghai）。运行截止仍为 BYD `2026-10-27T20:19:59.628Z`、东山精密 `2026-10-27T20:26:46.347Z`。本补充不重跑公司研究模型；只读查询使用仓库现有 `CninfoOfficialDisclosureClient` 与已配置 Tencent/AKShare A 股日线结果。PDF 字节只在内存中解析，原文未落盘或提交。

### Gate A — 逐点时间语义与版本信任

时间语义分开解释：`publishedAt` 是供应商给出的报告日期；`retrievedAt` 是本次响应完成获取的时间；`snapshotCapturedAt` 是该响应内容被纳入本次快照的时间；`snapshotSealedAt` 是该快照正文及点绑定被封存的时间；`versionAvailableAt` 必须来自可信的不可变版本登记，而非调用方字段。当前两个 acquisition adapter 在取得响应后以本地 `retrievedAt` 同时标记 capture/seal（同步规范化和哈希封存），Workflow 再核验顺序；故不是供应商提供或签名的时间证明。动态快照必须满足 `retrievedAt <= snapshotCapturedAt <= snapshotSealedAt <= asOf`。不可变历史版本须额外满足可信记录中的 `versionAvailableAt <= asOf`；动态快照的封存时间不能替代版本可用时间。当前没有可信版本登记/解析路径，因此历史模式拒绝所有预测点。内容哈希须由 Workflow 对 `source.content` 重算；行哈希和点指纹须从该正文重新解析的原始行重算，并匹配字段、值、期间、机构、发布日期及 source candidate。晚获取 + 伪造早封存、正文篡改均被拒绝。

**信任边界及原始内容绑定路径：** 已配置 THS/EastMoney acquisition adapter 将实际返回行规范化为 provider envelope；该 envelope 成为 `NormalizedResearchSource.content`。Workflow 重算 envelope SHA-256，检查 provider，再从 envelope 取出原始 row；其稳定序列化 SHA-256 必须与 `observedRowHash` 相同，点指纹再绑定 estimate/source/provider/字段/数值/期间/机构/发布日期/单位。由此可审核“adapter 收到的行 → 被封存正文 → 被选择的预测点”，防止传递后换行或改值。该链不独立证明上游响应来自真实供应商：SHA-256 不等于签名，provider/source ID/`VERIFIED` 也只是可传入数据。当前没有供应商签名校验、可信归档索引或独立 value-version resolver，因此只能声称本地内容完整性绑定，不能声称供应商版本真实性或历史可用性；历史值继续 `UNVERIFIED` 并拒绝入选。测试 fixture 只验证拒绝/接受逻辑，不是生产来源证明。

新增正反例覆盖如下：

| 情形 | 结果 | 定向测试 |
|---|---|---|
| 截止前获取并封存、逐点绑定原文的动态快照 | CURRENT 接受为当前快照；HISTORICAL 拒绝回填 | `cutoff sealed content-bound snapshots render a current comparison...` |
| `retrievedAt > snapshotCapturedAt` 或封存早于捕获（晚获取 + 伪造早封存） | 拒绝 `SNAPSHOT_TIME_ORDER_INVALID` | `late retrieval with a forged early seal...` |
| 对来源正文追加字节但保留原 `contentHash` | 拒绝 `SOURCE_CONTENT_HASH_MISMATCH` | `source content hash must match...` |
| 仅提供任意 ID、VERIFIED 状态和非空 hash 字段 | 历史拒绝 `IMMUTABLE_VERSION_TRUST_UNAVAILABLE`；篡改 row/hash 当前亦拒绝 | `self-asserted immutable IDs...`; `nonempty hashes alone...` |
| `retrievedAt`、capture 或 seal 晚于 `asOf` | 拒绝 | `retrieval time and publication time cannot substitute...` |
| 上海同日收盘前 / 收盘后 | 收盘前拒绝；对应收盘可用时点后接受 | `same-day market close is rejected before...` |
| 多条机构/期间 EPS 逐点绑定及被篡改值 | 缺证据或绑定不一致的点被拒绝，其他有效点保留 | `expectation surfaces reject missing proof...`、`point proofs reject...` |

这覆盖当前状态机关键正反路径；现有供应商是否提供可认证的版本和更正关系仍无证据。没有改 Data 公共契约、Knowledge、Skill 方法或适配器的资格状态。

### 估值与预期面原子 Skill 契约核查

本核查只评估输入/输出契约与已保存字段是否兼容，不执行 Skills 或估值计算。证据仍须由 Workflow 提供，原子 Skill 不得自行补来源或制造缺失数据。

| Skill | 契约与实现边界 | 与两家公司现有字段的匹配情况 |
|---|---|---|
| `business_driver_analysis`（[`SKILL.md`](../../../skills/business_driver_analysis/SKILL.md)、[`contracts.ts`](../../../skills/business_driver_analysis/contracts.ts)、[`calculations.ts`](../../../skills/business_driver_analysis/calculations.ts)） | 可计算同口径历史收入/利润变化并输出驱动解释；计算器不建立未来销量、ASP、组合或利用率假设。缺字段须保留限制。 | 仅支持有披露的历史基线；两家公司当前保存材料都缺足以拆解未来收入/利润的同期间经营量价数据，不能据此写前瞻经营桥。 |
| `financial_quality_analysis`（[`SKILL.md`](../../../skills/financial_quality_analysis/SKILL.md)、[`contracts.ts`](../../../skills/financial_quality_analysis/contracts.ts)、[`calculations.ts`](../../../skills/financial_quality_analysis/calculations.ts)） | 以对齐期间、单位、合并/归属口径的历史报表做确定性比率/趋势；不将 CFO−capex 冒称 FCFF，也不推演估值期现金流。 | 报表定位支持若干历史字段；估值桥仍受受限现金、债务构成/重叠及点时余额缺失阻断。H1 CFO−capex 仅是同期间算术差，不满足 DCF 输入契约。 |
| `dcf_valuation`（[`SKILL.md`](../../../skills/dcf_valuation/SKILL.md)） | DCF 方法依赖明确的前瞻现金流、折现率、终值及来源；数值计算器做数学校验，不为其输入背书。 | 两家公司均无经登记且独立复核的逐年 FCFF、WACC、稳定期或终值参数，缺项应为 unavailable。 |
| `reverse_dcf_expectation_decode`（[`SKILL.md`](../../../skills/reverse_dcf_expectation_decode/SKILL.md)、[`dcf.ts`](../../../skills/valuation/calculations/dcf.ts)） | 需截止 EV/价格、股数、债务/现金桥、预测 FCFF、折现率、终值增长、估值日和 refs；`calculateReverseDcf` 只负责算术，不验证来源/PIT/单位/责任人。 | BYD 无同截止 A/H 完整市值桥；东山旧 cutoff 早于挂牌，上市后价格禁用；两家前瞻现金流及折现/终值输入均缺失，契约不满足。 |
| `expectation_gap`（[`SKILL.md`](../../../skills/expectation_gap/SKILL.md)、[`contracts.ts`](../../../skills/expectation_gap/contracts.ts)、[`calculations.ts`](../../../skills/expectation_gap/calculations.ts)） | 仅对指标、期间、单位、basis 可比且有来源引用的预期面做兼容性判断和差值；引用可追溯不等于上游版本已证明。 | 当前 consensus 点可绑定到本次响应内容，但无可信历史版本可用时间；不能构造旧 cutoff 的合格 consensus 面，也没有 price-implied 面供比较。 |

契约审查结论：原子方法边界与“缺失即不可用”的基本规则兼容；现有输入不满足反向估值所需前提。`reverse_dcf_expectation_decode` 对“Future observations and synthetic assumptions are rejected”的表述仍未区分“禁止无来源编造参数”和“允许登记、可证伪并经复核的研究假设”；作为后续契约澄清项记录，本轮未改 Skill 文本或实现。不得把计算器可运行、技能契约存在或 fixture 测试通过等同于方法所需数据已合格。

### Gate B — 两家公司逐字段可行性

`sourceCandidateId` 是 CNINFO URL 派生的现有规范 ID。以下官方报告版权边界均为 `accessScope=public`、`retentionAllowed=true`、`aiProcessingAllowed=true`、`redistributionAllowed=false`；仅供本地研究审计，不把原始 PDF 放入 Git。财报单位按表列示；财务数值为合并口径，人民币元，以下用十亿元（bn）显示。

| 字段 | BYD 002594 | 东山精密 002384 | EV/反向 DCF 资格 |
|---|---|---|---|
| 价格与交易时点 | CNY 82.01/A 股、未复权、2026-10-27 日收；既有行情 fallback 为 `akshare-tencent-historical-market-data`。EastMoney primary 发生代理错误，故未交叉核验。cutoff 在次日上海时间 04:19，晚于该日 A 股收盘。 | CNY 101.09/A 股、未复权、2026-10-27 日收；同一 Tencent fallback，EastMoney primary 代理错误；cutoff 在次日上海时间 04:26。 | **部分**。都是 A 股单类别价格，不是集团 A/H 同时点市值；没有本任务现有市源路由返回 BYD H 股报价或东山上市后 H 股成交价。东山 cutoff 时 H 股尚未开市，IPO 发行价不等同于该时点可交易价格。 |
| 最近公开普通股与类别 | H1 报告 `official-c19c34dd239b2e9c`，SHA-256 `c521306221e896b4cbfbdf18a84d18fadf409db5bea7a8d3ef70a08c4f366ca6`，披露 `2026-08-28T16:00Z`：A 股 5,433,797,565、H 股 3,683,400,000（报告 p.57；千股表 p.80）。CNINFO H 股月报 `official-aae298506d8e3fce`，公告 1225595406，披露 `2026-10-07T16:00Z`，文本 SHA `ed22804ac7a7d2dff12e4eed39ea6e5004dc06d13c7feb6eb49820c890eb175c`：截至 9/30 A/H 股各自结存仍为 5,433,797,565 / 3,683,400,000，9 月增减为空（表格段落 55–71、99–115、128–130）。 | H1 报告 `official-296fff2b2889c26f`，SHA-256 `6500c4e7c05ab455ebbbfc5eba1fa7ede7a48d6be171c53c4edc87c4682f707a`，披露 `2026-08-21T16:00Z`：A 股股本 1,831,607,532（p.37）；H1 员工持股计划列示 3,048,701 股，基本及稀释 EPS 均为 CNY 1.62（p.47）；EPS 分母是加权口径，不可替代估值日股数。回购公告 `official-f5baf98acbff1fd0`，公告 1225600029，披露 `2026-10-09T16:00Z`、截至 9/30 累计回购 A 股 255,200 股（0.01393%；文本段落 15）；未见注销，不能直接改变已发行股本。H 股发行仍处于挂牌前阶段。 | **BYD 股数部分可审计，但市值不完整**：A/H 股数已核实，仍缺同一截止时点的 H 股市价及 A/H 币种处理；也未从截止前最后一期的所有潜在摊薄安排得出完全稀释股数。**东山不完整**：H 股最终发行/配发数量未在本次已查到的 CNINFO 记录中确认；回购只证明截至 9/30 的买回额，不能证明 cutoff 前后净发行/库存股状态。 |
| H 股披露后事项 | H 股月报证明截至 9/30 股数无增减；H1 之后仍须审视是否有 10 月发行、回购或其他 A 股变动。该月报不证明 10 月至 cutoff 全部公司行动。 | CNINFO 招股书刊发公告 `official-594d5acb2ae76fb0`，公告 1225611578，披露 `2026-10-19T23:40:10Z`，文本 SHA `97f2d3452f83b9b8d3660254a12236ef15fd19252d60d951bad17dfc22cf3f43`：H 股基础发行 113,783,200 股，发行量调整权最多 17,067,400 股，另有超额配股权，最大总发行 150,478,100 股（段落 31）；最终价格预告上限 HKD 93.80（段落 33）。CNINFO 发行价公告 `official-c99ce248ea972a56`，公告 1225621945，披露 `2026-10-25T23:46:08Z`，文本 SHA `b0d79f92118225acdebad09909a37c3cfe849562f71d67f95a171dc37bd5c9f9`：最终发行价 HKD 86.80（段落 13），预计 10/28 开始上市交易（段落 15–17）。 | **东山明确阻断项**：发行价和发行范围虽在 cutoff 前公开，但 cutoff 为 10/28 04:26 Shanghai、港股开盘前；基础发行股数不是最终配发数，发行价不是可交易收盘价。发行所得及上市后稀释均未并入 6/30 资产负债表或 9/30 股数。不得用发行上限、预计股数或 IPO 发行价冒充精确市值。 |
| 现金与非经营资产 | 6/30 H1 合并现金 CNY 58.738bn（p.65）；受限货币资金 2.882bn（p.135），另有外币受限资金 0.335bn（p.107，是否重叠未核）；其他非流动资产内定期存款/CD 19.308bn，交易性金融资产 69.940bn（p.65、135）。 | 6/30 H1 现金 CNY 8.793bn（p.41）；受限货币资金 1.845bn（p.23、97）；现金等价物 6.948bn（p.49）。交易性金融资产 0.797bn，不能自动全作多余现金。 | 最近已公开资产负债表日期可用；但受限现金、外币受限资金重叠、存款可变现性、金融资产经营用途及 6/30 至 cutoff 变动未全部核清。**不能用估值日余额替代要求**，但需明示其时点差距和披露后事件。 |
| 借款、债券、租赁和到期项 | 6/30 短借 37.646bn、长借 61.201bn、应付债券 14.994bn、租赁负债 8.610bn、流动到期项 3.453bn（p.66）。流动负债明细另列借款/债券/租赁/股东赎回等，须以附注拆分避免重复。其他非流动负债 81.278bn 不能全当有息债。 | 6/30 短借 9.630bn（p.42）、长期借款 9.441bn、租赁负债 1.917bn、流动到期项 2.975bn（p.43）；债券行未列。附注将到期项拆为长借 2.697bn、长期应付款 0.028bn、租赁 0.279bn（p.100），不得重复加总。 | 有部分债项，但没有同截止净债务清单、完整一年内到期拆分/重叠表、受限现金扣减规则、东山 IPO 现金流入和费用。BYD 另有其他权益工具/永续证券 20.847bn（p.66、83），无合同到期/付息特征，归入债或权益需要明确桥接政策。 |
| 少数/优先权益 | 少数股东权益 12.552bn（6/30，p.66）；永续证券 20.847bn 分类未解决；未发现 H1 优先股。 | 少数股东权益 0.182bn（6/30，p.43）；无债券项目行，未见优先股行。 | 均需纳入明确 EV 到普通股权益的桥接；BYD 永续证券处理未批准。 |
| 历史 CFO − capex | H1 YTD CFO 37.335bn 减购建长期资产现金流 44.703bn = −7.368bn。 | H1 YTD CFO 2.384bn 减购建长期资产现金流 5.253bn = −2.869bn。 | 仅为同期间、同币种算术差额，不是 FCFF；不得半年年化，也未调整利息税务、非现金、营运资本、净借款/少数股东。 |
| 前瞻收入/FCFF | 无经授权并独立复核的逐年收入、利润率、税、折旧、资本开支、营运资本和 FCFF 桥。 | 同左。另需纳入 H 股新发股份及所得款项带来的后续资本结构变化。 | **不可作为已审计操作数**。有依据、可复算、明确标为研究假设的预测可能构成后续输入，但本次不造数、不年化历史 CFO−capex。 |
| WACC / 终值 | 无截止适用的无风险利率、ERP、Beta、股权/债务成本、税盾和资本权重来源；无预测年限、稳定期再投资/利润率、终值增长依据。 | 同左；多类别股权及 IPO 后资本权重更未定。 | 不计算 Reverse DCF。现有 `calculateReverseDcf` 是纯算术核，无时点、来源或假设资格验证；现有 Skill 应明确“拒绝无来源合成值”，并区分允许被审计的未来研究假设。Gate B 已阻断，本轮不改 Skill 方法、不运行计算。 |

### Reverse DCF 原子 Skill 契约审查

审查对象为 [`skills/reverse_dcf_expectation_decode/SKILL.md`](../../../skills/reverse_dcf_expectation_decode/SKILL.md) 及算术实现 [`skills/valuation/calculations/dcf.ts`](../../../skills/valuation/calculations/dcf.ts) 的 `calculateReverseDcf`。契约要求当前 EV/价格、股数、债务/现金桥、明确 FCFF、折现率、终值增长率、估值日和来源引用；收入 CAGR 还要求当前收入及正的稳定期 FCFF margin。缺任一必需输入应为 unavailable，不能补零或推断。计算器只做数值与数学约束检查（有限值、正终值、discount > terminal growth、正的稳定期 margin），本身不校验来源、PIT、单位、责任人或假设资格；这些须由 Workflow 交接和独立语义复核保证。

契约文字“Future observations and synthetic assumptions are rejected”对“无来源编造参数”与“有来源/明确登记并可反证的研究假设”边界表述含糊；这次只记录为契约澄清项，没有改 Skill、调用计算器或生成数值。未来的替代预期面必须先证明 EV 桥及每项预测/折现/终值输入可定位、带责任人、可复算且经独立审核。现状下两家公司均不满足输入契约，所以不能以纯算术函数可执行作为数据可行的证明。

### 官方来源定位摘要

本报告正文只记录字段、定位及哈希，不存放原始 PDF 或 CNINFO 全文。定位规则：BYD H1 报告 `official-c19c34dd239b2e9c`，披露 2026-08-28 16:00Z，SHA-256 `c521306221e896b4cbfbdf18a84d18fadf409db5bea7a8d3ef70a08c4f366ca6`；A/H 股数 p.57（千股表 p.80）、现金 p.65、债项 p.66、限制/定期存款 p.135、永续证券 p.83。BYD H 股月报 `official-aae298506d8e3fce` / 公告 1225595406，文本 SHA-256 `ed22804ac7a7d2dff12e4eed39ea6e5004dc06d13c7feb6eb49820c890eb175c`，表格段落 55–71、99–115、128–130。

东山 H1 报告 `official-296fff2b2889c26f`，披露 2026-08-21 16:00Z，SHA-256 `6500c4e7c05ab455ebbbfc5eba1fa7ede7a48d6be171c53c4edc87c4682f707a`；股本 p.37、员工持股及 EPS p.47、现金 p.41、借款/少数权益 p.42–43、限制现金 p.97、到期项拆分 p.100。回购公告 `official-f5baf98acbff1fd0` / 1225600029，文本 SHA-256 `ca5d9fff6f62a30494d0ae126d079d97ad7c8d17a1a9a16a96eee733f892bae0`，段落 7、15。H 股发行范围通知 `official-594d5acb2ae76fb0` / 1225611578，披露 2026-10-19 23:40:10Z，文本 SHA-256 `97f2d3452f83b9b8d3660254a12236ef15fd19252d60d951bad17dfc22cf3f43`，段落 31、33、35。最终发行价/预计挂牌通知 `official-c99ce248ea972a56` / 1225621945，披露 2026-10-25 23:46:08Z，文本 SHA-256 `b0d79f92118225acdebad09909a37c3cfe849562f71d67f95a171dc37bd5c9f9`，段落 13、15–17。东山 `asOf=2026-10-27T20:26:46.347Z`（2026-10-28 04:26:46 Shanghai）早于当日港股挂牌/开市，因此任何上市后市场价格明确属于截止后数据并禁止使用；HKD 86.80 只作为事前公布的 IPO 发行价记录。

**权利与来源边界：** CNINFO 发布的东山公告内容说明完整 H 股招股书在联交所刊发，CNINFO 公告仅为境内投资者提供信息，并不是购买/认购要约；本审计只使用 CNINFO 公告公开重复的发行范围、价格和预定上市日，没有抓取或提交完整 H 股招股书。BYD H 股月报和两家公司 H1 报告是官方公司披露；原始 PDF 不在 Git 中。CNINFO 披露不可再分发，因此报告保留字段、定位及哈希，不携带原文正文。

### Gate C/D — 结论与最小授权点

**字段盘点状态：`PARTIALLY_FEASIBLE`; Reverse DCF / Price-implied Expectation 状态：`NOT_FEASIBLE_WITH_EXISTING_AUTHORIZED_DATA`。** 两家公司均找到真实、截止前公开的官方报告输入；BYD 可证 A/H 已发行股数，东山可证 A 股基数、9 月回购及 H 股最终发行价。但两家都没有可独立复核的同截止时点完整股权市值与 EV 桥：BYD 缺 H 股同日市场价格/类别转换与全部稀释核对；东山在 H 股上市前截止，缺最终配发数、可交易 H 股价格和 IPO 后现金/股份桥。故两种预期面均未达到数值可行；不实施替代预期面，不输出目标价、隐含 CAGR、WACC 或终值。

继续前只需最小范围的明确授权/输入：

1. **免费官方来源授权（若希望由 Codex 补查）：** 只读查看 HKEX 官方东山 H 股最终配发/超额配售结果与挂牌后日收、BYD 01211.HK 截止前收盘；允许仅在审计报告中记录定位/哈希，不复制或提交受限全文。若不授权新官方端点，可由用户提供这几项带来源和可用时点的字段。不得使用付费研究来源。
2. **汇率与股份类别：** 指明允许用于同截止时点 HKD/CNY 转换的已有市场/官方 FX 记录；BYD A/H 分类别市值与 Dongshan IPO 新股数必须分开保留，禁止 A 价乘总股数。
3. **估值阶段另行审批：** 只有 EV 桥成立后，才提交 FCFF 逐年研究假设、WACC 有界敏感性、稳定期/终值参数、来源/校准/反证和独立复核要求的具体实现计划。本次不预先授权这些经济假设。

以上授权不会扩大公共数据契约或增加付费来源。仍须保持既定 19/19 核心章节、独立语义复核和只读 Knowledge 哈希标准；旧两家公司验收仍为 17/19、`blocked`，本次未重跑或升级。

## 本次代码与验证

- 改动限于 valuation Workflow 私有判定、相关 acquisition adapter 点证明/正文哈希、定向测试和本审计报告；没有改公共 Data contract、Reverse DCF Skill、Knowledge、公司运行产物或来源政策。
- 定向测试 `node --import tsx --test tests/workflows/company-valuation-sections.test.ts`：15/15 通过，覆盖晚获取伪造早封存、原文哈希错配、伪造非空 row hash/fingerprint，以及任意版本 ID / `VERIFIED` 状态不能证明不可变历史版本。
- 完整 Node 回归 `npm run test:node`：3,201/3,222 通过、21 失败；干净 detached 基线 `ea27034f4f949cc7f028f8a80e5a71025a8aa8cb` 为 3,200/3,221 通过、21 失败（新增 1 项测试）。仓库 failure comparator 判为 `BASELINE_FAILURES_IDENTICAL`；21 个归一化失败项 SHA-256 两侧均为 `ea9456822eb399823da77ebb712d491ab8df59790e154dd1d6e857e3a75e0fa0`，新增失败为 0。
- 完整客户端回归 `npm run client:test`：当前和干净 detached 基线均为 17 个测试文件中 15 通过、2 失败；总计 218 通过、5 失败。五项完全相同：3 项 `src/App.test.tsx` 的会话重命名/归档交互，2 项 `src/app/report-navigation.test.tsx` 的原对话导航。
- `npm run typecheck`、`npm run client:typecheck`、`npm run client:build` 均通过；构建保留既有大 bundle advisory。完整 Node/客户端日志和比较 JSON 存于仓库外 `ResearchHub_worktrees/asof-regression-logs/`，不纳入提交。
- 本轮未增加或调用数据源、付费来源、研究模型、公司研究重跑或 Knowledge 写入。两家公司已保存运行仍为 17/19、`blocked`；19/19 和独立语义复核验收标准均未放宽，也未宣称真实验收通过。

### 本轮复验（审计文档修订后）

- 定向 `node --import tsx --test tests/workflows/company-valuation-sections.test.ts`：15/15 通过。
- 重新执行 `npm run test:node` 并与干净 `ea27034f4f949cc7f028f8a80e5a71025a8aa8cb` 基线比较：当前 3,201/3,222 通过、21 失败；基线 3,200/3,221 通过、21 失败；`BASELINE_FAILURES_IDENTICAL`，新增/消失/同名变更均为 0，失败记录 SHA 两侧均为 `ea9456822eb399823da77ebb712d491ab8df59790e154dd1d6e857e3a75e0fa0`。比较文件及复验日志留在仓库外 `ResearchHub_worktrees/asof-regression-logs/`。
- `npm run client:test` 顺序复验：17 个测试文件中 15 通过、2 失败；223 项中 218 通过、5 失败，失败项与已有基线完全相同（3 项 `src/App.test.tsx` 对话改名/归档、2 项 `src/app/report-navigation.test.tsx` 导航）。第一次与 Node 并行时有额外一项 Thesis CREATE 失败；顺序重跑恢复为原有 5 项，故以顺序复验作比较结果。
- `npm run typecheck`、`npm run client:typecheck`、`npm run client:build` 全部通过；build 仍显示既有大 bundle advisory。复验没有触发模型、外部数据、公司研究重跑或 Knowledge 写入。P0-19 仍为未接受；两家公司仍为 17/19 `blocked`，独立语义复核仍未完成。
