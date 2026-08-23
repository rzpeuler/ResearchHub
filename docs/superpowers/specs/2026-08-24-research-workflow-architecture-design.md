# Research Workflow Architecture Design Spec

**Task:** RH-DESIGN-008  
**Status:** Approved for architecture documentation  
**Implementation:** Deferred to RH-ENG-009

## Decision

ResearchHub will define a declarative Research Workflow model and a thin
Research Manager coordination boundary. It will reuse the DeepSeek Harness
Workflow Runtime and Agent Loop instead of implementing a new Workflow Engine,
planner, Agent Runtime, or Plugin Runtime.

Research Report is an aggregate research delivery view composed from existing
Evidence, Thesis, and Prediction Artifacts. It is not a new base Artifact type.

## Responsibilities

- Research Manager Agent understands the research question, selects or requests
  a Workflow, coordinates Skills, and assembles the output.
- Workflow Definition describes steps, dependencies, inputs, outputs, and
  allowed Skill references.
- Harness Runtime executes the Agent/session/tool lifecycle.
- Skill describes the methodology for one research operation.
- Capability provides domain data or domain operations through the existing
  Provider boundary.
- Artifact stores validated research results and relationships.
- Memory and Evaluation consume artifacts through their existing adapters.
- Cordis Plugin remains the Harness extension and lifecycle registration
  boundary; it does not become a business workflow container.

## Workflow contract

The future implementation must support a stable model equivalent to:

```ts
type ResearchWorkflow = {
  id: string
  version: string
  purpose: string
  inputs: string[]
  steps: Array<{
    id: string
    skill: string
    inputs: string[]
    outputs: string[]
    dependsOn: string[]
  }>
  outputs: string[]
}
```

This is a definition and validation contract, not an execution engine. Step
execution, scheduling, cancellation, and Session events remain delegated to
Harness-compatible runtime integration.

## Compatibility constraints

- Agent → Skill → Capability → Data Source remains unchanged.
- Provider and Capability boundaries remain unchanged.
- Evidence → Thesis → Prediction relationships remain unchanged.
- Review and Evaluation continue to consume Prediction and Outcome.
- Memory continues to persist supported structured artifacts.
- No business workflow is embedded in a Skill definition.
- No Agent accesses a data source directly.
- No ResearchHub package recreates Harness Workflow Runtime or Plugin Runtime.
