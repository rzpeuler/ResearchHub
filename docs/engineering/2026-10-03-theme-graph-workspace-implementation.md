# Theme Framework 与 Knowledge Graph 工作台实施记录

日期：2026-10-03  
分支：`codex/theme-graph-workspace`  
依据：[设计规格](../superpowers/specs/2026-10-02-theme-knowledge-graph-workspace-design.md) 与[实施计划](../superpowers/plans/2026-10-02-theme-graph-implementation.md)

## 已交付的实现范围

以下记录表示对应代码路径已实现；不等同于真实资料端到端验收完成。

| 阶段 | 已实现能力 | 主要代码边界 |
|---|---|---|
| A1–A2 | Schema 0.4 competition Module 契约；Gateway 将行业研究的表格提案解析为 canonical Module 写入，并保留公司、证据及度量口径约束。 | `knowledge/schema/`、`knowledge/production/` |
| A3–A4 | 默认 ThemeGroup、Theme 创建／管理及范围决定 ledger；include／exclude／pending 按 revision 和证据持久化，纳入范围与 canonical exposure 经 ChangeSet／Writer 提交。 | `knowledge/production/theme-management-v04.ts`、`knowledge/governance/theme-scope-*`、`knowledge/writer/writer-v04.ts` |
| A5 | Chat 文件上传可走 Schema 0.4 Raw／Source 与 Knowledge Production 路径，上传本身不要求 Theme。 | `app/runtime/`、`app/services/`、`client/` |
| B1–B2 | Theme Framework Skill 与构建 Workflow；按名称创建 Theme 候选，研究边界节点／关系，Chat 展示持久化候选并支持人工逐项决定，接受后再经受治理写入。推理通过专用 Codex CLI `gpt-6-luna` high 执行。 | `skills/theme-framework/`、`workflows/theme-framework-construction/`、`app/services/theme-framework-service.ts`、`client/` |
| C1–C3 | Industry Research 输出可更新的 competition landscape；Theme workspace 只读投影按已确认范围组织图谱和研究章节；Industry／Company 研究结果暴露本轮 created/updated refs 与 revision，供后续影响检查使用。 | `workflows/industry-research/`、`app/services/theme-workspace-projection.ts`、`app/services/research-service.ts` |
| D1–D2 | `/graph` 主题工作台及 Chat 上传交互；图谱范围由已确认 Theme 决定，Theme 目录、图、产业／公司信息和观点／时间链联动。上传支持 Chat 输入区，不再依赖常驻附件侧栏。 | `app/runtime/server.ts`、`app/services/theme-workspace-projection.ts`、`client/` |
| D3 | 成功 Writer 写入后，按变化 refs 查询受影响 Theme 并生成持久化人工提案；Chat 提供收件箱。批量 include／exclude／pending 经单个 ChangeSet／Writer revision 原子提交，可覆盖多个 Theme；精确重放可恢复，旧 revision／证据／候选不匹配时阻断。拒绝/关闭提案只做 dismiss，不记作 A4 exclude。 | `workflows/theme-scope-impact-check/`、`app/services/theme-scope-impact-service.ts`、`knowledge/production/theme-scope-impact-acceptance-v04.ts`、`app/runtime/server.ts`、`client/` |

## 运行时接口

写接口要求 Runtime token 和匹配的 Origin；受 token 保护的敏感 GET 要求 Runtime token。此类 GET 若未携带 Origin，服务端以配置的 expected Origin 校验；若请求显式提供了跨 Origin 值则拒绝。当前实现包括：

- `POST /api/theme-framework/start`：按 Theme 名称启动构建 Workflow。
- `GET /api/theme-framework/runs/:runId`：读取候选；`POST .../accept` 与 `POST .../reject`：确认或拒绝首次框架。
- `GET /api/theme-scope-impact?limit=...`、`GET /api/theme-scope-impact/records/:receiptKey`：读取影响提案收件箱及记录。
- `POST /api/theme-scope-impact/records/:receiptKey/decisions`：对记录中的全部未 dismiss 提案提交原子批量决定，决定为 include、exclude 或 pending。
- `POST /api/theme-scope-impact/records/:receiptKey/proposals/:proposalId/dismiss`：关闭单项提示，不更改 canonical Theme 范围。

Theme Framework 与 Theme scope 接口由 `app/runtime/server.ts` 注册。浏览器端不能直接修改 Knowledge；canonical 变更仍经过服务端验证、ChangeSet 与 Writer。

## 可复核验证

在本记录编写时的 `HEAD=3160f77` 上独立执行：

- `npm run typecheck` — 通过（`tsc --noEmit`）。
- `npm run client:typecheck` — 通过（客户端 TypeScript 检查）。
- D3 多 Theme 单 revision、精确重放及 stale conflict 的确定性覆盖位于 `tests/knowledge/theme-scope-impact-acceptance-v04.test.ts`；HTTP 路由覆盖位于 `tests/app/runtime/theme-scope-impact-routes.test.ts`。本次文档核验没有运行 Node 测试套件，因此不在此记录测试通过结论。

## 真实验收状态与限制

- 隔离的空 Schema 0.4 KB 已从 bounded acquisition 获得一条相关 CPCA Source/Raw。Theme Framework fix3 产出 3 个待人工处理节点、0 条关系；这不是已接受的 canonical 产业网络。
- 本轮资料获取中 Eastmoney 连接以 socket closed 失败，MIIT 与政府来源返回 0 项。当前真实运行不足以证明完整上下游覆盖、交叉关系或独立节点质量。
- 浏览器复核确认：修复后新建 Chat 的 Theme scope 收件箱可正常加载，不再出现认证错误；真实 KB 的 `/graph` 显示空 Theme 状态，等待人工确认。这只验证了空状态和收件箱加载，没有验证已确认产业图谱。
- 用户本机西部证券 PDF 的 AI 处理／衍生知识／保留权限尚未得到确认，因此尚未解析并写入该 PDF，也没有真实 PDF 知识写入证据。
- 尚未完成真实浏览器从知识写入到已确认图谱刷新和 D3 人工决策的端到端闭环；E 阶段验收未完成。本分支也尚未合入或推送 `main`。

因此，A1–D3 的实现基础已经落地，但本项目目标仍处于“实现完成、真实数据与产品闭环验收待完成”阶段。不能将当前 KB 或 fixture 测试表述为完整 Graph 产品验收。
