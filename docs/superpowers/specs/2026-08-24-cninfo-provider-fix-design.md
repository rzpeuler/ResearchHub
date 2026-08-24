# CNINFO-PROVIDER-FIX-001: CNINFO Announcement Provider Fix

## Decision

Fix the existing CNINFO-backed News Acquisition path without changing the
SearchProvider, WebFetcher, Evidence, Skill, Workflow, or DSH contracts.

The source adapter will resolve the CNINFO organization identifier from the
official stock directory, then query the announcement endpoint with the
combined `code,orgId` value. It will send the browser-compatible request
headers required by the endpoint and pass an optional `seDate` range through
to CNINFO.

## Data Flow

```text
CNINFO stock directory
  -> entity resolver: 600519 -> 600519,gssh0600519
  -> CNINFO announcement query
  -> OfficialAnnouncementSearchProvider
  -> OfficialAnnouncementFetcher
  -> PDF text extraction when content is not inline
  -> HtmlArticleNormalizer
  -> NewsEvidenceBuilder
```

The provider remains runtime-neutral and only returns normalized source data.
It does not call Skills, Workflows, DSH, or ResearchManager.

## Source Adapter Changes

- Add an injectable stock-directory endpoint and cache its code-to-orgId map
  per adapter instance.
- Normalize six-digit A-share codes and map CNINFO market columns: `6`/`68`
  to `sse`, `0`/`2`/`3` to `szse`, and `8`/`4` to `bjse`.
- Send `Referer`, `Origin`, `X-Requested-With`, `Accept`, and User-Agent
  headers.
- Include `seDate` when the caller supplies start or end timestamps.
- Treat `announcements: null` with a zero total as an empty result, while
  retaining errors for malformed payloads.
- Accept CNINFO epoch-millisecond announcement timestamps.

## Content Extraction

CNINFO commonly returns a PDF `adjunctUrl` and an empty
`announcementContent`. `OfficialAnnouncementFetcher` will fetch PDF bytes
when inline content is unavailable and extract bounded page text through the
repository's PDF text extraction dependency. Unsupported or empty documents
produce a fetch error; the implementation never uses a PDF URL as article
content.

## Testing

- Existing fixture and Announcement Plugin tests remain compatible.
- Add request-shape tests for stock-directory lookup, `code,orgId`, headers,
  market column, and `seDate`.
- Add a deterministic PDF-fetch/extraction test using an injected transport.
- Keep the CNINFO real integration test disabled by default and enable it only
  with `RUN_REAL_OFFICIAL_NEWS=1`.
- The real test must assert at least one Announcement Record and one Evidence
  Artifact for `600519`.

## Risks

- CNINFO may change its undocumented web endpoint or require additional
  anti-bot controls. Transport and endpoint injection keep this recoverable.
- PDF extraction quality depends on the source PDF's embedded text layer;
  scanned image-only PDFs will be reported as extraction failures rather than
  converted into unsupported evidence.
