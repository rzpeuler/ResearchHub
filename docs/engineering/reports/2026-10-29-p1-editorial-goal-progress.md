# P1-GOAL-001 — 长程执行进度

**CURRENT_MILESTONE:** final BYD automatic synthesis loop complete; production retry and human review both reject the output
**BASELINE_SHA:** `6989b5f010d596e7436f1f4d49841ad8845ce64c`
**WORKTREE_BRANCH:** `codex/p1-editorial-synthesis`
**MODEL_CALLS_USED/MAX:** 12/12 P1 synthesis calls; 1 separate live Runtime connection probe
**BYD_SCORE_BEFORE/AFTER:** P0 3/3/3/3/3/2 → latest raw retry 3/4/4/4/2/3 (rejected; final assembly falls back)
**DONGSHAN_SCORE_BEFORE/AFTER:** 3/3/3/3/3/2 → 3/3/3/3/3/3 (provisional; candidate remains nonconforming)
**REGRESSION_DELTA:** no new failures versus clean-main matched failing tests; 21 Node and 5 Client full-suite failures persist on main
**BLOCKER:** automatic numeric grounding rejects the FY2025 basic-EPS misclassification of a `3.58元` dividend amount; retry leaves the unsupported price/EPS pair
**NEXT_STEP:** finish report/response-record commit and remote sync; do not spend more model calls or claim READY_FOR_CTO_ACCEPTANCE

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

## Continuation C0–C1 — runtime recheck and synthesis contract correction

- Continuation baseline: isolated branch `codex/p1-editorial-synthesis`, `HEAD=origin/codex/p1-editorial-synthesis=d0c40976fe80cf69971b0ce104a53d9b4ab80372`; PR #10 remains open against `main`. The root checkout's pre-existing dirty/untracked user files and the P1 worktree's prior untracked call drafts/cache are preserved.
- A fresh read-only Runtime connection test used the root-launched Runtime at `127.0.0.1:64897`: Bootstrap reported selected model `openai-codex/gpt-6-luna`; `POST /api/settings/model-test` returned HTTP 200 `{"ok":true}` in 2,735 ms. No login, model, or provider configuration was changed. OpenAI setup is not a blocker for the continuation.
- The continuation C0 protection snapshot covers 6,606 entries and has aggregate SHA-256 `506b3010004edab21743f708bd31f5fc3389188461df7ae03ccb0d0b081cffa9`. It includes Knowledge Base runtime data, the archived P0 evidence, and the root checkout's dirty/untracked files. The newly recorded count/hash is the C0 reference for this continuation and does not replace or reinterpret historical M0 fingerprints.
- C1 identified a direct conflict: the two synthesis sections were instructed to exclude all numeric facts, while the cross-method handoff required revenue amounts and shares to be integrated. The earlier M4 six-call comparison and its `PARTIAL_PRODUCT_QUALITY` result remain historical evidence; its candidates are not reclassified.
- Resolved the conflict in the existing Workflow synthesis instruction: keep qualitative explanation as the default; include a small, decision-relevant set of directly disclosed, source-verified values only when they materially explain the lead operating driver, strongest counterevidence, or exposure; retain metric, scope, period, unit, and exact locator. The revenue-driver method chapter retains the complete disclosed rows; the synthesis sections select evidence and must not recopy full tables, repeat values, or describe omitted disclosed facts as unavailable.
- The existing numeric grounding, exact-citation, rights/PIT, and blocked-ledger validators were not changed. Existing assembly contract tests now assert the conditional allowance and the method-chapter/synthesis distinction. Focused assembly validation passed: 112/112.
- C2 documentation and C3 real candidate calls remain in progress. The call budget remains capped at four additional actual synthesis calls; no Company Research Workflow, data acquisition, Report persistence, or Knowledge write has occurred.

## C1 conflict matrix, C3 real-call results, and C4 regression

### C1 conflict matrix

| Existing instruction | Conflict | Resolution in the existing synthesis contract | Retained gate |
| --- | --- | --- | --- |
| `P1_EDITORIAL_PRIORITY` previously prohibited all amounts, ratios, and dates in both synthesis sections. | Conflicted with directly sourced business facts being material to the thesis. | Replaced the absolute ban with a qualitative default and conditional selection of a few material, directly disclosed values with metric, scope, period, unit, and exact locator; no fixed numeric quota. | Numeric facts still pass existing source-bound grounding; unsupported amounts remain rejected. |
| Main synthesis instruction required all statements to be qualitative and excluded numbers, percentages, dates, and numeric product names. | Directly contradicted the allowed-evidence handoff and previous positive numeric-grounding tests. | Replaced the absolute clause with conditional permission; full method tables remain in their owning chapters and synthesis does not duplicate them. | 19-section report contract, citation allowlist, source rights/PIT and ledger state unchanged. |
| Cross-method text required the income-driver chapter to list every disclosed segment amount and share and required exact facts to be integrated into the relevant conclusion. | Could be read as requiring full table reproduction in the short investment thesis and monitoring list. | Method chapters preserve all complete rows; synthesis chooses the material subset and cannot call omitted disclosed facts unavailable. | Existing fact-completeness tests and exact row context remain active. |
| Valuation rule forbids copying numeric inputs or upgrading historical PE to a target price. | This is an eligibility restriction, not a general numeric ban; this task has no verified valuation inputs. | Preserved. A small selected numeric fact does not authorize a blocked valuation claim. Observation dates are now labeled separately from financial report periods. | Blocked valuation/scenario entries remain blocked; historical price PIT remains intact. |
| Exact citation, numerical grounding, rights, PIT, and blocked-ledger checks. | No conflict with conditional numeric permission. | No validator logic changed. | Existing positive exact-row and negative wrong/unsupported-value tests remain in force. |

The existing assembly test now verifies the conditional contract while the existing fixture exercises allow a grounded automotive share and reject a wrong 6.04% margin where the supplied report says 5.04%; the separate unsupported `9999` test still fails closed. No new numeric audit subsystem or new quality gate was added.

### C3 archived-input verification and bounded synthesis calls

All four new calls used `openai-codex/gpt-6-luna`. For each company the exact `request.input` hash, `asOf`, 10 methods, source snapshot hash, and all allowed locators matched the original M4 handoff: BYD `76d6e52dd6d0a6a25d016d24a0adba6b99c22c4b6c59f25d34466d26ad631158`, `2026-10-27T20:19:59.628Z`, 304 evidence/citations, source snapshot `e341f61ea5a3d43be05e3b10e1e2d3597cf5d60e716847194c4514e5603fe2bd`; Dongshan `1fc05ffcece4e7b416d2fff4e9d24067a241b72959fb1d8a34a3bd47443aa8e0`, `2026-10-27T20:26:46.347Z`, 372 evidence/citations, source snapshot `42b23c9e4f0be94534e42eeae1504ba42433ff153d58bfa4a2bd23c4f215b0c9`. Each input had 3 workflow-owned sections and no source/evidence additions. Mock-only preflight independently reproduced the input and source hashes.

| Company / call | Effective instruction SHA-256 | Wall time | Assembly result | Output record SHA-256 | Assessment |
| --- | --- | ---: | --- | --- | --- |
| BYD candidate 1 | `4f37f0fa44cf4f91b5e2449c24b8fb60da205122a74485fd790162e4953a10fc` | 28.087 s | `reasoning_executor`, 0 diagnostics | `8588dbcac91b396cb7e536a366a5b22d6349dd51cadfcd887795fe6c268151c8` | Reject: thesis calls the 2026-10-27 market observation a “2025 year-end” reference. The source distinguishes the October 2026 quote date from FY2025 EPS. |
| BYD candidate 2 | `5da08f1b486a03e416f72330642dab9ecd9edd4a8aa7e427cb8760d6ac2d09ec` | 25.305 s | `deterministic_fallback`, `NUMERIC_GROUNDING_ERROR:7.13` | `572c1a7ce2b2e2d8e614486e423e3ca84ec2170783572cf76273a0076083860d` | Reject: date is corrected, but an unqualified cross-sentence revenue comparison fails the unchanged numeric validator. No bypass or manual acceptance. |
| Dongshan candidate 1 | `840c08dd8368d2f266e0b6adfe12c191d385cb70f820cba4b5fe80da479a7b14` | 35.943 s | `deterministic_fallback`, `NUMERIC_GROUNDING_ERROR:101.09元` | `fea4e93b6fee5f77d541cf8ecf1952b22cdc05f9193c5e83f4ff1e4a4f4d6ca1` | Reject: numeric market-price input was included although valuation remained unverified/blocked. |
| Dongshan candidate 2 | `5f73735504da5724baccf180fe17c9ad817cb86f9061491bfb6fb3c645cc6efe` | 19.140 s | `reasoning_executor`, 0 diagnostics | `df71ced090092f6e561d0cd3265b15e7cd44c338387c60f74c7170910bbd352c` | Candidate passes assembly; numeric valuation inputs remain omitted while disclosed operating facts and numbers are retained. |

The added calls total four (cumulative actual synthesis calls: 10/12). The model test is a separate connection probe and not a synthesis call. The executor exposed no token or cost accounting. No full Workflow, acquisition, Report persistence, or Knowledge write occurred.

### C3 product review

- **Dongshan Precision — provisional 6-dimension score:** `4/4/4/4/4/3` (thesis, causal chain, counterevidence/failure conditions, monitoring, cross-section consistency, concision). Relative to baseline, the accepted draft (a) replaces a long FY2025 five-product revenue list with the decisive 2026 H1 EML commercialization stages and a caveat separating disclosed precision-component growth from GMD consolidation/capacity commissioning; (b) moves customer concentration and the cash-flow/capex mismatch into the strongest counterevidence; and (c) turns monitoring into distinct, periodic measures for EML stage, customers, working capital, operating cash, and capex. Exact support includes `official-296fff2b2889c26f@paragraph:359-362`, `official-296fff2b2889c26f@paragraph:775`, `official-39e591fa149e4543@paragraph:933`, `official-39e591fa149e4543@paragraph:965,969-970`, and `akshare-financial-002384@paragraph:1`. These are editorial improvements, not new company conclusions.
- **BYD — no accepted candidate:** the first output has clearer lead-driver/contra-evidence ordering and selects the 2025 automotive share (`official-f7c8d23d2829a5e8@paragraph:821`), but its observation-period error is disqualifying. The second output correctly separates `observationDate=2026-10-27` from FY2025 EPS but is rejected by the existing numeric validator. Therefore D2 (three accepted improvements for each company) is **not met**; do not extrapolate Dongshan's pass to BYD.
- Original M0–M4 scores, failures, candidate files, and reports remain preserved. C3 candidates are untracked in `tmp/p1-goal-001-replay/continuation-calls/`; none is a persisted Report or a new investment recommendation.

### C4 regression

- Focused Company Research assembly, semantic quality, valuation, content-quality, repair-loop and PIT tests: **358/358 pass**.
- `npm run typecheck`: **exit 0**; `npm run client:typecheck`: **exit 0**; `npm run client:build`: **exit 0** (existing 744 kB minified chunk warning).
- `npm run test:node`: **exit 1**, 3,284/3,305 pass; the 21 failures match the previously recorded clean-main set across `research-skill-architecture.test.ts`, `theme-workspace-projection.test.ts`, `competition-module-gateway.test.ts`, `codex-module-remaining-schema-deltas.test.ts`, and `codex-production-industry-schema-compatibility.test.ts`. No new failure title appeared.
- `npm run client:test`: **exit 1**, 223/228 pass; the same five known failures remain (three `App.test.tsx`, two `report-navigation.test.tsx`).
- Full Node regression modified five tracked validation evidence JSONs; each was restored to the clean P1 worktree baseline after the run. No other tracked test artifacts are retained. The full logs and model output drafts remain untracked under `tmp/` and excluded from staging.
- Historical Company Research remains `17/19 BLOCKED`; `bull-base-bear` and `variant-perception` remain unqualified; P0-19 remains `NOT_ACCEPTED`. No change to Knowledge or Report persistence.

### Protected C0 snapshot recheck

The post-test comparison rehashed all 6,606 paths from the continuation C0 manifest: 6,606 present, 0 missing, 0 changed. This includes all captured Knowledge Base files, the P0 archive, and root dirty/untracked user files. Root checkout remains on `codex/company-research-p0-01-06` at `f167a8f272e9b1faf8615a74093047091a194cf1`; its three app edits, five validation evidence edits, runtime logs, `tmp/`, and parser cache remain untouched.

### C4 six-dimension editorial comparison

These scores compare the archived baseline with the best continuation output for each company. A score cannot override factual/PIT or numeric-validator vetoes. Positions are the two final synthesis sections; cited excerpts retain their exact source locators.

**BYD 002594 — best raw candidate 1, rejected.** Thesis length expands from 1,498 to 3,218 characters; monitoring is 2,281 → 2,154. Candidate 2 corrects its date error but falls back on numeric grounding, so it does not replace this row as an accepted draft.

| Dimension | Baseline excerpt / position | Best candidate excerpt / position | Score and reason |
| --- | --- | --- | --- |
| Thesis clarity | `investment-thesis` opens “技术与制造积累支撑汽车、电池、电子等多业务及整车智能化、全球化布局”， then states cash/capital returns are unverified. | `investment-thesis` leads with “以汽车为主要收入引擎”， and identifies growth realization/profit resilience as the current decision. The automotive share is grounded at `official-f7c8d23d2829a5e8@paragraph:821`. | `3→4`: the lead variable is clearer. The incorrect market-period label still vetoes acceptance. |
| Causal chain | `investment-thesis` places technology, automotive, overseas, and computing projects together before its failure conditions. | `investment-thesis` links 80.68% automotive-category share to automotive dependence, then asks whether electronics/new business can offset the disclosed 2026 H1 decline (`official-c19c34dd239b2e9c@paragraph:706-708`). | `3→4`: revenue exposure, offset, and failure condition are more explicit. |
| Counterevidence | Baseline says H1 revenue, operating profit, and structured net profit fell; OCF increased; balances are a cross-basis screen. | Candidate quantifies revenue and operating-profit declines alongside OCF increase and gross-margin movement, citing `akshare-financial-002594@paragraph:1`. | `3→4`: evidence is more decision-relevant, although some figure placement is dense. |
| Monitoring | Baseline has nine checks, including separate customer, receivable, inventory, capex, and new-business rows. | Candidate retains nine items, adds a distinct consolidated profit/operating result check, and keeps customer concentration, working capital, server/liquid cooling, and asset-group checks with source locators. | `3→3`: useful continuity, but no material enough improvement over the already broad baseline. |
| Cross-section consistency | Baseline refers to the observed close against annual EPS as a historical multiple and says it is not a target price (`company-valuation-market-002594-2026-10-27@paragraph:1`). | Candidate 1 calls the same reference “2025年末” although the quote source is dated 2026-10-27; the later correction was rejected by the numeric validator. | `3→2`: the output introduces an observation-date/report-period mismatch, a veto condition. |
| Concision | Baseline thesis is 1,498 characters; checklist is 2,281. | Candidate 1 thesis is 3,218 characters and adds multiple product/financial details; checklist is 2,154. | `2→1`: the thesis grows substantially despite a small checklist reduction. |

**Dongshan Precision 002384 — accepted assembly candidate 2.** Thesis length is 2,003 → 1,949 characters; monitoring is 1,923 → 1,501. It passed existing assembly validation with zero diagnostics; no blocked valuation inputs were promoted.

| Dimension | Baseline excerpt / position | Accepted candidate excerpt / position | Score and reason |
| --- | --- | --- | --- |
| Thesis clarity | `investment-thesis` describes manufacturing, M&A, PCB, modules, and chips as a broad opportunity, then lists five FY2025 product revenue rows. | Opens “通过并购与扩产向AI数据基础设施的高端PCB、光模块及光芯片延伸”， but frames it as a transition whose returns remain unverified. | `3→4`: the operating thesis and its uncertainty are stated at the top; the distracting full annual product list is removed from the summary. |
| Causal chain | Baseline names EML application/production progress, PCB expansion, and acquisitions but does not order them into one current commercial chain. | `investment-thesis` states 100G PAM4 EML module use and 200G mass-production stage before separating the 400G development stage (`official-296fff2b2889c26f@paragraph:359-362`). | `3→4`: disclosed product maturity becomes the lead evidence, with upgrade opportunity distinguished from current delivery. |
| Counterevidence | Baseline identifies customer concentration and cash conversion qualitatively, with no specific product cost/revenue comparison in the thesis. | Candidate states FY2025 precision-component revenue growth +30.61%, cost growth +38.36%, and original-table margin change −5.08%; it also preserves customer concentration and caveats GMD consolidation/commissioning effects (`official-39e591fa149e4543@paragraph:885-891,933,965,969-970`). | `3→4`: a quantified operating disconfirmer and customer exposure now qualify the growth thesis. |
| Monitoring | Baseline begins with customer concentration, then separate AR, inventory, cash, capex, competition, goodwill, and valuation items, with some broad triggers. | Candidate uses distinct checks for customers, AR/income cross-basis spread (with formula), OCF, capex, product margin, EML stage, competitor disclosure, and goodwill assumptions (`akshare-financial-002384@paragraph:1`; `official-296fff2b2889c26f@paragraph:360-362`). | `3→4`: each check names a measurable or repeatable disclosure and the causal claim it tests; no invented threshold is added. |
| Cross-section consistency | Baseline already keeps the estimate caveat qualitative but repeats the lengthy FY2025 product table in the thesis. | Candidate flags GMD consolidation and plant commissioning as a non-organic component, carries cash/capex into failure conditions, and keeps blocked valuation qualitative. | `3→4`: the selected facts align across thesis, monitoring, and the existing blocked valuation boundary. |
| Concision | Baseline thesis/checklist are 2,003/1,923 characters. | Candidate thesis/checklist are 1,949/1,501 characters. | `2→3`: it removes the full product list from thesis and trims duplicated monitoring while retaining material evidence. |

Scores are editorial review judgments, not investment conclusions. Dongshan meets the three-improvement count; BYD does not have a factually and numerically accepted candidate, so the two-company P1 goal remains partial.

## C3 BYD post-call review and final acceptance status

The raw second BYD model response remains preserved and its original `deterministic_fallback` / `NUMERIC_GROUNDING_ERROR:7.13` is not overwritten. Manual redline review found that the model had compressed two separately disclosed values into “两者分别” and cited only the structured AKShare object. The reviewer split the claim into an operating-profit statement (retaining its source citation) and an operating-revenue statement, adding the unique, already-allowed official half-year row `official-c19c34dd239b2e9c@paragraph:698`. No numeric value changed, no source was added, and the existing grounding validator was not bypassed.

A deterministic replay of the same archived `request.input` through the existing full `assembleCompanyResearch` validation path then returned `reasoning_executor` with **0 diagnostics**. This was a local stub replay of the archived response, not another model call, Workflow run, Report write, or Knowledge operation. The reviewed two-section output is retained at `tmp/p1-goal-001-replay/continuation-calls/002594-reviewed-candidate-r2.json`, SHA-256 `8062dbb8e9bfe842505b7898b8e492083e1b30ec15f5e8c1a5a17472a4c8c075`. It records the original model-response record hash `572c1a7ce2b2e2d8e614486e423e3ca84ec2170783572cf76273a0076083860d`, the unchanged BYD input hash, and the explicit single reviewer edit.

**BYD reviewed candidate score:** `4/4/4/4/4/3` (thesis, causal chain, counterevidence/failure conditions, monitoring, consistency, concision). Compared with baseline, the reviewed thesis leads with the automotive revenue share and the split between automotive decline and electronics growth (`official-f7c8d23d2829a5e8@paragraph:821`; `official-c19c34dd239b2e9c@paragraph:706-708`); it gives the H1 profit/revenue/cash-flow counterevidence and keeps the net-profit attribution caveat (`akshare-financial-002594@paragraph:1`; revenue decline also directly cited to `official-c19c34dd239b2e9c@paragraph:698`); and its monitoring checks are reordered around these thesis drivers with distinct customer, working-capital, cash/capex and commercialization checks. The two sections total 3,627 characters versus baseline 3,779; monitoring shrinks 2,281 → 1,490 characters while retaining decision-relevant figures.

Together with Dongshan candidate 2's earlier `4/4/4/4/4/3` score and three cited material improvements, both companies now meet the minimum reviewed-output threshold. The manual correction is explicitly disclosed; the prior failed raw model response remains in the history. The final status is **`READY_FOR_CTO_ACCEPTANCE`**. This is editorial acceptance only: `17/19 BLOCKED`, the two blocked sections, P0-19 `NOT_ACCEPTED`, and Knowledge eligibility are unchanged. PR #10 remains open and unmerged.

## Final automatic closure status (2026-10-29)

The subsequent no-human-edit BYD closed-loop acceptance supersedes that readiness status. Two actual `openai-codex/gpt-6-luna` calls exhausted the 12-call budget. The production assembly retry was exercised using the exact first real response and then a real Pi retry; it still returned `deterministic_fallback` because the second model response incorrectly treated a `3.58元` dividend-per-10-shares disclosure as FY2025 basic EPS. The resulting `82.01元` / `3.58元` valuation input pair failed the existing numeric grounding gate. There was no model success or acceptable final synthesis.

The current outcome is **`PARTIAL_PRODUCT_QUALITY`**. D2 and D3 are not met; D4 review found a material factual classification error. See the final closure section of [the acceptance report](2026-10-29-p1-editorial-goal-acceptance.md) and its byte-exact [real retry response](2026-10-29-p1-byd-auto-loop-final-response.txt). Validation: assembly suite 112/112, `npm run typecheck` exit 0. Historical `17/19 BLOCKED`, blocked `bull-base-bear` / `variant-perception`, P0-19 `NOT_ACCEPTED`, and Knowledge state are unchanged.

## P1-EVIDENCE-QUAL-001 progress and historical evidence correction (append-only)

The preserved second BYD response cites FY2025 basic EPS paragraph `official-f7c8d23d2829a5e8@paragraph:231`. The 3.58 dividend is separately disclosed as RMB 3.58 per 10 shares at paragraphs 43/98; numeric-grounding repair candidates mentioning those rows are not proof that the model cited them. The earlier interpretation is corrected in the appended section of the P1 acceptance report, without altering prior text or raw response bytes.

Gate A confirmed that the archived market quote was retrieved after the recorded `asOf`, and the archive contains no `observationAvailableAt` or immutable quote version proof. Current valuation-to-synthesis ledger eligibility can nevertheless be inferred from Markdown markers plus resolvable citations. The new report `2026-10-29-p1-evidence-qual-001.md` records the field-level trace and uncertainties. `P1-GOAL-001` remains `PARTIAL_PRODUCT_QUALITY / NOT_ACCEPTED`; no product acceptance is claimed.

## P1-EVIDENCE-QUAL-001 implementation and regression addendum (append-only)

Implemented a fail-closed synthesis handoff for market PIT/value-version evidence and exact annual basic EPS rows, blocked an ordinary-method bypass, removed synthetic public-rights claims, and added a two-attempt deterministic-fallback test for invalid model candidates. Focused assembly is **115/115** and valuation qualification is **24/24**; `npm run typecheck`, `npm run client:typecheck`, and `npm run client:build` pass. Full client remains **223/228** with the same five baseline failures. Full Node is **3,288/3,309**, preserving the same 21 baseline failure titles and adding no new failures. The test runner's generated validation JSON modifications were restored.

Gate D did not make a real synthesis call or accept product quality. The archived BYD quote remains disqualified because its retrieval is later than `asOf` and the archive lacks immutable value-version and original rights proof. The 19-section/P0-19 state, source archive, Knowledge, and root checkout remain unchanged. Status is `READY_FOR_CODE_REVIEW / P1_PRODUCT_NOT_ACCEPTED`; see `2026-10-29-p1-evidence-qual-001.md` for the full audit, residual limits, baseline deltas, and protected-set hashes.
