# ResearchHub Professional Media Plugin MVP Design

## Task

RH-ENG-007 — implement a professional media Information Plugin for market-explanation evidence.

## Goal

Add a Media Plugin that follows the existing Information Plugin architecture and exposes professional media records to the unchanged News Plugin boundary:

```text
News Plugin
    -> Plugin Registry
    -> media-plugin
    -> MediaPlugin
    -> ProfessionalMediaSourceAdapter
    -> Fixture / Future Professional Media Source
```

The MVP standardizes media records as NewsItem-compatible values, records publisher and source tier, supports stock-symbol association, and remains deterministic without network access.

## Constraints

- Do not modify Harness Core.
- Do not modify the News Plugin public contract.
- Do not modify the Event Analysis Skill.
- Do not add NLP, summarization, sentiment analysis, community-opinion analysis, investment judgment, trading, or crawler logic.
- Do not add an external media SDK or dependency.
- Tests must use injected fixture adapters and must not require external network access.
- Keep the source protocol behind an adapter so future licensed or public professional-media sources can be added without changing Plugin or Skill code.

## Architecture

### MediaPlugin

`MediaPlugin` implements the existing generic `DataPlugin` interface. It owns:

- request normalization and symbol validation;
- conversion from source records into media NewsItem values;
- explicit source rating and confidence validation;
- stock-symbol mapping;
- PluginResult metadata generation.

It does not fetch an HTTP endpoint directly and does not interpret the meaning of an article.

### ProfessionalMediaSourceAdapter

`ProfessionalMediaSourceAdapter` is a source-neutral boundary. It returns raw media records with source-specific details already normalized by the adapter. The MVP supplies a deterministic fixture implementation for tests and controlled validation. A future adapter can connect to a licensed professional media source without changing MediaPlugin.

### News Plugin Compatibility

The existing News Plugin contract uses `headline`, `timestamp`, and a single `symbol`. A Registry-boundary projection maps:

- `title` to `headline`;
- `publishedAt` to `timestamp`;
- the requested symbol to `symbol`;
- `content`, `source`, and item confidence without semantic transformation.

The projection is the only legacy compatibility code. News Plugin and Event Analysis remain unchanged.

## Data Model

### Canonical Media NewsItem

```ts
interface MediaNewsItem {
  title: string
  content: string
  publishedAt: string
  source: string
  sourceType: 'media'
  symbols: string[]
  confidence: number
  metadata: {
    publisher: string
    tier: 'tier-1' | 'tier-2' | 'tier-3'
    confidence: number
  }
}
```

`MediaNewsItem` is NewsItem-compatible and adds media-specific source metadata. The two confidence values have different scopes:

- `confidence` describes the individual normalized item;
- `metadata.confidence` describes publisher/source attribution and field completeness.

Neither confidence value is a sentiment score or an investment return probability.

### Plugin Metadata

The Plugin continues to use the existing `FinancialDataMetadata` envelope with:

```ts
{
  plugin: 'media-plugin'
  source: 'professional-media'
  timestamp: string
  quality: 'high' | 'medium' | 'low'
  confidence: number
}
```

Publisher and tier remain item-level metadata because a result can contain records from different publishers or tiers.

## Source Rating

The MVP uses a strict tier enum:

- `tier-1`: established professional financial media with strong editorial and attribution controls;
- `tier-2`: recognized industry or financial media with a narrower or less independently verified coverage boundary;
- `tier-3`: lower-confidence professional media source pending further validation.

Tier records source hierarchy only. It does not assert that an article is factually correct or relevant to an investment decision.

## Stock Symbol Mapping

Mapping is explicit and conservative:

1. Normalize a source security code to the six-digit A-share symbol.
2. If only an issuer identity is available, use an injected issuer-to-symbol map.
3. Reject records that cannot be mapped unambiguously or that map to a different requested symbol.

The Plugin never infers a symbol from free-form article content.

## Error Handling

- Invalid symbols, limits, tiers, timestamps, confidence values, or required text fail validation.
- Source adapter failures are propagated with Plugin context and without credential leakage.
- Malformed source records are rejected; no partial NewsItem is emitted.
- An empty successful result is allowed and retains valid batch metadata.

## Testing Strategy

Tests cover:

1. Raw fixture normalization into `sourceType: 'media'` NewsItems.
2. Publisher, tier, item confidence, and batch metadata validation.
3. Security-code and issuer-to-symbol mapping.
4. Source errors and malformed records.
5. Registry registration as `media-plugin` and invocation through unchanged News Plugin.
6. Event Analysis creation of Evidence, Thesis, and Prediction from media evidence.
7. Full TypeScript and repository test suite compatibility.

No default test performs a network request.

## Documentation and Governance

Implementation will add:

- `docs/architecture/MEDIA_PLUGIN_DESIGN.md`

It will update README navigation, project status, task registry, roadmap, and changelog. The implementation commit will use:

```text
feat: add professional media plugin
```

and will be pushed to `main`.

## Out of Scope

- Direct integration with a named media API.
- Article summarization or translation.
- Sentiment, topic, or event classification.
- Community or social-media data.
- Duplicate detection across media sources.
- Automatic investment conclusions or strategy changes.
