# ResearchHub Knowledge Layer Phase 1 Implementation v0.1

## Boundary

The implementation preserves the architecture:

```text
dsh -> Workflow -> Skill -> Knowledge / Plugin
```

Knowledge remains a top-level asset boundary. The implementation does not add
an architecture layer, database, graph database, vector database, RAG,
LLM-based validation, Research Artifact Layer, or Multi-Agent runtime.

## Loader and Registry

`KnowledgeLoader` parses YAML/JSON assets into an in-memory `KnowledgeIndex`.
If `registry/` is absent, recursive discovery is used as a fixture-friendly
fallback. If Registry files are present, the Registry is authoritative: only
registered asset paths are loaded. Validation reports missing assets, duplicate
IDs, conflicting paths, unsafe paths, ID mismatches, and type mismatches.

`registry/modules.yaml` is a lightweight Entity ID -> Module ID binding. Access
Skill returns only modules registered for the requested Entity; a module's
`targetEntity` is checked against its Registry binding.

## Validation Rules

Typed configuration lives under
`packages/skills/knowledge-validation/rules/`:

- `relation-rules.yaml` defines canonical endpoint constraints.
- `intelligence-rules.yaml` defines required fields for Forecast, Viewpoint,
  Trend, and Risk.
- `lifecycle-rules.yaml` defines allowed lifecycle statuses.

Scope controls emitted diagnostics only. All asset groups are indexed before
scoped checks, so relation, Intelligence, and Module references remain
resolvable in their independent scopes.

The canonical relation vocabulary is:

```text
contains, upstream_of, downstream_of, depends_on, substitute_for,
operates_in, supplier_of, customer_of, partner_of, competes_with,
owns_stake_in, invested_in
```

## Integration Contract

The AI Hardware fixture is exercised through a registered `WorkflowDefinition`.
The test verifies the path `Workflow -> Knowledge Access Skill -> Loader/Index`
for supply chain, related companies, and Intelligence queries. No production
Workflow architecture is modified.
