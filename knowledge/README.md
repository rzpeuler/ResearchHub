# Knowledge Layer Asset Boundary

This directory contains repository-level durable Knowledge assets. It is not a
runtime package and must not contain DSH, Workflow, Skill, or Plugin
implementation code.

The v0.1 asset layout is:

```text
taxonomy/
entities/
relations/
intelligence/
modules/
sources/
views/
registry/
```

The AI Hardware v0.1 production dataset is stored here and is loaded through
the same Loader / Runtime Index / Access Skill path used by the validation
fixtures. Prototype data under `tests/knowledge/` remains a legacy acceptance
benchmark and is not copied into this directory.

Production assets require source references for dynamic claims. Unsupported or
unverified fields are omitted instead of being filled with mock values.
Graph storage, vector storage, RAG, LLM extraction, and automatic Knowledge
formation are not implemented.
