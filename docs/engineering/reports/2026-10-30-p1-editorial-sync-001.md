# P1 Editorial Sync 001 — PR #10 与已验收 main 同步

**TASK:** `P1-EDITORIAL-SYNC-001`
**STATUS:** `READY_FOR_CTO_REVIEW`
**P1_GOAL_STATUS:** `PARTIAL_PRODUCT_QUALITY / NOT_ACCEPTED`
**MODEL_CALLS_THIS_TASK:** `0`
**PRODUCTION_AUTHORIZATION:** `UNKNOWN`

## 交付标识

```text
BASELINE_SHA=7eeb2e09bdbcd68ba60ea87d5e1a37550a4ba0d2
P1_FROZEN_SHA=8956f0a511f3f2fa0eaa075ee16a0371515959a1
MERGE_CANDIDATE_SHA=f1df4c1df1bf2886f1aaffe1f538839b36432c11
PR10_HEAD_BEFORE=8956f0a511f3f2fa0eaa075ee16a0371515959a1
PR10_HEAD_AFTER_SYNC_MERGE=f1df4c1df1bf2886f1aaffe1f538839b36432c11 (report-only delivery commit follows)
MERGE_STRATEGY=ordinary merge --no-ff; no rebase, cherry-pick, or force push
```

PR #10 was OPEN against `main`, branch `codex/p1-editorial-synthesis`, at the frozen SHA before candidate delivery. No new PR was created. This report does not claim CTO product acceptance.

## S0 — 合并后 main 基线

Clean isolated main worktree: `C:\Users\Administrator\AppData\Local\Temp\rh-p1-editorial-sync-001-main`, HEAD `7eeb2e09bdbcd68ba60ea87d5e1a37550a4ba0d2`.

| Command | Result | Evidence |
| --- | --- | --- |
| `node --import tsx --test tests/workflows/company-research-assembly.test.ts tests/workflows/company-valuation-sections.test.ts tests/workflows/company-valuation-evidence-integration.test.ts` | 150/150 pass, 0 fail, exit 0 | `s0-main-focused.log`, SHA-256 `0cfee6a8831a6e4cddfe2397060431597dea421522f17f401b99a452d9c5b9b1` |
| `npm run test:node` | 3,299 pass / 21 fail of 3,320, exit 1 | `s0-main-node.log`, SHA-256 `2a50ed289e41be06fb0f37279d9152e36fd9db5b4da71f612f5782539b5daa9b` |
| `npm run client:test` | 223 pass / 5 fail of 228, exit 1 | `s0-main-client.log`, SHA-256 `5c36d3c90c5463cd8c681a4485fad6e12583db45f1f136e5e1b0380847dd45da` |

The full-suite failures below are the observed clean-main baseline, not suppressed results.

## S1–S2 — 合并与差异审计

The candidate began at the frozen PR #10 SHA and merged `origin/main` using an ordinary, no-ff merge. Both the frozen SHA and `origin/main` are ancestors of the merge commit; there are no unresolved conflict stages. Before this S5 report, the candidate-relative-to-main delta contained six retained P1 historical reports plus only these two code paths. This new report adds one report-only file; after delivery the complete delta is seven P1 reports plus the same two code paths:

| File | Main-to-P1 semantic hunk retained |
| --- | --- |
| `workflows/company-deep-research/assembly.ts` | Adds the existing `P1_EDITORIAL_PRIORITY` prose and prefixes it to `company_research_synthesis` instruction. The Editorial hierarchy is core judgment → decisive operating driver → strongest evidence/counterevidence → failure condition; it also preserves the existing no-numeric-detail constraint and exact evidence requirements. |
| `tests/workflows/company-research-assembly.test.ts` | Adds two assertions in the existing prompt regression for the Editorial priority and same-metric/same-observation merge rule. No new reviewer, skill, workflow, source contract, or product layer. |

The following files match `origin/main` byte-for-byte in the candidate: `workflows/company-deep-research/valuation-sections.ts`, `workflows/company-deep-research/workflow.ts`, `tests/workflows/company-valuation-sections.test.ts`, and `tests/workflows/company-valuation-evidence-integration.test.ts`. The main safety report `2026-10-30-p1-safe-extract-001.md` is included from main without edits. All six PR #10 historical reports are byte-identical to the frozen branch.

| Main safety invariant | Verification evidence |
| --- | --- |
| Quote PIT, retrieval/cutoff, immutable version proof, and rights qualification remain fail-closed | Candidate valuation implementation and integration test are byte-identical to main; INT-01–08 pass in the focused suite. INT-07 remains `NOT_EXECUTABLE_WITH_CURRENT_CONTRACT`. |
| A self-asserted version ID/status/hash does not prove source-bound immutable data | Focused negatives pass for forged early seals, self-asserted verified IDs, hash-only proof, raw-envelope mismatch, and quote retrieval before exchange-close availability. |
| Positive reference PE requires a qualified quote and unique same-fiscal-year basic-EPS row | Focused positives and negatives pass, including correct EPS under wrong fiscal year, dividend-vs-EPS, no-market PE behind a disclaimer, explicit missing-market gap, and qualified ledger PE. |
| Final synthesis cannot use a disclaimer to hide affirmative PE | The real assembly retry regression rejects both saved attempts without a qualified valuation ledger; fallback retains the 19-section contract. |

## S3 — 冻结研究档案与离线恢复边界

Both archived P0 reports remain read-only and have 19 sections in the same stable order, ten complete methods, `researchQuality.passed=false`, `status=incomplete`, and `17/19` core coverage. `bull-base-bear` remains blocked (`RESEARCH_GAP`, `NO_ATTRIBUTABLE_EVIDENCE`, `WORKFLOW_SECTION_NO_LOCATED_EVIDENCE`); `variant-perception` remains blocked (`RESEARCH_GAP`, `VARIANT_EXPECTATION_VALUE_VERSION_UNVERIFIED`).

### Frozen archive identities and allowed evidence

| Company | Run | `asOf` | Source snapshot |
| --- | --- | --- | --- |
| BYD 002594 | `82bcc425-d48d-4e55-bc45-111aa8c28ba4` | `2026-10-27T20:19:59.628Z` | 42 candidate/hash pairs; aggregate SHA-256 `e341f61ea5a3d43be05e3b10e1e2d3597cf5d60e716847194c4514e5603fe2bd`; nine allowed source IDs below |
| Dongshan Precision 002384 | `860916a8-4958-4d29-8da1-56ad5dd1c2c6` | `2026-10-27T20:26:46.347Z` | 25 candidate/hash pairs; aggregate SHA-256 `42b23c9e4f0be94534e42eeae1504ba42433ff153d58bfa4a2bd23c4f215b0c9`; six allowed source IDs below |

| Company | Allowed source ID | Archived content SHA-256 |
| --- | --- | --- |
| BYD | `akshare-financial-002594` | `e53f57b48168e99af65db0583011b230157a4c4c23968671111581f114f3b3d8` |
| BYD | `company-valuation-market-002594-2026-10-27` | `f77c6e4c32206b95dae058b076c2ec542254f4a30d49395324b3aa0e356f89ba` |
| BYD | `official-c19c34dd239b2e9c` | `c521306221e896b4cbfbdf18a84d18fadf409db5bea7a8d3ef70a08c4f366ca6` |
| BYD | `official-f6274e510499a654` | `a805c2253568d51c6e10928a596cbc6473521d18c2856909c11c88ffbceb5717` |
| BYD | `official-f7c8d23d2829a5e8` | `51b0acae9aca05f698070fa41027809b86b425bb93d31a509005b192c78ee5a0` |
| BYD | `public-web-1af89c8cc881a0b2` | `c6d1b897b1f6890adf72dd183713312bf5f06d479d91055f093a1079d4811083` |
| BYD | `public-web-5d5c2c25e92e9b4a` | `3e1428eb1759378dea6b329ede6cb71816cdd0e18230f004bc848ba973c55146` |
| BYD | `public-web-650c2046590f913d` | `a9509a115ea32f468073657f0fd1f645948d52234052366d3f93b5b50df3f405` |
| BYD | `public-web-b40b26fb21f952ce` | `bc4f55b1ca0dc708e37de0c8c53a9ed78cc722c05f6461248ed01ffae23ebc67` |
| Dongshan | `akshare-financial-002384` | `5696f40e6295a5e5f9500ac52543562171bc80c90490bb448ede4b8371f5c230` |
| Dongshan | `company-valuation-market-002384-2026-10-27` | `02343a12044283eb13e414f947d4dc86678d989c62e0504a8c8e2a5f86f25b0c` |
| Dongshan | `official-135019c30466a0c8` | `a350bd321a13088e5e418cb4d472607c727f1d3a9c396f6e882d002fc452a2b8` |
| Dongshan | `official-296fff2b2889c26f` | `6500c4e7c05ab455ebbbfc5eba1fa7ede7a48d6be171c53c4edc87c4682f707a` |
| Dongshan | `official-39e591fa149e4543` | `8009fc94cc5a754b4cf5c18132217ce704c216484c2922d74d92f7f008ba3330` |
| Dongshan | `public-web-2e4e8f90fb9e55d6` | `2f75294be7dd9e226202b087758b83364fee4fa08e6d9225fd7582ff44f41835` |

No new sources or current research data were acquired. The archived BYD quote `82.01` was retrieved at `2026-10-27T20:20:02.952Z`, 3.324 seconds after its archived `asOf`; it is not historically qualified. The FY2025 basic EPS `3.58` is the actual annual-report EPS row at `official-f7c8d23d2829a5e8@paragraph:231`. Equal-value dividend rows at paragraphs 43/98/1115 are diagnostic alternatives, not the model's cited EPS row.

### Saved model artifacts and prior product review

| Company | Saved model-output artifact(s) | Prior automatic / human-review result |
| --- | --- | --- |
| BYD | Complete two-exchange archive `tmp/p1-goal-001-replay/auto-loop-final/002594-real-auto-loop-complete.json`, SHA-256 `4efcb4c28d26afad763b8c8725370f803fa355729a825d0dbaa17b848c61ae2b`; 1,863,119 bytes. Attempt request/response wrapper hashes: `b8572394bc15092276821a571ea443fab66520cef4b2b8e1d21a3d19a1555f7c` / `53388e19dea966ddaeedb3a4e341434934e0bd1b99145e0761c193ae306024b0`, then `2ec1a816ac318cff5d046f215941ea112e70ab6074bae18e8c39a2085d4f90f8` / `8c4e8f845b2aa485a3bf738b88234220856d8a4c57a192df2d9036ac30f76667`. | Two authentic historical calls failed numeric grounding: first rejected `82.01`, `3.58`, and `22.91`; retry removed `22.91` but retained the unsupported price/EPS pairing and was rejected. Automatic repair found no exact semantically valid replacement and changed no claim. Final automatic output: `deterministic_fallback`, two research-gap placeholders. Read-only review rejects historical PE because the quote is late; no accepted model-generated synthesis exists. |
| Dongshan | Six saved raw call outputs: baseline `63f059e7a255ba8441caa5aef9b839dc4be172cf6f51e5281f38b62b74a8f412`; candidate `fc4d4221803318058187a17b9e0a16f28291bc69faabe38e330126d87847424f`; candidate-r2 `e9d05e8db97068aa17618b712d175365b726ea58fe42a8ef55dd9ce9e7ebbfcc`; BYD companion outputs remain recorded in the historical P1 report. | The saved candidate-r2 passed existing assembly validation with zero diagnostics and did not promote blocked valuation inputs. Read-only redline found the qualitative-only requirement was violated by numeric detail; provisional score `4/4/4/4/4/3` is not product acceptance. A complete Dongshan raw request/response exchange archive is absent, so no offline replay is claimed. |

The historical output files are `tmp/p1-goal-001-replay/real-calls/*.json` and the tracked byte-exact BYD final response copy `docs/engineering/reports/2026-10-29-p1-byd-auto-loop-final-response.txt` (SHA-256 `fb7de6a273dbabe5e19481c105ba984f6cc6a4ae80f21cb52dd0b3e80a6b274e`). Historical quality records distinguish manual redline from model output; no human edits were applied to any replay response or candidate in this task.

### BYD offline replay under merged main safety code

The saved BYD archive hash was rechecked before replay. Its two saved `ReasoningResult` objects were returned unchanged by a deterministic local executor through the current `assembleCompanyResearch`, with no Pi/model/network access. Both saved response hashes remained unchanged. The result retained all 19 report sections and returned `deterministic_fallback` after two attempts; both attempts were rejected at the new evidence locator boundary (`REFERENCE_ERROR: final synthesis locator unavailable`). This is an offline safety replay, not new model output, not a full acquisition-event replay, and not a product-quality pass.

The source snapshot does not contain normalized retrieval timestamps or rights fields; the replay did not invent either. Compared with the archived request, current `instruction`, `allowedCitations`, and `allowedEvidence` hashes differ; `preparedAnalysis` and `outputContract` hashes match. Historical request/response pair hashes and the raw archive hash above are unchanged. Consequently, the old real output is not claimed to have been generated from byte-identical new-main inputs.

## S4 — 候选验证

Candidate worktree: `C:\Users\Administrator\AppData\Local\Temp\rh-p1-editorial-sync-001-candidate`.

| Command | Result | Evidence |
| --- | --- | --- |
| Focused three-suite Node command from S0 | 150/150 pass, 0 fail, exit 0 | `s4-candidate-focused.log`, SHA-256 `f08e46568074568dfc6542edc8a293a383971aa0af3fd586463a5a802c108e40` |
| `npm run typecheck` | PASS, exit 0 | `s4-candidate-typecheck.log`, SHA-256 `e5046545a3a9fcc0cf6950c9402c78a2b227f07a6a658d2a0c1fbc5f4a194da0` |
| `npm run client:typecheck` | PASS, exit 0 | `s4-candidate-client-typecheck.log`, SHA-256 `eb57b2c01c9900bab000b136214da05438159cd3a3917bb35f0629e5d81d331e` |
| `npm run client:build -- --configLoader runner` | PASS, exit 0; existing >500 kB chunk warning | `s4-candidate-client-build.log`, SHA-256 `fb2ea180dc2e61565e459cbf9511555bd4ab2fe1265c2d37f11a1331f6b623e8` |
| `npm run test:node` | 3,299 pass / 21 fail of 3,320, exit 1 | `s4-candidate-node-full.log`, SHA-256 `62b51a58462880a6242aa1ca37316099274e9790fb0fac542a45bd7eb3b03891` |
| `npm run client:test -- --configLoader runner` | 223 pass / 5 fail of 228, exit 1 | `s4-candidate-client-full.log`, SHA-256 `0c2553ea70a1a76bd55de2f917db391e015c3d5ab35b073b34f648d9b173fb69` |
| `git diff --cached --check` and post-report `git diff --check` | PASS | no whitespace errors |

The client commands used Vite's supported `runner` config loader so config evaluation did not create temp files through the candidate's existing `node_modules` junction into the root checkout. The full-suite failure identity sets exactly match the S0 clean-main baseline: 21/21 Node failures and 5/5 Client failures; no added or removed failure title.

### Complete known full-suite failure identities

**Node baseline and candidate (same 21):**

1. Workflow metadata composes canonical peers without registering composite Skill IDs
2. Theme graph includes only human-confirmed scope refs, preserves direction, and never expands global edges
3. Industry projection returns bounded facts, deterministic core views, publication-labeled dates, future catalysts and competition units
4. semantic section classification receives only readable facts and cannot block the base projection
5. current restricted or expired source rights suppress company exposures and dependent competition data
6. company projection is readable through a canonical business exposure without adding a company graph node
7. stale expected revision and a corrupt scope ledger fail closed
8. Gateway creates a competition Module and maps its local proposal ID
9. Gateway blocks numeric Module cells that disagree with their canonical facts
10. same Industry table replays idempotently with the same canonical Module ref
11. evidence-backed cell update commits, and an unavailable update preserves the prior usable value
12. same Claim may support a canonical numeric display update after new provenance is admitted
13. Module blocks the whole submit when a cell reference cannot resolve
14. ChangeSet validation rejects denied or missing Raw evidence listed by a competition Module
15. Module blocks when the row Source payload is unusable
16. Module blocks unusable Source evidence inherited from an existing business_exposure Relation
17. new Claim provenance alone cannot justify a contradictory same-reference display value
18. Writer rejection does not report success or overwrite the prior Module
19. different rows may retain different currencies and a changed column schema blocks for review
20. composition is source-immutable, deterministic and idempotent
21. FIX-015 offline evidence inputs preserve authoritative contracts and expected source sizes

**Client baseline and candidate (same 5):**

1. `src/App.test.tsx > Homepage shell > searches and filters server conversation titles and refreshes server-authoritative rename/archive state`
2. `src/App.test.tsx > Homepage shell > keeps rename open after a version conflict and retries with the refreshed version`
3. `src/App.test.tsx > Homepage shell > moves archived conversations into the archive view and restores them to active history`
4. `src/app/report-navigation.test.tsx > Report navigation and original conversation artifacts > opens a no-report bundle from its durable original conversation Activity`
5. `src/app/report-navigation.test.tsx > Report navigation and original conversation artifacts > rejects another run returned to a conversation artifact request`

## 保护范围与清理

The before/after manifest comparison is unchanged for every protected target:

| Protected target | Before / after evidence |
| --- | --- |
| Root user checkout | Same HEAD `f167a8f272e9b1faf8615a74093047091a194cf1`; 39 dirty/untracked entries and identical aggregate manifest SHA-256 `0c7481a2a0d3b97141c5cfe8ef3cf2b08223729bd340274313036f389c4a5a5d` |
| P0 Company Research archive | 4,350 files, 2,220,012,397 bytes; unchanged aggregate SHA-256 `78968b312fe77a49fd7180f53a123524933f2de816f84c5c4c7d8fe1ca7ed505` |
| User Knowledge Bases | 6,552 files, 56,276,441 bytes; unchanged aggregate SHA-256 `57d0842d32d359b812d578ef945256b260d8b912920d9cb1177a5faad2db332d` |
| Original P1 worktree | Same HEAD `8956f0a511f3f2fa0eaa075ee16a0371515959a1`; 27 dirty/untracked entries, identical aggregate SHA-256 `8cd4ab273a7a2f5688410b6a5241e0cb7732be8cd9f22a4f9d87144455b24392` |
| Original P1 `tmp/` | 26 files, 3,412,460 bytes; unchanged aggregate SHA-256 `af875684146e76079a97f195cb37c4bc97046b9c04658db0edeffd6f28f64530` |

The PR #11 safety-fix worktree/branch is absent from `git worktree list`, local branches, and its known task-specific paths; nothing was deleted. The candidate worktree remains available for CTO review. Its tests generated an untracked Python `__pycache__/docling_bridge.cpython-312.pyc`; it is not staged or committed. Removal was blocked by the desktop command policy, so the candidate worktree is intentionally retained rather than risking broader cleanup. No root worktree or protected archive was removed or rewritten.

## Product readiness and next acceptance

- **D1:** archived baseline and exact identities retained — PASS.
- **D2:** three accepted, traceable, compliant improvements per company — NOT MET; BYD has no accepted automatic candidate and Dongshan candidate-r2 violates the qualitative-only constraint.
- **D3:** six-dimension score threshold — PARTIAL; provisional scores cannot override factual/contract nonconformance.
- **D4:** independent redline — PARTIAL/FAIL for product acceptance; BYD's saved automatic output falls back and the late quote cannot support a historical PE; Dongshan redline rejects numeric-detail leakage. Model outputs were not edited here.
- **D5:** 19-section, P0, Knowledge and persistence invariants — PASS for isolation; historical `17/19 BLOCKED` and both valuation sections remain blocked.
- **D6:** engineering validation — PASS for no new regression; clean-main's 21 Node and 5 Client known failures persist.
- **D7:** PR reviewable, open and unmerged; branch/report push and PR description update are part of S5 delivery. CTO acceptance remains outstanding.

Next acceptance should target only the factual/qualitative vetoes with an independently approved model-call budget and an auditable raw request/response record for both companies. Do not treat the editor prompt, deterministic replay, or passing engineering tests as product-quality acceptance. No model budget remains from the earlier P1 run (`12/12`); production authorization remains unknown.
