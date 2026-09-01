# Knowledge v0.3 Relation Selection Guidance Design

## Context

C4-R8-FINAL showed that the accepted Schema 0.3, C11 relation-aware output
contract, C10 diagnostics, and C9 single retry were all functioning, while
Flash repeated an `upstream_of` relation with incompatible
`product -> industry` endpoints. The correction must improve model-facing
salience without changing deterministic semantics or adding another semantic
authority.

## Design

Add one pure prompt helper at
`packages/skills/knowledge-curation/prompts/relation-selection-guidance.ts`.
It reads `KNOWLEDGE_SCHEMA_V03.relation.types` for stable ordering and
`KNOWLEDGE_SCHEMA_V03.relation.definitions` for each relation's source types,
target types, semantic description, and optional endpoint constraint. It emits
one concise compatibility entry per canonical relation and a short set of
endpoint-first rules. Attribute schemas are not serialized; the supplied C11
Output Contract remains authoritative for attributes.

The extraction prompt composes the generic extraction instruction with this
generated guide. Because retry instructions are derived from the same base
prompt constant, attempt 1 and attempt 2 receive byte-identical relation
guidance; retry adds only the existing bounded validation-feedback section.

The guide explicitly instructs the model to determine endpoint Entity types,
filter compatible definitions, compare semantic descriptions, omit a Relation
when neither endpoint compatibility nor meaning matches, and never coerce an
endpoint type or select a relation solely from lexical wording. It does not
rewrite invalid candidates, convert Relations to Claims, or admit candidates
deterministically.

## Testing

Focused tests will derive every expected relation entry from the executable
Schema and assert exact one-to-one parity, stable ordering, semantic
description and endpoint constraint propagation, and a bounded serialized
guide size. The `upstream_of` regression test will derive its allowed endpoint
types from Schema and verify that `product -> industry` and `product ->
product` are not presented as legal. A retry test will compare the generated
guide portion of attempt 1 and attempt 2 while confirming that only the
existing validation-feedback section differs.

Existing C8 projection, C9 retry count, C10 diagnostics, C11 contract, and
Validator tests remain unchanged and are rerun. No real PDF, `/models`, or
DeepSeek request is authorized for C12.

## Scope and non-goals

Allowed changes are the prompt helper, `extract-knowledge.ts`, focused Curation
tests, and project governance documentation. The Schema, relation vocabulary,
Validator, model-input projection, Workflow, DSH adapter, reasoning policy,
provider routing, Writer, Access, Migration, and plugins remain untouched.

The deferred requirement “DSH multi-provider / other-API capability portability
(including reasoning capability compatibility)” remains
`Deferred / Awaiting Detailed User Requirements`; no implementation task is
created for it.
