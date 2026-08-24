# Research Workflow Framework MVP Implementation

**Status:** Implemented MVP  
**Task:** RH-ENG-009  
**Runtime:** DeepSeek Harness `0.1.1-rc.2`

## 1. Runtime relationship

```text
Harness DSH / Session / Tool Runtime
                 ↓
Research Manager Harness Service
                 ↓
Research Manager Coordinator
                 ↓
Workflow Registry → event-analysis Definition
                 ↓
Event Analysis Workflow Executor
                 ↓
Market / News / Financial Plugins
                 ↓
Evidence → Thesis → Prediction
                 ↓
Research Report View
```

ResearchHub does not create a Harness Workflow Runtime, Harness Runtime Loop, Session runtime, or
Plugin runtime. The Harness-facing adapter registers the Research Manager
service and `run_research_workflow` tool; Harness owns DSH execution, tool
calls, Session events, and JSONL persistence.

## 2. Workflow Model and Registry

`packages/workflows/` provides:

- `WorkflowDefinition`: identifier, name, description, version, purpose, input
  schema, output schema, and steps.
- `WorkflowStep`: stable ID, Skill reference, named inputs, named outputs, and
  dependency IDs.
- `WorkflowRegistry`: validated registration, duplicate rejection, lookup, and
  defensive snapshots.
- `event-analysis` definition: the approved five-step chain.

The Registry stores definitions only. It does not schedule tasks or run an
DSH loop. The executor is injected into the Research Manager so execution
remains a replaceable application boundary.

The event-analysis request accepts an optional evaluation period. When it is
omitted, the Research Manager normalizes it to a 30-day period beginning at
the request creation time.

## 3. Research Manager

`dsh/research-manager/` contains a framework-agnostic coordinator
and a Harness adapter.

The coordinator:

1. Validates a Research Request.
2. Resolves the requested Workflow from the Registry.
3. Creates an immutable execution context.
4. Invokes the registered Workflow Executor.
5. Validates returned Evidence, Thesis, and Prediction relationships.
6. Creates the Report View from Artifact IDs.

The Harness service adds DSH creation and Session event access, while the
Harness tool converts the current DSH identity into `sessionId`. The Manager
never calls HTTP, Plugin SDKs, databases, or trading APIs.

## 4. Event Analysis Workflow

The registered definition is:

```text
collect-market-evidence
        ↓
collect-announcement-evidence
        ↓
collect-media-evidence
        ↓
collect-financial-evidence
        ↓
generate-research-artifacts
```

Announcement and Media use the existing `NewsPlugin` contract with
different Plugin Handles. No duplicate AnnouncementPlugin or
MediaPlugin was introduced. Financial uses the existing
`FinancialPlugin`.

The existing Event Analysis Skill implementation remains compatible with its
previous Market + News mode. When all four domain ports are supplied, the MVP
collects Market, official announcement, professional media, and Financial
Evidence before generating a neutral Thesis and Prediction.

## 5. Research Report View

The Report View is not an Artifact. It contains:

- `evidenceIds`
- `thesisIds`
- `predictionIds`
- workflow, question, Session, creation time, and trace metadata

It references existing validated Artifact objects and does not duplicate their
payloads. This preserves Artifact serialization, Memory adapters, and
Evaluation inputs.

## 6. Harness integration validation

The integration fixture mounts the real Harness Harness Runtime Loop, Skill Registry,
Skill Tool, and JSONL Session persistence. A deterministic model invokes:

1. Harness `skill` tool to load `event-analysis`.
2. ResearchHub `run_research_workflow` tool.
3. Market, Announcement, Media, and Financial Plugin ports.
4. Artifact generation and Report aggregation.
5. Harness Session flush and persistence.

The end-to-end test confirms six Evidence objects, one Thesis, one Prediction,
one Report View, the expected Session ID, completed turn lifecycle, and
persistent Session events. Fixtures avoid network access and real credentials.

## 7. Boundaries and remaining risks

The MVP does not implement:

- a custom Harness Workflow Runtime or DSH Planner;
- arbitrary DSH-generated executable workflows;
- automatic investment recommendations or trading;
- Report persistence as a new Memory type;
- real-time scheduling or retry policy;
- production data-source availability.

Future workflow work must preserve the existing Architecture v0.2 boundary:
Workflow defines lifecycle, Skill defines methodology, Plugin defines
domain access, Artifact stores research results, and Harness owns runtime
execution.
