# Data Layer Phase 3 — Company, Event, and Thesis Acceptance

## Status

`IMPLEMENTED / SOL ACCEPTANCE PENDING`

This report records Phase 3 delivery evidence, including the FIX-001 Sol
acceptance corrections. It does not claim Sol architecture acceptance. Phase 3
remains on its isolated branch.

## Repository state

| Item | State |
|---|---|
| Worktree | `C:\Users\Administrator\Desktop\ResearchHub_worktrees\DL_GOAL_003` |
| Branch | `codex/dl-goal-003-company-event-thesis-migration` |
| Phase 3 base | `7648507243819b22a327b68fed4b5fb540f8ff30` |
| Phase 2 accepted `main` / `origin/main` | `7648507243819b22a327b68fed4b5fb540f8ff30` |
| FIX-001 validated code HEAD | `236095e435b66333dccfbf7c37594c49ab5413ff` |
| Final documentation HEAD | Report-only commit after the validated code HEAD; exact SHA recorded in the immutable delivery note referenced below |
| Remote branch HEAD at delivery | Verified against local final documentation HEAD; exact SHA recorded in the immutable delivery note referenced below |
| Worktree at delivery | Clean after push |
| Merge state | Phase 3 is not merged to `main` |
| Push state | FIX-001 branch push and remote verification are part of this delivery; no merge performed |

`main` and `origin/main` still point to the accepted Phase 2 SHA. Task 6
and FIX-001 changes remain committed on the Phase 3 branch only. A separate
Thesis contract commit already exists earlier on this branch.

## Architecture status update

`docs/architecture/RESEARCHHUB_DATA_LAYER_ARCHITECTURE_V1.md` now states Phase
1 and Phase 2 are accepted and Phase 3 is implemented on its isolated branch,
pending Sol acceptance. Its migration inventory describes the new Company,
Event, and Thesis resolver paths, retained Workflow boundaries, the shared
`company_research_evidence` identity, `COLLECT_DIVERSE` source semantics, and
the direct-acquisition architecture guard.

## Acceptance evidence map

| Requirement | Evidence |
|---|---|
| Company structured and document acquisition uses DataResolver | `tests/workflows/company-deep-research.test.ts` — “Company resolves neutral structured data and keeps signal append between discovery and fetch”; `tests/workflows/company-research-data.test.ts` — AKShare structured operations and `COLLECT_DIVERSE` policy tests |
| Company preserves provenance and provider-neutral Skill inputs | `tests/workflows/company-deep-research.test.ts` — structured source provenance and Gateway assertions; `tests/skills/company-research.test.ts` — “Company Skill receives all structured inputs with their acquisition provenance”; `tests/app/services/data-layer-boundaries.test.ts` — Skill import and I/O guard |
| Event anchors remain Workflow-owned and Daily Signals remain outside Common Catalog | `tests/workflows/event-research.test.ts` — “E6-E8 Daily Signal is exact, company-bound, and missing signals block”; “E70-E75 manual article, URL, and user-event anchors stay Workflow context…”; `tests/validation/phase3-data-layer-fixture-e2e.test.ts` — one shared evidence identity and no Daily Signal identity |
| Event time window, PIT, unsafe URL, generic dedup, partial outcome, and contradiction behavior | `tests/workflows/event-research.test.ts` — “E81 anchor point-in-time checks…”; “E83 anchor fields and source URLs are bounded and unsafe URL targets are rejected before fetch”; “E84 provider outcome flags…”; “E26-E33 future/out-of-window/URL/content duplicates…”; “Unknown publication dates remain contextual…”; “E42b Stage B receives exact bounded supporting and contradicting excerpts…”; “E53-E58 weak or conflicted verification…” |
| Thesis Stage A/B order, positive durable write, and target invariants | `tests/validation/phase3-data-layer-fixture-e2e.test.ts` — “Thesis Red Team fixture E2E acquires through Data while preserving target Thesis, Company, and signal durability boundaries”; test supplies a dated, relevant CNINFO fixture, validates high-strength disconfirming evidence, and confirms the real Gateway commits the qualified source plus deterministic and Stage B claims. It asserts target Thesis ID/lifecycle/sourceRefs/hash and Company hash remain unchanged, while signal/unknown-date/irrelevant sources remain noncanonical |
| Thesis requirements, bounded lookback, and fail-closed no-resolver path | `tests/workflows/thesis-red-team-data-acquisition.test.ts` — both Thesis acquisition tests |
| Multi-source attempts, provenance, PIT, publisher identity, and partial outcomes | `tests/workflows/company-research-data.test.ts` — “COLLECT_DIVERSE attempts CNINFO and GDELT…”; “one provider failure and partial fetch…”; “strict date window…”; “hash dedup works across distinct URLs…”; “fetch telemetry distinguishes transport…” |
| No new direct acquisition debt | `tests/app/services/data-layer-boundaries.test.ts` — “migrated Company, Event, and Thesis Workflows reject direct provider modules and acquisition calls”; exact dependency baseline tests |
| Phase 2 regressions | `tests/workflows/valuation.test.ts` and `tests/workflows/earnings-review.test.ts` ran in the full Node suite, not the focused Phase 3 command. Failures `V39` and `V65` are present in the exact unchanged baseline failure list. |

The scoped Phase 3 command passed **74/74** tests after the Task 6 review fix:

```text
node --import tsx --test tests/validation/phase3-data-layer-fixture-e2e.test.ts tests/workflows/company-deep-research.test.ts tests/workflows/event-research.test.ts tests/workflows/thesis-red-team-data-acquisition.test.ts tests/app/services/data-layer-boundaries.test.ts tests/workflows/company-research-data.test.ts tests/plugins/research-acquisition.test.ts tests/skills/company-research.test.ts
```

## Opt-in live provider acquisition

The three Phase 3 resolver probes and the existing Company PI/real-source smoke
scripts require `RESEARCHHUB_PHASE3_LIVE=1`; without it they print `SKIPPED`
before creating temporary files, initializing Pi, or making network calls. The
existing Company callers now inject the Phase 3 resolver composition. Their
opt-in Knowledge, reports, signal files, and evidence files are all under a
unique OS temporary directory and removed in `finally`. The Phase 3 probes
likewise create a fresh disposable Knowledge Base per consumer and remove it
in `finally`. The probes call the real DataResolver acquisition composition and
record each provider leg; they do not run consumer Workflow reasoning or
produce a consumer acceptance result. No credentials or raw provider bodies
were included.

Commands:

```text
node --import tsx tests/validation/phase3-company-live-acceptance.ts
node --import tsx tests/validation/phase3-event-live-acceptance.ts
node --import tsx tests/validation/phase3-thesis-live-acceptance.ts
```

Results from the opt-in run on 2026-10-08 03:10 UTC, company `600519`:

| Consumer / provider leg | Transport / discovery | Fetch / data result |
|---|---|---|
| Company / AKShare profile | `UNAVAILABLE`; `SOURCE_ERROR` | External helper process failed |
| Company / AKShare financial history | `AVAILABLE`; `SUCCESS` | Structured data available |
| Company / AKShare market history | `UNAVAILABLE`; `SOURCE_ERROR` | External helper process failed |
| Company / CNINFO | `UNAVAILABLE`; transport succeeded, 6 candidates discovered | All 6 document parses failed because the managed Python document-parser environment was unavailable |
| Company / GDELT | `UNAVAILABLE`; `SOURCE_ERROR` | Fetch failed; no usable evidence |
| Event / CNINFO | `UNAVAILABLE`; transport succeeded, 6 candidates discovered | All 6 rejected as outside the requested 7-day event window; no candidate fetch |
| Event / GDELT | `UNAVAILABLE`; `SOURCE_ERROR` | Fetch failed; no usable evidence |
| Thesis / CNINFO | `UNAVAILABLE`; transport succeeded, 6 candidates discovered | All 6 document parses failed because the managed Python document-parser environment was unavailable |
| Thesis / GDELT | `UNAVAILABLE`; `SOURCE_ERROR` | Fetch failed; no usable evidence |

All three consumers are classified `REAL_SOURCE_BLOCKED`, with zero qualified
external documents usable for an acceptance run. This is separate from the
provider-leg status: CNINFO transport and discovery succeeded in all three
consumer probes, but document parsing or date qualification blocked use. The
Company structured financial leg was available, but the acceptance decision
requires usable external research evidence. A positive document count would be
classified `REAL_SOURCE_AVAILABLE_WORKFLOW_NOT_EXECUTED`, because these probes
do not execute the consumer Workflow or claim acceptance. The three unique
temporary Knowledge roots were checked after execution and no longer existed.
Provider access, parser setup, and fetch failures remain operational follow-up
items.

## Full validation

| Check | Result |
|---|---|
| `npm test` client suite | PASS, 97/97 tests |
| FIX-001 focused Company/Event/Thesis/Data/architecture command | PASS, 70/70 tests |
| FIX-001 `npm test` on validated code HEAD `236095e435b66333dccfbf7c37594c49ab5413ff` | Client 97/97 passed; Node 2,071 total, 2,046 passed, 25 failed |
| Phase 2 baseline `npm test` at `7648507243819b22a327b68fed4b5fb540f8ff30` | Client 97/97 passed; Node 2,036 total, 2,011 passed, 25 failed |
| Exact baseline failure set comparison | PASS: 25 baseline, 25 current, 0 added, 0 missing |
| `npm run typecheck` | PASS after FIX-001 changes |
| `npm run client:typecheck` | PASS after FIX-001 changes |
| `npm run client:build` | PASS; Vite emitted the existing large-chunk advisory |
| `git diff --check` | PASS; only Windows line-ending normalization notices |
| Live scripts without opt-in | PASS safety check: all five skipped before runtime/temp/network side effects |

The expected baseline identifier list was read from the ignored SDD workspace
file `.superpowers/sdd/2026-10-08-data-layer-phase3-company-event-thesis-migration/baseline-failed-identifiers.txt`
and left unchanged. The FIX-001 Node run had exactly these same 25 failing
identifiers as the detached Phase 2 baseline:

```text
Application Industry research projects canonical graph and replays semantic objects without duplication
ChangeSet validation rejects denied or missing Raw evidence listed by a competition Module
company projection is readable through a canonical business exposure without adding a company graph node
composition is source-immutable, deterministic and idempotent
current restricted or expired source rights suppress company exposures and dependent competition data
different rows may retain different currencies and a changed column schema blocks for review
evidence-backed cell update commits, and an unavailable update preserves the prior usable value
FIX-015 offline evidence inputs preserve authoritative contracts and expected source sizes
Gateway blocks numeric Module cells that disagree with their canonical facts
Gateway creates a competition Module and maps its local proposal ID
Industry projection returns bounded facts, deterministic core views, publication-labeled dates, future catalysts and competition units
Module blocks the whole submit when a cell reference cannot resolve
Module blocks unusable Source evidence inherited from an existing business_exposure Relation
Module blocks when the row Source payload is unusable
new Claim provenance alone cannot justify a contradictory same-reference display value
same Claim may support a canonical numeric display update after new provenance is admitted
same Industry table replays idempotently with the same canonical Module ref
semantic section classification receives only readable facts and cannot block the base projection
stale expected revision and a corrupt scope ledger fail closed
Theme graph includes only human-confirmed scope refs, preserves direction, and never expands global edges
V39 acquisition calls all three AKShare methods
V65 source acquisition time is distinct from historical valuation context
Workflow Definition Registry exposes the current executable research set
Workflow metadata composes canonical peers without registering composite Skill IDs
Writer rejection does not report success or overwrite the prior Module
```

## Remaining risks and handoff

- Live CNINFO document normalization needs its managed parser runtime for the
  Company and Thesis probes; all Event CNINFO candidates were outside the
  requested window. GDELT fetch failed in all three consumers. AKShare profile
  and market legs failed, while the financial leg returned structured data.
- Full Node tests remain red on the same 25 pre-existing failure identifiers
  as the accepted Phase 2 baseline. No new deterministic failure was identified.
- The live probes validate DataResolver/provider outcomes, not end-to-end live
  model reasoning or production Knowledge persistence.
- Legacy Company PI/real-source smoke opt-in cleanup was reviewed: their
  Knowledge, evidence, report, and signal outputs now live only below a unique
  temporary root removed by `finally`; this cleanup does not extend to other
  historical smoke scripts.
- Phase 3 remains isolated and is not merged. FIX-001 received independent
  scoped review approval; final local and remote branch SHAs are recorded in
  the immutable delivery note referenced below.

## Final review fix wave (2026-10-08)

The following review validation is retained as historical Phase 3 evidence;
FIX-001 results below are authoritative for final delivery.

The final review fixes preserve the Data-to-Skill-to-Gateway provenance path without changing Knowledge Production Gateway behavior. Company, Event, and Thesis Workflows now transform each qualified Data document with `sourceWithDataEvidenceProvenance` before Skill/Gateway use. The normalized source carries the per-document origin authority, retrieval provider, source URL, publication date, date qualification, and PIT flag in `candidate.metadata.dataProvenance`; its existing top-level `retrievedAt` and `contentHash` remain the canonical values consumed by the Gateway. Company fixture asserts canonical publisher/provider separation and data provenance metadata; Event and Thesis fixtures also assert top-level hash/retrieval fields. Event Skill projections preserve only allowlisted bounded provenance fields for Stage A and Stage B.

The live acceptance runner now counts only records in `acquisition.observations[].data.documents` that have a record, `dateStatus === QUALIFIED`, and `pointInTimeSafe === true`. It no longer reads `item.value` for `COLLECT_DIVERSE`. The deterministic fixture exercises that same aggregator with both positive qualified/PIT-safe documents and blocked/unsafe evidence, proving positive evidence cannot be misclassified as `REAL_SOURCE_BLOCKED`. Existing live probes still truthfully classify all three consumers as `REAL_SOURCE_BLOCKED` with zero usable documents; provider transport/discovery/fetch diagnostics remain separate from consumer acceptance.

### Final review validation

- Scoped cross-workflow/Data/fixture suite: 74/74 passed, including Company Gateway persistence, Event provenance passthrough, positive/blocked live aggregation, and Thesis Gateway fixture.
- `npm run typecheck`: PASS.
- `npm run client:typecheck`: PASS.
- Company/Event/Thesis Phase 3 live scripts without opt-in: all three printed `SKIPPED` before side effects. The earlier Task 6 check covered all five scripts, including the two legacy Company smoke scripts.
- `git diff --check`: PASS (Git reports only expected Windows line-ending normalization notices).
- Final controller `npm test` rerun on `3deb06824653ed2e12f4f0108a6c1fe8cf1d508f`: client 97/97; Node 2,065 total / 2,040 pass / 25 fail. Phase 2 baseline rerun: client 97/97; Node 2,036 total / 2,011 pass / 25 fail. The exact failing Node test identifiers matched: 25 baseline, 25 current, 0 added, 0 missing. The baseline client retry passed after one earlier transient UI timeout.
- The scoped Phase 3/guard suite passed 99/99 after the final runner hardening. Root and client typechecks, client build, and `git diff --check` passed. Client build reports the existing large-chunk advisory.
- No Gateway, provider, or Thesis lifecycle semantics changed. Independent final review approved the provenance and live-runner fixes. The isolated Phase 3 branch was pushed and its remote HEAD matched the local HEAD at `7cc569667327dba0afe02bf503ba885b0803b1a7`; `main` and `origin/main` remain at accepted Phase 2 SHA `7648507243819b22a327b68fed4b5fb540f8ff30`.

## FIX-001 acceptance corrections (2026-10-08)

- Company requirements now preserve explicit current versus historical mode.
  Current profile, financial, and market snapshots are labeled
  `CURRENT_VALUE_ONLY`; they are not described as historically PIT-verified.
- Historical profile and financial snapshots without snapshot/value-version
  proof remain Skill context and are excluded from durable sources and Gateway
  evidence bindings. Historical market rows use the existing
  `dailyCloseAvailableAt` rule; only rows available by `analysisAsOf` can be
  durable. Zero numeric values remain present and separate from missing data.
- Company Skill now rejects a whole proposal if any citation is not durable,
  removes proposals linked to rejected proposals, and removes stale section
  proposal links. Duplicate model proposal IDs fail closed. A Workflow/Gateway
  fixture proves a claim citing both an unversioned historical EPS value and a
  dated filing is not canonicalized, while qualified filing evidence remains
  available.
- Company maps an explicit `POINT_IN_TIME_INVALID` attempt to empty/unusable,
  not provider failure. The regression asserts attempted=true, succeeded=false,
  empty=true, failed=false, and usableSourceCount=0.
- Event and Thesis provider flags follow usable normalized evidence, while
  transport and fetch success remain separate. Partial usable evidence plus a
  failed candidate reports success and failure without empty; zero usable data
  is empty only when no operational failure occurred. Event research
  methodology, Thesis lifecycle semantics, and the Daily Signal boundary are
  unchanged.
- Independent FIX-001 review approved the combined changes. The focused suite
  passed 70/70. Full Node failures matched the accepted Phase 2 baseline exactly
  (25/25 identifiers; 0 added, 0 missing), and client tests passed 97/97.
  Root/client typechecks and client build passed; build output retains the
  existing large-chunk advisory.
- The implementation code validated before this report-only commit is
  `236095e435b66333dccfbf7c37594c49ab5413ff`. The final documentation commit
  advances the branch afterward. Its exact SHA and the verified remote branch
  SHA are recorded in the immutable local delivery note:
  `.superpowers/sdd/2026-10-08-data-layer-phase3-company-event-thesis-migration/fix001-delivery-note.md`.
- `main` and `origin/main` remain at
  `7648507243819b22a327b68fed4b5fb540f8ff30`; Phase 3 remains isolated and
  unmerged.
