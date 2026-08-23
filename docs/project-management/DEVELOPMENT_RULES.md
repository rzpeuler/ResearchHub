# Development Rules

本规范适用于所有 Agent 和工程参与者。若具体任务与本规范冲突，应先在任务或决策记录中说明并获得项目负责人确认。

## 修改前必须阅读

执行任何任务前，必须阅读：

1. [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md)
2. [CURRENT_STATUS.md](CURRENT_STATUS.md)
3. [ARCHITECTURE.md](ARCHITECTURE.md)
4. 本文件

随后阅读与任务直接相关的 [TASK_REGISTRY.md](TASK_REGISTRY.md)、[DECISION_LOG.md](DECISION_LOG.md)、[DEVELOPMENT_ROADMAP.md](DEVELOPMENT_ROADMAP.md) 和现有代码文档。

## 不允许破坏的结构

- 不得绕过 `docs/project-management/` 记录项目状态、任务和重要决策。
- 未获明确授权，不得破坏已确认的模块边界、数据结构、API 契约或生产配置。
- 不得把尚未实现的规划写成已完成事实。
- 不得删除历史决策、变更记录或任务记录；修正时应追加说明或保留可追溯历史。
- 保持 README 中的治理文档入口可用。

## Git 提交规范

- 一次 commit 聚焦一个可解释的任务或变更单元。
- commit message 使用清晰、简短、可搜索的英文描述，推荐使用 `type: description` 格式。
- 提交前检查变更范围，确保没有无关文件、密钥、临时文件或构建产物。
- 任务完成后在 TASK_REGISTRY.md 记录 commit hash，并在 CURRENT_STATUS.md 和 CHANGELOG.md 同步交付状态。

## 测试要求

- 修改代码后必须运行与修改范围匹配的测试、静态检查或构建验证。
- 修改文档后必须检查文件存在、内部链接、章节完整性和内容是否与仓库事实一致。
- 若没有可运行的测试，必须在验收报告中明确说明原因和已执行的替代验证。
- 失败测试不得被隐瞒；应记录失败原因、影响和后续任务。

## 文档同步要求

- 每次任务完成后更新 CURRENT_STATUS.md。
- 任务状态、负责人、commit hash 和验收状态同步到 TASK_REGISTRY.md。
- 用户可见变化同步到 CHANGELOG.md。
- 架构或重要技术方向变化同步到 ARCHITECTURE.md 和 DECISION_LOG.md。
- 任何文档描述必须以当前仓库实际状态为准。
