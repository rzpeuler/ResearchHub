# ResearchHub — Raw Document Ingestion Workflow v0.1

## Status

**Frozen**

## 1. Objective

Transform one raw research document into one safe, validated semantic mutation of a canonical Knowledge Base.

The Workflow is deterministic in control flow while explicitly delegating authorized semantic decisions to the Knowledge Curation Skill.

## 2. Frozen Workflow

```text
START
  |
  v
[1] Intake & Raw Archive
  |
  v
[2] Parse Structured Document
  |
  v
[3] Understand + Plan
  |
  +--> ReportMap
  +--> ExtractionPlanProposal
  |
  v
[4] Deterministic Plan Validation
  |
  +-- invalid + repairable --> bounded semantic plan repair
  |
  v
Accepted ExtractionPlan
  |
  +--> Unit A
  +--> Unit B
  +--> Unit N
         |
         +-- bounded parallel extraction
  |
  v
[5] Per-Unit Extract + Validate
  |
  v
[6] Consolidate Candidates
  |
  v
[7] Retrieve Relevant Existing Knowledge
  |
  v
[8] Reconcile Knowledge
  |
  v
[9] Resolve Canonical References + Plan ChangeSet
  |
  v
[10] Final Deterministic Validation
  |
  +-- invalid --> BLOCKED
  |
  v
[11] Atomic Write
  |
  v
[12] Reload + Verify
  |
  v
END
```

## 3. Node Responsibilities

### [1] Intake & Raw Archive

Deterministic.

Responsibilities:

- validate workflow input;
- resolve target Knowledge Base;
- derive execution identity;
- derive Raw identity;
- archive Raw if not already archived;
- preserve immutable Raw provenance.

No semantic extraction occurs here.

### [2] Parse Structured Document

Deterministic Plugin execution.

Output:

```text
StructuredDocument
├── metadata
├── sections[]
└── blocks[]
```

Blocks are provenance anchors.

The parser must preserve enough locator information to support future Claim/Relation evidence references.

### [3] Understand + Plan

Semantic Skill execution through `ReasoningExecutor`.

This node may jointly produce:

#### ReportMap

A global semantic map of the report, including relevant concepts such as:

- source assessment;
- research scope;
- major topics;
- major entities;
- major conclusions;
- section semantics;
- semantic dependencies;
- uncertainties;
- cross-section relationships.

#### ExtractionPlanProposal

A semantic proposal for one or more ExtractionUnits.

The reasoning system may propose:

- Unit count;
- semantic purpose;
- Unit boundaries;
- `primaryRefs`;
- `contextRefs`;
- extraction focus.

This is an authorized LLM decision point.

The reasoning system does not authorize execution of its own proposal.

### [4] Deterministic Plan Validation

Deterministic.

Checks at minimum:

- every ref exists in StructuredDocument;
- Unit schema is valid;
- primary/context reference semantics are structurally legal;
- constructed Unit input fits the configured safe context budget;
- output reserve is acceptable;
- Unit count is within hard limits;
- requested concurrency is within hard/system limits;
- duplicate/overlapping refs follow configured policy;
- required extraction coverage rules are met;
- excluded material is explicitly permissible.

If invalid but semantically repairable, Workflow may invoke bounded plan repair.

Repair must return to deterministic Plan Validation.

### ExtractionPlan

An accepted plan is executable.

If:

```text
units.length == 1
```

the system naturally performs whole-document/whole-semantic-context extraction.

If multiple Units are accepted, they may execute in bounded parallel.

There are no separate Direct / Whole / Segmented Workflow paths.

## 4. ExtractionUnit Contract Direction

Conceptually:

```text
ExtractionUnit
├── unitId
├── topic / semanticPurpose
├── primaryRefs[]
├── contextRefs[]
├── estimatedInputTokens
└── extractionFocus?
```

### primaryRefs

Content for which this Unit has primary extraction responsibility.

### contextRefs

Supporting context that improves cross-section/global understanding but does not imply exhaustive extraction responsibility.

A Block may appear in multiple Units.

ExtractionUnits are reasoning contexts, not database partitions.

## 5. [5] Per-Unit Extract + Validate

Each Unit independently invokes Knowledge Curation extraction.

Inputs include:

- ReportMap/global context;
- Unit primary content;
- Unit context content;
- Knowledge Schema context;
- output contract.

Outputs are local candidates:

- EntityCandidate;
- RelationCandidate;
- ClaimCandidate.

Rules:

- local candidate IDs only;
- no canonical IDs;
- no KB mutation;
- no Writer calls.

Each Unit receives independent deterministic validation.

A failed Unit may undergo bounded retry without rerunning already-successful Units.

## 6. Parallel Extraction

Parallel execution is allowed when multiple Units exist.

Concurrency is bounded by Workflow configuration and ReasoningExecutor capabilities.

All required Units must reach a synchronization barrier before Candidate Consolidation.

The Workflow must never permit independent Unit commits.

## 7. [6] Candidate Consolidation

Deterministic where possible.

Responsibilities include:

- candidate deduplication;
- local-ID normalization;
- equivalent candidate merging;
- provenance aggregation;
- exact/normalizable entity name merging;
- equivalent relation merging;
- preservation of all evidence refs.

Semantic ambiguity that cannot safely be resolved deterministically may be deferred to reconciliation/review.

## 8. [7] Relevant Existing Knowledge Retrieval

Deterministic Knowledge Domain query.

The system uses consolidated candidates and ReportMap context to retrieve a focused set of possibly relevant existing:

- Entities;
- Relations;
- Claims;
- Sources.

This stage intentionally occurs after document-grounded candidate extraction so that existing Knowledge does not contaminate first-pass document interpretation.

## 9. [8] Reconcile Knowledge

Semantic Skill execution.

Responsibilities:

- duplicate detection;
- temporal update recognition;
- correction/conflict analysis;
- forecast/viewpoint divergence;
- complementary information;
- merge/update/supersede/keep-both/reject/review decisions.

Reconciliation may not write directly.

## 10. [9] Resolve Canonical References + Plan ChangeSet

Deterministic.

Responsibilities:

- resolve candidate references;
- map candidates to existing canonical objects where applicable;
- allocate new canonical IDs deterministically;
- construct Source mutation;
- construct Knowledge operations;
- attach expected-before hashes;
- bind expected base revision;
- produce exactly one semantic ChangeSet.

## 11. [10] Final Deterministic Validation

The ChangeSet and intended next state must be validated.

Failure routes to `BLOCKED`.

The reasoning system may not bypass this node.

## 12. [11] Atomic Write

Exactly one Writer execution.

Writer requires validated input.

Writer preserves:

- mutation lock;
- revision guard;
- stale-target guard;
- idempotency;
- staged state;
- staged validation;
- atomic commit;
- ingestion log.

## 13. [12] Reload + Verify

After commit:

- reload the Knowledge Base;
- run final canonical/full validation;
- confirm expected committed revision;
- confirm no dangling references;
- confirm provenance integrity;
- return final ingestion result.

## 14. Workflow Status

The Workflow should eventually support terminal statuses such as:

- `completed`
- `completed_with_review`
- `blocked`

Exact result contracts are implementation work, but silent partial success is not allowed.

## 15. Retired Concepts

The following are not part of the Lite v0.1 Workflow:

- fixed page-count routing;
- Direct/Whole/Segmented path branches;
- fixed `chunk → batch` reasoning;
- mandatory Section-only extraction boundaries;
- LLM-selected arbitrary next nodes;
- per-Unit canonical writes;
- model/API integration inside Workflow.
