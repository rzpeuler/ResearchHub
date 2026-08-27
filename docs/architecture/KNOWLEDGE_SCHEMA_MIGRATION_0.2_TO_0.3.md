# KNOWLEDGE_SCHEMA_MIGRATION_0.2_TO_0.3

## Status

**Frozen / Sol Accepted**

- Source Schema: `0.2`
- Target Schema: `0.3`
- Storage Format: `1 → 1`
- Migration Type: Breaking Semantic Migration
- Automatic silent migration: Forbidden
- Sol/CTO independently verified commit `47e312f79a221d7dd45b42508e52526fd61b1a74`.
- This frozen migration target is not itself an implementation authorization; runtime migration to v0.3 remains separate and has not started.

## 1. Purpose

Defines explicit migration from v0.2 to v0.3 while preserving old KB readability, Raw evidence, provenance integrity, deterministic failure behavior, and atomic semantic version switch.

Key semantic changes:

```text
v0.2 industry      → v0.3 investment_theme
v0.2 segment       → v0.3 industry
v0.2 Intelligence  → v0.3 Claim
v0.2 operates_in   → v0.3 business_exposure when endpoints permit
```

## Source Inventory

Migration inventory MUST include both legacy auxiliary asset families:

- `taxonomy/` documents and taxonomy items;
- `views/` projection configuration assets.

These assets are preserved outside the canonical semantic object registry. Any
declared canonical references inside them are rewritten only through the
complete `KnowledgeIdMapping` and are covered by auxiliary-reference
integrity validation.

## 2. Compatibility Policy

### 0.3 / Storage 1
- readable = true
- writable = true when KB status permits

### 0.2 / Storage 1
- readable through legacy compatibility
- not writable by v0.3 semantic writer
- migrationAvailable = true

Mixed v0.2/v0.3 canonical semantic state is forbidden. Preserved auxiliary
Taxonomy/View assets, Raw evidence, and historical logs do not constitute
mixed semantic state after declared canonical refs are mapped and validated.

## 3. Migration Categories

### Deterministic
Exactly one safe semantic target → auto-transform.

### Deterministic With Warning
Safe target exists but v0.3 has fields absent in v0.2 → use explicit unknown/null, emit warning, commit permitted.

### Migration Review Required
Multiple plausible semantic targets → MigrationReviewItem, no silent choice, commit blocked.

## 4. LLM Boundary

Migration is deterministic canonical state transformation. LLM MUST NOT silently resolve ambiguity. Future LLM assistance may suggest review resolution but cannot auto-commit it.

## 5. Atomicity / Revision

Migration is all-or-nothing at semantic version-switch level.

Dry-run/review/failure → revision unchanged.
Successful semantic migration → target revision = source revision + 1 exactly once.

## 6. Raw

Raw bytes, hash, Raw identity, filename, and archived evidence remain unchanged.

## 7. Source

Preserve compatible Source fields and legal Source Type values. Invalid custom Source types require explicit mapping or Review; no guessing.

## 8. Durable ID Migration

v0.2 subtype namespaces map to v0.3 object-kind namespaces.

Target canonical IDs MUST use the Schema 0.3 namespaces. The frozen
`RESEARCHHUB_KNOWLEDGE_ID_NAMING_CONVENTION_V0.1.md` remains unchanged and
applies only to Schema `<= 0.2`.

Migration MUST build explicit KnowledgeIdMapping. Old durable ID MAY serve as a
stable deterministic migration seed, but it does not override the target
object-kind namespace.

Allocate the complete target ID map before rewriting any declared canonical refs.

Target ID collision MUST block or require Review; never append random suffixes silently.

## 9. Entity Mapping

### old industry → investment_theme
Deterministic.

Assign fallback ThemeGroup `Unclassified / 未分类` if no deterministic ThemeGroup exists. Warning, not Review.

Migrated Theme may have incomplete definition/criteria while remaining schema-valid.

### old segment → industry
Deterministic.

### company/product/technology
Semantic subtype preserved; durable ID remapped according to object-kind namespace strategy.

## 10. Intelligence → Claim

Deterministic type mapping:

```text
fact      → claimType=fact
forecast  → claimType=forecast
viewpoint → claimType=viewpoint
trend     → claimType=trend
risk      → claimType=risk
```

`entityRefs → subjectRefs` through complete ID map.

## 11. Claim Statement

Use deterministic precedence only from frozen legacy semantic text fields.

If no unambiguous statement source exists → MigrationReviewItem.

LLM MUST NOT synthesize a new statement automatically during canonical migration.

## 12. Claim Temporal / StructuredValue / Provenance

Only migrate explicitly represented semantics.

Do not invent dates, quantitative values, or page/chunk provenance.

Legacy sourceRefs remain valid even if precise v0.3 provenance is unavailable.

## 13. contains

- old industry contains old segment → after type mapping, deterministic `theme_exposure`
- Product contains Product → default Review unless legacy semantics prove `component_of`
- all other combinations → Review by default

## 14. operates_in

Company → old segment → deterministic `business_exposure` with:

```yaml
exposureBasis: unknown
realizationStage: unknown
materiality: unknown
financialContribution: null
asOf: null
```

Emit warnings.

If target old industry becomes InvestmentTheme → Review; do NOT turn Theme association into Industry Business Exposure.

## 15. upstream/downstream

Valid Industry→Industry `upstream_of` preserved.

`A downstream_of B` → `B upstream_of A`, then dedupe.

Conflicting attributes → Review.

## 16. supplier/customer

Valid Company→Company `supplier_of` preserved.

`B customer_of A` → `A supplier_of B`, then dedupe.

Illegal endpoints → Review.

## 17. competes_with

Valid Company↔Company preserved, symmetric endpoint ordering normalized, reverse duplicates deduped.

## 18. substitute_for

Rename to `substitutes_for` only for valid Product↔Product or Technology↔Technology endpoints. Normalize symmetry. Other endpoints → Review.

## 19. depends_on

Preserve only when endpoints satisfy v0.3 Industry/Product/Technology rule. Company→Company depends_on → Review.

## 20. owns_stake_in

Company→Company preserved. ownershipPct/controlType migrate when explicit; otherwise null/unknown.

## 21. invested_in

Do NOT automatically map historical investment event to current ownership.

If current ownership is deterministically proven → owns_stake_in.
Otherwise → Review.

## 22. partner_of

Default → Review.

Do not automatically map to supplier_of, JV, strategic cooperation, or Claim without deterministic legacy semantics.

## 23. New v0.3 Relations

Do NOT create offers_product/develops_technology/uses_technology/applied_in/belongs_to_industry/component_of merely because they seem plausible. Migration transforms existing semantics only.

## 24. Module

Declared canonical reference fields use ID map. Opaque nested strings are not heuristically rewritten. Unresolved declared refs → Review/block.

## 24A. Legacy Taxonomy Asset Migration

Legacy taxonomy documents and item identities are preserved as auxiliary
Reference Taxonomy Assets. Entity `taxonomyRefs` are preserved when their
target taxonomy items resolve. Taxonomy fields that explicitly declare
canonical Knowledge refs, such as `graphRefs`, MUST be rewritten through the
complete `KnowledgeIdMapping`.

An unresolved declared canonical ref produces a `MigrationReviewItem` and
blocks migration commit. Taxonomy is never automatically converted to
ThemeGroup, and opaque strings are never heuristically rewritten.

## 24B. Legacy View Asset Migration

Legacy `views/*.yaml` are preserved as auxiliary Projection Configuration
Assets. Their document identity and configuration semantics remain intact.
Explicit canonical refs, such as `targetEntity`, MUST be rewritten through
the complete `KnowledgeIdMapping`; unresolved refs produce a blocking
`MigrationReviewItem`.

View is never automatically converted to Module, and opaque strings are never
heuristically rewritten.

## 25. Lifecycle / Metadata

Preserve compatible lifecycle states and safe metadata. Do not promote arbitrary metadata into new canonical top-level fields without explicit rule.

## 26. Warning vs Review

Warnings permit commit and represent deterministic but incomplete migration.

Suggested warning codes:
- theme_group_unclassified
- business_exposure_basis_unknown
- business_exposure_stage_unknown
- business_exposure_materiality_unknown
- legacy_claim_precise_provenance_missing
- legacy_optional_semantics_incomplete

Reviews block migration commit.

Suggested review codes:
- ambiguous_contains_semantics
- operates_in_theme_target
- invalid_legacy_relation_endpoints
- ambiguous_partner_relation
- ambiguous_investment_state
- claim_statement_missing
- target_id_collision
- opaque_module_reference_unresolved
- unsupported_custom_legacy_type

## 27. Execution Order

```text
[1] Mount Source KB
[2] Verify source schema/storage/revision
[3] Validate source state
[4] Build inventory
[4A] Inventory and preserve legacy Reference Taxonomy assets
[4B] Inventory and preserve legacy Projection Configuration assets
[5] Create staging target
[6] Create/resolve fallback ThemeGroup
[7] Allocate all target durable IDs
[8] Transform Entities
[9] Transform Claims
[10] Transform Sources
[11] Transform Modules
[12] Transform Relations
[13] Rewrite declared canonical refs in canonical and auxiliary assets
[14] Normalize inverse/symmetric Relations
[15] Deduplicate canonical Relations
[16] Rebuild Registry
[16A] Validate auxiliary-reference integrity
[17] Collect warnings
[18] Collect MigrationReviewItems
[19] If blocking review exists: no switch
[20] Full v0.3 validation
[21] Commit mode: lock + verify source revision unchanged
[22] Atomic switch
[23] revision + 1 exactly once
[24] append migration log
```

## 28. Dry-Run

Dry-run performs full staging transformation/validation but no source mutation, target switch, revision increment, Raw mutation, or silent review resolution.

## 29. Frozen Decisions

Breaking semantic migration, explicit compatibility, deterministic/warning/review matrix, Raw preservation, complete ID map before ref rewrite, legacy Taxonomy/View preservation and reference coverage, no invented semantic fields, endpoint-aware Relation migration, no silent LLM migration decisions, and Storage Format 1 preservation are frozen. This document is Frozen / Sol Accepted; implementation status is governed separately.
