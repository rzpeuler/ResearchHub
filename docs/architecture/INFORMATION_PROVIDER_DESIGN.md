# Information Provider Architecture

## 1. 定位

Information Data Layer 是 ResearchHub 对新闻、公告、政策等非行情信息的标准化接入层。本阶段只完成架构设计，不接入真实新闻 API，不实现爬虫、NLP、情绪分析或投资评价。

目标是让信息数据具备：

- 可追溯：知道信息来自哪个 Provider、哪个来源以及何时获取。
- 可验证：结构、时间、来源类型和置信度可以进行运行时校验。
- 可扩展：新闻、公告、政策可以复用同一 Provider Framework。

## 2. 总体架构

```text
News / Announcement / Policy Capability
                ↓
ProviderRegistry
                ↓
Information Provider
                ↓
Information Source
```

Information Provider 复用现有 Provider Framework：

```ts
DataProvider<Request, InformationData>
ProviderResult<InformationData>
FinancialDataMetadata
```

Provider 负责数据获取、标准化、结构校验和来源元数据；Capability 只消费结构化信息，不直接访问外部来源。Provider 仍通过现有 `ProviderRegistry` 注册和查询。

## 3. NewsItem 数据模型

第一阶段信息领域模型为 `NewsItem`：

```ts
interface NewsItem {
  title: string
  content: string
  publishedAt: string
  source: string
  sourceType: 'official' | 'media' | 'community'
  symbols: string[]
  confidence: number
}
```

### 字段定义

- `title`：信息标题，不能为空。
- `content`：正文或规范化内容表示。本阶段不定义摘要算法。
- `publishedAt`：来源发布时间，必须是可验证的 ISO 时间戳。
- `source`：具体来源名称或来源标识。
- `sourceType`：来源层级，严格限制为 `official`、`media`、`community`。
- `symbols`：关联的 A 股股票代码，可以为空数组，表示尚未关联具体公司。
- `confidence`：Provider 对该条信息来源和字段完整性的置信度，范围为 `[0, 1]`；不代表投资收益概率，也不是情绪分数。

## 4. Provider Metadata

`NewsItem.confidence` 描述单条信息；ProviderResult 的 metadata 描述本次 Provider 结果。两者不能混用。

ProviderResult 继续使用统一元数据：

```ts
interface FinancialDataMetadata {
  provider: string
  source: string
  timestamp: string
  quality: 'high' | 'medium' | 'low'
  confidence: number
}
```

信息 Provider 返回一个或多个 `NewsItem` 时：

- `metadata.provider` 标识实现该次获取的 Provider。
- `metadata.source` 标识本次数据来源或来源集合。
- `metadata.timestamp` 标识获取时间。
- `metadata.quality` 表示本次结果的整体质量等级。
- `metadata.confidence` 表示本次 Provider 结果整体置信度。

## 5. Source Hierarchy

`sourceType` 使用受控的三层来源体系：

### official

交易所、上市公司、政府部门、监管机构和其他一手机构来源。

### media

综合新闻媒体、财经媒体和行业媒体。

### community

论坛、社区和用户投稿等非官方信息来源。

来源层级用于溯源和质量评估，不自动等同于事实真伪、投资相关性或投资结论。未来增加新的来源类别时，必须通过版本化设计决策，不允许任意字符串扩展。

## 6. Provider Interface

Information Layer 不新增独立的运行时 Provider 契约。未来 Information Provider 实现现有通用接口：

```ts
interface DataProvider<TRequest, TData> {
  readonly name: string
  fetch(request: TRequest): Promise<ProviderResult<TData>>
  validate(value: unknown): asserts value is TData
}
```

可以按领域定义 `NewsData`、`AnnouncementData` 或 `PolicyData`，但它们都必须通过 Registry 和 ProviderResult 边界接入。

## 7. Validation Boundary

本层只进行结构和来源验证：

- 必填字段与非空字符串。
- ISO 发布时间。
- `sourceType` 是否属于三值枚举。
- `symbols` 是否为规范化字符串数组。
- NewsItem 和 ProviderResult 的置信度范围。
- ProviderResult metadata 是否完整。

本层不实现：

- NLP 或摘要模型。
- 情绪分析。
- 自动事实核验。
- 投资评价、股票排名或策略优化。
- 自动交易。

## 8. Compatibility

- 现有 `NewsCapability` 和 Harness Tool 名称保持不变。
- Event Analysis Skill 继续通过既有 News Capability 边界消费信息。
- 不修改 Harness Core。
- 不修改 Market Provider 和 Provider Registry 的既有契约。
- 不接入真实新闻、公告或政策 API。
- 不新增外部依赖。

## 9. Future Extension

后续可以增加公告和政策的专用领域模型、来源 Provider、信息去重、时效策略、Evidence 关联和 Event Analysis 集成。扩展时必须继续遵守 Provider/Capability 边界，并单独决策来源许可、内容身份、更新语义和质量评估规则。

## 10. Validation Status

本设计满足以下恢复要求：

1. 新 Agent 可以理解 Information Provider 如何接入现有 Registry 架构。
2. 新 Agent 可以按 NewsItem 字段和校验规则设计后续实现。
3. 新 Agent 可以按 official/media/community 判断来源层级。
4. 新 Agent 可以明确本任务不包含真实数据接入、爬虫和 NLP。
