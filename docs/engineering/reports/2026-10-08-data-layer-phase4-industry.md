# Data Layer Phase 4 — Industry Runtime Migration Acceptance

## Status

`IMPLEMENTED / SOL ACCEPTANCE PENDING`

Phase 4 routes generic Industry evidence and eligible structured metrics through
DataResolver at the normal Application entrypoint. Sol architecture acceptance
is still pending. This delivery does not merge Phase 4 to `main`.

## Repository and promotion verification

| Item | Verified state |
| --- | --- |
| Worktree | `C:\Users\Administrator\Desktop\ResearchHub_worktrees\DL_GOAL_004` |
| Branch | `codex/dl-goal-004-industry-data-migration` |
| Phase 4 base | `ef3634e70e193a1f2a37172738253d3c014d9c8a` |
| `main` / `origin/main` after `git fetch origin` | `ef3634e70e193a1f2a37172738253d3c014d9c8a` |
| Phase 3 delivered head | `7cc569667327dba0afe02bf503ba885b0803b1a7` |
| Phase 3 promotion verification | Phase 3 delivered head is an ancestor of current `main`; current `main` and `origin/main` match. The Phase 3 report's “not merged” paragraph describes its earlier delivery snapshot. |
| Phase 4 source commits | `5d4bdd8`, `2f0428b`, and `41a1820` were present at start of this continuation; implementation commit: `649a3faaa8431ae94ecbea571253a355a7e0166a`; evidence commit: `0ef9111d7a02b9aabd89641e33e2e16fa7a512dd`. |
| Final Phase 4 branch head | Plan-closure commit follows the evidence commit; exact SHA is recorded in the delivery response and remote verification. |
| Merge state | Phase 4 is not merged to `main`. |

The verified Phase 3 base includes the later Phase 3 safety/PIT corrections and
is the Phase 4 starting revision. No Phase 4 changes were applied to `main`.

## Implementation

ResearchService now provides a per-run Industry DataResolver factory assembled
by Application Runtime. The Industry Workflow materializes bounded generic
document requirements in each acquisition wave, finalizes resolver documents
with publication/PIT and rights checks, and materializes the canonical
`industry_supply_demand_cycle` DOMAIN templates through
`resolveSkillRequirements` on the actual product path.

The cycle retains the original five optional needs: capacity, demand, inventory,
pricing, and utilization. Three minimal needs were added for production,
export volume, and raw-material price. These are independent exact semantic
roles. Production does not satisfy capacity; export volume does not satisfy
domestic demand. Workflow sends provider-neutral Data observation points only
to `market_size_growth` and `supply_demand_analysis`. The other six modules
receive normal document evidence only.

The production Industry Catalog intentionally has zero canonical metric
definitions. Missing identity, absent canonical metric, ambiguous or
incompatible definitions, and unsupported semantics remain typed gaps. The
resolver will not call an operation for `DISCOVERED` or `VALIDATED` metrics.
Test-only canonical catalog fixtures exercise exact source-policy selection,
Plugin operation invocation, PIT validation, unit preservation, and Skill
projection; they do not represent production promotion or live acceptance.

The existing eight modules, two-wave lifecycle, 16-section report, quality
gate, Knowledge Production Gateway, Writer, and canonical reload behavior are
preserved. The architecture guard now rejects direct acquisition calls from
Industry Workflow and Skills.

## Audited metric dispositions

| Metric/source candidate | Final disposition | Basis and boundary |
| --- | --- | --- |
| NBS `room_air_conditioner.production` | `VALIDATED_NOT_CANONICAL` | Exact annual product, unit, geography, publisher, publication date, and deterministic extraction are evidenced. Stable series/revision identity and value-version proof are not. |
| CHEAA `air_conditioner.export_volume` | `VALIDATED_NOT_CANONICAL` | Recurring exact monthly rows with household-air-conditioner labels and units. Publisher remains CHEAA; GACC is upstream attribution. No HS code or value-version proof. This is export volume, not domestic demand. |
| MIIT `lithium_battery.total_output` | `VALIDATED_NOT_CANONICAL` | Annual exact and H1 lower-bound forms retain distinct periods and qualifiers. Publication is available; value-version and source-revision proof are not. |
| MIIT lithium carbonate average price | `VALIDATED_NOT_CANONICAL` | Period average remains distinct from spot, futures, and ASP. Metric policy is not associated with the production Catalog. |
| MIIT lithium hydroxide micropowder average price | `VALIDATED_NOT_CANONICAL` | Parser now binds H1 `15.3` to hydroxide micropowder grade and retains the label in deterministic tests. A live post-fix named operation was not activated through a noncanonical catalog. |
| MIIT lithium export value | `REJECTED` as export-volume mapping | The source field is value in CNY, not physical exported quantity. |
| Eastmoney board membership | `DISCOVERED_ONLY` | A retrieval-time board snapshot is not an operating metric or historical series. |
| Capacity, utilization, inventory, domestic demand, and unsupported orders/shipments | `DISCOVERED_ONLY` or unavailable | No audited source field and canonical contract met the bar. Absence remains a gap, never zero. |

No production metric is canonical. `VALIDATED_NOT_CANONICAL` fixture rows are
not automatically used by ResearchService or Runtime.

## Production-path fixture evidence

`tests/app/services/industry-research-integration.test.ts` invokes the
Application service and traces the actual Industry Workflow, DataResolver,
exact Industry Catalog and SourcePolicy selection, named Plugin operation, and
provider-neutral Skill input. Its exact test-only canonical fixture proves:

- The room-air-conditioner production metric reaches market-size and
  supply-demand Skill inputs with canonical unit `万台`, exact period, publisher,
  publication PIT, and source identity.
- The export-volume metric reaches supply-demand separately with unit `台`.
- Capacity and demand stay explicit gaps; no production-to-capacity or
  export-to-demand mapping occurs.
- An unregistered identity still receives generic evidence resolution and
  exposes `INDUSTRY_ID_REQUIRED`.

`tests/validation/phase4-industry-data-fixture-e2e.test.ts` exercises a real
Application/ResearchService/Workflow invocation with a temporary Knowledge
Base. It verifies Skill-visible publisher and publication date, canonical
source linkage in the report, source URL, Raw reference, and rights persisted
through the existing Gateway. The test uses generic evidence, not a hand-built
DataRequirement call.

## Live source attempt

The opt-in acceptance script ran on 2026-10-08 through Application Runtime's
normal resolver composition with an empty production Industry Catalog and a
temporary Knowledge Base. Times were recorded independently:

| Field | Value |
| --- | --- |
| `startedAt` | `2026-10-08T14:37:45.722Z` |
| `asOf` | `2026-10-08T14:37:45.721Z` |
| `generatedAt` | `2026-10-08T14:38:02.828Z` |
| Network attempts | 64 |

| Route host | Calls | Transport result |
| --- | ---: | --- |
| `www.miit.gov.cn` | 12 | HTTP 200 |
| `sousuo.www.gov.cn` | 8 | HTTP 200 |
| `www.gov.cn` | 16 | HTTP 200 |
| `www.cpca.org.cn` | 24 | HTTP 200 |
| `push2.eastmoney.com` | 4 | Transport errors |

The lithium target completed the product workflow and 16-section report with
8 canonical source refs; duplicate document identities were rejected by the
resolver/Workflow boundary. The household-air-conditioner target completed a
16-section report with 0 source refs. Both runs had `PARTIAL` requirement
coverage and 0 structured observation points. All eight DOMAIN needs resolved
to `NO_CANONICAL_INDUSTRY_METRIC`; metric-specific NBS/MIIT/CHEAA acquisition
was therefore not invoked. This attempt confirms generic document transport,
parsing/admission, resolver, consumer Workflow, and honest metric gaps. It does
not claim numeric metric parser acceptance or historical value-version PIT.

The four Eastmoney transport errors, no admitted second-target documents, no
canonical metric definitions, and no post-fix live hydroxide operation remain
explicit limitations.

## Validation

| Command | Result |
| --- | --- |
| Focused Industry/Application/Data boundary and E2E command | 118/118 passed. |
| `npm run typecheck` | Passed. |
| `npm run client:typecheck` | Passed. |
| `npm run client:build` | Passed; existing 628.73 kB chunk-size advisory remains. |
| `git diff --check` | Passed; only expected Windows LF-to-CRLF notices. |
| `npm test` | Client tests 97/97 passed. Node tests: 2,095 total, 2,071 passed, 24 failed; exit 1 from baseline failures. |

The exact baseline comparison used
`_archive/DL_GOAL_004-baseline-node-2026-10-08.log` and the captured Phase 4
Node log in the SDD ledger directory. There were **0 newly failing test
identifiers**. One baseline failure now passes:
`Application Industry research projects canonical graph and replays semantic
objects without duplication`. The 24 remaining Node failures are the remaining
baseline failure identifiers; no Phase 4 identifier was added to that set.

Focused validation also includes the Phase 3 Company/Thesis provenance
regressions (updated only for the newly explicit `sourceIdentity` field), the
Industry production model-selection tests, all Industry routes, and the
Industry direct-acquisition architecture guard.

## Delivery boundary

Final status remains `IMPLEMENTED / SOL ACCEPTANCE PENDING`. The branch is
intended for push and remote-SHA verification only; Phase 4 must not be merged
to `main` without the later promotion decision. No Intelligence work, Knowledge
Schema redesign, generic planning framework, or new capability/provider
framework was introduced.
