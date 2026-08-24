# News Provider Architecture

**Task:** NEWS-ACQUISITION-001  
**Status:** Implemented

ResearchHub News Plugin uses a runtime-neutral acquisition flow:

```text
SearchProvider -> WebFetcher -> ArticleNormalizer -> EvidenceBuilder
```

The News Plugin and acquisition layer do not depend on DSH, ResearchManager,
Workflow, Skill, or Harness runtime types.

## SearchProvider

`SearchProvider` discovers candidate articles from a query, entity, time range,
and limit. The first implementations are:

- `GdeltSearchProvider` for the public GDELT DOC ArticleList API;
- `MockSearchProvider` for deterministic tests.

Future RSS and Official providers can implement the same interface. A provider
only discovers candidates; it does not interpret their investment impact.

## WebFetcher

`WebFetcher` retrieves one candidate URL and returns a bounded raw document.
`NativeWebFetcher` uses the existing native HTTP transport, supports timeouts,
validates HTTP(S) URLs, rejects non-success responses and unsupported content
types, and does not crawl linked pages. `MockWebFetcher` is used by network-free
tests.

## ArticleNormalizer

`HtmlArticleNormalizer` removes executable and non-content markup, converts
visible HTML to bounded text, and produces a common article shape containing
title, content, source, publication time, URL, and trace metadata.

Normalization does not perform sentiment analysis, event interpretation, or
investment research.

## EvidenceBuilder

`NewsEvidenceBuilder` maps a normalized article to the existing Evidence
Artifact. The existing Artifact model remains unchanged. Acquisition metadata
stores reliability, entity, URL, and provider information so every Evidence
record remains traceable and serializable.

## Compatibility

The existing `GdeltNewsPlugin` and `search_company_news` operation remain
available with their current contracts. Existing Company Research, Event
Analysis, Harness tools, Skills, and Workflows do not need to change.

The acquisition layer is additive and can be composed by callers that need the
explicit Search -> Fetch -> Normalize -> Evidence path.

## Testing and network policy

Deterministic tests use Mock Search and Fetch providers and are included in the
default test suite. Real GDELT and web fetch tests require:

```text
RUN_REAL_NEWS_ACQUISITION=1
```

No external network request is made by default.

## Future providers

The following are extension points, not current implementations:

- RSS Provider;
- Official Provider;
- Crawler Provider.

Adding one must preserve the SearchProvider/WebFetcher boundaries and must not
introduce a Skill, Workflow Engine, Agent, Capability, or DSH dependency.
