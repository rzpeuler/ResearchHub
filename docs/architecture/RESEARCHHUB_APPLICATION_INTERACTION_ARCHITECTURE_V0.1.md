# ResearchHub Application Interaction Architecture v0.1

Daily Intelligence FIX-002 uses the existing Pi Application Tool/Application Service surface and shared Workflow boundary. Semantic enrichment, change assessment, and brief synthesis remain bounded `ReasoningExecutor` operations; durable Knowledge mutation remains exclusively Gateway/Validated ChangeSet/Writer mediated.

**Status:** FROZEN  
**Version:** v0.1  
**Date:** 2026-09-06  
**Architecture Decision:** RHL-ARCH-APPLICATION-INTERACTION-001

---

## 1. Purpose

This document defines the normative interaction architecture for ResearchHub as it evolves from the Lite knowledge-production baseline into an Agent-first investment research application.

The architecture assumes the following already accepted foundation:

- Pi Coding Agent is the canonical ResearchHub application host.
- Pi ModelRuntime owns model/provider/authentication/model-catalog/thinking runtime infrastructure.
- ResearchHub does not maintain Agent-host portability as a product requirement.
- Workflow remains the deterministic production control plane.
- Skill remains the semantic research-methodology layer.
- Plugin remains the external-capability/integration layer.
- Canonical Knowledge mutation remains governed by Knowledge Resolution, ChangeSet validation, and Writer authority.
- Durable ReviewCase is the operational mechanism for materially valuable Knowledge proposals that cannot yet be safely committed.

This document defines how users, the Pi Agent, Application Tools, Application Services, Workflows, Knowledge, files, WorkflowRun state, and Review interact.

It does not freeze a frontend framework, network protocol, or visual design.

---

## 2. Product Positioning

ResearchHub is an **Agent-first Research Application**.

The Pi Coding Agent is the primary user interaction surface. Users should normally express research goals in natural language rather than select internal Workflow, Skill, Plugin, Writer, or Review machinery.

ResearchHub is not:

- a generic Agent framework;
- a generic workflow engine;
- a chat system that silently persists every answer;
- a Knowledge editor exposing low-level mutation primitives;
- a collection of Pi Skills;
- a replacement provider/model runtime.

The product combines a strong general-purpose Agent experience with governed long-term investment Knowledge production.

---

## 3. Canonical Interaction Model

The user has three primary interaction classes:

1. **Free Research**
2. **Knowledge Query**
3. **Knowledge Production**

`Review` is not a fourth peer research mode.

Review is a downstream governance mechanism produced by Knowledge Production when a materially valuable proposal cannot be safely committed automatically.

Conceptually:

```text
                           User
                            |
                            v
                    Homepage / Client
                            |
                            v
                    Pi Coding Agent
                            |
          +-----------------+-----------------+
          |                 |                 |
          v                 v                 v
    Free Research     Knowledge Query   Knowledge Production
          |                 |                 |
     Pi tools /        ResearchHub        ResearchHub
       Skills          read tools        production tools
                                              |
                                              v
                                           Workflow
                                              |
                              +---------------+---------------+
                              |                               |
                              v                               v
                       Canonical Knowledge              Durable ReviewCase
                                                              |
                                                              v
                                                        Review Inbox
```

The user does not select an internal execution mode. The Pi Agent interprets natural-language intent and invokes the appropriate product-level capability.

---

## 4. Free Research

Free Research is non-canonical exploratory work.

Typical user intents include:

- analyze a company or industry;
- compare companies;
- summarize a PDF;
- inspect a spreadsheet;
- search the web;
- make a temporary calculation;
- create notes, drafts, or exports;
- use Pi Skills or Pi coding tools;
- explore a research hypothesis.

Pi may use its normal capabilities, including:

- model reasoning;
- read/write/edit/bash;
- Pi Skills;
- Pi Extensions;
- web or future search capabilities;
- user workspace files;
- temporary research outputs.

### 4.1 Persistence Rule

Free Research does **not** automatically become canonical Knowledge.

Its outputs belong to:

- conversation state;
- workspace files;
- temporary research artifacts;
- exports;
- optional seeds for later Knowledge Production.

Free Research may inform a future Knowledge Production request, but the prior answer itself is not canonical Evidence and must not bypass formal provenance requirements.

### 4.2 Proactive Recommendation

The Agent may recommend persistence when appropriate.

Example:

> This analysis appears useful as a durable AI Compute theme. I can build a formal Theme Framework if you want.

The Agent may recommend a Knowledge Production action, but must not silently perform canonical persistence.

---

## 5. Knowledge Query

Knowledge Query reads the current canonical KnowledgeBase.

Typical intents include:

- what does ResearchHub know about a company;
- what industries are associated with a company;
- what is the current Theme Framework;
- what evidence supports a Claim;
- what relationships exist between entities;
- what Knowledge has been updated recently.

Knowledge Query is read-only.

The preferred path is:

```text
Pi Agent
   |
   v
ResearchHub Knowledge Tool
   |
   v
Application Service
   |
   v
Knowledge Query Infrastructure
   |
   v
Bounded Knowledge Projection
   |
   v
Pi Agent Explanation
```

The Agent should not load the whole KnowledgeBase into prompt context.

Knowledge queries return bounded, typed projections or references.

---

## 6. Knowledge Production

Knowledge Production is explicit durable research work intended to create, enrich, refresh, or otherwise change canonical Knowledge.

Typical intents include:

- ingest this report into the KnowledgeBase;
- build a formal InvestmentTheme;
- update an Industry;
- research a Company and persist the result;
- refresh a previously built research structure;
- convert an explicitly approved research result into governed Knowledge.

Knowledge Production must enter a ResearchHub product-level Application Tool and a deterministic Workflow.

Conceptually:

```text
Pi Agent
   |
   v
Product-level Application Tool
   |
   v
Application Service
   |
   v
ResearchHub Workflow
   |
   +--> Research Skills
   +--> Plugins / external evidence acquisition
   +--> Knowledge Resolution
   +--> ChangeSet
   +--> Validation
   +--> Writer
   |
   +--> Durable ReviewCase when unresolved
```

The Pi Agent does not become the Workflow controller.

---

## 7. Explicit Persistence Intent

Canonical mutation requires explicit Knowledge Production intent.

Natural-language understanding may infer that intent; the user does not need fixed commands.

Examples that normally imply non-persistent Free Research:

- "Analyze..."
- "Compare..."
- "What do you think..."
- "Summarize..."
- "What changed recently..."

Examples that normally imply Knowledge Production:

- "Add this to the knowledge base."
- "Build this as a formal theme."
- "Update the PCB industry."
- "Persist this research."
- "Refresh the company research."

When material ambiguity remains, default to non-persistent behavior rather than silently mutating canonical Knowledge.

This principle is normative:

> **Persistence requires explicit Knowledge Production intent.**

---

## 8. Pi Agent Authority

Pi Coding Agent remains a strong application Agent.

ResearchHub does not intentionally reduce Pi to a simple router.

Pi may retain normal general-purpose capabilities such as:

- read;
- write;
- edit;
- bash;
- Skills;
- Extensions;
- images/files where supported;
- session management;
- compaction;
- model selection;
- free-form reasoning.

However, Agent authority and canonical Knowledge authority are distinct.

### 8.1 Agent Authority

Pi may normally operate on:

```text
workspace/**
uploads/**
downloads/**
scratch/**
exports/**
temporary research material
conversation/session state
```

### 8.2 Canonical Knowledge Authority

Pi must not directly perform canonical Knowledge mutation primitives.

Canonical mutation authority remains:

```text
Knowledge Production Workflow
        |
        v
Knowledge Integrity Path
        |
        v
Validated ChangeSet
        |
        v
Writer
```

Pi must not directly:

- allocate canonical Knowledge IDs;
- create Entity/Relation/Claim records in storage;
- modify Registry state;
- rewrite canonical YAML/JSON storage;
- bypass Validation;
- bypass Writer;
- mark a Workflow completed;
- replay stale Review mutation.

The known unrestricted-shell isolation limitation remains separately governed as `BASH_ISOLATION_GAP`; prompt rules and tool interception are not considered a complete operating-system security boundary.

---

## 9. Application Tool Design

ResearchHub Application Tools express **product actions**, not internal mutation primitives.

### 9.1 Allowed Tool Character

Good Application Tools correspond to user-recognizable actions:

```text
search_knowledge
get_knowledge_object
ingest_document
get_workflow_status
cancel_workflow
list_review_cases
get_review_case
```

Future tools may include:

```text
build_theme
research_industry
research_company
refresh_knowledge
resolve_review_case
```

only after the underlying product capability exists.

### 9.2 Forbidden Low-Level Surface

Do not expose Agent tools such as:

```text
create_entity
create_relation
create_claim
allocate_canonical_id
create_changeset
commit_changeset
write_registry
write_knowledge_file
```

The Agent must not reconstruct the Knowledge Production lifecycle through low-level primitives.

---

## 10. Application Service Layer

Application Tools and future UI/API surfaces should consume the same thin Application Services.

Recommended conceptual structure:

```text
app/
├── pi/
│   ├── session.ts
│   ├── tools.ts
│   ├── security.ts
│   └── system-prompt.ts
│
└── services/
    ├── knowledge-service.ts
    ├── production-service.ts
    ├── workflow-service.ts
    └── review-service.ts
```

Dependency direction:

```text
Pi Tool ---------+
                 |
Future Web API --+--> Application Service --> Workflow / Knowledge / Review
```

Application Service exists to prevent Pi tool definitions or UI handlers from importing broad Knowledge internals directly.

It must remain thin.

Do not introduce:

- Command Bus;
- Event Bus solely for abstraction;
- Repository framework;
- generic service container;
- generic DDD framework;
- generic Workflow Engine.

---

## 11. Application Context

A Pi application session may carry lightweight product context.

Minimum conceptual context:

```text
ApplicationContext {
  currentKnowledgeBaseId?
  currentKnowledgeBaseRoot?
  workspaceRoot
  selectedObjectRef?
  attachments[]
  activeWorkflowRunId?
}
```

Application Context stores references and lightweight execution state.

It must not automatically contain the entire KnowledgeBase or large Knowledge payloads.

Normative rule:

> **Application Context stores references, not large Knowledge payloads.**

When detailed Knowledge is required, the Agent calls a bounded Knowledge query capability.

---

## 12. Knowledge Projection

Knowledge supplied to the Agent must be bounded and purpose-specific.

Examples:

- entity summary;
- direct relations;
- supporting Claim references;
- Theme Framework projection;
- relevant Source/evidence bindings;
- bounded neighborhood around a selected object.

The current canonical KnowledgeBase remains global.

Application Context or UI selection does not create separate Theme/Company/Industry Knowledge silos.

---

## 13. Attachment and File Lifecycle

Upload and Knowledge ingestion are different operations.

### 13.1 Upload

```text
User Upload
    |
    v
workspace/uploads/<file>
    |
    v
AttachmentRef
```

After upload, Pi may read, summarize, compare, or otherwise use the attachment in Free Research.

The attachment is not yet canonical Raw/Evidence.

### 13.2 Formal Ingestion

Only after explicit Knowledge Production intent:

```text
AttachmentRef
    |
    v
ingest_document
    |
    v
Document Plugin
    |
    v
Raw Archive
    |
    v
Raw Document Knowledge Ingestion Workflow
```

Normative rule:

> **Upload != Ingestion.**

### 13.3 Free Research Output as Seed

A Free Research answer or temporary file may be supplied as research intent or a seed to a formal Workflow.

It must not automatically become canonical Evidence.

Formal Evidence requires the corresponding Knowledge Production Workflow to establish durable Source/Raw/EvidenceBinding provenance.

---

## 14. Workflow Authority

Workflow owns the deterministic production lifecycle.

The Pi Agent may:

- start an approved product-level Workflow;
- observe its status;
- request cancellation through an Application Tool;
- explain progress and final results;
- present resulting ReviewCases.

The Pi Agent may not:

- reorder Workflow nodes;
- select arbitrary internal next nodes;
- skip validation;
- skip required evidence acquisition;
- jump to Writer;
- arbitrarily retry nodes;
- change terminal state;
- claim progress not supplied by authoritative Workflow state.

Normative rule:

> **Agent decides which product action to invoke; Workflow decides how that production action executes.**

---

## 15. WorkflowRun as Application State

Workflow execution must become observable Application state.

Minimum conceptual contract:

```text
WorkflowRun {
  runId
  workflowType
  objective
  status
  currentStage?
  progressSummary?
  startedAt
  updatedAt
  completedAt?
  reviewCount?
  errorSummary?
}
```

Minimum statuses:

```text
pending
running
completed
completed_with_review
blocked
cancelled
failed
```

### 15.1 Blocked vs Failed

`blocked` means the production lifecycle cannot safely continue because of a business/Knowledge decision or governed unresolved state.

`failed` means runtime, engineering, infrastructure, or unexpected execution failure.

These states must not be conflated.

### 15.2 Authoritative Progress

Workflow progress shown by the Agent or UI must originate from authoritative Workflow/Application state.

The Agent must not invent percentages or stage completion.

This requirement does not imply a generic Workflow Engine.

Each concrete Workflow may expose its state through a shared minimal Application-facing contract.

---

## 16. Review Governance in the Application

Review is a downstream Knowledge Production governance mechanism.

Definition:

> **Review is the durable resolution queue for materially valuable Knowledge proposals that cannot yet be safely committed to canonical Knowledge.**

A ReviewCase should normally exist only when the issue is:

1. **Material**
2. **Unresolved**
3. **Actionable**

Non-actionable malformed output, deterministic rejection, low-value uncertainty, or telemetry must not automatically become user-facing ReviewCases.

### 16.1 Review Sources

Examples include:

- ambiguous Company identity;
- potential new InvestmentTheme;
- ThemeGroup assignment required;
- conflicting evidence that cannot be safely resolved;
- meaningful Schema Gap;
- a root unresolved proposal with suspended dependent proposals.

### 16.2 Review Is Not Report Approval

Review is not a generic "approve this research report" UI.

Review exists because the system has preserved valuable work that cannot yet safely enter canonical Knowledge.

### 16.3 Actionability

The frozen conceptual actionability classes remain:

```text
knowledge_decision
research_followup
schema_design
```

Product UI may group them conceptually as:

```text
Needs your decision
Needs more research
Architecture / Schema
```

### 16.4 ReviewSummary vs ReviewCase

`ReviewSummary` is execution/quality telemetry.

`ReviewCase` is durable actionable operational state.

Only durable actionable ReviewCases belong in the Review Inbox.

---

## 17. Review Interaction

The Agent and future UI may read Review state through the same Application Service.

Current read-oriented tool direction:

```text
list_review_cases
get_review_case
```

`resolve_review_case` must not be exposed until ReviewDecision execution is formally implemented.

A future Review resolution must re-evaluate against the **current** KnowledgeBase and still follow:

```text
ReviewDecision
    |
    v
Binding / Diff / Resolution
    |
    v
ResolutionIntent
    |
    v
ChangeSet
    |
    v
Validation
    |
    v
Writer
```

Review does not add mutation authority.

---

## 18. Structured Application Results

Application Tools should return structured results rather than only free-form prose.

Examples may include:

```text
{
  runId,
  status,
  summary,
  affectedKnowledgeRefs,
  reviewCaseIds
}
```

The Agent converts structured results into user-facing language.

Future UI may render the same structured data directly.

The exact transport/API schema remains unfrozen in v0.1.

---

## 19. Homepage Product Model

The homepage is Agent-first.

Conceptually it may expose:

```text
Navigation / Knowledge Browse
Agent Workspace / Conversation
Context / Current Object / Workflow / Review
```

This is a product concept, not a frozen visual layout.

The architecture does not require explicit user-facing modes such as:

- Chat Mode;
- Research Mode;
- Knowledge Mode;
- Workflow Mode.

Natural-language intent plus Application Tools should normally determine the path.

---

## 20. Current v0.1 Product Capability

At the time of this freeze, the following capability set is appropriate for the first Application layer:

### System

```text
researchhub_status
```

### Knowledge Read

```text
search_knowledge
get_knowledge_object
```

### Knowledge Production

```text
ingest_document
```

### Execution

```text
get_workflow_status
cancel_workflow
```

### Review

```text
list_review_cases
get_review_case
```

Some of these read/status Application capabilities are architecture targets and may not yet be implemented.

Do not expose non-existent production actions merely because they are present in future architecture.

Future actions such as:

```text
build_theme
research_industry
research_company
resolve_review_case
```

must be added only with their corresponding implemented capability.

---

## 21. System Prompt Boundary

The Pi system prompt should remain compact.

It should communicate product authority boundaries, not reproduce the full architecture.

The minimum behavioral intent is:

- Pi is the primary ResearchHub application Agent.
- Pi may freely use ordinary tools and Skills for analysis/workspace tasks.
- Canonical Knowledge queries use ResearchHub Knowledge capabilities.
- Canonical mutation occurs only through ResearchHub Knowledge Production capabilities.
- Free Research is not persisted by default.
- Workflow owns deterministic production lifecycle.
- ReviewCases should be explained clearly to the user.

Knowledge Schema, Writer internals, Resolution algorithms, and large governance text should not be duplicated into the runtime system prompt.

---

## 22. Directory Direction

The application-oriented top-level direction is:

```text
ResearchHub/
├── app/
│   ├── pi/
│   └── services/
├── workflows/
├── skills/
├── plugins/
├── knowledge/
├── workspace/
├── runtime-data/
├── .pi/
├── docs/
└── tests/
```

Only directories required by implemented capability should be created.

Do not create empty future scaffolding solely to match this conceptual tree.

### 22.1 Pi Skills vs ResearchHub Skills

These remain distinct:

```text
.pi/skills/
= Pi Host / Agent Skills

skills/
= ResearchHub semantic research Skills
```

A Pi Skill does not gain canonical Knowledge mutation authority.

---

## 23. Non-Goals / Unfrozen Areas

This v0.1 architecture intentionally does **not** freeze:

- frontend framework;
- React/Vue/Next/Electron choice;
- REST vs RPC vs WebSocket transport;
- final homepage layout;
- visual design system;
- generic Workflow Engine;
- generic Event Bus;
- generic Agent Runtime abstraction;
- Agent-host portability;
- multi-agent orchestration;
- multi-user permission architecture;
- cloud deployment topology;
- asynchronous distributed job architecture;
- Theme Framework implementation;
- Industry Deep Research implementation;
- Company Deep Research implementation;
- ReviewDecision implementation;
- full Review Inbox implementation.

These may be designed when product requirements justify them.

---

## 24. Relationship to Pi

Pi Coding Agent is a direct product dependency and canonical application host.

ResearchHub deliberately reuses Pi for:

- Agent loop;
- session;
- model/provider runtime;
- authentication;
- settings;
- Skills/Extensions;
- ordinary Agent tools;
- compaction and related Agent runtime facilities.

ResearchHub does not maintain a generic host abstraction for Pi replacement.

This does **not** mean ResearchHub business semantics are implemented as arbitrary Pi behavior.

ResearchHub still owns:

- Application Services;
- product-level Application Tools;
- deterministic Workflows;
- Research Skills;
- research/evidence Plugins;
- Knowledge integrity;
- Review governance.

---

## 25. Relationship to ReasoningExecutor

`ReasoningExecutor` remains a ResearchHub semantic-operation boundary and deterministic testing seam.

It is no longer a product-level Agent-host portability contract.

Production semantic reasoning may use Pi ModelRuntime through `PiReasoningExecutor`.

Workflow code should invoke semantic operations through the existing ResearchHub reasoning boundary rather than reusing the conversational Pi session.

Normative separation:

```text
Conversation Session Context
!=
Workflow Semantic Reasoning Context
```

The same Pi ModelRuntime may be shared while the inference contexts remain independent.

---

## 26. Superseded Principles

This architecture supersedes prior current-state assumptions that:

- Codex is the current canonical reasoning/application host;
- Agent-host portability is an active product requirement;
- Workflow/Skill must remain portable across arbitrary host Agents as a primary engineering objective;
- frontend/application interaction is excluded from the active product direction.

Historical validation evidence and historical architecture decisions remain valid as historical records unless directly superseded.

Knowledge safety, Writer, Review, Workflow/Skill/Plugin boundaries, Schema governance, and provenance rules are not superseded.

---

## 27. Frozen Invariants

The following principles are frozen for Application Interaction Architecture v0.1:

1. **Pi Coding Agent is the primary user interaction entrypoint.**
2. **The three primary interaction classes are Free Research, Knowledge Query, and Knowledge Production.**
3. **Review is downstream Knowledge Production governance, not a fourth research mode.**
4. **Free Research is non-persistent by default.**
5. **Canonical mutation requires explicit Knowledge Production intent.**
6. **Pi retains useful general Agent capabilities.**
7. **Canonical Knowledge mutation remains exclusively inside the governed ResearchHub production path.**
8. **Application Tools expose product actions, not Knowledge mutation primitives.**
9. **Application Context stores references and lightweight state rather than large automatic Knowledge payloads.**
10. **Workflow owns deterministic lifecycle; Agent may start, observe, cancel, and explain.**
11. **WorkflowRun and ReviewCase are Application-observable first-class states.**
12. **Agent and future UI/API surfaces consume the same thin Application Services rather than duplicating business logic.**
13. **Upload is not ingestion.**
14. **Free Research output is not canonical Evidence without formal provenance through Knowledge Production.**
15. **Conversation reasoning context and Workflow semantic reasoning context remain separate even when sharing Pi ModelRuntime.**
16. **Review does not bypass Binding/Diff/Resolution/ChangeSet/Validation/Writer.**

Any future change to these invariants requires an explicit architecture decision.

---

## 28. Immediate Engineering Consequence

After this freeze, the next implementation phase should focus on the minimal Application layer rather than frontend visual implementation.

The intended order is:

```text
Application Service v0.1
        |
        +--> Knowledge Query Application capability
        +--> Workflow Status / Cancel capability
        +--> Review read-only capability
        |
        v
Pi Application Tools
        |
        v
Later frontend/API consumption
```

Theme Framework, Industry Research, Company Research, and ReviewDecision remain separate later capabilities.

---

## 29. Final Rule

The core Application Interaction principle is:

> **Pi owns the user-facing Agent experience; ResearchHub owns durable research semantics and canonical Knowledge authority.**
