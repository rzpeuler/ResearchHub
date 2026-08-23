# ResearchHub Research Skill Architecture

**Status:** Design Baseline  
**Task:** RH-DESIGN-009  
**Harness:** DeepSeek Harness `0.1.1-rc.2`

## 1. Purpose and boundary

A Research Skill is a versioned, reusable investment-research methodology.
It explains how a research operation should frame a question, what evidence
is required, how the evidence should be interpreted, and what structured
outputs must be produced.

The Skill is not a data source, Workflow Engine, Agent Runtime, or investment
decision maker.

```text
Harness Agent / Session
          |
      Workflow
          |
        Skill  -- methodology, evidence rules, output contract
          |
    Capability -- structured facts
          |
      Provider -- source adaptation
          |
       Artifact -- Evidence / Thesis / Prediction / Review
```

The existing Architecture v0.2 boundaries remain authoritative:

- Harness owns Agent, Tool, Session, Plugin, and runtime lifecycle.
- Workflow defines the research lifecycle and step dependencies.
- Skill defines the method for a research operation.
- Capability exposes domain facts without exposing Provider implementations.
- Artifact stores traceable research outputs.
- Evaluation compares Prediction with Outcome and creates Review.

## 2. Skill package structure

Every ResearchHub Skill uses the following package shape:

```text
packages/skills/<skill-name>/
├── SKILL.md              # required normative contract
├── index.ts              # optional export/composition boundary
├── types.ts              # optional Skill-specific types
├── workflow.ts           # optional executable adapter, never a runtime
├── harness-tool.ts       # optional Harness adapter
└── *.test.ts             # Skill and contract tests
```

`SKILL.md` is the source of truth for the method. TypeScript files may provide
an adapter or deterministic implementation, but they must not silently add
methodological rules absent from the document.

The package name is stable and lowercase, for example
`packages/skills/event-analysis/`. A Skill may depend on Capability interfaces,
Artifact factories, and Evaluation contracts. It must not import a concrete
Provider, call HTTP, access a database, or own Session persistence.

## 3. SKILL.md standard

`SKILL.md` begins with YAML Front Matter. The required metadata is:

```yaml
---
name: event-analysis
id: event-analysis
version: 1.0.0
status: active
description: Build a neutral, structured research artifact bundle.
capabilities:
  - market.get_market_snapshot
  - information.search_company_news
outputs:
  - evidence
  - thesis
  - prediction
---
```

Metadata rules:

| Field | Requirement |
| --- | --- |
| `name` | Harness Skill discovery name; keep compatible with the existing loader. |
| `id` | Stable package identifier; must match the Skill directory name. |
| `version` | Semantic version of the research method and contract. |
| `status` | `draft`, `active`, or `deprecated`. |
| `description` | One-sentence purpose suitable for Skill discovery. |
| `capabilities` | Logical Capability names and operations, not Provider names. |
| `outputs` | Structured output types expected from the Skill. |

The Markdown body uses these required sections:

1. `Purpose`
2. `Inputs`
3. `Research framework`
4. `Workflow interaction`
5. `Required capabilities`
6. `Evidence requirements`
7. `Output contract`
8. `Quality standards`
9. `Evaluation`
10. `Scope boundary`

Sections may contain examples, but examples do not override the metadata or
the structured contracts.

## 4. Research framework format

The `Research framework` section describes the method in a repeatable form:

| Element | Meaning |
| --- | --- |
| `Question framing` | What question the Skill can answer and what it cannot answer. |
| `Research steps` | Ordered reasoning steps inside the Skill's operation. |
| `Evidence mapping` | Which facts support each analysis step. |
| `Synthesis rules` | How competing or incomplete evidence is handled. |
| `Uncertainty` | How missing, stale, or conflicting evidence is disclosed. |
| `Conclusion form` | What Thesis or other structured result may be produced. |

The framework describes methodology, not orchestration. Cross-domain ordering
belongs in the Workflow Definition. For example, Event Analysis may define a
method for interpreting event evidence, while the Event Analysis Workflow
decides when Market, Information, and Financial Skills or Capabilities run.

## 5. Workflow interaction

The contract between Workflow and Skill is explicit:

```text
Workflow input
    -> Skill input binding
    -> Skill methodology
    -> Capability calls
    -> Artifact creation
    -> Workflow output binding
```

Workflow owns lifecycle, ordering, dependencies, Session context, and final
report aggregation. Skill owns analysis instructions, evidence requirements,
and output quality rules. A Skill can be invoked by more than one approved
Workflow if its input and output contracts are compatible.

The Skill must not:

- define or execute a replacement Agent Loop;
- schedule or retry Workflow steps;
- call Provider implementations directly;
- access raw external data sources;
- persist conversations or Memory entries directly;
- produce an unsupported buy, sell, or trading instruction.

## 6. Capability contract

Skills refer to logical Capability operations, such as
`market.get_market_snapshot` or `information.search_company_news`. Provider
selection, fallback, authentication, normalization, and source metadata stay
behind the Capability/Provider boundary.

This keeps a Skill stable when a Mock, Tushare, AkShare, Announcement, or
Media Provider is changed. The Skill may declare the minimum data shape it
needs, but it must not depend on a particular Provider name.

## 7. Evidence requirements

Every conclusion-producing Skill must state its evidence requirements in a
machine-readable table or equivalent structured subsection:

| Requirement | Required fields |
| --- | --- |
| Evidence type | `market`, `information`, `financial`, or another approved type |
| Minimum count | Minimum number of independent Evidence artifacts |
| Freshness | Acceptable timestamp or period constraint |
| Source metadata | `provider`, `source`, `timestamp`, `quality`, `confidence` |
| Relationship | Artifact IDs referenced by Thesis or Prediction |
| Failure behavior | Whether the Skill blocks, qualifies, or reports missing evidence |

Evidence must be traceable to its source and active Session. A Thesis must
reference the Evidence IDs supporting it. A Prediction must reference its
Thesis and define an evaluation period. The Skill must distinguish observed
facts from interpretation and prediction.

## 8. Output contract

The standard output is a structured Artifact bundle, not free-form Markdown:

```text
Evidence[]
    -> Thesis.evidenceIds[]
    -> Prediction.thesisId + evaluationPeriod
    -> optional Review through Evaluation
```

The Skill must document:

- output Artifact types and required fields;
- Session ID propagation;
- relationship invariants;
- uncertainty and missing-data representation;
- whether the output is eligible for Memory persistence;
- how Evaluation can later consume any Prediction.

Presentation layers may render the bundle as a narrative or Research Report
View, but that rendering is not the Skill's canonical output.

## 9. Quality and Evaluation standards

Each active Skill must define quality checks for:

- input validity and symbol/period normalization;
- evidence completeness and source traceability;
- evidence freshness and confidence disclosure;
- Artifact relationship integrity;
- neutral separation of fact, thesis, and prediction;
- deterministic behavior when fixtures are used in tests.

Evaluation is downstream and objective. It compares a Skill-produced
Prediction with a caller-supplied Outcome and creates a Review. A Skill may
declare which Prediction fields are measurable and which metrics are useful,
but it must not evaluate its own correctness, rewrite its methodology, or
automatically optimize an investment strategy.

## 10. Versioning and lifecycle

Skill versions use semantic versioning:

- **MAJOR:** changes to inputs, required evidence, output Artifact relations,
  or interpretation rules that can break consumers.
- **MINOR:** backward-compatible methodology additions or optional outputs.
- **PATCH:** wording clarifications, examples, or non-semantic corrections.

The `status` field controls lifecycle:

- `draft`: not eligible for production Workflow registration;
- `active`: approved for the referenced Workflows;
- `deprecated`: kept for historical replay but not selected for new research.

Workflow definitions should pin a compatible Skill version or version range.
Changing a Skill version does not change Harness Core or Plugin lifecycle.

## 11. Compatibility validation

The design is compatible with the current ResearchHub layers:

- **Workflow:** invokes the Skill and supplies context; it remains the
  orchestrator.
- **Capability:** provides structured facts; the Skill depends on interfaces,
  not Providers.
- **Artifact:** stores Evidence, Thesis, Prediction, and later Review.
- **Memory:** may persist supported structured Artifacts, not raw Skill text or
  entire conversations.
- **Evaluation:** consumes Predictions and Outcomes to create objective
  Reviews.
- **Harness:** loads `SKILL.md`, executes the existing Agent/Tool/Session
  lifecycle, and remains unchanged.

The existing `event-analysis/SKILL.md` is the first Skill targeted for
alignment with this standard. A future implementation task may add the
ResearchHub metadata and contract sections; this design task does not change
that concrete business Skill. Future methodology Skills should follow this
standard without changing the frozen Architecture v0.2 direction.

## 12. Validation checklist for future Skills

Before a Skill becomes `active`, confirm:

- `SKILL.md` metadata and required sections are complete;
- every declared Capability is a logical interface operation;
- no Provider, HTTP, database, or Harness Core dependency is present;
- Evidence requirements map to actual Evidence fields and source metadata;
- Thesis and Prediction relationships are valid;
- Evaluation fields are measurable without self-modifying behavior;
- Skill loading, Capability calls, Artifact creation, and Session traceability
  are covered by tests;
- the compatible Workflow and Skill versions are recorded.
