# News Provider Architecture

**Tasks:** NEWS-ACQUISITION-001, NEWS-PROVIDER-002, CNINFO-PROVIDER-FIX-001
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
- `OfficialAnnouncementSearchProvider` for official CNINFO company announcements;
- `MockSearchProvider` for deterministic tests.

The official provider reuses the existing `CninfoAnnouncementSourceAdapter` and
projects its normalized records into the same SearchProvider contract. It
requires a six-digit A-share symbol in `entity` or `query`, preserves official
source metadata, and filters candidates to records with an official source URL.
It does not interpret announcement impact.

The CNINFO adapter resolves the required organization identifier from the
official stock directory before querying announcements. For example,
`600519` is sent as `600519,gssh0600519`. It also supports CNINFO `seDate`
ranges and normalizes epoch-millisecond publication times.

GDELT remains available for general news discovery. The News Acquisition Layer
is not bound to GDELT and can select the official provider for company
disclosures and A-share announcements.

## WebFetcher

`WebFetcher` retrieves one candidate URL and returns a bounded raw document.
`NativeWebFetcher` uses the existing native HTTP transport, supports timeouts,
validates HTTP(S) URLs, rejects non-success responses and unsupported content
types, and does not crawl linked pages. `MockWebFetcher` is used by network-free
tests. `OfficialAnnouncementFetcher` materializes content already returned by
the official announcement API, which allows CNINFO PDF-linked disclosures to
enter the same normalization path without treating a PDF viewer page as article
content. When inline content is absent, it fetches the PDF and extracts its
embedded text with `pdfjs-dist`; image-only PDFs fail explicitly instead of
creating unsupported Evidence.

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
- Crawler Provider.

RSS and Crawler providers remain future extension points. Any new provider must
preserve the SearchProvider/WebFetcher boundaries and must not introduce a
Skill, Workflow Engine, Agent, Capability, or DSH dependency.
