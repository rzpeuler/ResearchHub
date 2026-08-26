# Financial Intelligence Data Layer Design

## 1. Positioning

The Financial Intelligence Data Layer provides structured historical company financial facts for company research, earnings analysis, and future valuation work. It does not produce investment advice, strategy signals, forecasts, target prices, or trading actions.

```text
Financial Plugin
        -> Plugin Registry
        -> Financial Plugin
        -> Financial Data Source
        -> FinancialStatement / FinancialMetric
        -> Evidence Artifact
        -> Thesis / Prediction
        -> Existing Memory
```

The design reuses the existing `DataPlugin`, `PluginResult`, `FinancialDataMetadata`, and `PluginRegistry` contracts. No real source API is connected by this task.

## 2. Financial Data Models

### FinancialStatement

`FinancialStatement` represents a historical company report or normalized statement slice:

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
  reportDate?: string
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

The model preserves statement type, reporting period, report date, currency, unit, line-item values, and source metadata. `ttm` is a normalized trailing-period view, not a forecast.

### FinancialMetric

`FinancialMetric` represents a reported or transparently derived historical value:

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

Reported metrics come directly from a source statement. Derived metrics must identify their source statement IDs and calculation basis. This layer does not define valuation formulas or forecast assumptions.

## 3. Source Metadata

```ts
interface FinancialSourceMetadata {
  plugin: string
  source: string
  publishedAt?: string
  retrievedAt: string
  quality: 'high' | 'medium' | 'low'
  confidence: number
}
```

Individual statement/metric metadata complements the existing PluginResult metadata. Plugin metadata describes the fetch batch; domain metadata describes the individual financial fact.

Source report/publication dates are optional because providers may omit them.
Unknown source dates remain absent; they are never replaced with the current
date or the financial period end. `retrievedAt` remains the actual acquisition
timestamp and is kept semantically separate.

## 4. Financial Plugin Interface

Financial Plugins reuse the generic Plugin Framework:

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

type FinancialPlugin = DataPlugin<FinancialDataRequest, FinancialData>
```

The Plugin is responsible for acquisition, normalization, source metadata, and structural validation. Financial Plugin must obtain it through Plugin Registry and must not access HTTP, SDKs, or databases directly.

## 5. Financial Plugin Boundary

Financial Plugin returns normalized financial data and batch metadata. An Evidence Adapter converts structured facts into existing Evidence Artifacts:

- `source` comes from financial source metadata;
- `content` is JSON-serialized statement or metric data;
- `timestamp` is the relevant report or publication date when available, and
  the actual retrieval time when the source date is unavailable;
- `confidence` is the fact-level confidence;
- metadata records symbol, period, statement type, plugin, and source identifiers.

Evidence remains factual. Interpretation belongs to a later Skill or Workflow, which may create Thesis and Prediction artifacts through the existing research lifecycle.

## 6. Artifact and Memory Compatibility

- Financial facts fit the existing Evidence Artifact without changing Artifact Core.
- Evidence IDs can be referenced by Thesis artifacts.
- Thesis and Prediction remain compatible with the Evaluation and Review loop.
- Existing Memory adapters can persist downstream Thesis, Prediction, and Review entries.
- This design does not add a Financial Memory type or write raw financial facts directly to Memory.

## 7. Validation Boundary

Future implementations must validate:

- JSON-safe Plugin output and complete PluginResult metadata;
- six-digit symbol association;
- supported statement types and period types;
- ordered fiscal periods and valid report timestamps;
- finite numeric values, currency and unit fields;
- source identity, retrieval time, quality, and confidence bounds;
- Evidence serialization compatibility with existing Artifact validation.

## 8. Non-Goals

- Real API or data-source integration.
- Financial forecasting or predictive modeling.
- Valuation strategy, target-price generation, or stock ranking.
- Investment recommendations, trading, or portfolio actions.
- Direct Memory schema changes.
