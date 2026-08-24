# AKShare Financial Provider Design

**Task:** PLUGIN-VALIDATION-003
**Status:** Approved
**Date:** 2026-08-24

## Goal

Add AKShare as the default real-data Provider for the existing ResearchHub
Financial Plugin while preserving the Tushare Provider as an optional
alternative. The Financial Plugin interface, normalized FinancialData schema,
Evidence mapping, Skills, Workflow, and DSH boundaries remain unchanged.

## Architecture boundary

The AKShare implementation remains an HTTP Bridge Adapter. TypeScript owns the
Plugin boundary, request validation, response validation, and normalization;
the external Bridge owns access to the Python-side AKShare library. The
adapter does not launch Python, call a Skill, depend on a Workflow or DSH, or
produce investment conclusions.

The validated path is:

`AKShare Bridge -> AKShare Financial Adapter -> PluginRegistry -> FinancialPlugin -> Evidence -> Equity Research Workflow`

The existing Tushare Adapter is not removed. Provider selection remains a
composition concern, so consumers can explicitly select either stable Plugin
name or configure a fallback.

## File and compatibility layout

The AKShare implementation moves to:

`packages/plugins/adapters/financial/akshare/akshare-financial-plugin.ts`

The new directory exports the adapter through `index.ts`. The current
`packages/plugins/adapters/financial/akshare-financial-plugin.ts` path becomes
a thin re-export shim so existing internal or downstream imports continue to
resolve without duplicating implementation logic.

## Configuration

`akshare-financial` becomes the default `FINANCIAL_PRIMARY_PLUGIN` in real
mode. Real AKShare selection requires `AKSHARE_FINANCIAL_ENDPOINT`; no default
network endpoint is invented. Tushare remains selectable with
`FINANCIAL_PRIMARY_PLUGIN=tushare-financial` and continues to require
`TUSHARE_TOKEN`.

Fixture mode continues to require injected adapters and remains network-free.
No credential or endpoint is logged or persisted in test output.

## Data normalization

The adapter reuses `readAkShareRows`, `normalizeFinancialRequest`, and
`buildFinancialData`. Bridge responses may provide statement-type rows or
grouped statement collections. Each accepted row is checked for symbol,
statement type, reporting period, and numeric values. The shared normalizer
maps the following stable metrics without changing their types:

- revenue;
- net profit;
- gross margin;
- net profit margin;
- EPS;
- current ratio;
- quick ratio;
- debt to assets.

Missing values remain absent. The adapter never derives an investment view,
valuation conclusion, or fabricated value. Source metadata remains attached to
the normalized statements and metrics, and `FinancialPlugin` converts them to
Evidence through the existing bridge.

## Testing

Deterministic tests use an injected transport and cover the new directory
export, grouped and row-based Bridge payloads, all required financial metrics,
metadata, malformed responses, symbol mismatches, and Evidence serialization.

An explicit real integration test is excluded from default `npm test`. It is
enabled only when `RUN_REAL_AKSHARE_FINANCIAL=1` and
`AKSHARE_FINANCIAL_ENDPOINT` are present. It registers the default AKShare
composition, retrieves a public-company snapshot, creates Evidence, injects
the Financial Plugin into the existing Equity Research Workflow adapters, and
verifies the final Artifact bundle. Tushare tests remain unchanged and keep
their own explicit opt-in path.

## Non-goals

This task does not delete Tushare, change the Financial Plugin interface,
modify Artifact core models, alter Skill logic, add a Workflow Engine, add a
DSH dependency, or introduce a Python runtime dependency into ResearchHub.
