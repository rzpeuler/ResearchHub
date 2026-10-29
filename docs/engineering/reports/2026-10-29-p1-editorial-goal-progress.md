# P1-GOAL-001 — 长程执行进度

**CURRENT_MILESTONE:** M5 partial; M4 real same-input synthesis replay complete, P1 quality gate not met after two editorial iterations
**BASELINE_SHA:** `6989b5f010d596e7436f1f4d49841ad8845ce64c`
**WORKTREE_BRANCH:** `codex/p1-editorial-synthesis`
**MODEL_CALLS_USED/MAX:** 6/12 P1 synthesis calls; 1 separate live Runtime connection probe
**BYD_SCORE_BEFORE/AFTER:** 3/3/3/3/3/2 → 3/3/3/3/3/2 (candidate remains nonconforming)
**DONGSHAN_SCORE_BEFORE/AFTER:** 3/3/3/3/3/2 → 3/3/3/3/3/3 (provisional; candidate remains nonconforming)
**REGRESSION_DELTA:** no new failures versus clean-main matched failing tests; 21 Node and 5 Client full-suite failures persist on main
**BLOCKER:** `gpt-6-luna` is callable, but both candidate iterations violate the existing no-numeric-values constraint in the two synthesis sections; no third iteration is authorized
**NEXT_STEP:** complete partial acceptance evidence and Git delivery; do not claim READY_FOR_CTO_ACCEPTANCE

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

## M4 preflight — archived handoff reconstruction (mock only)

- Reconstructed each bounded synthesis request from the real archived analysis/report sidecars; the fake executor returned only that archive's already-saved synthesis output. This did not invoke a model or contribute an after-score.
- BYD: fixed `asOf=2026-10-27T20:19:59.628Z`, 10 methods, 9 allowed source IDs, source body hashes matched, 3 Workflow-owned sections, and all 304 archived allowed locators reproduced with 0 missing / 0 added. Stable request-input SHA-256: `c8a3226a01d6ec90f112862f8e97f77cc910e53e5fb3a2bc7844d78c3c13e978`.
- Dongshan: fixed `asOf=2026-10-27T20:26:46.347Z`, 10 methods, 6 allowed source IDs, source body hashes matched, 3 Workflow-owned sections, and all 372 archived allowed locators reproduced with 0 missing / 0 added. Stable request-input SHA-256: `dcf16802e91820f71c6a2fc616e61a34a37e7961d63d2d5d6b0c4a02043b`.
- The normalized rights, `retrievedAt`, and source metadata/provenance fields are not retained in the archive. No values were reconstructed for them; this confirms the permitted same-content snapshot handoff, not the original acquisition event. Baseline and candidate still need to use the same reconstructed inputs if model auth is restored.
- The archive's saved synthesis outputs passed the current assembly path once per company with no diagnostics. This checks reconstruction and existing validation only; the model call count remains 0/12.

## M4 — real archived synthesis comparison (PARTIAL_PRODUCT_QUALITY)

- The live Runtime `POST /api/settings/model-test` returned success for `openai-codex/gpt-6-luna`. This was one separate connection probe; an initial request with the wrong local token header was rejected before reaching the model. No login/configuration mutation occurred.
- Replayed only `company_research_synthesis` through the existing Pi `ModelRuntime` auth/model paths. No full Company Research run, acquisition, new source call, report persistence, or Knowledge write occurred. The six P1 calls were: BYD baseline/candidate iteration 1, Dongshan baseline/candidate iteration 1, then one candidate iteration 2 for each company. All used `openai-codex/gpt-6-luna`, one attempt per assembly, and the same archived input per company across conditions.
- Frozen input details: BYD `asOf=2026-10-27T20:19:59.628Z`, 10 methods, 9 allowed source IDs, 304 allowed evidence locators; Dongshan `asOf=2026-10-27T20:26:46.347Z`, 10 methods, 6 allowed source IDs, 372 locators. The aggregate source-content hashes match M1: BYD `e341f61ea5a3d43be05e3b10e1e2d3597cf5d60e716847194c4514e5603fe2bd`; Dongshan `42b23c9e4f0be94534e42eeae1504ba42433ff153d58bfa4a2bd23c4f215b0c9`.
- Canonical JSON SHA-256 over the actual synthesis `request.input` was identical across baseline/candidate and both candidate iterations: BYD `76d6e52dd6d0a6a25d016d24a0adba6b99c22c4b6c59f25d34466d26ad631158`; Dongshan `1fc05ffcece4e7b416d2fff4e9d24067a241b72959fb1d8a34a3bd47443aa8e0`. These differ from the earlier M4 mock-preflight hashes (`c8a3…` / `dcf1…`), which used a different serialization and are not claimed as equivalent hashes; the per-run same-input equality is the comparison evidence.
- Calls completed in 24.039s, 36.608s, 28.071s, 45.392s, 30.603s, and 46.398s respectively (211.111s total wall time). The provider/executor did not expose token or charge usage. All six outputs passed the existing assembly validators with `synthesisMode=reasoning_executor` and zero synthesis diagnostics.
- Candidate quality did not satisfy the existing qualitative-only instruction. Both iterations inserted source-backed amounts/percentages into `investment-thesis` and/or `monitoring-checklist`; the second, strengthened instruction did not prevent this. BYD thesis length grew from 1,498 baseline characters to 2,315 in iteration 2 and retained detailed product revenue figures; its concision score stays 2. Dongshan iteration 2 thesis was shorter (2,003 → 1,585 characters) and its operating-driver sequence is clearer, but it also inserted interim product figures; therefore it is not an acceptable P1 output. Candidate drafts remain isolated and untracked under `tmp/p1-goal-001-replay/real-calls/` with SHA-256 hashes recorded in the acceptance report.
- Provisional engineering reading scores (thesis / causal chain / counterevidence / monitoring / cross-section consistency / concision): BYD `3/3/3/3/3/2`; Dongshan `3/3/3/3/3/3`. Scores do not override the qualitative instruction or establish D2. No candidate is promoted to a Report.
- Stop rule: after two editorial iterations, the same output-contract breach remained. No third scheme or model call was made. Status is `PARTIAL_PRODUCT_QUALITY`, not `READY_FOR_CTO_ACCEPTANCE`.

## M5 — regression and boundary status

- Current focused assembly tests: 112/112 pass; `npm run typecheck`, `npm run client:typecheck`, and `npm run client:build` pass.
- Full Node and Client baselines remain the previously matched results: Node 3,284/3,305 with the same 21 failures reproduced on clean `main`; Client 223/228 with the same 5 reproduced on clean `main`. This turn changed only the existing synthesis instruction and its assertions; no client files changed. Full suites were not rerun after this prompt-only edit.
- Historical Report JSON, source archives, root checkout, Runtime configuration, and Knowledge were not changed by the replay. Browser E2E was not run. No output was persisted to runtime data.
- Acceptance record: `docs/engineering/reports/2026-10-29-p1-editorial-goal-acceptance.md`. PR #10 remains unmerged and will receive this partial result; main merge is not authorized.
