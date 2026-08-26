# AI Hardware Example Knowledge Base

This directory is a Git-managed, production-like Example Knowledge Base used
by tests, architecture validation, and the prototype frontend. It is not real
user Runtime Data and is not a runtime package: it must not contain DSH,
Workflow, Skill, or Plugin implementation code.

The canonical Schema 0.2 / Storage Format 1 layout is:

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

The registry is the canonical `registry/assets.yaml` ID-to-type-to-storageRef
map. `registry/raw.yaml` is intentionally empty because source originals are
not bundled with this example; no raw archive reference is invented.

The dataset is loaded through `KnowledgeBaseHandle`, the version-aware
`KnowledgeBaseLoader`, the runtime index, and the handle-bound Access and
Validation Skills. Real user Knowledge Bases remain configurable Runtime Data
Root assets outside this repository.

Production assets require source references for dynamic claims. Unsupported or
unverified fields are omitted instead of being filled with mock values.
Graph storage, vector storage, RAG, LLM extraction, automatic Knowledge
formation, and write/ingestion/curation flows are not implemented here.
