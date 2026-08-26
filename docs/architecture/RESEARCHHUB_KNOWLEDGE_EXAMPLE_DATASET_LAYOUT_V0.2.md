# RESEARCHHUB_KNOWLEDGE_EXAMPLE_DATASET_LAYOUT_V0.2

## Status

**Architecture Freeze**

- Version: v0.2
- Date: 2026-08-26
- Supersedes: v0.1 for the location of the full AI Hardware example.
- Preserves: focused deterministic fixtures under `tests/knowledge/fixtures/`.

## 1. Purpose

Separate a production-like Example Knowledge Base from focused test fixtures.

## 2. Production-like Example

Location:

```text
examples/knowledge-bases/ai-hardware/
```

The example must obey the same KB contract as user data and include `manifest.yaml`, canonical Knowledge directories, Registry, and logs directories.

## 3. Manifest

Example KB:

```yaml
knowledgeBaseId: example-ai-hardware
name: AI Hardware Example Knowledge Base
schemaVersion: "0.2"
storageFormatVersion: "1"
revision: integer
status: active
createdAt: datetime
updatedAt: datetime
```

## 4. Raw Policy

Raw may be empty when licensing or repository-size policy prevents bundling original documents.

Tests for Raw ingestion should use synthetic or redistributable material.

## 5. Focused Test Fixtures

Keep:

```text
tests/knowledge/fixtures/
```

for minimal valid KBs, invalid refs, invalid relations, invalid lifecycle, Registry corruption, Raw provenance, Schema compatibility, and Migration fixtures.

## 6. Loading

Production-like example uses normal `KnowledgeBaseHandle → Loader → Adapter` runtime path.

## 7. Frozen Decision

The full AI Hardware dataset is an Example KB under `examples/knowledge-bases/`; tests retain focused deterministic fixtures.
