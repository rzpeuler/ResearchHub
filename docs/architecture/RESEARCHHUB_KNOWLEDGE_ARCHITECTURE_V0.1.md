# ResearchHub Knowledge Architecture v0.1

## Document Information

| Field | Value |
|---|---|
| Document | ResearchHub Knowledge Architecture |
| Version | v0.1 |
| Status | Frozen |
| Date | 2026-08-25 |
| Scope | Architecture governance and boundaries |

This document is the normative definition of the Knowledge Layer v0.1. It
freezes architecture boundaries only; it does not introduce an implementation
database, graph engine, extraction pipeline, or production Knowledge Skill.

## 1. Architecture Position

ResearchHub remains a single-DSH architecture. Knowledge is a top-level,
durable asset boundary for reusable industry intelligence; it is not a module
under `packages/` and it is not a runtime coordination layer.

```text
Harness Runtime
      |
      v
dsh / ResearchManager        sole ResearchHub runtime coordinator
      |
      v
Workflow                      business process and lifecycle owner
      |
      v
Skill                         research method and Knowledge access interface
      |\
      | +--------------------> Plugin  external data and service extension
      +----------------------> knowledge/  durable Knowledge asset boundary
```

The arrows describe responsibility and access flow. They do not make
Knowledge a child runtime of DSH, Workflow, or Skill. Knowledge remains
runtime-neutral and can be read by more than one runtime caller through the
Knowledge Skill interface.

### Responsibilities

- **dsh / ResearchManager** is the only runtime coordination center.
- **Workflow** owns Knowledge update orchestration, lifecycle transitions,
  validation steps, and human-review triggers.
- **Skill** owns research methods and provides the Knowledge access interface;
  it is not a Knowledge database or a second runtime.
- **Plugin** provides external data, source, and service connections.
- **Knowledge** stores durable, reusable structured industry intelligence and
  does not coordinate execution by itself.

## 2. Knowledge Content Model

Knowledge v0.1 supports dynamic industry cognition in addition to stable
facts. The normative content categories are:

- `facts` — observed or verified industry and company facts;
- `forecasts` — time-bounded estimates and assumptions;
- `viewpoints` — structured analytical perspectives, including bullish and
  bearish logic and key contradictions;
- `trends` — directional changes and their drivers;
- `risks` — triggers, impact, probability, and invalidation conditions.

The prototype vocabulary may use `Entity`, `Relation`, `Event`, and
`Research` objects to validate frontend requirements. Those objects are a
prototype data contract, not a frozen database schema and not a new
architecture layer.

Knowledge records should preserve source references, confidence, validity
period, and lifecycle state when those fields are applicable. Schema fields
and serialization formats are intentionally not frozen by this document; the
repository asset layout is defined separately below and in the Storage Layout
document.

## 3. Top-Level Asset Boundary

The repository-level `knowledge/` directory is the canonical Knowledge
boundary. Knowledge must not be introduced as `packages/knowledge` or folded
into `packages/memory/` or `packages/evaluation/`.

The concrete v0.1 asset layout is frozen separately in
[Knowledge Storage Layout v0.1](RESEARCHHUB_KNOWLEDGE_STORAGE_LAYOUT_V0.1.md).
That document defines file organization only; it does not freeze Knowledge
schema fields or introduce a runtime layer.

`research-output/` remains the producer-side boundary. Research Output may
provide source material for Knowledge, but there is no intermediate Research
Artifact Layer.

## 4. Lifecycle and Update Ownership

Knowledge is maintained through Workflow-controlled processes:

```text
Research Output / reviewed source
              |
              v
Workflow validation and update orchestration
              |
              v
Knowledge lifecycle state and revision
              |
              v
Knowledge Skill access interface
```

Knowledge lifecycle states are conceptually `active`, `expired`,
`superseded`, and `archived`. A concrete implementation may add metadata, but
the lifecycle decision belongs to the Workflow rather than to an autonomous
Knowledge engine.

The Knowledge Skill exposes read and access operations such as entity,
relation, event, source, company, and supply-chain retrieval. It does not
become an autonomous updater, investment decision engine, stock-ranking
service, valuation service, or advice service.

## 5. Explicitly Excluded Designs

Knowledge Architecture v0.1 does not introduce:

- a Knowledge Database or Graph Database;
- a Vector Database or RAG system;
- LLM Extraction or an automatic knowledge-formation pipeline;
- an autonomous Knowledge update loop;
- a Research Artifact Layer or Research Artifact System;
- a new Capability Layer, Provider Layer, Planner Layer, or Agent layer;
- investment decisions, stock rankings, target prices, or trading signals.

Existing Artifact, Memory, and Evaluation implementations remain only where
needed for compatibility with existing code and tests. They are not part of
the current Knowledge architecture.

## 6. Consistency Rules

When architecture documents use different terminology, the precedence is:

1. this frozen Knowledge Architecture v0.1;
2. the current Research Output and Knowledge architecture summaries;
3. accepted decision records;
4. documents explicitly marked historical or superseded.

`RESEARCHHUB_ARCHITECTURE_V0.3.md`, v0.2, and earlier design records are
historical records. Their deprecated Capability, Provider, Artifact, Memory,
or Evaluation terminology must not be interpreted as current architecture.

## 7. Related Governance Documents

- [Research Output Architecture](RESEARCH_OUTPUT_ARCHITECTURE.md)
- [Knowledge Layer Architecture](KNOWLEDGE_LAYER_ARCHITECTURE.md)
- [Knowledge Skill Interface v0.1](RESEARCHHUB_KNOWLEDGE_SKILL_INTERFACE_V0.1.md)
- [Knowledge Storage Layout v0.1](RESEARCHHUB_KNOWLEDGE_STORAGE_LAYOUT_V0.1.md)
- [ADR-014: Research Output and Knowledge Architecture](ADR-014-RESEARCH-OUTPUT-KNOWLEDGE-ARCHITECTURE.md)
- [Current Status](../project-management/CURRENT_STATUS.md)
- [Decision Log](../project-management/DECISION_LOG.md)
