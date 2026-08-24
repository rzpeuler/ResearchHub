# Real Financial Plugin Validation Design

**Task:** PLUGIN-VALIDATION-002  
**Status:** Implemented
**Date:** 2026-08-24

## Goal

Validate that the ResearchHub Financial Plugin can retrieve real financial
facts, normalize them through the existing Plugin boundary, and inject them
into the Equity Research pipeline without changing DSH, Workflow, Skill,
Artifact, or Plugin contracts.

## Architecture boundary

The existing `TushareFinancialPlugin` remains the Financial Provider Adapter.
It is extended to consume Tushare's documented `fina_indicator` endpoint in
addition to the existing income, balance-sheet, and cash-flow endpoints. The
adapter remains data-only: it does not import DSH, invoke a Skill, generate an
investment conclusion, or implement valuation logic.

The runtime path is:

`Tushare API -> TushareFinancialPlugin -> PluginRegistry -> FinancialPlugin -> Evidence -> Equity Research / Valuation Skills -> Evaluation`

The Financial Plugin continues to own the conversion from normalized financial
facts to Evidence. Skills receive injected Plugin ports and remain independent
of DSH and provider-specific code.

## Schema and normalization

The existing `FinancialMetric` schema is extended with the bounded metric names
needed by this validation:

- `revenue`;
- `net_profit`;
- `gross_margin`;
- `net_profit_margin`;
- `eps`;
- `current_ratio`;
- `quick_ratio`;
- `debt_to_assets`.

Existing operating-profit, asset, liability, and operating-cash-flow metrics are
preserved. Tushare indicator fields are mapped into the same reported metric
shape with period, source statement ID, publication date, retrieval timestamp,
currency/unit, quality, and confidence. Missing provider fields are omitted;
the adapter never fabricates ratios or fills gaps with investment assumptions.

The unchanged Artifact core model receives these facts through the existing
`createFinancialEvidence` bridge. Evidence metadata identifies the symbol,
metric, reporting period, source Plugin, and source statement IDs.

## Provider request and safety

The adapter sends the existing Tushare POST request shape with `api_name`,
`token`, `params`, and `fields`. The token is read from the configured
`TUSHARE_TOKEN` option/environment and is redacted from error messages. The
adapter validates response status, Tushare error codes, symbol identity,
dates, numeric fields, and the final normalized FinancialData object.

The deterministic test transport remains the default. No credential is
printed, persisted, or included in snapshots.

## Validation plan

Deterministic tests cover the additional `fina_indicator` request, metric
normalization, provenance, missing indicator fields, malformed responses, and
JSON-safe Evidence serialization.

An opt-in real integration test is excluded from default `npm test`. When
`RUN_REAL_FINANCIAL_PLUGIN=1` and `TUSHARE_TOKEN` are configured, it calls
Tushare for a public A-share symbol, registers the adapter through
`PluginRegistry`, creates Financial Evidence, passes the normalized snapshot
through the existing Equity Research and Valuation Skill boundaries, and runs
Evaluation. Without the environment flag and token, the test is skipped and
the default suite remains network-free.

## Non-goals

This task does not add a Financial Engine, Planner, Agent layer, new Workflow,
new Skill, DSH dependency, provider-specific Skill logic, valuation judgment,
or changes to the Artifact core model. It does not make Tushare the only
possible Financial Plugin; the existing composition and fallback boundaries are
preserved.
