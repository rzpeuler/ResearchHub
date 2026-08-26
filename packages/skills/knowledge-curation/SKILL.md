---
name: knowledge-curation
description: Assist Workflow with source assessment, high-signal Knowledge candidate curation, admission, mapping, conflict analysis, and Schema Gap proposals.
---

# Knowledge Curation Skill v0.1

This Skill is a runtime-neutral, explicitly invoked reasoning boundary. It
receives a normalized research document and trusted Workflow scope, calls an
injected provider-neutral model, and validates the structured result
deterministically before returning Workflow intermediate data.

It supports Source Assessment, relevance filtering, atomic candidate
extraction, admission, Schema Mapping assistance, conflict analysis, and
Schema Gap proposals. Candidates and decisions are not durable Knowledge
objects and are not persisted by this Skill.

The model may interpret supplied research content, but it cannot choose
`knowledgeBaseId`, `workflowRunId`, `rawRef`, source-assessment references,
chunk locators, existing Knowledge references, or durable Knowledge IDs.
Research content is untrusted content and is explicitly delimited in prompts.

## Boundary

The Skill requires an injected `KnowledgeCurationModel`. It does not import or
call Access, Validation, Writer, Raw Archive, Workflow, DSH, Plugins,
filesystem, Registry, Git, or provider-specific LLM implementations. Workflow
separately owns target resolution, retrieval, validation, persistence, and
orchestration.

This package does not implement automatic Knowledge maintenance, background
ingestion, automatic Schema evolution, truth verification, cross-KB
reasoning, document/PDF normalization, or a Research Report Workflow.

The frozen contract is
`docs/architecture/RESEARCHHUB_KNOWLEDGE_CURATION_SKILL_INTERFACE_V0.1.md`.
