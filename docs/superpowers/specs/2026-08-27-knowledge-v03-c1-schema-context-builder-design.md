# Knowledge v0.3 C1 Schema Context Builder Design

## Status

Design approved for implementation after review of the C-001 engineering task.

## Objective

Add a runtime-neutral Schema Context foundation for Knowledge Curation v0.3.
The Builder projects operation-specific, machine-readable slices from the
single canonical executable authority, `KNOWLEDGE_SCHEMA_V03`, for later C2
Curation operations.

C1 does not activate the four v0.3 Curation operations, change the existing
legacy Curation API, or modify Stage B production implementation.

## Scope and boundaries

The implementation is limited to:

- `packages/skills/knowledge-curation/schema-context-types.ts`
- `packages/skills/knowledge-curation/schema-context.ts`
- `packages/skills/knowledge-curation/index.ts`
- `tests/knowledge/curation/schema-context.test.ts`
- the C1 governance records required by the task

`packages/schemas/knowledge/v03/executable-schema.ts` remains unchanged unless
a missing descriptive metadata field is proven necessary. No enum, required
field, relation vocabulary, endpoint, object kind, or version change is
permitted.

The Builder must not mount or read a Knowledge Base, Registry, Taxonomy,
Knowledge Access session, filesystem, plugin, network, Workflow state, DSH
runtime, or model. It is synchronous, deterministic, side-effect free, and
runtime-neutral.

## Architecture

The public Builder is one function:

```ts
buildCurationSchemaContext(
  slice: CurationSchemaContextSlice,
): CurationSchemaContext
```

The function dispatches to explicit, internal allowlist projectors. Each
projector selects only the canonical fields required by its slice, then returns
an independent JSON data tree. The envelope identifies the Schema and slice;
the nested `schema` field contains the operation-specific projection.

```text
slice name
  -> explicit allowlist projector
  -> independent JSON projection
  -> CurationSchemaContext envelope
```

Unknown slice values fail with a stable `invalid_schema_context_slice` error;
they never fall back to the full Schema.

## Public types

The exact structural types live in `schema-context-types.ts`:

```ts
type CurationSchemaContextSlice =
  | 'report_understanding'
  | 'knowledge_extraction'
  | 'reconciliation'
  | 'schema_gap'

interface CurationSchemaContext {
  schemaVersion: '0.3'
  storageFormatVersion: '1'
  slice: CurationSchemaContextSlice
  canonicalObjectKinds: readonly string[]
  schema: unknown
}
```

The public envelope contains no KB identity, Workflow identity, raw or source
instance reference, canonical durable ID, timestamp, random ID, or model value.
The internal projection may use precise derived TypeScript types where useful,
but the canonical data source remains the executable Schema object.

## Slice projections

### `report_understanding`

The minimum complete report-understanding projection contains:

- identity and lifecycle rules;
- Source fields, required fields, source types, and reliabilities;
- ThemeGroup fields and required fields;
- InvestmentTheme fields, required fields, and exactly-one ThemeGroup
  cardinality;
- Entity `investment_theme` structure;
- Reference Taxonomy auxiliary-asset definition and `taxonomyRefs` rules.

It excludes the complete Relation and Claim contracts and excludes all
ThemeGroup, InvestmentTheme, and Taxonomy instances. Reference Taxonomy content
is Workflow-supplied context, not Schema Context.

### `knowledge_extraction`

The extraction projection is the most complete routine slice. It contains:

- Entity types, required/common fields, subtype constraints, InvestmentTheme
  requirements, company rules, and `taxonomyRefs` restrictions;
- all legal Relation types, directionality, required/common fields, retired
  writable types, relation definitions, endpoint constraints, and Business
  Exposure attributes;
- Claim types, fields, required fields, temporal scope types, and comparators;
- Source/Raw provenance structure needed for Claim evidence shape;
- lifecycle values, numeric constraints, and extension policy.

Retired relation vocabulary is visible so later Curation reasoning knows those
values are not writable in v0.3.

### `reconciliation`

The reconciliation projection contains the canonical authority needed for
state and semantic comparison:

- Claim lifecycle and supersession fields;
- Claim types and temporal structure;
- Relation types and endpoint contracts;
- Business Exposure fields and allowed values;
- numeric constraints, lifecycle values, and Source reference requirements.

Reconciliation decision vocabulary is not derived from or invented in Schema
Context. It belongs to the C2 Curation operation contract.

### `schema_gap`

The schema-gap projection is a complete deep copy of
`KNOWLEDGE_SCHEMA_V03`. It remains data-only and contains no validator code,
migration policy, Workflow state, filesystem detail, or KB instances.

## Canonical authority and immutability

Canonical enum and constraint values are read directly from
`KNOWLEDGE_SCHEMA_V03`, including entity, relation, Claim, Source, lifecycle,
comparator, temporal, Business Exposure, endpoint, and numeric definitions.
`schema-context.ts` must not introduce duplicate literal canonical enum lists.

Every result is structurally independent from the authority and from every
other Builder call. Mutating a returned nested value cannot mutate
`KNOWLEDGE_SCHEMA_V03` or a prior result. Object freezing is optional; deep
copying is required.

## Determinism and error handling

For a fixed slice and unchanged executable Schema, two builds are deeply equal.
Projection key and array order is stable, with no timestamps, random IDs,
environment-dependent values, or model output.

The only expected input failure is an unknown slice, which throws a stable
`invalid_schema_context_slice` error. No error is converted into a broad full
Schema result.

## Compatibility and non-goals

The existing seven-operation Curation API and
`KnowledgeCurationModelRequest.expectedOutputContract` remain unchanged. C1
does not add `schemaContext` or `outputContract` to model requests, does not
modify prompts, and does not implement `understandReport`,
`extractKnowledge`, `reconcileKnowledge`, or `analyzeSchemaGaps`.

C1 also does not implement Writer, ChangeSet, Reference Resolver changes,
Report Ingestion Workflow, Frontend, DSH, migration, or Schema 0.3 runtime
activation.

## Test plan

`tests/knowledge/curation/schema-context.test.ts` will verify:

1. all four slices build with the correct Schema and slice identity;
2. canonical enum and constraint values equal the executable Schema source;
3. Relation definitions, endpoint rules, and retired writable vocabulary are
   preserved for extraction;
4. report-understanding is minimal and does not contain the full Relation graph
   contract or instances;
5. reconciliation includes lifecycle, temporal, endpoint, and Business
   Exposure semantics without decision vocabulary;
6. schema-gap exposes the complete canonical model as a deep copy;
7. output mutation does not mutate the authority or prior results;
8. repeated builds are deeply equal and stable;
9. unknown slices fail deterministically; and
10. no KB, Workflow, instance, durable ID, or runtime-context fields appear.

Existing Curation, Schema 0.3, Validator, Knowledge, dependency-boundary,
integration typecheck, and full deterministic test suites remain required
validation after implementation.

## Governance transition

Before implementation, governance records Stage B as `Completed / Accepted -
Sol verified` at baseline `60bf76c045c1d315f3ea90d7733d75d870b7ee54`.

After successful implementation and validation, governance records Stage C as
`In Progress` and C1 as `Completed / Sol Verification Pending`. C2 remains the
future operation-contract and model-integration stage.
