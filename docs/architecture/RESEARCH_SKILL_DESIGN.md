# Research Skill Design

## Purpose

A Research Skill is a reusable professional research method. It describes how
to frame a question, what evidence is required, how to analyze it, and which
Artifacts to create.

## Boundaries

- Skill is not Workflow: it does not own the complete step graph or lifecycle.
- Skill is not Plugin: it does not implement HTTP, SDK, credential, or source
  conversion logic.
- Skill is invoked by the DSH through a selected Workflow.
- Skill receives typed Plugin-backed data and produces validated Artifacts.

## Standard package

```text
packages/skills/<name>/
  skill.yaml
  SKILL.md
  types.ts
  workflow.ts
  harness-tool.ts
  *.test.ts
```

`skill.yaml` declares the method metadata, compatible Workflow, required Plugin
operations, and output types. `SKILL.md` contains the human-readable method
and quality rules. TypeScript code creates the existing Artifact chain.

## Quality rules

Every Skill must identify source traceability, preserve the request Session ID,
validate required evidence, keep uncertainty explicit, and avoid embedding
trading instructions or autonomous decisions.
