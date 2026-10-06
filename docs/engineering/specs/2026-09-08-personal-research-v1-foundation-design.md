# Personal Research v1 Foundation Design

## Status

Approved for implementation on 2026-09-08. This design scopes the first Personal Research v1 production slice to A-share Company Deep Research while preserving the frozen ResearchHub boundaries.

## Objective and non-goals

The slice provides one explicit product action, `research_company`, with this durable path:

```text
Company objective
  -> bounded free-source acquisition
  -> structured Company Research
  -> Markdown Report + Semantic Proposals
  -> Binding / Resolution / ChangeSet / Validation / Writer
  -> reload verification
```

It does not add a custom Agent Runtime, generic Provider or Capability framework, multi-agent execution, queue/Redis, trading, broker integration, Graph DB, Vector DB, RAG, or automatic migration of existing Knowledge data.

## Architecture

The implementation is additive. Existing Schema 0.3 storage, loader, Writer, and Raw Document Ingestion remain regression-protected. Schema 0.4 is an explicit fresh-KnowledgeBase baseline selected by versioned manifest metadata; no existing 0.3 runtime directory is rewritten in place.

The new modules follow the existing physical layout:

```text
plugins/research-acquisition/   external source discovery, fetch, normalize, archive metadata
skills/company-research/        semantic methodology and report/proposal projection
workflows/company-deep-research/ deterministic orchestration and production gateway use
knowledge/schema, validation, storage, writer  Schema 0.4 integrity path
app/services/                    product-level research_company and report/workflow views
runtime-data/reports/            Markdown reports and bounded report metadata
runtime-data/research-signals/   non-canonical source intake
```

The acquisition composition is concrete and narrow: official disclosure, AKShare structured data, GDELT/RSS discovery, and a Trafilatura-compatible extraction adapter with a deterministic test fallback. It exposes only the necessary `discover`, `fetch`, and `normalize` behavior and does not register arbitrary providers.

## Schema 0.4

Schema 0.4 extends claims with `assumption`, `thesis`, and `catalyst`; canonical-only dependency references (`supportsClaimRefs`, `dependsOnClaimRefs`, and `contradictsClaimRefs`); and a forecast-only `probability` distinct from correctness/support `confidence`.

Dependency validation is deterministic: references must resolve to canonical claims in the same validated state, self-reference is rejected, and cycles are rejected with a stable cycle diagnostic without recursive loader/Writer failure. Forecast probability is required and constrained to 0..1; non-forecast claims do not use it. Confidence remains a separate 0..1 field.

Sources retain exact raw provenance and add provider, canonical URL, retrieval timestamp, content hash, acquisition metadata, and explicit rights metadata. Rights are not assumed unrestricted; the default public/non-commercial policy is represented as data and can deny derivative knowledge or redistribution.

## Report and ResearchSignal boundaries

`ResearchReport` is a narrow validated application artifact containing report identity, type, subject references, generation/as-of times, workflow run, KnowledgeBase revision, final source/claim references, methodology, ordered sections, and output path. The first supported report type is `company_research`; Markdown is the canonical output format.

`ResearchSignal` is an intake record for news, announcements, institutional/public views, community material, and social attention. It may reference a source or raw content and carry publication/discovery, author/account, candidate entities, themes, relevance, novelty, sentiment, and engagement. It is never put in the canonical Registry, Knowledge Graph, or Writer input.

## Company Research workflow

The Workflow owns lifecycle, bounded source count/concurrency, cancellation, deterministic validation, and the shared Knowledge Production seam. The Skill owns research methodology, semantic synthesis, report sections, and proposal semantics. Neither Skill nor the application adapter allocates canonical IDs or writes the registry.

The report has the following required section order, allowing explicit unavailable-data notes:

1. Company Overview
2. Business Model
3. Business Segments
4. Revenue / Profit Drivers
5. Products
6. Technologies
7. Industry Exposure
8. Supply Chain
9. Competition
10. Financial Quality
11. Growth Drivers
12. Management / Capital Allocation
13. Catalysts
14. Risks
15. Valuation
16. Bull / Base / Bear
17. Variant Perception
18. Investment Thesis
19. Monitoring Checklist

Numerical calculations are performed by deterministic valuation utilities. The Skill may supply assumptions and interpretation, but key valuation numbers are recomputed and recorded from program outputs.

## Failure and replay semantics

Acquisition failures are bounded and represented per source; an empty or partially inaccessible source set produces an explicit incomplete research outcome rather than fabricated evidence. Ambiguous company identity, stale KnowledgeBase revision, unsupported dependency, malformed numerical data, cancellation, and repeated requests are terminal deterministic cases.

Canonical mutation is staged behind the existing atomic Writer path. A failure before Writer leaves no canonical partial state. Report persistence occurs only after final reload/validation and records the committed revision and final references. A deterministic request fingerprint and workflow run identity make same-input replay idempotent and changed-input replay a conflict.

## Testing strategy

All normal tests are offline. Source adapters use fixtures and injected transports/runners. Targeted tests cover Schema 0.4, dependency/probability/rights validation, non-canonical signals, report contracts, acquisition, Skill output, valuation arithmetic, Workflow cancellation/replay, Knowledge Production integration, Writer atomicity, Raw Ingestion regression, and Application Service behavior. A separate real-network smoke may exercise official disclosure, GDELT/RSS, and AKShare when the local external runtime is available; its result is reported as pass or blocked with evidence and never represented as a fixture success.

