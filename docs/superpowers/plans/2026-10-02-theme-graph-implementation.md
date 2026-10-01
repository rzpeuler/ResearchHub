# Theme Framework 与 Knowledge Graph 工作台实施计划

日期：2026-10-02
依据：`docs/superpowers/specs/2026-10-02-theme-knowledge-graph-workspace-design.md`
分支：`codex/theme-graph-workspace`

## 执行规则

- 以 Schema 0.4 / Storage Format 1 的全局 KB 为目标；所有 canonical 写入经 ChangeSet 校验和 Writer。报告、来源和治理决定均须可追溯。
- 工作按下面的依赖顺序推进；每项完成后检查实现、运行直接相关的确定性测试，再进入下一项。领域判断、Schema 取舍和最终验收由主 agent 负责；边界清楚的实现与测试交给 Luna 子 agent。
- 现有 0.3 KB 保持原样；用原始资料经新版流程重新入库验证 0.4，不静默迁移、不覆盖本地运行数据。
- 用户已批准设计。实施中只有出现未定产品／安全／数据丢失决策才停下询问；普通实现选择按规格与架构处理。

## A. Knowledge 生产基础

### A1. Competition Module 的类型契约

在 `knowledge/schema/` 定义版本化 `competition` Module 行列与单元格契约。4–7 列；基础列包含公司、主要产品、市值、最新年报营收，另外 0–3 列由行业研究选择；行绑定 Company，非空单元格绑定已有或本次提交的 canonical Claim／Observation／Relation，保留时间、单位与证据。不允许自由 JSON 逃逸、无对象引用的数值、重复列／公司、错误日期或不一致单位。为纯验证函数编写正常、缺项、错误引用和不可比场景测试。

### A2. Module 进入共用 Knowledge Production 路径

扩展 `knowledge/production/contracts.ts`、`gateway.ts` 及必要的 Schema 0.4 校验，使研究生产者能提交 Module 本地提案键，由 Gateway 解析 Company／Industry／单元格引用、查重或更新同一目标行业表格，生成 ChangeSet 并交 Writer。输出本地 proposal 到 canonical Module ref 的映射。验证重复提交幂等、坏引用阻断、Writer 失败不报告成功、已有数据不被无证据覆盖。不得在 Skill 内直接写 KB。

### A3. ThemeGroup 与 Theme 创建能力

在现有 0.4 KB 初始化和生产路径上提供默认 ThemeGroup；保持 `themeGroupRef` 有效。增加由明确 Theme Framework Workflow 意图驱动的 Theme 创建／更新能力，名称必填，定义和范围条件可选，禁止原始资料写入自动创建 Theme。ThemeGroup 新建、移动和删除非空组时的迁移走受验证的写入路径。覆盖空 KB、重试、同名解析、缺组、非空删除目标组缺失等测试。

### A4. Theme 范围决策治理记录

在 `knowledge/` 的治理域新增版本化记录与持久化接口：候选节点／连接、跨运行稳定指纹、include／exclude／pending、理由与证据、审阅状态、所依据 KB revision、前版本及新证据重开依据。读取能得到每个候选的当前决定与历史；相同证据不重复提示排除项。接受纳入时，将范围记录与 canonical ChangeSet 按同一 revision 绑定；提交失败不得显示半成品，提交后意外中断可幂等恢复。使用临时 KB 测试路径安全、冲突、重放和恢复。

### A5. 从空环境写入 Schema 0.4

使首页附件／写入入口能在新建的 0.4 KB 中完成原始资料入库，且不要求 Theme。现有文档解析和 Knowledge Curation 可复用，但必须通过 Schema 0.4 Proposal／Gateway／Writer，不复活固定 chunk→batch→extract 架构。保留 Source／Raw、权限和筛选决策。0.3 KB 显示明确的不兼容状态；原始文件仍可向新的 0.4 KB 重写入。用真实 PDF 路径与隔离 KB 验证 Source、Raw、知识对象和 revision，不把报告候选等同于已接受知识。

## B. Theme Framework 首次闭环

### B1. Theme Framework Skill

新增独立 ResearchHub Skill，输入 Theme 名称／可选定义、现有 KB 摘要、有界资料、既有范围决定；输出可独立研究且粒度一致的 Industry 候选、真实方向的关系候选、跨链和独立节点、纳入／排除／待处理建议、边界理由、证据与覆盖缺口。不得以固定跳数无限上溯、制造无证据边、调用 Writer 或调度其他 Skill。验证 PCB→铜箔／电子布边界、存储→消费电子排除、交叉连接及数据中心基建服务独立节点。

### B2. Construction Workflow 与 Chat 审阅

Workflow 以 Theme 名称启动，先查 KB，再通过既有 Plugin 获取有界外部资料并调用 Skill；资料上传可选。Chat 展示按分支分组的候选和理由，用户可批量接受并逐项调整节点／连接的 include／exclude／pending。接受结果通过 A3/A4/A2 的受治理写入路径创建 Theme 与确认网络。待处理不阻断首次创建，且不会进入正式图谱。测试用户接受、拒绝、部分接受、重试及来源不可用。

## C. 研究产出与展示投影

### C1. 行业竞争格局输出

扩展现有 `industry-research` 的 `competitive_landscape` 模块输出 A1 契约所需的紧凑表格，不加独立 Skill。表头由行业语义选择，基础字段优先；市值以可核实交易日、营收以最新年报财年为准；无值或口径不合时留空并说明。Workflow 将本地对象／证据键交 A2 解析写入。测试动态列、空值、不可比和重跑更新。

### C2. 主题只读投影

扩展现有 Application read projection，按已确认范围读取行业节点与获准关系，只显示 canonical 事实，不自动沿全局上下游边扩张 Theme。按行业研究八模块与公司研究十九章节组织可用知识；按 revision 缓存或重建语义归类与排序结果，失效时显式显示状态。核心观点默认三条、可展开；事件与未来催化剂分开标时，发生日未知时明确使用“资料发布日期”。查询受服务端界限、分页、来源权利与 revision 约束。

### C3. 产业／公司研究知识更新

校正现有研究报告到 Knowledge 的写入映射：报告为快照，只有符合证据、Schema 与筛选规则的 Claim／Observation／Event／Relation 等进入 canonical；语义缺口保留为报告材料或 Review，不把整份资料赋予 Theme 归属。Company／Industry 对象在多个 Theme 中平等复用。用研究重跑、冲突和版本更新测试 Graph 投影刷新。

## D. 页面与维护闭环

### D1. `/graph` 主题工作台

左侧 ThemeGroup／Theme 目录；图谱横跨中、右列顶部；下方中列产业／公司信息，右列核心观点／时间链。Graph 仅行业节点，允许交叉／独立节点，整页滚动。点击行业更新产业、表格、上次公司或首家公司及右侧；点击公司只更新公司／右侧，图选择不变。处理空表、无 KB、旧 revision、截断、权限和移动端。测试状态联动和实际浏览器视觉。

### D2. 资料上传交互

首页 Chat 输入区支持粘贴和拖动允许格式的文件；保留手动写入选择和 Agent 意图识别。上传不要求 Theme；有 Theme 上下文也不批量改写 Source 或知识主语。移除冗余常驻附件区，必要的范围问题在 Chat 提问。验证上传、取消、超限、无 KB 与非授权写入状态。

### D3. 新知识影响检查

canonical 写入成功后，按变化对象和关系 ref 限定可能受影响的 Theme，检查候选边界变化；只在有新证据可能改变节点或连接决定时创建 Chat 提案。已排除节点无新证据不重复提醒；人工接受后通过 A4/A3 写入，拒绝和待处理保留。测试幂等、无关写入、证据增量、旧 revision 冲突和提交失败。

## E. 端到端验收与交付

从空 Schema 0.4 KB 开始，以“AI 算力”名称建 Theme；真实资料写入与行业／公司研究产生 canonical Knowledge；Theme 框架包含交叉、独立、排除、待处理；浏览器实际显示图、竞争表、公司和右侧内容；新证据触发人工范围变更并刷新。运行 `npm run typecheck`、`npm run client:typecheck`、直接相关单测、`npm run client:build` 和适用的 acceptance；扩大测试范围仅为解决具体风险。审查 diff、文档与证据，提交后 fetch 验证远端并按仓库流程合入 main／推送。
