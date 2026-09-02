# Research Output Architecture

**Status:** Current architecture direction (ARCH-REFACTOR-003)

ResearchHub is a financial research knowledge infrastructure running on
DeepSeek Harness. It produces research outputs and reusable research objects;
it does not build an investment-prediction Agent Framework or an autonomous
learning system.

## Flow

```text
Research Request
      |
      v
ResearchManager (DSH control plane)
      |
      v
Workflow -> Skill -> Plugin
      |
      v
Research Output
   |       |        |
reports  objects  provenance
      |
      v
Knowledge Layer
```

ResearchManager, Workflow, Skill, Plugin, and Harness boundaries are unchanged.
The new terminology describes what the research assets produce after a
workflow runs.

## Research Output

`research-output/` is the output boundary:

- `reports/` contains user-readable Markdown, PDF, or equivalent reports;
- `objects/` contains structured, machine-readable Research Objects;
- `provenance/` contains source, derivation, and relationship records.

The existing `packages/artifacts/` implementation is retained as a compatible
technical producer. “Artifact” is no longer the preferred business concept;
the corresponding business concept is Research Object.

## Research Object Envelope

All new machine-readable Research Objects use the runtime-neutral public
envelope in `packages/schemas/research-object.ts`:

```ts
interface ResearchObjectEnvelope<TPayload> {
  objectId: string
  objectType: string
  createdAt: string
  sourceWorkflow: string
  sourceSkill: string
  version: number
  payload: TPayload
}
```

The payload remains owned by the producing Skill. This migration does not
change existing Skill output schemas or force a payload rewrite.

## Provenance

Artifact Trace is repositioned as Research Output Provenance. The existing
protocol under `packages/artifacts/trace/` remains available for compatibility
and records object creation, derivation, linkage, and validation relationships.
It is not a Harness trace, DSH trace, token log, prompt log, or model-reasoning
store.

## Compatibility boundaries

`packages/artifacts/` is the remaining compatibility implementation for
output builders, Review, Outcome, and provenance. Standalone Memory and
Evaluation compatibility modules have been retired; durable knowledge belongs
to the Knowledge boundary, and deterministic Prediction comparison belongs to
Artifact Review. No standalone replacement layer is introduced.

No DSH, Skill, Workflow, or Plugin business logic changes are required by this
architecture migration. No database, graph engine, RAG system, extraction
pipeline, or automatic Knowledge formation is introduced.

## Target structure

```text
ResearchHub/
├── dsh/                         # system control plane
├── packages/
│   ├── workflows/               # reusable research SOPs
│   ├── skills/                  # professional research methods
│   ├── plugins/                 # external data and tools
│   ├── artifacts/               # compatibility output/provenance code
│   ├── schemas/                 # public Research Object contracts
│   └── shared/                  # runtime-neutral shared utilities
├── research-output/
│   ├── reports/
│   ├── objects/
│   └── provenance/
├── knowledge/                    # top-level durable Knowledge boundary
└── docs/
```
