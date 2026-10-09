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

