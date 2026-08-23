# Decision Log

重要技术、架构和工程治理决策按时间倒序追加。普通实现细节不需要在此重复记录。

## 2026-08-23

**决策：** 建立 `docs/project-management/` 作为 ResearchHub 的项目治理文档目录。

**背景：** 项目刚启动，仓库为空，聊天记录不能作为长期项目状态数据库；后续 Agent 需要能够仅通过仓库恢复上下文。

**选择方案：** 使用一组职责清晰的 Markdown 文档管理项目概览、状态、路线图、任务、决策、架构、规范、变更和工作流。

**放弃方案：** 依赖聊天记录；在项目早期建立复杂的外部项目管理系统；在尚无业务实现时预先虚构完整技术架构。

**原因：** 文档可版本化、可审查、可随代码一起交付；轻量结构足以覆盖当前治理需求；如实记录未知项可以避免形成错误的架构事实。

**影响范围：** README 导航、Agent 开始任务前的阅读顺序、任务执行后的状态同步、架构和技术决策记录方式。

## 决策记录规则

- 记录会影响多个模块、后续实现方向或协作方式的决策。
- 每条记录必须说明背景、选择、放弃方案、原因和影响范围。
- 后续决策如改变既有方向，应明确引用被替代的决策并同步架构和状态文档。

> Architecture v0.2 已包含 ADR-001 至 ADR-005。本文件从 ADR-006 起同步架构基线中的后续决策，Architecture v0.2 和 Technical Design v0.1 是本阶段的权威来源。

## ADR-006

**Title:** ResearchHub Capability Architecture

**Decision:** ResearchHub adopts Capability-based financial extension architecture.

**Reason:**

- Decouple Agent and data source.
- Support multiple financial providers.
- Improve extensibility.

**Status:** Accepted

## ADR-007

**Title:** ResearchHub Research Artifact Model

**Decision:** Research outputs are stored as structured artifacts:

- Evidence
- Thesis
- Prediction
- Review

**Reason:** Enable investment research review loop.

**Status:** Accepted

## ADR-008

**Title:** ResearchHub Harness Extension Model

**Decision:** ResearchHub extends DeepSeek Harness through native extension mechanisms and does not fork Harness core.

**Reason:**

- Maintain compatibility.
- Reduce technical debt.
- Follow Harness architecture philosophy.

**Status:** Accepted

## ADR-009

**Title:** ResearchHub Workflow Definition and Research Report Boundary

**Decision:** ResearchHub defines declarative Workflow Definitions and a thin Research Manager coordination boundary, while reusing the DeepSeek Harness Workflow Runtime / Agent Loop. Research Report is an aggregate view over Evidence, Thesis, and Prediction Artifacts rather than a new base Artifact type.

**Background:** ResearchHub has data Capabilities, Skills, Artifacts, Memory, and Evaluation, but needs a stable orchestration boundary without duplicating Harness runtime responsibilities.

**Selected approach:** Keep Workflow independent from Skill; let Workflow reference Skills; let Skills call Capabilities; let the Research Manager coordinate through Harness Agent and Session boundaries; assemble Reports from existing Artifact IDs.

**Rejected approaches:** Put the full workflow graph inside a Skill; build a ResearchHub-owned Workflow Engine or Agent loop; create a new base Report Artifact that duplicates Evidence, Thesis, and Prediction payloads.

**Reason:** Preserves Architecture v0.2's Harness-first principle, keeps Skills reusable, avoids duplicated lifecycle runtimes, and maintains existing Artifact, Memory, and Evaluation contracts.

**Impact:** RH-ENG-009 must implement only the validated Workflow model, registry, thin Harness-facing coordinator, and trace recording. It must not introduce a parallel runtime, direct data access, trading behavior, or autonomous investment decisions.

**Status:** Accepted
