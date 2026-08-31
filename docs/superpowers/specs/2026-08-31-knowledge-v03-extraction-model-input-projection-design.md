# Knowledge v0.3 Extraction Model-Visible Input Projection

## Context

C4-R4 confirmed that the C7 reasoning policy is observed by the real DSH
boundary, but the first `extractKnowledge` call failed strict validation when
the model returned an `evidenceChunkRefs` value outside its current batch.
The existing `KnowledgeCurationSkill` currently clones the complete operation
input into every model request. For extraction, that input includes the full
normalized report, all document chunks, and context that can carry unrelated
provenance references. The Validator correctly validates output references
against the authoritative current batch and must remain unchanged.

The design establishes the boundary:

```text
authoritative operation input != necessarily model-visible operation input
```

The Curation Skill owns model-visible projection semantics. Workflow continues
to own complete-domain input assembly, DSH remains a generic runtime adapter,
and deterministic validation continues to receive the original input.

## Goals and non-goals

Goals:

- Limit `extractKnowledge` model visibility to the current extraction batch and
  the minimum semantic context required to produce candidates.
- Preserve every current batch chunk ID and chunk text in the model input.
- Filter report-understanding evidence references to current batch chunk IDs.
- Remove unrelated document chunks, normalized text, and Knowledge provenance
  from the extraction model input.
- Keep the public Skill API, authoritative input, Validator, Workflow, DSH
  adapter, Schema, contracts, and C7 reasoning policy unchanged.
- Prove the visibility invariant and defense-in-depth validation behavior with
  deterministic tests.

Non-goals:

- No projection for `understandReport`, `reconcileKnowledge`, or
  `analyzeSchemaGaps`.
- No prompt rewrite, batch-size change, fuzzy matching, reference repair,
  retry, normalization, or output transformation.
- No performance requirement beyond removing the full report document from
  extraction model visibility.

## Architecture

Add an internal pure helper at
`packages/skills/knowledge-curation/model-input.ts`:

```ts
projectExtractKnowledgeModelInput(input: ExtractKnowledgeInput): unknown
```

The helper returns a new object and never mutates `input`. `skill.ts` will
special-case only the extraction operation:

```text
extractKnowledge(input)
  -> projectExtractKnowledgeModelInput(input)
  -> invoke(extractKnowledge, projected input)
  -> validateExtractKnowledge(raw, original input)
```

The existing generic `invoke` path remains unchanged for the other three
operations. The helper is internal and provider-neutral; it does not become a
new runtime service or public API.

## Projected extraction shape

The model-visible input contains exactly the following top-level semantic
groups:

```ts
{
  batch: {
    batchId,
    sections,
    chunks,
  },
  reportUnderstanding: {
    sourceAssessment,
    researchScope,
    majorTopics,
    majorEntityMentions,
    themeHypotheses,
    newThemeProposal?,
    uncertainty,
  },
  knowledgeContext: {
    schemaVersion,
    existingRefs,
    themeGroups,
    themes,
    entities,
  },
}
```

`batch` is copied as a complete current batch. Its `batchId`, section metadata,
chunk IDs, and chunk text remain visible. No document-level `normalizedText`,
full `chunks` list, or out-of-batch `sections` are included.

`reportUnderstanding` preserves the semantic summary without rewriting its
meaning. For each `majorEntityMentions[].evidenceChunkRefs` and
`themeHypotheses[].evidenceChunkRefs`, the helper keeps only references present
in the current batch chunk-ID set. Empty filtered arrays are valid. All other
summary fields, including mention text, entity types, suggested refs,
dispositions, theme refs, reasons, and uncertainty, remain available.

`knowledgeContext` is the agreed minimum-permission projection. It preserves
schema version, existing references, theme groups, themes, and entities. It
omits relations, claims, sources, claim provenance, raw references, and source
raw references. It performs no fuzzy filtering or retrieval.

## Validation and invariants

The original `ExtractKnowledgeInput` is passed unchanged to
`validateExtractKnowledge`. Therefore the existing batch reference set remains
the final authority. A malicious model response containing an out-of-batch
reference must still produce `invalid_reference`, even though the out-of-batch
chunk is hidden from the model.

The projection tests will serialize the captured model request input and prove:

- every visible document chunk ID belongs to the current batch;
- the controlled fixture exposes exactly the current batch IDs;
- current batch text and metadata remain visible;
- filtered report evidence contains only in-batch refs;
- full document, normalized text, and unrelated chunk text are absent;
- context claims/provenance/rawRefs are absent while required semantic context
  remains present;
- the original input is deeply unchanged after projection.

Valid output using only an in-batch reference must pass and retain deterministic
candidate-ID behavior. Invalid output using a hidden out-of-batch reference
must fail through the unchanged Validator.

## Testing plan

Extend `tests/knowledge/curation/curation.test.ts` with a multi-chunk fixture:
the authoritative document contains `chunk-0001`, `chunk-0002`, and
`chunk-0003`, while the active batch contains only `chunk-0001`. The fixture
uses report-understanding references spanning all three chunks and a context
with entities, relations, claims with provenance, and sources with rawRefs.

Add focused assertions for the projection, report/context filtering,
non-mutation, valid extraction, and Validator defense. Retain and strengthen
existing boundary tests so `understandReport`, `reconcileKnowledge`, and
`analyzeSchemaGaps` continue to receive their existing inputs. Confirm the DSH
adapter still observes `extractKnowledge=off` and preserves Schema Context and
Output Contract propagation.

Run the focused Curation and Adapter tests, then the required Ingestion,
Workflow, Knowledge, Runtime/Dependency, Product Validation, and TypeScript
integration checks. Inspect the final diff to ensure production changes are
limited to `skill.ts` and the internal projection helper, with no Validator,
Workflow, DSH, Schema, or runtime-policy changes.

## Acceptance criteria

1. The full authoritative `ExtractKnowledgeInput` remains unchanged and is
   used by deterministic validation.
2. The extraction model sees only the current batch's document chunks and
   required semantic summaries.
3. No out-of-batch chunk ID is visible anywhere in the projected input.
4. Report-understanding evidence references are deterministically intersected
   with current batch IDs.
5. Knowledge context does not leak claims, provenance, rawRefs, or source
   rawRefs.
6. Original input is not mutated.
7. In-batch output passes; out-of-batch output still fails `invalid_reference`.
8. Other operations, DSH, Workflow, Validator, Schema, contracts, and C7
   reasoning policy remain behaviorally unchanged.
9. Governance records C4-R4 as engineering rework required, C8 as awaiting
   Sol verification, and Stage C as awaiting C8 Sol verification.
