# ResearchHub Financial Data Plugin Framework MVP

## Status

Approved design for RH-DESIGN-004. This specification establishes the standard Plugin boundary without connecting a real financial API, crawler, commercial data source or Harness Core.

## Goal

Replace the current direct Plugin → Mock Plugin relationship with a reusable:

```text
Plugin
    ↓
Plugin Registry
    ↓
Data Plugin
    ↓
External Source (future)
```

The framework must preserve source metadata, allow multiple plugins per plugin, and keep DSH-facing Harness Tool contracts stable.

## Chosen Architecture

Use one process-local typed Plugin Registry and Plugin-specific bridges:

```text
MarketPlugin / NewsPlugin
            ↓ plugin name
      PluginRegistry
            ↓
    DataPlugin<TRequest, TData>
            ↓
    PluginResult<TData>
```

Plugins do not import or instantiate a concrete Plugin. They resolve a named Plugin from the Registry, call its `fetch()` method, validate the returned data, and project Plugin metadata into the existing domain output shape.

## DataPlugin Contract

```ts
type FinancialDataQuality = 'high' | 'medium' | 'low'

type FinancialDataMetadata = {
  source: string
  timestamp: string
  quality: FinancialDataQuality
  confidence: number
}

type PluginResult<TData> = {
  data: TData
  metadata: FinancialDataMetadata
}

interface DataPlugin<TRequest, TData> {
  readonly name: string
  fetch(request: TRequest): Promise<PluginResult<TData>>
  validate(value: unknown): asserts value is TData
}
```

Contract rules:

- `name` is stable and unique within a Registry.
- `fetch()` owns source access and source-specific error translation.
- `validate()` rejects malformed plugin data before it crosses the Plugin boundary.
- `metadata.source` identifies the data source or fixture.
- `metadata.timestamp` is the observation or plugin response timestamp.
- `metadata.quality` is a coarse source-quality classification.
- `metadata.confidence` is a finite number in `[0, 1]` and describes data confidence, not investment confidence.
- No Plugin performs DSH orchestration, investment reasoning or trading.

## Plugin Registry

`PluginRegistry` is a small in-process lookup boundary:

- `register(plugin)` adds a Plugin by its stable name.
- `get<TRequest, TData>(name)` resolves a Plugin for a Plugin bridge.
- `has(name)` checks availability.
- `list()` returns registered Plugin names.

The Registry rejects duplicate names and unknown lookups. It does not load modules dynamically, discover remote services, or manage external credentials. A future application composition root may register Tushare, Wind, JoinQuant, AkShare or Eastmoney adapters without changing Plugin logic.

## Mock Plugin Migration

New canonical locations:

```text
packages/plugins/
├── core/
├── registry/
└── adapters/
    ├── mock-market-plugin.ts
    └── mock-news-plugin.ts
```

The existing deterministic Mock fixtures move behind the DataPlugin contract. Compatibility exports may remain at the old Plugin paths so existing imports do not break, but the production Plugin path resolves them through `PluginRegistry`.

No real data source is introduced in this task.

## Plugin Projection

The existing Harness Tool names remain unchanged:

- `get_market_snapshot(symbol)`
- `search_company_news(symbol)`

Plugins continue to return domain-oriented objects rather than exposing a raw `{data, metadata}` envelope to DSH:

- Market output keeps `symbol`, `price`, `change`, `volume` and `source`, and adds observation `timestamp`, `quality` and `confidence` fields.
- News output keeps `symbol` and `items`; each item retains its source/timestamp/confidence, and the result exposes the Plugin quality metadata without exposing Registry details.

This is a compatibility-preserving projection: the DSH sees the same operation names and core fields, while every response carries traceability information.

## Error Handling

- Registry errors identify duplicate registration or unknown Plugin names.
- Plugin errors preserve the Plugin name and source context.
- Plugin errors continue to use `PluginExecutionError` with normalized input and Plugin name.
- Invalid Plugin data or metadata is rejected before returning a Plugin result.
- A failing Plugin is not silently replaced by another Plugin.

## Validation

Tests must cover:

- DataPlugin metadata and output validation.
- Registry registration, lookup, duplicate and unknown-plugin errors.
- Mock Market and News Plugin migration.
- Plugin resolution through Registry rather than concrete Plugin imports.
- Metadata projection into Market and News outputs.
- Existing Skill, Artifact, Memory, Evaluation and Harness integration suites.

## Explicit Non-Goals

- Real financial API access.
- Web scraping or crawler implementation.
- Data procurement, credentials or rate limiting.
- Plugin health monitoring or automatic failover.
- Backtesting, trading, stock ranking or investment decisions.
- Harness Core changes.
- Changes to Architecture v0.2 or Technical Design v0.1.
