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

## Supplement: existing EastMoney PDF locator assessment (2026-10-28)

The local ignored Gate 0 report artifacts do contain EastMoney AKShare rows with `报告PDF链接` locators (for example, in `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/002384-company-research-002384-860916a8-4958-4d29-8da1-56ad5dd1c2c6.md` and the corresponding BYD report). Those saved rows are enough to identify candidate URLs and the API-returned forecast fields. They do not contain downloaded PDF bytes, a PDF content hash, an exact page/table-cell locator, or a checked comparison showing that the PDF states the same metric, fiscal year, and normalized number. The saved run also lacks per-point proof records, and its forecast acquisitions completed after their sealed `asOf`.

The current `EastmoneyReportClient` keeps an optional API `reportPdfUrl` as `candidate.url` (falling back to a mutable report page), but its normalized source content is built from the API record and does not include PDF bytes or a document locator. The AKShare EastMoney adapter copies the row's optional PDF URL into candidate metadata/content and binds the selected field to the private proof's API-row hash; it does not fetch or parse the linked document. Neither adapter verifies that the URL is HTTPS, public without authentication, stable, or still points to the identified report. `EarningsEstimatePointProof` therefore proves only a projection from an observed API row; its basis, numeric value-version, and correction statuses remain hard-coded `UNVERIFIED`.

The adapters declare `accessScope=public`, internal retention and AI/derivative processing allowed, and `redistributionAllowed=false` under `personal_noncommercial_research`. That declaration is consistent with privately processing a lawfully accessed public document, but it neither verifies access to any particular PDF nor provides a redistribution grant. As no existing saved PDF was fetched or independently inspected in this audit, these artifacts do not establish an exact report-to-point binding or that access needs no paid/authenticated entitlement. No proof-contract promotion is justified from a URL alone; all current provider point statuses must remain `UNVERIFIED` pending an already-authorized, cutoff-compatible document capture with content hash and exact value locator. No provider, PDF, paid source, or model was queried for this supplement.

## Supplement: public PDF access and report-specific rights check (2026-10-28)

A read-only browser inspection of the saved Dongshan EastMoney candidate URL, [Shanghai Securities' 2026 H1 Dongshan report](https://pdf.dfcfw.com/pdf/H3_AP202609021828932204_1.pdf), found the FY2026 forecast table on page 2. Its EPS amount and fiscal year match the EastMoney AKShare candidate retained in the ignored local report artifact, but the table does not identify basic, diluted, or adjusted EPS; the basis remains `UNSPECIFIED`. This verifies that the URL resolves to a report containing the corresponding projected metric; it does not bind the missing persisted earnings-expectation point from the saved run, provide a stored PDF hash/exact normalized source locator, or prove historical revision status.

The report's final-page notice states that it is for Shanghai Securities clients and restricts publication, copying, quotation, or republication without written authorization. The adapter's generic `personal_noncommercial_research` rights metadata is not evidence that this report-specific restriction is satisfied. The PDF was inspected through the browser only; no PDF file or report text was saved to the workspace or Git. The point remains ineligible pending a source-specific authorization/retention basis and run-scoped point proof. This direct-access spot-check does not remove the Gate 1 blocker and does not authorize other broker PDFs.

## Gate 1 result and minimum evidence needed

No currently authorized route can pass Gate 1 for the saved pair. A future eligible point requires a private, one-to-one proof of the normalized estimate and exact source; issuer/institution/report identity; metric, FY, raw and normalized unit, and EPS basis; original publication date and actual `availableAt`/`retrievedAt` no later than the sealed `asOf`; exact document/table-cell locator and content hash; correction/revision status; source rights; and deterministic institution/revision conflict handling. Every attribute must be proven per point. No public `EstimatePoint` or Common Data field was added.

This is a source/data-authorization blocker for `variant-perception`, not a code-quality pass. Do not treat it as complete, and do not rerun models hoping to repair absent point evidence.
