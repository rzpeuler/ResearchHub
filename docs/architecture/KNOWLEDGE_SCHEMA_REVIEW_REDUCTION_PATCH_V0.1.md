# ResearchHub — Knowledge Schema / Review-Reduction Patch v0.1

## Status

**Proposed for approval before Knowledge Schema + Storage migration**

## 1. Why this patch exists

The final accepted ResearchHub Knowledge v0.3 real pipeline completed with:

- `status = completed_with_review`
- `reviewItemCount = 157`
- `reviewIsolation.roots = 151`
- `reviewIsolation.dependencyReviews = 0`
- `schemaGapCount = 0`
- 1302 planned Knowledge creates
- successful final deterministic validation and atomic write for the safe subset

Therefore:

> The 157 review items must not be interpreted as 157 confirmed canonical Schema 0.3 defects.

The accepted pipeline proved that Schema 0.3 / Storage Format 1 can represent a large safe subset of the report.

The review volume instead exposes several schema-adjacent weaknesses in the extraction candidate model, reference-resolution contract, and relation consolidation policy.

This patch is designed to reduce avoidable review without weakening deterministic Knowledge integrity.

---

# 2. Decision

## 2.1 Canonical Knowledge Schema 0.3 remains the Lite baseline

Do **not** immediately add new canonical object kinds, relation types, or entity types merely because the final run contained 157 reviews.

The final run reported zero confirmed Schema Gaps.

The initial Lite migration should therefore preserve the canonical v0.3 object model unless a concrete repeated unrepresentable semantic case is demonstrated.

## 2.2 Patch the Candidate / Resolution contract before changing canonical Schema

Priority order:

1. Candidate symbolic references
2. Canonical candidate normalization
3. Post-resolution relation consolidation
4. Schema-driven relation endpoint constraints
5. Review telemetry
6. Only then evaluate genuine canonical Schema gaps

---

# 3. Problem A — Free-text candidate references

## Existing behavior

The old candidate model represents relation/claim targets largely through free-text semantic mentions.

Examples conceptually:

```text
RelationCandidate
  sourceMention.text = "NVIDIA"
  targetMention.text = "AI服务器"

ClaimCandidate
  subjectMentions[].text = "PCB"
```

Resolution later attempts to match those strings against:

- existing canonical Entity IDs;
- entity names;
- aliases;
- temporary new-entity mappings.

This creates avoidable failure modes:

- abbreviation mismatch;
- Chinese/English naming mismatch;
- punctuation differences;
- company short name vs legal name;
- product family vs product alias;
- extracted entity exists, but the relation uses another surface form;
- same surface form can resolve to more than one typed entity.

These become `invalid_reference` or `ambiguous` reviews even when the semantic intent is clear.

## Patch A — Candidate symbolic references

Every newly extracted Entity receives a stable **local candidate ID** inside the Workflow execution.

Relation and Claim candidates should prefer explicit local/canonical refs rather than relying on text matching.

### Proposed candidate direction

```text
EntityCandidate
  candidateId
  entityType
  name
  aliases
  ...

RelationCandidate
  candidateId
  relationType

  source:
    candidateRef?       # local EntityCandidate ID
    existingRef?        # canonical Entity ID
    mention             # human/debug provenance only

  target:
    candidateRef?
    existingRef?
    mention

ClaimCandidate
  candidateId
  subjectRefs[]:
    candidateRef?
    existingRef?
    mention
```

Rules:

- exactly one of `candidateRef` / `existingRef` should be authoritative when known;
- `mention` remains for auditability and semantic repair;
- deterministic validation checks referenced local candidate existence;
- free-text entity matching becomes fallback/repair behavior, not the primary reference mechanism.

### Expected effect

Large reduction in avoidable:

- `invalid_reference`
- ambiguous mention resolution
- downstream dependency review

---

# 4. Problem B — Relation endpoint semantics are discovered too late

## Existing behavior

The canonical executable Schema already defines allowed relation endpoint types.

Examples:

```text
supplier_of:
  company -> company

offers_product:
  company -> product

component_of:
  product -> product

uses_technology:
  company|product -> technology
```

However, LLM extraction can still emit a relation whose resolved endpoint types violate the relation definition.

The old Workflow then isolates the candidate under `invalid_semantics`.

## Patch B — Generate extraction constraints from executable Schema

The Knowledge Curation Skill must receive a machine-generated relation contract derived from the canonical executable Schema.

For every relation type expose:

```text
relationType
allowedSourceTypes
allowedTargetTypes
directionality
endpointConstraint?
```

The reasoning system should not infer this vocabulary from prose.

### Candidate pre-validation

Before a RelationCandidate is accepted:

1. resolve its local/canonical endpoint types;
2. verify endpoint type compatibility;
3. if invalid, reject only that candidate;
4. permit bounded semantic repair for that candidate/Unit;
5. do not contaminate the safe candidate set.

### Expected effect

Reduce post-resolution `invalid_semantics` reviews and move them into cheaper per-Unit repair.

---

# 5. Problem C — `business_exposure` cardinality collision

## Existing canonical rule

Schema 0.3 defines:

```text
business_exposure
  company -> industry
  cardinality:
    at_most_one_active_per_company_industry_pair
```

The old Workflow explicitly sends multiple new `business_exposure` candidates for the same resolved company-industry pair to review.

This is safe, but unnecessarily pessimistic when the candidates are semantically mergeable.

## Patch C — Resolve and consolidate before review

After endpoint resolution, calculate a canonical semantic relation key:

```text
relationSemanticKey =
  relationType
  + canonicalSourceRef
  + canonicalTargetRef
```

For `business_exposure` candidates sharing the same semantic key:

### Case 1 — Equivalent attributes

Merge deterministically:

- union evidence/provenance refs;
- retain one candidate;
- preserve all supporting source evidence.

### Case 2 — Compatible complementary attributes

Merge according to declared field policy.

Examples:

- same materiality;
- one candidate has unknown realization stage and another has a concrete stage;
- one candidate contains additional compatible financial contribution detail.

### Case 3 — Conflicting state attributes

Do not create duplicate active relations.

Produce one targeted review/reconciliation item describing only the conflicting fields.

### Case 4 — Multiple independent factual bases

Do not automatically weaken the canonical cardinality rule.

Keep one canonical company-industry `business_exposure` relation and represent distinct evidence/basis propositions as Claims whose subject may include that Relation.

This uses the existing Schema 0.3 ability for Claims to target Relations and avoids relation proliferation.

## Canonical Schema decision

**Do not yet change `business_exposure` to many active relations per company-industry pair.**

The existing one-active-state relation is useful for a canonical graph.

First fix consolidation.

Only if repeated real reports demonstrate that multiple simultaneously active relation states cannot be faithfully represented by one Relation + Claims should the canonical cardinality be reconsidered.

---

# 6. Problem D — Candidate consolidation occurs before canonical endpoint resolution

## Existing limitation

Old consolidation primarily compares candidate-local textual structure.

Two semantically identical candidates can survive if they use different surface mentions.

Example:

```text
"NVIDIA" -> "AI服务器"
"英伟达"  -> "AI Server"
```

After canonical resolution they may become the same relation.

## Patch D — Two-stage consolidation

### Stage 1 — Local extraction consolidation

Before resolution:

- exact structural duplicate merge;
- same local candidate ref merge;
- evidence union.

### Stage 2 — Canonical semantic consolidation

After entity/reference resolution:

- canonical entity key merge;
- canonical relation semantic key merge;
- normalized Claim subject set + proposition key merge;
- provenance union.

Only after Stage 2 should cardinality conflicts become review items.

---

# 7. Problem E — Claims can reference mentions not promoted to Entity candidates

## Existing failure mode

A Claim can be semantically valid but its subject mention may fail canonical resolution because:

- the corresponding Entity was never extracted;
- another surface form was used;
- Unit-local extraction omitted the entity;
- the object is represented in another ExtractionUnit.

## Patch E — Candidate graph completeness

Per ExtractionUnit validation should enforce:

> Every Relation endpoint and every Claim subject must resolve to either:
> 1. an explicit local candidate reference; or
> 2. an explicit existing canonical reference.

If a semantic object is required only to anchor a relation/claim, the extractor must still create/reference the required EntityCandidate.

For multi-Unit extraction:

- ReportMap provides shared global semantic context;
- Unit outputs use local IDs;
- consolidation establishes cross-Unit equivalence;
- canonical resolution occurs only after the consolidation barrier.

---

# 8. Problem F — Review telemetry is insufficient

The final durable evidence records:

```text
roots = 151
dependencyReviews = 0
total = 157
```

but does not preserve a complete review-category distribution in the summary.

This prevents precise quantitative attribution of the 157 reviews after the fact.

## Patch F — ReviewSummary becomes mandatory execution evidence

Every Lite ingestion result must contain:

```text
ReviewSummary
  total
  rootCount
  dependencyCount

  byCategory:
    invalid_reference
    invalid_semantics
    relation_cardinality
    schema_gap
    theme_creation
    theme_ambiguity
    reconciliation_review
    other

  byCandidateKind:
    entity
    relation
    claim
    workflow_level

  samplesByCategory[]
```

The execution trace should also record whether each review was:

- resolved by deterministic normalization;
- repaired by bounded semantic retry;
- isolated from ChangeSet;
- escalated as a genuine Schema Gap.

This is required before any future canonical Schema expansion decision.

---

# 9. Theme review policy

The difference between:

```text
151 candidate-root reviews
157 total reviews
0 dependency reviews
```

shows that six final review items were not counted as candidate-root reviews.

The old Workflow has workflow-level review categories such as:

- `theme_creation`
- `theme_ambiguity`

that do not require a candidate ID.

Because the durable final evidence summary does not retain the full category list, this patch does **not** claim that all six were definitely theme reviews.

Lite must preserve explicit category telemetry so this ambiguity does not recur.

Theme creation/ambiguity should remain reviewable until the Lite Knowledge taxonomy policy is separately redesigned.

---

# 10. Canonical Schema changes explicitly NOT approved by this patch

Do not yet add:

- new Entity types;
- new Relation types;
- Graph DB semantics;
- Vector/RAG fields;
- generic arbitrary relation type;
- free-form canonical relationship vocabulary;
- automatic taxonomy/schema creation;
- relaxed relation endpoint typing;
- relaxed provenance requirements.

Do not change:

```text
Knowledge -> Source -> Raw
```

Do not allow LLM-generated canonical IDs.

---

# 11. New Candidate-layer contracts to add during Lite implementation

The following contracts should be designed before the new Workflow implementation:

```text
StructuredDocument
ReportMap
ExtractionPlanProposal
ExtractionPlan
ExtractionUnit

EntityCandidate
CandidateEntityRef
RelationCandidate
ClaimCandidate

CandidateSet
ResolvedCandidateSet
ReviewItem
ReviewSummary
```

`CandidateEntityRef` is the key new seam.

Conceptually:

```text
CandidateEntityRef {
  mention: string
  candidateRef?: string
  existingRef?: string
  entityType?: EntityType
}
```

Validation must guarantee that accepted downstream candidates have exactly one unambiguous authoritative resolution path.

---

# 12. Migration impact

## COPY unchanged first

The canonical Schema 0.3 definitions remain the initial migration baseline.

## ADAPT before Workflow implementation

The following old assets must not be copied as-is:

```text
knowledge-curation/types.ts
knowledge-curation/validation.ts
old resolution logic
old candidate consolidation logic
```

They should be adapted to symbolic candidate references and two-stage consolidation.

## REFERENCE only

The old post-resolution review logic remains useful as safety evidence, but should not be preserved as the primary normal path.

---

# 13. Acceptance criteria for this patch

Before Lite Raw→Knowledge E2E is considered mature:

1. relation/claim candidate refs are symbolic rather than text-only;
2. per-Unit validation rejects dangling local refs;
3. relation endpoint constraints come from executable Schema;
4. canonical-semantic consolidation runs after reference resolution;
5. duplicate `business_exposure` candidates are merged where compatible;
6. true conflicting business exposure state is isolated rather than duplicated;
7. rejected candidates cannot leak into ChangeSet;
8. every ingestion run reports review counts by category;
9. future Schema changes require repeated evidence of genuinely unrepresentable semantics, not merely high review count.

---

# 14. Architectural conclusion

The final 157 reviews are useful evidence, but they do not justify broadening Canonical Knowledge Schema 0.3.

The first Lite optimization should be:

> strengthen the semantic candidate graph and canonical resolution boundary before expanding the canonical ontology.

This preserves the successful safety properties of Knowledge v0.3 while targeting the largest avoidable sources of review.
