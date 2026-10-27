# Company Research P0-19 — Minimal Estimate-Version Contract Proposal

**Task:** `RHL-CQR-P0-19-CHANGE-001`  
**Status:** Design proposal only; no runtime contract or provider has been changed.  
**Decision needed:** Approve or reject an additive per-estimate value-version field and the bounded scenario method below.

## Evidence motivating the proposal

- Company Research already resolves `earnings_expectation_eps` and `earnings_expectation_net_profit` for both target companies. Latest probes found 10 BYD and 6 Dongshan FY2026 EPS estimate points on the Tonghuashun route. Latest live analyses also contain EastMoney report estimates. Those outputs have institution/contributor, fiscal period, value, unit, publication date, and source-candidate references.
- The shared acquisition contract already has `NumericValueVersionEvidence` (`data/contracts.ts`), but `AcquisitionSourceMetadata.valueVersion` describes a source/acquisition, not each numeric point. `EstimatePoint` (`skills/earnings-review/expectations/contracts.ts`) has `publishedAt` and `sourceCandidateIds`, but no per-point value-version evidence. Current estimate acquisitions therefore remain `UNVERIFIED` for numeric value version in Company Research.
- Publication date and retrieval-time content hash do not, by themselves, prove that a returned numeric value was available on that publication date. The estimate adapters currently retain a Tonghuashun institution row or EastMoney report record and project point values, while the enclosing acquisition source omits verified value-version evidence (`plugins/research-acquisition/earnings-expectations-ths.ts`, `earnings-expectation-source-eastmoney.ts`, `earnings-data.ts`). A source adapter must establish a stable report/version basis before marking a point verified.
- Scenario valuation already has deterministic arithmetic and monotonicity checks (`skills/valuation/financials.ts`, `skills/valuation/contracts.ts`). It does not prove the assumptions: the current plan contract accepts growth rates and target multiples with allowed source IDs, while the model design validator proves shape/reference membership, not economic grounding (`skills/valuation/skill.ts`).
- The current live reports have no sourced target-year sales, margin, or cash-flow driver plan, and no qualified peer multiple set. The existing source probe has PIT-safe current quotes and filing-backed FY2025 EPS for both companies. The reports remain blocked on Bull/Base/Bear and Variant Perception; see `docs/engineering/reports/2026-10-27-company-research-p0-19-gate1.md` and `tests/validation/evidence/company-research-p0-19-gate1-probes.json`.

## Proposed smallest interface change

Add optional point-level version evidence to `EstimatePoint`; do not add or change a Common Data metric ID, source policy, provider, or Knowledge schema in this proposal.

```ts
type EstimateValueVersion =
  | { readonly status: 'VERIFIED'; readonly versionId: string; readonly availableAt: string }
  | { readonly status: 'UNVERIFIED'; readonly reason?: string }

interface EstimatePoint {
  // existing fields remain unchanged
  readonly valueVersion?: EstimateValueVersion
}
```

The type belongs at the estimate observation boundary, not only on the enclosing `AcquisitionSourceMetadata`, because one acquisition returns many estimates with different contributors, publication dates, and source records. Data adapters map each observation's evidence to the existing resolver-level `NumericValueVersionEvidence` when they can justify a common result. Consumer-level qualification must use the observation field and remain fail-closed when it is absent or `UNVERIFIED`.

`VERIFIED` is permitted only when all of these hold:

1. The exact estimate value, metric, target fiscal period, unit, contributor, and source candidate are bound to one identifiable published report or provider vintage.
2. `versionId` identifies that report/vintage, not the current retrieval response or a hash computed only at retrieval time.
3. `availableAt` is supported by the source's publication/version evidence, is no later than the report `asOf`, and is retained independently from `retrievedAt`.
4. Source correction or replacement is detectable; ambiguous or mutable current-value rows remain `UNVERIFIED`.

The first implementation must test whether the existing EastMoney report identifier/document and Tonghuashun dated institution record meet these rules. If either route cannot prove a point's version, keep that point unqualified. Do not add a provider or paid source under this proposal.

## Bounded scenario method using existing inputs

If, and only if, enough FY2026 EPS points pass the point-level version gate:

1. Select the latest eligible estimate per institution as of the report cutoff using the existing consensus selector. Preserve provider, institution, estimate ID, publication time, source candidate, and value-version proof for every selected point.
2. Derive lower, median, and upper EPS cases from the eligible point distribution using a fixed, documented percentile rule. Label them as sourced estimate-distribution cases; do not attach scenario probabilities or describe them as management guidance.
3. Use the same target fiscal year and the same PE method for each case. Derive the PE reference from dated market quotes and directly disclosed annual EPS observations after their publication dates. Use a documented historical PE distribution only if the underlying quote dates, fiscal basis, currency, source locator, and value-version policy all qualify. Otherwise leave the scenario section blocked.
4. Recompute each scenario and a sensitivity grid in deterministic code. Every result carries its source inputs, formula, period, unit, and the conditional nature of holding/using the observed PE reference. The output is not a probability-weighted price target.
5. If qualified EPS rows or a defensible PE reference are absent, produce a blocked diagnostic listing the exact missing inputs and attempted routes. Do not substitute arbitrary growth, multiple, probability, or annualized interim actuals.

This is a candidate route, not a claim that existing source rows already qualify. The current reports remain blocked until the actual source/version evidence passes and both-company live results satisfy the 19-section gate.

## Compatibility and implementation impact

- **Additive estimate contract:** optional field preserves existing callers and serialized estimate points. Missing values default to unverified for the new Company Research qualification path. Existing Earnings Review behavior is unchanged unless that consumer explicitly opts into version qualification.
- **No catalog/schema migration:** reuse existing `earnings_expectation_eps`, `valuation_market_price`, `valuation_eps`, and annual-report publication requirements. No canonical Knowledge writes or Knowledge schema changes.
- **Adapter work:** each estimate adapter must either provide supported per-row version evidence or set `UNVERIFIED`; aggregate source metadata cannot silently upgrade mixed rows.
- **Workflow work:** Variant Perception and scenario builders qualify point-level evidence, preserve the exact estimate-to-source binding, and expose blocked diagnostics. The 19-section gate and attempt budgets remain unchanged.
- **Test impact:** positive tests for immutable versioned points; negative tests for publication-date-only, retrieval-time-only, missing version ID, post-cutoff availability, and mixed verified/unverified rows; selector and calculation tests for fiscal period, unit, percentile boundaries, sensitivity recomputation, and monotonic ordering.
- **Source uncertainty:** the field provides a place to carry proof; it cannot create proof. If existing providers cannot support the verification rules, a separate source/authorization proposal is required before adding a provider or paid data.

## Approval boundary

No code or public contract change is included here. Approval requested is limited to implementing the optional per-estimate value-version contract and the source-gated scenario path above, using existing configured routes only. Provider additions, paid data, new metric identities, Knowledge schema changes, and production Knowledge writes remain outside this approval.
