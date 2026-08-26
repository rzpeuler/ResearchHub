# RESEARCHHUB_KNOWLEDGE_BASE_INSTANCE_ARCHITECTURE_V0.1

## Status

**Architecture Freeze**

- Version: v0.1
- Date: 2026-08-26
- Depends on: `RESEARCHHUB_KNOWLEDGE_ARCHITECTURE_V0.2.md`

## 1. Definition

A Knowledge Base Instance is an independent user data unit conforming to a declared Knowledge Schema Version.

It contains data and provenance, not ResearchHub executable code.

## 2. Instance Identity

Each KB has a stable `knowledgeBaseId`. Display `name` may change without changing identity.

Knowledge item IDs need only be unique **inside one KB**. External references use the pair:

```yaml
knowledgeRef:
  knowledgeBaseId: kb-ai-hardware-main
  knowledgeItemId: company:nvidia
```

## 3. Manifest

Minimum contract:

```yaml
knowledgeBaseId: kb-ai-hardware-main
name: AI Hardware Research

schemaVersion: "0.2"
storageFormatVersion: "1"

revision: 0

status: active

createdAt: "..."
updatedAt: "..."
```

### Status

- `active`: read + write + ingest + migrate
- `readonly`: read + inspect + validate; no canonical mutation
- `archived`: retained but excluded from default selection; explicit read allowed

## 4. Runtime Data Root

```text
<ResearchHub Data Root>/
└── knowledge-bases/
    ├── <kb-id>/
    └── ...
```

Absolute paths are deployment configuration. Workflow and Skill code must not hard-code them.

## 5. KnowledgeBaseHandle

Runtime operations use a stable handle rather than filesystem paths.

Logical fields include:

```yaml
knowledgeBaseId: string
rootRef: storage locator
schemaVersion: string
storageFormatVersion: string
revision: integer
status: active | readonly | archived
compatibility: compatible | read_only_compatible
```

## 6. Mount and Load

Mount flow:

```text
Locate KB
→ Read Manifest
→ Validate Manifest
→ Check KB identity
→ Check schemaVersion
→ Check storageFormatVersion
→ Check runtime compatibility
→ Create KnowledgeBaseHandle
→ Register mounted handle
```

Mount never silently migrates user data.

Load flow:

```text
KnowledgeBaseHandle
→ Registry-backed Loader
→ Schema Adapter
→ Runtime Knowledge Model / Index
```

## 7. KB Registry

A lightweight runtime registry indexes mounted `KnowledgeBaseHandle` values. It is not a new architecture layer and does not own user Knowledge.

## 8. Explicit Scope

Every Knowledge operation must resolve to one explicit KB.

No API may silently select "the first mounted KB". A configured default KB is only a convenience that must resolve to a concrete handle before use.

## 9. Multi-KB Isolation

Default rules:

- no cross-KB durable references
- no automatic cross-KB merge
- no automatic cross-KB search
- no automatic cross-KB conflict resolution
- one ingestion run has one write target KB

Cross-KB comparison or aggregation requires an explicit Workflow.

## 10. Raw Ownership

Raw materials belong to the KB that ingested them. Raw is immutable and may be reused by content hash.

A KB can therefore be archived, moved, exported, or backed up with its own provenance intact.

## 11. Source Ownership

Sources are KB-scoped. v0.1 does not introduce a global cross-user Source database.

## 12. Portability

A complete KB must be movable between compatible environments.

Internal references use logical IDs. Storage references are KB-relative or backend-neutral locators. Absolute machine-specific paths are forbidden in durable business references.

## 13. Schema and Storage Versions

`schemaVersion` and `storageFormatVersion` are distinct. Runtime must select the appropriate reader/writer/adapter based on the Manifest.

## 14. Read / Write Consistency

Multiple readers are allowed. Canonical mutation must prevent inconsistent concurrent writes. A filesystem implementation may use single-writer locking.

Readers must observe a coherent KB revision, never a partially committed intermediate state.

## 15. Revision

`revision` is a monotonic semantic-state token.

It increments after successful canonical Knowledge mutation or Schema migration. It does not increment for reads, dry-runs, failed writes, or Raw-only archival.

## 16. Logs

```text
logs/
├── ingestion/
└── migrations/
```

Logs are append-oriented audit records and do not serve as full object-version storage.

## 17. Archive, Clone, Export

`archived` is not deletion.

Clone / Export / Import are future capabilities; the v0.1 contract only requires that the KB be self-contained enough to support them later.

## 18. Non-Goals

No global Knowledge service, distributed transaction system, cross-KB relation model, Graph DB, Vector DB, RAG, autonomous updater, or automatic schema evolution is introduced.

## 19. Frozen Decision

Knowledge Base is an independently durable user data instance. ResearchHub operates it through explicit runtime handles and stable infrastructure contracts.
