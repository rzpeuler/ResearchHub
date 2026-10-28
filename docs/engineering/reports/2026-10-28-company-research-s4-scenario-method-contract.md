# RHL-CQR-P0-19-S4-CONTRACT-005 — 经营假设与独立经济复核方法契约设计

**设计状态：** `DESIGN_READY_FOR_ARCHITECTURE_APPROVAL`（待架构批准；不是生产验收）

**产品状态：** P0-19 `NOT_ACCEPTED`；BYD 与东山精密仍为 17/19、`blocked`，独立语义复核 0 次。

**任务边界：** 仅设计 S4 研究假设与独立经济复核方法契约。报告中的接口、状态机、矩阵和测试均为提案；未修改 Skill、Workflow、Data、Plugin、测试、Knowledge 或生产报告。未产生两家公司未来预测数值。

## 0. Gate 0 — 冻结基线与权限

### 0.1 Git 基线、远端和保护状态

| 项目 | 核验结果 |
|---|---|
| 起点分支 / HEAD | `codex/company-research-p0-01-06` / `8af0acfb21aaea22f67e97acc263836179c5d16c` |
| 远端任务分支 | `origin/codex/company-research-p0-01-06` 与远端 `ls-remote` 均为 `8af0acfb21aaea22f67e97acc263836179c5d16c` |
| `origin/main` | `51fd2112c0767a664bba4e887e7debb031fcf66e`；`merge-base(HEAD, origin/main)` 为该 SHA；`origin/main...HEAD` = `0 116`（本分支领先 116 个提交，没有落后提交） |
| 新报告提交父 SHA | 预期为冻结起点 `8af0acfb21aaea22f67e97acc263836179c5d16c`；本报告只应作为一个独立新增文件提交 |
| `254a9d9` | 仍在起点历史中；此任务不重写或回退其后已接受提交 |
| 原任务用户改动 | 保留且不暂存：5 个 `tests/validation/evidence/*.json` 修改，以及忽略的 `plugins/document/parsers/docling/bridge/__pycache__/`、`runtime-launch.stderr.log`、`runtime-launch.stdout.log`、`tmp/` |
| 本轮许可 | 只读审查和新增此设计报告；无 S1/S2/S3、数据源、PDF、公共 Schema、来源政策、预测参数、生产实现、测试门、模型调用、真实 run、扩展预算或 Knowledge 写权限 |

远端起点、分支差异、脏文件状态均在编辑前核对。上述现存改动属于用户工作，本任务不能用 `reset`、清理、覆盖或宽泛暂存去处置。提交前只暂存本报告，并检查 staged path 与 `git diff --check`。

### 0.2 冻结真实双公司运行与缺口

| 公司 | Run / `analysisAsOf`（UTC） | 已保存状态 | 未通过章节及诊断 |
|---|---|---|---|
| BYD `002594` | `82bcc425-d48d-4e55-bc45-111aa8c28ba4` / `2026-10-27T20:19:59.628Z`（上海 10/28 04:19:59） | `blocked`，17/19；运行记录 10/10 atomic methods complete；独立语义复核尝试 0 | `bull-base-bear`: `RESEARCH_GAP`, `NO_ATTRIBUTABLE_EVIDENCE`, `WORKFLOW_SECTION_NO_LOCATED_EVIDENCE`；`variant-perception`: `RESEARCH_GAP`, `VARIANT_EXPECTATION_VALUE_VERSION_UNVERIFIED` |
| 东山精密 `002384` | `860916a8-4958-4d29-8da1-56ad5dd1c2c6` / `2026-10-27T20:26:46.347Z`（上海 10/28 04:26:46） | `blocked`，17/19；运行记录 10/10 atomic methods complete；独立语义复核尝试 0 | 与 BYD 相同 |

运行中的 10/10 是该旧流程记录的 atomic-method attempts，不代表 14 个原子章节、3 个 Workflow 章节及 2 个综合章节全部合格。19/19 全部必需；核心缺失仍是上述两个章节。两家公司可见的关键事实状态只有 `research gap` 与既有真实运行结论。本报告没有将本分支已有 ScenarioPlan 当作两个真实运行的输出：配对运行早于 ScenarioPlan 实现；后续静态候选也没有改变报告状态。

### 0.3 运行和 Knowledge 完整性证据

忽略目录 `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/` 内的 12 个分析、报告、Workflow、Bundle、Markdown 和 Knowledge integrity sidecar 均仍存在。编辑前逐个以 SHA-256 对照 DECISION-004 记录，全部匹配：

| 文件 | SHA-256 |
|---|---|
| `002594-analysis.json` | `60c877932829d114eb02af13304402ec5599b4410df5bc63926f4f646489de35` |
| `002594-report.json` | `2867b270318b21e334c28246935326dab19fa734c094253bb80637b2c32390c1` |
| `002594-workflow.json` | `43316166217675df70473ed86cf646fa988dd3dfc53be6c4e75f7f32bf6ff7f6` |
| `002594-bundle.json` | `1fd11c5f5e7764d23bd4950712faf056efeff09436dd983635b24c156a7a8739` |
| `002594-company-research-002594-82bcc425-d48d-4e55-bc45-111aa8c28ba4.md` | `0f83c1cd96f5962402eae69503e2c53cdf76e16f01a6acf2f0324e986a036604` |
| `002594-kb-integrity.json` | `4322cd0b20c70c400615987b06de5d400e45fecc7676cac11cccfd5678ff1f0a` |
| `002384-analysis.json` | `72588193faff4c2e75fb2e07c0b07197619b8c23b9fa49f843e7f05ae34e98b3` |
| `002384-report.json` | `6fa63686b889150551b42eab66b3ce32f4246871f5a3d4be99117d0e0d8917d4` |
| `002384-workflow.json` | `0cf91dfa99a0ca0b1daff3b8711e5e29ab1f07c1d693cfa7f986999adc718ebd` |
| `002384-bundle.json` | `691f3f561b02523f00865f574f6fd373b202c9dad98502abbd61fa3b5958067f` |
| `002384-company-research-002384-860916a8-4958-4d29-8da1-56ad5dd1c2c6.md` | `3c14d4fbb29aee31bc434b9c99b98de3e79f6897581c4519a46aa87f236eb91f` |
| `002384-kb-integrity.json` | `4322cd0b20c70c400615987b06de5d400e45fecc7676cac11cccfd5678ff1f0a` |

两份 Knowledge sidecar 均为 `mode=readonly`, `unchanged=true`。此前记录的 `manifest.yaml` SHA-256 前后相同，为 `face39bd8ec6d6548d1a998edc2583b6e8d6db7e9a4dbd0cb2f0e6b3f901d0c9`；`registry/assets.yaml` 与 `registry/raw.yaml` 均为 `ca3d163bab055381827226140568f3bef7eaac187cebd76878e0b63e9e442356`。本轮不读取后写入 KB，不把这些运行文件放进 Git。

### 0.4 回归基线与文档验证范围

最近已保存的 CLOSE-002 回归对照证据 `tests/validation/evidence/company-research-p0-19-regression-post-f722b74.json` 指向 tested source SHA `f722b745791873bc45ebb63b973a823836d56fa4`：Node 当前 3,195/3,216、21 项既有失败；客户端 218/223、5 项既有失败；与所记录基线的失败集合相同，新增失败 0。该证据不是在本任务起点 `8af0acf` 上重跑出的结果。本轮为静态文档交付，不运行 Node、客户端、类型检查或模型；报告不宣称当前代码全绿，也不把历史回归结果冒充本轮验证。唯一执行的提交级验证为本报告的 `git diff --check`。

### 0.5 证据边界与权利

DECISION-004 保存的官方来源 ID、页/段定位和正文 hash 作为本设计的既有 lineage；本轮没有重新抓取或处理原始文档。CNINFO 官方披露的既有权利记录允许内部留存/AI 处理但不允许再分发；因此仅在报告写必要的已披露数字、定位和 hash，不复制或提交 PDF/正文。AKShare、THS、EastMoney 的 adapter 通用权利字段不是独立授权。上海证券候选报告页脚有客户使用与复制限制，设计中不得把它列为已授权预测输入。

| 公司 | SourceCandidateId / 定位 | 已记录内容 SHA-256 | 既有来源/时间结论 |
|---|---|---|---|
| BYD | `official-f6274e510499a654` FY2024 | `a805c2253568d51c6e10928a596cbc6473521d18c2856909c11c88ffbceb5717` | CNINFO 官方披露；内部处理许可见上 |
| BYD | `official-f7c8d23d2829a5e8@paragraph:226–227` FY2025 | `51b0acae9aca05f698070fa41027809b86b425bb93d31a509005b192c78ee5a0` | `publishedAt=2026-03-27T16:00Z`; CNINFO-INTERNAL |
| BYD | `official-c19c34dd239b2e9c` H1 2026 | `c521306221e896b4cbfbdf18a84d18fadf409db5bea7a8d3ef70a08c4f366ca6` | `publishedAt=2026-08-28T16:00Z`; CNINFO-INTERNAL |
| BYD | `official-aae298506d8e3fce` CNINFO H share month report | `ed22804ac7a7d2dff12e4eed39ea6e5004dc06d13c7feb6eb49820c890eb175c` | 公告 1225595406, paragraphs 55–71,99–115,128–130；截至 9/30 share movement only |
| BYD | `akshare-financial-002594@paragraph:1` | `e53f57b48168e99af65db0583011b230157a4c4c23968671111581f114f3b3d8` | JSON units/basis/netProfit attribution/version/conflicts not qualified |
| BYD | `company-valuation-market-002594-2026-10-27@paragraph:1` | `f77c6e4c32206b95dae058b076c2ec542254f4a30d49395324b3aa0e356f89ba` | CNY 82.01 unadjusted A close; EastMoney failed, Tencent fallback succeeded |
| 东山 | `official-135019c30466a0c8` FY2024 | `a350bd321a13088e5e418cb4d472607c727f1d3a9c396f6e882d002fc452a2b8` | CNINFO official disclosure; internal processing right only |
| 东山 | `official-39e591fa149e4543@paragraph:228–229` FY2025 | `8009fc94cc5a754b4cf5c18132217ce704c216484c2922d74d92f7f008ba3330` | `publishedAt=2026-04-21T16:00Z`; CNINFO-INTERNAL |
| 东山 | `official-296fff2b2889c26f` H1 2026 | `6500c4e7c05ab455ebbbfc5eba1fa7ede7a48d6be171c53c4edc87c4682f707a` | `publishedAt=2026-08-21T16:00Z`; CNINFO-INTERNAL |
| 东山 | `official-f5baf98acbff1fd0` / announcement 1225600029 | `ca5d9fff6f62a30494d0ae126d079d97ad7c8d17a1a9a16a96eee733f892bae0` | `publishedAt=2026-10-09T16:00Z`; paragraphs 7,15; buyback is not cancellation proof |
| 东山 | `official-594d5acb2ae76fb0` / 1225611578 | `97f2d3452f83b9b8d3660254a12236ef15fd19252d60d951bad17dfc22cf3f43` | `publishedAt=2026-10-19T23:40:10Z`; IPO allotment range, not final allotment |
| 东山 | `official-c99ce248ea972a56` / 1225621945 | `b0d79f92118225acdebad09909a37c3cfe849562f71d67f95a171dc37bd5c9f9` | `publishedAt=2026-10-25T23:46:08Z`; HKD 86.80 is announced offer price, not T0 traded close |
| 东山 | `akshare-financial-002384@paragraph:1` | `5696f40e6295a5e5f9500ac52543562171bc80c90490bb448ede4b8371f5c230` | JSON units/basis/netProfit attribution/version/conflicts not qualified |
| 东山 | `company-valuation-market-002384-2026-10-27@paragraph:1` | `02343a12044283eb13e414f947d4dc86678d989c62e0504a8c8e2a5f86f25b0c` | CNY 101.09 unadjusted A close; EastMoney failed, Tencent fallback succeeded |

THS/EastMoney 的候选记录分别为 BYD 9 / 19、东山 3 / 10 条机构/研究报告摘要；已保存配对运行预测 acquisition finished time 晚于各自 `analysisAsOf`，没有逐 `EstimatePoint` 的 `versionAvailableAt` / immutable document binding / EPS basis proof。单个 report 的日期或 non-empty response hash 不因此变成 eligible PIT expectation。下列来源 inventory 是冻结已有报告所记录的数据，不代表本轮确认访问权或二次下载权。

## 1. Gate 1 — 字段、证据、归属与经济机制

### 1.1 共同字段契约与资格分类

矩阵中的 `analysisAsOf` 固定为对应冻结 run 的 T0；不得改变旧 run 的 `asOf`。`sourcePublishedAt` 仅表示载体发布，不能替代数值版本 `valueVersionStatus` 或 `versionAvailableAt`。`observedAt` 是报告行实际观察/取得时间；对于原报告未留逐行取得时间、单位 token 或内容切片的候选，一律标成 `MISSING`，不能从报告发布时间补推。

本矩阵既有数据统一标为 `asOfMode=FROZEN_T0`。官方报告候选已有整体内容 hash 与精确段/页定位时，可说明文档版本身份；本轮没有重新取回原文或对每条数值重新 seal，因此 matrix 中 `observedAt`/逐 numeric `versionAvailableAt` 未在 sidecar 留存处保持 `MISSING`，不能把 source-level hash 误称每个数字行的独立签名。聚合商 forecast values 则明确为 `valueVersionStatus=UNVERIFIED`，而且 retrieved after T0；不合格旧预测不进入当前输入矩阵。

矩阵所称 H1 FY2026 是 `periodStart=2026-01-01`, `periodEnd=2026-06-30`, `fiscalYear=2026`, `periodBasis=YTD`; H1 FY2025 比较行同为 `2025-01-01` 至 `2025-06-30`, YTD。FY2023/24/25 分别为同年 1 月 1 日至 12 月 31 日、`periodBasis=FY`。存量字段只有 `periodEnd`（例如 2026-06-30），不能伪造 flow period start。官方资料的 `sourcePublishedAt` 以 source inventory 日期为准；逐数值 `observedAt` 不是已知字段则保持 `MISSING`。

每个未来 `EconomicDriverObservation` 至少应有：`companySymbol`, `driverId`, `researchQuestion`, `metricId`, `economicScope`, `atomicSkillOwner`; `periodStart/periodEnd`, `fiscalYear`, `observedAt`, `sourcePublishedAt`, `analysisAsOf`, `asOfMode`, `valueVersionStatus`; `originKind`, `unit`, `currency`, `financialScope`, `flowOrStock`, `periodBasis`, `shareBasis`; `sourceCandidateId`, 精确 `location`, `sourceContentHash`, `sourceRights`, `originalValue`, `normalizedValue`, `conversionFormula`; `sourceConflict`, `missingFields`, `applicability`; 以及 economic mechanism 所需 input refs 与 residual policy。没有证据支持的字段明确置空并列为 missing；`AVAILABLE_FACT` 不自动意味着可预测、PIT 合格或因果关系成立。

分类规则：

- `AVAILABLE_FACT`: 精确来源和期间可定位的已观察披露。对于本任务中只存在页/段和已归档 hash、未重新展示原始行文本的值，status 限定为“DECISION-004 已记录的历史 fact”；不能声称本轮重新验证了 PDF 原文。
- `DERIVABLE`: 可从同口径输入以确定公式唯一复算的算术结果，记录输入值、期间、单位和公式；不包含因果推断。
- `RESEARCH_ASSUMPTION_REQUIRES_APPROVAL`: 将来可由研究者提议、明确标为判断且独立审阅的边界值。本轮没有公司级未来值。
- `MISSING`: 缺定位、数值版本、同期间字段、经济桥、许可，或 scope/basis 不相容。缺失不得转成 0，也不得由相邻字段替代。

金额使用 CNY bn 仅作为报告展示规范。若原披露以 CNY 元列示，规范化公式为 `originalValue / 1_000_000_000`; 若原始表头/数值 token 未保存在已核证 sidecar 中，则原始精确数仍 `MISSING`，不能反向生成更多有效数字。`CFO - 购建长期资产现金流`只能标记为该期间现金流算术差，不是 FCFF。半年流量不自动乘二。

### 1.2 BYD `002594` 矩阵

权利缩写：`CNINFO-INTERNAL` = 既有记录 `public`, 内部留存/AI 处理允许、redistribution 禁止；`AGGREGATOR-UNVERIFIED` = adapter 通用字段不构成独立来源许可。财报行的 scope 除非注明归母均为合并口径；净利润使用“归属于上市公司股东”行时为 parent-attributable。

| 驱动候选 / 身份与研究问题 / 原子 Skill 所有者 | 期间、时间及会计口径 | 现有来源、原值与规范化、权利/版本 | 分类 / 经济机制 / 缺失字段与阻断原因 | 未来假设提案必填字段（本轮不填值） |
|---|---|---|---|---|
| `byd.segment_mix`; 分行业/产品收入与毛利如何解释合并结果？`metricId=financial_segment_revenue_and_gross_margin`; scope=consolidated; owner=`business_driver_analysis` | FY2026 H1 YTD，截至 2026-06-30；source 发布 `2026-08-28T16:00Z`；分析 cutoff `2026-10-27T20:19:59.628Z`; 金额 CNY bn，margin % | `official-c19c34dd239b2e9c@paragraph:691–730`, pp.69–72, SHA `c521306221e896b4cbfbdf18a84d18fadf409db5bea7a8d3ef70a08c4f366ca6`; `CNINFO-INTERNAL`。DECISION-004 记录行级产品/行业收入与毛利率分化；原始 token 未在本地 sidecar 逐字段保留，精确 originalValue `MISSING`；规范化只允许按原表单位换算 | 收入/成本行 `AVAILABLE_FACT`（仅既有定位事实）；同范围毛利可由收入减成本、margin 可由毛利/收入复算 `DERIVABLE`。分部 operating profit、产品销量/ASP、量价 mix 贡献 `MISSING`。不得把收入份额当利润份额 | `assumptionOrigin`, rationale; 按收入→成本/毛利机制拆项；历史校准区间及同口径 period；mix/ASP/成本反证；毛利或份额失效触发；分类重列残差；confidenceLimitations；reviewRequired |
| `byd.consolidated_revenue`; 合并收入变化可由哪些已披露操作驱动解释？`metricId=operating_revenue`; scope=consolidated; owner=`business_driver_analysis` | FY2023–FY2025 + H1 FY2026 / H1 FY2025 对比；FY 和 H1 YTD 分开；FY2025 source published `2026-03-27T16:00Z`，H1 source published `2026-08-28T16:00Z`；cutoff T0 | FY2025 `official-f7c8d23d2829a5e8@paragraph:226–227`, SHA `51b0acae9aca05f698070fa41027809b86b425bb93d31a509005b192c78ee5a0`; H1 `official-c19c34dd239b2e9c@paragraph:96–97`, hash 如上；CNY bn 已记录 FY23–25 `602.315/777.102/803.965`，H1 FY26 `344.815`。`CNINFO-INTERNAL`; 精确披露 token 缺失时禁止提高精度 | 报表历史 `AVAILABLE_FACT`; 相同报告行同比可 `DERIVABLE`。收入合计不能区分车辆量、ASP、出口/区域、产品 mix；销量/价格没有配对 H1 行时分解为 `MISSING`。总收入增长并非量价因果 | 假设须逐业务列收入公式、量价/组合覆盖情况、无法解释的 residual、历史口径与基线期、价格/销量/库存反证、收入变更触发器；若量价证据不足，保持 aggregate residual 而不命名驱动 |
| `byd.parent_profit`; 归母利润如何从业务毛利、费用、税/融资到权益归属？`metricId=parent_attributable_net_profit`; scope=parent-attributable | FY2023–FY2025；H1 FY2026/H1 FY2025 YTD 比较，不能与 FY 混算 | 同一 FY 来源 `official-f7c8d23d2829a5e8@paragraph:226–227`, hash 如上：归母净利 CNY bn `30.041/40.254/32.619`; H1 来源 `official-c19c34dd239b2e9c@paragraph:96–97`: CNY bn `12.325`。`CNINFO-INTERNAL` | 历史报表行 `AVAILABLE_FACT`; 同口径同比 `DERIVABLE`。合并净利润 vs 归母净利、EPS 加权分母不能互换。未来费用、税、少数权益、非经常项与融资桥 `MISSING`；利润增速不可替代各项操作驱动 | 单列收入、毛利、经营费用、减值/非经常、税、少数权益至归母公式；记录 each scope/basis；标注残差；假设校准/反证/失效条件；必须由独立审阅校验净利归属与 EPS basis |
| `byd.vehicle_volume_price_mix`; 销量、ASP、车型/地区组合分别如何进入收入？`metricId=vehicle_volume_asp_mix`; owner=`business_driver_analysis`（产品范围由 `business_model_map` 提供） | 候选需 FY/H1 同期销量 units、CNY/unit、region/product share；当前保存 pair 无可比 2026 H1 volume + realized ASP 配对数据 | 既有 report 有 FY2025 产销量披露方向，但 DECISION-004 未保存精确行 locator；禁止仅从年报概述恢复行。现有总收入 locator `official-c19...@paragraph:96–97` hash `c521...`; 不能作为 volume/ASP 证据。对应实际可用 point 和 rights 均 `MISSING` | 目标期 driver `MISSING`；收入观察不能拆成数量与价格。车辆销量增长、价格下降、区域/车型组合和库存之间的关系未有足够同期间可归因数据 | 若未来获批提案，需 precise report row/units、销量与ASP身份匹配、地区/车型定义、volume×ASP→revenue reconciliation、库存/折扣/出口反证、基线校准、范围变化和 residual；否则拒绝 volume narrative |
| `byd.capacity_utilization`; 已建产能是否转成可销售产出？`metricId=capacity_and_utilization`; owner=`business_driver_analysis` | FY/H1 同期设计；当前无利用率/产能开工数值 row | DECISION-004 现存字段无可定位利用率；新闻/网页未作为本矩阵证据；value version、rights、原值、单位均 `MISSING` | `MISSING`。产量/扩产若没有产能分母和销量/交付，不能推出利用率、收入或单位成本 | 需披露的设计产能、实际产量、期间长度、停产/投产时间、分部范围与 reconciliation；利用率不可跨新旧基地/并购实体机械对比；failure trigger 为开工低于批准边界或订单/交付不匹配 |
| `byd.cash_conversion`; CFO 与资本支出是否支持持续现金流？`metricId=cfo_and_construct_long_asset`; scope=consolidated; owner=`financial_quality_analysis` / capex owner=`capital_allocation_review` | H1 2026 YTD 流量与 2026-06-30 存量；不是 FY | financial JSON `akshare-financial-002594@paragraph:1`, SHA `e53f57b48168e99af65db0583011b230157a4c4c23968671111581f114f3b3d8`, generic `AGGREGATOR-UNVERIFIED`; official H1 `official-c19...` hash `c521...`。DECISION-004 记录 CFO 37.335bn、购建长期资产现金流 44.703bn，CFO减该支出为 −7.368bn | CFO/长期资产支出历史行 `AVAILABLE_FACT`（JSON 单位、累积 basis、conflicts 仍未核）；两数同期间相减 `DERIVABLE`。值不是 FCFF；不能半年年化；税、D&A、净 capex、ΔNWC、租赁/少数股东处理 `MISSING` | 先从已审期间行提出分项 cash bridge；同时期流量与期初/期末/平均营运资本；税/D&A/maintenance vs growth capex区分；反证包括回款、应收/存货占用、项目延期；不完整桥禁止 FCFF/估值资格 |
| `byd.working_capital`; 应收/存货/应付是否导致现金吸收？`metricId=receivables_inventory_payables`; owner=`financial_quality_analysis` | 存量观察截至 2026-06-30；期间周转需平均存量与 FY/H1 flow 配套 | JSON 同上；H1 report official hash 同上。存在若干期末余额，但 source conflicts、原始币种/期间basis、平均余额以及字段逐行 locator 未保全 | 可见字段限 `AVAILABLE_FACT`（仅历史观察且仍待逐字段 qualification）；单期末余额不能推出周转变化。DSO/DIO/DPO/现金转换周期和未来ΔNWC `MISSING`；更不能由余额断言回款效率 | 需同口径期初/期末、营业成本/赊销或可替代分母、分类范围；公式和方向；将平均余额与期间定义锁定；逾期、减值、库存跌价、供应链融资作为 counterevidence |
| `byd.tax_d&a_financing_fcff`; 税率、D&A、融资与投资需求如何传入 FCFF？`metricId=fcff_bridge_inputs`; owner=`financial_quality_analysis` | FY/H1 历史口径对齐；未来期限由 ScenarioHorizon 决定；当前无完整可归因的未来输入 | H1 same source/hash supports only reported history; JSON hash `e53f...` unverified unit/basis/row identity. Exact tax paid/expense reconciliation, D&A, future debt/cash and fully defined capex/NWC path absent from qualified set | 现有前瞻税、D&A、净投资、融资、ΔNWC、minority treatment `MISSING`；any future value becomes `RESEARCH_ASSUMPTION_REQUIRES_APPROVAL`, not FACT. CFO−capex cannot stand in FCFF | 每个 bridge row needs source or explicit assumption, scope, formula, tax convention, debt/cash definition, cash restrictions, lease and minority handling, sensitivity and exact failure mode; no bridge output if any required field absent |
| `byd.shares_ev`; A/H equity and EV can be combined at T0? `metricId=class_specific_shares_and_market_value`; owner=`financial_quality_analysis` | Shares at FY/H1 disclosed dates; prices must be class-specific and available by T0; last financial balances 2026-06-30 | H1 official `official-c19...` pp.57,80 hash `c521...`: A `5,433,797,565`, H `3,683,400,000`; H monthly source `official-aae298506d8e3fce@paragraph:55–71,99–115,128–130`, SHA `ed22804ac7a7d2dff12e4eed39ea6e5004dc06d13c7feb6eb49820c890eb175c`. Price route only A close CNY 82.01, source `company-valuation-market-002594-2026-10-27@paragraph:1`, hash `f77c6e4c32206b95dae058b076c2ec542254f4a30d49395324b3aa0e356f89ba`; no H price/FX route | Historical class shares/ A quote `AVAILABLE_FACT` in saved metadata; consolidated diluted class count, T0 A/H market-cap, current debt/cash bridge `MISSING`. Cash 58.738bn, trading assets 69.940bn, deposits/CD 19.308bn; restricted cash/foreign restricted overlap unclear; debt, bonds, lease, maturity and perpetual classifications need reconciliation. No EV or per-share reverse valuation eligible | Future bridge needs each class close, currency/FX/time, diluted shares and events, published balance-sheet snapshot, unrestricted cash, debt/lease/bonds/perpetual/minority treatment, and formula; missing any gate blocks EV/per-share output |

BYD 九个候选驱动族中有 **6 组可定位的历史事实候选**（分部行、FY/H1合并收入、FY/H1归母净利、同期CFO/长期资产支出、期末营运资本 JSON 行、股份/价格事实；其中 JSON/期末时点字段仍需逐字段 qualification）；有 **3 种可派生关系**（同口径同比、分部毛利率、同期间CFO减长期资产支出）；有 **7 个预测必需变量仍 `MISSING`**（同期间销量、ASP/车型/地区mix、利用率、未来单位成本/毛利、ΔNWC、完整税/折旧/再投资/融资/FCFF桥、完整A/H股数/市值/EV桥）。未来假设字段按四个 proposal slots 计（量价/组合、分部成本率、营运资本/现金转换、税/投资/融资桥），均是 `RESEARCH_ASSUMPTION_REQUIRES_APPROVAL`，当前 proposal/value 数为 0。类别重叠但计数口径各自明确；历史事实/派生值不是预测合格字段。**Qualified future causal drivers now: 0.**

### 1.3 东山精密 `002384` 矩阵

采用同一 `CNINFO-INTERNAL` / `AGGREGATOR-UNVERIFIED` 权利定义、CNY bn 展示和 T0 截点规则。合并范围发生变化时须保留并购/organic/residual 三路，不得直接对历史总量外推。

| 驱动候选 / 身份与研究问题 / 原子 Skill 所有者 | 期间、时间及会计口径 | 现有来源、原值与规范化、权利/版本 | 分类 / 经济机制 / 缺失字段与阻断原因 | 未来假设提案必填字段（本轮不填值） |
|---|---|---|---|---|
| `dsj.segment_economics`; 电子电路、精密组件、显示模组收入与成本怎样形成毛利？`metricId=product_revenue_cost_margin`; consolidated; owner=`business_driver_analysis` | H1 FY2026 YTD，截至 2026-06-30；official 发布 `2026-08-21T16:00Z`; analysisAsOf `2026-10-27T20:26:46.347Z`; CNY bn/% | `official-296fff2b2889c26f@paragraph:764–795`, pp.44–49, SHA `6500c4e7c05ab455ebbbfc5eba1fa7ede7a48d6be171c53c4edc87c4682f707a`; `CNINFO-INTERNAL`; normalized products include table values in DECISION-004, original token retained only in source document locator not local sidecar | 产品收入/成本/毛利历史 `AVAILABLE_FACT`; 同一行 gross margin `DERIVABLE`; 分产品 operating profit/单位经济/未来利润率 `MISSING`。分类变化不能跨表直接连成增长因果 | 按每个产品固定定义/期间/含税与否；revenue-cost→gross profit; reconcile to consolidated accounts and residual; product mix and cost/scrap/utilization counterevidence; calibration range and falsification trigger; reviewRequired |
| `dsj.consolidated_revenue`; 并表范围内总收入变化有哪些可复核操作路径？`metricId=operating_revenue`; owner=`business_driver_analysis` | FY2023–FY2025; H1 FY2026 与 H1 FY2025 同期 YTD；不得拼 FY 和 YTD。FY2025 report published `2026-04-21T16:00Z`, H1 source `2026-08-21T16:00Z` | FY report `official-39e591fa149e4543@paragraph:228–229`, SHA `8009fc94cc5a754b4cf5c18132217ce704c216484c2922d74d92f7f008ba3330`: CNY bn revenue `33.651/36.770/40.125`; H1 `official-296fff2b2889c26f@paragraph:215–216`, hash `6500...`: `27.798`; CNINFO rights as above | 历史总收入 `AVAILABLE_FACT`,同口径同比 `DERIVABLE`; total revenue cannot assign product-level quantity, price or acquisition uplift. History includes GMD consolidation/production ramp effects | 需要 organic vs acquired revenue bridge、产品分类同口径、订单/交付/收入确认映射、残差、客户/price反证；无披露时保持 unallocated growth residual |
| `dsj.parent_profit`; 归母利润回升由哪些产品毛利/成本与费用因素传导？`metricId=parent_attributable_net_profit`; owner=`business_driver_analysis` + financial bridge=`financial_quality_analysis` | FY2023–FY2025 and same-period H1; parent-attributable distinct from consolidated NP/EPS | FY same source/hash, CNY bn parent NP `1.965/1.086/1.386`; H1 `official-296...@paragraph:215–216` CNY bn `2.957`, H1 FY25 comparator present in source row; `CNINFO-INTERNAL` | 历史 row `AVAILABLE_FACT`; same-row arithmetic `DERIVABLE`. FY profit decline then recovery does not prove sustained margin. Tax, one-off, minority, interest, EPS denominator and forward normalized earnings remain `MISSING` | Separate product gross margin→operating expenses→tax/nonrecurring/minority bridge, reconcile reported parent NP; expose residual; proposal range/counterevidence/falsification; no revenue-only multiplier to profit |
| `dsj.capacity_utilization_and_GMD`; capacity, utilization and acquired scope explain growth? `metricId=capacity_actual_output_scope`; owner=`business_driver_analysis`, acquisition event context=`company_history_strategy` | FY2025 production yoy statement; H1 2026 expansion narrative; no matched capacity denominator or site-level utilization | FY `official-39e591fa149e4543@paragraph:933`, hash `8009...`: precision-component production +32.92%; report says includes French GMD consolidation and some site commissioning; H1 `official-296...@paragraph:528–530`, hash `6500...`: expansion/demand narrative. `CNINFO-INTERNAL` | Production growth/consolidation and expansion description `AVAILABLE_FACT` as narrative; organic production, utilization, installed capacity, yield and acquired contribution `MISSING`. Do not annualize +32.92% or double count GMD scope | Require acquired vs organic period bridge, production scope, effective consolidation date, capacity denominator/site ramp and eliminations, shipment and recognized revenue links, utilization/yield counterevidence; keep unallocated acquisition residual |
| `dsj.eml_certification_to_revenue`; certification/delivery stage becomes recognized economics when? `metricId=eml_stage_order_revenue`; stage owner=`product_technology_analysis`, consolidated driver owner=`business_driver_analysis` | H1 FY2026 statements/status text; only period/status not forward revenue measure | `official-296fff2b2889c26f@paragraph:359–362,611–612,682`, SHA `6500...`; `CNINFO-INTERNAL`. Reports describe EML chip/product stage, customer certification and batch delivery direction; no quantified unit/revenue/yield table in saved lineage | Stage/certification narrative `AVAILABLE_FACT`; realized volume, order balance, recognized revenue, gross margin, yield, repeat order `MISSING`. Certification/expansion cannot become sales or net profit | Require stage evidence → customer acceptance/production lot → recognized revenue and margin chain with period cutoffs; no probability conversion; failure/cancellation/delivery delay/quality yield trigger; if only stage narrative, no incremental forecast |
| `dsj.customer_delivery_concentration`; customer concentration, orders and delivery risks affect what metric? `metricId=customer_concentration_delivery`; owner=`company_risk_analysis`, outcome owner=`business_driver_analysis` | FY2025 annual anonymous customer concentration; no customer-level H1 order/revenue/update | `official-39e591fa149e4543@paragraph:965,968–970`, SHA `8009...`; customer names anonymous, period annual, `CNINFO-INTERNAL`. No current order backlog or customer-specific delivery dollar series retained | Annual anonymous concentration `AVAILABLE_FACT`; customer-specific revenue, renewal, backlog, delay, customer loss impact `MISSING`; anonymous ratios cannot be mapped to one named buyer or forecast loss | Need concentration ratio definition and scope, period, delivery/acceptance, backlog conversion, anonymization-safe bridge and top-customer churn counterevidence; no customer-specific numeric sensitivity without attributable customer exposure |
| `dsj.cash_conversion`; CFO/capex and working capital support what level of reinvestment? `metricId=cfo_construct_long_asset_wc`; owners=`financial_quality_analysis` / `capital_allocation_review` | H1 FY2026 YTD flows and 2026-06-30 balance sheet stocks; never annualize as FY | `akshare-financial-002384@paragraph:1`, SHA `5696f40e6295a5e5f9500ac52543562171bc80c90490bb448ede4b8371f5c230`, `AGGREGATOR-UNVERIFIED`; official H1 `official-296...` hash `6500...`; CFO `2.384bn` minus long-asset construction cash `5.253bn` = `−2.869bn` | Rows are historical facts only with JSON scope/unit/YTD and source conflict caveats; same-period difference `DERIVABLE` and not FCFF. H1 receivable/inventory/cash balances do not prove annual cash conversion; ΔNWC and maintenance capex `MISSING` | Require official/qualified row-by-row current and comparator period, flow-stock pairing, capex class, changes in operating assets/liabilities, cash restrictions, debt/lease and taxes; no FCFF before complete bridge |
| `dsj.tax_debt_cash_fcff`; tax/financing/net investment from earnings to FCFF? `metricId=fcff_bridge_inputs`; owner=`financial_quality_analysis` / `capital_allocation_review` | latest balance snapshot 2026-06-30, not T0 balance; future horizon unpopulated | Official H1 `official-296...` pp.41–43, p.100, SHA `6500...`; cash `8.793bn`, restricted `1.845bn`, cash equivalents `6.948bn`; short borrowing `9.630bn`, long `9.441bn`, lease `1.917bn`, current maturities `2.975bn` including long debt `2.697bn`, long payable `0.028bn`, lease `0.279bn`. `CNINFO-INTERNAL` | Historical fact subsets only; bond table omission does not prove no bonds; cash equivalence and restriction reconciliation incomplete. Future D&A/tax/debt/refinancing/FCFF `MISSING`; no price/share bridge | Separate unrestricted cash, debt, lease, other debt/maturity, minority and IPO cash only after source evidence; FCFF formula must include D&A, tax, investment and ΔNWC; otherwise no EV/per-share result |
| `dsj.shares_market_ev`; A/H share value and EV available at T0? `metricId=shares_price_fx_ev`; owner=`financial_quality_analysis` | T0 is 2026-10-27T20:26:46Z, before Dongshan H share commenced trading; H1 shares dated 2026-06-30 | H1 `official-296...` p.37, SHA `6500...`: A share capital `1,831,607,532`; H1 p.47 basic/diluted EPS CNY 1.62 is weighted denominator, not T0 shares. Repurchase `official-f5baf98acbff1fd0` / notice 1225600029, paragraphs 7,15: 255,200 shares bought by 9/30, cancellation not proven. IPO source `official-594d5acb2ae76fb0` / 1225611578 paragraphs 31,33,35; pricing/listing `official-c99ce248ea972a56` / 1225621945 paragraphs 13,15–17; issue price HKD 86.80 not traded price at T0 | Historical A shares / issue terms are `AVAILABLE_FACT`; H final allotment/greenshoe, listing cash net of fees, post-listing shares, HK close, FX all `MISSING` at T0. A quote CNY 101.09 does not represent H or total EV. No EV/per-share result | Requires a distinct T1, actual trading close available before its asOf, final allotment and cash bridge, share events and FX; IPO offer price cannot backfill T0 market value; no old asOf edit |

东山九个候选驱动族中有 **8 组带历史披露/阶段事实的字段候选**（产品收入/成本、FY/H1合并收入、归母净利、产量与 GMD 范围说明、EML阶段文字、客户集中度、CFO/长期资产支出、资产负债及股本/IPO条款；JSON及旧 balance-sheet字段仍需逐字段 qualification）；有 **3 种可派生关系**（同口径同比、产品毛利率、同期间CFO减长期资产支出）；有 **8 个预测/估值必需变量仍 `MISSING`**（有机与GMD并表拆分、利用率、EML订单至收入确认、主要客户交付、未来产品毛利/费用、ΔNWC和完整FCFF、T0 H股交易价/FX、最终摊薄股数/IPO净资金桥）。未来 proposal slots（有机增长/产品单位经济、利用率 ramp、EML monetization、现金/资本开支）均为 `RESEARCH_ASSUMPTION_REQUIRES_APPROVAL`，当前 proposal/value 数为 0。计数口径是历史候选组/可复算关系/必要前瞻字段，分类会交叉但不会把历史数计为 forecast。**Qualified future causal drivers now: 0.**

### 1.4 明确拒绝的替代输入

| 候选替代 | 两家公司结论 | 拒绝原因 |
|---|---|---|
| AKShare financial JSON `netProfit` | `MISSING`，除非 exact row再证明归属/单位/period | `netProfit` 归母范围未确认；CNY/报表单位、FY/YTD、version/status、conflict 未完成；Hash 绑定内容不等于 numerical-value-version proof |
| EPS 与净利润互换 | `MISSING` | EPS basic/diluted/adjusted basis、加权股数与 share classes 均不同；归母 NP、合并 NP、EPS 分母不等价 |
| H1 flow 年化 | 拒绝 | YTD 不等于全年；第二半年季节性/一次性因素未知 |
| `CFO−capex` 命名 FCFF | 拒绝 | 不含完整税、D&A、net investment、ΔNWC、租赁/少数权益口径；只能原样称同期间算术差 |
| 单期末 AR/inventory -> 周转或现金转换 | 拒绝 | 缺平均存量、同期分母、信用/库存质量和分类口径 |
| 东山 EML 认证/扩产文字 -> 未来营收 | 拒绝 | 缺订单、验收、交付、收入确认、良率和毛利数值链 |
| 东山产量 +32.92% -> 有机增长 | 拒绝 | 披露明确包含 GMD 并表及新投产基地，范围/有机部分未拆解 |
| A 股 quote -> A/H total cap，或 IPO offer price -> traded H cap | 拒绝 | 缺同一时间截面 H 价格/FX/完全稀释 shares；东山 T0 在上市交易前 |

## 2. Gate 2 — Scenario Assumption Contract（设计，不改接口）

### 2.1 责任边界

```text
14 个平级 Skill 的自身输出契约
  ├─ business_driver_analysis：已定位的经营驱动事实/同口径关系/未分解残差
  ├─ financial_quality_analysis：期间、质量、现金流/营运资本反证
  ├─ company_risk_analysis、catalysts：风险传导、可观察反证/触发器
  └─ product_technology_analysis / business_model_map / capital_allocation_review：各自范围内的产品阶段、业务分类、资本配置证据
          ↓ Workflow 冻结来源、数据/假设版本、period 与 hash；决定是否具备输入并组织独立复核
  ├─ scenario_valuation Skill：解释 Bear/Base/Bull 经济差别的方法合同 + 有资格输入上的确定性估值/敏感性
  ├─ Workflow 私有 Scenario Assumption Contract：经营假设建议、桥接、review ledger、状态/报告资格门
  ├─ valuation Workflow：只消费已 qualified 且 basis 对齐的结果
  ├─ expectation_gap Workflow：只消费独立并合格的外部/市场预期面；本任务不生成该面
  └─ Knowledge：继续只读；本合同没有 Knowledge 写入职责
```

Skill 架构规定 Skill 拥有专业语义方法，Workflow 拥有编排、路由、输入 readiness、重试、资格门、报告/Knowledge 流程；Data 为唯一数据入口，Plugin 才接外部来源。故“研究假设怎么构成经济上可辩护的 Bear/Base/Bull”应由**现有平级 `scenario_valuation` 方法文案**定义；来源冻结、私有对象、独立 review 状态和跨章节交接属于 **Company Research Workflow 私有契约**。Data schema、`EstimatePoint`、SourcePolicy 和公共 report/KB contract 本任务均不扩展。各上游 Skill 只提供自身已有格式、来源定位和限制，不被调用为子 Skill。

### 2.2 两套方法方案与推荐

| 方案 | 设计 | 优点 | 风险/迁移影响 | 决定 |
|---|---|---|---|---|
| A. 复用现有 `scenario_valuation` + Workflow 私有输入/资格契约 | Skill 方法负责情景的经济差别、假设披露要求和情景一致性；Workflow 将各平级 Skill 的已定位观察映射成私有 `EconomicDriverObservation`、收集 `ResearchAssumptionProposal`、freeze hash、调用审阅、满足资格后才把标准 valuation inputs 交给 scenario_valuation/financials | 对应现有“明确假设如何改变确定性价值”的单一问题；复用现有三情景、3×3、monotonicity、recompute calculators；保持 flat Skill catalog 和公共 Data 无变化 | 需要未来单独审批 Skill 方法文字调整和 Workflow 私有模型/consumer mapping；ScenarioPlan 的 historical-envelope 算法不得再冒充经济 calibration；现有合约依赖增长率/倍数的情况须兼容/显式 unavailable | **推荐**。先设计/评审合同；实现拆为不同审批。原子方法仍属于 scenario valuation；Workflow 不推断 Skill 数值。
| B. 新增 `operating_scenario_method` 原子 Skill | 单独提出唯一问题“哪些公司经营机制可支撑指定期间的Bear/Base/Bull数值桥”，输入事实与假设，输出情景桥；scenario_valuation 再计算值 | 可将经营量价/成本/范围语义从价格/倍数计算中抽离 | 现有 `business_driver_analysis` 已解释收入/利润驱动；`financial_quality_analysis` 已审现金/财务桥；会引入第三个可能重叠的研究所有者及 schema/catalog/registry/Skill 文案/权限/调用映射/质量维护面。若它同时获取数据、调用其他 Skill 或排版报告即违反 flat Skill 边界；现有证据不足以证明唯一研究问题不被现有 Skill 覆盖 | 不推荐，暂不提 ADR。只有未来经现有 Skill 单独审计仍无法回答同一个明确问题，且给出唯一输入/输出/模型确定性边界后，才单独立 ADR 征询批准。 |

方案 A 的最小迁移影响：`scenario-assumptions.ts`/Company Research Workflow 私有 handoff、`scenario_valuation/SKILL.md` 方法文字（如批准）、Company Research `bull-base-bear` assembler/report eligibility 和 `valuation` consumer adapter；若上游输出字段没有精准 lineage，维持 gap，不要求上游 Skills 互相调用。`variant-perception` 不由该契约生成/合格化市场面，只消费 M1/M2 独立来源证明。本设计建议不调整公开 `CompanyResearchReport` / `DataRequirement` / `EstimatePoint` 接口。

**既有实现审查（静态）**：`workflows/company-deep-research/scenario-assumptions.ts` 将 `CompanyScenarioDriver.targetFiscalYear`, plan 和内部 `TARGET_YEAR` 锁在 `2026`; 它会拒绝目标年不为 2026，并要求 `analysisAsOf` UTC年份也等于 2026。`historical-envelope-operating-bridge` 从 FY2023–FY2025 两个字段的历史同比 envelope 生成 FY2026 revenue / parent-attributable net profit proposal 与 3×3 sensitivity，并用 H1 FY2026 做交叉检查。Validator 的 `valid` 当前固定返回 `false`, `reportEligible` 固定为 `false`, 且总会带 `ECONOMIC_RATIONALE_REQUIRES_INDEPENDENT_SEMANTIC_REVIEW`；这正确地没有让确定性检查冒充经济复核，但历史 envelope 不能作为情景校准方法。

`skills/valuation/financials.ts` 的 `calculateTargetPrice` 对给定 basis、target year、growth rate 和 target multiple 做确定性外推；`validateScenarioAssumptions` 要求三情景、顺序和增长/倍数单调，`calculateValuation` 重算敏感性并做输出顺序检查。它验证算术/形状，不解释经济因果、来源资格或残差。`scenario_valuation/SKILL.md` 也将计算归给 TS，把模型输入限为 bounded rationale，并禁止概率加权默认值。`expectation_gap/SKILL.md` 要求相同 metric/period/unit/basis 的 point-in-time surfaces；Narrative 不产生 own value。`dcf_valuation/SKILL.md` 需要显式 FCFF、WACC、终值、债务/现金/股数桥；`reverse_dcf_expectation_decode/SKILL.md` 是另一个独立问题，所有输入同样需 PIT attribution，其“future observations and synthetic assumptions are rejected”边界如需解释，必须另行申请 Skill 方法修订。本任务不调用或改写两个 DCF 方法。

失败传播固定为 fail closed：来源/时点/权利/字段缺失或冲突 → Observation `UNAVAILABLE`/`CONFLICTED` → Proposal 不得转资格 → `ScenarioMethodResult=UNAVAILABLE` 或 `REVIEW_REQUIRED` → Workflow 留 `RESEARCH_GAP` → 不向正式 Valuation/Variant/Investment Thesis 提供 qualified result → 19/19 gate 保持失败。不得用可读叙述替代缺失计算输入。

### 2.3 拟议类型草案（仅供设计）

下面接口只用于展示字段和责任边界；不等同当前 TS contract，也不应在 S4 Design Accepted 后被默认为实施授权。公司实际未来数值留空，本报告不提供。

```ts
type ScenarioName = 'BEAR' | 'BASE' | 'BULL'
type OriginKind = 'FACT' | 'INFERENCE' | 'RESEARCH_ASSUMPTION' | 'DERIVED'
type EvidenceStatus = 'QUALIFIED' | 'UNVERIFIED' | 'CONFLICTED' | 'UNAVAILABLE'
type ReviewDecision = 'QUALIFIED' | 'REJECTED' | 'REVISION_REQUIRED'

interface ScenarioHorizon {
  readonly analysisAsOf: string               // UTC instant; never inferred from target year
  readonly asOfMode: 'FROZEN_T0' | 'NEW_T1'
  readonly targetFiscalYear: number            // explicit, validated against published base
  readonly targetPeriodStart: string
  readonly targetPeriodEnd: string
  readonly historyBaseStart: string
  readonly historyBaseEnd: string
  readonly historyPeriodBasis: 'FY' | 'H1_YTD' | 'QUARTER' | 'OTHER'
  readonly targetPeriodBasis: 'FY' | 'H1_YTD' | 'QUARTER' | 'OTHER'
  readonly forecastYears: readonly number[]
  readonly financialScope: 'CONSOLIDATED' | 'PARENT_ATTRIBUTABLE' | 'CLASS_SPECIFIC'
  readonly currency: string
  readonly comparableScopeId: string             // versioned consolidation/segment definition
  readonly latestFinancialAvailableAt: string
  readonly latestMarketAvailableAt?: string
  readonly cutoffManifestHash: string
}

interface EconomicDriverObservation {
  readonly companySymbol: string
  readonly driverId: string
  readonly researchQuestion: string
  readonly metricId: string                      // existing metric only; no catalog expansion here
  readonly economicScope: string
  readonly atomicSkillOwner: string               // reference to existing peer Skill output
  readonly periodStart: string
  readonly periodEnd: string
  readonly fiscalYear: number
  readonly observedAt: string
  readonly sourcePublishedAt: string
  readonly analysisAsOf: string
  readonly asOfMode: 'FROZEN_T0' | 'NEW_T1'
  readonly valueVersionStatus: EvidenceStatus
  readonly originKind: 'FACT' | 'DERIVED' | 'INFERENCE'
  readonly unit: string
  readonly currency?: string
  readonly financialScope: string                 // consolidated / parent / product / class
  readonly flowOrStock: 'FLOW' | 'STOCK' | 'RATE' | 'COUNT' | 'TEXT'
  readonly periodBasis: string                    // FY / YTD / point-in-time / weighted-average
  readonly shareBasis?: 'BASIC' | 'DILUTED' | 'ADJUSTED' | 'NOT_APPLICABLE' | 'UNSPECIFIED'
  readonly sourceCandidateId: string
  readonly sourceLocation: string                 // page/table/paragraph/cell/line
  readonly sourceContentHash: string
  readonly sourceRights: string                   // existing rights record id, not a free-text grant
  readonly originalValue?: string                 // literal only when retained and locatable
  readonly normalizedValue?: number | string
  readonly conversionFormula?: string
  readonly sourceConflictIds: readonly string[]
  readonly missingFields: readonly string[]
  readonly applicability: 'APPLICABLE' | 'LIMITED' | 'NOT_APPLICABLE'
  readonly residualNote?: string
}

interface ResearchAssumptionProposal {
  readonly proposalId: string
  readonly companySymbol: string
  readonly driverId: string
  readonly scenario: ScenarioName
  readonly originKind: 'RESEARCH_ASSUMPTION' // immutable; never promote to FACT
  readonly targetFiscalYear: number
  readonly targetPeriodStart: string
  readonly targetPeriodEnd: string
  readonly proposedValue?: number                // may be populated only in later authorized work
  readonly unit: string
  readonly currency?: string
  readonly financialScope: string
  readonly assumptionOrigin: string              // researcher + method/source of proposal
  readonly observationRefs: readonly string[]
  readonly rationale: string
  readonly economicMechanism: string
  readonly calibrationBasis: string
  readonly calibrationRange?: { readonly low: number; readonly high: number; readonly method: string }
  readonly counterEvidence: readonly string[]
  readonly falsificationTrigger: string
  readonly failureMode: string
  readonly residualPolicy: string
  readonly confidenceLimitations: readonly string[]
  readonly authorId: string
  readonly proposalVersion: number
}

interface ScenarioBridgeLine {
  readonly metricId: string
  readonly formula: string                       // explicit inputs, no opaque CAGR shortcut
  readonly inputRefs: readonly string[]
  readonly outputUnit: string
  readonly outputScope: string
  readonly residualValueRef?: string
  readonly consolidationAdjustmentRefs: readonly string[]
  readonly nonRecurringAdjustmentRefs: readonly string[]
}

interface ScenarioForecastBridge {
  readonly scenario: ScenarioName
  readonly horizonRef: string
  readonly proposalRefs: readonly string[]
  readonly lines: readonly ScenarioBridgeLine[]
  readonly revenueLines: readonly string[]
  readonly costLines: readonly string[]
  readonly operatingProfitLine?: string
  readonly parentNetProfitBridge?: readonly string[]
  readonly fcffBridge?: readonly string[]
  readonly shareAndEvBridgeRefs?: readonly string[]
  readonly reconciliationTolerance: number
  readonly inputSnapshotHash: string
  readonly formulaVersion: string
}

interface ScenarioCase {
  readonly name: ScenarioName
  readonly proposals: readonly ResearchAssumptionProposal[]
  readonly bridge: ScenarioForecastBridge
  readonly deviationsFromBase: readonly string[]
  readonly counterEvidenceRefs: readonly string[]
  readonly observableTransitionVariables: readonly string[]
}

interface BearBaseBullSet {
  readonly horizon: ScenarioHorizon
  readonly currency: string
  readonly financialScope: string
  readonly methodId: string
  readonly cases: readonly [ScenarioCase, ScenarioCase, ScenarioCase] // exact BEAR, BASE, BULL order
  readonly probabilities?: never                  // no default weights
  readonly inputSnapshotHash: string
}

interface AssumptionReviewRecord {
  readonly reviewId: string
  readonly reviewerId: string
  readonly reviewerRole: 'INDEPENDENT_ECONOMIC_REVIEWER'
  readonly authorId: string
  readonly independentOfAuthor: boolean
  readonly proposalSetHash: string
  readonly bridgeHash: string
  readonly evidenceManifestHash: string
  readonly reviewContractVersion: string
  readonly decision: ReviewDecision
  readonly fieldFindings: readonly { readonly proposalId: string; readonly finding: ReviewDecision; readonly reason: string }[]
  readonly crossCaseFindings: readonly string[]
  readonly reviewedAt: string
  readonly supersedesReviewId?: string
}

interface ScenarioMethodResult {
  readonly status: 'QUALIFIED' | 'REJECTED' | 'UNAVAILABLE' | 'REVIEW_REQUIRED'
  readonly resultRefs: readonly string[]             // deterministic values only
  readonly gapReasons: readonly string[]
  readonly bridgeHash?: string
  readonly reviewRecordId?: string
  readonly reportEligible: boolean                   // true only after every gate below
  readonly allowedConsumers: readonly ('VALUATION' | 'BULL_BASE_BEAR')[]
}
```

`EconomicDriverObservation` 不从文本中的一个名称推断 metric 语义；`sourceCandidateId` 必须同时和精确定位、内容 hash、原值、时间窗及 rights 记录配对。Review record 锁定 proposal、bridge 与证据清单三个独立 hash；任何编辑生成新版本并使旧 review 失效。

### 2.4 Scenario 方法不变量

1. `targetFiscalYear` 显式设置，必须晚于可信的已报告 base period；不得固定为 2026，也不得让 `analysisAsOf` 的年份自动等于目标年。多个预测年份需逐年输入/桥接，或显式只给单年度，不外推隐式年份。
2. 历史事实、推论、研究假设、可复算数值严格分 `FACT / INFERENCE / RESEARCH_ASSUMPTION / DERIVED`; input status 不是 forecast qualification。
3. 只允许 exactly Bear/Base/Bull；三者共享 fiscal horizon、币种、财务 scope、方法、base definition 和 required driver set。情景名称不规定等距、概率或具体排序量级。
4. 每个 scenario 相对 Base 的经营偏离须指向具体 driver、可证伪机制、至少一条相关 counter-evidence 以及一个可观测转换变量。缺假设可停在 unavailable，不用空情景填三格。
5. 多业务收入、成本与合并值需可复算并解释 residual；GMD/并购范围、分部重分类、处置/一次性项目单独列桥。利润到归母利润及 EPS、FCFF、EV/equity/share 的桥不能隐式混用。
6. Sensitivity 是条件计算，不说明不同格现实概率。除非另获批准并有独立校准，`probability`/weighted value 禁止生成。业务变量本身不必各维度单调（例如售价与销量可能反向）；Bear/Base/Bull 名称也不得按计算值自动重排。现有 scenario_valuation API 对增长率/倍数及 target price 有单调要求；若真实、已审查的 driver economics 不能满足，不可为通过旧 shape gate 而扭曲假设。应将其留作 `REVIEW_REQUIRED/UNAVAILABLE`，并把对 validator/order rule 的任何修改作为独立代码/测试审批点。
7. 若只完成假设语义和没有可算估值输入，结果不能把 `bull-base-bear` 标成 qualified。只输出 blocked research gap 和精确缺项。

确定性 bridge 至少应能表达如下量纲一致等式，实际实现按公司披露范围选用，不填本轮公司未来值：

```text
segmentRevenue_s = volume_s × realizedASP_s        # 只有同范围数量和售价可定位时才可使用
consolidatedRevenue_s = Σ segmentRevenue_s + unexplainedResidual_s
grossProfit_s = consolidatedRevenue_s - costOfRevenue_s
operatingProfit_s = grossProfit_s - operatingExpenses_s
consolidatedNetIncome_s = operatingProfit_s + financeAndNonOperatingItems_s - taxExpense_s ± separatelyLocatedAdjustments_s
parentNetIncome_s = consolidatedNetIncome_s - nonControllingInterest_s ± parentAttributableAdjustments_s
FCFF_s = EBIT_s × (1 - cashTaxRate_s) + D&A_s - netCapex_s - ΔOperatingNWC_s
EV = classSpecificEquityValue_s + grossDebt_s + leaseClaims_s + otherSeniorClaims_s - eligibleUnrestrictedCash_s
equityValue = EV - debtAndSeniorClaims + eligibleCashAdjustments - nonControllingClaims
perShareValue = classSpecificEquityValue / matchingDilutedClassShares
```

每个等式须写明 units（例如 CNY bn、units、CNY/unit、%）、scope、期间、正负号、消除/少数股东/租赁定义和 `formulaVersion`。EV桥要求同一资本结构口径；上面简式不可把同一笔 debt/cash 调整两次。没有完整输入的 line 就是 `UNAVAILABLE`，不得自动补 0。当前 ScenarioPlan 的 revenue 与 parent-net-profit 两个独立 rate 形成 3×3 cross product；其中每格可能隐含不同归母净利率，这只是条件算术，不自动代表经济上协调的情景。新合同应从业务驱动桥复算一致性，并只在可解释时把敏感格描述为 coherent economic scenario。

## 3. Gate 3 — 独立经济审阅与资格状态机

### 3.1 Reviewer I/O 合同

**Reviewer 输入**：冻结版 horizon；Observation 快照及来源/权利/版本证据；三个 scenario 的 proposal 和 bridge；source conflicts/missing list；上游 Skill 的原始输出引用；确定性公式结果与敏感性（若全部输入合格）；review contract 版本。输入按 `proposalSetHash + bridgeHash + evidenceManifestHash` 锁定。

**Reviewer 输出**：逐字段 finding (`QUALIFIED`, `REVISION_REQUIRED`, `REJECTED`)，因果路径说明，相关/不相关证据判断，期间与scope不匹配，反证检查，范围/残差处理，计算假设的敏感性和可证伪条件，跨情景一致性，明确决断、理由与 hash。Reviewer 不修改原 proposal；修订由 author 产生新 version，再进入新审阅。

**独立性**：作者不得审自己的 proposal；提出者与 reviewer 必须有不同身份和职责记录，reviewer 在独立 task/session 接收冻结 packet，并不得以模型输出、系统自评、自动格式检查或另一段由同一执行者生成的文字代替独立经济复核。模型辅助 review 只有在未来被批准为独立 reviewer execution identity、不可复用 proposal-generation context 且按 rubric 返回结构化 decision 时才可计一次语义审阅；否则必须由独立合格的人类 reviewer 复核，未满足其一则保持 `REVIEW_REQUIRED`。确定性算术只由 TS calculator / validator 验证，model/reviewer 不覆盖数值。

### 3.2 审阅 Rubric

| 维度 | 通过标准 | 拒绝 / 返回条件 |
|---|---|---|
| 证据到字段 | 引用含精确字段、source ID、段/表/页/单元、内容 hash、period、来源 rights 与 version status；证据相关于所支持 driver/value | 只有来源 ID 白名单、同公司不相关段落、report date 或非空 hash；未证明 hash 绑定到原始数值行 |
| 经济机制 | 逐级说明 volume/price/mix/cost/capacity/acquired scope/working capital 等输入如何影响收入、毛利、费用、税、归母利润/现金流；保留 residual | 仅给高/低增长数；把历史同比、战略语句、认证、扩产或集中度文字直接变成未来值 |
| 会计与时间 | FY/YTD/quarter、flow/stock、币种、单位、合并/归母、产品/分部定义、EPS basic/diluted、shares/equity scope一致；版本的 availableAt≤analysisAsOf | H1 YTD 当 FY、合并 NP 当归母、当前页面覆盖旧版本、CFO-capex 冒充 FCFF、用未上市 H 价回填 T0 |
| 校准与反证 | Calibration basis有匹配期间和范围；解释它为何适用；counter-evidence 与假设同一机制；观测触发条件可检验 | FY23–25最小/中间/最大同比直接映射 Bear/Base/Bull；反证仅堆 source ID 或空泛“市场风险” |
| 范围/残差 | GMD/并购、投产、重分类、一次性项目、未分解 segment total有明确 bridge/residual policy | acquisition 有机增长重复计算；分部加总与合并数有差异但无 residual；无法解释的值硬分配到 driver |
| 独立性 | M1/M2 输入与 House assumptions 有清晰边界；市场价未用于校准 House Base 的核心经营假设；reviewer 独立 | 两 aggregator 的同机构中位数当两份观点；由价反推 Base 后又宣称价/House 有gap；自我审批 |
| 计算与敏感性 | 纯函数复算、单位/公式可复现、hash不变；各情景的单调性来自经济约束而非标签；九格与输入复算一致 | 任意 target multiple/WACC/terminal growth/权重；输入 hash stale；无法复算/不满足排序但被隐藏 |
| 发布资格 | 输入和复核齐备，风险/转移条件可监控；下游明确使用该 result ref 和 basis | 未审/拒绝/字段缺失/`RESEARCH_GAP` 被“有引用的段落”清除；出现目标价/Variant结论但面资格缺失 |

### 3.3 状态机与责任

```text
PROPOSED
  -> DETERMINISTICALLY_VALIDATED     Workflow invokes pure validators; formulas, units, evidence IDs, hashes, period/scope checked
  -> ECONOMIC_REVIEW_PENDING          Workflow freezes exact snapshot and dispatches independent review within existing attempt budget
  -> QUALIFIED                        reviewer decision + all required data/consumer gates are satisfied

DETERMINISTICALLY_VALIDATED -> REJECTED / UNAVAILABLE
ECONOMIC_REVIEW_PENDING -> REVISION_REQUIRED -> PROPOSED (new version, bounded by existing retry budget)
ECONOMIC_REVIEW_PENDING -> REJECTED
any edit to proposal / bridge / source-version / rights / asOf -> STALE_REVIEW -> PROPOSED (new hash, fresh review)
missing/conflicted/unlicensed/post-cutoff required field -> UNAVAILABLE -> Workflow reports RESEARCH_GAP
```

| 转移 | 输入与锁定 | 负责者 | 重试/失败 |
|---|---|---|---|
| `PROPOSED → DETERMINISTICALLY_VALIDATED` | schema, exact three case identities, horizon, data lineage, formula/unit/reconciliation results；freeze proposal/data/bridge hashes | Workflow deterministic validator | Schema/math failure rejects immediately; no model retry for arithmetic |
| `… → ECONOMIC_REVIEW_PENDING` | validated snapshot hashes + rubric version + reviewer identity distinct from author | Workflow schedules independent reviewer | Use existing P0-19 operation/repair budget exactly as configured; no budget increase or loop to force pass |
| `… → QUALIFIED` | one decision per required field/case, reviewer hash match, no required unknowns, cross-case coherence, publication gate satisfied | Independent reviewer decides semantics; Workflow validates record/signature and consumer gate | Any missing/failed field prevents qualification |
| `… → REVISION_REQUIRED → PROPOSED` | finding list, same lineage manifest; author creates new proposal version | Author revises; Workflow invalidates old review | Existing retry budget only. Exhaustion -> `REJECTED` or `REVIEW_REQUIRED` + `RESEARCH_GAP` |
| any changed input → `STALE_REVIEW` | hash mismatch for source/proposal/bridge/asOf/rights/method | Workflow | Prior PASS cannot be copied/retained; new review only if budget/authorization permits |
| required input absent/conflicted/unauthorized → `UNAVAILABLE` | exact field reason and affected dependent outputs | Data result + Workflow gate | fail closed; no zero-fill; continue other independent chapters only if existing rules allow |

`QUALIFIED` never itself marks 19/19. Product completion remains the existing 19/19 core-section gate **and** required independent semantic reviews for both companies plus downstream cross-chapter and publication checks.

## 4. Gate 4 — 确定性测试设计与下游交接

### 4.1 Fixture matrix（设计清单，不创建/不运行）

所有计算 fixture 用 `FIXTURE_ONLY` 标记的虚构、单位量纲明确的输入或纯符号条件；不装入 BYD/东山未来 forecast value，不触发 model。每项既定失败层级可在未来 implementation approval 后分层放入相应 tests；本轮不产测试代码。

| ID | Fixture | 预期结果 / 最小验证层 |
|---|---|---|
| F01 positive | 定位到准确历史 FACT，独立 proposal 明确 `RESEARCH_ASSUMPTION`、机制/校准区间/counterevidence/失效条件齐；作者与 reviewer 不同；三情景同horizon/scope；公式行与 hash 一致 | Skills deterministic contract/calculation + Workflow lineage/review gate 均可资格；只有 FIXTURE_ONLY 算术结果，不引用真实公司未来值 |
| F02 | 某 sourceCandidateId 在允许白名单，但段落讲的是现金余额，却被引用支撑销量增长 | 验证定位和字段 relevance，而非只查 source ID；拒绝 proposal |
| F03 | 将 FY2023–25 历史 yoy 最低/中间/最高直接赋给 Bear/Base/Bull | 经济审核 `REJECTED`；纯算数结构通过也不能进入 publication |
| F04 | 混用 basic EPS、diluted EPS、adjusted EPS，或把合并 NP 当 parent NP；跨 CNY/HKD、元/bn、FY/YTD | 类型/identity/currency/period gate 拒绝比较和桥接；不转换为 Gap |
| F05 | 把 H1 YTD 乘二；或把 CFO−购建长期资产现金支出写为 FCFF | deterministic basis/formula validator 拒绝；列为 `RESEARCH_GAP` |
| F06 | segment 总和与合并收入/成本冲突且没有 acquisition/elimination/reclassification/residual | reconciliation gate `UNAVAILABLE`；不把差额偷偷塞给某 segment |
| F07 | GMD acquired production 被列入总量增长，再作为独立 organic uplift 加一次 | scope/consolidation lineage test and reviewer reject double count |
| F08 | 仅凭 EML certification、扩产、匿名客户集中度文本推增收/净利 | relevance/causal review rejects；缺 exact recognized orders/revenue remains `MISSING` |
| F09 | proposal author 与 reviewer ID 相同，或系统把 `REQUIRES_SEMANTIC_REVIEW` 当 PASS | reviewer independence gate fails; no report eligibility |
| F10 | 审阅 PASS 后改 assumption/source hash/valueVersion/asOf/rights/method version | old review becomes `STALE_REVIEW`; fresh review required |
| F11 | Bear/Base/Bull horizon/currency/scope/method不一致，或 Base 缺 required driver | exact set and compatibility gate rejects; cannot calculate 3x3 on mixed bases |
| F12 | THS 与 EastMoney 的同一家机构估值被当成两家独立共识，然后计算 Variant | institution dedup + independent market surface gate rejects; do not create external surface |
| F13 | 无依据设置等概率、目标倍数、WACC或terminal growth | missing-required-input returns `UNAVAILABLE`; no defaults, no price |
| F14 | 只生成一段有引用的“研究缺口”文字，并尝试让章节/19-section gate通过 | Workflow publication gate rejects; text is not qualified case/bridge |
| F15 | `publishedAt`早于cutoff，但 estimate value row/valueVersion `availableAt`晚于cutoff或没有不可变版本绑定 | point-in-time/value-version validator rejects for that asOf; publication timestamp cannot substitute numeric availability |
| F16 | sensitivity formula正确，但 Bear/Base/Bull target values非有限或计算重复不相等 | pure calculator/recompute/monotonicity result rejected; reviewer cannot override deterministic failure |
| F17 | counterEvidence引用真实且 hash 正确但与核心驱动无关；falsificationTrigger无法观测 | semantic relevance and trigger rubric fails; hash alone is not economic evidence |
| F18 | scenario economics有条件敏感性但被表述为前瞻目标价/概率加权期望价值 | Skill output semantic rule and publication editor gate reject wording; conditions/limitations must remain explicit |

### 4.2 纯确定性复算与测试分层

- **`tests/skills/`**（如获实现授权）：`ScenarioHorizon`历年/有效期逻辑、strict units and scope identity、proposal field/immutability rules、确定性 bridge公式、重算完全一致、有限数/单调性、hash canonicalization。Skill test验证独立方法边界；不访问 Data、provider、Workflow 或模型。
- **`tests/workflows/`**：上游已完成 Skills 自身 output contract 的 lineage handoff、asOf/version/right manifest 冻结、三种状态传播、author/reviewer职责隔离、retry budget不增加、stale hash invalidation、各 section consumer允许/拒绝映射。
- **独立语义复核验收**：用 review packet + rubric 做盲审；单独记录 reviewer ID、decision、proposal/bridge/evidence hash。不得把 skill unit test、模型自评或 formatter 作为经济复核证据。
- **Publication Quality Gate**：需要完整 driver set、精确 source lineages、适用的验证状态、可复算桥、hash一致的独立 `QUALIFIED` review、无阻断 diagnostic、允许的 downstream consumer；即便通过 S4 gate，也只代表一个章节/方法可用，不等于 19/19。

复算协议需固定小数精度/舍入位置、期间/单位转换、aggregation 和 residual tolerance。每个输入输出保留原 value、归一化值、转换公式和 formula version。hash 用规范化的固定字段集计算；字符串、时间格式或字段排序规范要在实现方案审批时定版。Monotonicity only for variables where method proves sign (e.g. positive unchanged basis); if taxes/debt/price cross effects break ordering, expose finding and do not force an order. Falsification checks must recompute affected lines from the changed observation and invalidate stale outcomes.

### 4.3 跨章节消费合同

| 章节 / consumer | 合法上游输入 | 允许交接 | 禁止交接 / 缺失时行为 |
|---|---|---|---|
| `growth-drivers` | `business_driver_analysis` 自己带 source location/hash/period/unit/scope 的驱动、`business_model_map` 定义边界、历史趋势和 residual | Workflow 冻结其自身输出 hash 到 Scenario Observation 并保留原 owner/ref | 不从公司战略、行业总量或公司总收入自动制造 ASP、份额、销量、单位经济；缺字段依旧 missing |
| `financial-quality` | `financial_quality_analysis` 同期报表行、现金转化/营运资本/杠杆质量判断及 conflicting facts | 标识对假设现金/利润桥的 support/counterevidence；同 scope、期间匹配 | CFO−capex 不是 FCFF；中期余额不外推；财务质量未核验时估值桥 unavailable |
| `risks` / `catalysts` | `company_risk_analysis` 或 `catalysts` 自己定义风险/事件、传导路径、证据refs、可观察信号 | 仅转作某个明确 proposal 的 counterevidence/falsification trigger 或 monitor field | catalyst 不是 base-growth、风险描述不是可量化 loss；没有金额/概率证据不生成数值损失 |
| `bull-base-bear` | 合格 horizon + EXACT Bear/Base/Bull proposal/bridge + matched review + deterministic results | 输出经资格化的 driver、bridge、敏感性、限制和失效条件；如果只作经营假设，明确非估值 | 历史Envelope或条件 PE 不得冒称未来价值/目标价；任何 mandatory input/review missing → `RESEARCH_GAP` |
| `valuation` | Qualified `ScenarioMethodResult` + 同一 `analysisAsOf`、share/EV/financial basis 的已合格 inputs | 现有 `scenario_valuation` 计算方法允许的价值与敏感性；历史参考 PE 另标 `REFERENCE_MULTIPLE` | FY actual PE 或条件敏感性不能叫前瞻目标倍数；无 cap table/net debt/unrestricted cash 时不算 EV/share |
| `variant-perception` | 独立的 M1 合格 PIT 共识或 M2 合格 price-implied surface；另有经审阅 House Base | `expectation_gap`仅比较同metric/period/unit/basis且来源/版本独立的 surface | 本契约不产生 M1/M2，不从 House Base 与自身假设比差造 Variant；surface unavailable → gap remains |
| `investment-thesis` | 完成可定位的 thesis props、qualified driver & valuation refs、反证/风险状态 | 必须压缩为“首要判断 → 关键驱动 → 估值含义 → 最强反证 → 失效条件”；每项引用既有上游结果 | 不复述19个章节摘要，不把假设写成事实或未资格化结果 |
| `monitoring-checklist` | `falsificationTrigger`/transition variable、metric/source/owner/periodicity metadata | 对每个关键 scenario transition 记录观测指标、来源类别、监控频率、阈值类型和 action owner | 本轮不填真实阈值；如果没有可观测来源或频率，不能声称可验证/可证伪 |

## 5. Gate 5 — 设计批准清单与实施拆分

### 5.1 需明确签批的对象

成本是工程/审阅工作量级估算，不是外部供应商报价或花费授权。所有模型/数据/API费用均为 `UNKNOWN / NOT AUTHORIZED`。回退应恢复旧输出形状或将新模式设为 unavailable，且不得改变既有19/19门或旧报告。

| 决策点 | 最小范围 / 影响 | 估计成本（规划） | 回退方式 | 是否必须 |
|---|---|---|---|---|
| S4 方法文字：`scenario_valuation/SKILL.md` | 仅补充假设分类、经济机制/反证/失效、情景同口径、概率与历史Envelope边界；不创建 Skill、不改 calculator | 约 0.5–1 工程人日；外部数据/模型成本 0 | revert Skill diff；Workflow 默认 `REVIEW_REQUIRED`/gap | 必须在任何正式 House scenario 生成前批准 |
| Workflow 私有模型与 gate | 私有 horizon/observation/proposal/bridge/review/result；只接收 Data/现有 Skill outputs；`bull-base-bear`资格映射 | 约 3–5 工程人日，未含验证；无公共 schema迁移 | 删除/停用新 handoff，返回当前 RESEARCH_GAP；不改公共报告/Data接口 | 必须在实现方法前批准 |
| 公共 Data/EstimatePoint/SourcePolicy | 本设计明确不需要且不提请批准 | 本轮 0；若未来另提需单独估算 | 不适用 | **不批准，也非 S4 前置** |
| 新原子 Skill | 当前无必要；不提 ADR | 本轮 0 | 不适用 | 否；仅在方案 B 经独立方法缺口审查再提 ADR |
| reviewer 安排与预算 | 每公司至少 1 位非 author 的独立 reviewer；两公司初次语义复核约 1–2 reviewer-days/公司；若未来采用模型辅助审阅，估计每个冻结 proposal set 至多 1 次有界 reviewer request，修订只能沿用现有已批准 retry budget | 2–4 reviewer-days 初次双公司审阅估计。模型/供应商单次费用未知；本轮 reviewer request = 0 | 缺 reviewer/预算则 result 留 `REVIEW_REQUIRED`，不进入报告qualified结论 | 必须在申请实际独立复核前批准资源与身份边界 |
| deterministic contract/tests | 合同批准后实现 hash/period/formula/status fixtures，不拉取来源 | 约 2–4 工程人日估算；无需模型 | revert tests/code and keep unavailable; report-only design remains | 必须在方法进入真实 run 前通过 |
| 方法实现+独立语义验证 | 按获批方案分开交付；Skill、Workflow、validator职责不混 | 约 4–7 工程人日估算，验证与 review另计；不代表授权 | 回滚新路径并 fail closed，保留 T0既有runs | 单独批准，非本轮 |
| 后续双公司真实运行与 T1/M1/M2 | 必须先获具体 source/right/cutoff/run/model批准；S4不能授权 S1–S3/T1 | 新 run 至少双公司；调用/模型/订阅费用未知 | 不改旧run；撤回新 run 仅按既有不可变审计留存规则处理 | **本轮禁止，之后逐项另批** |

### 5.2 推荐实施顺序（各步单独授权）

1. **审批 S4 设计与方法边界**：定稿 ScenarioHorizon、Observation/proposal/bridge/reviewer I/O、状态机及 Publication Gate。此批准只允许下一步计划，不能改代码。
2. **另行批准私有 contract + deterministic tests**：先交付 Workflow 私有数据结构、纯 validator 与 F01–F18 中适用 fixture；维持既有 retry budget 和所有公共 schemas。独立审阅仍不通过 deterministic test 替代。
3. **另行批准 Skill 方法文案和实现**：优先扩展现有 `scenario_valuation` 单一问题方法；实现分业务 bridge、qualification gate、审计记录与 downsteam consumer阻断。新增 atomic Skill 不在建议路径。
4. **方法实现接受后，另行安排独立 review**：由非 author reviewer 对冻结 hash进行双公司 review；如果所需输入仍缺失，明确返回 unavailable/gap，而非用 narrative补足。
5. **取得合格的市场预期面之后，才单独申请真实双公司运行**：M1需已授权版本/许可和可用时点；M2需匹配时间截面市场价/FX/股数/净债务等完整桥。若需新 T1，独立新run、新manifest，决不修改旧 `asOf`。最后还须通过双公司 19/19 和独立语义复核门，P0-19 才可重新评估接受状态。

## 6. 结论与停机状态

**S4 设计结论：** 采用方案 A：现有 `scenario_valuation` 保持单一情景方法身份；Workflow 私有契约承担来源/时点/假设版本冻结、bridge orchestration、review state 和报告资格门。上游平级 Skills 通过自身输出提供证据，不互相调用。ScenarioPlan 当前 FY2026 历史 Envelope 只有数学可重复性，不构成经济校准；其输出必须继续受阻，直到方法规则、字段 lineage 和独立 review 真实通过。预计实现前需批准 Skill 方法文字和 Workflow 私有对象两个独立点。

**允许的 S4 交付验收状态：** `DESIGN_READY_FOR_ARCHITECTURE_APPROVAL`。本状态只表示设计报告足以送架构审批，不表示生产代码已满足新契约，不表示两公司经营预测可行、不表示任何预期面已可用，也不表示章节/Publication Quality Gate 通过。

**保持不变：** BYD/东山冻结 T0、各 17/19、`blocked`；核心缺口 `bull-base-bear` 和 `variant-perception`；独立语义复核 0；P0-19 `NOT_ACCEPTED`。本任务不批准新源、费率、受限文档、预测值、Skill/Workflow/Data/Plugin 生产变更、测试门修改、模型/reviewer调用、运行、预算扩大或 Knowledge 写入。

## 7. 设计报告文档验证与交付边界

- 新增文件仅为 `docs/engineering/reports/2026-10-28-company-research-s4-scenario-method-contract.md`；父 commit 是冻结起点 `8af0acfb21aaea22f67e97acc263836179c5d16c`。
- `git diff --check` 对本报告通过；本轮未运行测试、类型检查、构建、数据源调用、模型或公司研究 Workflow。
- 提交只包含此报告。Gate 0 列出的五个 dirty evidence 文件及 ignored artifacts 不进入暂存区、不覆盖、不清理。
- 若报告提交到远端，只推送任务分支；不合并 `main`，不改变两份旧 run/sidecar/Knowledge 内容。

**静态审查输入**：上游决策与字段血缘来自 `docs/engineering/reports/2026-10-28-company-research-p0-19-decision-004.md`、`docs/engineering/reports/2026-10-28-asof-and-reverse-dcf-feasibility.md`、`docs/engineering/reports/2026-10-27-company-research-gate1-contract-lineage-audit.md`、`docs/engineering/reports/2026-10-27-company-research-gate1-field-lineage-detail.md`；架构依据为 `docs/architecture/RESEARCH_SKILL_ARCHITECTURE_V1.md`、`docs/architecture/RESEARCHHUB_DATA_LAYER_ARCHITECTURE_V1.md`、`docs/architecture/RESEARCH_SKILL_CATALOG_V1.md`、`docs/architecture/REVIEW_GOVERNANCE_V0.1.md`。静态代码审查范围为本任务书列出的四个 `SKILL.md`、`skills/valuation/financials.ts`, `skills/valuation/contracts.ts`, `workflows/company-deep-research/scenario-assumptions.ts` 和现存 Company Research workflow mapping。
