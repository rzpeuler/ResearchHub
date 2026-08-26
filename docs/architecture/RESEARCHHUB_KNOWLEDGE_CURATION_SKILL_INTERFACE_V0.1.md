# RESEARCHHUB_KNOWLEDGE_CURATION_SKILL_INTERFACE_V0.1

## Status

**Architecture Freeze**

- Version: v0.1
- Date: 2026-08-26

## 1. Purpose

Knowledge Curation Skill performs research-material understanding, filtering, atomic extraction, classification, admission, schema mapping assistance, confidence reasoning, conflict analysis, and Schema Gap detection.

It proposes what should become Knowledge. It never directly mutates a Knowledge Base.

## 2. Public Capabilities

```text
assessSource()
filterRelevantContent()
extractKnowledgeCandidates()
assessKnowledgeAdmission()
mapKnowledgeCandidates()
analyzeKnowledgeConflicts()
detectSchemaGaps()
```

## 3. Source Assessment

Records rawRef, sourceType, publisher/institution/author, publishedAt, primary/secondary status, sourceReliability, sourceIdentityConfidence, and reasoning.

Source Reliability and Claim Confidence are separate.

## 4. Content Relevance

Chunk decisions:

- relevant
- contextual
- irrelevant

Typical rejected material includes disclaimers, templates, duplicate navigation, marketing copy, unrelated news, headers/footers.

Filtering never alters Raw.

## 5. Candidate Extraction

Candidates are atomic. Candidate types:

- entity
- relation
- intelligence
- module_content

Intelligence:

- fact
- forecast
- viewpoint
- trend
- risk

## 6. Knowledge Admission

Admission evaluates relevance, specificity, information gain, evidence density, time/scope precision, and research utility.

Reject reasons include:

- irrelevant
- trivial_commonplace
- low_information_value
- insufficient_specificity
- unsupported_generic_claim
- transient_noise
- duplicate_background
- malformed_claim

The target is high durable signal-to-noise, not maximum extraction count.

## 7. Schema Mapping

- mapped
- partially_mapped
- unmapped

Do not hide unrepresentable structured information inside generic descriptions merely to increase mapping rate.

## 8. Schema Gaps

Types:

- vocabulary_gap
- schema_gap
- validation_gap
- access_gap
- projection_gap

Curation may detect and propose. It cannot modify Schema.

## 9. Conflict Analysis

Workflow supplies Candidate + ExistingKnowledgeContext.

Resolutions:

- create
- update
- supersede
- merge_source
- keep_both
- reject
- user_review

Fact seeks consistency; Forecasts and Viewpoints may coexist.

## 10. LLM Boundary

LLM may assist with interpretation and reasoning. It cannot write files, update Registry, mutate Schema, run Migration, execute Git, or autonomously run in the background.

## 11. Intermediate State

Candidates and decisions are Workflow intermediate data by default. Audit summaries go to ingestion logs; original content stays in Raw.

## 12. Frozen Decision

Curation is the reasoning boundary for Knowledge admission and conflict interpretation; durable mutation remains deterministic and externally controlled by Workflow.
