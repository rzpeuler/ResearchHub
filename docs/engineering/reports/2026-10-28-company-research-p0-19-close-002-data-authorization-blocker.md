# CLOSE-002 current data and authorization blocker

**Task:** `RHL-CQR-P0-19-CLOSE-002`
**Status:** `NOT_ACCEPTED`; this records an unresolved Gate 1 / Gate 3 / Gate 4 blocker and is not a completion report.
**Branch snapshot:** `8edffe80d940ab21c393ee2f6f66d5b77212d261`
**Evidence detail:** see [Gate 1 provider and point audit](2026-10-28-company-research-p0-19-close-002-gate1-audit.md) and the Gate 0 baseline manifest.

## What was established

The saved BYD run (`82bcc425-d48d-4e55-bc45-111aa8c28ba4`, `asOf=2026-10-27T20:19:59.628Z`) and Dongshan run (`860916a8-4958-4d29-8da1-56ad5dd1c2c6`, `asOf=2026-10-27T20:26:46.347Z`) recorded successful Tonghuashun and EastMoney forecast acquisition routes. They did not persist projected estimate rows or per-point proofs. The saved artifacts therefore do not establish exact point counts, values, row-to-document links, or source versions. In both runs, the observed forecast acquisitions completed after the sealed `asOf`.

The current private proof binds an observed adapter row to an `EstimatePoint`, but all provider adapters set EPS basis, value-version status, and correction status to `UNVERIFIED`. A row hash and publication date establish neither the historical numeric value nor whether a correction had superseded it at `asOf`. The current selector correctly excludes these points. The [Gate 1 audit](2026-10-28-company-research-p0-19-close-002-gate1-audit.md) now also records the saved EastMoney PDF locators and why their presence alone does not prove accessible immutable report contents, exact point values, or correction status.

## Missing evidence for each eligible estimate point

An authorized route must supply and preserve a one-to-one, run-scoped proof for each estimate used:

- issuer and institution identity, original report identity and immutable document/version locator;
- metric, target fiscal year, original and normalized value/unit, and explicit EPS basis (`BASIC`, `DILUTED`, or `ADJUSTED`);
- exact source paragraph/table/cell and content hash that show the same value;
- original report publication time and actual availability/retrieval time no later than the sealed `asOf`;
- correction/revision identity or a verifiable statement that the value version was current at that cutoff;
- permitted internal processing/retention rights and deterministic handling of institution duplicates and conflicting revisions.

Tonghuashun's current route has no original document identity, exact document locator, EPS basis, or revision history. EastMoney may return report IDs, titles, dates, and optional URLs, but the current route does not verify that a specific immutable report contains the normalized point or establish its EPS basis and historical revision status. No route in the saved pair meets the gate. Same-provider rows across channels are not independent economic views; the current EastMoney projection is EPS-only, so there is no second net-profit channel either.

## Gate 3 and Gate 4 impact

With zero qualified historical consensus points, the current run cannot provide a version-qualified market-consensus surface. The existing validator cannot safely infer a consensus range or median from the current provider results. A house operating scenario can be separately reviewed, but by itself it is not a second expectation surface. A price-implied surface is only an alternative if a same-cutoff market price, capital structure/cash flow basis, and explicit independently reviewed valuation assumptions can all be established; it must not be reverse-engineered from an arbitrary multiple or target price.

## Gate 2 implementation status at this snapshot

The current branch now has a deterministic FY2026 operating candidate path with explicit research-assumption/derived labels, source row hashes and locators, historical base values, scenario scope, formula, sensitivity cells, separate H1 counterevidence, and six per-driver semantic decisions including falsifiability assessment. The candidate enters the second synthesis only after the first independent review and scenario checks pass. This remains a partial Gate 2 result: the code explicitly marks `OPERATING_BRIDGE_ONLY_NO_FORWARD_VALUATION`, because no valuation basis/multiple is qualified. It does not satisfy the required forward valuation bridge, full G2-03 scenario-to-checklist linkage, or Gate 4 real-company review.

The Gate 0 pair remains the last actual BYD/Dongshan acceptance evidence: both runs are `17/19`, with `bull-base-bear` and `variant-perception` blocked and zero semantic-review attempts. No later live pair has been run under the current code SHA. Their local reports and sidecars are ignored runtime artifacts, not an independently accessible evidence package. Gate 4 is therefore not met.

## Minimum decision or external evidence needed

No public `EstimatePoint`, Common Data, Knowledge, or source-policy change is proposed here. To continue without widening the current architecture, provide an already authorized source/route that exposes the point-level fields above and permits the exact report/value/version to be retained internally, or separately approve a specific new source and its access rights if none is currently available. Do not approve a route based only on a mutable current page, retrieval hash, displayed report date, or provider success flag.

If no authorized immutable point-version route exists, the remaining compliant alternatives are:

1. separately authorize and implement a point-level source contract after a consumer/compatibility review; or
2. use a genuinely independent, source-bounded price-implied expectation surface only after its required same-cutoff market, cash-flow, capital-structure, and valuation inputs pass the existing evidence and semantic gates.

Neither alternative is implemented or assumed approved by this report. No provider query, paid-source access, PDF download, budget change, model retry, Knowledge write, or public-contract change was made for this blocker assessment.
