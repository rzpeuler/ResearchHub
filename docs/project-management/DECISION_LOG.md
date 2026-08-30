# Decision Log

## KNOWLEDGE-V0.3-INTEGRATION-FIX-C-005 - DSH Contract Propagation Correction

**Status:** Completed / Sol Verification Pending
**Date:** 2026-08-31

C-005 fixes the integration defect exposed by C4-R2: the stale DSH adapter did
not serialize the frozen Schema Context or Structured Output Contract and used
the retired request field, allowing real model output to drift to the
unsupported top-level `entityMentions` property. The strict Knowledge
Curation request now requires both contracts, the adapter propagates the
operation and exact contract data, and missing fields fail before transport.

Focused adapter and Skill-to-Adapter tests plus the required regression matrix
are green. No Validator or Schema relaxation, output normalization, retry, or
unrelated runtime surface was introduced. C4-R3 real-PDF validation waits for
Sol acceptance of C5. Stage C remains `In Progress / Awaiting C5 Sol
Verification`.

## KNOWLEDGE-V0.3-PRODUCT-VALIDATION-C-004-R2 - Real PDF Product Validation

**Status:** Completed / Engineering Rework Required - Sol verified
**Date:** 2026-08-31

C4-R2 ran from the required `bd55e759cf65f31f3980fffc66d984686318484c`
baseline lineage with a clean working tree and no production diff. Process
credential isolation made the `.env` fingerprint authoritative; DeepSeek
`GET /models` returned HTTP 200 and the configured `deepseek-v4-pro` model was
available. The exact PDF hash matched, Docling Local completed successfully,
and a fresh writable Schema 0.3 / Storage 1 KB passed initial full validation.

The normal Workflow persisted Raw first and reached the real
`understandReport` call. The model returned the unsupported top-level field
`entityMentions`; strict Curation validation rejected it as
`invalid_model_output`. The run therefore returned `FAIL / SOL REVIEW REQUIRED`
and stopped before extraction, reconciliation, ChangeSet, C3, Writer, reload,
replay, reprocess, and semantic/provenance review. C-005 corrected the DSH
contract-propagation boundary; the C4-R2 product result remains failed and is
recorded as an engineering rework requirement rather than a PASS.
The sanitized Git evidence is
`tests/knowledge/product-validation/evidence/c004-r2-real-pdf-summary.json`.
Stage C remains `In Progress / Awaiting C5 Sol Verification`.

## KNOWLEDGE-V0.3-PRODUCT-VALIDATION-C-004-R1 - Credential-Gated Rerun

**Status:** Completed / Root Cause Identified - Sol verified
**Date:** 2026-08-31

C4-R1 reran from clean baseline `5ecc4a771a592c622f2512dbbd7de6172ca985b0`
using the existing real-validation runner. The configured provider/model and
sanitized official host were recorded, but `GET /models` returned HTTP 401.
The runner stopped before the PDF and semantic stages as required. No model
substitution, fallback, mock, provider switch, or production change occurred.

The durable sanitized evidence is
`tests/knowledge/product-validation/evidence/c004-r1-real-pdf-summary.json`.
The next action was the C4-R2 real validation run recorded above. Stage C
remains `In Progress / Awaiting C4-R2 Sol Verification`.

## KNOWLEDGE-V0.3-PRODUCT-VALIDATION-C-004 - Real PDF Product Validation

**Status:** Blocked / Environment Credential - Historical
**Date:** 2026-08-31

C4 executed the real product-validation path against the specified West
Securities PDF using Docling Local, the normal Research Report Knowledge
Ingestion Workflow, the configured DeepSeek composition, an isolated writable
Schema 0.3 / Storage 1 KB, and Raw-first persistence. Docling completed with
103 pages, 1,523 chunks, 154 sections, 45 tables, 178 images, and 97,784
normalized characters. The first real `understandReport` request terminated
before semantic output, so no candidates, ChangeSet, Writer invocation, or
semantic KB mutation was accepted.

The runner-only credential preflight then verified the blocking cause: the
configured DeepSeek API key was rejected by `/models` with HTTP 401. This was
an environment credential blocker, not evidence of a Curation, Workflow,
Validation, Writer, or Schema defect. C4 was superseded by C4-R1 and C4-R2;
Stage C remains `In Progress / Awaiting C4-R2 Sol Verification`.

## KNOWLEDGE-V0.3-IMPLEMENTATION-C-002-R2-R1 - Curation/Ingestion Correctness Closure

**Status:** Completed / Accepted - Sol verified
**Date:** 2026-08-31

C2-R2-R1 is a narrow corrective patch over the accepted C2-R2 atomic
architecture. It fixes Claim temporal validation against the frozen semantic
shape, makes reconciliation coverage duplicate-aware and exactly once per
candidate, and gives Workflow Source identity one normalized policy shared by
allocation and lookup. Strong URL or complete document metadata is preferred;
otherwise the canonical RawRef is included as a collision guard. Source
classification fields do not participate as identity authority, and the model
cannot provide a Source ID.

The ChangeSet ingestion context now records the actual number of model calls,
while result/log surfaces retain per-call operation, group/batch, attempted,
succeeded, and retryCount details. The active Skill emits a strict v0.3 model
request with required Schema Context and Structured Output Contract. The
existing DSH transport compatibility boundary is retained without changing
DSH, and no legacy Curation operation is restored. C3, Runtime, Writer,
Migration, Schema, Access, frontend, examples, and Runtime KB data remain
outside scope. Stage C remains `In Progress`; Real PDF Product Validation is
awaiting Sol acceptance.

## KNOWLEDGE-V0.3-IMPLEMENTATION-C-002-R2 - Atomic Curation/Workflow Cutover

**Status:** Completed / Accepted - Sol verified
**Date:** 2026-08-31

C2-R2 adopts the frozen Knowledge v0.3 contract as the single active boundary
for Knowledge Curation and Research Report Knowledge Ingestion. The Curation
Skill exposes exactly four operations and injects the C1 Schema Context slice
automatically. The Workflow uses the native Schema 0.3 / Storage 1 index and
the frozen 18-stage sequence, with deterministic batching, Source and
candidate planning, reference resolution, batched reconciliation, conditional
Schema Gap review, dependency-closure isolation, C3 validation, dry-run
virtual Raw validation, and the existing atomic Writer.

This is an atomic in-place cutover: no compatibility shim, second Skill,
legacy Workflow path, or mixed old/new production contract remains. Schema
release activation, Migration, Writer, DSH, examples, and Runtime KB data are
outside this task and remain unchanged. Stage B, C1, C3, C3-R1, C3-R2, and
C3-R3 are recorded as `Completed / Accepted - Sol verified`; C2 and C2-R1 are
`Blocked / Superseded`; Stage C remains `In Progress`.

## KNOWLEDGE-V0.3-IMPLEMENTATION-C-003-R3 — Final ChangeSet Validation Boundary

**Status:** Completed / Sol Verification Pending
**Date:** 2026-08-31

C3-R3 preserves the C3-R2 shared canonical validation architecture and C3-R1
planned-state simulation. After all Source and Knowledge operations are
simulated, the ChangeSet Validator now passes the complete final object map
through `validateV03CanonicalObjects`, then evaluates the existing global
invariants. This makes receipt issuance contingent on the semantic validity of
unchanged dependent objects as well as directly mutated objects.

Successful `dry_run` validation returns only its validation report and never
creates a `ValidatedKnowledgeChangeSetV03`. Commit mode still returns the
deeply immutable cloned receipt with the stable ChangeSet hash. Regression
coverage includes Entity subtype dependency invalidation, normal dry-run,
virtual Raw dry-run, and existing commit receipt behavior. Writer, Full
Validator, Schema, Curation, Workflow, Migration, and Runtime KB data were not
modified. C3, C3-R1, and C3-R2 remain `Completed / Rework Required`; C2-R2
remains `Not Started / Awaiting C3-R3 Sol Acceptance`.

## KNOWLEDGE-V0.3-IMPLEMENTATION-C-003-R2 — Shared Canonical Validation Core

**Status:** Completed / Sol Verification Pending
**Date:** 2026-08-28

C3-R2 establishes `packages/skills/knowledge-validation/v03-validation-core.ts`
as the single pure canonical object-validation implementation for Knowledge
Schema 0.3. It derives fields, enums, endpoints, constraints, and reference
semantics from `KNOWLEDGE_SCHEMA_V03`, and accepts only an in-memory planned
object map plus Raw and taxonomy reference context. It has no filesystem,
Loader, Writer, Access, Workflow, DSH, LLM, or network dependency.

The Full Validator retains filesystem-only responsibilities and delegates
canonical object rules and final Business Exposure cardinality to the core.
The ChangeSet Validator retains envelope and planned-state simulation, then
delegates every resulting canonical object to the same core before issuing a
receipt. `requiresRawProvenance` is enforced for affected Sources; Claim
provenance remains optional but is strict when supplied. C3-R1 behavior and
Writer defense-in-depth checks remain unchanged. Curation, Workflow,
Migration, Schema, and Runtime KB data were not modified. C3 and C3-R1 remain
`Rework Required`; C2-R2 remains not started pending C3-R2 Sol acceptance.

## KNOWLEDGE-V0.3-IMPLEMENTATION-C-003-R1 — Runtime Acceptance Gap Closure

**Status:** Completed / Sol Verification Pending
**Date:** 2026-08-28

C3-R1 retains the accepted C3 Runtime architecture and closes its independent
acceptance gaps. v0.3 ChangeSet validation now maintains an in-memory planned
state across Source merge, Knowledge create/update/supersede/merge_source,
checks expected target hashes against the validation snapshot, and evaluates
final Business Exposure cardinality from that planned state. Claim supersede
simulation matches Writer semantics. Successful validation returns a
structured-cloned, recursively frozen receipt while leaving the caller's
ChangeSet unchanged.

Focused tests cover atomic Source merge plus dependent Claim provenance,
representative Source/ThemeGroup/Entity/Relation/Claim writes, relation
updates, Claim supersession, legal and illegal source merges, no-op and
idempotency behavior, validation-time stale state, Raw behavior, an invalid
ChangeSet matrix, and all three Writer recovery failpoints. Curation,
Workflow, migration transformation code, and Runtime KB data were not
modified. C3 remains `Completed / Rework Required`; C2-R2 remains
`Not Started / Awaiting C3-R1 Sol Acceptance`.

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

## KNOWLEDGE-ARCHITECTURE-003 — Knowledge Architecture v0.3 Freeze

**Status:** Accepted / Current Normative Knowledge Architecture
**Date:** 2026-08-27

Sol/CTO independently verified the Knowledge v0.3 freeze package against
commit `47e312f79a221d7dd45b42508e52526fd61b1a74`. Knowledge Architecture v0.3
is therefore adopted as the current normative Knowledge architecture and
Schema 0.3 / Storage Format 1 is the current target semantic contract.

The frozen v0.3 documents define the ThemeGroup, Entity, Relation, Claim,
Source, Module, and RawRef model; the Reference Taxonomy and Projection
Configuration auxiliary-asset boundary; object-kind durable IDs; explicit
0.2 → 0.3 migration; one Curation Skill with four operations; the 18-stage
ingestion Workflow; and deterministic Knowledge integrity boundaries. The
complete definitions remain in the linked frozen documents rather than being
duplicated here.

Knowledge Architecture v0.2 and its supporting documents remain Frozen Legacy
and are the compatibility/migration source. The current runtime implementation
is still predominantly v0.2; Schema 0.3 runtime migration and Implementation
Stage A have not started. The next approved engineering direction is Stage A —
Executable Schema / Domain Model. No new Agent, Manager, Planner, Engine,
Graph DB, Vector DB, RAG, or other architecture layer is introduced.

See [Knowledge Architecture v0.3](../architecture/RESEARCHHUB_KNOWLEDGE_ARCHITECTURE_V0.3.md),
[Knowledge Layer Architecture](../architecture/KNOWLEDGE_LAYER_ARCHITECTURE.md),
and the [Knowledge Architecture Freeze Index](../architecture/RESEARCHHUB_KNOWLEDGE_ARCHITECTURE_FREEZE_INDEX_2026-08-26.md).

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
## KNOWLEDGE-V0.3-IMPLEMENTATION-B-003-R1 — Deterministic migration policy closure

**Status:** Completed / Rework Required
**Date:** 2026-08-27

The Schema 0.2 to 0.3 migration policy is now explicit and deterministic. Missing
required Entity/Relation/Intelligence lifecycle values default to active with a
warning; unsupported Source types map to `unknown` while preserving legacy type;
approved Entity/Source compatibility fields are preserved under
`metadata.legacyV02`; Claim temporal and affected-reference compatibility is
mapped without invented dates; and Claim category is explicitly discarded with
a warning. Genuine relation and rich Claim semantic decisions remain Review.

The exact Git-managed example remains unchanged and intentionally gated by its
expected semantic/dependent Reviews. A fresh disposable clone of the real
Runtime KB passed zero-Review dry-run, committed to Schema 0.3 / revision 1,
and passed canonical v0.3 validation. The original Runtime KB was not changed.
Schema 0.3 Runtime activation and v0.3 Writer/Curation/Workflow/Frontend work
remain outside this task.

## KNOWLEDGE-V0.3-IMPLEMENTATION-B-003-R2 — Temporal migration safety closure

**Status:** Completed / Accepted - Sol verified
**Date:** 2026-08-27

Every explicit legacy temporal field is now accounted for. Equivalent period
candidates deduplicate only on exact scope type and label; conflicting legacy
candidates emit `temporal_semantic_conflict`; explicit temporal remains
authoritative and only a compatible null label is enriched. Non-string temporal
values emit `legacy_temporal_invalid` and are never silently ignored.

The exact example remains deterministic with 15 accounted Reviews, including
two newly exposed invalid numeric periods. Metadata collision regressions pass,
the real Runtime KB was validated through fresh isolated clones, and the
duplicate agent-specific B3-R1 design file was removed from the current tree.
Stage B is `Completed / Accepted - Sol verified`; Sol verification is complete.

## KNOWLEDGE-V0.3-IMPLEMENTATION-C-001 — Schema Context foundation

**Status:** Completed / Sol Verification Pending
**Date:** 2026-08-27

C1 adds one runtime-neutral Schema Context Builder under the existing Knowledge
Curation package. The Builder projects four explicit slices from the single
canonical `KNOWLEDGE_SCHEMA_V03` authority: `report_understanding`,
`knowledge_extraction`, `reconciliation`, and `schema_gap`.

The projection is synchronous, deterministic, side-effect free, and deeply
copied. It does not mount or query a Knowledge Base, access filesystem/network/
plugins/DSH, invoke a model, or introduce KB and Workflow instance values.
Canonical enum and endpoint values are derived from the executable Schema; no
independent canonical enum lists are added. The legacy seven-operation Curation
API and `KnowledgeCurationModelRequest` remain unchanged. C2 owns the later
four-operation and model-request cutover.

Stage B is recorded as `Completed / Accepted - Sol verified` at baseline
`60bf76c045c1d315f3ea90d7733d75d870b7ee54`; Stage C is `In Progress` and C1 is
`Completed / Sol Verification Pending`.

## KNOWLEDGE-V0.3-IMPLEMENTATION-C-001-R1 — Semantic context closure

**Status:** Completed / Sol Verification Pending
**Date:** 2026-08-27

C1-R1 completes the semantic metadata required by the frozen Knowledge Schema
and Curation v0.3 contracts. `KNOWLEDGE_SCHEMA_V03` now provides machine-readable
definitions for ThemeGroup, all Entity types, InvestmentTheme creation policy,
all Claim types and semantic guidance, all Source types and reliabilities, and
every canonical Relation definition. The existing Schema Context Builder
projects these definitions into the appropriate three operation slices while
leaving `schema_gap` as a complete deep copy.

The additions are data-only and non-structural: Schema version, Storage version,
enums, required fields, endpoint contracts, cardinality, numeric constraints,
and validation behavior are unchanged. The legacy seven-operation Curation API
and `KnowledgeCurationModelRequest` remain unchanged; C2 is not started.

Stage B remains `Completed / Accepted - Sol verified`; Stage C is `In Progress`;
C1 is `Completed / Rework Required`; C1-R1 is `Completed / Sol Verification
Pending`; C2 is `Not Started / Not Authorized`.
## KNOWLEDGE-V0.3-IMPLEMENTATION-C-003 — Schema 0.3 Runtime Foundation

**Status:** Completed / Sol Verification Pending
**Date:** 2026-08-28

C3 completes and activates the runtime foundation for the already frozen
Knowledge Schema 0.3 / Storage Format 1. The default adapter uses
`CanonicalV03KnowledgeLoader`; native v0.3 runtime state, index, Access,
ChangeSet validation, Raw archive compatibility, and the single dispatched
Writer now preserve canonical v0.3 semantics. Atomic staged writes retain
revision, idempotency, target-hash, registry, and recovery guarantees.

Schema 0.2 remains readable and writable, Schema 0.1 remains readable and
non-writable, and no Schema 0.4 or downstream Curation/Workflow cutover is
introduced. C2-R1 remains `Blocked / Dependency on C-003`; C2-R2 remains
`Not Started / Awaiting C3 Sol Acceptance`; Stage C remains `In Progress`.
