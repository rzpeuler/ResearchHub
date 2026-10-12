# RHL-UX-001 — Session Reliability and History Implementation Report

- Status: `ACCEPTANCE_COMPLETE / CTO REVIEW PENDING`
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
| `npx tsx --test tests/app/runtime/conversation-state-store.test.ts tests/app/runtime/slice-a.test.ts tests/app/runtime/slice-b.test.ts tests/app/runtime/slice-c.test.ts tests/app/runtime/homepage-smoke.test.ts tests/app/runtime/ux001-lifecycle.integration.test.ts tests/app/services/research-dispatch-service.test.ts tests/app/services/registries.test.ts` | PASS — 106 tests, 0 failures. |
| `npm run client:test` | PASS — 9 files, 134 tests. |
| `npm run typecheck -- --pretty false` | PASS. |
| `npm run client:typecheck` | PASS. |
| `npm run client:build` | PASS — 182 modules. Vite reports the 648.81 kB JavaScript chunk advisory (>500 kB). |
| `git diff --check` | PASS. |
| Focused UX-001 Runtime suite | PASS — 106 tests, 0 failures. |
| `npm test` on UX-001 branch | Client suite PASS — 9 files, 134 tests. Node suite: 2,207 passed, 21 failed (2,228 total). |
| `npm test` on clean `origin/main` baseline | Client suite PASS — 9 files, 124 tests. Node suite: 2,185 passed, 21 failed (2,206 total). Full error blocks—including actual/expected values, source positions, and stack frames—match after normalizing checkout paths and elapsed-time noise; SHA-256 is `bc52d9b732f93a6cd9cabfee672eed8be93423f8f0925f6b61cf4c573f58cb81` on both sides. UX-001 adds 22 passing Node tests and no new full-suite failures. The existing FIX-015 assertion expects generated schema JSON length 6,359 while both branches observe 6,881. Detailed comparison: [RHL-UX-001-ACCEPTANCE-001 Evidence](../../../tests/validation/evidence/RHL-UX-001-ACCEPTANCE-001.md). |

The UX lifecycle integration starts the actual ResearchHub Runtime HTTP server with a persistent Pi session manager, creates and hashes an isolated temporary Knowledge Base, exercises request acceptance, Workflow linkage, archive/search/restore, Pi transcript switching and Runtime restart, and verifies the Knowledge Base file hash snapshot remains unchanged. It uses a registered faux Pi provider and injected controlled Workflow adapter; no external model credential, authenticated provider request, or user's mounted Knowledge Base is used. This is not a claim of real provider E2E.

### Browser and Runtime acceptance

The production client build was served by the actual `ResearchHubRuntimeServer` on a dynamically assigned loopback port, backed by a fresh isolated Schema 0.4 Knowledge Base, persistent Pi SessionManager, faux Pi provider with model-network access disabled, and a controlled company-research adapter. No external model credentials or mounted user Knowledge Base were used. The fixture Knowledge Base SHA-256 was unchanged across Runtime restart.

- B1 — Submitted `帮我研究002640`; the first-message title was retained. Switching to another conversation and back, then refreshing, restored the selected conversation and its activity.
- B2 — Explicit Company Research resolved fixture entity `跨境通`; the accepted request and Workflow run ID were visible once each in the chronological Conversation timeline. Refresh retained both.
- B3 — Initial UI rename exposed a real method mismatch: the client sent `POST` to a `PATCH` Runtime route. Changed the metadata client call to `PATCH`, added a method assertion, rebuilt, and retested rename through the browser. User title `新对话` remained locked after another Workflow start.
- B4 — Archived the conversation while its Workflow was running, opened it in the archive list, and restored it. The run remained running throughout archive/restore; its accepted activities and run IDs remained visible.
- B5 — Created and submitted a second conversation, then switched back. Its request stayed in its own timeline; the original conversation retained its own four accepted activities and Workflow IDs.
- Runtime restart — The selected conversation, manual title, and all four activities restored in chronological order without duplicates. The three started Workflow runs were marked `interrupted` after restart, as specified for process-local Workflow execution; no active progress was fabricated.

Browser fixture IDs, UI observations, API assertions, baseline failure comparison, and safety evidence are recorded in [RHL-UX-001-ACCEPTANCE-001 Evidence](../../../tests/validation/evidence/RHL-UX-001-ACCEPTANCE-001.md). Browser fixture IDs observed during the primary run: conversation `01a12f90-33c4-7532-b8e2-7dc43b065faa`; Workflow runs `b5940a97-db18-404c-9d6c-005a012502e9`, `443e2002-c88c-49e7-8b81-9f332de8d632`, and `7087dc37-52fb-4a2f-a6a2-7fe97a73db8b`. These are isolated test data, not production records.

## D. Limits and risks

- Live Workflow status is process-local in the existing Workflow service. After Runtime restart, a persisted run association is shown as interrupted; the task does not claim the volatile execution can continue or be reconstructed.
- Title PII/credential checks are conservative pattern heuristics and cannot identify every sensitive phrase. The first-message title falls back to `新对话` when a recognized sensitive pattern is present; accepted request activity remains user content.
- Client production build emits a Vite chunk-size advisory for the 648.81 kB JavaScript asset; the build itself passes.
- One isolated supplemental browser-fixture folder remains in `%TEMP%` after its listener and tab were closed; automatic command review rejected cleanup. It contains only faux Agent/session state and an isolated test Knowledge Base, not mounted user data.

## E. Git delivery

| Item | Result |
|---|---|
| Branch | `codex/ux-001-session-reliability` |
| Acceptance fix commit | `b6bcc1546c7fba61f017966efe6ace90047876d8`. |
| Final branch HEAD | Full SHA is included in the final delivery record. |
| Remote | Pushed to `origin/codex/ux-001-session-reliability`; local and remote HEAD match at final verification. |
| Worktree | Isolated under `ResearchHub_worktrees/UX_001`; clean after commit and push verification. |
