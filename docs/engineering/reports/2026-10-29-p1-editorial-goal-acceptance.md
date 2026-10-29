# P1-GOAL-001 — Editorial Synthesis Acceptance Record

**Status:** `BLOCKED_MODEL_OR_EVIDENCE`
**Baseline:** `6989b5f010d596e7436f1f4d49841ad8845ce64c`
**Branch:** `codex/p1-editorial-synthesis`
**Model calls:** 0 / 12
**Product-code changes:** one short existing-synthesis priority and focused contract assertions; output quality is not yet assessed

## Result

The two archived company reports were read and fingerprinted in a read-only pass. The baseline shows that both already have clear, evidence-backed theses, counterevidence and usable monitoring lists. It also identifies bounded editorial gains and a specific Dongshan citation-spacing defect. A small candidate priority was added to the existing synthesis instruction, but no candidate “after” text was generated or scored.

The user-visible Runtime setting selects `openai-codex/gpt-6-luna`, and its model catalog reports `available=true`; `modelProviders.openai-codex.configured` is `false`. A local Pi `ModelRuntime` initialized from the standard Pi agent directory with model-network refresh disabled has an empty available-model snapshot. This does not establish an authenticated path for the authorized Pi synthesis executor. No synthesis or connection-test call was made, and no alternative model or account was used. The minimum unlock is configuring the existing OpenAI Codex Pi provider; the same-source replay can then resume within the remaining 12-call budget.

## Definition of Done

| Requirement | Status | Evidence |
| --- | --- | --- |
| D1 — Real archived baseline | **PASS** | [P1 editorial baseline](2026-10-29-p1-editorial-baseline.md): report/run IDs, `asOf`, 19 section IDs/order, evidence-location counts, quality issues, source snapshot and archive hashes. |
| D2 — At least three real before/after improvements per company | **NOT MET** | No synthesis call was made because the permitted Pi runtime has no available authenticated model; there is no generated after text. |
| D3 — Six-dimension scores and target threshold | **PARTIAL** | Both baselines score `3/3/3/3/3/2` in thesis clarity, causal evidence chain, counterevidence/failure conditions, monitoring, cross-section consistency and concision. No after-score exists. |
| D4 — Candidate redline review | **NOT RUN** | No candidate output exists. Baseline facts and locators were not edited. |
| D5 — Report/Knowledge/blocked-state invariants | **PARTIAL** | The code change touches only the existing synthesis instruction. The focused assembly suite retains all 19-section and blocked-state checks; no source archive, report, Runtime configuration or canonical Knowledge was written. Real candidate output invariants remain unverified. |
| D6 — Engineering regression | **PARTIAL** | Assembly suite 112/112; `npm run typecheck`, `npm run client:typecheck`, and `npm run client:build` pass. Full Node: 3,284/3,305 passed with 21 failures, all 21 reproduced on clean `main` in the same five files. Full Client: 223/228 passed with 5 failures, all five reproduced on clean `main` in `App.test.tsx` (3) and `report-navigation.test.tsx` (2). |
| D7 — PR and reviewable outcome | **PARTIAL** | Updated implementation, test and blocker evidence are in [PR #10](https://github.com/rzpeuler/ResearchHub/pull/10). No main merge is authorized. |

## Baseline editorial scores

Scores use the task's 0–4 scale; order is thesis clarity / causal evidence chain / counterevidence and failure conditions / monitorability / cross-section consistency / concision.

| Company | Baseline | Main documented opportunity |
| --- | --- | --- |
| BYD 002594 | `3/3/3/3/3/2` | Bring the current automotive operating counterevidence forward; reduce repeated caveats and method detail while retaining citations. |
| Dongshan Precision 002384 | `3/3/3/3/3/2` | Reduce repeated product-revenue detail and concentration caveats, order monitoring around commercialization and cash conversion, repair citation spacing. |

These are qualitative engineering reading scores, not statistical results or investment advice. There is no claim of P1 product improvement.

## Invariants and safety

- The original reports remain `17/19 BLOCKED`; `bull-base-bear` and `variant-perception` remain unqualified. P0-19 remains `NOT_ACCEPTED`.
- No source acquisition, complete Company Research execution, production Knowledge write, or runtime report update occurred.
- The source-content snapshot was read only. Raw report/source bodies were not copied into Git.
- The root checkout's dirty evidence and user runtime files were not staged, changed, moved or removed. Work occurred in the dedicated temporary worktree.
- No Skill, Reviewer, Workflow, schema, 19-section contract, or public data contract was added or modified.

## M2 decision and M3 partial implementation

The change is limited to the existing `company_research_synthesis` instruction: rank the thesis as judgment → decisive operating driver → best evidence and disconfirmer → failure condition; order monitoring by those same drivers and consolidate only duplicate mechanisms. Existing evidence validation and section ownership remain authoritative. The instruction contract test was extended. There is no model-generated same-input improvement, so no quality gain is claimed.

## Validation and delivery state

- Pi/runtime availability checks were read-only and emitted only model/provider identity and availability flags; no credentials were read into output.
- Focused assembly tests: 112 passed. Root and Client typechecks passed. Client build passed.
- Full Node regression: 3,284 passed / 21 failed; all 21 failure titles and files reproduced on clean `main` at `6989b5f`.
- Full Client regression: 223 passed / 5 failed; all five failure titles reproduced on clean `main` at `6989b5f`.
- Clean-main comparison worktree was detached at `6989b5f`; only the matched failing Node files and Client files were run there. No failures were found in this P1 synthesis area.
- Model call count and cost: `0`; elapsed model time: `0`.
- This record does not claim `READY_FOR_CTO_ACCEPTANCE`; D2, D4 and D6 remain outstanding. PR #10 carries only the baseline, progress and blocked acceptance records for review.
