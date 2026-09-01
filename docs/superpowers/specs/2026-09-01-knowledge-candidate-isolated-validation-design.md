# Knowledge v0.3 Candidate-Isolated Validation Design

## Context

C4-S2 showed that C12 guidance reaches the real Flash extraction request, but
the strict validator currently treats one invalid RelationCandidate as failure
of the entire extraction batch. That causes valid Entity, Relation, and Claim
candidates in the same response to be discarded and triggers an unnecessary
complete C9 regeneration.

## Design

Keep global and trusted-envelope validation operation-fatal. After global
validation succeeds, validate each raw EntityCandidate, RelationCandidate, and
ClaimCandidate independently. Accepted candidates retain the existing
workflow-local candidate ID derived from their original 1-based array ordinal.
Candidate-local failures become sanitized `CandidateValidationRejection`
records containing candidate kind, original ordinal, validation code, bounded
message, and optional canonical relation type. The validator never stores or
returns mention text, report text, filesystem paths, credentials, or raw model
output in rejection metadata.

`ValidatedExtractKnowledgeResult` preserves the public accepted arrays and adds
Skill-side `validationRejections`; the LLM contract remains exactly
`{ entities, relations, claims }`, so `validationRejections` is never part of
the Structured Output Contract. Candidate-local failures cannot enter
consolidation, reference resolution, reconciliation, Schema Gap processing,
ChangeSet, or Writer.

An empty raw candidate set is valid. A non-empty raw set with zero accepted
candidates becomes `candidate_set_exhausted`, an operation-level failure that
uses the existing single C9 retry. Partial candidate rejection does not retry.
Global failures continue to use the existing at-most-one complete retry. A
second global failure or exhausted candidate set blocks the operation; no third
attempt or semantic repair is introduced.

Workflow execution metadata records accepted and rejected counts by candidate
kind and rejection counts by validation code. Existing model-call accounting
and retry bounds remain intact.

## Testing

Focused deterministic tests cover mixed valid/invalid Entity, Relation, and
Claim candidates, multiple local failures, upstream endpoint isolation,
original ordinals, trusted-field injection as a global failure, top-level
failures, empty extraction, candidate-set exhaustion, downstream isolation,
partial-rejection no-retry accounting, and global retry accounting. Existing
C8, C9, C10, C11, C12, Ingestion, Workflow, Knowledge, Runtime, Migration,
Product Validation, and TypeScript regressions are rerun. No real LLM/PDF/API
call is authorized for C13.

## Scope and non-goals

Allowed production changes are Knowledge Curation validation/result types and
the minimal Workflow metadata/retry classification needed to carry accepted
candidates and rejections. The Schema 0.3, canonical relation semantics,
Validator rules, C12 guidance, C11 model contract, C8 projection, DSH/provider,
reasoning policy, Writer, Access, Migration, frontend, and plugins remain
unchanged. No Schema v0.4, coercion, repair, relation substitution, or
multi-provider portability work is introduced.
