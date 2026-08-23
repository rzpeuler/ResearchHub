# ResearchHub Financial Intelligence Data Layer Design

## Task

RH-DESIGN-007 — design the company financial research data architecture.

## Goal

Define a historical financial-data layer that supports company research, earnings analysis, and future valuation work while remaining compatible with the existing Provider, Artifact, and Memory boundaries.

This task defines architecture and contracts only. It does not connect a real API, implement financial forecasting, or produce valuation or investment conclusions.

## Scope and Constraints

- Model historical disclosed financial facts only.
- Do not model forecasts, target prices, valuation conclusions, strategy signals, or investment advice.
- Reuse the existing `DataProvider`, `ProviderResult`, `FinancialDataMetadata`, and `ProviderRegistry` contracts.
- Do not add a real financial data source or external dependency.
- Do not modify Harness Core, the frozen Architecture v0.2, or Technical Design v0.1.
- Financial Capability must not bypass the Provider Registry or directly access a data source.

## Architecture

```text
Financial Capability
        -> Provider Registry
        -> Financial Provider
        -> Financial Data Source
        -> FinancialStatement / FinancialMetric
        -> Evidence Artifact
        -> Thesis / Prediction
        -> Existing Memory
```

The Financial Provider is responsible for acquisition, normalization, source metadata, and structural validation. Financial Capability exposes a research-facing boundary and does not own source-specific field mappings. An Evidence Adapter serializes structured financial facts into the existing `Evidence` Artifact contract.

Financial data is not written directly to Memory by this design. The existing Memory MVP stores Thesis, Prediction, and Review entries; financial facts become long-term research context when they support those artifacts.

## FinancialStatement Model

`FinancialStatement` represents a historical company report or a normalized statement slice:

```ts
interface FinancialStatement {
  id: string
  symbol: string
  statementType: 'income' | 'balance-sheet' | 'cash-flow'
  fiscalPeriod: {
    start: string
    end: string
    periodType: 'annual' | 'quarterly' | 'ttm'
  }
  reportDate: string
  currency: string
  unit: string
  lineItems: FinancialLineItem[]
  source: FinancialSourceMetadata
}

interface FinancialLineItem {
  name: string
  value: number
  unit: string
}
```

The model records reported facts and their period semantics. `ttm` is a normalized trailing-period view, not a forecast. Numeric values must be finite and the period must be valid and ordered.

## FinancialMetric Model

`FinancialMetric` represents a named reported or transparently derived value:

```ts
interface FinancialMetric {
  name: string
  value: number
  unit: string
  period: FinancialStatement['fiscalPeriod']
  calculationBasis: 'reported' | 'derived'
  sourceStatementIds: string[]
  confidence: number
  source: FinancialSourceMetadata
}
```

`reported` metrics come directly from a source statement. `derived` metrics may combine statement line items, but the input statement IDs and calculation basis must remain explicit. This design does not define valuation formulas or forecast assumptions.

## Source Metadata

```ts
interface FinancialSourceMetadata {
  provider: string
  source: string
  publishedAt: string
  retrievedAt: string
  quality: 'high' | 'medium' | 'low'
  confidence: number
}
```

This domain metadata complements, rather than replaces, the existing `FinancialDataMetadata` attached to a `ProviderResult`. Provider metadata describes the fetch batch; statement and metric metadata describes the individual financial fact.

## Financial Provider Interface

Financial Providers reuse the generic Provider Framework:

```ts
interface FinancialDataRequest {
  symbol: string
  statementTypes?: Array<'income' | 'balance-sheet' | 'cash-flow'>
  periodType?: 'annual' | 'quarterly' | 'ttm'
}

interface FinancialData {
  symbol: string
  statements: FinancialStatement[]
  metrics: FinancialMetric[]
}

type FinancialProvider = DataProvider<FinancialDataRequest, FinancialData>
```

Registry validation must enforce JSON-safe output, stable provider names, complete batch metadata, valid dates, finite numeric values, supported statement types, and confidence bounds.

## Financial Capability Boundary

Financial Capability consumes a typed Provider handle and returns normalized financial data plus batch metadata. It does not call HTTP, an SDK, or a database directly.

The Evidence Adapter creates `Evidence` records with:

- `source` from the financial source metadata;
- `content` as JSON-serialized statement or metric facts;
- `timestamp` from the relevant report or publication date;
- `confidence` from the fact-level confidence;
- metadata containing symbol, period, statement type, provider, and source identifiers.

Evidence remains factual. Interpretation belongs to a later Skill or Workflow, and any resulting Thesis or Prediction follows the existing Artifact and Memory lifecycle.

## Artifact and Memory Compatibility

- Financial facts are representable as existing Evidence Artifacts without changing the Artifact core.
- Evidence IDs can be referenced by existing Thesis Artifacts.
- Predictions and Reviews can use those Theses through the existing Evaluation loop.
- Existing Memory adapters can persist the resulting Thesis, Prediction, or Review.
- A dedicated Financial Memory type or index is future work and is not part of this design.

## Validation and Non-Goals

Architecture validation must confirm:

1. Financial data enters through Provider Registry.
2. Statement and metric records preserve period, unit, currency, source, and confidence.
3. Financial Capability does not contain source-specific acquisition logic.
4. Evidence serialization is compatible with current Artifact validation.
5. Existing Memory remains unchanged and can receive downstream research artifacts.

Out of scope:

- real API integration;
- financial forecast models;
- valuation strategies or target-price generation;
- automatic investment recommendations;
- trading or portfolio actions.

## Documentation

The approved architecture will be recorded in:

```text
docs/architecture/FINANCIAL_DATA_DESIGN.md
```

The implementation will use the exact commit message:

```text
docs: design financial intelligence architecture
```
