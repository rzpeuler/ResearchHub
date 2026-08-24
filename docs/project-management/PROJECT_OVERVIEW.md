# Project Overview

ResearchHub is an AI-assisted A-share research system built on DeepSeek
Harness. It is a professional research asset layer, not a general-purpose
Agent Framework. It organizes research into a Single DSH architecture:

```text
ResearchManager (DSH) + Workflow + Skill + Plugin
```

ResearchHub does not execute trades, promise price forecasts, modify Harness
Core, or replace the Harness runtime. Harness owns runtime execution and LLM
reasoning. Research Output and the Knowledge Layer are the product-facing
boundaries. Existing Artifact, Memory, and Evaluation modules remain only as
compatibility implementations.

## Current product boundary

- Harness: owns Agent, Tool, Session, loading, and model runtime services.
- DSH / ResearchManager: understands the application request and coordinates
  research execution.
- Workflow: defines repeatable research SOPs, dependencies, and verification.
- Skill: supplies professional research methodology and structured output
  generation. Its payload remains Skill-owned.
- Plugin: connects external data and persistence resources.
- Research Output: publishes reports, Research Objects, and provenance.
- Knowledge Layer: provides the future durable boundary for entities,
  relations, events, and Research Document associations.
- Memory / Evaluation: legacy compatibility paths; no new product layer or
  autonomous prediction-evaluation loop is planned.

The existing Event Analysis, Company Research, and Equity Research flows
validate the runtime path from request through Workflow, Skill, Plugin, and
Research Output. Existing Artifact, Memory, and Evaluation tests remain as
compatibility coverage.

## Primary references

- [Research Output architecture](../architecture/RESEARCH_OUTPUT_ARCHITECTURE.md)
- [Knowledge Layer architecture](../architecture/KNOWLEDGE_LAYER_ARCHITECTURE.md)
- [Architecture v0.3 historical record](../architecture/RESEARCHHUB_ARCHITECTURE_V0.3.md)
- [Architecture v0.2 historical baseline](../architecture/RESEARCHHUB_ARCHITECTURE_V0.2.md)
- [Technical design](../architecture/TECHNICAL_DESIGN_V0.1.md)
- [Single DSH ADR](../architecture/ADR-001-SINGLE-DSH-ARCHITECTURE.md)
- [Current status](CURRENT_STATUS.md)
