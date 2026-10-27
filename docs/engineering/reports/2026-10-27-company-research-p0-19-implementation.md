# Company Research P0-19 — Workflow Implementation Record

**Task:** `RHL-CQR-P0-19-CHANGE-001`
**Date:** 2026-10-27 (Asia/Shanghai)
**Status:** Workflow implementation validated with fixtures; live BYD and Dongshan acceptance remains blocked / not established.

## Scope delivered

- Company Research now requires all 19 stable report sections. Fourteen sections retain their atomic-method owners, three quantitative sections (`valuation`, `bull-base-bear`, `variant-perception`) are explicitly Workflow-owned, and `investment-thesis` plus `monitoring-checklist` remain the two synthesis-owned sections.
- Persisted ResearchReport metadata validation now accepts a passed semantic review only when it contains all 19 checks, matching the Workflow reviewer contract.
- The Workflow acquires read-only valuation and earnings inputs inside the existing shared 10-minute acquisition budget. It records resolver attempts, item status, and diagnostics in the analysis sidecar, and passes the quantitative sections and their exact source candidates into normal report assembly and quality review.
- Company Deep Research collects both existing FY EPS surfaces using the existing Data `COLLECT_DIVERSE` mode. This policy is scoped to Company Research EPS; Earnings Review retains its existing `FIRST_VALID` route. No provider, metric ID, public Data schema, Skill tier, or Knowledge write path was added.
- Institution aliases are canonicalized and overlapping contributors are assigned once to the latest published estimate (same-date ties use the Tonghuashun row). The Variant Perception section compares provider-exclusive same-period/unit medians only when both have at least two eligible institutions. It explicitly labels forecast value-version status `UNVERIFIED` when historical revision proof is absent; otherwise it stays a gap.
- The current deterministic scenario output uses the verified FY annual-report EPS and current unadjusted close for a reference PE, then applies the selected current FY consensus low/median/high EPS at the same PE. It does not assign probabilities. This is a bounded valuation sensitivity; an independent semantic review may still reject it if it does not establish operating-driver cases and counterevidence.
- An exact supplied-citation inventory now reaches the `business_driver_analysis` method so it can repair a citation only to a locator that was actually supplied to that method. Existing source locator validation remains fail-closed.

## Validation

Commands run from the repository root:

| Command | Result |
|---|---|
| `node --import tsx --test tests/workflows/company-semantic-quality.test.ts tests/workflows/company-content-quality.test.ts tests/workflows/company-deep-research.test.ts tests/workflows/company-valuation-sections.test.ts tests/workflows/company-research-assembly.test.ts tests/workflows/data-layer-valuation-earnings.test.ts tests/workflows/earnings-data-resolver.test.ts tests/skills/company-methods.test.ts` | 486/486 passed |
| `node --import tsx --test tests/app/services/research-report.test.ts` | 13/13 passed |
| `npm run typecheck` | Passed |
| `npm run client:typecheck` | Passed |
| `npm run client:build` | Passed; Vite reports the existing 743 kB main JS chunk size warning |
| `git diff --check` | Passed |

The tests use labeled synthetic fixtures for resolver/provider and filing rows. They do not constitute live-provider or report acceptance evidence. Integration coverage confirms a run without quantitative resolver inputs remains `blocked`, leaves the three Workflow-owned sections as explicit gaps, performs only the existing single synthesis call, skips independent review, and leaves the Knowledge tree unchanged.

## Remaining acceptance work

- The existing Gate 1 report and read-only repair-34 runs predate this implementation; they do not prove the new Workflow integration. Run the current root Runtime read-only for BYD (`002594`) and Dongshan Precision, then review the persisted Report, analysis sidecar, provider diagnostics, source hashes, and Knowledge-base hashes.
- The provider probes found matching FY EPS units and dates before the cutoff, but do not prove historical forecast value versions. Keep the visible `UNVERIFIED` qualification and fail closed for historical requests without version evidence.
- The generated Bear/Base/Bull cases are a consensus-EPS and fixed-multiple sensitivity. The independent review must determine whether the supplied operating drivers, counterevidence, and link to monitoring are adequate; passing structural checks alone is not completion.
- P0-19 remains incomplete until both real read-only reports pass all 19 required-section checks and the independent semantic gate. No completion claim is made by this implementation record.

## Test data and persistence boundary

Synthetic resolver/provider and filing examples are maintained in the targeted test files. No live provider body, credential, or production Knowledge data was added to the repository. Runtime logs and generated parser cache files are local artifacts and are excluded from this change.
