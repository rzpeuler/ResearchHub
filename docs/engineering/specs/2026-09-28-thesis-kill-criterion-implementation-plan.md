# RHL-TL-001 Kill Criterion Closure — Implementation Plan

**Status:** acceptance passed; main integration pending. See [final TL-001 acceptance](../reports/2026-09-28-thesis-lifecycle-final-closure.md).

**Date:** 2026-09-28

**Binding design:** `docs/engineering/specs/2026-09-28-thesis-kill-criterion-canonical-binding-design.md`

## Delivery order

1. **Canonical contract.** Extend the v0.4 Thesis type and executable schema with an optional typed/versioned criterion envelope. Validate IDs, active revision uniqueness, definition hashes, targets, numeric payload, provenance/authority, and bounds. Preserve criteria across ordinary Thesis Gateway updates. Add a criterion-specific Gateway write that uses the existing validated ChangeSet/Writer. Old Thesis records remain readable and cannot invalidate without a confirmed criterion. Focused Schema/production tests and typecheck.
2. **Deterministic evaluator.** Add a Thesis Lifecycle / Knowledge evaluator for `numeric_threshold` returning only `met`, `not_met`, or `insufficient_evidence` plus bounded diagnostics and evidence bindings. Check exact metric/unit/period, finite value, publication PIT, rights, verified Source/Raw and numeric value version. Resolve no conflicts by first-candidate choice or averaging. Unsupported types remain structurally readable but never `met`. Focused evaluator tests and typecheck.
3. **Human criterion authoring.** Add bounded prepare/confirm Application/HTTP/UI flow with preview hash, expected Knowledge revision, explicit human confirmation, idempotent run ID, Gateway/Writer commit, reload, and durable audit/result. No Pi autonomous authoring tool or direct frontend canonical write. Tests for old Thesis supplementation, replay, changed input and stale revision.
4. **REFRESH and ReviewCase.** Load active canonical criteria from the same Thesis snapshot, run the deterministic evaluator after evidence admission, preserve existing proposition semantics, and emit an invalidation ReviewCase only for a proven `met`. Bind condition ID/revision/hash, evidence value identity and Source/Raw lineage in case/report. Keep missing/unsupported/insufficient criteria blocked for invalidation while ordinary REFRESH stays usable. Focused adapter/case/report tests.
5. **Human ACCEPT.** Reload current Knowledge and rerun criterion assessment for the bound case. Detect definition changes, membership drift, evidence/value-version changes, ambiguous competing values, and rights/PIT/Raw failures. Stale/blocked cases do not write. Proven `met` uses existing APPLYING intent, Gateway/Writer, reload, report and replay path to write `invalidated`. DEFER/REJECT remain no-write. Focused decision/crash recovery tests.
6. **Acceptance and integration.** Run targeted then full Node/client/typecheck/build gates; run a real configured-Pi/source isolated-KB invalidation acceptance distinct from fixtures. Record machine JSON and human-readable evidence without secrets or source body. Reconcile TL-001 reports/spec status, review complete diff, commit/push, merge accepted branch into `main` without rewriting unrelated history, and verify remote main and clean worktrees.

## Implementation ownership

The primary Sol agent owns requirements, interfaces, architecture decisions, reviews, acceptance interpretation and Git delivery. Bounded implementation/testing tasks go to explicit Luna High subagents with non-overlapping file ownership. Dependent tasks run in order; each handoff includes focused test evidence and a spec/quality review before the next task. Any unresolved Schema-version, security, provenance, or data-loss decision returns to the primary agent before implementation continues.

## Stop conditions

Do not mark TL-001 closed from a fixture-only result, an unverified numeric value version, a stored ReviewCase `met` value, or a canonical revision increase without a matching Writer/report/reload result. The user's `ai-hardware-real` Knowledge Base is not an acceptance fixture and is not rewritten. No next product feature starts before this gate and mainline integration are complete.
