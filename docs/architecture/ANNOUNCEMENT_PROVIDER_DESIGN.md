# Announcement Provider Design

## 1. Positioning

The Announcement Provider is ResearchHub's first Information Provider implementation. It connects the existing News Capability boundary to an official company-announcement source without adding analysis logic.

```text
News Capability
    -> Provider Registry
    -> announcement-provider
    -> CninfoAnnouncementSourceAdapter
    -> CNINFO public disclosure source
```

The provider standardizes source records as `NewsItem` values and carries source, retrieval time, quality, and confidence metadata through the existing Provider Framework.

Out of scope: NLP, summarization, sentiment analysis, event classification, investment judgment, trading, polling, and crawler behavior.

## 2. Data Source

The first source adapter targets the official [CNINFO public disclosure platform](https://www.cninfo.com.cn/new/disclosure/stock). The source adapter keeps the CNINFO request and response field names private to the adapter. The Provider does not depend on CNINFO-specific field names.

The live path uses the existing native fetch transport and the CNINFO historical-announcement query endpoint. The transport is injectable, so the default test suite uses deterministic fixtures and never requires network access.

## 3. Adapter Design

`CninfoAnnouncementSourceAdapter` is responsible for:

- constructing a symbol-scoped announcement request;
- invoking the official source through `NativeFetchTransport`;
- handling non-success HTTP responses and invalid JSON;
- parsing source records into a source-neutral raw announcement shape.

`AnnouncementProvider` is responsible for:

- validating the six-digit A-share request symbol and bounded result limit;
- mapping a source security code or explicit issuer mapping to the requested symbol;
- creating canonical `NewsItem` values;
- setting `sourceType` to `official`;
- generating `FinancialDataMetadata`.

The source adapter does not create Evidence, Thesis, Prediction, Review, or Memory objects.

## 4. Canonical Data Model

```ts
interface NewsItem {
  title: string
  content: string
  publishedAt: string
  source: string
  sourceType: 'official'
  symbols: string[]
  confidence: number
}
```

`content` is source content when supplied. If the official listing contains only a document reference, the normalized content is the source URL; the Provider does not summarize or infer the announcement body.

Every result also carries:

```ts
interface FinancialDataMetadata {
  provider: 'announcement-provider'
  source: 'cninfo'
  timestamp: string
  quality: 'high' | 'medium' | 'low'
  confidence: number
}
```

Item-level confidence and batch-level metadata confidence are separate values. Neither is an investment return probability or sentiment score.

## 5. Stock Symbol Mapping

Mapping is explicit and conservative:

1. A source security code is normalized from `600519.SH`, `SH600519`, or `600519` to `600519`.
2. If the source record has no code, an injected issuer-to-symbol map is consulted.
3. An announcement that cannot be mapped unambiguously, or that maps to a different requested symbol, is rejected.

The Provider never guesses a stock code from free-form announcement text.

## 6. News Capability Compatibility

The existing News Capability remains unchanged. The Registry entry named `announcement-provider` uses a boundary projection:

| Canonical NewsItem | Existing News Capability field |
| --- | --- |
| `title` | `headline` |
| `publishedAt` | `timestamp` |
| requested symbol | `symbol` |
| `content` | `content` |
| `source` | `source` |
| `confidence` | `confidence` |

The canonical `NewsItem` remains available from `AnnouncementProvider`; the projection exists only to preserve the current Capability contract.

## 7. Validation

Covered by deterministic tests:

- source request construction and fixture parsing;
- HTTP, invalid JSON, and malformed payload errors;
- NewsItem field normalization and official source type;
- security-code and issuer-name symbol mapping;
- metadata completeness and confidence bounds;
- Registry registration under `announcement-provider`;
- unchanged News Capability invocation;
- Event Analysis creation of Evidence, Thesis, and Prediction from announcement evidence.

No default test performs a real network request. Live CNINFO availability, rate limits, document-content retrieval, and source terms remain deployment concerns.

## 8. Future Extensions

Future adapters may target exchange disclosure feeds, other official disclosure channels, or licensed commercial sources. They must implement the source adapter boundary and retain the same `NewsItem` and `ProviderResult` contracts. Adding a source must not move HTTP, authentication, parsing, or source-specific fields into a Capability or Skill.
