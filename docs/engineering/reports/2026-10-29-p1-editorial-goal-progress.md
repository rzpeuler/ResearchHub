# P1-GOAL-001 — 长程执行进度

**CURRENT_MILESTONE:** M0 complete; M1 starting
**BASELINE_SHA:** `6989b5f010d596e7436f1f4d49841ad8845ce64c`
**WORKTREE_BRANCH:** `codex/p1-editorial-synthesis`
**MODEL_CALLS_USED/MAX:** 0/12
**BYD_SCORE_BEFORE/AFTER:** not yet assessed
**DONGSHAN_SCORE_BEFORE/AFTER:** not yet assessed
**REGRESSION_DELTA:** not yet run
**BLOCKER:** none
**NEXT_STEP:** read-only baseline of both archived reports and analysis sidecars

## M0 — preflight, protection, isolation

- Fetched `origin`; `origin/main` remains `6989b5f010d596e7436f1f4d49841ad8845ce64c`, the PR #9 merge commit. It contains the frozen P0-CLOSE source `f167a8f272e9b1faf8615a74093047091a194cf1`.
- `codex/p1-editorial-synthesis` did not exist locally or remotely. Created it in a new system-temp worktree at the current remote main. Worktree starts clean; root checkout was not switched.
- Root checkout remains on `codex/company-research-p0-01-06` at its pre-P0-CLOSE local SHA and retains five pre-existing dirty validation evidence JSON files plus untracked parser cache, startup logs, and `tmp/` artifacts.
- A before snapshot covers 7,568 protected files: 5 tracked dirty evidence JSONs and 7,563 untracked files, including 15 P0-19 archive sidecars, 28 `tmp/` artifacts, two Knowledge Base trees (7,517 files), startup logs, and parser cache. Recheck after setup: 7,568/7,568 SHA-256 equal; no added/missing paths.
- Runtime at loopback port 64897 remained live; page and `/api/status` both returned HTTP 200. No research run or Knowledge operation was triggered.
- Node v24.16.0 satisfies the repository''s Node requirement. `npm ci` in the new worktree exited 0. It reported 11 dependency audit advisories (7 moderate, 4 high); no dependency changes or auto-fix were made.

### Execution exception

Two initial combined shell invocations accidentally ran `npm ci` from the dirty root checkout instead of the new worktree. Both exited `EPERM` when the live Runtime held the esbuild executable. After each attempt, missing ignored `node_modules` files were additively restored from a verified clean P0 task worktree; existing files were not overwritten. The live Runtime returned HTTP 200 after restoration, Git status was unchanged, and the protected-file hash comparison remained exact. All subsequent dependency and validation work will use explicit isolated-worktree working directories and separate commands.

## M0 evidence

- `origin/main`: `6989b5f010d596e7436f1f4d49841ad8845ce64c`
- New worktree HEAD at creation: `6989b5f010d596e7436f1f4d49841ad8845ce64c`
- Isolated `npm ci`: exit 0
- Protected assets: 7,568 before / 7,568 after; hash mismatches 0; added 0; missing 0
- Runtime page/status: HTTP 200 / HTTP 200
- Model calls: 0/12