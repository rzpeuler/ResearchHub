# KNOWLEDGE_CURATION_SKILL_V0.3

## Status

**Frozen / Sol Accepted**

- Version: `v0.3`
- Knowledge Schema Dependency: `0.3`
- Parent: `RESEARCHHUB_KNOWLEDGE_ARCHITECTURE_V0.3.md`, `KNOWLEDGE_DATA_SCHEMA_V0.3.md`

## 1. Purpose

Knowledge Curation Skill v0.3 is the professional reasoning boundary that converts unstructured investment-research material into schema-aware semantic Knowledge proposals.

It is responsible for report understanding, Source semantics, Theme hypothesis, high-signal extraction, semantic admission during extraction, schema-aware mapping proposals, reconciliation, and Schema Gap analysis.

It is NOT responsible for PDF parsing, Raw archival, target KB selection, Knowledge retrieval, canonical Reference Resolution, durable ID allocation, final KB validation, Writer commit, Registry mutation, migration, or Workflow execution.

## 2. Core Boundary

```text
Workflow
  ├─ trusted KB scope
  ├─ trusted Raw/Source binding
  ├─ document batches
  ├─ Schema Context
  └─ retrieved KB Context
        ↓
Knowledge Curation Skill
        ↓
LLM semantic reasoning
        ↓
deterministic result validation
        ↓
Workflow intermediates
```

The Skill never writes canonical Knowledge.

## 3. Responsibility Principle

```text
LLM = semantic interpretation
Skill = professional methodology + trusted contract boundary
Workflow = orchestration
Knowledge Access = retrieval
Reference Resolver = canonical identity resolution
Validator / Writer = canonical integrity
```

## 4. High-Level Operations

v0.3 exposes only:
- understandReport
- extractKnowledge
- reconcileKnowledge
- analyzeSchemaGaps

Retired as independent public operations:
- assessSource
- filterRelevantContent
- extractKnowledgeCandidates
- assessKnowledgeAdmission
- mapKnowledgeCandidates
- analyzeKnowledgeConflicts
- detectSchemaGaps

## 5. Mandatory Schema Awareness

Any operation that depends on canonical semantics MUST receive explicit current Schema Context.

The model MUST NOT be expected to know ResearchHub Schema from model memory, prompt naming, or previous conversation state.

## 6. Schema Authority

```text
Canonical Executable Knowledge Schema
        ↓
Schema Context Builder
        ↓
operation-specific schema slice
        ↓
Curation operation
```

Canonical enums MUST NOT be manually duplicated in prompts.

## 7. Schema Context Slices

### report_understanding
Source schema, Source Type definitions, Source Reliability, InvestmentTheme semantics, ThemeGroup semantics, Theme proposal rules.

Reference Taxonomy context is optional and must be explicitly supplied by the
Workflow. Curation does not invent `taxonomyRefs` from model knowledge or
ordinary report text alone.

### knowledge_extraction
Entity types, Relation vocabulary/endpoints, Business Exposure, Claim schema/type semantics, temporal semantics, provenance requirements.

### reconciliation
Claim lifecycle/supersession, Fact consistency, Forecast/Viewpoint divergence, Relation state, Business Exposure update semantics, allowed outcomes.

### schema_gap
Broader current canonical model.

## 8. Schema Context vs KB Context

Schema Context = what Knowledge may structurally look like.

KB Context = what Knowledge currently exists.

They MUST remain separate.

## 9. Model Invocation Contract

Conceptually:

```ts
interface KnowledgeCurationModelRequest {
  operation: CurationOperation
  instruction: string
  input: unknown
  schemaContext: CurationSchemaContext
  outputContract: StructuredOutputContract
}
```

An output-contract NAME alone is insufficient.

DSH/model adapter remains Knowledge-domain-neutral.

## 10. Trusted Envelope

LLM MUST NOT generate:
- workflowRunId
- knowledgeBaseId
- schemaVersion
- rawRef
- trusted sourceRef
- batch identity
- trusted chunk identity
- existing canonical refs not supplied in context
- canonical durable IDs

## 11. Candidate Identity

Workflow-local Candidate IDs are allocated deterministically after model-output validation. They are not canonical IDs.

## 12. Existing Ref Suggestions

The model MAY suggest an existing ref only if that ref was supplied in KB Context. Final Reference Resolution remains deterministic.

## 13. Provenance Binding

The model identifies trusted evidence chunk references. Deterministic infrastructure binds rawRef/sourceRef/page/locator/chunkRef. LLM MUST NOT fabricate provenance IDs.

## 14. understandReport

Performs report-level Source Assessment + research understanding + Theme hypothesis.

Input includes trusted report overview, supplied metadata, Theme catalog, ThemeGroup catalog, and Schema Context.

Output includes:
- sourceAssessment
- researchScope
- majorTopics
- majorEntityMentions
- themeHypotheses
- optional newThemeProposal
- uncertainty/review signals

Existing Theme refs MUST come from supplied catalog. New Theme proposal has no canonical ID.

## 15. extractKnowledge

Performs schema-aware batched extraction.

Input:
- trusted section batch
- Report Understanding
- relevant KB Context
- extraction Schema Context

The authoritative operation input may be larger than the model-visible input.
For `extractKnowledge`, the Curation Skill owns a deterministic least-privilege
projection that exposes only the current section batch and required semantic
context; unrelated document chunks and Knowledge provenance are not model
visible. Deterministic validation still receives the original authoritative
input, so model-visible projection never replaces the final validation scope.

Output:
- EntityCandidates
- RelationCandidates
- ClaimCandidates

No final canonical objects or Writer operations.

## 16. EntityCandidate

Contains semantic fields such as entityType, name, aliases, description, suggestedExistingRef, semanticFields, evidenceChunkRefs, reason.

## 17. RelationCandidate

Contains relationType, sourceMention, targetMention, attributes, contextMentions, evidenceChunkRefs, reason.

LLM does not allocate relation IDs.

## 18. Business Exposure Candidate

Uses canonical:
- exposureBasis
- realizationStage
- materiality
- financialContribution

Unknown evidence remains unknown/null. Do not estimate undisclosed contribution.

## 19. ClaimCandidate

Contains:
- claimType
- statement
- subjectMentions
- temporal
- structuredValue
- evidenceChunkRefs
- semanticConfidence
- reason

No canonical Claim ID.

## 20. Claim Atomicity

Extract semantically atomic Claims. Split composite propositions when components can independently change/conflict/gain evidence/be superseded. Do not over-fragment trivial propositions.

## 21. Relevance / Admission / Mapping

No standalone LLM calls exist for these. They are internal to schema-aware extraction.

If emitted, a Candidate is already a proposed high-signal semantic Candidate, but final canonical acceptance still depends on Resolution, Reconciliation, Validation, and Write.

## 22. Candidate Consolidation

Not an LLM Skill operation. Deterministic infrastructure consolidates obvious duplicates; uncertain semantic equivalence goes to Reconciliation.

## 23. reconcileKnowledge

Receives resolved Candidates + relevant existing canonical Knowledge.

Outputs semantic decisions:
- create
- duplicate
- merge_source
- update_state
- supersede
- keep_both
- reject
- user_review

Optional classifications:
- duplicate
- temporal_update
- correction
- fact_conflict
- forecast_divergence
- viewpoint_divergence
- relation_state_change
- relation_conflict
- complementary

The Skill does not execute Writer mutations.

## 24. Reconciliation Rules

Facts are consistency-seeking. Forecasts/Viewpoints may diverge. Trends may reinforce/complement/supersede/contradict. Risks may expire.

Business Exposure may update exposureBasis/realizationStage/materiality/financialContribution/asOf based on evidence.

## 25. Batched Reconciliation

Contract MUST support multiple groups per model call. Architecture MUST NOT assume one Candidate = one LLM request.

## 26. analyzeSchemaGaps

Exception path only. Receives unrepresentable material Candidates + broader Schema Context.

May classify vocabulary/schema/validation/access/projection gaps and recommend governance action. It never mutates Schema.

## 27. Deterministic Validation

Pre-validate trusted scope/binding/batch/ref conditions before model call.

Post-validate every LLM output for structure, canonical enums, endpoint rules, Business Exposure values, numeric ranges, existing-ref membership, evidence chunk membership, and required semantic fields.

Valid JSON alone is insufficient.

## 28. No Semantic Coercion

Illegal semantic values MUST NOT be silently rewritten into canonical values unless an explicitly frozen deterministic alias rule exists.

## 29. Failure / Retry

Contract violation fails the operation. Skill itself does not implement hidden autonomous retry loops. Workflow may define bounded observable retry policy.

## 30. Prompt Structure

Each call SHOULD separate:
1. Curation Method
2. Schema Context
3. KB Context
4. Research Content

Research Content is untrusted data, not instruction.

## 31. Boundaries

Curation Skill does not call Knowledge Access, Writer, Migration, DSH, Plugins, filesystem, Registry, or provider-specific APIs directly.

## 32. Expected Call Shape

Typical ~100-page report:
- understandReport ≈ 1
- extractKnowledge ≈ order-of-tens batches
- reconcileKnowledge ≈ several batched calls
- analyzeSchemaGaps ≈ usually 0

No candidate-by-candidate admission/reconciliation by default.

## 33. Frozen Decisions

One Curation Skill, four operations, automatic Schema Context, deterministic ref/ID ownership, distinct Entity/Relation/Claim Candidates, batch-capable Reconciliation, conditional Schema Gap, strict post-validation, no hidden retry, no direct canonical mutation, and no invented `taxonomyRefs` without explicit Reference Taxonomy context. v0.4 is NOT approved. This document is Frozen / Sol Accepted; implementation status is governed separately.
