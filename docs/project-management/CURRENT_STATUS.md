# Current Status

## KNOWLEDGE-V0.3-EXTRACTION-MODEL-INPUT-PROJECTION-C-008

C-008 corrected the extraction model-visible input boundary exposed by C4-R4.
`KnowledgeCurationSkill.extractKnowledge` now retains the complete
authoritative `ExtractKnowledgeInput` for deterministic validation while
passing a pure projection to the model. The projection includes only the
current batch, the report semantic summary with evidence refs intersected to
current batch chunk IDs, and minimum-permission Knowledge context
(`schemaVersion`, refs, themes, and entities). It omits the full document,
normalized text, unrelated chunks, claims, sources, and provenance/raw refs.

Deterministic tests prove exact current-batch visibility, report/context
filtering, non-mutation, valid in-batch extraction, and continued rejection of
malicious out-of-batch references. Required regression tests and integration
typecheck are green. Workflow, DSH, Validator, Schema, contracts, C7 reasoning
policy, batch algorithm, and runtime envelope remain unchanged.

C-008 is `Completed / Sol Verification Pending`; C4-R4 is `Completed /
Engineering Rework Required - Sol verified`; C7 is `Completed / Accepted - Sol
verified`; Stage C remains `In Progress / Awaiting C8 Sol Verification`.

## KNOWLEDGE-V0.3-PRODUCT-VALIDATION-C-004-R4

C4-R4 ran from the C7 baseline through the real PDF, Docling Local, fresh
isolated Schema 0.3 / Storage 1 KB, Raw-first archive, and real DeepSeek
Workflow. Credential fingerprints matched `.env`; `/models` returned HTTP
200 with `deepseek-v4-pro`; the exact PDF matched the required SHA-256 and
size; and Docling produced 103 pages, 1,523 unique non-empty chunks, 154
sections, 45 tables, 178 images, and 97,784 normalized characters.

The observed Harness options matched C7: `understandReport=off` and the first
`extractKnowledge` batch used `off`, both with `maxTokens=65536` and
temperature 0. `understandReport` completed in 51.678 seconds and strict
validation accepted its required output shape. The first extraction model call
completed in 163.305 seconds and returned 49 EntityCandidates, 30
RelationCandidates, and 31 ClaimCandidates, but strict Curation validation
rejected an `evidenceChunkRefs` value outside `batch-0001` with
`invalid_reference`. Normal Workflow execution stopped at that point; no
normalization, retry, output repair, or production patch was applied.

The durable sanitized evidence is
`tests/knowledge/product-validation/evidence/c004-r4-real-pdf-summary.json`.
C4-R4 is `Completed / Engineering Rework Required - Sol verified`; C6 is `Completed / Accepted
- Sol verified`; C7 is `Completed / Accepted - Sol verified`; Stage C remains
`In Progress / Awaiting C4-R4 Sol Verification`.

## KNOWLEDGE-V0.3-LLM-REASONING-POLICY-C-007

C-007 implemented the explicit operation-specific reasoning policy identified
by C-006 in the DSH Knowledge Curation adapter. `understandReport` and
`extractKnowledge` use `reasoningEffort=off`; `reconcileKnowledge` and
`analyzeSchemaGaps` use `reasoningEffort=low`. The exhaustive typed mapping is
materialized on every Knowledge Curation `GenerateOptions` request, removing
the dependency on a provider-resolved default-high policy.

Focused Adapter and Skill-to-Adapter coverage, the required Knowledge and
Workflow regression matrix, Product Validation tests, and integration
typecheck are green. No Schema, Curation semantics, Workflow, Validator,
Writer, Access, Migration, plugin, frontend, retry, normalization, provider,
model, message, temperature, or maxTokens behavior was changed. The measured
input bloat remains technical debt and is outside C-007 scope.

C-007 is `Completed / Accepted - Sol verified`; C6 is `Completed / Accepted
- Sol verified`; C4-R3 remains `Completed / Runtime Execution Blocker - Sol
verified`; C4-R4 is `Completed / Engineering Rework Required - Sol verified`;
C8 is `Completed / Sol Verification Pending`; Stage C remains `In Progress /
Awaiting C8 Sol Verification`.

## KNOWLEDGE-V0.3-LLM-EXECUTION-DIAGNOSTIC-C-006

C-006 measured the exact C4-R3 `understandReport` execution envelope without
changing production behavior. The request contained 97,784 normalized-text
characters, 1,523 chunks, 367,630 serialized document characters, and a
375,989-character / 696,743-byte final model prompt. Both normalizedText and
chunk texts were model-visible, with a measured duplication ratio of 0.9689.

The effective request used `deepseek-official` / `deepseek-v4-pro`,
`maxTokens=65536`, temperature `0`, and omitted `reasoningEffort`; the
resolved provider default was explicitly measured as `high`. A tiny control
finished in 1.378 seconds with reasoning, text, usage, and finish events. The
current full request emitted 5,702 reasoning deltas and 4,012 text deltas but
did not finish within the controlled 120-second boundary. The same exact
request with only `reasoningEffort=off` finished in 50.525 seconds and passed
strict v0.3 `understandReport` validation with `majorEntityMentions`.

Primary classification is `LONG_REASONING_POLICY_CONFIRMED`. Input bloat is a
measured contributing factor, not independently causal in this diagnostic;
16k and projected-input comparisons were skipped after the reasoning-off path
provided conclusive evidence. No production behavior, Schema, Validator,
Workflow, Writer, or adapter configuration was changed.

C4-R3 is `Completed / Runtime Execution Blocker - Sol verified`; C6 is
`Completed / Accepted - Sol verified`; C7 is `Completed / Sol Verification
Pending`; Stage C remains `In Progress / Awaiting C7 Sol Verification`.

## KNOWLEDGE-V0.3-PRODUCT-VALIDATION-C-004-R3

C4-R3 started from the C5 baseline after the C-005 fix. The exact PDF hash
and size matched, credential fingerprint matched `.env`, DeepSeek `/models`
returned HTTP 200, `deepseek-v4-pro` was available, and the Docling Local
doctor was READY. The real runner used a fresh isolated `kb-product-validation-c004-r3`
target and progressed through parsing into the real HTTPS model call.

The real DeepSeek stream did not produce a terminal response within the
controlled 15-minute window. C-006 subsequently isolated the execution cause:
the current policy emitted sustained reasoning and delayed text, while the
same request with reasoning disabled completed and passed strict validation.
The full C4-R3 product pipeline remains incomplete; no normalization, retry,
production modification, API-key exposure, or fabricated evidence occurred.

Status is `Completed`; acceptance is `Runtime Execution Blocker - Sol
verified`. The product result is `BLOCKED / External LLM Execution Timeout`.
C5 is `Completed / Accepted - Sol verified`; C6 is `Completed / Sol
Verification Pending`; Stage C remains `In Progress / Awaiting C6 Sol
Verification`.

## KNOWLEDGE-V0.3-INTEGRATION-FIX-C-005

C-005 corrected the production integration boundary exposed by C4-R2. The
real model returned the non-contract top-level field `entityMentions` because
the stale DSH adapter did not serialize the frozen `schemaContext` and
`outputContract` and still relied on the retired request field.

The Knowledge Curation model request is now strict, the DSH adapter propagates
the operation, Schema Context, and Structured Output Contract, and missing
contract fields fail before transport. Focused Skill-to-Adapter coverage,
adapter coverage, and the required regression matrix are green. No Validator
or Schema relaxation, output normalization, retry, or unrelated runtime
surface change was introduced.

C5 is `Completed / Accepted - Sol verified`. C4-R2 is `Completed /
Engineering Rework Required - Sol verified`; C4-R3 is `Completed / Environment
Blocker - Sol Verification Pending`; Stage C remains `In Progress / Awaiting
C4-R3 Sol Verification`.

## KNOWLEDGE-V0.3-PRODUCT-VALIDATION-C-004-R2

C4-R2 passed the clean-baseline, process/.env credential-match, official
DeepSeek `/models` HTTP 200, configured-model availability, exact PDF hash,
Docling Local, and isolated Schema 0.3 / Storage 1 initial full-validation
gates. Docling produced 103 pages, 1,523 unique non-empty chunks, 154
sections, 45 tables, 178 images, and 97,784 normalized characters; Raw-first
persisted successfully.

The normal real Workflow then reached `understandReport`. The real model call
returned an object containing the unsupported top-level field `entityMentions`;
the Curation contract rejected it deterministically as
`invalid_model_output`. The run stopped before extraction, reconciliation,
ChangeSet, C3 commit validation, Writer, reload, replay, reprocess, and
semantic/provenance review. No production code or manual model output was
modified.

Status is `Completed`; acceptance is `Engineering Rework Required - Sol
verified`. The product result is `FAIL / SOL REVIEW REQUIRED`; C-005 completed
the required integration correction. C4 is historical environment blocked;
C4-R1 is `Completed / Root Cause Identified - Sol verified`; C5 is
`Completed / Accepted - Sol verified`; C4-R3 is `Completed / Environment
Blocker - Sol Verification Pending`; Stage C remains `In Progress / Awaiting
C4-R3 Sol Verification`.

## KNOWLEDGE-V0.3-PRODUCT-VALIDATION-C-004-R1

C4-R1 reran the mandatory clean-baseline and real-credential preflight from
`5ecc4a771a592c622f2512dbbd7de6172ca985b0`. The working tree was clean and no
production files were changed. The configured runtime remains
`deepseek-official` / `deepseek-v4-pro` at host `api.deepseek.com`, with a
credential present, but `GET /models` returned HTTP 401. Per task policy the
run stopped before the expensive PDF, parser, KB, and semantic stages; no
fallback, mock, provider switch, or model substitution was used.

The durable sanitized result is
`tests/knowledge/product-validation/evidence/c004-r1-real-pdf-summary.json`.
C4-R1 is `Completed / Root Cause Identified - Sol verified`; Stage C remains
`In Progress / Awaiting C4-R2 Sol Verification`.

## KNOWLEDGE-V0.3-PRODUCT-VALIDATION-C-004

C4 executed the first real PDF product-validation attempt against the exact
specified report `20260805-西部证券-AI算力行业：AI算力上游材料产业链研究报告.pdf`.
The PDF was readable and preserved at 3,209,114 bytes with SHA-256
`998703cef102300518bb2edcbcc3e9bc26fa374f157b0714f3986c5028d78d63`.
Docling Local was READY and completed the parse with 103 pages, 1,523 chunks,
154 sections, 45 tables, 178 images, and 97,784 normalized characters; no
parser warnings were reported. The run created an isolated writable Schema
0.3 / Storage 1 Knowledge Base and persisted Raw first.

The real configured DeepSeek call was attempted through the normal Workflow,
but `understandReport` terminated before semantic output with
`Knowledge Curation did not finish normally: error`; no Curation candidates,
ChangeSet, Writer invocation, or semantic Knowledge write was produced. A
runner-only credential preflight then confirmed the configured API key is
rejected by DeepSeek `/models` with HTTP 401. No production code was patched,
and no fallback, mock model, fabricated extraction, or committed report/KB
data was used. Sanitized evidence remains in the local temp files
`researchhub-knowledge-v03-c004-evidence.json` and
`researchhub-knowledge-v03-c004-credential-preflight.json`.

Status is `Blocked / Environment Credential`; this is the historical C4
environment blocker superseded by C4-R1 root-cause confirmation. Stage C
remains `In Progress / Awaiting C4-R2 Sol Verification`.

## KNOWLEDGE-V0.3-IMPLEMENTATION-C-002-R2-R1

C2-R2-R1 closes the four correctness and contract defects found during
independent verification: non-null Claim temporal values now follow the frozen
`asOf`/`scope` shape with deterministic datetime validation, reconciliation
decisions are duplicate-aware and exactly once per candidate, Source identity
uses normalized strong metadata with a canonical RawRef fallback, and
ChangeSet `ingestionContext.modelCalls` records actual model invocations.
Active v0.3 Skill requests use a strict subtype requiring both Schema Context
and Structured Output Contract; the existing DSH transport boundary remains
unchanged because DSH is outside this task.

Focused acceptance is green: Curation 19/19 and Ingestion 18/18. TypeScript
integration and the required Workflow, Schema, Knowledge, Runtime, Migration,
and Product Validation regressions are green. No Schema, Runtime Foundation,
Writer, Migration, Access, DSH, frontend, examples, or Runtime KB data was
modified. Real PDF Product Validation is blocked by the invalid configured
DeepSeek credential; C4 records the evidence above.

Status is `Completed`; acceptance is `Accepted - Sol verified`. C2-R2 is
`Completed / Accepted - Sol verified`; C3 is `Completed / Accepted - Sol verified`;
Stage C remains `In Progress`.

## KNOWLEDGE-V0.3-IMPLEMENTATION-C-002-R2

C2-R2 atomically cuts the Knowledge Curation Skill and Research Report
Knowledge Ingestion Workflow over to the frozen Knowledge v0.3 contract.
Curation now exposes exactly four operations (`understandReport`,
`extractKnowledge`, `reconcileKnowledge`, and `analyzeSchemaGaps`) with
automatic C1 Schema Context, structured output contracts, strict validation,
trusted-envelope protection, and no hidden retry. The ingestion Workflow now
uses the frozen 18-stage sequence, native Schema 0.3 / Storage 1 state,
deterministic Source/candidate/reference planning, batched reconciliation,
dependency-closure review isolation, C3 validation, and the existing atomic
Writer.

Focused acceptance is green: Curation 16/16 and Ingestion 16/16. Regression
coverage for Workflow, Schema, Knowledge, Runtime Infrastructure, Migration,
and Product Validation is green. The implementation does not activate a new
Schema release, modify DSH, Writer, Migration, examples, or Runtime KB data.

Status is `Completed`; acceptance is `Accepted - Sol verified`. Stage B is
`Completed / Accepted - Sol verified`; C1 is `Completed / Accepted - Sol
verified`; C3, C3-R1, C3-R2, and C3-R3 are `Completed / Accepted - Sol
verified`; C2 and C2-R1 are `Blocked / Superseded`; Stage C remains `In
Progress`; C4 is `Blocked / Sol Review Required`.

## KNOWLEDGE-V0.3-IMPLEMENTATION-C-003-R3

C3-R3 closes the final Knowledge v0.3 Runtime Foundation acceptance gaps. The
ChangeSet Validator now revalidates every object in the complete simulated
planned state through the shared canonical validation core before evaluating
global invariants and issuing a receipt. This rejects dependency-invalidating
updates such as changing a Company into a Product while an unchanged
`business_exposure` Relation still requires a Company endpoint.

Successful dry-run validation now returns report evidence only and never emits
a Writer-consumable `ValidatedKnowledgeChangeSetV03`; commit mode continues to
return a deeply immutable receipt. Writer, Full Validator, Schema, Curation,
Workflow, Migration, and Runtime KB data were not modified.

Status is `Completed`; acceptance is `Accepted - Sol verified`. C3 is
`Completed / Accepted - Sol verified`; C3-R1 is `Completed / Superseded by
C3-R2/R3`; C3-R2 is `Completed / Superseded by C3-R3`; C2-R2 is `Completed /
Accepted - Sol verified`; Stage C remains `In Progress`.

## KNOWLEDGE-V0.3-IMPLEMENTATION-C-003-R2

C3-R2 unifies v0.3 canonical object validation behind the pure
`v03-validation-core.ts`. Full Knowledge Base validation and ChangeSet
planned-state validation now consume the same Schema-derived rules for
ThemeGroup, Entity, Source, Relation, Claim, Module, lifecycle, references,
financialContribution, temporal, structuredValue, and provenance.

The ChangeSet path now enforces `requiresRawProvenance`, existing Raw
`contextRefs`, and canonical object parity before issuing an immutable receipt.
R1 planned-state simulation, stale protection, receipt immutability, Writer
integration, and recovery behavior remain intact. No Writer, Schema,
Curation, Workflow, Migration, or Runtime KB changes were made.

Status is `Completed`; acceptance is `Accepted - Sol verified`. C3 is
`Completed / Accepted - Sol verified`; C3-R1 is `Completed / Superseded by
C3-R2/R3`; C3-R2 is `Completed / Superseded by C3-R3`; C2-R2 is `Completed /
Sol Verification Pending`; Stage C remains `In Progress`.

## KNOWLEDGE-V0.3-IMPLEMENTATION-C-003-R1

C3-R1 closes the independent v0.3 Runtime acceptance gaps without changing
the accepted C3 architecture. The ChangeSet validator now simulates
`source_merge`, `create`, `update`, `supersede`, and `merge_source` in planned
state, checks mutable-target hashes at validation time, enforces final planned
Business Exposure cardinality, and returns a deeply immutable clone receipt.
Focused Runtime coverage now includes source/provenance atomicity, complete
representative writes, updates, supersede, merge_source, no-op, idempotency,
stale state, invalid ChangeSets, Raw behavior, and recovery.

Status is `Completed`; acceptance is `Superseded by C3-R2/R3`. Curation and
Workflow were not modified in C3-R1; C2-R2 is now `Completed / Sol Verification
Pending`.

## KNOWLEDGE-V0.3-IMPLEMENTATION-C-003

C3 activates the already frozen Knowledge Schema 0.3 / Storage Format 1 runtime
write capability. The default adapter uses `CanonicalV03KnowledgeLoader`, the
runtime has a native v0.3 index and version-aware Access, v0.3 ChangeSet
validation and mutation contracts, Storage Format 1 Raw support, and one
version-dispatched atomic Writer with staged validation, revision guards,
idempotency, and recovery.

Schema 0.2 compatibility and migration behavior remain intact. C3 does not
create Schema 0.4 and does not modify Knowledge Curation or the Report
Ingestion Workflow; their v0.3 cutover remains C2-R2 scope.

Status is `Completed`; acceptance is `Rework Required` pending C3-R1 Sol
verification.
Stage B is `Completed / Accepted - Sol verified`; C1 is `Completed / Accepted -
Sol verified`; C2 is `Blocked / Superseded by C-002-R1`; C2-R1 is `Blocked /
Dependency on C-003`; C2-R2 is `Not Started / Awaiting C3-R1 Sol Acceptance`; and
Stage C is `In Progress`.

## KNOWLEDGE-V0.3-IMPLEMENTATION-C-001

C1 implements the runtime-neutral Knowledge Curation v0.3 Schema Context
Builder. It exports one deterministic Builder with four explicit operation
slices derived from `KNOWLEDGE_SCHEMA_V03`; the legacy seven-operation Curation
API and model request remain unchanged.

Stage B is `Completed / Accepted - Sol verified` at baseline
`60bf76c045c1d315f3ea90d7733d75d870b7ee54`. Stage C is `In Progress`; C1 is
`Completed / Rework Required`; C1-R1 is `Completed / Sol Verification Pending`.
C2 remains responsible for the four v0.3 Curation operations and model request
cutover.

## KNOWLEDGE-V0.3-IMPLEMENTATION-B-003

B3 is the production-like Example Knowledge Base migration acceptance for the
exact Git-managed `examples/knowledge-bases/ai-hardware/` Schema 0.2 source.
It runs isolated dry-run, deterministic repeat, and commit paths against
Schema 0.3 / Storage Format 1 while preserving the repository example and all
production implementation boundaries.

Status is `Completed / Accepted - Sol verified`; acceptance is `Accepted - Sol verified`.

The exact example source passes Schema 0.2 validation. The B3-R2 temporal
policy closes candidate accounting deterministically and retains 15 accounted
Reviews: 11 semantic, 2 deterministic invalid-temporal, and 2 dependent.
A fresh real Runtime KB clone passed zero-Review dry-run and committed v0.3
validation. The exact example remains uncommitted because its semantic and
invalid-temporal Review gates are intentional.

B3 Evidence is `Accepted - Sol verified`; B3-R1 is `Completed / Rework Required`;
B3-R2 and Stage B are `Completed / Accepted - Sol verified`.

## KNOWLEDGE-V0.3-IMPLEMENTATION-B-002-R2

B-002-R2 closes the remaining B2 verification gaps: temporal scope labels now
accept arbitrary strings or null without date parsing, bounded numeric values
use finite 0..1 validation, and the 0.2 to 0.3 runtime has dedicated Review,
target-validation, and before/during/after-switch recovery coverage.

This is a narrow B2 closure and does not change architecture, Schema semantics,
Raw identity, or introduce runtime components. Stage A is `Accepted - Sol
verified`; B1 and B2 are `Accepted - Sol verified`; Stage B remains `In
Progress`; B3 is `Blocked by Semantic Review`.

Status is `Completed / Sol Verification Pending`; acceptance is
`Review Pending / Sol Verification`.

## KNOWLEDGE-V0.3-IMPLEMENTATION-B-002-R1

B2-R1 closes the independent verification rework for Knowledge v0.3 Runtime
Integration. It restores the frozen Raw identity rule
`raw-sha256-<64 lowercase hex>`, completes deterministic v0.3 validation for
ThemeGroup, Entity, Relation, Claim, Source/Raw, Module, Taxonomy, Views, and
orphans, uses real `archiveRaw()` fixtures, and makes Runner preflight use the
resolved migration definition.

This is a Knowledge v0.3 freeze-consistency correction, not Schema v0.4 and
not a semantic model redesign. Stage A remains `Accepted - Sol verified` with
the Raw correction recorded here; B1 remains `Accepted - Sol verified` after
real-Raw regression. Stage B is `In Progress`; B2 Parent is
`Accepted - Sol verified`; B3 is `In Progress`.

Status is `Completed / Rework Required`; acceptance is
`Rework Required - Sol verification`.

## KNOWLEDGE-V0.3-IMPLEMENTATION-B-002

B2 implementation is `Completed / Accepted - Sol verified` after the B-002-R2
Sol verification. Schema 0.3 is readable through the
version-isolated canonical reader and integrated into the existing Validation
Skill. The release remains explicitly non-writable for 0.3. The existing
staging, target-validation, root-transaction, recovery, lock, migration-log,
and Handle-refresh boundaries are reused by the generalized migration Runner.

Runtime boundary: v0.2 Writer remains available; no v0.3 Writer, Curation,
Workflow, Frontend, or semantic runtime activation was added. B1 Parent and
B1-R1 are accepted — Sol verified. B2 acceptance is `Rework Required - Sol
verification`; B-002-R2 is closed. B3 is the active production-like example
acceptance.

## KNOWLEDGE-V0.3-IMPLEMENTATION-B-001-R1

R1 hardens the B1 transformer against semantic-safety gaps found during
independent review:

- Relation declared references are rewritten only after normalization,
  deduplication, and final survivor mapping.
- Relation attributes, Entity tags/extensions, Intelligence semantic fields,
  Module extensions, and unsupported Relation metadata receive an explicit
  preservation, transformation, or Review disposition.
- Frozen enum/value validation is applied to theme exposure and ownership
  attributes; exact dedupe removes only obsolete canonical files from staging.
- Declared-reference, registry namespace/kind, Raw byte, and orphan-file
  invariants are computed from the actual target staging state.

Status is `Completed`; acceptance is `Accepted — Sol verified` against the
verified B1-R1 implementation. B2 Parent is in rework pending B-002-R1 Sol
verification; B3 is not started or authorized.

## KNOWLEDGE-V0.3-IMPLEMENTATION-B-001

Stage B is now in progress at substage B1, the deterministic v0.2 to v0.3
Migration Transformation Layer:

- The transformer builds complete canonical ID mappings before rewriting any
  declared references and reports deterministic collisions, warnings, reviews,
  inventories, changes, and invariants.
- It transforms only a supplied staging root, preserves Storage Format 1
  storageRefs, rebuilds the target canonical registry, and preserves Raw,
  Reference Taxonomy, Projection Configuration, and opaque strings according
  to their declared boundaries.
- No default migration registry entry, Runner execution path, Schema 0.3
  runtime adapter, Writer, Curation, Workflow, Runtime KB, or Example KB was
  activated or modified.

Status is `Completed`; acceptance is
`Accepted — Sol verified` after the semantic-safety review. R1 is
the accepted B1 rework closure. B2 Parent is in rework pending B-002-R1 Sol
verification; B3 is not started or authorized.

## Stage A Governance Closure

Stage A Parent, R1, R2, and R3 are accepted as `Accepted - Sol verified`
against verified implementation HEAD
`c0c70b832a70f2f0fdc533c00236c03d47554d99`.

## KNOWLEDGE-V0.3-IMPLEMENTATION-A-001-R3

R3 closes the final Stage A Schema / Domain / Migration contract gap for
Business Exposure:

- `financialContribution` accepts an object, explicit `null`, or remains
  absent in the v0.3 Domain.
- Executable Schema metadata explicitly records `nullable: true` and the
  frozen child-field vocabulary.
- The deterministic migration target for legacy `operates_in` semantics can
  therefore represent `financialContribution: null` without bypassing the
  Domain model.
- Numeric constraints remain unchanged and apply when numeric values are
  present.

All R1 and R2 corrections remain intact. No migration code, Schema 0.3
runtime activation, Runtime KB change, or Example KB change was made.

Status is `Completed`; acceptance is `Accepted - Sol verified` as part of the
Stage A closure recorded above.

## KNOWLEDGE-V0.3-IMPLEMENTATION-A-001-R2

R2 closes the final Stage A canonical-reference fidelity gap:

- Module keeps the compatible `targetEntity` field name, but its v0.3 Domain
  type is now the Schema-derived `EntityRefV03` (`entity:<stable-id>`).
- Legacy subtype namespaces such as `segment:`, `industry:`, and `company:`
  are rejected by the v0.3 target Domain.
- Executable Schema metadata declares `targetEntity` as an optional Entity
  reference and `sourceRefs` as optional Source references.
- No ID transformation or migration implementation was added; that remains
  Stage B responsibility.

All R1 requiredness, Source compatibility, Module structure, strict semantic
unions, and RawRef alias corrections remain intact. Schema 0.3 remains absent
from the runtime release registry.

Status is `Completed`; acceptance is `Accepted - Sol verified` as part of the
Stage A closure recorded above.

## KNOWLEDGE-V0.3-IMPLEMENTATION-A-001-R1

R1 corrects structural fidelity in the approved Stage A implementation:

- `requiredFields` now matches the canonical validity contract rather than
  requiring recommended creation-time richness.
- Source preserves the migration-compatible v0.2 fields `type` and `quality`
  while allowing `rawRefs`, `sourceReliability`, and `lifecycle` to remain
  optional.
- Module preserves the existing `targetEntity`, `sourceRefs`, `schemaId`,
  `columns`, and `rows` shape; no replacement `targetRefs` or invented
  mandatory `name` field is introduced.
- Raw references remain the `raw:` reference alias only; no separate RawRef
  object payload is defined.

The v0.2-compatible domain, release registry, runtime KBs, and downstream
Knowledge capabilities remain unchanged. Schema 0.3 is still not registered
as readable or writable runtime support.

Status is `Completed`; acceptance is `Accepted - Sol verified` as part of the
Stage A closure recorded above.

## KNOWLEDGE-V0.3-IMPLEMENTATION-A-001

Stage A establishes Schema 0.3 availability without activating Schema 0.3
runtime support:

- `KNOWLEDGE_SCHEMA_V03` is the single JSON-serializable executable Schema
  authority.
- Version-isolated v0.3 domain types derive semantic unions from that authority
  and use object-kind durable namespaces.
- Existing v0.2 domain types and callers remain unchanged.
- `KNOWLEDGE_SCHEMA_RELEASES` still advertises only Schema 0.1 and 0.2;
  Schema 0.3 is not readable or writable at runtime.
- No Runtime KB, Example KB, migration runtime, or downstream Knowledge
  capability was activated or modified.

Status is `Completed`; acceptance is `Accepted - Sol verified` as part of the
Stage A closure recorded above.

## KNOWLEDGE-V0.3-GOVERNANCE-INTEGRATION-001-R1

R1 closes three current-governance residuals without changing the frozen
Knowledge v0.3 contracts:

- the Roadmap now marks Product Validation / Real Data Integration as a
  historical Phase E direction; the only current next approved direction is
  Stage A — Executable Schema / Domain Model;
- the Freeze Index distinguishes its original 2026-08-26 index date from the
  current Knowledge v0.3 normative freeze accepted on 2026-08-27;
- the root README records the executed Product Validation result and its
  Curation Source Assessment blocker rather than claiming that execution is
  still awaiting local inputs.

Status is `Completed`; acceptance is `Accepted — Sol verified` against commit
`747812dcf994ac7804b67d62c82aa9f5fadba00f`.

## KNOWLEDGE-V0.3-ARCHITECTURE-FREEZE

Sol/CTO independently verified the Knowledge v0.3 freeze package against
commit `47e312f79a221d7dd45b42508e52526fd61b1a74`.

- Knowledge v0.3 is the Current Normative Knowledge Architecture.
- Schema 0.3 / Storage Format 1 is the Current Target Semantic Contract.
- Knowledge v0.2 is Frozen Legacy and remains the compatibility/migration
  source.
- Current runtime implementation remains predominantly v0.2; Schema 0.3
  runtime support and migration have not started.
- The next approved engineering direction remains Implementation Stage A —
  Executable Schema / Domain Model; its implementation status is recorded in
  `KNOWLEDGE-V0.3-IMPLEMENTATION-A-001` above.
- Single DSH, `dsh/` orchestration, runtime-neutral `packages/`, explicit
  `KnowledgeBaseHandle`, Raw/provenance ownership, and the Git/runtime-data
  boundary remain unchanged.

The Governance Integration parent and R1 are `Completed`; acceptance is
`Accepted — Sol verified` against commits
`6e0245b1b30a9896273cfd49e710054931792de4` and
`747812dcf994ac7804b67d62c82aa9f5fadba00f`.

## Historical: KNOWLEDGE-V0.3-FREEZE-CORRECTION-001-R1

R1 closes the two residual terminology and normative-scope contradictions
identified during independent Sol review of commit
`5620302317cf13e2d4faa52be31ad033d3df8b4f`:

- the v0.3 supersession list explicitly includes Schema 0.3 durable identity
  policy;
- Theme-specific visual groups now distinguish non-canonical Projection
  Configuration Assets from canonical Module structures, and explicitly keep
  Legacy View non-canonical.

The canonical model, auxiliary asset boundaries, migration design, ID
authority, v0.2 current normative status, and implementation HOLD are
unchanged. Governance Integration and Knowledge v0.3 implementation have not
started.

Status is `Completed / Sol Verification Pending`; acceptance remains
`Review Pending / Sol Verification`.

## Historical: KNOWLEDGE-V0.3-FREEZE-CORRECTION-001

Knowledge v0.3 is a Freeze Candidate with status `Sol Verification Pending`.
The candidate documentation now closes the Taxonomy/View auxiliary-asset
boundary and the Schema 0.3 durable-ID authority ambiguity without changing
the v0.3 semantic design.

- Canonical kinds remain ThemeGroup, Entity, Relation, Claim, Source, Module,
  and RawRef.
- Reference Taxonomy and Projection Configuration are auxiliary assets, not
  canonical semantic objects.
- `taxonomyRefs` has one defined auxiliary-reference meaning.
- Schema 0.3 Data Schema is the sole v0.3 canonical durable-ID authority, and
  object-kind namespaces are mandatory.
- The frozen v0.1 ID Convention remains unchanged and applies to Schema `<=
  0.2`.
- v0.2 remains the current frozen normative architecture until Sol
  verification and governance integration.
- Knowledge v0.3 implementation remains on HOLD and is not authorized.

Acceptance remains `Review Pending / Sol Verification`.

## KNOWLEDGE-ARCHITECTURE-002

Knowledge Architecture v0.2 and the independent Knowledge Base Instance
architecture are frozen and accepted through ADR-015. The current architecture
separates ResearchHub Source from user-owned Knowledge Base Runtime Data:

- ResearchHub Source owns Knowledge schemas, adapters, validation, migration,
  curation, write infrastructure, tests, examples, and governance.
- Runtime Data contains independently scoped Knowledge Base instances addressed
  through an explicit `KnowledgeBaseHandle`.
- Workflow controls ingestion and update orchestration.
- Access and Validation remain deterministic; Write accepts only validated
  changes; schema migration is explicit and never implicit on mount or ingest.
- Knowledge Runtime Migration Phases A–E are accepted after Sol verification
  and closed / complete. The AI
  Hardware dataset now lives as the
  Git-managed Example Knowledge Base at
  `examples/knowledge-bases/ai-hardware/`.

The older implementation and dataset sections below are historical execution
records. The current Phase A status is recorded in the next section.

## KNOWLEDGE-RUNTIME-MIGRATION-A-001

Knowledge Base Runtime Architecture Migration Phase A is implemented and
accepted after Sol verification. The runtime-neutral foundation now includes:

- canonical Knowledge manifest and durable domain contracts;
- explicit `KnowledgeBaseHandle`, configured Runtime Data Root resolution, and
  in-memory mount registry;
- schema/storage compatibility resolution without automatic migration;
- version-aware manifest-first loading through a Schema Adapter contract;
- extracted shared YAML, asset Loader, Error, and `KnowledgeIndex` infrastructure;
- thin compatibility exports preserving the existing Knowledge Loader, Index,
  YAML, and Access Skill behavior.

Phase B is accepted after Sol verification. It includes:

- explicit Knowledge Base scoping for Access Skill;
- Knowledge Base scoping for Validation;
- Knowledge Base scoping for Frontend Projection;
- migration of the AI Hardware dataset to an Example Knowledge Base layout;
- canonical Schema 0.2 manifest, asset registry, and empty canonical raw registry;
- handle-bound Access, schema-aware Validation, and explicitly scoped
  Frontend Projection / HTTP.

Phase A and Phase B did not implement Write, Raw ingestion, Research Report
ingestion, Curation, or a Migration Runner.

Phase A R1 contract closure corrects the Schema 0.2 `registry/assets.yaml` /
`storageRef` boundary, keeps both supported Schema versions read-only until
Write is implemented, and aligns the canonical Source contract with Data
Schema v0.2 nullable metadata and Raw provenance fields. Phase A is accepted
after Sol verification; the correction remains part of the frozen read-only
foundation.

Phase A R2 closes the remaining foundation integrity gaps: canonical Registry
keys must match loaded asset IDs, canonical Modules derive their runtime
entity index from `targetEntity`, and `SourceType` / `SourceReliability` are
strict frozen enums. Phase A is accepted after Sol verification.

## KNOWLEDGE-RUNTIME-MIGRATION-B-001

Knowledge Base Runtime Architecture Migration Phase B is accepted after Sol
verification. The repository-root AI Hardware dataset was moved with Git
history to `examples/knowledge-bases/ai-hardware/` and converted to Schema 0.2
/ Storage Format 1 with `manifest.yaml`, canonical `registry/assets.yaml`,
and empty `registry/raw.yaml`. Legacy `index.yaml` and `modules.yaml` are no
longer part of the Example KB.

The read path is now:

```text
KnowledgeBaseHandle
  -> KnowledgeBaseLoader / Schema Adapter
  -> KnowledgeIndex
  -> handle-bound Access / Validation / Frontend Projection
```

Access sessions expose their handle metadata and isolate identical IDs across
KBs. Validation supports explicit manifest, raw, registry, asset, and all
scopes with Schema 0.1 compatibility and Schema 0.2 nullable Source/rawRef
rules. The prototype HTTP API requires `knowledgeBaseId` and returns an
  explicit response envelope. This describes the Phase B boundary; Phase C
  subsequently adds the deterministic local mutation infrastructure.

## KNOWLEDGE-RUNTIME-MIGRATION-C-001

Knowledge Base Runtime Architecture Migration Phase C is accepted after Sol
verification. Schema 0.2 / Storage Format 1 is now the only writable contract. The
runtime-neutral infrastructure provides immutable SHA-256 Raw Archive bundles,
canonical `registry/raw.yaml`, deterministic semantic hashing, ChangeSet
validation receipts, source and Knowledge mutation operations, revision and
target-hash guards, per-KB locking, staged coherent commits, recovery markers,
ingestion logs, idempotent retries, and explicit Registry Handle refresh.

Schema 0.1 remains readable but not writable; readonly and archived Schema 0.2
instances remain non-writable. Mutation tests use temporary Knowledge Bases and
never change the Git-managed AI Hardware Example. Curation, Research Report
Knowledge Ingestion, conflict reasoning, Schema Gap reasoning, and Migration
Runner remain planned future phases.

## KNOWLEDGE-RUNTIME-MIGRATION-C-001-R1

Phase C durable mutation contract gaps are closed and accepted after Sol
verification. Raw Manifest now matches Storage Layout v0.2, Raw Archive
operations are explicitly Knowledge Base scoped and lifecycle-aware, and Raw
archive-only writes do not change semantic revision or manifest timestamps.
ChangeSet validation uses strict Source contracts, current expected-hash guards,
planned supersede state, and duplicate-target rejection. Knowledge Writer now
requires full staged Knowledge validation before directory switch; Loader-only
parsing is not commit-authorizing. The temporary Phase C design note was
removed because frozen architecture and storage documents remain authoritative.
At the time of this Phase C checkpoint, Phase D1 was implemented and review
pending; the current Phase D2 status is recorded below.

## KNOWLEDGE-RUNTIME-MIGRATION-C-001-R2

Phase C R2 finalizes the durable mutation boundary and is accepted after Sol
verification. Raw Archive and semantic Writer now use one shared,
Knowledge-Base-scoped mutation lock, so Raw Registry updates and semantic
directory switches cannot lose updates or overlap within the same KB. Writer
failures now expose only the frozen Write Interface v0.1 error taxonomy,
including validation, lifecycle, schema, lock, staging, recovery, conflict,
and idempotency outcomes. Different Knowledge Bases remain independent.

## KNOWLEDGE-INGESTION-D1-CURATION-001

Knowledge Ingestion Phase D1 is accepted after Sol verification. The
runtime-neutral Knowledge Curation Skill provides an injected
provider-neutral model port and deterministic structured-output validation for
Source Assessment, relevance filtering, atomic candidate extraction, admission,
Schema Mapping assistance, conflict analysis, and Schema Gap proposals.
Trusted workflow scope, raw provenance, chunk locators, intermediate IDs, and
existing Knowledge references are bound or checked by the Skill. No Workflow,
Raw Archive orchestration, Access/Validation/Writer call, persistence, schema
mutation, or real LLM wiring was added.

## KNOWLEDGE-INGESTION-D2-WORKFLOW-001

Knowledge Ingestion Phase D2 is accepted after Sol verification. The
runtime-neutral Research Report Knowledge Ingestion Workflow
composes explicit target resolution, Raw Archive, document normalization,
Curation, Access, deterministic ID/ChangeSet planning, Validation, and Writer
interfaces. It supports commit and network-free dry-run modes, deterministic
Raw/source/Knowledge identity, partial candidate continuation, idempotent
successful retries, structured ingestion audit logs, and a DSH-only Curation
model adapter. No new architecture layer, database, RAG, automatic migration,
or Research Artifact conversion was introduced.

## KNOWLEDGE-INGESTION-D2-WORKFLOW-001-R1

The D2 workflow contract rework is accepted after Sol verification. ChangeSet
Validation now supports non-mutating dry-run planning,
virtual Raw provenance, readonly-compatible validation, operation-level
diagnostics, and planned change summaries without producing Writer receipts.
Document resolution keeps exact Raw bytes separate from normalized text and
chunks. The workflow now skips extraction and Source planning for wholly
irrelevant reports, preserves immutable Mapping results, supports deterministic
same-ChangeSet reference allocation, and performs one bounded candidate-level
validation-pruning pass before commit. Ingestion logs report accurate Raw
created/reused state and structured validation, review, Schema Gap, and status
fields. Workflow step metadata distinguishes Skills, infrastructure, and
Workflow-owned orchestration while retaining legacy definitions.

Focused R1 tests cover dry-run on readonly bases, virtual Raw references,
irrelevant-report no-change behavior, binary Raw preservation, and safe
continuation after a candidate-specific validation failure. No new architecture
layer, database, RAG, automatic migration, or Research Artifact conversion was
introduced.

## KNOWLEDGE-INGESTION-D2-WORKFLOW-001-R2

The D2 ingestion audit and partial-continuation contract is accepted after Sol
verification. The workflow keeps the full final
CandidatePlan for ingestion audit while deriving a separate eligible operation
plan for ChangeSet construction. Dry-run and commit share the same bounded
candidate-level validation-pruning pass; systemic validation failures still
block the entire run. Candidate-specific validation diagnostics retain their
`operationId`, validation rejection counts are candidate-based, and no-change
or Raw-only runs do not record a fabricated canonical Source ID.

R2 adds regression coverage for invalid-candidate dry-run pruning, mixed safe
and review/duplicate/Schema Gap audit logs, all-irrelevant no-Source behavior,
operation attribution, and systemic validation blocking. No new architecture
layer, database, RAG, automatic migration, or Research Artifact conversion was
introduced.

## KNOWLEDGE-INGESTION-D2-WORKFLOW-001-R3

The D2 public-result completion semantics are accepted after Sol verification.
A single completion-status derivation now drives dry-run
results, successful commit results, and `ingestionContext.workflowStatus`:
normal completion is `completed`, while any user review or Schema Gap produces
`completed_with_review`. Dry-run remains fully non-mutating. Governance records
now use the actual D2 Parent, R1, and R2 commit hashes, with R3 recorded as
completed and accepted with the D2 R4 governance correction.

## KNOWLEDGE-RUNTIME-MIGRATION-E-001

Knowledge Schema Migration Runtime Phase E is accepted after Sol verification
and closed / complete. The runtime now has:

- frozen Schema 0.1 / 0.2 release metadata and a deterministic migration
  registry containing only the concrete 0.1 to 0.2 path;
- an explicit Migration Runner with dry-run and commit modes, expected
  revision and lifecycle guards, source/target validation, review-required
  blocking, and refreshed `KnowledgeBaseHandle` state;
- deterministic conversion of the legacy registry/module layout to canonical
  `registry/assets.yaml`, preservation of Knowledge IDs and asset counts,
  explicit module target resolution, and conservative Raw provenance handling;
- one whole-Knowledge-Base staged transaction primitive shared with Writer,
  recovery-marker coordination with Raw/semantic mutations, and migration logs
  under `logs/migrations/` without full asset dumps.

Schema 0.1 remains readable and is now reported as migration-available but
read-only. Schema 0.2 / Storage 1 is the only writable contract. Migration is
never performed implicitly by mount, load, Access, Validation, or ingestion.
Phase E is frozen at the current architecture boundary. No Phase F is
approved, and no later Knowledge infrastructure phase has started.

## KNOWLEDGE-RUNTIME-MIGRATION-E-001-R1

Phase E R1 is accepted after Sol verification. The final
contract gaps are closed: transformation review findings survive target
validation failures; equal-length migration paths are explicitly ambiguous;
current Manifest state is read only after lock and recovery; commit-time
transformation drift is rejected; Raw Archive recovery precedes durable-write
eligibility checks; and migration, Writer, and Raw operations share the same
Knowledge Base mutation critical section. Regression coverage includes source
and Raw ambiguity, module target matrices, lifecycle, recovery failpoints,
preservation, no-silent-ingestion behavior, and cross-Knowledge-Base
concurrency. Phase E R1 is closed as part of Knowledge Runtime Migration A–E.

## Historical: KNOWLEDGE-RUNTIME-MIGRATION-E-001-CLOSURE

Sol independently verified the Phase E parent and R1. Knowledge Runtime
Migration A–E is now Closed / Complete. Knowledge infrastructure development
is frozen at the architecture boundary recorded at that checkpoint. The next
direction at that checkpoint was Knowledge Product Validation / Real Data
Integration; that historical direction subsequently produced the Product
Validation work recorded below. Following the Knowledge v0.3 Architecture
Freeze and Governance Integration, the current next approved engineering
direction is Stage A — Executable Schema / Domain Model. No Phase F, Knowledge
Manager, Migration Manager, RAG, Graph DB, Vector DB, new Planner, new Agent, or
new architecture layer is approved.

## Historical: Knowledge Layer Phase 1 Acceptance Closure

Knowledge Layer v0.1 foundation acceptance gaps are closed. The top-level
Knowledge asset boundary now has an authoritative Registry mode with scan
fallback, a memory-backed Access Skill, typed YAML validation rules, scoped
validation with complete reference lookups, and a lightweight Module Registry.
The AI Hardware fixture is covered by a Workflow -> Access Skill -> Loader/Index
integration test. No database, graph database, vector database, RAG, LLM
extraction, Research Artifact Layer, or new architecture layer was introduced.

The AI Hardware Example Knowledge Base is populated under
`examples/knowledge-bases/ai-hardware/` with source-traceable Entity, Relation,
Intelligence, Module, Taxonomy, View, Source, and Registry assets. The
canonical Example Registry is complete for runtime assets; unsupported fields
remain omitted rather than represented by mock claims.

## KNOWLEDGE-PHASE-2C-FRONTEND-MIGRATION-001

The AI Hardware validation page now reads Production Knowledge through a
deterministic server-side Frontend Projection Adapter and three read-only HTTP
endpoints. The runtime path is `KnowledgeLoader -> KnowledgeIndex -> Access
Skill -> Projection -> HTTP -> index.html`. The page no longer fetches the
legacy industry graph or directory JSON files. Legacy benchmark files remain
available for regression comparison.

Directory, graph, Entity detail, dynamic comparison tables, Intelligence-based
viewpoints and forecasts, event Facts, Source links, company financial Facts,
and conditional company-scale rendering are covered by focused adapter and HTTP
tests. No frontend package, persistent projection, database, LLM, or new
architecture layer was introduced.

## KNOWLEDGE-PHASE-2C-SEMANTICS-AND-LOCALIZATION-001

The Knowledge frontend now uses `CompanyScaleProjection` from company
`total-revenue` Financial Facts. Card area is mapped only when Fact period and
unit are comparable; `segmentRevenue` remains separate business-scale data and
is not the default input. No market-share denominator or percentage is
produced. Production Knowledge research content, Entity names, View names and
the frontend are Chinese-first, while stable machine contracts, professional
abbreviations, brands, product names, and source provenance stay canonical.

## KNOWLEDGE-PHASE-2C-SEGMENT-SCALE-001

Graph children now optionally expose raw same-level `market-size` Fact inputs
for frontend area comparison. Forecasts, invalid/inactive Facts, and
incomparable period/unit inputs are excluded from scaling; missing or
non-comparable levels render equally. Visual weights remain a frontend CSS
concern, and no market-share percentage or calculation engine was introduced.
Company cards continue to use company `total-revenue` Facts.

## RH-GOV-CONSISTENCY-002

The Architecture / Governance / AKShare consistency closure is complete for
the current main branch. The external Python AKShare Bridge now applies
annual/quarterly period semantics, rejects unsupported TTM with HTTP 422, and
preserves missing source dates instead of fabricating them. Deterministic
network-free Bridge tests, a pinned tool dependency manifest, and operating
documentation are included. Research Output and Knowledge remain separate
boundaries, with Knowledge lifecycle updates controlled by Workflow.

## RH-GOV-CONSISTENCY-002-R1

The AKShare Financial Bridge default-period regression is closed. An omitted
`periodType` now selects the latest valid financial period across annual and
quarterly rows, while explicit annual, quarterly, and TTM semantics remain
unchanged. Income indicator fields are matched to the selected report period;
missing matches do not fall back to another period. The default network-free
test suite is green and Python cache files are ignored by Git.

## ARCH-REFACTOR-003

ResearchHub migrated its product architecture to **Research Output and
Knowledge Infrastructure** in this historical task record. The DSH, Workflow,
Skill, and Plugin runtime boundaries are unchanged. New output is organized as
reports, machine-readable Research Objects, and Research Output Provenance.
ADR-015 subsequently superseded the repository-level `knowledge/` ownership
assumption with independent Knowledge Base Runtime Data.

The public Research Object Envelope is available from
`packages/schemas/research-object.ts`. The existing `research-output/`,
`knowledge/`, `packages/schemas/`, and `packages/shared/` paths are preserved
as implementation/history records; they do not define the user Runtime Data
root. They do not add a graph database, RAG, extraction pipeline, or automatic
Knowledge formation.

`packages/artifacts/`, `packages/memory/`, and `packages/evaluation/` remain
for compatibility and test coverage. Artifact Trace is now documented as
Research Output Provenance. Memory and Evaluation are deprecated as
independent product layers, and no DSH, Skill, Workflow, or Plugin logic was
changed.

## Historical: KNOWLEDGE-ARCHITECTURE-001

Knowledge Layer v0.1 was frozen as the Knowledge architecture at that point in
project history. Its semantic model remains valid, but its repository-level
`knowledge/` ownership and storage assumptions are superseded by Knowledge
Architecture v0.2 and ADR-015. The model supports dynamic industry knowledge
in five categories: facts, forecasts, viewpoints, trends, and risks.

Workflow owns Knowledge update orchestration and lifecycle management. The
Knowledge Skill provides the access interface. No Research Artifact Layer,
Knowledge Database, Graph Database, RAG, LLM Extraction, or autonomous update
engine is introduced. `packages/memory/` and `packages/evaluation/` remain
compatibility implementations only.

The frozen v0.1 detail documents are [Knowledge Skill Interface
v0.1](../architecture/RESEARCHHUB_KNOWLEDGE_SKILL_INTERFACE_V0.1.md) and
[Knowledge Storage Layout v0.1](../architecture/RESEARCHHUB_KNOWLEDGE_STORAGE_LAYOUT_V0.1.md).
The Skill interface is deterministic and read-only; the storage document
defines asset organization without defining a database or runtime.

## KNOWLEDGE-IMPLEMENTATION-PHASE-001

The first Knowledge engineering foundation is implemented. The repository now
has the top-level Knowledge asset directories, a deterministic YAML/JSON
Knowledge Loader with registry parsing and in-memory indexes, a read-only
Knowledge Access Skill, and a deterministic Knowledge Validation Skill with
structured reports.

The AI Hardware fixture dataset under `tests/knowledge/fixtures/` covers valid
entities, relations, intelligence, modules, sources, registry entries, and
deliberately invalid assets. Loader, Access Skill, Validation Skill, and
fixture-to-consumer integration tests pass without network, database, RAG, or
LLM dependencies.

Current limitation: the YAML reader intentionally supports the deterministic
subset required by the fixture assets; advanced YAML features such as anchors,
tags, and custom types are rejected. Production assets are source-traceable;
unsupported financial segment mappings remain omitted, and SW Level-1
taxonomy is a read-oriented auxiliary asset rather than a Loader runtime type.

## MEMORY-IMPLEMENTATION-001

Compatibility note: the Research Knowledge Memory MVP is implemented under
`packages/memory/`; it is not the current Knowledge Layer v0.1.
`MemoryItem`, `ResearchMemory`, and `InMemoryResearchMemoryStore` support
runtime-neutral storage and retrieval of Entity, Thesis, Prediction, Evidence,
and Review knowledge with Artifact and Trace references.

The existing `MemoryEntry`, `MemoryPlugin`, and local JSON compatibility path
remain unchanged. Automatic Memory Formation, database persistence, DSH Memory,
Agent Memory, Chat History, Prompt storage, and Knowledge Graph infrastructure
remain out of scope.

## PIPELINE-TRACE-INTEGRATION-001

Artifact Trace is now enabled by default for each `EquityResearchWorkflow`
instance. The Workflow owns an isolated `InMemoryTraceStore` and routes final
Evidence, Thesis, Prediction, and ResearchReport assembly through the
runtime-neutral `TraceArtifactBuilder`.

The canonical report trace ID is
`report:equity-research:<sessionId>`. A lineage query returns ResearchReport
containment, Thesis support from Evidence, and Prediction derivation from
Thesis. Existing Artifact Core payloads, Skill logic, Plugin interfaces, DSH,
and Workflow definitions remain unchanged.

## ARTIFACT-TRACE-IMPLEMENTATION-001

Artifact Trace Governance MVP is implemented under `packages/artifacts/trace/`.
It provides an append-only `InMemoryTraceStore`, Trace Event factories for
creation, update, derivation, linking, and validation, and bidirectional
lineage queries for Evidence, Thesis, Prediction, Review, and
`research_report` references without changing the current Artifact Core union.

`TraceArtifactBuilder` is an opt-in integration boundary around the existing
Evidence, Thesis, and Prediction builders, with a report-linking helper. The
design explicitly excludes DSH/Harness tracing, Agent Runtime logs, LLM tokens,
prompts, model reasoning, database storage, and automatic instrumentation. The
existing pipeline remains unchanged unless it opts into the builder.

## PIPELINE-REAL-DATA-003

The first real Equity Research Pipeline using CNINFO Official Announcements,
AKShare Financial, and the DeepSeek Runtime completed successfully for
`600519`.

Observed run:

- CNINFO Acquisition: 3 SearchResults, 3 fetched documents, 3 normalized
  articles, and 3 traceable Evidence records;
- AKShare Financial: real financial facts reached the Workflow context;
- DeepSeek Runtime: 5 Skill calls completed;
- Equity Research Workflow: all 6 steps completed;
- Artifacts: 9 Evidence records, linked Thesis and Prediction, and a
  22-section ResearchReport;
- Evaluation: `met`.

The real test is opt-in through `RUN_REAL_EQUITY_PIPELINE=1`,
`AKSHARE_FINANCIAL_ENDPOINT`, and `DEEPSEEK_API_KEY`. The default test suite
remains network-free.

## CNINFO-PROVIDER-FIX-001

CNINFO Official Announcement Provider has been fixed for real-data use. The
adapter now resolves `600519` through CNINFO's official stock directory to
`600519,gssh0600519`, sends browser-compatible request headers, supports
`seDate` ranges, accepts epoch-millisecond publication times, and treats a
zero-count null announcement list as an empty result.

CNINFO PDF announcements are fetched and text-extracted through `pdfjs-dist`
when inline announcement content is unavailable. The opt-in real test now
completes the full `CNINFO -> News Acquisition -> Evidence` path for `600519`.
The default suite remains network-free.

## NEWS-PROVIDER-002

The News Acquisition Layer now includes an alternative real-data path for
official company announcements. `OfficialAnnouncementSearchProvider` reuses
the existing CNINFO source adapter, maps official records to `SearchResult`,
and preserves source URL, publication time, issuer, security code, confidence,
and official-source metadata. `OfficialAnnouncementFetcher` carries the
official API's returned announcement content through the existing
Search -> Fetch -> Normalize -> Evidence path, including disclosures whose
source URL points to a PDF.

GDELT remains supported and unchanged. The default test suite does not access
the network. Real CNINFO validation is explicitly opt-in with
`RUN_REAL_OFFICIAL_NEWS=1 npm run test:official-news-real` and can use
`CNINFO_ANNOUNCEMENT_ENDPOINT` plus `OFFICIAL_NEWS_SYMBOL` for endpoint and
symbol overrides.


## Architecture

The Single DSH migration remains implemented, but current governance is now
defined by Research Output and Knowledge architecture. ResearchHub is
financial research knowledge infrastructure on DeepSeek Harness, not an Agent
Framework. The root-level `dsh/` directory contains the lightweight
ResearchManager Runtime Orchestrator. `packages/workflows` contains
runtime-neutral research SOP templates, `packages/skills` contains research
methods, and `packages/plugins` contains external-resource contracts and
adapters.

The `packages/` directory contains only composable research modules;
`packages/dsh` does not exist.

The removed top-level directories are not retained. Artifact core models and
verified Skill behavior were preserved through import and contract migration.

At that historical stage, the development phase was **Research Output &
Knowledge Infrastructure**. The validated foundation at that stage included:

- Harness integration and runtime boundary validation;
- Event Analysis, Company Research, and Industry Research Skills;
- Workflow definitions and thin executors;
- Artifact Trace as Research Output Provenance;
- compatibility Memory and Evaluation APIs, retained without new product-layer
  expansion;
- Research Output and Knowledge Layer boundaries.

Harness owns runtime execution and LLM reasoning. ResearchManager coordinates
these assets without becoming an Agent Planner.

The dependency direction is `dsh/` → `packages/`. Packages do not import DSH
types or implementation details, so the research assets can be reused by
another Runtime or external caller.

## Completed validation

- TypeScript compilation passes.
- Plugin registry and adapter tests pass.
- Workflow and ResearchManager tests pass.
- Artifact, Memory, Evaluation, Skill, and Harness integration tests pass.
- No source imports the removed package paths.
- At that stage, Research Output Architecture, Knowledge Layer Architecture,
  and ADR-014 defined the governance boundaries. Current governance is defined
  by Knowledge Architecture v0.2 and ADR-015. Architecture v0.3 and ADR-013
  remain historical compatibility records.

## Known constraints

Real external data activation still depends on credentials, source licensing,
bridge availability, rate limits, and data-quality review. Fixture tests remain
network-free and deterministic.

The financial Skill Asset Layer now includes runtime-neutral Equity Research,
Industry Research, Earnings Review, and Valuation packages. Each package has
its own definition, command implementation, schemas, report template, and
deterministic tests. The commands consume only injected Plugin ports, so they
can be called by DSH or another Runtime.

The root DSH financial-skill invocation smoke test also passes.

Pipeline validation is complete for the minimum Company Equity Research demo.
The validated path is:

`Research request → ResearchManager → Company Research Workflow → Company Research Skill → Market/News/Financial Plugins → Evidence/Thesis/Prediction Artifacts → Evaluation Review`

The integration fixture uses a public-company A-share example (`600519`) and
verifies Plugin call order, Workflow step dependencies, natural-language
question propagation, Artifact serialization round trips, and a successful
Evaluation result.

The formal `Equity Research Workflow` is now implemented under
`packages/workflows/equity-research/`. It composes Company Research, Industry
Research, Equity Research, Earnings Review, and Valuation through injected
Skill Adapters, exposes six step states, and returns a linked Evidence,
Thesis, Prediction, and ResearchReport bundle. The Workflow has no DSH or
Plugin implementation dependency.

Real LLM Runtime validation is complete for the Equity Research Workflow. The
runtime-specific adapter under `dsh/llm-runtime/` loads Skill prompts, calls
the Harness `LlmRuntime`, validates structured JSON responses, and maps them
to the existing Skill output contracts without changing Skill definitions,
Workflow structure, Plugin interfaces, or Artifact models. An opt-in test
using the DeepSeek-compatible provider path completed five Skill calls and
verified the final Artifact bundle, serialization round trips, and Evaluation
Review. The default test suite remains network-free; run
`RESEARCHHUB_RUN_REAL_LLM=1 npm run test:runtime` only when credentials and a
billable provider call are intended.

Real News Plugin validation is complete for the GDELT DOC provider. The
runtime-neutral `GdeltNewsPlugin` adapter retrieves bounded ArticleList JSON,
normalizes publication timestamps and source domains, and registers behind
the unchanged News Plugin interface. The explicit integration test maps the
external records into Company Research Evidence, verifies Artifact
serialization, and produces a successful Evaluation Review. The real test is
opt-in with `RUN_REAL_NEWS_PLUGIN=1`; default tests remain network-free.

Real Financial Plugin validation is implemented for the Tushare provider. The
existing `TushareFinancialPlugin` now combines documented statement endpoints
with `fina_indicator` and normalizes revenue, net profit, margins, EPS, and
basic financial ratios into the unchanged FinancialData boundary. The
Financial Plugin converts these reported facts into Evidence without making
investment judgments. Integration coverage passes the snapshot through the
Equity Research and Valuation Skill ports, serializes the resulting Artifacts,
and evaluates a traceable Prediction. The real test is opt-in with
`RUN_REAL_FINANCIAL_PLUGIN=1` and `TUSHARE_TOKEN`; the default suite remains
network-free.

AKShare is now the default real Financial Provider. The runtime-neutral
`AkShareFinancialPlugin` lives under `packages/plugins/adapters/financial/akshare/`
and connects through the configured HTTP Bridge, while the previous import path
remains a compatibility re-export. It normalizes the same revenue, profit,
margin, EPS, and ratio metrics as Tushare, feeds the unchanged Financial
Plugin and Evidence mapping, and is covered by an opt-in Equity Research
Workflow integration test. Tushare remains available as an explicit optional
Provider. The AKShare test requires `RUN_REAL_AKSHARE_FINANCIAL=1` and
`AKSHARE_FINANCIAL_ENDPOINT`; default tests remain network-free.

The first real Equity Research Pipeline validation is now implemented as an
opt-in integration test. It composes GDELT News, the default AKShare Financial
Provider, the DeepSeek Harness LLM Runtime, ResearchManager, and the existing
six-step Equity Research Workflow. The test verifies real provider payloads
reach all five LLM Skill calls, the Workflow completes, the ResearchReport and
Artifact relationships serialize correctly, and Evaluation returns a met
Review. The test requires `RUN_REAL_EQUITY_PIPELINE=1`,
`DEEPSEEK_API_KEY`, and `AKSHARE_FINANCIAL_ENDPOINT`; the earlier version
remained skipped until the AKShare Bridge endpoint was supplied.

`PIPELINE-REAL-DATA-002` now routes real news through the News Acquisition
Layer (`gdelt-search -> native-web-fetcher -> HtmlArticleNormalizer ->
NewsEvidenceBuilder`) instead of directly depending on `GdeltNewsPlugin`. The
test records acquisition counts, Provider metadata, Skill output summaries,
Workflow step states, Artifact relationships, and Evaluation status. The
offline path passes and remains network-free by default.

The first opt-in execution reached the Acquisition test boundary but was
blocked before Search returned by the current environment's GDELT connectivity:
Node initially reported `UND_ERR_CONNECT_TIMEOUT` on the GDELT host; enabling
Node's environment proxy mode still timed out, and the subsequent PowerShell
probe also timed out. No real Workflow, LLM, Artifact, or Evaluation result is
claimed from that attempt. The remaining blocker is external GDELT/proxy
availability, not the AKShare Bridge or the Acquisition Layer contract.

The News Acquisition Layer is now implemented as a runtime-neutral,
provider-independent path:

`SearchProvider -> WebFetcher -> ArticleNormalizer -> EvidenceBuilder`

It includes GDELT and Mock Search Providers, Native and Mock Web Fetchers,
HTML normalization, and serializable Evidence mapping. The existing GDELT News
Plugin and `search_company_news` contract remain compatible. Deterministic
acquisition tests are part of the default suite; real GDELT and web-fetch
coverage requires `RUN_REAL_NEWS_ACQUISITION=1`.

## KNOWLEDGE-PRODUCT-VALIDATION-SETUP-001

The local Knowledge Product Validation setup is implemented. At its setup
checkpoint it was `Completed / Awaiting Local Inputs`, pending a real DeepSeek
API key and local AI Hardware research reports. The setup uses the external Runtime Data Root
`../ResearchHubData/`, with a fresh `ai-hardware-real` Knowledge Base that
contains only canonical runtime scaffolding and an explicit user-defined
`industry:ai-hardware` domain anchor; it does not copy or alter the Git-managed
Example Knowledge Base.

The project-local `.env` is ignored and controls the official
`deepseek-official` provider, model, token budget, external report directory,
and runtime KB ID. The PDF resolver preserves raw bytes, extracts normalized
text with the existing `pdfjs-dist`, and emits page-aware chunks. The existing
Knowledge Curation Skill and Research Report Knowledge Ingestion Workflow are
composed unchanged. `knowledge:serve:real` selects the external KB explicitly
for the existing read-only frontend.

The setup checkpoint made no real LLM call or report ingestion. Local inputs
are now available and the execution result is recorded under
`KNOWLEDGE-PRODUCT-VALIDATION-RUN-001-R1`. Acceptance is `Accepted — Sol
verified`.

## KNOWLEDGE-PRODUCT-VALIDATION-SETUP-001-R1

R1 removes the AgentLoop TestKit from the real product-validation runtime.
The production composition now mounts only the pinned DSH `LlmRuntime`,
registers the official `deepseek-official` provider, and injects `ctx.llm`
through the existing Knowledge Curation model adapter. A loopback Mock Server
test verifies provider requests, fake test credentials, model selection, and
Curation prompt delivery without internet access. The setup remains
`Completed / Awaiting Local Inputs`; acceptance is `Review Pending / Sol
Verification`.

## KNOWLEDGE-PRODUCT-VALIDATION-RUN-001

The initial first real AI Hardware Knowledge Product Validation checkpoint was
blocked during local preflight before any DeepSeek request. The specified source PDF exists,
is readable, and has SHA-256
`998703cef102300518bb2edcbcc3e9bc26fa374f157b0714f3986c5028d78d63` with
size 3,209,114 bytes. The external `ai-hardware-real` Runtime KB remains at
revision 0 with only its user-defined industry anchor, zero relations,
intelligence, modules, and sources, and zero Raw bundles. The project `.env`
contains a key, but `RESEARCHHUB_REAL_LLM_ENABLED` is currently `false`, so
the paid API guard correctly stopped the run before report copy, ingestion,
or frontend startup. No Runtime KB or report file was changed.

This historical checkpoint remains `Paused / DOCUMENT_RESOLUTION` with
acceptance `Review Pending / Sol Verification`; it was superseded by the R1
resume recorded below.

## KNOWLEDGE-DOCUMENT-RESOLUTION-001

Document Resolution is implemented and accepted — Sol verified. The Document
Plugin now owns canonical raw bytes separately from parser bytes, exposes a
small runtime-neutral `DocumentParser` provider contract, selects providers
deterministically, retains `pdfjs-text` as an explicit lightweight fallback,
and adapts the local `docling-local` provider through a short-lived Python
bridge. The Workflow public contract remains `ResearchReportInputResolver`;
Workflow, Skill, Schema, and frozen architecture files were not changed.

The specified West Securities AI Hardware report was validated offline with
the PDF.js baseline: 103 pages, 103 page-aware chunks, 91,740 normalized
characters, and exact raw-byte preservation at 3,209,114 bytes with SHA-256
`998703cef102300518bb2edcbcc3e9bc26fa374f157b0714f3986c5028d78d63`. Docling
dependencies are present in the ignored local parser environment, but its
standard layout model cache is incomplete (`model.safetensors` is missing),
so the real Docling comparison remains an explicit local-environment blocker;
there was no silent PDF.js downgrade. DeepSeek and external document APIs were
not called.

Status is `Completed`; acceptance is `Accepted — Sol verified`.

## KNOWLEDGE-DOCUMENT-RESOLUTION-001-R1

Document Resolution R1 makes the Docling runtime deterministic. The setup
command manages the ignored `.researchhub-document-parser/venv/` environment,
installs the pinned Docling 2.116.0 dependency set, prefetches only the
pipeline's `layout` and `tableformer` models, and records the explicit local
artifacts path without exposing `.env` values. The doctor command performs no
installation and reports READY only after Python, version, artifacts,
model-initialization, fixture parsing, and table-pipeline checks pass.

The specified West Securities report was parsed locally with
`HF_HUB_OFFLINE=1` using `docling-local`: 103 pages, 1,523 structured chunks,
97,784 normalized characters, 158 headings, 45 tables, 178 image metadata
items, 154 sections, and 103 page-provenance pages. The returned raw bytes
remain exactly 3,209,114 bytes with SHA-256
`998703cef102300518bb2edcbcc3e9bc26fa374f157b0714f3986c5028d78d63`. The
PDF.js baseline remains 103 pages, 103 chunks, and 91,740 characters. Setup is
idempotent (`modelDownload: SKIPPED` on the second run). No DeepSeek request,
Knowledge ingestion, external document parsing API, Workflow, Skill, Schema,
or architecture change occurred.

Status is `Completed`; acceptance is `Accepted — Sol verified`.

## KNOWLEDGE-PRODUCT-VALIDATION-RUN-001-R1

The first real AI Hardware Product Validation resumed after Document
Resolution Parent and R1 acceptance, using exactly one specified report:
`20260805-西部证券-AI算力行业：AI算力上游材料产业链研究报告.pdf`. The source
bytes are 3,209,114 bytes with SHA-256
`998703cef102300518bb2edcbcc3e9bc26fa374f157b0714f3986c5028d78d63`. The
local Docling parser completed offline with 103 pages, 1,523 structured
chunks, 97,784 normalized characters, 158 headings, 45 tables, 178 image
metadata items, 154 sections, and 103 page-provenance pages.

One authorized real DeepSeek call was made with provider
`deepseek-official`, model `deepseek-v4-pro`, and max tokens `65,536`. Curation
blocked at Source Assessment because the model returned an unsupported
`sourceType` value. No retry was made. Downstream curation operations were not
run, so source assessment, candidates, semantic Knowledge objects, and schema
gap proposals are unavailable or empty. The workflow run is
`product-validation-1285f61f9d06ce6bfddb`, status `blocked`, failure stage
`curation`, base/final revision `0`.

The exact Raw PDF was durably archived in the external Runtime KB
`ai-hardware-real`; no source, entity, relation, intelligence, module, or
Manifest revision was committed. The post-run KB inventory is one industry
anchor (`industry:ai-hardware`), zero relations, intelligence objects,
modules, and sources. Full Knowledge Validation passed with zero errors and
zero warnings. Raw provenance is verified for the archived PDF; no semantic
provenance chain exists because no semantic object was admitted.

The real frontend service is available at `http://localhost:4174/tests/knowledge/`
because port 4173 was already occupied. Its real-KB directory, graph, anchor
entity, and HTML endpoints returned HTTP 200; the empty graph is an honest
projection of the unchanged Runtime KB. Product findings are categorized as
`DOCUMENT_RESOLUTION: PASS`, `LLM_CURATION: BLOCKED`,
`KNOWLEDGE_SCHEMA: N/A`, `REFERENCE_RESOLUTION: NOT_REACHED`,
`INGESTION_WORKFLOW: BLOCKED_AT_CURATION`, `FRONTEND_PROJECTION: PASS`, and
`PRODUCT_EXPECTATION: REVIEW_REQUIRED`. No manual repair or second report is
authorized by this run.

Status is `Product Validation Blocked`; acceptance is `Review Pending / Sol
Verification`.
