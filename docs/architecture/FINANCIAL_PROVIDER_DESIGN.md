# Financial Data Provider Framework

## 1. 定位

Financial Data Provider Framework 是 ResearchHub 金融能力层的数据接入边界。它把领域 Capability 与具体数据来源隔离，使 Market、News、Financial、Institution 等能力可以复用同一套 Provider 契约，而不把某个外部数据源写死在 Capability 中。

本版本是 MVP，只有确定性的 Mock Provider。它用于验证架构和数据追溯，不代表真实金融数据接入已经完成。

## 2. 架构

```text
Agent / Skill
    ↓
Capability
    ↓ typed ProviderHandle
ProviderRegistry
    ↓
DataProvider adapter
    ↓
External data source (future)
```

- Capability 定义领域操作和 Harness Tool 名称，例如 `get_market_snapshot(symbol)`、`search_company_news(symbol)`。
- Provider 负责获取、标准化、验证领域数据，并返回来源元数据。
- Registry 负责进程内 Provider 注册、命名查找和类型安全的 Handle 查找。
- Capability 只持有 Registry 与类型化 Handle，不导入或实例化具体 Provider。

## 3. DataProvider Interface

`packages/providers/core/` 定义通用契约：

```ts
interface DataProvider<TRequest, TData> {
  readonly name: string
  fetch(request: TRequest): Promise<ProviderResult<TData>>
  validate(value: unknown): asserts value is TData
}
```

每个结果使用统一 envelope：

```ts
interface ProviderResult<TData> {
  data: TData
  metadata: {
    source: string
    timestamp: string
    quality: 'high' | 'medium' | 'low'
    confidence: number
  }
}
```

Registry 在结果离开 Provider 边界前验证 envelope、时间戳、质量枚举、置信度范围以及 Provider 自身的数据 Schema。

## 4. Provider Registry

`ProviderRegistry` 是当前 MVP 的进程内注册表：

- `register(provider)` 注册 Provider，并返回绑定其请求/数据类型的 `ProviderHandle`。
- `get(handle)` 返回类型化 Provider；未知或伪造 Handle 会被拒绝。
- `get(name)` 仅用于非类型化管理查找，返回 `unknown` 数据边界，不能绕过类型安全。
- `has(name)`、`list()` 用于注册状态检查。
- 重复名称和未知 Provider 都会产生明确错误。

动态加载、跨进程注册、凭证管理、健康检查、限流和故障转移不属于本 MVP。

## 5. 当前 Provider Adapters

规范实现位于 `packages/providers/adapters/`：

- `MockMarketProvider`：返回确定性的行情快照。
- `MockNewsProvider`：返回确定性的公司新闻证据。

`packages/capabilities/providers/` 保留兼容性 re-export，避免已有验证代码的导入路径突然失效；新的组合入口使用 `createMockProviderComposition()`，在应用边界创建 Registry 并注册两个 Mock Provider。

## 6. Capability Bridge

Market 与 News Capability 保持原有 Harness 名称和领域字段，同时投影 Provider 元数据：

- Market 输出保留 `symbol`、`price`、`change`、`volume`、`source`，并要求 `timestamp`、`quality`、`confidence`。
- News 输出保留 `symbol`、`items`，每条新闻保留来源、时间戳和置信度，并要求结果级 `source`、`timestamp`、`quality`、`confidence`。

因此上层 Skill 继续面向领域 Capability，不感知 Registry 的内部结构，但每次数据使用都保留可追溯上下文。

## 7. 验证范围

已验证：

- `DataProvider` 契约和 Financial Data Metadata 运行时校验。
- Provider 注册、类型化 Handle 查询、重复/未知 Provider 错误。
- Mock Market/News Provider 通过 Registry 被 Capability 调用。
- Capability 输出保留原有 Harness 工具名并包含来源元数据。
- Event Analysis、Artifact、Memory、Evaluation 和 Harness Session 集成链路不被破坏。

未验证：

- Tushare、Wind、聚宽、AkShare、东方财富等真实数据源。
- API 凭证、配额、限流、重试、数据新鲜度监控和跨 Provider 故障切换。
- 真实行情的质量评估、复权处理和交易日历一致性。

## 8. 后续演进

后续新增数据源应实现同一 `DataProvider` 契约，通过 Registry 注册，并在 Capability 层保持稳定的领域输出。真实 Provider 接入前，必须单独验证授权、数据许可、字段语义、时间基准、错误处理和测试替身，不得把外部 SDK 直接引入 Capability。
