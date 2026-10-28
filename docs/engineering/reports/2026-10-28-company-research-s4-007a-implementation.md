# S4-007A Private Scenario Contract Validator

**Task:** `RHL-CQR-P0-19-S4-007A-PRIVATE-CONTRACT-VALIDATOR`\
**Branch:** `codex/company-research-p0-01-06`\
**Frozen starting commit:** `79ed57d35216777b823823d1b7797181d73ce04b`\
**Implementation commit:** `b7ff3ba1e5dcf5f6f5b23160f7052976e6a58b5b`\
**Scope:** private Workflow-domain contract and deterministic validation only.

## Result

Added a private scenario assumption contract and pure validator. The modules are imported only by the new synthetic test file; neither `workflows/company-deep-research/workflow.ts` nor the existing `scenario-assumptions.ts` imports them. No runtime source acquisition, model, independent reviewer, Knowledge write, public schema, SourcePolicy, or atomic Skill method was changed.

The Phase 1 boundary remains fail closed. Inputs can be structurally checked and review fingerprints frozen, but this implementation cannot establish independently verified historical availability or source-use rights. It always returns `reportEligible: false`; it never changes a claimed status into `VERIFIED` or `QUALIFIED`.

## Files and exports

The implementation commit contains three new files (1,262 inserted lines). This report is the fourth authorized file.

| File | Role |
|---|---|
| `workflows/company-deep-research/scenario-method-contracts.ts` | Branded runtime-parsed primitives, source/version/rights evidence, orthogonal observation statuses, research-assumption proposals, scenario bridges, reviews, diagnostics, fixture-only equity/EV inputs. |
| `workflows/company-deep-research/scenario-method-validation.ts` | Pure canonical hashing, parsers, provenance/time/scope/period checks, Bear/Base/Bull structure checks, stale-review check, and fixture-only multi-class equity/EV consistency checks. |
| `tests/workflows/company-scenario-method-contracts.test.ts` | Eleven `FIXTURE_ONLY` Node tests. No company estimate or product data is embedded. |
| `docs/engineering/reports/2026-10-28-company-research-s4-007a-implementation.md` | Implementation and validation record. |

Validator exports:

- `hashCanonicalScenarioValue`, `parseScenarioNonEmptyString`, `parseScenarioSha256`, `parseScenarioIsoDate`, `parseScenarioIsoInstant`
- `validateScenarioMethodContract`, `scenarioMethodReviewPacketHash`, `validateReviewFreshness`
- `getHistoricalTrustAnchorStatus`, `preserveIndependentStatusDimensions`
- `validateEquityMarketInput`, `validateEnterpriseValueBridgeConsistency`

The main result has a literal `reportEligible: false`. Review inputs can only remain `REVIEW_REQUIRED`, `UNAVAILABLE`, `REJECTED`, or `STALE_REVIEW`; there is no deterministic reviewer-pass or publication-eligibility API.

## Evidence and temporal trust boundary

The reviewed source and provider structures expose caller/provider metadata, content hashes, and rights booleans; they do not provide an approved signature verifier, externally anchored historical-version registry, or rights authority for this contract. No approved trust-root path was available to bind `trustRoot`, `proofStatus`, publication time, or rights assertions to an independently controlled authority. The private validator therefore uses an empty allowlist and exposes this boundary through `getHistoricalTrustAnchorStatus()`.

For a fact, the validator recomputes the immutable-content SHA, checks that the exact excerpt is within that content and contains the literal raw token, reproduces the per-row binding hash, and compares the source locator, raw and normalized values, conversion, metric, period, scope, unit, currency, share basis, rights text hash, and observation timestamps across the packet. These checks detect internal mismatch; they do not prove who published the content or that a claimed version existed by T0. Local hashes, IDs, signatures-as-strings, status labels, and caller-declared trust roots remain claims. Thus even internally consistent proof packages return `valueVersionStatus: UNVERIFIED`; missing proof is `UNAVAILABLE`; an explicit conflict remains `CONFLICTED`.

The validator keeps `originKind`, value-version status, and consumer eligibility separate. A historical version that is independently verified but unsuitable for the requested consumer can remain `VERIFIED` with `eligibility: UNAVAILABLE`; this private slice has no independent verifier to produce that first condition. In this implementation, structural relevance cannot upgrade eligibility beyond `UNVERIFIED`.

`observedAt`, carrier `sourcePublishedAt`, `retrievedAt`, exact `valueVersionAvailableAt`, and snapshot capture/seal timestamps are distinct. It checks availability and publication against `analysisAsOf`, and for a sealed snapshot enforces capture ≤ seal ≤ analysisAsOf plus capture ≤ retrieval. A retrieval after T0 can be structurally consistent only when the claimed exact immutable version was available by T0; without the absent external proof it remains unverified. A late capture with a forged earlier seal is rejected by ordering checks.

## Scope and deterministic checks

- `ScenarioHorizon` takes an explicit analysis cutoff, T0/T1 mode, base period, target period, target fiscal year, currency, financial scope, method, driver set, and source snapshot hash. No year is hard-coded.
- FY observations must cover January 1–December 31; H1 YTD must cover January 1–June 30. Derived arithmetic requires same-period, same-scope, same-currency inputs and is limited to `OBSERVED_ARITHMETIC_ONLY`; it cannot annualize H1 or implement a forecast/FCFF bridge.
- Scenario structure requires ordered Bear/Base/Bull cases, one consistent horizon and exact driver set, explicit proposal authors/mechanisms/triggers, located input/counterevidence/calibration refs, and resolved adjustment metadata. This validates shape only; it neither supplies assumptions nor computes forecasts.
- Hashes use versioned canonical JSON, recursively sorted object keys, preserved array order except explicitly modeled sets, and SHA-256. The review fingerprint covers horizon, observations and value-version proofs, proposals/scenarios, rights, units/share basis, method and rubric versions. Any changed input changes the packet hash.
- Multi-class share inputs are fixture-only. Required classes must all have quotes and FX at the selected cutoff. Listed-unit conversion is explicit; post-cancellation issued shares are used as-is, pre-cancellation shares require proven cancellations, treasury/repurchased-held shares are handled once, and target-date diluted shares remain separate from market-cap shares.
- EV consistency requires every amount to be known with refs, explicit zero, not applicable with a reason, or unavailable with a reason. Net-debt basis rejects a second cash subtraction; leases cannot be counted both within gross debt and as a separate claim; class equity allocation must reconcile to the total. No EV or per-share price is generated.

## Validation evidence

Commands were run against implementation source commit `b7ff3ba1e5dcf5f6f5b23160f7052976e6a58b5b`.

| Command | Result |
|---|---|
| `node --import tsx --test tests/workflows/company-scenario-method-contracts.test.ts` | 11 passed, 0 failed. Covers missing-vs-zero, status orthogonality, late availability, late retrieval with forged early seal, source/raw/content/rights binding, FY/H1 period label, parameterized target year/driver completeness, canonical review freshness, multi-class quote and share-count treatment, net-debt/cash double counting, and no report-eligibility escape. |
| `node --import tsx --test tests/workflows/company-scenario-assumptions.test.ts tests/workflows/company-valuation-sections.test.ts` | 26 passed, 0 failed; existing assertions unchanged. |
| `npm run typecheck -- --pretty false` | Passed. |
| `npm run client:build` | Passed; Vite emitted its existing large-chunk advisory (>500 kB). |
| `npm run test:node` | 3,233 total; 3,212 passed; 21 failed. The 21 failure titles match all 21 entries in `company-research-p0-19-close-002-gate0-baseline.json`; 0 added and 0 disappeared. Historical recorded run was 3,189 total / 3,168 passed / 21 failed; the current discovered suite is larger. This suite is not green. |
| `npm run client:test` | 223 total; 218 passed; 5 failed. The failures are the same five baseline identities in `company-research-p0-19-close-002-gate0-baseline.json`; 0 added and 0 disappeared. This suite is not green. |

The frozen baseline is failure-identity evidence, not a claim that either full suite passes. No actual-company run or model/reviewer execution was invoked by this task.

## Preservation and delivery

Before/after SHA-256 matched for all five pre-existing dirty evidence files:

| Existing user file | Preserved SHA-256 |
|---|---|
| `tests/validation/evidence/RHL-EXEC-003-A-004-FIX-002-thesis-authorized.json` | `7252fd35dec70403fd6bb8b3edc6ffadd25211fd158461a1dde30458bf07f442` |
| `tests/validation/evidence/RHL-EXEC-003-A-004-FIX-003-event-readonly.json` | `ef0e7475e0464ca1e3950feb348b0d3ed6dc7383e32200faa3fc413207bc641a` |
| `tests/validation/evidence/RHL-EXEC-003-A-004-FIX-003-industry-readonly.json` | `12c951be5ca88fb35b155187055b0a15a50d212133c9b68088c0d1674500c0fa` |
| `tests/validation/evidence/RHL-EXEC-003-A-004-FIX-003-thesis-references.json` | `61cd5cf5b24a7f0fc10746e0269a845d6e29464614c43738d7585ec075fb4670` |
| `tests/validation/evidence/company-quality-pi-default-deny.json` | `4c02302a5b31cec6d93b9298e06a76bd0b834b4bacc914670c7fd06aa6300038` |

The full Node suite regenerated timestamps in four existing evidence JSON files. Those timestamps were restored from the pre-run hashes; all five user-file hashes above match the frozen pre-run values. The paired BYD/Dongshan analysis sidecars also retained their recorded hashes (`60c877…de35` and `725881…e98b3`). The earlier report records the remaining sidecar and Knowledge-integrity hashes; those artifacts were not staged or written by this change.

The implementation commit stages only the three authorized code/test files. The report is committed separately so it can cite the tested implementation SHA. All commits are limited to `codex/company-research-p0-01-06`; no merge to `main` is authorized by this task.

## Stop point

**Phase 1 Contract/Validator Ready for Architecture Review.** This is not `S4 Implemented`, not 19/19, and not P0 accepted. T1/T0 historical proof verification still needs a separately approved external trust/rights adapter. Economic scenario calculations, atomic Skill methodology, independent review lifecycle, production workflow wiring, actual company estimates, report publication eligibility, and Knowledge writes remain outside this authorization.
