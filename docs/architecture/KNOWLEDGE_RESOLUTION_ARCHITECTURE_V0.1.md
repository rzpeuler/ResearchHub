# ResearchHub — Knowledge Resolution Architecture v0.1

## Status

**Frozen**

This document defines the normative Knowledge Resolution architecture for ResearchHub.

It replaces the previous architectural assumption that every consolidated Candidate must pass through one full-candidate-set LLM Reconciliation call.

It does **not** change Canonical Knowledge Schema 0.3 or Storage Format 1.

---

## 1. Purpose

Knowledge Resolution transforms a validated, consolidated document-grounded Candidate graph into deterministic mutation intents against a canonical Knowledge Base.

Its job is not to re-read the report and not to ask an LLM to decide database operations for every Candidate.

Knowledge Resolution separates four concerns that must remain distinct:

```text
Identity
≠
Knowledge Difference
≠
Semantic Conflict
≠
Mutation
```

The stage is therefore defined as:

```text
Knowledge Resolution
=
Canonical Binding
+
Knowledge Diff
+
Bounded Semantic Resolution
+
Deterministic Resolution Policy
```

The central rule is:

> Deterministic infrastructure resolves everything that can be proven from frozen Knowledge invariants. Reasoning is invoked only for bounded semantic questions that deterministic evidence cannot resolve.

---

## 2. Authority Model

### 2.1 Research Semantics Authority

The reasoning system may decide only semantic questions that cannot safely be established by deterministic rules.

Authorized examples:

- whether an ambiguous Entity mention refers to one of several plausible existing Entities;
- whether two non-identical Claims express the same proposition;
- whether a new Claim semantically supersedes, coexists with, contradicts, or is distinct from an existing Claim;
- whether conflicting Relation state is semantically equivalent, changed, distinct, or unresolved.

Reasoning does **not** own:

- canonical IDs;
- durable references;
- Knowledge retrieval policy;
- deterministic identity keys;
- ChangeSet actions;
- Writer behavior;
- workflow routing;
- revision or storage state.

### 2.2 Knowledge Integrity Authority

Deterministic infrastructure owns:

- Candidate and canonical reference validity;
- frozen identity keys;
- plausible-match retrieval;
- exact equality and structural diff;
- canonical binding when identity is provable;
- planned-new references;
- dependency propagation;
- semantic-outcome validation;
- semantic-outcome → mutation-intent mapping;
- canonical ID allocation;
- ChangeSet planning and validation;
- Writer and persistence.

### 2.3 Workflow Authority

Workflow owns:

- execution order;
- synchronization barriers;
- bounded semantic case execution;
- retry policy;
- blocked/completed/completed_with_review status;
- the rule that no ChangeSet may be planned before Knowledge Resolution reaches a complete safe state.

---

## 3. Resolution Protocol

All Candidate kinds follow one common protocol:

```text
Candidate
   ↓
Deterministic Retrieval
   ↓
Can frozen deterministic invariants resolve the case?
   ├─ Yes
   │    ↓
   │  Binding / Diff Result
   │
   └─ No
        ↓
   Semantic Resolution Case
        ↓
   Semantic Outcome
        ↓
Deterministic Resolution Policy
        ↓
ResolutionIntent
```

This protocol is unified across Entity, Relation, and Claim, while each kind uses kind-specific identity and diff rules.

---

## 4. Why Entity Binding Comes First

Relations and Claims depend on Entity identity.

Therefore Knowledge Resolution MUST process dependencies in this order:

```text
Entity Binding
      ↓
Entity State Diff
      ↓
Candidate Graph Reference Resolution
      ↓
Relation Diff
      ↓
Claim Diff
      ↓
Semantic Conflict Resolution
      ↓
ResolutionIntent Set
```

No Entity state mutation, Relation comparison, or Claim comparison may treat unresolved local Entity references as canonical identity.

---

## 5. Entity Canonical Binding

### 5.1 Input

Input is a consolidated `EntityCandidate`.

Reasoning-time extraction local IDs remain execution-local.

The binding stage determines whether that Candidate refers to:

```text
BoundExisting
PlannedNew
Unresolved
```

These are technical resolution states, not database actions.

### 5.2 BoundExisting

`BoundExisting` is allowed only when identity is established by a frozen deterministic identity rule or by a validated semantic binding outcome.

Example of a deterministic hard key for a Company:

```text
entityType = company
exchange = SZSE
ticker = 300476
```

If the frozen Entity Resolution Policy declares `(entityType, exchange, ticker)` a unique identity key, a matching existing Entity may be bound without Reasoning.

String similarity alone is not a hard identity proof.

### 5.3 PlannedNew

If deterministic plausible-match retrieval returns no candidate under the frozen retrieval policy:

```text
possibleExisting = []
```

the Entity becomes `PlannedNew`.

`PlannedNew` is represented by a Workflow-owned planned reference, for example:

```text
planned-entity-001
```

No durable canonical ID is allocated at this point.

Durable canonical IDs are allocated only by deterministic ChangeSet planning.

### 5.4 Unresolved

If one or more plausible existing Entities are found but deterministic identity proof is insufficient:

```text
possibleExisting.length > 0
AND
no deterministic proof
```

the Workflow creates an `EntityBindingCase`.

The Candidate is not silently treated as new.

### 5.5 Frozen Hard-Identity Policy v0.1

Hard identity is intentionally conservative. A field is not a hard key merely because it is structured.

Built-in v0.1 rules:

| Entity kind | Hard identity proof | Retrieval-only signals |
|---|---|---|
| company | exact normalized `(exchange, ticker)` when both are present and exactly one canonical Company matches | exact name, alias, legalName, ticker-only, exchange-only |
| investment_theme | none | exact normalized name/alias and valid taxonomy context |
| industry | none | exact normalized name/alias |
| product | none | exact normalized name/alias |
| technology | none | exact normalized name/alias |

`externalIds` may become hard keys only for namespaces explicitly registered as globally unique identity namespaces. No arbitrary `externalIds` key is automatically a hard key.

Rules:

1. a hard key may bind only within the same Entity type;
2. one hard key resolving to multiple existing Entities is a Knowledge-integrity defect and MUST NOT be resolved by picking one;
3. name/alias/legalName similarity is retrieval evidence, not identity proof;
4. absence of a hard-key match does not prove distinctness when plausible lexical/structured matches exist;
5. future hard keys require explicit architecture approval or a separately frozen identity-policy extension.

### 5.6 Entity State Diff After Binding

Binding answers **who the Entity is**. It does not automatically authorize overwriting canonical Entity state.

For `PlannedNew`, the normal direction is `CreateIntent`.

For `BoundExisting`, deterministic Entity state diff applies:

- no new canonical field information → `NoOpIntent`;
- additive, non-conflicting enrichment → `EnrichExistingIntent`;
- any conflicting already-populated semantic field that cannot be resolved by a frozen deterministic merge rule → `ReviewIntent`.

Initial v0.1 deterministic enrichment is conservative: union non-conflicting aliases, and fill previously absent optional fields only when doing so does not conflict with existing values. Free-text description replacement is not automatically authorized merely because the Candidate is bound to the same Entity.

Entity state conflict does **not** introduce another normal-path LLM case in v0.1. Identity ambiguity uses `EntityBindingCase`; conflicting canonical Entity state is review-isolated until repeated evidence justifies a narrower semantic case.

---

## 6. Plausible-Match Retrieval

Retrieval is deterministic Knowledge Domain infrastructure.

It does not make semantic equivalence decisions.

The retrieval policy may use typed indexed signals such as:

- frozen hard identity keys;
- exact normalized name;
- aliases;
- legal name;
- ticker;
- exchange;
- other Schema-approved structured identifiers.

Retrieval produces a bounded set of plausible existing objects.

Rules:

1. retrieval must be deterministic for the same KB revision and Candidate;
2. retrieval must be type-aware;
3. retrieval must not load the whole KB into Reasoning context;
4. fuzzy or semantic similarity, if ever introduced later, remains a retrieval signal only unless explicitly frozen as an identity invariant;
5. absence of an exact text match alone is not sufficient proof of novelty unless the frozen retrieval policy says no other plausible-match mechanism applies.

Vector DB, embeddings, and RAG are not required by v0.1.

---

## 7. EntityBindingCase

### 7.1 Purpose

An `EntityBindingCase` asks one bounded semantic identity question:

> Which plausible existing referent, if any, denotes the same real-world Entity as this Candidate?

### 7.2 Reasoning Projection

Reasoning receives only bounded semantic projections:

```text
EntityBindingCase
├── caseId
├── candidate
├── possibleExisting[]
├── selected evidence
├── minimal source context
└── allowedOutcomes
```

Existing durable canonical IDs MUST NOT be exposed as Reasoning-owned references.

The Workflow maps them to case-local aliases:

```text
existing-001
existing-002
...
```

The Workflow privately retains:

```text
existing-001 -> entity:<durable-id>
```

### 7.3 Allowed Semantic Outcomes

Entity binding Reasoning may return only:

```text
equivalent_to
distinct_from_all
uncertain
```

`equivalent_to` must target exactly one supplied case-local existing alias.

The Reasoning system does not return:

- create;
- duplicate;
- merge_source;
- update_state;
- canonical IDs;
- ChangeSet operations.

### 7.4 Outcome Mapping

Deterministic policy maps:

```text
equivalent_to(existing-N)
    → BoundExisting(mapped canonical ref)

distinct_from_all
    → PlannedNew

uncertain
    → unresolved Review state
```

---

## 8. Candidate Graph Reference Resolution

After Entity Binding reaches a safe result set, the Workflow resolves Relation endpoints and Claim subjects.

Conceptually:

```text
local EntityCandidate ref
        ↓
BoundExisting canonical ref
OR
PlannedNew Workflow ref
OR
Unresolved
```

Rules:

- all resolved Relation endpoints and Claim subjects use Binding results;
- unresolved Entity dependencies do not receive guessed refs;
- dependent Relation/Claim Candidates become dependency review items;
- unrelated safely resolved Candidates continue.

This is deterministic.

---

## 9. Relation Knowledge Diff

After endpoint resolution, a Relation Candidate has a deterministic semantic identity based on:

```text
relationType
+
resolved source reference
+
resolved target reference
```

with symmetric endpoint normalization for symmetric relation types.

### 9.1 ABSENT

If no existing Relation with the same canonical semantic identity exists:

```text
CreateIntent
```

No LLM call is required.

### 9.2 EXACT SAME

If the Relation and all identity/state fields relevant under Schema 0.3 are equivalent:

```text
MergeProvenanceIntent
```

or:

```text
NoOpIntent
```

if the same Source/provenance is already represented.

No LLM call is required.

### 9.3 CONFLICT

If the same Relation identity exists but meaningful state or attributes differ and deterministic merge policy cannot resolve them:

```text
RelationConflictCase
```

is created.

Only the conflicting local semantic context is sent to Reasoning.

---

## 10. Claim Knowledge Diff

Claim resolution occurs only after subject Entity references are resolved.

### 10.1 Exact Claim Identity

Exact equality uses:

```text
claimType
+ normalized statement/proposition identity
+ resolved unique subject set
+ temporal
+ structuredValue
```

Exact equality produces `MergeEvidenceIntent` or `NoOpIntent`.

### 10.2 Plausible-Conflict Retrieval Policy v0.1

If exact identity does not hold, deterministic retrieval searches only for Claims that could plausibly represent the same or conflicting proposition.

A plausible Claim must first satisfy:

1. compatible resolved subject identity;
2. same `claimType` by default;
3. temporally compatible scope when temporal information is available.

The retrieval ranking then prefers, in order:

1. exact normalized statement identity with differing structured value or provenance;
2. same normalized `structuredValue.metric` with compatible unit and temporal scope;
3. a bounded same-subject + same-claimType + temporally-compatible neighborhood when one or both Claims are unstructured.

Important rules:

- `Source.publishedAt` is not Claim temporal identity;
- metric matching is a retrieval signal, not semantic equivalence proof;
- lexical or fuzzy similarity does not become canonical equality;
- the retrieval set MUST be deterministically bounded;
- when a broad neighborhood exceeds the configured safe bound and deterministic ranking cannot safely form a complete relevant set, the Candidate becomes a retrieval-overflow Review rather than silently truncating potentially material conflicts.

### 10.3 No Plausible Existing Claim

If the bounded deterministic retrieval policy returns no plausible existing Claim:

```text
CreateIntent
```

No LLM call is required.

### 10.4 Plausible Semantic Conflict

If one or more related existing Claims remain after exact equality and bounded retrieval, a `ClaimConflictCase` is created.

The case asks only how the supplied propositions relate semantically; it does not ask the model to choose a database mutation.

---

## 11. Semantic Conflict Cases

### 11.1 Purpose

Semantic Conflict Cases are the only normal-path Reasoning seam after extraction.

They answer a bounded semantic question, not a persistence question.

Case kinds may include:

```text
EntityBindingCase
RelationConflictCase
ClaimConflictCase
```

### 11.2 Common Case Contract Direction

Conceptually:

```text
ResolutionCase
├── caseId
├── caseKind
├── candidateProjection
├── existingProjections[]
├── evidence[]
├── sourceContext
├── schemaContextSlice
└── allowedOutcomes[]
```

### 11.3 Context Rules

A case MUST NOT include by default:

- the whole KB;
- the full consolidated Candidate set;
- the full ReportMap;
- unrelated existing Knowledge;
- registry/storage metadata;
- revisions;
- Writer state;
- ChangeSets;
- durable IDs as Reasoning-owned identifiers.

Evidence should be bounded and directly relevant to the case.

### 11.4 Execution

Cases are independent semantic execution units where dependencies permit.

Workflow MAY execute independent cases in bounded parallel.

Case execution is not a new architecture layer and does not create a generic Workflow Engine.

Micro-batching may be added later as an execution optimization, but batch boundaries are not semantic authority.

---

## 12. Semantic Outcome Vocabulary

Semantic outcomes describe relationships in the world, not database operations. The vocabulary is intentionally small.

### 12.1 Entity Binding

```text
equivalent_to
distinct_from_all
uncertain
```

`equivalent_to` MUST target exactly one supplied case-local alias.

### 12.2 Relation Conflict

```text
equivalent
state_changed
coexists
contradicts
invalid
uncertain
```

`state_changed` means the Candidate expresses a changed state of the same resolved Relation identity. It does not itself authorize an update.

### 12.3 Claim Conflict

```text
equivalent
supersedes
coexists
contradicts
invalid
uncertain
```

`updated_estimate`, `different_methodology`, and similar explanations belong in rationale/diagnostics unless later evidence justifies a normative outcome expansion.

Where an outcome refers to one or more existing objects, Reasoning returns only supplied case-local aliases.

---

## 13. Deterministic Resolution Policy

Reasoning outputs semantic outcomes. Deterministic policy converts validated outcomes into infrastructure-owned `ResolutionIntent`s.

### 13.1 Entity Binding Mapping

```text
equivalent_to(existing-N) → BoundExisting(mapped canonical ref)
distinct_from_all         → PlannedNew
uncertain                 → ReviewIntent
```

After `BoundExisting`, Entity state diff follows Section 5.6.

### 13.2 Relation Conflict Mapping

```text
equivalent    → MergeEvidenceIntent / NoOpIntent
state_changed → ReplaceStateIntent only when the transition is Schema-valid and deterministically admissible; otherwise ReviewIntent
coexists      → ReviewIntent by default in v0.1 unless a frozen relation-specific policy explicitly permits multiple canonical states
contradicts   → ReviewIntent
invalid       → RejectIntent
uncertain     → ReviewIntent
```

The v0.1 Relation policy intentionally prefers one canonical state per resolved Relation identity rather than manufacturing duplicate edges to escape conflict.

### 13.3 Claim Conflict Mapping

```text
equivalent  → MergeEvidenceIntent / NoOpIntent
supersedes  → SupersedeIntent
coexists    → CreateIntent for a distinct supported Claim
invalid     → RejectIntent
uncertain   → ReviewIntent
```

For `contradicts`, mapping is Claim-type aware:

- `forecast` and `viewpoint`: supported divergence may become `CreateIntent`;
- `fact`: contradiction is Review by default;
- `trend` and `risk`: contradiction is Review unless deterministic temporal/scoping rules establish that both states legitimately coexist.

Reasoning never directly selects Writer or ChangeSet operations.

---

## 14. ResolutionIntent

`ResolutionIntent` is the canonical intermediate product of Knowledge Resolution.

Conceptually:

```text
ResolutionIntent
├── candidateRef
├── candidateKind
├── disposition
├── targetRef?
├── semanticBasis
├── evidenceRefs[]
└── reviewDependencyRefs[]?
```

Frozen v0.1 dispositions:

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

These are infrastructure-owned intents, not LLM actions.

Every retained consolidated Candidate MUST end Knowledge Resolution with exactly one ResolutionIntent or an explicit dependency-review result. No Candidate may silently disappear.

### 14.1 ResolutionIntent → ChangeSet Mapping

The ChangeSet Planner performs kind-specific deterministic mapping against the actual Schema 0.3 mutation model.

| ResolutionIntent | Entity | Relation | Claim |
|---|---|---|---|
| `create` | `create` | `create` | `create` |
| `enrich_existing` | `update` with conservative non-conflicting field merge | `update` only when a frozen relation merge rule allows it | `update` only for deterministic non-semantic enrichment |
| `merge_evidence` | normally `no_op` because Entity Schema 0.3 has no `sourceRefs`/provenance field | `merge_source` | `update` that deterministically unions `sourceRefs` **and** Claim provenance anchors |
| `replace_state` | `update` | `update` | not used; Claim state replacement uses `supersede` |
| `supersede` | invalid | invalid | `supersede` |
| `no_op` | no Knowledge operation | no Knowledge operation | no Knowledge operation |
| `reject` | no Knowledge operation; rejection telemetry | same | same |
| `review` | no Knowledge operation; Review telemetry | same | same |

The Writer's generic `merge_source` operation is insufficient for exact Claim evidence merge when a new provenance anchor must be retained; the Planner therefore uses a deterministic Claim `update` for `merge_evidence` when needed.

`keep_both` is not a ResolutionIntent. When semantic policy establishes that a Claim is distinct and may coexist, the resulting infrastructure intent is simply `create`; existing canonical Knowledge remains untouched.

Source create/merge operations are planned only when at least one safe Knowledge operation needs the Source. A review-only/reject-only run MUST NOT create an otherwise unreferenced canonical Source merely because Raw was archived.

---

## 15. Review Isolation

Uncertainty must be isolated rather than guessed.

Example:

```text
Entity A -> unresolved Review
Entity B -> resolved
Entity C -> resolved

Relation(A,B) -> dependency Review
Relation(B,C) -> may continue safely
```

Rules:

- unresolved root Candidates become root Review items;
- dependents become dependency Review items;
- safe independent Candidates continue;
- one ambiguous Candidate does not automatically block the entire ingestion;
- Writer still receives at most one atomic ChangeSet containing only the safe subset plus properly represented review telemetry;
- silent partial success is forbidden.

The terminal status may therefore be:

```text
completed
completed_with_review
blocked
```

---

## 16. Fresh-KB Behavior

For a fresh empty Knowledge Base:

- deterministic Entity retrieval normally returns no plausible existing referents;
- safe Entity Candidates become `PlannedNew`;
- Relations over planned/resolved Entities are normally absent and become Create intents;
- Claims with no plausible existing Claim become Create intents;
- Semantic Resolution Case count should normally be near zero unless ambiguity exists inside Candidate identity itself.

A fresh KB MUST NOT require a full-candidate-set LLM Reconciliation call.

This is a core architectural invariant.

---

## 17. Knowledge-Scale Behavior

The number of canonical objects in the KB MUST NOT cause Reasoning input size to grow linearly.

Reasoning context size is bounded by individual Resolution Cases.

The KB is a deterministic query source, not a Reasoning prompt payload.

As the KB grows:

```text
100 objects
→ 100,000 objects
→ 1,000,000 objects
```

the expected Reasoning input for one ambiguity/conflict case remains bounded by the retrieval result limit and case projection.

---

## 18. Provenance

Knowledge Resolution never weakens provenance.

Document-grounded Candidate evidence remains attached through ResolutionIntent generation.

Durable provenance remains:

```text
Knowledge
   ↓
Source
   ↓
Raw
```

Semantic Resolution rationale is audit metadata, not a substitute for Source/Raw evidence.

---

## 19. Canonical ID Boundary

Canonical IDs remain infrastructure-owned.

Rules:

1. Extraction Reasoning emits local candidate IDs only.
2. Semantic Resolution Reasoning receives case-local aliases for existing objects.
3. `PlannedNew` uses Workflow-owned temporary references.
4. Durable Entity/Relation/Claim IDs are allocated only by deterministic ChangeSet planning.
5. Reasoning cannot construct, choose, or mutate registry/storage refs.

---

## 20. Retired Reconciliation Model

The following design is retired by this architecture:

```text
All Consolidated Candidates
        +
Focused Existing Knowledge
        ↓
one full-set LLM Reconciliation
        ↓
create / duplicate / merge_source / update_state /
supersede / keep_both / reject / user_review
```

Also retired as primary architecture:

- mandatory Reconciliation for every Candidate;
- Reconciliation batch partition as a semantic boundary;
- full ReportMap as default Reconciliation context;
- global flattened existingKnowledge prompt payload;
- LLM-selected database mutation action;
- LLM-created canonical refs.

---

## 21. Frozen Principles

### KR-1 — Binding before Diff

Entity referents MUST be resolved before Relation or Claim comparison.

### KR-2 — Deterministic proof before Reasoning

If frozen deterministic invariants can establish a result, Reasoning MUST NOT be invoked.

### KR-3 — Reasoning only for bounded semantic uncertainty

Reasoning receives individual bounded Resolution Cases, not the whole Candidate set or Knowledge Base.

### KR-4 — Semantic outcome is not mutation authority

Reasoning returns semantic relationships. Deterministic Resolution Policy produces mutation intents.

### KR-5 — Durable identity remains infrastructure-owned

Reasoning never creates or directly operates durable canonical IDs.

### KR-6 — Uncertainty is isolated, not guessed

Unresolved Candidates and dependents become Review. Independent safe Knowledge may continue.

### KR-7 — KB size does not define Reasoning context size

Existing Knowledge is retrieved deterministically and projected only when relevant to a bounded Resolution Case.

### KR-8 — One complete ResolutionIntent outcome per retained Candidate

Every retained Candidate reaches ChangeSet planning through exactly one explicit safe disposition or dependency-review state.

---

## 22. Non-Goals

Knowledge Resolution v0.1 does not introduce:

- Graph Database;
- Vector Database;
- RAG;
- fuzzy-match identity authority;
- generic ontology expansion;
- automatic taxonomy creation;
- generic Workflow Engine;
- multi-agent orchestration;
- per-case Writer commits;
- Schema 0.3 changes.

---

## 23. Superseding Rules

This document supersedes prior architecture assumptions that:

- semantic reconciliation between every Candidate and existing Knowledge is always a Curation Skill responsibility;
- `existingRef` should be an extraction-time Reasoning authority;
- LLM Reconciliation directly decides mutation actions;
- canonical reference resolution occurs only after a full-set Reconciliation result.

Historical documents remain preserved as historical baselines.

---

## 24. Acceptance Direction

An implementation of this architecture is not accepted until tests prove at minimum:

1. fresh KB ingestion can resolve safe Candidates without full-set Reconciliation;
2. deterministic hard Entity identity binds without Reasoning;
3. plausible-but-unproven Entity identity produces a bounded EntityBindingCase;
4. Reasoning never sees or produces durable IDs as authority;
5. Relation/Claim comparison occurs after Entity Binding;
6. exact existing Knowledge produces deterministic provenance merge/no-op behavior;
7. semantic conflicts alone create Resolution Cases;
8. semantic outcomes map deterministically to ResolutionIntents;
9. unresolved roots isolate dependent Candidates;
10. every retained Candidate has exactly one explicit ResolutionIntent or dependency-review outcome;
11. only one ChangeSet and one Writer commit are possible per ingestion;
12. KB growth does not imply full-KB Reasoning context growth.
