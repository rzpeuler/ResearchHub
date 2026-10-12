# RHL-UX-001 — Session Reliability and History Implementation Report

- Status: `IMPLEMENTED / CTO ACCEPTANCE PENDING`
- Task: RHL-UX-001 — Session Reliability & History Management.
- Baseline: `origin/main` at `8a7f49d43a01aefd23b72c5103481ad5bdac51aa`.
- Branch: `codex/ux-001-session-reliability`.
- Contract: [Session Reliability and History Contract](../specs/2026-10-12-rhl-ux-001-session-reliability.md).
- Architecture decisions: [RHL UX Upgrade Plan](../plans/rhl-ux-upgrade-plan.md).

## A. Delivered behavior

- Runtime-backed conversation identity and selected-session recovery across Runtime restart.
- Server-side accepted request activities with operation ID/digest idempotency, replay protection, reserved Workflow run association, and interruption reporting after a volatile Workflow cannot be recovered.
- Durable title source, one-shot first-message/Workflow naming, permanent USER rename lock, version-guarded rename/archive/restore, archived filtering, title search, and recent activity ordering.
- Server-backed history controls and current-title restoration in the existing React client.
- Pi transcript identity checks that reject deleted transcript/sidecar rebinding, and Runtime disposal that waits for transcript-observation sidecar writes before test/workspace cleanup.

No Knowledge Schema, canonical Knowledge data, Workflow business algorithm, or Pi SDK source was changed. UX-002 was not started.

## B. Runtime and persistence boundary

Pi remains the sole transcript owner. The minimal versioned JSON metadata store lives under Runtime `runtime-data/conversation-state`; a separate atomic pointer stores the active conversation ID. It contains typed accepted request/activity records and Workflow association, not duplicate transcript messages. Runtime APIs overlay the authoritative sidecar title over Pi's session name. See the contract document for recovery and failure semantics.

The existing Pi API inspected for this implementation supports session name/session-info updates but not atomic arbitrary metadata compare-and-set. The sidecar is therefore limited to Runtime-owned title, archive, accepted-operation, and Workflow-link metadata, with per-session in-process serialization and expected revisions. No cross-process lock or transaction with Pi's JSONL transcript is claimed.

## C. Verification evidence

Commands executed from the isolated UX-001 worktree:

| Command | Result |
|---|---|
| `npx tsx --test tests/app/runtime/conversation-state-store.test.ts tests/app/runtime/slice-a.test.ts tests/app/runtime/slice-b.test.ts tests/app/runtime/slice-c.test.ts tests/app/runtime/homepage-smoke.test.ts tests/app/runtime/ux001-lifecycle.integration.test.ts tests/app/services/research-dispatch-service.test.ts tests/app/services/registries.test.ts` | PASS — 105 tests, 0 failures. |
| `npm run client:test` | PASS — 9 files, 134 tests. |
| `npm run typecheck -- --pretty false` | PASS. |
| `npm run client:typecheck` | PASS. |
| `npm run client:build` | PASS — 182 modules. Vite reports the existing 647.37 kB JavaScript chunk advisory (>500 kB). |
| `git diff --check` | PASS. |
| `npm test` | Client suite PASS — 9 files, 134 tests. Node suite exits 1 on one inherited FIX-015 assertion: generated schema JSON length is 6881, expected 6359. Re-running `npx tsx --test tests/validation/codex-production-industry-schema-compatibility.test.ts` in the clean `origin/main` worktree at the same baseline reproduces the same failure. UX-001's focused Node suite passes 105/105. |

The UX lifecycle integration starts the actual ResearchHub Runtime HTTP server with a persistent Pi session manager, creates and hashes an isolated temporary Knowledge Base, exercises request acceptance, Workflow linkage, archive/search/restore, Pi transcript switching and Runtime restart, and verifies the Knowledge Base file hash snapshot remains unchanged. It uses a registered faux Pi provider and injected controlled Workflow adapter; no external model credential, authenticated provider request, or user's mounted Knowledge Base is used. This is not a claim of real provider E2E.

## D. Limits and risks

- Live Workflow status is process-local in the existing Workflow service. After Runtime restart, a persisted run association is shown as interrupted; the task does not claim the volatile execution can continue or be reconstructed.
- Title PII/credential checks are conservative pattern heuristics and cannot identify every sensitive phrase. The first-message title falls back to `新对话` when a recognized sensitive pattern is present; accepted request activity remains user content.
- Client production build emits a Vite chunk-size advisory for the 647.37 kB JavaScript asset; the build itself passes.

## E. Git delivery

| Item | Result |
|---|---|
| Branch | `codex/ux-001-session-reliability` |
| Commit | Full SHA is included in the final delivery record. |
| Remote | Pushed to `origin/codex/ux-001-session-reliability`; local and remote HEAD match (full SHA is in the final delivery record). |
| Worktree | Isolated under `ResearchHub_worktrees/UX_001`; clean after commit and push verification. |
