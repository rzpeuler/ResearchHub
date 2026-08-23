# RH-ENG-002 Financial Capability Foundation Design

## Status

Approved and implemented in RH-ENG-002.

## Objective

Establish the first reusable ResearchHub Financial Capability framework and implement a Market Capability MVP without introducing a real financial data source or investment reasoning logic.

The implementation must preserve the frozen ResearchHub Architecture v0.2 and use the Harness Extension Architecture validated by RH-ENG-001.

## Scope and Boundaries

In scope:

- A reusable capability definition contract.
- A reusable provider contract.
- A Market Capability MVP exposing `get_market_snapshot(symbol)`.
- A deterministic in-memory Mock Market Provider.
- Harness Tool registration through `ctx.tools.register()`.
- An integration test covering Agent → Tool → Capability → Provider → response → Session.
- Capability architecture documentation.

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
packages/capabilities/
├── core/
├── market/
└── providers/
```

The dependency direction is one-way:

```text
Agent
  ↓ Harness Tool
Market Capability
  ↓ provider interface
Mock Market Provider
  ↓
Structured Market Snapshot
```

The Agent sees only the Harness Tool schema and structured result. It does not import or call a Provider. The Capability owns the domain operation name, input validation, provider selection and output contract. The Provider owns data retrieval and source metadata.

## Contracts

### Capability Definition

The reusable capability definition contains:

- `name`
- `description`
- `inputSchema`
- `outputSchema`

The TypeScript contract is generic over input and output types so News, Financial and Institution capabilities can reuse the same registration and validation pattern.

### Provider

The provider contract is generic over the same input and output types and exposes one domain operation:

```ts
interface CapabilityProvider<TInput, TOutput> {
  readonly name: string
  execute(input: TInput): Promise<TOutput>
}
```

Providers must return structured domain data and may include source metadata. They must not contain reasoning, investment conclusions or trading behavior.

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

The Mock Provider returns deterministic values with `source: "mock"`. The symbol is normalized and validated by the Market Capability before the Provider is called.

## Harness Integration

The Market Capability is registered by a ResearchHub Cordis extension. The extension receives the Harness `tools` service and calls `ctx.tools.register()` with the capability's input and output schemas.

The Tool execution handler delegates to the Market Capability. It does not call the Mock Provider directly. This preserves the required boundary and makes replacing the Provider an internal Capability composition change.

The implementation must use existing Harness services and must not create an Agent loop, Plugin runtime or Session implementation.

## Error Handling

- Invalid or empty symbols fail at the Capability input boundary.
- Provider errors propagate as Capability execution failures with the capability name available in the error context.
- The Mock Provider is deterministic and must not silently synthesize data for an invalid symbol.
- The integration test must assert both successful structured output and the recorded tool/session events.

## Test Design

The integration test will:

1. Start the real Harness prerequisite services and AgentLoop.
2. Load the ResearchHub Financial Capability extension.
3. Register the Market Tool.
4. Run an Agent against a deterministic mock LLM adapter.
5. Verify the Agent calls the Market Tool.
6. Verify the Market Capability delegates to the Mock Provider.
7. Verify the structured snapshot contains `symbol`, `price`, `change`, `volume` and `source`.
8. Flush the Harness Session and verify the tool call and result are persisted.

Production capability code will live under `packages/capabilities/`; integration-only composition and test fixtures remain under `tests/integration/`.

## Future Extension

Future capabilities follow the same shape:

- `NewsCapability` with `NewsProvider`.
- `FinancialCapability` with `FinancialProvider`.
- `InstitutionCapability` with `InstitutionProvider`.

Each capability may select or compose multiple Providers later, but the Agent-facing boundary remains the capability Tool contract.

## Acceptance Criteria

- Capability and Provider are separate modules.
- Market Capability contains no data-source-specific implementation.
- No real financial dependency or network call is introduced.
- Agent code contains no data retrieval logic.
- Harness Tool registration uses `ctx.tools.register()`.
- Runtime, Tool, Provider response and Session persistence are covered by tests.
- Frozen architecture documents remain unchanged.
