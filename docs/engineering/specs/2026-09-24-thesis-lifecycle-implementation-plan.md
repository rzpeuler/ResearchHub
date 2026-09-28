# RHL-TL-001 Thesis Lifecycle Implementation Plan

Date: 2026-09-24

Status: ACCEPTANCE PASSED / MAIN INTEGRATION PENDING (2026-09-28). See [final TL-001 acceptance](../reports/2026-09-28-thesis-lifecycle-final-closure.md).

Branch: `codex/tl-001-product-closure`
Authority: TL-001 product design plus the implementation contract amendment.

## Target journey

Select one existing canonical Thesis, reconstruct its proposition Claims from
active `qualifies` edges, admit PIT-safe accepted evidence, run the existing
refresh Skill, persist a truthful report and any required ReviewCase, and let a
user ACCEPT, REJECT, or DEFER. ACCEPT must rebind current Knowledge and use the
Gateway, Validator, Writer, and reload path. REJECT/DEFER must make no semantic
Knowledge write. A small CREATE path establishes the same canonical graph.

## Work sequence

1. **Gateway existing endpoints.** Add producer-only existing canonical source
   and target selectors for ReasoningEdges. Validate selector exclusivity,
   endpoint kinds/lifecycle, and current-revision existence. Test accepted and
   rejected endpoint combinations.
2. **Thesis ReviewCase contract.** Add the narrow v0.4 Thesis scope and truthful
   canonical research evidence binding. Keep v0.3 cases valid and keep
   `impact.affectedProposalRefs` as dependent proposal IDs. Test v0.4
   assumption/catalyst cases and invalid/mismatched bindings.
3. **Gateway existing evidence.** Add verified existing Source/Raw pair use for
   proposals; require current active Source, permitted rights, Source-to-Raw
   membership and actual Raw archive. Preserve all existing source acquisition
   behavior and reject unsafe pairs before Writer.
4. **Snapshot and refresh adapter.** Resolve exactly one selected Thesis and
   active proposition graph; derive a deterministic prior snapshot. Resolve
   canonical evidence refs and their Source/Raw/publication data; apply PIT
   filter before `refreshThesis()`. Preserve unchanged proposition refs and
   exact Skill diagnostics. Test absent, ambiguous, inactive, future, unknown,
   and unbound cases.
5. **Thesis review and durable decisions.** Build Claim-root Thesis-scoped
   ReviewCases with exact bounded evidence relation and target Claim binding,
   persist before returning actionable
   status, and implement compare-and-write protected decision history. ACCEPT
   uses current rebind and a deterministic Gateway command. Reconcile an
   interrupted APPLYING intent with Writer logs and canonical state. Make
   actionable list/get/count decision-aware. Test DEFER transitions, REJECT
   no-write, ACCEPT replay/conflict, stale revision, and crash recovery.
6. **Product service and reports.** Add a normal ResearchService lifecycle run,
   Workflow status/cancel, report validation/persistence and summary. Add a
   small CREATE path with Thesis, Claim, and `qualifies` proposals. Report
   status, PIT exclusions, before/after, deltas, unchanged refs, cases,
   decisions, canonical refs and revisions. Ensure failed persistence cannot
   be reported as complete.
7. **Interaction.** Add bounded HTTP and Pi launch/report/decision commands;
   client surfaces select the Thesis, inspect evidence and deltas, and submit
   only case ID, ACCEPT/REJECT/DEFER and bounded note. No client Knowledge
   mutation primitive is exposed.
8. **Acceptance.** Run focused and full deterministic tests, typechecks and
   client build. Run one configured-Pi real accepted-source path with an
   unchanged and a challenged proposition, then ACCEPT/reload/replay. Run a
   negative DEFER or REJECT path and prove canonical revision/semantic state
   unchanged. Record external blockers honestly if real source/Pi is unavailable.

## Ownership and review

The primary Sol agent owns contract interpretation, task bounds, design
corrections, diff review, acceptance classification and Git delivery. Luna High
subagents implement and run tests in bounded file sets. After each engineering
task, Sol checks specification compliance and code quality before delegating
the next dependent task. Independent file sets may proceed together; Gateway
and Review store edits must not overlap.

## Stop conditions

Stop for `DESIGN_SCHEMA_GAP`, a need for a new canonical store or writer path,
untruthful evidence binding, or an unresolved product/governance decision.
External live-source or Pi unavailability is an acceptance blocker to report,
not a reason to replace real evidence with fixtures.
