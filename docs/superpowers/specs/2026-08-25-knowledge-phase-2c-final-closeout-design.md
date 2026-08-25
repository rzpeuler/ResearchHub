# Knowledge Phase 2C 最终产品语义收口设计

## 目标

完成两个最终语义收口：

1. 公司规模卡片面积使用公司 `total-revenue` Financial Fact，而不是细分业务营收或 `segmentRevenue`。
2. Knowledge Entity 与 View 的人类可读名称中文优先。

本次不修改 Knowledge Schema、Loader、Registry、Validation、Workflow、Plugin 或其他运行架构。

## CompanyScaleProjection

适配器针对当前 Entity 的关联公司读取其 Intelligence，筛选：

- `type: fact`
- `category: financial_metric`
- `metric: total-revenue`
- active lifecycle

每家公司选择 active 且 confidence 最高、period 最新的有效 Fact，返回原始输入：

```ts
type CompanyScaleEntry = {
  company: KnowledgeEntity
  revenue: number
  period: string
  unit: string
  sourceRefs: string[]
}
```

Projection 不返回 `segmentRevenue`、`marketShare`、`percentage`、`denominator` 或视觉权重，也不计算总营收合计。

`operates_in.attributes.segmentRevenue` 保留为未来独立的“细分业务规模”语义，但不再作为默认公司规模输入。

## 前端面积规则

页面检查所有公司条目的 `period` 和 `unit`。只有完全一致时，才用 `sqrt(revenue / maxRevenue)` 计算 CSS flex 权重；期间或单位不一致时所有卡片等权展示。页面显示“公司总营收”和简短口径提示，不显示市场份额或百分比研究指标。

## 名称本地化

Entity.name 直接作为目录、图谱和详情的唯一展示来源。以下名称改为中文：

- AI Hardware → AI 硬件
- Data Center → 数据中心
- Server → 服务器
- Liquid Cooling → 液冷
- Optical Module → 光模块
- PCB Material → PCB 材料
- PCB Manufacturing → PCB 制造

GPU、HBM、公司品牌名、产品名、技术标准名与所有稳定机器 ID 保持不变。View 名称与描述同步为中文优先。

## 验证

测试覆盖 Fact 投影、active/confidence/period 选择、不同期间或单位的等权降级、无市场份额字段、Entity.name 中文化、专业术语保留及页面静态文案。完成后执行 Knowledge 测试、集成类型检查、全量确定性测试、diff 检查及浏览器页面验证。
