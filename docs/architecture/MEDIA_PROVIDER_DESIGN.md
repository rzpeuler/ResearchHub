# Professional Media Provider Design

## 1. Positioning

The Professional Media Provider adds market-explanation information to ResearchHub's Information Layer. It supplies attributed professional-media evidence; it does not summarize, classify sentiment, make investment judgments, or analyze community opinion.

```text
News Capability
    -> Provider Registry
    -> media-provider
    -> MediaProvider
    -> ProfessionalMediaSourceAdapter
    -> Fixture / Future Professional Media Source
```

The implementation follows the existing Capability → Registry → Provider → Source Adapter boundary. News Capability and Event Analysis Skill remain unchanged.

## 2. Media Provider Architecture

`MediaProvider` implements the common `DataProvider` contract and owns:

- request validation and bounded result limits;
- canonical `NewsItem` normalization;
- explicit stock-symbol mapping;
- publisher/tier/confidence validation;
- ProviderResult metadata generation.

`ProfessionalMediaSourceAdapter` owns the source boundary. The MVP provides `FixtureProfessionalMediaSourceAdapter` for deterministic validation. A future adapter can connect to a licensed or public professional media source without moving source-specific protocol into the Provider or Capability.

## 3. Source Hierarchy

Media source quality is represented by a strict tier:

| Tier | Meaning |
| --- | --- |
| `tier-1` | Established professional financial media with strong editorial and attribution controls. |
| `tier-2` | Recognized industry or financial media with a narrower or less independently verified coverage boundary. |
| `tier-3` | Lower-confidence professional media source pending further validation. |

Tier is a source hierarchy signal, not a factuality guarantee, sentiment score, or investment recommendation.

## 4. NewsItem and Source Metadata

Media output retains the shared NewsItem fields:

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

Item confidence describes the normalized article. `metadata.confidence` describes source attribution and field completeness. Neither value represents an expected return or sentiment.

The batch continues to use the existing Provider metadata envelope:

```ts
{
  provider: 'media-provider'
  source: 'professional-media'
  timestamp: string
  quality: 'high' | 'medium' | 'low'
  confidence: number
}
```

## 5. Stock Symbol Mapping

The Provider normalizes source security codes such as `600519.SH`, `SH600519`, or `600519`. If an adapter supplies only an issuer name, an explicit issuer-to-symbol map is required. Ambiguous, invalid, or mismatched mappings are rejected. The Provider never guesses a symbol from article content.

## 6. News Capability Integration

The Registry entry is `media-provider`. A boundary projection preserves the existing News Capability contract:

| Media NewsItem | News Capability field |
| --- | --- |
| `title` | `headline` |
| `publishedAt` | `timestamp` |
| requested symbol | `symbol` |
| `content` | `content` |
| `source` | `source` |
| item `confidence` | `confidence` |

Publisher and tier remain available from the canonical MediaProvider result; the legacy Capability output is not changed.

## 7. Validation

The MVP tests cover:

- source fixture normalization;
- `sourceType: 'media'`;
- publisher, tier, item confidence, and batch metadata;
- security-code and issuer-name mapping;
- malformed records and source failures;
- Registry registration and unchanged News Capability invocation;
- Event Analysis creation of Evidence, Thesis, and Prediction from media evidence.

All default tests use fixture data and do not access the network.

## 8. Future Adapters

Future adapters may connect to named professional financial media, licensed feeds, or approved public sources. Each adapter must preserve publisher attribution, source tier, publication time, symbol mapping, and confidence metadata. No adapter may introduce NLP, sentiment, community-opinion, trading, or investment-decision logic into the Provider boundary.
