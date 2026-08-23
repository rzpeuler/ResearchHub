# Research Workflow Framework MVP Design Spec

**Task:** RH-ENG-009  
**Status:** Approved for implementation

## Decision

Implement a declarative Workflow Definition and Registry, a framework-agnostic
Research Manager coordinator, and a Harness-facing service/tool adapter. The
MVP executes the approved `event-analysis` definition through an injected
Workflow Executor. It does not implement a Workflow Engine, DSH Loop, or
Plugin Runtime.

The existing News Plugin remains the boundary for both Announcement and
Media plugins. The Event Analysis implementation receives separate News
Plugin instances backed by the announcement and media Plugin Handles.

## Components

- `packages/workflows/`: validated definitions, steps, Registry, and the
  `event-analysis` definition.
- `packages/dsh/research-manager/`: Research Request, execution context,
  Report View, coordinator, and Harness service/tool adapter.
- Existing `packages/skills/event-analysis/`: extended with optional
  announcement, media, and financial ports while preserving its current
  market/news behavior.
- Integration fixture: deterministic Plugin composition and Harness DSH
  session persistence.

## Execution contract

1. A Research Request names `event-analysis`, symbol, question, Session ID,
   creation time, and evaluation period.
2. Research Manager validates the request and resolves the definition from the
   Registry.
3. Manager creates an immutable execution context and passes it to the
   injected executor.
4. Event Analysis invokes Market, Announcement News, Media News, and Financial
   Plugins in sequence.
5. The workflow creates Evidence, Thesis, and Prediction using existing
   factories.
6. Manager aggregates Artifact IDs into a non-Artifact Research Report View.
7. Harness records the DSH/tool/session events and persists the Session.

## Compatibility

- Existing Event Analysis tests with only Market + News ports remain valid.
- No existing Plugin contract changes.
- Research Report stores IDs only; it does not duplicate Artifact payloads or
  become a fifth base Artifact type.
- The Harness plugin only registers the Research Manager service and tool.
- Default tests use fixture Plugins and make no network calls.
