# Knowledge Graph 主题知识工作台设计

日期：2026-09-28
状态：已获产品方向确认，设计规格
范围：`/graph` 只读前端、Schema 0.4 主题读取投影及必要的只读 API

## 1. 目标与依据

用户从一个 `InvestmentTheme` 进入，能够看清该主题的定义、真实产业关系、直接归属的知识、沿关系可达的上下文知识，以及每条结论的时间、来源和证据。图谱负责说明结构；分类阅读区负责完整列举；Inspector 负责核对单个 canonical 对象。"完整"指当前 Knowledge Base 中按本规格直接归属主题的对象均可通过分页找到；关联上下文必须说明可证明的路径与覆盖界限，并可逐个关联对象继续浏览。不指整库对象都会被解释为主题内容。

旧版 `C:/Users/Administrator/Desktop/ResearchHub/tests/knowledge/index.html` 的目录、面包屑、层级下钻、观点、预测、比较表、公司信息、事件时间轴和来源阅读方式是交互参考；旧版 `views/ai-hardware-industry.yaml` 的分区顺序是展示参考。旧版 `Intelligence` 和事件 Fact 不直接移植为新 Schema 语义。当前依据是 `knowledge/schema/domain-v04.ts`、`docs/architecture/RESEARCHHUB_KNOWLEDGE_ARCHITECTURE_V0.4.md`、`docs/architecture/KNOWLEDGE_GRAPH_PROJECTION_ARCHITECTURE_V0.1.md` 以及现有 Graph/Knowledge 服务。

现有 `/graph` 只展示 Entity/Relation 拓扑。Schema 0.4 的 `getKnowledgeObject` 虽能读取任意单个对象，但关联数组为空；Graph 服务为 Schema 0.4 复用旧版 Entity/Relation 投影。因此只调整前端不足以达到本目标，必须补一个受界限约束的主题只读投影。

## 2. 架构边界

- `InvestmentTheme` 是主题入口；`ThemeGroup` 只是 canonical 分类与目录，不是图节点，也不生成 `contains` 关系。
- 图拓扑继续遵守已冻结的 Entity/Relation、真实边方向、1/2 跳、节点和边硬上限及只读约束。Claim、Observation、Event、Thesis、Source、Module、ReasoningEdge 出现在内容区或 Inspector，不进入现有主图拓扑。
- Person、Institution、Security 作为 Schema 0.4 Entity，可在指标、身份与关联详情中通过 canonical ref 打开；本设计不扩大当前主图的五种根/节点类型。
- 不增加第二份 Knowledge、图数据库、研究 Skill、编排层、自动摘要或写入路径。主题投影位于现有 Application read projection 层，仅从 mounted Knowledge Index 读取；任何人工决策仍在现有 Thesis/Review 服务完成。
- 页面展示不构成来源转载许可。Source 权利与 usage policy 决定原文链接、Raw 和引用内容的可见性；默认只展示许可的元数据和证据定位，不向列表响应复制 Raw 内容或原文摘录。
- Schema 0.3 可保留现有图谱体验；新增的 Schema 0.4 专属分区在 0.3 挂载时标明版本不支持，不伪造空记录或自动迁移。

## 3. 页面信息架构

桌面布局沿用三栏：左栏目录与搜索；中栏主题标题、范围、结构图和分类阅读；右栏 Inspector。窄屏按“主题标题 → 结构图 → 分类阅读 → Inspector 抽屉”重排，不隐藏知识类别。

### 3.1 左栏：目录与定位

目录按 ThemeGroup 展开 InvestmentTheme，并保留行业、公司、产品、技术的直接搜索入口。选中主题后保留面包屑；点击图节点只改变选择，执行“聚焦”才改变图根。浏览器后退恢复主题、图根、分类、筛选和选中对象。搜索结果区分 canonical 类型与名称，不把全文命中自动判定为主题成员。

### 3.2 中栏上方：主题身份与结构

标题区显示主题名称、别名、描述、`definition`、`inclusionCriteria`、`exclusionCriteria`、ThemeGroup、canonical ref、生命周期和 Knowledge Base revision。缺失字段显示“未录入”；不由模型补写。结构图沿用 `KnowledgeGraphService`，提供 1/2 跳、Entity/Relation 类型筛选、缩放、迷你图、关系方向和当前数量。被有界投影截断时显示返回数量、总数与范围说明，提供对应关系清单入口；不能让画布数量冒充整个主题的对象总数。

节点默认等尺寸。可选的市场规模/公司营收相对面积只在有直接数值证据、相同 metric、单位、期间、地理和产品范围时启用，并在界面写明“相对显示，不代表市场份额”；无法判定可比时整组等尺寸。首版交付不依赖此可选视图。

### 3.3 中栏下方：分类阅读

固定导航：概览、关系、事实与观点、指标与预期、事件、Thesis、研究模块、来源。每类有准确总数、活动筛选、稳定分页和“直接／关联上下文”范围标识。概览列出各类数量、最新已记录时间、证据缺口与图谱截断状态，概览数字只来自后端投影统计。

“事实与观点”按 Claim 类型分组；“指标与预期”区分 Metric、Estimate、Consensus；“事件”可切换按发生时间排序的列表与时间轴；“Thesis”显示状态、更新时间、论点、已确认 Kill Criterion 和 ReasoningEdge 的支持/挑战关系；“研究模块”根据已有 `columns`/`rows` 渲染表格。来源区按 canonical Source 去重，但保留它支持哪些内容项的反向引用。

### 3.4 右栏：Inspector

选择图节点、关系边或内容卡片后，Inspector 读取该对象的 canonical 详情。按对象类型呈现字段，始终显示 ref、生命周期、记录时间、关联 ref、来源和证据定位。可继续打开相邻对象，不通过前端猜测 Schema 关系。Raw JSON 仅在折叠诊断区。Thesis 的条件展示 `type`、revision、state、definition、有效时间、目标 Claim、authority 和定义 hash；未知未来 type 显示为“当前不可求值”，不渲染成已经满足。

## 4. 主题归属及“完整性”定义

主题投影必须区分两层，不能把相邻行业的全部内容当成主题自身观点。

### 4.1 直接归属

以主题 Entity ref 为锚：

- Claim 的 `subjectRefs` 含主题 ref；Observation 的 `subjectRef` 是主题 ref；Event/Thesis 的 `subjectRefs` 含主题 ref；Module 的 `targetEntity` 是主题 ref。
- Relation 的 source/target 是主题 ref，或 `contextRefs` 显式含主题 ref。展示其真实端点及属性。
- ReasoningEdge 仅在其源或目标是本层已纳入的 Claim、Observation 或 Thesis 时进入本层；需显示 canonical 源/目标与方向。
- Source 是以上记录显式引用的来源，按 ref 去重并保留被引用路径。RawRef 是证据定位，不扩张为可浏览的主题拓扑节点。

### 4.2 关联上下文

用户选择“关联上下文”时，服务先通过真实、活动的 canonical Relation 找到主题图谱深度范围内的 Entity，再列举这些 Entity 的直接记录。每项携带 `associationPath`，例如“主题 —theme_exposure→ 行业 → 指标”，并标为“关联对象的知识”。没有可证明路径、仅凭文字相似或来源相同的对象不进入结果。深度 1/2 与图相同；内容分页不受画布的 60/150 节点显示上限影响，但服务端仍对每次读取和遍历规模设硬界。达到遍历上限时标明本次关联结果不完整，并提供按真实关系逐个聚焦关联对象的入口；不得给未扫描完的集合标示精确总数。禁止未标注的递归扩散。

默认展示“直接归属”，概览同时给出关联上下文数量和入口。一个对象同时由多条路径可达时只列一次，详情保留所有本次范围内可证明的路径。切换主题、图根或关联深度后清除旧页游标；筛选仅缩小结果，不改变成员判定。

### 4.3 生命周期和时间

普通视图默认活动 canonical 内容；Thesis `status` 与对象 `lifecycle.status` 分开显示，不能把 `invalidated` Thesis 误判为不存在。历史/失效对象的查阅为显式筛选，必须保留状态和时间标记。时间标签分别使用发生、公告、报告期间、发表、研究 `asOf`、系统记录时间；无字段时不推断。日期排序须指定所用字段，缺少该字段的记录置于“时间未提供”。来源发表 PIT 不等于数值版本 PIT。

## 5. Schema 0.4 呈现规则

| 对象 | 列表关键字段 | 精读关键字段及防误读规则 |
| --- | --- | --- |
| Entity/ThemeGroup | 名称、类型、范围、身份 | `externalIdentifiers` 的命名空间、有效期和来源；ThemeGroup 只在目录。 |
| Relation | 类型、真实起点→终点、`asOf` | 主题敞口、业务敞口、财务贡献或持股属性按其实际 Relation 类型展示；不反转、不合成边。 |
| Claim | claimType、statement、时间、来源数 | `structuredValue`、confidence/probability、支持/依赖/矛盾/取代 refs；forecast 与 fact 清晰区分。 |
| Metric Observation | metricRef、value、unit、period | dimensions、observedAt/reportedAt/asOf、来源与 Raw 定位；不跨口径自动画趋势。 |
| Estimate Observation | metricRef、estimateValue、fiscalPeriod、机构 | analyst、publishedAt、revisionOf、币种/单位和来源；修订链需显示顺序。 |
| Consensus Observation | metricRef、mean、count、asOf | median/high/low/dispersion 与贡献 Observation refs；不能把汇总值当单机构报价。 |
| Event | eventType、title、发生/公告时间 | subject/participant refs、sourceRefs；时间轴按明确选择的时间字段定位。 |
| Thesis | title、statement、status、lastReviewedAt | subjectRefs、Kill Criterion 的权威与版本、ReasoningEdge 因果链；Graph 窗口只读。 |
| Module | type、targetEntity、schemaId | 有 `columns`/`rows` 才显示动态表；无数据标明缺失。 |
| Source | title、publisher、sourceType、publishedAt | provider、canonicalUrl、retrievedAt、contentHash、rights/usagePolicy、Raw refs；权利不允许时不暴露原文/Raw。 |

显示链接只接受安全的 HTTP(S) canonical URL。业务上“无记录”“未加载”“访问受限”“数据不可比较”“对象已失效”“列表已截断”是不同状态，各有独立文案。

## 6. 只读服务与 API 契约

新增一个有界的 `KnowledgeTopicProjectionService`，属于现有 Application Services 的读投影，而非新架构层。它使用 Schema 0.4 `KnowledgeIndexV04` 的 canonical 对象和引用查询，不使用 LLM，不写入 Knowledge，也不缓存一份持久化主题数据。现有 `KnowledgeGraphService` 继续负责目录/主图；现有 `KnowledgeService.getKnowledgeObject` 继续负责单对象读取。

建议接口：

```text
GET /api/knowledge/topics/{encodedThemeRef}/summary?depth=1|2
GET /api/knowledge/topics/{encodedThemeRef}/items?kind=...&scope=direct|connected&depth=1|2&limit=...&cursor=...&filters=...
```

`summary` 返回 `knowledgeBaseId`、`schemaVersion`、`revision`、主题身份、按 kind/scope 的 `total`、`totalExact` 与范围/截断说明。直接归属的总数必须精确；关联上下文达到遍历上限时 `totalExact=false`，界面显示“至少 N 项”。`items` 返回同一 revision、规范化轻量条目、`total`、`totalExact`、`limit`、`nextCursor`、`truncated` 和每条目的 `associationPath`。精读由对象接口按 ref 获取，前端不能用列表条目替代 canonical 详情。分页按确定的日期键加 canonical ref 排序；无日期使用 ref，避免顺序漂移。游标绑定 KB id、revision、themeRef、scope、kind、depth 与筛选；revision 改变时服务拒绝旧游标，前端提示刷新并从第一页重新读取，不能混排不同修订的数据。

响应不可包含全部 Raw、原文引文或未脱敏的本地路径。对没有 mounted KB、非 0.4 KB、非 InvestmentTheme 根、失效根、非法筛选、失效游标、引用损坏和权限不允许的场景返回可辨识错误/状态。摘要可以批量计数，但每次返回的条目数、上下文遍历规模和序列化体积必须有服务端硬上限；到达界限时明确报告未覆盖的范围，而不是宣称“全部”。

## 7. 交互与可用性

- 主题/图根/深度/分类/范围/筛选写入可分享 URL；选中项可写入 URL，但不得暴露本机文件路径或私密来源地址。
- 图节点与内容项均可键盘选择；有可见焦点、语义标签、文本版关系清单。颜色不作为对象类型或风险状态的唯一编码。
- 首屏先绘制主题身份、数量和有界图；分类内容按需获取。切换主题时取消旧请求，避免旧主题数据闪现。异常只影响相应分区，不让整个页面空白。
- 移动端优先保证目录、文本清单、Inspector 可读；图画布可折叠。长表可横向滚动，并保留表头与字段标签。

## 8. 验收与范围

用隔离的 Schema 0.4 Knowledge Base 构造至少两个主题、一个共享行业、一条主题专属 Claim、一条仅行业归属 Observation、Event、Estimate/Consensus、Thesis/ReasoningEdge、Module、不同权利的 Source 和失效记录。验证：直接/关联上下文不混淆；共享对象去重且保留路径；图边方向不变；各类别总数与分页枚举一致；分页期间 revision 变化不会混页；未知 Kill Criterion 不被显示为命中；受限来源无原文泄露；空/截断/权限/错误状态不同；键盘与窄屏可用。前端组件测试覆盖分区映射和状态，服务测试覆盖成员规则与界限；最后用页面实际渲染核对旧版阅读路径。

首版不新增 Knowledge 写入、Review 决策、自动来源总结、主题自动分类、图数据库、任意跨主题全库图、未知 Kill Criterion 的求值，也不把旧版静态 YAML 视图配置变成新的 canonical schema。设计完成后应先实现读投影与契约，再接入分类阅读及 Inspector，最后做响应式和视觉验收。
