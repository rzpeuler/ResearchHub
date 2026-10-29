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

## FIX-001：组件级 Fail-Closed 修复

**任务：** `RHL-CQR-P0-19-S4-007B-002-B-FIX-001`
**冻结/父提交：** `2e2d5e5c7667de3bb621654b49cc711063d1c980`
**允许文件：** 上述计算器、其合成测试、本报告；本次未修改 `scenario-method-contracts.ts`，所以没有新增或改变契约。

本节追加保留 002-B 的实施记录。002-B 曾因诊断与组件 KNOWN 值脱节被判 `NOT_ACCEPTED`；本修复只处理计算器的组件验证/依赖传播，不提升任何来源或公司研究资格。

### P1 — FCFF 所有必需输入都进入同一有效性门

先前的 period/scope/unit/sign 诊断没有都参与 `fcffReady`。现在将 EBIT、税率、D&A、CapEx 的 scalar 结果及各自兼容性布尔值合并进 FCFF 门：金额必须是同公司、同期间、同 scope、同原生单位/币种/量纲的 FLOW；税率必须为同期间和 scope 的 `RATE` fraction、null currency、值在 `[0,1]`；CapEx 必须非负并标为 `POSITIVE_CASH_OUTFLOW`。全部兼容检查通过且完整 NWC、税/租赁/并购处理声明存在后才计算 FCFF。任一失败时 FCFF 为 `UNAVAILABLE`，无 `value` 属性；独立毛利仍保持 KNOWN。税率不与 EBIT 做同量纲比较，只比较公司/期间/scope。

测试 `FIX-001 P1: every CapEx, D&A, tax-rate compatibility failure blocks FCFF without value` 对 CapEx 符号、FY 期间、USD 币种、CNY-thousand 单位、STOCK、负额，D&A 期间/scope，以及 tax rate 单位/currency/scope/period/越界分别断言定位诊断、整体状态和组件状态，且无 FCFF value。原正例仍断言 ΔNWC `1`、FCFF `19.5`。

### P2 — 财务项错误切断其下游

先前 finance、non-operating、tax、NCI 项的 `validatePair()` 结果只产生日志，没有可靠控制算式。现在分别保存兼容状态：Finance/non-operating 项只有在同期间、scope、FLOW、单位、币种、share basis 和 `SIGNED_AMOUNT` 有效时参与 PBT；任一失败，PBT/合并净利/归母净利均无 value，合法毛利和营业利润仍可用。税项必须符合上述财务口径和 `POSITIVE_EXPENSE`，失败时 PBT 保留、两种净利不可用。NCI 必须同口径且为 `CONSOLIDATED_TO_PARENT` 与 signed amount；失败时合并净利保留、归母净利不可用。缺失 NCI 不会当成零，EPS 不能被接受为金额。

测试 `FIX-001 P2: profit-statement period, scope, unit, flow and sign failures cut only dependent profit chain` 覆盖 Finance 期间/scope/币种、non-operating FLOW/STOCK、税符号/期间、NCI 单位/scope。每例直接断言受影响组件 `UNAVAILABLE` 且无 value、独立组件状态；H1 正例仍为 PBT `30`、合并净利 `25`、归母净利 `22`。

### P3 — 分部收入行语义、引用与下游传播

先前仅验证了部分身份和金额。现在被计入的行必须有完整非空 line/economic key/company/bridge/scenario、非空 input/evidence refs、与输入一致的 formulaVersion、期间和 scope；金额必须是 `FLOW`/`CURRENCY_AMOUNT`，且唯一允许 `segmentRevenue --ADD--> revenue`。只允许 `FACT`/`DERIVED` 行，金额证据仍须是有效 `KNOWN`/有引用的 `KNOWN_ZERO`。空的 disclosed-segment 行集不是零收入。`CROSS_CHECK_ONLY` 行保持允许且不加总。

测试 `FIX-001 P3: malformed included revenue rows and empty segment routes block revenue and all profit descendants` 逐例覆盖 STOCK、MULTIPLY、RECLASSIFY、错误 toMetric、空 refs、空 formulaVersion、空行集。每例断言定位诊断、overall `UNAVAILABLE`，revenue、gross/operating profit、PBT、合并/归母净利组件均 `UNAVAILABLE` 且无 value。合法分部收入与 volume×ASP 正例保留，收入均为 `100`。

### P4 — ΔNWC 只接受可配对且角色稳定的经营科目

先前未知角色会按经营资产处理，且资产/负债角色可在期初期末改变。现在期初和期末都要求唯一且非空 `accountId`，角色严格为 `OPERATING_CURRENT_ASSET` 或 `OPERATING_CURRENT_LIABILITY`；不接受空/未知角色、排除列表中的账户、重复/未配对账户或角色变更。每对科目须为同公司、scope、币种/单位/量纲的存量，期初不晚于期末，期末等于 horizon end；负债仍以负号计算。任何失败使 ΔNWC 与 FCFF 都不可用，但不传染到独立毛利。

测试 `FIX-001 P4: NWC rejects unstable, excluded, unknown, incomplete or mismatched operating accounts` 覆盖角色变化、OTHER/空角色、被排除的 cash、重复 accountId、缺期末账户、期末 FLOW、币种不符。每例断言具体诊断、overall 状态、ΔNWC/FCFF 均 `UNAVAILABLE` 且无 value，同时毛利仍 KNOWN。原正例 ΔNWC `1`、FCFF `19.5` 不变。

新增断言还覆盖无序行与对象键顺序的 hash 稳定，以及期间、scope、金额、formula、rights/version、asOf 变化的 hash 更新；Infinity/null/malformed row 不抛出异常；全部结果仍 `reportEligible:false` 且 `assumptionReviewStatus:'REVIEW_REQUIRED'`。

### FIX-001 验证命令与结果

| 命令 | 最终 exit code / 统计 |
|---|---|
| `node --import tsx --test tests/workflows/company-scenario-economic-bridge.test.ts` | `0`；16 通过、0 失败。原 12 个 F25–F35 保留并通过，新增 P1–P4 四项通过。 |
| `node --import tsx --test tests/workflows/company-scenario-method-contracts.test.ts` | `0`；19 通过、0 失败。 |
| `npm run typecheck -- --pretty false` | 最终 `0`；通过。开发中曾因 lineage 引用 narrowing 报 TypeScript 错误，修正后复验。 |
| `git diff --check` | 最终 `0`；通过。 |
| `npm run test:node` | 未运行。 |
| `npm run client:test` | 未运行。 |

开发阶段曾有失败的聚焦试跑：P4 首次未定位到重复账户，因为数组长度门提前跳过账户扫描（该失败促成扫描逻辑调整）；随后测试 fixture 的行 formulaVersion 与新契约不一致导致一轮失败，fixture 修正后上述最终命令全部通过。最终结论仅针对聚焦验证，不代表完整 Node/client 套件通过。既有 Node 21 / client 5 个已知失败身份未在本批重跑或重新比较。

### FIX-001 受保护文件 SHA-256 复核

以下五份既有 dirty JSON 与 15 个冻结公司运行 sidecar，在最终验证前后都只计算 SHA-256，未读取正文。20 个文件的前后哈希逐个相等：

| 路径 | 前 SHA-256 | 后 SHA-256 |
|---|---|---|
| `tests/validation/evidence/RHL-EXEC-003-A-004-FIX-002-thesis-authorized.json` | `7252fd35dec70403fd6bb8b3edc6ffadd25211fd158461a1dde30458bf07f442` | `7252fd35dec70403fd6bb8b3edc6ffadd25211fd158461a1dde30458bf07f442` |
| `tests/validation/evidence/RHL-EXEC-003-A-004-FIX-003-event-readonly.json` | `ef0e7475e0464ca1e3950feb348b0d3ed6dc7383e32200faa3fc413207bc641a` | `ef0e7475e0464ca1e3950feb348b0d3ed6dc7383e32200faa3fc413207bc641a` |
| `tests/validation/evidence/RHL-EXEC-003-A-004-FIX-003-industry-readonly.json` | `12c951be5ca88fb35b155187055b0a15a50d212133c9b68088c0d1674500c0fa` | `12c951be5ca88fb35b155187055b0a15a50d212133c9b68088c0d1674500c0fa` |
| `tests/validation/evidence/RHL-EXEC-003-A-004-FIX-003-thesis-references.json` | `61cd5cf5b24a7f0fc10746e0269a845d6e29464614c43738d7585ec075fb4670` | `61cd5cf5b24a7f0fc10746e0269a845d6e29464614c43738d7585ec075fb4670` |
| `tests/validation/evidence/company-quality-pi-default-deny.json` | `4c02302a5b31cec6d93b9298e06a76bd0b834b4bacc914670c7fd06aa6300038` | `4c02302a5b31cec6d93b9298e06a76bd0b834b4bacc914670c7fd06aa6300038` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002384-analysis.json` | `72588193faff4c2e75fb2e07c0b07197619b8c23b9fa49f843e7f05ae34e98b3` | `72588193faff4c2e75fb2e07c0b07197619b8c23b9fa49f843e7f05ae34e98b3` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002384-bundle.json` | `691f3f561b02523f00865f574f6fd373b202c9dad98502abbd61fa3b5958067f` | `691f3f561b02523f00865f574f6fd373b202c9dad98502abbd61fa3b5958067f` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002384-company-research-002384-860916a8-4958-4d29-8da1-56ad5dd1c2c6.md` | `3c14d4fbb29aee31bc434b9c99b98de3e79f6897581c4519a46aa87f236eb91f` | `3c14d4fbb29aee31bc434b9c99b98de3e79f6897581c4519a46aa87f236eb91f` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002384-kb-integrity.json` | `4322cd0b20c70c400615987b06de5d400e45fecc7676cac11cccfd5678ff1f0a` | `4322cd0b20c70c400615987b06de5d400e45fecc7676cac11cccfd5678ff1f0a` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002384-report.json` | `6fa63686b889150551b42eab66b3ce32f4246871f5a3d4be99117d0e0d8917d4` | `6fa63686b889150551b42eab66b3ce32f4246871f5a3d4be99117d0e0d8917d4` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002384-started.json` | `716537e8348f69818ffdc128970e509ed77b367443dc1d4a12292e2d972f87df` | `716537e8348f69818ffdc128970e509ed77b367443dc1d4a12292e2d972f87df` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002384-workflow.json` | `0cf91dfa99a0ca0b1daff3b8711e5e29ab1f07c1d693cfa7f986999adc718ebd` | `0cf91dfa99a0ca0b1daff3b8711e5e29ab1f07c1d693cfa7f986999adc718ebd` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002594-analysis.json` | `60c877932829d114eb02af13304402ec5599b4410df5bc63926f4f646489de35` | `60c877932829d114eb02af13304402ec5599b4410df5bc63926f4f646489de35` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002594-bundle.json` | `1fd11c5f5e7764d23bd4950712faf056efeff09436dd983635b24c156a7a8739` | `1fd11c5f5e7764d23bd4950712faf056efeff09436dd983635b24c156a7a8739` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002594-company-research-002594-82bcc425-d48d-4e55-bc45-111aa8c28ba4.md` | `0f83c1cd96f5962402eae69503e2c53cdf76e16f01a6acf2f0324e986a036604` | `0f83c1cd96f5962402eae69503e2c53cdf76e16f01a6acf2f0324e986a036604` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002594-kb-integrity.json` | `4322cd0b20c70c400615987b06de5d400e45fecc7676cac11cccfd5678ff1f0a` | `4322cd0b20c70c400615987b06de5d400e45fecc7676cac11cccfd5678ff1f0a` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002594-report.json` | `2867b270318b21e334c28246935326dab19fa734c094253bb80637b2c32390c1` | `2867b270318b21e334c28246935326dab19fa734c094253bb80637b2c32390c1` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002594-started.json` | `7f1b87714dea542920e07235206af7db367abfc9f58cb4d043328c49dcb6fef1` | `7f1b87714dea542920e07235206af7db367abfc9f58cb4d043328c49dcb6fef1` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002594-workflow.json` | `43316166217675df70473ed86cf646fa988dd3dfc53be6c4e75f7f32bf6ff7f6` | `43316166217675df70473ed86cf646fa988dd3dfc53be6c4e75f7f32bf6ff7f6` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/summary.json` | `e9999cf1ff2173c1ce5d87387abb0c65d9473426b5334547285499f0f51f9228` | `e9999cf1ff2173c1ce5d87387abb0c65d9473426b5334547285499f0f51f9228` |

### FIX-001 Gate 复核与停机

| Gate | 状态 | 本轮证据 |
|---|---|---|
| B0 Git/scope | PASS | 父提交是冻结 SHA；本轮只修改四个授权文件；用户原有 dirty 项未暂存或触碰。 |
| B1 Contracts | PASS | 没有修改类型或 Phase 1 / 公共契约；无资格提升。 |
| B2 Revenue | PASS | 每个非法行/空路由都阻断 revenue 和利润下游；合法分部与量价正例保留。 |
| B3 Profit | PASS | 财务项、税、NCI 按依赖层切断；不相关组件保留。 |
| B4 FCFF | PASS | 任一必需金额/税率/符号/scope/期间/单位/NWC 角色失败均无 FCFF value。 |
| B5 Fail-Closed | PASS | 诊断失败与受影响组件 UNAVAILABLE 一致；测试另断言 `value` 属性不存在，并验证无关组件可用。 |
| B6 Determinism | PASS | 原有和新增 hash/不可变性断言通过。 |
| B7 Tests | PASS | 新测试 16/16、Phase 1 19/19、typecheck 与 diff-check 通过；全量 Node/client 未运行。 |
| B8 Governance | PASS | Fixture-only、reportEligible false、Reviewer/Data/Model/Knowledge/生产接线均未触及；双公司 T0 仍 17/19 BLOCKED，P0-19 NOT_ACCEPTED。 |

最高交付状态仍为 `S4-007B-002-B-FIX-001 READY_FOR_ARCHITECTURE_REVIEW`，未自签 ACCEPTED。公司研究、估值、19/19、M1/M2 与 002-C 仍未获准。

## FIX-002 — Horizon-Aligned FCFF and NWC Boundary

**任务：** `RHL-CQR-P0-19-S4-007B-002-B-FIX-002`
**冻结 SHA / 本提交父 SHA：** `0c921b6ff36b575a11404f28dfb0f1892569cb0e`
**目标分支：** `codex/company-research-p0-01-06`；编辑前本地 HEAD、merge-base 和 `origin/codex/company-research-p0-01-06` 均等于冻结 SHA。
**最终状态：** `S4-007B-002-B-FIX-002 READY_FOR_ARCHITECTURE_REVIEW`；等待架构师按提交 SHA 独立验收。

### 根因与修复

FIX-001 将 FCFF 的 EBIT、税率、D&A、CapEx 互相做了 pairwise 期间比较，但“彼此相等”并不证明“与目标预测期间一致”。四项即使一起被改成 FY2025，也曾可与 H1 2026 的 ΔNWC 合成。NWC 期初只检查不晚于期末且期末等于 horizon 末日，因此同日或任意较早存量日期也曾通过；期初存量没有绑定到 horizon 起始日前一日。

本次以 `input.horizon.periodStart / periodEnd / periodBasis` 为唯一 FCFF 目标期间。日期验证使用纯函数严格解析公历 `YYYY-MM-DD`，检查真实日历日期、起止顺序和非空 basis；每个 FCFF operand 分别逐字段对齐 horizon，任何不符均给出对应 `fcff.*` 的 `PERIOD_MISMATCH` 并关闭 `fcffReady`。NWC 每个配对科目的 opening `periodEnd` 必须等于 horizon 起始日前一日，closing `periodEnd` 必须等于 horizon 末日。日期比较不要求 opening/closing `periodBasis` 相同，也不把 opening 的 `periodStart` 错当观察日；来源报告可以是 FY、观察日仍须精确为期初边界。闰年与跨年由公历日历规则计算，不用 JS `Date` 对非法日期做静默归一化。

期间失败时 `components.fcff` 无 `value` 且 `UNAVAILABLE`；NWC 存量边界失败时 `deltaNwc` 与 FCFF 都无 `value` 且 `UNAVAILABLE`。独立的 gross profit / PBT 仍沿既有依赖链计算；CFO 差额仍是独立组件，不作为 FCFF 兜底。既有单位、FLOW/STOCK、scope、币种、tax fraction、CapEx 符号、账户角色/身份/排除项、处理声明及 FIX-001 P1–P4 门槛保持。

### 修改清单与测试定位

仅修改本任务白名单的三个文件：

| 文件 | 修改 |
|---|---|
| `workflows/company-deep-research/scenario-economic-bridge.ts` | 加入严格纯公历日期解析、horizon 对齐门及精确 NWC 观察日边界。 |
| `tests/workflows/company-scenario-economic-bridge.test.ts` | 保留原 16 项，新增六组 FIX-002 反例/正例；最终共 22 项。 |
| `docs/engineering/reports/2026-10-29-company-research-s4-007b-002b-implementation.md` | 追加本节，不覆盖 002-B 与 FIX-001 历史。 |

| 组 | 输入/场景 | 关键结果 |
|---|---|---|
| T1 | 仅 EBIT 改为 FY2025 | `fcff.ebit` 定位 `PERIOD_MISMATCH`；FCFF 无值且不可用；毛利仍为 40。 |
| T2 | EBIT、税率、D&A、CapEx 同时改为 FY2025，horizon 保持 H1 2026 | 四个 operand 都有 horizon mismatch；即使彼此一致也不能生成 19.5；FCFF 无值，毛利为 40。 |
| T3 | opening NWC 分别偏早一天、等于 closing、偏晚一天 | 每种情况均有 NWC 时间诊断；ΔNWC 和 FCFF 无值且不可用；毛利仍 KNOWN。 |
| T4 | closing NWC 错一天；并验证 FY opening 来源 / H1 closing 来源 | closing 错误使 ΔNWC 与 FCFF 关闭；合法 `2025-12-31` / `2026-06-30` 计算 ΔNWC `1`、FCFF `19.5`，不同 basis 不误拒绝。 |
| T5 | 单独改 horizon 起点、终点或 basis；再测非法日期、倒置日期、空 basis | FCFF 均失败关闭；每个 horizon 变化使 input hash 改变；不修改传入对象；非法 horizon 有明确诊断。 |
| T6 | 合法原始 fixture 与 horizon `2024-03-01` 的闰年 opening `2024-02-29` | 两者均计算 ΔNWC `1`、FCFF `19.5`；`reportEligible=false`、`REVIEW_REQUIRED`；输入仍为 `FIXTURE_ONLY`。 |

结果契约没有 `mode` 输出字段；FIXTURE_ONLY 是输入约束。本测试不扩展契约，分别断言输入 mode 与结果的 `reportEligible=false`、`assumptionReviewStatus=REVIEW_REQUIRED`。开发中一次初跑发现新增测试误读了结果契约中的 `mode`；修正断言后最终验证全过，未修改公共契约。

### 最终验证记录

下列命令均在最终实现上执行，执行前后保护文件 SHA-256 对照 20/20 相同：

| 命令 | 退出码 | 结果 |
|---|---:|---|
| `node --import tsx --test tests/workflows/company-scenario-economic-bridge.test.ts` | 0 | 22 passed / 0 failed：原有 16 项 + FIX-002 T1–T6 六组。 |
| `node --import tsx --test tests/workflows/company-scenario-method-contracts.test.ts` | 0 | 19 passed / 0 failed。 |
| `npm run typecheck -- --pretty false` | 0 | `tsc --noEmit --pretty false` 通过。 |
| `git diff --check` | 0 | 无空白错误。 |

未运行 `npm run test:node`、`npm run client:test`；不将历史 21 项 Node / 5 项客户端失败基线冒充为本轮结果。未运行真实公司研究、估值模型或 Knowledge 写入。

### 保护文件 SHA-256 前后对照

以下 5 个未提交用户 JSON 和 15 个冻结 BYD / 东山 sidecar 在上述最终测试前后逐个计算 SHA-256，前后均一致；仅对 sidecar 读取文件哈希，未读取或修改其内容。

| 路径 | 测试前 SHA-256 | 测试后 SHA-256 |
|---|---|---|
| `tests/validation/evidence/RHL-EXEC-003-A-004-FIX-002-thesis-authorized.json` | `7252fd35dec70403fd6bb8b3edc6ffadd25211fd158461a1dde30458bf07f442` | `7252fd35dec70403fd6bb8b3edc6ffadd25211fd158461a1dde30458bf07f442` |
| `tests/validation/evidence/RHL-EXEC-003-A-004-FIX-003-event-readonly.json` | `ef0e7475e0464ca1e3950feb348b0d3ed6dc7383e32200faa3fc413207bc641a` | `ef0e7475e0464ca1e3950feb348b0d3ed6dc7383e32200faa3fc413207bc641a` |
| `tests/validation/evidence/RHL-EXEC-003-A-004-FIX-003-industry-readonly.json` | `12c951be5ca88fb35b155187055b0a15a50d212133c9b68088c0d1674500c0fa` | `12c951be5ca88fb35b155187055b0a15a50d212133c9b68088c0d1674500c0fa` |
| `tests/validation/evidence/RHL-EXEC-003-A-004-FIX-003-thesis-references.json` | `61cd5cf5b24a7f0fc10746e0269a845d6e29464614c43738d7585ec075fb4670` | `61cd5cf5b24a7f0fc10746e0269a845d6e29464614c43738d7585ec075fb4670` |
| `tests/validation/evidence/company-quality-pi-default-deny.json` | `4c02302a5b31cec6d93b9298e06a76bd0b834b4bacc914670c7fd06aa6300038` | `4c02302a5b31cec6d93b9298e06a76bd0b834b4bacc914670c7fd06aa6300038` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002384-analysis.json` | `72588193faff4c2e75fb2e07c0b07197619b8c23b9fa49f843e7f05ae34e98b3` | `72588193faff4c2e75fb2e07c0b07197619b8c23b9fa49f843e7f05ae34e98b3` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002384-bundle.json` | `691f3f561b02523f00865f574f6fd373b202c9dad98502abbd61fa3b5958067f` | `691f3f561b02523f00865f574f6fd373b202c9dad98502abbd61fa3b5958067f` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002384-company-research-002384-860916a8-4958-4d29-8da1-56ad5dd1c2c6.md` | `3c14d4fbb29aee31bc434b9c99b98de3e79f6897581c4519a46aa87f236eb91f` | `3c14d4fbb29aee31bc434b9c99b98de3e79f6897581c4519a46aa87f236eb91f` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002384-kb-integrity.json` | `4322cd0b20c70c400615987b06de5d400e45fecc7676cac11cccfd5678ff1f0a` | `4322cd0b20c70c400615987b06de5d400e45fecc7676cac11cccfd5678ff1f0a` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002384-report.json` | `6fa63686b889150551b42eab66b3ce32f4246871f5a3d4be99117d0e0d8917d4` | `6fa63686b889150551b42eab66b3ce32f4246871f5a3d4be99117d0e0d8917d4` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002384-started.json` | `716537e8348f69818ffdc128970e509ed77b367443dc1d4a12292e2d972f87df` | `716537e8348f69818ffdc128970e509ed77b367443dc1d4a12292e2d972f87df` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002384-workflow.json` | `0cf91dfa99a0ca0b1daff3b8711e5e29ab1f07c1d693cfa7f986999adc718ebd` | `0cf91dfa99a0ca0b1daff3b8711e5e29ab1f07c1d693cfa7f986999adc718ebd` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002594-analysis.json` | `60c877932829d114eb02af13304402ec5599b4410df5bc63926f4f646489de35` | `60c877932829d114eb02af13304402ec5599b4410df5bc63926f4f646489de35` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002594-bundle.json` | `1fd11c5f5e7764d23bd4950712faf056efeff09436dd983635b24c156a7a8739` | `1fd11c5f5e7764d23bd4950712faf056efeff09436dd983635b24c156a7a8739` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002594-company-research-002594-82bcc425-d48d-4e55-bc45-111aa8c28ba4.md` | `0f83c1cd96f5962402eae69503e2c53cdf76e16f01a6acf2f0324e986a036604` | `0f83c1cd96f5962402eae69503e2c53cdf76e16f01a6acf2f0324e986a036604` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002594-kb-integrity.json` | `4322cd0b20c70c400615987b06de5d400e45fecc7676cac11cccfd5678ff1f0a` | `4322cd0b20c70c400615987b06de5d400e45fecc7676cac11cccfd5678ff1f0a` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002594-report.json` | `2867b270318b21e334c28246935326dab19fa734c094253bb80637b2c32390c1` | `2867b270318b21e334c28246935326dab19fa734c094253bb80637b2c32390c1` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002594-started.json` | `7f1b87714dea542920e07235206af7db367abfc9f58cb4d043328c49dcb6fef1` | `7f1b87714dea542920e07235206af7db367abfc9f58cb4d043328c49dcb6fef1` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002594-workflow.json` | `43316166217675df70473ed86cf646fa988dd3dfc53be6c4e75f7f32bf6ff7f6` | `43316166217675df70473ed86cf646fa988dd3dfc53be6c4e75f7f32bf6ff7f6` |
| `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/summary.json` | `e9999cf1ff2173c1ce5d87387abb0c65d9473426b5334547285499f0f51f9228` | `e9999cf1ff2173c1ce5d87387abb0c65d9473426b5334547285499f0f51f9228` |

五份既有 dirty JSON、`plugins/document/parsers/docling/bridge/__pycache__/`、`runtime-launch.stderr.log`、`runtime-launch.stdout.log` 和 `tmp/` 均未被改写、暂存或纳入提交；其哈希/内容没有为本报告额外读取。实际 `git status` 与提交清单在交付前再次核验。

### B0–B8 自查

| Gate | 自查 | 证据 / 限制 |
|---|---|---|
| B0 Git/scope | PASS | 冻结父 SHA；仅三个白名单文件；提交及 push 前再次确认远端未变化。 |
| B1 Contracts | PASS | 未改 `scenario-method-contracts.ts`、Phase 1 validator/API 或公共 Schema；Phase 1 契约测试 19/19。 |
| B2 Revenue | PASS | 原 F25–F27、FIX-001 P3 保留；T1/T2 断言毛利不被 FCFF mismatch 切断。 |
| B3 Profit | PASS | 原 F28–F29、FIX-001 P2 保留；利润下游依赖门未修改。 |
| B4 FCFF & NWC | PASS | T1–T6 通过；FY2025 同伴一致但偏离目标期必拒；opening/closing 日期精确闭合；同日拒绝。 |
| B5 Fail Closed | PASS | T1–T5 验证被拒组件 `UNAVAILABLE` 且不存在 `value` 属性。 |
| B6 Determinism | PASS | 无外部 I/O；T5 检查 horizon 改变 hash 且输入对象不变；原始合法 H1 仍为 19.5。 |
| B7 Test evidence | PASS | 两个聚焦套件、typecheck 与 `git diff --check` 均退出 0；未宣称 Node/client 全量通过。 |
| B8 Governance | PASS | FIXTURE_ONLY 输入、`reportEligible:false`、review required；未重跑公司模型、未调用数据源、未写 Knowledge、未提升 P0-19，002-C 仍未授权。 |

不改变历史 T0 `17/19 BLOCKED`、研究来源权利或估值资格。报告、实现和测试仅作为待独立审阅的 fixture 修复；最高状态为 `S4-007B-002-B-FIX-002 READY_FOR_ARCHITECTURE_REVIEW`。
