# Company Research P0 execution record — 2026-10-26

Task: RHL-CQR-P0-01~06. Scope is Workflow-owned synthesis, evidence handoff, validation and read-only acceptance. No Knowledge schema/data was modified. All pre-existing unrelated UI/runtime changes and the `skills/company-research/numeric-grounding.ts` user edit were preserved.

## Gate A — BYD failure artifact

Original run: `3d3d171a-992a-47b1-9cbc-ca7725888f2d`; report `runtime-data/reports/company-research-002594-3d3d171a-992a-47b1-9cbc-ca7725888f2d.md`, with `.analysis.json`, `.progress.json`, and `.md.json` sidecars.

| Evidence | Observed fact | Classification / confidence |
|---|---|---|
| `.md.json` | 14/16 core sections, `SYNTHESIS_DEGRADED`; thesis and checklist lack attributable evidence and duplicate a blocked explanation. | `FORMAT_OR_RUNTIME_ERROR`; confirmed symptom. |
| `.analysis.json` | All ten atomic methods report complete. First synthesis draft had substantive thesis/checklist text; a 2025 product gross-margin value cited both industry and product rows, making its category binding ambiguous. Numeric grounding rejected it. | `NUMERIC_OR_SEMANTIC_MISMATCH`; confirmed defect in that draft, not the unique original-run root cause. |
| `.analysis.json` | One later synthesis diagnostic says the usage limit was reached. | `FORMAT_OR_RUNTIME_ERROR`; confirmed later call failure. |
| `.analysis.json` snapshot fields | Final diagnostic says cited evidence changed/unresolved, but the original artifact did not preserve before/after fingerprints or per-reference diffs. Persisted source body hashes match their recorded SHA-256 values; the artifact cannot identify a changed dependency. | `STALE_SOURCE_OR_METHOD_REVISION` remains **unproven**; no unique root cause is claimed. |

The available artifact supports a minimal fix to compare the exact cited evidence and its source hash at each reference, and to preserve diagnostics when evidence changes. It does not support broad prompt replacement or weakening the numeric/semantic checks.

## Gate B — atomic Skill contract matrix

Owner map from `skills/company-research/methods.ts:237-241`; output validation from `methods.ts:1621-1700`; Workflow loads the corresponding `SKILL.md` at `workflows/company-deep-research/workflow.ts:676-681`.

| Atomic Skill | Owned report section(s) | Contract check / notable gap |
|---|---|---|
| `company_history_strategy` | `company-overview` | Inputs, sourced chronology, findings and limitations are specified in `skills/company_history_strategy/SKILL.md`. |
| `business_model_map` | `business-model`; `business-segments`; `supply-chain` | Tables, units, periods and exact row locators specified in `skills/business_model_map/SKILL.md`. |
| `product_technology_analysis` | `products`; `technologies` | Product evidence and technology validation stages specified in `skills/product_technology_analysis/SKILL.md`. |
| `business_driver_analysis` | `revenue-profit-drivers`; `growth-drivers`; `catalysts` | Period-aligned driver inputs and evidence-bound explanation specified in `skills/business_driver_analysis/SKILL.md`. |
| `financial_quality_analysis` | `financial-quality` | Financial observations, compatible periods/units/bases, formulas and sourcing specified in `skills/financial_quality_analysis/SKILL.md`. |
| `market_structure_analysis` | `industry-exposure` | Single exact owner; source-bounded industry context in `skills/market_structure_analysis/SKILL.md`. |
| `competitive_market_map` | `competition` | Candidate identity, comparability and missing relationship evidence in `skills/competitive_market_map/SKILL.md`. |
| `management_governance_analysis` | `management-capital-allocation` (shared) | Governance/personnel evidence and bounded disclosure gaps in `skills/management_governance_analysis/SKILL.md`. |
| `capital_allocation_review` | `management-capital-allocation` (shared) | Capital actions, applicable metrics and outcomes in `skills/capital_allocation_review/SKILL.md`. |
| `company_risk_analysis` | `risks` | Sourced risk transmission, limits and risk-matrix structure in `skills/company_risk_analysis/SKILL.md`. |

The executable contract validates exact owned section IDs, result shape, finding kind, exact `sourceCandidateId@location`, citations, bounded output, limitations and risks. Confirmed limitations: `status` is method-wide, so it cannot express complete and insufficient owned sections separately; `insufficient_evidence` only requires a nonempty limitations list; shared governance/capital-allocation ownership has no declared subownership or deterministic merge rule. These are contract/aggregation risks, not proof that any Skill was skipped. Six Skills lack YAML frontmatter, but Workflow reads their Markdown directly; recorded as P1 documentation/catalog consistency, not a runtime defect. Skill prose and executable checks are complementary; calculators/validators are deterministic, while semantic interpretation is delegated by Workflow.

## Gate B — acquisition and field lineage

Source policies are in `data/company-research-policies.ts:7-31`; requirement materialization in `workflows/company-deep-research/workflow.ts:377-399`; mapping/normalization in `plugins/research-acquisition/company-research-data.ts`; provider keys in `plugins/research-acquisition/akshare.ts`.

| Requirement / canonical fields | Source and raw field mapping | Meaning, period/unit, PIT | Consumer and gap/conflict rule |
|---|---|---|---|
| `company_basic_profile` | AKShare `stock_individual_info_em`; generic `item/name/字段` + `value/值` to profile fields (`akshare.ts:24-32`; `company-research-data.ts:255-267`). | Current snapshot; retrieval time only; no publication timestamp; `CURRENT_VALUE_ONLY`/`UNVERIFIED`. No historical business inference. | Company overview / industry classification. Treat as current-only context. |
| `company_financial_history` — revenue, net profit, gross margin, EPS | Indicators: `TOTALOPERATEREVE→operating_revenue`, `PARENTNETPROFIT→net_profit`, `XSMLL→gross_margin_percent`, `EPSJB→basic_eps`; statements: `TOTAL_OPERATE_INCOME`, `PARENT_NETPROFIT`, `OPERATE_COST` (`akshare.ts:34-39`; mapping `company-research-data.ts:271-284`). | Revenue/net profit monetary; margin is a percent; EPS CNY/share. `NOTICE_DATE` may become `publishedAt`, but value-version is `UNVERIFIED`; no PIT proof. Net profit is parent net profit in raw mappings, though generic display names can obscure attribution. | `financial-analysis.ts:18-43`. Revenue/net profit and selected debt conflicts are compared; other overlapping values can be overwritten by the indicator row (`company-research-data.ts:95-113`). Gross-margin field and recalculated revenue/COGS margin are not conflict-compared. |
| `company_financial_history` — COGS, OCF, R&D, capex, balances, debt | `OPERATE_COST→cogs`; `NETCASH_OPERATE→operatingCashFlow`; `RESEARCH_EXPENSE→researchDevelopment`; `CONSTRUCT_LONG_ASSET→capex`; balance/debt fields include `TOTAL_ASSETS`, `TOTAL_LIABILITIES`, `TOTAL_PARENT_EQUITY`, `MONETARYFUNDS`, `ACCOUNTS_RECE`, `INVENTORY`, `ACCOUNTS_PAYABLE`, `SHORT_LOAN`, `LONG_LOAN`, `BOND_PAYABLE`, `NONCURRENT_LIAB_1YEAR` (`akshare.ts:39`; `company-research-data.ts:273-286`). | Flow values use YTD; balances are point-in-time. Currency/unit metadata is inferred row-wide from row unit/currency or revenue presence, not verified per metric. Historical value versions remain `UNVERIFIED`. The current portion can include leases/non-debt liabilities. | Financial ratios, cash conversion and simplified OCF-minus-capex proxy (`financial-analysis.ts:41,77-101,138-162`). Some conflicts are excluded per metric, but conflict records have no source IDs, original field labels, unit or basis (`data/company-research-contracts.ts:19`). |
| `company_market_history` | EastMoney `stock_zh_a_hist(... adjust='')`, Tencent `stock_zh_a_hist_tx(... adjust='')`; date/open/high/low/close/volume (`akshare.ts:92,96-97`; normalizer `company-research-data.ts:287-302`). | Unadjusted OHLCV; historical observation date may pass close-availability PIT checks, but no adjustment, currency, price unit or volume unit fields; current source value version unverified. | Market/valuation context (`skills/company-research/skill.ts:36-37`). Do not construct a target price without required inputs; observation date PIT does not prove source revision history. |
| `company_research_evidence` | CNINFO and GDELT `COLLECT_DIVERSE`; optional public-web route only when explicitly composed (`company-research-policies.ts:13-31`). CNINFO annual financial fallback is a narrow official PDF extraction (`company-official-financial.ts:4-41`). | Evidence date qualification retains `publishedAt`; retrieval time does not substitute for publication time. The annual fallback normalizes five main-statement values and marks numeric PIT/value version unverified; flattened extraction does not retain a full table/page context bundle. | Ten Skills consume eligible exact paragraph locators. P0 risk: the PDF fallback’s limited table context may not support detailed/interim claims; source eligibility and exact evidence validation must remain fail-closed. |

Confirmed P0 data risks were recorded but not expanded into public Data Layer schemas here: incomplete conflict detection/indicator-overwrites-statement merge, row-wide unit inference, missing OHLCV unit/adjustment metadata, and narrow PDF table context. Provider-specific overlap and unit behavior were not claimed without raw response evidence. Schema additions or changes require separate architecture approval under the task boundary.

## Implemented Workflow changes

- Final model contract asks for `investment-thesis` and `monitoring-checklist` only; the three optional report sections keep deterministic, bounded gap text, retaining all 19 stable section IDs and 16 core sections.
- Added a bounded `SynthesisEvidenceLedger` from complete method findings only. Every ledger entry requires all cited rows to match the method-supplied excerpt and persisted source text exactly; conflicted source IDs, incomplete methods and unresolved citations are excluded. Entries carry owner, section, finding kind, source hash, locator, excerpt, publication date when supplied and PIT metadata when supplied.
- Synthesis and independent content review each share a total two-call budget across repair and later acquisition/review rounds. Budget exhaustion remains blocked and records the diagnostic; it cannot trigger an extra model call.
- Snapshot comparison now keys source hashes and cited evidence/findings by locator. It distinguishes unresolved/cited changes from unrelated method text edits and persists a per-locator comparison.
- Removed the hard-coded 吉利银河/银河E8 example from generic synthesis prompting.

No evidence rule, numeric guard, independent review condition, or Knowledge write policy was relaxed. The ledger does not convert assumptions into sourced facts; every evidence locator must be present in the actual supplied packet and match its source row.

## Validation

- `npm run typecheck`: passed after final Workflow/ledger changes.
- `npm run client:typecheck`: passed.
- `npm run client:build`: passed; existing Vite chunk-size warning only.
- Targeted company suites: 113 tests; 110 passed, 3 inherited table-repair failures (`R143`, `R144`, `R146`). The same three cases failed in the clean `origin/main` baseline worktree before task changes. New synthesis-ledger and budget assertions passed.
- `npm run client:test`: 223 tests; 217 passed, 6 failed across `client/src/app/report-navigation.test.tsx` and `client/src/App.test.tsx`. The clean `origin/main` baseline also has six failures across these two files (68 tests, 62 passed); exact cases differ as current user-owned UI edits add/change assertions. This task did not edit frontend files.
- `npm run test:node`: current checkout ran 3,078 tests (3,054 passed, 24 failed); clean `origin/main` ran 3,076 (3,052 passed, 24 failed). All 24 failing test names match exactly; there are no new Node regressions. The Company Research targeted subset isolates the same three known `R143/R144/R146` baseline failures; all new ledger/budget checks pass.
- `git diff --check`: passed (Git emitted only existing LF/CRLF warnings).

## Live acceptance

Fresh real Runtime/API runs use the current root checkout code, existing configured model `openai-codex/gpt-6-luna`, real acquisition/model path, and read-only persistence (`writeKnowledge=false`) against a disposable v0.4 KB. The initial output is under `runtime-data/company-quality-acceptance/2026-10-26-p0-readonly/`; the subsequent output is under `runtime-data/company-quality-acceptance/2026-10-26-p0-readonly-recheck/`. These are real Runtime/API runs, not fixtures or production Knowledge writes.

| Company | Run ID | Status | Report / acceptance evidence | Quality review |
|---|---|---|---|---|
| BYD (002594) | `76164bbb-b0db-4357-9b1c-d086e261c519` | blocked, 15/16 core | Initial report and sidecars in `2026-10-26-p0-readonly/`; financial-quality method failed numeric/reference checks after two attempts; thesis/checklist passed. | Knowledge unchanged. |
| Dongshan Precision (002384) | `1005bea0-d17d-462f-aea4-9f005cd979d8` | blocked, 14/16 core | Initial report and sidecars in `2026-10-26-p0-readonly/`; synthesis degraded with unattributed thesis/checklist and a detached business-segments table header. | Knowledge unchanged. |

The synthesis size and table-header fixes were then exercised in a second real run. BYD run `9375edfc-fa1f-4e21-b9f9-7b2589ff9b11` passed thesis/checklist attribution and report table checks, but remains blocked at 14/16 because `product_technology_analysis` failed after two numeric-grounding attempts (`-23.99万元`). Dongshan run `323235ad-3737-4dc8-bbab-6fd5bb203d40` completed all ten methods and the table error was repaired; synthesis still rejected the “100” in a cited `100G EML` product name and degraded, leaving thesis/checklist unattributed. Both second-run disposable KB fingerprints are unchanged.

The third run used a qualitative-only thesis/checklist instruction. BYD run `8ce3b427-3a40-4095-a8e0-aa09f45be33a` completed all ten methods and passed thesis/checklist attribution, but remains blocked at 15/16 by the independent review of `industry-exposure`; the review points to duplicated industry/product rows and a detached table header, while also stating the forecast figures and period are supported. Dongshan run `c887c721-1621-4d48-9924-b6590d372553` completed all ten methods but the independent semantic-review operation failed closed after two contradictory-format outputs (`FORMAT_ERROR` for a reason that rejected its false flag). The preserved review draft also flags a wrong locator in a checklist technology item and a cross-period product-category comparison. Both third-run disposable KB fingerprints are unchanged.

A Workflow instruction was added after the third process started to keep industry-classified financial rows in `industry-exposure` and product-classified rows in `business-segments`. The fourth, current-code run exercised this instruction: BYD run `dad18ec9-e618-4a1c-9d4e-c7cf2400f2a0` passed `industry-exposure` review and thesis/checklist attribution, but is blocked at 13/16 because `business_model_map` failed numeric grounding on supported product percentages and then omitted two required owned sections on retry. Dongshan run `fae39cb7-89c3-4155-8f77-840309bd2d20` completed all ten methods and passed the other 14 sections, but synthesis degraded when numeric grounding rejected three computed growth-difference values; its snapshot audit also records method-finding changes despite unchanged source hashes/excerpts. Both current-run disposable KB fingerprints are unchanged. P0 remains incomplete pending closure of the method/synthesis numeric-binding issues and a passing real acceptance run.

A prior live BYD run from the same task branch (before the global-budget correction) was blocked by reviewer-format contradictions and genuine coverage defects; its run ID is `3282c078-8778-4a3f-99da-052823f5e846`. No report is described as passed unless the final artifact proves 10/10 methods, 16/16 core checks, usable thesis/checklist, and unchanged Knowledge fingerprint. P0 completion therefore remains pending real acceptance and regression closure.

## Outstanding items

1. Resolve the numeric-grounding contract for verified derived values without weakening source/period/category checks, then rerun both real acceptance cases.
2. Complete report review and Git delivery; full Node and client baselines have no new failure names/counts.
3. Review Git ancestry and the two local commits ahead of `origin/main`; stage and commit only P0-owned paths, preserving all pre-existing user changes. Push/create a reviewable PR only if ancestry and repository workflow allow without including unapproved work.
4. Keep P1 `Editorial Synthesis` / `Publication Quality Gate` out of this P0 implementation.
