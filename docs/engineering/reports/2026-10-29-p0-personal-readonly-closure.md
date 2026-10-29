# P0-CLOSE-001 — 个人只读研究阶段关闭

**任务状态：** `APPROVED_FOR_CODEX_EXECUTION`
**唯一权威仓库：** `https://github.com/rzpeuler/ResearchHub`
**来源分支：** `codex/company-research-p0-01-06`
**冻结来源 HEAD：** `f167a8f272e9b1faf8615a74093047091a194cf1`
**冻结目标 main HEAD：** `952c723d78b0eaff4ae49e521ee7cd04b2bb8bc5`
**报告首次提交的父提交：** `f167a8f272e9b1faf8615a74093047091a194cf1`

本报告记录只读个人研究阶段的集成和限制，不改变产品资格、报告、历史证据、Knowledge 或研究方法。

## 1. 阶段决定

`P0_PERSONAL_READONLY_RESEARCH_V1 = ACCEPTED_WITH_DISCLOSED_LIMITATIONS`。

用户已确认 ResearchHub 前端可顺利阅读研究报告。这是用户侧报告阅读体验通过证据，不代表全部章节通过、历史 PIT 自动追溯通过或浏览器 E2E 自动化通过。工程记录参见：

- [P0-CONVERGE-001](2026-10-29-company-research-p0-converge-001.md)
- [P0-CONVERGE-002](2026-10-29-company-research-p0-converge-002.md)
- [P0-USE-001](2026-10-29-company-research-p0-use-001.md)

仍未通过或未启动的能力：

- P0-19 仍为 `NOT_ACCEPTED`。BYD 002594、东山精密 002384 的既有运行各为 `17/19 BLOCKED`；未通过 `bull-base-bear` 与 `variant-perception`，独立真实经济 Reviewer 为 0。
- 两份旧报告引用的报价响应均在其原 `asOf` 之后取得。旧价及其参考 PE 不具备已证历史数值版本资格；旧档案保持原样，未用新规则追溯改写。
- P1 Editorial Synthesis / Publication Quality Gate 尚未启动。
- S4 经营假设候选的 Workflow 连接仍受既有质量门约束。经济桥和 Reviewer handoff 的生产资格仍未获认证；FIXTURE_ONLY/结构校验结果不赋予生产发布资格。

此阶段关闭不等于 P0-19 通过、19/19 达标或 P1/S4 生产发布验收。

## 2. Git 集成范围与证据

执行前重新 fetch 后，`origin/main` 为冻结 SHA `952c723d78b0eaff4ae49e521ee7cd04b2bb8bc5`，来源分支为 `f167a8f272e9b1faf8615a74093047091a194cf1`。冻结 main 是来源祖先；`origin/main...origin/codex/company-research-p0-01-06` 为 `0 136`。main 没有独立领先提交，满足快进祖先关系。签发的来源差异实测为 **136 commits、130 files changed、26,080 insertions、678 deletions**。

差异主要集中于 Company Research Workflow/Skills、Workflow 回归和审计证据，以及工程报告；P0-USE-001 的 React 报告阅读摘要和相应测试包含在来源中。高风险核对范围包括：

- `workflows/company-deep-research/`：Workflow、情景候选、私有经济桥与 Reviewer handoff；
- `skills/company-research/`、`skills/scenario_valuation/SKILL.md`；
- `tests/workflows/`、`tests/validation/evidence/`；
- `client/src/components/ResearchReportBody.tsx` 及其回归；
- Company Research acquisition/expectation provider 与对应数据策略；
- Company Research、P0-19、S4 的工程报告和规格。

本任务只在允许白名单新增本关闭报告这一个文件；其文档提交及验证结果补记均只改该文件。相对冻结 main 的最终提交数、文件数和净差异量、PR head、PR 编号/URL、合并方式、合并前后 SHA 及最终 ancestry 在合并后 Codex 交付回执中核实，以避免自引用 SHA。

## 3. S4 与资格边界核对（B2）

### Workflow 接线的情景假设候选

`workflow.ts` 构建 `scenario-assumptions.ts` 候选并将结构有效的计划交给现有 `reviewCompanyResearchSemantics`。候选构造器自身恒定返回 `reportEligible: false`，并保留需要独立语义审查的诊断（`scenario-assumptions.ts`）；Workflow 的现有呈现门还要求六项情景理由审查、结构有效及最终章节质量检查（`workflow.ts`）。这是一条已存在的**候选路径**，不能在本次合并中改成自动资格化，也没有在本次执行中运行公司研究或将候选写入报告。

该候选路径使用现有语义内容审查，不等同于独立认证的真实经济 Reviewer。不得将其表述为 S4 经济桥或认证 Reviewer 已取得生产发布资格。

### FIXTURE_ONLY 经济桥与 Reviewer handoff

- `scenario-economic-bridge.ts` 只接受 `FIXTURE_ONLY` 输入；输出为 `STRUCTURALLY_VALID_FIXTURE_ONLY` 或 `UNAVAILABLE`，并恒为 `reportEligible: false`。
- `scenario-economic-review-handoff.ts` 仅建立结构性测试 packet/receipt；即使收到 ACCEPT 也不验证 Reviewer 身份、独立性或授予发布资格。生产 Workflow 未调用该 handoff。
- 相关 `scenario-method-*` 模块提供私有契约和结构检查；没有已认证真实经济 Reviewer 的生产调用、签名身份或资格证明链。
- 未发现通过 Gateway/ChangeSet/Writer、PIT/rights、报告质量门或 `writeKnowledge` 边界的绕行，也没有真实数值被伪造成已签收证据。

因此，实际生产接线的情景候选与 FIXTURE_ONLY 经济复核实现必须分开描述；本次合并未改变任何门、输出资格或 P0-19 状态。

## 4. 验证（Gate C）

验证均在独立、干净的临时 worktree 运行，Node 为 v24.16.0（满足 `package.json` 的 `>=22.19.0`）。来源与 main 的 `npm ci` 均退出码 0。npm 安装报告 11 个依赖审计告警（7 moderate、4 high）；未运行自动升级或修改 lockfile。

| 验证 | 来源结果 |
|---|---|
| `npm run typecheck -- --pretty false` | exit 0 |
| `npm run client:typecheck` | exit 0 |
| `npm run client:build` | exit 0；产物仅在隔离 worktree；有既有的大 chunk 提示 |
| `node --import tsx --test tests/workflows/company-valuation-sections.test.ts` | 23/23 通过 |
| `node --import tsx --test tests/app/services/research-report.test.ts` | 17/17 通过 |
| `npm run client:test -- src/components/ResearchReportBody.test.tsx` | 12/12 通过 |
| `npm run client:test -- src/app/report-navigation.test.tsx` | 2 通过、2 失败；与冻结 main 同身份 |
| Company Research Workflow / 质量门回归（9 个现存 `tests/workflows/` 文件） | 445/445 通过 |
| 完整 Node：`npm run test:node` | 3,305 项，3,284 通过、21 失败 |
| 完整 Client：`npm run client:test` | 228 项，223 通过、5 失败 |

Git 空白检查：关闭报告提交及暂存报告的 `git diff --check` / `git diff --cached --check` 均 exit 0。对完整来源差异运行 `git diff --check origin/main...HEAD` 为 exit 2，只有四处来源分支既有尾随空格：`docs/engineering/reports/2026-10-27-company-research-gate1-field-lineage-detail.md:3-4` 与 `docs/engineering/specs/2026-10-27-company-research-p0-19-input-contract-proposal.md:3-4`。它们早于本任务且不在本次文档白名单内，未修改。

完整回归在干净冻结 main worktree 使用相同 lockfile 和命令复跑：

- Node main：3,101 项，3,077 通过、24 失败。来源的 21 个失败身份全部与 main 一致；main 的另外 3 项失败在来源分支通过，因此没有新增 Node 失败。
- Client main：219 项，214 通过、5 失败。来源与 main 的 5 个 `filePath + testTitle` 失败身份完全一致；来源增加的 9 项测试均通过。

21 个共同 Node 失败身份：

| 文件 | 失败测试标题 |
|---|---|
| `tests/app/services/research-skill-architecture.test.ts` | Workflow metadata composes canonical peers without registering composite Skill IDs |
| `tests/app/services/theme-workspace-projection.test.ts` | Theme graph includes only human-confirmed scope refs, preserves direction, and never expands global edges；Industry projection returns bounded facts, deterministic core views, publication-labeled dates, future catalysts and competition units；semantic section classification receives only readable facts and cannot block the base projection；current restricted or expired source rights suppress company exposures and dependent competition data；company projection is readable through a canonical business exposure without adding a company graph node；stale expected revision and a corrupt scope ledger fail closed |
| `tests/knowledge/production/competition-module-gateway.test.ts` | Gateway creates a competition Module and maps its local proposal ID；Gateway blocks numeric Module cells that disagree with their canonical facts；same Industry table replays idempotently with the same canonical Module ref；evidence-backed cell update commits, and an unavailable update preserves the prior usable value；same Claim may support a canonical numeric display update after new provenance is admitted；Module blocks the whole submit when a cell reference cannot resolve；ChangeSet validation rejects denied or missing Raw evidence listed by a competition Module；Module blocks when the row Source payload is unusable；Module blocks unusable Source evidence inherited from an existing business_exposure Relation；new Claim provenance alone cannot justify a contradictory same-reference display value；Writer rejection does not report success or overwrite the prior Module；different rows may retain different currencies and a changed column schema blocks for review |
| `tests/validation/codex-module-remaining-schema-deltas.test.ts` | composition is source-immutable, deterministic and idempotent |
| `tests/validation/codex-production-industry-schema-compatibility.test.ts` | FIX-015 offline evidence inputs preserve authoritative contracts and expected source sizes |

冻结 main 另外失败、来源已通过的三项为 `R143 repairs heading and displaced-header fusions only when section widths prove them`、`R144 removes only an orphan separator whose following rows have inconsistent widths`、`R146 separates inline section headings from body text without touching tables or code fences`（均在 `tests/workflows/company-research-assembly.test.ts`）。

五个共同 Client 失败身份：

- `client/src/App.test.tsx` / searches and filters server conversation titles and refreshes server-authoritative rename/archive state
- `client/src/App.test.tsx` / keeps rename open after a version conflict and retries with the refreshed version
- `client/src/App.test.tsx` / moves archived conversations into the archive view and restores them to active history
- `client/src/app/report-navigation.test.tsx` / opens a no-report bundle from its durable original conversation Activity
- `client/src/app/report-navigation.test.tsx` / rejects another run returned to a conversation artifact request

退出码非零只来自这些与 main 同身份的已记录回归失败；未更改测试或放宽断言。真实模型/API、外部数据获取、真实 Company Research Workflow、浏览器 E2E、生产 Knowledge 写入均为 `NOT_RUN`；用户已确认的阅读体验不以新的浏览器 E2E 作为阻断门槛。

## 5. 用户资产与执行异常

操作前用 SHA-256 建立清单，操作后对同一清单复算：**7,568 个文件完全一致**，包含五个 dirty evidence JSON（5 tracked）、15 个历史公司研究归档 sidecar、2 个既有启动日志、28 个 `tmp/` 历史文件、1 个 parser 缓存文件，以及 `ResearchHubData/knowledge-bases/` 与 `runtime-data/knowledge-bases/` 下 7,517 个文件。五个 dirty JSON 仍保持原有未提交状态。清单存于系统临时验证目录，不纳入仓库或 PR。Runtime/Knowledge 目录没有被复制、移动、删除或改写。

执行 main 基线准备时曾有一次 `npm ci` 命令误在主 checkout 启动；因服务进程占用 esbuild 文件而以 `EPERM` 退出。随后从同锁文件的干净来源 worktree **仅补齐主 checkout 中缺失的忽略依赖文件，不覆盖现存文件**；运行中的 Runtime 页面及状态 API 均再次返回 HTTP 200。Git 工作树仍保留任务前的五个 dirty JSON 和既有 untracked 项，受保护清单 SHA 未变。后续正式验证均在隔离 worktree 运行。

## 6. Runtime、数据与后续

Git 集成只包含已批准来源分支代码与本关闭报告；未搬运 `runtime-data`、未改历史档案、未写 Knowledge、未触发真实模型或数据抓取。未新增 Skill、Reviewer、状态机或产品功能。

仅记录为后续 backlog，不在本任务开发：日常个人投研反馈；有实证需求时再启动 P1 编辑性综合；取得经授权的来源、许可和合法历史版本证据后，再单独评估完整 Bull/Base/Bear 与 Variant Perception 资格。本报告不创建新 P0 审批流程。