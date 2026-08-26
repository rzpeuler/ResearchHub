# RESEARCHHUB_KNOWLEDGE_ID_NAMING_CONVENTION_V0.1

## Status

**Architecture Freeze — Preserved Current Contract**

## Core Rule

```text
{namespace}:{slug}
```

ID is a stable machine identifier, not a display name.

## Slug Rules

- lowercase
- ASCII
- kebab-case
- no Chinese characters
- no spaces or underscores
- ID does not change when display name changes

## Namespaces

```text
industry
segment
company
product
technology
relation
fact
forecast
viewpoint
trend
risk
source
module
view
```

## v0.2 Architecture Clarification

- Knowledge IDs need only be unique inside one Knowledge Base.
- Internal KB refs use full Knowledge IDs.
- External refs use `knowledgeBaseId + knowledgeItemId`.
- `rawRef` is not a Knowledge Object ID and is governed by Storage / Provenance rules.
