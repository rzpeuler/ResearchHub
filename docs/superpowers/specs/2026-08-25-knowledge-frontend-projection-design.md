# Knowledge Frontend Projection v0.1 Design

## Goal

Migrate the existing `tests/knowledge/index.html` prototype from legacy JSON
fixtures to the accepted Production Knowledge Dataset without introducing a
frontend package, persistent projection asset, or new Knowledge layer.

## Runtime Flow

```text
knowledge assets
  -> KnowledgeLoader / KnowledgeIndex
  -> KnowledgeAccessSkill
  -> KnowledgeViewAdapter (server-side, read-only)
  -> tests/knowledge/serve.ts HTTP endpoints
  -> existing tests/knowledge/index.html
```

The browser never reads Knowledge YAML directly. The adapter composes temporary
read models and never writes back to Knowledge.

## Projection Contracts

- `getIndustryDirectoryProjection()` reads the 31 SW Level-1 taxonomy items,
  maps `graphRefs` to entity names, and returns `classification` plus
  `industries[{ id, name, graphs }]`.
- `getGraphProjection(entityId)` returns `{ root, children, relations }`.
  Nodes contain only `id`, `type`, `name`, and `hasChildren`; relations expose
  `id`, `type`, `source`, and `target`.
- `getEntityDetailProjection(entityId)` returns the selected Entity, direct
  children, related companies, typed Intelligence groups, Modules, deduplicated
  Sources, and event Facts. Company financial metrics come from Intelligence
  Facts, never from a `financials` entity field.

## Semantic Rules

- Viewpoint output maps only `bullishPoints`, `bearishPoints`, and `keyVariables`.
- Event timeline items come from Facts with `category: event` and use
  `occurredAt`, `statement`, `impact`, and `affectedEntityRefs`.
- Comparison tables render Module `columns` and `rows` dynamically.
- Market share is omitted unless an `operates_in` relation has both a directly
  disclosed `attributes.segmentRevenue` and `attributes.revenueScope`.
- Graph nodes use equal visual size; no missing `marketSize` value is inferred.
- Missing configured or empty View sections are hidden rather than filled with
  mock content.

## HTTP and UI

`serve.ts` adds read-only GET endpoints:

- `/api/knowledge/directory`
- `/api/knowledge/graph/:entityId`
- `/api/knowledge/entity/:entityId`

Unknown entity IDs return JSON 404 responses. Static file serving remains
unchanged. `index.html` keeps the existing directory, graph, breadcrumb,
detail, company, viewpoint, forecast, comparison, event timeline, source, and
search interactions while replacing legacy JSON fetches with the endpoints.

## Verification

Add deterministic adapter and HTTP tests. Assert that the HTML contains no
runtime reference to `industry-graph.json` or `industry-directory.json`, and
that production UI strings do not expose prototype/mock presentation language.
Run the Knowledge suite, integration typecheck, default full test suite, and
`git diff --check`; leave the legacy benchmark files and unrelated `tools/`
untracked files untouched.
