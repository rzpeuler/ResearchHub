# NEWS-PROVIDER-002: Official Announcement Provider

## Decision

Add a CNINFO-backed `OfficialAnnouncementSearchProvider` to the News Acquisition Layer. Reuse the existing `CninfoAnnouncementSourceAdapter` for official announcement retrieval and project its normalized records into the existing `SearchProvider` contract.

The provider will remain runtime-neutral: it may depend on the announcement source adapter and acquisition interfaces, but it must not depend on DSH, Workflow, Skill, or Artifact implementation details.

## Data Flow

```text
CNINFO official announcement API
  -> CninfoAnnouncementSourceAdapter
  -> OfficialAnnouncementSearchProvider
  -> NewsAcquisitionLayer
  -> WebFetcher / Normalizer
  -> NewsEvidenceBuilder
```

The existing GDELT provider and the existing Announcement Plugin remain available. This change adds an acquisition-layer projection; it does not replace or alter the Announcement Plugin contract.

## Search Contract Mapping

| SearchResult field | Official announcement source |
| --- | --- |
| `title` | `RawAnnouncementRecord.title` |
| `url` | `RawAnnouncementRecord.sourceUrl` when present; otherwise a stable CNINFO source URL marker |
| `snippet` | `RawAnnouncementRecord.content` |
| `source` | `RawAnnouncementRecord.source`, defaulting to `cninfo` |
| `publishedAt` | `RawAnnouncementRecord.publishedAt` |
| `metadata` | provider name, requested symbol, issuer, confidence, and official-source marker |

The provider validates the six-digit A-share symbol and bounded result limit using the existing announcement request conventions. Records without an official URL are still discoverable through the search contract; the acquisition integration test uses an injected fetcher for deterministic conversion to Evidence. Real-network validation remains explicitly opt-in.

## Testing

- Unit coverage uses a fixture source adapter and verifies the SearchResult projection.
- Acquisition integration coverage verifies Search -> Fetch -> Normalize -> Evidence with the new provider and a deterministic fetcher.
- Real provider coverage is disabled by default and runs only when `RUN_REAL_OFFICIAL_NEWS=1` is set.
- Existing GDELT and Announcement Plugin tests remain unchanged.

## Alternatives Considered

1. Add a second independent CNINFO HTTP implementation inside News Acquisition. Rejected because it duplicates the existing official-source transport and parsing logic.
2. Add RSS first. Deferred because RSS is less reliable for complete A-share official announcement coverage; it can be added behind the same interface later.

## Risks and Mitigations

- CNINFO availability and anti-automation controls may affect real-network tests. Keep them opt-in and retain fixture coverage.
- Some announcement records may lack a detail URL. Preserve the record as a search result and expose the limitation in metadata rather than fabricating a URL.
- The provider supplies facts only; research interpretation remains in Skills.
