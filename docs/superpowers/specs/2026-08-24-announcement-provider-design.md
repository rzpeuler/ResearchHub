# ResearchHub Announcement Plugin MVP Design

## Task

RH-ENG-006 — implement the first real Information Plugin for company announcements.

## Goal

Add an Announcement Plugin that connects the existing News Plugin boundary to an official announcement source while preserving the Information Plugin Architecture:

```text
News Plugin
    -> Plugin Registry
    -> Announcement Plugin
    -> Official Announcement Source Adapter
    -> Source Transport
```

The MVP must standardize announcement records as `NewsItem` objects, retain source metadata, support stock-symbol association, and remain testable without network access.

## Constraints

- Do not modify Harness Core.
- Do not modify the News Plugin public contract.
- Do not modify the Event Analysis Skill.
- Do not add NLP, summarization, sentiment analysis, investment judgment, trading, or crawler logic.
- Do not change the frozen Architecture v0.2 or Technical Design v0.1 documents.
- Tests must use injected fixtures and must not require external network access.
- The first official source adapter targets the CNINFO public disclosure source. The source protocol remains isolated so exchange and commercial adapters can be added later.

## Architecture

### Announcement Plugin

`AnnouncementPlugin` implements the existing generic `DataPlugin` interface. It owns:

- request normalization and symbol validation;
- conversion from source records to the Information Layer `NewsItem` model;
- source-record-to-stock-symbol mapping;
- Plugin-level metadata generation;
- strict validation of the returned normalized data.

It does not perform analysis or call a network API directly.

### Official Source Adapter

`CninfoAnnouncementSourceAdapter` owns the official source protocol:

- request construction for a stock symbol and result limit;
- transport invocation through the existing injectable native-fetch boundary;
- HTTP and payload error conversion;
- parsing the source response into an internal raw announcement record.

The adapter returns source records, not artifacts, evidence, theses, predictions, or investment conclusions.

The adapter contract is intentionally independent of the Plugin contract. This allows future adapters for exchanges, other official disclosure channels, and commercial sources without changing the Announcement Plugin or News Plugin.

### News Plugin Compatibility

The existing News Plugin contract uses legacy fields (`headline`, `timestamp`, and one `symbol`) and is not changed by this task. A registration-boundary projection adapter will map normalized `NewsItem` values to that existing contract:

- `title` -> `headline`;
- `publishedAt` -> `timestamp`;
- the requested symbol -> `symbol`;
- `content`, `source`, and `confidence` remain equivalent.

The canonical Announcement Plugin output remains the `NewsItem` model defined by `INFORMATION_PLUGIN_DESIGN.md`; the projection exists only at the compatibility boundary.

## Data Model

### Request

The Plugin accepts a normalized stock symbol and an optional bounded result limit. Symbols are six-digit A-share codes in the existing plugin-facing form.

### Canonical NewsItem

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

The Plugin must reject empty titles/content, invalid ISO timestamps, unsupported source types, empty symbol associations, and confidence values outside `[0, 1]`.

### PluginResult Metadata

Every Plugin result includes:

```ts
interface FinancialDataMetadata {
  plugin: 'announcement-plugin'
  source: 'cninfo'
  timestamp: string
  quality: 'high' | 'medium' | 'low'
  confidence: number
}
```

`NewsItem.confidence` describes an individual normalized announcement. `PluginResult.metadata.confidence` describes the result batch and must not be interpreted as an investment probability.

### Raw Source Record

The source adapter exposes only fields needed for normalization, including announcement title, content or source content reference, publication time, source identity, and source-side security code or issuer identity. Source-specific field names must not cross the adapter boundary.

## Stock Symbol Mapping

Mapping follows this order:

1. Use a valid source-side security code when present.
2. Normalize a source-side code to the six-digit A-share symbol format.
3. If the source record contains only an issuer identity, use an explicit injected issuer-to-symbol mapping.
4. Reject the record when the issuer cannot be mapped unambiguously.

The Plugin must never infer a symbol from free-form announcement text or silently associate an announcement with an unrelated stock.

## Error Handling

- Invalid Plugin requests fail before the source adapter is called.
- Non-success source responses become typed source/plugin errors with status context but without leaking credentials.
- Invalid JSON or malformed source payloads fail validation and are not converted into partial `NewsItem` objects.
- Missing required announcement fields, unsupported timestamps, and ambiguous symbol mappings are rejected.
- Empty result sets are valid only when the source explicitly reports a successful query with no matching announcements; malformed or incomplete source responses remain errors.
- The Registry continues to enforce JSON-safe Plugin results and validates both metadata and normalized data.

## Testing Strategy

Tests are split by boundary:

1. Source adapter tests inject successful, malformed, and failed transport responses.
2. Plugin tests verify normalization, official `sourceType`, symbol mapping, metadata, and error propagation.
3. Registry/News Plugin tests verify registration under `announcement-plugin` and compatibility projection without changing News Plugin.
4. Event Analysis integration uses the announcement Plugin and existing Market Plugin with fixture data, proving that the unchanged skill can consume the Plugin through the existing plugin boundary.
5. The full TypeScript and repository test suite must continue to pass.

No test starts a real network request. A live CNINFO request remains an explicit runtime integration concern and is not part of the default validation command.

## Documentation and Governance

Implementation will add:

- `docs/architecture/ANNOUNCEMENT_PLUGIN_DESIGN.md`

Implementation will update the project status, task registry, changelog, and README architecture navigation to record RH-ENG-006 and its validation result. The task will be committed as:

```text
feat: add announcement plugin
```

and pushed to `main`.

## Out of Scope

- Real-time scheduling or polling.
- De-duplication across sources.
- PDF/OCR extraction.
- NLP or summarization.
- Sentiment or event classification.
- Evidence Artifact creation inside the Plugin.
- Direct changes to Event Analysis behavior.
