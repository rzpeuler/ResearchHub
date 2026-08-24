# Real News Plugin Validation Design

**Task:** PLUGIN-VALIDATION-001  
**Status:** Implemented
**Date:** 2026-08-24

## Goal

Validate that the ResearchHub News Plugin can retrieve real external news
metadata, normalize it through the existing Plugin boundary, and inject it
into the existing Company Research pipeline without changing Workflow, Skill,
DSH, or Artifact contracts.

## Architecture boundary

The new `GdeltNewsProviderAdapter` is a data-only Provider Adapter. It
implements the existing `DataPlugin<NewsSearchInput, NewsPluginData>` shape
and is registered through `PluginRegistry`. It does not import DSH, invoke a
Skill, create investment conclusions, or modify the News Plugin interface.

The runtime path is:

`GDELT DOC API -> GDELT Adapter -> PluginRegistry -> NewsPlugin -> Company Research Skill -> Evidence/Thesis/Prediction -> Evaluation`

The existing `CompanyResearchWorkflow` remains responsible for calling the
News Plugin and creating Evidence. The Provider Adapter only fetches and
normalizes external records.

## Query and normalization

The current News Plugin input contains only `symbol`, so the adapter preserves
that interface. It maps known symbols to a configured entity name; the default
validation fixture maps `600519` to `Kweichow Moutai`, while unknown symbols are
queried as supplied. The default GDELT time window is `7d`, configurable by
adapter options or `NEWS_GDELT_TIMESPAN`. The result limit is bounded by the
adapter configuration and defaults to 10.

The adapter calls the GDELT DOC ArticleList endpoint with JSON output. Each
accepted article must provide a title, URL, source domain, and parseable
publication timestamp. The unchanged News Plugin item contract receives:

- `headline`: GDELT article title;
- `content`: the verifiable article title text, because ArticleList does not
  guarantee article-body content;
- `source`: the article domain;
- `timestamp`: normalized ISO-8601 publication time;
- `confidence`: a bounded data-quality score based only on field completeness.

Provider-level metadata remains in the existing `PluginResult.metadata`
fields (`plugin`, `source`, `timestamp`, `quality`, `confidence`). The adapter
does not infer sentiment, causality, bullishness, bearishness, or investment
meaning. URL and raw provider fields remain adapter-owned metadata and are not
promoted into the research method layer.

## Error handling and safety

The adapter uses an injected `fetch` implementation for deterministic tests and
supports bounded request timeouts and cancellation. It rejects non-success HTTP
responses, non-JSON payloads, malformed ArticleList structures, invalid dates,
empty titles, and records without a source domain. It never logs credentials
or persists raw external responses. Empty valid search results are returned as
an empty News Plugin result rather than converted into fabricated Evidence.

## Validation plan

Deterministic tests cover URL construction, symbol-to-entity mapping,
normalization, metadata, malformed responses, HTTP failures, timeouts, and
empty results without network access.

An opt-in real integration test is excluded from default `npm test`. When
`RUN_REAL_NEWS_PLUGIN=1` is set, it calls GDELT for `600519`, registers the
adapter through `PluginRegistry`, runs the existing Company Research pipeline
with fixture Market and Financial ports, serializes the generated Evidence,
and evaluates the unchanged Prediction. The test asserts that external news
records reached the News Plugin and that no Plugin or pipeline boundary was
changed.

## Documentation and non-goals

`CURRENT_STATUS.md` and `CHANGELOG.md` will record successful real News Plugin
validation. This task does not add a new Workflow, Skill, DSH runtime feature,
sentiment layer, article crawler, article-body extraction service, or a new
Plugin interface.
