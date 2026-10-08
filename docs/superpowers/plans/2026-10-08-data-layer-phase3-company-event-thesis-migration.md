# RHL-DL-GOAL-003 Implementation Plan

**Baseline:** `7648507243819b22a327b68fed4b5fb540f8ff30`
**Branch:** `codex/dl-goal-003-company-event-thesis-migration`
**Source audit:** `docs/superpowers/specs/2026-10-08-data-layer-phase3-source-migration-audit.md`

## Design summary

Add three Common identities for Company structured inputs and one shared
company-scoped external research-evidence identity. The Data-owned policies
select the existing AKShare, CNINFO, and GDELT Plugin operations. Structured
inputs use one explicit `FIRST_VALID` candidate each; documents use
`COLLECT_DIVERSE` so each configured evidence route is attempted and its
outcome remains visible. Data owns reusable date qualification, provenance,
and generic URL/hash dedup. Plugin code owns provider requests, provider wire
parsing, and normalized records. Runtime supplies explicit resolver factories
to ResearchService; no registry, auto-discovery, service locator, or second
execution framework is added.

Company keeps its source cap, Skill mapping, quality gate, report/Gateway path,
and existing signal-store projection. Event keeps anchors, event-window
meaning, source roles, verification, impact analysis, proposal gates, and
signal context. Thesis keeps Stage A/B order and methodology, evidence
qualification, durable proposal gates, signal context, and immutability
checks. None of these paths writes Daily Signals into Data Catalog or moves
monitoring into Data.

## Work sequence

1. **Freeze baseline and audit.** Promote and remotely verify the exact
   accepted Phase 2 HEAD; record the clean Phase 3 worktree baseline. Complete
   the source matrix before changing implementation.
2. **Add Data contracts and catalog policies.** Add only the four audited
   Common identities. Materialize requirements with runtime company, cutoff,
   period, and consumer context. Define explicit policies and operation IDs.
3. **Add Plugin resolver operations.** Implement Company structured-data
   adapters and multi-source research-evidence adapters. Preserve raw
   provider outcomes and document-level provenance; do not label GDELT as the
   original publisher. Keep AKShare-shaped rows behind the Plugin boundary.
4. **Add Data evidence qualification.** Apply generic future/invalid/outside-
   period checks, URL/content-hash dedup, cancellation, and per-source
   provenance. Unknown-date evidence may remain report-only only with
   `pointInTimeSafe=false`; it cannot satisfy strong historical verification.
5. **Migrate Company Deep Research.** Replace direct AKShare reads and the
   Workflow Plugin loop with typed requirements and resolver results. Map
   provider-neutral data into existing Company Skill inputs. Keep signal
   append behavior at its existing Workflow compatibility point.
6. **Migrate Event Research.** Keep anchor resolution in Workflow; replace
   CNINFO/GDELT direct calls with the shared evidence resolver. Preserve
   window, source-role, verification, semantic dedup, reports, and Gateway
   behavior.
7. **Migrate Thesis Red Team.** Keep signal projection and Stage A/B method;
   resolve external evidence through the same shared identity and policy.
   Preserve all target Thesis / Company immutability and evidence-durability
   invariants. Remove provider-name filtering and use explicit operation
   composition.
8. **Compose runtime and close architecture debt.** Wire explicit resolver
   factories in `application-runtime.ts` and `research-service.ts`. Tighten
   the deterministic guard to reject both concrete Provider imports and
   direct acquisition-plugin calls from the three migrated Workflows. Remove
   only the exact migrated dependencies from the debt baseline; keep Phase 4,
   Phase 2, and Intelligence exceptions explicit.
9. **Validate and document.** Run focused Data/Company/Event/Thesis,
   architecture, Phase 2 regression, fixture E2E, full Node and client suites,
   typechecks, build, and diff check. Compare exact full-suite failing test
   identifiers against a same-environment detached baseline at Phase 3's base.
   Attempt real Company/Event/Thesis source runs with disposable Knowledge and
   report each leg truthfully. Update architecture/report and push the branch.

## Task briefs

### Task 1: Shared Common Data and research-evidence resolver operations

Add the four audited Common identities and Data-owned policies. Implement
explicit AKShare structured-data operations and CNINFO/GDELT multi-source
research-evidence operations with per-document provenance, strict future and
invalid-date handling, period qualification, generic canonical-URL/content-
hash deduplication, partial outcomes, and cancellation. Unknown-date evidence
may be returned only as non-PIT-safe context. Preserve retrieval provider and
original publisher as distinct fields. Add unit tests for policy matching,
all-source attempts, partial failure, zero/missing payloads, publication
windows, dedup, unknown dates, and provenance. Scope: `data/**`,
`plugins/research-acquisition/**`, and focused Data Layer tests only; do not
change Workflow contracts or app composition in this task.

### Task 2: Company Deep Research migration

Replace direct `akshare.companyBasic`, `financialData`, and
`historicalMarketData` calls and the Workflow discovery/fetch/normalize loop
with injected DataResolver operations. Materialize all four requirements and
map resolver results into provider-neutral Skill inputs. Preserve existing
Company methodology, source caps, report and Knowledge Gateway path, quality
gate, diagnostics/outcomes, and the `ResearchSignalStore` append point after
discovery and before fetch. Keep the Skill free of I/O and AKShare-shaped raw
payloads. Cover available/missing structured inputs, official/news legs,
partial failure, future/unknown-date evidence, zero/missing values,
cancellation, and signal side effects. Scope: Company Workflow/contracts,
minimal Company Skill input contract changes if required, and focused Company
tests; no changes to Event or Thesis.

### Task 3: Event Research migration

Keep all anchor resolution, validation, Company matching, event identity,
window meaning, source-role assignment, evidence assessment/verification,
impact methodology, semantic duplicate-event logic, Gateway behavior, and
Daily Signal handling in their current owners. Replace only direct
CNINFO/GDELT Plugin operations, document-level PIT filtering/provenance, and
generic URL/hash dedup with the shared resolver. Preserve provider transport,
fetch, and usable outcome semantics. Cover user-event/article/URL/daily-signal
anchors, date boundaries, unsafe URL, dedup, partial provider failure, unknown
date, and contradictory evidence. Scope: Event Workflow/contracts and focused
Event tests; no changes to Company or Thesis.

### Task 4: Thesis Red Team migration

Keep exact active Thesis resolution, dependency projection, recent Daily
Signal context, Stage A attack design, Stage B synthesis, qualification,
verdict consistency, proposal gates, report, and immutability checks unchanged.
Replace direct CNINFO/GDELT Plugin loops and generic date/dedup logic with the
shared resolver. Remove Plugin-name filtering and use explicit Data operation
composition so the configured CNINFO adapter is actually reachable. Cover
lookback/asOf, future/outside/unknown dates, dedup, partial failure, evidence
qualification, and no Thesis/Company/Signal/irrelevant-source mutation. Scope:
Thesis Red Team Workflow/contracts and focused Thesis tests; no changes to
Company or Event.

### Task 5: Runtime composition and architecture boundary

Compose resolver factories explicitly in `application-runtime.ts` and
`research-service.ts`, preserving compatibility for direct callers through
the same Data path. Strengthen the exact boundary guard to reject concrete
Provider imports and neutral `ResearchAcquisitionPlugin` `.discover/.fetch/
.normalize` calls from Company/Event/Thesis Workflows, while allowing Plugin
implementations and Data executor composition. Remove only migrated entries
from the exact debt baseline. Add synthetic guard tests. Scope: app
runtime/service and data boundary tests; do not alter the migrated Workflow
behavior or architecture-document final status in this task.

### Task 6: End-to-end evidence, full validation, report, and delivery

Add/extend deterministic fixture E2E paths for Company, Event, and Thesis and
run Phase 2 resolver/Workflow regressions. Run full `npm test`, both
typechecks, client build, architecture guard, focused suites, and `git diff
--check`. Compare exact full Node failing test identifier sets against a
detached worktree at the Phase 3 base. Attempt opt-in live Company/Event/Thesis
source acceptance using disposable Knowledge and truthfully record every
provider leg. Update the Data architecture document to Phase 2 accepted and
Phase 3 implemented/pending. Write the required dated engineering report,
commit and push the Phase 3 branch, and verify clean worktree plus local/remote
SHA equality. Scope: tests/validation, architecture/report docs, and
acceptance scripts; no provider or workflow semantics changes except
validation defects accepted by the controller.

## Acceptance evidence map

| Requirement | Evidence |
|---|---|
| Company structured and document acquisition crosses DataResolver | Data policy and adapter tests plus Company E2E assertions over materialized requirements and resolver attempts |
| Company Skill gets provider-neutral inputs and performs no I/O | typed mapping tests and existing Skill dependency guard |
| Event anchors and Daily Signal boundary are unchanged | anchor fixture E2E for all four anchor kinds; no Daily Signal catalog identity; signal refs remain operational-only |
| Event evidence has period/PIT/provenance and honest provider outcomes | resolver and Event E2E for future/outside/unknown dates, unsafe URL, duplicate URL/hash, partial provider errors, and contradictory evidence |
| Thesis acquisition changes without changing Stage A/B or lifecycle semantics | Thesis E2E with before/after target IDs, lifecycle, sourceRefs, hashes, signal canonicalization, irrelevant/unknown-date canonicalization |
| Multi-source acquisition attempts every source | `COLLECT_DIVERSE` policy test showing per-source attempts and partial outcomes |
| No new direct Workflow acquisition debt | deterministic architecture guard tests for concrete imports and `.discover/.fetch/.normalize` calls |
| Phase 2 remains intact | Common policy matching, DataResolver, historical PIT, earnings fallback, strict historical valuation regression |
| No deterministic full-suite regressions | exact failed test identifier set comparison against detached baseline |
| Real source results remain truthful | opt-in Company/Event/Thesis acceptance outputs identify each provider leg and transport/fetch/empty reason |

## Scope limits

No Industry catalog/policy/provider changes, Knowledge Schema/Writer/Gateway
changes, Thesis lifecycle changes, Skill methodology rewrite, Daily
Intelligence or continuous monitoring work, generic provider registry,
Capability layer, DI framework, or attack-vector-specific search is included.

## Global constraints

- Phase 3 starts from the accepted Phase 2 promotion on `origin/main`; Phase 3
  stays on its isolated branch and is not merged to `main`.
- Workflow owns research lifecycle and orchestration; Skill owns methodology;
  Data owns requirement resolution, Common Catalog identity, source policy,
  fallback, PIT, provenance and generic source dedup; Plugin owns external
  provider operations and provider-specific parsing.
- Company, Event, and Thesis share one Common identity for the same external
  research-evidence input; Daily Signal and anchor context are never Catalog
  inputs. Do not Catalog event/thesis research conclusions.
- `company_research_evidence` uses `COLLECT_DIVERSE`, attempts CNINFO and
  GDELT independently, exposes partial/failure outcomes, and never merges
  contradictory facts. CNINFO remains statutory; GDELT remains an aggregator
  route unless original publisher evidence is explicit.
- Company Skill performs no resolver I/O and receives no AKShare-shaped raw
  payload. Existing research method, signal-store compatibility projection,
  quality gate, report, and Gateway flow remain intact.
- Event anchor validation, source roles, verification, impact, and semantic
  event identity stay Workflow/Skill-owned. Existing Event window and caps,
  cancellation, safe-URL checks, and durability gates remain intact.
- Thesis Daily Signals remain context. Stage A/B method, proposal gating, and
  Knowledge behavior remain intact. Target Thesis ID, lifecycle, `sourceRefs`,
  and canonical hash remain unchanged; Company canonical hash remains
  unchanged; Signal, irrelevant, background-only, unsupported, or unknown-date
  evidence is not automatically canonicalized.
- Do not modify Knowledge Schema v0.4, Writer, Gateway semantics, canonical
  IDs, Thesis lifecycle semantics, Industry research/catalog, or Intelligence.
- Add no provider registry, service locator, DI framework, capability layer,
  continuous monitor, subscription, or attack-vector-specific retrieval.
- Remove only migrated acquisition debt from the exact architecture baseline;
  new direct provider imports and direct `.discover/.fetch/.normalize` calls
  in migrated workflows must fail deterministic guard tests.
- Validation includes Data, Company, Event, Thesis, architecture, Phase 2
  regression, fixture E2E, full Node/client tests, exact-failure-set baseline
  comparison, both typechecks, build, diff check, and truthful live-source
  attempts for all three workflows.
- Final branch is pushed and clean; final report states the final and remote
  SHA, while `main` contains Phase 2 but not Phase 3.
