# RHL-CQR-P0-19-DECISION-004 — 来源、预期面与经营假设决策包

**状态：** `DECISION_PACKAGE_READY`；P0-19 仍为 `NOT_ACCEPTED`。
**代码基线：** `15eebc942d02d7ccaf6b433f67c3e2ed70dfef6a`，分支 `codex/company-research-p0-01-06`，远端同 SHA。
**审计范围：** 只读已有保存运行、其已存来源摘要、既有授权/回归记录和静态代码。没有网络请求、模型计算、Reverse DCF 数值计算、公司研究重跑、Knowledge 写入或新源/许可扩权。
**决定目的：** 提供逐公司/字段/路线的证据矩阵及 S1–S4/T1 可批准或拒绝的最小授权项；本报告不批准其中任何一项。

## 1. 冻结的运行与现存结论

使用的最新双公司真实只读运行是原 Gate 0 配对运行。报告/Sidecar 文件在忽略目录中；本报告只记录路径、身份和哈希，不更写原件。

| 公司 | Run / `asOf`（UTC） | 状态 | 章节 / Skill / 独立复核 | 核心失败 |
|---|---|---|---|---|
| BYD 002594 | `82bcc425-d48d-4e55-bc45-111aa8c28ba4` / `2026-10-27T20:19:59.628Z`（上海 10/28 04:19:59） | `blocked` | 17/19；10/10 atomic methods；semantic review attempts 0 | `bull-base-bear`: `RESEARCH_GAP`, `NO_ATTRIBUTABLE_EVIDENCE`, `WORKFLOW_SECTION_NO_LOCATED_EVIDENCE`; `variant-perception`: `RESEARCH_GAP`, `VARIANT_EXPECTATION_VALUE_VERSION_UNVERIFIED` |
| 东山精密 002384 | `860916a8-4958-4d29-8da1-56ad5dd1c2c6` / `2026-10-27T20:26:46.347Z`（上海 10/28 04:26:46） | `blocked` | 17/19；10/10 atomic methods；semantic review attempts 0 | 同上 |

分析、报告 JSON、Workflow、Bundle、Markdown 与只读 Knowledge 完整性文件的 SHA-256：

| 公司 | 文件（位于 `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/`） | SHA-256 |
|---|---|---|
| BYD | `002594-analysis.json` | `60c877932829d114eb02af13304402ec5599b4410df5bc63926f4f646489de35` |
| BYD | `002594-report.json` | `2867b270318b21e334c28246935326dab19fa734c094253bb80637b2c32390c1` |
| BYD | `002594-workflow.json` | `43316166217675df70473ed86cf646fa988dd3dfc53be6c4e75f7f32bf6ff7f6` |
| BYD | `002594-bundle.json` | `1fd11c5f5e7764d23bd4950712faf056efeff09436dd983635b24c156a7a8739` |
| BYD | `002594-company-research-002594-82bcc425-d48d-4e55-bc45-111aa8c28ba4.md` | `0f83c1cd96f5962402eae69503e2c53cdf76e16f01a6acf2f0324e986a036604` |
| 东山 | `002384-analysis.json` | `72588193faff4c2e75fb2e07c0b07197619b8c23b9fa49f843e7f05ae34e98b3` |
| 东山 | `002384-report.json` | `6fa63686b889150551b42eab66b3ce32f4246871f5a3d4be99117d0e0d8917d4` |
| 东山 | `002384-workflow.json` | `0cf91dfa99a0ca0b1daff3b8711e5e29ab1f07c1d693cfa7f986999adc718ebd` |
| 东山 | `002384-bundle.json` | `691f3f561b02523f00865f574f6fd373b202c9dad98502abbd61fa3b5958067f` |
| 东山 | `002384-company-research-002384-860916a8-4958-4d29-8da1-56ad5dd1c2c6.md` | `3c14d4fbb29aee31bc434b9c99b98de3e79f6897581c4519a46aa87f236eb91f` |
| 两份相同 | `002594-kb-integrity.json` / `002384-kb-integrity.json` | `4322cd0b20c70c400615987b06de5d400e45fecc7676cac11cccfd5678ff1f0a` |

两份 KB integrity sidecar 各自记录 `mode=readonly`, `unchanged=true`；前后 `manifest.yaml` 为 `face39bd8ec6d6548d1a998edc2583b6e8d6db7e9a4dbd0cb2f0e6b3f901d0c9`，`registry/assets.yaml` 与 `registry/raw.yaml` 均为 `ca3d163bab055381827226140568f3bef7eaac187cebd76878e0b63e9e442356`。旧运行不能改 `asOf`、覆盖或与新时点运行合并。

**来源时间冻结。** 这两次运行的 `asOf` 都早于本地 sidecar 所记的预测采集完成时点：BYD THS `20:20:01.163Z`、EastMoney `20:20:04.180Z`；东山 THS `20:26:48.000Z`、EastMoney `20:26:49.000Z`。sidecar 没有保存预测行级 `EstimatePoint` / proof，故不得从旧报告中的当前页面行恢复一个“截止时点历史版本”。另一份 CHANGE-001 probe 的 `asOf=2026-10-27T00:24:00Z` 是不同时间样本，不替代本配对运行，也不证明最新 asOf 的可用性。

## 2. 当前路由能力与逐公司字段矩阵

唯一已注册的四类 Company Research requirements 及 route 在 `data/company-research-policies.ts`、`data/company-research-contracts.ts` 和 `plugins/research-acquisition/company-research-data.ts`。当前市场序列是 AKShare EastMoney primary、Tencent A 股 fallback；金融历史是 AKShare primary、statement fallback、CNINFO official financial fallback。没有港股 01211/新上市 02726 报价或 FX requirement/provider。AKShare market bridge 对 EastMoney 只接受六位沪深代码；Tencent bridge 明确支持 SH/SZ。运行记录中没有任何 FX 或港股价格调用。

| 字段组 | BYD：现有值、来源、状态 | 东山：现有值、来源、状态 | 能得出的结论 / 不足 |
|---|---|---|---|
| 截止前可用的 A 股价格 | CNY 82.01/股，未复权，2026-10-27 A 股收盘；`company-valuation-market-002594-2026-10-27@paragraph:1`，Tencent fallback；hash `f77c6e4c32206b95dae058b076c2ec542254f4a30d49395324b3aa0e356f89ba`。Valuation route：EastMoney primary `SOURCE_ERROR/PROXY_ERROR`，Tencent `FALLBACK_1/SUCCESS`。 | CNY 101.09/股，同日未复权 A 股收盘；`company-valuation-market-002384-2026-10-27@paragraph:1`；hash `02343a12044283eb13e414f947d4dc86678d989c62e0504a8c8e2a5f86f25b0c`。同一 Tencent fallback。 | 对这两个 `asOf`，A 股当天收盘可用时点早于 cutoff，支持 A 股观察价。既不等于集团 EV，也不能外推成港股市价。报价未跨源核验。 |
| H 股价格 / FX | A 股有价；既有数据与政策中没有 01211.HK 价格、HKD/CNY FX 或其 source route。 | cutoff 是上海 04:26；H 股尚未挂牌/交易。HKD 86.80 IPO 发行价当时已公告但不是可交易市价；10/28 开盘及收盘均在旧 asOf 之后。无 FX route。 | 两家均不能计算同一截止时点 A/H 总市值。东山尤其不得将发行价乘发行股数伪装成挂牌交易市值。任何 10/28 价格只可能属于获准的新 run。 |
| 已发行及摊薄股数 | H1 `official-c19c34dd239b2e9c` p.57、p.80：A 5,433,797,565、H 3,683,400,000；H 月报 `official-aae298506d8e3fce`（CNINFO 公告 1225595406，段 55–71、99–115、128–130）显示截至 9/30 月内 A/H 结存未变。H1 hash `c521306221e896b4cbfbdf18a84d18fadf409db5bea7a8d3ef70a08c4f366ca6`；月报 hash `ed22804ac7a7d2dff12e4eed39ea6e5004dc06d13c7feb6eb49820c890eb175c`。 | H1 `official-296fff2b2889c26f` p.37：A 股本 1,831,607,532；H1 员工持股 3,048,701 股和基本/稀释 EPS CNY 1.62 在 p.47，EPS 加权分母不等于 cutoff 股数。回购 `official-f5baf98acbff1fd0` / 1225600029，段 7、15：截至 9/30 回购 255,200 股，未证明注销。H 股招股发行条款见下方 IPO 记录。 | BYD 有分类别历史已发行股数但缺 cutoff 完全稀释状态及 H 股同日价/FX。东山缺 H 股最终配发/超额配售实际数量及上市后现金/股数桥。无公司股数 Data route 能自动补齐上述状态。 |
| 资产负债表、现金与债务 | 最近财报为 2026-06-30；H1 p.65 现金 CNY 58.738bn、交易性金融资产 69.940bn、定期存款/CD 19.308bn；受限资金 p.135 为 2.882bn，另有 p.107 外币受限资金 0.335bn，是否重叠未明。短借 37.646bn、长借 61.201bn、债券 14.994bn、租赁 8.610bn、一年内到期项 3.453bn，p.66；永续/其他权益工具 20.847bn，p.66/83。 | 最近财报亦为 2026-06-30；H1 p.41 现金 8.793bn；受限资金 p.23/97 为 1.845bn，现金等价物 p.49 为 6.948bn。短借 9.630bn、长借 9.441bn、租赁 1.917bn、一年内到期项 2.975bn，p.42–43；到期项 p.100 拆为长借 2.697bn、长期应付款 0.028bn、租赁 0.279bn。债券表行未列不等于证明无债券。 | 这些是最近公开的旧期间余额，不是 10/27 cutoff 余额。受限/外币现金、租赁、到期非债务组成、重复计算、永续分类、IPO 资金流及期后事项尚未构成一致 EV 桥。 |
| 历史收入、分部/产品及成本 | 2025 年报 `official-f7c8d23d2829a5e8` p.9/表 locator `paragraph:226–227`：FY2023–25 营业收入分别 602.315bn、777.102bn、803.965bn；归母净利润 30.041bn、40.254bn、32.619bn。H1 `official-c19...` `paragraph:96–97`：2026 H1 revenue 344.815bn、归母净利 12.325bn；分行业/产品表 p.69–72 (`paragraph:691–730`)；两类收入及毛利率分化。 | 2025 年报 `official-39e591fa149e4543` `paragraph:228–229`：FY2023–25 revenue 33.651bn、36.770bn、40.125bn；归母净利 1.965bn、1.086bn、1.386bn。H1 `official-296...` `paragraph:215–216`：2026 H1 revenue 27.798bn、归母净利 2.957bn；产品收入/占比见 p.44–45 (`paragraph:764–775`)，产品成本/毛利见 p.47–49 (`paragraph:784–795`)。 | 可作为带 `FACT` 的历史基线，按同一报表行重算同比为 `DERIVED`。**不能**直接把历史最低/中位/最高增长率解释成未来 Bear/Base/Bull 经济合理性，也不能归因销量、ASP、组合、并购或效率，除非各自有同期间数据。 |
| 财务历史 JSON / 公司 profile | `akshare-financial-002594@paragraph:1`，hash `e53f57b48168e99af65db0583011b230157a4c4c23968671111581f114f3b3d8`；`company_basic_profile` AKShare primary failed proxy. | `akshare-financial-002384@paragraph:1`，hash `5696f40e6295a5e5f9500ac52543562171bc80c90490bb448ede4b8371f5c230`；`company_basic_profile` same proxy failure. | JSON 包含历史收入、利润、margin、EPS、CFO、capex、资产/负债/权益、现金、应收/存货/应付和借款字段。但保留的 `netProfit` 归属可能未注明；本地 field-lineage 审计指出 currency/basis 推断、source conflicts 和历史数值版本缺口。不得把 `AVAILABLE` 等同 PIT qualified。 |
| CFO / capex / 营运资本 | H1 同期 CFO 37.335bn − `CONSTRUCT_LONG_ASSET` 44.703bn = −7.368bn。应收、存货余额可观察，不能由单一期末余额推导平均周转或后续 FCFF。 | H1 CFO 2.384bn − 长期资产现金支出 5.253bn = −2.869bn；应收/存货及资产负债表数据如上。 | 这是明确标名的“同期 CFO 减购建长期资产现金流”算术项，非完整 FCFF；不得半年年化。税、折旧、净投资、ΔNWC 和 minority treatment 未成前瞻现金流桥。 |
| 经营量价/产能/客户 | 年报有 FY2025 产销量及分行业数据；H1 各业务收入/毛利率有报告行。当前保存 pair 未提供同口径 2026 H1 销量、ASP、车型组合/渠道库存及分部经营利润；首页/销售公开网页内容无可靠时点不能替代。 | 年报 `official-39...` `paragraph:933`：2025 精密组件产量 +32.92%，报告说明含法国 GMD 并表及部分基地投产；H1 `official-296...` `paragraph:359–362, 682`：EML 芯片/产品阶段及客户认证、批量交付方向；p.40–50 分类表有收入/成本。未有可比 utilization、客户订单转收入、单位价格/成本。FY2025 客户集中度 `official-39...` `paragraph:965,968–970`，名称匿名且为年度数据。 | 可记录供给/产品/风险事实及监控项；不能生成量价/组合对利润贡献或客户流失损失额。具体单位成本、利用率、订单、认证节奏、生命周期仍 `MISSING`。 |
| 预测及发行事件 | 2026-FY THS EPS/净利和 EastMoney EPS 路由在运行中均 `SUCCESS`，但采集晚于 asOf；历史 value version / basis / corrections 均 `UNVERIFIED`。报告摘要计 BYD 候选来源 42（3 official、1 financial JSON、9 THS、19 EastMoney reports、1 market，其余为 public-web/peer sources）。 | 2026-FY EPS/净利尝试同样成功但晚于 asOf且未核历史版本；摘要 25 个 sources（3 official、1 financial JSON、3 THS、10 EastMoney reports、1 market，其余 public-web/peer）。IPO 发行范围公告 `official-594d5acb2ae76fb0` / 1225611578 `paragraph:31,33,35`；最终价/预计挂牌 `official-c99ce248ea972a56` / 1225621945 `paragraph:13,15–17`。 | 旧预测行不能用作该 cutoff 的共识。机构报告 date/name/row hash 不提供 immutable version、修订关系或 EPS basis。东山 IPO 发行股份数和 HKD 86.80 公告价不构成旧 cutoff 的 traded market value。 |

### 来源权利与证据限制

CNINFO 官方年报/H1/公告在已有报告中的授权记录为 `public`、内部 retention/AI processing allowed、`redistributionAllowed=false`；只保留 locator/hash，不把 PDF/正文放进 Git。AKShare/THS/EastMoney adapter 的 generic rights metadata 允许个人非商业内部处理/保留并禁止再分发，但不是独立的 rights grant。`docs/engineering/reports/2026-10-28-company-research-p0-19-close-002-gate1-audit.md` 记录的上海证券报告页脚限制其客户使用并限制复制/引述；不得以 generic adapter flag 代替该报告的具体许可。因此 S3 不能据当前报告候选 URL 自动授权抓取、AI 处理、归档或引用。

已保存年报/H1来源：

| 公司 | SourceCandidateId | 已保存 URL | 发布时点 | Source hash |
|---|---|---|---|---|
| BYD FY2025 | `official-f7c8d23d2829a5e8` | `https://static.cninfo.com.cn/finalpage/2026-03-28/1225045351.PDF` | `2026-03-27T16:00Z` | `51b0acae9aca05f698070fa41027809b86b425bb93d31a509005b192c78ee5a0` |
| BYD FY2024 | `official-f6274e510499a654` | `https://static.cninfo.com.cn/finalpage/2025-03-25/1222881496.PDF` | `2025-03-24T16:00Z` | `a805c2253568d51c6e10928a596cbc6473521d18c2856909c11c88ffbceb5717` |
| BYD H1 2026 | `official-c19c34dd239b2e9c` | `https://static.cninfo.com.cn/finalpage/2026-08-29/1225531835.PDF` | `2026-08-28T16:00Z` | `c521306221e896b4cbfbdf18a84d18fadf409db5bea7a8d3ef70a08c4f366ca6` |
| 东山 FY2025 | `official-39e591fa149e4543` | `https://static.cninfo.com.cn/finalpage/2026-04-22/1225139318.PDF` | `2026-04-21T16:00Z` | `8009fc94cc5a754b4cf5c18132217ce704c216484c2922d74d92f7f008ba3330` |
| 东山 FY2024 | `official-135019c30466a0c8` | `https://static.cninfo.com.cn/finalpage/2025-04-25/1223271985.PDF` | `2025-04-24T16:00Z` | `a350bd321a13088e5e418cb4d472607c727f1d3a9c396f6e882d002fc452a2b8` |
| 东山 H1 2026 | `official-296fff2b2889c26f` | `https://static.cninfo.com.cn/finalpage/2026-08-22/1225491182.PDF` | `2026-08-21T16:00Z` | `6500c4e7c05ab455ebbbfc5eba1fa7ede7a48d6be171c53c4edc87c4682f707a` |

以上路径/哈希是被保存的 evidence metadata，不是本轮抓取或重新验证。原 pair 的 artifact manifest 与更多来源候选摘要仍留在上述 ignored local path 和 `tests/validation/evidence/company-research-p0-19-close-002-gate0-baseline.json`；不得公开/提交其原文内容。

## 3. Bear/Base/Bull 字段级候选矩阵

以下仅定义未来情景可以审查的字段与方向条件，不给数值、概率、估值或目标价。字段状态是现存证据资格，不代表未来方向；任何未来值必须标记 `RESEARCH_ASSUMPTION`，并写明来源基线、经济机制、校准、反证、失效触发器和独立复核人。单位/期间未获保存证据支持时明确标为缺失，不从相邻字段推断。

| 公司 / 字段候选 | 单位、期间与来源定位 | 当前状态 | Bear / Base / Bull 候选条件（均无数值） | 机制、反证及失效触发器 |
|---|---|---|---|---|
| BYD 合并营业收入、归母净利润 | CNY bn；FY2023–FY2025 `official-f7c8d23d2829a5e8@paragraph:226–227`；H1 YTD CNY bn，2026 H1 vs 2025 H1 `official-c19c34dd239b2e9c@paragraph:96–97`。官方报告哈希见第2节。 | 历史字段 `AVAILABLE_FACT`; 同口径同比 `DERIVABLE`; 后续年度值缺失 | **Bear:** H1 已披露的增长/利润压力延续；**Base:** 后续同范围报表与分部走势相容；**Bull:** 只有同口径增长重新加速且毛利/利润转化支持时才成立。 | 收入与归母利润需分开建桥。利润较收入更弱是反证；若后续报表不延续所假定方向，撤回情景，不以FY历史极值作概率分布。 |
| BYD 分行业/产品收入、成本、毛利率 | CNY bn、%；2026 H1 YTD，`official-c19c34dd239b2e9c@paragraph:691–730`（表/页定位 p.69–72）。 | 披露字段 `AVAILABLE_FACT`; 同行/同期间毛利率由收入成本复算才是 `DERIVABLE`；分部经营利润缺失 | **Bear:** 低毛利分类收入占比上升或毛利率收缩；**Base:** 仅按披露分类逐项形成加总桥；**Bull:** 高毛利分类份额或利润转化改善须由后续同口径表支持。 | 缺产品销量、ASP和分部经营利润；无法区分量、价、组合和成本。后续分类/口径变化或数据不支持归因时保留残差，不报成确定驱动。 |
| BYD 车辆销量、ASP、车型/区域组合、产能利用率 | FY2025 年报有生产/销售披露，但当前已保存摘要没有其逐行 locator；单位应分别为辆、CNY/辆、车型/区域占比、%。2026 H1 同期经营量价未保存。 | FY2025 历史公开方向 `AVAILABLE_FACT`（具体行待回到既有报告定位）；目标期字段 `MISSING` | **Bear:** 只有公司同期间销量/价格/库存披露走弱可支持；**Base:** 无量价拆分时不做组合贡献，保留收入残差；**Bull:** 量增/高端化/出口必须有同期间销量与实现价格证据。 | 竞争降价、渠道库存和地区结构可能反转销量增长对利润的传导；缺同期间行或定位即不准入情景计算，不能用外部网页或模型补齐。 |
| BYD CFO、购建长期资产现金支出、研发、应收/存货/应付 | CNY bn；H1 2026 YTD/期末余额，结构化行 `akshare-financial-002594@paragraph:1`（SHA-256 `e53f57b48168e99af65db0583011b230157a4c4c23968671111581f114f3b3d8`）；官方财报辅助定位 `official-c19c34dd239b2e9c`。 | 仅历史 `AVAILABLE_FACT`（逐指标的单位、累计basis、冲突和归属仍需核）；同期间 CFO−`CONSTRUCT_LONG_ASSET` 可 `DERIVED` 为 −7.368bn；未来再投资/ΔNWC缺失 | **Bear:** 现金转化弱、再投资占用高须由后续现金流/余额支持；**Base:** 按来源行拆分CFO、购建长期资产和营运资本，不把差额称FCFF；**Bull:** 现金转化改善需连续同口径现金流与余额佐证。 | CFO−capex 不是FCFF且不得半年年化；单一期末应收/存货不证明周转改善。冲突、口径不明或受限现金重复即阻断估值桥。 |
| BYD 未来税率、折旧摊销、资本开支、融资、ΔNWC、FCFF | 未来逐年 CNY bn、%、basis 与期限均待定义；当前无逐年来源定位 | `MISSING`; 经审批后未来参数才是 `RESEARCH_ASSUMPTION_REQUIRES_APPROVAL` | **Bear/Base/Bull:** 只有逐项记录经审阅的有界假设和上下行情景；当前不能填任何值或将H1数值平移。 | 需明确税/少数股东/债务/再投资桥、校准来源及反证；缺一项就不可输出估值或隐含增长。 |
| 东山营业收入、归母净利润 | CNY bn；FY2023–FY2025 `official-39e591fa149e4543@paragraph:228–229`；2026 H1 YTD 对比行 `official-296fff2b2889c26f@paragraph:215–216`。 | 历史字段 `AVAILABLE_FACT`; 同口径同比 `DERIVABLE`; 目标年值缺失 | **Bear:** H1 已披露的利润恢复未能在后续同范围期间维持；**Base:** 仅以分产品收入/成本及利润表形成可复核加总；**Bull:** 只有新增产品转成已披露收入/毛利并能穿透归母净利才成立。 | FY2023–25利润下滑后回升不等于稳定趋势；并购与产能投放是反证/范围变化。出现口径或合并范围变更时先重列可比基线。 |
| 东山电子电路/精密组件/显示模组收入、成本、毛利率 | CNY bn、%；2026 H1 YTD，`official-296fff2b2889c26f@paragraph:764–795`（p.44–49）；FY2025 `official-39e591fa149e4543@paragraph:885–899`。 | 报告行 `AVAILABLE_FACT`; 同行收入−成本/毛利率复算 `DERIVABLE`; 未来单位经济缺失 | **Bear:** 显示模组弱势延续或成本快于收入；**Base:** 维持分类桥并对不可解释部分保留残差；**Bull:** 只有产品结构或毛利改善经下一同口径披露验证时考虑。 | 产品收入不等于利润贡献。表头、产品范围或成本口径变更、收入成本反向走势均触发重审/撤回。 |
| 东山产量、并购并表、产能利用率 | FY2025 精密组件产量同比 +32.92%，单位 `% yoy`，`official-39e591fa149e4543@paragraph:933`；报告同时说明 GMD 并表及部分基地投产；H1 扩产/需求描述 `official-296fff2b2889c26f@paragraph:528–530`。利用率无值。 | 报告文字/同比 `AVAILABLE_FACT`; 有机增长和产能贡献拆分 `MISSING` | **Bear:** 新产能利用不及预期，需未来利用率/订单/交付行支持；**Base:** 将并购、投产和有机变化分列，不外推+32.92%；**Bull:** 只有新增产能形成可售产品和实际交付证据后成立。 | 未分解的并购/投产效应是强反证；若公司后续披露无法拆分，维持增长残差并不将扩产等同现金回报。 |
| 东山 EML/光模块认证、交付、良率、产品收入 | H1 披露阶段/认证/批量交付描述 `official-296fff2b2889c26f@paragraph:359–362,611–612,682`；量产收入 CNY、良率 `%`、产能利用率 `%` 均无量值。 | 已披露产品阶段 `AVAILABLE_FACT`; 后续收入率/份额/良率 `MISSING`; Bull uplift 属 `RESEARCH_ASSUMPTION_REQUIRES_APPROVAL` | **Bear:** 认证延后或交付未转收入；**Base:** 未见可量化商业化则不加收入；**Bull:** 必须有量产、客户验收和产品收入/毛利披露，不能用认证进度代替。 | 认证/阶段文字并非订单或收入。若商业化时间表未兑现、良率/交付受限或收入未显现，撤回Bull假设。 |
| 东山客户集中、CFO、资本开支、应收/存货与融资 | FY2025匿名客户集中度 `official-39e591fa149e4543@paragraph:965,968–970`; H1财务 JSON `akshare-financial-002384@paragraph:1` hash `5696f40e6295a5e5f9500ac52543562171bc80c90490bb448ede4b8371f5c230`; H1 YTD CFO−购建长期资产现金支出 = −2.869bn。 | 披露财务行/集中度 `AVAILABLE_FACT`（JSON单位/basis/身份限制）；同期间差额 `DERIVED`; 客户损失/融资成本 `MISSING` | **Bear:** 客户订单、回款或资本占用走弱须有新增同类披露；**Base:** 不把匿名客户占比映射成具体流失或损失；**Bull:** 分散化/现金转化改善须由后续集中度、应收和现金流披露验证。 | 客户匿名且订单/期限/项目回报与利率条件缺失，不能量化收入损失、融资成本或ROIC；缺字段不能以零代替。 |
| 东山及BYD未来税、折旧、融资、ΔNWC、终值参数 | 未来逐年 CNY bn、%、basis/期限尚未定义；无可定位的前瞻桥 | `MISSING`; 获批未来参数须标为 `RESEARCH_ASSUMPTION_REQUIRES_APPROVAL` | **Bear/Base/Bull:** 当前三类均无数值候选，待S4定义的机制、上下行区间及审阅后再审。 | 不得从current ratio、H1 CFO−capex或假定税率推出FCFF/终值；无独立审阅则阻断。 |

### 十个原子 Research Skill 对候选驱动的消费边界

下面只审计与本次经营 driver 输入相关的十个平级原子 Skill。详尽接口/字段 lineage 保留在 [Gate 1 contract/lineage audit](2026-10-27-company-research-gate1-contract-lineage-audit.md) 及其 [field-level appendix](2026-10-27-company-research-gate1-field-lineage-detail.md)。Saved run 的十个 methods 均显示 `complete`，但这不是独立语义复核，也没有令 gap/driver estimates 合格。

| Skill | 负责章节 | 对候选 driver 的合法贡献 | 当前关键边界 |
|---|---|---|---|
| `company_history_strategy` | `company-overview` | 给公司历史、战略、并购/全球化背景 | 不能把战略文字当经营指引或量化增长 |
| `business_model_map` | `business-model`, `business-segments`, `supply-chain` | 确认分部、产品/价值链范围 | 不提供未披露的产品盈利/单位经济 |
| `product_technology_analysis` | `products`, `technologies` | 记录量产阶段、产品路线与认证事实 | 技术里程碑不是订单、产能利用或收入预测 |
| `business_driver_analysis` | `revenue-profit-drivers`, `growth-drivers`, `catalysts` | 对齐历史收入/利润和可量化分部行 | 缺volume/ASP/mix时保留残差，不造因果归因 |
| `financial_quality_analysis` | `financial-quality` | 同期间财报、现金转换、working capital和财务反证 | JSON历史值字段scope/PIT及来源冲突需核；不能直接造未来FCFF |
| `market_structure_analysis` | `industry-exposure` | 可支持行业方向/可观测限制 | 行业总量不能直接换算公司份额或收入 |
| `competitive_market_map` | `competition` | 提示竞品/技术节点用于反证 | 公开比较口径不统一，不代表直接竞标/重叠客户 |
| `management_governance_analysis` | 共同拥有 `management-capital-allocation` | 记录治理、战略/资本事件 | 无可量化成功率/回报时不能支撑Base uplift |
| `capital_allocation_review` | 共同拥有 `management-capital-allocation` | 检查capex、融资、分红及现金使用 | 缺项目回报/资金期限，不推定ROIC或WACC |
| `company_risk_analysis` | `risks` | 形成风险传导、反证及失效信号 | 缺风险敞口/概率/金额时不伪造scenario loss |

## 4. M1/M2与T0/T1路线比较

### 预期面选择

| 路线 | 外部/市场面 | 独立 House 面 | BYD | 东山 | 评估 |
|---|---|---|---|---|---|
| **M1：合格共识（优先审查，不是已通过）** | 需要截止前原始机构文档、数值版本/更正关系、EPS basis、来源权利及去重 | 用经审核的业务驱动形成收入/归母净利或同basis EPS；不能只把历史增长 envelope 改名为 forecast | THS和EastMoney预测采集晚于 20:19:59Z；无行级proof/version/basis。9 THS +19 EastMoney报告摘要不是 28 个历史可用共识点。当前 reports 的页面中位数是事后当前快照，不是旧 asOf 共识。 | 同理晚于 20:26:46Z；3 THS +10 EastMoney report摘要；旧 cutoff 前 IPO/配售进程已影响share count但无最终记录；EPS basis未知 | 当前 `NEEDS_EXPLICIT_SOURCE_OR_RIGHTS_APPROVAL`。两个渠道可能同一机构，不能把两个中位数当独立经济观点。Saved `estimatePointCount` 不等于 qualified count。 |
| **M2：价格隐含（备用，不是 Reverse DCF 唯一方案）** | 同asOf股别价格、FX、稀释股数、净债务/现金/少数权益组成的可复算EV桥 | 与市场价格校准相独立、有驱动证据及审阅人的 House Base | 有A价，H股价及FX route无；A/H股数有历史披露但完全稀释/期后动作不全；H1财务不在报价日 | 旧 cutoff 是挂牌前，不能用当日H上市后价格；IPO发行价非交易价；最终配发及FX/上市后资本/现金未知 | `NEEDS_EXPLICIT_SOURCE_OR_RIGHTS_APPROVAL` + `NEEDS_METHOD_CONTRACT_APPROVAL`; 对T0均不可行。 |

**独立性判定：** THS/EastMoney 都是外部聚合预测的渠道快照；重叠机构与非基本/稀释basis未知，不能当两个独立看法。House Base 需独立于 M2 市价反推，或与 M1 共识相同指标/期间/币种/单位/basis。当前 Scenario Plan 只输出 FY2026 revenue 和归母 net profit，而外部证据面主显示 EPS；若改为比较净利润，仍需逐点合格的THS forecast、对应归属口径和相同FY。不能由Skill的算术差值制造经济分歧。

### 时间策略

| 策略 | BYD | 东山 | 时间与可比风险 |
|---|---|---|---|
| **T0：冻结旧 `asOf`** | 仅可用 `2026-10-27T20:19:59.628Z` 前实际可用的版本。10/27 A收价时点可用，但目前无截止前合格H价/FX；本地THS/EM在cutoff后响应不能回填。 | 仅可用 `2026-10-27T20:26:46.347Z` 前数据。10/27 A收价可用；H尚未挂牌，不存在可用挂牌后交易价。截止前HKD 86.80为发行价事实。 | 历史两报告保持blocked。移 `asOf` 或用10/28行情会改变问题而不是修复旧报告。 |
| **T1：申请新run/new asOf** | 选在经批准的新日，确保A/H适用市场闭市及可用时点；取得BYD H价/FX/股本事件后才有可能评估集团EV。 | 选在东山H股实际交易完成且发行配发/超额配售信息已发布后；再检查A/H收市和上市募资进入balance sheet。 | 新 run/new manifest/new source versions；新截面与T0不是同一比较期，必须单独标示。需S1/S2及正式新`asOf`/预算批准。不得复用后验行情改写旧runs。 |

### Skill/计算接口兼容性（现存实现与待设计）

| 方法 / 静态位置 | 已有可调用实现 | 可验证部分 | 未有的合同/本任务评语 |
|---|---|---|---|
| `reverse_dcf_expectation_decode` [`SKILL.md`](../../../skills/reverse_dcf_expectation_decode/SKILL.md) | 方法说明；数值函数在 `skills/valuation/calculations/dcf.ts::calculateReverseDcf` | 计算PV、所需正terminal value、隐含terminal FCFF及可选收入CAGR；拒绝非有限值、FCFF空、WACC≤g、非正终值或不正margin | 纯算术不验证market asOf、来源、单位、股本/EV bridge和假设资格；Skill句子“Future observations and synthetic assumptions are rejected”未区分无来源造数与已明确登记/可反证的 `RESEARCH_ASSUMPTION`，需单独批准修订 |
| `dcf_valuation` [`SKILL.md`](../../../skills/dcf_valuation/SKILL.md) | 说明 + `calculateForwardDcf`, `calculateFcffForecast`, `calculateWacc`, `calculateEnterpriseToEquity` 等 calculators | calculator拥有FCFF/WACC/EV桥公式与数学QC | 不证明各操作数的来源/期间/EPS basis/责任人；缺source gate 时结果不可解释成已审计DCF |
| `scenario_valuation` [`SKILL.md`](../../../skills/scenario_valuation/SKILL.md) | 说明 + `skills/valuation/financials.ts` `calculateTargetPrice` / `calculateValuation` 和验证器 | 3个ordered情景、9-cell sensitivity、有限值/monotonicity/eligible method | 未提供合理经营分布/权重；不许等权或自动用历史min/mid/max当真实经济现实；不能从输出称目标价 |
| `expectation_gap` [`SKILL.md`](../../../skills/expectation_gap/SKILL.md), [`contracts.ts`](../../../skills/expectation_gap/contracts.ts), [`calculations.ts`](../../../skills/expectation_gap/calculations.ts) | 有六种pair比较、范围/point兼容和DELTA calculator | 只比较相同 metric/period/unit/basis，缺surface则unavailable，异口径不比 | 需要上游Workflow证明每一面来源PIT/版本/独立性；publishedAt门不等于numeric `versionAvailableAt`。Own estimate不能只以narrative作为traceability |

**ScenarioPlan审计。** `workflows/company-deep-research/scenario-assumptions.ts` 当前把 `TARGET_YEAR=2026` 写进类型、解析上限和验证器；`historical-envelope-operating-bridge` 输出FY2026 revenue/归母net profit，按三年历史收入/归母净利增速形成候选Bear/Base/Bull与3×3 sensitivity，H1 FY2026用于cross-check。候选status要求独立语义审核，Plan接口写了 `economicRationaleStatus=REQUIRES_SEMANTIC_REVIEW`，验证器声明自身不能把review设为通过。运行pair在实现前就已结束且报告仍为 17/19 gap；不得把当前代码候选反说成已被两公司真实运行/评审验证。

**建议的最小方法改进（无实现）：** (a) 以目标年度参数化 horizon，并按可用历史FY自动选择但由Workflow显式冻结；(b) 每家先定义适用且来源绑定的经营驱动、数量/收入/价格/成本、归母利润到税/折旧/再投资/ΔNWC/FCFF桥，不把“利润增长率”直接当唯一driver；(c) Bear/Base/Bull 每项标记 `FACT | INFERENCE | RESEARCH_ASSUMPTION | DERIVED`，保存source baseline、机制、校准区间、counterevidence、失效指标和复核人；(d) 没有理由不生成权重/概率；(e) Workflow将有效driver定位分别交给现有 `growth-drivers`, `financial-quality`, `risks`, `catalysts`，并让 `monitoring-checklist` 对每个主要假设指定可观测指标、频率和触发方向。需先有方法合同审批，避免新万能Skill和反向Skill调用。

## 5. S1–S4 / T1 最小审批决策单

下表中的成本是**工程计划量级**，非报价；所有外部API/license/券商/PDF费目前 `UNKNOWN`。本轮相应调用数均为 0。已有两run的实际来源attempt及代理失败已列于第2节。

| 项目 / 建议 | 用途与最小字段 | 准确来源 / PIT | 权利与成本 | 零扩权替代 / 拒绝后影响 |
|---|---|---|---|---|
| **S1 官方H股行情/最终配发端点 — 暂缓，不作泛授权** | BYD: `01211.HK`未复权收盘、close availableAt、HKD、A/H股数与公司行动；东山: H股最终配发/绿鞋、实际交易收盘、上市募资与费用 | 候选来源身份：HKEX官方证券行情（BYD代码01211）及HKEXnews正式配发/上市公告（东山代码02726）。仓库没有已登记HKEX路由或经核验URL/权利条款；审批范围只能是先确定具体端点/文档和许可，不能据此立即请求。BYD T0需旧cutoff前价格；东山T0无H股交易价，只能T1以后 | 逻辑最小数据为BYD一个截止价、东山一个获批新截止价及一份最终配发/绿鞋公告；实际API请求数未知。直接费用/API与批量抓取、留存、AI处理权须逐项核。工程估计3–5人日接入/校验，维护0.5–1人日/月（计划量级） | 零扩权：只保留A股观察价并继续blocked。拒绝则两家集团EV桥均不成立，不能给价格隐含面。 |
| **S2 官方/合规FX — 不批准无来源泛授权** | 仅当S1后跨币种EV桥确有需要时，取HKD/CNY、报价方向、fix/close类型、availableAt与版本 | 当前代码、policy、runs没有注册FX provider/URL。候选来源目前只能定到“用户指定且有授权的官方/合规HKD-CNY feed”；具体provider未定，因此本决策不授权调用或替代源抓取 | 逻辑最小字段为每个选定cutoff的一条HKD/CNY值；最低1条/截面，实际请求数依provider。API/许可费UNKNOWN；指定已有feed后约1–2人日做报价方向、时区、PIT测试，维护约0.25人日/季（计划量级） | 零扩权：保留A/H本币分列，不合并EV。拒绝使BYD A/H及东山潜在H权益桥不完整。 |
| **S3 具名机构原始预测版本 — 仅可对逐份许可作决定** | 每point含issuer/institution/report ID、FY/metric/value/unit/EPS `BASIC|DILUTED|ADJUSTED`、准确页/表/格与hash、截止前可用时点、版本/更正链、机构去重规则 | 现行routes：`akshare-ths-institution-forecast`、`akshare-eastmoney-research-report`、native EastMoney API；pair sidecar只有API/行摘要且采集晚于cutoff。具体原始券商文档URL须逐份提供并核权；上海证券候选PDF页脚限客户使用，generic adapter rights不构成许可。审批前不抓URL/PDF。 | 采集量应等于纳入的合法估计point数N，N由预先批准的最低独立样本门槛决定，当前无法定量；直连API/订阅/逐份PDF费UNKNOWN。单一合规provider接入、解析和proof估计3–5人日，持续revision/right audit约0.5–1人日/批次（均计划量级） | 零扩权：无M1市场共识，`variant-perception`维持blocked；不把两个渠道中位数差冒充两种独立观点。 |
| **S4 研究假设与独立复核方法合同 — 建议仅批准设计阶段** | 定义目标期、经营bridge、假设类别、source owner、校准/反证/触发器、指定审阅人、敏感性和失败状态；不批具体参数、生产实现或run | 只读已有ScenarioPlan及`scenario_valuation`/`dcf_valuation`合同和第2节已存官方locator；无新增来源 | 设计阶段新增数据/模型调用为0；无外部费用，约3–5工程/研究设计人日。两公司实际独立经济复核另估1–2审阅人日/公司，待单独安排 | 拒绝则不形成经授权House Base/Bear/Base/Bull；保留历史事实与RESEARCH_GAP，`bull-base-bear`继续blocked。 |
| **T1 新 `asOf` + 两家公司新run — 暂不批准** | 每家公司新run ID、UTC/本地cutoff、新source/version manifest与close availability、东山实际配发/绿鞋/上市募资入账、19-section审查、KB只读哈希 | 只可在所选交易日A/H适用市场闭市且相关官方配发公告已可用后新建；先需S1/S2及适用S3/S4批准。新日期需用户单独选择，不在本报告代定 | 至少2个company research run；各route请求量取决S1–S3，模型/独立审阅/供应商费用均未知且未授权。准备新manifest约1–2工程人日（计划量级），模型费用需按实际配置另核 | 拒绝则保留T0旧run和17/19状态；不得改写旧`asOf`或导入后验价格。 |

### 推荐顺序与可批准/拒绝项

1. **主路径：先做S4的经营假设/复核合同设计，再有条件采用M1。** 先把字段、经济机制、反证和失效触发器定义清楚；随后只有在S3确认具体来源许可、EPS basis、版本/修订时点与逐点内容后，M1才可作为外部参考面。对现有T0，若无法证出cutoff前的历史版本，M1仍不可用；仅可在另行批准T1后以新版本建立新比较。拒绝S4或S3则不建House Base/不生成M1 gap，维持`blocked`。
2. **备用路径：M2。** 只有S1+S2+S4、完整分股别EV桥、经复核的独立House Base都成立时才评估；东山必须使用另批的T1，不能拿挂牌后行情修补旧run。它比M1多依赖行情、配发、FX、资本结构和现金流假设，拒绝任一项则不计算价格隐含经营要求。
3. **T1延后。** 不先批准模型预算或真实重跑。只有数据来源/许可、时间截面和方法合同均落定后，才单独申请新双公司运行。拒绝T1则保留T0的历史结论和17/19状态。

## 6. 最终分支状态

当前可组合结论为：

- `NEEDS_EXPLICIT_SOURCE_OR_RIGHTS_APPROVAL`：M1逐point预测许可/历史版本；M2所需H股行情/配售与FX来源。
- `NEEDS_METHOD_CONTRACT_APPROVAL`：House Base/operating bridge与`RESEARCH_ASSUMPTION`独立审查规则；Reverse DCF Skill文案尚需边界澄清。
- `NEEDS_NEW_ASOF_APPROVAL`：如决定等待东山挂牌后及BYD H价的新时间截面，必须新建run。
- `BLOCKED_NO_RESPONSIBLE_PATH`：在目前已批准源、旧asOf和17/19真实运行证据下，没有可接受的双公司独立预期面路径；拒绝所有授权时保持blocked。

**P0-19仍 `NOT_ACCEPTED`。** 本决策包没有宣布19/19，没有改变独立语义复核门，也没有批准新源、费用、方法生产实现、模型预算、真实重跑或Knowledge修改。用户可逐项回复S1/S2/S3/S4/T1批准、拒绝或要求补充指定来源；在决策之前工作到此停止。

## 7. 文档级验证和保留

- 报告整理前 HEAD/远端均为 `f13e50d423c7b3a6224fb6cd888666cf5d081e36`；`254a9d9`为祖先，且包含受限起点 `15eebc9` 后的修复。此前已有5个用户修改 evidence JSON 和 ignored runtime artifacts 未改动；本报告提交时仍须单独确认这些文件均未被暂存。
- 代码SHA `15eebc9`最近全量对照结果：Node 3,201/3,222 pass、21 fail；客户端 218/223 pass、5 fail；修复前干净基线 `ea27034f4f949cc7f028f8a80e5a71025a8aa8cb` 分别是 3,200/3,221 与 218/223，归一化 Node 失败集合相同（SHA-256 `ea9456822eb399823da77ebb712d491ab8df59790e154dd1d6e857e3a75e0fa0`），新增失败0；客户端五个身份相同。完整日志在仓库外的已留存 `ResearchHub_worktrees/asof-regression-logs/`。此前接受报告 `tests/validation/evidence/company-research-p0-19-regression-post-f722b74.json` 也记录21/5 inherited baseline，但不是本次代码复测。
- 本报告为本任务唯一新交付，未提交原始CNINFO PDF、EastMoney PDF、公司报告正文、秘密或用户运行资料。本轮不运行代码测试，因为仅增加静态决策文件；本轮提交前执行 `git diff --check`。近期在相同代码基线上已复验15/15定向测试、类型检查、构建及Node/客户端全回归，结果详见已接受的asOf报告；这不代表本决策包运行过模型，也不升级P0状态。
