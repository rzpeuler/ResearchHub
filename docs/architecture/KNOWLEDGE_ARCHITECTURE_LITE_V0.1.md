# ResearchHub — Knowledge Architecture v0.1

## Status

**Frozen for initial implementation**

## 1. Purpose

The Knowledge system converts research material into durable, queryable, provenance-backed canonical knowledge.

The architecture must preserve two authorities:

### Research Semantics Authority

The reasoning system interprets the research document.

It may determine:

- what the document is about;
- which entities matter;
- which relationships are expressed;
- which claims are durable;
- how sections depend semantically on one another;
- how extraction should be decomposed;
- how new information relates to existing Knowledge.

### Knowledge Integrity Authority

Deterministic code controls canonical integrity.

It owns:

- Schema;
- IDs;
- references;
- provenance;
- ChangeSet admissibility;
- revision protection;
- stale-target protection;
- staged-state validation;
- atomic persistence;
- idempotency.

The central principle is:

> LLM owns semantic decomposition; Workflow owns execution control; deterministic code owns plan admissibility and Knowledge integrity.

## 2. Canonical Knowledge Baseline

Initial baseline:

- Schema Version: `0.3`
- Storage Format Version: `1`

Canonical object families remain:

- ThemeGroup
- Entity
- Relation
- Claim
- Source
- Module
- RawRef

Entity types remain:

- investment_theme
- industry
- company
- product
- technology

Claim types remain:

- fact
- forecast
- viewpoint
- trend
- risk

Canonical relation vocabulary starts from the frozen v0.3 relation model.

Schema changes require explicit architecture approval.

## 3. Provenance

Durable provenance follows:

```text
Knowledge
   ↓
Source
   ↓
Raw
```

Knowledge objects must not directly substitute LLM reasoning text for Source/Raw provenance.

Raw material is immutable after archival.

## 4. Raw Identity

Raw identity is content-derived.

The v0.3 SHA-256-based Raw identity semantics should be retained.

Raw archival is distinct from semantic Knowledge revision.

Archiving a Raw file alone must not implicitly create a semantic Knowledge revision.

## 5. Runtime Knowledge Base

A Knowledge Base is a portable runtime data instance.

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

Exact folder naming may follow the migrated Storage Format 1 implementation.

The Knowledge Base instance must remain independent from repository source code.

## 6. Registry

Registry is authoritative for canonical object location.

Requirements:

- canonical ID → storage reference mapping;
- storage references are backend-neutral/relative;
- references must not escape the Knowledge Base root;
- canonical objects are discovered through validated storage metadata rather than ad hoc filesystem scanning.

## 7. Canonical IDs

Canonical IDs are infrastructure-owned.

LLM/coding agents may only emit local candidate IDs during extraction.

Canonical IDs are assigned only during deterministic canonical resolution / ChangeSet planning.

## 8. ChangeSet

Each ingestion execution produces at most one semantic ChangeSet.

A ChangeSet represents the complete intended semantic mutation for that execution.

It must contain sufficient information for deterministic validation, including:

- target Knowledge Base identity;
- expected base revision;
- source operations;
- Knowledge operations;
- stale-target/hash protection where applicable;
- ingestion context;
- stable ChangeSet identity.

## 9. Validation

Validation has multiple distinct roles.

### Candidate Validation

Runs on LLM-produced semantic candidates.

Checks include:

- output contract;
- valid references;
- confidence constraints;
- grounding/provenance;
- relation semantics;
- required fields.

Candidate rejection must be isolated.

Rejected candidates must not silently leak into later stages.

### ChangeSet Validation

Runs before Writer execution.

Checks include:

- Schema 0.3 compliance;
- canonical reference integrity;
- operation validity;
- expected base revision;
- expected-before hashes;
- Source/Raw provenance;
- relation endpoint integrity;
- Claim lifecycle semantics.

### Staged-State Validation

Writer constructs a staged next state.

The complete staged Knowledge Base must pass full validation before atomic commit.

## 10. Writer

Writer is deterministic infrastructure.

Writer does not perform research reasoning.

Writer requires a validated ChangeSet/receipt.

Writer must preserve:

- revision guard;
- stale target guard;
- idempotency;
- mutation lock;
- staged next state;
- full staged validation;
- atomic root commit;
- ingestion log;
- committed revision update.

Only one Writer commit is permitted per ingestion execution.

## 11. Query and Existing Knowledge Retrieval

Existing Knowledge retrieval is a deterministic Knowledge Domain capability.

It should not be modeled as a semantic Skill when simple canonical lookup/indexing is sufficient.

The Workflow may use extracted/consolidated candidates to retrieve a focused set of existing Knowledge.

Semantic reconciliation between candidate and existing Knowledge remains a Curation Skill responsibility.

## 12. Excluded Architecture

Lite v0.1 does not require:

- Graph Database;
- Vector Database;
- RAG;
- automatic Schema migration;
- historical v0.2 compatibility;
- custom runtime.

These may be reconsidered only when a concrete product need justifies them.
