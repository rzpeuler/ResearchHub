# RHL-SKILL-ARCH-001 — Single-Level Research Skill Architecture Design

Date: 2026-09-21  
Status: Approved for implementation  
Baseline: `origin/main` at `0b53e462cf5da00b568a7af52dec4375c7dfb5b9`  
Branch: `codex/skill-arch-001-single-level-research-skills`

## 1. Goal and non-goals

ResearchHub will expose one flat layer of independently callable Research
Skills. Composite research missions remain Workflows. Helpers and deterministic
calculations remain implementation details of a Skill or a narrow shared pure
function; they are not separately registered Skills.

This migration reconciles the existing composite runtime IDs with the 29-item
canonical catalog supplied by RHL-SKILL-ARCH-001. It does not attempt to
implement every future research method. Each catalog item is explicitly marked
`IMPLEMENTED`, `PARTIAL`, or `PLANNED`; only executable Skills enter the runtime
registry.

The migration does not change Knowledge Schema, canonical identity allocation,
Gateway/ChangeSet validation, Writer authority, the Pi host boundary, or the
local-first application runtime. It does not add an Agent, Planner, provider
abstraction, capability layer, vector store, or alternate orchestration runtime.

## 2. Evidence from the current repository

The baseline registry in `app/services/skill-registry.ts` registers seven
composite research IDs: `company-research`, `industry-research`,
`earnings-review`, `event-research`, `valuation`, `thesis-red-team`, and
`daily-intelligence`, plus `knowledge-curation`. The existing
`ResearchDispatchService` routes Workflow requests first and otherwise uses
legacy workflow/capability keywords and Skill metadata as a fallback.

Existing research implementation is distributed across:

- `skills/company-research/`, `skills/industry-research/`,
  `skills/earnings-review/`, `skills/valuation/`, `skills/event-research/`,
  `skills/thesis-red-team/`, and `skills/daily-intelligence/`;
- Workflows under `workflows/company-deep-research/`,
  `workflows/industry-deep-research/`, `workflows/earnings-review/`,
  `workflows/valuation/`, `workflows/event-research/`,
  `workflows/thesis-red-team/`, and `workflows/daily-intelligence/`;
- deterministic valuation calculations under `skills/valuation/calculations/`;
- earnings expectations and financial-quality calculations under
  `skills/earnings-review/` and their existing Workflow integrations.

The current architecture and project-state documents confirm that Workflow
owns routing, lifecycle, persistence policy, and canonical mutation boundaries;
Skills own semantic methodology; and Pi-native Skills remain a separate
namespace. Existing reports and Knowledge projections are compatibility
requirements, not permission to retain composite Skills as the canonical
architecture.

## 3. Architecture

The runtime flow is:

```text
User request
  -> existing ResearchDispatchService
  -> explicit Workflow, one canonical Skill, or Free Research
  -> flat ResearchSkillRegistry
  -> Skill result / Workflow result
  -> existing report and Knowledge projection path
```

The registry descriptor is minimally extended so an executable Research Skill
exposes:

- canonical `id`;
- `purpose` / intent description;
- natural-language `invocationMatch` and `whenToUse` guidance;
- declared `inputs` and `produces` metadata;
- bounded `SKILL.md` methodology source;
- existing output contract and capability compatibility metadata where needed.

There is no new routing service. `ResearchDispatchService` remains the entry
point and continues to respect explicit Workflow selection. Semantic resolution
may use the descriptor fields, current request, and intermediate-result
readiness. The deterministic fallback remains bounded and is not treated as a
classifier.

Skills cannot import or invoke another Skill entry point, the Skill Registry,
or a Workflow. Related Skills in documentation are advisory metadata for the
existing dispatcher/Workflow only. Composition, ordering, retry, gates,
report assembly, and Knowledge projection remain Workflow responsibilities.

## 4. Catalog and migration states

The canonical catalog contains exactly these 29 IDs:

```text
evidence_normalization
document_change_analysis
business_model_map
business_driver_analysis
unit_economics
management_execution
capital_allocation_review
market_structure_analysis
industry_supply_demand_cycle
competitive_market_map
consensus_expectations_analysis
earnings_variance_analysis
guidance_analysis
earnings_call_analysis
estimate_revision_analysis
financial_quality_analysis
financial_model_build_update
model_audit
dcf_valuation
reverse_dcf_expectation_decode
comps_valuation
scenario_valuation
valuation_crosscheck
expectation_gap
thesis_formalize
thesis_red_team
catalyst_map
thesis_refresh
research_qc
```

The catalog records domain, research question, status, runtime registration,
current source, current owner, migration action, and notes. Composite product
missions such as Company Research, Earnings Review, Valuation Research,
Industry Research, Event Research, Daily Intelligence, and Thesis Lifecycle
are recorded as Workflows, not catalog Skills.

Initial status is evidence-driven. Existing deterministic valuation and
expectations capabilities may be promoted only where the current implementation
has a stable independent contract and consumer. Missing transcript/Q&A,
complete unit economics, full industry cycle depth, full model build/update,
and other absent capabilities remain `PARTIAL` or `PLANNED` and are not
registered.

`thesis_red_team` is the exception among the legacy names: its existing
independent adversarial contract is normalized into the canonical ID while its
Thesis Lifecycle remains a Workflow.

## 5. SKILL.md contract

Every runtime-registered canonical Skill must have a bounded `SKILL.md` with
these headings and meaningful content:

1. Name
2. Purpose
3. Invocation Match, including when to use and when not to use
4. Typical Intents
5. Inputs
6. Produces
7. Methodology
8. Evidence Requirements
9. Deterministic / Model Boundary
10. Missing Data
11. Validation / QC
12. Related Skills

Invocation Match is semantic prose, not a keyword-only table. Missing data is
fail-closed: missing is not zero, estimated, or inferred. Runtime validation
will reject a registered Skill whose contract lacks the required sections or
whose metadata cannot be extracted consistently.

## 6. Legacy compatibility

The seven existing composite IDs are classified in the migration matrix. A
legacy ID may remain as a transitional compatibility adapter only when a public
API, Workflow, or existing client still requires it. Transitional adapters:

- are explicitly marked deprecated/transitional;
- are not included in new canonical Skill routing;
- do not introduce new research capabilities;
- delegate composition to the existing Workflow or consume canonical Skill
  results;
- have a documented blocker and exit condition.

Removal is permitted only after responsibility mapping, Workflow rewiring,
report compatibility, Knowledge projection compatibility, tests, public API
reference checks, and Research Manager/dispatch independence all pass.

## 7. Phased implementation

The implementation will use logical checkpoints, each with focused validation:

1. Audit and architecture/catalog/migration documents.
2. Descriptor extension, catalog loading, SKILL.md extraction, and registry
   validation.
3. Thesis Red Team canonical normalization.
4. Valuation mapping: DCF/reverse DCF/comps/scenario/cross-check metadata,
   without exposing unavailable DCF product behavior.
5. Earnings mapping: consensus, variance, guidance, revisions, and existing
   financial-quality consumers.
6. Company/industry ownership mapping; leave unsupported methods partial or
   planned.
7. Workflow metadata and composition mapping.
8. Dispatch invocation-match integration and collision tests.
9. Transitional legacy routing cleanup where exit criteria are satisfied.
10. E2E, full regression, acceptance report, branch push, and remote parity.

The exact number of commits may differ from the phase count, but each commit
must be logically complete and recoverable. No phase may weaken an existing
validator or delete a failing test.

## 8. Validation design

Focused validation will prove:

- all 29 catalog IDs exist exactly once with a valid status;
- runtime registration is a subset of the catalog;
- planned Skills are not runtime registered;
- every runtime Skill has the required metadata and SKILL.md sections;
- canonical Skill implementations do not directly invoke another Skill,
  registry, or Workflow;
- collision pairs select the correct narrow intent;
- Workflows map to canonical Skills without nested Skill orchestration;
- legacy adapters remain explicit and non-preferred;
- existing Company, Industry, Earnings, Valuation, Thesis, Event, Daily, and
  Knowledge paths retain their current contracts.

Required routing scenarios include reverse-vs-forward DCF, earnings variance
vs guidance, consensus vs estimate revision, business model vs driver vs unit
economics, expectation gap vs thesis formalization vs red team, and a complete
company request selecting the Company Workflow rather than a composite Skill.

The final gate runs the repository's current typecheck, Node tests, client
typecheck, client build, diff check, focused tests, regression suites, and
high-fidelity narrow Skill/Earnings Mission/Company Mission paths. Evidence
will distinguish fixture-backed validation from authenticated provider/model
E2E.

## 9. Completion conditions

The branch may be reported as `IMPLEMENTED / SOL ACCEPTANCE PENDING` only when
the catalog, contracts, ownership matrix, Workflow classification, migration
status, tests, documentation, final acceptance report, and Git delivery facts
are all present and verified. The final report will identify every PARTIAL or
PLANNED Skill and any remaining transitional legacy ID rather than implying
unsupported capability.
