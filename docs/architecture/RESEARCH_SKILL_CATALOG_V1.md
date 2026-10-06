# ResearchHub — Research Skill Catalog v1

This is the canonical roadmap for the single-level Research Skill architecture.
`Runtime` means currently executable and registered. `PARTIAL` and `PLANNED`
entries are intentionally not runtime registered.

| Skill | Domain | Research question | Status | Runtime | Existing source / owner | Migration action |
| --- | --- | --- | --- | --- | --- | --- |
| `document_change_analysis` | Evidence | What changed between two attributable documents? | PLANNED | No | No stable implementation | Future document-diff wave |
| `business_model_map` | Company Economics | How does the company make money? | IMPLEMENTED | Yes | Company Research Business Model section | Evidence-gated standalone methodology |
| `business_driver_analysis` | Company Economics | What drives consolidated revenue/profit? | IMPLEMENTED | Yes | `skills/business_driver_analysis/calculations.ts` | Direct period-aligned driver decomposition with explicit residuals |
| `unit_economics` | Company Economics | What measurable economic unit explains the business? | IMPLEMENTED | Yes | `skills/unit_economics/calculations.ts` | Direct explicit-unit, per-unit, growth, and operating-leverage calculations |
| `management_execution` | Company Economics | How has management executed against commitments? | IMPLEMENTED | Yes | `skills/management_execution/` | Explicit commitment-to-outcome comparison; no personality scoring |
| `capital_allocation_review` | Company Economics | How has capital been allocated and with what result? | IMPLEMENTED | Yes | `skills/capital_allocation_review/` | Explicit capital metrics and return/hurdle assessment |
| `market_structure_analysis` | Industry | What is the structure and boundary of the market? | IMPLEMENTED | Yes | `skills/market_structure_analysis/` | Explicit boundary, segmentation, sizing methodology, and value-chain result |
| `industry_supply_demand_cycle` | Industry | What drives capacity, inventory, pricing, and cycle? | IMPLEMENTED | Yes | `skills/industry_supply_demand_cycle/` | Explicit demand, effective capacity, utilization, inventory, pricing, and cycle-state analysis; preserve contradictions |
| `competitive_market_map` | Industry | Who competes and how is the market positioned? | IMPLEMENTED | Yes | `skills/competitive_market_map/` | Explicit attributable peers, positioning, competitive events, and need/economics whitespace assessment |
| `consensus_expectations_analysis` | Earnings / Expectations | What is the current point-in-time consensus state? | IMPLEMENTED | Yes | `skills/earnings-review/expectations/consensus.ts`; Earnings Workflow | Register canonical metadata and preserve PIT gate |
| `earnings_variance_analysis` | Earnings / Expectations | Why did reported actuals differ from expectation/prior? | IMPLEMENTED | Yes | `actual-vs-expectation.ts`, segment KPI logic; Earnings Workflow | Register canonical metadata and collision tests |
| `guidance_analysis` | Earnings / Expectations | How did forward management guidance compare with prior/consensus? | IMPLEMENTED | Yes | `guidance.ts`; Earnings Workflow | Register canonical metadata and preserve unavailable behavior |
| `earnings_call_analysis` | Earnings / Expectations | What did the transcript/Q&A reveal? | PLANNED | No | No transcript speaker/Q&A implementation | Future transcript wave |
| `estimate_revision_analysis` | Earnings / Expectations | How did estimates change from old to new? | IMPLEMENTED | Yes | `estimate-revision` logic and expectation integration | Register canonical metadata and preserve PIT links |
| `financial_quality_analysis` | Financial | What is the quality of reported earnings/cash conversion? | IMPLEMENTED | Yes | `skills/financial_quality_analysis/` plus Wave 1 deterministic calculations | Shared report-level diagnostic with explicit partial/unavailable behavior |
| `financial_model_build_update` | Financial | How should a complete forecast model be built or updated? | PLANNED | No | No complete model implementation | Future financial-model wave |
| `model_audit` | Financial | Are model formulas, inputs, and outputs internally consistent? | PLANNED | No | No independent model-audit implementation | Future model wave |
| `dcf_valuation` | Valuation | What is forward intrinsic value from explicit FCFF forecasts? | IMPLEMENTED | Yes | `skills/valuation/calculations/dcf.ts`, `fcff.ts`, `discount-rate.ts` | Register methodology; keep product DCF readiness gate |
| `reverse_dcf_expectation_decode` | Valuation | What future performance is implied by price/EV? | IMPLEMENTED | Yes | `calculateReverseDcf` in valuation calculations | Register methodology; require all explicit inputs |
| `comps_valuation` | Valuation | What does an attributable peer set imply? | IMPLEMENTED | Yes | `skills/comps_valuation/`; existing `skills/valuation/calculations/comps.ts` | Direct peer identity, PIT, comparability, metric availability, distribution, and implied-value contract |
| `scenario_valuation` | Valuation | How do Bear/Base/Bull assumptions change value? | IMPLEMENTED | Yes | `skills/valuation/financials.ts`; Valuation Workflow | Register methodology and reuse code arithmetic |
| `expectation_gap` | Thesis | Where do price-implied, consensus, management, and research views differ? | IMPLEMENTED | Yes | `skills/expectation_gap/` | Deterministic compatibility, range, delta, and no-gap contract |
| `thesis_formalize` | Thesis | What are the explicit thesis propositions and dependencies? | IMPLEMENTED | Yes | `skills/thesis_formalize/` | Semantic candidate proposition generation over bounded evidence, followed by deterministic evidence-basis and acyclic-dependency validation |
| `thesis_red_team` | Thesis | How could an active thesis be wrong? | IMPLEMENTED | Yes | `skills/thesis-red-team/`; Thesis Red Team Workflow | Normalize legacy ID and retain Workflow composition |
| `catalyst_map` | Thesis | Which attributable events could change the thesis? | IMPLEMENTED | Yes | `skills/catalyst_map/` | Semantic event-to-proposition mapping over bounded attributable evidence, followed by deterministic timing/status validation |
| `thesis_refresh` | Thesis | What changed in an existing thesis since last review? | IMPLEMENTED | Yes | `skills/thesis_refresh/` | Semantic target/relation classification over bounded new evidence, followed by deterministic PIT, no-drift, and kill logic |

## Runtime registration policy

The runtime set is the twenty-two `IMPLEMENTED` entries with an independently
executable boundary. `business_model_map` and `thesis_red_team` are
`SEMANTIC_EXECUTABLE` through the existing bounded session/Workflow reasoning
boundaries. Consensus expectations, earnings variance, guidance, estimate
revisions, forward DCF, reverse DCF, and scenario valuation are
`DETERMINISTIC_EXECUTABLE` and bind directly to the existing authoritative
calculation functions. Business driver, unit economics, financial quality,
management execution, capital allocation, and expectation gap bind to
deterministic contracts. Thesis formalization, catalyst mapping, and thesis
refresh bind to semantic executors which pass bounded model output into
deterministic contracts.
`comps_valuation` is a deterministic executable: the Workflow or upstream
semantic step supplies the attributable peer set, and the Skill validates
identity, point-in-time, comparability, metric availability, and source
evidence before reusing the shared comparable calculations. It never creates
synthetic peers. `valuation_crosscheck` remains Workflow-owned
composition, and cross-domain terminal QC is the reusable Workflow-layer
`ResearchQualityGate`; neither is a canonical Skill.

Every runtime entry records an execution class and binding in the catalog. A
deterministic entry must also expose a callable `runtimeExecutor`; a methodology
source alone is not evidence of deterministic runtime execution.

The existing composite Workflows remain the product execution boundary while
their canonical skill metadata is introduced. Their mapped skill IDs are
documented in the migration matrix and are not evidence that an unimplemented
Skill is runtime available.

FIX-002 semantic closure preserves the catalog statuses and runtime set while
narrowing deterministic authority. The industry cycle keeps utilization level
separate from direction and requires comparable transitions for confirmed
inflection; management execution treats qualitative labels as non-authoritative
and fails closed without deterministic predicates; and capital allocation gates
value assessment to applicable action types, attributable return/hurdle
evidence, and subsequent outcomes.

W4 promotes only `thesis_formalize`, `expectation_gap`, `catalyst_map`, and
`thesis_refresh`: each has a direct bounded result, executable validation, and
no canonical Knowledge mutation. Wave 5 promotes `comps_valuation` and
corrects ownership for three former catalog entries. The catalog is now 22
`IMPLEMENTED`, 0 `PARTIAL`, and 4 `PLANNED`; the four planned entries remain
visible as roadmap items. `thesis_red_team` remains the semantic peer and adds
deterministic fragility and kill-criterion evaluation without becoming a
composite Skill. FIX-001 closes semantic ownership for the three target Skills:
each calls `ReasoningExecutor` at most twice, allowlists supplied refs, and
fails closed before its deterministic validator on invalid model output.
