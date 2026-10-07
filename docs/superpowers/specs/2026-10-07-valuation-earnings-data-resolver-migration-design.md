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

### Source-level migration matrix

This matrix records the current source audit before implementation. “No policy” means source choice currently bypasses the Data-owned policy catalog; it is not permission to preserve that choice in Workflow.

| Current caller | Current source/adaptor | Meaning | Existing metricId / SourcePolicy | Existing PIT validation | Required normalization | Current consumer | Target DataResolver path | Compatibility constraints |
|---|---|---|---|---|---|---|---|---|
| `workflows/valuation/workflow.ts::acquire` | AKShare `historicalMarketData` via `akshare-historical-market-data` | Issuer and peer daily close timeseries | `valuation_market_price`; Workflow declares `valuation-market-price-eastmoney` (`FIRST_VALID`) | Selected `priceDate`; `dailyCloseAvailableAt <= analysis asOf`; actual `retrievedAt` retained | Plugin adapter parses daily rows; Workflow maps close/date into `ValuationMarketObservation` | Valuation basis/eligibility, source evidence, automatic comps | Existing Common timeseries ID and Data-owned policy; explicit AKShare executor | Preserve latest usable close at/before valuation date and source/retrieval timestamps; market unavailable stays blocked |
| `workflows/valuation/workflow.ts::acquire` | AKShare `valuationFinancialIndicators` (legacy fallback `financialData`) | Annual EPS and BVPS basis rows | `valuation_eps` / `valuation-eps-eastmoney`; `valuation_bvps` / `valuation-bvps-eastmoney`, each `FIRST_VALID` | Exact report date/FY; publication proof required; fixed historical cutoff currently yields `PUBLICATION_VERIFIED_VALUE_VERSION_UNVERIFIED`, not eligible PIT | Plugin maps `REPORT_DATE`, `EPSJB`, `BPS`; Workflow selects row and maps basis | PE/PB method eligibility, basis evidence and Skill inputs | Existing separate Common EPS/BVPS requirements/policies with exact FY and subject; explicit AKShare executor | Keep zero/missing distinction, selected basis, method eligibility, provider outcome, diagnostics, source refs; never upgrade version uncertainty |
| `workflows/valuation/workflow.ts::acquire` | CNINFO `resolveAnnualReportPublication` | Official annual-report publication date and evidence URL for issuer/FY | `valuation_annual_report_publication`; Workflow declares `valuation-annual-publication-cninfo` (`FIRST_VALID`) | `officialPublishedAt <= analysis asOf`; future publication unavailable; does not prove aggregator numeric version | CNINFO Plugin returns report title, fiscalYear, publication timestamp, URL, announcement identity | Valuation basis evidence and annual-value PIT gate | Existing Common document ID/policy in Data; explicit CNINFO executor | Keep statutory source authority and exact issuer/FY; preserve publication versus value-version distinction |
| `workflows/valuation/automatic-comps.ts::resolveAutomaticComps` | AKShare `peerComparison` by GROWTH, VALUATION, DUPONT, SCALE family; target/peer scale queries | Candidate issuer identities, cohort-family observations, and size/profile evidence | No Common metric or SourcePolicy; direct provider decisions in Workflow | Candidate membership is not numeric basis PIT proof; target/peer market and financial facts have separate PIT gates | Plugin parses family/identity rows; Workflow aggregates family evidence, exact identity, profile, scale, cohort consensus | Candidate filtering, stable ordering, rejection diagnostics, 12-expensive-validation cap | Composite attributable evidence requirement only if catalog kind and payload inspection validate it; otherwise an explicit set of domain data requirements. Selection policy belongs to Data either way. | Do not move candidate consensus, comparability gates, ordering, rejection reasons, caps, or `comps_valuation` Skill validation into Data |
| `workflows/valuation/automatic-comps.ts::resolveAutomaticComps` | AKShare `historicalMarketData`, `valuationFinancialIndicators`; CNINFO annual report lookup per selected peer | Peer price, peer annual EPS/BVPS, and official disclosure for the subject's basis FY | Reuse `valuation_market_price`, `valuation_eps`, `valuation_bvps`, and `valuation_annual_report_publication`; current peer calls have no Data policy | Peer market observation date must be available at valuation cutoff; peer annual basis requires exact FY and the same conservative value-version gate | Existing market/financial/CNINFO normalizers and peer-specific source evidence | Peer method eligibility and comparable report/cross-check diagnostics | Reuse Common requirements with peer ticker/company subject and exact valuation period; explicit adapters | Keep peer rejection and diagnostic source refs, basis FY identity, source ordering, validation cap, and source refs unchanged |
| `workflows/earnings-review/workflow.ts::acquireOfficial` | Official disclosure acquisition plugin loop (CNINFO through Plugin discover/fetch/normalize) | Exact-period filing, correction, or summary evidence | No Earnings Common ID or SourcePolicy; direct provider loop | Candidate `publishedAt <= analysis asOf`; exact fiscal year/period/title; correction/summary preference rules | Provider-specific discovery/fetch/parse in Plugin; deterministic exact-period selection stays Workflow | Filing selection, Earnings Skill excerpts, report source refs | Add a filing Common identity only after confirming distinct semantics from annual-publication and management-document definitions; Data policy chooses source and Plugin returns attributable normalized filing candidates | Preserve filing precedence, diagnostics, official source identity, provider outcomes, exact-period blocking |
| `workflows/earnings-review/workflow.ts::acquireStructured` | AKShare `financialData` | Exact current/prior period actual revenue, net profit, gross margin, operating cash flow, EPS | No actuals Common IDs or SourcePolicy | Exact report-period match only; `asOf` is not passed; provider `NOTICE_DATE` is not currently applied; value-version proof absent | `normalizeAkshareFinancialData`, `normalizeFinancialQualityData`; aliases and calculations currently span Skill/Workflow | Earnings metrics, financial quality, actual-vs-consensus and typed Skill inputs | Distinct Common identities/requirements only for consumed actual metric families (or a proven composite); Data/Plugin parses provider fields and enforces evidence quality; Workflow maps verified values | Keep exact current/prior periods, derived calculations, quality summary and explicit unavailable; historic numbers without version proof remain unverified |
| `workflows/earnings-review/expectations-acquisition.ts::AkshareEarningsExpectationsSource.acquire` | AKShare THS `profitForecastThs` primary; EastMoney `researchReportEm` fallback, with legacy report API compatibility path | Institution-level EPS or net-profit forecasts for fiscal period | Existing `earnings_expectation_eps` / `earnings_expectation_net_profit`; Workflow declares `earnings-expectations-source-ladder-v0.1` (`FIRST_VALID`), THS supports both and EastMoney EPS only | Each estimate `publishedAt <= analysis asOf`; exact fiscal period, units, and institution identity required | THS/EastMoney provider parsers currently in Workflow modules; map into `EstimatePoint` and attributable source | Consensus, actual-vs-consensus, prior estimate and same-metric revision bridge | Existing per-metric Common IDs/policy in Data; explicit THS, EastMoney AKShare, and legacy adapter bindings; move provider wire parsing to Plugin | EPS/net-profit are separate requirements; preserve THS→EastMoney order, EastMoney EPS-only support, institutional dedup, estimate IDs, source refs, and provider outcomes |
| `workflows/earnings-review/expectations-acquisition.ts` → `workflow.ts::resolveEarningsExpectations` | Resolved estimate points from THS/EastMoney | Prior/current estimates paired by same metric, institution, fiscal period, unit, and ordered publication times | Existing estimate metric IDs; no separate revision metric/policy | Both estimates independently pass publication cutoff; pair remains same metric/institution/period/unit | No additional provider normalization; deterministic pair validation/bridge remains research logic | Revision bridge and consensus interpretation | Keep in Workflow/Skill as consumer logic after DataResolver supplies attributable estimate points | Do not cross-join periods/institutions/metrics or change revision interpretation |
| `workflows/earnings-review/management-communication.ts` via `workflows/management-communication-acquisition/workflow.ts` | CNINFO IR documents; SSE E-Interaction; SZSE Hudongyi/AKShare (with answer enrichment) | Management communications and exchange Q&A evidence | Existing `management_communication_documents`, `exchange_qa_sse`, `exchange_qa_szse`; Workflow declares `d2-001-management-communication-documents`, `d2-001-sse-exchange-qa`, `d2-001-szse-exchange-qa` (`FIRST_VALID`) | Request `asOf`, source publication timestamps where available, and source retrieval time; extraction-level PIT remains separately validated by Workflow | Provider response normalization/dedup in management acquisition module; ReasoningExecutor extraction and `GuidanceRange` validation stay downstream | Guidance, commentary deltas, QA clusters, execution analysis, Earnings report sections | Move source policies and source execution behind DataResolver/explicit Plugins; retain typed communication evidence for Workflow extraction | Preserve exchange resolution, bounded lookback, answer enrichment, document/QA dedup, source attribution, unavailable diagnostics, and guidance/QA semantics |

Every new Common definition must be justified by this matrix and live consumer semantics. Automatic peer payloads must be inspected before choosing a composite catalog kind/identity; do not invent a generic peer field solely to make the path appear migrated. Do not register unrelated Common or industry-specific fields.

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
