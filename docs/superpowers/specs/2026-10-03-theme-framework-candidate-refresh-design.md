# Theme Framework 候选刷新设计

日期：2026-10-03。依据已批准的 Theme / Knowledge Graph 设计，以及用户对「仅在 Source/Raw 新增、旧证据仍有效且产业范围状态未变时刷新候选，重新逐项审核」的确认。

## 问题与选择

首次构建的候选基于 KB revision 2，包含一条有证据的材料主链。随后 Raw Gateway 只增加一份工信部资料，使 KB 升为 revision 3。现有接受路径正确地阻断旧 revision；重新调用 Skill 的两次输出未保留原材料链。直接接受过期候选会绕过 revision 治理，反复推理也不保证恢复同一候选。因此增加一个**确定性刷新旧候选**的有界路径；它不生成新事实、不合并模型输出，也不自动接受任何决定。

## 契约与数据流

1. 用户从一个旧的、未提交的 Theme Framework 审阅运行发起刷新。服务端生成由原 run ID、KB ID、目标 revision 决定的稳定新 run ID，保留 `refreshedFromRunId`、原 revision、目标 revision、校验结果摘要和刷新时间。原 candidate/event 保持只读，新的 candidate 独立持久化并出现在审阅列表。相同请求只返回同一新运行；不同内容占用该 ID 时冲突。
2. 刷新只允许在同一活动、可写的 Schema 0.4 KB 内，且目标 revision 严格大于原 revision、当前没有同名 canonical Theme，也没有原候选的接受意图或已提交收据。原运行必须有通过校验的持久候选；不能对拒绝、失败、取消或已提交运行刷新。已因 revision 改变而标为 stale 的运行可以刷新。
3. 对原 revision 之后的**每一个** revision，读取并验证唯一的受治理 Writer 收据。只允许 `producerType=raw_document_source_gateway`、`status=completed`、`writeStatus=committed`、同一 KB／Schema、准确的连续 `committedRevision`、`createdIds` 为非空且全是 `source:`、`updatedIds` 为空。现行 v0.4 Writer 日志不记录 `baseRevision`，因此不以虚构字段作验证。缺失、重复、不连续、非 Source 写入、无法证明收据来源或读取不安全都阻断。验证新 Source 当前仍存在、与有效 Raw 配对；任何 Theme、Industry、Relation 或范围治理写入均阻断。本校验不能仅凭当前对象计数推断历史。
4. 对原候选的**全部**持久证据绑定重新检查 Source 权限、Raw 内容哈希、locator 与引用的一致性；带正文 block locator 的绑定还须确认目标 block 仍存在，不能仅验证 locator 字符串格式，也不能只检查实际被某个节点引用的子集。候选的节点、关系、建议、理由、证据 ref 和语义指纹逐字保持，不从新资料自动派生结论。新 candidate 只更新 `workflowRunId` 与 `basedOnRevision`，附带刷新来源记录。刷新的最终写入前再次确认 KB revision 未变化；并发 Writer 抢先提交则阻断。
5. 浏览器对 stale 审阅显示“刷新到当前修订”尝试入口；只有服务端能判断是否可刷新，不满足条件时返回明确阻断原因。刷新结果打开**新**候选，明确展示原 run、原/新 revision、仅来源新增的依据与候选未纳入新资料的提示；该来源提示从持久候选恢复，页面重载后仍可见。原审阅维持 stale。用户仍需在现有界面逐项调整 `include / exclude / pending` 并显式接受；Gateway、ChangeSet、Validation、Writer 的原子提交路径不变。

## 失败与验证

安全失败为可解释的 `conflict` 或 `blocked`，不得留下可接受的部分候选或隐式改动 KB。若 Writer 恰在最终检查与事件落盘之间提交，新候选 sidecar 可以作为审计记录保留，但必须写入 `stale` 终态并返回阻断；读取与接受路径也始终以当前 revision 再校验。事件落盘中断后按稳定新 run ID 重试，校验已存在事件的内容与来源并恢复；不能覆盖或清理旧文件。API 沿用 Runtime token、Origin 与请求体界限。

测试用临时 KB 覆盖：Source/Raw 唯一新增的成功刷新；旧候选可读且新候选可审阅；同请求重试；非 Source 写入、缺失/伪造/重复 Writer 收据、证据失效、当前 revision 变化、已存在 Theme、已接受或拒绝运行、路径与大小上限均阻断；刷新后原子接受成功和再次变更 revision 时接受冲突。真实 KB 只执行刷新与只读审核验证，不在没有用户逐项决定时接受。

## 边界

刷新不代替 Theme Framework 更新 Workflow，也不证明新加入的工信部资料已被原候选覆盖。其目的仅是让一份证据仍有效、期间只有 Source 新增的旧提案在当前 revision 下重新接受人工审核。若检查不满足，继续补证并重新构建候选。
