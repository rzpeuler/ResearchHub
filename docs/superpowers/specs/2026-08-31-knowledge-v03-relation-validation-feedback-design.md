# Knowledge v0.3 Relation Validation Feedback Design

## Objective

Enrich deterministic `invalid_semantics` feedback for Relation endpoint
semantic violations so the existing bounded C9 regeneration receives an
actionable, schema-derived diagnostic.

## Design

`packages/skills/knowledge-curation/validation.ts` remains the sole runtime
authority for Relation endpoint semantics. The existing endpoint membership
checks and same-entity-type constraint remain unchanged. A private formatter
will render the 1-based `RelationCandidate` ordinal, frozen `relationType`,
received endpoint entity types, and the definition's `sourceTypes` and
`targetTypes`. Null endpoint types render as `unknown`.

The diagnostic contains no mention text, report text, model output, or
filesystem paths. The error code remains `invalid_semantics`. C9 workflow
code, retry eligibility, one-retry limit, and the existing 240-character
feedback cap remain unchanged unless a test proves a required canonical
diagnostic cannot fit.

## Verification

Focused tests will cover invalid and valid `supplier_of`, invalid
`business_exposure`, and the existing `substitutes_for` same-type constraint
when independently testable. Retry integration will verify that attempt 2
receives the detailed message while preserving the C8 projected input and
excluding report/model text. Persistent failure will verify exactly two model
calls, no third attempt, retained diagnostics, and unchanged call accounting.

## Scope

Production changes are limited to the validator unless test/type support is
required. The executable schema, Relation vocabulary, structured output
contracts, C8 projection, C9 policy, workflow semantics, DSH adapter,
providers, and model settings are unchanged. Existing untracked architecture
artifacts are preserved.
