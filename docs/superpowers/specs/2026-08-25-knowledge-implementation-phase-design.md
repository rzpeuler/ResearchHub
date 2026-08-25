# Knowledge Layer Implementation Phase v0.1 Design

## Status

Design approved for review; implementation has not started.

## Objective

Implement the first engineering foundation for the ResearchHub Knowledge Layer
without adding a database, graph engine, RAG system, Research Artifact Layer,
Multi-Agent layer, or changes to DSH, Workflow, or Plugin architecture.

## Architecture Decision

Runtime code will follow the repository's existing Skill layout:

```text
packages/skills/knowledge-access/
packages/skills/knowledge-validation/
```

The top-level `knowledge/` directory remains a durable asset boundary only.
It will contain the v0.1 asset directories and human-readable boundary
documentation, not runtime code.

`knowledge-validation` will depend on the runtime-neutral types and loader
contracts exposed by `knowledge-access`; `knowledge-access` will not depend on
validation implementation details. Validation is run before an index is made
available to normal queries.

## Asset Layout

Create the v0.1 top-level asset directories:

```text
knowledge/
├── taxonomy/
├── entities/
├── relations/
├── intelligence/
├── modules/
├── sources/
├── views/
└── registry/
```

The implementation will not populate production Knowledge data in this phase.
The fixture dataset will live under:

```text
tests/knowledge/fixtures/
```

It will mirror the frozen storage layout and contain valid AI Hardware assets,
registry files, and deliberately invalid validation fixtures.

## Runtime Model

The shared runtime model is intentionally close to the frozen Knowledge schema:

- `Entity`: id, type, name, optional description/tags/taxonomyRefs/metadata;
- `Relation`: id, type, source, target, optional attributes/confidence/sourceRefs/lifecycle;
- `Intelligence`: fact, forecast, viewpoint, trend, or risk with entityRefs and
  type-specific payload;
- `Module`: id, type, targetEntity, schema and rows/columns where applicable;
- `Source`: id, type, title, publisher, publishedAt, url, quality;
- `Lifecycle`: status, optional validFrom and validUntil.

All loaded objects retain their source file path for diagnostics. IDs are
validated against the `{namespace}:{kebab-case-slug}` convention.

## Knowledge Loader

`knowledge-access` will provide a `KnowledgeLoader` with:

```text
load(options) -> KnowledgeIndex
reload() -> KnowledgeIndex
```

Loading sequence:

```text
registry files
    ↓
asset discovery
    ↓
YAML/JSON parsing
    ↓
runtime object conversion
    ↓
validation report
    ↓
in-memory indexes
```

The loader will support `.yaml`, `.yml`, and `.json` assets. Because the task
scope does not permit changing package metadata and `yaml` is only a
transitive dependency, the repository will include a small deterministic YAML
subset parser. It will support the fixture vocabulary: indented mappings,
sequences, scalar values, quoted values, comments, and JSON-style inline
arrays/objects. Unsupported YAML features fail with a structured parse error;
they are not silently interpreted.

The loader will load once, retain an in-memory cache, and support explicit
reload. It will not watch files, use Redis, or perform network access.

The `KnowledgeIndex` will maintain maps for entities, relations, intelligence,
modules, and sources, plus reverse indexes for relation source/target and
intelligence entity references. Invalid assets will not enter a successful
runtime index.

## Knowledge Access Skill

`KnowledgeAccessSkill` will expose deterministic read-only methods:

```text
getEntity(id)
searchEntities(query, type?)
getRelations(entityId, relationType?)
getSupplyChain(entityId, depth?)
getRelatedCompanies(entityId, filters?)
getIntelligence(entityId, type?)
getModules(entityId)
getComparison(entityId, comparisonType)
getSources(knowledgeItemId)
```

Query behavior:

- exact IDs return the indexed object or a typed `NotFound` error;
- search is deterministic, case-insensitive, and matches name, ID, and tags;
- relation queries return only indexed, valid relations;
- supply-chain traversal follows relation types such as `contains`,
  `upstream_of`, `downstream_of`, and `depends_on`, with cycle protection;
- related-company queries use `operates_in`, `supplies`, `customer_of`,
  `partner_of`, and equivalent company exposure relations;
- intelligence queries filter by entity reference and optional type;
- module and comparison queries return registered module assets only;
- source queries resolve source references from an entity, relation, or
  intelligence item.

The access Skill will not update Knowledge, call an LLM, make investment
decisions, validate factual truth, or access external systems.

## Knowledge Validation Skill

`KnowledgeValidationSkill` will expose:

```text
validateKnowledge(scope?) -> ValidationReport
```

The report contains `status`, `errors`, `warnings`, `info`, `timestamp`, and
`scope`. Each diagnostic includes code, severity, message, asset ID when
available, and source file path.

Validation categories:

- Schema: required fields and supported object types;
- ID: namespace, slug, and uniqueness rules;
- Reference: entity, source, module, and intelligence references exist;
- Relation: source/target types and relation types are valid;
- Lifecycle: status is allowed and date ranges are coherent;
- Module: referenced modules are registered and comparison structures are
  internally valid;
- Source: required source metadata exists for research-type intelligence.

Validation is deterministic, read-only, and does not auto-repair assets.
`error` diagnostics produce a failed report; warnings and info do not.

## Fixture and Test Design

Tests will be split under `tests/knowledge/`:

```text
tests/knowledge/
├── fixtures/
├── loader/
├── skill/
├── validation/
└── integration/
```

The valid fixture will include the AI Hardware industry, required segments,
companies, relations, intelligence examples, modules, sources, and registry
entries. Invalid fixtures will cover at least:

- missing entity reference;
- invalid relation endpoints or relation type;
- invalid lifecycle status/date range;
- unknown module;
- invalid or duplicate ID.

Integration tests will construct a minimal test-local Workflow Consumer that
loads the fixture, requires validation success, calls the Access Skill, and
asserts that the consumer receives entity, supply-chain, company, intelligence,
module, comparison, and source results. No existing Workflow definition or
runtime architecture will be modified.

All tests will be local, deterministic, network-free, and independent of
Tushare, AkShare, databases, and LLM credentials.

## Error Handling

The implementation will use typed error categories aligned with the frozen
architecture:

```text
NotFound
ParseError
SchemaError
InvalidReference
InvalidRelation
InvalidLifecycle
UnknownModule
```

Loader failures will identify the asset path. Query failures will not expose
raw parser exceptions. Validation will aggregate all diagnostics instead of
stopping at the first invalid asset.

## Documentation and Scope

After implementation, update `docs/project-management/CURRENT_STATUS.md` and
`docs/project-management/CHANGELOG.md` with the completed foundation and test
status. No DSH, Workflow, Plugin, or unrelated runtime files will be changed.

## Acceptance Criteria

- top-level Knowledge asset directories exist;
- valid Knowledge fixture loads into a runtime index;
- all nine Access Skill APIs are callable and deterministic;
- validation passes valid fixtures and identifies invalid fixtures;
- integration test closes the fixture → loader → validation → index → Skill →
  consumer chain;
- existing typecheck and focused tests remain green;
- no prohibited architecture layer or external data dependency is introduced.
