# Changelog

## 2026-09-02 - KNOWLEDGE-V0.3-PRODUCT-VALIDATION-C-004-R9-R6-FINAL

- Performed the single authorized R9-R6 launcher attempt from the exact C18
  baseline 13927f6268c8a7764a1270379f6ae5f67968bce6.
- Baseline verification passed, but the launcher stopped before runtime
  initialization because RESEARCHHUB_REAL_LLM_ENABLED was not true.
- No real pipeline stage ran and no correction rerun was performed. Evidence:
  tests/knowledge/product-validation/evidence/c004-r9-r6-final-full-pipeline.json
  with SHA256 B08E722A4B148D7899051A7A8879D45817BE27B0D647E1BFCB46E147ACB6020F.
- R9-R6 status: Completed / INVALID TEST SETUP / SOL REVIEW REQUIRED.

## 2026-09-02 - KNOWLEDGE-V0.3-R9-OBSERVER-RETRY-ATTRIBUTION-C-018

- Corrected R9 retry attribution to use actual validation-failure attempt/code
  evidence and physical-attempt ordering.
- Terminal partial candidate validation no longer correlates with retry by
  retryCount alone. Completion failures and candidate-set exhaustion are
  attributed explicitly; unexplained retry after a partial result remains a
  failure.
- Added deterministic A-G coverage and candidate-isolation evidence fields
  retryAttribution and partialRejectionTriggeredRetry.
- Preserved all existing third-attempt, C9, accounting, Writer, revision,
  C8/C14, replay, provenance, and final-KB gates. No real R9-R6 execution was
  performed and no Product implementation was changed.
- C18 status: Completed / Accepted - Sol verified.
- C4-R9-R5 classification: Completed / FAIL - R9 Observer Retry-Cause
  Attribution Defect - Sol verified.

## 2026-09-02 - KNOWLEDGE-V0.3-PRODUCT-VALIDATION-C-004-R9-R5-FINAL

- Executed the single authorized real Full Pipeline validation after C17 from
  baseline `37b4467b32da2ab6e30815a4bcb227b75d94fc67`.
- Provider, frozen PDF, Docling, fresh KB, 18-batch extraction, C14, final
  ChangeSet validation, Writer, and revision advancement were observed in the
  primary Workflow result.
- C17 recorded 2 Claim `invalid_semantics` candidate-local rejections with no
  rejected-candidate leakage or empty safe `subjectRefs`.
- The prior R9 observer classified the run FAIL / SOL REVIEW REQUIRED at
  `extraction_complete` because a partial-rejection batch also had a bounded
  retry. The retry recorded the natural max-tokens completion path; no third
  attempt occurred. Final KB reload, provenance, and replay were not recorded
  after the observer stopped.
- Evidence: `tests/knowledge/product-validation/evidence/c004-r9-r5-final-full-pipeline.json`
  with SHA256 `39DAD2CC2BFC3FC9EEA55896821C6EB72E5DDBB52FC5E879CC67A4A5B7BDB4A7`.
- C4-R9-R5 status: Completed / FAIL - R9 Observer Retry-Cause Attribution
  Defect - Sol verified. Stage C remains In Progress / not accepted.

## 2026-09-02 - KNOWLEDGE-V0.3-CLAIM-SUBJECT-INVARIANT-C-017

- Closed the Claim subject non-empty invariant at the output Contract,
  candidate-local Validator, Reference Resolution, and Post-Resolution Write
  Readiness boundaries.
- Subjectless Claims are rejected as `invalid_semantics`; valid sibling
  candidates survive, while all-rejected extraction retains the existing
  `candidate_set_exhausted` and one bounded C9 retry behavior.
- Canonical Claim projection has no invented or fallback subject, and the
  authoritative Schema 0.3 validator remains unchanged.
- Added deterministic coverage for Contract cardinality, candidate isolation,
  C9 exhaustion, Resolution defense, Write Readiness exclusion, and valid
  single/multi-subject Claims.
- C17 status: Completed / Accepted - Sol verified. Stage C remains In Progress /
  not accepted and R9-R5 is recorded separately as Completed / FAIL - SOL
  REVIEW REQUIRED.

## 2026-09-02 - KNOWLEDGE-V0.3-PRODUCT-VALIDATION-C-004-R9-R4-FINAL

- Executed the single authorized real Full Pipeline validation from baseline
  `97d047db3b917db2ec3a2580ecfabef060dad5e5` after C16.
- Frozen PDF identity, Local Docling 2.116.0, 18/18 extraction batches,
  candidate validation, Reference Resolution, and C14 were verified.
- C16 isolated 240 review candidates and planned 1,140 safe Knowledge creates,
  but final deterministic validation still failed with
  `V03_CLAIM_SUBJECT_INVALID`; Writer did not run and revision remained 0.
- Preserved sanitized evidence at
  `tests/knowledge/product-validation/evidence/c004-r9-r4-final-full-pipeline.json`
  with SHA256
  `E594DF0B48EFB38B87EC92FD39905AD57E8B43DBD8CF5E5341BF18FE2434123C`.
- R9-R4 status: Completed / FAIL - Claim Subject Non-Empty Contract Gap - Sol
  verified. Stage C remains In Progress / not accepted.

## 2026-09-02 - KNOWLEDGE-V0.3-POST-RESOLUTION-WRITE-READINESS-C-016

- Added deterministic post-resolution write-readiness inside the existing
  Research Report Knowledge Ingestion Workflow.
- Relation endpoints and Claim subjects now project from authoritative
  Reference Resolution refs, including deterministic temporary Entity ref
  mapping.
- Resolved Relation semantics and new-object `business_exposure` cardinality
  collisions are isolated into review before ChangeSet planning; no LLM
  reconciliation is used for these post-resolution facts.
- Added deterministic ingestion regression coverage for projection,
  deferred semantics, collision isolation, exact duplicates, and mixed safe /
  review ChangeSets.
- C16 is `Completed / SOL VERIFICATION REQUIRED`; Stage C remains In Progress /
  not accepted and R9-R4 remains NOT AUTHORIZED. Implementation commit:
  `2597b9e`.

## 2026-09-02 - KNOWLEDGE-V0.3-PRODUCT-VALIDATION-C-004-R9-R3-FINAL

- Executed the single authorized isolated real Full Pipeline validation from
  baseline `8c81cb8fcb3c5dd6787d380b0161f28b5447fa3b`.
- Frozen PDF identity, Local Docling 2.116.0, fresh Knowledge Base, 18-batch
  extraction, Reference Resolution, and reconciliation planning were observed;
  the C14 boundary reached `reached_and_passed`.
- Primary Workflow failed during deterministic validation on real output, with
  `V03_REQUIRED_FIELD_MISSING` (`targetRef`) as the first error and no
  upstream provider/runtime failure. Writer, provenance, and replay did not
  run because validation blocked at revision 0.
- Preserved sanitized evidence at
  `tests/knowledge/product-validation/evidence/c004-r9-r3-final-full-pipeline.json`.
- C4-R9-R3 status: Completed / FAIL - Deterministic Post-Resolution
  Write-Projection Boundary Defect - Sol verified. Stage C remains In Progress /
  not accepted.

## 2026-09-02 - KNOWLEDGE-V0.3-EXTRACTION-COMPLETION-RESILIENCE-C-015-R2

- Added runtime-neutral execution facts for deterministic Reference Resolution
  counts and reconciliation-planning reachability/group count.
- Preserved those facts through reconciliation and schema-gap exceptions in
  `blocked()`; validation and Writer post-resolution behavior remains intact.
- Updated R9 boundary evidence to distinguish observed numeric zero from
  unobserved `null` and to require observed planning for C14 PASS.
- Added Workflow-level and R9 deterministic regression coverage. Historical
  R9-R2 evidence remains unchanged; no real LLM, DeepSeek, or R9-R3 execution
  occurred.
- Status: Completed / SOL VERIFICATION REQUIRED.

## 2026-09-02 - ARCH-LEGACY-MEMORY-EVALUATION-RETIREMENT-001

- Retired and removed the standalone `packages/memory/` and
  `packages/evaluation/` compatibility modules.
- Moved active Outcome and deterministic Prediction comparison behavior into
  the existing Artifacts/Review boundary.
- Removed legacy Memory/Evaluation test scripts and compatibility-only tests;
  historical documentation remains preserved.
- Status: Completed / SOL VERIFICATION REQUIRED.

## 2026-09-02 - KNOWLEDGE-V0.3-EXTRACTION-COMPLETION-RESILIENCE-C-015-R1

- Added the runtime-neutral Workflow fact `referenceResolutionReached` and
  made R9 boundary evidence depend on that execution fact rather than final
  `status=blocked`.
- Extraction-stage blocks now record `not_reached` with null resolution
  counts; post-Resolution validation and Writer failures retain reached
  boundary states.
- Added deterministic coverage for extraction, post-Resolution validation,
  Writer, reached-and-failed, null-count, and historical-evidence cases.
- C15-R1 is Completed / SOL VERIFICATION REQUIRED; Stage C remains In
  Progress and C4-R9-R3 is not authorized.

## 2026-09-02 - KNOWLEDGE-V0.3-EXTRACTION-COMPLETION-RESILIENCE-C-015

- Corrected explicit `finish_reason=max-tokens` handling to emit
  `invalid_model_output`, discard partial output, and reuse the existing
  bounded C9 retry without increasing `maxTokens` or changing batching.
- Corrected R9 evidence ordering so extraction-stage blocks record
  `reconciliationBoundary.status=not_reached` and never claim C14 boundary
  verification before Reference Resolution.
- Added focused adapter, C9, R9 boundary, classification, transport, and
  historical-evidence immutability tests, plus derived R9-R2 Sol adjudication
  evidence. No real LLM/DeepSeek/R9-R3 execution occurred.
- C15 is Completed / SOL VERIFICATION REQUIRED; Stage C remains In Progress
  and C4-R9-R3 is not authorized.

## 2026-09-02 - KNOWLEDGE-V0.3-PRODUCT-VALIDATION-C-004-R9-R2-FINAL - Result

- The one authorized real run completed with
  `FAIL - Extraction Output Completion Boundary Defect - Sol verified` after
  the Provider returned `finish_reason=max-tokens` for extraction batch-0004
  at the frozen 65536-token limit.
- Reference Resolution was not reached, so the C14 fresh-KB boundary was not
  proven by R9-R2. The original evidence remains unchanged; the derived Sol
  adjudication is recorded separately.
- Durable evidence:
  `tests/knowledge/product-validation/evidence/c004-r9-r2-final-full-pipeline.json`.
- Stage C remains In Progress / not accepted; C4-R9-R3 is not authorized.

## 2026-09-02 - KNOWLEDGE-V0.3-PRODUCT-VALIDATION-C-004-R9-R2-FINAL

- Authorized the single R9-R2 full-pipeline real validation from the exact
  C14-accepted baseline `edee915ff54e0b6bfb0de5eba2e21ccb6e1ef599`.
- Added the isolated R9-R2 launcher and package command with a fresh-KB hard
  invariant requiring zero `existing_ref` candidates and zero reconciliation
  logical or physical provider calls.
- Stage C remains In Progress / Awaiting C4-R9-R2 Sol Verification; no Stage C
  acceptance is predeclared.

## 2026-09-02 - KNOWLEDGE-V0.3-RECONCILIATION-BOUNDARY-C-014

- Corrected the reconciliation boundary so only exact same-kind `existing_ref`
  targets enter model reconciliation; new objects bypass it and retain
  deterministic create semantics.
- Separated candidate target refs from dependency/context refs, projected
  reconciliation model input without the full document, and added one bounded
  deterministic-validation retry with complete model-call accounting.
- Corrected the nullable upstream relation endpoint contract check and added
  bounded sanitized blocked diagnostics with reconciliation group observability.
- Offline curation, ingestion, product-validation, integration typecheck, and
  full regression verification passed. C14 was accepted by Sol; no real LLM or
  DeepSeek run was performed during C14.

## 2026-09-01 - KNOWLEDGE-V0.3-PRODUCT-VALIDATION-C-004-R9-R1

- C4-R9 historical result corrected to `Completed / INVALID TEST SETUP -
  Smoke Observer Timeout - Sol verified`; its validation observer locally
  aborted batch-0008 after 180 seconds while the upstream stream was active.
- Added a passive R9-class observer that forwards the original runtime signal
  without creating an AbortController, timeout, or per-call cancellation.
- Corrected blocked-result ordering and added focused offline coverage. The
  one supervised R9-R1 run completed all 18 extraction batches, then failed
  during reconciliation on `invalid_reference` without Writer or replay:
  `FAIL / SOL REVIEW REQUIRED`.
- R9-R1 evidence: `tests/knowledge/product-validation/evidence/c004-r9-r1-final-full-pipeline.json`.
  Stage C remains In Progress / Awaiting C4-R9-R1 Sol Verification.

## 2026-09-01 - KNOWLEDGE-V0.3-PRODUCT-VALIDATION-C-004-R9-FINAL

- Commit A `1abf11ea686c5784f0e1d82f06be339270925447` was used for the unique
  supervised real Provider process.
- Runtime, exact PDF, Local Docling, and fresh-KB gates passed; the process
  timed out at batch-0008 attempt 1 after 180016 ms and returned
  `BLOCKED / EXTERNAL SERVICE - SOL REVIEW REQUIRED` before Writer or replay.
- Durable evidence: `tests/knowledge/product-validation/evidence/c004-r9-final-full-pipeline.json`.
- Stage C remains In Progress / Awaiting C4-R9 Sol Verification; no acceptance
  is predeclared.

## 2026-09-01 - KNOWLEDGE-V0.3-POST-C13-REAL-CANDIDATE-ISOLATION-SMOKE-C-004-S3-R2

- Ran exactly one supervised process-local isolated real Flash smoke with a
  600-second outer watchdog. The child reached the durable `completed` phase
  in 267192 ms from the exact C13-R1 baseline.
- Runtime/input gates passed: deepseek-official/deepseek-v4-flash, exact PDF
  identity, frozen Docling metrics, fresh Schema 0.3 / Storage 1 Knowledge
  Base, understandReport, and batch-0001 extraction. Physical accounting was
  two real-model calls, one physical extraction call, retryCount zero, and no
  writer/revision mutation; the smoke boundary stopped before batch-0003
  delegation.
- The first-run evidence serializer did not project nested candidate
  validation attempts, so exact accepted/rejected counts remain absent from
  the historical artifact and were not fabricated. Sol adjudicated candidate
  isolation from the durable invalid endpoint observations, frozen C13
  semantics, validationStatus `passed`, one extraction, zero retry, and the
  `candidate_set_exhausted` invariant. The result is
  `Accepted / PASS - CANDIDATE ISOLATION EXERCISED - Sol verified`; the smoke
  was not rerun.
- Separate sanitized adjudication evidence is
  tests/knowledge/product-validation/evidence/c004-s3-r2-sol-adjudication.json.
- Durable sanitized evidence is
  tests/knowledge/product-validation/evidence/c004-s3-r2-post-c13-real-candidate-isolation-smoke.json.

## 2026-09-01 - KNOWLEDGE-V0.3-POST-C13-REAL-CANDIDATE-ISOLATION-SMOKE-C-004-S3-R1

- Started the authorized first-batch real Flash smoke from the exact C13-R1
  baseline through the isolated `.env` child launcher.
- The run exceeded the external 120-second command boundary before durable
  evidence was emitted. The verified process chain was terminated, no retry was
  made, and candidate behavior remains unobserved.
- Durable sanitized evidence is
  `tests/knowledge/product-validation/evidence/c004-s3-r1-post-c13-real-candidate-isolation-smoke.json`.
  S3-R1 is Completed / INVALID TEST SETUP - External Execution Boundary Too
  Short - Sol verified; no full report validation or
  C4-R9 execution occurred.

## 2026-09-01 - RH-REAL-ENV-BOOTSTRAP-001-R1

- Ran exactly one process-local isolated `/models` preflight after removing
  inherited Real Runtime overrides from the child environment before native
  Node `.env` loading.
- Parent `DEEPSEEK_API_KEY` was present; the isolated `.env` bootstrap
  succeeded, `/models` returned HTTP 200, and Flash was available.
- Classified the result as `PARENT ENV OVERRIDE CONFIRMED / ENV FILE CREDENTIAL
  READY`. The previous 401 was stale-parent shadowing; no global environment
  state changed and no S3-R1 or product validation ran.
- RH-REAL-ENV-BOOTSTRAP-001 is Accepted - Sol verified. S3 is
  `Completed / INVALID TEST SETUP - Parent Environment Credential Override -
  Sol verified`.

## 2026-09-01 - RH-REAL-ENV-BOOTSTRAP-001

- Added the canonical generic `knowledge:smoke:real` entry using Node native
  `--env-file=.env` and reused the existing post-C12 smoke runner.
- Added a safe `knowledge:preflight:real` entry that performs only the
  authorized `/models` credential/model check and reports no key material.
- Added deterministic fake-value coverage for Node env-file bootstrap,
  observed parent-process precedence, and confirmed DSH consumes
  `process.env` without `.env` parsing. No dotenv dependency was added.
- The initial canonical preflight returned HTTP 401 because a parent
  credential shadowed `.env`; R1 confirmed the `.env` credential is ready.
  S3 remains historical invalid test setup and was not rerun.

## 2026-09-01 - KNOWLEDGE-V0.3-POST-C13-REAL-CANDIDATE-ISOLATION-SMOKE-C-004-S3

- Started the authorized first-batch real Flash smoke from the exact C13-R1
  baseline with the deepseek-official/deepseek-v4-flash runtime.
- Baseline verification passed, but the DeepSeek /models credential preflight
  returned HTTP 401. The run stopped before PDF, Docling, fresh-KB,
  understandReport, or extractKnowledge; physical LLM and extraction calls
  were zero.
- Durable sanitized evidence is
  tests/knowledge/product-validation/evidence/c004-s3-post-c13-real-candidate-isolation-smoke.json.
  S3 is Completed / INVALID TEST SETUP - Parent Environment Credential
  Override - Sol verified and has no real-output candidate-isolation evidence.
  C13 and C13-R1 are Accepted - Sol verified; Stage C remains In Progress and
  C4-R9 remains NOT AUTHORIZED.

## 2026-09-01 - KNOWLEDGE-V0.3-CANDIDATE-ISOLATED-VALIDATION-C-013-R1

- Corrected the C13 trusted-boundary defect by adding candidateId to the
  existing global trusted-key traversal before candidate partition.
- Entity, Relation, Claim, and nested model-generated candidateId values now
  cause operation-fatal invalid_reference; the injected value is not included
  in candidate rejection metadata or retry feedback. Candidate-local checks
  remain as defense-in-depth.
- Added focused trusted-boundary, C9 recovery/persistent-failure, and metadata
  safety tests. No real LLM, PDF, or API call was made.
- C13 and C13-R1 are Accepted - Sol verified; Stage C remains In Progress and
  is not accepted; S3 is Completed / INVALID TEST SETUP - Parent Environment
  Credential Override - Sol verified and C4-R9 remains NOT AUTHORIZED.

## 2026-09-01 - KNOWLEDGE-V0.3-CANDIDATE-ISOLATED-VALIDATION-C-013

- Added deterministic candidate-level isolation to Knowledge v0.3
  extractKnowledge after global output validation. Local Entity, Relation,
  and Claim failures are rejected independently with sanitized metadata while
  accepted candidates preserve original array ordinals.
- Preserved operation-fatal trusted/top-level failures, valid empty arrays, and
  the existing single C9 retry for candidate_set_exhausted; partial local
  rejection does not retry.
- Added Workflow metadata for accepted/rejected counts, rejection code counts,
  sanitized rejection details, and retry attempts. Only accepted candidates
  reach downstream consolidation, reconciliation, ChangeSet, and Writer.
- Added focused C13 and workflow isolation/retry tests. No real LLM, PDF, or
  API call was made. C13 is Completed / Sol Verification Pending; C4-S2 is
  Completed / Engineering Rework Required - Sol verified; C4-R9 remains NOT
  AUTHORIZED; Stage C remains In Progress and is not accepted.

## 2026-09-01 - KNOWLEDGE-V0.3-POST-C12-REAL-EXTRACTION-SMOKE-C-004-S2

- Ran the bounded real Flash smoke through the normal Workflow, DSH, and
  Knowledge Curation path using the exact R8 PDF, Local Docling, and a fresh
  Schema 0.3 / Storage 1 KB.
- Confirmed both real `extractKnowledge` requests carried C12 guidance with
  all 14 canonical relation entries and identical retry guidance.
- Batch-0001 still failed strict validation: attempt 1 emitted
  `upstream_of` with `product->product`; the single retry emitted
  `product->industry`. No later batch, Writer, downstream model call, or
  semantic revision was reached. Three physical real model calls were made.
- Durable sanitized evidence is
  `tests/knowledge/product-validation/evidence/c004-s2-post-c12-extraction-smoke.json`.
  S2 is `Completed / Engineering Rework Required - Sol verified`; C12 is `Accepted - Sol
  verified`; Stage C remains in progress and is not accepted.

## 2026-09-01 - KNOWLEDGE-V0.3-RELATION-SELECTION-GUIDANCE-C-012

- Added a pure model-facing Relation selection guide to `extractKnowledge`.
- Generated all 14 canonical relation compatibility entries from executable
  Schema 0.3 definitions in stable relation vocabulary order, including
  endpoint types, semantic descriptions, and optional endpoint constraints.
- Added endpoint-first, semantic-description matching, omission, no-coercion,
  and no-lexical-selection guidance. The shared guide is byte-identical across
  the first extraction attempt and the existing C9 retry; only bounded retry
  feedback is added.
- Added exact Schema-parity and retry-equality tests. All deterministic Curation,
  Ingestion, Workflow, Knowledge, Runtime, Migration, Product Validation, and
  TypeScript checks pass. No real LLM/API call was made.
- C12 is `Accepted - Sol verified`; C4-R8-FINAL remains
  `Completed / FAIL - SOL REVIEW REQUIRED`; Stage C remains in progress and is
  not accepted. DSH multi-provider / other-API capability portability remains
  deferred pending detailed user requirements.

## 2026-09-01 - KNOWLEDGE-V0.3-PRODUCT-VALIDATION-C-004-R8-FINAL

- Executed the one authorized full real Knowledge v0.3 pipeline run with the
  exact PDF, Local Docling, fresh Schema 0.3 / Storage 1 state, and Flash.
- PDF identity, Docling baseline, credential/model preflight, Raw-first, and
  `understandReport` passed. Batch-0001 failed an `upstream_of` endpoint
  semantic validation; its single C9 retry repeated the same violation.
- The Workflow stopped immediately without a third attempt or downstream
  semantic stages. Raw was created, revision stayed 0, and no production fix
  was applied. Replay was not executed because primary ingestion failed.
- Durable sanitized evidence is
  `tests/knowledge/product-validation/evidence/c004-r8-final-full-pipeline.json`.
  R8 is `Completed / FAIL - SOL REVIEW REQUIRED`; Stage C remains in progress
  pending R8 Sol verification and is not accepted.
- The explicit real `reprocess=true` rerun was not executed due to the stated
  token-budget policy. Multi-provider/other-API and reasoning capability
  portability remain deferred pending detailed user requirements.

## 2026-09-01 - KNOWLEDGE-V0.3-FLASH-EXTRACTION-SMOKE-C-004-S1

- Ran the authorized bounded real smoke against the exact required PDF through
  the normal Knowledge v0.3 / Storage 1 Workflow with Local Docling, a fresh
  isolated Knowledge Base, and Raw-first persistence.
- Effective runtime was `deepseek-official/deepseek-v4-flash`; four physical
  real model invocations were made, including one bounded extraction retry.
  The third distinct extraction request was stopped before provider delegation
  by the validation-only sentinel.
- Docling matched the frozen baseline. C8 visibility remained closed, and C11
  observed 14 relation branches with `component_of` product/null endpoints,
  closed empty attributes, and no `costShare`. Writer and downstream semantic
  stages were not reached; revision remained 0.
- Durable sanitized evidence is
  `tests/knowledge/product-validation/evidence/c004-s1-flash-extraction-smoke.json`.
  The smoke is `Completed / PASS - Sol Verification Pending`; Stage C remains
  in progress and is not accepted.
- DSH multi-provider / other-API capability portability (including reasoning
  capability compatibility) is `Deferred / Awaiting Detailed User
  Requirements`; no implementation task is created.

## 2026-09-01 - RH-LLM-DEFAULT-FLASH-001

- Changed the active ResearchHub DeepSeek default from `deepseek-v4-pro` to
  `deepseek-v4-flash` in runtime configuration and `.env.example`.
- Preserved `RESEARCHHUB_LLM_MODEL` overrides, including explicit Pro; provider,
  base URL, credential handling, reasoning, temperature, max tokens, adapters,
  Workflow, and Knowledge behavior are unchanged.
- Updated offline configuration coverage for default Flash, explicit Flash, and
  explicit Pro. No real LLM or PDF request was made.
- Historical R5/R6/R7 evidence and prior execution records remain unchanged and
  continue to record the Pro model actually used at those times.
- RH-LLM-DEFAULT-FLASH-001 is `Accepted - Sol verified`; Stage C remains in
  progress and is not accepted.

## 2026-08-31 - KNOWLEDGE-V0.3-RELATION-AWARE-OUTPUT-CONTRACT-C-011

- Replaced the generic `extractKnowledge` RelationCandidate contract with one
  Schema-derived discriminated branch per frozen relation type.
- Derived endpoint entity types, attribute keys, enum values, numeric bounds,
  and closed `financialContribution` fields from the executable Schema; no
  attribute relations explicitly require `{}` and `component_of` cannot
  contractually declare `costShare`.
- Preserved Validator authority, C8 projection, C9 one-retry policy, C10
  diagnostics, reasoning policy, DSH serialization, public output shape, and
  Workflow semantics. Added exhaustive parity, regression, retry, projection,
  and adapter-boundary coverage. The C11 implementation task itself had no
  real PDF run; the bounded C4-S1 smoke is recorded separately above.
- C11 is `Accepted - Sol verified`; C4-R7 is `Completed / Engineering Rework
  Required - Sol verified`; the bounded C4-S1 smoke is recorded separately
  above and Stage C remains in progress and is not accepted.

## 2026-08-31 - KNOWLEDGE-V0.3-PRODUCT-VALIDATION-C-004-R7

- Reran the exact real PDF after C10 with a fresh Schema 0.3 / Storage 1
  Knowledge Base and the normal production Workflow.
- Credential/model, PDF, Docling, Raw-first, C8 visibility, and C7 reasoning
  gates passed. The first batch failed one validation, and its single retry
  produced a different Relation endpoint `invalid_semantics` failure with a
  complete, untruncated C10 diagnostic.
- The Workflow stopped without a third call or downstream stages. Durable
  sanitized evidence is
  `tests/knowledge/product-validation/evidence/c004-r7-real-pdf-summary.json`.

## 2026-08-31 - KNOWLEDGE-V0.3-VALIDATION-FEEDBACK-C-010

- Enriched deterministic Relation endpoint `invalid_semantics` feedback with
  the failing candidate ordinal, relation type, received endpoint types, and
  executable-schema-derived allowed endpoint types.
- Preserved the Validator authority, C8 projection, C9 one-retry policy,
  model-call accounting, valid Relation behavior, and existing 240-character
  feedback cap.
- Added validator, retry, persistent-failure, projection, call-accounting,
  regression-matrix, and TypeScript coverage. No real PDF run was performed.

## 2026-08-31 - KNOWLEDGE-V0.3-PRODUCT-VALIDATION-C-004-R6

- Reran the exact real PDF through the normal Schema 0.3 / Storage 1 Workflow
  with Local Docling, the configured DeepSeek model, a fresh isolated KB, and
  the C9 bounded extraction retry.
- Credential/model, PDF, Docling, Raw-first, reasoning, batching, and C8
  visibility gates passed. Three extraction batches retried once; two
  recovered and `batch-0009` remained rejected by deterministic
  `invalid_semantics` after the allowed retry.
- The Workflow stopped without a third call or downstream commit stages.
  Durable sanitized evidence is
  `tests/knowledge/product-validation/evidence/c004-r6-real-pdf-summary.json`.

## 2026-08-31 - KNOWLEDGE-V0.3-EXTRACTION-VALIDATION-RETRY-C-009

- Added Workflow-owned bounded retry for deterministic `extractKnowledge`
  validation failures, with at most one retry per logical batch.
- Added sanitized retry feedback at the Curation Skill boundary while
  preserving the C8 projection, strict validation, C7 reasoning policy, and
  existing runtime envelope.
- Changed retry accounting to retain logical `retryCount` and count actual
  model invocations in ChangeSet `ingestionContext.modelCalls`.
- Added focused recovery, persistent-failure, no-retry, projection, and
  physical-call-accounting tests. No Schema, Validator, DSH, provider, Writer,
  Access, Migration, or frontend behavior changed.

## 2026-08-31 - KNOWLEDGE-V0.3-PRODUCT-VALIDATION-C-004-R5

- Reran the exact real PDF from the C8 baseline with real Docling Local,
  DeepSeek `deepseek-v4-pro`, a fresh writable Schema 0.3 / Storage 1 KB, and
  the normal Workflow.
- Credential/model, PDF, Docling, Raw-first, C7 reasoning policy, and C8
  extraction visibility gates passed. `batch-0001` passed strict validation;
  `batch-0003` stopped the Workflow on deterministic
  `invalid_semantics` relation endpoint validation.
- Stopped without retry, normalization, output repair, production patch,
  replay, or reprocess. Durable sanitized evidence is
  `tests/knowledge/product-validation/evidence/c004-r5-real-pdf-summary.json`.

## 2026-08-31 - KNOWLEDGE-V0.3-EXTRACTION-MODEL-INPUT-PROJECTION-C-008

- Added a pure Curation Skill projection for `extractKnowledge` that exposes
  only the current batch, filtered report-understanding evidence refs, and
  minimum-permission semantic Knowledge context.
- Kept the complete authoritative input for unchanged deterministic
  validation, preserving defense-in-depth rejection of out-of-batch refs.
- Added visibility-invariant, non-mutation, valid-output, malicious-output,
  and non-extraction-operation regression coverage. No Workflow, DSH, Schema,
  Validator, prompt, batch, reasoning-policy, or runtime-envelope change was
  introduced.

## 2026-08-31 - KNOWLEDGE-V0.3-PRODUCT-VALIDATION-C-004-R4

- Ran the real PDF through the C7 operation-specific reasoning policy with
  the exact artifact, real Docling Local, a fresh isolated v0.3 KB, Raw-first,
  and the normal Knowledge ingestion Workflow.
- Credential/model preflight, PDF integrity, Docling metrics, Raw persistence,
  `understandReport=off`, and the first `extractKnowledge=off` call passed;
  the first extraction batch then failed strict validation because an
  `evidenceChunkRefs` value was outside its supplied batch.
- Stopped at the normal Workflow failure boundary. No retry, normalization,
  output repair, production patch, replay, reprocess, or fabricated evidence
  was introduced. Durable sanitized evidence is
  `tests/knowledge/product-validation/evidence/c004-r4-real-pdf-summary.json`.

## 2026-08-31 — KNOWLEDGE-V0.3-LLM-REASONING-POLICY-C-007

- Added an exhaustive, operation-specific reasoning policy to the Knowledge
  Curation DSH adapter: `off` for report understanding and extraction, `low`
  for reconciliation and schema-gap analysis.
- Added Adapter and Skill-to-Adapter assertions covering all four active
  operations.
- Preserved provider/model/message construction, temperature 0, the existing
  65,536-token runtime envelope, strict output contracts, and all downstream
  Knowledge semantics.

## 2026-08-31 - KNOWLEDGE-V0.3-LLM-EXECUTION-DIAGNOSTIC-C-006

- Reconstructed the exact C4-R3 `understandReport` request and measured its
  model-visible envelope: 375,989 prompt characters / 696,743 UTF-8 bytes,
  with normalizedText and chunk text both present.
- Measured effective `maxTokens=65536`, temperature `0`, omitted request
  reasoning effort, and resolved provider default `high`.
- Tiny Harness control completed with reasoning/text/usage/finish events. The
  current request emitted sustained reasoning and delayed text without a
  natural finish at 120 seconds; the same request with reasoning off finished
  in 50.525 seconds and passed strict v0.3 validation with
  `majorEntityMentions`.
- Primary classification: `LONG_REASONING_POLICY_CONFIRMED`. No production
  behavior or adapter configuration was changed. C6 is `Completed / Sol
  Verification Pending`; Stage C remains `In Progress / Awaiting C6 Sol
  Verification`.

## 2026-08-31 - KNOWLEDGE-V0.3-PRODUCT-VALIDATION-C-004-R3

- Started from the C5 baseline and verified the exact PDF hash/size,
  `.env`/process credential match, DeepSeek `/models` HTTP 200,
  `deepseek-v4-pro` availability, and READY Docling Local preflight.
- The fresh isolated C4-R3 runner reached the real HTTPS model call, but the
  DeepSeek stream produced no terminal response within the controlled
  15-minute window. No model output, contract classification, or downstream
  product evidence was fabricated.
- No normalization, retry, production modification, API-key exposure, PDF,
  full prompt, full response, or temporary KB was committed.
- C4-R3 is `Completed / Runtime Execution Blocker - Sol verified`; C6 is
  `Completed / Sol Verification Pending`; Stage C remains
  `In Progress / Awaiting C6 Sol Verification`.

## 2026-08-31 - KNOWLEDGE-V0.3-INTEGRATION-FIX-C-005

- Corrected the stale Knowledge Curation DSH boundary: strict model requests
  now require Schema Context and Structured Output Contract, and the adapter
  serializes both with the active operation.
- Added runtime guards for missing contract fields and exact-contract prompt
  instructions; no output normalization, retry, Validator relaxation, or
  Schema change was introduced.
- Replaced stale adapter coverage with the four active v0.3 operations and
  added deterministic Skill-to-Adapter boundary coverage. The focused and
  required regression matrices passed.
- C4-R2 is `Completed / Engineering Rework Required - Sol verified`; C5 is
  `Completed / Accepted - Sol verified`; Stage C remains
  `In Progress / Awaiting C4-R3 Sol Verification`.

## 2026-08-31 - KNOWLEDGE-V0.3-PRODUCT-VALIDATION-C-004-R2

- Ran the real PDF product-validation path after process-level credential
  isolation. Credential fingerprints matched `.env`; DeepSeek `/models`
  returned HTTP 200 and `deepseek-v4-pro` was available.
- Docling Local and Raw-first passed for the exact 103-page PDF. The normal
  Workflow reached real `understandReport`, whose output was deterministically
  rejected because it contained unsupported field `entityMentions`.
- Per acceptance policy the run stopped as `FAIL / SOL REVIEW REQUIRED` before
  extraction, reconciliation, ChangeSet, Writer, reload, replay, reprocess,
  and product-quality review. No production code was changed.
- Added sanitized evidence at
  `tests/knowledge/product-validation/evidence/c004-r2-real-pdf-summary.json`.
- C4-R2 is `Completed / Engineering Rework Required - Sol verified`; C5 is
  `Completed / Accepted - Sol verified`; C4-R3 is blocked by the external
  real-LLM execution timeout; Stage C remains in progress pending C4-R3 Sol
  Verification.

## 2026-08-31 - KNOWLEDGE-V0.3-PRODUCT-VALIDATION-C-004-R1

- Re-ran the real DeepSeek credential preflight from clean baseline
  `5ecc4a771a592c622f2512dbbd7de6172ca985b0`.
- The configured credential remains invalid: official `GET /models` returned
  HTTP 401. The run stopped before PDF parsing and semantic execution, with no
  fallback, provider switch, model substitution, or production change.
- Added sanitized Git-tracked evidence at
  `tests/knowledge/product-validation/evidence/c004-r1-real-pdf-summary.json`.
- C4-R1 is `Completed / Root Cause Identified - Sol verified`; Stage C remains
  in progress pending C4-R2.

## 2026-08-31 - KNOWLEDGE-V0.3-PRODUCT-VALIDATION-C-004

- Added the real-PDF Product Validation runner for the normal v0.3 Report
  Ingestion Workflow, Docling Local, an isolated Schema 0.3 / Storage 1 KB,
  real configured DeepSeek composition, Writer, reload, and full validation.
- Executed against the specified 103-page PDF. Docling completed with 1,523
  chunks, 154 sections, 45 tables, 178 images, and 97,784 normalized
  characters; Raw-first persistence succeeded.
- The real `understandReport` call stopped before semantic output. A runner-only
  credential preflight confirmed HTTP 401 from DeepSeek `/models`; no semantic
  write, mock, fallback, fabricated extraction, or production patch occurred.
- C4 is `Blocked / Sol Review Required`; Stage C remains in progress pending
  credential repair and a rerun.

## 2026-08-31 - KNOWLEDGE-V0.3-IMPLEMENTATION-C-002-R2-R1

- Corrected Curation Claim temporal validation to preserve the frozen
  `asOf`/`scope` shape and validate datetime strings without coercion.
- Enforced duplicate-aware exactly-once reconciliation coverage, including
  deterministic rejection of duplicate, missing, and unknown candidates while
  accepting reversed decision order.
- Unified Workflow-local Source identity derivation and resolution around
  normalized strong metadata with canonical RawRef fallback for sparse reports.
- Corrected ChangeSet model-call accounting to use actual model invocation
  count and formalized the strict v0.3 request subtype requiring Schema Context
  and Structured Output Contract.
- Added focused Curation 19/19 and Ingestion 18/18 acceptance coverage.
- C2-R2 and C2-R2-R1 are `Completed / Accepted - Sol verified`; Stage C
  remains `In Progress`.

## 2026-08-31 - KNOWLEDGE-V0.3-IMPLEMENTATION-C-002-R2

- Atomically replaced the active Knowledge Curation surface with the four
  frozen v0.3 operations and removed the legacy seven-operation runtime path.
- Added structured machine-readable output contracts, automatic C1 Schema
  Context mapping, Schema-derived vocabulary validation, trusted-envelope
  rejection, deterministic candidate identity, and one-call/no-retry behavior.
- Rebuilt Research Report Knowledge Ingestion around the frozen 18 stages,
  native Schema 0.3 / Storage 1, deterministic section batching, Source
  proposal, reference resolution, batched reconciliation, conditional Schema
  Gaps, review dependency closure, C3 validation, and atomic Writer use.
- Added focused Curation 16/16 and Ingestion 16/16 acceptance coverage.
- C2-R2 is `Completed / Sol Verification Pending`; Stage C remains `In
  Progress`.

## 2026-08-31 - KNOWLEDGE-V0.3-IMPLEMENTATION-C-003-R3

- Revalidated the complete final planned canonical object state through the
  shared v0.3 validation core before global invariants and receipt issuance.
- Added dependency-invalidation coverage proving an unchanged
  `business_exposure` Relation rejects an Entity subtype update that violates
  its endpoint semantics.
- Closed the dry-run receipt boundary: normal and virtual Raw dry-runs return
  validation evidence without a `ValidatedKnowledgeChangeSetV03` or semantic
  mutation, while commit mode retains its deeply immutable receipt.
- C3 remains `Completed / Rework Required`; C3-R1 remains `Completed / Rework
  Required`; C3-R2 remains `Completed / Rework Required`; C3-R3 is `Completed /
  Sol Verification Pending`.

## 2026-08-28 - KNOWLEDGE-V0.3-IMPLEMENTATION-C-003-R2

- Added the pure Schema-derived v0.3 canonical validation core and refactored
  Full Validator and ChangeSet Validator to share one object-rule authority.
- Closed validation parity for lifecycle, ThemeGroup, Entity, Source, Relation,
  Claim, Module, Raw context references, provenance, temporal and structured
  values, and Business Exposure financial contribution constraints.
- Enforced the `requiresRawProvenance` ChangeSet policy, including actual and
  virtual Raw contexts, while retaining optional Claim provenance semantics.
- Added differential Full/ChangeSet parity tests and retained all C3-R1
  planned-state, receipt, Writer, idempotency, stale, and recovery coverage.
- C3 remains `Completed / Rework Required`; C3-R1 remains `Completed / Rework
  Required`; C3-R2 is `Completed / Sol Verification Pending`.

## 2026-08-28 - KNOWLEDGE-V0.3-IMPLEMENTATION-C-003-R1

- Closed the v0.3 ChangeSet planned-state gap: Source merges, updates,
  Claim supersession, and source-reference merges now flow into subsequent
  validation and final cardinality checks.
- Added validation-time stale-target protection and deep immutable cloned
  receipts without freezing or mutating caller-owned ChangeSets.
- Added focused Runtime acceptance coverage for atomic Source/Raw/Claim
  provenance, representative writes, updates, supersession, merge_source,
  no-op, idempotency, stale state, invalid ChangeSets, and recovery.
- C3 remains `Completed / Rework Required`; C3-R1 is `Completed / Sol
  Verification Pending`; C2-R2 remains not started.

## 2026-08-28 - KNOWLEDGE-V0.3-IMPLEMENTATION-C-003

- Added the native Schema 0.3 runtime chain: default adapter registration,
  versioned runtime state, `KnowledgeIndexV03`, version-aware Access, and
  strongly typed v0.3 mutation contracts.
- Added deterministic v0.3 ChangeSet validation, Storage Format 1 Raw archive
  compatibility, and one version-dispatched atomic Writer with staged
  validation, revision protection, idempotency, and recovery support.
- Activated Schema 0.3 / Storage 1 as writable for active Knowledge Bases while
  preserving Schema 0.1/0.2 compatibility. Curation and Workflow remain
  unchanged; C3 does not create Schema 0.4.

## 2026-08-27 - KNOWLEDGE-V0.3-IMPLEMENTATION-C-001-R1

- Completed the semantic-context closure by adding non-structural,
  machine-readable meanings for ThemeGroup, Entity, Claim, Source, Source
  Reliability, and every canonical Relation.
- Extended the report-understanding, knowledge-extraction, and reconciliation
  projections while preserving the C1 Builder mechanism and legacy Curation API.
- Removed the duplicate C1 superpowers design document. C1 is recorded as
  `Completed / Rework Required`; C1-R1 is `Completed / Sol Verification Pending`.

## 2026-08-27 - KNOWLEDGE-V0.3-IMPLEMENTATION-C-001

- Added the runtime-neutral Knowledge Curation v0.3 Schema Context Builder with
  four deterministic, operation-specific slices derived from
  `KNOWLEDGE_SCHEMA_V03`.
- Exported the Builder and context types without changing the legacy Curation
  operations or model request contract.
- Stage B is recorded as `Completed / Accepted - Sol verified`; Stage C is
  `In Progress`; C1 is `Completed / Sol Verification Pending`.

## 2026-08-27 - KNOWLEDGE-V0.3-IMPLEMENTATION-B-003-R2

- Closed the temporal migration safety gap by accounting for every legacy
  `period`, Trend `timeHorizon`, and `occurredAt` candidate.
- Added deterministic equivalent-candidate deduplication, conflict Reviews,
  explicit temporal label enrichment, and invalid-value Reviews.
- Added the full temporal regression matrix and three metadata collision tests.
- Re-ran exact-example and isolated real Runtime clone acceptance; B3-R2 is
  `Completed / Sol Verification Pending` and Stage B remains pending Sol final
  verification.

## 2026-08-27 - KNOWLEDGE-V0.3-IMPLEMENTATION-B-003-R1

- Completed deterministic Schema 0.2 to 0.3 migration policy for lifecycle,
  Source type, explicit legacy metadata, Claim temporal fields, affected
  references, and category handling.
- Reduced exact-example compatibility-heavy Review output from 115 to the
  accounted policy result; the acceptance classifier fails on any unexpected
  Review.
- Verified a fresh `ai-hardware-real` clone with zero-Review dry-run, committed
  v0.3/revision 1 validation, canonical v0.3 loading, and unchanged original
  Runtime KB.
- B3-R1 is `Completed / Rework Required` pending its temporal correction.

## 2026-08-27 - KNOWLEDGE-V0.3-IMPLEMENTATION-B-003

- Added the isolated B3 acceptance regression for the exact Git-managed AI
  Hardware Example Knowledge Base.
- Source Schema 0.2 validation passed; dry-run and deterministic repeat both
  produced 115 Category A semantic reviews, so commit was correctly skipped.
- B3 is `Blocked by Semantic Review`; the repository example and production
  implementation remain unchanged.

## 2026-08-27 - KNOWLEDGE-V0.3-IMPLEMENTATION-B-002-R2

- Corrected Claim temporal validation so `scope.label` accepts arbitrary
  strings or null while `asOf`, `scope.start`, and `scope.end` remain datetime
  validated.
- Unified bounded numeric checks around finite numbers and Schema 0.3 numeric
  constraints, including `ownershipPct`.
- Added dedicated 0.2 to 0.3 Review-required, target-validation, and
  before/during/after-switch transaction recovery coverage, including Raw
  preservation, revision, residue, and read-only Handle assertions.
- B2 Parent and B2-R1 remain `Completed / Rework Required`; B-002-R2 is
  `Completed / Sol Verification Pending` pending independent verification.

## 2026-08-27 - KNOWLEDGE-V0.3-IMPLEMENTATION-B-002-R1

- Corrected the frozen Raw identity contract to preserve the existing
  `raw-sha256-<64 lowercase hex>` identity across 0.2 to 0.3 migration;
  Raw remains outside the semantic registry namespace mapping.
- Completed strict deterministic v0.3 validation for subtype fields,
  ThemeGroup/lifecycle, relation references and attributes, nested Claims,
  Source/Raw integrity, Modules, recursive Taxonomy/Views, and orphan files.
- Replaced synthetic migration Raw fixtures with real `archiveRaw()` bundles
  and verified Raw bytes, manifests, identities, and `registry/raw.yaml` are
  preserved.
- Corrected Migration Runner preflight to use the resolved migration
  definition, preserving commit, dry-run, review, validation, transaction,
  recovery, log, and Handle behavior.
- B2 Parent `b401c949a212599e88228366013ec0dee254b30b` is
  `Completed / Rework Required`; B-002-R1 is `Completed / Sol Verification
  Pending`. This is a freeze-consistency correction, not Schema v0.4 or a
  semantic model redesign.

## 2026-08-27 - KNOWLEDGE-V0.3-IMPLEMENTATION-B-002

- Registered Schema 0.3 as readable and explicitly non-writable, with the
  0.2-to-0.3 migration source recorded without changing the v0.2 Writer.
- Added the version-isolated v0.3 canonical reader and Validation Skill
  dispatch for canonical assets, references, auxiliary boundaries, Raw
  provenance, and orphan detection.
- Generalized the existing migration Runner for 0.1-to-0.2 and 0.2-to-0.3,
  including warnings, deterministic signatures, sequential-step blocking,
  target validation, atomic commit, migration logs, and refreshed read-only
  v0.3 Handles.
- B1 Parent and B1-R1 are recorded as accepted — Sol verified. B2 is
  `Completed / Sol Verification Pending`; B3 remains not authorized.

## 2026-08-27 - KNOWLEDGE-V0.3-IMPLEMENTATION-B-001-R1

- Hardened the B1 migration transformer with an explicit final mapping barrier
  before all declared-reference rewrites.
- Added exhaustive semantic disposition checks for legacy Entity,
  Intelligence, Relation, Module, and Relation attribute fields.
- Validated frozen theme/ownership attributes, blocked conflicting dedupe,
  removed exact-dedupe loser files from staging, and added actual target-state
  namespace, resolution, Raw, and orphan-file invariants.
- B1 parent is recorded as `Rework Required`; R1 is
  `Completed / Sol Verification Pending`.

## 2026-08-27 - KNOWLEDGE-V0.3-IMPLEMENTATION-B-001

- Added the deterministic v0.2 to v0.3 staging transformer with complete ID
  mapping, collision detection, semantic Entity/Claim/Source/Module/Relation
  conversion, warning/Review separation, relation normalization/deduplication,
  auxiliary declared-reference rewriting, and target registry rebuilding.
- Preserved Raw identity, source-tree immutability, Storage Format 1 storageRefs,
  opaque strings, Reference Taxonomy, Projection Configuration, and historical
  logs within the B1 boundary.
- Recorded Stage A Parent/R1/R2/R3 as `Accepted - Sol verified` against
  `c0c70b832a70f2f0fdc533c00236c03d47554d99`.
- B1 is `Completed / Sol Verification Pending` with acceptance
  `Review Pending / Sol Verification`; B2/B3 remain not started and Schema 0.3
  runtime remains unregistered.

## 2026-08-27 - KNOWLEDGE-V0.3-IMPLEMENTATION-A-001-R3

- Allowed Business Exposure `financialContribution` to be an object, explicit
  `null`, or absent, matching the frozen deterministic migration target.
- Added executable Schema nullability metadata and preserved the exact frozen
  child-field vocabulary.
- Preserved the 0..1 numeric constraints for `revenueShare` and `profitShare`,
  all R1/R2 corrections, and Schema 0.3 runtime non-activation.
- Did not add migration code or modify Runtime/Example Knowledge Bases. R3
  remains `Completed / Sol Verification Pending` with acceptance
  `Review Pending / Sol Verification`; Stage B is not started.

## 2026-08-27 - KNOWLEDGE-V0.3-IMPLEMENTATION-A-001-R2

- Constrained Module `targetEntity` to the Schema 0.3 `EntityRefV03`
  (`entity:<stable-id>`) while retaining the compatible field name.
- Added declarative Module reference metadata for `targetEntity` and
  `sourceRefs` so later Validation, Migration, and Schema Context work can
  identify canonical references without a generic reference engine.
- Added compile-time rejection coverage for legacy subtype namespaces and
  preserved the R1 required-field, Source compatibility, Module shape, and
  RawRef alias corrections.
- Did not implement migration or activate Schema 0.3 runtime support. R2
  remains `Completed / Sol Verification Pending` with acceptance
  `Review Pending / Sol Verification`; Stage B is not started.

## 2026-08-27 - KNOWLEDGE-V0.3-IMPLEMENTATION-A-001-R1

- Aligned Schema 0.3 executable `requiredFields` and TypeScript Domain
  requiredness with the frozen validity contract.
- Preserved migration-compatible Source fields, including optional legacy
  `type`, `quality`, and `rawRefs` fields, without a top-level index signature.
- Restored the compatible Module shape (`targetEntity`, `sourceRefs`,
  `schemaId`, `columns`, and `rows`) and removed the invented Module redesign.
- Removed the unfrozen RawRef object payload; `RawRefV03` remains a `raw:`
  reference alias only.
- Kept Schema 0.3 out of the runtime release registry. R1 remains
  `Completed / Sol Verification Pending` with acceptance
  `Review Pending / Sol Verification`; Stage B has not started.

## 2026-08-27 - KNOWLEDGE-V0.3-IMPLEMENTATION-A-001

- Added the version-isolated Knowledge v0.3 executable Schema authority and
  strict TypeScript Domain Model under `packages/schemas/knowledge/v03/`.
- Derived v0.3 semantic unions and relation-specific attribute types from the
  single `KNOWLEDGE_SCHEMA_V03` data contract; canonical IDs use object-kind
  namespaces and Taxonomy/View remain auxiliary.
- Preserved the existing v0.2-compatible domain and kept Schema 0.3 out of
  `KNOWLEDGE_SCHEMA_RELEASES`; no Runtime KB or Example KB was migrated.
- Recorded Governance Integration Parent `6e0245b1` and R1 `747812dc` as
  `Accepted — Sol verified`. Stage A remains `Completed / Sol Verification
  Pending`; Stage B has not started.

## 2026-08-27 - KNOWLEDGE-V0.3-GOVERNANCE-INTEGRATION-001-R1

- Marked the earlier Product Validation / Real Data Integration direction in
  the Roadmap as a historical Phase E checkpoint; Stage A is the only current
  next approved engineering direction.
- Clarified the Freeze Index original date (`2026-08-26`) separately from the
  current Knowledge v0.3 normative freeze accepted on `2026-08-27`.
- Updated the root README with the executed Product Validation result:
  Docling succeeded, one authorized real DeepSeek call occurred, and Curation
  Source Assessment blocked on an unsupported `sourceType`; no semantic
  Knowledge was committed.
- Preserved the distinction between this Product Validation blocker and the
  Knowledge v0.3 architecture. R1 remains `Completed / Sol Verification
  Pending` with acceptance `Review Pending / Sol Verification`.

## 2026-08-27 - KNOWLEDGE-V0.3-GOVERNANCE-INTEGRATION-001

- Recorded Sol/CTO acceptance of the Knowledge v0.3 Architecture Freeze for
  commit `47e312f79a221d7dd45b42508e52526fd61b1a74`.
- Promoted Knowledge v0.3 to the current normative Knowledge architecture and
  Schema 0.3 / Storage Format 1 to the current target semantic contract.
- Kept Knowledge v0.2 as the frozen legacy compatibility/migration source and
  preserved the distinction between current architecture and current runtime
  implementation, which remains predominantly v0.2.
- Synchronized the architecture entry points, Freeze Index, Project Overview,
  Decision Log, Task Registry, Current Status, and Roadmap.
- Recorded the next approved direction as Implementation Stage A — Executable
  Schema / Domain Model; Stage A and v0.3 runtime migration have not started.
- Governance Integration remains `Completed / Sol Verification Pending` with
  acceptance `Review Pending / Sol Verification`.

## 2026-08-27 - KNOWLEDGE-V0.3-FREEZE-CORRECTION-001-R1

- Added Schema 0.3 durable identity policy to the v0.3 supersession scope
  without broadening the v0.2 architecture supersession boundary.
- Replaced the ambiguous `Module/View semantics` wording with an explicit
  Projection Configuration Asset / canonical Module boundary and stated that
  Legacy View is not a canonical object kind.
- Kept the v0.3 Freeze Candidate status, v0.2 current normative architecture,
  implementation HOLD, and `Review Pending / Sol Verification` acceptance.
- Did not start Governance Integration or Knowledge v0.3 implementation.

## 2026-08-27 - KNOWLEDGE-V0.3-FREEZE-CORRECTION-001

- Imported and corrected the six Knowledge v0.3 Freeze Candidate documents.
- Closed the Reference Taxonomy / Projection Configuration auxiliary-asset
  boundary, the unique `taxonomyRefs` meaning, and legacy Taxonomy/View
  migration coverage.
- Made Schema 0.3 the sole durable-ID authority with mandatory object-kind
  namespaces while preserving the frozen v0.1 ID Convention for Schema `<=
  0.2`.
- Kept v0.2 as the current frozen normative architecture and v0.3
  implementation on HOLD.
- Status remains `Completed / Sol Verification Pending`; acceptance remains
  `Review Pending / Sol Verification`.

## 2026-08-27 - KNOWLEDGE-PRODUCT-VALIDATION-RUN-001-R1

- Resumed the first real AI Hardware Product Validation with the specified
  West Securities PDF after Document Resolution Parent and R1 acceptance.
- Completed local Docling parsing and exact Raw archival, then made the single
  authorized real DeepSeek V4 Pro call. Curation blocked at Source Assessment
  because the model returned an unsupported `sourceType`; no retry was made.
- No semantic Knowledge objects or Runtime KB revision were committed. The
  unchanged external KB passes full Knowledge Validation, and the real
  frontend projection is available on the separate local port 4174.
- Recorded the run as `Product Validation Blocked` with acceptance
  `Review Pending / Sol Verification`; no second report or implementation
  repair was started.

## 2026-08-27 - KNOWLEDGE-DOCUMENT-RESOLUTION-001-R1

- Added managed Docling setup/doctor commands, explicit local model artifacts,
  pinned runtime selection, offline readiness checks, and idempotent model
  prefetch for `layout` and `tableformer`.
- Validated the specified West Securities report offline with Docling 2.116.0
  and preserved exact raw bytes; no DeepSeek call or Knowledge ingestion was
  performed.
- Kept `KNOWLEDGE-PRODUCT-VALIDATION-RUN-001` paused pending Sol verification
  of Document Resolution.

## 2026-08-26 - KNOWLEDGE-DOCUMENT-RESOLUTION-001

- Hardened the Document Plugin with immutable Raw byte ownership, a
  runtime-neutral parser provider seam, deterministic selection, PDF.js
  fallback, and local Docling structured-output adaptation.
- Added parser regression coverage and validated the specified report offline
  with exact PDF.js raw-byte preservation. The real Docling comparison remains
  blocked by an incomplete local layout-model cache; no DeepSeek or external
  document API was called.
- Kept `KNOWLEDGE-PRODUCT-VALIDATION-RUN-001` paused with blocker category
  `DOCUMENT_RESOLUTION` pending Sol verification. No real Knowledge ingestion
  is claimed.

## 2026-08-26 - KNOWLEDGE-PRODUCT-VALIDATION-RUN-001

- Recorded the first real AI Hardware validation preflight as blocked because
  `RESEARCHHUB_REAL_LLM_ENABLED=false`.
- No DeepSeek request, report copy, ingestion, Runtime KB mutation, or
  frontend startup was performed.

## 2026-08-26 - KNOWLEDGE-PRODUCT-VALIDATION-SETUP-001-R1

- Replaced AgentLoop TestKit setup with direct pinned DSH `LlmRuntime` plus
  the official DeepSeek provider.
- Added a loopback provider composition test and dependency guard; no real
  API call or Phase F was started.

## 2026-08-26 - KNOWLEDGE-PRODUCT-VALIDATION-SETUP-001

- Prepared the external `ai-hardware-real` Runtime Knowledge Base setup,
  ignored local secret configuration, official DeepSeek composition, and
  `pdfjs-dist`-based page-aware report resolver.
- Added deterministic network-free coverage and real ingestion/frontend entry
  points. Status is `Completed / Awaiting Local Inputs`; no real LLM call is
  claimed and no Phase F is started.

## 2026-08-26 - KNOWLEDGE-RUNTIME-MIGRATION-E-001-CLOSURE

- Recorded Sol's independent acceptance of the Phase E parent and R1.
- Closed Knowledge Runtime Migration A–E and froze Knowledge infrastructure
  development at the current architecture.
- Recorded Knowledge Product Validation / Real Data Integration as the next
  direction. No Phase F is approved.

## 2026-08-26 - KNOWLEDGE-RUNTIME-MIGRATION-E-001-R1

- Preserved transformation `MigrationReviewItem` findings when target
  validation fails, with review-required precedence and no root switch.
- Added explicit equal-length migration path ambiguity errors, current
  Manifest decisions after lock/recovery, commit-time transform drift guards,
  and Raw Archive recovery-before-eligibility ordering.
- Added regression coverage for semantic/Raw/module review matrices,
  lifecycle, recovery failpoints, lock serialization, preservation, and
  no-silent-ingestion behavior. R1 remains review pending for Sol.

## 2026-08-26 - KNOWLEDGE-RUNTIME-MIGRATION-E-001

- Implemented the explicit Knowledge Schema Migration Runtime for the
  deterministic Schema 0.1 / Storage 1 to Schema 0.2 / Storage 1 path.
- Added release metadata, migration registry, dry-run/commit Runner, staged
  whole-Knowledge-Base transaction and recovery coordination, source/target
  validation, review blocking, canonical registry conversion, and migration
  logs.
- Added network-free migration fixtures and regression coverage for identity,
  revision, module/Raw provenance, lifecycle, scan-only, validation failure,
  and no-partial-commit behavior. Phase E remains review pending for Sol.

## 2026-08-26 - KNOWLEDGE-INGESTION-D2-WORKFLOW-001-R3

- Added one shared completion-status derivation for dry-run results, successful
  commits, and ingestion audit workflow status.
- Corrected dry-run results with user review or Schema Gaps to
  `completed_with_review` while preserving normal dry-run `completed` status
  and zero-mutation behavior.
- Added end-to-end dry-run regressions for user review and Schema Gap outcomes;
  updated governance records with the actual D2 Parent, R1, and R2 commits.
- R3 remains review pending for Sol verification.

## 2026-08-26 - KNOWLEDGE-INGESTION-D2-WORKFLOW-001-R2

- Finalized ingestion audit projection from the full CandidatePlan while
  keeping eligible operation plans separate for ChangeSet construction.
- Unified dry-run and commit candidate-level validation pruning, preserved
  `operationId` on candidate-specific diagnostics, and counted validation
  rejects by candidate rather than diagnostic.
- Prevented no-change and Raw-only runs from recording a fabricated canonical
  Source ID; added regressions for mixed continuation, review/duplicate/Schema
  Gap audit logs, dry-run pruning, systemic failure, and update attribution.
- R2 remains review pending for Sol verification.

## 2026-08-26 - KNOWLEDGE-INGESTION-D2-WORKFLOW-001-R1

- Closed the D2 ingestion contract gaps for non-mutating dry-run planning,
  virtual Raw provenance, readonly validation, operation-level diagnostics, and
  planned change reporting.
- Separated exact external-document Raw bytes from normalized text/chunks,
  skipped extraction and Source planning for wholly irrelevant reports, and
  preserved immutable Mapping results with bounded candidate validation
  continuation.
- Corrected ingestion audit projection for Raw created/reused state and
  structured validation, review, Schema Gap, and workflow status fields; added
  WorkflowStep ownership metadata while preserving legacy definitions.
- Added focused regression coverage for readonly dry-run, irrelevant reports,
  binary Raw preservation, candidate-level validation rejection, and virtual Raw
  references. R1 remains review pending for Sol verification.

## 2026-08-26 - KNOWLEDGE-INGESTION-D2-WORKFLOW-001

- Implemented the runtime-neutral Research Report Knowledge Ingestion Workflow
  v0.1 across explicit target resolution, Raw Archive/document normalization,
  Curation, Access, deterministic reference/ID planning, conflict handling,
  Validation, Writer, and final audit output.
- Added commit and dry-run execution, deterministic ingestion identity and
  idempotent successful retry handling, partial candidate continuation,
  blocked-after-Raw audit logs, and structured Writer ingestion context.
- Added the DSH-only Knowledge Curation model adapter and network-free workflow
  and adapter tests. D2 remains review pending for Sol verification.

## 2026-08-26 - KNOWLEDGE-INGESTION-D1-CURATION-001

- Added the runtime-neutral Knowledge Curation Skill with a narrow injected
  `KnowledgeCurationModel` port and seven explicit curation operations.
- Added deterministic validation for Source Assessment, relevance decisions,
  atomic typed candidates, admission judgments, Schema Mapping, conflict
  decisions, and Schema Gap proposals.
- Bound trusted workflow scope, Raw provenance, chunk membership and locators,
  intermediate IDs, and supplied Knowledge references outside model output;
  durable Knowledge IDs are never model-controlled.
- Added prompt-boundary hygiene, a deterministic Scripted test model, focused
  network-free tests, and npm test integration. D1 does not implement Workflow,
  persistence, schema mutation, or real LLM runtime wiring.

## 2026-08-26 - KNOWLEDGE-RUNTIME-MIGRATION-C-001-R2

- Added one shared deterministic same-Knowledge-Base mutation lock for Raw
  Archive and semantic Writer operations, with an owner marker and no stale
  lock deletion. Different Knowledge Bases remain independently writable.
- Moved the entire Raw Registry durable mutation into the shared lock and added
  concurrency coverage for same-hash reuse, different-hash preservation, and
  Raw/Writer critical-section serialization.
- Aligned Writer public failures with the frozen Write Interface v0.1 error
  taxonomy, using typed internal errors for validation, lifecycle, schema,
  conflict, staging, recovery, lock, and idempotency outcomes.
- Corrected Phase B governance to `Accepted — Sol verified`; Phase C remains
  review pending and Phase D remains planned.

## 2026-08-26 - KNOWLEDGE-RUNTIME-MIGRATION-C-001-R1

- Aligned Raw Manifest persistence with Storage Layout v0.2 and made Raw Archive
  APIs explicitly Knowledge Base scoped, lifecycle-aware, and revision-neutral.
- Hardened Source ChangeSet validation with strict enums, full planned merge
  validation, expected target hashes, planned supersede references, and
  duplicate mutation/collision checks.
- Made full staged Knowledge validation mandatory before Writer switch and
  cleaned failed staging without exposing completed idempotency logs.
- Removed the temporary `KNOWLEDGE-RUNTIME-MIGRATION-C-001-DESIGN.md` note because
  it duplicated frozen architecture and specified an incorrect Raw location.
- Phase D remains planned and was not started.

## 2026-08-26 - KNOWLEDGE-RUNTIME-MIGRATION-C-001

- Implemented the runtime-neutral Schema 0.2 Knowledge Write foundation:
  immutable SHA-256 Raw Archive bundles, canonical Raw Registry, deterministic
  serialization/hash, ChangeSet validation receipts, and source/Knowledge
  create/update/supersede/source-merge operations.
- Added revision and target-hash guards, per-Knowledge-Base locking, staged
  coherent filesystem commits, recovery markers, ingestion logs, idempotent
  retries, and explicit mounted Handle refresh without mutating old Access
  snapshots.
- Kept Schema 0.1 read-only and readonly/archived Schema 0.2 bases non-writable;
  mutation tests use temporary Knowledge Bases and the default suite remains
  network-free.
- Curation, Research Report ingestion, conflict/Schema Gap reasoning, and
  Migration Runner remain out of scope.

## 2026-08-26 - KNOWLEDGE-RUNTIME-MIGRATION-B-001

- Migrated the AI Hardware dataset to the Git-managed Example Knowledge Base
  at `examples/knowledge-bases/ai-hardware/` with Schema 0.2 / Storage Format 1.
- Converted the registry to canonical `assets.yaml`, removed legacy registry
  files, and added the empty Raw registry without inventing raw assets.
- Bound Access sessions to `KnowledgeBaseHandle`, added multi-KB isolation
  coverage, and made Validation explicit, schema-aware, raw-ref-aware, and
  independent of the Access Skill implementation.
- Scoped Frontend Projection and HTTP by `knowledgeBaseId`, added safe
  handle-relative resource reads, preserved projection parity, and rejected
  legacy implicit endpoints.
- No Write, ingestion, curation, raw archive mutation, or Migration Runner was
  implemented.

## 2026-08-26 - KNOWLEDGE-RUNTIME-MIGRATION-A-001-R2

- Enforced canonical Registry key and loaded asset ID equality.
- Derived canonical Module bindings from `targetEntity` and preserved legacy
  module registry compatibility with deterministic deduplication.
- Made `SourceType` and `SourceReliability` strict frozen enum contracts.
- Added regression coverage for Registry integrity and canonical Module access.
- No production Knowledge dataset, frontend semantics, Write, ingestion, or
  Migration Runner was changed.

## 2026-08-26 - KNOWLEDGE-RUNTIME-MIGRATION-A-001-R1

- Separated canonical Schema 0.2 `registry/assets.yaml` / `storageRef`
  loading from the legacy Schema 0.1 `assets[]` / `path` Loader.
- Corrected default runtime compatibility to read-only until Write capability
  is implemented.
- Aligned the canonical Source contract with Data Schema v0.2 enums, nullable
  fields, metadata, and Raw provenance.
- Added regression coverage for Registry authority, integrity errors, legacy
  compatibility, and Source contracts.
- No production Knowledge dataset, frontend semantics, Write, ingestion, or
  Migration Runner was changed.

## 2026-08-26 - KNOWLEDGE-RUNTIME-MIGRATION-A-001

- Established canonical Knowledge schema contracts for manifests and durable
  domain types.
- Added runtime-neutral Knowledge Base Handle, Data Root, mount registry,
  compatibility resolver, Schema Adapter contract, and version-aware Loader.
- Extracted YAML, asset Loader, Error, and KnowledgeIndex infrastructure from
  the Access Skill while preserving legacy imports and behavior.
- Added focused infrastructure tests to the default network-free test suite.
- No production Knowledge dataset, frontend semantics, Write, ingestion, or
  Migration Runner was changed.

## 2026-08-26 - KNOWLEDGE-ARCHITECTURE-002-DOC-SYNC-001-R1

- Clarified historical/current wording in CURRENT_STATUS.
- Restored Sol/CTO acceptance authority in Task Registry.
- Added Engineering Agent acceptance governance rule.
- No architecture, runtime, data, or code changes.

## 2026-08-26 - KNOWLEDGE-ARCHITECTURE-002-DOC-SYNC-001

- Imported the frozen Knowledge Architecture v0.2, Knowledge Base Instance,
  Storage, Schema Migration, Data Schema, Skill, Ingestion, Write, Frontend,
  Example KB, ADR-015, consistency, summary, naming, and freeze-index docs.
- Separated ResearchHub Source Knowledge infrastructure from independently
  scoped user Knowledge Base Runtime Data in current governance entry points.
- Marked v0.1 ownership/storage wording and ADR-014 as historical or partially
  superseded while preserving historical implementation records.
- Recorded that runtime migration is pending; no runtime code, dataset, or
  migration was changed.

## 2026-08-26 - RH-GOV-CONSISTENCY-002-R1

- Corrected omitted AKShare `periodType` handling to select the latest valid
  financial period across all available annual and quarterly rows.
- Aligned income indicator values to the selected report period and prevented
  cross-period fallback when an exact indicator row is unavailable.
- Added regression coverage for latest-period selection, indicator alignment,
  cache ignoring, and the default network-free validation path.

## 2026-08-26 - RH-GOV-CONSISTENCY-002

- Enforced annual and quarterly period selection in the external AKShare
  Financial Bridge and made unsupported TTM requests return HTTP 422.
- Removed fabricated current-date and period-end fallbacks for missing source
  dates; optional report/publication dates remain absent.
- Added deterministic network-free Bridge tests, pinned tool dependencies, and
  operating documentation.
- Synchronized the README, Task Registry, Development Roadmap, and project
  status with the separate Research Output and Workflow-controlled Knowledge
  boundaries.

## 2026-08-25 - KNOWLEDGE-PHASE-2C-SEGMENT-SCALE-001

- Added optional raw `market-size` Fact inputs to GraphProjection child nodes.
- Excluded Forecast and incomparable period/unit data from segment area scaling;
  missing or incomparable levels remain equal-weighted in the frontend.
- Preserved CompanyScale as the company `total-revenue` Fact projection and
  introduced no market-share or backend calculation semantics.

## 2026-08-25 - KNOWLEDGE-PHASE-2C-FINAL-CLOSEOUT-001

- Switched company-scale visualization from relation `segmentRevenue` to
  company `total-revenue` Financial Facts.
- Kept visual normalization in the frontend and downgraded mixed period/unit
  inputs to equal-size cards without creating a market-share metric.
- Localized remaining human-readable AI Hardware Entity and View names to
  Chinese-first display names while preserving stable IDs and professional
  terms.

## 2026-08-25 - KNOWLEDGE-PHASE-2C-SEMANTICS-AND-LOCALIZATION-001

- Replaced frontend Market Share projection semantics with raw company-scale
  revenue inputs and comparable-period/unit/scope visual sizing.
- Removed market-share percentage presentation from the Knowledge page and
  migrated the View section to `company-scale`.
- Localized production Entity, Intelligence, Module, View, and frontend
  research content to Chinese-first while preserving stable machine contracts
  and source provenance.

## 2026-08-25 - KNOWLEDGE-PHASE-2C-FRONTEND-MIGRATION-001

- Added a deterministic server-side Knowledge Frontend Projection Adapter.
- Added read-only directory, graph, and Entity detail HTTP endpoints to the
  existing Knowledge server.
- Migrated the AI Hardware page from legacy JSON runtime inputs to Production
  Knowledge projections, including dynamic Modules, Intelligence, event Facts,
  and Source links.
- Preserved legacy JSON files as benchmark assets while removing their page
  runtime dependency.

## 2026-08-25 - KNOWLEDGE-PRODUCTION-DATASET-V0.1-REWORK-001

- Corrected NVIDIA and AMD Data Center revenue facts so financial reporting
  segments are not treated as Knowledge GPU or Server revenue.
- Added module-level source provenance validation and primary source references
  to all production comparison Modules.
- Replaced the single-node Electronics taxonomy placeholder with the complete
  31-item SW Level-1 catalog using stable `sw:*` IDs.
- Removed legacy `documents`, `graph`, `ingestion`, and `ontology` placeholders.

## 2026-08-25 - KNOWLEDGE-IMPLEMENTATION-PHASE-001-REWORK-001

- Added `test:knowledge` to the main `npm test` chain.
- Made Registry paths authoritative when a Registry is present, with discovery
  fallback only when no Registry exists.
- Added typed YAML relation, Intelligence, and Lifecycle rule configuration.
- Corrected scoped Validation reference indexing and Intelligence required-field
  checks.
- Added canonical relation vocabulary, complete AI Hardware Registry entries,
  and Entity-to-Module Registry bindings.
- Added Registry, Module Registry, canonical relation, and Workflow-level
  integration coverage.

## 2026-08-25 - KNOWLEDGE-PRODUCTION-DATASET-V0.1

- Added the source-traceable AI Hardware production dataset under `knowledge/`.
- Migrated market, financial, event, forecast, viewpoint, trend, and risk data
  into Intelligence objects instead of embedding dynamic claims in Entities.
- Added production Taxonomy, View, comparison Modules, Module Registry, and a
  complete runtime Registry.
- Added production-loader, access-query, and non-placeholder-source tests.

## 2026-08-25 - KNOWLEDGE-IMPLEMENTATION-PHASE-001

- Added the top-level Knowledge asset directories under `knowledge/`.
- Implemented the deterministic Knowledge Loader with YAML/JSON parsing,
  registry discovery, explicit reload, and in-memory indexes.
- Added the read-only Knowledge Access Skill APIs for entities, relations,
  supply chains, companies, intelligence, modules, comparisons, and sources.
- Added the deterministic Knowledge Validation Skill and structured validation
  reports for schema, IDs, references, relations, lifecycle, modules, and
  source requirements.
- Added AI Hardware valid/invalid fixtures and closed the loader → validation
  → index → access Skill → consumer integration test path.
- Kept the implementation network-free and did not add a database, RAG, LLM
  extraction, Research Artifact, or Multi-Agent layer.

## 2026-08-25 - ARCH-REFACTOR-003

- Migrated current architecture terminology to Research Output, Research
  Object, and Knowledge Infrastructure.
- Added `research-output/` and `knowledge/` boundaries, plus shared schema and
  utility package placeholders.
- Added the runtime-neutral Research Object Envelope with stable provenance
  fields and Skill-owned payloads.
- Repositioned Artifact Trace as Research Output Provenance.
- Deprecated Memory and Evaluation as independent product layers while
  retaining their implementations and tests for compatibility.
- Added the Research Output and Knowledge architecture documents and ADR-014.

## 2026-08-24 - MEMORY-IMPLEMENTATION-001

- Implemented `MemoryItem`, `ResearchMemory`, and
  `InMemoryResearchMemoryStore` under `packages/memory/`.
- Added filtering by entity, topic, industry, type, Artifact ID, confidence,
  minimum confidence, and result limit.
- Added validation that rejects Prompt, Token, Model Reasoning, and Runtime
  payload fields.
- Added Artifact -> Trace -> Memory Reference integration coverage.
- Preserved the existing `MemoryEntry` and `MemoryPlugin` compatibility path.

## 2026-08-24 - PIPELINE-TRACE-INTEGRATION-001

- Enabled Artifact Trace by default for each Equity Research Workflow
  instance using an isolated `InMemoryTraceStore`.
- Routed Workflow Evidence, Thesis, Prediction, and ResearchReport assembly
  through `TraceArtifactBuilder`.
- Added complete report lineage coverage for `contains`, `supports`, and
  `derived_from` relations, including a deterministic `600519` Mock Pipeline
  integration test.
- Preserved existing Artifact Core, Skill, Plugin, DSH, and Workflow behavior.

## 2026-08-24 - ARTIFACT-TRACE-IMPLEMENTATION-001

- Implemented the Artifact Trace Governance MVP under
  `packages/artifacts/trace/`.
- Added immutable Trace Event factories for created, updated, derived, linked,
  and validated lifecycle events, with explicit Artifact References and
  Lineage Relations.
- Added `InMemoryTraceStore` with `append`, `queryByArtifact`, `queryLineage`,
  and `getHistory` support.
- Added the opt-in `TraceArtifactBuilder` integration boundary without
  changing Artifact Core models or existing Workflow, Skill, Plugin, or DSH
  behavior.
- Added tests covering Evidence creation, Thesis/Prediction derivation,
  ResearchReport containment, complete lineage queries, duplicate events, and
  prohibited runtime payloads.

## 2026-08-24 - ARTIFACT-TRACE-DESIGN-001

- Added the Artifact Trace Governance architecture design.
- Defined Trace Event, Artifact Reference, Lineage Relation, Trace Metadata,
  and TraceStore interface contracts.
- Added ADR-013 confirming Trace belongs to Artifact Governance and is not a
  DSH, Harness, Agent Runtime, LLM, or Memory tracing system.
- No production code or Artifact Core model was changed.

## 2026-08-24 - PIPELINE-REAL-DATA-003

- Updated the real Equity Research Pipeline to use CNINFO Official Announcement
  Provider instead of GDELT for the `600519` validation scenario.
- Validated 3 CNINFO Evidence records, real AKShare financial context, five
  DeepSeek Skill calls, all six Workflow steps, linked Thesis/Prediction,
  ResearchReport generation, and Evaluation status `met`.
- Kept the real execution opt-in and the default test suite network-free.

## 2026-08-24 - CNINFO-PROVIDER-FIX-001

- Fixed CNINFO entity resolution by loading the official stock directory and
  querying with the required `code,orgId` format, including `600519` ->
  `600519,gssh0600519`.
- Added CNINFO request headers and optional `seDate` support; normalized epoch
  millisecond announcement timestamps and empty zero-result responses.
- Added PDF text extraction for announcements whose API record has no inline
  content, preserving the existing News Acquisition and Evidence contracts.
- Real validation for `600519` completed with 3 announcement records and 3
  Evidence Artifacts; default tests remain network-free.

## 2026-08-24 - NEWS-PROVIDER-002

- Added `OfficialAnnouncementSearchProvider` as a non-GDELT real-data Provider
  backed by the existing CNINFO official announcement adapter.
- Added `OfficialAnnouncementFetcher` so official announcement content follows
  the existing Search -> Fetch -> Normalize -> Evidence path, including
  PDF-linked CNINFO disclosures whose content is returned by the official API.
- Preserved the GDELT Provider, the existing Announcement Plugin contract, and
  the runtime-neutral Plugin boundary.
- Added deterministic coverage and an opt-in real integration test controlled
  by `RUN_REAL_OFFICIAL_NEWS=1`; default tests remain network-free.
- The first opt-in run reached CNINFO but returned an empty announcement set
  for `600519`; the implementation does not claim a completed real-data run.

## 2026-08-24 - PIPELINE-REAL-DATA-002

- Updated the opt-in real Equity Research Pipeline test to use
  `GdeltSearchProvider -> NativeWebFetcher -> NewsAcquisitionLayer` instead of
  directly instantiating `GdeltNewsPlugin`.
- Added assertions and runtime summaries for Search, Fetch, Normalize,
  Evidence, Provider metadata, five Skill outputs, six Workflow steps, final
  Artifacts, and Evaluation.
- Confirmed the default test remains network-free.
- Attempted real execution, but GDELT/proxy connectivity timed out before
  Search returned; no real Pipeline completion is claimed until that external
  dependency is available.

## 2026-08-24 - NEWS-ACQUISITION-001

- Added the runtime-neutral News Acquisition Layer:
  `SearchProvider -> WebFetcher -> ArticleNormalizer -> EvidenceBuilder`.
- Added GDELT and Mock Search Providers, Native and Mock Web Fetchers, HTML
  normalization, and Evidence Artifact mapping with acquisition metadata.
- Preserved the existing GDELT News Plugin and `search_company_news` contract.
- Added deterministic acquisition integration coverage and an opt-in real
  network test controlled by `RUN_REAL_NEWS_ACQUISITION=1`.

## 2026-08-24 - Real Equity Research Pipeline Validation

- Added the strict opt-in
  `tests/integration/real-equity-research-pipeline.test.ts`.
- Composed real GDELT News, AKShare Financial, DeepSeek Harness Runtime,
  ResearchManager, and the existing six-step Equity Research Workflow.
- Added assertions for real provider context propagation, five LLM Skill
  calls, Workflow completion, ResearchReport and Artifact serialization, and
  Evaluation.
- Added `npm run test:real-equity-pipeline`; default tests remain network-free
  and the real test does not fall back to Fixtures.

## 2026-08-24 - AKShare Financial Provider

- Added the AKShare Financial Provider under
  `packages/plugins/adapters/financial/akshare/`.
- Made `akshare-financial` the default real Financial Provider while retaining
  Tushare as an explicit optional Provider.
- Preserved the existing Financial Plugin interface, normalized schema,
  Evidence mapping, and old AKShare import path through a compatibility shim.
- Added deterministic Provider coverage and an opt-in AKShare integration test
  through Financial Plugin, Evidence, and Equity Research Workflow.
- Added `RUN_REAL_AKSHARE_FINANCIAL=1` and
  `AKSHARE_FINANCIAL_ENDPOINT` support for explicit real-data validation.

## 2026-08-24 - Real Financial Plugin Validation

- Extended the existing Tushare Financial Provider Adapter with the
  documented `fina_indicator` endpoint.
- Normalized revenue, net profit, gross and net profit margins, EPS, current
  and quick ratios, and debt-to-assets into the existing FinancialData schema.
- Preserved the Plugin boundary and converted normalized facts into Evidence
  without adding investment or valuation logic to the Plugin.
- Added an opt-in integration test through Equity Research, Valuation,
  Artifact serialization, and Evaluation.
- Added `RUN_REAL_FINANCIAL_PLUGIN=1 TUSHARE_TOKEN=... npm run
  test:financial-real`; default tests remain network-free.

## 2026-08-24 - Real News Plugin Validation

- Added the GDELT DOC ArticleList News Provider Adapter.
- Preserved the existing News Plugin interface and PluginRegistry boundary.
- Added deterministic normalization/error tests and an opt-in real GDELT
  integration test through Company Research, Evidence, Artifact serialization,
  and Evaluation.
- Added `RUN_REAL_NEWS_PLUGIN=1 npm run test:news-real` for explicit network
  validation; default tests remain network-free.

## 2026-08-24 - Real LLM Runtime Validation

- Added a Harness `LlmRuntime`-backed Skill Adapter under `dsh/llm-runtime/`.
- Added strict structured-response validation and mapping for the five Skills
  used by the Equity Research Workflow.
- Added an opt-in DeepSeek-compatible provider adapter and runtime test that
  completed five real Skill calls through ResearchManager.
- Verified Artifact serialization and Evaluation on the LLM-generated bundle;
  default `npm test` remains network-free.

## 2026-08-24 — End-to-End Research Pipeline Validation

- Added `PIPELINE-VALIDATION-001` integration coverage for the minimum Company
  Equity Research demo.
- Verified the complete DSH → Workflow → Skill → Plugin → Artifact → Evaluation
  path with deterministic Market, News, and Financial Plugin fixtures.
- Verified natural-language request propagation, Workflow dependencies, linked
  Evidence/Thesis/Prediction Artifacts, serialization round trips, and a
  successful Evaluation Review.

## 2026-08-24 — Equity Research Workflow Composition

- Added the formal `equity-research` Workflow definition and execution asset.
- Composed Company Research, Industry Research, Equity Research, Earnings
  Review, and Valuation through injected Skill Adapters.
- Added ordered step states, fail-fast errors, linked Evidence/Thesis/Prediction
  output, runtime-neutral ResearchReport output, Registry discovery coverage,
  and DSH integration coverage.

## 2026-08-24 — Financial Research Skill Asset Migration

- Added runtime-neutral `equity-research`, `industry-research`,
  `earnings-review`, and `valuation` Skill packages.
- Added typed Plugin ports, YAML definitions, input/output schemas, report
  templates, command tests, and a root-DSH invocation smoke test.
- Preserved financial research methodology while excluding Claude bindings,
  slash commands, MCP runtime dependencies, and provider-specific orchestration.

## 2026-08-24 — Runtime and Research Asset Decoupling

- Moved the shared Workflow execution contract to
  `packages/workflows/execution.ts`.
- Removed the `packages/workflows` → `dsh` dependency.
- Confirmed `dsh/` as the default Runtime Orchestrator and `packages/` as
  reusable, runtime-neutral research assets.
- Documented the one-way dependency rule: `dsh/` → `packages/`.

## 2026-08-24 — DSH Control Plane Relocation

- Moved `ResearchManager` from `packages/dsh` to the repository root `dsh/`.
- Reserved `packages/` for composable Workflow, Skill, Plugin, Artifact,
  Memory, and Evaluation modules.
- Updated TypeScript inclusion, test scripts, imports, integration paths, and
  architecture governance references.
- Added ADR-011 for the DSH Control Plane Location Decision.
- Preserved ResearchManager, Workflow, Skill, Plugin, Artifact, Memory, and
  Evaluation behavior.

## 2026-08-24 — Architecture Simplification & Governance Update

- Adopted Architecture v0.3 as the current governance reference.
- Confirmed ResearchHub is a professional research asset layer on DeepSeek
  Harness, not a general-purpose Agent Framework.
- Confirmed Harness ownership of Agent, Tool, Session, loading, and LLM runtime
  services.
- Clarified the boundaries of ResearchManager, Workflow, Skill, Plugin,
  Memory, and Evaluation.
- Deprecated Capability, Provider, Research Planner, Workflow Composition,
  Workflow Engine, and Multi-Agent architecture as independent layers.
- Added ADR-010 and moved the project phase to Research Intelligence Layer.
- Preserved Architecture v0.2, Artifact core models, verified Skills, and
  existing Workflow, Memory, and Evaluation behavior.

## 2026-08-24 — Single DSH Architecture

- Adopted `ResearchManager` as the only DSH planning and coordination center.
- Established the DSH coordination boundary for ResearchManager.
- Moved external-resource contracts and adapters to `packages/plugins`.
- Split former domain data operations into Market, News, Financial,
  Announcement, and Media Plugins.
- Renamed Memory persistence connectors to the Plugin terminology.
- Removed obsolete top-level package paths and updated all imports and test
  scripts.
- Updated architecture, project-management, README, and ADR documentation.
- Verified TypeScript, Plugin, Workflow, Skill, Artifact, Memory, Evaluation,
  and Harness integration tests.
