# RHL-DATA-CLOSURE-001 — D0–D2 Data Capability Closure Audit & D3 Priority Proposal

Audit date: 2026-09-23 (Asia/Shanghai)
Baseline: main / origin/main at 1bb585767ff5037f4c01718f692e30c4698e0930
Audit branch: codex/data-closure-001-d0-d2-audit
Audit worktree: C:\Users\Administrator\Desktop\ResearchHub_Lite_worktrees\DATA_CLOSURE_001
Scope: source-level audit and design proposal only. No D3 implementation is included.

## 1 Executive Conclusion

### Decision summary

ResearchHub has a real Workflow/Skill/Plugin/Knowledge foundation for the requested research products. The D0–D2 work is not a “no data” system and old gap matrices are not current product truth. The current position is:

- D0 is implemented as a Workflow-owned acquisition, fallback, provenance, authority, numeric-truth, and point-in-time contract in workflows/research-data-acquisition/ and docs/engineering/specs/2026-09-22-data-source-governance-foundation-v0.1.md.
- D1 Earnings Expectations is the strongest current data closure. Its normal resolver path has a documented real AKShare/THS acceptance with ten usable sources, ten institutions, twenty fiscal-year points, and one EPS consensus snapshot. See docs/governance/EXPECTATION-SOURCE-001-CLOSURE.md and docs/engineering/specs/2026-09-22-earnings-expectations-acquisition-v0.1.md.
- D2 Management Communication has acquisition, extraction, integration, PIT, Q&A, commentary, guidance, KPI, and execution contracts wired into normal Earnings Review. Its offline product path is covered; its real provider/model path is deliberately gated by RESEARCHHUB_RUN_REAL_D2_003=1, and the current script does not claim a live pass. See scripts/acceptance-management-communication-d2-003-real.ts.
- Company, Earnings, Valuation, Industry, Event, Thesis/Red Team, and Daily / Continuous have distinct callers and bounded output contracts. Their main remaining limitation is the availability and shape of attributable public inputs, not an absent methodology layer.
- Valuation is usable for a bounded deterministic scenario view when its current market and financial basis is available. The existing historical-market path already selects the latest eligible price on or before the valuation date; its remaining concern is reliability and evidence verification, not a new price-acquisition build. The current product explicitly defers DCF and does not provide a normal caller path for peer-universe construction. Skill-level DCF calculations and the comps Skill must not be mistaken for a product-ready DCF/comps data path.
- Industry has eight implemented semantic modules and a seven-provider composition in the normal Service path, but real product evidence is inconclusive or externally blocked. Industry operating data, capacity, utilization, pricing, and company exposure remain the largest structured data deficit.
- Daily / Continuous is a functioning bounded signal-to-brief path. It is a quality and breadth problem rather than a universal blocker: public signals can be ingested, but broad coverage, stable PIT dates, institutional activity, consensus changes, and industry operating observations are uneven.

### Answers to the forcing questions

**A. What is ready?** Product workflows, deterministic calculations, provenance contracts, quality gates, Knowledge Gateway boundaries, offline fixtures, and several real or gated acquisition seams are ready. D1 automatic expectations is the only D0–D2 data closure with a documented real normal-path acceptance in the current repository history.

**B. What is not ready?** A reusable, attributable data basis for share capital/corporate actions, peer/comparable inputs, ownership/holdings, industry operating KPIs, capacity/production/inventory, commodities, and stable broad daily coverage is not closed.

**C. What is the Industry constraint?** Methodology is substantially present. The dominant missing capability is structured, dated, target-relevant evidence for all eight modules, especially market size, supply/demand, capacity/utilization, pricing, chain economics, technology milestones, and company mapping.

**D. What is the Valuation constraint?** Valuation code is deterministic and already has a market-price path plus a partial EPS path. The concrete closure gap is the source-backed `ValuationBasis`: BVPS, EBITDA, cash/debt-derived `netDebt`, and a time-aligned share basis, with method-specific unavailable diagnostics rather than manufactured inputs. D1 is reused unchanged; peers and DCF remain separate/deferred concerns.

**E. What remains in Earnings?** Actual filing and financial normalization are implemented; D1 estimates are real-gated and accepted; guidance, segment KPI, management commentary, Q&A, and execution are contractually integrated but still gated by live source/model availability. This is an evidence-availability issue, not a reason to start another broad Earnings project.

**F. What blocks Thesis / Red Team?** The red-team method is implemented and its semantic product path has a Real Pi fixture acceptance. A normal run still needs a canonical active thesis, company coverage, attributable recent signals, official/supporting source material, and stable lookback dates. Missing signals and source coverage block evidence quality; they do not invalidate the methodology.

**G. What does Daily / Continuous need?** More breadth and temporal stability for company news, official announcements, institutional activity, consensus changes, industry operating data, commodity data, and capital-market signals. The existing signal pipeline is not blocked by the absence of a new generic provider framework.

**H. What should D3 do?** The recommended D3 forcing function is a narrow, attributable A-share ValuationBasis evidence closure on the existing Valuation Workflow. It should close only the method-required numeric fields that are not already closed: BVPS, EBITDA, source-backed cash/debt with deterministic `netDebt`, and a time-aligned share basis, while reusing and verifying existing price and EPS paths. It should not create a generic Company/Valuation evidence layer, reacquire price unnecessarily, build peers, or create a new provider framework, crawler layer, or second Earnings project.

## 2 Audit Method

### Evidence and scope

The audit inspected the exact baseline source, tests, validation harnesses, product callers, D0 governance, D1 expectations, D2 management communication specifications, and source catalog. Principal evidence:

- product registry and caller routing: app/services/workflow-registry.ts, app/services/research-dispatch-service.ts, app/services/research-service.ts, app/runtime/application-runtime.ts, app/runtime/server.ts, app/pi/tools.ts;
- acquisition contracts and seams: plugins/research-acquisition/contracts.ts, akshare.ts, official.ts, gdelt.ts, rss.ts, the industry plugins, and plugins/daily-intelligence/;
- D0/D1/D2 workflows: workflows/research-data-acquisition/, workflows/earnings-review/, workflows/management-communication-acquisition/, workflows/management-communication-extraction/, and workflows/earnings-review/management-communication.ts;
- Skills: skills/company-research/, skills/earnings-review/, skills/valuation/, skills/comps_valuation/, skills/industry-research/, skills/event-research/, skills/thesis-red-team/, and skills/daily-intelligence/;
- tests and validation: tests/workflows/, tests/skills/, tests/plugins/, tests/validation/, and tests/validation/evidence/;
- architecture and governance: docs/engineering/ and docs/governance/.

This is an audit of current code and evidence, not a live-provider re-run. Offline fixtures, mocks, hardcoded test rows, model-generated numbers, schema-only inputs, and test injection prove executable contracts only. They are not counted as real data.

### Exact status vocabulary

| Status | Meaning |
|---|---|
| PRODUCT_READY_REAL | Normal product path, attributable real source, deterministic validation, and real acceptance evidence are all present. |
| PRODUCT_READY_GATED | Normal product path and real-source seam exist; credentials, network, model, provider, or an explicit live acceptance switch gates execution, so current evidence is not a full live pass. |
| EXECUTABLE_FIXTURE_ONLY | Method is executable and semantically validated with fixtures/mocks, but no current real-source product acceptance is established. |
| SOURCE_AVAILABLE_UNWIRED | Concrete source or Skill capability exists, but it is not on the relevant normal product path. |
| DATA_GAP | Consumer and methodology exist, but the required attributable data is absent or materially insufficient. |
| METHOD_GAP | Required methodology or deterministic contract is absent or incomplete. |
| NOT_CURRENT_PRODUCT_SCOPE | Explicitly deferred or excluded from the current product, even if related code or documentation exists. |

### PIT, numeric truth, and authority

- PIT_SAFE means source/event/publication time can be validated against asOf or analysisAsOf.
- PIT_PARTIAL means some paths carry dates, but one or more source families have unknown, retrieval-only, or insufficient event dates.
- PIT_UNSAFE means a normal path can use a future or undated observation without deterministic rejection.
- AUTHORITATIVE_NUMERIC is required for prices, financial values, estimates, shares, ratios, and valuation inputs. Numeric extraction must bind to source text or structured source data; model arithmetic is not truth.
- EVIDENCE_BACKED_NUMERIC is a source-backed reported number with provenance that is not itself statutory truth.
- SEMANTIC_QUALITATIVE covers interpretation, comparison, risk, thesis, and narrative synthesis; it cannot silently introduce numeric facts.
- Authority is original publisher authority, not retrieval tool: S0_STATUTORY > S1_OFFICIAL > S2_PROFESSIONAL > S3_AGGREGATOR > S4_COMMUNITY. D0 records originAuthority, originPublisher, and retrievalProvider separately.

## 3 Current Product Capability Map

The registry in app/services/workflow-registry.ts exposes Company Research, Industry Research, Earnings Review, Valuation, Event Research, Thesis Red Team, Thesis Lifecycle, and Daily Intelligence. ResearchService is the normal service boundary; Knowledge Production Gateway remains the only canonical mutation route.

### Method matrix

| Product | Method / capability | Owner Skill | Owner Workflow | Implementation path | Input contracts | Truth class | Normal consumer | Status | Real source | Fallback | PIT | Authority | Normal-path wiring | Fixture evidence | Real acceptance evidence | Data limitation | Method limitation |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Company | company profile and 19-section report | company-research | company-deep-research | Service → acquisition → Skill → gate → Gateway | symbol, name/exchange, asOf | semantic + evidence-backed numeric | HTTP research-company; Pi research_company | PRODUCT_READY_GATED | CNINFO, GDELT, AKShare | explicit gaps | PIT_PARTIAL | S0/S1/S2/S3 | application-runtime.ts and ResearchService | tests/workflows/company-deep-research.test.ts | no current Company real product gate found | financial/market/basic rows can be empty; no complete peer/ownership bundle | deterministic baseline is intentionally shallow; semantic model output remains gated |
| Company | business model, segment, product, technology | business_model_map, unit_economics | company-deep-research | Company Skill sections and bounded synthesis | attributable sources and structured company inputs | semantic | Company report | PRODUCT_READY_GATED | CNINFO/company IR when returned | gap section | PIT_PARTIAL | S0/S1/S2 | report methodology | company fixture tests | none | segment and product detail are document-dependent | no dedicated segment reconciliation contract |
| Company | financial quality and growth drivers | financial_quality_analysis, business_driver_analysis | company-deep-research | AKShare financial rows plus Skill | exact rows, units, asOf | authoritative/evidence-backed numeric | Company report | PRODUCT_READY_GATED | AKShare plus filing | unavailable fields | PIT_PARTIAL | S3 adapter / S0 filing | AKShare passed by runtime | tests/skills/financial-quality-analysis.test.ts | no Company real acceptance | indicator route is not a complete statement/segment warehouse | model may interpret only supplied data |
| Company | management and capital allocation | management_execution, capital_allocation_review | company-deep-research | Skill methodology in Company report | official/IR evidence | semantic | Company report | SOURCE_AVAILABLE_UNWIRED | D2 management sources | report gap | PIT_PARTIAL | S0/S1 | no D2 resolver on Company path | Skill unit tests | D2 real gate is Earnings-only | no automatic management binding for Company | cross-workflow reuse deliberately deferred |
| Company | company valuation inputs | valuation, comps_valuation | company-deep-research | Company Skill returns insufficient-data valuation note | verified metric and attributable peers | numeric | Company report | DATA_GAP | existing Valuation basis seam; comps caller input | unavailable note | PIT_PARTIAL | S3 or higher | no complete Company valuation bundle | tests/skills/company-research.test.ts | none | Company is not a mandatory D3-001 consumer; peers and historical share basis remain separate gaps | no automatic target-price method |
| Earnings | statutory actuals and exact-period filing selection | earnings-review | earnings-review | CNINFO discovery → exact-period selection → normalized source | symbol, FY, period, asOf | authoritative numeric | Earnings Review | PRODUCT_READY_GATED | CNINFO official disclosure | blocked/unavailable | PIT_SAFE | S0_STATUTORY | startEarningsReview | tests/workflows/earnings-review.test.ts | provider smoke had no usable exact-period case | source availability varies by issuer/period | full live product gate not current D2 acceptance |
| Earnings | financial normalization, variance, quality | earnings-review, financial_quality_analysis | earnings-review | AKShare financialData → deterministic calculations | exact period, rows, units, asOf | authoritative numeric | Earnings Review | PRODUCT_READY_GATED | AKShare plus filing | unavailable metrics | PIT_PARTIAL | S3/S0 | automatic in workflow | earnings review tests ER38–ER42 | M3A fixture Pi evidence; no current live provider pass | statement/segment breadth and empty responses | financial quality is report-only |
| Earnings | estimates, revisions, consensus | consensus_expectations_analysis, estimate_revision_analysis | earnings-review | D0 acquisition → AKShare THS/EastMoney ladder → resolver | company, metric, target FY, analysisAsOf | authoritative numeric | automatic Earnings resolver | PRODUCT_READY_REAL | AKShare THS/EastMoney | THS → EastMoney; no LLM numeric fallback | PIT_SAFE | S3_AGGREGATOR | automatic-expectations.ts | D1 workflow tests | D1 closure records normal real acceptance | annual EPS/net profit and rolling horizons limited | consensus requires minimum two institutions and valid cutoff |
| Earnings | guidance and comparisons | guidance_analysis | earnings-review | D2 extraction projection → integration | source, publication, metric, period, range | evidence-backed numeric + semantic | Earnings Review | PRODUCT_READY_GATED | CNINFO/official disclosure | absent guidance | PIT_SAFE when source dated | S0/S1 | resolveManagementCommunication | earnings-management-communication tests | D2 script gate-disabled by default | issuer guidance sparse/source-dependent | strict source/period/range matching |
| Earnings | segment KPI and commentary delta | earnings-review, management-communication-extraction | earnings-review | D2 acquisition/extraction → projection | source spans, publication, period, metric/unit | evidence-backed numeric/semantic | Earnings Review | PRODUCT_READY_GATED | CNINFO IR/filing/Q&A | partial/unavailable | PIT_SAFE | S0/S1 | normal Earnings path calls resolver | D2 tests and ER128 | no current real D2 acceptance | no stable segment taxonomy | no common external KPI taxonomy |
| Earnings | Q&A, outlook, execution | management-communication-extraction, management_execution | earnings-review | D2 source operations → extraction → integration | source spans, answer time, topic, commitment | semantic + numeric | Earnings Review | PRODUCT_READY_GATED | CNINFO IR and SSE/SZSE Q&A | no source, no assessment | PIT_SAFE if dated | S0/S1 | D2-003 normal path | D2 tests | real source/model path gated | coverage varies | bounded, not universal IR ontology |
| Valuation | market price and valuation date | valuation | valuation | AKShare `historicalMarketData()` → market observation → latest eligible price <= valuationDate | symbol, asOf, market rows | authoritative numeric | Valuation Service / analyze-valuation | PRODUCT_READY_GATED | existing AKShare market route | blocked if price absent | PIT_PARTIAL | S3 adapter | Service and runtime | valuation workflow tests | provider smoke transport blocked/empty | existing path needs reliability/evidence verification; this is not new D3 price acquisition | basis rejects future/as-of inconsistency |
| Valuation | PE/PB/EV_EBITDA scenarios | valuation, scenario_valuation | valuation | basis → method eligibility → assumptions → code-owned arithmetic | price, fiscal basis, EPS/BVPS/EBITDA, shares, netDebt | authoritative numeric | Valuation report | PRODUCT_READY_GATED | existing market path plus partial financial path | method-specific ineligible | PIT_SAFE when basis passes | S3/S0 | normal valuation path | deterministic and workflow tests | Real Pi fixture gate with deterministic data | BVPS, EBITDA, cash/debt-derived netDebt, or time-aligned shares may be absent | model cannot supply arithmetic |
| Valuation | comparable-company valuation | comps_valuation | valuation | executeCompsValuation plus crosscheck | caller peer candidates, source refs, period, units | numeric | only callers injecting comps | SOURCE_AVAILABLE_UNWIRED | no normal peer acquisition | reject weak peers | PIT_SAFE by candidate contract | source-dependent | optional workflow input; not normal HTTP/Pi input | tests/skills/comps-valuation.test.ts | no normal real peer acceptance | peer universe/market metrics absent; defer to D3-002/subsequent | deterministic math exists; acquisition does not |
| Valuation | DCF/reverse DCF | dcf_valuation, reverse_dcf_expectation_decode | none in current method enum | Skill calculation primitives only | forecasts, WACC, debt, cash, terminal assumptions | numeric | none in current scope | NOT_CURRENT_PRODUCT_SCOPE | no normal source bundle | none | PIT_SAFE required | source-dependent | ValuationMethod only PE/PB/EV_EBITDA | deterministic calculation tests | no product acceptance; report says DCF deferred | forecast cash flows/WACC not acquired | product contract excludes DCF |
| Valuation | valuation cross-check | valuation_crosscheck | valuation | scenario base vs optional comps | compatible method results and basis metadata | control + numeric | Valuation report | PRODUCT_READY_GATED | upstream sources | no averaging; conflicts surfaced | PIT_SAFE if inputs safe | source-dependent | workflows/valuation/crosscheck.ts | valuation tests | fixture/Real Pi fixture only | second method often unavailable | cross-check is not acquisition |
| Industry | definition and scope | industry-research | industry-deep-research | design → waves → module analysis | name, aliases, search terms, asOf | semantic + numeric | Industry Service / research-industry | PRODUCT_READY_GATED | CNINFO, MIIT, gov.cn, CPCA, Eastmoney, AKShare | gap-only | PIT_PARTIAL | S0/S1/S2/S3 | seven-provider composition | industry workflow/Skill fixtures | real model/provider evidence inconclusive | definition and target relevance vary | design and validation implemented |
| Industry | market size and growth | industry-research | industry-deep-research | module analysis and synthesis | dated size, volume/value, growth basis | numeric | Industry report | DATA_GAP | MIIT/official reports when available | explicit gap | PIT_PARTIAL | S0/S1/S2 | candidates wired, no stable series | module tests | no trustworthy real production result | fragmented definitions and missing series | no cross-source normalization |
| Industry | supply/demand, capacity, utilization, pricing | industry_supply_demand_cycle | industry-deep-research | module analysis and synthesis | production, capacity, utilization, inventory, price | numeric | Industry/Daily/Thesis | DATA_GAP | MIIT/associations/company docs | gap-only | PIT_PARTIAL | S0/S1/S2 | no shared time-series contract | supply-demand Skill tests | no live product acceptance | operating series and commodities absent | methodology cannot invent observations |
| Industry | chain and value capture | industry_supply_demand_cycle, market_structure_analysis | industry-deep-research | module plus synthesis | chain nodes, pricing/margin evidence | semantic | Industry report | PRODUCT_READY_GATED | documents and filings | gap/alternative view | PIT_PARTIAL | S0/S1/S2 | wired module | Skill tests | fixture/inconclusive real evidence | upstream/downstream coverage uneven | relation admission needs evidence |
| Industry | competitive landscape and company mapping | competitive_market_map | industry-deep-research | module → proposals → Gateway | named companies, exposure, comparability | semantic + numeric | report/Knowledge | PRODUCT_READY_GATED | filings/IR/Eastmoney board routes | no unsupported exposure | PIT_PARTIAL | S0/S1/S2/S3 | composition wired | Skill tests | no trustworthy real portfolio acceptance | board membership is not revenue exposure | evidence gates are strict |
| Industry | technology evolution and risk | industry-research, catalyst_map | industry-deep-research | module analysis and synthesis | dated milestones, products, risks | semantic | Industry report | PRODUCT_READY_GATED | MIIT/company/professional sources | gap-only | PIT_PARTIAL | S0/S1/S2 | method/report wired | industry tests | model/provider gate unresolved | dates and target relevance sparse | synthesis cannot create milestones |
| Event | anchor resolution and source roles | catalyst_map, event-research | event-research | anchor → CNINFO/GDELT → roles | explicit anchor, company, asOf, window | semantic + evidence | Event Service / research-event | PRODUCT_READY_GATED | CNINFO/GDELT/Daily Signal | blocked on mismatch | PIT_SAFE | S0/S1/S2 | Service path wired | event tests | Real Pi fixture gate; provider smoke separate | provider may be empty/rate-limited | bounded event identity/role validation |
| Event | verified facts, contradictions, impacts | event-research | event-research | two-stage assessment/synthesis + gate | excerpts, claims, event date | semantic | report/Knowledge | PRODUCT_READY_GATED | upstream sources | no source, no claim | PIT_SAFE | inherited | Gateway/report path | 48 focused tests | fixture-backed Real Pi acceptance | weak corpus yields gap-heavy output | interpretations not facts without proposals |
| Thesis | lifecycle formalize/refresh | thesis_formalize, expectation_gap, thesis_refresh | thesis-lifecycle | direct input composition | injected thesis, expectations, catalysts, evidence | semantic | dispatch-only | EXECUTABLE_FIXTURE_ONLY | none automatically acquired | skipped/blocked | caller-dependent | caller-provided | no acquisition-backed normal Service start | wave4-thesis-lifecycle tests | no real data acceptance | expects input-supplied surfaces | deliberate peer composition |
| Thesis | red-team attack design | thesis_red_team | thesis-red-team | canonical projection → source/signal acquisition → attacks | active thesis, company, lookback | semantic | Thesis Red Team | PRODUCT_READY_GATED | CNINFO/GDELT/Daily | bounded empty evidence | PIT_SAFE | S0/S1/S2 | Service/Pi path wired | Skill/gateway tests | Real Pi fixture acceptance | canonical thesis and sources required | attack generation is not truth |
| Thesis | evidence synthesis and verdict | thesis_red_team | thesis-red-team | Stage A/B executor → deterministic verdict/proposals | spans, dependency claims, invalidation | semantic + evidence | report/Knowledge | PRODUCT_READY_GATED | upstream sources | bounded repair; no synthetic proposal | PIT_SAFE | inherited | Gateway preserves refs/immutability | 39 focused tests | Real Pi fixture gate | source scarcity limits challenge quality | strict verdict/proposal gates |
| Daily | signal acquisition/catalog | daily-intelligence | daily-intelligence | catalog → CNINFO/GDELT/RSS/AKShare/institution/community | watchlist, trade date, asOf | evidence-backed | service/scheduler/CLI | PRODUCT_READY_GATED | configured public sources | provider outcome/gap | PIT_PARTIAL | S0–S4 | createDailyIntelligenceComposition | daily tests | live probe had mixed public outcomes | breadth, rates, dates | normalization cannot upgrade authority |
| Daily | enrichment, clustering, change assessment | daily-intelligence | daily-intelligence | store → enrich → cluster → assess → brief | normalized signal, prior window, projection | semantic | morning/evening brief | PRODUCT_READY_GATED | acquired signals | deterministic fallback | PIT_PARTIAL | inherited | normal workflow | Daily validation summary/tests | Real Pi fixture path accepted | fewer signals reduce breadth | model enrichment bounded/non-authoritative |
| Daily | consensus/industry/commodity/flows monitoring | expectation_gap, industry_supply_demand_cycle, catalyst_map | none unified | partial Skill inputs | dated estimates, KPIs, commodity, flows | numeric + semantic | future consumers | SOURCE_AVAILABLE_UNWIRED | D1/catalog candidates | unavailable | PIT_PARTIAL | source-dependent | no shared continuous consumer | Skill/unit tests | no cross-domain real acceptance | no unified observation contract | no automatic cross-domain detector |

### Event Analysis

What works is explicit anchor resolution, company-coverage checking, bounded
CNINFO/GDELT acquisition, source-role assignment, evidence assessment,
contradiction handling, direct/second-order impact mapping, report persistence,
quality gating, and Gateway projection. Automatic data comes from CNINFO and
GDELT, with a Daily Signal store available for daily-signal anchors. The normal
caller is ResearchService.startEventResearch through the HTTP research-event
route and Pi research_event tool; focused Event tests and the recorded Real Pi
fixture gate provide semantic evidence. The dominant constraint is provider
availability and anchor-window evidence, not event methodology. Missing source
evidence must remain a blocked or gap-heavy result; it must not be replaced by
model-generated event facts.

Event-specific gaps are EVENT-DATA-001 (dated anchor and source confirmation),
EVENT-DATA-002 (company-bound supporting/contradicting sources), and
EVENT-DATA-003 (recent Daily Signal linkage). They affect Event, Thesis, and
Daily freshness; partial sources are CNINFO, GDELT, and the signal store;
authority is inherited from each source; PIT is safe only when event/publication
dates resolve; the fields are qualitative with evidence-backed numerics where
present; free-source feasibility is high but rate-limited; normal integration
already exists in workflows/event-research/workflow.ts.

## 4 Current Data Domain Map

REAL_READY means an attributable real path exists and has some real acceptance evidence; PARTIAL means a real path exists but only a subset is covered; GATED means the path is present but live execution/acceptance is gated; UNWIRED means source/methodology exists without a normal consumer; ABSENT means no current attributable path was found; NOT_REQUIRED means outside current contract.

| ID | Data domain | Status | Current evidence / normal path | PIT | Truth / authority | Main consumers | Closure note |
|---|---|---|---|---|---|---|---|
| A | statutory disclosures | REAL_READY | OfficialDisclosureResearchPlugin and CNINFO exact-period selection | PIT_SAFE | S0 numeric | Company, Earnings, Event, Thesis | provider availability varies |
| B | financial statements | PARTIAL | AKShare indicator route plus official filing text | PIT_PARTIAL | S0/S3 numeric | Company, Earnings, Valuation | not complete three-statement/segment store |
| C | segment financial/operating | GATED | D2 extraction/projection from documents | PIT_SAFE when dated | S0/S1 evidence | Company, Earnings, Industry | no stable segment taxonomy/live D2 pass |
| D | market price/volume | PARTIAL | `historicalMarketData()` supplies market observations and the current basis selects the latest eligible price <= valuationDate; volume is not required by PE/PB/EV_EBITDA | PIT_PARTIAL | S3 adapter numeric | Valuation, Company, Daily | existing price/trading-date path needs reliability and evidence verification, not new D3 acquisition |
| E | corporate actions/share capital | PARTIAL | public source candidates exist, but no normal historical share-basis path is closed | PIT_PARTIAL | S0/S3 numeric | Valuation, Company, Thesis | shares are a D3 valuation-basis gap; corporate actions matter only when needed to establish PIT share basis |
| F | analyst estimates/consensus/revisions | REAL_READY | D1 THS primary/EastMoney fallback | PIT_SAFE | S3 numeric | Earnings, Valuation, Thesis | annual scope and metric limits |
| G | formal guidance | GATED | D2 guidance candidate/projection | PIT_SAFE | S0/S1 numeric | Earnings, Thesis | source frequency and live gate |
| H | management IR | GATED | D2 CNINFO IR sources | PIT_SAFE if publication bound | S0/S1 | Earnings, Company, Thesis | live retrieval/model not closed |
| I | exchange Q&A | GATED | D2 SSE/SZSE/AKShare routes | PIT_PARTIAL | S1/S3 | Earnings, Event, Thesis | answer dates/routes vary |
| J | company/industry news | GATED | GDELT/RSS/CNINFO/Daily | PIT_PARTIAL | S0/S2/S3 | Daily, Event, Company, Thesis | 429/empty/date/rights issues |
| K | professional media | UNWIRED | catalog URLs, no universal acquisition | PIT_PARTIAL | S2/S3 | Daily, Industry, Event | catalog is not fetched evidence |
| L | industry operating KPIs | GATED | MIIT/CPCA/industry documents | PIT_PARTIAL | S0/S1/S2 | Industry, Company, Thesis, Daily | no reusable time series |
| M | industry capacity/production/inventory | ABSENT | no stable structured dataset/contract | PIT_UNSAFE | S0/S1/S2 | Industry, Thesis, Daily | largest Industry deficit |
| N | commodity/raw material prices | ABSENT | no normal commodity path | PIT_UNSAFE | source-dependent numeric | Industry, Company, Thesis, Daily | do not infer from narrative |
| O | macro/rates/FX | UNWIRED | catalog and possible AKShare functions, no shared consumer | PIT_PARTIAL | S0/S1/S3 | Valuation, Industry, Daily | enhancement, not first blocker |
| P | peers/comparables | UNWIRED | comps Skill caller candidates only | PIT_PARTIAL | source-dependent | Valuation, Company, Industry | need qualified peer resolver |
| Q | ownership/top shareholders | PARTIAL | public source availability, no normal bundle | PIT_PARTIAL | S0/S3 | Company, Thesis, Valuation | source exists but unwired |
| R | fund/institutional holdings | UNWIRED | catalog/AKShare references, no normal path | PIT_PARTIAL | S0/S3 | Company, Daily, Thesis | not current core requirement |
| S | capital flows/positioning | UNWIRED | AKShare/catalog capabilities, no consumer | PIT_PARTIAL | S3 | Daily, Thesis, Valuation | quality enhancement |
| T | supply-chain/customer/supplier evidence | GATED | filing/document evidence, no dedicated structure | PIT_PARTIAL | S0/S1/S2 | Company, Industry, Thesis | structured coverage absent |
| U | product/technology milestones | GATED | MIIT/company/IR and Industry modules | PIT_PARTIAL | S0/S1/S2 | Company, Industry, Event, Thesis | dates and target relevance matter |
| V | valuation basis inputs | PARTIAL | price path and partial EPS path wired; BVPS, EBITDA, cash/debt-derived netDebt, and time-aligned shares are not closed | PIT_PARTIAL | authoritative numeric | Valuation primarily; Company may reuse later | central D3-001 closure target; peers are a later stage |

## 5 Company Research Gaps

### What works

CompanyResearchSkill owns 19 report sections and emits explicit gaps. Company Deep Research performs bounded acquisition, as-of filtering, normalization, quality gating, and Gateway submission. It can consume official disclosures, GDELT news, AKShare financial data, and historical market data. It does not claim valuation when verified metrics or peer data are unavailable; skills/company-research/skill.ts explicitly returns an insufficient-data valuation note.

### Automatic data, callers, and evidence

app/runtime/application-runtime.ts constructs CNINFO and GDELT plugins plus AkshareDataAdapter. ResearchService.startCompanyResearch passes them to runCompanyDeepResearch. Product callers are the HTTP research-company route and Pi research_company tool. Fixture tests cover workflow, service, Gateway, source filtering, and report shape.

### Dominant constraints

The dominant constraints are incomplete structured financial/segment rows; no complete historical share-basis path; no normal peer-universe acquisition; and no automatic D2 management reuse on Company. CNINFO and company IR may carry facts, but a possible web page is not an integrated capability. Common financial actuals are already usable by Company/Earnings when returned; they are not, by themselves, a P0 Valuation gap.

Product closure summary: what works is the bounded 19-section Company report and
fail-closed gap language; automatic inputs are CNINFO/GDELT/AKShare when their
provider calls return usable content; callers and fixtures are the HTTP/Pi
entrypoints and tests/workflows/company-deep-research.test.ts; the dominant
constraint is structured data completeness and provider availability; the
methodology, source binding, quality gate, and Gateway boundary are not blocked
by another provider.

### Gap register

| Gap ID | Datum | Blocked methods/products | Partial source | Authority | PIT | Numeric/qualitative | Free-source feasibility | Normal integration |
|---|---|---|---|---|---|---|---|---|
| CO-DATA-001 | normalized multi-period statements and segment rows | financial quality, segment composition, growth | AKShare indicator + CNINFO filings | S0/S3 | partial | numeric | high for common filings | existing Company/AKShare evidence seams; not a new D3-001 consumer |
| CO-DATA-002 | historical share basis and, only where needed, corporate-action adjustments | per-share valuation, capital allocation, ownership | CNINFO/AKShare public routes; exact PIT applicability remains open | S0/S3 | partial | numeric | medium/high | primary D3-001 Valuation closure; Company may reuse later through existing contracts |
| CO-DATA-003 | attributable peers and comparable metrics | Company valuation, competition | comps Skill input | source-dependent | partial | numeric/semantic | medium | later bounded resolver feeding CompsValuationInput; not D3-001 |
| CO-DATA-004 | management IR and KPI reuse | management/capital allocation, thesis | D2 CNINFO sources | S0/S1 | safe when dated | semantic/numeric | medium | reuse D2 after live gate; do not duplicate |

The 19-section contract, explicit gap language, source binding, Gateway boundary, deterministic gate, and semantic/numeric separation are not blocked by additional providers.

## 6 Earnings Review Gaps

### Closure state

Earnings is the most complete product. The path is:

CNINFO exact-period filing + AKShare financial data + D1 expectations + D2 management communication → deterministic calculations/Skills → bounded ReasoningExecutor interpretation → quality gate → Gateway/Writer → report.

Actuals and exact-period selection are implemented. D1’s closure record documents a normal resolver run with no manual source injection, THS success, ten usable sources, ten institutions, twenty points, and one EPS consensus snapshot. It also records annual EPS/net-profit scope, no automatic expectation Knowledge persistence, and limited historical surprise.

D2-003 is wired into normal Earnings Review. The focused test named “D2-003 offline product path activates management research inside normal Earnings Review” demonstrates D2 acquisition, extraction, and integration without an alternate product. The real script is gate-disabled by default and only reports an attempted live path. D2 is PRODUCT_READY_GATED, not PRODUCT_READY_REAL.

Product closure summary: what works is exact-period actuals, deterministic
financial analysis, D1 estimates/revisions/consensus, and D2 integration;
automatic inputs are CNINFO, AKShare THS/EastMoney, and D2 IR/Q&A operations;
callers and fixtures are ResearchService, the HTTP/Pi Earnings routes, focused
Earnings/D1/D2 tests, and the gated acceptance scripts; the dominant constraint
is live source availability for guidance, segment KPI, Q&A, and execution; the
existing method contracts and deterministic calculations are not blocked by a
new Earnings architecture.

### Earnings dependency matrix

| Capability | Current state | Remaining real-data constraint | Remaining gate/method constraint |
|---|---|---|---|
| actual revenue/profit/EPS | filing and AKShare paths | provider availability | exact period/unit validation |
| consensus/estimates | D1 real-gated and accepted | annual horizon and source coverage | minimum institution/cutoff |
| revisions | attributable estimate points | enough history per institution | no synthetic revisions |
| formal guidance | D2 integrated | guidance document availability | source/date/range matching |
| guidance vs consensus/prior | deterministic | both sides attributable/PIT-safe | incompatible period/unit unavailable |
| segment KPI delta | D2 projection | inconsistent issuer KPIs | no universal taxonomy |
| commentary delta | D2 integrated | current/prior documents | strict date/semantic matching |
| Q&A | D2 integrated | exchange route/date coverage | span/PIT validation |
| execution | management_execution plus D2 | prior commitment/outcome pairs | no narrative inference |

### Gap register

| Gap ID | Datum | Blocked methods/products | Partial source | Authority | PIT | Numeric/qualitative | Free-source feasibility | Normal integration |
|---|---|---|---|---|---|---|---|---|
| ER-DATA-001 | live exact-period filing plus structured rows | full live Earnings Review | CNINFO + AKShare | S0/S3 | safe when returned | numeric | high, environment-dependent | existing earnings acquisition |
| ER-DATA-002 | formal guidance history | guidance comparison, thesis refresh | CNINFO/IR | S0/S1 | safe when dated | numeric/semantic | medium | existing D2 source/extraction |
| ER-DATA-003 | segment KPI history | segment delta, execution | filings/IR/Q&A | S0/S1 | safe when dated | numeric | medium/issuer-dependent | existing D2 extraction |
| ER-DATA-004 | stable Q&A answer/publication timestamps | Q&A trend/execution | SSE/SZSE/AKShare | S1/S3 | partial | semantic/numeric | medium | existing D2 exchange operations |
| ER-DATA-005 | post-result historical surprise dataset | surprise/backtest/thesis | D1 current estimates | S3 | partial | numeric | low/medium | future bounded extension only if material |

Deterministic actual-vs-expectation calculations, caller precedence, report-only expectation handling, source/PIT validation, D2 contracts, and the Gateway boundary are not blocked. D3 should not reopen Earnings architecture.

## 7 Valuation Gaps

### Current capability

The normal Valuation Workflow uses AKShare-derived market and financial inputs, deterministic method eligibility, bounded Pi assumption design, code-owned scenario arithmetic, sensitivity, cross-check, quality gating, and Gateway submission. `app/services/contracts.ts` exposes only PE, PB, and EV_EBITDA. The existing market path calls `historicalMarketData()`, converts rows to market observations, and selects the latest eligible price on or before `valuationDate`; this is an existing path to verify or harden, not a new D3 acquisition capability.

The Valuation Skill explicitly says DCF primitives exist internally but DCF is unavailable in current v0.1 scope. The report says DCF is unavailable/deferred. `CompsValuationInput` and `executeCompsValuation` are implemented and tested, but peer candidates are caller-supplied; normal HTTP/Pi/Service does not construct a peer universe. D3-001 must prove standalone ValuationBasis closure before peer resolution is considered.

Product closure summary: what works is the bounded PE/PB/EV_EBITDA scenario
path, code-owned arithmetic, sensitivity, and explicit unavailable behavior.
The primary current inputs are the existing market observation path and a
partial financial path. D1 forward estimates are reused where an existing
caller supplies them; D1 is not a D3 build item. Callers and fixtures are
ResearchService, the analyze-valuation HTTP/Pi route, valuation workflow tests,
and the Real Pi fixture gate. The concrete closure gap is field-specific:
BVPS, EBITDA, cash/debt-derived `netDebt`, and a time-aligned share basis.
Revenue and net profit remain useful financial actuals for Earnings/Company but
are not thereby P0 Valuation dependencies.

### Required valuation truth set

| Dependency | Current state | Consequence |
|---|---|---|
| market price/date | existing `historicalMarketData()` path; latest eligible price <= valuationDate | transport, empty payload, or evidence verification can block; no new D3 acquisition assumed |
| EPS | current financial bridge recognizes `basic_eps` and the Valuation normalizer has EPS aliases | existing/partial path; verify period, publication, units, and PIT eligibility |
| BVPS | Valuation contract supports `bvps`, but the current AKShare financial bridge does not explicitly standardize it | PB becomes unavailable until a source-backed field is closed |
| EBITDA | Valuation contract supports `ebitda`, but the current AKShare financial bridge does not explicitly standardize it | EV_EBITDA becomes unavailable until a source-backed field is closed |
| cash/debt → netDebt | current financial normalizer stores `netDebt`; no cash/debt source fields or deterministic derivation are currently closed | EV_EBITDA cannot claim a safe bridge without source-backed components and a defined debt policy |
| shares | Valuation contract supports `shares`; `companyBasic()` exists but is not integrated into ValuationBasis | PE/PB/EV_EBITDA may be unavailable; current snapshot is not automatically valid for historical asOf |
| forward estimates | D1 EPS/net-profit path | reused unchanged; annual/source coverage remains limited, but it is not a D3-001 acquisition item |
| peer universe/market data | optional caller input | comps unavailable in normal path; later D3-002/subsequent closure |
| risk-free/macro/FX | catalog candidates, not valuation input | DCF deferred; no silent injection |
| DCF | explicit v1 deferral | not current product scope |
| cross-check | code exists; comps optional | no averaging; unavailable explicit |

### Gap register

| Gap ID | Datum | Blocked methods/products | Partial source | Authority | PIT | Numeric/qualitative | Free-source feasibility | Normal integration |
|---|---|---|---|---|---|---|---|---|
| VAL-BASIS-PRICE | marketPrice and priceDate from latest eligible observation <= valuationDate | all current methods | existing AKShare historical market path | S3 | partial | numeric | high, environment-dependent | verify/harden existing basis; not new D3 acquisition |
| VAL-BASIS-EPS | period- and publication-valid EPS | PE | `basic_eps` plus Valuation aliases | S3/S0 | partial | numeric | high, field/date dependent | reuse and verify current path |
| VAL-BASIS-BVPS | period- and publication-valid BVPS | PB | no explicitly standardized current bridge field | S0/S3 | partial | numeric | open pending field probe | D3-001 source closure |
| VAL-BASIS-EBITDA | period- and publication-valid EBITDA | EV_EBITDA | no explicitly standardized current bridge field | S0/S3 | partial | numeric | open pending field probe | D3-001 source closure |
| VAL-BASIS-CASH-DEBT | source-backed cash/cash-equivalent and debt, deterministically derived to netDebt | EV_EBITDA | no closed cash/debt fields in current Valuation normalizer | S0/S3 | partial | numeric | open pending definition and field probe | D3-001 source closure; no LLM calculation |
| VAL-BASIS-SHARES | applicable shares outstanding/share basis for valuation asOf | PE/PB/EV_EBITDA | `companyBasic()` exists but is not integrated or proven PIT-safe | S0/S3 | partial | numeric | open pending history/probe | D3-001 source closure; corporate actions only as temporal support |
| VAL-DATA-004 | peer candidates with period/units/evidence | comps/competitive valuation | CompsValuationInput | source-dependent | partial | numeric/semantic | medium | later D3-002/subsequent bounded peer resolver |

The source-level contract mismatch is material. `ValuationFinancialRow` supports `eps`, `bvps`, `ebitda`, `netDebt`, and `shares`. Eligibility is PE = price + positive EPS; PB = price + positive BVPS; EV_EBITDA = price + positive EBITDA + shares + finite netDebt. In contrast, the current AKShare `financialData()` bridge explicitly standardizes primarily `basic_eps`, `operating_revenue`, `net_profit`, and `gross_margin`. `companyBasic()` is called and its row count is reported, but it is not integrated into `ValuationBasis`; its fields must be probed rather than assumed sufficient. Arithmetic, scenario ordering, sensitivity, deterministic recomputation, cross-check conflicts, and explicit DCF deferral are methodically ready. D3 should close these source-native inputs and field diagnostics, not rewrite valuation math.

Net debt is derived truth: source-backed debt plus source-backed cash/cash-equivalent feed deterministic code that produces `netDebt`. The future design must define the exact debt/cash policy and units. No LLM calculation is acceptable. Shares must likewise be applicable to the valuation `asOf`; a current snapshot is not automatically valid for a historical date, and corporate actions matter only when needed to establish that temporal share basis.

## 8 Industry Research Gaps

### Method versus data finding

Industry Research has a real implementation shape: reasoning design, provider acquisition waves, eight module analyses, cross-module synthesis, evidence validation, quality gating, and Gateway projection. The Skills cover market structure, supply/demand cycle, competitive map, and the eight requested modules:

1. Definition;
2. Market Size / Growth;
3. Supply / Demand;
4. Industry Chain;
5. Competitive Landscape;
6. Technology Evolution;
7. Company Mapping;
8. Risk Analysis.

The normal runtime composes CNINFO, GDELT, MIIT, gov.cn, Eastmoney, CPCA, and AKShare industry plugins. Existing evidence shows empty/failed providers and prior live Industry/model runs that were inconclusive or externally blocked. Industry is therefore not PRODUCT_READY_REAL.

Product closure summary: what works is bounded design, eight module contracts,
acquisition waves, evidence validation, synthesis, report generation, and
Gateway projection; automatic inputs are the seven-provider runtime composition
when providers return usable documents/rows; callers and fixtures are
ResearchService, the research-industry HTTP/Pi path, Industry Skill/workflow
tests, and bounded validation harnesses; the dominant constraint is structured
industry operating evidence and real model/provider acceptance; module
methodology, gap-only behavior, and canonical evidence gates are not blocked by
inventing another Industry orchestration layer.

### Module closure matrix

| Module | Method status | Missing structured data | What is not a method gap |
|---|---|---|---|
| Definition | PRODUCT_READY_GATED | target-relevant official definition and scope date | design, validation, gap-only fallback |
| Market Size/Growth | DATA_GAP | market value/volume series, base definition, growth history | reasoning/report sections |
| Supply/Demand | DATA_GAP | production, demand, inventory, imports/exports, balance | cycle methodology |
| Industry Chain | PRODUCT_READY_GATED | attributable chain nodes and economics | chain reasoning/relation gates |
| Competitive Landscape | PRODUCT_READY_GATED | comparable operating/market metrics | Skill and evidence rejection |
| Technology Evolution | PRODUCT_READY_GATED | dated milestones, standards, adoption | module and synthesis |
| Company Mapping | DATA_GAP | verified exposure and product/segment mapping | entity/relation proposal boundaries |
| Risk Analysis | PRODUCT_READY_GATED | measurable indicators and invalidation observations | risk methodology |

### Gap register

| Gap ID | Datum | Blocked methods/products | Partial source | Authority | PIT | Numeric/qualitative | Free-source feasibility | Normal integration |
|---|---|---|---|---|---|---|---|---|
| IND-DATA-001 | official industry definition/taxonomy | definition/company mapping | MIIT, CNINFO, gov.cn | S0/S1 | partial | qualitative | high for selected sectors | existing industry wave |
| IND-DATA-002 | market size/growth basis | size/growth | MIIT/NBS/associations | S0/S1/S2 | partial | numeric | medium | existing plugins; source-native units |
| IND-DATA-003 | production/capacity/utilization/inventory | supply/demand/pricing | MIIT/CPCA/reports | S0/S1/S2 | partial | numeric | medium/low | no structured normal path |
| IND-DATA-004 | commodity/raw-material price series | pricing/economics, Company margin | no normal source | source-dependent | unsafe | numeric | medium, fragmented | future bounded extension |
| IND-DATA-005 | listed-company exposure | mapping/competitive landscape | filings/IR/Eastmoney board | S0/S1/S3 | partial | semantic/numeric | medium | existing Gateway exposure relation |
| IND-DATA-006 | technology milestones/adoption | technology/risk/thesis | MIIT/IR/media | S0/S1/S2 | partial | qualitative/numeric | medium | document acquisition/module input |

Module contracts, target diagnosis, bounded waves, explicit gaps, numeric audit, report sections, canonical relation requirements, and Gateway/Writer boundaries are not blocked. The D3 shape is focused operating-data closure, not an Industry-specific agent or generic provider layer.

## 9 Thesis / Red-Team Gaps

Thesis Red Team resolves an active canonical thesis and Company, projects dependencies, acquires bounded CNINFO/GDELT/Daily Signal evidence, designs attacks, synthesizes challenges, validates source/PIT bindings, derives deterministic verdict evidence, and protects thesis/company immutability. The recorded Real Pi fixture acceptance proves Stage A/B execution, bounded repair, deterministic verdict, persisted report, and source/claim deltas. It does not prove universal live coverage.

Thesis Lifecycle is intentionally input-driven. Its contract accepts formalization, expectations, catalysts, refresh evidence, and an injected red-team result; it is not a normal automatic acquisition workflow. This is EXECUTABLE_FIXTURE_ONLY, not a reason to introduce direct Skill-to-Skill orchestration.

| Gap ID | Missing input | Blocked capability | Partial source | Authority/PIT | Priority |
|---|---|---|---|---|---|
| TH-DATA-001 | active canonical Thesis and Company coverage | all red-team execution | Knowledge projection | canonical/current | P0 per run |
| TH-DATA-002 | recent attributable disconfirming/supporting evidence | challenge quality/verdict confidence | CNINFO/GDELT/Daily | S0/S1/S2 mixed | P1 |
| TH-DATA-003 | expectation-gap observations | thesis refresh/variant perception | D1 expectations | S3 PIT-safe | P1 |
| TH-DATA-004 | measurable invalidation/KPI observations | risk escalation/monitoring | filings/industry/Daily | mixed | P1 |
| TH-DATA-005 | management commitment outcome pair | execution attack vector | D2 sources | S0/S1 | P2 |

The method is not blocked by a universal Thesis provider. It is blocked run by run on an evidence set. D3 should make that evidence more reliable through shared sources; it should not hardcode support or disconfirm labels.

Product closure summary: what works is canonical thesis resolution, bounded
attack design, source-bound synthesis, deterministic verdict evidence, and
immutability protection; automatic inputs are existing Knowledge plus CNINFO,
GDELT, and Daily Signal evidence on the red-team path, while Lifecycle inputs
are caller-supplied; callers and fixtures are ResearchService/Pi red-team,
thesis tests, and the recorded Real Pi fixture gate; the dominant constraint is
the availability of an active thesis and recent attributable evidence; the
red-team methodology and lifecycle peer boundary are not blocked by a generic
provider.

## 10 Daily / Continuous Research Gaps

createDailyIntelligenceComposition loads catalog, watchlist, active public providers, and calendar. The workflow acquires signals, preserves source identity, stores a bounded window, enriches and clusters, assesses changes against Knowledge, synthesizes a brief, quality-gates proposals, and persists a report. Scheduler and CLI are present.

The Daily validation summary records a functioning fixture path and a live public-source probe with mixed outcomes: some public institutional/community pages usable, CNINFO/RSS empty for the probe, GDELT rate-limited, and the local AKShare bridge unavailable. This is provider evidence, not a claim of universal live readiness.

| Signal family | Current state | Blocker or quality effect |
|---|---|---|
| market-wide | AKShare/index and configured public sources | current availability and trading-date coverage |
| institutional activity | catalog-driven public web acquisition | fragmented pages; not consensus |
| company news | GDELT/RSS/CNINFO/catalog | rate limits, rights, missing dates |
| official announcements | CNINFO/RSS | empty results leave gap-only output |
| consensus changes | D1 exists, no unified Daily consumer | quality enhancement/unwired |
| industry operating | industry plugins/catalog documents | structured KPI/PIT gap |
| commodity | no normal source | data gap, not method gap |
| positioning/flows | partial AKShare/catalog | no continuous normalized consumer |

| Gap ID | Datum | Blocked methods/products | Partial source | Authority | PIT | Numeric/qualitative | Free-source feasibility | Normal integration |
|---|---|---|---|---|---|---|---|---|
| DAILY-DATA-001 | stable broad company-news coverage | Daily/Event/Thesis freshness | GDELT/RSS/CNINFO | S0/S2/S3 | partial | qualitative | high but rate-limited | existing catalog/plugin |
| DAILY-DATA-002 | market/volume observations | market monitoring | AKShare | S3 | partial | numeric | high | existing daily market plugin |
| DAILY-DATA-003 | estimate/revision change events | expectation monitoring | D1 resolver | S3 | safe | numeric | medium | future bounded signal projection |
| DAILY-DATA-004 | industry KPI/commodity changes | sector monitoring | MIIT/associations; no commodity | S0/S1/S2 | partial/unsafe | numeric | medium | future source-native observations |
| DAILY-DATA-005 | positioning/flows | capital-market monitoring | AKShare/catalog | S3 | partial | numeric | medium | only after consumer contract |

Daily is not blocked by a new orchestration framework. The dominant constraint is source breadth and date quality.

Product closure summary: what works is catalog-driven acquisition, signal
normalization, enrichment, clustering, change assessment, brief synthesis,
replay, scheduler, and report persistence; automatic inputs are configured
CNINFO/GDELT/RSS/AKShare/institution/community sources; callers and fixtures are
DailyIntelligenceService, CLI/scheduler/HTTP entrypoints, Daily tests, and the
live-probe/Real Pi fixture evidence; the dominant constraint is uneven public
coverage, rate limits, and date quality; the signal-to-brief method and its
quality gate are not blocked by adding a new runtime.

## 11 Cross-Product Data Gaps

| Gap ID | Datum / definition | Blocked methods/products | Partial source | Authority | PIT | Numeric/qualitative | Free-source feasibility | Normal integration |
|---|---|---|---|---|---|---|---|---|
| X-DATA-001 | listed-company identity/exchange/canonical issuer | all company products | Knowledge identity + CNINFO lookup | S0/S1 | safe when resolved | semantic/control | high | existing identity normalization |
| X-DATA-002A | financial actuals already usable by Earnings/Company, including revenue and net profit when returned | Earnings, Company | AKShare indicator + CNINFO filings | S0/S3 | partial | authoritative numeric | high for common filings | existing financial seams; not a P0 Valuation dependency merely because it is fundamentals data |
| X-DATA-002B | ValuationBasis metrics: EPS, BVPS, EBITDA, cash, debt, and deterministically derived netDebt | Valuation primarily | current AKShare financial bridge plus CNINFO candidates; exact field authority remains open | S0/S3 | partial | authoritative numeric | open by field | D3-001 field-level source closure |
| X-DATA-003A | market price and trading date from latest eligible historical observation <= valuationDate | Valuation, Company, Daily | existing AKShare `historicalMarketData()` path | S3 | partial | authoritative numeric | existing path | verification/hardening; not new D3 acquisition |
| X-DATA-003B | shares outstanding/share basis applicable to historical asOf; corporate actions only where needed for that temporal basis | Valuation primarily; Company later | `companyBasic()` and CNINFO/AKShare candidates, not yet integrated/PIT-proven | S0/S3 | partial | authoritative numeric | open by history/field | D3-001 source closure |
| X-DATA-004 | forward estimate and publication/revision history | Earnings, Valuation, Thesis, Daily | D1 THS/EastMoney | S3 | safe | authoritative numeric | medium | D1 expectations resolver reused unchanged |
| X-DATA-005 | peer candidate with period, units, comparability, source | Valuation, Company, Industry | comps caller input/board membership | source-dependent | partial | numeric/semantic | medium | later bounded peer resolver; not D3-001 |
| X-DATA-006 | industry operating observation: metric, unit, period, publisher, asOf | Industry, Company, Thesis, Daily | MIIT/CPCA/gov.cn docs | S0/S1/S2 | partial | authoritative/evidence numeric | medium | industry normalization |
| X-DATA-007 | management statement/Q&A/commitment with event time/span | Earnings, Company, Event, Thesis | D2 CNINFO/exchange | S0/S1 | safe when dated | semantic/numeric | medium | existing D2 contract |
| X-DATA-008 | source outcome and explicit unavailable reason | all products | D0 diagnostics/provider outcomes | inherited | safe | control/semantic | complete | already wired |

The D3-001 forcing function should target X-DATA-002B and X-DATA-003B, while verifying/reusing X-DATA-003A and the existing EPS path. X-DATA-002A is already usable financial actuals for Earnings/Company and is not a reason to create a generic shared evidence layer. X-DATA-005 remains a later peer/comparable closure. Industry operating data is important but is a separate forcing function after ValuationBasis closure.

## 12 P0/P1/P2/P3 Priorities

### Definitions

- P0 — correctness blocker: without the datum, the normal product must block, return unavailable, or risk an authoritative numeric error.
- P1 — high-value closure: materially improves two or more products or a core product section, with a feasible free/public path and a clear existing seam.
- P2 — quality enhancement: improves breadth, monitoring, or interpretation but does not block the current accepted contract.
- P3 — deferred/exploratory: valuable only after higher priorities or requiring paid, unstable, or materially new infrastructure.

| Priority | Gap IDs | Reason |
|---|---|---|
| P0 | VAL-BASIS-BVPS, VAL-BASIS-EBITDA, VAL-BASIS-CASH-DEBT, VAL-BASIS-SHARES | each is a concrete correctness-blocking ValuationBasis datum; its absence makes a specific existing method unavailable or numerically unsafe |
| P0 (existing path verification, not missing build) | VAL-BASIS-PRICE, VAL-BASIS-EPS | price and EPS already have source seams; verify PIT, dates, units, and diagnostics without representing them as new D3 acquisition work |
| P0 (run prerequisite, not source backlog) | X-DATA-001, TH-DATA-001 | issuer identity and active canonical Thesis/Company remain hard execution preconditions when a run requires them |
| P1 | X-DATA-005, CO-DATA-002, CO-DATA-003, VAL-DATA-004 | peer/comparable inputs and later Company share/valuation reuse require bounded contracts after standalone ValuationBasis closure |
| P1 | IND-DATA-001, IND-DATA-002, IND-DATA-003, IND-DATA-005, IND-DATA-006 | Industry operating observations remain the next major independent data track |
| P1 | X-DATA-004, ER-DATA-002, ER-DATA-003, ER-DATA-004 | closes remaining Earnings evidence surfaces without reopening architecture; D1/D2 remain separate gated/accepted paths |
| P2 | DAILY-DATA-001, DAILY-DATA-003, O, R, S | Daily breadth/freshness, macro, holdings, and flows improve quality but do not block current accepted contracts |
| P3 | IND-DATA-004, DAILY-DATA-004, DCF input closure | commodity automation, broad operating data, and DCF need more source/contract work |

### Recommended order

1. D3-001 Valuation Basis Evidence Closure: close BVPS, EBITDA, cash/debt → netDebt, and shares; reuse existing price/EPS paths where valid.
2. Minimal peer/comparable input closure only after standalone ValuationBasis works.
3. Industry operating-observation closure with source-native units and dates.
4. Daily breadth/continuous observations after reusable observation contracts exist.

D2 real gated validation can be rerun independently using its existing contracts; it is not a new development stage.

## 13 Top Three Free-Source Options

External feasibility was checked on 2026-09-23. These are source families and reuse existing ResearchHub boundaries; they are not implementation authorization.

### Option 1 — CNINFO official disclosure and IR

- Source: [CNINFO official site](https://www.cninfo.com.cn/new/index), including announcements, company information, research/IR material, interactive services, and linked exchange information. The site identifies itself as the Shenzhen Stock Exchange information-disclosure website operated by its wholly owned information subsidiary.
- Origin authority: S0_STATUTORY for statutory disclosure; S1_OFFICIAL for exchange/company communication.
- Retrieval: existing CninfoOfficialDisclosureClient via https://www.cninfo.com.cn/new/hisAnnouncement/query and static document URLs; D2 reuses the same client for IR.
- A-share coverage: broad CNINFO-listed coverage; current code resolves issuer organization IDs and selects SSE/SZSE columns.
- History: announcement history and bounded pagination; D2 IR search uses lookback and seDate cutoff.
- PIT: strong when announcementTime/publishedAt is present and compared to asOf; answer time and publication remain separate.
- Shape: unstructured PDF/HTML/text plus candidate metadata; not a complete structured financial/ownership dataset.
- Limitations: rate limits, empty results, issuer inconsistency, parsing, and no universal segment/corporate-action normalization.
- Existing reuse: plugins/research-acquisition/official.ts, D0, D2, Company/Earnings/Event/Thesis.

### Option 2 — AKShare public A-share interface

- Source: [AKShare stock documentation](https://akshare.akfamily.xyz/data/stock/stock.html), checked 2026-09-23. Documentation exposes A-share market summaries, historical data, financial indicators, forecasts, shareholder/holding and related public-data functions.
- Origin authority: varies by underlying endpoint; commonly S3_AGGREGATOR or adapter-level public data, not automatically statutory. Publisher and retrieval provider remain separate.
- Retrieval: existing Python bridge plugins/research-acquisition/akshare.ts; current functions include basic, financial, historical market, THS/EastMoney forecasts, exchange Q&A, institutional research, sector data, and trading calendar.
- A-share coverage: broad symbols and exchange-prefixed routes where underlying endpoint responds.
- History: historical market and report-date financial rows in selected functions; forecast and ownership history vary.
- PIT: possible for historical observations and publication dates, but not guaranteed by adapter alone; consumers must preserve dates and reject future values.
- Shape: structured rows with varying origin, units, and completeness.
- Limitations: endpoint changes, empty payloads, Python dependency, transport failures, aggregator authority, and incomplete capital/segment/peer normalization.
- Existing reuse: D1, Earnings, Valuation, Company, Industry, Daily, D2 exchange Q&A.

These source families establish retrieval feasibility, not field authority. The audit does not assert that an AKShare or CNINFO endpoint is authoritative or sufficient for BVPS, EBITDA, cash, debt, or shares. D3 design must probe exact fields, units, report and publication dates, available history, and publisher provenance before selecting a source. AKShare remains retrieval infrastructure, not source authority.

### Option 3 — Official industry and macro document families in the catalog

- Source family: [MIIT industry data](https://www.miit.gov.cn/gxsj/) plus existing gov.cn, NBS, NDRC, PBC, SAFE, CSRC, and association entries in config/research-sources/catalog.yaml. MIIT page checked 2026-09-23 exposes current industry-data groupings and operating updates for materials, equipment, consumer goods, communications, electronic information, software, and internet sectors.
- Origin authority: usually S0_STATUTORY or S1_OFFICIAL; association documents may be S2_PROFESSIONAL.
- Retrieval: reuse MiitIndustryResearchPlugin, GovCnIndustryResearchPlugin, CpcaIndustryResearchPlugin, RSS/document routes, and D0 normalized sources. This is not one new provider.
- A-share coverage: indirect but relevant for industries containing A-share issuers; not company-level coverage.
- History: archives and periodic releases vary; publication date is more common than complete observation-period/asOf metadata.
- PIT: usually safe for published documents when publishedAt is preserved; observation period/revisions require source-specific handling.
- Shape: unstructured documents and occasional tables; limited stable capacity/utilization/inventory series.
- Limitations: differing definitions, irregular updates, no company exposure, and no numeric promotion without extraction/units.
- Existing reuse: industry composition in application-runtime.ts, industry wave, parser, Industry Skills, Daily catalog, D0 provenance.

### Source-selection conclusion

These options cover the highest-value free surface without provider proliferation: official issuer truth, structured market/financial observations, and industry/macro operating documents. EastMoney/THS remain useful D1 aggregator lanes already governed by the expectations ladder; they are not a reason to create another generic provider abstraction.

## 14 Recommended D3 Forcing Function

### One forcing function

**For a selected A-share issuer and fixed analysisAsOf, can the normal Valuation product assemble a fully attributable, PIT-safe ValuationBasis from public sources such that each existing PE / PB / EV_EBITDA method becomes eligible only when all of its required numeric inputs are actually available?**

The design field scope is only:

- `marketPrice`, `priceDate`;
- `basisFiscalYear`, `reportDate`, `publicationDate`;
- `eps`, `bvps`, `ebitda`;
- source-backed `cash`, `debt`, deterministic `netDebt`;
- applicable `shares` / share basis.

If the current final contract stores only `netDebt`, provenance must still preserve the cash/debt components and derivation. Identity and D1 are upstream prerequisites/reused inputs, not new D3 source-development scope. Volume, ownership, segment, macro, FX, commodity, DCF, full corporate-action, and peer-universe fields are outside this forcing function.

Acceptance is about truthful eligibility. It is not necessary for all three methods to succeed for every issuer/date. Correct failure is a specific method unavailable plus a specific missing-field diagnostic, not synthetic completion or a model-supplied numeric value.

### Why this is the forcing function

It directly tests X-DATA-002B and X-DATA-003B, verifies/reuses X-DATA-003A and the existing EPS path, and reuses D0, D1, the current AKShare adapter, CNINFO candidates, and the current Valuation Workflow/Skill. It exposes whether provider emptiness is data, transport, field-shape, or contract failure. Industry operating data and peer construction remain independent later slices.

## 15 D3 Working Proposal

### Proposed name

**D3-001 A-share Valuation Basis Evidence Closure**

### Design-only scope

Extend existing research-acquisition and AKShare/CNINFO seams only as needed to close the existing ValuationBasis. This is a working design, not implementation authorization. The primary consumer is the existing Valuation Workflow. It should:

1. probe exact source-native fields, units, report dates, publication dates, history, and publisher provenance for BVPS, EBITDA, cash, debt, and shares;
2. reuse the existing historical market path and verify `marketPrice` / `priceDate` eligibility rather than reacquiring price by default;
3. reuse and verify the current EPS path where its period, publication, units, and PIT evidence pass;
4. define source-backed cash/debt components and deterministic derivation to `netDebt`; no LLM arithmetic;
5. establish a share basis applicable to fixed `analysisAsOf`; use corporate-action evidence only where it establishes that temporal basis;
6. preserve originAuthority, originPublisher, retrievalProvider, publishedAt/observation date, retrieval time, raw reference, and asOf;
7. use existing D0 DataRequirement, SourcePolicy, PIT/authority checks, and explicit field/method unavailable reasons;
8. expose provider outcomes and field-level diagnostics in the existing Valuation report/workflow;
9. add real-gated acceptance plus offline replay/fixture evidence, keeping provider/model and fixture evidence separate;
10. reuse D1 expectations unchanged rather than reimplementing estimates.

### Reuse chain

CNINFO / AKShare existing operations → research-acquisition contracts → D0 DataRequirement, SourcePolicy, PIT/authority checks → existing Valuation Workflow → existing deterministic Valuation Skill/calculations → Research Quality Gate → Knowledge Production Gateway/Writer → existing valuation report and HTTP/Pi callers.

No new Agent Runtime, Planner, provider registry, crawler framework, vector database, direct Knowledge mutation, generic cross-product data layer, or mandatory Company consumer is needed. Company may reuse the closure later through existing acquisition/data contracts after Valuation closure is proven.

### Acceptance boundary

D3 should require one selected A-share issuer and fixed `analysisAsOf`; at least one real official or structured source attempt; field, unit, fiscal period, report/publication date, source ID, authority, and retrieval metadata for every numeric observation; rejection of future values; preservation of valid zeroes; PIT-safe share applicability; deterministic cash/debt → `netDebt`; method-specific eligibility according to the existing rules; no model-generated numeric observations; no canonical Source/Claim for unused sources; a report naming every missing field and the affected method; separate live-provider/model and fixture evidence; and the existing D1 result reused unchanged. It is acceptable for one or more methods to remain unavailable when their required inputs are absent.

### Explicit non-goals

No DCF, broad macro modeling, ownership warehouse, paid consensus feed, commodity crawler, continuous event bus, full industry warehouse, full corporate-action warehouse, peer universe, generic `FundamentalsEvidenceBundle`, new provider framework, mandatory Company integration, or second Earnings project.

## 16 Two Alternatives

### Alternative A — Industry Operating Data Closure first

Close one industry, such as semiconductor/PCB, across definition, market size, supply/demand, capacity/utilization, pricing, chain, technology, and company mapping using MIIT/CPCA/gov.cn and official company documents.

This is valuable and remains the next independent high-value data track, but is separate from ValuationBasis closure because sources are heterogeneous, many observations are unstructured, and company exposure/metric comparability require source-specific policy. It should not be folded into D3-001.

### Alternative B — Daily / Continuous coverage expansion

Extend the catalog and signal composition for official announcements, professional media, institutional pages, estimate changes, industry KPIs, commodities, and capital flows.

This remains a breadth/quality track because Daily already has a bounded signal pipeline and the main benefit is freshness and coverage. It should follow reusable observation contracts and is not a prerequisite for D3-001.

### Selection

Choose D3-001. Keep Alternative A as the next major independent data slice after the minimum ValuationBasis closure; use Alternative B as a breadth track after stable observation contracts exist. Neither alternative justifies a generic provider abstraction.

## 17 What Not To Build

- Do not build another Earnings Review project. D1 and D2 already have Workflow-owned paths; close their gated real evidence where material.
- Do not build a generic cross-product `FundamentalsEvidenceBundle` before a concrete consumer proves it is needed.
- Do not introduce a generic Provider Framework, SourceManager, crawler layer, or source registry. Extend the existing acquisition Plugin area and explicit Workflow composition.
- Do not treat AKShare retrieval as source authority. Preserve original publisher and retrieval provider independently.
- Do not use LLM web search, narrative extraction, or model arithmetic as a fallback for AUTHORITATIVE_NUMERIC requirements.
- Do not reacquire or reimplement price when the existing historical-market path only needs validation or hardening.
- Do not add DCF merely because deterministic DCF primitives exist. DCF is explicitly deferred in Valuation v0.1.
- Do not fold peer resolution into ValuationBasis acquisition; defer it to a later bounded stage.
- Do not promote EastMoney board membership, news mention, or name match into verified peer exposure without evidence-backed comparability.
- Do not treat current `companyBasic()` data as historical share truth without PIT evidence.
- Do not add direct browser/frontend Knowledge writes. Gateway, validated ChangeSet, and Writer remain the canonical mutation path.
- Do not make Thesis Lifecycle directly orchestrate Skills or make Thesis Red Team mutate its target Thesis.
- Do not equate fixture Real Pi evidence with live provider success. Keep fixture, provider smoke, model execution, and real product acceptance separate.
- Do not broaden D3 to ownership, commodities, macro, paid consensus, or a full industry warehouse before the concrete ValuationBasis P0 fields pass.

## 18 Known Uncertainty

- Live provider content is time-varying. A source that succeeded in D1 can be empty or blocked on another run; the closure record says live data is expected to change.
- Repository evidence mixes historical accepted records and newer fixes. Files on the exact baseline are binding implementation; evidence records describe the harness/run recorded by that file and do not prove every provider is currently reachable.
- No current Company real product acceptance was found in inspected evidence. Company is not elevated to PRODUCT_READY_REAL.
- D2 real acceptance is intentionally gated and was not run by this audit. The default output is GATE_DISABLED; no live management document, extraction, or model success is claimed.
- Industry evidence contains inconclusive or externally blocked classifications. Methodology can be sound when a live source/model run is not.
- Legal/licensing status of every public endpoint/document and downstream derivative use requires source-specific review; this audit is not a legal opinion.
- Catalog presence is not normal-path evidence. Some entries are public web candidates but are not active or automatically acquired in every product.
- Source authority and field sufficiency for BVPS, EBITDA, cash, debt, and shares remain open until D3 design probes exact endpoints, units, dates, history, and publisher provenance. The D3 working proposal still requires SOL review of field scope, authority floors, source-policy specificity, and exact acceptance fixture before implementation.

### Audit disposition

The audit is ready for SOL review. It recommends one D3 working proposal and does not authorize or contain D3 implementation.
