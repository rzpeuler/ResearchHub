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
| A5 | Chat 文件上传可走 Schema 0.4 Raw／Source 与 Knowledge Production 路径，上传本身不要求 Theme。默认挂载 Schema 0.4 KB 且未注入自定义 executor 时，Raw preview 在首次运行时惰性创建专用 Codex CLI `gpt-6-luna` high executor；executor 不可用时 Workflow 明确 blocked。 | `app/runtime/application-runtime.ts`、`app/pi/model-selection.ts`、`app/services/production-service.ts`、`client/` |
| B1–B2 | Theme Framework Skill 与构建 Workflow；按名称创建 Theme 候选，研究边界节点／关系，Chat 展示持久化候选并支持人工逐项决定，接受后再经受治理写入。推理通过专用 Codex CLI `gpt-6-luna` high 执行。 | `skills/theme-framework/`、`workflows/theme-framework-construction/`、`app/services/theme-framework-service.ts`、`client/` |
| C1–C3 | Industry Research 输出可更新的 competition landscape；Theme workspace 只读投影按已确认范围组织图谱和研究章节；Industry／Company 研究结果暴露本轮 created/updated refs 与 revision，供后续影响检查使用。 | `workflows/industry-research/`、`app/services/theme-workspace-projection.ts`、`app/services/research-service.ts` |
| D1–D2 | `/graph` 主题工作台及 Chat 上传交互；图谱范围由已确认 Theme 决定，Theme 目录、图、产业／公司信息和观点／时间链联动。上传支持 Chat 输入区，不再依赖常驻附件侧栏。 | `app/runtime/server.ts`、`app/services/theme-workspace-projection.ts`、`client/` |
| D3 | 成功 Writer 写入后，按变化 refs 查询受影响 Theme 并生成持久化人工提案；Chat 提供收件箱。批量 include／exclude／pending 经单个 ChangeSet／Writer revision 原子提交，可覆盖多个 Theme；精确重放可恢复，旧 revision／证据／候选不匹配时阻断。拒绝/关闭提案只做 dismiss，不记作 A4 exclude。 | `workflows/theme-scope-impact-check/`、`app/services/theme-scope-impact-service.ts`、`knowledge/production/theme-scope-impact-acceptance-v04.ts`、`app/runtime/server.ts`、`client/` |

## 运行时接口

写接口要求 Runtime token 和匹配的 Origin；受 token 保护的敏感 GET 要求 Runtime token。此类 GET 若未携带 Origin，服务端以配置的 expected Origin 校验；若请求显式提供了跨 Origin 值则拒绝。当前实现包括：

- `POST /api/theme-framework/start`：按 Theme 名称启动构建 Workflow。
- `GET /api/theme-framework/reviews?limit=...`：列出已持久化的 Theme Framework 审阅，按 run ID 最新优先排序；可通过下方详情读取路由恢复待审阅运行。
- `GET /api/theme-framework/runs/:runId`：读取候选；`POST .../accept` 与 `POST .../reject`：确认或拒绝首次框架。
- `GET /api/theme-scope-impact?limit=...`、`GET /api/theme-scope-impact/records/:receiptKey`：读取影响提案收件箱及记录。
- `POST /api/theme-scope-impact/records/:receiptKey/decisions`：对记录中的全部未 dismiss 提案提交原子批量决定，决定为 include、exclude 或 pending。
- `POST /api/theme-scope-impact/records/:receiptKey/proposals/:proposalId/dismiss`：关闭单项提示，不更改 canonical Theme 范围。

Theme Framework 与 Theme scope 接口由 `app/runtime/server.ts` 注册。浏览器端不能直接修改 Knowledge；canonical 变更仍经过服务端验证、ChangeSet 与 Writer。

## 可复核验证

此前在 `HEAD=3160f77` 上独立执行：

- `npm run typecheck` — 通过（`tsc --noEmit`）。
- `npm run client:typecheck` — 通过（客户端 TypeScript 检查）。
- D3 多 Theme 单 revision、精确重放及 stale conflict 的确定性覆盖位于 `tests/knowledge/theme-scope-impact-acceptance-v04.test.ts`；HTTP 路由覆盖位于 `tests/app/runtime/theme-scope-impact-routes.test.ts`。本次文档核验没有运行 Node 测试套件，因此不在此记录测试通过结论。
- 使用自编虚构文本与明确的测试权限字段，在全新临时 Schema 0.4 KB 上实际运行默认 Raw preview。Workflow 为 `completed`，preview 为 `preview_ready`、`committable=true`，得到 6 组待审阅候选；运行元数据为 `backend=codex-cli`、`requestedModel=gpt-6-luna`、`requestedReasoningEffort=high`、`invocationMode=exec-stdin-json-output-read-only`。Source/Raw 仅写入临时 KB；未接受候选，临时 KB 与脚本已清理。该测试没有读取或处理用户 PDF。

## 真实验收状态与限制

- 用户确认对其提供的行业研究 PDF 具有本地保留、AI 处理及形成衍生知识的权限后，Workflow 使用专用 Codex CLI `gpt-6-luna` high 完成 Schema 0.4 Raw preview。运行记录为 `preview_ready`、`committable=true`、`extractionCompleteness=complete`；14 个 extraction units 汇总为 581 组候选（entity 240、relation 238、claim 103），另有 28 项在提取/归并阶段被拒绝。以上均为待审阅提案；没有候选被人工接受，也没有实体、关系或观点写入 canonical Knowledge。
- 当前核验的 `ai-compute-theme-v04-verified` 为 Schema 0.4、revision 3，包含 3 个 Source 和 3 个 Raw；canonical Entity、Relation、ThemeGroup 与 Theme 数量仍均为 0。新增的 MIIT 官方《算力基础设施高质量发展行动计划》（2023-10-08）由 Gateway 提交至 revision 3；Source 指向对应 Raw，Raw 文件 SHA-256 与 manifest 中的 content hash 一致。两个 revision 3 Theme Framework 候选均包含该 Source/Raw 的持久化 evidence bindings，且各自候选中的部分证据引用能匹配这些绑定。Raw 与证据绑定不等于知识已写入。
- revision 2 的历史候选 `tf-ai-compute-20261003-58894667-0e32-4fb7-a751-331049874d61` 曾提出 13 个行业节点（10 个建议纳入、3 个待处理）和 9 条关系（7 个建议纳入、2 个待处理）；后续候选 `tf-ai-compute-20261003-4e2af1f8-5515-42bf-9ed1-be2a1b638ad3` 提出 9 个节点（6 个建议纳入、3 个待处理）且没有关系。KB 升至 revision 3 后，这些 revision 2 候选已过期，不能作为当前待确认框架或接受依据。
- 两个 revision 3 候选仍待人工审阅且都未被接受：`tf-ai-compute-20261003-931745f8-e81e-4741-9ea3-825a5e6e2da7` 提出 10 个节点、0 条关系；`tf-ai-compute-20261003-39d77366-341c-4c86-9b7c-992296a42623` 提出 8 个节点（6 个建议纳入、2 个待处理）和 1 条主链关系（建议纳入）。后一候选已建议纳入包含数据中心的算力基础设施建设与运营，数据中心供电与制冷服务仍待处理；但目前没有独立服务器制造节点，主链关系覆盖不足，也没有交叉关系或明确排除分支。因此目前没有 canonical Theme 或产业图谱，不能把任一候选表述为已确认框架。
- Theme Framework construction 当前只支持首次框架构建；`workflows/theme-framework-construction/workflow.ts` 在读取到 `existingThemeRef` 时以 `theme_already_exists:use_framework_update_workflow` 阻断，而仓库没有实现等价的广度重建更新 Workflow。D3 影响检查只处理后续成功 canonical Writer 写入所带的变化 refs，并生成范围决定提案；它不能替代完整框架重建。因此若先接受一个不完整框架，不能承诺可直接重新运行完整 Theme Framework 来补全。
- 为本轮研究输入，MIIT acquisition Plugin 增加了 AI 算力基础设施官方资料 anchor；Theme Framework Skill 明确允许关系端点引用同一结果中的行业 `candidateId`，并要求建议纳入的关系两端也均建议纳入。此前 Eastmoney 连接以 socket closed 失败；当前证据仍不足以证明完整上下游覆盖、交叉关系、独立节点质量或服务器／数据中心相关分支的边界。
- 浏览器复核曾确认 Theme scope 收件箱、Theme Framework 审阅列表及空图状态可加载；这些结果只覆盖审阅入口与空状态，不覆盖真实候选接受、知识写入、已确认图谱刷新或 D3 决策闭环。
- 尚未完成真实浏览器从知识写入到已确认图谱刷新和 D3 人工决策的端到端闭环；E 阶段验收未完成。本分支尚未合入 `main`。

因此，A1–D3 的实现基础已经落地，但真实资料目前只到 Raw preview 和待审阅 Theme Framework 候选阶段。不能将当前 KB、候选快照或 fixture 测试表述为完整 Graph 产品验收。
