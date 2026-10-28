# Company Research P0-19 CLOSE-002 — Gate 1 provider and point audit

**Status:** `NOT_ACCEPTED`; no authorized current route qualifies an EPS point.
**Branch snapshot audited:** `5a7a0f1` (`5a7a0f1` is the remote-verified snapshot containing the Gate 1 cutoff check).
**Scope:** Read-only review of the saved BYD and Dongshan run sidecars and current estimate projection code. No provider was queried and no report PDF was downloaded.

## Saved-run evidence

The two local saved analyses are under the ignored directory `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/`. The matching summary records BYD run `82bcc425-d48d-4e55-bc45-111aa8c28ba4` and Dongshan run `860916a8-4958-4d29-8da1-56ad5dd1c2c6`; both were `blocked`, `17/19`, with 10/10 methods and zero semantic-review attempts.

| Company | Analysis `asOf` | EPS routes | Net-profit route | Saved point evidence |
|---|---|---|---|---|
| BYD (002594) | `2026-10-27T20:19:59.628Z` | THS primary completed `20:20:01.163Z`; EastMoney individual-report fallback completed `20:20:04.180Z` | THS completed `20:20:01.163Z` | EPS and net profit are recorded as `AVAILABLE`, `pointInTimeSafe=false`, `valueVersionStatus=UNVERIFIED`. The sidecar does not preserve projected estimate rows or per-point proof records, so exact candidate counts and estimate values cannot be reconstructed. |
| Dongshan (002384) | `2026-10-27T20:26:46.347Z` | THS primary completed `20:26:48.000Z`; EastMoney individual-report fallback completed `20:26:49.000Z` | THS completed `20:26:48.000Z` | Same persisted quality status and same missing point-level artifacts. |

Each listed acquisition completed after its run's sealed `asOf`. A source's reported publication date, provider-row hash, or later report-generation time cannot be substituted for its actual availability at `asOf`. The preserved sidecars therefore establish successful routes and an as-of timing contradiction, but do not prove the values of the individual forecast rows.

## Route field lineage and qualifications

| Route | Fields projected today | What the private row hash proves | Missing for an eligible point |
|---|---|---|---|
| Tonghuashun via AKShare | Institution name; provider report date; FY EPS and net-profit fields; EPS normalized to `CNY_per_share`, net profit to CNY. Source URL is a generic THS forecast page. | The exact row was observed by the adapter and the selected field/value was bound to its `EstimatePoint`. | Original report identity and immutable document locator; report URL; provider institution ID; EPS definition basis; revision/correction history; separately recorded point availability time; a source document binding the same forecast value. |
| EastMoney AKShare research-report route | Institution name; date; optional report title/PDF URL; FY EPS field normalized to `CNY_per_share`. | The exact returned row and selected field/value are joined to the point. | Verified report contents and exact page/table locator; point proof currently omits a report object ID; EPS definition basis; immutable value version and correction/revision evidence. A URL or candidate hash alone does not prove the linked report contains the normalized value. |
| Native EastMoney report API | Institution/report `infoCode`; publication date; EPS forecast field and normalized value. | The API record and chosen forecast row are bound to the point with `providerObjectId`. | Exact accessible original-document locator and proof of the value in that document; EPS basis; immutable historical value version and correction/revision evidence. |

All three routes use the private `EarningsEstimatePointProof` sidecar; its status fields are currently hard-coded to `UNVERIFIED`. The selector now requires exact estimate/source/provider/metric/value/unit/period/institution/publication bindings, a source retrieved no later than `asOf`, allowed public/AI/retention rights, and verified basis, value-version, and correction statuses. Thus the code-level eligible coverage is 0 for the current adapters, regardless of provider success. The saved runs do not contain row totals, so no `0/N` coverage claim can be made from those artifacts.

The adapter rights metadata permits public-source internal processing and retention under `personal_noncommercial_research` and sets `redistributionAllowed=false`. This is not an independent data-rights grant and does not authorize redistribution of source text.

## Comparability and prohibited substitutions

- THS projects EPS and net profit; the current EastMoney forecast projection is EPS-only. No two-route net-profit surface exists.
- Each route maps EPS to `CNY_per_share`, but none of the point contracts establish `BASIC`, `DILUTED`, or `ADJUSTED`. The basis is `UNSPECIFIED`; same unit is not proof of same denominator.
- Two provider channels can contain the same institutions. Dedupe removes overlapping institution estimates. A remaining channel median difference is channel-sample variation, not independent economic opinion or market expectation gap.
- Current-row hashes, row publication dates, and retrieval timestamps do not prove an earlier numeric version or correction history. Moving either saved report's `asOf` would conceal the timing contradiction and is not allowed.

## Gate 1 result and minimum evidence needed

No currently authorized route can pass Gate 1 for the saved pair. A future eligible point requires a private, one-to-one proof of the normalized estimate and exact source; issuer/institution/report identity; metric, FY, raw and normalized unit, and EPS basis; original publication date and actual `availableAt`/`retrievedAt` no later than the sealed `asOf`; exact document/table-cell locator and content hash; correction/revision status; source rights; and deterministic institution/revision conflict handling. Every attribute must be proven per point. No public `EstimatePoint` or Common Data field was added.

This is a source/data-authorization blocker for `variant-perception`, not a code-quality pass. Do not treat it as complete, and do not rerun models hoping to repair absent point evidence.
