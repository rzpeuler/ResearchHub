# Financial Statement Plugin Design

**Status:** Implemented MVP
**Scope:** reported A-share financial facts only
**Related task:** RH-ENG-008

## 1. Position in the architecture

ResearchHub keeps the Financial Plugin independent from any data vendor:

```text
Financial Plugin
        ↓
Plugin Registry
        ↓
Financial Plugin Composition
   ┌────┴────┐
Tushare   AkShare
Plugin  Plugin
   └────┬────┘
        ↓
FinancialStatement / FinancialMetric
        ↓
Financial Evidence Adapter
        ↓
Evidence Artifact
```

The Plugin exposes `get_financial_snapshot(symbol)`. It does not know vendor
endpoints, credentials, response fields, or SDK details. Plugins are responsible
for retrieval, normalization, validation, and source metadata.

## 2. Normalized data model

`FinancialStatement` is the source-oriented record. It contains:

- `symbol`, `statementType`, `fiscalPeriod`, and optional `reportDate`
- `currency`, `unit`, and normalized `lineItems`
- `source` metadata: `plugin`, `source`, optional `publishedAt`, `retrievedAt`, `quality`, `confidence`

`FinancialMetric` is the stable research-facing value. The MVP supports:

- Income: `revenue`, `operating_profit`, `net_profit`
- Balance sheet: `total_assets`, `total_liabilities`
- Cash flow: `operating_cash_flow`

Each metric retains `sourceStatementIds` and `calculationBasis`. The current
implementation only emits reported values; it does not forecast, rank stocks, or
run valuation logic.

## 3. Tushare plugin

`TushareFinancialPlugin` calls the documented `income`, `balancesheet`, and
`cashflow` interfaces through the native HTTP transport. The adapter converts
Tushare fields such as `ts_code`, `total_revenue`, `operate_profit`, `n_income`,
`total_assets`, `total_liab`, and `n_cashflow_act` into the common metric names.

Configuration:

- `TUSHARE_TOKEN` — required when Tushare is selected in real mode
- `TUSHARE_FINANCIAL_ENDPOINT` — defaults to `https://api.tushare.pro`

Tokens are never hard-coded and are redacted from plugin errors.

## 4. AkShare plugin

`AkShareFinancialPlugin` uses an HTTP bridge rather than importing a Python SDK
into the TypeScript runtime. The bridge returns statement groups or a normalized
statement list. The adapter accepts common AkShare-style aliases, validates the
requested symbol, and produces the same `FinancialStatement` / `FinancialMetric`
schema as Tushare.

Configuration:

- `AKSHARE_FINANCIAL_ENDPOINT` — required when AkShare is selected in real mode

The bridge boundary keeps the Plugin architecture portable and makes fixture
testing deterministic.

The bridge applies the requested `periodType` at the source-row selection
boundary. Annual and quarterly requests do not silently substitute one another;
TTM is explicitly rejected with HTTP 422 until a defined source contract exists.
Missing source report/publication dates remain absent, while retrieval time is
recorded separately.

## 5. Plugin selection and fallback

The composition registers both plugin names:

- `tushare-financial`
- `akshare-financial`

Selection is controlled by:

- `FINANCIAL_PRIMARY_PLUGIN` — defaults to `akshare-financial` in real mode;
  `tushare-financial` remains available as an explicit alternative
- `FINANCIAL_FALLBACK_PLUGIN`
- `FINANCIAL_PLUGIN_MODE=real|fixture`

The primary plugin is tried first. A configured fallback is tried only when the
primary fails. Fixture mode requires injected adapters, preventing tests from
silently making network calls.

## 6. Evidence integration

`createFinancialEvidence` converts each normalized reported metric to an Evidence
Artifact. Evidence contains serialized metric content plus symbol, period, source
statement IDs, plugin, and session ID. This is an adapter boundary only:

```text
Financial Data → Financial Evidence Adapter → Evidence Artifact
```

It does not create Thesis or Prediction artifacts and does not write Memory
directly. Existing Memory adapters can consume later research artifacts without
coupling them to a vendor.

## 7. Validation status

The MVP includes network-free fixtures for:

- Tushare field transformation and API error handling
- AkShare field transformation
- primary/fallback behavior
- Plugin Registry JSON-safe validation
- Financial Plugin execution
- Evidence creation and serialization
- integration compatibility with the existing test suite

No real token or external endpoint is required to run the tests.

## 8. Future evolution

Future plugins can implement the same `FinancialPlugin` contract without
changing the Plugin. Possible additions include more reporting periods,
plugin-specific quality policies, rate limiting, retry policy, and additional
statement metrics. Forecasts, valuation models, and investment recommendations
remain outside this Plugin layer.

## References

- [Tushare financial data catalogue](https://tushare.pro/document/1?doc_id=108)
- [Tushare income interface](https://tushare.pro/document/2?doc_id=137)
- [AkShare project guidance](https://github.com/akfamily/akshare/blob/main/llms.txt)
