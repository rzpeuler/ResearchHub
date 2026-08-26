# RESEARCHHUB_KNOWLEDGE_WRITE_INTERFACE_V0.1

## Status

**Architecture Freeze**

- Version: v0.1
- Date: 2026-08-26

## 1. Principle

Research reasoning proposes what should be written. Validation determines eligibility. The Write Interface persists the validated plan safely and deterministically.

## 2. Responsibilities

- canonical ID allocation / confirmation
- precondition checks
- Source create / merge
- Knowledge create / update / supersede / merge_source
- deterministic serialization
- staging
- Registry next state
- hashing
- mutation ingestion log
- Manifest revision / updatedAt
- atomic visibility
- idempotent retries
- write result

## 3. Revision Guard

`manifest.revision` is a monotonic semantic-state token.

Before commit:

```text
expectedBaseRevision == current manifest.revision
```

Mismatch returns `stale_base_revision`.

## 4. Target Hash Guard

Update / supersede / merge-source operations should carry `expectedBeforeHash`.

Mismatch returns `stale_target_state`.

## 5. Single Writer

One canonical writer commit per KB at a time. Different KBs may write concurrently.

Readers see revision N or N+1, never a partial mix.

## 6. Schema Guard

ValidatedChangeSet Schema Version must equal the target KB Schema Version.

Writer does not migrate or invent compatibility fields.

## 7. Provenance Preconditions

Before durable Knowledge commit:

- Raw exists
- Sources exist or are created in same ChangeSet
- Source Raw refs are valid where required
- all refs resolve in the same KB

## 8. IDs

Canonical IDs are finalized deterministically by infrastructure.

Collision must raise an explicit error; arbitrary rename is forbidden.

## 9. Operations

Source:
- source_create
- source_merge

Knowledge:
- create
- update
- supersede
- merge_source

Hard delete is out of scope.

## 10. Write Pipeline

```text
Receive request
→ acquire KB write lock
→ reload Manifest
→ check revision/schema/status
→ verify Raw/refs/hashes
→ allocate IDs
→ build staged next state
→ apply Source changes
→ apply Knowledge changes
→ build Registry next state
→ generate hashes/log
→ validate staged state
→ atomic commit
→ revision + 1 / updatedAt
→ refresh runtime index
→ release lock
→ WriteResult
```

## 11. Staging / Crash Safety

Mutation happens in an invisible staged next state. Recovery must identify either the old or new committed state after crashes.

## 12. Zero-Change / Raw-Only

Raw archival alone does not increment semantic KB revision.

Zero Knowledge change + log only does not increment semantic revision.

## 13. Idempotency

`knowledgeBaseId + changeSetId` is the semantic commit idempotency key.

Retry after success returns `already_committed`. Same key with different payload is `idempotency_conflict`.

## 14. Errors

At least:

- knowledge_base_not_writable
- schema_version_mismatch
- stale_base_revision
- stale_target_state
- invalid_change_set
- validation_required
- missing_raw_provenance
- missing_source_reference
- id_conflict
- reference_integrity_error
- registry_conflict
- write_lock_failed
- staging_failed
- commit_failed
- recovery_required
- idempotency_conflict

## 15. Non-Goals

No hard delete, cross-KB transaction, Git, backup service, Schema migration, research reasoning, LLM repair, or background writer.

## 16. Frozen Decision

The Write Interface is the deterministic bridge from validated Workflow decisions to coherent durable Knowledge Base mutation.
