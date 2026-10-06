# ResearchHub — Knowledge Architecture v0.2

## Status

**Frozen**

Upon approval, this document supersedes `KNOWLEDGE_ARCHITECTURE_LITE_V0.1.md` as the normative Knowledge architecture baseline for ResearchHub.

The v0.1 document remains preserved as historical architecture.

This version incorporates `KNOWLEDGE_RESOLUTION_ARCHITECTURE_V0.1.md`.

---

## 1. Purpose

ResearchHub converts research material into durable, queryable, provenance-backed canonical Knowledge.

The system is intentionally split between:

- semantic interpretation;
- deterministic Knowledge resolution;
- canonical integrity and persistence.

v0.2 narrows the semantic authority boundary after extraction:

> Reasoning interprets document semantics and resolves bounded semantic uncertainty. Deterministic infrastructure owns canonical binding when provable, Knowledge diff, mutation policy, durable identity, ChangeSet integrity, and persistence.

---

## 2. Authority Model

### 2.1 Research Semantics Authority

Reasoning may determine:

- what the document means;
- relevant Entities;
- expressed Relations;
- durable Claims;
- semantic decomposition of extraction;
- bounded ambiguous Entity equivalence;
- bounded semantic Relation/Claim conflict meaning.

Reasoning does NOT own:

- Knowledge retrieval policy;
- hard identity rules;
- canonical IDs;
- registry references;
- mutation operations;
- ChangeSet structure;
- Writer behavior;
- revisions;
- persistence;
- Workflow routing.

### 2.2 Knowledge Resolution Authority

Deterministic Knowledge Domain infrastructure owns:

- Unicode-safe Candidate identity;
- plausible existing-Knowledge retrieval;
- frozen hard identity proof;
- BoundExisting / PlannedNew states;
- Candidate graph ref resolution;
- Relation exact identity/diff;
- Claim exact identity/diff;
- ResolutionIntent generation from validated semantic outcomes;
- review dependency propagation.

### 2.3 Knowledge Integrity Authority

Deterministic infrastructure owns:

- Canonical Schema;
- durable IDs;
- canonical refs;
- registry;
- Source/Raw provenance;
- ChangeSet admissibility;
- expected-before hashes;
- revision protection;
- staged-state validation;
- Writer;
- idempotency;
- atomic persistence.

### 2.4 Workflow Authority

Workflow owns:

- node order;
- bounded execution;
- retries;
- synchronization;
- terminal status;
- the rule that no canonical mutation occurs before deterministic validation.

---

## 3. Central Principles

### KA-1 — Semantics are not persistence authority

LLM output describes semantic content or bounded semantic relationships.

It never directly authorizes canonical mutation.

### KA-2 — Deterministic proof precedes Reasoning

If a result is provable from frozen deterministic Knowledge invariants, no post-extraction Reasoning call is required.

### KA-3 — Binding precedes Knowledge Diff

Entity referents are resolved before Relation or Claim comparison.

### KA-4 — Existing Knowledge is queried, not dumped into prompts

The KB is a deterministic query source.

Only bounded relevant projections may enter Semantic Resolution Cases.

### KA-5 — Durable identity is infrastructure-owned

LLM/Agent outputs remain local or case-local.

Durable canonical IDs are allocated only by deterministic infrastructure.

### KA-6 — Uncertainty is explicit

Unresolved semantic questions become Review; they are never silently converted to create/update/merge.

### KA-7 — One ingestion, at most one semantic ChangeSet and one Writer commit

No extraction Unit or Resolution Case commits independently.

---

## 4. Canonical Knowledge Baseline

v0.2 retains:

- Schema Version: `0.3`
- Storage Format Version: `1`

Canonical object families:

- ThemeGroup
- Entity
- Relation
- Claim
- Source
- Module
- RawRef

Entity types:

- investment_theme
- industry
- company
- product
- technology

Claim types:

- fact
- forecast
- viewpoint
- trend
- risk

The frozen v0.3 Relation vocabulary remains unchanged.

Knowledge Resolution v0.1 does not authorize ontology expansion.

---

## 5. Candidate Layer

The Candidate layer is document-grounded semantic output, not canonical Knowledge.

Core Candidate kinds:

```text
EntityCandidate
RelationCandidate
ClaimCandidate
```

Rules:

- local candidate IDs only;
- Unicode-safe deterministic consolidation identity;
- Relation endpoints reference Entity candidates;
- Claim subjects reference Entity candidates;
- evidence refs point to document Blocks;
- Candidate validation occurs before canonical resolution;
- rejected Candidates cannot leak downstream.

### 5.1 ExistingRef Rule

Extraction-time Reasoning MUST NOT own authoritative `existingRef`.

Any historical Candidate contract direction allowing Reasoning to directly select durable existing canonical IDs is superseded.

Existing canonical binding occurs only in Knowledge Resolution.

Reasoning-time semantic resolution uses case-local aliases, not durable IDs.

---

## 6. Candidate Consolidation

Consolidation operates on the newly extracted Candidate graph before KB canonical binding.

Responsibilities:

- exact/normalizable Entity merge;
- deterministic local identity;
- Relation merge over local Entity identities;
- Claim subject normalization;
- exact Claim merge;
- provenance/evidence aggregation;
- review-worthy local conflicts.

Consolidation does NOT:

- decide canonical existing Entity identity;
- perform fuzzy canonical merging;
- allocate durable IDs;
- write the KB.

This preserves the separation:

```text
New-document Candidate consolidation
≠
Canonical Knowledge resolution
```

---

## 7. Knowledge Resolution

Knowledge Resolution is the canonical boundary between the Candidate graph and the Knowledge Base.

Normative architecture:

`KNOWLEDGE_RESOLUTION_ARCHITECTURE_V0.1.md`

It consists of:

```text
Entity Canonical Binding
        ↓
Entity State Diff
        ↓
Candidate Graph Reference Resolution
        ↓
Relation Knowledge Diff
        ↓
Claim Knowledge Diff
        ↓
Bounded Semantic Resolution Cases
        ↓
Deterministic Resolution Policy
        ↓
ResolutionIntent Set
```

The previous full-candidate-set Reconciliation model is retired.

---

## 8. Canonical Binding

### 8.1 Binding States

Entity Candidates resolve to:

```text
BoundExisting
PlannedNew
Unresolved
```

### 8.2 Hard Identity

Frozen deterministic identity keys may establish `BoundExisting`. Hard identity is intentionally conservative.

Built-in v0.2 / Knowledge Resolution v0.1 policy:

- Company exact normalized `(exchange,ticker)` is the only built-in hard key when both values are present;
- `externalIds` count as hard identity only for namespaces explicitly registered as globally unique;
- InvestmentTheme, Industry, Product, and Technology have no built-in hard key in v0.1;
- exact name, alias, and legalName are plausible-match retrieval signals, not automatic identity proof.

A hard key resolving to multiple canonical Entities is an integrity defect and must never be resolved by picking one.

### 8.3 PlannedNew

When deterministic retrieval finds no plausible existing referent under the frozen policy, the Candidate becomes `PlannedNew`.

Planned references are Workflow-local.

Durable IDs are allocated later.

### 8.4 Semantic Binding

When plausible existing referents exist but proof is insufficient, a bounded `EntityBindingCase` may invoke Reasoning.

Reasoning returns semantic equivalence using case-local aliases only.

### 8.5 Entity State Diff

Binding and state mutation are separate. For a `BoundExisting` Entity, deterministic state diff may:

- produce no-op when the Candidate adds nothing;
- enrich only missing/non-conflicting fields;
- route conflicting already-populated fields to Review.

No Entity state-conflict LLM case is part of the initial v0.2 baseline.

---

## 9. Existing Knowledge Retrieval

Existing Knowledge retrieval remains deterministic Knowledge Domain capability.

Its roles are now explicit:

1. support Entity plausible-match retrieval;
2. support Relation exact/conflict lookup;
3. support Claim exact/conflict lookup;
4. prepare bounded existing-object projections for Semantic Resolution Cases.

Retrieval is not itself semantic equivalence authority.

The entire KB must never be serialized into a Reasoning request.

---

## 10. Knowledge Diff

Knowledge Diff determines structural relationship between a resolved Candidate and current canonical Knowledge.

Initial deterministic categories include:

```text
ABSENT
EXACT
POTENTIAL_CONFLICT
UNRESOLVED_DEPENDENCY
```

These are infrastructure states, not LLM decisions.

### 10.1 ABSENT

No relevant existing canonical object:

- normally produces a Create intent direction.

### 10.2 EXACT

Semantically identical under frozen exact identity/equality rules:

- merge new Source/provenance;
- or no-op when already represented.

### 10.3 POTENTIAL_CONFLICT

Relevant existing Knowledge exists but deterministic rules cannot establish safe equivalence/state transition:

- produce a bounded Semantic Resolution Case.

### 10.4 UNRESOLVED_DEPENDENCY

Required Entity Binding is unresolved:

- isolate dependent Candidate to Review.

### 10.5 Claim Plausible-Conflict Retrieval

After exact Claim identity fails, plausible-conflict retrieval is deterministic, bounded, and structural. It requires compatible resolved subjects, normally the same Claim type, and compatible temporal scope. Ranking prefers exact normalized statement and same structured metric/unit signals.

If an unstructured same-subject neighborhood is too broad to include safely within the configured bound, the system routes the Candidate to retrieval-overflow Review rather than silently truncating potentially material conflicts.

`Source.publishedAt` is not Claim temporal identity.

---

## 11. Semantic Resolution Cases

Reasoning after extraction is case-based.

Case kinds:

- EntityBindingCase
- RelationConflictCase
- ClaimConflictCase

A Case includes only:

- new Candidate projection;
- bounded plausible existing projections;
- directly relevant evidence;
- minimal source context;
- relevant Schema slice;
- case-local aliases;
- allowed semantic outcomes.

A Case excludes by default:

- full ReportMap;
- full Candidate set;
- full KB;
- registry;
- revision;
- Writer;
- ChangeSet;
- durable IDs as Reasoning-owned refs.

Independent Cases may execute in bounded parallel.

---

## 12. Semantic Outcomes vs ResolutionIntents

This distinction is normative.

Entity binding Reasoning returns only:

```text
equivalent_to
distinct_from_all
uncertain
```

Relation conflict Reasoning returns only:

```text
equivalent
state_changed
coexists
contradicts
invalid
uncertain
```

Claim conflict Reasoning returns only:

```text
equivalent
supersedes
coexists
contradicts
invalid
uncertain
```

Outcome rationale may explain updated estimates, methodology differences, temporal changes, and similar semantics without expanding mutation authority.

Deterministic policy maps validated semantic outcomes into `ResolutionIntent`s.

---

## 13. ResolutionIntent Layer

`ResolutionIntent` is the only Knowledge Resolution product consumed by ChangeSet planning.

Frozen dispositions:

```text
create
enrich_existing
merge_evidence
replace_state
supersede
no_op
reject
review
```

Requirements:

- exactly one explicit disposition per retained Candidate or dependency-review outcome;
- deterministic mapping;
- explicit infrastructure-owned target when existing canonical Knowledge is affected;
- retained evidence/provenance;
- auditable semantic basis;
- no unresolved case may reach ChangeSet planning.

Kind-specific ChangeSet mapping is normative:

- `create` → Schema 0.3 `create`;
- `enrich_existing` → conservative `update`;
- Relation `merge_evidence` → `merge_source`;
- Claim `merge_evidence` → deterministic `update` that unions both `sourceRefs` and block-level provenance anchors;
- Entity does not emit `merge_evidence` because Schema 0.3 Entity has no `sourceRefs`/provenance field;
- `replace_state` → `update` for Entity/Relation when allowed;
- `supersede` → Claim-only `supersede`;
- `no_op`, `reject`, and `review` create no Knowledge operation.

`keep_both` is not an infrastructure intent. A semantically distinct supported Claim that may coexist simply produces `create`; the existing Claim remains unchanged.

A review-only/reject-only ingestion must not create an otherwise-unreferenced canonical Source merely because Raw was archived.

`ResolutionIntent` is execution data, not canonical Knowledge.

---

## 14. Canonical IDs

Canonical IDs remain infrastructure-owned.

Sequence:

```text
EntityCandidate
      ↓
Binding
      ↓
BoundExisting(canonical ref)
OR
PlannedNew(planned ref)
      ↓
ResolutionIntent
      ↓
ChangeSet Planner
      ↓
durable ID allocation for PlannedNew
```

No LLM/Agent may create or choose durable canonical IDs.

Unicode-safe deterministic ID allocation remains required.

---

## 15. Provenance

Durable provenance remains:

```text
Knowledge
   ↓
Source
   ↓
Raw
```

Requirements:

- Raw is immutable;
- Source points to Raw;
- new/updated Knowledge retains Source refs;
- Claim provenance remains source/raw anchored;
- Resolution Case rationale is not evidence;
- merge_provenance preserves distinct supporting Sources without duplicating canonical semantics unnecessarily.

---

## 16. ChangeSet

Each ingestion execution produces at most one semantic ChangeSet.

The ChangeSet represents the complete safe intended semantic mutation for the run.

It is generated only after the Knowledge Resolution barrier.

ChangeSet contains:

- target KB identity;
- expected base revision;
- Source operations;
- Knowledge operations;
- canonical refs;
- expected-before hashes where applicable;
- ingestion context;
- deterministic ChangeSet identity.

No Semantic Resolution Case writes directly.

---

## 17. Validation

### 17.1 Candidate Validation

Validates document-grounded semantic Candidates.

### 17.2 Resolution Validation

Validates:

- Binding completeness;
- planned/existing ref integrity;
- exactly one ResolutionIntent/disposition;
- semantic case outcome admissibility;
- dependency Review propagation;
- no durable-ID authority leakage.

### 17.3 ChangeSet Validation

Validates:

- Schema 0.3;
- operation legality;
- refs;
- revision;
- expected-before hashes;
- provenance;
- relation endpoint integrity;
- Claim semantics.

### 17.4 Staged-State Validation

The Writer's staged complete next KB must pass full validation before commit.

---

## 18. Review Model

Review is part of safe Knowledge Resolution, not a failure to produce an LLM answer.

Review categories continue to include infrastructure and semantic categories such as:

- invalid_reference;
- invalid_semantics;
- relation_cardinality;
- schema_gap;
- theme_creation;
- theme_ambiguity;
- semantic_resolution_review;
- other.

Historical `reconciliation_review` may remain readable for compatibility but v0.2 should prefer a Knowledge-Resolution semantic category in new telemetry.

Review tracks:

- root vs dependency;
- Candidate kind;
- stage;
- semantic case when applicable;
- evidence and bounded rationale.

Safe unrelated Candidates may continue to the same atomic ChangeSet.

---

## 19. Runtime Knowledge Base

A Knowledge Base remains a portable runtime data instance.

Conceptually:

```text
<kb-root>/
├── manifest.yaml
├── raw/
├── theme-groups/
├── entities/
├── relations/
├── claims/
├── sources/
├── modules/
├── registry/
└── logs/
```

Runtime KB data remains independent from repository source code.

---

## 20. Registry

Registry remains authoritative for canonical ID → storage reference mapping.

Requirements:

- backend-neutral relative storage refs;
- no root escape;
- validated discovery;
- no LLM access authority over registry location or mutation.

---

## 21. Writer

Writer remains deterministic infrastructure.

Writer does not perform research reasoning or Knowledge Resolution.

Requirements:

- validated ChangeSet only;
- mutation lock;
- revision guard;
- stale-target guard;
- idempotency;
- staged state;
- staged full validation;
- atomic commit;
- ingestion log;
- one commit at most per ingestion.

---

## 22. Scale Model

### 22.1 Document Scale

Document reasoning scales through ExtractionUnits.

### 22.2 Knowledge Scale

Knowledge Resolution scales through deterministic indexes and bounded Resolution Cases.

KB size must not linearly increase Reasoning context size.

### 22.3 Conflict Scale

The number of Reasoning calls after extraction scales with unresolved semantic ambiguity/conflict, not with total Candidate count.

A fresh KB should therefore require little or no post-extraction semantic reasoning.

---

## 23. Portability

Knowledge Resolution must remain host-agent portable.

Semantic Resolution Cases are invoked through the existing `ReasoningExecutor` seam.

No Knowledge Domain code depends directly on Codex, DeepSeek, or another specific host runtime.

Changing the host reasoning system should require adapter/wiring changes, not Knowledge architecture changes.

---

## 24. Excluded Architecture

v0.2 does not require:

- Graph Database;
- Vector Database;
- RAG;
- generic fuzzy canonical identity engine;
- automatic ontology/schema creation;
- multi-agent;
- generic Workflow Engine;
- per-case commit;
- direct LLM database access;
- LLM-generated canonical IDs;
- full-KB prompt injection.

---

## 25. Superseded v0.1 Assumptions

v0.2 supersedes these v0.1 assumptions:

1. semantic reconciliation between every Candidate and existing Knowledge is a mandatory Curation Skill stage;
2. full Candidate sets should be sent to one Reconciliation call;
3. LLM may directly select mutation-like actions such as create/update/supersede for all Candidates;
4. canonical reference resolution should wait until after full-set Reconciliation;
5. extraction Candidate refs may treat an LLM-selected durable `existingRef` as authoritative;
6. the full ReportMap is a normal post-extraction reconciliation dependency.

Historical v0.1 remains preserved.

---

## 26. Relationship to Review-Reduction Patch v0.1

The Review-Reduction Patch remains useful where compatible.

Preserved:

- symbolic local Candidate refs;
- Schema-driven relation constraints;
- strong Candidate graph completeness;
- Unicode-safe consolidation;
- post-resolution deterministic semantic consolidation/diff;
- mandatory ReviewSummary telemetry;
- no premature Schema 0.3 expansion.

Superseded:

- authoritative extraction-time `existingRef`;
- broad “reconciliation” as the normal semantic path;
- any implication that LLM mutation decisions are the primary canonical-resolution mechanism.

---

## 27. Product Validation Requirement

v0.2 is not considered product-validated until a real Raw → Knowledge run using the frozen validation report demonstrates:

```text
Raw
→ Docling
→ Plan
→ Extraction
→ Consolidation
→ Knowledge Resolution
→ ChangeSet
→ Writer
→ Reload
→ Replay
```

with:

- real ReasoningExecutor;
- no full-set Reconciliation;
- bounded semantic case telemetry;
- final Schema 0.3 validation;
- provenance integrity;
- revision exactly once;
- exact replay with zero new semantic reasoning.

---

## 28. Architectural Conclusion

ResearchHub v0.2 treats canonical Knowledge ingestion as:

> document semantics first, deterministic Knowledge resolution second, bounded semantic uncertainty resolution only when necessary, and canonical mutation last.

This preserves the authority of the reasoning system where semantics genuinely require reasoning while preventing the LLM from becoming a general-purpose database reconciliation engine.
