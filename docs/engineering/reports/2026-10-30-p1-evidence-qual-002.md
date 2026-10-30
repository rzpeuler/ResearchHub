# P1-EVIDENCE-QUAL-002 — Production Valuation Evidence Integration Audit

**Decision:** `READY_FOR_ARCHITECT_REVIEW / PRODUCTION_BOUNDARY_PROVEN / P1_PRODUCT_NOT_ACCEPTED`

**Scope and baseline:** PR #10, branch `codex/p1-editorial-synthesis`, frozen head `091d04308692d6c19d315e7c2419a2669210dd2e`; `origin/main` `6989b5f010d596e7436f1f4d49841ad8845ce64c`. The branch and remote head matched at start and before validation. This report records integration proof only; it does not change the prior EVIDENCE-QUAL-001 report.

**Execution boundary:** 0 real model calls; no full research Workflow, data acquisition, report persistence, or Knowledge write. No provider terms or market rights were inferred. The prior protected root state, P0 BYD/Dongshan archive, Knowledge Base, and pre-existing P1 untracked artifacts were not modified. Existing `tmp/` and parser cache artifacts were left untouched.

## I0 — Frozen production path and contracts

The production route is:

1. `createValuationDataResolver` returns a `ValuationMarketPayload` and acquisition source metadata. The payload includes the observation, publisher, retriever, URL, retrieval time, close-availability time, and optional freshness. Neither `ValuationMarketPayload` nor `AcquisitionSourceMetadata` has an authorization/rights field. See `plugins/research-acquisition/valuation-data.ts:12-27, 210-211` and `data/contracts.ts:134-152`.
2. Workflow carries the `ResolvedDataItem` into `buildCompanyValuationSections` at `workflows/company-deep-research/workflow.ts:648`.
3. `quoteSource` serializes the quote and PIT/version details into a content-hashed `NormalizedResearchSource`, but explicitly assigns rights `accessScope=unknown`, `providerTermsKnown=false`, and all reuse permissions `false` (`workflows/company-deep-research/valuation-sections.ts:81-127`). The normalized source contract requires rights fields (`plugins/research-acquisition/contracts.ts:40-61`), but the upstream valuation contract cannot supply a trusted rights grant.
4. Workflow merges the generated evidence source and section into the synthesis inputs and calls `buildSynthesisEvidenceLedger` with `asOf` (`workflows/company-deep-research/workflow.ts:648-729`).
5. The ledger and the final synthesis handoff independently qualify market sources. Historical qualification requires content-hash integrity, PIT markers, a verified value version, freshness, and public retention/AI/derivative rights (`workflows/company-deep-research/assembly.ts:39-67`). Method evidence also cannot reintroduce an unqualified market quote (`assembly.ts:161-225, 2644-2654`).

**Contract finding:** the current production contract has a fail-closed path but no end-to-end positive authorization path for an AKShare/Tencent quote. A `VERIFIED` value-version fixture can exercise the PIT gate; it does not establish source usage rights. No existing source rights grant or authenticated rights proof was found in the valuation payload/source metadata contracts reviewed for this task. `INT-07` is therefore `NOT_EXECUTABLE_WITH_CURRENT_CONTRACT`; report status is `PRODUCTION_POSITIVE_PATH_NOT_YET_SUPPORTED`.

This is a finding about missing authorization evidence in the current contract and runtime path. It is not a legal determination that the provider prohibits use. Establishing a positive rights-bearing path requires a separately approved Data/source contract decision; this task does not change that contract.

## I1/I2 — Integration matrix

All quote sources in these tests are produced by the real `buildCompanyValuationSections` from a `ResolvedDataItem<ValuationDataPayload>`-shaped upstream fixture. Tests do not construct a final market `NormalizedResearchSource`. Any verified value-version is explicitly named `FIXTURE_ONLY` and is never presented as production authorization.

| Case | Production construction and input | Ledger / synthesis result | Evidence |
|---|---|---|---|
| INT-01 Historical close, fixture-only verified version | Upstream close available by `asOf`; fixture version available by cutoff. Builder emits a historical quote source. | Rights remain `unknown/false`; valuation ledger is blocked with `WORKFLOW_MARKET_PRICE_PIT_OR_VALUE_VERSION_UNVERIFIED`; no quote evidence is admitted. | Integration test asserts builder output, rights values, fixture-only ID and blocked ledger. |
| INT-02 Late retrieval, current-only | Retrieved after `asOf`; `CURRENT_VALUE_ONLY` keeps the displayed reference and actual retrieval time. | Stub `company_research_synthesis` request excludes the quote locator from both `allowedCitations` and `allowedEvidence`. | Integration test captures the production assembly request. |
| INT-03 Missing version / retrieval before close availability | Historical input without a version, and separate input retrieved one second before exchange close availability. | No quote evidence source is emitted; diagnostics identify missing version or PIT close/retrieval gate. | Integration test asserts both fail-closed cases. |
| INT-04 Alternate method evidence path | Completed method fixture attempts to cite and carry the production-generated quote source. | Stub synthesis request excludes that locator from both allowed lists. A method packet cannot bypass the market gate. | Integration test exercises `assembleCompanyResearch` and captures the request. |
| INT-05 Same-number wrong metric | Annual report fixture contains FY2025 basic EPS `3.58` and a separate dividend row also containing `3.58`. | Extractor selects only the exact `基本每股收益` row and its paragraph locator; dividend row cannot satisfy EPS identity. | Integration test verifies selected row text and exact paragraph. |
| INT-06 Unrelated operating evidence | Same assembly request includes an independently sourced annual filing row. | Annual filing citation/evidence remains available while market evidence is excluded; the guard is scoped to the disqualified market source. | Integration test asserts both retained filing locator and absent quote locator. |
| INT-07 Existing positive rights path | Review of current production valuation payload, acquisition metadata, normalizer and synthesis checks. | No trusted quote-rights grant can flow from acquisition into the generated source. | `NOT_EXECUTABLE_WITH_CURRENT_CONTRACT`; no positive authorization was forged. |

The production builder also retains the fixed three workflow-owned valuation sections (`valuation`, `bull-base-bear`, `variant-perception`). The complete company synthesis continues to require all 19 stable report sections; the existing assembly regression confirms the 19-section contract.

## I3 — Validation

| Validation | Result |
|---|---|
| Focused integration + existing assembly + valuation-section tests | PASS, 145/145 (including 6 new integration tests). |
| `npm run typecheck` | PASS. |
| `npm run client:typecheck` | PASS. |
| `npm run client:build` | PASS; existing bundle warning remains at 744 kB minified JS versus 500 kB advisory threshold. |
| Full Node regression (`npm run test:node`) | 3,294 passed / 21 failed of 3,315; all 21 normalized failing-test identities match the preserved baseline. Six added integration tests are included in the 3,294 passes. |
| Full client regression (`npm run client:test`, isolated run) | 223 passed / 5 failed of 228; all five failing-test identities match baseline. |
| `git diff --check` | PASS. |

The Node runner rewrote five clean tracked validation JSON artifacts by refreshing generated timestamps/contents: `RHL-EXEC-003-A-004-FIX-002-thesis-authorized.json`, `RHL-EXEC-003-A-004-FIX-003-event-readonly.json`, `RHL-EXEC-003-A-004-FIX-003-industry-readonly.json`, `RHL-EXEC-003-A-004-FIX-003-thesis-references.json`, and `company-quality-pi-default-deny.json`. The pre-run tracked state was clean; their exact test-generated diffs were inspected and each file was restored to its pre-run repository version. No intended evidence output was altered.

### Regression identity comparison

Baseline Node suite before this task: 3,288 pass / 21 fail out of 3,309 (EVIDENCE-QUAL-001 log). The current suite adds six tests and has the same 21 failing identities; `Compare-Object` over normalized failure-title sets returned no differences. The pre-existing client baseline is 223 pass / 5 fail out of 228; the isolated current run has the same five identities from `src/App.test.tsx` and `src/app/report-navigation.test.tsx`. A first parallel run with Node caused additional timeout noise and is intentionally excluded from the acceptance result; it is retained only as diagnostic context outside the repository.

## I4 — Scope and acceptance

- No production code, public Data contract, source policy, model, Skill, reviewer, or architecture layer was changed.
- No report or Knowledge runtime artifact was written. The only intended tracked changes are this audit report and its focused integration test.
- P0 stays strict `17/19 BLOCKED`; P1 product quality is not accepted by this contract audit.
- The production boundary is demonstrated fail-closed across the Workflow ledger, ordinary method evidence route, and final synthesis allow-list. The positive market authorization route remains unsupported until the source contract can carry independently verified rights.

**Acceptance status:** `READY_FOR_ARCHITECT_REVIEW / PRODUCTION_BOUNDARY_PROVEN / P1_PRODUCT_NOT_ACCEPTED`.
