# P1-GOAL-001 — 长程执行进度

**CURRENT_MILESTONE:** M3 partial; blocked before M4 same-input model replay
**BASELINE_SHA:** `6989b5f010d596e7436f1f4d49841ad8845ce64c`
**WORKTREE_BRANCH:** `codex/p1-editorial-synthesis`
**MODEL_CALLS_USED/MAX:** 0/12
**BYD_SCORE_BEFORE/AFTER:** 3/3/3/3/3/2 → NOT_AVAILABLE
**DONGSHAN_SCORE_BEFORE/AFTER:** 3/3/3/3/3/2 → NOT_AVAILABLE
**REGRESSION_DELTA:** no new failures versus clean-main matched failing tests; 21 Node and 5 Client full-suite failures persist on main
**BLOCKER:** Runtime catalog reports the selected model candidate available, but `openai-codex` provider auth is unconfigured and direct Pi `ModelRuntime` has no available snapshot
**NEXT_STEP:** once the existing authorized Pi provider is configured, replay the archived inputs with the same model before assessing candidate quality

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

## M1 — archived baseline and gap classification

- Read both archived Report JSONs, analysis JSONs, bundle/workflow sidecars and summary metadata without writing to their directory.
- Baseline report: `docs/engineering/reports/2026-10-29-p1-editorial-baseline.md`. It records run/report IDs, `asOf`, 19 section IDs/order, per-section evidence-location counts, source snapshot hashes, report/analysis/bundle/workflow file hashes, quality gaps, exact supporting/counterevidence locators and six-dimensional pre-scores.
- Both reports have 10 complete methods, 19 sections, `researchQuality.passed=false`, and `17/19`. The failed `bull-base-bear` and `variant-perception` issues remain unchanged.
- M1 classifies the achievable gains as `EDITORIAL_ORDERING` and `DUPLICATE_OR_GENERIC`; no material cross-section contradiction was found in the two synthesis-owned sections. Scenario/expectation gaps are `SOURCE_MISSING` / `OUT_OF_P1_SCOPE` and will remain blocked.
- The archive omits normalized rights fields and retrieval timestamps. The exact saved synthesis handoff uses 9 BYD and 6 Dongshan candidate IDs. Static source-path review found those IDs map to current adapters that explicitly permit public-source AI processing and retention. Replay is therefore scoped to the frozen source-content snapshot and exact existing method evidence; it is not represented as a full acquisition-event replay.
- Baseline scores for each company (in order: thesis, causal chain, counterevidence, monitoring, cross-section consistency, concision): `3/3/3/3/3/2`. The only score below 3 is supported by duplicated caveats/detail, plus Dongshan's citation-spacing defect; see baseline report for excerpts and exact locators.

## M2 — minimal change decision

| Current behavior | Minimal change | Expected benefit | Regression risk and guard |
| --- | --- | --- | --- |
| The synthesis contract asks for core judgment/support/counterevidence but does not explicitly rank the lead operating driver and strongest disconfirmer before strategic extensions. | Add a short instruction to order the existing `investment-thesis` as judgment → decisive operating driver → best evidence and disconfirmer → failure condition; keep only claims supported by this handoff. | Makes the thesis usable in an opening read while preserving the same evidence set. | Could overcompress or elevate inference; retain existing 5-paragraph/2-sentence ceiling, locators, semantic and numeric checks, and test ungrounded/blocked claims stay out. |
| The request discourages repetition but does not tell synthesis to avoid duplicating method tables and caveats verbatim. | Add a small editorial priority to keep detail in owning chapters, repeat only what the thesis needs, and state each scope limitation once. | Reduces the two observed repetition patterns without deleting source-owned evidence. | Could omit a material qualifier; tests require the customer concentration, operating-cash counterevidence, product-category margin scope, blocked scenarios and PIT boundary to remain represented where relevant. |
| Monitoring starts with overlapping customer-concentration rows for Dongshan and has no enforced causal order across the list. | Ask for monitoring items to follow thesis drivers and consolidate only rows that monitor the same underlying mechanism; retain at most nine items. | Connects next checks to the thesis and frees space for commercialisation and cash-conversion checks. | Consolidation could hide distinct disclosed measures; tests require top-five and largest/second customer values/locators to remain distinct within a combined row. |


## M3 — bounded synthesis-priority change (partial)

- Added one short priority to the existing `company_research_synthesis` instruction: lead with judgment → decisive operating driver → supporting evidence and disconfirmer → failure condition; order monitoring by the same causal chain; compress only repeated method detail and merge only genuinely duplicate monitored mechanisms.
- Did not alter the 19 section IDs, method ownership, source/evidence allowlist, numeric/citation validators, quality gates, Workflow, Skill, Report contract, or Knowledge path.
- Added assertions to the existing assembly test. The focused assembly suite passed 112/112. Root typecheck, Client typecheck, and Client build passed.
- Full Node suite: 3,284 passed, 21 failed out of 3,305. The same 21 failure titles reproduced on clean `origin/main` at `6989b5f`; matched failing files are `research-skill-architecture.test.ts`, `theme-workspace-projection.test.ts`, `competition-module-gateway.test.ts`, `codex-module-remaining-schema-deltas.test.ts`, and `codex-production-industry-schema-compatibility.test.ts`.
- Full Client suite: 223 passed, 5 failed out of 228. All five same titles reproduced on clean `origin/main` in `App.test.tsx` (3) and `report-navigation.test.tsx` (2).
- The full suites regenerated five tracked validation evidence JSONs in the isolated worktree and a parser `__pycache__`; the tracked JSONs were restored because the worktree started clean. The remaining untracked cache is excluded from staging. Root checkout and its user files were not used for tests.

## Stop condition — direct Pi authentication unavailable

- The user's runtime selection is `openai-codex/gpt-6-luna`, and `/api/settings` reports this catalog candidate `available=true`. The same response reports `modelProviders.openai-codex.configured=false`. A separate Pi `ModelRuntime` initialized from the standard Pi agent directory with model-network refresh disabled lists the candidate in its catalog but returns an empty available-model snapshot.
- Catalog availability therefore does not establish that the permitted Pi synthesis executor can authenticate. No synthesis call, test-connection call, alternative provider, or data acquisition was made; model calls remain 0/12.
- The minimum unlock is successful configuration of the existing OpenAI Codex Pi provider, after which the same-source replay can continue. No new provider, model, account, or paid source is requested.
- Acceptance record: `docs/engineering/reports/2026-10-29-p1-editorial-goal-acceptance.md`, status `BLOCKED_MODEL_OR_EVIDENCE`.
- Existing PR #10 is updated with this partial code/test evidence and block; it remains unmerged.
- Documentation-only PR #10: `https://github.com/rzpeuler/ResearchHub/pull/10`; it contains the baseline/progress/acceptance records only.
- M3–M6 product implementation, after-quality assessment, code validation and CTO-ready PR are not claimed. No merge is authorized.
