# RHL-EXEC-003-A-002 — Valuation Live Data

**状态：** IMPLEMENTED / SOL ACCEPTANCE PENDING  
**分支：** codex/exec-003-a-002-valuation-live-data  
**实现提交：** fe9443d4e3242d7f08b7572d8ce0159b7a2c09fe  
**基线：** ddac2ddb61b60739ffd6de4cb892eeb7d057f6dc  
**日期：** 2026-10-10

## 目标与边界

为估值 Workflow 接通真实 Industry/Company 数据获取、DataResolver source policy、结构化财务证据和官方年报发布证明。保持估值计算确定性，遵守来源归属、PIT 与 Knowledge 写入边界。不引入新 Provider/Capability 框架，不合入 main。

## 实现

- 为估值市场价格配置 EastMoney 主来源及 Tencent FALLBACK_1；Tencent AKShare 路径按 SH/SZ 校验身份，并返回未复权日线。
- 市场查询限制在估值日之前 30 天。规范化日期字段兼容秒/毫秒 Unix 时间，避免毫秒时间戳被误识别成历史年份。
- DataResolver 的来源元数据贯穿 market evidence、Workflow source 与报告，保留实际 publisher、source ID、provider、URL、抓取时间和观察可用时间。
- EPS、BVPS 与 CNINFO 年报证明按候选年度解析，只有年度匹配且发布时间不晚于估值时点的官方报告，才构成官方发布证明。最多尝试两个候选年度。
- 把市场传输、财务依据传输和官方发布验证状态分开记录。companyBasic 仅作遥测，不作为估值证据。
- 当前数据明确标记为 CURRENT_VALUE_ONLY。CNINFO 的正式年报发布证明不能证明聚合商历史数值版本；固定历史时点下，没有 numeric value-version 证明的 EPS/BVPS 不参与计算。
- AKShare 子进程错误经过限长清理，避免把完整桥接脚本回显到诊断信息。安全证券目录查询超时上限从 15 秒提高到 30 秒，以覆盖实测响应时间。

## 来源策略与真实来源结果

真实 AKShare 版本为 1.18.64，运行环境 pandas 3.0.3。

| 路径 | 结果 | 处理 |
|---|---|---|
| EastMoney 市场主来源 | 代理连接错误，访问 push2his.eastmoney.com 失败 | 记录来源尝试错误；不伪造成功 |
| Tencent 市场回退 | 两个 A 股样本均返回真实日线 | 通过 DataResolver 选择，保留 Tencent/AKShare 归属 |
| EastMoney EPS/BVPS | 返回年度结构化数据 | 只作为 S3 聚合商数据；历史数值版本仍未验证 |
| CNINFO | 返回对应年度正式年报及公告 PDF | 用于验证发行人、年度及官方发布时间 |
| EastMoney companyBasic | 代理连接错误 | 仅诊断遥测；不阻断已成功的 market/financial basis |

**样本 002487.SZ 大金重工：** Tencent 收盘价为 43.75 CNY，交易日 2026-10-09；EPS 1.73、BVPS 12.9836121393，年度为 FY2025。CNINFO 证明为《2025年年度报告》，公告号 1224997956，发布时间 2026-03-05T16:00:00Z，来源 [CNINFO PDF](https://static.cninfo.com.cn/finalpage/2026-03-06/1224997956.PDF)。当前估值 PE 25.2890、PB 3.3696。历史数值版本未验证。

**样本 600519.SH 贵州茅台：** Tencent 收盘价为 1263 CNY，交易日 2026-10-09；EPS 65.66、BVPS 195.3554497279，年度为 FY2025。CNINFO 证明为《贵州茅台2025年年度报告》，公告号 1225114741，发布时间 2026-04-16T16:00:00Z，来源 [CNINFO PDF](https://static.cninfo.com.cn/finalpage/2026-04-17/1225114741.PDF)。当前估值 PE 19.2355、PB 6.4651。历史数值版本未验证。

不把 production 误作 capacity，不把 export 误作 demand；冲突值不求平均。没有匹配行业/指标或来源的情况保持 unavailable/gap，不补造数据。

## 生产链路验证

### 真实来源应用链

已运行真实的 ResearchDispatchService.startAsync → ResearchService → Industry/Valuation Workflow → DataResolver → SourcePolicy/Catalog → AKShare Plugin + CNINFO → Skill → ResearchReport/ResearchBundle。

- 002487.SZ run：f2cda8b8-87f0-4e1c-8d71-964d76809fbd
- 600519.SH run：590dee09-0046-4858-b855-a96f657bb8a4
- 两次均 completed；市场和年度财务数据来自真实来源；CNINFO 年报证明已解析；PE/PB 与九格敏感性计算均通过确定性重算。
- 测试运行隔离 Knowledge Base，writeKnowledge=false，canonical object count 为 0；没有写入正式 Knowledge。
- 002487 自动可比公司路径有 3 个 peer；600519 的自动可比公司因 TARGET_SCALE_UNAVAILABLE 保持不可用。

### 实际 Pi ModelRuntime

另运行真实 Pi ModelRuntime（zhipu-openapi/glm-5.3-flash）的异步生产应用链，workflow run 7c481a11-e5fc-4fd1-af8c-e27e58a890c8，实际市场/财务/CNINFO 传输成功，报告及 ResearchBundle 均完成。

- 模型完成并应用了 valuation_assumption_design；Bear/Base/Bull 三个情景、九格敏感性均由代码计算，并通过确定性重算。
- 语义身份解析返回格式不符合约束，使用确定性解析回退。
- valuation_synthesis 的模型调用超时，校验未通过，使用确定性回退；没有模型生成的解释性章节或被接受的 proposal。
- Knowledge 写入关闭；canonical source/claim count 均为 0。
- 因而真实模型链路为 **部分通过**，不宣称完整模型综合阶段已通过。实时来源及确定性估值链路本身已通过。

## PIT 与方法边界

- 最新市场收盘仅在其日线可用时间之后纳入。
- 官方年度报告在估值时点之后发布时，固定时点请求拒绝该财务年度。
- 发布日在估值时点之前，但数值缺少历史版本证明时，数值可展示为来源数据但不能成为固定历史估值的计算依据。
- EPS/BVPS 单位按 CNY/share；只选取匹配年度的年度值，不把 Q1/H1/Q3 数据当作全年值。
- PE/PB 仅在正值 basis 上开放；EV/EBITDA 因净债务/股数基础不完整而不可用；DCF 在 v1 明确 deferred。
- 来源冲突拒绝静默融合或平均；证据保留各自来源链。

## 验证结果

- 聚焦插件/估值测试：119/119 通过。
- npm run typecheck：通过。
- npm run client:typecheck：通过。
- npm run client:build：通过；Vite 报告主 JS chunk 超过 500 kB 的既有体积提示。
- git diff --check：通过；Git 提示工作树 LF 将按 Windows 配置转换为 CRLF。
- 完整 npm test：Client 122/122 通过；Node 共 2176 项，2155 通过、21 失败。对干净基线执行比较：基线 2169 项、2147 通过、22 失败；本分支没有新增失败，21 项失败均与基线失败重合，另有一项基线失败不再出现。既有失败涉及 Research Skill 元数据、Theme 投影、competition-module gateway 与 validation snapshot/兼容性。
- 本次提交后重新执行的聚焦测试与 typecheck 均通过。

## Git 交付

实现提交：fe9443d4e3242d7f08b7572d8ce0159b7a2c09fe。基线是 origin/main 的祖先；本任务没有合入 main。

**待完成交付步骤：** 将本报告提交到同一任务分支，推送该分支，并核对远端 branch HEAD 与最终交付 SHA 一致。Sol acceptance 尚待进行。

## RHL-EXEC-003-A-002-FIX-001 — Valuation Report Provenance & Market Freshness

**状态：** IMPLEMENTED / SOL ACCEPTANCE PENDING
**基线：** `ddac2ddb61b60739ffd6de4cb892eeb7d057f6dc` (`origin/main`)
**实现：** 本节对应当前任务分支待交付的实现与验证；本节报告提交 SHA 以最终 Git 记录为准。

### Root causes

- Valuation 报告仅投影了部分 basis 字段，没有把已验证身份、完整来源归属、官方公告、PIT/value-version 边界和新鲜度一起保存在报告中；只读报告的 JSON/Markdown 不能完整复核外部来源。
- 报告依赖经验证的情景方案展示倍数；无方案时遗漏了仍可由价格和 FY basis 确定计算的当前 PE/PB。
- 市场规范化按日期取最新 bar，未同时执行 `priceDate`、上海收盘可用时间、请求 period end 和精确 `analysisAsOf`；也没有区分一个正常漏更交易日与长时间停牌/陈旧行情。

### Implementation and rules

- Valuation Snapshot 与 Data Basis/PIT 章节现在展示已验证公司名、代码/交易所、估值时间、收盘价/日期/币种/复权方式、行情发布方和检索方、来源 ID/URL、FY 和报告期间、EPS/BVPS 数值/单位及各自独立来源、CNINFO 年报标题/发布时间/公告 ID/URL、PIT 与数值版本状态。
- `ResearchReportSection.evidenceLinks` 只接受 HTTPS URL。只读模式保留外部链接，但不写入或伪造 Canonical Source/Claim refs；Markdown renderer 仅对 Valuation 输出外部证据链接。磁盘 JSON 与 Markdown 重载测试均通过。
- PE/PB 从通过验证的 basis 确定性计算，不依赖 LLM。缺少可验证 assumption plan 时，当前 reference multiples 仍显示；Bear/Base/Bull、目标价和情景敏感性明确不可用。
- Tencent 行情和 EastMoney 财务指标分别归属；CNINFO 只证明官方公告的标题、发行人、年度和发布时间，不被用作 EastMoney 数值历史版本的证明。
- 收盘选取要求 `priceDate <= requested period end` 且 `dailyCloseAvailableAt(priceDate) <= analysisAsOf`。Workflow 传递完整时点，不截断到日期。新鲜度优先按 AKShare/Sina 交易日历计数：允许漏过一个已完成交易时段，第二个及更多已完成交易时段未更新时标记陈旧；无有效日历时，最多只把三日以内的短日历间隔标为可用，较长缺口标记不可验证并 fail closed。周末、已知假期不被算作漏过的交易日。DataResolver 是最终 freshness/PIT gate；陈旧主源可触发备用源，陈旧主备源均阻断估值。
- `data-layer-valuation-earnings.test.ts` 的市场 fixture 加入显式 freshness metadata，继续独立验证 observation date、close availability、period 与分析 cutoff，不将缺失 freshness 证明误当作合格来源。

### PIT and deterministic regression evidence

定向集合包括新鲜度、resolver、插件和 Valuation Workflow 测试，并覆盖收盘前/后、周末、交易所假期、连续停牌/陈旧行情、缺交易日历、未收盘当日 bar、未来 bar、固定历史 asOf、EastMoney 主源、陈旧主源到新鲜 Tencent 回退、主备源均陈旧并阻断报告、只读报告重载、无 assumption plan 下当前 PE/PB，以及不伪造 Canonical refs。最新定向运行：

```text
tests/data/valuation-market-freshness.test.ts
tests/workflows/data-layer-valuation-earnings.test.ts
tests/workflows/valuation.test.ts
148/148 passed
```

测试覆盖新鲜度、acquisition Plugin、basis/evidence、DataResolver、generic market PIT 和 Valuation Workflow。最终全量 `npm test` 已完成；对比同 SHA 的干净 `origin/main`：

| Run | Node + Client | Passed | Failed |
|---|---:|---:|---:|
| `origin/main` (`ddac2ddb61b60739ffd6de4cb892eeb7d057f6dc`) | 2169 | 2146 | 23 |
| FIX-001 working tree | 2180 | 2159 | 21 |

当前 21 个失败 test identifiers 全部存在于基线，当前独有失败为 **0**。基线的 `cancellation during durable preview persistence reports an unknown state without claiming a commit` 和 `V65 source acquisition time is distinct from historical valuation context` 在修复分支本次全量运行中未复现。基线与本分支共有的 21 项失败涉及 Research Skill 元数据、Theme 投影、Competition Module Gateway 和 FIX-015 evidence-size snapshot。完整测试日志保存在本机临时目录，未加入仓库。

`npm run typecheck`、`npm run client:typecheck`、`npm run client:build`、`git diff --check` 均通过。Vite 仍报告现有 client JS bundle 大于 500 kB 的 warning。

### Real AKShare/CNINFO Application E2E and read-only reload

使用隔离 Schema 0.4 Knowledge Base 和 deterministic no-plan reasoning executor，通过真实 `ResearchDispatchService.startAsync → ResearchService → Valuation Workflow → DataResolver → Catalog/SourcePolicy → AKShare Plugin + CNINFO → Skill → ResearchReport/ResearchBundle` 生产路径执行。两次行情均由 EastMoney 市场请求失败后，DataResolver 选择 Tencent/AKShare 日线；FY 财务数值来自 EastMoney，官方报告由 CNINFO 交叉验证。真实运行证据、Markdown/JSON 报告摘录和链接保存在 `tests/validation/evidence/RHL_EXEC_003_A_002_FIX_001_REAL_E2E.json`。

**002487.SZ 大金重工** — runId `24868eb0-7788-4027-b01d-c2fa66cfc753`，Report `valuation-002487-2026-24868eb0-7788-4027-b01d-c2fa66cfc753`，Bundle `research-bundle-24868eb0-7788-4027-b01d-c2fa66cfc753`。报告重载后显示：

```text
Tencent / AKShare, 2026-10-09 close 43.75 CNY/share, UNADJUSTED; freshness FRESH (0 completed sessions missed; AKSHARE_SINA calendar).
FY2025 EPS 1.73 CNY/share and BVPS 12.9836121393 CNY/share; both publisher EastMoney.
CNINFO: 2025年年度报告, announcement 1224997956, published 2026-03-05T16:00:00Z.
Current PE 25.2890173410; current PB 3.3696323897. PIT = CURRENT_VALUE_ONLY; numeric value-version = UNVERIFIED.
```

**600519.SH 贵州茅台** — runId `bf59e0bb-4125-413d-84cc-62b4cdaa9201`，Report `valuation-600519-2026-bf59e0bb-4125-413d-84cc-62b4cdaa9201`，Bundle `research-bundle-bf59e0bb-4125-413d-84cc-62b4cdaa9201`。报告重载后显示：

```text
Tencent / AKShare, 2026-10-09 close 1263 CNY/share, UNADJUSTED; freshness FRESH (0 completed sessions missed; AKSHARE_SINA calendar).
FY2025 EPS 65.66 CNY/share and BVPS 195.3554497279 CNY/share; both publisher EastMoney.
CNINFO: 贵州茅台2025年年度报告, announcement 1225114741, published 2026-04-16T16:00:00Z.
Current PE 19.2354553762; current PB 6.4651382992. PIT = CURRENT_VALUE_ONLY; numeric value-version = UNVERIFIED.
```

Both Application results completed. In both reports, JSON `workflowRunId`, ResearchBundle `workflowRunId`, and returned runId matched; the separately persisted Markdown and JSON were read back. Each isolated Knowledge Base had 0 Entity, 0 Source, and 0 Claim both before and after (`writeKnowledge=false`); report canonical source/claim refs were empty while real HTTPS evidence links remained. CNINFO links and external data URLs are present in the evidence artifact. The report explicitly avoids claiming historical numeric-version proof.

### Remaining limits

- Real network attempted and succeeded for the two sample companies; EastMoney market transport was unavailable in this environment, so the real runs exercised the configured Tencent fallback. EastMoney-primary selection is covered by deterministic DataResolver tests.
- Market freshness permits one missed completed exchange session by explicit rule. A larger gap without a trustworthy trading calendar remains unverifiable and blocks valuation; actual halted securities cannot be labeled fresh from a stale returned bar.
- EPS/BVPS numeric value-version remains unverified even though FY and official publication evidence are present. Reports are correctly labeled `CURRENT_VALUE_ONLY`; fixed historical valuation cannot treat CNINFO publication metadata as numeric-version proof.
- No merge to `main` is part of this task. Sol acceptance remains pending.

### FIX-001 delivery

Source, regression tests, real E2E runner, and this report are to be committed and pushed to `codex/exec-003-a-002-valuation-live-data`. Final branch SHA and clean worktree are recorded after push below.

