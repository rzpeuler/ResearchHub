# News Acquisition Layer Design

**Task:** NEWS-ACQUISITION-001  
**Status:** Design approved for implementation  
**Date:** 2026-08-24

## 1. Objective

Introduce a runtime-neutral News Acquisition Layer so ResearchHub can collect
public news evidence through replaceable providers:

```text
Search -> Fetch -> Normalize -> Evidence
```

The existing GDELT News Plugin remains available and compatible. This design
does not add a crawler system, research reasoning, sentiment analysis, Skill,
Workflow, Agent, or Capability layer.

## 2. Current Context

The current `NewsPlugin` exposes `search_company_news` and receives a typed
Plugin handle. The GDELT adapter currently performs public search, response
parsing, normalization, and News Plugin data mapping in one provider.

The new layer is additive. It introduces explicit acquisition boundaries while
keeping the existing News Plugin operation and GDELT adapter behavior usable by
existing Company Research and Harness integrations.

## 3. Architecture

```text
NewsPlugin
    |
    +-- SearchProvider
    |     +-- GdeltSearchProvider
    |     +-- MockSearchProvider
    |
    +-- WebFetcher
    |     +-- NativeWebFetcher
    |     +-- MockWebFetcher
    |
    +-- ArticleNormalizer
    |
    +-- EvidenceBuilder
          |
          +-- Evidence Artifact
```

The News Plugin depends on interfaces, not on GDELT, a search engine, or a
particular web site. Acquisition components depend only on transport,
serialization, and data contracts. They do not depend on DSH, ResearchManager,
Workflow, Skill, or Harness runtime types.

Future RSS, Official, and Crawler providers will implement the same provider
interfaces. They are extension points only in this task and are not implemented
now.

## 4. Contracts

### 4.1 SearchProvider

```ts
interface SearchInput {
  query: string
  entity?: string
  startTime?: string
  endTime?: string
  limit: number
}

interface SearchResult {
  title: string
  url: string
  snippet?: string
  source: string
  publishedAt?: string
  metadata?: JsonObject
}

interface SearchProvider {
  readonly name: string
  search(input: SearchInput): Promise<readonly SearchResult[]>
}
```

`GdeltSearchProvider` adapts the existing GDELT DOC ArticleList endpoint.
`MockSearchProvider` returns deterministic candidates for default tests.

### 4.2 WebFetcher

```ts
interface FetchInput {
  url: string
}

interface RawDocument {
  url: string
  html: string
  fetchedAt: string
  status: number
  contentType?: string
}

interface WebFetcher {
  readonly name: string
  fetch(input: FetchInput): Promise<RawDocument>
}
```

`NativeWebFetcher` uses the existing native HTTP transport, validates HTTP(S)
URLs, applies a timeout, rejects non-success responses and refuses empty
responses. It does not follow arbitrary links or crawl a site graph.

### 4.3 ArticleNormalizer

```ts
interface NormalizedArticle {
  title: string
  content: string
  source: string
  publishedAt: string
  url: string
  metadata: JsonObject
}

interface ArticleNormalizer {
  normalize(input: RawDocument, candidate?: SearchResult): NormalizedArticle
}
```

The normalizer removes non-content HTML elements such as scripts and styles,
converts visible markup to bounded plain text, preserves the candidate title
and source when present, and requires a non-empty title, content, URL, source,
and ISO timestamp.

### 4.4 EvidenceBuilder

`EvidenceBuilder` converts a normalized article into the existing Evidence
Artifact through `createEvidence`.

The current Artifact core is intentionally unchanged. Evidence continues to
use its existing fields:

```text
source, timestamp, content, confidence
```

The acquisition-specific fields required by this task are stored in the
Evidence metadata object:

```json
{
  "acquisition": {
    "reliability": "medium",
    "entity": "600519",
    "url": "https://example.test/article",
    "provider": "gdelt-search"
  }
}
```

This preserves serialization compatibility while retaining source traceability
for downstream Skills and review.

## 5. Compatibility Strategy

The existing `GdeltNewsPlugin` and `NewsPlugin.search_company_news` remain
available with their current input and output shapes. The new acquisition
facade may be composed by new callers without requiring existing callers to
change.

The existing GDELT adapter will be reused or wrapped rather than deleted. No
existing Skill, Workflow, DSH, Harness tool, or Artifact schema is changed by
the acquisition layer.

## 6. Error Policy

Each boundary returns an explicit typed error with provider and operation
context. Errors are categorized as:

- invalid search input;
- search provider failure;
- invalid or unsupported URL;
- fetch timeout or network failure;
- non-success HTTP response;
- empty or unsupported document;
- article normalization failure;
- Evidence validation or serialization failure.

Provider-specific errors do not leak credentials or full URLs containing
credentials. A failed candidate does not silently become fabricated Evidence.

## 7. Testing Strategy

### Unit tests

- Search input and result validation;
- Mock SearchProvider output;
- Mock WebFetcher output;
- HTML normalization and empty-content rejection;
- EvidenceBuilder metadata and serialization;
- GDELT compatibility behavior.

### Integration test

`tests/integration/news-acquisition.test.ts` runs:

```text
MockSearchProvider
    -> MockWebFetcher
    -> ArticleNormalizer
    -> EvidenceBuilder
    -> serialized Evidence
```

The test is deterministic and does not access the network.

### Real network test

Real acquisition runs only when `RUN_REAL_NEWS_ACQUISITION=1`. It uses the
existing GDELT provider and the native web fetcher, validates the normalized
article and Evidence output, and remains outside the default `npm test` path.

## 8. Documentation and Governance

The implementation will update:

- `docs/project-management/CURRENT_STATUS.md`;
- `docs/project-management/CHANGELOG.md`;
- the applicable News/Plugin architecture document.

The documentation will state that News Acquisition is a Plugin-layer data
acquisition concern, not a Skill, Workflow, DSH, Agent, Capability, or Provider
architecture layer.

## 9. Acceptance Criteria

The implementation is complete when:

1. News Plugin consumers can use SearchProvider and WebFetcher interfaces.
2. GDELT remains usable through its existing compatibility path.
3. Mock Search -> Fetch -> Normalize -> Evidence passes deterministically.
4. Evidence contains source, timestamp, content, confidence, and acquisition
   metadata for reliability, entity, URL, and provider.
5. Real network tests are opt-in and disabled by default.
6. No acquisition module imports DSH, ResearchManager, Workflow, or Skill code.
7. TypeScript compilation and the full test suite pass.
