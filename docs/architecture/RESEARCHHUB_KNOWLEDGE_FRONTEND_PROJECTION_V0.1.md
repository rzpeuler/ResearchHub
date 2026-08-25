# ResearchHub Knowledge Frontend Projection v0.1

## Status

Phase 2C implementation for the AI Hardware validation page.

## Boundary

The frontend projection is a server-side, deterministic read model. It is not
a new architecture layer, does not persist data, and does not write to
Knowledge assets.

```text
Production Knowledge
  -> KnowledgeLoader / KnowledgeIndex
  -> KnowledgeAccessSkill
  -> tests/knowledge/frontend/KnowledgeViewAdapter
  -> tests/knowledge/serve.ts read-only HTTP API
  -> tests/knowledge/index.html
```

The browser never reads Knowledge YAML directly. Legacy JSON files remain as
acceptance benchmarks only and are not part of the page runtime.

## API Contract

- `GET /api/knowledge/directory` returns the 31 SW Level-1 items and graph
  references derived from `knowledge/taxonomy/sw-level-1.yaml`.
- `GET /api/knowledge/graph/:entityId` returns a root node, direct supply-chain
  children, and relations using `source` / `target` fields.
- `GET /api/knowledge/entity/:entityId` returns Entity detail, children,
  related companies, typed Intelligence, Modules, event Facts, deduplicated
  Sources, and View section configuration.

## Prototype-to-Production Mapping

| Former page input | Production projection source |
| --- | --- |
| `industry-directory.json` | SW Taxonomy + Entity graph references |
| `industry-graph.json` relations | Access Skill relations |
| `financials` | `fact` Intelligence with `category: financial_metric` |
| `knowledge.marketForecast` | `forecast` Intelligence |
| `coreView` | `viewpoint` Intelligence |
| `Event[]` | `fact` Intelligence with `category: event` |
| `Research[]` | Entity/Intelligence/Module `sourceRefs` -> Source |
| static comparison columns | Module `columns` and `rows` |
| `MarketShareProjection` | `CompanyScaleProjection` from company `total-revenue` Facts |

## Segment Scale Projection

Graph children may expose an optional raw `scaleInput` from the selected active
`fact` Intelligence with `metric: market-size`:

```ts
type SegmentScaleInput = {
  value: number
  period: string
  unit: string
  sourceRefs: string[]
}
```

The adapter excludes Forecast objects and invalid, inactive, non-numeric, or
incomplete Facts. Fact selection is deterministic: higher confidence first,
then newer period, then stable Fact ID. The adapter returns only the source
value and provenance; it does not calculate visual weights, percentages,
market share, or maxima.

The browser compares `period` and `unit` across same-level children. When at
least one usable input exists and all usable inputs share the same period and
unit, data-bearing nodes use relative square-root CSS flex weights and nodes
without data use the baseline weight. If inputs are missing or not comparable,
the entire level is rendered with equal weight. This is symmetric with
`CompanyScaleProjection`, which continues to use company `total-revenue`
Facts for company cards.

Unsupported or unavailable data is omitted. The page does not infer market
share, industry concentration, or business-segment revenue. A company-scale
projection only exposes company `total-revenue` Financial Facts already
present in Intelligence; the browser uses them as CSS card-size inputs and
never derives a percentage or denominator. `segmentRevenue` on an
`operates_in` relation remains available for a future, separate business-scale
view and is not the default company-scale input.

Company cards can use different visual weights only when total-revenue Fact
`period` and `unit` match. Otherwise the page renders equal-size cards. The
user-facing label is “公司规模”; “市场份额” is not a frontend projection
concept.

ResearchHub human-readable Knowledge content is Chinese-first. Stable IDs,
namespaces, YAML keys, TypeScript/API keys, enum values, relation types,
module types and metric identifiers remain English. Industry-standard
abbreviations, product names, brand names and original source titles may keep
their canonical form.

## Retirement Condition

The legacy JSON benchmark files can be retired only after the production
projection contract is adopted by the intended frontend consumer. Phase 2C
removes their runtime dependency but deliberately preserves the files and
their tests for regression comparison.
