# Agent Workflow

本流程定义未来 Agent 执行 ResearchHub 任务的最小闭环。

## 1. 开始任务前

必须阅读：

- [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md)
- [CURRENT_STATUS.md](CURRENT_STATUS.md)
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [DEVELOPMENT_RULES.md](DEVELOPMENT_RULES.md)

然后检查任务登记表、相关决策、路线图和实际代码状态。若任务不存在，先创建 Task ID 和验收范围；若发现文档与代码不一致，先记录差异并向 Sol 请求方向确认。

## 2. 执行任务

- 明确任务范围、允许修改的文件和验收条件。
- 遵守架构边界和开发规范。
- 只修改完成任务所需的内容，避免无关重构。
- 对重要架构或技术方向选择先记录决策，再实施。

## 3. 测试

- 根据变更范围运行单元测试、集成测试、静态检查、构建或文档校验。
- 记录测试命令、结果和未覆盖风险。
- 若项目尚无测试基础设施，执行可行的静态/结构校验，并明确说明测试基础设施尚未建立。

## 4. 更新状态文档

任务完成或阶段变化后，必须更新：

- `CURRENT_STATUS.md`
- `TASK_REGISTRY.md`
- `CHANGELOG.md`

如涉及架构、技术选择或长期方向，同时更新：

- `ARCHITECTURE.md`
- `DECISION_LOG.md`
- `DEVELOPMENT_ROADMAP.md`

## 5. Git commit

- 检查 `git status` 和变更差异。
- 确认提交只包含本任务范围。
- 使用符合 [DEVELOPMENT_RULES.md](DEVELOPMENT_RULES.md) 的 commit message。
- 提交后记录 commit hash，并确认工作区状态。

## 6. 输出标准验收报告

每次任务结束时，报告至少包含：

- 完成内容
- 新增文件列表
- 修改文件列表
- 当前项目状态摘要
- 测试结果
- Git commit hash
- 遗留风险或未解决问题

## 角色协作

- **Sol**：确认目标、架构方向、任务拆解和最终验收。
- **Luna**：执行实现、测试、Git 操作和状态同步。
- 任何超出任务范围、改变已确认架构或涉及生产风险的事项，必须暂停并请求确认。
