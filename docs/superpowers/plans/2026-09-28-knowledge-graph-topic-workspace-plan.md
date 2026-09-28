# Knowledge Graph 主题知识工作台实施计划

日期：2026-09-28
状态：实施计划；尚未执行产品代码改动
绑定设计：`docs/superpowers/specs/2026-09-28-knowledge-graph-topic-workspace-design.md`，提交 `72aa346`

## 交付目标

在现有 `/graph` 页面提供 Schema 0.4 的 InvestmentTheme 主题工作台：保留只读 Entity/Relation 主图，增加准确的主题身份、直接归属与关联上下文分类阅读、证据/时间/来源精读，并以有界分页保证直接归属对象可以完整枚举。所有数据来自 mounted canonical Knowledge；不新增写入路径、图数据库、Skill 或编排层。

本计划按依赖顺序执行。每个切片由主代理做契约/架构审查，再交给指定的 `gpt-6-luna` High 子代理实现和运行针对性测试；主代理负责差异审查、范围控制、最终验收与 Git 交付。子代理须获知自己并非独占代码库，不得回退他人的改动。并行工作只分配不重叠文件，跨层契约改变先由主代理定稿。

## 0. 基线与隔离

1. 核对 `main`、远端、工作区和现有规范文档；从已批准设计建立 `codex/knowledge-graph-topic-workspace` 工作分支，不重写未知历史。
2. 记录 `app/services/knowledge-service.ts` 的 Schema 0.4 单对象读取行为、`knowledge-graph-service.ts` 的 Entity/Relation 投影、`app/runtime/server.ts` 路由、`client/src/app/graph/KnowledgeGraphPage.tsx`、`client/src/api/runtime-client.ts` 及当前测试基线。
3. 使用隔离的 Schema 0.4 测试 Knowledge Base。不得把用户挂载的 Knowledge Base 作为写入式 fixture；真实页面烟测只读。

退出条件：已记录变更前状态、旧版 v0.3 Graph 行为和新功能的文件所有权；未发现会改变已批准架构的阻塞决策。

## 1. 只读主题契约与成员判定

负责文件：新增 `app/services/knowledge-topic-projection.ts`（必要时拆分纯函数模块），新增 `tests/app/services/knowledge-topic-projection.test.ts`，类型合同放在 `app/services/contracts.ts` 或相邻的专用合同模块。该切片不修改前端和运行时路由。

1. 定义 `TopicSummary`、`TopicItemPage`、`TopicAssociationPath`、分类 kind、scope、筛选、计数精确性、截断和错误合同。服务只接受活动的 Schema 0.4 `investment_theme` 根；保持 v0.3 Graph 原路径。
2. 从 `KnowledgeIndexV04` 计算直接归属：Claim/Event/Observation/Thesis 的 subject ref、Relation 的端点或 `contextRefs`、Module 的 `targetEntity`、与已纳入锚点相连的 ReasoningEdge，以及被这些对象显式引用的 Source。特别注意当前 `getBySubject()` 不覆盖 Relation、Module 或 ReasoningEdge，必须按已批准规则显式处理。
3. 关联上下文仅通过活动 canonical Relation 的真实路径到达 Entity，并标记与直接归属不同的作用域；相同对象去重，保留所有本次范围中可证明的路径。不得依据名称、全文匹配、共享来源或模型推断建立成员关系。
4. 生命周期与时间字段逐类处理；Thesis 的业务 `status` 和对象 `lifecycle.status` 独立。Graph 结构不增加 Claim/Source 等节点。

针对性测试：两个主题共享行业、主题直接 Claim、行业独有 Observation、Relation `contextRefs`、Module、ReasoningEdge、Source 去重、失效对象、无路径对象、方向保留、主题身份错误。直接归属的统计与逐页枚举须相等。

## 2. 分页、版本与来源安全

继续由服务端切片负责，文件限于主题投影及其测试。

1. 固定服务端 `limit`、关联遍历规模及响应体上限；排序采用明确日期键加 canonical ref。无日期项有固定次序。游标绑定 KB id、revision、themeRef、scope、kind、depth 与规范化筛选；同参数重放给相同页面，revision 变化拒绝旧游标。
2. 直接归属给精确 `total`。关联遍历触界时返回 `totalExact=false`、至少数量、截断状态及可继续聚焦的 canonical Entity refs；未扫描完全的集合不得显示精确总数。
3. 列表 DTO 只含显示所需的轻量字段与证据 ref，不附带 Raw bytes、原文摘录、本地绝对路径或无权分发的来源内容。Source URL 限制为安全 HTTP(S)；权利不允许的链接或 Raw 入口隐藏并说明原因。详情仍由 canonical object read 提供，前端继续对可展示字段做权限约束。
4. 检查 malformed ref、循环关联、坏引用、超限、旧游标和权限状态，返回有界且可识别的错误。

针对性测试：确定性排序与分页无遗漏/重复、游标绑定与失效、上限和 `totalExact`、多路径去重、恶意 URL/本地路径、受限 Source 不泄漏、坏引用 fail-closed。

## 3. Application Runtime 与 HTTP 接线

负责文件：`app/runtime/contracts.ts`、`app/runtime/application-runtime.ts`、`app/runtime/server.ts`，必要的服务导出；测试放在 `tests/app/runtime/knowledge-topic-workspace.test.ts`。不得增加 Pi 写入工具或改变 Gateway/Writer。

1. 将主题只读服务挂载在现有 Application Services，新增 `GET /api/knowledge/topics/{encodedThemeRef}/summary` 与 `/items`。严格解码 canonical ref，验证 query enum、正整数、日期/筛选、URL 长度及未知参数。保持 `/api/knowledge/graph` 和 `/api/knowledge/object` 行为。
2. HTTP 明确区分未挂载 KB、Schema 不支持、根不存在/类型错误、旧游标和服务异常；响应不得暴露 KB 路径、Raw 或凭据。
3. `summary` 和 `items` 返回同一修订语义；请求中的预期 revision 或 cursor 用于阻止跨修订混页。

针对性测试：隔离 Schema 0.4 KB 的成功/错误路由、只读性质、返回形状、跨修订冲突；现有 `tests/app/runtime/knowledge-graph.test.ts` 回归。

## 4. 前端数据与主题状态

负责文件：`client/src/api/runtime-client.ts`、新增 `client/src/app/graph/topic-state.ts` 与相应测试。与页面渲染切片顺序交接，避免同一文件并行编辑。

1. 加入强类型 `getTopicSummary()` 与 `listTopicItems()`，不在浏览器中重建 canonical 归属规则。
2. URL 状态保存 themeRef、graphRootRef、depth、分类、direct/connected、筛选和可选选中 ref；与浏览器 back/forward 同步。目录中的行业/公司等普通根仍能使用原有 Graph 页面，主题分类只在有效 InvestmentTheme 下显示。
3. 请求绑定主题和 revision，切换主题或筛选时取消/忽略旧结果；失效游标提示刷新第一页。分类内容按需加载，独立保存加载、空、受限、错误和截断状态。

针对性测试：URL 往返、浏览器返回、跨主题竞态、旧页作废、Schema 0.3 兼容和客户端请求参数编码。

## 5. 界面与 Inspector

负责文件：`client/src/app/graph/KnowledgeGraphPage.tsx`、按职责拆出的 `TopicHeader`、`TopicSections`、`TopicInspector`、各类只读卡片，以及相关 CSS 与组件测试。保持当前 React Flow/Dagre 仅负责可视化布局；节点拖动是临时 UI 状态。

1. 三栏桌面布局：目录/搜索与面包屑；主题身份、图及分类阅读；Inspector。窄屏为顺序内容加 Inspector 抽屉。保留现有图根与 1/2 跳操作，图截断与主题内容截断分别显示。
2. 分类导航覆盖概览、关系、事实与观点、指标与预期、事件、Thesis、研究模块、来源。展示 Schema 0.4 实际字段：Claim fact/forecast 等区分，Metric/Estimate/Consensus 区分，Event 各种时间区分，Thesis 状态与条件版本、ReasoningEdge 方向，Source 来源与权利，Module 动态表。关联上下文必须在卡片上写明 path，不能伪装为主题直接观点。
3. Inspector 在选择对象后读取 canonical 单对象，提供字段组、相关 ref 跳转、证据定位和来源元数据；未知 Kill Criterion type 标为当前不可求值。Raw JSON 只放折叠诊断区，受限内容不直接显示。
4. 缺失/未加载/权限/不可比/失效/截断状态用不同文案；图有文本关系清单；键盘可选择、焦点可见、颜色非唯一编码。旧版图谱目录、下钻、观点、事件、比较表和来源的阅读连续性在真实页面中核查。

针对性测试：各类型代表字段、direct/connected 标签、计数精确性、截断、来源安全、响应式结构、键盘操作、原有 Graph 行为。市场规模或营收面积映射属可选增强，不阻塞首版验收。

## 6. 完整验收与交付

1. 用独立 Schema 0.4 fixture 覆盖两主题、共享行业、各 canonical kind、多个时间口径、未知 Kill Criterion、受限/公开 Source、循环/坏引用和修订变化；保留无原文、无用户数据的机器化验收结果与简短人工报告。对一个真实挂载 KB 可做**只读**页面烟测，但不能把来源不可用解读为实现失败，也不能改写用户 KB。
2. 顺序运行针对性 Node/客户端测试、`npm run typecheck`、`npm run client:typecheck`、`npm run client:build`、`npm test`。测试失败只修复与本功能有关的问题，记录命令和结果。文档变更后运行 `git diff --check`。
3. 在浏览器检查桌面和窄屏布局、图与文本路径、键盘焦点、空/截断/错误状态、长表、中文字段和来源安全；界面验收需展示至少一个有内容的主题和一个稀疏主题，避免只验空壳。
4. 主代理审查全部 diff：只读边界、Schema 0.4 字段真实性、精确/非精确计数、无前端推断、无新编排层或写入路径。记录剩余限制；提交并按项目工作流推送/合入 `main`，核对远端 HEAD 与干净工作区。完成以上门槛后才宣布该产品能力闭环。

## 不通过条件

以下任一情况阻止 closure：只实现画布或视觉稿而缺少分类读取；Schema 0.4 关联数组仍为空却声称完整；把行业上下文标成主题事实；图/列表截断却展示精确全集；受限来源泄漏原文或本机路径；跨 KB revision 混合分页；用旧版 Fact/Intelligence 字段假装 Schema 0.4；仅有 fixture 组件测试而没有正常 HTTP/页面路径验证；新增 Knowledge 写入口或改变冻结 Graph 拓扑语义。
