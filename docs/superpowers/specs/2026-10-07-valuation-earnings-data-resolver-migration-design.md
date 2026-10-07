# Valuation and Earnings DataResolver Migration Design

Status: `EXECUTION AUTHORIZED BY RHL-DL-GOAL-002`

## Goal

Migrate Valuation and Earnings Review source selection and acquisition policy to
the Phase 1 Data Layer and `DataResolver`. Preserve the existing workflow,
Skill, report, compatibility API, and Knowledge production behavior except
where the explicit point-in-time contract below requires evidence to become
unavailable or unverified.

This is Phase 2 of the Data Layer migration. Company, Event, Thesis, Industry,
Daily Intelligence, and Knowledge architecture changes are out of scope.

## Current-state findings

- The Common catalog already defines Valuation market price, annual EPS/BVPS,
  annual-report publication, Earnings EPS/net-profit estimates, management
  communication documents, and SSE/SZSE exchange Q&A.
- Valuation creates `DataRequirement`s but still owns SourcePolicy definitions,
  source operation dispatch, source normalization, and acquisition orchestration
  in `workflows/valuation/basis-evidence.ts` and `workflows/valuation/workflow.ts`.
- Automatic comparable discovery and peer price, financial, and disclosure
  acquisition remain direct AKShare/CNINFO calls in
  `workflows/valuation/automatic-comps.ts`. Candidate identity, cohort/family
  logic, eligibility gates, diagnostics, caps, and Skill validation are domain
  logic and remain in Workflow.
- Earnings Review directly acquires official filings and structured AKShare
  financial data in `workflows/earnings-review/workflow.ts`. Exact-period
  filing selection, period normalization, metric calculation, financial
  quality, report composition, and Knowledge projection remain domain logic.
- Earnings expectation SourcePolicies and provider execution are in Workflow
  modules. Management-document and exchange-Q&A policies are also owned by
  `workflows/management-communication-acquisition` despite that module already
  using generic acquisition contracts.
- `app/runtime/application-runtime.ts` is the explicit composition root and
  currently derives Data Source Administration policy IDs from Workflow-owned
  policies.
- Generic acquisition rejects a known publication timestamp after `asOf`, but
  currently treats successful execution without publication metadata as
  point-in-time safe. That is insufficient for numeric historical values.
- Valuation already distinguishes a market observation date from acquisition
  time and marks annual EPS/BVPS as
  `PUBLICATION_VERIFIED_VALUE_VERSION_UNVERIFIED` for fixed historical `asOf`.
  This conservative domain result must remain intact.
- Earnings structured normalization selects exact fiscal periods but does not
  currently bind each financial row to a verified publication/value version
  at analysis `asOf`.

## Design

### Ownership and composition

1. Common metric definitions and SourcePolicies live under `data/`; no duplicate
   Workflow policy catalog is introduced.
2. Workflows materialize exact requirements from request context and call the
   injected DataResolver. They retain deterministic orchestration, domain
   eligibility, period/fiscal matching, calculations, and report composition.
3. `app/runtime/application-runtime.ts` explicitly binds existing AKShare,
   CNINFO, THS, EastMoney, SSE, and SZSE operations to candidate operation IDs.
   Binding is explicit; there is no provider auto-discovery, service locator,
   or new DI framework.
4. Provider-specific response parsing stays at the Plugin boundary. Domain
   normalization and transformations into existing Workflow/Skill contracts
   stay in their current domain modules unless they parse provider-specific
   wire fields.
5. DataResolver results are adapted to the existing Valuation and Earnings
   result types so public DTOs, reports, `providerOutcome(s)`, source refs,
   diagnostics, and caller compatibility remain stable.

### Requirement inventory

| Research input | Requirement identity | Policy/source intent | Domain behavior retained |
|---|---|---|---|
| Valuation market close | Existing `valuation_market_price` | Existing AKShare historical market operation | Select latest usable close on/before valuation date |
| Valuation annual EPS/BVPS | Existing `valuation_eps`, `valuation_bvps` | Existing AKShare financial-indicator operation | Exact FY row, method eligibility, basis and PIT status |
| Annual report publication | Existing `valuation_annual_report_publication` | Existing CNINFO operation | Resolve report publication proof for the exact issuer/FY |
| Comparable discovery | Add one Common definition only if the existing `peerComparison` payload is represented as an attributable evidence set; proposed ID `valuation_peer_candidate_evidence` | Explicit AKShare peer-comparison operation | Candidate identity, family membership, ordering, validation cap, rejection reasons |
| Comparable market/financial/disclosure inputs | Reuse applicable market, EPS/BVPS, and publication identities with peer subject and exact period | Existing explicit AKShare/CNINFO operations | Peer eligibility and `comps_valuation` validation |
| Official Earnings filing | Existing document definition where semantically compatible; add a distinct Earnings filing definition only if current catalog semantics do not cover exact-period filing selection | Existing official-disclosure Plugin | Exact fiscal-year/period, publication cutoff, full filing/correction/summary selection |
| Earnings structured actuals | Add Common definitions only for existing consumed metric families (revenue, net profit, gross margin, operating cash flow, EPS) | Existing AKShare financial-data operation | Exact current/prior comparable periods, quality checks, derived metrics |
| Earnings analyst EPS/net-profit estimates | Existing `earnings_expectation_eps`, `earnings_expectation_net_profit`, separate metric requirements | Existing THS primary and EastMoney EPS fallback policies | Per-institution identity/deduplication, period match, consensus and same-metric revision |
| Earnings management communication | Existing document and exchange-Q&A definitions/policies | CNINFO IR, SSE interaction, SZSE Hudongyi | Extraction, guidance/QA semantics, period matching, execution analysis |

Every addition to the Common catalog must be justified by one of these live
consumers and its actual payload semantics. Do not add a universal provider
field or pair EPS and net profit into one requirement.

### Point-in-time and provenance contract

The runtime must preserve these as separate facts wherever supplied:

- `analysisAsOf`: consumer cutoff;
- `period`: the fiscal or market observation period the value describes;
- `publishedAt`: source publication/disclosure time;
- `retrievedAt`: actual acquisition time;
- `valueVersion`: evidence that identifies the numeric version available by a
  cutoff, or an explicit unverified state.

Publication before `analysisAsOf` is necessary but does not alone prove that an
aggregator's current numeric value is the value available then. A successful
source response with no publication evidence must never become PIT-safe merely
because it was retrieved successfully. Fixed historical Valuation EPS/BVPS
remain ineligible when only publication date is verified and value-version
evidence is absent. Earnings historical actuals follow the same rule: an exact
reporting period is not proof that the selected numeric version existed by
`analysisAsOf`. Preserve current-snapshot use only where the existing contract
explicitly identifies it as current/unverified and do not describe it as
historical PIT evidence.

Market daily close PIT is based on the observation date, while `retrievedAt`
remains the real request time. Document/estimate PIT remains based on the
record's actual publication time and source identity. Conflict and unavailable
states remain visible; values are not averaged or filled by model estimates.

The implementation should extend the existing Data quality/provenance
contract only as much as needed to represent the value-version evidence and
reason for a failed PIT gate. Do not silently redefine the existing
`pointInTimeSafe` boolean or claim a stronger guarantee than sources provide.

### Compatibility and behavior

- Preserve the existing HTTP/Pi entry points, request types, report sections,
  Skill contracts, calculations, source identity rules, proposal validation,
  Knowledge Gateway/Writer path, and canonical persistence constraints.
- Preserve structured provider outcomes and transport/selection diagnostics;
  DataResolver attempts must map deterministically to their existing public
  representations.
- Keep the Valuation `companyBasic` call only if current compatibility
  telemetry/tests still require it; do not make its result durable evidence or
  an unverified historical input.
- Existing injectable provider clients remain supported at the composition
  boundary for tests and callers. Workflows must not use them to choose a
  provider or execute acquisition directly after migration.
- Source Data Administration continues to list the same active operations,
  with policy source IDs read from the Data catalog.

## Validation and acceptance evidence

- Add focused DataResolver and migration tests for each requirement family,
  fallback/attempt mapping, source identity, missing publication, future
  publication, unavailable source, exact period, and separate retrieval,
  publication, period, `asOf`, and value-version evidence.
- Preserve and extend Valuation basis, market cutoff, automatic comps, Earnings
  filing selection, exact-period financials, expectation consensus/revisions,
  management communication, report, and Knowledge integration regressions.
- Run documented real acceptance scripts only with their required credentials
  and live providers; keep fixture and authenticated live evidence distinct.
- Run focused regression suites, then `npm test`, `npm run typecheck`,
  `npm run client:typecheck`, and `npm run client:build`. Record exact existing
  baseline failures separately from branch regressions.
- Update the Data Layer architecture and migration inventory, and add an
  engineering report with source contract, test evidence, residual gaps, and
  status `IMPLEMENTED / SOL ACCEPTANCE PENDING`.
- Commit and push only the Phase 2 branch. Do not merge Phase 2 into `main`.

## Review focus

1. Approve the conservative numeric value-version PIT rule, including the
   consequence that historic numeric inputs without version evidence stay
   unavailable/unverified for historical conclusions.
2. Confirm the proposed Common catalog treatment for comparable discovery and
   exact-period Earnings filing data after checking their source payload
   contracts during implementation.
3. Confirm that existing source adapters may be explicitly rebound at the
   Runtime composition root while test/caller injection remains compatible.
