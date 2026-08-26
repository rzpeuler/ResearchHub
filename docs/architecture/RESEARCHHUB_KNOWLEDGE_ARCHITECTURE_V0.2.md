# RESEARCHHUB_KNOWLEDGE_ARCHITECTURE_V0.2

## Status

**Architecture Freeze**

- Version: v0.2
- Date: 2026-08-26
- Supersedes: `RESEARCHHUB_KNOWLEDGE_ARCHITECTURE_V0.1.md` for ownership, deployment, instance lifecycle, and runtime-data boundaries.
- Preserves: v0.1 Knowledge semantic concepts unless explicitly superseded.

## 1. Purpose

Knowledge Architecture v0.2 separates **Knowledge Definition / Infrastructure** from **Knowledge Base Instance data**.

ResearchHub owns the code and contracts that understand Knowledge. Users own independent Knowledge Base instances containing their actual research knowledge and source material.

## 2. Core Definition

A **Knowledge Base Instance** is an independently persistent, mountable, readable, writable, validatable, migratable user knowledge dataset conforming to a declared Knowledge Schema Version.

Knowledge is no longer defined as a single repository-root `knowledge/` directory.

## 3. Source vs Runtime Data

```text
ResearchHub Source Repository
├── dsh/
├── packages/
│   ├── workflows/
│   ├── skills/
│   ├── plugins/
│   ├── schemas/
│   │   └── knowledge/
│   └── shared/
├── tests/
├── examples/
├── docs/
└── tools/

ResearchHub Runtime Data
├── knowledge-bases/
│   ├── <kb-id>/
│   └── ...
└── research-output/
```

Git manages ResearchHub source code, schemas, migrations, tests, examples, and governance. Real user Knowledge Bases are runtime data and are not source-repository assets by default.

## 4. Knowledge Base Semantics

The v0.1 semantic model remains valid:

- Taxonomy
- Entity
- Relation
- Intelligence
  - Fact
  - Forecast
  - Viewpoint
  - Trend
  - Risk
- Module
- Source
- View
- Registry

The architecture change is primarily about ownership, deployment, instance isolation, lifecycle, and versioning—not a semantic-model rewrite.

## 5. Multi-KB Model

ResearchHub supports multiple independent Knowledge Bases:

```text
ResearchHub Runtime
├── KB-A
├── KB-B
└── KB-C
```

Different KBs may contain different facts, sources, forecasts, viewpoints, taxonomies, update histories, and temporarily different Schema Versions.

No automatic cross-KB merge or federation is implied.

## 6. Knowledge Base Manifest

Every Knowledge Base has a canonical `manifest.yaml` containing at least:

```yaml
knowledgeBaseId: string
name: string

schemaVersion: string
storageFormatVersion: string

revision: integer

status:
  active
  readonly
  archived

createdAt: datetime
updatedAt: datetime
```

`schemaVersion` describes Knowledge business structure. `storageFormatVersion` describes physical persistence format. They evolve independently.

## 7. Runtime Access

Runtime access is explicitly scoped:

```text
ResearchManager / Workflow
        ↓
KnowledgeBaseHandle
        ↓
Knowledge Infrastructure
        ↓
Knowledge Base Instance
```

There is no implicit global Knowledge directory.

## 8. Knowledge Lifecycle

A Knowledge Base may be:

- created
- mounted / unmounted
- loaded
- read
- ingested
- updated
- superseded
- validated
- migrated
- archived
- inspected

A Knowledge Base is **not an Agent**. These operations are executed by Workflows, Skills, and deterministic infrastructure.

## 9. Raw Research Material

Research Reports used for ingestion belong to the target Knowledge Base as immutable source evidence.

```text
KB/
└── raw/
```

Raw material is preserved byte-for-byte, hash verified, deduplicatable, and normally unaffected by Knowledge Schema migration.

## 10. Provenance

The canonical provenance chain is:

```text
Knowledge Object
      ↓
Source
      ↓
Raw Report
```

Knowledge ingestion must preserve this chain whenever durable Knowledge is created from user-supplied source material.

## 11. Schema Evolution

Each KB declares its own Schema Version. A new Schema release must not automatically invalidate older KBs.

Runtime compatibility may include:

- compatible
- read-only compatible
- migration available
- unsupported

Breaking changes require explicit Migration design.

## 12. Migration

Migration is versioned deterministic infrastructure where possible. It must support:

- dry-run
- staging
- target-schema validation
- reference validation
- provenance validation
- invariants
- atomic commit
- safe failure / rollback behavior
- migration logs

Semantic reinterpretation that cannot be deterministic creates review items and cannot be silently committed by an LLM.

## 13. Git Boundary

Git manages:

- DSH
- Workflows
- Skills
- Plugins
- Knowledge Schemas
- Migration code
- Validation
- Loader / Adapter / Write infrastructure
- tests
- example Knowledge Bases
- architecture and governance documents

Git does not manage real user Raw Reports, real user Knowledge, or real user ingestion/migration logs by default.

## 14. Existing AI Hardware Dataset

The current repository-level AI Hardware Knowledge dataset is reclassified as a **production-like Example Knowledge Base** and should move to:

```text
examples/knowledge-bases/ai-hardware/
```

Focused deterministic fixtures remain under `tests/knowledge/fixtures/`.

## 15. Non-Goals

v0.2 does not introduce:

- Multi-Agent architecture
- Agent Planner
- Workflow Engine
- Knowledge Agent
- Graph Database by default
- Vector Database by default
- RAG by default
- autonomous schema modification
- background autonomous Knowledge formation
- automatic semantic migration

## 16. Frozen Decision

Knowledge Architecture v0.2 is the normative Knowledge architecture. Repository-root `knowledge/` is no longer the production Knowledge boundary. ResearchHub owns Knowledge capabilities and contracts; users own independent Knowledge Base instances.
