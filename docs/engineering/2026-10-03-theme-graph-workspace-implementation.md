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

- **真实 Source/Raw 与首次 Theme Framework 接受：**`ai-compute-theme-v04-verified` 在 revision 3 有 3 个 Source / 3 个 Raw；经 Gateway 持久化 MIIT 2021 官方《新型数据中心发展三年行动计划（2021-2023年）》发布页和名词解释附件后，于 revision 5 有 5 个 Source / 5 个 Raw。基于 revision 5 的候选 `tf-ai-compute-20261003-glossary-dc5d7898-0163-41fb-96aa-46bbbb1138ef` 经 `ThemeFrameworkService.accept` 首次接受，Writer receipt 为 `completed` / `committed`，知识库升至 revision 6。持久化 receipt 的 Theme ref 为 `entity:investment_theme-ai-2f805c60`，记录 20 项决定；Theme 名称为“AI算力”，ThemeGroup 为 `theme-group:default`。新服务实例重读到 `committed` 状态和相同 revision 6 receipt。
- **当前 canonical 计数：**revision 6 有 1 个 ThemeGroup、9 个 Entity（8 个 Industry 和 1 个 InvestmentTheme）、13 个 Relation（8 个 `theme_exposure` 和 5 个产业关系）、5 个 Source 和 0 个 Claim。Writer receipt 列出 23 个 created IDs、0 个 updated IDs。五个 Raw 均仍存在，文件 SHA-256 与 registry content hash 相符；候选 62 个 Source/Raw evidence bindings 均指向已登记 Source 和其 Raw。
- **人工范围决定：**13 个 Industry 决定为 8 个 include、4 个 pending、1 个 exclude。Include 是 AI计算芯片、智能计算服务器、数据中心存储设备、算力网络及数据中心网络设备与服务、新型数据中心及智能计算中心、数据中心供配电与制冷设施、算力基础设施运营与算力服务、AI算力硬件用高端PCB；Pending 是存储芯片、半导体封装基板、芯片设计与半导体IP、半导体晶圆制造；Exclude 是晶圆制造上游材料。7 个 Relation 决定为 5 个 include、2 个 pending；Include 是芯片→服务器、服务器→数据中心、存储设备→数据中心、数据中心依赖网络、数据中心依赖供配电与制冷；Pending 是 PCB→服务器与封装基板→AI芯片。Scope ledger 在 revision 6 保存一个批次、全部 20 项 `human_confirmed` 决定。
- **偏离模型建议的人工理由：**`advanced_package_substrates` 从建议 include 改为 pending，理由为“现有证据可说明其与算力硬件相关，但其是否符合本 Theme 的上游边界、与AI芯片的具体关系尚待直接证据。”`wafer_fabrication` 从建议 exclude 改为 pending，理由为“主题上游边界止于芯片业务，晶圆代工不应因边界被自动排除，但其独立研究价值与AI算力需求的直接关联尚待证据判断。”两条理由与决定均保存在 acceptance intent 和 scope ledger。
- **Theme Graph projection：**revision 6 的只读 `ThemeWorkspaceProjectionService` 返回 `available`，包含 8 个范围内 Industry 节点和 5 条范围内产业关系边；pending 共 6 项（4 个 Industry、2 个 Relation），exclude 1 项。投影节点由上述 8 个已纳入 Industry 组成；两个 pending 关系没有进入 canonical 图谱边。

- 用户确认对其提供的行业研究 PDF 具有本地保留、AI 处理及形成衍生知识的权限后，Workflow 使用专用 Codex CLI `gpt-6-luna` high 完成 Schema 0.4 Raw preview。运行记录为 `preview_ready`、`committable=true`、`extractionCompleteness=complete`；14 个 extraction units 汇总为 581 组候选（entity 240、relation 238、claim 103），另有 28 项在提取/归并阶段被拒绝。这 581 组仍是待审阅提案；本次 Theme Framework 接受没有接受或处理它们，也没有将其写入 canonical Knowledge。
- **revision 3 时的历史核验快照：**当时 `ai-compute-theme-v04-verified` 为 Schema 0.4、3 个 Source / 3 个 Raw，canonical Entity、Relation、ThemeGroup 与 Theme 数量均为 0。MIIT 官方《算力基础设施高质量发展行动计划》（2023-10-08）已由 Gateway 提交；Source 指向对应 Raw，Raw 文件 SHA-256 与 manifest 中的 content hash 一致。此前生成的两个 revision 3 Theme Framework 候选均包含该 Source/Raw 的持久化 evidence bindings，且各自候选中的部分证据引用能匹配这些绑定。此历史快照之后 KB 先升至 revision 5，再经首次 Theme Framework 接受升至 revision 6；Raw 与 evidence bindings 本身不等同于 canonical 接受。
- revision 2 的历史候选 `tf-ai-compute-20261003-58894667-0e32-4fb7-a751-331049874d61` 曾提出 13 个行业节点（10 个建议纳入、3 个待处理）和 9 条关系（7 个建议纳入、2 个待处理）；后续候选 `tf-ai-compute-20261003-4e2af1f8-5515-42bf-9ed1-be2a1b638ad3` 提出 9 个节点（6 个建议纳入、3 个待处理）且没有关系。KB 升至 revision 3 后，这些 revision 2 候选已过期，不能作为当前待确认框架或接受依据。
- 经用户确认，对 revision 2 候选 `tf-ai-compute-20261003-58894667-0e32-4fb7-a751-331049874d61` 执行了受验证的候选刷新，生成 revision 3 候选 `tf-refresh-bdd5ac8cf3c4587e42969ef09e3851f6385d2ded`。新候选保留 13 个行业节点（10 个建议纳入、3 个待处理）和 9 条关系（7 个建议纳入、2 个待处理）；23 条持久化 evidence bindings 均有效，候选引用均能匹配绑定。刷新凭据记录源 revision 2、目标 revision 3 和 1 条 Source/Raw-only Writer receipt。精确重放返回 `already_refreshed`。源候选未接受，且新候选也未接受；KB 仍为 revision 3，canonical ThemeGroup、Entity（含 Industry）、Relation 和 Claim 数量均为 0。此刷新只生成新的审阅候选，不代表框架已确认或写入 canonical Knowledge。
- **旧候选状态（历史）：**revision 3 的候选 `tf-ai-compute-20261003-931745f8-e81e-4741-9ea3-825a5e6e2da7` 曾提出 10 个节点、0 条关系；`tf-ai-compute-20261003-39d77366-341c-4c86-9b7c-992296a42623` 曾提出 8 个节点（6 个建议纳入、2 个待处理）和 1 条主链关系。它们均不是 revision 6 当前已接受 Theme Framework 的依据。此前“没有 canonical Theme 或产业图谱”仅描述 revision 5 及更早状态，不再是当前状态。
- Theme Framework construction 当前只支持首次框架构建；`workflows/theme-framework-construction/workflow.ts` 在读取到 `existingThemeRef` 时以 `theme_already_exists:use_framework_update_workflow` 阻断，而仓库没有实现等价的广度重建更新 Workflow。D3 影响检查只处理后续成功 canonical Writer 写入所带的变化 refs，并生成范围决定提案；它不能替代完整框架重建。因此若先接受一个不完整框架，不能承诺可直接重新运行完整 Theme Framework 来补全。
- 为本轮研究输入，MIIT acquisition Plugin 增加了 AI 算力基础设施官方资料 anchor；Theme Framework Skill 明确允许关系端点引用同一结果中的行业 `candidateId`，并要求建议纳入的关系两端也均建议纳入。此前 Eastmoney 连接以 socket closed 失败。revision 6 的范围和图谱已由用户决定并落入 canonical Knowledge；旧候选中关于覆盖和边界的待核查项不应再表述为当前待接受决定。
- 浏览器复核曾确认 Theme scope 收件箱、Theme Framework 审阅列表及空图状态可加载。此后已完成真实 Theme Framework 接受和服务层图谱投影读取；但尚未完成浏览器端从知识写入、刷新已确认图谱到 D3 影响提案人工决策的完整端到端闭环。
- A1–D3 实现基础及 revision 6 的首次真实 Theme Framework 接受已完成；581 项 Raw preview 仍待独立人工审阅，真实浏览器 D3 决策闭环和 E 阶段验收仍未完成。本分支尚未合入 `main`，因此 canonical 首次接受及 projection 验证不等同于完整 Graph 产品 E2E 验收。

因此，当前真实资料已达到 canonical Theme Framework 首次接受和 8 节点/5 边 projection 验证；不能将这项验收、候选快照或 fixture 测试表述为完整 Graph 产品验收。
