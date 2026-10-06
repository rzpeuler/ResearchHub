# ResearchHub — Research Skill Architecture v1

Status: `IMPLEMENTED / SOL ACCEPTANCE PENDING` when the RHL-SKILL-ARCH-001
branch satisfies the validation and delivery gates.  
Scope: Research Skill granularity, registry metadata, Workflow composition,
and migration boundaries.  
Knowledge Schema: unchanged.

## Principles

ResearchHub Research Skills have one level. A Skill is a stable, independently
callable, independently testable research capability that can produce a
bounded intermediate result. “Atomic” describes sufficient research granularity;
it does not create a second engineering hierarchy.

```text
User request
  -> ResearchDispatchService
  -> one Workflow for a composite mission
     or one canonical Skill for a narrow question
  -> flat ResearchSkillRegistry
  -> result
  -> existing report / Knowledge projection boundary
```

There is no `top-level -> atomic -> sub-skill` hierarchy and no Skill-to-Skill
execution chain. A Skill must not invoke another Skill entry point, the Skill
Registry, or a Workflow. Related Skills in `SKILL.md` are advisory guidance
only.

## Responsibilities

### Skill

Owns the semantic methodology for one research question, bounded interpretation,
and local result/proposal generation. It declares its purpose, Invocation Match,
inputs, produced artifacts, evidence rules, deterministic/model boundary,
missing-data behavior, and QC requirements.

Skills do not allocate canonical IDs, mutate Knowledge, call Gateway/Writer,
own Workflow lifecycle, or silently invoke another research capability.

### Workflow / Research Mission

Owns composition of peer Skills: selection, ordering, conditions, input
readiness, retry limits, gates, cancellation, report assembly, and Knowledge
projection through the existing Gateway/ChangeSet/Writer path.

Company Research, Earnings Review, Valuation Research, Industry Research,
Event Research, Daily Intelligence, and Thesis Lifecycle are missions or
Workflows, not canonical Skills.

### Helper / Calculation

Owns a pure calculation, validator, parser, normalizer, or contract helper.
It may be shared when it has no Skill identity, orchestration, provider call,
or Knowledge mutation. A helper is not registered as a Skill.

## Runtime descriptor

The existing `ResearchSkillDefinition` is the single registry descriptor. For
canonical research entries it exposes:

```text
id
purpose
invocationMatch
inputs
produces
skillMdPath / methodologySource
executionClass / runtimeBinding
runtimeExecutor for deterministic entries
```

Existing output-contract, capability, and onboarding provenance fields remain
where needed for compatibility. No separate router, planner, provider layer, or
capability framework is introduced.

The runtime registry contains executable canonical Skills only. The catalog has
26 built-in entries: 22 `IMPLEMENTED` and 4 `PLANNED`; no `PARTIAL` status is
used after Wave 5. Cross-domain terminal QC is a Workflow-layer
`ResearchQualityGate`, and valuation cross-check remains Valuation Workflow
composition rather than a canonical Skill.
Approved externally onboarded Skills retain their existing plugin onboarding
boundary and are explicitly marked as external extensions; they are not
silently treated as built-in catalog entries.

## Invocation Match

Invocation Match is natural-language semantic guidance, not a keyword-only
rule. The semantic ResearchDispatch boundary receives the current request,
Workflow definitions, Skill descriptors, and available intermediate results.
It may choose a narrow Skill only when the user asks one research question and
the Skill inputs are ready. A composite request must resolve to a Workflow.

The deterministic path remains a bounded fallback for known, testable intent
shapes. It must fail closed to Free Research when intent is ambiguous rather
than claim a capability from a weak lexical match.

Important collision boundaries:

- `dcf_valuation` answers forward intrinsic value from explicit forecasts;
  `reverse_dcf_expectation_decode` decodes what the current price implies.
- `earnings_variance_analysis` explains reported actual versus expectation;
  `guidance_analysis` explains forward management guidance and its change.
- `consensus_expectations_analysis` describes the current PIT consensus state;
  `estimate_revision_analysis` describes old-to-new estimate changes.
- `business_model_map` explains how the company makes money;
  `business_driver_analysis` explains consolidated result drivers;
  `unit_economics` explains a measurable economic unit.
- `expectation_gap` locates disagreement; `thesis_formalize` states thesis
  propositions; `thesis_red_team` tests how the thesis could fail.

## Evidence and Knowledge boundary

Point-in-time, source class, period alignment, and provenance requirements are
declared by each Skill. Missing is never silently converted to zero, an
estimate, or an inference. A Skill may return `unavailable`,
`insufficient_data`, or an explicit research gap.

Skill results are research-domain results. Durable semantic state is governed
by the existing Workflow -> Knowledge Production Gateway -> validation ->
Writer path. No Skill in this migration changes Knowledge Schema or writes
canonical Knowledge directly.

## Workflow terminal quality gate

`workflows/research-quality-gate.ts` is a reusable Workflow-layer terminal
gate. It runs after acquisition and semantic composition but before the
Knowledge Production Gateway. It checks source-reference integrity and
point-in-time eligibility, period/unit/currency compatibility, forecast to
valuation basis, expectation-to-thesis consistency, thesis-to-catalyst
proposition linkage, peer-quality warnings, and optional-section status. It
does not reacquire evidence, invoke Skills, mutate Knowledge, or average
valuation methods. `eligibleForGateway` is false only when an `ERROR`
diagnostic is present.

## Migration and compatibility

Legacy composite IDs are not canonical ownership. They may remain transitional
only while a public API or Workflow still references them. A transitional entry
must be marked, excluded from new narrow routing, and have a documented exit
condition. Removal requires responsibility mapping, Workflow rewiring, report
compatibility, Knowledge projection compatibility, tests, and no dangling API
references.

The legacy product capabilities remain available through their existing
Workflows while their internal analytical ownership is reconciled in the
migration matrix. Report section ownership does not imply ownership of the
underlying analytical capability.

## Validation invariants

Automated checks must prove:

1. The catalog contains exactly 26 unique canonical IDs: 22 `IMPLEMENTED`
   and 4 `PLANNED`; `research_qc`, `evidence_normalization`, and
   `valuation_crosscheck` are not canonical catalog IDs.
2. Built-in runtime IDs are catalog IDs and `PLANNED` IDs are not registered.
3. Every runtime Skill has valid descriptor metadata and all required
   `SKILL.md` sections; deterministic entries have a callable binding to their
   authoritative implementation.
4. Canonical Skill code contains no direct cross-Skill or Skill-to-Workflow
   invocation.
5. Workflow mappings refer only to known canonical IDs and compose peers.
6. Collision scenarios resolve to the intended narrow Skill.
7. Semantic Workflow decisions cannot advertise mapped but unavailable Skills.
8. Legacy compatibility, existing reports, Knowledge boundaries, and public
   request contracts remain covered.

The exact test commands are the current repository commands documented in the
RHL-SKILL-ARCH-001 migration report; fixture-backed and authenticated external
E2E results must remain clearly distinguished.
