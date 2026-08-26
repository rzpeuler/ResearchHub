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

## Current phase: Knowledge Product Validation / Real Data Integration

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

The AI Hardware dataset is now a Git-managed Example Knowledge Base at
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
Migration A–E is Closed / Complete. No Phase F is approved. The next direction
is Knowledge Product Validation / Real Data Integration; implementation scope
for that direction is not defined here.

Future work remains subject to separate approval. Do not label the v0.2
Runtime capabilities as implemented based on frozen documentation alone.

### Product validation setup — Completed / Awaiting Local Inputs

The local runtime setup for AI Hardware Product Validation is ready: an
external `ai-hardware-real` Runtime KB, ignored secret configuration, the
official DeepSeek provider composition, PDF/text report resolution, real
ingestion entrypoints, and explicit frontend Runtime KB selection. Real
validation is intentionally pending the local API key and report files. No
implementation scope for the next product phase is defined here.

R1 closes the runtime dependency boundary: real product validation no longer
uses AgentLoop TestKit, Agent, Session, Tools, or SystemPrompt services. The
official provider composition is verified against a local deterministic HTTP
server only. Real reports and API credentials remain required for the next
validation run.

Every new feature must remain within the existing DSH, Workflow, Skill,
Plugin, Research Output, or Knowledge Infrastructure boundaries. No new Agent,
Planner, Memory, Evaluation, Workflow Engine, Knowledge Agent, Graph DB, Vector
DB, RAG, or automatic Schema evolution layer may be introduced.
