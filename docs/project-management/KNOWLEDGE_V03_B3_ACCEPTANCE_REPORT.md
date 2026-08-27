# Knowledge v0.3 B3 Example Acceptance Report

## Result

B3 is **Blocked by Semantic Review**. The exact Git-managed source was used
without repair or normalization. It passed Schema 0.2 validation, but the
Schema 0.2 to 0.3 dry-run returned deterministic Category A semantic reviews;
therefore no commit was performed.

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
- Warnings: 31 (10 exposure-basis, 10 materiality, 10 realization-stage, 1 unclassified ThemeGroup fallback)
- Reviews: 115, all Category A; no Category B/C/D reviews
- Review role split: 113 `ROOT_SEMANTIC_AMBIGUITY`, 2 `DEPENDENT_REFERENCE_BLOCKED`, 0 `OTHER`
- Inferred invariants: `completeCanonicalIdMapping=false` and `declaredCanonicalRefsResolveToTarget=false`; the remaining migration invariants are true
- Source copy remained byte-identical; no live migration log or transaction residue was created

The fresh third-copy repeat with run ID `b03-ai-hardware-dry-run-repeat`
matched the first run’s semantic output after excluding only
`migrationRunId` and `reviewItemId` fields. Normalized semantic output hashes
were both `06314595ae09bb5f8f0f596d9525d9bee10add5001152d88d1a7751a18a5444c`;
semantic equality is `true`.

## Migration Review Report

Every returned review item is classified one-for-one by
`tests/knowledge/migration/b03-example-acceptance.test.ts`. The deterministic
groups are:

| Review code | Count | Role | Affected legacy kind/type | Frozen rule | Classification | Next action |
| --- | ---: | --- | --- | --- | --- | --- |
| `ambiguous_contains_semantics` | 3 | ROOT_SEMANTIC_AMBIGUITY | relation / `contains` | A legacy `contains` relation must map to one frozen v0.3 relation semantics without guessing | A | Decide the frozen relation semantics |
| `claim_statement_missing` | 2 | ROOT_SEMANTIC_AMBIGUITY | intelligence / `forecast`, `viewpoint` | Every v0.3 Claim requires a deterministic non-empty statement | A | Supply an explicit statement rule or source data |
| `legacy_semantic_field_unmapped` | 55 | ROOT_SEMANTIC_AMBIGUITY | entity, intelligence, module / multiple legacy types | Non-empty legacy semantics require an explicit lossless destination or declared review disposition | A | Define preservation/mapping semantics |
| `lifecycle_missing` | 41 | ROOT_SEMANTIC_AMBIGUITY | entity, relation, intelligence / multiple legacy types | Required v0.3 lifecycle values cannot be invented from absent v0.2 fields | A | Decide lifecycle derivation policy |
| `unsupported_custom_legacy_type` | 12 | ROOT_SEMANTIC_AMBIGUITY | source / `annual_report`, `research_report`, `press_release` | A legacy Source type must map to a frozen v0.3 SourceType without guessing | A | Decide the source-type mapping |
| `completeCanonicalIdMapping` | 1 | DEPENDENT_REFERENCE_BLOCKED | migration invariant / 3 unresolved relations | All legacy canonical objects must have a target mapping; this fails because the three root `contains` relations have no target | A | Resolve the root semantic reviews |
| `declaredCanonicalRefsResolveToTarget` | 1 | DEPENDENT_REFERENCE_BLOCKED | migration invariant / 3 unresolved relation refs | Every declared canonical reference must resolve in the target registry; this fails because the three unresolved relation files remain outside the target registry | A | Resolve the root semantic reviews |

The first five rows are root semantic patterns and account for 113 ReviewItems;
the final two rows are deterministic aggregate consequences and account for 2.
There are no Category B invalid-example, Category C transformer-defect, or
Category D validator/runtime-defect findings.

### Root versus dependent analysis

The 113 root reviews are independent semantic decisions: 3 ambiguous relation
objects, 2 missing Claim statement sources, 55 unmapped legacy semantic-field
observations, 41 missing lifecycle observations, and 12 unsupported Source
types. The 2 dependent reviews are not additional semantic decisions; they are
the aggregate invariants generated after the root relation ambiguity prevents
complete mapping and target reference closure. `OTHER` is 0.

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
- The 55 `legacy_semantic_field_unmapped` reviews are retained individually by
  the test’s review projection, including source paths, asset IDs, and field
  details. Representative fields are company `listingStatus`/`sourceRefs`,
  Intelligence `affectedEntityRefs`/`datePrecision`/`occurredAt`/`category`,
  and other non-empty legacy semantics without a frozen v0.3 destination.
- The 41 `lifecycle_missing` reviews are retained individually by asset ID and
  source path; they report absent required lifecycle data and do not assert a
  fabricated lifecycle value.
- The 12 `unsupported_custom_legacy_type` reviews are the 12 Source assets;
  their source paths and legacy types are retained in the test projection.

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
expected dependent consequences of the three root Category A reviews, not
independent transformer defects.

No Category C/D implementation defect was observed. The exact source is not
invalid under Schema 0.2; it is valid source data that contains semantics not
yet frozen for deterministic v0.3 migration. No automatic guess was made.

## Commit and integrity status

Commit run `b03-ai-hardware-commit` was intentionally **not executed** because
Part F requires zero reviews, all invariants true, and passed target
validation. Consequently there is no committed v0.3 Handle or migration log
for B3. The repository example’s pre/post tree hashes are equal.

The projected dry-run preserves the ThemeGroup fallback boundary, canonical
Entity/Relation/Claim/Module/Source namespaces, taxonomy and views as
auxiliary data, and the empty Raw registry. The optional configured real
Runtime KB `ai-hardware-real` was available; a clone-only dry-run passed source
validation and returned `review_required` with 1 lifecycle review and 1 warning.
The original Runtime KB was not modified.

## Validation

- Integration TypeScript compile: passed
- B3 + B2 + B1 + migration tests: 28 passed
- v0.3 validator tests: 74 passed
- Schema tests: 8 passed
- Knowledge tests: 34 passed
- Knowledge infrastructure/dependency-boundary tests: 46 passed
- Known unrelated external issue remains `PIPELINE-REAL-DATA-003` (AKShare fetch failure); AKShare was not modified

## Governance

- B3: `Blocked by Semantic Review`
- B3 acceptance: `Sol Verification Pending`
- Stage B: `In Progress`
- Current direction: resolve the frozen semantic decisions, then issue the corrective/continuation task as directed by Sol
