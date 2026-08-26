# RESEARCHHUB_KNOWLEDGE_STORAGE_LAYOUT_V0.2

## Status

**Architecture Freeze**

- Version: v0.2
- Date: 2026-08-26
- Supersedes: `RESEARCHHUB_KNOWLEDGE_STORAGE_LAYOUT_V0.1.md`

## 1. Scope

This document defines the portable storage contract of **one Knowledge Base Instance**. It does not define the ResearchHub source-repository root.

## 2. Storage Format v1

```text
<kb-root>/
├── manifest.yaml
├── raw/
├── taxonomy/
├── entities/
│   ├── industries/
│   ├── segments/
│   ├── companies/
│   ├── products/
│   └── technologies/
├── relations/
├── intelligence/
│   ├── facts/
│   ├── forecasts/
│   ├── viewpoints/
│   ├── trends/
│   └── risks/
├── modules/
├── sources/
├── views/
├── registry/
│   ├── assets.yaml
│   └── raw.yaml
└── logs/
    ├── ingestion/
    └── migrations/
```

## 3. Manifest

`manifest.yaml` is the canonical KB identity and compatibility entrypoint. It stays lightweight and does not store runtime session state, Candidate objects, indexes, locks, or Workflow progress.

## 4. Raw Storage

Recommended logical bundle:

```text
raw/
└── <raw-ref>/
    ├── manifest.yaml
    └── original.<ext>
```

Raw manifest:

```yaml
rawRef: string
originalFilename: string | null
mediaType: string
contentHash: "sha256:..."
sizeBytes: integer
receivedAt: datetime

suppliedMetadata:
  title: string | null
  institution: string | null
  author: string | null
  publishedAt: string | null
  sourceUrl: string | null
```

Raw supports create, reuse, and read. In-place overwrite is forbidden.

## 5. Canonical Knowledge

Structured Knowledge uses YAML by default. Markdown is allowed for necessary long-form durable content. JSON is primarily an export / API / frontend fixture format, not the default canonical Knowledge state.

## 6. Sources and Raw

Source assets are separate from Raw binaries.

Canonical trace:

```text
Knowledge Object
→ sourceRefs[]
→ Source.rawRefs[]
→ Raw asset
```

One Source may reference one or more Raw assets where appropriate.

## 7. Registry

`registry/assets.yaml` maps Knowledge IDs to type and storage reference.

```yaml
company:nvidia:
  type: entity
  storageRef: entities/companies/nvidia.yaml
```

`registry/raw.yaml` maps Raw refs to hash and storage location.

Normal runtime uses Registry as authoritative index. Scan/rebuild is a repair, validation, migration, or development fallback.

## 8. Business vs Storage References

Durable business references use logical IDs.

Only Registry / Storage infrastructure uses `storageRef`. Absolute machine paths are forbidden in durable refs.

## 9. Logs

### Ingestion

```text
logs/ingestion/<workflow-run-id>.yaml
```

The same log records Raw archival, filtering/admission summaries, Source changes, Knowledge changes, review items, and Schema Gaps.

### Migration

```text
logs/migrations/<migration-run-id>.yaml
```

Historical logs are append-oriented and are not rewritten to pretend that old runs used a newer Schema.

## 10. Rejected Information

Admission-rejected content is not stored as durable Candidate assets. The Raw document remains canonical source evidence; logs retain counts and rejection categories.

## 11. Atomic Mutation

Canonical asset, Source, Registry, ingestion-log, and Manifest semantic changes belonging to one validated write are committed as one coherent logical transaction.

Temporary staging, locks, journals, and recovery files are backend details.

## 12. Schema Migration

Schema migration may change canonical Knowledge, Sources, Registry, and Manifest. It normally does not rewrite Raw or historical ingestion logs.

Storage-format migration is distinct from Schema migration.

## 13. Portable KB

Internal IDs and relative/backend-neutral storage refs must allow a KB to move between compatible environments without rewriting business refs.

## 14. Example vs User KB

Production-like examples may live in Git under `examples/knowledge-bases/`.

Real user KBs live under Runtime Data and are not Git-managed source assets by default.

## 15. Non-Goals

No database table design, Graph DB, vector index, object-storage protocol, backup service, global source repository, or distributed locking protocol is frozen here.

## 16. Frozen Decision

Storage Layout v0.2 replaces repository-root `knowledge/` with a portable, self-contained Knowledge Base instance layout.
