# AKShare Financial Bridge

This directory contains the lightweight Python bridge used by the ResearchHub
TypeScript `AkShareFinancialPlugin`. The bridge owns the Python/AKShare SDK
runtime and exposes a small normalized HTTP contract; the ResearchHub
TypeScript runtime does not import or depend directly on the AKShare SDK.

## Boundary

```text
ResearchHub TypeScript Financial Plugin
  -> HTTP bridge (`AKSHARE_FINANCIAL_ENDPOINT`)
    -> Python AKShare runtime
```

The bridge is an external data adapter, not a new ResearchHub architecture
layer, database, provider framework, or financial calculation engine. It does
not silently switch a requested period to another period or fabricate source
dates. Any TypeScript plugin fallback must be explicitly configured outside the
bridge.

## Install

Use Python 3.12 or a compatible virtual environment:

```powershell
python -m pip install -r tools/requirements-akshare-financial-bridge.txt
```

The tested local versions are pinned in the requirements file.

## Start

```powershell
python -m uvicorn tools.akshare_financial_bridge:app --host 127.0.0.1 --port 8000
```

Check availability:

```text
GET http://127.0.0.1:8000/health
```

The response identifies the `akshare` provider. The TypeScript runtime uses
the bridge URL through `AKSHARE_FINANCIAL_ENDPOINT`; it does not load the
Python package itself.

## Financial endpoint

```text
POST http://127.0.0.1:8000/financial
Content-Type: application/json

{"symbol":"600519","statementTypes":["income"],"periodType":"annual"}
```

Supported `statementTypes` are `income`, `balance-sheet`, and `cash-flow`.
`periodType` supports:

- `annual`: selects a report period ending in December;
- `quarterly`: selects a report period ending in March, June, or September;
- `ttm`: returns HTTP 422 with `Unsupported periodType: ttm` because the
  current source contract does not provide a defined TTM statement.

When omitted, `periodType` selects the row with the latest valid financial
period end date across all available reporting periods; it does not apply an
annual/quarterly filter. A missing or invalid financial period returns an
explicit 422 error. Missing source report/publication dates remain `null` and
are never replaced with the current date. Income indicator fields are used
only when an indicator row exists for the selected report period; they are not
copied from another period.

## Configuration and operational notes

- `AKSHARE_FINANCIAL_ENDPOINT` points the TypeScript Financial Plugin to this
  bridge, for example `http://127.0.0.1:8000/financial`.
- `AKSHARE_START_YEAR` controls the lower bound passed to the income indicator
  source and defaults to `2020`.
- The bridge may access upstream services through AKShare. Keep network
  access, source terms, rate limits, and any externally required credentials
  under the operator's control. No credentials are stored in this repository.
- Provider errors and empty datasets are returned as controlled service errors;
  there is no silent provider or period fallback.

Run the deterministic, network-free bridge tests with:

```powershell
python -m unittest tools.test_akshare_financial_bridge -v
```
