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

**Status:** Accepted; superseded in part by ADR-014
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

At the time of this decision, Memory and Evaluation were retained as
supporting modules for structured research history and review. ADR-014 now
repositions them as compatibility implementations rather than current product
architecture layers. At the time of ADR-010, durable knowledge was described
through repository-level `knowledge/`; ADR-014 and ADR-015 subsequently
separated Knowledge Infrastructure from user Knowledge Base Runtime Data.
Research Output Provenance replaces Artifact Governance as the preferred
terminology.

Architecture v0.3 is preserved as a historical governance record. The current
governance reference is Research Output and Knowledge Architecture;
Architecture v0.2 remains the historical baseline. See
[ADR-010](../architecture/ADR-010-ARCHITECTURE-SIMPLIFICATION.md).

## ADR-011 — DSH Control Plane Location

**Status:** Accepted
**Date:** 2026-08-24

The ResearchManager DSH is the ResearchHub default Runtime Orchestrator and
system control plane and therefore belongs at the repository root in `dsh/`.
The `packages/` directory is reserved for reusable, runtime-neutral Workflow,
Skill, Plugin, Artifact, Memory, and Evaluation modules.

The previous `packages/dsh` location incorrectly placed the control plane
beside capability modules. The directory move changes architecture expression
and import/configuration paths only. ResearchManager business logic and all
research module behavior remain unchanged.

The dependency direction is `dsh/` → `packages/workflows`, `packages/skills`,
`packages/plugins`, `packages/artifacts`, `packages/memory`, and
`packages/evaluation`. Packages must not import `dsh/`, so they remain usable
by another Runtime or external caller. No additional DSH, agent layer, planner
layer, Capability Layer, Provider Layer, or Workflow Engine may be added.

See [ADR-011](../architecture/ADR-011-DSH-CONTROL-PLANE-LOCATION.md).

## ARCH-REFACTOR-002 — Runtime and Asset Dependency Direction

**Status:** Accepted
**Date:** 2026-08-24

The Workflow execution contract is defined under `packages/workflows/` rather
than under `dsh/`. This keeps the shared contract runtime-neutral and removes
the previous `packages/workflows` → `dsh` dependency. The allowed dependency
direction is `dsh/` → `packages/`; the reverse direction is prohibited.

## ADR-012 — Financial Research Skill Asset Migration

**Status:** Accepted
**Date:** 2026-08-24

ResearchHub absorbs high-value financial research methods as four independent
Skill assets: Equity Research, Industry Research, Earnings Review, and
Valuation. The assets preserve analysis frameworks, evidence requirements,
typed command behavior, schemas, and report templates.

The migration is runtime-neutral. Skills receive external data through typed
Plugin ports and do not import DSH, ResearchManager, Claude runtime packages,
MCP runtime packages, or slash-command handlers. DSH remains the caller and
coordination boundary; Skills remain professional research methods.

Provider-specific orchestration, agent bindings, spreadsheet/document
automation, and source-runtime assumptions are intentionally excluded. This
keeps the Research Asset Layer reusable by DSH and other Runtime callers.

## ADR-014 — Research Output and Knowledge Architecture

**Status:** Accepted; partially superseded by ADR-015
**Date:** 2026-08-25

ResearchHub treats Research Output and Knowledge Infrastructure as its
product-facing architecture. Existing DSH, Workflow, Skill, and Plugin
boundaries remain unchanged. Reports, machine-readable Research Objects, and
provenance are published under `research-output/`. ADR-015 subsequently
separates Knowledge Infrastructure from independently owned Knowledge Base
Runtime Data and supersedes the repository-level production `knowledge/`
ownership assumption.

Artifact is retained as a technical compatibility term and Artifact Trace is
repositioned as Research Output Provenance. `packages/memory/` and
`packages/evaluation/` remain for existing callers and tests but are deprecated
as independent product layers. No graph database, RAG system, knowledge
extraction pipeline, autonomous learning loop, or prediction Agent is added.

See [ADR-014](../architecture/ADR-014-RESEARCH-OUTPUT-KNOWLEDGE-ARCHITECTURE.md),
[Research Output Architecture](../architecture/RESEARCH_OUTPUT_ARCHITECTURE.md),
and [Knowledge Layer Architecture](../architecture/KNOWLEDGE_LAYER_ARCHITECTURE.md).

## ADR-015 — Knowledge Base Instance and Runtime Data Separation

**Status:** Accepted / Architecture Freeze
**Date:** 2026-08-26

ResearchHub separates Knowledge capabilities and contracts from actual user
Knowledge Base data. Source Git manages DSH, Workflows, Skills, Plugins,
Knowledge Schemas, adapters, validation, migration code, write infrastructure,
tests, examples, and governance. User Knowledge Bases are independent Runtime
Data instances and are not repository-root source assets by default.

The runtime resolves an explicit `KnowledgeBaseHandle`; there is no implicit
global production Knowledge directory. Each KB owns its manifest, schema
version, storage format version, revision, lifecycle status, raw source
material, provenance, and migration history. Breaking Schema changes require
explicit staged Migration; mount and ingestion never silently migrate data.

The established Single DSH architecture and Workflow/Skill/Plugin boundaries
remain unchanged. A Knowledge Base is not an Agent. No Knowledge Agent,
Multi-Agent architecture, Planner, Workflow Engine, Graph DB, Vector DB, RAG,
autonomous Schema evolution, or automatic semantic migration is introduced.

See [ADR-015](../architecture/ADR-015-KNOWLEDGE-BASE-INSTANCE-AND-RUNTIME-DATA-SEPARATION.md).

## KNOWLEDGE-ARCH-CONSISTENCY-001 — Supersession status

**Status:** Historical semantic foundation; ownership and storage assumptions
partially superseded by ADR-015

The v0.1 semantic model remains valid for Taxonomy, Entity, Relation,
Intelligence, Module, Source, View, and Registry. Its repository-level
production `knowledge/` ownership and storage assumptions are no longer
current. Historical implementation records remain preserved and are not
rewritten.

## KNOWLEDGE-ARCH-CONSISTENCY-001 — Knowledge Architecture v0.1 Freeze

**Status:** Accepted / Frozen
**Date:** 2026-08-25

Knowledge Architecture v0.1 is the historical semantic and implementation
foundation for the ResearchHub Knowledge Layer. Its repository-level
production `knowledge/` ownership and storage assumptions are superseded by
Knowledge Architecture v0.2 and ADR-015. It remains preserved as a historical
record and does not define the current runtime-data boundary.

The frozen boundaries are:

- `dsh` remains the sole runtime coordination center;
- Workflow owns Knowledge update orchestration and lifecycle management;
- Knowledge Skill provides the Knowledge access interface;
- Plugin remains the external data and service extension boundary;
- Knowledge supports dynamic industry cognition as facts, forecasts,
  viewpoints, trends, and risks;
- no Research Artifact Layer is introduced;
- no Knowledge Database, Graph Database, RAG, LLM Extraction, or autonomous
  Knowledge update engine is introduced.

Existing Artifact, Memory, and Evaluation implementations remain only for
compatibility. Historical architecture records may retain deprecated
Capability Layer, Provider Layer, or Research Artifact terminology when those
records are explicitly treated as historical; such terminology is not current
ResearchHub architecture.

See [Knowledge Architecture v0.1](../architecture/RESEARCHHUB_KNOWLEDGE_ARCHITECTURE_V0.1.md),
[Knowledge Skill Interface v0.1](../architecture/RESEARCHHUB_KNOWLEDGE_SKILL_INTERFACE_V0.1.md),
and [Knowledge Storage Layout v0.1](../architecture/RESEARCHHUB_KNOWLEDGE_STORAGE_LAYOUT_V0.1.md).
