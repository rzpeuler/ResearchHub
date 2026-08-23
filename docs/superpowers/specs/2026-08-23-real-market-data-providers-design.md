# RH-ENG-005 Real A-Share Market Data Providers MVP

## Context

ResearchHub already has a stable `DataProvider` contract and process-local `ProviderRegistry`. Market Capability consumes a typed Provider handle and must not know whether data comes from Mock, Tushare, or AkShare. RH-ENG-005 adds the first real-data adapter boundary without changing Market Capability, Event Analysis Skill, Harness Core, or the frozen Architecture v0.2 documents.

The repository uses TypeScript/Node and currently has no Tushare or AkShare SDK dependency. The implementation therefore uses native `fetch` transports. Tushare is accessed through its documented HTTP API. AKShare is normally a Python data-interface library rather than a single stable REST service, so the Node adapter uses a configurable HTTP bridge endpoint; without that bridge it is explicitly unavailable, never silently replaced by Mock data.

## Goals

- Add `TushareMarketProvider` and `AkShareMarketProvider` under `packages/providers/adapters/`.
- Normalize source-specific response fields into the existing Market Provider data shape.
- Attach `provider`, `source`, `timestamp`, `quality`, and `confidence` provenance metadata to every real-data result.
- Add configuration-driven primary/fallback selection while keeping the Registry boundary.
- Make tests deterministic with injected transports and response fixtures, without requiring credentials or network access.
- Keep existing Mock-based Harness and Event Analysis validation available and passing.

## Non-goals

- No Tushare/AkShare SDK dependency.
- No hardcoded tokens, credentials, trading logic, quant strategy, ranking, or backtesting.
- No modification to Architecture v0.2, Technical Design v0.1, Harness Core, Market Capability method/schema names, or Event Analysis Skill.
- No silent fallback to Mock data in a real-provider composition.
- No claim that an AkShare bridge is an official AkShare REST API.

## Architecture

```text
Market Capability
        ↓ typed ProviderHandle
ProviderRegistry
        ↓
Market Provider Selection / Fallback Composition
        ↓
TushareMarketProvider       AkShareMarketProvider
        ↓                     ↓
Native fetch transport       Configured HTTP bridge
        ↓                     ↓
Tushare API                  AkShare-compatible bridge
```

The Registry remains a generic registration and typed lookup boundary. Provider selection and fallback are composition concerns, implemented by a small market-provider composition helper rather than by changing the generic Registry API.

## Data contracts

The provider request remains `{ symbol: string }`, matching the current Market Capability input. Each adapter returns a `ProviderResult<MarketProviderData>`:

```ts
interface MarketProviderData {
  symbol: string
  price: number
  change: number
  volume: number
  source: string
}

interface FinancialDataMetadata {
  provider: string
  source: string
  timestamp: string
  quality: 'high' | 'medium' | 'low'
  confidence: number
}
```

The existing core metadata contract is extended compatibly with the required `provider` field. Market Capability keeps its existing method, input, business fields and output contract; it does not expose the new `provider` field. The complete provenance remains available in the `ProviderResult` at the Provider/Registry boundary. Provider-specific raw fields do not cross the adapter boundary.

## Tushare adapter

- Provider name: `tushare-market`.
- Endpoint: configurable `TUSHARE_ENDPOINT`, defaulting to `https://api.tushare.pro`.
- Authentication: `TUSHARE_TOKEN`; never logged or embedded in source.
- Request: POST JSON body containing `api_name: 'daily'`, `token`, and `params.ts_code` derived from the normalized symbol.
- Normalization: `ts_code` maps to `symbol`; `close` maps to `price`; `pct_chg` maps to `change`; `vol` maps to `volume`.
- Response errors, non-2xx responses, malformed envelopes, missing rows, and invalid numeric values become Provider errors.
- `timestamp` comes from the response trade date when present, normalized to an ISO timestamp; otherwise the injected clock is used only as a clearly marked retrieval timestamp.

## AkShare adapter

- Provider name: `akshare-market`.
- Endpoint: `AKSHARE_ENDPOINT`; no default external endpoint is assumed.
- Authentication: bridge-specific configuration is external to this package; no secret is hardcoded.
- Request: JSON `{ symbol }` to the configured bridge.
- Normalization accepts the bridge's documented source-shaped fields such as `code`, `收盘`, `涨跌额`/`涨跌幅`, and `成交量`, then emits the common Market Provider data shape.
- Missing endpoint, non-2xx responses, malformed payloads, empty results, and invalid numeric values produce an explicit disabled/provider error.
- Provider metadata identifies `akshare-market` and the configured bridge source; fixture mode is test-only.

## Configuration and selection

Configuration is read at the composition boundary, not inside Market Capability:

```text
TUSHARE_TOKEN=
TUSHARE_ENDPOINT=https://api.tushare.pro
AKSHARE_ENDPOINT=
MARKET_PRIMARY_PROVIDER=tushare-market
MARKET_FALLBACK_PROVIDER=akshare-market
MARKET_PROVIDER_MODE=real|fixture
```

The default real composition registers only providers that are configured and usable. A primary provider is required. A fallback is optional and is attempted only for Provider failures from the primary. If both fail, the composition returns an error containing both provider names and causes. Fixture mode is explicit and test-only; it must not be the production default.

The first MVP records the actual provider in result metadata. Fallback reason and attempt history remain execution diagnostics; they are not included in the stable Market Capability business fields unless a later ADR expands the result contract.

## Testing strategy

- Inject a transport function and clock into each adapter.
- Use fixtures for valid Tushare and AkShare-shaped payloads.
- Test symbol conversion, numeric conversion, timestamp/metadata generation, malformed responses, HTTP errors, missing credentials and disabled AkShare bridge.
- Test primary success, primary failure with fallback success, and both-provider failure.
- Keep existing Market Capability tests, Event Analysis integration, Artifact, Memory, Evaluation, and Harness tests unchanged in behavior.
- Do not make network calls in the default test suite.

## Validation and risks

The MVP proves adapter structure and deterministic normalization, not production data quality. Before enabling live use, validate account permissions, API terms, rate limits, trading-calendar semantics, delayed/realtime meaning, corporate-action adjustments, bridge availability, and operational monitoring. The AkShare bridge is an explicit deployment dependency and must be implemented and operated separately.
