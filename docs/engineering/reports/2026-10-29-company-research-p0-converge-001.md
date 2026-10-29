# ResearchHub P0-CONVERGE-001 — Company Research 归档审阅与可读性收敛

**任务**：`P0-CONVERGE-001`\
**冻结父提交**：`17fc8e9ebb1d46ee6fbbd997c4950915890f8fc4`\
**工作分支**：`codex/company-research-p0-01-06`\
**审阅日期**：2026-10-29\
**决定**：`PERSONAL_RESEARCH_READABILITY_READY`；`P0-19 NOT_ACCEPTED`；两份归档报告仍为 `17/19 BLOCKED`

## 范围与方法

只读审阅归档中的 BYD（002594，run `82bcc425-d48d-4e55-bc45-111aa8c28ba4`）和东山精密（002384，run `860916a8-4958-4d29-8da1-56ad5dd1c2c6`）配对结果。核对了两份 `report.json`、`analysis.json`、`workflow.json`、已渲染 Markdown、`summary.json` 与 section quality 检查；未读取 `bundle.json`、`started.json` 或 `kb-integrity.json` 的内容（列入 `NOT_INSPECTED`），但这些文件也纳入只读 SHA-256 完整性检查。

归档材料位于 `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/`。没有写入该目录，也没有调用模型、Reviewer、外部数据源或 Knowledge。

## 两家公司逐项审阅

两份报告各含 19 个标准章节，质量结果均是 `status=incomplete`、`passed=false`、`coreCoverage=17/19`。Workflow 均为 `blocked`，阶段为“报告保存”；这表示报告已保存但质量门槛未通过。

| 章节 | BYD 002594 | 东山精密 002384 | 审阅结论 |
|---|---|---|---|
| 公司概况、商业模式、业务分部、收入与利润驱动、产品与服务、技术与壁垒 | 通过 | 通过 | 有实质性分析和定位证据 |
| 行业与市场空间、供应链、竞争格局、财务质量、增长驱动、管理层与资本配置 | 通过 | 通过 | 有分析；结论保留可比性、披露和推断边界 |
| 催化因素、风险、估值 | 通过 | 通过 | 历史估值限于参考描述；不声称目标价或前瞻估值 |
| 乐观/基准/悲观情景（`bull-base-bear`） | **未通过** | **未通过** | `RESEARCH_GAP`、`NO_ATTRIBUTABLE_EVIDENCE`、`WORKFLOW_SECTION_NO_LOCATED_EVIDENCE`；缺少有来源的目标年经营驱动假设及可复算区间 |
| 预期差（`variant-perception`） | **未通过** | **未通过** | `RESEARCH_GAP`、`VARIANT_EXPECTATION_VALUE_VERSION_UNVERIFIED`；可见机构预测样本不能证明截至 `asOf` 的历史版本，也没有合格的独立本方预测面 |
| 研究结论、跟踪清单 | 通过 | 通过 | 保留有证据的投资逻辑、反证、条件风险和可跟踪指标；没有依赖未通过的情景章节 |

上表的通过仅复述归档 `sectionChecks`，不是新执行的验证。完整 19 项 ID 顺序为：`company-overview`、`business-model`、`business-segments`、`revenue-profit-drivers`、`products`、`technologies`、`industry-exposure`、`supply-chain`、`competition`、`financial-quality`、`growth-drivers`、`management-capital-allocation`、`catalysts`、`risks`、`valuation`、`bull-base-bear`、`variant-perception`、`investment-thesis`、`monitoring-checklist`。前述 17 项通过，最后两项质量失败。

### 可读性与证据定位

两份 Markdown 的 17 个通过章节都不是空模板：包含经营和财务综合、反证与限制、估值输入口径、投资论点以及跟踪指标。报告区分期间流量与时点存量，也保留分部口径差异。三情景章节清楚说明缺少经营假设，预期差章节明确指出估计版本未验证；两处都没有用无来源数字补齐。投资结论另行标出当前能支持的经营逻辑和主要反证。

对正文中符合来源 ID/段落号格式的引用做了逐项匹配：BYD 1,365 次、东山精密 1,518 次，均能在对应 section 的 `evidenceLocations` 找到同一 `sourceCandidateId + locator`，未发现未解析引用。两报告顶层 `sourceRefs` / `claimRefs` 为空；章节级来源位置存在且已解析，因此没有将顶层空数组误判为章节缺少来源。两报告的 `bull-base-bear` 没有证据定位，这与其失败原因一致。

### asOf 与报价资格限制

两份报告的市场报价证据不能按当前归档证明为报告 `asOf` 时已取得：

| 公司 | 报告 `asOf` | 报价观测日 / 数值 | 报价 `retrievedAt` | 相对 `asOf` |
|---|---|---|---|---:|
| BYD 002594 | `2026-10-27T20:19:59.628Z` | 2026-10-27 / CNY 82.01 | `2026-10-27T20:20:02.952Z` | +3.324 秒 |
| 东山精密 002384 | `2026-10-27T20:26:46.347Z` | 2026-10-27 / CNY 101.09 | `2026-10-27T20:26:49.604Z` | +3.257 秒 |

两处报价证据的原始来源 ID 均为 `akshare-tencent-historical-market-data`。虽然 observation date 和嵌入的 `asOf` 与报告同日/同时间，检索时间晚于报告截面，故该记录不能作为已证明的 `asOf` 可用值。归档章节却将 `valuation_market_price` 标记为 `AVAILABLE(PIT=safe, valueVersion=not-proven)`。这构成 PIT 声明与时间戳证据之间的未解决冲突。

本报告的 `PERSONAL_RESEARCH_READABILITY_READY` 只表示经营研究正文和未通过章节说明足以供个人阅读；不代表数据或估值已通过 PIT 验收。不得依赖上述价格或其派生参考 PE 作 `asOf` 估值结论。未修改历史报告中的 PIT 声明或市场数据，`P0-19` 仍为 `NOT_ACCEPTED`。

## 最小渲染调整

审阅前，Company Research Markdown 在章节正文之前直接展开原始 `researchQuality.issues` 代码，读者先看到重复的机器诊断，而不是 19 个章节中的真实研究内容。现已仅调整 Markdown 呈现：

- 报告顶部改为“完整研究验收：通过/未通过（完成数/要求数）”；
- 对失败的 Bear/Base/Bull 与预期差章节给出具体缺口说明；其他未知失败章节使用有边界的通用说明；
- 完整原始 issue 代码仍保留，但移到章节末尾的“质量检查明细（审计）”；
- 章节标题/顺序、正文、定位证据、JSON 结构、校验逻辑和其他 report type 的既有呈现不变。

该调整让读者先看到完整的研究正文及真实验收状态，仍可在文末审计原始失败代码；不放宽门槛，也不把 17/19 表述为通过。

## 验证结果

| 验证 | 结果 |
|---|---|
| `node --import tsx --test tests/app/services/research-report.test.ts` | 通过，17/17；冻结版本中的 13 个原测试均保留，新增 4 个用例。覆盖 17/19 两个具名缺口、19/19、未知失败章节、无质量元数据、非 Company Research 兼容性、章节顺序、证据定位和原始 issue 顺序 |
| `npm run typecheck -- --pretty false` | 通过，`tsc --noEmit` 退出码 0 |
| `git diff --check` | 通过；Git 对既存用户 JSON 文件提示 LF/CRLF 工作副本警告，没有空白错误 |
| 两份归档报告实际重渲染 | 通过；读取既有 `report.json`，分别写入系统临时目录 `rhl-p0-converge-*`，校验 19 个章节顺序、17/19 状态、两处缺口与末尾审计附录。归档路径未写入 |
| 全量 Node / Client 回归 | `NOT_RUN`。本任务安全边界不允许执行可能触碰归档或外部模型的全量流程；没有重新建立可复用的全量基线，故不声称相对历史失败基线有回归结论。任务书记录的历史失败数（Node 21、Client 5）不视为本轮新增或复测结果 |

未运行公司研究模型，也未写入 Knowledge。没有新增数据源调用。

## 文件完整性

以下 15 个归档文件在审阅/测试前后均已计算 SHA-256，前后相同；本轮没有改变归档内容：

| 文件 | SHA-256（审阅前 = 审阅后） |
|---|---|
| `002384-analysis.json` | `72588193FAFF4C2E75FB2E07C0B07197619B8C23B9FA49F843E7F05AE34E98B3` |
| `002384-bundle.json` | `691F3F561B02523F00865F574F6FD373B202C9DAD98502ABBD61FA3B5958067F` |
| `002384-company-research-002384-860916a8-4958-4d29-8da1-56ad5dd1c2c6.md` | `3C14D4FBB29AEE31BC434B9C99B98DE3E79F6897581C4519A46AA87F236EB91F` |
| `002384-kb-integrity.json` | `4322CD0B20C70C400615987B06DE5D400E45FECC7676CAC11CCCFD5678FF1F0A` |
| `002384-report.json` | `6FA63686B889150551B42EAB66B3CE32F4246871F5A3D4BE99117D0E0D8917D4` |
| `002384-started.json` | `716537E8348F69818FFDC128970E509ED77B367443DC1D4A12292E2D972F87DF` |
| `002384-workflow.json` | `0CF91DFA99A0CA0B1DAFF3B8711E5E29AB1F07C1D693CFA7F986999ADC718EBD` |
| `002594-analysis.json` | `60C877932829D114EB02AF13304402EC5599B4410DF5BC63926F4F646489DE35` |
| `002594-bundle.json` | `1FD11C5F5E7764D23BD4950712FAF056EFEFF09436DD983635B24C156A7A8739` |
| `002594-company-research-002594-82bcc425-d48d-4e55-bc45-111aa8c28ba4.md` | `0F83C1CD96F5962402EAE69503E2C53CDF76E16F01A6ACF2F0324E986A036604` |
| `002594-kb-integrity.json` | `4322CD0B20C70C400615987B06DE5D400E45FECC7676CAC11CCCFD5678FF1F0A` |
| `002594-report.json` | `2867B270318B21E334C28246935326DAB19FA734C094253BB80637B2C32390C1` |
| `002594-started.json` | `7F1B87714DEA542920E07235206AF7DB367ABFC9F58CB4D043328C49DCB6FEF1` |
| `002594-workflow.json` | `43316166217675DF70473ED86CF646FA988DD3DFC53BE6C4E75F7F32BF6FF7F6` |
| `summary.json` | `E9999CF1FF2173C1CE5D87387ABB0C65D9473426B5334547285499F0F51F9228` |

以下五个本地未提交用户 JSON 文件在操作前后也保持相同 SHA-256，未暂存、未修改：

| 用户文件 | SHA-256（操作前 = 操作后） |
|---|---|
| `RHL-EXEC-003-A-004-FIX-002-thesis-authorized.json` | `7252FD35DEC70403FD6BB8B3EDC6FFADD25211FD158461A1DDE30458BF07F442` |
| `RHL-EXEC-003-A-004-FIX-003-event-readonly.json` | `EF0E7475E0464CA1E3950FEB348B0D3ED6DC7383E32200FAA3FC413207BC641A` |
| `RHL-EXEC-003-A-004-FIX-003-industry-readonly.json` | `12C951BE5CA88FB35B155187055B0A15A50D212133C9B68088C0D1674500C0FA` |
| `RHL-EXEC-003-A-004-FIX-003-thesis-references.json` | `61CD5CF5B24A7F0FC10746E0269A845D6E29464614C43738D7585EC075FB4670` |
| `company-quality-pi-default-deny.json` | `4C02302A5B31CEC6D93B9298E06A76BD0B834B4BACC914670C7FD06AA6300038` |

## 下一轮授权要求

任何新研究运行都必须先得到 `NEXT_RUN_APPROVAL_REQUIRED`：

- 用户确认所采用的 T0/asOf 规则，以及可接受的报价检索时间边界；
- 用户明确批准模型/Reviewer 调用预算与成本。本轮没有可确认的调用成本；
- 用户授权范围仅为只读研究、禁止 Knowledge 写入；
- 所需来源必须满足原子 Skill / SourcePolicy 对 period、版本、发布时间、定位和许可的既有要求。

本报告没有请求新的数据源、T1 实施或方法论变更。若上述授权或字段证据不足，维持当前阻断状态，不重跑模型。

## `NOT_INSPECTED`

以下归档载荷只计算 SHA-256，未解析其内容：`002384-bundle.json`、`002384-started.json`、`002384-kb-integrity.json`、`002594-bundle.json`、`002594-started.json`、`002594-kb-integrity.json`。完整性核验不代表对这些载荷内容作结论。
