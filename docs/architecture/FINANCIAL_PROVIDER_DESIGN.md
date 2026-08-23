# Financial Statement Provider Design

**Status:** Implemented MVP
**Scope:** reported A-share financial facts only
**Related task:** RH-ENG-008

## 1. Position in the architecture

ResearchHub keeps the Financial Capability independent from any data vendor:

```text
Financial Capability
        ↓
Provider Registry
        ↓
Financial Provider Composition
   ┌────┴────┐
Tushare   AkShare
Provider  Provider
   └────┬────┘
        ↓
FinancialStatement / FinancialMetric
        ↓
Financial Evidence Adapter
        ↓
Evidence Artifact
```

The Capability exposes `get_financial_snapshot(symbol)`. It does not know vendor
endpoints, credentials, response fields, or SDK details. Providers are responsible
for retrieval, normalization, validation, and source metadata.

## 2. Normalized data model

`FinancialStatement` is the source-oriented record. It contains:

- `symbol`, `statementType`, `fiscalPeriod`, `reportDate`
- `currency`, `unit`, and normalized `lineItems`
- `source` metadata: `provider`, `source`, `publishedAt`, `retrievedAt`, `quality`, `confidence`

`FinancialMetric` is the stable research-facing value. The MVP supports:

- Income: `revenue`, `operating_profit`, `net_profit`
- Balance sheet: `total_assets`, `total_liabilities`
- Cash flow: `operating_cash_flow`

Each metric retains `sourceStatementIds` and `calculationBasis`. The current
implementation only emits reported values; it does not forecast, rank stocks, or
run valuation logic.

## 3. Tushare provider

`TushareFinancialProvider` calls the documented `income`, `balancesheet`, and
`cashflow` interfaces through the native HTTP transport. The adapter converts
Tushare fields such as `ts_code`, `total_revenue`, `operate_profit`, `n_income`,
`total_assets`, `total_liab`, and `n_cashflow_act` into the common metric names.

Configuration:

- `TUSHARE_TOKEN` — required when Tushare is selected in real mode
- `TUSHARE_FINANCIAL_ENDPOINT` — defaults to `https://api.tushare.pro`

Tokens are never hard-coded and are redacted from provider errors.

## 4. AkShare provider

`AkShareFinancialProvider` uses an HTTP bridge rather than importing a Python SDK
into the TypeScript runtime. The bridge returns statement groups or a normalized
statement list. The adapter accepts common AkShare-style aliases, validates the
requested symbol, and produces the same `FinancialStatement` / `FinancialMetric`
schema as Tushare.

Configuration:

- `AKSHARE_FINANCIAL_ENDPOINT` — required when AkShare is selected in real mode

The bridge boundary keeps the Provider architecture portable and makes fixture
testing deterministic.

## 5. Provider selection and fallback

The composition registers both provider names:

- `tushare-financial`
- `akshare-financial`

Selection is controlled by:

- `FINANCIAL_PRIMARY_PROVIDER`
- `FINANCIAL_FALLBACK_PROVIDER`
- `FINANCIAL_PROVIDER_MODE=real|fixture`

The primary provider is tried first. A configured fallback is tried only when the
primary fails. Fixture mode requires injected adapters, preventing tests from
silently making network calls.

## 6. Evidence integration

`createFinancialEvidence` converts each normalized reported metric to an Evidence
Artifact. Evidence contains serialized metric content plus symbol, period, source
statement IDs, provider, and session ID. This is an adapter boundary only:

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
- Provider Registry JSON-safe validation
- Financial Capability execution
- Evidence creation and serialization
- integration compatibility with the existing test suite

No real token or external endpoint is required to run the tests.

## 8. Future evolution

Future providers can implement the same `FinancialProvider` contract without
changing the Capability. Possible additions include more reporting periods,
provider-specific quality policies, rate limiting, retry policy, and additional
statement metrics. Forecasts, valuation models, and investment recommendations
remain outside this Provider layer.

## References

- [Tushare financial data catalogue](https://tushare.pro/document/1?doc_id=108)
- [Tushare income interface](https://tushare.pro/document/2?doc_id=137)
- [AkShare project guidance](https://github.com/akfamily/akshare/blob/main/llms.txt)
