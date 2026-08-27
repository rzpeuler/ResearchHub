# Knowledge v0.3 B3-R1 Migration Policy Completion

## Context

B3 Evidence established that the exact Git-managed AI Hardware Schema 0.2
example validates successfully but emits compatibility ReviewItems for missing
lifecycle data, legacy Source types, explicit legacy metadata, temporal fields,
and richer Intelligence semantics. The purpose of B3-R1 is to complete only
the deterministic 0.2-to-0.3 migration policy for compatibility cases while
preserving genuine semantic Review.

This is not Schema 0.4, a Knowledge semantic-model redesign, or a request to
force the exact example to zero ReviewItems.

## Design decisions

### Deterministic compatibility policy

The existing `v02-to-v03.ts` transformer remains the only migration engine.
Policy helpers in that file will apply explicit rules:

- Missing legal lifecycle defaults to `status: active` and emits
  `legacy_lifecycle_default_active`; explicit legal lifecycle is preserved.
- Unsupported legacy Source types map to canonical `unknown`, preserve the
  original compatibility `type`, and emit `legacy_source_type_unknown`.
- Entity `listingStatus`, `tags`, and `sourceRefs` are preserved under
  `metadata.legacyV02`; Source `documentType` is preserved under the same
  explicit namespace. Source references are mapped before storage.
- Legacy `period`, Trend `timeHorizon`, and event `occurredAt`/`datePrecision`
  map to temporal labels without invented dates.
- Intelligence `affectedEntityRefs` are deterministically unioned with
  `entityRefs`; legacy `category` is explicitly dropped with a warning.

No generic unknown-field sweep, LLM, heuristic inference, external lookup,
new Schema field, new canonical object kind, or new Relation type is added.
Metadata namespace collisions produce Review rather than silent overwrite.

### Genuine semantic Review

Review remains for the three segment-to-segment `contains` relations, event
`impact` propositions, Forecast multi-value semantics, Viewpoint proposition
decomposition, Trend `direction`/`drivers`, and Risk `trigger`/`impact`/
`probability` when no lossless frozen target exists. Claim confidence is never
used as risk probability, and multi-proposition text is not concatenated into
an atomic Claim.

### Acceptance classification

The B3 test will no longer treat a hard-coded set of Review codes as an
authoritative Category A classification. It will classify each observed item
from its review role, asset, details, and the frozen policy into:

- `DETERMINISTIC_POLICY_RESOLVED`
- `ROOT_SEMANTIC_REVIEW`
- `DEPENDENT_REFERENCE_BLOCKED`
- `UNEXPECTED_REVIEW`

Any `UNEXPECTED_REVIEW` fails the acceptance test. The exact example may remain
`review_required` when only the expected genuine semantic Review remains.

### Validation flow

Focused policy tests cover lifecycle, Source mapping and metadata, temporal
compatibility, affected references, category handling, and rich Claim Review.
Existing B1/B2/migration/Raw/Knowledge/v0.3 validator suites remain unchanged
and must continue to pass.

The exact example is rerun from fresh isolated copies and must remain
byte-identical. A fresh clone of `ai-hardware-real` is dry-run first; only if it
has zero ReviewItems, true invariants, and passed target validation may the
clone be committed and fully validated. The original Runtime KB is never
mutated.

## Scope and non-goals

Allowed implementation files are the existing v0.2-to-v0.3 transformer,
focused migration/validation tests, B3 acceptance evidence, the migration
policy architecture document, and project governance documents. Schema v0.3,
Runner, Raw identity/archive, Writer, Curation, Workflow, Frontend, DSH,
Example source, and Runtime Data are not modified.

## Completion criteria

1. Deterministic compatibility Review noise is converted to explicit target
   values plus warnings.
2. Only the expected genuine semantic Review assets remain for the exact
   example; no unexpected Review is emitted.
3. Fresh repeated dry-runs are semantically equal.
4. The exact example remains unchanged.
5. The real Runtime KB clone, if clean, commits to v0.3/revision plus one and
   passes full v0.3 validation through the canonical loader.
6. B3 and Stage B are marked `Completed / Sol Verification Pending` only when
   both acceptance paths satisfy the preceding criteria; otherwise Stage B
   remains `In Progress`.
