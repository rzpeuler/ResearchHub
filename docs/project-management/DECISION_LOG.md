# Decision Log

## ADR-001 — Single DSH Architecture

**Status:** Accepted
**Date:** 2026-08-24

ResearchHub adopts one `ResearchManager` DSH and the three supporting
categories Workflow, Skill, and Plugin. This removes ambiguity about
who plans research, who owns methodology, and who connects external resources.

The DSH selects Workflows and coordinates Skills and Plugins. Workflow owns
process structure, Skill owns research method and Artifact creation, and
Plugin owns external access and conversion.

Rejected alternatives were multiple coordination centers, a standalone
operation framework, a separate source framework, and a ResearchHub-owned
workflow engine. None provides a clearer boundary than the selected model.

Compatibility is behavioral rather than path-based: removed package paths are
not retained, while Artifact schemas, Skill logic, Workflow IDs, tool behavior,
and test objectives remain stable.

## ADR-010 — Architecture Simplification

**Status:** Accepted
**Date:** 2026-08-24

ResearchHub is a professional research asset layer running on DeepSeek
Harness, not a general-purpose Agent Framework. Harness owns Agent, Tool,
Session, loading, and LLM runtime services. ResearchManager remains the only
ResearchHub DSH and is intentionally limited to lightweight coordination and
result integration.

Capability Layer and Provider Layer are deprecated as independent concepts
because Harness Tools/Plugins and ResearchHub Plugins already cover their
responsibilities. Research Planner and Workflow Composition layers are also
not introduced: LLM reasoning remains with Harness, and ResearchManager plus
Workflow definitions provide the required coordination.

Memory remains responsible for structured research history: Research Session,
Evidence, Thesis, Prediction, and Review. Evaluation remains responsible for
prediction validation and research quality review. Neither is an autonomous
reasoning layer or an automatic Skill/strategy optimizer.

Architecture v0.3 is the current governance reference. Architecture v0.2 is
preserved as the historical baseline. See
[ADR-010](../architecture/ADR-010-ARCHITECTURE-SIMPLIFICATION.md).

## ADR-011 — DSH Control Plane Location

**Status:** Accepted
**Date:** 2026-08-24

The ResearchManager DSH is the ResearchHub system control plane and therefore
belongs at the repository root in `dsh/`. The `packages/` directory is
reserved for composable Workflow, Skill, Plugin, Artifact, Memory, and
Evaluation modules.

The previous `packages/dsh` location incorrectly placed the control plane
beside capability modules. The directory move changes architecture expression
and import/configuration paths only. ResearchManager business logic and all
research module behavior remain unchanged.

The dependency direction is `dsh/` → `packages/workflows`, `packages/skills`,
`packages/plugins`, `packages/artifacts`, `packages/memory`, and
`packages/evaluation`. No additional DSH, agent layer, planner layer,
Capability Layer, Provider Layer, or Workflow Engine may be added.

See [ADR-011](../architecture/ADR-011-DSH-CONTROL-PLANE-LOCATION.md).
