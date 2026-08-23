# ResearchHub Capability Architecture

## Status

Phase 3 — Financial Capability Development

This document defines the first reusable Financial Capability framework and the Market Capability MVP delivered by RH-ENG-002.

## Architecture

ResearchHub keeps Agent reasoning separate from financial data access:

```text
Research Manager Agent
        ↓ Harness Tool
Market Capability
        ↓ CapabilityProvider<TInput, TOutput>
Mock Market Provider
        ↓
Structured Market Snapshot
```

The Agent knows only the Harness Tool contract. It does not import a Provider, query a database or call an external API.

## Capability Framework

Reusable definitions are implemented in `packages/capabilities/core/`:

- `CapabilityDefinition<TInput, TOutput>` contains `name`, `description`, `inputSchema` and `outputSchema`.
- `CapabilityProvider<TInput, TOutput>` is the provider boundary.
- `CapabilityExecutionError` adds capability name, provider name, normalized input and the original error cause to provider failures.

Input and output schemas use the Harness Tool schema contracts, so future capabilities remain compatible with `ctx.tools.register()`.

Future capabilities follow the same shape:

- News Capability → News Provider
- Financial Capability → Financial Provider
- Institution Capability → Institution Provider

## Provider Pattern

The Capability owns domain validation, normalization and provider delegation. The Provider owns source adaptation and returns structured domain data.

Provider rules:

- Providers are injected into Capabilities.
- Providers do not contain Agent orchestration or investment reasoning.
- Providers do not execute trades.
- Real providers must be replaceable without changing the Agent-facing Tool contract.
- Provider failures are wrapped with stable Capability context.

## Market Capability MVP

### Operation

`get_market_snapshot(symbol)`

The Capability trims and normalizes the symbol, rejects empty input and delegates the normalized request to its injected Provider.

### Output

```json
{
  "symbol": "600519",
  "price": 1680,
  "change": 12.5,
  "volume": 100000,
  "source": "mock"
}
```

### Mock Provider

`MockMarketProvider` is deterministic and in-memory. It supports only fixed fixture symbols and has no network access, commercial data dependency, crawler, trading logic or investment judgment.

The Mock Provider exists only to verify the Capability/Provider boundary. It is not a production market data implementation.

## Harness Tool Registration

The Harness adapter is implemented in `packages/capabilities/market/harness-tool.ts` and uses:

```ts
ctx.tools.register(...)
```

The registered Tool is named `get_market_snapshot`. Its execution handler delegates to `MarketCapability`; it never calls `MockMarketProvider` directly.

## Validation

RH-ENG-002 validates:

- Capability and Provider are separate modules.
- Market Capability does not contain source-specific lookup data.
- Mock Provider returns deterministic structured output.
- Invalid Capability input does not reach the Provider.
- Provider failures retain Capability context.
- Harness Runtime starts and registers the Market Tool.
- Agent calls the Market Tool and receives the structured snapshot.
- Harness Session records and persists the Tool call and result.

Validation commands:

```text
npm test
```

The test suite includes four Capability/Provider tests and two Harness integration tests, including the prior RH-ENG-001 validation chain.

## Future Extension

The next production step is selecting and validating a real market data Provider under a separate engineering task. That Provider must implement the existing interface, preserve source metadata and pass the same Capability and Session validation without changing Agent behavior.
