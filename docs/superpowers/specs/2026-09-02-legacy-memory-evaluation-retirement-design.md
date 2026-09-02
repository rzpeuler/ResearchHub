# Legacy Memory and Evaluation Retirement Design

## Objective

Remove the standalone `packages/memory/` and `packages/evaluation/` compatibility
modules without creating replacement architecture layers. Preserve active
research behavior through the existing Artifacts, Review, Outcome, Trace,
Workflow, and Knowledge boundaries.

## Audited Dependencies

- Evaluation runtime behavior is used by integration/runtime tests through
  `evaluatePrediction`, and Review currently imports Outcome from the legacy
  module.
- Memory has no active product runtime consumer; one integration test exercises
  the in-memory compatibility store.
- `package.json` contains dedicated legacy test scripts and includes them in
  the default test command.
- Current architecture and project-overview documents describe both legacy
  directories as present compatibility modules.

## Chosen Design

Move the deterministic Prediction + Outcome comparison behavior into the
existing `packages/artifacts/review/` boundary. Move the Outcome data contract
into `packages/artifacts/outcome/`, export both through the existing Artifacts
barrel, and update callers to consume the Artifacts boundary. Preserve the
Review schema and comparison semantics; only the module ownership changes.

Delete the standalone Memory module and its compatibility-only integration
test. Existing Artifact and Trace contracts remain unchanged; no replacement
Memory store or Research Context layer is introduced.

## Alternatives Rejected

Moving evaluation into Workflow would couple a reusable Review contract to a
business SOP. Keeping the legacy directories under a deprecated marker would
leave the retired architecture physically present and continue misleading
future contributors.

## Validation

Run repository scans to prove there are no current imports, exports, scripts, or
source-tree references to the retired directories; run full TypeScript
typecheck, affected artifact/workflow/skill/ResearchManager/integration tests,
`npm test`, and `git diff --check`. Historical architecture and ADR records are
preserved and only current governance descriptions are updated.
