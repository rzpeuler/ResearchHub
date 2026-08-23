# RH-DESIGN-006 Information Plugin Architecture

## Scope

This task defines the ResearchHub Information Data Layer for news, announcements and policy information. It is a design-only deliverable. It does not add a real information source, crawler, NLP model, sentiment analysis, external dependency or Harness change.

## Design Goals

- Make every information item traceable to a named source and source hierarchy.
- Keep information data structurally verifiable and serializable.
- Allow news, announcement and policy Plugins to share the existing Plugin Framework.
- Preserve the existing News Plugin and Harness boundaries.
- Leave room for future Event Analysis and Research Artifact integration without implementing those features here.

## Architecture

```text
News / Announcement / Policy Plugin
                ↓
PluginRegistry
                ↓
InformationPlugin<Data>
                ↓
Information Source
```

The Information Layer reuses the existing contracts:

```ts
DataPlugin<Request, InformationData>
PluginResult<InformationData>
FinancialDataMetadata
```

An Information Plugin owns retrieval, normalization, structural validation and source metadata. A Plugin consumes structured information and does not call an external source directly. Plugin registration remains the responsibility of the existing `PluginRegistry`.

## NewsItem Model

The first information-domain model is `NewsItem`:

```ts
interface NewsItem {
  title: string
  content: string
  publishedAt: string
  source: string
  sourceType: 'official' | 'media' | 'community'
  symbols: string[]
  confidence: number
}
```

Field rules:

- `title` is the source title and must be non-empty.
- `content` is the source body or a normalized content representation; this task does not define summarization.
- `publishedAt` is the source publication time and must be a valid ISO timestamp.
- `source` identifies the concrete source name or identifier.
- `sourceType` is a strict enum: `official`, `media` or `community`.
- `symbols` contains normalized A-share symbols and may be empty when the item is not yet linked to a specific company.
- `confidence` is a number in `[0, 1]` describing the Plugin's confidence in the item's source/field completeness. It is not an investment probability or sentiment score.

`NewsItem.confidence` describes one item. The existing `PluginResult.metadata` describes the Plugin result as a whole and continues to contain `plugin`, `source`, `timestamp`, `quality` and `confidence`. These two confidence values are intentionally separate.

## Source Hierarchy

`sourceType` uses the following controlled hierarchy:

- `official`: exchanges, listed companies, government departments, regulators and other primary institutional sources.
- `media`: general news, financial media and industry media.
- `community`: forums, communities and user-contributed information.

Source hierarchy is provenance and quality context. It does not automatically determine truth, investment relevance or an investment conclusion. Future source classes require an explicit versioned design decision rather than arbitrary strings.

## Plugin Interface

No new Plugin runtime contract is introduced. Future Information Plugins implement the existing generic contract:

```ts
interface DataPlugin<TRequest, TData> {
  readonly name: string
  fetch(request: TRequest): Promise<PluginResult<TData>>
  validate(value: unknown): asserts value is TData
}
```

An Information Plugin may return one or more `NewsItem` values inside its domain data. The PluginResult envelope remains the boundary for plugin-level provenance, quality and retrieval timestamp.

## Validation Boundary

The Information Layer validates structure and provenance only:

- required fields and non-empty strings;
- ISO publication timestamps;
- `sourceType` membership in the strict three-value enum;
- `symbols` as a normalized string array;
- item and PluginResult confidence ranges;
- complete PluginResult metadata.

It does not perform NLP, sentiment analysis, automatic fact verification, investment evaluation, ranking, trading or strategy changes.

## Compatibility

- `NewsPlugin` and its existing Harness tool name remain unchanged.
- Event Analysis continues to consume the existing News Plugin boundary.
- Harness Core remains untouched.
- Existing Market Plugin and Plugin Registry contracts remain the integration point.
- No real news API, announcement feed, policy feed or crawler is added by this task.

## Future Extension

Future work may add separate information domain models for announcements and policy documents, source-specific Plugins, freshness policies, deduplication, evidence linking and Event Analysis integration. Those changes must preserve the Plugin/Plugin boundary and add explicit decisions for source licensing, identity, update semantics and quality evaluation.

## Validation Criteria

The design is accepted when a new DSH can determine from this document:

1. how an Information Plugin fits the existing Registry architecture;
2. what fields and validation rules a `NewsItem` has;
3. how official/media/community source classes are represented;
4. what remains intentionally outside this design task.
