# RESEARCHHUB_RESEARCH_REPORT_KNOWLEDGE_INGESTION_WORKFLOW_V0.1

## Status

**Architecture Freeze**

- Version: v0.1
- Date: 2026-08-26

## 1. Objective

Convert a user Research Report into high-signal, traceable, validated updates to one explicit Knowledge Base while collecting unresolved research decisions and Schema Gaps without blocking unrelated safe updates.

## 2. Input

```yaml
workflowRunId: string
knowledgeBaseId: string

report:
  inputRef: file | text | document_reference
  suppliedMetadata:
    title: string | null
    publisher: string | null
    institution: string | null
    author: string | null
    publishedAt: string | null
    sourceUrl: string | null

options:
  mode: commit | dry_run
  reprocess: false | true
```

## 3. Target Resolution

Resolve and verify the target KB before durable ingestion.

Readonly, archived, migration-required, unsupported, or unavailable targets block commit mode.

## 4. 11 Stages

```text
1. Intake & Target Resolution
2. Raw Archive & Document Normalization
3. Source Assessment
4. Document / Chunk Relevance Filtering
5. Knowledge Candidate Extraction
6. Knowledge Admission
7. Schema Mapping & Gap Detection
8. Existing Knowledge Retrieval
9. Conflict Resolution
10. Validation & Knowledge Commit
11. Final Provenance & Review Output
```

## 5. Raw-First

In commit mode Raw archival is the first durable mutation after target eligibility is confirmed.

If Raw archival fails, durable Knowledge creation is blocked.

Raw remains if later processing fails.

Dry-run does not mutate canonical KB.

## 6. Source Assessment and Filtering

Source identity uncertainty may reduce confidence or require review but does not automatically block extraction when Raw provenance is intact.

Chunk filtering removes obvious low-value content before extraction.

## 7. Admission

Rejected Candidates do not continue to Schema Mapping or Existing Knowledge retrieval and are not persisted as durable Candidate assets.

## 8. Schema Mapping / Gaps

Mapped continues. Partially mapped may write the safely representable portion plus a gap. Unmapped does not write.

A Schema Gap does not block unrelated Candidates.

## 9. Existing Knowledge Retrieval

Use minimal scoped queries. Retrieval infrastructure errors must never be interpreted as "no existing Knowledge".

## 10. Conflict Rules

Typical resolutions:

- duplicate → reject
- same claim, new independent source → merge_source
- different period → create / temporal update
- official correction with clear authority → supersede may be allowed
- forecast divergence → keep_both
- viewpoint divergence → keep_both
- unresolved same-scope fact conflict → user_review

## 11. Partial Continuation

User Review items do not block unrelated eligible changes.

## 12. Validation

Only a `ValidatedChangeSet` can enter the Writer.

Candidate-level invalid changes may be excluded; infrastructure-level Validation failure blocks commit.

## 13. Atomic Commit

Eligible Source/Knowledge/Registry/log changes become visible coherently or not at all.

Supersede is an atomic semantic operation.

## 14. Ingestion Log

One log records Raw create/reuse, Source summary, filtering/admission counts, Knowledge operations/hashes, duplicates, validation rejects, review items, Schema Gaps, failure stage, and final status.

## 15. Status

- completed
- completed_with_review
- blocked

## 16. Idempotency

Raw is deduplicated by content hash. Successful ingestion identity considers KB, Raw, Workflow version, and Schema version.

`reprocess=true` is explicit and still goes through normal conflict resolution.

## 17. User Review

Process the full report, commit all independently safe content, then return unresolved decisions as one batch.

## 18. Non-Goals

No Git, automatic Migration, automatic Schema modification, Agent Planner, background ingestion, or hidden Skill-to-Skill orchestration.

## 19. Frozen Decision

This is the first formal Knowledge maintenance Workflow and is optimized for high signal-to-noise, explicit provenance, low user interruption, and safe partial continuation.
