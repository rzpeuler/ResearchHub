# Knowledge Production Dataset v0.1 Rework Design

## Goal

Correct the AI Hardware production dataset's financial semantics and source
provenance without changing the Knowledge architecture, Loader, or runtime
boundaries.

## Data Changes

- Remove unsupported financial attributes from the NVIDIA `operates_in` GPU
  relation.
- Keep NVIDIA Data Center revenue as a company-level Intelligence fact, and
  keep AMD Data Center revenue as a company-level Intelligence fact.
- Add module-level `sourceRefs` to all four production comparison Modules.
- Replace the single-node SW Electronics taxonomy asset with the complete
  31-item `sw:*` Level-1 taxonomy and link `sw:electronics` to
  `industry:ai-hardware`.
- Remove only the four legacy placeholder directories: `documents`, `graph`,
  `ingestion`, and `ontology`.

## Validation Changes

Reuse the existing source-reference validation path for Entity, Relation, and
Module assets. The validator checks schema and registered Source resolution;
it does not infer whether a financial reporting segment equals a Knowledge
segment. Production tests will assert module provenance, financial entity
references, taxonomy count/uniqueness, and legacy-directory absence.

## Verification

Run the Knowledge suite, integration typecheck, full test suite, and
`git diff --check`. Commit only the scoped Knowledge, documentation, and test
changes; leave the pre-existing untracked `tools/` directory untouched.
