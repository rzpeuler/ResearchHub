# Knowledge v0.3 B3 Example Acceptance Report

## Result

B3-R1 result is **Completed / Rework Required**. The exact Git-managed source
was used without repair or normalization. Its Schema 0.2 to 0.3 dry-run now
resolves deterministic compatibility cases into explicit v0.3 values and
warnings, while retaining only the frozen semantic Reviews plus explicit
invalid-value policy Reviews. The exact example
therefore remains `review_required` by design; the independent real Runtime KB
clone passed a zero-Review dry-run and a committed v0.3 validation.

B3-R2 is **Completed / Sol Verification Pending**. It closes the temporal
accounting gap without suppressing newly exposed invalid legacy values.

## B2 closure

- B2 Parent: `b401c949a212599e88228366013ec0dee254b30b` — Accepted - Sol verified
- B2-R1: `268749316f2b4d8ba58441c8885dcf560d0d3e5e` — Accepted - Sol verified
- B2-R2: `b835fac3dabfee029796311c222e744b0a326cdb` — Accepted - Sol verified
- Final B2 verification baseline: `b835fac3dabfee029796311c222e744b0a326cdb`

## Source baseline

Source: `examples/knowledge-bases/ai-hardware/`

- Knowledge Base ID: `example-ai-hardware`
- Schema / Storage: `0.2 / 1`
- Revision / status: `0 / active`
- Source validation: passed
- Files: 86; deterministic tree hash: `8db348ff4cff9c4e6d05d75e7db56eaf1e90dbddfe81b1eb054863d97bcdbece`
- Inventory: 19 entities, 23 relations, 14 intelligence items, 4 modules, 12 sources, 72 canonical registry entries
- Entity types: company 10, industry 1, segment 8
- Relation types: contains 11, depends_on 2, operates_in 10
- Intelligence types: fact 10, forecast 1, risk 1, trend 1, viewpoint 1
- Taxonomy: 2 files, 32 IDs (31 items plus the taxonomy root); views: 2 files
- Raw registry: `{}`; no originals are bundled

The dedicated test records sorted paths, per-file byte lengths/SHA-256 values,
and the aggregate tree hash before and after each isolated operation.

## Dry-run and determinism

Run ID: `b03-ai-hardware-dry-run`; target `0.3 / 1`; expected base revision 0;
mode `dry_run`.

- Status: `review_required`
- Source validation: passed
- Target validation: failed as a consequence of the required semantic Review gate
- Before counts: 19 entities, 23 relations, 14 intelligence, 4 modules, 12 sources
- Projected target counts: 1 ThemeGroup, 19 entities, 20 relations, 14 Claims, 4 modules, 12 sources
- ID mappings: 69 (10 companies, 1 industry, 8 segments, 20 relations, 14 intelligence items to Claims, 4 modules, 12 sources)
- Warnings: 125 (41 lifecycle defaults, 31 legacy metadata preservations, 12
  unknown Source types, 10 category discards, 10 exposure-basis, 10
  materiality, 10 realization-stage, 1 unclassified ThemeGroup fallback)
- Reviews: 15; 11 `ROOT_SEMANTIC_REVIEW`, 2 `DETERMINISTIC_POLICY_RESOLVED`, 2 `DEPENDENT_REFERENCE_BLOCKED`, 0 `UNEXPECTED_REVIEW`
- Compatibility Review noise from lifecycle, Source type, metadata, valid
  temporal fields, affected references, and category is absent from the Review
  set; invalid temporal values remain explicit policy Reviews
- Inferred invariants: `completeCanonicalIdMapping=false` and `declaredCanonicalRefsResolveToTarget=false`; the remaining migration invariants are true
- Source copy remained byte-identical; no live migration log or transaction residue was created

The fresh third-copy repeat with run ID `b03-ai-hardware-dry-run-repeat`
matched the first run’s semantic output after excluding only
`migrationRunId` and `reviewItemId` fields. Normalized semantic output hashes
were both `aebd5323d7781d88a2805e858f4dbb873ad611f42bb1b6be62b0b605c7e0f708`;
semantic equality is `true`.

## Migration Review Report

Every returned review item is classified one-for-one by
`tests/knowledge/migration/b03-example-acceptance.test.ts`. The deterministic
groups are:

| Review code | Count | Role | Affected legacy kind/type | Frozen rule | Classification | Next action |
| --- | ---: | --- | --- | --- | --- | --- |
| `ambiguous_contains_semantics` | 3 | ROOT_SEMANTIC_REVIEW | relation / `contains` | A legacy `contains` relation must map to one frozen v0.3 relation semantics without guessing | ROOT_SEMANTIC_REVIEW | Decide the frozen relation semantics |
| `claim_statement_missing` | 2 | ROOT_SEMANTIC_REVIEW | intelligence / `forecast`, `viewpoint` | Every v0.3 Claim requires a deterministic non-empty statement | ROOT_SEMANTIC_REVIEW | Supply an explicit statement rule or source data |
| `event_impact_requires_decomposition` | 2 | ROOT_SEMANTIC_REVIEW | intelligence / event `fact` | Event impact propositions cannot be losslessly represented as one Claim field | ROOT_SEMANTIC_REVIEW | Decompose impact into explicit Claims |
| `legacy_semantic_field_unmapped` | 4 | ROOT_SEMANTIC_REVIEW | intelligence / `forecast`, `viewpoint`, `trend`, `risk` | Rich multi-value or proposition semantics require an explicit lossless destination | ROOT_SEMANTIC_REVIEW | Define preservation/mapping semantics |
| `legacy_temporal_invalid` | 2 | DETERMINISTIC_POLICY_RESOLVED | intelligence / numeric legacy `period` | Explicit non-string temporal values cannot be safely converted to labels | DETERMINISTIC_POLICY_RESOLVED | Correct legacy temporal values |
| `completeCanonicalIdMapping` | 1 | DEPENDENT_REFERENCE_BLOCKED | migration invariant / 3 unresolved relations | The three root `contains` relations have no target mapping | DEPENDENT_REFERENCE_BLOCKED | Resolve the root relation semantics |
| `declaredCanonicalRefsResolveToTarget` | 1 | DEPENDENT_REFERENCE_BLOCKED | migration invariant / 3 unresolved relation refs | Three declared refs point to the intentionally unresolved relation objects | DEPENDENT_REFERENCE_BLOCKED | Resolve the root relation semantics |

The first four rows are root semantic patterns and account for 11 ReviewItems;
the temporal policy row accounts for 2 explicitly blocking policy Reviews; the
final two rows are deterministic aggregate consequences and account for 2.
The acceptance classifier is policy/evidence based; any unrecognized Review is
classified as `UNEXPECTED_REVIEW` and fails the test. No unexpected Review was
observed.

### Root versus dependent analysis

The 11 root reviews are independent semantic decisions: 3 ambiguous relation
objects, 2 missing Claim statement sources, 2 event impact decompositions, and
4 rich Claim semantic-field observations. The 2 dependent reviews are not
additional semantic decisions; they are aggregate invariants generated after
the root relation ambiguity prevents complete mapping and target reference
closure. Two additional deterministic-policy Reviews expose numeric legacy
`period` values that were previously silently ignored.

### Root review details

- `relation:data-center-contains-liquid-cooling` —
  `relations/supply-chain/data-center-contains-liquid-cooling.yaml`, legacy
  `contains`, endpoints `segment:data-center -> segment:liquid-cooling`;
  no single frozen v0.3 relation target is defined.
- `relation:data-center-contains-server` —
  `relations/supply-chain/data-center-contains-server.yaml`, legacy
  `contains`, endpoints `segment:data-center -> segment:server`;
  no single frozen v0.3 relation target is defined.
- `relation:server-contains-liquid-cooling` —
  `relations/supply-chain/server-contains-liquid-cooling.yaml`, legacy
  `contains`, endpoints `segment:server -> segment:liquid-cooling`;
  no single frozen v0.3 relation target is defined.
- `forecast:data-center-electricity-demand-2030` —
  `intelligence/forecasts/data-center-electricity-demand-2030.yaml`; the
  legacy `forecast` has no deterministic non-empty Claim statement source.
- `viewpoint:ai-hardware-2026` —
  `intelligence/viewpoints/ai-hardware-2026.yaml`; the legacy `viewpoint` has
  no deterministic non-empty Claim statement source.
- The four `legacy_semantic_field_unmapped` reviews retain only the expected rich
  semantic fields; the test records source paths, asset IDs, and field details:
  fields: Forecast `values`/`assumptions`, Viewpoint
  `bullishPoints`/`bearishPoints`/`keyVariables`, Trend `direction`/`drivers`,
  and Risk `trigger`/`impact`.
- Missing Entity, Relation, and Intelligence lifecycle values deterministically
  become `{status: active}` with `legacy_lifecycle_default_active` warnings;
  explicit legal lifecycle values remain unchanged.
- Unsupported or absent Source `sourceType` becomes `unknown`, while the legacy
  top-level `type` remains and `documentType`/Entity compatibility fields are
  preserved under `metadata.legacyV02`.
- Legacy Claim `period`, Trend `timeHorizon`, event `occurredAt` plus
  `datePrecision`, and `affectedEntityRefs` receive deterministic target
  treatment. Claim `category` is explicitly discarded with a warning.
- The exact example contains two numeric legacy `period` values; both now emit
  `legacy_temporal_invalid` and remain blocking Review rather than being
  silently ignored.

### Failed invariant root cause

The unresolved legacy IDs are exactly three root `ambiguous_contains_semantics`
relations:

1. `relation:data-center-contains-liquid-cooling`
2. `relation:data-center-contains-server`
3. `relation:server-contains-liquid-cooling`

Their relation files remain in the isolated projected tree but have no target
canonical registry entries because the frozen migration rule intentionally
does not guess their semantics. Thus `completeCanonicalIdMapping=false` has
three unresolved canonical IDs, and `declaredCanonicalRefsResolveToTarget=false`
has three affected unresolved relation references. Both failed invariants are
expected dependent consequences of the three root semantic reviews, not
independent transformer defects.

No unexpected implementation defect was observed. The exact source is not
invalid under Schema 0.2; it is valid source data that contains semantics not
yet frozen for deterministic v0.3 migration. No automatic guess was made.

## Commit and integrity status

Implementation commit: see the final Git handoff for the immutable commit hash.

Commit run `b03-ai-hardware-commit` remains intentionally **not executed** for
the expected semantic Reviews prevent a safe commit. The repository example's
pre/post tree hashes are equal.


The projected dry-run preserves the ThemeGroup fallback boundary, canonical
Entity/Relation/Claim/Module/Source namespaces, taxonomy and views as
auxiliary data, and the empty Raw registry. The optional real Runtime KB was
tested from a fresh disposable clone: `b03-real-dry-run` returned zero Reviews,
all invariants true, and passed source and target validation;
`b03-real-commit` committed the clone to Schema 0.3 / revision 1 and passed
canonical v0.3 loading. The original Runtime KB remained byte-identical and
was not modified.

## B3-R2 Temporal Safety Matrix

| Case | Result |
| --- | --- |
| period only | period label preserved |
| Trend timeHorizon only | period label preserved |
| occurredAt + day | point label preserved |
| occurredAt + year | period label preserved |
| equivalent period + timeHorizon | one target temporal, no Review |
| conflicting period + timeHorizon | `temporal_semantic_conflict` |
| period + occurredAt conflict | `temporal_semantic_conflict` |
| explicit temporal matching label/type | explicit temporal preserved |
| explicit null label with compatible period | label enriched, other fields preserved |
| explicit label mismatch | `temporal_semantic_conflict` |
| explicit scope type mismatch | `temporal_semantic_conflict` |
| numeric period | `legacy_temporal_invalid` |
| numeric Trend timeHorizon | `legacy_temporal_invalid` |
| numeric occurredAt | `legacy_temporal_invalid` |

The three metadata collision regressions also passed: existing Entity
`listingStatus`, existing Source `documentType`, and non-object
`metadata.legacyV02` all produce `legacy_metadata_collision` without overwrite.

## Validation

- Integration TypeScript compile: passed
- B3 + B2 + B1 + migration tests: passed, including the new policy fixture
- Migration/acceptance tests: 26 passed
- v0.3 Schema, Domain, and validator tests: 81 passed
- Schema tests: 8 passed
- Knowledge tests: 34 passed
- Knowledge infrastructure/dependency-boundary tests: 46 passed
- Known unrelated external issue remains `PIPELINE-REAL-DATA-003` (AKShare fetch failure); AKShare was not modified

## Governance

- B3 Evidence: `Accepted - Sol verified`
- B3-R1: `Completed / Rework Required`
- B3-R1 acceptance: `Rework Required - Sol verification`
- B3-R2: `Completed / Sol Verification Pending`
- Stage B: `Completed / Sol Verification Pending`
- Current direction: Sol final verification of temporal safety and Stage B closure evidence
