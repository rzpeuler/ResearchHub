# ResearchHub Research Workflow Architecture

**Status:** Architecture Design  
**Task:** RH-DESIGN-008  
**Next implementation task:** RH-ENG-009 — Research Workflow Framework MVP

## 1. Purpose

ResearchHub already has Market, Information, and Financial data capabilities,
structured Research Artifacts, Memory, and Evaluation. This document defines
the orchestration layer that turns those capabilities into repeatable research
workflows.

The design is intentionally limited to architecture. It does not implement a
planner, workflow engine, autonomous investment decision system, or trading
system.

## 2. Architecture position

```text
User Question
      ↓
Research Manager Agent
      ↓
Research Workflow Definition
      ↓
DeepSeek Harness Workflow Runtime / Agent Loop
      ↓
Skill
      ↓
Capability
      ↓
Provider / Data Source
      ↓
Evidence → Thesis → Prediction
      ↓
Research Report View
      ↓
Memory / Evaluation
```

ResearchHub defines the domain Workflow and its validation contract. DeepSeek
Harness remains responsible for Agent, Session, Tool, Plugin, and Workflow
runtime behavior. ResearchHub must not build a second runtime.

## 3. Boundary with Architecture v0.2

Architecture v0.2 establishes:

- Workflow defines the research task lifecycle.
- Skill represents reusable investment research methodology.
- Agent selects Skills and coordinates Capability usage.
- Capability separates reasoning from data access.
- Plugin extends Harness through its native extension mechanism.

This design preserves those meanings:

| Layer | Responsibility | Explicit non-responsibility |
| --- | --- | --- |
| Research Manager Agent | Understand question, choose workflow/skills, coordinate execution, collect results | Direct data access, financial API logic, trading, final autonomous investment decision |
| Workflow Definition | Declare steps, dependencies, inputs, outputs, and versions | Runtime scheduling, data access, reasoning implementation |
| Harness Workflow Runtime | Execute the workflow through the existing Harness Agent/Session lifecycle | ResearchHub business rules or provider logic |
| Skill | Describe how one research operation is analyzed | Own the complete cross-skill workflow or call external APIs directly |
| Capability | Expose a domain operation and its schema | User-facing orchestration or investment conclusions |
| Cordis Plugin | Register ResearchHub services, tools, skills, and configuration | Store hard-coded business workflow logic or replace Harness lifecycle |

The phrase “Workflow Engine” in future implementation discussions means the
Harness Workflow Runtime. ResearchHub may add a thin coordinator or adapter,
but it must not recreate scheduling, Agent loops, Session lifecycle, or Plugin
lifecycle.

## 4. Workflow model

The future Workflow Framework must validate a declarative model with:

| Field | Meaning |
| --- | --- |
| `id` | Stable workflow identifier, such as `company-research` |
| `version` | Explicit definition version |
| `purpose` | Human-readable research goal |
| `inputs` | Named values required to start the workflow |
| `steps` | Ordered or dependency-linked research operations |
| `steps[].id` | Stable step identifier |
| `steps[].skill` | Skill reference, not an embedded Skill implementation |
| `steps[].inputs` | Input names consumed by the step |
| `steps[].outputs` | Artifact or context names produced by the step |
| `steps[].dependsOn` | Predecessor step identifiers |
| `outputs` | Named values or Artifact references exposed at completion |

The model supports sequential and dependency-linked execution. It does not
prescribe complex planning algorithms. A workflow definition can be selected
by the Research Manager or supplied by a trusted application boundary; the MVP
does not require the Agent to generate arbitrary executable code.

### Example: company research workflow

```text
Input: symbol, researchQuestion
  ↓
Collect market facts       → Evidence[]
  ↓
Collect information facts  → Evidence[]
  ↓
Collect financial facts    → Evidence[]
  ↓
Run research methodology   → Thesis
  ↓
Create measurable outlook   → Prediction
  ↓
Assemble Research Report View
```

Each step references a Skill. Skills may call one or more Capabilities, but a
Skill must not become the owner of the overall workflow graph.

## 5. Research Manager boundary

The Research Manager is the research coordination role exposed through the
Harness Agent boundary. It is responsible for:

- understanding the user’s research intent;
- selecting an approved workflow and required Skills;
- binding workflow inputs to the current research Session;
- coordinating Skill and Capability calls through Harness tools;
- collecting Artifact IDs and preserving traceability;
- assembling a Research Report View;
- handing Predictions to Evaluation and supported Artifacts to Memory.

It must not:

- call Tushare, AkShare, HTTP, databases, or crawlers directly;
- implement provider authentication or data normalization;
- silently invent a new runtime or plugin lifecycle;
- execute trades or place orders;
- convert workflow completion into an autonomous investment recommendation;
- mutate a strategy based on Evaluation results.

## 6. Research Report View

Research Report is a delivery and aggregation object, not a replacement for
the existing Artifact types. Its conceptual shape is:

```ts
type ResearchReport = {
  id: string
  question: string
  sessionId: string
  evidenceIds: string[]
  thesisIds: string[]
  predictionIds: string[]
  createdAt: string
  metadata: JsonObject
}
```

The report references existing Artifact IDs. It does not duplicate the full
Evidence, Thesis, or Prediction payloads, and it does not add a fifth base
Artifact type. This keeps existing Artifact validation, Memory adapters, and
Evaluation inputs compatible.

The report may be rendered as a user-facing narrative by a future application
layer, but the architecture does not define an investment conclusion field or
an automatic recommendation field.

## 7. Lifecycle and traceability

1. Harness creates the Agent and Session.
2. Research Manager resolves the question to an approved Workflow Definition.
3. Harness executes each referenced Skill through the existing Agent/tool path.
4. Skills call Capabilities; Capabilities call Providers.
5. Capabilities and Skills create validated Evidence, Thesis, and Prediction
   Artifacts with the active `sessionId`.
6. Research Manager assembles the Report View from Artifact IDs.
7. Memory adapters persist supported Artifacts; Evaluation later consumes
   Prediction plus caller-supplied Outcome.
8. Harness Session persistence records the execution event stream.

At every stage, source metadata and Artifact relationships remain available for
review. Workflow completion does not imply that a Prediction was correct.

## 8. Compatibility with existing layers

### Artifact

The Report references, rather than replaces, Evidence, Thesis, Prediction, and
Review. Existing factories and serialization contracts remain authoritative.

### Memory

Memory can persist the supported underlying Artifacts. A future Report adapter
may index report-to-artifact relationships, but this design does not change the
Memory Entry schema or add raw conversation storage.

### Evaluation

Evaluation continues to compare Prediction and Outcome and produces Review. A
Workflow may invoke or schedule that relationship in a later phase, but it
does not change the objective Evaluation Engine.

### Harness

ResearchHub uses the pinned DeepSeek Harness `0.1.1-rc.2` interfaces already
validated in `HARNESS_INTEGRATION.md`. Cordis remains the Plugin lifecycle
boundary; the Agent Loop and Session remain the execution and persistence
boundaries. No Harness Core modification or parallel runtime is introduced.

## 9. Scope for RH-ENG-009

The next implementation task may add:

- a validated Workflow Definition model;
- a small registry of approved workflow definitions;
- a thin Harness-facing coordinator;
- step input/output context passing;
- Session event and Artifact trace recording;
- a deterministic company-research fixture workflow.

It must not add:

- a custom Agent loop;
- a custom Workflow scheduler or Plugin runtime;
- arbitrary Agent-generated executable workflows;
- automatic investment decisions or trading;
- new external data dependencies merely to demonstrate orchestration.

## 10. Validation criteria

Architecture validation succeeds when a new Agent can determine from this
document that:

- Workflow is independent from Skill;
- Skill is methodology, not data access or full orchestration;
- Plugin is Harness extension registration;
- Research Manager coordinates but does not make autonomous investment
  decisions;
- Research Report is an aggregate of existing Artifacts;
- Memory and Evaluation remain downstream consumers;
- RH-ENG-009 must reuse Harness runtime facilities.
