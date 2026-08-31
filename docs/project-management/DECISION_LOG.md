# Decision Log

## KNOWLEDGE-V0.3-RELATION-AWARE-OUTPUT-CONTRACT-C-011 - Schema-Derived Relation Contract

**Status:** Completed / Sol Verification Pending
**Date:** 2026-08-31

C11 replaces the generic RelationCandidate model contract with a pure,
deterministic `oneOf` generated from the executable Schema 0.3 relation
definitions. Every frozen relation type has exactly one branch with a precise
relation discriminator, Schema-derived source and target endpoint types, and
closed relation attributes. Relations without declared attributes require an
empty object; array rules become enums, numeric rules retain nullable 0–1
bounds, and `financialContribution` uses its executable field list.

The Validator remains the semantic authority, including same-type endpoint
equality. C8 projection, C9 one-retry policy, C10 diagnostics, reasoning, DSH
serialization, Workflow architecture, and public output shape are unchanged.
Focused and deterministic regression matrices plus TypeScript checks pass. No
real PDF validation was performed.

C4-R7 is `Completed / Engineering Rework Required - Sol verified`; C11 is
pending Sol verification; Stage C remains in progress and is not accepted.

## KNOWLEDGE-V0.3-PRODUCT-VALIDATION-C-004-R7 - Real PDF Validation Result

**Status:** Completed / Engineering Rework Required - Sol verified
**Date:** 2026-08-31

R7 completed the real PDF validation preflight and reached the normal
Knowledge v0.3 extraction path with a fresh isolated Schema 0.3 / Storage 1
Knowledge Base. Credentials, DeepSeek model availability, exact PDF identity,
Docling metrics, Raw-first setup, and initial full Knowledge validation passed.

The first extraction batch failed attempt 1 on an undeclared `component_of`
attribute. Its one C9 retry received bounded feedback and returned a different
`invalid_semantics` Relation endpoint failure with the complete C10 diagnostic:
`RelationCandidate[1] component_of endpoint types invalid: received
industry->industry; allowed source=[product],target=[product]`. The diagnostic
was not truncated and included the candidate ordinal, relation type, received
types, and allowed types. No third attempt was made. The result is classified
as `DIFFERENT_VALIDATION_ERROR`, so the run stopped before downstream stages.

Durable sanitized evidence is
`tests/knowledge/product-validation/evidence/c004-r7-real-pdf-summary.json`.
R7 is `FAIL / SOL REVIEW REQUIRED`; C10 is `Completed / Accepted - Sol
verified`; C4-R7 is `Completed / Engineering Rework Required - Sol verified`;
Stage C remains in progress pending C11 and is not accepted.

## KNOWLEDGE-V0.3-VALIDATION-FEEDBACK-C-010 - Relation Diagnostic Feedback

**Status:** Completed / Accepted - Sol verified
**Date:** 2026-08-31

C10 enriches the existing deterministic `invalid_semantics` Relation endpoint
diagnostics inside the Knowledge Curation Validator. Feedback identifies the
1-based RelationCandidate ordinal, relation type, received endpoint types,
and allowed source/target types read directly from the executable Schema 0.3
relation definition. Same-type constraint violations retain their existing
semantic check and now include the same metadata. No mention text, report
text, model output, or filesystem path is included.

The error code, strict validation authority, C8 projection, C9 eligible codes,
one-retry limit, model-call accounting, and all valid Relation behavior remain
unchanged. Curation, retry, projection, workflow, adapter, Knowledge,
infrastructure, migration, product-validation, and TypeScript checks pass.
No real PDF run was performed. C4-R6 is `Completed / Engineering Rework
Required - Sol verified`; C9 is `Completed / Accepted - Sol verified`; C10 is
`Completed / Accepted - Sol verified`; C4-R7 is `Completed / Sol Verification
Pending`; Stage C remains `In Progress / Awaiting C4-R7 Sol Verification`.

## KNOWLEDGE-V0.3-PRODUCT-VALIDATION-C-004-R6 - Real PDF Validation Result

**Status:** Completed / Engineering Rework Required - Sol verified
**Date:** 2026-08-31

C4-R6 reran the exact required PDF through the normal Knowledge v0.3
Workflow, Local Docling, a fresh writable Schema 0.3 / Storage 1 Knowledge
Base, and real DeepSeek `deepseek-v4-pro`. Credential fingerprints matched
`.env`; `/models` returned HTTP 200 with the configured model; the PDF matched
the required SHA-256 and 3,209,114-byte size; Docling matched 103 pages, 1,523
chunks, 154 sections, 45 tables, 178 images, and 97,784 normalized characters;
and Raw-first persisted the expected RawRef.

The first run formed eight logical extraction batches and made 11 physical
extraction invocations. `batch-0006` and `batch-0008` recovered after one
`invalid_semantics` retry each. `batch-0009` failed the same deterministic
relation endpoint validation on attempt 1 and attempt 2. The Workflow used the
same batch ID, bounded attempt-two feedback, unchanged C8 projection, and
`reasoningEffort=off`; it made no third call. Physical model-call accounting
was 12 for nine logical records plus three retries. No candidates from the
rejected batch were accepted.

The normal Workflow stopped at extraction with `FAIL / SOL REVIEW REQUIRED`.
Consolidation, resolution, reconciliation, Schema Gap analysis, ChangeSet,
C3 validation, Writer, Reload, Replay, Reprocess, semantic review, and
provenance review were not executed after the persistent failure. No
production code was changed. Durable sanitized evidence is
`tests/knowledge/product-validation/evidence/c004-r6-real-pdf-summary.json`.

C4-R6 is `Completed / Engineering Rework Required - Sol verified`; C10 is
`Completed / Accepted - Sol verified`; C4-R7 is `Completed / Sol Verification
Pending`; Stage C remains in progress and is not accepted.

## KNOWLEDGE-V0.3-EXTRACTION-VALIDATION-RETRY-C-009 - Bounded Extraction Retry

**Status:** Completed / Accepted - Sol verified
**Date:** 2026-08-31

C-009 implements the approved bounded retry correction for the C4-R5
`extractKnowledge` validation failure. The Workflow owns retry control and
allows exactly one retry only for deterministic model-output validation codes:
`invalid_model_output`, `invalid_reference`, `invalid_semantics`,
`invalid_confidence`, and `ungrounded_candidate`. Transport, provider,
timeout, credential, infrastructure, Writer, and other Curation failures are
not retried.

The Curation Skill accepts optional attempt-two validation feedback and turns
it into a provider-neutral correction instruction containing only a bounded
error code/message. It never receives the previous model output. Both attempts
use the same authoritative input, C8 projection, Schema Context, Output
Contract, reasoning policy, and strict Validator. No normalization, repair,
candidate deletion, evidence substitution, or third attempt exists.

`ModelCallRecord.retryCount` is `0 | 1` with sanitized validation failures.
Logical extraction batch counters are unchanged, while ChangeSet
`ingestionContext.modelCalls` now equals the actual invocation count derived
from `1 + retryCount` per logical call. Retry state does not enter any durable
identity. Focused tests cover no-retry success, semantic/reference recovery,
persistent failure, `model_error` no-retry, C8 projection preservation, and
two-batch actual-call accounting. The full required regression matrix and
TypeScript integration typecheck pass.

No Schema, Validator, DSH, provider, reasoning, C8 projection, batch, Writer,
Access, Migration, plugin, or frontend code was changed. C4-R5 remains
`Completed / Engineering Rework Required - Sol verified`; C9 is
`Completed / Accepted - Sol verified`; C4-R6 is
`Completed / Engineering Rework Required - Sol verified`; C10 is
`Completed / Accepted - Sol verified`; C4-R7 is
`Completed / Sol Verification Pending`; Stage C remains
`In Progress / Awaiting C4-R7 Sol Verification`.

## KNOWLEDGE-V0.3-PRODUCT-VALIDATION-C-004-R5 - Real PDF Validation Result

**Status:** Completed / Sol Verification Pending
**Date:** 2026-08-31

C4-R5 reran the normal Knowledge v0.3 Workflow from the C8 baseline using the
exact PDF, real Docling Local, a fresh writable Schema 0.3 / Storage 1 KB, and
real DeepSeek `deepseek-v4-pro`. Credential fingerprints matched `.env`;
`/models` returned HTTP 200 with the configured model; the PDF SHA-256 and size
matched; Docling produced 103 pages, 1,523 chunks, 154 sections, 45 tables,
178 images, and 97,784 normalized characters; and Raw-first persisted the
expected RawRef.

The runtime observer confirmed `understandReport=off` and
`extractKnowledge=off`, with `maxTokens=65536` and temperature 0. The
`understandReport` output passed strict validation in 49.723 seconds. C8
visibility evidence recorded current-batch-only extraction inputs, zero
out-of-batch chunk IDs, and no normalized text, claims, sources, or raw refs in
model-visible context. The first observed extraction batch returned 43
entities, 12 relations, and 19 claims and passed. The next observed batch
returned 20 entities, 18 relations, and 9 claims, but normal strict Curation
validation rejected it with `invalid_semantics: Relation endpoint types violate
the frozen semantic definition` at `batch-0003`.

The Workflow stopped at extraction according to normal semantics. Consolidation,
reference resolution, precise retrieval, reconciliation, Schema Gap analysis,
review isolation, ChangeSet validation, Writer, reload, Replay, Reprocess,
semantic review, and provenance review were not executed. No retry,
normalization, output repair, or production patch was applied. This is recorded
as `FAIL / SOL REVIEW REQUIRED`, not a product PASS or Stage C acceptance.

Durable sanitized evidence is
`tests/knowledge/product-validation/evidence/c004-r5-real-pdf-summary.json`.
The C8 implementation is `Completed / Accepted - Sol verified`; C4-R5 is
`Completed / Engineering Rework Required - Sol verified`; C9 is
`Completed / Sol Verification Pending`; Stage C remains
`In Progress / Awaiting C9 Sol Verification`.

## KNOWLEDGE-V0.3-EXTRACTION-MODEL-INPUT-PROJECTION-C-008 - Extraction Visibility Boundary

**Status:** Completed / Sol Verification Pending
**Date:** 2026-08-31

C-008 corrects the C4-R4 extraction visibility defect inside the Curation
Skill. The authoritative `ExtractKnowledgeInput` remains complete and is
retained for deterministic validation, while `extractKnowledge` sends a pure
projection containing only the current batch, filtered report-understanding
evidence references, and minimum-permission semantic Knowledge context.

The projection removes full-document chunks, normalized text, unrelated
sections, claims, sources, and provenance/raw references without changing the
public API, Workflow, DSH adapter, Validator, Schema, contracts, batch
algorithm, or C7 reasoning policy. Tests prove exact batch visibility,
non-mutation, valid in-batch output, and continued `invalid_reference`
rejection for malicious out-of-batch output. C4-R4 is recorded as
`Completed / Engineering Rework Required - Sol verified`; Stage C remains
`In Progress / Awaiting C8 Sol Verification`.

## KNOWLEDGE-V0.3-PRODUCT-VALIDATION-C-004-R4 - Real PDF Validation Result

**Status:** Completed / Engineering Rework Required - Sol verified
**Date:** 2026-08-31

C4-R4 ran the exact PDF through real Docling Local, a fresh isolated Schema
0.3 / Storage 1 Knowledge Base, Raw-first persistence, and the normal real
DeepSeek Workflow. Credential fingerprints matched `.env`; `/models` returned
HTTP 200 with `deepseek-v4-pro`; Docling matched the known 103-page,
1,523-chunk, 154-section, 45-table, 178-image, 97,784-character baseline.

The Harness observed `understandReport=off` and the first
`extractKnowledge=off`, both with `maxTokens=65536` and temperature 0.
`understandReport` completed in 51.678 seconds and passed strict validation.
The first extraction call completed in 163.305 seconds and returned 49
entities, 30 relations, and 31 claims before strict Curation rejected an
`evidenceChunkRefs` value outside `batch-0001` as `invalid_reference`.
Normal Workflow execution stopped; no retry, normalization, output repair,
production patch, replay, or reprocess was performed.

Durable sanitized evidence is
`tests/knowledge/product-validation/evidence/c004-r4-real-pdf-summary.json`.
Stage C remains `In Progress / Awaiting C4-R4 Sol Verification`.

## KNOWLEDGE-V0.3-LLM-REASONING-POLICY-C-007 - Explicit Operation Reasoning

**Status:** Completed / Accepted - Sol verified
**Date:** 2026-08-31

C-007 implements the policy established from the C-006 execution diagnostic:
`understandReport=off`, `extractKnowledge=off`, `reconcileKnowledge=low`, and
`analyzeSchemaGaps=low`. The policy is an exhaustive typed mapping in the DSH
Knowledge Curation adapter and is written explicitly to every generated model
request, so provider defaults cannot silently select high reasoning.

Focused adapter and Skill-to-Adapter tests, the required Knowledge/Workflow/
Product Validation regression matrix, and integration typecheck pass. The
change does not alter Schema, Curation semantics, Workflow, validation,
Writer, Access, Migration, plugins, frontend, retries, normalization, model
construction, temperature, or the existing maxTokens envelope. Input bloat
remains separately tracked technical debt. C6 and C7 are now `Completed /
Accepted - Sol verified`; Stage C remains `In Progress / Awaiting C4-R4 Sol
Verification`.

## KNOWLEDGE-V0.3-LLM-EXECUTION-DIAGNOSTIC-C-006 - LLM Execution Envelope

**Status:** Completed / Accepted - Sol verified
**Date:** 2026-08-31

C-006 reconstructed the exact C4-R3 `understandReport` request after real
Docling parsing and measured 97,784 normalized-text characters, 1,523 chunks,
367,630 serialized document characters, and a 375,989-character / 696,743-byte
model prompt. The request contained both normalizedText and chunk texts. The
effective options were `deepseek-official` / `deepseek-v4-pro`, temperature 0,
`maxTokens=65536`, and omitted `reasoningEffort`; DSH resolved the provider
default as `high`.

A tiny same-runtime control completed in 1.378 seconds with reasoning, text,
usage, and finish events. The current full request emitted 5,702 reasoning
deltas and 4,012 text deltas but did not finish within 120 seconds. The same
exact request with only `reasoningEffort=off` completed in 50.525 seconds and
passed strict v0.3 validation with the expected `majorEntityMentions` field.
The primary classification is `LONG_REASONING_POLICY_CONFIRMED`; input bloat
is measured but was not independently isolated. No production behavior,
Schema, Validator, Workflow, Writer, or adapter configuration was changed.
Durable sanitized evidence is
`tests/knowledge/product-validation/evidence/c006-llm-execution-diagnostic-summary.json`.
Stage C remains `In Progress / Awaiting C7 Sol Verification`.

## KNOWLEDGE-V0.3-PRODUCT-VALIDATION-C-004-R3 - Full Real PDF Product Validation

**Status:** Completed / Runtime Execution Blocker - Sol verified
**Date:** 2026-08-31

C4-R3 ran from the accepted C5 baseline. The exact PDF hash and size matched,
the `.env` and process credential fingerprints matched, DeepSeek `/models`
returned HTTP 200 with `deepseek-v4-pro` available, and Docling Local passed
its READY preflight. A fresh isolated Schema 0.3 / Storage 1 target was used.

The real runner reached the HTTPS model call, but the DeepSeek stream did not
produce a terminal response within the controlled 15-minute window. C-006
subsequently measured sustained default-high reasoning and confirmed that the
same request with reasoning disabled completes and passes strict validation.
The downstream product pipeline remains incomplete. No retry, normalization,
production change, or fabricated model evidence was introduced. Durable
sanitized evidence is
`tests/knowledge/product-validation/evidence/c004-r3-real-pdf-summary.json`.
Stage C remains `In Progress / Awaiting C6 Sol Verification`.

## KNOWLEDGE-V0.3-INTEGRATION-FIX-C-005 - DSH Contract Propagation Correction

**Status:** Completed / Accepted - Sol verified
**Date:** 2026-08-31

C-005 fixes the integration defect exposed by C4-R2: the stale DSH adapter did
not serialize the frozen Schema Context or Structured Output Contract and used
the retired request field, allowing real model output to drift to the
unsupported top-level `entityMentions` property. The strict Knowledge
Curation request now requires both contracts, the adapter propagates the
operation and exact contract data, and missing fields fail before transport.

Focused adapter and Skill-to-Adapter tests plus the required regression matrix
are green. No Validator or Schema relaxation, output normalization, retry, or
unrelated runtime surface was introduced. C5 was accepted before C4-R3.
Stage C remains `In Progress / Awaiting C6 Sol Verification`.

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
