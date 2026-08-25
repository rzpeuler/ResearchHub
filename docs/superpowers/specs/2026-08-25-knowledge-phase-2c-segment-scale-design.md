# Knowledge Phase 2C Segment Scale 设计

## 目标

为产业链图谱节点增加基于当前/历史 `market-size` Fact 的相对面积映射能力，与既有基于公司 `total-revenue` Fact 的公司卡片规模映射保持对称。

本设计只增加前端展示投影，不修改 Knowledge Schema、Loader、Registry、Validation、Workflow、Plugin 或其他运行架构。

## GraphProjection 输入

`ProjectionNode` 增加可选的原始市场规模输入：

```ts
type SegmentScaleInput = {
  value: number
  period: string
  unit: string
  sourceRefs: string[]
}
```

Adapter 针对每个图谱子节点读取 Intelligence，筛选 `type: fact`、`metric: market-size` 且 lifecycle 为 active 的 Fact。Fact 选择顺序为 confidence 高优先、confidence 相同时 period 较新优先、最后按稳定 ID 排序。Forecast 的 `market-size` 不作为节点当前面积输入。

Adapter 只返回原始 `value / period / unit / sourceRefs`，不计算 visualWeight、百分比、市场份额或任何行业权重。

## 前端面积规则

页面在同一层 children 中检查可用 `scaleInput`：

- 至少有一个有效 Fact，且所有可用 Fact 的 period/unit 一致：有数据节点按 `sqrt(value / maxValue)` 映射 CSS flex 权重，无数据节点使用默认基准权重。
- 可用 Fact 的 period 或 unit 不一致：整层等权。
- 没有可用 Fact：整层等权。

该面积仅服务空间展示。页面使用“节点面积按同口径已披露市场规模相对缩放；缺少可比数据时等权展示”作为说明，不展示市场份额、百分比或行业权重。

## 验证

测试覆盖 GraphProjection 读取 market-size Fact、排除 Forecast、无 Fact 时缺省、同口径缩放条件、期间/单位不一致时等权、无市场份额语义以及 CompanyScale 回归。完成后执行 Knowledge 测试、集成类型检查、全量确定性测试、diff 检查和浏览器页面验证。
