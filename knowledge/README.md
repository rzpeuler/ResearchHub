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

The first implementation loads validation fixtures from
`tests/knowledge/fixtures/`; it does not populate production Knowledge here.
Graph storage, vector storage, RAG, LLM extraction, and automatic Knowledge
formation are not implemented.
