# Project Overview

ResearchHub is an AI-assisted A-share research system built on DeepSeek
Harness. It organizes research into a Single DSH architecture:

```text
ResearchManager (DSH) + Workflow + Skill + Plugin
```

ResearchHub does not execute trades, promise price forecasts, or replace the
Harness runtime. Artifact, Memory, and Evaluation remain supporting modules.

## Current product boundary

- DSH: understands the research objective and coordinates execution.
- Workflow: defines repeatable research processes and verification nodes.
- Skill: supplies research methodology and Artifact generation.
- Plugin: connects external data and persistence resources.

The existing Event Analysis and Company Research flows validate the model from
request through Workflow, Skill, Plugin, Artifact, Evaluation, and Session
persistence.

## Primary references

- [Architecture](../architecture/RESEARCHHUB_ARCHITECTURE_V0.2.md)
- [Technical design](../architecture/TECHNICAL_DESIGN_V0.1.md)
- [Single DSH ADR](../architecture/ADR-001-SINGLE-DSH-ARCHITECTURE.md)
- [Current status](CURRENT_STATUS.md)
