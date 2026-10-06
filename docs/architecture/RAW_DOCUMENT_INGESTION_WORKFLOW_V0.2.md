# ResearchHub — Raw Document Ingestion Workflow v0.2

## Status

**Frozen**

Upon approval, this document supersedes `RAW_DOCUMENT_INGESTION_WORKFLOW_V0.1.md` as the normative Raw Document → Canonical Knowledge workflow.

The v0.1 document remains historical and MUST NOT be rewritten.

This workflow adopts `KNOWLEDGE_RESOLUTION_ARCHITECTURE_V0.1.md`.

---

## 1. Objective

Transform one raw research document into at most one safe, validated semantic mutation of a canonical Knowledge Base.

The Workflow is deterministic in control flow.

Reasoning is invoked only at explicitly authorized semantic nodes.

The key v0.2 change is:

> Full-set Reconciliation is removed from the main path and replaced by Knowledge Resolution: deterministic Binding/Diff first, bounded Semantic Resolution Cases only where necessary.

---

## 2. Normative Workflow

```text
START
  ↓
[1] Intake + Raw Archive
  ↓
[2] Parse Structured Document
  ↓
[3] Understand + Propose Extraction Plan
  ↓
[4] Deterministically Validate Extraction Plan
  ├─ repairable invalid → bounded semantic plan repair → [4]
  └─ terminal invalid → BLOCKED
  ↓
Accepted ExtractionPlan
  ↓
[5] Bounded Parallel Extract + Per-Unit Validate
  ↓
[6] Consolidate Candidates
  ↓
[7] Knowledge Resolution
  ├─ 7A Entity Canonical Binding
  ├─ 7B Entity State Diff
  ├─ 7C Resolve Candidate Graph References
  ├─ 7D Relation Knowledge Diff
  ├─ 7E Claim Knowledge Diff
  ├─ 7F Bounded Semantic Resolution Cases
  └─ 7G Deterministic Resolution Policy
  ↓
ResolutionIntent Set
  ↓
[8] Plan One ChangeSet
  ↓
[9] Final Deterministic Validation
  ├─ invalid → BLOCKED
  ↓
[10] Atomic Write
  ↓
[11] Reload + Verify
  ↓
END
```

---

## 3. Workflow Control Principle

The Workflow owns execution order.

The reasoning system does not choose the next node.

Frozen rule:

> Agent/LLM decides how to reason inside an authorized semantic node. Workflow decides which node runs, when it runs, whether it may retry, and whether execution may proceed.

No semantic operation may bypass deterministic validation gates.

---

## 4. [1] Intake + Raw Archive

Deterministic.

Responsibilities:

- validate Workflow input;
- resolve the target Knowledge Base;
- acquire input bytes;
- derive Raw identity;
- archive Raw immutably;
- normalize supplied Source metadata;
- derive Workflow input fingerprint;
- enforce replay/idempotency preconditions.

Raw archival alone does not increment semantic Knowledge revision.

No semantic reasoning occurs.

---

## 5. [2] Parse Structured Document

Deterministic Plugin execution.

Output:

```text
StructuredDocument
├── metadata
├── sections[]
├── blocks[]
└── parser diagnostics
```

Blocks remain the smallest normal provenance anchors.

Document parsing does not create canonical Knowledge.

---

## 6. [3] Understand + Propose Extraction Plan

Semantic Skill execution through `ReasoningExecutor`.

Outputs:

```text
ReportMap
+
ExtractionPlanProposal
```

The Proposal MUST be exhaustive:

```text
Every document Block
=
primary-covered by exactly one ExtractionUnit
OR
explicitly excluded
```

`contextRefs` do not satisfy coverage.

The reasoning system may decide:

- semantic Unit boundaries;
- Unit purpose;
- primaryRefs;
- contextRefs;
- extraction focus;
- explicit exclusions.

It does not authorize its own plan.

---

## 7. [4] Deterministic ExtractionPlan Validation

Deterministic.

Checks include:

- valid refs;
- unique Unit IDs;
- primary coverage completeness;
- one primary owner per Block;
- Primary/Excluded mutual exclusion;
- Unit count hard limit;
- context capacity;
- no durable canonical IDs;
- structurally legal plan.

If a semantic plan defect is repairable, Workflow may request bounded semantic repair.

Repair returns a complete replacement plan and must pass [4] again.

No deterministic semantic auto-repartitioning is allowed.

---

## 8. ExtractionUnit

An ExtractionUnit is a reasoning context, not a Knowledge partition.

Conceptually:

```text
ExtractionUnit
├── unitId
├── topic
├── semanticPurpose
├── primaryRefs[]
├── contextRefs[]
├── extractionFocus?
└── deterministic capacity metadata
```

Extraction Unit boundaries do NOT define Knowledge Resolution boundaries.

---

## 9. [5] Bounded Parallel Extract + Per-Unit Validate

Each accepted Unit independently invokes Knowledge Curation extraction.

Inputs include:

- Unit primary content;
- Unit context content;
- relevant ReportMap context;
- executable Schema context;
- strict output contract.

Outputs:

```text
EntityCandidate[]
RelationCandidate[]
ClaimCandidate[]
```

Rules:

- local candidate IDs only;
- Relation/Claim Entity refs are local candidate refs;
- no durable canonical IDs;
- no KB mutation;
- no Writer calls;
- Candidate evidence must be document-grounded.

Per-Unit deterministic validation isolates invalid Candidates.

Retry is bounded and Unit-local.

Successful Units do not rerun because another Unit fails.

All required Units synchronize before Consolidation.

---

## 10. [6] Candidate Consolidation

Deterministic where identity is provable inside the newly extracted Candidate set.

Responsibilities:

- merge exact/normalizable duplicate Entity Candidates;
- normalize Unicode-safe local Candidate identity;
- merge equivalent Relations using local resolved Candidate identities;
- normalize Claim subject order;
- merge exact equivalent Claims;
- aggregate evidence/provenance;
- preserve review-worthy consolidation conflicts;
- maintain local Candidate aliases and graph consistency.

Consolidation does not query the KB to decide canonical identity.

It does not allocate durable IDs.

If ambiguity cannot be safely resolved inside the new Candidate set, it must remain explicit for Knowledge Resolution/review.

---

## 11. [7] Knowledge Resolution

Knowledge Resolution is one Workflow stage with dependency-ordered deterministic substeps and bounded semantic cases.

Its normative architecture is defined by `KNOWLEDGE_RESOLUTION_ARCHITECTURE_V0.1.md`.

### 11.1 7A Entity Canonical Binding

For each consolidated EntityCandidate:

1. deterministic plausible-match retrieval;
2. apply frozen hard identity rules;
3. produce one of:
   - BoundExisting;
   - PlannedNew;
   - Unresolved;
4. create bounded `EntityBindingCase` only when plausible matches exist but deterministic proof is insufficient.

Built-in v0.1 hard identity is intentionally conservative: Company exact normalized `(exchange,ticker)` is the only built-in hard key. Exact name, alias and legalName remain retrieval signals only unless a future frozen identity policy says otherwise.

Full-set LLM Reconciliation is forbidden.

### 11.2 7B Entity State Diff

For `BoundExisting` Entities, apply conservative deterministic state diff:

- no new field information → no-op direction;
- additive, non-conflicting enrichment → enrich-existing direction;
- conflicting already-populated field → root Review.

No Entity state-conflict LLM case is introduced in v0.2 initial implementation.

### 11.3 7C Resolve Candidate Graph References

Use Entity Binding results to resolve:

- Relation source/target refs;
- Claim subject refs.

Unresolved Entity roots generate root Review.

Dependent Relation/Claim Candidates generate dependency Review.

Independent resolved Candidates continue.

### 11.4 7D Relation Knowledge Diff

For each safely resolved Relation:

- query only relevant existing Relation state;
- if absent → Create intent direction;
- if exact → provenance merge/no-op direction;
- if semantically conflicting and deterministic policy cannot decide → `RelationConflictCase`.

### 11.5 7E Claim Knowledge Diff

For each safely resolved Claim:

- exact identity check;
- bounded structural plausible-conflict retrieval using resolved subjects, Claim type, temporal compatibility, exact statement and structured metric signals;
- absent → Create intent direction;
- exact → evidence merge/no-op direction;
- plausible semantic conflict → `ClaimConflictCase`;
- retrieval overflow that cannot be safely bounded without arbitrary truncation → Review.

### 11.6 7F Bounded Semantic Resolution Cases

Only unresolved semantic questions invoke Reasoning.

Case inputs are bounded projections.

Default case context MUST NOT contain:

- full KB;
- full ReportMap;
- all Candidates;
- unrelated existing Knowledge;
- Writer/ChangeSet state.

Independent cases may execute in bounded parallel.

A failed case may undergo bounded retry according to Workflow policy.

### 11.7 7G Deterministic Resolution Policy

Validated semantic outcomes are converted into infrastructure-owned `ResolutionIntent`s.

Frozen dispositions are:

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

LLM semantic outcomes do not directly become Writer actions. The ChangeSet Planner performs kind-specific mapping against Schema 0.3 operations.

Every retained Candidate must end with:

- exactly one ResolutionIntent;
- or an explicit dependency-review outcome.

---

## 12. ResolutionIntent Barrier

Before ChangeSet planning, Workflow performs a complete deterministic barrier.

Required invariants:

- every retained Candidate is accounted for;
- no Candidate has multiple dispositions;
- no Candidate silently disappears;
- unresolved dependency paths are review-isolated;
- all canonical/planned references are structurally resolvable;
- no semantic case remains pending.

Only then may [8] execute.

---

## 13. [8] Plan One ChangeSet

Deterministic.

Inputs:

- accepted ExtractionPlan;
- consolidated Candidate graph;
- Entity Binding results;
- ResolutionIntents;
- review isolation results;
- Source/Raw metadata;
- current KB revision.

Responsibilities:

- allocate durable canonical IDs for `PlannedNew`;
- map BoundExisting refs;
- produce Source mutation;
- produce safe Entity/Relation/Claim operations;
- merge provenance;
- apply deterministic lifecycle/mutation policy;
- attach expected-before hashes;
- bind expected base revision;
- emit exactly one semantic ChangeSet at most.

Reasoning does not allocate IDs or construct ChangeSet operations.

If no safe semantic mutation exists, Workflow may produce no semantic ChangeSet while still recording Review/no-op execution according to governance rules.

---

## 14. [9] Final Deterministic Validation

Validate:

- ChangeSet schema;
- base revision;
- stale-target guards;
- operation legality;
- canonical refs;
- Entity/Relation/Claim integrity;
- relation endpoint constraints;
- Claim subject integrity;
- Source → Raw provenance;
- review isolation;
- staged-next-state admissibility preconditions.

Failure routes to `BLOCKED`.

No reasoning system may bypass this node.

---

## 15. [10] Atomic Write

Exactly one Writer commit at most.

Writer preserves:

- mutation lock;
- revision guard;
- stale-target guard;
- idempotency;
- staged next state;
- staged full validation;
- atomic root commit;
- ingestion log;
- revision update.

No Unit or Resolution Case may write independently.

---

## 16. [11] Reload + Verify

After commit:

- reload the Knowledge Base from durable storage;
- run full Knowledge validation;
- verify expected revision;
- verify canonical refs;
- verify Source/Raw provenance;
- verify no dangling Relation/Claim refs;
- verify ingestion log and replay state.

---

## 17. Replay

For an identical committed Workflow input fingerprint:

- replay must return the prior terminal semantic status;
- Writer status is `already_committed`;
- semantic revision is unchanged;
- no Understand/Plan reasoning reruns;
- no Extraction reasoning reruns;
- no Semantic Resolution Case reasoning reruns.

Replay is deterministic infrastructure behavior.

---

## 18. Review Isolation

Review is an explicit safe terminal branch for individual semantic uncertainty.

Root Review examples:

- unresolved Entity Binding;
- unresolved Relation Conflict;
- unresolved Claim Conflict;
- genuine Schema gap;
- approved taxonomy ambiguity.

Dependency Review examples:

- Relation depends on unresolved Entity;
- Claim depends on unresolved Entity;
- downstream safe mutation cannot be constructed because a required upstream Candidate is unresolved.

Review must not:

- silently mutate Knowledge;
- create guessed canonical bindings;
- force unrelated safe Candidates into review.

A run may finish:

```text
completed_with_review
```

when the safe subset is valid and unresolved items are explicitly isolated.

---

## 19. Workflow Status

Normative terminal statuses:

```text
completed
completed_with_review
blocked
```

`blocked` is reserved for cases where the Workflow cannot produce a safe consistent terminal state, including:

- invalid unrecoverable plan;
- required execution failure;
- broken deterministic invariants;
- invalid ChangeSet;
- Writer/reload failure.

Individual semantic ambiguity should normally become Review rather than globally blocking independent safe work.

---

## 20. Context and Scale Invariants

### Extraction

Context scales by accepted ExtractionUnit.

### Knowledge Resolution

Reasoning context scales by bounded Semantic Resolution Case.

The number of KB objects MUST NOT define Reasoning prompt size.

Existing Knowledge is queried deterministically and only bounded relevant projections enter a Resolution Case.

### ChangeSet

One ingestion still produces at most one semantic ChangeSet and one Writer commit.

---

## 21. Retired v0.1 Main-Path Concepts

The following v0.1 main-path architecture is retired:

```text
Retrieve Relevant Existing Knowledge
        ↓
Reconcile ALL Candidates via LLM
        ↓
Resolve Canonical References
```

Also retired:

- one monolithic Reconciliation request;
- mandatory LLM decision for every Candidate;
- LLM mutation action vocabulary as persistence authority;
- Reconciliation batch boundaries as semantic partitions;
- full ReportMap in default post-extraction reconciliation context;
- globally flattened existingKnowledge prompt payload;
- extraction-time authoritative `existingRef` from Reasoning.

---

## 22. Preserved Architecture

v0.2 preserves:

- Schema 0.3;
- Storage Format 1;
- Raw immutability;
- Knowledge → Source → Raw provenance;
- Candidate local IDs;
- deterministic Plan Validation;
- bounded extraction;
- deterministic Consolidation;
- deterministic canonical IDs;
- one ChangeSet;
- one Writer;
- atomic persistence;
- idempotency;
- reload/full validation;
- no Graph DB requirement;
- no Vector DB requirement;
- no RAG requirement;
- no generic Workflow Engine;
- no multi-agent design.

---

## 23. Implementation Acceptance Direction

Implementation of this workflow is not accepted until offline tests and real validation demonstrate:

1. fresh KB safe Candidates do not require full-set Reconciliation;
2. hard Entity binding is deterministic and limited to frozen hard-key policy;
3. ambiguous Entity binding creates bounded semantic cases;
4. BoundExisting Entity field enrichment is conservative and conflicts become Review;
5. Relation/Claim diff occurs only after Entity Binding;
6. exact KB matches avoid Reasoning;
7. Claim plausible-conflict retrieval is bounded and overflow-safe;
8. only conflicts/ambiguity invoke Reasoning;
9. semantic outcome → ResolutionIntent → ChangeSet mapping is deterministic and kind-specific;
10. exact Claim evidence merge preserves Source refs and provenance anchors;
11. unresolved dependencies are review-isolated;
12. every retained Candidate is accounted for;
13. one ChangeSet / one Writer invariant remains;
14. review-only/reject-only runs do not create an unreferenced Source;
15. replay performs zero semantic reasoning;
16. full real Docling + Codex validation reaches Writer/reload/replay before v0.2 is considered product-validated.
