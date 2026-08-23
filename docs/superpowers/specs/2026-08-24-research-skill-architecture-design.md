# ResearchHub Research Skill Architecture Design

## Context

ResearchHub has validated the Harness Runtime, Plugin and Plugin
boundaries, structured Artifacts, Memory, Evaluation, and the Research
Workflow Framework. The remaining governance gap is a durable contract for
professional research methodology.

## Decision

Define each Research Skill as a versioned package centered on `SKILL.md`.
`SKILL.md` uses YAML Front Matter for discovery metadata and fixed Markdown
sections for methodology, evidence requirements, output contracts, quality,
and Evaluation behavior.

The Skill is a methodology boundary only. Workflow owns orchestration,
Plugin owns domain operations, Plugin owns data-source adaptation,
Artifact owns structured research records, Evaluation owns objective review,
and Harness owns runtime lifecycle.

## Alternatives considered

### Separate `skill.json` plus Markdown guide

This provides stronger machine validation but creates two sources of truth and
adds a new convention beside the Harness's existing `SKILL.md` loading path.

### Pure Markdown with no metadata

This is simple but makes discovery, version compatibility, and Plugin/output
validation ambiguous.

### YAML Front Matter plus structured Markdown sections — selected

This keeps the existing Harness-compatible file, provides lightweight
machine-readable metadata, and preserves rich methodology guidance for DSH
and reviewers without adding a Skill Runtime.

## Contract

Required metadata: Harness-compatible `name` and `description`, plus `id`,
`version`, `status`, `plugins`, and `outputs`. Required body sections:
Purpose, Inputs, Research framework,
Workflow interaction, Required plugins, Evidence requirements, Output
contract, Quality standards, Evaluation, and Scope boundary.

The package convention is:

```text
packages/skills/<skill-name>/
├── SKILL.md
├── index.ts        # optional adapter boundary
├── types.ts        # optional types
├── workflow.ts     # optional implementation adapter
└── *.test.ts
```

Skills name logical Plugin operations and never concrete Plugin names.
They output structured Evidence, Thesis, and Prediction relationships rather
than Markdown-only conclusions. Evaluation remains downstream and never
causes a Skill to modify its own methodology or an investment strategy.

## Versioning

Semantic versioning is required. Major versions may break inputs, evidence
requirements, or Artifact relationships. Minor versions add compatible
methodology or optional outputs. Patch versions clarify wording or examples.
Workflow definitions must record a compatible Skill version or range.

## Validation

The design preserves Architecture v0.2 and requires no Harness change, DSH
addition, Workflow Engine, or concrete business Skill implementation. The
existing Event Analysis Skill is the first target for metadata and contract
alignment; this design task does not modify its concrete implementation.
