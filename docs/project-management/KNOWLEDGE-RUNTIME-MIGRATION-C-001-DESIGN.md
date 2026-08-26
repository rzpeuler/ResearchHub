# Knowledge Runtime Migration Phase C Design

**Task ID:** `KNOWLEDGE-RUNTIME-MIGRATION-C-001`
**Date:** 2026-08-26
**Status:** Design approved in discussion; implementation pending document review

## 1. Objective

Phase C adds durable, runtime-neutral mutation infrastructure to the existing Knowledge Base read path. It makes raw source archives immutable, validates write intent before mutation, applies a small set of deterministic Knowledge operations, and refreshes mounted handles only after a coherent commit.

This phase validates the runtime contract. It does not create a Knowledge Database, Graph Database, Vector Database, RAG pipeline, LLM extraction path, or a new architecture layer.

## 2. Existing read architecture

The current read path remains the source of truth for reads:

```text
Knowledge Base on disk
        |
        v
KnowledgeBaseLoader -> mounted handle / memory index
        |
        v
Knowledge Access Skill
```

Phase C adds a write path beside the loader and access skill:

```text
Raw input -> Raw Archive -> ChangeSet validation receipt -> Knowledge Writer
                                                    |
                                                    v
                                          atomic Knowledge Base commit
                                                    |
                                                    v
                                         Registry handle refresh
```

The writer and raw archive are shared runtime infrastructure. They must not import Workflow, DSH, Curation, or a Knowledge Skill implementation.

## 3. Scope and boundaries

### Allowed implementation areas

- `packages/shared/knowledge-base/**`
- `packages/schemas/knowledge/**` only for write/raw contract types
- `packages/skills/knowledge-validation/**`
- `packages/skills/knowledge-access/**` only for minimal snapshot or handle refresh compatibility
- `tests/knowledge/**`
- `package.json`
- `README.md`
- `docs/project-management/**`

### Explicitly unchanged

- `dsh/**`
- `packages/workflows/**`
- `packages/plugins/**`
- `packages/skills/knowledge-curation/**`
- `research-output/**`
- `docs/architecture/**`

No new architecture layer is introduced. Workflow remains responsible for business orchestration, Skills remain the access and validation boundary, and Plugin remains the external data connection boundary.

## 4. Raw Archive contract

### 4.1 Content identity

Raw content identity is the SHA-256 digest of the exact byte sequence:

```text
contentHash = sha256:<64 lowercase hexadecimal characters>
rawRef      = raw-sha256-<64 lowercase hexadecimal characters>
```

The digest is computed before persistence. `rawRef` is derived only from the digest and is safe for use as a directory name. A filename is metadata and never participates in identity.

### 4.2 On-disk bundle

The archive is stored below the shared Knowledge Base raw root:

```text
packages/shared/knowledge-base/raw/
  raw-sha256-<digest>/
    manifest.yaml
    original.<safe-extension>
```

`manifest.yaml` records at least:

- `rawRef`
- `contentHash`
- original filename and safe extension
- content type when known
- byte length
- source URI or source label when supplied
- captured-at timestamp when supplied
- created-at timestamp
- schema version of the raw manifest

The original bytes are immutable. A second ingest of identical bytes reuses the existing `rawRef`; the archive must not create another copy. The same filename with different bytes creates a different `rawRef`.

### 4.3 Raw API and safety

The runtime exposes operations equivalent to:

- `putRaw(input)` - hash, validate metadata, and persist or reuse a bundle
- `getRaw(rawRef)` - read manifest and expose the original path/metadata
- `readRaw(rawRef)` - read exact bytes
- `verifyRaw(rawRef)` - re-hash persisted bytes and compare to manifest

`rawRef` is accepted only when it matches the safe `raw-sha256-<64 lowercase hex>` grammar. Resolved paths must remain under the configured raw root. No caller-supplied path, filename, or extension may escape that root.

Raw-only writes do not change a Knowledge Base manifest revision or `updatedAt`. They are provenance preparation, not semantic Knowledge mutation.

## 5. Canonicalization and semantic identity

Knowledge objects are serialized by a deterministic canonical serializer before hashing. The serializer recursively sorts object keys, preserves array order, uses stable JSON-compatible scalar encoding, and emits UTF-8 without incidental whitespace. Undefined object properties are not emitted; unsupported values are rejected.

`hashKnowledgeObject(value)` returns a SHA-256 semantic identity in the same `sha256:<hex>` format. The hash is used for target guards, idempotency comparisons, and audit records. It is distinct from the raw byte hash: changing source bytes can preserve or change semantic identity independently.

## 6. ChangeSet contract

A ChangeSet is the validated unit of semantic mutation. It contains:

- `changeSetId`
- `workflowRunId`
- `knowledgeBaseId`
- `schemaVersion`
- `expectedBaseRevision`
- `requiresRawProvenance`
- `sourceOperations`
- `knowledgeOperations`
- `ingestionContext`

Every operation has a stable operation ID. Source operations support:

- `source_create`
- `source_merge`

Knowledge operations support:

- `create`
- `update`
- `supersede`
- `merge_source`

The contract explicitly excludes taxonomy and view writes in Phase C. It also excludes hard delete, automatic migration, conflict reasoning, and Schema Gap reasoning.

When `requiresRawProvenance` is true, all affected source operations must reference verified raw bundles. A source merge must identify its source identity and target semantics sufficiently for deterministic replay.

## 7. Validation receipt

`KnowledgeValidationSkill.validateChangeSet(handle, changeSet)` validates the ChangeSet against the mounted Knowledge Base and its on-disk manifest. Validation covers:

- schema and required-field rules
- operation shape and supported operation names
- Knowledge Base ID and schema compatibility
- base revision guard
- entity/relation/source references
- target semantic hash guards
- raw provenance requirements
- lifecycle constraints for create, update, supersede, and merge operations

On success it returns an immutable `ValidatedChangeSet` receipt containing:

- Knowledge Base ID
- schema version
- current base revision
- ChangeSet ID
- canonical ChangeSet hash
- validation timestamp

The writer accepts a receipt, not a bare boolean. Before mutation it recomputes the ChangeSet hash and verifies the receipt matches the supplied ChangeSet, Knowledge Base, schema, and base revision. A forged, stale, or mismatched receipt is rejected without mutation.

## 8. Writable compatibility matrix

Only the active writable contract is mutable:

| Schema | Storage | Runtime behavior |
|---|---:|---|
| 0.2 | 1 | writable when manifest is active and compatibility checks pass |
| 0.1 | 1 | read-only compatible; never writable |
| any | unsupported | rejected for mutation |
| any | archived/read-only status | readable according to existing policy; never writable |

The compatibility decision is centralized in the existing shared compatibility module. Phase C does not add a parallel compatibility policy.

## 9. Transaction and recovery model

### 9.1 Per-Knowledge-Base serialization

Writes are serialized per Knowledge Base using a lock scoped to the resolved Knowledge Base root. Different Knowledge Bases can write independently. The lock is acquired before reloading the manifest and released after commit or recovery cleanup.

### 9.2 Fresh revision and target checks

Under the lock, the writer reloads the manifest from disk. It rejects a ChangeSet when `expectedBaseRevision` does not match the fresh revision. For update, supersede, merge, and source-merge operations, it also checks each expected target semantic hash against freshly loaded data. Rejection occurs before the destination becomes visible and must leave all existing assets unchanged.

### 9.3 Staging and atomic visibility

The writer builds the complete next state in a sibling staging directory, validates the staged state, writes the next manifest and append-only operation log, and then switches the staged state into place using an atomic filesystem operation supported by the host. The old state remains recoverable until the switch succeeds.

A recovery marker records the transaction ID, Knowledge Base ID, old revision, next revision, staging path, and intended destination. Startup or the next writer invocation detects incomplete markers and either completes a verified switch or restores the last coherent state. The read path must never observe a mixture of old and new asset files.

Semantic writes increment the manifest revision once per committed ChangeSet and update `updatedAt` once. Raw-only writes do neither.

## 10. Idempotency and operation log

The operation log persists the ChangeSet ID, canonical ChangeSet hash, workflow run ID, base and resulting revisions, commit timestamp, and final status. Reapplying an already committed identical ChangeSet returns an idempotent success with the original result and performs no second semantic mutation. Reusing a ChangeSet ID with a different hash is rejected. Failed or recovered transactions have explicit statuses and do not masquerade as committed.

## 11. Handle visibility

The registry refreshes the mounted handle only after a successful atomic commit. A handle or Access Skill snapshot obtained before commit remains unchanged. A newly resolved handle sees revision N+1 and the committed assets. Refresh must not mutate the old snapshot in place or expose staged paths.

## 12. Verification plan

Tests use temporary Knowledge Base copies or minimal fixtures. The Example AI Hardware Knowledge Base is never mutated by tests.

Required coverage:

1. Raw hash identity, deduplication, same-name/different-content behavior, byte verification, and traversal rejection.
2. Canonical serialization stability and semantic hash behavior.
3. ChangeSet validation pass/fail cases and immutable receipt mismatch rejection.
4. Create, update, supersede, source-create, source-merge, and merge-source writes.
5. Unsupported schema/status rejection and stale revision/target-hash rejection with no mutation.
6. Per-Knowledge-Base serialization and independent writes across two temporary bases.
7. Atomic visibility, recovery marker handling, operation log status, and idempotent replay.
8. Old handle snapshot versus refreshed handle visibility after commit.
9. Dependency-boundary checks proving shared runtime code has zero imports from Skills, Workflow, DSH, or Curation.
10. Default network-free `npm test` and focused Knowledge tests.

## 13. Governance synchronization after implementation

After tests pass, update only the permitted governance files to record:

- Phase B accepted and Sol verification complete.
- Phase C implemented and pending review/verification as appropriate.
- Phase D and E remain planned/pending.
- the durable raw/change-set/writer contract is infrastructure, not a new architecture layer.

The implementation commit should use:

```text
KNOWLEDGE: implement durable Knowledge Base mutation infrastructure
```

and be pushed to `origin/main` only after the implementation and validation loop is complete.
