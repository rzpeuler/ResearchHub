# Data Layer Phase 4 — Industry Runtime Migration Acceptance

## Status

`IMPLEMENTED / SOL ACCEPTANCE PENDING`

Phase 4 routes generic Industry evidence and eligible structured metrics through
DataResolver at the normal Application entrypoint. Sol architecture acceptance
is still pending. The 2026-10-09 continuation made no merge. At its start,
`main`, `origin/main`, and the existing Phase 4 branch all pointed to
`9424d3b01185d8df8310c224cffa8e81622e69b6`, which already contains the Phase 4
commit history; this current ref state supersedes earlier historical statements
that Phase 4 was not yet on `main`.

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
| Merge state at original delivery | Phase 4 was not merged to `main`. |

The table above records the original Phase 4 delivery snapshot. On the
2026-10-09 continuation, `main`, `origin/main`, and the existing Phase 4 branch
were all at `9424d3b01185d8df8310c224cffa8e81622e69b6`. No ref was reset and no
merge was performed in this continuation. The Phase 3 delivered commit
`7cc569667327dba0afe02bf503ba885b0803b1a7` remains an ancestor of `main`.

The verified Phase 3 base includes the later Phase 3 safety/PIT corrections and
was the Phase 4 starting revision. At the original delivery snapshot no Phase 4
changes had been applied to `main`.

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
pushed and remote-SHA verification is recorded in the FIX-001 supplement below;
Phase 4 is not merged to `main` and must not be promoted without the later
decision. No Intelligence work, Knowledge Schema redesign, generic planning
framework, or new capability/provider framework was introduced.

## FIX-001 — PIT, evidence provenance, and numeric availability closure

This continuation was completed on the same Phase 4 branch. The source of
truth is the `RHL-DL-GOAL-004-FIX-001` attachment read at execution time; no new
task, branch, or worktree was created.

### Safety and architecture review

- Phase 3 delivered commit `7cc569667327dba0afe02bf503ba885b0803b1a7` is an
  ancestor of both `origin/main` and the Phase 4 head.
- `main` and `origin/main` were both
  `ef3634e70e193a1f2a37172738253d3c014d9c8a` before this continuation. The
  Phase 4 branch was not merged to `main`.
- The five optional `industry_supply_demand_cycle` DOMAIN templates are only
  declarations until the product invocation materializes and resolves them.
  Acceptance evidence remains the real Application → ResearchService →
  Industry Workflow → DataResolver → Industry Catalog/SourcePolicy → Plugin →
  Skill chain in `industry-research-integration.test.ts`; no standalone
  DataRequirement fixture is used to claim runtime migration.
- `IndustryDataOperationPayload` and its document contract now live in the
  Data layer. Workflow consumes the Data contract and no longer imports the
  concrete Plugin operation module.

### FIX-001 behavior

- Application `asOf` propagates an explicit `HISTORICAL` mode to Industry
  metric requirements; requests without a cutoff use `CURRENT_VALUE_ONLY`.
  Historical numeric facts require both publication and value-version proof.
- Unknown-date documents may remain in research context and reports, but are
  excluded from durable proposals and Gateway bindings. Future and invalid
  publications remain rejected.
- Metric-operation documents pass through the same rights/PIT qualification as
  generic evidence. Matching document and metric paths share one canonical
  Source and Raw binding. An unbound observation is excluded from Skill inputs,
  marked `INDUSTRY_METRIC_PROVENANCE_GAP`, and shown as context/report-only.
- Fetched documents do not make a numeric metric `AVAILABLE` by themselves.
  No valid point yields typed parser, unit, period, PIT, or source unavailability
  while preserving the document for generic evidence qualification. Numeric
  zero remains valid; conflicts remain explicit `PARTIAL` results.
- These checks leave production and capacity, and export and domestic demand,
  as distinct semantic roles. `DISCOVERED` and `VALIDATED` metrics remain
  ineligible for runtime use. The production catalog still has zero canonical
  Industry metrics.

### FIX-001 validation

| Command or evidence | Result |
| --- | --- |
| Phase 4 Industry/Application/Data/Plugin/route/guard/E2E focused matrix | 167/167 passed |
| Phase 1–3 related focused matrix | 619/621 passed; only baseline `V39 acquisition calls all three AKShare methods` and `V65 source acquisition time is distinct from historical valuation context` failed |
| `npm test` | Client 97/97 passed; Node 2,102 total, 2,078 passed, 24 failed |
| Exact Phase 4 Node baseline identifier comparison | 25 baseline failures, 24 current failures, 0 new failures; the prior Industry replay failure now passes |
| `npm run typecheck` | Passed |
| `npm run client:typecheck` | Passed |
| `npm run client:build` | Passed; existing 628.73 kB chunk-size advisory remains |
| `git diff --check` | Passed; only expected CRLF normalization notices |
| Real-source acceptance, 2026-10-08 | 64 requests; MIIT 12 HTTP 200, Gov.cn search 8 HTTP 200, Gov.cn 16 HTTP 200, CPCA 24 HTTP 200, Eastmoney 4 transport errors |

The FIX-001 live run timestamps were `startedAt=2026-10-08T15:51:01.681Z`,
`asOf=2026-10-08T15:51:01.681Z`, and
`generatedAt=2026-10-08T15:51:14.721Z`. The direct opt-in script exited 0.

The real-source run used Application Runtime and an empty production metric
catalog. Both `锂电池` and `家用空调` completed their 16-section reports with
`PARTIAL` requirement coverage, eight explicit `NO_CANONICAL_INDUSTRY_METRIC`
gaps, zero observations, and zero canonical report Source refs. This is
transport and generic evidence-path evidence only; no structured metric
operation was activated and no metric was promoted.

### FIX-001 delivery

The continuation remains `IMPLEMENTED / SOL ACCEPTANCE PENDING`. Commit and
remote SHA, clean worktree, and unchanged `main` are recorded in the final
delivery response. Phase 4 remains unmerged pending Sol acceptance.

### Independent final review closure

The read-only whole-branch review identified that qualifier differences were
part of Industry observation slot identity, which could hide same-slot value
conflicts. The regression `Industry observation preserves same-slot conflicts`
failed before the fix (`0 !== 1`) and passed after the fix. Slot identity now
uses the metric, period, frequency, aggregation, geography, and product/grade
dimensions; each point still retains its original qualifier. Post-fix Phase 4
focused tests passed 167/167 and the exact Node baseline comparison remained
0 newly failing identifiers. No Critical or Minor review findings were
reported.

## Native continuation — 2026-10-09

### Plan review and production-path verification

The Phase 4 plan was rechecked against the user's execution decision, the
repository `AGENTS.md`, the Phase 4 spec, and the prior review record. The
review confirmed required coverage for DOMAIN materialization at the Industry
Workflow boundary, exact canonical metric matching, explicit gaps, the
production/capacity and export/demand semantic boundaries, and the real
Application → ResearchService → Industry Workflow → DataResolver → catalog /
SourcePolicy → Plugin → Skill-input path. `writing-plans` and
`executing-plans` were not present in the installed skill directories during
this continuation; the existing repository plan and its review record were
used for the manual review. The production call-chain claims were verified by
the passing Application integration and fixture E2E tests below.

### Runtime test isolation correction

The first full-suite attempt showed 45 additional HTTP/Runtime failures because
injected temporary runtimes read the repository root's persisted Knowledge
Base selection. `ResearchHubRuntimeServer` now uses an explicit `cwd` when
provided, otherwise the injected runtime's own `cwd`, before falling back to
the process working directory. This keeps settings bound to the runtime being
served and allows test fixtures to remain isolated without changing local
settings. The rerun removed all 45 environment-induced failures.

### Validation and live-source rerun

| Command or evidence | 2026-10-09 result |
| --- | --- |
| Application Industry service + HTTP routes + fixture E2E | 15/15 passed; includes typed production gaps and exact canonical fixture traversal through Plugin and Skill input. |
| Scoped Data / Valuation-Earnings / Company-Event-Thesis / Industry-Application-guard-E2E matrix | 281/283 passed; only baseline V39 and V65 failed. |
| `npm test` | Client 97/97 passed; Node 2,102 total, 2,078 passed, 24 failed. |
| Exact Node baseline identifier comparison | Baseline 25; current 24; 0 new identifiers. The prior Industry replay failure is the sole baseline failure that now passes. |
| `npm run typecheck` | Passed. |
| `npm run client:typecheck` | Passed. |
| `npm run client:build` | Passed; existing 628.73 kB chunk advisory remains. |
| Real-source Application acceptance | 64 requests; MIIT 12 HTTP 200, Gov.cn search 8 HTTP 200, Gov.cn 16 HTTP 200, CPCA 24 HTTP 200, Eastmoney 4 transport errors. Both targets completed 16-section reports with PARTIAL coverage, 8 explicit noncanonical metric gaps, and 0 structured observations. |
| Real-source timestamps | `startedAt=2026-10-08T19:50:15.785Z`, `asOf=2026-10-08T19:50:15.785Z`, `generatedAt=2026-10-08T19:50:42.093Z`. |

The real-source attempt used the normal resolver composition and an empty
production Industry Catalog. It did not activate metric-specific operations,
promote a metric, or treat transport success as metric acceptance. Production
remains honestly partial while canonical definitions are absent.

### Continuation delivery boundary

The continuation remains `IMPLEMENTED / SOL ACCEPTANCE PENDING`. It does not
claim Sol acceptance and does not perform a merge. The entry refs already
contained the Phase 4 history as recorded above; the continuation's changes are
committed only to the existing Phase 4 branch.

### Fresh verification after the approved native decision

The repository was rechecked from `C:\Users\Administrator\Desktop\ResearchHub`
on 2026-10-09. The current refs are:

| Ref | Verified SHA | State |
| --- | --- | --- |
| Phase 3 delivered commit | `7cc569667327dba0afe02bf503ba885b0803b1a7` | Ancestor of `main` and current Phase 4 HEAD |
| `main` / `origin/main` | `9424d3b01185d8df8310c224cffa8e81622e69b6` | Equal; unchanged by this work |
| Phase 4 local / upstream branch | `ac2709923ae166469bb9ac66b3967b5525cbbdaa` | Equal; remains outside `main` |
| Worktree | — | Clean before this report update |

This supersedes the earlier continuation's entry-ref snapshot. No branch,
worktree, or task was created, and no merge or ref rewrite was performed.

The production-path command
`node --import tsx --test tests/app/services/industry-research-integration.test.ts tests/validation/phase4-industry-data-fixture-e2e.test.ts tests/workflows/data-layer-foundation.test.ts tests/workflows/industry-deep-research/industry-deep-research-workflow.test.ts`
passed **87/87**. It includes the Application-invoked production Industry
Workflow resolving the declared DOMAIN needs through DataResolver and the exact
Catalog/SourcePolicy/Plugin/Skill chain; the test-only canonical path exercises
eligible structured observations while production remains noncanonical.
`npm run client:test` passed 97/97, root and client typechecks passed, and
`npm run client:build` passed with the existing 628.73 kB chunk advisory.

The fresh `npm run test:node` run reported 2,102 tests: 2,078 passed and 24
failed. Comparing normalized failing test identifiers with the committed Phase
4 baseline found **25 baseline failures, 24 current failures, zero new
identifiers, and one fixed identifier** (`Application Industry research
projects canonical graph and replays semantic objects without duplication`).
The first concurrent `npm test` run transiently reported the valuation HTTP
route test as running instead of blocked; its isolated rerun passed, and the
subsequent full Node rerun also passed that test. The full suite still exits
nonzero because the 24 remaining identifiers are pre-existing baseline
failures.

A fresh real-source Application acceptance completed at
`startedAt=2026-10-08T20:04:34.533Z`,
`asOf=2026-10-08T20:04:34.533Z`, and
`generatedAt=2026-10-08T20:04:50.678Z` (UTC). It made 64 network requests:
MIIT 12 HTTP 200, Gov.cn search 8 HTTP 200, Gov.cn 16 HTTP 200, CPCA 24 HTTP
200, and Eastmoney 4 transport errors. Both targets completed 16-section
reports with `PARTIAL` coverage, eight `NO_CANONICAL_INDUSTRY_METRIC` gaps,
zero structured observations, and zero report source refs on this attempt. The
production Catalog was empty; no metric-specific operation ran and no metric
was promoted. This records a real generic-evidence path attempt, not numeric
metric acceptance or value-version PIT proof.

The named `writing-plans` skill was not installed in the available skill
directories. The existing plan was manually re-reviewed against the approved
taskbook constraints, Phase 4 spec, repository guidance, actual source path,
and test evidence. Its review conclusion remains approved for native delivery.

### Industry Catalog projection follow-up — 2026-10-09

The default Application Runtime previously created an empty Industry Catalog,
so the Data Fields UI could only show the populated Common catalog. The
Runtime now seeds the Industry Catalog with five audited field candidates:
room-air-conditioner annual production, household-air-conditioner monthly
export volume, lithium-ion battery H1 output lower bound, battery-grade lithium
carbonate H1 period-average price, and lithium hydroxide micropowder H1
period-average price. Their semantics, units, periods, geography, and
product/grade boundaries are grounded in the Industry source audit.

These records enter the formal Catalog as `DISCOVERED`, with no SourcePolicy
association. They are visible for review but cannot trigger structured
acquisition or be passed as numeric Skill inputs because DataResolver selects
only `CANONICAL` metrics. The default production catalog now has five
definitions and zero Canonical metrics. Capacity, domestic demand, inventory,
utilization, and orders remain explicit gaps; production and export volume
remain distinct from capacity and domestic demand.

The live root Runtime was rebuilt and restarted at its dynamically assigned
local address. `GET /api/data-sources/catalog/industry` returned two identities,
five `DISCOVERED` definitions, and `canonicalCount: 0`; the Common endpoint
continued to return 21 definitions. The Industry tab renders those candidates,
their lifecycle, and the absence of SourcePolicy associations. Projection did
not trigger provider acquisition.

| Follow-up validation | Result |
| --- | --- |
| Industry projection route + rendered catalog UI + projection unit tests | 11/11 passed |
| `npm run typecheck` | Passed |
| `npm run client:typecheck` | Passed |
| `npm run client:build` | Passed; existing 643.92 kB chunk advisory remains |

This projection follow-up does not promote any metric or change the Phase 4
acceptance boundary. Status remains `IMPLEMENTED / SOL ACCEPTANCE PENDING`.
