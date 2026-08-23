# Market Provider Design

## 1. 目标与边界

本阶段将 Market Capability 背后的数据来源从 Mock 扩展为两个真实 Provider：

```text
Market Capability
        ↓ unchanged interface
ProviderRegistry
        ↓
Market Provider Composition
        ↓
TushareMarketProvider / AkShareMarketProvider
```

Market Capability 不直接调用 Tushare、AkShare 或任何 HTTP endpoint，也不包含认证逻辑。它继续使用既有的 `get_market_snapshot(symbol)` 接口。真实 Provider 的完整来源信息保留在 `ProviderResult.metadata` 中，不改变上层 Capability 输出契约。

## 2. 统一数据模型

Provider 内部统一返回：

```ts
{
  data: {
    symbol: string,
    price: number,
    change: number,
    volume: number,
    source: string
  },
  metadata: {
    provider: string,
    source: string,
    timestamp: string,
    quality: 'high' | 'medium' | 'low',
    confidence: number
  }
}
```

`ProviderRegistry` 在结果离开 Provider 边界前执行 JSON-safe、字段、时间戳、质量和置信度校验，并返回防御性副本。

## 3. Tushare Provider

- Provider 名称：`tushare-market`。
- 默认 endpoint：`https://api.tushare.pro`，可由 `TUSHARE_ENDPOINT` 覆盖。
- 凭证：`TUSHARE_TOKEN`，不会写入代码、日志或错误信息。
- 调用：原生 `fetch` POST Tushare `daily` API。
- 字段转换：`ts_code → symbol`、`close → price`、`change/pct_chg → change`、`vol → volume`。
- 响应错误、空数据、非数值、无效日期和非 2xx 响应都会转换为 Provider 错误。

## 4. AkShare Provider

- Provider 名称：`akshare-market`。
- endpoint：必须通过 `AKSHARE_ENDPOINT` 配置；本仓库不假设存在稳定的官方 AkShare REST endpoint。
- 传输：原生 `fetch` 调用独立的 AkShare-compatible HTTP bridge。
- 字段转换：支持 `code`、`收盘`、`涨跌额`/`涨跌幅`、`成交量` 等 bridge 返回字段，并统一为 Market Provider 数据模型。
- 未配置 endpoint 时明确返回 disabled/provider error，不静默使用 Mock。
- bridge 返回的错误信息、JSON parse error 和 endpoint userinfo 均会脱敏。

## 5. 配置

```text
TUSHARE_TOKEN=
TUSHARE_ENDPOINT=https://api.tushare.pro
AKSHARE_ENDPOINT=
MARKET_PRIMARY_PROVIDER=tushare-market
MARKET_FALLBACK_PROVIDER=akshare-market
MARKET_PROVIDER_MODE=real
```

真实模式下禁止选择 `mock-market-provider`。Primary Provider 必须具备所需 Token/endpoint；Fallback 为可选配置，且必须与 Primary 不同。配置对象即使绕过环境变量读取函数直接传入，也会再次进行 Provider 名称、endpoint、协议和 userinfo 校验。

## 6. Primary/Fallback 策略

`createMarketProviderComposition()` 在 Registry 中注册已配置的 Tushare/AkShare Provider，并返回一个供 Capability 使用的组合 Handle：

1. 调用 Primary。
2. Primary 失败且配置了 Fallback 时调用 Fallback。
3. 两者均失败时抛出包含两个 Provider 名称和原因的组合错误。
4. 成功结果保留实际 Provider 的 `metadata.provider`，便于追踪是否发生 fallback。

Fallback 不是 Mock 替代机制，也不会掩盖真实 Provider 的配置错误。

## 7. 测试与当前验证

测试使用注入的 fetch transport、clock、Provider adapter 和固定响应 Fixture，不访问网络、不需要 Token：

- Tushare 正常响应、`ts_code` 转换、API/HTTP/JSON 错误和凭证脱敏。
- AkShare 正常响应、中文字段转换、缺失 endpoint、bridge/JSON 错误和脱敏。
- 严格日期校验，拒绝日期 rollover、locale 日期和无时区时间。
- Primary 成功、Primary 失败后 Fallback 成功、双 Provider 失败。
- 既有 Market Capability、Event Analysis、Artifact、Memory、Evaluation 和 Harness 集成测试继续通过。

## 8. 后续风险

当前 MVP 证明的是 Provider 结构和标准化链路，不等于生产数据质量已经被证明。真实启用前仍需验证 Tushare 权限、AkShare bridge 运维、数据许可、行情延迟、交易日历、复权口径、限流、重试、监控和数据新鲜度。
