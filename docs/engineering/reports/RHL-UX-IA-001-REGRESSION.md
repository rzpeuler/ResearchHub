# RHL-UX-IA-001 Regression

Status: `BASELINE_FAILURES_IDENTICAL / CTO ACCEPTANCE PENDING`

## Environment and baseline

Clean main: `9ca20a86467767a12feec4e79fb18874a70f99d6`, detached isolated baseline worktree. Node v24.16.0; npm 11.13.0; Windows x64. `npm ci` succeeded in baseline and task worktrees. Package-lock SHA256: `8628FB6EDB88CE00BBD0C27E3AD0E4100B3FA1ECEEB017CD7A14E47CB650E8B2`.

## Results

| Validation | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run client:typecheck` | PASS |
| `npm run client:build` | PASS; Vite bundle-size advisory |
| Final `npm run client:test` | 178/178 PASS, 13 files |
| ReportAppendix component cases | 22/22 PASS |
| App/navigation group | 67/67 PASS before final additional appendix case; final full Client suite covers final source |
| Conversation store + Bundle + actual session integration | 24/24 PASS |
| Report/Bundle, observation persistence/store, UX-001, session association integration | 22/22 PASS |
| Real browser E2E-01–09 | PASS; see browser report |
| Clean-main `npm test` | Client 152/152; Node 2255 / 2234 pass / 21 fail; exit 1 |
| Task `npm test` | Client 178/178 on final source; Node 2258 / 2237 pass / 21 fail; exit 1 |
| Final Client suite | 178/178 after dotted-ID compatibility test and manual selection isolation |
| Full Node failure comparison | 0 new, 0 disappeared, 0 changed; identical full failure records |
| `git diff --check` | PASS |

Full suite covers existing UX-001 history, UX-002 realtime/idempotency/SSE, UX-003 observed progress and UX-004 interactions. This is a baseline-compatible result, not an all-green Node suite. Three new Node cases account for the total increase.

Targeted command: `node --import tsx --test tests/app/services/research-report.test.ts tests/app/services/research-bundle.test.ts tests/app/services/workflow-observation-persistence.test.ts tests/app/runtime/workflow-observation-store.test.ts tests/app/runtime/ux001-lifecycle.integration.test.ts tests/app/runtime/ux-ia-session-bundle.integration.test.ts`.

## Full failure comparison

Reused `tests/validation/compare-node-test-failures.mjs`; added only optional `--task-id` metadata, preserving its default and comparison rules. Compared raw baseline and branch `npm test` logs. Normalization is limited to each worktree root, path separators and per-test duration. Error types/codes/messages, assertion diffs, actual/expected, source positions and every stack frame are preserved. Evidence: `tests/validation/evidence/RHL-UX-IA-001-BASELINE-COMPARISON.json`.

Both normalized failure-record hashes: `f19d233ce6560cc44fa3611e796072b6ee1765e64028d1920f3ff2b893b28136`.

The comparison labels its branch capture `UX-IA-001-final-working-tree`, accurately indicating the precommit validation snapshot. Final delivery SHA is reported after commit. Five legacy test-generated evidence files were restored to their original Git content; new UX-IA evidence was retained. Unrelated root and historical main worktree changes were preserved.

## Limits

External model/provider quality is outside the deterministic browser fixture's evidence. No test failure was suppressed or expected value relaxed. The inherited Node failures and Vite size advisory remain. Final browser evidence covers the final rebuilt production source.
