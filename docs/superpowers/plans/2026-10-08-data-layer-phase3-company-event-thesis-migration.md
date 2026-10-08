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

