# Real Equity Research Pipeline Acquisition Validation

**Task:** PIPELINE-REAL-DATA-002  
**Status:** Design approved for implementation  
**Date:** 2026-08-24

## Objective

Re-run the opt-in real Equity Research Pipeline for `600519` using the new
News Acquisition Layer, while preserving the existing Workflow, Skill,
Artifact, Plugin, and DSH contracts.

## Runtime composition

```text
ResearchManager
  -> Equity Research Workflow
  -> five LLM Skill adapters
  -> NewsAcquisitionLayer
       -> GdeltSearchProvider
       -> NativeWebFetcher
       -> HtmlArticleNormalizer
       -> NewsEvidenceBuilder
  -> AKShare Financial Plugin
  -> DeepSeek Runtime
  -> Evidence/Thesis/Prediction/ResearchReport
  -> Evaluation
```

The real test must not instantiate `GdeltNewsPlugin` directly. It uses the
Acquisition Layer and maps its normalized articles to the unchanged
`search_company_news` compatibility port required by the existing Company
Research Skill boundary.

## Compatibility adapter

The test-only adapter projects each normalized article into the existing news
result shape (`symbol`, `headline`, `content`, `source`, `timestamp`,
`confidence`). The source is annotated with the acquisition Provider identity,
and the full Acquisition Evidence remains separately validated and serialized.

This avoids modifying the production Workflow or Skill implementations while
proving that Acquisition data enters the current research path.

## Validation record

The test records and asserts:

- Search result, fetched document, normalized article, and Acquisition Evidence
  counts;
- `gdelt-search`, `native-web-fetcher`, and `akshare-financial` Provider names;
- all six Workflow step states;
- five LLM requests and per-Skill output summaries;
- Evidence, Thesis, Prediction, and ResearchReport counts and relationships;
- Evidence serialization round trips and source/provider metadata;
- Evaluation status `met`.

## Network policy

The test remains skipped unless `RUN_REAL_EQUITY_PIPELINE=1` is set. It also
requires `DEEPSEEK_API_KEY` and `AKSHARE_FINANCIAL_ENDPOINT`. Default `npm test`
does not call GDELT, public web pages, AKShare, or DeepSeek.

Transient GDELT rate limits, web fetch failures, provider outages, LLM errors,
and data-quality issues are reported as external runtime risks rather than
silently replaced with fixtures.

## Scope constraints

Only the integration test, runtime/provider configuration used by that test,
and project status documentation may change. No new Skill, Workflow, Agent,
Capability, Artifact model, or architecture layer is introduced.
