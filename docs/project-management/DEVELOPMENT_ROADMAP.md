# Development Roadmap

## Completed foundation

- Harness integration and Session persistence.
- Artifact Trace and compatibility Memory/Evaluation foundations.
- Event Analysis and Company Research Skills.
- Industry Research Skill design foundation.
- Workflow definitions, registry, and thin executors.
- Market, information, and financial Plugins with deterministic fixtures.
- Single DSH package migration and architecture documentation.
- Architecture Simplification governance update and Architecture v0.3.
- Research Output, Research Object, and Knowledge Layer architecture.

## Current governance state

- Architecture Freeze: Completed / Sol Accepted
- Governance Integration: Completed / Sol Verification Pending
- Current Normative Knowledge Architecture: Knowledge v0.3
- Legacy Frozen Compatibility/Migration Source: Knowledge v0.2
- Runtime Implementation: predominantly v0.2; migration to v0.3 has not started
- Next approved direction: Implementation Stage A — Executable Schema / Domain
  Model

Stage A has not started and is not part of the Governance Integration task.
Knowledge v0.4 is not approved.

## Runtime implementation status: v0.2 compatibility track

Knowledge Architecture v0.2, Knowledge Base Instance Architecture v0.1,
Storage Layout v0.2, Schema Versioning and Migration, Data Schema v0.2,
Access/Validation/Curation contracts, Ingestion Workflow, Write Interface,
Frontend Projection v0.2, Example KB Layout, and ADR-015 are design-complete
and frozen. Knowledge Runtime Migration Phases A–E are accepted after Sol
verification and Closed / Complete. This phase is an engineering migration,
not a new
architecture design exercise. The D2 R2 ingestion audit and partial-planning
contract, together with the R3 public-result completion semantics, are
accepted as part of the completed Phase D governance record.

The v0.3 frozen architecture is the target for future implementation stages.
The existing runtime and completed migration records below describe the
v0.2-compatible implementation track. The AI Hardware dataset is now a
Git-managed Example Knowledge Base at
`examples/knowledge-bases/ai-hardware/`. It is not user Runtime Data; real
user KB roots remain configurable Runtime Data.

## Migration roadmap

### Phase A — Source / Runtime ownership migration foundation — Accepted / Complete

- Knowledge Base Manifest
- explicit KnowledgeBaseHandle
- Runtime Data Root configuration
- version-aware Loader
- Schema Adapter
- KB-scoped Registry

Phase A implementation and focused/default validation are complete. R1 closed
the canonical Schema 0.2 Registry, read-only compatibility, and Source domain
contract gaps. R2 closed Registry identity integrity, canonical Module runtime
index derivation, and strict Source enums. Sol verified Phase A.

### Phase B — Existing Knowledge implementation migration — Accepted / Complete

- migrated the repository AI Hardware dataset to an example KB layout;
- add KB scoping to Access Skill, Validation, and Frontend Projection;
- preserve existing deterministic behavior and fixture coverage;
- expose scoped HTTP response envelopes and safe KB-relative view resources.

Phase B is accepted after Sol verification.

### Phase C — Knowledge mutation infrastructure — Accepted / Complete

- Raw Archive;
- deterministic Write Interface and ChangeSet validation receipts;
- source/Knowledge mutations, revision guards, target hashes, lock, staging,
  recovery, and idempotency;
- ingestion logs and post-commit Handle refresh.
- R1 closed Raw Manifest, KB-scoped Raw lifecycle, Source mutation, planned
  state, and mandatory full staged-validation contract gaps.
- R2 finalized the shared same-KB mutation lock across Raw Archive and Writer,
  the frozen Writer error taxonomy, and the Phase B governance acceptance
  correction. Sol verified Phase C.

### Phase D1 — Knowledge Curation Skill — Accepted / Complete

- provider-neutral injected `KnowledgeCurationModel` port;
- Source Assessment and document/chunk relevance filtering;
- atomic candidate extraction, structured admission, and Schema Mapping;
- conflict analysis and Schema Gap proposals;
- deterministic output validation and trusted scope/provenance guards.

D1 does not orchestrate Raw Archive, Access, Validation, Writer, Workflow, or
durable persistence. Sol verified D1 acceptance.

### Phase D2 — Research Report Knowledge Ingestion Workflow — Accepted / Complete

- Knowledge Curation Skill;
- relevance and quality filtering;
- Knowledge Admission;
- conflict analysis and Schema Gap proposals;
- Research Report Knowledge Ingestion Workflow;
- commit/dry-run, deterministic identity, idempotency, partial continuation,
  structured audit logging, and DSH Curation adapter.

D2 implementation and Sol verification are complete. Overall Phase D is
accepted / complete.

D2 R1 contract rework is complete and accepted after Sol verification. It
closes dry-run/readonly validation, Raw byte preservation, no-change handling,
operation-level candidate rejection, bounded partial continuation, audit-log
projection, and WorkflowStep ownership metadata gaps.

### Phase E — Migration infrastructure — Accepted / Complete

- Migration Registry;
- Migration Runner;
- explicit Schema 0.1 / Storage 1 to Schema 0.2 / Storage 1 migration;
- dry-run, whole-Knowledge-Base staging, source/target validation, review
  blocking, recovery, and migration-log contracts;
- default migration-availability reporting for readable legacy bases.

Phase E implementation and Sol verification are complete. Knowledge Runtime
Migration A–E is Closed / Complete. No Phase F is approved. At the Phase E
closure checkpoint, the next direction was Knowledge Product Validation / Real
Data Integration. That historical direction subsequently produced the Product
Validation work recorded below. Following the Knowledge v0.3 Architecture
Freeze and Governance Integration, the current next approved engineering
direction is Stage A — Executable Schema / Domain Model.

Future work remains subject to separate approval. Do not label the v0.2
Runtime capabilities as implemented based on frozen documentation alone.

### Product validation setup — Historical checkpoint: Completed / Awaiting Local Inputs

The local runtime setup for AI Hardware Product Validation is ready: an
external `ai-hardware-real` Runtime KB, ignored secret configuration, the
official DeepSeek provider composition, PDF/text report resolution, real
ingestion entrypoints, and explicit frontend Runtime KB selection. Real
validation was intentionally pending local inputs at that checkpoint. Those
inputs are now configured; the first execution result is recorded below. No
implementation scope for the next product phase is defined here.

R1 closes the runtime dependency boundary: real product validation no longer
uses AgentLoop TestKit, Agent, Session, Tools, or SystemPrompt services. The
official provider composition is verified against a local deterministic HTTP
server only. The setup record itself made no real report call; the resumed
execution result is recorded below.

The earlier `KNOWLEDGE-PRODUCT-VALIDATION-RUN-001` checkpoint remains recorded
as `Paused / DOCUMENT_RESOLUTION`; it stopped before any paid request. The
Document Resolution Parent and R1 are now accepted, and the local Docling
model cache is ready. The resumed result is recorded under
`KNOWLEDGE-PRODUCT-VALIDATION-RUN-001-R1` below; no architecture expansion is
proposed.

### Document Resolution — Completed / Accepted

The Document Plugin now provides canonical raw-byte ownership, deterministic
parser provider selection, an explicit `pdfjs-text` fallback, and a local
`docling-local` bridge with structured chunks and quality diagnostics. The
Workflow continues to depend only on `ResearchReportInputResolver`. R1 adds a
managed Python environment, explicit local artifacts path, resumable model
prefetch, doctor checks, and offline parsing validation. The real report's
Docling parse passed with 1,523 structured chunks, 158 headings, 45 tables,
178 image metadata items, and page provenance across 103 pages; its PDF.js
baseline also passed exact byte preservation. Document Resolution Parent and
R1 are accepted — Sol verified.

### First real AI Hardware validation run R1 — Product Validation Blocked

The resumed run used exactly one specified West Securities PDF and one real
DeepSeek V4 Pro call. Docling completed locally with 103 pages, 1,523 chunks,
97,784 normalized characters, 158 headings, 45 tables, 178 image metadata
items, 154 sections, and 103 page-provenance pages. The exact Raw PDF was
archived in external Runtime KB `ai-hardware-real`, while its revision remained
0 and no semantic Knowledge object was written.

Curation blocked during Source Assessment because the model returned an
unsupported `sourceType`; downstream curation and reference resolution did
not run, and no retry was attempted. Knowledge Validation still passed on the
unchanged base KB with zero errors and warnings. The real frontend projection
is healthy at `http://localhost:4174/tests/knowledge/`, but displays only the
pre-existing industry anchor because the ingestion produced no semantic
changes. This run is `Product Validation Blocked` and remains
`Review Pending / Sol Verification`.

Every new feature must remain within the existing DSH, Workflow, Skill,
Plugin, Research Output, or Knowledge Infrastructure boundaries. No new Agent,
Planner, Memory, Evaluation, Workflow Engine, Knowledge Agent, Graph DB, Vector
DB, RAG, or automatic Schema evolution layer may be introduced.
