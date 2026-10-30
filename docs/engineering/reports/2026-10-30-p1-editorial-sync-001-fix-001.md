# P1-EDITORIAL-SYNC-001 FIX-001 — 恢复综合 Prompt 数值与证据边界

**任务:** `P1-EDITORIAL-SYNC-001 / FIX-001`
**状态:** `READY_FOR_CTO_REVIEW`
**产品状态:** `P1_PRODUCT_NOT_ACCEPTED`
**模型调用:** `0`
**研究 Workflow / Knowledge 写入:** `未执行`
**合并 main:** `未执行`

## 交付基线

- PR #10 分支：`codex/p1-editorial-synthesis`
- 修复前 HEAD / PR HEAD：`b5addb55b808fca1132f0792a8125262855e6e27`
- 对照前同步版本：`8956f0a511f3f2fa0eaa075ee16a0371515959a1`
- 当前 main 基线：`7eeb2e09bdbcd68ba60ea87d5e1a37550a4ba0d2`
- 隔离 worktree：`C:\Users\Administrator\AppData\Local\Temp\rh-p1-editorial-sync-001-candidate`
- 修改范围：综合 Prompt 两处文本、对应确定性测试、新增本报告。

## 已复现的 Prompt 冲突

修复前，发给最终 `company_research_synthesis` `ReasoningExecutor` 的 instruction 包含以下绝对禁止语句：

> 所有核心判断及跟踪项均用定性事实表述，不在这两节抄录数字、百分比、日期或带数字的技术型号；把数值细节留在已完成方法章节，并以准确定位引用。

同一 instruction 前缀 `P1_EDITORIAL_PRIORITY` 已要求：

> 综合两节以定性解释为主；当少量直接披露的关键数值能实质说明主导经营驱动、最强反证或风险暴露时，应保留该数值及其指标、口径、期间、单位和精确引用。

因此，最终 executor 收到一项允许决定性核验数字、同时禁止任何数字的内部冲突要求。

修复前的跨方法段落还要求：

> 凡已有精确行和定位，必须把披露事实、期间、单位及其直接引用整合到相应论点或监控项，不得把事实遗漏再写成资料缺失。收入驱动须分别列出已披露的分行业/分产品收入金额与占比……

这把完整披露表逐项移入论点/监控章节，与 `8956f0a` 已确立的“方法章节保留完整披露，综合章节选择关键事实”边界冲突。

## 修复后 Prompt 证据

最终 instruction 现在使用以下条件性规则，不再包含“不在这两节抄录数字、百分比、日期或带数字的技术型号”禁令：

> 两节以定性解释为主，只有少量直接披露且经本轮证据核验的关键数值能实质说明主导经营驱动、最强反证或风险暴露时才纳入，并同时标明指标、口径、期间、单位和精确引用；不得复抄方法章节的完整数据表或重复同一数值。

跨方法边界恢复为：

> 已有精确行和定位时，方法章节须保留相应完整披露事实、期间、单位和直接引用；investment-thesis与monitoring-checklist从这些已核验事实中选择能实质说明主导驱动、最强反证或风险暴露的关键事实和直接披露数值，并给出指标、口径、期间、单位及精确引用。不得把未选入综合章节的已披露事实误写成未披露。收入驱动方法章节须分别列出已披露的分行业/分产品收入金额与占比；综合章节无需复抄完整数据表或重复同一数值。

以上恢复文本与 `8956f0a` 对应规则一致；`P1_EDITORIAL_PRIORITY` 原有层级和规则未改动。

## 回归断言与安全边界

- 恢复原有 Prompt 回归断言，分别要求条件性关键数值规则、方法章节完整披露、综合章节只选关键事实，以及无需复制完整数据表。
- 新增确定性测试捕获实际传给 `ReasoningExecutor.execute` 的最终请求，断言它包含两条正确规则，并排除两类旧冲突语句。测试使用本地 fake executor，不调用模型。
- `valuation-sections.ts`、`workflow.ts`、估值安全测试及估值证据集成测试与 `origin/main` 字节一致。PIT、rights、EPS 财年、PE、证据账本和最终输出资格逻辑均未改动。
- 完整 Node 测试短暂重写了隔离 worktree 中 5 个已跟踪的合成测试证据 JSON；这些文件在测试前为干净状态，已恢复到 HEAD。没有提交这 5 个文件。根 checkout、P0 归档、Knowledge 和原 P1 worktree 的前后清单 SHA 均未变化。

## 验证结果

| 验证 | 结果 | 日志 SHA-256 |
| --- | --- | --- |
| 三组聚焦 Node 测试：Assembly / Valuation Sections / Valuation Evidence Integration | 151/151 通过 | `FDC6A0FE53CE1D48A0D38E88DACFEA0BE779B32476D642964F806F71BBF66A8A` |
| `npm run typecheck` | 通过 | `E5046545A3A9FCC0CF6950C9402C78A2B227F07A6A658D2A0C1FBC5F4A194DA0` |
| `npm run client:typecheck` | 通过 | `EB57B2C01C9900BAB000B136214DA05438159CD3A3917BB35F0629E5D81D331E` |
| `npm run client:build -- --configLoader runner` | 通过；保留既有 >500 kB chunk 提示 | `BCBCDF5A592C0619E754EF96B9E8907374DA640CF6E3852769169742EA4DE707` |
| `npm run test:node` | 3,300 通过 / 21 失败，共 3,321；21 个失败名称与 clean-main 的 21 个完全一致 | `34D44E0C46806462BAB215F1ACC58D96A2CDE6F35E8F23CAD54F7F6CC6FC127E` |
| `npm run client:test -- --configLoader runner` | 223 通过 / 5 失败，共 228；5 个失败名称与 clean-main 的 5 个完全一致 | `55D644012173A228B9937D39B6918ACE05016A13A2F201AB3CFE7A5A0D34BEFB` |
| `git diff --check` | 通过 | 无空白错误 |

clean-main 基线来自本任务先前只读记录的 `s0-main-node.log`（3,299/21，共 3,320）和 `s0-main-client.log`（223/5，共 228）。Node 本轮增加的 1 项即新增的 Prompt 冲突回归测试；没有新失败身份。

## 交付状态

本修复只恢复编辑指令与证据归属边界，不构成产品质量验收。PR #10 继续保持开放且不合并；P1 状态为 `P1_PRODUCT_NOT_ACCEPTED`，等待 CTO 验收。
