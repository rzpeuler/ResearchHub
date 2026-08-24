# Knowledge Layer 产业图谱验证原型记录

## 目标与范围

本原型使用 AI Hardware Industry Graph 验证 Knowledge Layer 的最小数据结构与前端展示需求。它不是正式 Knowledge System，不引入 Knowledge Database、Graph Database、RAG 或 LLM Extraction。

当前实现只使用四类核心对象：

- Entity：产业、产业环节、公司
- Relation：包含、上下游、公司业务、股权/项目关联
- Event：事件及其影响的 Entity
- Research：研究对象及其关联 Entity、可打开文档链接

全部市场规模和营收均为 mock 数据，仅用于验证相对面积映射与交互路径。

## 数据模型问题

### 1. Node 模型是否支持产业链展示？

支持，但 Node/Entity 需要区分 `industry`、`segment`、`company` 三种展示角色，并允许以下可选字段：

- `marketSize` / `marketSizeUnit`：产业环节的相对面积指标
- `listingStatus` / `ticker` / `exchange`：公司上市状态
- `financials.totalRevenue`：公司总营收 mock 值
- `profile`：产品类型、客户群体、技术壁垒、大客户认证

Node 本身不保存父节点。嵌套层级由 `contains` Relation 负责，避免同一节点的层级被 Entity 与 Relation 重复表达。

### 2. Relation 模型是否支持上下游？

支持。方向关系使用：

- `upstream_of`
- `downstream_of`

嵌套容器使用独立的 `contains`，不要把所有上下游都误当作包含关系。例如 HBM → GPU、GPU → Server 可以是上下游，但 Data Center 包含 Server 是展示层级。

公司与环节的业务营收使用 `operates_in` Relation，关系上保存 `segmentRevenue`、`period`。因此同一公司可以关联多个环节，也可以在不同环节拥有不同业务营收。

### 3. Research 如何关联 Entity？

Research 使用 `entityIds: string[]` 关联一个或多个 Entity。前端点击节点后筛选命中的 Research：

- 有 `url` 或 `documentPath`：显示“打开研报”链接
- 没有链接：仍显示标题、摘要和日期，但不显示可点击入口

本原型用 `documentPath` 指向 `tests/knowledge/` 下的本地 mock 文档。

### 4. Event 如何影响 Entity？

Event 使用 `affectedEntityIds: string[]` 表达影响对象，并以 `impact` 和 `summary` 描述影响方向与内容。产业全景展示全部事件，行业/公司节点只展示直接关联事件。

### 5. 非上市公司如何表达上市关联？

公司 Entity 用 `listingStatus: "private"` 标识非上市公司。上市公司与非上市公司的关联仍是 Relation：

- `owns_stake_in`：股权穿透
- `project_partner_of`：项目合作
- `project_investor_of`：项目投资

关系可选携带 `ownershipPercent`、`projectName`、`segmentEntityId`，侧栏只展示与当前业务环节相关的上市关联。

## 前端需求发现

1. 主视图采用“左侧图谱 + 下方节点信息 + 右侧事件时间轴”的布局，节点资料与市场份额可以连续阅读。
2. 产业链不是单层横向列表，需要支持 Data Center → Server → GPU / Liquid Cooling / Rack Assembly 的嵌套进入。
3. 面包屑必须保留当前路径，帮助用户知道正在查看哪个产业环节。
4. 节点面积可以映射 `marketSize` 相对值，但必须在页面上标注 mock 口径，避免被误解为真实市场规模。
5. 节点信息中的市场份额图表常驻。公司块面积按该公司在当前环节的 `segmentRevenue` 分配，同时显示总营收、业务营收和市场份额，并提供企业对比表。
6. 公司卡片除了营收，还需要展示产品类型、客户群体、技术壁垒和大客户认证；完整内容放入常驻侧栏。
7. 研报链接是节点详情的必要出口。没有链接的 Research 仍然可以作为关联证据展示。
8. 非上市公司不能只显示一个状态徽标，用户还需要在侧栏看到股权穿透、项目合作、项目投资等上市关联。
9. 事件时间轴常驻在右侧，节点信息不重复展示关联事件，避免同一事件在两个区域重复出现。
10. 行业 Entity 可以通过可选 `knowledge` 字段提供简介、市场规模预测、产品对比、名词科普和图片引用；没有图片数据时不渲染图片区域。

## 后续 Schema 建议

正式 Schema 可以在本原型基础上继续演进，但建议保持四类核心对象不变：

```ts
Entity {
  id, type, name,
  marketSize?,
  listingStatus?, ticker?, exchange?,
  financials?,
  profile?,
  knowledge?, coreView?
}

CoreView {
  bullish?, bearish?, contradictions?, logic?
}

IndustryKnowledge {
  description?, marketForecast?, productComparison?,
  glossary?, images?
}

Relation {
  id, fromEntityId, toEntityId, type,
  segmentRevenue?, period?,
  ownershipPercent?, projectName?, segmentEntityId?
}

Event {
  id, title, occurredAt, startedAt?, endedAt?, summary,
  affectedEntityIds, impact
}

Research {
  id, title, type, summary, publishedAt,
  entityIds, url?, documentPath?
}
```

后续正式化时需要进一步明确：

- `marketSize` 的真实单位、时间范围和币种
- `segmentRevenue` 的财务口径、合并范围和审计来源
- 一个 Entity 是否允许多个 `contains` 父节点，以及如何表达不同视角下的产业树
- Event 的影响是否需要强度、时间区间和证据引用
- Research 链接权限、文档版本和 provenance 关联
- 上市关联是否需要股权链的多跳穿透与持股比例累积计算

这些问题不在本原型范围内，当前仅保留足够支撑前端验证的字段。

## 本轮 UI 与 Mock 修正

- `productComparison` 当前只用于展示当前产业环节内部的产品变体，例如训练型 GPU、推理型 GPU，或高速覆铜板、高频覆铜板；不再把上游/下游环节当作该表格的产品行。产品对比表仍是可选字段，表头暂按原型 Mock 固定为“产品 / 典型场景 / 差异化要素”。
- 行业信息与公司信息分层：行业简介、预测、产品对比、名词科普和图片位于市场份额之前；市场份额图和企业对比表位于其后；点击企业卡片或表格行只切换表格下方的公司详情，不覆盖行业信息。
- Research 按关联 Entity 分层展示：行业/产业环节的研报放在行业知识信息之后、市场份额之前；公司的研报放在公司详情内部，跟随公司画像和上市关联展示。
- Entity 增加可选 `coreView`，右侧时间轴上方展示当前节点或公司的看多、看空、核心矛盾和驱动逻辑；点击公司时观点窗口和事件时间轴同步切换到该公司。
- Event 使用 `occurredAt` 作为事件发生点，时间轴按连续日期坐标定位圆点；`startedAt` 与 `endedAt` 暂保留为未来的影响区间字段，不参与当前事件点的视觉长度。
- 事件时间轴采用右侧纵向布局，时间从上到下递增；页面顶部搜索框按文档 `Ctrl+F` 的文本匹配逻辑搜索当前可见内容，并提供高亮、匹配计数和上下匹配导航。
- 页面布局调整为“左侧申万一级行业目录 / 中间图谱与节点详情 / 右侧核心观点与事件时间轴”，核心观点和时间轴拆为两个独立窗口。
- `industry-directory.json` 作为轻量目录索引，包含 31 个申万一级行业；当前 AI Hardware Mock 图谱挂载在“电子”下，其他行业保留目录入口但暂未接入图谱。
