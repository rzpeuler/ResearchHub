# ResearchHub Review Governance v0.1

## 1. Status

Status: **FROZEN**

Version: **v0.1**

This document defines the Review governance model for ResearchHub Knowledge Production.

It complements:

- `KNOWLEDGE_PRODUCTION_ARCHITECTURE_V0.1.md`;
- the active Knowledge Architecture;
- the active Knowledge Resolution Architecture;
- producer-specific Workflow architecture.

Review is not canonical Knowledge.

Review is durable Knowledge Production operational state used to preserve unresolved but still valuable Knowledge Production decisions after a Workflow finishes.

## 2. Purpose

Knowledge Production can produce three different classes of outcome:

1. safe Knowledge that can proceed toward canonical mutation;
2. invalid or non-actionable observations that can be deterministically rejected or summarized;
3. unresolved Knowledge Production decisions that remain valuable and must survive beyond the current Workflow execution.

The third class requires durable Review.

The purpose of Review Governance v0.1 is to ensure that unresolved Knowledge is not reduced to transient telemetry and is not lost when the Workflow terminates, the application restarts, the reasoning host changes, the user returns later, or the KnowledgeBase has advanced to a newer revision.

The Review system must preserve enough structured context for a future user decision or follow-up Workflow to continue the Knowledge Production process without requiring the original research Workflow to be rerun solely because Review state was lost.

## 3. Review Model

ResearchHub Review has two distinct outputs:

```text
Knowledge Production Workflow
        │
        ├── ReviewSummary
        │     execution / quality telemetry
        │
        └── ReviewCase[]
              durable actionable operational state
```

`ReviewSummary` and `ReviewCase` serve different purposes and must not be treated as equivalent.

## 4. ReviewSummary

`ReviewSummary` describes what happened during one Knowledge Production execution.

It may include total Review observations, root observation count, dependency observation count, counts by category, counts by proposal kind, and bounded representative samples.

Typical categories may include:

- `invalid_reference`
- `invalid_semantics`
- `relation_cardinality`
- `schema_gap`
- `theme_creation`
- `theme_ambiguity`
- `reconciliation_review`
- `other`

ReviewSummary is execution telemetry. It answers questions such as how many issues occurred, where they occurred, what classes of issue were observed, and whether the run was operationally noisy.

ReviewSummary does not need to preserve the complete semantic payload required to resolve every issue later.

## 5. Review Observation Is Not ReviewCase

Not every Review observation becomes a durable ReviewCase.

Examples that normally remain ReviewSummary-only include:

- malformed model output;
- unsupported field emitted by a model;
- invalid Relation attribute;
- invalid canonical reference supplied by reasoning output;
- confidence/value outside the allowed contract;
- Candidate rejected because required evidence is absent;
- another deterministically rejected Candidate where no future Knowledge decision remains.

These events are useful for execution quality and model/producer diagnostics. They are not automatically user work items.

## 6. Durable ReviewCase

A `ReviewCase` represents:

> an unresolved Knowledge Production decision whose semantic content remains valuable and whose future resolution may allow Knowledge Production to continue.

Typical ReviewCases include:

- canonical identity ambiguity;
- semantic conflict against existing Knowledge;
- potential new InvestmentTheme;
- InvestmentTheme ambiguity;
- Schema gap;
- other unresolved semantic decisions that cannot be safely completed automatically.

A ReviewCase is durable. It remains available after the originating Workflow has completed.

## 7. ReviewCase Actionability

ReviewCases are actionable operational state.

v0.1 uses a small conceptual actionability set:

- `knowledge_decision`
- `research_followup`
- `schema_design`

Non-actionable observations remain ReviewSummary telemetry and do not require durable ReviewCases.

Examples:

```text
Company identity ambiguity
→ knowledge_decision

Potential new InvestmentTheme
→ research_followup

Schema cannot represent a material research result
→ schema_design
```

The exact frontend labels and buttons are not frozen by v0.1.

## 8. ReviewCase Is Not Canonical Knowledge

A ReviewCase must not become an Entity, Relation, Claim, ThemeGroup, Source, Module, or other canonical Knowledge object merely because it is durable.

ReviewCase belongs to Knowledge Production operational state.

It must not participate as canonical Knowledge in Knowledge graph relations, Claim subject references, canonical identity, normal Knowledge queries, or Research Theme graph structure.

Only after a Review decision has been resolved through the normal Knowledge Integrity Path may resulting Knowledge become canonical.

## 9. KnowledgeBase Scope

ReviewCase is scoped to a KnowledgeBase.

It must not depend on chat history, a Codex/Luna session, a reasoning-provider session, transient process memory, or a specific application window.

Review state must remain available as long as the related KnowledgeBase and its operational state are available.

## 10. Producer-neutral Review

Review is shared Knowledge Production governance.

It must not be modeled as a Raw Document Ingestion-only feature.

Future ReviewCases may originate from Raw Document Ingestion, Theme Framework Construction, Industry Deep Research, Company Deep Research, Earnings Research, or future Knowledge Production Workflows.

Producer-specific semantic methodology may differ. Review persistence must preserve the unresolved Knowledge Production decision without requiring the Review system itself to become producer-specific.

## 11. ReviewCase Minimum Information

A durable ReviewCase must preserve enough information to answer:

1. What Knowledge was being proposed?
2. Why could the system not complete it automatically?
3. What evidence supports the proposal?
4. What existing Knowledge was relevant to the ambiguity or conflict?
5. What other proposed Knowledge was blocked by this unresolved decision?
6. What type of future action is appropriate?
7. Which Workflow execution created the Case?
8. Against which Schema version and KnowledgeBase revision was it created?

## 12. ReviewCase Conceptual Contract

The following structure is conceptual and normative in meaning, but exact TypeScript names are not frozen.

```text
ReviewCase

identity
├── reviewCaseId
├── knowledgeBaseId
├── producerType
├── producerRunId
└── createdAt

classification
├── category
├── actionability
├── origin
├── stage
└── rationale

rootProposal
├── proposalId
├── proposalKind
├── semanticType
├── semanticPayload
└── evidenceBindings

suspendedProposalBundle
└── dependentProposals[]

resolutionContext
├── existingKnowledgeProjections[]
├── ambiguity/conflict context
├── schemaVersionAtCreation
└── knowledgeBaseRevisionAtCreation

impact
├── dependentProposalCount
└── affectedProposalRefs[]

advisory
├── recommendation?
├── support?
└── suggestedNextAction?

state
└── status
```

Exact serialization format, directory naming, and class names are implementation details.

## 13. Root Proposal

Every actionable ReviewCase must preserve the unresolved root semantic proposal.

The root proposal must contain a controlled semantic projection sufficient for future resolution.

Examples:

### InvestmentTheme

```text
entityType: investment_theme
name: AI算力
aliases: [...]
description: ...
```

### Company

```text
entityType: company
name: ABC科技
aliases: [...]
ticker: ...
exchange: ...
```

### Relation

```text
relationType: supplier_of
source proposal reference: ...
target proposal reference: ...
attributes: ...
```

The ReviewCase must not rely only on a transient `candidateId` or generic rationale string.

## 14. Semantic Payload

Review persistence must preserve structured semantic payload.

It must not preserve only:

```text
candidateId
category
rationale
```

because those fields alone may be insufficient to reconstruct the unresolved Knowledge after the Workflow ends.

The semantic payload must be based on validated/controlled Knowledge Production data.

Raw unrestricted model output must not be persisted as authoritative Review state.

## 15. Suspended Proposal Bundle

An unresolved root proposal may prevent dependent proposals from entering canonical Knowledge.

The ReviewCase must preserve these blocked proposals as a:

> **Suspended Proposal Bundle**

Conceptually:

```text
ReviewCase

Root Proposal
└── Company A

Suspended Proposal Bundle
├── Relation: Company A → Industry B
├── Relation: Company A → Product C
├── Claim: Company A expands capacity
└── Claim: Company A benefits from demand growth
```

The purpose is to preserve useful Knowledge Production output that would otherwise be lost merely because one upstream semantic decision remained unresolved.

## 16. Dependency Handling

Dependency-only issues are not, by default, independent user ReviewCases.

For example:

```text
Root:
Company identity ambiguity

Dependents:
Relation A
Relation B
Claim C
```

The default Review representation should be:

```text
1 root ReviewCase
+
3 suspended dependent proposals
```

rather than four independent Inbox items.

This prevents the Review surface from being flooded with items the user cannot resolve independently.

## 17. Proposal Closure

The Suspended Proposal Bundle should preserve the dependent proposal closure required to continue resolution after the root issue is resolved.

The implementation must preserve enough local proposal references and dependency structure to reconnect Relation endpoints, Claim subjects, dependent Relations, and other supported future proposal kinds.

The Review system does not need to preserve unrelated proposals that were already safe or independently resolved.

## 18. Evidence Binding

Every durable ReviewCase must preserve evidence bindings sufficient to explain and later re-evaluate the proposal.

Current Raw Document Ingestion should be able to represent evidence through bindings equivalent to:

```text
kind: raw_document_block
rawRef
documentId
blockId
```

The ReviewCase should store references to durable evidence rather than duplicating entire source documents.

Future Producers may use additional EvidenceBinding forms.

The generalized multi-producer EvidenceBinding hierarchy is not fully specified by Review Governance v0.1.

## 19. Existing Knowledge Projection

Where the unresolved decision depends on existing canonical Knowledge, the ReviewCase should preserve bounded projections of the relevant existing Knowledge.

Example:

```text
Candidate:
ABC科技

Possible existing entities:

1.
canonicalRef: entity:...
name: ABC科技股份有限公司
ticker: 123456
exchange: SZ

2.
canonicalRef: entity:...
name: ABC科技集团有限公司
```

The projection exists to explain the ReviewCase and support a future decision.

It must not contain an unrestricted dump of the whole KnowledgeBase, the full Registry, or unrelated canonical objects.

## 20. Potential New InvestmentTheme

A potential new InvestmentTheme discovered during Raw Document Ingestion is a canonical example of an actionable ReviewCase.

The Case should preserve, when available:

- Theme candidate name;
- aliases;
- description;
- novelty outcome;
- support metrics;
- evidence bindings;
- recommendation;
- dependent proposals.

Example:

```text
Candidate:
AI算力

Novelty:
potential_new

Support:
supportingUnitCount: 3
supportingPrimaryBlockCount: 18
supportingSectionCount: 4

Suggested next action:
Build Theme
```

The ReviewCase does not authorize Raw Ingestion to create the InvestmentTheme.

## 21. Build Theme Follow-up

For a potential new InvestmentTheme, the normal future action is:

```text
ReviewCase
    ↓
Build Theme
    ↓
Theme Framework Construction Workflow
    ↓
Top-down multi-source research
    ↓
Knowledge Integrity Path
```

The single source that originally discovered the potential Theme is a seed and evidence source. It is not treated as a complete Theme framework.

## 22. Theme Ambiguity

If an InvestmentTheme proposal may be covered by multiple existing canonical Themes, the ReviewCase should preserve the proposed Theme projection, the plausible existing Theme projections, the ambiguity rationale, supporting evidence, and dependent proposals.

A future user decision or research follow-up may then resolve the Theme identity.

## 23. Canonical Identity Ambiguity

Where a proposed Entity cannot be safely bound to one canonical Entity, the ReviewCase should preserve:

- the proposed Entity;
- all bounded plausible existing projections that caused the ambiguity;
- the identity-relevant fields;
- evidence;
- dependent proposals.

A future decision may identify one existing canonical Entity, a distinct new Entity, or another governed resolution outcome.

## 24. Semantic Conflict

Where new proposed Knowledge conflicts with existing canonical Knowledge, the ReviewCase should preserve enough structured state to display the new proposal, the relevant existing canonical projection, the conflict rationale, evidence for the proposed Knowledge, and affected dependent proposals.

The ReviewCase itself does not decide whether the final outcome is coexistence, state replacement, rejection, supersession, or another governed resolution result.

## 25. Schema Gap

A material research result that cannot be represented safely by the Active Knowledge Schema may become a durable Schema Gap ReviewCase.

The Case should preserve the research object or proposal involved, the semantic information that cannot currently be represented, why the available Schema is insufficient, evidence, and affected proposed Knowledge.

Its actionability is:

```text
schema_design
```

A Schema Gap ReviewCase must not cause a Producer to autonomously extend the canonical Schema.

## 26. ReviewCase Identity

ReviewCase identity must be deterministic and replay-safe within the originating Producer execution.

Conceptually, identity should be derived from stable execution and review identity inputs such as:

```text
knowledgeBaseId
producerRunId
normalizedReviewKey
```

The exact hash/ID format is not frozen by this document.

The same replay of the same Producer execution must not create duplicate ReviewCases.

## 27. Cross-run Deduplication

Review Governance v0.1 does not require semantic deduplication of ReviewCases across different Producer runs.

Two different reports may independently discover `AI算力` and create separate ReviewCases if they arise from different Producer executions.

Their evidence, proposal bundles, and dependency structures may differ.

Future UI may group or correlate similar Cases without changing their durable identity.

## 28. ReviewCase Status

v0.1 requires at least the ability to distinguish an unresolved/open Case from a non-open Case in future lifecycle work.

The detailed lifecycle and full ReviewDecision state machine are not frozen here.

The initial durable persistence implementation may limit itself to creating and reading open ReviewCases.

## 29. ReviewDecision

A future ReviewDecision represents an explicit user or governed system decision about a ReviewCase.

Examples may include:

- bind to an existing canonical Entity;
- confirm distinct/new identity;
- reject the proposal;
- trigger Build Theme;
- trigger further research;
- escalate a Schema Gap.

ReviewDecision is not equivalent to direct mutation authorization.

## 30. Current-KB Re-evaluation

A ReviewCase may be created against KnowledgeBase revision N and resolved later when the KnowledgeBase is at revision N+M.

Therefore a future ReviewDecision must not blindly replay an old ChangeSet or old resolution result.

Conceptually:

```text
ReviewDecision
        ↓
load current KnowledgeBase
        ↓
re-bind suspended proposals
        ↓
re-run applicable Diff / Resolution
        ↓
ResolutionIntent
        ↓
ChangeSet
        ↓
Validation
        ↓
Writer
```

Current Knowledge always takes precedence over stale Review-time assumptions.

## 31. ReviewDecision and Writer Boundary

Review does not bypass the frozen Knowledge mutation boundary.

Any Review resolution that produces canonical Knowledge must still pass through:

```text
ChangeSet
→ Validation
→ Writer
```

A ReviewCase or ReviewDecision must never write canonical Knowledge directly.

## 32. Durability Requirement

If a terminal Knowledge Production result reports actionable ReviewCases, those Cases must already be durable before the execution is considered successfully complete with actionable Review.

The system must not return a successful actionable Review result while the corresponding durable Review state has been lost.

The exact filesystem transaction implementation is deferred to engineering design, but the durability outcome is required.

## 33. Workflow Outcome and Review Persistence

The Workflow may produce:

```text
canonical writes
+
ReviewSummary
+
ReviewCases
```

A run can successfully write safe Knowledge while also preserving unresolved ReviewCases.

Review must not require the entire Knowledge Production execution to fail merely because some proposals are unresolved.

Existing safety rules remain:

- unresolved dependencies do not enter canonical Knowledge;
- safe unrelated Knowledge may proceed;
- Writer only receives validated mutations.

## 34. Replay

Exact replay of an already completed Producer execution must not create duplicate durable ReviewCases.

Replay should recover the authoritative persisted Review state associated with that execution.

The current behavior where replay returns an empty transient Review item list is not sufficient for the future durable Review model.

## 35. ReviewSummary vs ReviewCase Count

The following relationship is explicitly allowed:

```text
ReviewSummary.total != ReviewCase count
```

Example:

```text
ReviewSummary.total = 106

of which:
- many deterministic extraction/validation observations
- dependency observations
- 6 actionable root decisions

Durable ReviewCases = 6
```

The Review Inbox must represent actionable decisions, not every execution diagnostic.

## 36. User-facing Review Output

A ReviewCase should be renderable into a user-facing form that answers:

- Type
- Subject
- What happened
- Why Review is required
- Evidence
- Existing Knowledge involved
- Impact / blocked Knowledge
- Suggested next action
- Current status

Example:

```text
Potential New InvestmentTheme

Candidate:
AI算力

Why Review:
No existing canonical InvestmentTheme can be safely identified as covering it.

Evidence:
3 ExtractionUnits
18 primary blocks
4 sections

Impact:
6 dependent proposals suspended

Suggested action:
Build Theme
```

## 37. Suggested Next Action

Suggested next action should be derived from structured Review classification/policy where possible.

Examples:

```text
theme_creation
→ Build Theme

theme_ambiguity
→ Resolve Theme Identity

canonical identity ambiguity
→ Resolve Identity

semantic conflict
→ Resolve Conflict

schema_gap
→ Schema Design
```

The Review system does not require a separate free-form reasoning step merely to generate a user-facing action label.

## 38. Storage Characteristics

Review persistence should remain consistent with ResearchHub's local, deterministic, portable storage model.

Review Governance v0.1 does not require SQL, vector database, graph database, or external event store.

The exact filesystem path and serialization format are implementation details.

Review operational state should remain separable from canonical Knowledge assets.

## 39. Raw Model Output

Raw reasoning-provider responses must not become durable Review authority.

Review persistence should store:

- validated semantic proposal projections;
- deterministic Review classification;
- bounded relevant canonical projections;
- durable evidence bindings;
- dependency structure;
- support/advisory data already produced by the Workflow.

This keeps Review portable across reasoning hosts and avoids coupling Review state to one model response format.

## 40. Current Raw Ingestion Compatibility

Current Raw Document Ingestion already produces many of the inputs needed for durable Review, including:

- Candidate/proposal data;
- Review items;
- Review categories;
- review keys;
- dependency information;
- candidate groups;
- potential InvestmentTheme assessments;
- evidence block references;
- relevant existing Knowledge projections used during Resolution.

Review Governance v0.1 does not require a new semantic research stage.

It formalizes preservation of unresolved Knowledge Production state that is currently transient or reduced to bounded ReviewSummary samples.

## 41. Implementation Sequence

The first implementation should focus on:

1. durable ReviewCase contract;
2. ReviewCase construction from existing Raw Ingestion state;
3. Suspended Proposal Bundle persistence;
4. evidence binding persistence for Raw Document blocks;
5. relevant existing Knowledge projection persistence;
6. deterministic ReviewCase identity;
7. replay-safe persistence;
8. loading/listing open ReviewCases;
9. preservation of current Writer and Knowledge Resolution safety boundaries.

Full ReviewDecision execution, frontend Inbox interaction, Theme Framework integration, and generic multi-producer evidence implementations may follow separately.

## 42. Non-Goals

Review Governance v0.1 does not define or require:

- a frontend Review Inbox implementation;
- a universal Review Action Registry;
- a generic Workflow Engine;
- automatic Schema mutation;
- autonomous conflict resolution;
- new canonical Knowledge kinds;
- Theme Framework implementation;
- Industry Deep Research implementation;
- Company Deep Research implementation;
- complete ReviewDecision execution;
- cross-run semantic ReviewCase deduplication;
- storage of raw model responses;
- a separate durable ReviewEvent system.

## 43. Frozen Review Decisions

### RG-1 — ReviewSummary and ReviewCase Are Different

ReviewSummary is execution telemetry. ReviewCase is durable actionable Knowledge Production state.

### RG-2 — Not Every Review Observation Becomes a Case

Deterministically rejected or non-actionable observations may remain ReviewSummary-only.

### RG-3 — ReviewCase Represents an Unresolved Knowledge Production Decision

The Case must preserve enough semantic context for future continuation.

### RG-4 — ReviewCase Is Not Canonical Knowledge

It belongs to Knowledge Production operational state.

### RG-5 — Review Is KnowledgeBase-scoped and Producer-neutral

Review state survives beyond the originating reasoning or application session.

### RG-6 — Root Semantic Proposal Must Be Durable

A transient candidate ID and rationale alone are insufficient.

### RG-7 — Suspended Proposal Bundle Must Preserve Blocked Knowledge

Dependent proposals must not be discarded solely because a root semantic decision is unresolved.

### RG-8 — Dependency-only Issues Are Not Default Independent Inbox Cases

Dependencies are represented under the actionable root Case unless independently actionable.

### RG-9 — Evidence Bindings Must Be Durable

A future Review user/Workflow must be able to inspect the basis for the proposal.

### RG-10 — Existing Knowledge Context Is Bounded

Only relevant canonical projections are preserved; the full KnowledgeBase is not duplicated.

### RG-11 — ReviewCase Identity Is Deterministic Within a Producer Run

Replay must not create duplicate Cases.

### RG-12 — No Cross-run Semantic Deduplication in v0.1

Different Producer runs retain independent durable Cases.

### RG-13 — Review Resolution Uses the Current KnowledgeBase

Stale Review-time resolution results do not become mutation authority.

### RG-14 — Review Never Bypasses ChangeSet / Validation / Writer

Canonical mutation remains under the shared Knowledge Integrity Authority.

### RG-15 — Potential New Theme Review Supports Research Follow-up

Raw Ingestion does not directly create a Theme merely because a ReviewCase is accepted.

### RG-16 — Schema Gap Is Governance State

A Schema Gap is preserved for governed Schema design rather than autonomous Schema extension.

### RG-17 — Actionable Review Must Be Durable

A terminal actionable Review result must not depend only on transient in-memory state.

### RG-18 — Full ReviewDecision Execution Is Deferred

v0.1 first establishes durable, recoverable ReviewCase state.

## 44. Compatibility with Knowledge Production Architecture v0.1

This Review Governance model conforms to Knowledge Production Architecture v0.1:

```text
Semantic Knowledge Proposal
        ↓
Knowledge Resolution
        ├── safe
        │     ↓
        │  ChangeSet
        │     ↓
        │  Validation
        │     ↓
        │   Writer
        │
        └── unresolved
              ↓
          ReviewCase
              │
              │ future decision/research
              ↓
          current-KB re-resolution
              ↓
          ChangeSet
              ↓
          Validation
              ↓
          Writer
```

Review preserves unresolved Knowledge Production work without introducing a second mutation authority or a separate canonical Knowledge silo.
