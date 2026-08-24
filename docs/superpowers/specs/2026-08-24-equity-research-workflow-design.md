# Equity Research Workflow Composition Design

**Task:** WORKFLOW-DESIGN-001
**Status:** Proposed for review
**Date:** 2026-08-24

## 1. Goal

Add a formal `Equity Research Workflow` under
`packages/workflows/equity-research/`. It composes the existing Company
Research, Industry Research, Equity Research, Earnings Review, and Valuation
Skills into a standard stock-research SOP.

The Workflow is a reusable Research Asset. It does not become a Workflow
Engine, Planner, DSH, Plugin implementation, or new Skill.

## 2. Selected approach

Use a pure composition Workflow with injected Skill Adapters.

The Workflow owns the ordered step definition, shared execution context,
input/output transfer, step status, and final bundle assembly. Each Skill
Adapter owns the translation between the Workflow context and one existing
Skill's typed interface. Plugin ports remain inside the injected Skill
implementations or their adapters; the Workflow never imports Plugin
implementations or data-source code.

This is preferred over direct imports of concrete Skill implementations because
it keeps Skills replaceable and preserves the one-way dependency boundary. A
generic dynamic Workflow Engine is explicitly out of scope.

## 3. Workflow steps

The registered definition is `equity-research`, version `1.0.0`:

1. `company-understanding` — Company Research Skill
2. `industry-analysis` — Industry Research Skill
3. `financial-analysis` — Equity Research Skill
4. `earnings-review` — Earnings Review Skill
5. `valuation-analysis` — Valuation Skill
6. `investment-thesis-generation` — runtime-neutral synthesis of the prior
   outputs into the final research bundle

Steps execute sequentially. Each step receives the original request and the
outputs of completed predecessor steps. The sixth step may assemble linked
Evidence, Thesis, Prediction, and ResearchReport values, but it may not invent
new market data, valuation calculations, or research methodology.

## 4. Interfaces and data flow

The Workflow package defines runtime-neutral contracts:

- `EquityResearchWorkflowInput`: symbol, company name, research question,
  as-of timestamp, and optional earnings period;
- `EquityResearchSkillAdapters`: one typed adapter per Skill step;
- `EquityResearchWorkflowContext`: immutable request plus completed step
  outputs and step states;
- `EquityResearchWorkflowResult`: ordered step states, stage reports, and an
  `EquityResearchArtifactBundle`.

The bundle contains the existing core `Evidence`, `Thesis`, and `Prediction`
Artifacts plus a runtime-neutral `ResearchReport` companion. The core Artifact
model is not changed. The report records the five Skill outputs, source/evidence
references, risks, open questions, and workflow metadata.

The Workflow may normalize and validate inputs, preserve IDs, and link outputs.
It must not call a market, financial, news, earnings, or peer data source
directly.

## 5. Step status and failure behavior

Each step records one of `pending`, `running`, `completed`, or `failed`, with
its step ID and optional error message. A successful result contains six
completed states. Execution is fail-fast: if an adapter rejects, the current
step becomes `failed`, later steps remain `pending`, and the Workflow raises a
typed error containing the failed step ID. No retry policy or scheduler is
introduced.

The DSH integration uses a thin `ResearchWorkflowExecutor` adapter. DSH
selects the registered Workflow and supplies the Skill Adapters; it does not
contain any of the five research methods.

## 6. Registry and integration

Register `equityResearchWorkflowDefinition` in the existing
`WorkflowRegistry` discovery path. Add a Workflow-level test for definition
shape, dependency order, status transitions, output linking, and failure
isolation. Add a DSH integration test proving that ResearchManager can select
and execute the registered Workflow.

The integration fixture supplies deterministic, in-memory Skill Adapters.
Those adapters may use the existing Plugin fixtures, but the Workflow test
itself must observe only adapter interfaces. No network call or provider
credential is required.

## 7. Validation

Acceptance checks:

- DSH can discover and invoke `equity-research`;
- the Workflow invokes all five Skill adapters in order;
- Skills remain independently typed and have no DSH import;
- the Workflow has no Plugin implementation dependency;
- six step states are completed on success;
- the final output contains Evidence, Thesis, Prediction, and ResearchReport;
- serialized core Artifacts round-trip successfully;
- a failed Skill leaves later steps pending and identifies the failed step;
- `npm test` passes.

## 8. Explicit non-goals

- no new Agent, Capability, Provider, Planner, or Workflow Engine;
- no changes to existing Skill business logic;
- no changes to Plugin interfaces or adapters;
- no changes to the core Artifact model;
- no autonomous investment recommendation or strategy optimization;
- no real external data dependency in tests.
