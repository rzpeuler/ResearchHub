# Project Overview

ResearchHub is an AI-assisted A-share research system built on DeepSeek
Harness. It is a professional research asset layer, not a general-purpose
Agent Framework. It organizes research into a Single DSH architecture:

```text
ResearchManager (DSH) + Workflow + Skill + Plugin
```

ResearchHub does not execute trades, promise price forecasts, modify Harness
Core, or replace the Harness runtime. Harness owns runtime execution and LLM
reasoning. Artifact, Memory, and Evaluation remain supporting research
modules.

## Current product boundary

- Harness: owns Agent, Tool, Session, loading, and model runtime services.
- DSH / ResearchManager: understands the application request and coordinates
  research execution.
- Workflow: defines repeatable research SOPs, dependencies, and verification.
- Skill: supplies professional research methodology and Artifact generation.
- Plugin: connects external data and persistence resources.
- Memory: preserves Research Session, Evidence, Thesis, Prediction, and Review.
- Evaluation: validates predictions and supports research quality review.

The existing Event Analysis and Company Research flows validate the model from
request through Workflow, Skill, Plugin, Artifact, Evaluation, and Session
persistence.

## Primary references

- [Architecture v0.3](../architecture/RESEARCHHUB_ARCHITECTURE_V0.3.md)
- [Architecture v0.2 historical baseline](../architecture/RESEARCHHUB_ARCHITECTURE_V0.2.md)
- [Technical design](../architecture/TECHNICAL_DESIGN_V0.1.md)
- [Single DSH ADR](../architecture/ADR-001-SINGLE-DSH-ARCHITECTURE.md)
- [Current status](CURRENT_STATUS.md)
