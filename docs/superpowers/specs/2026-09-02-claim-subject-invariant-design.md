# Claim Subject Non-Empty Invariant Design

## Goal

Close the Claim subject cardinality gap exposed by C4-R9-R4 while preserving Schema 0.3, the authoritative final validator, bounded C9 retry behavior, and all existing relation and writer boundaries.

## Design

The invariant is enforced at four workflow-owned boundaries:

1. The `extractKnowledge` structured-output contract declares `subjectMentions` as an array with `minItems: 1`.
2. Candidate-local validation explicitly rejects an empty `subjectMentions` array as `invalid_semantics`. Valid sibling entities, relations, and claims remain accepted. The existing `candidate_set_exhausted` path and one bounded C9 retry remain unchanged when every raw candidate is rejected.
3. Reference Resolution defensively classifies an empty Claim subject list as `invalid`, preventing vacuous `0 === 0` and empty-set success from creating a temporary object key.
4. Post-Resolution Write Readiness requires a non-empty, length-preserving subject-ref projection whose refs resolve to permitted Entity or Relation objects. Failing Claims become Review/non-write-ready and are excluded from ChangeSet planning.

Canonical Claim projection consumes only authoritative Resolution refs. It neither invents nor substitutes a subject. An explicit non-empty assertion prevents an empty canonical Claim from reaching a safe write if an earlier guard regresses. The Schema 0.3 validator remains unchanged and authoritative.

## Verification

Deterministic tests cover the output contract, candidate-local isolation, all-candidates-rejected/C9 behavior, Resolution defense, Write Readiness exclusion, valid single- and multi-subject Claims, and mixed end-to-end regression. The required knowledge curation, ingestion, validation, infrastructure, product-validation, typecheck, `git diff --check`, and `npm test` suites are run without any real LLM or R9-R5 execution.

## Scope and non-goals

Only the curation contract/validator, ingestion workflow guards, focused deterministic tests, and current governance documents may change. Schema 0.3, Storage Format 1, final validator semantics, Writer, C9, C13, C14, C15, C16 relation behavior, provider/model configuration, batching, prompts, historical evidence, and Memory/Evaluation remain untouched.
