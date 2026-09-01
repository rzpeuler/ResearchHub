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

- C2-R2: Completed / Accepted - Sol verified
- C2-R2-R1: Completed / Accepted - Sol verified
- Current Curation runtime: Knowledge v0.3, exactly four operations
- Current Report Ingestion runtime: Frozen Workflow v0.3 / Schema 0.3 / Storage 1
- C4 Product Validation: Blocked / Environment Credential
- C4-R1 Product Validation: Completed / Root Cause Identified - Sol verified
- C4-R2 Product Validation: Completed / Engineering Rework Required - Sol verified
- C5 Integration Fix: Completed / Accepted - Sol verified
- C4-R3 Product Validation: Completed / Runtime Execution Blocker - Sol verified
- C6 LLM Execution Diagnostic: Completed / Accepted - Sol verified
- C7 LLM Reasoning Policy: Completed / Accepted - Sol verified
- C4-R4 Product Validation: Completed / Engineering Rework Required - Sol verified
- C8 Extraction Input Projection: Completed / Accepted - Sol verified
- C4-R5 Product Validation: Completed / Engineering Rework Required - Sol verified
- C9 Extraction Validation Retry: Completed / Accepted - Sol verified
- C4-R6 Product Validation: Completed / Engineering Rework Required - Sol verified
- C10 Validation Feedback: Completed / Accepted - Sol verified
- C4-R7 Product Validation: Completed / Engineering Rework Required - Sol verified
- C11 Relation-Aware Output Contract: Accepted - Sol verified
- C12 Relation Selection Guidance: Accepted - Sol verified
- RH-LLM-DEFAULT-FLASH-001: Accepted - Sol verified
- C4-S1 Flash Extraction Smoke: Completed / PASS - Sol Verification Pending
- C4-R8-FINAL Product Validation: Completed / FAIL - SOL REVIEW REQUIRED
- C4-S2 Post-C12 Extraction Smoke: Completed / Engineering Rework Required - Sol verified
- C13 Candidate-Isolated Validation: Accepted - Sol verified
- C13-R1 Trusted candidateId boundary correction: Accepted - Sol verified
- C4-S3 Post-C13 Real Candidate-Isolation Smoke: Completed / INVALID TEST SETUP - Parent Environment Credential Override - Sol verified
- RH-REAL-ENV-BOOTSTRAP-001: Accepted - Sol verified
- RH-REAL-ENV-BOOTSTRAP-001-R1: Accepted - Sol verified
- S3-R1: Completed / INVALID TEST SETUP - External Execution Boundary Too Short - Sol verified
- S3-R2: Accepted / PASS - CANDIDATE ISOLATION EXERCISED - Sol verified
- C4-R9 Product Validation: Completed / BLOCKED - EXTERNAL SERVICE - SOL REVIEW REQUIRED
- S3: Completed / INVALID TEST SETUP - Parent Environment Credential Override - Sol verified
- Stage C: In Progress / Awaiting C4-R9 Sol Verification

The C2-R2 atomic cutover and C2-R2-R1 correctness closure are implemented and
locally verified. Curation and Report Ingestion now share the frozen v0.3
boundary; no mixed old/new active contract remains. C2-R2 and C2-R2-R1 are
accepted after Sol verification. C4 attempted the authorized real PDF Product
Validation but was blocked by the configured DeepSeek credential. C4-R1
confirmed the environment override and C4-R2 reached the real Workflow before
stopping on deterministic `understandReport` contract rejection. C5 corrected
the DSH contract-propagation boundary and was accepted by Sol. C4-R3 then
verified the credential, model availability, exact PDF, and Docling gates, but
the real DeepSeek stream did not terminate within the controlled execution
window. C6 measured sustained default-high reasoning and confirmed that the
same request with reasoning disabled completes and passes strict validation.
C7 now materializes the operation-specific reasoning policy in every
Knowledge Curation DSH request while preserving the 65,536-token envelope and
all existing contracts. C4-R4 then reached the real extraction call with the
correct reasoning policy, but strict Curation rejected an evidence reference
outside the current batch and stopped the normal Workflow. C8 constrained
`extractKnowledge` model visibility to the authoritative current batch while
retaining the original input for deterministic validation. C4-R5 verified that
boundary on the real PDF, then stopped at a later deterministic relation
endpoint semantic rejection in `batch-0003`; no product PASS is recorded and
Stage C awaited the C4-R5 engineering correction. C9 now adds one
Workflow-owned retry for deterministic extraction validation failures while
preserving strict validation and the C8 projection. C4-R6 reran the real PDF
and confirmed two successful recoveries, but `batch-0009` remained rejected by
`invalid_semantics` after its one allowed retry. The normal Workflow stopped
before reconciliation and semantic commit; no Stage C acceptance or product
PASS is recorded. C9 is accepted by Sol and C4-R6 required deterministic
feedback rework. C10 now enriches Relation endpoint semantic diagnostics from
the executable schema for the existing bounded retry; C10 is accepted by Sol.
C4-R7 reran the real PDF after C10 but stopped after a different semantic
validation error on the one allowed retry. C4-R7 is recorded as
`Completed / Engineering Rework Required - Sol verified`; Stage C remains in
progress pending C11.

C11 now derives a relation-aware `extractKnowledge` Structured Output Contract
from the executable Schema 0.3 relation definitions. Every frozen relation has
one discriminated branch exposing its allowed endpoint types and closed
attribute object. The Validator, C8 projection, C9 retry envelope, C10
diagnostics, DSH boundary, and public output shape remain unchanged. The
bounded C4-S1 smoke passed with the default Flash model and observed the
contract in the real path. C11 and the Flash default are accepted by Sol; the
smoke remains `Completed / PASS - Sol Verification Pending`. Stage C remains
In Progress and is not accepted.

C12 adds concise endpoint-first Relation selection guidance to the extraction
prompt. Its compatibility entries are generated from all 14 executable Schema
relation definitions in stable order, and the retry receives the identical
guide before bounded validation feedback. Offline parity, retry, regression,
and TypeScript checks pass; C12 is `Accepted - Sol verified`. The post-C12 S2
real smoke reached batch-0001 with the guide present but reproduced persistent
invalid `upstream_of` endpoint selections across its one retry. S2 is
`Completed / FAIL - SOL REVIEW REQUIRED`; the R8 failure remains a required
engineering rework signal, and no product acceptance or Stage C closure is
recorded.

DSH multi-provider / other-API capability portability (including reasoning
capability compatibility) is `Deferred / Awaiting Detailed User
Requirements`; no implementation task is created for it.

- Architecture Freeze: Completed / Sol Accepted
- Governance Integration: Completed / Sol verified
- Current Normative Knowledge Architecture: Knowledge v0.3
- Legacy Frozen Compatibility/Migration Source: Knowledge v0.2
- Runtime Implementation: version-dispatched v0.2/v0.3 Writer, native v0.3 read/validation, and migration commit support
- Stage A implementation: Completed / Sol verified
- Stage A R1 structural correction: Completed / Sol verified
- Stage A R2 canonical-reference correction: Completed / Sol verified
- Stage A R3 migration-nullability correction: Completed / Sol verified
- Stage A Raw identity consistency correction: Completed / Sol verified
- Runtime Schema Release: Schema 0.1 readable, Schema 0.2 readable/writable, and Schema 0.3 readable/writable for active KBs
- Stage B: Completed / Accepted - Sol verified
- B1: Completed / Sol verified
- B2 Parent: Completed / Accepted - Sol verified
- B2-R1: Completed / Accepted - Sol verified
- B2-R2: Completed / Accepted - Sol verified
- B3: Completed / Sol verified
- B3-R1: Completed / Rework Required
- B3-R2: Completed / Accepted - Sol verified
- Stage C: In Progress
- C1: Completed / Accepted - Sol verified
- C1-R1: Completed / Accepted - Sol verified
- C2: Blocked / Superseded by C2-R1
- C2-R1: Blocked / Superseded by C2-R2
- C3: Completed / Accepted - Sol verified
- C3-R1: Completed / Superseded by C3-R2/R3
- C3-R2: Completed / Superseded by C3-R3
- C3-R3: Completed / Accepted - Sol verified
- C2-R2: Completed / Rework Required
- C2-R2-R1: Completed / Sol Verification Pending
- Current approved direction: Implementation Stage C — Knowledge Curation v0.3 foundation

Stage B is accepted after Sol verification. B1, B2, and B3 Evidence are
accepted; B3-R2 completed the temporal migration-policy safety closure. C1 now
provides the deterministic Schema Context foundation for Curation v0.3 while
leaving the legacy Curation API and model request unchanged. C3 now activates
the already frozen Schema 0.3 runtime write capability through the shared
version-dispatched runtime. Curation and Workflow cutover remain C2-R2 scope;
Schema 0.4 is not approved.
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
