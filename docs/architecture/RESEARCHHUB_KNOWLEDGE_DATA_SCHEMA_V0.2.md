# RESEARCHHUB_KNOWLEDGE_DATA_SCHEMA_V0.2

## Status

**Architecture Freeze**

- Version: v0.2
- Date: 2026-08-26
- Supersedes: `RESEARCHHUB_KNOWLEDGE_DATA_SCHEMA_V0.1.md`
- Compatibility: additive / backward-compatible extension.

## 1. Purpose

v0.2 preserves the v0.1 semantic model while adding first-class Raw provenance required by independent Knowledge Base ingestion.

## 2. Core Model

- Entity = object identity and stable attributes
- Relation = structured relationship
- Intelligence = structured research understanding
- Module = domain-specific extension
- Source = Knowledge provenance source
- Registry = organization/index
- Raw = immutable source-evidence asset outside the normal Knowledge Object semantic model

## 3. Global Metadata

Knowledge Objects may include:

```yaml
id: string
type: string
createdAt: datetime
updatedAt: datetime

sourceRefs: [source-id]
confidence: number | object

lifecycle:
  status: active | expired | superseded | archived
  validFrom: datetime | null
  validUntil: datetime | null

supersedes: [knowledge-id]
supersededBy: [knowledge-id]
```

Supersession fields are optional compatible metadata.

## 4. Entity

Entity types remain:

- industry
- segment
- company
- product
- technology

Dynamic forecasts, viewpoints, and research judgments do not belong in Entity.

## 5. Relation

Relation preserves `source`, `target`, attributes, confidence, `sourceRefs`, and lifecycle.

## 6. Intelligence

Types remain:

- fact
- forecast
- viewpoint
- trend
- risk

Quantitative Fact fields such as metric/value/unit/period may be added as optional compatible structure.

## 7. Module

Modules remain flexible domain-specific extensions. Comparison modules may retain dynamic columns and rows.

## 8. Source v0.2

```yaml
id: string
type: string

title: string
publisher: string | null
institution: string | null
author: string | null
publishedAt: datetime | null
url: string | null

sourceType:
  official_disclosure
  company_official
  sell_side_research
  industry_database
  professional_media
  general_media
  community
  unknown

quality: string | number | object | null

sourceReliability:
  high
  medium
  low
  unknown

rawRefs:
  - raw-ref

metadata: object | null
lifecycle: object | null
```

`rawRefs` is optional at base Schema level for backward compatibility. The Research Report Ingestion Workflow requires Raw-backed Sources when Raw archival exists.

## 9. KB Scope

`knowledgeBaseId` is not duplicated into every object. IDs and internal refs are resolved inside the enclosing KB.

References leaving a KB use `knowledgeBaseId + knowledgeItemId`.

## 10. Version Strategy

v0.2 is designed as a backward-compatible extension. Existing v0.1 objects remain representable without forced immediate physical rewrite.

## 11. Frozen Decision

Data Schema v0.2 makes Source-to-Raw provenance explicit while preserving the existing Entity / Relation / Intelligence / Module model.
