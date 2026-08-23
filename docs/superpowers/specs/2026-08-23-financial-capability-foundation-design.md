# RH-ENG-002 Financial Plugin Foundation Design

## Status

Approved and implemented in RH-ENG-002.

## Objective

Establish the first reusable ResearchHub Financial Plugin framework and implement a Market Plugin MVP without introducing a real financial data source or investment reasoning logic.

The implementation must preserve the frozen ResearchHub Architecture v0.2 and use the Harness Extension Architecture validated by RH-ENG-001.

## Scope and Boundaries

In scope:

- A reusable plugin definition contract.
- A reusable plugin contract.
- A Market Plugin MVP exposing `get_market_snapshot(symbol)`.
- A deterministic in-memory Mock Market Plugin.
- Harness Tool registration through `ctx.tools.register()`.
- An integration test covering DSH → Tool → Plugin → Plugin → response → Session.
- Plugin architecture documentation.

Out of scope:

- Commercial market data APIs.
- Tushare, crawler or network access.
- Trading or order execution.
- Investment conclusions, predictions or analysis logic.
- Changes to DeepSeek Harness Core.
- Changes to Architecture v0.2 or Technical Design v0.1.

## Architecture

The production package structure is:

```text
packages/plugins/
├── core/
├── market/
└── plugins/
```

The dependency direction is one-way:

```text
DSH
  ↓ Harness Tool
Market Plugin
  ↓ plugin interface
Mock Market Plugin
  ↓
Structured Market Snapshot
```

The DSH sees only the Harness Tool schema and structured result. It does not import or call a Plugin. The Plugin owns the domain operation name, input validation, plugin selection and output contract. The Plugin owns data retrieval and source metadata.

## Contracts

### Plugin Definition

The reusable plugin definition contains:

- `name`
- `description`
- `inputSchema`
- `outputSchema`

The TypeScript contract is generic over input and output types so News, Financial and Institution plugins can reuse the same registration and validation pattern.

### Plugin

The plugin contract is generic over the same input and output types and exposes one domain operation:

```ts
interface Plugin<TInput, TOutput> {
  readonly name: string
  execute(input: TInput): Promise<TOutput>
}
```

Plugins must return structured domain data and may include source metadata. They must not contain reasoning, investment conclusions or trading behavior.

### Market Snapshot

The MVP output is:

```ts
interface MarketSnapshot {
  symbol: string
  price: number
  change: number
  volume: number
  source: string
}
```

The Mock Plugin returns deterministic values with `source: "mock"`. The symbol is normalized and validated by the Market Plugin before the Plugin is called.

## Harness Integration

The Market Plugin is registered by a ResearchHub Cordis extension. The extension receives the Harness `tools` service and calls `ctx.tools.register()` with the plugin's input and output schemas.

The Tool execution handler delegates to the Market Plugin. It does not call the Mock Plugin directly. This preserves the required boundary and makes replacing the Plugin an internal Plugin composition change.

The implementation must use existing Harness services and must not create an DSH loop, Plugin runtime or Session implementation.

## Error Handling

- Invalid or empty symbols fail at the Plugin input boundary.
- Plugin errors propagate as Plugin execution failures with the plugin name available in the error context.
- The Mock Plugin is deterministic and must not silently synthesize data for an invalid symbol.
- The integration test must assert both successful structured output and the recorded tool/session events.

## Test Design

The integration test will:

1. Start the real Harness prerequisite services and DSHLoop.
2. Load the ResearchHub Financial Plugin extension.
3. Register the Market Tool.
4. Run an DSH against a deterministic mock LLM adapter.
5. Verify the DSH calls the Market Tool.
6. Verify the Market Plugin delegates to the Mock Plugin.
7. Verify the structured snapshot contains `symbol`, `price`, `change`, `volume` and `source`.
8. Flush the Harness Session and verify the tool call and result are persisted.

Production plugin code will live under `packages/plugins/`; integration-only composition and test fixtures remain under `tests/integration/`.

## Future Extension

Future plugins follow the same shape:

- `NewsPlugin` with `NewsPlugin`.
- `FinancialPlugin` with `FinancialPlugin`.
- `InstitutionPlugin` with `InstitutionPlugin`.

Each plugin may select or compose multiple Plugins later, but the DSH-facing boundary remains the plugin Tool contract.

## Acceptance Criteria

- Plugin and Plugin are separate modules.
- Market Plugin contains no data-source-specific implementation.
- No real financial dependency or network call is introduced.
- DSH code contains no data retrieval logic.
- Harness Tool registration uses `ctx.tools.register()`.
- Runtime, Tool, Plugin response and Session persistence are covered by tests.
- Frozen architecture documents remain unchanged.
