# P1-GOAL-001 — Editorial Synthesis Acceptance Record

**Status:** `PARTIAL_PRODUCT_QUALITY`
**Baseline:** `6989b5f010d596e7436f1f4d49841ad8845ce64c`
**Branch:** `codex/p1-editorial-synthesis`
**P1 synthesis calls:** `6 / 12`
**Separate Runtime connection probe:** `1` successful `openai-codex/gpt-6-luna` request
**Merge:** not authorized

## Result

The current Runtime successfully completed its single-model connection test for `openai-codex/gpt-6-luna`. The earlier provider-unconfigured diagnostic did not prevent a live completion. I then ran six actual `company_research_synthesis` calls against the two archived inputs: one baseline and one candidate for each company, followed by one candidate iteration for each company. No Company Research Workflow, data acquisition, report persistence, or Knowledge write occurred.

Each baseline/candidate pair used the same canonical serialized `request.input` hash. BYD used `76d6e52dd6d0a6a25d016d24a0adba6b99c22c4b6c59f25d34466d26ad631158`; Dongshan used `1fc05ffcece4e7b416d2fff4e9d24067a241b72959fb1d8a34a3bd47443aa8e0`. Across both rounds, `asOf`, all 10 archived method results, source IDs/content hashes, and the 304 / 372 allowed evidence locators were fixed. The aggregate content hashes match the baseline record. Earlier mock-preflight hashes used a different serialization and are not represented as matching the live request-input hashes.

All six actual outputs passed the existing citation and numeric assembly validators with zero diagnostics. However, both model iterations still placed amounts, ratios, or interim-period values in the synthesis sections despite the existing instruction requiring qualitative-only conclusions and leaving numeric detail in the owning method chapters. The second prompt iteration reinforced that boundary but did not fix the behavior. No candidate is therefore promoted as an acceptable P1 result, and the output-quality threshold is not met.

The bounded code change remains in the existing `company_research_synthesis` instruction. It orders judgment, operating driver, evidence/counterevidence, and failure conditions, and asks monitoring to follow the same causal chain. The prompt also explicitly prohibits repeating numeric tables in the two synthesis sections. No new Skill, Reviewer, Workflow, schema, report contract, or Knowledge path was added.

## Real before/after observations

These short excerpts are from the isolated real-call drafts. Citations in the retained drafts point only to the saved allowed-locator set; the full drafts remain outside Git.

| Company | Baseline excerpt | Candidate observation | Assessment |
| --- | --- | --- | --- |
| BYD | “技术与制造积累支撑汽车、电池、电子等多业务……但现阶段兑现与资本回报尚未被充分验证。” | Iteration 2 says “决定性驱动与支持证据” but then repeats three 2025 product-revenue amounts and percentages in `investment-thesis`. | Clearer labels, but the thesis grows from 1,498 to 2,315 characters and violates the qualitative-only rule. Concision remains 2/4; no accepted improvement. |
| BYD | Monitoring begins with product mix and contains repeated caveats across separate rows. | Iteration 2 groups segment revenue, operating results, customers, working capital, cash/capex, server/liquid-cooling, charging, goodwill, and valuation inputs into nine ordered rows. | Checklist remains within nine items and is causally easier to scan; however it includes customer percentages and adds detail. Partial editorial gain, not sufficient to pass D2. |
| Dongshan | The thesis states the AI-infrastructure opportunity and names acquisition/product evidence, followed by a long revenue list and customer-concentration caveat. | Iteration 2 uses “决定性驱动” and a shorter thesis (2,003 → 1,585 characters), connecting acquisition, EML stages, cash conversion, and a named competitor. | Stronger causal ordering and shorter prose; it still inserts interim product figures and keeps some awkward citation placement. Nonconforming, so not accepted as an improvement. |
| Dongshan | Monitoring starts with customer concentration, then working-capital rows; citation spacing is inconsistent. | Iteration 2 orders product mix, margin, customers, working capital, cash/capex, EML, competitor, and valuation checks. | Better driver alignment and more compact thesis; monitoring is not shorter and remains verbose. The numeric constraint is still breached. |

All statements above describe editorial differences, not investment conclusions. The scores below are qualitative engineering judgments and cannot override the output-contract breach.

## Scores

Order is thesis clarity / causal chain / counterevidence and failure conditions / monitoring / cross-section consistency / concision.

| Company | Baseline | Best observed candidate, provisional | Acceptance note |
| --- | --- | --- | --- |
| BYD 002594 | `3/3/3/3/3/2` | `3/3/3/3/3/2` | Thesis expansion offsets clearer structure; no overall reading-quality improvement. |
| Dongshan Precision 002384 | `3/3/3/3/3/2` | `3/3/3/3/3/3` | Concision and causal ordering improve, but numeric detail violates the explicit qualitative constraint; provisional score is not a pass. |

This does not meet D2. D3's numeric threshold alone is not sufficient; candidate quality must also improve and remain compliant.

## Call accounting and retained evidence

- Provider/model: `openai-codex/gpt-6-luna` for the successful Runtime test and all synthesis calls.
- Six synthesis call wall times: 24.039s, 36.608s, 28.071s, 45.392s, 30.603s, 46.398s; total `211.111s`. The separate Runtime connection test completed in approximately 3.1s.
- The existing executor exposes no token-usage or provider-charge field. No token count or cost is inferred from the catalog metadata.
- Drafts and per-file SHA-256 values are retained in the isolated, untracked `tmp/p1-goal-001-replay/real-calls/` directory:

| Draft | SHA-256 |
| --- | --- |
| `002594-baseline.json` | `7995f58059a85d9148cc6c37a21fa5f4f912def903111e22ae5b47b452f3638d` |
| `002594-candidate.json` | `8b3fedd1ba6523be5ca6a154ef23f0975092f2a48d6e3bef73d8f4484f771953` |
| `002594-candidate-r2.json` | `0fd4cce40e75f54e0980060e6db54271ebe1dfba02de2be164116255e7376ddb` |
| `002384-baseline.json` | `63f059e7a255ba8441caa5aef9b839dc4be172cf6f51e5281f38b62b74a8f412` |
| `002384-candidate.json` | `fc4d4221803318058187a17b9e0a16f28291bc69faabe38e330126d87847424f` |
| `002384-candidate-r2.json` | `e9d05e8db97068aa17618b712d175365b726ea58fe42a8ef55dd9ce9e7ebbfcc` |

## Definition of Done

| Requirement | Status | Evidence |
| --- | --- | --- |
| D1 — Real archived baseline | **PASS** | [P1 editorial baseline](2026-10-29-p1-editorial-baseline.md): report/run IDs, `asOf`, 19 section IDs/order, evidence counts, gaps, and source/archive hashes. The source snapshot hashes were reproduced during the live replay. |
| D2 — Three real improvements per company | **NOT MET** | Real baseline/candidate outputs exist, but neither company has a compliant candidate with three accepted, traceable editorial improvements. Both candidates still violate the qualitative-only constraint. |
| D3 — Six-dimension scores and target threshold | **PARTIAL** | Provisional scores are recorded above; BYD shows no aggregate improvement. Dongshan's concision score improves, but its candidate is nonconforming. |
| D4 — Candidate redline review | **PARTIAL** | The six outputs passed existing locator and numeric grounding validators with zero assembly diagnostics. This is not a claim of complete human verification of every qualitative statement; no invented scenarios, targets, or new company facts are accepted into a Report. |
| D5 — Report/Knowledge/blocked-state invariants | **PASS for isolation** | No Report, source archive, Runtime config, or Knowledge was written. The historical reports remain `17/19 BLOCKED`; `bull-base-bear` and `variant-perception` stay unqualified; P0-19 remains `NOT_ACCEPTED`. |
| D6 — Engineering regression | **PARTIAL** | Focused assembly suite 112/112; `npm run typecheck`, `npm run client:typecheck`, and `npm run client:build` pass. Full-suite baseline is Node 3,284/3,305 with 21 failures, and Client 223/228 with 5 failures; the same failures were previously reproduced on clean `main`. Full suites were not rerun after the prompt-only edit. |
| D7 — PR and reviewable outcome | **IN PROGRESS** | PR #10 remains open and unmerged. This acceptance record and progress report will be pushed with the bounded code/test change and accurately marked partial. |

## Invariants and safety

- No new source, full Company Research run, external acquisition, OAuth/login flow, or model change was performed. The one-off connection test and six authorized synthesis calls used the existing selected model.
- The source-content snapshot was read only. Archived rights, retrieval time, and other acquisition metadata remain absent and were not reconstructed.
- No Report was published or persisted; no Knowledge write occurred. The root checkout and its dirty user files were not staged or changed by replay work.
- The 19-section contract, method ownership, Report JSON contract, P0 result, and `17/19` blocked status are unchanged.
- Browser E2E was not run. There is no claim of CTO readiness or acceptance.

## Validation and delivery state

- Current focused assembly suite: 112 passed / 0 failed.
- `npm run typecheck`: pass.
- `npm run client:typecheck`: pass.
- `npm run client:build`: pass; Vite reports an existing bundle-size warning (>500 kB chunk).
- Full Node/Client relative-baseline evidence remains as documented above; the full suites were not rerun after the final instruction-string edit.
- The six drafts remain untracked and will not be included in the PR. No runtime archive, source body, auth file, or user asset is staged.
- Final state: `PARTIAL_PRODUCT_QUALITY`. The two-iteration stop condition has been reached; a third prompt scheme or extra model calls are not pursued.
