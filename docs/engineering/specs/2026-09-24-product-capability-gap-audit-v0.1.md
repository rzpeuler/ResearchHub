# RHL-NEXT-001 Product Capability Gap Audit v0.1

Date: 2026-09-24
Status: `AUDIT_RECONCILED / SOL REVIEW PENDING`
Baseline: `main == origin/main == e5b3b5dc7fe938b59442ef9a631365e669afaf38`
Audit branch: `codex/next-product-capability-gap-audit`
Audit worktree: `C:\Users\Administrator\Desktop\ResearchHub_Lite_worktrees\NEXT_AUDIT`

This is an analysis-only audit. It does not implement the recommended phase and
does not alter runtime code, tests, source adapters, schemas, or Knowledge data.
Source code and executable contracts are authoritative where prose and code
disagree. “Ready” below means ready within the bounded product scope evidenced
by the repository and acceptance records; it does not mean every external
provider is available.

## Executive Summary

ResearchHub has a substantial bounded research product: the application
runtime, HTTP/SSE and Pi-host path, company/industry/earnings/valuation/event
workflows, Daily morning/evening pipeline, report and bundle persistence,
provenance, and the Gateway → validated ChangeSet → Writer → reload boundary
are implemented and tested.

The largest product break is the transition from research output to maintained
investment knowledge. Thesis formalization and refresh calculations exist, and
Daily change assessment can safely project existing Claims. However, the
unresolved chain is:

```text
research evidence
  → thesis proposition delta
  → ?? canonical proposition representation
  → ?? proposition-to-Thesis binding
  → review-required semantic decision
  → current-Knowledge rebind
  → Gateway / ChangeSet / Writer
  → canonical thesis status / proposition state
```

`thesis_lifecycle` is registered but dispatched directly to a deterministic
function; it has no normal ResearchService-backed durable run or dedicated
HTTP/Pi launch path. ReviewCases are durable and readable, but their current
root proposal contract is limited to Entity, Relation, and Claim, and full
ReviewDecision execution remains explicitly deferred.

Prediction and outcome evaluation are also absent as a product capability.
Schema primitives exist for `claimType=forecast`, `probability`, and temporal
fields, but the repository does not provide a prediction workflow, outcome
acquisition, scoring, or evaluation loop.

Recommended next phase: **Thesis Lifecycle Product Closure**, kept thin and
Workflow-owned. It should connect existing thesis refresh, Daily change
assessment, Earnings evidence, ReviewCase, Gateway, Writer, and report/runtime
surfaces without introducing a generic Agent Runtime, Planner, Capability or
Provider layer, a universal data bus, a new store, or a second canonical write
path.

## Current Product Architecture

The implemented architecture is a local-first Node runtime with React/TypeScript
and Vite client surfaces, HTTP JSON plus SSE, direct Pi SDK embedding, and a
mounted Knowledge Base. `ApplicationRuntime` constructs Knowledge, Review,
Workflow, Production, Research, Daily, and dispatch services. The server exposes
bounded research launch routes, Knowledge projections, reports, bundles, Daily
briefs, and read-only review cases.

The product boundaries are coherent:

- Workflow owns deterministic execution control and routing.
- Skill owns professional semantic methodology.
- Plugin owns external capability integration.
- Knowledge mutation passes through the Production Gateway, validated ChangeSet,
  Writer, reload, and revision checks.
- Daily signals are runtime monitoring artifacts. Only eligible proposals may
  enter canonical Knowledge.
- Pi/Codex is the configured reasoning host; no custom Agent Runtime or Pi RPC
  subprocess architecture is present.

The normal launch surface is strongest for Company, Industry, Earnings,
Valuation, Event, Thesis Red Team, and Daily Intelligence. Reports, bundles,
Knowledge graph, and review cases are query surfaces. The client deliberately
labels the Knowledge graph and review surfaces read-only.

## Capability Matrix

| Capability | Normal Product Path | Deterministic Core | LLM Skill | Data Availability | Knowledge Integration | Real E2E Evidence | User Value | Current Status | Remaining Gap |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Company Research | `POST /api/production/research-company` → ResearchService → report/proposals | Workflow, quality gate, bounded acquisition, report validation | Business model, drivers, unit economics, quality, management, capital allocation, market structure, expectation gap, thesis formalization | Public A-share path; bounded provider failures remain explicit | Gateway/Writer path and canonical Source/Claim/Relation effects | Final validation inventory records fresh real Pi Company completion | Strong company profile and evidence-backed starting point | `FUNCTIONALLY_READY` | No automatic thesis maintenance or prediction loop after the report |
| Industry Research | `POST /api/production/research-industry` → bounded seven-provider workflow | Eight-module workflow, strict evidence classification, report-only quarantine | Market structure, supply/demand/cycle, competitive map | Real bounded TEST-054: 24 qualified public items; provider failures and 21 gaps retained | One Gateway/Writer ChangeSet, reload, and 16-section report acceptance | `INDUSTRY_PRODUCT_QUALITY_READY` artifact and acceptance report | Real industry context without promoting unsupported conclusions | `PRODUCT_READY` | Coverage is bounded; broader provider breadth remains external/data work |
| Earnings Review | `POST /api/production/review-earnings` with exact fiscal period | Period/PIT checks, variance and quality gates, report construction | Consensus, variance, guidance, financial quality, revisions, expectation gap, thesis refresh | Public filings and configured adapters; consensus/revision inputs are not universally available | Report and Source/Claim proposal path; no automatic thesis refresh commit | Final validation inventory records fresh real Pi Earnings completion | Period-specific post-earnings diagnosis | `FUNCTIONALLY_READY` | No durable post-earnings thesis transition or outcome tracking |
| Valuation | `POST /api/production/analyze-valuation` | PE/PB deterministic product path; EV_EBITDA calculator contract exists but accepted live basis is unclosed; automatic PE/PB comps accepted | DCF/reverse-DCF remain semantic/deferred; comps interpretation and scenario reasoning are bounded | PE/PB basis uses accepted D3-001/D3 evidence; EV/EBITDA needs EBITDA, net debt, and shares not closed by the accepted basis path | Report and Source/Claim proposal path for accepted PE/PB/scenario outputs | Real Pi valuation evidence proves PE selection, deterministic recompute, report, and durable proposal; it does not make EV/EBITDA or DCF product-ready | Reproducible PE/PB valuation and bounded expectation decoding | `PARTIAL` | EV/EBITDA is not accepted real product-ready; DCF/reverse-DCF are not deterministic executable engines |
| Thesis | Red-team HTTP path; lifecycle is registry/chat-dispatch path | Formalize/refresh PIT, dependency, kill, unchanged-preservation, quality gate | Thesis formalize, refresh, expectation gap, red team, catalyst map | Requires caller-supplied snapshot/evidence and configured research evidence | Gateway supports Thesis/ReasoningEdge types, but lifecycle does not itself complete the durable path | Focused lifecycle tests; real Pi red-team completion recorded | Maintain a falsifiable investment thesis | `PARTIAL` | Lifecycle is not a normal durable product workflow; no canonical refresh-to-review loop |
| Continuous Research | Bounded Daily scheduler and `startBrief` path | Daily acquisition, dedup, enrichment, assessment, synthesis, optional Gateway | Catalyst/expectation/thesis-refresh semantics where evidence is available | Working fail-soft lanes; D5 records real partial provider coverage | Existing Claim update/contradict/review projection path with replay protection | V1 Daily maintenance report: real Pi FIX-003 passed; D5 breadth is explicit partial coverage | Ongoing monitoring of tracked company evidence | `FUNCTIONALLY_READY` | General cross-workflow continuity is out of scope; no automatic thesis decision closure |
| Daily | Morning/evening HTTP routes, scheduler, brief/report stores | PIT, stable identity, bounded lanes, ranking, assessment, synthesis | Bounded semantic synthesis and change interpretation | Accepted D5 live record: Morning and Evening completed; market 4/4, D1 5, institutional 10, D4 9 per brief; PIT safe; fabricated fallback false | Runtime signals are not canonical automatically; eligible proposals use existing Gateway | D5 real run classified `REAL_DAILY_BREADTH_PARTIAL`; remaining blockers are CNINFO managed parser unavailable and GDELT fetch failure | Daily attention and change awareness | `PARTIAL` | Structured breadth works; document/news breadth remains externally partial; decision closure remains incomplete |
| Prediction | No dedicated product route or workflow | No prediction lifecycle, scoring, or outcome evaluator found | Forecast semantics are schema primitives, not an end-to-end capability | No governed outcome-acquisition path | No prediction/outcome projection path | No real acceptance evidence | Convert research views into testable forecasts | `MISSING` | Need prediction issuance, PIT rules, outcome binding, scoring, and evaluation |
| Review / Evaluation | GET-only `/api/reviews` and `/api/review-cases`; read-only client Inbox | Durable ReviewCase construction, dependencies, projections, limits | Advisory fields may be present; no executed decision skill | Review inputs are generated from production proposals | ReviewCases durable; current-Knowledge rebind → Diff/Resolution → ChangeSet → Validation → Writer is specified, not implemented | Acceptance inventory marks ReviewDecision writes `DESIGN_ONLY_DEFERRED` | Human governance and conflict resolution | `PARTIAL` | Root proposal kinds exclude Thesis; no thesis-scoped decision, re-evaluation, canonical resolution, or outcome evaluation |
| Knowledge | Knowledge search/object/graph/read status plus Production path | Schema validation, ChangeSet, Writer, idempotency, stale revision, reload | Semantic proposals are bounded and validated | Depends on mounted Knowledge Base and source evidence | Canonical boundary is implemented and accepted | Industry and Daily records include Gateway/Writer/reload evidence | Durable provenance and queryable context | `PRODUCT_READY` | Lifecycle consumers do not yet close the full research → decision → learning loop |
| Reports | List/get report routes and client Reports page | Type/subject/time/revision/source/claim validation and persistence | Section content is model-assisted but bounded by contracts | Report truth is limited by acquired evidence | Reports retain source/claim refs and Knowledge revision | Industry 16-section report and report validation tests | Reviewable research artifacts | `FUNCTIONALLY_READY` | Reports are mostly terminal artifacts; user actions do not feed back into the workflow |
| Runtime / CLI / HTTP / Pi | Local runtime, CLI, HTTP/SSE, React client, direct Pi SDK | Bounded dispatch, workflow status, cancellation, persistence policy | Pi reasoning host for semantic operations | Configured host/provider dependent | Mounted KB and services are runtime-gated | Real Pi Company/Earnings/Valuation/Event/Thesis/Daily recorded | Usable local research application | `FUNCTIONALLY_READY` | Capability-specific closure surfaces are uneven, especially thesis and review |

## Company Research

Company Research is a real normal product path with a dedicated HTTP route,
ResearchService adapter, Workflow definition, evidence acquisition, report
validation, and canonical proposal boundary. The workflow composes a broad set
of implemented Skills and has real configured-Pi validation evidence.

The remaining limitation is downstream: Company Research produces a profile
and proposals, but it does not itself establish a durable thesis snapshot,
create a maintained prediction set, or schedule a review of later outcomes.
This is a product workflow/lifecycle gap, not a reason to redesign the company
workflow.

## Industry Research

Industry Research is the strongest externally validated research capability.
The accepted TEST-054 artifact records all eight modules, 24 qualified public
evidence items, a Gateway/Writer ChangeSet, canonical reload, and a validated
16-section report. Provider failures and 21 research gaps are retained as
explicit limitations rather than averaged or fabricated.

No next phase should reopen Industry architecture merely to increase provider
count. Any future improvement should be a separately evidenced source/data
closure.

## Earnings

Earnings Review has exact fiscal-period inputs and deterministic checks for
period, time, quality, and report contracts. The registry maps consensus,
variance, guidance, financial quality, estimate revision, expectation gap, and
thesis refresh Skills. Real configured-Pi Earnings completion is recorded.

The important missing transition is after the review: the result is not a
durable, user-resolvable thesis refresh with explicit proposition deltas,
review cases, and later outcome checks. Consensus and revision evidence also
remain dependent on configured public source availability.

## Valuation

Valuation is a partial but useful product capability. The accepted real basis
path is PE/PB; the current provider outcome deliberately reports
`evEbitdaEligible=false`. The valuation workflow and report may mention
EV/EBITDA, but the accepted D3 real basis does not close the required EBITDA,
net debt, and shares inputs. DCF and reverse DCF are semantic methodology or
Skill-level reasoning paths, not accepted deterministic executable valuation
engines.

| Method | Current repository truth | Product status |
| --- | --- | --- |
| PE | Deterministic executable; accepted basis path; real Pi product evidence | Accepted |
| PB | Deterministic executable; accepted basis path; real Pi product evidence | Accepted |
| EV_EBITDA | Calculator/contract exists, but requires EBITDA + net debt + shares; current accepted basis sets `evEbitdaEligible=false` | Not accepted as real product-ready |
| Comps | Deterministic executable; accepted D3 automatic comps path is PE/PB-based | Accepted in the PE/PB scope |
| DCF | Semantic methodology / Skill-level reasoning where applicable | Not accepted as deterministic executable |
| Reverse DCF | Semantic methodology / Skill-level reasoning where applicable | Not accepted as deterministic executable |

Advanced valuation breadth remains a research-method candidate, not the highest
leverage next phase. The current product can expose an accepted PE/PB valuation
artifact, but it cannot yet connect valuation assumptions to a maintained thesis
or an evaluated forecast.

## Thesis

The repository contains real deterministic thesis semantics. `formalizeThesis`
validates proposition identity, dependencies, sources, and cycles. `refreshThesis`
applies point-in-time evidence, retains unchanged propositions, and evaluates
kill predicates. The lifecycle Workflow composes those calculations with
expectation gap, catalyst map, and optional red-team input.

The product seam is incomplete. The Workflow registry advertises
`thesis_lifecycle`, but dispatch handles it with `Promise.resolve(runThesisLifecycle(...))`
rather than a normal ResearchService run. There is no equivalent
`startThesisLifecycle` service, HTTP launch route, client form, durable report
contract, or automatic trigger from Earnings/Daily evidence. The lifecycle
quality-gate input also has no sources by construction, and missing red-team or
other optional inputs are represented as skipped/diagnostic states rather than
an integrated product path.

## Thesis Canonical Mapping Gap

The methodology layer and canonical Knowledge layer currently use different
representations. `FormalizedThesisResult` contains `thesisId`, `summary`,
`propositions[]`, `dependencies[]`, and each proposition has a local
`propositionId`. This is a valid deterministic methodology result, but the
local proposition IDs are not themselves canonical Knowledge refs.

`KnowledgeThesisV04` currently contains `id`, `subjectRefs`, `title`,
`statement`, `status`, `createdAt`, `lastReviewedAt`, `updatedAt`, and lifecycle
metadata. It does not directly contain `propositionRefs`.

`KnowledgeClaimV04` already supports `claimType` values including `thesis`,
`assumption`, `forecast`, `risk`, and `catalyst`, plus
`supportsClaimRefs`, `dependsOnClaimRefs`, and `contradictsClaimRefs`.
`KnowledgeReasoningEdgeV04` already supports Observation or Claim → Claim or
Thesis endpoints and `supports`, `contradicts`, `depends_on`, `qualifies`,
`invalidates`, and `challenges` edge types.

The smallest reuse-first direction is a recommendation for the next design
phase, not existing behavior:

```text
KnowledgeThesis
  = thesis identity / summary / aggregate status
thesis propositions
  = canonical Claims
proposition relationships
  = existing Claim links and/or ReasoningEdges
evidence impact
  = Observation/Claim → proposition Claim via ReasoningEdge
proposition-to-Thesis relationship
  = ReasoningEdge targeting KnowledgeThesis
```

The next design phase must validate this mapping against all formalize, refresh,
dependency, unchanged-preservation, kill, source, and review semantics before
any code or schema change.

## Continuous Research

Continuous Research is intentionally bounded to Daily Intelligence. The
maintenance report records a real Pi FIX-003 run, Daily Change Assessment,
existing Claim projection, Gateway/Writer/reload, replay protection, and
explicitly excludes a generic cross-workflow scheduler.

That bounded decision is architecturally correct. The remaining gap is not a
generic engine: it is the final action boundary that tells a user which
tracked thesis or assumption changed, what proposal was produced, whether a
ReviewCase is required, and how the user closes it.

## Daily

Morning and Evening are durable report surfaces with an existing scheduler and
bounded acquisition composition. D5 preserves the existing orchestrator and
adds explicit market, expectations, institutional-activity, and exact D4
industry lanes when truthful. The accepted D5 live record has both Morning and
Evening completed, 4/4 market indexes per brief, 5 D1 signals per brief, 10
institutional signals per brief, and 9 D4 signals per brief. PIT was safe and
fabricated fallback was false; the classification is
`REAL_DAILY_BREADTH_PARTIAL`.

The remaining current blockers are CNINFO managed parser unavailable and GDELT
fetch failure. Structured breadth works. Document/news breadth remains
externally partial, and product decision closure remains incomplete. Daily is
not partial because the AKShare structured lanes are broken; the accepted D5
record shows those lanes completed.

Daily is therefore operationally useful but not a complete user learning loop.
Signals can safely support/update/contradict/review existing Claims, but there
is no product-level thesis decision or prediction outcome closure.

## Prediction

No dedicated prediction workflow, launch route, durable prediction object,
outcome-ingestion path, scoring calculation, or evaluation report was found in
the source tree or acceptance inventory. The Knowledge schema provides
`claimType=forecast`, `probability`, and temporal fields, which are useful
schema primitives. They are not a prediction workflow, outcome-acquisition
path, scoring implementation, or evaluation loop.

Prediction should remain out of the recommended phase unless the forcing
question below shows that thesis maintenance cannot be useful without it.

## Review / Evaluation

Review Governance v0.1 deliberately establishes durable, recoverable open
ReviewCases first. `ReviewService` lists and loads them, and the client exposes
them read-only. The architecture specifies the required future sequence:
current Knowledge reload, proposal re-binding, applicable Diff/Resolution,
ResolutionIntent, ChangeSet, Validation, and Writer.

The actual ReviewCase contract is narrower than the future governance sequence.
`ReviewProposalKind` is exactly `entity | relation | claim`; a Thesis is not a
root proposal kind. ReviewCase production currently primarily exists for
unresolved or review-required Claim proposals. A Thesis proposal can be
created/updated through Gateway semantics when complete, but the generic
ReviewCase contract does not itself provide a thesis-decision path.

The same governance document explicitly defers full ReviewDecision execution.
The final external validation inventory marks ReviewDecision writes
`DESIGN_ONLY_DEFERRED`. A full generic ReviewDecision engine is therefore not
necessarily a prerequisite for the recommended phase; a bounded thesis-scoped
human decision action may be sufficient. Any such action must preserve the
current Writer boundary and must not turn the ReviewCase reader into direct
canonical mutation.

There is also no evaluation loop for whether a prior forecast, thesis
proposition, or catalyst was correct. Review currently means governed
knowledge resolution, not measured investment-learning evaluation.

## Human-Owned Decision Boundary

System-owned deterministic actions may include:

- PIT filtering and evidence admission;
- proposition delta calculation and unchanged preservation;
- kill-criterion calculation;
- proposal construction and source/claim binding;
- thesis-scoped ReviewCase creation;
- replay/idempotency and stale-revision detection.

Human-owned semantic decisions presumptively include:

- accepting, rejecting, or deferring a disputed proposition change;
- approving thesis invalidation when semantic judgment is required;
- approving archive or terminal thesis state;
- resolving an unresolved contradiction.

The LLM is not the decision owner. The next phase must distinguish an
objective deterministic threshold from semantic contradiction or uncertain
evidence. A deterministic kill predicate may derive an
`invalidation_condition_met` recommendation; whether canonical Thesis state
becomes `invalidated` must follow the frozen next-phase governance policy.

## Knowledge

Knowledge production is a strength and should be reused. The Gateway builds
bounded proposals and resolution intents, persists actionable ReviewCases,
validates a ChangeSet against the current revision, writes through the shared
Writer, and reloads the canonical handle. Existing Claim update, supersede,
contradict, and review resolutions are present for the Daily path.

The gap is lifecycle ownership by consumers. Thesis lifecycle results are not
yet carried through the same durable product chain, the proposition-to-Thesis
mapping is not frozen, and ReviewDecision is not yet implemented as a
current-Knowledge re-evaluation before Writer execution.

## Reports

Research reports have explicit types for Company, Industry, Earnings,
Valuation, Event, Thesis Red Team, and Daily Brief. Validation requires
subject refs where applicable, timestamps, workflow/revision metadata, and
source/claim reference shape. The Reports and Bundles pages make results
inspectable.

Reports currently terminate most flows. The next phase should add a bounded
link from a report/proposal to a thesis refresh or ReviewCase, not a new report
framework.

## Interaction

The application supports target selection, bounded workflow launch, asynchronous
status, reports, bundles, source search, Knowledge graph inspection, and review
case reading. It does not yet support the complete journey:

```text
select target
  → research / monitor
  → thesis proposition delta
  → ?? canonical proposition representation
  → ?? proposition-to-Thesis binding
  → review-required semantic decision
  → current-Knowledge rebind
  → Gateway / ChangeSet / Writer
  → canonical thesis status / proposition state
```

The missing interaction is not a general dashboard issue. It is the explicit
decision and lifecycle handoff between existing evidence surfaces, including
the two unresolved canonical mapping boundaries marked `??`.

## External Constraints

- Industry has an accepted bounded real-data result: CNINFO, MIIT, and CPCA
  supplied qualified evidence while GDELT, Eastmoney, and AKShare remained
  explicit failure/empty outcomes.
- Daily’s accepted D5 result is `REAL_DAILY_BREADTH_PARTIAL`: Morning and
  Evening completed; market 4/4, D1 5, institutional 10, and D4 9 per brief;
  PIT was safe and fabricated fallback was false. Current blockers are CNINFO
  managed parser unavailable and GDELT fetch failure.
- Provider credentials, login, CAPTCHA/MFA, paid APIs, broker accounts, and
  trading execution remain out of scope.
- Configured-Pi validation is real evidence for completed workflows, but it is
  not evidence that every provider lane or every optional semantic input is
  available.
- No source averaging, fabricated fallback, or fixture-backed production
  acceptance is permitted.

## Redundant / Dead Infrastructure

No large redundant infrastructure removal is authorized by this audit. The
following are boundaries or potentially misleading surfaces that should be
treated carefully in the next phase:

- The `thesis_lifecycle` registry entry is useful metadata and deterministic
  test seam, but its direct dispatch adapter should not be mistaken for a
  complete durable product workflow.
- Daily catalog entries that are reference-only or metadata-only are not
  acquisition paths; D5 correctly requires explicit active composition.
- ReviewCase advisory fields and the Review Governance state-machine prose are
  foundations, not implemented ReviewDecision actions.
- Forecast terminology in the schema is not a prediction/evaluation engine.

The audit found no justification to delete these foundations. Any cleanup must
first prove that a surface is not a contract or test seam.

## Gap Classification

Counts below are descriptive findings; one finding may have more than one
classification. They are not additive project metrics, file counts, or test
failures.

| Gap type | Count | Material findings |
| --- | ---: | --- |
| `RESEARCH_METHOD_GAP` | 2 | No prediction/outcome evaluation method; valuation methods beyond accepted PE/PB remain bounded or semantic |
| `PRODUCT_WORKFLOW_GAP` | 5 | Thesis lifecycle launch/durability; proposition mapping; thesis-scoped decision; post-earnings/Daily handoff; prediction learning loop |
| `KNOWLEDGE_LIFECYCLE_GAP` | 4 | Proposition-to-Thesis mapping; thesis refresh projection; review resolution; prediction outcomes |
| `DATA_GAP` | 3 | Daily provider breadth; earnings expectations/revisions; governed prediction outcome data |
| `SOURCE_RELIABILITY_GAP` | 2 | CNINFO/GDELT Daily blockers; source authority for expectations and outcomes |
| `INTERACTION_GAP` | 2 | Read-only review interaction; no report-to-thesis decision handoff |
| `OBSERVABILITY_GAP` | 1 | No accepted end-to-end telemetry for evidence → thesis decision → outcome learning |
| `DOCUMENTATION_ONLY` | 0 | No material gap is documentation-only; the remaining issues have runtime/product consequences |

## Next-Phase Candidates

### 1. Thesis Lifecycle Product Closure

Connect existing `thesis_lifecycle`, `thesis_refresh`, Earnings, Daily Change
Assessment, canonical Claim/ReasoningEdge/Thesis primitives, report, and
Gateway/Writer semantics into one bounded normal product path. Add only the
minimum durable run, canonical proposition mapping, proposal, and
thesis-scoped human decision interaction needed to make the current thesis
maintainable.

Value: closes the central user journey with the least architectural expansion.
Risk: requires a precise decision about which inputs are mandatory and which
remain explicitly unavailable.
Out of scope: prediction scoring, generic scheduling, new provider layers, and
direct client canonical writes.

### 2. ReviewDecision and Governed Resolution Closure

Implement the smallest thesis-scoped current-Knowledge re-evaluation and user
decision sequence needed by Candidate 1, ending in the existing Gateway,
ChangeSet, Validation, and Writer path. A full generic ReviewDecision engine is
not assumed to be a prerequisite.

Value: makes human governance operational.
Risk: larger interaction and governance surface; should follow or be paired
with a concrete thesis use case rather than becoming a universal action system.

### 3. Prediction and Outcome Evaluation

Define a narrow prediction contract, issue time/PIT rules, outcome source
authority, outcome binding, scoring, and evaluation report. Link results to
claims/theses only after Review Governance decisions are clear.

Value: creates a true learning loop.
Risk: highest data/source ambiguity and a high chance of accidentally creating a
generic prediction framework.

### 4. Daily and Earnings Source Coverage Closure

Improve only the already identified provider lanes and expectation/revision
inputs, preserving explicit unavailable states, source authority, and PIT
rules.

Value: improves breadth of an already useful pipeline.
Risk: external availability is uncertain and does not by itself close the user
decision loop.

### 5. Advanced Valuation Method Closure

Close one specifically selected method beyond the accepted PE/PB scope, with
source-backed assumptions and acceptance evidence, reusing the existing
valuation Workflow and report path. EV/EBITDA remains blocked until EBITDA,
net debt, and shares are closed; DCF/reverse-DCF remain semantic/deferred until
their deterministic basis is separately accepted.

Value: improves analytical depth.
Risk: lower product leverage than thesis/review closure and should not create a
generic method/provider abstraction.

## Recommended Next Phase

`RECOMMENDED_NEXT_PHASE: THESIS_LIFECYCLE_PRODUCT_CLOSURE`

Scope: normal durable Thesis lifecycle + canonical proposition mapping + a
bounded thesis-scoped review decision where necessary. This is not a full
generic ReviewDecision framework and not Prediction/Evaluation.

The next phase should make one target journey complete:

```text
company / thesis selected
  → bounded Earnings, Daily, Event, or explicit refresh evidence
  → thesis proposition delta and unchanged-preservation result
  → canonical Claim/ReasoningEdge proposition mapping
  → quality-gated proposal and report
  → thesis-scoped review decision when binding/semantic decision is unresolved
  → current-Knowledge re-evaluation
  → existing Gateway → validated ChangeSet → Writer → reload
  → canonical thesis status / proposition state
  → visible status, refs, and next action
```

The phase should reuse existing contracts and preserve fail-closed behavior.
It should not implement prediction scoring, broad cross-domain ReviewDecision
categories, new provider infrastructure, a generic continuous engine, or a new
Knowledge store in the same phase.

## Forcing Question

When new PIT-safe evidence changes or contradicts a tracked thesis proposition,
how is that proposition represented and linked in canonical Knowledge, which
transitions may the system apply deterministically, and which Thesis or
proposition state changes require explicit human accept/reject/defer before the
existing Writer may commit them?

The phase should not begin implementation until this is answered for one
bounded target journey, including the behavior for unavailable evidence,
stale Knowledge revision, unresolved identity, objective kill thresholds versus
semantic contradiction, and an explicit user defer.

## Provisional Completion Gate

The recommended phase is provisionally complete only when all of the following
are evidenced on the configured product path:

1. An existing canonical Thesis can be selected.
2. Existing thesis propositions have a deterministic mapping to canonical
   Knowledge without a new parallel store.
3. New PIT-safe evidence produces bounded proposition deltas.
4. Unchanged propositions remain unchanged.
5. Proposition effects map through existing Claim, ReasoningEdge, and Thesis
   primitives where semantically sufficient.
6. A review-required transition produces a durable, attributable review object
   supported by the chosen thesis-scoped decision design.
7. Human accept/reject/defer is explicit for the transitions designated
   human-owned.
8. An accepted action reloads current Knowledge before resolution and fails
   closed on stale revision.
9. Canonical writes still use Gateway → validated ChangeSet → Writer → reload.
10. No Skill, LLM, UI, or client directly mutates canonical Knowledge.
11. A real configured-Pi normal product path demonstrates one complete
    evidence → refresh → decision → canonical state journey.
12. Replay/idempotency, PIT, stale revision, unavailable evidence, unresolved
    identity, and defer are covered.

This gate does not require generic Prediction/Evaluation, a generic
cross-workflow scheduler, all Daily providers, or full cross-domain
ReviewDecision category coverage.
