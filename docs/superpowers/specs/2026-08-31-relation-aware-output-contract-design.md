# Relation-Aware Knowledge Extraction Output Contract

## Status

Approved design for `KNOWLEDGE-V0.3-RELATION-AWARE-OUTPUT-CONTRACT-C-011`.

## Goal

Make the `extractKnowledge` model-facing RelationCandidate contract express the
same relation-specific shapes enforced by the executable v0.3 schema. The
contract must guide the model toward legal relation types, endpoint entity
types, and declared attributes while preserving the public extraction shape
and deterministic Validator authority.

## Scope and constraints

- Production implementation is confined to `packages/skills/knowledge-curation/contracts.ts`.
- `KNOWLEDGE_SCHEMA_V03` remains the sole source of relation types, endpoint types, attribute keys, and enum values.
- `validateExtractKnowledge` remains unchanged and authoritative.
- C8 input projection, C9 retry policy, C10 diagnostics, Workflow stages, DSH reasoning, and provider behavior remain unchanged.
- No candidate repair, deletion, salvage, normalization, or third retry is introduced.

## Design

### Contract construction

Add a pure, deterministic helper in `contracts.ts` that maps each entry in
`KNOWLEDGE_SCHEMA_V03.relation.types` to exactly one RelationCandidate branch.
The `extractKnowledge.schema.properties.relations.items` value becomes an
object schema with `oneOf` containing those generated branches. Each branch
retains the existing required common fields:

`relationType`, `sourceMention`, `targetMention`, `attributes`,
`contextMentions`, `evidenceChunkRefs`, and `reason`.

The relation discriminator uses a one-value `enum` containing the exact
relation type. The source and target mention shapes retain `text`,
`entityType`, and `existingRef`; only `entityType` is specialized per branch.
The specialized entity type permits the Schema-derived allowed values and
`null`, matching the existing nullable mention contract. Trusted reference
handling is unchanged.

### Attribute contracts

For a definition without `attributes`, generate an object with
`additionalProperties: false` and an empty `properties` object. The
`attributes` field remains required, so the legal empty representation is
`attributes: {}`.

For an attribute definition that is an array, derive its `enum` directly from
the array. For `number_0_to_1_or_null`, generate a nullable number schema with
`minimum: 0` and `maximum: 1`. For `financialContribution`, generate a closed
object whose permitted keys come from its Schema `fields`; nested value
constraints are added only where already represented by executable rules and
without creating a second authority.

The `same_entity_type_on_both_sides` endpoint constraint is not expanded into
a combinatorial cross-field schema. Both endpoint allowed-type sets are still
derived and visible in the branch; cross-field equality remains a
deterministic Validator responsibility.

## Data flow and boundaries

`KnowledgeCurationSkill` already passes the same structured contract on the
first extraction request and on a retry. The generated contract is cloned and
propagated through the existing Curation-to-DSH adapter boundary. No prompt,
input projection, retry, or adapter architecture changes are required.

```text
KNOWLEDGE_SCHEMA_V03
        |
        v
contract builder -> extractKnowledge.relations.items.oneOf
        |
        v
KnowledgeCurationSkill -> existing DSH prompt serialization
        |
        v
model output -> unchanged deterministic Validator
```

## Error handling

The contract is model guidance, not runtime admission. If a model still emits
an undeclared attribute or invalid endpoint, the existing Validator must reject
it with the existing error code and diagnostics. C9 may issue at most its
existing single retry, with the same relation-aware contract present on both
attempts.

## Tests

Add focused contract tests that:

1. Assert generated branch count equals `KNOWLEDGE_SCHEMA_V03.relation.types.length` and relation discriminators are unique and exhaustive.
2. Run a generic parity loop comparing each branch’s relation type, source types, target types, and attribute keys to its executable definition.
3. Verify `component_of` exposes `product -> product`, closed empty attributes, and no `costShare`.
4. Verify `business_exposure`, `supplier_of`, and `owns_stake_in` derive their endpoint and attribute contracts, including enums and numeric bounds.
5. Cover every no-attribute relation through the generated behavior.
6. Confirm existing Validator invalid/valid relation cases remain passing.
7. Confirm first-attempt and retry extraction requests carry the same relation-aware contract and the retry count remains one maximum.
8. Confirm C8 projection and C5 Adapter contract propagation are unchanged.

Run the focused suites, the deterministic Curation/Ingestion/Workflow/Adapter/
Knowledge/Infrastructure/Migration/Product Validation matrix, and TypeScript
integration checks. Do not run a real PDF validation during C11.

## Acceptance and remaining risks

The contract is accepted when all relation branches are Schema-derived and
exhaustive, the stated regressions pass, and no forbidden runtime behavior
changes. The contract remains prompt-visible rather than provider-native;
models may still violate it. Same-type equality remains Validator-only, and
the one-retry limit remains in force.
