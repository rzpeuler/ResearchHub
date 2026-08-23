# ResearchHub Financial Data Provider Framework MVP

## Status

Approved design for RH-DESIGN-004. This specification establishes the standard Provider boundary without connecting a real financial API, crawler, commercial data source or Harness Core.

## Goal

Replace the current direct Capability → Mock Provider relationship with a reusable:

```text
Capability
    ↓
Provider Registry
    ↓
Data Provider
    ↓
External Source (future)
```

The framework must preserve source metadata, allow multiple providers per capability, and keep Agent-facing Harness Tool contracts stable.

## Chosen Architecture

Use one process-local typed Provider Registry and Capability-specific bridges:

```text
MarketCapability / NewsCapability
            ↓ provider name
      ProviderRegistry
            ↓
    DataProvider<TRequest, TData>
            ↓
    ProviderResult<TData>
```

Capabilities do not import or instantiate a concrete Provider. They resolve a named Provider from the Registry, call its `fetch()` method, validate the returned data, and project Provider metadata into the existing domain output shape.

## DataProvider Contract

```ts
type FinancialDataQuality = 'high' | 'medium' | 'low'

type FinancialDataMetadata = {
  source: string
  timestamp: string
  quality: FinancialDataQuality
  confidence: number
}

type ProviderResult<TData> = {
  data: TData
  metadata: FinancialDataMetadata
}

interface DataProvider<TRequest, TData> {
  readonly name: string
  fetch(request: TRequest): Promise<ProviderResult<TData>>
  validate(value: unknown): asserts value is TData
}
```

Contract rules:

- `name` is stable and unique within a Registry.
- `fetch()` owns source access and source-specific error translation.
- `validate()` rejects malformed provider data before it crosses the Capability boundary.
- `metadata.source` identifies the data source or fixture.
- `metadata.timestamp` is the observation or provider response timestamp.
- `metadata.quality` is a coarse source-quality classification.
- `metadata.confidence` is a finite number in `[0, 1]` and describes data confidence, not investment confidence.
- No Provider performs Agent orchestration, investment reasoning or trading.

## Provider Registry

`ProviderRegistry` is a small in-process lookup boundary:

- `register(provider)` adds a Provider by its stable name.
- `get<TRequest, TData>(name)` resolves a Provider for a Capability bridge.
- `has(name)` checks availability.
- `list()` returns registered Provider names.

The Registry rejects duplicate names and unknown lookups. It does not load modules dynamically, discover remote services, or manage external credentials. A future application composition root may register Tushare, Wind, JoinQuant, AkShare or Eastmoney adapters without changing Capability logic.

## Mock Provider Migration

New canonical locations:

```text
packages/providers/
├── core/
├── registry/
└── adapters/
    ├── mock-market-provider.ts
    └── mock-news-provider.ts
```

The existing deterministic Mock fixtures move behind the DataProvider contract. Compatibility exports may remain at the old Capability paths so existing imports do not break, but the production Capability path resolves them through `ProviderRegistry`.

No real data source is introduced in this task.

## Capability Projection

The existing Harness Tool names remain unchanged:

- `get_market_snapshot(symbol)`
- `search_company_news(symbol)`

Capabilities continue to return domain-oriented objects rather than exposing a raw `{data, metadata}` envelope to Agents:

- Market output keeps `symbol`, `price`, `change`, `volume` and `source`, and adds observation `timestamp`, `quality` and `confidence` fields.
- News output keeps `symbol` and `items`; each item retains its source/timestamp/confidence, and the result exposes the Provider quality metadata without exposing Registry details.

This is a compatibility-preserving projection: the Agent sees the same operation names and core fields, while every response carries traceability information.

## Error Handling

- Registry errors identify duplicate registration or unknown Provider names.
- Provider errors preserve the Provider name and source context.
- Capability errors continue to use `CapabilityExecutionError` with normalized input and Provider name.
- Invalid Provider data or metadata is rejected before returning a Capability result.
- A failing Provider is not silently replaced by another Provider.

## Validation

Tests must cover:

- DataProvider metadata and output validation.
- Registry registration, lookup, duplicate and unknown-provider errors.
- Mock Market and News Provider migration.
- Capability resolution through Registry rather than concrete Provider imports.
- Metadata projection into Market and News outputs.
- Existing Skill, Artifact, Memory, Evaluation and Harness integration suites.

## Explicit Non-Goals

- Real financial API access.
- Web scraping or crawler implementation.
- Data procurement, credentials or rate limiting.
- Provider health monitoring or automatic failover.
- Backtesting, trading, stock ranking or investment decisions.
- Harness Core changes.
- Changes to Architecture v0.2 or Technical Design v0.1.
