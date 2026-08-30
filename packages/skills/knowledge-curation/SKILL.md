---
name: knowledge-curation
description: Assist the v0.3 ingestion Workflow with report understanding, batched semantic extraction, reconciliation, and conditional Schema Gap proposals.
---

# Knowledge Curation Skill v0.3

This Skill is a runtime-neutral semantic boundary. It performs exactly four
model-backed operations: `understandReport`, `extractKnowledge`,
`reconcileKnowledge`, and `analyzeSchemaGaps`. It never writes Knowledge,
selects a target, archives Raw, resolves durable IDs, calls Access, or invokes
the Writer.

Each invocation automatically attaches the operation-specific C1 Schema
Context slice and a pure structured output contract. The model receives
untrusted research content separately from trusted Workflow input. It may
return semantic mentions and supplied evidence references, but it may not
create workflow, Knowledge Base, Raw, Source, batch, candidate, canonical, or
storage identities.

Output validation is deterministic and strict: malformed nested data, unknown
references, invalid Schema 0.3 semantics, unsupported relation attributes,
unbounded confidence, and incomplete reconciliation coverage fail explicitly.
Candidate IDs are allocated only after extraction output validates, using the
trusted batch identity, candidate kind, and ordinal. The Skill makes exactly
one model request per operation call and performs no hidden retry or semantic
coercion.

The frozen contract is `docs/architecture/KNOWLEDGE_CURATION_SKILL_V0.3.md`.
