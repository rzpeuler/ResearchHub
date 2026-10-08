# Data Layer Phase 3 — Company, Event, and Thesis Acceptance

## Status

`IMPLEMENTED / SOL ACCEPTANCE PENDING`

This report records Task 6 fixture and provider-acquisition evidence. It does
not claim Sol architecture acceptance. Phase 3 remains on its isolated branch.

## Repository state

| Item | State |
|---|---|
| Worktree | `C:\Users\Administrator\Desktop\ResearchHub_worktrees\DL_GOAL_003` |
| Branch | `codex/dl-goal-003-company-event-thesis-migration` |
| Phase 3 base | `7648507243819b22a327b68fed4b5fb540f8ff30` |
| Phase 2 accepted `main` / `origin/main` | `7648507243819b22a327b68fed4b5fb540f8ff30` |
| Task 6 starting HEAD | `e0673ce6d226cf315deb8273f2f62221033ee695` |
| Merge state | Phase 3 is not merged to `main` |
| Push state | Task 6 controller requested local commit only; push remains pending final review |

`main` and `origin/main` still point to the accepted Phase 2 SHA. Task 6
changes are committed on the Phase 3 branch only. A separate Thesis contract
commit already exists earlier on this branch and is not part of the Task 6
commit.

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
| Thesis Stage A/B order and target invariants | `tests/validation/phase3-data-layer-fixture-e2e.test.ts` — “Thesis Red Team fixture E2E acquires through Data while preserving target Thesis, Company, and signal durability boundaries”; test asserts Stage A precedes resolver creation, Stage B follows acquisition, Thesis ID/lifecycle/sourceRefs/hash are unchanged, Company hash is unchanged, and signal/unknown-date/irrelevant sources are not canonicalized |
| Thesis requirements, bounded lookback, and fail-closed no-resolver path | `tests/workflows/thesis-red-team-data-acquisition.test.ts` — both Thesis acquisition tests |
| Multi-source attempts, provenance, PIT, publisher identity, and partial outcomes | `tests/workflows/company-research-data.test.ts` — “COLLECT_DIVERSE attempts CNINFO and GDELT…”; “one provider failure and partial fetch…”; “strict date window…”; “hash dedup works across distinct URLs…”; “fetch telemetry distinguishes transport…” |
| No new direct acquisition debt | `tests/app/services/data-layer-boundaries.test.ts` — “migrated Company, Event, and Thesis Workflows reject direct provider modules and acquisition calls”; exact dependency baseline tests |
| Phase 2 regressions | `tests/workflows/valuation.test.ts` and `tests/workflows/earnings-review.test.ts` were included in the focused run and full Node suite. The two Valuation failures (`V39`, `V65`) are in the baseline list; all other focused cases passed. |

The scoped Phase 3 command passed **73/73** tests:

```text
node --import tsx --test tests/validation/phase3-data-layer-fixture-e2e.test.ts tests/workflows/company-deep-research.test.ts tests/workflows/event-research.test.ts tests/workflows/thesis-red-team-data-acquisition.test.ts tests/app/services/data-layer-boundaries.test.ts tests/workflows/company-research-data.test.ts tests/plugins/research-acquisition.test.ts tests/skills/company-research.test.ts
```

## Opt-in live provider acquisition

The three Phase 3 resolver probes and the existing Company PI/real-source smoke
scripts require `RESEARCHHUB_PHASE3_LIVE=1`; without it they print `SKIPPED`
and make no network calls. The existing Company callers now inject the
Phase 3 resolver composition. The opt-in run created a fresh Knowledge
Base under a unique OS temporary directory for each consumer and removed each
directory on completion. The probe calls the real DataResolver acquisition
composition and records per-source attempts and evidence outcomes. It does not
run Pi reasoning or make a full research proposal. No credentials or raw
provider bodies were included.

Commands:

```text
node --import tsx tests/validation/phase3-company-live-acceptance.ts
node --import tsx tests/validation/phase3-event-live-acceptance.ts
node --import tsx tests/validation/phase3-thesis-live-acceptance.ts
```

Results from the opt-in run on 2026-10-08, company `600519`:

| Consumer / provider leg | Transport / discovery | Fetch / data result |
|---|---|---|
| Company / AKShare profile | Attempted | `SOURCE_ERROR`; Python helper subprocess failed |
| Company / AKShare financial history | Attempted | `SUCCESS`; data available |
| Company / AKShare market history | Attempted | `NO_DATA`; empty provider payload |
| Company / CNINFO | Transport succeeded; 6 candidates discovered | All 6 document parses failed because the managed Python document-parser environment was unavailable; no usable fetch |
| Company / GDELT | Discovery request failed with HTTP 429 | No candidate fetch |
| Event / CNINFO | Transport succeeded; 6 candidates discovered | All 6 rejected as outside the requested 7-day event window; no candidate fetch |
| Event / GDELT | Discovery request failed with HTTP 429 | No candidate fetch |
| Thesis / CNINFO | Transport succeeded; 6 candidates discovered | All 6 document parses failed because the managed Python document-parser environment was unavailable; no usable fetch |
| Thesis / GDELT | Discovery request failed with HTTP 429 | No candidate fetch |

The live scripts are provider-acquisition diagnostics only. Their results show
partial runtime availability and do not establish successful live research or
Knowledge persistence. Provider access, parser setup, rate limits, and empty
results remain operational follow-up items.

## Full validation

| Check | Result |
|---|---|
| `npm test` client suite | PASS, 97/97 tests |
| `npm test` Node suite | 2,064 tests discovered; 2,039 passed; 25 failed |
| Exact baseline failure set | PASS comparison: baseline 25, current 25, added 0, missing 0 |
| `npm run typecheck` | PASS |
| `npm run client:typecheck` | PASS |
| `npm run client:build` | PASS; Vite emitted the existing large-chunk advisory |
| `git diff --check` | PASS; only Windows line-ending normalization notices |
| Live scripts without opt-in | PASS safety check: all three skipped without network |

The expected baseline identifier list was read from the ignored SDD workspace
file `.superpowers/sdd/2026-10-08-data-layer-phase3-company-event-thesis-migration/baseline-failed-identifiers.txt`
and left unchanged. The current full Node run had exactly these same 25 failing
identifiers:

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

- Live CNINFO document normalization needs its managed parser runtime; GDELT
  discovery was rate-limited during this run. AKShare profile and market legs
  did not return usable values, while the financial leg did.
- Full Node tests remain red on the same 25 pre-existing failure identifiers
  as the Phase 3 baseline. No new deterministic failure was identified.
- The live probes validate DataResolver/provider outcomes, not end-to-end live
  model reasoning or production Knowledge persistence.
- Phase 3 has not been pushed or merged. Final Git delivery is pending the
  controller's scoped review and push decision; `main` remains at accepted
  Phase 2.
