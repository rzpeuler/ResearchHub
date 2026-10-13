# RHL-UX-004 Test & Regression Report

- Status: `IMPLEMENTED / CTO ACCEPTANCE PENDING`
- Baseline: `origin/main` at `97de5094067792f6aee3ab1ed2a5c62757c2f20d`
- Branch: `codex/ux-004-interaction-polish`
- Browser evidence: [RHL-UX-004 Browser E2E Evidence](../../../tests/validation/evidence/RHL-UX-004-BROWSER-E2E-001.md)

## Current branch checks

| Command | Result |
|---|---|
| `npm run typecheck -- --pretty false` | PASS |
| `npm run client:typecheck` | PASS |
| `npm run client:build` | PASS; 183 modules. Vite emitted the existing advisory for a minified JS chunk over 500 kB (672.74 kB). |
| `npm run client:test` (included in `npm test`) | PASS; 11 files, 150 tests. |
| `npm test` | Client tests pass; Node suite exits non-zero on the same 21 baseline failures described below. |
| `git diff --check` | PASS; Git only reports the existing Windows LF-to-CRLF working-copy notices. |

The Client tests include the UX-004 IME/Enter/Shift+Enter/duplicate/blank-submit cases, copy success/failure, scroll hold/jump, A/B scroll isolation, history loading/no-results/retry, archive/restore, rename version conflict, and accessible status behavior. UX-001 session lifecycle, UX-002 Runtime/SSE slices, and UX-003 Workflow implementation tests remain part of the full Node test run.

## Exact Node baseline comparison

Both current and clean-baseline `npm run test:node` runs used Node `v24.16.0` and discovered 253 files:

| Checkout | Total | Pass | Fail |
|---|---:|---:|---:|
| Clean `origin/main` baseline `97de5094067792f6aee3ab1ed2a5c62757c2f20d` | 2,243 | 2,222 | 21 |
| UX-004 working tree | 2,243 | 2,222 | 21 |

After replacing each checkout path with `<WORKTREE>` and each test duration with `(TIME)`, the full failure blocks are byte-identical. Normalized SHA-256 for both failure sections: `8bc1c0f91415db03ef7b8af361a6933071803b9ec4de4cfc40178fa70cc6641b`. No new or changed Node failure was found.

The unchanged baseline failures are: Research Skill architecture (1), Theme Workspace projection (6), Competition Module Gateway (12), remaining Schema delta (1), and FIX-015 expected Schema size (1). The last observes 6,881 bytes against the stale expected 6,359 bytes in both checkouts.

## Temporary validation side effects

The full Node suite rewrites five existing EXEC-003 evidence JSON files. They were restored after the runs; no UX-004 source or evidence was included in that restoration. The temporary baseline worktree was removed after the comparison.
