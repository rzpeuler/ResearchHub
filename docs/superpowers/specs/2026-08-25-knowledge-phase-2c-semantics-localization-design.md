# Knowledge Phase 2C 语义与本地化设计

## 目标

收口 Knowledge 前端的两个表达问题：

1. 将“Market Share / 市场份额”改为基于可比业务营收的“公司规模 / 业务规模”视觉映射。
2. 将面向研究人员的 Production Knowledge 内容统一为中文优先，同时保留稳定机器契约和行业通用专业名称。

本设计不新增 Knowledge 架构、计算引擎、数据库或本地化框架。

## 公司规模投影

`KnowledgeViewAdapter` 输出 `CompanyScaleProjection`，只携带关系中已有的原始业务营收信息：

```ts
type CompanyScaleProjection = {
  segmentId: string
  entries: Array<{
    company: KnowledgeEntity
    segmentRevenue: number
    period: string
    unit: string
    revenueScope: string
  }>
}
```

投影层不计算合计、市场份额、百分比或行业集中度。`segmentRevenue` 只作为前端视觉映射输入。

前端仅在所有企业的 `period`、`unit` 和 `revenueScope` 一致时计算相对卡片面积，使用 `sqrt(revenue / maxRevenue)` 做视觉压缩。该结果只写入 CSS 样式，不作为研究指标展示。口径不一致、字段缺失或无法比较时，所有卡片使用等权面积。

## 前端语义

- 区块标题使用“公司规模”或细分环节下的“业务规模”。
- 表格展示企业、上市状态、股票代码、业务营收及公司特征，不展示市场份额百分比。
- 页面使用中文研究文案；Entity、Relation、Intelligence、Module 等稳定技术词可保留在辅助元信息中。
- 生产数据直接驱动页面，不恢复旧版静态 Mock JSON。

## 中文优先规则

- ID、namespace、YAML key、TypeScript/API key、枚举、relation type、module type、metric ID 保持英文且不改名。
- Entity 的 A 股公司可见名称使用中文简称；海外公司保留 NVIDIA、AMD、Micron、Samsung、SK hynix 等官方品牌名。
- Entity 描述、标签、Intelligence 研究文本、Module 展示内容和 View 名称/描述使用自然中文。
- GPU、CPU、HBM、PCB、CCL、CPO、NPO、AI、Rubin、Blackwell、Hopper、MI300、MI350 等专业缩写、产品名和技术标准保留规范写法。
- Source 的官方标题、publisher、URL 和 provenance 不改；ResearchHub 自己编写的描述使用中文。

## 验证

测试覆盖投影字段、无市场份额语义、可比/不可比卡片策略、View section 迁移和关键研究文本中文化。完成后执行知识测试、集成类型检查、全量测试、Markdown diff 检查及页面静态检查。
