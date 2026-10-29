# S4-007B-002-B Workflow 私有经济桥实施报告

**任务：** `RHL-CQR-P0-19-S4-007B-002-B`
**冻结基线：** `369b34c4774cd55c529a476105b85f56784c2bd2`
**目标分支：** `codex/company-research-p0-01-06`
**交付状态：** `S4-007B-002-B READY_FOR_ARCHITECTURE_REVIEW`（未自签 ACCEPTED）

## 实施边界

新增一个无 I/O 的 `FIXTURE_ONLY` 经济桥，供后续架构审查。它没有公司数据、估值目标价、概率加权输出、生产 Workflow 接线或资格提升能力。没有调用 Provider、外部 API、PDF、模型或 Reviewer；没有写入 Knowledge；没有修改 Skill、公共 Schema、信任根或 main。

只改以下四个白名单文件：

| 文件 | 改动 |
|---|---|
| `workflows/company-deep-research/scenario-method-contracts.ts` | 仅追加 CalibrationRange、经济数值证据、EconomicBridgeLine/Scalar/Input/Result/Diagnostic 私有类型；既有接口及常量未改。 |
| `workflows/company-deep-research/scenario-economic-bridge.ts` | 新增纯函数计算、校验、诊断和 canonical hash；无外部依赖，唯一模块依赖是既有纯 hash helper。 |
| `tests/workflows/company-scenario-economic-bridge.test.ts` | 新增 F25–F35 与数值、量纲、时间、哈希、不可变性和畸形输入回归。 |
| `docs/engineering/reports/2026-10-29-company-research-s4-007b-002b-implementation.md` | 本实施证据。 |

旧 `ScenarioForecastBridge`、`BridgeAmountEvidence`、Phase 1 验证器与既有测试保持原状。新结果仅可能是 `STRUCTURALLY_VALID_FIXTURE_ONLY` 或 `UNAVAILABLE`，`reportEligible` 为字面量 `false`，情景状态永远是 `REVIEW_REQUIRED`。调用方提供的来源、版本、权利声明只进入 hash/lineage，不形成可信证明。

## 计算与失败关闭

- 收入仅计入选定的一条路径：披露分部收入，或已确认收入数量乘同期间 realized net ASP。收入行按稳定 ID 求和；重复行键、路径混加、调整重复或已计入行重叠会产生诊断并使结果不可用。收入调整使用带证据引用的有符号金额；报告合并收入缺失时 residual 是 `UNAVAILABLE`，不会伪造 0。非零 residual 原样保留，无擅设精度容忍值。
- 公司、经济/财务范围、期间、单位/原始 scale、币种、流量/存量和份额基础作为输入契约字段；不做隐式换算。数量与 ASP 的单位须以原始单位代数消去。公式不能使用 `NOT_APPLICABLE` 或 `UNAVAILABLE` 代替零；`KNOWN_ZERO` 要求数值严格为 0 且有非空证据引用。
- 毛利、毛利率、营业利润、PBT、合并净利和归母净利分开输出。费用账户唯一映射；非经常项须标明已含于费用、排除或未解决。财务项保留 signed convention；税费用采用正费用符号；NCI 正值从合并净利扣除，负值增加归母净利。缺失/混用 NCI 不视为 0。
- FCFF 仅在 unlevered EBIT、fraction tax rate、D&A、正额现金流出 CapEx、成对且完整的经营性 NWC，以及租赁/并购/税处理声明均有效时计算。ΔNWC 按期末经营营运资本减期初计算，期初/期末匹配账户并排除现金、债务、融资映射。CFO 减长期资产购建支出只输出单独 `cashFlowDifference`，不能填充 FCFF。
- H1/YTD 原期间保留，不年化。来源发布时间、检索时间、版本可用时间、快照捕获/封存和 analysisAsOf 分字段；未来发布时间/可用时间/捕获/封存声明以及捕获晚于封存会失败。时间和权利字段仍是 fixture 声明，不是 PIT 证明。
- 每个组件携带公式版本和 lineage IDs。输入 hash 包含完整输入；键控的无序行集合在 hash 与加总前按稳定 ID 排序，数组内有序操作不重排。对象不会被修改。遇到无法 canonicalize 的数值、畸形结构或异常会返回 `UNAVAILABLE`，不向调用方抛出。
- BEAR/BASE/BULL 任一候选缺 baseline、数值、机制、校准、最强反证、触发器或作者均保持 `REVIEW_REQUIRED`。历史/行业极值被诊断为 `HISTORICAL_ENVELOPE_NOT_CALIBRATION`。即使候选字段齐全，本模块也不判断经济合理性。

本输入契约不替代真实来源绑定，也不构造公司预测。结构化算术可用仅表示 fixture 形状下公式可执行，不代表来源、许可、版本/PIT、Skill 方法或独立审阅通过。

## 合成测试证据

`tests/workflows/company-scenario-economic-bridge.test.ts` 的 12 项测试覆盖任务书 F25–F35：

| ID | 测试 | 正反例与关键断言 | 最终结果 |
|---|---|---|---|
| F25 | `F25 segment and recognized volume times net ASP routes are separately calculable; overlap rejects` | 两条路线各算出 100；重复 economicLineKey 输出 `DOUBLE_COUNTED_REVENUE_PATH`。 | 通过 |
| F26 | `F26 rejects incompatible period, currency, unit, scope, and flow-stock metadata` | FY/H1、原生单位/scale、scope/company、存量/流量错误输出定位诊断。 | 通过 |
| F27 | `F27 applies unique consolidation adjustments once and reports explicit residual` | 一次性 elimination 后收入 95、披露对账 residual 为 5；重复调整报 `DUPLICATE_ADJUSTMENT`。 | 通过 |
| F28 | `F28 computes gross and operating profit with mapped expenses and rejects overlap or missing COGS` | 毛利 40、营业利润 32；账户/one-off 重叠报 `ACCOUNT_MAPPING_OVERLAP`，缺 COGS 后毛利不可用。 | 通过 |
| F29 | `F29 computes PBT to consolidated and parent NP with signed NCI; missing NCI fails closed` | PBT 30、合并净利 25、归母净利 22；缺 NCI 不计算归母净利并报 `NCI_SCOPE_MISSING`。 | 通过 |
| F30 | `F30 computes FCFF with EBIT, tax, D&A, CapEx and paired operating NWC` | ΔNWC 1、FCFF 19.5；缺 D&A 后 FCFF 不可用并报 `FCFF_INPUTS_MISSING`。 | 通过 |
| F31 | `F31 CFO less long-term purchases is separate from unavailable FCFF` | CFO 12 减长期资产购建 7 得差值 5；FCFF 仍不可用并报 `FCFF_INPUTS_MISSING`。 | 通过 |
| F32 | `F32 preserves H1_YTD and distinguishes KNOWN_ZERO from unavailable or not applicable` | H1 仍为 100；有引用的零可用，`NOT_APPLICABLE` 不能代 0。 | 通过 |
| F33 | `F33 acquisition, disposal, reclassification and elimination remain separately signed adjustments` | 并购/处置/重分类以有符号独立行计入；缺披露总额时 residual 为 unavailable 并报 `RESIDUAL_UNVERIFIED`。 | 通过 |
| F34 | `F34 missing assumption review fields keep all scenarios REVIEW_REQUIRED` | BEAR/BASE/BULL 缺任意字段都不升级审阅状态。 | 通过 |
| F35 | `F35 historical or industry extrema cannot qualify as operational calibration` | 历史/行业范围诊断为 `HISTORICAL_ENVELOPE_NOT_CALIBRATION`。 | 通过 |

额外安全回归位于 `extra regressions: non-finite, negative volume, zero gross margin denominator, overflow and hash invariants`：非有限输入与求和溢出失败关闭；负数量输出 `NEGATIVE_PHYSICAL_QUANTITY`；零收入毛利率不可用；无序行改序 hash 不变；公式版本、权利声明、版本声明和 asOf 变化会改变 hash；深比较输入前后不变；null 畸形输入返回 `UNAVAILABLE`；结构有效结果仍固定 `reportEligible:false`。

## 验证记录

命令均在冻结分支本地运行。聚焦测试在开发阶段曾有一次失败，修正单位诊断和 NWC 期初期末匹配后重跑通过；类型检查也曾报告未使用符号，清理后通过。

| 命令 | 最终退出码与结果 |
|---|---|
| `node --import tsx --test tests/workflows/company-scenario-economic-bridge.test.ts` | `0`；12 通过，0 失败。首轮退出码 `1`，F26 与 F30 两项失败，已修复并复验。 |
| `node --import tsx --test tests/workflows/company-scenario-method-contracts.test.ts` | `0`；Phase 1 既有测试 19 通过，0 失败，既有测试未修改。 |
| `npm run typecheck -- --pretty false` | `0`；通过。首轮退出码 `1`，仅有 3 个未使用导入/声明，清理后复验。 |
| `git diff --check` | `0`；通过。 |

未运行 `npm run test:node` 或 `npm run client:test`，因此本批没有全量回归结果，也没有将历史 21 个 Node / 5 个客户端基线失败当作本批通过证据。测试输入为测试文件内合成 fixture；没有读取公司运行 sidecar 内容。

## 用户文件与冻结运行字节审计

测试前后对五份已有 dirty evidence JSON 和冻结目录下 15 个既有运行 sidecar（含两份分析、bundle、报告、workflow、started、KB integrity、Markdown 及 summary）只计算 SHA-256，没有读取 sidecar 正文。以下哈希在最终聚焦测试和类型检查前记录；完成验证后再次计算，20/20 完全相同：

| 路径 | SHA-256（测试前 = 测试后） |
|---|---|
| `tests/validation/evidence/RHL-EXEC-003-A-004-FIX-002-thesis-authorized.json` | `7252fd35dec70403fd6bb8b3edc6ffadd25211fd158461a1dde30458bf07f442` |
| `tests/validation/evidence/RHL-EXEC-003-A-004-FIX-003-event-readonly.json` | `ef0e7475e0464ca1e3950feb348b0d3ed6dc7383e32200faa3fc413207bc641a` |
| `tests/validation/evidence/RHL-EXEC-003-A-004-FIX-003-industry-readonly.json` | `12c951be5ca88fb35b155187055b0a15a50d212133c9b68088c0d1674500c0fa` |
| `tests/validation/evidence/RHL-EXEC-003-A-004-FIX-003-thesis-references.json` | `61cd5cf5b24a7f0fc10746e0269a845d6e29464614c43738d7585ec075fb4670` |
| `tests/validation/evidence/company-quality-pi-default-deny.json` | `4c02302a5b31cec6d93b9298e06a76bd0b834b4bacc914670c7fd06aa6300038` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002384-analysis.json` | `72588193faff4c2e75fb2e07c0b07197619b8c23b9fa49f843e7f05ae34e98b3` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002384-bundle.json` | `691f3f561b02523f00865f574f6fd373b202c9dad98502abbd61fa3b5958067f` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002384-company-research-002384-860916a8-4958-4d29-8da1-56ad5dd1c2c6.md` | `3c14d4fbb29aee31bc434b9c99b98de3e79f6897581c4519a46aa87f236eb91f` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002384-kb-integrity.json` | `4322cd0b20c70c400615987b06de5d400e45fecc7676cac11cccfd5678ff1f0a` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002384-report.json` | `6fa63686b889150551b42eab66b3ce32f4246871f5a3d4be99117d0e0d8917d4` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002384-started.json` | `716537e8348f69818ffdc128970e509ed77b367443dc1d4a12292e2d972f87df` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002384-workflow.json` | `0cf91dfa99a0ca0b1daff3b8711e5e29ab1f07c1d693cfa7f986999adc718ebd` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002594-analysis.json` | `60c877932829d114eb02af13304402ec5599b4410df5bc63926f4f646489de35` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002594-bundle.json` | `1fd11c5f5e7764d23bd4950712faf056efeff09436dd983635b24c156a7a8739` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002594-company-research-002594-82bcc425-d48d-4e55-bc45-111aa8c28ba4.md` | `0f83c1cd96f5962402eae69503e2c53cdf76e16f01a6acf2f0324e986a036604` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002594-kb-integrity.json` | `4322cd0b20c70c400615987b06de5d400e45fecc7676cac11cccfd5678ff1f0a` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002594-report.json` | `2867b270318b21e334c28246935326dab19fa734c094253bb80637b2c32390c1` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002594-started.json` | `7f1b87714dea542920e07235206af7db367abfc9f58cb4d043328c49dcb6fef1` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002594-workflow.json` | `43316166217675df70473ed86cf646fa988dd3dfc53be6c4e75f7f32bf6ff7f6` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/summary.json` | `e9999cf1ff2173c1ce5d87387abb0c65d9473426b5334547285499f0f51f9228` |

其他既有 dirty/未跟踪项也未暂存、编辑或清理，包括 parser `__pycache__`、runtime launch 日志及 `tmp/`。以上只证明列出的 20 个文件字节未变；不以 Git diff 代替文件哈希。

## Gate 状态与停机点

| Gate | 状态 | 证据 / 限制 |
|---|---|---|
| B0 Scope | PASS | 冻结 SHA 精确匹配；只改四个白名单文件；无模型、数据、生产接线、Skill 或 Knowledge 操作。 |
| B1 Private contracts | PASS | 仅追加 private typed contracts；missing/zero/N/A、scope、period、unit、origin、lineage 分离；旧 Phase 1 API 未改。 |
| B2 Revenue | PASS | 两路线单选、行/调整重复拒绝、显式 residual，无报告总额时 residual unavailable。 |
| B3 Profit | PASS | 毛利至归母净利逐组件输出；账户/非经常项/NCI 冲突关闭。 |
| B4 FCFF | PASS | 完整 EBIT/tax/D&A/CapEx/ΔNWC 和处理声明才计算；CFO shortcut 不回填，H1 不年化。 |
| B5 Fail-closed | PASS | 缺项、非数、溢出、期间/范围/单位不符、重复映射及历史 envelope 有合成测试。 |
| B6 Determinism | PASS | 对象键序稳定、无序行按 ID 归一、关键声明更改使 hash 改变、输入只读；hash 不授予资格。 |
| B7 Tests & legacy | PASS | F25–F35 12/12；Phase 1 19/19；类型检查通过。未运行全量 Node/client 套件。 |
| B8 Governance | PASS | 所有结果 `reportEligible:false`；无独立 Reviewer 接线。既有双公司 T0 17/19 blocked、P0-19 NOT_ACCEPTED 状态不变。 |

冻结公司运行仍为 BYD `82bcc425-d48d-4e55-bc45-111aa8c28ba4` / T0 `2026-10-27T20:19:59.628Z`，东山精密 `860916a8-4958-4d29-8da1-56ad5dd1c2c6` / T0 `2026-10-27T20:26:46.347Z`。本次未打开或修改其内容，也未重跑。语义经济审阅、Data/M1/M2、独立 Reviewer 及 19/19 验收均未执行或获准。

架构复验命令：

```powershell
git show --stat --oneline <implementation-sha>
git show --format=fuller -- workflows/company-deep-research/scenario-method-contracts.ts workflows/company-deep-research/scenario-economic-bridge.ts tests/workflows/company-scenario-economic-bridge.test.ts docs/engineering/reports/2026-10-29-company-research-s4-007b-002b-implementation.md
node --import tsx --test tests/workflows/company-scenario-economic-bridge.test.ts
node --import tsx --test tests/workflows/company-scenario-method-contracts.test.ts
npm run typecheck -- --pretty false
git diff --check
```

下游停机点为 `READY_FOR_ARCHITECTURE_REVIEW`。002-C 的独立审阅交接和资格治理尚未授权；不得将本桥接入生产研究或解释为公司估值能力。
