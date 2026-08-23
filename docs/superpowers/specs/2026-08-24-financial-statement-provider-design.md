# ResearchHub Financial Statement Plugin MVP Design

## Task

RH-ENG-008 — implement the first Financial Statement Plugin MVP.

## Goal

Provide structured historical A-share financial facts to a Financial Plugin while preserving the Financial Intelligence Data Layer boundary:

```text
Financial Plugin
        -> Plugin Registry
        -> Financial Plugin Composition
       /                         \
Tushare Financial Plugin   AkShare Financial Plugin
       \                         /
        -> FinancialStatement / FinancialMetric
        -> Financial Evidence Adapter
        -> Evidence Artifact
```

The MVP supports income statement, balance sheet, and cash flow facts. It does not forecast, value, rank, recommend, or trade.

## Constraints

- Do not modify Harness Core.
- Do not modify Architecture v0.2 or Technical Design v0.1.
- Do not implement forecasts, valuation models, stock selection, investment advice, or trading logic.
- Financial Plugin must use Plugin Registry and must not access Tushare, AkShare, HTTP, or SDKs directly.
- Tushare and AkShare tests must use injected transports and fixture payloads; default tests must not require network access.
- Do not introduce a Python or external financial SDK dependency.
- Existing Market, News, Artifact, Memory, and Event Analysis behavior must remain compatible.

## Plugin Architecture

### Tushare Financial Plugin

`TushareFinancialPlugin` uses the existing native HTTP transport and token configuration pattern. It calls the documented Tushare financial endpoints:

- `income` for income statements;
- `balancesheet` for balance sheets;
- `cashflow` for cash flow statements.

The adapter converts Tushare names and report rows into the source-neutral Financial Data model. Expected mappings include:

| Canonical metric | Tushare field aliases |
| --- | --- |
| `revenue` | `total_revenue`, `revenue` |
| `operating_profit` | `operate_profit`, `operating_profit` |
| `net_profit` | `n_income`, `net_profit` |
| `total_assets` | `total_assets` |
| `total_liabilities` | `total_liab`, `total_liabilities` |
| `operating_cash_flow` | `n_cashflow_act`, `operating_cash_flow` |

The Tushare token is read from environment/configuration and never hardcoded or exposed in errors.

### AkShare Financial Plugin

`AkShareFinancialPlugin` follows the existing AkShare HTTP bridge pattern. It accepts an injectable endpoint and transport, parses source-specific rows, and emits the same canonical statements and metrics as Tushare. No Python runtime or AkShare SDK is added to the ResearchHub TypeScript project.

### Plugin Composition

`FinancialPluginComposition` registers Tushare and AkShare under stable names and exposes one Plugin-facing handle. The primary plugin is attempted first; the fallback plugin is attempted only after a primary failure. If both fail, the composition error preserves both plugin names and causes.

## Canonical Data Model

The implementation follows `FINANCIAL_DATA_DESIGN.md`.

### FinancialStatement

Each statement contains:

- `id`
- `symbol`
- `statementType`: `income`, `balance-sheet`, or `cash-flow`
- fiscal period and period type
- report date
- currency and unit
- normalized line items
- statement-level source metadata

### FinancialMetric

Each normalized metric contains:

- `name`
- `value`
- `unit`
- period
- `calculationBasis`: `reported` or `derived`
- source statement IDs
- confidence
- source metadata

The MVP produces only reported metrics derived from source statement fields. It does not add derived valuation ratios or forecast metrics.

## Financial Plugin

The new `FinancialPlugin` exposes:

```text
get_financial_snapshot(symbol)
```

It normalizes the symbol, resolves the registered composition handle, invokes the Plugin, validates the returned Financial Data, and projects Plugin batch metadata into the Plugin result. It does not know which Plugin is primary and does not contain source-specific field aliases.

## Evidence Integration

`FinancialEvidenceAdapter` converts each normalized statement or metric into an existing `Evidence` Artifact:

- `source`: Plugin source identity;
- `content`: JSON-serialized financial fact;
- `timestamp`: report date or disclosure date;
- `confidence`: fact-level confidence;
- metadata: symbol, period, statement type, metric, Plugin, and source identifiers.

Evidence remains descriptive. A later Skill or Workflow may reference Evidence IDs when producing Thesis or Prediction artifacts. Raw financial facts are not written directly to Memory.

## Configuration

The implementation extends configuration with financial-specific values without changing existing market configuration semantics:

- `TUSHARE_TOKEN` for Tushare access;
- `TUSHARE_FINANCIAL_ENDPOINT` optional HTTP endpoint override;
- `AKSHARE_FINANCIAL_ENDPOINT` for the AkShare-compatible bridge;
- `FINANCIAL_PRIMARY_PLUGIN` with `tushare-financial` or `akshare-financial`;
- `FINANCIAL_FALLBACK_PLUGIN` with an optional distinct plugin;
- `FINANCIAL_PLUGIN_MODE` with explicit `real` or `fixture` behavior.

Fixture mode is used by tests. Real mode rejects mock selection and validates required credentials/endpoints.

## Error Handling and Validation

- Invalid symbols, plugin names, modes, endpoints, and limits fail before source access.
- Missing required credentials fail without making a network request.
- HTTP, transport, invalid JSON, API error, empty response, and malformed row failures preserve Plugin context.
- Numeric fields accept documented numeric strings only when finite after normalization.
- Report periods, report dates, symbol associations, statement types, and confidence values are validated.
- Required metrics missing from a source row are rejected rather than silently filled.
- Plugin metadata includes `plugin`, `source`, `timestamp`, `quality`, and `confidence`.

## Testing Strategy

Tests cover:

1. Tushare field transformation for income, balance sheet, and cash flow fixtures.
2. AkShare field transformation into the same canonical model.
3. Symbol, period, metric, value, unit, and metadata normalization.
4. Missing fields, malformed responses, Plugin errors, and primary/fallback behavior.
5. `get_financial_snapshot(symbol)` through the Registry.
6. Financial data conversion into Evidence Artifacts.
7. Existing Artifact tests and Event Analysis compatibility regression.
8. Full TypeScript and repository test suite.

No default test makes a live network request.

## Official Interface References

- [Tushare financial data catalogue](https://tushare.pro/document/1?doc_id=108)
- [Tushare financial indicator and report-period conventions](https://tushare.pro/document/2?doc_id=79)
- [AKShare official interface guidance](https://github.com/akfamily/akshare/blob/main/llms.txt)

## Documentation

The implementation will add:

```text
docs/architecture/FINANCIAL_PLUGIN_DESIGN.md
```

The implementation commit will use:

```text
feat: add financial statement plugin
```
